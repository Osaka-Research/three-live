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
 * Pure math and dynamic geometry builders for `spatial-measure` (mirrors
 * `xr-live/src/plugins/spatial-measure.ts`).
 */
object SpatialMeasure {
  const val CALLOUT_OFFSET_METERS: Double = 0.04
  const val CALLOUT_TICK_HALF_METERS: Double = 0.015
  const val MAX_TAPE_SEGMENTS: Int = 16
  const val MAX_DIMENSION_LABELS: Int = 32
  private const val METERS_PER_INCH = 0.0254

  data class WorldBounds(val min: DoubleArray, val max: DoubleArray, val size: DoubleArray) {
    val center: DoubleArray
      get() =
        doubleArrayOf((min[0] + max[0]) * 0.5, (min[1] + max[1]) * 0.5, (min[2] + max[2]) * 0.5)
  }

  data class Callout(
    val axis: String,
    val start: DoubleArray,
    val end: DoubleArray,
    val tickStartA: DoubleArray,
    val tickStartB: DoubleArray,
    val tickEndA: DoubleArray,
    val tickEndB: DoubleArray,
    val labelPosition: DoubleArray,
    val lengthMeters: Double,
  )

  data class MeshGeometry(val positions: FloatArray, val normals: FloatArray, val indices: IntArray)

  /** Formats a metric distance in meters using `m`, `cm`, `mm`, `in`, `ft-in`, or `auto`. */
  @JvmStatic
  @JvmOverloads
  fun formatDimension(meters: Double, unit: String = "auto"): String {
    val d = if (meters.isFinite() && meters >= 0.0) meters else 0.0
    val resolved = if (unit == "auto") (if (d < 1.0) "cm" else "m") else unit
    return when (resolved) {
      "mm" -> "${Math.round(d * 1000.0)} mm"
      "cm" -> String.format(java.util.Locale.US, "%.1f cm", d * 100.0)
      "in" -> String.format(java.util.Locale.US, "%.1f in", d / METERS_PER_INCH)
      "ft-in" -> {
        val totalInches = d / METERS_PER_INCH
        var feet = Math.floor(totalInches / 12.0).toLong()
        var inches = Math.round((totalInches - feet * 12.0) * 10.0) / 10.0
        if (inches >= 12.0) {
          feet += 1
          inches = 0.0
        }
        String.format(java.util.Locale.US, "%d' %.1f\"", feet, inches)
      }
      else -> String.format(java.util.Locale.US, "%.2f m", d)
    }
  }

  /**
   * Computes the world-space AABB of `[localMin, localMax]` transformed by column-major
   * [worldMatrix].
   */
  @JvmStatic
  fun computeWorldBounds(
    localMin: DoubleArray,
    localMax: DoubleArray,
    worldMatrix: DoubleArray,
  ): WorldBounds {
    val min = doubleArrayOf(worldMatrix[12], worldMatrix[13], worldMatrix[14])
    val max = doubleArrayOf(worldMatrix[12], worldMatrix[13], worldMatrix[14])
    for (col in 0 until 3) {
      val lo = localMin.getOrElse(col) { 0.0 }
      val hi = localMax.getOrElse(col) { 0.0 }
      for (row in 0 until 3) {
        val m = worldMatrix.getOrElse(col * 4 + row) { if (col == row) 1.0 else 0.0 }
        val a = m * lo
        val b = m * hi
        min[row] += Math.min(a, b)
        max[row] += Math.max(a, b)
      }
    }
    if (min.any { !it.isFinite() } || max.any { !it.isFinite() }) {
      return WorldBounds(
        doubleArrayOf(-0.5, -0.5, -0.5),
        doubleArrayOf(0.5, 0.5, 0.5),
        doubleArrayOf(1.0, 1.0, 1.0),
      )
    }
    return WorldBounds(
      min,
      max,
      doubleArrayOf(
        Math.max(0.0, max[0] - min[0]),
        Math.max(0.0, max[1] - min[1]),
        Math.max(0.0, max[2] - min[2]),
      ),
    )
  }

  /** Builds world-space dimension callout descriptors along [axes] outside `[min, max]`. */
  @JvmStatic
  @JvmOverloads
  fun buildDimensionCallouts(
    min: DoubleArray,
    max: DoubleArray,
    axes: List<String> = listOf("x", "y", "z"),
    offset: Double = CALLOUT_OFFSET_METERS,
    tickHalf: Double = CALLOUT_TICK_HALF_METERS,
  ): List<Callout> {
    val out = ArrayList<Callout>(axes.size)
    val off = if (offset.isFinite()) Math.max(0.005, offset) else CALLOUT_OFFSET_METERS
    val tick = if (tickHalf.isFinite()) Math.max(0.003, tickHalf) else CALLOUT_TICK_HALF_METERS
    for (axis in axes) {
      when (axis) {
        "x" -> {
          val len = Math.max(0.0, max[0] - min[0])
          val y = min[1] - off * 0.5
          val z = max[2] + off
          out.add(
            Callout(
              axis = "x",
              start = doubleArrayOf(min[0], y, z),
              end = doubleArrayOf(max[0], y, z),
              tickStartA = doubleArrayOf(min[0], y - tick, z),
              tickStartB = doubleArrayOf(min[0], y + tick, z),
              tickEndA = doubleArrayOf(max[0], y - tick, z),
              tickEndB = doubleArrayOf(max[0], y + tick, z),
              labelPosition = doubleArrayOf((min[0] + max[0]) * 0.5, y - tick * 1.8, z),
              lengthMeters = len,
            )
          )
        }
        "y" -> {
          val len = Math.max(0.0, max[1] - min[1])
          val x = max[0] + off
          val z = max[2] + off
          out.add(
            Callout(
              axis = "y",
              start = doubleArrayOf(x, min[1], z),
              end = doubleArrayOf(x, max[1], z),
              tickStartA = doubleArrayOf(x - tick, min[1], z),
              tickStartB = doubleArrayOf(x + tick, min[1], z),
              tickEndA = doubleArrayOf(x - tick, max[1], z),
              tickEndB = doubleArrayOf(x + tick, max[1], z),
              labelPosition = doubleArrayOf(x + tick * 2.4, (min[1] + max[1]) * 0.5, z),
              lengthMeters = len,
            )
          )
        }
        "z" -> {
          val len = Math.max(0.0, max[2] - min[2])
          val x = max[0] + off
          val y = min[1] - off * 0.5
          out.add(
            Callout(
              axis = "z",
              start = doubleArrayOf(x, y, min[2]),
              end = doubleArrayOf(x, y, max[2]),
              tickStartA = doubleArrayOf(x - tick, y, min[2]),
              tickStartB = doubleArrayOf(x + tick, y, min[2]),
              tickEndA = doubleArrayOf(x - tick, y, max[2]),
              tickEndB = doubleArrayOf(x + tick, y, max[2]),
              labelPosition = doubleArrayOf(x + tick * 2.4, y, (min[2] + max[2]) * 0.5),
              lengthMeters = len,
            )
          )
        }
      }
    }
    return out
  }

  private val GLYPH_STROKES: Map<Char, Array<DoubleArray>> =
    mapOf(
      '0' to
        arrayOf(
          doubleArrayOf(0.1, 0.0, 0.9, 0.0),
          doubleArrayOf(0.9, 0.0, 0.9, 1.0),
          doubleArrayOf(0.9, 1.0, 0.1, 1.0),
          doubleArrayOf(0.1, 1.0, 0.1, 0.0),
        ),
      '1' to
        arrayOf(
          doubleArrayOf(0.5, 0.0, 0.5, 1.0),
          doubleArrayOf(0.25, 0.8, 0.5, 1.0),
          doubleArrayOf(0.2, 0.0, 0.8, 0.0),
        ),
      '2' to
        arrayOf(
          doubleArrayOf(0.1, 1.0, 0.9, 1.0),
          doubleArrayOf(0.9, 1.0, 0.9, 0.5),
          doubleArrayOf(0.9, 0.5, 0.1, 0.5),
          doubleArrayOf(0.1, 0.5, 0.1, 0.0),
          doubleArrayOf(0.1, 0.0, 0.9, 0.0),
        ),
      '3' to
        arrayOf(
          doubleArrayOf(0.1, 1.0, 0.9, 1.0),
          doubleArrayOf(0.9, 1.0, 0.9, 0.0),
          doubleArrayOf(0.1, 0.5, 0.9, 0.5),
          doubleArrayOf(0.1, 0.0, 0.9, 0.0),
        ),
      '4' to
        arrayOf(
          doubleArrayOf(0.1, 1.0, 0.1, 0.5),
          doubleArrayOf(0.1, 0.5, 0.9, 0.5),
          doubleArrayOf(0.8, 1.0, 0.8, 0.0),
        ),
      '5' to
        arrayOf(
          doubleArrayOf(0.9, 1.0, 0.1, 1.0),
          doubleArrayOf(0.1, 1.0, 0.1, 0.5),
          doubleArrayOf(0.1, 0.5, 0.9, 0.5),
          doubleArrayOf(0.9, 0.5, 0.9, 0.0),
          doubleArrayOf(0.9, 0.0, 0.1, 0.0),
        ),
      '6' to
        arrayOf(
          doubleArrayOf(0.9, 1.0, 0.1, 1.0),
          doubleArrayOf(0.1, 1.0, 0.1, 0.0),
          doubleArrayOf(0.1, 0.0, 0.9, 0.0),
          doubleArrayOf(0.9, 0.0, 0.9, 0.5),
          doubleArrayOf(0.9, 0.5, 0.1, 0.5),
        ),
      '7' to arrayOf(doubleArrayOf(0.1, 1.0, 0.9, 1.0), doubleArrayOf(0.9, 1.0, 0.4, 0.0)),
      '8' to
        arrayOf(
          doubleArrayOf(0.1, 0.0, 0.9, 0.0),
          doubleArrayOf(0.9, 0.0, 0.9, 1.0),
          doubleArrayOf(0.9, 1.0, 0.1, 1.0),
          doubleArrayOf(0.1, 1.0, 0.1, 0.0),
          doubleArrayOf(0.1, 0.5, 0.9, 0.5),
        ),
      '9' to
        arrayOf(
          doubleArrayOf(0.1, 0.0, 0.9, 0.0),
          doubleArrayOf(0.9, 0.0, 0.9, 1.0),
          doubleArrayOf(0.9, 1.0, 0.1, 1.0),
          doubleArrayOf(0.1, 1.0, 0.1, 0.5),
          doubleArrayOf(0.1, 0.5, 0.9, 0.5),
        ),
      '.' to arrayOf(doubleArrayOf(0.4, 0.0, 0.6, 0.0), doubleArrayOf(0.5, 0.0, 0.5, 0.15)),
      '-' to arrayOf(doubleArrayOf(0.15, 0.5, 0.85, 0.5)),
      '\'' to arrayOf(doubleArrayOf(0.5, 1.0, 0.45, 0.68)),
      '"' to arrayOf(doubleArrayOf(0.32, 1.0, 0.28, 0.68), doubleArrayOf(0.68, 1.0, 0.64, 0.68)),
      'c' to
        arrayOf(
          doubleArrayOf(0.85, 0.6, 0.15, 0.6),
          doubleArrayOf(0.15, 0.6, 0.15, 0.0),
          doubleArrayOf(0.15, 0.0, 0.85, 0.0),
        ),
      'm' to
        arrayOf(
          doubleArrayOf(0.08, 0.0, 0.08, 0.6),
          doubleArrayOf(0.08, 0.6, 0.5, 0.6),
          doubleArrayOf(0.5, 0.6, 0.5, 0.0),
          doubleArrayOf(0.5, 0.6, 0.92, 0.6),
          doubleArrayOf(0.92, 0.6, 0.92, 0.0),
        ),
      'i' to arrayOf(doubleArrayOf(0.5, 0.0, 0.5, 0.58), doubleArrayOf(0.5, 0.76, 0.5, 0.9)),
      'n' to
        arrayOf(
          doubleArrayOf(0.15, 0.0, 0.15, 0.6),
          doubleArrayOf(0.15, 0.6, 0.85, 0.6),
          doubleArrayOf(0.85, 0.6, 0.85, 0.0),
        ),
    )

  /** Builds double-sided 3D vector-stroke label geometry centered at `(0, 0, 0)` facing `+Z`. */
  @JvmStatic
  @JvmOverloads
  fun buildVectorLabelGeometry(
    text: String,
    charHeight: Double = 0.028,
    strokeWidth: Double = 0.0038,
  ): MeshGeometry {
    val clean = if (text.length > 32) text.substring(0, 32) else text
    val h = Math.max(0.004, charHeight)
    val w = h * 0.62
    val advance = w * 1.28
    val halfStroke = Math.max(0.0005, strokeWidth * 0.5)
    val quads = ArrayList<DoubleArray>()
    var cursorX = 0.0
    for (ch in clean) {
      if (ch == ' ') {
        cursorX += advance * 0.65
        continue
      }
      val strokes = GLYPH_STROKES[ch] ?: GLYPH_STROKES[ch.lowercaseChar()]
      if (strokes != null) {
        for (s in strokes) {
          quads.add(doubleArrayOf(cursorX + s[0] * w, s[1] * h, cursorX + s[2] * w, s[3] * h))
        }
      }
      cursorX += if (ch == '.' || ch == '\'') advance * 0.55 else advance
    }
    if (quads.isEmpty()) return MeshGeometry(FloatArray(0), FloatArray(0), IntArray(0))
    val totalWidth = Math.max(0.0, cursorX - advance * 0.28)
    val offsetX = -totalWidth * 0.5
    val offsetY = -h * 0.5
    val positions = FloatArray(quads.size * 8 * 3)
    val normals = FloatArray(quads.size * 8 * 3)
    val indices = IntArray(quads.size * 12)
    var v = 0
    var k = 0
    for (q in quads) {
      val dx = q[2] - q[0]
      val dy = q[3] - q[1]
      val len = Math.hypot(dx, dy).let { if (it > 1e-9) it else 1.0 }
      val nx = (-dy / len) * halfStroke
      val ny = (dx / len) * halfStroke
      val ex = (dx / len) * halfStroke * 0.5
      val ey = (dy / len) * halfStroke * 0.5
      val x0 = q[0] - ex + offsetX
      val y0 = q[1] - ey + offsetY
      val x1 = q[2] + ex + offsetX
      val y1 = q[3] + ey + offsetY
      val pts =
        arrayOf(
          doubleArrayOf(x0 - nx, y0 - ny),
          doubleArrayOf(x1 - nx, y1 - ny),
          doubleArrayOf(x1 + nx, y1 + ny),
          doubleArrayOf(x0 + nx, y0 + ny),
        )
      val frontBase = v
      for (pt in pts) {
        positions[v * 3] = pt[0].toFloat()
        positions[v * 3 + 1] = pt[1].toFloat()
        positions[v * 3 + 2] = 0.0005f
        normals[v * 3 + 2] = 1f
        v++
      }
      indices[k++] = frontBase
      indices[k++] = frontBase + 1
      indices[k++] = frontBase + 2
      indices[k++] = frontBase
      indices[k++] = frontBase + 2
      indices[k++] = frontBase + 3
      val backBase = v
      for (pt in pts) {
        positions[v * 3] = pt[0].toFloat()
        positions[v * 3 + 1] = pt[1].toFloat()
        positions[v * 3 + 2] = -0.0005f
        normals[v * 3 + 2] = -1f
        v++
      }
      indices[k++] = backBase
      indices[k++] = backBase + 2
      indices[k++] = backBase + 1
      indices[k++] = backBase
      indices[k++] = backBase + 3
      indices[k++] = backBase + 2
    }
    return MeshGeometry(positions, normals, indices)
  }

  /** Builds a batched 3D rectangular-bar mesh from `[start, end]` line segment pairs. */
  @JvmStatic
  @JvmOverloads
  fun buildSegmentBarsGeometry(
    segments: List<Pair<DoubleArray, DoubleArray>>,
    halfThickness: Double = 0.002,
  ): MeshGeometry {
    val valid = segments.filter { XRSpatialMath.dist3(it.first, it.second) > 1e-5 }
    if (valid.isEmpty()) return MeshGeometry(FloatArray(0), FloatArray(0), IntArray(0))
    val r = Math.max(0.0005, halfThickness)
    val positions = FloatArray(valid.size * 24 * 3)
    val normals = FloatArray(valid.size * 24 * 3)
    val indices = IntArray(valid.size * 36)
    val corners =
      arrayOf(
        doubleArrayOf(-1.0, -1.0),
        doubleArrayOf(1.0, -1.0),
        doubleArrayOf(1.0, 1.0),
        doubleArrayOf(-1.0, 1.0),
      )
    var vOut = 0
    var iOut = 0
    for ((a, b) in valid) {
      val mid = doubleArrayOf((a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5)
      val dx = b[0] - a[0]
      val dy = b[1] - a[1]
      val dz = b[2] - a[2]
      val len = XRSpatialMath.len3(dx, dy, dz)
      val halfLen = len * 0.5
      val t = doubleArrayOf(dx / len, dy / len, dz / len)
      val ref =
        if (Math.abs(t[1]) < 0.9) doubleArrayOf(0.0, 1.0, 0.0) else doubleArrayOf(1.0, 0.0, 0.0)
      val ux = t[1] * ref[2] - t[2] * ref[1]
      val uy = t[2] * ref[0] - t[0] * ref[2]
      val uz = t[0] * ref[1] - t[1] * ref[0]
      val uLen = XRSpatialMath.len3(ux, uy, uz).let { if (it > 1e-9) it else 1.0 }
      val u = doubleArrayOf(ux / uLen, uy / uLen, uz / uLen)
      val vx = t[1] * u[2] - t[2] * u[1]
      val vy = t[2] * u[0] - t[0] * u[2]
      val vz = t[0] * u[1] - t[1] * u[0]
      val vLen = XRSpatialMath.len3(vx, vy, vz).let { if (it > 1e-9) it else 1.0 }
      val v = doubleArrayOf(vx / vLen, vy / vLen, vz / vLen)
      val nt = doubleArrayOf(-t[0], -t[1], -t[2])
      val nu = doubleArrayOf(-u[0], -u[1], -u[2])
      val nv = doubleArrayOf(-v[0], -v[1], -v[2])
      val faces =
        arrayOf(
          Triple(t, u, v) to doubleArrayOf(halfLen, r, r),
          Triple(nt, u, nv) to doubleArrayOf(halfLen, r, r),
          Triple(u, v, t) to doubleArrayOf(r, r, halfLen),
          Triple(nu, v, nt) to doubleArrayOf(r, r, halfLen),
          Triple(v, t, u) to doubleArrayOf(r, halfLen, r),
          Triple(nv, nt, u) to doubleArrayOf(r, halfLen, r),
        )
      for ((axes, dims) in faces) {
        val (fn, fu, fv) = axes
        val base = vOut
        for (c in corners) {
          positions[vOut * 3] =
            (mid[0] + fn[0] * dims[0] + fu[0] * dims[1] * c[0] + fv[0] * dims[2] * c[1]).toFloat()
          positions[vOut * 3 + 1] =
            (mid[1] + fn[1] * dims[0] + fu[1] * dims[1] * c[0] + fv[1] * dims[2] * c[1]).toFloat()
          positions[vOut * 3 + 2] =
            (mid[2] + fn[2] * dims[0] + fu[2] * dims[1] * c[0] + fv[2] * dims[2] * c[1]).toFloat()
          normals[vOut * 3] = fn[0].toFloat()
          normals[vOut * 3 + 1] = fn[1].toFloat()
          normals[vOut * 3 + 2] = fn[2].toFloat()
          vOut++
        }
        indices[iOut++] = base
        indices[iOut++] = base + 1
        indices[iOut++] = base + 2
        indices[iOut++] = base
        indices[iOut++] = base + 2
        indices[iOut++] = base + 3
      }
    }
    return MeshGeometry(positions, normals, indices)
  }

  /** Subdivides `[start, end]` into alternating dash segments for leader lines. */
  @JvmStatic
  @JvmOverloads
  fun buildDashedSegments(
    start: DoubleArray,
    end: DoubleArray,
    dashLength: Double = 0.025,
    gapLength: Double = 0.015,
  ): List<Pair<DoubleArray, DoubleArray>> {
    val total = XRSpatialMath.dist3(start, end)
    if (total <= 1e-4) return emptyList()
    val dash = Math.max(0.004, dashLength)
    val gap = Math.max(0.002, gapLength)
    val stride = dash + gap
    val out = ArrayList<Pair<DoubleArray, DoubleArray>>()
    var d = 0.0
    while (d < total && out.size < 128) {
      val t0 = d / total
      val t1 = Math.min(1.0, (d + dash) / total)
      val p0 =
        doubleArrayOf(
          start[0] + (end[0] - start[0]) * t0,
          start[1] + (end[1] - start[1]) * t0,
          start[2] + (end[2] - start[2]) * t0,
        )
      val p1 =
        doubleArrayOf(
          start[0] + (end[0] - start[0]) * t1,
          start[1] + (end[1] - start[1]) * t1,
          start[2] + (end[2] - start[2]) * t1,
        )
      if (XRSpatialMath.dist3(p0, p1) > 1e-4) out.add(p0 to p1)
      d += stride
    }
    return out
  }
}
