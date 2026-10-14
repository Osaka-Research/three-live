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

// Frame capture for streaming what the user sees to Gemini Live (`XRGeminiLiveController`'s
// frame provider), keeping each sent frame's camera matrices so detections the model reports can be
// unprojected against the image it actually saw.

import Foundation
import simd

/// A captured frame: JPEG bytes plus the camera it was rendered with.
public struct XRCapturedFrame: Sendable {
  public var jpeg: Data
  public var width: Int
  public var height: Int
  /// Column-major camera world matrix.
  public var cameraWorld: simd_float4x4
  /// Column-major projection matrix.
  public var projection: simd_float4x4
  public var timestamp: TimeInterval

  public init(
    jpeg: Data, width: Int, height: Int, cameraWorld: simd_float4x4, projection: simd_float4x4,
    timestamp: TimeInterval
  ) {
    self.jpeg = jpeg
    self.width = width
    self.height = height
    self.cameraWorld = cameraWorld
    self.projection = projection
    self.timestamp = timestamp
  }
}

/// Platform-neutral helpers for frame capture.
public enum XRFrameCapture {
  /// Default longest edge of streamed frames, in pixels.
  public static let defaultMaxEdge = 768
  /// Number of sent frames whose matrices are kept.
  public static let history = 4

  /// Scales `(width, height)` so the longest edge is at most `maxEdge`, keeping aspect (≥ 1 px).
  public static func fit(width: Int, height: Int, maxEdge: Int) -> (width: Int, height: Int) {
    guard width > 0, height > 0 else { return (0, 0) }
    let longest = max(width, height)
    guard longest > maxEdge else { return (width, height) }
    let k = Double(maxEdge) / Double(longest)
    return (max(1, Int((Double(width) * k).rounded())), max(1, Int((Double(height) * k).rounded())))
  }

  /// OpenGL-style perspective projection (column-major), as used by `WorldUnderstanding`.
  public static func perspective(fovYDegrees: Double, aspect: Double, near: Float = 0.05, far: Float = 100)
    -> simd_float4x4
  {
    let f = Float(1 / tan(max(1, min(179, fovYDegrees)) * .pi / 360))
    let a = Float(aspect.isFinite && aspect > 0 ? aspect : 1)
    return simd_float4x4(columns: (
      SIMD4<Float>(f / a, 0, 0, 0),
      SIMD4<Float>(0, f, 0, 0),
      SIMD4<Float>(0, 0, (far + near) / (near - far), -1),
      SIMD4<Float>(0, 0, 2 * far * near / (near - far), 0)
    ))
  }
}

/// Thread-safe ring of recently sent frames.
public final class XRFrameHistory: @unchecked Sendable {
  private let lock = NSLock()
  private var frames: [XRCapturedFrame] = []

  public init() {}

  public func remember(_ frame: XRCapturedFrame) {
    lock.lock()
    frames.append(frame)
    if frames.count > XRFrameCapture.history { frames.removeFirst(frames.count - XRFrameCapture.history) }
    lock.unlock()
  }

  /// The most recently sent frame (what the model last saw).
  public var latest: XRCapturedFrame? {
    lock.lock()
    defer { lock.unlock() }
    return frames.last
  }
}

#if canImport(RealityKit) && canImport(UIKit) && canImport(ARKit) && os(iOS)
  import ARKit
  import RealityKit
  import UIKit

  /// Captures `ARView` snapshots (rendered scene, plus the camera feed in AR mode) as JPEG frames.
  ///
  /// ```swift
  /// let frames = ARViewFrameSource(arView: arView) { 45 }
  /// let gemini = XRGeminiLiveController(frameProvider: frames.makeProvider(), audioSink: AVAudioPcmSink())
  /// ```
  @MainActor
  public final class ARViewFrameSource {
    /// When `true`, no frames are captured (e.g. the app is in the background).
    public var paused = false
    /// Recently sent frames and their camera matrices.
    public let history = XRFrameHistory()

    private weak var arView: ARView?
    private let maxEdge: Int
    private let fieldOfViewDegrees: () -> Double

    /// - Parameters:
    ///   - fieldOfViewDegrees: the vertical field of view of the non-AR camera (AR mode uses
    ///     ARKit's projection instead).
    public init(arView: ARView, maxEdge: Int = XRFrameCapture.defaultMaxEdge, fieldOfViewDegrees: @escaping () -> Double) {
      self.arView = arView
      self.maxEdge = maxEdge
      self.fieldOfViewDegrees = fieldOfViewDegrees
    }

    /// A frame provider for `XRGeminiLiveController` (may be called from any thread).
    public nonisolated func makeProvider() -> XRGeminiLiveController.FrameProvider {
      return { [weak self] done in
        Task { @MainActor in
          guard let self = self else {
            done(nil)
            return
          }
          self.capture(done)
        }
      }
    }

    private func capture(_ done: @escaping (Data?) -> Void) {
      guard !paused, let arView = arView, arView.bounds.width > 0, arView.bounds.height > 0 else {
        done(nil)
        return
      }
      let world = arView.cameraTransform.matrix
      let size = arView.bounds.size
      let projection: simd_float4x4
      if let camera = arView.session.currentFrame?.camera, arView.cameraMode == .ar {
        projection = camera.projectionMatrix(
          for: arView.window?.windowScene?.interfaceOrientation ?? .portrait, viewportSize: size,
          zNear: 0.05, zFar: 100)
      } else {
        projection = XRFrameCapture.perspective(
          fovYDegrees: fieldOfViewDegrees(), aspect: Double(size.width / size.height))
      }
      let maxEdge = self.maxEdge
      let history = self.history
      arView.snapshot(saveToHDR: false) { image in
        guard let image = image, let cg = image.cgImage else {
          done(nil)
          return
        }
        let fitted = XRFrameCapture.fit(width: cg.width, height: cg.height, maxEdge: maxEdge)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let renderer = UIGraphicsImageRenderer(
          size: CGSize(width: fitted.width, height: fitted.height), format: format)
        let data = renderer.jpegData(withCompressionQuality: 0.6) { _ in
          image.draw(in: CGRect(x: 0, y: 0, width: fitted.width, height: fitted.height))
        }
        history.remember(
          XRCapturedFrame(
            jpeg: data, width: fitted.width, height: fitted.height, cameraWorld: world, projection: projection,
            timestamp: Date().timeIntervalSince1970))
        done(data)
      }
    }
  }
#endif
