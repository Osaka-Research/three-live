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

// `objectives` for `XRSimWorld` (port of xr-live/src/sim/objectives.ts and
// Objectives.kt). Hosts render a HUD from `scenario(_:)`.

import Foundation

/// Pickups, ordered checkpoints, keys, time bonuses, restores, score, attempts, countdown,
/// and pass / fail / timeout.
public enum Objectives {
  public static let rejectCooldownMs = 1000.0
  private static let key = "objectives"

  /// Snapshot of the scenario for hosts.
  public struct Scenario: Equatable, Sendable {
    public let score: Double
    /// `nil` when attempts are unlimited.
    public let attemptsLeft: Int?
    /// `running`, `pass`, `fail`, or `timeout`.
    public let status: String
    /// Seconds left on the countdown, or `nil` without a timer.
    public let timeRemainingSec: Double?
  }

  final class State {
    var score = 0.0
    var attemptsLeft: Int?
    var timerMs: Double
    var elapsedMs = 0.0
    let targetScore: Double
    var status = "running"
    var done = Set<ObjectIdentifier>()
    var respawnAt: [(body: XRSimWorld.Body, at: Double)] = []
    var unsubs: [() -> Void] = []
    init(_ world: XRSimWorld) {
      attemptsLeft = world.attempts.map { Swift.max(1, $0) }
      timerMs = XRJSON.clampNum(world.scenarioTimerSec, 0, 86400, 0) * 1000
      targetScore = XRJSON.clampNum(world.targetScore, 0, 1e9, 0)
    }
  }

  private static func enabled(_ world: XRSimWorld) -> Bool {
    world.objectivesEnabled || world.targetScore > 0 || world.scenarioTimerSec > 0
      || world.attempts != nil || world.bodies.contains { $0.traits.objective != nil }
  }

  private static func state(_ world: XRSimWorld) -> State {
    if let st = world.state[key] as? State { return st }
    let st = State(world)
    world.state[key] = st
    st.unsubs.append(
      world.on("xrdepleted") { [weak world, weak st] d, body, _ in
        guard let world = world, let st = st else { return }
        let v = XRJSON.number(d["scoreValue"]) ?? 0
        if v.isFinite && v != 0 { addScore(world, st, v) }
        if let b = body, b === world.character { loseAttempt(world, st) }
      })
    st.unsubs.append(
      world.on("agentreach") { [weak world, weak st] _, _, other in
        guard let world = world, let st = st, let ch = world.character, other === ch,
          ch.traits.integrity == nil
        else { return }
        loseAttempt(world, st)
      })
    return st
  }

  /// Current scenario, or `nil` before objectives activate.
  public static func scenario(_ world: XRSimWorld) -> Scenario? {
    guard let st = world.state[key] as? State else { return nil }
    return Scenario(
      score: st.score, attemptsLeft: st.attemptsLeft, status: st.status,
      timeRemainingSec: st.timerMs > 0 ? Swift.max(0, (st.timerMs - st.elapsedMs) / 1000) : nil)
  }

  private static func emitScore(_ world: XRSimWorld, _ st: State, _ delta: Double) {
    let remaining: Any =
      st.timerMs > 0 ? Swift.max(0, ((st.timerMs - st.elapsedMs) / 100).rounded() / 10) : NSNull()
    world.emit(
      "xrscorechange",
      [
        "score": st.score, "delta": delta,
        "attemptsLeft": st.attemptsLeft.map { $0 as Any } ?? NSNull(),
        "timeRemaining": remaining,
      ])
  }

  private static func addScore(_ world: XRSimWorld, _ st: State, _ delta: Double) {
    guard st.status == "running" else { return }
    st.score += delta
    emitScore(world, st, delta)
  }

  private static func end(_ world: XRSimWorld, _ st: State, _ outcome: String) {
    guard st.status == "running" else { return }
    st.status = outcome
    world.ended = true
    world.emit(
      "xrscenarioend",
      [
        "outcome": outcome, "finalScore": st.score,
        "elapsedSec": (st.elapsedMs / 100).rounded() / 10,
      ])
  }

  private static func loseAttempt(_ world: XRSimWorld, _ st: State) {
    guard st.status == "running" else { return }
    if let left = st.attemptsLeft {
      st.attemptsLeft = left - 1
      emitScore(world, st, 0)
      if left - 1 <= 0 {
        end(world, st, "fail")
        return
      }
    } else {
      emitScore(world, st, 0)
    }
    if let ch = world.character {
      ch.pos = ch.initPos
      ch.vel = .zero
      ch.yaw = 0
      ch.hidden = false
      ch.integrity = ch.traits.integrity?.max ?? 0
    }
  }

  private static func requiredRemaining(_ world: XRSimWorld, _ st: State) -> Int {
    world.active().filter {
      $0.traits.objective?.required == true && !st.done.contains(ObjectIdentifier($0))
    }.count
  }

  /// Lowest `order` among incomplete ordered objectives, or `0`.
  static func nextOrder(_ world: XRSimWorld, _ done: Set<ObjectIdentifier>) -> Int {
    var next = 0
    for b in world.active() {
      let o = b.traits.objective?.order ?? 0
      if o > 0 && !done.contains(ObjectIdentifier(b)) && (next == 0 || o < next) { next = o }
    }
    return next
  }

  /// Attempts to complete objective `b`; `true` when it completed.
  @discardableResult
  public static func complete(_ world: XRSimWorld, _ b: XRSimWorld.Body) -> Bool {
    guard let opts = b.traits.objective, !b.hidden, !b.isTemplate, !world.ended else {
      return false
    }
    let st = state(world)
    guard st.status == "running" else { return false }
    if opts.order > 0 && opts.order != nextOrder(world, st.done) {
      let last = b.data["objRejectMs"] as? Double ?? -.infinity
      if world.timeMs - last >= rejectCooldownMs {
        b.data["objRejectMs"] = world.timeMs
        world.emit(
          "xrobjective",
          [
            "nodeId": b.name, "tag": opts.tag, "type": opts.type, "amount": 0.0,
            "totalScore": st.score, "remainingRequired": requiredRemaining(world, st),
            "outOfOrder": true,
          ], body: b)
      }
      return false
    }
    var delta = 0.0
    switch opts.type {
    case "time-bonus": if st.timerMs > 0 { st.timerMs += opts.amount * 1000 }
    case "restore":
      if let ch = world.character, let max = ch.traits.integrity?.max {
        ch.integrity = Swift.max(0, Swift.min(max, ch.integrity + opts.amount))
      }
    default: delta = opts.amount
    }
    st.done.insert(ObjectIdentifier(b))
    b.hidden = true
    if opts.respawnSec > 0 { st.respawnAt.append((b, world.timeMs + opts.respawnSec * 1000)) }
    st.score += delta
    world.emit(
      "xrobjective",
      [
        "nodeId": b.name, "tag": opts.tag, "type": opts.type, "amount": opts.amount,
        "totalScore": st.score, "remainingRequired": requiredRemaining(world, st),
        "outOfOrder": false,
      ], body: b)
    if delta != 0 { emitScore(world, st, delta) }
    return true
  }

  private static func checkPass(_ world: XRSimWorld, _ st: State) {
    let objs = world.active().filter { $0.traits.objective != nil }
    let required = objs.filter { $0.traits.objective!.required }
    let isDone = { (b: XRSimWorld.Body) in st.done.contains(ObjectIdentifier(b)) }
    if !required.isEmpty && required.allSatisfy(isDone) {
      end(world, st, "pass")
    } else if st.targetScore > 0 && st.score >= st.targetScore {
      end(world, st, "pass")
    } else if required.isEmpty && st.targetScore == 0 {
      let oneShot = objs.filter { $0.traits.objective!.respawnSec == 0 }
      if !oneShot.isEmpty && oneShot.allSatisfy(isDone) { end(world, st, "pass") }
    }
  }

  static func step(_ world: XRSimWorld, _ dt: Double) {
    guard enabled(world) else { return }
    let st = state(world)
    guard st.status == "running" else { return }
    st.elapsedMs += dt * 1000
    let t = world.timeMs / 1000
    let due = st.respawnAt.filter { world.timeMs >= $0.at }
    st.respawnAt.removeAll { world.timeMs >= $0.at }
    for d in due { d.body.hidden = false }
    var collectors: [SIMD3<Double>] = []
    if let ch = world.character, !ch.hidden { collectors.append(ch.worldCenter()) }
    if world.xrActive { collectors.append(world.headPosition()) }
    for b in world.active() {
      guard let o = b.traits.objective, !b.hidden else { continue }
      if o.spinSpeed != 0 {
        b.yaw = (b.yaw + o.spinSpeed * dt).truncatingRemainder(dividingBy: .pi * 2)
      }
      if o.bobAmplitude > 0 {
        b.pos = SIMD3(b.pos.x, b.initPos.y + o.bobAmplitude * sin(t * 2.4), b.pos.z)
      }
      let c = b.worldCenter()
      for p in collectors {
        let d = p - c
        if (d.x * d.x + d.y * d.y + d.z * d.z).squareRoot() <= o.radius {
          complete(world, b)
          break
        }
      }
    }
    if st.timerMs > 0 && st.elapsedMs >= st.timerMs {
      end(world, st, "timeout")
      return
    }
    checkPass(world, st)
  }

  static func select(_ world: XRSimWorld, _ body: XRSimWorld.Body?) -> Bool {
    guard let b = body, b.traits.objective != nil, world.character == nil, enabled(world) else {
      return false
    }
    return complete(world, b)
  }

  static func reset(_ world: XRSimWorld) {
    guard let st = world.state.removeValue(forKey: key) as? State else { return }
    for u in st.unsubs { u() }
  }
}
