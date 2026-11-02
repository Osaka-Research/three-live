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
 * Pure math and dynamic geometry builders for `magnetic-snap` (mirrors
 * `xr-live/src/plugins/magnetic-snap.ts`).
 */
object MagneticSnap {
  const val SOCKET_UNSNAP_MULTIPLIER: Double = 1.25
  const val SOCKET_PREVIEW_MULTIPLIER: Double = 1.5

  data class SocketCandidate(
    val id: String,
    val tag: String,
    val position: DoubleArray,
    val quaternion: DoubleArray,
    val radius: Double = 0.15,
    val alignRotation: Boolean = true,
    val highlightColor: String = "#22c55e",
  )

  data class SurfacePlane(
    val position: DoubleArray,
    val normal: DoubleArray,
    val orientation: String? = null,
    val semanticLabel: String? = null,
  )

  data class Evaluation(
    val position: DoubleArray,
    val quaternion: DoubleArray,
    /** One of `socket`, `grid`, `surface`, `none`. */
    val mode: String,
    val matchedSocketId: String?,
    val previewSocketId: String?,
  )

  private fun normalizeQuat(q: DoubleArray): DoubleArray {
    val x = if (q.size > 0 && q[0].isFinite()) q[0] else 0.0
    val y = if (q.size > 1 && q[1].isFinite()) q[1] else 0.0
    val z = if (q.size > 2 && q[2].isFinite()) q[2] else 0.0
    val w = if (q.size > 3 && q[3].isFinite()) q[3] else 1.0
    val len = Math.sqrt(x * x + y * y + z * z + w * w)
    return if (len > 1e-8) doubleArrayOf(x / len, y / len, z / len, w / len) else doubleArrayOf(0.0, 0.0, 0.0, 1.0)
  }

  /** Composes a unit quaternion `[x, y, z, w]` from intrinsic YXZ Euler angles (radians). */
  @JvmStatic
  fun quatFromEulerYXZ(pitchX: Double, yawY: Double, rollZ: Double = 0.0): DoubleArray {
    val cx = Math.cos(pitchX * 0.5)
    val sx = Math.sin(pitchX * 0.5)
    val cy = Math.cos(yawY * 0.5)
    val sy = Math.sin(yawY * 0.5)
    val cz = Math.cos(rollZ * 0.5)
    val sz = Math.sin(rollZ * 0.5)
    return doubleArrayOf(
      cy * sx * cz + sy * cx * sz,
      sy * cx * cz - cy * sx * sz,
      cy * cx * sz - sy * sx * cz,
      cy * cx * cz + sy * sx * sz,
    )
  }

  /** Decomposes `[x, y, z, w]` into intrinsic YXZ Euler angles `[pitchX, yawY, rollZ]`. */
  @JvmStatic
  fun eulerYXZFromQuat(q: DoubleArray): DoubleArray {
    val n = normalizeQuat(q)
    val x = n[0]
    val y = n[1]
    val z = n[2]
    val w = n[3]
    val sinPitch = Math.max(-1.0, Math.min(1.0, 2.0 * (w * x - y * z)))
    val pitchX = Math.asin(sinPitch)
    if (Math.abs(sinPitch) < 0.99999) {
      val yawY = Math.atan2(2.0 * (x * z + w * y), 1.0 - 2.0 * (x * x + y * y))
      val rollZ = Math.atan2(2.0 * (x * y + w * z), 1.0 - 2.0 * (x * x + z * z))
      return doubleArrayOf(pitchX, yawY, rollZ)
    }
    val yawY = Math.atan2(2.0 * (w * y - x * z), 1.0 - 2.0 * (y * y + z * z))
    return doubleArrayOf(pitchX, yawY, 0.0)
  }

  /** Quantizes a quaternion's YXZ Euler angles to multiples of [angleDeg] degrees. */
  @JvmStatic
  fun quantizeQuaternionAngle(q: DoubleArray, angleDeg: Double): DoubleArray {
    val norm = normalizeQuat(q)
    if (!angleDeg.isFinite() || angleDeg <= 0.0) return norm
    val step = Math.min(180.0, angleDeg) * Math.PI / 180.0
    val e = eulerYXZFromQuat(norm)
    val qx = Math.floor(e[0] / step + 0.5) * step
    val qy = Math.floor(e[1] / step + 0.5) * step
    val qz = Math.floor(e[2] / step + 0.5) * step
    return quatFromEulerYXZ(qx, qy, qz)
  }

  /** Quantizes a 3D world position to the Cartesian step vector [grid] (meters). */
  @JvmStatic
  fun quantizeGridPosition(pos: DoubleArray, grid: List<Double>?): DoubleArray {
    val p = DoubleArray(3) { i -> pos.getOrElse(i) { 0.0 }.let { if (it.isFinite()) it else 0.0 } }
    if (grid == null || grid.size < 3) return p
    return DoubleArray(3) { i ->
      val g = grid[i]
      if (g > 0.0) Math.floor(p[i] / g + 0.5) * g + 0.0 else p[i]
    }
  }

  private fun planeMatchesSurface(plane: SurfacePlane, mode: String): Boolean {
    if (mode == "none") return false
    if (mode == "any") return true
    val n = XRSpatialMath.normalizeRayDir(plane.normal) ?: doubleArrayOf(0.0, 1.0, 0.0)
    val label = plane.semanticLabel?.lowercase() ?: ""
    return when (mode) {
      "floor" -> label == "floor" || (label != "ceiling" && n[1] > 0.7)
      "ceiling" -> label == "ceiling" || n[1] < -0.7
      "wall" -> label == "wall" || plane.orientation == "vertical" || Math.abs(n[1]) <= 0.35
      else -> false
    }
  }

  /** Evaluates socket hysteresis, Cartesian grid, surface clamping, and angle quantization. */
  @JvmStatic
  @JvmOverloads
  fun evaluate(
    position: DoubleArray,
    quaternion: DoubleArray,
    config: XRSnapToTrait,
    sockets: List<SocketCandidate> = emptyList(),
    planes: List<SurfacePlane> = emptyList(),
    currentSocketId: String? = null,
    bottomOffset: Double = 0.0,
    defaultFloorY: Double = 0.0,
  ): Evaluation {
    val pos = DoubleArray(3) { i -> position.getOrElse(i) { 0.0 }.let { if (it.isFinite()) it else 0.0 } }
    val quat = normalizeQuat(quaternion)
    val bOff = if (bottomOffset.isFinite()) bottomOffset else 0.0
    val floorY = if (defaultFloorY.isFinite()) defaultFloorY else 0.0

    var matchedSocket: SocketCandidate? = null
    var previewSocket: SocketCandidate? = null
    if (config.socketTag.isNotEmpty()) {
      if (currentSocketId != null) {
        val held = sockets.firstOrNull { it.id == currentSocketId && it.tag == config.socketTag }
        if (held != null) {
          val snapR = Math.min(config.radius, held.radius)
          if (XRSpatialMath.dist3(pos, held.position) <= SOCKET_UNSNAP_MULTIPLIER * snapR) {
            matchedSocket = held
            previewSocket = held
          }
        }
      }
      if (matchedSocket == null) {
        var bestSnapDist = Double.POSITIVE_INFINITY
        var bestPreviewDist = Double.POSITIVE_INFINITY
        for (s in sockets) {
          if (s.tag != config.socketTag) continue
          val snapR = Math.min(config.radius, s.radius)
          val d = XRSpatialMath.dist3(pos, s.position)
          if (d <= snapR && d < bestSnapDist) {
            bestSnapDist = d
            matchedSocket = s
          }
          if (d <= SOCKET_PREVIEW_MULTIPLIER * snapR && d < bestPreviewDist) {
            bestPreviewDist = d
            previewSocket = s
          }
        }
      }
    }

    if (matchedSocket != null) {
      val snappedQuat =
        when {
          matchedSocket.alignRotation -> normalizeQuat(matchedSocket.quaternion)
          config.angleDeg > 0.0 -> quantizeQuaternionAngle(quat, config.angleDeg)
          else -> quat
        }
      return Evaluation(
        position = matchedSocket.position.copyOf(),
        quaternion = snappedQuat,
        mode = "socket",
        matchedSocketId = matchedSocket.id,
        previewSocketId = matchedSocket.id,
      )
    }

    var nextPos = quantizeGridPosition(pos, config.grid)
    var surfaceApplied = false
    if (config.surface != "none") {
      var bestPlane: SurfacePlane? = null
      var bestErr = Double.POSITIVE_INFINITY
      val captureLimit = Math.max(config.radius, 0.35)
      for (p in planes) {
        if (!planeMatchesSurface(p, config.surface)) continue
        val n = XRSpatialMath.normalizeRayDir(p.normal) ?: doubleArrayOf(0.0, 1.0, 0.0)
        val signed =
          ((nextPos[0] - p.position[0]) * n[0] +
            (nextPos[1] - p.position[1]) * n[1] +
            (nextPos[2] - p.position[2]) * n[2]) - (if (n[1] > 0.7) bOff else 0.0)
        val absErr = Math.abs(signed)
        if (absErr <= captureLimit && absErr < bestErr) {
          bestErr = absErr
          bestPlane = p
        }
      }
      if (bestPlane != null) {
        val n = XRSpatialMath.normalizeRayDir(bestPlane.normal) ?: doubleArrayOf(0.0, 1.0, 0.0)
        val signed =
          ((nextPos[0] - bestPlane.position[0]) * n[0] +
            (nextPos[1] - bestPlane.position[1]) * n[1] +
            (nextPos[2] - bestPlane.position[2]) * n[2]) - (if (n[1] > 0.7) bOff else 0.0)
        nextPos = doubleArrayOf(nextPos[0] - n[0] * signed, nextPos[1] - n[1] * signed, nextPos[2] - n[2] * signed)
        surfaceApplied = true
      } else if (config.surface == "floor" || config.surface == "any") {
        nextPos = doubleArrayOf(nextPos[0], floorY + bOff, nextPos[2])
        surfaceApplied = true
      }
    }

    val nextQuat = if (config.angleDeg > 0.0) quantizeQuaternionAngle(quat, config.angleDeg) else quat
    val gridOrAngle = config.grid != null || config.angleDeg > 0.0
    val mode =
      when {
        surfaceApplied && config.grid == null -> "surface"
        gridOrAngle -> "grid"
        surfaceApplied -> "surface"
        else -> "none"
      }
    return Evaluation(
      position = nextPos,
      quaternion = nextQuat,
      mode = mode,
      matchedSocketId = null,
      previewSocketId = previewSocket?.id,
    )
  }

  /** Builds a 3D torus ring in the XZ plane (`+Y` normal) for socket preview. */
  @JvmStatic
  @JvmOverloads
  fun buildSnapRingGeometry(
    majorRadius: Double = 0.12,
    tubeRadius: Double = 0.008,
    radialSegments: Int = 24,
    tubularSegments: Int = 8,
  ): SpatialMeasure.MeshGeometry {
    val bigR = Math.max(0.01, majorRadius)
    val smallR = Math.max(0.001, Math.min(bigR * 0.45, tubeRadius))
    val segU = Math.max(8, radialSegments)
    val segV = Math.max(4, tubularSegments)
    val vertCount = (segU + 1) * (segV + 1)
    val positions = FloatArray(vertCount * 3)
    val normals = FloatArray(vertCount * 3)
    val indices = IntArray(segU * segV * 6)
    var vi = 0
    for (i in 0..segU) {
      val u = (i.toDouble() / segU) * Math.PI * 2.0
      val cu = Math.cos(u)
      val su = Math.sin(u)
      for (j in 0..segV) {
        val v = (j.toDouble() / segV) * Math.PI * 2.0
        val cv = Math.cos(v)
        val sv = Math.sin(v)
        val rad = bigR + smallR * cv
        positions[vi * 3] = (rad * cu).toFloat()
        positions[vi * 3 + 1] = (smallR * sv).toFloat()
        positions[vi * 3 + 2] = (rad * su).toFloat()
        normals[vi * 3] = (cv * cu).toFloat()
        normals[vi * 3 + 1] = sv.toFloat()
        normals[vi * 3 + 2] = (cv * su).toFloat()
        vi++
      }
    }
    var ii = 0
    val stride = segV + 1
    for (i in 0 until segU) {
      for (j in 0 until segV) {
        val a = i * stride + j
        val b = (i + 1) * stride + j
        val c = (i + 1) * stride + (j + 1)
        val d = i * stride + (j + 1)
        indices[ii++] = a
        indices[ii++] = c
        indices[ii++] = b
        indices[ii++] = a
        indices[ii++] = d
        indices[ii++] = c
      }
    }
    return SpatialMeasure.MeshGeometry(positions, normals, indices)
  }
}
