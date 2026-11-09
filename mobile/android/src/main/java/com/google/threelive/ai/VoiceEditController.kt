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

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Push-to-talk voice editing for Android (B2b-2), like `el.startVoiceEdit()` on the web: the
 * platform [SpeechRecognizer] turns one utterance into an instruction for
 * [ThreeLiveAIEditor.editScene] (applied to the current selection), and the result is spoken
 * with [TextToSpeech]. Needs the `RECORD_AUDIO` permission. Main thread only.
 *
 * Talk-to-Select (B2b-4): "select the red chairs", "also select the lamp", "deselect the left
 * one", and "clear the selection" change the selection instead of editing; "select the lamp and
 * make it blue" selects, then edits right away when the reference was unambiguous. Otherwise it
 * asks which one was meant and changes nothing.
 */
class VoiceEditController(
  private val context: Context,
  private val editor: ThreeLiveAIEditor,
  private val scope: CoroutineScope,
  /** Speak the result (default true). */
  private val speakResults: Boolean = true,
  /** Treat "select …" / "deselect …" / "clear the selection" as selection commands (default true). */
  private val talkToSelect: Boolean = true,
) {
  /** Progress callbacks (main thread). */
  interface Listener {
    fun onListening(partial: String) {}

    fun onEditing(transcript: String) {}

    fun onResult(transcript: String, result: EditResult) {}

    /** The utterance changed (or tried to change) the selection. */
    fun onSelection(transcript: String, selection: AIVoiceSelection) {}

    fun onError(message: String) {}
  }

  var listener: Listener? = null

  private var recognizer: SpeechRecognizer? = null
  private var tts: TextToSpeech? = null
  private var ttsReady = false

  /** True while listening for an utterance. */
  val isListening: Boolean
    get() = recognizer != null

  /** Starts listening for one utterance. Returns false when speech recognition is unavailable. */
  fun start(languageTag: String? = null): Boolean {
    if (recognizer != null) return true
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      listener?.onError("Speech recognition is not available; use AIVoiceSession instead.")
      return false
    }
    val rec = SpeechRecognizer.createSpeechRecognizer(context)
    recognizer = rec
    rec.setRecognitionListener(
      object : RecognitionListener {
        override fun onResults(results: Bundle?) {
          finish(best(results))
        }

        override fun onPartialResults(partialResults: Bundle?) {
          best(partialResults)?.let { listener?.onListening(it) }
        }

        override fun onError(error: Int) {
          val noSpeech = error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
          release()
          if (noSpeech) speakAndReport("I didn't catch that.") else listener?.onError("Speech recognition failed ($error).")
        }

        override fun onReadyForSpeech(params: Bundle?) {}

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rmsdB: Float) {}

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {}

        override fun onEvent(eventType: Int, params: Bundle?) {}
      }
    )
    val intent =
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        if (languageTag != null) putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
      }
    rec.startListening(intent)
    listener?.onListening("")
    return true
  }

  /** Stops listening and edits with what was heard so far. */
  fun stop() {
    recognizer?.stopListening()
  }

  /** Cancels without editing. */
  fun cancel() {
    release()
  }

  /** Releases the recognizer and speech synthesizer. */
  fun destroy() {
    release()
    tts?.shutdown()
    tts = null
  }

  private fun finish(transcript: String?) {
    release()
    val text = transcript?.trim()?.take(AIVoiceSession.MAX_TEXT).orEmpty()
    if (text.isEmpty()) {
      speakAndReport("I didn't catch that.")
      return
    }
    scope.launch {
      var instruction = text
      var prefix = ""
      val command = if (talkToSelect) editor.parseCommand(text) else emptyMap()
      val kind = command["kind"] as? String ?: "edit"
      if (kind != "edit") {
        val selection =
          editor.selectByVoice(if (kind == "clear") "" else (command["query"] as? String).orEmpty(), command["mode"] as? String ?: "replace")
        listener?.onSelection(text, selection)
        val pending = if (kind == "mixed") command["instruction"] as? String else null
        // Edit right away only when the reference was resolved locally (tier 1) and confidently.
        if (pending == null || !selection.applied || selection.tier != 1) {
          val hint = if (pending != null && selection.applied) " Say the change again to apply it." else ""
          if (speakResults) speak(selection.say + hint)
          return@launch
        }
        instruction = pending
        prefix = selection.say + " "
      }
      listener?.onEditing(instruction)
      val result = editor.editScene(instruction)
      listener?.onResult(instruction, result)
      if (speakResults) speak(prefix + editor.describe(result))
    }
  }

  private fun speakAndReport(message: String) {
    listener?.onError(message)
    if (speakResults) speak(message)
  }

  private fun speak(text: String) {
    val engine = tts
    if (engine != null && ttsReady) {
      engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "three-live-voice-edit")
      return
    }
    if (engine == null) {
      tts =
        TextToSpeech(context) { status ->
          ttsReady = status == TextToSpeech.SUCCESS
          if (ttsReady) tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "three-live-voice-edit")
        }
    }
  }

  private fun release() {
    recognizer?.destroy()
    recognizer = null
  }

  private fun best(b: Bundle?): String? =
    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }
}
