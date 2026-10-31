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

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Camera options using the same strings as the `<three-live>` attributes (`camera-orbit`,
 * `camera-target`, `min-camera-orbit`, `max-camera-orbit`, `field-of-view`, `rotation-per-second`).
 * `null` keeps the default.
 */
data class ThreeLiveCameraOptions(
  val cameraOrbit: String? = null,
  val cameraTarget: String? = null,
  val minCameraOrbit: String? = null,
  val maxCameraOrbit: String? = null,
  val fieldOfView: String? = null,
  val cameraControls: Boolean = true,
  val autoRotate: Boolean = false,
  val autoRotateDelayMs: Long = 3000,
  val rotationPerSecond: String? = null,
  val distanceMode: String? = null,
)

/** The `camera-change` detail: the same fields and rounding as the web viewer. */
data class ThreeLiveCameraChange(
  /** Azimuth in whole degrees, 0..359. */
  val theta: Int,
  /** Elevation in whole degrees. */
  val phi: Int,
  /** `boundsRadius * 2.5 / distance`, rounded to 0.01. */
  val zoom: Double,
  /** Distance to the target in meters, rounded to 0.01. */
  val distance: Double,
) {
  /** The value as a `camera-orbit` string (`"θdeg φdeg rm"`). */
  val orbit: String
    get() = "${theta}deg ${phi}deg ${distance}m"
}

/**
 * Pure orbit-camera model matching the web `ThreeView` camera: azimuth θ and elevation φ around a
 * target, smoothed toward drag / pinch targets, with orbit limits, a turntable auto-rotate that
 * spins the model (not the camera), and change reporting at 1° / 0.02 zoom granularity.
 *
 * Renderers own one instance, feed it input and [step] it every frame, then read [eye] / [target].
 */
class OrbitCameraState {
  /** Scene bounding-sphere center (used when no `camera-target` is set). */
  var boundsCenter: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0)
    private set

  /** Scene bounding-sphere radius (drives default distance and zoom limits). */
  var boundsRadius: Double = 1.0
    private set

  /** Vertical field of view in degrees (10..90). */
  var fieldOfViewDeg: Double = 45.0
    private set

  /**
   * Distance framing mode: `"auto"` / `"relative"` (`2.5 × boundsRadius`) or `"absolute"` (`3.0m`).
   */
  var distanceMode: String = "auto"
    private set

  /** Whether drag / pinch input moves the camera. */
  var interactive: Boolean = true

  /** Current (smoothed) azimuth, elevation and distance. */
  var theta: Double = DEFAULT_THETA
    private set

  var phi: Double = DEFAULT_PHI
    private set

  var distance: Double = DEFAULT_DISTANCE
    private set

  /** Turntable rotation of the model around the vertical axis through [boundsCenter], radians. */
  var turntableRad: Double = 0.0
    private set

  private var targetTheta = DEFAULT_THETA
  private var targetPhi = DEFAULT_PHI
  private var targetDistance = DEFAULT_DISTANCE
  private var customTarget: DoubleArray? = null

  private var minTheta = Double.NEGATIVE_INFINITY
  private var maxTheta = Double.POSITIVE_INFINITY
  private var minPhi = -PHI_LIMIT
  private var maxPhi = PHI_LIMIT
  private var minDistance: Double? = null
  private var maxDistance: Double? = null

  private var autoRotate = false
  private var autoRotateSpeed = PI / 6
  private var autoRotateDelayMs = 3000L
  private var lastInteractionMs = Long.MIN_VALUE / 2

  private var initialTheta: Double? = null
  private var initialPhi: Double? = null
  private var initialDistance: Double? = null

  private var lastTheta = Int.MIN_VALUE
  private var lastPhi = Int.MIN_VALUE
  private var lastZoom = Double.NaN

  /** Applies every option; orbit strings follow the `<three-live>` attribute grammar. */
  fun applyOptions(options: ThreeLiveCameraOptions) {
    interactive = options.cameraControls
    autoRotate = options.autoRotate
    if (!options.autoRotate) {
      turntableRad = 0.0
    }
    autoRotateDelayMs = max(0L, options.autoRotateDelayMs)
    autoRotateSpeed = parseRotationPerSecond(options.rotationPerSecond)
    parseFieldOfView(options.fieldOfView)?.let { fieldOfViewDeg = it.coerceIn(10.0, 90.0) }
    distanceMode =
      options.distanceMode?.trim()?.lowercase()?.takeIf {
        it == "absolute" || it == "relative" || it == "auto"
      } ?: "auto"
    customTarget = parseCameraTarget(options.cameraTarget)
    applyOrbitLimits(options.minCameraOrbit, options.maxCameraOrbit)
    applyCameraOrbit(options.cameraOrbit)
  }

  /**
   * Sets the scene bounds after a model loads and frames it like the web viewer: the initial orbit
   * (if any), `3.0m` when `distanceMode == "absolute"`, or `2.5 × radius`, snapping the smoothed
   * state.
   */
  fun setBounds(center: DoubleArray, radius: Double) {
    if (center.size >= 3 && center.all { it.isFinite() }) {
      boundsCenter = doubleArrayOf(center[0], center[1], center[2])
    }
    boundsRadius = if (radius.isFinite() && radius > 1e-6) radius else 1.0
    targetTheta = clampTheta(initialTheta ?: targetTheta)
    targetPhi = clampPhi(initialPhi ?: targetPhi)
    val defaultDist = if (distanceMode == "absolute") DEFAULT_DISTANCE else boundsRadius * 2.5
    targetDistance = clampDistance(initialDistance ?: defaultDist)
    snap()
  }

  /** Jumps the smoothed state to the targets (no easing). */
  fun snap() {
    theta = targetTheta
    phi = targetPhi
    distance = targetDistance
  }

  /** Orbit drag by a pointer delta in pixels (0.008 rad / px, as on web). */
  fun drag(dxPx: Double, dyPx: Double, nowMs: Long) {
    if (!interactive || !dxPx.isFinite() || !dyPx.isFinite()) return
    lastInteractionMs = nowMs
    targetTheta = clampTheta(targetTheta - dxPx * DRAG_RAD_PER_PX)
    targetPhi = clampPhi(targetPhi + dyPx * DRAG_RAD_PER_PX)
  }

  /** Pinch zoom: a [scaleFactor] above 1 (fingers apart) moves the camera closer. */
  fun pinch(scaleFactor: Double, nowMs: Long) {
    if (!interactive || !scaleFactor.isFinite() || scaleFactor <= 0.0) return
    lastInteractionMs = nowMs
    targetDistance = clampDistance(targetDistance / scaleFactor)
  }

  /** Marks user interaction (e.g. a tap) so auto-rotate pauses for its delay. */
  fun touch(nowMs: Long) {
    lastInteractionMs = nowMs
  }

  /**
   * Advances smoothing by [dtSeconds] (the web eases 12% per 60 Hz frame) and auto-rotate. Returns
   * a change to report, or `null` when the reported values did not move.
   */
  fun step(dtSeconds: Double, nowMs: Long, pointerDown: Boolean = false): ThreeLiveCameraChange? {
    val dt = if (dtSeconds.isFinite()) dtSeconds.coerceIn(0.0, 0.25) else 0.0
    if (autoRotate && !pointerDown && nowMs - lastInteractionMs >= autoRotateDelayMs) {
      turntableRad = (turntableRad + autoRotateSpeed * dt) % (2 * PI)
    }
    val k = 1.0 - (1.0 - EASE_PER_FRAME).pow(dt * 60.0)
    theta += (targetTheta - theta) * k
    phi += (targetPhi - phi) * k
    distance += (targetDistance - distance) * k
    return pollChange()
  }

  /** Returns the current reported values if they moved by ≥ 1° or ≥ 0.02 zoom since last time. */
  fun pollChange(): ThreeLiveCameraChange? {
    val thetaDeg = ((Math.toDegrees(theta) % 360 + 360) % 360).roundToInt() % 360
    val phiDeg = Math.toDegrees(phi).roundToInt()
    val zoom = ((boundsRadius * 2.5 / distance) * 100).roundToInt() / 100.0
    val moved =
      lastTheta == Int.MIN_VALUE ||
        abs(thetaDeg - lastTheta) >= 1 ||
        abs(phiDeg - lastPhi) >= 1 ||
        !(abs(zoom - lastZoom) < 0.02)
    if (!moved) return null
    lastTheta = thetaDeg
    lastPhi = phiDeg
    lastZoom = zoom
    return ThreeLiveCameraChange(thetaDeg, phiDeg, zoom, (distance * 100).roundToInt() / 100.0)
  }

  /** The orbit target: `camera-target` if set, else the bounds center. */
  fun target(out: DoubleArray = DoubleArray(3)): DoubleArray {
    val c = customTarget ?: boundsCenter
    out[0] = c[0]
    out[1] = c[1]
    out[2] = c[2]
    return out
  }

  /** Eye position: `target + distance × (cosφ sinθ, sinφ, cosφ cosθ)`. */
  fun eye(out: DoubleArray = DoubleArray(3)): DoubleArray {
    target(out)
    out[0] += distance * cos(phi) * sin(theta)
    out[1] += distance * sin(phi)
    out[2] += distance * cos(phi) * cos(theta)
    return out
  }

  /**
   * World-space ray from the eye through normalized device coordinates ([ndcX], [ndcY] in -1..1, +Y
   * up) for a viewport of the given [aspect] (width / height). Writes [origin] and unit [dir].
   */
  fun viewportRay(
    ndcX: Double,
    ndcY: Double,
    aspect: Double,
    origin: DoubleArray,
    dir: DoubleArray,
  ) {
    eye(origin)
    val t = target()
    var fx = t[0] - origin[0]
    var fy = t[1] - origin[1]
    var fz = t[2] - origin[2]
    val fl = Math.sqrt(fx * fx + fy * fy + fz * fz).takeIf { it > 1e-12 } ?: 1.0
    fx /= fl
    fy /= fl
    fz /= fl
    // right = forward × worldUp(0,1,0); up = right × forward.
    var rx = -fz
    var rz = fx
    val rl = Math.sqrt(rx * rx + rz * rz).takeIf { it > 1e-12 } ?: 1.0
    rx /= rl
    rz /= rl
    val ux = -rz * fy
    val uy = rz * fx - rx * fz
    val uz = rx * fy
    val tanHalf = Math.tan(Math.toRadians(fieldOfViewDeg) / 2)
    val a = if (aspect.isFinite() && aspect > 0) aspect else 1.0
    val sx = ndcX * tanHalf * a
    val sy = ndcY * tanHalf
    var dx = fx + rx * sx + ux * sy
    var dy = fy + uy * sy
    var dz = fz + rz * sx + uz * sy
    val dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
    dx /= dl
    dy /= dl
    dz /= dl
    dir[0] = dx
    dir[1] = dy
    dir[2] = dz
  }

  /** Column-major model matrix of the turntable (rotation about +Y through [boundsCenter]). */
  fun turntableMatrix(out: FloatArray = FloatArray(16)): FloatArray {
    val c = cos(turntableRad)
    val s = sin(turntableRad)
    val cx = boundsCenter[0]
    val cz = boundsCenter[2]
    out.fill(0f)
    out[0] = c.toFloat()
    out[2] = (-s).toFloat()
    out[5] = 1f
    out[8] = s.toFloat()
    out[10] = c.toFloat()
    out[12] = (cx - (c * cx + s * cz)).toFloat()
    out[14] = (cz - (-s * cx + c * cz)).toFloat()
    out[15] = 1f
    return out
  }

  private fun applyCameraOrbit(orbit: String?) {
    val parts = orbit?.trim()?.split(WHITESPACE)?.filter { it.isNotEmpty() } ?: return
    if (parts.size < 2) return
    val t = parseAngleDeg(parts[0])
    val p = parseAngleDeg(parts[1])
    val d = parts.getOrNull(2)?.let { parseMeters(it) }?.takeIf { it > 0 }
    if (t == null && p == null) return
    initialTheta = t?.let { Math.toRadians(it) }
    initialPhi = p?.let { Math.toRadians(it) }
    initialDistance = d
    initialTheta?.let { targetTheta = clampTheta(it) }
    initialPhi?.let { targetPhi = clampPhi(it) }
    initialDistance?.let { targetDistance = clampDistance(it) }
  }

  private fun applyOrbitLimits(minOrbit: String?, maxOrbit: String?) {
    val lo = parseOrbitLimit(minOrbit)
    val hi = parseOrbitLimit(maxOrbit)
    minTheta = lo[0]?.let { Math.toRadians(it) } ?: Double.NEGATIVE_INFINITY
    maxTheta = hi[0]?.let { Math.toRadians(it) } ?: Double.POSITIVE_INFINITY
    minPhi = lo[1]?.let { max(-PHI_LIMIT, Math.toRadians(it)) } ?: -PHI_LIMIT
    maxPhi = hi[1]?.let { min(PHI_LIMIT, Math.toRadians(it)) } ?: PHI_LIMIT
    minDistance = lo[2]
    maxDistance = hi[2]
    targetTheta = clampTheta(targetTheta)
    targetPhi = clampPhi(targetPhi)
    targetDistance = clampDistance(targetDistance)
  }

  private fun clampTheta(v: Double): Double = max(minTheta, min(maxTheta, v))

  private fun clampPhi(v: Double): Double = max(minPhi, min(maxPhi, v))

  private fun clampDistance(v: Double): Double {
    val lo = minDistance ?: (boundsRadius * 0.5)
    val hi = maxDistance ?: (boundsRadius * 8.0)
    return max(lo, min(hi, v))
  }

  companion object {
    private const val DEFAULT_THETA = 0.6
    private const val DEFAULT_PHI = 0.35
    private const val DEFAULT_DISTANCE = 3.0
    private const val PHI_LIMIT = PI * 0.48
    private const val DRAG_RAD_PER_PX = 0.008
    private const val EASE_PER_FRAME = 0.12
    private val WHITESPACE = Regex("\\s+")

    /** Parses `"30deg"`, `"0.5rad"` or a bare number (degrees); `auto` / invalid → `null`. */
    @JvmStatic
    fun parseAngleDeg(s: String): Double? {
      if (s == "auto") return null
      val v =
        if (s.endsWith("rad")) {
          s.removeSuffix("rad").toDoubleOrNull()?.let { Math.toDegrees(it) }
        } else {
          s.removeSuffix("deg").toDoubleOrNull()
        }
      return v?.takeIf { it.isFinite() }
    }

    /** Parses `"2.5m"` or a bare number; invalid → `null`. */
    @JvmStatic
    fun parseMeters(s: String): Double? =
      s.removeSuffix("m").toDoubleOrNull()?.takeIf { it.isFinite() }

    /** Parses a `min/max-camera-orbit` string into (θ°, φ°, meters), each nullable. */
    @JvmStatic
    fun parseOrbitLimit(s: String?): Array<Double?> {
      val out = arrayOfNulls<Double>(3)
      val parts = s?.trim()?.split(WHITESPACE)?.filter { it.isNotEmpty() } ?: return out
      parts.getOrNull(0)?.let { out[0] = parseAngleDeg(it) }
      parts.getOrNull(1)?.let { out[1] = parseAngleDeg(it) }
      parts.getOrNull(2)?.let { if (it != "auto") out[2] = parseMeters(it) }
      return out
    }

    /** Parses `camera-target` (`"x y z"` with optional `m` suffixes). */
    @JvmStatic
    fun parseCameraTarget(s: String?): DoubleArray? {
      val parts = s?.trim()?.split(WHITESPACE)?.filter { it.isNotEmpty() } ?: return null
      if (parts.size < 3) return null
      val v = parts.take(3).map { parseMeters(it) ?: return null }
      return doubleArrayOf(v[0], v[1], v[2])
    }

    /** Parses `field-of-view` (`"45deg"`, `"0.8rad"`, `"45"`). */
    @JvmStatic fun parseFieldOfView(s: String?): Double? = s?.trim()?.let { parseAngleDeg(it) }

    /** Parses `rotation-per-second` (`"30deg"`, `"0.5rad"`, `"10%"`); default π/6 rad/s. */
    @JvmStatic
    fun parseRotationPerSecond(s: String?): Double {
      val t = s?.trim() ?: return PI / 6
      val num = NUMBER_PREFIX.find(t)?.value?.toDoubleOrNull() ?: return PI / 6
      if (!num.isFinite()) return PI / 6
      return when {
        t.endsWith("rad") -> num
        t.endsWith("%") -> num / 100 * 2 * PI
        else -> Math.toRadians(num)
      }
    }

    private val NUMBER_PREFIX = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")
  }
}
