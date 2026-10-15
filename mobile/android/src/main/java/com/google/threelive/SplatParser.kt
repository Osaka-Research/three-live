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
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

/** Camera-facing quad geometry built from a sorted [SplatData] cloud. */
class SplatQuadGeometry(
  /** World-space xyz per vertex (`4 * count * 3` floats). */
  val positions: FloatArray,
  /** Two-triangle quad UV0 per vertex (`4 * count * 2` floats). */
  val uvs: FloatArray,
  /** RGBA8 per vertex (`4 * count * 4` bytes). */
  val colors: ByteArray,
  /** Triangle indices (`6 * count` ints). */
  val indices: IntArray,
)

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

  /** Maximum downloaded (compressed) splat file size in bytes (128 MiB). */
  const val MAX_SPLAT_FILE_BYTES = 128 * 1024 * 1024

  /** Default CPU-billboard splat cap on Android / Filament (150 k). */
  const val DEFAULT_MAX_CPU_SPLATS = 150_000

  private const val SPLAT_RECORD_BYTES = 32
  private const val SPZ_MAGIC = 0x5053474e
  private const val SH_C0 = 0.28209479177387814
  private const val SQRT1_2 = 0.7071067811865476
  private const val MAX_URL_CHARS = 4096
  private const val NETWORK_TIMEOUT_MS = 15_000

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

  /**
   * Validates a splat URL: `https:`, or `http:` on loopback (`localhost` / `127.0.0.1`), plus
   * relative URLs resolved against [baseUrl]. Unless [allowCrossOrigin] is `true` (host prop
   * `allowRemoteSplats`), the resolved URL must share the origin of [baseUrl] so a third-party
   * `.glb` cannot make the viewer contact arbitrary servers. Returns `null` when rejected.
   */
  @JvmStatic
  @JvmOverloads
  fun resolveSplatUrl(
    raw: String?,
    baseUrl: String? = null,
    allowCrossOrigin: Boolean = true,
  ): String? {
    val trimmed = raw?.trim() ?: return null
    if (trimmed.isEmpty() || trimmed.length > MAX_URL_CHARS || trimmed.startsWith("//")) return null
    val fallback = baseUrl?.trim()?.takeIf { it.isNotEmpty() } ?: "https://localhost/"
    return try {
      val baseUri = URI(fallback)
      val resolved = baseUri.resolve(trimmed)
      val scheme = resolved.scheme?.lowercase() ?: return null
      val host = resolved.host?.lowercase() ?: return null
      val loopback = host == "localhost" || host == "127.0.0.1"
      val schemeOk = scheme == "https" || (scheme == "http" && loopback)
      if (!schemeOk) return null
      if (!allowCrossOrigin && originOf(resolved) != originOf(baseUri)) return null
      resolved.toASCIIString()
    } catch (e: RuntimeException) {
      null
    }
  }

  private fun originOf(uri: URI): String {
    val scheme = uri.scheme?.lowercase() ?: ""
    val host = uri.host?.lowercase() ?: ""
    val port = uri.port
    val defaultPort = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
    return if (port <= 0 || defaultPort) "$scheme://$host" else "$scheme://$host:$port"
  }

  /**
   * Deterministic stride downsampling when [data] exceeds [maxSplats], keeping at most [maxSplats]
   * splats. Returns [data] unchanged when `data.count <= maxSplats`.
   */
  @JvmStatic
  @JvmOverloads
  fun downsample(data: SplatData, maxSplats: Int = DEFAULT_MAX_CPU_SPLATS): SplatData {
    val cap = maxSplats.coerceIn(1, MAX_SPLATS)
    if (data.count <= cap) return data
    val out = allocate(cap)
    val step = data.count.toDouble() / cap
    for (i in 0 until cap) {
      val src = Math.min(data.count - 1, Math.floor(i * step).toInt())
      System.arraycopy(data.positions, src * 3, out.positions, i * 3, 3)
      System.arraycopy(data.scales, src * 3, out.scales, i * 3, 3)
      System.arraycopy(data.colors, src * 4, out.colors, i * 4, 4)
      System.arraycopy(data.rotations, src * 4, out.rotations, i * 4, 4)
    }
    return out
  }

  /**
   * Returns `true` when the camera or splat node moved by more than [minMoveMeters] (default 5 cm)
   * or rotated by more than [minAngleDeg] (default 5°).
   */
  @JvmStatic
  @JvmOverloads
  fun shouldResort(
    lastCameraWorld: FloatArray?,
    cameraWorld: FloatArray,
    lastNodeWorld: DoubleArray?,
    nodeWorld: DoubleArray,
    minMoveMeters: Double = 0.05,
    minAngleDeg: Double = 5.0,
  ): Boolean {
    if (lastCameraWorld == null || lastNodeWorld == null) return true
    if (lastCameraWorld.size < 16 || cameraWorld.size < 16 || lastNodeWorld.size < 16 || nodeWorld.size < 16) {
      return true
    }
    val cdx = (cameraWorld[12] - lastCameraWorld[12]).toDouble()
    val cdy = (cameraWorld[13] - lastCameraWorld[13]).toDouble()
    val cdz = (cameraWorld[14] - lastCameraWorld[14]).toDouble()
    if (cdx * cdx + cdy * cdy + cdz * cdz > minMoveMeters * minMoveMeters) return true
    val ndx = nodeWorld[12] - lastNodeWorld[12]
    val ndy = nodeWorld[13] - lastNodeWorld[13]
    val ndz = nodeWorld[14] - lastNodeWorld[14]
    if (ndx * ndx + ndy * ndy + ndz * ndz > minMoveMeters * minMoveMeters) return true
    val cosLimit = Math.cos(Math.toRadians(minAngleDeg))
    // Camera -Z forward axis (column 2 of column-major cameraWorld).
    val fDot =
      lastCameraWorld[8].toDouble() * cameraWorld[8] +
        lastCameraWorld[9].toDouble() * cameraWorld[9] +
        lastCameraWorld[10].toDouble() * cameraWorld[10]
    if (fDot < cosLimit) return true
    // Node +X and +Z axes (normalized).
    val nDot = axisDot(lastNodeWorld, nodeWorld, 0) * 0.5 + axisDot(lastNodeWorld, nodeWorld, 8) * 0.5
    return nDot < cosLimit
  }

  private fun axisDot(a: DoubleArray, b: DoubleArray, colOffset: Int): Double {
    val ax = a[colOffset]
    val ay = a[colOffset + 1]
    val az = a[colOffset + 2]
    val bx = b[colOffset]
    val by = b[colOffset + 1]
    val bz = b[colOffset + 2]
    val la = Math.sqrt(ax * ax + ay * ay + az * az)
    val lb = Math.sqrt(bx * bx + by * by + bz * bz)
    if (la < 1e-9 || lb < 1e-9) return 1.0
    return (ax * bx + ay * by + az * bz) / (la * lb)
  }

  /**
   * Builds a 16-float column-major matrix whose row 3 (`mvp[3], mvp[7], mvp[11], mvp[15]`) equals
   * `dot(-cameraForward, nodeWorld * localPos - cameraPos)`, so [sortSplatsByDepth] sorts by view
   * distance along the camera's `-Z` axis.
   */
  @JvmStatic
  fun viewDepthMatrix(nodeWorld: DoubleArray, cameraWorld: FloatArray): FloatArray {
    val out = FloatArray(16)
    if (nodeWorld.size < 16 || cameraWorld.size < 16) return out
    val fx = -cameraWorld[8].toDouble()
    val fy = -cameraWorld[9].toDouble()
    val fz = -cameraWorld[10].toDouble()
    val cx = cameraWorld[12].toDouble()
    val cy = cameraWorld[13].toDouble()
    val cz = cameraWorld[14].toDouble()
    out[3] = (fx * nodeWorld[0] + fy * nodeWorld[1] + fz * nodeWorld[2]).toFloat()
    out[7] = (fx * nodeWorld[4] + fy * nodeWorld[5] + fz * nodeWorld[6]).toFloat()
    out[11] = (fx * nodeWorld[8] + fy * nodeWorld[9] + fz * nodeWorld[10]).toFloat()
    out[15] =
      (fx * (nodeWorld[12] - cx) + fy * (nodeWorld[13] - cy) + fz * (nodeWorld[14] - cz)).toFloat()
    return out
  }

  /**
   * Builds camera-facing billboard quads in world space for [data] in back-to-front [order].
   * Each splat is sized to `1.5 * max(scale.x, scale.y, scale.z) * maxAxisScale(nodeWorld)`
   * (matching the web `3.0 * radius` diameter) and oriented along the camera's right and up axes.
   */
  @JvmStatic
  fun buildSplatQuads(
    data: SplatData,
    order: IntArray,
    nodeWorld: DoubleArray,
    cameraWorld: FloatArray,
  ): SplatQuadGeometry {
    val n = minOf(data.count, order.size)
    val positions = FloatArray(n * 12)
    val uvs = FloatArray(n * 8)
    val colors = ByteArray(n * 16)
    val indices = IntArray(n * 6)
    if (n == 0 || nodeWorld.size < 16 || cameraWorld.size < 16) {
      return SplatQuadGeometry(positions, uvs, colors, indices)
    }
    val sx = Math.sqrt(nodeWorld[0] * nodeWorld[0] + nodeWorld[1] * nodeWorld[1] + nodeWorld[2] * nodeWorld[2])
    val sy = Math.sqrt(nodeWorld[4] * nodeWorld[4] + nodeWorld[5] * nodeWorld[5] + nodeWorld[6] * nodeWorld[6])
    val sz = Math.sqrt(nodeWorld[8] * nodeWorld[8] + nodeWorld[9] * nodeWorld[9] + nodeWorld[10] * nodeWorld[10])
    val nodeScale = maxOf(sx, sy, sz, 1e-6).toFloat()
    val rx = cameraWorld[0]
    val ry = cameraWorld[1]
    val rz = cameraWorld[2]
    val ux = cameraWorld[4]
    val uy = cameraWorld[5]
    val uz = cameraWorld[6]

    for (k in 0 until n) {
      val s = order[k]
      if (s !in 0 until data.count) continue
      val lx = data.positions[s * 3].toDouble()
      val ly = data.positions[s * 3 + 1].toDouble()
      val lz = data.positions[s * 3 + 2].toDouble()
      val wx = (nodeWorld[0] * lx + nodeWorld[4] * ly + nodeWorld[8] * lz + nodeWorld[12]).toFloat()
      val wy = (nodeWorld[1] * lx + nodeWorld[5] * ly + nodeWorld[9] * lz + nodeWorld[13]).toFloat()
      val wz = (nodeWorld[2] * lx + nodeWorld[6] * ly + nodeWorld[10] * lz + nodeWorld[14]).toFloat()
      val r0 = maxOf(data.scales[s * 3], data.scales[s * 3 + 1], data.scales[s * 3 + 2])
      val half = (r0 * nodeScale * 1.5f).coerceIn(0.001f, 10f)
      val drx = rx * half
      val dry = ry * half
      val drz = rz * half
      val dux = ux * half
      val duy = uy * half
      val duz = uz * half

      val po = k * 12
      positions[po] = wx - drx - dux
      positions[po + 1] = wy - dry - duy
      positions[po + 2] = wz - drz - duz
      positions[po + 3] = wx + drx - dux
      positions[po + 4] = wy + dry - duy
      positions[po + 5] = wz + drz - duz
      positions[po + 6] = wx + drx + dux
      positions[po + 7] = wy + dry + duy
      positions[po + 8] = wz + drz + duz
      positions[po + 9] = wx - drx + dux
      positions[po + 10] = wy - dry + duy
      positions[po + 11] = wz - drz + duz

      val uo = k * 8
      uvs[uo] = 0f
      uvs[uo + 1] = 0f
      uvs[uo + 2] = 1f
      uvs[uo + 3] = 0f
      uvs[uo + 4] = 1f
      uvs[uo + 5] = 1f
      uvs[uo + 6] = 0f
      uvs[uo + 7] = 1f

      val co = k * 16
      val c0 = data.colors[s * 4]
      val c1 = data.colors[s * 4 + 1]
      val c2 = data.colors[s * 4 + 2]
      val c3 = data.colors[s * 4 + 3]
      for (v in 0 until 4) {
        colors[co + v * 4] = c0
        colors[co + v * 4 + 1] = c1
        colors[co + v * 4 + 2] = c2
        colors[co + v * 4 + 3] = c3
      }

      val vo = k * 4
      val io = k * 6
      indices[io] = vo
      indices[io + 1] = vo + 1
      indices[io + 2] = vo + 2
      indices[io + 3] = vo
      indices[io + 4] = vo + 2
      indices[io + 5] = vo + 3
    }
    return SplatQuadGeometry(positions, uvs, colors, indices)
  }

  /**
   * Generates a `[size] x [size]` RGBA8 radial Gaussian falloff texture (`RGB = 255`,
   * `A = round(255 * exp(-4 * r^2))` for `r <= 1`, `0` outside) matching the web fragment shader.
   */
  @JvmStatic
  @JvmOverloads
  fun gaussianFalloffRgba(size: Int = 64): ByteBuffer {
    val n = size.coerceIn(4, 256)
    val buf = ByteBuffer.allocateDirect(n * n * 4).order(ByteOrder.nativeOrder())
    val half = (n - 1) * 0.5
    for (y in 0 until n) {
      val dy = (y - half) / half
      for (x in 0 until n) {
        val dx = (x - half) / half
        val r2 = dx * dx + dy * dy
        val a = if (r2 > 1.0) 0 else Math.round(255.0 * Math.exp(-4.0 * r2)).toInt().coerceIn(0, 255)
        buf.put(0xFF.toByte())
        buf.put(0xFF.toByte())
        buf.put(0xFF.toByte())
        buf.put(a.toByte())
      }
    }
    buf.rewind()
    return buf
  }

  /**
   * Downloads and decodes a `.splat` / `.spz` file from [url], enforcing [resolveSplatUrl] and
   * [MAX_SPLAT_FILE_BYTES]. Blocking call; invoke from a background thread.
   */
  @JvmStatic
  @JvmOverloads
  fun loadUrl(
    url: String,
    baseUrl: String? = null,
    allowCrossOrigin: Boolean = true,
    maxBytes: Int = MAX_SPLAT_FILE_BYTES,
  ): SplatData {
    val resolved =
      resolveSplatUrl(url, baseUrl, allowCrossOrigin)
        ?: throw IllegalArgumentException("splat-loader: URL rejected")
    val conn = URL(resolved).openConnection() as HttpURLConnection
    conn.connectTimeout = NETWORK_TIMEOUT_MS
    conn.readTimeout = NETWORK_TIMEOUT_MS
    conn.instanceFollowRedirects = false
    try {
      val code = conn.responseCode
      require(code == HttpURLConnection.HTTP_OK) { "splat-loader: HTTP $code" }
      val declared = conn.contentLengthLong
      require(declared <= maxBytes) { "splat-loader: file too large" }
      val bytes =
        conn.inputStream.use { input ->
          val out = ByteArrayOutputStream()
          val buf = ByteArray(64 * 1024)
          var total = 0L
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            total += n
            require(total <= maxBytes) { "splat-loader: file too large" }
            out.write(buf, 0, n)
          }
          out.toByteArray()
        }
      val path = URI(resolved).path?.lowercase() ?: ""
      return if (path.endsWith(".spz")) parseSpz(bytes) else parseAuto(bytes)
    } catch (e: IOException) {
      throw IllegalArgumentException("splat-loader: download failed", e)
    } finally {
      conn.disconnect()
    }
  }
}
