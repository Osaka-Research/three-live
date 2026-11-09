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

/// A JSON object handed between tasks. JSON values from `JSONSerialization` are immutable once
/// built, so sharing them is safe.
struct AIJSONBox: @unchecked Sendable {
  let value: [String: Any]
}

/// States reported by `AIVoiceSession.onState`. Mirrors `AIVoiceState` on the web.
public enum AIVoiceState: String, Sendable {
  case connecting, listening, thinking, editing, speaking, closed, error
}

/// Realtime voice editing for iOS / visionOS (B2b-3): the voice model talks and calls the
/// `edit_scene` / `undo_edit` tools, which run `AIEditor.editScene` with the editor's code model.
///
/// Protocols (built and parsed by the shared Rust core, identical to the web `connectVoice`):
/// - `ai-realtime`: any server speaking the Realtime WebSocket event protocol (24 kHz audio).
/// - `gemini-live`: the Gemini Live API (16 kHz microphone audio).
///
/// ```swift
/// let transport = URLSessionLiveTransport(url: URL(string: "wss://your-backend.example/realtime")!)!
/// let session = try AIVoiceSession(editor: editor, transport: transport, sink: AVAudioPcmSink())
/// let rate = try await session.start()
/// let mic = MicrophoneStreamer(sampleRate: rate) { session.sendAudio($0) }
/// try mic.start()
/// ```
/// Point the transport at your own proxy or an ephemeral-token URL; never ship API keys.
public final class AIVoiceSession: @unchecked Sendable {
  public static let maxText = 2000
  public static let maxToolCalls = 8

  /// Optional session settings.
  public struct Options {
    public var model: String?
    public var voice: String?
    /// Extra system instructions for the voice model.
    public var instructions: String
    /// Provider-specific fields deep-merged into the setup / session message.
    public var session: [String: Any]?

    public init(model: String? = nil, voice: String? = nil, instructions: String = "", session: [String: Any]? = nil) {
      self.model = model
      self.voice = voice
      self.instructions = instructions
      self.session = session
    }
  }

  public var onState: ((AIVoiceState) -> Void)?
  public var onTranscript: ((_ speaker: String, _ text: String, _ isFinal: Bool) -> Void)?
  public var onEdit: ((_ instruction: String, _ result: EditResult) -> Void)?
  public var onError: ((String) -> Void)?

  private let editor: AIEditor
  private let transport: GeminiLiveTransport
  private let provider: String
  private let sink: PcmAudioSink?
  private let options: Options
  private let core: AICore
  private let lock = NSLock()
  private var _state: AIVoiceState = .connecting
  private var closed = false
  private var userText = ""
  private var modelText = ""
  private var inputRate: Int
  private var previousSelectionHandler: ((String?) -> Void)?
  /// Serializes server messages so audio chunks never reorder.
  private var inbox: AsyncStream<AIJSONBox>.Continuation?
  private var inboxTask: Task<Void, Never>?

  public init(
    editor: AIEditor, transport: GeminiLiveTransport, provider: String = "ai-realtime",
    sink: PcmAudioSink? = nil, options: Options = Options(), core: AICore = NativeAICore.shared
  ) throws {
    guard provider == "ai-realtime" || provider == "gemini-live" else {
      throw AIEditError("AIVoiceSession: unknown provider '\(provider)' (use ai-realtime or gemini-live).")
    }
    self.editor = editor
    self.transport = transport
    self.provider = provider
    self.sink = sink
    self.options = options
    self.core = core
    self.inputRate = provider == "gemini-live" ? 16_000 : 24_000
  }

  public var state: AIVoiceState {
    lock.lock()
    defer { lock.unlock() }
    return _state
  }

  private var isClosed: Bool {
    lock.lock()
    defer { lock.unlock() }
    return closed
  }

  /// Sends the session setup and returns the microphone sample rate to stream at.
  public func start() async throws -> Int {
    var req: [String: Any] = ["op": "voice_setup", "provider": provider, "instructions": options.instructions]
    if let m = options.model { req["model"] = m }
    if let v = options.voice { req["voice"] = v }
    if let s = options.session { req["session"] = s }
    let setup = try await core.call(req)
    if let e = setup["error"] as? String { throw AIEditError(e) }
    if let rate = setup["inputRate"] as? Int { inputRate = rate }
    var captured: AsyncStream<AIJSONBox>.Continuation?
    let stream = AsyncStream<AIJSONBox>(bufferingPolicy: .unbounded) { captured = $0 }
    inbox = captured
    inboxTask = Task { [weak self] in
      for await box in stream {
        await self?.handle(box.value)
      }
    }
    transport.onMessage = { [weak self] message in self?.inbox?.yield(AIJSONBox(value: message)) }
    transport.onClose = { [weak self] in self?.shutdown() }
    sendAll(setup["messages"])
    previousSelectionHandler = editor.onSelectionChanged
    editor.onSelectionChanged = { [weak self] selection in
      self?.previousSelectionHandler?(selection)
      guard let self = self else { return }
      Task { await self.sendContext(self.selectionText(selection)) }
    }
    if let sel = editor.selection { await sendContext(selectionText(sel)) }
    setState(.listening)
    return inputRate
  }

  /// Streams one microphone chunk (16-bit little-endian mono PCM at the rate `start()` returned).
  public func sendAudio(_ pcm16le: Data) {
    guard !isClosed, !pcm16le.isEmpty else { return }
    let b64 = pcm16le.base64EncodedString()
    // Built locally (not through the core) so audio never waits on the native call.
    if provider == "gemini-live" {
      transport.send(["realtimeInput": ["audio": ["mimeType": "audio/pcm;rate=16000", "data": b64]]])
    } else {
      transport.send(["type": "input_audio_buffer.append", "audio": b64])
    }
  }

  /// Sends a typed user message and asks for a reply.
  public func sendText(_ text: String) async {
    let t = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxText))
    guard !t.isEmpty, !isClosed else { return }
    sendAll((try? await core.call(["op": "voice_text", "provider": provider, "text": t, "respond": true]))?["messages"])
  }

  /// Ends the session. Idempotent.
  public func close() {
    guard !isClosed else { return }
    transport.onClose = nil
    transport.onMessage = nil
    transport.close()
    shutdown()
  }

  private func shutdown() {
    lock.lock()
    if closed {
      lock.unlock()
      return
    }
    closed = true
    lock.unlock()
    inbox?.finish()
    sink?.close()
    editor.onSelectionChanged = previousSelectionHandler
    setState(.closed)
  }

  private func selectionText(_ selection: String?) -> String {
    if let s = selection {
      return "The user selected the mesh \"\(s.prefix(200))\". \"This\" or \"it\" now refers to it."
    }
    return "The user cleared the selection."
  }

  private func sendContext(_ text: String) async {
    guard !isClosed else { return }
    sendAll((try? await core.call(["op": "voice_text", "provider": provider, "text": text, "respond": false]))?["messages"])
  }

  private func sendAll(_ messages: Any?) {
    guard !isClosed else { return }
    for m in messages as? [[String: Any]] ?? [] { transport.send(m) }
  }

  private func markSpeaking() {
    lock.lock()
    if _state != .editing { _state = .speaking }
    lock.unlock()
  }

  private func setState(_ s: AIVoiceState) {
    lock.lock()
    _state = s
    lock.unlock()
    onState?(s)
  }

  func handle(_ message: [String: Any]) async {
    guard !isClosed else { return }
    guard let parsed = try? await core.call(["op": "voice_parse", "provider": provider, "message": message]) else { return }
    var calls = 0
    for ev in parsed["events"] as? [[String: Any]] ?? [] {
      switch ev["type"] as? String {
      case "audio":
        markSpeaking()
        if let b64 = ev["base64"] as? String, let bytes = Data(base64Encoded: b64) {
          sink?.enqueue(bytes, sampleRate: ev["rate"] as? Int ?? 24_000)
        }
      case "interrupted":
        sink?.flush()
      case "transcript":
        let speaker = ev["speaker"] as? String ?? "model"
        let isFinal = ev["isFinal"] as? Bool ?? false
        let fragment = ev["text"] as? String ?? ""
        var text = speaker == "user" ? userText : modelText
        text = String((isFinal ? fragment : text + fragment).suffix(Self.maxText))
        onTranscript?(speaker, text, isFinal)
        if speaker == "user" { userText = isFinal ? "" : text } else { modelText = isFinal ? "" : text }
      case "turnComplete":
        if !userText.isEmpty {
          onTranscript?("user", userText, true)
          userText = ""
        }
        if !modelText.isEmpty {
          onTranscript?("model", modelText, true)
          modelText = ""
        }
        if state == .speaking || state == .thinking { setState(.listening) }
      case "toolCall":
        calls += 1
        if calls <= Self.maxToolCalls {
          let id = ev["id"] as? String ?? ""
          let name = ev["name"] as? String ?? ""
          let args = AIJSONBox(value: ev["args"] as? [String: Any] ?? [:])
          Task { await self.runTool(id: id, name: name, args: args.value) }
        }
      case "error":
        onError?(ev["message"] as? String ?? "voice server error")
      default:
        break
      }
    }
  }

  func runTool(id: String, name: String, args: [String: Any]) async {
    var output: [String: Any]
    switch name {
    case "edit_scene":
      let instruction = String(
        (args["instruction"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(Self.maxText))
      if instruction.isEmpty {
        output = ["applied": false, "error": "instruction is empty"]
      } else {
        setState(.editing)
        let result = await editor.editScene(instruction)
        onEdit?(instruction, result)
        setState(.thinking)
        output = result.applied
          ? ["applied": true, "repairs": result.repairs]
          : ["applied": false, "error": result.error ?? "edit rejected"]
      }
    case "undo_edit":
      let undone = (try? await editor.undo()) ?? false
      output = undone ? ["undone": true] : ["undone": false, "error": "nothing to undo"]
    default:
      output = ["error": "unknown tool \(name)"]
    }
    guard !isClosed else { return }
    sendAll(
      (try? await core.call(["op": "voice_tool_result", "provider": provider, "id": id, "name": name, "output": output]))?["messages"])
  }
}
