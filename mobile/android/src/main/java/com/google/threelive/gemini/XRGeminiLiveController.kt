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

package com.google.threelive.gemini

import com.google.threelive.MiniJson
import com.google.threelive.XRHoldToAskTrait
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Who produced a transcript segment. */
enum class TranscriptSpeaker(val wireName: String) {
  USER("user"),
  MODEL("model"),
}

/** One transcript update: the same `{speaker, text, isFinal}` shape as the web `xr-transcription`. */
data class TranscriptEvent(val speaker: TranscriptSpeaker, val text: String, val isFinal: Boolean)

/** Accumulates streaming transcription fragments per speaker (port of the web manager). */
class TranscriptionManager {
  private val partial = HashMap<TranscriptSpeaker, String>()

  /** Appends a fragment and returns the updated (non-final) segment, clipped to 4000 chars. */
  @Synchronized
  fun append(speaker: TranscriptSpeaker, fragment: String): TranscriptEvent {
    val next = ((partial[speaker] ?: "") + fragment).takeLast(XRGeminiLiveController.MAX_TEXT_CHARS)
    partial[speaker] = next
    return TranscriptEvent(speaker, next, false)
  }

  /** Finalizes and clears every non-empty segment (user first, then model). */
  @Synchronized
  fun finalize(): List<TranscriptEvent> {
    val out = ArrayList<TranscriptEvent>()
    for (speaker in TranscriptSpeaker.values()) {
      val text = partial[speaker]
      if (!text.isNullOrEmpty()) out.add(TranscriptEvent(speaker, text, true))
      partial[speaker] = ""
    }
    return out
  }
}

/** Supplies viewport frames (JPEG) for the model to see. */
fun interface FrameSource {
  /** Captures one JPEG frame and calls [onFrame] once (with `null` on failure), on any thread. */
  fun captureJpeg(onFrame: (ByteArray?) -> Unit)
}

/** Plays streamed model audio. */
interface PcmAudioSink {
  /** Queues 16-bit little-endian mono PCM at [sampleRate]. */
  fun enqueue(pcm16le: ByteArray, sampleRate: Int)

  /** Drops all queued audio immediately (barge-in). */
  fun flush()

  /** Releases resources. */
  fun close()
}

/** Options for [XRGeminiLiveController.connect]. */
data class GeminiLiveOptions(
  /** Optional `setup` message sent first (model, system instruction, response modalities...). */
  val setup: Map<String, Any?>? = null,
  /** Viewport frame cadence (clamped to 250–10000 ms). */
  val frameIntervalMs: Long = 1000,
  /** Stream frames from the [FrameSource]. */
  val streamFrames: Boolean = true,
  /** Play streamed model audio through the [PcmAudioSink]. */
  val playAudio: Boolean = true,
)

/**
 * Native port of the web `XRGeminiLiveController`: streams viewport frames and microphone audio to
 * a Gemini Live session, accumulates input / output transcriptions, plays model audio, and handles
 * barge-in (`interrupted`). Thread-safe; [Listener] callbacks run on [callbackExecutor].
 *
 * Connect only after a user interaction (for example on the first tap or hold-to-ask gesture),
 * never at load.
 */
class XRGeminiLiveController
@JvmOverloads
constructor(
  private val frameSource: FrameSource? = null,
  private val audioSink: PcmAudioSink? = null,
  private val callbackExecutor: Executor = Executor { it.run() },
) {
  /** Receives transcripts, barge-in and connection state. */
  interface Listener {
    fun onTranscript(event: TranscriptEvent) {}

    fun onInterrupted() {}

    fun onDisconnected() {}
  }

  @Volatile var listener: Listener? = null

  /** Transcript accumulator (exposed for tests and custom UIs). */
  val transcripts: TranscriptionManager = TranscriptionManager()

  private val lock = Any()
  private var transport: GeminiLiveTransport? = null
  private var playAudio = true
  private var scheduler: ScheduledExecutorService? = null
  private var frameTask: ScheduledFuture<*>? = null
  private val captureInFlight = AtomicBoolean(false)
  @Volatile private var turnHasOutputTranscription = false

  /** Whether a transport is attached. */
  val connected: Boolean
    get() = synchronized(lock) { transport != null }

  /** Attaches [liveTransport] (replacing any previous session) and starts frame streaming. */
  fun connect(liveTransport: GeminiLiveTransport, options: GeminiLiveOptions = GeminiLiveOptions()) {
    disconnect()
    synchronized(lock) {
      transport = liveTransport
      playAudio = options.playAudio
      turnHasOutputTranscription = false
    }
    liveTransport.listener =
      object : GeminiLiveTransport.Listener {
        override fun onMessage(message: Map<String, Any?>) {
          if (synchronized(lock) { transport === liveTransport }) handleServerMessage(message)
        }

        override fun onClose() {
          val wasCurrent =
            synchronized(lock) {
              (transport === liveTransport).also {
                if (it) {
                  transport = null
                  stopFramesLocked()
                }
              }
            }
          if (wasCurrent) emit { it.onDisconnected() }
        }
      }
    options.setup?.let { liveTransport.send(mapOf("setup" to it)) }
    if (options.streamFrames && frameSource != null) {
      val interval = options.frameIntervalMs.coerceIn(250, 10_000)
      synchronized(lock) {
        val s = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "three-live-gemini-frames").apply { isDaemon = true } }
        scheduler = s
        frameTask = s.scheduleWithFixedDelay({ sendFrame() }, interval, interval, TimeUnit.MILLISECONDS)
      }
    }
  }

  /** Stops streaming, closes the transport and finalizes pending transcripts. */
  fun disconnect() {
    val t =
      synchronized(lock) {
        stopFramesLocked()
        transport.also { transport = null }
      }
    t?.close()
    audioSink?.flush()
    for (ev in transcripts.finalize()) emit { it.onTranscript(ev) }
  }

  /** Releases the audio sink. Call when the controller is no longer needed. */
  fun release() {
    disconnect()
    audioSink?.close()
  }

  /** Captures and sends one frame; skipped while a capture is in flight. Returns `true` if started. */
  fun sendFrame(): Boolean {
    val source = frameSource ?: return false
    if (!connected || !captureInFlight.compareAndSet(false, true)) return false
    try {
      source.captureJpeg { jpeg ->
        try {
          val t = synchronized(lock) { transport }
          if (jpeg != null && jpeg.isNotEmpty() && jpeg.size <= MAX_FRAME_BYTES && t != null) {
            t.send(realtimeChunk("image/jpeg", LiveBase64.encode(jpeg)))
          }
        } finally {
          captureInFlight.set(false)
        }
      }
    } catch (e: RuntimeException) {
      captureInFlight.set(false)
      return false
    }
    return true
  }

  /** Sends 16-bit little-endian mono PCM microphone audio (rate clamped to 8–48 kHz). */
  @JvmOverloads
  fun sendAudioChunk(pcm16le: ByteArray, sampleRate: Int = 16_000) {
    val t = synchronized(lock) { transport } ?: return
    if (pcm16le.isEmpty()) return
    val rate = sampleRate.coerceIn(8_000, 48_000)
    t.send(realtimeChunk("audio/pcm;rate=$rate", LiveBase64.encode(pcm16le)))
  }

  /** Sends a completed user text turn (clipped to 4000 chars). */
  fun sendText(text: String) {
    val t = synchronized(lock) { transport } ?: return
    val clipped = text.take(MAX_TEXT_CHARS)
    if (clipped.isEmpty()) return
    t.send(
      mapOf(
        "clientContent" to
          mapOf(
            "turns" to listOf(mapOf("role" to "user", "parts" to listOf(mapOf("text" to clipped)))),
            "turnComplete" to true,
          )
      )
    )
  }

  /** Processes one server message (exposed for custom transports and tests). */
  fun handleServerMessage(message: Map<String, Any?>) {
    val content = MiniJson.asMap(message["serverContent"]) ?: return
    if (content["interrupted"] == true) {
      audioSink?.flush()
      emit { it.onInterrupted() }
    }
    (MiniJson.asMap(content["inputTranscription"])?.get("text") as? String)?.takeIf { it.isNotEmpty() }?.let {
      val ev = transcripts.append(TranscriptSpeaker.USER, it)
      emit { l -> l.onTranscript(ev) }
    }
    (MiniJson.asMap(content["outputTranscription"])?.get("text") as? String)?.takeIf { it.isNotEmpty() }?.let {
      turnHasOutputTranscription = true
      val ev = transcripts.append(TranscriptSpeaker.MODEL, it)
      emit { l -> l.onTranscript(ev) }
    }
    val parts = MiniJson.asList(MiniJson.asMap(content["modelTurn"])?.get("parts"))
    if (parts != null) {
      for (part in parts) {
        val p = MiniJson.asMap(part) ?: continue
        val text = p["text"] as? String
        // In AUDIO mode the transcript comes from outputTranscription; avoid double-appending.
        if (!text.isNullOrEmpty() && !turnHasOutputTranscription) {
          val ev = transcripts.append(TranscriptSpeaker.MODEL, text)
          emit { l -> l.onTranscript(ev) }
        }
        val inline = MiniJson.asMap(p["inlineData"])
        val data = inline?.get("data") as? String
        val mime = inline?.get("mimeType") as? String
        if (
          synchronized(lock) { playAudio } &&
            audioSink != null &&
            data != null &&
            mime != null &&
            mime.startsWith("audio/pcm") &&
            data.length <= MAX_AUDIO_BASE64_CHARS
        ) {
          LiveBase64.decodeOrNull(data)?.let { audioSink.enqueue(it, pcmRateFromMime(mime)) }
        }
      }
    }
    if (content["turnComplete"] == true) {
      turnHasOutputTranscription = false
      for (ev in transcripts.finalize()) emit { it.onTranscript(ev) }
    }
  }

  private fun stopFramesLocked() {
    frameTask?.cancel(false)
    frameTask = null
    scheduler?.shutdownNow()
    scheduler = null
  }

  private fun emit(block: (Listener) -> Unit) {
    val l = listener ?: return
    callbackExecutor.execute {
      try {
        block(l)
      } catch (e: RuntimeException) {
        // Host callbacks must not break the session.
      }
    }
  }

  companion object {
    /** Matches the web client's text caps. */
    const val MAX_TEXT_CHARS: Int = 4000

    private const val MAX_FRAME_BYTES = 4 * 1024 * 1024
    private const val MAX_AUDIO_BASE64_CHARS = 8 * 1024 * 1024

    /** Parses the sample rate from `audio/pcm;rate=N` (clamped 8–48 kHz; default 24 kHz). */
    @JvmStatic
    fun pcmRateFromMime(mime: String?, fallback: Int = 24_000): Int {
      val m = Regex("rate=(\\d+)").find(mime ?: "") ?: return fallback
      val v = m.groupValues[1].toLongOrNull() ?: return fallback
      return v.coerceIn(8_000L, 48_000L).toInt()
    }

    /** The text prompt sent for a hold-to-ask query (port of `buildHoldToAskPrompt`). */
    @JvmStatic
    @JvmOverloads
    fun buildHoldToAskPrompt(meshName: String?, options: XRHoldToAskTrait, transcript: String = ""): String {
      val name = (meshName ?: "").take(256).ifEmpty { "object" }
      val spoken = transcript.trim()
      return "The user is pointing at the 3D object \"$name\". ${spoken.ifEmpty { options.prompt }}".take(MAX_TEXT_CHARS)
    }

    private fun realtimeChunk(mime: String, base64: String): Map<String, Any?> =
      mapOf("realtimeInput" to mapOf("mediaChunks" to listOf(mapOf("mimeType" to mime, "data" to base64))))
  }
}
