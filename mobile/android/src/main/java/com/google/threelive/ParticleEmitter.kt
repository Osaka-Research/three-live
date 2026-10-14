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
 * Small deterministic PRNG (mulberry32), bit-identical to `createRng()` in
 * `xr-live/src/plugins/depth-particles.ts` so seeded simulations match the web.
 */
class Mulberry32(seed: Int) {
  private var s: Int = seed

  /** Returns the next value in `[0, 1)`. */
  fun next(): Double {
    s += 0x6d2b79f5
    var t = s
    t = (t xor (t ushr 15)) * (t or 1)
    t = t xor (t + (t xor (t ushr 7)) * (t or 61))
    return ((t xor (t ushr 14)).toLong() and 0xffffffffL).toDouble() / 4294967296.0
  }
}

/** Camera inputs used for depth collision (column-major view / projection matrices). */
class ParticleDepthCamera(
  val view: FloatArray,
  val proj: FloatArray,
  /** Samples real-world view depth (meters along -Z) at viewport `(u, v)`, or `null`. */
  val sample: (Double, Double) -> Double?,
)

/**
 * CPU particle state for one emitter volume. Port of `ParticleEmitter` in
 * `xr-live/src/plugins/depth-particles.ts`: same presets, RNG call order and float32 storage, so a
 * given seed produces the same particles as the web.
 */
class ParticleEmitter @JvmOverloads constructor(val options: XRParticlesTrait, seed: Int = 1) {
  /** Simulated particle count: `options.count` coerced to `[0, MAX_PARTICLES_PER_EMITTER]`. */
  val count: Int = options.count.coerceIn(0, XRLiveSceneCoreHelper.MAX_PARTICLES_PER_EMITTER)

  /** xyz per particle (model / scene space). */
  val positions = FloatArray(count * 3)

  /** Velocity xyz per particle in m/s. */
  val velocities = FloatArray(count * 3)

  /** Number of floor / depth collisions so far. */
  var collisions = 0
    private set

  private val rng = Mulberry32(seed)
  private val center = DoubleArray(3)
  private var frame = 0
  private val scratch = DoubleArray(3)
  private val presetId = PRESETS.indexOf(options.preset).let { if (it < 0) 0 else it }
  private val areaW = XRBlocksMath.clampNum(options.area.getOrElse(0) { 2.0 }, 0.05, 50.0, 2.0)
  private val areaH = XRBlocksMath.clampNum(options.area.getOrElse(1) { 2.0 }, 0.05, 50.0, 2.0)
  private val areaD = XRBlocksMath.clampNum(options.area.getOrElse(2) { 2.0 }, 0.05, 50.0, 2.0)

  /** Re-seeds every particle uniformly inside the volume around ([cx], [cy], [cz]). */
  fun reset(cx: Double, cy: Double, cz: Double) {
    center[0] = cx
    center[1] = cy
    center[2] = cz
    for (i in 0 until count) respawn(i, true)
  }

  private fun respawn(i: Int, anywhere: Boolean) {
    val cx = center[0]
    val cy = center[1]
    val cz = center[2]
    val o = i * 3
    val sp = options.speed
    val burst = presetId == SPARKS
    positions[o] = (if (burst) cx else cx + (rng.next() - 0.5) * areaW).toFloat()
    positions[o + 1] =
      (if (burst) cy else if (anywhere) cy + (rng.next() - 0.5) * areaH else cy + areaH * 0.5).toFloat()
    positions[o + 2] = (if (burst) cz else cz + (rng.next() - 0.5) * areaD).toFloat()
    when (presetId) {
      RAIN -> setV(o, 0.0, -4 * sp, 0.0)
      SNOW -> {
        val vx = (rng.next() - 0.5) * 0.2
        val vy = -0.5 * sp
        val vz = (rng.next() - 0.5) * 0.2
        setV(o, vx, vy, vz)
      }
      SPARKS -> {
        val a = rng.next() * Math.PI * 2
        val up = 1.5 + rng.next() * 1.5
        setV(o, StrictMath.cos(a) * sp, up * sp, StrictMath.sin(a) * sp)
      }
      else -> {
        val vx = (rng.next() - 0.5) * sp
        val vy = (0.5 + rng.next()) * sp
        val vz = (rng.next() - 0.5) * sp
        setV(o, vx, vy, vz)
      }
    }
  }

  private fun setV(o: Int, x: Double, y: Double, z: Double) {
    velocities[o] = x.toFloat()
    velocities[o + 1] = y.toFloat()
    velocities[o + 2] = z.toFloat()
  }

  /**
   * Advances the simulation by [dt] seconds (clamped to `[0, 0.1]`). The volume center moves to
   * ([cx], [cy], [cz]); when provided, [floorY] and [depth] collide particles with real geometry
   * and collided particles respawn at the top of the volume. Allocation-free.
   */
  @JvmOverloads
  fun step(
    dt: Double,
    cx: Double,
    cy: Double,
    cz: Double,
    floorY: Double? = null,
    depth: ParticleDepthCamera? = null,
  ) {
    val step = XRBlocksMath.clampNum(dt, 0.0, 0.1, 1.0 / 60)
    center[0] = cx
    center[1] = cy
    center[2] = cz
    val gravity = if (presetId == SPARKS || presetId == CONFETTI) -9.8 * 0.4 else 0.0
    val drag = if (presetId == CONFETTI) 0.9 else 1.0
    val bottom = Math.max(cy - areaH * 0.5, floorY ?: Double.NEGATIVE_INFINITY)
    val p = positions
    val v = velocities
    val phase = frame and 3
    frame++
    for (i in 0 until count) {
      val o = i * 3
      v[o + 1] = (v[o + 1] + gravity * step).toFloat()
      if (drag != 1.0) {
        val k = StrictMath.pow(drag, step * 60)
        v[o] = (v[o] * k).toFloat()
        v[o + 2] = (v[o + 2] * k).toFloat()
      }
      if (presetId == SNOW) {
        v[o] = (v[o] + StrictMath.sin((p[o + 1] + i.toDouble()) * 3) * 0.02 * step).toFloat()
      }
      p[o] = (p[o] + v[o] * step).toFloat()
      p[o + 1] = (p[o + 1] + v[o + 1] * step).toFloat()
      p[o + 2] = (p[o + 2] + v[o + 2] * step).toFloat()
      val outside =
        Math.abs(p[o] - cx) > areaW * 0.5 + 0.5 || Math.abs(p[o + 2] - cz) > areaD * 0.5 + 0.5
      val hitFloor = p[o + 1] <= bottom
      var hitDepth = false
      if (!hitFloor && depth != null && (i and 3) == phase) {
        scratch[0] = p[o].toDouble()
        scratch[1] = p[o + 1].toDouble()
        scratch[2] = p[o + 2].toDouble()
        hitDepth = isOccludedByDepth(scratch, depth)
      }
      if (hitFloor || hitDepth || outside) {
        if (hitFloor || hitDepth) collisions++
        respawn(i, false)
      }
    }
  }

  companion object {
    /** Supported presets, in the order used by the trait schema. */
    @JvmField val PRESETS = listOf("rain", "snow", "sparks", "confetti")

    private const val RAIN = 0
    private const val SNOW = 1
    private const val SPARKS = 2
    private const val CONFETTI = 3

    /**
     * Returns `true` when world point [p] lies at or behind the real-world surface seen at its
     * projected pixel (2 cm tolerance).
     */
    @JvmStatic
    fun isOccludedByDepth(p: DoubleArray, cam: ParticleDepthCamera): Boolean {
      val m = cam.view
      val vx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
      val vy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
      val vz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
      val viewDepth = -vz
      if (viewDepth <= 0.05) return false
      val pr = cam.proj
      val ndcX = (pr[0] * vx + pr[8] * vz) / viewDepth
      val ndcY = (pr[5] * vy + pr[9] * vz) / viewDepth
      if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) return false
      val real = cam.sample((ndcX + 1) * 0.5, (1 - ndcY) * 0.5) ?: return false
      return real.isFinite() && real > 0.05 && viewDepth >= real - 0.02
    }
  }
}
