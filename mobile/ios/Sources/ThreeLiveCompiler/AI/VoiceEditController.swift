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

#if canImport(Speech) && canImport(AVFoundation) && (os(iOS) || os(visionOS))
  import AVFoundation
  import Foundation
  import Speech

  /// Push-to-talk voice editing for iOS / visionOS (B2b-3), like `el.startVoiceEdit()` on the
  /// web: `SFSpeechRecognizer` turns one utterance into an instruction for
  /// `AIEditor.editScene` (applied to the current selection), and the result is spoken with
  /// `AVSpeechSynthesizer`. Needs microphone and speech-recognition usage descriptions.
  ///
  /// Talk-to-Select (B2b-4): "select the red chairs", "also select the lamp", "deselect the left
  /// one", and "clear the selection" change the selection instead of editing; "select the lamp
  /// and make it blue" selects, then edits right away when the reference was unambiguous.
  /// Otherwise it asks which one was meant and changes nothing.
  @MainActor
  public final class VoiceEditController {
    public var onListening: ((String) -> Void)?
    public var onEditing: ((String) -> Void)?
    public var onResult: ((String, EditResult) -> Void)?
    /// The utterance changed (or tried to change) the selection.
    public var onSelection: ((String, AIVoiceSelection) -> Void)?
    public var onError: ((String) -> Void)?

    private let editor: AIEditor
    private let speakResults: Bool
    private let talkToSelect: Bool
    private let recognizer: SFSpeechRecognizer?
    private let engine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var latest = ""

    public init(
      editor: AIEditor, locale: Locale = .current, speakResults: Bool = true, talkToSelect: Bool = true
    ) {
      self.editor = editor
      self.speakResults = speakResults
      self.talkToSelect = talkToSelect
      self.recognizer = SFSpeechRecognizer(locale: locale)
    }

    /// True while listening for an utterance.
    public var isListening: Bool { task != nil }

    /// Requests permission if needed and starts listening for one utterance.
    public func start() {
      guard task == nil else { return }
      guard let recognizer = recognizer, recognizer.isAvailable else {
        onError?("Speech recognition is not available; use AIVoiceSession instead.")
        return
      }
      SFSpeechRecognizer.requestAuthorization { [weak self] status in
        Task { @MainActor in
          guard let self = self else { return }
          guard status == .authorized else {
            self.onError?("Speech recognition permission was denied.")
            return
          }
          self.begin(with: recognizer)
        }
      }
    }

    /// Stops listening and edits with what was heard so far.
    public func stop() {
      engine.stop()
      engine.inputNode.removeTap(onBus: 0)
      request?.endAudio()
    }

    /// Cancels without editing.
    public func cancel() {
      task?.cancel()
      teardown()
    }

    private func begin(with recognizer: SFSpeechRecognizer) {
      let req = SFSpeechAudioBufferRecognitionRequest()
      req.shouldReportPartialResults = true
      request = req
      latest = ""
      let input = engine.inputNode
      let format = input.outputFormat(forBus: 0)
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
        req.append(buffer)
      }
      engine.prepare()
      do {
        try engine.start()
      } catch {
        onError?("Could not start the microphone: \(error.localizedDescription)")
        teardown()
        return
      }
      onListening?("")
      task = recognizer.recognitionTask(with: req) { [weak self] result, error in
        Task { @MainActor in
          guard let self = self else { return }
          if let result = result {
            self.latest = result.bestTranscription.formattedString
            self.onListening?(self.latest)
            if result.isFinal { self.finish() }
          } else if error != nil {
            self.finish()
          }
        }
      }
    }

    private func finish() {
      guard task != nil else { return }
      let text = String(latest.trimmingCharacters(in: .whitespacesAndNewlines).prefix(AIVoiceSession.maxText))
      teardown()
      guard !text.isEmpty else {
        report("I didn't catch that.")
        return
      }
      let editor = self.editor
      let talkToSelect = self.talkToSelect
      Task { @MainActor in
        var instruction = text
        var prefix = ""
        let command = talkToSelect ? await editor.parseCommand(text) : nil
        if let command, command.kind != "edit" {
          let selection = await editor.selectByVoice(
            command.kind == "clear" ? "" : command.query, mode: command.mode)
          self.onSelection?(text, selection)
          // Edit right away only when the reference was resolved locally (tier 1) and confidently.
          guard command.kind == "mixed", selection.applied, selection.tier == 1 else {
            let hint = command.kind == "mixed" && selection.applied ? " Say the change again to apply it." : ""
            if self.speakResults { self.speak(selection.say + hint) }
            return
          }
          instruction = command.instruction
          prefix = selection.say + " "
        }
        self.onEditing?(instruction)
        let result = await editor.editScene(instruction)
        self.onResult?(instruction, result)
        if self.speakResults { self.speak(prefix + (await editor.describe(result))) }
      }
    }

    private func report(_ message: String) {
      onError?(message)
      if speakResults { speak(message) }
    }

    private func speak(_ text: String) {
      synthesizer.stopSpeaking(at: .immediate)
      synthesizer.speak(AVSpeechUtterance(string: text))
    }

    private func teardown() {
      if engine.isRunning {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
      }
      request = nil
      task = nil
    }
  }
#endif
