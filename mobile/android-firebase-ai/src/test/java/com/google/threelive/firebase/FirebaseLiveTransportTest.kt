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

import com.google.firebase.ai.type.InlineDataPart
import com.google.firebase.ai.type.TextPart
import com.google.threelive.MiniJson
import com.google.threelive.gemini.LiveBase64
import com.google.threelive.gemini.TranscriptEvent
import com.google.threelive.gemini.TranscriptSpeaker
import com.google.threelive.gemini.XRGeminiLiveController
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Firebase message conversion feeds the same controller logic as the plain Live API. */
class FirebaseLiveTransportTest {

  @Test
  fun serverContentConvertsToLiveApiShape() {
    val json =
      FirebaseLiveTransport.serverContentJson(
        interrupted = true,
        turnComplete = true,
        inputTranscription = "question",
        outputTranscription = null,
        modelParts = listOf(TextPart("hi"), InlineDataPart(byteArrayOf(1, 2), "audio/pcm;rate=24000")),
      )
    val content = MiniJson.asMap(json["serverContent"])!!
    assertEquals(true, content["interrupted"])
    assertEquals(true, content["turnComplete"])
    assertEquals(mapOf("text" to "question"), content["inputTranscription"])
    assertNull(content["outputTranscription"])
    val parts = MiniJson.asList(MiniJson.asMap(content["modelTurn"])!!["parts"])!!
    assertEquals(mapOf("text" to "hi"), parts[0])
    val inline = MiniJson.asMap(MiniJson.asMap(parts[1])!!["inlineData"])!!
    assertEquals(LiveBase64.encode(byteArrayOf(1, 2)), inline["data"])

    val events = ArrayList<TranscriptEvent>()
    val c = XRGeminiLiveController()
    c.listener =
      object : XRGeminiLiveController.Listener {
        override fun onTranscript(event: TranscriptEvent) {
          events.add(event)
        }
      }
    c.handleServerMessage(json)
    assertEquals(TranscriptEvent(TranscriptSpeaker.USER, "question", true), events.first { it.isFinal })
  }

  @Test
  fun clientContentTextJoinsTurnParts() {
    val content =
      MiniJson.parseObjectOrNull("""{"turns":[{"role":"user","parts":[{"text":"a"},{"text":"b"}]}],"turnComplete":true}""")!!
    assertEquals("ab", FirebaseLiveTransport.clientContentText(content))
  }
}
