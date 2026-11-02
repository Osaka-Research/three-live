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

// Numeric expectations mirror `xr-live/tests/xr_plugins_test.ts` so every platform is
// checked against the same contract (docs/xr-spatial-parity.md).

import XCTest
import simd

@testable import ThreeLiveCompiler

/// Records every delegate callback.
private final class Recorder: XRLiveRuntimeSessionDelegate {
  var transforms: [Int: XRNodeTransform] = [:]
  var visibility: [(Int, Bool)] = []
  var materials: [Int: XRMaterialState] = [:]
  var events: [(String, String)] = []
  var animationStarts: [(Int?, String?)] = []
  var animationStops = 0

  func nodeTransformChanged(_ nodeIndex: Int, transform: XRNodeTransform) {
    transforms[nodeIndex] = transform
  }

  func visibilityChanged(_ nodeIndex: Int, visible: Bool) {
    visibility.append((nodeIndex, visible))
  }

  func materialChanged(_ materialIndex: Int, material: XRMaterialState) {
    materials[materialIndex] = material
  }

  func interactivityEvent(id: String, payloadJSON: String) {
    events.append((id, payloadJSON))
  }

  func animationStart(index: Int?, name: String?) {
    animationStarts.append((index, name))
  }

  func animationStop() {
    animationStops += 1
  }
}

final class XRLiveRuntimeSessionTests: XCTestCase {

  // MARK: - Helpers

  private func obj(_ json: String, file: StaticString = #filePath, line: UInt = #line)
    -> [String: Any]
  {
    guard let data = json.data(using: .utf8),
      let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      XCTFail("invalid test JSON", file: file, line: line)
      return [:]
    }
    return parsed
  }

  private func session(_ json: String, file: StaticString = #filePath, line: UInt = #line)
    -> (XRLiveRuntimeSession, Recorder)
  {
    let s = XRLiveRuntimeSession(gltf: obj(json, file: file, line: line))
    let r = Recorder()
    s.delegate = r
    return (s, r)
  }

  private static func makeGLB(_ json: String) -> Data {
    var payload = Array(json.utf8)
    while payload.count % 4 != 0 { payload.append(0x20) }
    var d = Data()
    func u32(_ v: UInt32) {
      d.append(contentsOf: [
        UInt8(truncatingIfNeeded: v), UInt8(truncatingIfNeeded: v >> 8),
        UInt8(truncatingIfNeeded: v >> 16), UInt8(truncatingIfNeeded: v >> 24),
      ])
    }
    u32(0x4654_6C67)
    u32(2)
    u32(UInt32(12 + 8 + payload.count))
    u32(UInt32(payload.count))
    u32(0x4E4F_534A)
    d.append(contentsOf: payload)
    return d
  }

  private func translation(_ s: XRLiveRuntimeSession, _ i: Int) -> SIMD3<Float> {
    s.nodeTransform(at: i)?.translation ?? SIMD3<Float>(.nan, .nan, .nan)
  }

  // MARK: - Canonical traits

  func testCanonicalTraitParsingClampsLikeTheSchema() throws {
    let xr = obj(
      #"""
      {"follow": {"mode": "head", "distance": 99, "deadzoneDeg": -5, "stiffness": "x"},
       "particles": {"preset": "snow", "count": 1e9, "area": 999},
       "grab": true, "handles": true, "holdToAsk": {"holdMs": 1},
       "splatUrl": "../secret.spz",
       "audio": {"src": "https://cdn.test/hum.mp3", "loop": true},
       "orbit": {"target": [1, 2, 3], "radius": 0, "speed": 100}}
      """#)
    let t = try XCTUnwrap(XRLiveTraitParser.normalize(xr))
    let follow = try XCTUnwrap(t.lazyFollow)
    XCTAssertNil(t.follow, "object follows are lazy")
    XCTAssertEqual(follow.distance, 10)
    XCTAssertEqual(follow.deadzoneDeg, 0)
    XCTAssertEqual(follow.stiffness, 6)
    XCTAssertEqual(follow.height, -0.1, accuracy: 1e-6)
    XCTAssertTrue(follow.faceUser && follow.snapOnStart)

    let particles = try XCTUnwrap(t.particles)
    XCTAssertEqual(particles.preset, .snow)
    XCTAssertEqual(particles.count, 2000)
    XCTAssertEqual(particles.area.x, 50)
    XCTAssertEqual(t.grab, "2-hand")
    XCTAssertEqual(t.handles, XRLiveHandles(rotateAxis: "y", minScale: 0.1, maxScale: 10))
    XCTAssertEqual(t.holdToAsk?.holdMs, 100)
    XCTAssertEqual(t.holdToAsk?.prompt, "What is this?")
    XCTAssertNil(t.splatUrl, "`..` paths are rejected by safeMediaUrl")
    XCTAssertEqual(t.audio?.src, "https://cdn.test/hum.mp3")
    XCTAssertEqual(t.audio?.loop, true)
    XCTAssertEqual(t.orbit?.targetPoint, SIMD3<Float>(1, 2, 3))
    XCTAssertEqual(t.orbit?.radius ?? 0, 0.01, accuracy: 1e-6)
    XCTAssertEqual(t.orbit?.speed, 20)
  }

  func testEagerFollowAndLegacyAliases() throws {
    let eager = try XCTUnwrap(XRLiveTraitParser.normalize(obj(#"{"follow": "hand-left"}"#)))
    XCTAssertEqual(eager.follow, "hand-left")
    XCTAssertNil(eager.lazyFollow)

    let lazyFalse = try XCTUnwrap(
      XRLiveTraitParser.normalize(obj(#"{"follow": {"mode": "hand-right", "lazy": false}}"#)))
    XCTAssertEqual(lazyFalse.follow, "hand-right", "{lazy:false} objects are eager")
    XCTAssertNil(lazyFalse.lazyFollow)

    let hand = try XCTUnwrap(
      XRLiveTraitParser.normalize(obj(#"{"follow": {"mode": "hand-left"}}"#))?.lazyFollow)
    XCTAssertEqual(hand.distance, 0.15, accuracy: 1e-6)
    XCTAssertEqual(hand.height, 0.12, accuracy: 1e-6)

    let scale = try XCTUnwrap(XRLiveTraitParser.normalize(obj(#"{"scalable": true}"#))?.scale)
    XCTAssertEqual(scale.min, 0.05, accuracy: 1e-6)
    XCTAssertEqual(scale.max, 5, accuracy: 1e-6)
    XCTAssertNil(
      XRLiveTraitParser.normalize(obj(#"{"scale": false, "scalable": true}"#)),
      "`scale: false` wins over the legacy alias")

    XCTAssertNil(XRLiveTraitParser.normalize(obj(#"{"grab": 1}"#)), "numbers are not booleans")
    XCTAssertNil(XRLiveTraitParser.normalize("not a dictionary"))
    XCTAssertEqual(
      XRLiveTraitParser.normalize(obj(#"{"traits": ["grab", "billboard"]}"#))?.billboard,
      "capsule")
    let longName = String(repeating: "x", count: 300)
    let rawOrbit: [String: Any] = ["target": longName]
    let orbit = XRLiveTraitParser.parseOrbit(rawOrbit)
    XCTAssertNil(orbit?.targetName, "over-long orbit target names rejected")
    XCTAssertNil(XRLiveTraitParser.parseHandles(false))
    let rawHandles: [String: Any] = ["minScale": 5, "maxScale": 1]
    let inverted = try XCTUnwrap(XRLiveTraitParser.parseHandles(rawHandles))
    XCTAssertGreaterThanOrEqual(inverted.maxScale, inverted.minScale)
    let rawParticles: [String: Any] = ["preset": "bogus"]
    XCTAssertEqual(XRLiveTraitParser.parseParticles(rawParticles)?.preset, .rain)
  }

  func testSafeMediaUrlAllowList() {
    XCTAssertEqual(XRJSON.safeMediaUrl("https://a.com/x.spz"), "https://a.com/x.spz")
    XCTAssertEqual(XRJSON.safeMediaUrl(" scans/room.spz "), "scans/room.spz")
    XCTAssertNil(XRJSON.safeMediaUrl("http://a.com/x.spz"))
    XCTAssertNil(XRJSON.safeMediaUrl("javascript:alert(1)"))
    XCTAssertNil(XRJSON.safeMediaUrl("//evil.com/x"))
    XCTAssertNil(XRJSON.safeMediaUrl("a/../b"))
    XCTAssertNil(XRJSON.safeMediaUrl("a%2e%2e/b"))
    XCTAssertNil(XRJSON.safeMediaUrl("a\\b"))
    XCTAssertNil(XRJSON.safeMediaUrl("https:///x"))
  }

  func testUsdCustomDataRoundTrip() throws {
    let t = try XCTUnwrap(
      XRLiveTraitParser.normalize(usdCustomData: [
        "follow": "head", "followLazy": true, "followDistance": 1.2, "handles": true,
        "particlesPreset": "rain", "particlesCount": 5000.0, "particlesArea": [1.0, 2.0, 3.0],
        "orbitTarget": "Sun", "orbitRadius": 0.4,
      ]))
    XCTAssertEqual(t.lazyFollow?.distance ?? 0, 1.2, accuracy: 1e-6)
    XCTAssertEqual(t.handles?.maxScale, 10)
    XCTAssertEqual(t.particles?.count, 2000)
    XCTAssertEqual(t.particles?.area, SIMD3<Float>(1, 2, 3))
    XCTAssertEqual(t.orbit?.targetName, "Sun")
  }

  func testGLBJsonChunkAndInteractivityExtraction() throws {
    let json = #"""
      {"nodes": [{"name": "Lamp", "extras": {"xr": {"follow": {"distance": 2}}}}],
       "extensions": {"KHR_interactivity": {"graphs": [{"nodes": []}], "graph": 0}}}
      """#
    let glb = Self.makeGLB(json)
    let root = try XCTUnwrap(XRLiveGLB.jsonRoot(fromGLB: glb))
    XCTAssertNotNil(root["nodes"])
    let traits = XRLiveTraitParser.traits(fromGLTF: root)
    XCTAssertEqual(traits[0]?.lazyFollow?.distance, 2)
    let ext = try XCTUnwrap(XRLiveGLB.interactivityJSON(fromGLB: glb))
    let parsed = try XCTUnwrap(try JSONSerialization.jsonObject(with: ext) as? [String: Any])
    XCTAssertNotNil(parsed["graphs"])

    // Truncated / corrupt containers are rejected without trapping.
    XCTAssertNil(XRLiveGLB.jsonRoot(fromGLB: glb.prefix(30)))
    XCTAssertNil(XRLiveGLB.jsonRoot(fromGLB: Data(repeating: 0x41, count: 64)))
    var badLength = glb
    badLength[badLength.startIndex + 12] = 0xFF
    badLength[badLength.startIndex + 13] = 0xFF
    XCTAssertNil(XRLiveGLB.jsonChunk(fromGLB: badLength))
    XCTAssertNil(XRLiveGLB.jsonChunk(fromGLB: glb.dropFirst(1)))
    XCTAssertEqual(XRLiveGLB.usdPrimName(for: "2 lamp-a", fallback: "x"), "_2_lamp_a")
  }

  #if canImport(RealityKit) && !os(tvOS)
    func testEntityTraitsReadLazyFollowObjects() throws {
      let xr = obj(
        #"{"grab": "1-hand", "follow": {"mode": "head", "lazy": true, "distance": 1.5}, "physics": "kinematic"}"#
      )
      let traits = XRLiveEntityTraits.from(xr: xr)
      XCTAssertEqual(traits.grabbable, true)
      XCTAssertEqual(traits.grabMode, "1-hand")
      XCTAssertEqual(traits.follow, "head")
      XCTAssertEqual(traits.followDistance, 1.5)
      XCTAssertEqual(traits.lazyFollow?.distance, 1.5)
      XCTAssertEqual(traits.physics, "kinematic", "legacy raw physics string is preserved")

      let encoded = try JSONEncoder().encode(traits)
      XCTAssertEqual(try JSONDecoder().decode(XRLiveEntityTraits.self, from: encoded), traits)
    }
  #endif

  // MARK: - KHR_interactivity VM

  private static let toggleVisibilityScene = #"""
    {"nodes": [{"name": "Lamp", "children": [1]}, {"name": "Bulb"}],
     "extensions": {"KHR_interactivity": {"graph": 0, "graphs": [{
       "declarations": [{"op": "variable/get"}, {"op": "math/not"}, {"op": "variable/set"},
                        {"op": "pointer/set"}, {"op": "pointer/onSelect"}],
       "variables": [{"id": "__vis_0_0", "type": "bool", "value": true}],
       "events": [],
       "nodes": [
         {"declaration": 0, "configuration": {"variable": 0}},
         {"declaration": 1, "values": {"a": {"node": 0, "socket": "value"}}},
         {"declaration": 2, "configuration": {"variable": 0},
          "values": {"value": {"node": 1, "socket": "value"}}, "flows": {"out": {"node": 3}}},
         {"declaration": 3,
          "configuration": {"pointer": "/nodes/0/extensions/KHR_node_visibility/visible"},
          "values": {"value": {"node": 0, "socket": "value"}}},
         {"declaration": 4, "configuration": {"nodeIndex": 0}, "flows": {"out": {"node": 2}}}
       ]}]}}}
    """#

  func testOnSelectToggleVisibility() {
    let (s, r) = session(Self.toggleVisibilityScene)
    XCTAssertTrue(s.hasInteractivity)
    XCTAssertNil(s.interactivityError)
    XCTAssertTrue(s.isSelectable(1), "children of the trigger node are selectable")
    s.start()
    XCTAssertTrue(s.isVisible(0))
    s.dispatchSelect(nodeIndex: 1)
    XCTAssertFalse(s.isVisible(0), "selecting a descendant toggles the trigger node")
    XCTAssertFalse(s.isEffectivelyVisible(1))
    XCTAssertEqual(r.visibility.last?.0, 0)
    XCTAssertEqual(r.visibility.last?.1, false)
    s.dispatchSelect(nodeIndex: 0)
    XCTAssertTrue(s.isVisible(0))
    XCTAssertEqual(r.visibility.count, 2)
  }

  func testInterpolateTweenCompletesWithSmoothstepAndSlerp() throws {
    let (s, r) = session(
      #"""
      {"nodes": [{"name": "Box"}],
       "extensions": {"KHR_interactivity": {"nodes": [
         {"op": "pointer/interpolate", "configuration": {"pointer": "/nodes/0/translation"},
          "values": {"value": {"value": [0, 1, 0]}, "duration": {"value": 0.5}}},
         {"op": "pointer/interpolate", "configuration": {"pointer": "/nodes/0/rotation"},
          "values": {"value": {"value": [0, 0.7071068, 0, 0.7071068]}, "duration": {"value": 1}}},
         {"op": "flow/sequence", "flows": {"0": {"node": 0}, "1": {"node": 1}}},
         {"op": "pointer/onSelect", "configuration": {"nodeIndex": 0}, "flows": {"out": {"node": 2}}}
       ]}}}
      """#)
    s.dispatchSelect(nodeIndex: 0)
    s.step(dt: 0.25)
    XCTAssertEqual(translation(s, 0).y, 0.5, accuracy: 1e-4, "smoothstep(0.5) = 0.5")
    s.step(dt: 0.25)
    XCTAssertEqual(translation(s, 0).y, 1, accuracy: 1e-5)
    let q = try XCTUnwrap(s.nodeTransform(at: 0)?.rotation)
    XCTAssertEqual(XRSpatialMath.yawFromQuat(q), Float.pi / 4, accuracy: 1e-3, "slerp halfway")
    XCTAssertEqual(simd_length(q.vector), 1, accuracy: 1e-4)
    // `step` clamps dt to 0.25 s (web VM parity), so finish the 1 s tween in two steps.
    s.step(dt: 0.25)
    s.step(dt: 0.25)
    XCTAssertEqual(
      XRSpatialMath.yawFromQuat(try XCTUnwrap(s.nodeTransform(at: 0)?.rotation)), Float.pi / 2,
      accuracy: 1e-3)
    XCTAssertEqual(r.transforms[0]?.translation.y ?? 0, 1, accuracy: 1e-5)
  }

  func testCycleMaterialColor() {
    let (s, r) = session(
      #"""
      {"nodes": [{"name": "Ball", "mesh": 0}],
       "meshes": [{"primitives": [{"material": 0}]}],
       "materials": [{"pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1]}}],
       "extensions": {"KHR_interactivity": {"graphs": [{
         "variables": [{"id": "__color_idx_0_0", "type": "int", "value": 0}],
         "nodes": [
           {"op": "variable/get", "configuration": {"variable": 0}},
           {"op": "math/add", "values": {"a": {"node": 0, "socket": "value"}, "b": {"value": 1}}},
           {"op": "math/rem", "values": {"a": {"node": 1, "socket": "value"}, "b": {"value": 3}}},
           {"op": "variable/set", "configuration": {"variable": 0},
            "values": {"value": {"node": 2, "socket": "value"}}, "flows": {"out": {"node": 7}}},
           {"op": "pointer/set",
            "configuration": {"pointer": "/materials/0/pbrMetallicRoughness/baseColorFactor"},
            "values": {"value": {"value": [1, 0, 0, 1]}}},
           {"op": "pointer/set",
            "configuration": {"pointer": "/materials/0/pbrMetallicRoughness/baseColorFactor"},
            "values": {"value": {"value": [0, 1, 0, 1]}}},
           {"op": "pointer/set",
            "configuration": {"pointer": "/materials/0/pbrMetallicRoughness/baseColorFactor"},
            "values": {"value": {"value": [0, 0, 1, 1]}}},
           {"op": "flow/switch", "values": {"selection": {"node": 0, "socket": "value"}},
            "flows": {"0": {"node": 4}, "1": {"node": 5}, "2": {"node": 6}}},
           {"op": "pointer/onSelect", "configuration": {"nodeIndex": 0}, "flows": {"out": {"node": 3}}}
         ]}]}}}
      """#)
    XCTAssertEqual(s.materialIndices(forNode: 0), [0])
    s.dispatchSelect(nodeIndex: 0)
    XCTAssertEqual(s.materialColor(0), SIMD4<Float>(0, 1, 0, 1))
    s.dispatchSelect(nodeIndex: 0)
    XCTAssertEqual(s.materialColor(0), SIMD4<Float>(0, 0, 1, 1))
    s.dispatchSelect(nodeIndex: 0)
    XCTAssertEqual(s.materialColor(0), SIMD4<Float>(1, 0, 0, 1))
    XCTAssertEqual(r.materials[0]?.baseColorFactor, SIMD4<Float>(1, 0, 0, 1))
  }

  func testSendEventReachesReceiveAndEventSendNotifiesHost() throws {
    let (s, r) = session(
      #"""
      {"nodes": [{"name": "Panel"}],
       "extensions": {"KHR_interactivity": {"graphs": [{
         "events": [{"id": "hide"}, {"id": "ping"}],
         "nodes": [
           {"op": "event/receive", "configuration": {"event": 0}, "flows": {"out": {"node": 1}}},
           {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/visible"},
            "values": {"value": {"value": false}}},
           {"op": "event/send", "configuration": {"event": 1}, "values": {"count": {"value": 3}}},
           {"op": "pointer/onSelect", "flows": {"out": {"node": 2}}},
           {"op": "event/receive", "configuration": {"event": "ping"}, "flows": {"out": {"node": 5}}},
           {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/scale"},
            "values": {"value": {"node": 6}}},
           {"op": "math/combine3", "values": {"a": {"node": 4, "socket": "count"},
            "b": {"value": 1}, "c": {"value": 1}}}
         ]}]}}}
      """#)
    s.sendEvent("hide")
    XCTAssertFalse(s.isVisible(0))

    s.dispatchSelect(nodeIndex: 0)
    let event = try XCTUnwrap(r.events.first)
    XCTAssertEqual(event.0, "ping")
    let payload = try XCTUnwrap(
      try JSONSerialization.jsonObject(with: Data(event.1.utf8)) as? [String: Any])
    XCTAssertEqual((payload["count"] as? NSNumber)?.doubleValue, 3)
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale.x, 3, "receive outputs carry the payload")

    s.sendEvent(index: 1, payload: ["count": 5])
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale.x, 5)
  }

  func testOnStartFiresOnceAndHoverTriggers() {
    let (s, _) = session(
      #"""
      {"nodes": [{"name": "A"}],
       "extensions": {"KHR_interactivity": {"nodes": [
         {"op": "event/onStart", "flows": {"out": {"node": 1}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/scale"},
          "values": {"value": {"value": [2, 2, 2]}}},
         {"op": "pointer/onHoverIn", "configuration": {"nodeIndex": 0}, "flows": {"out": {"node": 3}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/visible"},
          "values": {"value": {"value": false}}},
         {"op": "pointer/onHoverOut", "configuration": {"nodeIndex": 0}, "flows": {"out": {"node": 5}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/visible"},
          "values": {"value": {"value": true}}}
       ]}}}
      """#)
    s.start()
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale, SIMD3<Float>(2, 2, 2))
    s.setNodeTransform(0, XRNodeTransform())
    s.start()
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale, SIMD3<Float>(1, 1, 1), "onStart fires once")
    s.dispatchHover(nodeIndex: 0, hovered: true)
    XCTAssertFalse(s.isVisible(0))
    s.dispatchHover(nodeIndex: 0, hovered: false)
    XCTAssertTrue(s.isVisible(0))
  }

  func testDelayAndAnimationRequests() {
    let (s, r) = session(
      #"""
      {"nodes": [{"name": "A"}], "animations": [{"name": "Spin"}],
       "extensions": {"KHR_interactivity": {"nodes": [
         {"op": "pointer/onSelect", "flows": {"out": {"node": 1}}},
         {"op": "flow/sequence", "flows": {"0": {"node": 2}, "1": {"node": 4}}},
         {"op": "flow/delay", "values": {"duration": {"value": 1}}, "flows": {"done": {"node": 3}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/visible"},
          "values": {"value": {"value": false}}},
         {"op": "animation/start", "configuration": {"animation": 0}, "flows": {"out": {"node": 5}}},
         {"op": "animation/stop"}
       ]}}}
      """#)
    s.dispatchSelect(nodeIndex: 0)
    XCTAssertEqual(r.animationStarts.first?.0, 0)
    XCTAssertEqual(r.animationStarts.first?.1, "Spin")
    XCTAssertEqual(r.animationStops, 1)
    // dt is clamped to 0.25 s per step (web VM parity), so advance in 0.25 s increments.
    s.step(dt: 0.25)
    s.step(dt: 0.25)
    s.step(dt: 0.25)
    XCTAssertTrue(s.isVisible(0), "delay still pending")
    s.step(dt: 0.25)
    XCTAssertFalse(s.isVisible(0), "delay fired")
  }

  func testForbiddenAndOutOfRangePointersAreRejected() {
    let (s, _) = session(
      #"""
      {"nodes": [{"name": "A", "translation": [1, 2, 3]}],
       "materials": [{}],
       "extensions": {"KHR_interactivity": {"nodes": [
         {"op": "pointer/onSelect", "flows": {"out": {"node": 1}}},
         {"op": "flow/sequence", "flows": {"0": {"node": 2}, "1": {"node": 3}, "2": {"node": 4}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/__proto__"},
          "values": {"value": {"value": [9, 9, 9]}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/{idx}/translation"},
          "values": {"idx": {"value": 0}, "value": {"value": [4, 5, 6]}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/{idx}/scale"},
          "values": {"idx": {"value": -3}, "value": {"value": [7, 7, 7]}}}
       ]}}}
      """#)
    XCTAssertEqual(translation(s, 0), SIMD3<Float>(1, 2, 3), "initial glTF TRS is honored")
    s.dispatchSelect(nodeIndex: 0)
    XCTAssertEqual(translation(s, 0), SIMD3<Float>(4, 5, 6), "{param} pointer templates resolve")
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale, SIMD3<Float>(1, 1, 1))

    let v = XRInteractivityValue.vector([1, 1, 1])
    XCTAssertFalse(s.writePointer("/nodes/0/__proto__", v))
    XCTAssertFalse(s.writePointer("/nodes/0/constructor", v))
    XCTAssertFalse(s.writePointer("/materials/0/pbrMetallicRoughness/prototype", .number(1)))
    XCTAssertFalse(s.writePointer("/nodes/1/translation", v))
    XCTAssertFalse(s.writePointer("/nodes/-1/translation", v))
    XCTAssertFalse(s.writePointer("/nodes/0x/translation", v))
    XCTAssertFalse(s.writePointer("/nodes//translation", v))
    XCTAssertFalse(s.writePointer("nodes/0/translation", v))
    XCTAssertFalse(s.writePointer("/nodes/0/translation", .vector([1, 2])))
    XCTAssertFalse(s.writePointer("/nodes/0/weights", v), "weights are not whitelisted")
    XCTAssertNil(s.readPointer("/nodes/0/translation/extra"))
    XCTAssertEqual(XRLiveRuntimeSession.parseSafePointer("/a/~1b~0"), ["a", "/b~"])
    XCTAssertNil(XRLiveRuntimeSession.parseSafePointer("/a/__proto__"))
    XCTAssertTrue(s.writePointer("/materials/0/pbrMetallicRoughness/metallicFactor", .number(7)))
    XCTAssertEqual(s.material(at: 0)?.metallicFactor, 1, "factors clamp to 0...1")
    XCTAssertTrue(s.writePointer("/materials/0/emissiveFactor", .vector([-1, 2, 0.5])))
    XCTAssertEqual(s.material(at: 0)?.emissiveFactor, SIMD3<Float>(0, 2, 0.5))
  }

  func testStepBudgetBoundsRunawayGraphs() {
    let (s, _) = session(
      #"""
      {"nodes": [{"name": "A"}],
       "extensions": {"KHR_interactivity": {
         "variables": [{"id": "n", "value": 0}],
         "nodes": [
           {"op": "event/onStart", "flows": {"out": {"node": 1}}},
           {"op": "flow/sequence", "flows": {"0": {"node": 1}, "1": {"node": 2}}},
           {"op": "variable/set", "configuration": {"variable": 0},
            "values": {"value": {"node": 3}}, "flows": {"out": {"node": 5}}},
           {"op": "math/add", "values": {"a": {"node": 4}, "b": {"value": 1}}},
           {"op": "variable/get", "configuration": {"variable": "n"}},
           {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/translation"},
            "values": {"value": {"node": 6}}},
           {"op": "math/combine3", "values": {"a": {"node": 4}, "b": {"value": 0}, "c": {"value": 0}}}
         ]}}}
      """#)
    s.start()
    let count = translation(s, 0).x
    XCTAssertGreaterThan(count, 0)
    XCTAssertLessThan(count, Float(XRLiveRuntimeSession.maxStepsPerInvocation))
  }

  func testGraphLimitsAndMalformedGraphsNeverCrash() {
    let tooMany = Array(repeating: "{}", count: 1025).joined(separator: ",")
    let (big, _) = session(
      #"{"nodes": [], "extensions": {"KHR_interactivity": {"nodes": [\#(tooMany)]}}}"#)
    XCTAssertFalse(big.hasInteractivity)
    XCTAssertNotNil(big.interactivityError)

    let (s, _) = session(
      #"""
      {"nodes": [{"name": "a", "children": [0, 7, "x"]}, 3],
       "extensions": {"KHR_interactivity": {"graphs": [{
         "declarations": [{"op": "pointer/onSelect"}, 5],
         "variables": "nope", "events": [null],
         "nodes": [5, "x", {"declaration": 99},
           {"declaration": 0, "flows": {"out": {"node": 9}, "bad": 3}},
           {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/__proto__/x"},
            "values": {"value": {"node": -5}}, "flows": {"out": {"node": 999}}},
           {"op": "pointer/onSelect", "flows": {"out": {"node": 7}}},
           {"op": "math/add", "values": {"a": {"node": 6}, "b": {"node": 6}}},
           {"op": "pointer/set", "configuration": {"pointer": "/nodes/{i}/translation"},
            "values": {"i": {"node": 6}, "value": {"value": [1, 2]}},
            "flows": {"out": {"node": 4}}},
           {"op": "flow/switch", "values": {"selection": {"value": [1, 2]}}},
           {"op": "flow/for", "values": {"startIndex": {"value": 0}, "endIndex": {"value": 1e300}},
            "flows": {"body": {"node": 9}}}
         ]}], "graph": 0}}}
      """#)
    s.start()
    s.dispatchSelect(nodeIndex: 0)
    s.dispatchSelect(nodeIndex: 12_345)
    s.dispatchHover(nodeIndex: -1, hovered: true)
    s.sendEvent("x")
    s.step(dt: .nan)
    s.step(dt: -1)
    s.step(dt: 1e9)
    XCTAssertEqual(translation(s, 0), SIMD3<Float>(0, 0, 0))
    XCTAssertEqual(s.nodeCount, 2)
    XCTAssertNil(s.nodeTransform(at: 2))
    XCTAssertFalse(s.isVisible(99))
  }

  // MARK: - Lazy follow and orbit

  func testCriticallyDampedSpringConvergesWithoutOvershoot() {
    var s = XRSpringState(position: SIMD3<Float>(1, 0, 0))
    for _ in 0..<600 {
      XRSpatialMath.stepCriticallyDampedSpring(&s, target: .zero, omega: 6, dt: 1.0 / 60.0)
    }
    XCTAssertLessThan(abs(s.position.x), 1e-4)
    var s2 = XRSpringState(position: SIMD3<Float>(1, 0, 0))
    var overshoot = false
    for _ in 0..<600 {
      XRSpatialMath.stepCriticallyDampedSpring(&s2, target: .zero, omega: 10, dt: 0.1)
      if s2.position.x < -1e-6 { overshoot = true }
    }
    XCTAssertFalse(overshoot, "stable for large dt")
    let head = XRPose(position: SIMD3<Float>(0, 1.6, 0))
    XCTAssertEqual(
      XRSpatialMath.angleFromForwardDeg(anchor: head, point: SIMD3<Float>(0, 1.6, -1)), 0,
      accuracy: 1e-3)
    XCTAssertEqual(
      XRSpatialMath.angleFromForwardDeg(anchor: head, point: SIMD3<Float>(1, 1.6, 0)), 90,
      accuracy: 1e-3)
  }

  func testLazyFollowDeadzoneAndRecentering() {
    let (s, r) = session(
      #"""
      {"nodes": [
        {"name": "hud", "extras": {"xr": {"follow": {"distance": 1, "deadzoneDeg": 20, "height": 0}}}},
        {"name": "wide", "extras": {"xr": {"follow": {"distance": 1, "deadzoneDeg": 60, "height": 0}}}},
        {"name": "grabbed", "translation": [5, 5, 5], "extras": {"xr": {"follow": {}}}}
      ]}
      """#)
    s.setGrabbed(2, true)
    let origin = SIMD3<Float>(0, 1.6, 0)
    s.step(dt: 1.0 / 60.0, headPose: XRPose(position: origin))
    var p = translation(s, 0)
    XCTAssertEqual(p.z, -1, accuracy: 1e-3, "snapOnStart places HUD in front of head")
    XCTAssertEqual(p.y, 1.6, accuracy: 1e-3)
    XCTAssertEqual(r.transforms[0]?.translation.z ?? 0, -1, accuracy: 1e-3)

    s.step(dt: 1.0 / 60.0, headPose: .yawed(10 * Float.pi / 180, at: origin))
    p = translation(s, 0)
    XCTAssertEqual(p.z, -1, accuracy: 1e-3)
    XCTAssertFalse(s.isFollowing(0), "small head turn inside deadzone keeps HUD still")

    s.step(dt: 1.0 / 60.0, headPose: .yawed(45 * Float.pi / 180, at: origin))
    XCTAssertFalse(s.isFollowing(1), "60° deadzone honored for a 45° turn")

    for _ in 0..<240 {
      s.step(dt: 1.0 / 60.0, headPose: .yawed(Float.pi / 2, at: origin))
    }
    p = translation(s, 0)
    XCTAssertEqual(p.x, -1, accuracy: 0.02, "large head turn re-centers HUD")
    XCTAssertEqual(p.z, 0, accuracy: 0.02)
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale.x ?? 0, 1, accuracy: 1e-4, "scale preserved")
    XCTAssertEqual(translation(s, 2), SIMD3<Float>(5, 5, 5), "grabbed nodes are not moved")
  }

  func testOrbitPositions() throws {
    let rawOrbit: [String: Any] = ["radius": 2, "speed": Double.pi, "target": [1, 0, 0]]
    let opts = try XCTUnwrap(XRLiveTraitParser.parseOrbit(rawOrbit))
    let op = XRSpatialMath.computeOrbitPosition(center: SIMD3<Float>(1, 0, 0), options: opts, t: 0.5)
    XCTAssertEqual(op.x, 1, accuracy: 1e-3)
    XCTAssertEqual(op.z, 2, accuracy: 1e-3)

    let (s, _) = session(
      #"""
      {"nodes": [
        {"name": "planet", "translation": [3, 0, 0]},
        {"name": "moon", "extras": {"xr": {"orbit": {"target": "planet", "radius": 1, "speed": 0}}}},
        {"name": "self", "extras": {"xr": {"orbit": {"target": "self"}}}},
        {"name": "sat", "extras": {"xr": {"orbit": {"target": [0, 1, 0], "radius": 2, "speed": 0,
                                                     "phase": 1.5707963, "height": 0.5}}}}
      ]}
      """#)
    s.step(dt: 1.0 / 60.0, headPose: XRPose(position: SIMD3<Float>(0, 1.6, 0)))
    XCTAssertEqual(translation(s, 1).x, 4, accuracy: 1e-3, "orbit follows named target node")
    XCTAssertEqual(translation(s, 2).x, 0, accuracy: 1e-6, "self-referential target ignored")
    let sat = translation(s, 3)
    XCTAssertEqual(sat.x, 0, accuracy: 1e-3)
    XCTAssertEqual(sat.y, 1.5, accuracy: 1e-3)
    XCTAssertEqual(sat.z, 2, accuracy: 1e-3)
  }

  // MARK: - Manipulation handles

  func testHandlesCornerScaleClampAndPedestalYaw() throws {
    let world = XRSpatialMath.compose(
      translation: SIMD3<Float>(0, 0, -2), rotation: XRSpatialMath.identityQuat,
      scale: SIMD3<Float>(1, 1, 1))
    let layout = ManipulationHandles.computeLayout(
      localMin: SIMD3<Float>(-0.5, -0.5, -0.5), localMax: SIMD3<Float>(0.5, 0.5, 0.5), world: world)
    XCTAssertEqual(layout.corners.count, 4)
    XCTAssertEqual(layout.corners[2].y, 0.5, accuracy: 1e-5, "corners at bbox top")
    let rawHandles: [String: Any] = ["minScale": 0.5, "maxScale": 2]
    let opts = try XCTUnwrap(XRLiveTraitParser.parseHandles(rawHandles))

    let hit = try XCTUnwrap(
      ManipulationHandles.pick(
        layout: layout, rayOrigin: SIMD3<Float>(0.5, 0.5, 0), rayDirection: SIMD3<Float>(0, 0, -1),
        options: opts))
    guard case .corner(let index, _) = hit else { return XCTFail("expected a corner, got \(hit)") }
    XCTAssertEqual(index, 2)
    XCTAssertNil(
      ManipulationHandles.pick(
        layout: layout, rayOrigin: SIMD3<Float>(10, 10, 0), rayDirection: SIMD3<Float>(0, 0, -1),
        options: opts))

    let drag = try XCTUnwrap(
      ManipulationHandles.Drag(
        layout: layout, hit: hit, rayOrigin: SIMD3<Float>(0.5, 0.5, 0),
        rayDirection: SIMD3<Float>(0, 0, -1), startScale: SIMD3<Float>(1, 1, 1),
        startRotation: XRSpatialMath.identityQuat, options: opts))
    let scaled = try XCTUnwrap(
      drag.update(rayOrigin: SIMD3<Float>(5, 5, 0), rayDirection: SIMD3<Float>(0, 0, -1)))
    XCTAssertEqual(scaled.scale.x, 2, accuracy: 1e-4, "corner drag clamps to maxScale")

    let defaults = try XCTUnwrap(XRLiveTraitParser.parseHandles(true))
    let ped = layout.pedestalStart
    let origin = SIMD3<Float>(ped.x + 0.25, ped.y + 1, ped.z)
    let down = SIMD3<Float>(0, -1, 0)
    let rotHit = try XCTUnwrap(
      ManipulationHandles.pick(
        layout: layout, rayOrigin: origin, rayDirection: down, options: defaults))
    guard case .rotate = rotHit else { return XCTFail("expected the pedestal, got \(rotHit)") }
    let yawDrag = try XCTUnwrap(
      ManipulationHandles.Drag(
        layout: layout, hit: rotHit, rayOrigin: origin, rayDirection: down,
        startScale: SIMD3<Float>(1, 1, 1), startRotation: XRSpatialMath.identityQuat,
        options: defaults))
    let rotated = try XCTUnwrap(
      yawDrag.update(rayOrigin: SIMD3<Float>(0, ped.y + 1, -1.5), rayDirection: down))
    XCTAssertEqual(
      abs(XRSpatialMath.yawFromQuat(rotated.rotation)) * 180 / Float.pi, 90, accuracy: 1)
    XCTAssertEqual(rotated.scale, SIMD3<Float>(1, 1, 1), "rotation keeps scale")
  }

  // MARK: - World understanding

  func testDetectionUnprojection() throws {
    let proj = simd_float4x4(
      SIMD4<Float>(1, 0, 0, 0), SIMD4<Float>(0, 1, 0, 0), SIMD4<Float>(0, 0, -1, -1),
      SIMD4<Float>(0, 0, -0.2, 0))
    let cam = XRPose(position: SIMD3<Float>(0, 1.6, 0)).matrix

    let normalized = try XCTUnwrap(WorldUnderstanding.normalizeBox([100, 200, 300, 400]))
    XCTAssertEqual(normalized.y, 0.2, accuracy: 1e-6, "Gemini 0..1000 boxes normalized")
    XCTAssertEqual(
      WorldUnderstanding.normalizeBox([0.5, 0.1, 0.2, 0.3])?.x ?? 0, 0.2, accuracy: 1e-6)
    XCTAssertNil(WorldUnderstanding.normalizeBox([.nan, 0, 1, 1]))

    let center = try XCTUnwrap(
      WorldUnderstanding.unprojectDetection(
        box: [400, 400, 600, 600], label: "cup", cameraWorld: cam, projection: proj,
        depthMeters: 2))
    XCTAssertEqual(center.position.x, 0, accuracy: 1e-3)
    XCTAssertEqual(center.position.y, 1.6, accuracy: 1e-3)
    XCTAssertEqual(center.position.z, -2, accuracy: 1e-3, "center box at 2 m depth")
    XCTAssertEqual(center.depthSource, .depth)
    XCTAssertEqual(center.widthMeters, 0.8, accuracy: 1e-3)

    let floor = WorldUnderstanding.TrackedPlane(
      orientation: .horizontal, center: .zero, normal: SIMD3<Float>(0, 1, 0), radius: 10)
    let low = try XCTUnwrap(
      WorldUnderstanding.unprojectDetection(
        box: [900, 450, 1000, 550], cameraWorld: cam, projection: proj, planes: [floor]))
    XCTAssertEqual(low.depthSource, .plane)
    XCTAssertEqual(low.position.y, 0, accuracy: 0.01, "falls back to plane hit on floor")

    let none = try XCTUnwrap(
      WorldUnderstanding.unprojectDetection(box: [0, 0, 1, 1], cameraWorld: cam, projection: proj))
    XCTAssertEqual(none.depthSource, .fallback)
    XCTAssertEqual(none.position.z, -1.5, accuracy: 1e-3)
    XCTAssertNil(
      WorldUnderstanding.hitTestPlanes(
        [floor], origin: SIMD3<Float>(0, 1, 0), direction: SIMD3<Float>(0, 1, 0)))
  }

  // MARK: - Tube strokes

  func testTubeStrokeCountsWindingAndCaps() throws {
    let mid = TubeStrokeBuilder.catmullRom(
      SIMD3<Float>(0, 0, 0), SIMD3<Float>(1, 0, 0), SIMD3<Float>(2, 0, 0), SIMD3<Float>(3, 0, 0),
      t: 0.5)
    XCTAssertEqual(mid.x, 1.5, accuracy: 1e-5)

    var b = TubeStrokeBuilder(radius: 0.01, radialSegments: 6, samplesPerSpan: 2)
    XCTAssertNil(b.build())
    XCTAssertTrue(b.addPoint(SIMD3<Float>(0, 0, 0)))
    XCTAssertFalse(b.addPoint(SIMD3<Float>(0.0001, 0, 0)), "below min spacing")
    XCTAssertFalse(b.addPoint(SIMD3<Float>(.nan, 0, 0)), "non-finite")
    b.addPoint(SIMD3<Float>(0.1, 0, 0))
    b.addPoint(SIMD3<Float>(0.2, 0.1, 0))
    let g = try XCTUnwrap(b.build())
    let sm = b.smoothedPoints()
    let n = sm.count
    XCTAssertEqual(n, 5, "(points-1)*samples+1")
    XCTAssertEqual(g.positions.count, (n * 6 + 6 * 2 + 2) * 3, "duplicated cap rings")
    XCTAssertEqual(g.indices.count, ((n - 1) * 6 * 2 + 12) * 3)
    XCTAssertLessThan(Int(g.indices.max() ?? 0), g.vertexCount)
    XCTAssertEqual(
      (g.positions[1] * g.positions[1] + g.positions[2] * g.positions[2]).squareRoot(), 0.01,
      accuracy: 1e-4, "radius respected")

    func vertex(_ i: UInt32) -> SIMD3<Float> {
      let o = Int(i) * 3
      return SIMD3<Float>(g.positions[o], g.positions[o + 1], g.positions[o + 2])
    }
    func normal(_ i: UInt32) -> SIMD3<Float> {
      let o = Int(i) * 3
      return SIMD3<Float>(g.normals[o], g.normals[o + 1], g.normals[o + 2])
    }
    let t0 = vertex(g.indices[0])
    let cross = simd_cross(vertex(g.indices[1]) - t0, vertex(g.indices[2]) - t0)
    XCTAssertGreaterThan(simd_dot(cross, normal(g.indices[0])), 0, "side triangles wind outward")
    let capIdx = g.indices[g.indices.count - 3]
    let endDir = simd_normalize(sm[n - 1] - sm[n - 3])
    XCTAssertGreaterThan(simd_dot(normal(capIdx), endDir), 0.99, "end cap uses axial normal")

    var rev = TubeStrokeBuilder(radius: 0.01, samplesPerSpan: 1)
    for p in [
      SIMD3<Float>(0, 0, 0), SIMD3<Float>(0.1, 0, 0), SIMD3<Float>(0.2, 0, 0),
      SIMD3<Float>(0.1, 0.0001, 0), SIMD3<Float>(0, 0.0002, 0),
    ] {
      rev.addPoint(p)
    }
    let rg = try XCTUnwrap(rev.build())
    XCTAssertTrue(rg.normals.allSatisfy { $0.isFinite }, "RMF frames finite through reversal")
  }

  // MARK: - Particles

  func testParticleEmitterBoundsFloorCollisionAndRng() {
    var rng = Mulberry32(seed: 1)
    let r0 = rng.next()
    let r1 = rng.next()
    let r2 = rng.next()
    XCTAssertEqual(r0, 0.6270739405881613, accuracy: 1e-15, "bit-identical to web")
    XCTAssertEqual(r1, 0.002735721180215478, accuracy: 1e-15)
    XCTAssertEqual(r2, 0.5274470399599522, accuracy: 1e-15)

    let em = ParticleEmitter(
      options: XRLiveParticles(preset: .rain, count: 50, area: SIMD3<Float>(1, 1, 1), speed: 1),
      seed: 7)
    em.reset(center: SIMD3<Float>(0, 1, 0))
    var inside = true
    for i in 0..<50 {
      let x = em.positions[i * 3]
      let y = em.positions[i * 3 + 1]
      if abs(x) > 0.5 || y < 0.5 || y > 1.5 { inside = false }
    }
    XCTAssertTrue(inside, "particles spawn inside volume")
    for _ in 0..<120 { em.step(dt: 1.0 / 60.0, center: SIMD3<Float>(0, 1, 0), floorY: 0) }
    XCTAssertGreaterThan(em.collisions, 0, "rain collides with floor and respawns")
    var above = true
    for i in 0..<50 where em.positions[i * 3 + 1] < 0.4 { above = false }
    XCTAssertTrue(above, "particles never sink below volume bottom")

    let huge = ParticleEmitter(options: XRLiveParticles(preset: .sparks, count: 1_000_000))
    XCTAssertEqual(huge.count, 2000)

    let proj = simd_float4x4(
      SIMD4<Float>(1, 0, 0, 0), SIMD4<Float>(0, 1, 0, 0), SIMD4<Float>(0, 0, -1, -1),
      SIMD4<Float>(0, 0, 0, 0))
    let cam = ParticleEmitter.DepthCamera(
      view: matrix_identity_float4x4, projection: proj, sample: { _, _ in 2 })
    XCTAssertTrue(ParticleEmitter.isOccludedByDepth(SIMD3<Float>(0, 0, -3), camera: cam))
    XCTAssertFalse(ParticleEmitter.isOccludedByDepth(SIMD3<Float>(0, 0, -1), camera: cam))
    XCTAssertFalse(ParticleEmitter.isOccludedByDepth(SIMD3<Float>(0, 0, 1), camera: cam))

    let topo = ParticleEmitter.buildTopology(count: 3)
    XCTAssertEqual(topo.indices.count, 36)
    XCTAssertEqual(topo.indices.max(), 23)
    var verts: [Float] = []
    em.writeVertices(into: &verts)
    XCTAssertEqual(verts.count, 50 * ParticleEmitter.verticesPerParticle * 3)
  }

  // MARK: - Splats

  private static let spzV2: [UInt8] = [
    78, 71, 83, 80, 2, 0, 0, 0, 1, 0, 0, 0, 0, 12, 0, 0, 0, 16, 0, 0, 240, 255, 0, 0, 0, 255, 128,
    128, 128, 160, 160, 160, 128, 128, 128,
  ]

  /// `spzV2` gzip-compressed by Python's `gzip` module with `FNAME = "a.spz"`.
  private static let spzV2Gzip: [UInt8] = [
    0x1F, 0x8B, 0x08, 0x08, 0x00, 0x00, 0x00, 0x00, 0x02, 0xFF, 0x61, 0x2E, 0x73, 0x70, 0x7A,
    0x00, 0xF3, 0x73, 0x0F, 0x0E, 0x60, 0x62, 0x60, 0x60, 0x60, 0x04, 0x62, 0x06, 0x1E, 0x20,
    0x16, 0x60, 0x60, 0xF8, 0xF0, 0x1F, 0x48, 0xFF, 0x6F, 0x68, 0x68, 0x58, 0xB0, 0x60, 0x01,
    0x90, 0x04, 0x00, 0xDA, 0xE1, 0xBB, 0x39, 0x23, 0x00, 0x00, 0x00,
  ]

  func testSplatRecordsDecode() throws {
    var bytes = [UInt8](repeating: 0, count: 64)
    func putF(_ v: Float, _ o: Int) {
      let bits = v.bitPattern
      for k in 0..<4 { bytes[o + k] = UInt8(truncatingIfNeeded: bits >> (8 * k)) }
    }
    putF(1, 0)
    putF(0.1, 12)
    bytes.replaceSubrange(24..<28, with: [255, 0, 0, 200])
    bytes.replaceSubrange(28..<32, with: [255, 128, 128, 128])
    putF(-5, 40)
    putF(.nan, 44)
    bytes.replaceSubrange(60..<64, with: [128, 128, 128, 128])
    let d = try SplatParser.parseSplat(Data(bytes))
    XCTAssertEqual(d.count, 2)
    XCTAssertEqual(d.positions[0], 1)
    XCTAssertEqual(d.colors[0], 255)
    XCTAssertEqual(d.rotations[3], 1, accuracy: 1e-3, "quaternion decoded w-first")
    XCTAssertEqual(d.rotations[0], 0, accuracy: 1e-3)
    XCTAssertEqual(d.scales[3], 0, "non-finite scale sanitized")
    XCTAssertEqual(d.rotations[7], 1, "zero quaternion sanitized")
    XCTAssertThrowsError(try SplatParser.parseSplat(Data(count: 33))) { error in
      XCTAssertEqual(error as? SplatParserError, .invalidSplatSize)
    }
  }

  func testSpzV2V3AndMalformedPayloads() throws {
    let sd = try SplatParser.parseSpzPayload(Data(Self.spzV2))
    XCTAssertEqual(sd.positions[0], 1, accuracy: 1e-3, "24-bit fixed point")
    XCTAssertEqual(sd.positions[1], -1, accuracy: 1e-3)
    XCTAssertEqual(sd.colors[3], 255)
    XCTAssertEqual(sd.scales[0], 1, accuracy: 1e-5, "log scale")
    XCTAssertThrowsError(try SplatParser.parseSpzPayload(Data(Self.spzV2.prefix(20)))) {
      XCTAssertEqual($0 as? SplatParserError, .payloadTruncated)
    }
    var huge = Self.spzV2
    huge.replaceSubrange(8..<12, with: [0xFF, 0xFF, 0xFF, 0xFF])
    XCTAssertThrowsError(try SplatParser.parseSpzPayload(Data(huge))) {
      XCTAssertEqual($0 as? SplatParserError, .tooManySplats)
    }
    var badMagic = Self.spzV2
    badMagic[0] = 0
    XCTAssertThrowsError(try SplatParser.parseSpzPayload(Data(badMagic)))
    XCTAssertThrowsError(try SplatParser.parseSpzPayload(Data(Self.spzV2.prefix(10)))) {
      XCTAssertEqual($0 as? SplatParserError, .headerTruncated)
    }

    // v3 smallest-three rotation: largest = w (index 3), x = +0.5 -> mag 361.
    var v3 = [UInt8](repeating: 0, count: 16 + 9 + 1 + 3 + 3 + 4)
    v3.replaceSubrange(0..<4, with: [0x4E, 0x47, 0x53, 0x50])
    v3[4] = 3
    v3[8] = 1
    v3[13] = 12
    v3.replaceSubrange(26..<29, with: [128, 128, 128])
    let mag = UInt32((0.5 / 0.5.squareRoot() * 511).rounded())
    let comp = (UInt32(3) << 30) | (mag << 20)
    for k in 0..<4 { v3[32 + k] = UInt8(truncatingIfNeeded: comp >> (8 * k)) }
    let r3 = try SplatParser.parseSpzPayload(Data(v3))
    XCTAssertEqual(r3.rotations[0], 0.5, accuracy: 0.01, ".spz v3 smallest-three rotation")
    XCTAssertEqual(r3.rotations[3], Float(0.75).squareRoot(), accuracy: 0.01)
    XCTAssertLessThanOrEqual(abs(Int(r3.colors[0]) - 128), 2, "SH DC color decode")
    var badBits = v3
    badBits[13] = 31
    XCTAssertThrowsError(try SplatParser.parseSpzPayload(Data(badBits))) {
      XCTAssertEqual($0 as? SplatParserError, .invalidFractionalBits)
    }
    var v4 = v3
    v4[4] = 4
    XCTAssertThrowsError(try SplatParser.parseSpzPayload(Data(v4))) {
      XCTAssertEqual($0 as? SplatParserError, .unsupportedVersion(4))
    }
  }

  #if canImport(Compression)
    func testSpzGzipDecompression() throws {
      let gz = Data(Self.spzV2Gzip)
      XCTAssertTrue(SplatParser.isGzip(gz))
      let sd = try SplatParser.parseSpz(gz)
      XCTAssertEqual(sd.count, 1)
      XCTAssertEqual(sd.positions[0], 1, accuracy: 1e-3)
      XCTAssertEqual(try SplatParser.parse(gz, fileName: "room.bin").count, 1)
      XCTAssertThrowsError(try SplatParser.parseSpz(gz, maxDecompressedBytes: 10)) {
        XCTAssertEqual($0 as? SplatParserError, .decompressedTooLarge)
      }
      XCTAssertThrowsError(try SplatParser.parseSpz(gz.prefix(30)))
      XCTAssertThrowsError(try SplatParser.gunzip(Data([0x1F, 0x8B, 0x08])))
    }
  #endif

  // MARK: - VM hardening

  func testLazyStartAndAlphaCutoffWrites() {
    let (s, _) = session(
      #"""
      {"nodes": [{"name": "A"}], "materials": [{"alphaCutoff": 0.25}],
       "extensions": {"KHR_interactivity": {"nodes": [
         {"op": "event/onStart", "flows": {"out": {"node": 1}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/scale"},
          "values": {"value": {"value": [3, 3, 3]}}}
       ]}}}
      """#)
    s.step(dt: 0)
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale, SIMD3<Float>(3, 3, 3), "step() starts lazily")
    XCTAssertEqual(s.readPointer("/materials/0/alphaCutoff"), .number(0.25))
    XCTAssertTrue(s.writePointer("/materials/0/alphaCutoff", .number(2)))
    XCTAssertEqual(s.material(at: 0)?.alphaCutoff, 1, "alphaCutoff clamps to 0...1")
  }

  func testDiamondValueChainIsBoundedByEvaluationCap() {
    var nodes = [#"{"op": "math/add", "values": {"a": {"value": 1}, "b": {"value": 1}}}"#]
    for k in 1..<40 {
      nodes.append(
        #"{"op": "math/add", "values": {"a": {"node": \#(k - 1)}, "b": {"node": \#(k - 1)}}}"#)
    }
    nodes.append(#"{"op": "math/combine3", "values": {"a": {"node": 39}}}"#)
    nodes.append(
      #"{"op": "pointer/set", "configuration": {"pointer": "/nodes/0/translation"}, "values": {"value": {"node": 40}}}"#
    )
    nodes.append(#"{"op": "event/onStart", "flows": {"out": {"node": 41}}}"#)
    let json =
      #"{"nodes": [{"name": "A"}], "extensions": {"KHR_interactivity": {"nodes": [\#(nodes.joined(separator: ","))]}}}"#
    let (s, _) = session(json)
    s.start()  // Would take 2^40 evaluations without the cap.
    let t = translation(s, 0)
    XCTAssertTrue(t.x.isFinite && t.y.isFinite && t.z.isFinite)
  }

  func testRecursiveEventSendSharesTheCallerBudget() {
    let (s, r) = session(
      #"""
      {"nodes": [{"name": "A"}],
       "extensions": {"KHR_interactivity": {"graphs": [{
         "events": [{"id": "loop"}],
         "nodes": [
           {"op": "event/receive", "configuration": {"event": 0}, "flows": {"out": {"node": 1}}},
           {"op": "flow/sequence", "flows": {"0": {"node": 2}, "1": {"node": 2}}},
           {"op": "event/send", "configuration": {"event": 0}}
         ]}]}}}
      """#)
    s.sendEvent("loop")
    XCTAssertGreaterThan(r.events.count, 0)
    XCTAssertLessThanOrEqual(r.events.count, XRLiveRuntimeSession.maxStepsPerInvocation)
  }

  func testSelfReferentialTemplatedPointerGetTerminates() {
    let (s, _) = session(
      #"""
      {"nodes": [{"name": "A", "scale": [2, 2, 2]}],
       "extensions": {"KHR_interactivity": {"nodes": [
         {"op": "pointer/get", "configuration": {"pointer": "/nodes/{i}/scale"},
          "values": {"i": {"node": 0}}},
         {"op": "pointer/get", "configuration": {"pointer": "/nodes/{i}/scale"},
          "values": {"i": {"node": 2}}},
         {"op": "pointer/get", "configuration": {"pointer": "/nodes/{i}/translation"},
          "values": {"i": {"node": 1}}},
         {"op": "event/onStart", "flows": {"out": {"node": 4}}},
         {"op": "flow/sequence", "flows": {"0": {"node": 5}, "1": {"node": 6}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/scale"},
          "values": {"value": {"node": 0}}},
         {"op": "pointer/set", "configuration": {"pointer": "/nodes/0/translation"},
          "values": {"value": {"node": 1}}}
       ]}}}
      """#)
    s.start()  // Overflowed the stack before template inputs shared the visited set.
    XCTAssertEqual(s.nodeTransform(at: 0)?.scale, SIMD3<Float>(2, 2, 2))
    XCTAssertEqual(translation(s, 0), SIMD3<Float>(0, 0, 0))
  }

  func testOversizedJSONIsRejectedBeforeCopying() {
    let size = XRLiveGLB.maxJSONChunkBytes + 4
    var glb = Data(count: 20 + size)
    func put(_ v: UInt32, _ o: Int) {
      for k in 0..<4 { glb[o + k] = UInt8(truncatingIfNeeded: v >> (8 * k)) }
    }
    put(0x4654_6C67, 0)
    put(2, 4)
    put(UInt32(20 + size), 8)
    put(UInt32(size), 12)
    put(0x4E4F_534A, 16)
    XCTAssertNil(XRLiveGLB.jsonChunk(fromGLB: glb))
    XCTAssertNil(XRLiveRuntimeSession(glbData: glb))
    XCTAssertNil(XRLiveRuntimeSession(gltfJSONData: Data(count: size)))
  }

  func testSplatSortSurvivesHugeAndNonFinitePositions() {
    var data = SplatData(count: 4)
    data.positions = [0, 0, -1, 0, 0, -Float.greatestFiniteMagnitude, 0, 0, .nan, 0, 0, -3]
    var persp = matrix_identity_float4x4
    persp.columns.2.w = -1
    persp.columns.3.w = 0
    let order = SplatParser.sortByDepth(data, mvp: persp)
    XCTAssertEqual(order.count, 4)
    XCTAssertEqual(Set(order), [0, 1, 2, 3])
    XCTAssertEqual(order.first, 1, "the farthest finite splat is drawn first")
  }

  func testSplatDepthSort() {
    var data = SplatData(count: 3)
    data.positions = [0, 0, -1, 0, 0, -5, 0, 0, -3]
    var persp = matrix_identity_float4x4
    persp.columns.2.w = -1
    persp.columns.3.w = 0
    XCTAssertEqual(SplatParser.sortByDepth(data, mvp: persp), [1, 2, 0], "back-to-front")

    // URL policy (mirrors web resolveSplatUrl vectors).
    XCTAssertNotNil(SplatParser.resolveSplatURL("https://a.com/x.spz"))
    XCTAssertNil(SplatParser.resolveSplatURL("javascript:alert(1)"))
    XCTAssertNil(SplatParser.resolveSplatURL("data:application/octet-stream;base64,AA"))
    XCTAssertNil(SplatParser.resolveSplatURL("http://evil.com/x.splat"))
    XCTAssertEqual(
      SplatParser.resolveSplatURL("http://localhost:8080/x.spz")?.absoluteString,
      "http://localhost:8080/x.spz")
    XCTAssertEqual(
      SplatParser.resolveSplatURL("/scans/room.spz", baseURL: "https://site.test/app/")?
        .absoluteString,
      "https://site.test/scans/room.spz")
    XCTAssertNil(
      SplatParser.resolveSplatURL(
        "https://cdn.test/x.spz", baseURL: "https://site.test/", allowCrossOrigin: false))
    XCTAssertNotNil(
      SplatParser.resolveSplatURL(
        "https://site.test/x.spz", baseURL: "https://site.test/", allowCrossOrigin: false))
    XCTAssertNil(
      SplatParser.resolveSplatURL(
        "//evil.com/x.spz", baseURL: "https://site.test/", allowCrossOrigin: true))

    // Deterministic stride downsampling.
    var ten = SplatData(count: 10)
    for i in 0..<10 {
      ten.positions[i * 3] = Float(i)
      ten.scales[i * 3] = 0.1
      ten.colors[i * 4 + 3] = 255
    }
    let sampled = SplatParser.downsample(ten, maxSplats: 4)
    let sampledAgain = SplatParser.downsample(ten, maxSplats: 4)
    XCTAssertEqual(sampled.count, 4)
    XCTAssertEqual(sampled, sampledAgain)
    XCTAssertEqual(sampled.positions[0], 0)
    XCTAssertEqual(sampled.positions[3], 2)
    XCTAssertEqual(sampled.positions[6], 5)
    XCTAssertEqual(sampled.positions[9], 7)

    // Resort threshold and billboard quad builder.
    let id = matrix_identity_float4x4
    XCTAssertTrue(
      SplatParser.shouldResort(
        lastCameraWorld: nil, cameraWorld: id, lastNodeWorld: nil, nodeWorld: id))
    XCTAssertFalse(
      SplatParser.shouldResort(
        lastCameraWorld: id, cameraWorld: id, lastNodeWorld: id, nodeWorld: id))
    var moved = id
    moved.columns.3.x = 0.08
    XCTAssertTrue(
      SplatParser.shouldResort(
        lastCameraWorld: id, cameraWorld: moved, lastNodeWorld: id, nodeWorld: id))
    let quads = SplatParser.buildSplatQuads(sampled, order: [0, 1], nodeWorld: id, cameraWorld: id)
    XCTAssertEqual(quads.positions.count, 8)
    XCTAssertEqual(quads.uvs.count, 8)
    XCTAssertEqual(quads.colors.count, 32)
    XCTAssertEqual(quads.indices.count, 12)
    XCTAssertEqual(SplatParser.gaussianFalloffRGBA(size: 64).count, 64 * 64 * 4)

    // GPU billboard static vertices + sorted index buffer builder.
    let staticGpu = SplatParser.buildStaticGpuSplatVertices(sampled)
    XCTAssertEqual(staticGpu.positions.count, 16)
    XCTAssertEqual(staticGpu.uvs.count, 16)
    XCTAssertLessThan(staticGpu.uvs[0].x, 0)
    XCTAssertGreaterThan(staticGpu.uvs[2].x, 0)
    let sortedIdx = SplatParser.buildSortedSplatIndices(order: [1, 0], count: 2)
    XCTAssertEqual(sortedIdx, [4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3])
    XCTAssertTrue(SplatParser.metalShaderSource.contains("threeLiveSplatGeometry"))
    XCTAssertTrue(SplatParser.metalShaderSource.contains("threeLiveSplatSurface"))
    #if canImport(Metal)
      if let lib = SplatParser.makeMetalLibrary() {
        XCTAssertNotNil(lib.makeFunction(name: "threeLiveSplatGeometry"))
        XCTAssertNotNil(lib.makeFunction(name: "threeLiveSplatSurface"))
      }
    #endif
  }

  func testMatchesCrossPlatformGoldenSuite() throws {
    let spmGoldenDir = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("testdata/golden")
    var candidates: [URL] = [spmGoldenDir]
    if let srcDir = ProcessInfo.processInfo.environment["TEST_SRCDIR"] {
      let base = URL(fileURLWithPath: srcDir)
      candidates.append(
        base.appendingPathComponent(
          "google3/experimental/users/binghamj/three_live/testdata/golden")
      )
      candidates.append(
        base.appendingPathComponent("_main/experimental/users/binghamj/three_live/testdata/golden")
      )
      candidates.append(
        base.appendingPathComponent("experimental/users/binghamj/three_live/testdata/golden")
      )
    }
    if let resourceURL = Bundle(for: Self.self).resourceURL {
      candidates.append(resourceURL.appendingPathComponent("testdata/golden"))
      candidates.append(resourceURL)
    }
    let goldenDir =
      candidates.first {
        FileManager.default.fileExists(atPath: $0.appendingPathComponent("scene.glb.json").path)
      } ?? spmGoldenDir
    let sceneData = try Data(contentsOf: goldenDir.appendingPathComponent("scene.glb.json"))
    let scriptData = try Data(contentsOf: goldenDir.appendingPathComponent("script.json"))
    let expectedData = try Data(contentsOf: goldenDir.appendingPathComponent("expected.json"))

    let script = try XCTUnwrap(JSONSerialization.jsonObject(with: scriptData) as? [String: Any])
    let expected = try XCTUnwrap(JSONSerialization.jsonObject(with: expectedData) as? [String: Any])
    let steps = try XCTUnwrap(script["steps"] as? [[String: Any]])

    let s = try XCTUnwrap(XRLiveRuntimeSession(gltfJSONData: sceneData))
    let r = Recorder()
    s.delegate = r

    func floats(_ any: Any?) -> [Float] {
      (any as? [NSNumber])?.map { $0.floatValue } ?? []
    }
    func mat4(_ f: [Float]) -> simd_float4x4 {
      simd_float4x4(
        SIMD4<Float>(f[0], f[1], f[2], f[3]),
        SIMD4<Float>(f[4], f[5], f[6], f[7]),
        SIMD4<Float>(f[8], f[9], f[10], f[11]),
        SIMD4<Float>(f[12], f[13], f[14], f[15])
      )
    }
    func assertNear(
      _ actual: SIMD3<Float>,
      _ expected: SIMD3<Float>,
      accuracy: Float,
      _ message: String
    ) {
      XCTAssertEqual(actual.x, expected.x, accuracy: accuracy, "\(message) x")
      XCTAssertEqual(actual.y, expected.y, accuracy: accuracy, "\(message) y")
      XCTAssertEqual(actual.z, expected.z, accuracy: accuracy, "\(message) z")
    }

    var detectionsOut: [WorldUnderstanding.Detection3D] = []
    for step in steps {
      let action = step["action"] as? String ?? ""
      switch action {
      case "start":
        s.start()
      case "select":
        let idx = (step["nodeIndex"] as? NSNumber)?.intValue ?? 0
        s.dispatchSelect(nodeIndex: idx)
      case "step":
        let dt = (step["dt"] as? NSNumber)?.doubleValue ?? 0.1
        let count = (step["repeat"] as? NSNumber)?.intValue ?? 1
        let hp = floats(step["headPosition"])
        let hq = floats(step["headQuaternion"])
        let pose = XRPose(
          position: SIMD3<Float>(hp[0], hp[1], hp[2]),
          orientation: simd_quatf(ix: hq[0], iy: hq[1], iz: hq[2], r: hq[3])
        )
        for _ in 0..<count {
          s.step(dt: dt, headPose: pose)
        }
      case "dragCorner":
        let nodeIdx = (step["nodeIndex"] as? NSNumber)?.intValue ?? 0
        let lmin = floats(step["localMin"])
        let lmax = floats(step["localMax"])
        let cornerIdx = (step["cornerIndex"] as? NSNumber)?.intValue ?? 0
        let ro = floats(step["rayOrigin"])
        let rd = floats(step["rayDirection"])
        let world = s.worldMatrix(of: nodeIdx)
        let layout = ManipulationHandles.computeLayout(
          localMin: SIMD3<Float>(lmin[0], lmin[1], lmin[2]),
          localMax: SIMD3<Float>(lmax[0], lmax[1], lmax[2]),
          world: world
        )
        let tr = try XCTUnwrap(s.nodeTransform(at: nodeIdx))
        let hOpts = try XCTUnwrap(s.traits(at: nodeIdx)?.handles)
        let drag = try XCTUnwrap(
          ManipulationHandles.Drag(
            layout: layout,
            hit: .corner(index: cornerIdx, distance: 0),
            rayOrigin: SIMD3<Float>(ro[0], ro[1], ro[2]),
            rayDirection: SIMD3<Float>(rd[0], rd[1], rd[2]),
            startScale: tr.scale,
            startRotation: tr.rotation,
            options: hOpts
          )
        )
        let updated = try XCTUnwrap(
          drag.update(
            rayOrigin: SIMD3<Float>(ro[0], ro[1], ro[2]),
            rayDirection: SIMD3<Float>(rd[0], rd[1], rd[2])
          )
        )
        s.setNodeTransform(
          nodeIdx,
          XRNodeTransform(
            translation: tr.translation, rotation: updated.rotation, scale: updated.scale)
        )
      case "autoRotate":
        let deg = (step["angleDeg"] as? NSNumber)?.floatValue ?? 0
        let rad = deg * .pi / 180
        s.rootTransform = XRSpatialMath.compose(
          translation: .zero,
          rotation: XRSpatialMath.quatFromYaw(rad),
          scale: SIMD3<Float>(1, 1, 1)
        )
      case "detect":
        let detData = try JSONSerialization.data(withJSONObject: step["detections"] ?? [])
        let detJson = String(data: detData, encoding: .utf8) ?? "[]"
        let boxes = XRDetections.parse(json: detJson)
        let camWorld = mat4(floats(step["cameraWorld"]))
        let proj = mat4(floats(step["projection"]))
        let depth = (step["depthMeters"] as? NSNumber)?.floatValue ?? 2.0
        detectionsOut = XRDetections.detect(
          boxes,
          cameraWorld: camWorld,
          projection: proj,
          depthSampler: { _, _ in depth },
          planes: []
        )
      default:
        break
      }
    }

    let expectedNodes = try XCTUnwrap(expected["nodes"] as? [[String: Any]])
    XCTAssertEqual(s.nodeCount, expectedNodes.count)
    for (i, en) in expectedNodes.enumerated() {
      XCTAssertEqual(s.nodeName(at: i), en["name"] as? String)
      let tr = try XCTUnwrap(s.nodeTransform(at: i))
      let et = floats(en["translation"])
      let er = floats(en["rotation"])
      let es = floats(en["scale"])
      let ew = floats(en["worldPosition"])
      assertNear(
        tr.translation, SIMD3<Float>(et[0], et[1], et[2]), accuracy: 1e-4, "node[\(i)] translation")
      let q = tr.rotation.vector
      let qSame =
        abs(q.x - er[0]) <= 1e-4 && abs(q.y - er[1]) <= 1e-4 && abs(q.z - er[2]) <= 1e-4
        && abs(q.w - er[3]) <= 1e-4
      let qNeg =
        abs(q.x + er[0]) <= 1e-4 && abs(q.y + er[1]) <= 1e-4 && abs(q.z + er[2]) <= 1e-4
        && abs(q.w + er[3]) <= 1e-4
      XCTAssertTrue(qSame || qNeg, "node[\(i)] rotation \(q) vs \(er)")
      assertNear(tr.scale, SIMD3<Float>(es[0], es[1], es[2]), accuracy: 1e-4, "node[\(i)] scale")
      let wm = s.worldMatrix(of: i).columns.3
      assertNear(
        SIMD3<Float>(wm.x, wm.y, wm.z),
        SIMD3<Float>(ew[0], ew[1], ew[2]),
        accuracy: 1e-4,
        "node[\(i)] worldPosition"
      )
      XCTAssertEqual(s.isVisible(i), en["visible"] as? Bool)
    }

    let expectedMats = try XCTUnwrap(expected["materials"] as? [[String: Any]])
    let em0 = expectedMats[0]
    let ebc = floats(em0["baseColorFactor"])
    let mat0 = try XCTUnwrap(s.material(at: 0))
    XCTAssertEqual(mat0.baseColorFactor.x, ebc[0], accuracy: 1e-4)
    XCTAssertEqual(mat0.baseColorFactor.y, ebc[1], accuracy: 1e-4)
    XCTAssertEqual(mat0.baseColorFactor.z, ebc[2], accuracy: 1e-4)
    XCTAssertEqual(mat0.baseColorFactor.w, ebc[3], accuracy: 1e-4)
    XCTAssertEqual(
      mat0.metallicFactor, (em0["metallicFactor"] as? NSNumber)?.floatValue ?? 0, accuracy: 1e-4)
    XCTAssertEqual(
      mat0.roughnessFactor, (em0["roughnessFactor"] as? NSNumber)?.floatValue ?? 0, accuracy: 1e-4)

    let expectedEvents = try XCTUnwrap(expected["events"] as? [[String: Any]])
    XCTAssertEqual(r.events.count, expectedEvents.count)
    XCTAssertEqual(r.events.first?.0, expectedEvents[0]["id"] as? String)
    XCTAssertEqual(r.events.first?.1, #"{"count":1}"#)

    let expectedDets = try XCTUnwrap(expected["detections"] as? [[String: Any]])
    XCTAssertEqual(detectionsOut.count, expectedDets.count)
    let ed0 = expectedDets[0]
    let d0 = detectionsOut[0]
    XCTAssertEqual(d0.label, ed0["label"] as? String)
    let ep = floats(ed0["position"])
    let esz = floats(ed0["size"])
    XCTAssertEqual(d0.position.x, ep[0], accuracy: 1e-4)
    XCTAssertEqual(d0.position.y, ep[1], accuracy: 1e-4)
    XCTAssertEqual(d0.position.z, ep[2], accuracy: 1e-4)
    XCTAssertEqual(d0.widthMeters, esz[0], accuracy: 1e-4)
    XCTAssertEqual(d0.heightMeters, esz[1], accuracy: 1e-4)
    XCTAssertEqual(d0.depthSource.rawValue, ed0["depthSource"] as? String)
  }

  func testPhysicsDynamicAndBillboardStep() {
    let json = #"""
      {"nodes": [
        {"name": "Table", "mesh": 0, "translation": [0, 0.4, 0]},
        {"name": "Ball_1", "mesh": 1, "translation": [0, 1.2, 0], "extras": {"xr": {"physics": "dynamic", "grabbable": true}}},
        {"name": "Sign", "translation": [0, 1.5, -2], "extras": {"xr": {"billboard": "capsule"}}}
      ], "meshes": [
        {"primitives": [{"attributes": {"POSITION": 0}}]},
        {"primitives": [{"attributes": {"POSITION": 1}}]}
      ], "accessors": [
        {"min": [-1, -0.05, -1], "max": [1, 0.05, 1]},
        {"min": [-0.08, -0.08, -0.08], "max": [0.08, 0.08, 0.08]}
      ]}
      """#
    let (s, _) = session(json)
    let y0 = translation(s, 1).y
    let head = XRPose(position: SIMD3<Float>(2, 1.6, 0))
    for _ in 0..<30 {
      s.step(dt: 1.0 / 60.0, headPose: head)
    }
    let y1 = translation(s, 1).y
    XCTAssertLessThan(y1, y0)
    for _ in 0..<90 {
      s.step(dt: 1.0 / 60.0, headPose: head)
    }
    let yRest = translation(s, 1).y
    XCTAssertGreaterThanOrEqual(yRest, 0.50)
    s.dispatchSelect(nodeIndex: 1)
    for _ in 0..<10 {
      s.step(dt: 1.0 / 60.0, headPose: head)
    }
    let yJump = translation(s, 1).y
    XCTAssertGreaterThan(yJump, yRest)
    let qSign = s.nodeTransform(at: 2)?.rotation.vector.y ?? 0
    XCTAssertGreaterThan(qSign, 0.1)
  }

  func testBallpitNegativeFloorAndPedestalPhysics() {
    let json = #"""
      {"nodes": [
        {"name": "Room_Floor", "mesh": 0, "translation": [0, -0.85, 0], "extras": {"xr": {"physics": "static"}}},
        {"name": "Pedestal_Table", "mesh": 1, "translation": [0, -0.25, 0], "extras": {"xr": {"physics": "static"}}},
        {"name": "Ball_1", "mesh": 2, "translation": [0, 0.85, 0], "extras": {"xr": {"physics": "dynamic"}}},
        {"name": "Ball_2", "mesh": 2, "translation": [0.95, 0.85, 0], "extras": {"xr": {"physics": "dynamic"}}}
      ], "meshes": [
        {"primitives": [{"attributes": {"POSITION": 0}}]},
        {"primitives": [{"attributes": {"POSITION": 1}}]},
        {"primitives": [{"attributes": {"POSITION": 2}}]}
      ], "accessors": [
        {"min": [-1.7, -0.04, -1.7], "max": [1.7, 0.04, 1.7]},
        {"min": [-0.65, -0.04, -0.65], "max": [0.65, 0.04, 0.65]},
        {"min": [-0.11, -0.11, -0.11], "max": [0.11, 0.11, 0.11]}
      ]}
      """#
    let (s, _) = session(json)
    let head = XRPose(position: SIMD3<Float>(0, 1.6, 0))
    s.step(dt: 1.0 / 60.0, headPose: head)
    XCTAssertGreaterThan(translation(s, 2).y, 0.85)
    for _ in 0..<90 {
      s.step(dt: 1.0 / 60.0, headPose: head)
    }
    XCTAssertGreaterThanOrEqual(translation(s, 2).y, -0.71)
    XCTAssertGreaterThanOrEqual(translation(s, 3).y, -0.71)
    XCTAssertLessThan(translation(s, 3).y, 0.5)
  }

  func testArSurfaceGeometryAndSceneMatrixAndLocalBounds() {
    let grid = XRArSurfaceGeometry.buildFloorGridGeometry(y: -0.95)
    XCTAssertFalse(grid.positions.isEmpty)
    XCTAssertEqual(grid.positions.count, grid.normals.count)
    XCTAssertEqual(grid.indices.count % 3, 0)
    let vCount = UInt32(grid.positions.count / 3)
    for idx in grid.indices {
      XCTAssertLessThan(idx, vCount)
    }

    let reticle = XRArSurfaceGeometry.buildReticleGeometry(y: -0.95)
    XCTAssertFalse(reticle.positions.isEmpty)
    XCTAssertEqual(reticle.positions.count, reticle.normals.count)
    XCTAssertEqual(reticle.indices.count % 3, 0)
    let rCount = UInt32(reticle.positions.count / 3)
    for idx in reticle.indices {
      XCTAssertLessThan(idx, rCount)
    }

    let json = #"""
      {"nodes": [
        {"name": "ParentGroup", "translation": [1.0, 2.0, 3.0], "children": [1]},
        {"name": "ChildMesh", "mesh": 0, "translation": [0.5, 0.0, -1.0]}
      ], "meshes": [
        {"primitives": [{"attributes": {"POSITION": 0}}]}
      ], "accessors": [
        {"min": [-0.25, -0.5, -0.75], "max": [0.25, 0.5, 0.75]}
      ]}
      """#
    let (s, _) = session(json)
    XCTAssertFalse(s.hasMesh(at: 0))
    XCTAssertTrue(s.hasMesh(at: 1))
    let bounds = s.localBounds(forNode: 1)
    XCTAssertNotNil(bounds)
    XCTAssertEqual(bounds?.min.x ?? 0, -0.25, accuracy: 1e-5)
    XCTAssertEqual(bounds?.max.z ?? 0, 0.75, accuracy: 1e-5)

    let m = s.sceneMatrix(of: 1)
    XCTAssertEqual(m.columns.3.x, 1.5, accuracy: 1e-5)
    XCTAssertEqual(m.columns.3.y, 2.0, accuracy: 1e-5)
    XCTAssertEqual(m.columns.3.z, 2.0, accuracy: 1e-5)
  }

  func testSpatialMeasureAndMagneticSnapParity() throws {
    XCTAssertEqual(SpatialMeasure.formatDimension(0.64, unit: "auto"), "64.0 cm")
    XCTAssertEqual(SpatialMeasure.formatDimension(1.25, unit: "auto"), "1.25 m")
    XCTAssertEqual(SpatialMeasure.formatDimension(0.1234, unit: "mm"), "123 mm")
    XCTAssertEqual(SpatialMeasure.formatDimension(0.254, unit: "in"), "10.0 in")
    XCTAssertEqual(SpatialMeasure.formatDimension(0.0254 * 24, unit: "ft-in"), "2' 0.0\"")

    let callouts = SpatialMeasure.buildDimensionCallouts(
      min: SIMD3<Float>(0, 0, 0), max: SIMD3<Float>(1, 2, 0.5), axes: ["x", "z"])
    XCTAssertEqual(callouts.count, 2)
    XCTAssertEqual(callouts[0].lengthMeters, 1.0, accuracy: 1e-5)
    XCTAssertEqual(callouts[1].lengthMeters, 0.5, accuracy: 1e-5)
    let labelGeo = SpatialMeasure.buildVectorLabelGeometry("64.0 cm")
    XCTAssertFalse(labelGeo.positions.isEmpty)
    XCTAssertEqual(labelGeo.indices.count % 12, 0)

    let usd = try XCTUnwrap(
      XRLiveTraitParser.normalize(usdCustomData: [
        "dimensionsEnabled": true,
        "dimensionsUnit": "cm",
        "dimensionsAxes": "xz",
        "snapToGrid": [0.05, 0.05, 0.05],
        "snapToAngleDeg": 15,
        "snapSocketTag": "dock",
        "gazeDwellMs": 850,
        "gazeAction": "ask",
        "explodeDirection": [0.0, 3.0, 4.0],
        "explodeLayer": 2,
      ]))
    XCTAssertEqual(usd.dimensions?.axes, ["x", "z"])
    XCTAssertEqual(usd.snapTo?.angleDeg ?? 0, 15, accuracy: 1e-5)
    XCTAssertEqual(usd.snapSocket?.tag, "dock")
    XCTAssertEqual(usd.gaze?.dwellMs, 850)
    XCTAssertEqual(usd.gaze?.action, "ask")
    XCTAssertEqual(usd.explode?.layer, 2)
    XCTAssertEqual(usd.explode?.direction?.z ?? 0, 0.8, accuracy: 1e-5)

    let q38 = XRSpatialMath.quatFromYaw(38 * .pi / 180)
    let q45 = MagneticSnap.quantizeQuaternionAngle(q38, angleDeg: 45)
    let e = MagneticSnap.eulerYXZFromQuat(q45)
    XCTAssertEqual(e.y * 180 / .pi, 45, accuracy: 0.05)

    let socket = MagneticSnap.SocketCandidate(
      id: "dock#1", tag: "dock", position: SIMD3<Float>(1, 0.5, -1), radius: 0.2)
    let cfg = XRLiveSnapTo(socketTag: "dock", radius: 0.2)
    let snapped = MagneticSnap.evaluate(
      position: SIMD3<Float>(1.15, 0.5, -1), orientation: XRSpatialMath.identityQuat,
      config: cfg, sockets: [socket])
    XCTAssertEqual(snapped.mode, "socket")
    XCTAssertEqual(snapped.matchedSocketId, "dock#1")
    let held = MagneticSnap.evaluate(
      position: SIMD3<Float>(1.24, 0.5, -1), orientation: XRSpatialMath.identityQuat,
      config: cfg, sockets: [socket], currentSocketId: "dock#1")
    XCTAssertEqual(held.matchedSocketId, "dock#1")
    let broken = MagneticSnap.evaluate(
      position: SIMD3<Float>(1.28, 0.5, -1), orientation: XRSpatialMath.identityQuat,
      config: cfg, sockets: [socket], currentSocketId: "dock#1")
    XCTAssertNil(broken.matchedSocketId)

    let (s, _) = session(
      #"{"nodes": [{"name": "Parent", "translation": [1, 0, 0], "children": [1]}, {"name": "Child"}]}"#)
    XCTAssertTrue(
      s.setNodeWorldPose(1, position: SIMD3<Float>(2.5, 1, -1), rotation: XRSpatialMath.identityQuat))
    XCTAssertEqual(translation(s, 1).x, 1.5, accuracy: 1e-4)
  }

  func testGazeDwellAndExplodedViewMathParity() throws {
    XCTAssertEqual(GazeDwell.computeDwellProgress(elapsedMs: 140, dwellMs: 1000, graceMs: 150), 0, accuracy: 1e-5)
    XCTAssertEqual(GazeDwell.computeDwellProgress(elapsedMs: 575, dwellMs: 1000, graceMs: 150), 0.5, accuracy: 1e-5)
    XCTAssertEqual(GazeDwell.computeDwellProgress(elapsedMs: 1200, dwellMs: 1000, graceMs: 150), 1, accuracy: 1e-5)

    let ret0 = GazeDwell.buildReticleGeometry(progress: 0)
    let retHalf = GazeDwell.buildReticleGeometry(progress: 0.5)
    XCTAssertTrue(retHalf.indices.count > ret0.indices.count)
    XCTAssertEqual(retHalf.indices.count % 12, 0)

    XCTAssertGreaterThan(
      ExplodedView.computeLayerFactor(factor: 0.4, layer: 1, maxLayer: 3),
      ExplodedView.computeLayerFactor(factor: 0.4, layer: 3, maxLayer: 3)
    )
    let off = ExplodedView.computeNodeOffset(
      restPosition: SIMD3<Float>(-0.4, 0, 0),
      assemblyCenter: .zero,
      assemblyRadius: 0.4,
      factor: 1.0,
      mode: "radial",
      explodeScale: 1.5,
      trait: XRLiveExplode(distance: 0.5, layer: 1)
    )
    XCTAssertEqual(off.x, -0.75, accuracy: 1e-4)

    let sec = ExplodedView.parseSectionPlane("-z:0.2")
    XCTAssertTrue(sec.enabled)
    XCTAssertEqual(sec.normal.z, -1, accuracy: 1e-5)
    XCTAssertEqual(sec.constant, -0.2, accuracy: 1e-5)
  }

  func testPersistentAnchorsAndSpatialLocomotionParity() throws {
    let legacy = try XCTUnwrap(XRLiveTraitParser.normalize(["anchor": "floor"]))
    XCTAssertEqual(legacy.anchor, "floor")
    XCTAssertNil(legacy.anchorPersist)

    let persisted = try XCTUnwrap(
      XRLiveTraitParser.normalize([
        "anchor": ["target": "floor", "id": "desk-lamp", "persist": true],
        "navigable": true,
      ]))
    XCTAssertEqual(persisted.anchor, "floor")
    XCTAssertEqual(persisted.anchorPersist?.id, "desk-lamp")
    XCTAssertEqual(persisted.anchorPersist?.persist, true)
    XCTAssertEqual(persisted.navigable, "walkable")
    XCTAssertNil(XRLiveTraitParser.safeAnchorId("__proto__"))
    XCTAssertNil(
      PersistentAnchors.sanitizePose(
        p: SIMD3<Float>(.nan, 0, 0),
        q: XRSpatialMath.identityQuat,
        s: SIMD3<Float>(1, 1, 1)
      ))

    let pose = try XCTUnwrap(
      PersistentAnchors.sanitizePose(
        p: SIMD3<Float>(1.25, 0.8, -1.5),
        q: XRSpatialMath.quatFromYaw(.pi / 4),
        s: SIMD3<Float>(1.4, 1.4, 1.4)
      ))
    let token = PersistentAnchors.encodeState(["desk-lamp": pose], updatedAt: 1000)
    let injected = PersistentAnchors.injectHashToken(existingHash: "#tab=ar", token: token)
    XCTAssertEqual(PersistentAnchors.extractHashToken(injected), token)
    let decoded = try XCTUnwrap(PersistentAnchors.decodeState(token))
    XCTAssertEqual(decoded["desk-lamp"]?.p.x ?? 0, 1.25, accuracy: 1e-4)

    let arcPts = SpatialLocomotion.sampleParabola(
      origin: SIMD3<Float>(0, 1.6, 0), direction: SIMD3<Float>(0, 0, -1))
    XCTAssertEqual(arcPts.count, 21)
    XCTAssertLessThan(arcPts[20].y, arcPts[0].y)
    let arcGeo = SpatialLocomotion.buildArcGeometry(Array(arcPts.prefix(5)))
    XCTAssertEqual(arcGeo.indices.count, 4 * 12)

    let st1 = SpatialLocomotion.evaluateSnapTurn(axisX: 0.8, wasLatched: false, snapTurnDeg: 30)
    let st2 = SpatialLocomotion.evaluateSnapTurn(axisX: 0.5, wasLatched: st1.latched, snapTurnDeg: 30)
    let st3 = SpatialLocomotion.evaluateSnapTurn(axisX: 0.1, wasLatched: st2.latched, snapTurnDeg: 30)
    let st4 = SpatialLocomotion.evaluateSnapTurn(axisX: -0.8, wasLatched: st3.latched, snapTurnDeg: 30)
    XCTAssertEqual(st1.deltaYawDeg, -30)
    XCTAssertEqual(st2.deltaYawDeg, 0)
    XCTAssertFalse(st3.latched)
    XCTAssertEqual(st4.deltaYawDeg, 30)
  }

  func testSharedRoomProtocolAndSoftLockParity() throws {
    XCTAssertTrue(SharedRoom.isAllowedRoomUrl("wss://relay.example.com/room/1"))
    XCTAssertTrue(SharedRoom.isAllowedRoomUrl("ws://localhost:8787/room"))
    XCTAssertTrue(SharedRoom.isAllowedRoomUrl("ws://127.0.0.1:8787/room"))
    XCTAssertFalse(SharedRoom.isAllowedRoomUrl("ws://evil.example.com/room"))
    XCTAssertFalse(SharedRoom.isAllowedRoomUrl("https://relay.example.com/room"))

    let traits = try XCTUnwrap(XRLiveTraitParser.normalize(["grab": true, "sync": false]))
    XCTAssertEqual(traits.sync, false)
    let usdTraits = try XCTUnwrap(XRLiveTraitParser.normalize(usdCustomData: ["sync": true]))
    XCTAssertEqual(usdTraits.sync, true)

    let poseJson = SharedRoom.serializeMessage(
      .pose(
        peerId: "peer-alice",
        name: "Alice",
        color: "#38bdf8",
        headPos: SIMD3<Float>(0.2, 1.6, 0.5),
        headQuat: XRSpatialMath.identityQuat,
        rayOrigin: SIMD3<Float>(0.2, 1.4, 0.4),
        rayEnd: SIMD3<Float>(0, 0.5, -1),
        hasHit: true
      ))
    let decodedPose = try XCTUnwrap(SharedRoom.parseMessage(poseJson))
    if case .pose(let id, let name, let color, let hp, _, _, _, let hit) = decodedPose {
      XCTAssertEqual(id, "peer-alice")
      XCTAssertEqual(name, "Alice")
      XCTAssertEqual(color, "#38bdf8")
      XCTAssertEqual(hp.y, 1.6, accuracy: 1e-3)
      XCTAssertTrue(hit)
    } else {
      XCTFail("Expected .pose message")
    }

    XCTAssertNil(
      SharedRoom.parseMessage(#"{"v":1,"type":"leave","peerId":"__proto__"}"#))
    XCTAssertNil(
      SharedRoom.parseMessage(#"{"v":1,"type":"paint","peerId":"p1","strokeId":"s1","points":[[0,0,0]]}"#))

    let lease = SharedRoom.NodeSoftLock(ownerPeerId: "peer-alice", leaseUntilMs: 3000)
    XCTAssertTrue(
      SharedRoom.canAcquireNodeLease(existing: lease, candidatePeerId: "peer-alice", atMs: 2500))
    XCTAssertFalse(
      SharedRoom.canAcquireNodeLease(existing: lease, candidatePeerId: "peer-bob", atMs: 2500))
    XCTAssertTrue(
      SharedRoom.canAcquireNodeLease(existing: lease, candidatePeerId: "peer-bob", atMs: 3000))

    // Near-simultaneous grabs resolve to the lower peerId inside the window (matches web).
    let held = SharedRoom.NodeSoftLock(ownerPeerId: "peer-z", leaseUntilMs: 2100, acquiredMs: 100)
    XCTAssertTrue(
      SharedRoom.winsGrabConflict(existing: held, senderPeerId: "peer-a", grabState: "grab", atMs: 300))
    XCTAssertFalse(
      SharedRoom.winsGrabConflict(existing: held, senderPeerId: "peer-a", grabState: "move", atMs: 300))
    XCTAssertFalse(
      SharedRoom.winsGrabConflict(
        existing: SharedRoom.NodeSoftLock(ownerPeerId: "peer-a", leaseUntilMs: 2100, acquiredMs: 100),
        senderPeerId: "peer-z", grabState: "grab", atMs: 300))
    XCTAssertFalse(
      SharedRoom.winsGrabConflict(
        existing: SharedRoom.NodeSoftLock(ownerPeerId: "peer-z", leaseUntilMs: 2900, acquiredMs: 100),
        senderPeerId: "peer-a", grabState: "grab", atMs: 900))

    let visor = SharedRoom.buildPeerVisorGeometry()
    XCTAssertFalse(visor.positions.isEmpty)
    XCTAssertEqual(visor.indices.count % 3, 0)
    let laserHit = SharedRoom.buildPeerLaserGeometry(
      origin: SIMD3<Float>(0, 1.5, 0), end: SIMD3<Float>(0, 1.0, -1.5), hasHit: true)
    let laserMiss = SharedRoom.buildPeerLaserGeometry(
      origin: SIMD3<Float>(0, 1.5, 0), end: SIMD3<Float>(0, 1.0, -1.5), hasHit: false)
    XCTAssertGreaterThan(laserHit.indices.count, laserMiss.indices.count)
  }
}
