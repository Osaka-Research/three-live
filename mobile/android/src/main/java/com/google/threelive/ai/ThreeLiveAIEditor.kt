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
    // `validate` (and `select` / `select_messages` with a `source`) run the scene on the warm engine
    // on the compiler thread; the other ops are pure and must not queue behind a compile (they run
    // for every streamed audio message).
    val usesEngine = request["op"] == "validate" || (request["op"] in ENGINE_SELECT_OPS && request["source"] != null)
    val reply = if (usesEngine) ThreeCompiler.aiCall(text) else ThreeCompiler.aiCallPure(text)
    return MiniJson.parseObjectOrNull(reply) ?: mapOf("error" to "invalid response from native core")
  }
}

private val ENGINE_SELECT_OPS = setOf("select", "select_messages")

/** Camera that "left", "right", and "front" in spoken references are relative to (world space). */
data class AICamera(val eye: List<Double>, val target: List<Double>)

/** Outcome of a spoken selection request (Talk-to-Select). Mirrors `AIVoiceSelection` on the web. */
data class AIVoiceSelection(
  /** `replace`, `add`, `remove`, or `clear`. */
  val mode: String,
  val query: String,
  /** Whether the selection changed to what was asked. */
  val applied: Boolean,
  /** 1: resolved locally; 2: the code model resolved (or asked about) it. */
  val tier: Int,
  /** The selection afterwards. */
  val meshes: List<String>,
  /** Meshes to offer when the reference was ambiguous. */
  val candidates: List<String>,
  /** What to say back: a confirmation, or a question when the reference was unclear. */
  val say: String,
)

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
 * editor.selectByVoice("the two red chairs on the left") // Talk-to-Select
 * val result = editor.editScene("make them blue")
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

    /** The first selected mesh changed (single-selection listeners). */
    fun onSelectionChanged(selection: String?) {}

    /** The selection changed; [source] is `tap`, `voice`, or `api`. */
    fun onSelectionsChanged(selections: List<String>, source: String) {}
  }

  @Volatile var listener: Listener? = null

  /** The current scene script (the base for the next edit). */
  @Volatile
  var source: String = initialSource
    private set

  /** Meshes the next instruction refers to ("make *these* red"), set by taps or by voice. */
  var selections: List<String>
    get() = selectionsField
    set(value) = assignSelection(value, "api")

  /** The first selected mesh (single-selection compatibility). Setting it replaces the selection. */
  var selection: String?
    get() = selections.firstOrNull()
    set(value) {
      selections = listOfNotNull(value?.takeIf { it.isNotEmpty() })
    }

  /** Camera for "left" / "right" / "front" in [selectByVoice] (default: the scene's camera). */
  @Volatile var camera: AICamera? = null

  /** Let [provider] resolve references the local matcher can't (tier 2; default true). */
  @Volatile var selectWithModel: Boolean = true

  private val selectionLock = Any()

  private fun assignSelection(value: List<String>, source: String) {
    val v = cleanSelection(value)
    val previous: List<String>
    synchronized(selectionLock) {
      previous = selectionsField
      if (previous == v) return
      selectionsField = v
    }
    listener?.let {
      it.onSelectionsChanged(v, source)
      if (previous.firstOrNull() != v.firstOrNull()) it.onSelectionChanged(v.firstOrNull())
    }
  }

  @Volatile private var selectionsField: List<String> = emptyList()

  private val history = ArrayDeque<String>()
  private val lock = Any()
  @Volatile private var generation = 0

  /**
   * Tap-to-select: selects [meshName] (tapping the only selected mesh clears it). With [additive]
   * (e.g. a long press), toggles [meshName] in the selection instead. Returns the first selected mesh.
   */
  @JvmOverloads
  fun toggleSelection(meshName: String?, additive: Boolean = false): String? {
    val current = selections
    val next =
      when {
        meshName.isNullOrEmpty() -> if (additive) current else emptyList()
        additive -> if (meshName in current) current - meshName else current + meshName
        current == listOf(meshName) -> emptyList()
        else -> listOf(meshName)
      }
    assignSelection(next, "tap")
    return selection
  }

  /** Changes the selection: [mode] is `replace`, `add`, `remove`, `toggle`, or `clear`. */
  @JvmOverloads
  fun setSelection(names: List<String>, mode: String = "replace", source: String = "api"): List<String> {
    val current = selections
    val given = cleanSelection(names)
    val next =
      when (mode) {
        "clear" -> emptyList()
        "add" -> current + given
        "remove" -> current - given.toSet()
        "toggle" -> (current - given.toSet()) + given.filter { it !in current }
        else -> given
      }
    assignSelection(next, source)
    return selections
  }

  /**
   * Talk-to-Select: changes the selection from a spoken reference ("the two red chairs on the left")
   * with the shared matcher, falling back to [provider] for references it can't resolve ("the lamp
   * next to the sofa"). Nothing changes unless the match is confident; [AIVoiceSelection.say] then
   * asks which one was meant. `mode = "remove"` only looks inside the current selection.
   */
  @JvmOverloads
  suspend fun selectByVoice(query: String, mode: String = "replace"): AIVoiceSelection {
    val q = query.take(MAX_QUERY)
    if (mode == "clear") {
      setSelection(emptyList(), "clear", "voice")
      return AIVoiceSelection(mode, q, true, 1, emptyList(), emptyList(), say(mode, null, emptyList(), q))
    }
    val within = if (mode == "remove") selections else null
    if (within != null && within.isEmpty()) {
      return AIVoiceSelection(mode, q, false, 1, emptyList(), emptyList(), "Nothing is selected.")
    }
    val scene = sceneArgs(within)
    var match: Map<String, Any?> = core.call(scene + mapOf("op" to "select", "query" to q))
    var tier = 1
    var question = ""
    val reason = match["reason"]
    if (selectWithModel && q.isNotBlank() && match["confidence"] == "none" && (reason == "relation" || reason == "no_match")) {
      try {
        val built = core.call(scene + mapOf("op" to "select_messages", "query" to q, "selection" to selections))
        val reply = provider.complete(toMessages(built))
        val parsed = core.call(mapOf("op" to "select_parse", "reply" to reply, "names" to built["names"]))
        val names = strings(parsed["names"])
        tier = 2
        question = parsed["question"] as? String ?: ""
        match =
          if (parsed["confidence"] == "high") {
            mapOf("confidence" to "high", "reason" to "model", "names" to names, "candidates" to emptyList<String>())
          } else {
            mapOf(
              "confidence" to if (names.isEmpty()) "none" else "ambiguous",
              "reason" to "model",
              "names" to emptyList<String>(),
              "candidates" to names.take(10),
            )
          }
      } catch (e: kotlin.coroutines.cancellation.CancellationException) {
        throw e
      } catch (e: Exception) {
        // Tier 2 failed (network, quota): keep the tier-1 answer.
      }
    }
    val names = strings(match["names"])
    var applied = false
    if (match["confidence"] == "high" && names.isNotEmpty()) {
      setSelection(names, mode, "voice")
      applied = true
    }
    val meshes = selections
    val text = if (!applied && question.isNotEmpty()) question else say(mode, match, meshes, q)
    return AIVoiceSelection(mode, q, applied, tier, meshes, strings(match["candidates"]), text)
  }

  /** Selects meshes by exact name (a voice model's `names`); names not in the scene are ignored. */
  @JvmOverloads
  suspend fun selectNames(names: List<String>, mode: String = "replace"): AIVoiceSelection {
    val index = core.call(sceneArgs(null) + mapOf("op" to "select", "query" to "", "withIndex" to true))
    val known = MiniJson.asList(index["index"])?.mapNotNull { MiniJson.asMap(it)?.get("name") as? String }?.toSet() ?: emptySet()
    val valid = names.filter { it in known }.take(MAX_SELECTION)
    val query = names.joinToString(", ").take(200)
    if (valid.isEmpty()) {
      val none = mapOf("confidence" to "none", "reason" to "no_match", "names" to emptyList<String>(), "candidates" to emptyList<String>())
      return AIVoiceSelection(mode, query, false, 1, selections, emptyList(), say(mode, none, selections, query))
    }
    setSelection(valid, mode, "voice")
    val matched = mapOf("confidence" to "high", "reason" to "exact", "names" to valid, "candidates" to emptyList<String>())
    return AIVoiceSelection(mode, query, true, 1, selections, emptyList(), say(mode, matched, selections, query))
  }

  /** Parses a push-to-talk utterance (`{kind, mode?, query?, instruction?}`; see `parse_command`). */
  suspend fun parseCommand(text: String): Map<String, Any?> = core.call(mapOf("op" to "parse_command", "text" to text))

  /** Context sentence describing the selection for a voice model (shared wording with the web). */
  suspend fun describeSelection(meshes: List<String> = selections): String =
    core.call(mapOf("op" to "select_context", "meshes" to meshes))["text"] as? String
      ?: if (meshes.isEmpty()) "The user cleared the selection." else "The user selected ${meshes.joinToString { "\"$it\"" }}."

  private fun sceneArgs(within: List<String>?): Map<String, Any?> {
    val args = mutableMapOf<String, Any?>("source" to source)
    camera?.let { args["camera"] = mapOf("eye" to it.eye, "target" to it.target) }
    if (within != null) args["within"] = within
    return args
  }

  private suspend fun say(mode: String, match: Map<String, Any?>?, meshes: List<String>, query: String): String =
    core.call(mapOf("op" to "select_say", "mode" to mode, "match" to match, "meshes" to meshes, "query" to query))["text"] as? String ?: ""

  private fun toMessages(built: Map<String, Any?>): List<AIChatMessage> =
    MiniJson.asList(built["messages"])?.mapNotNull { m ->
      val map = MiniJson.asMap(m) ?: return@mapNotNull null
      AIChatMessage(map["role"] as? String ?: return@mapNotNull null, map["content"] as? String ?: "")
    } ?: throw AIEditException("core: ${built["error"] ?: "no messages"}")

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
    selection: List<String> = this.selections,
    maxRepairs: Int = 1,
    dryRun: Boolean = false,
  ): EditResult {
    val text = instruction.trim()
    require(text.isNotEmpty()) { "editScene: instruction is empty." }
    val myGen = synchronized(lock) { ++generation }
    val base = source
    val repairsAllowed = maxRepairs.coerceIn(0, 3)
    listener?.onEditStart(text, selection.firstOrNull())
    var code = ""
    var error: String? = null
    var warnings = emptyList<String>()
    var repairs = 0
    fun superseded() = generation != myGen
    try {
      val built = core.call(mapOf("op" to "messages", "source" to base, "selection" to selection, "instruction" to text))
      val messages = toMessages(built).toMutableList()
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
    /** Most meshes one selection may hold (same as the web). */
    const val MAX_SELECTION = 50
    private const val MAX_QUERY = 2000

    private fun cleanSelection(names: List<String>): List<String> =
      names.asSequence().map { it.take(200) }.filter { it.isNotEmpty() }.distinct().take(MAX_SELECTION).toList()

    private fun strings(v: Any?): List<String> = MiniJson.asList(v)?.filterIsInstance<String>() ?: emptyList()
  }
}
