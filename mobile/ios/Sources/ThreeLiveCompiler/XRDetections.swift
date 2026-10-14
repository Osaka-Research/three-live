// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import Foundation
import simd

/// Batch 2D → 3D detection unprojection for `onObjectDetected` (sensor-agnostic).
public enum XRDetections {
  /// One 2D detection: `box` is `[ymin, xmin, ymax, xmax]`, normalized 0…1 or 0…1000.
  public struct Box: Sendable, Equatable {
    public var box: [Float]
    public var label: String

    public init(box: [Float], label: String = "") {
      self.box = box
      self.label = label
    }
  }

  /// Unprojects up to `WorldUnderstanding.maxDetections` boxes. `depthSampler` optionally returns
  /// view-space depth (meters) at normalized `(u, v)` (e.g. from `ARFrame.sceneDepth`); otherwise
  /// `planes` are ray-tested, then `WorldUnderstanding.fallbackDepthMeters` is used (as on web).
  public static func detect(
    _ boxes: [Box], cameraWorld: simd_float4x4, projection: simd_float4x4,
    depthSampler: ((_ u: Float, _ v: Float) -> Float?)? = nil,
    planes: [WorldUnderstanding.TrackedPlane] = []
  ) -> [WorldUnderstanding.Detection3D] {
    var out: [WorldUnderstanding.Detection3D] = []
    for b in boxes.prefix(WorldUnderstanding.maxDetections) {
      guard let nb = WorldUnderstanding.normalizeBox(b.box) else { continue }
      let u = (nb.y + nb.w) * 0.5
      let v = (nb.x + nb.z) * 0.5
      let depth = depthSampler?(u, v)
      if let d = WorldUnderstanding.unprojectDetection(
        box: b.box, label: String(b.label.prefix(256)), cameraWorld: cameraWorld, projection: projection,
        depthMeters: depth, planes: planes)
      {
        out.append(d)
      }
    }
    return out
  }
}
