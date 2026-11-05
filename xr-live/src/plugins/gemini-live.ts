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
 * @fileoverview Spatial `gemini-live` plugin for `<xr-live>`.
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
import {
  type DetectionCamera,
  detectionsFromList,
  detectObjects,
  snapshotDetectionCamera,
} from './world-understanding';

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
      queue.length = 0;
      ws.onopen = ws.onmessage = ws.onclose = null;
      ws.close();
    },
  };
  ws.onopen = () => {
    for (const data of queue.splice(0)) ws.send(data);
  };
  ws.onmessage = async (e: MessageEvent) => {
    // Decoding a Blob can outlive the controller session that received it.
    const onMessage = transport.onMessage;
    try {
      const text = typeof e.data === 'string' ? e.data : await (e.data as Blob).text();
      const parsed: unknown = ws.onmessage && JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        onMessage?.(parsed as Record<string, unknown>);
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
    const ctx = this.ctx;
    this.ctx = null;
    this.flush();
    void ctx?.close?.();
  }
}

/** Name of the opt-in object-detection function exposed to the model. */
export const REPORT_OBJECTS_TOOL = 'report_objects';

/** Maximum function calls handled per `toolCall` message. */
export const MAX_TOOL_CALLS = 8;

/**
 * Live API function declaration for {@link REPORT_OBJECTS_TOOL}: the model
 * reports objects it sees in the latest frame with Gemini's native 0–1000
 * `box_2d` boxes, which the client locates in 3D (`xr-object-detected`).
 */
export const REPORT_OBJECTS_DECLARATION: Readonly<Record<string, unknown>> = {
  name: REPORT_OBJECTS_TOOL,
  description:
    'Reports objects visible in the most recent image of the 3D scene or camera view so the app ' +
    'can locate them in 3D. Call it when the user asks where something is or to find objects.',
  parameters: {
    type: 'OBJECT',
    properties: {
      objects: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            label: {type: 'STRING', description: 'Short name of the object.'},
            box_2d: {
              type: 'ARRAY',
              items: {type: 'NUMBER'},
              description: 'Bounding box [ymin, xmin, ymax, xmax], normalized to 0-1000.',
            },
          },
          required: ['label', 'box_2d'],
        },
      },
    },
    required: ['objects'],
  },
};

/**
 * Returns a copy of `setup` whose `tools` include {@link REPORT_OBJECTS_DECLARATION}
 * (added once). Without a `setup` there is nothing to extend: an
 * ephemeral token must then declare the tool in its locked setup.
 */
export function withDetectionTool(
  setup: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!setup || typeof setup !== 'object') return undefined;
  const tools = Array.isArray(setup['tools']) ? [...(setup['tools'] as unknown[])] : [];
  const declared = tools.some((t) => {
    const decls = (t as {functionDeclarations?: unknown})?.functionDeclarations;
    return Array.isArray(decls) && decls.some((d) => (d as {name?: unknown})?.name === REPORT_OBJECTS_TOOL);
  });
  if (!declared) tools.push({functionDeclarations: [REPORT_OBJECTS_DECLARATION]});
  return {...setup, tools};
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
  /**
   * Expose {@link REPORT_OBJECTS_TOOL} to the model and turn its calls into
   * `xr-object-detected` events, unprojected with the camera of the last
   * frame sent. Default `false`.
   */
  readonly detectObjects?: boolean;
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
  /** Invalidates asynchronous work even when a transport object is reused. */
  private sessionId = 0;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private captureInFlight = false;
  private speakReplies = false;
  private playAudio = true;
  /** Set once output transcription arrives this turn; text parts are then ignored. */
  private turnHasOutputTranscription = false;
  private detectObjects = false;
  /** Camera of the last frame sent, for unprojecting the model's boxes. */
  private frameCamera: DetectionCamera | null = null;
  readonly audio = new PcmPlayer();

  constructor(private readonly element: unknown) {
    if (element && typeof element === 'object' && !controllers.has(element)) {
      controllers.set(element, this);
    }
  }

  /** Whether a transport is currently attached. */
  get connected(): boolean {
    return this.transport !== null;
  }

  /** Connects (replacing any previous session) and starts frame streaming. */
  connect(options: GeminiLiveOptions): void {
    const element = this.element as object;
    const prevCtrl = controllers.get(element);
    const prevTransport = this.transport ?? prevCtrl?.transport;
    const sessionId = this.resetSession(true);
    if (prevCtrl && prevCtrl !== this) {
      controllers.set(element, this);
      prevCtrl.disconnect();
    }
    const activeCtrl = controllers.get(element) ?? this;
    // A close callback or transcript listener may have connected a newer session.
    if (this.sessionId !== sessionId || activeCtrl !== this) {
      if (options.transport !== activeCtrl.transport && options.transport !== prevTransport) {
        options.transport?.close();
      }
      return;
    }
    const transport =
      options.transport ?? (options.url ? createWebSocketTransport(options.url) : null);
    if (!transport) throw new Error('gemini-live: provide a transport or url');
    this.transport = transport;
    const isCurrentSession = this.sessionGuard();
    this.speakReplies = options.speakReplies === true;
    this.playAudio = options.playAudio !== false;
    this.detectObjects = options.detectObjects === true;
    this.frameCamera = null;
    transport.onMessage = (m) => {
      if (isCurrentSession()) this.handleServerMessage(m);
    };
    transport.onClose = () => {
      if (isCurrentSession()) this.resetSession(false);
    };
    const setup = this.detectObjects ? withDetectionTool(options.setup) : options.setup;
    try {
      if (setup) transport.send({setup});
    } catch (err) {
      if (isCurrentSession()) this.resetSession(true);
      throw err;
    }
    if (options.streamFrames !== false && isCurrentSession()) {
      const interval = clampNum(options.frameIntervalMs, 250, 10000, 1000);
      this.frameTimer = setInterval(() => {
        if (isCurrentSession()) void this.sendFrame();
      }, interval);
    }
  }

  /** A callback lease; replacement and remote closure revoke it. */
  sessionGuard(): () => boolean {
    const id = this.sessionId;
    return () => this.sessionId === id;
  }

  /** Stops streaming and closes the transport. */
  disconnect(): void {
    if (this.transport || holdState.has(this.element as object)) this.resetSession(true);
  }

  private resetSession(closeTransport: boolean): number {
    const id = ++this.sessionId;
    if (this.frameTimer !== null) clearInterval(this.frameTimer);
    const transport = this.transport;
    this.frameTimer = this.frameCamera = this.transport = null;
    this.captureInFlight = false;
    this.turnHasOutputTranscription = false;
    const finalized = this.transcripts.finalize();
    const element = this.element as object;
    const hold = holdState.get(element);
    holdState.delete(element);
    // Detach old state before invoking any external cleanup or event listener.
    this.audio.close();
    if (this.sessionId === id) cancelSpeech();
    cancelHold(hold);
    if (closeTransport && this.transport !== transport) transport?.close();
    for (const event of finalized) {
      if (this.sessionId !== id) break;
      this.emitTranscript(event);
    }
    return id;
  }

  /** Captures one frame; the originating session owns its admission lock. */
  async sendFrame(): Promise<boolean> {
    const host = this.element as CaptureHost;
    const transport = this.transport;
    const current = this.sessionGuard();
    if (!transport || this.captureInFlight || typeof host?.captureViewFrame !== 'function') return false;
    this.captureInFlight = true;
    try {
      const camera = this.detectObjects ? snapshotDetectionCamera(this.element) : null;
      const frame = await host.captureViewFrame({format: 'image/jpeg', quality: 0.6});
      if (!frame?.base64 || !current()) return false;
      this.frameCamera = camera;
      transport.send({realtimeInput: {mediaChunks: [{mimeType: frame.mimeType, data: frame.base64}]}});
      return true;
    } catch {
      return false;
    } finally {
      if (current()) this.captureInFlight = false;
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

  /** Sends a completed user text turn; the wire format is unchanged. */
  sendText(text: string): void {
    if (!this.transport) return;
    const clipped = String(text ?? '').slice(0, MAX_TEXT_CHARS);
    if (!clipped) return;
    this.transport.send({clientContent: {turns: [{role: 'user', parts: [{text: clipped}]}], turnComplete: true}});
  }

  /** Processes one server message (exposed for custom transports and tests). */
  handleServerMessage(message: Record<string, unknown>): void {
    if (!this.transport) return;
    // Event listeners may synchronously disconnect or replace this session.
    const isCurrentSession = this.sessionGuard();
    const toolCall = message?.['toolCall'];
    if (toolCall && typeof toolCall === 'object') {
      this.handleToolCall(toolCall as Record<string, unknown>, isCurrentSession);
    }
    if (!isCurrentSession()) return;
    const content = message?.['serverContent'] as Record<string, unknown> | undefined;
    if (!content || typeof content !== 'object') return;
    if (content['interrupted'] === true) {
      cancelSpeech();
      this.audio.flush();
      emitPluginEvent(this.element, 'xr-gemini-interrupted', {});
      if (!isCurrentSession()) return;
    }
    const input = (content['inputTranscription'] as {text?: unknown})?.text;
    if (typeof input === 'string' && input) this.emitTranscript(this.transcripts.append('user', input));
    if (!isCurrentSession()) return;
    const output = (content['outputTranscription'] as {text?: unknown})?.text;
    if (typeof output === 'string' && output) {
      this.turnHasOutputTranscription = true;
      this.emitTranscript(this.transcripts.append('model', output));
      if (!isCurrentSession()) return;
    }
    const parts = (content['modelTurn'] as {parts?: unknown})?.parts;
    if (Array.isArray(parts)) {
      for (const part of parts) {
        if (!isCurrentSession()) return;
        const text = (part as {text?: unknown})?.text;
        // In AUDIO mode the transcript comes from outputTranscription; avoid
        // double-appending any accompanying text parts.
        if (typeof text === 'string' && text && !this.turnHasOutputTranscription) {
          this.emitTranscript(this.transcripts.append('model', text));
          if (!isCurrentSession()) return;
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
    if (content['turnComplete'] === true && isCurrentSession()) {
      this.turnHasOutputTranscription = false;
      for (const ev of this.transcripts.finalize()) {
        if (!isCurrentSession()) return;
        this.emitTranscript(ev);
        if (isCurrentSession() && ev.speaker === 'model' && this.speakReplies) speak(ev.text);
      }
    }
  }

  /**
   * Answers {@link REPORT_OBJECTS_TOOL} calls (when `detectObjects` is on). The
   * arguments are untrusted model output: only labels and boxes are read,
   * through the same validation as the `detections` prop. Other functions
   * are left to the host.
   */
  private handleToolCall(toolCall: Record<string, unknown>, isCurrentSession: () => boolean): void {
    const calls = toolCall['functionCalls'];
    const transport = this.transport;
    if (!this.detectObjects || !transport || !Array.isArray(calls)) return;
    const functionResponses: Array<Record<string, unknown>> = [];
    for (const call of calls.slice(0, MAX_TOOL_CALLS)) {
      const c = call as {id?: unknown; name?: unknown; args?: unknown} | null;
      if (c?.name !== REPORT_OBJECTS_TOOL) continue;
      const objects = (c.args as {objects?: unknown} | null)?.objects;
      const located = detectObjects(
        this.element, detectionsFromList(objects), this.frameCamera ?? undefined, isCurrentSession,
      );
      if (!isCurrentSession()) return;
      const response: Record<string, unknown> = {name: REPORT_OBJECTS_TOOL, response: {ok: true, located: located.length}};
      if (typeof c.id === 'string') response['id'] = c.id.slice(0, 256);
      functionResponses.push(response);
    }
    if (functionResponses.length) transport.send({toolResponse: {functionResponses}});
  }

  private emitTranscript(ev: TranscriptEvent): void {
    emitPluginEvent(this.element, 'xr-transcription', ev);
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
  recognizer: Recognition | null;
  active: boolean;
  hand: string;
}

const holdState = new WeakMap<object, HoldState>();

function cancelHold(state: HoldState | undefined): void {
  if (!state) return;
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = null;
  state.active = false;
  const rec = state.recognizer;
  state.recognizer = null;
  if (rec) {
    rec.onresult = null;
    if (rec.abort) rec.abort();
    else rec.stop?.();
  }
}
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the Gemini Live controller for `element`. */
export function getGeminiLiveController(element: object): XRGeminiLiveController {
  return controllers.get(element) ?? new XRGeminiLiveController(element);
}

/** Convenience: connects `element` to Gemini Live and returns its controller. */
export function connectGeminiLive(element: object, options: GeminiLiveOptions): XRGeminiLiveController {
  const c = getGeminiLiveController(element);
  c.connect(options);
  return c;
}

interface Recognition {
  stop?: () => void;
  abort?: () => void;
  onresult: ((event: unknown) => void) | null;
}

function startRecognition(onText: (text: string) => void): Recognition | null {
  const g = globalThis as Record<string, unknown>;
  const Ctor = (g['SpeechRecognition'] ?? g['webkitSpeechRecognition']) as
    | (new () => {lang: string; interimResults: boolean; onresult: ((e: unknown) => void) | null; start(): void; stop(): void; abort?(): void})
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

function finishHold(element: object, meshName: string, options: HoldToAskOptions, transcript: string, current: () => boolean): void {
  if (!current()) return;
  const prompt = buildHoldToAskPrompt(meshName, options, transcript);
  emitPluginEvent(element, 'xr-hold-to-ask', {mesh: meshName, transcript, prompt});
  if (current()) controllers.get(element)?.sendText(prompt);
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
      const session = getGeminiLiveController(element).sessionGuard();
      const state: HoldState = {timer: null, recognizer: null, active: true, hand: detail?.hand ?? 'screen'};
      const current = () => state.active && holdState.get(element) === state && session();
      cancelHold(holdState.get(element));
      holdState.set(element, state);
      state.timer = setTimeout(() => {
        state.timer = null;
        if (!current()) return;
        emitPluginEvent(element, 'xr-hold-to-ask-listening', {mesh: name});
        if (!current()) return;
        const complete = (text: string) => {
          finishHold(element, name, options, text, current);
          if (holdState.get(element) === state) {
            holdState.delete(element);
            cancelHold(state);
          }
        };
        state.recognizer = startRecognition(complete);
        if (!current()) cancelHold(state);
        else if (!state.recognizer) complete('');
      }, options.holdMs);
    };
    const onEnd = (e: Event): void => {
      const state = holdState.get(element);
      const hand = (e as CustomEvent<SelectDetail>).detail?.hand ?? 'screen';
      if (!state || state.hand !== hand) return;
      // A normal release may deliver final speech. Cancellation/reconnect uses
      // cancelHold instead, revoking the callback before aborting recognition.
      if (state.recognizer) state.recognizer.stop?.();
      else {
        holdState.delete(element);
        cancelHold(state);
      }
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
