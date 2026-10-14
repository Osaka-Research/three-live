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
import com.google.threelive.ThreeLiveDetections
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
  /**
   * Declare the `report_objects` function (merged into [setup] tools) and deliver its calls to
   * [XRGeminiLiveController.Listener.onObjectsReported]. Default `false`.
   */
  val detectObjects: Boolean = false,
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

    /**
     * The model called `report_objects` (only with [GeminiLiveOptions.detectObjects]). [boxes] are
     * validated like the `detections` prop; locate them against the camera of the last frame sent,
     * e.g. with [RendererFrameSource.locate].
     */
    fun onObjectsReported(boxes: List<ThreeLiveDetections.Box>) {}
  }

  @Volatile var listener: Listener? = null

  /** Transcript accumulator (exposed for tests and custom UIs). */
  val transcripts: TranscriptionManager = TranscriptionManager()

  private val lock = Any()
  private var transport: GeminiLiveTransport? = null
  private var playAudio = true
  private var detectObjects = false
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
      detectObjects = options.detectObjects
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
    val setup = if (options.detectObjects) withDetectionTool(options.setup) else options.setup
    setup?.let { liveTransport.send(mapOf("setup" to it)) }
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
    MiniJson.asMap(message["toolCall"])?.let { handleToolCall(it) }
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

  /**
   * Answers `report_objects` calls (when [GeminiLiveOptions.detectObjects] is on). Arguments are
   * untrusted model output: only labels and boxes are read, through [ThreeLiveDetections.fromList].
   * Other functions are left to the host.
   */
  private fun handleToolCall(toolCall: Map<String, Any?>) {
    val t = synchronized(lock) { transport.takeIf { detectObjects } } ?: return
    val calls = MiniJson.asList(toolCall["functionCalls"]) ?: return
    val responses = ArrayList<Map<String, Any?>>()
    for (raw in calls.take(MAX_TOOL_CALLS)) {
      val call = MiniJson.asMap(raw) ?: continue
      if (call["name"] != REPORT_OBJECTS_TOOL) continue
      val boxes = ThreeLiveDetections.fromList(MiniJson.asMap(call["args"])?.get("objects"))
      if (boxes.isNotEmpty()) emit { it.onObjectsReported(boxes) }
      val response = LinkedHashMap<String, Any?>()
      (call["id"] as? String)?.let { response["id"] = it.take(256) }
      response["name"] = REPORT_OBJECTS_TOOL
      response["response"] = mapOf("ok" to true, "located" to boxes.size)
      responses.add(response)
    }
    if (responses.isNotEmpty()) t.send(mapOf("toolResponse" to mapOf("functionResponses" to responses)))
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

    /** Name of the opt-in object-detection function exposed to the model. */
    const val REPORT_OBJECTS_TOOL: String = "report_objects"

    /** Maximum function calls handled per `toolCall` message. */
    const val MAX_TOOL_CALLS: Int = 8

    /** Live API declaration of [REPORT_OBJECTS_TOOL] (same as web `REPORT_OBJECTS_DECLARATION`). */
    @JvmField
    val REPORT_OBJECTS_DECLARATION: Map<String, Any?> =
      mapOf(
        "name" to REPORT_OBJECTS_TOOL,
        "description" to
          "Reports objects visible in the most recent image of the 3D scene or camera view so the app " +
            "can locate them in 3D. Call it when the user asks where something is or to find objects.",
        "parameters" to
          mapOf(
            "type" to "OBJECT",
            "properties" to
              mapOf(
                "objects" to
                  mapOf(
                    "type" to "ARRAY",
                    "items" to
                      mapOf(
                        "type" to "OBJECT",
                        "properties" to
                          mapOf(
                            "label" to mapOf("type" to "STRING", "description" to "Short name of the object."),
                            "box_2d" to
                              mapOf(
                                "type" to "ARRAY",
                                "items" to mapOf("type" to "NUMBER"),
                                "description" to "Bounding box [ymin, xmin, ymax, xmax], normalized to 0-1000.",
                              ),
                          ),
                        "required" to listOf("label", "box_2d"),
                      ),
                  )
              ),
            "required" to listOf("objects"),
          ),
      )

    /**
     * Returns a copy of [setup] whose `tools` include [REPORT_OBJECTS_DECLARATION] (added once), or
     * `null` without a setup (an ephemeral token must then declare the tool in its locked setup).
     */
    @JvmStatic
    fun withDetectionTool(setup: Map<String, Any?>?): Map<String, Any?>? {
      if (setup == null) return null
      val tools = ArrayList<Any?>(MiniJson.asList(setup["tools"]) ?: emptyList())
      val declared =
        tools.any { tool ->
          MiniJson.asList(MiniJson.asMap(tool)?.get("functionDeclarations"))?.any {
            MiniJson.asMap(it)?.get("name") == REPORT_OBJECTS_TOOL
          } == true
        }
      if (!declared) tools.add(mapOf("functionDeclarations" to listOf(REPORT_OBJECTS_DECLARATION)))
      return LinkedHashMap(setup).apply { put("tools", tools) }
    }

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
