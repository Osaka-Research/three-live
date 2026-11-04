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

/// Analytic 2-bone law-of-cosines and N-bone FABRIK inverse kinematics solvers
/// (mirrors `three-live/src/plugins/ik.ts`).
public enum IKSolver {

  /// Solved joint positions and delta rotations for a 2-bone IK chain.
  public struct TwoBoneIKSolution: Sendable, Equatable {
    public let rootPos: SIMD3<Float>
    public let midPos: SIMD3<Float>
    public let effectorPos: SIMD3<Float>
    public let rootRotation: simd_quatf
    public let midRotation: simd_quatf
  }

  /// Solved joint positions and segment delta rotations for an N-bone FABRIK chain.
  public struct FABRIKSolution: Sendable, Equatable {
    public let positions: [SIMD3<Float>]
    public let rotations: [simd_quatf]
    public let iterations: Int
  }

  /// Computes the shortest-arc unit quaternion rotating unit vector `fromDir` onto `toDir`.
  public static func quatFromUnitVectors(
    _ fromDir: SIMD3<Float>,
    _ toDir: SIMD3<Float>
  ) -> simd_quatf {
    let dot = simd_dot(fromDir, toDir)
    let r = dot + 1.0
    if r < 1e-6 {
      if abs(fromDir.x) > abs(fromDir.z) {
        let len = hypot(fromDir.y, fromDir.x)
        let d = len > 0 ? len : 1
        return simd_quatf(ix: -fromDir.y / d, iy: fromDir.x / d, iz: 0, r: 0)
      }
      let len = hypot(fromDir.z, fromDir.y)
      let d = len > 0 ? len : 1
      return simd_quatf(ix: 0, iy: -fromDir.z / d, iz: fromDir.y / d, r: 0)
    }
    let c = simd_cross(fromDir, toDir)
    let len = sqrt(c.x * c.x + c.y * c.y + c.z * c.z + r * r)
    let d = len > 0 ? len : 1
    return simd_quatf(ix: c.x / d, iy: c.y / d, iz: c.z / d, r: r / d)
  }

  /// Analytic 2-bone inverse kinematics solver using the law of cosines and pole-vector
  /// bend-plane projection.
  public static func solveTwoBoneIK(
    rootPos: SIMD3<Float>,
    midPos: SIMD3<Float>,
    effectorPos: SIMD3<Float>,
    targetPos: SIMD3<Float>,
    polePos: SIMD3<Float>? = nil
  ) -> TwoBoneIKSolution {
    let v1 = midPos - rootPos
    let l1 = simd_length(v1)
    let v2 = effectorPos - midPos
    let l2 = simd_length(v2)

    if l1 < 1e-6 || l2 < 1e-6 {
      return TwoBoneIKSolution(
        rootPos: rootPos,
        midPos: midPos,
        effectorPos: effectorPos,
        rootRotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1),
        midRotation: simd_quatf(ix: 0, iy: 0, iz: 0, r: 1)
      )
    }

    let initDir1 = v1 / l1
    let initDir2 = v2 / l2

    let toTarget = targetPos - rootPos
    let rawDist = simd_length(toTarget)
    let dirToTarget = rawDist > 1e-6 ? toTarget / rawDist : initDir1

    let minDist = abs(l1 - l2) + 1e-5
    let maxDist = Swift.max(minDist, l1 + l2 - 1e-5)
    let d = Swift.max(minDist, Swift.min(maxDist, rawDist > 1e-6 ? rawDist : minDist))

    let rawCos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    let cosAlpha = Swift.max(-1.0, Swift.min(1.0, rawCos))
    let sinAlpha = sqrt(Swift.max(0.0, 1.0 - cosAlpha * cosAlpha))

    let poleVec = (polePos ?? midPos) - rootPos
    let proj = poleVec - dirToTarget * simd_dot(poleVec, dirToTarget)
    let projLen = simd_length(proj)

    let bendDir: SIMD3<Float>
    if projLen > 1e-6 {
      bendDir = proj / projLen
    } else {
      let refAxis = abs(dirToTarget.y) < 0.99 ? SIMD3<Float>(0, 1, 0) : SIMD3<Float>(1, 0, 0)
      let c = simd_cross(dirToTarget, refAxis)
      let cLen = simd_length(c)
      bendDir = cLen > 0 ? c / cLen : SIMD3<Float>(0, 1, 0)
    }

    let solvedMid = rootPos + dirToTarget * (l1 * cosAlpha) + bendDir * (l1 * sinAlpha)
    let clampedTarget = rootPos + dirToTarget * d
    let effVec = clampedTarget - solvedMid
    let effLen = simd_length(effVec)
    let solvedDir2 = effLen > 1e-6 ? effVec / effLen : dirToTarget
    let solvedEffector = solvedMid + solvedDir2 * l2
    let solvedDir1 = (solvedMid - rootPos) / l1

    return TwoBoneIKSolution(
      rootPos: rootPos,
      midPos: solvedMid,
      effectorPos: solvedEffector,
      rootRotation: quatFromUnitVectors(initDir1, solvedDir1),
      midRotation: quatFromUnitVectors(initDir2, solvedDir2)
    )
  }

  /// Forward And Backward Reaching Inverse Kinematics (FABRIK) solver for an N-joint chain,
  /// preserving every bone segment length.
  public static func solveFABRIK(
    positions: [SIMD3<Float>],
    targetPos: SIMD3<Float>,
    maxIterations: Int = 8,
    tolerance: Float = 1e-3
  ) -> FABRIKSolution {
    let n = positions.count
    if n < 2 {
      return FABRIKSolution(positions: positions, rotations: [], iterations: 0)
    }

    var pts = positions
    var lengths: [Float] = []
    var initDirs: [SIMD3<Float>] = []
    lengths.reserveCapacity(n - 1)
    initDirs.reserveCapacity(n - 1)
    var totalLength: Float = 0

    for i in 0..<(n - 1) {
      let seg = pts[i + 1] - pts[i]
      let len = simd_length(seg)
      lengths.append(len)
      totalLength += len
      initDirs.append(len > 1e-6 ? seg / len : SIMD3<Float>(0, 1, 0))
    }

    let root = pts[0]
    let maxIters = Swift.max(1, Swift.min(32, maxIterations))
    let tol = Swift.max(Float(1e-5), Swift.min(Float(0.1), tolerance))

    let toTarget = targetPos - root
    let distToTarget = simd_length(toTarget)
    var usedIters = 0

    if distToTarget >= totalLength && totalLength > 1e-6 {
      let dir = distToTarget > 1e-6 ? toTarget / distToTarget : initDirs[0]
      pts[0] = root
      for i in 0..<(n - 1) {
        pts[i + 1] = pts[i] + dir * lengths[i]
      }
      usedIters = 1
    } else {
      for iter in 1...maxIters {
        let err = simd_length(pts[n - 1] - targetPos)
        if err <= tol {
          break
        }
        usedIters = iter

        // Forward reaching (effector -> root)
        pts[n - 1] = targetPos
        for i in stride(from: n - 2, through: 0, by: -1) {
          let seg = pts[i] - pts[i + 1]
          let d = simd_length(seg)
          let l = lengths[i]
          if d > 1e-6 {
            pts[i] = pts[i + 1] + seg * (l / d)
          } else {
            pts[i] = pts[i + 1] - initDirs[i] * l
          }
        }

        // Backward reaching (root -> effector)
        pts[0] = root
        for i in 0..<(n - 1) {
          let seg = pts[i + 1] - pts[i]
          let d = simd_length(seg)
          let l = lengths[i]
          if d > 1e-6 {
            pts[i + 1] = pts[i] + seg * (l / d)
          } else {
            pts[i + 1] = pts[i] + initDirs[i] * l
          }
        }
      }
    }

    var rotations: [simd_quatf] = []
    rotations.reserveCapacity(n - 1)
    for i in 0..<(n - 1) {
      let seg = pts[i + 1] - pts[i]
      let segLen = simd_length(seg)
      let solvedDir = segLen > 1e-6 ? seg / segLen : initDirs[i]
      rotations.append(quatFromUnitVectors(initDirs[i], solvedDir))
    }

    return FABRIKSolution(positions: pts, rotations: rotations, iterations: usedIters)
  }
}
