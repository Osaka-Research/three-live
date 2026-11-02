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

/// Pure protocol validation, optimistic soft-lock lease resolution, and 3D peer avatar / laser
/// geometry helpers for `shared-room` (mirrors `xr-live/src/plugins/shared-room.ts`).
public enum SharedRoom {
  public static let maxPayloadBytes = 16384
  public static let maxPeers = 16
  public static let peerTimeoutMs: Int64 = 5000
  public static let poseTickIntervalMs: Int64 = 50
  public static let softLockTtlMs: Int64 = 2000
  public static let maxPeerNameChars = 32
  public static let maxRemoteStrokes = 64
  /// Maximum remote paint strokes accepted per peer per second (GPU churn guard).
  public static let maxPaintMessagesPerSec = 8
  public static let maxStrokeChunkPoints = 128
  public static let defaultPeerColor = "#38bdf8"

  /// Optimistic soft-lock lease on a synchronized scene node.
  public struct NodeSoftLock: Sendable, Equatable {
    public let ownerPeerId: String
    public let leaseUntilMs: Int64

    public init(ownerPeerId: String, leaseUntilMs: Int64) {
      self.ownerPeerId = ownerPeerId
      self.leaseUntilMs = leaseUntilMs
    }
  }

  /// Validated `v: 1` room wire messages.
  public enum WireMessage: Sendable, Equatable {
    case pose(
      peerId: String,
      name: String,
      color: String,
      headPos: SIMD3<Float>,
      headQuat: simd_quatf,
      rayOrigin: SIMD3<Float>?,
      rayEnd: SIMD3<Float>?,
      hasHit: Bool
    )
    case node(
      peerId: String,
      nodeId: String,
      p: SIMD3<Float>,
      q: simd_quatf,
      s: SIMD3<Float>,
      grabState: String
    )
    case explode(peerId: String, factor: Float)
    case paint(
      peerId: String,
      strokeId: String,
      color: String,
      radius: Float,
      points: [SIMD3<Float>]
    )
    case leave(peerId: String)

    public var peerId: String {
      switch self {
      case .pose(let id, _, _, _, _, _, _, _),
        .node(let id, _, _, _, _, _),
        .explode(let id, _),
        .paint(let id, _, _, _, _),
        .leave(let id):
        return id
      }
    }
  }

  /// Accepts `wss://` endpoints or loopback `ws://localhost` / `ws://127.0.0.1` / `ws://[::1]`.
  public static func isAllowedRoomUrl(_ raw: String?) -> Bool {
    guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmed.isEmpty, trimmed.count <= 2048,
      let comps = URLComponents(string: trimmed),
      let scheme = comps.scheme?.lowercased(),
      let host = comps.host?.lowercased(), !host.isEmpty
    else { return false }
    if scheme == "wss" { return true }
    return scheme == "ws"
      && (host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]")
  }

  /// Sanitizes an untrusted peer display name (plain text only, max 32 chars).
  public static func sanitizePeerName(_ raw: String?) -> String {
    guard let raw = raw else { return "Peer" }
    let filtered = String(
      raw.unicodeScalars.filter { $0.value >= 0x20 && $0.value != 0x7F })
      .trimmingCharacters(in: .whitespacesAndNewlines)
    if filtered.isEmpty { return "Peer" }
    return String(filtered.prefix(maxPeerNameChars))
  }

  /// Sanitizes a `#rrggbb` / `#rgb` peer color string.
  public static func sanitizePeerColor(_ raw: String?) -> String {
    XRJSON.safeHexColor(raw, fallback: defaultPeerColor)
  }

  /// Returns whether `candidatePeerId` may acquire or renew a soft-lock at `atMs`.
  public static func canAcquireNodeLease(
    existing: NodeSoftLock?,
    candidatePeerId: String,
    atMs: Int64
  ) -> Bool {
    guard let existing = existing else { return true }
    if existing.ownerPeerId == candidatePeerId { return true }
    return atMs >= existing.leaseUntilMs
  }

  private static func q4(_ v: Double) -> Double {
    (v * 10000).rounded() / 10000
  }

  private static func parseBoundedVec3(_ raw: Any?, maxAbs: Double = 1000) -> SIMD3<Float>? {
    guard let arr = XRJSON.array(raw), arr.count >= 3,
      let x = XRJSON.number(arr[0]), let y = XRJSON.number(arr[1]), let z = XRJSON.number(arr[2]),
      x.isFinite, y.isFinite, z.isFinite
    else { return nil }
    return SIMD3<Float>(
      Float(q4(XRJSON.clampNum(x, -maxAbs, maxAbs, 0))),
      Float(q4(XRJSON.clampNum(y, -maxAbs, maxAbs, 0))),
      Float(q4(XRJSON.clampNum(z, -maxAbs, maxAbs, 0)))
    )
  }

  private static func parseUnitQuat(_ raw: Any?) -> simd_quatf? {
    guard let arr = XRJSON.array(raw), arr.count >= 4,
      let x = XRJSON.number(arr[0]), let y = XRJSON.number(arr[1]),
      let z = XRJSON.number(arr[2]), let w = XRJSON.number(arr[3]),
      x.isFinite, y.isFinite, z.isFinite, w.isFinite
    else { return nil }
    let len = (x * x + y * y + z * z + w * w).squareRoot()
    guard len.isFinite, len >= 1e-6 else { return nil }
    return simd_quatf(
      ix: Float(q4(x / len)),
      iy: Float(q4(y / len)),
      iz: Float(q4(z / len)),
      r: Float(q4(w / len))
    )
  }

  /// Parses and validates an untrusted UTF-8 JSON room message, or returns `nil`.
  public static func parseMessage(_ rawJson: String?) -> WireMessage? {
    guard let rawJson = rawJson, !rawJson.isEmpty, rawJson.count <= maxPayloadBytes,
      let data = rawJson.data(using: .utf8), data.count <= maxPayloadBytes,
      let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let version = XRJSON.number(root["v"]), Int(version) == 1,
      let peerId = XRLiveTraitParser.safeAnchorId(XRJSON.string(root["peerId"])),
      let type = XRJSON.string(root["type"])
    else { return nil }

    switch type {
    case "pose":
      guard let headPos = parseBoundedVec3(root["headPos"]),
        let headQuat = parseUnitQuat(root["headQuat"])
      else { return nil }
      let ro = parseBoundedVec3(root["rayOrigin"])
      let re = parseBoundedVec3(root["rayEnd"])
      return .pose(
        peerId: peerId,
        name: sanitizePeerName(XRJSON.string(root["name"])),
        color: sanitizePeerColor(XRJSON.string(root["color"])),
        headPos: headPos,
        headQuat: headQuat,
        rayOrigin: (ro != nil && re != nil) ? ro : nil,
        rayEnd: (ro != nil && re != nil) ? re : nil,
        hasHit: (XRJSON.bool(root["hasHit"]) == true) && ro != nil && re != nil
      )
    case "node":
      guard let nodeId = XRLiveTraitParser.safeAnchorId(XRJSON.string(root["nodeId"])),
        let p = parseBoundedVec3(root["p"]),
        let q = parseUnitQuat(root["q"]),
        let sArr = XRJSON.array(root["s"]), sArr.count >= 3,
        let sx = XRJSON.number(sArr[0]), let sy = XRJSON.number(sArr[1]),
        let sz = XRJSON.number(sArr[2]),
        sx.isFinite, sy.isFinite, sz.isFinite,
        let clean = PersistentAnchors.sanitizePose(
          p: p, q: q, s: SIMD3<Float>(Float(sx), Float(sy), Float(sz)))
      else { return nil }
      let gsRaw = XRJSON.string(root["grabState"])
      let gs = (gsRaw == "grab" || gsRaw == "release") ? gsRaw! : "move"
      return .node(
        peerId: peerId, nodeId: nodeId, p: clean.p, q: clean.q, s: clean.s, grabState: gs)
    case "explode":
      guard let f = XRJSON.number(root["factor"]), f.isFinite else { return nil }
      return .explode(peerId: peerId, factor: Float(q4(XRJSON.clampNum(f, 0, 1, 0))))
    case "paint":
      guard let strokeId = XRLiveTraitParser.safeAnchorId(XRJSON.string(root["strokeId"])),
        let rawPts = XRJSON.array(root["points"]),
        rawPts.count >= 2, rawPts.count <= maxStrokeChunkPoints
      else { return nil }
      var pts: [SIMD3<Float>] = []
      pts.reserveCapacity(rawPts.count)
      for item in rawPts {
        guard let pt = parseBoundedVec3(item) else { return nil }
        pts.append(pt)
      }
      return .paint(
        peerId: peerId,
        strokeId: strokeId,
        color: sanitizePeerColor(XRJSON.string(root["color"])),
        radius: Float(XRJSON.clampNum(root["radius"], 0.002, 0.1, 0.01)),
        points: pts
      )
    case "leave":
      return .leave(peerId: peerId)
    default:
      return nil
    }
  }

  /// Serializes a validated `WireMessage` to compact UTF-8 JSON.
  public static func serializeMessage(_ msg: WireMessage) -> String {
    var dict: [String: Any] = ["v": 1]
    switch msg {
    case .pose(let peerId, let name, let color, let headPos, let headQuat, let ro, let re, let hit):
      dict["type"] = "pose"
      dict["peerId"] = peerId
      dict["name"] = sanitizePeerName(name)
      dict["color"] = sanitizePeerColor(color)
      dict["headPos"] = [q4(Double(headPos.x)), q4(Double(headPos.y)), q4(Double(headPos.z))]
      dict["headQuat"] = [
        q4(Double(headQuat.imag.x)), q4(Double(headQuat.imag.y)),
        q4(Double(headQuat.imag.z)), q4(Double(headQuat.real)),
      ]
      if let ro = ro, let re = re {
        dict["rayOrigin"] = [q4(Double(ro.x)), q4(Double(ro.y)), q4(Double(ro.z))]
        dict["rayEnd"] = [q4(Double(re.x)), q4(Double(re.y)), q4(Double(re.z))]
        dict["hasHit"] = hit
      } else {
        dict["rayOrigin"] = NSNull()
        dict["rayEnd"] = NSNull()
        dict["hasHit"] = false
      }
    case .node(let peerId, let nodeId, let p, let q, let s, let grabState):
      dict["type"] = "node"
      dict["peerId"] = peerId
      dict["nodeId"] = nodeId
      dict["p"] = [q4(Double(p.x)), q4(Double(p.y)), q4(Double(p.z))]
      dict["q"] = [
        q4(Double(q.imag.x)), q4(Double(q.imag.y)), q4(Double(q.imag.z)), q4(Double(q.real)),
      ]
      dict["s"] = [q4(Double(s.x)), q4(Double(s.y)), q4(Double(s.z))]
      dict["grabState"] = grabState
    case .explode(let peerId, let factor):
      dict["type"] = "explode"
      dict["peerId"] = peerId
      dict["factor"] = q4(XRJSON.clampNum(Double(factor), 0, 1, 0))
    case .paint(let peerId, let strokeId, let color, let radius, let points):
      dict["type"] = "paint"
      dict["peerId"] = peerId
      dict["strokeId"] = strokeId
      dict["color"] = sanitizePeerColor(color)
      dict["radius"] = q4(Double(radius))
      dict["points"] = points.map { [q4(Double($0.x)), q4(Double($0.y)), q4(Double($0.z))] }
    case .leave(let peerId):
      dict["type"] = "leave"
      dict["peerId"] = peerId
    }
    guard let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
      let str = String(data: data, encoding: .utf8)
    else { return "{}" }
    return str
  }

  /// Builds a stylized visor box (`0.20m × 0.085m × 0.11m`) for remote peer avatars.
  public static func buildPeerVisorGeometry() -> XRGeneratedGeometry {
    let half = SIMD3<Float>(0.10, 0.0425, 0.055)
    let faces: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>)] = [
      (SIMD3(1, 0, 0), SIMD3(0, 1, 0), SIMD3(0, 0, 1)),
      (SIMD3(-1, 0, 0), SIMD3(0, 1, 0), SIMD3(0, 0, -1)),
      (SIMD3(0, 1, 0), SIMD3(0, 0, 1), SIMD3(1, 0, 0)),
      (SIMD3(0, -1, 0), SIMD3(0, 0, -1), SIMD3(1, 0, 0)),
      (SIMD3(0, 0, 1), SIMD3(1, 0, 0), SIMD3(0, 1, 0)),
      (SIMD3(0, 0, -1), SIMD3(-1, 0, 0), SIMD3(0, 1, 0)),
    ]
    let corners: [(Float, Float)] = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    var positions: [Float] = []
    var normals: [Float] = []
    var indices: [UInt32] = []
    positions.reserveCapacity(72)
    normals.reserveCapacity(72)
    indices.reserveCapacity(36)
    for (f, (n, u, v)) in faces.enumerated() {
      for (a, b) in corners {
        let p = (n + u * a + v * b) * half
        positions.append(contentsOf: [p.x, p.y, p.z])
        normals.append(contentsOf: [n.x, n.y, n.z])
      }
      let base = UInt32(f * 4)
      indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }

  /// Builds a pointer laser bar (plus optional hit cross) for a remote peer.
  public static func buildPeerLaserGeometry(
    origin: SIMD3<Float>,
    end: SIMD3<Float>,
    hasHit: Bool
  ) -> XRGeneratedGeometry {
    if simd_length(end - origin) < 1e-4 {
      return XRGeneratedGeometry(positions: [], normals: [], indices: [])
    }
    if !hasHit {
      return SpatialMeasure.buildSegmentBarsGeometry([(origin, end)], halfThickness: 0.003)
    }
    let tipStart = SIMD3<Float>(end.x, end.y - 0.012, end.z)
    let tipEnd = SIMD3<Float>(end.x, end.y + 0.012, end.z)
    return SpatialMeasure.buildSegmentBarsGeometry(
      [(origin, end), (tipStart, tipEnd)], halfThickness: 0.004)
  }
}
