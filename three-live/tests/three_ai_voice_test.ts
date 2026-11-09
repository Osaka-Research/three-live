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

import {getSharedRegistry, registerPlugin} from '../src/plugin';
import {aiPlugin, type ThreeLiveAIProvider} from '../src/plugins/ai';
import {
  base64ToFloat,
  connectVoice,
  describeEditResult,
  floatToPcm16,
  geminiLiveAdapter,
  isAllowedVoiceUrl,
  mergeSession,
  pcm16ToBase64,
  realtimeAdapter,
  setSelectOnTap,
  startVoiceEdit,
  type AIAudioSink,
  type AIMicrophoneSource,
  type AISpeechRecognizer,
  type AIVoiceTransport,
} from '../src/plugins/ai-voice';
import {Scene, THREE} from '../src/three-author';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

async function rejects(p: Promise<unknown>, needle: string): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e: any) {
    return String(e?.message ?? e).includes(needle);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// In-process stand-in for the sandbox runner (real author runtime → real GLB).
getSharedRegistry().scriptRunner = {
  async execute(script: string, _sandbox: string, cb: any) {
    setTimeout(() => {
      try {
        const scene = new Scene();
        // eslint-disable-next-line no-new-func
        new Function('THREE', 'scene', 'camera', script)(THREE, scene, {});
        const glb = scene.toGLB();
        cb.onModelReady(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength));
      } catch (e) {
        cb.onError?.(e);
      }
    }, 0);
    return {terminate() {}};
  },
};

const BASE = `
const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial({ color: 0x334155 }));
roof.name = 'Roof';
roof.position.y = 2;
scene.add(roof);
`;
const RED = BASE.replace('0x334155', '0xd93025');
const fenced = (code: string) => '```js\n' + code + '\n```';

/** Element with real event dispatch, plus the aiPlugin installed. */
function fakeElement(attrs: Record<string, string> = {}) {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const events: Array<{type: string; detail: any}> = [];
  const executed: string[] = [];
  const el: any = {
    allowClientScripts: true,
    sandbox: 'worker',
    selectedMesh: null,
    querySelector: (sel: string) =>
      sel.includes('text/three') ? {textContent: BASE} : null,
    getAttribute: (n: string) => attrs[n] ?? null,
    hasAttribute: (n: string) => n in attrs,
    addEventListener(type: string, fn: (e: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: (e: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    fireEvent(type: string, detail: any) {
      events.push({type, detail});
      for (const fn of [...(listeners.get(type) ?? [])]) fn({detail} as any);
    },
    executeScript(script: string) {
      executed.push(script);
      return Promise.resolve();
    },
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  };
  aiPlugin.onElementConnected!(el);
  return {el, events, executed};
}

function scripted(replies: string[]) {
  const requests: any[] = [];
  const provider: ThreeLiveAIProvider = {
    async complete(req) {
      requests.push(req.messages.map((m) => ({...m})));
      const r = replies.shift();
      if (r === undefined) throw new Error('no more replies');
      return r;
    },
  };
  return {provider, requests};
}

function fakeTransport() {
  const sent: any[] = [];
  let closed = false;
  const t: AIVoiceTransport & {sent: any[]; closed: () => boolean; server: (m: any) => void} = {
    sent,
    send(m) {
      if (closed) throw new Error('send after close');
      sent.push(m);
    },
    close() {
      closed = true;
    },
    closed: () => closed,
    server: (m: any) => t.onMessage?.(m),
  };
  return t;
}

function fakeMic() {
  let onChunk: ((b64: string) => void) | null = null;
  const state = {rate: 0, stopped: false};
  const mic: AIMicrophoneSource & {push: (b64: string) => void; state: typeof state} = {
    state,
    async start(rate, cb) {
      state.rate = rate;
      onChunk = cb;
    },
    stop() {
      state.stopped = true;
      onChunk = null;
    },
    push: (b64) => onChunk?.(b64),
  };
  return mic;
}

function fakeSink() {
  const s = {played: [] as Array<[string, number]>, flushes: 0, closed: false};
  const sink: AIAudioSink & {s: typeof s} = {
    s,
    play: (b64, rate) => s.played.push([b64, rate]),
    flush: () => s.flushes++,
    close: () => {
      s.closed = true;
    },
  };
  return sink;
}

function recognizer(text: string, partials: string[] = []): AISpeechRecognizer {
  return {
    async listen({onPartial}) {
      for (const p of partials) onPartial?.(p);
      return text;
    },
  };
}

async function run(): Promise<void> {
  console.log('\n🎙️ three-live-ai (B2b) Tap & Speak voice editing');
  registerPlugin(aiPlugin);

  // --- Audio helpers ---
  {
    const pcm = floatToPcm16(new Float32Array([0, 0.5, -0.5, 1, -1, 2]), 48000, 48000);
    assert(
      pcm.length === 6 && pcm[1] === Math.round(0.5 * 0x7fff) - 0 ||
        (pcm.length === 6 && Math.abs(pcm[1] - 16383) <= 1),
      'floatToPcm16 scales to 16-bit',
    );
    assert(pcm[3] === 32767 && pcm[4] === -32768 && pcm[5] === 32767, 'floatToPcm16 clips');
    const down = floatToPcm16(new Float32Array(4800), 48000, 24000);
    assert(down.length === 2400, 'floatToPcm16 resamples 48 kHz → 24 kHz');
    const round = base64ToFloat(pcm16ToBase64(new Int16Array([0, 16384, -16384])));
    assert(
      round.length === 3 && Math.abs(round[1] - 0.5) < 1e-4 && Math.abs(round[2] + 0.5) < 1e-4,
      'pcm16 base64 round-trips',
    );
    assert(
      isAllowedVoiceUrl('wss://proxy.example/rt') &&
        isAllowedVoiceUrl('ws://localhost:8080') &&
        !isAllowedVoiceUrl('ws://example.com') &&
        !isAllowedVoiceUrl('https://example.com'),
      'Voice URLs must be wss:// (or loopback ws://)',
    );
  }

  // --- ai-realtime adapter ---
  {
    const [setup] = realtimeAdapter.setup({
      instructions: 'be brief',
      tools: [{name: 'edit_scene', description: 'd', parameters: {type: 'object'}}],
      voice: 'marin',
      model: 'm1',
      overrides: {tool_choice: 'required', audio: {input: {transcription: {model: 'stt-1'}}}},
    });
    const session: any = setup['session'];
    assert(
      setup['type'] === 'session.update' &&
        session.type === 'realtime' &&
        session.audio.input.format.rate === 24000 &&
        session.audio.input.turn_detection.type === 'server_vad' &&
        session.audio.output.voice === 'marin' &&
        session.model === 'm1' &&
        session.tools[0].type === 'function' &&
        session.tools[0].name === 'edit_scene' &&
        session.tool_choice === 'required' &&
        session.audio.input.transcription.model === 'stt-1' &&
        session.audio.input.format.type === 'audio/pcm',
      'ai-realtime setup sends a GA session.update with tools and deep-merged overrides',
    );
    const ga = realtimeAdapter.parse({type: 'response.output_audio.delta', delta: 'AAA='});
    const legacy = realtimeAdapter.parse({type: 'response.audio.delta', delta: 'AAA='});
    assert(
      ga[0]?.type === 'audio' && legacy[0]?.type === 'audio',
      'ai-realtime accepts GA and older audio event names',
    );
    const call = realtimeAdapter.parse({
      type: 'response.function_call_arguments.done',
      call_id: 'c1',
      name: 'edit_scene',
      arguments: '{"instruction":"make it red"}',
    })[0] as any;
    assert(
      call.type === 'toolCall' && call.id === 'c1' && call.args.instruction === 'make it red',
      'ai-realtime parses function calls',
    );
    const bad = realtimeAdapter.parse({
      type: 'response.function_call_arguments.done',
      call_id: 'c2',
      name: 'edit_scene',
      arguments: '{not json',
    })[0] as any;
    assert(bad.type === 'toolCall' && Object.keys(bad.args).length === 0, 'Malformed tool arguments become {}');
    assert(
      realtimeAdapter.parse({type: 'input_audio_buffer.speech_started'})[0]?.type === 'interrupted' &&
        (realtimeAdapter.parse({type: 'error', error: {message: 'bad'}})[0] as any)?.message === 'bad' &&
        realtimeAdapter.parse({type: 'session.created'}).length === 0,
      'ai-realtime maps barge-in and errors, ignores unknown events',
    );
    const out = realtimeAdapter.toolResult('c1', 'edit_scene', {applied: true});
    assert(
      out[0]['type'] === 'conversation.item.create' &&
        (out[0]['item'] as any).type === 'function_call_output' &&
        (out[0]['item'] as any).call_id === 'c1' &&
        out[1]['type'] === 'response.create',
      'ai-realtime returns tool output then asks for a response',
    );
  }

  {
    const [plain] = realtimeAdapter.setup({instructions: 'x', tools: []});
    assert(
      !JSON.stringify(plain).includes('whisper') && !('transcription' in (plain as any).session.audio.input),
      'ai-realtime defaults name no vendor-specific model',
    );
    const merged: any = mergeSession({a: {b: 1, c: [1]}}, JSON.parse('{"a":{"c":[2],"d":3},"__proto__":{"polluted":1}}'));
    assert(
      merged.a.b === 1 && merged.a.c[0] === 2 && merged.a.d === 3 && ({} as any).polluted === undefined,
      'mergeSession deep-merges objects, replaces arrays, and ignores __proto__',
    );
  }

  // --- gemini-live adapter ---
  {
    const [msg] = geminiLiveAdapter.setup({
      instructions: 'be brief',
      tools: [{name: 'edit_scene', description: 'd', parameters: {type: 'object'}}],
      voice: 'Kore',
    });
    const setup: any = msg['setup'];
    assert(
      setup.tools[0].functionDeclarations[0].name === 'edit_scene' &&
        setup.generationConfig.responseModalities[0] === 'AUDIO' &&
        setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName === 'Kore' &&
        setup.systemInstruction.parts[0].text === 'be brief',
      'gemini-live setup declares the tools and voice',
    );
    const evs = geminiLiveAdapter.parse({
      serverContent: {
        modelTurn: {parts: [{inlineData: {mimeType: 'audio/pcm;rate=24000', data: 'AAA='}}]},
        outputTranscription: {text: 'Sure'},
        inputTranscription: {text: 'make it red'},
        turnComplete: true,
      },
      toolCall: {functionCalls: [{id: 'f1', name: 'edit_scene', args: {instruction: 'red'}}]},
    });
    const kinds = evs.map((e) => e.type).join(',');
    assert(
      kinds === 'transcript,transcript,audio,turnComplete,toolCall' &&
        (evs[2] as any).rate === 24000 &&
        (evs[4] as any).args.instruction === 'red',
      'gemini-live parses audio, transcripts, turn end, and tool calls',
    );
    assert(
      geminiLiveAdapter.parse({serverContent: {interrupted: true}})[0]?.type === 'interrupted',
      'gemini-live maps interruptions',
    );
    const res: any = geminiLiveAdapter.toolResult('f1', 'edit_scene', {applied: true})[0];
    assert(
      res.toolResponse.functionResponses[0].id === 'f1' &&
        res.toolResponse.functionResponses[0].response.applied === true,
      'gemini-live answers tool calls with toolResponse',
    );
    assert(
      (geminiLiveAdapter.audio('QQ==') as any).realtimeInput.audio.mimeType === 'audio/pcm;rate=16000' &&
        geminiLiveAdapter.inputRate === 16000,
      'gemini-live streams 16 kHz microphone audio',
    );
  }

  // --- Voice session end to end (ai-realtime) ---
  {
    const {el, events} = fakeElement();
    const {provider} = scripted([fenced(RED)]);
    el.aiProvider = provider;
    el.selectedMesh = 'Roof';
    const t = fakeTransport();
    const mic = fakeMic();
    const sink = fakeSink();
    const session = await el.connectVoice({
      transport: t,
      microphoneSource: mic,
      audioSink: sink,
      instructions: 'Use metric units.',
    });
    assert(
      t.sent[0].type === 'session.update' &&
        t.sent[0].session.instructions.includes('Use metric units.') &&
        t.sent[0].session.tools.map((x: any) => x.name).join() === 'edit_scene,undo_edit',
      'connectVoice sends the session setup with edit_scene and undo_edit',
    );
    assert(
      t.sent.some(
        (m: any) => m.type === 'conversation.item.create' && m.item.role === 'system' &&
          m.item.content[0].text.includes('"Roof"'),
      ),
      'The current selection is shared with the voice model',
    );
    assert(mic.state.rate === 24000 && session.state === 'listening', 'Microphone starts at 24 kHz');
    mic.push('AQID');
    assert(
      t.sent.at(-1).type === 'input_audio_buffer.append' && t.sent.at(-1).audio === 'AQID',
      'Microphone chunks stream as input_audio_buffer.append',
    );
    t.server({type: 'response.output_audio.delta', delta: 'AAAA'});
    t.server({type: 'input_audio_buffer.speech_started'});
    assert(
      sink.s.played.length === 2 && sink.s.played[0][0] === '' && sink.s.flushes === 1,
      'Playback is primed at start; model audio plays and barge-in flushes it',
    );

    t.server({
      type: 'response.function_call_arguments.done',
      call_id: 'call_1',
      name: 'edit_scene',
      arguments: JSON.stringify({instruction: 'make it red'}),
    });
    for (let i = 0; i < 20 && !t.sent.some((m: any) => m.item?.type === 'function_call_output'); i++) {
      await tick();
    }
    const outMsg = t.sent.find((m: any) => m.item?.type === 'function_call_output');
    assert(
      !!outMsg && outMsg.item.call_id === 'call_1' && JSON.parse(outMsg.item.output).applied === true &&
        t.sent.at(-1).type === 'response.create',
      'edit_scene runs editScene with the code model and returns the result',
    );
    assert(el.sceneSource === RED.trim(), 'The voice edit was applied to the scene');
    assert(
      events.some((e) => e.type === 'three-live-voice' && e.detail.state === 'editing' &&
        e.detail.transcript === 'make it red'),
      'three-live-voice reports the editing state',
    );

    t.server({type: 'response.function_call_arguments.done', call_id: 'call_2', name: 'undo_edit', arguments: '{}'});
    for (let i = 0; i < 20 && !t.sent.some((m: any) => m.item?.call_id === 'call_2'); i++) await tick();
    const undo = t.sent.find((m: any) => m.item?.call_id === 'call_2');
    assert(!!undo && JSON.parse(undo.item.output).undone === true && el.sceneSource === BASE, 'undo_edit reverts');

    t.server({type: 'response.function_call_arguments.done', call_id: 'call_3', name: 'delete_world', arguments: '{}'});
    for (let i = 0; i < 20 && !t.sent.some((m: any) => m.item?.call_id === 'call_3'); i++) await tick();
    const unknown = t.sent.find((m: any) => m.item?.call_id === 'call_3');
    assert(!!unknown && JSON.parse(unknown.item.output).error.includes('unknown tool'), 'Unknown tools get an error result');

    el.fireEvent('three-live-select', {mesh: 'Chimney'});
    assert(
      t.sent.at(-1).item?.content?.[0]?.text?.includes('"Chimney"'),
      'Selection changes during the session are forwarded',
    );
    t.server({type: 'conversation.item.input_audio_transcription.completed', transcript: 'hello'});
    assert(
      events.some((e) => e.type === 'three-live-voice' && e.detail.transcript === 'hello' && e.detail.isFinal),
      'User transcripts are reported',
    );
    const sentBefore = t.sent.length;
    session.close();
    mic.push('AQID');
    assert(
      t.closed() && mic.state.stopped && sink.s.closed && session.state === 'closed' &&
        t.sent.length === sentBefore && el.listenerCount('three-live-select') === 0,
      'close() stops the mic, audio, transport, and listeners',
    );
    session.close();
    assert(session.state === 'closed', 'close() is idempotent');
  }

  // --- Voice session (gemini-live), failed edit reported to the model ---
  {
    const {el} = fakeElement({'ai-endpoint': 'https://proxy.example/chat'});
    const {provider} = scripted(['no code here', 'still no code']);
    const t = fakeTransport();
    const mic = fakeMic();
    await el.connectVoice({
      provider: 'gemini-live',
      transport: t,
      microphoneSource: mic,
      audioSink: fakeSink(),
      editProvider: provider,
    });
    assert(!!t.sent[0].setup && mic.state.rate === 16000, 'gemini-live session sets up at 16 kHz');
    t.server({toolCall: {functionCalls: [{id: 'g1', name: 'edit_scene', args: {instruction: 'add a moon'}}]}});
    for (let i = 0; i < 30 && !t.sent.some((m: any) => m.toolResponse); i++) await tick();
    const resp = t.sent.find((m: any) => m.toolResponse)?.toolResponse.functionResponses[0];
    assert(
      resp?.id === 'g1' && resp.response.applied === false && /script/i.test(resp.response.error),
      'A rejected edit is reported back to the voice model with the reason',
    );
    t.server({serverContent: {inputTranscription: {text: 'add a '}}});
    t.server({serverContent: {inputTranscription: {text: 'moon'}, turnComplete: true}});
    el.__tlVoiceSession.close();
  }

  // --- connectVoice validation ---
  {
    const {el} = fakeElement();
    assert(
      await rejects(el.connectVoice({transport: fakeTransport(), microphone: false}), 'code model'),
      'connectVoice requires a code model for edits',
    );
    el.aiProvider = scripted([]).provider;
    assert(
      await rejects(el.connectVoice({url: 'ws://evil.example/rt', microphone: false}), 'wss://'),
      'connectVoice rejects insecure URLs',
    );
    assert(
      await rejects(el.connectVoice({provider: 'carrier-pigeon', transport: fakeTransport()}), 'unknown provider'),
      'connectVoice rejects unknown providers',
    );
    assert(await rejects(el.connectVoice({microphone: false}), 'url or a transport'), 'connectVoice needs a url');
    const failingMic: AIMicrophoneSource = {
      async start() {
        throw new Error('Permission denied');
      },
      stop() {},
    };
    const t = fakeTransport();
    assert(
      await rejects(el.connectVoice({transport: t, microphoneSource: failingMic, audioSink: fakeSink()}), 'Permission denied') &&
        t.closed() && !el.__tlVoiceSession,
      'A denied microphone closes the session',
    );
    const t1 = fakeTransport();
    const s1 = await el.connectVoice({transport: t1, microphone: false, audioSink: fakeSink()});
    const t2 = fakeTransport();
    const s2 = await el.connectVoice({transport: t2, microphone: false, audioSink: fakeSink()});
    assert(s1.state === 'closed' && t1.closed() && s2.state === 'listening', 'A new session replaces the old one');
    s2.sendText('make the roof red');
    assert(
      t2.sent.at(-2).item?.role === 'user' && t2.sent.at(-1).type === 'response.create',
      'sendText sends a user message and requests a reply',
    );
    s2.close();
  }

  // --- Push-to-talk ---
  {
    const {el, events} = fakeElement();
    el.aiProvider = scripted([fenced(RED)]).provider;
    el.selectedMesh = 'Roof';
    const res = await el.startVoiceEdit({
      recognizer: recognizer('make it red', ['make', 'make it']),
      speak: false,
    });
    const states = events.filter((e) => e.type === 'three-live-voice').map((e) => e.detail.state);
    assert(
      res.transcript === 'make it red' && res.result.applied && el.sceneSource === RED.trim(),
      'startVoiceEdit edits the scene from one utterance',
    );
    assert(
      states.join(',') === 'listening,listening,listening,editing,idle',
      'startVoiceEdit reports listening (with partials), editing, idle',
    );
    assert(
      await rejects(el.startVoiceEdit({recognizer: recognizer('   '), speak: false}), "didn't catch"),
      'An empty utterance is rejected without editing',
    );
    const failing = await el.startVoiceEdit({recognizer: recognizer('do something'), speak: false});
    assert(
      !failing.result.applied && /no more replies|provider/i.test(failing.result.error ?? ''),
      'A failing edit resolves with applied: false',
    );
    const g = globalThis as any;
    const saved = [g.SpeechRecognition, g.webkitSpeechRecognition];
    g.SpeechRecognition = g.webkitSpeechRecognition = undefined;
    assert(
      await rejects(el.startVoiceEdit({speak: false}), 'connectVoice'),
      'Without speech recognition, startVoiceEdit points to connectVoice',
    );
    [g.SpeechRecognition, g.webkitSpeechRecognition] = saved;
    assert(
      describeEditResult({applied: true, code: '', repairs: 0, warnings: []}) === 'Done.' &&
        describeEditResult({applied: false, code: '', repairs: 0, warnings: [], error: 'x'.repeat(500)}).length < 220,
      'Spoken summaries stay short',
    );
    // Standalone function without the plugin.
    assert(
      await rejects(startVoiceEdit({} as any, {recognizer: recognizer('x')}), 'editScene'),
      'startVoiceEdit requires the ai plugin',
    );
  }

  // --- Tap to select ---
  {
    const {el, events} = fakeElement({'ai-select-on-tap': ''});
    el.fireEvent('meshclick', {meshName: 'Roof'});
    assert(el.selectedMesh === 'Roof', 'ai-select-on-tap selects the tapped mesh');
    el.fireEvent('meshclick', {meshName: 'Roof'});
    assert(el.selectedMesh === null, 'Tapping the selected mesh again clears it');
    el.fireEvent('meshclick', {meshName: ''});
    assert(el.selectedMesh === null, 'Taps without a mesh name are ignored');
    const sel = events.filter((e) => e.type === 'three-live-select').map((e) => e.detail.mesh);
    assert(sel.join(',') === 'Roof,', 'three-live-select reports each change');
    setSelectOnTap(el, false);
    el.fireEvent('meshclick', {meshName: 'Roof'});
    assert(el.selectedMesh === null && el.listenerCount('meshclick') === 0, 'setSelectOnTap(false) stops selecting');
    const {el: plain} = fakeElement();
    plain.fireEvent('meshclick', {meshName: 'Roof'});
    assert(plain.selectedMesh === null, 'Tap-to-select is off by default');
    plain.setSelectOnTap(true);
    plain.setSelectOnTap(true);
    assert(plain.listenerCount('meshclick') === 1, 'setSelectOnTap(true) is idempotent');
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
