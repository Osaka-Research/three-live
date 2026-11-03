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

// `character-controller` for `XRSimWorld` (port of
// xr-live/src/sim/character-controller.ts and CharacterController.kt).

import Foundation

/// Moves the first `character` node from `XRSimWorld.moveX` / `moveZ` relative to the
/// camera heading, with jump, gravity, sliding along `collidable` nodes, and standing on
/// their tops. Hosts follow `cameraRig(_:)` and play `simCharacterClip` clips.
public enum CharacterController {
  public static let accel = 12.0
  public static let turnSpeed = 12.0
  public static let stepHeight = 0.05
  private static let key = "character-controller"

  final class State {
    let body: XRSimWorld.Body
    var grounded = true
    var vy = 0.0
    var clip: String?
    init(_ body: XRSimWorld.Body) { self.body = body }
  }

  /// Effective options after host overrides, or `nil` when disabled.
  public static func resolve(_ world: XRSimWorld, _ base: XRCharacterTrait) -> XRCharacterTrait? {
    let mode = world.characterMode?.trimmingCharacters(in: .whitespaces).lowercased()
    if mode == "none" || mode == "false" { return nil }
    var t = base
    switch mode {
    case "fixed-camera", "fixed": t.cameraMode = "fixed"
    case "first-person", "top-down", "third-person": t.cameraMode = mode!
    default: break
    }
    t.speed = XRJSON.clampNum(world.characterSpeed, 0.1, 20, base.speed)
    t.jumpVelocity = XRJSON.clampNum(world.characterJump, 0, 30, base.jumpVelocity)
    return t
  }

  /// Animation state for a horizontal speed.
  public static func clipState(speed: Double, maxSpeed: Double, grounded: Bool) -> String {
    if !grounded { return "jump" }
    if speed < 0.05 { return "idle" }
    return speed < 0.7 * maxSpeed ? "walk" : "run"
  }

  private static func feetOffset(_ b: XRSimWorld.Body) -> Double {
    b.half.y > 0 ? b.center.y - b.half.y : 0
  }

  /// Fallback floor: the scene's lowest point when platforms exist, else the spawn height.
  public static func floor(_ world: XRSimWorld, _ b: XRSimWorld.Body) -> Double {
    let platforms = world.bodies.contains { $0 !== b && $0.traits.collidable && !$0.isTemplate }
    let spawnFeet = b.initPos.y + feetOffset(b)
    return platforms ? Swift.min(world.floorY, spawnFeet) : spawnFeet
  }

  /// Camera framing for the controlled character (port of `characterCameraRig` in
  /// `character-controller.ts`): follow `target` every frame and apply `phiDeg` (polar
  /// angle, 0 = straight down) and `distance` when `mode` changes.
  public struct CameraRig: Equatable, Sendable {
    public let mode: String
    public let target: SIMD3<Double>
    public let phiDeg: Double
    public let distance: Double
  }

  /// The camera rig, or `nil` when there is no visible character, the camera is `fixed`, or
  /// an XR session drives the camera.
  public static func cameraRig(_ world: XRSimWorld) -> CameraRig? {
    guard let st = world.state[key] as? State, let base = st.body.traits.character,
      !st.body.hidden, !world.xrActive, let opts = resolve(world, base),
      opts.cameraMode != "fixed"
    else { return nil }
    let b = st.body
    let feet = b.pos.y + feetOffset(b)
    let mode = opts.cameraMode
    let fp = mode == "first-person"
    let target = SIMD3(b.pos.x, feet + opts.height * (fp ? 0.9 : 0.6), b.pos.z)
    switch mode {
    case "first-person":
      return CameraRig(mode: mode, target: target, phiDeg: 90, distance: 0.05)
    case "top-down":
      return CameraRig(
        mode: mode, target: target, phiDeg: 1,
        distance: (opts.cameraDistance * opts.cameraDistance + opts.cameraHeight * opts.cameraHeight)
          .squareRoot())
    default:
      let h = Swift.max(0.01, opts.cameraHeight)
      return CameraRig(
        mode: mode, target: target, phiDeg: atan2(opts.cameraDistance, h) * 180 / .pi,
        distance: (opts.cameraDistance * opts.cameraDistance + h * h).squareRoot())
    }
  }

  /// Camera target for hosts that follow the character (see `cameraRig(_:)`).
  public static func cameraTarget(_ world: XRSimWorld) -> SIMD3<Double>? {
    cameraRig(world)?.target
  }

  static func stepCharacter(
    _ world: XRSimWorld, _ st: State, _ opts: XRCharacterTrait, moveX: Double, moveZ: Double,
    sprint: Bool, jump: Bool, dt: Double
  ) {
    let b = st.body
    let len = Swift.min(1, (moveX * moveX + moveZ * moveZ).squareRoot())
    let target = opts.speed * (sprint ? opts.runMultiplier : 1) * len
    let dx = len > 1e-6 ? moveX / len : 0
    let dz = len > 1e-6 ? moveZ / len : 0
    let k = Swift.min(1, dt * accel)
    b.vel.x += (dx * target - b.vel.x) * k
    b.vel.z += (dz * target - b.vel.z) * k
    if len > 0.05 {
      b.yaw = XRSimWorld.turnToward(b.yaw, XRSimWorld.yawFromDir(dx, dz), turnSpeed * dt)
    }
    if jump && st.grounded && opts.jumpVelocity > 0 {
      st.vy = opts.jumpVelocity
      st.grounded = false
      world.emit(
        "characterjump", ["nodeId": b.name, "position": [b.pos.x, b.pos.y, b.pos.z]], body: b)
    }
    st.vy -= opts.gravity * dt
    var next = SIMD3(b.pos.x + b.vel.x * dt, b.pos.y + st.vy * dt, b.pos.z + b.vel.z * dt)
    let foot = feetOffset(b)
    var feet = next.y + foot
    var ground = floor(world, b)
    for o in world.bodies {
      if o === b || o.hidden || o.isTemplate || !o.traits.collidable { continue }
      let box = o.aabb()
      let top = box.max.y
      if top <= feet + stepHeight + Swift.max(0, -st.vy * dt) {
        let cx = Swift.max(box.min.x, Swift.min(box.max.x, next.x))
        let cz = Swift.max(box.min.z, Swift.min(box.max.z, next.z))
        let dxz = ((next.x - cx) * (next.x - cx) + (next.z - cz) * (next.z - cz)).squareRoot()
        if dxz < opts.radius * 0.7 { ground = Swift.max(ground, top) }
        continue
      }
      if box.min.y >= feet + opts.height { continue }
      if let pushed = XRSimWorld.pushCircleOutOfAABB(next, opts.radius, box.min, box.max) {
        next.x = pushed.x
        next.z = pushed.y
      }
    }
    if feet <= ground {
      if !st.grounded && st.vy < 0 {
        world.emit(
          "characterland",
          [
            "nodeId": b.name, "position": [next.x, ground - foot, next.z],
            "fallSpeed": (-st.vy * 1000).rounded() / 1000,
          ], body: b)
      }
      feet = ground
      st.vy = 0
      st.grounded = true
    } else if feet > ground + 0.01 {
      st.grounded = false
    }
    b.pos = SIMD3(next.x, feet - foot, next.z)
  }

  static func step(_ world: XRSimWorld, _ dt: Double) {
    var st = world.state[key] as? State
    if st == nil || !world.bodies.contains(where: { $0 === st!.body }) {
      world.character = nil
      guard let body = world.active().first(where: { $0.traits.character != nil && !$0.isInstance })
      else { return }
      st = State(body)
      world.state[key] = st
    }
    guard let st = st, let base = st.body.traits.character else { return }
    guard let opts = resolve(world, base), !st.body.hidden else {
      world.character = resolve(world, base) != nil ? st.body : nil
      return
    }
    world.character = st.body
    st.body.viewHidden = opts.cameraMode == "first-person" && !world.xrActive
    let fwd = world.cameraForwardXZ()
    var x = world.moveX.isFinite ? world.moveX : 0
    var z = world.moveZ.isFinite ? world.moveZ : 0
    let l = (x * x + z * z).squareRoot()
    if l > 1 {
      x /= l
      z /= l
    }
    let mx = -fwd.z * x + fwd.x * z
    let mz = fwd.x * x + fwd.z * z
    let jump = world.jumpQueued
    world.jumpQueued = false
    stepCharacter(world, st, opts, moveX: mx, moveZ: mz, sprint: world.sprint, jump: jump, dt: dt)
    let speed = (st.body.vel.x * st.body.vel.x + st.body.vel.z * st.body.vel.z).squareRoot()
    let clip = clipState(
      speed: speed, maxSpeed: opts.speed * opts.runMultiplier, grounded: st.grounded)
    if clip != st.clip {
      st.clip = clip
      if let name = opts.clips[clip] { world.delegate?.simCharacterClip(name) }
    }
  }

  static func reset(_ world: XRSimWorld) {
    guard let st = world.state[key] as? State else { return }
    st.grounded = true
    st.vy = 0
    st.clip = nil
  }
}
