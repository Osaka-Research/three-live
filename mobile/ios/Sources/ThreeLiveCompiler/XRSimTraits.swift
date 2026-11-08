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

// `xr-live-sim` trait parsing (port of three-live/src/xr-sim-schema.ts and
// XRSimTraits.kt). Clamp ranges match the web and Android runtimes exactly.

import Foundation

/// Normalized `character` trait (`character-controller`).
public struct XRCharacterTrait: Equatable, Sendable {
  public var speed = 4.0
  public var runMultiplier = 1.6
  public var jumpVelocity = 5.5
  public var gravity = 15.0
  public var radius = 0.35
  public var height = 1.4
  public var cameraMode = "third-person"
  public var cameraDistance = 3.5
  public var cameraHeight = 1.8
  /// Clip names keyed by `idle`, `walk`, `run`, `jump`.
  public var clips: [String: String] = [:]
  public init() {}
}

/// Normalized `agent` trait (`steering-agents`).
public struct XRAgentTrait: Equatable, Sendable {
  public var mode = "wander"
  /// Node name, `XRSimTraits.agentTargetUser`, or `""`.
  public var target = ""
  public var speed = 2.0
  public var turnSpeed = 6.0
  public var sightRadius = 6.0
  public var stopDistance = 0.6
  public var separationRadius = 0.8
  public var waypoints: [SIMD3<Double>] = []
  public var loopWaypoints = true
  public init() {}
}

/// Normalized `integrity` trait (`hit-zones`).
public struct XRIntegrityTrait: Equatable, Sendable {
  public var max = 100.0
  public var current = 100.0
  public var group = "neutral"
  public var showBar = false
  public var cooldownMs = 250.0
  public var hideOnDepleted = true
  public var scoreValue = 0.0
  public var contactAmount = 0.0
  public init() {}
}

/// Normalized `zone` trait (`hit-zones`).
public struct XRZoneTrait: Equatable, Sendable {
  public var shape = "box"
  public var size = SIMD3<Double>(1, 1, 1)
  public var radius = 0.5
  public var watchGroups: [String] = []
  /// Outline color, or `nil` when the zone is hidden.
  public var color: String?
  public init() {}
}

/// Normalized `spawner` trait (`hit-zones`).
public struct XRSpawnerTrait: Equatable, Sendable {
  public var template: String
  public var intervalSec = 3.0
  public var maxActive = 8
  /// `0` is unlimited.
  public var totalCount = 0
  public var spawnRadius = 0.0
  public init(template: String) { self.template = template }
}

/// Normalized `objective` trait (`objectives`).
public struct XRObjectiveTrait: Equatable, Sendable {
  public var type = "pickup"
  public var amount = 10.0
  public var tag = ""
  public var radius = 0.65
  public var required = false
  public var order = 0
  public var spinSpeed = 2.5
  public var bobAmplitude = 0.08
  public var respawnSec = 0.0
  public init() {}
}

/// Normalized `audioCues` trait (`synth-audio`).
public struct XRAudioCuesTrait: Equatable, Sendable {
  /// Cue names keyed by event (`onTap`, `onHit`, ...).
  public var cues: [String: String]
  public var pitchJitter = 0.08
  public var volume = 1.0
  public var spatial = true
  public init(cues: [String: String]) { self.cues = cues }
}

/// Normalized `rigidBody` / object `physics` trait (`rigid-body`).
public struct XRPhysicsBodyTrait: Equatable, Sendable {
  public var body = "dynamic"
  public var shape = "auto"
  public var mass = 1.0
  public var restitution = 0.35
  public var friction = 0.5
  public var linearDamping = 0.05
  public var angularDamping = 0.1
  public var gravityScale = 1.0
  public var velocity = SIMD3<Double>(repeating: 0)
  public var angularVelocity = SIMD3<Double>(repeating: 0)
  public var lockRotation = false
  public init() {}
}

/// Normalized mechanical `joint` trait (`hinge`, `slider`, `spring`, `ball`).
public struct XRJointTrait: Equatable, Sendable {
  public var type = "hinge"
  public var target = ""
  public var anchor = SIMD3<Double>(repeating: 0)
  public var axis = SIMD3<Double>(0, 1, 0)
  public var limits: SIMD2<Double>?
  public var stiffness = 0.0
  public var damping = 0.5
  public var restLength = 0.0
  public var motorSpeed = 0.0
  public var motorMaxForce = 0.0
  public init() {}
}

/// The `xr-live-sim` traits of one node, parsed from glTF `extras.xr`.
public struct XRSimTraits: Equatable, Sendable {
  public var character: XRCharacterTrait?
  public var agent: XRAgentTrait?
  public var integrity: XRIntegrityTrait?
  public var zone: XRZoneTrait?
  public var spawner: XRSpawnerTrait?
  public var objective: XRObjectiveTrait?
  public var audioCues: XRAudioCuesTrait?
  public var rigidBody: XRPhysicsBodyTrait?
  public var joint: XRJointTrait?
  public var collidable = false

  public init() {}

  public var isEmpty: Bool {
    character == nil && agent == nil && integrity == nil && zone == nil && spawner == nil
      && objective == nil && audioCues == nil && rigidBody == nil && joint == nil && !collidable
  }

  public static let agentTargetUser = "user"
  public static let maxAgentWaypoints = 32
  public static let maxZoneWatchGroups = 16
  public static let maxSpawnerActive = 32
  public static let cameraModes = ["third-person", "first-person", "top-down", "fixed"]
  public static let clipStates = ["idle", "walk", "run", "jump"]
  public static let agentModes = ["patrol", "chase", "flee", "wander", "follow"]
  public static let objectiveTypes = ["pickup", "checkpoint", "time-bonus", "restore", "key"]
  public static let physicsBodyModes = ["dynamic", "static", "kinematic"]
  public static let physicsBodyShapes = ["auto", "box", "sphere", "cylinder"]
  public static let jointTypes = ["hinge", "slider", "spring", "ball"]
  public static let audioCueNames = [
    "confirm", "error", "alarm", "warning", "pickup", "jump", "beam", "impact", "burst",
    "powerup", "step", "pass", "fail",
  ]
  public static let audioCueEvents = [
    "onTap", "onObjective", "onHit", "onDepleted", "onZoneEnter", "onZoneExit", "onSpawn",
    "onJump", "onLand",
  ]

  private static func num(_ v: Any?, _ lo: Double, _ hi: Double, _ fallback: Double) -> Double {
    XRJSON.clampNum(v, lo, hi, fallback)
  }

  private static func oneOf(_ raw: Any?, _ allowed: [String], _ fallback: String) -> String {
    if let s = XRJSON.string(raw), allowed.contains(s) { return s }
    return fallback
  }

  /// `!raw` in JavaScript (absent, `false`, `0`, `NaN`, or `""`).
  private static func falsy(_ raw: Any?) -> Bool { !XRJSON.truthy(raw) }

  /// Sanitizes a group / tag id: 1-64 chars of `[A-Za-z0-9_.:-]`.
  public static func safeSimId(_ raw: Any?) -> String? {
    guard let s = XRJSON.string(raw)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !s.isEmpty, s.count <= 64, !["__proto__", "constructor", "prototype"].contains(s)
    else { return nil }
    for c in s.unicodeScalars {
      let v = c.value
      let ok =
        (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
        || c == "_" || c == "." || c == ":" || c == "-"
      if !ok { return nil }
    }
    return s
  }

  public static func parseCharacter(_ raw: Any?) -> XRCharacterTrait? {
    if falsy(raw) { return nil }
    let r =
      XRJSON.object(raw) ?? (XRJSON.string(raw).map { ["cameraMode": $0] as [String: Any] } ?? [:])
    if XRJSON.bool(r["enabled"]) == false { return nil }
    var t = XRCharacterTrait()
    let radius = num(r["radius"], 0.05, 5, 0.35)
    let clipsRaw = XRJSON.object(r["clips"]) ?? [:]
    for state in clipStates {
      if let name = XRJSON.shortString(clipsRaw[state], max: 128) { t.clips[state] = name }
    }
    t.speed = num(r["speed"], 0.1, 20, 4)
    t.runMultiplier = num(r["runMultiplier"], 1, 4, 1.6)
    t.jumpVelocity = num(r["jumpVelocity"], 0, 30, 5.5)
    t.gravity = num(r["gravity"], 0, 50, 15)
    t.radius = radius
    t.height = num(r["height"], radius * 2, 10, Swift.max(1.4, radius * 2))
    t.cameraMode = oneOf(r["cameraMode"], cameraModes, "third-person")
    t.cameraDistance = num(r["cameraDistance"], 0.5, 50, 3.5)
    t.cameraHeight = num(r["cameraHeight"], -10, 50, 1.8)
    return t
  }

  public static func parseAgent(_ raw: Any?) -> XRAgentTrait? {
    if falsy(raw) { return nil }
    let r = XRJSON.object(raw) ?? (XRJSON.string(raw).map { ["mode": $0] as [String: Any] } ?? [:])
    if XRJSON.bool(r["enabled"]) == false { return nil }
    var t = XRAgentTrait()
    t.mode = oneOf(r["mode"], agentModes, "wander")
    let target = XRJSON.string(r["target"])
    if target == "camera" || target == agentTargetUser {
      t.target = agentTargetUser
    } else {
      t.target = XRJSON.shortString(r["target"], max: 256) ?? ""
    }
    if t.target.isEmpty && ["chase", "flee", "follow"].contains(t.mode) {
      t.target = agentTargetUser
    }
    let coord = { (v: Double) in num(v, -1e4, 1e4, 0) }
    t.waypoints = (XRJSON.array(r["waypoints"]) ?? []).compactMap { XRJSON.finiteVec3($0) }
      .prefix(maxAgentWaypoints).map { SIMD3(coord($0.x), coord($0.y), coord($0.z)) }
    t.speed = num(r["speed"], 0.1, 20, 2)
    t.turnSpeed = num(r["turnSpeed"], 0.1, 50, 6)
    t.sightRadius = num(r["sightRadius"], 0, 100, 6)
    t.stopDistance = num(r["stopDistance"], 0.01, 10, 0.6)
    t.separationRadius = num(r["separationRadius"], 0, 10, 0.8)
    t.loopWaypoints = XRJSON.bool(r["loopWaypoints"]) != false
    return t
  }

  public static func parseIntegrity(_ raw: Any?) -> XRIntegrityTrait? {
    if falsy(raw) { return nil }
    let r = XRJSON.object(raw) ?? (XRJSON.number(raw).map { ["max": $0] as [String: Any] } ?? [:])
    if XRJSON.bool(r["enabled"]) == false { return nil }
    var t = XRIntegrityTrait()
    t.max = num(r["max"], 1, 1e6, 100)
    t.current = num(r["current"], 0, t.max, t.max)
    t.group = safeSimId(r["group"]) ?? "neutral"
    t.showBar = XRJSON.bool(r["showBar"]) == true
    t.cooldownMs = num(r["cooldownMs"], 0, 10000, 250).rounded()
    t.hideOnDepleted = XRJSON.bool(r["hideOnDepleted"]) != false
    t.scoreValue = num(r["scoreValue"], -1e6, 1e6, 0)
    t.contactAmount = num(r["contactAmount"], 0, 1e6, 0)
    return t
  }

  public static func parseZone(_ raw: Any?) -> XRZoneTrait? {
    if falsy(raw) { return nil }
    let r = XRJSON.object(raw) ?? (XRJSON.string(raw).map { ["shape": $0] as [String: Any] } ?? [:])
    if XRJSON.bool(r["enabled"]) == false { return nil }
    var t = XRZoneTrait()
    t.shape = oneOf(r["shape"], ["box", "sphere"], "box")
    let side = { (v: Any?) in num(v, 0.01, 1000, 1) }
    let s = r["size"]
    if let v = XRJSON.finiteVec3(s) {
      t.size = SIMD3(side(v.x), side(v.y), side(v.z))
    } else if let n = XRJSON.number(s) {
      t.size = SIMD3(repeating: side(n))
    }
    t.radius = num(r["radius"] ?? XRJSON.number(s), 0.01, 1000, 0.5)
    let wg = r["watchGroups"]
    let list: [Any] = XRJSON.array(wg) ?? (wg.map { [$0] } ?? [])
    var groups: [String] = []
    for g in list {
      if let id = safeSimId(g), !groups.contains(id) { groups.append(id) }
    }
    t.watchGroups = Array(groups.prefix(maxZoneWatchGroups))
    let color = XRJSON.safeHexColor(r["color"], fallback: "")
    t.color = color.isEmpty ? nil : color
    return t
  }

  public static func parseSpawner(_ raw: Any?) -> XRSpawnerTrait? {
    let r = XRJSON.object(raw) ?? XRJSON.string(raw).map { ["template": $0] as [String: Any] }
    guard let r = r,
      let template = XRJSON.shortString(r["template"])?.trimmingCharacters(in: .whitespaces),
      !template.isEmpty, XRJSON.bool(r["enabled"]) != false
    else { return nil }
    var t = XRSpawnerTrait(template: template)
    t.intervalSec = num(r["intervalSec"], 0.05, 3600, 3)
    t.maxActive = Int(num(r["maxActive"], 1, Double(maxSpawnerActive), 8).rounded())
    t.totalCount = Int(num(r["totalCount"], 0, 10000, 0).rounded())
    t.spawnRadius = num(r["spawnRadius"], 0, 100, 0)
    return t
  }

  public static func parseObjective(_ raw: Any?) -> XRObjectiveTrait? {
    if falsy(raw) { return nil }
    let r = XRJSON.object(raw) ?? (XRJSON.string(raw).map { ["type": $0] as [String: Any] } ?? [:])
    if XRJSON.bool(r["enabled"]) == false { return nil }
    var t = XRObjectiveTrait()
    t.type = oneOf(r["type"], objectiveTypes, "pickup")
    let animated = t.type == "pickup"
    t.amount = num(r["amount"] ?? r["points"], -1e6, 1e6, 10)
    t.tag = safeSimId(r["tag"]) ?? ""
    t.radius = num(r["radius"], 0.05, 50, 0.65)
    t.required = XRJSON.bool(r["required"]) == true
    t.order = Int(num(r["order"], 0, 1000, 0).rounded())
    t.spinSpeed = num(r["spinSpeed"], -50, 50, animated ? 2.5 : 0)
    t.bobAmplitude = num(r["bobAmplitude"], 0, 5, animated ? 0.08 : 0)
    t.respawnSec = num(r["respawnSec"], 0, 3600, 0)
    return t
  }

  public static func parseAudioCues(_ raw: Any?) -> XRAudioCuesTrait? {
    guard let r = XRJSON.object(raw) else { return nil }
    var cues: [String: String] = [:]
    for ev in audioCueEvents {
      if let cue = XRJSON.string(r[ev]), audioCueNames.contains(cue) { cues[ev] = cue }
    }
    if cues.isEmpty { return nil }
    var t = XRAudioCuesTrait(cues: cues)
    t.pitchJitter = num(r["pitchJitter"], 0, 0.5, 0.08)
    t.volume = num(r["volume"], 0, 1, 1)
    t.spatial = XRJSON.bool(r["spatial"]) != false
    return t
  }

  public static func parsePhysicsBody(_ raw: Any?) -> XRPhysicsBodyTrait? {
    if falsy(raw) { return nil }
    if let s = XRJSON.string(raw) {
      guard physicsBodyModes.contains(s) else { return nil }
      var t = XRPhysicsBodyTrait()
      t.body = s
      t.mass = s == "dynamic" ? 1 : 0
      return t
    }
    let r: [String: Any]
    if XRJSON.bool(raw) == true {
      r = [:]
    } else if let obj = XRJSON.object(raw) {
      r = obj
    } else {
      return nil
    }
    if XRJSON.bool(r["enabled"]) == false { return nil }
    var t = XRPhysicsBodyTrait()
    t.body = oneOf(r["body"] ?? r["type"] ?? r["mode"], physicsBodyModes, "dynamic")
    t.shape = oneOf(r["shape"] ?? r["collider"], physicsBodyShapes, "auto")
    t.mass = t.body == "dynamic" ? num(r["mass"], 0.01, 1000, 1) : 0
    t.restitution = num(r["restitution"] ?? r["bounciness"], 0, 1, 0.35)
    t.friction = num(r["friction"], 0, 1, 0.5)
    t.linearDamping = num(r["linearDamping"] ?? r["damping"], 0, 20, 0.05)
    t.angularDamping = num(r["angularDamping"], 0, 20, 0.1)
    t.gravityScale = num(r["gravityScale"], -5, 5, 1)
    if let v = XRJSON.finiteVec3(r["velocity"]) {
      t.velocity = SIMD3(
        num(v.x, -200, 200, 0), num(v.y, -200, 200, 0), num(v.z, -200, 200, 0))
    }
    if let av = XRJSON.finiteVec3(r["angularVelocity"]) {
      t.angularVelocity = SIMD3(
        num(av.x, -100, 100, 0), num(av.y, -100, 100, 0), num(av.z, -100, 100, 0))
    }
    t.lockRotation = XRJSON.bool(r["lockRotation"]) == true
    return t
  }

  public static func parseRigidBody(_ raw: Any?) -> XRPhysicsBodyTrait? {
    parsePhysicsBody(raw)
  }

  private static let jointTypeAliases: [String: String] = [
    "hinge": "hinge", "revolute": "hinge",
    "slider": "slider", "prismatic": "slider",
    "spring": "spring", "distance": "spring",
    "ball": "ball", "spherical": "ball",
  ]

  private static func parseJointAxis(_ raw: Any?, _ fallback: SIMD3<Double>) -> SIMD3<Double> {
    if let s = XRJSON.string(raw)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
      switch s {
      case "x", "+x": return SIMD3(1, 0, 0)
      case "-x": return SIMD3(-1, 0, 0)
      case "y", "+y": return SIMD3(0, 1, 0)
      case "-y": return SIMD3(0, -1, 0)
      case "z", "+z": return SIMD3(0, 0, 1)
      case "-z": return SIMD3(0, 0, -1)
      default: return fallback
      }
    }
    guard let v = XRJSON.finiteVec3(raw) else { return fallback }
    let len = (v.x * v.x + v.y * v.y + v.z * v.z).squareRoot()
    return len > 1e-6 ? SIMD3(v.x / len, v.y / len, v.z / len) : fallback
  }

  public static func parseJoint(_ raw: Any?) -> XRJointTrait? {
    if falsy(raw) { return nil }
    if let s = XRJSON.string(raw), s == "none" { return nil }
    let r: [String: Any]
    if XRJSON.bool(raw) == true {
      r = [:]
    } else if let s = XRJSON.string(raw) {
      r = ["type": s]
    } else if let obj = XRJSON.object(raw) {
      r = obj
    } else {
      return nil
    }
    if XRJSON.bool(r["enabled"]) == false { return nil }
    let rt = r["type"] ?? r["kind"] ?? r["mode"]
    let type: String
    if let s = XRJSON.string(rt) {
      guard let mapped = jointTypeAliases[s.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()]
      else { return nil }
      type = mapped
    } else {
      type = "hinge"
    }
    var t = XRJointTrait()
    t.type = type
    let rawTgt = r["target"] ?? r["connectedBody"] ?? r["parent"]
    if let ts = XRJSON.string(rawTgt), ts.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "world" {
      t.target = ""
    } else {
      t.target = XRLiveTraitParser.safeAnchorId(rawTgt) ?? ""
    }
    if let a = XRJSON.finiteVec3(r["anchor"] ?? r["pivot"]) {
      t.anchor = SIMD3(num(a.x, -100, 100, 0), num(a.y, -100, 100, 0), num(a.z, -100, 100, 0))
    }
    let axisFallback: SIMD3<Double> =
      type == "slider" ? SIMD3(0, 0, 1) : (type == "spring" ? SIMD3(0, -1, 0) : SIMD3(0, 1, 0))
    t.axis = parseJointAxis(r["axis"], axisFallback)
    let isAng = type == "hinge" || type == "ball"
    let limLo: Double = isAng ? -360 : (type == "spring" ? 0 : -100)
    let limHi: Double = isAng ? 360 : 100
    let rl = XRJSON.array(r["limits"])
    let loR: Any? =
      (rl != nil && rl!.count >= 2)
      ? rl![0] : (r["min"] ?? (isAng ? r["minAngle"] : r["minDistance"]))
    let hiR: Any? =
      (rl != nil && rl!.count >= 2)
      ? rl![1] : (r["max"] ?? (isAng ? r["maxAngle"] : r["maxDistance"]))
    let hasLim: Bool
    if let arr = rl {
      hasLim =
        arr.count >= 2 && (XRJSON.number(arr[0])?.isFinite == true)
        && (XRJSON.number(arr[1])?.isFinite == true)
    } else {
      hasLim = (XRJSON.number(loR)?.isFinite == true) || (XRJSON.number(hiR)?.isFinite == true)
    }
    if hasLim {
      let a = num(loR, limLo, limHi, limLo)
      let b = num(hiR, limLo, limHi, limHi)
      t.limits = SIMD2(Swift.min(a, b), Swift.max(a, b))
    }
    t.stiffness = num(r["stiffness"], 0, 10000, type == "spring" ? 40 : 0)
    t.damping = num(r["damping"], 0, 1000, type == "spring" ? 4 : 0.5)
    t.restLength = num(r["restLength"], 0, 100, 0)
    let ms = num(r["motorSpeed"], -100, 100, 0)
    t.motorSpeed = ms
    t.motorMaxForce = num(
      r["motorMaxForce"] ?? r["maxMotorForce"], 0, 10000, ms != 0 ? 50 : 0)
    return t
  }

  /// Parses the sim traits of a `userData.xr` / `extras.xr` bag, or `nil` when none.
  public static func parse(_ raw: Any?) -> XRSimTraits? {
    guard let r = XRJSON.object(raw) else { return nil }
    let rawPhys = r["physics"]
    let rbSource: Any? =
      r["rigidBody"]
      ?? ((XRJSON.string(rawPhys) == "kinematic" || XRJSON.bool(rawPhys) == true
        || XRJSON.object(rawPhys) != nil) ? rawPhys : nil)
    var t = XRSimTraits()
    t.character = parseCharacter(r["character"])
    t.agent = parseAgent(r["agent"])
    t.integrity = parseIntegrity(r["integrity"])
    t.zone = parseZone(r["zone"])
    t.spawner = parseSpawner(r["spawner"])
    t.objective = parseObjective(r["objective"])
    t.audioCues = parseAudioCues(r["audioCues"])
    t.rigidBody = parsePhysicsBody(rbSource)
    t.joint = parseJoint(r["joint"] ?? r["constraint"])
    t.collidable = XRJSON.bool(r["collidable"]) == true
    return t.isEmpty ? nil : t
  }

  /// Parses every node of a glTF root (`nil` entries for nodes without sim traits).
  public static func parseNodes(_ root: [String: Any]) -> [XRSimTraits?] {
    (XRJSON.array(root["nodes"]) ?? []).map { n in
      parse(XRJSON.object(XRJSON.object(n)?["extras"])?["xr"])
    }
  }
}
