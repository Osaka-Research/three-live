/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview "Tap & Speak" voice scene editing for `<three-live>` and
 * `<xr-live>` (part of `three-live-ai.min.js`, roadmap item B2b).
 *
 * - `ai-select-on-tap`: tapping a mesh sets `el.selectedMesh` (tap it again
 *   to clear), so "make this red" knows what "this" is.
 * - `el.startVoiceEdit()`: push-to-talk. The OS speech recognizer (Web Speech
 *   API) turns one utterance into an `editScene` instruction, and the result
 *   is spoken back.
 * - `el.connectVoice({provider, url})`: a realtime voice conversation over
 *   `ai-realtime` (any server speaking the Realtime WebSocket event protocol)
 *   or `gemini-live` (`BidiGenerateContent`). The voice model talks; when the
 *   user asks for a change it calls the `edit_scene` tool, which runs
 *   `editScene` with the element's code model (`ai-chat` / `el.aiProvider`),
 *   so code quality never depends on the voice model.
 * - `ai-voice-button`: a built-in mic button (or bring your own with
 *   `slot="voice-button"`).
 *
 * API keys never belong in page code: point `url` at your own backend proxy or
 * at a short-lived ephemeral-token URL your server mints.
 */

import type {EditSceneResult, ThreeLiveAIProvider} from './ai';

/** Voice protocols supported by {@link connectVoice}. */
export type AIVoiceProviderName = 'ai-realtime' | 'gemini-live';

/** States reported by `three-live-voice` events. */
export type AIVoiceState =
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'editing'
  | 'speaking'
  | 'idle'
  | 'closed'
  | 'error';

/** Payload of the `three-live-voice` event. */
export interface AIVoiceEventDetail {
  readonly state: AIVoiceState;
  /** User speech recognized so far (or the final utterance). */
  readonly transcript?: string;
  /** Model speech transcript (realtime sessions). */
  readonly reply?: string;
  readonly isFinal?: boolean;
  readonly result?: EditSceneResult;
  readonly error?: string;
}

/** Bidirectional JSON message transport (a WebSocket by default). */
export interface AIVoiceTransport {
  send(message: Record<string, unknown>): void;
  close(): void;
  /** Set by the session; invoked with each parsed server message. */
  onMessage?: (message: Record<string, unknown>) => void;
  /** Set by the session; invoked once when the transport closes. */
  onClose?: () => void;
}

/** A function the voice model may call. */
export interface AIVoiceTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** Normalized server event produced by an {@link AIVoiceAdapter}. */
export type AIVoiceServerEvent =
  | {readonly type: 'audio'; readonly base64: string; readonly rate: number}
  | {
      readonly type: 'transcript';
      readonly speaker: 'user' | 'model';
      readonly text: string;
      readonly isFinal: boolean;
    }
  | {
      readonly type: 'toolCall';
      readonly id: string;
      readonly name: string;
      readonly args: Record<string, unknown>;
    }
  | {readonly type: 'interrupted'}
  | {readonly type: 'turnComplete'}
  | {readonly type: 'error'; readonly message: string};

/** Configuration handed to {@link AIVoiceAdapter.setup}. */
export interface AIVoiceSetup {
  readonly instructions: string;
  readonly tools: readonly AIVoiceTool[];
  readonly model?: string;
  readonly voice?: string;
  /** Provider-specific overrides merged into the setup message. */
  readonly overrides?: Record<string, unknown>;
}

/** Maps the neutral session onto one wire protocol. */
export interface AIVoiceAdapter {
  readonly name: string;
  /** Microphone sample rate the protocol expects. */
  readonly inputRate: number;
  setup(config: AIVoiceSetup): Array<Record<string, unknown>>;
  audio(pcm16Base64: string): Record<string, unknown>;
  text(text: string, respond: boolean): Array<Record<string, unknown>>;
  toolResult(
    id: string,
    name: string,
    output: Record<string, unknown>,
  ): Array<Record<string, unknown>>;
  parse(message: Record<string, unknown>): AIVoiceServerEvent[];
}

/** Options for {@link connectVoice}. */
export interface AIVoiceSessionOptions {
  /** Wire protocol (default `ai-realtime`). */
  readonly provider?: AIVoiceProviderName;
  /** `wss://` endpoint (your proxy or an ephemeral-token URL). */
  readonly url?: string;
  /** Pre-built transport (overrides `url`). */
  readonly transport?: AIVoiceTransport;
  readonly model?: string;
  readonly voice?: string;
  /** Extra system instructions for the voice model. */
  readonly instructions?: string;
  /**
   * Provider-specific fields deep-merged into the setup / session message, e.g.
   * `{audio: {input: {transcription: {model: '...'}}}}` to enable user
   * transcripts on an `ai-realtime` server.
   */
  readonly session?: Record<string, unknown>;
  /** Capture and stream the microphone (default true). */
  readonly microphone?: boolean;
  /** Play the model's audio (default true). */
  readonly playAudio?: boolean;
  /** Code model for `edit_scene` (defaults to `el.aiProvider` / `ai-*`). */
  readonly editProvider?: ThreeLiveAIProvider;
  /** Custom microphone source (tests, or audio from elsewhere). */
  readonly microphoneSource?: AIMicrophoneSource;
  /** Custom audio sink (tests, or native playback). */
  readonly audioSink?: AIAudioSink;
}

/** Streams 16-bit PCM microphone chunks. */
export interface AIMicrophoneSource {
  start(rate: number, onChunk: (pcm16Base64: string) => void): Promise<void>;
  stop(): void;
}

/** Plays streamed 16-bit PCM audio. */
export interface AIAudioSink {
  play(pcm16Base64: string, rate: number): void;
  flush(): void;
  close(): void;
}

/** Options for {@link startVoiceEdit}. */
export interface AIVoiceEditOptions {
  /** BCP-47 language tag (default: the page language). */
  readonly lang?: string;
  /** Speak the result with `speechSynthesis` (default true). */
  readonly speak?: boolean;
  readonly signal?: AbortSignal;
  /** Custom recognizer (defaults to `SpeechRecognition`). */
  readonly recognizer?: AISpeechRecognizer;
}

/** One-utterance speech recognizer. */
export interface AISpeechRecognizer {
  listen(options: {
    lang?: string;
    signal?: AbortSignal;
    onPartial?: (text: string) => void;
  }): Promise<string>;
}

/** Result of {@link startVoiceEdit}. */
export interface AIVoiceEditResult {
  readonly transcript: string;
  readonly result: EditSceneResult;
}

/** The element surface voice editing relies on. */
export interface AIVoiceElement {
  selectedMesh?: string | null;
  aiProvider?: ThreeLiveAIProvider;
  getAttribute?(name: string): string | null;
  hasAttribute?(name: string): boolean;
  addEventListener?(type: string, fn: (e: Event) => void): void;
  removeEventListener?(type: string, fn: (e: Event) => void): void;
  appendChild?(node: unknown): unknown;
  querySelector?(selector: string): unknown;
  fireEvent?(type: string, detail?: unknown): void;
  editScene?: (
    instruction: string,
    options?: {provider?: ThreeLiveAIProvider; signal?: AbortSignal},
  ) => Promise<EditSceneResult>;
  undoEdit?: () => Promise<boolean>;
  __tlVoiceSession?: AIVoiceSession | null;
  __tlTapHandler?: ((e: Event) => void) | null;
  __tlVoiceButton?: HTMLElement | null;
}

/** Longest instruction or transcript forwarded. */
export const MAX_VOICE_TEXT = 2000;
const MAX_TOOL_CALLS = 8;

/** Tools exposed to the voice model. */
export const VOICE_TOOLS: readonly AIVoiceTool[] = [
  {
    name: 'edit_scene',
    description:
      'Change the 3D scene the user is looking at. Call this whenever the user asks to add, remove, move, resize, recolor, or otherwise modify anything. Pass their request as a clear, self-contained instruction. If they selected a mesh, "this" or "it" refers to that mesh; the tool knows which one.',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: 'The requested change, e.g. "make the roof red".',
        },
      },
      required: ['instruction'],
    },
  },
  {
    name: 'undo_edit',
    description: 'Undo the last scene change.',
    parameters: {type: 'object', properties: {}},
  },
];

const VOICE_INSTRUCTIONS = [
  'You are a voice assistant inside a live 3D scene editor.',
  'Keep spoken replies short: one sentence.',
  'To change the scene, call edit_scene with the request; never describe code.',
  'After a tool result, say briefly what changed, or why it could not be done.',
].join(' ');

/** Returns true for `wss:` URLs (or `ws:` on loopback). */
export function isAllowedVoiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'wss:') return true;
    return (
      url.protocol === 'ws:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Creates a JSON-over-WebSocket transport for a validated URL. */
export function createVoiceWebSocket(url: string): AIVoiceTransport {
  if (!isAllowedVoiceUrl(url)) {
    throw new Error(
      'connectVoice: url must be wss:// (or ws:// on localhost).',
    );
  }
  const ws = new WebSocket(url);
  const queue: string[] = [];
  const transport: AIVoiceTransport = {
    send(message) {
      const data = JSON.stringify(message);
      if (ws.readyState === 1) ws.send(data);
      else if (ws.readyState === 0 && queue.length < 256) queue.push(data);
    },
    close() {
      queue.length = 0;
      ws.onopen = ws.onmessage = ws.onclose = null;
      ws.close();
      transport.onClose?.();
    },
  };
  ws.onopen = () => {
    for (const data of queue.splice(0)) ws.send(data);
  };
  ws.onmessage = async (e: MessageEvent) => {
    const onMessage = transport.onMessage;
    try {
      const text =
        typeof e.data === 'string' ? e.data : await (e.data as Blob).text();
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        onMessage?.(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed frames.
    }
  };
  ws.onclose = () => transport.onClose?.();
  return transport;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Deep-merges plain-object `overrides` into `base` (arrays and values replace). */
export function mergeSession(
  base: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {...base};
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    const prev = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) &&
      prev && typeof prev === 'object' && !Array.isArray(prev)
        ? mergeSession(prev as Record<string, unknown>, v as Record<string, unknown>)
        : v;
  }
  return out;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return obj(raw);
  try {
    return obj(JSON.parse(str(raw) || '{}'));
  } catch {
    return {};
  }
}

/**
 * `ai-realtime`: the Realtime WebSocket event protocol. Sends the GA session
 * shape and accepts both GA (`response.output_audio.delta`) and older
 * (`response.audio.delta`) server event names.
 */
export const realtimeAdapter: AIVoiceAdapter = {
  name: 'ai-realtime',
  inputRate: 24000,
  setup(config) {
    const base: Record<string, unknown> = {
      type: 'realtime',
      instructions: config.instructions,
      audio: {
        input: {
          format: {type: 'audio/pcm', rate: 24000},
          turn_detection: {type: 'server_vad'},
        },
        output: {
          format: {type: 'audio/pcm', rate: 24000},
          ...(config.voice ? {voice: config.voice} : {}),
        },
      },
      tools: config.tools.map((t) => ({type: 'function', ...t})),
      tool_choice: 'auto',
      ...(config.model ? {model: config.model} : {}),
    };
    return [{type: 'session.update', session: mergeSession(base, config.overrides)}];
  },
  audio(b64) {
    return {type: 'input_audio_buffer.append', audio: b64};
  },
  text(text, respond) {
    const out: Array<Record<string, unknown>> = [
      {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: respond ? 'user' : 'system',
          content: [{type: 'input_text', text}],
        },
      },
    ];
    if (respond) out.push({type: 'response.create'});
    return out;
  },
  toolResult(id, _name, output) {
    return [
      {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: id,
          output: JSON.stringify(output),
        },
      },
      {type: 'response.create'},
    ];
  },
  parse(m) {
    const type = str(m['type']);
    switch (type) {
      case 'response.output_audio.delta':
      case 'response.audio.delta':
        return str(m['delta'])
          ? [{type: 'audio', base64: str(m['delta']), rate: 24000}]
          : [];
      case 'response.output_audio_transcript.delta':
      case 'response.audio_transcript.delta':
        return [
          {
            type: 'transcript',
            speaker: 'model',
            text: str(m['delta']),
            isFinal: false,
          },
        ];
      case 'response.output_audio_transcript.done':
      case 'response.audio_transcript.done':
        return [
          {
            type: 'transcript',
            speaker: 'model',
            text: str(m['transcript']),
            isFinal: true,
          },
        ];
      case 'conversation.item.input_audio_transcription.delta':
        return [
          {
            type: 'transcript',
            speaker: 'user',
            text: str(m['delta']),
            isFinal: false,
          },
        ];
      case 'conversation.item.input_audio_transcription.completed':
        return [
          {
            type: 'transcript',
            speaker: 'user',
            text: str(m['transcript']),
            isFinal: true,
          },
        ];
      case 'response.function_call_arguments.done':
        return [
          {
            type: 'toolCall',
            id: str(m['call_id']) || str(m['item_id']),
            name: str(m['name']),
            args: parseArgs(m['arguments']),
          },
        ];
      case 'input_audio_buffer.speech_started':
        return [{type: 'interrupted'}];
      case 'response.done':
        return [{type: 'turnComplete'}];
      case 'error':
        return [
          {
            type: 'error',
            message:
              str(obj(m['error'])['message']) || 'Realtime server error',
          },
        ];
      default:
        return [];
    }
  },
};

/** `gemini-live`: the Gemini Live API `BidiGenerateContent` protocol. */
export const geminiLiveAdapter: AIVoiceAdapter = {
  name: 'gemini-live',
  inputRate: 16000,
  setup(config) {
    const base: Record<string, unknown> = {
      ...(config.model ? {model: config.model} : {}),
      generationConfig: {
        responseModalities: ['AUDIO'],
        ...(config.voice
          ? {
              speechConfig: {
                voiceConfig: {prebuiltVoiceConfig: {voiceName: config.voice}},
              },
            }
          : {}),
      },
      systemInstruction: {parts: [{text: config.instructions}]},
      tools: [{functionDeclarations: config.tools.map((t) => ({...t}))}],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
    return [{setup: mergeSession(base, config.overrides)}];
  },
  audio(b64) {
    return {
      realtimeInput: {audio: {mimeType: 'audio/pcm;rate=16000', data: b64}},
    };
  },
  text(text, respond) {
    return [
      {
        clientContent: {
          turns: [{role: 'user', parts: [{text}]}],
          turnComplete: respond,
        },
      },
    ];
  },
  toolResult(id, name, output) {
    return [
      {toolResponse: {functionResponses: [{id, name, response: output}]}},
    ];
  },
  parse(m) {
    const out: AIVoiceServerEvent[] = [];
    const content = obj(m['serverContent']);
    if (content['interrupted']) out.push({type: 'interrupted'});
    const input = obj(content['inputTranscription']);
    if (str(input['text'])) {
      out.push({
        type: 'transcript',
        speaker: 'user',
        text: str(input['text']),
        isFinal: false,
      });
    }
    const output = obj(content['outputTranscription']);
    if (str(output['text'])) {
      out.push({
        type: 'transcript',
        speaker: 'model',
        text: str(output['text']),
        isFinal: false,
      });
    }
    const parts = obj(content['modelTurn'])['parts'];
    for (const part of Array.isArray(parts) ? parts : []) {
      const inline = obj(obj(part)['inlineData']);
      const mime = str(inline['mimeType']);
      if (mime.startsWith('audio/pcm') && str(inline['data'])) {
        const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
        out.push({type: 'audio', base64: str(inline['data']), rate});
      }
    }
    if (content['turnComplete']) out.push({type: 'turnComplete'});
    const calls = obj(m['toolCall'])['functionCalls'];
    for (const call of Array.isArray(calls) ? calls : []) {
      const c = obj(call);
      out.push({
        type: 'toolCall',
        id: str(c['id']),
        name: str(c['name']),
        args: parseArgs(c['args']),
      });
    }
    const err = obj(m['error']);
    if (str(err['message'])) out.push({type: 'error', message: str(err['message'])});
    return out;
  },
};

const ADAPTERS: Record<AIVoiceProviderName, AIVoiceAdapter> = {
  'ai-realtime': realtimeAdapter,
  'gemini-live': geminiLiveAdapter,
};

/** Encodes Int16 samples as little-endian base64. */
export function pcm16ToBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Resamples float audio to `outRate` 16-bit PCM (linear interpolation). */
export function floatToPcm16(
  input: Float32Array,
  inRate: number,
  outRate: number,
): Int16Array {
  const ratio = inRate / outRate;
  const n = Math.max(0, Math.floor(input.length / ratio));
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const v = input[i0] + (input[i1] - input[i0]) * (pos - i0);
    const c = Math.max(-1, Math.min(1, v));
    out[i] = c < 0 ? c * 0x8000 : c * 0x7fff;
  }
  return out;
}

/** Decodes base64 little-endian 16-bit PCM into floats. */
export function base64ToFloat(b64: string): Float32Array {
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

type AudioCtor = new (opts?: {sampleRate?: number}) => AudioContext;

function audioContextCtor(): AudioCtor | undefined {
  const g = globalThis as {AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor};
  return g.AudioContext ?? g.webkitAudioContext;
}

/** Browser microphone capture (getUserMedia + ScriptProcessor, ~100 ms chunks). */
export function createBrowserMicrophone(): AIMicrophoneSource {
  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let node: ScriptProcessorNode | null = null;
  return {
    async start(rate, onChunk) {
      const Ctor = audioContextCtor();
      const media = (globalThis as {navigator?: Navigator}).navigator?.mediaDevices;
      if (!Ctor || !media?.getUserMedia) {
        throw new Error('connectVoice: microphone capture is not available here.');
      }
      stream = await media.getUserMedia({
        audio: {echoCancellation: true, noiseSuppression: true, channelCount: 1},
      });
      ctx = new Ctor();
      const source = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      const inRate = ctx.sampleRate;
      node.onaudioprocess = (e: AudioProcessingEvent) => {
        const pcm = floatToPcm16(e.inputBuffer.getChannelData(0), inRate, rate);
        if (pcm.length) onChunk(pcm16ToBase64(pcm));
      };
      source.connect(node);
      // ScriptProcessor only runs when connected to the destination; it
      // outputs silence.
      node.connect(ctx.destination);
    },
    stop() {
      if (node) node.onaudioprocess = null;
      node?.disconnect();
      for (const t of stream?.getTracks() ?? []) t.stop();
      void ctx?.close();
      node = null;
      stream = null;
      ctx = null;
    },
  };
}

/** Gapless browser playback of streamed PCM, flushed on barge-in. */
export function createBrowserAudioSink(): AIAudioSink {
  let ctx: AudioContext | null = null;
  let playhead = 0;
  const sources = new Set<AudioBufferSourceNode>();
  const sink: AIAudioSink = {
    play(b64, rate) {
      const Ctor = audioContextCtor();
      if (!ctx && Ctor) {
        try {
          ctx = new Ctor();
        } catch {
          return;
        }
      }
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume?.();
      const samples = base64ToFloat(b64);
      if (!samples.length) return;
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.getChannelData(0).set(samples);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const start = Math.max(ctx.currentTime, playhead);
      src.start(start);
      playhead = start + buffer.duration;
      sources.add(src);
      src.onended = () => sources.delete(src);
    },
    flush() {
      for (const src of sources) {
        try {
          src.stop();
        } catch {}
      }
      sources.clear();
      playhead = 0;
    },
    close() {
      sink.flush();
      void ctx?.close();
      ctx = null;
    },
  };
  return sink;
}

function emit(el: AIVoiceElement, detail: AIVoiceEventDetail): void {
  el.fireEvent?.('three-live-voice', detail);
}

/** A realtime voice conversation that edits the scene through tools. */
export class AIVoiceSession {
  state: AIVoiceState = 'connecting';
  private readonly adapter: AIVoiceAdapter;
  private readonly transport: AIVoiceTransport;
  private readonly mic: AIMicrophoneSource | null;
  private readonly sink: AIAudioSink | null;
  private userText = '';
  private modelText = '';
  private readonly onSelect = (e: Event) => {
    const mesh = (e as CustomEvent<{mesh?: string | null}>).detail?.mesh;
    this.sendContext(
      mesh
        ? `The user selected the mesh "${String(mesh).slice(0, 200)}". "This" or "it" now refers to it.`
        : 'The user cleared the selection.',
    );
  };

  constructor(
    private readonly el: AIVoiceElement,
    private readonly options: AIVoiceSessionOptions,
  ) {
    const name = options.provider ?? 'ai-realtime';
    const adapter = ADAPTERS[name];
    if (!adapter) {
      throw new Error(
        `connectVoice: unknown provider '${name}' (use ai-realtime or gemini-live).`,
      );
    }
    this.adapter = adapter;
    if (options.transport) this.transport = options.transport;
    else if (options.url) this.transport = createVoiceWebSocket(options.url);
    else throw new Error('connectVoice: pass a wss:// url or a transport.');
    this.mic =
      options.microphone === false
        ? null
        : (options.microphoneSource ?? createBrowserMicrophone());
    this.sink =
      options.playAudio === false
        ? null
        : (options.audioSink ?? createBrowserAudioSink());
  }

  /** Sends the setup message and starts the microphone. */
  async start(): Promise<this> {
    this.transport.onMessage = (m) => this.handle(m);
    this.transport.onClose = () => this.shutdown();
    const instructions = [VOICE_INSTRUCTIONS, this.options.instructions]
      .filter(Boolean)
      .join('\n');
    for (const msg of this.adapter.setup({
      instructions,
      tools: VOICE_TOOLS,
      model: this.options.model,
      voice: this.options.voice,
      overrides: this.options.session,
    })) {
      this.transport.send(msg);
    }
    // Create the playback context now, inside the user gesture that started the
    // session, so browsers do not keep it suspended (an empty chunk plays nothing).
    this.sink?.play('', 24000);
    this.el.addEventListener?.('three-live-select', this.onSelect);
    if (this.el.selectedMesh) {
      this.sendContext(
        `The user selected the mesh "${String(this.el.selectedMesh).slice(0, 200)}".`,
      );
    }
    try {
      await this.mic?.start(this.adapter.inputRate, (b64) => {
        if (this.state !== 'closed') this.transport.send(this.adapter.audio(b64));
      });
    } catch (e: unknown) {
      this.setState('error', {error: (e as Error)?.message || String(e)});
      this.close();
      throw e;
    }
    this.setState('listening');
    return this;
  }

  /** Sends a typed message (e.g. a text fallback) and asks for a reply. */
  sendText(text: string): void {
    const t = String(text ?? '').trim().slice(0, MAX_VOICE_TEXT);
    if (!t || this.state === 'closed') return;
    for (const msg of this.adapter.text(t, true)) this.transport.send(msg);
  }

  /** Ends the conversation. */
  close(): void {
    if (this.state === 'closed') return;
    this.transport.onClose = undefined;
    this.transport.close();
    this.shutdown();
  }

  private shutdown(): void {
    if (this.state === 'closed') return;
    this.mic?.stop();
    this.sink?.close();
    this.el.removeEventListener?.('three-live-select', this.onSelect);
    if (this.el.__tlVoiceSession === this) this.el.__tlVoiceSession = null;
    this.setState('closed');
  }

  private sendContext(text: string): void {
    if (this.state === 'closed') return;
    for (const msg of this.adapter.text(text, false)) this.transport.send(msg);
  }

  private setState(state: AIVoiceState, extra: Partial<AIVoiceEventDetail> = {}): void {
    this.state = state;
    emit(this.el, {state, ...extra});
  }

  private handle(message: Record<string, unknown>): void {
    if (this.state === 'closed') return;
    let calls = 0;
    for (const ev of this.adapter.parse(message)) {
      switch (ev.type) {
        case 'audio':
          if (this.state !== 'editing') this.state = 'speaking';
          this.sink?.play(ev.base64, ev.rate);
          break;
        case 'interrupted':
          this.sink?.flush();
          break;
        case 'transcript':
          if (ev.speaker === 'user') {
            this.userText = (ev.isFinal ? ev.text : this.userText + ev.text).slice(
              -MAX_VOICE_TEXT,
            );
            emit(this.el, {
              state: this.state,
              transcript: this.userText,
              isFinal: ev.isFinal,
            });
            if (ev.isFinal) this.userText = '';
          } else {
            this.modelText = (ev.isFinal ? ev.text : this.modelText + ev.text).slice(
              -MAX_VOICE_TEXT,
            );
            emit(this.el, {state: this.state, reply: this.modelText, isFinal: ev.isFinal});
            if (ev.isFinal) this.modelText = '';
          }
          break;
        case 'turnComplete':
          // Gemini Live never marks user transcripts final; close them here.
          if (this.userText) {
            emit(this.el, {state: this.state, transcript: this.userText, isFinal: true});
            this.userText = '';
          }
          if (this.modelText) {
            emit(this.el, {state: this.state, reply: this.modelText, isFinal: true});
            this.modelText = '';
          }
          if (this.state === 'speaking' || this.state === 'thinking') {
            this.setState('listening');
          }
          break;
        case 'toolCall':
          if (++calls <= MAX_TOOL_CALLS) void this.runTool(ev.id, ev.name, ev.args);
          break;
        case 'error':
          emit(this.el, {state: this.state, error: ev.message});
          break;
      }
    }
  }

  private async runTool(
    id: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    let output: Record<string, unknown>;
    try {
      if (name === 'edit_scene') {
        const instruction = str(args['instruction']).trim().slice(0, MAX_VOICE_TEXT);
        if (!instruction) throw new Error('instruction is empty');
        if (typeof this.el.editScene !== 'function') {
          throw new Error('scene editing is not available on this element');
        }
        this.setState('editing', {transcript: instruction});
        const result = await this.el.editScene(instruction, {
          provider: this.options.editProvider,
        });
        output = result.applied
          ? {applied: true, repairs: result.repairs}
          : {applied: false, error: result.error ?? 'edit rejected'};
        this.setState('thinking', {result});
      } else if (name === 'undo_edit') {
        const undone = (await this.el.undoEdit?.()) ?? false;
        output = undone ? {undone: true} : {undone: false, error: 'nothing to undo'};
      } else {
        output = {error: `unknown tool ${name}`};
      }
    } catch (e: unknown) {
      output = {applied: false, error: (e as Error)?.message || String(e)};
      if (this.state === 'editing') this.setState('thinking');
    }
    if (this.state === 'closed') return;
    for (const msg of this.adapter.toolResult(id, name, output)) {
      this.transport.send(msg);
    }
  }
}

/** Starts a realtime voice conversation that edits `el`'s scene. */
export async function connectVoice(
  el: AIVoiceElement,
  options: AIVoiceSessionOptions,
): Promise<AIVoiceSession> {
  if (
    !options?.editProvider &&
    !el.aiProvider &&
    !el.getAttribute?.('ai-endpoint')
  ) {
    throw new Error(
      'connectVoice: edits need a code model. Set el.aiProvider, the ai-endpoint attribute, or options.editProvider.',
    );
  }
  el.__tlVoiceSession?.close();
  const session = new AIVoiceSession(el, options ?? {});
  el.__tlVoiceSession = session;
  emit(el, {state: 'connecting'});
  return session.start();
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: {resultIndex: number; results: ArrayLike<ArrayLike<{transcript: string}> & {isFinal: boolean}>}) => void) | null;
  onerror: ((e: {error?: string}) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

/** Recognizer backed by the Web Speech API (`SpeechRecognition`). */
export function createWebSpeechRecognizer(): AISpeechRecognizer | null {
  const g = globalThis as {
    SpeechRecognition?: new () => RecognitionLike;
    webkitSpeechRecognition?: new () => RecognitionLike;
  };
  const Ctor = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  if (!Ctor) return null;
  return {
    listen({lang, signal, onPartial}) {
      return new Promise((resolve, reject) => {
        const rec = new Ctor();
        rec.lang = lang || (globalThis as {document?: Document}).document?.documentElement?.lang || 'en-US';
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;
        let finalText = '';
        let latest = '';
        let settled = false;
        const done = (fn: () => void) => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = () => {
          try {
            rec.abort();
          } catch {}
          done(() => reject(signal?.reason ?? new Error('voice edit aborted')));
        };
        rec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finalText += r[0].transcript;
            else interim += r[0].transcript;
          }
          latest = (finalText + interim).trim();
          onPartial?.(latest);
        };
        rec.onerror = (e) => {
          if (e?.error === 'no-speech' || e?.error === 'aborted') return;
          done(() => reject(new Error(`Speech recognition failed: ${e?.error || 'unknown error'}`)));
        };
        rec.onend = () => done(() => resolve((finalText || latest).trim()));
        if (signal?.aborted) return onAbort();
        signal?.addEventListener('abort', onAbort, {once: true});
        try {
          rec.start();
        } catch (err) {
          done(() => reject(err));
        }
      });
    },
  };
}

function speak(text: string, lang?: string): void {
  const g = globalThis as {
    speechSynthesis?: SpeechSynthesis;
    SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  };
  if (!g.speechSynthesis || !g.SpeechSynthesisUtterance) return;
  try {
    g.speechSynthesis.cancel();
    const u = new g.SpeechSynthesisUtterance(text);
    if (lang) u.lang = lang;
    g.speechSynthesis.speak(u);
  } catch {}
}

/** Short spoken summary of an edit result. */
export function describeEditResult(result: EditSceneResult): string {
  if (result.applied) return 'Done.';
  const reason = String(result.error ?? 'the edit was rejected')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  return `Sorry, I couldn't apply that: ${reason}`;
}

/**
 * Push-to-talk: listens for one utterance, then edits the scene with it
 * (applying it to `el.selectedMesh` when set) and speaks the result.
 */
export async function startVoiceEdit(
  el: AIVoiceElement,
  options: AIVoiceEditOptions = {},
): Promise<AIVoiceEditResult> {
  if (typeof el.editScene !== 'function') {
    throw new Error('startVoiceEdit needs three-live-ai.min.js (el.editScene).');
  }
  const recognizer = options.recognizer ?? createWebSpeechRecognizer();
  if (!recognizer) {
    throw new Error(
      'startVoiceEdit: this browser has no speech recognition; use el.connectVoice() (ai-realtime or gemini-live) instead.',
    );
  }
  emit(el, {state: 'listening'});
  let transcript = '';
  try {
    transcript = (
      await recognizer.listen({
        lang: options.lang,
        signal: options.signal,
        onPartial: (text) =>
          emit(el, {state: 'listening', transcript: text, isFinal: false}),
      })
    )
      .trim()
      .slice(0, MAX_VOICE_TEXT);
  } catch (e: unknown) {
    emit(el, {state: 'error', error: (e as Error)?.message || String(e)});
    throw e;
  }
  if (!transcript) {
    const error = "I didn't catch that.";
    emit(el, {state: 'idle', transcript, isFinal: true, error});
    if (options.speak !== false) speak(error, options.lang);
    throw new Error(`startVoiceEdit: ${error}`);
  }
  emit(el, {state: 'editing', transcript, isFinal: true});
  let result: EditSceneResult;
  try {
    result = await el.editScene(transcript, {signal: options.signal});
  } catch (e: unknown) {
    result = {
      applied: false,
      code: '',
      repairs: 0,
      warnings: [],
      error: (e as Error)?.message || String(e),
    };
  }
  emit(el, {state: 'idle', transcript, isFinal: true, result});
  if (options.speak !== false) speak(describeEditResult(result), options.lang);
  return {transcript, result};
}

/** Enables or disables tap-to-select (`ai-select-on-tap`). */
export function setSelectOnTap(el: AIVoiceElement, enabled: boolean): void {
  if (!enabled) {
    if (el.__tlTapHandler) el.removeEventListener?.('meshclick', el.__tlTapHandler);
    el.__tlTapHandler = null;
    return;
  }
  if (el.__tlTapHandler) return;
  el.__tlTapHandler = (e: Event) => {
    const name = (e as CustomEvent<{meshName?: string}>).detail?.meshName;
    if (typeof name !== 'string' || !name) return;
    const next = el.selectedMesh === name ? null : name;
    el.selectedMesh = next;
    el.fireEvent?.('three-live-select', {mesh: next});
  };
  el.addEventListener?.('meshclick', el.__tlTapHandler);
}

const MIC_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z"/></svg>';

/**
 * Adds the built-in mic button (`ai-voice-button`), or wires a custom
 * `slot="voice-button"` element. With `ai-voice-url` it toggles a realtime
 * session (`ai-voice-provider`, default `ai-realtime`); otherwise it runs
 * push-to-talk.
 */
export function installVoiceButton(el: AIVoiceElement): void {
  if (el.__tlVoiceButton || typeof document === 'undefined') return;
  const custom = el.querySelector?.('[slot="voice-button"]') as HTMLElement | null;
  const btn = custom ?? document.createElement('button');
  if (!custom) {
    btn.setAttribute('type', 'button');
    btn.setAttribute('aria-label', 'Edit the scene by voice');
    btn.innerHTML = MIC_SVG;
    Object.assign(btn.style, {
      position: 'absolute',
      left: '12px',
      bottom: '12px',
      width: '44px',
      height: '44px',
      borderRadius: '22px',
      border: 'none',
      background: 'rgba(32,33,36,0.85)',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      zIndex: '10',
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
    });
    el.appendChild?.(btn);
  }
  el.__tlVoiceButton = btn;
  let busy: AbortController | null = null;
  const setActive = (on: boolean) => {
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (!custom) btn.style.background = on ? 'rgba(217,48,37,0.9)' : 'rgba(32,33,36,0.85)';
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = el.getAttribute?.('ai-voice-url');
    if (url) {
      if (el.__tlVoiceSession) {
        el.__tlVoiceSession.close();
        setActive(false);
        return;
      }
      setActive(true);
      const provider = (el.getAttribute?.('ai-voice-provider') || 'ai-realtime') as AIVoiceProviderName;
      connectVoice(el, {provider, url, model: el.getAttribute?.('ai-voice-model') || undefined})
        .then((s) => {
          el.addEventListener?.('three-live-voice', function onVoice(ev: Event) {
            if ((ev as CustomEvent<AIVoiceEventDetail>).detail?.state === 'closed') {
              el.removeEventListener?.('three-live-voice', onVoice);
              if (el.__tlVoiceSession !== s) setActive(false);
            }
          });
        })
        .catch(() => setActive(false));
      return;
    }
    if (busy) {
      busy.abort(new Error('voice edit cancelled'));
      return;
    }
    busy = new AbortController();
    setActive(true);
    startVoiceEdit(el, {signal: busy.signal})
      .catch(() => {})
      .finally(() => {
        busy = null;
        setActive(false);
      });
  });
}
