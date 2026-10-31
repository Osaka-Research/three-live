/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// RealityKit binding for `XRLiveRuntimeSession`. Excluded on tvOS for the same reason as
// `RealityKitHelper` (Entity loading APIs are unavailable there).
#if canImport(RealityKit) && !os(tvOS)
  import Combine
  import Foundation
  import RealityKit
  import simd

  #if canImport(UIKit)
    import UIKit
    typealias XRPlatformColor = UIColor
  #elseif canImport(AppKit)
    import AppKit
    typealias XRPlatformColor = NSColor
  #endif

  /// Buffers session callbacks so the main-actor binding can apply them after each call.
  final class XRLiveChangeCollector: XRLiveRuntimeSessionDelegate {
    enum AnimationRequest {
      case start(index: Int?, name: String?)
      case stop
    }

    var transforms: [(Int, XRNodeTransform)] = []
    var visibility: [(Int, Bool)] = []
    var materials: [(Int, XRMaterialState)] = []
    var events: [(String, String)] = []
    var animations: [AnimationRequest] = []

    func nodeTransformChanged(_ nodeIndex: Int, transform: XRNodeTransform) {
      transforms.append((nodeIndex, transform))
    }

    func visibilityChanged(_ nodeIndex: Int, visible: Bool) {
      visibility.append((nodeIndex, visible))
    }

    func materialChanged(_ materialIndex: Int, material: XRMaterialState) {
      materials.append((materialIndex, material))
    }

    func interactivityEvent(id: String, payloadJSON: String) {
      events.append((id, payloadJSON))
    }

    func animationStart(index: Int?, name: String?) {
      animations.append(.start(index: index, name: name))
    }

    func animationStop() {
      animations.append(.stop)
    }
  }

  /// Drives an `XRLiveRuntimeSession` against a loaded RealityKit entity hierarchy.
  ///
  /// glTF nodes are mapped to entities by name (glTF node names are preserved as USD prim
  /// names, sanitized with `XRLiveGLB.usdPrimName(for:fallback:)`). Behavior-graph changes
  /// are applied to `Entity.transform`, `Entity.isEnabled` and `ModelComponent` materials.
  ///
  /// ```swift
  /// let entity = try await RealityKitHelper.loadEntity(fromGLB: glb)
  /// guard let live = XRLiveRealityKitSession(glbData: glb, root: entity) else { return }
  /// live.installInputTargets()
  /// live.headPoseProvider = { XRPose(matrix: cameraTransform) }
  /// live.start()  // fires event/onStart and steps from SceneEvents.Update once in a scene
  /// // iOS:      live.handleTap(at: point, in: arView)
  /// // visionOS: SpatialTapGesture().targetedToAnyEntity()
  /// //             .onEnded { live.handleTap(on: $0.entity) }
  /// ```
  @available(iOS 15.0, macOS 12.0, visionOS 1.0, *)
  @MainActor
  public final class XRLiveRealityKitSession {
    /// The platform-neutral runtime.
    public let session: XRLiveRuntimeSession
    /// The root of the loaded scene.
    public let root: Entity
    /// Entities bound to glTF node indices.
    public private(set) var entitiesByNode: [Int: Entity] = [:]

    /// Supplies the world-space head pose each frame (lazy follow, `faceUser`, orbit
    /// target `"head"`). `nil` disables head-anchored behavior for that frame.
    public var headPoseProvider: (() -> XRPose?)?
    /// Supplies world-space hand poses each frame for hand-anchored lazy follows.
    public var handPoseProvider: (() -> [XRHand: XRPose])?
    /// When `true` (`xrHands != "none"`), polls `handSource` (or `XRHandJointSources.current()`)
    /// each frame, feeds wrist poses into `session.step` when `handPoseProvider` is `nil`, and
    /// reports gesture changes via `onGesture`.
    public var handsEnabled: Bool = false
    /// Per-session override for `XRHandJointSources.current()`.
    public var handSource: XRHandJointSource?
    /// Called when a hand's gesture changes to a non-`.none` gesture (when `handsEnabled` is `true`).
    public var onGesture: ((XRHandGestureEvent) -> Void)?
    /// Called for every `event/send` with the event id and JSON payload.
    public var onInteractivityEvent: ((String, String) -> Void)?
    /// Overrides the default `animation/start` handling (play `root.availableAnimations`).
    public var onAnimationStart: ((Int?, String?) -> Void)?
    /// Overrides the default `animation/stop` handling (`root.stopAllAnimations()`).
    public var onAnimationStop: (() -> Void)?

    private var nodeByEntity: [ObjectIdentifier: Int] = [:]
    private var inverseBakedSceneByNode: [Int: simd_float4x4] = [:]
    private var referenceEntity: Entity?
    private var arSurfacePreviewContainer: Entity?
    private let collector = XRLiveChangeCollector()
    private var gestureTracker = XRHandGestureTracker()
    private var updateSubscription: Combine.Cancellable?

    /// Binds `session` to the entity hierarchy under `root`.
    public init(session: XRLiveRuntimeSession, root: Entity) {
      self.session = session
      self.root = root
      session.delegate = collector
      bindEntities()
    }

    /// Creates a session from compiled `.glb` bytes and binds it to `root` (typically the
    /// entity loaded from the same GLB). Returns `nil` when the GLB is malformed.
    public convenience init?(glbData: Data, root: Entity) {
      guard let session = XRLiveRuntimeSession(glbData: glbData) else { return nil }
      self.init(session: session, root: root)
    }

    // MARK: Entity mapping

    private func bindEntities() {
      var byName: [String: [Entity]] = [:]
      var meshEntitiesInOrder: [Entity] = []
      func visit(_ entity: Entity, depth: Int) {
        guard depth < 256 else { return }
        // Strip USD-imported rigid-body and anchoring components (`PhysicsBodyAPI` and
        // `preliminary:anchoring:type` in `.usda` are emitted for standalone AR Quick Look;
        // in a live session `XRLiveRuntimeSession.stepPhysics` owns rigid-body motion and the
        // host `AnchorEntity` owns scene placement).
        entity.components.remove(AnchoringComponent.self)
        entity.components.remove(PhysicsBodyComponent.self)
        entity.components.remove(PhysicsMotionComponent.self)
        if !entity.name.isEmpty {
          byName[entity.name, default: []].append(entity)
        }
        if entity !== root && entity.components.has(ModelComponent.self) {
          meshEntitiesInOrder.append(entity)
        }
        for child in entity.children {
          visit(child, depth: depth + 1)
        }
      }
      visit(root, depth: 0)

      var claimed = Set<ObjectIdentifier>()
      var meshOrder = 0
      for index in 0..<session.nodeCount {
        let hasMesh = session.hasMesh(at: index)
        let myMeshOrder = hasMesh ? meshOrder : -1
        if hasMesh { meshOrder += 1 }

        var candidates: [String] = []
        if let name = session.nodeName(at: index), !name.isEmpty {
          candidates.append(name)
          let prim = XRLiveGLB.usdPrimName(for: name, fallback: name)
          if prim != name { candidates.append(prim) }
          if myMeshOrder >= 0 {
            candidates.append("\(prim)_\(myMeshOrder)")
          }
          candidates.append("\(prim)_p0")
        }
        if let mName = session.meshName(forNode: index), !mName.isEmpty {
          if !candidates.contains(mName) { candidates.append(mName) }
          let prim = XRLiveGLB.usdPrimName(for: mName, fallback: mName)
          if !candidates.contains(prim) { candidates.append(prim) }
        }
        candidates.append("Node_\(index)")
        if myMeshOrder >= 0 {
          candidates.append("Mesh_\(myMeshOrder)")
        }
        candidates.append("Mesh_\(index)")

        var matchedEntity: Entity?
        for candidate in candidates {
          if let entity = byName[candidate]?.first(where: {
            !claimed.contains(ObjectIdentifier($0))
          }) {
            matchedEntity = entity
            break
          }
        }
        if matchedEntity == nil && hasMesh {
          matchedEntity = meshEntitiesInOrder.first(where: {
            !claimed.contains(ObjectIdentifier($0))
          })
        }
        guard let entity = matchedEntity else { continue }
        let id = ObjectIdentifier(entity)
        claimed.insert(id)
        entitiesByNode[index] = entity
        nodeByEntity[id] = index
        let w0 = session.sceneMatrix(of: index)
        let det = simd_determinant(w0)
        if det.isFinite && abs(det) > 1e-12 {
          if Self.isInsideUsdMeshesScope(entity, stopAt: root)
            || Self.isApproximatelyIdentity(entity.transform.matrix)
          {
            inverseBakedSceneByNode[index] = w0.inverse
          }
        }
        if referenceEntity == nil && session.parentIndex(of: index) == nil {
          // The parent of a glTF root node defines the session's scene space.
          referenceEntity = entity.parent ?? root
        }
      }

      // Apply calibrated studio materials (sRGB tint + calibrated metallic factor) to all
      // bound entities immediately so initial colors and reflections match Web and Android.
      // One pass over bound nodes (O(nodes x primitives)) rather than per material.
      for (nodeIndex, entity) in entitiesByNode {
        let primitives = session.materialIndices(forNode: nodeIndex)
        var seen = Set<Int>()
        for materialIndex in primitives where materialIndex >= 0 && seen.insert(materialIndex).inserted {
          guard let state = session.material(at: materialIndex) else { continue }
          recolor(
            entity, state: state, primitives: primitives, materialIndex: materialIndex, depth: 0)
        }
      }
    }

    private static func isInsideUsdMeshesScope(_ entity: Entity, stopAt root: Entity) -> Bool {
      var cur: Entity? = entity.parent
      var depth = 0
      while let p = cur, depth < 64 {
        if p.name == "Meshes" { return true }
        if p === root { break }
        cur = p.parent
        depth += 1
      }
      return false
    }

    private static func isApproximatelyIdentity(_ m: simd_float4x4) -> Bool {
      let id = matrix_identity_float4x4
      for col in 0..<4 {
        let d = simd_abs(m[col] - id[col])
        if d.x > 1e-4 || d.y > 1e-4 || d.z > 1e-4 || d.w > 1e-4 {
          return false
        }
      }
      return true
    }

    /// The entity bound to glTF node `index`, if any.
    public func entity(forNode index: Int) -> Entity? { entitiesByNode[index] }

    /// The glTF node index bound to `entity` or its nearest bound ancestor.
    public func nodeIndex(for entity: Entity) -> Int? {
      var current: Entity? = entity
      var depth = 0
      while let e = current, depth < 256 {
        if let index = nodeByEntity[ObjectIdentifier(e)] { return index }
        current = e.parent
        depth += 1
      }
      return nil
    }

    /// Generates collision shapes and input targets for every bound node that a select
    /// trigger targets, so taps and gaze-pinches can hit them.
    public func installInputTargets() {
      for (index, entity) in entitiesByNode
      where session.isSelectable(index) || session.traits(at: index)?.physics == "dynamic" {
        if !entity.components.has(CollisionComponent.self) {
          entity.generateCollisionShapes(recursive: true)
        }
        #if os(visionOS)
          entity.components.set(InputTargetComponent(allowedInputTypes: .all))
        #elseif os(iOS) && compiler(>=6.0)
          // `InputTargetComponent` ships in the iOS 18 SDK (Xcode 16 / Swift 6 compiler).
          if #available(iOS 18.0, *) {
            entity.components.set(InputTargetComponent(allowedInputTypes: .all))
          }
        #endif
        #if os(visionOS)
          entity.components.set(HoverEffectComponent())
        #endif
      }
    }

    // MARK: Lifecycle

    /// Fires `event/onStart` and, once `root` is in a scene, steps every frame from
    /// `SceneEvents.Update`.
    public func start() {
      session.start()
      applyPendingChanges()
      if let scene = root.scene {
        startUpdates(in: scene)
      }
    }

    /// Steps the session from `scene`'s `SceneEvents.Update`.
    public func startUpdates(in scene: RealityKit.Scene) {
      guard updateSubscription == nil else { return }
      updateSubscription = scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
        self?.step(dt: event.deltaTime)
      }
    }

    /// Stops per-frame updates.
    public func stop() {
      updateSubscription?.cancel()
      updateSubscription = nil
    }

    /// Advances the session by `dt` seconds and applies the resulting changes.
    public func step(dt: TimeInterval) {
      let reference = referenceEntity ?? root
      session.rootTransform = reference.transformMatrix(relativeTo: nil)
      let hands = handsEnabled ? (handSource ?? XRHandJointSources.current()) : nil
      let poses = handPoseProvider?() ?? XRHandJointSources.handPoses(from: hands)
      session.step(dt: dt, headPose: headPoseProvider?(), handPoses: poses)
      if let hands = hands {
        gestureTracker.poll(from: hands) { [weak self] event in
          self?.onGesture?(event)
        }
      }
      applyPendingChanges()
    }

    // MARK: Input

    /// Dispatches a select on the node bound to `entity` (or its nearest bound ancestor).
    /// Returns `false` when the entity belongs to no bound node.
    @discardableResult
    public func handleTap(on entity: Entity, hitPoint: SIMD3<Float>? = nil) -> Bool {
      guard let index = nodeIndex(for: entity) else { return false }
      // Entity names are glTF node names, not mesh names, so no `meshName` filter applies.
      session.dispatchSelect(nodeIndex: index, hitPoint: hitPoint, meshName: nil)
      applyPendingChanges()
      return true
    }

    /// Dispatches hover enter / exit on the node bound to `entity`.
    @discardableResult
    public func handleHover(on entity: Entity, hovered: Bool) -> Bool {
      guard let index = nodeIndex(for: entity) else { return false }
      session.dispatchHover(nodeIndex: index, hovered: hovered)
      applyPendingChanges()
      return true
    }

    #if os(iOS) || os(macOS)
      /// Hit-tests `point` in `arView` and dispatches a select on the nearest hit entity.
      @discardableResult
      public func handleTap(at point: CGPoint, in arView: ARView) -> Bool {
        guard let hit = arView.hitTest(point, query: .nearest, mask: .all).first else {
          return false
        }
        return handleTap(on: hit.entity, hitPoint: hit.position)
      }
    #endif

    /// Dispatches a custom `event/receive` event into the behavior graph.
    public func sendEvent(_ id: String, payload: [String: Any] = [:]) {
      session.sendEvent(id, payload: payload)
      applyPendingChanges()
    }

    /// Sets a node's local transform in both the session and RealityKit (e.g. from a
    /// `ManipulationHandles.Drag` update or a system gesture).
    public func setNodeTransform(_ index: Int, _ transform: XRNodeTransform) {
      guard session.setNodeTransform(index, transform) else { return }
      applyEntityTransform(forNode: index, fallback: transform)
      if !inverseBakedSceneByNode.isEmpty {
        updateBakedDescendants(of: index)
      }
    }

    /// Shows or hides the built-in 3D AR surface placement reticle and reference floor grid
    /// at height `groundY` (meters) for in-app AR surface placement previews when camera-based
    /// AR Quick Look is unavailable (e.g. on the iOS Simulator).
    public func setArSurfacePreviewEnabled(_ enabled: Bool, groundY: Float = -0.95) {
      arSurfacePreviewContainer?.removeFromParent()
      arSurfacePreviewContainer = nil
      guard enabled else { return }

      let container = Entity()
      container.name = "ThreeLiveArSurfacePreview"
      let gridGeo = XRArSurfaceGeometry.buildFloorGridGeometry(
        y: groundY - 0.01, halfExtent: 2.0, divisions: 8)
      if let gridMesh = XRBlocksRealityKitFeatures.mesh(gridGeo) {
        let gridEntity = ModelEntity(
          mesh: gridMesh,
          materials: [XRBlocksRealityKitFeatures.material(XRArSurfaceGeometry.defaultGridColor)])
        gridEntity.name = "ThreeLiveArFloorGrid"
        container.addChild(gridEntity)
      }
      let reticleGeo = XRArSurfaceGeometry.buildReticleGeometry(
        y: groundY, innerRadius: 0.52, outerRadius: 0.60)
      if let reticleMesh = XRBlocksRealityKitFeatures.mesh(reticleGeo) {
        let reticleEntity = ModelEntity(
          mesh: reticleMesh,
          materials: [XRBlocksRealityKitFeatures.material(XRArSurfaceGeometry.defaultReticleColor)])
        reticleEntity.name = "ThreeLiveArReticle"
        container.addChild(reticleEntity)
      }
      root.addChild(container)
      arSurfacePreviewContainer = container
    }

    // MARK: Applying changes

    /// Applies buffered session changes to RealityKit.
    public func applyPendingChanges() {
      let transforms = collector.transforms
      let visibility = collector.visibility
      let materials = collector.materials
      let events = collector.events
      let animations = collector.animations
      collector.transforms.removeAll()
      collector.visibility.removeAll()
      collector.materials.removeAll()
      collector.events.removeAll()
      collector.animations.removeAll()

      var changedNodes = Set<Int>()
      for (index, t) in transforms {
        changedNodes.insert(index)
        applyEntityTransform(forNode: index, fallback: t)
      }
      if !inverseBakedSceneByNode.isEmpty && !changedNodes.isEmpty {
        for index in entitiesByNode.keys where !changedNodes.contains(index) {
          if hasChangedAncestor(index, in: changedNodes) {
            if let t = session.nodeTransform(at: index) {
              applyEntityTransform(forNode: index, fallback: t)
            }
          }
        }
      }
      for (index, visible) in visibility {
        entitiesByNode[index]?.isEnabled = visible
      }
      for (materialIndex, state) in materials {
        applyMaterial(materialIndex, state)
      }
      for (id, payload) in events {
        onInteractivityEvent?(id, payload)
      }
      for request in animations {
        switch request {
        case .start(let index, let name):
          if let handler = onAnimationStart {
            handler(index, name)
          } else {
            playAnimation(index: index, name: name)
          }
        case .stop:
          if let handler = onAnimationStop {
            handler()
          } else {
            root.stopAllAnimations(recursive: true)
          }
        }
      }
    }

    private func applyEntityTransform(forNode index: Int, fallback t: XRNodeTransform) {
      guard let entity = entitiesByNode[index] else { return }
      if let invW0 = inverseBakedSceneByNode[index] {
        let delta = session.sceneMatrix(of: index) * invW0
        let trs = XRBlocksMath.decompose(delta)
        entity.transform = Transform(
          scale: trs.scale, rotation: trs.rotation, translation: trs.translation)
      } else {
        entity.transform = Transform(
          scale: t.scale, rotation: t.rotation, translation: t.translation)
      }
    }

    private func hasChangedAncestor(_ index: Int, in changedNodes: Set<Int>) -> Bool {
      var cur = session.parentIndex(of: index)
      var depth = 0
      while let p = cur, depth < 128 {
        if changedNodes.contains(p) { return true }
        cur = session.parentIndex(of: p)
        depth += 1
      }
      return false
    }

    private func updateBakedDescendants(of ancestor: Int) {
      let changed: Set<Int> = [ancestor]
      for index in entitiesByNode.keys where index != ancestor {
        if hasChangedAncestor(index, in: changed), let t = session.nodeTransform(at: index) {
          applyEntityTransform(forNode: index, fallback: t)
        }
      }
    }

    private func playAnimation(index: Int?, name: String?) {
      let available = root.availableAnimations
      var chosen: AnimationResource?
      if let i = index, i >= 0, i < available.count {
        chosen = available[i]
      } else if let name = name {
        chosen = available.first { $0.definition.name == name }
      }
      if let animation = chosen {
        _ = root.playAnimation(animation, transitionDuration: 0.2, startsPaused: false)
      }
    }

    private func applyMaterial(_ materialIndex: Int, _ state: XRMaterialState) {
      for (nodeIndex, entity) in entitiesByNode {
        let primitives = session.materialIndices(forNode: nodeIndex)
        guard primitives.contains(materialIndex) else { continue }
        recolor(entity, state: state, primitives: primitives, materialIndex: materialIndex, depth: 0)
      }
    }

    private func recolor(
      _ entity: Entity, state: XRMaterialState, primitives: [Int], materialIndex: Int, depth: Int
    ) {
      if var model = entity.components[ModelComponent.self] {
        let count = model.materials.count
        for k in 0..<count {
          // USDZ subsets follow primitive order; when counts differ recolor every slot.
          let applies = primitives.count == count ? primitives[k] == materialIndex : true
          if applies {
            model.materials[k] = Self.recolored(model.materials[k], state)
          }
        }
        entity.components.set(model)
      }
      guard depth < 4 else { return }
      for child in entity.children where nodeByEntity[ObjectIdentifier(child)] == nil {
        recolor(
          child, state: state, primitives: primitives, materialIndex: materialIndex,
          depth: depth + 1)
      }
    }

    private static let studioMetallicScale: Float = 0.38

    /// Compiled scenes carry Three.js hex colors as sRGB `hex / 255` factors, which
    /// `XRPlatformColor(red:green:blue:alpha:)` (`UIColor` / `NSColor`) expects directly and
    /// RealityKit linearizes internally, so components are only clamped here.
    private static func srgbComponent(_ value: Float) -> CGFloat {
      let c = max(0, min(1, value.isFinite ? value : 0))
      return CGFloat(c)
    }

    private static func effectiveMetallic(_ metallic: Float) -> Float {
      guard metallic.isFinite else { return 0 }
      return max(0, min(1, metallic * studioMetallicScale))
    }

    private static func platformColor(_ c: SIMD4<Float>) -> XRPlatformColor {
      let alpha = CGFloat(max(0, min(1, c.w.isFinite ? c.w : 1)))
      return XRPlatformColor(
        red: srgbComponent(c.x), green: srgbComponent(c.y), blue: srgbComponent(c.z), alpha: alpha)
    }

    private static func recolored(_ material: Material, _ state: XRMaterialState) -> Material {
      let base = platformColor(state.baseColorFactor)
      let calMetallic = effectiveMetallic(state.metallicFactor)
      let calRoughness = max(0.04, min(1, state.roughnessFactor.isFinite ? state.roughnessFactor : 0.5))
      if var pbr = material as? PhysicallyBasedMaterial {
        pbr.baseColor = PhysicallyBasedMaterial.BaseColor(tint: base, texture: pbr.baseColor.texture)
        pbr.metallic = PhysicallyBasedMaterial.Metallic(floatLiteral: calMetallic)
        pbr.roughness = PhysicallyBasedMaterial.Roughness(floatLiteral: calRoughness)
        let e = state.emissiveFactor
        pbr.emissiveColor = PhysicallyBasedMaterial.EmissiveColor(
          color: platformColor(SIMD4<Float>(e.x, e.y, e.z, 1)), texture: pbr.emissiveColor.texture)
        // Only alpha-masked materials carry a threshold; leave blended / opaque ones alone.
        if pbr.opacityThreshold != nil {
          pbr.opacityThreshold = max(0, min(1, state.alphaCutoff))
        }
        return pbr
      }
      if var simple = material as? SimpleMaterial {
        simple.color = SimpleMaterial.BaseColor(tint: base, texture: simple.color.texture)
        simple.metallic = .float(calMetallic)
        simple.roughness = .float(calRoughness)
        return simple
      }
      if var unlit = material as? UnlitMaterial {
        unlit.color = UnlitMaterial.BaseColor(tint: base, texture: unlit.color.texture)
        return unlit
      }
      // Leave other material kinds (e.g. ShaderGraph / custom materials) untouched: replacing them
      // would silently drop their textures, shader graphs, and blending settings.
      return material
    }
  }
#endif
