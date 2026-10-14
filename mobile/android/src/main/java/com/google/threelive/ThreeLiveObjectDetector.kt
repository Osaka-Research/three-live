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

package com.google.threelive

import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * An on-device object detector (for example the optional `three-live-detect-mlkit` module). It
 * receives a rendered (or camera) frame and reports 2D boxes in the `detections` format:
 * `[ymin, xmin, ymax, xmax]`, normalized 0..1 (or 0..1000), top-left origin.
 */
fun interface ThreeLiveObjectDetector {
  /**
   * Detects objects in [frame] (JPEG plus the camera it was rendered with). Calls [callback] exactly
   * once, on any thread, with an empty list when nothing was found or detection failed.
   */
  fun detect(frame: CapturedFrame, callback: (List<ThreeLiveDetections.Box>) -> Unit)
}

/** Process-wide registry for the on-device detector used by `objectDetection = "on-device"`. */
object ThreeLiveObjectDetectors {
  @Volatile private var detector: ThreeLiveObjectDetector? = null

  /** Registers [value] (replacing any previous detector); `null` unregisters. */
  @JvmStatic
  fun register(value: ThreeLiveObjectDetector?) {
    detector = value
  }

  /** The registered detector, or `null` when the app installed none. */
  @JvmStatic fun current(): ThreeLiveObjectDetector? = detector
}

/**
 * Periodically captures a frame from [renderer], runs [detector] on it, and reports the boxes
 * located in 3D with the camera of that frame. At most one frame is in flight; frames are skipped
 * while [paused]. [onDetected] runs on the detector's callback thread.
 */
class ObjectDetectionLoop
@JvmOverloads
constructor(
  private val renderer: ThreeLiveSceneRenderer,
  private val detector: ThreeLiveObjectDetector,
  private val intervalMs: Long = DEFAULT_INTERVAL_MS,
  private val maxEdge: Int = DEFAULT_MAX_EDGE,
  private val onDetected: (List<WorldUnderstanding.Detection3D>) -> Unit,
) {
  /** When `true`, no frames are captured. */
  @Volatile var paused: Boolean = false

  private val inFlight = AtomicBoolean(false)
  private val lock = Any()
  private var scheduler: ScheduledExecutorService? = null
  private var task: ScheduledFuture<*>? = null
  @Volatile private var stopped = false

  /** Starts detecting every [intervalMs] (clamped to 100–10000 ms). Idempotent. */
  fun start() {
    synchronized(lock) {
      if (scheduler != null) return
      stopped = false
      val interval = intervalMs.coerceIn(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
      val s = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "three-live-detect").apply { isDaemon = true } }
      scheduler = s
      task = s.scheduleWithFixedDelay({ val unused = tick() }, interval, interval, TimeUnit.MILLISECONDS)
    }
  }

  /** Stops detecting; results of a frame still in flight are dropped. */
  fun stop() {
    synchronized(lock) {
      stopped = true
      val unusedCancel = task?.cancel(false)
      task = null
      val unusedShutdown = scheduler?.shutdownNow()
      scheduler = null
    }
  }

  /** Runs one capture → detect → locate cycle. Returns `false` when skipped. */
  fun tick(): Boolean {
    if (paused || !inFlight.compareAndSet(false, true)) return false
    try {
      renderer.captureFrame(maxEdge.coerceIn(64, 4096)) { frame ->
        if (frame == null) {
          inFlight.set(false)
        } else {
          runDetector(frame)
        }
      }
    } catch (e: RuntimeException) {
      inFlight.set(false)
      return false
    }
    return true
  }

  private fun runDetector(frame: CapturedFrame) {
    try {
      detector.detect(frame) { boxes ->
        inFlight.set(false)
        if (paused || stopped || boxes.isEmpty()) return@detect
        val located = ThreeLiveDetections.detect(boxes, frame.cameraWorld, frame.projection)
        if (located.isNotEmpty()) onDetected(located)
      }
    } catch (e: RuntimeException) {
      // A failing detector must not stop the loop.
      inFlight.set(false)
    }
  }

  companion object {
    /** Default cadence: about twice a second. */
    const val DEFAULT_INTERVAL_MS: Long = 500

    /** Default longest edge of frames handed to the detector, in pixels. */
    const val DEFAULT_MAX_EDGE: Int = 640

    private const val MIN_INTERVAL_MS: Long = 100
    private const val MAX_INTERVAL_MS: Long = 10_000
  }
}
