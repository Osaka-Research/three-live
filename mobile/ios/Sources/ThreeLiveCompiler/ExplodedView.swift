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

import Foundation
import simd

/// Pure math and gizmo geometry builder for `exploded-view` (`exploded-view.ts`).
public enum ExplodedView {
  public static let twoHandSpanMeters: Float = 0.4
  private static let modes: Set<String> = [
    "radial", "axial-x", "axial-y", "axial-z", "hierarchical",
  ]

  public struct SectionPlaneState: Sendable, Equatable {
    public var enabled: Bool
    public var normal: SIMD3<Float>
    public var constant: Float
    public var interactive: Bool

    public init(
      enabled: Bool, normal: SIMD3<Float>, constant: Float, interactive: Bool
    ) {
      self.enabled = enabled
      self.normal = normal
      self.constant = constant
      self.interactive = interactive
    }
  }

  /// Computes staggered smoothstep layer progress `t_L` in `[0..1]`.
  public static func computeLayerFactor(factor: Float, layer: Int, maxLayer: Int) -> Float {
    let f = Float(XRJSON.clampNum(Double(factor), 0, 1, 0))
    if f <= 0 { return 0 }
    if f >= 1 { return 1 }
    let maxL = max(1, min(10, maxLayer))
    if maxL <= 1 { return f * f * (3 - 2 * f) }
    let clampedL = max(1, min(maxL, layer))
    let stagger: Float = 0.35
    let span = 1 / (1 + Float(maxL - 1) * stagger)
    let start = Float(clampedL - 1) * stagger * span
    let u = max(0, min(1, (f - start) / span))
    return u * u * (3 - 2 * u)
  }

  /// Computes the local/scene-space displacement offset for one assembly part.
  public static func computeNodeOffset(
    restPosition: SIMD3<Float>,
    assemblyCenter: SIMD3<Float>,
    assemblyRadius: Float,
    factor: Float,
    mode: String = "radial",
    explodeScale: Float = 1.5,
    trait: XRLiveExplode? = nil,
    maxLayer: Int = 1,
    nodeIndex: Int = 0,
    nodeCount: Int = 1,
    hierarchyDepth: Int = 1
  ) -> SIMD3<Float> {
    let f = Float(XRJSON.clampNum(Double(factor), 0, 1, 0))
    if f <= 1e-6 { return .zero }
    let resolvedMode = modes.contains(mode) ? mode : "radial"
    let scale = Float(XRJSON.clampNum(Double(explodeScale), 0, 10, 1.5))
    let radius = max(0.05, assemblyRadius.isFinite ? assemblyRadius : 0.5)
    let layer = trait?.layer ?? 1
    let tL = computeLayerFactor(factor: f, layer: layer, maxLayer: max(layer, maxLayer))
    if tL <= 1e-6 { return .zero }

    let rel = restPosition - assemblyCenter
    let relDist = simd_length(rel)
    let dir: SIMD3<Float>
    let maxDist: Float

    if let customDir = trait?.direction {
      dir = XRSpatialMath.normalize(customDir, fallback: SIMD3<Float>(0, 1, 0))
      maxDist = (trait?.distance ?? 0.35) * scale
    } else {
      let count = max(1, nodeCount)
      let spreadSlot = count > 1 ? (Float(nodeIndex) / Float(count - 1)) * 2 - 1 : 0
      switch resolvedMode {
      case "axial-x", "axial-y", "axial-z":
        let axisIdx = resolvedMode == "axial-x" ? 0 : (resolvedMode == "axial-y" ? 1 : 2)
        let comp = rel[axisIdx]
        let sign: Float = abs(comp) > 1e-4 ? (comp >= 0 ? 1 : -1) : (spreadSlot >= 0 ? 1 : -1)
        var axisDir = SIMD3<Float>.zero
        axisDir[axisIdx] = sign
        dir = axisDir
        let weight = abs(comp) > 1e-4 ? abs(comp) / radius : abs(spreadSlot) * 0.6 + 0.25
        maxDist = (trait?.distance ?? (radius * max(0.2, weight))) * scale
      case "hierarchical":
        let depth = max(1, hierarchyDepth)
        if relDist > 1e-4 {
          dir = rel / relDist
        } else {
          let angle = (Float(nodeIndex) / Float(count)) * .pi * 2
          dir = XRSpatialMath.normalize(
            SIMD3<Float>(cos(angle), 0.35, sin(angle)), fallback: SIMD3<Float>(0, 1, 0))
        }
        let depthWeight = 0.35 + 0.3 * Float(min(4, depth))
        maxDist = (trait?.distance ?? (radius * depthWeight)) * scale
      default:
        if relDist > 1e-4 {
          dir = rel / relDist
          let shellWeight = max(0.25, min(1.6, relDist / radius + 0.25))
          maxDist = (trait?.distance ?? (radius * shellWeight)) * scale
        } else {
          let angle = (Float(nodeIndex) / Float(count)) * .pi * 2
          dir = XRSpatialMath.normalize(
            SIMD3<Float>(cos(angle), 0.25 * spreadSlot, sin(angle)), fallback: SIMD3<Float>(0, 1, 0)
          )
          maxDist = (trait?.distance ?? (radius * 0.35)) * scale
        }
      }
    }
    return dir * (tL * maxDist)
  }

  /// Maps a two-hand spread gesture (`startDistance -> currentDistance`) to `[-1..1]`.
  public static func computeTwoHandDelta(
    startDistance: Float,
    currentDistance: Float,
    spanMeters: Float = twoHandSpanMeters
  ) -> Float {
    guard startDistance.isFinite, currentDistance.isFinite else { return 0 }
    let span = max(0.05, spanMeters)
    return max(-1, min(1, (currentDistance - startDistance) / span))
  }

  /// Parses a `section-plane` spec (`"none"`, `"x:0.2"`, `"y:0.0"`, `"-z:0.1"`, `"interactive"`).
  public static func parseSectionPlane(
    _ raw: String?,
    defaultCenter: SIMD3<Float> = .zero
  ) -> SectionPlaneState {
    let s = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if s.isEmpty || s == "none" || s == "false" {
      return SectionPlaneState(
        enabled: false, normal: SIMD3<Float>(1, 0, 0), constant: 0, interactive: false)
    }
    if s == "interactive" {
      let cx = defaultCenter.x.isFinite ? defaultCenter.x : 0
      return SectionPlaneState(
        enabled: true, normal: SIMD3<Float>(1, 0, 0), constant: cx, interactive: true)
    }
    let parts = s.split(separator: ":", maxSplits: 1).map {
      $0.trimmingCharacters(in: .whitespaces)
    }
    guard parts.count == 2, let rawVal = Double(parts[1]), rawVal.isFinite else {
      return SectionPlaneState(
        enabled: false, normal: SIMD3<Float>(1, 0, 0), constant: 0, interactive: false)
    }
    let axisToken = parts[0]
    let sign: Float = axisToken.hasPrefix("-") ? -1 : 1
    let axisChar = axisToken.trimmingCharacters(in: CharacterSet(charactersIn: "+-"))
    let val = Float(XRJSON.clampNum(rawVal, -1000, 1000, 0))
    let normal: SIMD3<Float>
    switch axisChar {
    case "x": normal = SIMD3<Float>(sign, 0, 0)
    case "y": normal = SIMD3<Float>(0, sign, 0)
    case "z": normal = SIMD3<Float>(0, 0, sign)
    default:
      return SectionPlaneState(
        enabled: false, normal: SIMD3<Float>(1, 0, 0), constant: 0, interactive: false)
    }
    return SectionPlaneState(
      enabled: true, normal: normal, constant: val * sign, interactive: false)
  }

  /// Builds a 4-bar rectangular gizmo frame in the XY plane facing `+Z`.
  public static func buildSectionGizmoGeometry(halfExtent: Float = 0.35) -> XRGeneratedGeometry {
    let h = max(0.05, halfExtent)
    let c0 = SIMD3<Float>(-h, -h, 0)
    let c1 = SIMD3<Float>(h, -h, 0)
    let c2 = SIMD3<Float>(h, h, 0)
    let c3 = SIMD3<Float>(-h, h, 0)
    return SpatialMeasure.buildSegmentBarsGeometry(
      [(c0, c1), (c1, c2), (c2, c3), (c3, c0)],
      halfThickness: max(0.002, h * 0.012)
    )
  }
}
