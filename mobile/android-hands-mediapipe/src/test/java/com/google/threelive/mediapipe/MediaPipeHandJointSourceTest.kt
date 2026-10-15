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

import com.google.mediapipe.tasks.components.containers.Category
import com.google.mediapipe.tasks.components.containers.Landmark
import com.google.threelive.HandJointSources
import com.google.threelive.XRHandGesture
import com.google.threelive.XRHandGestures
import java.util.Optional
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** Unit tests for [MediaPipeHandJointSource] 21-landmark conversion and handedness mapping. */
class MediaPipeHandJointSourceTest {

  @Test
  fun worldLandmarksFlipYAndClassifyThumbsUpAndPinch() {
    // MediaPipe world coordinates have +Y downward, so a thumbs-up has negative Y for the thumb tip.
    val thumbsUp = MutableList(21) { Landmark.create(0f, -0.02f, 0f, Optional.empty(), Optional.empty()) }
    thumbsUp[0] = lm(0f, 0f, 0f) // WRIST
    thumbsUp[1] = lm(0f, -0.03f, 0f) // THUMB_CMC
    thumbsUp[2] = lm(0f, -0.05f, 0f) // THUMB_MCP (proximal)
    thumbsUp[3] = lm(0f, -0.10f, 0f) // THUMB_IP
    thumbsUp[4] = lm(0f, -0.16f, 0f) // THUMB_TIP (upward -> negative Y in MediaPipe)
    for (base in intArrayOf(5, 9, 13, 17)) {
      thumbsUp[base] = lm(0f, -0.05f, 0f) // MCP
      thumbsUp[base + 1] = lm(0f, -0.06f, 0f) // PIP
      thumbsUp[base + 2] = lm(0f, -0.04f, 0f) // DIP
      thumbsUp[base + 3] = lm(0f, -0.02f, 0f) // TIP (curled back toward wrist)
    }
    val joints = MediaPipeHandJointSource.fromWorldLandmarks(thumbsUp)
    assertEquals(21, joints.size)
    assertEquals(XRHandGesture.THUMBS_UP, XRHandGestures.classify(joints).gesture)
  }

  @Test
  fun handednessAndInstallRegisterSource() {
    val left = listOf(Category.create(0.95f, 0, "Left", "Left"))
    val right = listOf(Category.create(0.9f, 1, "Right", "Right"))
    assertEquals("left", MediaPipeHandJointSource.selectHandSide(left, 0))
    assertEquals("right", MediaPipeHandJointSource.selectHandSide(right, 1))
    assertEquals("right", MediaPipeHandJointSource.selectHandSide(emptyList(), 0))
    assertEquals("left", MediaPipeHandJointSource.selectHandSide(emptyList(), 1))

    val src = ThreeLiveMediaPipeHands.install()
    assertSame(src, HandJointSources.current())
    assertNull(src.joints("left"))
    HandJointSources.register(null)
  }

  private fun lm(x: Float, y: Float, z: Float): Landmark =
    Landmark.create(x, y, z, Optional.empty(), Optional.empty())
}
