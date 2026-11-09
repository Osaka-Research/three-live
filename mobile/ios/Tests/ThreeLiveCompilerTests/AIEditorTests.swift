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
  private var red: String {
    base.replacingOccurrences(
      of: "MeshStandardMaterial()", with: "MeshStandardMaterial({ color: 0xff0000 })")
  }

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
      if Date() > deadline {
        XCTFail("timed out")
        return
      }
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
    XCTAssertTrue(
      provider.requests[1][3].content.hasPrefix(
        "That script was rejected by the Three-Live sandbox:"))

    let lostSelection = base.replacingOccurrences(of: "'Roof'", with: "'Top'")
    let strict = AIEditor(
      source: base, provider: Scripted([fenced(lostSelection), fenced(lostSelection)])
    ) { _ in
      XCTFail("rejected edits must not be applied")
    }
    strict.selection = "Roof"
    let rejected = await strict.editScene("make it red")
    XCTAssertFalse(rejected.applied)
    XCTAssertEqual(
      rejected.error, "The edited scene no longer contains the selected mesh \"Roof\".")
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
    let parts = Data(
      #"{"choices":[{"message":{"content":[{"type":"text","text":"a"},"b"]}}]}"#.utf8)
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
    let tools = ((setup["session"] as? [String: Any])?["tools"] as? [[String: Any]])?.compactMap {
      $0["name"] as? String
    }
    XCTAssertEqual(tools, ["edit_scene", "undo_edit", "select_meshes"])
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
      transport.sent.contains {
        (($0["item"] as? [String: Any])?["type"] as? String) == "function_call_output"
      }
    }
    let output = transport.sent.first {
      (($0["item"] as? [String: Any])?["type"] as? String) == "function_call_output"
    }!
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
    XCTAssertThrowsError(
      try AIVoiceSession(editor: editor, transport: transport, provider: "pigeon"))
  }

  private let chairs = """
    const mk = (name, x, color) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1), new THREE.MeshStandardMaterial({ color }));
      m.name = name; m.position.set(x, 0.6, 0); scene.add(m);
    };
    mk('Chair_Left', -2, 0xd93025); mk('Chair_Middle', 0, 0x1a73e8); mk('Chair_Right', 2, 0xd93025);
    """

  func testTalkToSelectWithTheNativeCore() async throws {
    let provider = Scripted([#"{"ids": [1], "confidence": "high"}"#, fenced(chairs)])
    let editor = AIEditor(source: chairs, provider: provider) { _ in }
    var sources: [String] = []
    editor.onSelectionsChanged = { _, source in sources.append(source) }

    var r = await editor.selectByVoice("the red chairs")
    XCTAssertTrue(r.applied)
    XCTAssertEqual(r.tier, 1)
    XCTAssertEqual(editor.selections, ["Chair_Left", "Chair_Right"])
    XCTAssertEqual(r.say, "Selected 2: Chair Left and Chair Right.")

    r = await editor.selectByVoice("the red chair")
    XCTAssertFalse(r.applied)
    XCTAssertEqual(r.candidates, ["Chair_Left", "Chair_Right"])
    XCTAssertEqual(r.say, "Which one: Chair Left or Chair Right?")
    XCTAssertTrue(provider.requests.isEmpty, "ambiguous references ask the user, not the model")

    r = await editor.selectByVoice("the chair next to the window")
    XCTAssertTrue(r.applied)
    XCTAssertEqual(r.tier, 2)
    XCTAssertEqual(editor.selections, ["Chair_Middle"])
    XCTAssertTrue(provider.requests[0][0].content.hasPrefix("You find the objects a user means"))

    // Left / right follow the camera: seen from behind, the left chair is Chair_Right.
    editor.camera = AICamera(eye: [0, 1.6, -5], target: [0, 0.8, 0])
    r = await editor.selectByVoice("the leftmost chair")
    XCTAssertEqual(editor.selections, ["Chair_Right"])
    editor.camera = nil

    editor.setSelection(["Chair_Left", "Chair_Middle"])
    r = await editor.selectByVoice("the blue one", mode: "remove")
    XCTAssertTrue(r.applied)
    XCTAssertEqual(editor.selections, ["Chair_Left"])
    r = await editor.selectNames(["Chair_Right", "Nope"], mode: "add")
    XCTAssertEqual(editor.selections, ["Chair_Left", "Chair_Right"])
    r = await editor.selectByVoice("", mode: "clear")
    XCTAssertEqual(r.say, "Selection cleared.")
    r = await editor.selectByVoice("the sofa", mode: "remove")
    XCTAssertEqual(r.say, "Nothing is selected.")

    XCTAssertEqual(editor.toggleSelection("Chair_Left"), "Chair_Left")
    editor.toggleSelection("Chair_Right", additive: true)
    XCTAssertEqual(editor.selections, ["Chair_Left", "Chair_Right"])
    XCTAssertTrue(sources.contains("voice") && sources.contains("tap") && sources.contains("api"))

    let command = await editor.parseCommand("select the lamp and make it blue")
    XCTAssertEqual(
      command,
      AIVoiceCommand(kind: "mixed", mode: "replace", query: "the lamp", instruction: "make it blue")
    )

    // Several selected meshes reach the edit prompt.
    let result = await editor.editScene("make them blue", dryRun: true)
    XCTAssertTrue(result.applied, result.error ?? "")
    let prompt = provider.requests.last?.last?.content ?? ""
    XCTAssertTrue(
      prompt.contains(#"The user selected the meshes named "Chair_Left", "Chair_Right""#), prompt)
  }

  private let cleanDeskScene = """
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.74, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 })
    );
    desk.name = 'Desk';
    desk.position.set(0, 0.37, 0);
    scene.add(desk);
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.16, 0.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xf4c430, roughness: 0.3 })
    );
    lamp.name = 'Lamp';
    lamp.position.set(0.4, 0.94, 0);
    lamp.userData.xr = { grab: true };
    scene.add(lamp);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(2, 4, 3);
    scene.add(dir);
    camera.position.set(0, 1.4, 2.6);
    camera.lookAt(0, 0.5, 0);
    """

  func testCompileFromImageWithNativeCoreAndSpatialPriors() async throws {
    let applied = Applied()
    let unnamedLampScene = cleanDeskScene.replacingOccurrences(
      of: "lamp.name = 'Lamp';\n", with: "")
    let blueLampScene = cleanDeskScene.replacingOccurrences(of: "0xf4c430", with: "0x1a73e8")

    // Turn 0 emits unnamedLampScene ([TL204] warning) -> Turn 1 repairs it to cleanDeskScene -> Next call edits Lamp to blue.
    let provider = Scripted([
      fenced(unnamedLampScene), fenced(cleanDeskScene), fenced(blueLampScene),
    ])
    let editor = AIEditor(provider: provider) { applied.add($0) }

    let planes = [
      WorldUnderstanding.TrackedPlane(
        orientation: .horizontal, center: SIMD3<Float>(0, 0, 0), normal: SIMD3<Float>(0, 1, 0),
        radius: 1.5)
    ]
    let detections = [
      WorldUnderstanding.Detection3D(
        label: "desk", position: SIMD3<Float>(0, 0.37, 0), widthMeters: 1.4, heightMeters: 0.74,
        depthSource: .depth)
    ]
    let priors = AISpatialPriors.fromWorldUnderstanding(
      planes: planes, detections: detections,
      camera: AICamera(eye: [0, 1.4, 2.6], target: [0, 0.5, 0]), floorY: 0.0)
    XCTAssertEqual(priors.planes.count, 1)
    XCTAssertEqual(priors.objects.count, 1)

    let pngBytes = Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x01, 0x02, 0x03])
    XCTAssertEqual(AIEditor.detectImageMime(pngBytes), "image/png")
    XCTAssertNil(AIEditor.detectImageMime(Data([0x01, 0x02])))

    let imgRes = await editor.compileFromImageData(
      pngBytes, prompt: "interactive desk with a toggleable lamp", priors: priors)
    XCTAssertTrue(imgRes.applied, imgRes.error ?? "")
    XCTAssertEqual(imgRes.repairs, 1, "TL204 warning on turn 0 should trigger 1 auto-repair turn")
    XCTAssertTrue(
      imgRes.warnings.isEmpty, "Repaired scene should have 0 warnings: \(imgRes.warnings)")
    XCTAssertEqual(editor.source, cleanDeskScene)
    guard provider.requests.count >= 2, provider.requests[0].count >= 2,
      provider.requests[1].count >= 4
    else {
      XCTFail("Expected 2 provider requests with repair turn, got: \(provider.requests.count)")
      return
    }
    XCTAssertEqual(provider.requests[0][1].imageUrls.count, 1)
    XCTAssertTrue(provider.requests[0][1].imageUrls[0].hasPrefix("data:image/png;base64,"))
    XCTAssertTrue(
      provider.requests[0][1].content.contains("Metric spatial priors (world meters, +Y up):"))
    XCTAssertTrue(provider.requests[1][3].content.contains("[TL204]"))

    // Starting from an empty initial source should not push "" onto undo history.
    let undoEmpty = try await editor.undo()
    XCTAssertFalse(undoEmpty)

    // Chain into Talk-to-Select -> editScene -> undo!
    let sel = await editor.selectByVoice("the lamp")
    XCTAssertTrue(sel.applied)
    XCTAssertEqual(editor.selections, ["Lamp"])
    let editRes = await editor.editScene("make it blue")
    XCTAssertTrue(editRes.applied, editRes.error ?? "")
    XCTAssertEqual(editor.source, blueLampScene)
    let undone = try await editor.undo()
    XCTAssertTrue(undone)
    XCTAssertEqual(editor.source, cleanDeskScene)

    // Verify fallback to turn-0 compiling candidate when warning-repair turn fails to compile.
    let fallbackProvider = Scripted([fenced(unnamedLampScene), fenced("scene.add(new THREE.Mesh(")])
    let fallbackEditor = AIEditor(provider: fallbackProvider) { _ in }
    let fbRes = await fallbackEditor.compileFromImage("data:image/png;base64,AAAA")
    XCTAssertTrue(fbRes.applied)
    XCTAssertEqual(fbRes.repairs, 1)
    XCTAssertEqual(fbRes.code, unnamedLampScene)
    XCTAssertFalse(fbRes.warnings.isEmpty)
  }
}
