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

/** Canonical spatial hand gestures (`XRHandGestureName` on web). */
enum class XRHandGesture(val wireName: String) {
  PINCH("pinch"),
  POINT("point"),
  FIST("fist"),
  OPEN_PALM("open-palm"),
  THUMBS_UP("thumbs-up"),
  SPREAD("spread"),
  NONE("none"),
}

/** Per-finger curl in `[0, 1]` (0 = straight, 1 = fully folded). */
data class XRFingerCurls(
  val thumb: Double,
  val index: Double,
  val middle: Double,
  val ring: Double,
  val pinky: Double,
)

/** One classification. */
data class XRGestureResult(val gesture: XRHandGesture, val confidence: Double, val curls: XRFingerCurls)

/** A gesture change for one hand (the web `xr-gesture` detail): [hand] is `"left"` / `"right"`. */
data class XRHandGestureEvent(val hand: String, val gesture: XRHandGesture, val confidence: Double, val curls: XRFingerCurls)

/**
 * Port of `classifyHandJoints()` from `xr-live/src/xr-gestures.ts`: identical joint fallbacks,
 * thresholds and outputs, for hosts with hand tracking (e.g. Android XR). Joint names are WebXR
 * `XRHand` names (`"wrist"`, `"index-finger-tip"`, ...) mapped to xyz positions in meters.
 */
object XRHandGestures {
  /** Classifies one hand pose. */
  @JvmStatic
  fun classify(joints: Map<String, DoubleArray>): XRGestureResult {
    val wrist = joints["wrist"]?.takeIf { it.size >= 3 } ?: doubleArrayOf(0.0, 0.0, 0.0)
    fun joint(vararg names: String): DoubleArray {
      for (n in names) joints[n]?.takeIf { it.size >= 3 }?.let { return it }
      return wrist
    }
    val thumbProx = joint("thumb-phalanx-proximal", "thumb-metacarpal")
    val thumbTip = joint("thumb-tip")
    val indexProx = joint("index-finger-phalanx-proximal", "index-finger-metacarpal")
    val indexTip = joint("index-finger-tip")
    val middleProx = joint("middle-finger-phalanx-proximal", "middle-finger-metacarpal")
    val middleTip = joint("middle-finger-tip")
    val ringProx = joint("ring-finger-phalanx-proximal", "ring-finger-metacarpal")
    val ringTip = joint("ring-finger-tip")
    val pinkyProx = joint("pinky-finger-phalanx-proximal", "pinky-finger-metacarpal")
    val pinkyTip = joint("pinky-finger-tip")

    val curls =
      XRFingerCurls(
        curl(wrist, thumbProx, thumbTip),
        curl(wrist, indexProx, indexTip),
        curl(wrist, middleProx, middleTip),
        curl(wrist, ringProx, ringTip),
        curl(wrist, pinkyProx, pinkyTip),
      )

    val thumbVecY = thumbTip[1] - thumbProx[1]
    val thumbLen = orOne(dist(thumbTip, thumbProx))
    if (
      curls.thumb < 0.3 &&
        thumbVecY / thumbLen > 0.7 &&
        curls.index > 0.6 &&
        curls.middle > 0.6 &&
        curls.ring > 0.6 &&
        curls.pinky > 0.6
    ) {
      return XRGestureResult(XRHandGesture.THUMBS_UP, 0.95, curls)
    }
    if (curls.thumb > 0.5 && curls.index > 0.65 && curls.middle > 0.65 && curls.ring > 0.65 && curls.pinky > 0.65) {
      return XRGestureResult(XRHandGesture.FIST, 0.92, curls)
    }
    val pinchDist = dist(thumbTip, indexTip)
    if (pinchDist > 0 && pinchDist < 0.018) {
      return XRGestureResult(XRHandGesture.PINCH, minOf(1.0, (0.022 - pinchDist) / 0.015), curls)
    }
    if (curls.index < 0.25 && curls.middle > 0.6 && curls.ring > 0.6 && curls.pinky > 0.6) {
      return XRGestureResult(XRHandGesture.POINT, 0.94, curls)
    }
    if (curls.thumb < 0.3 && curls.index < 0.25 && curls.middle < 0.25 && curls.ring < 0.25 && curls.pinky < 0.25) {
      val spread = (dist(indexTip, middleTip) + dist(middleTip, ringTip) + dist(ringTip, pinkyTip)) / 3
      return if (spread > 0.042) {
        XRGestureResult(XRHandGesture.SPREAD, 0.91, curls)
      } else {
        XRGestureResult(XRHandGesture.OPEN_PALM, 0.93, curls)
      }
    }
    return XRGestureResult(XRHandGesture.NONE, 0.0, curls)
  }

  private fun curl(wrist: DoubleArray, proximal: DoubleArray, tip: DoubleArray): Double {
    val ux = proximal[0] - wrist[0]
    val uy = proximal[1] - wrist[1]
    val uz = proximal[2] - wrist[2]
    val vx = tip[0] - proximal[0]
    val vy = tip[1] - proximal[1]
    val vz = tip[2] - proximal[2]
    val dot = (ux * vx + uy * vy + uz * vz) / (orOne(Math.sqrt(ux * ux + uy * uy + uz * uz)) * orOne(Math.sqrt(vx * vx + vy * vy + vz * vz)))
    return ((1 - dot) * 0.5).coerceIn(0.0, 1.0).let { if (it.isNaN()) 0.0 else it }
  }

  private fun dist(a: DoubleArray, b: DoubleArray): Double {
    val dx = a[0] - b[0]
    val dy = a[1] - b[1]
    val dz = a[2] - b[2]
    return Math.sqrt(dx * dx + dy * dy + dz * dz)
  }

  /** `Math.hypot(...) || 1`: zero and NaN become 1. */
  private fun orOne(v: Double): Double = if (v == 0.0 || v.isNaN()) 1.0 else v
}

/** Per-hand change filter: reports a gesture only when it changes; `NONE` re-arms (same as web). */
class XRHandGestureTracker {
  private val last = HashMap<String, XRHandGesture>()

  /** Classifies [joints] for [hand] (`"left"` / `"right"`), returning an event only on change. */
  fun update(hand: String, joints: Map<String, DoubleArray>): XRHandGestureEvent? {
    val r = XRHandGestures.classify(joints)
    if (r.gesture == XRHandGesture.NONE) {
      last[hand] = XRHandGesture.NONE
      return null
    }
    if (last[hand] == r.gesture) return null
    last[hand] = r.gesture
    return XRHandGestureEvent(hand, r.gesture, r.confidence, r.curls)
  }

  /** Forgets [hand]'s last gesture (e.g. tracking lost). */
  fun reset(hand: String) {
    last[hand] = XRHandGesture.NONE
  }
}

/** Batch 2D → 3D detection unprojection for `onObjectDetected` (renderer- and sensor-agnostic). */
object ThreeLiveDetections {
  /** Maximum detections processed per call. */
  const val MAX_DETECTIONS: Int = 32

  /** One 2D detection: [box] is `[ymin, xmin, ymax, xmax]` normalized 0..1 or 0..1000. */
  class Box(val box: DoubleArray, val label: String = "")

  /** Maximum size of a `detections` JSON string, in characters (same as web). */
  const val MAX_DETECTIONS_JSON_CHARS: Int = 16 * 1024

  /**
   * Parses a `detections` JSON string (`[{label, box: [ymin, xmin, ymax, xmax]}]`, 0–1 or Gemini
   * 0–1000; `box_2d` is accepted as an alias) into at most [MAX_DETECTIONS] boxes. Malformed entries
   * are skipped; malformed or oversized input yields an empty list. Mirrors web `parseDetections`.
   */
  @JvmStatic
  fun parse(json: String?): List<Box> {
    if (json.isNullOrEmpty() || json.length > MAX_DETECTIONS_JSON_CHARS) return emptyList()
    val root = MiniJson.parseOrNull(json, maxDepth = 8, maxChars = MAX_DETECTIONS_JSON_CHARS) as? List<*>
      ?: return emptyList()
    val out = ArrayList<Box>()
    for (item in root) {
      if (out.size >= MAX_DETECTIONS) break
      val rec = item as? Map<*, *> ?: continue
      val box = (rec["box"] as? List<*>) ?: (rec["box_2d"] as? List<*>) ?: continue
      if (box.size < 4) continue
      val nums = DoubleArray(4)
      var ok = true
      for (i in 0 until 4) {
        val v = (box[i] as? Number)?.toDouble()
        if (v == null || !v.isFinite()) {
          ok = false
          break
        }
        nums[i] = v
      }
      if (!ok) continue
      out.add(Box(nums, (rec["label"] as? String)?.take(256) ?: ""))
    }
    return out
  }

  /**
   * Unprojects up to [MAX_DETECTIONS] boxes with the camera's column-major [cameraWorld] and
   * [proj] matrices. [depthAt] optionally samples view-space depth (meters) at normalized (u, v);
   * otherwise [planes] are ray-tested, then [WorldUnderstanding.FALLBACK_DEPTH_METERS] (same as web).
   */
  @JvmStatic
  @JvmOverloads
  fun detect(
    boxes: List<Box>,
    cameraWorld: FloatArray,
    proj: FloatArray,
    depthAt: ((u: Double, v: Double) -> Double?)? = null,
    planes: List<WorldUnderstanding.TrackedPlane> = emptyList(),
  ): List<WorldUnderstanding.Detection3D> {
    if (cameraWorld.size < 16 || proj.size < 16) return emptyList()
    val out = ArrayList<WorldUnderstanding.Detection3D>()
    for (b in boxes.take(MAX_DETECTIONS)) {
      val center = WorldUnderstanding.boxCenter(b.box) ?: continue
      val depth = depthAt?.invoke(center[0], center[1])
      WorldUnderstanding.unprojectDetection(b.box, cameraWorld, proj, depth, planes, b.label.take(256))?.let { out.add(it) }
    }
    return out
  }
}
