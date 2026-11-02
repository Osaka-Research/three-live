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
    /// `{nodeIndex, point, normal}` when gaze enters a node (`gazeenter`).
    public var onGazeEnter:
      ((_ nodeIndex: Int, _ point: SIMD3<Float>, _ normal: SIMD3<Float>) -> Void)?
    /// `{nodeIndex}` when gaze leaves a node (`gazeleave`).
    public var onGazeLeave: ((_ nodeIndex: Int) -> Void)?
    /// `{nodeIndex, action, point}` when gaze dwell completes (`gazedwell`).
    public var onGazeDwell:
      ((_ nodeIndex: Int, _ action: String, _ point: SIMD3<Float>) -> Void)?
    /// `{factor, source}` when explosion factor changes (`explodechange`).
    public var onExplodeChange: ((_ factor: Float, _ source: String) -> Void)?
    /// `{count, source}` when persisted anchors restore (`anchorsrestored`).
    public var onAnchorsRestored: ((_ count: Int, _ source: String) -> Void)?
    /// `{from, to, yawDeg}` when a spatial teleport commits (`xrteleport`).
    public var onTeleport:
      ((_ from: SIMD3<Float>, _ to: SIMD3<Float>, _ yawDeg: Float) -> Void)?
    /// `{peerId, name, color}` when a remote peer joins `shared-room` (`peerjoin`).
    public var onPeerJoin: ((_ peerId: String, _ name: String, _ color: String) -> Void)?
    /// `{peerId, name, color}` when a remote peer leaves or times out (`peerleave`).
    public var onPeerLeave: ((_ peerId: String, _ name: String, _ color: String) -> Void)?
    /// `{peerId, nodeId}` when a remote state delta is applied (`peersync`).
    public var onPeerSync: ((_ peerId: String, _ nodeId: String) -> Void)?
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
    /// Gaze-dwell activation mode (`"off"`, `"on"`, `"auto"`).
    public var gazeDwellMode: String = "off"
    /// Default dwell duration in milliseconds (`250..10000`).
    public var defaultDwellMs: Int = 1200
    /// Explosion layout mode (`"radial"`, `"axial-x"`, `"axial-y"`, `"axial-z"`, `"hierarchical"`).
    public var explodeMode: String = "radial"
    /// Multiplier (`0..10`) applied to exploded part travel distances.
    public var explodeScale: Float = 1.5
    /// Cross-section cut plane specification (`"none"`, `"x:0.2"`, `"y:0.0"`, `"-z:0.1"`, `"interactive"`).
    public var sectionPlaneSpec: String = "none"
    /// Current spring-smoothed assembly explosion factor in `[0..1]`.
    public var explodeFactor: Float { currentExplodeFactor }
    /// Persistence namespace (`<xr-live persistent-anchors="room-a">`).
    public var persistentAnchorsNamespace: String?
    /// Optional custom key-value reader (defaults to `UserDefaults.standard` when unset).
    public var anchorStoreGet: ((_ key: String) -> String?)?
    /// Optional custom key-value writer (`value == nil` removes the key; defaults to `UserDefaults.standard`).
    public var anchorStoreSet: ((_ key: String, _ value: String?) -> Void)?
    /// Enables room-scale teleportation and snap-turn (`<xr-live locomotion>`).
    public var locomotionEnabled: Bool = false
    /// Discrete yaw step in degrees (`15..90`) for thumbstick snap-turn.
    public var snapTurnDeg: Float = 30
    /// Enables the `120ms` peripheral comfort vignette during teleports and snap-turns.
    public var comfortVignetteEnabled: Bool = true
    /// Current accumulated rig translation offset in meters from locomotion.
    public private(set) var rigOffset: SIMD3<Float> = .zero
    /// Current accumulated rig yaw angle in degrees from snap-turns.
    public private(set) var rigYawDeg: Float = 0
    /// Normalized `[0..1]` peripheral comfort vignette opacity for the current frame.
    public var comfortVignetteIntensity: Float {
      guard comfortVignetteEnabled, vignetteRemainingMs > 0 else { return 0 }
      return max(0, min(1, vignetteRemainingMs / SpatialLocomotion.comfortVignetteMs))
    }
    /// Local participant ID advertised on `shared-room` messages.
    public var localPeerId: String = "peer-\(UUID().uuidString.prefix(8).lowercased())"
    /// Local participant display name (`peer-name`, max 32 chars).
    public var peerName: String = "Peer"
    /// Local participant accent hex color (`peer-color`).
    public var peerColor: String = SharedRoom.defaultPeerColor
    /// Pluggable outbound room sender (e.g. `URLSessionWebSocketTask.send` or custom transport).
    public var roomSend: ((_ rawJson: String) -> Void)?
    /// Number of active remote peers in the shared room.
    public var peerCount: Int { remotePeers.count }
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
    private var gazeTraits: [Int: XRLiveGaze] = [:]
    private var pointerNoneNodes: Set<Int> = []
    private var smoothedGazeDir: SIMD3<Float>?
    private var activeGazeNode: Int = -1
    private var gazeElapsedMs: Float = 0
    private var gazeCompleted: Bool = false
    private var lastGazeHitPoint: SIMD3<Float> = .zero
    private var lastGazeHitNormal: SIMD3<Float> = SIMD3<Float>(0, 0, 1)
    private var gazeReticleEntity: ModelEntity?
    private var lastReticleBucket: Int = -1

    private struct RestPart {
      let node: Int
      let restTransform: XRNodeTransform
      let restWorldCenter: SIMD3<Float>
      let depth: Int
    }

    private final class RemotePeerVisual {
      let peerId: String
      var name: String
      var color: String
      var headPos: SIMD3<Float>
      var headQuat: simd_quatf
      var rayOrigin: SIMD3<Float>?
      var rayEnd: SIMD3<Float>?
      var hasHit: Bool
      var lastSeenMs: Int64
      var visorEntity: ModelEntity?
      var laserEntity: ModelEntity?
      var appliedColor: String = ""

      init(
        peerId: String,
        name: String,
        color: String,
        headPos: SIMD3<Float>,
        headQuat: simd_quatf,
        rayOrigin: SIMD3<Float>?,
        rayEnd: SIMD3<Float>?,
        hasHit: Bool,
        lastSeenMs: Int64
      ) {
        self.peerId = peerId
        self.name = name
        self.color = color
        self.headPos = headPos
        self.headQuat = headQuat
        self.rayOrigin = rayOrigin
        self.rayEnd = rayEnd
        self.hasHit = hasHit
        self.lastSeenMs = lastSeenMs
      }
    }

    private var explodeTraits: [Int: XRLiveExplode] = [:]
    private var anchorPersistTraits: [Int: XRLiveAnchorPersist] = [:]
    private var navigableTraits: [Int: String] = [:]
    private var syncTraits: [Int: Bool] = [:]
    private var grabbableNodes: Set<Int> = []
    private var remotePeers: [String: RemotePeerVisual] = [:]
    private var nodeLeases: [String: SharedRoom.NodeSoftLock] = [:]
    private var remoteStrokeEntities: [ModelEntity] = []
    private var lastPoseSentMs: Int64 = Int64.min / 2
    private var disposed: Bool = false
    private var restParts: [RestPart] = []
    private var restCaptured: Bool = false
    private var assemblyCenter: SIMD3<Float> = .zero
    private var assemblyRadius: Float = 0.5
    private var targetExplodeFactor: Float = 0
    private var currentExplodeFactor: Float = 0
    private var wasExploded: Bool = false
    private var explodeLeaderEntity: ModelEntity?
    private var sectionGizmoEntity: ModelEntity?
    private var lastSectionGizmoRadius: Float = -1
    private var teleportArcEntity: ModelEntity?
    private var teleportRingEntity: ModelEntity?
    private var teleportRingValidState: Bool?
    private var pendingTeleportPoint: SIMD3<Float>?
    private var pendingTeleportValid: Bool = false
    private var snapTurnLatched: Bool = false
    private var vignetteRemainingMs: Float = 0
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
        if let gz = traits.gaze, gz.enabled {
          gazeTraits[i] = gz
        }
        if let ex = traits.explode, ex.enabled {
          explodeTraits[i] = ex
        }
        if let ap = traits.anchorPersist {
          anchorPersistTraits[i] = ap
        }
        if let nav = traits.navigable {
          navigableTraits[i] = nav
        }
        if let sync = traits.sync {
          syncTraits[i] = sync
        }
        if traits.grabbable || traits.handles != nil {
          grabbableNodes.insert(i)
        }
        if traits.pointerEventsNone {
          pointerNoneNodes.insert(i)
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
      if !disposed, let sender = roomSend,
        let cleanId = XRLiveTraitParser.safeAnchorId(localPeerId)
      {
        sender(SharedRoom.serializeMessage(.leave(peerId: cleanId)))
      }
      disposed = true
      updateSubscription?.cancel()
      updateSubscription = nil
      for sc in splats { sc.loadTask?.cancel() }
      clearMeasurements()
      previewRingEntity?.removeFromParent()
      previewRingEntity = nil
      gazeReticleEntity?.removeFromParent()
      gazeReticleEntity = nil
      explodeLeaderEntity?.removeFromParent()
      explodeLeaderEntity = nil
      sectionGizmoEntity?.removeFromParent()
      sectionGizmoEntity = nil
      teleportArcEntity?.removeFromParent()
      teleportArcEntity = nil
      teleportRingEntity?.removeFromParent()
      teleportRingEntity = nil
      for peer in remotePeers.values {
        peer.visorEntity?.removeFromParent()
        peer.laserEntity?.removeFromParent()
      }
      remotePeers.removeAll()
      nodeLeases.removeAll()
      for se in remoteStrokeEntities { se.removeFromParent() }
      remoteStrokeEntities.removeAll()
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
      gazeTraits.removeAll()
      explodeTraits.removeAll()
      anchorPersistTraits.removeAll()
      navigableTraits.removeAll()
      syncTraits.removeAll()
      grabbableNodes.removeAll()
      restParts.removeAll()
      pointerNoneNodes.removeAll()
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
          if !(persistentAnchorsNamespace ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || anchorPersistTraits[active.node] != nil
          {
            _ = savePersistedAnchors()
          }
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
      if vignetteRemainingMs > 0 {
        vignetteRemainingMs = max(0, vignetteRemainingMs - dtClamped * 1000.0)
      }
      stepExplodedView(dt: dt)
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
          localMin: lb.min, localMax: lb.max, worldMatrix: session.worldMatrix(of: node))
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

    // MARK: Gaze Dwell & Exploded View

    private func isNodeGazeEligible(_ nodeIndex: Int) -> Bool {
      guard !pointerNoneNodes.contains(nodeIndex), live.session.isEffectivelyVisible(nodeIndex)
      else { return false }
      if gazeTraits[nodeIndex] != nil { return true }
      guard let t = live.session.traits(at: nodeIndex) else { return false }
      return t.grabbable || t.holdToAsk != nil
    }

    private func raycastGazeNode(
      origin: SIMD3<Float>,
      dir: SIMD3<Float>,
      maxDist: Float = 25.0
    ) -> (node: Int, point: SIMD3<Float>, normal: SIMD3<Float>)? {
      let session = live.session
      var bestNode = -1
      var bestT = maxDist
      var bestPoint = SIMD3<Float>.zero
      var bestNormal = SIMD3<Float>(0, 0, 1)
      for node in 0..<session.nodeCount {
        guard !pointerNoneNodes.contains(node), session.isEffectivelyVisible(node),
          let lb = resolvedNodeBounds(node)
        else { continue }
        let world = session.worldMatrix(of: node)
        let det = world.determinant
        guard det.isFinite, abs(det) > 1e-8 else { continue }
        let inv = world.inverse
        let lo4 = inv * SIMD4<Float>(origin.x, origin.y, origin.z, 1)
        let lf4 = inv * SIMD4<Float>(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z, 1)
        let lo = SIMD3<Float>(lo4.x, lo4.y, lo4.z)
        let ld = SIMD3<Float>(lf4.x - lo4.x, lf4.y - lo4.y, lf4.z - lo4.z)
        var tMin: Float = 0
        var tMax = Float.infinity
        var hitAxis = 0
        var hitSign: Float = -1
        var miss = false
        for k in 0..<3 {
          if abs(ld[k]) < 1e-8 {
            if lo[k] < lb.min[k] || lo[k] > lb.max[k] {
              miss = true
              break
            }
          } else {
            let invD = 1 / ld[k]
            var t1 = (lb.min[k] - lo[k]) * invD
            var t2 = (lb.max[k] - lo[k]) * invD
            var sign: Float = -1
            if t1 > t2 {
              swap(&t1, &t2)
              sign = 1
            }
            if t1 > tMin {
              tMin = t1
              hitAxis = k
              hitSign = sign
            }
            if t2 < tMax { tMax = t2 }
            if tMin > tMax {
              miss = true
              break
            }
          }
        }
        if miss || tMax < 1e-4 { continue }
        let tLocal = tMin >= 1e-4 ? tMin : tMax
        let lp = lo + ld * tLocal
        let wp4 = world * SIMD4<Float>(lp.x, lp.y, lp.z, 1)
        let wp = SIMD3<Float>(wp4.x, wp4.y, wp4.z)
        let dist = simd_length(wp - origin)
        if dist >= bestT { continue }
        var ln = SIMD3<Float>.zero
        ln[hitAxis] = hitSign
        let invT = inv.transpose
        let wn4 = invT * SIMD4<Float>(ln.x, ln.y, ln.z, 0)
        var wn = XRSpatialMath.normalize(
          SIMD3<Float>(wn4.x, wn4.y, wn4.z), fallback: -dir)
        if simd_dot(wn, dir) > 0 { wn = -wn }
        bestNode = node
        bestT = dist
        bestPoint = wp
        bestNormal = wn
      }
      return bestNode >= 0 ? (bestNode, bestPoint, bestNormal) : nil
    }

    /// Steps `gaze-dwell` for the current eye/head ray, updating the constant-angular-size reticle
    /// and firing `onGazeEnter`, `onGazeLeave`, and `onGazeDwell`.
    public func stepGazeDwell(
      origin: SIMD3<Float>,
      rawDirection: SIMD3<Float>,
      dtSeconds: TimeInterval,
      autoEnabled: Bool = false
    ) {
      let active: Bool
      switch gazeDwellMode {
      case "on", "true": active = true
      case "auto": active = autoEnabled
      default: active = !gazeTraits.isEmpty
      }
      guard active else {
        clearActiveGaze()
        return
      }
      let dir = GazeDwell.smoothDirection(prev: smoothedGazeDir, raw: rawDirection)
      smoothedGazeDir = dir
      let hit = raycastGazeNode(origin: origin, dir: dir)
      var candidateNode = (hit != nil && isNodeGazeEligible(hit!.node)) ? hit!.node : -1
      var hitPoint = hit?.point ?? .zero
      var hitNormal = hit?.normal ?? SIMD3<Float>(0, 0, 1)

      if candidateNode != activeGazeNode && activeGazeNode >= 0
        && live.session.isEffectivelyVisible(activeGazeNode)
      {
        let toPrev = lastGazeHitPoint - origin
        if simd_length(toPrev) > 1e-4
          && GazeDwell.angleBetweenDeg(dir, toPrev) <= GazeDwell.graceConeDeg
        {
          candidateNode = activeGazeNode
          hitPoint = lastGazeHitPoint
          hitNormal = lastGazeHitNormal
        }
      }

      if candidateNode < 0 {
        clearActiveGaze()
        return
      }

      if candidateNode != activeGazeNode {
        if activeGazeNode >= 0 { onGazeLeave?(activeGazeNode) }
        activeGazeNode = candidateNode
        gazeElapsedMs = 0
        gazeCompleted = false
        lastGazeHitPoint = hitPoint
        lastGazeHitNormal = hitNormal
        onGazeEnter?(candidateNode, hitPoint, hitNormal)
      } else {
        lastGazeHitPoint = hitPoint
        lastGazeHitNormal = hitNormal
      }

      let trait = gazeTraits[candidateNode]
      let dwellMs = Float(max(250, min(10000, trait?.dwellMs ?? defaultDwellMs)))
      let repeatDwell = trait?.repeatDwell ?? false
      let action =
        trait?.action
        ?? (live.session.traits(at: candidateNode)?.holdToAsk != nil ? "ask" : "select")
      let dtMs = Float(max(0, min(0.1, dtSeconds.isFinite ? dtSeconds : 0))) * 1000
      var progress: Float = 0

      if !gazeCompleted {
        gazeElapsedMs += dtMs
        progress = GazeDwell.computeDwellProgress(elapsedMs: gazeElapsedMs, dwellMs: dwellMs)
        if progress >= 1 {
          onGazeDwell?(candidateNode, action, lastGazeHitPoint)
          if action == "select" {
            live.session.dispatchSelect(nodeIndex: candidateNode, hitPoint: lastGazeHitPoint)
          }
          if repeatDwell {
            gazeElapsedMs = 0
            progress = 0
          } else {
            gazeCompleted = true
            progress = 0
          }
        }
      }

      let bucket = Int((progress * 24).rounded())
      if gazeReticleEntity == nil || bucket != lastReticleBucket {
        lastReticleBucket = bucket
        let geo = GazeDwell.buildReticleGeometry(progress: Float(bucket) / 24, segments: 24)
        if let rMesh = Self.mesh(geo) {
          let mat = Self.material(Self.parseHexRgba("#38bdf8", alpha: 0.92))
          if let existing = gazeReticleEntity {
            existing.model = ModelComponent(mesh: rMesh, materials: [mat])
          } else {
            let re = ModelEntity(mesh: rMesh, materials: [mat])
            container.addChild(re)
            gazeReticleEntity = re
          }
        }
      }
      if let re = gazeReticleEntity {
        re.isEnabled = true
        let dist = max(0.15, simd_length(lastGazeHitPoint - origin))
        let outerR = max(0.004, GazeDwell.reticleAngularScale * dist)
        let offsetPos = lastGazeHitPoint + lastGazeHitNormal * 0.003
        let q = GazeDwell.quatFromUnitVectors(from: SIMD3<Float>(0, 0, 1), to: lastGazeHitNormal)
        re.setTransformMatrix(
          XRSpatialMath.compose(
            translation: offsetPos, rotation: q, scale: SIMD3<Float>(repeating: outerR)),
          relativeTo: nil)
      }
    }

    private func clearActiveGaze() {
      if activeGazeNode >= 0 {
        let prev = activeGazeNode
        activeGazeNode = -1
        gazeElapsedMs = 0
        gazeCompleted = false
        onGazeLeave?(prev)
      }
      gazeReticleEntity?.isEnabled = false
    }

    /// Sets the target explosion factor in `[0..1]` and notifies `onExplodeChange` when changed.
    public func setExplode(_ factor: Float, source: String = "api") {
      let clamped = Float(XRJSON.clampNum(Double(factor), 0, 1, 0))
      if abs(clamped - targetExplodeFactor) <= 1e-4 { return }
      targetExplodeFactor = clamped
      onExplodeChange?(clamped, source)
    }

    private func ensureRestAssemblyCaptured() {
      if restCaptured { return }
      restCaptured = true
      restParts.removeAll()
      let session = live.session
      var bMin = SIMD3<Float>(repeating: .infinity)
      var bMax = SIMD3<Float>(repeating: -.infinity)
      for node in 0..<session.nodeCount {
        guard let lb = resolvedNodeBounds(node), let t = session.nodeTransform(at: node) else {
          continue
        }
        let wb = SpatialMeasure.computeWorldBounds(
          localMin: lb.min, localMax: lb.max, worldMatrix: session.worldMatrix(of: node))
        bMin = simd_min(bMin, wb.min)
        bMax = simd_max(bMax, wb.max)
        var depth = 1
        var p = session.parentIndex(of: node)
        while let cur = p, depth < 32 {
          depth += 1
          p = session.parentIndex(of: cur)
        }
        restParts.append(
          RestPart(
            node: node, restTransform: t, restWorldCenter: wb.center, depth: depth))
      }
      if bMin.x.isFinite {
        assemblyCenter = (bMin + bMax) * 0.5
        assemblyRadius = max(0.05, simd_length(bMax - bMin) * 0.5)
      }
    }

    /// Steps `exploded-view` spring smoothing, node offsets, dashed leader lines, and section gizmo.
    public func stepExplodedView(dt: TimeInterval) {
      let sec = ExplodedView.parseSectionPlane(sectionPlaneSpec, defaultCenter: assemblyCenter)
      if targetExplodeFactor <= 1e-5 && currentExplodeFactor <= 1e-5 && !sec.enabled {
        explodeLeaderEntity?.isEnabled = false
        sectionGizmoEntity?.isEnabled = false
        return
      }
      ensureRestAssemblyCaptured()
      let dtClamped = Float(max(0, min(0.1, dt.isFinite ? dt : 0)))
      let alpha = 1 - exp(-12 * dtClamped)
      currentExplodeFactor += (targetExplodeFactor - currentExplodeFactor) * alpha
      if abs(targetExplodeFactor - currentExplodeFactor) < 1e-4 {
        currentExplodeFactor = targetExplodeFactor
      }

      var maxLayer = 1
      for tr in explodeTraits.values { maxLayer = max(maxLayer, tr.layer) }
      let explicitOnly = !explodeTraits.isEmpty
      var leaderSegs: [(SIMD3<Float>, SIMD3<Float>)] = []
      let isNowExploded = currentExplodeFactor > 1e-5 || targetExplodeFactor > 0

      if isNowExploded || wasExploded {
        if isNowExploded && !wasExploded {
          restCaptured = false
          ensureRestAssemblyCaptured()
        }
        for (idx, part) in restParts.enumerated() {
          let tr = explodeTraits[part.node]
          if explicitOnly && tr == nil { continue }
          let offset = ExplodedView.computeNodeOffset(
            restPosition: part.restWorldCenter,
            assemblyCenter: assemblyCenter,
            assemblyRadius: assemblyRadius,
            factor: currentExplodeFactor,
            mode: explodeMode,
            explodeScale: explodeScale,
            trait: tr,
            maxLayer: maxLayer,
            nodeIndex: idx,
            nodeCount: restParts.count,
            hierarchyDepth: part.depth
          )
          live.setNodeTransform(
            part.node,
            XRNodeTransform(
              translation: part.restTransform.translation + offset,
              rotation: part.restTransform.rotation,
              scale: part.restTransform.scale
            ))
          if currentExplodeFactor > 0.02 && (tr?.leaderLine != false),
            let lb = resolvedNodeBounds(part.node)
          {
            let curWb = SpatialMeasure.computeWorldBounds(
              localMin: lb.min, localMax: lb.max, worldMatrix: live.session.worldMatrix(of: part.node))
            if simd_length(curWb.center - part.restWorldCenter) > 0.01 && leaderSegs.count < 512 {
              leaderSegs.append(
                contentsOf: SpatialMeasure.buildDashedSegments(
                  start: part.restWorldCenter, end: curWb.center))
            }
          }
        }
        wasExploded = isNowExploded
      }

      if leaderSegs.isEmpty {
        explodeLeaderEntity?.isEnabled = false
      } else {
        let geo = SpatialMeasure.buildSegmentBarsGeometry(leaderSegs, halfThickness: 0.0014)
        if let lMesh = Self.mesh(geo) {
          let mat = Self.material(Self.parseHexRgba("#94a3b8", alpha: 0.85))
          if let existing = explodeLeaderEntity {
            existing.model = ModelComponent(mesh: lMesh, materials: [mat])
          } else {
            let le = ModelEntity(mesh: lMesh, materials: [mat])
            container.addChild(le)
            explodeLeaderEntity = le
          }
          explodeLeaderEntity?.isEnabled = true
          explodeLeaderEntity?.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
        }
      }

      if sec.enabled {
        let halfExt = max(0.15, assemblyRadius * 1.15)
        if sectionGizmoEntity == nil || abs(halfExt - lastSectionGizmoRadius) > 1e-3 {
          sectionGizmoEntity?.removeFromParent()
          let gGeo = ExplodedView.buildSectionGizmoGeometry(halfExtent: halfExt)
          if let gMesh = Self.mesh(gGeo) {
            let mat = Self.material(Self.parseHexRgba("#38bdf8", alpha: 0.9))
            let ge = ModelEntity(mesh: gMesh, materials: [mat])
            container.addChild(ge)
            sectionGizmoEntity = ge
            lastSectionGizmoRadius = halfExt
          }
        }
        if let ge = sectionGizmoEntity {
          ge.isEnabled = true
          let d = sec.constant - simd_dot(assemblyCenter, sec.normal)
          let planeCenter = assemblyCenter + sec.normal * d
          let q = GazeDwell.quatFromUnitVectors(from: SIMD3<Float>(0, 0, 1), to: sec.normal)
          ge.setTransformMatrix(
            XRSpatialMath.compose(
              translation: planeCenter, rotation: q, scale: SIMD3<Float>(1, 1, 1)),
            relativeTo: nil)
        }
      } else {
        sectionGizmoEntity?.isEnabled = false
      }
    }

    // MARK: Persistent Anchors

    private func readAnchorStore(_ key: String) -> String? {
      if let reader = anchorStoreGet { return reader(key) }
      return UserDefaults.standard.string(forKey: key)
    }

    private func writeAnchorStore(_ key: String, _ value: String?) {
      if let writer = anchorStoreSet {
        writer(key, value)
      } else if let v = value {
        UserDefaults.standard.set(v, forKey: key)
      } else {
        UserDefaults.standard.removeObject(forKey: key)
      }
    }

    private func resolveStorageKey() -> String? {
      let raw = persistentAnchorsNamespace?.trimmingCharacters(in: .whitespacesAndNewlines)
      if let r = raw?.lowercased(), r == "false" || r == "none" { return nil }
      let ns: String
      if raw == nil || raw!.isEmpty || raw!.lowercased() == "true" {
        guard !anchorPersistTraits.isEmpty || raw != nil else { return nil }
        ns = "default"
      } else {
        guard let clean = XRLiveTraitParser.safeAnchorId(raw) else { return nil }
        ns = clean
      }
      return PersistentAnchors.anchorStoragePrefix + ns
    }

    private func resolveNodePersistKey(_ node: Int) -> String? {
      if let trait = anchorPersistTraits[node] {
        guard trait.persist else { return nil }
        if let id = trait.id { return id }
      } else {
        let hasNs =
          !(persistentAnchorsNamespace ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
          .isEmpty
        guard hasNs, grabbableNodes.contains(node) else { return nil }
      }
      return XRLiveTraitParser.safeAnchorId(live.session.nodeName(at: node)) ?? "node_\(node)"
    }

    private func collectPersistedPoses() -> [String: PersistentAnchors.PersistedPose] {
      var poses: [String: PersistentAnchors.PersistedPose] = [:]
      let session = live.session
      for node in 0..<session.nodeCount {
        if poses.count >= PersistentAnchors.maxPersistedNodes { break }
        guard let key = resolveNodePersistKey(node),
          let t = session.nodeTransform(at: node),
          let clean = PersistentAnchors.sanitizePose(
            p: t.translation, q: t.rotation, s: t.scale)
        else { continue }
        poses[key] = clean
      }
      return poses
    }

    private func applyPersistedPoses(_ poses: [String: PersistentAnchors.PersistedPose]) -> Int {
      var applied = 0
      let session = live.session
      for node in 0..<session.nodeCount {
        let explicitId = anchorPersistTraits[node]?.id
        let fallbackKey =
          XRLiveTraitParser.safeAnchorId(session.nodeName(at: node)) ?? "node_\(node)"
        let pose = (explicitId != nil ? poses[explicitId!] : nil) ?? poses[fallbackKey]
        guard let p = pose else { continue }
        live.setNodeTransform(
          node, XRNodeTransform(translation: p.p, rotation: p.q, scale: p.s))
        applied += 1
      }
      return applied
    }

    /// Saves current persisted/manipulable node transforms to the active namespace store.
    @discardableResult
    public func savePersistedAnchors() -> Int {
      guard let storageKey = resolveStorageKey() else { return 0 }
      let poses = collectPersistedPoses()
      writeAnchorStore(storageKey, PersistentAnchors.serializePayload(poses))
      return poses.count
    }

    /// Restores persisted node transforms from an optional `#xr-state=` `urlHash` (highest
    /// priority) or the active namespace store, firing `onAnchorsRestored`.
    @discardableResult
    public func restorePersistedAnchors(urlHash: String? = nil) -> Int {
      if let token = PersistentAnchors.extractHashToken(urlHash),
        let fromHash = PersistentAnchors.decodeState(token), !fromHash.isEmpty
      {
        let count = applyPersistedPoses(fromHash)
        if count > 0 { onAnchorsRestored?(count, "url-hash") }
        return count
      }
      guard let storageKey = resolveStorageKey(),
        let raw = readAnchorStore(storageKey),
        let fromStore = PersistentAnchors.deserializePayload(raw)
      else { return 0 }
      let count = applyPersistedPoses(fromStore)
      if count > 0 { onAnchorsRestored?(count, "storage") }
      return count
    }

    /// Exports all persisted/grabbable node transforms as a base64url `#xr-state=` token.
    public func exportAnchorState() -> String {
      PersistentAnchors.encodeState(collectPersistedPoses())
    }

    /// Imports and applies a base64url `#xr-state=` token, returning the number of restored nodes.
    @discardableResult
    public func importAnchorState(_ token: String, source: String = "url-hash") -> Int {
      guard let decoded = PersistentAnchors.decodeState(token) else { return 0 }
      let count = applyPersistedPoses(decoded)
      if count > 0 {
        if let storageKey = resolveStorageKey() {
          writeAnchorStore(storageKey, PersistentAnchors.serializePayload(decoded))
        }
        onAnchorsRestored?(count, source)
      }
      return count
    }

    /// Clears persisted anchor data for the active namespace.
    public func clearPersistedAnchors() {
      if let storageKey = resolveStorageKey() {
        writeAnchorStore(storageKey, nil)
      }
    }

    // MARK: Spatial Locomotion

    /// Evaluates a ballistic parabolic teleport arc from `(origin, direction)`, updating the 3D
    /// arc ribbon and landing target ring RealityKit entities.
    public func aimTeleport(
      origin: SIMD3<Float>,
      direction: SIMD3<Float>
    ) -> SpatialLocomotion.TeleportArcHit {
      let samples = SpatialLocomotion.sampleParabola(origin: origin, direction: direction)
      let fy = Float(XRJSON.clampNum(Double(floorY ?? 0), -100, 100, 0))
      let hasExplicitWalkable = navigableTraits.values.contains("walkable")
      var visited: [SIMD3<Float>] = [samples[0]]
      var hitResult: SpatialLocomotion.TeleportArcHit?

      for i in 0..<(samples.count - 1) {
        let a = samples[i]
        let b = samples[i + 1]
        let delta = b - a
        let segLen = simd_length(delta)
        if segLen < 1e-5 { continue }
        let segDir = delta / segLen

        if let rayHit = raycastGazeNode(origin: a, dir: segDir, maxDist: segLen + 1e-4) {
          visited.append(rayHit.point)
          let nav = navigableTraits[rayHit.node]
          let slopeOk = rayHit.normal.y > SpatialLocomotion.minWalkableNormalY
          let navOk = hasExplicitWalkable ? (nav == "walkable") : (nav != "blocked")
          hitResult = SpatialLocomotion.TeleportArcHit(
            valid: slopeOk && navOk,
            point: rayHit.point,
            normal: rayHit.normal,
            points: visited,
            hitNodeIndex: rayHit.node
          )
          break
        }

        if !hasExplicitWalkable && a.y >= fy && b.y <= fy && a.y != b.y {
          let u = (a.y - fy) / (a.y - b.y)
          let groundPt = SIMD3<Float>(a.x + delta.x * u, fy, a.z + delta.z * u)
          visited.append(groundPt)
          hitResult = SpatialLocomotion.TeleportArcHit(
            valid: true,
            point: groundPt,
            normal: SIMD3<Float>(0, 1, 0),
            points: visited,
            hitNodeIndex: -1
          )
          break
        }

        visited.append(b)
      }

      let resolved =
        hitResult
        ?? SpatialLocomotion.TeleportArcHit(
          valid: false,
          point: visited.last ?? origin,
          normal: SIMD3<Float>(0, 1, 0),
          points: visited,
          hitNodeIndex: -1
        )

      pendingTeleportPoint = resolved.point
      pendingTeleportValid = resolved.valid

      let matColor =
        resolved.valid
        ? Self.parseHexRgba("#38bdf8", alpha: 0.9)
        : Self.parseHexRgba("#f43f5e", alpha: 0.9)
      let mat = Self.material(matColor)
      let arcGeo = SpatialLocomotion.buildArcGeometry(resolved.points)
      if let aMesh = Self.mesh(arcGeo) {
        if let existing = teleportArcEntity {
          existing.model = ModelComponent(mesh: aMesh, materials: [mat])
        } else {
          let ae = ModelEntity(mesh: aMesh, materials: [mat])
          container.addChild(ae)
          teleportArcEntity = ae
        }
        teleportArcEntity?.isEnabled = true
        teleportArcEntity?.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
      }

      if teleportRingEntity == nil || teleportRingValidState != resolved.valid {
        teleportRingEntity?.removeFromParent()
        let rGeo = MagneticSnap.buildSnapRingGeometry(majorRadius: 0.18, tubeRadius: 0.016)
        if let rMesh = Self.mesh(rGeo) {
          let re = ModelEntity(mesh: rMesh, materials: [mat])
          container.addChild(re)
          teleportRingEntity = re
          teleportRingValidState = resolved.valid
        }
      }
      if let re = teleportRingEntity {
        re.isEnabled = true
        let ringPos = resolved.point + resolved.normal * 0.006
        let ringQuat = GazeDwell.quatFromUnitVectors(
          from: SIMD3<Float>(0, 1, 0), to: resolved.normal)
        re.setTransformMatrix(
          XRSpatialMath.compose(
            translation: ringPos, rotation: ringQuat, scale: SIMD3<Float>(1, 1, 1)),
          relativeTo: nil)
      }

      return resolved
    }

    /// Cancels any active teleport preview and hides the arc and landing ring entities.
    public func cancelTeleport() {
      pendingTeleportPoint = nil
      pendingTeleportValid = false
      teleportArcEntity?.isEnabled = false
      teleportRingEntity?.isEnabled = false
    }

    /// Commits the currently aimed teleport if valid, updating `rigOffset` and firing `onTeleport`.
    @discardableResult
    public func commitTeleport() -> Bool {
      let target = pendingTeleportPoint
      let valid = pendingTeleportValid
      cancelTeleport()
      guard valid, let dst = target else { return false }
      let from = rigOffset
      rigOffset = dst
      if comfortVignetteEnabled {
        vignetteRemainingMs = SpatialLocomotion.comfortVignetteMs
      }
      onTeleport?(from, rigOffset, rigYawDeg)
      return true
    }

    /// Applies horizontal thumbstick deflection (`-1..1`) using hysteresis-guarded discrete
    /// snap-turns, returning the applied yaw delta in degrees (`0` when latched or below threshold).
    @discardableResult
    public func applySnapTurnAxis(_ axisX: Float) -> Float {
      let step = SpatialLocomotion.evaluateSnapTurn(
        axisX: axisX, wasLatched: snapTurnLatched, snapTurnDeg: snapTurnDeg)
      snapTurnLatched = step.latched
      if step.deltaYawDeg != 0 {
        var next = (rigYawDeg + step.deltaYawDeg).truncatingRemainder(dividingBy: 360)
        if next > 180 { next -= 360 }
        if next <= -180 { next += 360 }
        rigYawDeg = next
        if comfortVignetteEnabled {
          vignetteRemainingMs = SpatialLocomotion.comfortVignetteMs
        }
      }
      return step.deltaYawDeg
    }

    // MARK: Shared Room (Multi-User Co-Presence & State Sync)

    private func shouldSyncNode(_ node: Int) -> Bool {
      syncTraits[node] ?? grabbableNodes.contains(node)
    }

    private func syncNodeKey(_ node: Int) -> String {
      anchorPersistTraits[node]?.id
        ?? XRLiveTraitParser.safeAnchorId(live.session.nodeName(at: node))
        ?? "node_\(node)"
    }

    /// Returns the current soft-lock owner for `nodeId` if unexpired at `atMs`.
    public func getNodeOwner(
      _ nodeId: String,
      atMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> String? {
      guard let lease = nodeLeases[nodeId] else { return nil }
      return atMs < lease.leaseUntilMs ? lease.ownerPeerId : nil
    }

    /// Broadcasts a rate-limited (`20 Hz`) local head + pointer ray pose tick.
    @discardableResult
    public func broadcastPoseTick(
      headPos: SIMD3<Float>,
      headQuat: simd_quatf,
      rayOrigin: SIMD3<Float>? = nil,
      rayEnd: SIMD3<Float>? = nil,
      hasHit: Bool = false,
      atMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
      force: Bool = false
    ) -> Bool {
      guard !disposed, let sender = roomSend else { return false }
      if !force && atMs - lastPoseSentMs < SharedRoom.poseTickIntervalMs { return false }
      guard let cleanId = XRLiveTraitParser.safeAnchorId(localPeerId) else { return false }
      lastPoseSentMs = atMs
      let json = SharedRoom.serializeMessage(
        .pose(
          peerId: cleanId,
          name: peerName,
          color: peerColor,
          headPos: headPos,
          headQuat: headQuat,
          rayOrigin: rayOrigin,
          rayEnd: rayEnd,
          hasHit: hasHit
        ))
      guard json.utf8.count <= SharedRoom.maxPayloadBytes else { return false }
      sender(json)
      return true
    }

    /// Acquires/renews the local soft-lock lease for `nodeIndex` and broadcasts its transform delta.
    @discardableResult
    public func broadcastNodeDelta(
      nodeIndex: Int,
      grabState: String = "move",
      atMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Bool {
      let session = live.session
      guard !disposed, nodeIndex >= 0, nodeIndex < session.nodeCount,
        shouldSyncNode(nodeIndex),
        let sender = roomSend,
        let cleanId = XRLiveTraitParser.safeAnchorId(localPeerId)
      else { return false }
      let nodeId = syncNodeKey(nodeIndex)
      guard SharedRoom.canAcquireNodeLease(
        existing: nodeLeases[nodeId], candidatePeerId: cleanId, atMs: atMs)
      else { return false }
      if grabState == "release" {
        nodeLeases.removeValue(forKey: nodeId)
      } else {
        nodeLeases[nodeId] = SharedRoom.NodeSoftLock(
          ownerPeerId: cleanId, leaseUntilMs: atMs + SharedRoom.softLockTtlMs)
      }
      guard let t = session.nodeTransform(at: nodeIndex),
        let clean = PersistentAnchors.sanitizePose(p: t.translation, q: t.rotation, s: t.scale)
      else { return false }
      let json = SharedRoom.serializeMessage(
        .node(
          peerId: cleanId, nodeId: nodeId, p: clean.p, q: clean.q, s: clean.s,
          grabState: grabState))
      guard json.utf8.count <= SharedRoom.maxPayloadBytes else { return false }
      sender(json)
      return true
    }

    /// Broadcasts an `exploded-view` factor change (`[0..1]`) to room peers.
    @discardableResult
    public func broadcastExplode(_ factor: Float) -> Bool {
      guard !disposed, factor.isFinite, let sender = roomSend,
        let cleanId = XRLiveTraitParser.safeAnchorId(localPeerId)
      else { return false }
      sender(SharedRoom.serializeMessage(.explode(peerId: cleanId, factor: factor)))
      return true
    }

    /// Broadcasts a `spatial-paint` 3D stroke chunk to room peers.
    @discardableResult
    public func broadcastPaintStroke(
      strokeId: String,
      points: [SIMD3<Float>],
      color: String? = nil,
      radius: Float = 0.01
    ) -> Bool {
      guard !disposed, points.count >= 2, let sender = roomSend,
        let cleanPeerId = XRLiveTraitParser.safeAnchorId(localPeerId),
        let cleanStrokeId = XRLiveTraitParser.safeAnchorId(strokeId)
      else { return false }
      let stride =
        points.count > SharedRoom.maxStrokeChunkPoints
        ? (points.count + SharedRoom.maxStrokeChunkPoints - 1) / SharedRoom.maxStrokeChunkPoints : 1
      var sampled: [SIMD3<Float>] = []
      var i = 0
      while i < points.count && sampled.count < SharedRoom.maxStrokeChunkPoints {
        let p = points[i]
        if p.x.isFinite && p.y.isFinite && p.z.isFinite {
          sampled.append(p)
        }
        i += stride
      }
      if let lastPt = points.last,
        lastPt.x.isFinite && lastPt.y.isFinite && lastPt.z.isFinite,
        sampled.count < SharedRoom.maxStrokeChunkPoints
      {
        if let prev = sampled.last {
          if simd_length(lastPt - prev) > 1e-4 { sampled.append(lastPt) }
        } else {
          sampled.append(lastPt)
        }
      }
      guard sampled.count >= 2 else { return false }
      let clampedR = max(0.002, min(0.1, radius.isFinite ? radius : 0.01))
      let json = SharedRoom.serializeMessage(
        .paint(
          peerId: cleanPeerId,
          strokeId: cleanStrokeId,
          color: SharedRoom.sanitizePeerColor(color ?? peerColor),
          radius: clampedR,
          points: sampled
        ))
      guard json.utf8.count <= SharedRoom.maxPayloadBytes else { return false }
      sender(json)
      return true
    }

    /// Processes an incoming room JSON payload, updating peer avatars, soft-locks, and scene state.
    @discardableResult
    public func handleRoomMessage(
      _ rawJson: String,
      atMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Bool {
      guard !disposed, let msg = SharedRoom.parseMessage(rawJson) else { return false }
      let selfId = XRLiveTraitParser.safeAnchorId(localPeerId)
      if msg.peerId == selfId { return false }

      switch msg {
      case .leave(let peerId):
        return removeRemotePeer(peerId)
      case .pose(let peerId, let name, let color, let headPos, let headQuat, let ro, let re, let hit):
        let peer: RemotePeerVisual
        var joined = false
        if let existing = remotePeers[peerId] {
          existing.name = name
          existing.color = color
          existing.headPos = headPos
          existing.headQuat = headQuat
          existing.rayOrigin = ro
          existing.rayEnd = re
          existing.hasHit = hit
          existing.lastSeenMs = atMs
          peer = existing
        } else {
          guard remotePeers.count < SharedRoom.maxPeers else { return false }
          let created = RemotePeerVisual(
            peerId: peerId, name: name, color: color, headPos: headPos, headQuat: headQuat,
            rayOrigin: ro, rayEnd: re, hasHit: hit, lastSeenMs: atMs)
          remotePeers[peerId] = created
          peer = created
          joined = true
        }
        syncRemotePeerVisual(peer)
        if joined { onPeerJoin?(peer.peerId, peer.name, peer.color) }
        return true
      case .node(let peerId, let nodeId, let p, let q, let s, let grabState):
        remotePeers[peerId]?.lastSeenMs = atMs
        guard SharedRoom.canAcquireNodeLease(
          existing: nodeLeases[nodeId], candidatePeerId: peerId, atMs: atMs)
        else { return false }
        if grabState == "release" {
          nodeLeases.removeValue(forKey: nodeId)
        } else {
          nodeLeases[nodeId] = SharedRoom.NodeSoftLock(
            ownerPeerId: peerId, leaseUntilMs: atMs + SharedRoom.softLockTtlMs)
        }
        for node in 0..<live.session.nodeCount {
          if syncNodeKey(node) == nodeId && shouldSyncNode(node) {
            live.setNodeTransform(node, XRNodeTransform(translation: p, rotation: q, scale: s))
            onPeerSync?(peerId, nodeId)
            break
          }
        }
        return true
      case .explode(let peerId, let factor):
        remotePeers[peerId]?.lastSeenMs = atMs
        setExplode(factor, source: "peer")
        onPeerSync?(peerId, "__explode__")
        return true
      case .paint(let peerId, let strokeId, let color, let radius, let points):
        remotePeers[peerId]?.lastSeenMs = atMs
        var builder = TubeStrokeBuilder(radius: radius)
        for pt in points { _ = builder.addPoint(pt) }
        if let geo = builder.build(), let sMesh = Self.mesh(geo) {
          while remoteStrokeEntities.count >= SharedRoom.maxRemoteStrokes {
            remoteStrokeEntities.removeFirst().removeFromParent()
          }
          let mat = Self.material(Self.parseHexRgba(color, alpha: 1))
          let se = ModelEntity(mesh: sMesh, materials: [mat])
          container.addChild(se)
          se.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
          remoteStrokeEntities.append(se)
        }
        onPeerSync?(peerId, "paint:\(strokeId)")
        return true
      }
    }

    /// Prunes remote peers silent for longer than `SharedRoom.peerTimeoutMs`.
    @discardableResult
    public func pruneStalePeers(
      atMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
    ) -> Int {
      var removed = 0
      for id in Array(remotePeers.keys) {
        guard let p = remotePeers[id] else { continue }
        if atMs - p.lastSeenMs > SharedRoom.peerTimeoutMs {
          if removeRemotePeer(id) { removed += 1 }
        }
      }
      return removed
    }

    private func removeRemotePeer(_ peerId: String) -> Bool {
      guard let p = remotePeers.removeValue(forKey: peerId) else { return false }
      p.visorEntity?.removeFromParent()
      p.laserEntity?.removeFromParent()
      let owned = nodeLeases.filter { $0.value.ownerPeerId == peerId }.map { $0.key }
      for k in owned { nodeLeases.removeValue(forKey: k) }
      onPeerLeave?(p.peerId, p.name, p.color)
      return true
    }

    private func syncRemotePeerVisual(_ peer: RemotePeerVisual) {
      if peer.visorEntity == nil || peer.appliedColor != peer.color {
        peer.visorEntity?.removeFromParent()
        let vGeo = SharedRoom.buildPeerVisorGeometry()
        if let vMesh = Self.mesh(vGeo) {
          let mat = Self.material(Self.parseHexRgba(peer.color, alpha: 0.92))
          let ve = ModelEntity(mesh: vMesh, materials: [mat])
          container.addChild(ve)
          peer.visorEntity = ve
          peer.appliedColor = peer.color
        }
      }
      peer.visorEntity?.setTransformMatrix(
        XRSpatialMath.compose(
          translation: peer.headPos, rotation: peer.headQuat, scale: SIMD3<Float>(1, 1, 1)),
        relativeTo: nil)

      if let ro = peer.rayOrigin, let re = peer.rayEnd {
        let lGeo = SharedRoom.buildPeerLaserGeometry(origin: ro, end: re, hasHit: peer.hasHit)
        if let lMesh = Self.mesh(lGeo) {
          let mat = Self.material(Self.parseHexRgba(peer.color, alpha: 0.78))
          if let existing = peer.laserEntity {
            existing.model = ModelComponent(mesh: lMesh, materials: [mat])
            existing.isEnabled = true
          } else {
            let le = ModelEntity(mesh: lMesh, materials: [mat])
            container.addChild(le)
            peer.laserEntity = le
          }
          peer.laserEntity?.setTransformMatrix(matrix_identity_float4x4, relativeTo: nil)
        }
      } else {
        peer.laserEntity?.isEnabled = false
      }
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
