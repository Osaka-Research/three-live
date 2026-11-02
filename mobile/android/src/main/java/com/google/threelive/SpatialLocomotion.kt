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
 * Pure ballistic trajectory, snap-turn hysteresis, and arc ribbon mesh builder for
 * `spatial-locomotion` (port of `xr-live/src/plugins/spatial-locomotion.ts`).
 */
object SpatialLocomotion {

  const val TELEPORT_SPEED: Double = 6.0
  const val TELEPORT_GRAVITY: Double = -9.8
  const val TELEPORT_SEGMENTS: Int = 20
  const val TELEPORT_STEP_DT: Double = 0.08
  const val MIN_WALKABLE_NORMAL_Y: Double = 0.7
  const val SNAP_TURN_TRIGGER: Double = 0.65
  const val SNAP_TURN_RESET: Double = 0.25
  const val COMFORT_VIGNETTE_MS: Double = 120.0

  /** Result of evaluating thumbstick horizontal deflection against snap-turn hysteresis. */
  data class SnapTurnStep(
    val deltaYawDeg: Double,
    val latched: Boolean,
  )

  /** Result of evaluating a parabolic teleport arc against scene geometry and ground fallback. */
  data class TeleportArcHit(
    val valid: Boolean,
    val point: DoubleArray,
    val normal: DoubleArray,
    val points: List<DoubleArray>,
    val hitNodeIndex: Int = -1,
  )

  /** Samples `segments + 1` points along a ballistic projectile parabola. */
  @JvmStatic
  @JvmOverloads
  fun sampleParabola(
    origin: DoubleArray,
    direction: DoubleArray,
    speed: Double = TELEPORT_SPEED,
    gravity: Double = TELEPORT_GRAVITY,
    segments: Int = TELEPORT_SEGMENTS,
    stepDt: Double = TELEPORT_STEP_DT,
  ): List<DoubleArray> {
    val ox = origin.getOrElse(0) { 0.0 }.let { if (it.isFinite()) it else 0.0 }
    val oy = origin.getOrElse(1) { 0.0 }.let { if (it.isFinite()) it else 0.0 }
    val oz = origin.getOrElse(2) { 0.0 }.let { if (it.isFinite()) it else 0.0 }
    val dir = XRSpatialMath.normalizeRayDir(direction.copyOf()) ?: doubleArrayOf(0.0, 0.0, -1.0)
    val v0 = XRSpatialMath.clampNum(speed, 0.5, 30.0, TELEPORT_SPEED)
    val g = XRSpatialMath.clampNum(gravity, -30.0, -0.5, TELEPORT_GRAVITY)
    val segs = segments.coerceIn(2, 64)
    val dt = XRSpatialMath.clampNum(stepDt, 0.01, 0.25, TELEPORT_STEP_DT)

    val pts = ArrayList<DoubleArray>(segs + 1)
    for (i in 0..segs) {
      val t = i * dt
      pts.add(
        doubleArrayOf(
          ox + dir[0] * v0 * t,
          oy + dir[1] * v0 * t + 0.5 * g * t * t,
          oz + dir[2] * v0 * t,
        )
      )
    }
    return pts
  }

  /** Evaluates thumbstick snap-turn hysteresis (`|x| > 0.65` trigger, `< 0.25` reset). */
  @JvmStatic
  @JvmOverloads
  fun evaluateSnapTurn(
    axisX: Double,
    wasLatched: Boolean,
    snapTurnDeg: Double = 30.0,
  ): SnapTurnStep {
    val stepDeg = XRSpatialMath.clampNum(snapTurnDeg, 15.0, 90.0, 30.0)
    if (!axisX.isFinite()) return SnapTurnStep(0.0, wasLatched)
    val absX = Math.abs(axisX)
    if (wasLatched) {
      return SnapTurnStep(0.0, absX >= SNAP_TURN_RESET)
    }
    if (absX > SNAP_TURN_TRIGGER) {
      return SnapTurnStep(if (axisX > 0.0) -stepDeg else stepDeg, true)
    }
    return SnapTurnStep(0.0, false)
  }

  /** Builds a double-sided 3D ribbon mesh along a polyline of world-space points. */
  @JvmStatic
  @JvmOverloads
  fun buildArcGeometry(
    points: List<DoubleArray>,
    halfWidth: Double = 0.014,
  ): SpatialMeasure.MeshGeometry {
    if (points.size < 2) {
      return SpatialMeasure.MeshGeometry(FloatArray(0), FloatArray(0), IntArray(0))
    }
    val hw = Math.max(0.002, halfWidth)
    val segCount = points.size - 1
    val positions = FloatArray(segCount * 8 * 3)
    val normals = FloatArray(segCount * 8 * 3)
    val indices = IntArray(segCount * 12)
    var vi = 0
    var ii = 0

    for (i in 0 until segCount) {
      val a = points[i]
      val b = points[i + 1]
      val diff = doubleArrayOf(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      val tangent = XRSpatialMath.normalizeRayDir(diff) ?: doubleArrayOf(0.0, 0.0, -1.0)
      var sideRaw = XRSpatialMath.cross3(tangent, doubleArrayOf(0.0, 1.0, 0.0), DoubleArray(3))
      if (XRSpatialMath.len3(sideRaw[0], sideRaw[1], sideRaw[2]) < 1e-4) {
        sideRaw = doubleArrayOf(1.0, 0.0, 0.0)
      }
      val sideUnit = XRSpatialMath.normalizeRayDir(sideRaw) ?: doubleArrayOf(1.0, 0.0, 0.0)
      val side = doubleArrayOf(sideUnit[0] * hw, sideUnit[1] * hw, sideUnit[2] * hw)
      val up =
        XRSpatialMath.normalizeRayDir(XRSpatialMath.cross3(side, tangent, DoubleArray(3)))
          ?: doubleArrayOf(0.0, 1.0, 0.0)

      val corners =
        arrayOf(
          doubleArrayOf(a[0] - side[0], a[1] - side[1], a[2] - side[2]),
          doubleArrayOf(a[0] + side[0], a[1] + side[1], a[2] + side[2]),
          doubleArrayOf(b[0] + side[0], b[1] + side[1], b[2] + side[2]),
          doubleArrayOf(b[0] - side[0], b[1] - side[1], b[2] - side[2]),
        )

      val front = vi
      for (c in corners) {
        positions[vi * 3] = c[0].toFloat()
        positions[vi * 3 + 1] = c[1].toFloat()
        positions[vi * 3 + 2] = c[2].toFloat()
        normals[vi * 3] = up[0].toFloat()
        normals[vi * 3 + 1] = up[1].toFloat()
        normals[vi * 3 + 2] = up[2].toFloat()
        vi++
      }
      indices[ii++] = front
      indices[ii++] = front + 1
      indices[ii++] = front + 2
      indices[ii++] = front
      indices[ii++] = front + 2
      indices[ii++] = front + 3

      val back = vi
      for (c in corners) {
        positions[vi * 3] = c[0].toFloat()
        positions[vi * 3 + 1] = c[1].toFloat()
        positions[vi * 3 + 2] = c[2].toFloat()
        normals[vi * 3] = (-up[0]).toFloat()
        normals[vi * 3 + 1] = (-up[1]).toFloat()
        normals[vi * 3 + 2] = (-up[2]).toFloat()
        vi++
      }
      indices[ii++] = back
      indices[ii++] = back + 2
      indices[ii++] = back + 1
      indices[ii++] = back
      indices[ii++] = back + 3
      indices[ii++] = back + 2
    }

    return SpatialMeasure.MeshGeometry(positions, normals, indices)
  }
}
