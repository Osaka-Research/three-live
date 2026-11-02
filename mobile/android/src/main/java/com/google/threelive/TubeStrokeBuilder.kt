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

/** Indexed triangle geometry (positions / normals are xyz-interleaved). */
class TubeGeometry(val positions: FloatArray, val normals: FloatArray, val indices: IntArray) {
  /** Number of vertices. */
  val vertexCount: Int
    get() = positions.size / 3
}

/**
 * Accumulates 3D stroke points and builds a smoothed, capped tube mesh.
 *
 * Port of `TubeStrokeBuilder` in `xr-live/src/plugins/spatial-paint.ts` with an identical output
 * layout: `n` side rings of [radialSegments] vertices, then a duplicated start cap ring and end cap
 * ring (axial normals), then the start and end cap centers. Side triangles wind counter-clockwise
 * when viewed from outside the tube.
 */
class TubeStrokeBuilder
@JvmOverloads
constructor(
  radius: Double = 0.006,
  radialSegments: Int = 8,
  samplesPerSpan: Int = 4,
  minSpacing: Double = 0.004,
) {
  /** Tube radius in meters, clamped to `[0.0005, 0.25]`. */
  val radius: Double = XRSpatialMath.clampNum(radius, 0.0005, 0.25, 0.006)

  /** Radial segments, clamped to `[3, 32]`. */
  val radialSegments: Int = Math.max(3, Math.min(32, radialSegments))

  /** Catmull-Rom samples per span, clamped to `[1, 16]`. */
  val samplesPerSpan: Int = Math.max(1, Math.min(16, samplesPerSpan))

  private val minSpacing: Double = XRSpatialMath.clampNum(minSpacing, 0.0, 0.5, 0.004)
  private val pts = ArrayList<DoubleArray>()

  /** Number of accepted raw points. */
  val pointCount: Int
    get() = pts.size

  /**
   * Adds a point, ignoring non-finite input, points closer than `minSpacing` to the previous point,
   * and points beyond [MAX_STROKE_POINTS]. Returns whether the point was accepted.
   */
  fun addPoint(x: Double, y: Double, z: Double): Boolean {
    if (!x.isFinite() || !y.isFinite() || !z.isFinite()) return false
    if (pts.size >= MAX_STROKE_POINTS) return false
    val last = pts.lastOrNull()
    if (last != null && XRSpatialMath.len3(x - last[0], y - last[1], z - last[2]) < minSpacing) {
      return false
    }
    pts.add(doubleArrayOf(x, y, z))
    return true
  }

  /** Polyline length of the raw points in meters. */
  val lengthMeters: Double
    get() {
      var len = 0.0
      for (i in 1 until pts.size) len += XRSpatialMath.dist3(pts[i], pts[i - 1])
      return len
    }

  /** Removes every point. */
  fun clear() {
    pts.clear()
  }

  /** Returns the Catmull-Rom-smoothed centerline (`(points - 1) * samplesPerSpan + 1` points). */
  fun smoothedPoints(): List<DoubleArray> {
    if (pts.size < 3) return pts.map { it.copyOf() }
    val out = ArrayList<DoubleArray>((pts.size - 1) * samplesPerSpan + 1)
    for (i in 0 until pts.size - 1) {
      val p0 = pts[Math.max(0, i - 1)]
      val p3 = pts[Math.min(pts.size - 1, i + 2)]
      for (s in 0 until samplesPerSpan) {
        out.add(catmullRom(p0, pts[i], pts[i + 1], p3, s.toDouble() / samplesPerSpan))
      }
    }
    out.add(pts[pts.size - 1].copyOf())
    return out
  }

  /** Builds the capped tube geometry, or `null` for fewer than two (smoothed) points. */
  fun build(): TubeGeometry? {
    val center = smoothedPoints()
    if (center.size < 2) return null
    val n = center.size
    val radial = radialSegments
    val ringVerts = n * radial
    val vertexCount = ringVerts + radial * 2 + 2
    val positions = FloatArray(vertexCount * 3)
    val normals = FloatArray(vertexCount * 3)
    val triCount = (n - 1) * radial * 2 + radial * 2
    val indices = IntArray(triCount * 3)

    val tangents =
      Array(n) { i ->
        val a = center[Math.min(n - 1, i + 1)]
        val b = center[Math.max(0, i - 1)]
        norm(doubleArrayOf(a[0] - b[0], a[1] - b[1], a[2] - b[2]), doubleArrayOf(0.0, 0.0, 1.0))
      }
    // Rotation-minimizing frames via the double-reflection method (Wang et al. 2008).
    val t0 = tangents[0]
    var normal =
      norm(
        cross(t0, if (Math.abs(t0[1]) < 0.9) doubleArrayOf(0.0, 1.0, 0.0) else doubleArrayOf(1.0, 0.0, 0.0)),
        doubleArrayOf(0.0, 0.0, -1.0),
      )
    for (i in 0 until n) {
      if (i > 0) {
        val c = center[i]
        val p = center[i - 1]
        val v1 = doubleArrayOf(c[0] - p[0], c[1] - p[1], c[2] - p[2])
        val c1 = XRSpatialMath.dot3(v1, v1)
        if (c1 > 1e-12) {
          val rL = sub(normal, scale(v1, (2 / c1) * XRSpatialMath.dot3(v1, normal)))
          val tPrev = tangents[i - 1]
          val tL = sub(tPrev, scale(v1, (2 / c1) * XRSpatialMath.dot3(v1, tPrev)))
          val v2 = sub(tangents[i], tL)
          val c2 = XRSpatialMath.dot3(v2, v2)
          normal = if (c2 > 1e-12) sub(rL, scale(v2, (2 / c2) * XRSpatialMath.dot3(v2, rL))) else rL
        }
        // Guard against drift: keep the frame orthonormal.
        normal = norm(sub(normal, scale(tangents[i], XRSpatialMath.dot3(normal, tangents[i]))), normal)
      }
      val binormal = cross(tangents[i], normal)
      for (r in 0 until radial) {
        val a = r.toDouble() / radial * Math.PI * 2
        val ca = Math.cos(a)
        val sa = Math.sin(a)
        val o = (i * radial + r) * 3
        for (k in 0 until 3) {
          val d = normal[k] * ca + binormal[k] * sa
          positions[o + k] = (center[i][k] + d * this.radius).toFloat()
          normals[o + k] = d.toFloat()
        }
      }
    }
    val startRing = ringVerts
    val endRing = ringVerts + radial
    val capStart = ringVerts + radial * 2
    val capEnd = capStart + 1
    val tn = tangents[n - 1]
    for (r in 0 until radial) {
      val last = ((n - 1) * radial + r) * 3
      for (k in 0 until 3) {
        positions[(startRing + r) * 3 + k] = positions[r * 3 + k]
        normals[(startRing + r) * 3 + k] = (-t0[k]).toFloat()
        positions[(endRing + r) * 3 + k] = positions[last + k]
        normals[(endRing + r) * 3 + k] = tn[k].toFloat()
      }
    }
    for (k in 0 until 3) {
      positions[capStart * 3 + k] = center[0][k].toFloat()
      normals[capStart * 3 + k] = (-t0[k]).toFloat()
      positions[capEnd * 3 + k] = center[n - 1][k].toFloat()
      normals[capEnd * 3 + k] = tn[k].toFloat()
    }

    var k = 0
    for (i in 0 until n - 1) {
      for (r in 0 until radial) {
        val a = i * radial + r
        val b = i * radial + (r + 1) % radial
        val c = a + radial
        val d = b + radial
        indices[k++] = a
        indices[k++] = b
        indices[k++] = c
        indices[k++] = b
        indices[k++] = d
        indices[k++] = c
      }
    }
    for (r in 0 until radial) {
      val r1 = (r + 1) % radial
      indices[k++] = capStart
      indices[k++] = startRing + r1
      indices[k++] = startRing + r
      indices[k++] = capEnd
      indices[k++] = endRing + r
      indices[k++] = endRing + r1
    }
    return TubeGeometry(positions, normals, indices)
  }

  companion object {
    /** Maximum raw input points retained per stroke. */
    const val MAX_STROKE_POINTS = 2048

    /** Evaluates a uniform Catmull-Rom spline segment between [p1] and [p2]. */
    @JvmStatic
    fun catmullRom(p0: DoubleArray, p1: DoubleArray, p2: DoubleArray, p3: DoubleArray, t: Double): DoubleArray {
      val t2 = t * t
      val t3 = t2 * t
      val out = DoubleArray(3)
      for (a in 0 until 3) {
        out[a] =
          0.5 *
            (2 * p1[a] +
              (-p0[a] + p2[a]) * t +
              (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
              (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)
      }
      return out
    }

    private fun sub(a: DoubleArray, b: DoubleArray) = doubleArrayOf(a[0] - b[0], a[1] - b[1], a[2] - b[2])

    private fun scale(a: DoubleArray, s: Double) = doubleArrayOf(a[0] * s, a[1] * s, a[2] * s)

    private fun cross(a: DoubleArray, b: DoubleArray) =
      doubleArrayOf(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])

    private fun norm(a: DoubleArray, fallback: DoubleArray): DoubleArray {
      val l = XRSpatialMath.len3(a[0], a[1], a[2])
      return if (l > 1e-8) doubleArrayOf(a[0] / l, a[1] / l, a[2] / l) else fallback.copyOf()
    }
  }
}
