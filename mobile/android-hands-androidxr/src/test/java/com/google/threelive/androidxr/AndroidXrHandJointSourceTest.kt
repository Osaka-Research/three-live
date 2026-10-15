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

package com.google.threelive.androidxr

import androidx.xr.runtime.internal.HandJointType
import androidx.xr.runtime.math.Pose
import androidx.xr.runtime.math.Quaternion
import androidx.xr.runtime.math.Vector3
import com.google.threelive.XRHandGesture
import com.google.threelive.XRHandGestures
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Unit tests for [AndroidXrHandJointSource] joint-table and pose conversion. */
class AndroidXrHandJointSourceTest {

  @Test
  fun jointTableMapsAll25WebXrJointsAndClassifiesPinch() {
    assertEquals(25, AndroidXrHandJointSource.JOINT_NAMES.size)
    val poses =
      mapOf(
        HandJointType.WRIST to Pose(Vector3(0f, 0f, 0f)),
        HandJointType.THUMB_PROXIMAL to Pose(Vector3(0.02f, 0.03f, 0f)),
        HandJointType.THUMB_TIP to Pose(Vector3(0.02f, 0.12f, 0f)),
        HandJointType.INDEX_PROXIMAL to Pose(Vector3(0f, 0.06f, 0f)),
        HandJointType.INDEX_TIP to Pose(Vector3(0.025f, 0.12f, 0f)),
        HandJointType.MIDDLE_PROXIMAL to Pose(Vector3(0f, 0.06f, 0f)),
        HandJointType.MIDDLE_TIP to Pose(Vector3(0f, 0.16f, 0f)),
        HandJointType.RING_PROXIMAL to Pose(Vector3(0f, 0.06f, 0f)),
        HandJointType.RING_TIP to Pose(Vector3(-0.02f, 0.15f, 0f)),
        HandJointType.LITTLE_PROXIMAL to Pose(Vector3(0f, 0.06f, 0f)),
        HandJointType.LITTLE_TIP to Pose(Vector3(-0.04f, 0.14f, 0f)),
      )
    val webJoints = AndroidXrHandJointSource.toWebXrJoints(isActive = true, poses)
    assertNotNull(webJoints)
    assertEquals(XRHandGesture.PINCH, XRHandGestures.classify(webJoints!!).gesture)
    assertNull(AndroidXrHandJointSource.toWebXrJoints(isActive = false, poses))
    assertNull(AndroidXrHandJointSource.toWebXrJoints(isActive = true, emptyMap()))
  }

  @Test
  fun toXRPoseCopiesTranslationAndQuaternionAndRejectsNonFinite() {
    val pose = Pose(Vector3(0.1f, 0.2f, -0.4f), Quaternion(0f, 0.70710677f, 0f, 0.70710677f))
    val xrPose = AndroidXrHandJointSource.toXRPose(pose)
    assertNotNull(xrPose)
    assertArrayEquals(floatArrayOf(0.1f, 0.2f, -0.4f), xrPose!!.position, 1e-6f)
    assertArrayEquals(floatArrayOf(0f, 0.70710677f, 0f, 0.70710677f), xrPose.quaternion, 1e-6f)
    assertNull(AndroidXrHandJointSource.toXRPose(null))
    assertNull(AndroidXrHandJointSource.toXRPose(Pose(Vector3(Float.NaN, 0f, 0f))))
  }
}
