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

package com.google.threelive.ai

import com.google.threelive.MiniJson
import com.google.threelive.gemini.GeminiLiveTransport
import com.google.threelive.gemini.LiveBase64
import com.google.threelive.gemini.PcmAudioSink
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/** States reported by [AIVoiceSession.Listener.onState]. Mirrors `AIVoiceState` on the web. */
enum class AIVoiceState { CONNECTING, LISTENING, THINKING, EDITING, SPEAKING, CLOSED, ERROR }

/**
 * Realtime voice editing for Android (B2b-2): a voice conversation where the voice model talks and
 * calls the `edit_scene` / `undo_edit` / `select_meshes` tools, which run
 * [ThreeLiveAIEditor.editScene] / [ThreeLiveAIEditor.selectByVoice] with the editor's code model, so
 * edit quality never depends on the voice model.
 *
 * Protocols (built and parsed by the shared Rust core, identical to the web `connectVoice`):
 * - `ai-realtime`: any server speaking the Realtime WebSocket event protocol (24 kHz audio).
 * - `gemini-live`: the Gemini Live API (16 kHz microphone audio).
 *
 * ```kotlin
 * val transport = WebSocketLiveTransport("wss://your-backend.example/realtime")
 * val session = AIVoiceSession(editor, transport, scope, sink = AudioTrackPcmSink())
 * val rate = session.start()
 * val mic = MicrophoneStreamer(rate) { session.sendAudio(it) }.also { it.start(context) }
 * ```
 * Point the transport at your own proxy or an ephemeral-token URL; never ship API keys.
 */
class AIVoiceSession
@JvmOverloads
constructor(
  private val editor: ThreeLiveAIEditor,
  private val transport: GeminiLiveTransport,
  private val scope: CoroutineScope,
  private val provider: String = "ai-realtime",
  private val sink: PcmAudioSink? = null,
  private val options: Options = Options(),
  private val core: AICore = NativeAICore,
) {
  /** Optional session settings. */
  data class Options(
    val model: String? = null,
    val voice: String? = null,
    /** Extra system instructions for the voice model. */
    val instructions: String = "",
    /** Provider-specific fields deep-merged into the setup / session message. */
    val session: Map<String, Any?>? = null,
  )

  /** Session callbacks (invoked on transport or coroutine threads). */
  interface Listener {
    fun onState(state: AIVoiceState) {}

    fun onTranscript(speaker: String, text: String, isFinal: Boolean) {}

    fun onEdit(instruction: String, result: EditResult) {}

    /** The voice model changed (or tried to change) the selection with `select_meshes`. */
    fun onSelection(selection: AIVoiceSelection) {}

    fun onError(message: String) {}
  }

  @Volatile var listener: Listener? = null

  @Volatile
  var state: AIVoiceState = AIVoiceState.CONNECTING
    private set

  private val closed = AtomicBoolean(false)
  /** Server messages, handled one at a time and in order (audio chunks must not reorder). */
  private val inbox = Channel<Map<String, Any?>>(Channel.UNLIMITED)
  private val userText = StringBuilder()
  private val modelText = StringBuilder()
  private var inputRate = if (provider == "gemini-live") 16_000 else 24_000
  private val previousEditorListener = editor.listener

  init {
    require(provider == "ai-realtime" || provider == "gemini-live") {
      "AIVoiceSession: unknown provider '$provider' (use ai-realtime or gemini-live)."
    }
  }

  /** Sends the session setup and returns the microphone sample rate to stream at. */
  suspend fun start(): Int {
    transport.listener =
      object : GeminiLiveTransport.Listener {
        override fun onMessage(message: Map<String, Any?>) {
          inbox.trySend(message)
        }

        override fun onClose() {
          shutdown()
        }
      }
    val setup =
      core.call(
        mapOf(
          "op" to "voice_setup",
          "provider" to provider,
          "instructions" to options.instructions,
          "model" to options.model,
          "voice" to options.voice,
          "session" to options.session,
        )
      )
    (setup["error"] as? String)?.let { throw AIEditException(it) }
    scope.launch { for (message in inbox) handle(message) }
    (setup["inputRate"] as? Double)?.let { inputRate = it.toInt() }
    sendAll(setup["messages"])
    editor.listener =
      object : ThreeLiveAIEditor.Listener {
        override fun onEditStart(instruction: String, selection: String?) {
          previousEditorListener?.onEditStart(instruction, selection)
        }

        override fun onEdit(instruction: String, result: EditResult) {
          previousEditorListener?.onEdit(instruction, result)
        }

        override fun onSelectionChanged(selection: String?) {
          previousEditorListener?.onSelectionChanged(selection)
        }

        override fun onSelectionsChanged(selections: List<String>, source: String) {
          previousEditorListener?.onSelectionsChanged(selections, source)
          // Voice selections come back in the select_meshes tool result instead.
          if (source != "voice") scope.launch { sendContext(editor.describeSelection(selections)) }
        }
      }
    if (editor.selections.isNotEmpty()) sendContext(editor.describeSelection(editor.selections))
    setState(AIVoiceState.LISTENING)
    return inputRate
  }

  /** Streams one microphone chunk (16-bit little-endian mono PCM at the rate [start] returned). */
  fun sendAudio(pcm16le: ByteArray) {
    if (closed.get() || pcm16le.isEmpty()) return
    val b64 = LiveBase64.encode(pcm16le)
    // Built locally (not through the core) so audio never waits on a JNI round trip.
    transport.send(
      if (provider == "gemini-live") {
        mapOf("realtimeInput" to mapOf("audio" to mapOf("mimeType" to "audio/pcm;rate=16000", "data" to b64)))
      } else {
        mapOf("type" to "input_audio_buffer.append", "audio" to b64)
      }
    )
  }

  /** Sends a typed user message and asks for a reply. */
  suspend fun sendText(text: String) {
    val t = text.trim().take(MAX_TEXT)
    if (t.isEmpty() || closed.get()) return
    sendAll(core.call(mapOf("op" to "voice_text", "provider" to provider, "text" to t, "respond" to true))["messages"])
  }

  /** Ends the session. Idempotent. */
  fun close() {
    if (closed.get()) return
    transport.listener = null
    transport.close()
    shutdown()
  }

  private fun shutdown() {
    if (!closed.compareAndSet(false, true)) return
    inbox.close()
    sink?.close()
    editor.listener = previousEditorListener
    setState(AIVoiceState.CLOSED)
  }

  private suspend fun sendContext(text: String) {
    if (closed.get()) return
    sendAll(core.call(mapOf("op" to "voice_text", "provider" to provider, "text" to text, "respond" to false))["messages"])
  }

  private fun sendAll(messages: Any?) {
    if (closed.get()) return
    for (m in MiniJson.asList(messages) ?: emptyList()) MiniJson.asMap(m)?.let { transport.send(it) }
  }

  private fun setState(s: AIVoiceState) {
    state = s
    listener?.onState(s)
  }

  internal suspend fun handle(message: Map<String, Any?>) {
    if (closed.get()) return
    val parsed = core.call(mapOf("op" to "voice_parse", "provider" to provider, "message" to message))
    var calls = 0
    for (raw in MiniJson.asList(parsed["events"]) ?: emptyList()) {
      val ev = MiniJson.asMap(raw) ?: continue
      when (ev["type"]) {
        "audio" -> {
          if (state != AIVoiceState.EDITING) state = AIVoiceState.SPEAKING
          val bytes = LiveBase64.decodeOrNull(ev["base64"] as? String ?: "") ?: continue
          sink?.enqueue(bytes, (ev["rate"] as? Double)?.toInt() ?: 24_000)
        }
        "interrupted" -> sink?.flush()
        "transcript" -> {
          val speaker = ev["speaker"] as? String ?: "model"
          val isFinal = ev["isFinal"] == true
          val buf = if (speaker == "user") userText else modelText
          if (isFinal) buf.setLength(0)
          buf.append(ev["text"] as? String ?: "")
          if (buf.length > MAX_TEXT) buf.delete(0, buf.length - MAX_TEXT)
          listener?.onTranscript(speaker, buf.toString(), isFinal)
          if (isFinal) buf.setLength(0)
        }
        "turnComplete" -> {
          if (userText.isNotEmpty()) {
            listener?.onTranscript("user", userText.toString(), true)
            userText.setLength(0)
          }
          if (modelText.isNotEmpty()) {
            listener?.onTranscript("model", modelText.toString(), true)
            modelText.setLength(0)
          }
          if (state == AIVoiceState.SPEAKING || state == AIVoiceState.THINKING) setState(AIVoiceState.LISTENING)
        }
        "toolCall" ->
          if (++calls <= MAX_TOOL_CALLS) {
            val id = ev["id"] as? String ?: ""
            val name = ev["name"] as? String ?: ""
            val args = MiniJson.asMap(ev["args"]) ?: emptyMap()
            scope.launch { runTool(id, name, args) }
          }
        "error" -> listener?.onError(ev["message"] as? String ?: "voice server error")
      }
    }
  }

  internal suspend fun runTool(id: String, name: String, args: Map<String, Any?>) {
    val output: Map<String, Any?> =
      try {
        when (name) {
          "edit_scene" -> {
            val instruction = (args["instruction"] as? String ?: "").trim().take(MAX_TEXT)
            if (instruction.isEmpty()) throw AIEditException("instruction is empty")
            setState(AIVoiceState.EDITING)
            val result = editor.editScene(instruction)
            listener?.onEdit(instruction, result)
            setState(AIVoiceState.THINKING)
            if (result.applied) mapOf("applied" to true, "repairs" to result.repairs.toDouble())
            else mapOf("applied" to false, "error" to (result.error ?: "edit rejected"))
          }
          "undo_edit" -> if (editor.undo()) mapOf("undone" to true) else mapOf("undone" to false, "error" to "nothing to undo")
          "select_meshes" -> {
            val mode = (args["mode"] as? String)?.takeIf { it in SELECT_MODES } ?: "replace"
            val names = MiniJson.asList(args["names"])?.filterIsInstance<String>().orEmpty()
            val sel =
              if (names.isNotEmpty() && mode != "clear") editor.selectNames(names, mode)
              else editor.selectByVoice((args["query"] as? String).orEmpty(), mode)
            listener?.onSelection(sel)
            buildMap {
              put("changed", sel.applied)
              put("selected", sel.meshes.take(ThreeLiveAIEditor.MAX_SELECTION))
              put("say", sel.say)
              if (!sel.applied) {
                put("question", sel.say)
                put("candidates", sel.candidates)
              }
            }
          }
          else -> mapOf("error" to "unknown tool $name")
        }
      } catch (e: kotlin.coroutines.cancellation.CancellationException) {
        throw e
      } catch (e: Exception) {
        if (state == AIVoiceState.EDITING) setState(AIVoiceState.THINKING)
        mapOf("applied" to false, "error" to (e.message ?: e.toString()))
      }
    if (closed.get()) return
    sendAll(
      core.call(mapOf("op" to "voice_tool_result", "provider" to provider, "id" to id, "name" to name, "output" to output))[
        "messages"]
    )
  }

  companion object {
    const val MAX_TEXT = 2000
    const val MAX_TOOL_CALLS = 8
    private val SELECT_MODES = setOf("replace", "add", "remove", "clear")
  }
}
