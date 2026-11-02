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
 * Pure math and dynamic geometry builders for `gaze-dwell` (mirrors
 * `xr-live/src/plugins/gaze-dwell.ts`).
 */
object GazeDwell {
  const val EMA_ALPHA: Double = 0.25
  const val GRACE_CONE_DEG: Double = 1.5
  const val GRACE_MS: Double = 150.0
  const val RETICLE_ANGULAR_SCALE: Double = 0.018

  /** Smooths a raw gaze ray direction using an exponential moving average and normalizes it. */
  @JvmStatic
  @JvmOverloads
  fun smoothDirection(
    prev: DoubleArray?,
    raw: DoubleArray,
    alpha: Double = EMA_ALPHA,
  ): DoubleArray {
    val target = XRSpatialMath.normalizeRayDir(raw) ?: doubleArrayOf(0.0, 0.0, -1.0)
    if (prev == null || prev.size < 3 || !prev[0].isFinite() || !prev[1].isFinite() || !prev[2].isFinite()) {
      return target
    }
    val p = XRSpatialMath.normalizeRayDir(prev) ?: return target
    val a = XRSpatialMath.clampNum(alpha, 0.01, 1.0, EMA_ALPHA)
    val d = Math.max(-1.0, Math.min(1.0, XRSpatialMath.dot3(p, target)))
    if (d > 0.9995) {
      val blended =
        doubleArrayOf(
          p[0] + (target[0] - p[0]) * a,
          p[1] + (target[1] - p[1]) * a,
          p[2] + (target[2] - p[2]) * a,
        )
      return XRSpatialMath.normalizeRayDir(blended) ?: target
    }
    if (d < -0.9995) {
      val ref = if (Math.abs(p[0]) < 0.9) doubleArrayOf(1.0, 0.0, 0.0) else doubleArrayOf(0.0, 1.0, 0.0)
      val perp =
        XRSpatialMath.normalizeRayDir(
          doubleArrayOf(
            ref[1] * p[2] - ref[2] * p[1],
            ref[2] * p[0] - ref[0] * p[2],
            ref[0] * p[1] - ref[1] * p[0],
          )
        ) ?: doubleArrayOf(0.0, 1.0, 0.0)
      val theta = a * Math.PI
      val ct = Math.cos(theta)
      val st = Math.sin(theta)
      return XRSpatialMath.normalizeRayDir(
        doubleArrayOf(p[0] * ct + perp[0] * st, p[1] * ct + perp[1] * st, p[2] * ct + perp[2] * st)
      ) ?: target
    }
    val omega = Math.acos(d)
    val sinOmega = Math.sin(omega)
    val w0 = Math.sin((1.0 - a) * omega) / sinOmega
    val w1 = Math.sin(a * omega) / sinOmega
    return XRSpatialMath.normalizeRayDir(
      doubleArrayOf(
        p[0] * w0 + target[0] * w1,
        p[1] * w0 + target[1] * w1,
        p[2] * w0 + target[2] * w1,
      )
    ) ?: target
  }

  /** Returns the angle in degrees (`0..180`) between two direction vectors. */
  @JvmStatic
  fun angleBetweenDeg(a: DoubleArray, b: DoubleArray): Double {
    val na = XRSpatialMath.normalizeRayDir(a) ?: doubleArrayOf(0.0, 0.0, -1.0)
    val nb = XRSpatialMath.normalizeRayDir(b) ?: doubleArrayOf(0.0, 0.0, -1.0)
    val c = Math.max(-1.0, Math.min(1.0, XRSpatialMath.dot3(na, nb)))
    return Math.acos(c) * 180.0 / Math.PI
  }

  /** Computes normalized `[0..1]` radial dwell progress after [graceMs] over [dwellMs]. */
  @JvmStatic
  @JvmOverloads
  fun computeDwellProgress(
    elapsedMs: Double,
    dwellMs: Double,
    graceMs: Double = GRACE_MS,
  ): Double {
    val total = XRSpatialMath.clampNum(dwellMs, 250.0, 10000.0, 1200.0)
    val grace = Math.min(total - 1.0, Math.max(0.0, graceMs))
    if (!elapsedMs.isFinite() || elapsedMs <= grace) return 0.0
    return Math.max(0.0, Math.min(1.0, (elapsedMs - grace) / (total - grace)))
  }

  /** Computes the shortest-arc unit quaternion rotating [from] onto [to]. */
  @JvmStatic
  fun quatFromUnitVectors(from: DoubleArray, to: DoubleArray): DoubleArray {
    val u = XRSpatialMath.normalizeRayDir(from) ?: doubleArrayOf(0.0, 0.0, 1.0)
    val v = XRSpatialMath.normalizeRayDir(to) ?: doubleArrayOf(0.0, 0.0, 1.0)
    val r = XRSpatialMath.dot3(u, v) + 1.0
    if (r < 1e-6) {
      val ax =
        if (Math.abs(u[0]) > Math.abs(u[2])) doubleArrayOf(-u[1], u[0], 0.0)
        else doubleArrayOf(0.0, -u[2], u[1])
      val n = XRSpatialMath.normalizeRayDir(ax) ?: doubleArrayOf(1.0, 0.0, 0.0)
      return doubleArrayOf(n[0], n[1], n[2], 0.0)
    }
    val cx = u[1] * v[2] - u[2] * v[1]
    val cy = u[2] * v[0] - u[0] * v[2]
    val cz = u[0] * v[1] - u[1] * v[0]
    val len = Math.sqrt(cx * cx + cy * cy + cz * cz + r * r)
    return if (len > 1e-8) doubleArrayOf(cx / len, cy / len, cz / len, r / len)
    else doubleArrayOf(0.0, 0.0, 0.0, 1.0)
  }

  /** Builds a double-sided dual-ring + clockwise progress arc mesh of unit radius (`1.0`) facing `+Z`. */
  @JvmStatic
  @JvmOverloads
  fun buildReticleGeometry(
    progress: Double,
    segments: Int = 24,
  ): SpatialMeasure.MeshGeometry {
    val segs = Math.max(8, Math.min(64, segments))
    val p = if (progress.isFinite()) Math.max(0.0, Math.min(1.0, progress)) else 0.0
    val arcSegs = if (p > 1e-3) Math.max(1, Math.round(p * segs).toInt()) else 0
    val totalQuads = segs + arcSegs
    val positions = FloatArray(totalQuads * 8 * 3)
    val normals = FloatArray(totalQuads * 8 * 3)
    val indices = IntArray(totalQuads * 12)
    var vi = 0
    var ii = 0

    fun appendQuad(a0: Double, a1: Double, rInner: Double, rOuter: Double, zOff: Float) {
      val c0 = Math.cos(a0)
      val s0 = Math.sin(a0)
      val c1 = Math.cos(a1)
      val s1 = Math.sin(a1)
      val pts = arrayOf(
        doubleArrayOf(c0 * rInner, s0 * rInner),
        doubleArrayOf(c1 * rInner, s1 * rInner),
        doubleArrayOf(c1 * rOuter, s1 * rOuter),
        doubleArrayOf(c0 * rOuter, s0 * rOuter),
      )
      val front = vi
      for (pt in pts) {
        positions[vi * 3] = pt[0].toFloat()
        positions[vi * 3 + 1] = pt[1].toFloat()
        positions[vi * 3 + 2] = zOff
        normals[vi * 3 + 2] = 1f
        vi++
      }
      indices[ii++] = front
      indices[ii++] = front + 1
      indices[ii++] = front + 2
      indices[ii++] = front
      indices[ii++] = front + 2
      indices[ii++] = front + 3

      val back = vi
      for (pt in pts) {
        positions[vi * 3] = pt[0].toFloat()
        positions[vi * 3 + 1] = pt[1].toFloat()
        positions[vi * 3 + 2] = -zOff
        normals[vi * 3 + 2] = -1f
        vi++
      }
      indices[ii++] = back
      indices[ii++] = back + 2
      indices[ii++] = back + 1
      indices[ii++] = back
      indices[ii++] = back + 3
      indices[ii++] = back + 2
    }

    for (i in 0 until segs) {
      val a0 = (i.toDouble() / segs) * Math.PI * 2.0
      val a1 = ((i + 1).toDouble() / segs) * Math.PI * 2.0
      appendQuad(a0, a1, 0.84, 1.0, 0.0005f)
    }
    for (i in 0 until arcSegs) {
      val t0 = i.toDouble() / arcSegs
      val t1 = (i + 1).toDouble() / arcSegs
      val a0 = Math.PI * 0.5 - t0 * p * Math.PI * 2.0
      val a1 = Math.PI * 0.5 - t1 * p * Math.PI * 2.0
      appendQuad(a1, a0, 0.42, 0.72, 0.0012f)
    }
    return SpatialMeasure.MeshGeometry(positions, normals, indices)
  }
}
