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

// `hit-zones` for `XRSimWorld` (port of xr-live/src/sim/hit-zones.ts and
// HitZones.kt). Hit flashes and integrity bars are left to renderers, driven
// by `xrhit` events and `Body.integrity`.

import Foundation
import simd

/// Integrity and hits, projectile / hitscan firing with group filtering and `collidable`
/// occlusion, contact amounts, box / sphere zones, and spawners.
public enum HitZones {
  public static let maxProjectiles = 32
  public static let projectileLifetime = 3.0
  public static let despawnDelayMs = 500.0
  public static let hitscanRange = 100.0
  public static let maxFragments = 32
  public static let hitFlashMs = 120.0
  private static let key = "hit-zones"

  /// A live projectile (renderers may draw these from `projectiles(_:)`).
  public final class Projectile {
    public internal(set) var active = false
    public internal(set) var pos = SIMD3<Double>(repeating: 0)
    var vel = SIMD3<Double>(repeating: 0)
    var life = 0.0
    weak var source: XRSimWorld.Body?
    var group = ""
  }

  final class State {
    var lastFireMs = -Double.infinity
    let shots = (0..<HitZones.maxProjectiles).map { _ in Projectile() }
    let frags = (0..<HitZones.maxFragments).map { _ in Projectile() }
    /// Flash end times in hit order (like the web `Map`).
    var flashes: [(body: XRSimWorld.Body, until: Double)] = []
    var zones: [ObjectIdentifier: Set<String>] = [:]
    var spawners: [ObjectIdentifier: (timer: Double, spawned: Int)] = [:]
    var despawn: [(body: XRSimWorld.Body, at: Double)] = []
  }

  private static func state(_ world: XRSimWorld) -> State {
    if let st = world.state[key] as? State { return st }
    let st = State()
    world.state[key] = st
    return st
  }

  /// Active projectiles, for renderers.
  public static func projectiles(_ world: XRSimWorld) -> [Projectile] {
    (world.state[key] as? State)?.shots.filter { $0.active } ?? []
  }

  /// Normalized firing mode.
  public static func mode(_ world: XRSimWorld) -> String {
    switch world.hitMode.trimmingCharacters(in: .whitespaces).lowercased() {
    case "hitscan": return "hitscan"
    case "contact": return "contact"
    case "", "projectile": return "projectile"
    default: return "off"
    }
  }

  /// Group used for hit filtering and zone watching.
  public static func group(of b: XRSimWorld.Body, in world: XRSimWorld) -> String {
    if let g = b.traits.integrity?.group { return g }
    if b === world.character { return "character" }
    return b.traits.agent != nil ? "agent" : "neutral"
  }

  private static func canTarget(_ b: XRSimWorld.Body, _ group: String, _ source: XRSimWorld.Body?)
    -> Bool
  {
    guard let i = b.traits.integrity else { return false }
    return !b.hidden && !b.isTemplate && b !== source && b.integrity > 0 && i.group != group
  }

  private static func list(_ v: SIMD3<Double>) -> [Double] { [v.x, v.y, v.z] }

  /// Applies `amount` to `target`; `false` when blocked by the cooldown or depleted.
  @discardableResult
  public static func applyHit(
    _ world: XRSimWorld, _ target: XRSimWorld.Body, _ amount: Double, source: XRSimWorld.Body?,
    point: SIMD3<Double>?
  ) -> Bool {
    guard let opts = target.traits.integrity, target.integrity > 0, !target.hidden,
      world.timeMs - target.lastHitMs >= opts.cooldownMs
    else { return false }
    target.lastHitMs = world.timeMs
    let amt = amount.isFinite ? Swift.max(0, amount) : 0
    target.integrity = Swift.max(0, target.integrity - amt)
    let st = state(world)
    if let i = st.flashes.firstIndex(where: { $0.body === target }) {
      st.flashes[i].until = world.timeMs + hitFlashMs
    } else {
      st.flashes.append((target, world.timeMs + hitFlashMs))
    }
    world.emit(
      "xrhit",
      [
        "targetId": target.name, "sourceId": source?.name ?? "user", "amount": amt,
        "remaining": target.integrity, "point": list(point ?? target.worldCenter()),
      ], body: target, other: source)
    if target.integrity <= 0 {
      world.emit(
        "xrdepleted",
        [
          "targetId": target.name, "group": opts.group, "scoreValue": opts.scoreValue,
          "position": list(target.pos),
        ], body: target, other: source)
      if opts.hideOnDepleted {
        burst(world, st, target)
        target.hidden = true
        st.flashes.removeAll { $0.body === target }
        if target.isInstance {
          st.despawn.append((target, world.timeMs + despawnDelayMs))
        }
      }
    }
    return true
  }

  /// Launches up to 8 fragments from `b` (same RNG draws as the web runtime).
  private static func burst(_ world: XRSimWorld, _ st: State, _ b: XRSimWorld.Body) {
    let c = b.worldCenter()
    var n = 0
    for f in st.frags where !f.active && n < 8 {
      let a = Double(n) / 8 * .pi * 2 + world.rng()
      let s = 1.5 + world.rng() * 1.5
      let vy = 2 + world.rng() * 2
      f.active = true
      f.pos = c
      f.vel = SIMD3(cos(a) * s, vy, sin(a) * s)
      f.life = 0.6
      f.source = b
      n += 1
    }
  }

  private static func stepFragments(_ st: State, _ dt: Double) {
    for f in st.frags where f.active {
      f.life -= dt
      f.vel.y -= 9.8 * dt
      f.pos += f.vel * dt
      if f.life <= 0 { f.active = false }
    }
  }

  private static func origin(_ world: XRSimWorld) -> (
    pos: SIMD3<Double>, dir: SIMD3<Double>, source: XRSimWorld.Body?
  ) {
    if let ch = world.character, !ch.hidden {
      let fwd = XRSimWorld.rotateY(SIMD3(0, 0, 1), ch.yaw)
      let c = ch.worldCenter()
      let r = Swift.max(ch.half.x, ch.half.z) + 0.1
      return (SIMD3(c.x + fwd.x * r, c.y, c.z + fwd.z * r), fwd, ch)
    }
    return (world.headPosition(), world.cameraForward(), nil)
  }

  /// Nearest target along a ray, honoring `collidable` occluders.
  public static func raycastTargets(
    _ world: XRSimWorld, origin: SIMD3<Double>, dir: SIMD3<Double>, group: String,
    source: XRSimWorld.Body?, range: Double = hitscanRange
  ) -> (body: XRSimWorld.Body, point: SIMD3<Double>)? {
    let end = origin + dir * range
    var best: XRSimWorld.Body?
    var bestT = Double.infinity
    var blockT = Double.infinity
    for b in world.bodies {
      if b.hidden || b.isTemplate || b === source { continue }
      if canTarget(b, group, source) {
        if let t = XRSimWorld.intersectSegmentSphere(
          origin, end, b.worldCenter(), Swift.max(0.05, b.radius)),
          t < bestT
        {
          bestT = t
          best = b
        }
      } else if b.traits.collidable {
        let box = b.aabb()
        if let t = XRSimWorld.intersectSegmentAABB(origin, end, box.min, box.max), t < blockT {
          blockT = t
        }
      }
    }
    guard let hit = best, bestT <= blockT else { return nil }
    return (hit, origin + (end - origin) * bestT)
  }

  private static func fire(_ world: XRSimWorld, _ mode: String, toward: SIMD3<Double>?) {
    let st = state(world)
    let rate = XRJSON.clampNum(world.fireRate, 0.1, 30, 4)
    if world.timeMs - st.lastFireMs < 1000 / rate { return }
    st.lastFireMs = world.timeMs
    let o = origin(world)
    var dir = o.dir
    if let to = toward {
      let d = to - o.pos
      let len = simd_length(d)
      if len > 1e-6 { dir = d / len }
    }
    let group = o.source.map { HitZones.group(of: $0, in: world) } ?? "user"
    let amount = XRJSON.clampNum(world.hitAmount, 0, 1e6, 25)
    if mode == "hitscan" {
      if let hit = raycastTargets(world, origin: o.pos, dir: dir, group: group, source: o.source) {
        applyHit(world, hit.body, amount, source: o.source, point: hit.point)
      }
      return
    }
    guard let shot = st.shots.first(where: { !$0.active }) else { return }
    let speed = XRJSON.clampNum(world.projectileSpeed, 0.5, 200, 14)
    shot.active = true
    shot.pos = o.pos
    shot.vel = dir * speed
    shot.life = projectileLifetime
    shot.source = o.source
    shot.group = group
  }

  private static func stepShots(_ world: XRSimWorld, _ st: State, _ dt: Double) {
    let g = XRJSON.clampNum(world.projectileGravity, 0, 50, 0)
    let amount = XRJSON.clampNum(world.hitAmount, 0, 1e6, 25)
    for s in st.shots where s.active {
      s.life -= dt
      s.vel.y -= g * dt
      let prev = s.pos
      s.pos += s.vel * dt
      var best: XRSimWorld.Body?
      var bestT = Double.infinity
      var blocked = Double.infinity
      for b in world.bodies {
        if b.hidden || b.isTemplate || b === s.source { continue }
        if canTarget(b, s.group, s.source) {
          if let t = XRSimWorld.intersectSegmentSphere(
            prev, s.pos, b.worldCenter(), Swift.max(0.05, b.radius)),
            t < bestT
          {
            bestT = t
            best = b
          }
        } else if b.traits.collidable {
          let box = b.aabb()
          if let t = XRSimWorld.intersectSegmentAABB(prev, s.pos, box.min, box.max), t < blocked {
            blocked = t
          }
        }
      }
      if let hit = best, bestT <= blocked {
        applyHit(world, hit, amount, source: s.source, point: prev + (s.pos - prev) * bestT)
        s.active = false
      } else if blocked <= 1 || s.life <= 0 || s.pos.y < world.floorY - 50 {
        s.active = false
      }
    }
  }

  private static func stepContacts(_ world: XRSimWorld) {
    let live = world.bodies.filter { $0.traits.integrity != nil && !$0.hidden && !$0.isTemplate }
    for src in live {
      guard let si = src.traits.integrity, si.contactAmount > 0, src.integrity > 0 else { continue }
      let cs = src.worldCenter()
      for t in live where canTarget(t, si.group, src) {
        let r = Swift.max(0.05, src.radius) + Swift.max(0.05, t.radius)
        if simd_distance(cs, t.worldCenter()) < r {
          applyHit(world, t, si.contactAmount, source: src, point: nil)
        }
      }
    }
  }

  /// Whether world point `p` is inside zone body `z`.
  public static func pointInZone(_ z: XRSimWorld.Body, _ p: SIMD3<Double>) -> Bool {
    guard let opts = z.traits.zone else { return false }
    let local = XRSimWorld.rotateY(p - z.pos, -z.yaw)
    if opts.shape == "sphere" { return simd_length(local) <= opts.radius }
    return abs(local.x) <= opts.size.x / 2 && abs(local.y) <= opts.size.y / 2
      && abs(local.z) <= opts.size.z / 2
  }

  private static func stepZones(_ world: XRSimWorld, _ st: State) {
    var tracked:
      [(key: String, id: String, group: String, pos: SIMD3<Double>, body: XRSimWorld.Body?)] = []
    for b in world.bodies where !b.hidden && !b.isTemplate {
      if b === world.character || b.traits.agent != nil || b.traits.integrity != nil {
        tracked.append((b.key, b.name, group(of: b, in: world), b.worldCenter(), b))
      }
    }
    if world.xrActive { tracked.append(("user", "user", "user", world.headPosition(), nil)) }
    for z in world.bodies {
      guard let zone = z.traits.zone, !z.isTemplate else { continue }
      let zid = ObjectIdentifier(z)
      let inside = st.zones[zid] ?? []
      var now = Set<String>()
      if !z.hidden {
        for t in tracked where t.body !== z {
          if !zone.watchGroups.isEmpty && !zone.watchGroups.contains(t.group) { continue }
          if pointInZone(z, t.pos) { now.insert(t.key) }
        }
      }
      for t in tracked {
        let was = inside.contains(t.key)
        let isIn = now.contains(t.key)
        if was == isIn { continue }
        world.emit(
          isIn ? "xrzoneenter" : "xrzoneexit",
          ["zoneId": z.name, "nodeId": t.id, "group": t.group],
          body: z, other: t.body)
      }
      for key in inside where !now.contains(key) && !tracked.contains(where: { $0.key == key }) {
        let gone = world.bodies.first { $0.key == key }
        world.emit(
          "xrzoneexit",
          [
            "zoneId": z.name, "nodeId": gone?.name ?? key,
            "group": gone.map { group(of: $0, in: world) } ?? "",
          ], body: z, other: gone)
      }
      st.zones[zid] = now
    }
  }

  /// Creates an instance of `spawner`'s template at the spawner's position.
  @discardableResult
  public static func spawnInstance(_ world: XRSimWorld, _ spawner: XRSimWorld.Body)
    -> XRSimWorld.Body?
  {
    guard let opts = spawner.traits.spawner,
      let tpl = world.bodies.first(where: { $0.isTemplate && $0.name == opts.template })
    else { return nil }
    world.spawnCounter += 1
    let n = world.spawnCounter
    var traits = tpl.traits
    traits.spawner = nil
    let inst = XRSimWorld.Body(
      key: "spawn:\(n)", name: "\(tpl.name)#\(n)", nodeIndex: tpl.nodeIndex, traits: traits,
      initPos: tpl.initPos, initQuat: tpl.initQuat, center: tpl.center, half: tpl.half)
    inst.spawnedFrom = spawner.key
    let a = world.rng() * .pi * 2
    let r = world.rng().squareRoot() * opts.spawnRadius
    inst.pos = SIMD3(spawner.pos.x + cos(a) * r, spawner.pos.y, spawner.pos.z + sin(a) * r)
    world.addBody(inst)
    return inst
  }

  private static func stepSpawners(_ world: XRSimWorld, _ st: State, _ dt: Double) {
    var total = world.bodies.filter { $0.isInstance }.count
    for s in world.bodies {
      guard let opts = s.traits.spawner, !s.hidden, !s.isTemplate else { continue }
      let sid = ObjectIdentifier(s)
      var sp = st.spawners[sid] ?? (opts.intervalSec, 0)
      sp.timer -= dt
      defer { st.spawners[sid] = sp }
      if sp.timer > 0 { continue }
      sp.timer += opts.intervalSec
      if opts.totalCount > 0 && sp.spawned >= opts.totalCount { continue }
      let active = world.bodies.filter { $0.spawnedFrom == s.key }.count
      if active >= opts.maxActive || total >= XRSimWorld.maxInstances { continue }
      guard let inst = spawnInstance(world, s) else { continue }
      sp.spawned += 1
      total += 1
      world.emit(
        "xrspawn", ["spawnerId": s.name, "instanceId": inst.name, "index": sp.spawned], body: s,
        other: inst)
    }
    let due = st.despawn.filter { world.timeMs >= $0.at }
    st.despawn.removeAll { world.timeMs >= $0.at }
    for d in due { world.removeBody(d.body) }
  }

  static func step(_ world: XRSimWorld, _ dt: Double) {
    let st = state(world)
    let m = mode(world)
    if m == "projectile" || m == "hitscan" {
      if world.fireQueued {
        world.fireQueued = false
        fire(world, m, toward: nil)
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

  static func select(_ world: XRSimWorld, _ body: XRSimWorld.Body?, _ point: SIMD3<Double>?) -> Bool
  {
    let m = mode(world)
    if m == "projectile", let p = point {
      fire(world, m, toward: p)
      return false
    }
    guard m == "hitscan", let body = body, body.traits.integrity != nil else { return false }
    let st = state(world)
    let rate = XRJSON.clampNum(world.fireRate, 0.1, 30, 4)
    if world.timeMs - st.lastFireMs < 1000 / rate { return true }
    st.lastFireMs = world.timeMs
    let src = world.character.flatMap { $0.hidden ? nil : $0 }
    let grp = src.map { group(of: $0, in: world) } ?? "user"
    if canTarget(body, grp, src) {
      applyHit(world, body, XRJSON.clampNum(world.hitAmount, 0, 1e6, 25), source: src, point: point)
    }
    return true
  }

  static func reset(_ world: XRSimWorld) {
    guard let st = world.state[key] as? State else { return }
    for s in st.shots { s.active = false }
    for f in st.frags { f.active = false }
    st.flashes.removeAll()
    st.zones.removeAll()
    st.spawners.removeAll()
    st.despawn.removeAll()
    st.lastFireMs = -.infinity
  }

  // MARK: Visuals

  /// Integrity bar above `body`, facing the head.
  public struct BarVisual {
    public let body: XRSimWorld.Body
    public let center: SIMD3<Double>
    /// Yaw (radians) that faces the bar toward the head.
    public let yaw: Double
    public let width: Double
    /// Remaining integrity fraction (0-1).
    public let frac: Double
    public let color: SIMD4<Float>
  }

  /// Wireframe outline of a colored `zone`.
  public struct ZoneVisual {
    public let body: XRSimWorld.Body
    public let center: SIMD3<Double>
    public let yaw: Double
    public let size: SIMD3<Double>
    public let color: SIMD4<Float>
  }

  /// An active burst fragment and the body whose color it takes.
  public struct FragmentVisual {
    public let pos: SIMD3<Double>
    public let source: XRSimWorld.Body?
  }

  /// What renderers draw this frame (port of `computeSimVisuals` in `hit-zones.ts`).
  public struct Visuals {
    /// Bodies inside their 120 ms hit flash.
    public var flashing: [XRSimWorld.Body] = []
    public var bars: [BarVisual] = []
    /// Active projectile positions.
    public var projectiles: [SIMD3<Double>] = []
    public var fragments: [FragmentVisual] = []
    public var zones: [ZoneVisual] = []
  }

  /// Integrity bar fill color for a remaining fraction.
  public static func barColor(_ frac: Double) -> SIMD4<Float> {
    frac > 0.6
      ? SIMD4(0.13, 0.77, 0.37, 1)
      : frac > 0.3 ? SIMD4(0.92, 0.7, 0.03, 1) : SIMD4(0.94, 0.27, 0.27, 1)
  }

  /// `#rrggbb` (or `#rgb`) to RGBA in 0-1; white when malformed.
  public static func hexToRGBA(_ hex: String, alpha: Float = 1) -> SIMD4<Float> {
    var h = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
    guard let n = UInt32(h, radix: 16) else { return SIMD4(1, 1, 1, alpha) }
    return SIMD4(
      Float((n >> 16) & 255) / 255, Float((n >> 8) & 255) / 255, Float(n & 255) / 255, alpha)
  }

  /// Computes this frame's `Visuals`.
  public static func visuals(_ world: XRSimWorld) -> Visuals {
    var out = Visuals()
    if let st = world.state[key] as? State {
      for f in st.flashes where world.timeMs < f.until && !f.body.hidden {
        out.flashing.append(f.body)
      }
      for p in st.shots where p.active { out.projectiles.append(p.pos) }
      for f in st.frags where f.active {
        out.fragments.append(FragmentVisual(pos: f.pos, source: f.source))
      }
    }
    let head = world.headPosition()
    for b in world.bodies where !b.isTemplate {
      if let zone = b.traits.zone, let color = zone.color, !b.hidden {
        let size =
          zone.shape == "sphere" ? SIMD3(repeating: zone.radius * 2) : zone.size
        out.zones.append(
          ZoneVisual(body: b, center: b.pos, yaw: b.yaw, size: size, color: hexToRGBA(color)))
      }
      guard let iopts = b.traits.integrity, iopts.showBar, !b.hidden, b.integrity > 0 else {
        continue
      }
      let c = b.worldCenter()
      let center = SIMD3(c.x, c.y + b.half.y + 0.12, c.z)
      let frac = Swift.max(0, Swift.min(1, b.integrity / iopts.max))
      out.bars.append(
        BarVisual(
          body: b, center: center, yaw: atan2(head.x - center.x, head.z - center.z),
          width: Swift.max(0.3, Swift.min(1.2, 2 * Swift.max(b.half.x, b.half.z))), frac: frac,
          color: barColor(frac)))
    }
    return out
  }
}
