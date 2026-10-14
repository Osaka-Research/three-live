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

  /// Maximum size of a `detections` JSON string, in UTF-16 code units (same as web).
  public static let maxDetectionsJSONChars = 16 * 1024

  /// Parses a `detections` JSON string (`[{label, box: [ymin, xmin, ymax, xmax]}]`, 0…1 or Gemini
  /// 0…1000; `box_2d` is accepted as an alias) into at most `WorldUnderstanding.maxDetections`
  /// boxes. Malformed entries are skipped; malformed or oversized input yields `[]`. Mirrors web
  /// `parseDetections`.
  public static func parse(json: String?) -> [Box] {
    guard let json = json, !json.isEmpty, json.utf16.count <= maxDetectionsJSONChars,
      let data = json.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data, options: [])
    else { return [] }
    return fromList(root)
  }

  /// Validates an already-parsed detection list (e.g. Gemini `report_objects` tool arguments,
  /// which are untrusted model output) with the same rules as `parse(json:)`.
  public static func fromList(_ raw: Any?) -> [Box] {
    guard let root = raw as? [Any] else { return [] }
    var out: [Box] = []
    for item in root {
      if out.count >= WorldUnderstanding.maxDetections { break }
      guard let rec = item as? [String: Any] else { continue }
      guard let raw = (rec["box"] as? [Any]) ?? (rec["box_2d"] as? [Any]), raw.count >= 4 else {
        continue
      }
      var nums: [Float] = []
      for value in raw.prefix(4) {
        guard let n = value as? NSNumber else { break }
        let d = n.doubleValue
        guard d.isFinite else { break }
        nums.append(Float(d))
      }
      guard nums.count == 4 else { continue }
      let label = (rec["label"] as? String).map { String($0.prefix(256)) } ?? ""
      out.append(Box(box: nums, label: label))
    }
    return out
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
