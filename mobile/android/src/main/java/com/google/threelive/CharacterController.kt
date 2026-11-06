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
 * `character-controller` for [XRSimWorld] (port of `xr-live/src/sim/character-controller.ts`).
 *
 * Moves the first `character` node from [XRSimWorld.moveX] / [XRSimWorld.moveZ] relative to the
 * camera heading, with jump, gravity, sliding along `collidable` nodes, and standing on their tops.
 * Hosts drive the camera from [cameraTarget] and play clips from
 * [XRSimWorld.Listener.onCharacterClip].
 */
object CharacterController {
  const val ACCEL: Double = 12.0
  const val TURN_SPEED: Double = 12.0
  const val STEP_HEIGHT: Double = 0.05
  private const val KEY = "character-controller"

  internal class State(val body: XRSimWorld.Body) {
    var grounded = true
    var vy = 0.0
    var clip: String? = null
  }

  /** Effective options after host overrides, or `null` when disabled. */
  @JvmStatic
  fun resolve(world: XRSimWorld, base: XRCharacterTrait): XRCharacterTrait? {
    val mode = world.characterMode?.trim()?.lowercase()
    if (mode == "none" || mode == "false") return null
    val camera =
      when (mode) {
        "fixed-camera",
        "fixed" -> "fixed"
        "first-person",
        "top-down",
        "third-person" -> mode
        else -> base.cameraMode
      }
    return base.copy(
      cameraMode = camera,
      speed = XRSpatialMath.clampNum(world.characterSpeed ?: Double.NaN, 0.1, 20.0, base.speed),
      jumpVelocity =
        XRSpatialMath.clampNum(world.characterJump ?: Double.NaN, 0.0, 30.0, base.jumpVelocity),
    )
  }

  /** Animation state for a horizontal speed. */
  @JvmStatic
  fun clipState(speed: Double, maxSpeed: Double, grounded: Boolean): String =
    when {
      !grounded -> "jump"
      speed < 0.05 -> "idle"
      speed < 0.7 * maxSpeed -> "walk"
      else -> "run"
    }

  private fun feetOffset(b: XRSimWorld.Body): Double =
    if (b.half[1] > 0) b.center[1] - b.half[1] else 0.0

  /** Fallback floor: the scene's lowest point when platforms exist, else the spawn height. */
  @JvmStatic
  fun floor(world: XRSimWorld, b: XRSimWorld.Body): Double {
    val platforms =
      world.bodies.any {
        it !== b &&
          (it.traits.collidable || it.traits.rigidBody?.body == "static") &&
          !it.isTemplate
      }
    val spawnFeet = b.initPos[1] + feetOffset(b)
    return if (platforms) Math.min(world.floorY, spawnFeet) else spawnFeet
  }

  /**
   * Camera framing for the controlled character (port of `characterCameraRig` in
   * `character-controller.ts`): follow [target] every frame and apply [phiDeg] (polar angle, 0 =
   * straight down) and [distance] when [mode] changes.
   */
  class CameraRig(
    val mode: String,
    val target: DoubleArray,
    val phiDeg: Double,
    val distance: Double,
  )

  /**
   * The camera rig, or `null` when there is no visible character, the camera is `fixed`, or an XR
   * session drives the camera.
   */
  @JvmStatic
  fun cameraRig(world: XRSimWorld): CameraRig? {
    val st = world.state[KEY] as? State ?: return null
    val b = st.body
    if (b.hidden || world.xrActive) return null
    val opts = resolve(world, b.traits.character ?: return null) ?: return null
    if (opts.cameraMode == "fixed") return null
    val feet = b.pos[1] + feetOffset(b)
    val mode = opts.cameraMode
    val fp = mode == "first-person"
    val target = doubleArrayOf(b.pos[0], feet + opts.height * if (fp) 0.9 else 0.6, b.pos[2])
    return when (mode) {
      "first-person" -> CameraRig(mode, target, 90.0, 0.05)
      "top-down" -> CameraRig(mode, target, 1.0, Math.hypot(opts.cameraDistance, opts.cameraHeight))
      else -> {
        val h = Math.max(0.01, opts.cameraHeight)
        CameraRig(
          mode,
          target,
          Math.toDegrees(Math.atan2(opts.cameraDistance, h)),
          Math.hypot(opts.cameraDistance, h),
        )
      }
    }
  }

  /** Camera target for hosts that follow the character (see [cameraRig]). */
  @JvmStatic fun cameraTarget(world: XRSimWorld): DoubleArray? = cameraRig(world)?.target

  internal fun stepCharacter(
    world: XRSimWorld,
    st: State,
    opts: XRCharacterTrait,
    moveX: Double,
    moveZ: Double,
    sprint: Boolean,
    jump: Boolean,
    dt: Double,
  ) {
    val b = st.body
    val len = Math.min(1.0, Math.hypot(moveX, moveZ))
    val target = opts.speed * (if (sprint) opts.runMultiplier else 1.0) * len
    val dx = if (len > 1e-6) moveX / len else 0.0
    val dz = if (len > 1e-6) moveZ / len else 0.0
    val k = Math.min(1.0, dt * ACCEL)
    b.vel[0] += (dx * target - b.vel[0]) * k
    b.vel[2] += (dz * target - b.vel[2]) * k
    if (len > 0.05) {
      b.yaw = XRSimWorld.turnToward(b.yaw, XRSimWorld.yawFromDir(dx, dz), TURN_SPEED * dt)
    }
    if (jump && st.grounded && opts.jumpVelocity > 0) {
      st.vy = opts.jumpVelocity
      st.grounded = false
      world.emit("characterjump", mapOf("nodeId" to b.name, "position" to b.pos.toList()), b)
    }
    st.vy -= opts.gravity * dt
    val next =
      doubleArrayOf(b.pos[0] + b.vel[0] * dt, b.pos[1] + st.vy * dt, b.pos[2] + b.vel[2] * dt)
    val foot = feetOffset(b)
    var feet = next[1] + foot
    var ground = floor(world, b)
    for (o in world.bodies) {
      if (
        o === b ||
          o.hidden ||
          o.isTemplate ||
          (!o.traits.collidable && o.traits.rigidBody?.body != "static")
      )
        continue
      val box = o.aabb()
      val top = box[4]
      if (top <= feet + STEP_HEIGHT + Math.max(0.0, -st.vy * dt)) {
        val cx = Math.max(box[0], Math.min(box[3], next[0]))
        val cz = Math.max(box[2], Math.min(box[5], next[2]))
        if (Math.hypot(next[0] - cx, next[2] - cz) < opts.radius * 0.7) {
          ground = Math.max(ground, top)
        }
        continue
      }
      if (box[1] >= feet + opts.height) continue
      val pushed = XRSimWorld.pushCircleOutOfAABB(next, opts.radius, box)
      if (pushed != null) {
        next[0] = pushed[0]
        next[2] = pushed[1]
      }
    }
    if (feet <= ground) {
      if (!st.grounded && st.vy < 0) {
        world.emit(
          "characterland",
          mapOf(
            "nodeId" to b.name,
            "position" to listOf(next[0], ground - foot, next[2]),
            "fallSpeed" to Math.round(-st.vy * 1000) / 1000.0,
          ),
          b,
        )
      }
      feet = ground
      st.vy = 0.0
      st.grounded = true
    } else if (feet > ground + 0.01) {
      st.grounded = false
    }
    b.pos = doubleArrayOf(next[0], feet - foot, next[2])
  }

  internal fun step(world: XRSimWorld, dt: Double) {
    var st = world.state[KEY] as? State
    if (st == null || st.body !in world.bodies) {
      world.character = null
      val body =
        world.active().firstOrNull { it.traits.character != null && !it.isInstance } ?: return
      st = State(body)
      world.state[KEY] = st
    }
    val opts = resolve(world, st.body.traits.character!!)
    if (opts == null || st.body.hidden) {
      world.character = if (opts != null) st.body else null
      return
    }
    world.character = st.body
    st.body.viewHidden = opts.cameraMode == "first-person" && !world.xrActive
    val fwd = world.cameraForwardXZ()
    val rx = -fwd[2]
    val rz = fwd[0]
    var x = world.moveX.takeIf { it.isFinite() } ?: 0.0
    var z = world.moveZ.takeIf { it.isFinite() } ?: 0.0
    val l = Math.hypot(x, z)
    if (l > 1) {
      x /= l
      z /= l
    }
    val mx = rx * x + fwd[0] * z
    val mz = rz * x + fwd[2] * z
    val jump = world.jumpQueued
    world.jumpQueued = false
    stepCharacter(world, st, opts, mx, mz, world.sprint, jump, dt)
    val speed = Math.hypot(st.body.vel[0], st.body.vel[2])
    val clip = clipState(speed, opts.speed * opts.runMultiplier, st.grounded)
    if (clip != st.clip) {
      st.clip = clip
      opts.clips[clip]?.let { world.listener?.onCharacterClip(it) }
    }
  }

  internal fun reset(world: XRSimWorld) {
    (world.state[KEY] as? State)?.let {
      it.grounded = true
      it.vy = 0.0
      it.clip = null
    }
  }
}
