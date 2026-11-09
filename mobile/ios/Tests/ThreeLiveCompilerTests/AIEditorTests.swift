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

import XCTest

@testable import ThreeLiveCompiler

/// Tap & Speak on iOS (B2b-3), exercised against the real shared Rust core: prompts, reply
/// parsing, sandbox validation, and the realtime voice protocol all come from `three_live_ai_call`.
final class AIEditorTests: XCTestCase {

  private let base = """
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial());
    roof.name = 'Roof';
    roof.position.y = 2;
    scene.add(roof);
    """
  private var red: String { base.replacingOccurrences(of: "MeshStandardMaterial()", with: "MeshStandardMaterial({ color: 0xff0000 })") }

  private final class Scripted: AIProvider {
    var replies: [String]
    var requests: [[AIChatMessage]] = []
    init(_ replies: [String]) { self.replies = replies }
    func complete(_ messages: [AIChatMessage]) async throws -> String {
      requests.append(messages)
      guard !replies.isEmpty else { throw AIEditError("no more replies") }
      return replies.removeFirst()
    }
  }

  private final class Applied: @unchecked Sendable {
    private let lock = NSLock()
    private var items: [String] = []
    func add(_ s: String) {
      lock.lock()
      items.append(s)
      lock.unlock()
    }
    var all: [String] {
      lock.lock()
      defer { lock.unlock() }
      return items
    }
  }

  private final class FakeTransport: GeminiLiveTransport, @unchecked Sendable {
    var onMessage: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    private let lock = NSLock()
    private var _sent: [[String: Any]] = []
    private(set) var closed = false
    var sent: [[String: Any]] {
      lock.lock()
      defer { lock.unlock() }
      return _sent
    }
    func send(_ message: [String: Any]) {
      lock.lock()
      if !closed { _sent.append(message) }
      lock.unlock()
    }
    func close() { closed = true }
  }

  private final class FakeSink: PcmAudioSink {
    var chunks: [(Int, Int)] = []
    var flushes = 0
    var closed = false
    func enqueue(_ pcm16le: Data, sampleRate: Int) { chunks.append((pcm16le.count, sampleRate)) }
    func flush() { flushes += 1 }
    func close() { closed = true }
  }

  private func fenced(_ code: String) -> String { "Here:\n```js\n\(code)\n```" }

  private func waitUntil(_ timeout: TimeInterval = 10, _ cond: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !cond() {
      if Date() > deadline { XCTFail("timed out"); return }
      try await Task.sleep(nanoseconds: 10_000_000)
    }
  }

  func testEditValidatesWithTheNativeCoreAndUndoes() async throws {
    let applied = Applied()
    let provider = Scripted([fenced(red)])
    let editor = AIEditor(source: base, provider: provider) { applied.add($0) }
    editor.toggleSelection("Roof")
    let result = await editor.editScene("make it red")
    XCTAssertTrue(result.applied, result.error ?? "")
    XCTAssertEqual(editor.source, red)
    XCTAssertEqual(applied.all, [red])
    let user = provider.requests[0][1].content
    XCTAssertTrue(user.contains("The user selected the mesh named \"Roof\""))
    XCTAssertTrue(user.hasSuffix("Instruction: make it red"))
    XCTAssertEqual(provider.requests[0][0].role, "system")
    let undone = try await editor.undo()
    XCTAssertTrue(undone)
    XCTAssertEqual(editor.source, base)
    let again = try await editor.undo()
    XCTAssertFalse(again)
  }

  func testBrokenReplyIsRepairedOnceThenRejected() async throws {
    let provider = Scripted([fenced("scene.add(new THREE.Mesh("), fenced(red)])
    let editor = AIEditor(source: base, provider: provider) { _ in }
    let ok = await editor.editScene("make it red")
    XCTAssertTrue(ok.applied, ok.error ?? "")
    XCTAssertEqual(ok.repairs, 1)
    XCTAssertTrue(provider.requests[1][3].content.hasPrefix("That script was rejected by the Three-Live sandbox:"))

    let lostSelection = base.replacingOccurrences(of: "'Roof'", with: "'Top'")
    let strict = AIEditor(source: base, provider: Scripted([fenced(lostSelection), fenced(lostSelection)])) { _ in
      XCTFail("rejected edits must not be applied")
    }
    strict.selection = "Roof"
    let rejected = await strict.editScene("make it red")
    XCTAssertFalse(rejected.applied)
    XCTAssertEqual(rejected.error, "The edited scene no longer contains the selected mesh \"Roof\".")
    XCTAssertEqual(strict.source, base)

    let failing = await AIEditor(source: base, provider: Scripted([])) { _ in }.editScene("x")
    XCTAssertEqual(failing.error, "no more replies")
    let described = await editor.describe(failing)
    XCTAssertTrue(described.hasPrefix("Sorry, I couldn't apply that: no more replies"))
  }

  func testChatProviderPolicyAndParsing() throws {
    XCTAssertNotNil(AIChatProvider(endpoint: "https://example.com/chat"))
    XCTAssertNotNil(AIChatProvider(endpoint: "http://localhost:11434/v1/chat/completions"))
    XCTAssertNil(AIChatProvider(endpoint: "http://example.com/chat"))
    let parts = Data(#"{"choices":[{"message":{"content":[{"type":"text","text":"a"},"b"]}}]}"#.utf8)
    XCTAssertEqual(try AIChatProvider.parseContent(parts), "ab")
    XCTAssertThrowsError(try AIChatProvider.parseContent(Data(#"{"choices":[]}"#.utf8)))
  }

  func testRealtimeVoiceSessionRunsEditToolAndCloses() async throws {
    let applied = Applied()
    let editor = AIEditor(source: base, provider: Scripted([fenced(red)])) { applied.add($0) }
    editor.selection = "Roof"
    let transport = FakeTransport()
    let sink = FakeSink()
    let session = try AIVoiceSession(editor: editor, transport: transport, sink: sink)
    let rate = try await session.start()
    XCTAssertEqual(rate, 24_000)
    let setup = transport.sent[0]
    XCTAssertEqual(setup["type"] as? String, "session.update")
    let tools = ((setup["session"] as? [String: Any])?["tools"] as? [[String: Any]])?.compactMap { $0["name"] as? String }
    XCTAssertEqual(tools, ["edit_scene", "undo_edit"])
    XCTAssertTrue(
      transport.sent.contains { (($0["item"] as? [String: Any])?["role"] as? String) == "system" })

    session.sendAudio(Data([1, 2, 3, 4]))
    XCTAssertEqual(transport.sent.last?["type"] as? String, "input_audio_buffer.append")

    transport.onMessage?(["type": "response.output_audio.delta", "delta": "AAAAAA=="])
    transport.onMessage?(["type": "input_audio_buffer.speech_started"])
    transport.onMessage?([
      "type": "response.function_call_arguments.done", "call_id": "call_1", "name": "edit_scene",
      "arguments": #"{"instruction":"make it red"}"#,
    ])
    try await waitUntil {
      transport.sent.contains { (($0["item"] as? [String: Any])?["type"] as? String) == "function_call_output" }
    }
    let output = transport.sent.first { (($0["item"] as? [String: Any])?["type"] as? String) == "function_call_output" }!
    let item = output["item"] as! [String: Any]
    XCTAssertEqual(item["call_id"] as? String, "call_1")
    XCTAssertTrue((item["output"] as? String ?? "").contains("\"applied\":true"))
    XCTAssertEqual(transport.sent.last?["type"] as? String, "response.create")
    XCTAssertEqual(editor.source, red)
    XCTAssertEqual(sink.chunks.first?.1, 24_000)
    XCTAssertEqual(sink.flushes, 1)

    session.close()
    let count = transport.sent.count
    session.sendAudio(Data([1, 2]))
    XCTAssertEqual(transport.sent.count, count)
    XCTAssertTrue(transport.closed && sink.closed)
    XCTAssertEqual(session.state, .closed)
  }

  func testGeminiLiveSessionUses16kAndRejectsUnknownProviders() async throws {
    let editor = AIEditor(source: base, provider: Scripted([])) { _ in }
    let transport = FakeTransport()
    let session = try AIVoiceSession(editor: editor, transport: transport, provider: "gemini-live")
    let rate = try await session.start()
    XCTAssertEqual(rate, 16_000)
    XCTAssertNotNil(transport.sent[0]["setup"])
    session.close()
    XCTAssertThrowsError(try AIVoiceSession(editor: editor, transport: transport, provider: "pigeon"))
  }
}
