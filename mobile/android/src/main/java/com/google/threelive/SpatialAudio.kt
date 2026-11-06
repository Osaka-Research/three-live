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

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.acos
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 3D Positional & Directional Spatial Audio engine for Android XR (`spatial-audio` plugin parity).
 *
 * Ports `computeSpatialAudioMix()`, `renderAmbientLoopPcm()`, and `XRSpatialAudioEmitterController`
 * from `three-live/src/xr-trait-schema.ts` and `xr-live/src/plugins/spatial-audio.ts`.
 */
object SpatialAudio {

  private const val TWO_PI = 2.0 * PI

  /** All 8 built-in procedural ambient loop presets. */
  @JvmField
  val AMBIENT_PRESETS: List<String> =
    listOf("hum", "reactor", "wind", "beacon", "geiger", "chimeLoop", "machinery", "water")

  /** Evaluated 3D spatial audio mix for a single emitter at a listener pose. */
  data class Mix(
    val gain: Double,
    val pan: Double,
    val leftGain: Double,
    val rightGain: Double,
    val distance: Double,
    val coneAttenuation: Double,
  )

  /**
   * Pure 3D spatial audio distance, directional cone, and constant-power stereo pan law matching
   * TypeScript `computeSpatialAudioMix()` to `1e-5`.
   */
  @JvmStatic
  fun computeMix(
    listenerPos: DoubleArray,
    listenerForward: DoubleArray,
    listenerRight: DoubleArray,
    emitterPos: DoubleArray,
    emitterForward: DoubleArray,
    opts: XRAudioEmitterTrait,
  ): Mix {
    @Suppress("UNUSED_PARAMETER") val unusedFwd = listenerForward
    val vol = opts.volume.coerceIn(0.0, 2.0)
    if (opts.type == "global") {
      val s = sqrt(0.5) * vol
      return Mix(
        gain = vol,
        pan = 0.0,
        leftGain = s,
        rightGain = s,
        distance = 0.0,
        coneAttenuation = 1.0,
      )
    }
    val dx = emitterPos[0] - listenerPos[0]
    val dy = emitterPos[1] - listenerPos[1]
    val dz = emitterPos[2] - listenerPos[2]
    val distance = sqrt(dx * dx + dy * dy + dz * dz)
    val dRef = max(1e-4, opts.refDistance)
    val dMax = max(dRef, opts.maxDistance)
    val rolloff = max(0.0, opts.rolloffFactor)
    val dClamped = distance.coerceIn(dRef, dMax)

    var distGain =
      when (opts.distanceModel) {
        "linear" -> {
          val span = dMax - dRef
          if (span > 1e-6) 1.0 - rolloff * ((dClamped - dRef) / span) else 1.0
        }
        "exponential" -> (dClamped / dRef).pow(-rolloff)
        else -> dRef / (dRef + rolloff * (dClamped - dRef))
      }
    distGain = if (distGain.isFinite()) distGain.coerceIn(0.0, 1.0) else 0.0

    var coneAttenuation = 1.0
    val innerDeg = opts.coneInnerAngle.coerceIn(0.0, 360.0)
    val outerDeg = opts.coneOuterAngle.coerceIn(innerDeg, 360.0)
    if (distance > 1e-6 && (innerDeg < 360.0 || outerDeg < 360.0)) {
      val efLen =
        sqrt(
            emitterForward[0] * emitterForward[0] +
              emitterForward[1] * emitterForward[1] +
              emitterForward[2] * emitterForward[2]
          )
          .let { if (it > 0.0) it else 1.0 }
      val toLx = -dx / distance
      val toLy = -dy / distance
      val toLz = -dz / distance
      val cosTheta =
        ((emitterForward[0] * toLx + emitterForward[1] * toLy + emitterForward[2] * toLz) / efLen)
          .coerceIn(-1.0, 1.0)
      val angleDeg = acos(cosTheta) * 180.0 / PI
      val halfInner = innerDeg * 0.5
      val halfOuter = outerDeg * 0.5
      val outerGain = opts.coneOuterGain.coerceIn(0.0, 1.0)
      coneAttenuation =
        when {
          angleDeg <= halfInner -> 1.0
          angleDeg >= halfOuter -> outerGain
          else -> {
            val t = (angleDeg - halfInner) / max(1e-6, halfOuter - halfInner)
            1.0 + (outerGain - 1.0) * t
          }
        }
    }

    var pan = 0.0
    if (distance > 1e-6) {
      val lrLen =
        sqrt(
            listenerRight[0] * listenerRight[0] +
              listenerRight[1] * listenerRight[1] +
              listenerRight[2] * listenerRight[2]
          )
          .let { if (it > 0.0) it else 1.0 }
      val dotRight =
        (dx * listenerRight[0] + dy * listenerRight[1] + dz * listenerRight[2]) / (distance * lrLen)
      pan = if (dotRight.isFinite()) dotRight.coerceIn(-1.0, 1.0) else 0.0
    }

    val gain = vol * distGain * coneAttenuation
    val panAngle = ((pan + 1.0) * PI) / 4.0
    return Mix(
      gain = gain,
      pan = pan,
      leftGain = gain * cos(panAngle),
      rightGain = gain * sin(panAngle),
      distance = distance,
      coneAttenuation = coneAttenuation,
    )
  }

  /**
   * Synthesizes a deterministic, phase-locked 16-bit mono PCM buffer for any built-in ambient loop
   * preset (`hum`, `reactor`, `wind`, `beacon`, `geiger`, `chimeLoop`, `machinery`, `water`) or
   * one-shot cue.
   */
  @JvmStatic
  @JvmOverloads
  fun renderAmbientLoopPcm(
    preset: String,
    sampleRate: Int = 22050,
    durationSec: Double = 2.0,
  ): ShortArray {
    val sr = sampleRate.coerceIn(8000, 48000)
    val dur = durationSec.coerceIn(0.25, 10.0)
    val n = max(64, (sr * dur).roundToInt())
    val out = ShortArray(n)
    fun cyc(hz: Double): Double = (TWO_PI * max(1, (hz * dur).roundToInt())) / n.toDouble()

    val notes = doubleArrayOf(523.25, 659.25, 783.99, 1046.5)
    val clickSlots = doubleArrayOf(0.05, 0.14, 0.19, 0.33, 0.47, 0.52, 0.68, 0.81, 0.91)

    for (i in 0 until n) {
      val u = i.toDouble() / n.toDouble()
      val s: Double =
        when (preset) {
          "hum" -> {
            val lfo = 0.85 + 0.15 * cos(TWO_PI * u)
            lfo *
              (0.6 * sin(cyc(60.0) * i) + 0.28 * sin(cyc(120.0) * i) + 0.12 * sin(cyc(180.0) * i))
          }
          "reactor" -> {
            val pulse = 0.75 + 0.25 * cos(2.0 * TWO_PI * u)
            pulse *
              (0.42 * sin(cyc(55.0) * i) +
                0.38 * sin(cyc(56.5) * i) +
                0.14 * sin(cyc(110.0) * i) +
                0.06 * sin(cyc(220.0) * i))
          }
          "wind" -> {
            val gust = 0.55 + 0.3 * cos(TWO_PI * u) + 0.15 * sin(2.0 * TWO_PI * u)
            var sum = 0.0
            for (k in 1..12) {
              val freq = 140.0 + k * 47.0 + (k % 3) * 19.0
              val phase = k * 1.37
              sum += sin(cyc(freq) * i + phase) / (1.0 + k * 0.25)
            }
            gust * sum * 0.32
          }
          "beacon" -> {
            val pingPhase = (u * 2.0) % 1.0
            val env = sin(PI * pingPhase) * exp(-5.5 * pingPhase)
            env * (0.75 * sin(cyc(880.0) * i) + 0.25 * sin(cyc(1760.0) * i))
          }
          "geiger" -> {
            var acc = 0.0
            for (c in clickSlots.indices) {
              var d = u - clickSlots[c]
              if (d < 0.0) d += 1.0
              val dtSec = d * dur
              if (dtSec >= 0.0 && dtSec < 0.018) {
                val env = sin((PI * dtSec) / 0.018) * exp(-180.0 * dtSec)
                acc += env * sin(cyc(2200.0 + c * 130.0) * i)
              }
            }
            acc * 0.85 + 0.04 * sin(cyc(60.0) * i)
          }
          "chimeLoop" -> {
            val slot = floor(u * notes.size).toInt() % notes.size
            val localU = (u * notes.size) % 1.0
            val env = sin(PI * localU) * exp(-3.2 * localU)
            val f = notes[slot]
            env *
              (0.68 * sin(cyc(f) * i) + 0.22 * sin(cyc(f * 2.0) * i) + 0.1 * sin(cyc(f * 3.0) * i))
          }
          "machinery" -> {
            val chug = 0.62 + 0.38 * cos(8.0 * TWO_PI * u)
            chug *
              (0.48 * sin(cyc(36.0) * i) +
                0.3 * sin(cyc(72.0) * i) +
                0.14 * sin(cyc(144.0) * i) +
                0.08 * sin(cyc(360.0) * i))
          }
          "water" -> {
            var drops = 0.0
            for (k in 0 until 6) {
              var d = u - k / 6.0
              if (d < 0.0) d += 1.0
              val local = d * 6.0
              if (local < 1.0) {
                val env = sin(PI * local) * exp(-3.0 * local)
                val f = 420.0 + k * 75.0
                drops += env * sin(cyc(f) * i + 1.5 * sin(cyc(f * 0.5) * i))
              }
            }
            val stream = 0.18 * sin(cyc(190.0) * i) + 0.12 * sin(cyc(310.0) * i)
            0.55 * drops + stream
          }
          else -> {
            val env = sin(PI * u) * exp(-4.0 * u)
            val baseHz =
              when (preset) {
                "error",
                "fail" -> 220.0
                "alarm",
                "warning" -> 660.0
                "pickup",
                "powerup",
                "pass" -> 880.0
                else -> 520.0
              }
            env * (0.7 * sin(cyc(baseHz) * i) + 0.3 * sin(cyc(baseHz * 1.5) * i))
          }
        }
      val clamped = s.coerceIn(-0.95, 0.95)
      out[i] = (clamped * 32767.0).roundToInt().toShort()
    }

    val fadeLen = min(16, n / 4)
    val startVal = out[0].toDouble()
    for (k in 0 until fadeLen) {
      val idx = n - fadeLen + k
      val alpha = (k + 1).toDouble() / (fadeLen + 1).toDouble()
      out[idx] = (out[idx] * (1.0 - alpha) + startVal * alpha).roundToInt().toShort()
    }
    return out
  }

  /** Runtime state for a single node's 3D audio emitter. */
  data class EmitterState(
    val nodeIndex: Int,
    val nodeName: String,
    val options: XRAudioEmitterTrait,
    var playing: Boolean,
    var triggerCount: Int,
    var lastMix: Mix,
  )

  /** Listener callback fired when an emitter plays or is triggered via `select()`. */
  fun interface PlayListener {
    fun onAudioPlay(
      nodeIndex: Int,
      nodeName: String,
      preset: String?,
      src: String?,
      gain: Double,
      pan: Double,
      triggerCount: Int,
    )
  }

  /**
   * Per-session 3D spatial audio controller tracking `XRLiveNodeTraits.audioEmitter` (and legacy
   * `XRLiveNodeTraits.audio`) across node world transforms and listener head poses.
   */
  class EmitterController(
    private val session: XRLiveRuntimeSession,
    private val playListener: PlayListener? = null,
  ) {
    private val emitters = LinkedHashMap<Int, EmitterState>()
    private var muted: Boolean = false

    init {
      syncFromSession()
    }

    /** Discovers or refreshes emitters from `session.traits`. */
    fun syncFromSession() {
      val seen = HashSet<Int>()
      for (t in session.traits) {
        val opts =
          t.audioEmitter
            ?: t.audio?.let {
              XRAudioEmitterTrait(
                src = it.src,
                refDistance = it.refDistance.coerceIn(0.05, 100.0),
                loop = it.loop,
              )
            }
            ?: continue
        seen.add(t.nodeIndex)
        val existing = emitters[t.nodeIndex]
        if (existing == null) {
          val m = DoubleArray(16)
          val hasMatrix = session.nodeWorldMatrix(t.nodeIndex, m)
          val ePos =
            if (hasMatrix) doubleArrayOf(m[12], m[13], m[14]) else doubleArrayOf(0.0, 0.0, 0.0)
          val eFwd =
            if (hasMatrix) {
              val len =
                sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]).let { if (it > 0.0) it else 1.0 }
              doubleArrayOf(m[8] / len, m[9] / len, m[10] / len)
            } else {
              doubleArrayOf(0.0, 0.0, 1.0)
            }
          val initialMix =
            computeMix(
              doubleArrayOf(0.0, 1.6, 0.0),
              doubleArrayOf(0.0, 0.0, -1.0),
              doubleArrayOf(1.0, 0.0, 0.0),
              ePos,
              eFwd,
              opts,
            )
          emitters[t.nodeIndex] =
            EmitterState(
              nodeIndex = t.nodeIndex,
              nodeName = t.name,
              options = opts,
              playing = opts.autoplay,
              triggerCount = if (opts.autoplay) 1 else 0,
              lastMix = initialMix,
            )
        }
      }
      val toRemove = emitters.keys.filter { it !in seen }
      for (k in toRemove) emitters.remove(k)
    }

    /** Returns all tracked emitter states keyed by `nodeIndex`. */
    fun getEmitters(): Map<Int, EmitterState> = emitters

    /** Returns the latest [Mix] for `nodeIndex`. */
    fun getMix(nodeIndex: Int): Mix? = emitters[nodeIndex]?.lastMix

    /** Returns the latest [Mix] for `nodeName`. */
    fun getMix(nodeName: String): Mix? =
      emitters.values.firstOrNull { it.nodeName == nodeName }?.lastMix

    /** Mutes or unmutes all emitters. */
    fun setMuted(muted: Boolean) {
      this.muted = muted
    }

    /**
     * Evaluates 3D distance, cone attenuation, and stereo pan for every emitter given the listener
     * pose.
     */
    @JvmOverloads
    fun step(
      listenerPos: DoubleArray = doubleArrayOf(0.0, 1.6, 0.0),
      listenerForward: DoubleArray = doubleArrayOf(0.0, 0.0, -1.0),
      listenerRight: DoubleArray? = null,
    ) {
      val lRight =
        listenerRight
          ?: run {
            val rx = -listenerForward[2]
            val rz = listenerForward[0]
            val len = hypot(rx, rz)
            if (len > 1e-5) doubleArrayOf(rx / len, 0.0, rz / len) else doubleArrayOf(1.0, 0.0, 0.0)
          }
      val m = DoubleArray(16)
      for ((idx, state) in emitters) {
        val hasMatrix = session.nodeWorldMatrix(idx, m)
        val ePos =
          if (hasMatrix) doubleArrayOf(m[12], m[13], m[14]) else doubleArrayOf(0.0, 0.0, 0.0)
        val eFwd =
          if (hasMatrix) {
            val len =
              sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10]).let { if (it > 0.0) it else 1.0 }
            doubleArrayOf(m[8] / len, m[9] / len, m[10] / len)
          } else {
            doubleArrayOf(0.0, 0.0, 1.0)
          }
        val mix = computeMix(listenerPos, listenerForward, lRight, ePos, eFwd, state.options)
        state.lastMix =
          if (state.playing && !muted) mix
          else mix.copy(gain = 0.0, leftGain = 0.0, rightGain = 0.0)
      }
    }

    /**
     * Handles a user tap/select on `nodeIndex`, triggering `playOnSelect` (or non-autoplay)
     * emitters and firing [PlayListener.onAudioPlay].
     */
    fun select(nodeIndex: Int): Mix? {
      val state = emitters[nodeIndex] ?: return null
      if (!state.options.playOnSelect && state.options.autoplay) return state.lastMix
      return trigger(nodeIndex)
    }

    /** Unconditionally triggers or retriggers `nodeIndex` and notifies [playListener]. */
    fun trigger(nodeIndex: Int): Mix? {
      val state = emitters[nodeIndex] ?: return null
      state.playing = true
      state.triggerCount++
      playListener?.onAudioPlay(
        state.nodeIndex,
        state.nodeName,
        state.options.preset,
        state.options.src,
        state.lastMix.gain,
        state.lastMix.pan,
        state.triggerCount,
      )
      return state.lastMix
    }
  }

  /**
   * Optional Android [AudioTrack] player for procedural ambient loops. Safe to instantiate on JVM
   * unit tests (gracefully no-ops when `AudioTrack` is unavailable).
   */
  class Player(val sampleRate: Int = 22050) {
    private var track: AudioTrack? = null

    fun playLoop(preset: String, mix: Mix): Boolean {
      val pcm = renderAmbientLoopPcm(preset, sampleRate, 2.0)
      return try {
        stop()
        val byteCount = pcm.size * 2
        val t =
          AudioTrack.Builder()
            .setAudioAttributes(
              AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            )
            .setAudioFormat(
              AudioFormat.Builder()
                .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                .setSampleRate(sampleRate)
                .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                .build()
            )
            .setBufferSizeInBytes(byteCount)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        t.write(pcm, 0, pcm.size)
        t.setLoopPoints(0, pcm.size, -1)
        @Suppress("DEPRECATION") t.setStereoVolume(mix.leftGain.toFloat(), mix.rightGain.toFloat())
        t.play()
        track = t
        true
      } catch (_: Throwable) {
        false
      }
    }

    fun updateMix(mix: Mix) {
      try {
        @Suppress("DEPRECATION")
        track?.setStereoVolume(mix.leftGain.toFloat(), mix.rightGain.toFloat())
      } catch (_: Throwable) {}
    }

    fun stop() {
      try {
        track?.stop()
        track?.release()
      } catch (_: Throwable) {}
      track = null
    }
  }
}
