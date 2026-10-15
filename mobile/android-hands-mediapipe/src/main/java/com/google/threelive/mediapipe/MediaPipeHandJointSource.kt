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

package com.google.threelive.mediapipe

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.components.containers.Category
import com.google.mediapipe.tasks.components.containers.Landmark
import com.google.mediapipe.tasks.components.containers.NormalizedLandmark
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import com.google.threelive.HandJointSource
import com.google.threelive.HandJointSources
import com.google.threelive.XRHandGestures
import java.io.Closeable

/**
 * Registers [MediaPipeHandJointSource] with [HandJointSources] so `xrHands != "none"` classifies
 * 21-landmark camera hand tracking on phones and tablets without pulling MediaPipe into the core
 * library.
 */
object ThreeLiveMediaPipeHands {
  /**
   * Wraps [landmarker] (or `null` when the app pushes [HandLandmarkerResult]s directly via
   * [MediaPipeHandJointSource.update]) in a [MediaPipeHandJointSource] and registers it as the
   * process-wide [HandJointSources] source.
   */
  @JvmStatic
  @JvmOverloads
  fun install(landmarker: HandLandmarker? = null): MediaPipeHandJointSource =
    MediaPipeHandJointSource(landmarker).also { HandJointSources.register(it) }

  /**
   * Creates a `VIDEO`-mode [HandLandmarker] loading `modelAssetPath` from the app's assets (for
   * example `"hand_landmarker.task"`) and installs it as the process-wide [HandJointSources]
   * source.
   */
  @JvmStatic
  @JvmOverloads
  fun installFromAsset(
    context: Context,
    modelAssetPath: String = "hand_landmarker.task",
    numHands: Int = 2,
  ): MediaPipeHandJointSource {
    val options =
      HandLandmarker.HandLandmarkerOptions.builder()
        .setBaseOptions(BaseOptions.builder().setModelAssetPath(modelAssetPath).build())
        .setRunningMode(RunningMode.VIDEO)
        .setNumHands(numHands.coerceIn(1, 2))
        .build()
    return install(HandLandmarker.createFromOptions(context, options))
  }
}

/**
 * A [HandJointSource] backed by MediaPipe [HandLandmarker].
 *
 * Apps either call [detect] / [detectForVideo] with camera [Bitmap] frames, or pass
 * [HandLandmarkerResult]s from a `LIVE_STREAM` listener to [update]. Prefers 3D `worldLandmarks()`
 * (in meters relative to the hand's geometric center) and falls back to `landmarks()` when world
 * landmarks are empty.
 */
class MediaPipeHandJointSource
@JvmOverloads
constructor(
  private val landmarker: HandLandmarker? = null,
) : HandJointSource, Closeable {

  @Volatile private var leftJoints: Map<String, DoubleArray>? = null
  @Volatile private var rightJoints: Map<String, DoubleArray>? = null

  override fun joints(hand: String): Map<String, DoubleArray>? =
    when (hand) {
      "left" -> leftJoints
      "right" -> rightJoints
      else -> null
    }

  /** Runs `IMAGE`-mode detection on [bitmap] and updates the tracked left/right joints. */
  fun detect(bitmap: Bitmap) {
    val lm = landmarker ?: return
    update(lm.detect(BitmapImageBuilder(bitmap).build()))
  }

  /** Runs `VIDEO`-mode detection on [bitmap] at [timestampMs] and updates the tracked joints. */
  fun detectForVideo(bitmap: Bitmap, timestampMs: Long) {
    val lm = landmarker ?: return
    update(lm.detectForVideo(BitmapImageBuilder(bitmap).build(), timestampMs))
  }

  /** Updates the tracked left/right joint maps from a [HandLandmarkerResult] (or clears on `null`). */
  fun update(result: HandLandmarkerResult?) {
    if (result == null) {
      clear()
      return
    }
    val parsed = parseResult(result)
    leftJoints = parsed["left"]
    rightJoints = parsed["right"]
  }

  /** Clears both hands (for example when camera tracking pauses). */
  fun clear() {
    leftJoints = null
    rightJoints = null
  }

  override fun close() {
    clear()
    landmarker?.close()
  }

  companion object {
    /**
     * Extracts `"left"` and `"right"` WebXR joint maps from a [HandLandmarkerResult], preferring 3D
     * `worldLandmarks()` (meters) and falling back to normalized `landmarks()`.
     */
    @JvmStatic
    fun parseResult(result: HandLandmarkerResult): Map<String, Map<String, DoubleArray>> {
      val world = result.worldLandmarks() ?: emptyList()
      val norm = result.landmarks() ?: emptyList()
      val hands = result.handedness() ?: emptyList()
      val count = maxOf(world.size, norm.size)
      if (count == 0) return emptyMap()
      val out = LinkedHashMap<String, Map<String, DoubleArray>>(2)
      for (i in 0 until count) {
        val side = selectHandSide(hands.getOrNull(i), i)
        val w = world.getOrNull(i)
        val joints =
          if (!w.isNullOrEmpty()) {
            fromWorldLandmarks(w)
          } else {
            fromNormalizedLandmarks(norm.getOrNull(i) ?: emptyList())
          }
        if (joints.isNotEmpty()) out[side] = joints
      }
      return out
    }

    /** Converts 21 MediaPipe 3D [Landmark]s (meters, +Y down) into a WebXR joint map (+Y up). */
    @JvmStatic
    fun fromWorldLandmarks(landmarks: List<Landmark>): Map<String, DoubleArray> =
      XRHandGestures.fromMediaPipeLandmarks(
        landmarks.map { doubleArrayOf(it.x().toDouble(), it.y().toDouble(), it.z().toDouble()) },
        flipY = true,
      )

    /** Converts 21 MediaPipe [NormalizedLandmark]s (+Y down) into a WebXR joint map (+Y up). */
    @JvmStatic
    fun fromNormalizedLandmarks(landmarks: List<NormalizedLandmark>): Map<String, DoubleArray> =
      XRHandGestures.fromMediaPipeLandmarks(
        landmarks.map { doubleArrayOf(it.x().toDouble(), it.y().toDouble(), it.z().toDouble()) },
        flipY = true,
      )

    /**
     * Resolves `"left"` or `"right"` from MediaPipe's handedness categories. Defaults to `"right"`
     * for the first hand and `"left"` for the second when categories are missing.
     */
    @JvmStatic
    fun selectHandSide(categories: List<Category>?, handIndex: Int = 0): String {
      val top = categories?.maxByOrNull { it.score() }
      val name = (top?.categoryName()?.ifEmpty { top.displayName() })?.trim()?.lowercase() ?: ""
      return when {
        name.startsWith("left") -> "left"
        name.startsWith("right") -> "right"
        handIndex % 2 == 1 -> "left"
        else -> "right"
      }
    }
  }
}
