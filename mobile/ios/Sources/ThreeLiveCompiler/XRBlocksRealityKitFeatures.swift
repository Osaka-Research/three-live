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

// Native XR Blocks features on RealityKit: manipulation handles, spatial paint and depth
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
  public final class XRBlocksRealityKitFeatures {
    /// `{mesh, scale, yawDeg}` when a handle drag ends (web `xr-handles-change`).
    public var onHandlesChange: ((_ mesh: String, _ scale: Float, _ yawDeg: Float) -> Void)?
    /// `{index, points, lengthMeters}` when a stroke ends (web `xr-paint-stroke`).
    public var onPaintStroke: ((_ index: Int, _ points: Int, _ lengthMeters: Float) -> Void)?
    /// Paint color, or `nil` to disable spatial paint (the default).
    public var paintColor: SIMD4<Float>?
    /// Optional floor height (world meters) particles collide with.
    public var floorY: Float?
    /// Camera world transform for camera-facing particles (defaults to the live head pose).
    public var cameraTransformProvider: (() -> simd_float4x4?)?

    public static let maxStrokes = 256
    public static let screenPaintDepth: Float = 0.4
    /// At most 15 Hz depth re-sort cadence for splats.
    public static let splatResortMinInterval: TimeInterval = 1.0 / 15.0

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
      var sinceLastSort: TimeInterval = XRBlocksRealityKitFeatures.splatResortMinInterval
      var loadTask: Task<Void, Never>?

      init(node: Int, url: URL, entity: ModelEntity) {
        self.node = node
        self.url = url
        self.entity = entity
      }
    }

    private var handles: [HandleNode] = []
    private var emitters: [Emitter] = []
    private var strokes: [Stroke] = []
    private var splats: [SplatCloud] = []
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
      container.name = "XRBlocksFeatures"
      live.root.addChild(container)
      let useGpuBillboard = Self.probeGpuBillboardMaterial(into: &customSplatMaterial, checked: &customSplatMaterialChecked)
      let effectiveMaxSplats = maxSplats ?? (useGpuBillboard ? SplatParser.defaultMaxGpuSplats : SplatParser.defaultMaxCpuSplats)
      let session = live.session
      for i in 0..<session.nodeCount {
        guard let traits = session.traits(at: i) else { continue }
        if let h = traits.handles, let entity = live.entity(forNode: i) {
          let bounds = entity.visualBounds(recursive: true, relativeTo: entity)
          if !bounds.isEmpty {
            let material = UnlitMaterial(color: .white)
            var visuals: [ModelEntity] = []
            for _ in 0..<5 {
              let m = ModelEntity(mesh: .generateBox(size: 1), materials: [material])
              container.addChild(m)
              visuals.append(m)
            }
            handles.append(HandleNode(node: i, options: h, localMin: bounds.min, localMax: bounds.max, visuals: visuals))
          }
        }
        if let p = traits.particles, emitters.count < ParticleEmitter.maxEmitters {
          let emitter = ParticleEmitter(options: p, seed: UInt32(i + 1))
          let world = session.worldMatrix(of: i)
          emitter.reset(center: SIMD3<Float>(world.columns.3.x, world.columns.3.y, world.columns.3.z))
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
          cloud.loadTask = Task.detached(priority: .utility) { [weak cloud] in
            guard let loaded = try? await SplatParser.loadURL(
              resolved.absoluteString, baseURL: baseURL, allowCrossOrigin: allowRemoteSplats)
            else { return }
            let sampled = SplatParser.downsample(loaded, maxSplats: effectiveMaxSplats)
            let staticGpu = useGpuBillboard ? SplatParser.buildStaticGpuSplatVertices(sampled) : nil
            await MainActor.run {
              cloud?.staticGpuGeometry = staticGpu
              cloud?.data = sampled
            }
          }
          splats.append(cloud)
        }
      }
    }

    /// Number of nodes with handles.
    public var handleCount: Int { handles.count }

    /// Number of accepted `splatUrl` clouds.
    public var splatCount: Int { splats.count }

    /// Steps handles and particles from `scene`'s update events.
    public func startUpdates(in scene: RealityKit.Scene) {
      guard updateSubscription == nil else { return }
      updateSubscription = scene.subscribe(to: SceneEvents.Update.self) { [weak self] event in
        self?.step(dt: event.deltaTime)
      }
    }

    /// Removes every feature entity and stops updates.
    public func dispose() {
      updateSubscription?.cancel()
      updateSubscription = nil
      for sc in splats { sc.loadTask?.cancel() }
      container.removeFromParent()
      handles.removeAll()
      emitters.removeAll()
      strokes.removeAll()
      splats.removeAll()
    }

    // MARK: Pointer input (world-space rays)

    /// A pointer went down. Returns `true` when a handle or a paint stroke captured it; the host
    /// should then route moves here instead of orbiting the camera.
    @discardableResult
    public func pointerDown(origin: SIMD3<Float>, direction: SIMD3<Float>, hitEntity: Entity?) -> Bool {
      let session = live.session
      for h in handles {
        guard let layout = handleLayout(for: h), let t = session.nodeTransform(at: h.node),
          let dir = ManipulationHandles.normalizeRay(direction),
          let hit = ManipulationHandles.pick(layout: layout, rayOrigin: origin, rayDirection: dir, options: h.options),
          let d = ManipulationHandles.Drag(
            layout: layout, hit: hit, rayOrigin: origin, rayDirection: dir, startScale: t.scale,
            startRotation: t.rotation, options: h.options)
        else { continue }
        drag = (h.node, d)
        return true
      }
      guard let color = paintColor, hitEntity.flatMap({ live.nodeIndex(for: $0) }) == nil,
        let dir = ManipulationHandles.normalizeRay(direction)
      else { return false }
      if strokes.count >= Self.maxStrokes {
        strokes.removeFirst().entity.removeFromParent()
      }
      let entity = ModelEntity()
      entity.components.set(ModelComponent(mesh: .generateBox(size: 0.001), materials: [Self.material(color)]))
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
          active.node, XRNodeTransform(translation: t.translation, rotation: next.rotation, scale: next.scale))
        return
      }
      guard let i = painting, i < strokes.count, let dir = ManipulationHandles.normalizeRay(direction),
        strokes[i].builder.points.count < TubeStrokeBuilder.maxStrokePoints
      else { return }
      if strokes[i].builder.addPoint(origin + dir * Self.screenPaintDepth), strokes[i].builder.points.count % 3 == 0 {
        rebuild(i)
      }
    }

    /// A captured pointer was released.
    public func pointerUp() {
      if let active = drag {
        drag = nil
        if let t = live.session.nodeTransform(at: active.node) {
          let yaw = XRBlocksMath.yawFromQuat(t.rotation) * 180 / .pi
          onHandlesChange?(live.session.nodeName(at: active.node) ?? "", t.scale.x, yaw)
        }
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
        return pointerDown(origin: ray.origin, direction: ray.direction, hitEntity: arView.entity(at: point))
      }

      public func pointerMove(at point: CGPoint, in arView: ARView) {
        guard let ray = arView.ray(through: point) else { return }
        pointerMove(origin: ray.origin, direction: ray.direction)
      }
    #endif

    // MARK: Per frame

    /// Repositions handles and steps particles.
    public func step(dt: TimeInterval) {
      for h in handles { place(h) }
      let camera: simd_float4x4
      if let provided = cameraTransformProvider?() {
        camera = provided
      } else if let pose = live.headPoseProvider?() {
        camera = simd_float4x4(pose.orientation)
      } else {
        camera = matrix_identity_float4x4
      }
      for e in emitters { stepEmitter(e, dt: dt, camera: camera) }
      for sc in splats { stepSplat(sc, dt: dt, camera: camera) }
    }

    private func handleLayout(for h: HandleNode) -> ManipulationHandles.Layout? {
      ManipulationHandles.computeLayout(localMin: h.localMin, localMax: h.localMax, world: live.session.worldMatrix(of: h.node))
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
        Self.box(center: layout.pedestalCenter, size: SIMD3<Float>(len, size * 0.5, size * 0.5), yaw: layout.yaw),
        relativeTo: nil)
    }

    private func rebuild(_ i: Int) {
      guard let geo = strokes[i].builder.build(), let mesh = Self.mesh(geo) else { return }
      strokes[i].entity.model?.mesh = mesh
    }

    private func stepEmitter(_ e: Emitter, dt: TimeInterval, camera: simd_float4x4) {
      let w = live.session.worldMatrix(of: e.node)
      e.emitter.step(dt: dt, center: SIMD3<Float>(w.columns.3.x, w.columns.3.y, w.columns.3.z), floorY: floorY)
      e.entity.isEnabled = live.session.isEffectivelyVisible(e.node)
      let style = ParticleEmitter.style(for: e.emitter.options.preset)
      let geo = Self.particleQuads(e.emitter.positions, count: e.emitter.count, camera: camera, size: max(style.size.x, 0.004))
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
      Task.detached(priority: .userInitiated) { [weak sc] in
        let mvp = SplatParser.viewDepthMatrix(nodeWorld: nodeWorld, cameraWorld: camera)
        let order = SplatParser.sortByDepth(data, mvp: mvp)
        if useGpuBillboard {
          let indices = SplatParser.buildSortedSplatIndices(order: order, count: data.count)
          await MainActor.run {
            sc?.pendingIndices = indices
            sc?.sorting = false
          }
        } else {
          let geo = SplatParser.buildSplatQuads(data, order: order, nodeWorld: nodeWorld, cameraWorld: camera)
          await MainActor.run {
            sc?.pendingGeometry = geo
            sc?.sorting = false
          }
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
                  raw.copyMemory(from: UnsafeRawBufferPointer(rebasing: src.prefix(geo.positions.count * 4)))
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
          LowLevelMesh.Attribute(semantic: .color, format: .uchar4Normalized, layoutIndex: 2, offset: 0),
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

    // MARK: Geometry helpers

    static func material(_ c: SIMD4<Float>) -> UnlitMaterial {
      UnlitMaterial(
        color: XRPlatformColor(red: CGFloat(c.x), green: CGFloat(c.y), blue: CGFloat(c.z), alpha: CGFloat(c.w)))
    }

    static func box(center: SIMD3<Float>, size: SIMD3<Float>, yaw: Float) -> simd_float4x4 {
      let c = cos(yaw)
      let s = sin(yaw)
      return simd_float4x4(columns: (
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
        positions.append(SIMD3<Float>(g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]))
      }
      var descriptor = MeshDescriptor(name: "xr-blocks")
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
    public static func particleQuads(_ positions: [Float], count: Int, camera: simd_float4x4, size: Float)
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
