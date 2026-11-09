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
import com.google.threelive.gemini.PcmAudioSink
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.yield
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * JVM tests for the Android Tap & Speak editor and voice session (B2b-2). The native core is
 * replaced by [FakeCore], which mimics the Rust ops closely enough to drive the Kotlin flow; the
 * real prompt, parsing, and protocol logic is covered by the Rust tests in `ai_edit.rs` /
 * `ai_voice.rs`.
 */
class ThreeLiveAIEditorTest {

  private val base = "const roof = new THREE.Mesh(); roof.name = 'Roof'; scene.add(roof);"
  private val red = base.replace("Mesh()", "Mesh(red)")

  /** Minimal stand-in for the Rust core. Scripts containing `BROKEN` fail validation. */
  private class FakeCore : AICore {
    val ops = CopyOnWriteArrayList<String>()

    override suspend fun call(request: Map<String, Any?>): Map<String, Any?> {
      val op = request["op"] as String
      ops += op
      return when (op) {
        "messages" ->
          mapOf(
            "messages" to
              listOf(
                mapOf("role" to "system", "content" to "SYS"),
                mapOf("role" to "user", "content" to "src=${request["source"]} sel=${(request["selection"] as? List<*>)?.joinToString(",") ?: request["selection"]} ins=${request["instruction"]}"),
              )
          )
        "extract" -> mapOf("code" to (request["reply"] as String).removePrefix("```js\n").removeSuffix("\n```"))
        "validate" -> {
          val code = request["code"] as String
          when {
            code.isEmpty() -> mapOf("ok" to false, "error" to "The model reply did not contain a scene script.")
            "BROKEN" in code -> mapOf("ok" to false, "error" to "SyntaxError: unexpected token")
            else -> mapOf("ok" to true, "warnings" to listOf("w1"))
          }
        }
        "repair" -> mapOf("message" to "REPAIR: ${request["error"]}")
        "describe" -> mapOf("text" to if (request["applied"] == true) "Done." else "Sorry: ${request["error"]}")
        "voice_setup" ->
          mapOf(
            "messages" to listOf(mapOf("type" to "session.update", "provider" to request["provider"])),
            "inputRate" to if (request["provider"] == "gemini-live") 16000.0 else 24000.0,
          )
        "voice_text" -> mapOf("messages" to listOf(mapOf("type" to "text", "text" to request["text"], "respond" to request["respond"])))
        "voice_tool_result" -> mapOf("messages" to listOf(mapOf("type" to "tool_result", "id" to request["id"], "output" to request["output"])))
        "voice_parse" -> mapOf("events" to MiniJson.asList(MiniJson.asMap(request["message"])?.get("events")))
        // Talk-to-Select: canned answers for a scene of three chairs and a sofa.
        "select" -> {
          val query = request["query"] as String
          val within = (request["within"] as? List<*>)?.filterIsInstance<String>()
          fun scoped(vararg names: String) = names.filter { within == null || it in within }
          fun high(names: List<String>) =
            if (names.isEmpty()) mapOf("confidence" to "none", "reason" to "no_match", "names" to emptyList<String>(), "candidates" to emptyList<String>())
            else mapOf("confidence" to "high", "reason" to "match", "names" to names, "candidates" to emptyList<String>())
          when {
            request["withIndex"] == true -> mapOf("index" to SCENE.map { mapOf("name" to it) })
            "next to" in query || "near" in query -> mapOf("confidence" to "none", "reason" to "relation", "names" to emptyList<String>(), "candidates" to emptyList<String>())
            "red chairs" in query -> high(scoped("Chair_Left", "Chair_Right"))
            "red" in query && within != null -> high(scoped("Chair_Left", "Chair_Right"))
            "red chair" in query -> mapOf("confidence" to "ambiguous", "reason" to "multiple", "names" to emptyList<String>(), "candidates" to listOf("Chair_Left", "Chair_Right"))
            "sofa" in query -> high(scoped("Sofa"))
            else -> high(emptyList())
          }
        }
        "select_messages" -> mapOf("messages" to listOf(mapOf("role" to "system", "content" to "SELECT"), mapOf("role" to "user", "content" to "q=${request["query"]}")), "names" to SCENE)
        "select_parse" -> {
          val reply = MiniJson.parseObjectOrNull(request["reply"] as String) ?: emptyMap()
          val names = (request["names"] as List<*>).filterIsInstance<String>()
          val picked = MiniJson.asList(reply["ids"])?.mapNotNull { (it as? Double)?.toInt()?.let(names::getOrNull) } ?: emptyList()
          mapOf("names" to picked, "confidence" to if (reply["confidence"] == "high" && picked.isNotEmpty()) "high" else "low", "question" to (reply["question"] ?: ""))
        }
        "select_say" -> {
          val m = MiniJson.asMap(request["match"])
          mapOf("text" to "SAY ${request["mode"]} ${m?.get("confidence")} ${m?.get("names")} ${m?.get("candidates")} ${request["meshes"]}")
        }
        "select_context" -> mapOf("text" to "CTX " + (request["meshes"] as List<*>).joinToString { "\"$it\"" })
        "parse_command" -> {
          val t = request["text"] as String
          when {
            t == "clear the selection" -> mapOf("kind" to "clear", "mode" to "clear")
            t.startsWith("select ") && " and " in t ->
              mapOf("kind" to "mixed", "mode" to "replace", "query" to t.removePrefix("select ").substringBefore(" and "), "instruction" to t.substringAfter(" and "))
            t.startsWith("select ") -> mapOf("kind" to "select", "mode" to "replace", "query" to t.removePrefix("select "))
            else -> mapOf("kind" to "edit", "instruction" to t)
          }
        }
        else -> mapOf("error" to "unknown op $op")
      }
    }
  }

  companion object {
    val SCENE = listOf("Chair_Left", "Chair_Middle", "Chair_Right", "Sofa")
  }

  private class Scripted(vararg replies: String) : AIProvider {
    val queue = ArrayDeque(replies.toList())
    val requests = CopyOnWriteArrayList<List<AIChatMessage>>()

    override suspend fun complete(messages: List<AIChatMessage>): String {
      requests += messages.toList()
      return queue.removeFirstOrNull() ?: throw AIEditException("no more replies")
    }
  }

  private fun fenced(code: String) = "```js\n$code\n```"

  private class FakeTransport : GeminiLiveTransport {
    override var listener: GeminiLiveTransport.Listener? = null
    val sent = CopyOnWriteArrayList<Map<String, Any?>>()
    @Volatile var closed = false

    override fun send(message: Map<String, Any?>) {
      if (!closed) sent += message
    }

    override fun close() {
      closed = true
    }

    fun server(vararg events: Map<String, Any?>) = listener?.onMessage(mapOf("events" to events.toList()))
  }

  private class FakeSink : PcmAudioSink {
    val chunks = CopyOnWriteArrayList<Pair<Int, Int>>()
    @Volatile var flushes = 0
    @Volatile var closed = false

    override fun enqueue(pcm16le: ByteArray, sampleRate: Int) {
      chunks += pcm16le.size to sampleRate
    }

    override fun flush() {
      flushes++
    }

    override fun close() {
      closed = true
    }
  }

  private suspend fun waitFor(timeoutMs: Long = 2000, cond: () -> Boolean) {
    withTimeout(timeoutMs) {
      while (!cond()) delay(5)
    }
  }

  @Test
  fun editAppliesValidatedScriptWithSelectionAndUndo() = runBlocking {
    val applied = CopyOnWriteArrayList<String>()
    val core = FakeCore()
    val provider = Scripted(fenced(red))
    val editor = ThreeLiveAIEditor(base, provider, { applied += it }, core)
    editor.selection = "Roof"
    val result = editor.editScene("  make it red  ")
    assertTrue(result.error, result.applied)
    assertEquals(red, editor.source)
    assertEquals(listOf(red), applied)
    assertEquals(listOf("w1"), result.warnings)
    assertTrue(provider.requests[0][1].content.contains("sel=Roof ins=make it red"))
    assertEquals(listOf("messages", "extract", "validate"), core.ops.toList())
    assertTrue(editor.undo())
    assertEquals(base, editor.source)
    assertEquals(base, applied.last())
    assertFalse(editor.undo())
  }

  @Test
  fun failedCompileGetsOneRepairTurnThenRejects() = runBlocking {
    val applied = CopyOnWriteArrayList<String>()
    val provider = Scripted(fenced("BROKEN"), fenced(red))
    val editor = ThreeLiveAIEditor(base, provider, { applied += it }, FakeCore())
    val ok = editor.editScene("make it red")
    assertTrue(ok.applied)
    assertEquals(1, ok.repairs)
    val repairTurn = provider.requests[1]
    assertEquals("assistant", repairTurn[2].role)
    assertEquals("REPAIR: SyntaxError: unexpected token", repairTurn[3].content)

    val stillBroken = ThreeLiveAIEditor(base, Scripted(fenced("BROKEN"), fenced("BROKEN again")), { applied += it }, FakeCore())
    val rejected = stillBroken.editScene("x")
    assertFalse(rejected.applied)
    assertEquals("SyntaxError: unexpected token", rejected.error)
    assertEquals(base, stillBroken.source)

    val noRepair = ThreeLiveAIEditor(base, Scripted(fenced("BROKEN")), { applied += it }, FakeCore()).editScene("x", maxRepairs = 0)
    assertEquals(0, noRepair.repairs)
    assertFalse(noRepair.applied)
  }

  @Test
  fun providerAndLoadFailuresComeBackAsErrors() = runBlocking {
    val failing = ThreeLiveAIEditor(base, Scripted(), {}, FakeCore()).editScene("x")
    assertEquals("no more replies", failing.error)

    val applied = CopyOnWriteArrayList<String>()
    var fail = true
    val editor =
      ThreeLiveAIEditor(base, Scripted(fenced(red)), { code ->
        applied += code
        if (fail && code == red) {
          fail = false
          throw IllegalStateException("renderer limits exceeded")
        }
      }, FakeCore())
    val result = editor.editScene("make it red")
    assertFalse(result.applied)
    assertTrue(result.error!!.startsWith("The edit compiled but failed to load: renderer limits exceeded"))
    assertEquals(base, editor.source)
    assertEquals(listOf(red, base), applied.toList())

    val dry = ThreeLiveAIEditor(base, Scripted(fenced(red)), { fail("dry run must not apply") }, FakeCore()).editScene("x", dryRun = true)
    assertTrue(dry.applied)
    try {
      ThreeLiveAIEditor(base, Scripted(), {}, FakeCore()).editScene("   ")
      fail("blank instruction must throw")
    } catch (expected: IllegalArgumentException) {}
  }

  @Test
  fun newerEditSupersedesInFlightOne() = runBlocking {
    val gate = CompletableDeferred<String>()
    val provider =
      object : AIProvider {
        var calls = 0

        override suspend fun complete(messages: List<AIChatMessage>): String = if (calls++ == 0) gate.await() else fenced(red)
      }
    val editor = ThreeLiveAIEditor(base, provider, {}, FakeCore())
    val first = async { editor.editScene("first") }
    yield()
    val second = editor.editScene("second")
    gate.complete(fenced("const other = 1; scene.add(new THREE.Mesh());"))
    assertTrue(second.applied)
    assertEquals(ThreeLiveAIEditor.SUPERSEDED, first.await().error)
    assertEquals(red, editor.source)
  }

  @Test
  fun toggleSelectionAndListener() {
    val editor = ThreeLiveAIEditor(base, Scripted(), {}, FakeCore())
    val seen = mutableListOf<String?>()
    editor.listener =
      object : ThreeLiveAIEditor.Listener {
        override fun onSelectionChanged(selection: String?) {
          seen += selection
        }
      }
    assertEquals("Roof", editor.toggleSelection("Roof"))
    assertNull(editor.toggleSelection("Roof"))
    assertNull(editor.toggleSelection(""))
    assertEquals("Door", editor.toggleSelection("Door"))
    assertEquals(listOf("Roof", null, "Door"), seen)
  }

  /** In-memory HTTP exchange (Android unit tests have no JDK HTTP server). */
  private class FakeConnection(url: URL, private val status: Int, private val reply: String) : HttpURLConnection(url) {
    val body = ByteArrayOutputStream()

    override fun connect() {}

    override fun disconnect() {}

    override fun usingProxy() = false

    override fun getOutputStream(): OutputStream = body

    override fun getResponseCode() = status

    override fun getInputStream(): InputStream = ByteArrayInputStream(reply.toByteArray())

    override fun getErrorStream(): InputStream = ByteArrayInputStream(reply.toByteArray())
  }

  @Test
  fun chatProviderPostsAndParsesContent() = runBlocking {
    val opened = CopyOnWriteArrayList<FakeConnection>()
    val ok = """{"choices":[{"message":{"content":[{"type":"text","text":"```js\n"},"scene.add(x)\n```"]}}]}"""
    val provider =
      AIChatProvider("https://proxy.example/chat", "m1", mapOf("Authorization" to "Bearer t"), openConnection = { url ->
        FakeConnection(url, 200, ok).also { opened += it }
      })
    val text = provider.complete(listOf(AIChatMessage("user", "hi")))
    assertEquals("```js\nscene.add(x)\n```", text)
    val conn = opened.single()
    assertEquals("POST", conn.requestMethod)
    assertEquals("Bearer t", conn.getRequestProperty("Authorization"))
    val sent = MiniJson.parseObjectOrNull(conn.body.toString(Charsets.UTF_8.name()))!!
    assertEquals("m1", sent["model"])
    assertEquals(false, sent["stream"])
    assertEquals("hi", MiniJson.asMap(MiniJson.asList(sent["messages"])!![0])!!["content"])

    val denied = AIChatProvider("https://proxy.example/chat", openConnection = { FakeConnection(it, 401, """{"error":"nope"}""") })
    try {
      denied.complete(listOf(AIChatMessage("user", "hi")))
      fail("401 must throw")
    } catch (e: AIEditException) {
      assertTrue(e.message!!.contains("HTTP 401"))
    }
    assertFalse(AIChatProvider.isAllowedEndpoint("http://example.com/chat"))
    assertTrue(AIChatProvider.isAllowedEndpoint("http://127.0.0.1:11434/v1/chat/completions"))
    assertTrue(AIChatProvider.isAllowedEndpoint("https://example.com/chat"))
    try {
      AIChatProvider.parseContent("""{"choices":[]}""")
      fail("empty content must throw")
    } catch (expected: AIEditException) {}
  }

  @Test
  fun voiceSessionRunsToolsStreamsAudioAndCloses() = runBlocking {
    val core = FakeCore()
    val applied = CopyOnWriteArrayList<String>()
    val editor = ThreeLiveAIEditor(base, Scripted(fenced(red)), { applied += it }, core)
    editor.selection = "Roof"
    val transport = FakeTransport()
    val sink = FakeSink()
    val states = CopyOnWriteArrayList<AIVoiceState>()
    val transcripts = CopyOnWriteArrayList<String>()
    val session = AIVoiceSession(editor, transport, this, sink = sink, core = core)
    session.listener =
      object : AIVoiceSession.Listener {
        override fun onState(state: AIVoiceState) {
          states += state
        }

        override fun onTranscript(speaker: String, text: String, isFinal: Boolean) {
          if (isFinal) transcripts += "$speaker:$text"
        }
      }
    assertEquals(24000, session.start())
    assertEquals("session.update", transport.sent[0]["type"])
    assertTrue((transport.sent[1]["text"] as String).contains("\"Roof\""))
    assertEquals(false, transport.sent[1]["respond"])

    session.sendAudio(byteArrayOf(1, 2, 3, 4))
    assertEquals("input_audio_buffer.append", transport.sent.last()["type"])

    transport.server(
      mapOf("type" to "audio", "base64" to "AAAAAA==", "rate" to 24000.0),
      mapOf("type" to "interrupted"),
      mapOf("type" to "transcript", "speaker" to "user", "text" to "make it red", "isFinal" to true),
    )
    waitFor { sink.flushes == 1 && transcripts.isNotEmpty() }
    assertEquals(listOf(4 to 24000), sink.chunks.toList())
    assertEquals("user:make it red", transcripts[0])

    transport.server(mapOf("type" to "toolCall", "id" to "c1", "name" to "edit_scene", "args" to mapOf("instruction" to "make it red")))
    waitFor { transport.sent.any { it["type"] == "tool_result" } }
    val result = transport.sent.first { it["type"] == "tool_result" }
    assertEquals("c1", result["id"])
    assertEquals(true, MiniJson.asMap(result["output"])!!["applied"])
    assertEquals(red, editor.source)
    assertTrue(AIVoiceState.EDITING in states)

    transport.server(mapOf("type" to "toolCall", "id" to "c2", "name" to "undo_edit", "args" to emptyMap<String, Any?>()))
    waitFor { transport.sent.any { it["id"] == "c2" } }
    assertEquals(base, editor.source)
    transport.server(mapOf("type" to "toolCall", "id" to "c3", "name" to "drop_tables", "args" to emptyMap<String, Any?>()))
    waitFor { transport.sent.any { it["id"] == "c3" } }
    assertNotNull(MiniJson.asMap(transport.sent.first { it["id"] == "c3" }["output"])!!["error"])

    editor.selection = "Door"
    waitFor { transport.sent.any { (it["text"] as? String)?.contains("\"Door\"") == true } }

    transport.server(mapOf("type" to "turnComplete"))
    waitFor { states.last() == AIVoiceState.LISTENING }

    session.close()
    val sentBefore = transport.sent.size
    session.sendAudio(byteArrayOf(1, 2))
    editor.selection = "Window"
    delay(20)
    assertTrue(transport.closed && sink.closed)
    assertEquals(AIVoiceState.CLOSED, session.state)
    assertEquals(sentBefore, transport.sent.size)
    assertNull(editor.listener)
    session.close()
  }

  @Test
  fun geminiVoiceSessionUses16kAudio() = runBlocking {
    val editor = ThreeLiveAIEditor(base, Scripted(), {}, FakeCore())
    val transport = FakeTransport()
    val session = AIVoiceSession(editor, transport, this, provider = "gemini-live", core = FakeCore())
    assertEquals(16000, session.start())
    session.sendAudio(byteArrayOf(0, 0))
    val audio = MiniJson.asMap(MiniJson.asMap(transport.sent.last()["realtimeInput"])!!["audio"])!!
    assertEquals("audio/pcm;rate=16000", audio["mimeType"])
    session.close()
    try {
      AIVoiceSession(editor, transport, this, provider = "pigeon", core = FakeCore())
      fail("unknown provider must throw")
    } catch (expected: IllegalArgumentException) {}
  }

  @Test
  fun multiSelectionModesAndListener() = runBlocking {
    val core = FakeCore()
    val provider = Scripted(fenced(red))
    val editor = ThreeLiveAIEditor(base, provider, {}, core)
    val changes = mutableListOf<String>()
    editor.listener =
      object : ThreeLiveAIEditor.Listener {
        override fun onSelectionsChanged(selections: List<String>, source: String) {
          changes += "$source:${selections.joinToString(",")}"
        }
      }
    assertEquals("Roof", editor.toggleSelection("Roof"))
    assertEquals("Roof", editor.toggleSelection("Door", additive = true))
    assertEquals(listOf("Roof", "Door"), editor.selections)
    editor.toggleSelection("Roof", additive = true)
    assertEquals(listOf("Door"), editor.selections)
    assertEquals(listOf("Door", "Chimney"), editor.setSelection(listOf("Chimney", "Chimney", ""), "add"))
    assertEquals(listOf("Chimney"), editor.setSelection(listOf("Door"), "remove"))
    assertEquals(listOf("Door"), editor.setSelection(listOf("Chimney", "Door"), "toggle"))
    assertEquals(emptyList<String>(), editor.setSelection(emptyList(), "clear"))
    editor.selections = (1..80).map { "m$it" }
    assertEquals(ThreeLiveAIEditor.MAX_SELECTION, editor.selections.size)
    assertEquals("tap:Roof", changes[0])
    assertTrue(changes.any { it.startsWith("api:Door,Chimney") })
    editor.selections = listOf("Roof", "Door")
    editor.editScene("make them red")
    assertTrue(provider.requests[0][1].content.contains("sel=Roof,Door ins=make them red"))
  }

  @Test
  fun selectByVoiceTiers() = runBlocking {
    val core = FakeCore()
    val provider = Scripted("""{"ids":[3],"confidence":"high"}""", """{"ids":[0,2],"confidence":"low","question":"Which chair?"}""")
    val editor = ThreeLiveAIEditor(base, provider, {}, core)
    editor.camera = AICamera(listOf(0.0, 1.6, 5.0), listOf(0.0, 0.8, 0.0))

    var r = editor.selectByVoice("the red chairs")
    assertTrue(r.applied)
    assertEquals(1, r.tier)
    assertEquals(listOf("Chair_Left", "Chair_Right"), editor.selections)
    assertTrue(r.say.startsWith("SAY replace high"))

    r = editor.selectByVoice("the red chair")
    assertFalse(r.applied)
    assertEquals(listOf("Chair_Left", "Chair_Right"), r.candidates)
    assertEquals(listOf("Chair_Left", "Chair_Right"), editor.selections)
    assertEquals(0, provider.requests.size)

    r = editor.selectByVoice("the thing next to the window")
    assertTrue(r.applied)
    assertEquals(2, r.tier)
    assertEquals(listOf("Sofa"), editor.selections)
    assertEquals("SELECT", provider.requests[0][0].content)

    r = editor.selectByVoice("the chair near the lamp")
    assertFalse(r.applied)
    assertEquals("Which chair?", r.say)
    assertEquals(listOf("Chair_Left", "Chair_Right"), r.candidates)

    r = editor.selectByVoice("the chair next to the door") // provider has no replies left
    assertFalse(r.applied)
    assertEquals(1, r.tier)

    editor.selectWithModel = false
    val before = provider.requests.size
    editor.selectByVoice("the chair next to the door")
    assertEquals(before, provider.requests.size)

    editor.selections = listOf("Chair_Left", "Sofa")
    r = editor.selectByVoice("the red one", "remove")
    assertTrue(r.applied)
    assertEquals(listOf("Sofa"), editor.selections)
    r = editor.selectByVoice("", "clear")
    assertTrue(r.applied)
    assertTrue(editor.selections.isEmpty())
    r = editor.selectByVoice("the sofa", "remove")
    assertEquals("Nothing is selected.", r.say)

    r = editor.selectNames(listOf("Sofa", "Nope"), "add")
    assertTrue(r.applied)
    assertEquals(listOf("Sofa"), editor.selections)
    assertFalse(editor.selectNames(listOf("Nope")).applied)
    assertEquals("mixed", editor.parseCommand("select the lamp and make it blue")["kind"])
  }

  @Test
  fun voiceSessionSelectMeshesTool() = runBlocking {
    val core = FakeCore()
    val editor = ThreeLiveAIEditor(base, Scripted(), {}, core)
    val transport = FakeTransport()
    val session = AIVoiceSession(editor, transport, this, core = core)
    val selections = CopyOnWriteArrayList<AIVoiceSelection>()
    session.listener =
      object : AIVoiceSession.Listener {
        override fun onSelection(selection: AIVoiceSelection) {
          selections += selection
        }
      }
    session.start()
    transport.server(mapOf("type" to "toolCall", "id" to "s1", "name" to "select_meshes", "args" to mapOf("query" to "the red chairs")))
    waitFor { transport.sent.any { it["id"] == "s1" } }
    var out = MiniJson.asMap(transport.sent.first { it["id"] == "s1" }["output"])!!
    assertEquals(true, out["changed"])
    assertEquals(listOf("Chair_Left", "Chair_Right"), out["selected"])
    assertFalse(transport.sent.any { (it["text"] as? String)?.startsWith("CTX") == true })

    transport.server(mapOf("type" to "toolCall", "id" to "s2", "name" to "select_meshes", "args" to mapOf("query" to "the red chair")))
    waitFor { transport.sent.any { it["id"] == "s2" } }
    out = MiniJson.asMap(transport.sent.first { it["id"] == "s2" }["output"])!!
    assertEquals(false, out["changed"])
    assertEquals(listOf("Chair_Left", "Chair_Right"), out["candidates"])
    assertNotNull(out["question"])

    transport.server(mapOf("type" to "toolCall", "id" to "s3", "name" to "select_meshes", "args" to mapOf("names" to listOf("Sofa"), "mode" to "add")))
    waitFor { transport.sent.any { it["id"] == "s3" } }
    out = MiniJson.asMap(transport.sent.first { it["id"] == "s3" }["output"])!!
    assertEquals(listOf("Chair_Left", "Chair_Right", "Sofa"), out["selected"])
    assertEquals(3, selections.size)

    editor.toggleSelection("Sofa")
    waitFor { transport.sent.any { (it["text"] as? String) == "CTX \"Sofa\"" } }
    session.close()
  }
}
