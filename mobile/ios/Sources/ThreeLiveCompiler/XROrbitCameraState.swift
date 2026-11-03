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

// Platform-neutral orbit camera matching the web `ThreeView` camera (and the Android
// `OrbitCameraState`): azimuth θ and elevation φ around a target, eased toward drag / pinch
// targets, orbit limits, a turntable auto-rotate that spins the model, and `camera-change`
// reporting at 1° / 0.02-zoom granularity.

import Foundation
import simd

/// Camera options using the `<three-live>` attribute grammar. `nil` keeps the default.
public struct XRCameraOptions: Sendable, Equatable {
  public var cameraOrbit: String?
  public var cameraTarget: String?
  public var minCameraOrbit: String?
  public var maxCameraOrbit: String?
  public var fieldOfView: String?
  public var cameraControls: Bool
  public var autoRotate: Bool
  public var autoRotateDelay: TimeInterval
  public var rotationPerSecond: String?
  /// `"auto"` / `"relative"` (`2.5 × boundsRadius`) or `"absolute"` (`3.0m`).
  public var distanceMode: String?

  public init(
    cameraOrbit: String? = nil, cameraTarget: String? = nil, minCameraOrbit: String? = nil,
    maxCameraOrbit: String? = nil, fieldOfView: String? = nil, cameraControls: Bool = true,
    autoRotate: Bool = false, autoRotateDelay: TimeInterval = 3, rotationPerSecond: String? = nil,
    distanceMode: String? = nil
  ) {
    self.cameraOrbit = cameraOrbit
    self.cameraTarget = cameraTarget
    self.minCameraOrbit = minCameraOrbit
    self.maxCameraOrbit = maxCameraOrbit
    self.fieldOfView = fieldOfView
    self.cameraControls = cameraControls
    self.autoRotate = autoRotate
    self.autoRotateDelay = autoRotateDelay
    self.rotationPerSecond = rotationPerSecond
    self.distanceMode = distanceMode
  }
}

/// The `camera-change` detail (same fields and rounding as the web viewer).
public struct XRCameraChange: Sendable, Equatable {
  /// Azimuth in whole degrees, 0..359.
  public var theta: Int
  /// Elevation in whole degrees.
  public var phi: Int
  /// `boundsRadius × 2.5 / distance`, rounded to 0.01.
  public var zoom: Double
  /// Distance in meters, rounded to 0.01.
  public var distance: Double

  /// As a `camera-orbit` string (`"θdeg φdeg rm"`).
  public var orbit: String { "\(theta)deg \(phi)deg \(distance)m" }
}

/// Pure orbit-camera model. Feed it input, `step` it every frame, then read `eye` / `target`.
public struct XROrbitCameraState: Sendable {
  public private(set) var boundsCenter = SIMD3<Double>(0, 0, 0)
  public private(set) var boundsRadius: Double = 1
  /// Vertical field of view in degrees (10…90).
  public private(set) var fieldOfViewDeg: Double = 45
  /// Distance framing mode: `"auto"` / `"relative"` (`2.5 × boundsRadius`) or `"absolute"` (`3.0m`).
  public private(set) var distanceMode: String = "auto"
  public var interactive = true
  public private(set) var theta: Double = 0.6
  public private(set) var phi: Double = 0.35
  public private(set) var distance: Double = 3
  /// Model turntable angle (radians) about +Y through `boundsCenter`.
  public private(set) var turntable: Double = 0

  private var targetTheta = 0.6
  private var targetPhi = 0.35
  private var targetDistance = 3.0
  private var customTarget: SIMD3<Double>?
  private var followTarget: SIMD3<Double>?
  /// Follow framing (`phi` radians, distance) kept across `apply(_:)`.
  private var followFrame: (phi: Double, distance: Double)?
  private var minTheta = -Double.infinity
  private var maxTheta = Double.infinity
  private var minPhi = -Self.phiLimit
  private var maxPhi = Self.phiLimit
  private var minDistance: Double?
  private var maxDistance: Double?
  private var autoRotate = false
  private var autoRotateSpeed = Double.pi / 6
  private var autoRotateDelay: TimeInterval = 3
  private var lastInteraction: TimeInterval = -.infinity
  private var initialTheta: Double?
  private var initialPhi: Double?
  private var initialDistance: Double?
  private var lastReported: (Int, Int, Double)?

  static let phiLimit = Double.pi * 0.48

  public init() {}

  /// Applies every option.
  public mutating func apply(_ o: XRCameraOptions) {
    interactive = o.cameraControls
    autoRotate = o.autoRotate
    if !o.autoRotate {
      turntable = 0
    }
    autoRotateDelay = max(0, o.autoRotateDelay)
    autoRotateSpeed = Self.parseRotationPerSecond(o.rotationPerSecond)
    if let f = Self.parseFieldOfView(o.fieldOfView) { fieldOfViewDeg = min(90, max(10, f)) }
    if let mode = o.distanceMode?.trimmingCharacters(in: .whitespaces).lowercased(),
      mode == "absolute" || mode == "relative" || mode == "auto"
    {
      distanceMode = mode
    } else {
      distanceMode = "auto"
    }
    customTarget = Self.parseCameraTarget(o.cameraTarget)
    applyLimits(o.minCameraOrbit, o.maxCameraOrbit)
    applyOrbit(o.cameraOrbit)
    // A sim follow camera keeps its framing when host camera options change.
    if let f = followFrame {
      targetPhi = clampPhi(f.phi)
      targetDistance = f.distance
      autoRotate = false
      turntable = 0
    }
  }

  /// Follows `target` (world meters) every frame, overriding `camera-target`, as the web viewer
  /// does for an `xr-live-sim` character; `nil` stops following.
  public mutating func follow(_ target: SIMD3<Double>?) {
    if let t = target, t.x.isFinite, t.y.isFinite, t.z.isFinite {
      followTarget = t
    } else {
      followTarget = nil
      followFrame = nil
    }
  }

  /// Eases to a follow framing: `polarDeg` from straight down (the web `setCamera` convention, so
  /// `90` is level) and `distance` meters, keeping the user's azimuth. Bounds distance limits do
  /// not apply (a first-person camera sits 5 cm from its target). Stops auto-rotate.
  public mutating func frameFollow(polarDeg: Double, distance: Double) {
    if polarDeg.isFinite { targetPhi = clampPhi((90 - polarDeg) * .pi / 180) }
    if distance.isFinite { targetDistance = min(1e4, max(0.01, distance)) }
    followFrame = (targetPhi, targetDistance)
    autoRotate = false
    turntable = 0
  }

  /// Frames the scene after a load (initial orbit, else `3.0m` when `distanceMode == "absolute"`,
  /// else `2.5 × radius`) and snaps the easing.
  public mutating func setBounds(center: SIMD3<Double>, radius: Double) {
    if center.x.isFinite && center.y.isFinite && center.z.isFinite { boundsCenter = center }
    boundsRadius = (radius.isFinite && radius > 1e-6) ? radius : 1
    turntable = 0
    targetTheta = clampTheta(initialTheta ?? targetTheta)
    targetPhi = clampPhi(initialPhi ?? targetPhi)
    let defaultDist = (distanceMode == "absolute") ? 3.0 : (boundsRadius * 2.5)
    targetDistance = clampDistance(initialDistance ?? defaultDist)
    snap()
  }

  /// Jumps the eased state to the targets.
  public mutating func snap() {
    theta = targetTheta
    phi = targetPhi
    distance = targetDistance
  }

  /// Orbit drag by a pointer delta in points (0.008 rad / pt, as on web).
  public mutating func drag(dx: Double, dy: Double, now: TimeInterval) {
    guard interactive, dx.isFinite, dy.isFinite else { return }
    lastInteraction = now
    targetTheta = clampTheta(targetTheta - dx * 0.008)
    targetPhi = clampPhi(targetPhi + dy * 0.008)
  }

  /// Pinch zoom: `scale > 1` (fingers apart) moves closer.
  public mutating func pinch(scale: Double, now: TimeInterval) {
    guard interactive, scale.isFinite, scale > 0 else { return }
    lastInteraction = now
    targetDistance = clampDistance(targetDistance / scale)
  }

  /// Marks an interaction (pauses auto-rotate for its delay).
  public mutating func touch(now: TimeInterval) { lastInteraction = now }

  /// Eases toward the targets (12% per 60 Hz frame) and advances auto-rotate. Returns a change
  /// to report, or `nil`.
  public mutating func step(dt: TimeInterval, now: TimeInterval, pointerDown: Bool = false)
    -> XRCameraChange?
  {
    let d = dt.isFinite ? min(0.25, max(0, dt)) : 0
    if autoRotate && !pointerDown && now - lastInteraction >= autoRotateDelay {
      turntable = (turntable + autoRotateSpeed * d).truncatingRemainder(dividingBy: 2 * .pi)
    }
    let k = 1 - pow(1 - 0.12, d * 60)
    theta += (targetTheta - theta) * k
    phi += (targetPhi - phi) * k
    distance += (targetDistance - distance) * k
    return pollChange()
  }

  /// The current change if θ / φ moved ≥ 1° or zoom ≥ 0.02 since the last report.
  public mutating func pollChange() -> XRCameraChange? {
    let deg = theta * 180 / .pi
    let thetaDeg =
      Int(
        ((deg.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360))
          .rounded()) % 360
    let phiDeg = Int((phi * 180 / .pi).rounded())
    let zoom = ((boundsRadius * 2.5 / distance) * 100).rounded() / 100
    if let (t, p, z) = lastReported, abs(thetaDeg - t) < 1, abs(phiDeg - p) < 1,
      abs(zoom - z) < 0.02
    {
      return nil
    }
    lastReported = (thetaDeg, phiDeg, zoom)
    return XRCameraChange(
      theta: thetaDeg, phi: phiDeg, zoom: zoom, distance: (distance * 100).rounded() / 100)
  }

  /// The orbit target (the follow target, else `camera-target`, else the bounds center).
  public var target: SIMD3<Double> { followTarget ?? customTarget ?? boundsCenter }

  /// `target + distance × (cosφ sinθ, sinφ, cosφ cosθ)`.
  public var eye: SIMD3<Double> {
    target + distance * SIMD3<Double>(cos(phi) * sin(theta), sin(phi), cos(phi) * cos(theta))
  }

  /// Column-major turntable model matrix (rotation about +Y through `boundsCenter`).
  public var turntableMatrix: simd_float4x4 {
    let c = cos(turntable)
    let s = sin(turntable)
    let cx = boundsCenter.x
    let cz = boundsCenter.z
    return simd_float4x4(
      columns: (
        SIMD4<Float>(Float(c), 0, Float(-s), 0),
        SIMD4<Float>(0, 1, 0, 0),
        SIMD4<Float>(Float(s), 0, Float(c), 0),
        SIMD4<Float>(Float(cx - (c * cx + s * cz)), 0, Float(cz - (-s * cx + c * cz)), 1)
      ))
  }

  /// World ray through normalized device coordinates (`ndc` in −1…1, +Y up) for `aspect`.
  public func viewportRay(ndc: SIMD2<Double>, aspect: Double) -> (
    origin: SIMD3<Double>, direction: SIMD3<Double>
  ) {
    let o = eye
    var f = target - o
    f = simd_length(f) > 1e-12 ? simd_normalize(f) : SIMD3<Double>(0, 0, -1)
    var r = SIMD3<Double>(-f.z, 0, f.x)
    r = simd_length(r) > 1e-12 ? simd_normalize(r) : SIMD3<Double>(1, 0, 0)
    let u = simd_cross(r, f)
    let tanHalf = tan(fieldOfViewDeg * .pi / 360)
    let a = (aspect.isFinite && aspect > 0) ? aspect : 1
    let d = simd_normalize(f + r * (ndc.x * tanHalf * a) + u * (ndc.y * tanHalf))
    return (o, d)
  }

  private mutating func applyOrbit(_ s: String?) {
    guard let parts = s.map(Self.split), parts.count >= 2 else { return }
    let t = Self.parseAngleDeg(parts[0])
    let p = Self.parseAngleDeg(parts[1])
    let d = parts.count > 2 ? Self.parseMeters(parts[2]).flatMap { $0 > 0 ? $0 : nil } : nil
    guard t != nil || p != nil else { return }
    initialTheta = t.map { $0 * .pi / 180 }
    initialPhi = p.map { $0 * .pi / 180 }
    initialDistance = d
    if let v = initialTheta { targetTheta = clampTheta(v) }
    if let v = initialPhi { targetPhi = clampPhi(v) }
    if let v = initialDistance { targetDistance = clampDistance(v) }
  }

  private mutating func applyLimits(_ lo: String?, _ hi: String?) {
    let a = Self.parseOrbitLimit(lo)
    let b = Self.parseOrbitLimit(hi)
    minTheta = a.0.map { $0 * .pi / 180 } ?? -.infinity
    maxTheta = b.0.map { $0 * .pi / 180 } ?? .infinity
    minPhi = a.1.map { max(-Self.phiLimit, $0 * .pi / 180) } ?? -Self.phiLimit
    maxPhi = b.1.map { min(Self.phiLimit, $0 * .pi / 180) } ?? Self.phiLimit
    minDistance = a.2
    maxDistance = b.2
    targetTheta = clampTheta(targetTheta)
    targetPhi = clampPhi(targetPhi)
    targetDistance = clampDistance(targetDistance)
  }

  private func clampTheta(_ v: Double) -> Double { max(minTheta, min(maxTheta, v)) }
  private func clampPhi(_ v: Double) -> Double { max(minPhi, min(maxPhi, v)) }
  private func clampDistance(_ v: Double) -> Double {
    max(minDistance ?? boundsRadius * 0.5, min(maxDistance ?? boundsRadius * 8, v))
  }

  // MARK: Attribute parsing (shared grammar with the web element)

  static func split(_ s: String) -> [String] {
    s.split(whereSeparator: { $0 == " " || $0 == "\t" || $0 == "\n" }).map(String.init)
  }

  /// `"30deg"`, `"0.5rad"` or a bare number (degrees); `auto` / invalid → `nil`.
  public static func parseAngleDeg(_ s: String) -> Double? {
    if s == "auto" { return nil }
    if s.hasSuffix("rad") {
      return Double(s.dropLast(3)).flatMap { $0.isFinite ? $0 * 180 / .pi : nil }
    }
    let body = s.hasSuffix("deg") ? String(s.dropLast(3)) : s
    return Double(body).flatMap { $0.isFinite ? $0 : nil }
  }

  /// `"2.5m"` or a bare number.
  public static func parseMeters(_ s: String) -> Double? {
    Double(s.hasSuffix("m") ? String(s.dropLast()) : s).flatMap { $0.isFinite ? $0 : nil }
  }

  /// `min/max-camera-orbit` → (θ°, φ°, meters).
  public static func parseOrbitLimit(_ s: String?) -> (Double?, Double?, Double?) {
    guard let s = s else { return (nil, nil, nil) }
    let p = split(s)
    return (
      p.count > 0 ? parseAngleDeg(p[0]) : nil,
      p.count > 1 ? parseAngleDeg(p[1]) : nil,
      p.count > 2 && p[2] != "auto" ? parseMeters(p[2]) : nil
    )
  }

  /// `camera-target` (`"x y z"`).
  public static func parseCameraTarget(_ s: String?) -> SIMD3<Double>? {
    guard let s = s else { return nil }
    let p = split(s)
    guard p.count >= 3, let x = parseMeters(p[0]), let y = parseMeters(p[1]),
      let z = parseMeters(p[2])
    else { return nil }
    return SIMD3<Double>(x, y, z)
  }

  /// `field-of-view`.
  public static func parseFieldOfView(_ s: String?) -> Double? {
    s.flatMap { parseAngleDeg($0.trimmingCharacters(in: .whitespaces)) }
  }

  /// `rotation-per-second` (`"30deg"`, `"0.5rad"`, `"10%"`); default π/6 rad/s.
  public static func parseRotationPerSecond(_ s: String?) -> Double {
    guard let t = s?.trimmingCharacters(in: .whitespaces), !t.isEmpty else { return .pi / 6 }
    var numeric = ""
    for ch in t {
      if ch.isNumber || ch == "." || ch == "-" || ch == "+" || ch == "e" || ch == "E" {
        numeric.append(ch)
      } else {
        break
      }
    }
    guard let n = Double(numeric), n.isFinite else { return .pi / 6 }
    if t.hasSuffix("rad") { return n }
    if t.hasSuffix("%") { return n / 100 * 2 * .pi }
    return n * .pi / 180
  }
}
