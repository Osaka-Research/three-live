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

  /** Applies a world-space linear impulse (N*s) to a dynamic rigid body and wakes it. */
  @JvmStatic
  fun applyImpulse(
    @Suppress("UNUSED_PARAMETER") world: XRSimWorld,
    body: XRSimWorld.Body,
    impulse: DoubleArray,
  ): Boolean {
    val opts = body.traits.rigidBody ?: return false
    if (
      opts.body != "dynamic" ||
        body.hidden ||
        body.isTemplate ||
        impulse.size < 3 ||
        !impulse[0].isFinite() ||
        !impulse[1].isFinite() ||
        !impulse[2].isFinite()
    ) {
      return false
    }
    val bs = ensureBodyState(body, opts)
    bs.sleeping = false
    bs.sleepTicks = 0
    val im = invMass(opts)
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

  internal fun step(world: XRSimWorld, dt: Double) {
    if (!world.rigidBodyEnabled) return
    val hasActive =
      world.bodies.any {
        !it.hidden &&
          !it.isTemplate &&
          it.traits.rigidBody != null &&
          (it.traits.rigidBody.body == "dynamic" || it.traits.rigidBody.body == "kinematic")
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
    for (b in world.bodies) b.data.remove(KEY)
    world.state.remove(KEY)
  }
}
