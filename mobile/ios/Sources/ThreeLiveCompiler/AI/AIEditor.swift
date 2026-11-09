// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Foundation
import simd

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif
#if canImport(UIKit)
  import UIKit
#endif
#if canImport(ARKit) && os(iOS)
  import ARKit
#endif

/// One chat message sent to an AI provider.
public struct AIChatMessage: Sendable, Equatable {
  public let role: String
  public let content: String
  public let imageUrls: [String]

  public init(role: String, content: String, imageUrls: [String] = []) {
    self.role = role
    self.content = content
    self.imageUrls = imageUrls
  }
}

/// A pluggable code model (any LLM). Mirrors `ThreeLiveAIProvider` on the web.
public protocol AIProvider: AnyObject {
  func complete(_ messages: [AIChatMessage]) async throws -> String
}

/// Provider and protocol failures.
public struct AIEditError: Error, LocalizedError, Equatable {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

/// `ai-chat`: any Chat Completions-compatible endpoint (your backend proxy, Ollama, LM Studio,
/// vLLM, OpenRouter, the Gemini compatibility endpoint, ...).
///
/// API keys never belong in an app: point `endpoint` at your own proxy (or a local model), or
/// pass short-lived credentials in `headers`.
public final class AIChatProvider: AIProvider, @unchecked Sendable {
  private let endpoint: URL
  private let model: String?
  private let headers: [String: String]
  private let temperature: Double
  private let timeout: TimeInterval
  private let session: URLSession

  /// Returns `nil` unless `endpoint` is `https://` (or `http://` to a loopback host).
  public init?(
    endpoint: String, model: String? = nil, headers: [String: String] = [:],
    temperature: Double = 0.2, timeout: TimeInterval = 120, session: URLSession = .shared
  ) {
    guard Self.isAllowedEndpoint(endpoint), let url = URL(string: endpoint) else { return nil }
    self.endpoint = url
    self.model = model
    self.headers = headers
    self.temperature = temperature
    self.timeout = timeout
    self.session = session
  }

  public static func isAllowedEndpoint(_ raw: String) -> Bool {
    guard let url = URL(string: raw), let scheme = url.scheme?.lowercased(), let host = url.host
    else { return false }
    if scheme == "https" { return true }
    return scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
  }

  public func complete(_ messages: [AIChatMessage]) async throws -> String {
    let serializedMessages: [[String: Any]] = messages.map { msg in
      let content: Any
      if msg.imageUrls.isEmpty {
        content = msg.content
      } else {
        content =
          msg.imageUrls.map { ["type": "image_url", "image_url": ["url": $0]] }
          + [["type": "text", "text": msg.content]]
      }
      return ["role": msg.role, "content": content]
    }
    var body: [String: Any] = [
      "messages": serializedMessages,
      "temperature": temperature,
      "stream": false,
    ]
    if let model = model, !model.isEmpty { body["model"] = model }
    var request = URLRequest(url: endpoint, timeoutInterval: timeout)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    for (k, v) in headers where !v.contains("\r") && !v.contains("\n") {
      request.setValue(v, forHTTPHeaderField: k)
    }
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await session.data(for: request)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    let text = String(data: data, encoding: .utf8) ?? ""
    guard (200..<300).contains(status) else {
      throw AIEditError("ai-chat: HTTP \(status) from endpoint: \(text.prefix(300))")
    }
    return try Self.parseContent(data)
  }

  /// Extracts `choices[0].message.content` (a string or an array of text parts).
  public static func parseContent(_ data: Data) throws -> String {
    guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      throw AIEditError("ai-chat: endpoint returned non-JSON content.")
    }
    let message =
      ((root["choices"] as? [Any])?.first as? [String: Any])?["message"] as? [String: Any]
    var text: String?
    if let s = message?["content"] as? String {
      text = s
    } else if let parts = message?["content"] as? [Any] {
      text = parts.map { ($0 as? String) ?? (($0 as? [String: Any])?["text"] as? String ?? "") }
        .joined()
    }
    guard let out = text, !out.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      throw AIEditError("ai-chat: response had no message content.")
    }
    return out
  }
}

/// The shared Rust core (`three_live_ai_call`): prompts, reply parsing, edit validation, and the
/// realtime voice protocols, identical to the web plugin. Injectable for tests.
public protocol AICore: AnyObject {
  func call(_ request: [String: Any]) async throws -> [String: Any]
}

/// `AICore` backed by the native compiler.
public final class NativeAICore: AICore, @unchecked Sendable {
  public static let shared = NativeAICore()

  public init() {}

  public func call(_ request: [String: Any]) async throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: request)
    let text = String(decoding: data, as: UTF8.self)
    // `validate` / `image_validate` (and `select` / `select_messages` with a `source`) run the
    // scene on the compiler thread; the other ops are pure.
    let op = request["op"] as? String ?? ""
    let usesEngine =
      op == "validate" || op == "image_validate"
      || ((op == "select" || op == "select_messages") && request["source"] != nil)
    let reply = try await ThreeCompiler.aiCall(text, onCompilerThread: usesEngine)
    guard let obj = (try? JSONSerialization.jsonObject(with: Data(reply.utf8))) as? [String: Any]
    else { throw AIEditError("invalid response from native core") }
    return obj
  }
}

/// Camera that "left", "right", and "front" in spoken references are relative to (world space).
public struct AICamera: Sendable, Equatable {
  public var eye: [Double]
  public var target: [Double]

  public init(eye: [Double], target: [Double]) {
    self.eye = eye
    self.target = target
  }
}

/// One metric plane prior (`horizontal` or `vertical`) forwarded to `AIEditor.compileFromImage`.
public struct AISpatialPlane: Sendable, Equatable {
  public var label: String?
  public var orientation: String
  public var center: [Double]
  public var extent: [Double]?
  public var normal: [Double]?

  public init(
    orientation: String, center: [Double], extent: [Double]? = nil, normal: [Double]? = nil,
    label: String? = nil
  ) {
    self.orientation = orientation
    self.center = center
    self.extent = extent
    self.normal = normal
    self.label = label
  }

  public func toDictionary() -> [String: Any] {
    var out: [String: Any] = ["orientation": orientation, "center": center]
    if let label, !label.isEmpty { out["label"] = label }
    if let extent, extent.allSatisfy({ $0.isFinite }) { out["extent"] = extent }
    if let normal, normal.allSatisfy({ $0.isFinite }) { out["normal"] = normal }
    return out
  }
}

/// One metric 3D object prior forwarded to `AIEditor.compileFromImage`.
public struct AISpatialObject: Sendable, Equatable {
  public var label: String
  public var center: [Double]
  public var size: [Double]?
  public var yawDeg: Double?

  public init(label: String, center: [Double], size: [Double]? = nil, yawDeg: Double? = nil) {
    self.label = label
    self.center = center
    self.size = size
    self.yawDeg = yawDeg
  }

  public func toDictionary() -> [String: Any] {
    var out: [String: Any] = ["label": label, "center": center]
    if let size, size.allSatisfy({ $0.isFinite }) { out["size"] = size }
    if let yawDeg, yawDeg.isFinite { out["yawDeg"] = yawDeg }
    return out
  }
}

/// Optional metric spatial priors forwarded to `AIEditor.compileFromImage`.
public struct AISpatialPriors: Sendable, Equatable {
  public var floorY: Double?
  public var camera: AICamera?
  public var cameraFovDeg: Double?
  public var planes: [AISpatialPlane]
  public var objects: [AISpatialObject]

  public init(
    floorY: Double? = nil, camera: AICamera? = nil, cameraFovDeg: Double? = nil,
    planes: [AISpatialPlane] = [], objects: [AISpatialObject] = []
  ) {
    self.floorY = floorY
    self.camera = camera
    self.cameraFovDeg = cameraFovDeg
    self.planes = planes
    self.objects = objects
  }

  public func toDictionary() -> [String: Any] {
    var out: [String: Any] = [:]
    if let floorY, floorY.isFinite { out["floorY"] = floorY }
    if let camera, camera.eye.allSatisfy({ $0.isFinite }), camera.target.allSatisfy({ $0.isFinite })
    {
      var cam: [String: Any] = ["eye": camera.eye, "target": camera.target]
      if let fov = cameraFovDeg, fov.isFinite { cam["fovDeg"] = fov }
      out["camera"] = cam
    }
    let validPlanes = planes.filter { $0.center.count >= 3 && $0.center.allSatisfy { $0.isFinite } }
      .map { $0.toDictionary() }
    if !validPlanes.isEmpty { out["planes"] = validPlanes }
    let validObjects = objects.filter {
      $0.center.count >= 3 && $0.center.allSatisfy { $0.isFinite }
    }.map { $0.toDictionary() }
    if !validObjects.isEmpty { out["objects"] = validObjects }
    return out
  }

  /// Builds `AISpatialPriors` from `WorldUnderstanding.TrackedPlane` and `WorldUnderstanding.Detection3D` snapshots.
  public static func fromWorldUnderstanding(
    planes: [WorldUnderstanding.TrackedPlane] = [],
    detections: [WorldUnderstanding.Detection3D] = [],
    camera: AICamera? = nil,
    floorY: Double? = nil
  ) -> AISpatialPriors {
    let mappedPlanes: [AISpatialPlane] = planes.prefix(32).map { p in
      let d = p.radius.isFinite && p.radius > 0 ? Double(p.radius) * 2.0 : nil
      return AISpatialPlane(
        orientation: p.orientation.rawValue,
        center: [Double(p.center.x), Double(p.center.y), Double(p.center.z)],
        extent: d.map { [$0, $0] },
        normal: [Double(p.normal.x), Double(p.normal.y), Double(p.normal.z)]
      )
    }
    let mappedObjects: [AISpatialObject] = detections.prefix(32).compactMap { det in
      let lbl = det.label.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !lbl.isEmpty else { return nil }
      let w = Double(det.widthMeters)
      let h = Double(det.heightMeters)
      let d = w.isFinite && w > 0 ? w : 0.3
      return AISpatialObject(
        label: lbl,
        center: [Double(det.position.x), Double(det.position.y), Double(det.position.z)],
        size: (w.isFinite && w > 0 && h.isFinite && h > 0) ? [w, h, d] : nil
      )
    }
    return AISpatialPriors(
      floorY: floorY, camera: camera, planes: mappedPlanes, objects: mappedObjects)
  }

  #if canImport(ARKit) && os(iOS)
    /// Extracts metric planes (`ARPlaneAnchor`), lowest floor Y, camera pose, and 3D detections from an `ARFrame`.
    public static func fromARFrame(
      _ frame: ARFrame, detections: [WorldUnderstanding.Detection3D] = []
    ) -> AISpatialPriors {
      let camM = frame.camera.transform
      let eye = SIMD3<Float>(camM.columns.3.x, camM.columns.3.y, camM.columns.3.z)
      let fwd = SIMD3<Float>(-camM.columns.2.x, -camM.columns.2.y, -camM.columns.2.z)
      let target = eye + fwd * 2.0
      let cam = AICamera(
        eye: [Double(eye.x), Double(eye.y), Double(eye.z)],
        target: [Double(target.x), Double(target.y), Double(target.z)]
      )
      var floorY: Double?
      var planes: [AISpatialPlane] = []
      for anchor in frame.anchors {
        guard let pa = anchor as? ARPlaneAnchor, planes.count < 32 else { continue }
        let m = pa.transform
        let localC = SIMD4<Float>(pa.center.x, pa.center.y, pa.center.z, 1)
        let worldC = m * localC
        let normal = SIMD3<Float>(m.columns.1.x, m.columns.1.y, m.columns.1.z)
        let orientation = pa.alignment == .vertical ? "vertical" : "horizontal"
        let w: Double
        let h: Double
        if #available(iOS 16.0, *) {
          w = Double(pa.planeExtent.width)
          h = Double(pa.planeExtent.height)
        } else {
          w = Double(pa.extent.x)
          h = Double(pa.extent.z)
        }
        let extent: [Double]? = (w.isFinite && w > 0 && h.isFinite && h > 0) ? [w, h] : nil
        let label: String?
        switch pa.classification {
        case .floor:
          label = "floor"
          let y = Double(worldC.y)
          if y.isFinite, floorY == nil || y < floorY! { floorY = y }
        case .table: label = "table"
        case .wall: label = "wall"
        case .ceiling: label = "ceiling"
        case .seat: label = "seat"
        case .door: label = "door"
        case .window: label = "window"
        default: label = nil
        }
        planes.append(
          AISpatialPlane(
            orientation: orientation,
            center: [Double(worldC.x), Double(worldC.y), Double(worldC.z)],
            extent: extent,
            normal: [Double(normal.x), Double(normal.y), Double(normal.z)],
            label: label
          ))
      }
      let base = fromWorldUnderstanding(
        planes: [], detections: detections, camera: cam, floorY: floorY)
      return AISpatialPriors(
        floorY: base.floorY, camera: base.camera, planes: planes, objects: base.objects)
    }
  #endif
}

/// Outcome of a spoken selection request (Talk-to-Select). Mirrors `AIVoiceSelection` on the web.
public struct AIVoiceSelection: Sendable, Equatable {
  /// `replace`, `add`, `remove`, or `clear`.
  public let mode: String
  public let query: String
  /// Whether the selection changed to what was asked.
  public let applied: Bool
  /// 1: resolved locally; 2: the code model resolved (or asked about) it.
  public let tier: Int
  /// The selection afterwards.
  public let meshes: [String]
  /// Meshes to offer when the reference was ambiguous.
  public let candidates: [String]
  /// What to say back: a confirmation, or a question when the reference was unclear.
  public let say: String
}

/// A parsed push-to-talk utterance (`parse_command` in the shared core).
public struct AIVoiceCommand: Sendable, Equatable {
  /// `clear`, `select`, `mixed` (select, then edit), or `edit`.
  public let kind: String
  /// `replace`, `add`, `remove`, or `clear`.
  public let mode: String
  /// The spoken reference (`select` / `mixed`).
  public let query: String
  /// The edit (`mixed` / `edit`).
  public let instruction: String
}

/// Result of `AIEditor.editScene`. Mirrors `EditSceneResult` on the web.
public struct EditResult: Sendable, Equatable {
  /// True when the edit compiled and was applied (or would be, for a dry run).
  public let applied: Bool
  /// The validated script (or the last rejected candidate).
  public let code: String
  /// Automatic repair turns used.
  public let repairs: Int
  /// Non-fatal compiler warnings.
  public let warnings: [String]
  /// Why the edit was rejected, when `applied` is false.
  public let error: String?
}

/// Bring-your-own-LLM scene editing for iOS / visionOS (B2b-3), with the same behavior as
/// `el.editScene()` on the web: the reply is compiled and checked by the shared core *before*
/// `applyScene` touches the live scene, and a failed compile gets one automatic repair turn.
///
/// ```swift
/// let editor = AIEditor(source: script, provider: AIChatProvider(endpoint: "https://your-backend.example/chat")!) { code in
///   let glb = try await ThreeCompiler.compile(code)
///   try await session.reload(glb)
/// }
/// // Tap-to-select: in your tap handler, `editor.toggleSelection(entity.name)`.
/// await editor.selectByVoice("the two red chairs on the left")  // Talk-to-Select
/// let result = await editor.editScene("make them blue")
/// ```
public final class AIEditor: @unchecked Sendable {
  public static let maxHistory = 20
  public static let superseded = "editScene superseded by a newer call"
  public static let imageSuperseded = "compileFromImage superseded by a newer call"
  public static let maxImageBytes = 32 * 1024 * 1024
  /// Most meshes one selection may hold (same as the web).
  public static let maxSelection = 50

  public var provider: AIProvider
  private let applyScene: (String) async throws -> Void
  private let core: AICore
  private let lock = NSLock()
  private var _source: String
  private var _selections: [String] = []
  private var history: [String] = []
  private var generation = 0

  /// Called before (`instruction`, `selection`) and after (`instruction`, `result`) each edit.
  public var onEditStart: ((String, String?) -> Void)?
  public var onEdit: ((String, EditResult) -> Void)?
  /// Called before (`prompt`) and after (`prompt`, `result`) each `compileFromImage` call.
  public var onImageStart: ((String) -> Void)?
  public var onImage: ((String, EditResult) -> Void)?
  /// Called when the first selected mesh changes (single-selection listeners).
  public var onSelectionChanged: ((String?) -> Void)?
  /// Called when the selection changes, with its source (`tap`, `voice`, or `api`).
  public var onSelectionsChanged: (([String], String) -> Void)?
  /// Camera for "left" / "right" / "front" in `selectByVoice` (default: the scene's camera).
  public var camera: AICamera?
  /// Let `provider` resolve references the local matcher can't (tier 2; default true).
  public var selectWithModel = true

  public init(
    source: String = "", provider: AIProvider, core: AICore = NativeAICore.shared,
    applyScene: @escaping (String) async throws -> Void
  ) {
    self._source = source
    self.provider = provider
    self.core = core
    self.applyScene = applyScene
  }

  /// Runs `body` under the lock (a synchronous helper, so async methods never call
  /// `NSLock.lock()` directly).
  private func locked<T>(_ body: () -> T) -> T {
    lock.lock()
    defer { lock.unlock() }
    return body()
  }

  /// The current scene script (the base for the next edit).
  public var source: String {
    lock.lock()
    defer { lock.unlock() }
    return _source
  }

  /// Meshes the next instruction refers to ("make *these* red"), set by taps or by voice.
  public var selections: [String] {
    get { locked { _selections } }
    set { assignSelection(newValue, source: "api") }
  }

  /// The first selected mesh (single-selection compatibility). Setting it replaces the selection.
  public var selection: String? {
    get { selections.first }
    set { selections = newValue.map { [$0] } ?? [] }
  }

  private static func clean(_ names: [String]) -> [String] {
    var out: [String] = []
    for n in names {
      let name = String(n.prefix(200))
      if !name.isEmpty && !out.contains(name) { out.append(name) }
      if out.count >= maxSelection { break }
    }
    return out
  }

  private func assignSelection(_ names: [String], source: String) {
    let v = Self.clean(names)
    let previous: [String]? = locked {
      if _selections == v { return nil }
      let p = _selections
      _selections = v
      return p
    }
    guard let previous else { return }
    onSelectionsChanged?(v, source)
    if previous.first != v.first { onSelectionChanged?(v.first) }
  }

  /// Tap-to-select: selects `meshName` (tapping the only selected mesh clears it). With `additive`
  /// (e.g. a long press), toggles `meshName` in the selection instead. Returns the first selected mesh.
  @discardableResult
  public func toggleSelection(_ meshName: String?, additive: Bool = false) -> String? {
    let current = selections
    let next: [String]
    if let name = meshName, !name.isEmpty {
      if additive {
        next = current.contains(name) ? current.filter { $0 != name } : current + [name]
      } else {
        next = current == [name] ? [] : [name]
      }
    } else {
      next = additive ? current : []
    }
    assignSelection(next, source: "tap")
    return selection
  }

  /// Changes the selection: `mode` is `replace`, `add`, `remove`, `toggle`, or `clear`.
  @discardableResult
  public func setSelection(_ names: [String], mode: String = "replace", source: String = "api")
    -> [String]
  {
    let current = selections
    let given = Self.clean(names)
    let next: [String]
    switch mode {
    case "clear": next = []
    case "add": next = current + given
    case "remove": next = current.filter { !given.contains($0) }
    case "toggle":
      next = current.filter { !given.contains($0) } + given.filter { !current.contains($0) }
    default: next = given
    }
    assignSelection(next, source: source)
    return selections
  }

  /// Talk-to-Select: changes the selection from a spoken reference ("the two red chairs on the
  /// left") with the shared matcher, falling back to `provider` for references it can't resolve
  /// ("the lamp next to the sofa"). Nothing changes unless the match is confident; `say` then asks
  /// which one was meant. `mode: "remove"` only looks inside the current selection.
  @discardableResult
  public func selectByVoice(_ query: String, mode: String = "replace") async -> AIVoiceSelection {
    let q = String(query.prefix(2000))
    if mode == "clear" {
      setSelection([], mode: "clear", source: "voice")
      return AIVoiceSelection(
        mode: mode, query: q, applied: true, tier: 1, meshes: [], candidates: [],
        say: await say(mode, nil, [], q))
    }
    let within: [String]? = mode == "remove" ? selections : nil
    if let within, within.isEmpty {
      return AIVoiceSelection(
        mode: mode, query: q, applied: false, tier: 1, meshes: [], candidates: [],
        say: "Nothing is selected.")
    }
    let scene = sceneArgs(within)
    var match: [String: Any] =
      (try? await core.call(scene.merging(["op": "select", "query": q]) { $1 })) ?? [:]
    var tier = 1
    var question = ""
    let reason = match["reason"] as? String
    if selectWithModel, !q.trimmingCharacters(in: .whitespaces).isEmpty,
      (match["confidence"] as? String) == "none", reason == "relation" || reason == "no_match"
    {
      do {
        let built = try await core.call(
          scene.merging(["op": "select_messages", "query": q, "selection": selections]) { $1 })
        let reply = try await provider.complete(try Self.messages(built))
        let parsed = try await core.call([
          "op": "select_parse", "reply": reply, "names": built["names"] ?? [],
        ])
        let names = parsed["names"] as? [String] ?? []
        tier = 2
        question = parsed["question"] as? String ?? ""
        if (parsed["confidence"] as? String) == "high" {
          match = [
            "confidence": "high", "reason": "model", "names": names, "candidates": [String](),
          ]
        } else {
          match = [
            "confidence": names.isEmpty ? "none" : "ambiguous", "reason": "model",
            "names": [String](),
            "candidates": Array(names.prefix(10)),
          ]
        }
      } catch {
        // Tier 2 failed (network, quota): keep the tier-1 answer.
      }
    }
    let names = match["names"] as? [String] ?? []
    var applied = false
    if (match["confidence"] as? String) == "high", !names.isEmpty {
      setSelection(names, mode: mode, source: "voice")
      applied = true
    }
    let meshes = selections
    let text = !applied && !question.isEmpty ? question : await say(mode, match, meshes, q)
    return AIVoiceSelection(
      mode: mode, query: q, applied: applied, tier: tier, meshes: meshes,
      candidates: match["candidates"] as? [String] ?? [], say: text)
  }

  /// Selects meshes by exact name (a voice model's `names`); names not in the scene are ignored.
  @discardableResult
  public func selectNames(_ names: [String], mode: String = "replace") async -> AIVoiceSelection {
    let index =
      (try? await core.call(
        sceneArgs(nil).merging(["op": "select", "query": "", "withIndex": true]) { $1 })) ?? [:]
    let known = Set((index["index"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String })
    let valid = Array(names.filter { known.contains($0) }.prefix(Self.maxSelection))
    let query = String(names.joined(separator: ", ").prefix(200))
    guard !valid.isEmpty else {
      let none: [String: Any] = [
        "confidence": "none", "reason": "no_match", "names": [String](), "candidates": [String](),
      ]
      let meshes = selections
      return AIVoiceSelection(
        mode: mode, query: query, applied: false, tier: 1, meshes: meshes, candidates: [],
        say: await say(mode, none, meshes, query))
    }
    setSelection(valid, mode: mode, source: "voice")
    let matched: [String: Any] = [
      "confidence": "high", "reason": "exact", "names": valid, "candidates": [String](),
    ]
    let meshes = selections
    return AIVoiceSelection(
      mode: mode, query: query, applied: true, tier: 1, meshes: meshes, candidates: [],
      say: await say(mode, matched, meshes, query))
  }

  /// Parses a push-to-talk utterance into a selection change, a mixed select-and-edit, or an edit.
  public func parseCommand(_ text: String) async -> AIVoiceCommand {
    let r = (try? await core.call(["op": "parse_command", "text": text])) ?? [:]
    return AIVoiceCommand(
      kind: r["kind"] as? String ?? "edit", mode: r["mode"] as? String ?? "replace",
      query: r["query"] as? String ?? "", instruction: r["instruction"] as? String ?? text)
  }

  /// Context sentence describing the selection for a voice model (shared wording with the web).
  public func describeSelection(_ meshes: [String]? = nil) async -> String {
    let m = meshes ?? selections
    return (try? await core.call(["op": "select_context", "meshes": m]))?["text"] as? String
      ?? (m.isEmpty
        ? "The user cleared the selection."
        : "The user selected \(m.map { "\"\($0)\"" }.joined(separator: ", ")).")
  }

  private func sceneArgs(_ within: [String]?) -> [String: Any] {
    var args: [String: Any] = ["source": source]
    if let camera { args["camera"] = ["eye": camera.eye, "target": camera.target] }
    if let within { args["within"] = within }
    return args
  }

  private func say(_ mode: String, _ match: [String: Any]?, _ meshes: [String], _ query: String)
    async -> String
  {
    var req: [String: Any] = ["op": "select_say", "mode": mode, "meshes": meshes, "query": query]
    if let match { req["match"] = match }
    return (try? await core.call(req))?["text"] as? String ?? ""
  }

  private static func messages(_ built: [String: Any]) throws -> [AIChatMessage] {
    guard let raw = built["messages"] as? [[String: Any]] else {
      throw AIEditError("core: \(built["error"] as? String ?? "no messages")")
    }
    return raw.compactMap { m -> AIChatMessage? in
      guard let role = m["role"] as? String else { return nil }
      if let s = m["content"] as? String {
        return AIChatMessage(role: role, content: s)
      }
      if let parts = m["content"] as? [[String: Any]] {
        var urls: [String] = []
        var texts = ""
        for p in parts {
          switch p["type"] as? String {
          case "image_url":
            if let u = (p["image_url"] as? [String: Any])?["url"] as? String, !u.isEmpty {
              urls.append(u)
            }
          case "text":
            if let t = p["text"] as? String, !t.isEmpty {
              texts.append(t)
            }
          default:
            break
          }
        }
        return AIChatMessage(role: role, content: texts, imageUrls: urls)
      }
      return AIChatMessage(role: role, content: "")
    }
  }

  /// Replaces the base script (e.g. after loading a different scene); clears undo.
  public func resetSource(_ script: String) {
    lock.lock()
    _source = script
    history.removeAll()
    lock.unlock()
  }

  /// Edits the scene. A newer call supersedes an in-flight one (which then returns
  /// `applied == false`). Model and compile failures come back as `EditResult.error`.
  ///
  /// - Parameter selection: the meshes the instruction refers to; defaults to `self.selections`.
  ///   Pass `[]` to edit with no selection.
  public func editScene(
    _ instruction: String, selection: [String]? = nil, maxRepairs: Int = 1, dryRun: Bool = false
  ) async -> EditResult {
    let text = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
    let chosen = selection ?? self.selections
    let sel: [String]? = chosen.isEmpty ? nil : chosen
    let (myGen, base) = locked { () -> (Int, String) in
      generation += 1
      return (generation, _source)
    }
    let isSuperseded = { [self] () -> Bool in locked { generation != myGen } }
    guard !text.isEmpty else {
      return finish(
        text,
        EditResult(
          applied: false, code: "", repairs: 0, warnings: [], error: "instruction is empty"))
    }
    onEditStart?(text, sel?.first)
    let allowed = min(3, max(0, maxRepairs))
    var code = ""
    var error: String?
    var warnings: [String] = []
    var repairs = 0
    do {
      var req: [String: Any] = ["op": "messages", "source": base, "instruction": text]
      if let sel = sel { req["selection"] = sel }
      let built = try await core.call(req)
      var messages = try Self.messages(built)
      for turn in 0...allowed {
        let reply = try await provider.complete(messages)
        if isSuperseded() {
          return finish(
            text,
            EditResult(
              applied: false, code: code, repairs: repairs, warnings: warnings,
              error: Self.superseded))
        }
        code = try await core.call(["op": "extract", "reply": reply])["code"] as? String ?? ""
        var vreq: [String: Any] = ["op": "validate", "code": code, "instruction": text]
        if let sel = sel { vreq["selection"] = sel }
        let v = try await core.call(vreq)
        if isSuperseded() {
          return finish(
            text,
            EditResult(
              applied: false, code: code, repairs: repairs, warnings: warnings,
              error: Self.superseded))
        }
        warnings = v["warnings"] as? [String] ?? []
        error =
          (v["ok"] as? Bool) == true ? nil : (v["error"] as? String ?? "The edit was rejected.")
        if error == nil { break }
        if turn < allowed {
          repairs += 1
          let repair =
            try await core.call(["op": "repair", "error": error!])["message"] as? String ?? error!
          messages.append(AIChatMessage(role: "assistant", content: reply))
          messages.append(AIChatMessage(role: "user", content: repair))
        }
      }
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
      return finish(
        text,
        EditResult(applied: false, code: code, repairs: repairs, warnings: warnings, error: message)
      )
    }
    if error == nil && !dryRun {
      do {
        try await applyScene(code)
        locked {
          history.append(base)
          if history.count > Self.maxHistory { history.removeFirst() }
          _source = code
        }
      } catch let loadError {
        error =
          "The edit compiled but failed to load: \((loadError as? LocalizedError)?.errorDescription ?? String(describing: loadError))"
        try? await applyScene(base)
      }
    }
    return finish(
      text,
      EditResult(
        applied: error == nil, code: code, repairs: repairs, warnings: warnings, error: error))
  }

  /// Reconstructs a 3D scene from a reference image (`imageUrl` is a `data:image/(png|jpeg|webp);base64,...`
  /// URI or an `https://` URL) using `provider`, validating the script and auto-repairing both
  /// compile errors and spatial/schema warnings before calling `applyScene`.
  public func compileFromImage(
    _ imageUrl: String, prompt: String = "", priors: AISpatialPriors? = nil, maxRepairs: Int = 1,
    dryRun: Bool = false
  ) async -> EditResult {
    let cleanPrompt = String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
    let (myGen, base) = locked { () -> (Int, String) in
      generation += 1
      return (generation, _source)
    }
    let isSuperseded = { [self] () -> Bool in locked { generation != myGen } }
    onImageStart?(cleanPrompt)
    let allowed = min(3, max(0, maxRepairs))
    var code = ""
    var error: String?
    var warnings: [String] = []
    var repairs = 0
    var bestCandidate: (code: String, warnings: [String])?
    do {
      var req: [String: Any] = [
        "op": "image_messages",
        "imageUrl": imageUrl.trimmingCharacters(in: .whitespacesAndNewlines),
        "prompt": cleanPrompt,
      ]
      if let priors {
        let pDict = priors.toDictionary()
        if !pDict.isEmpty { req["priors"] = pDict }
      }
      let built = try await core.call(req)
      var messages = try Self.messages(built)
      for turn in 0...allowed {
        let reply = try await provider.complete(messages)
        if isSuperseded() {
          return finishImage(
            cleanPrompt,
            EditResult(
              applied: false, code: code, repairs: repairs, warnings: warnings,
              error: Self.imageSuperseded))
        }
        code = try await core.call(["op": "extract", "reply": reply])["code"] as? String ?? ""
        let v = try await core.call(["op": "image_validate", "code": code])
        if isSuperseded() {
          return finishImage(
            cleanPrompt,
            EditResult(
              applied: false, code: code, repairs: repairs, warnings: warnings,
              error: Self.imageSuperseded))
        }
        warnings = v["warnings"] as? [String] ?? []
        error =
          (v["ok"] as? Bool) == true
          ? nil : (v["error"] as? String ?? "The generated scene was rejected.")
        if error == nil {
          bestCandidate = (code: code, warnings: warnings)
        }
        if error == nil && warnings.isEmpty { break }
        if turn < allowed {
          repairs += 1
          var repairReq: [String: Any] = ["op": "image_repair", "warnings": warnings]
          if let error { repairReq["error"] = error }
          let repair =
            try await core.call(repairReq)["message"] as? String ?? (error ?? "Fix warnings.")
          messages.append(AIChatMessage(role: "assistant", content: reply))
          messages.append(AIChatMessage(role: "user", content: repair))
        }
      }
    } catch let e {
      error = (e as? LocalizedError)?.errorDescription ?? String(describing: e)
    }

    if error != nil, let best = bestCandidate {
      code = best.code
      warnings = best.warnings
      error = nil
    }

    if error == nil && !dryRun {
      do {
        try await applyScene(code)
        locked {
          if !base.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            history.append(base)
            if history.count > Self.maxHistory { history.removeFirst() }
          }
          _source = code
        }
        setSelection([], mode: "clear", source: "api")
      } catch let loadError {
        error =
          "The generated scene compiled but failed to load: \((loadError as? LocalizedError)?.errorDescription ?? String(describing: loadError))"
        if !base.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          try? await applyScene(base)
        }
      }
    }
    return finishImage(
      cleanPrompt,
      EditResult(
        applied: error == nil, code: code, repairs: repairs, warnings: warnings, error: error))
  }

  /// Reconstructs a 3D scene from raw PNG, JPEG, or WebP `data` (validating magic bytes and the
  /// 32 MB limit) via `compileFromImage`.
  public func compileFromImageData(
    _ data: Data, prompt: String = "", priors: AISpatialPriors? = nil, maxRepairs: Int = 1,
    dryRun: Bool = false
  ) async -> EditResult {
    let cleanPrompt = String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
    let dataUrl: String
    do {
      dataUrl = try Self.encodeImageDataToDataUrl(data)
    } catch let e {
      onImageStart?(cleanPrompt)
      let msg = (e as? LocalizedError)?.errorDescription ?? String(describing: e)
      return finishImage(
        cleanPrompt, EditResult(applied: false, code: "", repairs: 0, warnings: [], error: msg))
    }
    return await compileFromImage(
      dataUrl, prompt: prompt, priors: priors, maxRepairs: maxRepairs, dryRun: dryRun)
  }

  #if canImport(UIKit)
    /// Downscales `image` so its longest edge is at most `maxEdge` (default `1024`), encodes it as
    /// a JPEG `data:image/jpeg;base64,...` URI, and runs `compileFromImage`.
    public func compileFromImage(
      _ image: UIImage, prompt: String = "", priors: AISpatialPriors? = nil, maxEdge: Int = 1024,
      maxRepairs: Int = 1, dryRun: Bool = false
    ) async -> EditResult {
      let cleanPrompt = String(prompt.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))
      let dataUrl: String
      do {
        dataUrl = try Self.encodeUIImageToDataUrl(image, maxEdge: maxEdge)
      } catch let e {
        onImageStart?(cleanPrompt)
        let msg = (e as? LocalizedError)?.errorDescription ?? String(describing: e)
        return finishImage(
          cleanPrompt, EditResult(applied: false, code: "", repairs: 0, warnings: [], error: msg))
      }
      return await compileFromImage(
        dataUrl, prompt: prompt, priors: priors, maxRepairs: maxRepairs, dryRun: dryRun)
    }

    public static func encodeUIImageToDataUrl(_ image: UIImage, maxEdge: Int = 1024) throws
      -> String
    {
      let clamped = min(4096, max(64, maxEdge))
      let w = Int((image.size.width * image.scale).rounded())
      let h = Int((image.size.height * image.scale).rounded())
      let fitted = XRFrameCapture.fit(width: w, height: h, maxEdge: clamped)
      guard fitted.width > 0, fitted.height > 0 else {
        throw AIEditError("compileFromImage: image has invalid dimensions (\(w) x \(h)).")
      }
      let format = UIGraphicsImageRendererFormat.default()
      format.scale = 1
      let renderer = UIGraphicsImageRenderer(
        size: CGSize(width: fitted.width, height: fitted.height), format: format)
      let jpeg = renderer.jpegData(withCompressionQuality: 0.88) { _ in
        image.draw(in: CGRect(x: 0, y: 0, width: fitted.width, height: fitted.height))
      }
      return try encodeImageDataToDataUrl(jpeg)
    }
  #endif

  /// Detects `image/png`, `image/jpeg`, or `image/webp` magic bytes, or returns `nil`.
  public static func detectImageMime(_ data: Data) -> String? {
    let bytes = [UInt8](data.prefix(12))
    if bytes.count >= 8,
      bytes[0] == 0x89, bytes[1] == 0x50, bytes[2] == 0x4E, bytes[3] == 0x47,
      bytes[4] == 0x0D, bytes[5] == 0x0A, bytes[6] == 0x1A, bytes[7] == 0x0A
    {
      return "image/png"
    }
    if bytes.count >= 3, bytes[0] == 0xFF, bytes[1] == 0xD8, bytes[2] == 0xFF {
      return "image/jpeg"
    }
    if bytes.count >= 12,
      bytes[0] == 0x52, bytes[1] == 0x49, bytes[2] == 0x46, bytes[3] == 0x46,
      bytes[8] == 0x57, bytes[9] == 0x45, bytes[10] == 0x42, bytes[11] == 0x50
    {
      return "image/webp"
    }
    return nil
  }

  /// Validates and encodes PNG, JPEG, or WebP `data` into a `data:image/...;base64,...` URI.
  public static func encodeImageDataToDataUrl(_ data: Data) throws -> String {
    guard !data.isEmpty else {
      throw AIEditError("compileFromImage: image buffer is empty.")
    }
    guard data.count <= maxImageBytes else {
      throw AIEditError("compileFromImage: image exceeds the 32 MB limit.")
    }
    guard let mime = detectImageMime(data) else {
      throw AIEditError(
        "compileFromImage: unsupported image format (expected PNG, JPEG, or WebP magic bytes).")
    }
    return "data:\(mime);base64,\(data.base64EncodedString())"
  }

  /// Restores the script from before the last applied edit. Returns false when nothing to undo.
  @discardableResult
  public func undo() async throws -> Bool {
    guard let prev = locked({ history.popLast() }) else { return false }
    try await applyScene(prev)
    locked { _source = prev }
    return true
  }

  /// Short spoken summary of `result` (shared wording with the web).
  public func describe(_ result: EditResult) async -> String {
    var req: [String: Any] = ["op": "describe", "applied": result.applied]
    if let e = result.error { req["error"] = e }
    return (try? await core.call(req))?["text"] as? String
      ?? (result.applied ? "Done." : "Sorry, I couldn't apply that.")
  }

  private func finish(_ instruction: String, _ result: EditResult) -> EditResult {
    onEdit?(instruction, result)
    return result
  }

  private func finishImage(_ prompt: String, _ result: EditResult) -> EditResult {
    onImage?(prompt, result)
    return result
  }
}
