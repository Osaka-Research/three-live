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
#if canImport(Metal)
  import Metal
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
  /// Default CPU-billboard splat cap on iOS / visionOS (100 k).
  public static let defaultMaxCpuSplats = 100_000
  /// Default GPU-billboard splat cap on iOS / visionOS (1 M).
  public static let defaultMaxGpuSplats = 1_000_000
  /// Maximum (compressed) file size in bytes.
  public static let maxFileBytes = 128 * 1024 * 1024
  /// Maximum decompressed `.spz` payload size in bytes (hard ceiling for `gunzip`).
  public static let maxSpzDecompressedBytes = 128 * 1024 * 1024

  /// Camera-facing quad geometry built from a sorted `SplatData` cloud.
  public struct QuadGeometry: Sendable, Equatable {
    /// World-space `xyz` per vertex (`4 * count`).
    public var positions: [SIMD3<Float>]
    /// Quad `uv` per vertex (`4 * count`).
    public var uvs: [SIMD2<Float>]
    /// RGBA8 per vertex (`4 * count * 4`).
    public var colors: [UInt8]
    /// Average RGBA `[0..1]` of the splat cloud for materials without vertex-color attributes.
    public var averageColor: SIMD4<Float>
    /// Triangle indices (`6 * count`).
    public var indices: [UInt32]

    public init(
      positions: [SIMD3<Float>] = [],
      uvs: [SIMD2<Float>] = [],
      colors: [UInt8] = [],
      averageColor: SIMD4<Float> = SIMD4<Float>(1, 1, 1, 1),
      indices: [UInt32] = []
    ) {
      self.positions = positions
      self.uvs = uvs
      self.colors = colors
      self.averageColor = averageColor
      self.indices = indices
    }
  }

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

  /// Validates a splat URL: `https:`, or `http:` on loopback (`localhost` / `127.0.0.1`), plus
  /// relative URLs resolved against `baseURL`. Unless `allowCrossOrigin` is `true` (host prop
  /// `allowRemoteSplats`), the resolved URL must share the origin of `baseURL`. Returns `nil` when
  /// rejected.
  public static func resolveSplatURL(
    _ raw: String?,
    baseURL: String? = nil,
    allowCrossOrigin: Bool = true
  ) -> URL? {
    guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmed.isEmpty, trimmed.count <= 4096, !trimmed.hasPrefix("//")
    else { return nil }
    let fallback =
      baseURL?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
      ? baseURL!.trimmingCharacters(in: .whitespacesAndNewlines)
      : "https://localhost/"
    guard let base = URL(string: fallback), let resolved = URL(string: trimmed, relativeTo: base)?.absoluteURL,
      let scheme = resolved.scheme?.lowercased(), let host = resolved.host?.lowercased(), !host.isEmpty
    else { return nil }
    let loopback = host == "localhost" || host == "127.0.0.1"
    let schemeOk = scheme == "https" || (scheme == "http" && loopback)
    guard schemeOk else { return nil }
    if !allowCrossOrigin && origin(of: resolved) != origin(of: base) { return nil }
    return resolved
  }

  private static func origin(of url: URL) -> String {
    let scheme = url.scheme?.lowercased() ?? ""
    let host = url.host?.lowercased() ?? ""
    let port = url.port ?? -1
    let isDefault = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
    return (port <= 0 || isDefault) ? "\(scheme)://\(host)" : "\(scheme)://\(host):\(port)"
  }

  /// Deterministic stride downsampling when `data.count > maxSplats`, keeping at most `maxSplats`
  /// splats. Returns `data` unchanged when `data.count <= maxSplats`.
  public static func downsample(_ data: SplatData, maxSplats: Int = defaultMaxCpuSplats) -> SplatData {
    let cap = max(1, min(maxSplats, Self.maxSplats))
    guard data.count > cap else { return data }
    var out = SplatData(count: cap)
    let step = Double(data.count) / Double(cap)
    for i in 0..<cap {
      let src = min(data.count - 1, Int((Double(i) * step).rounded(.down)))
      for k in 0..<3 {
        out.positions[i * 3 + k] = data.positions[src * 3 + k]
        out.scales[i * 3 + k] = data.scales[src * 3 + k]
      }
      for k in 0..<4 {
        out.colors[i * 4 + k] = data.colors[src * 4 + k]
        out.rotations[i * 4 + k] = data.rotations[src * 4 + k]
      }
    }
    return out
  }

  /// Returns `true` when the camera or splat node moved by more than `minMoveMeters` (default 5 cm)
  /// or rotated by more than `minAngleDeg` (default 5°).
  public static func shouldResort(
    lastCameraWorld: simd_float4x4?,
    cameraWorld: simd_float4x4,
    lastNodeWorld: simd_float4x4?,
    nodeWorld: simd_float4x4,
    minMoveMeters: Float = 0.05,
    minAngleDeg: Float = 5.0
  ) -> Bool {
    guard let lastCam = lastCameraWorld, let lastNode = lastNodeWorld else { return true }
    let camDelta = SIMD3<Float>(
      cameraWorld.columns.3.x - lastCam.columns.3.x,
      cameraWorld.columns.3.y - lastCam.columns.3.y,
      cameraWorld.columns.3.z - lastCam.columns.3.z)
    if simd_length_squared(camDelta) > minMoveMeters * minMoveMeters { return true }
    let nodeDelta = SIMD3<Float>(
      nodeWorld.columns.3.x - lastNode.columns.3.x,
      nodeWorld.columns.3.y - lastNode.columns.3.y,
      nodeWorld.columns.3.z - lastNode.columns.3.z)
    if simd_length_squared(nodeDelta) > minMoveMeters * minMoveMeters { return true }
    let cosLimit = cos(minAngleDeg * .pi / 180)
    let f0 = SIMD3<Float>(lastCam.columns.2.x, lastCam.columns.2.y, lastCam.columns.2.z)
    let f1 = SIMD3<Float>(cameraWorld.columns.2.x, cameraWorld.columns.2.y, cameraWorld.columns.2.z)
    if simd_dot(f0, f1) < cosLimit { return true }
    let nDot = (axisDot(lastNode.columns.0, nodeWorld.columns.0) + axisDot(lastNode.columns.2, nodeWorld.columns.2)) * 0.5
    return nDot < cosLimit
  }

  private static func axisDot(_ a: SIMD4<Float>, _ b: SIMD4<Float>) -> Float {
    let va = SIMD3<Float>(a.x, a.y, a.z)
    let vb = SIMD3<Float>(b.x, b.y, b.z)
    let la = simd_length(va)
    let lb = simd_length(vb)
    guard la > 1e-6 && lb > 1e-6 else { return 1 }
    return simd_dot(va, vb) / (la * lb)
  }

  /// Builds a column-major matrix whose row 3 (`columns.*.w`) equals the view depth along `-Z` of
  /// `cameraWorld` for local positions under `nodeWorld`, for `sortByDepth(_:mvp:)`.
  public static func viewDepthMatrix(nodeWorld: simd_float4x4, cameraWorld: simd_float4x4) -> simd_float4x4 {
    let f = -SIMD3<Float>(cameraWorld.columns.2.x, cameraWorld.columns.2.y, cameraWorld.columns.2.z)
    let camPos = SIMD3<Float>(cameraWorld.columns.3.x, cameraWorld.columns.3.y, cameraWorld.columns.3.z)
    let c0 = SIMD3<Float>(nodeWorld.columns.0.x, nodeWorld.columns.0.y, nodeWorld.columns.0.z)
    let c1 = SIMD3<Float>(nodeWorld.columns.1.x, nodeWorld.columns.1.y, nodeWorld.columns.1.z)
    let c2 = SIMD3<Float>(nodeWorld.columns.2.x, nodeWorld.columns.2.y, nodeWorld.columns.2.z)
    let c3 = SIMD3<Float>(nodeWorld.columns.3.x, nodeWorld.columns.3.y, nodeWorld.columns.3.z) - camPos
    var m = matrix_identity_float4x4
    m.columns.0.w = simd_dot(f, c0)
    m.columns.1.w = simd_dot(f, c1)
    m.columns.2.w = simd_dot(f, c2)
    m.columns.3.w = simd_dot(f, c3)
    return m
  }

  /// Builds camera-facing billboard quads in world space for `data` in back-to-front `order`.
  public static func buildSplatQuads(
    _ data: SplatData,
    order: [UInt32],
    nodeWorld: simd_float4x4,
    cameraWorld: simd_float4x4
  ) -> QuadGeometry {
    let n = min(data.count, order.count)
    guard n > 0 else { return QuadGeometry() }
    let sx = simd_length(SIMD3<Float>(nodeWorld.columns.0.x, nodeWorld.columns.0.y, nodeWorld.columns.0.z))
    let sy = simd_length(SIMD3<Float>(nodeWorld.columns.1.x, nodeWorld.columns.1.y, nodeWorld.columns.1.z))
    let sz = simd_length(SIMD3<Float>(nodeWorld.columns.2.x, nodeWorld.columns.2.y, nodeWorld.columns.2.z))
    let nodeScale = max(max(sx, max(sy, sz)), 1e-6)
    let right = SIMD3<Float>(cameraWorld.columns.0.x, cameraWorld.columns.0.y, cameraWorld.columns.0.z)
    let up = SIMD3<Float>(cameraWorld.columns.1.x, cameraWorld.columns.1.y, cameraWorld.columns.1.z)

    var positions: [SIMD3<Float>] = []
    positions.reserveCapacity(n * 4)
    var uvs: [SIMD2<Float>] = []
    uvs.reserveCapacity(n * 4)
    var colors: [UInt8] = []
    colors.reserveCapacity(n * 16)
    var indices: [UInt32] = []
    indices.reserveCapacity(n * 6)
    var sumR: Double = 0
    var sumG: Double = 0
    var sumB: Double = 0
    var sumA: Double = 0
    var validCount = 0

    for k in 0..<n {
      let s = Int(order[k])
      guard s >= 0 && s < data.count else { continue }
      validCount += 1
      let lp = SIMD4<Float>(data.positions[s * 3], data.positions[s * 3 + 1], data.positions[s * 3 + 2], 1)
      let wp4 = nodeWorld * lp
      let wp = SIMD3<Float>(wp4.x, wp4.y, wp4.z)
      let r0 = max(data.scales[s * 3], max(data.scales[s * 3 + 1], data.scales[s * 3 + 2]))
      let half = min(max(r0 * nodeScale * 1.5, 0.001), 10.0)
      let dr = right * half
      let du = up * half
      let base = UInt32(positions.count)
      positions.append(wp - dr - du)
      positions.append(wp + dr - du)
      positions.append(wp + dr + du)
      positions.append(wp - dr + du)
      uvs.append(SIMD2<Float>(0, 0))
      uvs.append(SIMD2<Float>(1, 0))
      uvs.append(SIMD2<Float>(1, 1))
      uvs.append(SIMD2<Float>(0, 1))
      let c0 = data.colors[s * 4]
      let c1 = data.colors[s * 4 + 1]
      let c2 = data.colors[s * 4 + 2]
      let c3 = data.colors[s * 4 + 3]
      sumR += Double(c0)
      sumG += Double(c1)
      sumB += Double(c2)
      sumA += Double(c3)
      for _ in 0..<4 {
        colors.append(c0)
        colors.append(c1)
        colors.append(c2)
        colors.append(c3)
      }
      indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
    }
    let avg: SIMD4<Float>
    if validCount > 0 {
      let denom = Double(validCount) * 255.0
      avg = SIMD4<Float>(Float(sumR / denom), Float(sumG / denom), Float(sumB / denom), Float(sumA / denom))
    } else {
      avg = SIMD4<Float>(1, 1, 1, 1)
    }
    return QuadGeometry(positions: positions, uvs: uvs, colors: colors, averageColor: avg, indices: indices)
  }

  /// Builds a static local-space vertex buffer for GPU-billboarded splat rendering (`CustomMaterial`).
  /// Each splat emits 4 vertices at its local center `(cx, cy, cz)`, with `uvs` set to the signed
  /// local half-size `(-r, -r)`, `(+r, -r)`, `(+r, +r)`, `(-r, +r)` (expanded along camera right/up
  /// in `threeLiveSplatGeometry`) and RGBA8 vertex colors. Only the index buffer needs to be updated
  /// when the back-to-front depth sort changes; see `buildSortedSplatIndices(order:count:)`.
  public static func buildStaticGpuSplatVertices(_ data: SplatData) -> QuadGeometry {
    let n = data.count
    guard n > 0 else { return QuadGeometry() }
    var positions: [SIMD3<Float>] = []
    positions.reserveCapacity(n * 4)
    var uvs: [SIMD2<Float>] = []
    uvs.reserveCapacity(n * 4)
    var colors: [UInt8] = []
    colors.reserveCapacity(n * 16)
    var indices: [UInt32] = []
    indices.reserveCapacity(n * 6)
    var sumR: Double = 0
    var sumG: Double = 0
    var sumB: Double = 0
    var sumA: Double = 0

    for s in 0..<n {
      let lp = SIMD3<Float>(data.positions[s * 3], data.positions[s * 3 + 1], data.positions[s * 3 + 2])
      let r0 = max(data.scales[s * 3], max(data.scales[s * 3 + 1], data.scales[s * 3 + 2]))
      let half = min(max(r0 * 1.5, 0.001), 10.0)
      let base = UInt32(s * 4)
      for _ in 0..<4 { positions.append(lp) }
      uvs.append(SIMD2<Float>(-half, -half))
      uvs.append(SIMD2<Float>(half, -half))
      uvs.append(SIMD2<Float>(half, half))
      uvs.append(SIMD2<Float>(-half, half))
      let c0 = data.colors[s * 4]
      let c1 = data.colors[s * 4 + 1]
      let c2 = data.colors[s * 4 + 2]
      let c3 = data.colors[s * 4 + 3]
      sumR += Double(c0)
      sumG += Double(c1)
      sumB += Double(c2)
      sumA += Double(c3)
      for _ in 0..<4 {
        colors.append(c0)
        colors.append(c1)
        colors.append(c2)
        colors.append(c3)
      }
      indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
    }
    let denom = Double(n) * 255.0
    let avg = SIMD4<Float>(Float(sumR / denom), Float(sumG / denom), Float(sumB / denom), Float(sumA / denom))
    return QuadGeometry(positions: positions, uvs: uvs, colors: colors, averageColor: avg, indices: indices)
  }

  /// Builds the `6 * count` triangle indices referencing the static 4-vertex-per-splat buffer from
  /// `buildStaticGpuSplatVertices` in back-to-front `order`.
  public static func buildSortedSplatIndices(order: [UInt32], count: Int? = nil) -> [UInt32] {
    let n = min(count ?? order.count, order.count)
    guard n > 0 else { return [] }
    var out = [UInt32](repeating: 0, count: n * 6)
    for k in 0..<n {
      let vo = order[k] &* 4
      let io = k * 6
      out[io] = vo
      out[io + 1] = vo &+ 1
      out[io + 2] = vo &+ 2
      out[io + 3] = vo
      out[io + 4] = vo &+ 2
      out[io + 5] = vo &+ 3
    }
    return out
  }

  /// Metal Shading Language source for RealityKit `CustomMaterial` Gaussian splats (`threeLiveSplatGeometry`
  /// geometry modifier + `threeLiveSplatSurface` surface shader).
  public static let metalShaderSource: String = """
    #include <metal_stdlib>
    using namespace metal;

    #if __has_include(<RealityKit/RealityKit.h>) && !defined(__VISION_OS_VERSION_MIN_REQUIRED) && !defined(__TV_OS_VERSION_MIN_REQUIRED)
    #include <RealityKit/RealityKit.h>
    #else
    namespace realitykit {
    namespace geometry_modifier {
    struct geometry_data_t;
    namespace api {
    [[visible]] float4x4 model_to_view(thread geometry_data_t &data);
    [[visible]] float2 uv0(thread geometry_data_t &data);
    [[visible]] void set_uv0(float2 value, thread geometry_data_t &data);
    [[visible]] void set_model_position_offset(float3 value, thread geometry_data_t &data);
    [[visible]] float4 color(thread geometry_data_t &data);
    [[visible]] void set_custom_attribute(float4 value, thread geometry_data_t &data);
    }
    struct uniforms {
      thread geometry_data_t &data;
      inline __attribute__((__always_inline__)) float4x4 model_to_view() const thread {
        return api::model_to_view(data);
      }
    };
    struct geometry {
      thread geometry_data_t &data;
      inline __attribute__((__always_inline__)) float2 uv0() const thread { return api::uv0(data); }
      inline __attribute__((__always_inline__)) void set_uv0(float2 v) thread { api::set_uv0(v, data); }
      inline __attribute__((__always_inline__)) void set_model_position_offset(float3 v) thread {
        api::set_model_position_offset(v, data);
      }
      inline __attribute__((__always_inline__)) float4 color() const thread { return api::color(data); }
      inline __attribute__((__always_inline__)) void set_custom_attribute(float4 v) thread {
        api::set_custom_attribute(v, data);
      }
    };
    }
    struct geometry_parameters {
      thread geometry_modifier::geometry_data_t &data;
      inline __attribute__((__always_inline__)) geometry_modifier::uniforms uniforms() const thread {
        return {data};
      }
      inline __attribute__((__always_inline__)) geometry_modifier::geometry geometry() thread {
        return {data};
      }
    };
    namespace surface {
    struct surface_data_t;
    namespace api {
    [[visible]] float2 uv0(thread surface_data_t &data);
    [[visible]] float4 color(thread surface_data_t &data);
    [[visible]] float4 custom_attribute(thread surface_data_t &data);
    [[visible]] void set_base_color(half3 value, thread surface_data_t &data);
    [[visible]] void set_emissive_color(half3 value, thread surface_data_t &data);
    [[visible]] void set_opacity(half value, thread surface_data_t &data);
    }
    struct geometry {
      thread surface_data_t &data;
      inline __attribute__((__always_inline__)) float2 uv0() const thread { return api::uv0(data); }
      inline __attribute__((__always_inline__)) float4 color() const thread { return api::color(data); }
      inline __attribute__((__always_inline__)) float4 custom_attribute() const thread {
        return api::custom_attribute(data);
      }
    };
    struct surface_properties {
      thread surface_data_t &data;
      inline __attribute__((__always_inline__)) void set_base_color(half3 v) thread {
        api::set_base_color(v, data);
      }
      inline __attribute__((__always_inline__)) void set_emissive_color(half3 v) thread {
        api::set_emissive_color(v, data);
      }
      inline __attribute__((__always_inline__)) void set_opacity(half v) thread {
        api::set_opacity(v, data);
      }
    };
    }
    struct surface_parameters {
      thread surface::surface_data_t &data;
      inline __attribute__((__always_inline__)) surface::geometry geometry() const thread {
        return {data};
      }
      inline __attribute__((__always_inline__)) surface::surface_properties surface() thread {
        return {data};
      }
    };
    }
    #endif

    [[visible]]
    void threeLiveSplatGeometry(realitykit::geometry_parameters params) {
      auto geo = params.geometry();
      float2 offset = geo.uv0();
      float4x4 mv = params.uniforms().model_to_view();
      float3 c0 = normalize(mv[0].xyz);
      float3 c1 = normalize(mv[1].xyz);
      float3 c2 = normalize(mv[2].xyz);
      float3 rightModel = float3(c0.x, c1.x, c2.x);
      float3 upModel = float3(c0.y, c1.y, c2.y);
      geo.set_model_position_offset(rightModel * offset.x + upModel * offset.y);
      geo.set_uv0(sign(offset) * 0.5f + 0.5f);
      geo.set_custom_attribute(geo.color());
    }

    [[visible]]
    void threeLiveSplatSurface(realitykit::surface_parameters params) {
      auto geo = params.geometry();
      float2 d = geo.uv0() * 2.0f - 1.0f;
      float r2 = dot(d, d);
      float w = (r2 > 1.0f) ? 0.0f : exp(-4.0f * r2);
      float4 col = geo.custom_attribute();
      if (col.a <= 0.0f && dot(col.rgb, col.rgb) <= 0.0f) {
        col = geo.color();
      }
      if (col.a <= 0.0f && dot(col.rgb, col.rgb) <= 0.0f) {
        col = float4(1.0f, 1.0f, 1.0f, 1.0f);
      }
      auto surf = params.surface();
      surf.set_base_color(half3(col.rgb));
      surf.set_emissive_color(half3(col.rgb));
      surf.set_opacity(half(col.a * w));
    }
    """

  #if canImport(Metal)
    /// Compiles `metalShaderSource` into an `MTLLibrary` suitable for RealityKit `CustomMaterial`,
    /// or returns `nil` if the device does not support visible functions (Metal 2.3+).
    public static func makeMetalLibrary(
      device: MTLDevice? = MTLCreateSystemDefaultDevice()
    ) -> MTLLibrary? {
      guard let device = device else { return nil }
      let options = MTLCompileOptions()
      if #available(iOS 15.0, macOS 12.0, tvOS 15.0, visionOS 1.0, *) {
        options.languageVersion = .version2_4
      }
      return try? device.makeLibrary(source: metalShaderSource, options: options)
    }
  #endif

  /// Generates a `size x size` RGBA8 radial Gaussian falloff image (`exp(-4 * r^2)` for `r <= 1`).
  public static func gaussianFalloffRGBA(size: Int = 64) -> [UInt8] {
    let n = max(4, min(size, 256))
    var out = [UInt8](repeating: 255, count: n * n * 4)
    let half = Double(n - 1) * 0.5
    for y in 0..<n {
      let dy = (Double(y) - half) / half
      for x in 0..<n {
        let dx = (Double(x) - half) / half
        let r2 = dx * dx + dy * dy
        let a = r2 > 1.0 ? 0 : Int((255.0 * exp(-4.0 * r2)).rounded()).clamped(to: 0...255)
        out[(y * n + x) * 4 + 3] = UInt8(a)
      }
    }
    return out
  }

  /// Downloads and decodes a `.splat` / `.spz` file from `url`, enforcing `resolveSplatURL` and
  /// `maxFileBytes`.
  public static func loadURL(
    _ url: String,
    baseURL: String? = nil,
    allowCrossOrigin: Bool = true,
    maxBytes: Int = maxFileBytes
  ) async throws -> SplatData {
    guard let resolved = resolveSplatURL(url, baseURL: baseURL, allowCrossOrigin: allowCrossOrigin) else {
      throw SplatParserError.badMagic
    }
    let (data, response) = try await URLSession.shared.data(from: resolved)
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
      throw SplatParserError.decompressionFailed
    }
    if data.count > maxBytes { throw SplatParserError.fileTooLarge }
    return try parse(data, fileName: resolved.lastPathComponent)
  }
}

private extension Comparable {
  func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}
