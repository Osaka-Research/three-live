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

// Mirrors `xr-live/tests/xr_sim_test.ts` and `XRSimWorldTest.kt`.

import XCTest
import simd

@testable import ThreeLiveCompiler

private final class SimRecorder: XRSimWorldDelegate {
  var events: [(String, [String: Any])] = []
  var clips: [String] = []
  var instances: [String: SIMD3<Double>] = [:]
  var removed: [String] = []
  var cues: [String] = []

  func simEvent(_ type: String, detail: [String: Any]) { events.append((type, detail)) }
  func simCharacterClip(_ name: String) { clips.append(name) }
  func simInstancePose(
    _ instanceId: String, templateNodeIndex: Int, position: SIMD3<Double>, rotation: simd_quatd,
    visible: Bool
  ) { instances[instanceId] = position }
  func simInstanceRemoved(_ instanceId: String) { removed.append(instanceId) }
  func simAudioCue(_ cue: String, pan: Double, gain: Double, pitch: Double) { cues.append(cue) }
  func count(_ type: String) -> Int { events.filter { $0.0 == type }.count }
}

final class XRSimWorldTests: XCTestCase {
  private struct Node {
    var name: String
    var t: [Double] = [0, 0, 0]
    var cube: Double?
    var xr: [String: Any]?
    var children: [Int]?
  }

  private func gltf(_ nodes: [Node]) -> [String: Any] {
    var meshes: [[String: Any]] = []
    var accessors: [[String: Any]] = []
    var out: [[String: Any]] = []
    for n in nodes {
      var d: [String: Any] = ["name": n.name, "translation": n.t]
      if let c = n.children { d["children"] = c }
      if let h = n.cube {
        d["mesh"] = meshes.count
        meshes.append(["primitives": [["attributes": ["POSITION": accessors.count]]]])
        accessors.append([
          "count": 24, "type": "VEC3", "componentType": 5126, "min": [-h, -h, -h],
          "max": [h, h, h],
        ])
      }
      if let xr = n.xr { d["extras"] = ["xr": xr] }
      out.append(d)
    }
    return ["asset": ["version": "2.0"], "nodes": out, "meshes": meshes, "accessors": accessors]
  }

  private func makeWorld(_ nodes: [Node], configure: (XRSimWorld) -> Void = { _ in }) -> (
    XRSimWorld, SimRecorder
  ) {
    let root = gltf(nodes)
    let w = XRSimWorld(session: XRLiveRuntimeSession(gltf: root), gltf: root)
    let r = SimRecorder()
    w.delegate = r
    configure(w)
    return (w, r)
  }

  private let head = XRPose(position: SIMD3<Float>(0, 1.6, 0))

  private func run(_ w: XRSimWorld, _ seconds: Double) {
    for _ in 0..<Int((seconds * 60).rounded()) { w.step(dt: 1.0 / 60, headPose: head) }
  }

  func testParsesAndClampsTraits() throws {
    let raw: [String: Any] = [
      "character": [
        "speed": 99, "radius": 2, "height": 1, "cameraMode": "orbit",
        "clips": ["idle": "Idle", "walk": ""],
      ],
      "agent": "patrol", "integrity": 250,
      "zone": ["size": 3, "shape": "sphere", "watchGroups": ["a", "a", "b c"]],
      "spawner": " Crate ", "objective": "checkpoint",
      "audioCues": ["onTap": "confirm", "onHit": "explosion"], "collidable": true,
    ]
    let t = try XCTUnwrap(XRSimTraits.parse(raw))
    XCTAssertEqual(t.character?.speed, 20)
    XCTAssertEqual(t.character?.height, 4)
    XCTAssertEqual(t.character?.cameraMode, "third-person")
    XCTAssertEqual(t.character?.clips, ["idle": "Idle"])
    XCTAssertEqual(t.agent?.mode, "patrol")
    XCTAssertEqual(t.integrity?.max, 250)
    XCTAssertEqual(t.zone?.radius, 3)
    XCTAssertEqual(t.zone?.watchGroups, ["a"])
    XCTAssertEqual(t.spawner?.template, "Crate")
    XCTAssertEqual(t.objective?.spinSpeed, 0)
    XCTAssertEqual(t.audioCues?.cues, ["onTap": "confirm"])
    XCTAssertTrue(t.collidable)
    XCTAssertEqual(XRSimTraits.parseAgent("chase")?.target, XRSimTraits.agentTargetUser)
    XCTAssertNil(XRSimTraits.parse(["audio": ["onTap": "confirm"]]))
    XCTAssertNil(XRSimTraits.safeSimId("__proto__"))
    XCTAssertNil(XRSimTraits.parseSpawner(true))
    XCTAssertNil(XRSimTraits.parseIntegrity(0))
    XCTAssertNil(XRSimTraits.parse(["collidable": 1]), "numbers are not booleans")
    XCTAssertEqual(XRSimWorld.hashString(""), 0x811c_9dc5)
    let rb = try XCTUnwrap(
      XRSimTraits.parsePhysicsBody([
        "body": "dynamic", "shape": "sphere", "mass": 9999, "restitution": 2, "friction": -1,
      ]))
    XCTAssertEqual(rb.body, "dynamic")
    XCTAssertEqual(rb.shape, "sphere")
    XCTAssertEqual(rb.mass, 1000)
    XCTAssertEqual(rb.restitution, 1)
    XCTAssertEqual(rb.friction, 0)
  }

  func testCharacterMovesCollidesJumpsAndHidesInFirstPerson() throws {
    let (w, r) = makeWorld([
      Node(
        name: "Hero",
        xr: [
          "character": [
            "speed": 4, "radius": 0.3,
            "clips": ["idle": "Idle", "walk": "Walk", "run": "Run", "jump": "Jump"],
          ]
        ], children: [1]),
      Node(name: "HeroMesh", t: [0, 0.25, 0], cube: 0.25),
      Node(name: "Wall", t: [0, 0.5, -3], cube: 0.5, xr: ["collidable": true]),
    ])
    let hero = try XCTUnwrap(w.body(named: "Hero"))
    w.moveZ = 1
    run(w, 2.5)
    XCTAssertGreaterThanOrEqual(hero.pos.z, -2.2 - 1e-3)
    XCTAssertLessThan(hero.pos.z, -2.0)
    XCTAssertEqual(abs(hero.yaw), .pi, accuracy: 1e-3)
    XCTAssertTrue(r.clips.contains("Walk"))
    XCTAssertEqual(Double(w.session.worldMatrix(of: 0).columns.3.z), hero.pos.z, accuracy: 1e-4)
    w.moveZ = 0
    run(w, 1)
    XCTAssertEqual(r.clips.last, "Idle")
    w.jump()
    run(w, 0.1)
    XCTAssertEqual(r.count("characterjump"), 1)
    run(w, 1.5)
    XCTAssertEqual(r.count("characterland"), 1)
    XCTAssertEqual(hero.pos.y, 0, accuracy: 1e-9)
    XCTAssertNotNil(CharacterController.cameraTarget(w))
    w.characterMode = "first-person"
    run(w, 0.05)
    XCTAssertFalse(w.session.isVisible(0))
    w.characterMode = "none"
    let z = hero.pos.z
    w.moveZ = -1
    run(w, 0.5)
    XCTAssertEqual(hero.pos.z, z)
  }

  func testAgentsChaseAndPatrol() throws {
    let (w, r) = makeWorld([
      Node(name: "Target", t: [0, 0.5, 0], cube: 0.25, xr: ["integrity": 100]),
      Node(
        name: "Drone", t: [5, 0.5, 0], cube: 0.2,
        xr: [
          "agent": [
            "mode": "chase", "target": "Target", "sightRadius": 0, "speed": 3,
            "stopDistance": 0.5,
          ]
        ]),
      Node(
        name: "Guard", t: [-4, 0.5, -4], cube: 0.2,
        xr: [
          "agent": [
            "mode": "patrol", "speed": 4, "turnSpeed": 50,
            "waypoints": [[-4, 0.5, 4], [4, 0.5, 4]], "loopWaypoints": false,
          ]
        ]),
    ])
    run(w, 7)
    let d = try XCTUnwrap(w.body(named: "Drone"))
    XCTAssertLessThanOrEqual((d.pos.x * d.pos.x + d.pos.z * d.pos.z).squareRoot(), 0.55)
    XCTAssertGreaterThanOrEqual(r.count("agentreach"), 1)
    let g = try XCTUnwrap(w.body(named: "Guard"))
    XCTAssertLessThanOrEqual(simd_distance(SIMD2(g.pos.x, g.pos.z), SIMD2(4, 4)), 0.5)
    var chase = XRAgentTrait()
    chase.mode = "chase"
    XCTAssertEqual(
      SteeringAgents.chooseState(chase, targetDistance: 8, patrolDone: false), "wander")
    chase.sightRadius = 0
    XCTAssertEqual(
      SteeringAgents.chooseState(chase, targetDistance: 99, patrolDone: false), "chase")
  }

  func testHitZonesFireSpawnAndZones() throws {
    let (w, r) = makeWorld([
      Node(
        name: "Target", t: [0, 1.6, -5], cube: 0.3,
        xr: ["integrity": ["max": 50, "group": "enemy", "scoreValue": 10, "cooldownMs": 0]]),
      Node(
        name: "Spawner", t: [3, 0, 0],
        xr: ["spawner": ["template": "Crate", "intervalSec": 0.5, "maxActive": 2, "totalCount": 3]]),
      Node(name: "Crate", t: [8, 0.25, 8], cube: 0.25, xr: ["integrity": 10]),
      Node(name: "Cell", t: [0, 1.6, -5], xr: ["zone": ["size": [1, 1, 1]]]),
    ]) {
      $0.hitMode = "projectile"
      $0.fireRate = 10
    }
    let target = try XCTUnwrap(w.body(named: "Target"))
    w.fire()
    run(w, 0.6)
    XCTAssertEqual(target.integrity, 25)
    XCTAssertEqual(r.count("xrzoneenter"), 1)
    w.fire()
    run(w, 0.6)
    XCTAssertTrue(target.hidden)
    XCTAssertEqual(r.count("xrdepleted"), 1)
    XCTAssertEqual(r.count("xrzoneexit"), 1)
    XCTAssertFalse(w.session.isVisible(0))
    run(w, 0.4)
    XCTAssertEqual(r.instances.count, 2)
    let inst = try XCTUnwrap(w.bodies.first { $0.isInstance })
    HitZones.applyHit(w, inst, 100, source: nil, point: nil)
    run(w, 1.1)
    XCTAssertEqual(r.removed, [inst.name])
    XCTAssertEqual(r.count("xrspawn"), 3)
    w.hitMode = "hitscan"
    w.reset()
    XCTAssertEqual(target.integrity, 50)
    XCTAssertTrue(w.session.isVisible(0))
    w.select(nodeIndex: 0, hitPoint: SIMD3(0, 1.6, -4.7))
    XCTAssertEqual(target.integrity, 25)
  }

  func testObjectivesAndAudio() throws {
    let (w, r) = makeWorld([
      Node(name: "Hero", xr: ["character": ["speed": 4]], children: [1]),
      Node(name: "HeroMesh", t: [0, 0.5, 0], cube: 0.25),
      Node(
        name: "Coin", t: [0, 0.5, -1.5], cube: 0.1,
        xr: [
          "objective": ["amount": 10],
          "audioCues": ["onObjective": "pickup"],
        ]),
    ]) {
      $0.objectivesEnabled = true
      $0.targetScore = 10
      $0.audioEnabled = true
    }
    w.moveZ = 1
    run(w, 1)
    XCTAssertEqual(Objectives.scenario(w)?.status, "pass")
    XCTAssertEqual(r.cues, ["pickup", "pass"])
    for cue in XRSimTraits.audioCueNames {
      let pcm = SynthAudio.renderPCM(cue, sampleRate: 22050)
      XCTAssertGreaterThan(pcm.count, 100, cue)
      XCTAssertTrue(pcm.contains { abs($0) > 0.03 }, cue)
    }
    XCTAssertEqual(SynthAudio.renderPCM("pickup"), SynthAudio.renderPCM("pickup"))
  }

  func testBodiesLiveInSceneSpaceUnderAMovedSceneRoot() throws {
    let root = gltf([
      Node(
        name: "Bot", cube: 0.2,
        xr: ["agent": ["mode": "patrol", "speed": 1, "waypoints": [[0, 0, 0], [2, 0, 0]]]])
    ])
    let session = XRLiveRuntimeSession(gltf: root)
    let w = XRSimWorld(session: session, gltf: root)
    // Uniform scale 2, then a 10 m shift along X (model scale or AR placement).
    var m = matrix_identity_float4x4
    m.columns.0.x = 2
    m.columns.1.y = 2
    m.columns.2.z = 2
    m.columns.3 = SIMD4(10, 0, 0, 1)
    session.rootTransform = m
    for _ in 0..<60 {
      w.step(dt: 1.0 / 60, headPose: XRPose(position: SIMD3<Float>(10, 3.2, 8)))
    }
    let bot = try XCTUnwrap(w.bodies.first { $0.name == "Bot" })
    XCTAssertGreaterThan(bot.pos.x, 0.5)
    XCTAssertEqual(
      Double(session.worldMatrix(of: 0).columns.3.x), 10 + 2 * bot.pos.x, accuracy: 1e-4)
    let head = w.headPosition()
    XCTAssertEqual(head.x, 0, accuracy: 1e-4)
    XCTAssertEqual(head.y, 1.6, accuracy: 1e-4)
    XCTAssertEqual(head.z, 4, accuracy: 1e-4)
    XCTAssertEqual(w.sceneToWorld(bot.pos).x, 10 + 2 * bot.pos.x, accuracy: 1e-4)
  }

  func testOrbitFollowOverridesTargetAndFramesInPolarDegrees() {
    var orbit = XROrbitCameraState()
    orbit.setBounds(center: .zero, radius: 10)
    orbit.follow(SIMD3(1, 2, 3))
    XCTAssertEqual(orbit.target, SIMD3(1, 2, 3))
    orbit.frameFollow(polarDeg: 90, distance: 0.05)
    orbit.snap()
    XCTAssertEqual(orbit.phi, 0, accuracy: 1e-9)
    XCTAssertEqual(orbit.distance, 0.05, accuracy: 1e-9)
    // Host camera options do not undo the follow framing.
    orbit.apply(XRCameraOptions(cameraOrbit: "0deg 75deg 4m"))
    orbit.snap()
    XCTAssertEqual(orbit.distance, 0.05, accuracy: 1e-9)
    orbit.follow(nil)
    XCTAssertEqual(orbit.target, SIMD3<Double>(0, 0, 0))
  }

  /// `true` for JSON null, `NSNull`, or a nil optional boxed in `Any`.
  private func isNull(_ v: Any?) -> Bool {
    guard let v = v else { return true }
    if v is NSNull { return true }
    let m = Mirror(reflecting: v)
    return m.displayStyle == .optional && m.children.isEmpty
  }

  /// Deep comparison with a numeric tolerance (goldens round to 1e-6).
  private func assertNear(_ path: String, _ expected: Any?, _ actual: Any?) {
    if isNull(expected) {
      XCTAssertTrue(isNull(actual), "\(path): expected null, got \(String(describing: actual))")
    } else if let e = expected as? String {
      XCTAssertEqual(actual as? String, e, path)
    } else if let e = expected as? NSNumber {
      guard
        let a = (actual as? NSNumber)?.doubleValue ?? (actual as? Double)
          ?? (actual as? Int).map(Double.init)
      else {
        return XCTFail("\(path): expected number, got \(String(describing: actual))")
      }
      XCTAssertEqual(a, e.doubleValue, accuracy: 1e-4, path)
    } else if let e = expected as? [Any] {
      guard let a = actual as? [Any] else {
        return XCTFail("\(path): expected list, got \(String(describing: actual))")
      }
      XCTAssertEqual(a.count, e.count, "\(path) count")
      for (i, x) in e.enumerated() where i < a.count { assertNear("\(path)[\(i)]", x, a[i]) }
    } else if let e = expected as? [String: Any] {
      guard let a = actual as? [String: Any] else {
        return XCTFail("\(path): expected object, got \(String(describing: actual))")
      }
      XCTAssertEqual(a.keys.sorted(), e.keys.sorted(), "\(path) keys")
      for (k, x) in e { assertNear("\(path).\(k)", x, a[k]) }
    } else {
      XCTFail("\(path): unsupported golden value \(String(describing: expected))")
    }
  }

  func testMatchesWebParityGoldens() throws {
    let spm = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("testdata/golden")
    var candidates = [spm]
    if let src = ProcessInfo.processInfo.environment["TEST_SRCDIR"] {
      let base = URL(fileURLWithPath: src)
      for p in [
        "google3/experimental/users/binghamj/three_live/testdata/golden",
        "_main/experimental/users/binghamj/three_live/testdata/golden",
        "experimental/users/binghamj/three_live/testdata/golden",
      ] {
        candidates.append(base.appendingPathComponent(p))
      }
    }
    if let res = Bundle(for: Self.self).resourceURL {
      candidates.append(res.appendingPathComponent("testdata/golden"))
      candidates.append(res)
    }
    let dir =
      candidates.first {
        FileManager.default.fileExists(atPath: $0.appendingPathComponent("sim_scene.json").path)
      } ?? spm
    for (sceneFile, expectedFile) in [
      ("sim_scene.json", "sim_expected.json"),
      ("sim_visuals_scene.json", "sim_visuals_expected.json"),
      ("sim_physics_scene.json", "sim_physics_expected.json"),
    ] {
      let scene = try XCTUnwrap(
        JSONSerialization.jsonObject(with: Data(contentsOf: dir.appendingPathComponent(sceneFile)))
          as? [String: Any])
      let expected = try XCTUnwrap(
        JSONSerialization.jsonObject(
          with: Data(contentsOf: dir.appendingPathComponent(expectedFile))) as? [String: Any])
      assertNear(sceneFile, expected, XRSimWorld.runParityScene(scene))
    }
  }

  func testMechanicalJointsArticulateClampAndReset() throws {
    XCTAssertNil(XRSimTraits.parseJoint(nil))
    XCTAssertNil(XRSimTraits.parseJoint(false))
    XCTAssertNil(XRSimTraits.parseJoint("none"))
    XCTAssertNil(XRSimTraits.parseJoint("unknown"))
    XCTAssertEqual(XRSimTraits.parseJoint(true)?.type, "hinge")
    XCTAssertEqual(XRSimTraits.parseJoint("revolute")?.type, "hinge")
    XCTAssertEqual(XRSimTraits.parseJoint("prismatic")?.type, "slider")
    XCTAssertEqual(XRSimTraits.parseJoint("distance")?.type, "spring")
    XCTAssertEqual(XRSimTraits.parseJoint("spherical")?.type, "ball")

    let parsed = try XCTUnwrap(
      XRSimTraits.parseJoint([
        "kind": "hinge",
        "connectedBody": "WORLD",
        "pivot": [0.5, 0.0, -0.25],
        "axis": "-x",
        "limits": [90.0, -45.0],
        "motorSpeed": 3.0,
      ]))
    XCTAssertEqual(parsed.target, "")
    XCTAssertEqual(parsed.axis, SIMD3(-1, 0, 0))
    XCTAssertEqual(parsed.limits, SIMD2(-45, 90))
    XCTAssertEqual(parsed.motorMaxForce, 50, accuracy: 1e-9)

    let (w, _) = makeWorld([
      Node(
        name: "DoorY", t: [0, 1, 0], cube: 0.2,
        xr: [
          "joint": [
            "type": "hinge", "anchor": [-0.5, 0.0, 0.0], "axis": "y",
            "limits": [-30.0, 45.0], "motorSpeed": 4.0, "motorMaxForce": 100.0,
          ]
        ]),
      Node(
        name: "FlapX", t: [2, 1, 0], cube: 0.2,
        xr: [
          "joint": [
            "type": "hinge", "anchor": [0.0, 0.3, 0.0], "axis": "x",
            "limits": [-60.0, 60.0], "motorSpeed": 3.0, "motorMaxForce": 80.0,
          ]
        ]),
      Node(
        name: "SliderDrawer", t: [-2, 1, 0], cube: 0.2,
        xr: [
          "joint": [
            "type": "slider", "axis": "x",
            "limits": [-0.2, 0.35], "motorSpeed": 2.0, "motorMaxForce": 80.0,
          ]
        ]),
      Node(
        name: "StiffSpring", t: [2, 2, -2], cube: 0.15,
        xr: [
          "rigidBody": ["body": "dynamic", "mass": 0.2],
          "joint": [
            "type": "spring", "anchor": [0.0, 0.5, 0.0],
            "restLength": 0.3, "stiffness": 10000.0, "damping": 100.0,
          ],
        ]),
      Node(
        name: "TwinA", t: [-2, 2, 2], cube: 0.15,
        xr: ["rigidBody": ["body": "dynamic", "mass": 1.0, "gravityScale": 0.0]]),
      Node(
        name: "TwinB", t: [-0.8, 2, 2], cube: 0.15,
        xr: [
          "rigidBody": ["body": "dynamic", "mass": 1.0, "gravityScale": 0.0],
          "joint": [
            "type": "spring", "target": "TwinA",
            "restLength": 0.4, "stiffness": 60.0, "damping": 8.0,
          ],
        ]),
      Node(
        name: "BallBob", t: [2.35, 1.5, 2], cube: 0.15,
        xr: [
          "constraint": [
            "type": "ball", "anchor": [-0.35, 0.5, 0.0],
            "limits": [-25.0, 25.0], "damping": 2.0,
          ]
        ]),
    ])
    run(w, 1.2)

    let doorY = try XCTUnwrap(w.body(named: "DoorY"))
    let flapX = try XCTUnwrap(w.body(named: "FlapX"))
    let slider = try XCTUnwrap(w.body(named: "SliderDrawer"))
    let stiff = try XCTUnwrap(w.body(named: "StiffSpring"))
    let twinA = try XCTUnwrap(w.body(named: "TwinA"))
    let twinB = try XCTUnwrap(w.body(named: "TwinB"))
    let ballBob = try XCTUnwrap(w.body(named: "BallBob"))

    XCTAssertEqual(doorY.yaw, 45.0 * .pi / 180.0, accuracy: 0.02)
    XCTAssertGreaterThan(abs(flapX.rot.imag.x), 0.25)
    XCTAssertEqual(slider.pos.x, -2.0 + 0.35, accuracy: 0.02)
    XCTAssertTrue(stiff.pos.x.isFinite && stiff.pos.y.isFinite && abs(stiff.pos.y - 2.2) < 0.1)
    XCTAssertGreaterThan(twinA.pos.x, -1.85)
    XCTAssertLessThan(twinB.pos.x, -0.95)
    XCTAssertEqual(twinA.pos.x + twinB.pos.x, -2.8, accuracy: 0.02)
    XCTAssertLessThan(ballBob.pos.x, 2.35)

    XCTAssertTrue(RigidBodyPhysics.applyImpulse(w, slider, SIMD3(-8, 0, 0)))
    run(w, 0.15)
    XCTAssertLessThan(slider.pos.x, -1.66)

    w.reset()
    XCTAssertEqual(doorY.yaw, 0, accuracy: 1e-9)
    XCTAssertEqual(flapX.rot, simd_quatd(ix: 0, iy: 0, iz: 0, r: 1))
    XCTAssertEqual(slider.pos, SIMD3(-2, 1, 0))
  }
}
