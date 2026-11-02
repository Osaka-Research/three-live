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

import Foundation
import simd

/// Pure math and reticle geometry builder for `gaze-dwell` (`gaze-dwell.ts`).
public enum GazeDwell {
  public static let emaAlpha: Float = 0.25
  public static let graceConeDeg: Float = 1.5
  public static let graceMs: Float = 150
  public static let reticleAngularScale: Float = 0.018

  /// Smooths a raw gaze ray direction using an exponential moving average and normalizes it.
  public static func smoothDirection(
    prev: SIMD3<Float>?,
    raw: SIMD3<Float>,
    alpha: Float = emaAlpha
  ) -> SIMD3<Float> {
    let target = XRSpatialMath.normalize(raw, fallback: SIMD3<Float>(0, 0, -1))
    guard let prevRaw = prev, prevRaw.x.isFinite, prevRaw.y.isFinite, prevRaw.z.isFinite else {
      return target
    }
    let p = XRSpatialMath.normalize(prevRaw, fallback: target)
    let a = Float(XRJSON.clampNum(Double(alpha), 0.01, 1, Double(emaAlpha)))
    let d = max(-1, min(1, simd_dot(p, target)))
    if d > 0.9995 {
      return XRSpatialMath.normalize(p + (target - p) * a, fallback: target)
    }
    if d < -0.9995 {
      let ref = abs(p.x) < 0.9 ? SIMD3<Float>(1, 0, 0) : SIMD3<Float>(0, 1, 0)
      let perp = XRSpatialMath.normalize(simd_cross(ref, p), fallback: SIMD3<Float>(0, 1, 0))
      let theta = a * .pi
      return XRSpatialMath.normalize(p * cos(theta) + perp * sin(theta), fallback: target)
    }
    let omega = acos(d)
    let sinOmega = sin(omega)
    let w0 = sin((1 - a) * omega) / sinOmega
    let w1 = sin(a * omega) / sinOmega
    return XRSpatialMath.normalize(p * w0 + target * w1, fallback: target)
  }

  /// Returns the angle in degrees (`0..180`) between two direction vectors.
  public static func angleBetweenDeg(_ a: SIMD3<Float>, _ b: SIMD3<Float>) -> Float {
    let na = XRSpatialMath.normalize(a, fallback: SIMD3<Float>(0, 0, -1))
    let nb = XRSpatialMath.normalize(b, fallback: SIMD3<Float>(0, 0, -1))
    let c = max(-1, min(1, simd_dot(na, nb)))
    return acos(c) * 180 / .pi
  }

  /// Computes normalized `[0..1]` radial dwell progress after `graceMs` over `dwellMs`.
  public static func computeDwellProgress(
    elapsedMs: Float,
    dwellMs: Float,
    graceMs: Float = GazeDwell.graceMs
  ) -> Float {
    let total = Float(XRJSON.clampNum(Double(dwellMs), 250, 10000, 1200))
    let grace = min(total - 1, max(0, graceMs))
    guard elapsedMs.isFinite, elapsedMs > grace else { return 0 }
    return max(0, min(1, (elapsedMs - grace) / (total - grace)))
  }

  /// Computes the shortest-arc unit quaternion rotating `from` onto `to`.
  public static func quatFromUnitVectors(from: SIMD3<Float>, to: SIMD3<Float>) -> simd_quatf {
    let u = XRSpatialMath.normalize(from, fallback: SIMD3<Float>(0, 0, 1))
    let v = XRSpatialMath.normalize(to, fallback: SIMD3<Float>(0, 0, 1))
    let r = simd_dot(u, v) + 1
    if r < 1e-6 {
      let ax = abs(u.x) > abs(u.z) ? SIMD3<Float>(-u.y, u.x, 0) : SIMD3<Float>(0, -u.z, u.y)
      let n = XRSpatialMath.normalize(ax, fallback: SIMD3<Float>(1, 0, 0))
      return simd_quatf(ix: n.x, iy: n.y, iz: n.z, r: 0)
    }
    let c = simd_cross(u, v)
    let len = sqrt(c.x * c.x + c.y * c.y + c.z * c.z + r * r)
    return len > 1e-8
      ? simd_quatf(ix: c.x / len, iy: c.y / len, iz: c.z / len, r: r / len)
      : XRSpatialMath.identityQuat
  }

  /// Builds a double-sided dual-ring + clockwise progress arc mesh of unit radius (`1.0`) facing `+Z`.
  public static func buildReticleGeometry(progress: Float, segments: Int = 24)
    -> XRGeneratedGeometry
  {
    let segs = max(8, min(64, segments))
    let p = progress.isFinite ? max(0, min(1, progress)) : 0
    let arcSegs = p > 1e-3 ? max(1, Int((p * Float(segs)).rounded())) : 0
    let totalQuads = segs + arcSegs
    var positions = [Float]()
    var normals = [Float]()
    var indices = [UInt32]()
    positions.reserveCapacity(totalQuads * 24)
    normals.reserveCapacity(totalQuads * 24)
    indices.reserveCapacity(totalQuads * 12)
    var vi: UInt32 = 0

    func appendQuad(_ a0: Float, _ a1: Float, _ rInner: Float, _ rOuter: Float, _ zOff: Float) {
      let c0 = cos(a0)
      let s0 = sin(a0)
      let c1 = cos(a1)
      let s1 = sin(a1)
      let pts: [(Float, Float)] = [
        (c0 * rInner, s0 * rInner),
        (c1 * rInner, s1 * rInner),
        (c1 * rOuter, s1 * rOuter),
        (c0 * rOuter, s0 * rOuter),
      ]
      let front = vi
      for (x, y) in pts {
        positions.append(contentsOf: [x, y, zOff])
        normals.append(contentsOf: [0, 0, 1])
        vi += 1
      }
      indices.append(contentsOf: [front, front + 1, front + 2, front, front + 2, front + 3])

      let back = vi
      for (x, y) in pts {
        positions.append(contentsOf: [x, y, -zOff])
        normals.append(contentsOf: [0, 0, -1])
        vi += 1
      }
      indices.append(contentsOf: [back, back + 2, back + 1, back, back + 3, back + 2])
    }

    for i in 0..<segs {
      let a0 = (Float(i) / Float(segs)) * .pi * 2
      let a1 = (Float(i + 1) / Float(segs)) * .pi * 2
      appendQuad(a0, a1, 0.84, 1.0, 0.0005)
    }
    for i in 0..<arcSegs {
      let t0 = Float(i) / Float(arcSegs)
      let t1 = Float(i + 1) / Float(arcSegs)
      let a0 = .pi * 0.5 - t0 * p * .pi * 2
      let a1 = .pi * 0.5 - t1 * p * .pi * 2
      appendQuad(a1, a0, 0.42, 0.72, 0.0012)
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }
}

// MARK: - Exploded View
