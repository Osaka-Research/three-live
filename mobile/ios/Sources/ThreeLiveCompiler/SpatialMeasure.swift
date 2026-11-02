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

/// Pure math and 3D vector geometry builders for `spatial-measure` (`spatial-measure.ts`).
public enum SpatialMeasure {
  public static let calloutOffsetMeters: Float = 0.04
  public static let calloutTickHalfMeters: Float = 0.015
  public static let maxTapeSegments = 16
  public static let maxDimensionLabels = 32
  private static let metersPerInch: Double = 0.0254

  public struct WorldBounds: Sendable, Equatable {
    public var min: SIMD3<Float>
    public var max: SIMD3<Float>
    public var size: SIMD3<Float>
    public var center: SIMD3<Float> { (min + max) * 0.5 }
  }

  public struct Callout: Sendable, Equatable {
    public var axis: String
    public var start: SIMD3<Float>
    public var end: SIMD3<Float>
    public var tickStartA: SIMD3<Float>
    public var tickStartB: SIMD3<Float>
    public var tickEndA: SIMD3<Float>
    public var tickEndB: SIMD3<Float>
    public var labelPosition: SIMD3<Float>
    public var lengthMeters: Float
  }

  /// Formats a metric distance in meters using `"m"`, `"cm"`, `"mm"`, `"in"`, `"ft-in"`, or `"auto"`.
  public static func formatDimension(_ meters: Float, unit: String = "auto") -> String {
    let d = (meters.isFinite && meters >= 0) ? Double(meters) : 0.0
    let resolved = unit == "auto" ? (d < 1.0 ? "cm" : "m") : unit
    switch resolved {
    case "mm":
      return "\(Int((d * 1000.0).rounded())) mm"
    case "cm":
      return String(format: "%.1f cm", locale: Locale(identifier: "en_US_POSIX"), d * 100.0)
    case "in":
      return String(format: "%.1f in", locale: Locale(identifier: "en_US_POSIX"), d / metersPerInch)
    case "ft-in":
      let totalInches = d / metersPerInch
      var feet = Int(floor(totalInches / 12.0))
      var inches = ((totalInches - Double(feet) * 12.0) * 10.0).rounded() / 10.0
      if inches >= 12.0 {
        feet += 1
        inches = 0.0
      }
      return String(format: "%d' %.1f\"", locale: Locale(identifier: "en_US_POSIX"), feet, inches)
    default:
      return String(format: "%.2f m", locale: Locale(identifier: "en_US_POSIX"), d)
    }
  }

  /// Computes the world-space AABB of `[localMin, localMax]` transformed by column-major `worldMatrix`.
  public static func computeWorldBounds(
    localMin: SIMD3<Float>, localMax: SIMD3<Float>, worldMatrix m: simd_float4x4
  ) -> WorldBounds {
    var mn = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
    var mx = mn
    let cols = [m.columns.0, m.columns.1, m.columns.2]
    let lo = [localMin.x, localMin.y, localMin.z]
    let hi = [localMax.x, localMax.y, localMax.z]
    for col in 0..<3 {
      let c = SIMD3<Float>(cols[col].x, cols[col].y, cols[col].z)
      let a = c * lo[col]
      let b = c * hi[col]
      mn += simd_min(a, b)
      mx += simd_max(a, b)
    }
    if !mn.x.isFinite || !mn.y.isFinite || !mn.z.isFinite || !mx.x.isFinite || !mx.y.isFinite
      || !mx.z.isFinite
    {
      return WorldBounds(
        min: SIMD3<Float>(-0.5, -0.5, -0.5),
        max: SIMD3<Float>(0.5, 0.5, 0.5),
        size: SIMD3<Float>(1, 1, 1)
      )
    }
    return WorldBounds(min: mn, max: mx, size: simd_max(.zero, mx - mn))
  }

  /// Builds world-space dimension callout descriptors along `axes` outside `[min, max]`.
  public static func buildDimensionCallouts(
    min mn: SIMD3<Float>,
    max mx: SIMD3<Float>,
    axes: [String] = ["x", "y", "z"],
    offset: Float = calloutOffsetMeters,
    tickHalf: Float = calloutTickHalfMeters
  ) -> [Callout] {
    let off = offset.isFinite ? Swift.max(0.005, offset) : calloutOffsetMeters
    let tick = tickHalf.isFinite ? Swift.max(0.003, tickHalf) : calloutTickHalfMeters
    var out: [Callout] = []
    for axis in axes {
      switch axis {
      case "x":
        let len = Swift.max(0, mx.x - mn.x)
        let y = mn.y - off * 0.5
        let z = mx.z + off
        out.append(
          Callout(
            axis: "x",
            start: SIMD3<Float>(mn.x, y, z),
            end: SIMD3<Float>(mx.x, y, z),
            tickStartA: SIMD3<Float>(mn.x, y - tick, z),
            tickStartB: SIMD3<Float>(mn.x, y + tick, z),
            tickEndA: SIMD3<Float>(mx.x, y - tick, z),
            tickEndB: SIMD3<Float>(mx.x, y + tick, z),
            labelPosition: SIMD3<Float>((mn.x + mx.x) * 0.5, y - tick * 1.8, z),
            lengthMeters: len
          ))
      case "y":
        let len = Swift.max(0, mx.y - mn.y)
        let x = mx.x + off
        let z = mx.z + off
        out.append(
          Callout(
            axis: "y",
            start: SIMD3<Float>(x, mn.y, z),
            end: SIMD3<Float>(x, mx.y, z),
            tickStartA: SIMD3<Float>(x - tick, mn.y, z),
            tickStartB: SIMD3<Float>(x + tick, mn.y, z),
            tickEndA: SIMD3<Float>(x - tick, mx.y, z),
            tickEndB: SIMD3<Float>(x + tick, mx.y, z),
            labelPosition: SIMD3<Float>(x + tick * 2.4, (mn.y + mx.y) * 0.5, z),
            lengthMeters: len
          ))
      case "z":
        let len = Swift.max(0, mx.z - mn.z)
        let x = mx.x + off
        let y = mn.y - off * 0.5
        out.append(
          Callout(
            axis: "z",
            start: SIMD3<Float>(x, y, mn.z),
            end: SIMD3<Float>(x, y, mx.z),
            tickStartA: SIMD3<Float>(x - tick, y, mn.z),
            tickStartB: SIMD3<Float>(x + tick, y, mn.z),
            tickEndA: SIMD3<Float>(x - tick, y, mx.z),
            tickEndB: SIMD3<Float>(x + tick, y, mx.z),
            labelPosition: SIMD3<Float>(x + tick * 2.4, y, (mn.z + mx.z) * 0.5),
            lengthMeters: len
          ))
      default:
        break
      }
    }
    return out
  }

  private static let glyphStrokes: [Character: [(Float, Float, Float, Float)]] = [
    "0": [(0.1, 0, 0.9, 0), (0.9, 0, 0.9, 1), (0.9, 1, 0.1, 1), (0.1, 1, 0.1, 0)],
    "1": [(0.5, 0, 0.5, 1), (0.25, 0.8, 0.5, 1), (0.2, 0, 0.8, 0)],
    "2": [(0.1, 1, 0.9, 1), (0.9, 1, 0.9, 0.5), (0.9, 0.5, 0.1, 0.5), (0.1, 0.5, 0.1, 0), (0.1, 0, 0.9, 0)],
    "3": [(0.1, 1, 0.9, 1), (0.9, 1, 0.9, 0), (0.1, 0.5, 0.9, 0.5), (0.1, 0, 0.9, 0)],
    "4": [(0.1, 1, 0.1, 0.5), (0.1, 0.5, 0.9, 0.5), (0.8, 1, 0.8, 0)],
    "5": [(0.9, 1, 0.1, 1), (0.1, 1, 0.1, 0.5), (0.1, 0.5, 0.9, 0.5), (0.9, 0.5, 0.9, 0), (0.9, 0, 0.1, 0)],
    "6": [(0.9, 1, 0.1, 1), (0.1, 1, 0.1, 0), (0.1, 0, 0.9, 0), (0.9, 0, 0.9, 0.5), (0.9, 0.5, 0.1, 0.5)],
    "7": [(0.1, 1, 0.9, 1), (0.9, 1, 0.4, 0)],
    "8": [(0.1, 0, 0.9, 0), (0.9, 0, 0.9, 1), (0.9, 1, 0.1, 1), (0.1, 1, 0.1, 0), (0.1, 0.5, 0.9, 0.5)],
    "9": [(0.1, 0, 0.9, 0), (0.9, 0, 0.9, 1), (0.9, 1, 0.1, 1), (0.1, 1, 0.1, 0.5), (0.1, 0.5, 0.9, 0.5)],
    ".": [(0.4, 0, 0.6, 0), (0.5, 0, 0.5, 0.15)],
    "-": [(0.15, 0.5, 0.85, 0.5)],
    "'": [(0.5, 1, 0.45, 0.68)],
    "\"": [(0.32, 1, 0.28, 0.68), (0.68, 1, 0.64, 0.68)],
    "c": [(0.85, 0.6, 0.15, 0.6), (0.15, 0.6, 0.15, 0), (0.15, 0, 0.85, 0)],
    "m": [(0.08, 0, 0.08, 0.6), (0.08, 0.6, 0.5, 0.6), (0.5, 0.6, 0.5, 0), (0.5, 0.6, 0.92, 0.6), (0.92, 0.6, 0.92, 0)],
    "i": [(0.5, 0, 0.5, 0.58), (0.5, 0.76, 0.5, 0.9)],
    "n": [(0.15, 0, 0.15, 0.6), (0.15, 0.6, 0.85, 0.6), (0.85, 0.6, 0.85, 0)],
  ]

  /// Generates double-sided 3D vector-stroke label geometry centered at `(0, 0, 0)` facing `+Z`.
  public static func buildVectorLabelGeometry(
    _ text: String, charHeight: Float = 0.028, strokeWidth: Float = 0.0038
  ) -> XRGeneratedGeometry {
    let clean = String(text.prefix(32))
    let h = max(0.004, charHeight)
    let w = h * 0.62
    let advance = w * 1.28
    let halfStroke = max(0.0005, strokeWidth * 0.5)
    var quads: [(Float, Float, Float, Float)] = []
    var cursorX: Float = 0
    for ch in clean {
      if ch == " " {
        cursorX += advance * 0.65
        continue
      }
      let lower = Character(String(ch).lowercased())
      if let strokes = glyphStrokes[ch] ?? glyphStrokes[lower] {
        for (x0, y0, x1, y1) in strokes {
          quads.append((cursorX + x0 * w, y0 * h, cursorX + x1 * w, y1 * h))
        }
      }
      cursorX += (ch == "." || ch == "'") ? advance * 0.55 : advance
    }
    guard !quads.isEmpty else {
      return XRGeneratedGeometry(positions: [], normals: [], indices: [])
    }
    let totalWidth = max(0, cursorX - advance * 0.28)
    let offsetX = -totalWidth * 0.5
    let offsetY = -h * 0.5
    var positions: [Float] = []
    var normals: [Float] = []
    var indices: [UInt32] = []
    positions.reserveCapacity(quads.count * 24)
    normals.reserveCapacity(quads.count * 24)
    indices.reserveCapacity(quads.count * 12)
    var v: UInt32 = 0
    for (ax, ay, bx, by) in quads {
      let dx = bx - ax
      let dy = by - ay
      let len = max(1e-6, hypot(dx, dy))
      let nx = (-dy / len) * halfStroke
      let ny = (dx / len) * halfStroke
      let ex = (dx / len) * halfStroke * 0.5
      let ey = (dy / len) * halfStroke * 0.5
      let x0 = ax - ex + offsetX
      let y0 = ay - ey + offsetY
      let x1 = bx + ex + offsetX
      let y1 = by + ey + offsetY
      let pts = [(x0 - nx, y0 - ny), (x1 - nx, y1 - ny), (x1 + nx, y1 + ny), (x0 + nx, y0 + ny)]
      let frontBase = v
      for (px, py) in pts {
        positions.append(contentsOf: [px, py, 0.0005])
        normals.append(contentsOf: [0, 0, 1])
        v += 1
      }
      indices.append(contentsOf: [
        frontBase, frontBase + 1, frontBase + 2, frontBase, frontBase + 2, frontBase + 3,
      ])
      let backBase = v
      for (px, py) in pts {
        positions.append(contentsOf: [px, py, -0.0005])
        normals.append(contentsOf: [0, 0, -1])
        v += 1
      }
      indices.append(contentsOf: [
        backBase, backBase + 2, backBase + 1, backBase, backBase + 3, backBase + 2,
      ])
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }

  /// Generates a batched 3D rectangular-bar mesh from `(start, end)` segment pairs.
  public static func buildSegmentBarsGeometry(
    _ segments: [(SIMD3<Float>, SIMD3<Float>)], halfThickness: Float = 0.002
  ) -> XRGeneratedGeometry {
    let valid = segments.filter { simd_length($0.1 - $0.0) > 1e-5 }
    guard !valid.isEmpty else {
      return XRGeneratedGeometry(positions: [], normals: [], indices: [])
    }
    let r = max(0.0005, halfThickness)
    let corners: [(Float, Float)] = [(-1, -1), (1, -1), (1, 1), (-1, 1)]
    var positions: [Float] = []
    var normals: [Float] = []
    var indices: [UInt32] = []
    positions.reserveCapacity(valid.count * 72)
    normals.reserveCapacity(valid.count * 72)
    indices.reserveCapacity(valid.count * 36)
    var vOut: UInt32 = 0
    for (a, b) in valid {
      let mid = (a + b) * 0.5
      let diff = b - a
      let halfLen = simd_length(diff) * 0.5
      let t = XRSpatialMath.normalize(diff, fallback: SIMD3<Float>(1, 0, 0))
      let ref: SIMD3<Float> = abs(t.y) < 0.9 ? SIMD3<Float>(0, 1, 0) : SIMD3<Float>(1, 0, 0)
      let u = XRSpatialMath.normalize(simd_cross(t, ref), fallback: SIMD3<Float>(0, 0, 1))
      let v = XRSpatialMath.normalize(simd_cross(t, u), fallback: SIMD3<Float>(0, 1, 0))
      let faces: [(SIMD3<Float>, SIMD3<Float>, SIMD3<Float>, Float, Float, Float)] = [
        (t, u, v, halfLen, r, r),
        (-t, u, -v, halfLen, r, r),
        (u, v, t, r, r, halfLen),
        (-u, v, -t, r, r, halfLen),
        (v, t, u, r, halfLen, r),
        (-v, -t, u, r, halfLen, r),
      ]
      for (fn, fu, fv, dn, du, dv) in faces {
        let base = vOut
        for (su, sv) in corners {
          let p = mid + fn * dn + fu * (du * su) + fv * (dv * sv)
          positions.append(contentsOf: [p.x, p.y, p.z])
          normals.append(contentsOf: [fn.x, fn.y, fn.z])
          vOut += 1
        }
        indices.append(contentsOf: [base, base + 1, base + 2, base, base + 2, base + 3])
      }
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }

  /// Subdivides `[start, end]` into alternating dash segments for leader lines.
  public static func buildDashedSegments(
    start: SIMD3<Float>,
    end: SIMD3<Float>,
    dashLength: Float = 0.025,
    gapLength: Float = 0.015
  ) -> [(SIMD3<Float>, SIMD3<Float>)] {
    let total = simd_length(end - start)
    guard total > 1e-4 else { return [] }
    let dash = max(0.004, dashLength)
    let gap = max(0.002, gapLength)
    let stride = dash + gap
    var out: [(SIMD3<Float>, SIMD3<Float>)] = []
    var d: Float = 0
    while d < total && out.count < 128 {
      let t0 = d / total
      let t1 = min(1, (d + dash) / total)
      let p0 = start + (end - start) * t0
      let p1 = start + (end - start) * t1
      if simd_length(p1 - p0) > 1e-4 { out.append((p0, p1)) }
      d += stride
    }
    return out
  }
}

// MARK: - Magnetic Snap
