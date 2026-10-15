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

import androidx.xr.arcore.Hand
import androidx.xr.runtime.Session
import androidx.xr.runtime.internal.HandJointType
import androidx.xr.runtime.math.Pose
import com.google.threelive.HandJointSource
import com.google.threelive.HandJointSources
import com.google.threelive.XRPose

/**
 * Registers [AndroidXrHandJointSource] with [HandJointSources] so `xrHands != "none"` reads Jetpack
 * XR (`androidx.xr.arcore`) hand joints on Android XR headsets without pulling Jetpack XR into the
 * core library.
 */
object ThreeLiveAndroidXrHands {
  /**
   * Creates an [AndroidXrHandJointSource] reading `Hand.left(session)` and `Hand.right(session)`
   * and registers it as the process-wide [HandJointSources] source.
   */
  @JvmStatic
  fun install(session: Session): AndroidXrHandJointSource =
    AndroidXrHandJointSource(Hand.left(session), Hand.right(session)).also {
      HandJointSources.register(it)
    }
}

/**
 * A [HandJointSource] backed by Jetpack XR [Hand] state flows (`Hand.left(session)` and
 * `Hand.right(session)`).
 *
 * Reads the current `Hand.state.value` snapshot on each query; returns `null` when a hand is
 * inactive (`!state.isActive`) or not available on the current device.
 */
class AndroidXrHandJointSource(
  private val leftHand: Hand?,
  private val rightHand: Hand?,
) : HandJointSource {

  override fun joints(hand: String): Map<String, DoubleArray>? {
    val state = handFor(hand)?.state?.value ?: return null
    return toWebXrJoints(state.isActive, state.handJoints)
  }

  override fun wristPose(hand: String): XRPose? {
    val state = handFor(hand)?.state?.value ?: return null
    if (!state.isActive) return null
    return toXRPose(state.handJoints[HandJointType.WRIST])
  }

  private fun handFor(hand: String): Hand? =
    when (hand) {
      "left" -> leftHand
      "right" -> rightHand
      else -> null
    }

  companion object {
    /**
     * Maps the 25 Jetpack XR [HandJointType] entries to their WebXR `XRHand` joint names (matching
     * `XRHandGestures` and visionOS `XRHandTrackingSource`). Note that `HandJointType.PALM` has no
     * distinct WebXR joint name (`wrist` in WebXR corresponds to `HandJointType.WRIST`).
     */
    @JvmField
    val JOINT_NAMES: Map<HandJointType, String> =
      linkedMapOf(
        HandJointType.WRIST to "wrist",
        HandJointType.THUMB_METACARPAL to "thumb-metacarpal",
        HandJointType.THUMB_PROXIMAL to "thumb-phalanx-proximal",
        HandJointType.THUMB_DISTAL to "thumb-phalanx-distal",
        HandJointType.THUMB_TIP to "thumb-tip",
        HandJointType.INDEX_METACARPAL to "index-finger-metacarpal",
        HandJointType.INDEX_PROXIMAL to "index-finger-phalanx-proximal",
        HandJointType.INDEX_INTERMEDIATE to "index-finger-phalanx-intermediate",
        HandJointType.INDEX_DISTAL to "index-finger-phalanx-distal",
        HandJointType.INDEX_TIP to "index-finger-tip",
        HandJointType.MIDDLE_METACARPAL to "middle-finger-metacarpal",
        HandJointType.MIDDLE_PROXIMAL to "middle-finger-phalanx-proximal",
        HandJointType.MIDDLE_INTERMEDIATE to "middle-finger-phalanx-intermediate",
        HandJointType.MIDDLE_DISTAL to "middle-finger-phalanx-distal",
        HandJointType.MIDDLE_TIP to "middle-finger-tip",
        HandJointType.RING_METACARPAL to "ring-finger-metacarpal",
        HandJointType.RING_PROXIMAL to "ring-finger-phalanx-proximal",
        HandJointType.RING_INTERMEDIATE to "ring-finger-phalanx-intermediate",
        HandJointType.RING_DISTAL to "ring-finger-phalanx-distal",
        HandJointType.RING_TIP to "ring-finger-tip",
        HandJointType.LITTLE_METACARPAL to "pinky-finger-metacarpal",
        HandJointType.LITTLE_PROXIMAL to "pinky-finger-phalanx-proximal",
        HandJointType.LITTLE_INTERMEDIATE to "pinky-finger-phalanx-intermediate",
        HandJointType.LITTLE_DISTAL to "pinky-finger-phalanx-distal",
        HandJointType.LITTLE_TIP to "pinky-finger-tip",
      )

    /**
     * Converts a Jetpack XR [handJoints] map into WebXR joint coordinates in meters. Returns `null`
     * when `!isActive` or no finite joints are present.
     */
    @JvmStatic
    fun toWebXrJoints(
      isActive: Boolean,
      handJoints: Map<HandJointType, Pose>?,
    ): Map<String, DoubleArray>? {
      if (!isActive || handJoints.isNullOrEmpty()) return null
      val out = LinkedHashMap<String, DoubleArray>(JOINT_NAMES.size)
      for ((type, webName) in JOINT_NAMES) {
        val pose = handJoints[type] ?: continue
        val t = pose.translation
        val x = t.x.toDouble()
        val y = t.y.toDouble()
        val z = t.z.toDouble()
        if (!x.isFinite() || !y.isFinite() || !z.isFinite()) continue
        out[webName] = doubleArrayOf(x, y, z)
      }
      return out.ifEmpty { null }
    }

    /** Converts a Jetpack XR [Pose] into an [XRPose] (position + quaternion xyzw), or `null`. */
    @JvmStatic
    fun toXRPose(pose: Pose?): XRPose? {
      if (pose == null) return null
      val t = pose.translation
      val r = pose.rotation
      if (
        !t.x.isFinite() ||
          !t.y.isFinite() ||
          !t.z.isFinite() ||
          !r.x.isFinite() ||
          !r.y.isFinite() ||
          !r.z.isFinite() ||
          !r.w.isFinite()
      ) {
        return null
      }
      return XRPose(
        floatArrayOf(t.x, t.y, t.z),
        floatArrayOf(r.x, r.y, r.z, r.w),
      )
    }
  }
}
