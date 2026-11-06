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

// Distance-based Level-of-Detail (`lod` / `MSFT_lod`) controller and selector for iOS / visionOS
// RealityKit (port of `three-live/src/plugins/lod.ts` and `LodController.kt`).

import Foundation

public enum XRLiveLodController {
  /// Pure function that selects the active 0-based LOD level index for a given camera-to-node
  /// `distance` in meters, or `-1` when culled beyond `cullDistance`.
  ///
  /// Supports both:
  /// - `distances[0] == 0.0` (`[0.0, 3.0, 8.0]` for 3 children: `<3 -> 0`, `[3,8) -> 1`, `>=8 -> 2`)
  /// - `distances[0] > 0.0` (`[3.0, 8.0]` switch thresholds for 3 children: `<3 -> 0`, `[3,8) -> 1`, `>=8 -> 2`)
  public static func selectLodLevelIndex(
    distance: Float,
    distances: [Float],
    cullDistance: Float? = nil,
    currentLevel: Int = -1,
    hysteresis: Float = 0.0
  ) -> Int {
    guard !distances.isEmpty else { return -1 }
    let d = (distance.isFinite && distance >= 0) ? distance : 0
    let hyst = (hysteresis.isFinite && hysteresis > 0) ? Swift.min(hysteresis, 0.5) : 0

    if let cull = cullDistance, cull.isFinite, cull > 0 {
      let cullThreshold = (currentLevel == -1) ? cull * (1.0 - hyst) : cull * (1.0 + hyst)
      if d > cullThreshold { return -1 }
    }

    let startsAtZero = distances[0] <= 1e-4
    var rawIdx = 0
    if startsAtZero {
      for i in 0..<distances.count {
        if d >= distances[i] { rawIdx = i } else { break }
      }
    } else {
      for i in 0..<distances.count {
        if d >= distances[i] { rawIdx = i + 1 } else { break }
      }
    }

    if currentLevel < 0 || hyst <= 0 || rawIdx == currentLevel {
      return rawIdx
    }

    func thresholdForLevel(_ lvl: Int) -> Float {
      if lvl <= 0 { return 0 }
      if startsAtZero {
        return distances[Swift.min(lvl, distances.count - 1)]
      } else {
        return distances[Swift.min(lvl - 1, distances.count - 1)]
      }
    }

    if rawIdx > currentLevel {
      let boundary = thresholdForLevel(currentLevel + 1)
      if d < boundary * (1.0 + hyst) { return currentLevel }
    } else if rawIdx < currentLevel {
      let boundary = thresholdForLevel(currentLevel)
      if d > boundary * (1.0 - hyst) { return currentLevel }
    }

    return rawIdx
  }

  /// Convenience overload accepting `Double` distances and `currentIndex` label.
  public static func selectLodLevelIndex(
    distance: Double,
    distances: [Double],
    cullDistance: Double? = nil,
    currentIndex: Int = -1,
    hysteresis: Double = 0.0
  ) -> Int {
    selectLodLevelIndex(
      distance: Float(distance),
      distances: distances.map { Float($0) },
      cullDistance: cullDistance.map { Float($0) },
      currentLevel: currentIndex,
      hysteresis: Float(hysteresis)
    )
  }
}
