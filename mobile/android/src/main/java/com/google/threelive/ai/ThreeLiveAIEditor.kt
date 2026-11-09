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
import com.google.threelive.ThreeCompiler
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One chat message sent to an AI provider. */
data class AIChatMessage(val role: String, val content: String)

/** A pluggable code model (any LLM). Mirrors `ThreeLiveAIProvider` on the web. */
fun interface AIProvider {
  /** Returns the model's reply to [messages]. */
  suspend fun complete(messages: List<AIChatMessage>): String
}

/**
 * `ai-chat`: any Chat Completions-compatible endpoint (your backend proxy, Ollama, LM Studio,
 * vLLM, OpenRouter, the Gemini compatibility endpoint, ...). `POST {model, messages}` and read
 * `choices[0].message.content`.
 *
 * API keys never belong in an app: point [endpoint] at your own proxy (or a local model), or pass
 * short-lived credentials in [headers].
 *
 * @param endpoint full Chat Completions URL: `https://`, or `http://` to loopback only.
 */
class AIChatProvider
@JvmOverloads
constructor(
  private val endpoint: String,
  private val model: String? = null,
  private val headers: Map<String, String> = emptyMap(),
  private val temperature: Double = 0.2,
  private val timeoutMs: Int = 120_000,
  private val openConnection: (URL) -> HttpURLConnection = { it.openConnection() as HttpURLConnection },
) : AIProvider {

  init {
    require(isAllowedEndpoint(endpoint)) {
      "ai-chat: endpoint must be an https:// URL (or http:// on localhost)."
    }
  }

  override suspend fun complete(messages: List<AIChatMessage>): String =
    withContext(Dispatchers.IO) {
      val body = mutableMapOf<String, Any?>(
        "messages" to messages.map { mapOf("role" to it.role, "content" to it.content) },
        "temperature" to temperature,
        "stream" to false,
      )
      if (!model.isNullOrEmpty()) body["model"] = model
      val conn = openConnection(URL(endpoint))
      try {
        conn.requestMethod = "POST"
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        for ((k, v) in headers) conn.setRequestProperty(k, v)
        conn.outputStream.use { it.write(MiniJson.stringify(body).toByteArray(Charsets.UTF_8)) }
        val code = conn.responseCode
        val stream = if (code in 200..299) conn.inputStream else conn.errorStream
        val text = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
        if (code !in 200..299) {
          throw AIEditException("ai-chat: HTTP $code from endpoint: ${text.take(300)}")
        }
        parseContent(text)
      } finally {
        conn.disconnect()
      }
    }

  companion object {
    /** `https:`, or `http:` to a loopback host. */
    @JvmStatic
    fun isAllowedEndpoint(raw: String): Boolean =
      try {
        val url = URL(raw)
        url.protocol == "https" ||
          (url.protocol == "http" && url.host in setOf("localhost", "127.0.0.1", "[::1]", "::1"))
      } catch (e: Exception) {
        false
      }

    /** Extracts `choices[0].message.content` (a string or an array of text parts). */
    @JvmStatic
    fun parseContent(json: String): String {
      val root = MiniJson.parseObjectOrNull(json) ?: throw AIEditException("ai-chat: endpoint returned non-JSON content.")
      val choice = MiniJson.asList(root["choices"])?.firstOrNull()
      val content = MiniJson.asMap(MiniJson.asMap(choice)?.get("message"))?.get("content")
      val text =
        when (content) {
          is String -> content
          is List<*> -> content.joinToString("") { p -> (p as? String) ?: (MiniJson.asMap(p)?.get("text") as? String ?: "") }
          else -> null
        }
      if (text.isNullOrBlank()) throw AIEditException("ai-chat: response had no message content.")
      return text
    }
  }
}

/** Thrown for provider and protocol failures. */
class AIEditException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The shared Rust core (`three_live_ai_call`): prompts, reply parsing, edit validation, and the
 * realtime voice protocols, identical to the web plugin. Injectable so host tests can run without
 * the native library.
 */
fun interface AICore {
  suspend fun call(request: Map<String, Any?>): Map<String, Any?>
}

/** [AICore] backed by `libthree_live_compiler`. */
object NativeAICore : AICore {
  override suspend fun call(request: Map<String, Any?>): Map<String, Any?> {
    val text = MiniJson.stringify(request)
    // `validate` compiles with the warm engine on the compiler thread; the other ops are pure and
    // must not queue behind a compile (they run for every streamed audio message).
    val reply = if (request["op"] == "validate") ThreeCompiler.aiCall(text) else ThreeCompiler.aiCallPure(text)
    return MiniJson.parseObjectOrNull(reply) ?: mapOf("error" to "invalid response from native core")
  }
}

/** Result of [ThreeLiveAIEditor.editScene]. Mirrors `EditSceneResult` on the web. */
data class EditResult(
  /** True when the edit compiled and was applied (or would be, for a dry run). */
  val applied: Boolean,
  /** The validated script (or the last rejected candidate). */
  val code: String,
  /** Automatic repair turns used. */
  val repairs: Int,
  /** Non-fatal compiler warnings. */
  val warnings: List<String>,
  /** Why the edit was rejected, when [applied] is false. */
  val error: String? = null,
)

/**
 * Bring-your-own-LLM scene editing for Android (B2b-2), with the same behavior as
 * `el.editScene()` on the web: the instruction and current script go to [provider]; the reply is
 * compiled and checked by the shared core *before* [applyScene] touches the live scene; a failed
 * compile gets one automatic repair turn with the exact error.
 *
 * ```kotlin
 * val editor = ThreeLiveAIEditor(sceneScript, AIChatProvider("https://your-backend.example/chat")) { code ->
 *   renderer.loadGlb(ThreeCompiler.compileToBytes(code))
 * }
 * renderer.listener = object : ThreeLiveRendererListener {
 *   override fun onPick(pick: ThreeLivePick) { editor.toggleSelection(sceneIndex.nodeName(pick.nodeIndex)) }
 * }
 * val result = editor.editScene("make the roof red")
 * ```
 *
 * @param applyScene loads an accepted script into the live scene (typically compile + render).
 */
class ThreeLiveAIEditor
@JvmOverloads
constructor(
  initialSource: String,
  @Volatile var provider: AIProvider,
  private val applyScene: suspend (String) -> Unit,
  private val core: AICore = NativeAICore,
) {
  /** Notified before and after each edit (on the calling coroutine). */
  interface Listener {
    fun onEditStart(instruction: String, selection: String?) {}

    fun onEdit(instruction: String, result: EditResult) {}

    fun onSelectionChanged(selection: String?) {}
  }

  @Volatile var listener: Listener? = null

  /** The current scene script (the base for the next edit). */
  @Volatile
  var source: String = initialSource
    private set

  /** Mesh the next instruction refers to ("make *this* red"), usually set by a tap. */
  @Volatile
  var selection: String? = null
    set(value) {
      val v = value?.takeIf { it.isNotEmpty() }
      if (field != v) {
        field = v
        listener?.onSelectionChanged(v)
      }
    }

  private val history = ArrayDeque<String>()
  private val lock = Any()
  @Volatile private var generation = 0

  /** Tap-to-select: selects [meshName], or clears the selection when it is already selected. */
  fun toggleSelection(meshName: String?): String? {
    selection = if (meshName.isNullOrEmpty() || meshName == selection) null else meshName
    return selection
  }

  /** Replaces the base script (e.g. after the app loads a different scene); clears undo. */
  fun resetSource(script: String) {
    synchronized(lock) {
      source = script
      history.clear()
    }
  }

  /**
   * Edits the scene. A newer call supersedes an in-flight one (which then returns
   * `applied = false`). Never throws for model or compile failures; those come back as [EditResult.error].
   */
  suspend fun editScene(
    instruction: String,
    selection: String? = this.selection,
    maxRepairs: Int = 1,
    dryRun: Boolean = false,
  ): EditResult {
    val text = instruction.trim()
    require(text.isNotEmpty()) { "editScene: instruction is empty." }
    val myGen = synchronized(lock) { ++generation }
    val base = source
    val repairsAllowed = maxRepairs.coerceIn(0, 3)
    listener?.onEditStart(text, selection)
    var code = ""
    var error: String? = null
    var warnings = emptyList<String>()
    var repairs = 0
    fun superseded() = generation != myGen
    try {
      val built = core.call(mapOf("op" to "messages", "source" to base, "selection" to selection, "instruction" to text))
      val messages =
        MiniJson.asList(built["messages"])?.mapNotNull { m ->
          val map = MiniJson.asMap(m) ?: return@mapNotNull null
          AIChatMessage(map["role"] as? String ?: return@mapNotNull null, map["content"] as? String ?: "")
        }?.toMutableList() ?: throw AIEditException("core: ${built["error"] ?: "no messages"}")
      for (turn in 0..repairsAllowed) {
        val reply = provider.complete(messages)
        if (superseded()) return finish(text, EditResult(false, code, repairs, warnings, SUPERSEDED))
        code = core.call(mapOf("op" to "extract", "reply" to reply))["code"] as? String ?: ""
        val v = core.call(mapOf("op" to "validate", "code" to code, "selection" to selection, "instruction" to text))
        if (superseded()) return finish(text, EditResult(false, code, repairs, warnings, SUPERSEDED))
        warnings = MiniJson.asList(v["warnings"])?.filterIsInstance<String>() ?: emptyList()
        error = if (v["ok"] == true) null else (v["error"] as? String ?: "The edit was rejected.")
        if (error == null) break
        if (turn < repairsAllowed) {
          repairs++
          val repair = core.call(mapOf("op" to "repair", "error" to error))["message"] as? String ?: error
          messages += AIChatMessage("assistant", reply)
          messages += AIChatMessage("user", repair)
        }
      }
    } catch (e: kotlin.coroutines.cancellation.CancellationException) {
      throw e
    } catch (e: Exception) {
      error = e.message ?: e.toString()
    }
    if (error == null && !dryRun) {
      try {
        applyScene(code)
        synchronized(lock) {
          history.addLast(base)
          while (history.size > MAX_HISTORY) history.removeFirst()
          source = code
        }
      } catch (e: kotlin.coroutines.cancellation.CancellationException) {
        throw e
      } catch (e: Exception) {
        error = "The edit compiled but failed to load: ${e.message ?: e}"
        try {
          applyScene(base)
        } catch (ignored: Exception) {
          // Best effort: restore the previous scene.
        }
      }
    }
    return finish(text, EditResult(error == null, code, repairs, warnings, error))
  }

  /** Restores the script from before the last applied edit. Returns false when nothing to undo. */
  suspend fun undo(): Boolean {
    val prev = synchronized(lock) { history.removeLastOrNull() } ?: return false
    applyScene(prev)
    synchronized(lock) { source = prev }
    return true
  }

  /** Short spoken summary of [result] (shared wording with the web). */
  suspend fun describe(result: EditResult): String =
    core.call(mapOf("op" to "describe", "applied" to result.applied, "error" to result.error))["text"] as? String
      ?: if (result.applied) "Done." else "Sorry, I couldn't apply that."

  private fun finish(instruction: String, result: EditResult): EditResult {
    listener?.onEdit(instruction, result)
    return result
  }

  companion object {
    const val MAX_HISTORY = 20
    const val SUPERSEDED = "editScene superseded by a newer call"
  }
}
