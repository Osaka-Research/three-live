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

import {ThreeLiveElement} from '../src/three-live-element';

let passed = 0;
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
  passed++;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return {promise, resolve, reject};
}
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const model = (name: string) => ({gltf: {asset: {version: '2.0'}, extras: {name}}, bin: new ArrayBuffer(0)});
function element() {
  const el: any = Object.create(ThreeLiveElement.prototype);
  el.currentModel = model('visible');
  el.isModelLoaded = true;
  el.getAttribute = () => null;
  el.hasAttribute = () => true;
  el.hidePoster = el.setSlotVisible = el.updateHotspots = el.showToast = () => {};
  el.events = [];
  el.fireEvent = (name: string, detail: unknown) => el.events.push({name, detail});
  el.emitError = (error: Error) => el.events.push({name: 'error', error});
  el.viewer = {
    loadGLBData(data: unknown) { el.rendered = data; },
    clearScene() { throw new Error('must not clear before acceptance'); },
    updateMeshTransforms() { el.updates = (el.updates || 0) + 1; },
    destroy() {},
  };
  return el;
}
async function main() {
  const originalFetch = globalThis.fetch;
  const originalRunner = ThreeLiveElement.scriptRunner;
  try {
    const el = element();
    const first = deferred<any>();
    let signal: AbortSignal | undefined;
    globalThis.fetch = ((_url: unknown, options: any) => { signal = options.signal; return first.promise; }) as any;
    const old = el.loadModel('first.glb').then(() => null, (e: Error) => e);
    const visible = el.currentModel;
    assert(el.currentModel === visible && el.isModelLoaded, 'fetch retains accepted model and loaded state');
    const next = model('new');
    await el.loadModel(next);
    assert(signal?.aborted, 'replacement aborts old fetch');
    first.resolve({ok: true, arrayBuffer: async () => new ArrayBuffer(0)});
    assert((await old)?.name === 'AbortError', 'obsolete fetch rejects even when transport ignores abort');
    assert(el.currentModel === next && el.events.filter((e: any) => e.name === 'three-load').length === 1,
      'obsolete fetch cannot replace model or publish load events');
    globalThis.fetch = (async () => { throw new Error('network failed'); }) as any;
    await el.loadModel('broken.glb').catch(() => {});
    assert(el.currentModel === next && el.isModelLoaded, 'failed fetch preserves scene and loaded state');

    const body = deferred<ArrayBuffer>();
    globalThis.fetch = (async () => ({ok: true, arrayBuffer: () => body.promise})) as any;
    const delayedBody = el.loadModel('body.glb').catch((e: Error) => e);
    await tick();
    await el.loadModel(next);
    body.resolve(new ArrayBuffer(0));
    assert((await delayedBody).name === 'AbortError', 'response-body race is revision fenced');

    const jobs: any[] = [];
    ThreeLiveElement.registerScriptRunner({execute(_code, _sandbox, callbacks) {
      const handle = deferred<any>();
      jobs.push({callbacks, handle});
      return handle.promise;
    }});
    const a = el.executeScript('a').catch((e: Error) => e);
    await tick();
    const b = el.executeScript('b').catch((e: Error) => e);
    await tick();
    assert((await a).name === 'AbortError', 'superseded script promise settles as aborted');
    jobs[0].callbacks.onModelReady(model('stale'));
    jobs[0].callbacks.onUpdateTransforms([]);
    jobs[0].callbacks.onError(new Error('obsolete'));
    assert(el.currentModel === next && !el.updates, 'stale script model, transform, and error callbacks are fenced');
    let retired = 0;
    jobs[0].handle.resolve({terminate() { retired++; }});
    await tick();
    assert(retired === 1, 'late handle from obsolete runner is terminated');
    const accepted = model('b');
    jobs[1].callbacks.onModelReady(accepted);
    await b;
    jobs[1].callbacks.onUpdateTransforms([]);
    assert(el.currentModel === accepted && el.updates === 1, 'accepted streaming script can update its scene');
    await el.loadModel(next);
    jobs[1].callbacks.onUpdateTransforms([]);
    assert(el.updates === 1, 'model load revokes prior script transform authority');
    jobs[1].handle.resolve({terminate() { retired++; }});
    await tick();
    assert(retired === 2, 'model replacement retires late script handle');

    const c = el.executeScript('c').catch((e: Error) => e);
    await tick();
    el.disconnectedCallback();
    assert((await c).name === 'AbortError', 'disconnect rejects pending script promise');
    jobs[2].callbacks.onModelReady(model('disconnected'));
    assert(el.currentModel === next, 'disconnect fences late model delivery');

    const fail = element();
    ThreeLiveElement.registerScriptRunner({execute() { throw new Error('setup failed'); }});
    const before = fail.currentModel;
    await fail.executeScript('bad').catch(() => {});
    assert(fail.currentModel === before && fail.isModelLoaded, 'synchronous runner failure retains prior scene');
    console.log(`${passed} scene lifecycle checks passed`);
  } finally {
    globalThis.fetch = originalFetch;
    ThreeLiveElement.registerScriptRunner(originalRunner as any);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
