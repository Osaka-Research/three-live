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

#if canImport(Vision)
  import Vision
#endif

/// An on-device object detector (for example `XRVisionDetector`). Receives a captured frame (JPEG
/// plus the camera matrices it was rendered with) and reports 2D boxes in the `detections` format:
/// `[ymin, xmin, ymax, xmax]`, normalized `0…1` (top-left origin).
public protocol XRObjectDetector: AnyObject, Sendable {
  func detect(frame: XRCapturedFrame, completion: @escaping @Sendable ([XRDetections.Box]) -> Void)
}

/// Process-wide registry for the on-device detector used by `objectDetection = "on-device"`, plus
/// coordinate conversion helpers shared with `XRVisionDetector`.
public enum XRObjectDetectors {
  private static let lock = NSLock()
  private static var detector: XRObjectDetector?

  /// Registers `value` (replacing any previous detector); `nil` unregisters.
  public static func register(_ value: XRObjectDetector?) {
    lock.lock()
    detector = value
    lock.unlock()
  }

  /// The registered detector, or `nil` when none is installed.
  public static func current() -> XRObjectDetector? {
    lock.lock()
    defer { lock.unlock() }
    return detector
  }

  /// Converts a Vision normalized bounding box (origin at bottom-left, `0…1`) to top-left
  /// `[ymin, xmin, ymax, xmax]` in `0…1`. Returns `nil` when the clamped box is empty.
  public static func visionBoundingBoxToTopLeft(
    x: Float, y: Float, width: Float, height: Float, label: String
  ) -> XRDetections.Box? {
    guard x.isFinite, y.isFinite, width.isFinite, height.isFinite, width > 0, height > 0 else {
      return nil
    }
    let xmin = min(1, max(0, x))
    let xmax = min(1, max(0, x + width))
    let ymin = min(1, max(0, 1 - (y + height)))
    let ymax = min(1, max(0, 1 - y))
    guard xmax > xmin, ymax > ymin else { return nil }
    let trimmed = String(label.trimmingCharacters(in: .whitespacesAndNewlines).prefix(256))
    return XRDetections.Box(
      box: [ymin, xmin, ymax, xmax],
      label: trimmed.isEmpty ? "object" : trimmed)
  }
}

/// Periodically captures a frame, runs an `XRObjectDetector` on it, and reports the boxes located
/// in 3D with the camera of that frame. At most one frame is in flight; frames are skipped while
/// `paused`. Mirrors Android `ObjectDetectionLoop`.
public final class XRObjectDetectionLoop: @unchecked Sendable {
  public static let defaultInterval: TimeInterval = 0.5

  private let captureFrame: (@escaping @Sendable (XRCapturedFrame?) -> Void) -> Void
  private let detector: XRObjectDetector
  private let interval: TimeInterval
  private let callbackQueue: DispatchQueue
  private let onDetected: ([WorldUnderstanding.Detection3D]) -> Void

  private let lock = NSLock()
  private var timer: DispatchSourceTimer?
  private var inFlight = false
  private var stopped = false
  private var isPaused = false

  /// When `true`, no frames are captured.
  public var paused: Bool {
    get {
      lock.lock()
      defer { lock.unlock() }
      return isPaused
    }
    set {
      lock.lock()
      isPaused = newValue
      lock.unlock()
    }
  }

  public init(
    captureFrame: @escaping (@escaping @Sendable (XRCapturedFrame?) -> Void) -> Void,
    detector: XRObjectDetector,
    interval: TimeInterval = XRObjectDetectionLoop.defaultInterval,
    callbackQueue: DispatchQueue = .main,
    onDetected: @escaping ([WorldUnderstanding.Detection3D]) -> Void
  ) {
    self.captureFrame = captureFrame
    self.detector = detector
    self.interval = min(10, max(0.1, interval.isFinite ? interval : Self.defaultInterval))
    self.callbackQueue = callbackQueue
    self.onDetected = onDetected
  }

  /// Starts detecting every `interval` seconds. Idempotent.
  public func start() {
    lock.lock()
    if timer != nil {
      lock.unlock()
      return
    }
    stopped = false
    let t = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    t.schedule(deadline: .now() + interval, repeating: interval)
    t.setEventHandler { [weak self] in _ = self?.tick() }
    timer = t
    lock.unlock()
    t.resume()
  }

  /// Stops detecting; results of a frame still in flight are dropped.
  public func stop() {
    lock.lock()
    stopped = true
    let t = timer
    timer = nil
    lock.unlock()
    t?.cancel()
  }

  /// Runs one capture → detect → locate cycle. Returns `false` when skipped.
  @discardableResult
  public func tick() -> Bool {
    lock.lock()
    if isPaused || inFlight {
      lock.unlock()
      return false
    }
    inFlight = true
    lock.unlock()

    captureFrame { [weak self] frame in
      guard let self = self else { return }
      guard let frame = frame else {
        self.clearInFlight()
        return
      }
      self.detector.detect(frame: frame) { [weak self] boxes in
        guard let self = self else { return }
        self.lock.lock()
        self.inFlight = false
        let drop = self.isPaused || self.stopped
        self.lock.unlock()
        guard !drop, !boxes.isEmpty else { return }
        let located = XRDetections.detect(
          boxes, cameraWorld: frame.cameraWorld, projection: frame.projection)
        guard !located.isEmpty else { return }
        self.callbackQueue.async { [weak self] in
          self?.onDetected(located)
        }
      }
    }
    return true
  }

  private func clearInFlight() {
    lock.lock()
    inFlight = false
    lock.unlock()
  }
}

#if canImport(Vision)
  /// An on-device `XRObjectDetector` backed by Apple's `Vision` framework.
  ///
  /// When `coreMLModel` is provided, runs a `VNCoreMLRequest` and reads
  /// `VNRecognizedObjectObservation` boxes and labels. When `coreMLModel` is `nil`, runs built-in
  /// `VNRecognizeAnimalsRequest` and `VNDetectHumanRectanglesRequest` so apps without a bundled
  /// `.mlmodelc` still get built-in Vision detections.
  public final class XRVisionDetector: XRObjectDetector, @unchecked Sendable {
    private let coreMLModel: VNCoreMLModel?
    private let minConfidence: Float
    private let queue = DispatchQueue(label: "com.google.threelive.vision", qos: .utility)

    public init(coreMLModel: VNCoreMLModel? = nil, minConfidence: Float = 0.25) {
      self.coreMLModel = coreMLModel
      self.minConfidence = minConfidence
    }

    /// Creates an `XRVisionDetector` and registers it with `XRObjectDetectors`.
    @discardableResult
    public static func install(
      coreMLModel: VNCoreMLModel? = nil, minConfidence: Float = 0.25
    ) -> XRVisionDetector {
      let d = XRVisionDetector(coreMLModel: coreMLModel, minConfidence: minConfidence)
      XRObjectDetectors.register(d)
      return d
    }

    public func detect(
      frame: XRCapturedFrame, completion: @escaping @Sendable ([XRDetections.Box]) -> Void
    ) {
      guard !frame.jpeg.isEmpty else {
        completion([])
        return
      }
      let model = coreMLModel
      let threshold = minConfidence
      queue.async {
        let handler = VNImageRequestHandler(data: frame.jpeg, options: [:])
        var out: [XRDetections.Box] = []
        if let model = model {
          let request = VNCoreMLRequest(model: model)
          request.imageCropAndScaleOption = .scaleFill
          try? handler.perform([request])
          let observations = (request.results as? [VNRecognizedObjectObservation]) ?? []
          out = Self.boxes(fromRecognized: observations, minConfidence: threshold)
        } else {
          let animals = VNRecognizeAnimalsRequest()
          let humans = VNDetectHumanRectanglesRequest()
          try? handler.perform([animals, humans])
          out.append(
            contentsOf: Self.boxes(
              fromRecognized: animals.results ?? [], minConfidence: threshold))
          for h in humans.results ?? [] {
            if out.count >= WorldUnderstanding.maxDetections { break }
            guard h.confidence >= threshold else { continue }
            let b = h.boundingBox
            if let box = XRObjectDetectors.visionBoundingBoxToTopLeft(
              x: Float(b.origin.x), y: Float(b.origin.y),
              width: Float(b.size.width), height: Float(b.size.height),
              label: "person")
            {
              out.append(box)
            }
          }
        }
        completion(out)
      }
    }

    private static func boxes(
      fromRecognized observations: [VNRecognizedObjectObservation], minConfidence: Float
    ) -> [XRDetections.Box] {
      var out: [XRDetections.Box] = []
      for obs in observations {
        if out.count >= WorldUnderstanding.maxDetections { break }
        let top = obs.labels.first
        let confidence = top?.confidence ?? obs.confidence
        guard confidence >= minConfidence else { continue }
        let label = top?.identifier ?? "object"
        let b = obs.boundingBox
        if let box = XRObjectDetectors.visionBoundingBoxToTopLeft(
          x: Float(b.origin.x), y: Float(b.origin.y),
          width: Float(b.size.width), height: Float(b.size.height),
          label: label)
        {
          out.append(box)
        }
      }
      return out
    }
  }
#endif
