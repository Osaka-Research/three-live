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

// `rigid-body` for `XRSimWorld` (port of xr-live/src/sim/rigid-body.ts and
// RigidBodyPhysics.kt).

import Foundation
import simd

/// Deterministic 60 Hz Sequential Impulse rigid-body solver for nodes with
/// `rigidBody` or rich `physics` traits (`dynamic`, `static`, `kinematic`).
public enum RigidBodyPhysics {
  public static let gravity = -9.81
  public static let solverIters = 6
  public static let restitutionSlop = 0.25
  public static let collisionSpeedMin = 0.5
  public static let sleepLinearEps = 0.04
  public static let sleepAngularEps = 0.08
  public static let sleepTicks = 30
  private static let key = "rigid-body"
  private static let jointKey = "rigid-body-joint"

  private static let staticCollidableFallback: XRPhysicsBodyTrait = {
    var t = XRPhysicsBodyTrait()
    t.body = "static"
    t.shape = "box"
    t.mass = 0
    t.restitution = 0.25
    t.friction = 0.6
    t.linearDamping = 0
    t.angularDamping = 0
    t.gravityScale = 0
    t.lockRotation = true
    return t
  }()

  final class BodyState {
    var initialized = false
    var angVel = SIMD3<Double>(repeating: 0)
    var sleeping = false
    var sleepTicks = 0
  }

  final class JointState {
    var initialized = false
    var targetLocalAnchor = SIMD3<Double>(repeating: 0)
    var worldAnchor = SIMD3<Double>(repeating: 0)
    var restLen = 0.0
    var angle = 0.0
    var omega = 0.0
    var slidePos = 0.0
    var slideVel = 0.0
    var omegaVec = SIMD3<Double>(repeating: 0)
  }

  private static func quatFromAxisAngle(_ u: SIMD3<Double>, _ rad: Double) -> simd_quatd {
    let half = rad * 0.5
    let s = sin(half)
    return simd_quatd(ix: u.x * s, iy: u.y * s, iz: u.z * s, r: cos(half))
  }

  private static func quatNormalize(_ q: simd_quatd) -> simd_quatd {
    let len = simd_length(q.vector)
    return len > 1e-9
      ? simd_quatd(vector: q.vector / len) : simd_quatd(ix: 0, iy: 0, iz: 0, r: 1)
  }

  private static func bodyQuat(_ b: XRSimWorld.Body) -> simd_quatd {
    let qYaw = simd_quatd(angle: b.yaw, axis: SIMD3(0, 1, 0))
    let idRot = simd_quatd(ix: 0, iy: 0, iz: 0, r: 1)
    return b.rot == idRot ? qYaw : (b.rot * qYaw)
  }

  private struct Contact {
    let a: XRSimWorld.Body
    let b: XRSimWorld.Body?
    let normal: SIMD3<Double>
    let depth: Double
    let restitution: Double
    let friction: Double
    let invMassA: Double
    let invMassB: Double
  }

  private static func bodyState(_ b: XRSimWorld.Body) -> BodyState? {
    b.data[key] as? BodyState
  }

  private static func physicsOpts(_ b: XRSimWorld.Body) -> XRPhysicsBodyTrait? {
    if let rb = b.traits.rigidBody { return rb }
    if b.traits.collidable && b.traits.character == nil && b.traits.agent == nil {
      return staticCollidableFallback
    }
    return nil
  }

  private static func ensureBodyState(
    _ b: XRSimWorld.Body, _ opts: XRPhysicsBodyTrait
  ) -> BodyState {
    if let bs = bodyState(b), bs.initialized { return bs }
    b.vel = opts.velocity
    let bs = BodyState()
    bs.initialized = true
    bs.angVel = opts.angularVelocity
    b.data[key] = bs
    return bs
  }

  /// Resolves `'auto'` collision shape from AABB half-extents.
  public static func resolveShape(_ b: XRSimWorld.Body, _ opts: XRPhysicsBodyTrait) -> String {
    if opts.shape == "sphere" || opts.shape == "box" || opts.shape == "cylinder" {
      return opts.shape
    }
    let maxH = Swift.max(b.half.x, Swift.max(b.half.y, b.half.z))
    let minH = Swift.min(b.half.x, Swift.min(b.half.y, b.half.z))
    if maxH > 1e-4 && maxH - minH <= maxH * 0.05 { return "sphere" }
    return "box"
  }

  private static func sphereRadius(_ b: XRSimWorld.Body) -> Double {
    Swift.max(0.01, Swift.max(b.half.x, Swift.max(b.half.y, b.half.z)))
  }

  private static func verticalHalfExtent(_ b: XRSimWorld.Body, _ opts: XRPhysicsBodyTrait) -> Double
  {
    resolveShape(b, opts) == "sphere" ? sphereRadius(b) : Swift.max(0.01, b.half.y)
  }

  private static func invMass(_ opts: XRPhysicsBodyTrait) -> Double {
    opts.body == "dynamic" && opts.mass > 0 ? 1 / opts.mass : 0
  }

  /// Whether a dynamic rigid body is currently sleeping.
  public static func isSleeping(_ world: XRSimWorld, _ body: XRSimWorld.Body) -> Bool {
    _ = world
    return bodyState(body)?.sleeping == true
  }

  /// Applies a world-space linear impulse (N*s) to a dynamic rigid body or jointed body and wakes it.
  @discardableResult
  public static func applyImpulse(
    _ world: XRSimWorld, _ body: XRSimWorld.Body, _ impulse: SIMD3<Double>
  ) -> Bool {
    _ = world
    let opts = body.traits.rigidBody
    let hasJointOnly = opts == nil && body.traits.joint != nil
    guard (hasJointOnly || opts?.body == "dynamic"), !body.hidden, !body.isTemplate,
      impulse.x.isFinite, impulse.y.isFinite, impulse.z.isFinite
    else { return false }
    var im = 1.0
    if let opts = opts {
      let bs = ensureBodyState(body, opts)
      bs.sleeping = false
      bs.sleepTicks = 0
      im = invMass(opts)
    }
    body.vel = SIMD3(
      Swift.max(-200, Swift.min(200, body.vel.x + impulse.x * im)),
      Swift.max(-200, Swift.min(200, body.vel.y + impulse.y * im)),
      Swift.max(-200, Swift.min(200, body.vel.z + impulse.z * im)))
    return true
  }

  private static func collidePair(
    _ a: XRSimWorld.Body, _ optsA: XRPhysicsBodyTrait, _ b: XRSimWorld.Body,
    _ optsB: XRPhysicsBodyTrait
  ) -> (normal: SIMD3<Double>, depth: Double)? {
    let shapeA = resolveShape(a, optsA)
    let shapeB = resolveShape(b, optsB)
    let ca = a.worldCenter()
    let cb = b.worldCenter()
    if shapeA == "sphere" && shapeB == "sphere" {
      let rSum = sphereRadius(a) + sphereRadius(b)
      let d = cb - ca
      let dist = simd_length(d)
      if dist >= rSum { return nil }
      let normal = dist > 1e-9 ? d / dist : SIMD3<Double>(0, 1, 0)
      return (normal, rSum - dist)
    }
    let ha =
      shapeA == "sphere"
      ? SIMD3<Double>(repeating: sphereRadius(a))
      : SIMD3(Swift.max(0.01, a.half.x), Swift.max(0.01, a.half.y), Swift.max(0.01, a.half.z))
    let hb =
      shapeB == "sphere"
      ? SIMD3<Double>(repeating: sphereRadius(b))
      : SIMD3(Swift.max(0.01, b.half.x), Swift.max(0.01, b.half.y), Swift.max(0.01, b.half.z))
    let d = cb - ca
    let ox = ha.x + hb.x - abs(d.x)
    let oy = ha.y + hb.y - abs(d.y)
    let oz = ha.z + hb.z - abs(d.z)
    if ox <= 0 || oy <= 0 || oz <= 0 { return nil }
    if oy <= ox && oy <= oz {
      return (SIMD3(0, d.y >= 0 ? 1 : -1, 0), oy)
    }
    if ox <= oz {
      return (SIMD3(d.x >= 0 ? 1 : -1, 0, 0), ox)
    }
    return (SIMD3(0, 0, d.z >= 0 ? 1 : -1), oz)
  }

  private static func stepCharacterPush(_ world: XRSimWorld) {
    guard let ch = world.character, let chOpts = ch.traits.character, !ch.hidden else { return }
    let chFoot = ch.pos.y + (ch.half.y > 0 ? ch.center.y - ch.half.y : 0)
    let chTop = chFoot + chOpts.height
    for b in world.bodies {
      guard let opts = b.traits.rigidBody, opts.body == "dynamic", !b.hidden, !b.isTemplate,
        b !== ch
      else { continue }
      let box = b.aabb()
      if box.max.y <= chFoot + 0.05 || box.min.y >= chTop { continue }
      guard let pushed = XRSimWorld.pushCircleOutOfAABB(ch.pos, chOpts.radius, box.min, box.max)
      else { continue }
      let dx = ch.pos.x - pushed.x
      let dz = ch.pos.z - pushed.y
      let dLen = (dx * dx + dz * dz).squareRoot()
      if dLen <= 1e-6 { continue }
      let bs = ensureBodyState(b, opts)
      bs.sleeping = false
      bs.sleepTicks = 0
      b.pos = SIMD3(b.pos.x + dx, b.pos.y, b.pos.z + dz)
      let nx = dx / dLen
      let nz = dz / dLen
      let chSpeed = (ch.vel.x * ch.vel.x + ch.vel.z * ch.vel.z).squareRoot()
      let pushSpeed = Swift.max(chSpeed, 1.5) / Swift.max(0.5, opts.mass * 0.5)
      let vn = b.vel.x * nx + b.vel.z * nz
      if vn < pushSpeed {
        b.vel = SIMD3(b.vel.x + (pushSpeed - vn) * nx, b.vel.y, b.vel.z + (pushSpeed - vn) * nz)
      }
    }
  }

  private static func stepJoints(_ world: XRSimWorld, _ dt: Double) {
    for b in world.bodies {
      if b.hidden || b.isTemplate { continue }
      guard let jt = b.traits.joint else { continue }
      let tb =
        jt.target.isEmpty
        ? nil
        : world.bodies.first { !$0.hidden && !$0.isTemplate && $0 !== b && $0.name == jt.target }

      let js: JointState
      if let existing = b.data[jointKey] as? JointState, existing.initialized {
        js = existing
      } else {
        let s = JointState()
        let pivot0 = b.initPos + jt.anchor
        var d0 = 0.0
        if let tb = tb {
          if jt.type == "spring" {
            d0 = simd_length(pivot0 - tb.initPos)
          } else {
            s.targetLocalAnchor = pivot0 - tb.initPos
          }
        } else if jt.type == "spring" {
          d0 = simd_length(jt.anchor)
        }
        s.initialized = true
        s.worldAnchor = pivot0
        s.restLen = jt.restLength > 0 ? jt.restLength : d0
        b.data[jointKey] = s
        js = s
      }

      let rbOpts = b.traits.rigidBody
      let hasDynRb = rbOpts?.body == "dynamic"
      let mass = (hasDynRb && (rbOpts?.mass ?? 0) > 0) ? rbOpts!.mass : 1.0
      let gScale = rbOpts != nil ? (hasDynRb ? rbOpts!.gravityScale : 0.0) : 1.0

      var worldPivot = js.worldAnchor
      var targetVel = SIMD3<Double>(repeating: 0)
      if let tb = tb {
        worldPivot = tb.pos + bodyQuat(tb).act(js.targetLocalAnchor)
        targetVel = tb.vel
      }

      switch jt.type {
      case "hinge":
        let u = jt.axis
        let r0 = -jt.anchor
        let qPrev = quatFromAxisAngle(u, js.angle)
        let rPrev = qPrev.act(r0)
        let rPerp = rPrev - u * simd_dot(u, rPrev)
        let rPerp2 = simd_length_squared(rPerp)
        let inertia = Swift.max(0.05, mass * Swift.max(rPerp2, 0.25))
        let wxRPrev = simd_cross(u, rPrev)
        let dv = b.vel - (targetVel + wxRPrev * js.omega)
        var omega = js.omega
        if rPerp2 > 1e-6 {
          omega += simd_dot(simd_cross(rPrev, dv), u) / rPerp2
        }
        let tauG =
          hasDynRb ? 0.0 : simd_dot(simd_cross(rPrev, SIMD3(0, mass * gravity * gScale, 0)), u)
        let denom = inertia + jt.damping * dt + jt.stiffness * dt * dt
        omega = (inertia * omega + (tauG - jt.stiffness * js.angle) * dt) / denom
        if jt.motorMaxForce > 0 {
          let maxDw = (jt.motorMaxForce / inertia) * dt
          omega += Swift.max(-maxDw, Swift.min(maxDw, jt.motorSpeed - omega))
        }
        omega = Swift.max(-50, Swift.min(50, omega))
        var angle = js.angle + omega * dt
        if let lim = jt.limits {
          let minRad = lim.x * .pi / 180.0
          let maxRad = lim.y * .pi / 180.0
          if angle < minRad {
            angle = minRad
            if omega < 0 { omega = 0 }
          } else if angle > maxRad {
            angle = maxRad
            if omega > 0 { omega = 0 }
          }
        }
        js.angle = angle
        js.omega = omega
        let qHinge = quatFromAxisAngle(u, angle)
        if abs(u.y) > 0.9999 {
          b.yaw = XRSimWorld.wrapAngle(angle * (u.y >= 0 ? 1 : -1))
          b.rot = simd_quatd(ix: 0, iy: 0, iz: 0, r: 1)
        } else {
          b.yaw = 0
          b.rot = qHinge
        }
        let rNew = qHinge.act(r0)
        b.pos = worldPivot + rNew
        b.vel = targetVel + simd_cross(u, rNew) * omega
        if let bs = bodyState(b), abs(omega) > sleepAngularEps {
          bs.sleeping = false
          bs.sleepTicks = 0
        }
      case "slider":
        let u = jt.axis
        let origin = worldPivot - jt.anchor
        let dv = b.vel - (targetVel + u * js.slideVel)
        var v = js.slideVel + simd_dot(dv, u)
        let fGrav = hasDynRb ? 0.0 : mass * gravity * gScale * u.y
        let denom = mass + jt.damping * dt + jt.stiffness * dt * dt
        v = (mass * v + (fGrav - jt.stiffness * js.slidePos) * dt) / denom
        if jt.motorMaxForce > 0 {
          let maxDv = (jt.motorMaxForce / mass) * dt
          v += Swift.max(-maxDv, Swift.min(maxDv, jt.motorSpeed - v))
        }
        v = Swift.max(-200, Swift.min(200, v))
        var s = js.slidePos + v * dt
        if let lim = jt.limits {
          if s < lim.x {
            s = lim.x
            if v < 0 { v = 0 }
          } else if s > lim.y {
            s = lim.y
            if v > 0 { v = 0 }
          }
        }
        js.slidePos = s
        js.slideVel = v
        b.pos = origin + u * s
        b.vel = targetVel + u * v
        if let bs = bodyState(b), abs(v) > sleepLinearEps {
          bs.sleeping = false
          bs.sleepTicks = 0
        }
      case "spring":
        if rbOpts == nil {
          b.vel.y += gravity * gScale * dt
        }
        let pB = tb?.pos ?? js.worldAnchor
        let offA = tb != nil ? bodyQuat(b).act(jt.anchor) : .zero
        let pA = b.pos + offA
        let d = pA - pB
        let dist = simd_length(d)
        let dir = dist > 1e-6 ? d / dist : jt.axis
        let stretch = dist - js.restLen
        let invM1 = 1.0 / mass
        let invM2 =
          (tb?.traits.rigidBody?.body == "dynamic" && (tb?.traits.rigidBody?.mass ?? 0) > 0)
          ? (1.0 / tb!.traits.rigidBody!.mass) : 0.0
        let effMass = 1.0 / (invM1 + invM2)
        let vRel = simd_dot(b.vel - targetVel, dir)
        let denom = effMass + jt.damping * dt + jt.stiffness * dt * dt
        let vRelNew = (effMass * vRel - jt.stiffness * stretch * dt) / denom
        let jImp = (vRelNew - vRel) * effMass
        let dv1 = jImp * invM1
        let vNext = b.vel + dir * dv1
        b.vel = SIMD3(
          Swift.max(-200, Swift.min(200, vNext.x)),
          Swift.max(-200, Swift.min(200, vNext.y)),
          Swift.max(-200, Swift.min(200, vNext.z)))
        if rbOpts == nil {
          let latDamp = Swift.max(0.0, 1.0 - Swift.min(jt.damping * 0.05, 5.0) * dt)
          let vnAfter = simd_dot(b.vel, dir)
          b.vel = dir * vnAfter + (b.vel - dir * vnAfter) * latDamp
          b.pos += b.vel * dt
        } else if hasDynRb {
          b.pos += dir * (dv1 * dt)
        }
        if let tb = tb, invM2 > 0 {
          let dv2 = -jImp * invM2
          let tvNext = tb.vel + dir * dv2
          tb.vel = SIMD3(
            Swift.max(-200, Swift.min(200, tvNext.x)),
            Swift.max(-200, Swift.min(200, tvNext.y)),
            Swift.max(-200, Swift.min(200, tvNext.z)))
          tb.pos += dir * (dv2 * dt)
          if let tbs = bodyState(tb), abs(dv2) > 1e-4 {
            tbs.sleeping = false
            tbs.sleepTicks = 0
          }
        }
        if let lim = jt.limits {
          let pB2 = tb?.pos ?? js.worldAnchor
          let offA2 = tb != nil ? bodyQuat(b).act(jt.anchor) : .zero
          let dVec = (b.pos + offA2) - pB2
          let d2 = simd_length(dVec)
          let clamped = Swift.max(lim.x, Swift.min(lim.y, d2))
          if abs(clamped - d2) > 1e-6 {
            let n = d2 > 1e-6 ? dVec / d2 : jt.axis
            let corr = (clamped - d2) / (invM1 + invM2)
            b.pos += n * (corr * invM1)
            if let tb = tb, invM2 > 0 {
              tb.pos -= n * (corr * invM2)
            }
            let rv = simd_dot(b.vel - (tb?.vel ?? .zero), n)
            if (d2 > lim.y && rv > 0) || (d2 < lim.x && rv < 0) {
              let jLim = -rv / (invM1 + invM2)
              b.vel += n * (jLim * invM1)
              if let tb = tb, invM2 > 0 {
                tb.vel -= n * (jLim * invM2)
              }
            }
          }
        }
        if let bs = bodyState(b), simd_length(b.vel) > sleepLinearEps {
          bs.sleeping = false
          bs.sleepTicks = 0
        }
      case "ball":
        let r0 = -jt.anchor
        let armLen2 = simd_length_squared(r0)
        let rPrev = b.rot.act(r0)
        let inertia = Swift.max(0.05, mass * Swift.max(armLen2, 0.25))
        var w = js.omegaVec
        if armLen2 > 1e-8 {
          let dv = b.vel - (targetVel + simd_cross(w, rPrev))
          w += simd_cross(rPrev, dv) / armLen2
        }
        let fg = hasDynRb ? 0.0 : mass * gravity * gScale
        let tauG = SIMD3(-rPrev.z * fg, 0, rPrev.x * fg)
        let qPos = b.rot.real < 0 ? simd_quatd(vector: -b.rot.vector) : b.rot
        let sinHalf = simd_length(qPos.imag)
        let swingAngle = 2.0 * atan2(sinHalf, Swift.max(0.0, Swift.min(1.0, qPos.real)))
        let swingAxis = sinHalf > 1e-7 ? qPos.imag / sinHalf : SIMD3(0, 1, 0)
        let denom = inertia + jt.damping * dt + jt.stiffness * dt * dt
        w = (inertia * w + (tauG - jt.stiffness * swingAngle * swingAxis) * dt) / denom
        let wMag = simd_length(w)
        if wMag > 50 {
          w *= 50.0 / wMag
        }
        let wStep = simd_length(w)
        if wStep > 1e-8 {
          let dq = quatFromAxisAngle(w / wStep, wStep * dt)
          b.rot = quatNormalize(dq * b.rot)
        }
        if let lim = jt.limits {
          let maxRad = Swift.max(abs(lim.x), abs(lim.y)) * .pi / 180.0
          let qC = b.rot.real < 0 ? simd_quatd(vector: -b.rot.vector) : b.rot
          let sH = simd_length(qC.imag)
          let ang = 2.0 * atan2(sH, Swift.max(0.0, Swift.min(1.0, qC.real)))
          if ang > maxRad && sH > 1e-7 {
            let ax = qC.imag / sH
            b.rot = quatFromAxisAngle(ax, maxRad)
            let wOut = simd_dot(w, ax)
            if wOut > 0 { w -= ax * wOut }
          }
        }
        js.omegaVec = w
        let rNew = b.rot.act(r0)
        b.pos = worldPivot + rNew
        b.vel = targetVel + simd_cross(w, rNew)
        if let bs = bodyState(b), simd_length(w) > sleepAngularEps {
          bs.sleeping = false
          bs.sleepTicks = 0
        }
      default:
        break
      }
    }
  }

  static func step(_ world: XRSimWorld, _ dt: Double) {
    if !world.rigidBodyEnabled { return }
    let hasActive = world.bodies.contains {
      !$0.hidden && !$0.isTemplate
        && ($0.traits.joint != nil || $0.traits.rigidBody?.body == "dynamic"
          || $0.traits.rigidBody?.body == "kinematic")
    }
    if !hasActive { return }

    let groundY = Swift.min(0, world.floorY)

    // 1. Symplectic Euler integration.
    for b in world.bodies {
      if b.hidden || b.isTemplate { continue }
      guard let opts = b.traits.rigidBody else { continue }
      let bs = ensureBodyState(b, opts)
      if opts.body == "kinematic" {
        b.pos += b.vel * dt
        if !opts.lockRotation && bs.angVel.y != 0 {
          b.yaw = XRSimWorld.wrapAngle(b.yaw + bs.angVel.y * dt)
        }
        continue
      }
      if opts.body != "dynamic" || bs.sleeping { continue }
      let dampL = Swift.max(0, 1 - opts.linearDamping * dt)
      let dampA = Swift.max(0, 1 - opts.angularDamping * dt)
      let vx = b.vel.x * dampL
      let vy = (b.vel.y + gravity * opts.gravityScale * dt) * dampL
      let vz = b.vel.z * dampL
      b.vel = SIMD3(
        Swift.max(-200, Swift.min(200, vx)),
        Swift.max(-200, Swift.min(200, vy)),
        Swift.max(-200, Swift.min(200, vz)))
      bs.angVel *= dampA
      b.pos += b.vel * dt
      if !opts.lockRotation && bs.angVel.y != 0 {
        b.yaw = XRSimWorld.wrapAngle(b.yaw + bs.angVel.y * dt)
      }
    }

    // 2. Character push coupling.
    stepCharacterPush(world)

    // 3. Narrowphase contacts.
    var contacts: [Contact] = []
    for b in world.bodies {
      if b.hidden || b.isTemplate { continue }
      guard let opts = b.traits.rigidBody, opts.body == "dynamic" else { continue }
      let hy = verticalHalfExtent(b, opts)
      let bottomY = b.pos.y + b.center.y - hy
      if bottomY < groundY {
        contacts.append(
          Contact(
            a: b, b: nil, normal: SIMD3(0, -1, 0), depth: groundY - bottomY,
            restitution: opts.restitution, friction: opts.friction,
            invMassA: invMass(opts), invMassB: 0))
      }
    }

    let nBodies = world.bodies.count
    for i in 0..<nBodies {
      let a = world.bodies[i]
      if a.hidden || a.isTemplate || a === world.character { continue }
      guard let optsA = physicsOpts(a) else { continue }
      let invA = invMass(optsA)
      let bsA = ensureBodyState(a, optsA)
      for j in (i + 1)..<nBodies {
        let b = world.bodies[j]
        if b.hidden || b.isTemplate || b === world.character { continue }
        guard let optsB = physicsOpts(b) else { continue }
        let invB = invMass(optsB)
        if invA == 0 && invB == 0 { continue }
        let bsB = ensureBodyState(b, optsB)
        if bsA.sleeping && bsB.sleeping { continue }
        guard let hit = collidePair(a, optsA, b, optsB) else { continue }
        let relSpeed = simd_length(b.vel - a.vel)
        if relSpeed > sleepLinearEps {
          if invA > 0 {
            bsA.sleeping = false
            bsA.sleepTicks = 0
          }
          if invB > 0 {
            bsB.sleeping = false
            bsB.sleepTicks = 0
          }
        }
        contacts.append(
          Contact(
            a: a, b: b, normal: hit.normal, depth: hit.depth,
            restitution: Swift.max(optsA.restitution, optsB.restitution),
            friction: (optsA.friction * optsB.friction).squareRoot(),
            invMassA: invA, invMassB: invB))
      }
    }

    for c in contacts {
      let vB = c.b?.vel ?? .zero
      let vn = simd_dot(vB - c.a.vel, c.normal)
      let impactSpeed = -vn
      if impactSpeed >= collisionSpeedMin {
        world.emit(
          "xrcollision",
          [
            "nodeId": c.a.name,
            "otherId": c.b?.name ?? "ground",
            "speed": (impactSpeed * 1000).rounded() / 1000,
            "normal": [-c.normal.x, -c.normal.y, -c.normal.z],
          ],
          body: c.a, other: c.b)
      }
    }

    // 4. Sequential Impulse velocity solver.
    for iter in 0..<solverIters {
      for c in contacts {
        let invSum = c.invMassA + c.invMassB
        if invSum <= 0 { continue }
        let vB = c.b?.vel ?? .zero
        let rv = vB - c.a.vel
        let vn = simd_dot(rv, c.normal)
        if vn >= 0 { continue }
        let e = iter == 0 && -vn > restitutionSlop ? c.restitution : 0
        let j = (-(1 + e) * vn) / invSum
        let imp = c.normal * j
        if c.invMassA > 0 { c.a.vel -= imp * c.invMassA }
        if let b = c.b, c.invMassB > 0 { b.vel += imp * c.invMassB }
        let tv = rv - c.normal * vn
        let tLen = simd_length(tv)
        if tLen > 1e-7 {
          let t = tv / tLen
          let maxJt = j * c.friction
          let jt = Swift.max(-maxJt, Swift.min(maxJt, -tLen / invSum))
          let fImp = t * jt
          if c.invMassA > 0 { c.a.vel -= fImp * c.invMassA }
          if let b = c.b, c.invMassB > 0 { b.vel += fImp * c.invMassB }
        }
      }
    }

    // 5. Split-impulse positional projection.
    for _ in 0..<solverIters {
      for b in world.bodies {
        if b.hidden || b.isTemplate { continue }
        guard let opts = b.traits.rigidBody, opts.body == "dynamic" else { continue }
        let hy = verticalHalfExtent(b, opts)
        let bottomY = b.pos.y + b.center.y - hy
        if bottomY < groundY {
          b.pos.y += groundY - bottomY
          if abs(b.vel.y) < 1e-4 { b.vel.y = 0 }
        }
      }
      for i in 0..<nBodies {
        let a = world.bodies[i]
        if a.hidden || a.isTemplate || a === world.character { continue }
        guard let optsA = physicsOpts(a) else { continue }
        let invA = invMass(optsA)
        let bsA = bodyState(a)
        for j in (i + 1)..<nBodies {
          let b = world.bodies[j]
          if b.hidden || b.isTemplate || b === world.character { continue }
          guard let optsB = physicsOpts(b) else { continue }
          let invB = invMass(optsB)
          let invSum = invA + invB
          if invSum <= 0 { continue }
          let bsB = bodyState(b)
          if bsA?.sleeping == true && bsB?.sleeping == true { continue }
          guard let hit = collidePair(a, optsA, b, optsB), hit.depth > 1e-5 else { continue }
          let corr = hit.depth / invSum
          if invA > 0 { a.pos -= hit.normal * (corr * invA) }
          if invB > 0 { b.pos += hit.normal * (corr * invB) }
        }
      }
    }

    for b in world.bodies {
      if b.hidden || b.isTemplate { continue }
      guard let opts = b.traits.rigidBody, opts.body == "dynamic" else { continue }
      let hy = verticalHalfExtent(b, opts)
      let bottomY = b.pos.y + b.center.y - hy
      if bottomY < groundY {
        b.pos.y += groundY - bottomY
        if b.vel.y < 0 { b.vel.y = 0 }
      }
    }

    // 5b. Mechanical joint constraints (`hinge`, `slider`, `spring`, `ball`).
    stepJoints(world, dt)

    // 6. Sleep threshold counter.
    for b in world.bodies {
      if b.hidden || b.isTemplate { continue }
      guard let opts = b.traits.rigidBody, opts.body == "dynamic" else { continue }
      let bs = ensureBodyState(b, opts)
      if bs.sleeping { continue }
      let linSpeed = simd_length(b.vel)
      let angSpeed = simd_length(bs.angVel)
      if linSpeed < sleepLinearEps && angSpeed < sleepAngularEps {
        bs.sleepTicks += 1
        if bs.sleepTicks >= sleepTicks {
          bs.sleeping = true
          b.vel = .zero
          bs.angVel = .zero
          world.emit(
            "xrsleep",
            ["nodeId": b.name, "position": [b.pos.x, b.pos.y, b.pos.z]],
            body: b)
        }
      } else {
        bs.sleepTicks = 0
      }
    }
  }

  static func reset(_ world: XRSimWorld) {
    for b in world.bodies {
      b.data.removeValue(forKey: key)
      b.data.removeValue(forKey: jointKey)
    }
    world.state.removeValue(forKey: key)
  }
}
