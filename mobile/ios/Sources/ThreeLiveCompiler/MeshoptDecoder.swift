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

/// Pure-Swift decoder, encoder, and post-decompression filter for glTF 2.0
/// `EXT_meshopt_compression` (`ATTRIBUTES`, `TRIANGLES`, `INDICES` modes and
/// `NONE`, `OCTAHEDRAL`, `QUATERNION`, `EXPONENTIAL` filters).
public enum MeshoptDecoder {
  public static let maxMeshoptBufferBytes: Int = 64 * 1024 * 1024
  public static let maxMeshoptCount: Int = 16 * 1024 * 1024

  public static func decodeBuffer(
    _ src: Data,
    count: Int,
    byteStride: Int,
    mode: String,
    filter: String = "NONE"
  ) throws -> Data {
    guard count >= 0 && count <= maxMeshoptCount else {
      throw NSError(
        domain: "MeshoptDecoder",
        code: 1,
        userInfo: [
          NSLocalizedDescriptionKey:
            "SecurityError: EXT_meshopt_compression invalid count: \(count)"
        ]
      )
    }
    guard byteStride >= 1 && byteStride <= 256 else {
      throw NSError(
        domain: "MeshoptDecoder",
        code: 2,
        userInfo: [
          NSLocalizedDescriptionKey:
            "SecurityError: EXT_meshopt_compression invalid byteStride: \(byteStride)"
        ]
      )
    }
    let byteLength = count * byteStride
    guard byteLength <= maxMeshoptBufferBytes else {
      throw NSError(
        domain: "MeshoptDecoder",
        code: 3,
        userInfo: [
          NSLocalizedDescriptionKey:
            "SecurityError: EXT_meshopt_compression output exceeds 64 MiB limit (\(byteLength))"
        ]
      )
    }
    if count == 0 { return Data() }

    let srcBytes = [UInt8](src)
    var dstBytes = [UInt8](repeating: 0, count: byteLength)

    let prefix: UInt8 = srcBytes.isEmpty ? 0 : (srcBytes[0] & 0xf0)

    if (mode == "TRIANGLES" || mode == "INDICES") && (prefix == 0xb0 || prefix == 0xc0) {
      var pos = 1
      var prev: Int32 = 0
      for i in 0..<count {
        var v: UInt32 = 0
        var shift: UInt32 = 0
        while pos < srcBytes.count {
          let b = UInt32(srcBytes[pos])
          pos += 1
          v |= (b & 0x7f) << shift
          if (b & 0x80) == 0 { break }
          shift += 7
          if shift > 28 {
            throw NSError(
              domain: "MeshoptDecoder",
              code: 4,
              userInfo: [
                NSLocalizedDescriptionKey:
                  "EXT_meshopt_compression: varint overflow in \(mode)"
              ]
            )
          }
        }
        let delta = Int32(bitPattern: (v >> 1) ^ (0 &- (v & 1)))
        prev &+= delta
        if byteStride == 4 {
          let u = UInt32(bitPattern: prev)
          dstBytes[i * 4] = UInt8(u & 0xff)
          dstBytes[i * 4 + 1] = UInt8((u >> 8) & 0xff)
          dstBytes[i * 4 + 2] = UInt8((u >> 16) & 0xff)
          dstBytes[i * 4 + 3] = UInt8((u >> 24) & 0xff)
        } else {
          let u = UInt16(truncatingIfNeeded: prev)
          dstBytes[i * 2] = UInt8(u & 0xff)
          dstBytes[i * 2 + 1] = UInt8((u >> 8) & 0xff)
        }
      }
    } else if !srcBytes.isEmpty && prefix == 0xa0 {
      var pos = 1
      for col in 0..<byteStride {
        var prev: Int = 0
        var i = 0
        while i < count {
          let groupCount = min(16, count - i)
          let header: Int = pos < srcBytes.count ? Int(srcBytes[pos]) : 0
          pos += 1
          for g in 0..<groupCount {
            let code = (header >> ((g & 3) * 2)) & 3
            var zz: Int = 0
            if code == 0 {
              zz = 0
            } else if code == 1 {
              let nibbleByte = pos < srcBytes.count ? Int(srcBytes[pos]) : 0
              if (g & 1) == 0 {
                zz = nibbleByte & 0x0f
              } else {
                zz = (nibbleByte >> 4) & 0x0f
                pos += 1
              }
            } else {
              zz = pos < srcBytes.count ? Int(srcBytes[pos]) : 0
              pos += 1
            }
            let delta = (zz >> 1) ^ -(zz & 1)
            prev = (prev + delta) & 0xff
            dstBytes[(i + g) * byteStride + col] = UInt8(truncatingIfNeeded: prev)
          }
          i += 16
        }
      }
    } else if srcBytes.count >= dstBytes.count {
      for idx in 0..<dstBytes.count {
        dstBytes[idx] = srcBytes[idx]
      }
    } else {
      let copyCount = min(srcBytes.count, dstBytes.count)
      for idx in 0..<copyCount {
        dstBytes[idx] = srcBytes[idx]
      }
    }

    var outData = Data(dstBytes)
    if !filter.isEmpty && filter != "NONE" {
      applyFilter(&outData, count: count, byteStride: byteStride, filter: filter)
    }
    return outData
  }

  public static func encodeBuffer(
    _ raw: Data,
    count: Int,
    byteStride: Int,
    mode: String = "ATTRIBUTES"
  ) -> Data {
    let rawBytes = [UInt8](raw)
    if mode == "TRIANGLES" || mode == "INDICES" {
      var out: [UInt8] = [mode == "TRIANGLES" ? 0xb0 : 0xc0]
      out.reserveCapacity(count * byteStride + 16)
      var last: Int32 = 0
      for i in 0..<count {
        let cur: Int32
        if byteStride == 2 {
          let b0 = i * 2 < rawBytes.count ? UInt16(rawBytes[i * 2]) : 0
          let b1 = i * 2 + 1 < rawBytes.count ? UInt16(rawBytes[i * 2 + 1]) : 0
          cur = Int32(b0 | (b1 << 8))
        } else {
          let b0 = i * 4 < rawBytes.count ? UInt32(rawBytes[i * 4]) : 0
          let b1 = i * 4 + 1 < rawBytes.count ? UInt32(rawBytes[i * 4 + 1]) : 0
          let b2 = i * 4 + 2 < rawBytes.count ? UInt32(rawBytes[i * 4 + 2]) : 0
          let b3 = i * 4 + 3 < rawBytes.count ? UInt32(rawBytes[i * 4 + 3]) : 0
          cur = Int32(bitPattern: b0 | (b1 << 8) | (b2 << 16) | (b3 << 24))
        }
        let delta = cur &- last
        last = cur
        var zz = UInt32(bitPattern: (delta << 1) ^ (delta >> 31))
        while zz >= 0x80 {
          out.append(UInt8((zz & 0x7f) | 0x80))
          zz >>= 7
        }
        out.append(UInt8(zz & 0x7f))
      }
      return Data(out)
    }
    var out: [UInt8] = [0xa0]
    out.reserveCapacity(count * byteStride + 16)
    for col in 0..<byteStride {
      var prev: Int = 0
      var i = 0
      while i < count {
        let groupCount = min(16, count - i)
        var zzVals = [UInt8](repeating: 0, count: groupCount)
        var maxZz: UInt8 = 0
        for g in 0..<groupCount {
          let idx = (i + g) * byteStride + col
          let v = idx < rawBytes.count ? Int(rawBytes[idx]) : 0
          let diff = Int(Int8(truncatingIfNeeded: v - prev))
          prev = v
          let zz = UInt8(truncatingIfNeeded: (diff << 1) ^ (diff >> 31))
          zzVals[g] = zz
          if zz > maxZz { maxZz = zz }
        }
        let code: UInt8 = maxZz == 0 ? 0 : 2
        var header: UInt8 = 0
        for g in 0..<4 {
          header |= code << (g * 2)
        }
        out.append(header)
        if code == 2 {
          out.append(contentsOf: zzVals)
        }
        i += 16
      }
    }
    return Data(out)
  }

  public static func applyFilter(
    _ data: inout Data,
    count: Int,
    byteStride: Int,
    filter: String
  ) {
    if filter == "NONE" || count <= 0 { return }
    data.withUnsafeMutableBytes { rawBuf in
      guard let base = rawBuf.baseAddress else { return }
      switch filter {
      case "OCTAHEDRAL":
        guard byteStride == 4 || byteStride == 8 else { return }
        let isInt16 = byteStride == 8
        let maxVal: Float = isInt16 ? 32767.0 : 127.0
        for i in 0..<count {
          let off = i * byteStride
          var x: Float
          var y: Float
          let z: Float
          let w: Float
          if isInt16 {
            let p = base.advanced(by: off).assumingMemoryBound(to: Int16.self)
            x = Float(Int16(littleEndian: p[0]))
            y = Float(Int16(littleEndian: p[1]))
            z = Float(Int16(littleEndian: p[2]))
            w = Float(Int16(littleEndian: p[3]))
          } else {
            let p = base.advanced(by: off).assumingMemoryBound(to: Int8.self)
            x = Float(p[0])
            y = Float(p[1])
            z = Float(p[2])
            w = Float(p[3])
          }
          let denom: Float = z != 0.0 ? z : 1.0
          x /= denom
          y /= denom
          let nz: Float = 1.0 - abs(x) - abs(y)
          let t: Float = max(-nz, 0.0)
          x -= x >= 0.0 ? t : -t
          y -= y >= 0.0 ? t : -t
          let len = sqrt(x * x + y * y + nz * nz)
          let invLen: Float = len > 1e-8 ? maxVal / len : 0.0
          let rx = min(maxVal, max(-maxVal, (x * invLen).rounded()))
          let ry = min(maxVal, max(-maxVal, (y * invLen).rounded()))
          let rz = min(maxVal, max(-maxVal, (nz * invLen).rounded()))
          let rw = min(maxVal, max(-maxVal, w.rounded()))
          if isInt16 {
            let p = base.advanced(by: off).assumingMemoryBound(to: Int16.self)
            p[0] = Int16(rx).littleEndian
            p[1] = Int16(ry).littleEndian
            p[2] = Int16(rz).littleEndian
            p[3] = Int16(rw).littleEndian
          } else {
            let p = base.advanced(by: off).assumingMemoryBound(to: Int8.self)
            p[0] = Int8(rx)
            p[1] = Int8(ry)
            p[2] = Int8(rz)
            p[3] = Int8(rw)
          }
        }
      case "QUATERNION":
        guard byteStride == 8 else { return }
        let scale: Float = 1.0 / sqrt(2.0)
        for i in 0..<count {
          let off = i * 8
          let p = base.advanced(by: off).assumingMemoryBound(to: Int16.self)
          let a = Int(Int16(littleEndian: p[0]))
          let b = Int(Int16(littleEndian: p[1]))
          let c = Int(Int16(littleEndian: p[2]))
          let d = Int(Int16(littleEndian: p[3]))
          let maxComp = d & 3
          let denom = (d | 3) != 0 ? Float(d | 3) : 32767.0
          let sf = scale / denom
          let x = Float(a) * sf
          let y = Float(b) * sf
          let z = Float(c) * sf
          let wSq = max(Float(0.0), 1.0 - x * x - y * y - z * z)
          let w = sqrt(wSq)
          let qx: Float
          let qy: Float
          let qz: Float
          let qw: Float
          switch maxComp {
          case 0:
            qx = w
            qy = x
            qz = y
            qw = z
          case 1:
            qx = x
            qy = w
            qz = y
            qw = z
          case 2:
            qx = x
            qy = y
            qz = w
            qw = z
          default:
            qx = x
            qy = y
            qz = z
            qw = w
          }
          p[0] = Int16(min(32767, max(-32767, (qx * 32767.0).rounded()))).littleEndian
          p[1] = Int16(min(32767, max(-32767, (qy * 32767.0).rounded()))).littleEndian
          p[2] = Int16(min(32767, max(-32767, (qz * 32767.0).rounded()))).littleEndian
          p[3] = Int16(min(32767, max(-32767, (qw * 32767.0).rounded()))).littleEndian
        }
      case "EXPONENTIAL":
        guard byteStride % 4 == 0 else { return }
        let numWords = (count * byteStride) >> 2
        let pInt = base.assumingMemoryBound(to: Int32.self)
        let pFlt = base.assumingMemoryBound(to: UInt32.self)
        for i in 0..<numWords {
          let v = Int32(littleEndian: pInt[i])
          let exp = v >> 24
          let mant = (v << 8) >> 8
          let f = Float(pow(2.0, Double(exp))) * Float(mant)
          pFlt[i] = f.bitPattern.littleEndian
        }
      default:
        break
      }
    }
  }
}
