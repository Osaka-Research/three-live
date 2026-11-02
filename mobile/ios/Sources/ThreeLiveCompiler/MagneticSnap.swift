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

/// Pure math and preview torus builder for `magnetic-snap` (`magnetic-snap.ts`).
public enum MagneticSnap {
  public static let socketUnsnapMultiplier: Float = 1.25
  public static let socketPreviewMultiplier: Float = 1.5

  public struct SocketCandidate: Sendable, Equatable {
    public var id: String
    public var tag: String
    public var position: SIMD3<Float>
    public var orientation: simd_quatf
    public var radius: Float
    public var alignRotation: Bool
    public var highlightColor: String

    public init(
      id: String,
      tag: String,
      position: SIMD3<Float>,
      orientation: simd_quatf = XRSpatialMath.identityQuat,
      radius: Float = 0.15,
      alignRotation: Bool = true,
      highlightColor: String = "#22c55e"
    ) {
      self.id = id
      self.tag = tag
      self.position = position
      self.orientation = orientation
      self.radius = radius
      self.alignRotation = alignRotation
      self.highlightColor = highlightColor
    }
  }

  public struct SurfacePlane: Sendable, Equatable {
    public var position: SIMD3<Float>
    public var normal: SIMD3<Float>
    public var orientation: String?
    public var semanticLabel: String?

    public init(
      position: SIMD3<Float>,
      normal: SIMD3<Float>,
      orientation: String? = nil,
      semanticLabel: String? = nil
    ) {
      self.position = position
      self.normal = normal
      self.orientation = orientation
      self.semanticLabel = semanticLabel
    }
  }

  public struct Evaluation: Sendable, Equatable {
    public var position: SIMD3<Float>
    public var orientation: simd_quatf
    public var mode: String
    public var matchedSocketId: String?
    public var previewSocketId: String?
  }

  private static func sanitizeQuat(_ q: simd_quatf) -> simd_quatf {
    let v = q.vector
    let x = v.x.isFinite ? v.x : 0
    let y = v.y.isFinite ? v.y : 0
    let z = v.z.isFinite ? v.z : 0
    let w = v.w.isFinite ? v.w : 1
    let len = sqrt(x * x + y * y + z * z + w * w)
    return len > 1e-8
      ? simd_quatf(ix: x / len, iy: y / len, iz: z / len, r: w / len)
      : XRSpatialMath.identityQuat
  }

  /// Composes a unit quaternion from intrinsic YXZ Euler angles (radians).
  public static func quatFromEulerYXZ(pitchX: Float, yawY: Float, rollZ: Float = 0) -> simd_quatf {
    let cx = cos(pitchX * 0.5)
    let sx = sin(pitchX * 0.5)
    let cy = cos(yawY * 0.5)
    let sy = sin(yawY * 0.5)
    let cz = cos(rollZ * 0.5)
    let sz = sin(rollZ * 0.5)
    return simd_quatf(
      ix: cy * sx * cz + sy * cx * sz,
      iy: sy * cx * cz - cy * sx * sz,
      iz: cy * cx * sz - sy * sx * cz,
      r: cy * cx * cz + sy * sx * sz
    )
  }

  /// Decomposes `q` into intrinsic YXZ Euler angles `(pitchX, yawY, rollZ)` (radians).
  public static func eulerYXZFromQuat(_ q: simd_quatf) -> SIMD3<Float> {
    let n = sanitizeQuat(q).vector
    let (x, y, z, w) = (n.x, n.y, n.z, n.w)
    let sinPitch = max(-1, min(1, 2 * (w * x - y * z)))
    let pitchX = asin(sinPitch)
    if abs(sinPitch) < 0.99999 {
      let yawY = atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y))
      let rollZ = atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z))
      return SIMD3<Float>(pitchX, yawY, rollZ)
    }
    let yawY = atan2(2 * (w * y - x * z), 1 - 2 * (y * y + z * z))
    return SIMD3<Float>(pitchX, yawY, 0)
  }

  /// Quantizes a quaternion's YXZ Euler angles to multiples of `angleDeg` degrees.
  public static func quantizeQuaternionAngle(_ q: simd_quatf, angleDeg: Float) -> simd_quatf {
    let norm = sanitizeQuat(q)
    guard angleDeg.isFinite, angleDeg > 0 else { return norm }
    let step = min(180, angleDeg) * .pi / 180
    let e = eulerYXZFromQuat(norm)
    let qx = floor(e.x / step + 0.5) * step
    let qy = floor(e.y / step + 0.5) * step
    let qz = floor(e.z / step + 0.5) * step
    return quatFromEulerYXZ(pitchX: qx, yawY: qy, rollZ: qz)
  }

  /// Quantizes a 3D world position to the Cartesian step vector `grid` (meters).
  public static func quantizeGridPosition(_ pos: SIMD3<Float>, grid: SIMD3<Float>?) -> SIMD3<Float>
  {
    let p = SIMD3<Float>(
      pos.x.isFinite ? pos.x : 0, pos.y.isFinite ? pos.y : 0, pos.z.isFinite ? pos.z : 0)
    guard let g = grid else { return p }
    return SIMD3<Float>(
      g.x > 0 ? floor(p.x / g.x + 0.5) * g.x : p.x,
      g.y > 0 ? floor(p.y / g.y + 0.5) * g.y : p.y,
      g.z > 0 ? floor(p.z / g.z + 0.5) * g.z : p.z
    )
  }

  private static func planeMatchesSurface(_ plane: SurfacePlane, mode: String) -> Bool {
    if mode == "none" { return false }
    if mode == "any" { return true }
    let n = XRSpatialMath.normalize(plane.normal, fallback: SIMD3<Float>(0, 1, 0))
    let label = (plane.semanticLabel ?? "").lowercased()
    switch mode {
    case "floor": return label == "floor" || (label != "ceiling" && n.y > 0.7)
    case "ceiling": return label == "ceiling" || n.y < -0.7
    case "wall": return label == "wall" || plane.orientation == "vertical" || abs(n.y) <= 0.35
    default: return false
    }
  }

  /// Evaluates socket hysteresis, Cartesian grid, surface clamping, and angle quantization.
  public static func evaluate(
    position: SIMD3<Float>,
    orientation: simd_quatf,
    config: XRLiveSnapTo,
    sockets: [SocketCandidate] = [],
    planes: [SurfacePlane] = [],
    currentSocketId: String? = nil,
    bottomOffset: Float = 0,
    defaultFloorY: Float = 0
  ) -> Evaluation {
    let pos = SIMD3<Float>(
      position.x.isFinite ? position.x : 0,
      position.y.isFinite ? position.y : 0,
      position.z.isFinite ? position.z : 0
    )
    let quat = sanitizeQuat(orientation)
    let bOff = bottomOffset.isFinite ? bottomOffset : 0
    let floorY = defaultFloorY.isFinite ? defaultFloorY : 0

    var matchedSocket: SocketCandidate?
    var previewSocket: SocketCandidate?
    if !config.socketTag.isEmpty {
      if let cid = currentSocketId,
        let held = sockets.first(where: { $0.id == cid && $0.tag == config.socketTag })
      {
        let snapR = min(config.radius, held.radius)
        if simd_length(pos - held.position) <= socketUnsnapMultiplier * snapR {
          matchedSocket = held
          previewSocket = held
        }
      }
      if matchedSocket == nil {
        var bestSnapDist = Float.infinity
        var bestPreviewDist = Float.infinity
        for s in sockets where s.tag == config.socketTag {
          let snapR = min(config.radius, s.radius)
          let d = simd_length(pos - s.position)
          if d <= snapR && d < bestSnapDist {
            bestSnapDist = d
            matchedSocket = s
          }
          if d <= socketPreviewMultiplier * snapR && d < bestPreviewDist {
            bestPreviewDist = d
            previewSocket = s
          }
        }
      }
    }

    if let matched = matchedSocket {
      let snappedQuat: simd_quatf
      if matched.alignRotation {
        snappedQuat = sanitizeQuat(matched.orientation)
      } else if config.angleDeg > 0 {
        snappedQuat = quantizeQuaternionAngle(quat, angleDeg: config.angleDeg)
      } else {
        snappedQuat = quat
      }
      return Evaluation(
        position: matched.position,
        orientation: snappedQuat,
        mode: "socket",
        matchedSocketId: matched.id,
        previewSocketId: matched.id
      )
    }

    var nextPos = quantizeGridPosition(pos, grid: config.grid)
    var surfaceApplied = false
    if config.surface != "none" {
      var bestPlane: SurfacePlane?
      var bestErr = Float.infinity
      let captureLimit = max(config.radius, 0.35)
      for p in planes where planeMatchesSurface(p, mode: config.surface) {
        let n = XRSpatialMath.normalize(p.normal, fallback: SIMD3<Float>(0, 1, 0))
        let signed = simd_dot(nextPos - p.position, n) - bOff
        let absErr = abs(signed)
        if absErr <= captureLimit && absErr < bestErr {
          bestErr = absErr
          bestPlane = p
        }
      }
      if let bp = bestPlane {
        let n = XRSpatialMath.normalize(bp.normal, fallback: SIMD3<Float>(0, 1, 0))
        let signed = simd_dot(nextPos - bp.position, n) - bOff
        nextPos -= n * signed
        surfaceApplied = true
      } else if config.surface == "floor" || config.surface == "any" {
        nextPos.y = floorY + bOff
        surfaceApplied = true
      }
    }

    let nextQuat =
      config.angleDeg > 0 ? quantizeQuaternionAngle(quat, angleDeg: config.angleDeg) : quat
    let gridOrAngle = config.grid != nil || config.angleDeg > 0
    let mode: String
    if surfaceApplied && config.grid == nil {
      mode = "surface"
    } else if gridOrAngle {
      mode = "grid"
    } else if surfaceApplied {
      mode = "surface"
    } else {
      mode = "none"
    }
    return Evaluation(
      position: nextPos,
      orientation: nextQuat,
      mode: mode,
      matchedSocketId: nil,
      previewSocketId: previewSocket?.id
    )
  }

  /// Generates a 3D torus ring in the XZ plane (`+Y` normal) for socket preview.
  public static func buildSnapRingGeometry(
    majorRadius: Float = 0.12,
    tubeRadius: Float = 0.008,
    radialSegments: Int = 24,
    tubularSegments: Int = 8
  ) -> XRGeneratedGeometry {
    let bigR = max(0.01, majorRadius)
    let smallR = max(0.001, min(bigR * 0.45, tubeRadius))
    let segU = max(8, radialSegments)
    let segV = max(4, tubularSegments)
    let vertCount = (segU + 1) * (segV + 1)
    var positions = [Float]()
    var normals = [Float]()
    var indices = [UInt32]()
    positions.reserveCapacity(vertCount * 3)
    normals.reserveCapacity(vertCount * 3)
    indices.reserveCapacity(segU * segV * 6)
    for i in 0...segU {
      let u = (Float(i) / Float(segU)) * .pi * 2
      let cu = cos(u)
      let su = sin(u)
      for j in 0...segV {
        let v = (Float(j) / Float(segV)) * .pi * 2
        let cv = cos(v)
        let sv = sin(v)
        let rad = bigR + smallR * cv
        positions.append(contentsOf: [rad * cu, smallR * sv, rad * su])
        normals.append(contentsOf: [cv * cu, sv, cv * su])
      }
    }
    let stride = UInt32(segV + 1)
    for i in 0..<UInt32(segU) {
      for j in 0..<UInt32(segV) {
        let a = i * stride + j
        let b = (i + 1) * stride + j
        let c = (i + 1) * stride + (j + 1)
        let d = i * stride + (j + 1)
        indices.append(contentsOf: [a, c, b, a, d, c])
      }
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }
}
