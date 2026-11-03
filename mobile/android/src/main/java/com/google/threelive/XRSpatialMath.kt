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

/**
 * A 6-DoF pose: [position] (x, y, z in meters) and unit [quaternion] (x, y, z, w).
 *
 * Arrays are compared by content.
 */
data class XRPose(
  val position: FloatArray = floatArrayOf(0f, 0f, 0f),
  val quaternion: FloatArray = floatArrayOf(0f, 0f, 0f, 1f),
) {
  override fun equals(other: Any?): Boolean =
    other is XRPose &&
      position.contentEquals(other.position) &&
      quaternion.contentEquals(other.quaternion)

  override fun hashCode(): Int = 31 * position.contentHashCode() + quaternion.contentHashCode()

  override fun toString(): String =
    "XRPose(position=${position.contentToString()}, quaternion=${quaternion.contentToString()})"

  companion object {
    /** Returns a pose at ([x], [y], [z]) rotated [yawRad] radians about +Y. */
    @JvmStatic
    @JvmOverloads
    fun atYaw(x: Float, y: Float, z: Float, yawRad: Double = 0.0): XRPose =
      XRPose(
        floatArrayOf(x, y, z),
        floatArrayOf(0f, Math.sin(yawRad / 2).toFloat(), 0f, Math.cos(yawRad / 2).toFloat()),
      )
  }
}

/**
 * Pure math shared by the spatial runtime helpers. Mirrors `xr-live/src/plugins/common.ts` and
 * `head-follow.ts`. Matrices are column-major `FloatArray(16)` (glTF / WebGL convention).
 */
object XRSpatialMath {

  /** Clamps [v] into `[lo, hi]`, mapping non-finite values to [fallback]. */
  @JvmStatic
  fun clampNum(v: Double, lo: Double, hi: Double, fallback: Double): Double {
    val n = if (v.isFinite()) v else fallback
    return Math.max(lo, Math.min(hi, n))
  }

  /** Returns the yaw (rotation about +Y, radians) of quaternion `(x, y, z, w)`. */
  @JvmStatic
  fun yawFromQuat(x: Double, y: Double, z: Double, w: Double): Double =
    Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + x * x))

  /** Writes the horizontal (XZ-plane) forward vector of quaternion [q] into [out]. */
  @JvmStatic
  @JvmOverloads
  fun horizontalForward(q: FloatArray, out: DoubleArray = DoubleArray(3)): DoubleArray {
    val yaw = yawFromQuat(q[0].toDouble(), q[1].toDouble(), q[2].toDouble(), q[3].toDouble())
    out[0] = -Math.sin(yaw)
    out[1] = 0.0
    out[2] = -Math.cos(yaw)
    return out
  }

  /** Writes a quaternion rotating [angle] radians about +Y into [out]. */
  @JvmStatic
  @JvmOverloads
  fun quatFromYaw(angle: Double, out: DoubleArray = DoubleArray(4)): DoubleArray {
    out[0] = 0.0
    out[1] = Math.sin(angle * 0.5)
    out[2] = 0.0
    out[3] = Math.cos(angle * 0.5)
    return out
  }

  /** Returns the Hamilton product `a * b`. */
  @JvmStatic
  @JvmOverloads
  fun quatMultiply(a: DoubleArray, b: DoubleArray, out: DoubleArray = DoubleArray(4)): DoubleArray {
    val ax = a[0]
    val ay = a[1]
    val az = a[2]
    val aw = a[3]
    val bx = b[0]
    val by = b[1]
    val bz = b[2]
    val bw = b[3]
    out[0] = aw * bx + ax * bw + ay * bz - az * by
    out[1] = aw * by - ax * bz + ay * bw + az * bx
    out[2] = aw * bz + ax * by - ay * bx + az * bw
    out[3] = aw * bw - ax * bx - ay * by - az * bz
    return out
  }

  /**
   * Spherical linear interpolation, identical to `quatSlerp()` in `three-live/src/plugins/
   * keyframes.ts` (including its shortest-path flip and near-parallel midpoint fallback).
   */
  @JvmStatic
  fun quatSlerp(out: DoubleArray, a: DoubleArray, b: DoubleArray, t: Double): DoubleArray {
    val ax = a[0]
    val ay = a[1]
    val az = a[2]
    val aw = a[3]
    var bx = b[0]
    var by = b[1]
    var bz = b[2]
    var bw = b[3]
    var cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw
    if (cosHalfTheta < 0) {
      bx = -bx
      by = -by
      bz = -bz
      bw = -bw
      cosHalfTheta = -cosHalfTheta
    }
    if (Math.abs(cosHalfTheta) >= 1.0) {
      out[0] = ax
      out[1] = ay
      out[2] = az
      out[3] = aw
      return out
    }
    val halfTheta = Math.acos(cosHalfTheta)
    val sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta)
    if (Math.abs(sinHalfTheta) < 0.001) {
      out[0] = 0.5 * (ax + bx)
      out[1] = 0.5 * (ay + by)
      out[2] = 0.5 * (az + bz)
      out[3] = 0.5 * (aw + bw)
      return out
    }
    val ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta
    val ratioB = Math.sin(t * halfTheta) / sinHalfTheta
    out[0] = ax * ratioA + bx * ratioB
    out[1] = ay * ratioA + by * ratioB
    out[2] = az * ratioA + bz * ratioB
    out[3] = aw * ratioA + bw * ratioB
    return out
  }

  /** Composes a column-major TRS matrix into [out]. */
  @JvmStatic
  @JvmOverloads
  fun mat4FromTRS(
    t: DoubleArray,
    q: DoubleArray,
    s: DoubleArray,
    out: DoubleArray = DoubleArray(16),
  ): DoubleArray {
    val x = q[0]
    val y = q[1]
    val z = q[2]
    val w = q[3]
    val x2 = x + x
    val y2 = y + y
    val z2 = z + z
    val xx = x * x2
    val xy = x * y2
    val xz = x * z2
    val yy = y * y2
    val yz = y * z2
    val zz = z * z2
    val wx = w * x2
    val wy = w * y2
    val wz = w * z2
    out[0] = (1 - (yy + zz)) * s[0]
    out[1] = (xy + wz) * s[0]
    out[2] = (xz - wy) * s[0]
    out[3] = 0.0
    out[4] = (xy - wz) * s[1]
    out[5] = (1 - (xx + zz)) * s[1]
    out[6] = (yz + wx) * s[1]
    out[7] = 0.0
    out[8] = (xz + wy) * s[2]
    out[9] = (yz - wx) * s[2]
    out[10] = (1 - (xx + yy)) * s[2]
    out[11] = 0.0
    out[12] = t[0]
    out[13] = t[1]
    out[14] = t[2]
    out[15] = 1.0
    return out
  }

  /** Multiplies column-major `a * b` into [out] ([out] may alias neither input). */
  @JvmStatic
  fun mat4Multiply(a: DoubleArray, b: DoubleArray, out: DoubleArray): DoubleArray {
    for (c in 0 until 4) {
      for (r in 0 until 4) {
        out[c * 4 + r] =
          a[r] * b[c * 4] +
            a[4 + r] * b[c * 4 + 1] +
            a[8 + r] * b[c * 4 + 2] +
            a[12 + r] * b[c * 4 + 3]
      }
    }
    return out
  }

  /** Inverts column-major [m] into [out]; returns `false` (leaving [out] untouched) if singular. */
  @JvmStatic
  fun mat4Invert(m: DoubleArray, out: DoubleArray): Boolean {
    val a00 = m[0]
    val a01 = m[1]
    val a02 = m[2]
    val a03 = m[3]
    val a10 = m[4]
    val a11 = m[5]
    val a12 = m[6]
    val a13 = m[7]
    val a20 = m[8]
    val a21 = m[9]
    val a22 = m[10]
    val a23 = m[11]
    val a30 = m[12]
    val a31 = m[13]
    val a32 = m[14]
    val a33 = m[15]
    val b00 = a00 * a11 - a01 * a10
    val b01 = a00 * a12 - a02 * a10
    val b02 = a00 * a13 - a03 * a10
    val b03 = a01 * a12 - a02 * a11
    val b04 = a01 * a13 - a03 * a11
    val b05 = a02 * a13 - a03 * a12
    val b06 = a20 * a31 - a21 * a30
    val b07 = a20 * a32 - a22 * a30
    val b08 = a20 * a33 - a23 * a30
    val b09 = a21 * a32 - a22 * a31
    val b10 = a21 * a33 - a23 * a31
    val b11 = a22 * a33 - a23 * a32
    val det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
    if (!det.isFinite() || Math.abs(det) < 1e-20) return false
    val inv = 1.0 / det
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv
    out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv
    out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv
    out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv
    out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv
    out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv
    out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv
    out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv
    out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv
    return true
  }

  /** Transforms point ([x], [y], [z]) by column-major [m] (affine, `w = 1`) into [out]. */
  @JvmStatic
  fun transformPoint(
    m: DoubleArray,
    x: Double,
    y: Double,
    z: Double,
    out: DoubleArray,
  ): DoubleArray {
    val ox = m[0] * x + m[4] * y + m[8] * z + m[12]
    val oy = m[1] * x + m[5] * y + m[9] * z + m[13]
    val oz = m[2] * x + m[6] * y + m[10] * z + m[14]
    out[0] = ox
    out[1] = oy
    out[2] = oz
    return out
  }

  /** [transformPoint] for a `FloatArray` matrix. */
  @JvmStatic
  fun transformPoint(
    m: FloatArray,
    x: Double,
    y: Double,
    z: Double,
    out: DoubleArray,
  ): DoubleArray {
    val ox = m[0] * x + m[4] * y + m[8] * z + m[12]
    val oy = m[1] * x + m[5] * y + m[9] * z + m[13]
    val oz = m[2] * x + m[6] * y + m[10] * z + m[14]
    out[0] = ox
    out[1] = oy
    out[2] = oz
    return out
  }

  /** Extracts the per-axis scale of column-major [m]. */
  @JvmStatic
  fun extractScale(m: DoubleArray, out: DoubleArray = DoubleArray(3)): DoubleArray {
    out[0] = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2])
    out[1] = Math.sqrt(m[4] * m[4] + m[5] * m[5] + m[6] * m[6])
    out[2] = Math.sqrt(m[8] * m[8] + m[9] * m[9] + m[10] * m[10])
    return out
  }

  /** Extracts the rotation of column-major [m] (scale removed) as a unit quaternion. */
  @JvmStatic
  fun extractQuaternion(m: DoubleArray, out: DoubleArray = DoubleArray(4)): DoubleArray {
    val s = extractScale(m)
    val sx = if (s[0] > 1e-12) s[0] else 1.0
    val sy = if (s[1] > 1e-12) s[1] else 1.0
    val sz = if (s[2] > 1e-12) s[2] else 1.0
    val m00 = m[0] / sx
    val m01 = m[4] / sy
    val m02 = m[8] / sz
    val m10 = m[1] / sx
    val m11 = m[5] / sy
    val m12 = m[9] / sz
    val m20 = m[2] / sx
    val m21 = m[6] / sy
    val m22 = m[10] / sz
    val trace = m00 + m11 + m22
    if (trace > 0) {
      val k = 0.5 / Math.sqrt(trace + 1.0)
      out[3] = 0.25 / k
      out[0] = (m21 - m12) * k
      out[1] = (m02 - m20) * k
      out[2] = (m10 - m01) * k
    } else if (m00 > m11 && m00 > m22) {
      val k = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22)
      out[3] = (m21 - m12) / k
      out[0] = 0.25 * k
      out[1] = (m01 + m10) / k
      out[2] = (m02 + m20) / k
    } else if (m11 > m22) {
      val k = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22)
      out[3] = (m02 - m20) / k
      out[0] = (m01 + m10) / k
      out[1] = 0.25 * k
      out[2] = (m12 + m21) / k
    } else {
      val k = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11)
      out[3] = (m10 - m01) / k
      out[0] = (m02 + m20) / k
      out[1] = (m12 + m21) / k
      out[2] = 0.25 * k
    }
    val l = Math.sqrt(out[0] * out[0] + out[1] * out[1] + out[2] * out[2] + out[3] * out[3])
    if (l > 1e-12) for (i in 0 until 4) out[i] /= l else quatIdentity(out)
    return out
  }

  private fun quatIdentity(out: DoubleArray) {
    out[0] = 0.0
    out[1] = 0.0
    out[2] = 0.0
    out[3] = 1.0
  }

  /** Returns [v] normalized as a new array, or `null` when zero length or non-finite. */
  @JvmStatic
  fun normalizeRayDir(v: DoubleArray): DoubleArray? {
    val l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if (!l.isFinite() || l < 1e-8) return null
    return doubleArrayOf(v[0] / l, v[1] / l, v[2] / l)
  }

  internal fun len3(x: Double, y: Double, z: Double): Double = Math.sqrt(x * x + y * y + z * z)

  internal fun dist3(a: DoubleArray, b: DoubleArray): Double =
    len3(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  internal fun dot3(a: DoubleArray, b: DoubleArray): Double =
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  internal fun cross3(
    a: DoubleArray,
    b: DoubleArray,
    out: DoubleArray = DoubleArray(3),
  ): DoubleArray {
    val cx = a[1] * b[2] - a[2] * b[1]
    val cy = a[2] * b[0] - a[0] * b[2]
    val cz = a[0] * b[1] - a[1] * b[0]
    out[0] = cx
    out[1] = cy
    out[2] = cz
    return out
  }
}

/** Per-axis state of a critically damped spring (mutable, allocation-free stepping). */
class SpringState(
  val position: DoubleArray = DoubleArray(3),
  val velocity: DoubleArray = DoubleArray(3),
)

/** Lazy-follow and orbit math (port of `xr-live/src/plugins/head-follow.ts`). */
object XRFollowMath {

  /**
   * Advances a critically damped spring toward [target] by [dt] seconds with angular frequency
   * [omega], using the exact closed-form solution so the step is unconditionally stable.
   */
  @JvmStatic
  fun stepCriticallyDampedSpring(
    state: SpringState,
    target: DoubleArray,
    omega: Double,
    dt: Double,
  ) {
    val decay = Math.exp(-omega * dt)
    for (a in 0 until 3) {
      val delta = state.position[a] - target[a]
      val temp = (state.velocity[a] + omega * delta) * dt
      state.velocity[a] = (state.velocity[a] - omega * temp) * decay
      state.position[a] = target[a] + (delta + temp) * decay
    }
  }

  /** Computes the desired world position for a lazy follower into [out]. */
  @JvmStatic
  @JvmOverloads
  fun computeFollowTarget(
    anchor: XRPose,
    options: XRLazyFollowOptions,
    out: DoubleArray = DoubleArray(3),
  ): DoubleArray {
    val p = anchor.position
    if (options.mode != "head") {
      out[0] = p[0].toDouble()
      out[1] = p[1] + options.height
      out[2] = p[2].toDouble()
      return out
    }
    val yaw =
      XRSpatialMath.yawFromQuat(
        anchor.quaternion[0].toDouble(),
        anchor.quaternion[1].toDouble(),
        anchor.quaternion[2].toDouble(),
        anchor.quaternion[3].toDouble(),
      )
    out[0] = p[0] + -Math.sin(yaw) * options.distance
    out[1] = p[1] + options.height
    out[2] = p[2] + -Math.cos(yaw) * options.distance
    return out
  }

  /**
   * Returns the horizontal angle (degrees) between the anchor's forward vector and the direction
   * from the anchor to [point].
   */
  @JvmStatic
  fun angleFromForwardDeg(anchor: XRPose, point: DoubleArray): Double {
    val yaw =
      XRSpatialMath.yawFromQuat(
        anchor.quaternion[0].toDouble(),
        anchor.quaternion[1].toDouble(),
        anchor.quaternion[2].toDouble(),
        anchor.quaternion[3].toDouble(),
      )
    val fx = -Math.sin(yaw)
    val fz = -Math.cos(yaw)
    val tx = point[0] - anchor.position[0]
    val tz = point[2] - anchor.position[2]
    val l = Math.sqrt(tx * tx + tz * tz)
    if (l < 1e-5) return 0.0
    val d = (fx * tx + fz * tz) / l
    return Math.acos(Math.max(-1.0, Math.min(1.0, d))) * 180 / Math.PI
  }

  /** Computes the orbit position at accumulated time [t] seconds into [out]. */
  @JvmStatic
  @JvmOverloads
  fun computeOrbitPosition(
    center: DoubleArray,
    options: XROrbitTrait,
    t: Double,
    out: DoubleArray = DoubleArray(3),
  ): DoubleArray {
    val theta = options.phase + options.speed * t
    out[0] = center[0] + Math.cos(theta) * options.radius
    out[1] = center[1] + options.height
    out[2] = center[2] + Math.sin(theta) * options.radius
    return out
  }

  /** Writes the +Y yaw quaternion that turns +Z from [from] toward [to] into [out]. */
  @JvmStatic
  @JvmOverloads
  fun yawTowards(
    from: DoubleArray,
    to: DoubleArray,
    out: DoubleArray = DoubleArray(4),
  ): DoubleArray = XRSpatialMath.quatFromYaw(Math.atan2(to[0] - from[0], to[2] - from[2]), out)

  /**
   * Writes the billboard (`TurnToFace`) quaternion for `"capsule"`, `"cylindrical"`, or
   * `"spherical"` billboarding from [from] toward [to] into [out] (port of
   * `computeBillboardQuaternion` in `xr-live/src/xr-traits.ts`).
   */
  @JvmStatic
  @JvmOverloads
  fun billboardTowards(
    from: DoubleArray,
    to: DoubleArray,
    mode: String,
    out: DoubleArray = DoubleArray(4),
  ): DoubleArray {
    val dx = to[0] - from[0]
    val dy = to[1] - from[1]
    val dz = to[2] - from[2]
    val horizDist = Math.sqrt(dx * dx + dz * dz)
    val totalDist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (totalDist < 1e-5) {
      out[0] = 0.0
      out[1] = 0.0
      out[2] = 0.0
      out[3] = 1.0
      return out
    }
    val yaw = Math.atan2(dx, dz)
    var pitch = -Math.atan2(dy, Math.max(horizDist, 1e-5))
    if (mode == "cylindrical") {
      pitch = 0.0
    } else if (mode != "spherical") {
      // Capsule mode clamps pitch to [-30 deg, +30 deg].
      val maxPitch = 30.0 * Math.PI / 180.0
      pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch))
    }
    val cx = Math.cos(pitch * 0.5)
    val sx = Math.sin(pitch * 0.5)
    val cy = Math.cos(yaw * 0.5)
    val sy = Math.sin(yaw * 0.5)
    out[0] = cy * sx
    out[1] = sy * cx
    out[2] = -sy * sx
    out[3] = cy * cx
    return out
  }
}

/**
 * Manipulation-handle math (port of `xr-live/src/plugins/manipulation-handles.ts`): four top-corner
 * uniform-scale handles and a pedestal yaw bar derived from a local AABB and world transform.
 */
object ManipulationHandles {

  /** World-space handle placement for a single mesh. */
  class Layout(
    val origin: DoubleArray,
    /** Top corners `(min,max,min)`, `(max,max,min)`, `(max,max,max)`, `(min,max,max)`. */
    val corners: List<DoubleArray>,
    val pedestalStart: DoubleArray,
    val pedestalEnd: DoubleArray,
    val pedestalCenter: DoubleArray,
    /** Yaw of the mesh about +Y in radians. */
    val yaw: Double,
    val handleRadius: Double,
  )

  /** Which handle a ray picked and the distance along the ray. */
  sealed class Hit(val distance: Double) {
    /** A corner scale handle (index into [Layout.corners]). */
    class Corner(val index: Int, distance: Double) : Hit(distance)

    /** The pedestal rotate bar. */
    class Rotate(distance: Double) : Hit(distance)
  }

  /**
   * Computes world-space handle positions for a mesh with local bounds [localMin]..[localMax] and
   * column-major world matrix [world].
   */
  @JvmStatic
  fun computeLayout(localMin: DoubleArray, localMax: DoubleArray, world: DoubleArray): Layout {
    val mn = localMin
    val mx = localMax
    val corners =
      listOf(
        XRSpatialMath.transformPoint(world, mn[0], mx[1], mn[2], DoubleArray(3)),
        XRSpatialMath.transformPoint(world, mx[0], mx[1], mn[2], DoubleArray(3)),
        XRSpatialMath.transformPoint(world, mx[0], mx[1], mx[2], DoubleArray(3)),
        XRSpatialMath.transformPoint(world, mn[0], mx[1], mx[2], DoubleArray(3)),
      )
    val cz = (mn[2] + mx[2]) * 0.5
    val ps = XRSpatialMath.transformPoint(world, mn[0], mn[1], cz, DoubleArray(3))
    val pe = XRSpatialMath.transformPoint(world, mx[0], mn[1], cz, DoubleArray(3))
    ps[1] -= 0.03
    pe[1] -= 0.03
    val diag = XRSpatialMath.dist3(corners[0], corners[2])
    val q = XRSpatialMath.extractQuaternion(world)
    return Layout(
      origin = doubleArrayOf(world[12], world[13], world[14]),
      corners = corners,
      pedestalStart = ps,
      pedestalEnd = pe,
      pedestalCenter =
        doubleArrayOf((ps[0] + pe[0]) * 0.5, (ps[1] + pe[1]) * 0.5, (ps[2] + pe[2]) * 0.5),
      yaw = XRSpatialMath.yawFromQuat(q[0], q[1], q[2], q[3]),
      handleRadius = XRSpatialMath.clampNum(diag * 0.06, 0.012, 0.08, 0.02),
    )
  }

  /** [computeLayout] for float inputs. */
  @JvmStatic
  fun computeLayout(localMin: FloatArray, localMax: FloatArray, world: FloatArray): Layout =
    computeLayout(
      DoubleArray(3) { localMin[it].toDouble() },
      DoubleArray(3) { localMax[it].toDouble() },
      DoubleArray(16) { world[it].toDouble() },
    )

  /** Returns `(t, miss)`: distance along the ray to its closest approach to [p], and the gap. */
  private fun rayPointDistance(origin: DoubleArray, dir: DoubleArray, p: DoubleArray): DoubleArray {
    val t =
      Math.max(
        0.0,
        (p[0] - origin[0]) * dir[0] + (p[1] - origin[1]) * dir[1] + (p[2] - origin[2]) * dir[2],
      )
    val miss =
      XRSpatialMath.len3(
        origin[0] + dir[0] * t - p[0],
        origin[1] + dir[1] * t - p[1],
        origin[2] + dir[2] * t - p[2],
      )
    return doubleArrayOf(t, miss)
  }

  private fun raySegmentDistance(
    origin: DoubleArray,
    dir: DoubleArray,
    a: DoubleArray,
    b: DoubleArray,
  ): DoubleArray {
    val ab = doubleArrayOf(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    val ao = doubleArrayOf(origin[0] - a[0], origin[1] - a[1], origin[2] - a[2])
    val abLen2 = Math.max(XRSpatialMath.dot3(ab, ab), 1e-10)
    val d1 = XRSpatialMath.dot3(dir, ab)
    val denom = abLen2 - d1 * d1
    var s =
      if (Math.abs(denom) < 1e-10) {
        0.0
      } else {
        (XRSpatialMath.dot3(ao, ab) - d1 * XRSpatialMath.dot3(ao, dir)) / denom
      }
    s = Math.max(0.0, Math.min(1.0, s))
    val onSeg = doubleArrayOf(a[0] + ab[0] * s, a[1] + ab[1] * s, a[2] + ab[2] * s)
    return rayPointDistance(origin, dir, onSeg)
  }

  /** Picks the nearest handle under a normalized ray, or `null` when none is hit. */
  @JvmStatic
  fun pick(layout: Layout, origin: DoubleArray, dir: DoubleArray, options: XRHandlesTrait): Hit? {
    var best: Hit? = null
    val r = layout.handleRadius * 1.5
    for ((index, c) in layout.corners.withIndex()) {
      val tm = rayPointDistance(origin, dir, c)
      if (tm[1] <= r && (best == null || tm[0] < best.distance)) best = Hit.Corner(index, tm[0])
    }
    if (options.rotateAxis == "y") {
      val tm = raySegmentDistance(origin, dir, layout.pedestalStart, layout.pedestalEnd)
      if (tm[1] <= r && (best == null || tm[0] < best.distance)) best = Hit.Rotate(tm[0])
    }
    return best
  }

  /** Intersects a ray with the horizontal plane `y = [y]`, or `null` when parallel / behind. */
  @JvmStatic
  fun intersectHorizontalPlane(origin: DoubleArray, dir: DoubleArray, y: Double): DoubleArray? {
    if (Math.abs(dir[1]) < 1e-6) return null
    val t = (y - origin[1]) / dir[1]
    if (t < 0) return null
    return doubleArrayOf(origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t)
  }

  /**
   * Corner drag: returns the new uniform scale, `startScale × |p − pivot| / |start − pivot|`
   * clamped to `[minScale, maxScale]`, where `p` is the ray's closest approach to [startPoint].
   */
  @JvmStatic
  fun cornerScale(
    startScale: Double,
    startPoint: DoubleArray,
    pivot: DoubleArray,
    rayOrigin: DoubleArray,
    rayDir: DoubleArray,
    minScale: Double,
    maxScale: Double,
  ): Double {
    val t = rayPointDistance(rayOrigin, rayDir, startPoint)[0]
    val p =
      doubleArrayOf(
        rayOrigin[0] + rayDir[0] * t,
        rayOrigin[1] + rayDir[1] * t,
        rayOrigin[2] + rayDir[2] * t,
      )
    val r0 = Math.max(XRSpatialMath.dist3(startPoint, pivot), 1e-4)
    val ratio = XRSpatialMath.dist3(p, pivot) / r0
    return XRSpatialMath.clampNum(startScale * ratio, minScale, maxScale, startScale)
  }

  /**
   * Pedestal drag: returns the yaw delta in radians (`atan2(dx, dz)` of the current minus start
   * pointer positions on the plane `y = [planeY]`), or `null` when the ray misses the plane.
   */
  @JvmStatic
  fun pedestalYawDelta(
    startPoint: DoubleArray,
    pivot: DoubleArray,
    rayOrigin: DoubleArray,
    rayDir: DoubleArray,
    planeY: Double,
  ): Double? {
    val p = intersectHorizontalPlane(rayOrigin, rayDir, planeY) ?: return null
    val a0 = Math.atan2(startPoint[0] - pivot[0], startPoint[2] - pivot[2])
    val a1 = Math.atan2(p[0] - pivot[0], p[2] - pivot[2])
    return a1 - a0
  }

  /**
   * Stateful single-mesh drag mirroring `XRManipulationHandlesController`: call [begin] on
   * select-start, [update] on move (returns the new local scale/rotation), [end] on release.
   */
  class Drag(private val options: XRHandlesTrait) {
    private var hit: Hit? = null
    private var startPoint = DoubleArray(3)
    private var pivot = DoubleArray(3)
    private var planeY = 0.0
    private val startScale = DoubleArray(3)
    private val startQuat = DoubleArray(4)

    /** Current local scale after the last [update]. */
    val scale = DoubleArray(3)

    /** Current local rotation after the last [update]. */
    val rotation = DoubleArray(4)

    /** Whether a drag is active. */
    val active: Boolean
      get() = hit != null

    /** Starts a drag when the ray picks a handle; returns the hit or `null`. */
    fun begin(
      layout: Layout,
      rayOrigin: DoubleArray,
      rawDir: DoubleArray,
      localScale: DoubleArray,
      localRotation: DoubleArray,
    ): Hit? {
      val dir = XRSpatialMath.normalizeRayDir(rawDir) ?: return null
      val h = pick(layout, rayOrigin, dir, options) ?: return null
      hit = h
      startPoint =
        if (h is Hit.Corner) {
          layout.corners[h.index].copyOf()
        } else {
          intersectHorizontalPlane(rayOrigin, dir, layout.pedestalCenter[1])
            ?: layout.pedestalCenter.copyOf()
        }
      pivot = layout.origin.copyOf()
      planeY = layout.pedestalCenter[1]
      localScale.copyInto(startScale)
      localRotation.copyInto(startQuat)
      localScale.copyInto(scale)
      localRotation.copyInto(rotation)
      return h
    }

    /** Applies a new ray; returns `false` when idle or the ray is degenerate. */
    fun update(rayOrigin: DoubleArray, rawDir: DoubleArray): Boolean {
      val h = hit ?: return false
      val dir = XRSpatialMath.normalizeRayDir(rawDir) ?: return false
      if (h is Hit.Corner) {
        val s0 = startScale[0]
        val s =
          cornerScale(s0, startPoint, pivot, rayOrigin, dir, options.minScale, options.maxScale)
        val k = s / Math.max(s0, 1e-6)
        for (i in 0 until 3) scale[i] = startScale[i] * k
      } else {
        val d = pedestalYawDelta(startPoint, pivot, rayOrigin, dir, planeY) ?: return false
        XRSpatialMath.quatMultiply(XRSpatialMath.quatFromYaw(d), startQuat, rotation)
      }
      return true
    }

    /** Ends the drag. */
    fun end() {
      hit = null
    }
  }
}

/**
 * World-understanding math (port of `xr-live/src/plugins/world-understanding.ts`): detection-box
 * normalization, viewport rays, plane hit tests, and 2D-to-3D detection unprojection.
 */
object WorldUnderstanding {

  /** Maximum tracked planes retained per frame. */
  const val MAX_TRACKED_PLANES = 64

  /** Maximum detections unprojected per call. */
  const val MAX_DETECTIONS = 32

  /** Distance used when neither depth nor a tracked plane is available. */
  const val FALLBACK_DEPTH_METERS = 1.5

  /** A tracked real-world plane in reference-space coordinates. */
  class TrackedPlane(
    /** `horizontal` or `vertical`. */
    val orientation: String,
    val center: DoubleArray,
    val normal: DoubleArray,
    /** Bounding radius of the plane polygon in meters. */
    val radius: Double,
  )

  /** How the depth of a [Detection3D] was obtained. */
  enum class DepthSource(val wireName: String) {
    DEPTH("depth"),
    PLANE("plane"),
    FALLBACK("fallback"),
  }

  /** A detection located in 3D world space. */
  data class Detection3D(
    val label: String,
    val x: Double,
    val y: Double,
    val z: Double,
    val widthMeters: Double,
    val heightMeters: Double,
    val depthSource: DepthSource,
  )

  /** A world-space ray; [viewDir] is the unnormalized view-space direction at `z = -1`. */
  class Ray(val origin: DoubleArray, val dir: DoubleArray, val viewDir: DoubleArray)

  /** A ray / plane intersection. */
  class PlaneHit(
    val point: DoubleArray,
    val normal: DoubleArray,
    val distance: Double,
    val plane: TrackedPlane,
  )

  /**
   * Normalizes a `[ymin, xmin, ymax, xmax]` box to `[0, 1]`, accepting unit or Gemini-style
   * `0..1000` coordinates. Returns `null` when malformed.
   */
  @JvmStatic
  fun normalizeBox(box: DoubleArray): DoubleArray? {
    if (box.size < 4) return null
    for (i in 0 until 4) if (!box[i].isFinite()) return null
    var scale = 1.0
    for (i in 0 until 4) if (box[i] > 1.0001) scale = 1000.0
    val y0 = XRSpatialMath.clampNum(box[0] / scale, 0.0, 1.0, 0.0)
    val x0 = XRSpatialMath.clampNum(box[1] / scale, 0.0, 1.0, 0.0)
    val y1 = XRSpatialMath.clampNum(box[2] / scale, 0.0, 1.0, 0.0)
    val x1 = XRSpatialMath.clampNum(box[3] / scale, 0.0, 1.0, 0.0)
    return doubleArrayOf(Math.min(y0, y1), Math.min(x0, x1), Math.max(y0, y1), Math.max(x0, x1))
  }

  /** Returns the normalized `(u, v)` viewport center of [box], or `null` when malformed. */
  @JvmStatic
  fun boxCenter(box: DoubleArray): DoubleArray? {
    val b = normalizeBox(box) ?: return null
    return doubleArrayOf((b[1] + b[3]) * 0.5, (b[0] + b[2]) * 0.5)
  }

  private fun projEntry(proj: FloatArray, i: Int, fallback: Double): Double {
    val v = proj[i].toDouble()
    return if (v == 0.0 || v.isNaN()) fallback else v
  }

  /**
   * Returns the world-space ray through normalized viewport coordinates `(u, v)` (origin top-left)
   * for a column-major camera world matrix and projection matrix.
   */
  @JvmStatic
  fun viewportRay(u: Double, v: Double, cameraWorld: FloatArray, proj: FloatArray): Ray {
    require(cameraWorld.size >= 16 && proj.size >= 16) {
      "viewportRay: matrices must have 16 elements"
    }
    val ndcX = u * 2 - 1
    val ndcY = 1 - v * 2
    val p0 = projEntry(proj, 0, 1.0)
    val p5 = projEntry(proj, 5, 1.0)
    val viewDir = doubleArrayOf((ndcX + proj[8]) / p0, (ndcY + proj[9]) / p5, -1.0)
    val origin =
      doubleArrayOf(
        cameraWorld[12].toDouble(),
        cameraWorld[13].toDouble(),
        cameraWorld[14].toDouble(),
      )
    val far =
      XRSpatialMath.transformPoint(cameraWorld, viewDir[0], viewDir[1], viewDir[2], DoubleArray(3))
    val d = doubleArrayOf(far[0] - origin[0], far[1] - origin[1], far[2] - origin[2])
    val dir = XRSpatialMath.normalizeRayDir(d) ?: doubleArrayOf(0.0, 0.0, -1.0)
    return Ray(origin, dir, viewDir)
  }

  /** Intersects a ray with tracked planes, returning the nearest hit. */
  @JvmStatic
  fun hitTestPlanes(planes: List<TrackedPlane>, origin: DoubleArray, dir: DoubleArray): PlaneHit? {
    var best: PlaneHit? = null
    for (plane in planes) {
      val denom = XRSpatialMath.dot3(plane.normal, dir)
      if (Math.abs(denom) < 1e-6) continue
      val t =
        ((plane.center[0] - origin[0]) * plane.normal[0] +
          (plane.center[1] - origin[1]) * plane.normal[1] +
          (plane.center[2] - origin[2]) * plane.normal[2]) / denom
      if (t <= 0.01 || (best != null && t >= best.distance)) continue
      val point =
        doubleArrayOf(origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t)
      if (XRSpatialMath.dist3(point, plane.center) > plane.radius) continue
      best = PlaneHit(point, plane.normal.copyOf(), t, plane)
    }
    return best
  }

  /**
   * Unprojects a 2D detection box to 3D. Uses [depthMeters] (view-space depth along -Z sampled at
   * [boxCenter]) when it is finite and > 5 cm, then tracked [planes], then [FALLBACK_DEPTH_METERS].
   */
  @JvmStatic
  @JvmOverloads
  fun unprojectDetection(
    box: DoubleArray,
    cameraWorld: FloatArray,
    proj: FloatArray,
    depthMeters: Double? = null,
    planes: List<TrackedPlane> = emptyList(),
    label: String = "",
  ): Detection3D? {
    require(cameraWorld.size >= 16 && proj.size >= 16) {
      "unprojectDetection: matrices must have 16 elements"
    }
    val b = normalizeBox(box) ?: return null
    val y0 = b[0]
    val x0 = b[1]
    val y1 = b[2]
    val x1 = b[3]
    val u = (x0 + x1) * 0.5
    val v = (y0 + y1) * 0.5
    val ray = viewportRay(u, v, cameraWorld, proj)
    val depth: Double
    val source: DepthSource
    if (depthMeters != null && depthMeters.isFinite() && depthMeters > 0.05) {
      depth = depthMeters
      source = DepthSource.DEPTH
    } else {
      val hit = hitTestPlanes(planes, ray.origin, ray.dir)
      if (hit != null) {
        depth = hit.distance / XRSpatialMath.len3(ray.viewDir[0], ray.viewDir[1], ray.viewDir[2])
        source = DepthSource.PLANE
      } else {
        depth = FALLBACK_DEPTH_METERS
        source = DepthSource.FALLBACK
      }
    }
    val world =
      XRSpatialMath.transformPoint(
        cameraWorld,
        ray.viewDir[0] * depth,
        ray.viewDir[1] * depth,
        ray.viewDir[2] * depth,
        DoubleArray(3),
      )
    val p0 = Math.abs(projEntry(proj, 0, 1.0))
    val p5 = Math.abs(projEntry(proj, 5, 1.0))
    return Detection3D(
      label = if (label.length > 256) label.substring(0, 256) else label,
      x = world[0],
      y = world[1],
      z = world[2],
      widthMeters = (x1 - x0) * 2 * depth / p0,
      heightMeters = (y1 - y0) * 2 * depth / p5,
      depthSource = source,
    )
  }

  /** Accumulates tape-measure points and reports segment / total lengths. */
  class TapeMeasure {
    private val points = ArrayList<DoubleArray>()

    /** Adds a point and returns the newest segment length (0 for the first / invalid points). */
    fun addPoint(x: Double, y: Double, z: Double): Double {
      if (!x.isFinite() || !y.isFinite() || !z.isFinite()) return 0.0
      points.add(doubleArrayOf(x, y, z))
      val n = points.size
      return if (n < 2) 0.0 else XRSpatialMath.dist3(points[n - 1], points[n - 2])
    }

    /** Summed length of every segment in meters. */
    val totalMeters: Double
      get() {
        var total = 0.0
        for (i in 1 until points.size) total += XRSpatialMath.dist3(points[i], points[i - 1])
        return total
      }

    /** Number of accepted points. */
    val pointCount: Int
      get() = points.size

    /** Removes every point. */
    fun clear() {
      points.clear()
    }
  }
}
