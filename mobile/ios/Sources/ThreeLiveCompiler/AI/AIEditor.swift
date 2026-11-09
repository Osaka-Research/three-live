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

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// One chat message sent to an AI provider.
public struct AIChatMessage: Sendable, Equatable {
  public let role: String
  public let content: String

  public init(role: String, content: String) {
    self.role = role
    self.content = content
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
    var body: [String: Any] = [
      "messages": messages.map { ["role": $0.role, "content": $0.content] },
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
    let message = ((root["choices"] as? [Any])?.first as? [String: Any])?["message"] as? [String: Any]
    var text: String?
    if let s = message?["content"] as? String {
      text = s
    } else if let parts = message?["content"] as? [Any] {
      text = parts.map { ($0 as? String) ?? (($0 as? [String: Any])?["text"] as? String ?? "") }.joined()
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
    let reply = try await ThreeCompiler.aiCall(
      text, onCompilerThread: (request["op"] as? String) == "validate")
    guard let obj = (try? JSONSerialization.jsonObject(with: Data(reply.utf8))) as? [String: Any]
    else { throw AIEditError("invalid response from native core") }
    return obj
  }
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
/// let result = await editor.editScene("make the roof red")
/// ```
public final class AIEditor: @unchecked Sendable {
  public static let maxHistory = 20
  public static let superseded = "editScene superseded by a newer call"

  public var provider: AIProvider
  private let applyScene: (String) async throws -> Void
  private let core: AICore
  private let lock = NSLock()
  private var _source: String
  private var _selection: String?
  private var history: [String] = []
  private var generation = 0

  /// Called before (`instruction`, `selection`) and after (`instruction`, `result`) each edit.
  public var onEditStart: ((String, String?) -> Void)?
  public var onEdit: ((String, EditResult) -> Void)?
  /// Called when the selection changes.
  public var onSelectionChanged: ((String?) -> Void)?

  public init(
    source: String, provider: AIProvider, core: AICore = NativeAICore.shared,
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

  /// Mesh the next instruction refers to ("make *this* red"), usually set by a tap.
  public var selection: String? {
    get {
      lock.lock()
      defer { lock.unlock() }
      return _selection
    }
    set {
      let v = (newValue?.isEmpty ?? true) ? nil : newValue
      lock.lock()
      let changed = _selection != v
      _selection = v
      lock.unlock()
      if changed { onSelectionChanged?(v) }
    }
  }

  /// Tap-to-select: selects `meshName`, or clears the selection when it is already selected.
  @discardableResult
  public func toggleSelection(_ meshName: String?) -> String? {
    selection = (meshName == nil || meshName == "" || meshName == selection) ? nil : meshName
    return selection
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
  /// - Parameter selection: the mesh the instruction refers to; defaults to `self.selection`.
  ///   Pass `.some(nil)` to edit with no selection.
  public func editScene(
    _ instruction: String, selection: String?? = nil, maxRepairs: Int = 1, dryRun: Bool = false
  ) async -> EditResult {
    let text = instruction.trimmingCharacters(in: .whitespacesAndNewlines)
    let sel: String? = selection ?? self.selection
    let (myGen, base) = locked { () -> (Int, String) in
      generation += 1
      return (generation, _source)
    }
    let isSuperseded = { [self] () -> Bool in locked { generation != myGen } }
    guard !text.isEmpty else {
      return finish(text, EditResult(applied: false, code: "", repairs: 0, warnings: [], error: "instruction is empty"))
    }
    onEditStart?(text, sel)
    let allowed = min(3, max(0, maxRepairs))
    var code = ""
    var error: String?
    var warnings: [String] = []
    var repairs = 0
    do {
      var req: [String: Any] = ["op": "messages", "source": base, "instruction": text]
      if let sel = sel { req["selection"] = sel }
      let built = try await core.call(req)
      guard let raw = built["messages"] as? [[String: Any]] else {
        throw AIEditError("core: \(built["error"] as? String ?? "no messages")")
      }
      var messages = raw.compactMap { m -> AIChatMessage? in
        guard let role = m["role"] as? String else { return nil }
        return AIChatMessage(role: role, content: m["content"] as? String ?? "")
      }
      for turn in 0...allowed {
        let reply = try await provider.complete(messages)
        if isSuperseded() {
          return finish(text, EditResult(applied: false, code: code, repairs: repairs, warnings: warnings, error: Self.superseded))
        }
        code = try await core.call(["op": "extract", "reply": reply])["code"] as? String ?? ""
        var vreq: [String: Any] = ["op": "validate", "code": code, "instruction": text]
        if let sel = sel { vreq["selection"] = sel }
        let v = try await core.call(vreq)
        if isSuperseded() {
          return finish(text, EditResult(applied: false, code: code, repairs: repairs, warnings: warnings, error: Self.superseded))
        }
        warnings = v["warnings"] as? [String] ?? []
        error = (v["ok"] as? Bool) == true ? nil : (v["error"] as? String ?? "The edit was rejected.")
        if error == nil { break }
        if turn < allowed {
          repairs += 1
          let repair = try await core.call(["op": "repair", "error": error!])["message"] as? String ?? error!
          messages.append(AIChatMessage(role: "assistant", content: reply))
          messages.append(AIChatMessage(role: "user", content: repair))
        }
      }
    } catch {
      let message = (error as? LocalizedError)?.errorDescription ?? String(describing: error)
      return finish(text, EditResult(applied: false, code: code, repairs: repairs, warnings: warnings, error: message))
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
        error = "The edit compiled but failed to load: \((loadError as? LocalizedError)?.errorDescription ?? String(describing: loadError))"
        try? await applyScene(base)
      }
    }
    return finish(text, EditResult(applied: error == nil, code: code, repairs: repairs, warnings: warnings, error: error))
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
}
