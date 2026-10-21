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

// Platform-neutral ports of the XR Blocks geometry generators:
// - xr-live/src/plugins/spatial-paint.ts (TubeStrokeBuilder)
// - xr-live/src/plugins/depth-particles.ts (ParticleEmitter, mulberry32)
// Buffer layouts and counts match the web implementation exactly so strokes and particle
// meshes can be exchanged between platforms.

import Foundation
import simd

// MARK: - Tube strokes

/// CPU geometry for a generated mesh (flat `xyz` arrays plus triangle indices).
public struct XRGeneratedGeometry: Sendable, Equatable {
  public var positions: [Float]
  public var normals: [Float]
  public var indices: [UInt32]

  /// Number of vertices (`positions.count / 3`).
  public var vertexCount: Int { positions.count / 3 }
}

/// Accumulates 3D stroke points and builds a smoothed, capped tube mesh.
///
/// Uniform Catmull-Rom smoothing (`samplesPerSpan` samples per span), rotation-minimizing
/// frames via double reflection, `radialSegments` sides, and flat caps built from duplicated
/// rings with axial normals. Mirrors `TubeStrokeBuilder` in `spatial-paint.ts`.
public struct TubeStrokeBuilder: Sendable {
  /// Maximum raw input points retained per stroke.
  public static let maxStrokePoints = 2048

  public private(set) var points: [SIMD3<Float>] = []
  public let radius: Float
  public let radialSegments: Int
  public let samplesPerSpan: Int
  public let minSpacing: Float

  /// Creates a builder; options are clamped like the web implementation.
  public init(
    radius: Float = 0.006, radialSegments: Int = 8, samplesPerSpan: Int = 4,
    minSpacing: Float = 0.004
  ) {
    self.radius = XRBlocksMath.clamp(radius, 0.0005, 0.25, fallback: 0.006)
    self.radialSegments = min(32, max(3, radialSegments))
    self.samplesPerSpan = min(16, max(1, samplesPerSpan))
    self.minSpacing = XRBlocksMath.clamp(minSpacing, 0, 0.5, fallback: 0.004)
  }

  /// Evaluates a uniform Catmull-Rom spline segment between `p1` and `p2`.
  public static func catmullRom(
    _ p0: SIMD3<Float>, _ p1: SIMD3<Float>, _ p2: SIMD3<Float>, _ p3: SIMD3<Float>, t: Float
  ) -> SIMD3<Float> {
    let t2 = t * t
    let t3 = t2 * t
    let a: SIMD3<Float> = p1 * Float(2)
    let b: SIMD3<Float> = (p2 - p0) * t
    var c: SIMD3<Float> = p0 * Float(2)
    c -= p1 * Float(5)
    c += p2 * Float(4)
    c -= p3
    var d: SIMD3<Float> = p1 * Float(3)
    d -= p0
    d -= p2 * Float(3)
    d += p3
    let sum: SIMD3<Float> = a + b + c * t2 + d * t3
    return sum * Float(0.5)
  }

  /// Adds a point, ignoring non-finite input, points closer than `minSpacing` to the previous
  /// point, and points beyond `maxStrokePoints`. Returns whether the point was accepted.
  @discardableResult
  public mutating func addPoint(_ p: SIMD3<Float>) -> Bool {
    guard p.x.isFinite, p.y.isFinite, p.z.isFinite else { return false }
    if points.count >= Self.maxStrokePoints { return false }
    if let last = points.last, simd_length(p - last) < minSpacing { return false }
    points.append(p)
    return true
  }

  /// Polyline length of the raw points in meters.
  public var lengthMeters: Float {
    var len: Float = 0
    var i = 1
    while i < points.count {
      len += simd_length(points[i] - points[i - 1])
      i += 1
    }
    return len
  }

  /// Returns the Catmull-Rom-smoothed centerline (`(points - 1) * samplesPerSpan + 1`
  /// samples for three or more points).
  public func smoothedPoints() -> [SIMD3<Float>] {
    let pts = points
    if pts.count < 3 { return pts }
    var out: [SIMD3<Float>] = []
    out.reserveCapacity((pts.count - 1) * samplesPerSpan + 1)
    for i in 0..<(pts.count - 1) {
      let p0 = pts[max(0, i - 1)]
      let p3 = pts[min(pts.count - 1, i + 2)]
      for s in 0..<samplesPerSpan {
        out.append(
          Self.catmullRom(p0, pts[i], pts[i + 1], p3, t: Float(s) / Float(samplesPerSpan)))
      }
    }
    out.append(pts[pts.count - 1])
    return out
  }

  /// Builds the tube geometry (with end caps). Returns `nil` for fewer than two points.
  ///
  /// Layout: `n * radialSegments` side-ring vertices, then the start and end cap rings
  /// (duplicated with axial normals), then the start and end cap centers.
  public func build() -> XRGeneratedGeometry? {
    let center = smoothedPoints()
    if center.count < 2 { return nil }
    let n = center.count
    let radial = radialSegments
    let ringVerts = n * radial
    let vertexCount = ringVerts + radial * 2 + 2
    let triCount = (n - 1) * radial * 2 + radial * 2
    var positions = [Float](repeating: 0, count: vertexCount * 3)
    var normals = [Float](repeating: 0, count: vertexCount * 3)
    var indices = [UInt32](repeating: 0, count: triCount * 3)

    func put(_ array: inout [Float], _ vertex: Int, _ v: SIMD3<Float>) {
      let o = vertex * 3
      array[o] = v.x
      array[o + 1] = v.y
      array[o + 2] = v.z
    }

    var tangents: [SIMD3<Float>] = []
    tangents.reserveCapacity(n)
    for i in 0..<n {
      tangents.append(
        XRBlocksMath.normalize(
          center[min(n - 1, i + 1)] - center[max(0, i - 1)], fallback: SIMD3<Float>(0, 0, 1)))
    }
    // Rotation-minimizing frames via the double-reflection method (Wang et al. 2008).
    let up: SIMD3<Float> = abs(tangents[0].y) < 0.9 ? SIMD3<Float>(0, 1, 0) : SIMD3<Float>(1, 0, 0)
    var normal = XRBlocksMath.normalize(simd_cross(tangents[0], up))
    for i in 0..<n {
      if i > 0 {
        let v1 = center[i] - center[i - 1]
        let c1 = simd_dot(v1, v1)
        if c1 > 1e-12 {
          let k1: Float = 2 / c1
          let rL: SIMD3<Float> = normal - v1 * (k1 * simd_dot(v1, normal))
          let tL: SIMD3<Float> = tangents[i - 1] - v1 * (k1 * simd_dot(v1, tangents[i - 1]))
          let v2: SIMD3<Float> = tangents[i] - tL
          let c2 = simd_dot(v2, v2)
          if c2 > 1e-12 {
            let k2: Float = 2 / c2
            normal = rL - v2 * (k2 * simd_dot(v2, rL))
          } else {
            normal = rL
          }
        }
        // Guard against drift: keep the frame orthonormal.
        normal = XRBlocksMath.normalize(
          normal - tangents[i] * simd_dot(normal, tangents[i]), fallback: normal)
      }
      let binormal = simd_cross(tangents[i], normal)
      for r in 0..<radial {
        let a = Float(r) / Float(radial) * Float.pi * 2
        let dir: SIMD3<Float> = normal * cos(a) + binormal * sin(a)
        let pos: SIMD3<Float> = center[i] + dir * radius
        put(&positions, i * radial + r, pos)
        put(&normals, i * radial + r, dir)
      }
    }
    let startRing = ringVerts
    let endRing = ringVerts + radial
    let capStart = ringVerts + radial * 2
    let capEnd = capStart + 1
    let startNormal = -tangents[0]
    let endNormal = tangents[n - 1]
    for r in 0..<radial {
      let first = r * 3
      let firstPos = SIMD3<Float>(positions[first], positions[first + 1], positions[first + 2])
      put(&positions, startRing + r, firstPos)
      put(&normals, startRing + r, startNormal)
      let last = ((n - 1) * radial + r) * 3
      let lastPos = SIMD3<Float>(positions[last], positions[last + 1], positions[last + 2])
      put(&positions, endRing + r, lastPos)
      put(&normals, endRing + r, endNormal)
    }
    put(&positions, capStart, center[0])
    put(&normals, capStart, startNormal)
    put(&positions, capEnd, center[n - 1])
    put(&normals, capEnd, endNormal)

    var k = 0
    func emit(_ a: Int, _ b: Int, _ c: Int) {
      indices[k] = UInt32(a)
      indices[k + 1] = UInt32(b)
      indices[k + 2] = UInt32(c)
      k += 3
    }
    for i in 0..<(n - 1) {
      for r in 0..<radial {
        let a = i * radial + r
        let b = i * radial + (r + 1) % radial
        let c = a + radial
        let d = b + radial
        // Counter-clockwise when viewed from outside the tube.
        emit(a, b, c)
        emit(b, d, c)
      }
    }
    for r in 0..<radial {
      let r1 = (r + 1) % radial
      emit(capStart, startRing + r1, startRing + r)
      emit(capEnd, endRing + r, endRing + r1)
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }
}

// MARK: - Particles

/// Small deterministic PRNG (mulberry32), bit-identical to `createRng()` on web.
public struct Mulberry32: Sendable {
  private var state: UInt32

  public init(seed: UInt32) {
    state = seed
  }

  /// Returns the next value in `[0, 1)`.
  public mutating func next() -> Double {
    state = state &+ 0x6D2B_79F5
    var t = state
    t = (t ^ (t >> 15)) &* (t | 1)
    t ^= t &+ ((t ^ (t >> 7)) &* (t | 61))
    return Double(t ^ (t >> 14)) / 4_294_967_296.0
  }
}

/// CPU particle simulation for one emitter volume (`ParticleEmitter` in
/// `depth-particles.ts`): presets `rain` / `snow` / `sparks` / `confetti`, respawn at the
/// volume top on floor / depth collision.
public final class ParticleEmitter {
  /// Hard cap on simultaneously simulated emitters per scene.
  public static let maxEmitters = 8
  /// Vertices written per particle by `writeVertices(into:)` (two crossed quads).
  public static let verticesPerParticle = 8

  /// Render style of a preset.
  public struct Style: Sendable, Equatable {
    public var color: SIMD4<Float>
    public var size: SIMD3<Float>
  }

  /// Returns the render style (RGBA color and half-extents) for a preset.
  public static func style(for preset: XRLiveParticlePreset) -> Style {
    switch preset {
    case .rain:
      return Style(
        color: SIMD4<Float>(0.7, 0.8, 1.0, 0.6), size: SIMD3<Float>(0.002, 0.04, 0.002))
    case .snow:
      return Style(color: SIMD4<Float>(1, 1, 1, 0.9), size: SIMD3<Float>(0.01, 0.01, 0.01))
    case .sparks:
      return Style(
        color: SIMD4<Float>(1.0, 0.7, 0.2, 1), size: SIMD3<Float>(0.004, 0.004, 0.004))
    case .confetti:
      return Style(
        color: SIMD4<Float>(1, 0.4, 0.7, 1), size: SIMD3<Float>(0.012, 0.012, 0.002))
    }
  }

  /// Real-world depth inputs for particle collision.
  public struct DepthCamera {
    /// World-to-view matrix (column-major).
    public var view: simd_float4x4
    /// Projection matrix (column-major).
    public var projection: simd_float4x4
    /// Samples real-world view depth (meters along −Z) at viewport `(u, v)` (origin
    /// top-left), or `nil` when unavailable.
    public var sample: (Float, Float) -> Float?

    public init(
      view: simd_float4x4, projection: simd_float4x4, sample: @escaping (Float, Float) -> Float?
    ) {
      self.view = view
      self.projection = projection
      self.sample = sample
    }
  }

  /// Returns `true` when world point `p` lies at or behind the real-world surface seen at
  /// its projected pixel (2 cm tolerance).
  public static func isOccludedByDepth(_ p: SIMD3<Float>, camera: DepthCamera) -> Bool {
    let v = camera.view * SIMD4<Float>(p.x, p.y, p.z, 1)
    let viewDepth = -v.z
    if viewDepth <= 0.05 { return false }
    let m = camera.projection
    let ndcX = (m.columns.0.x * v.x + m.columns.2.x * v.z) / viewDepth
    let ndcY = (m.columns.1.y * v.y + m.columns.2.y * v.z) / viewDepth
    if abs(ndcX) > 1 || abs(ndcY) > 1 { return false }
    guard let real = camera.sample((ndcX + 1) * 0.5, (1 - ndcY) * 0.5) else { return false }
    return real.isFinite && real > 0.05 && viewDepth >= real - 0.02
  }

  public let options: XRLiveParticles
  /// Particle count actually simulated (`options.count` clamped to 1...2000).
  public let count: Int
  /// `xyz` per particle.
  public private(set) var positions: [Float]
  /// `xyz` velocity per particle.
  public private(set) var velocities: [Float]
  /// Number of floor / depth collisions so far.
  public private(set) var collisions = 0

  private var rng: Mulberry32
  private var center = SIMD3<Double>(0, 0, 0)
  private var frame = 0

  public init(options: XRLiveParticles, seed: UInt32 = 1) {
    let n = min(XRLiveParticles.maxParticlesPerEmitter, max(1, options.count))
    self.options = options
    self.count = n
    self.rng = Mulberry32(seed: seed)
    self.positions = [Float](repeating: 0, count: n * 3)
    self.velocities = [Float](repeating: 0, count: n * 3)
  }

  /// Re-seeds every particle uniformly inside the volume around `center`.
  public func reset(center: SIMD3<Float>) {
    self.center = SIMD3<Double>(Double(center.x), Double(center.y), Double(center.z))
    for i in 0..<count {
      respawn(i, anywhere: true)
    }
  }

  private func setVelocity(_ o: Int, _ x: Double, _ y: Double, _ z: Double) {
    velocities[o] = Float(x)
    velocities[o + 1] = Float(y)
    velocities[o + 2] = Float(z)
  }

  private func respawn(_ i: Int, anywhere: Bool) {
    let w = Double(options.area.x)
    let h = Double(options.area.y)
    let d = Double(options.area.z)
    let cx = center.x
    let cy = center.y
    let cz = center.z
    let o = i * 3
    let sp = Double(options.speed)
    let burst = options.preset == .sparks
    positions[o] = Float(burst ? cx : cx + (rng.next() - 0.5) * w)
    positions[o + 1] = Float(burst ? cy : (anywhere ? cy + (rng.next() - 0.5) * h : cy + h * 0.5))
    positions[o + 2] = Float(burst ? cz : cz + (rng.next() - 0.5) * d)
    switch options.preset {
    case .rain:
      setVelocity(o, 0, -4 * sp, 0)
    case .snow:
      let vx = (rng.next() - 0.5) * 0.2
      let vz = (rng.next() - 0.5) * 0.2
      setVelocity(o, vx, -0.5 * sp, vz)
    case .sparks:
      let a = rng.next() * Double.pi * 2
      let up = 1.5 + rng.next() * 1.5
      setVelocity(o, cos(a) * sp, up * sp, sin(a) * sp)
    case .confetti:
      let vx = (rng.next() - 0.5) * sp
      let vy = (0.5 + rng.next()) * sp
      let vz = (rng.next() - 0.5) * sp
      setVelocity(o, vx, vy, vz)
    }
  }

  /// Advances the simulation. `center` moves the volume with its node; when provided,
  /// `floorY` and `depth` collide particles with real geometry.
  public func step(dt: Double, center: SIMD3<Float>, floorY: Float? = nil, depth: DepthCamera? = nil) {
    let step = dt.isFinite ? max(0, min(0.1, dt)) : 1.0 / 60.0
    self.center = SIMD3<Double>(Double(center.x), Double(center.y), Double(center.z))
    let preset = options.preset
    let gravity = (preset == .sparks || preset == .confetti) ? -9.8 * 0.4 : 0
    let drag = preset == .confetti ? 0.9 : 1.0
    let w = Double(options.area.x)
    let h = Double(options.area.y)
    let d = Double(options.area.z)
    let floorLevel = floorY.map { Double($0) } ?? -Double.infinity
    let bottom = max(self.center.y - h * 0.5, floorLevel)
    // Depth tests are amortized: each particle is checked every 4th frame.
    let phase = frame & 3
    frame &+= 1
    for i in 0..<count {
      let o = i * 3
      var vx = Double(velocities[o])
      var vy = Double(velocities[o + 1]) + gravity * step
      var vz = Double(velocities[o + 2])
      if drag != 1 {
        let k = pow(drag, step * 60)
        vx *= k
        vz *= k
      }
      if preset == .snow {
        vx += sin((Double(positions[o + 1]) + Double(i)) * 3) * 0.02 * step
      }
      velocities[o] = Float(vx)
      velocities[o + 1] = Float(vy)
      velocities[o + 2] = Float(vz)
      // Integrate with the stored (float32) velocities, like the web `Float32Array`s.
      vx = Double(velocities[o])
      vy = Double(velocities[o + 1])
      vz = Double(velocities[o + 2])
      positions[o] = Float(Double(positions[o]) + vx * step)
      positions[o + 1] = Float(Double(positions[o + 1]) + vy * step)
      positions[o + 2] = Float(Double(positions[o + 2]) + vz * step)
      let px = Double(positions[o])
      let py = Double(positions[o + 1])
      let pz = Double(positions[o + 2])
      let outside =
        abs(px - self.center.x) > w * 0.5 + 0.5 || abs(pz - self.center.z) > d * 0.5 + 0.5
      let hitFloor = py <= bottom
      var hitDepth = false
      if !hitFloor, let depth = depth, (i & 3) == phase {
        hitDepth = Self.isOccludedByDepth(
          SIMD3<Float>(positions[o], positions[o + 1], positions[o + 2]), camera: depth)
      }
      if hitFloor || hitDepth || outside {
        if hitFloor || hitDepth { collisions += 1 }
        respawn(i, anywhere: false)
      }
    }
  }

  /// Writes particle cross-quads (8 vertices each, `xyz`) into `out`, resizing it to
  /// `count * 8 * 3` floats.
  public func writeVertices(into out: inout [Float]) {
    let size = Self.style(for: options.preset).size
    let sx = size.x
    let sy = size.y
    let dz = size.z + size.x
    let needed = count * Self.verticesPerParticle * 3
    if out.count != needed { out = [Float](repeating: 0, count: needed) }
    for i in 0..<count {
      let o = i * 3
      var b = i * Self.verticesPerParticle * 3
      let x = positions[o]
      let y = positions[o + 1]
      let z = positions[o + 2]
      func vertex(_ vx: Float, _ vy: Float, _ vz: Float) {
        out[b] = vx
        out[b + 1] = vy
        out[b + 2] = vz
        b += 3
      }
      // Quad in the XY plane, then quad in the ZY plane.
      vertex(x - sx, y - sy, z)
      vertex(x + sx, y - sy, z)
      vertex(x + sx, y + sy, z)
      vertex(x - sx, y + sy, z)
      vertex(x, y - sy, z - dz)
      vertex(x, y - sy, z + dz)
      vertex(x, y + sy, z + dz)
      vertex(x, y + sy, z - dz)
    }
  }

  /// Builds the static normal / index buffers for `count` particle cross-quads.
  public static func buildTopology(count rawCount: Int) -> (normals: [Float], indices: [UInt32]) {
    let count = min(XRLiveParticles.maxParticlesPerEmitter, max(0, rawCount))
    var normals = [Float](repeating: 0, count: count * verticesPerParticle * 3)
    var indices = [UInt32]()
    indices.reserveCapacity(count * 12)
    for i in 0..<count {
      let v = i * verticesPerParticle
      for k in 0..<8 {
        normals[(v + k) * 3 + (k < 4 ? 2 : 0)] = 1
      }
      for off in [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] {
        indices.append(UInt32(v + off))
      }
    }
    return (normals, indices)
  }
}

// MARK: - AR Surface Placement Preview Geometry

/// Pure-Swift geometry builders for the in-app 3D AR surface placement reticle and reference
/// floor grid (`ThreeLiveArSurfaceGeometry` on Android).
public enum XRArSurfaceGeometry {
  /// Default linear RGBA color for the reference floor grid.
  public static let defaultGridColor = SIMD4<Float>(0.18, 0.34, 0.46, 1.0)

  /// Default linear RGBA color for the AR surface placement reticle ring and crosshairs.
  public static let defaultReticleColor = SIMD4<Float>(0.13, 0.85, 0.68, 1.0)

  /// Builds a flat ground-plane grid of thin quad lines on height `y` (meters).
  public static func buildFloorGridGeometry(
    y: Float = -0.96,
    halfExtent: Float = 2.0,
    divisions: Int = 8,
    lineHalfWidth: Float = 0.008
  ) -> XRGeneratedGeometry {
    let safeDivisions = min(64, max(1, divisions))
    let lineCount = (safeDivisions + 1) * 2
    var positions = [Float]()
    positions.reserveCapacity(lineCount * 4 * 3)
    var normals = [Float]()
    normals.reserveCapacity(lineCount * 4 * 3)
    var indices = [UInt32]()
    indices.reserveCapacity(lineCount * 6)
    let step = (halfExtent * 2) / Float(safeDivisions)

    func addQuad(_ x0: Float, _ z0: Float, _ x1: Float, _ z1: Float) {
      let base = UInt32(positions.count / 3)
      positions.append(contentsOf: [
        x0, y, z0,
        x1, y, z0,
        x1, y, z1,
        x0, y, z1,
      ])
      normals.append(contentsOf: [
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ])
      indices.append(contentsOf: [
        base, base + 1, base + 2,
        base, base + 2, base + 3,
      ])
    }

    for i in 0...safeDivisions {
      let coord = -halfExtent + Float(i) * step
      addQuad(coord - lineHalfWidth, -halfExtent, coord + lineHalfWidth, halfExtent)
      addQuad(-halfExtent, coord - lineHalfWidth, halfExtent, coord + lineHalfWidth)
    }
    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }

  /// Builds a circular AR surface placement reticle ring and center crosshairs on height `y` (meters).
  public static func buildReticleGeometry(
    y: Float = -0.95,
    innerRadius: Float = 0.52,
    outerRadius: Float = 0.60,
    segments: Int = 48
  ) -> XRGeneratedGeometry {
    let safeSegments = min(128, max(8, segments))
    let totalVertices = safeSegments * 2 + 8
    var positions = [Float]()
    positions.reserveCapacity(totalVertices * 3)
    var normals = [Float]()
    normals.reserveCapacity(totalVertices * 3)
    var indices = [UInt32]()
    indices.reserveCapacity(safeSegments * 6 + 12)

    for s in 0..<safeSegments {
      let angle = (2.0 * Float.pi * Float(s)) / Float(safeSegments)
      let c = cos(angle)
      let sn = sin(angle)
      positions.append(contentsOf: [
        c * innerRadius, y, sn * innerRadius,
        c * outerRadius, y, sn * outerRadius,
      ])
      normals.append(contentsOf: [
        0, 1, 0,
        0, 1, 0,
      ])
      let next = (s + 1) % safeSegments
      let i0 = UInt32(s * 2)
      let i1 = UInt32(s * 2 + 1)
      let i2 = UInt32(next * 2 + 1)
      let i3 = UInt32(next * 2)
      indices.append(contentsOf: [i0, i1, i2, i0, i2, i3])
    }

    let crossHalfLen: Float = 0.14
    let crossHalfWidth: Float = 0.012
    func addCrossBar(_ x0: Float, _ z0: Float, _ x1: Float, _ z1: Float) {
      let base = UInt32(positions.count / 3)
      positions.append(contentsOf: [
        x0, y, z0,
        x1, y, z0,
        x1, y, z1,
        x0, y, z1,
      ])
      normals.append(contentsOf: [
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
        0, 1, 0,
      ])
      indices.append(contentsOf: [
        base, base + 1, base + 2,
        base, base + 2, base + 3,
      ])
    }
    addCrossBar(-crossHalfLen, -crossHalfWidth, crossHalfLen, crossHalfWidth)
    addCrossBar(-crossHalfWidth, -crossHalfLen, crossHalfWidth, crossHalfLen)

    return XRGeneratedGeometry(positions: positions, normals: normals, indices: indices)
  }
}
