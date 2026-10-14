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
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.EOFException
import java.net.ServerSocket
import java.net.URI
import java.util.Random
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** JVM tests for the zero-dependency native Gemini Live client (parity with `gemini-live.ts`). */
class GeminiLiveTest {

  // ---- Endpoint policy ---------------------------------------------------------------------------

  @Test
  fun liveUrlPolicyMatchesWeb() {
    assertTrue(GeminiLiveEndpoints.isAllowedLiveUrl("wss://example.com/live"))
    assertTrue(GeminiLiveEndpoints.isAllowedLiveUrl("ws://localhost:8080/live"))
    assertTrue(GeminiLiveEndpoints.isAllowedLiveUrl("ws://127.0.0.1/x"))
    assertTrue(GeminiLiveEndpoints.isAllowedLiveUrl("ws://[::1]:9000/"))
    assertFalse(GeminiLiveEndpoints.isAllowedLiveUrl("ws://example.com/live"))
    assertFalse(GeminiLiveEndpoints.isAllowedLiveUrl("https://example.com/live"))
    assertFalse(GeminiLiveEndpoints.isAllowedLiveUrl("javascript:alert(1)"))
    assertFalse(GeminiLiveEndpoints.isAllowedLiveUrl("wss:///nohost"))
    assertFalse(GeminiLiveEndpoints.isAllowedLiveUrl(""))
    assertFalse(GeminiLiveEndpoints.isAllowedLiveUrl(null))
  }

  @Test
  fun ephemeralTokenUrlUsesConstrainedMethodAndEncodesToken() {
    val url = GeminiLiveEndpoints.ephemeralTokenUrl("auth_tokens/a+b c")
    assertTrue(url.startsWith("wss://generativelanguage.googleapis.com/ws/"))
    assertTrue(url.contains("GenerativeService.BidiGenerateContentConstrained?access_token="))
    assertTrue(url.endsWith("auth_tokens%2Fa%2Bb%20c"))
    assertTrue(GeminiLiveEndpoints.isAllowedLiveUrl(url))
    assertEquals("Token t", GeminiLiveEndpoints.ephemeralTokenHeaders("t")["Authorization"])
  }

  @Test
  fun devApiKeyRefusedInReleaseBuilds() {
    try {
      GeminiLiveEndpoints.devApiKeyUrl("AIzaKEY", isDebuggable = false)
      fail("API keys must be refused when not debuggable")
    } catch (e: IllegalStateException) {
      assertFalse(e.message!!.contains("AIzaKEY"))
    }
    assertTrue(GeminiLiveEndpoints.devApiKeyUrl("AIzaKEY", isDebuggable = true).endsWith("?key=AIzaKEY"))
  }

  // ---- WebSocket codec ----------------------------------------------------------------------------

  @Test
  fun handshakeAcceptMatchesRfc6455Example() {
    assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WebSocketCodec.acceptFor("dGhlIHNhbXBsZSBub25jZQ=="))
  }

  @Test
  fun framesRoundTripAtLengthBoundaries() {
    val mask = byteArrayOf(1, 2, 3, 4)
    for (len in intArrayOf(0, 1, 125, 126, 65535, 65536)) {
      val payload = ByteArray(len) { (it * 7).toByte() }
      val masked = WebSocketCodec.encodeFrame(WebSocketCodec.OP_BINARY, payload, maskKey = mask)
      val headerLen = when {
        len <= 125 -> 2
        len <= 65535 -> 4
        else -> 10
      }
      assertEquals(headerLen + 4 + len, masked.size)
      assertEquals(0x80, masked[1].toInt() and 0x80)
      val frame = WebSocketCodec.readFrame(ByteArrayInputStream(masked), Long.MAX_VALUE, expectMasked = true)
      assertArrayEquals(payload, frame.payload)
      assertTrue(frame.fin)
    }
  }

  @Test
  fun readerReassemblesFragmentsAndSurfacesInterleavedControlFrames() {
    val out = ByteArrayOutputStream()
    out.write(WebSocketCodec.encodeFrame(WebSocketCodec.OP_TEXT, "{\"a\":".toByteArray(), fin = false))
    out.write(WebSocketCodec.encodeFrame(WebSocketCodec.OP_PING, byteArrayOf(9)))
    out.write(WebSocketCodec.encodeFrame(WebSocketCodec.OP_CONTINUATION, "1}".toByteArray()))
    out.write(WebSocketCodec.encodeFrame(WebSocketCodec.OP_CLOSE, WebSocketCodec.closePayload(1000, "bye")))
    val reader = WebSocketCodec.MessageReader(ByteArrayInputStream(out.toByteArray()), 1024)
    assertTrue(reader.next() is WebSocketCodec.Event.Ping)
    assertEquals("{\"a\":1}", (reader.next() as WebSocketCodec.Event.Text).text)
    val close = reader.next() as WebSocketCodec.Event.Close
    assertEquals(1000, close.code)
    assertEquals("bye", close.reason)
    try {
      reader.next()
      fail("stream ended")
    } catch (e: EOFException) {
      // Expected.
    }
  }

  @Test
  fun readerRejectsOversizeMaskedServerFramesAndBadUtf8() {
    val big = WebSocketCodec.encodeFrame(WebSocketCodec.OP_TEXT, ByteArray(2048))
    assertProtocolError(WebSocketCodec.CLOSE_TOO_BIG) { WebSocketCodec.MessageReader(ByteArrayInputStream(big), 1024).next() }
    val masked = WebSocketCodec.encodeFrame(WebSocketCodec.OP_TEXT, ByteArray(4), maskKey = ByteArray(4))
    assertProtocolError(WebSocketCodec.CLOSE_PROTOCOL_ERROR) { WebSocketCodec.MessageReader(ByteArrayInputStream(masked), 1024).next() }
    val badUtf8 = WebSocketCodec.encodeFrame(WebSocketCodec.OP_TEXT, byteArrayOf(0xC3.toByte(), 0x28))
    assertProtocolError(WebSocketCodec.CLOSE_INVALID_PAYLOAD) { WebSocketCodec.MessageReader(ByteArrayInputStream(badUtf8), 1024).next() }
  }

  @Test
  fun handshakeRejectsHeaderInjection() {
    try {
      WebSocketCodec.buildHandshakeRequest(URI("wss://h/p"), "k", mapOf("X-A" to "1\r\nEvil: 2"))
      fail()
    } catch (e: IllegalArgumentException) {
      // Expected.
    }
    try {
      WebSocketCodec.buildHandshakeRequest(URI("wss://h/p"), "k", mapOf("Host" to "x"))
      fail()
    } catch (e: IllegalArgumentException) {
      // Expected.
    }
    val req = WebSocketCodec.buildHandshakeRequest(URI("wss://h:8443/p?q=1"), "k", emptyMap())
    assertTrue(req.startsWith("GET /p?q=1 HTTP/1.1\r\nHost: h:8443\r\n"))
  }

  @Test
  fun base64RoundTrip() {
    val r = Random(1)
    for (n in 0..20) {
      val b = ByteArray(n).also { r.nextBytes(it) }
      assertArrayEquals(b, LiveBase64.decode(LiveBase64.encode(b)))
    }
    assertEquals("aGk=", LiveBase64.encode("hi".toByteArray()))
    assertNull(LiveBase64.decodeOrNull("!!"))
  }

  // ---- Controller ---------------------------------------------------------------------------------

  @Test
  fun transcriptsAccumulateFinalizeAndIgnoreTextAfterOutputTranscription() {
    val c = XRGeminiLiveController()
    val events = ArrayList<TranscriptEvent>()
    var interrupted = 0
    c.listener =
      object : XRGeminiLiveController.Listener {
        override fun onTranscript(event: TranscriptEvent) {
          events.add(event)
        }

        override fun onInterrupted() {
          interrupted++
        }
      }
    c.handleServerMessage(msg("""{"serverContent":{"inputTranscription":{"text":"what is "}}}"""))
    c.handleServerMessage(msg("""{"serverContent":{"inputTranscription":{"text":"this"}}}"""))
    c.handleServerMessage(msg("""{"serverContent":{"outputTranscription":{"text":"A lamp"}}}"""))
    c.handleServerMessage(msg("""{"serverContent":{"modelTurn":{"parts":[{"text":"IGNORED"}]}}}"""))
    c.handleServerMessage(msg("""{"serverContent":{"turnComplete":true}}"""))
    assertEquals(TranscriptEvent(TranscriptSpeaker.USER, "what is this", false), events[1])
    assertEquals(TranscriptEvent(TranscriptSpeaker.USER, "what is this", true), events[3])
    assertEquals(TranscriptEvent(TranscriptSpeaker.MODEL, "A lamp", true), events[4])
    assertTrue(events.none { it.text.contains("IGNORED") })

    // Next turn: text parts count again; interrupted flushes and notifies.
    c.handleServerMessage(msg("""{"serverContent":{"modelTurn":{"parts":[{"text":"Hi"}]},"interrupted":true}}"""))
    assertEquals(1, interrupted)
    assertEquals(TranscriptEvent(TranscriptSpeaker.MODEL, "Hi", false), events.last())
  }

  @Test
  fun audioPartsArePlayedAndFlushedOnInterrupt() {
    val sink = FakeSink()
    val c = XRGeminiLiveController(audioSink = sink)
    c.connect(FakeTransport())
    val pcm = LiveBase64.encode(byteArrayOf(1, 0, 2, 0))
    c.handleServerMessage(msg("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=16000","data":"$pcm"}}]}}}"""))
    assertEquals(listOf(16000), sink.rates)
    c.handleServerMessage(msg("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"image/png","data":"$pcm"}}]}}}"""))
    c.handleServerMessage(msg("""{"serverContent":{"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm","data":"!!"}}]}}}"""))
    assertEquals(1, sink.rates.size)
    val before = sink.flushes
    c.handleServerMessage(msg("""{"serverContent":{"interrupted":true}}"""))
    assertEquals(before + 1, sink.flushes)
    assertEquals(24000, XRGeminiLiveController.pcmRateFromMime("audio/pcm"))
    assertEquals(48000, XRGeminiLiveController.pcmRateFromMime("audio/pcm;rate=96000"))
  }

  @Test
  fun outgoingMessagesMatchLiveApiShapes() {
    val t = FakeTransport()
    val frames = FrameSource { cb -> cb(byteArrayOf(-1, -40, -1)) }
    val c = XRGeminiLiveController(frameSource = frames)
    c.connect(t, GeminiLiveOptions(setup = mapOf("model" to "models/x"), streamFrames = false))
    c.sendText("x".repeat(5000))
    c.sendAudioChunk(byteArrayOf(0, 0), sampleRate = 1)
    assertTrue(c.sendFrame())
    assertEquals(mapOf("setup" to mapOf("model" to "models/x")), t.sent[0])
    val turn = MiniJson.asMap(t.sent[1]["clientContent"])!!
    assertEquals(true, turn["turnComplete"])
    val text = MiniJson.asMap(MiniJson.asList(MiniJson.asMap(MiniJson.asList(turn["turns"])!![0])!!["parts"])!![0])!!["text"] as String
    assertEquals(4000, text.length)
    assertEquals("audio/pcm;rate=8000", chunkMime(t.sent[2]))
    assertEquals("image/jpeg", chunkMime(t.sent[3]))
    c.disconnect()
    assertTrue(t.closed)
    c.sendText("dropped")
    assertEquals(4, t.sent.size)
  }

  @Test
  fun reportObjectsToolMergesIntoSetupAndAnswersCalls() {
    val merged = XRGeminiLiveController.withDetectionTool(mapOf("model" to "m", "tools" to listOf(mapOf("googleSearch" to emptyMap<String, Any?>()))))!!
    assertEquals(2, MiniJson.asList(merged["tools"])!!.size)
    assertEquals(2, MiniJson.asList(XRGeminiLiveController.withDetectionTool(merged)!!["tools"])!!.size)
    assertNull(XRGeminiLiveController.withDetectionTool(null))

    val t = FakeTransport()
    val c = XRGeminiLiveController()
    val reported = ArrayList<List<com.google.threelive.ThreeLiveDetections.Box>>()
    c.listener =
      object : XRGeminiLiveController.Listener {
        override fun onObjectsReported(boxes: List<com.google.threelive.ThreeLiveDetections.Box>) {
          reported.add(boxes)
        }
      }
    c.connect(t, GeminiLiveOptions(setup = mapOf("model" to "m"), streamFrames = false, detectObjects = true))
    assertTrue(MiniJson.stringify(t.sent[0]).contains("\"name\":\"report_objects\""))
    t.sent.clear()
    c.handleServerMessage(
      msg(
        """{"toolCall":{"functionCalls":[
          {"id":"c1","name":"report_objects","args":{"objects":[{"label":"cup","box_2d":[400,400,600,600]}]}},
          {"id":"c2","name":"host_tool","args":{}},
          {"id":"c3","name":"report_objects","args":{"objects":[{"label":"x","box_2d":[1,"y",3,4]},7,{"box_2d":[1]}]}},
          {"id":"c4","name":"report_objects","args":null}]}}"""
      )
    )
    assertEquals(1, reported.size)
    assertEquals("cup", reported[0][0].label)
    val responses = MiniJson.asList(MiniJson.asMap(t.sent.single()["toolResponse"])!!["functionResponses"])!!
    assertEquals(listOf("c1", "c3", "c4"), responses.map { MiniJson.asMap(it)!!["id"] })
    assertEquals(
      listOf(1, 0, 0),
      responses.map { MiniJson.asMap(MiniJson.asMap(it)!!["response"])!!["located"] },
    )
    t.sent.clear()
    val many = (0 until 20).joinToString(",") { """{"id":"$it","name":"report_objects","args":{"objects":[]}}""" }
    c.handleServerMessage(msg("""{"toolCall":{"functionCalls":[$many]}}"""))
    val capped = MiniJson.asList(MiniJson.asMap(t.sent.single()["toolResponse"])!!["functionResponses"])!!
    assertEquals(XRGeminiLiveController.MAX_TOOL_CALLS, capped.size)

    // Without detectObjects, tool calls are left to the host.
    val plain = FakeTransport()
    c.connect(plain, GeminiLiveOptions(setup = mapOf("model" to "m"), streamFrames = false))
    c.handleServerMessage(msg("""{"toolCall":{"functionCalls":[{"id":"c","name":"report_objects","args":{"objects":[]}}]}}"""))
    assertEquals(1, plain.sent.size)
    assertFalse(MiniJson.stringify(plain.sent).contains("toolResponse"))
  }

  @Test
  fun holdToAskPromptMatchesWeb() {
    val opts = XRHoldToAskTrait(prompt = "What is this?")
    assertEquals(
      "The user is pointing at the 3D object \"Lamp\". What is this?",
      XRGeminiLiveController.buildHoldToAskPrompt("Lamp", opts),
    )
    assertEquals(
      "The user is pointing at the 3D object \"object\". how old is it",
      XRGeminiLiveController.buildHoldToAskPrompt("", opts, "  how old is it "),
    )
    assertEquals(4000, XRGeminiLiveController.buildHoldToAskPrompt("m".repeat(300), opts, "y".repeat(5000)).length)
  }

  // ---- Transport, end to end over loopback ----------------------------------------------------------

  @Test
  fun webSocketTransportTalksToLoopbackServer() {
    val server = ServerSocket(0)
    val received = LinkedBlockingQueue<String>()
    val serverThread =
      Thread {
        server.accept().use { s ->
          val input = s.getInputStream()
          val head = WebSocketCodec.readHttpHead(input)
          val key = head.first { it.startsWith("Sec-WebSocket-Key:") }.substringAfter(':').trim()
          s.getOutputStream().write(
            ("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                "Sec-WebSocket-Accept: ${WebSocketCodec.acceptFor(key)}\r\n\r\n").toByteArray()
          )
          val reader = WebSocketCodec.MessageReader(input, 1 shl 20, expectMasked = true)
          received.put((reader.next() as WebSocketCodec.Event.Text).text)
          // Server messages arrive as binary frames carrying JSON, like the Live API.
          s.getOutputStream().write(
            WebSocketCodec.encodeFrame(WebSocketCodec.OP_BINARY, """{"serverContent":{"turnComplete":true}}""".toByteArray())
          )
          s.getOutputStream().write(WebSocketCodec.encodeFrame(WebSocketCodec.OP_CLOSE, WebSocketCodec.closePayload(1000)))
          val reply = reader.next()
          received.put("close:" + (reply as WebSocketCodec.Event.Close).code)
        }
      }
    serverThread.start()
    val messages = LinkedBlockingQueue<Map<String, Any?>>()
    val closed = CountDownLatch(1)
    val t = WebSocketLiveTransport("ws://127.0.0.1:${server.localPort}/live")
    t.listener =
      object : GeminiLiveTransport.Listener {
        override fun onMessage(message: Map<String, Any?>) {
          messages.put(message)
        }

        override fun onClose() {
          closed.countDown()
        }
      }
    t.send(mapOf("setup" to mapOf("model" to "m")))
    assertEquals("""{"setup":{"model":"m"}}""", received.poll(5, TimeUnit.SECONDS))
    assertNotNull(messages.poll(5, TimeUnit.SECONDS))
    assertEquals("close:1000", received.poll(5, TimeUnit.SECONDS))
    assertTrue(closed.await(5, TimeUnit.SECONDS))
    serverThread.join(5000)
    server.close()
  }

  @Test
  fun webSocketTransportRejectsInsecureUrlsAndBadAccept() {
    try {
      WebSocketLiveTransport("ws://example.com/live")
      fail()
    } catch (e: IllegalArgumentException) {
      // Expected.
    }
    val server = ServerSocket(0)
    Thread {
        server.accept().use { s ->
          WebSocketCodec.readHttpHead(s.getInputStream())
          s.getOutputStream().write(
            "HTTP/1.1 101 OK\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: wrong\r\n\r\n".toByteArray()
          )
          Thread.sleep(500)
        }
      }
      .start()
    val closed = CountDownLatch(1)
    val t = WebSocketLiveTransport("ws://localhost:${server.localPort}/")
    t.listener =
      object : GeminiLiveTransport.Listener {
        override fun onMessage(message: Map<String, Any?>) {}

        override fun onClose() {
          closed.countDown()
        }
      }
    assertTrue(closed.await(5, TimeUnit.SECONDS))
    server.close()
  }

  // ---- Helpers ------------------------------------------------------------------------------------

  private fun msg(json: String): Map<String, Any?> = MiniJson.parseObjectOrNull(json)!!

  private fun chunkMime(m: Map<String, Any?>): String? =
    MiniJson.asMap(MiniJson.asList(MiniJson.asMap(m["realtimeInput"])!!["mediaChunks"])!![0])!!["mimeType"] as String?

  private fun assertProtocolError(code: Int, block: () -> Unit) {
    try {
      block()
      fail("expected protocol error $code")
    } catch (e: WebSocketCodec.ProtocolException) {
      assertEquals(code, e.closeCode)
    }
  }

  private class FakeTransport : GeminiLiveTransport {
    override var listener: GeminiLiveTransport.Listener? = null
    val sent = ArrayList<Map<String, Any?>>()
    var closed = false

    override fun send(message: Map<String, Any?>) {
      if (!closed) sent.add(message)
    }

    override fun close() {
      closed = true
    }
  }

  private class FakeSink : PcmAudioSink {
    val rates = ArrayList<Int>()
    var flushes = 0

    override fun enqueue(pcm16le: ByteArray, sampleRate: Int) {
      rates.add(sampleRate)
    }

    override fun flush() {
      flushes++
    }

    override fun close() {}
  }
}
