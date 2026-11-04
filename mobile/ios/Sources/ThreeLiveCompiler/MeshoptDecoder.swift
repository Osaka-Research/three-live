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

import Foundation

/// Pure-Swift, spec-compliant decoder for glTF 2.0 `EXT_meshopt_compression` and
/// `KHR_meshopt_compression`, ported from the reference meshoptimizer scalar implementation:
/// vertex codec v0/v1 (`ATTRIBUTES`), index buffer codec v0/v1 (`TRIANGLES`), index sequence
/// codec (`INDICES`), and the `OCTAHEDRAL`, `QUATERNION`, `EXPONENTIAL` and `COLOR` filters with
/// float32-exact rounding. Malformed input throws.
///
/// `encodeBuffer` emits simple spec streams (vertex v0, index v1, sequence) for tests and
/// interop; use gltfpack for production assets.
public enum MeshoptDecoder {
  public static let maxMeshoptBufferBytes: Int = 64 * 1024 * 1024
  public static let maxMeshoptCount: Int = 16 * 1024 * 1024

  private static let vertexHeader = 0xa0
  private static let indexHeader = 0xe0
  private static let sequenceHeader = 0xd0
  private static let group = 16
  private static let groupDecodeLimit = 24
  private static let tailMinV0 = 32
  private static let tailMinV1 = 24
  private static let bitsV0 = [0, 2, 4, 8]
  private static let bitsV1 = [0, 1, 2, 4, 8]
  private static let knownFilters: Set<String> = [
    "", "NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL", "COLOR",
  ]

  private static func error(_ code: Int, _ message: String) -> NSError {
    NSError(
      domain: "MeshoptDecoder", code: code,
      userInfo: [NSLocalizedDescriptionKey: message])
  }

  private static func fail(_ message: String) -> NSError {
    error(4, "EXT_meshopt_compression: \(message)")
  }

  public static func decodeBuffer(
    _ src: Data,
    count: Int,
    byteStride: Int,
    mode: String,
    filter: String = "NONE"
  ) throws -> Data {
    guard count >= 0 && count <= maxMeshoptCount else {
      throw error(1, "SecurityError: EXT_meshopt_compression invalid count: \(count)")
    }
    guard byteStride >= 1 && byteStride <= 256 else {
      throw error(2, "SecurityError: EXT_meshopt_compression invalid byteStride: \(byteStride)")
    }
    let byteLength = count * byteStride
    guard byteLength <= maxMeshoptBufferBytes else {
      throw error(
        3, "SecurityError: EXT_meshopt_compression output exceeds 64 MiB limit (\(byteLength))")
    }
    guard knownFilters.contains(filter) else { throw fail("unknown filter \"\(filter)\"") }
    if count == 0 { return Data() }
    let s = [UInt8](src)
    var out = [UInt8](repeating: 0, count: byteLength)
    switch mode {
    case "ATTRIBUTES":
      try decodeVertexBuffer(s, count: count, stride: byteStride, out: &out)
      var data = Data(out)
      applyFilter(&data, count: count, byteStride: byteStride, filter: filter)
      return data
    case "TRIANGLES", "INDICES":
      guard byteStride == 2 || byteStride == 4 else {
        throw fail("\(mode) byteStride must be 2 or 4 (got \(byteStride))")
      }
      guard filter.isEmpty || filter == "NONE" else {
        throw fail("filter \(filter) is only valid for ATTRIBUTES")
      }
      var indices = [UInt32](repeating: 0, count: count)
      if mode == "TRIANGLES" {
        try decodeIndexBuffer(s, count: count, out: &indices)
      } else {
        try decodeIndexSequence(s, count: count, out: &indices)
      }
      for i in 0..<count {
        let v = indices[i]
        for b in 0..<byteStride {
          out[i * byteStride + b] = UInt8(truncatingIfNeeded: v >> (8 * b))
        }
      }
      return Data(out)
    default:
      throw fail("unknown mode \"\(mode)\"")
    }
  }

  // MARK: - Vertex codec

  private static func vertexBlockSize(_ stride: Int) -> Int {
    let r = (8192 / stride) & ~(group - 1)
    return r < 256 ? r : 256
  }

  private static func decodeBytesGroup(
    _ src: [UInt8], _ pos: Int, _ out: inout [UInt8], _ outPos: Int, _ bits: Int
  ) -> Int {
    if bits == 0 {
      for i in 0..<group { out[outPos + i] = 0 }
      return pos
    }
    if bits == 8 {
      for i in 0..<group { out[outPos + i] = src[pos + i] }
      return pos + group
    }
    let sentinel = (1 << bits) - 1
    let perByte = 8 / bits
    var varPos = pos + group * bits / 8
    for i in 0..<group {
      let byte = Int(src[pos + i / perByte])
      let slot = i % perByte
      let enc = bits == 1 ? (byte >> slot) & 1 : (byte >> (8 - bits - slot * bits)) & sentinel
      if enc == sentinel {
        out[outPos + i] = src[varPos]
        varPos += 1
      } else {
        out[outPos + i] = UInt8(enc)
      }
    }
    return varPos
  }

  private static func decodeBytes(
    _ src: [UInt8], _ start: Int, _ out: inout [UInt8], _ outPos: Int, _ size: Int,
    _ bits: [Int], _ bitsOffset: Int
  ) throws -> Int {
    let end = src.count
    let groups = size / group
    let headerSize = (groups + 3) >> 2
    guard end - start >= headerSize else { throw fail("truncated ATTRIBUTES stream") }
    var pos = start + headerSize
    for g in 0..<groups {
      guard end - pos >= groupDecodeLimit else { throw fail("truncated ATTRIBUTES stream") }
      let bitsk = (Int(src[start + (g >> 2)]) >> ((g & 3) * 2)) & 3
      pos = decodeBytesGroup(src, pos, &out, outPos + g * group, bits[bitsOffset + bitsk])
    }
    return pos
  }

  private static func decodeVertexBuffer(
    _ src: [UInt8], count: Int, stride: Int, out: inout [UInt8]
  ) throws {
    guard stride % 4 == 0 else {
      throw fail("ATTRIBUTES byteStride must be a multiple of 4 (got \(stride))")
    }
    let end = src.count
    guard end >= 1 else { throw fail("truncated ATTRIBUTES stream") }
    let header = Int(src[0])
    guard header & 0xf0 == vertexHeader else {
      throw fail("unsupported ATTRIBUTES header 0x\(String(header, radix: 16))")
    }
    let version = header & 0x0f
    guard version <= 1 else { throw fail("unsupported ATTRIBUTES codec version \(version)") }
    let tailSize = stride + (version == 0 ? 0 : stride / 4)
    let tailPad = max(tailSize, version == 0 ? tailMinV0 : tailMinV1)
    guard end - 1 >= tailPad else { throw fail("truncated ATTRIBUTES stream") }
    let tail = end - tailSize
    var last = Array(src[tail..<(tail + stride)])
    let channelsPos = tail + stride
    let blockSize = vertexBlockSize(stride)
    var scratch = [UInt8](repeating: 0, count: 256 * 4)
    var pos = 1
    var vertexOffset = 0
    while vertexOffset < count {
      let vc = min(blockSize, count - vertexOffset)
      let aligned = (vc + group - 1) & ~(group - 1)
      let controlSize = version == 0 ? 0 : stride / 4
      guard end - pos >= controlSize else { throw fail("truncated ATTRIBUTES stream") }
      let controlPos = pos
      pos += controlSize
      var k = 0
      while k < stride {
        let ctrlByte = version == 0 ? 0 : Int(src[controlPos + k / 4])
        for j in 0..<4 {
          let ctrl = (ctrlByte >> (j * 2)) & 3
          if ctrl == 3 {
            guard end - pos >= vc else { throw fail("truncated ATTRIBUTES stream") }
            for i in 0..<vc { scratch[j * vc + i] = src[pos + i] }
            pos += vc
          } else if ctrl == 2 {
            for i in 0..<vc { scratch[j * vc + i] = 0 }
          } else if version == 0 {
            pos = try decodeBytes(src, pos, &scratch, j * vc, aligned, bitsV0, 0)
          } else {
            pos = try decodeBytes(src, pos, &scratch, j * vc, aligned, bitsV1, ctrl)
          }
        }
        let channel = version == 0 ? 0 : Int(src[channelsPos + k / 4])
        switch channel & 3 {
        case 0:
          for j in 0..<4 {
            var p = Int(last[k + j])
            for i in 0..<vc {
              let v = Int(scratch[j * vc + i])
              p = (((v >> 1) ^ -(v & 1)) + p) & 0xff
              out[(vertexOffset + i) * stride + k + j] = UInt8(p)
            }
          }
        case 1:
          var h = 0
          while h < 4 {
            var p = Int(last[k + h]) | (Int(last[k + h + 1]) << 8)
            let b0 = h * vc
            for i in 0..<vc {
              let v = Int(scratch[b0 + i]) | (Int(scratch[b0 + vc + i]) << 8)
              p = (((v >> 1) ^ -(v & 1)) + p) & 0xffff
              let o = (vertexOffset + i) * stride + k + h
              out[o] = UInt8(p & 0xff)
              out[o + 1] = UInt8(p >> 8)
            }
            h += 2
          }
        case 2:
          let rot = UInt32((32 - (channel >> 4)) & 31)
          var p =
            UInt32(last[k]) | (UInt32(last[k + 1]) << 8) | (UInt32(last[k + 2]) << 16)
            | (UInt32(last[k + 3]) << 24)
          for i in 0..<vc {
            var v =
              UInt32(scratch[i]) | (UInt32(scratch[vc + i]) << 8)
              | (UInt32(scratch[2 * vc + i]) << 16) | (UInt32(scratch[3 * vc + i]) << 24)
            v = ((v << rot) | (v >> ((32 - rot) & 31))) ^ p
            p = v
            let o = (vertexOffset + i) * stride + k
            for b in 0..<4 { out[o + b] = UInt8(truncatingIfNeeded: v >> (8 * UInt32(b))) }
          }
        default:
          throw fail("invalid ATTRIBUTES channel \(channel)")
        }
        k += 4
      }
      let lastStart = (vertexOffset + vc - 1) * stride
      for b in 0..<stride { last[b] = out[lastStart + b] }
      vertexOffset += vc
    }
    guard end - pos == tailPad else { throw fail("ATTRIBUTES trailing data") }
  }

  // MARK: - Index codecs

  private static func readVByte(_ src: [UInt8], _ pos: inout Int) -> UInt32 {
    let lead = pos < src.count ? UInt32(src[pos]) : 0
    pos += 1
    if lead < 128 { return lead }
    var result = lead & 127
    var shift: UInt32 = 7
    for _ in 0..<4 {
      let g = pos < src.count ? UInt32(src[pos]) : 0
      pos += 1
      result |= (g & 127) << shift
      shift += 7
      if g < 128 { break }
    }
    return result
  }

  private static func decodeDelta(_ src: [UInt8], _ pos: inout Int, _ last: UInt32) -> UInt32 {
    let v = readVByte(src, &pos)
    let d = (v >> 1) ^ (0 &- (v & 1))
    return last &+ d
  }

  private static func decodeIndexBuffer(
    _ src: [UInt8], count: Int, out: inout [UInt32]
  ) throws {
    guard count % 3 == 0 else {
      throw fail("TRIANGLES count must be divisible by 3 (got \(count))")
    }
    let triCount = count / 3
    guard src.count >= 1 + triCount + 16 else { throw fail("truncated TRIANGLES stream") }
    let header = Int(src[0])
    guard header & 0xf0 == indexHeader else {
      throw fail("unsupported TRIANGLES header 0x\(String(header, radix: 16))")
    }
    let version = header & 0x0f
    guard version <= 1 else { throw fail("unsupported TRIANGLES codec version \(version)") }
    var e0 = [UInt32](repeating: .max, count: 16)
    var e1 = [UInt32](repeating: .max, count: 16)
    var vf = [UInt32](repeating: .max, count: 16)
    var eo = 0
    var vo = 0
    func pushEdge(_ a: UInt32, _ b: UInt32) {
      e0[eo] = a
      e1[eo] = b
      eo = (eo + 1) & 15
    }
    func pushVert(_ v: UInt32, _ cond: Int = 1) {
      vf[vo] = v
      vo = (vo + cond) & 15
    }
    var next: UInt32 = 0
    var last: UInt32 = 0
    let fecmax = version >= 1 ? 13 : 15
    let codeEnd = 1 + triCount
    let safeEnd = src.count - 16
    var pos = codeEnd
    var o = 0
    func tri(_ a: UInt32, _ b: UInt32, _ c: UInt32) {
      out[o] = a
      out[o + 1] = b
      out[o + 2] = c
      o += 3
    }
    for code in 1..<max(1, codeEnd) where code < codeEnd {
      let codetri = Int(src[code])
      if codetri < 0xf0 {
        let ei = (eo - 1 - (codetri >> 4)) & 15
        let a = e0[ei]
        let b = e1[ei]
        let fec = codetri & 15
        var c: UInt32
        if fec < fecmax {
          let cf = vf[(vo - 1 - fec) & 15]
          c = fec == 0 ? next : cf
          let fec0 = fec == 0 ? 1 : 0
          next &+= UInt32(fec0)
          pushVert(c, fec0)
        } else {
          guard pos <= safeEnd else { throw fail("truncated TRIANGLES stream") }
          c =
            fec != 15
            ? last &+ UInt32(bitPattern: Int32(fec * 2 - 27)) : decodeDelta(src, &pos, last)
          last = c
          pushVert(c)
        }
        pushEdge(c, b)
        pushEdge(a, c)
        tri(a, b, c)
      } else if codetri < 0xfe {
        let aux = Int(src[safeEnd + (codetri & 15)])
        let feb = aux >> 4
        let fec = aux & 15
        let a = next
        next &+= 1
        let b = feb == 0 ? next : vf[(vo - feb) & 15]
        let feb0 = feb == 0 ? 1 : 0
        next &+= UInt32(feb0)
        let c = fec == 0 ? next : vf[(vo - fec) & 15]
        let fec0 = fec == 0 ? 1 : 0
        next &+= UInt32(fec0)
        tri(a, b, c)
        pushVert(a)
        pushVert(b, feb0)
        pushVert(c, fec0)
        pushEdge(b, a)
        pushEdge(c, b)
        pushEdge(a, c)
      } else {
        guard pos <= safeEnd else { throw fail("truncated TRIANGLES stream") }
        let aux = Int(src[pos])
        pos += 1
        let fea = codetri == 0xfe ? 0 : 15
        let feb = aux >> 4
        let fec = aux & 15
        if aux == 0 { next = 0 }
        var a: UInt32 = 0
        if fea == 0 {
          a = next
          next &+= 1
        }
        var b: UInt32
        if feb == 0 {
          b = next
          next &+= 1
        } else {
          b = vf[(vo - feb) & 15]
        }
        var c: UInt32
        if fec == 0 {
          c = next
          next &+= 1
        } else {
          c = vf[(vo - fec) & 15]
        }
        if fea == 15 {
          a = decodeDelta(src, &pos, last)
          last = a
        }
        if feb == 15 {
          b = decodeDelta(src, &pos, last)
          last = b
        }
        if fec == 15 {
          c = decodeDelta(src, &pos, last)
          last = c
        }
        tri(a, b, c)
        pushVert(a)
        pushVert(b, feb == 0 || feb == 15 ? 1 : 0)
        pushVert(c, fec == 0 || fec == 15 ? 1 : 0)
        pushEdge(b, a)
        pushEdge(c, b)
        pushEdge(a, c)
      }
    }
    guard pos == safeEnd else { throw fail("TRIANGLES trailing data") }
  }

  private static func decodeIndexSequence(
    _ src: [UInt8], count: Int, out: inout [UInt32]
  ) throws {
    guard src.count >= 1 + count + 4 else { throw fail("truncated INDICES stream") }
    let header = Int(src[0])
    guard header & 0xf0 == sequenceHeader else {
      throw fail("unsupported INDICES header 0x\(String(header, radix: 16))")
    }
    guard header & 0x0f <= 1 else { throw fail("unsupported INDICES codec version") }
    let safeEnd = src.count - 4
    var last: [UInt32] = [0, 0]
    var pos = 1
    for i in 0..<count {
      guard pos < safeEnd else { throw fail("truncated INDICES stream") }
      var v = readVByte(src, &pos)
      let current = Int(v & 1)
      v >>= 1
      let d = (v >> 1) ^ (0 &- (v & 1))
      let index = last[current] &+ d
      last[current] = index
      out[i] = index
    }
    guard pos == safeEnd else { throw fail("INDICES trailing data") }
  }

  // MARK: - Encoder

  private static func zigzag8(_ d: Int) -> Int {
    let s = Int(Int8(truncatingIfNeeded: d))
    return ((s << 1) ^ (s >> 7)) & 0xff
  }

  private static func zigzag32(_ d: Int32) -> UInt32 {
    UInt32(bitPattern: (d << 1) ^ (d >> 31))
  }

  private static func pushVByte(_ out: inout [UInt8], _ value: UInt32) {
    var v = value
    repeat {
      out.append(UInt8(v & 127) | (v > 127 ? 128 : 0))
      v >>= 7
    } while v != 0
  }

  public static func encodeBuffer(
    _ raw: Data,
    count: Int,
    byteStride: Int,
    mode: String = "ATTRIBUTES"
  ) -> Data {
    let r = [UInt8](raw)
    var out: [UInt8] = []
    if mode == "ATTRIBUTES" {
      precondition(byteStride % 4 == 0 && byteStride <= 256, "ATTRIBUTES byteStride")
      out.append(UInt8(vertexHeader))
      let blockSize = vertexBlockSize(byteStride)
      var last = [UInt8](repeating: 0, count: byteStride)
      if count > 0 { for b in 0..<byteStride { last[b] = r[b] } }
      let baseline = last
      var deltas = [Int](repeating: 0, count: 256)
      var vertexOffset = 0
      while vertexOffset < count {
        let vc = min(blockSize, count - vertexOffset)
        let aligned = (vc + 15) & ~15
        for k in 0..<byteStride {
          for i in 0..<256 { deltas[i] = 0 }
          var p = Int(last[k])
          for i in 0..<vc {
            let cur = Int(r[(vertexOffset + i) * byteStride + k])
            deltas[i] = zigzag8(cur - p)
            p = cur
          }
          last[k] = UInt8(p)
          let groups = aligned / 16
          let headerPos = out.count
          out.append(contentsOf: [UInt8](repeating: 0, count: (groups + 3) >> 2))
          for g in 0..<groups {
            let grp = Array(deltas[(g * 16)..<(g * 16 + 16)])
            var best = 3
            var bestSize = 16
            for bk in 0..<3 {
              let bits = bitsV0[bk]
              let size: Int
              if bits == 0 {
                size = grp.allSatisfy { $0 == 0 } ? 0 : Int.max
              } else {
                let sentinel = (1 << bits) - 1
                size = 16 * bits / 8 + grp.filter { $0 >= sentinel }.count
              }
              if size < bestSize {
                bestSize = size
                best = bk
              }
            }
            out[headerPos + (g >> 2)] |= UInt8(best << ((g & 3) * 2))
            let bits = bitsV0[best]
            if bits == 8 {
              out.append(contentsOf: grp.map { UInt8($0) })
            } else if bits > 0 {
              let sentinel = (1 << bits) - 1
              let perByte = 8 / bits
              var outliers: [UInt8] = []
              var i = 0
              while i < 16 {
                var byte = 0
                for s in 0..<perByte {
                  let d = grp[i + s]
                  if d >= sentinel { outliers.append(UInt8(d)) }
                  byte |= min(d, sentinel) << (8 - bits - s * bits)
                }
                out.append(UInt8(byte))
                i += perByte
              }
              out.append(contentsOf: outliers)
            }
          }
        }
        vertexOffset += vc
      }
      out.append(contentsOf: [UInt8](repeating: 0, count: max(0, tailMinV0 - byteStride)))
      out.append(contentsOf: baseline)
      return Data(out)
    }
    precondition(byteStride == 2 || byteStride == 4, "\(mode) byteStride must be 2 or 4")
    func read(_ i: Int) -> Int32 {
      if byteStride == 2 { return Int32(r[i * 2]) | (Int32(r[i * 2 + 1]) << 8) }
      let o = i * 4
      return Int32(
        bitPattern: UInt32(r[o]) | (UInt32(r[o + 1]) << 8) | (UInt32(r[o + 2]) << 16)
          | (UInt32(r[o + 3]) << 24))
    }
    if mode == "INDICES" {
      out.append(UInt8(sequenceHeader | 1))
      var last: Int32 = 0
      for i in 0..<count {
        let cur = read(i)
        pushVByte(&out, zigzag32(cur &- last) << 1)
        last = cur
      }
      out.append(contentsOf: [0, 0, 0, 0])
    } else {
      precondition(count % 3 == 0, "TRIANGLES count must be divisible by 3")
      out.append(UInt8(indexHeader | 1))
      out.append(contentsOf: [UInt8](repeating: 0xff, count: count / 3))
      var last: Int32 = 0
      for t in 0..<(count / 3) {
        out.append(0xff)
        for c in 0..<3 {
          let cur = read(t * 3 + c)
          pushVByte(&out, zigzag32(cur &- last))
          last = cur
        }
      }
      out.append(contentsOf: [UInt8](repeating: 0, count: 16))
    }
    return Data(out)
  }

  // MARK: - Filters

  private static func roundSigned(_ v: Float) -> Int {
    Int(v + (v >= 0 ? Float(0.5) : Float(-0.5)))
  }

  /// Applies a meshopt filter in place. Unknown filters (and `NONE`) are no-ops here;
  /// `decodeBuffer` rejects unknown filters.
  public static func applyFilter(
    _ data: inout Data,
    count: Int,
    byteStride: Int,
    filter: String
  ) {
    guard count > 0 else { return }
    var b = [UInt8](data)
    func i16(_ o: Int) -> Int { Int(Int16(bitPattern: UInt16(b[o]) | (UInt16(b[o + 1]) << 8))) }
    func u16(_ o: Int) -> Int { Int(UInt16(b[o]) | (UInt16(b[o + 1]) << 8)) }
    func put16(_ o: Int, _ v: Int) {
      let u = UInt16(truncatingIfNeeded: v)
      b[o] = UInt8(u & 0xff)
      b[o + 1] = UInt8(u >> 8)
    }
    switch filter {
    case "OCTAHEDRAL":
      guard byteStride == 4 || byteStride == 8 else { return }
      let wide = byteStride == 8
      let maxv: Float = wide ? 32767 : 127
      let cs = wide ? 2 : 1
      func get(_ o: Int) -> Float { wide ? Float(i16(o)) : Float(Int8(bitPattern: b[o])) }
      func set(_ o: Int, _ v: Int) {
        if wide { put16(o, v) } else { b[o] = UInt8(truncatingIfNeeded: v) }
      }
      for i in 0..<count {
        let base = i * byteStride
        var x = get(base)
        var y = get(base + cs)
        let z = get(base + 2 * cs) - abs(x) - abs(y)
        let t: Float = z >= 0 ? 0 : z
        x += x >= 0 ? t : -t
        y += y >= 0 ? t : -t
        let xx = x * x
        let yy = y * y
        let zz = z * z
        let l = (xx + yy + zz).squareRoot()
        if l == 0 {
          // Degenerate (never emitted by encoders): decode to +Z instead of NaN.
          set(base, 0)
          set(base + cs, 0)
          set(base + 2 * cs, Int(maxv))
          continue
        }
        let s = maxv / l
        set(base, roundSigned(x * s))
        set(base + cs, roundSigned(y * s))
        set(base + 2 * cs, roundSigned(z * s))
      }
    case "QUATERNION":
      guard byteStride == 8 else { return }
      let scale: Float = 32767 / Float(2).squareRoot()
      for i in 0..<count {
        let base = i * 8
        let w3 = i16(base + 6)
        let s = Float(w3 | 3)
        let x = Float(i16(base))
        let y = Float(i16(base + 2))
        let z = Float(i16(base + 4))
        let ws = s * s
        let xx = x * x
        let yy = y * y
        let zz = z * z
        let ww = ws * 2 - xx - yy - zz
        let w = (ww >= 0 ? ww : 0).squareRoot()
        let ss = scale / s
        let qc = w3 & 3
        var q = [0, 0, 0, 0]
        q[(qc + 1) & 3] = roundSigned(x * ss)
        q[(qc + 2) & 3] = roundSigned(y * ss)
        q[(qc + 3) & 3] = roundSigned(z * ss)
        q[qc] = Int(w * ss + 0.5)
        for c in 0..<4 { put16(base + c * 2, q[c]) }
      }
    case "EXPONENTIAL":
      guard byteStride >= 4 && byteStride % 4 == 0 else { return }
      for i in 0..<(count * byteStride / 4) {
        let o = i * 4
        let v = Int32(
          bitPattern: UInt32(b[o]) | (UInt32(b[o + 1]) << 8) | (UInt32(b[o + 2]) << 16)
            | (UInt32(b[o + 3]) << 24))
        let m = (v << 8) >> 8
        let e = v >> 24
        let scale = Float(bitPattern: UInt32(bitPattern: (e &+ 127) << 23))
        let f = (scale * Float(m)).bitPattern
        for k in 0..<4 { b[o + k] = UInt8(truncatingIfNeeded: f >> (8 * UInt32(k))) }
      }
    case "COLOR":
      guard byteStride == 4 || byteStride == 8 else { return }
      let wide = byteStride == 8
      let maxv: Float = wide ? 65535 : 255
      let cs = wide ? 2 : 1
      func getU(_ o: Int) -> Int { wide ? u16(o) : Int(b[o]) }
      func getS(_ o: Int) -> Int { wide ? i16(o) : Int(Int8(bitPattern: b[o])) }
      func setU(_ o: Int, _ v: Int) {
        if wide { put16(o, v) } else { b[o] = UInt8(truncatingIfNeeded: v) }
      }
      for i in 0..<count {
        let base = i * byteStride
        var aS = getU(base + 3 * cs)
        aS |= aS >> 1
        aS |= aS >> 2
        aS |= aS >> 4
        aS |= aS >> 8
        let yv = getU(base)
        let co = getS(base + cs)
        let cg = getS(base + 2 * cs)
        let r = yv + co - cg
        let g = yv + cg
        let bl = yv - co - cg
        var a = getU(base + 3 * cs)
        a = ((a << 1) & aS) | (a & 1)
        let ss: Float = aS == 0 ? 0 : maxv / Float(aS)
        setU(base, Int(Float(r) * ss + 0.5))
        setU(base + cs, Int(Float(g) * ss + 0.5))
        setU(base + 2 * cs, Int(Float(bl) * ss + 0.5))
        setU(base + 3 * cs, Int(Float(a) * ss + 0.5))
      }
    default:
      return
    }
    data = Data(b)
  }
}
