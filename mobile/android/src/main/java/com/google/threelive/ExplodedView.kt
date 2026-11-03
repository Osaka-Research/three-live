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
 * Pure math and dynamic geometry builders for `exploded-view` (mirrors
 * `xr-live/src/plugins/exploded-view.ts`).
 */
object ExplodedView {
  const val TWO_HAND_SPAN_METERS: Double = 0.4
  private val MODES = setOf("radial", "axial-x", "axial-y", "axial-z", "hierarchical")
  private val SECTION_REGEX =
    Regex("^([+-]?[xyz])\\s*:\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?)$")

  data class SectionPlaneState(
    val enabled: Boolean,
    val normal: DoubleArray,
    val constant: Double,
    val interactive: Boolean,
  )

  /** Computes staggered smoothstep layer progress `t_L` in `[0..1]`. */
  @JvmStatic
  fun computeLayerFactor(factor: Double, layer: Int, maxLayer: Int): Double {
    val f = XRSpatialMath.clampNum(factor, 0.0, 1.0, 0.0)
    if (f <= 0.0) return 0.0
    if (f >= 1.0) return 1.0
    val maxL = Math.max(1, Math.min(10, maxLayer))
    if (maxL <= 1) return f * f * (3.0 - 2.0 * f)
    val clampedL = Math.max(1, Math.min(maxL, layer))
    val stagger = 0.35
    val span = 1.0 / (1.0 + (maxL - 1) * stagger)
    val start = (clampedL - 1) * stagger * span
    val u = Math.max(0.0, Math.min(1.0, (f - start) / span))
    return u * u * (3.0 - 2.0 * u)
  }

  /** Computes the local/scene-space displacement offset for one assembly part. */
  @JvmStatic
  @JvmOverloads
  fun computeNodeOffset(
    restPosition: DoubleArray,
    assemblyCenter: DoubleArray,
    assemblyRadius: Double,
    factor: Double,
    mode: String = "radial",
    explodeScale: Double = 1.5,
    trait: XRExplodeTrait? = null,
    maxLayer: Int = 1,
    nodeIndex: Int = 0,
    nodeCount: Int = 1,
    hierarchyDepth: Int = 1,
  ): DoubleArray {
    val f = XRSpatialMath.clampNum(factor, 0.0, 1.0, 0.0)
    if (f <= 1e-6) return doubleArrayOf(0.0, 0.0, 0.0)
    val resolvedMode = if (mode in MODES) mode else "radial"
    val scale = XRSpatialMath.clampNum(explodeScale, 0.0, 10.0, 1.5)
    val radius = Math.max(0.05, if (assemblyRadius.isFinite()) assemblyRadius else 0.5)
    val layer = trait?.layer ?: 1
    val tL = computeLayerFactor(f, layer, Math.max(layer, maxLayer))
    if (tL <= 1e-6) return doubleArrayOf(0.0, 0.0, 0.0)

    val rel =
      doubleArrayOf(
        restPosition.getOrElse(0) { 0.0 } - assemblyCenter.getOrElse(0) { 0.0 },
        restPosition.getOrElse(1) { 0.0 } - assemblyCenter.getOrElse(1) { 0.0 },
        restPosition.getOrElse(2) { 0.0 } - assemblyCenter.getOrElse(2) { 0.0 },
      )
    val relDist = XRSpatialMath.len3(rel[0], rel[1], rel[2])

    val dir: DoubleArray
    val maxDist: Double
    val customDir = trait?.direction
    if (customDir != null && customDir.size >= 3) {
      dir =
        XRSpatialMath.normalizeRayDir(doubleArrayOf(customDir[0], customDir[1], customDir[2]))
          ?: doubleArrayOf(0.0, 1.0, 0.0)
      maxDist = trait.distance * scale
    } else {
      val count = Math.max(1, nodeCount)
      val spreadSlot = if (count > 1) (nodeIndex.toDouble() / (count - 1)) * 2.0 - 1.0 else 0.0
      when (resolvedMode) {
        "axial-x",
        "axial-y",
        "axial-z" -> {
          val axisIdx =
            if (resolvedMode == "axial-x") 0 else if (resolvedMode == "axial-y") 1 else 2
          val comp = rel[axisIdx]
          val sign =
            if (Math.abs(comp) > 1e-4) Math.signum(comp) else if (spreadSlot >= 0.0) 1.0 else -1.0
          dir = doubleArrayOf(0.0, 0.0, 0.0)
          dir[axisIdx] = sign
          val weight =
            if (Math.abs(comp) > 1e-4) Math.abs(comp) / radius
            else Math.abs(spreadSlot) * 0.6 + 0.25
          maxDist = (trait?.distance ?: (radius * Math.max(0.2, weight))) * scale
        }
        "hierarchical" -> {
          val depth = Math.max(1, hierarchyDepth)
          dir =
            if (relDist > 1e-4) {
              doubleArrayOf(rel[0] / relDist, rel[1] / relDist, rel[2] / relDist)
            } else {
              val angle = (nodeIndex.toDouble() / count) * Math.PI * 2.0
              XRSpatialMath.normalizeRayDir(doubleArrayOf(Math.cos(angle), 0.35, Math.sin(angle)))
                ?: doubleArrayOf(0.0, 1.0, 0.0)
            }
          val depthWeight = 0.35 + 0.3 * Math.min(4, depth)
          maxDist = (trait?.distance ?: (radius * depthWeight)) * scale
        }
        else -> {
          if (relDist > 1e-4) {
            dir = doubleArrayOf(rel[0] / relDist, rel[1] / relDist, rel[2] / relDist)
            val shellWeight = Math.max(0.25, Math.min(1.6, relDist / radius + 0.25))
            maxDist = (trait?.distance ?: (radius * shellWeight)) * scale
          } else {
            val angle = (nodeIndex.toDouble() / count) * Math.PI * 2.0
            dir =
              XRSpatialMath.normalizeRayDir(
                doubleArrayOf(Math.cos(angle), 0.25 * spreadSlot, Math.sin(angle))
              ) ?: doubleArrayOf(0.0, 1.0, 0.0)
            maxDist = (trait?.distance ?: (radius * 0.35)) * scale
          }
        }
      }
    }

    val d = tL * maxDist
    return doubleArrayOf(dir[0] * d, dir[1] * d, dir[2] * d)
  }

  /** Maps a two-hand spread gesture (`startDistance -> currentDistance`) to `[-1..1]`. */
  @JvmStatic
  @JvmOverloads
  fun computeTwoHandDelta(
    startDistance: Double,
    currentDistance: Double,
    spanMeters: Double = TWO_HAND_SPAN_METERS,
  ): Double {
    if (!startDistance.isFinite() || !currentDistance.isFinite()) return 0.0
    val span = Math.max(0.05, spanMeters)
    return Math.max(-1.0, Math.min(1.0, (currentDistance - startDistance) / span))
  }

  /** Parses a `section-plane` spec (`none`, `x:0.2`, `y:0.0`, `-z:0.1`, `interactive`). */
  @JvmStatic
  @JvmOverloads
  fun parseSectionPlane(
    raw: String?,
    defaultCenter: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0),
  ): SectionPlaneState {
    val s = raw?.trim()?.lowercase() ?: ""
    if (s.isEmpty() || s == "none" || s == "false") {
      return SectionPlaneState(false, doubleArrayOf(1.0, 0.0, 0.0), 0.0, false)
    }
    if (s == "interactive") {
      val cx = defaultCenter.getOrElse(0) { 0.0 }.let { if (it.isFinite()) it else 0.0 }
      return SectionPlaneState(true, doubleArrayOf(1.0, 0.0, 0.0), cx, true)
    }
    val m =
      SECTION_REGEX.matchEntire(s)
        ?: return SectionPlaneState(false, doubleArrayOf(1.0, 0.0, 0.0), 0.0, false)
    val axisToken = m.groupValues[1]
    val sign = if (axisToken.startsWith("-")) -1.0 else 1.0
    val axisChar = axisToken.trimStart('+', '-')
    val value =
      XRSpatialMath.clampNum(m.groupValues[2].toDoubleOrNull() ?: Double.NaN, -1000.0, 1000.0, 0.0)
    val normal =
      when (axisChar) {
        "x" -> doubleArrayOf(sign, 0.0, 0.0)
        "y" -> doubleArrayOf(0.0, sign, 0.0)
        else -> doubleArrayOf(0.0, 0.0, sign)
      }
    return SectionPlaneState(true, normal, value * sign, false)
  }

  /** Builds a 4-bar rectangular gizmo frame in the XY plane facing `+Z`. */
  @JvmStatic
  @JvmOverloads
  fun buildSectionGizmoGeometry(halfExtent: Double = 0.35): SpatialMeasure.MeshGeometry {
    val h = Math.max(0.05, halfExtent)
    val c0 = doubleArrayOf(-h, -h, 0.0)
    val c1 = doubleArrayOf(h, -h, 0.0)
    val c2 = doubleArrayOf(h, h, 0.0)
    val c3 = doubleArrayOf(-h, h, 0.0)
    return SpatialMeasure.buildSegmentBarsGeometry(
      listOf(c0 to c1, c1 to c2, c2 to c3, c3 to c0),
      Math.max(0.002, h * 0.012),
    )
  }
}
