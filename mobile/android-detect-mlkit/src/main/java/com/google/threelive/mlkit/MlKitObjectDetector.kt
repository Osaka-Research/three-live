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

package com.google.threelive.mlkit

import android.graphics.BitmapFactory
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.objects.DetectedObject
import com.google.mlkit.vision.objects.ObjectDetection
import com.google.mlkit.vision.objects.ObjectDetector
import com.google.mlkit.vision.objects.ObjectDetectorOptionsBase
import com.google.mlkit.vision.objects.defaults.ObjectDetectorOptions
import com.google.threelive.CapturedFrame
import com.google.threelive.ThreeLiveDetections
import com.google.threelive.ThreeLiveObjectDetector
import com.google.threelive.ThreeLiveObjectDetectors
import java.io.Closeable
import java.util.concurrent.Executors

/**
 * Registers [MlKitObjectDetector] with [ThreeLiveObjectDetectors] so `objectDetection = "on-device"`
 * runs ML Kit Object Detection without pulling ML Kit into the core library.
 */
object ThreeLiveMlKitDetector {
  /**
   * Creates an [MlKitObjectDetector] with [options] (or the coarse-category streaming defaults) and
   * registers it as the process-wide [ThreeLiveObjectDetectors] detector.
   */
  @JvmStatic
  @JvmOverloads
  fun install(
    options: ObjectDetectorOptionsBase = MlKitObjectDetector.defaultOptions(),
    minConfidence: Float = 0.0f,
  ): MlKitObjectDetector =
    MlKitObjectDetector(ObjectDetection.getClient(options), minConfidence).also {
      ThreeLiveObjectDetectors.register(it)
    }
}

/**
 * An on-device [ThreeLiveObjectDetector] backed by ML Kit [ObjectDetector] (default coarse labels,
 * or a custom TFLite model when constructed with `CustomObjectDetectorOptions`).
 *
 * JPEG decoding runs on a single background thread; ML Kit inference runs asynchronously and invokes
 * the callback with normalized `[ymin, xmin, ymax, xmax]` boxes in `0..1`.
 */
class MlKitObjectDetector
@JvmOverloads
constructor(
  private val client: ObjectDetector = ObjectDetection.getClient(defaultOptions()),
  private val minConfidence: Float = 0.0f,
) : ThreeLiveObjectDetector, Closeable {

  @Volatile private var closed = false
  private val decoder =
    Executors.newSingleThreadExecutor { r ->
      Thread(r, "three-live-mlkit-decode").apply { isDaemon = true }
    }

  override fun detect(frame: CapturedFrame, callback: (List<ThreeLiveDetections.Box>) -> Unit) {
    if (closed || frame.jpeg.isEmpty()) {
      callback(emptyList())
      return
    }
    decoder.execute {
      if (closed) {
        callback(emptyList())
        return@execute
      }
      val bitmap = BitmapFactory.decodeByteArray(frame.jpeg, 0, frame.jpeg.size)
      if (bitmap == null || bitmap.width <= 0 || bitmap.height <= 0) {
        callback(emptyList())
        return@execute
      }
      val width = bitmap.width
      val height = bitmap.height
      val image = InputImage.fromBitmap(bitmap, 0)
      client
        .process(image)
        .addOnSuccessListener { objects ->
          callback(toBoxes(objects ?: emptyList(), width, height, minConfidence))
        }
        .addOnFailureListener { callback(emptyList()) }
    }
  }

  override fun close() {
    closed = true
    decoder.shutdownNow()
    client.close()
  }

  companion object {
    /** Default ML Kit options: streaming mode with multiple objects and coarse classification. */
    @JvmStatic
    fun defaultOptions(): ObjectDetectorOptions =
      ObjectDetectorOptions.Builder()
        .setDetectorMode(ObjectDetectorOptions.STREAM_MODE)
        .enableMultipleObjects()
        .enableClassification()
        .build()

    /** Converts ML Kit [DetectedObject] results into normalized `0..1` [ThreeLiveDetections.Box]es. */
    @JvmStatic
    @JvmOverloads
    fun toBoxes(
      objects: List<DetectedObject>,
      width: Int,
      height: Int,
      minConfidence: Float = 0.0f,
    ): List<ThreeLiveDetections.Box> {
      if (width <= 0 || height <= 0 || objects.isEmpty()) return emptyList()
      val out = ArrayList<ThreeLiveDetections.Box>()
      for (obj in objects) {
        if (out.size >= ThreeLiveDetections.MAX_DETECTIONS) break
        val rect = obj.boundingBox
        val label = selectLabel(obj.labels, minConfidence) ?: continue
        normalizeRect(rect.left, rect.top, rect.right, rect.bottom, width, height, label)?.let {
          out.add(it)
        }
      }
      return out
    }

    /**
     * Picks the highest-confidence label from [labels]. When [labels] is empty (e.g. an unclassified
     * object), returns `"object"` if [minConfidence] <= 0, or `null` otherwise.
     */
    @JvmStatic
    fun selectLabel(labels: List<DetectedObject.Label>?, minConfidence: Float): String? {
      if (labels.isNullOrEmpty()) {
        return if (minConfidence <= 0.0f) "object" else null
      }
      var best: DetectedObject.Label? = null
      for (l in labels) {
        if (l.confidence >= minConfidence && (best == null || l.confidence > best.confidence)) {
          best = l
        }
      }
      val chosen = best ?: return null
      return chosen.text.trim().take(256).ifEmpty { "object" }
    }

    /**
     * Normalizes pixel bounds `([left], [top], [right], [bottom])` in a `([width] x [height])` image
     * to `[ymin, xmin, ymax, xmax]` in `0..1`. Returns `null` when the clamped box is empty.
     */
    @JvmStatic
    fun normalizeRect(
      left: Int,
      top: Int,
      right: Int,
      bottom: Int,
      width: Int,
      height: Int,
      label: String,
    ): ThreeLiveDetections.Box? {
      if (width <= 0 || height <= 0) return null
      val xmin = (left.toDouble() / width).coerceIn(0.0, 1.0)
      val ymin = (top.toDouble() / height).coerceIn(0.0, 1.0)
      val xmax = (right.toDouble() / width).coerceIn(0.0, 1.0)
      val ymax = (bottom.toDouble() / height).coerceIn(0.0, 1.0)
      if (xmax <= xmin || ymax <= ymin) return null
      return ThreeLiveDetections.Box(
        doubleArrayOf(ymin, xmin, ymax, xmax),
        label.take(256).ifEmpty { "object" },
      )
    }
  }
}
