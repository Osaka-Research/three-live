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

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.zip.GZIPInputStream

/** Decoded Gaussian splat cloud (structure of arrays). */
class SplatData(
  val count: Int,
  /** xyz per splat. */
  val positions: FloatArray,
  /** Linear (not log) xyz scale per splat. */
  val scales: FloatArray,
  /** RGBA8 per splat (read with `toInt() and 0xFF`). */
  val colors: ByteArray,
  /** Unit quaternion xyzw per splat. */
  val rotations: FloatArray,
) {
  internal constructor(
    count: Int
  ) : this(count, FloatArray(count * 3), FloatArray(count * 3), ByteArray(count * 4), FloatArray(count * 4))
}

/**
 * Gaussian splat decoders, ported from `xr-live/src/plugins/splat-loader.ts`: antimatter15 `.splat`
 * (32-byte records) and Niantic `.spz` v2 / v3 (gzip-compressed or raw). All decoders throw
 * [IllegalArgumentException] on malformed or over-limit input.
 */
object SplatParser {

  /** Maximum splats accepted from a single file. */
  const val MAX_SPLATS = 1_000_000

  /**
   * Maximum decompressed `.spz` payload size in bytes. Sized for Android heaps: a v3 file with
   * [MAX_SPLATS] splats and degree-1 spherical harmonics needs ~29 MB, degree-3 ~155 MB.
   */
  const val MAX_SPZ_DECOMPRESSED_BYTES = 128 * 1024 * 1024

  private const val SPLAT_RECORD_BYTES = 32
  private const val SPZ_MAGIC = 0x5053474e
  private const val SH_C0 = 0.28209479177387814
  private const val SQRT1_2 = 0.7071067811865476

  private fun u8(b: ByteArray, i: Int): Int = b[i].toInt() and 0xFF

  private fun u32(b: ByteArray, o: Int): Long =
    (u8(b, o).toLong() or (u8(b, o + 1).toLong() shl 8) or (u8(b, o + 2).toLong() shl 16) or
      (u8(b, o + 3).toLong() shl 24))

  private fun f32(b: ByteArray, o: Int): Float = java.lang.Float.intBitsToFloat(u32(b, o).toInt())

  private fun normalizeQuat(q: FloatArray, o: Int) {
    val x = q[o].toDouble()
    val y = q[o + 1].toDouble()
    val z = q[o + 2].toDouble()
    val w = q[o + 3].toDouble()
    val len = Math.sqrt(x * x + y * y + z * z + w * w)
    if (len > 1e-8 && len.isFinite()) {
      q[o] = (x / len).toFloat()
      q[o + 1] = (y / len).toFloat()
      q[o + 2] = (z / len).toFloat()
      q[o + 3] = (w / len).toFloat()
    } else {
      q[o] = 0f
      q[o + 1] = 0f
      q[o + 2] = 0f
      q[o + 3] = 1f
    }
  }

  private fun allocate(count: Int): SplatData =
    try {
      SplatData(count)
    } catch (e: OutOfMemoryError) {
      throw IllegalArgumentException("splat-loader: out of memory allocating $count splats", e)
    }

  /**
   * Parses an antimatter15-style `.splat` buffer: per splat, position f32x3, scale f32x3, RGBA
   * u8x4, rotation u8x4 (`(b - 128) / 128`, order w, x, y, z).
   */
  @JvmStatic
  fun parseSplat(bytes: ByteArray): SplatData {
    require(bytes.size % SPLAT_RECORD_BYTES == 0) {
      "splat-loader: .splat size is not a multiple of 32 bytes"
    }
    val count = bytes.size / SPLAT_RECORD_BYTES
    require(count <= MAX_SPLATS) { "splat-loader: too many splats" }
    val out = allocate(count)
    for (i in 0 until count) {
      val b = i * SPLAT_RECORD_BYTES
      for (k in 0 until 3) {
        val p = f32(bytes, b + k * 4)
        val s = f32(bytes, b + 12 + k * 4)
        out.positions[i * 3 + k] = if (p.isFinite()) p else 0f
        out.scales[i * 3 + k] = if (s.isFinite()) Math.abs(s) else 0f
      }
      System.arraycopy(bytes, b + 24, out.colors, i * 4, 4)
      out.rotations[i * 4] = ((u8(bytes, b + 29) - 128) / 128.0).toFloat()
      out.rotations[i * 4 + 1] = ((u8(bytes, b + 30) - 128) / 128.0).toFloat()
      out.rotations[i * 4 + 2] = ((u8(bytes, b + 31) - 128) / 128.0).toFloat()
      out.rotations[i * 4 + 3] = ((u8(bytes, b + 28) - 128) / 128.0).toFloat()
      normalizeQuat(out.rotations, i * 4)
    }
    return out
  }

  /** Decompresses gzip [bytes], failing once more than [maxBytes] would be produced. */
  @JvmStatic
  @JvmOverloads
  fun gunzip(bytes: ByteArray, maxBytes: Int = MAX_SPZ_DECOMPRESSED_BYTES): ByteArray {
    try {
      GZIPInputStream(ByteArrayInputStream(bytes)).use { gz ->
        val out = ByteArrayOutputStream(Math.min(Math.max(bytes.size * 4, 64), 1 shl 20))
        val buf = ByteArray(64 * 1024)
        var total = 0L
        while (true) {
          val n = gz.read(buf)
          if (n < 0) break
          total += n
          require(total <= maxBytes) { "splat-loader: decompressed .spz exceeds size limit" }
          out.write(buf, 0, n)
        }
        return out.toByteArray()
      }
    } catch (e: IOException) {
      throw IllegalArgumentException("splat-loader: invalid gzip data", e)
    } catch (e: OutOfMemoryError) {
      throw IllegalArgumentException("splat-loader: out of memory decompressing .spz", e)
    }
  }

  /**
   * Parses a decompressed `.spz` payload (versions 2 and 3): 16-byte header, then SoA blocks of
   * 24-bit fixed-point positions, alphas, colors (SH DC), log scales, and rotations (3-byte xyz
   * for v2, 4-byte smallest-three for v3). Spherical-harmonic bands are ignored.
   */
  @JvmStatic
  fun parseSpzPayload(bytes: ByteArray): SplatData {
    require(bytes.size >= 16) { "splat-loader: .spz header truncated" }
    require(u32(bytes, 0) == SPZ_MAGIC.toLong()) { "splat-loader: bad .spz magic" }
    val version = u32(bytes, 4)
    require(version == 2L || version == 3L) { "splat-loader: unsupported .spz version $version" }
    val countL = u32(bytes, 8)
    require(countL <= MAX_SPLATS) { "splat-loader: too many splats" }
    val count = countL.toInt()
    val fractionalBits = u8(bytes, 13)
    require(fractionalBits <= 24) { "splat-loader: invalid .spz fractional bits" }
    val rotBytes = if (version == 3L) 4 else 3
    val needed = 16L + count.toLong() * (9 + 1 + 3 + 3 + rotBytes)
    require(bytes.size >= needed) { "splat-loader: .spz payload truncated" }
    val out = allocate(count)
    val fixed = Math.pow(2.0, -fractionalBits.toDouble())
    var o = 16
    for (i in 0 until count * 3) {
      var v = u8(bytes, o) or (u8(bytes, o + 1) shl 8) or (u8(bytes, o + 2) shl 16)
      if (v and 0x800000 != 0) v = v or 0xffffff.inv()
      out.positions[i] = (v * fixed).toFloat()
      o += 3
    }
    val alphaStart = o
    val colorStart = alphaStart + count
    val scaleStart = colorStart + count * 3
    val rotStart = scaleStart + count * 3
    for (i in 0 until count) {
      for (k in 0 until 3) {
        val dc = (u8(bytes, colorStart + i * 3 + k) / 255.0 - 0.5) / 0.15
        val c = Math.floor((0.5 + SH_C0 * dc) * 255 + 0.5)
        out.colors[i * 4 + k] = Math.max(0.0, Math.min(255.0, c)).toInt().toByte()
        out.scales[i * 3 + k] = Math.exp(u8(bytes, scaleStart + i * 3 + k) / 16.0 - 10).toFloat()
      }
      out.colors[i * 4 + 3] = bytes[alphaStart + i]
      val r = rotStart + i * rotBytes
      val q = i * 4
      if (version == 2L) {
        val x = u8(bytes, r) / 127.5 - 1
        val y = u8(bytes, r + 1) / 127.5 - 1
        val z = u8(bytes, r + 2) / 127.5 - 1
        out.rotations[q] = x.toFloat()
        out.rotations[q + 1] = y.toFloat()
        out.rotations[q + 2] = z.toFloat()
        out.rotations[q + 3] = Math.sqrt(Math.max(0.0, 1 - x * x - y * y - z * z)).toFloat()
      } else {
        var comp = u32(bytes, r).toInt()
        val largest = comp ushr 30
        var sum = 0.0
        for (k in 3 downTo 0) {
          if (k == largest) continue
          val mag = comp and 511
          val neg = (comp ushr 9) and 1
          comp = comp ushr 10
          val c = SQRT1_2 * mag / 511 * (if (neg != 0) -1 else 1)
          out.rotations[q + k] = c.toFloat()
          sum += c * c
        }
        out.rotations[q + largest] = Math.sqrt(Math.max(0.0, 1 - sum)).toFloat()
      }
      normalizeQuat(out.rotations, q)
    }
    return out
  }

  /** Parses `.spz` bytes, transparently gunzipping when gzip-compressed. */
  @JvmStatic
  fun parseSpz(bytes: ByteArray): SplatData {
    val gz = bytes.size >= 2 && u8(bytes, 0) == 0x1f && u8(bytes, 1) == 0x8b
    return parseSpzPayload(if (gz) gunzip(bytes) else bytes)
  }

  /** Detects `.spz` (gzip or raw magic) versus `.splat` and decodes accordingly. */
  @JvmStatic
  fun parseAuto(bytes: ByteArray): SplatData {
    val isSpz =
      (bytes.size >= 2 && u8(bytes, 0) == 0x1f && u8(bytes, 1) == 0x8b) ||
        (bytes.size >= 4 && u32(bytes, 0) == SPZ_MAGIC.toLong())
    return if (isSpz) parseSpz(bytes) else parseSplat(bytes)
  }

  /**
   * Returns splat indices sorted back-to-front for a column-major model-view-projection matrix,
   * keyed on clip-space `w` with a single-pass 16-bit counting sort. Pass reusable [out],
   * [depths], [keys] and [counts] (65536 entries) buffers to avoid per-frame allocation.
   */
  @JvmStatic
  @JvmOverloads
  fun sortSplatsByDepth(
    count: Int,
    positions: FloatArray,
    mvp: FloatArray,
    out: IntArray = IntArray(count),
    depths: FloatArray = FloatArray(count),
    keys: IntArray = IntArray(count),
    counts: IntArray = IntArray(65536),
  ): IntArray {
    require(count >= 0 && positions.size >= count * 3L) { "sortSplatsByDepth: positions too small" }
    require(mvp.size >= 16) { "sortSplatsByDepth: mvp must have 16 elements" }
    require(out.size >= count && depths.size >= count && keys.size >= count) {
      "sortSplatsByDepth: scratch buffers too small"
    }
    require(counts.size >= 65536) { "sortSplatsByDepth: counts must have 65536 entries" }
    var min = Double.POSITIVE_INFINITY
    var max = Double.NEGATIVE_INFINITY
    for (i in 0 until count) {
      val w =
        mvp[3] * positions[i * 3].toDouble() + mvp[7] * positions[i * 3 + 1].toDouble() +
          mvp[11] * positions[i * 3 + 2].toDouble() + mvp[15]
      depths[i] = w.toFloat()
      if (w < min) min = w
      if (w > max) max = w
    }
    val buckets = 65536
    java.util.Arrays.fill(counts, 0)
    val range = (max - min).let { if (it == 0.0 || it.isNaN()) 1.0 else it }
    for (i in 0 until count) {
      var k = Math.floor((max - depths[i]) / range * (buckets - 1)).toInt()
      k = Math.max(0, Math.min(buckets - 1, k))
      keys[i] = k
      counts[k]++
    }
    for (k in 1 until buckets) counts[k] += counts[k - 1]
    for (i in count - 1 downTo 0) out[--counts[keys[i]]] = i
    return out
  }
}
