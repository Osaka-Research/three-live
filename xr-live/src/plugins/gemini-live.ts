/**
 * @license
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
 *
 * @fileoverview XR Blocks `gemini-live` plugin for `<xr-live>`.
 *
 * Coordinates a multimodal Gemini Live session from an XR scene:
 * (frames are captures of the rendered 3D canvas, i.e. virtual content only;
 * WebXR does not expose the passthrough camera image to pages)
 * - Streams the XR viewport at a fixed cadence (default 1 Hz) plus optional
 *   16-bit PCM microphone chunks over a pluggable transport.
 * - Tracks live input/output transcriptions and emits `xr-transcription`
 *   (`{speaker, text, isFinal}`) on the host element.
 * - Handles barge-in (`interrupted`) by cancelling local speech playback.
 * - Implements press-and-hold "ask about this object" for meshes tagged with
 *   `userData.xr.holdToAsk`, emitting `xr-hold-to-ask`.
 *
 * API keys never belong in client code: connect through your own backend, or
 * use a short-lived ephemeral token in the `wss://` URL your server mints.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {type HoldToAskOptions, parseHoldToAsk} from '../../../three-live/src/xr-trait-schema';
import {getMeshXRTraits} from '../xr-traits';
import {clampNum, emitPluginEvent, isEventClaimed} from './common';

/** Maximum characters of any single transcript or prompt forwarded. */
export const MAX_TEXT_CHARS = 4000;

/** Speaker attribution for a transcription segment. */
export type TranscriptSpeaker = 'user' | 'model';

/** Payload of the `xr-transcription` event. */
export interface TranscriptEvent {
  readonly speaker: TranscriptSpeaker;
  readonly text: string;
  readonly isFinal: boolean;
}

/** Bidirectional transport to a Gemini Live (or compatible) backend. */
export interface GeminiLiveTransport {
  send(message: Record<string, unknown>): void;
  close(): void;
  /** Set by the controller; invoked with each parsed server message. */
  onMessage?: (message: Record<string, unknown>) => void;
  /** Set by the controller; invoked once when the transport closes. */
  onClose?: () => void;
}

/**
 * Validates a Live API endpoint. Only `wss:` is accepted, except `ws:` on
 * loopback hosts for local development.
 */
export function isAllowedLiveUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'wss:') return true;
    return (
      url.protocol === 'ws:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

/** Creates a JSON-over-WebSocket transport for a validated `wss:` URL. */
export function createWebSocketTransport(url: string): GeminiLiveTransport {
  if (!isAllowedLiveUrl(url)) {
    throw new Error('gemini-live: only wss:// (or loopback ws://) endpoints are allowed');
  }
  const ws = new WebSocket(url);
  const queue: string[] = [];
  const transport: GeminiLiveTransport = {
    send(message) {
      const data = JSON.stringify(message);
      if (ws.readyState === 1) ws.send(data);
      else if (ws.readyState === 0 && queue.length < 64) queue.push(data);
    },
    close() {
      ws.close();
    },
  };
  ws.onopen = () => {
    for (const data of queue.splice(0)) ws.send(data);
  };
  ws.onmessage = async (e: MessageEvent) => {
    try {
      const text = typeof e.data === 'string' ? e.data : await (e.data as Blob).text();
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        transport.onMessage?.(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed frames from the server.
    }
  };
  ws.onclose = () => transport.onClose?.();
  return transport;
}

/** Encodes bytes as base64 without exceeding call-stack argument limits. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Accumulates streaming transcription fragments per speaker. */
export class TranscriptionManager {
  private readonly partial: Record<TranscriptSpeaker, string> = {user: '', model: ''};

  /** Appends a fragment and returns the updated (non-final) segment. */
  append(speaker: TranscriptSpeaker, fragment: string): TranscriptEvent {
    const next = (this.partial[speaker] + fragment).slice(-MAX_TEXT_CHARS);
    this.partial[speaker] = next;
    return {speaker, text: next, isFinal: false};
  }

  /** Finalizes and clears every non-empty segment. */
  finalize(): TranscriptEvent[] {
    const out: TranscriptEvent[] = [];
    for (const speaker of ['user', 'model'] as const) {
      if (this.partial[speaker]) {
        out.push({speaker, text: this.partial[speaker], isFinal: true});
        this.partial[speaker] = '';
      }
    }
    return out;
  }
}

/** Parses the sample rate from an `audio/pcm;rate=N` MIME type. */
export function pcmRateFromMime(mime: unknown, fallback = 24000): number {
  const m = /rate=(\d+)/.exec(typeof mime === 'string' ? mime : '');
  return m ? clampNum(Number(m[1]), 8000, 48000, fallback) : fallback;
}

/** Decodes base64 16-bit little-endian PCM into normalized float samples. */
export function decodePcm16Base64(b64: string): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8);
    if (v & 0x8000) v -= 0x10000;
    out[i] = v / 32768;
  }
  return out;
}

/**
 * Gapless queue for streamed model audio (`modelTurn.parts[].inlineData`),
 * flushed immediately on barge-in.
 */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private playhead = 0;
  private readonly sources = new Set<AudioBufferSourceNode>();

  /** Schedules one PCM chunk after any queued audio. */
  enqueue(samples: Float32Array, sampleRate: number): void {
    if (samples.length === 0) return;
    const Ctor = (globalThis as {AudioContext?: typeof AudioContext}).AudioContext;
    if (!this.ctx && typeof Ctor === 'function') {
      try {
        this.ctx = new Ctor();
      } catch {
        return;
      }
    }
    const ctx = this.ctx;
    if (!ctx) return;
    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, this.playhead);
    src.start(start);
    this.playhead = start + buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  /** Stops and drops all queued audio. */
  flush(): void {
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear();
    this.playhead = 0;
  }

  /** Releases the audio context. */
  close(): void {
    this.flush();
    void this.ctx?.close?.();
    this.ctx = null;
  }
}

/** Options for {@link XRGeminiLiveController.connect}. */
export interface GeminiLiveOptions {
  /** Pre-built transport (preferred), or... */
  readonly transport?: GeminiLiveTransport;
  /** ...a `wss://` endpoint (e.g. your proxy or an ephemeral-token URL). */
  readonly url?: string;
  /** Optional `setup` message sent first (model, system instruction, ...). */
  readonly setup?: Record<string, unknown>;
  /** Viewport frame cadence in ms (clamped to 250–10000). Default 1000. */
  readonly frameIntervalMs?: number;
  /** Set to `false` to disable viewport streaming. Default `true`. */
  readonly streamFrames?: boolean;
  /** Speak model text replies with `speechSynthesis`. Default `false`. */
  readonly speakReplies?: boolean;
  /** Play streamed model audio (`inlineData` PCM). Default `true`. */
  readonly playAudio?: boolean;
}

interface CaptureHost {
  captureViewFrame?: (opts: Record<string, unknown>) => Promise<{base64: string; mimeType: string}>;
}

/**
 * Coordinates frame/audio streaming, transcription, and barge-in for one
 * `<xr-live>` element.
 */
export class XRGeminiLiveController {
  readonly transcripts = new TranscriptionManager();
  private transport: GeminiLiveTransport | null = null;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private captureInFlight = false;
  private speakReplies = false;
  private playAudio = true;
  /** Set once output transcription arrives this turn; text parts are then ignored. */
  private turnHasOutputTranscription = false;
  readonly audio = new PcmPlayer();

  constructor(private readonly element: unknown) {}

  /** Whether a transport is currently attached. */
  get connected(): boolean {
    return this.transport !== null;
  }

  /** Connects (replacing any previous session) and starts frame streaming. */
  connect(options: GeminiLiveOptions): void {
    this.disconnect();
    const transport =
      options.transport ?? (options.url ? createWebSocketTransport(options.url) : null);
    if (!transport) throw new Error('gemini-live: provide a transport or url');
    this.transport = transport;
    this.speakReplies = options.speakReplies === true;
    this.playAudio = options.playAudio !== false;
    transport.onMessage = (m) => this.handleServerMessage(m);
    transport.onClose = () => {
      if (this.transport === transport) this.stopFrames();
      if (this.transport === transport) this.transport = null;
    };
    if (options.setup) transport.send({setup: options.setup});
    if (options.streamFrames !== false) {
      const interval = clampNum(options.frameIntervalMs, 250, 10000, 1000);
      this.frameTimer = setInterval(() => void this.sendFrame(), interval);
    }
  }

  /** Stops streaming and closes the transport. */
  disconnect(): void {
    this.stopFrames();
    const t = this.transport;
    this.transport = null;
    t?.close();
    this.audio.close();
    for (const ev of this.transcripts.finalize()) this.emitTranscript(ev);
  }

  /** Captures and sends one viewport frame; skipped while one is in flight. */
  async sendFrame(): Promise<boolean> {
    const host = this.element as CaptureHost;
    if (!this.transport || this.captureInFlight || typeof host?.captureViewFrame !== 'function') {
      return false;
    }
    this.captureInFlight = true;
    try {
      const frame = await host.captureViewFrame({format: 'image/jpeg', quality: 0.6});
      if (!frame?.base64 || !this.transport) return false;
      this.transport.send({
        realtimeInput: {mediaChunks: [{mimeType: frame.mimeType, data: frame.base64}]},
      });
      return true;
    } catch {
      return false;
    } finally {
      this.captureInFlight = false;
    }
  }

  /** Sends a chunk of 16-bit little-endian mono PCM microphone audio. */
  sendAudioChunk(pcm16: Int16Array, sampleRate = 16000): void {
    if (!this.transport || !(pcm16 instanceof Int16Array)) return;
    const rate = Math.round(clampNum(sampleRate, 8000, 48000, 16000));
    const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
    this.transport.send({
      realtimeInput: {mediaChunks: [{mimeType: `audio/pcm;rate=${rate}`, data: bytesToBase64(bytes)}]},
    });
  }

  /** Sends a completed user text turn. */
  sendText(text: string): void {
    if (!this.transport) return;
    const clipped = String(text ?? '').slice(0, MAX_TEXT_CHARS);
    if (!clipped) return;
    this.transport.send({
      clientContent: {turns: [{role: 'user', parts: [{text: clipped}]}], turnComplete: true},
    });
  }

  /** Processes one server message (exposed for custom transports and tests). */
  handleServerMessage(message: Record<string, unknown>): void {
    const content = message['serverContent'] as Record<string, unknown> | undefined;
    if (!content || typeof content !== 'object') return;
    if (content['interrupted'] === true) {
      cancelSpeech();
      this.audio.flush();
      emitPluginEvent(this.element, 'xr-gemini-interrupted', {});
    }
    const input = (content['inputTranscription'] as {text?: unknown})?.text;
    if (typeof input === 'string' && input) this.emitTranscript(this.transcripts.append('user', input));
    const output = (content['outputTranscription'] as {text?: unknown})?.text;
    if (typeof output === 'string' && output) {
      this.turnHasOutputTranscription = true;
      this.emitTranscript(this.transcripts.append('model', output));
    }
    const parts = (content['modelTurn'] as {parts?: unknown})?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        const text = (part as {text?: unknown})?.text;
        // In AUDIO mode the transcript comes from outputTranscription; avoid
        // double-appending any accompanying text parts.
        if (typeof text === 'string' && text && !this.turnHasOutputTranscription) {
          this.emitTranscript(this.transcripts.append('model', text));
        }
        const inline = (part as {inlineData?: {mimeType?: unknown; data?: unknown}})?.inlineData;
        if (
          this.playAudio &&
          typeof inline?.data === 'string' &&
          typeof inline.mimeType === 'string' &&
          inline.mimeType.startsWith('audio/pcm') &&
          inline.data.length <= 8 * 1024 * 1024
        ) {
          try {
            this.audio.enqueue(decodePcm16Base64(inline.data), pcmRateFromMime(inline.mimeType));
          } catch {
            // Ignore malformed audio chunks.
          }
        }
      }
    }
    if (content['turnComplete'] === true) {
      this.turnHasOutputTranscription = false;
      for (const ev of this.transcripts.finalize()) {
        this.emitTranscript(ev);
        if (ev.speaker === 'model' && this.speakReplies) speak(ev.text);
      }
    }
  }

  private emitTranscript(ev: TranscriptEvent): void {
    emitPluginEvent(this.element, 'xr-transcription', ev);
  }

  private stopFrames(): void {
    if (this.frameTimer !== null) clearInterval(this.frameTimer);
    this.frameTimer = null;
  }
}

function speak(text: string): void {
  const synth = (globalThis as {speechSynthesis?: SpeechSynthesis}).speechSynthesis;
  const Utterance = (globalThis as {SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance})
    .SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== 'function') return;
  synth.speak(new Utterance(text.slice(0, MAX_TEXT_CHARS)));
}

function cancelSpeech(): void {
  (globalThis as {speechSynthesis?: SpeechSynthesis}).speechSynthesis?.cancel?.();
}

export {parseHoldToAsk};
export type {HoldToAskOptions};

/** Builds the text prompt sent for a hold-to-ask query. */
export function buildHoldToAskPrompt(
  meshName: string,
  options: HoldToAskOptions,
  transcript = '',
): string {
  const name = String(meshName ?? '').slice(0, 256) || 'object';
  const spoken = String(transcript ?? '').trim();
  return `The user is pointing at the 3D object "${name}". ${spoken || options.prompt}`.slice(
    0,
    MAX_TEXT_CHARS,
  );
}

const controllers = new WeakMap<object, XRGeminiLiveController>();
interface HoldState {
  timer: ReturnType<typeof setTimeout> | null;
  recognizer: {stop?: () => void} | null;
  hand: string;
}

const holdState = new WeakMap<object, HoldState>();

function cancelHold(state: HoldState | undefined): void {
  if (!state) return;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  state.recognizer?.stop?.();
}
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the Gemini Live controller for `element`. */
export function getGeminiLiveController(element: object): XRGeminiLiveController {
  let c = controllers.get(element);
  if (!c) {
    c = new XRGeminiLiveController(element);
    controllers.set(element, c);
  }
  return c;
}

/** Convenience: connects `element` to Gemini Live and returns its controller. */
export function connectGeminiLive(element: object, options: GeminiLiveOptions): XRGeminiLiveController {
  const c = getGeminiLiveController(element);
  c.connect(options);
  return c;
}

function startRecognition(onText: (text: string) => void): {stop?: () => void} | null {
  const g = globalThis as Record<string, unknown>;
  const Ctor = (g['SpeechRecognition'] ?? g['webkitSpeechRecognition']) as
    | (new () => {lang: string; interimResults: boolean; onresult: ((e: unknown) => void) | null; start(): void; stop(): void})
    | undefined;
  if (typeof Ctor !== 'function') return null;
  try {
    const rec = new Ctor();
    rec.interimResults = false;
    rec.onresult = (e: unknown) => {
      const results = (e as {results?: ArrayLike<ArrayLike<{transcript?: string}>>})?.results;
      const text = results?.[0]?.[0]?.transcript;
      if (typeof text === 'string') onText(text);
    };
    rec.start();
    return rec;
  } catch {
    return null;
  }
}

interface SelectDetail {
  readonly hand?: string;
  readonly hit?: {mesh?: {name?: string}} | null;
}

function finishHold(element: object, meshName: string, options: HoldToAskOptions, transcript: string): void {
  const prompt = buildHoldToAskPrompt(meshName, options, transcript);
  emitPluginEvent(element, 'xr-hold-to-ask', {mesh: meshName, transcript, prompt});
  controllers.get(element)?.sendText(prompt);
}

/** `ThreeLivePlugin` wiring press-and-hold object queries to Gemini Live. */
export const geminiLivePlugin: ThreeLivePlugin = {
  name: 'xr-live-gemini-live',
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element || typeof element.addEventListener !== 'function' || listeners.has(element)) return;
    const onStart = (e: Event): void => {
      if (isEventClaimed(e)) return;
      const detail = (e as CustomEvent<SelectDetail>).detail;
      const mesh = detail?.hit?.mesh;
      const options = parseHoldToAsk(mesh ? getMeshXRTraits(mesh)?.holdToAsk : null);
      if (!mesh || !options) return;
      const name = mesh.name ?? '';
      const state: HoldState = {timer: null, recognizer: null, hand: detail?.hand ?? 'screen'};
      cancelHold(holdState.get(element));
      holdState.set(element, state);
      state.timer = setTimeout(() => {
        state.timer = null;
        emitPluginEvent(element, 'xr-hold-to-ask-listening', {mesh: name});
        state.recognizer = startRecognition((text) => finishHold(element, name, options, text));
        if (!state.recognizer) finishHold(element, name, options, '');
      }, options.holdMs);
    };
    const onEnd = (e: Event): void => {
      const state = holdState.get(element);
      const hand = (e as CustomEvent<SelectDetail>).detail?.hand ?? 'screen';
      if (!state || state.hand !== hand) return;
      // stop() on a running recognizer delivers its final result first.
      cancelHold(state);
      holdState.delete(element);
    };
    const bound: Array<[string, EventListener]> = [
      ['xr-select-start', onStart],
      ['xr-select-end', onEnd],
    ];
    for (const [name, fn] of bound) element.addEventListener(name, fn);
    listeners.set(element, bound);
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    for (const [name, fn] of listeners.get(element) ?? []) element.removeEventListener?.(name, fn);
    listeners.delete(element);
    cancelHold(holdState.get(element));
    holdState.delete(element);
    controllers.get(element)?.disconnect();
  },
};
