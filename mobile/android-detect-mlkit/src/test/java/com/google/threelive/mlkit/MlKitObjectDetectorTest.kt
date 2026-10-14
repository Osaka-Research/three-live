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

import com.google.mlkit.vision.objects.DetectedObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Unit tests for [MlKitObjectDetector] box normalization and label selection. */
class MlKitObjectDetectorTest {

  @Test
  fun normalizeRectClampsAndOrdersYminXminYmaxXmax() {
    val box = MlKitObjectDetector.normalizeRect(100, 50, 300, 150, 400, 200, "chair")!!
    assertEquals("chair", box.label)
    assertArrayEquals(doubleArrayOf(0.25, 0.25, 0.75, 0.75), box.box, 1e-9)

    val clamped = MlKitObjectDetector.normalizeRect(-20, -10, 500, 300, 400, 200, "")!!
    assertEquals("object", clamped.label)
    assertArrayEquals(doubleArrayOf(0.0, 0.0, 1.0, 1.0), clamped.box, 1e-9)

    assertNull(MlKitObjectDetector.normalizeRect(100, 50, 100, 150, 400, 200, "chair"))
    assertNull(MlKitObjectDetector.normalizeRect(100, 150, 200, 50, 400, 200, "chair"))
    assertNull(MlKitObjectDetector.normalizeRect(0, 0, 10, 10, 0, 200, "chair"))
  }

  @Test
  fun selectLabelPicksHighestConfidenceOrFallsBackToObject() {
    val labels =
      listOf(
        DetectedObject.Label("Food", 0.4f, 0),
        DetectedObject.Label("Home good", 0.85f, 1),
      )
    assertEquals("Home good", MlKitObjectDetector.selectLabel(labels, 0.5f))
    assertNull(MlKitObjectDetector.selectLabel(labels, 0.9f))
    assertEquals("object", MlKitObjectDetector.selectLabel(emptyList(), 0.0f))
    assertNull(MlKitObjectDetector.selectLabel(emptyList(), 0.2f))
  }
}
