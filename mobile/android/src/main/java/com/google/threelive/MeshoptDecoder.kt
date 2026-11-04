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

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Pure-Kotlin decoder, encoder, and post-decompression filter for glTF 2.0
 * `EXT_meshopt_compression` (`ATTRIBUTES`, `TRIANGLES`, `INDICES` modes and `NONE`, `OCTAHEDRAL`,
 * `QUATERNION`, `EXPONENTIAL` filters).
 */
object MeshoptDecoder {
  const val MAX_MESHOPT_BUFFER_BYTES: Int = 64 * 1024 * 1024
  const val MAX_MESHOPT_COUNT: Int = 16 * 1024 * 1024

  @JvmStatic
  @JvmOverloads
  fun decodeBuffer(
    src: ByteArray,
    count: Int,
    byteStride: Int,
    mode: String,
    filter: String = "NONE",
  ): ByteArray {
    require(count in 0..MAX_MESHOPT_COUNT) {
      "SecurityError: EXT_meshopt_compression invalid count: $count"
    }
    require(byteStride in 1..256) {
      "SecurityError: EXT_meshopt_compression invalid byteStride: $byteStride"
    }
    val byteLengthLong = count.toLong() * byteStride.toLong()
    require(byteLengthLong <= MAX_MESHOPT_BUFFER_BYTES.toLong()) {
      "SecurityError: EXT_meshopt_compression output exceeds 64 MiB limit ($byteLengthLong)"
    }
    val dst = ByteArray(byteLengthLong.toInt())
    if (count == 0) return dst

    val header = if (src.isNotEmpty()) src[0].toInt() and 0xff else 0
    val prefix = header and 0xf0

    if ((mode == "TRIANGLES" || mode == "INDICES") && (prefix == 0xb0 || prefix == 0xc0)) {
      decodeIndexSequence(src, dst, count, byteStride)
    } else if (src.isNotEmpty() && prefix == 0xa0) {
      var pos = 1
      for (col in 0 until byteStride) {
        var prev = 0
        var i = 0
        while (i < count) {
          val groupCount = minOf(16, count - i)
          val groupHeader = if (pos < src.size) src[pos++].toInt() and 0xff else 0
          for (g in 0 until groupCount) {
            val code = (groupHeader ushr ((g and 3) * 2)) and 3
            val zz: Int
            when (code) {
              0 -> zz = 0
              1 -> {
                val nibbleByte = if (pos < src.size) src[pos].toInt() and 0xff else 0
                if ((g and 1) == 0) {
                  zz = nibbleByte and 0x0f
                } else {
                  zz = (nibbleByte ushr 4) and 0x0f
                  pos++
                }
              }
              else -> {
                zz = if (pos < src.size) src[pos++].toInt() and 0xff else 0
              }
            }
            val delta = (zz ushr 1) xor -(zz and 1)
            prev = (prev + delta) and 0xff
            dst[(i + g) * byteStride + col] = prev.toByte()
          }
          i += 16
        }
      }
    } else if (src.size >= dst.size) {
      System.arraycopy(src, 0, dst, 0, dst.size)
    } else if (mode == "TRIANGLES" && prefix == 0xe0) {
      decodeIndexBlock(src, dst, count, byteStride)
    } else {
      System.arraycopy(src, 0, dst, 0, minOf(src.size, dst.size))
    }

    if (filter.isNotEmpty() && filter != "NONE") {
      applyFilter(dst, count, byteStride, filter)
    }
    return dst
  }

  @JvmStatic
  fun encodeBuffer(raw: ByteArray, count: Int, byteStride: Int, mode: String): ByteArray {
    if (mode == "TRIANGLES" || mode == "INDICES") {
      require(byteStride == 2 || byteStride == 4) {
        "EXT_meshopt_compression: $mode byteStride must be 2 or 4 (got $byteStride)"
      }
      val dv = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN)
      val out = ArrayList<Byte>(count * byteStride + 16)
      out.add((if (mode == "TRIANGLES") 0xb0 else 0xc0).toByte())
      var last = 0
      for (i in 0 until count) {
        val cur =
          if (byteStride == 2) {
            dv.getShort(i * 2).toInt() and 0xffff
          } else {
            dv.getInt(i * 4)
          }
        val delta = cur - last
        last = cur
        var zz = (delta shl 1) xor (delta shr 31)
        while ((zz and -0x80) != 0) {
          out.add(((zz and 0x7f) or 0x80).toByte())
          zz = zz ushr 7
        }
        out.add((zz and 0x7f).toByte())
      }
      val res = ByteArray(out.size)
      for (idx in out.indices) {
        res[idx] = out[idx]
      }
      return res
    }
    val out = ArrayList<Byte>(count * byteStride + 16)
    out.add(0xa0.toByte())
    for (col in 0 until byteStride) {
      var prev = 0
      var i = 0
      while (i < count) {
        val groupCount = minOf(16, count - i)
        val zzVals = IntArray(groupCount)
        var maxZz = 0
        for (g in 0 until groupCount) {
          val v = raw[(i + g) * byteStride + col].toInt() and 0xff
          val d = ((v - prev) shl 24) shr 24
          prev = v
          val zz = ((d shl 1) xor (d shr 31)) and 0xff
          zzVals[g] = zz
          if (zz > maxZz) maxZz = zz
        }
        val code = if (maxZz == 0) 0 else 2
        var header = 0
        for (g in 0 until 4) {
          header = header or (code shl (g * 2))
        }
        out.add(header.toByte())
        if (code == 2) {
          for (g in 0 until groupCount) {
            out.add(zzVals[g].toByte())
          }
        }
        i += 16
      }
    }
    val res = ByteArray(out.size)
    for (idx in out.indices) {
      res[idx] = out[idx]
    }
    return res
  }

  @JvmStatic
  fun applyFilter(buf: ByteArray, count: Int, byteStride: Int, filter: String) {
    if (filter == "NONE" || count <= 0) return
    val dv = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)

    when (filter) {
      "OCTAHEDRAL" -> {
        if (byteStride != 4 && byteStride != 8) return
        val isInt16 = byteStride == 8
        val maxVal = if (isInt16) 32767.0f else 127.0f
        for (i in 0 until count) {
          val off = i * byteStride
          var x: Float
          var y: Float
          val z: Float
          val w: Float
          if (isInt16) {
            x = dv.getShort(off).toFloat()
            y = dv.getShort(off + 2).toFloat()
            z = dv.getShort(off + 4).toFloat()
            w = dv.getShort(off + 6).toFloat()
          } else {
            x = dv.get(off).toFloat()
            y = dv.get(off + 1).toFloat()
            z = dv.get(off + 2).toFloat()
            w = dv.get(off + 3).toFloat()
          }
          val denom = if (z != 0.0f) z else 1.0f
          x /= denom
          y /= denom
          var nz = 1.0f - abs(x) - abs(y)
          val t = max(-nz, 0.0f)
          x -= if (x >= 0.0f) t else -t
          y -= if (y >= 0.0f) t else -t
          val len = sqrt(x * x + y * y + nz * nz)
          val invLen = if (len > 1e-8f) maxVal / len else 0.0f
          val rx = (x * invLen).roundToInt().coerceIn((-maxVal).toInt(), maxVal.toInt())
          val ry = (y * invLen).roundToInt().coerceIn((-maxVal).toInt(), maxVal.toInt())
          val rz = (nz * invLen).roundToInt().coerceIn((-maxVal).toInt(), maxVal.toInt())
          val rw = w.roundToInt().coerceIn((-maxVal).toInt(), maxVal.toInt())
          if (isInt16) {
            dv.putShort(off, rx.toShort())
            dv.putShort(off + 2, ry.toShort())
            dv.putShort(off + 4, rz.toShort())
            dv.putShort(off + 6, rw.toShort())
          } else {
            dv.put(off, rx.toByte())
            dv.put(off + 1, ry.toByte())
            dv.put(off + 2, rz.toByte())
            dv.put(off + 3, rw.toByte())
          }
        }
      }
      "QUATERNION" -> {
        if (byteStride != 8) return
        val scale = 1.0f / sqrt(2.0f)
        for (i in 0 until count) {
          val off = i * 8
          val a = dv.getShort(off).toInt()
          val b = dv.getShort(off + 2).toInt()
          val c = dv.getShort(off + 4).toInt()
          val d = dv.getShort(off + 6).toInt()
          val maxComp = d and 3
          val sf = scale / (if ((d or 3) != 0) (d or 3).toFloat() else 32767.0f)
          val x = a * sf
          val y = b * sf
          val z = c * sf
          val wSq = max(0.0f, 1.0f - x * x - y * y - z * z)
          val w = sqrt(wSq)
          val qx: Float
          val qy: Float
          val qz: Float
          val qw: Float
          when (maxComp) {
            0 -> {
              qx = w
              qy = x
              qz = y
              qw = z
            }
            1 -> {
              qx = x
              qy = w
              qz = y
              qw = z
            }
            2 -> {
              qx = x
              qy = y
              qz = w
              qw = z
            }
            else -> {
              qx = x
              qy = y
              qz = z
              qw = w
            }
          }
          dv.putShort(off, (qx * 32767.0f).roundToInt().coerceIn(-32767, 32767).toShort())
          dv.putShort(off + 2, (qy * 32767.0f).roundToInt().coerceIn(-32767, 32767).toShort())
          dv.putShort(off + 4, (qz * 32767.0f).roundToInt().coerceIn(-32767, 32767).toShort())
          dv.putShort(off + 6, (qw * 32767.0f).roundToInt().coerceIn(-32767, 32767).toShort())
        }
      }
      "EXPONENTIAL" -> {
        if (byteStride % 4 != 0) return
        val numWords = (count * byteStride) ushr 2
        for (i in 0 until numWords) {
          val off = i * 4
          val v = dv.getInt(off)
          val exp = v shr 24
          val mant = (v shl 8) shr 8
          val f = 2.0.pow(exp.toDouble()).toFloat() * mant.toFloat()
          dv.putFloat(off, f)
        }
      }
    }
  }

  private fun decodeIndexBlock(src: ByteArray, dst: ByteArray, count: Int, byteStride: Int) {
    val rawLen = minOf(src.size - 1, count * byteStride)
    if (rawLen > 0) {
      System.arraycopy(src, 1, dst, 0, rawLen)
    }
  }

  private fun decodeIndexSequence(src: ByteArray, dst: ByteArray, count: Int, byteStride: Int) {
    var pos = 1
    var prev = 0
    val dv = ByteBuffer.wrap(dst).order(ByteOrder.LITTLE_ENDIAN)
    for (i in 0 until count) {
      var v = 0
      var shift = 0
      while (pos < src.size) {
        val b = src[pos++].toInt() and 0xff
        v = v or ((b and 0x7f) shl shift)
        if ((b and 0x80) == 0) break
        shift += 7
        require(shift <= 28) { "EXT_meshopt_compression: varint overflow in index stream" }
      }
      val delta = (v ushr 1) xor -(v and 1)
      prev += delta
      if (byteStride == 4) {
        dv.putInt(i * 4, prev)
      } else {
        dv.putShort(i * 2, prev.toShort())
      }
    }
  }
}
