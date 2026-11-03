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
 * `objectives` for [XRSimWorld] (port of `xr-live/src/sim/objectives.ts`): pickups, ordered
 * checkpoints, keys, time bonuses, restores, score, attempts, countdown, and pass / fail / timeout.
 * Hosts render a HUD from [scenario].
 */
object Objectives {
  const val REJECT_COOLDOWN_MS: Double = 1000.0
  private const val KEY = "objectives"

  /** Snapshot of the scenario for hosts. */
  data class Scenario(
    val score: Double,
    /** `null` when attempts are unlimited. */
    val attemptsLeft: Int?,
    /** `running`, `pass`, `fail`, or `timeout`. */
    val status: String,
    /** Seconds left on the countdown, or `null` without a timer. */
    val timeRemainingSec: Double?,
  )

  internal class State(world: XRSimWorld) {
    var score = 0.0
    var attemptsLeft: Int? = world.attempts?.let { Math.max(1, it) }
    var timerMs = XRSpatialMath.clampNum(world.scenarioTimerSec, 0.0, 86400.0, 0.0) * 1000
    var elapsedMs = 0.0
    val targetScore = XRSpatialMath.clampNum(world.targetScore, 0.0, 1e9, 0.0)
    var status = "running"
    val done = HashSet<XRSimWorld.Body>()
    val respawnAt = HashMap<XRSimWorld.Body, Double>()
    val unsubs = ArrayList<() -> Unit>()
  }

  private fun enabled(world: XRSimWorld): Boolean =
    world.objectivesEnabled ||
      world.targetScore > 0 ||
      world.scenarioTimerSec > 0 ||
      world.attempts != null ||
      world.bodies.any { it.traits.objective != null }

  private fun state(world: XRSimWorld): State {
    (world.state[KEY] as? State)?.let {
      return it
    }
    val st = State(world)
    world.state[KEY] = st
    st.unsubs +=
      world.on("xrdepleted") { d, body, _ ->
        val v = (d["scoreValue"] as? Number)?.toDouble() ?: 0.0
        if (v.isFinite() && v != 0.0) addScore(world, st, v)
        if (body != null && body === world.character) loseAttempt(world, st)
      }
    st.unsubs +=
      world.on("agentreach") { _, _, other ->
        val ch = world.character
        if (ch != null && other === ch && ch.traits.integrity == null) loseAttempt(world, st)
      }
    return st
  }

  /** Current scenario, or `null` before objectives activate. */
  @JvmStatic
  fun scenario(world: XRSimWorld): Scenario? {
    val st = world.state[KEY] as? State ?: return null
    return Scenario(
      st.score,
      st.attemptsLeft,
      st.status,
      if (st.timerMs > 0) Math.max(0.0, (st.timerMs - st.elapsedMs) / 1000) else null,
    )
  }

  private fun emitScore(world: XRSimWorld, st: State, delta: Double) {
    world.emit(
      "xrscorechange",
      mapOf(
        "score" to st.score,
        "delta" to delta,
        "attemptsLeft" to st.attemptsLeft,
        "timeRemaining" to
          if (st.timerMs > 0) Math.max(0.0, Math.round((st.timerMs - st.elapsedMs) / 100) / 10.0)
          else null,
      ),
    )
  }

  private fun addScore(world: XRSimWorld, st: State, delta: Double) {
    if (st.status != "running") return
    st.score += delta
    emitScore(world, st, delta)
  }

  private fun end(world: XRSimWorld, st: State, outcome: String) {
    if (st.status != "running") return
    st.status = outcome
    world.ended = true
    world.emit(
      "xrscenarioend",
      mapOf(
        "outcome" to outcome,
        "finalScore" to st.score,
        "elapsedSec" to Math.round(st.elapsedMs / 100) / 10.0,
      ),
    )
  }

  private fun loseAttempt(world: XRSimWorld, st: State) {
    if (st.status != "running") return
    val left = st.attemptsLeft
    if (left == null) {
      emitScore(world, st, 0.0)
    } else {
      st.attemptsLeft = left - 1
      emitScore(world, st, 0.0)
      if (left - 1 <= 0) {
        end(world, st, "fail")
        return
      }
    }
    world.character?.let { ch ->
      ch.pos = ch.initPos.copyOf()
      ch.vel = DoubleArray(3)
      ch.yaw = 0.0
      ch.hidden = false
      ch.integrity = ch.traits.integrity?.max ?: 0.0
    }
  }

  private fun requiredRemaining(world: XRSimWorld, st: State): Int =
    world.active().count { it.traits.objective?.required == true && it !in st.done }

  /** Lowest `order` among incomplete ordered objectives, or `0`. */
  @JvmStatic
  fun nextOrder(world: XRSimWorld, done: Set<XRSimWorld.Body>): Int {
    var next = 0
    for (b in world.active()) {
      val o = b.traits.objective?.order ?: 0
      if (o > 0 && b !in done && (next == 0 || o < next)) next = o
    }
    return next
  }

  /** Attempts to complete objective [b]; `true` when it completed. */
  @JvmStatic
  fun complete(world: XRSimWorld, b: XRSimWorld.Body): Boolean {
    val opts = b.traits.objective ?: return false
    if (b.hidden || b.isTemplate || world.ended) return false
    val st = state(world)
    if (st.status != "running") return false
    if (opts.order > 0 && opts.order != nextOrder(world, st.done)) {
      val last = b.data["objRejectMs"] as? Double ?: Double.NEGATIVE_INFINITY
      if (world.timeMs - last >= REJECT_COOLDOWN_MS) {
        b.data["objRejectMs"] = world.timeMs
        world.emit(
          "xrobjective",
          mapOf(
            "nodeId" to b.name,
            "tag" to opts.tag,
            "type" to opts.type,
            "amount" to 0.0,
            "totalScore" to st.score,
            "remainingRequired" to requiredRemaining(world, st),
            "outOfOrder" to true,
          ),
          b,
        )
      }
      return false
    }
    var delta = 0.0
    when (opts.type) {
      "time-bonus" -> if (st.timerMs > 0) st.timerMs += opts.amount * 1000
      "restore" -> {
        val ch = world.character
        val max = ch?.traits?.integrity?.max
        if (ch != null && max != null)
          ch.integrity = Math.max(0.0, Math.min(max, ch.integrity + opts.amount))
      }
      else -> delta = opts.amount
    }
    st.done += b
    b.hidden = true
    if (opts.respawnSec > 0) st.respawnAt[b] = world.timeMs + opts.respawnSec * 1000
    st.score += delta
    world.emit(
      "xrobjective",
      mapOf(
        "nodeId" to b.name,
        "tag" to opts.tag,
        "type" to opts.type,
        "amount" to opts.amount,
        "totalScore" to st.score,
        "remainingRequired" to requiredRemaining(world, st),
        "outOfOrder" to false,
      ),
      b,
    )
    if (delta != 0.0) emitScore(world, st, delta)
    return true
  }

  private fun checkPass(world: XRSimWorld, st: State) {
    val objs = world.active().filter { it.traits.objective != null }
    val required = objs.filter { it.traits.objective!!.required }
    if (required.isNotEmpty() && required.all { it in st.done }) {
      end(world, st, "pass")
    } else if (st.targetScore > 0 && st.score >= st.targetScore) {
      end(world, st, "pass")
    } else if (required.isEmpty() && st.targetScore == 0.0) {
      val oneShot = objs.filter { it.traits.objective!!.respawnSec == 0.0 }
      if (oneShot.isNotEmpty() && oneShot.all { it in st.done }) end(world, st, "pass")
    }
  }

  internal fun step(world: XRSimWorld, dt: Double) {
    if (!enabled(world)) return
    val st = state(world)
    if (st.status != "running") return
    st.elapsedMs += dt * 1000
    val t = world.timeMs / 1000
    val it = st.respawnAt.entries.iterator()
    while (it.hasNext()) {
      val (b, at) = it.next()
      if (world.timeMs >= at) {
        it.remove()
        b.hidden = false
      }
    }
    val collectors = ArrayList<DoubleArray>()
    world.character?.takeIf { !it.hidden }?.let { collectors += it.center() }
    if (world.xrActive) collectors += world.headPosition()
    for (b in world.active()) {
      val o = b.traits.objective ?: continue
      if (b.hidden) continue
      if (o.spinSpeed != 0.0) b.yaw = (b.yaw + o.spinSpeed * dt) % (Math.PI * 2)
      if (o.bobAmplitude > 0) {
        b.pos = doubleArrayOf(b.pos[0], b.initPos[1] + o.bobAmplitude * Math.sin(t * 2.4), b.pos[2])
      }
      val c = b.center()
      for (p in collectors) {
        val dx = p[0] - c[0]
        val dy = p[1] - c[1]
        val dz = p[2] - c[2]
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= o.radius) {
          complete(world, b)
          break
        }
      }
    }
    if (st.timerMs > 0 && st.elapsedMs >= st.timerMs) {
      end(world, st, "timeout")
      return
    }
    checkPass(world, st)
  }

  internal fun select(world: XRSimWorld, body: XRSimWorld.Body?): Boolean {
    if (body?.traits?.objective == null || world.character != null || !enabled(world)) return false
    return complete(world, body)
  }

  internal fun reset(world: XRSimWorld) {
    val st = world.state.remove(KEY) as? State ?: return
    for (u in st.unsubs) u()
  }
}
