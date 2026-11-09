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

import {getSharedRegistry} from '../src/plugin';
import {
  aiPlugin,
  createAIChatProvider,
  type ThreeLiveAIProvider,
} from '../src/plugins/ai';
import {
  type AISpatialObject,
  type AISpatialPlane,
  type AISpatialPriors,
  buildImageMessages,
  buildImageUserText,
  compileFromImage,
  detectImageMime,
  formatSpatialPriors,
  IMAGE_SYSTEM_PROMPT,
  imageRepairMessage,
  isAllowedImageUrl,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PROMPT_CHARS,
  MAX_PRIOR_LABEL_CHARS,
  MAX_PRIOR_OBJECTS,
  MAX_PRIOR_PLANES,
  normalizeImageInput,
} from '../src/plugins/ai-image';
import {Scene, THREE} from '../src/three-author';
import fixture from './fixtures/image_cases.json';

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

// Install sandboxed mock scriptRunner that executes ThreeAuthor Scene + captures warnings.
getSharedRegistry().scriptRunner = {
  async execute(script: string, _sandbox: string, cb: any) {
    setTimeout(() => {
      try {
        if (script.includes('TRIGGER_TOAST_WARNING')) {
          cb.onToast?.(
            '[TL102] ShaderMaterial degraded to MeshStandardMaterial.',
          );
        }
        const scene = new Scene();
        // eslint-disable-next-line no-new-func
        new Function('THREE', 'scene', 'camera', script)(THREE, scene, {
          position: {set() {}},
          lookAt() {},
        });
        const glb = scene.toGLB();
        cb.onModelReady(
          glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
        );
      } catch (e) {
        cb.onError?.(e);
      }
    }, 0);
    return {terminate() {}};
  },
};

const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const VALID_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const VALID_WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

const CLEAN_DESK_SCRIPT = [
  'const desk = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.75, 0.7), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));',
  "desk.name = 'Desk';",
  'desk.position.set(0, 0.375, 0);',
  'scene.add(desk);',
  'const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.45, 16), new THREE.MeshStandardMaterial({ color: 0xcccccc }));',
  "lamp.name = 'Lamp';",
  'lamp.position.set(0.45, 0.95, -0.15);',
  'lamp.userData.xr = { grab: true };',
  'scene.add(lamp);',
].join('\n');

const UNNAMED_XR_SCRIPT = [
  'const prop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }));',
  'prop.userData.xr = { grab: true };',
  'scene.add(prop);',
].join('\n');

function fakeElement(initialScript = '') {
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const events: Array<{type: string; detail: any}> = [];
  const executed: string[] = [];
  const viewerMeshes: Array<{
    name: string;
    transform: number[];
    visible: boolean;
    primitives: Array<{positions: Float32Array; baseColor: [number, number, number]}>;
  }> = [];
  const el: any = {
    allowClientScripts: true,
    sandbox: 'worker',
    selectedMesh: null,
    viewer: {
      meshes: viewerMeshes,
      setSelectedMeshes() {},
    },
    querySelector: (sel: string) =>
      sel.includes('text/three') && initialScript
        ? {textContent: initialScript}
        : null,
    getAttribute: () => null,
    hasAttribute: () => false,
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
    async executeScript(script: string) {
      executed.push(script);
      const scene = new Scene();
      // eslint-disable-next-line no-new-func
      new Function('THREE', 'scene', 'camera', script)(THREE, scene, {
        position: {set() {}},
        lookAt() {},
      });
      scene.updateMatrixWorld(true);
      viewerMeshes.length = 0;
      scene.traverse((obj: any) => {
        if (obj?.geometry && obj.name) {
          const pos = obj.geometry.attributes?.position?.array;
          const col = obj.material?.color;
          viewerMeshes.push({
            name: obj.name,
            transform: Array.from(obj.matrixWorld.elements),
            visible: obj.visible !== false,
            primitives: [
              {
                positions:
                  pos instanceof Float32Array
                    ? pos
                    : new Float32Array([-0.5, 0, -0.5, 0.5, 1, 0.5]),
                baseColor: [col?.r ?? 0.8, col?.g ?? 0.8, col?.b ?? 0.8],
              },
            ],
          });
        }
      });
    },
  };
  aiPlugin.onElementConnected!(el);
  return {el, events, executed};
}

function scriptedProvider(replies: string[]) {
  const requests: any[] = [];
  const provider: ThreeLiveAIProvider = {
    async complete(req) {
      requests.push(req.messages.map((m) => ({...m})));
      const r = replies.shift();
      if (r === undefined) {
        throw new Error(
          `no more scripted replies (extra turn: ${JSON.stringify(req.messages.slice(2))})`,
        );
      }
      return r;
    },
  };
  return {provider, requests};
}

async function runTests(): Promise<void> {
  console.log('=== Running three_ai_image_test.ts (Phases 4a & 4b) ===');

  // 1. Shared fixture cases (`priors`, `messages`, `repairs`)
  for (const c of fixture.priors) {
    const got = formatSpatialPriors(
      c.priors as unknown as AISpatialPriors | null,
    );
    assert(
      got === c.expected,
      `fixture priors case '${c.name}' matches expected output`,
    );
  }

  for (const c of fixture.messages) {
    const msgs = buildImageMessages(
      c.imageUrl,
      c.prompt,
      c.priors as unknown as AISpatialPriors | null,
    );
    assert(msgs.length === 2, `fixture messages '${c.name}' has 2 messages`);
    assert(
      msgs[0].role === 'system' && msgs[0].content === IMAGE_SYSTEM_PROMPT,
      `fixture messages '${c.name}' system prompt matches IMAGE_SYSTEM_PROMPT`,
    );
    const content = msgs[1].content;
    const isArray = Array.isArray(content) && content.length === 2;
    assert(
      isArray,
      `fixture messages '${c.name}' user content is 2-part array`,
    );
    if (Array.isArray(content)) {
      const part0 = content[0];
      const part1 = content[1];
      assert(
        part0.type === 'image_url' && part0.image_url.url === c.imageUrl,
        `fixture messages '${c.name}' image_url part matches`,
      );
      assert(
        part1.type === 'text' && part1.text === c.expectedUserText,
        `fixture messages '${c.name}' text part matches expectedUserText`,
      );
    }
  }

  for (const c of fixture.repairs) {
    const got = imageRepairMessage(c.error, c.warnings);
    assert(
      got === c.expected,
      `fixture repairs case '${c.name}' matches expected output`,
    );
  }

  // 2. URL validation (`isAllowedImageUrl`)
  assert(
    isAllowedImageUrl('data:image/png;base64,iVBORw0KGgo='),
    'isAllowedImageUrl accepts base64 PNG data URI',
  );
  assert(
    isAllowedImageUrl('data:image/jpeg;base64,/9j/4AAQ'),
    'isAllowedImageUrl accepts base64 JPEG data URI',
  );
  assert(
    isAllowedImageUrl('data:image/jpg;base64,/9j/4AAQ'),
    'isAllowedImageUrl accepts base64 JPG data URI',
  );
  assert(
    isAllowedImageUrl('data:image/webp;base64,UklGRg=='),
    'isAllowedImageUrl accepts base64 WebP data URI',
  );
  assert(
    isAllowedImageUrl('https://example.com/photo.jpg'),
    'isAllowedImageUrl accepts https:// URL',
  );
  assert(
    isAllowedImageUrl('http://localhost:8080/photo.jpg'),
    'isAllowedImageUrl accepts http://localhost URL',
  );
  assert(
    isAllowedImageUrl('http://127.0.0.1:11434/img.png'),
    'isAllowedImageUrl accepts http://127.0.0.1 URL',
  );
  assert(
    isAllowedImageUrl('http://[::1]:8000/img.png'),
    'isAllowedImageUrl accepts http://[::1] URL',
  );
  assert(!isAllowedImageUrl(''), 'isAllowedImageUrl rejects empty string');
  assert(
    !isAllowedImageUrl('http://example.com/photo.jpg'),
    'isAllowedImageUrl rejects non-loopback http:// URL',
  );
  assert(
    !isAllowedImageUrl('javascript:alert(1)'),
    'isAllowedImageUrl rejects javascript: URI',
  );
  assert(
    !isAllowedImageUrl('data:text/html;base64,PHNjcmlwdD4='),
    'isAllowedImageUrl rejects non-image data: URI',
  );
  assert(
    !isAllowedImageUrl('data:image/png;base64,not valid base64!!!'),
    'isAllowedImageUrl rejects invalid base64 payload',
  );

  let threwOnBadUrl = false;
  try {
    buildImageMessages('http://insecure.example.com/a.png');
  } catch {
    threwOnBadUrl = true;
  }
  assert(threwOnBadUrl, 'buildImageMessages throws on disallowed imageUrl');

  // 3. Edge cases: truncation & negative-zero normalization
  const manyPlanes: AISpatialPlane[] = Array.from({length: 40}, (_, i) => ({
    label: `plane_${i}_${'x'.repeat(100)}`,
    orientation: i % 2 === 0 ? 'horizontal' : 'vertical',
    center: [-0, i * 0.1, -0.00001],
  }));
  const manyObjects: AISpatialObject[] = Array.from({length: 40}, (_, i) => ({
    label: `obj_${i}`,
    center: [i, 0, -0],
    yawDeg: -0,
  }));
  const priorsBlock = formatSpatialPriors({
    floorY: -0,
    planes: manyPlanes,
    objects: manyObjects,
  });
  assert(
    priorsBlock.includes('- Floor height: y = 0.00 m'),
    'formatSpatialPriors normalizes -0 floorY to 0.00',
  );
  assert(
    priorsBlock.includes(`  ${MAX_PRIOR_PLANES}. `) &&
      !priorsBlock.includes(`  ${MAX_PRIOR_PLANES + 1}. `),
    `formatSpatialPriors caps planes at ${MAX_PRIOR_PLANES}`,
  );
  assert(
    priorsBlock.includes(
      `  ${MAX_PRIOR_OBJECTS}. "obj_${MAX_PRIOR_OBJECTS - 1}"`,
    ) && !priorsBlock.includes(`"obj_${MAX_PRIOR_OBJECTS}"`),
    `formatSpatialPriors caps objects at ${MAX_PRIOR_OBJECTS}`,
  );
  const firstPlaneMatch = priorsBlock.match(/1\. horizontal "([^"]+)"/);
  assert(
    firstPlaneMatch !== null &&
      firstPlaneMatch[1].length === MAX_PRIOR_LABEL_CHARS,
    `formatSpatialPriors caps plane label at ${MAX_PRIOR_LABEL_CHARS} chars`,
  );
  assert(
    priorsBlock.includes('yaw 0 deg') && !priorsBlock.includes('-0'),
    'formatSpatialPriors never emits -0 in coordinates or yaw',
  );

  const longPrompt = 'p'.repeat(MAX_IMAGE_PROMPT_CHARS + 500);
  const userText = buildImageUserText(longPrompt, null);
  assert(
    userText.includes(
      `Additional instructions: ${'p'.repeat(MAX_IMAGE_PROMPT_CHARS)}\n`,
    ) && !userText.includes('p'.repeat(MAX_IMAGE_PROMPT_CHARS + 1)),
    `buildImageUserText truncates prompt at ${MAX_IMAGE_PROMPT_CHARS} chars`,
  );

  // 4. Multimodal AIChatMessage serialization in createAIChatProvider
  let capturedBody: any = null;
  const chatProvider = createAIChatProvider({
    endpoint: 'https://api.example.com/v1/chat/completions',
    model: 'gemini-2.5-flash',
    fetch: (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{message: {content: '```js\nscene.add(m);\n```'}}],
          }),
      } as unknown as Response;
    }) as typeof fetch,
  });
  const multimodalMessages = buildImageMessages(
    'data:image/png;base64,iVBORw0KGgo=',
    'modern oak desk',
    {floorY: 0},
  );
  const reply = await chatProvider.complete({messages: multimodalMessages});
  assert(
    reply.includes('scene.add(m);'),
    'createAIChatProvider returns completion for multimodal messages',
  );
  assert(
    Array.isArray(capturedBody?.messages?.[1]?.content) &&
      capturedBody.messages[1].content[0].type === 'image_url' &&
      capturedBody.messages[1].content[0].image_url.url ===
        'data:image/png;base64,iVBORw0KGgo=' &&
      capturedBody.messages[1].content[1].type === 'text',
    'createAIChatProvider serializes multimodal content array verbatim in JSON body',
  );

  // 5. Phase 4b: detectImageMime & normalizeImageInput
  assert(
    detectImageMime(VALID_PNG) === 'image/png',
    'detectImageMime identifies PNG magic bytes',
  );
  assert(
    detectImageMime(VALID_JPEG) === 'image/jpeg',
    'detectImageMime identifies JPEG magic bytes',
  );
  assert(
    detectImageMime(VALID_WEBP) === 'image/webp',
    'detectImageMime identifies WebP magic bytes',
  );
  assert(
    detectImageMime(new Uint8Array([0x47, 0x49, 0x46])) === null,
    'detectImageMime rejects non-PNG/JPEG/WebP magic bytes',
  );

  const normDataJpg = await normalizeImageInput('data:image/jpg;base64,/9j/4AAQ');
  assert(
    normDataJpg === 'data:image/jpeg;base64,/9j/4AAQ',
    'normalizeImageInput normalizes image/jpg data URI to image/jpeg',
  );

  const normPngBytes = await normalizeImageInput(VALID_PNG);
  assert(
    normPngBytes.startsWith('data:image/png;base64,'),
    'normalizeImageInput encodes Uint8Array PNG to data:image/png;base64',
  );

  const normArrayBuf = await normalizeImageInput(VALID_JPEG.buffer);
  assert(
    normArrayBuf.startsWith('data:image/jpeg;base64,'),
    'normalizeImageInput encodes ArrayBuffer JPEG to data:image/jpeg;base64',
  );

  const fakeBlob = {
    size: VALID_WEBP.byteLength,
    arrayBuffer: async () => VALID_WEBP.buffer,
  } as unknown as Blob;
  const normBlob = await normalizeImageInput(fakeBlob);
  assert(
    normBlob.startsWith('data:image/webp;base64,'),
    'normalizeImageInput encodes Blob WebP to data:image/webp;base64',
  );

  const normFetched = await normalizeImageInput(
    'https://example.com/photo.png',
    {
      fetch: (async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => VALID_PNG.buffer,
      })) as unknown as typeof fetch,
    },
  );
  assert(
    normFetched === normPngBytes,
    'normalizeImageInput fetches remote URL when custom fetch is supplied and validates magic bytes',
  );

  // Downscaling via mock document.createElement('canvas')
  const prevDoc = (globalThis as any).document;
  let drawnW = 0;
  let drawnH = 0;
  (globalThis as any).document = {
    createElement(tag: string) {
      if (tag !== 'canvas') return null;
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            drawImage(_src: unknown, _x: number, _y: number, w: number, h: number) {
              drawnW = w;
              drawnH = h;
            },
          };
        },
        toDataURL() {
          return 'data:image/jpeg;base64,/9j/4AAQ';
        },
      };
    },
  };
  try {
    const fakeVideo = {
      videoWidth: 2048,
      videoHeight: 1536,
    } as unknown as HTMLVideoElement;
    const scaledUrl = await normalizeImageInput(fakeVideo, {maxEdge: 1024});
    assert(
      scaledUrl === 'data:image/jpeg;base64,/9j/4AAQ' &&
        drawnW === 1024 &&
        drawnH === 768,
      'normalizeImageInput downscales 2048x1536 HTMLVideoElement to 1024x768',
    );
  } finally {
    (globalThis as any).document = prevDoc;
  }

  let rejectedCorrupt = false;
  try {
    await normalizeImageInput(new Uint8Array([1, 2, 3, 4]));
  } catch {
    rejectedCorrupt = true;
  }
  assert(
    rejectedCorrupt,
    'normalizeImageInput rejects buffer with invalid magic bytes',
  );

  let rejectedOversize = false;
  try {
    await normalizeImageInput({
      size: MAX_IMAGE_BYTES + 1,
      arrayBuffer: async () => VALID_PNG.buffer,
    } as unknown as Blob);
  } catch {
    rejectedOversize = true;
  }
  assert(rejectedOversize, 'normalizeImageInput rejects Blob > 32 MB');

  // 6. Phase 4b: compileFromImage end-to-end
  {
    const {el} = fakeElement();
    el.allowClientScripts = false;
    let rejectedNoScripts = false;
    try {
      await el.compileFromImage(VALID_PNG);
    } catch (e: unknown) {
      rejectedNoScripts = String((e as Error)?.message).includes(
        'allow-client-scripts',
      );
    }
    assert(
      rejectedNoScripts,
      'compileFromImage throws when allow-client-scripts is not set',
    );
  }

  // Happy path on blank element (no initial script) with spatial priors
  {
    const {el, events, executed} = fakeElement('');
    const {provider, requests} = scriptedProvider([
      `\`\`\`js\n${CLEAN_DESK_SCRIPT}\n\`\`\``,
    ]);
    const res = await el.compileFromImage(VALID_PNG, {
      provider,
      prompt: 'oak desk with lamp',
      priors: {
        floorY: 0,
        objects: [{label: 'desk', center: [0, 0.38, 0], size: [1.4, 0.75, 0.7]}],
      },
    });
    assert(
      res.applied && res.repairs === 0 && res.warnings.length === 0,
      'compileFromImage succeeds on blank element with 0 repairs',
    );
    assert(
      executed.length === 1 && el.sceneSource === CLEAN_DESK_SCRIPT,
      'compileFromImage hot-swaps live scene and updates el.sceneSource',
    );
    assert(
      events.some(
        (e) =>
          e.type === 'three-live-image-start' &&
          e.detail.prompt === 'oak desk with lamp' &&
          e.detail.hasPriors === true,
      ) &&
        events.some(
          (e) => e.type === 'three-live-image' && e.detail.applied === true,
        ),
      'compileFromImage dispatches three-live-image-start and three-live-image events',
    );
    assert(
      requests.length === 1 &&
        Array.isArray(requests[0][1].content) &&
        requests[0][1].content[1].text.includes('Metric spatial priors'),
      'compileFromImage sends multimodal request with formatted spatial priors',
    );
  }

  // Auto-repair on hard compile error (SyntaxError on turn 0 -> valid on turn 1)
  {
    const {el} = fakeElement('');
    const {provider, requests} = scriptedProvider([
      '```js\nconst broken = new THREE.Mesh(\n```',
      `\`\`\`js\n${CLEAN_DESK_SCRIPT}\n\`\`\``,
    ]);
    const res = await el.compileFromImage(VALID_PNG, {provider});
    assert(
      res.applied && res.repairs === 1 && res.code === CLEAN_DESK_SCRIPT,
      'compileFromImage auto-repairs syntax error on turn 1',
    );
    assert(
      requests.length === 2 &&
        String(requests[1][3].content).includes(
          'That script was rejected by the Three-Live sandbox:',
        ),
      'compileFromImage sends sandbox rejection error in repair turn',
    );
  }

  // Auto-repair on repairable warning (TL102 / TL204 on turn 0 -> clean on turn 1)
  {
    const {el} = fakeElement('');
    const {provider, requests} = scriptedProvider([
      `\`\`\`js\n// TRIGGER_TOAST_WARNING\n${UNNAMED_XR_SCRIPT}\n\`\`\``,
      `\`\`\`js\n${CLEAN_DESK_SCRIPT}\n\`\`\``,
    ]);
    const res = await el.compileFromImage(VALID_PNG, {provider});
    assert(
      res.applied &&
        res.repairs === 1 &&
        res.warnings.length === 0 &&
        res.code === CLEAN_DESK_SCRIPT,
      'compileFromImage auto-repairs linter/toast warnings and applies clean turn-1 script',
    );
    const repairPrompt = String(requests[1][3].content);
    assert(
      repairPrompt.includes(
        'The script compiled, but the Three-Live linter reported warnings',
      ) &&
        repairPrompt.includes('[TL102]') &&
        repairPrompt.includes('[TL204]'),
      'compileFromImage repair message lists both TL102 and TL204 warnings',
    );
  }

  // Fallback to turn-0 compiling candidate when warning-repair turn fails to compile
  {
    const {el} = fakeElement('');
    const {provider} = scriptedProvider([
      `\`\`\`js\n${UNNAMED_XR_SCRIPT}\n\`\`\``,
      '```js\nconst brokenRepair = new THREE.Mesh(\n```',
    ]);
    const res = await el.compileFromImage(VALID_PNG, {provider});
    assert(
      res.applied &&
        res.repairs === 1 &&
        res.code === UNNAMED_XR_SCRIPT &&
        res.warnings.some((w: string) => w.includes('TL204')),
      'compileFromImage falls back to turn-0 compiling candidate when warning-repair fails',
    );
  }

  // Chaining: initial scene -> compileFromImage -> selectByVoice -> editScene -> undoEdit
  {
    const initialRoof =
      "const r = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()); r.name = 'Roof'; scene.add(r);";
    const {el} = fakeElement(initialRoof);
    el.selectedMeshes = ['Roof'];
    const {provider: imgProvider} = scriptedProvider([
      `\`\`\`js\n${CLEAN_DESK_SCRIPT}\n\`\`\``,
    ]);
    const imgRes = await el.compileFromImage(VALID_PNG, {
      provider: imgProvider,
    });
    assert(
      imgRes.applied &&
        el.selectedMesh === null &&
        el.selectedMeshes.length === 0,
      'chaining step 1: compileFromImage applied and cleared stale selection from previous scene',
    );

    const selRes = await el.selectByVoice('the lamp');
    assert(
      selRes.applied &&
        Array.isArray(selRes.meshes) &&
        selRes.meshes.length === 1 &&
        selRes.meshes[0] === 'Lamp',
      'chaining step 2: selectByVoice resolves Lamp from image-compiled scene',
    );

    const editedDesk = CLEAN_DESK_SCRIPT.replace('0xcccccc', '0xd4af37');
    const {provider: editProvider, requests: editReqs} = scriptedProvider([
      `\`\`\`js\n${editedDesk}\n\`\`\``,
    ]);
    const editRes = await el.editScene('make it brass', {
      provider: editProvider,
    });
    assert(
      editRes.applied &&
        el.sceneSource === editedDesk &&
        String(editReqs[0][1].content).includes('selected the mesh named "Lamp"'),
      'chaining step 3: editScene edits selected Lamp on image-compiled scene',
    );

    const undidEdit = await el.undoEdit();
    assert(
      undidEdit && el.sceneSource === CLEAN_DESK_SCRIPT,
      'chaining step 4: first undoEdit reverts to compileFromImage scene',
    );

    const undidImage = await el.undoEdit();
    assert(
      undidImage && el.sceneSource === initialRoof,
      'chaining step 5: second undoEdit reverts to pre-compileFromImage Roof scene',
    );
  }

  // Superseding abort: second compileFromImage aborts first in-flight call
  {
    const {el} = fakeElement('');
    let firstAborted = false;
    let firstRejectErr: unknown = null;
    const slowProvider: ThreeLiveAIProvider = {
      complete({signal}) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              firstAborted = true;
              reject(signal.reason ?? new Error('aborted'));
            },
            {once: true},
          );
        });
      },
    };
    const p1 = compileFromImage(el, VALID_PNG, {provider: slowProvider}).catch(
      (err) => {
        firstRejectErr = err;
        return null;
      },
    );
    await new Promise((r) => setTimeout(r, 0));
    const {provider: fastProvider} = scriptedProvider([
      `\`\`\`js\n${CLEAN_DESK_SCRIPT}\n\`\`\``,
    ]);
    const res2 = await compileFromImage(el, VALID_PNG, {
      provider: fastProvider,
    });
    await p1;
    assert(
      firstAborted && firstRejectErr !== null && res2.applied,
      'newer compileFromImage call aborts in-flight earlier call',
    );
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
