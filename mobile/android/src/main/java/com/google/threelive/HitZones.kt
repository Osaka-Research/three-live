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
 * `hit-zones` for [XRSimWorld] (port of `xr-live/src/sim/hit-zones.ts`): integrity and hits,
 * projectile / hitscan firing with group filtering and `collidable` occlusion, contact amounts, box
 * / sphere zones with enter / exit events, and spawners (instances are mirrored by renderers
 * through [XRSimWorld.Listener.onInstancePose]). Renderers draw hit flashes, integrity bars,
 * projectiles, burst fragments, and zone outlines from [visuals].
 */
object HitZones {
  const val MAX_PROJECTILES: Int = 32
  const val PROJECTILE_LIFETIME_S: Double = 3.0
  const val DESPAWN_DELAY_MS: Double = 500.0
  const val HITSCAN_RANGE: Double = 100.0
  const val MAX_FRAGMENTS: Int = 32
  const val HIT_FLASH_MS: Double = 120.0
  private const val KEY = "hit-zones"

  /** A live projectile (renderers may draw these from [projectiles]). */
  class Projectile internal constructor() {
    var active = false
      internal set

    var pos = DoubleArray(3)
      internal set

    internal var vel = DoubleArray(3)
    internal var life = 0.0
    internal var source: XRSimWorld.Body? = null
    internal var group = ""
  }

  internal class State {
    var lastFireMs = Double.NEGATIVE_INFINITY
    val shots = List(MAX_PROJECTILES) { Projectile() }
    val frags = List(MAX_FRAGMENTS) { Projectile() }
    /** Flash end times, in hit order (like the web `Map`). */
    val flashes = LinkedHashMap<XRSimWorld.Body, Double>()
    val zones = HashMap<XRSimWorld.Body, MutableSet<String>>()
    val spawners = HashMap<XRSimWorld.Body, DoubleArray>()
    val despawn = HashMap<XRSimWorld.Body, Double>()
  }

  private fun state(world: XRSimWorld): State = world.state.getOrPut(KEY) { State() } as State

  /** Active projectiles, for renderers. */
  @JvmStatic
  fun projectiles(world: XRSimWorld): List<Projectile> =
    (world.state[KEY] as? State)?.shots?.filter { it.active }.orEmpty()

  /** Normalized firing mode. */
  @JvmStatic
  fun mode(world: XRSimWorld): String =
    when (world.hitMode.trim().lowercase()) {
      "hitscan" -> "hitscan"
      "contact" -> "contact"
      "",
      "projectile" -> "projectile"
      else -> "off"
    }

  /** Group used for hit filtering and zone watching. */
  @JvmStatic
  fun groupOf(world: XRSimWorld, b: XRSimWorld.Body): String =
    b.traits.integrity?.group
      ?: when {
        b === world.character -> "character"
        b.traits.agent != null -> "agent"
        b.traits.rigidBody?.body == "dynamic" -> "physics"
        else -> "neutral"
      }

  private fun canTarget(b: XRSimWorld.Body, group: String, source: XRSimWorld.Body?): Boolean {
    val i = b.traits.integrity ?: return false
    return !b.hidden && !b.isTemplate && b !== source && b.integrity > 0 && i.group != group
  }

  private fun canShootTarget(b: XRSimWorld.Body, group: String, source: XRSimWorld.Body?): Boolean {
    if (canTarget(b, group, source)) return true
    return b.traits.rigidBody?.body == "dynamic" && !b.hidden && !b.isTemplate && b !== source
  }

  /** Applies [amount] to [target]; `false` when blocked by the cooldown or already depleted. */
  @JvmStatic
  fun applyHit(
    world: XRSimWorld,
    target: XRSimWorld.Body,
    amount: Double,
    source: XRSimWorld.Body?,
    point: DoubleArray?,
  ): Boolean {
    val opts = target.traits.integrity ?: return false
    if (target.integrity <= 0 || target.hidden) return false
    if (world.timeMs - target.lastHitMs < opts.cooldownMs) return false
    target.lastHitMs = world.timeMs
    val amt = if (amount.isFinite()) Math.max(0.0, amount) else 0.0
    target.integrity = Math.max(0.0, target.integrity - amt)
    val st = state(world)
    st.flashes[target] = world.timeMs + HIT_FLASH_MS
    val at = point ?: target.center()
    world.emit(
      "xrhit",
      mapOf(
        "targetId" to target.name,
        "sourceId" to (source?.name ?: "user"),
        "amount" to amt,
        "remaining" to target.integrity,
        "point" to at.toList(),
      ),
      target,
      source,
    )
    if (target.integrity <= 0) {
      world.emit(
        "xrdepleted",
        mapOf(
          "targetId" to target.name,
          "group" to opts.group,
          "scoreValue" to opts.scoreValue,
          "position" to target.pos.toList(),
        ),
        target,
        source,
      )
      if (opts.hideOnDepleted) {
        burst(world, st, target)
        target.hidden = true
        st.flashes.remove(target)
        if (target.isInstance) st.despawn[target] = world.timeMs + DESPAWN_DELAY_MS
      }
    }
    return true
  }

  /** Launches up to 8 fragments from [b] (same RNG draws as the web runtime). */
  private fun burst(world: XRSimWorld, st: State, b: XRSimWorld.Body) {
    val c = b.center()
    var n = 0
    for (f in st.frags) {
      if (f.active || n >= 8) continue
      val a = (n / 8.0) * Math.PI * 2 + world.rng()
      val s = 1.5 + world.rng() * 1.5
      val vy = 2 + world.rng() * 2
      f.active = true
      f.pos = c.copyOf()
      f.vel = doubleArrayOf(Math.cos(a) * s, vy, Math.sin(a) * s)
      f.life = 0.6
      f.source = b
      n++
    }
  }

  private class Origin(val pos: DoubleArray, val dir: DoubleArray, val source: XRSimWorld.Body?)

  private fun origin(world: XRSimWorld): Origin {
    val ch = world.character
    if (ch != null && !ch.hidden) {
      val fwd = XRSimWorld.rotateY(doubleArrayOf(0.0, 0.0, 1.0), ch.yaw)
      val c = ch.center()
      val r = Math.max(ch.half[0], ch.half[2]) + 0.1
      return Origin(doubleArrayOf(c[0] + fwd[0] * r, c[1], c[2] + fwd[2] * r), fwd, ch)
    }
    return Origin(world.headPosition(), world.cameraForward(), null)
  }

  /** Nearest target along a ray, honoring `collidable` occluders. */
  @JvmStatic
  fun raycastTargets(
    world: XRSimWorld,
    origin: DoubleArray,
    dir: DoubleArray,
    group: String,
    source: XRSimWorld.Body?,
    range: Double = HITSCAN_RANGE,
  ): Pair<XRSimWorld.Body, DoubleArray>? {
    val end = DoubleArray(3) { origin[it] + dir[it] * range }
    var best: XRSimWorld.Body? = null
    var bestT = Double.POSITIVE_INFINITY
    var blockT = Double.POSITIVE_INFINITY
    for (b in world.bodies) {
      if (b.hidden || b.isTemplate || b === source) continue
      if (canShootTarget(b, group, source)) {
        val t = XRSimWorld.intersectSegmentSphere(origin, end, b.center(), Math.max(0.05, b.radius))
        if (t != null && t < bestT) {
          bestT = t
          best = b
        }
      } else if (b.traits.collidable || b.traits.rigidBody?.body == "static") {
        val t = XRSimWorld.intersectSegmentAABB(origin, end, b.aabb())
        if (t != null && t < blockT) blockT = t
      }
    }
    if (best == null || bestT > blockT) return null
    return best to DoubleArray(3) { origin[it] + (end[it] - origin[it]) * bestT }
  }

  private fun fire(world: XRSimWorld, mode: String, toward: DoubleArray?) {
    val st = state(world)
    val rate = XRSpatialMath.clampNum(world.fireRate, 0.1, 30.0, 4.0)
    if (world.timeMs - st.lastFireMs < 1000 / rate) return
    st.lastFireMs = world.timeMs
    val o = origin(world)
    var dir = o.dir
    if (toward != null) {
      val d = DoubleArray(3) { toward[it] - o.pos[it] }
      val len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
      if (len > 1e-6) dir = DoubleArray(3) { d[it] / len }
    }
    val group = o.source?.let { groupOf(world, it) } ?: "user"
    val amount = XRSpatialMath.clampNum(world.hitAmount, 0.0, 1e6, 25.0)
    if (mode == "hitscan") {
      raycastTargets(world, o.pos, dir, group, o.source)?.let { (b, p) ->
        applyHit(world, b, amount, o.source, p)
        val imp = Math.max(1.5, amount * 0.12)
        RigidBodyPhysics.applyImpulse(
          world,
          b,
          doubleArrayOf(dir[0] * imp, dir[1] * imp, dir[2] * imp),
        )
      }
      return
    }
    val shot = st.shots.firstOrNull { !it.active } ?: return
    val speed = XRSpatialMath.clampNum(world.projectileSpeed, 0.5, 200.0, 14.0)
    shot.active = true
    shot.pos = o.pos.copyOf()
    shot.vel = DoubleArray(3) { dir[it] * speed }
    shot.life = PROJECTILE_LIFETIME_S
    shot.source = o.source
    shot.group = group
  }

  private fun stepShots(world: XRSimWorld, st: State, dt: Double) {
    val g = XRSpatialMath.clampNum(world.projectileGravity, 0.0, 50.0, 0.0)
    val amount = XRSpatialMath.clampNum(world.hitAmount, 0.0, 1e6, 25.0)
    for (s in st.shots) {
      if (!s.active) continue
      s.life -= dt
      s.vel[1] -= g * dt
      val prev = s.pos.copyOf()
      s.pos = DoubleArray(3) { s.pos[it] + s.vel[it] * dt }
      var best: XRSimWorld.Body? = null
      var bestT = Double.POSITIVE_INFINITY
      var blocked = Double.POSITIVE_INFINITY
      for (b in world.bodies) {
        if (b.hidden || b.isTemplate || b === s.source) continue
        if (canShootTarget(b, s.group, s.source)) {
          val t =
            XRSimWorld.intersectSegmentSphere(prev, s.pos, b.center(), Math.max(0.05, b.radius))
          if (t != null && t < bestT) {
            bestT = t
            best = b
          }
        } else if (b.traits.collidable || b.traits.rigidBody?.body == "static") {
          val t = XRSimWorld.intersectSegmentAABB(prev, s.pos, b.aabb())
          if (t != null && t < blocked) blocked = t
        }
      }
      if (best != null && bestT <= blocked) {
        applyHit(
          world,
          best,
          amount,
          s.source,
          DoubleArray(3) { prev[it] + (s.pos[it] - prev[it]) * bestT },
        )
        val vLen = Math.sqrt(s.vel[0] * s.vel[0] + s.vel[1] * s.vel[1] + s.vel[2] * s.vel[2])
        if (vLen > 1e-6) {
          val imp = Math.max(1.5, amount * 0.12)
          RigidBodyPhysics.applyImpulse(
            world,
            best,
            doubleArrayOf(s.vel[0] / vLen * imp, s.vel[1] / vLen * imp, s.vel[2] / vLen * imp),
          )
        }
        s.active = false
      } else if (blocked <= 1 || s.life <= 0 || s.pos[1] < world.floorY - 50) {
        s.active = false
      }
    }
  }

  private fun stepFragments(st: State, dt: Double) {
    for (f in st.frags) {
      if (!f.active) continue
      f.life -= dt
      f.vel[1] -= 9.8 * dt
      f.pos = DoubleArray(3) { f.pos[it] + f.vel[it] * dt }
      if (f.life <= 0) f.active = false
    }
  }

  private fun stepContacts(world: XRSimWorld) {
    val live = world.bodies.filter { it.traits.integrity != null && !it.hidden && !it.isTemplate }
    for (src in live) {
      val amt = src.traits.integrity!!.contactAmount
      if (amt <= 0 || src.integrity <= 0) continue
      val cs = src.center()
      for (t in live) {
        if (!canTarget(t, src.traits.integrity.group, src)) continue
        val ct = t.center()
        val r = Math.max(0.05, src.radius) + Math.max(0.05, t.radius)
        val d =
          Math.sqrt(
            (cs[0] - ct[0]).let { it * it } +
              (cs[1] - ct[1]).let { it * it } +
              (cs[2] - ct[2]).let { it * it }
          )
        if (d < r) applyHit(world, t, amt, src, null)
      }
    }
  }

  /** Whether world point [p] is inside zone body [z]. */
  @JvmStatic
  fun pointInZone(z: XRSimWorld.Body, p: DoubleArray): Boolean {
    val opts = z.traits.zone ?: return false
    val local =
      XRSimWorld.rotateY(doubleArrayOf(p[0] - z.pos[0], p[1] - z.pos[1], p[2] - z.pos[2]), -z.yaw)
    if (opts.shape == "sphere") {
      return Math.sqrt(local[0] * local[0] + local[1] * local[1] + local[2] * local[2]) <=
        opts.radius
    }
    return Math.abs(local[0]) <= opts.size[0] / 2 &&
      Math.abs(local[1]) <= opts.size[1] / 2 &&
      Math.abs(local[2]) <= opts.size[2] / 2
  }

  private class Tracked(
    val key: String,
    val id: String,
    val group: String,
    val pos: DoubleArray,
    val body: XRSimWorld.Body?,
  )

  private fun stepZones(world: XRSimWorld, st: State) {
    val tracked = ArrayList<Tracked>()
    for (b in world.bodies) {
      if (b.hidden || b.isTemplate) continue
      if (
        b === world.character ||
          b.traits.agent != null ||
          b.traits.integrity != null ||
          b.traits.rigidBody?.body == "dynamic"
      ) {
        tracked.add(Tracked(b.key, b.name, groupOf(world, b), b.center(), b))
      }
    }
    if (world.xrActive) tracked.add(Tracked("user", "user", "user", world.headPosition(), null))
    for (z in world.bodies) {
      val zone = z.traits.zone ?: continue
      if (z.isTemplate) continue
      val inside = st.zones[z] ?: emptySet<String>()
      val now = HashSet<String>()
      if (!z.hidden) {
        for (t in tracked) {
          if (t.body === z) continue
          if (zone.watchGroups.isNotEmpty() && t.group !in zone.watchGroups) continue
          if (pointInZone(z, t.pos)) now.add(t.key)
        }
      }
      for (t in tracked) {
        val was = t.key in inside
        val isIn = t.key in now
        if (was == isIn) continue
        world.emit(
          if (isIn) "xrzoneenter" else "xrzoneexit",
          mapOf("zoneId" to z.name, "nodeId" to t.id, "group" to t.group),
          z,
          t.body,
        )
      }
      for (key in inside) {
        if (key in now || tracked.any { it.key == key }) continue
        val gone = world.bodies.firstOrNull { it.key == key }
        world.emit(
          "xrzoneexit",
          mapOf(
            "zoneId" to z.name,
            "nodeId" to (gone?.name ?: key),
            "group" to (gone?.let { groupOf(world, it) } ?: ""),
          ),
          z,
          gone,
        )
      }
      st.zones[z] = now
    }
  }

  /** Creates an instance of [spawner]'s template at the spawner's position. */
  @JvmStatic
  fun spawnInstance(world: XRSimWorld, spawner: XRSimWorld.Body): XRSimWorld.Body? {
    val opts = spawner.traits.spawner ?: return null
    val tpl = world.bodies.firstOrNull { it.isTemplate && it.name == opts.template } ?: return null
    val n = ++world.spawnCounter
    val inst =
      XRSimWorld.Body(
        "spawn:$n",
        "${tpl.name}#$n",
        tpl.nodeIndex,
        tpl.traits.copy(spawner = null),
        tpl.initPos.copyOf(),
        tpl.initQuat.copyOf(),
        tpl.center.copyOf(),
        tpl.half.copyOf(),
      )
    inst.spawnedFrom = spawner.key
    val a = world.rng() * Math.PI * 2
    val r = Math.sqrt(world.rng()) * opts.spawnRadius
    inst.pos =
      doubleArrayOf(
        spawner.pos[0] + Math.cos(a) * r,
        spawner.pos[1],
        spawner.pos[2] + Math.sin(a) * r,
      )
    world.addBody(inst)
    return inst
  }

  private fun stepSpawners(world: XRSimWorld, st: State, dt: Double) {
    var total = world.bodies.count { it.isInstance }
    for (s in world.bodies.toList()) {
      val opts = s.traits.spawner ?: continue
      if (s.hidden || s.isTemplate) continue
      // [timer, spawned]
      val sp = st.spawners.getOrPut(s) { doubleArrayOf(opts.intervalSec, 0.0) }
      sp[0] -= dt
      if (sp[0] > 0) continue
      sp[0] += opts.intervalSec
      if (opts.totalCount > 0 && sp[1] >= opts.totalCount) continue
      val active = world.bodies.count { it.spawnedFrom == s.key }
      if (active >= opts.maxActive || total >= XRSimWorld.MAX_INSTANCES) continue
      val inst = spawnInstance(world, s) ?: continue
      sp[1] += 1.0
      total++
      world.emit(
        "xrspawn",
        mapOf("spawnerId" to s.name, "instanceId" to inst.name, "index" to sp[1].toInt()),
        s,
        inst,
      )
    }
    val it = st.despawn.entries.iterator()
    while (it.hasNext()) {
      val (b, at) = it.next()
      if (world.timeMs >= at) {
        it.remove()
        world.removeBody(b)
      }
    }
  }

  internal fun step(world: XRSimWorld, dt: Double) {
    val st = state(world)
    val mode = mode(world)
    if (mode == "projectile" || mode == "hitscan") {
      if (world.fireQueued) {
        world.fireQueued = false
        fire(world, mode, null)
      }
    } else {
      world.fireQueued = false
    }
    stepShots(world, st, dt)
    stepFragments(st, dt)
    stepContacts(world)
    stepSpawners(world, st, dt)
    stepZones(world, st)
  }

  internal fun select(world: XRSimWorld, body: XRSimWorld.Body?, point: DoubleArray?): Boolean {
    val mode = mode(world)
    if (mode == "projectile" && point != null) {
      fire(world, mode, point)
      return false
    }
    if (mode != "hitscan" || body?.traits?.integrity == null) return false
    val st = state(world)
    val rate = XRSpatialMath.clampNum(world.fireRate, 0.1, 30.0, 4.0)
    if (world.timeMs - st.lastFireMs < 1000 / rate) return true
    st.lastFireMs = world.timeMs
    val src = world.character?.takeIf { !it.hidden }
    val group = src?.let { groupOf(world, it) } ?: "user"
    if (canTarget(body, group, src)) {
      applyHit(world, body, XRSpatialMath.clampNum(world.hitAmount, 0.0, 1e6, 25.0), src, point)
    }
    return true
  }

  internal fun reset(world: XRSimWorld) {
    val st = world.state[KEY] as? State ?: return
    for (s in st.shots) s.active = false
    for (f in st.frags) f.active = false
    st.flashes.clear()
    st.zones.clear()
    st.spawners.clear()
    st.despawn.clear()
    st.lastFireMs = Double.NEGATIVE_INFINITY
  }

  /** Integrity bar above [body], facing the head. */
  class BarVisual(
    val body: XRSimWorld.Body,
    val center: DoubleArray,
    /** Yaw (radians) that faces the bar toward the head. */
    val yaw: Double,
    val width: Double,
    /** Remaining integrity fraction (0-1). */
    val frac: Double,
    val color: FloatArray,
  )

  /** Wireframe outline of a colored `zone`. */
  class ZoneVisual(
    val body: XRSimWorld.Body,
    val center: DoubleArray,
    val yaw: Double,
    val size: DoubleArray,
    val color: FloatArray,
  )

  /** An active burst fragment and the body whose color it takes. */
  class FragmentVisual(val pos: DoubleArray, val source: XRSimWorld.Body?)

  /** What renderers draw this frame (port of `computeSimVisuals` in `hit-zones.ts`). */
  class Visuals(
    /** Bodies inside their 120 ms hit flash. */
    val flashing: List<XRSimWorld.Body>,
    val bars: List<BarVisual>,
    /** Active projectile positions. */
    val projectiles: List<DoubleArray>,
    val fragments: List<FragmentVisual>,
    val zones: List<ZoneVisual>,
  )

  /** Integrity bar fill color for a remaining fraction. */
  @JvmStatic
  fun barColor(frac: Double): FloatArray =
    when {
      frac > 0.6 -> floatArrayOf(0.13f, 0.77f, 0.37f, 1f)
      frac > 0.3 -> floatArrayOf(0.92f, 0.7f, 0.03f, 1f)
      else -> floatArrayOf(0.94f, 0.27f, 0.27f, 1f)
    }

  /** `#rrggbb` (or `#rgb`) to linear-agnostic RGBA in 0-1; white when malformed. */
  @JvmStatic
  fun hexToRgba(hex: String, alpha: Float = 1f): FloatArray {
    var h = hex.removePrefix("#")
    if (h.length == 3) h = h.map { "$it$it" }.joinToString("")
    val n = h.toIntOrNull(16) ?: return floatArrayOf(1f, 1f, 1f, alpha)
    return floatArrayOf(
      ((n shr 16) and 255) / 255f,
      ((n shr 8) and 255) / 255f,
      (n and 255) / 255f,
      alpha,
    )
  }

  /** Computes this frame's [Visuals]. */
  @JvmStatic
  fun visuals(world: XRSimWorld): Visuals {
    val st = world.state[KEY] as? State
    val flashing = ArrayList<XRSimWorld.Body>()
    val projectiles = ArrayList<DoubleArray>()
    val fragments = ArrayList<FragmentVisual>()
    if (st != null) {
      for ((b, until) in st.flashes) if (world.timeMs < until && !b.hidden) flashing += b
      for (p in st.shots) if (p.active) projectiles += p.pos.copyOf()
      for (f in st.frags) if (f.active) fragments += FragmentVisual(f.pos.copyOf(), f.source)
    }
    val bars = ArrayList<BarVisual>()
    val zones = ArrayList<ZoneVisual>()
    val head = world.headPosition()
    for (b in world.bodies) {
      if (b.isTemplate) continue
      val zone = b.traits.zone
      if (zone?.color != null && !b.hidden) {
        val size =
          if (zone.shape == "sphere") DoubleArray(3) { zone.radius * 2 } else zone.size.copyOf()
        zones += ZoneVisual(b, b.pos.copyOf(), b.yaw, size, hexToRgba(zone.color))
      }
      val iopts = b.traits.integrity
      if (iopts == null || !iopts.showBar || b.hidden || b.integrity <= 0) continue
      val c = b.center()
      val center = doubleArrayOf(c[0], c[1] + b.half[1] + 0.12, c[2])
      val frac = Math.max(0.0, Math.min(1.0, b.integrity / iopts.max))
      bars +=
        BarVisual(
          b,
          center,
          Math.atan2(head[0] - center[0], head[2] - center[2]),
          Math.max(0.3, Math.min(1.2, 2 * Math.max(b.half[0], b.half[2]))),
          frac,
          barColor(frac),
        )
    }
    return Visuals(flashing, bars, projectiles, fragments, zones)
  }
}
