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

// Platform-neutral port of `xr-live/src/xr-gestures.ts` (`classifyHandJoints` and the
// per-hand change filter of `XRHandGestureClassifier.processXRFrame`). Thresholds, joint
// fallbacks and outputs are identical to the web implementation; the math runs in `Double`
// like JavaScript numbers so borderline poses classify the same way on every platform.
//
// On visionOS, `XRHandTrackingSource` feeds ARKit `HandTrackingProvider` joints into it.

import Foundation
import simd

/// Canonical spatial hand gestures (`XRHandGestureName` on web).
public enum XRHandGesture: String, Sendable, CaseIterable {
  case pinch
  case point
  case fist
  case openPalm = "open-palm"
  case thumbsUp = "thumbs-up"
  case spread
  case none
}

/// Per-finger curl in `[0, 1]` (0 = straight, 1 = fully folded).
public struct XRFingerCurls: Sendable, Equatable {
  public var thumb: Double
  public var index: Double
  public var middle: Double
  public var ring: Double
  public var pinky: Double

  public init(thumb: Double, index: Double, middle: Double, ring: Double, pinky: Double) {
    self.thumb = thumb
    self.index = index
    self.middle = middle
    self.ring = ring
    self.pinky = pinky
  }
}

/// Result of classifying one hand pose.
public struct XRGestureResult: Sendable, Equatable {
  public var gesture: XRHandGesture
  public var confidence: Double
  public var curls: XRFingerCurls
}

/// WebXR joint name (e.g. `"index-finger-tip"`) to world or hand-space position.
public typealias XRHandJointMap = [String: SIMD3<Float>]

/// Zero-dependency geometric classifier over the 25 WebXR hand joints.
public enum XRHandGestureClassifier {
  /// The 25 WebXR `XRHand` joint names, in specification order.
  public static let jointNames: [String] = [
    "wrist",
    "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
    "index-finger-metacarpal", "index-finger-phalanx-proximal",
    "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
    "middle-finger-metacarpal", "middle-finger-phalanx-proximal",
    "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
    "ring-finger-metacarpal", "ring-finger-phalanx-proximal",
    "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
    "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal",
    "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
  ]

  /// The 21 MediaPipe Hand Landmarker landmark indices (`0 = WRIST` .. `20 = PINKY_TIP`) mapped to
  /// their corresponding WebXR `XRHand` joint names (matching Android
  /// `XRHandGestures.MEDIAPIPE_JOINT_NAMES`).
  public static let mediaPipeJointNames: [String] = [
    "wrist",
    "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
    "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-distal",
    "index-finger-tip",
    "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-distal",
    "middle-finger-tip",
    "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-distal",
    "ring-finger-tip",
    "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-distal",
    "pinky-finger-tip",
  ]

  /// Converts 21 MediaPipe 3D hand landmarks into a WebXR joint map suitable for `classify(_:)`.
  ///
  /// MediaPipe image/world coordinates use `+Y` downward (`0` at top), whereas WebXR uses `+Y`
  /// upward. When `flipY` is `true` (the default), `y` and `z` are negated so upward gestures such
  /// as `.thumbsUp` have `+Y` thumb vectors. Non-finite coordinates are skipped; returns an empty
  /// map if fewer than 21 points are supplied.
  public static func fromMediaPipeLandmarks(
    _ landmarks: [SIMD3<Float>], flipY: Bool = true
  ) -> XRHandJointMap {
    guard landmarks.count >= mediaPipeJointNames.count else { return [:] }
    var out: XRHandJointMap = [:]
    out.reserveCapacity(mediaPipeJointNames.count)
    let sign: Float = flipY ? -1 : 1
    for i in 0..<mediaPipeJointNames.count {
      let p = landmarks[i]
      guard p.x.isFinite, p.y.isFinite, p.z.isFinite else { continue }
      out[mediaPipeJointNames[i]] = SIMD3<Float>(p.x, p.y * sign, p.z * sign)
    }
    return out
  }

  private static func vec(_ v: SIMD3<Float>) -> SIMD3<Double> {
    SIMD3<Double>(Double(v.x), Double(v.y), Double(v.z))
  }

  /// `Math.hypot(...) || 1`: zero (and NaN) lengths become 1.
  private static func lengthOrOne(_ v: SIMD3<Double>) -> Double {
    let len = simd_length(v)
    return (len == 0 || len.isNaN) ? 1 : len
  }

  private static func fingerCurl(
    wrist: SIMD3<Double>, proximal: SIMD3<Double>, tip: SIMD3<Double>
  ) -> Double {
    let u = proximal - wrist
    let v = tip - proximal
    let dot = simd_dot(u, v) / (lengthOrOne(u) * lengthOrOne(v))
    // dot = 1 -> straight (curl 0), dot = -1 -> fully folded (curl 1).
    return max(0, min(1, (1 - dot) * 0.5))
  }

  private static func dist(_ a: SIMD3<Double>, _ b: SIMD3<Double>) -> Double {
    simd_length(a - b)
  }

  /// Classifies a joint map into one of six gestures (or `.none`). Missing joints fall back
  /// exactly like the web: proximal phalanx, then metacarpal, then the wrist (origin when
  /// the wrist itself is missing).
  public static func classify(_ joints: XRHandJointMap) -> XRGestureResult {
    let wrist = joints["wrist"].map(vec) ?? SIMD3<Double>(0, 0, 0)
    func joint(_ names: String...) -> SIMD3<Double> {
      for name in names {
        if let p = joints[name] { return vec(p) }
      }
      return wrist
    }
    let thumbProx = joint("thumb-phalanx-proximal", "thumb-metacarpal")
    let thumbTip = joint("thumb-tip")
    let indexProx = joint("index-finger-phalanx-proximal", "index-finger-metacarpal")
    let indexTip = joint("index-finger-tip")
    let middleProx = joint("middle-finger-phalanx-proximal", "middle-finger-metacarpal")
    let middleTip = joint("middle-finger-tip")
    let ringProx = joint("ring-finger-phalanx-proximal", "ring-finger-metacarpal")
    let ringTip = joint("ring-finger-tip")
    let pinkyProx = joint("pinky-finger-phalanx-proximal", "pinky-finger-metacarpal")
    let pinkyTip = joint("pinky-finger-tip")

    let curls = XRFingerCurls(
      thumb: fingerCurl(wrist: wrist, proximal: thumbProx, tip: thumbTip),
      index: fingerCurl(wrist: wrist, proximal: indexProx, tip: indexTip),
      middle: fingerCurl(wrist: wrist, proximal: middleProx, tip: middleTip),
      ring: fingerCurl(wrist: wrist, proximal: ringProx, tip: ringTip),
      pinky: fingerCurl(wrist: wrist, proximal: pinkyProx, tip: pinkyTip)
    )

    // 1. Thumbs-up: thumb extended upward and the four fingers curled.
    let thumbVecY = thumbTip.y - thumbProx.y
    let thumbLenRaw = dist(thumbTip, thumbProx)
    let thumbLen = (thumbLenRaw == 0 || thumbLenRaw.isNaN) ? 1 : thumbLenRaw
    if curls.thumb < 0.3 && thumbVecY / thumbLen > 0.7 && curls.index > 0.6
      && curls.middle > 0.6 && curls.ring > 0.6 && curls.pinky > 0.6
    {
      return XRGestureResult(gesture: .thumbsUp, confidence: 0.95, curls: curls)
    }

    // 2. Fist: four fingers curled (> 0.65) and the thumb curled (> 0.5).
    if curls.thumb > 0.5 && curls.index > 0.65 && curls.middle > 0.65 && curls.ring > 0.65
      && curls.pinky > 0.65
    {
      return XRGestureResult(gesture: .fist, confidence: 0.92, curls: curls)
    }

    // 3. Pinch: thumb tip and index tip within 1.8 cm.
    let pinchDist = dist(thumbTip, indexTip)
    if pinchDist > 0 && pinchDist < 0.018 {
      return XRGestureResult(
        gesture: .pinch, confidence: min(1, (0.022 - pinchDist) / 0.015), curls: curls)
    }

    // 4. Point: index extended, middle / ring / pinky curled.
    if curls.index < 0.25 && curls.middle > 0.6 && curls.ring > 0.6 && curls.pinky > 0.6 {
      return XRGestureResult(gesture: .point, confidence: 0.94, curls: curls)
    }

    // 5. Spread vs open palm: all five digits extended.
    if curls.thumb < 0.3 && curls.index < 0.25 && curls.middle < 0.25 && curls.ring < 0.25
      && curls.pinky < 0.25
    {
      let spreadDist =
        (dist(indexTip, middleTip) + dist(middleTip, ringTip) + dist(ringTip, pinkyTip)) / 3
      if spreadDist > 0.042 {
        return XRGestureResult(gesture: .spread, confidence: 0.91, curls: curls)
      }
      return XRGestureResult(gesture: .openPalm, confidence: 0.93, curls: curls)
    }

    return XRGestureResult(gesture: .none, confidence: 0, curls: curls)
  }
}

/// A gesture change for one hand (`xr-gesture` event detail on web).
public struct XRHandGestureEvent: Sendable, Equatable {
  public var hand: XRHand
  public var gesture: XRHandGesture
  public var confidence: Double
  public var curls: XRFingerCurls
}

/// Per-hand change filter: reports a gesture only when it differs from the last reported
/// gesture for that hand; `.none` silently re-arms the hand (same as web).
public struct XRHandGestureTracker: Sendable {
  public private(set) var lastGestures: [XRHand: XRHandGesture] = [
    .left: XRHandGesture.none, .right: XRHandGesture.none,
  ]

  public init() {}

  /// Classifies `joints` for `hand`, returning an event only on change.
  public mutating func update(hand: XRHand, joints: XRHandJointMap) -> XRHandGestureEvent? {
    update(hand: hand, result: XRHandGestureClassifier.classify(joints))
  }

  /// Filters an already-computed classification for `hand`.
  public mutating func update(hand: XRHand, result: XRGestureResult) -> XRHandGestureEvent? {
    if result.gesture == .none {
      lastGestures[hand] = XRHandGesture.none
      return nil
    }
    guard result.gesture != lastGestures[hand] else { return nil }
    lastGestures[hand] = result.gesture
    return XRHandGestureEvent(
      hand: hand, gesture: result.gesture, confidence: result.confidence, curls: result.curls)
  }

  /// Forgets the last gesture for `hand` (e.g. when tracking is lost).
  public mutating func reset(_ hand: XRHand) {
    lastGestures[hand] = XRHandGesture.none
  }

  /// Polls `.left` and `.right` from `source` and invokes `onGesture` for each hand whose gesture
  /// changed to a non-`.none` gesture; resets any hand that is no longer tracked.
  public mutating func poll(
    from source: XRHandJointSource, onGesture: (XRHandGestureEvent) -> Void
  ) {
    for hand in [XRHand.left, XRHand.right] {
      guard let joints = source.joints(for: hand), !joints.isEmpty else {
        reset(hand)
        continue
      }
      if let event = update(hand: hand, joints: joints) {
        onGesture(event)
      }
    }
  }
}

/// Supplies 3D hand joint positions for `xrHands` gesture classification and hand-anchored
/// lazy-follow traits (for example from visionOS `XRHandTrackingSource` or a MediaPipe Hand
/// Landmarker camera feed).
public protocol XRHandJointSource: AnyObject {
  /// Returns the latest WebXR joint map (`"wrist"`, `"index-finger-tip"`, ...) in meters for
  /// `hand`, or `nil` / empty when that hand is not currently tracked.
  func joints(for hand: XRHand) -> XRHandJointMap?

  /// Returns the latest world-space wrist pose for `hand`, used by `follow = "left-hand"` /
  /// `"right-hand"` traits. Defaults to the `"wrist"` entry of `joints(for:)` with identity
  /// rotation.
  func wristPose(for hand: XRHand) -> XRPose?
}

extension XRHandJointSource {
  public func wristPose(for hand: XRHand) -> XRPose? {
    guard let w = joints(for: hand)?["wrist"], w.x.isFinite, w.y.isFinite, w.z.isFinite else {
      return nil
    }
    return XRPose(position: w)
  }
}

/// Process-wide registry for the `XRHandJointSource` used when `xrHands != "none"`.
public enum XRHandJointSources {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var source: XRHandJointSource?

  /// Registers `value` (replacing any previous source); `nil` unregisters.
  public static func register(_ value: XRHandJointSource?) {
    lock.lock()
    source = value
    lock.unlock()
  }

  /// The registered source, or `nil` when the app installed none.
  public static func current() -> XRHandJointSource? {
    lock.lock()
    defer { lock.unlock() }
    return source
  }

  /// Returns a `.left` / `.right` wrist pose map for `XRLiveRuntimeSession.step` from `src`.
  public static func handPoses(from src: XRHandJointSource? = current()) -> [XRHand: XRPose] {
    guard let src = src else { return [:] }
    var out: [XRHand: XRPose] = [:]
    if let left = src.wristPose(for: .left) { out[.left] = left }
    if let right = src.wristPose(for: .right) { out[.right] = right }
    return out
  }
}

/// Thread-safe in-memory `XRHandJointSource` for hosts that push 21-landmark MediaPipe Hand
/// Landmarker results or pre-mapped WebXR joint dictionaries from a camera pipeline.
public final class XRMediaPipeHandJointSource: XRHandJointSource, @unchecked Sendable {
  private let lock = NSLock()
  private var leftJoints: XRHandJointMap?
  private var rightJoints: XRHandJointMap?

  public init() {}

  /// Creates an `XRMediaPipeHandJointSource` and registers it with `XRHandJointSources`.
  @discardableResult
  public static func install() -> XRMediaPipeHandJointSource {
    let s = XRMediaPipeHandJointSource()
    XRHandJointSources.register(s)
    return s
  }

  public func joints(for hand: XRHand) -> XRHandJointMap? {
    lock.lock()
    defer { lock.unlock() }
    switch hand {
    case .left: return leftJoints
    case .right: return rightJoints
    }
  }

  /// Updates the tracked joints for `hand` from 21 MediaPipe 3D landmarks (`flipY` converts
  /// MediaPipe `+Y` downward to WebXR `+Y` upward). Passing `nil` clears that hand.
  public func update(hand: XRHand, mediaPipeLandmarks: [SIMD3<Float>]?, flipY: Bool = true) {
    let mapped = mediaPipeLandmarks.map {
      XRHandGestureClassifier.fromMediaPipeLandmarks($0, flipY: flipY)
    }
    update(hand: hand, joints: (mapped?.isEmpty == false) ? mapped : nil)
  }

  /// Updates the tracked WebXR joint map for `hand` (`nil` clears that hand).
  public func update(hand: XRHand, joints: XRHandJointMap?) {
    lock.lock()
    switch hand {
    case .left: leftJoints = joints
    case .right: rightJoints = joints
    }
    lock.unlock()
  }

  /// Clears both hands.
  public func clear() {
    lock.lock()
    leftJoints = nil
    rightJoints = nil
    lock.unlock()
  }
}

#if os(visionOS) && canImport(ARKit)
  import ARKit

  /// Streams visionOS ARKit hand joints into `XRHandGestureClassifier` and reports gesture
  /// changes (`onGesture`), raw joints (`onJoints`), and wrist poses (`handPoses`, suitable
  /// for `XRLiveRealityKitSession.handPoseProvider`).
  ///
  /// Requires an immersive space and `NSHandsTrackingUsageDescription` in Info.plist.
  ///
  /// ```swift
  /// let hands = XRHandTrackingSource()
  /// hands.onGesture = { e in print(e.hand, e.gesture.rawValue, e.confidence) }
  /// live.handPoseProvider = { hands.handPoses }
  /// try await hands.start()
  /// ```
  @available(visionOS 1.0, *)
  @MainActor
  public final class XRHandTrackingSource: XRHandJointSource {
    /// Called when a hand's gesture changes to something other than `.none`.
    public var onGesture: ((XRHandGestureEvent) -> Void)?
    /// Called for every tracked hand update with world-space joint positions.
    public var onJoints: ((XRHand, XRHandJointMap) -> Void)?
    /// Latest world-space wrist pose per tracked hand.
    public private(set) var handPoses: [XRHand: XRPose] = [:]

    private let arSession = ARKitSession()
    private let provider = HandTrackingProvider()
    private var tracker = XRHandGestureTracker()
    private var updatesTask: Task<Void, Never>?
    private let jointsLock = NSLock()
    private nonisolated(unsafe) var latestJoints: [XRHand: XRHandJointMap] = [:]
    private nonisolated(unsafe) var latestPoses: [XRHand: XRPose] = [:]

    /// ARKit joint names mapped to WebXR names.
    static let jointNames: [(HandSkeleton.JointName, String)] = [
      (.wrist, "wrist"),
      (.thumbKnuckle, "thumb-metacarpal"),
      (.thumbIntermediateBase, "thumb-phalanx-proximal"),
      (.thumbIntermediateTip, "thumb-phalanx-distal"),
      (.thumbTip, "thumb-tip"),
      (.indexFingerMetacarpal, "index-finger-metacarpal"),
      (.indexFingerKnuckle, "index-finger-phalanx-proximal"),
      (.indexFingerIntermediateBase, "index-finger-phalanx-intermediate"),
      (.indexFingerIntermediateTip, "index-finger-phalanx-distal"),
      (.indexFingerTip, "index-finger-tip"),
      (.middleFingerMetacarpal, "middle-finger-metacarpal"),
      (.middleFingerKnuckle, "middle-finger-phalanx-proximal"),
      (.middleFingerIntermediateBase, "middle-finger-phalanx-intermediate"),
      (.middleFingerIntermediateTip, "middle-finger-phalanx-distal"),
      (.middleFingerTip, "middle-finger-tip"),
      (.ringFingerMetacarpal, "ring-finger-metacarpal"),
      (.ringFingerKnuckle, "ring-finger-phalanx-proximal"),
      (.ringFingerIntermediateBase, "ring-finger-phalanx-intermediate"),
      (.ringFingerIntermediateTip, "ring-finger-phalanx-distal"),
      (.ringFingerTip, "ring-finger-tip"),
      (.littleFingerMetacarpal, "pinky-finger-metacarpal"),
      (.littleFingerKnuckle, "pinky-finger-phalanx-proximal"),
      (.littleFingerIntermediateBase, "pinky-finger-phalanx-intermediate"),
      (.littleFingerIntermediateTip, "pinky-finger-phalanx-distal"),
      (.littleFingerTip, "pinky-finger-tip"),
    ]

    /// Whether the device supports ARKit hand tracking.
    public static var isSupported: Bool { HandTrackingProvider.isSupported }

    public init() {}

    /// Creates an `XRHandTrackingSource` and registers it with `XRHandJointSources`.
    @discardableResult
    public static func install() -> XRHandTrackingSource {
      let s = XRHandTrackingSource()
      XRHandJointSources.register(s)
      return s
    }

    public nonisolated func joints(for hand: XRHand) -> XRHandJointMap? {
      jointsLock.lock()
      defer { jointsLock.unlock() }
      return latestJoints[hand]
    }

    public nonisolated func wristPose(for hand: XRHand) -> XRPose? {
      jointsLock.lock()
      defer { jointsLock.unlock() }
      return latestPoses[hand]
    }

    /// Starts hand tracking (prompts for authorization on first use).
    public func start() async throws {
      guard updatesTask == nil else { return }
      try await arSession.run([provider])
      let updates = provider.anchorUpdates
      updatesTask = Task { @MainActor [weak self] in
        for await update in updates {
          guard let self = self else { return }
          if Task.isCancelled { return }
          self.process(update.anchor, removed: update.event == .removed)
        }
      }
    }

    /// Stops hand tracking.
    public func stop() {
      updatesTask?.cancel()
      updatesTask = nil
      arSession.stop()
      handPoses.removeAll()
      jointsLock.lock()
      latestJoints.removeAll()
      latestPoses.removeAll()
      jointsLock.unlock()
      tracker.reset(.left)
      tracker.reset(.right)
    }

    private func process(_ anchor: HandAnchor, removed: Bool) {
      let hand: XRHand = anchor.chirality == .left ? .left : .right
      guard !removed, anchor.isTracked, let skeleton = anchor.handSkeleton else {
        handPoses[hand] = nil
        jointsLock.lock()
        latestJoints[hand] = nil
        latestPoses[hand] = nil
        jointsLock.unlock()
        tracker.reset(hand)
        return
      }
      let origin = anchor.originFromAnchorTransform
      var joints: XRHandJointMap = [:]
      for (name, webName) in Self.jointNames {
        let joint = skeleton.joint(name)
        guard joint.isTracked else { continue }
        let m = origin * joint.anchorFromJointTransform
        joints[webName] = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
      }
      let wrist = origin * skeleton.joint(.wrist).anchorFromJointTransform
      let pose = XRPose(matrix: wrist)
      handPoses[hand] = pose
      jointsLock.lock()
      latestJoints[hand] = joints
      latestPoses[hand] = pose
      jointsLock.unlock()
      onJoints?(hand, joints)
      if let event = tracker.update(hand: hand, joints: joints) {
        onGesture?(event)
      }
    }
  }
#endif
