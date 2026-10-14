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
import simd

@testable import ThreeLiveCompiler

/// Native-event parity: orbit camera, hand gestures, detections and the Gemini Live client.
final class NativeEventsTests: XCTestCase {

  // MARK: Orbit camera

  func testOrbitStringsParseLikeTheWebElement() {
    XCTAssertEqual(XROrbitCameraState.parseAngleDeg("30deg"), 30)
    XCTAssertEqual(XROrbitCameraState.parseAngleDeg("30"), 30)
    XCTAssertEqual(XROrbitCameraState.parseAngleDeg("\(Double.pi)rad")!, 180, accuracy: 1e-9)
    XCTAssertNil(XROrbitCameraState.parseAngleDeg("auto"))
    XCTAssertEqual(XROrbitCameraState.parseMeters("2.5m"), 2.5)
    XCTAssertEqual(XROrbitCameraState.parseCameraTarget("1m 2m 3"), SIMD3<Double>(1, 2, 3))
    XCTAssertNil(XROrbitCameraState.parseCameraTarget("1 2"))
    XCTAssertEqual(XROrbitCameraState.parseRotationPerSecond(nil), .pi / 6, accuracy: 1e-12)
    XCTAssertEqual(XROrbitCameraState.parseRotationPerSecond("30deg"), .pi / 6, accuracy: 1e-12)
    XCTAssertEqual(XROrbitCameraState.parseRotationPerSecond("10%"), .pi / 5, accuracy: 1e-12)
  }

  func testCameraOrbitFramesSceneAndReportsWebDetail() throws {
    var cam = XROrbitCameraState()
    cam.apply(XRCameraOptions(cameraOrbit: "90deg 0deg 4m"))
    cam.setBounds(center: SIMD3<Double>(0, 1, 0), radius: 1)
    XCTAssertEqual(cam.eye.x, 4, accuracy: 1e-9)
    XCTAssertEqual(cam.eye.y, 1, accuracy: 1e-9)
    XCTAssertEqual(cam.eye.z, 0, accuracy: 1e-9)
    let change = try XCTUnwrap(cam.pollChange())
    XCTAssertEqual(change.theta, 90)
    XCTAssertEqual(change.phi, 0)
    XCTAssertEqual(change.zoom, 0.63, accuracy: 1e-9)
    XCTAssertEqual(change.orbit, "90deg 0deg 4.0m")
    XCTAssertNil(cam.step(dt: 1.0 / 60, now: 0))
  }

  func testLimitsClampAndEasingIsFrameRateIndependent() {
    var a = XROrbitCameraState()
    var b = XROrbitCameraState()
    a.setBounds(center: .zero, radius: 1)
    b.setBounds(center: .zero, radius: 1)
    a.drag(dx: -100, dy: 0, now: 0)
    b.drag(dx: -100, dy: 0, now: 0)
    for _ in 0..<30 { _ = a.step(dt: 1.0 / 60, now: 0) }
    for _ in 0..<60 { _ = b.step(dt: 1.0 / 120, now: 0) }
    XCTAssertEqual(a.theta, b.theta, accuracy: 1e-9)

    var c = XROrbitCameraState()
    c.setBounds(center: .zero, radius: 2)
    c.drag(dx: 0, dy: 1e6, now: 0)
    c.pinch(scale: 1e6, now: 0)
    for _ in 0..<600 { _ = c.step(dt: 1.0 / 60, now: 0) }
    XCTAssertEqual(c.phi, .pi * 0.48, accuracy: 1e-6)
    XCTAssertEqual(c.distance, 1, accuracy: 1e-6)
  }

  func testAutoRotateTurntableAndViewportRay() {
    var cam = XROrbitCameraState()
    cam.apply(XRCameraOptions(cameraOrbit: "0deg 0deg 5m", fieldOfView: "90deg", autoRotate: true, autoRotateDelay: 1, rotationPerSecond: "90deg"))
    cam.setBounds(center: .zero, radius: 1)
    cam.touch(now: 0)
    _ = cam.step(dt: 0.25, now: 0.5)
    XCTAssertEqual(cam.turntable, 0)
    _ = cam.step(dt: 0.25, now: 1)
    XCTAssertEqual(cam.turntable, .pi / 8, accuracy: 1e-9)
    let ray = cam.viewportRay(ndc: SIMD2<Double>(0, 1), aspect: 2)
    XCTAssertEqual(ray.origin.z, 5, accuracy: 1e-9)
    XCTAssertEqual(ray.direction.y, 0.5.squareRoot(), accuracy: 1e-9)
  }

  // MARK: Hand gestures (web makeTestHand vectors)

  private func hand(_ mode: String) -> XRHandJointMap {
    var m: XRHandJointMap = [
      "wrist": SIMD3<Float>(0, 0, 0), "thumb-metacarpal": SIMD3<Float>(0.02, 0.03, 0),
      "index-finger-metacarpal": SIMD3<Float>(0, 0.06, 0), "middle-finger-metacarpal": SIMD3<Float>(0, 0.06, 0),
      "ring-finger-metacarpal": SIMD3<Float>(0, 0.06, 0), "pinky-finger-metacarpal": SIMD3<Float>(0, 0.06, 0),
    ]
    let tips: [SIMD3<Float>]
    switch mode {
    case "pinch": tips = [[0.02, 0.12, 0], [0.025, 0.12, 0], [0, 0.16, 0], [-0.02, 0.15, 0], [-0.04, 0.14, 0]]
    case "point": tips = [[0.01, 0.02, 0], [0, 0.18, 0], [0, 0.02, 0], [0, 0.02, 0], [0, 0.02, 0]]
    case "fist": tips = [[0.01, 0.01, 0], [0, 0.02, 0], [0, 0.02, 0], [0, 0.02, 0], [0, 0.02, 0]]
    case "thumbs-up":
      m["thumb-metacarpal"] = SIMD3<Float>(0, 0.05, 0)
      tips = [[0, 0.16, 0], [0, 0.02, 0], [0, 0.02, 0], [0, 0.02, 0], [0, 0.02, 0]]
    default: tips = [[0.04, 0.09, 0], [0.01, 0.18, 0], [0, 0.19, 0], [-0.01, 0.18, 0], [-0.02, 0.16, 0]]
    }
    for (name, tip) in zip(["thumb-tip", "index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip"], tips) {
      m[name] = tip
    }
    return m
  }

  func testGestureClassifierMatchesWebVectors() {
    XCTAssertEqual(XRHandGestureClassifier.classify(hand("pinch")).gesture, .pinch)
    XCTAssertEqual(XRHandGestureClassifier.classify(hand("point")).gesture, .point)
    XCTAssertEqual(XRHandGestureClassifier.classify(hand("fist")).gesture, .fist)
    XCTAssertEqual(XRHandGestureClassifier.classify(hand("thumbs-up")).gesture, .thumbsUp)
    let palm = XRHandGestureClassifier.classify(hand("open-palm")).gesture
    XCTAssertTrue(palm == .openPalm || palm == .spread)
    XCTAssertEqual(XRHandGestureClassifier.classify([:]).gesture, XRHandGesture.none)
    var tracker = XRHandGestureTracker()
    XCTAssertNotNil(tracker.update(hand: .left, joints: hand("fist")))
    XCTAssertNil(tracker.update(hand: .left, joints: hand("fist")))
    XCTAssertNil(tracker.update(hand: .left, joints: [:]))
    XCTAssertNotNil(tracker.update(hand: .left, joints: hand("fist")))
  }

  // MARK: Detections

  func testDetectionsUseFallbackDepthAndCap() {
    var proj = matrix_identity_float4x4
    proj.columns.2 = SIMD4<Float>(0, 0, -1, -1)
    proj.columns.3 = SIMD4<Float>(0, 0, -0.2, 0)
    let boxes = Array(repeating: XRDetections.Box(box: [0.4, 0.4, 0.6, 0.6], label: "cup"), count: 40)
    let out = XRDetections.detect(boxes, cameraWorld: matrix_identity_float4x4, projection: proj)
    XCTAssertEqual(out.count, WorldUnderstanding.maxDetections)
    XCTAssertEqual(out[0].position.z, -WorldUnderstanding.fallbackDepthMeters, accuracy: 1e-5)
    let withDepth = XRDetections.detect(
      Array(boxes.prefix(1)), cameraWorld: matrix_identity_float4x4, projection: proj, depthSampler: { _, _ in 1 })
    XCTAssertEqual(withDepth[0].position.z, -1, accuracy: 1e-5)
  }

  // MARK: Scene root (turntable) parity with Android

  func testRootTransformRotatesWorldAndLazyFollowStaysPut() throws {
    let json = #"""
      {"nodes":[{"name":"Box","translation":[0,0,-2]},
                {"name":"Hud","extras":{"xr":{"follow":{"mode":"head","lazy":true,"distance":1.0}}}}],
       "scenes":[{"nodes":[0,1]}]}
      """#
    let s = try XCTUnwrap(XRLiveRuntimeSession(gltfJSONData: Data(json.utf8)))
    for _ in 0..<120 { s.step(dt: 1.0 / 60, headPose: XRPose()) }
    let before = s.worldMatrix(of: 1).columns.3
    // 90° about +Y: (0, 0, -2) -> (-2, 0, 0).
    s.rootTransform = simd_float4x4(simd_quatf(angle: .pi / 2, axis: SIMD3<Float>(0, 1, 0)))
    let box = s.worldMatrix(of: 0).columns.3
    XCTAssertEqual(box.x, -2, accuracy: 1e-5)
    XCTAssertEqual(box.z, 0, accuracy: 1e-5)
    for _ in 0..<120 { s.step(dt: 1.0 / 60, headPose: XRPose()) }
    let after = s.worldMatrix(of: 1).columns.3
    XCTAssertEqual(before.x, after.x, accuracy: 0.02)
    XCTAssertEqual(before.y, after.y, accuracy: 0.02)
    XCTAssertEqual(before.z, after.z, accuracy: 0.02)
  }

  // MARK: Frame capture

  func testFrameFitPerspectiveAndHistory() {
    XCTAssertEqual(XRFrameCapture.fit(width: 1920, height: 1080, maxEdge: 768).width, 768)
    XCTAssertEqual(XRFrameCapture.fit(width: 1920, height: 1080, maxEdge: 768).height, 432)
    XCTAssertEqual(XRFrameCapture.fit(width: 640, height: 480, maxEdge: 768).width, 640)
    XCTAssertEqual(XRFrameCapture.fit(width: 0, height: 5, maxEdge: 768).width, 0)
    // 90° vertical FOV, aspect 2: p0 = 0.5, p5 = 1 (the layout WorldUnderstanding reads).
    let p = XRFrameCapture.perspective(fovYDegrees: 90, aspect: 2)
    XCTAssertEqual(p.columns.0.x, 0.5, accuracy: 1e-6)
    XCTAssertEqual(p.columns.1.y, 1, accuracy: 1e-6)
    XCTAssertEqual(p.columns.2.w, -1)
    let h = XRFrameHistory()
    for i in 0..<6 {
      h.remember(
        XRCapturedFrame(
          jpeg: Data([UInt8(i)]), width: 1, height: 1, cameraWorld: matrix_identity_float4x4,
          projection: p, timestamp: TimeInterval(i)))
    }
    XCTAssertEqual(h.latest?.timestamp, 5)
  }

  // MARK: Gemini Live

  private final class FakeTransport: GeminiLiveTransport {
    var onMessage: (([String: Any]) -> Void)?
    var onClose: (() -> Void)?
    var sent: [[String: Any]] = []
    var closed = false
    func send(_ message: [String: Any]) { if !closed { sent.append(message) } }
    func close() { closed = true }
  }

  private final class FakeSink: PcmAudioSink {
    var rates: [Int] = []
    var flushes = 0
    func enqueue(_ pcm16le: Data, sampleRate: Int) { rates.append(sampleRate) }
    func flush() { flushes += 1 }
    func close() {}
  }

  private func drainMain() {
    let e = expectation(description: "main")
    DispatchQueue.main.async { e.fulfill() }
    wait(for: [e], timeout: 1)
  }

  func testLiveURLPolicyAndEphemeralTokenURL() throws {
    XCTAssertTrue(GeminiLiveEndpoints.isAllowedLiveURL("wss://example.com/live"))
    XCTAssertTrue(GeminiLiveEndpoints.isAllowedLiveURL("ws://localhost:8080/x"))
    XCTAssertTrue(GeminiLiveEndpoints.isAllowedLiveURL("ws://127.0.0.1/x"))
    XCTAssertFalse(GeminiLiveEndpoints.isAllowedLiveURL("ws://example.com/live"))
    XCTAssertFalse(GeminiLiveEndpoints.isAllowedLiveURL("https://example.com"))
    XCTAssertFalse(GeminiLiveEndpoints.isAllowedLiveURL("javascript:alert(1)"))
    XCTAssertFalse(GeminiLiveEndpoints.isAllowedLiveURL(nil))
    let url = try XCTUnwrap(GeminiLiveEndpoints.ephemeralTokenURL(token: "auth_tokens/a+b c"))
    XCTAssertTrue(url.absoluteString.contains("BidiGenerateContentConstrained?access_token="))
    XCTAssertTrue(url.absoluteString.hasSuffix("auth_tokens/a%2Bb%20c"))
    XCTAssertNil(GeminiLiveEndpoints.ephemeralTokenURL(token: " "))
    XCTAssertNil(URLSessionLiveTransport(url: URL(string: "ws://example.com/x")!))
  }

  func testControllerTranscriptsAudioAndBargeIn() {
    let sink = FakeSink()
    let c = XRGeminiLiveController(audioSink: sink)
    var events: [TranscriptEvent] = []
    var interrupted = 0
    c.onTranscript = { events.append($0) }
    c.onInterrupted = { interrupted += 1 }
    let t = FakeTransport()
    c.connect(t, streamFrames: false)
    let pcm = Data([1, 0, 2, 0]).base64EncodedString()
    c.handleServerMessage(["serverContent": ["inputTranscription": ["text": "what is "]]])
    c.handleServerMessage(["serverContent": ["inputTranscription": ["text": "this"]]])
    c.handleServerMessage(["serverContent": ["outputTranscription": ["text": "A lamp"]]])
    c.handleServerMessage([
      "serverContent": ["modelTurn": ["parts": [["text": "IGNORED"], ["inlineData": ["mimeType": "audio/pcm;rate=16000", "data": pcm]]]]]
    ])
    c.handleServerMessage(["serverContent": ["turnComplete": true]])
    let flushesBefore = sink.flushes
    c.handleServerMessage(["serverContent": ["interrupted": true]])
    drainMain()
    XCTAssertEqual(events[1], TranscriptEvent(speaker: .user, text: "what is this", isFinal: false))
    XCTAssertTrue(events.contains(TranscriptEvent(speaker: .user, text: "what is this", isFinal: true)))
    XCTAssertTrue(events.contains(TranscriptEvent(speaker: .model, text: "A lamp", isFinal: true)))
    XCTAssertFalse(events.contains { $0.text.contains("IGNORED") })
    XCTAssertEqual(sink.rates, [16000])
    XCTAssertEqual(sink.flushes, flushesBefore + 1)
    XCTAssertEqual(interrupted, 1)
    XCTAssertEqual(XRGeminiLiveController.pcmRate(fromMime: "audio/pcm"), 24000)
    XCTAssertEqual(XRGeminiLiveController.pcmRate(fromMime: "audio/pcm;rate=96000"), 48000)
  }

  func testOutgoingMessagesMatchLiveAPIShapes() throws {
    let t = FakeTransport()
    let c = XRGeminiLiveController(frameProvider: { $0(Data([0xFF, 0xD8])) })
    c.connect(t, setup: ["model": "models/x"], streamFrames: false)
    c.sendText(String(repeating: "x", count: 5000))
    c.sendAudioChunk(Data([0, 0]), sampleRate: 1)
    XCTAssertTrue(c.sendFrame())
    XCTAssertEqual((t.sent[0]["setup"] as? [String: Any])?["model"] as? String, "models/x")
    let turns = try XCTUnwrap((t.sent[1]["clientContent"] as? [String: Any])?["turns"] as? [[String: Any]])
    let text = try XCTUnwrap((turns[0]["parts"] as? [[String: Any]])?[0]["text"] as? String)
    XCTAssertEqual(text.count, 4000)
    func mime(_ m: [String: Any]) -> String? {
      ((m["realtimeInput"] as? [String: Any])?["mediaChunks"] as? [[String: Any]])?[0]["mimeType"] as? String
    }
    XCTAssertEqual(mime(t.sent[2]), "audio/pcm;rate=8000")
    XCTAssertEqual(mime(t.sent[3]), "image/jpeg")
    c.disconnect()
    XCTAssertTrue(t.closed)
    c.sendText("dropped")
    XCTAssertEqual(t.sent.count, 4)
  }

  func testHoldToAskPromptMatchesWeb() {
    let opts = XRLiveHoldToAsk(prompt: "What is this?")
    XCTAssertEqual(
      XRGeminiLiveController.buildHoldToAskPrompt(meshName: "Lamp", options: opts),
      "The user is pointing at the 3D object \"Lamp\". What is this?")
    XCTAssertEqual(
      XRGeminiLiveController.buildHoldToAskPrompt(meshName: "", options: opts, transcript: "  how old is it "),
      "The user is pointing at the 3D object \"object\". how old is it")
    XCTAssertEqual(
      XRGeminiLiveController.buildHoldToAskPrompt(
        meshName: String(repeating: "m", count: 300), options: opts, transcript: String(repeating: "y", count: 5000)
      ).count, 4000)
  }
}
