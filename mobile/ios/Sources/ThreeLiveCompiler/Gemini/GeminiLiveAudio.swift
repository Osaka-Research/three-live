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

// AVFoundation audio for the native Gemini Live client: model audio playback and microphone
// streaming. Apps must declare NSMicrophoneUsageDescription (and, for hold-to-ask speech,
// NSSpeechRecognitionUsageDescription) in Info.plist.

import Foundation

#if canImport(AVFoundation) && !os(tvOS) && !os(watchOS)
  import AVFoundation

  /// Plays streamed 16-bit PCM model audio through `AVAudioEngine`; `flush()` stops immediately.
  public final class AVAudioPcmSink: PcmAudioSink, @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let queue = DispatchQueue(label: "three-live.gemini.audio")
    private var format: AVAudioFormat?

    public init() {
      engine.attach(player)
    }

    public func enqueue(_ pcm16le: Data, sampleRate: Int) {
      queue.async { [self] in
        let frames = pcm16le.count / 2
        guard frames > 0,
          let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(sampleRate), channels: 1, interleaved: false),
          let buffer = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(frames)),
          let out = buffer.floatChannelData?[0]
        else { return }
        buffer.frameLength = AVAudioFrameCount(frames)
        pcm16le.withUnsafeBytes { raw in
          for i in 0..<frames {
            let lo = UInt16(raw[i * 2])
            let hi = UInt16(raw[i * 2 + 1])
            out[i] = Float(Int16(bitPattern: lo | (hi << 8))) / 32768
          }
        }
        if format?.sampleRate != fmt.sampleRate {
          engine.stop()
          engine.disconnectNodeOutput(player)
          engine.connect(player, to: engine.mainMixerNode, format: fmt)
          format = fmt
        }
        if !engine.isRunning {
          do { try engine.start() } catch { return }
        }
        player.scheduleBuffer(buffer, completionHandler: nil)
        if !player.isPlaying { player.play() }
      }
    }

    public func flush() {
      queue.async { [self] in
        player.stop()
      }
    }

    public func close() {
      queue.async { [self] in
        player.stop()
        engine.stop()
      }
    }
  }

  /// Streams 16 kHz mono PCM16 microphone audio to an `XRGeminiLiveController`.
  public final class MicrophoneStreamer: @unchecked Sendable {
    private let sampleRate: Double
    private let onChunk: (Data) -> Void
    private let engine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var running = false

    /// Streams 16 kHz audio to a Gemini Live `controller`.
    public convenience init(controller: XRGeminiLiveController) {
      self.init(sampleRate: 16_000) { controller.sendAudioChunk($0, sampleRate: 16_000) }
    }

    /// Streams mono PCM16 chunks at `sampleRate` to `onChunk` (e.g. `AIVoiceSession.sendAudio`).
    public init(sampleRate: Int, onChunk: @escaping (Data) -> Void) {
      self.sampleRate = Double(sampleRate)
      self.onChunk = onChunk
    }

    /// Starts capturing (the system prompts for microphone permission on first use).
    public func start() throws {
      guard !running else { return }
      let input = engine.inputNode
      let inFormat = input.outputFormat(forBus: 0)
      guard
        let outFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sampleRate, channels: 1, interleaved: true),
        let conv = AVAudioConverter(from: inFormat, to: outFormat)
      else { return }
      converter = conv
      let onChunk = self.onChunk
      let outRate = sampleRate
      input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { buffer, _ in
        let ratio = outRate / inFormat.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 16)
        guard let out = AVAudioPCMBuffer(pcmFormat: outFormat, frameCapacity: capacity) else { return }
        var fed = false
        var error: NSError?
        conv.convert(to: out, error: &error) { _, status in
          if fed {
            status.pointee = .noDataNow
            return nil
          }
          fed = true
          status.pointee = .haveData
          return buffer
        }
        guard error == nil, out.frameLength > 0, let ch = out.int16ChannelData?[0] else { return }
        onChunk(Data(bytes: ch, count: Int(out.frameLength) * 2))
      }
      engine.prepare()
      try engine.start()
      running = true
    }

    /// Stops capturing.
    public func stop() {
      guard running else { return }
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
      running = false
    }
  }
#endif

#if canImport(Speech) && os(iOS)
  import Speech

  /// Hold-to-ask: transcribes speech with `SFSpeechRecognizer` while a `holdToAsk` node is held,
  /// then sends the web-compatible prompt. Without speech authorization the default prompt is sent.
  @MainActor
  public final class HoldToAskController {
    /// `{mesh, transcript, prompt}` (the web `xr-hold-to-ask` detail).
    public var onHoldToAsk: ((_ mesh: String, _ transcript: String, _ prompt: String) -> Void)?

    private let controller: XRGeminiLiveController
    private let recognizer = SFSpeechRecognizer()
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var mesh = ""
    private var options = XRLiveHoldToAsk()
    private var transcript = ""

    public init(controller: XRGeminiLiveController) {
      self.controller = controller
    }

    /// Starts listening for `meshName`.
    public func begin(meshName: String?, options: XRLiveHoldToAsk) {
      cancel()
      mesh = meshName ?? ""
      self.options = options
      transcript = ""
      guard SFSpeechRecognizer.authorizationStatus() == .authorized, let recognizer = recognizer,
        recognizer.isAvailable
      else { return }
      let req = SFSpeechAudioBufferRecognitionRequest()
      req.shouldReportPartialResults = true
      let input = audioEngine.inputNode
      input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
        req.append(buffer)
      }
      audioEngine.prepare()
      do { try audioEngine.start() } catch {
        input.removeTap(onBus: 0)
        return
      }
      request = req
      task = recognizer.recognitionTask(with: req) { [weak self] result, _ in
        guard let text = result?.bestTranscription.formattedString else { return }
        Task { @MainActor in self?.transcript = text }
      }
    }

    /// The press ended: sends the query with whatever was transcribed.
    public func end() {
      stopAudio()
      let prompt = XRGeminiLiveController.buildHoldToAskPrompt(meshName: mesh, options: options, transcript: transcript)
      controller.sendText(prompt)
      onHoldToAsk?(mesh, String(transcript.prefix(XRGeminiLiveController.maxTextChars)), prompt)
    }

    /// Abandons the press without sending.
    public func cancel() {
      stopAudio()
      task?.cancel()
      task = nil
    }

    private func stopAudio() {
      if audioEngine.isRunning {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
      }
      request?.endAudio()
      request = nil
    }
  }
#endif
