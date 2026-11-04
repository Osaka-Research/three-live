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
import kotlin.math.sqrt

/**
 * Pure-Kotlin, spec-compliant decoder for glTF 2.0 `EXT_meshopt_compression` and
 * `KHR_meshopt_compression`, ported from the reference meshoptimizer scalar implementation: vertex
 * codec v0/v1 (`ATTRIBUTES`), index buffer codec v0/v1 (`TRIANGLES`), index sequence codec
 * (`INDICES`), and the `OCTAHEDRAL`, `QUATERNION`, `EXPONENTIAL` and `COLOR` filters with
 * float32-exact rounding. Malformed input throws [IllegalArgumentException].
 *
 * [encodeBuffer] emits simple spec streams (vertex v0, index v1, sequence) for tests and interop;
 * use gltfpack for production assets.
 */
object MeshoptDecoder {
  const val MAX_MESHOPT_BUFFER_BYTES: Int = 64 * 1024 * 1024
  const val MAX_MESHOPT_COUNT: Int = 16 * 1024 * 1024

  private const val VERTEX_HEADER = 0xa0
  private const val INDEX_HEADER = 0xe0
  private const val SEQUENCE_HEADER = 0xd0
  private const val GROUP = 16
  private const val GROUP_DECODE_LIMIT = 24
  private const val TAIL_MIN_V0 = 32
  private const val TAIL_MIN_V1 = 24
  private val BITS_V0 = intArrayOf(0, 2, 4, 8)
  private val BITS_V1 = intArrayOf(0, 1, 2, 4, 8)

  private fun fail(msg: String): Nothing =
    throw IllegalArgumentException("EXT_meshopt_compression: $msg")

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
    checkFilter(filter)
    val dst = ByteArray(byteLengthLong.toInt())
    if (count == 0) return dst
    when (mode) {
      "ATTRIBUTES" -> {
        decodeVertexBuffer(src, count, byteStride, dst)
        applyFilter(dst, count, byteStride, filter)
      }
      "TRIANGLES",
      "INDICES" -> {
        if (byteStride != 2 && byteStride != 4) {
          fail("$mode byteStride must be 2 or 4 (got $byteStride)")
        }
        if (filter.isNotEmpty() && filter != "NONE")
          fail("filter $filter is only valid for ATTRIBUTES")
        val write: (Int, Long) -> Unit =
          if (byteStride == 2) {
            { i, v ->
              dst[i * 2] = v.toByte()
              dst[i * 2 + 1] = (v shr 8).toByte()
            }
          } else {
            { i, v -> for (b in 0 until 4) dst[i * 4 + b] = (v shr (8 * b)).toByte() }
          }
        if (mode == "TRIANGLES") decodeIndexBuffer(src, count, write)
        else decodeIndexSequence(src, count, write)
      }
      else -> fail("unknown mode \"$mode\"")
    }
    return dst
  }

  private fun checkFilter(filter: String) {
    if (
      filter.isNotEmpty() &&
        filter !in setOf("NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL", "COLOR")
    ) {
      fail("unknown filter \"$filter\"")
    }
  }

  private fun u8(a: ByteArray, i: Int): Int = a[i].toInt() and 0xff

  // --- Vertex codec ---------------------------------------------------------------------------

  private fun vertexBlockSize(stride: Int): Int {
    val r = (8192 / stride) and (GROUP - 1).inv()
    return if (r < 256) r else 256
  }

  private fun decodeBytesGroup(
    src: ByteArray,
    pos: Int,
    out: ByteArray,
    outPos: Int,
    bits: Int,
  ): Int {
    when (bits) {
      0 -> {
        out.fill(0, outPos, outPos + GROUP)
        return pos
      }
      8 -> {
        System.arraycopy(src, pos, out, outPos, GROUP)
        return pos + GROUP
      }
    }
    val sentinel = (1 shl bits) - 1
    val perByte = 8 / bits
    var varPos = pos + GROUP * bits / 8
    for (i in 0 until GROUP) {
      val byte = u8(src, pos + i / perByte)
      val slot = i % perByte
      val enc =
        if (bits == 1) (byte shr slot) and 1 else (byte shr (8 - bits - slot * bits)) and sentinel
      out[outPos + i] = if (enc == sentinel) src[varPos++] else enc.toByte()
    }
    return varPos
  }

  private fun decodeBytes(
    src: ByteArray,
    start: Int,
    out: ByteArray,
    outPos: Int,
    size: Int,
    bits: IntArray,
    bitsOffset: Int,
  ): Int {
    val end = src.size
    val groups = size / GROUP
    val headerSize = (groups + 3) shr 2
    if (end - start < headerSize) fail("truncated ATTRIBUTES stream")
    var pos = start + headerSize
    for (g in 0 until groups) {
      if (end - pos < GROUP_DECODE_LIMIT) fail("truncated ATTRIBUTES stream")
      val bitsk = (u8(src, start + (g shr 2)) shr ((g and 3) * 2)) and 3
      pos = decodeBytesGroup(src, pos, out, outPos + g * GROUP, bits[bitsOffset + bitsk])
    }
    return pos
  }

  private fun decodeVertexBuffer(src: ByteArray, count: Int, stride: Int, out: ByteArray) {
    if (stride % 4 != 0) fail("ATTRIBUTES byteStride must be a multiple of 4 (got $stride)")
    val end = src.size
    if (end < 1) fail("truncated ATTRIBUTES stream")
    val header = u8(src, 0)
    if ((header and 0xf0) != VERTEX_HEADER) {
      fail("unsupported ATTRIBUTES header 0x${header.toString(16)}")
    }
    val version = header and 0x0f
    if (version > 1) fail("unsupported ATTRIBUTES codec version $version")
    val tailSize = stride + if (version == 0) 0 else stride / 4
    val tailMin = if (version == 0) TAIL_MIN_V0 else TAIL_MIN_V1
    val tailPad = maxOf(tailSize, tailMin)
    if (end - 1 < tailPad) fail("truncated ATTRIBUTES stream")
    val tail = end - tailSize
    val last = src.copyOfRange(tail, tail + stride)
    val channelsPos = tail + stride
    val blockSize = vertexBlockSize(stride)
    val scratch = ByteArray(256 * 4)
    var pos = 1
    var vertexOffset = 0
    while (vertexOffset < count) {
      val vc = minOf(blockSize, count - vertexOffset)
      val aligned = (vc + GROUP - 1) and (GROUP - 1).inv()
      val controlSize = if (version == 0) 0 else stride / 4
      if (end - pos < controlSize) fail("truncated ATTRIBUTES stream")
      val controlPos = pos
      pos += controlSize
      var k = 0
      while (k < stride) {
        val ctrlByte = if (version == 0) 0 else u8(src, controlPos + k / 4)
        for (j in 0 until 4) {
          val ctrl = (ctrlByte shr (j * 2)) and 3
          when (ctrl) {
            3 -> {
              if (end - pos < vc) fail("truncated ATTRIBUTES stream")
              System.arraycopy(src, pos, scratch, j * vc, vc)
              pos += vc
            }
            2 -> scratch.fill(0, j * vc, j * vc + vc)
            else ->
              pos =
                if (version == 0) decodeBytes(src, pos, scratch, j * vc, aligned, BITS_V0, 0)
                else decodeBytes(src, pos, scratch, j * vc, aligned, BITS_V1, ctrl)
          }
        }
        val channel = if (version == 0) 0 else u8(src, channelsPos + k / 4)
        when (channel and 3) {
          0 ->
            for (j in 0 until 4) {
              var p = last[k + j].toInt() and 0xff
              for (i in 0 until vc) {
                val v = u8(scratch, j * vc + i)
                p = (((v ushr 1) xor -(v and 1)) + p) and 0xff
                out[(vertexOffset + i) * stride + k + j] = p.toByte()
              }
            }
          1 -> {
            var h = 0
            while (h < 4) {
              var p = u8(last, k + h) or (u8(last, k + h + 1) shl 8)
              val b0 = h * vc
              for (i in 0 until vc) {
                val v = u8(scratch, b0 + i) or (u8(scratch, b0 + vc + i) shl 8)
                p = (((v ushr 1) xor -(v and 1)) + p) and 0xffff
                val o = (vertexOffset + i) * stride + k + h
                out[o] = p.toByte()
                out[o + 1] = (p shr 8).toByte()
              }
              h += 2
            }
          }
          2 -> {
            val rot = (32 - (channel shr 4)) and 31
            var p =
              u8(last, k) or
                (u8(last, k + 1) shl 8) or
                (u8(last, k + 2) shl 16) or
                (u8(last, k + 3) shl 24)
            for (i in 0 until vc) {
              var v =
                u8(scratch, i) or
                  (u8(scratch, vc + i) shl 8) or
                  (u8(scratch, 2 * vc + i) shl 16) or
                  (u8(scratch, 3 * vc + i) shl 24)
              v = Integer.rotateLeft(v, rot) xor p
              p = v
              val o = (vertexOffset + i) * stride + k
              for (b in 0 until 4) out[o + b] = (v ushr (8 * b)).toByte()
            }
          }
          else -> fail("invalid ATTRIBUTES channel $channel")
        }
        k += 4
      }
      System.arraycopy(out, (vertexOffset + vc - 1) * stride, last, 0, stride)
      vertexOffset += vc
    }
    if (end - pos != tailPad) fail("ATTRIBUTES trailing data")
  }

  // --- Index codecs ---------------------------------------------------------------------------

  private class Cursor(var pos: Int)

  private fun readVByte(src: ByteArray, c: Cursor): Long {
    val lead = if (c.pos < src.size) u8(src, c.pos) else 0
    c.pos++
    if (lead < 128) return lead.toLong()
    var result = (lead and 127).toLong()
    var shift = 7
    for (i in 0 until 4) {
      val group = if (c.pos < src.size) u8(src, c.pos) else 0
      c.pos++
      result = result or ((group and 127).toLong() shl shift)
      shift += 7
      if (group < 128) break
    }
    return result and 0xffffffffL
  }

  private fun decodeDelta(src: ByteArray, c: Cursor, last: Long): Long {
    val v = readVByte(src, c)
    val d = (v ushr 1) xor -(v and 1)
    return (last + d) and 0xffffffffL
  }

  private fun decodeIndexBuffer(src: ByteArray, count: Int, write: (Int, Long) -> Unit) {
    if (count % 3 != 0) fail("TRIANGLES count must be divisible by 3 (got $count)")
    val triCount = count / 3
    if (src.size < 1 + triCount + 16) fail("truncated TRIANGLES stream")
    val header = u8(src, 0)
    if ((header and 0xf0) != INDEX_HEADER)
      fail("unsupported TRIANGLES header 0x${header.toString(16)}")
    val version = header and 0x0f
    if (version > 1) fail("unsupported TRIANGLES codec version $version")
    val e0 = LongArray(16) { 0xffffffffL }
    val e1 = LongArray(16) { 0xffffffffL }
    val vf = LongArray(16) { 0xffffffffL }
    var eo = 0
    var vo = 0
    fun pushEdge(a: Long, b: Long) {
      e0[eo] = a
      e1[eo] = b
      eo = (eo + 1) and 15
    }
    fun pushVert(v: Long, cond: Int = 1) {
      vf[vo] = v
      vo = (vo + cond) and 15
    }
    var next = 0L
    var last = 0L
    val fecmax = if (version >= 1) 13 else 15
    val codeEnd = 1 + triCount
    val safeEnd = src.size - 16
    val c = Cursor(codeEnd)
    var out = 0
    fun tri(a: Long, b: Long, cc: Long) {
      write(out++, a)
      write(out++, b)
      write(out++, cc)
    }
    for (code in 1 until codeEnd) {
      val codetri = u8(src, code)
      if (codetri < 0xf0) {
        val ei = (eo - 1 - (codetri shr 4)) and 15
        val a = e0[ei]
        val b = e1[ei]
        val fec = codetri and 15
        val cv: Long
        if (fec < fecmax) {
          val cf = vf[(vo - 1 - fec) and 15]
          cv = if (fec == 0) next else cf
          val fec0 = if (fec == 0) 1 else 0
          next = (next + fec0) and 0xffffffffL
          pushVert(cv, fec0)
        } else {
          if (c.pos > safeEnd) fail("truncated TRIANGLES stream")
          cv = if (fec != 15) (last + (fec * 2 - 27)) and 0xffffffffL else decodeDelta(src, c, last)
          last = cv
          pushVert(cv)
        }
        pushEdge(cv, b)
        pushEdge(a, cv)
        tri(a, b, cv)
      } else if (codetri < 0xfe) {
        val aux = u8(src, safeEnd + (codetri and 15))
        val feb = aux shr 4
        val fec = aux and 15
        val a = next
        next = (next + 1) and 0xffffffffL
        val b = if (feb == 0) next else vf[(vo - feb) and 15]
        val feb0 = if (feb == 0) 1 else 0
        next = (next + feb0) and 0xffffffffL
        val cv = if (fec == 0) next else vf[(vo - fec) and 15]
        val fec0 = if (fec == 0) 1 else 0
        next = (next + fec0) and 0xffffffffL
        tri(a, b, cv)
        pushVert(a)
        pushVert(b, feb0)
        pushVert(cv, fec0)
        pushEdge(b, a)
        pushEdge(cv, b)
        pushEdge(a, cv)
      } else {
        if (c.pos > safeEnd) fail("truncated TRIANGLES stream")
        val aux = u8(src, c.pos++)
        val fea = if (codetri == 0xfe) 0 else 15
        val feb = aux shr 4
        val fec = aux and 15
        if (aux == 0) next = 0
        var a = 0L
        if (fea == 0) {
          a = next
          next = (next + 1) and 0xffffffffL
        }
        var b: Long
        if (feb == 0) {
          b = next
          next = (next + 1) and 0xffffffffL
        } else {
          b = vf[(vo - feb) and 15]
        }
        var cv: Long
        if (fec == 0) {
          cv = next
          next = (next + 1) and 0xffffffffL
        } else {
          cv = vf[(vo - fec) and 15]
        }
        if (fea == 15) {
          a = decodeDelta(src, c, last)
          last = a
        }
        if (feb == 15) {
          b = decodeDelta(src, c, last)
          last = b
        }
        if (fec == 15) {
          cv = decodeDelta(src, c, last)
          last = cv
        }
        tri(a, b, cv)
        pushVert(a)
        pushVert(b, if (feb == 0 || feb == 15) 1 else 0)
        pushVert(cv, if (fec == 0 || fec == 15) 1 else 0)
        pushEdge(b, a)
        pushEdge(cv, b)
        pushEdge(a, cv)
      }
    }
    if (c.pos != safeEnd) fail("TRIANGLES trailing data")
  }

  private fun decodeIndexSequence(src: ByteArray, count: Int, write: (Int, Long) -> Unit) {
    if (src.size < 1 + count + 4) fail("truncated INDICES stream")
    val header = u8(src, 0)
    if ((header and 0xf0) != SEQUENCE_HEADER)
      fail("unsupported INDICES header 0x${header.toString(16)}")
    if ((header and 0x0f) > 1) fail("unsupported INDICES codec version ${header and 0x0f}")
    val safeEnd = src.size - 4
    val last = LongArray(2)
    val c = Cursor(1)
    for (i in 0 until count) {
      if (c.pos >= safeEnd) fail("truncated INDICES stream")
      var v = readVByte(src, c)
      val current = (v and 1).toInt()
      v = v ushr 1
      val d = (v ushr 1) xor -(v and 1)
      val index = (last[current] + d) and 0xffffffffL
      last[current] = index
      write(i, index)
    }
    if (c.pos != safeEnd) fail("INDICES trailing data")
  }

  // --- Encoder --------------------------------------------------------------------------------

  private fun zigzag8(d: Int): Int {
    val s = (d shl 24) shr 24
    return ((s shl 1) xor (s shr 7)) and 0xff
  }

  private fun pushVByte(out: ArrayList<Byte>, value: Long) {
    var v = value and 0xffffffffL
    do {
      out.add(((v and 127) or (if (v > 127) 128L else 0L)).toByte())
      v = v ushr 7
    } while (v != 0L)
  }

  private fun zigzag32(d: Int): Long = (((d shl 1) xor (d shr 31)).toLong()) and 0xffffffffL

  @JvmStatic
  fun encodeBuffer(raw: ByteArray, count: Int, byteStride: Int, mode: String): ByteArray {
    require(raw.size >= count * byteStride) { "encodeBuffer: raw buffer too small" }
    val out = ArrayList<Byte>(count * byteStride + 64)
    if (mode == "ATTRIBUTES") {
      require(byteStride % 4 == 0 && byteStride <= 256) {
        "encodeBuffer: ATTRIBUTES byteStride must be a multiple of 4 and <= 256"
      }
      out.add(VERTEX_HEADER.toByte())
      val blockSize = vertexBlockSize(byteStride)
      val last = ByteArray(byteStride)
      if (count > 0) System.arraycopy(raw, 0, last, 0, byteStride)
      val baseline = last.copyOf()
      val deltas = IntArray(256)
      var vertexOffset = 0
      while (vertexOffset < count) {
        val vc = minOf(blockSize, count - vertexOffset)
        val aligned = (vc + 15) and 15.inv()
        for (k in 0 until byteStride) {
          deltas.fill(0)
          var p = last[k].toInt() and 0xff
          for (i in 0 until vc) {
            val cur = u8(raw, (vertexOffset + i) * byteStride + k)
            deltas[i] = zigzag8(cur - p)
            p = cur
          }
          last[k] = p.toByte()
          val groups = aligned / 16
          val headerPos = out.size
          repeat((groups + 3) shr 2) { out.add(0) }
          for (g in 0 until groups) {
            val base = g * 16
            var best = 3
            var bestSize = 16
            for (bk in 0 until 3) {
              val bits = BITS_V0[bk]
              val size =
                if (bits == 0) {
                  if ((0 until 16).all { deltas[base + it] == 0 }) 0 else Int.MAX_VALUE
                } else {
                  val sentinel = (1 shl bits) - 1
                  16 * bits / 8 + (0 until 16).count { deltas[base + it] >= sentinel }
                }
              if (size < bestSize) {
                bestSize = size
                best = bk
              }
            }
            val hp = headerPos + (g shr 2)
            out[hp] = ((out[hp].toInt() and 0xff) or (best shl ((g and 3) * 2))).toByte()
            val bits = BITS_V0[best]
            if (bits == 8) {
              for (i in 0 until 16) out.add(deltas[base + i].toByte())
            } else if (bits > 0) {
              val sentinel = (1 shl bits) - 1
              val perByte = 8 / bits
              val outliers = ArrayList<Byte>()
              var i = 0
              while (i < 16) {
                var byte = 0
                for (s in 0 until perByte) {
                  val d = deltas[base + i + s]
                  if (d >= sentinel) outliers.add(d.toByte())
                  byte = byte or (minOf(d, sentinel) shl (8 - bits - s * bits))
                }
                out.add(byte.toByte())
                i += perByte
              }
              out.addAll(outliers)
            }
          }
        }
        vertexOffset += vc
      }
      repeat(maxOf(0, TAIL_MIN_V0 - byteStride)) { out.add(0) }
      for (b in baseline) out.add(b)
      return out.toByteArray()
    }
    require(byteStride == 2 || byteStride == 4) {
      "EXT_meshopt_compression: $mode byteStride must be 2 or 4 (got $byteStride)"
    }
    val dv = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN)
    fun read(i: Int): Int =
      if (byteStride == 2) dv.getShort(i * 2).toInt() and 0xffff else dv.getInt(i * 4)
    when (mode) {
      "INDICES" -> {
        out.add((SEQUENCE_HEADER or 1).toByte())
        var last = 0
        for (i in 0 until count) {
          val cur = read(i)
          pushVByte(out, zigzag32(cur - last) shl 1)
          last = cur
        }
        repeat(4) { out.add(0) }
      }
      "TRIANGLES" -> {
        require(count % 3 == 0) { "encodeBuffer: TRIANGLES count must be divisible by 3" }
        out.add((INDEX_HEADER or 1).toByte())
        repeat(count / 3) { out.add(0xff.toByte()) }
        var last = 0
        for (t in 0 until count / 3) {
          out.add(0xff.toByte())
          for (c in 0 until 3) {
            val cur = read(t * 3 + c)
            pushVByte(out, zigzag32(cur - last))
            last = cur
          }
        }
        repeat(16) { out.add(0) }
      }
      else -> fail("unknown mode \"$mode\"")
    }
    return out.toByteArray()
  }

  // --- Filters --------------------------------------------------------------------------------

  private fun roundSigned(v: Float): Int = (v + (if (v >= 0f) 0.5f else -0.5f)).toInt()

  @JvmStatic
  fun applyFilter(buf: ByteArray, count: Int, byteStride: Int, filter: String) {
    checkFilter(filter)
    if (filter.isEmpty() || filter == "NONE" || count <= 0) return
    val dv = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
    when (filter) {
      "OCTAHEDRAL" -> {
        if (byteStride != 4 && byteStride != 8) fail("OCTAHEDRAL filter requires byteStride 4 or 8")
        val wide = byteStride == 8
        val max = if (wide) 32767f else 127f
        val cs = if (wide) 2 else 1
        fun get(o: Int): Float = if (wide) dv.getShort(o).toFloat() else dv.get(o).toFloat()
        fun set(o: Int, v: Int) {
          if (wide) dv.putShort(o, v.toShort()) else dv.put(o, v.toByte())
        }
        for (i in 0 until count) {
          val base = i * byteStride
          var x = get(base)
          var y = get(base + cs)
          val z = get(base + 2 * cs) - abs(x) - abs(y)
          val t = if (z >= 0f) 0f else z
          x += if (x >= 0f) t else -t
          y += if (y >= 0f) t else -t
          val l = sqrt(x * x + y * y + z * z)
          if (l == 0f) {
            // Degenerate (never emitted by encoders): decode to +Z instead of NaN.
            set(base, 0)
            set(base + cs, 0)
            set(base + 2 * cs, max.toInt())
            continue
          }
          val s = max / l
          set(base, roundSigned(x * s))
          set(base + cs, roundSigned(y * s))
          set(base + 2 * cs, roundSigned(z * s))
        }
      }
      "QUATERNION" -> {
        if (byteStride != 8) fail("QUATERNION filter requires byteStride 8")
        val scale = 32767f / sqrt(2f)
        for (i in 0 until count) {
          val base = i * 8
          val w3 = dv.getShort(base + 6).toInt()
          val s = (w3 or 3).toFloat()
          val x = dv.getShort(base).toFloat()
          val y = dv.getShort(base + 2).toFloat()
          val z = dv.getShort(base + 4).toFloat()
          val ws = s * s
          val ww = ws * 2f - x * x - y * y - z * z
          val w = sqrt(if (ww >= 0f) ww else 0f)
          val ss = scale / s
          val qc = w3 and 3
          val q = IntArray(4)
          q[(qc + 1) and 3] = roundSigned(x * ss)
          q[(qc + 2) and 3] = roundSigned(y * ss)
          q[(qc + 3) and 3] = roundSigned(z * ss)
          q[qc] = (w * ss + 0.5f).toInt()
          for (c in 0 until 4) dv.putShort(base + c * 2, q[c].toShort())
        }
      }
      "EXPONENTIAL" -> {
        if (byteStride < 4 || byteStride % 4 != 0)
          fail("EXPONENTIAL filter requires byteStride multiple of 4")
        for (i in 0 until (count * byteStride) / 4) {
          val v = dv.getInt(i * 4)
          val m = (v shl 8) shr 8
          val e = v shr 24
          val scale = java.lang.Float.intBitsToFloat((e + 127) shl 23)
          dv.putFloat(i * 4, scale * m.toFloat())
        }
      }
      "COLOR" -> {
        if (byteStride != 4 && byteStride != 8) fail("COLOR filter requires byteStride 4 or 8")
        val wide = byteStride == 8
        val max = if (wide) 65535f else 255f
        val cs = if (wide) 2 else 1
        fun getU(o: Int): Int =
          if (wide) dv.getShort(o).toInt() and 0xffff else dv.get(o).toInt() and 0xff
        fun getS(o: Int): Int = if (wide) dv.getShort(o).toInt() else dv.get(o).toInt()
        fun setU(o: Int, v: Int) {
          if (wide) dv.putShort(o, v.toShort()) else dv.put(o, v.toByte())
        }
        for (i in 0 until count) {
          val base = i * byteStride
          var aS = getU(base + 3 * cs)
          aS = aS or (aS shr 1)
          aS = aS or (aS shr 2)
          aS = aS or (aS shr 4)
          aS = aS or (aS shr 8)
          val yv = getU(base)
          val co = getS(base + cs)
          val cg = getS(base + 2 * cs)
          val r = yv + co - cg
          val g = yv + cg
          val b = yv - co - cg
          var a = getU(base + 3 * cs)
          a = ((a shl 1) and aS) or (a and 1)
          val ss = if (aS == 0) 0f else max / aS.toFloat()
          setU(base, (r.toFloat() * ss + 0.5f).toInt())
          setU(base + cs, (g.toFloat() * ss + 0.5f).toInt())
          setU(base + 2 * cs, (b.toFloat() * ss + 0.5f).toInt())
          setU(base + 3 * cs, (a.toFloat() * ss + 0.5f).toInt())
        }
      }
    }
  }
}
