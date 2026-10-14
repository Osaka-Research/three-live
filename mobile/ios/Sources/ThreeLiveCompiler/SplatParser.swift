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

// Port of the `.splat` / `.spz` decoders in `xr-live/src/plugins/splat-loader.ts`.
// All inputs are untrusted: every read is bounds-checked and every size is capped before
// allocation.

import Foundation
import simd

#if canImport(Compression)
  import Compression
#endif

/// Decoded Gaussian splat cloud (structure of arrays).
public struct SplatData: Sendable, Equatable {
  public var count: Int
  /// `xyz` per splat.
  public var positions: [Float]
  /// Linear (not log) `xyz` scale per splat.
  public var scales: [Float]
  /// RGBA8 per splat.
  public var colors: [UInt8]
  /// Unit quaternion `xyzw` per splat.
  public var rotations: [Float]

  init(count: Int) {
    self.count = count
    positions = [Float](repeating: 0, count: count * 3)
    scales = [Float](repeating: 0, count: count * 3)
    colors = [UInt8](repeating: 0, count: count * 4)
    rotations = [Float](repeating: 0, count: count * 4)
  }
}

/// Errors thrown by `SplatParser`.
public enum SplatParserError: Error, Equatable, LocalizedError {
  case invalidSplatSize
  case tooManySplats
  case headerTruncated
  case badMagic
  case unsupportedVersion(UInt32)
  case invalidFractionalBits
  case payloadTruncated
  case fileTooLarge
  case decompressedTooLarge
  case decompressionFailed
  case compressionUnavailable

  public var errorDescription: String? {
    switch self {
    case .invalidSplatSize: return ".splat size is not a multiple of 32 bytes"
    case .tooManySplats: return "too many splats"
    case .headerTruncated: return ".spz header truncated"
    case .badMagic: return "bad .spz magic"
    case .unsupportedVersion(let v): return "unsupported .spz version \(v)"
    case .invalidFractionalBits: return "invalid .spz fractional bits"
    case .payloadTruncated: return ".spz payload truncated"
    case .fileTooLarge: return "splat file too large"
    case .decompressedTooLarge: return "decompressed .spz exceeds size limit"
    case .decompressionFailed: return ".spz gzip stream is corrupt"
    case .compressionUnavailable: return "gzip decompression is unavailable on this platform"
    }
  }
}

/// Decoders for antimatter15 `.splat` and Niantic `.spz` (v2 / v3, gzip or raw).
public enum SplatParser {
  /// Maximum splats accepted from a single file.
  public static let maxSplats = 1_000_000
  /// Maximum (compressed) file size in bytes.
  public static let maxFileBytes = 128 * 1024 * 1024
  /// Maximum decompressed `.spz` payload size in bytes (hard ceiling for `gunzip`).
  public static let maxSpzDecompressedBytes = 128 * 1024 * 1024

  static let splatRecordBytes = 32
  static let spzMagic: UInt32 = 0x5053_474E
  static let shC0 = 0.28209479177387814

  private static func normalizeQuat(_ q: inout [Float], _ o: Int) {
    let len = (q[o] * q[o] + q[o + 1] * q[o + 1] + q[o + 2] * q[o + 2] + q[o + 3] * q[o + 3])
      .squareRoot()
    if len > 1e-8 && len.isFinite {
      for k in 0..<4 { q[o + k] /= len }
    } else {
      q[o] = 0
      q[o + 1] = 0
      q[o + 2] = 0
      q[o + 3] = 1
    }
  }

  private static func u32(_ b: UnsafeRawBufferPointer, _ o: Int) -> UInt32 {
    let b0 = UInt32(b[o])
    let b1 = UInt32(b[o + 1]) << 8
    let b2 = UInt32(b[o + 2]) << 16
    let b3 = UInt32(b[o + 3]) << 24
    return b0 | b1 | b2 | b3
  }

  /// Parses an antimatter15-style `.splat` buffer: per splat, position f32×3, scale f32×3,
  /// RGBA u8×4, rotation u8×4 (`(b − 128) / 128`, order w, x, y, z).
  public static func parseSplat(_ data: Data) throws -> SplatData {
    if data.count > maxFileBytes { throw SplatParserError.fileTooLarge }
    if data.count % splatRecordBytes != 0 { throw SplatParserError.invalidSplatSize }
    let count = data.count / splatRecordBytes
    if count > maxSplats { throw SplatParserError.tooManySplats }
    var out = SplatData(count: count)
    data.withUnsafeBytes { (b: UnsafeRawBufferPointer) in
      for i in 0..<count {
        let base = i * splatRecordBytes
        for k in 0..<3 {
          let p = Float(bitPattern: u32(b, base + k * 4))
          let s = Float(bitPattern: u32(b, base + 12 + k * 4))
          out.positions[i * 3 + k] = p.isFinite ? p : 0
          out.scales[i * 3 + k] = s.isFinite ? abs(s) : 0
        }
        for k in 0..<4 {
          out.colors[i * 4 + k] = b[base + 24 + k]
        }
        func q(_ j: Int) -> Float { (Float(b[base + 28 + j]) - 128) / 128 }
        out.rotations[i * 4] = q(1)
        out.rotations[i * 4 + 1] = q(2)
        out.rotations[i * 4 + 2] = q(3)
        out.rotations[i * 4 + 3] = q(0)
        normalizeQuat(&out.rotations, i * 4)
      }
    }
    return out
  }

  /// Parses a decompressed `.spz` payload (versions 2 and 3): 16-byte header, then SoA blocks
  /// of 24-bit fixed-point positions, alphas, colors (SH DC), log scales, and rotations
  /// (3-byte xyz for v2, 4-byte smallest-three for v3). Spherical harmonics are ignored.
  public static func parseSpzPayload(_ data: Data) throws -> SplatData {
    if data.count < 16 { throw SplatParserError.headerTruncated }
    return try data.withUnsafeBytes { (b: UnsafeRawBufferPointer) -> SplatData in
      if u32(b, 0) != spzMagic { throw SplatParserError.badMagic }
      let version = u32(b, 4)
      if version != 2 && version != 3 { throw SplatParserError.unsupportedVersion(version) }
      let rawCount = u32(b, 8)
      if rawCount > UInt32(maxSplats) { throw SplatParserError.tooManySplats }
      let count = Int(rawCount)
      let fractionalBits = Int(b[13])
      if fractionalBits > 24 { throw SplatParserError.invalidFractionalBits }
      let rotBytes = version == 3 ? 4 : 3
      let needed = 16 + count * (9 + 1 + 3 + 3 + rotBytes)
      if b.count < needed { throw SplatParserError.payloadTruncated }

      var out = SplatData(count: count)
      let fixed = 1.0 / Double(1 << fractionalBits)
      var o = 16
      for i in 0..<(count * 3) {
        var v = Int32(b[o]) | (Int32(b[o + 1]) << 8) | (Int32(b[o + 2]) << 16)
        if v & 0x80_0000 != 0 { v |= ~Int32(0xFF_FFFF) }
        out.positions[i] = Float(Double(v) * fixed)
        o += 3
      }
      let alphaStart = o
      let colorStart = alphaStart + count
      let scaleStart = colorStart + count * 3
      let rotStart = scaleStart + count * 3
      for i in 0..<count {
        for k in 0..<3 {
          let dc = (Double(b[colorStart + i * 3 + k]) / 255 - 0.5) / 0.15
          let c = ((0.5 + shC0 * dc) * 255).rounded()
          out.colors[i * 4 + k] = UInt8(max(0, min(255, c)))
          out.scales[i * 3 + k] = Float(exp(Double(b[scaleStart + i * 3 + k]) / 16 - 10))
        }
        out.colors[i * 4 + 3] = b[alphaStart + i]
        let r = rotStart + i * rotBytes
        if version == 2 {
          let x = Double(b[r]) / 127.5 - 1
          let y = Double(b[r + 1]) / 127.5 - 1
          let z = Double(b[r + 2]) / 127.5 - 1
          out.rotations[i * 4] = Float(x)
          out.rotations[i * 4 + 1] = Float(y)
          out.rotations[i * 4 + 2] = Float(z)
          out.rotations[i * 4 + 3] = Float(max(0, 1 - x * x - y * y - z * z).squareRoot())
        } else {
          var comp = u32(b, r)
          let largest = Int(comp >> 30)
          var q = [Double](repeating: 0, count: 4)
          var sum = 0.0
          for k in stride(from: 3, through: 0, by: -1) where k != largest {
            let mag = Double(comp & 511)
            let neg = (comp >> 9) & 1
            comp >>= 10
            q[k] = (0.5.squareRoot() * mag) / 511 * (neg != 0 ? -1 : 1)
            sum += q[k] * q[k]
          }
          q[largest] = max(0, 1 - sum).squareRoot()
          for k in 0..<4 { out.rotations[i * 4 + k] = Float(q[k]) }
        }
        normalizeQuat(&out.rotations, i * 4)
      }
      return out
    }
  }

  /// Parses `.spz` bytes, transparently gunzipping when gzip-compressed.
  public static func parseSpz(
    _ data: Data, maxDecompressedBytes: Int = maxSpzDecompressedBytes
  ) throws -> SplatData {
    if data.count > maxFileBytes { throw SplatParserError.fileTooLarge }
    if isGzip(data) {
      return try parseSpzPayload(gunzip(data, maxBytes: maxDecompressedBytes))
    }
    return try parseSpzPayload(data)
  }

  /// Parses either format, choosing `.spz` for gzip data, the `.spz` magic, or an `.spz`
  /// file extension in `fileName`.
  public static func parse(_ data: Data, fileName: String? = nil) throws -> SplatData {
    let isSpzName = fileName.map { $0.lowercased().hasSuffix(".spz") } ?? false
    var hasMagic = false
    if data.count >= 4 {
      hasMagic = data.withUnsafeBytes { (b: UnsafeRawBufferPointer) in u32(b, 0) } == spzMagic
    }
    return try (isSpzName || isGzip(data) || hasMagic) ? parseSpz(data) : parseSplat(data)
  }

  /// Whether `data` starts with the gzip magic `1f 8b`.
  public static func isGzip(_ data: Data) -> Bool {
    data.count >= 2 && data[data.startIndex] == 0x1F && data[data.startIndex + 1] == 0x8B
  }

  /// Decompresses a gzip (RFC 1952) member with Apple's `Compression` framework by stripping
  /// the gzip header / footer and inflating the raw DEFLATE stream (`COMPRESSION_ZLIB`),
  /// enforcing `maxBytes` on the output.
  public static func gunzip(_ data: Data, maxBytes: Int = maxSpzDecompressedBytes) throws -> Data {
    return try data.withUnsafeBytes { (b: UnsafeRawBufferPointer) -> Data in
      let n = b.count
      guard n >= 18, b[0] == 0x1F, b[1] == 0x8B, b[2] == 8 else {
        throw SplatParserError.decompressionFailed
      }
      let flags = b[3]
      var o = 10
      if flags & 0x04 != 0 {  // FEXTRA
        guard o + 2 <= n else { throw SplatParserError.decompressionFailed }
        let xlen = Int(b[o]) | (Int(b[o + 1]) << 8)
        o += 2 + xlen
      }
      if flags & 0x08 != 0 {  // FNAME
        while o < n && b[o] != 0 { o += 1 }
        o += 1
      }
      if flags & 0x10 != 0 {  // FCOMMENT
        while o < n && b[o] != 0 { o += 1 }
        o += 1
      }
      if flags & 0x02 != 0 { o += 2 }  // FHCRC
      // The 8-byte footer (CRC32 + ISIZE) follows the DEFLATE stream.
      guard o < n - 8 else { throw SplatParserError.decompressionFailed }
      let deflate = UnsafeRawBufferPointer(rebasing: b[o..<(n - 8)])
      return try inflateRaw(deflate, maxBytes: max(0, min(maxBytes, maxSpzDecompressedBytes)))
    }
  }

  private static func inflateRaw(_ input: UnsafeRawBufferPointer, maxBytes: Int) throws -> Data {
    #if canImport(Compression)
      guard let src = input.baseAddress?.assumingMemoryBound(to: UInt8.self), input.count > 0 else {
        throw SplatParserError.decompressionFailed
      }
      let chunk = 64 * 1024
      let dst = UnsafeMutablePointer<UInt8>.allocate(capacity: chunk)
      defer { dst.deallocate() }
      let stream = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
      defer { stream.deallocate() }
      guard
        compression_stream_init(stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB)
          == COMPRESSION_STATUS_OK
      else { throw SplatParserError.decompressionFailed }
      defer { compression_stream_destroy(stream) }
      stream.pointee.src_ptr = src
      stream.pointee.src_size = input.count
      stream.pointee.dst_ptr = dst
      stream.pointee.dst_size = chunk

      var out = Data()
      let flags = Int32(COMPRESSION_STREAM_FINALIZE.rawValue)
      while true {
        let status = compression_stream_process(stream, flags)
        if status == COMPRESSION_STATUS_ERROR { throw SplatParserError.decompressionFailed }
        let produced = chunk - stream.pointee.dst_size
        if produced > 0 {
          if out.count + produced > maxBytes { throw SplatParserError.decompressedTooLarge }
          out.append(dst, count: produced)
        }
        if status == COMPRESSION_STATUS_END { return out }
        // OK with no output and no input left means the stream is truncated.
        if produced == 0 && stream.pointee.src_size == 0 {
          throw SplatParserError.decompressionFailed
        }
        stream.pointee.dst_ptr = dst
        stream.pointee.dst_size = chunk
      }
    #else
      throw SplatParserError.compressionUnavailable
    #endif
  }

  /// Returns splat indices sorted back-to-front for a column-major model-view-projection
  /// matrix, keyed on clip-space `w` with a single-pass 16-bit counting sort.
  public static func sortByDepth(_ data: SplatData, mvp: simd_float4x4) -> [UInt32] {
    let n = min(data.count, data.positions.count / 3)
    if n == 0 { return [] }
    let r3 = SIMD4<Float>(mvp.columns.0.w, mvp.columns.1.w, mvp.columns.2.w, mvp.columns.3.w)
    var depths = [Double](repeating: 0, count: n)
    var minW = Double.infinity
    var maxW = -Double.infinity
    let p = data.positions
    for i in 0..<n {
      let w =
        Double(r3.x) * Double(p[i * 3]) + Double(r3.y) * Double(p[i * 3 + 1])
        + Double(r3.z) * Double(p[i * 3 + 2]) + Double(r3.w)
      depths[i] = w
      guard w.isFinite else { continue }
      if w < minW { minW = w }
      if w > maxW { maxW = w }
    }
    let buckets = 65536
    var counts = [Int](repeating: 0, count: buckets)
    var keys = [Int](repeating: 0, count: n)
    let span = maxW - minW
    let range: Double = (span.isFinite && span > 0) ? span : 1
    let top = Double(buckets - 1)
    for i in 0..<n {
      // Largest w (farthest) gets key 0 so it is drawn first. Clamp before converting so
      // huge or non-finite depths can never trap in `Int(_:)`.
      let f = ((maxW - depths[i]) / range) * top
      let k = f.isFinite ? Int(min(top, max(0, f)).rounded(.down)) : 0
      keys[i] = k
      counts[k] += 1
    }
    for k in 1..<buckets { counts[k] += counts[k - 1] }
    var out = [UInt32](repeating: 0, count: n)
    for i in stride(from: n - 1, through: 0, by: -1) {
      counts[keys[i]] -= 1
      out[counts[keys[i]]] = UInt32(i)
    }
    return out
  }
}
