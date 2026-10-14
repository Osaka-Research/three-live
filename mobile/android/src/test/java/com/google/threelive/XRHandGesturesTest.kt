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

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Gesture classifier (web `makeTestHand` vectors) and batch detection unprojection. */
class XRHandGesturesTest {

  @Test
  fun webTestHandsClassifyIdentically() {
    assertEquals(XRHandGesture.PINCH, XRHandGestures.classify(hand("pinch")).gesture)
    assertEquals(XRHandGesture.POINT, XRHandGestures.classify(hand("point")).gesture)
    assertEquals(XRHandGesture.FIST, XRHandGestures.classify(hand("fist")).gesture)
    assertEquals(XRHandGesture.THUMBS_UP, XRHandGestures.classify(hand("thumbs-up")).gesture)
    val palm = XRHandGestures.classify(hand("open-palm")).gesture
    assertTrue(palm == XRHandGesture.OPEN_PALM || palm == XRHandGesture.SPREAD)
    val pinch = XRHandGestures.classify(hand("pinch"))
    assertEquals(minOf(1.0, (0.022 - 0.005) / 0.015), pinch.confidence, 1e-9)
    assertEquals(XRHandGesture.NONE, XRHandGestures.classify(emptyMap()).gesture)
  }

  @Test
  fun trackerReportsOnlyChangesAndReArmsOnNone() {
    val t = XRHandGestureTracker()
    assertNotNull(t.update("left", hand("fist")))
    assertNull(t.update("left", hand("fist")))
    assertNotNull(t.update("right", hand("fist")))
    assertNull(t.update("left", emptyMap()))
    assertEquals(XRHandGesture.FIST, t.update("left", hand("fist"))!!.gesture)
  }

  @Test
  fun detectionsUseFallbackDepthAndCap() {
    val identity = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = 1f; it[15] = 1f }
    // Symmetric perspective (90° vertical FOV, aspect 1).
    val proj = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = -1f; it[11] = -1f; it[14] = -0.2f }
    val boxes = List(40) { ThreeLiveDetections.Box(doubleArrayOf(0.4, 0.4, 0.6, 0.6), "cup") }
    val out = ThreeLiveDetections.detect(boxes, identity, proj)
    assertEquals(ThreeLiveDetections.MAX_DETECTIONS, out.size)
    assertEquals(-WorldUnderstanding.FALLBACK_DEPTH_METERS, out[0].z, 1e-6)
    var sampled: Pair<Double, Double>? = null
    val withDepth = ThreeLiveDetections.detect(boxes.take(1), identity, proj, depthAt = { u, v -> sampled = u to v; 1.0 })
    assertEquals(-1.0, withDepth[0].z, 1e-6)
    assertEquals(0.5, sampled!!.first, 1e-9)
    assertTrue(ThreeLiveDetections.detect(boxes, FloatArray(3), proj).isEmpty())
  }

  private fun hand(mode: String): Map<String, DoubleArray> {
    val m =
      hashMapOf(
        "wrist" to v(0.0, 0.0),
        "thumb-metacarpal" to v(0.02, 0.03),
        "index-finger-metacarpal" to v(0.0, 0.06),
        "middle-finger-metacarpal" to v(0.0, 0.06),
        "ring-finger-metacarpal" to v(0.0, 0.06),
        "pinky-finger-metacarpal" to v(0.0, 0.06),
      )
    val tips =
      when (mode) {
        "pinch" -> listOf(v(0.02, 0.12), v(0.025, 0.12), v(0.0, 0.16), v(-0.02, 0.15), v(-0.04, 0.14))
        "point" -> listOf(v(0.01, 0.02), v(0.0, 0.18), v(0.0, 0.02), v(0.0, 0.02), v(0.0, 0.02))
        "fist" -> listOf(v(0.01, 0.01), v(0.0, 0.02), v(0.0, 0.02), v(0.0, 0.02), v(0.0, 0.02))
        "thumbs-up" -> {
          m["thumb-metacarpal"] = v(0.0, 0.05)
          listOf(v(0.0, 0.16), v(0.0, 0.02), v(0.0, 0.02), v(0.0, 0.02), v(0.0, 0.02))
        }
        else -> listOf(v(0.04, 0.09), v(0.01, 0.18), v(0.0, 0.19), v(-0.01, 0.18), v(-0.02, 0.16))
      }
    for ((k, name) in listOf("thumb-tip", "index-finger-tip", "middle-finger-tip", "ring-finger-tip", "pinky-finger-tip").withIndex()) {
      m[name] = tips[k]
    }
    return m
  }

  private fun v(x: Double, y: Double): DoubleArray = doubleArrayOf(x, y, 0.0)
}
