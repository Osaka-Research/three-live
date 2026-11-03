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

package com.google.threelive

/**
 * `steering-agents` for [XRSimWorld] (port of `xr-live/src/sim/steering-agents.ts`): `patrol`,
 * `chase`, `flee`, `follow`, and `wander` with sight radius, arrival, turn-in-place, separation,
 * and `collidable` push-out. Deterministic per body.
 */
object SteeringAgents {
  const val REACH_COOLDOWN_MS: Double = 1000.0
  const val WANDER_JITTER: Double = 1.5

  internal class Runtime(seed: Long) {
    var state = "idle"
    var waypoint = 0
    val rng = XRSimWorld.makeRng(seed.toInt())
    var wanderYaw = rng() * Math.PI * 2
    var lastReachMs = Double.NEGATIVE_INFINITY
  }

  internal class Target(val pos: DoubleArray, val body: XRSimWorld.Body?, val id: String)

  private fun runtime(b: XRSimWorld.Body): Runtime =
    b.data.getOrPut("agent") { Runtime(XRSimWorld.hashString(b.key)) } as Runtime

  internal fun resolveTarget(world: XRSimWorld, target: String): Target? {
    if (target.isEmpty()) return null
    if (target == XRSimTraits.AGENT_TARGET_USER) {
      val ch = world.character
      return Target(world.userPosition(), ch, ch?.name ?: "user")
    }
    val body = world.body(target)
    if (body != null && !body.hidden && !body.isTemplate) {
      return Target(body.pos.copyOf(), body, body.name)
    }
    val idx = world.session.nodeIndexOf(target)
    val m = DoubleArray(16)
    if (idx < 0 || !world.session.nodeWorldMatrix(idx, m)) return null
    return Target(doubleArrayOf(m[12], m[13], m[14]), null, target)
  }

  /** Effective state from the authored mode and target distance. */
  @JvmStatic
  fun chooseState(opts: XRAgentTrait, targetDistance: Double?, patrolDone: Boolean): String {
    val inSight =
      targetDistance != null && (opts.sightRadius == 0.0 || targetDistance <= opts.sightRadius)
    val roam = if (opts.waypoints.isNotEmpty() && !patrolDone) "patrol" else "wander"
    return when (opts.mode) {
      "chase",
      "flee" -> if (inSight) opts.mode else roam
      "follow" -> if (inSight) "follow" else "idle"
      "patrol",
      "wander" ->
        when {
          targetDistance != null && opts.sightRadius > 0 && targetDistance <= opts.sightRadius ->
            "chase"
          opts.mode == "patrol" ->
            when {
              opts.waypoints.isEmpty() -> "wander"
              patrolDone -> "idle"
              else -> "patrol"
            }
          else -> "wander"
        }
      else -> "idle"
    }
  }

  private fun separation(world: XRSimWorld, b: XRSimWorld.Body, radius: Double): DoubleArray {
    val push = DoubleArray(3)
    if (radius <= 0) return push
    for (o in world.bodies) {
      if (o === b || o.hidden || o.isTemplate || o.traits.agent == null) continue
      val dx = b.pos[0] - o.pos[0]
      val dz = b.pos[2] - o.pos[2]
      val d = Math.hypot(dx, dz)
      if (d >= radius) continue
      if (d < 1e-6) {
        val a = (XRSimWorld.hashString(b.key) % 628) / 100.0
        push[0] += Math.sin(a)
        push[2] += Math.cos(a)
        continue
      }
      val w = 1 - d / radius
      push[0] += dx / d * w
      push[2] += dz / d * w
    }
    return push
  }

  internal fun stepAgent(world: XRSimWorld, b: XRSimWorld.Body, dt: Double) {
    val opts = b.traits.agent ?: return
    val rt = runtime(b)
    val tgt = resolveTarget(world, opts.target)
    val dist = tgt?.let { Math.hypot(it.pos[0] - b.pos[0], it.pos[2] - b.pos[2]) }
    val patrolDone = !opts.loopWaypoints && rt.waypoint >= opts.waypoints.size
    val state = chooseState(opts, dist, patrolDone)
    if (state != rt.state) {
      rt.state = state
      val engaged = state == "chase" || state == "flee" || state == "follow"
      world.emit(
        "agentstatechange",
        mapOf("nodeId" to b.name, "state" to state, "targetId" to if (engaged) tgt?.id else null),
        b,
        tgt?.body,
      )
    }
    var dx = 0.0
    var dz = 0.0
    var scale = 1.0
    if ((state == "chase" || state == "follow") && tgt != null && dist != null) {
      if (dist > 1e-6) {
        dx = (tgt.pos[0] - b.pos[0]) / dist
        dz = (tgt.pos[2] - b.pos[2]) / dist
      }
      scale =
        if (dist <= opts.stopDistance) 0.0
        else Math.max(0.25, Math.min(1.0, (dist - opts.stopDistance) / opts.stopDistance))
    } else if (state == "flee" && tgt != null && dist != null) {
      if (dist > 1e-6) {
        dx = (b.pos[0] - tgt.pos[0]) / dist
        dz = (b.pos[2] - tgt.pos[2]) / dist
      } else {
        dx = Math.sin(rt.wanderYaw)
        dz = Math.cos(rt.wanderYaw)
      }
    } else if (state == "patrol") {
      val wp = opts.waypoints[Math.min(rt.waypoint, opts.waypoints.size - 1)]
      val ex = wp[0] - b.pos[0]
      val ez = wp[2] - b.pos[2]
      val d = Math.hypot(ex, ez)
      if (d < Math.max(0.15, opts.stopDistance * 0.5)) {
        rt.waypoint =
          if (opts.loopWaypoints) (rt.waypoint + 1) % opts.waypoints.size else rt.waypoint + 1
      } else {
        dx = ex / d
        dz = ez / d
      }
    } else if (state == "wander") {
      rt.wanderYaw += (rt.rng() - 0.5) * 2 * WANDER_JITTER * dt
      dx = Math.sin(rt.wanderYaw)
      dz = Math.cos(rt.wanderYaw)
      val bounds = world.sceneBounds
      if (bounds != null) {
        val out =
          b.pos[0] < bounds[0] ||
            b.pos[0] > bounds[3] ||
            b.pos[2] < bounds[2] ||
            b.pos[2] > bounds[5]
        if (out) {
          val cx = (bounds[0] + bounds[3]) / 2 - b.pos[0]
          val cz = (bounds[2] + bounds[5]) / 2 - b.pos[2]
          val d = Math.hypot(cx, cz).takeIf { it != 0.0 } ?: 1.0
          dx = cx / d
          dz = cz / d
          rt.wanderYaw = Math.atan2(dx, dz)
        }
      }
    }
    val sep = separation(world, b, opts.separationRadius)
    val wx = dx * scale + sep[0] * 1.5
    val wz = dz * scale + sep[2] * 1.5
    val wantLen = Math.hypot(wx, wz)
    if (wantLen > 1e-3) {
      val wantYaw = XRSimWorld.yawFromDir(wx, wz)
      b.yaw = XRSimWorld.turnToward(b.yaw, wantYaw, opts.turnSpeed * dt)
      val align = Math.max(0.0, Math.cos(b.yaw - wantYaw))
      val speed = opts.speed * Math.min(1.0, wantLen) * align
      val step = speed * dt
      b.vel = doubleArrayOf(Math.sin(b.yaw) * speed, 0.0, Math.cos(b.yaw) * speed)
      val next =
        doubleArrayOf(
          b.pos[0] + Math.sin(b.yaw) * step,
          b.pos[1],
          b.pos[2] + Math.cos(b.yaw) * step,
        )
      val r = Math.max(0.05, Math.max(b.half[0], b.half[2]))
      val feet = b.pos[1] + b.center[1] - b.half[1]
      for (o in world.bodies) {
        if (o === b || o.hidden || o.isTemplate || !o.traits.collidable) continue
        val box = o.aabb()
        if (box[4] <= feet + 0.05 || box[1] >= feet + b.half[1] * 2) continue
        val pushed = XRSimWorld.pushCircleOutOfAABB(next, r, box)
        if (pushed != null) {
          next[0] = pushed[0]
          next[2] = pushed[1]
        }
      }
      b.pos = next
    } else {
      b.vel = DoubleArray(3)
    }
    if (
      tgt != null &&
        dist != null &&
        (state == "chase" || state == "follow") &&
        dist <= opts.stopDistance + 1e-3 &&
        world.timeMs - rt.lastReachMs >= REACH_COOLDOWN_MS
    ) {
      rt.lastReachMs = world.timeMs
      world.emit(
        "agentreach",
        mapOf("agentId" to b.name, "targetId" to tgt.id, "position" to b.pos.toList()),
        b,
        tgt.body,
      )
    }
  }

  internal fun step(world: XRSimWorld, dt: Double) {
    if (!world.steeringEnabled) return
    for (b in world.bodies.toList()) {
      if (b.traits.agent != null && !b.hidden && !b.isTemplate) stepAgent(world, b, dt)
    }
  }
}
