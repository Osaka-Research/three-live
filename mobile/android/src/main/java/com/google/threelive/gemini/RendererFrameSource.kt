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

import com.google.threelive.CapturedFrame
import com.google.threelive.ThreeLiveSceneRenderer

/**
 * A Gemini Live [FrameSource] that captures frames from a [ThreeLiveSceneRenderer] and remembers
 * the camera matrices of the most recently delivered frames, so detections the model reports for
 * "the image it saw" can be unprojected with the matching camera ([latestFrame]).
 *
 * Capture is skipped (returns `null`) while [paused], e.g. when the view is in the background.
 */
class RendererFrameSource
@JvmOverloads
constructor(
  private val renderer: ThreeLiveSceneRenderer,
  private val maxEdge: Int = DEFAULT_MAX_EDGE,
) : FrameSource {
  /** When `true`, no frames are captured or sent. */
  @Volatile var paused: Boolean = false

  private val recent = ArrayDeque<CapturedFrame>()

  override fun captureJpeg(onFrame: (ByteArray?) -> Unit) {
    if (paused) {
      onFrame(null)
      return
    }
    renderer.captureFrame(maxEdge.coerceIn(64, 4096)) { frame ->
      if (frame == null || paused) {
        onFrame(null)
      } else {
        remember(frame)
        onFrame(frame.jpeg)
      }
    }
  }

  /** The most recently delivered frame (its matrices describe what the model last saw), or `null`. */
  val latestFrame: CapturedFrame?
    get() = synchronized(recent) { recent.lastOrNull() }

  /** Delivered frames, oldest first (at most [HISTORY]). */
  fun recentFrames(): List<CapturedFrame> = synchronized(recent) { recent.toList() }

  private fun remember(frame: CapturedFrame) {
    synchronized(recent) {
      recent.addLast(frame)
      while (recent.size > HISTORY) recent.removeFirst()
    }
  }

  companion object {
    /** Default longest edge of streamed frames, in pixels. */
    const val DEFAULT_MAX_EDGE: Int = 768

    /** Number of delivered frames whose matrices are kept. */
    const val HISTORY: Int = 4

    /** Scales ([width], [height]) so the longest edge is at most [maxEdge], keeping aspect (≥ 1 px). */
    @JvmStatic
    fun fitWithin(width: Int, height: Int, maxEdge: Int): IntArray {
      if (width <= 0 || height <= 0) return intArrayOf(0, 0)
      val longest = maxOf(width, height)
      if (longest <= maxEdge) return intArrayOf(width, height)
      val k = maxEdge.toDouble() / longest
      return intArrayOf(maxOf(1, Math.round(width * k).toInt()), maxOf(1, Math.round(height * k).toInt()))
    }
  }
}
