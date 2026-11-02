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

/// Pure ballistic trajectory, snap-turn hysteresis, and arc ribbon mesh builder for
/// `spatial-locomotion` (`xr-live/src/plugins/spatial-locomotion.ts`).
public enum SpatialLocomotion {
  public static let teleportSpeed: Float = 6.0
  public static let teleportGravity: Float = -9.8
  public static let teleportSegments = 20
  public static let teleportStepDt: Float = 0.08
  public static let minWalkableNormalY: Float = 0.7
  public static let snapTurnTrigger: Float = 0.65
  public static let snapTurnReset: Float = 0.25
  public static let comfortVignetteMs: Float = 120.0

  public struct SnapTurnStep: Sendable, Equatable {
    public var deltaYawDeg: Float
    public var latched: Bool
  }

  public struct TeleportArcHit: Sendable, Equatable {
    public var valid: Bool
    public var point: SIMD3<Float>
    public var normal: SIMD3<Float>
    public var points: [SIMD3<Float>]
    public var hitNodeIndex: Int
  }

  /// Samples `segments + 1` points along a ballistic projectile parabola.
  public static func sampleParabola(
    origin: SIMD3<Float>,
    direction: SIMD3<Float>,
    speed: Float = teleportSpeed,
    gravity: Float = teleportGravity,
    segments: Int = teleportSegments,
    stepDt: Float = teleportStepDt
  ) -> [SIMD3<Float>] {
    let p0 = SIMD3<Float>(
      origin.x.isFinite ? origin.x : 0,
      origin.y.isFinite ? origin.y : 0,
      origin.z.isFinite ? origin.z : 0
    )
    let dir = XRSpatialMath.normalize(direction, fallback: SIMD3<Float>(0, 0, -1))
    let v0 = Float(XRJSON.clampNum(Double(speed), 0.5, 30, Double(teleportSpeed)))
    let g = Float(XRJSON.clampNum(Double(gravity), -30, -0.5, Double(teleportGravity)))
    let segs = max(2, min(64, segments))
    let dt = Float(XRJSON.clampNum(Double(stepDt), 0.01, 0.25, Double(teleportStepDt)))

    var pts: [SIMD3<Float>] = []
    pts.reserveCapacity(segs + 1)
    for i in 0...segs {
      let t = Float(i) * dt
      pts.append(
        SIMD3<Float>(
          p0.x + dir.x * v0 * t,
          p0.y + dir.y * v0 * t + 0.5 * g * t * t,
          p0.z + dir.z * v0 * t
        )
      )
    }
    return pts
  }

  /// Evaluates thumbstick snap-turn hysteresis (`|x| > 0.65` trigger, `< 0.25` reset).
  public static func evaluateSnapTurn(
    axisX: Float,
    wasLatched: Bool,
    snapTurnDeg: Float = 30
  ) -> SnapTurnStep {
    let stepDeg = Float(XRJSON.clampNum(Double(snapTurnDeg), 15, 90, 30))
    guard axisX.isFinite else { return SnapTurnStep(deltaYawDeg: 0, latched: wasLatched) }
    let absX = abs(axisX)
    if wasLatched {
      return SnapTurnStep(deltaYawDeg: 0, latched: absX >= snapTurnReset)
    }
    if absX > snapTurnTrigger {
      return SnapTurnStep(deltaYawDeg: axisX > 0 ? -stepDeg : stepDeg, latched: true)
    }
    return SnapTurnStep(deltaYawDeg: 0, latched: false)
  }

  /// Builds a double-sided 3D ribbon mesh along a polyline of world-space points.
  public static func buildArcGeometry(
    _ points: [SIMD3<Float>],
    halfWidth: Float = 0.014
  ) -> XRGeneratedGeometry {
    guard points.count >= 2 else {
      return XRGeneratedGeometry(positions: [], normals: [], indices: [])
    }
    let hw = max(0.002, halfWidth)
    let segCount = points.count - 1
    var positions: [Float] = []
    var normals: [Float] = []
    var indices: [UInt32] = []
    positions.reserveCapacity(segCount * 24)
    normals.reserveCapacity(segCount * 24)
    indices.reserveCapacity(segCount * 12)
    var vi: UInt32 = 0

    for i in 0..<segCount {
      let a = points[i]
      let b = points[i + 1]
      let tangent = XRSpatialMath.normalize(b - a, fallback: SIMD3<Float>(0, 0, -1))
      var sideRaw = simd_cross(tangent, SIMD3<Float>(0, 1, 0))
      if simd_length(sideRaw) < 1e-4 { sideRaw = SIMD3<Float>(1, 0, 0) }
      let side = XRSpatialMath.normalize(sideRaw, fallback: SIMD3<Float>(1, 0, 0)) * hw
      let up = XRSpatialMath.normalize(simd_cross(side, tangent), fallback: SIMD3<Float>(0, 1, 0))
      let corners = [a - side, a + side, b + side, b - side]

      let front = vi
      for c in corners {
        positions.append(contentsOf: [c.x, c.y, c.z])
        normals.append(contentsOf: [up.x, up.y, up.z])
        vi += 1
      }
      indices.append(contentsOf: [front, front + 1, front + 2, front, front + 2, front + 3])

      let back = vi
      for c in corners {
        positions.append(contentsOf: [c.x, c.y, c.z])
        normals.append(contentsOf: [-up.x, -up.y, -up.z])
        vi += 1
      }
      indices.append(contentsOf: [back, back + 2, back + 1, back, back + 3, back + 2])
    }

    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }
}
