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

/** Regression tests for asynchronous work crossing Gemini Live sessions. */

import {
  createWebSocketTransport,
  geminiLivePlugin,
  connectGeminiLive,
  type GeminiLiveTransport,
  REPORT_OBJECTS_TOOL,
  XRGeminiLiveController,
} from '../src/plugins/gemini-live';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    console.log(`   [PASS] ${name}`);
    passed++;
  } else {
    console.error(`   [FAIL] ${name}`);
    failed++;
  }
}

interface Frame {
  base64: string;
  mimeType: string;
}

function deferredFrame() {
  let resolve!: (frame: Frame) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Frame>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return {promise, resolve, reject};
}

function transport() {
  const sent: Array<Record<string, unknown>> = [];
  let closed = 0;
  const socket: GeminiLiveTransport = {
    send: (message) => { sent.push(message); },
    close: () => { closed++; socket.onClose?.(); },
  };
  return {socket, sent, get closed() { return closed; }};
}

function host() {
  const captures: Array<ReturnType<typeof deferredFrame>> = [];
  const events: Array<{type: string; detail: unknown}> = [];
  // Translation alone is enough to distinguish detection-camera snapshots.
  const matrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const element = {
    viewer: {container: {simulator: {
      active: true,
      getHeadPose: () => ({matrix, position: [matrix[12], 0, 0], quaternion: [0, 0, 0, 1]}),
    }}},
    captureViewFrame() {
      const capture = deferredFrame();
      captures.push(capture);
      return capture.promise;
    },
    dispatchEvent(event: Event) {
      events.push({type: event.type, detail: (event as CustomEvent).detail});
      return true;
    },
  };
  return {element, captures, events, matrix};
}

const frame = (base64: string): Frame => ({base64, mimeType: 'image/jpeg'});
const detection = {
  toolCall: {
    functionCalls: [{
      id: 'object-1',
      name: REPORT_OBJECTS_TOOL,
      args: {objects: [{label: 'cup', box_2d: [400, 400, 600, 600]}]},
    }],
  },
};

async function testPendingCapture(rejectOld: boolean, reuseTransport: boolean): Promise<void> {
  const h = host();
  const first = transport();
  const next = reuseTransport ? first : transport();
  const ctrl = new XRGeminiLiveController(h.element);
  ctrl.connect({transport: first.socket, streamFrames: false, detectObjects: true});
  const oldFrame = ctrl.sendFrame();
  ctrl.connect({transport: next.socket, streamFrames: false, detectObjects: true});
  h.matrix[12] = 10;
  const newFrame = ctrl.sendFrame();
  const label = `${rejectOld ? 'rejected' : 'resolved'} old capture, ${reuseTransport ? 'reused' : 'new'} transport`;
  assert(h.captures.length === 2, `${label}: replacement capture starts immediately`);
  assert(!(await ctrl.sendFrame()), `${label}: only one capture per session`);

  if (rejectOld) h.captures[0].reject(new Error('old capture failed'));
  else h.captures[0].resolve(frame('old'));
  assert(!(await oldFrame), `${label}: old capture is discarded`);
  assert(next.sent.length === 0, `${label}: no stale frame reaches replacement`);
  const extraFrame = ctrl.sendFrame();
  assert(h.captures.length === 2, `${label}: old finally cannot release new capture lock`);

  // Settle every request even against the unfixed implementation.
  for (const capture of h.captures.slice(1)) capture.resolve(frame('new'));
  const [newSent, extraSent] = await Promise.all([newFrame, extraFrame]);
  assert(newSent && !extraSent, `${label}: only the new session's original capture sends`);
  assert(next.sent.length === 1 && JSON.stringify(next.sent[0]).includes('"new"'),
    `${label}: current frame is sent once`);
  ctrl.disconnect();
}

async function testStaleCamera(): Promise<void> {
  const h = host();
  const first = transport();
  const next = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  ctrl.connect({transport: first.socket, streamFrames: false, detectObjects: true});
  const oldFrame = ctrl.sendFrame();
  ctrl.connect({transport: next.socket, streamFrames: false, detectObjects: true});
  h.matrix[12] = 10;
  const newFrame = ctrl.sendFrame();
  h.captures[1]?.resolve(frame('new'));
  await newFrame;
  h.captures[0].resolve(frame('old'));
  await oldFrame;
  h.matrix[12] = 20;
  next.socket.onMessage?.(detection);
  const located = h.events.find((event) => event.type === 'xr-object-detected')?.detail as {x?: number};
  assert(located?.x === 10, 'late old frame cannot replace the new detection camera');
  ctrl.disconnect();
}

function testStaleCallbacks(reuseTransport: boolean): void {
  const h = host();
  const first = transport();
  const next = reuseTransport ? first : transport();
  const ctrl = new XRGeminiLiveController(h.element);
  let enqueued = 0;
  let flushed = 0;
  ctrl.audio.enqueue = () => { enqueued++; };
  ctrl.audio.flush = () => { flushed++; };
  ctrl.connect({transport: first.socket, streamFrames: false, detectObjects: true});
  const oldMessage = first.socket.onMessage!;
  const oldClose = first.socket.onClose!;
  ctrl.connect({transport: next.socket, streamFrames: false, detectObjects: true});
  h.events.length = 0;
  flushed = 0;
  oldMessage({...detection, serverContent: {
    interrupted: true,
    inputTranscription: {text: 'old input'},
    outputTranscription: {text: 'old output'},
    modelTurn: {parts: [{inlineData: {mimeType: 'audio/pcm;rate=24000', data: 'AAA='}}]},
    turnComplete: true,
  }});
  oldClose();
  const label = reuseTransport ? 'reused transport' : 'new transport';
  assert(h.events.length === 0, `${label}: old callbacks emit no events`);
  assert(next.sent.length === 0, `${label}: old tool calls send no responses`);
  assert(enqueued === 0 && flushed === 0, `${label}: old messages cannot play or interrupt audio`);
  assert(ctrl.connected, `${label}: old close cannot disconnect the replacement`);
  next.socket.onMessage?.({serverContent: {modelTurn: {parts: [{text: 'new output'}]}, turnComplete: true}});
  assert(h.events.some((event) => event.type === 'xr-transcription' &&
    (event.detail as {text: string; isFinal: boolean}).text === 'new output' &&
    (event.detail as {isFinal: boolean}).isFinal), `${label}: current callback still works`);
  ctrl.disconnect();
}

async function testClosedSession(remote: boolean): Promise<void> {
  const h = host();
  const first = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  ctrl.connect({transport: first.socket, streamFrames: false});
  const oldMessage = first.socket.onMessage!;
  const pending = ctrl.sendFrame();
  if (remote) first.socket.onClose?.();
  else ctrl.disconnect();
  oldMessage({serverContent: {modelTurn: {parts: [{text: 'late'}]}, turnComplete: true}});
  h.captures[0].resolve(frame('late'));
  const label = remote ? 'remote close' : 'disconnect';
  assert(!ctrl.connected && !(await pending), `${label}: pending frame is discarded`);
  assert(first.sent.length === 0 && h.events.length === 0, `${label}: late work has no effects`);
  const next = transport();
  ctrl.connect({transport: next.socket, streamFrames: false});
  const fresh = ctrl.sendFrame();
  h.captures[1]?.resolve(frame('fresh'));
  assert(await fresh, `${label}: reconnect can capture again`);
  ctrl.disconnect();
}

function testTranscriptReset(): void {
  const h = host();
  const first = transport();
  const next = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  ctrl.connect({transport: first.socket, streamFrames: false});
  first.socket.onMessage?.({serverContent: {outputTranscription: {text: 'unfinished'}}});
  ctrl.connect({transport: next.socket, streamFrames: false});
  assert(h.events.some((event) => (event.detail as {text?: string; isFinal?: boolean}).text === 'unfinished' &&
    (event.detail as {isFinal?: boolean}).isFinal), 'reconnect still finalizes the old transcript');
  h.events.length = 0;
  next.socket.onMessage?.({serverContent: {modelTurn: {parts: [{text: 'fresh text'}]}, turnComplete: true}});
  assert(h.events.some((event) => (event.detail as {text?: string; isFinal?: boolean}).text === 'fresh text' &&
    (event.detail as {isFinal?: boolean}).isFinal), 'old output transcription does not suppress the new text turn');
  ctrl.disconnect();
}

function testReconnectDuringDisconnect(): void {
  const h = host();
  const first = transport();
  const outer = transport();
  const nested = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  let switched = false;
  const dispatch = h.element.dispatchEvent;
  h.element.dispatchEvent = (event: Event) => {
    dispatch(event);
    const detail = (event as CustomEvent).detail as {text?: string; isFinal?: boolean};
    if (!switched && detail?.isFinal && detail.text === 'old input') {
      switched = true;
      ctrl.connect({transport: nested.socket, streamFrames: false});
      nested.socket.onMessage?.({serverContent: {outputTranscription: {text: 'new output'}}});
    }
    return true;
  };
  ctrl.connect({transport: first.socket, streamFrames: false});
  first.socket.onMessage?.({serverContent: {
    inputTranscription: {text: 'old input'}, outputTranscription: {text: 'old output'},
  }});
  ctrl.connect({transport: outer.socket, streamFrames: false});
  ctrl.sendText('current');
  assert(switched && nested.sent.length === 1 && outer.sent.length === 0,
    'reconnect during finalization keeps the newest transport');
  assert(!h.events.some((event) => {
    const detail = event.detail as {text?: string; isFinal?: boolean};
    return detail.text === 'old output' && detail.isFinal;
  }), 'reconnect during finalization stops remaining old transcript events');
  ctrl.disconnect();
  assert(first.closed === 1 && outer.closed === 1 && nested.closed === 1,
    'reconnect during finalization closes the superseded and active transports');
  assert(h.events.some((event) => {
    const detail = event.detail as {text?: string; isFinal?: boolean};
    return detail.text === 'new output' && detail.isFinal;
  }), 'reconnect during finalization preserves the new transcript');
}

function testReconnectDuringTransportClose(): void {
  const h = host();
  const first = transport();
  const next = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  first.socket.close = () => {
    ctrl.connect({transport: next.socket, streamFrames: false});
    next.socket.onMessage?.({serverContent: {outputTranscription: {text: 'new output'}}});
  };
  ctrl.connect({transport: first.socket, streamFrames: false});
  ctrl.disconnect();
  assert(ctrl.connected && !h.events.some((event) => {
    const detail = event.detail as {text?: string; isFinal?: boolean};
    return detail.text === 'new output' && detail.isFinal;
  }), 'transport close reconnect does not finalize the new session');
  ctrl.disconnect();
  assert(next.closed === 1 && h.events.some((event) => {
    const detail = event.detail as {text?: string; isFinal?: boolean};
    return detail.text === 'new output' && detail.isFinal;
  }), 'new session closes and finalizes normally after transport close reconnect');

  // Reconnecting with a pre-built outer transport when close() connects an inner one.
  const initial = transport();
  const outer = transport();
  const inner = transport();
  initial.socket.close = () => {
    ctrl.connect({transport: inner.socket, streamFrames: false});
  };
  ctrl.connect({transport: initial.socket, streamFrames: false});
  ctrl.connect({transport: outer.socket, streamFrames: false});
  ctrl.sendText('to inner');
  assert(
    outer.closed === 1 && inner.closed === 0 && inner.sent.length === 1 && outer.sent.length === 0,
    'superseded outer transport is closed when transport.close connects an inner session',
  );
  ctrl.disconnect();
  assert(inner.closed === 1, 'inner session closes cleanly');

  // Redundant disconnect() inside close() must not abort an in-progress connect().
  const prev = transport();
  const replacement = transport();
  let prevClosed = 0;
  prev.socket.close = () => {
    prevClosed++;
    ctrl.disconnect();
  };
  ctrl.connect({transport: prev.socket, streamFrames: false});
  ctrl.connect({transport: replacement.socket, streamFrames: false});
  ctrl.sendText('still connected');
  assert(
    prevClosed === 1 && ctrl.connected && replacement.closed === 0 && replacement.sent.length === 1,
    'redundant disconnect during teardown does not abort replacement connect',
  );
  ctrl.disconnect();
}

async function testFrameTimers(): Promise<void> {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const callbacks: Array<() => void> = [];
  const active = new Set<number>();
  globalThis.setInterval = ((callback: () => void) => {
    callbacks.push(callback);
    active.add(callbacks.length);
    return callbacks.length;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: number) => { active.delete(id); }) as typeof clearInterval;
  const h = host();
  const first = transport();
  const next = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  try {
    ctrl.connect({transport: first.socket});
    ctrl.connect({transport: next.socket});
    assert(active.size === 1 && active.has(2), 'reconnect replaces the frame timer');
    callbacks[0]();
    assert(h.captures.length === 0, 'a queued old timer cannot capture for the replacement');
    callbacks[1]();
    assert(h.captures.length === 1, 'the current frame timer still captures');
    h.captures[0].resolve(frame('current timer'));
    await Promise.resolve();
    assert(next.sent.length === 1, 'the current frame timer still sends');
    next.socket.onClose?.();
    assert(active.size === 0, 'remote close clears the current frame timer');
    callbacks[1]();
    assert(h.captures.length === 1, 'a closed session timer cannot capture');

    const closing = transport();
    closing.socket.send = () => closing.socket.onClose?.();
    ctrl.connect({transport: closing.socket, setup: {model: 'm'}});
    assert(!ctrl.connected && active.size === 0, 'close during setup cannot leave an orphan frame timer');

    const throwing = transport();
    throwing.socket.send = () => { throw new Error('setup failed'); };
    let setupThrew = false;
    try {
      ctrl.connect({transport: throwing.socket, setup: {model: 'm'}});
    } catch {
      setupThrew = true;
    }
    assert(
      setupThrew && !ctrl.connected && throwing.closed === 1 && active.size === 0,
      'throwing setup closes transport and leaves no timer',
    );

    const reentering = transport();
    const nested = transport();
    let reentered = false;
    reentering.socket.send = () => {
      if (!reentered) {
        reentered = true;
        ctrl.connect({transport: nested.socket});
      }
    };
    ctrl.connect({transport: reentering.socket, setup: {model: 'm'}});
    assert(
      ctrl.connected && reentering.closed === 1 && nested.closed === 0 && active.size === 1,
      'reconnect during setup send keeps only the nested session timer and transport',
    );
    ctrl.disconnect();
    assert(nested.closed === 1 && active.size === 0, 'nested session timer and transport close cleanly');

    const firstCtrl = new XRGeminiLiveController(h.element);
    const t1 = transport();
    const t2 = transport();
    const t3 = transport();
    firstCtrl.connect({transport: t1.socket});
    const secondCtrl = new XRGeminiLiveController(h.element);
    secondCtrl.connect({transport: t2.socket});
    assert(
      !firstCtrl.connected && secondCtrl.connected && t1.closed === 1 && t2.closed === 0 && active.size === 1,
      'connecting a second controller on the same element closes the previous timer and transport',
    );
    const rawT2Close = t2.socket.close.bind(t2.socket);
    t2.socket.close = () => {
      rawT2Close();
      connectGeminiLive(h.element, {transport: t3.socket});
    };
    const thirdCtrl = new XRGeminiLiveController(h.element);
    const supersededCtrl = transport();
    thirdCtrl.connect({transport: supersededCtrl.socket});
    assert(
      thirdCtrl.connected && t2.closed === 1 && supersededCtrl.closed === 1 && t3.closed === 0 && active.size === 1,
      'reentrant connectGeminiLive during cross-controller teardown preserves inner session and closes superseded transport',
    );
    geminiLivePlugin.onElementDisconnected?.(h.element);
    assert(
      !thirdCtrl.connected && t3.closed === 1 && active.size === 0,
      'disconnecting the host element closes a directly constructed controller',
    );
  } finally {
    ctrl.disconnect();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
}

function testReentrantReconnect(): void {
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalSpeech = globals['speechSynthesis'];
  const originalUtterance = globals['SpeechSynthesisUtterance'];
  try {
    for (const trigger of ['input', 'output', 'text', 'interrupted', 'final-user', 'final-model', 'detection']) {
      const h = host();
      const first = transport();
      const next = transport();
      const ctrl = new XRGeminiLiveController(h.element);
      let switched = false;
      let replacementStarted = false;
      let staleEvents = 0;
      let staleAudio = 0;
      let staleSpeech = 0;
      globals['speechSynthesis'] = {
        cancel() {},
        speak() { if (replacementStarted) staleSpeech++; },
      };
      globals['SpeechSynthesisUtterance'] = class { constructor(readonly text: string) {} };
      ctrl.audio.enqueue = () => { if (replacementStarted) staleAudio++; };
      const dispatch = h.element.dispatchEvent;
      h.element.dispatchEvent = (event: Event) => {
        dispatch(event);
        if (replacementStarted) staleEvents++;
        const detail = (event as CustomEvent).detail as {speaker?: string; isFinal?: boolean};
        const matches = trigger === 'interrupted' ? event.type === 'xr-gemini-interrupted' :
          trigger === 'detection' ? event.type === 'xr-object-detected' :
          event.type === 'xr-transcription' && (
            trigger === 'final-user' ? detail.isFinal && detail.speaker === 'user' :
            trigger === 'final-model' ? detail.isFinal && detail.speaker === 'model' :
            !detail.isFinal && detail.speaker === (trigger === 'input' ? 'user' : 'model'));
        if (matches && !switched) {
          switched = true;
          ctrl.connect({transport: next.socket, streamFrames: false, detectObjects: true, speakReplies: true});
          replacementStarted = true;
        }
        return true;
      };
      ctrl.connect({transport: first.socket, streamFrames: false, detectObjects: true, speakReplies: true});
      first.socket.onMessage?.({
        ...(trigger === 'detection' ? {toolCall: {functionCalls: [{
          id: 'old-call', name: REPORT_OBJECTS_TOOL,
          args: {objects: [
            {label: 'cup', box_2d: [400, 400, 600, 600]},
            {label: 'plate', box_2d: [200, 200, 300, 300]},
          ]},
        }]}} : {}),
        serverContent: {
          interrupted: trigger === 'interrupted',
          ...(trigger === 'text' ? {} : {
            inputTranscription: {text: 'old input'},
            outputTranscription: {text: 'old output'},
          }),
          modelTurn: {parts: [
            {text: 'old text', inlineData: {mimeType: 'audio/pcm;rate=24000', data: 'AAA='}},
            {text: 'more old text'},
          ]},
          turnComplete: true,
        },
      });
      assert(switched && ctrl.connected, `${trigger} listener can reconnect`);
      assert(staleEvents === 0 && staleAudio === 0 && staleSpeech === 0,
        `${trigger} reconnect stops remaining old events, audio and speech`);
      assert(next.sent.length === 0, `${trigger} reconnect does not forward the old tool response`);
      replacementStarted = false;
      next.socket.onMessage?.({serverContent: {modelTurn: {parts: [{text: 'new reply'}]}, turnComplete: true}});
      assert(h.events.some((event) => (event.detail as {text?: string}).text === 'new reply'),
        `${trigger} reconnect accepts the new reply`);
      ctrl.disconnect();
    }
  } finally {
    if (originalSpeech === undefined) delete globals['speechSynthesis'];
    else globals['speechSynthesis'] = originalSpeech;
    if (originalUtterance === undefined) delete globals['SpeechSynthesisUtterance'];
    else globals['SpeechSynthesisUtterance'] = originalUtterance;
  }
}

async function testDeferredBlobCallback(): Promise<void> {
  const originalWebSocket = globalThis.WebSocket;
  let ws!: MockWebSocket;
  class MockWebSocket {
    readyState = 1;
    onopen?: () => void;
    onmessage?: (event: MessageEvent) => Promise<void>;
    onclose?: () => void;
    constructor() { ws = this; }
    send() {}
    close() {}
  }
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  try {
    const socket = createWebSocketTransport('wss://example.com/live');
    let resolve!: (text: string) => void;
    const text = new Promise<string>((ok) => { resolve = ok; });
    let oldMessages = 0;
    let newMessages = 0;
    socket.onMessage = () => { oldMessages++; };
    const pending = ws.onmessage!({data: {text: () => text}} as MessageEvent);
    socket.onMessage = () => { newMessages++; };
    resolve('{}');
    await pending;
    assert(oldMessages === 1 && newMessages === 0, 'Blob decoding retains the callback that received the frame');
    await ws.onmessage!({data: '{}'} as MessageEvent);
    assert(newMessages === 1, 'subsequent WebSocket frames use the current callback');
    let resolveAfterClose!: (text: string) => void;
    const afterCloseText = new Promise<string>((ok) => { resolveAfterClose = ok; });
    const pendingAfterClose = ws.onmessage!({data: {text: () => afterCloseText}} as MessageEvent);
    socket.close();
    resolveAfterClose('{}');
    await pendingAfterClose;
    assert(newMessages === 1, 'closing transport drops in-flight Blob decode');
  } finally {
    globalThis.WebSocket = originalWebSocket;
  }
}

async function testCaptureReentry(): Promise<void> {
  const h = host(), first = transport(), next = transport();
  const ctrl = new XRGeminiLiveController(h.element);
  const capture = h.element.captureViewFrame.bind(h.element);
  let nested!: Promise<boolean>;
  h.element.captureViewFrame = () => {
    const value = capture();
    if (h.captures.length === 1) {
      ctrl.connect({transport: next.socket, streamFrames: false});
      nested = ctrl.sendFrame();
    }
    return value;
  };
  ctrl.connect({transport: first.socket, streamFrames: false});
  const old = ctrl.sendFrame();
  assert(h.captures.length === 2, 'capture host can replace the session and start its own capture');
  assert(!(await ctrl.sendFrame()), 'outer capture cannot overwrite the replacement admission lock');
  h.captures[0].resolve(frame('old'));
  assert(!(await old), 'capture reentry revokes the old frame');
  assert(!(await ctrl.sendFrame()), 'old completion cannot clear the replacement lock');
  h.captures[1].resolve(frame('new'));
  assert(await nested, 'replacement capture completes normally');
  assert(next.sent.length === 1 && JSON.stringify(next.sent[0]).includes('"new"'), 'only replacement pixels reach its transport');
  ctrl.disconnect();
}

async function testTextProtocolUnchanged(): Promise<void> {
  const h = host(), t = transport(), ctrl = new XRGeminiLiveController(h.element);
  ctrl.connect({transport: t.socket, streamFrames: false});
  const capture = ctrl.sendFrame();
  ctrl.sendText('ordinary text');
  assert(JSON.stringify(t.sent[0]) === JSON.stringify({clientContent: {turns: [{role: 'user', parts: [{text: 'ordinary text'}]}], turnComplete: true}}),
    'text remains immediate and text-only while capture is pending');
  h.captures[0].resolve(frame('pixels')); await capture;
  assert(t.sent.length === 2 && !!t.sent[1].realtimeInput, 'frame transport retains its existing realtime format');
  ctrl.disconnect();
}

function testCloseCleansBeforeReentry(): void {
  for (const remote of [false, true]) {
    const h = host(), first = transport(), next = transport();
    const ctrl = new XRGeminiLiveController(h.element);
    ctrl.connect({transport: first.socket, streamFrames: false});
    ctrl.transcripts.append('model', 'old partial');
    let cleaned = 0; ctrl.audio.close = () => { cleaned++; };
    if (remote) first.socket.onClose?.();
    else {
      first.socket.close = () => {
        assert(cleaned > 0, 'old audio closes before transport-close reentry');
        ctrl.connect({transport: next.socket, streamFrames: false});
        next.socket.onMessage?.({serverContent: {modelTurn: {parts: [{text: 'fresh'}]}}});
      };
      ctrl.disconnect();
    }
    const remaining = ctrl.transcripts.finalize();
    assert(remote ? remaining.length === 0 : remaining[0]?.text === 'fresh',
      'remote closure and reentrant replacement cannot concatenate old partial transcripts');
    ctrl.disconnect();
  }
}

async function testHoldSessionLease(): Promise<void> {
  const globals = globalThis as any;
  const timeout = globals.setTimeout, clear = globals.clearTimeout, original = globals.SpeechRecognition;
  let tick!: () => void, recognition: any;
  globals.setTimeout = (fn: () => void) => { tick = fn; return 1; };
  globals.clearTimeout = () => {};
  globals.SpeechRecognition = class {
    onresult: ((e: any) => void) | null = null;
    constructor() { recognition = this; }
    start() {}
    stop() {}
    abort() {}
  };
  try {
    for (const startSpeech of [false, true]) {
      const element = new EventTarget() as any;
      element.captureViewFrame = async () => frame('green');
      const first = transport(), next = transport();
      geminiLivePlugin.onElementConnected?.(element);
      const ctrl = connectGeminiLive(element, {transport: first.socket, streamFrames: false});
      element.dispatchEvent(new CustomEvent('xr-select-start', {detail: {hit: {mesh: {
        name: 'old object', userData: {xr: {holdToAsk: {prompt: 'old question'}}},
      }}}}));
      if (startSpeech) tick();
      const late = recognition?.onresult;
      ctrl.connect({transport: next.socket, streamFrames: false});
      if (startSpeech) {
        assert(recognition.onresult === null, 'reconnect detaches recognition delivery before abort');
        late?.({results: [[{transcript: 'old speech'}]]});
      } else tick();
      await Promise.resolve(); await Promise.resolve();
      assert(next.sent.length === 0, 'old hold timer/recognition cannot send into the new session');
      geminiLivePlugin.onElementDisconnected?.(element);
    }
  } finally {
    globals.setTimeout = timeout; globals.clearTimeout = clear;
    if (original === undefined) delete globals.SpeechRecognition;
    else globals.SpeechRecognition = original;
  }
}

async function main(): Promise<void> {
  for (const reuseTransport of [false, true]) {
    for (const rejectOld of [false, true]) await testPendingCapture(rejectOld, reuseTransport);
    testStaleCallbacks(reuseTransport);
  }
  await testStaleCamera();
  await testClosedSession(false);
  await testClosedSession(true);
  testTranscriptReset();
  testReconnectDuringDisconnect();
  testReconnectDuringTransportClose();
  await testFrameTimers();
  testReentrantReconnect();
  await testDeferredBlobCallback();
  await testCaptureReentry();
  await testTextProtocolUnchanged();
  testCloseCleansBeforeReentry();
  await testHoldSessionLease();
  console.log(`Gemini Live sessions: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
