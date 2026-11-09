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

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.google.threelive.XRHoldToAskTrait
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * [PcmAudioSink] backed by a streaming [AudioTrack]. Chunks are written on a dedicated thread so
 * the transport thread never blocks; [flush] drops queued and buffered audio for barge-in.
 */
class AudioTrackPcmSink : PcmAudioSink {
  private val queue = LinkedBlockingQueue<Pair<ByteArray, Int>>(MAX_QUEUED_CHUNKS)
  private val running = AtomicBoolean(true)
  private val generation = java.util.concurrent.atomic.AtomicInteger(0)
  @Volatile private var track: AudioTrack? = null
  private var trackRate = 0

  private val thread =
    Thread({ playLoop() }, "three-live-gemini-audio").apply {
      isDaemon = true
      start()
    }

  override fun enqueue(pcm16le: ByteArray, sampleRate: Int) {
    if (running.get() && pcm16le.size >= 2) queue.offer(pcm16le to sampleRate)
  }

  override fun flush() {
    generation.incrementAndGet()
    queue.clear()
    track?.let {
      try {
        it.pause()
        it.flush()
        it.play()
      } catch (e: IllegalStateException) {
        // Track released concurrently.
      }
    }
  }

  override fun close() {
    if (!running.compareAndSet(true, false)) return
    queue.clear()
    thread.interrupt()
  }

  private fun playLoop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO)
    try {
      while (running.get()) {
        val (pcm, rate) = queue.poll(250, TimeUnit.MILLISECONDS) ?: continue
        val gen = generation.get()
        val t = trackFor(rate) ?: continue
        var off = 0
        while (off < pcm.size && running.get() && gen == generation.get()) {
          val n = t.write(pcm, off, pcm.size - off)
          if (n <= 0) break
          off += n
        }
      }
    } catch (e: InterruptedException) {
      // Closing.
    } finally {
      track?.release()
      track = null
    }
  }

  private fun trackFor(rate: Int): AudioTrack? {
    if (track != null && trackRate == rate) return track
    track?.release()
    val min = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) return null
    val t =
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()
        )
        .setBufferSizeInBytes(min * 4)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
    t.play()
    track = t
    trackRate = rate
    return t
  }

  private companion object {
    const val MAX_QUEUED_CHUNKS = 256
  }
}

/**
 * Streams 16 kHz mono PCM16 microphone audio to an [XRGeminiLiveController]. Requires the
 * `RECORD_AUDIO` runtime permission (checked in [start]); declare it in the app manifest.
 */
class MicrophoneStreamer(
  private val sampleRate: Int,
  private val onChunk: (ByteArray) -> Unit,
) {
  /** Streams 16 kHz audio to a Gemini Live [controller]. */
  constructor(controller: XRGeminiLiveController) : this(RATE, { chunk -> controller.sendAudioChunk(chunk, RATE) })

  private val chunkBytes = sampleRate / 10 * 2
  private val running = AtomicBoolean(false)
  private var thread: Thread? = null

  /** Starts capturing. Returns `false` when permission is missing or the mic is unavailable. */
  @SuppressLint("MissingPermission")
  fun start(context: Context): Boolean {
    if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      return false
    }
    if (!running.compareAndSet(false, true)) return true
    val min = AudioRecord.getMinBufferSize(sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (min <= 0) {
      running.set(false)
      return false
    }
    val record =
      try {
        AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, sampleRate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(min, chunkBytes * 2))
      } catch (e: IllegalArgumentException) {
        running.set(false)
        return false
      }
    if (record.state != AudioRecord.STATE_INITIALIZED) {
      record.release()
      running.set(false)
      return false
    }
    thread =
      Thread(
          {
            val buf = ByteArray(chunkBytes)
            try {
              record.startRecording()
              while (running.get()) {
                val n = record.read(buf, 0, buf.size)
                if (n > 0) onChunk(buf.copyOf(n))
              }
            } finally {
              try {
                record.stop()
              } catch (e: IllegalStateException) {
                // Never started.
              }
              record.release()
            }
          },
          "three-live-gemini-mic",
        )
        .apply {
          isDaemon = true
          start()
        }
    return true
  }

  /** Stops capturing. */
  fun stop() {
    running.set(false)
    thread = null
  }

  private companion object {
    const val RATE = 16_000
  }
}

/**
 * Hold-to-ask: while the user long-presses a `holdToAsk` node, transcribes speech with the platform
 * [SpeechRecognizer] (when available and permitted), then sends the web-compatible prompt to the
 * Gemini session. Without speech recognition the trait's default prompt is sent. Main thread only.
 */
class HoldToAskController(
  private val context: Context,
  private val controller: XRGeminiLiveController,
) {
  /** Reports each finished query: `{mesh, transcript, prompt}` (the web `xr-hold-to-ask` detail). */
  fun interface Listener {
    fun onHoldToAsk(mesh: String, transcript: String, prompt: String)
  }

  var listener: Listener? = null

  private var recognizer: SpeechRecognizer? = null
  private var mesh: String = ""
  private var options = XRHoldToAskTrait()
  private var transcript = ""
  private var active = false
  private var finalResult = false
  private var awaitingResult = false
  private val handler = Handler(Looper.getMainLooper())
  private val fallback = Runnable { if (awaitingResult) finish() }

  /** Starts listening for [meshName]. */
  fun begin(meshName: String?, trait: XRHoldToAskTrait) {
    cancel()
    active = true
    mesh = meshName ?: ""
    options = trait
    transcript = ""
    finalResult = false
    val canListen =
      SpeechRecognizer.isRecognitionAvailable(context) &&
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    if (!canListen) return
    val r = SpeechRecognizer.createSpeechRecognizer(context)
    r.setRecognitionListener(
      object : RecognitionListener {
        override fun onResults(results: Bundle?) {
          transcript = bestResult(results) ?: transcript
          finalResult = true
          if (awaitingResult) finish()
        }

        override fun onPartialResults(partialResults: Bundle?) {
          bestResult(partialResults)?.let { transcript = it }
        }

        override fun onError(error: Int) {
          finalResult = true
          if (awaitingResult) finish()
        }

        override fun onReadyForSpeech(params: Bundle?) {}

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rmsdB: Float) {}

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {}

        override fun onEvent(eventType: Int, params: Bundle?) {}
      }
    )
    r.startListening(
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
    )
    recognizer = r
  }

  /** The press ended: sends the query (after the recognizer's final result, if listening). */
  fun end() {
    if (!active) return
    active = false
    val r = recognizer
    if (r == null || finalResult) {
      finish()
    } else {
      // Wait briefly for the final transcript, then send whatever was heard.
      awaitingResult = true
      r.stopListening()
      handler.postDelayed(fallback, RESULT_TIMEOUT_MS)
    }
  }

  /** Abandons the current press without sending anything. */
  fun cancel() {
    active = false
    awaitingResult = false
    handler.removeCallbacks(fallback)
    recognizer?.destroy()
    recognizer = null
  }

  private fun finish() {
    awaitingResult = false
    handler.removeCallbacks(fallback)
    recognizer?.destroy()
    recognizer = null
    val prompt = XRGeminiLiveController.buildHoldToAskPrompt(mesh, options, transcript)
    controller.sendText(prompt)
    listener?.onHoldToAsk(mesh, transcript.take(XRGeminiLiveController.MAX_TEXT_CHARS), prompt)
  }

  private fun bestResult(b: Bundle?): String? =
    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.takeIf { it.isNotBlank() }

  private companion object {
    const val RESULT_TIMEOUT_MS = 2_500L
  }
}
