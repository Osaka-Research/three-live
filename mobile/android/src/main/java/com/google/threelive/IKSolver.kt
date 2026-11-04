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

package com.google.threelive

/**
 * Analytic 2-bone law-of-cosines and N-bone FABRIK inverse kinematics solvers (mirrors
 * `three-live/src/plugins/ik.ts`).
 */
object IKSolver {

  /** Solved joint positions and delta rotations (`[x, y, z, w]`) for a 2-bone IK chain. */
  data class TwoBoneIKSolution(
    val rootPos: DoubleArray,
    val midPos: DoubleArray,
    val effectorPos: DoubleArray,
    val rootRotation: DoubleArray,
    val midRotation: DoubleArray,
  )

  /**
   * Solved joint positions and segment delta rotations (`[x, y, z, w]`) for an N-bone FABRIK chain.
   */
  data class FABRIKSolution(
    val positions: List<DoubleArray>,
    val rotations: List<DoubleArray>,
    val iterations: Int,
  )

  /**
   * Computes the shortest-arc unit quaternion `[x, y, z, w]` rotating unit vector [fromDir] onto
   * unit vector [toDir].
   */
  @JvmStatic
  fun quatFromUnitVectors(fromDir: DoubleArray, toDir: DoubleArray): DoubleArray {
    val dot = fromDir[0] * toDir[0] + fromDir[1] * toDir[1] + fromDir[2] * toDir[2]
    val r = dot + 1.0
    if (r < 1e-6) {
      if (Math.abs(fromDir[0]) > Math.abs(fromDir[2])) {
        val len = Math.hypot(fromDir[1], fromDir[0]).let { if (it > 0.0) it else 1.0 }
        return doubleArrayOf(-fromDir[1] / len, fromDir[0] / len, 0.0, 0.0)
      }
      val len = Math.hypot(fromDir[2], fromDir[1]).let { if (it > 0.0) it else 1.0 }
      return doubleArrayOf(0.0, -fromDir[2] / len, fromDir[1] / len, 0.0)
    }
    val cx = fromDir[1] * toDir[2] - fromDir[2] * toDir[1]
    val cy = fromDir[2] * toDir[0] - fromDir[0] * toDir[2]
    val cz = fromDir[0] * toDir[1] - fromDir[1] * toDir[0]
    val len = Math.sqrt(cx * cx + cy * cy + cz * cz + r * r).let { if (it > 0.0) it else 1.0 }
    return doubleArrayOf(cx / len, cy / len, cz / len, r / len)
  }

  /**
   * Analytic 2-bone inverse kinematics solver using the law of cosines and pole-vector bend-plane
   * projection.
   */
  @JvmStatic
  @JvmOverloads
  fun solveTwoBoneIK(
    rootPos: DoubleArray,
    midPos: DoubleArray,
    effectorPos: DoubleArray,
    targetPos: DoubleArray,
    polePos: DoubleArray? = null,
  ): TwoBoneIKSolution {
    val v1x = midPos[0] - rootPos[0]
    val v1y = midPos[1] - rootPos[1]
    val v1z = midPos[2] - rootPos[2]
    val l1 = Math.sqrt(v1x * v1x + v1y * v1y + v1z * v1z)

    val v2x = effectorPos[0] - midPos[0]
    val v2y = effectorPos[1] - midPos[1]
    val v2z = effectorPos[2] - midPos[2]
    val l2 = Math.sqrt(v2x * v2x + v2y * v2y + v2z * v2z)

    if (l1 < 1e-6 || l2 < 1e-6) {
      return TwoBoneIKSolution(
        rootPos = doubleArrayOf(rootPos[0], rootPos[1], rootPos[2]),
        midPos = doubleArrayOf(midPos[0], midPos[1], midPos[2]),
        effectorPos = doubleArrayOf(effectorPos[0], effectorPos[1], effectorPos[2]),
        rootRotation = doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        midRotation = doubleArrayOf(0.0, 0.0, 0.0, 1.0),
      )
    }

    val initDir1 = doubleArrayOf(v1x / l1, v1y / l1, v1z / l1)
    val initDir2 = doubleArrayOf(v2x / l2, v2y / l2, v2z / l2)

    val tx = targetPos[0] - rootPos[0]
    val ty = targetPos[1] - rootPos[1]
    val tz = targetPos[2] - rootPos[2]
    val rawDist = Math.sqrt(tx * tx + ty * ty + tz * tz)

    val dirToTarget =
      if (rawDist > 1e-6) doubleArrayOf(tx / rawDist, ty / rawDist, tz / rawDist) else initDir1

    val minDist = Math.abs(l1 - l2) + 1e-5
    val maxDist = Math.max(minDist, l1 + l2 - 1e-5)
    val d = Math.max(minDist, Math.min(maxDist, if (rawDist > 1e-6) rawDist else minDist))

    val cosAlpha =
      XRSpatialMath.clampNum((l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d), -1.0, 1.0, 1.0)
    val sinAlpha = Math.sqrt(Math.max(0.0, 1.0 - cosAlpha * cosAlpha))

    val poleVecX = if (polePos != null && polePos.size >= 3) polePos[0] - rootPos[0] else v1x
    val poleVecY = if (polePos != null && polePos.size >= 3) polePos[1] - rootPos[1] else v1y
    val poleVecZ = if (polePos != null && polePos.size >= 3) polePos[2] - rootPos[2] else v1z

    val projDot = poleVecX * dirToTarget[0] + poleVecY * dirToTarget[1] + poleVecZ * dirToTarget[2]
    var px = poleVecX - dirToTarget[0] * projDot
    var py = poleVecY - dirToTarget[1] * projDot
    var pz = poleVecZ - dirToTarget[2] * projDot
    var pLen = Math.sqrt(px * px + py * py + pz * pz)

    if (pLen <= 1e-6) {
      val rx = if (Math.abs(dirToTarget[1]) < 0.99) 0.0 else 1.0
      val ry = if (Math.abs(dirToTarget[1]) < 0.99) 1.0 else 0.0
      val rz = 0.0
      px = dirToTarget[1] * rz - dirToTarget[2] * ry
      py = dirToTarget[2] * rx - dirToTarget[0] * rz
      pz = dirToTarget[0] * ry - dirToTarget[1] * rx
      pLen = Math.sqrt(px * px + py * py + pz * pz).let { if (it > 0.0) it else 1.0 }
    }

    val bendDir = doubleArrayOf(px / pLen, py / pLen, pz / pLen)

    val solvedMid =
      doubleArrayOf(
        rootPos[0] + dirToTarget[0] * (l1 * cosAlpha) + bendDir[0] * (l1 * sinAlpha),
        rootPos[1] + dirToTarget[1] * (l1 * cosAlpha) + bendDir[1] * (l1 * sinAlpha),
        rootPos[2] + dirToTarget[2] * (l1 * cosAlpha) + bendDir[2] * (l1 * sinAlpha),
      )

    val clampedTarget =
      doubleArrayOf(
        rootPos[0] + dirToTarget[0] * d,
        rootPos[1] + dirToTarget[1] * d,
        rootPos[2] + dirToTarget[2] * d,
      )

    val effVecX = clampedTarget[0] - solvedMid[0]
    val effVecY = clampedTarget[1] - solvedMid[1]
    val effVecZ = clampedTarget[2] - solvedMid[2]
    val effLen = Math.sqrt(effVecX * effVecX + effVecY * effVecY + effVecZ * effVecZ)
    val solvedDir2 =
      if (effLen > 1e-6) {
        doubleArrayOf(effVecX / effLen, effVecY / effLen, effVecZ / effLen)
      } else {
        dirToTarget
      }

    val solvedEffector =
      doubleArrayOf(
        solvedMid[0] + solvedDir2[0] * l2,
        solvedMid[1] + solvedDir2[1] * l2,
        solvedMid[2] + solvedDir2[2] * l2,
      )

    val solvedDir1 =
      doubleArrayOf(
        (solvedMid[0] - rootPos[0]) / l1,
        (solvedMid[1] - rootPos[1]) / l1,
        (solvedMid[2] - rootPos[2]) / l1,
      )

    return TwoBoneIKSolution(
      rootPos = doubleArrayOf(rootPos[0], rootPos[1], rootPos[2]),
      midPos = solvedMid,
      effectorPos = solvedEffector,
      rootRotation = quatFromUnitVectors(initDir1, solvedDir1),
      midRotation = quatFromUnitVectors(initDir2, solvedDir2),
    )
  }

  /**
   * Forward And Backward Reaching Inverse Kinematics (FABRIK) solver for an N-joint chain,
   * preserving every bone segment length.
   */
  @JvmStatic
  @JvmOverloads
  fun solveFABRIK(
    positions: List<DoubleArray>,
    targetPos: DoubleArray,
    maxIterations: Int = 8,
    tolerance: Double = 1e-3,
  ): FABRIKSolution {
    val n = positions.size
    if (n < 2) {
      return FABRIKSolution(
        positions = positions.map { doubleArrayOf(it[0], it[1], it[2]) },
        rotations = emptyList(),
        iterations = 0,
      )
    }

    val pts = ArrayList<DoubleArray>(n)
    for (p in positions) {
      pts.add(doubleArrayOf(p[0], p[1], p[2]))
    }
    val lengths = DoubleArray(n - 1)
    val initDirs = ArrayList<DoubleArray>(n - 1)
    var totalLength = 0.0

    for (i in 0 until n - 1) {
      val dx = pts[i + 1][0] - pts[i][0]
      val dy = pts[i + 1][1] - pts[i][1]
      val dz = pts[i + 1][2] - pts[i][2]
      val len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      lengths[i] = len
      totalLength += len
      initDirs.add(
        if (len > 1e-6) doubleArrayOf(dx / len, dy / len, dz / len)
        else doubleArrayOf(0.0, 1.0, 0.0)
      )
    }

    val root = doubleArrayOf(pts[0][0], pts[0][1], pts[0][2])
    val maxIters = XRSpatialMath.clampNum(maxIterations.toDouble(), 1.0, 32.0, 8.0).toInt()
    val tol = XRSpatialMath.clampNum(tolerance, 1e-5, 0.1, 1e-3)

    val tx = targetPos[0] - root[0]
    val ty = targetPos[1] - root[1]
    val tz = targetPos[2] - root[2]
    val distToTarget = Math.sqrt(tx * tx + ty * ty + tz * tz)

    var usedIters = 0
    if (distToTarget >= totalLength && totalLength > 1e-6) {
      val dir =
        if (distToTarget > 1e-6) {
          doubleArrayOf(tx / distToTarget, ty / distToTarget, tz / distToTarget)
        } else {
          initDirs[0]
        }
      pts[0] = doubleArrayOf(root[0], root[1], root[2])
      for (i in 0 until n - 1) {
        val l = lengths[i]
        pts[i + 1] =
          doubleArrayOf(pts[i][0] + dir[0] * l, pts[i][1] + dir[1] * l, pts[i][2] + dir[2] * l)
      }
      usedIters = 1
    } else {
      for (iter in 1..maxIters) {
        val end = pts[n - 1]
        val ex = end[0] - targetPos[0]
        val ey = end[1] - targetPos[1]
        val ez = end[2] - targetPos[2]
        val err = Math.sqrt(ex * ex + ey * ey + ez * ez)
        if (err <= tol) {
          break
        }
        usedIters = iter

        // Forward reaching (effector -> root)
        pts[n - 1] = doubleArrayOf(targetPos[0], targetPos[1], targetPos[2])
        for (i in n - 2 downTo 0) {
          val dx = pts[i][0] - pts[i + 1][0]
          val dy = pts[i][1] - pts[i + 1][1]
          val dz = pts[i][2] - pts[i + 1][2]
          val d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          val l = lengths[i]
          if (d > 1e-6) {
            val scale = l / d
            pts[i] =
              doubleArrayOf(
                pts[i + 1][0] + dx * scale,
                pts[i + 1][1] + dy * scale,
                pts[i + 1][2] + dz * scale,
              )
          } else {
            val fallback = initDirs[i]
            pts[i] =
              doubleArrayOf(
                pts[i + 1][0] - fallback[0] * l,
                pts[i + 1][1] - fallback[1] * l,
                pts[i + 1][2] - fallback[2] * l,
              )
          }
        }

        // Backward reaching (root -> effector)
        pts[0] = doubleArrayOf(root[0], root[1], root[2])
        for (i in 0 until n - 1) {
          val dx = pts[i + 1][0] - pts[i][0]
          val dy = pts[i + 1][1] - pts[i][1]
          val dz = pts[i + 1][2] - pts[i][2]
          val d = Math.sqrt(dx * dx + dy * dy + dz * dz)
          val l = lengths[i]
          if (d > 1e-6) {
            val scale = l / d
            pts[i + 1] =
              doubleArrayOf(pts[i][0] + dx * scale, pts[i][1] + dy * scale, pts[i][2] + dz * scale)
          } else {
            val fallback = initDirs[i]
            pts[i + 1] =
              doubleArrayOf(
                pts[i][0] + fallback[0] * l,
                pts[i][1] + fallback[1] * l,
                pts[i][2] + fallback[2] * l,
              )
          }
        }
      }
    }

    val rotations = ArrayList<DoubleArray>(n - 1)
    for (i in 0 until n - 1) {
      val dx = pts[i + 1][0] - pts[i][0]
      val dy = pts[i + 1][1] - pts[i][1]
      val dz = pts[i + 1][2] - pts[i][2]
      val segLen = Math.sqrt(dx * dx + dy * dy + dz * dz)
      val solvedDir =
        if (segLen > 1e-6) doubleArrayOf(dx / segLen, dy / segLen, dz / segLen) else initDirs[i]
      rotations.add(quatFromUnitVectors(initDirs[i], solvedDir))
    }

    return FABRIKSolution(positions = pts, rotations = rotations, iterations = usedIters)
  }
}
