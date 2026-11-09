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
import {aiPlugin, normalizeSelection, selectionSentence, type ThreeLiveAIProvider} from '../src/plugins/ai';
import {describeSelection, getSelection, MAX_SELECTION, setSelection} from '../src/plugins/ai-select';
import {
  parseSelectReply,
  resolveSelection,
  sceneSelectEntries,
  SELECT_PROMPT,
  selectCamera,
} from '../src/plugins/ai-select';
import {chipsEnabled, hideSelectionChips, showSelectionChips} from '../src/plugins/ai-select-chips';
import {
  buildSelectIndex,
  colorName,
  matchSelection,
  nameWords,
  parseVoiceCommand,
  singular,
} from '../src/plugins/ai-select-match';
import {
  type AIVoiceTransport,
  describeVoiceSelection,
  selectByVoice,
  selectNamesByVoice,
  speakableName,
  VOICE_TOOLS,
} from '../src/plugins/ai-voice';
import fixture from './fixtures/select_cases.json';
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

const tick = () => new Promise((r) => setTimeout(r, 0));

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

const box = (name: string, x: number, color = '0x888888') =>
  `{ const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: ${color} })); m.name = '${name}'; m.position.set(${x}, 0.5, 0); scene.add(m); }`;
const BASE = [box('Roof', 0), box('Door', 2), box('Chimney', -2)].join('\n');

function fakeElement(attrs: Record<string, string> = {}) {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const events: Array<{type: string; detail: any}> = [];
  const highlighted: string[][] = [];
  const el: any = {
    allowClientScripts: true,
    sandbox: 'worker',
    selectedMesh: null,
    viewer: {setSelectedMeshes: (names: readonly string[]) => highlighted.push([...names])},
    querySelector: (sel: string) => (sel.includes('text/three') ? {textContent: BASE} : null),
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
    dispatch(type: string, ev: any) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
    executeScript: () => Promise.resolve(),
  };
  aiPlugin.onElementConnected!(el);
  return {el, events, highlighted};
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

async function run(): Promise<void> {
  console.log('\n🎯 three-live-ai (B2b-4) Talk-to-Select');
  registerPlugin(aiPlugin);

  // ---- 4a: selection state ----
  {
    const {el, events, highlighted} = fakeElement();
    assert(Array.isArray(el.selectedMeshes) && el.selectedMeshes.length === 0, 'selectedMeshes starts empty');
    const d1 = setSelection(el, ['Roof'], {source: 'voice', query: 'the roof'});
    assert(
      d1!.mesh === 'Roof' && d1!.added.join() === 'Roof' && d1!.source === 'voice' && d1!.query === 'the roof' &&
        el.selectedMesh === 'Roof',
      'replace selects one mesh and mirrors selected-mesh',
    );
    setSelection(el, ['Door', 'Roof'], {mode: 'add'});
    assert(el.selectedMeshes.join() === 'Roof,Door' && el.selectedMesh === 'Roof', 'add keeps order and de-duplicates');
    assert(highlighted.at(-1)!.join() === 'Roof,Door', 'the viewer highlights the whole set');
    setSelection(el, ['Roof', 'Chimney'], {mode: 'toggle'});
    assert(el.selectedMeshes.join() === 'Door,Chimney' && el.selectedMesh === 'Door', 'toggle flips membership');
    setSelection(el, ['Door'], {mode: 'remove'});
    assert(el.selectedMeshes.join() === 'Chimney', 'remove drops meshes');
    assert(setSelection(el, ['Chimney']) === null, 'an unchanged selection fires nothing');
    setSelection(el, null, {mode: 'clear'});
    assert(el.selectedMeshes.length === 0 && el.selectedMesh === null, 'clear empties the selection');
    const sel = events.filter((e) => e.type === 'three-live-select');
    assert(sel.length === 5 && sel[2].detail.removed.join() === 'Roof' && sel[2].detail.added.join() === 'Chimney', 'events carry added / removed');

    el.selectedMeshes = ['A', 'B', 'A', '', 7 as any];
    assert(el.selectedMeshes.join() === 'A,B', 'the selectedMeshes setter cleans its input');
    el.selectedMesh = 'Lamp';
    assert(getSelection(el).join() === 'Lamp', 'an external selected-mesh change wins');
    setSelection(el, Array.from({length: 80}, (_, i) => `M${i}`));
    assert(el.selectedMeshes.length === MAX_SELECTION, 'selections are capped');

    setSelection(el, ['Roof', 'Door']);
    const before = highlighted.length;
    el.fireEvent('three-load', {});
    assert(highlighted.length === before + 1 && highlighted.at(-1)!.join() === 'Roof,Door', 'a reload re-applies the multi highlight');
  }

  // ---- 4a: shared prompt helpers ----
  {
    assert(normalizeSelection(['A', 'A', '', 'B']).join() === 'A,B' && normalizeSelection('A').join() === 'A', 'normalizeSelection');
    assert(selectionSentence([]) === '', 'no selection, no sentence');
    assert(selectionSentence(['Roof']) === 'The user selected the mesh named "Roof"; the instruction refers to it.\n', 'single-mesh wording is unchanged');
    assert(
      selectionSentence(['Roof', 'Door']) === 'The user selected the meshes named "Roof", "Door"; the instruction refers to them.\n',
      'multi-mesh wording',
    );
    assert(describeSelection([]) === 'The user cleared the selection.', 'describeSelection empty');
    assert(describeSelection(['A', 'B']).startsWith('The user selected 2 meshes: "A", "B".'), 'describeSelection many');
    assert(describeSelection(Array.from({length: 25}, (_, i) => `M${i}`)).includes('and 5 more'), 'describeSelection truncates');
  }

  // ---- 4a: editScene with a multi selection ----
  {
    const {el} = fakeElement();
    const blue = BASE.replace(/0x888888/g, '0x1a73e8');
    const {provider, requests} = scripted(['```js\n' + blue + '\n```']);
    el.aiProvider = provider;
    setSelection(el, ['Roof', 'Door']);
    const res = await el.editScene('make them blue');
    assert(res.applied, 'a multi-selection edit applies');
    assert(requests[0][1].content.includes('The user selected the meshes named "Roof", "Door"'), 'the prompt names every selected mesh');

    const dropped = [box('Roof', 0), box('Chimney', -2)].join('\n');
    const {provider: p2} = scripted(['```js\n' + dropped + '\n```', '```js\n' + dropped + '\n```']);
    const lost = await el.editScene('make them blue', {provider: p2});
    assert(!lost.applied && lost.error === 'The edited scene no longer contains the selected mesh "Door".', 'losing any selected mesh rejects the edit');
    const {provider: p3} = scripted(['```js\n' + dropped + '\n```']);
    assert((await el.editScene('remove the door', {provider: p3})).applied, 'removal instructions may drop selected meshes');
    const {provider: p4, requests: r4} = scripted(['```js\n' + BASE + '\n```']);
    await el.editScene('add a lamp', {provider: p4, selection: []});
    assert(!r4[0][1].content.includes('selected'), 'selection: [] edits with no selection');
  }

  // ---- 4a: tap gestures ----
  {
    const {el} = fakeElement({'ai-select-on-tap': ''});
    const tap = (name: string, opts: any = {}) => {
      el.dispatch('pointerdown', {shiftKey: !!opts.shift, ctrlKey: false, metaKey: !!opts.meta});
      el.fireEvent('meshclick', {meshName: name});
    };
    tap('Roof');
    tap('Door');
    assert(el.selectedMeshes.join() === 'Door', 'a plain tap replaces the selection');
    tap('Roof', {shift: true});
    tap('Chimney', {meta: true});
    assert(el.selectedMeshes.join() === 'Door,Roof,Chimney', 'Shift / Cmd-tap adds');
    tap('Roof', {shift: true});
    assert(el.selectedMeshes.join() === 'Door,Chimney', 'Shift-tap on a selected mesh removes it');
    tap('Door');
    assert(el.selectedMeshes.join() === 'Door', 'a plain tap on a multi selection narrows to that mesh');
    tap('Door');
    assert(el.selectedMeshes.length === 0, 'a plain tap on the only selected mesh clears');
    const realNow = Date.now;
    let t = 1000;
    Date.now = () => t;
    el.dispatch('pointerdown', {});
    t += 600;
    el.fireEvent('meshclick', {meshName: 'Roof'});
    el.dispatch('pointerdown', {});
    t += 700;
    el.fireEvent('meshclick', {meshName: 'Door'});
    Date.now = realNow;
    assert(el.selectedMeshes.join() === 'Roof,Door', 'a long press adds');
    const selects = [] as string[];
    el.addEventListener('three-live-select', (e: any) => selects.push(e.detail.source));
    tap('Chimney');
    assert(selects.join() === 'tap', 'tap changes report source: tap');
  }

  // ---- 4a: voice sessions see the multi selection ----
  {
    const {el} = fakeElement();
    el.aiProvider = scripted([]).provider;
    setSelection(el, ['Roof', 'Door']);
    const sent: any[] = [];
    const transport: AIVoiceTransport = {send: (m) => sent.push(m), close() {}};
    const session = await el.connectVoice({transport, microphone: false, playAudio: false});
    assert(
      sent.some((m) => m.item?.role === 'system' && m.item.content[0].text.startsWith('The user selected 2 meshes: "Roof", "Door".')),
      'a new session is told about every selected mesh',
    );
    setSelection(el, ['Chimney'], {mode: 'add'});
    await tick();
    assert(sent.at(-1).item.content[0].text.includes('3 meshes'), 'selection changes are forwarded');
    session.close();
  }


  // ---- 4b: shared tier-1 fixture (same cases as compiler/src/ai_select.rs) ----
  {
    const f: any = fixture;
    const index = buildSelectIndex(f.scene);
    let bad = 0;
    for (const c of f.match) {
      const r = matchSelection(index, c.query, f.camera, c.within ?? null);
      let ok = r.confidence === c.confidence;
      if (c.names) {
        const got = r.confidence === 'ambiguous' ? r.candidates : r.names;
        ok = ok && JSON.stringify(got) === JSON.stringify(c.names);
      }
      if (c.reason) ok = ok && r.reason === c.reason;
      if (!ok) {
        bad++;
        console.error(`      ${JSON.stringify(c.query)} -> ${JSON.stringify(r)}`);
      }
    }
    assert(bad === 0, `all ${f.match.length} shared match cases agree with the Rust core`);
    let badCmd = 0;
    for (const c of f.commands) {
      const got = parseVoiceCommand(c.text);
      if (JSON.stringify(got) !== JSON.stringify(c.want)) {
        badCmd++;
        console.error(`      ${JSON.stringify(c.text)} -> ${JSON.stringify(got)}`);
      }
    }
    assert(badCmd === 0, `all ${f.commands.length} shared push-to-talk commands parse the same`);
    let badSay = 0;
    for (const c of f.say) {
      const got = describeVoiceSelection(c.mode, c.match ? {ids: [], ...c.match} : null, c.meshes, c.query);
      if (got !== c.want) {
        badSay++;
        console.error(`      say ${JSON.stringify(c)} -> ${got}`);
      }
    }
    for (const c of f.context) {
      if (describeSelection(c.meshes) !== c.want) {
        badSay++;
        console.error(`      context ${JSON.stringify(c.meshes)} -> ${describeSelection(c.meshes)}`);
      }
    }
    for (const [name, want] of f.speakable) {
      if (speakableName(name) !== want) {
        badSay++;
        console.error(`      speakable ${name} -> ${speakableName(name)}`);
      }
    }
    assert(badSay === 0, 'spoken wording matches the Rust core (say / context / speakable)');
  }

  // ---- 4b: words, colors ----
  {
    assert(JSON.stringify(nameWords('RedChair_02')) === '["red","chair","02"]', 'nameWords splits camelCase and digits');
    assert(JSON.stringify(nameWords('bookShelves')) === '["book","shelf"]', 'nameWords singularizes');
    assert(singular('boxes') === 'box' && singular('glass') === 'glass', 'singular');
    assert(colorName([1, 0, 0]) === 'red', 'linear red is red');
    assert(colorName([0.5, 0.5, 0.5]) === 'silver', 'linear 0.5 is converted to sRGB first');
    assert(speakableName('FloorLamp_2') === 'Floor Lamp 2', 'speakableName');
    assert(matchSelection([], 'the chair').confidence === 'none', 'empty index → none');
    assert(matchSelection(buildSelectIndex([{name: 'toString', min: [0, 0, 0], max: [1, 1, 1]}]), 'constructor').reason === 'no_match', 'prototype words are not vocabulary');
  }

  // ---- 4b: web scene index + camera ----
  const unitBox = new Float32Array([-0.5, -0.5, -0.5, 0.5, 0.5, 0.5]);
  const meshAt = (name: string, x: number, color: number[], extra: any = {}) => ({
    name,
    transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0.5, 0, 1]),
    primitives: [{positions: unitBox, baseColor: [...color, 1]}],
    ...extra,
  });
  {
    const el: any = {
      viewer: {
        meshes: [
          meshAt('Chair_A', -2, [0.8, 0.02, 0.02]),
          meshAt('Chair_B', 2, [0.02, 0.05, 0.7]),
          meshAt('Ghost', 0, [1, 1, 1], {visible: false}),
          meshAt('', 0, [1, 1, 1]),
          {name: 'Empty', transform: new Float32Array(16), primitives: []},
        ],
        getCameraOrbit: () => ({theta: 0, phi: 0, radius: 5}),
        getCameraTarget: () => ({x: 0, y: 0.5, z: 0}),
      },
    };
    const entries = sceneSelectEntries(el);
    assert(entries.length === 2, 'hidden, unnamed, and empty meshes are skipped');
    assert(JSON.stringify(entries[0].min) === '[-2.5,0,-0.5]' && JSON.stringify(entries[0].max) === '[-1.5,1,0.5]', 'world box uses the node transform');
    const cam = selectCamera(el);
    assert(Math.abs(cam.eye[2] - 5) < 1e-9 && cam.eye[1] === 0.5, 'camera eye from orbit + target');
    assert(resolveSelection(el, 'the left chair').names.join() === 'Chair_A', 'resolveSelection: left chair');
    assert(resolveSelection(el, 'the blue chair').names.join() === 'Chair_B', 'resolveSelection: blue chair');
    // Looking from behind (theta = π) flips left and right.
    el.viewer.getCameraOrbit = () => ({theta: Math.PI, phi: 0, radius: 5});
    assert(resolveSelection(el, 'the left chair').names.join() === 'Chair_B', 'left/right follow the camera');
    assert(JSON.stringify(selectCamera({viewer: null})) === JSON.stringify({eye: [0, 1.6, 5], target: [0, 0.8, 0]}), 'default camera without a viewer');
    el.viewer.getCameraOrbit = () => ({theta: NaN, phi: 0, radius: 5});
    assert(selectCamera(el).eye[2] === 5, 'non-finite orbit falls back to the default camera');
  }

  // ---- 4b: push-to-talk Talk-to-Select ----
  {
    const sceneMeshes = [
      meshAt('Chair_Left', -2, [0.8, 0.02, 0.02]),
      meshAt('Chair_Middle', 0, [0.02, 0.05, 0.7]),
      meshAt('Chair_Right', 2, [0.8, 0.02, 0.02]),
    ];
    const setup = (replies: string[]) => {
      const f = fakeElement();
      f.el.viewer.meshes = sceneMeshes;
      const s = scripted(replies);
      f.el.aiProvider = s.provider;
      const say = (text: string) => ({listen: async () => text});
      return {...f, requests: s.requests, say};
    };
    const voiceStates = (events: any[]) => events.filter((e) => e.type === 'three-live-voice').map((e) => e.detail);

    {
      const {el, events, say, requests} = setup([]);
      const r = await el.startVoiceEdit({recognizer: say('select the red chairs'), speak: false});
      assert(r.result === null && r.selection.applied, 'select-only utterance changes the selection without editing');
      assert(getSelection(el).join() === 'Chair_Left,Chair_Right', 'the red chairs are selected');
      assert(requests.length === 0, 'no model call for a tier-1 selection');
      const sel = events.filter((e) => e.type === 'three-live-select').at(-1).detail;
      assert(sel.source === 'voice' && sel.query === 'the red chairs', 'select event reports source voice + query');
      assert(voiceStates(events).at(-1).selection.say === 'Selected 2: Chair Left and Chair Right.', 'confirmation text');
    }
    {
      const {el, say} = setup([]);
      setSelection(el, ['Chair_Left', 'Chair_Middle']);
      const r = await el.startVoiceEdit({recognizer: say('deselect the red one'), speak: false});
      assert(r.selection.applied && getSelection(el).join() === 'Chair_Middle', 'deselect looks only inside the selection');
      await el.startVoiceEdit({recognizer: say('also select the chair on the right'), speak: false});
      assert(getSelection(el).join() === 'Chair_Middle,Chair_Right', '"also select" adds');
      const c = await el.startVoiceEdit({recognizer: say('clear the selection'), speak: false});
      assert(getSelection(el).length === 0 && c.selection.say === 'Selection cleared.', 'clear');
      const d = await el.startVoiceEdit({recognizer: say('deselect the sofa'), speak: false});
      assert(!d.selection.applied && d.selection.say === 'Nothing is selected.', 'deselect with nothing selected');
    }
    {
      const {el, say, requests} = setup([]);
      setSelection(el, ['Chair_Middle']);
      const r = await el.startVoiceEdit({recognizer: say('select the red chair'), speak: false});
      assert(!r.selection.applied && r.result === null, 'ambiguous reference does not change the selection');
      assert(getSelection(el).join() === 'Chair_Middle', 'selection kept');
      assert(r.selection.say === 'Which one: Chair Left or Chair Right?', 'asks which one');
      assert(requests.length === 0, 'and does not edit');
    }
    {
      const {el, say, requests} = setup([
        "```js\nconst c = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color: 'green'}));\nc.name = 'Roof'; scene.add(c);\n```",
      ]);
      const r = await el.startVoiceEdit({recognizer: say('Select the blue chair and make it Green'), speak: false});
      assert(r.selection?.applied && getSelection(el).join() === 'Chair_Middle', 'mixed: selects first');
      const user = requests[0]?.find((m: any) => m.role === 'user')?.content ?? '';
      assert(user.includes('"Chair_Middle"') && user.includes('make it Green'), 'mixed: edits the new selection with the instruction (casing kept)');
      assert(!user.includes('Select the blue chair'), 'mixed: the select phrase is not part of the instruction');
    }
    {
      const {el, say, requests} = setup([]);
      const r = await el.startVoiceEdit({recognizer: say('select the giraffe and make it red'), speak: false});
      assert(!r.selection.applied && r.result === null && requests.length === 1, 'mixed with no match: tier 2 is tried, no edit');
      assert(r.selection.say === 'I couldn\'t find "the giraffe".', 'says what was not found');
    }
    {
      const {el, say, requests} = setup(['```js\nscene.add(new THREE.Object3D());\n```']);
      await el.startVoiceEdit({recognizer: say('select the chairs'), speak: false, talkToSelect: false});
      const first = requests[0]?.find((m: any) => m.role === 'user')?.content ?? '';
      assert(first.includes('select the chairs'), 'talkToSelect: false sends everything to editScene');
    }
    {
      const {el} = setup([]);
      const r = await el.selectByVoice('the middle chair');
      assert(r.applied && getSelection(el).join() === 'Chair_Middle', 'el.selectByVoice');
      const r2 = await selectByVoice(el, 'the chair next to the sofa');
      assert(!r2.applied && r2.match?.reason === 'relation', 'relations are left to tier 2');
      assert(describeVoiceSelection('add', {ids: [0], names: ['A_b'], confidence: 'high', candidates: [], reason: 'match'}, ['X', 'A_b'], '') === 'Added A b. 2 selected.', 'add confirmation');
    }
  }

  // ---- 4c: tier 2, select_meshes tool, chips ----
  {
    const sceneMeshes = [
      meshAt('Chair_Left', -2, [0.8, 0.02, 0.02]),
      meshAt('Chair_Middle', 0, [0.02, 0.05, 0.7]),
      meshAt('Chair_Right', 2, [0.8, 0.02, 0.02]),
      meshAt('Sofa', 0, [0.2, 0.2, 0.2]),
    ];
    const setup = (replies: string[]) => {
      const f = fakeElement();
      f.el.viewer.meshes = sceneMeshes;
      const s = scripted(replies);
      f.el.aiProvider = s.provider;
      return {...f, requests: s.requests, say: (text: string) => ({listen: async () => text})};
    };

    {
      const {el, requests} = setup(['Sure: {"ids": [2, 99, "x"], "confidence": "high", "question": ""}']);
      const r = await el.selectByVoice('the chair next to the sofa');
      assert(r.applied && r.tier === 2 && getSelection(el).join() === 'Chair_Right', 'tier 2 resolves a relation; bad ids are dropped');
      const [sys, user] = requests[0];
      const payload = JSON.parse(user.content);
      assert(sys.content === SELECT_PROMPT, 'tier 2 uses the shared select prompt');
      assert(payload.objects.length === 4 && payload.objects[0].name === 'Chair_Left' && payload.objects[0].color === 'red', 'tier 2 sees the index');
      assert(payload.request === 'the chair next to the sofa' && Array.isArray(payload.camera.right), 'tier 2 sees the request and camera');
    }
    {
      const {el} = setup(['{"ids": [0, 2], "confidence": "low", "question": "Which chair: the left or the right one?"}']);
      setSelection(el, ['Sofa']);
      const r = await el.selectByVoice('the chair by the window');
      assert(!r.applied && r.say === 'Which chair: the left or the right one?' && r.match.candidates.join() === 'Chair_Left,Chair_Right', 'tier 2 low confidence asks its question');
      assert(getSelection(el).join() === 'Sofa', 'and keeps the selection');
    }
    {
      const {el} = setup(['no json here']);
      const r = await el.selectByVoice('the chair behind the sofa');
      assert(!r.applied && r.tier === 2 && r.match.confidence === 'none', 'unparseable tier-2 reply → none');
    }
    {
      const {el, requests} = setup([]);
      const r = await el.selectByVoice('the chair behind the sofa');
      assert(!r.applied && r.tier === 1 && r.match.reason === 'relation' && requests.length === 1, 'tier-2 failure falls back to tier 1');
    }
    {
      const {el, requests} = setup([]);
      el.aiProvider = undefined;
      const r = await el.selectByVoice('the chair behind the sofa');
      assert(!r.applied && requests.length === 0, 'no code model → no tier 2');
      await el.selectByVoice('the red chair');
      assert(requests.length === 0, 'ambiguous references ask the user instead of the model');
    }
    {
      const reply = parseSelectReply('{"ids":[0,0,1],"confidence":"high","question":"a\\u0007b"}', buildSelectIndex([
        {name: 'A', min: [0, 0, 0], max: [1, 1, 1]},
        {name: 'B', min: [0, 0, 0], max: [1, 1, 1]},
      ]));
      assert(reply.names.join() === 'A,B' && reply.question === 'a b', 'parseSelectReply dedupes and strips control characters');
      assert(parseSelectReply('{"ids":[],"confidence":"high"}', []).confidence === 'low', 'high with no ids is low');
    }

    // selectNamesByVoice
    {
      const {el} = setup([]);
      const r = selectNamesByVoice(el, ['Sofa', 'Nope', 42 as any]);
      assert(r.applied && getSelection(el).join() === 'Sofa', 'selectNamesByVoice ignores unknown names');
      const r2 = selectNamesByVoice(el, ['Nope']);
      assert(!r2.applied && getSelection(el).join() === 'Sofa', 'only unknown names → nothing changes');
    }

    // Realtime select_meshes tool.
    {
      assert(VOICE_TOOLS.some((t) => t.name === 'select_meshes'), 'select_meshes is a voice tool');
      const {el} = setup(['{"ids":[3],"confidence":"high"}']);
      const sent: any[] = [];
      const transport: AIVoiceTransport = {send: (m) => sent.push(m), close() {}};
      const session = await el.connectVoice({transport, microphone: false, playAudio: false});
      const setupMsg = sent.find((m) => m.type === 'session.update');
      assert(setupMsg.session.instructions.includes('call select_meshes with their words first'), 'instructions ask for select_meshes first');
      const call = async (id: string, args: any) => {
        transport.onMessage!({type: 'response.function_call_arguments.done', call_id: id, name: 'select_meshes', arguments: JSON.stringify(args)});
        for (let i = 0; i < 20 && !sent.some((m) => m.item?.call_id === id); i++) await tick();
        return JSON.parse(sent.find((m) => m.item?.call_id === id).item.output);
      };
      const before = sent.length;
      let out = await call('s1', {query: 'the red chairs'});
      assert(out.changed && out.selected.join() === 'Chair_Left,Chair_Right' && out.say.startsWith('Selected 2'), 'select_meshes by query');
      assert(!sent.slice(before).some((m) => m.item?.role === 'system'), 'voice selections are not echoed as context');
      out = await call('s2', {query: 'the red chair'});
      assert(!out.changed && out.question.startsWith('Which one') && out.candidates.length === 2, 'ambiguous → question + candidates');
      out = await call('s3', {names: ['Sofa'], mode: 'add'});
      assert(out.changed && out.selected.join() === 'Chair_Left,Chair_Right,Sofa', 'select_meshes by names (add)');
      out = await call('s4', {query: 'the thing next to the window'});
      assert(out.changed && out.selected.join() === 'Sofa', 'select_meshes uses tier 2 for relations');
      out = await call('s5', {mode: 'clear'});
      assert(out.changed && out.selected.length === 0, 'select_meshes clear');
      out = await call('s6', {mode: 'bogus', names: ['Chair_Middle']});
      assert(out.changed && out.selected.join() === 'Chair_Middle', 'unknown mode → replace');
      session.close();
    }

    // Push-to-talk: a mixed command resolved by tier 2 waits for confirmation.
    {
      const {el, say, requests} = setup(['{"ids":[1],"confidence":"high"}']);
      const r = await el.startVoiceEdit({recognizer: say('select the chair near the sofa and paint it gold'), speak: false});
      assert(r.selection.applied && r.selection.tier === 2 && r.result === null, 'tier-2 mixed: selects but does not edit');
      assert(requests.length === 1, 'only the selection call was made');
    }
  }

  // ---- 4c: chips (fake DOM) ----
  {
    class FakeNode {
      children: FakeNode[] = [];
      style: Record<string, string> = {};
      attrs: Record<string, string> = {};
      textContent = '';
      type = '';
      parent: FakeNode | null = null;
      listeners: Record<string, Array<(e: any) => void>> = {};
      constructor(public tag: string) {}
      setAttribute(k: string, v: string) { this.attrs[k] = v; }
      getAttribute(k: string) { return this.attrs[k] ?? null; }
      appendChild(c: FakeNode) { c.parent = this; this.children.push(c); return c; }
      replaceChildren() { this.children = []; }
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
      addEventListener(t: string, fn: (e: any) => void) { (this.listeners[t] ??= []).push(fn); }
      click() { for (const fn of this.listeners['click'] ?? []) fn({stopPropagation() {}}); }
    }
    const g = globalThis as any;
    const prevDoc = g.document;
    g.document = {createElement: (t: string) => new FakeNode(t)};
    try {
      const f = fakeElement();
      const host = new FakeNode('three-live');
      f.el.appendChild = (n: FakeNode) => host.appendChild(n);
      f.el.viewer.meshes = [meshAt('Chair_Left', -2, [0.8, 0.02, 0.02]), meshAt('Chair_Right', 2, [0.8, 0.02, 0.02])];
      const buttons = () => (host.children[0]?.children ?? []).filter((c) => c.tag === 'button');
      const texts = () => (host.children[0]?.children ?? []).map((c) => c.textContent);

      // Ambiguous push-to-talk → question chips.
      const scriptedP = scripted(['```js\nscene.add(new THREE.Object3D());\n```']);
      f.el.aiProvider = undefined;
      await f.el.startVoiceEdit({recognizer: {listen: async () => 'select the red chair and make it blue'}, speak: false});
      const root = host.children[0];
      assert(!!root && root.attrs['role'] === 'status' && root.attrs['aria-live'] === 'polite', 'chips overlay is an aria-live status region');
      assert(texts()[0] === 'Which one: Chair Left or Chair Right?' && buttons().length === 3, 'question + candidate buttons + dismiss');
      // Pick a candidate → selected state with Apply for the waiting edit.
      f.el.aiProvider = scriptedP.provider;
      buttons()[1].click();
      assert(getSelection(f.el).join() === 'Chair_Right', 'tapping a candidate selects it');
      assert(texts().join('|') === 'Selected:|Chair Right ×|Apply: make it blue|✕', 'then shows the selection and Apply');
      buttons().find((b) => b.textContent.startsWith('Apply'))!.click();
      for (let i = 0; i < 20 && !scriptedP.requests.length; i++) await tick();
      const user = scriptedP.requests[0]?.find((m: any) => m.role === 'user')?.content ?? '';
      assert(user.includes('"Chair_Right"') && user.includes('make it blue'), 'Apply runs the waiting edit on the selection');
      assert(!texts().some((t) => t.startsWith('Apply')), 'Apply disappears once used');
      // × removes; the chips follow the selection and close when it is empty.
      setSelection(f.el, ['Chair_Left', 'Chair_Right']);
      assert(texts().join('|') === 'Selected:|Chair Left ×|Chair Right ×|✕', 'chips follow selection changes');
      buttons()[0].click();
      assert(getSelection(f.el).join() === 'Chair_Right', '× removes that mesh');
      buttons()[0].click();
      assert(host.children.length === 0 && !f.el.__tlChips, 'chips close when nothing is selected');
      // Dismiss.
      setSelection(f.el, ['Chair_Left']);
      showSelectionChips(f.el, {});
      buttons().at(-1)!.click();
      assert(host.children.length === 0, '✕ dismisses');
      // An edit utterance closes stale chips; ai-select-chips="off" disables them.
      showSelectionChips(f.el, {});
      f.el.aiProvider = scripted(['```js\nscene.add(new THREE.Object3D());\n```']).provider;
      await f.el.startVoiceEdit({recognizer: {listen: async () => 'make it shiny'}, speak: false});
      assert(host.children.length === 0, 'a plain edit closes the chips');
      const off = fakeElement({'ai-select-chips': 'off'});
      assert(!chipsEnabled(off.el) && showSelectionChips(off.el, {}) === null, 'ai-select-chips="off" disables chips');
      hideSelectionChips(off.el);
    } finally {
      g.document = prevDoc;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
