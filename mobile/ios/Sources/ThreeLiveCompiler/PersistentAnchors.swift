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
import simd

/// Pure serialization, sanitization, and URL-hash codec for `persistent-anchors`
/// (`xr-live/src/plugins/persistent-anchors.ts`).
public enum PersistentAnchors {
  public static let maxPersistedNodes = 128
  public static let maxHashBytes = 8192
  public static let anchorStoragePrefix = "xr-live:anchors:"

  public struct PersistedPose: Sendable, Equatable {
    public var p: SIMD3<Float>
    public var q: simd_quatf
    public var s: SIMD3<Float>
    public var xrAnchorUuid: String?

    public init(
      p: SIMD3<Float>, q: simd_quatf, s: SIMD3<Float>, xrAnchorUuid: String? = nil
    ) {
      self.p = p
      self.q = q
      self.s = s
      self.xrAnchorUuid = xrAnchorUuid
    }
  }

  private static func round4(_ v: Double) -> Float {
    Float((v * 10000.0).rounded() / 10000.0)
  }

  /// Validates and clamps an untrusted persisted pose record. Returns `nil` when any coordinate,
  /// quaternion component, or scale component is non-finite or degenerate.
  public static func sanitizePose(
    p: SIMD3<Float>,
    q: simd_quatf,
    s: SIMD3<Float>,
    xrAnchorUuid: String? = nil
  ) -> PersistedPose? {
    guard p.x.isFinite, p.y.isFinite, p.z.isFinite,
      s.x.isFinite, s.y.isFinite, s.z.isFinite
    else { return nil }
    let qv = q.vector
    guard qv.x.isFinite, qv.y.isFinite, qv.z.isFinite, qv.w.isFinite else { return nil }
    let qLen = Double(simd_length(qv))
    guard qLen.isFinite, qLen >= 1e-6 else { return nil }

    let sp = SIMD3<Float>(
      round4(XRJSON.clampNum(Double(p.x), -1000, 1000, 0)),
      round4(XRJSON.clampNum(Double(p.y), -1000, 1000, 0)),
      round4(XRJSON.clampNum(Double(p.z), -1000, 1000, 0))
    )
    let sq = simd_quatf(
      ix: round4(Double(qv.x) / qLen),
      iy: round4(Double(qv.y) / qLen),
      iz: round4(Double(qv.z) / qLen),
      r: round4(Double(qv.w) / qLen)
    )
    let ss = SIMD3<Float>(
      round4(XRJSON.clampNum(Double(s.x), 0.001, 1000, 1)),
      round4(XRJSON.clampNum(Double(s.y), 0.001, 1000, 1)),
      round4(XRJSON.clampNum(Double(s.z), 0.001, 1000, 1))
    )
    return PersistedPose(
      p: sp, q: sq, s: ss, xrAnchorUuid: XRLiveTraitParser.safeAnchorId(xrAnchorUuid))
  }

  private static func parseFloatArray(_ raw: Any?, expectedCount: Int) -> [Float]? {
    guard let arr = XRJSON.array(raw), arr.count >= expectedCount else { return nil }
    var out: [Float] = []
    out.reserveCapacity(expectedCount)
    for i in 0..<expectedCount {
      guard let d = XRJSON.number(arr[i]), d.isFinite else { return nil }
      out.append(Float(d))
    }
    return out
  }

  /// Serializes a validated node pose map into a compact UTF-8 JSON string.
  public static func serializePayload(
    _ poses: [String: PersistedPose],
    updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
  ) -> String {
    var nodes: [String: Any] = [:]
    for key in poses.keys.sorted() {
      if nodes.count >= maxPersistedNodes { break }
      guard let safeKey = XRLiveTraitParser.safeAnchorId(key),
        let pose = poses[key],
        let clean = sanitizePose(
          p: pose.p, q: pose.q, s: pose.s, xrAnchorUuid: pose.xrAnchorUuid)
      else { continue }
      let qv = clean.q.vector
      var entry: [String: Any] = [
        "p": [clean.p.x, clean.p.y, clean.p.z],
        "q": [qv.x, qv.y, qv.z, qv.w],
        "s": [clean.s.x, clean.s.y, clean.s.z],
      ]
      if let uuid = clean.xrAnchorUuid { entry["xrAnchorUuid"] = uuid }
      nodes[safeKey] = entry
    }
    let root: [String: Any] = [
      "version": 1,
      "updatedAt": updatedAt,
      "nodes": nodes,
    ]
    guard let data = try? JSONSerialization.data(withJSONObject: root, options: []),
      let str = String(data: data, encoding: .utf8)
    else { return "{\"version\":1,\"nodes\":{}}" }
    return str
  }

  /// Parses and sanitizes a JSON payload from storage or decoded URL hash.
  public static func deserializePayload(_ jsonText: String?) -> [String: PersistedPose]? {
    guard let text = jsonText, !text.isEmpty, text.utf8.count <= maxHashBytes * 2,
      let data = text.data(using: .utf8),
      let parsed = try? JSONSerialization.jsonObject(with: data, options: []),
      let root = XRJSON.object(parsed)
    else { return nil }
    if let ver = root["version"], !(ver is NSNull) {
      guard let vNum = XRJSON.number(ver), vNum.isFinite, vNum == 1 else { return nil }
    }
    guard let rawNodes = XRJSON.object(root["nodes"]) else { return nil }
    var out: [String: PersistedPose] = [:]
    for (rawKey, rawVal) in rawNodes {
      if out.count >= maxPersistedNodes { break }
      guard let safeKey = XRLiveTraitParser.safeAnchorId(rawKey) else { continue }
      guard let obj = XRJSON.object(rawVal),
        let p = parseFloatArray(obj["p"], expectedCount: 3),
        let q = parseFloatArray(obj["q"], expectedCount: 4),
        let s = parseFloatArray(obj["s"], expectedCount: 3),
        let clean = sanitizePose(
          p: SIMD3<Float>(p[0], p[1], p[2]),
          q: simd_quatf(ix: q[0], iy: q[1], iz: q[2], r: q[3]),
          s: SIMD3<Float>(s[0], s[1], s[2]),
          xrAnchorUuid: XRJSON.string(obj["xrAnchorUuid"])
        )
      else { return nil }
      out[safeKey] = clean
    }
    return out
  }

  /// Encodes a node pose map into a compact base64url token suitable for `#xr-state=`.
  public static func encodeState(
    _ poses: [String: PersistedPose],
    updatedAt: Int64 = Int64(Date().timeIntervalSince1970 * 1000)
  ) -> String {
    let json = serializePayload(poses, updatedAt: updatedAt)
    return Data(json.utf8)
      .base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  /// Decodes and validates a compact base64url token from `#xr-state=`.
  public static func decodeState(_ token: String?) -> [String: PersistedPose]? {
    guard let t = token, !t.isEmpty, t.utf8.count <= maxHashBytes else { return nil }
    for scalar in t.unicodeScalars {
      let v = scalar.value
      let isAlphaNum =
        (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
      if !isAlphaNum && v != 0x2D && v != 0x5F { return nil }
    }
    var padded = t.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    let rem = padded.count % 4
    if rem > 0 { padded += String(repeating: "=", count: 4 - rem) }
    guard let data = Data(base64Encoded: padded),
      let json = String(data: data, encoding: .utf8)
    else { return nil }
    return deserializePayload(json)
  }

  /// Extracts `xr-state` from a URL fragment (`"#foo=1&xr-state=abc"`).
  public static func extractHashToken(_ hash: String?) -> String? {
    guard let h = hash, !h.isEmpty else { return nil }
    let clean = h.hasPrefix("#") ? String(h.dropFirst()) : h
    for part in clean.split(separator: "&") {
      if part.hasPrefix("xr-state=") {
        let token = String(part.dropFirst("xr-state=".count))
        return (!token.isEmpty && token.utf8.count <= maxHashBytes) ? token : nil
      }
    }
    return nil
  }

  /// Injects or removes `xr-state=<token>` in a URL fragment while preserving other params.
  public static func injectHashToken(existingHash: String?, token: String?) -> String {
    let clean = (existingHash ?? "").hasPrefix("#")
      ? String((existingHash ?? "").dropFirst()) : (existingHash ?? "")
    var parts = clean.split(separator: "&").map(String.init).filter {
      !$0.isEmpty && !$0.hasPrefix("xr-state=")
    }
    if let t = token, !t.isEmpty, t.utf8.count <= maxHashBytes {
      parts.append("xr-state=\(t)")
    }
    return parts.isEmpty ? "" : "#\(parts.joined(separator: "&"))"
  }
}

// MARK: - Spatial Locomotion
