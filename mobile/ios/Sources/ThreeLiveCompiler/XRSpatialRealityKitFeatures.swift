// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Native spatial features on RealityKit: manipulation handles, spatial paint and depth
// particles, driven by world-space pointer rays from the host (ARView touches on iOS,
// DragGesture / spatial events on visionOS). Same math and event details as the web plugins.

#if canImport(RealityKit) && !os(tvOS)
  import Combine
  import CoreGraphics
  import Foundation
  import RealityKit
  import simd
  #if canImport(Metal)
    import Metal
  #endif

  @MainActor
  public final class XRSpatialRealityKitFeatures {
    /// `{mesh, scale, yawDeg}` when a handle drag ends (web `xr-handles-change`).
    public var onHandlesChange: ((_ mesh: String, _ scale: Float, _ yawDeg: Float) -> Void)?
    /// `{index, points, lengthMeters}` when a stroke ends (web `xr-paint-stroke`).
    public var onPaintStroke: ((_ index: Int, _ points: Int, _ lengthMeters: Float) -> Void)?
    /// `{start, end, distanceMeters, formatted}` when a tape segment ends (web `measurecomplete`).
    public var onMeasureComplete:
      (
        (
          _ start: SIMD3<Float>, _ end: SIMD3<Float>, _ distanceMeters: Float,
          _ formatted: String
        ) -> Void
      )?
    /// `{nodeIndex, socketNodeIndex, position, orientation, mode}` when a node snaps (`xrsnap`).
    public var onSnap:
      (
        (
          _ nodeIndex: Int, _ socketNodeIndex: Int?, _ position: SIMD3<Float>,
          _ orientation: simd_quatf, _ mode: String
        ) -> Void
      )?
    /// `{nodeIndex, socketNodeIndex}` when a snapped node breaks away (`xrunsnap`).
    public var onUnsnap: ((_ nodeIndex: Int, _ socketNodeIndex: Int?) -> Void)?
    /// Paint color, or `nil` to disable spatial paint (the default).
    public var paintColor: SIMD4<Float>?
    /// Optional floor height (world meters) particles collide with.
    public var floorY: Float?
    /// Scene-wide bounding-box dimension callout toggle (`<xr-live spatial-measure>`).
    public var measureBoundsEnabled: Bool = false
    /// Interactive point-to-point tape measure toggle (`<xr-live spatial-measure="tape">`).
    public var tapeMeasureEnabled: Bool = false
    /// Default unit (`"auto"`, `"m"`, `"cm"`, `"mm"`, `"in"`, `"ft-in"`) for `spatial-measure`.
    public var measureUnit: String = "auto"
    /// Currently selected node index (used by `dimensions.showOnSelect`).
    public var selectedNodeIndex: Int = -1
    /// Camera world transform for camera-facing particles (defaults to the live head pose).
    public var cameraTransformProvider: (() -> simd_float4x4?)?

    public static let maxStrokes = 256
    public static let screenPaintDepth: Float = 0.4
    /// At most 15 Hz depth re-sort cadence for splats.
    public nonisolated static let splatResortMinInterval: TimeInterval = 1.0 / 15.0

    private let live: XRLiveRealityKitSession
    private let container = Entity()

    private struct HandleNode {
      let node: Int
      let options: XRLiveHandles
      let localMin: SIMD3<Float>
      let localMax: SIMD3<Float>
      let visuals: [ModelEntity]
    }

    private struct Emitter {
      let node: Int
      let emitter: ParticleEmitter
      let entity: ModelEntity
    }

    private struct Stroke {
      var builder: TubeStrokeBuilder
      let entity: ModelEntity
      let index: Int
    }

    private struct ContactShadowNode {
      let node: Int
      let name: String
      let localCenter: SIMD3<Float>
      let localHalfExtents: SIMD3<Float>
      let entity: ModelEntity
    }

    private final class SplatCloud {
      let node: Int
      let url: URL
      let entity: ModelEntity
      var data: SplatData?
      var staticGpuGeometry: SplatParser.QuadGeometry?
      var pendingGeometry: SplatParser.QuadGeometry?
      var pendingIndices: [UInt32]?
      var lowLevelMeshBox: AnyObject?
      var sorting: Bool = false
      var lastCameraWorld: simd_float4x4?
      var lastNodeWorld: simd_float4x4?
      var sinceLastSort: TimeInterval = XRSpatialRealityKitFeatures.splatResortMinInterval
      var loadTask: Task<Void, Never>?

      init(node: Int, url: URL, entity: ModelEntity) {
        self.node = node
        self.url = url
        self.entity = entity
      }
    }

    private final class DimensionVisual {
      let node: Int
      let trait: XRLiveDimensions?
      var barEntity: ModelEntity?
      var labelEntities: [ModelEntity] = []
      var labelPositions: [SIMD3<Float>] = []
      var cacheKey: String = ""

      init(node: Int, trait: XRLiveDimensions?) {
        self.node = node
        self.trait = trait
      }
    }

    private final class TapeVisual {
      let start: SIMD3<Float>
      var end: SIMD3<Float>
      let lineEntity: ModelEntity
      let labelEntity: ModelEntity

      init(
        start: SIMD3<Float>, end: SIMD3<Float>, lineEntity: ModelEntity, labelEntity: ModelEntity
      ) {
        self.start = start
        self.end = end
        self.lineEntity = lineEntity
        self.labelEntity = labelEntity
      }
    }

    private var handles: [HandleNode] = []
    private var emitters: [Emitter] = []
    private var strokes: [Stroke] = []
    private var splats: [SplatCloud] = []
    private var contactShadows: [ContactShadowNode] = []
    private var dimensionVisuals: [Int: DimensionVisual] = [:]
    private var dimensionNodeOrder: [Int] = []
    private var tapeSegments: [TapeVisual] = []
    private var activeTape: TapeVisual?
    private var snapTraits: [Int: XRLiveSnapTo] = [:]
    private var socketTraits: [Int: XRLiveSnapSocket] = [:]
    private var activeSocketByNode: [Int: String] = [:]
    private var previewRingEntity: ModelEntity?
    private var previewRingRadius: Float = 0
    private var previewRingColor: String = ""
    private var pulsePhase: Float = 0
    private var gaussianTexture: TextureResource?
    private var customSplatMaterial: RealityKit.Material?
    private var customSplatMaterialChecked = false
    private var drag: (node: Int, drag: ManipulationHandles.Drag)?
    private var painting: Int?
    private var strokeCount = 0
    private var updateSubscription: Combine.Cancellable?

    public init(
      live: XRLiveRealityKitSession,
      baseURL: String? = nil,
      allowRemoteSplats: Bool = false,
      maxSplats: Int? = nil
    ) {
      self.live = live
      container.name = "XRSpatialFeatures"
      live.root.addChild(container)
      let useGpuBillboard = Self.probeGpuBillboardMaterial(
        into: &customSplatMaterial, checked: &customSplatMaterialChecked)
      let effectiveMaxSplats =
        maxSplats
        ?? (useGpuBillboard ? SplatParser.defaultMaxGpuSplats : SplatParser.defaultMaxCpuSplats)
      let session = live.session
      let shadowMesh = Self.makeContactShadowMesh()
      let shadowMaterial = Self.makeContactShadowMaterial()
      for i in 0..<session.nodeCount {
        if session.hasMesh(at: i), let shadowMesh = shadowMesh, let shadowMaterial = shadowMaterial
        {
          let resolvedBounds: (min: SIMD3<Float>, max: SIMD3<Float>)?
          if let glbBounds = session.localBounds(forNode: i) {
            resolvedBounds = glbBounds
          } else if let entity = live.entity(forNode: i) {
            let vb = entity.visualBounds(recursive: true, relativeTo: entity)
            resolvedBounds = vb.isEmpty ? nil : (min: vb.min, max: vb.max)
          } else {
            resolvedBounds = nil
          }
          if let bounds = resolvedBounds {
            let center = (bounds.min + bounds.max) * 0.5
            let half = (bounds.max - bounds.min) * 0.5
            if half.x > 1e-4 || half.y > 1e-4 || half.z > 1e-4 {
              let shadowEntity = ModelEntity(mesh: shadowMesh, materials: [shadowMaterial])
              shadowEntity.name = "ThreeLiveContactShadow_\(i)"
              container.addChild(shadowEntity)
              let name = session.nodeName(at: i) ?? session.meshName(forNode: i) ?? ""
              contactShadows.append(
                ContactShadowNode(
                  node: i, name: name, localCenter: center, localHalfExtents: half,
                  entity: shadowEntity))
            }
          }
        }
        guard let traits = session.traits(at: i) else { continue }
        if let h = traits.handles, let entity = live.entity(forNode: i) {
          let resolvedBounds: (min: SIMD3<Float>, max: SIMD3<Float>)?
          if let glbBounds = session.localBounds(forNode: i) {
            resolvedBounds = glbBounds
          } else {
            let vb = entity.visualBounds(recursive: true, relativeTo: entity)
            resolvedBounds = vb.isEmpty ? nil : (min: vb.min, max: vb.max)
          }
          if let bounds = resolvedBounds {
            let material = UnlitMaterial(color: .white)
            var visuals: [ModelEntity] = []
            for _ in 0..<5 {
              let m = ModelEntity(mesh: .generateBox(size: 1), materials: [material])
              container.addChild(m)
              visuals.append(m)
            }
            handles.append(
              HandleNode(
                node: i, options: h, localMin: bounds.min, localMax: bounds.max, visuals: visuals))
          }
        }
        if let p = traits.particles, emitters.count < ParticleEmitter.maxEmitters {
          let emitter = ParticleEmitter(options: p, seed: UInt32(i + 1))
          let world = session.worldMatrix(of: i)
          emitter.reset(
            center: SIMD3<Float>(world.columns.3.x, world.columns.3.y, world.columns.3.z))
          let entity = ModelEntity()
          container.addChild(entity)
          emitters.append(Emitter(node: i, emitter: emitter, entity: entity))
        }
        if let rawSplat = traits.splatUrl,
          let resolved = SplatParser.resolveSplatURL(
            rawSplat, baseURL: baseURL, allowCrossOrigin: allowRemoteSplats)
        {
          let entity = ModelEntity()
          container.addChild(entity)
          let cloud = SplatCloud(node: i, url: resolved, entity: entity)
          cloud.loadTask = Task { @MainActor [weak cloud] in
            let result = await Task.detached(priority: .utility) {
              () -> (SplatData, SplatParser.QuadGeometry?)? in
              guard
                let loaded = try? await SplatParser.loadURL(
                  resolved.absoluteString, baseURL: baseURL, allowCrossOrigin: allowRemoteSplats)
              else { return nil }
              let sampled = SplatParser.downsample(loaded, maxSplats: effectiveMaxSplats)
              let staticGpu =
                useGpuBillboard ? SplatParser.buildStaticGpuSplatVertices(sampled) : nil
              return (sampled, staticGpu)
            }.value
            guard let (sampled, staticGpu) = result else { return }
            cloud?.staticGpuGeometry = staticGpu
            cloud?.data = sampled
          }
          splats.append(cloud)
        }
        if let dim = traits.dimensions, dim.enabled {
          dimensionVisuals[i] = DimensionVisual(node: i, trait: dim)
          dimensionNodeOrder.append(i)
        }
        if let st = traits.snapTo {
          snapTraits[i] = st
        }
        if let ss = traits.snapSocket {
          socketTraits[i] = ss
        }
      }
      for h in handles { place(h) }
      stepContactShadows()
    }

    /// Number of nodes with handles.
    public var handleCount: Int { handles.count }

    /// Number of accepted `splatUrl` clouds.
    public var splatCount: Int { splats.count }

    /// Number of nodes configured with `dimensions` callouts.
    public var dimensionCount: Int { dimensionVisuals.count }

    /// Number of nodes configured as `snapSocket` targets.
    public var snapSocketCount: Int { socketTraits.count }

    /// Steps handles and particles from `scene`'s update events.
    public func startUpdates(in scene: RealityKit.Scene) {
      guard updateSubscription == nil else { return }
      updateSubscription = scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
        self?.step(dt: event.deltaTime)
      }
    }

    /// Clears all locked and active tape-measure segments.
    public func clearMeasurements() {
      if let active = activeTape {
        active.lineEntity.removeFromParent()
        active.labelEntity.removeFromParent()
        activeTape = nil
      }
      for seg in tapeSegments {
        seg.lineEntity.removeFromParent()
        seg.labelEntity.removeFromParent()
      }
      tapeSegments.removeAll()
    }

    /// Removes every feature entity and stops updates.
    public func dispose() {
      updateSubscription?.cancel()
      updateSubscription = nil
      for sc in splats { sc.loadTask?.cancel() }
      clearMeasurements()
      previewRingEntity?.removeFromParent()
      previewRingEntity = nil
      container.removeFromParent()
      handles.removeAll()
      emitters.removeAll()
      strokes.removeAll()
      splats.removeAll()
      contactShadows.removeAll()
      dimensionVisuals.removeAll()
      dimensionNodeOrder.removeAll()
      snapTraits.removeAll()
      socketTraits.removeAll()
      activeSocketByNode.removeAll()
    }

    // MARK: Pointer input (world-space rays)

    /// A pointer went down. Returns `true` when a handle or a paint stroke captured it; the host
    /// should then route moves here instead of orbiting the camera.
    @discardableResult
    public func pointerDown(origin: SIMD3<Float>, direction: SIMD3<Float>, hitEntity: Entity?)
      -> Bool
    {
      let session = live.session
      for h in handles {
        guard let layout = handleLayout(for: h), let t = session.nodeTransform(at: h.node),
          let dir = ManipulationHandles.normalizeRay(direction),
          let hit = ManipulationHandles.pick(
            layout: layout, rayOrigin: origin, rayDirection: dir, options: h.options),
          let d = ManipulationHandles.Drag(
            layout: layout, hit: hit, rayOrigin: origin, rayDirection: dir, startScale: t.scale,
            startRotation: t.rotation, options: h.options)
        else { continue }
        drag = (h.node, d)
        return true
      }
      if tapeMeasureEnabled && paintColor == nil {
        guard let pt = tapePoint(origin: origin, direction: direction) else { return false }
        beginTape(pt)
        return true
      }
      guard let color = paintColor, hitEntity.flatMap({ live.nodeIndex(for: $0) }) == nil,
        let dir = ManipulationHandles.normalizeRay(direction)
      else { return false }
      if strokes.count >= Self.maxStrokes {
        strokes.removeFirst().entity.removeFromParent()
      }
      let entity = ModelEntity()
      entity.components.set(
        ModelComponent(mesh: .generateBox(size: 0.001), materials: [Self.material(color)]))
      container.addChild(entity)
      var stroke = Stroke(builder: TubeStrokeBuilder(), entity: entity, index: strokeCount)
      strokeCount += 1
      _ = stroke.builder.addPoint(origin + dir * Self.screenPaintDepth)
      strokes.append(stroke)
      painting = strokes.count - 1
      return true
    }

    /// A captured pointer moved.
    public func pointerMove(origin: SIMD3<Float>, direction: SIMD3<Float>) {
      if let active = drag {
        guard let t = live.session.nodeTransform(at: active.node),
          let next = active.drag.update(rayOrigin: origin, rayDirection: direction)
        else { return }
        live.setNodeTransform(
          active.node,
          XRNodeTransform(translation: t.translation, rotation: next.rotation, scale: next.scale))
        return
      }
      if activeTape != nil {
        if let pt = tapePoint(origin: origin, direction: direction) {
          updateTape(pt)
        }
        return
      }
      guard let i = painting, i < strokes.count,
        let dir = ManipulationHandles.normalizeRay(direction),
        strokes[i].builder.points.count < TubeStrokeBuilder.maxStrokePoints
      else { return }
      if strokes[i].builder.addPoint(origin + dir * Self.screenPaintDepth),
        strokes[i].builder.points.count % 3 == 0
      {
        rebuild(i)
      }
    }

    /// A captured pointer was released.
    public func pointerUp() {
      if let active = drag {
        drag = nil
        if let t = live.session.nodeTransform(at: active.node) {
          let yaw = XRSpatialMath.yawFromQuat(t.rotation) * 180 / .pi
          onHandlesChange?(live.session.nodeName(at: active.node) ?? "", t.scale.x, yaw)
        }
        return
      }
      if activeTape != nil {
        endTape()
        return
      }
      guard let i = painting, i < strokes.count else { return }
      painting = nil
      rebuild(i)
      let s = strokes[i]
      onPaintStroke?(s.index, s.builder.points.count, s.builder.lengthMeters)
    }

    #if os(iOS)
      /// Convenience for ARView: builds the world ray for a view point and forwards it.
      @discardableResult
      public func pointerDown(at point: CGPoint, in arView: ARView) -> Bool {
        guard let ray = arView.ray(through: point) else { return false }
        return pointerDown(
          origin: ray.origin, direction: ray.direction, hitEntity: arView.entity(at: point))
      }

      public func pointerMove(at point: CGPoint, in arView: ARView) {
        guard let ray = arView.ray(through: point) else { return }
        pointerMove(origin: ray.origin, direction: ray.direction)
      }
    #endif

    // MARK: Per frame

    /// Repositions handles, contact shadows, dimension callouts, and steps particles.
    public func step(dt: TimeInterval) {
      let dtClamped = Float(max(0, min(0.1, dt.isFinite ? dt : 0)))
      pulsePhase += dtClamped * 5.0
      for h in handles { place(h) }
      stepContactShadows()
      let camera: simd_float4x4
      if let provided = cameraTransformProvider?() {
        camera = provided
      } else if let pose = live.headPoseProvider?() {
        camera = XRSpatialMath.compose(
          translation: pose.position, rotation: pose.orientation, scale: SIMD3<Float>(1, 1, 1))
      } else {
        camera = matrix_identity_float4x4
      }
      for e in emitters { stepEmitter(e, dt: dt, camera: camera) }
      for sc in splats { stepSplat(sc, dt: dt, camera: camera) }
      stepDimensions(camera: camera)
    }

    // MARK: Spatial Measure & Magnetic Snap

    private func tapePoint(origin: SIMD3<Float>, direction: SIMD3<Float>) -> SIMD3<Float>? {
      guard let dir = ManipulationHandles.normalizeRay(direction) else { return nil }
      if dir.y < -1e-4 {
        let fy = floorY ?? 0
        let t = (fy - origin.y) / dir.y
        if t >= 0.02 && t <= 20.0 {
          return origin + dir * t
        }
      }
      return origin + dir
    }

    /// Begins an interactive tape-measure segment at `start`.
    public func beginTape(_ start: SIMD3<Float>) {
      if let prev = activeTape {
        prev.lineEntity.removeFromParent()
        prev.labelEntity.removeFromParent()
      }
      let lineEntity = ModelEntity()
      let labelEntity = ModelEntity()
      container.addChild(lineEntity)
      container.addChild(labelEntity)
      let lblGeo = SpatialMeasure.buildVectorLabelGeometry(
        SpatialMeasure.formatDimension(0, unit: measureUnit))
      if let mesh = Self.mesh(lblGeo) {
        labelEntity.model = ModelComponent(
          mesh: mesh, materials: [Self.material(SIMD4<Float>(0.97, 0.98, 0.99, 1))])
      }
      activeTape = TapeVisual(
        start: start, end: start, lineEntity: lineEntity, labelEntity: labelEntity)
    }

    /// Updates the endpoint of the active tape-measure segment.
    public func updateTape(_ end: SIMD3<Float>) {
      guard let t = activeTape else { return }
      t.end = end
      let dist = simd_length(t.end - t.start)
      let barGeo = SpatialMeasure.buildSegmentBarsGeometry(
        [(t.start, t.end)], halfThickness: 0.0022)
      let lblGeo = SpatialMeasure.buildVectorLabelGeometry(
        SpatialMeasure.formatDimension(dist, unit: measureUnit))
      if let bMesh = Self.mesh(barGeo) {
        if t.lineEntity.model == nil {
          t.lineEntity.model = ModelComponent(
            mesh: bMesh, materials: [Self.material(Self.parseHexRgba("#38bdf8"))])
        } else {
          t.lineEntity.model?.mesh = bMesh
        }
      }
      if let lMesh = Self.mesh(lblGeo) {
        if t.labelEntity.model == nil {
          t.labelEntity.model = ModelComponent(
            mesh: lMesh, materials: [Self.material(SIMD4<Float>(0.97, 0.98, 0.99, 1))])
        } else {
          t.labelEntity.model?.mesh = lMesh
        }
      }
    }

    /// Completes the active tape-measure segment and notifies `onMeasureComplete`.
    public func endTape() {
      guard let t = activeTape else { return }
      activeTape = nil
      let dist = simd_length(t.end - t.start)
      if dist < 0.002 {
        t.lineEntity.removeFromParent()
        t.labelEntity.removeFromParent()
        return
      }
      if tapeSegments.count >= SpatialMeasure.maxTapeSegments {
        let old = tapeSegments.removeFirst()
        old.lineEntity.removeFromParent()
        old.labelEntity.removeFromParent()
      }
      tapeSegments.append(t)
      let formatted = SpatialMeasure.formatDimension(dist, unit: measureUnit)
      onMeasureComplete?(t.start, t.end, dist, formatted)
    }

    private func resolvedNodeBounds(_ node: Int) -> (min: SIMD3<Float>, max: SIMD3<Float>)? {
      if let glb = live.session.localBounds(forNode: node) { return glb }
      if let entity = live.entity(forNode: node) {
        let vb = entity.visualBounds(recursive: true, relativeTo: entity)
        if !vb.isEmpty { return (min: vb.min, max: vb.max) }
      }
      return nil
    }

    private func stepDimensions(camera: simd_float4x4) {
      let session = live.session
      if measureBoundsEnabled {
        for n in 0..<session.nodeCount where dimensionVisuals[n] == nil {
          if resolvedNodeBounds(n) != nil {
            dimensionVisuals[n] = DimensionVisual(node: n, trait: nil)
            dimensionNodeOrder.append(n)
          }
        }
      }
      var activeLabels = 0
      for node in dimensionNodeOrder {
        guard let dv = dimensionVisuals[node] else { continue }
        let cfg =
          dv.trait ?? (measureBoundsEnabled ? XRLiveDimensions(unit: measureUnit) : nil)
        let localBounds = resolvedNodeBounds(node)
        let show =
          cfg != nil && localBounds != nil && session.isEffectivelyVisible(node)
          && (!(cfg?.showOnSelect ?? false) || selectedNodeIndex == node)
        guard show, let cfg = cfg, let lb = localBounds else {
          dv.barEntity?.isEnabled = false
          for le in dv.labelEntities { le.isEnabled = false }
          continue
        }
        let wb = SpatialMeasure.computeWorldBounds(
          localMin: lb.min, localMax: lb.max, world: session.worldMatrix(of: node))
        let unit = (cfg.unit == "auto" && measureUnit != "auto") ? measureUnit : cfg.unit
        let key =
          "\(Int((wb.min.x * 1000).rounded())),\(Int((wb.min.y * 1000).rounded())),\(Int((wb.min.z * 1000).rounded()))|"
          + "\(Int((wb.max.x * 1000).rounded())),\(Int((wb.max.y * 1000).rounded())),\(Int((wb.max.z * 1000).rounded()))|"
          + "\(unit)|\(cfg.axes.joined())|\(cfg.color)"
        if key != dv.cacheKey {
          dv.cacheKey = key
          let callouts = SpatialMeasure.buildDimensionCallouts(
            min: wb.min, max: wb.max, axes: cfg.axes)
          var segs: [(SIMD3<Float>, SIMD3<Float>)] = []
          segs.reserveCapacity(callouts.count * 3)
          for c in callouts {
            segs.append((c.start, c.end))
            segs.append((c.tickStartA, c.tickStartB))
            segs.append((c.tickEndA, c.tickEndB))
          }
          let barGeo = SpatialMeasure.buildSegmentBarsGeometry(segs, halfThickness: 0.002)
          let mat = Self.material(Self.parseHexRgba(cfg.color))
          if let bMesh = Self.mesh(barGeo) {
            if let existing = dv.barEntity {
              existing.model = ModelComponent(mesh: bMesh, materials: [mat])
            } else {
              let be = ModelEntity(mesh: bMesh, materials: [mat])
              container.addChild(be)
              dv.barEntity = be
            }
          }
          let allowed = max(
            0, min(callouts.count, SpatialMeasure.maxDimensionLabels - activeLabels))
          while dv.labelEntities.count > allowed {
            dv.labelEntities.removeLast().removeFromParent()
          }
          dv.labelPositions.removeAll(keepingCapacity: true)
          for i in 0..<allowed {
            let c = callouts[i]
            let lGeo = SpatialMeasure.buildVectorLabelGeometry(
              SpatialMeasure.formatDimension(c.lengthMeters, unit: unit))
            if let lMesh = Self.mesh(lGeo) {
              if i < dv.labelEntities.count {
                dv.labelEntities[i].model = ModelComponent(mesh: lMesh, materials: [mat])
              } else {
                let le = ModelEntity(mesh: lMesh, materials: [mat])
                container.addChild(le)
                dv.labelEntities.append(le)
              }
              dv.labelPositions.append(c.labelPosition)
            }
          }
        }
        activeLabels += dv.labelEntities.count
        if let be = dv.barEntity {
          be.isEnabled = true
          be.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
        }
        for (i, le) in dv.labelEntities.enumerated() where i < dv.labelPositions.count {
          le.isEnabled = true
          le.setTransformMatrix(
            Self.billboardTransform(at: dv.labelPositions[i], camera: camera), relativeTo: nil)
        }
      }
      for seg in tapeSegments { positionTape(seg, camera: camera) }
      if let active = activeTape { positionTape(active, camera: camera) }
    }

    private func positionTape(_ t: TapeVisual, camera: simd_float4x4) {
      t.lineEntity.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
      let mid = (t.start + t.end) * 0.5 + SIMD3<Float>(0, 0.035, 0)
      t.labelEntity.setTransformMatrix(
        Self.billboardTransform(at: mid, camera: camera), relativeTo: nil)
    }

    private static func billboardTransform(at pos: SIMD3<Float>, camera: simd_float4x4)
      -> simd_float4x4
    {
      let camPos = SIMD3<Float>(camera.columns.3.x, camera.columns.3.y, camera.columns.3.z)
      let d = camPos - pos
      let horiz = hypot(d.x, d.z)
      let yaw = atan2(d.x, d.z)
      let pitch = -atan2(d.y, max(horiz, 1e-5))
      let q = MagneticSnap.quatFromEulerYXZ(pitchX: pitch, yawY: yaw, rollZ: 0)
      return XRSpatialMath.compose(translation: pos, rotation: q, scale: SIMD3<Float>(1, 1, 1))
    }

    private static func parseHexRgba(_ hex: String, alpha: Float = 1) -> SIMD4<Float> {
      let clean = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
      if clean.count == 3 {
        let chars = Array(clean)
        guard let r = Int(String(chars[0]), radix: 16),
          let g = Int(String(chars[1]), radix: 16),
          let b = Int(String(chars[2]), radix: 16)
        else { return SIMD4<Float>(0.22, 0.74, 0.97, alpha) }
        return SIMD4<Float>(Float(r * 17) / 255, Float(g * 17) / 255, Float(b * 17) / 255, alpha)
      }
      if clean.count == 6 {
        let rStr = String(clean.prefix(2))
        let gStr = String(clean.dropFirst(2).prefix(2))
        let bStr = String(clean.dropFirst(4).prefix(2))
        guard let r = Int(rStr, radix: 16),
          let g = Int(gStr, radix: 16),
          let b = Int(bStr, radix: 16)
        else { return SIMD4<Float>(0.22, 0.74, 0.97, alpha) }
        return SIMD4<Float>(Float(r) / 255, Float(g) / 255, Float(b) / 255, alpha)
      }
      return SIMD4<Float>(0.22, 0.74, 0.97, alpha)
    }

    /// Evaluates and applies `magnetic-snap` constraints for a manipulated node, updating its pose,
    /// preview torus ring, and firing `onSnap` / `onUnsnap`.
    @discardableResult
    public func applyMagneticSnap(
      nodeIndex: Int,
      rawWorldPosition: SIMD3<Float>,
      rawWorldOrientation: simd_quatf,
      planes: [MagneticSnap.SurfacePlane] = [],
      released: Bool = false
    ) -> MagneticSnap.Evaluation? {
      let session = live.session
      guard nodeIndex >= 0, nodeIndex < session.nodeCount, let cfg = snapTraits[nodeIndex] else {
        return nil
      }
      var sockets: [MagneticSnap.SocketCandidate] = []
      var socketNodeById: [String: Int] = [:]
      sockets.reserveCapacity(socketTraits.count)
      for (sNode, sCfg) in socketTraits where sNode != nodeIndex {
        guard session.isEffectivelyVisible(sNode) else { continue }
        let w = XRSpatialMath.decompose(session.worldMatrix(of: sNode))
        let id = "socket#\(sNode)"
        sockets.append(
          MagneticSnap.SocketCandidate(
            id: id,
            tag: sCfg.tag,
            position: w.translation,
            orientation: w.rotation,
            radius: sCfg.radius,
            alignRotation: sCfg.alignRotation,
            highlightColor: sCfg.highlightColor
          ))
        socketNodeById[id] = sNode
      }
      let curT = session.nodeTransform(at: nodeIndex)
      let sy = curT?.scale.y ?? 1
      let lb = resolvedNodeBounds(nodeIndex)
      let bottomOffset = (lb != nil && lb!.min.y < -0.001) ? -lb!.min.y * sy : 0
      let prevId = activeSocketByNode[nodeIndex]
      let ev = MagneticSnap.evaluate(
        position: rawWorldPosition,
        orientation: rawWorldOrientation,
        config: cfg,
        sockets: sockets,
        planes: planes,
        currentSocketId: prevId,
        bottomOffset: bottomOffset,
        defaultFloorY: floorY ?? 0
      )
      if let prevId = prevId, prevId != ev.matchedSocketId {
        onUnsnap?(nodeIndex, socketNodeById[prevId])
      }
      if let matchedId = ev.matchedSocketId {
        if matchedId != prevId {
          onSnap?(nodeIndex, socketNodeById[matchedId], ev.position, ev.orientation, "socket")
        }
        activeSocketByNode[nodeIndex] = matchedId
      } else {
        activeSocketByNode.removeValue(forKey: nodeIndex)
        if released && (ev.mode == "grid" || ev.mode == "surface") {
          onSnap?(nodeIndex, nil, ev.position, ev.orientation, ev.mode)
        }
      }
      if released {
        activeSocketByNode.removeValue(forKey: nodeIndex)
      }
      if ev.mode != "none" && curT != nil {
        live.setNodeWorldPose(nodeIndex, position: ev.position, rotation: ev.orientation)
      }
      let previewSock =
        (!released && ev.previewSocketId != nil)
        ? sockets.first(where: { $0.id == ev.previewSocketId }) : nil
      if let ps = previewSock {
        let rad = max(0.03, ps.radius * 0.75)
        if previewRingEntity == nil || abs(previewRingRadius - rad) > 1e-3
          || previewRingColor != ps.highlightColor
        {
          previewRingEntity?.removeFromParent()
          let rGeo = MagneticSnap.buildSnapRingGeometry(
            majorRadius: rad, tubeRadius: max(0.004, rad * 0.08))
          if let rMesh = Self.mesh(rGeo) {
            var mat = Self.material(Self.parseHexRgba(ps.highlightColor, alpha: 0.55))
            if #available(iOS 15.0, macOS 12.0, visionOS 1.0, *) {
              mat.blending = .transparent(opacity: .init(floatLiteral: 0.55))
            }
            let re = ModelEntity(mesh: rMesh, materials: [mat])
            container.addChild(re)
            previewRingEntity = re
            previewRingRadius = rad
            previewRingColor = ps.highlightColor
          }
        }
        if let re = previewRingEntity {
          re.isEnabled = true
          let pulse = 1.0 + 0.07 * sin(pulsePhase)
          re.setTransformMatrix(
            XRSpatialMath.compose(
              translation: ps.position, rotation: ps.orientation,
              scale: SIMD3<Float>(repeating: pulse)),
            relativeTo: nil)
        }
      } else {
        previewRingEntity?.isEnabled = false
      }
      return ev
    }

    private func stepContactShadows() {
      guard !contactShadows.isEmpty else { return }
      let session = live.session
      struct WorldBox {
        let index: Int
        let wx: Float
        let wz: Float
        let whx: Float
        let why: Float
        let whz: Float
        let minY: Float
        let maxY: Float
        let isSupport: Bool
      }
      var boxes: [WorldBox] = []
      boxes.reserveCapacity(contactShadows.count)
      var sceneMinY: Float = .greatestFiniteMagnitude
      for (idx, cs) in contactShadows.enumerated() {
        guard session.isEffectivelyVisible(cs.node) else {
          cs.entity.isEnabled = false
          continue
        }
        let m = session.sceneMatrix(of: cs.node)
        let c = cs.localCenter
        let h = cs.localHalfExtents
        let wx = m.columns.0.x * c.x + m.columns.1.x * c.y + m.columns.2.x * c.z + m.columns.3.x
        let wy = m.columns.0.y * c.x + m.columns.1.y * c.y + m.columns.2.y * c.z + m.columns.3.y
        let wz = m.columns.0.z * c.x + m.columns.1.z * c.y + m.columns.2.z * c.z + m.columns.3.z
        let whx = abs(m.columns.0.x) * h.x + abs(m.columns.1.x) * h.y + abs(m.columns.2.x) * h.z
        let why = abs(m.columns.0.y) * h.x + abs(m.columns.1.y) * h.y + abs(m.columns.2.y) * h.z
        let whz = abs(m.columns.0.z) * h.x + abs(m.columns.1.z) * h.y + abs(m.columns.2.z) * h.z
        let minY = wy - why
        let maxY = wy + why
        if minY.isFinite {
          sceneMinY = min(sceneMinY, minY)
        }
        let lower = cs.name.lowercased()
        let isSupport =
          lower.contains("floor") || lower.contains("table") || lower.contains("pedestal")
          || lower.contains("ground") || lower.contains("base") || lower.contains("plane")
          || (why < 0.14 && min(whx, whz) > 0.45)
        boxes.append(
          WorldBox(
            index: idx, wx: wx, wz: wz, whx: whx, why: why, whz: whz, minY: minY, maxY: maxY,
            isSupport: isSupport))
      }
      guard sceneMinY.isFinite else { return }
      let supports = boxes.filter { $0.isSupport }
      let casters = boxes.filter { !$0.isSupport }
      let activeCasters = casters.isEmpty ? boxes : casters
      if !casters.isEmpty {
        for s in supports {
          contactShadows[s.index].entity.isEnabled = false
        }
      }
      let defaultMinY = (floorY ?? sceneMinY) + 0.002
      var placedClusters:
        [(index: Int, wx: Float, wz: Float, sx: Float, sz: Float, surfaceY: Float)] = []
      for b in activeCasters {
        var surfaceY: Float = -.greatestFiniteMagnitude
        for s in supports where s.index != b.index {
          if b.minY >= s.maxY - 0.08 && abs(b.wx - s.wx) <= s.whx && abs(b.wz - s.wz) <= s.whz
            && s.maxY + 0.002 > surfaceY
          {
            surfaceY = s.maxY + 0.002
          }
        }
        if !surfaceY.isFinite || surfaceY == -.greatestFiniteMagnitude {
          surfaceY = defaultMinY
        }
        let height = max(0, b.minY - surfaceY)
        if height > 2.2 {
          contactShadows[b.index].entity.isEnabled = false
          continue
        }
        let spread: Float = 1.0 + min(0.75, height * 0.85)
        let sx = max(0.045, b.whx * 1.45 * spread)
        let sz = max(0.045, b.whz * 1.45 * spread)
        if let matchIdx = placedClusters.firstIndex(where: {
          hypot(b.wx - $0.wx, b.wz - $0.wz) < 0.08 && abs(surfaceY - $0.surfaceY) < 0.05
        }) {
          contactShadows[b.index].entity.isEnabled = false
          let prev = placedClusters[matchIdx]
          let mergedSx = max(prev.sx, sx * 0.85)
          let mergedSz = max(prev.sz, sz * 0.85)
          placedClusters[matchIdx].sx = mergedSx
          placedClusters[matchIdx].sz = mergedSz
          let primary = contactShadows[prev.index]
          primary.entity.transform = Transform(
            scale: SIMD3<Float>(mergedSx, 1.0, mergedSz),
            rotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1),
            translation: SIMD3<Float>(
              prev.wx, prev.surfaceY + Float(primary.node) * 0.0002, prev.wz))
        } else {
          let cs = contactShadows[b.index]
          cs.entity.isEnabled = true
          cs.entity.transform = Transform(
            scale: SIMD3<Float>(sx, 1.0, sz),
            rotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1),
            translation: SIMD3<Float>(b.wx, surfaceY + Float(cs.node) * 0.0002, b.wz))
          placedClusters.append(
            (index: b.index, wx: b.wx, wz: b.wz, sx: sx, sz: sz, surfaceY: surfaceY))
        }
      }
    }

    private func handleLayout(for h: HandleNode) -> ManipulationHandles.Layout? {
      ManipulationHandles.computeLayout(
        localMin: h.localMin, localMax: h.localMax, world: live.session.worldMatrix(of: h.node))
    }

    private func place(_ h: HandleNode) {
      guard let layout = handleLayout(for: h) else { return }
      let visible = live.session.isEffectivelyVisible(h.node)
      let size = layout.handleRadius * 2
      for (k, corner) in layout.corners.prefix(4).enumerated() {
        h.visuals[k].isEnabled = visible
        h.visuals[k].setTransformMatrix(
          Self.box(center: corner, size: SIMD3<Float>(repeating: size), yaw: 0), relativeTo: nil)
      }
      let bar = h.visuals[4]
      bar.isEnabled = visible && h.options.rotateAxis != "none"
      let len = simd_length(layout.pedestalEnd - layout.pedestalStart)
      bar.setTransformMatrix(
        Self.box(
          center: layout.pedestalCenter, size: SIMD3<Float>(len, size * 0.5, size * 0.5),
          yaw: layout.yaw),
        relativeTo: nil)
    }

    private func rebuild(_ i: Int) {
      guard let geo = strokes[i].builder.build(), let mesh = Self.mesh(geo) else { return }
      strokes[i].entity.model?.mesh = mesh
    }

    private func stepEmitter(_ e: Emitter, dt: TimeInterval, camera: simd_float4x4) {
      let w = live.session.worldMatrix(of: e.node)
      e.emitter.step(
        dt: dt, center: SIMD3<Float>(w.columns.3.x, w.columns.3.y, w.columns.3.z), floorY: floorY)
      e.entity.isEnabled = live.session.isEffectivelyVisible(e.node)
      let style = ParticleEmitter.style(for: e.emitter.options.preset)
      let geo = Self.particleQuads(
        e.emitter.positions, count: e.emitter.count, camera: camera, size: max(style.size.x, 0.004))
      guard let mesh = Self.mesh(geo) else { return }
      if e.entity.model == nil {
        e.entity.model = ModelComponent(mesh: mesh, materials: [Self.material(style.color)])
      } else {
        e.entity.model?.mesh = mesh
      }
      e.entity.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
    }

    private func stepSplat(_ sc: SplatCloud, dt: TimeInterval, camera: simd_float4x4) {
      guard let data = sc.data, data.count > 0 else { return }
      let visible = live.session.isEffectivelyVisible(sc.node)
      sc.entity.isEnabled = visible
      guard visible else { return }
      let nodeWorld = live.session.worldMatrix(of: sc.node)
      let useGpuBillboard = Self.probeGpuBillboardMaterial(
        into: &customSplatMaterial, checked: &customSplatMaterialChecked)

      if useGpuBillboard {
        sc.entity.setTransformMatrix(nodeWorld, relativeTo: nil)
        if let idx = sc.pendingIndices {
          sc.pendingIndices = nil
          applyGpuSplatIndices(sc, indices: idx)
        }
      } else if let geo = sc.pendingGeometry {
        sc.pendingGeometry = nil
        applyCpuSplatGeometry(sc, geometry: geo)
      }

      sc.sinceLastSort += max(0, dt)
      if sc.sorting || sc.sinceLastSort < Self.splatResortMinInterval { return }
      if !SplatParser.shouldResort(
        lastCameraWorld: sc.lastCameraWorld, cameraWorld: camera,
        lastNodeWorld: sc.lastNodeWorld, nodeWorld: nodeWorld)
      {
        return
      }

      sc.sinceLastSort = 0
      sc.sorting = true
      sc.lastCameraWorld = camera
      sc.lastNodeWorld = nodeWorld
      let count = data.count
      Task { @MainActor [weak sc] in
        if useGpuBillboard {
          let indices = await Task.detached(priority: .userInitiated) {
            let mvp = SplatParser.viewDepthMatrix(nodeWorld: nodeWorld, cameraWorld: camera)
            let order = SplatParser.sortByDepth(data, mvp: mvp)
            return SplatParser.buildSortedSplatIndices(order: order, count: count)
          }.value
          sc?.pendingIndices = indices
          sc?.sorting = false
        } else {
          let geo = await Task.detached(priority: .userInitiated) {
            let mvp = SplatParser.viewDepthMatrix(nodeWorld: nodeWorld, cameraWorld: camera)
            let order = SplatParser.sortByDepth(data, mvp: mvp)
            return SplatParser.buildSplatQuads(
              data, order: order, nodeWorld: nodeWorld, cameraWorld: camera)
          }.value
          sc?.pendingGeometry = geo
          sc?.sorting = false
        }
      }
    }

    private func applyGpuSplatIndices(_ sc: SplatCloud, indices: [UInt32]) {
      guard let staticGeo = sc.staticGpuGeometry, let mat = customSplatMaterial else { return }
      #if compiler(>=6.0) && canImport(Metal)
        if #available(iOS 18.0, macOS 15.0, visionOS 2.0, *) {
          if let llm = sc.lowLevelMeshBox as? LowLevelMesh, llm.indexCapacity == indices.count {
            llm.withUnsafeMutableIndices { raw in
              indices.withUnsafeBytes { src in raw.copyMemory(from: src) }
            }
            return
          }
          var initial = staticGeo
          initial.indices = indices
          if let (llm, resource) = Self.makeLowLevelSplatMesh(initial) {
            sc.lowLevelMeshBox = llm
            sc.entity.model = ModelComponent(mesh: resource, materials: [mat])
            return
          }
        }
      #endif
      var updated = staticGeo
      updated.indices = indices
      if let mesh = Self.splatMesh(updated) {
        sc.entity.model = ModelComponent(mesh: mesh, materials: [mat])
      }
    }

    private func applyCpuSplatGeometry(_ sc: SplatCloud, geometry geo: SplatParser.QuadGeometry) {
      let mat = splatMaterial(color: geo.averageColor)
      #if compiler(>=6.0) && canImport(Metal)
        if #available(iOS 18.0, macOS 15.0, visionOS 2.0, *) {
          if let llm = sc.lowLevelMeshBox as? LowLevelMesh,
            llm.vertexCapacity == geo.positions.count,
            llm.indexCapacity == geo.indices.count
          {
            llm.withUnsafeMutableBytes(bufferIndex: 0) { raw in
              geo.positions.withUnsafeBytes { src in raw.copyMemory(from: src) }
            }
            if geo.colors.count >= geo.positions.count * 4 {
              llm.withUnsafeMutableBytes(bufferIndex: 2) { raw in
                geo.colors.withUnsafeBytes { src in
                  raw.copyMemory(
                    from: UnsafeRawBufferPointer(rebasing: src.prefix(geo.positions.count * 4)))
                }
              }
            }
            sc.entity.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
            return
          }
          if let (llm, resource) = Self.makeLowLevelSplatMesh(geo) {
            sc.lowLevelMeshBox = llm
            sc.entity.model = ModelComponent(mesh: resource, materials: [mat])
            sc.entity.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
            return
          }
        }
      #endif
      if let mesh = Self.splatMesh(geo) {
        sc.entity.model = ModelComponent(mesh: mesh, materials: [mat])
        sc.entity.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
      }
    }

    private static func probeGpuBillboardMaterial(
      into slot: inout RealityKit.Material?,
      checked: inout Bool
    ) -> Bool {
      if checked { return slot != nil }
      checked = true
      #if (os(iOS) || os(macOS)) && canImport(Metal)
        if #available(iOS 15.0, macOS 12.0, *), let lib = SplatParser.makeMetalLibrary() {
          let geoMod = CustomMaterial.GeometryModifier(named: "threeLiveSplatGeometry", in: lib)
          let surfShader = CustomMaterial.SurfaceShader(named: "threeLiveSplatSurface", in: lib)
          if var mat = try? CustomMaterial(
            surfaceShader: surfShader,
            geometryModifier: geoMod,
            lightingModel: .unlit
          ) {
            mat.blending = .transparent(opacity: .init(floatLiteral: 1.0))
            mat.faceCulling = .none
            slot = mat
            return true
          }
        }
      #endif
      return false
    }

    #if compiler(>=6.0) && canImport(Metal)
      @available(iOS 18.0, macOS 15.0, visionOS 2.0, *)
      private static func makeLowLevelSplatMesh(
        _ g: SplatParser.QuadGeometry
      ) -> (LowLevelMesh, MeshResource)? {
        let vCount = g.positions.count
        let iCount = g.indices.count
        guard vCount > 0, iCount > 0, g.uvs.count == vCount else { return nil }
        let attrs: [LowLevelMesh.Attribute] = [
          LowLevelMesh.Attribute(semantic: .position, format: .float3, layoutIndex: 0, offset: 0),
          LowLevelMesh.Attribute(semantic: .uv0, format: .float2, layoutIndex: 1, offset: 0),
          LowLevelMesh.Attribute(
            semantic: .color, format: .uchar4Normalized, layoutIndex: 2, offset: 0),
        ]
        let layouts: [LowLevelMesh.Layout] = [
          LowLevelMesh.Layout(
            bufferIndex: 0, bufferOffset: 0, bufferStride: MemoryLayout<SIMD3<Float>>.stride),
          LowLevelMesh.Layout(
            bufferIndex: 1, bufferOffset: 0, bufferStride: MemoryLayout<SIMD2<Float>>.stride),
          LowLevelMesh.Layout(bufferIndex: 2, bufferOffset: 0, bufferStride: 4),
        ]
        let desc = LowLevelMesh.Descriptor(
          vertexCapacity: vCount,
          vertexAttributes: attrs,
          vertexLayouts: layouts,
          indexCapacity: iCount,
          indexType: .uint32
        )
        guard let llm = try? LowLevelMesh(descriptor: desc) else { return nil }
        llm.withUnsafeMutableBytes(bufferIndex: 0) { raw in
          g.positions.withUnsafeBytes { src in raw.copyMemory(from: src) }
        }
        llm.withUnsafeMutableBytes(bufferIndex: 1) { raw in
          g.uvs.withUnsafeBytes { src in raw.copyMemory(from: src) }
        }
        if g.colors.count >= vCount * 4 {
          llm.withUnsafeMutableBytes(bufferIndex: 2) { raw in
            g.colors.withUnsafeBytes { src in
              raw.copyMemory(from: UnsafeRawBufferPointer(rebasing: src.prefix(vCount * 4)))
            }
          }
        }
        llm.withUnsafeMutableIndices { raw in
          g.indices.withUnsafeBytes { src in raw.copyMemory(from: src) }
        }
        let bounds = BoundingBox(
          min: SIMD3<Float>(repeating: -1000), max: SIMD3<Float>(repeating: 1000))
        llm.parts.replaceAll([
          LowLevelMesh.Part(
            indexOffset: 0, indexCount: iCount, topology: .triangle, materialIndex: 0,
            bounds: bounds)
        ])
        guard let resource = try? MeshResource(from: llm) else { return nil }
        return (llm, resource)
      }
    #endif

    private func splatMaterial(color: SIMD4<Float>) -> UnlitMaterial {
      var mat = Self.material(color)
      if gaussianTexture == nil {
        gaussianTexture = Self.makeGaussianTexture()
      }
      if let tex = gaussianTexture {
        if #available(iOS 15.0, macOS 12.0, visionOS 1.0, *) {
          mat.color = .init(
            tint: XRPlatformColor(
              red: CGFloat(color.x), green: CGFloat(color.y), blue: CGFloat(color.z), alpha: 1),
            texture: .init(tex))
          mat.blending = .transparent(opacity: .init(floatLiteral: max(0.05, min(1, color.w))))
        }
      }
      return mat
    }

    private static func makeGaussianTexture(size: Int = 64) -> TextureResource? {
      let rgba = SplatParser.gaussianFalloffRGBA(size: size)
      let colorSpace = CGColorSpaceCreateDeviceRGB()
      let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue)
      guard let provider = CGDataProvider(data: Data(rgba) as CFData),
        let cgImage = CGImage(
          width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4,
          space: colorSpace, bitmapInfo: bitmapInfo, provider: provider, decode: nil,
          shouldInterpolate: true, intent: .defaultIntent)
      else { return nil }
      if #available(iOS 15.0, macOS 12.0, visionOS 1.0, *) {
        return try? TextureResource.generate(from: cgImage, options: .init(semantic: .color))
      }
      return nil
    }

    static func splatMesh(_ g: SplatParser.QuadGeometry) -> MeshResource? {
      guard !g.positions.isEmpty, !g.indices.isEmpty else { return nil }
      var descriptor = MeshDescriptor(name: "xr-splats")
      descriptor.positions = MeshBuffers.Positions(g.positions)
      if g.uvs.count == g.positions.count {
        descriptor.textureCoordinates = MeshBuffers.TextureCoordinates(g.uvs)
      }
      descriptor.primitives = .triangles(g.indices)
      return try? MeshResource.generate(from: [descriptor])
    }

    private static func makeContactShadowMesh() -> MeshResource? {
      var descriptor = MeshDescriptor(name: "xr-contact-shadow")
      descriptor.positions = MeshBuffers.Positions([
        SIMD3<Float>(-1, 0, -1),
        SIMD3<Float>(1, 0, -1),
        SIMD3<Float>(1, 0, 1),
        SIMD3<Float>(-1, 0, 1),
      ])
      descriptor.normals = MeshBuffers.Normals([
        SIMD3<Float>(0, 1, 0),
        SIMD3<Float>(0, 1, 0),
        SIMD3<Float>(0, 1, 0),
        SIMD3<Float>(0, 1, 0),
      ])
      descriptor.textureCoordinates = MeshBuffers.TextureCoordinates([
        SIMD2<Float>(0, 0),
        SIMD2<Float>(1, 0),
        SIMD2<Float>(1, 1),
        SIMD2<Float>(0, 1),
      ])
      descriptor.primitives = .triangles([0, 2, 1, 0, 3, 2, 0, 1, 2, 0, 2, 3])
      return try? MeshResource.generate(from: [descriptor])
    }

    private static func makeContactShadowMaterial(size: Int = 64) -> UnlitMaterial? {
      let n = max(8, min(size, 256))
      var rgba = [UInt8](repeating: 0, count: n * n * 4)
      let half = Double(n - 1) * 0.5
      for y in 0..<n {
        let dy = (Double(y) - half) / half
        for x in 0..<n {
          let dx = (Double(x) - half) / half
          let d = min(1.0, sqrt(dx * dx + dy * dy))
          let t = max(0.0, min(1.0, (1.0 - d) / 0.45))
          let smooth = t * t * (3.0 - 2.0 * t)
          let falloff = pow(1.0 - d * d, 2.0) * smooth
          let v = UInt8(max(0, min(255, Int((255.0 * falloff).rounded()))))
          let idx = (y * n + x) * 4
          rgba[idx] = v
          rgba[idx + 1] = v
          rgba[idx + 2] = v
          rgba[idx + 3] = v
        }
      }
      let colorSpace = CGColorSpaceCreateDeviceRGB()
      let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue)
      guard let provider = CGDataProvider(data: Data(rgba) as CFData),
        let cgImage = CGImage(
          width: n, height: n, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: n * 4,
          space: colorSpace, bitmapInfo: bitmapInfo, provider: provider, decode: nil,
          shouldInterpolate: true, intent: .defaultIntent)
      else { return nil }
      guard #available(iOS 15.0, macOS 12.0, visionOS 1.0, *),
        let tex = try? TextureResource.generate(from: cgImage, options: .init(semantic: .raw))
      else { return nil }
      var mat = UnlitMaterial(color: .black)
      mat.color = .init(tint: .black)
      mat.blending = .transparent(opacity: .init(scale: 0.68, texture: .init(tex)))
      return mat
    }

    // MARK: Geometry helpers

    static func material(_ c: SIMD4<Float>) -> UnlitMaterial {
      UnlitMaterial(
        color: XRPlatformColor(
          red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: CGFloat(c.w)))
    }

    static func box(center: SIMD3<Float>, size: SIMD3<Float>, yaw: Float) -> simd_float4x4 {
      let c = cos(yaw)
      let s = sin(yaw)
      return simd_float4x4(
        columns: (
          SIMD4<Float>(c * size.x, 0, -s * size.x, 0),
          SIMD4<Float>(0, size.y, 0, 0),
          SIMD4<Float>(s * size.z, 0, c * size.z, 0),
          SIMD4<Float>(center.x, center.y, center.z, 1)
        ))
    }

    static func mesh(_ g: XRGeneratedGeometry) -> MeshResource? {
      guard g.vertexCount > 0, !g.indices.isEmpty else { return nil }
      var positions: [SIMD3<Float>] = []
      positions.reserveCapacity(g.vertexCount)
      for i in 0..<g.vertexCount {
        positions.append(
          SIMD3<Float>(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]))
      }
      var descriptor = MeshDescriptor(name: "xr-spatial")
      descriptor.positions = MeshBuffers.Positions(positions)
      if g.normals.count == g.positions.count {
        var normals: [SIMD3<Float>] = []
        normals.reserveCapacity(g.vertexCount)
        for i in 0..<g.vertexCount {
          normals.append(SIMD3<Float>(g.normals[i * 3], g.normals[i * 3 + 1], g.normals[i * 3 + 2]))
        }
        descriptor.normals = MeshBuffers.Normals(normals)
      }
      descriptor.primitives = .triangles(g.indices)
      return try? MeshResource.generate(from: [descriptor])
    }

    /// Camera-facing quads (two triangles each) for `count` particles.
    public static func particleQuads(
      _ positions: [Float], count: Int, camera: simd_float4x4, size: Float
    )
      -> XRGeneratedGeometry
    {
      let h = size / 2
      let r = SIMD3<Float>(camera.columns.0.x, camera.columns.0.y, camera.columns.0.z) * h
      let u = SIMD3<Float>(camera.columns.1.x, camera.columns.1.y, camera.columns.1.z) * h
      let n = min(count, positions.count / 3)
      var out = [Float]()
      out.reserveCapacity(n * 12)
      var idx = [UInt32]()
      idx.reserveCapacity(n * 6)
      for i in 0..<n {
        let p = SIMD3<Float>(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
        for v in [p - r - u, p + r - u, p + r + u, p - r + u] {
          out.append(contentsOf: [v.x, v.y, v.z])
        }
        let b = UInt32(i * 4)
        idx.append(contentsOf: [b, b + 1, b + 2, b, b + 2, b + 3])
      }
      return XRGeneratedGeometry(positions: out, normals: [], indices: idx)
    }
  }
#endif
