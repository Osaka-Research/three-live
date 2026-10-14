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

package com.google.threelive.firebase

import com.google.firebase.ai.LiveGenerativeModel
import com.google.firebase.ai.type.InlineData
import com.google.firebase.ai.type.InlineDataPart
import com.google.firebase.ai.type.LiveServerContent
import com.google.firebase.ai.type.LiveServerMessage
import com.google.firebase.ai.type.LiveSession
import com.google.firebase.ai.type.Part
import com.google.firebase.ai.type.TextPart
import com.google.threelive.MiniJson
import com.google.threelive.gemini.GeminiLiveTransport
import com.google.threelive.gemini.LiveBase64
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch

/**
 * [GeminiLiveTransport] backed by a Firebase AI Logic [LiveSession].
 *
 * Lets apps that already use Firebase (App Check, Firebase Auth, Vertex AI backend) drive the same
 * `XRGeminiLiveController` as the default plain Live API transport. Server messages are converted
 * back to Live API JSON shapes, and client `clientContent` / `realtimeInput` messages are mapped onto
 * the session's text, audio and video methods. Model, voice and system instruction come from the
 * [LiveGenerativeModel], so `setup` messages are ignored.
 *
 * ```kotlin
 * val model = Firebase.ai(backend = GenerativeBackend.googleAI()).liveModel("gemini-live-2.5-flash", ...)
 * val transport = FirebaseLiveTransport.connect(model)
 * controller.connect(transport)
 * ```
 */
class FirebaseLiveTransport(private val session: LiveSession) : GeminiLiveTransport {

  override var listener: GeminiLiveTransport.Listener? = null

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val outgoing = Channel<Map<String, Any?>>(Channel.BUFFERED)
  private val closed = AtomicBoolean(false)
  private val closeNotified = AtomicBoolean(false)

  init {
    scope.launch {
      try {
        session.receive().collect { msg -> toLiveApiJson(msg)?.let { listener?.onMessage(it) } }
      } catch (e: CancellationException) {
        throw e
      } catch (e: Exception) {
        // Session failed; reported through onClose below.
      } finally {
        notifyClose()
      }
    }
    // One sender keeps client messages in order.
    scope.launch {
      for (message in outgoing) {
        try {
          deliver(message)
        } catch (e: CancellationException) {
          throw e
        } catch (e: Exception) {
          // Drop messages the session rejects (e.g. after the server closed it).
        }
      }
    }
  }

  override fun send(message: Map<String, Any?>) {
    if (!closed.get()) outgoing.trySend(message)
  }

  override fun close() {
    if (!closed.compareAndSet(false, true)) return
    outgoing.close()
    scope.launch {
      try {
        session.close()
      } finally {
        notifyClose()
        scope.cancel()
      }
    }
  }

  private suspend fun deliver(message: Map<String, Any?>) {
    MiniJson.asMap(message["clientContent"])?.let { content ->
      val text = clientContentText(content)
      if (text.isNotEmpty()) session.send(text)
      return
    }
    val chunks = MiniJson.asList(MiniJson.asMap(message["realtimeInput"])?.get("mediaChunks")) ?: return
    for (chunk in chunks) {
      val c = MiniJson.asMap(chunk) ?: continue
      val mime = c["mimeType"] as? String ?: continue
      val bytes = (c["data"] as? String)?.let { LiveBase64.decodeOrNull(it) } ?: continue
      when {
        mime.startsWith("audio/") -> session.sendAudioRealtime(InlineData(bytes, mime))
        mime.startsWith("image/") -> session.sendVideoRealtime(InlineData(bytes, mime))
      }
    }
  }

  private fun notifyClose() {
    closed.set(true)
    if (closeNotified.compareAndSet(false, true)) listener?.onClose()
  }

  companion object {
    /** Connects [model] and wraps the resulting session. */
    @JvmStatic
    suspend fun connect(model: LiveGenerativeModel): FirebaseLiveTransport = FirebaseLiveTransport(model.connect())

    /** Concatenated text of a `clientContent` message's user turns. */
    @JvmStatic
    fun clientContentText(content: Map<String, Any?>): String {
      val sb = StringBuilder()
      for (turn in MiniJson.asList(content["turns"]) ?: emptyList()) {
        for (part in MiniJson.asList(MiniJson.asMap(turn)?.get("parts")) ?: emptyList()) {
          (MiniJson.asMap(part)?.get("text") as? String)?.let { sb.append(it) }
        }
      }
      return sb.toString()
    }

    /** Converts a Firebase server message to the Live API JSON shape, or `null` if irrelevant. */
    @JvmStatic
    fun toLiveApiJson(message: LiveServerMessage): Map<String, Any?>? {
      if (message !is LiveServerContent) return null
      return serverContentJson(
        message.interrupted,
        message.turnComplete,
        message.inputTranscription?.text,
        message.outputTranscription?.text,
        message.content?.parts ?: emptyList(),
      )
    }

    /** Builds `{serverContent: {...}}` from the fields of a Firebase `LiveServerContent`. */
    @JvmStatic
    fun serverContentJson(
      interrupted: Boolean,
      turnComplete: Boolean,
      inputTranscription: String?,
      outputTranscription: String?,
      modelParts: List<Part>,
    ): Map<String, Any?> {
      val content = LinkedHashMap<String, Any?>()
      if (interrupted) content["interrupted"] = true
      if (turnComplete) content["turnComplete"] = true
      inputTranscription?.let { content["inputTranscription"] = mapOf("text" to it) }
      outputTranscription?.let { content["outputTranscription"] = mapOf("text" to it) }
      val parts = ArrayList<Map<String, Any?>>()
      for (part in modelParts) {
        when (part) {
          is TextPart -> if (!part.isThought) parts.add(mapOf("text" to part.text))
          is InlineDataPart ->
            parts.add(
              mapOf("inlineData" to mapOf("mimeType" to part.mimeType, "data" to LiveBase64.encode(part.inlineData)))
            )
          else -> {}
        }
      }
      if (parts.isNotEmpty()) content["modelTurn"] = mapOf("parts" to parts)
      return mapOf("serverContent" to content)
    }
  }
}
