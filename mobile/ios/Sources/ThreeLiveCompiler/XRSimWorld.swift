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

// Native runtime for the optional `xr-live-sim` plugins (port of
// xr-live/src/sim/core.ts and XRSimWorld.kt). Every glTF node whose `extras.xr`
// carries sim traits becomes a `Body`; systems step at a fixed 60 Hz and move
// bodies by world position and yaw, written back through
// `XRLiveRuntimeSession.setNodeWorldPose` / `setNodeVisible`. Spawned
// instances have no glTF node: renderers mirror them from
// `XRSimWorldDelegate.simInstancePose`. Events use the web names and detail
// keys. Not thread-safe: drive from one thread (typically the main actor).

import Foundation
import simd

/// Receives sim events and render hints synchronously inside `XRSimWorld.step`.
public protocol XRSimWorldDelegate: AnyObject {
  /// A sim event with the web event name and detail keys.
  func simEvent(_ type: String, detail: [String: Any])
  /// The controlled character's animation clip changed.
  func simCharacterClip(_ name: String)
  /// A spawned instance of glTF node `templateNodeIndex` moved or changed visibility.
  func simInstancePose(
    _ instanceId: String, templateNodeIndex: Int, position: SIMD3<Double>, rotation: simd_quatd,
    visible: Bool)
  /// A spawned instance was removed.
  func simInstanceRemoved(_ instanceId: String)
  /// A `synth-audio` cue should play (`pan` -1...1, `gain` 0...1). See `SynthAudio`.
  func simAudioCue(_ cue: String, pan: Double, gain: Double, pitch: Double)
}

extension XRSimWorldDelegate {
  public func simEvent(_ type: String, detail: [String: Any]) {}
  public func simCharacterClip(_ name: String) {}
  public func simInstancePose(
    _ instanceId: String, templateNodeIndex: Int, position: SIMD3<Double>, rotation: simd_quatd,
    visible: Bool
  ) {}
  public func simInstanceRemoved(_ instanceId: String) {}
  public func simAudioCue(_ cue: String, pan: Double, gain: Double, pitch: Double) {}
}

/// Per-viewer `xr-live-sim` state.
public final class XRSimWorld {
  /// One simulated node or spawned instance.
  public final class Body {
    public let key: String
    public let name: String
    /// glTF node index (the template node for spawned instances).
    public let nodeIndex: Int
    public let traits: XRSimTraits
    public let initPos: SIMD3<Double>
    let initQuat: simd_quatd
    /// AABB center offset from `pos` at yaw 0.
    public let center: SIMD3<Double>
    /// AABB half extents.
    public let half: SIMD3<Double>
    public let radius: Double
    public var pos: SIMD3<Double>
    public var yaw = 0.0
    public var rot = simd_quatd(ix: 0, iy: 0, iz: 0, r: 1)
    public var vel = SIMD3<Double>(repeating: 0)
    public var hidden = false
    public internal(set) var isTemplate = false
    /// Key of the spawner that created this instance, or `nil` for glTF nodes.
    public internal(set) var spawnedFrom: String?
    public var integrity: Double
    public var lastHitMs = -Double.infinity
    var data: [String: Any] = [:]
    var lastWritten: SIMD4<Double>?
    var lastWrittenRot: simd_quatd?
    var lastVisible: Bool?
    var viewHidden = false

    init(
      key: String, name: String, nodeIndex: Int, traits: XRSimTraits, initPos: SIMD3<Double>,
      initQuat: simd_quatd, center: SIMD3<Double>, half: SIMD3<Double>
    ) {
      self.key = key
      self.name = name
      self.nodeIndex = nodeIndex
      self.traits = traits
      self.initPos = initPos
      self.initQuat = initQuat
      self.center = center
      self.half = half
      self.radius = simd_length(half)
      self.pos = initPos
      self.integrity = traits.integrity?.current ?? 0
    }

    public var isInstance: Bool { spawnedFrom != nil }

    /// World-space AABB center.
    public func worldCenter() -> SIMD3<Double> { pos + XRSimWorld.rotateY(center, yaw) }

    /// World-space AABB (`min`, `max`).
    public func aabb() -> (min: SIMD3<Double>, max: SIMD3<Double>) {
      let c = worldCenter()
      return (c - half, c + half)
    }
  }

  public static let step = 1.0 / 60.0
  public static let maxSubsteps = 5
  public static let maxInstances = 128

  public let session: XRLiveRuntimeSession
  public weak var delegate: XRSimWorldDelegate?

  // MARK: Host configuration (web host attributes)

  /// `character-controller`: `nil` keeps the trait's camera mode; `"none"` disables.
  public var characterMode: String?
  public var characterSpeed: Double?
  public var characterJump: Double?
  public var steeringEnabled = true
  public var rigidBodyEnabled = true
  /// `hit-zones`: `off`, `projectile`, `hitscan`, or `contact`.
  public var hitMode = "off"
  public var fireRate = 4.0
  public var projectileSpeed = 14.0
  public var projectileGravity = 0.0
  public var hitAmount = 25.0
  public var objectivesEnabled = false
  public var scenarioTimerSec = 0.0
  public var targetScore = 0.0
  /// `attempts`; `nil` is unlimited.
  public var attempts: Int?
  public var audioEnabled = false

  // MARK: Input

  /// Strafe input, -1...1.
  public var moveX = 0.0
  /// Forward input, -1...1 (away from the camera).
  public var moveZ = 0.0
  public var sprint = false
  var jumpQueued = false
  var fireQueued = false

  /// Queues a jump for the next fixed step.
  public func jump() { jumpQueued = true }
  /// Queues a shot for the next fixed step.
  public func fire() { fireQueued = true }

  // MARK: State

  public private(set) var bodies: [Body] = []
  private var byName: [String: Body] = [:]
  public internal(set) var timeMs = 0.0
  public internal(set) var ended = false
  public internal(set) var character: Body?
  /// World-space floor fallback (minimum Y of the scene's mesh bounds).
  public let floorY: Double
  /// Scene mesh bounds, or `nil` without meshes.
  public let sceneBounds: (min: SIMD3<Double>, max: SIMD3<Double>)?
  var spawnCounter = 0
  var rng = XRSimWorld.makeRng(0x5eed)
  private var accumulator = 0.0
  var headPose = XRPose(position: SIMD3<Float>(0, 1.6, 0))
  var xrActive = false
  var state: [String: AnyObject] = [:]
  private var parents: [Int]
  private var bus: [String: [(id: Int, fn: ([String: Any], Body?, Body?) -> Void)]] = [:]
  private var busId = 0

  public init(session: XRLiveRuntimeSession, gltf root: [String: Any]) {
    self.session = session
    let n = session.nodeCount
    let traits = XRSimTraits.parseNodes(root)
    parents = (0..<n).map { session.parentIndex(of: $0) ?? -1 }
    func meshAabb(_ i: Int) -> (SIMD3<Double>, SIMD3<Double>)? {
      guard let b = session.localBounds(forNode: i) else { return nil }
      let m = session.worldMatrix(of: i)
      var lo = SIMD3<Double>(repeating: .infinity)
      var hi = SIMD3<Double>(repeating: -.infinity)
      for c in 0..<8 {
        let p = SIMD4<Float>(
          c & 1 != 0 ? b.max.x : b.min.x, c & 2 != 0 ? b.max.y : b.min.y,
          c & 4 != 0 ? b.max.z : b.min.z, 1)
        let w = m * p
        let d = SIMD3<Double>(Double(w.x), Double(w.y), Double(w.z))
        lo = simd_min(lo, d)
        hi = simd_max(hi, d)
      }
      return (lo, hi)
    }
    var sMin = SIMD3<Double>(repeating: .infinity)
    var sMax = SIMD3<Double>(repeating: -.infinity)
    var owned: [Int: [Int]] = [:]
    for i in 0..<n {
      guard session.hasMesh(at: i) else { continue }
      if let (lo, hi) = meshAabb(i) {
        sMin = simd_min(sMin, lo)
        sMax = simd_max(sMax, hi)
      }
      var cur = i
      var depth = 0
      while cur >= 0, cur < n, depth < 256 {
        if cur < traits.count, traits[cur] != nil {
          owned[cur, default: []].append(i)
          break
        }
        cur = parents[cur]
        depth += 1
      }
    }
    sceneBounds = sMin.x.isFinite ? (sMin, sMax) : nil
    floorY = sceneBounds?.min.y ?? 0
    for i in 0..<n {
      guard i < traits.count, let t = traits[i] else { continue }
      let m = session.worldMatrix(of: i)
      let initPos = SIMD3<Double>(
        Double(m.columns.3.x), Double(m.columns.3.y), Double(m.columns.3.z))
      let r = XRSpatialMath.decompose(m).rotation
      let q = simd_quatd(
        ix: Double(r.imag.x), iy: Double(r.imag.y), iz: Double(r.imag.z), r: Double(r.real))
      var lo = SIMD3<Double>(repeating: .infinity)
      var hi = SIMD3<Double>(repeating: -.infinity)
      for mesh in owned[i] ?? [] {
        if let (a, b) = meshAabb(mesh) {
          lo = simd_min(lo, a)
          hi = simd_max(hi, b)
        }
      }
      let has = lo.x.isFinite
      addBody(
        Body(
          key: "node:\(i)", name: session.nodeName(at: i) ?? "Node_\(i)", nodeIndex: i,
          traits: t, initPos: initPos, initQuat: q,
          center: has ? (lo + hi) / 2 - initPos : .zero, half: has ? (hi - lo) / 2 : .zero))
    }
    for b in bodies
    where bodies.contains(where: { $0 !== b && $0.traits.spawner?.template == b.name }) {
      b.isTemplate = true
      b.hidden = true
    }
    applyBodies()
  }

  /// First body named `name` (spawned instances are `Name#n`).
  public func body(named name: String) -> Body? { byName[name] }

  /// Bodies that systems step (not spawner templates).
  public func active() -> [Body] { bodies.filter { !$0.isTemplate } }

  func addBody(_ b: Body) {
    bodies.append(b)
    if byName[b.name] == nil { byName[b.name] = b }
  }

  func removeBody(_ b: Body) {
    bodies.removeAll { $0 === b }
    if byName[b.name] === b { byName[b.name] = nil }
    if character === b { character = nil }
    if b.isInstance { delegate?.simInstanceRemoved(b.name) }
  }

  @discardableResult
  func on(_ type: String, _ fn: @escaping ([String: Any], Body?, Body?) -> Void) -> () -> Void {
    busId += 1
    let id = busId
    bus[type, default: []].append((id, fn))
    return { [weak self] in self?.bus[type]?.removeAll { $0.id == id } }
  }

  /// Dispatches `type` to internal systems and the delegate.
  func emit(_ type: String, _ detail: [String: Any], body: Body? = nil, other: Body? = nil) {
    for entry in bus[type] ?? [] { entry.fn(detail, body, other) }
    delegate?.simEvent(type, detail: detail)
  }

  /// Head (camera) position.
  public func headPosition() -> SIMD3<Double> {
    SIMD3(Double(headPose.position.x), Double(headPose.position.y), Double(headPose.position.z))
  }

  /// Horizontal camera forward (unit XZ vector).
  public func cameraForwardXZ() -> SIMD3<Double> {
    let o = headPose.orientation
    let yaw = atan2(
      2 * (Double(o.real) * Double(o.imag.y) + Double(o.imag.x) * Double(o.imag.z)),
      1 - 2 * (Double(o.imag.y) * Double(o.imag.y) + Double(o.imag.x) * Double(o.imag.x)))
    return SIMD3(-sin(yaw), 0, -cos(yaw))
  }

  /// 3D camera forward (unit vector): the head's local -Z.
  public func cameraForward() -> SIMD3<Double> {
    let o = headPose.orientation
    let x = Double(o.imag.x)
    let y = Double(o.imag.y)
    let z = Double(o.imag.z)
    let w = Double(o.real)
    let f = SIMD3(-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y)))
    let len = simd_length(f)
    return len > 1e-8 ? f / len : SIMD3(0, 0, -1)
  }

  /// Position `'user'` resolves to: the controlled character, else the head.
  public func userPosition() -> SIMD3<Double> {
    if let ch = character, !ch.hidden { return ch.pos }
    return headPosition()
  }

  /// Advances by `dt` seconds of real time in fixed 60 Hz steps (at most 5 per call).
  public func step(dt: Double, headPose: XRPose, inXRSession: Bool = false) {
    refreshRoot()
    self.headPose = rootIsIdentity ? headPose : XRPose(matrix: invRoot * headPose.matrix)
    xrActive = inXRSession
    if bodies.isEmpty { return }
    let frame = dt.isFinite ? Swift.max(0, Swift.min(0.25, dt)) : 0
    accumulator = Swift.min(accumulator + frame, Self.step * Double(Self.maxSubsteps))
    while accumulator >= Self.step - 1e-9 {
      accumulator -= Self.step
      if ended { continue }
      timeMs += Self.step * 1000
      CharacterController.step(self, Self.step)
      SteeringAgents.step(self, Self.step)
      RigidBodyPhysics.step(self, Self.step)
      HitZones.step(self, Self.step)
      Objectives.step(self, Self.step)
      SynthAudio.step(self, Self.step)
    }
    applyBodies()
  }

  /// Routes a tap / select on glTF node `nodeIndex` (or empty space for `-1`).
  public func select(nodeIndex: Int, hitPoint: SIMD3<Double>? = nil) {
    if ended || bodies.isEmpty { return }
    let point = toScene(hitPoint)
    var body: Body?
    var cur = nodeIndex
    var depth = 0
    while cur >= 0, depth < 256 {
      body = bodies.first { $0.nodeIndex == cur && !$0.isInstance }
      if body != nil { break }
      cur = cur < parents.count ? parents[cur] : -1
      depth += 1
    }
    if let b = body, b.isTemplate || b.hidden { return }
    selectBody(body, point)
  }

  /// Routes a tap on a spawned instance.
  public func selectInstance(_ instanceId: String, hitPoint: SIMD3<Double>? = nil) {
    guard let b = bodies.first(where: { $0.isInstance && $0.name == instanceId }), !ended,
      !b.hidden
    else { return }
    selectBody(b, toScene(hitPoint))
  }

  private func selectBody(_ body: Body?, _ hitPoint: SIMD3<Double>?) {
    if HitZones.select(self, body, hitPoint) { return }
    if Objectives.select(self, body) { return }
    SynthAudio.select(self, body)
  }

  /// Restores authored state, removes spawned instances, and restarts the scenario.
  public func reset() {
    for b in bodies {
      if b.isInstance {
        removeBody(b)
        continue
      }
      b.pos = b.initPos
      b.yaw = 0
      b.rot = simd_quatd(ix: 0, iy: 0, iz: 0, r: 1)
      b.vel = .zero
      b.hidden = b.isTemplate
      b.integrity = b.traits.integrity?.current ?? 0
      b.lastHitMs = -.infinity
      b.data.removeAll()
    }
    timeMs = 0
    accumulator = 0
    ended = false
    jumpQueued = false
    fireQueued = false
    CharacterController.reset(self)
    RigidBodyPhysics.reset(self)
    HitZones.reset(self)
    Objectives.reset(self)
    SynthAudio.reset(self)
    applyBodies()
  }

  // Scene root (turntable, model scale, or AR placement) mapping scene space, where bodies live
  // (as on the web), to the session's world space.
  private var root = matrix_identity_float4x4
  private var invRoot = matrix_identity_float4x4
  private var rootRotation = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
  private var rootIsIdentity = true

  private func refreshRoot() {
    root = session.rootTransform
    rootIsIdentity = root == matrix_identity_float4x4
    if !rootIsIdentity {
      let det = simd_determinant(root)
      if !det.isFinite || abs(det) < 1e-12 {
        rootIsIdentity = true
      } else {
        invRoot = root.inverse
        rootRotation = XRSpatialMath.decompose(root).rotation
      }
    }
  }

  private func toScene(_ p: SIMD3<Double>?) -> SIMD3<Double>? {
    guard let p = p else { return nil }
    refreshRoot()
    if rootIsIdentity { return p }
    let s = XRSpatialMath.transformPoint(invRoot, SIMD3<Float>(Float(p.x), Float(p.y), Float(p.z)))
    return SIMD3(Double(s.x), Double(s.y), Double(s.z))
  }

  /// Scene-space point to the session's (and renderer's) world space.
  public func sceneToWorld(_ p: SIMD3<Double>) -> SIMD3<Double> {
    if rootIsIdentity { return p }
    let w = XRSpatialMath.transformPoint(root, SIMD3<Float>(Float(p.x), Float(p.y), Float(p.z)))
    return SIMD3(Double(w.x), Double(w.y), Double(w.z))
  }

  /// The scene-root matrix from the last step (identity when the scene root does not move).
  public var sceneRootMatrix: simd_float4x4 { root }

  /// Writes changed poses and visibility to the session (or the instance delegate).
  func applyBodies() {
    let idRot = simd_quatd(ix: 0, iy: 0, iz: 0, r: 1)
    for b in bodies {
      let visible = !b.hidden && !b.viewHidden
      let now = SIMD4(b.pos.x, b.pos.y, b.pos.z, b.yaw)
      let moved = b.lastWritten != now || b.lastWrittenRot != b.rot
      let qYaw = simd_quatd(angle: b.yaw, axis: SIMD3(0, 1, 0))
      let qJoint = b.rot == idRot ? qYaw : (b.rot * qYaw)
      let rot = qJoint * b.initQuat
      if b.isInstance {
        if moved || b.lastVisible != visible {
          delegate?.simInstancePose(
            b.name, templateNodeIndex: b.nodeIndex, position: b.pos, rotation: rot,
            visible: visible)
        }
      } else {
        if moved && b.lastWritten != nil {
          // Bodies live in scene space; the session's world space includes the scene root.
          var p = SIMD3<Float>(Float(b.pos.x), Float(b.pos.y), Float(b.pos.z))
          var r = simd_quatf(
            ix: Float(rot.imag.x), iy: Float(rot.imag.y), iz: Float(rot.imag.z), r: Float(rot.real))
          if !rootIsIdentity {
            p = XRSpatialMath.transformPoint(root, p)
            r = rootRotation * r
          }
          session.setNodeWorldPose(b.nodeIndex, position: p, rotation: r)
        }
        if b.lastVisible != visible { session.setNodeVisible(b.nodeIndex, visible) }
      }
      b.lastWritten = now
      b.lastWrittenRot = b.rot
      b.lastVisible = visible
    }
  }

  // MARK: Math (shared with the web and Android runtimes)

  /// Rotates `v` about +Y by `yaw` radians.
  public static func rotateY(_ v: SIMD3<Double>, _ yaw: Double) -> SIMD3<Double> {
    let c = cos(yaw)
    let s = sin(yaw)
    return SIMD3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
  }

  /// Wraps an angle into (-π, π].
  public static func wrapAngle(_ a: Double) -> Double {
    var x = a.truncatingRemainder(dividingBy: .pi * 2)
    if x > .pi { x -= .pi * 2 }
    if x <= -.pi { x += .pi * 2 }
    return x
  }

  /// Moves `from` toward `to` by at most `maxStep` radians along the short arc.
  public static func turnToward(_ from: Double, _ to: Double, _ maxStep: Double) -> Double {
    let d = wrapAngle(to - from)
    return wrapAngle(from + Swift.max(-maxStep, Swift.min(maxStep, d)))
  }

  /// Yaw that points local +Z along XZ direction (`x`, `z`).
  public static func yawFromDir(_ x: Double, _ z: Double) -> Double { atan2(x, z) }

  /// Pushes a vertical cylinder out of an AABB on the XZ plane; returns the corrected
  /// (x, z) or `nil` when not overlapping.
  public static func pushCircleOutOfAABB(
    _ p: SIMD3<Double>, _ radius: Double, _ lo: SIMD3<Double>, _ hi: SIMD3<Double>
  ) -> SIMD2<Double>? {
    let cx = Swift.max(lo.x, Swift.min(hi.x, p.x))
    let cz = Swift.max(lo.z, Swift.min(hi.z, p.z))
    let dx = p.x - cx
    let dz = p.z - cz
    let d2 = dx * dx + dz * dz
    if d2 >= radius * radius { return nil }
    if d2 > 1e-12 {
      let d = d2.squareRoot()
      return SIMD2(cx + dx / d * radius, cz + dz / d * radius)
    }
    let exits: [(Double, Double, Double)] = [
      (p.x - lo.x, lo.x - radius, p.z), (hi.x - p.x, hi.x + radius, p.z),
      (p.z - lo.z, p.x, lo.z - radius), (hi.z - p.z, p.x, hi.z + radius),
    ]
    var best = exits[0]
    for e in exits where e.0 < best.0 { best = e }
    return SIMD2(best.1, best.2)
  }

  /// Entry `t` in [0, 1] of segment `a`-`b` into a sphere, or `nil`.
  public static func intersectSegmentSphere(
    _ a: SIMD3<Double>, _ b: SIMD3<Double>, _ center: SIMD3<Double>, _ radius: Double
  ) -> Double? {
    let d = b - a
    let f = a - center
    let aa = simd_dot(d, d)
    let c = simd_dot(f, f) - radius * radius
    if c <= 0 { return 0 }
    if aa < 1e-12 { return nil }
    let bb = 2 * simd_dot(f, d)
    let disc = bb * bb - 4 * aa * c
    if disc < 0 { return nil }
    let t = (-bb - disc.squareRoot()) / (2 * aa)
    return t >= 0 && t <= 1 ? t : nil
  }

  /// Entry `t` in [0, 1] of segment `a`-`b` into an AABB, or `nil`.
  public static func intersectSegmentAABB(
    _ a: SIMD3<Double>, _ b: SIMD3<Double>, _ lo: SIMD3<Double>, _ hi: SIMD3<Double>
  ) -> Double? {
    var t0 = 0.0
    var t1 = 1.0
    for i in 0..<3 {
      let d = b[i] - a[i]
      if abs(d) < 1e-12 {
        if a[i] < lo[i] || a[i] > hi[i] { return nil }
        continue
      }
      var ta = (lo[i] - a[i]) / d
      var tb = (hi[i] - a[i]) / d
      if ta > tb { swap(&ta, &tb) }
      t0 = Swift.max(t0, ta)
      t1 = Swift.min(t1, tb)
      if t0 > t1 { return nil }
    }
    return t0
  }

  /// Deterministic mulberry32 PRNG in [0, 1) (matches the web runtime bit for bit).
  public static func makeRng(_ seed: UInt32) -> () -> Double {
    var s = seed
    return {
      s = s &+ 0x6d2b_79f5
      var t = s
      t = (t ^ (t >> 15)) &* (t | 1)
      t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
      return Double(t ^ (t >> 14)) / 4_294_967_296.0
    }
  }

  /// FNV-1a hash (matches the web runtime).
  public static func hashString(_ s: String) -> UInt32 {
    var h: UInt32 = 0x811c_9dc5
    for u in s.utf16 {
      h ^= UInt32(u)
      h = h &* 0x0100_0193
    }
    return h
  }

  // MARK: Parity

  private static func r6(_ v: Double) -> Double { (v * 1e6).rounded() / 1e6 }
  private static func r6(_ v: SIMD3<Double>) -> [Double] { [r6(v.x), r6(v.y), r6(v.z)] }
  private static func r6(_ v: SIMD4<Float>) -> [Double] {
    [r6(Double(v.x)), r6(Double(v.y)), r6(Double(v.z)), r6(Double(v.w))]
  }

  /// Renderer-independent summary of `HitZones.visuals` (same shape as `xr_sim_test.ts`).
  public static func visualsSummary(_ world: XRSimWorld) -> [String: Any] {
    let v = HitZones.visuals(world)
    return [
      "flashing": v.flashing.map { $0.name },
      "projectiles": v.projectiles.map { r6($0) },
      "fragments": v.fragments.map { r6($0.pos) },
      "bars": v.bars.map {
        [
          "name": $0.body.name, "center": r6($0.center), "yaw": r6($0.yaw),
          "width": r6($0.width), "frac": r6($0.frac), "color": r6($0.color),
        ] as [String: Any]
      },
      "zones": v.zones.map {
        [
          "name": $0.body.name, "center": r6($0.center), "yaw": r6($0.yaw), "size": r6($0.size),
          "color": r6($0.color),
        ] as [String: Any]
      },
    ]
  }

  /// Summary of `CharacterController.cameraRig(_:)`, or `nil`.
  public static func cameraSummary(_ world: XRSimWorld) -> [String: Any]? {
    guard let rig = CharacterController.cameraRig(world) else { return nil }
    return [
      "mode": rig.mode, "target": r6(rig.target), "phiDeg": r6(rig.phiDeg),
      "distance": r6(rig.distance),
    ]
  }

  /// Steps the shared `testdata/golden/sim_scene.json` scene with the same schedule as the
  /// web and Android runners and returns the `sim_expected.json` shape.
  public static func runParityScene(_ scene: [String: Any]) -> [String: Any] {
    let gltf = XRJSON.object(scene["gltf"]) ?? [:]
    let world = XRSimWorld(session: XRLiveRuntimeSession(gltf: gltf), gltf: gltf)
    let cfg = XRJSON.object(scene["config"]) ?? [:]
    if let m = XRJSON.string(cfg["hitMode"]) { world.hitMode = m }
    world.objectivesEnabled = XRJSON.bool(cfg["objectives"]) == true
    if let a = XRJSON.number(cfg["attempts"]) { world.attempts = Int(a) }
    if let t = XRJSON.number(cfg["scenarioTimer"]) { world.scenarioTimerSec = t }
    if let t = XRJSON.number(cfg["targetScore"]) { world.targetScore = t }
    final class Counter: XRSimWorldDelegate {
      var counts: [String: Int] = [:]
      func simEvent(_ type: String, detail: [String: Any]) {
        if let c = counts[type] { counts[type] = c + 1 }
      }
    }
    let counter = Counter()
    for e in XRJSON.array(scene["events"]) ?? [] {
      if let s = XRJSON.string(e) { counter.counts[s] = 0 }
    }
    world.delegate = counter
    let hp = XRJSON.object(scene["headPose"]) ?? [:]
    let p = (XRJSON.array(hp["position"]) ?? []).compactMap { XRJSON.number($0) }.map { Float($0) }
    let q = (XRJSON.array(hp["quaternion"]) ?? []).compactMap { XRJSON.number($0) }.map {
      Float($0)
    }
    let head = XRPose(
      position: SIMD3(p[0], p[1], p[2]),
      orientation: simd_quatf(ix: q[0], iy: q[1], iz: q[2], r: q[3]))
    let frames = Int(XRJSON.number(scene["frames"]) ?? 0)
    let inputs = (XRJSON.array(scene["inputs"]) ?? []).compactMap { XRJSON.object($0) }
    let checkpoints = Set(
      (XRJSON.array(scene["checkpoints"]) ?? []).compactMap { XRJSON.number($0) }.map { Int($0) })
    let frameOf = { (i: [String: Any]) in Int(XRJSON.number(i["frame"]) ?? -1) }
    let inputAtZero = inputs.contains { frameOf($0) == 0 }
    var out: [[String: Any]] = []
    for f in 0..<frames {
      for inp in inputs where frameOf(inp) == f {
        if f == 0 { world.step(dt: Self.step, headPose: head) }
        world.moveX = XRJSON.number(inp["moveX"]) ?? 0
        world.moveZ = XRJSON.number(inp["moveZ"]) ?? 0
        if XRJSON.bool(inp["jump"]) == true { world.jump() }
        if XRJSON.bool(inp["fire"]) == true { world.fire() }
      }
      if f != 0 || !inputAtZero { world.step(dt: Self.step, headPose: head) }
      if checkpoints.contains(f + 1) {
        var bodies: [String: [Double]] = [:]
        for b in world.bodies {
          bodies[b.name] = [b.pos.x, b.pos.y, b.pos.z, b.yaw].map { ($0 * 1e6).rounded() / 1e6 }
        }
        var cp: [String: Any] = ["frame": f + 1, "bodies": bodies]
        if XRJSON.bool(scene["visuals"]) == true {
          cp["visuals"] = visualsSummary(world)
          cp["camera"] = cameraSummary(world) ?? NSNull()
        }
        out.append(cp)
      }
    }
    let sc = Objectives.scenario(world)
    var integrity: [String: Double] = [:]
    for b in world.bodies where b.traits.integrity != nil { integrity[b.name] = b.integrity }
    return [
      "checkpoints": out, "events": counter.counts, "score": sc?.score ?? 0,
      "attemptsLeft": sc?.attemptsLeft as Any, "integrity": integrity,
    ]
  }
}
