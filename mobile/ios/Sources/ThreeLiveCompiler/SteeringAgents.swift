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

// `steering-agents` for `XRSimWorld` (port of xr-live/src/sim/steering-agents.ts
// and SteeringAgents.kt).

import Foundation

/// `patrol`, `chase`, `flee`, `follow`, and `wander` with sight radius, arrival,
/// turn-in-place, separation, and `collidable` push-out. Deterministic per body.
public enum SteeringAgents {
  public static let reachCooldownMs = 1000.0
  public static let wanderJitter = 1.5

  final class Runtime {
    var state = "idle"
    var waypoint = 0
    var rng: () -> Double
    var wanderYaw: Double
    var lastReachMs = -Double.infinity
    init(seed: UInt32) {
      rng = XRSimWorld.makeRng(seed)
      wanderYaw = 0
      wanderYaw = rng() * .pi * 2
    }
  }

  struct Target {
    let pos: SIMD3<Double>
    let body: XRSimWorld.Body?
    let id: String
  }

  private static func runtime(_ b: XRSimWorld.Body) -> Runtime {
    if let rt = b.data["agent"] as? Runtime { return rt }
    let rt = Runtime(seed: XRSimWorld.hashString(b.key))
    b.data["agent"] = rt
    return rt
  }

  static func resolveTarget(_ world: XRSimWorld, _ target: String) -> Target? {
    if target.isEmpty { return nil }
    if target == XRSimTraits.agentTargetUser {
      let ch = world.character
      return Target(pos: world.userPosition(), body: ch, id: ch?.name ?? "user")
    }
    if let body = world.body(named: target), !body.hidden, !body.isTemplate {
      return Target(pos: body.pos, body: body, id: body.name)
    }
    guard let idx = world.session.nodeIndex(named: target) else { return nil }
    let m = world.session.worldMatrix(of: idx)
    return Target(
      pos: SIMD3(Double(m.columns.3.x), Double(m.columns.3.y), Double(m.columns.3.z)), body: nil,
      id: target)
  }

  /// Effective state from the authored mode and target distance.
  public static func chooseState(_ opts: XRAgentTrait, targetDistance: Double?, patrolDone: Bool)
    -> String
  {
    let inSight = targetDistance.map { opts.sightRadius == 0 || $0 <= opts.sightRadius } ?? false
    let roam = !opts.waypoints.isEmpty && !patrolDone ? "patrol" : "wander"
    switch opts.mode {
    case "chase", "flee": return inSight ? opts.mode : roam
    case "follow": return inSight ? "follow" : "idle"
    case "patrol", "wander":
      if let d = targetDistance, opts.sightRadius > 0, d <= opts.sightRadius { return "chase" }
      if opts.mode == "patrol" {
        return opts.waypoints.isEmpty ? "wander" : (patrolDone ? "idle" : "patrol")
      }
      return "wander"
    default: return "idle"
    }
  }

  private static func separation(_ world: XRSimWorld, _ b: XRSimWorld.Body, _ radius: Double)
    -> SIMD3<Double>
  {
    var push = SIMD3<Double>(repeating: 0)
    if radius <= 0 { return push }
    for o in world.bodies {
      if o === b || o.hidden || o.isTemplate || o.traits.agent == nil { continue }
      let dx = b.pos.x - o.pos.x
      let dz = b.pos.z - o.pos.z
      let d = (dx * dx + dz * dz).squareRoot()
      if d >= radius { continue }
      if d < 1e-6 {
        let a = Double(XRSimWorld.hashString(b.key) % 628) / 100
        push.x += sin(a)
        push.z += cos(a)
        continue
      }
      let w = 1 - d / radius
      push.x += dx / d * w
      push.z += dz / d * w
    }
    return push
  }

  static func stepAgent(_ world: XRSimWorld, _ b: XRSimWorld.Body, _ dt: Double) {
    guard let opts = b.traits.agent else { return }
    let rt = runtime(b)
    let tgt = resolveTarget(world, opts.target)
    let dist = tgt.map {
      (($0.pos.x - b.pos.x) * ($0.pos.x - b.pos.x) + ($0.pos.z - b.pos.z) * ($0.pos.z - b.pos.z))
        .squareRoot()
    }
    let patrolDone = !opts.loopWaypoints && rt.waypoint >= opts.waypoints.count
    let state = chooseState(opts, targetDistance: dist, patrolDone: patrolDone)
    if state != rt.state {
      rt.state = state
      let engaged = state == "chase" || state == "flee" || state == "follow"
      world.emit(
        "agentstatechange",
        ["nodeId": b.name, "state": state, "targetId": (engaged ? tgt?.id : nil) as Any],
        body: b, other: tgt?.body)
    }
    var dx = 0.0
    var dz = 0.0
    var scale = 1.0
    if state == "chase" || state == "follow", let t = tgt, let d = dist {
      if d > 1e-6 {
        dx = (t.pos.x - b.pos.x) / d
        dz = (t.pos.z - b.pos.z) / d
      }
      scale =
        d <= opts.stopDistance
        ? 0 : Swift.max(0.25, Swift.min(1, (d - opts.stopDistance) / opts.stopDistance))
    } else if state == "flee", let t = tgt, let d = dist {
      if d > 1e-6 {
        dx = (b.pos.x - t.pos.x) / d
        dz = (b.pos.z - t.pos.z) / d
      } else {
        dx = sin(rt.wanderYaw)
        dz = cos(rt.wanderYaw)
      }
    } else if state == "patrol" {
      let wp = opts.waypoints[Swift.min(rt.waypoint, opts.waypoints.count - 1)]
      let ex = wp.x - b.pos.x
      let ez = wp.z - b.pos.z
      let d = (ex * ex + ez * ez).squareRoot()
      if d < Swift.max(0.15, opts.stopDistance * 0.5) {
        rt.waypoint =
          opts.loopWaypoints ? (rt.waypoint + 1) % opts.waypoints.count : rt.waypoint + 1
      } else {
        dx = ex / d
        dz = ez / d
      }
    } else if state == "wander" {
      rt.wanderYaw += (rt.rng() - 0.5) * 2 * wanderJitter * dt
      dx = sin(rt.wanderYaw)
      dz = cos(rt.wanderYaw)
      if let bounds = world.sceneBounds {
        let out =
          b.pos.x < bounds.min.x || b.pos.x > bounds.max.x || b.pos.z < bounds.min.z
          || b.pos.z > bounds.max.z
        if out {
          let cx = (bounds.min.x + bounds.max.x) / 2 - b.pos.x
          let cz = (bounds.min.z + bounds.max.z) / 2 - b.pos.z
          var d = (cx * cx + cz * cz).squareRoot()
          if d == 0 { d = 1 }
          dx = cx / d
          dz = cz / d
          rt.wanderYaw = atan2(dx, dz)
        }
      }
    }
    let sep = separation(world, b, opts.separationRadius)
    let wx = dx * scale + sep.x * 1.5
    let wz = dz * scale + sep.z * 1.5
    let wantLen = (wx * wx + wz * wz).squareRoot()
    if wantLen > 1e-3 {
      let wantYaw = XRSimWorld.yawFromDir(wx, wz)
      b.yaw = XRSimWorld.turnToward(b.yaw, wantYaw, opts.turnSpeed * dt)
      let align = Swift.max(0, cos(b.yaw - wantYaw))
      let speed = opts.speed * Swift.min(1, wantLen) * align
      let step = speed * dt
      b.vel = SIMD3(sin(b.yaw) * speed, 0, cos(b.yaw) * speed)
      var next = SIMD3(b.pos.x + sin(b.yaw) * step, b.pos.y, b.pos.z + cos(b.yaw) * step)
      let r = Swift.max(0.05, Swift.max(b.half.x, b.half.z))
      let feet = b.pos.y + b.center.y - b.half.y
      for o in world.bodies {
        if o === b || o.hidden || o.isTemplate
          || (!o.traits.collidable && o.traits.rigidBody?.body != "static")
        {
          continue
        }
        let box = o.aabb()
        if box.max.y <= feet + 0.05 || box.min.y >= feet + b.half.y * 2 { continue }
        if let pushed = XRSimWorld.pushCircleOutOfAABB(next, r, box.min, box.max) {
          next.x = pushed.x
          next.z = pushed.y
        }
      }
      b.pos = next
    } else {
      b.vel = .zero
    }
    if let t = tgt, let d = dist, state == "chase" || state == "follow",
      d <= opts.stopDistance + 1e-3, world.timeMs - rt.lastReachMs >= reachCooldownMs
    {
      rt.lastReachMs = world.timeMs
      world.emit(
        "agentreach",
        ["agentId": b.name, "targetId": t.id, "position": [b.pos.x, b.pos.y, b.pos.z]],
        body: b, other: t.body)
    }
  }

  static func step(_ world: XRSimWorld, _ dt: Double) {
    if !world.steeringEnabled { return }
    for b in world.bodies where b.traits.agent != nil && !b.hidden && !b.isTemplate {
      stepAgent(world, b, dt)
    }
  }
}
