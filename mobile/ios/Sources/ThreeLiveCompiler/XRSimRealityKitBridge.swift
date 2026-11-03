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

// Draws an `XRSimWorld` with RealityKit the way the web `xr-live-sim` plugins do (port of
// XRSimRenderBridge.kt).

#if canImport(RealityKit) && !os(tvOS)
  import Foundation
  import RealityKit
  import simd

  /// Mirrors spawned instances, reports the character follow camera
  /// (`CharacterController.cameraRig`), and draws `HitZones.visuals` (hit flashes, integrity
  /// bars, projectiles, burst fragments, and colored zone outlines) under the session's scene
  /// space. Hosts forward `XRSimWorldDelegate` instance callbacks and call `sync()` after every
  /// `XRSimWorld.step`.
  @MainActor
  public final class XRSimRealityKitBridge {
    /// Camera follow requests: world-space target (`nil` stops following), polar angle from
    /// straight down, distance in meters, and whether to re-frame (the camera mode changed).
    public var onCameraFollow:
      ((_ target: SIMD3<Double>?, _ polarDeg: Double, _ distance: Double, _ reframe: Bool) -> Void)?

    private let world: XRSimWorld
    private let live: XRLiveRealityKitSession
    private let container = Entity()
    private var instances: [String: Entity] = [:]
    private var bars: [ObjectIdentifier: (bg: ModelEntity, fill: ModelEntity)] = [:]
    private var zones: [ObjectIdentifier: Entity] = [:]
    private var projectiles: [ModelEntity] = []
    private var fragments: [ModelEntity] = []
    /// Original materials of model entities showing the hit flash.
    private var flashed: [ObjectIdentifier: (entity: ModelEntity, materials: [any Material])] = [:]
    private var flashingBodies: [ObjectIdentifier: XRSimWorld.Body] = [:]
    private var cameraMode: String?
    private lazy var unitBox = MeshResource.generateBox(size: 1)

    public init(world: XRSimWorld, live: XRLiveRealityKitSession) {
      self.world = world
      self.live = live
      container.name = "XRSimVisuals"
      live.sceneSpaceEntity.addChild(container)
    }

    // MARK: Instances

    /// Clones the template node's entity for a spawned instance (first pose) and places it.
    public func instancePose(
      _ id: String, template: Int, position: SIMD3<Double>, rotation: simd_quatd, visible: Bool
    ) {
      let space = live.sceneSpaceEntity
      var entity = instances[id]
      if entity == nil {
        guard let source = live.entity(forNode: template) else { return }
        let clone = source.clone(recursive: true)
        clone.name = id
        // Keep the template's scale relative to scene space.
        let scale = source.scale(relativeTo: space)
        space.addChild(clone)
        clone.setScale(scale, relativeTo: space)
        instances[id] = clone
        entity = clone
      }
      guard let e = entity else { return }
      e.setPosition(SIMD3<Float>(Float(position.x), Float(position.y), Float(position.z)), relativeTo: space)
      e.setOrientation(
        simd_quatf(
          ix: Float(rotation.imag.x), iy: Float(rotation.imag.y), iz: Float(rotation.imag.z),
          r: Float(rotation.real)), relativeTo: space)
      e.isEnabled = visible
    }

    /// Removes a spawned instance's clone.
    public func instanceRemoved(_ id: String) {
      guard let e = instances.removeValue(forKey: id) else { return }
      setFlash(e, false)
      e.removeFromParent()
    }

    /// Spawned instance id owning `entity` (itself or an ancestor), or `nil`.
    public func instanceId(for entity: Entity) -> String? {
      guard !instances.isEmpty else { return nil }
      var current: Entity? = entity
      var depth = 0
      while let e = current, depth < 64 {
        if let id = instances.first(where: { $0.value === e })?.key { return id }
        current = e.parent
        depth += 1
      }
      return nil
    }

    // MARK: Frame

    /// Applies the camera rig and visuals for the current world state.
    public func sync() {
      syncCamera()
      let v = HitZones.visuals(world)
      syncFlashes(v.flashing)
      syncBars(v.bars)
      syncPool(&projectiles, v.projectiles, size: 0.07) { _ in SIMD4(1, 0.85, 0.2, 1) }
      syncPool(&fragments, v.fragments.map { $0.pos }, size: 0.04) { [weak self] i in
        v.fragments[i].source.flatMap { self?.color(of: $0) } ?? SIMD4(1, 1, 1, 1)
      }
      syncZones(v.zones)
    }

    /// Removes everything this bridge created and stops following.
    public func dispose() {
      for (_, f) in flashed { f.entity.model?.materials = f.materials }
      flashed.removeAll()
      flashingBodies.removeAll()
      for (_, e) in instances { e.removeFromParent() }
      instances.removeAll()
      container.removeFromParent()
      bars.removeAll()
      zones.removeAll()
      projectiles.removeAll()
      fragments.removeAll()
      if cameraMode != nil { onCameraFollow?(nil, 0, 0, false) }
      cameraMode = nil
    }

    private func syncCamera() {
      guard let rig = CharacterController.cameraRig(world) else {
        if cameraMode != nil { onCameraFollow?(nil, 0, 0, false) }
        cameraMode = nil
        return
      }
      let space = live.sceneSpaceEntity
      let t = SIMD3<Float>(Float(rig.target.x), Float(rig.target.y), Float(rig.target.z))
      let w = space.convert(position: t, to: nil)
      let s = space.scale(relativeTo: nil)
      let scale = Double((s.x + s.y + s.z) / 3)
      onCameraFollow?(
        SIMD3(Double(w.x), Double(w.y), Double(w.z)), rig.phiDeg,
        rig.distance * (scale.isFinite && scale > 1e-9 ? scale : 1), rig.mode != cameraMode)
      cameraMode = rig.mode
    }

    // MARK: Flash

    private func entities(of b: XRSimWorld.Body) -> Entity? {
      b.isInstance ? instances[b.name] : live.entity(forNode: b.nodeIndex)
    }

    private func syncFlashes(_ now: [XRSimWorld.Body]) {
      var next: [ObjectIdentifier: XRSimWorld.Body] = [:]
      for b in now { next[ObjectIdentifier(b)] = b }
      for (key, b) in flashingBodies where next[key] == nil {
        if let e = entities(of: b) { setFlash(e, false) }
      }
      for (key, b) in next where flashingBodies[key] == nil {
        if let e = entities(of: b) { setFlash(e, true) }
      }
      flashingBodies = next
    }

    /// Swaps the materials of `root` and its descendants to red-tinted copies (or back).
    private func setFlash(_ root: Entity, _ on: Bool) {
      var stack: [Entity] = [root]
      var visited = 0
      while let e = stack.popLast(), visited < 4096 {
        visited += 1
        stack.append(contentsOf: e.children)
        guard let model = e as? ModelEntity, let mc = model.model else { continue }
        let key = ObjectIdentifier(model)
        if on {
          if flashed[key] != nil { continue }
          flashed[key] = (model, mc.materials)
          model.model?.materials = mc.materials.map(Self.flashed)
        } else if let f = flashed.removeValue(forKey: key) {
          model.model?.materials = f.materials
        }
      }
    }

    /// A red-tinted copy of `m` (web: base color lerped 60% toward `(1, 0.25, 0.25)`).
    private static func flashed(_ m: any Material) -> any Material {
      if var pbr = m as? PhysicallyBasedMaterial {
        pbr.emissiveColor = .init(
          color: XRPlatformColor(red: 1, green: 0.25, blue: 0.25, alpha: 1))
        pbr.emissiveIntensity = 1
        return pbr
      }
      if var simple = m as? SimpleMaterial {
        simple.color = .init(tint: XRPlatformColor(red: 1, green: 0.4, blue: 0.4, alpha: 1))
        return simple
      }
      return XRSpatialRealityKitFeatures.material(SIMD4(1, 0.4, 0.4, 1))
    }

    // MARK: Primitives

    private func makeBox(_ color: SIMD4<Float>) -> ModelEntity {
      let e = ModelEntity(mesh: unitBox, materials: [XRSpatialRealityKitFeatures.material(color)])
      container.addChild(e)
      return e
    }

    private func place(
      _ e: Entity, _ pos: SIMD3<Double>, yaw: Double, size: SIMD3<Double>
    ) {
      e.transform = Transform(
        scale: SIMD3<Float>(Float(size.x), Float(size.y), Float(size.z)),
        rotation: simd_quatf(angle: Float(yaw), axis: SIMD3(0, 1, 0)),
        translation: SIMD3<Float>(Float(pos.x), Float(pos.y), Float(pos.z)))
      e.isEnabled = true
    }

    private func syncBars(_ list: [HitZones.BarVisual]) {
      var shown = Set<ObjectIdentifier>()
      for bv in list {
        let key = ObjectIdentifier(bv.body)
        let pair = bars[key] ?? (makeBox(SIMD4(0.06, 0.09, 0.16, 1)), makeBox(bv.color))
        bars[key] = pair
        shown.insert(key)
        place(pair.bg, bv.center, yaw: bv.yaw, size: SIMD3(bv.width + 0.02, 0.07, 0.01))
        // Left-align the fill along the bar's local X axis, slightly in front.
        let off = XRSimWorld.rotateY(SIMD3(-(1 - bv.frac) * bv.width / 2, 0, 0.006), bv.yaw)
        place(
          pair.fill, bv.center + SIMD3(off.x, 0, off.z), yaw: bv.yaw,
          size: SIMD3(Swift.max(1e-3, bv.width * bv.frac), 0.05, 0.012))
        pair.fill.model?.materials = [XRSpatialRealityKitFeatures.material(bv.color)]
      }
      let live = Set(world.bodies.map { ObjectIdentifier($0) })
      for (key, pair) in bars where !shown.contains(key) {
        if live.contains(key) {
          pair.bg.isEnabled = false
          pair.fill.isEnabled = false
        } else {
          pair.bg.removeFromParent()
          pair.fill.removeFromParent()
          bars.removeValue(forKey: key)
        }
      }
    }

    private func syncPool(
      _ pool: inout [ModelEntity], _ positions: [SIMD3<Double>], size: Double,
      color: (Int) -> SIMD4<Float>
    ) {
      while pool.count < positions.count { pool.append(makeBox(color(pool.count))) }
      for (i, e) in pool.enumerated() {
        if i < positions.count {
          e.model?.materials = [XRSpatialRealityKitFeatures.material(color(i))]
          place(e, positions[i], yaw: 0, size: SIMD3(repeating: size))
        } else {
          e.isEnabled = false
        }
      }
    }

    private func syncZones(_ list: [HitZones.ZoneVisual]) {
      var shown = Set<ObjectIdentifier>()
      for z in list {
        let key = ObjectIdentifier(z.body)
        let outline = zones[key] ?? makeEdgeBox(z.color)
        zones[key] = outline
        shown.insert(key)
        place(outline, z.center, yaw: z.yaw, size: z.size)
      }
      let live = Set(world.bodies.map { ObjectIdentifier($0) })
      for (key, e) in zones where !shown.contains(key) {
        if live.contains(key) {
          e.isEnabled = false
        } else {
          e.removeFromParent()
          zones.removeValue(forKey: key)
        }
      }
    }

    /// Unit wireframe box: 12 edges 0.02 thick (scaled with the zone, like the web outline).
    private func makeEdgeBox(_ color: SIMD4<Float>) -> Entity {
      let group = Entity()
      let mat = XRSpatialRealityKitFeatures.material(color)
      let t: Float = 0.02
      for axis in 0..<3 {
        let others = (0..<3).filter { $0 != axis }
        for u: Float in [-0.5, 0.5] {
          for w: Float in [-0.5, 0.5] {
            var size = SIMD3<Float>(repeating: t)
            size[axis] = 1 + t
            var center = SIMD3<Float>(repeating: 0)
            center[others[0]] = u
            center[others[1]] = w
            let edge = ModelEntity(mesh: unitBox, materials: [mat])
            edge.transform = Transform(
              scale: size, rotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1), translation: center)
            group.addChild(edge)
          }
        }
      }
      container.addChild(group)
      return group
    }

    /// Base color of the first model under `b` (what the web burst uses), or `nil`.
    private func color(of b: XRSimWorld.Body) -> SIMD4<Float>? {
      guard let root = entities(of: b) else { return nil }
      var stack: [Entity] = [root]
      var visited = 0
      while let e = stack.popLast(), visited < 256 {
        visited += 1
        stack.append(contentsOf: e.children)
        guard let m = (e as? ModelEntity)?.model?.materials.first else { continue }
        // Ignore an active flash: read the original material.
        let original = flashed[ObjectIdentifier(e)]?.materials.first ?? m
        if let pbr = original as? PhysicallyBasedMaterial {
          return Self.rgba(pbr.baseColor.tint)
        }
        if let simple = original as? SimpleMaterial { return Self.rgba(simple.color.tint) }
        return nil
      }
      return nil
    }

    private static func rgba(_ c: XRPlatformColor) -> SIMD4<Float>? {
      #if canImport(UIKit)
        var r: CGFloat = 1
        var g: CGFloat = 1
        var bl: CGFloat = 1
        var a: CGFloat = 1
        guard c.getRed(&r, green: &g, blue: &bl, alpha: &a) else { return nil }
        return SIMD4(Float(r), Float(g), Float(bl), Float(a))
      #else
        guard let rgb = c.usingColorSpace(.sRGB) else { return nil }
        return SIMD4(
          Float(rgb.redComponent), Float(rgb.greenComponent), Float(rgb.blueComponent),
          Float(rgb.alphaComponent))
      #endif
    }
  }
#endif
