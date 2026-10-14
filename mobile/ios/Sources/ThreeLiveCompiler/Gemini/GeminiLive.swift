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

// Native Gemini Live client (port of `xr-live/src/plugins/gemini-live.ts`). The default transport
// talks to the plain Live API over `URLSessionWebSocketTask` with an ephemeral token or a proxy
// URL; Firebase AI Logic is an optional adapter (`mobile/ios/FirebaseAdapter`). No dependencies.

import Foundation

/// Bidirectional transport to a Gemini Live (or compatible) backend; messages are Live API JSON.
public protocol GeminiLiveTransport: AnyObject {
  /// Called with each server message (on a transport-owned queue).
  var onMessage: (([String: Any]) -> Void)? { get set }
  /// Called once when the transport closes for any reason.
  var onClose: (() -> Void)? { get set }
  /// Queues a client message. Messages sent after `close()` are dropped.
  func send(_ message: [String: Any])
  /// Closes the transport. Idempotent.
  func close()
}

/// Endpoint policy and URL builders. Nothing here logs URLs, tokens or keys.
public enum GeminiLiveEndpoints {
  public static let defaultHost = "generativelanguage.googleapis.com"
  public static let defaultAPIVersion = "v1beta"

  /// Same policy as the web `isAllowedLiveUrl`: `wss:` only, plus `ws:` to loopback.
  public static func isAllowedLiveURL(_ raw: String?) -> Bool {
    guard let raw = raw, let c = URLComponents(string: raw), let scheme = c.scheme?.lowercased(),
      let host = c.host?.lowercased(), !host.isEmpty
    else { return false }
    switch scheme {
    case "wss": return true
    case "ws": return host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "[::1]"
    default: return false
    }
  }

  /// Live endpoint for an ephemeral token minted by your backend (`access_token` query).
  public static func ephemeralTokenURL(token: String, apiVersion: String = defaultAPIVersion) -> URL? {
    guard !token.trimmingCharacters(in: .whitespaces).isEmpty, isValidVersion(apiVersion) else { return nil }
    var c = URLComponents()
    c.scheme = "wss"
    c.host = defaultHost
    c.path = "/ws/google.ai.generativelanguage.\(apiVersion).GenerativeService.BidiGenerateContentConstrained"
    c.queryItems = [URLQueryItem(name: "access_token", value: token)]
    // URLComponents leaves "+" unescaped in queries; tokens are opaque, so escape it.
    c.percentEncodedQuery = c.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
    return c.url
  }

  /// **Development only.** Embeds a long-lived API key; returns `nil` in non-`DEBUG` builds.
  public static func devAPIKeyURL(apiKey: String, apiVersion: String = defaultAPIVersion) -> URL? {
    #if DEBUG
      guard !apiKey.isEmpty, isValidVersion(apiVersion) else { return nil }
      print("W/ThreeLiveGemini: DEV-ONLY: connecting with an embedded API key. Never ship this.")
      var c = URLComponents()
      c.scheme = "wss"
      c.host = defaultHost
      c.path = "/ws/google.ai.generativelanguage.\(apiVersion).GenerativeService.BidiGenerateContent"
      c.queryItems = [URLQueryItem(name: "key", value: apiKey)]
      return c.url
    #else
      return nil
    #endif
  }

  static func isValidVersion(_ v: String) -> Bool {
    guard let first = v.first, first == "v", v.count > 1 else { return false }
    return v.dropFirst().allSatisfy { $0.isASCII && ($0.isNumber || $0.isLowercase) }
  }
}

/// Default transport over `URLSessionWebSocketTask`. Server text and binary frames are parsed as
/// JSON (the Live API sends JSON in binary frames).
public final class URLSessionLiveTransport: NSObject, GeminiLiveTransport, URLSessionWebSocketDelegate,
  @unchecked Sendable
{
  public var onMessage: (([String: Any]) -> Void)?
  public var onClose: (() -> Void)?

  private let lock = NSLock()
  private var task: URLSessionWebSocketTask?
  private var session: URLSession?
  private var closed = false
  private var notified = false

  /// Maximum size of one server message.
  public static let maxMessageBytes = 16 * 1024 * 1024

  /// Connects to `url` (must pass `GeminiLiveEndpoints.isAllowedLiveURL`), with optional extra
  /// handshake `headers` (e.g. `Authorization: Token …`). Returns `nil` for disallowed URLs.
  public init?(url: URL, headers: [String: String] = [:]) {
    guard GeminiLiveEndpoints.isAllowedLiveURL(url.absoluteString) else { return nil }
    super.init()
    var request = URLRequest(url: url)
    for (k, v) in headers where !v.contains("\r") && !v.contains("\n") {
      request.setValue(v, forHTTPHeaderField: k)
    }
    let s = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)
    let t = s.webSocketTask(with: request)
    t.maximumMessageSize = Self.maxMessageBytes
    session = s
    task = t
    t.resume()
    receiveNext()
  }

  public func send(_ message: [String: Any]) {
    lock.lock()
    let t = closed ? nil : task
    lock.unlock()
    guard let t = t, JSONSerialization.isValidJSONObject(message),
      let data = try? JSONSerialization.data(withJSONObject: message),
      let text = String(data: data, encoding: .utf8)
    else { return }
    t.send(.string(text)) { [weak self] error in
      if error != nil { self?.finish() }
    }
  }

  public func close() {
    lock.lock()
    let wasClosed = closed
    closed = true
    let t = task
    lock.unlock()
    guard !wasClosed else { return }
    t?.cancel(with: .normalClosure, reason: nil)
    finish()
  }

  private func receiveNext() {
    lock.lock()
    let t = closed ? nil : task
    lock.unlock()
    t?.receive { [weak self] result in
      guard let self = self else { return }
      switch result {
      case .success(let message):
        let data: Data?
        switch message {
        case .string(let s): data = s.data(using: .utf8)
        case .data(let d): data = d
        @unknown default: data = nil
        }
        if let data = data, let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
          self.onMessage?(obj)
        }
        self.receiveNext()
      case .failure:
        self.finish()
      }
    }
  }

  private func finish() {
    lock.lock()
    closed = true
    let shouldNotify = !notified
    notified = true
    let s = session
    session = nil
    task = nil
    lock.unlock()
    s?.invalidateAndCancel()
    if shouldNotify { onClose?() }
  }

  public func urlSession(
    _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
  ) {
    finish()
  }
}

/// Who produced a transcript segment.
public enum TranscriptSpeaker: String, Sendable {
  case user
  case model
}

/// `{speaker, text, isFinal}` (the web `xr-transcription` detail).
public struct TranscriptEvent: Sendable, Equatable {
  public var speaker: TranscriptSpeaker
  public var text: String
  public var isFinal: Bool
}

/// Accumulates streaming transcription fragments per speaker.
public final class TranscriptionManager: @unchecked Sendable {
  private let lock = NSLock()
  private var partial: [TranscriptSpeaker: String] = [:]

  public init() {}

  /// Appends a fragment; returns the updated non-final segment (last 4000 characters).
  public func append(_ speaker: TranscriptSpeaker, _ fragment: String) -> TranscriptEvent {
    lock.lock()
    defer { lock.unlock() }
    let next = String(((partial[speaker] ?? "") + fragment).suffix(XRGeminiLiveController.maxTextChars))
    partial[speaker] = next
    return TranscriptEvent(speaker: speaker, text: next, isFinal: false)
  }

  /// Finalizes and clears every non-empty segment (user first, then model).
  public func finalize() -> [TranscriptEvent] {
    lock.lock()
    defer { lock.unlock() }
    var out: [TranscriptEvent] = []
    for s in [TranscriptSpeaker.user, .model] {
      if let t = partial[s], !t.isEmpty { out.append(TranscriptEvent(speaker: s, text: t, isFinal: true)) }
      partial[s] = ""
    }
    return out
  }
}

/// Plays streamed model audio (16-bit little-endian mono PCM).
public protocol PcmAudioSink: AnyObject {
  func enqueue(_ pcm16le: Data, sampleRate: Int)
  /// Drops queued audio immediately (barge-in).
  func flush()
  func close()
}

/// Native port of the web `XRGeminiLiveController`: frames, microphone audio, transcripts,
/// model audio playback and barge-in. Thread-safe; callbacks run on `callbackQueue`.
public final class XRGeminiLiveController: @unchecked Sendable {
  public static let maxTextChars = 4000

  /// Captures one JPEG frame and calls the completion once (with `nil` on failure).
  public typealias FrameProvider = (@escaping (Data?) -> Void) -> Void

  public var onTranscript: ((TranscriptEvent) -> Void)?
  public var onInterrupted: (() -> Void)?
  public var onDisconnected: (() -> Void)?

  public let transcripts = TranscriptionManager()

  private let frameProvider: FrameProvider?
  private let audioSink: PcmAudioSink?
  private let callbackQueue: DispatchQueue
  private let lock = NSLock()
  private var transport: GeminiLiveTransport?
  private var playAudio = true
  private var frameTimer: DispatchSourceTimer?
  private var captureInFlight = false
  private var turnHasOutputTranscription = false

  public init(frameProvider: FrameProvider? = nil, audioSink: PcmAudioSink? = nil, callbackQueue: DispatchQueue = .main) {
    self.frameProvider = frameProvider
    self.audioSink = audioSink
    self.callbackQueue = callbackQueue
  }

  public var isConnected: Bool {
    lock.lock()
    defer { lock.unlock() }
    return transport != nil
  }

  /// Attaches `transport` (replacing any session); sends `setup` first, then streams frames every
  /// `frameInterval` (clamped 0.25–10 s) when a frame provider exists.
  public func connect(
    _ transport: GeminiLiveTransport, setup: [String: Any]? = nil, frameInterval: TimeInterval = 1,
    streamFrames: Bool = true, playAudio: Bool = true
  ) {
    disconnect()
    lock.lock()
    self.transport = transport
    self.playAudio = playAudio
    turnHasOutputTranscription = false
    lock.unlock()
    transport.onMessage = { [weak self, weak transport] m in
      guard let self = self, let transport = transport, self.isCurrent(transport) else { return }
      self.handleServerMessage(m)
    }
    transport.onClose = { [weak self, weak transport] in
      guard let self = self else { return }
      self.lock.lock()
      let current = transport != nil && self.transport === transport
      if current {
        self.transport = nil
        self.stopFramesLocked()
      }
      self.lock.unlock()
      if current { self.emit { $0.onDisconnected?() } }
    }
    if let setup = setup { transport.send(["setup": setup]) }
    if streamFrames, frameProvider != nil {
      let interval = min(10, max(0.25, frameInterval.isFinite ? frameInterval : 1))
      let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
      timer.schedule(deadline: .now() + interval, repeating: interval)
      timer.setEventHandler { [weak self] in _ = self?.sendFrame() }
      lock.lock()
      frameTimer = timer
      lock.unlock()
      timer.resume()
    }
  }

  /// Stops streaming, closes the transport and finalizes pending transcripts.
  public func disconnect() {
    lock.lock()
    stopFramesLocked()
    let t = transport
    transport = nil
    lock.unlock()
    t?.close()
    audioSink?.flush()
    for ev in transcripts.finalize() { emit { $0.onTranscript?(ev) } }
  }

  /// Captures and sends one frame unless one is in flight. Returns `true` when started.
  @discardableResult
  public func sendFrame() -> Bool {
    guard let provider = frameProvider else { return false }
    lock.lock()
    guard transport != nil, !captureInFlight else {
      lock.unlock()
      return false
    }
    captureInFlight = true
    lock.unlock()
    provider { [weak self] jpeg in
      guard let self = self else { return }
      self.lock.lock()
      self.captureInFlight = false
      let t = self.transport
      self.lock.unlock()
      if let jpeg = jpeg, !jpeg.isEmpty, jpeg.count <= 4 * 1024 * 1024, let t = t {
        t.send(Self.realtimeChunk(mime: "image/jpeg", data: jpeg))
      }
    }
    return true
  }

  /// Sends 16-bit little-endian mono PCM microphone audio (rate clamped to 8–48 kHz).
  public func sendAudioChunk(_ pcm16le: Data, sampleRate: Int = 16_000) {
    lock.lock()
    let t = transport
    lock.unlock()
    guard let t = t, !pcm16le.isEmpty else { return }
    let rate = min(48_000, max(8_000, sampleRate))
    t.send(Self.realtimeChunk(mime: "audio/pcm;rate=\(rate)", data: pcm16le))
  }

  /// Sends a completed user text turn (first 4000 characters).
  public func sendText(_ text: String) {
    lock.lock()
    let t = transport
    lock.unlock()
    let clipped = String(text.prefix(Self.maxTextChars))
    guard let t = t, !clipped.isEmpty else { return }
    t.send([
      "clientContent": [
        "turns": [["role": "user", "parts": [["text": clipped]]]],
        "turnComplete": true,
      ] as [String: Any]
    ])
  }

  /// Processes one server message (exposed for custom transports and tests).
  public func handleServerMessage(_ message: [String: Any]) {
    guard let content = message["serverContent"] as? [String: Any] else { return }
    if XRJSON.bool(content["interrupted"]) == true {
      audioSink?.flush()
      emit { $0.onInterrupted?() }
    }
    if let t = (content["inputTranscription"] as? [String: Any])?["text"] as? String, !t.isEmpty {
      let ev = transcripts.append(.user, t)
      emit { $0.onTranscript?(ev) }
    }
    if let t = (content["outputTranscription"] as? [String: Any])?["text"] as? String, !t.isEmpty {
      setTurnHasOutput(true)
      let ev = transcripts.append(.model, t)
      emit { $0.onTranscript?(ev) }
    }
    if let parts = (content["modelTurn"] as? [String: Any])?["parts"] as? [Any] {
      lock.lock()
      let hasOutput = turnHasOutputTranscription
      let play = playAudio
      lock.unlock()
      for case let part as [String: Any] in parts {
        if let text = part["text"] as? String, !text.isEmpty, !hasOutput {
          let ev = transcripts.append(.model, text)
          emit { $0.onTranscript?(ev) }
        }
        if play, let sink = audioSink, let inline = part["inlineData"] as? [String: Any],
          let mime = inline["mimeType"] as? String, mime.hasPrefix("audio/pcm"),
          let b64 = inline["data"] as? String, b64.utf8.count <= 8 * 1024 * 1024,
          let pcm = Data(base64Encoded: b64, options: .ignoreUnknownCharacters)
        {
          sink.enqueue(pcm, sampleRate: Self.pcmRate(fromMime: mime))
        }
      }
    }
    if XRJSON.bool(content["turnComplete"]) == true {
      setTurnHasOutput(false)
      for ev in transcripts.finalize() { emit { $0.onTranscript?(ev) } }
    }
  }

  /// Sample rate of `audio/pcm;rate=N` (clamped 8–48 kHz; default 24 kHz).
  public static func pcmRate(fromMime mime: String?, fallback: Int = 24_000) -> Int {
    guard let mime = mime, let r = mime.range(of: "rate=") else { return fallback }
    let digits = mime[r.upperBound...].prefix(while: { $0.isASCII && $0.isNumber })
    guard let v = Int(digits.prefix(9)) else { return fallback }
    return min(48_000, max(8_000, v))
  }

  /// Hold-to-ask prompt (port of `buildHoldToAskPrompt`).
  public static func buildHoldToAskPrompt(meshName: String?, options: XRLiveHoldToAsk, transcript: String = "") -> String {
    let name = String((meshName ?? "").prefix(256))
    let spoken = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    let prompt = "The user is pointing at the 3D object \"\(name.isEmpty ? "object" : name)\". \(spoken.isEmpty ? options.prompt : spoken)"
    return String(prompt.prefix(maxTextChars))
  }

  private func isCurrent(_ t: GeminiLiveTransport) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return transport === t
  }

  private func setTurnHasOutput(_ v: Bool) {
    lock.lock()
    turnHasOutputTranscription = v
    lock.unlock()
  }

  private func stopFramesLocked() {
    frameTimer?.cancel()
    frameTimer = nil
  }

  private func emit(_ block: @escaping (XRGeminiLiveController) -> Void) {
    callbackQueue.async { [weak self] in
      if let self = self { block(self) }
    }
  }

  private static func realtimeChunk(mime: String, data: Data) -> [String: Any] {
    ["realtimeInput": ["mediaChunks": [["mimeType": mime, "data": data.base64EncodedString()]]]]
  }
}
