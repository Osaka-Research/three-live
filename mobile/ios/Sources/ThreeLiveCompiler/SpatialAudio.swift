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

// 3D Positional & Directional Spatial Audio engine for iOS / visionOS (`spatial-audio` plugin
// parity). Ports `computeSpatialAudioMix()`, `renderAmbientLoopPcm()`, and
// `XRSpatialAudioEmitterController` from `three-live/src/xr-trait-schema.ts` and
// `xr-live/src/plugins/spatial-audio.ts`.

import Foundation
import simd

#if canImport(AVFoundation)
  import AVFoundation
#endif

public enum SpatialAudio {

  private static let twoPi = 2.0 * Double.pi

  /// All 8 built-in procedural ambient loop presets.
  public static let ambientPresets: [String] = [
    "hum", "reactor", "wind", "beacon", "geiger", "chimeLoop", "machinery", "water",
  ]

  /// Evaluated 3D spatial audio mix for a single emitter at a listener pose.
  public struct Mix: Sendable, Equatable {
    public var gain: Float
    public var pan: Float
    public var leftGain: Float
    public var rightGain: Float
    public var distance: Float
    public var coneAttenuation: Float

    public init(
      gain: Float,
      pan: Float,
      leftGain: Float,
      rightGain: Float,
      distance: Float,
      coneAttenuation: Float
    ) {
      self.gain = gain
      self.pan = pan
      self.leftGain = leftGain
      self.rightGain = rightGain
      self.distance = distance
      self.coneAttenuation = coneAttenuation
    }
  }

  /// Pure 3D spatial audio distance, directional cone, and constant-power stereo pan law matching
  /// TypeScript `computeSpatialAudioMix()` and Kotlin `SpatialAudio.computeMix()` to `1e-5`.
  public static func computeMix(
    listenerPos: SIMD3<Float>,
    listenerForward: SIMD3<Float> = SIMD3<Float>(0, 0, -1),
    listenerRight: SIMD3<Float> = SIMD3<Float>(1, 0, 0),
    emitterPos: SIMD3<Float>,
    emitterForward: SIMD3<Float> = SIMD3<Float>(0, 0, 1),
    opts: XRLiveAudioEmitter
  ) -> Mix {
    _ = listenerForward
    let vol = Double(min(2.0, max(0.0, opts.volume)))
    if opts.type == "global" {
      let s = Float(sqrt(0.5) * vol)
      return Mix(
        gain: Float(vol),
        pan: 0,
        leftGain: s,
        rightGain: s,
        distance: 0,
        coneAttenuation: 1
      )
    }

    let dx = Double(emitterPos.x - listenerPos.x)
    let dy = Double(emitterPos.y - listenerPos.y)
    let dz = Double(emitterPos.z - listenerPos.z)
    let distance = sqrt(dx * dx + dy * dy + dz * dz)
    let dRef = max(1e-4, Double(opts.refDistance))
    let dMax = max(dRef, Double(opts.maxDistance))
    let rolloff = max(0.0, Double(opts.rolloffFactor))
    let dClamped = min(dMax, max(dRef, distance))

    var distGain: Double
    switch opts.distanceModel {
    case "linear":
      let span = dMax - dRef
      distGain = span > 1e-6 ? 1.0 - rolloff * ((dClamped - dRef) / span) : 1.0
    case "exponential":
      distGain = pow(dClamped / dRef, -rolloff)
    default:
      distGain = dRef / (dRef + rolloff * (dClamped - dRef))
    }
    distGain = distGain.isFinite ? min(1.0, max(0.0, distGain)) : 0.0

    var coneAttenuation = 1.0
    let innerDeg = min(360.0, max(0.0, Double(opts.coneInnerAngle)))
    let outerDeg = min(360.0, max(innerDeg, Double(opts.coneOuterAngle)))
    if distance > 1e-6 && (innerDeg < 360.0 || outerDeg < 360.0) {
      let efx = Double(emitterForward.x)
      let efy = Double(emitterForward.y)
      let efz = Double(emitterForward.z)
      let efLenRaw = sqrt(efx * efx + efy * efy + efz * efz)
      let efLen = efLenRaw > 0.0 ? efLenRaw : 1.0
      let toLx = -dx / distance
      let toLy = -dy / distance
      let toLz = -dz / distance
      let cosTheta = min(
        1.0,
        max(-1.0, (efx * toLx + efy * toLy + efz * toLz) / efLen)
      )
      let angleDeg = acos(cosTheta) * 180.0 / Double.pi
      let halfInner = innerDeg * 0.5
      let halfOuter = outerDeg * 0.5
      let outerGain = min(1.0, max(0.0, Double(opts.coneOuterGain)))
      if angleDeg <= halfInner {
        coneAttenuation = 1.0
      } else if angleDeg >= halfOuter {
        coneAttenuation = outerGain
      } else {
        let t = (angleDeg - halfInner) / max(1e-6, halfOuter - halfInner)
        coneAttenuation = 1.0 + (outerGain - 1.0) * t
      }
    }

    var pan = 0.0
    if distance > 1e-6 {
      let lrx = Double(listenerRight.x)
      let lry = Double(listenerRight.y)
      let lrz = Double(listenerRight.z)
      let lrLenRaw = sqrt(lrx * lrx + lry * lry + lrz * lrz)
      let lrLen = lrLenRaw > 0.0 ? lrLenRaw : 1.0
      let dotRight = (dx * lrx + dy * lry + dz * lrz) / (distance * lrLen)
      pan = dotRight.isFinite ? min(1.0, max(-1.0, dotRight)) : 0.0
    }

    let gain = vol * distGain * coneAttenuation
    let panAngle = ((pan + 1.0) * Double.pi) / 4.0
    return Mix(
      gain: Float(gain),
      pan: Float(pan),
      leftGain: Float(gain * cos(panAngle)),
      rightGain: Float(gain * sin(panAngle)),
      distance: Float(distance),
      coneAttenuation: Float(coneAttenuation)
    )
  }

  /// Synthesizes a deterministic, phase-locked 16-bit mono PCM buffer for any built-in ambient loop
  /// preset (`hum`, `reactor`, `wind`, `beacon`, `geiger`, `chimeLoop`, `machinery`, `water`) or
  /// one-shot cue, matching TypeScript and Kotlin.
  public static func renderAmbientLoopPCM16(
    preset: String,
    sampleRate: Int = 22050,
    durationSec: Double = 2.0
  ) -> [Int16] {
    let sr = min(48000, max(8000, sampleRate))
    let dur = min(10.0, max(0.25, durationSec))
    let n = max(64, Int((Double(sr) * dur).rounded()))
    var out = [Int16](repeating: 0, count: n)
    func cyc(_ hz: Double) -> Double {
      (twoPi * Double(max(1, Int((hz * dur).rounded())))) / Double(n)
    }

    let notes: [Double] = [523.25, 659.25, 783.99, 1046.5]
    let clickSlots: [Double] = [0.05, 0.14, 0.19, 0.33, 0.47, 0.52, 0.68, 0.81, 0.91]

    for i in 0..<n {
      let di = Double(i)
      let u = di / Double(n)
      let s: Double
      switch preset {
      case "hum":
        let lfo = 0.85 + 0.15 * cos(twoPi * u)
        s =
          lfo
          * (0.6 * sin(cyc(60.0) * di) + 0.28 * sin(cyc(120.0) * di) + 0.12 * sin(cyc(180.0) * di))
      case "reactor":
        let pulse = 0.75 + 0.25 * cos(2.0 * twoPi * u)
        s =
          pulse
          * (0.42 * sin(cyc(55.0) * di) + 0.38 * sin(cyc(56.5) * di) + 0.14 * sin(cyc(110.0) * di)
            + 0.06 * sin(cyc(220.0) * di))
      case "wind":
        let gust = 0.55 + 0.3 * cos(twoPi * u) + 0.15 * sin(2.0 * twoPi * u)
        var sum = 0.0
        for k in 1...12 {
          let freq = 140.0 + Double(k) * 47.0 + Double(k % 3) * 19.0
          let phase = Double(k) * 1.37
          sum += sin(cyc(freq) * di + phase) / (1.0 + Double(k) * 0.25)
        }
        s = gust * sum * 0.32
      case "beacon":
        let pingPhase = (u * 2.0).truncatingRemainder(dividingBy: 1.0)
        let env = sin(Double.pi * pingPhase) * exp(-5.5 * pingPhase)
        s = env * (0.75 * sin(cyc(880.0) * di) + 0.25 * sin(cyc(1760.0) * di))
      case "geiger":
        var acc = 0.0
        for c in 0..<clickSlots.count {
          var d = u - clickSlots[c]
          if d < 0.0 { d += 1.0 }
          let dtSec = d * dur
          if dtSec >= 0.0 && dtSec < 0.018 {
            let env = sin((Double.pi * dtSec) / 0.018) * exp(-180.0 * dtSec)
            acc += env * sin(cyc(2200.0 + Double(c) * 130.0) * di)
          }
        }
        s = acc * 0.85 + 0.04 * sin(cyc(60.0) * di)
      case "chimeLoop":
        let slot = Int(floor(u * Double(notes.count))) % notes.count
        let localU = (u * Double(notes.count)).truncatingRemainder(dividingBy: 1.0)
        let env = sin(Double.pi * localU) * exp(-3.2 * localU)
        let f = notes[slot]
        s =
          env
          * (0.68 * sin(cyc(f) * di) + 0.22 * sin(cyc(f * 2.0) * di) + 0.1 * sin(cyc(f * 3.0) * di))
      case "machinery":
        let chug = 0.62 + 0.38 * cos(8.0 * twoPi * u)
        s =
          chug
          * (0.48 * sin(cyc(36.0) * di) + 0.3 * sin(cyc(72.0) * di) + 0.14 * sin(cyc(144.0) * di)
            + 0.08 * sin(cyc(360.0) * di))
      case "water":
        var drops = 0.0
        for k in 0..<6 {
          var d = u - Double(k) / 6.0
          if d < 0.0 { d += 1.0 }
          let local = d * 6.0
          if local < 1.0 {
            let env = sin(Double.pi * local) * exp(-3.0 * local)
            let f = 420.0 + Double(k) * 75.0
            drops += env * sin(cyc(f) * di + 1.5 * sin(cyc(f * 0.5) * di))
          }
        }
        let stream = 0.18 * sin(cyc(190.0) * di) + 0.12 * sin(cyc(310.0) * di)
        s = 0.55 * drops + stream
      default:
        let env = sin(Double.pi * u) * exp(-4.0 * u)
        let baseHz: Double
        switch preset {
        case "error", "fail": baseHz = 220.0
        case "alarm", "warning": baseHz = 660.0
        case "pickup", "powerup", "pass": baseHz = 880.0
        default: baseHz = 520.0
        }
        s = env * (0.7 * sin(cyc(baseHz) * di) + 0.3 * sin(cyc(baseHz * 1.5) * di))
      }

      let clamped = min(0.95, max(-0.95, s))
      out[i] = Int16((clamped * 32767.0).rounded())
    }

    let fadeLen = min(16, n / 4)
    let startVal = Double(out[0])
    for k in 0..<fadeLen {
      let idx = n - fadeLen + k
      let alpha = Double(k + 1) / Double(fadeLen + 1)
      out[idx] = Int16((Double(out[idx]) * (1.0 - alpha) + startVal * alpha).rounded())
    }
    return out
  }

  /// Synthesizes a normalized `[-1, 1]` float PCM buffer for `AVAudioPCMBuffer`.
  public static func renderAmbientLoopPCM(
    preset: String,
    sampleRate: Int = 22050,
    durationSec: Double = 2.0
  ) -> [Float] {
    renderAmbientLoopPCM16(preset: preset, sampleRate: sampleRate, durationSec: durationSec).map {
      Float($0) / 32768.0
    }
  }

  /// Runtime state for a single node's 3D audio emitter.
  public struct EmitterState: Sendable, Equatable {
    public let nodeIndex: Int
    public let nodeName: String
    public let options: XRLiveAudioEmitter
    public var playing: Bool
    public var triggerCount: Int
    public var lastMix: Mix
  }

  /// Event payload delivered when an emitter is triggered via `select()` or `trigger()`.
  public struct PlayEvent: Sendable, Equatable {
    public let nodeIndex: Int
    public let nodeName: String
    public let preset: String?
    public let src: String?
    public let gain: Float
    public let pan: Float
    public let triggerCount: Int
  }

  /// Per-session 3D spatial audio controller tracking `XRLiveNodeTraits.audioEmitter` (and legacy
  /// `XRLiveNodeTraits.audio`) across node world transforms and listener head poses.
  public final class EmitterController {
    private let session: XRLiveRuntimeSession
    private var emitters: [Int: EmitterState] = [:]
    private var muted = false
    public var onAudioPlay: ((PlayEvent) -> Void)?

    public init(session: XRLiveRuntimeSession, onAudioPlay: ((PlayEvent) -> Void)? = nil) {
      self.session = session
      self.onAudioPlay = onAudioPlay
      syncFromSession()
    }

    /// Discovers or refreshes emitters from `session`.
    public func syncFromSession() {
      var seen = Set<Int>()
      for i in 0..<session.nodeCount {
        guard let t = session.traits(at: i) else { continue }
        let opts: XRLiveAudioEmitter
        if let ae = t.audioEmitter {
          opts = ae
        } else if let legacy = t.audio {
          opts = XRLiveAudioEmitter(
            src: legacy.src,
            loop: legacy.loop,
            refDistance: min(100.0, max(0.05, legacy.refDistance))
          )
        } else {
          continue
        }
        seen.insert(i)
        if emitters[i] == nil {
          let name = session.nodeName(at: i) ?? "Node_\(i)"
          let m = session.worldMatrix(of: i)
          let ePos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
          let rawFwd = SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z)
          let fLen = simd_length(rawFwd)
          let eFwd = fLen > 1e-6 ? rawFwd / fLen : SIMD3<Float>(0, 0, 1)
          let initialMix = computeMix(
            listenerPos: SIMD3<Float>(0, 1.6, 0),
            emitterPos: ePos,
            emitterForward: eFwd,
            opts: opts
          )
          emitters[i] = EmitterState(
            nodeIndex: i,
            nodeName: name,
            options: opts,
            playing: opts.autoplay,
            triggerCount: opts.autoplay ? 1 : 0,
            lastMix: initialMix
          )
        }
      }
      for k in Array(emitters.keys) where !seen.contains(k) {
        emitters.removeValue(forKey: k)
      }
    }

    /// Returns all tracked emitter states keyed by `nodeIndex`.
    public var allEmitters: [Int: EmitterState] { emitters }

    /// Returns the latest `Mix` for `nodeIndex`.
    public func mix(forNode nodeIndex: Int) -> Mix? {
      emitters[nodeIndex]?.lastMix
    }

    /// Returns the latest `Mix` for `nodeName`.
    public func mix(named nodeName: String) -> Mix? {
      emitters.values.first(where: { $0.nodeName == nodeName })?.lastMix
    }

    /// Mutes or unmutes all emitters.
    public func setMuted(_ muted: Bool) {
      self.muted = muted
    }

    /// Evaluates 3D distance, cone attenuation, and stereo pan for every emitter given the listener
    /// pose.
    public func step(
      listenerPos: SIMD3<Float> = SIMD3<Float>(0, 1.6, 0),
      listenerForward: SIMD3<Float> = SIMD3<Float>(0, 0, -1),
      listenerRight: SIMD3<Float>? = nil
    ) {
      let lRight: SIMD3<Float>
      if let lr = listenerRight {
        lRight = lr
      } else {
        let rx = -listenerForward.z
        let rz = listenerForward.x
        let len = hypot(rx, rz)
        lRight = len > 1e-5 ? SIMD3<Float>(rx / len, 0, rz / len) : SIMD3<Float>(1, 0, 0)
      }
      for (idx, var state) in emitters {
        let m = session.worldMatrix(of: idx)
        let ePos = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
        let rawFwd = SIMD3<Float>(m.columns.2.x, m.columns.2.y, m.columns.2.z)
        let fLen = simd_length(rawFwd)
        let eFwd = fLen > 1e-6 ? rawFwd / fLen : SIMD3<Float>(0, 0, 1)
        let evaluated = computeMix(
          listenerPos: listenerPos,
          listenerForward: listenerForward,
          listenerRight: lRight,
          emitterPos: ePos,
          emitterForward: eFwd,
          opts: state.options
        )
        if state.playing && !muted {
          state.lastMix = evaluated
        } else {
          state.lastMix = Mix(
            gain: 0,
            pan: evaluated.pan,
            leftGain: 0,
            rightGain: 0,
            distance: evaluated.distance,
            coneAttenuation: evaluated.coneAttenuation
          )
        }
        emitters[idx] = state
      }
    }

    /// Handles a user tap/select on `nodeIndex`, triggering `playOnSelect` (or non-autoplay)
    /// emitters and firing `onAudioPlay`.
    @discardableResult
    public func select(nodeIndex: Int) -> Mix? {
      guard let state = emitters[nodeIndex] else { return nil }
      if !state.options.playOnSelect && state.options.autoplay {
        return state.lastMix
      }
      return trigger(nodeIndex: nodeIndex)
    }

    /// Unconditionally triggers or retriggers `nodeIndex` and invokes `onAudioPlay`.
    @discardableResult
    public func trigger(nodeIndex: Int) -> Mix? {
      guard var state = emitters[nodeIndex] else { return nil }
      state.playing = true
      state.triggerCount += 1
      emitters[nodeIndex] = state
      onAudioPlay?(
        PlayEvent(
          nodeIndex: state.nodeIndex,
          nodeName: state.nodeName,
          preset: state.options.preset,
          src: state.options.src,
          gain: state.lastMix.gain,
          pan: state.lastMix.pan,
          triggerCount: state.triggerCount
        ))
      return state.lastMix
    }
  }

  #if canImport(AVFoundation)
    /// Optional `AVAudioEngine` / `AVAudioPlayerNode` loop player for Apple platforms.
    public final class Player {
      private let engine = AVAudioEngine()
      private let playerNode = AVAudioPlayerNode()
      private var started = false

      public init() {
        engine.attach(playerNode)
      }

      @discardableResult
      public func playLoop(preset: String, mix: Mix, sampleRate: Double = 22050) -> Bool {
        let samples = renderAmbientLoopPCM(preset: preset, sampleRate: Int(sampleRate))
        guard
          let format = AVAudioFormat(
            standardFormatWithSampleRate: sampleRate,
            channels: 1
          ),
          let buffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(samples.count)
          ),
          let channel = buffer.floatChannelData?[0]
        else { return false }
        buffer.frameLength = AVAudioFrameCount(samples.count)
        for i in 0..<samples.count { channel[i] = samples[i] }

        if !started {
          engine.connect(playerNode, to: engine.mainMixerNode, format: format)
          do {
            try engine.start()
            started = true
          } catch {
            return false
          }
        }
        playerNode.volume = mix.gain
        playerNode.pan = mix.pan
        playerNode.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
        playerNode.play()
        return true
      }

      public func update(mix: Mix) {
        playerNode.volume = mix.gain
        playerNode.pan = mix.pan
      }

      public func stop() {
        playerNode.stop()
        if started {
          engine.stop()
          started = false
        }
      }
    }
  #endif
}
