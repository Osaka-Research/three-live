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

#if canImport(CoreImage)
  import CoreImage
#endif
#if canImport(RealityKit) && os(iOS)
  import RealityKit
#endif

/// Platform-independent pieces of the iOS post-processing pipeline (`tone-mapping`, `bloom`,
/// `outline`), kept pure so they are unit-tested on every platform.
///
/// RealityKit tone-maps internally, so the selected curve is applied as a 3D LUT on RealityKit's
/// display-referred output: each pixel is decoded to linear, mapped back to an approximate scene
/// value through the inverse of the PBR Neutral curve (RealityKit's default look is treated as
/// Neutral), and re-tone-mapped with the requested curve. `neutral` is therefore the identity.
public enum XRLivePostProcessing {
  /// Canonical tone-mapping modes, matching web `normalizeToneMapping`.
  public static let toneMappingModes: Set<String> = ["neutral", "aces", "agx", "reinhard", "none"]

  /// Lower-cases and trims `mode`; unknown values become `neutral` (web parity).
  public static func normalizeToneMapping(_ mode: String?) -> String {
    let m = (mode ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return toneMappingModes.contains(m) ? m : "neutral"
  }

  public static func srgbToLinear(_ c: Double) -> Double {
    c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
  }

  public static func linearToSrgb(_ c: Double) -> Double {
    let v = max(0, min(1, c))
    return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1 / 2.4) - 0.055
  }

  /// Grey-axis inverse of the PBR Neutral curve: the scene value `x` with `neutral(x) == y`.
  public static func inverseNeutral(_ y: Double) -> Double {
    let target = max(0, min(0.999, y.isFinite ? y : 0))
    var lo = 0.0
    var hi = 64.0
    for _ in 0..<48 {
      let mid = (lo + hi) / 2
      let v = XRLiveTraitParser.evaluateToneMapping(
        rgb: SIMD3<Double>(mid, mid, mid), mode: "neutral"
      ).x
      if v < target { lo = mid } else { hi = mid }
    }
    return (lo + hi) / 2
  }

  /// Maps one display-referred sRGB color through the re-tone-mapping described above.
  public static func retoneMap(
    srgb: SIMD3<Double>, mode: String, exposure: Double = 1
  ) -> SIMD3<Double> {
    let m = normalizeToneMapping(mode)
    if m == "neutral" && exposure == 1 { return srgb }
    let lin = SIMD3<Double>(srgbToLinear(srgb.x), srgbToLinear(srgb.y), srgbToLinear(srgb.z))
    let peak = max(lin.x, max(lin.y, lin.z))
    let scene: SIMD3<Double>
    if peak <= 1e-6 {
      scene = SIMD3<Double>(repeating: 0)
    } else {
      // Preserve channel ratios and recover the scene peak from the inverse grey curve.
      scene = lin * (inverseNeutral(peak) / peak)
    }
    let out = XRLiveTraitParser.evaluateToneMapping(rgb: scene, mode: m, exposure: exposure)
    return SIMD3<Double>(linearToSrgb(out.x), linearToSrgb(out.y), linearToSrgb(out.z))
  }

  /// RGBA float32 cube data for `CIColorCube` (`size`^3 entries, red fastest).
  public static func toneMappingCube(mode: String, exposure: Double = 1, size: Int = 24)
    -> [Float]
  {
    let n = max(2, min(64, size))
    var data = [Float](repeating: 1, count: n * n * n * 4)
    let scale = 1 / Double(n - 1)
    for b in 0..<n {
      for g in 0..<n {
        for r in 0..<n {
          let c = retoneMap(
            srgb: SIMD3<Double>(Double(r) * scale, Double(g) * scale, Double(b) * scale),
            mode: mode, exposure: exposure)
          let o = ((b * n + g) * n + r) * 4
          data[o] = Float(c.x)
          data[o + 1] = Float(c.y)
          data[o + 2] = Float(c.z)
        }
      }
    }
    return data
  }

  /// Bloom parameters for the display-referred Core Image pass. Like web, bloom samples the
  /// tone-mapped frame, so the threshold is capped at 0.95.
  public struct BloomPass: Equatable, Sendable {
    public var threshold: Double
    public var intensity: Double
    public var blurRadiusPixels: Double
  }

  public static func bloomPass(_ bloom: XRLiveBloom, viewportHeight: Double) -> BloomPass {
    let h = viewportHeight.isFinite && viewportHeight > 0 ? viewportHeight : 1000
    return BloomPass(
      threshold: min(Double(bloom.threshold), 0.95),
      intensity: Double(bloom.strength),
      // radius 0..2 spans roughly 0..4% of the viewport height, like the web Kawase chain.
      blurRadiusPixels: max(1, Double(bloom.radius) * 0.02 * h))
  }

  /// Strongest enabled bloom among scene traits (hosts render one full-screen bloom pass).
  public static func strongestBloom(_ blooms: [XRLiveBloom?]) -> XRLiveBloom? {
    blooms.compactMap { $0 }.filter { $0.enabled && $0.strength > 0 }
      .max { $0.strength < $1.strength }
  }

  /// World-space shell offset for an inverted-hull outline of `thickness` pixels, for a model of
  /// `boundingRadius` viewed at `distance` metres with a vertical FOV of `fovYDegrees`.
  public static func outlineShellOffset(
    thicknessPixels: Float, distance: Float = 1.5, fovYDegrees: Float = 60,
    viewportHeight: Float = 1000
  ) -> Float {
    let fov = max(1, min(170, fovYDegrees)) * .pi / 180
    let metresPerPixel = 2 * max(0.05, distance) * tan(fov / 2) / max(1, viewportHeight)
    return max(0.0005, thicknessPixels * metresPerPixel)
  }

  /// Parses `#rgb` / `#rrggbb` into linear-free sRGB components in 0...1.
  public static func rgb(fromHex hex: String) -> SIMD3<Float> {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else { return SIMD3<Float>(0.22, 0.74, 0.97) }
    return SIMD3<Float>(
      Float((v >> 16) & 0xff) / 255, Float((v >> 8) & 0xff) / 255, Float(v & 0xff) / 255)
  }
}

#if canImport(RealityKit) && canImport(CoreImage) && os(iOS)
  /// Full-screen `tone-mapping` + `bloom` for an iOS `ARView`, via
  /// `ARView.renderCallbacks.postProcess` and Core Image (tone-map LUT, thresholded Gaussian
  /// bloom composited additively). visionOS has no app-level post-process hook, so there only
  /// `outline` (inverted hull) is rendered.
  @available(iOS 15.0, *)
  public final class XRLivePostProcessor: @unchecked Sendable {
    private let lock = NSLock()
    private var ciContext: CIContext?
    private var cubeData: Data?
    private var cubeKey = ""
    private var _toneMapping = "neutral"
    private var _exposure = 1.0
    private var _bloom: XRLiveBloom?
    private static let cubeSize = 24

    private func locked<T>(_ body: () -> T) -> T {
      lock.lock()
      defer { lock.unlock() }
      return body()
    }

    public init(toneMapping: String = "neutral", exposure: Double = 1, bloom: XRLiveBloom? = nil) {
      _toneMapping = XRLivePostProcessing.normalizeToneMapping(toneMapping)
      _exposure = exposure.isFinite ? max(0, exposure) : 1
      _bloom = bloom
    }

    /// Selected tone-mapping curve (`neutral`, `aces`, `agx`, `reinhard`, `none`).
    public var toneMapping: String {
      get { locked { _toneMapping } }
      set { locked { _toneMapping = XRLivePostProcessing.normalizeToneMapping(newValue) } }
    }

    public var exposure: Double {
      get { locked { _exposure } }
      set { locked { _exposure = newValue.isFinite ? max(0, newValue) : 1 } }
    }

    /// Full-screen bloom, or `nil` to disable.
    public var bloom: XRLiveBloom? {
      get { locked { _bloom } }
      set { locked { _bloom = newValue } }
    }

    /// Installs the post-process callbacks on `arView` (replacing any existing ones).
    @MainActor
    public func attach(to arView: ARView) {
      arView.renderCallbacks.prepareWithDevice = { [weak self] device in
        guard let self = self else { return }
        let ctx = CIContext(mtlDevice: device)
        self.locked { self.ciContext = ctx }
      }
      arView.renderCallbacks.postProcess = { [weak self] context in
        self?.process(context)
      }
    }

    @MainActor
    public func detach(from arView: ARView) {
      arView.renderCallbacks.postProcess = nil
      arView.renderCallbacks.prepareWithDevice = nil
    }

    private func cube(mode: String, exposure: Double) -> Data? {
      let key = "\(mode)@\(exposure)"
      if key == cubeKey, let d = cubeData { return d }
      let floats = XRLivePostProcessing.toneMappingCube(
        mode: mode, exposure: exposure, size: Self.cubeSize)
      let d = floats.withUnsafeBufferPointer { Data(buffer: $0) }
      cubeData = d
      cubeKey = key
      return d
    }

    private func process(_ context: ARView.PostProcessContext) {
      let (ci, bloom, lut) = locked { () -> (CIContext?, XRLiveBloom?, Data?) in
        let lut =
          (_toneMapping == "neutral" && _exposure == 1)
          ? nil : cube(mode: _toneMapping, exposure: _exposure)
        return (ciContext, _bloom, lut)
      }
      guard let ci = ci, let source = CIImage(mtlTexture: context.sourceColorTexture) else {
        // Pass through unchanged.
        if let blit = context.commandBuffer.makeBlitCommandEncoder() {
          blit.copy(from: context.sourceColorTexture, to: context.targetColorTexture)
          blit.endEncoding()
        }
        return
      }
      let extent = source.extent
      var image = source
      if let lut = lut, let f = CIFilter(name: "CIColorCube") {
        f.setValue(image, forKey: kCIInputImageKey)
        f.setValue(Self.cubeSize, forKey: "inputCubeDimension")
        f.setValue(lut, forKey: "inputCubeData")
        image = f.outputImage ?? image
      }
      if let b = bloom {
        let pass = XRLivePostProcessing.bloomPass(b, viewportHeight: Double(extent.height))
        let s = 1 / max(1e-3, 1 - pass.threshold)
        let bright =
          image
          .applyingFilter(
            "CIColorMatrix",
            parameters: [
              "inputRVector": CIVector(x: s, y: 0, z: 0, w: 0),
              "inputGVector": CIVector(x: 0, y: s, z: 0, w: 0),
              "inputBVector": CIVector(x: 0, y: 0, z: s, w: 0),
              "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
              "inputBiasVector": CIVector(
                x: -pass.threshold * s, y: -pass.threshold * s, z: -pass.threshold * s, w: 0),
            ]
          )
          .applyingFilter("CIColorClamp")
          .clampedToExtent()
          .applyingGaussianBlur(sigma: pass.blurRadiusPixels)
          .cropped(to: extent)
          .applyingFilter(
            "CIColorMatrix",
            parameters: [
              "inputRVector": CIVector(x: pass.intensity, y: 0, z: 0, w: 0),
              "inputGVector": CIVector(x: 0, y: pass.intensity, z: 0, w: 0),
              "inputBVector": CIVector(x: 0, y: 0, z: pass.intensity, w: 0),
              "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
            ])
        image = bright.applyingFilter(
          "CIAdditionCompositing", parameters: [kCIInputBackgroundImageKey: image]
        ).cropped(to: extent)
      }
      let destination = CIRenderDestination(
        mtlTexture: context.targetColorTexture, commandBuffer: context.commandBuffer)
      destination.isFlipped = false
      _ = try? ci.startTask(toRender: image, to: destination)
    }
  }
#endif
