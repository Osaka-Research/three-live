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
 * Distance-based Level-of-Detail (`lod` / `MSFT_lod`) controller and selector for Android XR and
 * Filament (port of `three-live/src/plugins/lod.ts`).
 */
object LodController {

  /**
   * Pure function that selects the active 0-based LOD level index for a given camera-to-node
   * [distance] in meters, or `-1` when culled beyond [cullDistance].
   *
   * Supports both:
   * - `distances[0] == 0.0` (e.g. `[0.0, 3.0, 8.0]` for 3 children: `<3 -> 0`, `[3,8) -> 1`, `>=8
   *   -> 2`)
   * - `distances[0] > 0.0` (e.g. `[3.0, 8.0]` switch thresholds for 3 children: `<3 -> 0`, `[3,8)
   *   -> 1`, `>=8 -> 2`)
   */
  @JvmStatic
  @JvmOverloads
  fun selectLodLevelIndex(
    distance: Double,
    distances: List<Double>,
    cullDistance: Double? = null,
    currentLevel: Int = -1,
    hysteresis: Double = 0.0,
  ): Int {
    if (distances.isEmpty()) return -1
    val d = if (distance.isFinite() && distance >= 0.0) distance else 0.0
    val hyst = if (hysteresis.isFinite() && hysteresis > 0.0) Math.min(hysteresis, 0.5) else 0.0

    if (cullDistance != null && cullDistance.isFinite() && cullDistance > 0.0) {
      val cullThreshold =
        if (currentLevel == -1) cullDistance * (1.0 - hyst) else cullDistance * (1.0 + hyst)
      if (d > cullThreshold) return -1
    }

    val startsAtZero = distances[0] <= 1e-4
    var rawIdx = 0
    if (startsAtZero) {
      for (i in distances.indices) {
        if (d >= distances[i]) rawIdx = i else break
      }
    } else {
      for (i in distances.indices) {
        if (d >= distances[i]) rawIdx = i + 1 else break
      }
    }

    if (currentLevel < 0 || hyst <= 0.0 || rawIdx == currentLevel) {
      return rawIdx
    }

    fun thresholdForLevel(lvl: Int): Double {
      if (lvl <= 0) return 0.0
      return if (startsAtZero) {
        distances[Math.min(lvl, distances.size - 1)]
      } else {
        distances[Math.min(lvl - 1, distances.size - 1)]
      }
    }

    if (rawIdx > currentLevel) {
      val boundary = thresholdForLevel(currentLevel + 1)
      if (d < boundary * (1.0 + hyst)) return currentLevel
    } else if (rawIdx < currentLevel) {
      val boundary = thresholdForLevel(currentLevel)
      if (d > boundary * (1.0 - hyst)) return currentLevel
    }

    return rawIdx
  }
}
