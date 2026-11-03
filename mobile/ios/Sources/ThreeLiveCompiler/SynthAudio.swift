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

// `synth-audio` for `XRSimWorld` (port of xr-live/src/sim/synth-audio.ts and
// SynthAudio.kt). Maps sim events to procedural cues through each node's
// `audioCues` trait and reports them via `XRSimWorldDelegate.simAudioCue`.
// `renderPCM` synthesizes a cue with the same recipes as the web runtime, and
// `SynthAudio.Player` plays it with AVAudioEngine.

import AVFoundation
import Foundation

public enum SynthAudio {
  /// One oscillator or noise voice of a cue.
  public struct Voice: Equatable, Sendable {
    /// `sine`, `square`, `triangle`, `sawtooth`, or `noise`.
    public let wave: String
    public let f0: Double
    public let at: Double
    public let dur: Double
    public var gain = 0.3
    public var f1: Double?
    /// `lowpass`, `bandpass`, or `highpass` for noise voices.
    public var filter: String?
  }

  public static let alarmRepeatMs = 500.0
  private static let key = "synth-audio"

  private static func v(
    _ wave: String, _ f0: Double, _ at: Double, _ dur: Double, _ gain: Double, _ f1: Double? = nil,
    _ filter: String? = nil
  ) -> Voice {
    Voice(wave: wave, f0: f0, at: at, dur: dur, gain: gain, f1: f1, filter: filter)
  }

  private static func seq(_ wave: String, _ freqs: [Double], _ step: Double, _ gain: Double)
    -> [Voice]
  {
    freqs.enumerated().map { v(wave, $0.element, Double($0.offset) * step, step, gain) }
  }

  /// Synthesis recipe per cue (identical to the web and Android runtimes).
  public static let recipes: [String: [Voice]] = [
    "confirm": seq("sine", [660, 880], 0.08, 0.3),
    "error": seq("square", [330, 247], 0.09, 0.18),
    "alarm": [v("square", 880, 0, 0.25, 0.18), v("square", 660, 0.25, 0.25, 0.18)],
    "warning": [v("triangle", 520, 0, 0.2, 0.35)],
    "pickup": [v("square", 987.77, 0, 0.06, 0.2), v("square", 1318.51, 0.06, 0.22, 0.2)],
    "jump": [v("triangle", 180, 0, 0.14, 0.35, 520)],
    "beam": [v("sawtooth", 880, 0, 0.11, 0.2, 110)],
    "impact": [
      v("noise", 1200, 0, 0.09, 0.4, nil, "bandpass"), v("triangle", 120, 0, 0.09, 0.4, 45),
    ],
    "burst": [v("noise", 2000, 0, 0.45, 0.5, 200, "lowpass")],
    "powerup": seq("square", [523.25, 659.25, 783.99, 1046.5], 0.07, 0.2),
    "step": [v("noise", 2500, 0, 0.04, 0.25, nil, "bandpass")],
    "pass": seq("triangle", [523.25, 659.25, 783.99, 1046.5], 0.1, 0.3),
    "fail": seq("sine", [392, 311.13, 261.63], 0.133, 0.3),
  ]

  /// Total duration of a cue in seconds.
  public static func duration(_ cue: String) -> Double {
    recipes[cue]?.map { $0.at + $0.dur }.max() ?? 0
  }

  /// Renders `cue` to mono Float32 samples in -1...1 at `sampleRate`. Deterministic.
  public static func renderPCM(
    _ cue: String, sampleRate: Int = 44100, pitch: Double = 1, gain: Double = 1
  ) -> [Float] {
    guard let voices = recipes[cue] else { return [] }
    let rate = Double(Swift.max(8000, Swift.min(96000, sampleRate)))
    let total = Int(duration(cue) * rate) + 1
    var mix = [Double](repeating: 0, count: total)
    var seed: UInt32 = 0x2545_f491
    for vo in voices {
      let start = Int(vo.at * rate)
      let n = Swift.max(1, Int(vo.dur * rate))
      var phase = 0.0
      var x1 = 0.0
      var x2 = 0.0
      var y1 = 0.0
      var y2 = 0.0
      let peak = Swift.max(1e-4, vo.gain * gain)
      for i in 0..<n {
        let t = Double(i) / rate
        let u = Double(i) / Double(n)
        let f = vo.f0 * pitch * (vo.f1.map { pow($0 / vo.f0, u) } ?? 1)
        let env =
          t < 0.005
          ? peak * (t / 0.005)
          : peak * pow(1e-4 / peak, (t - 0.005) / Swift.max(1e-3, vo.dur - 0.005))
        var s: Double
        if vo.wave == "noise" {
          seed = seed &* 1_103_515_245 &+ 12345
          let x = Double((seed >> 8) & 0xffff) / 32768 - 1
          let w = 2 * Double.pi * Swift.min(f, rate * 0.45) / rate
          let alpha = sin(w) / (2 * 0.707)
          let cw = cos(w)
          let b: (Double, Double, Double)
          switch vo.filter {
          case "highpass": b = ((1 + cw) / 2, -(1 + cw), (1 + cw) / 2)
          case "bandpass": b = (alpha, 0, -alpha)
          default: b = ((1 - cw) / 2, 1 - cw, (1 - cw) / 2)
          }
          let y = (b.0 * x + b.1 * x1 + b.2 * x2 + 2 * cw * y1 - (1 - alpha) * y2) / (1 + alpha)
          x2 = x1
          x1 = x
          y2 = y1
          y1 = y
          s = y
        } else {
          phase += f / rate
          let p = phase - phase.rounded(.down)
          switch vo.wave {
          case "square": s = p < 0.5 ? 1 : -1
          case "triangle": s = 1 - 4 * abs(p - 0.5)
          case "sawtooth": s = 2 * p - 1
          default: s = sin(2 * .pi * p)
          }
        }
        let idx = start + i
        if idx < total { mix[idx] += s * env }
      }
    }
    return mix.map { Float(Swift.max(-1, Swift.min(1, $0))) }
  }

  /// Stereo pan (-1...1) and distance gain for world point `pos` relative to the head.
  public static func spatialize(_ world: XRSimWorld, _ pos: SIMD3<Double>) -> (
    pan: Double, gain: Double
  ) {
    let head = world.headPosition()
    let f = world.cameraForwardXZ()
    let r = pos - head
    let d = (r.x * r.x + r.y * r.y + r.z * r.z).squareRoot()
    let pan = d > 1e-6 ? (r.x * -f.z + r.z * f.x) / d : 0
    return (Swift.max(-1, Swift.min(1, pan)), 1 / (1 + Swift.max(0, d - 1) * 0.5))
  }

  /// Reports `cue` for `source`; returns `false` when audio is disabled.
  @discardableResult
  public static func play(_ world: XRSimWorld, _ cue: String, source: XRSimWorld.Body? = nil)
    -> Bool
  {
    guard world.audioEnabled, recipes[cue] != nil else { return false }
    let opts = source?.traits.audioCues
    let jitter = opts?.pitchJitter ?? 0
    let pitch = 1 + Double.random(in: -1...1) * jitter
    var gain = opts?.volume ?? 1
    var pan = 0.0
    if let s = source, opts?.spatial != false {
      let sp = spatialize(world, s.worldCenter())
      pan = sp.pan
      gain *= sp.gain
    }
    world.delegate?.simAudioCue(cue, pan: pan, gain: gain, pitch: pitch)
    return true
  }

  final class State {
    var unsubs: [() -> Void] = []
    var alarms: [ObjectIdentifier: (body: XRSimWorld.Body, count: Int, nextMs: Double)] = [:]
  }

  private static func cue(_ b: XRSimWorld.Body?, _ event: String) -> String? {
    b?.traits.audioCues?.cues[event]
  }

  private static func state(_ world: XRSimWorld) -> State {
    if let st = world.state[key] as? State { return st }
    let st = State()
    world.state[key] = st
    func map(_ type: String, _ event: String) {
      st.unsubs.append(
        world.on(type) { [weak world] _, body, _ in
          guard let world = world, let c = cue(body, event) else { return }
          play(world, c, source: body)
        })
    }
    map("xrhit", "onHit")
    map("xrdepleted", "onDepleted")
    map("xrspawn", "onSpawn")
    map("characterjump", "onJump")
    map("characterland", "onLand")
    map("xrzoneexit", "onZoneExit")
    st.unsubs.append(
      world.on("xrzoneenter") { [weak world, weak st] _, z, _ in
        guard let world = world, let st = st, let z = z, let c = cue(z, "onZoneEnter") else {
          return
        }
        if c == "alarm" {
          let id = ObjectIdentifier(z)
          var a = st.alarms[id] ?? (z, 0, world.timeMs)
          a.count += 1
          st.alarms[id] = a
        } else {
          play(world, c, source: z)
        }
      })
    st.unsubs.append(
      world.on("xrzoneexit") { [weak st] _, z, _ in
        guard let st = st, let z = z, var a = st.alarms[ObjectIdentifier(z)] else { return }
        a.count -= 1
        st.alarms[ObjectIdentifier(z)] = a.count <= 0 ? nil : a
      })
    st.unsubs.append(
      world.on("xrobjective") { [weak world] d, body, _ in
        guard let world = world else { return }
        if XRJSON.bool(d["outOfOrder"]) == true {
          play(world, "error", source: body)
        } else if let c = cue(body, "onObjective") {
          play(world, c, source: body)
        }
      })
    st.unsubs.append(
      world.on("xrscenarioend") { [weak world] d, _, _ in
        guard let world = world else { return }
        play(world, XRJSON.string(d["outcome"]) == "pass" ? "pass" : "fail")
      })
    return st
  }

  static func step(_ world: XRSimWorld, _ dt: Double) {
    guard world.audioEnabled else { return }
    let st = state(world)
    for (id, a) in st.alarms {
      if a.body.hidden || !world.bodies.contains(where: { $0 === a.body }) {
        st.alarms[id] = nil
      } else if world.timeMs >= a.nextMs {
        st.alarms[id] = (a.body, a.count, world.timeMs + alarmRepeatMs)
        play(world, "alarm", source: a.body)
      }
    }
  }

  static func select(_ world: XRSimWorld, _ body: XRSimWorld.Body?) {
    guard world.audioEnabled else { return }
    _ = state(world)
    if let c = cue(body, "onTap") { play(world, c, source: body) }
  }

  static func reset(_ world: XRSimWorld) {
    (world.state[key] as? State)?.alarms.removeAll()
  }

  /// Plays rendered cues through AVAudioEngine, reusing idle player nodes (at most 8).
  public final class Player {
    private let engine = AVAudioEngine()
    private let format: AVAudioFormat?
    private let sampleRate: Double
    private var nodes: [AVAudioPlayerNode] = []
    /// Host time (seconds) when each node's current cue finishes.
    private var busyUntil: [TimeInterval] = []
    private static let maxNodes = 8

    public init(sampleRate: Double = 44100) {
      self.sampleRate = sampleRate
      format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 2)
    }

    /// Plays `cue` with the `pan` / `gain` / `pitch` from `simAudioCue`.
    public func play(_ cue: String, pan: Double, gain: Double, pitch: Double) {
      guard let format = format else { return }
      let pcm = SynthAudio.renderPCM(cue, sampleRate: Int(sampleRate), pitch: pitch)
      guard !pcm.isEmpty,
        let buffer = AVAudioPCMBuffer(
          pcmFormat: format, frameCapacity: AVAudioFrameCount(pcm.count)),
        let ch = buffer.floatChannelData
      else { return }
      buffer.frameLength = AVAudioFrameCount(pcm.count)
      let l = Float(Swift.max(0, Swift.min(1, gain * (1 - Swift.max(0, pan)))))
      let r = Float(Swift.max(0, Swift.min(1, gain * (1 + Swift.min(0, pan)))))
      for i in 0..<pcm.count {
        ch[0][i] = pcm[i] * l
        ch[1][i] = pcm[i] * r
      }
      // `isPlaying` stays true after a buffer finishes, so track finish times instead.
      let now = ProcessInfo.processInfo.systemUptime
      let node: AVAudioPlayerNode
      let slot: Int
      if let idle = busyUntil.firstIndex(where: { $0 <= now }) {
        slot = idle
        node = nodes[idle]
      } else if nodes.count < Self.maxNodes {
        node = AVAudioPlayerNode()
        engine.attach(node)
        engine.connect(node, to: engine.mainMixerNode, format: format)
        nodes.append(node)
        busyUntil.append(0)
        slot = nodes.count - 1
      } else {
        return
      }
      busyUntil[slot] = now + Double(pcm.count) / sampleRate + 0.05
      do {
        if !engine.isRunning { try engine.start() }
      } catch {
        return
      }
      node.stop()
      node.scheduleBuffer(buffer, completionHandler: nil)
      node.play()
    }
  }
}
