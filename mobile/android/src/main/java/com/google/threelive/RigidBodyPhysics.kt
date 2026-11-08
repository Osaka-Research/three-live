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
 * `rigid-body` for [XRSimWorld] (port of `xr-live/src/sim/rigid-body.ts`).
 *
 * Deterministic 60 Hz Sequential Impulse rigid-body solver for nodes with `rigidBody` or rich
 * `physics` traits (`dynamic`, `static`, `kinematic`).
 */
object RigidBodyPhysics {
  const val GRAVITY: Double = -9.81
  const val SOLVER_ITERS: Int = 6
  const val RESTITUTION_SLOP: Double = 0.25
  const val COLLISION_SPEED_MIN: Double = 0.5
  const val SLEEP_LINEAR_EPS: Double = 0.04
  const val SLEEP_ANGULAR_EPS: Double = 0.08
  const val SLEEP_TICKS: Int = 30
  private const val KEY = "rigid-body"
  private const val JOINT_KEY = "rigid-body-joint"

  private val STATIC_COLLIDABLE_FALLBACK =
    XRPhysicsBodyTrait(
      body = "static",
      shape = "box",
      mass = 0.0,
      restitution = 0.25,
      friction = 0.6,
      linearDamping = 0.0,
      angularDamping = 0.0,
      gravityScale = 0.0,
      lockRotation = true,
    )

  internal class BodyState(
    var initialized: Boolean = false,
    var angVel: DoubleArray = DoubleArray(3),
    var sleeping: Boolean = false,
    var sleepTicks: Int = 0,
  )

  internal class JointState(
    var initialized: Boolean = false,
    var targetLocalAnchor: DoubleArray = DoubleArray(3),
    var worldAnchor: DoubleArray = DoubleArray(3),
    var restLen: Double = 0.0,
    var angle: Double = 0.0,
    var omega: Double = 0.0,
    var slidePos: Double = 0.0,
    var slideVel: Double = 0.0,
    var omegaVec: DoubleArray = DoubleArray(3),
  )

  private fun quatNormalize4(q: DoubleArray): DoubleArray {
    val len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    return if (len > 1e-9) doubleArrayOf(q[0] / len, q[1] / len, q[2] / len, q[3] / len)
    else doubleArrayOf(0.0, 0.0, 0.0, 1.0)
  }

  private fun quatFromAxisAngle4(u: DoubleArray, rad: Double): DoubleArray {
    val half = rad * 0.5
    val s = Math.sin(half)
    return doubleArrayOf(u[0] * s, u[1] * s, u[2] * s, Math.cos(half))
  }

  private fun quatRotateVec(q: DoubleArray, v: DoubleArray): DoubleArray {
    val tx = 2.0 * (q[1] * v[2] - q[2] * v[1])
    val ty = 2.0 * (q[2] * v[0] - q[0] * v[2])
    val tz = 2.0 * (q[0] * v[1] - q[1] * v[0])
    return doubleArrayOf(
      v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
      v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
      v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    )
  }

  private fun bodyQuat(b: XRSimWorld.Body): DoubleArray {
    val qYaw = XRSpatialMath.quatFromYaw(b.yaw)
    val r = b.rot
    if (r[0] == 0.0 && r[1] == 0.0 && r[2] == 0.0 && r[3] == 1.0) return qYaw
    return XRSpatialMath.quatMultiply(r, qYaw)
  }

  private fun cross3(a: DoubleArray, b: DoubleArray): DoubleArray =
    doubleArrayOf(
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    )

  private fun dot3(a: DoubleArray, b: DoubleArray): Double =
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  private fun hypot3(x: Double, y: Double, z: Double): Double = Math.sqrt(x * x + y * y + z * z)

  private class Contact(
    val a: XRSimWorld.Body,
    val b: XRSimWorld.Body?,
    val normal: DoubleArray,
    val depth: Double,
    val restitution: Double,
    val friction: Double,
    val invMassA: Double,
    val invMassB: Double,
  )

  private fun bodyState(b: XRSimWorld.Body): BodyState? = b.data[KEY] as? BodyState

  private fun physicsOpts(b: XRSimWorld.Body): XRPhysicsBodyTrait? {
    b.traits.rigidBody?.let {
      return it
    }
    if (b.traits.collidable && b.traits.character == null && b.traits.agent == null) {
      return STATIC_COLLIDABLE_FALLBACK
    }
    return null
  }

  private fun ensureBodyState(b: XRSimWorld.Body, opts: XRPhysicsBodyTrait): BodyState {
    var bs = bodyState(b)
    if (bs == null || !bs.initialized) {
      b.vel = opts.velocity.copyOf()
      bs =
        BodyState(
          initialized = true,
          angVel = opts.angularVelocity.copyOf(),
          sleeping = false,
          sleepTicks = 0,
        )
      b.data[KEY] = bs
    }
    return bs
  }

  /** Resolves `'auto'` collision shape from AABB half-extents. */
  @JvmStatic
  fun resolveShape(b: XRSimWorld.Body, opts: XRPhysicsBodyTrait): String {
    if (opts.shape == "sphere" || opts.shape == "box" || opts.shape == "cylinder") {
      return opts.shape
    }
    val hx = b.half[0]
    val hy = b.half[1]
    val hz = b.half[2]
    val maxH = Math.max(hx, Math.max(hy, hz))
    val minH = Math.min(hx, Math.min(hy, hz))
    if (maxH > 1e-4 && maxH - minH <= maxH * 0.05) return "sphere"
    return "box"
  }

  private fun sphereRadius(b: XRSimWorld.Body): Double =
    Math.max(0.01, Math.max(b.half[0], Math.max(b.half[1], b.half[2])))

  private fun verticalHalfExtent(b: XRSimWorld.Body, opts: XRPhysicsBodyTrait): Double =
    if (resolveShape(b, opts) == "sphere") sphereRadius(b) else Math.max(0.01, b.half[1])

  private fun invMass(opts: XRPhysicsBodyTrait): Double =
    if (opts.body == "dynamic" && opts.mass > 0.0) 1.0 / opts.mass else 0.0

  /** Whether a dynamic rigid body is currently sleeping. */
  @JvmStatic
  fun isSleeping(@Suppress("UNUSED_PARAMETER") world: XRSimWorld, body: XRSimWorld.Body): Boolean =
    bodyState(body)?.sleeping == true

  /** Applies a world-space linear impulse (N*s) to a dynamic rigid body or jointed body and wakes it. */
  @JvmStatic
  fun applyImpulse(
    @Suppress("UNUSED_PARAMETER") world: XRSimWorld,
    body: XRSimWorld.Body,
    impulse: DoubleArray,
  ): Boolean {
    val opts = body.traits.rigidBody
    val hasJointOnly = opts == null && body.traits.joint != null
    if (
      (!hasJointOnly && (opts == null || opts.body != "dynamic")) ||
        body.hidden ||
        body.isTemplate ||
        impulse.size < 3 ||
        !impulse[0].isFinite() ||
        !impulse[1].isFinite() ||
        !impulse[2].isFinite()
    ) {
      return false
    }
    var im = 1.0
    if (opts != null) {
      val bs = ensureBodyState(body, opts)
      bs.sleeping = false
      bs.sleepTicks = 0
      im = invMass(opts)
    }
    body.vel =
      doubleArrayOf(
        Math.max(-200.0, Math.min(200.0, body.vel[0] + impulse[0] * im)),
        Math.max(-200.0, Math.min(200.0, body.vel[1] + impulse[1] * im)),
        Math.max(-200.0, Math.min(200.0, body.vel[2] + impulse[2] * im)),
      )
    return true
  }

  private fun collidePair(
    a: XRSimWorld.Body,
    optsA: XRPhysicsBodyTrait,
    b: XRSimWorld.Body,
    optsB: XRPhysicsBodyTrait,
  ): Pair<DoubleArray, Double>? {
    val shapeA = resolveShape(a, optsA)
    val shapeB = resolveShape(b, optsB)
    val ca = a.center()
    val cb = b.center()
    if (shapeA == "sphere" && shapeB == "sphere") {
      val rSum = sphereRadius(a) + sphereRadius(b)
      val dx = cb[0] - ca[0]
      val dy = cb[1] - ca[1]
      val dz = cb[2] - ca[2]
      val dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dist >= rSum) return null
      val normal =
        if (dist > 1e-9) doubleArrayOf(dx / dist, dy / dist, dz / dist)
        else doubleArrayOf(0.0, 1.0, 0.0)
      return normal to (rSum - dist)
    }
    val ha =
      if (shapeA == "sphere") {
        val r = sphereRadius(a)
        doubleArrayOf(r, r, r)
      } else {
        doubleArrayOf(
          Math.max(0.01, a.half[0]),
          Math.max(0.01, a.half[1]),
          Math.max(0.01, a.half[2]),
        )
      }
    val hb =
      if (shapeB == "sphere") {
        val r = sphereRadius(b)
        doubleArrayOf(r, r, r)
      } else {
        doubleArrayOf(
          Math.max(0.01, b.half[0]),
          Math.max(0.01, b.half[1]),
          Math.max(0.01, b.half[2]),
        )
      }
    val dx = cb[0] - ca[0]
    val dy = cb[1] - ca[1]
    val dz = cb[2] - ca[2]
    val ox = ha[0] + hb[0] - Math.abs(dx)
    val oy = ha[1] + hb[1] - Math.abs(dy)
    val oz = ha[2] + hb[2] - Math.abs(dz)
    if (ox <= 0.0 || oy <= 0.0 || oz <= 0.0) return null
    if (oy <= ox && oy <= oz) {
      return doubleArrayOf(0.0, if (dy >= 0.0) 1.0 else -1.0, 0.0) to oy
    }
    if (ox <= oz) {
      return doubleArrayOf(if (dx >= 0.0) 1.0 else -1.0, 0.0, 0.0) to ox
    }
    return doubleArrayOf(0.0, 0.0, if (dz >= 0.0) 1.0 else -1.0) to oz
  }

  private fun stepCharacterPush(world: XRSimWorld) {
    val ch = world.character ?: return
    val chOpts = ch.traits.character ?: return
    if (ch.hidden) return
    val chFoot = ch.pos[1] + (if (ch.half[1] > 0.0) ch.center[1] - ch.half[1] else 0.0)
    val chTop = chFoot + chOpts.height
    for (b in world.bodies) {
      val opts = b.traits.rigidBody ?: continue
      if (opts.body != "dynamic" || b.hidden || b.isTemplate || b === ch) continue
      val box = b.aabb()
      if (box[4] <= chFoot + 0.05 || box[1] >= chTop) continue
      val pushed = XRSimWorld.pushCircleOutOfAABB(ch.pos, chOpts.radius, box) ?: continue
      val dx = ch.pos[0] - pushed[0]
      val dz = ch.pos[2] - pushed[1]
      val dLen = Math.hypot(dx, dz)
      if (dLen <= 1e-6) continue
      val bs = ensureBodyState(b, opts)
      bs.sleeping = false
      bs.sleepTicks = 0
      b.pos = doubleArrayOf(b.pos[0] + dx, b.pos[1], b.pos[2] + dz)
      val nx = dx / dLen
      val nz = dz / dLen
      val chSpeed = Math.hypot(ch.vel[0], ch.vel[2])
      val pushSpeed = Math.max(chSpeed, 1.5) / Math.max(0.5, opts.mass * 0.5)
      val vn = b.vel[0] * nx + b.vel[2] * nz
      if (vn < pushSpeed) {
        b.vel =
          doubleArrayOf(
            b.vel[0] + (pushSpeed - vn) * nx,
            b.vel[1],
            b.vel[2] + (pushSpeed - vn) * nz,
          )
      }
    }
  }

  private fun stepJoints(world: XRSimWorld, dt: Double) {
    for (b in world.bodies) {
      if (b.hidden || b.isTemplate) continue
      val jt = b.traits.joint ?: continue
      val tb =
        if (jt.target.isNotEmpty()) {
          world.bodies.firstOrNull { !it.hidden && !it.isTemplate && it !== b && it.name == jt.target }
        } else {
          null
        }

      var js = b.data[JOINT_KEY] as? JointState
      if (js == null || !js.initialized) {
        val pivot0 =
          doubleArrayOf(
            b.initPos[0] + jt.anchor[0],
            b.initPos[1] + jt.anchor[1],
            b.initPos[2] + jt.anchor[2],
          )
        var targetLocalAnchor = doubleArrayOf(0.0, 0.0, 0.0)
        var d0 = 0.0
        if (tb != null) {
          if (jt.type == "spring") {
            d0 =
              hypot3(
                pivot0[0] - tb.initPos[0],
                pivot0[1] - tb.initPos[1],
                pivot0[2] - tb.initPos[2],
              )
          } else {
            targetLocalAnchor =
              doubleArrayOf(
                pivot0[0] - tb.initPos[0],
                pivot0[1] - tb.initPos[1],
                pivot0[2] - tb.initPos[2],
              )
          }
        } else if (jt.type == "spring") {
          d0 = hypot3(jt.anchor[0], jt.anchor[1], jt.anchor[2])
        }
        js =
          JointState(
            initialized = true,
            targetLocalAnchor = targetLocalAnchor,
            worldAnchor = pivot0,
            restLen = if (jt.restLength > 0.0) jt.restLength else d0,
          )
        b.data[JOINT_KEY] = js
      }

      val rbOpts = b.traits.rigidBody
      val hasDynRb = rbOpts?.body == "dynamic"
      val mass = if (hasDynRb && rbOpts != null && rbOpts.mass > 0.0) rbOpts.mass else 1.0
      val gScale = if (rbOpts != null) (if (hasDynRb) rbOpts.gravityScale else 0.0) else 1.0

      var worldPivot = js.worldAnchor
      var targetVel = doubleArrayOf(0.0, 0.0, 0.0)
      if (tb != null) {
        val off = quatRotateVec(bodyQuat(tb), js.targetLocalAnchor)
        worldPivot = doubleArrayOf(tb.pos[0] + off[0], tb.pos[1] + off[1], tb.pos[2] + off[2])
        targetVel = tb.vel
      }

      when (jt.type) {
        "hinge" -> {
          val u = jt.axis
          val r0 = doubleArrayOf(-jt.anchor[0], -jt.anchor[1], -jt.anchor[2])
          val qPrev = quatFromAxisAngle4(u, js.angle)
          val rPrev = quatRotateVec(qPrev, r0)
          val uDotR = dot3(u, rPrev)
          val rPerp =
            doubleArrayOf(
              rPrev[0] - u[0] * uDotR,
              rPrev[1] - u[1] * uDotR,
              rPrev[2] - u[2] * uDotR,
            )
          val rPerp2 = dot3(rPerp, rPerp)
          val inertia = Math.max(0.05, mass * Math.max(rPerp2, 0.25))
          val wxRPrev = cross3(u, rPrev)
          val dv =
            doubleArrayOf(
              b.vel[0] - (targetVel[0] + wxRPrev[0] * js.omega),
              b.vel[1] - (targetVel[1] + wxRPrev[1] * js.omega),
              b.vel[2] - (targetVel[2] + wxRPrev[2] * js.omega),
            )
          var omega = js.omega
          if (rPerp2 > 1e-6) {
            omega += dot3(cross3(rPrev, dv), u) / rPerp2
          }
          val tauG =
            if (hasDynRb) 0.0
            else dot3(cross3(rPrev, doubleArrayOf(0.0, mass * GRAVITY * gScale, 0.0)), u)
          val denom = inertia + jt.damping * dt + jt.stiffness * dt * dt
          omega = (inertia * omega + (tauG - jt.stiffness * js.angle) * dt) / denom
          if (jt.motorMaxForce > 0.0) {
            val maxDw = (jt.motorMaxForce / inertia) * dt
            omega += Math.max(-maxDw, Math.min(maxDw, jt.motorSpeed - omega))
          }
          omega = Math.max(-50.0, Math.min(50.0, omega))
          var angle = js.angle + omega * dt
          val lim = jt.limits
          if (lim != null) {
            val minRad = lim[0] * Math.PI / 180.0
            val maxRad = lim[1] * Math.PI / 180.0
            if (angle < minRad) {
              angle = minRad
              if (omega < 0.0) omega = 0.0
            } else if (angle > maxRad) {
              angle = maxRad
              if (omega > 0.0) omega = 0.0
            }
          }
          js.angle = angle
          js.omega = omega
          val qHinge = quatFromAxisAngle4(u, angle)
          if (Math.abs(u[1]) > 0.9999) {
            b.yaw = XRSimWorld.wrapAngle(angle * if (u[1] >= 0.0) 1.0 else -1.0)
            b.rot = doubleArrayOf(0.0, 0.0, 0.0, 1.0)
          } else {
            b.yaw = 0.0
            b.rot = qHinge
          }
          val rNew = quatRotateVec(qHinge, r0)
          b.pos =
            doubleArrayOf(
              worldPivot[0] + rNew[0],
              worldPivot[1] + rNew[1],
              worldPivot[2] + rNew[2],
            )
          val wxR = cross3(u, rNew)
          b.vel =
            doubleArrayOf(
              targetVel[0] + wxR[0] * omega,
              targetVel[1] + wxR[1] * omega,
              targetVel[2] + wxR[2] * omega,
            )
          val bs = bodyState(b)
          if (bs != null && Math.abs(omega) > SLEEP_ANGULAR_EPS) {
            bs.sleeping = false
            bs.sleepTicks = 0
          }
        }
        "slider" -> {
          val u = jt.axis
          val origin =
            doubleArrayOf(
              worldPivot[0] - jt.anchor[0],
              worldPivot[1] - jt.anchor[1],
              worldPivot[2] - jt.anchor[2],
            )
          val dv =
            doubleArrayOf(
              b.vel[0] - (targetVel[0] + u[0] * js.slideVel),
              b.vel[1] - (targetVel[1] + u[1] * js.slideVel),
              b.vel[2] - (targetVel[2] + u[2] * js.slideVel),
            )
          var v = js.slideVel + dot3(dv, u)
          val fGrav = if (hasDynRb) 0.0 else mass * GRAVITY * gScale * u[1]
          val denom = mass + jt.damping * dt + jt.stiffness * dt * dt
          v = (mass * v + (fGrav - jt.stiffness * js.slidePos) * dt) / denom
          if (jt.motorMaxForce > 0.0) {
            val maxDv = (jt.motorMaxForce / mass) * dt
            v += Math.max(-maxDv, Math.min(maxDv, jt.motorSpeed - v))
          }
          v = Math.max(-200.0, Math.min(200.0, v))
          var s = js.slidePos + v * dt
          val lim = jt.limits
          if (lim != null) {
            if (s < lim[0]) {
              s = lim[0]
              if (v < 0.0) v = 0.0
            } else if (s > lim[1]) {
              s = lim[1]
              if (v > 0.0) v = 0.0
            }
          }
          js.slidePos = s
          js.slideVel = v
          b.pos = doubleArrayOf(origin[0] + u[0] * s, origin[1] + u[1] * s, origin[2] + u[2] * s)
          b.vel =
            doubleArrayOf(
              targetVel[0] + u[0] * v,
              targetVel[1] + u[1] * v,
              targetVel[2] + u[2] * v,
            )
          val bs = bodyState(b)
          if (bs != null && Math.abs(v) > SLEEP_LINEAR_EPS) {
            bs.sleeping = false
            bs.sleepTicks = 0
          }
        }
        "spring" -> {
          if (rbOpts == null) {
            b.vel = doubleArrayOf(b.vel[0], b.vel[1] + GRAVITY * gScale * dt, b.vel[2])
          }
          val pB = tb?.pos ?: js.worldAnchor
          val offA = if (tb != null) quatRotateVec(bodyQuat(b), jt.anchor) else doubleArrayOf(0.0, 0.0, 0.0)
          val pA = doubleArrayOf(b.pos[0] + offA[0], b.pos[1] + offA[1], b.pos[2] + offA[2])
          val d = doubleArrayOf(pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2])
          val dist = hypot3(d[0], d[1], d[2])
          val dir =
            if (dist > 1e-6) doubleArrayOf(d[0] / dist, d[1] / dist, d[2] / dist)
            else jt.axis.copyOf()
          val stretch = dist - js.restLen
          val invM1 = 1.0 / mass
          val tbDyn =
            tb?.traits?.rigidBody?.takeIf { it.body == "dynamic" && it.mass > 0.0 }
          val invM2 = if (tbDyn != null) 1.0 / tbDyn.mass else 0.0
          val effMass = 1.0 / (invM1 + invM2)
          val relVel =
            doubleArrayOf(
              b.vel[0] - targetVel[0],
              b.vel[1] - targetVel[1],
              b.vel[2] - targetVel[2],
            )
          val vRel = dot3(relVel, dir)
          val denom = effMass + jt.damping * dt + jt.stiffness * dt * dt
          val vRelNew = (effMass * vRel - jt.stiffness * stretch * dt) / denom
          val jImp = (vRelNew - vRel) * effMass
          val dv1 = jImp * invM1
          b.vel =
            doubleArrayOf(
              Math.max(-200.0, Math.min(200.0, b.vel[0] + dir[0] * dv1)),
              Math.max(-200.0, Math.min(200.0, b.vel[1] + dir[1] * dv1)),
              Math.max(-200.0, Math.min(200.0, b.vel[2] + dir[2] * dv1)),
            )
          if (rbOpts == null) {
            val latDamp = Math.max(0.0, 1.0 - Math.min(jt.damping * 0.05, 5.0) * dt)
            val vnAfter = dot3(b.vel, dir)
            b.vel =
              doubleArrayOf(
                dir[0] * vnAfter + (b.vel[0] - dir[0] * vnAfter) * latDamp,
                dir[1] * vnAfter + (b.vel[1] - dir[1] * vnAfter) * latDamp,
                dir[2] * vnAfter + (b.vel[2] - dir[2] * vnAfter) * latDamp,
              )
            b.pos =
              doubleArrayOf(
                b.pos[0] + b.vel[0] * dt,
                b.pos[1] + b.vel[1] * dt,
                b.pos[2] + b.vel[2] * dt,
              )
          } else if (hasDynRb) {
            b.pos =
              doubleArrayOf(
                b.pos[0] + dir[0] * dv1 * dt,
                b.pos[1] + dir[1] * dv1 * dt,
                b.pos[2] + dir[2] * dv1 * dt,
              )
          }
          if (tb != null && invM2 > 0.0) {
            val dv2 = -jImp * invM2
            tb.vel =
              doubleArrayOf(
                Math.max(-200.0, Math.min(200.0, tb.vel[0] + dir[0] * dv2)),
                Math.max(-200.0, Math.min(200.0, tb.vel[1] + dir[1] * dv2)),
                Math.max(-200.0, Math.min(200.0, tb.vel[2] + dir[2] * dv2)),
              )
            tb.pos =
              doubleArrayOf(
                tb.pos[0] + dir[0] * dv2 * dt,
                tb.pos[1] + dir[1] * dv2 * dt,
                tb.pos[2] + dir[2] * dv2 * dt,
              )
            val tbs = bodyState(tb)
            if (tbs != null && Math.abs(dv2) > 1e-4) {
              tbs.sleeping = false
              tbs.sleepTicks = 0
            }
          }
          val lim = jt.limits
          if (lim != null) {
            val pB2 = tb?.pos ?: js.worldAnchor
            val offA2 =
              if (tb != null) quatRotateVec(bodyQuat(b), jt.anchor) else doubleArrayOf(0.0, 0.0, 0.0)
            val dx = b.pos[0] + offA2[0] - pB2[0]
            val dy = b.pos[1] + offA2[1] - pB2[1]
            val dz = b.pos[2] + offA2[2] - pB2[2]
            val d2 = hypot3(dx, dy, dz)
            val clamped = Math.max(lim[0], Math.min(lim[1], d2))
            if (Math.abs(clamped - d2) > 1e-6) {
              val n =
                if (d2 > 1e-6) doubleArrayOf(dx / d2, dy / d2, dz / d2) else jt.axis.copyOf()
              val corr = (clamped - d2) / (invM1 + invM2)
              b.pos =
                doubleArrayOf(
                  b.pos[0] + n[0] * corr * invM1,
                  b.pos[1] + n[1] * corr * invM1,
                  b.pos[2] + n[2] * corr * invM1,
                )
              if (tb != null && invM2 > 0.0) {
                tb.pos =
                  doubleArrayOf(
                    tb.pos[0] - n[0] * corr * invM2,
                    tb.pos[1] - n[1] * corr * invM2,
                    tb.pos[2] - n[2] * corr * invM2,
                  )
              }
              val rv =
                dot3(
                  doubleArrayOf(
                    b.vel[0] - (tb?.vel?.get(0) ?: 0.0),
                    b.vel[1] - (tb?.vel?.get(1) ?: 0.0),
                    b.vel[2] - (tb?.vel?.get(2) ?: 0.0),
                  ),
                  n,
                )
              if ((d2 > lim[1] && rv > 0.0) || (d2 < lim[0] && rv < 0.0)) {
                val jLim = -rv / (invM1 + invM2)
                b.vel =
                  doubleArrayOf(
                    b.vel[0] + n[0] * jLim * invM1,
                    b.vel[1] + n[1] * jLim * invM1,
                    b.vel[2] + n[2] * jLim * invM1,
                  )
                if (tb != null && invM2 > 0.0) {
                  tb.vel =
                    doubleArrayOf(
                      tb.vel[0] - n[0] * jLim * invM2,
                      tb.vel[1] - n[1] * jLim * invM2,
                      tb.vel[2] - n[2] * jLim * invM2,
                    )
                }
              }
            }
          }
          val bs = bodyState(b)
          if (bs != null && hypot3(b.vel[0], b.vel[1], b.vel[2]) > SLEEP_LINEAR_EPS) {
            bs.sleeping = false
            bs.sleepTicks = 0
          }
        }
        "ball" -> {
          val r0 = doubleArrayOf(-jt.anchor[0], -jt.anchor[1], -jt.anchor[2])
          val armLen2 = dot3(r0, r0)
          val rPrev = quatRotateVec(b.rot, r0)
          val inertia = Math.max(0.05, mass * Math.max(armLen2, 0.25))
          var w = js.omegaVec
          if (armLen2 > 1e-8) {
            val wxRPrev = cross3(w, rPrev)
            val dv =
              doubleArrayOf(
                b.vel[0] - (targetVel[0] + wxRPrev[0]),
                b.vel[1] - (targetVel[1] + wxRPrev[1]),
                b.vel[2] - (targetVel[2] + wxRPrev[2]),
              )
            val dw = cross3(rPrev, dv)
            w =
              doubleArrayOf(
                w[0] + dw[0] / armLen2,
                w[1] + dw[1] / armLen2,
                w[2] + dw[2] / armLen2,
              )
          }
          val fg = if (hasDynRb) 0.0 else mass * GRAVITY * gScale
          val tauG = doubleArrayOf(-rPrev[2] * fg, 0.0, rPrev[0] * fg)
          val qPos =
            if (b.rot[3] < 0.0) doubleArrayOf(-b.rot[0], -b.rot[1], -b.rot[2], -b.rot[3])
            else b.rot
          val sinHalf = hypot3(qPos[0], qPos[1], qPos[2])
          val swingAngle = 2.0 * Math.atan2(sinHalf, Math.max(0.0, Math.min(1.0, qPos[3])))
          val swingAxis =
            if (sinHalf > 1e-7)
              doubleArrayOf(qPos[0] / sinHalf, qPos[1] / sinHalf, qPos[2] / sinHalf)
            else doubleArrayOf(0.0, 1.0, 0.0)
          val denom = inertia + jt.damping * dt + jt.stiffness * dt * dt
          w =
            doubleArrayOf(
              (inertia * w[0] + (tauG[0] - jt.stiffness * swingAngle * swingAxis[0]) * dt) / denom,
              (inertia * w[1] + (tauG[1] - jt.stiffness * swingAngle * swingAxis[1]) * dt) / denom,
              (inertia * w[2] + (tauG[2] - jt.stiffness * swingAngle * swingAxis[2]) * dt) / denom,
            )
          val wMag = hypot3(w[0], w[1], w[2])
          if (wMag > 50.0) {
            val scale = 50.0 / wMag
            w = doubleArrayOf(w[0] * scale, w[1] * scale, w[2] * scale)
          }
          val wStep = hypot3(w[0], w[1], w[2])
          if (wStep > 1e-8) {
            val dq =
              quatFromAxisAngle4(
                doubleArrayOf(w[0] / wStep, w[1] / wStep, w[2] / wStep),
                wStep * dt,
              )
            b.rot = quatNormalize4(XRSpatialMath.quatMultiply(dq, b.rot))
          }
          val lim = jt.limits
          if (lim != null) {
            val maxRad = Math.max(Math.abs(lim[0]), Math.abs(lim[1])) * Math.PI / 180.0
            val qC =
              if (b.rot[3] < 0.0) doubleArrayOf(-b.rot[0], -b.rot[1], -b.rot[2], -b.rot[3])
              else b.rot
            val sH = hypot3(qC[0], qC[1], qC[2])
            val ang = 2.0 * Math.atan2(sH, Math.max(0.0, Math.min(1.0, qC[3])))
            if (ang > maxRad && sH > 1e-7) {
              val ax = doubleArrayOf(qC[0] / sH, qC[1] / sH, qC[2] / sH)
              b.rot = quatFromAxisAngle4(ax, maxRad)
              val wOut = dot3(w, ax)
              if (wOut > 0.0) {
                w = doubleArrayOf(w[0] - ax[0] * wOut, w[1] - ax[1] * wOut, w[2] - ax[2] * wOut)
              }
            }
          }
          js.omegaVec = w
          val rNew = quatRotateVec(b.rot, r0)
          b.pos =
            doubleArrayOf(
              worldPivot[0] + rNew[0],
              worldPivot[1] + rNew[1],
              worldPivot[2] + rNew[2],
            )
          val wxR = cross3(w, rNew)
          b.vel =
            doubleArrayOf(
              targetVel[0] + wxR[0],
              targetVel[1] + wxR[1],
              targetVel[2] + wxR[2],
            )
          val bs = bodyState(b)
          if (bs != null && hypot3(w[0], w[1], w[2]) > SLEEP_ANGULAR_EPS) {
            bs.sleeping = false
            bs.sleepTicks = 0
          }
        }
      }
    }
  }

  internal fun step(world: XRSimWorld, dt: Double) {
    if (!world.rigidBodyEnabled) return
    val hasActive =
      world.bodies.any {
        !it.hidden &&
          !it.isTemplate &&
          (it.traits.joint != null ||
            (it.traits.rigidBody != null &&
              (it.traits.rigidBody.body == "dynamic" || it.traits.rigidBody.body == "kinematic")))
      }
    if (!hasActive) return

    val groundY = Math.min(0.0, world.floorY)

    // 1. Symplectic Euler integration.
    for (b in world.bodies) {
      if (b.hidden || b.isTemplate) continue
      val opts = b.traits.rigidBody ?: continue
      val bs = ensureBodyState(b, opts)
      if (opts.body == "kinematic") {
        b.pos =
          doubleArrayOf(
            b.pos[0] + b.vel[0] * dt,
            b.pos[1] + b.vel[1] * dt,
            b.pos[2] + b.vel[2] * dt,
          )
        if (!opts.lockRotation && bs.angVel[1] != 0.0) {
          b.yaw = XRSimWorld.wrapAngle(b.yaw + bs.angVel[1] * dt)
        }
        continue
      }
      if (opts.body != "dynamic" || bs.sleeping) continue
      val dampL = Math.max(0.0, 1.0 - opts.linearDamping * dt)
      val dampA = Math.max(0.0, 1.0 - opts.angularDamping * dt)
      val vx = b.vel[0] * dampL
      val vy = (b.vel[1] + GRAVITY * opts.gravityScale * dt) * dampL
      val vz = b.vel[2] * dampL
      b.vel =
        doubleArrayOf(
          Math.max(-200.0, Math.min(200.0, vx)),
          Math.max(-200.0, Math.min(200.0, vy)),
          Math.max(-200.0, Math.min(200.0, vz)),
        )
      bs.angVel = doubleArrayOf(bs.angVel[0] * dampA, bs.angVel[1] * dampA, bs.angVel[2] * dampA)
      b.pos =
        doubleArrayOf(b.pos[0] + b.vel[0] * dt, b.pos[1] + b.vel[1] * dt, b.pos[2] + b.vel[2] * dt)
      if (!opts.lockRotation && bs.angVel[1] != 0.0) {
        b.yaw = XRSimWorld.wrapAngle(b.yaw + bs.angVel[1] * dt)
      }
    }

    // 2. Character push coupling.
    stepCharacterPush(world)

    // 3. Narrowphase contacts.
    val contacts = ArrayList<Contact>()
    for (b in world.bodies) {
      if (b.hidden || b.isTemplate) continue
      val opts = b.traits.rigidBody ?: continue
      if (opts.body != "dynamic") continue
      val hy = verticalHalfExtent(b, opts)
      val bottomY = b.pos[1] + b.center[1] - hy
      if (bottomY < groundY) {
        contacts.add(
          Contact(
            a = b,
            b = null,
            normal = doubleArrayOf(0.0, -1.0, 0.0),
            depth = groundY - bottomY,
            restitution = opts.restitution,
            friction = opts.friction,
            invMassA = invMass(opts),
            invMassB = 0.0,
          )
        )
      }
    }

    val nBodies = world.bodies.size
    for (i in 0 until nBodies) {
      val a = world.bodies[i]
      if (a.hidden || a.isTemplate || a === world.character) continue
      val optsA = physicsOpts(a) ?: continue
      val invA = invMass(optsA)
      val bsA = ensureBodyState(a, optsA)
      for (j in i + 1 until nBodies) {
        val b = world.bodies[j]
        if (b.hidden || b.isTemplate || b === world.character) continue
        val optsB = physicsOpts(b) ?: continue
        val invB = invMass(optsB)
        if (invA == 0.0 && invB == 0.0) continue
        val bsB = ensureBodyState(b, optsB)
        if (bsA.sleeping && bsB.sleeping) continue
        val hit = collidePair(a, optsA, b, optsB) ?: continue
        val rvx = b.vel[0] - a.vel[0]
        val rvy = b.vel[1] - a.vel[1]
        val rvz = b.vel[2] - a.vel[2]
        val relSpeed = Math.sqrt(rvx * rvx + rvy * rvy + rvz * rvz)
        if (relSpeed > SLEEP_LINEAR_EPS) {
          if (invA > 0.0) {
            bsA.sleeping = false
            bsA.sleepTicks = 0
          }
          if (invB > 0.0) {
            bsB.sleeping = false
            bsB.sleepTicks = 0
          }
        }
        contacts.add(
          Contact(
            a = a,
            b = b,
            normal = hit.first,
            depth = hit.second,
            restitution = Math.max(optsA.restitution, optsB.restitution),
            friction = Math.sqrt(optsA.friction * optsB.friction),
            invMassA = invA,
            invMassB = invB,
          )
        )
      }
    }

    for (c in contacts) {
      val vxB = c.b?.vel?.get(0) ?: 0.0
      val vyB = c.b?.vel?.get(1) ?: 0.0
      val vzB = c.b?.vel?.get(2) ?: 0.0
      val vn =
        (vxB - c.a.vel[0]) * c.normal[0] +
          (vyB - c.a.vel[1]) * c.normal[1] +
          (vzB - c.a.vel[2]) * c.normal[2]
      val impactSpeed = -vn
      if (impactSpeed >= COLLISION_SPEED_MIN) {
        world.emit(
          "xrcollision",
          mapOf(
            "nodeId" to c.a.name,
            "otherId" to (c.b?.name ?: "ground"),
            "speed" to Math.round(impactSpeed * 1000.0) / 1000.0,
            "normal" to listOf(-c.normal[0], -c.normal[1], -c.normal[2]),
          ),
          c.a,
          c.b,
        )
      }
    }

    // 4. Sequential Impulse velocity solver.
    for (iter in 0 until SOLVER_ITERS) {
      for (c in contacts) {
        val invSum = c.invMassA + c.invMassB
        if (invSum <= 0.0) continue
        val vxB = c.b?.vel?.get(0) ?: 0.0
        val vyB = c.b?.vel?.get(1) ?: 0.0
        val vzB = c.b?.vel?.get(2) ?: 0.0
        val rvx = vxB - c.a.vel[0]
        val rvy = vyB - c.a.vel[1]
        val rvz = vzB - c.a.vel[2]
        val vn = rvx * c.normal[0] + rvy * c.normal[1] + rvz * c.normal[2]
        if (vn >= 0.0) continue
        val e = if (iter == 0 && -vn > RESTITUTION_SLOP) c.restitution else 0.0
        val j = (-(1.0 + e) * vn) / invSum
        val ix = c.normal[0] * j
        val iy = c.normal[1] * j
        val iz = c.normal[2] * j
        if (c.invMassA > 0.0) {
          c.a.vel =
            doubleArrayOf(
              c.a.vel[0] - ix * c.invMassA,
              c.a.vel[1] - iy * c.invMassA,
              c.a.vel[2] - iz * c.invMassA,
            )
        }
        val b = c.b
        if (b != null && c.invMassB > 0.0) {
          b.vel =
            doubleArrayOf(
              b.vel[0] + ix * c.invMassB,
              b.vel[1] + iy * c.invMassB,
              b.vel[2] + iz * c.invMassB,
            )
        }
        val tvx = rvx - vn * c.normal[0]
        val tvy = rvy - vn * c.normal[1]
        val tvz = rvz - vn * c.normal[2]
        val tLen = Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz)
        if (tLen > 1e-7) {
          val tx = tvx / tLen
          val ty = tvy / tLen
          val tz = tvz / tLen
          val maxJt = j * c.friction
          val jt = Math.max(-maxJt, Math.min(maxJt, -tLen / invSum))
          if (c.invMassA > 0.0) {
            c.a.vel =
              doubleArrayOf(
                c.a.vel[0] - tx * jt * c.invMassA,
                c.a.vel[1] - ty * jt * c.invMassA,
                c.a.vel[2] - tz * jt * c.invMassA,
              )
          }
          if (b != null && c.invMassB > 0.0) {
            b.vel =
              doubleArrayOf(
                b.vel[0] + tx * jt * c.invMassB,
                b.vel[1] + ty * jt * c.invMassB,
                b.vel[2] + tz * jt * c.invMassB,
              )
          }
        }
      }
    }

    // 5. Split-impulse positional projection.
    for (pass in 0 until SOLVER_ITERS) {
      for (b in world.bodies) {
        if (b.hidden || b.isTemplate) continue
        val opts = b.traits.rigidBody ?: continue
        if (opts.body != "dynamic") continue
        val hy = verticalHalfExtent(b, opts)
        val bottomY = b.pos[1] + b.center[1] - hy
        if (bottomY < groundY) {
          b.pos = doubleArrayOf(b.pos[0], b.pos[1] + (groundY - bottomY), b.pos[2])
          if (Math.abs(b.vel[1]) < 1e-4) b.vel = doubleArrayOf(b.vel[0], 0.0, b.vel[2])
        }
      }
      for (i in 0 until nBodies) {
        val a = world.bodies[i]
        if (a.hidden || a.isTemplate || a === world.character) continue
        val optsA = physicsOpts(a) ?: continue
        val invA = invMass(optsA)
        val bsA = bodyState(a)
        for (j in i + 1 until nBodies) {
          val b = world.bodies[j]
          if (b.hidden || b.isTemplate || b === world.character) continue
          val optsB = physicsOpts(b) ?: continue
          val invB = invMass(optsB)
          val invSum = invA + invB
          if (invSum <= 0.0) continue
          val bsB = bodyState(b)
          if (bsA?.sleeping == true && bsB?.sleeping == true) continue
          val hit = collidePair(a, optsA, b, optsB) ?: continue
          val n = hit.first
          val depth = hit.second
          if (depth <= 1e-5) continue
          val corr = depth / invSum
          if (invA > 0.0) {
            a.pos =
              doubleArrayOf(
                a.pos[0] - n[0] * corr * invA,
                a.pos[1] - n[1] * corr * invA,
                a.pos[2] - n[2] * corr * invA,
              )
          }
          if (invB > 0.0) {
            b.pos =
              doubleArrayOf(
                b.pos[0] + n[0] * corr * invB,
                b.pos[1] + n[1] * corr * invB,
                b.pos[2] + n[2] * corr * invB,
              )
          }
        }
      }
    }

    for (b in world.bodies) {
      if (b.hidden || b.isTemplate) continue
      val opts = b.traits.rigidBody ?: continue
      if (opts.body != "dynamic") continue
      val hy = verticalHalfExtent(b, opts)
      val bottomY = b.pos[1] + b.center[1] - hy
      if (bottomY < groundY) {
        b.pos = doubleArrayOf(b.pos[0], b.pos[1] + (groundY - bottomY), b.pos[2])
        if (b.vel[1] < 0.0) b.vel = doubleArrayOf(b.vel[0], 0.0, b.vel[2])
      }
    }

    // 5b. Mechanical joint constraints (`hinge`, `slider`, `spring`, `ball`).
    stepJoints(world, dt)

    // 6. Sleep threshold counter.
    for (b in world.bodies) {
      if (b.hidden || b.isTemplate) continue
      val opts = b.traits.rigidBody ?: continue
      if (opts.body != "dynamic") continue
      val bs = ensureBodyState(b, opts)
      if (bs.sleeping) continue
      val linSpeed = Math.sqrt(b.vel[0] * b.vel[0] + b.vel[1] * b.vel[1] + b.vel[2] * b.vel[2])
      val angSpeed =
        Math.sqrt(
          bs.angVel[0] * bs.angVel[0] + bs.angVel[1] * bs.angVel[1] + bs.angVel[2] * bs.angVel[2]
        )
      if (linSpeed < SLEEP_LINEAR_EPS && angSpeed < SLEEP_ANGULAR_EPS) {
        bs.sleepTicks++
        if (bs.sleepTicks >= SLEEP_TICKS) {
          bs.sleeping = true
          b.vel = doubleArrayOf(0.0, 0.0, 0.0)
          bs.angVel = doubleArrayOf(0.0, 0.0, 0.0)
          world.emit("xrsleep", mapOf("nodeId" to b.name, "position" to b.pos.toList()), b)
        }
      } else {
        bs.sleepTicks = 0
      }
    }
  }

  internal fun reset(world: XRSimWorld) {
    for (b in world.bodies) {
      b.data.remove(KEY)
      b.data.remove(JOINT_KEY)
    }
    world.state.remove(KEY)
  }
}
