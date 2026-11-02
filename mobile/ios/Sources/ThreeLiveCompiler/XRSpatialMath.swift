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

// Platform-neutral ports of the spatial math and interaction algorithms:
// - xr-live/src/plugins/head-follow.ts (lazy follow spring + orbit)
// - xr-live/src/plugins/manipulation-handles.ts (corner scale / pedestal yaw)
// - xr-live/src/plugins/world-understanding.ts (2D detection unprojection)
// Matrices are column-major `simd_float4x4`, matching WebGL / glTF conventions.

import Foundation
import simd

// MARK: - Poses

/// A world-space 6DoF pose (head, hand, or camera).
public struct XRPose: Sendable, Equatable {
  public var position: SIMD3<Float>
  public var orientation: simd_quatf

  public init(
    position: SIMD3<Float> = .zero,
    orientation: simd_quatf = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
  ) {
    self.position = position
    self.orientation = orientation
  }

  /// Creates a pose from a rigid world matrix (scale is discarded).
  public init(matrix: simd_float4x4) {
    let trs = XRSpatialMath.decompose(matrix)
    self.init(position: trs.translation, orientation: trs.rotation)
  }

  /// Creates a pose at `position` yawed `yaw` radians about +Y.
  public static func yawed(_ yaw: Float, at position: SIMD3<Float>) -> XRPose {
    XRPose(position: position, orientation: XRSpatialMath.quatFromYaw(yaw))
  }

  /// The pose as a rigid column-major matrix.
  public var matrix: simd_float4x4 {
    XRSpatialMath.compose(translation: position, rotation: orientation, scale: SIMD3<Float>(1, 1, 1))
  }

  public static func == (lhs: XRPose, rhs: XRPose) -> Bool {
    lhs.position == rhs.position && lhs.orientation.vector == rhs.orientation.vector
  }
}

/// Hand identifiers for hand-anchored lazy follows.
public enum XRHand: String, Sendable, Hashable, CaseIterable {
  case left
  case right
}

/// Per-axis state of a critically damped spring.
public struct XRSpringState: Sendable, Equatable {
  public var position: SIMD3<Float>
  public var velocity: SIMD3<Float>

  public init(position: SIMD3<Float>, velocity: SIMD3<Float> = .zero) {
    self.position = position
    self.velocity = velocity
  }
}

// MARK: - Math

/// Shared spatial math (lazy follow, orbit, quaternion and matrix helpers).
public enum XRSpatialMath {
  /// Identity quaternion.
  public static let identityQuat = simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)

  /// Clamps `v` into `[lo, hi]`, mapping non-finite values to `fallback`.
  public static func clamp(_ v: Float, _ lo: Float, _ hi: Float, fallback: Float) -> Float {
    let n = v.isFinite ? v : fallback
    return max(lo, min(hi, n))
  }

  /// Normalizes `v`, returning `fallback` when its length is ≤ 1e-8 or non-finite.
  public static func normalize(
    _ v: SIMD3<Float>, fallback: SIMD3<Float> = SIMD3<Float>(0, 0, -1)
  ) -> SIMD3<Float> {
    let len = simd_length(v)
    return (len.isFinite && len > 1e-8) ? v / len : fallback
  }

  /// Applies a column-major affine matrix to a point.
  public static func transformPoint(_ m: simd_float4x4, _ p: SIMD3<Float>) -> SIMD3<Float> {
    let r = m * SIMD4<Float>(p.x, p.y, p.z, 1)
    return SIMD3<Float>(r.x, r.y, r.z)
  }

  /// Composes a column-major TRS matrix.
  public static func compose(
    translation: SIMD3<Float>, rotation: simd_quatf, scale: SIMD3<Float>
  ) -> simd_float4x4 {
    let r = simd_float3x3(simd_normalize(rotation))
    let c0 = r.columns.0 * scale.x
    let c1 = r.columns.1 * scale.y
    let c2 = r.columns.2 * scale.z
    return simd_float4x4(
      SIMD4<Float>(c0.x, c0.y, c0.z, 0),
      SIMD4<Float>(c1.x, c1.y, c1.z, 0),
      SIMD4<Float>(c2.x, c2.y, c2.z, 0),
      SIMD4<Float>(translation.x, translation.y, translation.z, 1)
    )
  }

  /// Decomposes an affine matrix into translation, rotation and (positive) scale.
  public static func decompose(
    _ m: simd_float4x4
  ) -> (translation: SIMD3<Float>, rotation: simd_quatf, scale: SIMD3<Float>) {
    let t = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
    var c0 = SIMD3<Float>(m.columns.0.x, m.columns.0.y, m.columns.0.z)
    var c1 = SIMD3<Float>(m.columns.1.x, m.columns.1.y, m.columns.1.z)
    var c2 = SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z)
    let s = SIMD3<Float>(simd_length(c0), simd_length(c1), simd_length(c2))
    guard s.x > 1e-8, s.y > 1e-8, s.z > 1e-8, s.x.isFinite, s.y.isFinite, s.z.isFinite else {
      return (t, identityQuat, s)
    }
    c0 /= s.x
    c1 /= s.y
    c2 /= s.z
    var q = simd_quatf(simd_float3x3(c0, c1, c2))
    let len = simd_length(q.vector)
    q = (len.isFinite && len > 1e-8) ? simd_quatf(vector: q.vector / len) : identityQuat
    return (t, q, s)
  }

  /// Returns the yaw (rotation about +Y, radians) of quaternion `q`.
  public static func yawFromQuat(_ q: simd_quatf) -> Float {
    let x = q.imag.x
    let y = q.imag.y
    let z = q.imag.z
    let w = q.real
    return atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x))
  }

  /// Returns the horizontal (XZ-plane) forward vector (−Z rotated by yaw) for `q`.
  public static func horizontalForward(_ q: simd_quatf) -> SIMD3<Float> {
    let yaw = yawFromQuat(q)
    return SIMD3<Float>(-sin(yaw), 0, -cos(yaw))
  }

  /// Returns a quaternion rotating `angle` radians about +Y.
  public static func quatFromYaw(_ angle: Float) -> simd_quatf {
    simd_quatf(ix: 0, iy: sin(angle * 0.5), iz: 0, r: cos(angle * 0.5))
  }

  /// Returns the yaw-only quaternion that points +Z from `from` toward `to`.
  public static func yawTowards(from: SIMD3<Float>, to: SIMD3<Float>) -> simd_quatf {
    quatFromYaw(atan2(to.x - from.x, to.z - from.z))
  }

  /// Computes a billboard rotation pointing +Z from `from` toward `to` according to `mode`
  /// (`"capsule"` clamps pitch to ±30°, `"cylindrical"` locks pitch to 0, `"spherical"` tracks full
  /// yaw + pitch).
  public static func billboardTowards(
    from: SIMD3<Float>, to: SIMD3<Float>, mode: String
  ) -> simd_quatf {
    let dx = to.x - from.x
    let dy = to.y - from.y
    let dz = to.z - from.z
    let horizLen = hypot(dx, dz)
    if horizLen < 1e-6 && abs(dy) < 1e-6 {
      return identityQuat
    }
    let yaw = atan2(dx, dz)
    if mode.caseInsensitiveCompare("cylindrical") == .orderedSame {
      return quatFromYaw(yaw)
    }
    var pitch = -atan2(dy, max(1e-6, horizLen))
    if mode.caseInsensitiveCompare("capsule") == .orderedSame {
      let maxPitch = Float.pi / 6.0
      pitch = min(maxPitch, max(-maxPitch, pitch))
    }
    let qYaw = quatFromYaw(yaw)
    let qPitch = simd_quatf(ix: sin(pitch * 0.5), iy: 0, iz: 0, r: cos(pitch * 0.5))
    return simd_normalize(qYaw * qPitch)
  }

  /// Advances a critically damped spring toward `target` by `dt` seconds with angular
  /// frequency `omega`, using the exact closed-form solution (unconditionally stable).
  public static func stepCriticallyDampedSpring(
    _ state: inout XRSpringState, target: SIMD3<Float>, omega: Float, dt: Float
  ) {
    let decay = exp(-omega * dt)
    let delta = state.position - target
    let temp = (state.velocity + omega * delta) * dt
    state.velocity = (state.velocity - omega * temp) * decay
    state.position = target + (delta + temp) * decay
  }

  /// Computes the desired world position for a lazy follower.
  public static func computeFollowTarget(anchor: XRPose, options: XRLiveLazyFollow) -> SIMD3<Float> {
    if !options.isHead {
      return anchor.position + SIMD3<Float>(0, options.height, 0)
    }
    let fwd = horizontalForward(anchor.orientation)
    return SIMD3<Float>(
      anchor.position.x + fwd.x * options.distance,
      anchor.position.y + options.height,
      anchor.position.z + fwd.z * options.distance
    )
  }

  /// Returns the horizontal angle (degrees) between the anchor's forward vector and the
  /// direction from the anchor to `point`.
  public static func angleFromForwardDeg(anchor: XRPose, point: SIMD3<Float>) -> Float {
    let fwd = horizontalForward(anchor.orientation)
    var to = point - anchor.position
    to.y = 0
    if simd_length(to) < 1e-5 { return 0 }
    let dir = normalize(to)
    return acos(max(-1, min(1, simd_dot(fwd, dir)))) * 180 / Float.pi
  }

  /// Computes the orbit position at accumulated time `t` seconds.
  public static func computeOrbitPosition(
    center: SIMD3<Float>, options: XRLiveOrbit, t: Float
  ) -> SIMD3<Float> {
    let theta = options.phase + options.speed * t
    return SIMD3<Float>(
      center.x + cos(theta) * options.radius,
      center.y + options.height,
      center.z + sin(theta) * options.radius
    )
  }

  /// Whether a resting lazy follower should start catching up: horizontal angle beyond the
  /// deadzone, or radial / vertical error beyond `max(0.05, 0.35 × distance)`.
  public static func shouldStartFollowing(
    position: SIMD3<Float>, target: SIMD3<Float>, anchor: XRPose, options: XRLiveLazyFollow
  ) -> Bool {
    let err = simd_length(position - target)
    let angle = angleFromForwardDeg(anchor: anchor, point: position)
    let rel = position - anchor.position
    let radialErr =
      options.isHead
      ? abs((rel.x * rel.x + rel.z * rel.z).squareRoot() - options.distance) : err
    let verticalErr = abs(rel.y - options.height)
    let slack = max(0.05, options.distance * 0.35)
    return angle > options.deadzoneDeg || radialErr > slack || verticalErr > slack
  }
}

// MARK: - Manipulation handles

/// Corner-scale and pedestal-yaw manipulation handles (`manipulation-handles.ts`).
public enum ManipulationHandles {
  /// World-space handle placement for a single object.
  public struct Layout: Sendable, Equatable {
    public var origin: SIMD3<Float>
    /// Four top corners of the local bounding box, in world space.
    public var corners: [SIMD3<Float>]
    public var pedestalStart: SIMD3<Float>
    public var pedestalEnd: SIMD3<Float>
    public var pedestalCenter: SIMD3<Float>
    /// World yaw of the object in radians.
    public var yaw: Float
    public var handleRadius: Float
  }

  /// Identifies which handle a ray picked.
  public enum Hit: Sendable, Equatable {
    case corner(index: Int, distance: Float)
    case rotate(distance: Float)

    /// Distance along the ray to the handle.
    public var distance: Float {
      switch self {
      case .corner(_, let d): return d
      case .rotate(let d): return d
      }
    }
  }

  /// Computes world-space corner and pedestal handle positions from local bounds and the
  /// object's world matrix.
  public static func computeLayout(
    localMin: SIMD3<Float>, localMax: SIMD3<Float>, world: simd_float4x4
  ) -> Layout {
    let mn = localMin
    let mx = localMax
    let corners = [
      SIMD3<Float>(mn.x, mx.y, mn.z),
      SIMD3<Float>(mx.x, mx.y, mn.z),
      SIMD3<Float>(mx.x, mx.y, mx.z),
      SIMD3<Float>(mn.x, mx.y, mx.z),
    ].map { XRSpatialMath.transformPoint(world, $0) }
    let cz = (mn.z + mx.z) * 0.5
    let drop = SIMD3<Float>(0, -0.03, 0)
    let pedestalStart = XRSpatialMath.transformPoint(world, SIMD3<Float>(mn.x, mn.y, cz)) + drop
    let pedestalEnd = XRSpatialMath.transformPoint(world, SIMD3<Float>(mx.x, mn.y, cz)) + drop
    let diag = simd_length(corners[0] - corners[2])
    let trs = XRSpatialMath.decompose(world)
    return Layout(
      origin: trs.translation,
      corners: corners,
      pedestalStart: pedestalStart,
      pedestalEnd: pedestalEnd,
      pedestalCenter: (pedestalStart + pedestalEnd) * 0.5,
      yaw: XRSpatialMath.yawFromQuat(trs.rotation),
      handleRadius: XRSpatialMath.clamp(diag * 0.06, 0.012, 0.08, fallback: 0.02)
    )
  }

  /// Normalizes a ray direction, returning `nil` when degenerate.
  public static func normalizeRay(_ dir: SIMD3<Float>) -> SIMD3<Float>? {
    let len = simd_length(dir)
    return (len.isFinite && len > 1e-8) ? dir / len : nil
  }

  private static func rayPoint(
    _ origin: SIMD3<Float>, _ dir: SIMD3<Float>, _ p: SIMD3<Float>
  ) -> (t: Float, miss: Float) {
    let t = max(0, simd_dot(p - origin, dir))
    return (t, simd_length(origin + dir * t - p))
  }

  private static func raySegment(
    _ origin: SIMD3<Float>, _ dir: SIMD3<Float>, _ a: SIMD3<Float>, _ b: SIMD3<Float>
  ) -> (t: Float, miss: Float) {
    let ab = b - a
    let ao = origin - a
    let abLen2 = max(simd_dot(ab, ab), 1e-10)
    let d1 = simd_dot(dir, ab)
    let denom = abLen2 - d1 * d1
    var s: Float = abs(denom) < 1e-10 ? 0 : (simd_dot(ao, ab) - d1 * simd_dot(ao, dir)) / denom
    s = max(0, min(1, s))
    return rayPoint(origin, dir, a + ab * s)
  }

  /// Picks the nearest handle under a ray, or `nil` when none is hit.
  public static func pick(
    layout: Layout, rayOrigin: SIMD3<Float>, rayDirection: SIMD3<Float>, options: XRLiveHandles
  ) -> Hit? {
    guard let dir = normalizeRay(rayDirection) else { return nil }
    var best: Hit?
    let r = layout.handleRadius * 1.5
    for (index, c) in layout.corners.enumerated() {
      let hit = rayPoint(rayOrigin, dir, c)
      if hit.miss <= r && (best == nil || hit.t < (best?.distance ?? .infinity)) {
        best = .corner(index: index, distance: hit.t)
      }
    }
    if options.rotateAxis == "y" {
      let hit = raySegment(rayOrigin, dir, layout.pedestalStart, layout.pedestalEnd)
      if hit.miss <= r && (best == nil || hit.t < (best?.distance ?? .infinity)) {
        best = .rotate(distance: hit.t)
      }
    }
    return best
  }

  /// Intersects a ray with the horizontal plane `y`, or `nil` when parallel / behind.
  public static func intersectHorizontalPlane(
    origin: SIMD3<Float>, direction: SIMD3<Float>, y: Float
  ) -> SIMD3<Float>? {
    if abs(direction.y) < 1e-6 { return nil }
    let t = (y - origin.y) / direction.y
    if t < 0 { return nil }
    return origin + direction * t
  }

  /// An in-progress handle drag. Create with `init?(...)` on pointer-down and call
  /// `update(rayOrigin:rayDirection:)` on every move.
  public struct Drag: Sendable {
    public let hit: Hit
    public let startPoint: SIMD3<Float>
    /// World-space pivot (object origin) used for ratios and angles.
    public let pivot: SIMD3<Float>
    public let planeY: Float
    /// Local (model-space) scale and rotation at drag start.
    public let startScale: SIMD3<Float>
    public let startRotation: simd_quatf
    public let options: XRLiveHandles

    /// Starts a drag for a picked handle. Returns `nil` for a degenerate ray.
    public init?(
      layout: Layout, hit: Hit, rayOrigin: SIMD3<Float>, rayDirection: SIMD3<Float>,
      startScale: SIMD3<Float>, startRotation: simd_quatf, options: XRLiveHandles
    ) {
      guard let dir = ManipulationHandles.normalizeRay(rayDirection) else { return nil }
      switch hit {
      case .corner(let index, _):
        guard index >= 0, index < layout.corners.count else { return nil }
        startPoint = layout.corners[index]
      case .rotate:
        startPoint =
          ManipulationHandles.intersectHorizontalPlane(
            origin: rayOrigin, direction: dir, y: layout.pedestalCenter.y)
          ?? layout.pedestalCenter
      }
      self.hit = hit
      self.pivot = layout.origin
      self.planeY = layout.pedestalCenter.y
      self.startScale = startScale
      self.startRotation = startRotation
      self.options = options
    }

    /// Returns the new local rotation and scale for a pointer ray, or `nil` when the ray
    /// produces no change (degenerate, or parallel to the pedestal plane).
    public func update(
      rayOrigin: SIMD3<Float>, rayDirection: SIMD3<Float>
    ) -> (rotation: simd_quatf, scale: SIMD3<Float>)? {
      guard let dir = ManipulationHandles.normalizeRay(rayDirection) else { return nil }
      switch hit {
      case .corner:
        let t = max(0, simd_dot(startPoint - rayOrigin, dir))
        let p = rayOrigin + dir * t
        let r0 = max(simd_length(startPoint - pivot), 1e-4)
        let ratio = simd_length(p - pivot) / r0
        let s0 = startScale.x
        let s = XRSpatialMath.clamp(s0 * ratio, options.minScale, options.maxScale, fallback: s0)
        let k = s / max(s0, 1e-6)
        return (startRotation, startScale * k)
      case .rotate:
        guard
          let p = ManipulationHandles.intersectHorizontalPlane(
            origin: rayOrigin, direction: dir, y: planeY)
        else { return nil }
        let a0 = atan2(startPoint.x - pivot.x, startPoint.z - pivot.z)
        let a1 = atan2(p.x - pivot.x, p.z - pivot.z)
        return (XRSpatialMath.quatFromYaw(a1 - a0) * startRotation, startScale)
      }
    }
  }
}

// MARK: - World understanding

/// Plane hit-testing and 2D detection unprojection (`world-understanding.ts`).
public enum WorldUnderstanding {
  /// Maximum tracked planes retained per frame.
  public static let maxTrackedPlanes = 64
  /// Maximum detections unprojected per call.
  public static let maxDetections = 32
  /// Distance used when neither depth nor a tracked plane is available.
  public static let fallbackDepthMeters: Float = 1.5

  /// A tracked real-world plane in world coordinates.
  public struct TrackedPlane: Sendable, Equatable {
    public enum Orientation: String, Sendable {
      case horizontal
      case vertical
    }

    public var orientation: Orientation
    public var center: SIMD3<Float>
    public var normal: SIMD3<Float>
    /// Bounding radius of the plane polygon in meters.
    public var radius: Float

    public init(orientation: Orientation, center: SIMD3<Float>, normal: SIMD3<Float>, radius: Float) {
      self.orientation = orientation
      self.center = center
      self.normal = XRSpatialMath.normalize(normal, fallback: SIMD3<Float>(0, 1, 0))
      self.radius = radius
    }

    /// Creates a plane from an anchor transform whose local +Y axis is the plane normal
    /// (ARKit `ARPlaneAnchor` / WebXR plane space convention).
    public init(anchorTransform m: simd_float4x4, radius: Float, orientation: Orientation) {
      self.init(
        orientation: orientation,
        center: SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z),
        normal: SIMD3<Float>(m.columns.1.x, m.columns.1.y, m.columns.1.z),
        radius: radius
      )
    }
  }

  /// How the depth of a detection was determined.
  public enum DepthSource: String, Sendable {
    case depth
    case plane
    case fallback
  }

  /// A detection located in 3D world space.
  public struct Detection3D: Sendable, Equatable {
    public var label: String
    public var position: SIMD3<Float>
    public var widthMeters: Float
    public var heightMeters: Float
    public var depthSource: DepthSource
  }

  /// Result of a ray / plane intersection.
  public struct PlaneHit: Sendable, Equatable {
    public var point: SIMD3<Float>
    public var normal: SIMD3<Float>
    public var distance: Float
    public var planeIndex: Int
  }

  /// Normalizes a `[ymin, xmin, ymax, xmax]` box to `[0, 1]`, accepting unit or Gemini-style
  /// `0...1000` coordinates. Returns `nil` when malformed.
  public static func normalizeBox(_ box: [Float]) -> SIMD4<Float>? {
    guard box.count >= 4 else { return nil }
    let b = Array(box.prefix(4))
    guard b.allSatisfy({ $0.isFinite }) else { return nil }
    let scale: Float = b.contains(where: { $0 > 1.0001 }) ? 1000 : 1
    let v = b.map { XRSpatialMath.clamp($0 / scale, 0, 1, fallback: 0) }
    return SIMD4<Float>(min(v[0], v[2]), min(v[1], v[3]), max(v[0], v[2]), max(v[1], v[3]))
  }

  /// Returns the world-space ray through normalized viewport `(u, v)` (origin top-left)
  /// for a camera world matrix and column-major projection matrix.
  public static func viewportRay(
    u: Float, v: Float, cameraWorld: simd_float4x4, projection p: simd_float4x4
  ) -> (origin: SIMD3<Float>, direction: SIMD3<Float>, viewDirection: SIMD3<Float>) {
    let ndcX = u * 2 - 1
    let ndcY = 1 - v * 2
    let p0 = p.columns.0.x != 0 ? p.columns.0.x : 1
    let p5 = p.columns.1.y != 0 ? p.columns.1.y : 1
    let viewDir = SIMD3<Float>((ndcX + p.columns.2.x) / p0, (ndcY + p.columns.2.y) / p5, -1)
    let origin = SIMD3<Float>(cameraWorld.columns.3.x, cameraWorld.columns.3.y, cameraWorld.columns.3.z)
    let far = XRSpatialMath.transformPoint(cameraWorld, viewDir)
    return (origin, XRSpatialMath.normalize(far - origin), viewDir)
  }

  /// Intersects a ray with tracked planes, returning the nearest hit within each plane's
  /// bounding radius.
  public static func hitTestPlanes(
    _ planes: [TrackedPlane], origin: SIMD3<Float>, direction: SIMD3<Float>
  ) -> PlaneHit? {
    var best: PlaneHit?
    for (i, plane) in planes.prefix(maxTrackedPlanes).enumerated() {
      let denom = simd_dot(plane.normal, direction)
      if abs(denom) < 1e-6 { continue }
      let t = simd_dot(plane.center - origin, plane.normal) / denom
      if !(t > 0.01) { continue }
      if let b = best, t >= b.distance { continue }
      let point = origin + direction * t
      if simd_length(point - plane.center) > plane.radius { continue }
      best = PlaneHit(point: point, normal: plane.normal, distance: t, planeIndex: i)
    }
    return best
  }

  /// Unprojects a 2D detection box to 3D. Uses `depthMeters` (view-space depth along −Z at
  /// the box center) when valid, then tracked planes, then `fallbackDepthMeters`.
  public static func unprojectDetection(
    box: [Float],
    label: String = "",
    cameraWorld: simd_float4x4,
    projection: simd_float4x4,
    depthMeters: Float? = nil,
    planes: [TrackedPlane] = []
  ) -> Detection3D? {
    guard let nb = normalizeBox(box) else { return nil }
    let y0 = nb.x
    let x0 = nb.y
    let y1 = nb.z
    let x1 = nb.w
    let u = (x0 + x1) * 0.5
    let v = (y0 + y1) * 0.5
    let ray = viewportRay(u: u, v: v, cameraWorld: cameraWorld, projection: projection)
    var depth: Float
    var source: DepthSource = .fallback
    if let sampled = depthMeters, sampled.isFinite, sampled > 0.05 {
      depth = sampled
      source = .depth
    } else if let hit = hitTestPlanes(planes, origin: ray.origin, direction: ray.direction) {
      depth = hit.distance / simd_length(ray.viewDirection)
      source = .plane
    } else {
      depth = fallbackDepthMeters
    }
    let world = XRSpatialMath.transformPoint(cameraWorld, ray.viewDirection * depth)
    let p0 = abs(projection.columns.0.x != 0 ? projection.columns.0.x : 1)
    let p5 = abs(projection.columns.1.y != 0 ? projection.columns.1.y : 1)
    return Detection3D(
      label: label.count > 256 ? String(label.prefix(256)) : label,
      position: world,
      widthMeters: ((x1 - x0) * 2 * depth) / p0,
      heightMeters: ((y1 - y0) * 2 * depth) / p5,
      depthSource: source
    )
  }

  /// 60° vertical FOV, square-aspect projection used when the host provides none.
  public static func defaultProjection() -> simd_float4x4 {
    let f = 1 / tan(Float.pi / 6)
    return simd_float4x4(
      SIMD4<Float>(f, 0, 0, 0),
      SIMD4<Float>(0, f, 0, 0),
      SIMD4<Float>(0, 0, -1, -1),
      SIMD4<Float>(0, 0, -0.2, 0)
    )
  }
}
