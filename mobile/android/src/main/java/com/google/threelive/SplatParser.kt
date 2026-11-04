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
class SplatData
@JvmOverloads
constructor(
  val count: Int,
  /** xyz per splat. */
  val positions: FloatArray,
  /** Linear (not log) xyz scale per splat. */
  val scales: FloatArray,
  /** RGBA8 per splat (read with `toInt() and 0xFF`). */
  val colors: ByteArray,
  /** Unit quaternion xyzw per splat. */
  val rotations: FloatArray,
  /** Optional Spherical Harmonics degree (`0`, `1`, `2`, or `3`). */
  val shDegree: Int = 0,
  /**
   * Optional higher-order Spherical Harmonics coefficients in `[-1, 1]` (`count *
   * SplatParser.shBasisCountForDegree(shDegree) * 3` floats, RGB-interleaved per basis).
   */
  val sh: FloatArray? = null,
) {
  internal constructor(
    count: Int,
    shDegree: Int = 0,
  ) : this(
    count,
    FloatArray(count * 3),
    FloatArray(count * 3),
    ByteArray(count * 4),
    FloatArray(count * 4),
    shDegree,
    if (SplatParser.shBasisCountForDegree(shDegree) > 0) {
      FloatArray(count * SplatParser.shBasisCountForDegree(shDegree) * 3)
    } else {
      null
    },
  )
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

  /** Default GPU-billboard splat cap on Android / Filament (1 M). */
  const val DEFAULT_MAX_GPU_SPLATS = 1_000_000

  private const val SPLAT_RECORD_BYTES = 32
  private const val SPZ_MAGIC = 0x5053474e
  private const val SH_C0 = 0.28209479177387814
  private const val SH_C1 = 0.4886025119029199
  private const val SH_C2_0 = 1.0925484305920792
  private const val SH_C2_1 = -1.0925484305920792
  private const val SH_C2_2 = 0.31539156525252005
  private const val SH_C2_3 = -1.0925484305920792
  private const val SH_C2_4 = 0.5462742152960396
  private const val SH_C3_0 = -0.5900435899266435
  private const val SH_C3_1 = 2.890611442640554
  private const val SH_C3_2 = -0.4570457994644658
  private const val SH_C3_3 = 0.3731763325901154
  private const val SH_C3_4 = -0.4570457994644658
  private const val SH_C3_5 = 1.445305721320277
  private const val SH_C3_6 = -0.5900435899266435
  private const val SQRT1_2 = 0.7071067811865476
  private const val MAX_URL_CHARS = 4096
  private const val NETWORK_TIMEOUT_MS = 15_000

  /** Number of higher-order SH basis functions (excluding DC) for degree `0..3`. */
  @JvmStatic
  fun shBasisCountForDegree(shDegree: Int): Int =
    when (shDegree) {
      1 -> 3
      2 -> 8
      3 -> 15
      else -> 0
    }

  private fun u8(b: ByteArray, i: Int): Int = b[i].toInt() and 0xFF

  private fun u32(b: ByteArray, o: Int): Long =
    (u8(b, o).toLong() or
      (u8(b, o + 1).toLong() shl 8) or
      (u8(b, o + 2).toLong() shl 16) or
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

  private fun allocate(count: Int, shDegree: Int = 0): SplatData =
    try {
      SplatData(count, shDegree)
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
   * 24-bit fixed-point positions, alphas, colors (SH DC), log scales, rotations (3-byte xyz for v2,
   * 4-byte smallest-three for v3), and optional trailing Spherical Harmonics (bands 1–3, header
   * byte 12).
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
    val rawShDegree = u8(bytes, 12)
    require(rawShDegree <= 3) { "splat-loader: invalid .spz shDegree $rawShDegree" }
    val fractionalBits = u8(bytes, 13)
    require(fractionalBits <= 24) { "splat-loader: invalid .spz fractional bits" }
    val rotBytes = if (version == 3L) 4 else 3
    val needed = 16L + count.toLong() * (9 + 1 + 3 + 3 + rotBytes)
    require(bytes.size >= needed) { "splat-loader: .spz payload truncated" }
    val shBasisCount = shBasisCountForDegree(rawShDegree)
    val shBytesPerSplat = shBasisCount * 3
    val hasFullShBlock =
      shBytesPerSplat > 0 && bytes.size >= needed + count.toLong() * shBytesPerSplat
    val out = allocate(count, if (hasFullShBlock) rawShDegree else 0)
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
    val shStart = rotStart + count * rotBytes
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
    val shArr = out.sh
    if (hasFullShBlock && shArr != null) {
      val totalSh = count * shBytesPerSplat
      for (j in 0 until totalSh) {
        shArr[j] = ((u8(bytes, shStart + j) - 128) / 128.0).toFloat()
      }
    }
    return out
  }

  /**
   * Evaluates view-dependent RGB color `[0..255]` for splat [index] along unit view direction
   * `(dirX, dirY, dirZ)` (from camera to splat) using decoded Spherical Harmonics bands 1..3 when
   * present.
   */
  @JvmStatic
  fun evaluateSplatSH(
    data: SplatData,
    index: Int,
    dirX: Float,
    dirY: Float,
    dirZ: Float,
  ): IntArray {
    if (index !in 0 until data.count) return intArrayOf(0, 0, 0)
    val r0 = data.colors[index * 4].toInt() and 0xFF
    val g0 = data.colors[index * 4 + 1].toInt() and 0xFF
    val b0 = data.colors[index * 4 + 2].toInt() and 0xFF
    val deg = data.shDegree
    val basisCount = shBasisCountForDegree(deg)
    val sh = data.sh
    if (deg <= 0 || basisCount <= 0 || sh == null || sh.size < (index + 1) * basisCount * 3) {
      return intArrayOf(r0, g0, b0)
    }
    val len =
      Math.sqrt((dirX * dirX + dirY * dirY + dirZ * dirZ).toDouble()).let {
        if (it > 1e-8) it else 1.0
      }
    val x = dirX / len
    val y = dirY / len
    val z = dirZ / len
    val offset = index * basisCount * 3
    var r = r0 / 255.0
    var g = g0 / 255.0
    var b = b0 / 255.0

    fun addBasis(basisIdx: Int, weight: Double) {
      val o = offset + basisIdx * 3
      r += weight * sh[o]
      g += weight * sh[o + 1]
      b += weight * sh[o + 2]
    }

    if (deg >= 1) {
      addBasis(0, -SH_C1 * y)
      addBasis(1, SH_C1 * z)
      addBasis(2, -SH_C1 * x)
    }
    if (deg >= 2) {
      val xx = x * x
      val yy = y * y
      val zz = z * z
      val xy = x * y
      val yz = y * z
      val xz = x * z
      addBasis(3, SH_C2_0 * xy)
      addBasis(4, SH_C2_1 * yz)
      addBasis(5, SH_C2_2 * (2.0 * zz - xx - yy))
      addBasis(6, SH_C2_3 * xz)
      addBasis(7, SH_C2_4 * (xx - yy))
      if (deg >= 3) {
        addBasis(8, SH_C3_0 * y * (3.0 * xx - yy))
        addBasis(9, SH_C3_1 * xy * z)
        addBasis(10, SH_C3_2 * y * (4.0 * zz - xx - yy))
        addBasis(11, SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy))
        addBasis(12, SH_C3_4 * x * (4.0 * zz - xx - yy))
        addBasis(13, SH_C3_5 * z * (xx - yy))
        addBasis(14, SH_C3_6 * x * (xx - 3.0 * yy))
      }
    }
    return intArrayOf(
      Math.round(r * 255.0).toInt().coerceIn(0, 255),
      Math.round(g * 255.0).toInt().coerceIn(0, 255),
      Math.round(b * 255.0).toInt().coerceIn(0, 255),
    )
  }

  /**
   * Computes the 6 unique upper-triangular elements `[cxx, cxy, cxz, cyy, cyz, czz]` of the 3D
   * Gaussian covariance matrix `Sigma = R * S * S^T * R^T` for splat [index].
   */
  @JvmStatic
  @JvmOverloads
  fun computeCovariance3D(
    scales: FloatArray,
    rotations: FloatArray,
    index: Int,
    out: FloatArray = FloatArray(6),
    outOffset: Int = 0,
  ): FloatArray {
    val sx = scales[index * 3].toDouble()
    val sy = scales[index * 3 + 1].toDouble()
    val sz = scales[index * 3 + 2].toDouble()
    var qx = rotations[index * 4].toDouble()
    var qy = rotations[index * 4 + 1].toDouble()
    var qz = rotations[index * 4 + 2].toDouble()
    var qw = rotations[index * 4 + 3].toDouble()
    val qLen = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    if (qLen > 1e-8) {
      qx /= qLen
      qy /= qLen
      qz /= qLen
      qw /= qLen
    } else {
      qx = 0.0
      qy = 0.0
      qz = 0.0
      qw = 1.0
    }

    val r00 = 1.0 - 2.0 * (qy * qy + qz * qz)
    val r01 = 2.0 * (qx * qy - qw * qz)
    val r02 = 2.0 * (qx * qz + qw * qy)
    val r10 = 2.0 * (qx * qy + qw * qz)
    val r11 = 1.0 - 2.0 * (qx * qx + qz * qz)
    val r12 = 2.0 * (qy * qz - qw * qx)
    val r20 = 2.0 * (qx * qz - qw * qy)
    val r21 = 2.0 * (qy * qz + qw * qx)
    val r22 = 1.0 - 2.0 * (qx * qx + qy * qy)

    val m00 = r00 * sx
    val m01 = r01 * sy
    val m02 = r02 * sz
    val m10 = r10 * sx
    val m11 = r11 * sy
    val m12 = r12 * sz
    val m20 = r20 * sx
    val m21 = r21 * sy
    val m22 = r22 * sz

    out[outOffset] = (m00 * m00 + m01 * m01 + m02 * m02).toFloat()
    out[outOffset + 1] = (m00 * m10 + m01 * m11 + m02 * m12).toFloat()
    out[outOffset + 2] = (m00 * m20 + m01 * m21 + m02 * m22).toFloat()
    out[outOffset + 3] = (m10 * m10 + m11 * m11 + m12 * m12).toFloat()
    out[outOffset + 4] = (m10 * m20 + m11 * m21 + m12 * m22).toFloat()
    out[outOffset + 5] = (m20 * m20 + m21 * m21 + m22 * m22).toFloat()
    return out
  }

  /**
   * Projects a 3D covariance `[cxx, cxy, cxz, cyy, cyz, czz]` to 2D screen space via the
   * perspective Jacobian `J` and view transform [modelView] (column-major 4x4): `Sigma_2D = J * W *
   * Sigma * W^T * J^T + 0.3 * I`.
   *
   * Returns a 9-float array `[covXX, covXY, covYY, lambda1, lambda2, majorX, majorY, minorX,
   * minorY]`.
   */
  @JvmStatic
  @JvmOverloads
  fun projectCovariance2D(
    cov3d: FloatArray,
    modelView: FloatArray,
    localPos: FloatArray,
    focalX: Float,
    focalY: Float = focalX,
  ): FloatArray {
    val px = localPos[0].toDouble()
    val py = localPos[1].toDouble()
    val pz = localPos[2].toDouble()
    val vx = modelView[0] * px + modelView[4] * py + modelView[8] * pz + modelView[12]
    val vy = modelView[1] * px + modelView[5] * py + modelView[9] * pz + modelView[13]
    val vz = modelView[2] * px + modelView[6] * py + modelView[10] * pz + modelView[14]
    val tz = Math.max(Math.abs(vz), 1e-3)
    val signZ = if (vz < 0.0) -1.0 else 1.0

    val j00 = focalX / tz
    val j02 = (-signZ * focalX * vx) / (tz * tz)
    val j11 = focalY / tz
    val j12 = (-signZ * focalY * vy) / (tz * tz)

    val w00 = modelView[0].toDouble()
    val w01 = modelView[4].toDouble()
    val w02 = modelView[8].toDouble()
    val w10 = modelView[1].toDouble()
    val w11 = modelView[5].toDouble()
    val w12 = modelView[9].toDouble()
    val w20 = modelView[2].toDouble()
    val w21 = modelView[6].toDouble()
    val w22 = modelView[10].toDouble()

    val t00 = j00 * w00 + j02 * w20
    val t01 = j00 * w01 + j02 * w21
    val t02 = j00 * w02 + j02 * w22
    val t10 = j11 * w10 + j12 * w20
    val t11 = j11 * w11 + j12 * w21
    val t12 = j11 * w12 + j12 * w22

    val s00 = cov3d[0].toDouble()
    val s01 = cov3d[1].toDouble()
    val s02 = cov3d[2].toDouble()
    val s11 = cov3d[3].toDouble()
    val s12 = cov3d[4].toDouble()
    val s22 = cov3d[5].toDouble()

    val st00 = s00 * t00 + s01 * t01 + s02 * t02
    val st10 = s01 * t00 + s11 * t01 + s12 * t02
    val st20 = s02 * t00 + s12 * t01 + s22 * t02
    val st01 = s00 * t10 + s01 * t11 + s02 * t12
    val st11 = s01 * t10 + s11 * t11 + s12 * t12
    val st21 = s02 * t10 + s12 * t11 + s22 * t12

    val a = t00 * st00 + t01 * st10 + t02 * st20 + 0.3
    val b = t00 * st01 + t01 * st11 + t02 * st21
    val c = t10 * st01 + t11 * st11 + t12 * st21 + 0.3

    val mid = 0.5 * (a + c)
    val diff = 0.5 * (a - c)
    val disc = Math.hypot(diff, b)
    val lambda1 = Math.max(0.1, mid + disc)
    val lambda2 = Math.max(0.1, mid - disc)

    var dx = b
    var dy = lambda1 - a
    val dLen = Math.hypot(dx, dy)
    if (dLen > 1e-8) {
      dx /= dLen
      dy /= dLen
    } else {
      dx = if (a >= c) 1.0 else 0.0
      dy = if (a >= c) 0.0 else 1.0
    }
    val r1 = Math.min(256.0, 3.0 * Math.sqrt(lambda1))
    val r2 = Math.min(256.0, 3.0 * Math.sqrt(lambda2))
    return floatArrayOf(
      a.toFloat(),
      b.toFloat(),
      c.toFloat(),
      lambda1.toFloat(),
      lambda2.toFloat(),
      (dx * r1).toFloat(),
      (dy * r1).toFloat(),
      (-dy * r2).toFloat(),
      (dx * r2).toFloat(),
    )
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
   * keyed on clip-space `w` with a single-pass 16-bit counting sort. Pass reusable [out], [depths],
   * [keys] and [counts] (65536 entries) buffers to avoid per-frame allocation.
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
        mvp[3] * positions[i * 3].toDouble() +
          mvp[7] * positions[i * 3 + 1].toDouble() +
          mvp[11] * positions[i * 3 + 2].toDouble() +
          mvp[15]
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
    val out = allocate(cap, data.shDegree)
    val shValsPerSplat = shBasisCountForDegree(data.shDegree) * 3
    val step = data.count.toDouble() / cap
    for (i in 0 until cap) {
      val src = Math.min(data.count - 1, Math.floor(i * step).toInt())
      System.arraycopy(data.positions, src * 3, out.positions, i * 3, 3)
      System.arraycopy(data.scales, src * 3, out.scales, i * 3, 3)
      System.arraycopy(data.colors, src * 4, out.colors, i * 4, 4)
      System.arraycopy(data.rotations, src * 4, out.rotations, i * 4, 4)
      if (shValsPerSplat > 0 && data.sh != null && out.sh != null) {
        System.arraycopy(data.sh, src * shValsPerSplat, out.sh, i * shValsPerSplat, shValsPerSplat)
      }
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
    if (
      lastCameraWorld.size < 16 ||
        cameraWorld.size < 16 ||
        lastNodeWorld.size < 16 ||
        nodeWorld.size < 16
    ) {
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
    val nDot =
      axisDot(lastNodeWorld, nodeWorld, 0) * 0.5 + axisDot(lastNodeWorld, nodeWorld, 8) * 0.5
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
   * Builds camera-facing billboard quads in world space for [data] in back-to-front [order]. Each
   * splat is sized to `1.5 * max(scale.x, scale.y, scale.z) * maxAxisScale(nodeWorld)` (matching
   * the web `3.0 * radius` diameter) and oriented along the camera's right and up axes.
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
    val sx =
      Math.sqrt(
        nodeWorld[0] * nodeWorld[0] + nodeWorld[1] * nodeWorld[1] + nodeWorld[2] * nodeWorld[2]
      )
    val sy =
      Math.sqrt(
        nodeWorld[4] * nodeWorld[4] + nodeWorld[5] * nodeWorld[5] + nodeWorld[6] * nodeWorld[6]
      )
    val sz =
      Math.sqrt(
        nodeWorld[8] * nodeWorld[8] + nodeWorld[9] * nodeWorld[9] + nodeWorld[10] * nodeWorld[10]
      )
    val nodeScale = maxOf(sx, sy, sz, 1e-6).toFloat()
    val rx = cameraWorld[0]
    val ry = cameraWorld[1]
    val rz = cameraWorld[2]
    val ux = cameraWorld[4]
    val uy = cameraWorld[5]
    val uz = cameraWorld[6]
    val camX = cameraWorld[12]
    val camY = cameraWorld[13]
    val camZ = cameraWorld[14]
    // Camera right & up transformed into local space via W^T = nodeWorld^T:
    val lrx = (nodeWorld[0] * rx + nodeWorld[1] * ry + nodeWorld[2] * rz).toFloat()
    val lry = (nodeWorld[4] * rx + nodeWorld[5] * ry + nodeWorld[6] * rz).toFloat()
    val lrz = (nodeWorld[8] * rx + nodeWorld[9] * ry + nodeWorld[10] * rz).toFloat()
    val lux = (nodeWorld[0] * ux + nodeWorld[1] * uy + nodeWorld[2] * uz).toFloat()
    val luy = (nodeWorld[4] * ux + nodeWorld[5] * uy + nodeWorld[6] * uz).toFloat()
    val luz = (nodeWorld[8] * ux + nodeWorld[9] * uy + nodeWorld[10] * uz).toFloat()
    val cov6 = FloatArray(6)
    val hasSH = data.shDegree > 0 && data.sh != null

    for (k in 0 until n) {
      val s = order[k]
      if (s !in 0 until data.count) continue
      val lx = data.positions[s * 3].toDouble()
      val ly = data.positions[s * 3 + 1].toDouble()
      val lz = data.positions[s * 3 + 2].toDouble()
      val wx = (nodeWorld[0] * lx + nodeWorld[4] * ly + nodeWorld[8] * lz + nodeWorld[12]).toFloat()
      val wy = (nodeWorld[1] * lx + nodeWorld[5] * ly + nodeWorld[9] * lz + nodeWorld[13]).toFloat()
      val wz =
        (nodeWorld[2] * lx + nodeWorld[6] * ly + nodeWorld[10] * lz + nodeWorld[14]).toFloat()
      val scx = data.scales[s * 3]
      val scy = data.scales[s * 3 + 1]
      val scz = data.scales[s * 3 + 2]
      val drx: Float
      val dry: Float
      val drz: Float
      val dux: Float
      val duy: Float
      val duz: Float
      if (scx > 0f && scy > 0f && scz > 0f && (scx != scy || scy != scz)) {
        computeCovariance3D(data.scales, data.rotations, s, cov6, 0)
        val c00 = cov6[0]
        val c01 = cov6[1]
        val c02 = cov6[2]
        val c11 = cov6[3]
        val c12 = cov6[4]
        val c22 = cov6[5]
        val sr0 = c00 * lrx + c01 * lry + c02 * lrz
        val sr1 = c01 * lrx + c11 * lry + c12 * lrz
        val sr2 = c02 * lrx + c12 * lry + c22 * lrz
        val su0 = c00 * lux + c01 * luy + c02 * luz
        val su1 = c01 * lux + c11 * luy + c12 * luz
        val su2 = c02 * lux + c12 * luy + c22 * luz
        val a = (lrx * sr0 + lry * sr1 + lrz * sr2).toDouble()
        val b = (lrx * su0 + lry * su1 + lrz * su2).toDouble()
        val c = (lux * su0 + luy * su1 + luz * su2).toDouble()
        val mid = 0.5 * (a + c)
        val diff = 0.5 * (a - c)
        val disc = Math.hypot(diff, b)
        val l1 = Math.max(1e-8, mid + disc)
        val l2 = Math.max(1e-8, mid - disc)
        var ex = b
        var ey = l1 - a
        val eLen = Math.hypot(ex, ey)
        if (eLen > 1e-8) {
          ex /= eLen
          ey /= eLen
        } else {
          ex = if (a >= c) 1.0 else 0.0
          ey = if (a >= c) 0.0 else 1.0
        }
        val half1 = (Math.sqrt(l1) * 1.5).toFloat().coerceIn(0.001f, 10f)
        val half2 = (Math.sqrt(l2) * 1.5).toFloat().coerceIn(0.001f, 10f)
        val m1x = (rx * ex + ux * ey).toFloat()
        val m1y = (ry * ex + uy * ey).toFloat()
        val m1z = (rz * ex + uz * ey).toFloat()
        val m2x = (-rx * ey + ux * ex).toFloat()
        val m2y = (-ry * ey + uy * ex).toFloat()
        val m2z = (-rz * ey + uz * ex).toFloat()
        drx = m1x * half1
        dry = m1y * half1
        drz = m1z * half1
        dux = m2x * half2
        duy = m2y * half2
        duz = m2z * half2
      } else {
        val r0 = maxOf(scx, scy, scz)
        val half = (r0 * nodeScale * 1.5f).coerceIn(0.001f, 10f)
        drx = rx * half
        dry = ry * half
        drz = rz * half
        dux = ux * half
        duy = uy * half
        duz = uz * half
      }

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
      val c0: Byte
      val c1: Byte
      val c2: Byte
      if (hasSH) {
        val shRgb = evaluateSplatSH(data, s, wx - camX, wy - camY, wz - camZ)
        c0 = shRgb[0].toByte()
        c1 = shRgb[1].toByte()
        c2 = shRgb[2].toByte()
      } else {
        c0 = data.colors[s * 4]
        c1 = data.colors[s * 4 + 1]
        c2 = data.colors[s * 4 + 2]
      }
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
   * Builds a static local-space vertex buffer for GPU-billboarded splat rendering (`splat.mat`).
   * Each splat emits 4 vertices at its local center `(cx, cy, cz)`, with `uv0` set to the signed
   * local half-size `(-r, -r)`, `(+r, -r)`, `(+r, +r)`, `(-r, +r)` (expanded along camera right/up
   * in the vertex shader) and RGBA8 vertex colors. Only the index buffer needs to be updated when
   * the back-to-front depth sort changes; see [buildSortedSplatIndices].
   */
  @JvmStatic
  fun buildStaticGpuSplatVertices(data: SplatData): SplatQuadGeometry {
    val n = data.count
    val positions = FloatArray(n * 12)
    val uvs = FloatArray(n * 8)
    val colors = ByteArray(n * 16)
    val indices = IntArray(n * 6)
    val cov6 = FloatArray(6)
    for (s in 0 until n) {
      val lx = data.positions[s * 3]
      val ly = data.positions[s * 3 + 1]
      val lz = data.positions[s * 3 + 2]
      val scx = data.scales[s * 3]
      val scy = data.scales[s * 3 + 1]
      val scz = data.scales[s * 3 + 2]
      val halfX: Float
      val halfY: Float
      if (scx > 0f && scy > 0f && scz > 0f && (scx != scy || scy != scz)) {
        computeCovariance3D(data.scales, data.rotations, s, cov6, 0)
        halfX =
          (Math.sqrt(Math.max(1e-8, cov6[0].toDouble())) * 1.5).toFloat().coerceIn(0.001f, 10f)
        halfY =
          (Math.sqrt(Math.max(1e-8, cov6[3].toDouble())) * 1.5).toFloat().coerceIn(0.001f, 10f)
      } else {
        val r0 = maxOf(scx, scy, scz)
        val half = (r0 * 1.5f).coerceIn(0.001f, 10f)
        halfX = half
        halfY = half
      }

      val po = s * 12
      for (v in 0 until 4) {
        positions[po + v * 3] = lx
        positions[po + v * 3 + 1] = ly
        positions[po + v * 3 + 2] = lz
      }

      val uo = s * 8
      uvs[uo] = -halfX
      uvs[uo + 1] = -halfY
      uvs[uo + 2] = halfX
      uvs[uo + 3] = -halfY
      uvs[uo + 4] = halfX
      uvs[uo + 5] = halfY
      uvs[uo + 6] = -halfX
      uvs[uo + 7] = halfY

      val co = s * 16
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

      val vo = s * 4
      val io = s * 6
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
   * Builds the `6 * count` triangle indices referencing the static 4-vertex-per-splat buffer from
   * [buildStaticGpuSplatVertices] in back-to-front [order].
   */
  @JvmStatic
  @JvmOverloads
  fun buildSortedSplatIndices(
    order: IntArray,
    count: Int = order.size,
    out: IntArray = IntArray(count * 6),
  ): IntArray {
    val n = minOf(count, order.size)
    require(out.size >= n * 6) { "buildSortedSplatIndices: out buffer too small" }
    for (k in 0 until n) {
      val vo = order[k] * 4
      val io = k * 6
      out[io] = vo
      out[io + 1] = vo + 1
      out[io + 2] = vo + 2
      out[io + 3] = vo
      out[io + 4] = vo + 2
      out[io + 5] = vo + 3
    }
    return out
  }

  /**
   * Generates a `[size] x [size]` RGBA8 radial Gaussian falloff texture (`RGB = 255`, `A =
   * round(255 * exp(-4 * r^2))` for `r <= 1`, `0` outside) matching the web fragment shader.
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
        val a =
          if (r2 > 1.0) 0 else Math.round(255.0 * Math.exp(-4.0 * r2)).toInt().coerceIn(0, 255)
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
