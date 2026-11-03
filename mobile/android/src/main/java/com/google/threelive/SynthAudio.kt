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

/**
 * `synth-audio` for [XRSimWorld] (port of `xr-live/src/sim/synth-audio.ts`).
 *
 * Maps sim events to procedural cues through each node's `audioCues` trait and reports them via
 * [XRSimWorld.Listener.onAudioCue]. [renderPcm] synthesizes a cue to 16-bit mono PCM with the same
 * recipes as the web runtime, and [Player] plays it with [AudioTrack].
 */
object SynthAudio {
  /** One oscillator or noise voice of a cue. */
  data class Voice(
    /** `sine`, `square`, `triangle`, `sawtooth`, or `noise`. */
    val wave: String,
    val f0: Double,
    val at: Double,
    val dur: Double,
    val gain: Double = 0.3,
    val f1: Double? = null,
    /** `lowpass`, `bandpass`, or `highpass` for noise voices. */
    val filter: String? = null,
  )

  const val ALARM_REPEAT_MS: Double = 500.0
  private const val KEY = "synth-audio"

  private fun seq(wave: String, freqs: List<Double>, step: Double, gain: Double): List<Voice> =
    freqs.mapIndexed { i, f ->
      Voice(wave, f, i * step, step, gain)
    }

  /** Synthesis recipe per cue (identical to the web and iOS runtimes). */
  @JvmField
  val RECIPES: Map<String, List<Voice>> =
    mapOf(
      "confirm" to seq("sine", listOf(660.0, 880.0), 0.08, 0.3),
      "error" to seq("square", listOf(330.0, 247.0), 0.09, 0.18),
      "alarm" to
        listOf(Voice("square", 880.0, 0.0, 0.25, 0.18), Voice("square", 660.0, 0.25, 0.25, 0.18)),
      "warning" to listOf(Voice("triangle", 520.0, 0.0, 0.2, 0.35)),
      "pickup" to
        listOf(Voice("square", 987.77, 0.0, 0.06, 0.2), Voice("square", 1318.51, 0.06, 0.22, 0.2)),
      "jump" to listOf(Voice("triangle", 180.0, 0.0, 0.14, 0.35, 520.0)),
      "beam" to listOf(Voice("sawtooth", 880.0, 0.0, 0.11, 0.2, 110.0)),
      "impact" to
        listOf(
          Voice("noise", 1200.0, 0.0, 0.09, 0.4, filter = "bandpass"),
          Voice("triangle", 120.0, 0.0, 0.09, 0.4, 45.0),
        ),
      "burst" to listOf(Voice("noise", 2000.0, 0.0, 0.45, 0.5, 200.0, "lowpass")),
      "powerup" to seq("square", listOf(523.25, 659.25, 783.99, 1046.5), 0.07, 0.2),
      "step" to listOf(Voice("noise", 2500.0, 0.0, 0.04, 0.25, filter = "bandpass")),
      "pass" to seq("triangle", listOf(523.25, 659.25, 783.99, 1046.5), 0.1, 0.3),
      "fail" to seq("sine", listOf(392.0, 311.13, 261.63), 0.133, 0.3),
    )

  /** Total duration of a cue in seconds. */
  @JvmStatic fun duration(cue: String): Double = RECIPES[cue]?.maxOfOrNull { it.at + it.dur } ?: 0.0

  /**
   * Renders [cue] to 16-bit mono PCM at [sampleRate]. Deterministic (seeded noise), so the same cue
   * always produces the same samples.
   */
  @JvmStatic
  @JvmOverloads
  fun renderPcm(
    cue: String,
    sampleRate: Int = 44100,
    pitch: Double = 1.0,
    gain: Double = 1.0,
  ): ShortArray {
    val voices = RECIPES[cue] ?: return ShortArray(0)
    val rate = Math.max(8000, Math.min(96000, sampleRate))
    val total = (duration(cue) * rate).toInt() + 1
    val mix = DoubleArray(total)
    var seed = 0x2545f491
    for (v in voices) {
      val start = (v.at * rate).toInt()
      val n = Math.max(1, (v.dur * rate).toInt())
      var phase = 0.0
      // Biquad state for noise voices.
      var x1 = 0.0
      var x2 = 0.0
      var y1 = 0.0
      var y2 = 0.0
      val peak = Math.max(1e-4, v.gain * gain)
      for (i in 0 until n) {
        val t = i.toDouble() / rate
        val u = i.toDouble() / n
        val f = v.f0 * pitch * if (v.f1 != null) Math.pow(v.f1 / v.f0, u) else 1.0
        val env =
          if (t < 0.005) peak * (t / 0.005)
          else peak * Math.pow(1e-4 / peak, (t - 0.005) / Math.max(1e-3, v.dur - 0.005))
        val s: Double
        if (v.wave == "noise") {
          seed = seed * 1103515245 + 12345
          val x = ((seed ushr 8) and 0xffff) / 32768.0 - 1.0
          val w = 2 * Math.PI * Math.min(f, rate * 0.45) / rate
          val alpha = Math.sin(w) / (2 * 0.707)
          val cw = Math.cos(w)
          val (b0, b1, b2) =
            when (v.filter) {
              "highpass" -> Triple((1 + cw) / 2, -(1 + cw), (1 + cw) / 2)
              "bandpass" -> Triple(alpha, 0.0, -alpha)
              else -> Triple((1 - cw) / 2, 1 - cw, (1 - cw) / 2)
            }
          val a0 = 1 + alpha
          val y = (b0 * x + b1 * x1 + b2 * x2 - (-2 * cw) * y1 - (1 - alpha) * y2) / a0
          x2 = x1
          x1 = x
          y2 = y1
          y1 = y
          s = y
        } else {
          phase += f / rate
          val p = phase - Math.floor(phase)
          s =
            when (v.wave) {
              "square" -> if (p < 0.5) 1.0 else -1.0
              "triangle" -> 1 - 4 * Math.abs(p - 0.5)
              "sawtooth" -> 2 * p - 1
              else -> Math.sin(2 * Math.PI * p)
            }
        }
        val idx = start + i
        if (idx < total) mix[idx] += s * env
      }
    }
    return ShortArray(total) { (Math.max(-1.0, Math.min(1.0, mix[it])) * 32767).toInt().toShort() }
  }

  /** Stereo pan (`-1..1`) and distance gain for world point [pos] relative to the head. */
  @JvmStatic
  fun spatialize(world: XRSimWorld, pos: DoubleArray): DoubleArray {
    val head = world.headPosition()
    val f = world.cameraForwardXZ()
    val rx = pos[0] - head[0]
    val ry = pos[1] - head[1]
    val rz = pos[2] - head[2]
    val d = Math.sqrt(rx * rx + ry * ry + rz * rz)
    val pan = if (d > 1e-6) (rx * -f[2] + rz * f[0]) / d else 0.0
    return doubleArrayOf(Math.max(-1.0, Math.min(1.0, pan)), 1 / (1 + Math.max(0.0, d - 1) * 0.5))
  }

  /** Reports [cue] for [source]; returns `false` when audio is disabled. */
  @JvmStatic
  @JvmOverloads
  fun play(world: XRSimWorld, cue: String, source: XRSimWorld.Body? = null): Boolean {
    if (!world.audioEnabled || cue !in RECIPES) return false
    val opts = source?.traits?.audioCues
    val jitter = opts?.pitchJitter ?: 0.0
    val pitch = 1 + (Math.random() * 2 - 1) * jitter
    var gain = opts?.volume ?: 1.0
    var pan = 0.0
    if (source != null && opts?.spatial != false) {
      val s = spatialize(world, source.center())
      pan = s[0]
      gain *= s[1]
    }
    world.listener?.onAudioCue(cue, pan, gain, pitch)
    return true
  }

  internal class State {
    val unsubs = ArrayList<() -> Unit>()
    val alarms = HashMap<XRSimWorld.Body, DoubleArray>() // [count, nextMs]
  }

  private fun cueFor(b: XRSimWorld.Body?, event: String): String? =
    b?.traits?.audioCues?.cues?.get(event)

  private fun state(world: XRSimWorld): State {
    (world.state[KEY] as? State)?.let {
      return it
    }
    val st = State()
    world.state[KEY] = st
    fun map(type: String, event: String) {
      st.unsubs +=
        world.on(type) { _, body, _ -> cueFor(body, event)?.let { play(world, it, body) } }
    }
    map("xrhit", "onHit")
    map("xrdepleted", "onDepleted")
    map("xrspawn", "onSpawn")
    map("characterjump", "onJump")
    map("characterland", "onLand")
    map("xrzoneexit", "onZoneExit")
    st.unsubs +=
      world.on("xrzoneenter") { _, z, _ ->
        val cue = cueFor(z, "onZoneEnter")
        if (z != null && cue != null) {
          if (cue == "alarm") {
            val a = st.alarms.getOrPut(z) { doubleArrayOf(0.0, world.timeMs) }
            a[0] += 1
          } else {
            play(world, cue, z)
          }
        }
      }
    st.unsubs +=
      world.on("xrzoneexit") { _, z, _ ->
        val a = z?.let { st.alarms[it] }
        if (a != null) {
          a[0] -= 1
          if (a[0] <= 0) st.alarms.remove(z)
        }
      }
    st.unsubs +=
      world.on("xrobjective") { d, body, _ ->
        if (d["outOfOrder"] == true) play(world, "error", body)
        else cueFor(body, "onObjective")?.let { play(world, it, body) }
      }
    st.unsubs +=
      world.on("xrscenarioend") { d, _, _ ->
        play(world, if (d["outcome"] == "pass") "pass" else "fail")
      }
    return st
  }

  internal fun step(world: XRSimWorld, @Suppress("UNUSED_PARAMETER") dt: Double) {
    if (!world.audioEnabled) return
    val st = state(world)
    val it = st.alarms.entries.iterator()
    while (it.hasNext()) {
      val (z, a) = it.next()
      if (z.hidden || z !in world.bodies) {
        it.remove()
      } else if (world.timeMs >= a[1]) {
        a[1] = world.timeMs + ALARM_REPEAT_MS
        play(world, "alarm", z)
      }
    }
  }

  internal fun select(world: XRSimWorld, body: XRSimWorld.Body?) {
    if (!world.audioEnabled) return
    state(world)
    cueFor(body, "onTap")?.let { play(world, it, body) }
  }

  internal fun reset(world: XRSimWorld) {
    (world.state[KEY] as? State)?.alarms?.clear()
  }

  /** Plays rendered cues through [AudioTrack] (static mode, one track per cue). */
  class Player @JvmOverloads constructor(private val sampleRate: Int = 44100) {

    /** Plays [cue] with the [pan] / [gain] / [pitch] from [XRSimWorld.Listener.onAudioCue]. */
    fun play(cue: String, pan: Double, gain: Double, pitch: Double) {
      val pcm = renderPcm(cue, sampleRate, pitch, 1.0)
      if (pcm.isEmpty()) return
      val stereo = ShortArray(pcm.size * 2)
      val l = Math.max(0.0, Math.min(1.0, gain * (1 - Math.max(0.0, pan))))
      val r = Math.max(0.0, Math.min(1.0, gain * (1 + Math.min(0.0, pan))))
      for (i in pcm.indices) {
        stereo[i * 2] = (pcm[i] * l).toInt().toShort()
        stereo[i * 2 + 1] = (pcm[i] * r).toInt().toShort()
      }
      try {
        val track =
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
                .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                .build()
            )
            .setBufferSizeInBytes(stereo.size * 2)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        track.write(stereo, 0, stereo.size)
        track.setNotificationMarkerPosition(pcm.size)
        track.setPlaybackPositionUpdateListener(
          object : AudioTrack.OnPlaybackPositionUpdateListener {
            override fun onMarkerReached(t: AudioTrack) = t.release()

            override fun onPeriodicNotification(t: AudioTrack) {}
          }
        )
        track.play()
      } catch (e: RuntimeException) {
        // Audio output unavailable; cues stay silent.
      }
    }
  }
}
