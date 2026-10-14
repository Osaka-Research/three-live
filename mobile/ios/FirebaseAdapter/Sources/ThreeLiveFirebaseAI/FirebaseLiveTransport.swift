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

import FirebaseAILogic
import Foundation
import ThreeLiveCompiler

/// `GeminiLiveTransport` backed by a Firebase AI Logic `LiveSession`, so apps that already use
/// Firebase (App Check, Auth, Vertex AI backend) can drive the same `XRGeminiLiveController` as
/// the default plain Live API transport.
///
/// ```swift
/// let model = FirebaseAI.firebaseAI(backend: .googleAI()).liveModel(
///   modelName: "gemini-live-2.5-flash",
///   generationConfig: LiveGenerationConfig(responseModalities: [.audio]))
/// let transport = try await FirebaseLiveTransport.connect(model)
/// controller.connect(transport)
/// ```
///
/// Server messages are converted back to Live API JSON; `clientContent` and `realtimeInput`
/// messages map onto the session's content / audio / video methods. `setup` is ignored (the
/// model configures the session). Firebase's realtime audio expects 16 kHz PCM, which is what
/// `MicrophoneStreamer` produces.
public final class FirebaseLiveTransport: GeminiLiveTransport, @unchecked Sendable {
  public var onMessage: (([String: Any]) -> Void)?
  public var onClose: (() -> Void)?

  private let session: LiveSession
  private let outgoing: AsyncStream<[String: Any]>.Continuation
  private let lock = NSLock()
  private var closed = false
  private var notified = false
  private var receiveTask: Task<Void, Never>?
  private var sendTask: Task<Void, Never>?

  public init(session: LiveSession) {
    self.session = session
    var continuation: AsyncStream<[String: Any]>.Continuation!
    let stream = AsyncStream<[String: Any]> { continuation = $0 }
    outgoing = continuation
    receiveTask = Task { [weak self] in
      do {
        for try await message in session.responses {
          if case let .content(content) = message.payload {
            self?.onMessage?(Self.liveAPIJSON(content))
          }
        }
      } catch {
        // Reported through onClose.
      }
      self?.notifyClose()
    }
    sendTask = Task {
      for await message in stream {
        await Self.deliver(message, to: session)
      }
    }
  }

  /// Connects `model` and wraps the session.
  public static func connect(_ model: LiveGenerativeModel) async throws -> FirebaseLiveTransport {
    FirebaseLiveTransport(session: try await model.connect())
  }

  public func send(_ message: [String: Any]) {
    lock.lock()
    let isClosed = closed
    lock.unlock()
    if !isClosed { outgoing.yield(message) }
  }

  public func close() {
    lock.lock()
    let wasClosed = closed
    closed = true
    lock.unlock()
    guard !wasClosed else { return }
    outgoing.finish()
    let session = self.session
    Task { [weak self] in
      await session.close()
      self?.notifyClose()
    }
  }

  private func notifyClose() {
    lock.lock()
    closed = true
    let shouldNotify = !notified
    notified = true
    lock.unlock()
    if shouldNotify { onClose?() }
  }

  private static func deliver(_ message: [String: Any], to session: LiveSession) async {
    if let content = message["clientContent"] as? [String: Any] {
      let text = clientContentText(content)
      if !text.isEmpty { await session.sendContent(text, turnComplete: true) }
      return
    }
    guard let chunks = (message["realtimeInput"] as? [String: Any])?["mediaChunks"] as? [[String: Any]]
    else { return }
    for chunk in chunks {
      guard let mime = chunk["mimeType"] as? String, let b64 = chunk["data"] as? String,
        let data = Data(base64Encoded: b64)
      else { continue }
      if mime.hasPrefix("audio/") {
        await session.sendAudioRealtime(data)
      } else if mime.hasPrefix("image/") {
        await session.sendVideoRealtime(data, mimeType: mime)
      }
    }
  }

  /// Concatenated text of a `clientContent` message's turns.
  public static func clientContentText(_ content: [String: Any]) -> String {
    var out = ""
    for case let turn as [String: Any] in (content["turns"] as? [Any]) ?? [] {
      for case let part as [String: Any] in (turn["parts"] as? [Any]) ?? [] {
        if let t = part["text"] as? String { out += t }
      }
    }
    return out
  }

  /// Converts a Firebase `LiveServerContent` to the Live API `serverContent` JSON shape.
  public static func liveAPIJSON(_ c: LiveServerContent) -> [String: Any] {
    var content: [String: Any] = [:]
    if c.wasInterrupted { content["interrupted"] = true }
    if c.isTurnComplete { content["turnComplete"] = true }
    if let t = c.inputAudioTranscription?.text { content["inputTranscription"] = ["text": t] }
    if let t = c.outputAudioTranscription?.text { content["outputTranscription"] = ["text": t] }
    var parts: [[String: Any]] = []
    for part in c.modelTurn?.parts ?? [] {
      if let text = part as? TextPart, !text.isThought {
        parts.append(["text": text.text])
      } else if let inline = part as? InlineDataPart {
        parts.append(["inlineData": ["mimeType": inline.mimeType, "data": inline.data.base64EncodedString()]])
      }
    }
    if !parts.isEmpty { content["modelTurn"] = ["parts": parts] }
    return ["serverContent": content]
  }
}
