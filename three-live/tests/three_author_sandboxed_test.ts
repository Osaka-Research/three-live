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

import {
  authorScriptRunner,
  BoxGeometry,
  BufferGeometry,
  buildSandboxWorkerSource,
  Float32BufferAttribute,
  getAllowClientScripts,
  getSandboxIframeSrc,
  isAllowedSandboxEngineUrl,
  Mesh,
  MeshStandardMaterial,
  noopProxy,
  PerspectiveCamera,
  Scene,
  SceneQuotaValidator,
  setAllowClientScripts,
  setSandboxEngineSrc,
  setSandboxIframeSrc,
  Texture,
  THREE,
  toTrustedWorkerScriptURL,
  validateSandboxWorkerMessage,
  WebGLRenderer,
} from '../src/three-author';

import {
  SECURITY_3D_MAX_HEAP_BYTES,
  SECURITY_3D_MAX_INDICES,
  SECURITY_3D_MAX_MESHES,
  SECURITY_3D_MAX_SCRIPT_BYTES,
  SECURITY_3D_MAX_TEXTURE_DIMENSION,
  SECURITY_3D_MAX_TEXTURES,
  SECURITY_3D_MAX_VERTICES,
  SECURITY_3D_SANDBOX_TIMEOUT_MS,
} from '../src/constants';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

async function runSandboxedAuthorTests() {
  console.log('🔒 Running Three-Author Sandboxing & Quota Unit Tests...\n');

  // 1. Quota Constants Synchronization
  assert(
    SECURITY_3D_MAX_VERTICES === 100000,
    'SECURITY_3D_MAX_VERTICES is 100,000',
  );
  assert(
    SECURITY_3D_MAX_INDICES === 300000,
    'SECURITY_3D_MAX_INDICES is 300,000',
  );
  assert(SECURITY_3D_MAX_MESHES === 1000, 'SECURITY_3D_MAX_MESHES is 1,000');
  assert(SECURITY_3D_MAX_TEXTURES === 16, 'SECURITY_3D_MAX_TEXTURES is 16');
  assert(
    SECURITY_3D_MAX_TEXTURE_DIMENSION === 2048,
    'SECURITY_3D_MAX_TEXTURE_DIMENSION is 2048',
  );
  assert(
    SECURITY_3D_SANDBOX_TIMEOUT_MS === 3000,
    'SECURITY_3D_SANDBOX_TIMEOUT_MS is 3000ms',
  );

  // 2. SceneQuotaValidator: Valid Scene Passes
  const validScene = new Scene();
  const validMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0x00ff00}),
  );
  validScene.add(validMesh);

  let validThrew = false;
  try {
    SceneQuotaValidator.validate(validScene);
  } catch (e) {
    validThrew = true;
  }
  assert(!validThrew, 'Valid scene under quotas passes SceneQuotaValidator');

  // 3. SceneQuotaValidator: Vertex Limit
  const vertexExcessScene = new Scene();
  const excessiveGeo = new BufferGeometry();
  // Create 100,001 vertices (each 3 floats)
  const excessivePositions = new Float32Array(
    (SECURITY_3D_MAX_VERTICES + 1) * 3,
  );
  excessiveGeo.setAttribute(
    'position',
    new Float32BufferAttribute(excessivePositions, 3),
  );
  vertexExcessScene.add(new Mesh(excessiveGeo, new MeshStandardMaterial()));

  let vertexThrew = false;
  let vertexErrMsg = '';
  try {
    SceneQuotaValidator.validate(vertexExcessScene);
  } catch (e: any) {
    vertexThrew = true;
    vertexErrMsg = e.message;
  }
  assert(
    vertexThrew && vertexErrMsg.includes('SECURITY_3D_MAX_VERTICES'),
    'Excessive vertex count (>100k) rejected',
  );

  // 4. SceneQuotaValidator: Index Limit
  const indexExcessScene = new Scene();
  const indexedGeo = new BufferGeometry();
  const smallPositions = new Float32Array(3 * 3);
  indexedGeo.setAttribute(
    'position',
    new Float32BufferAttribute(smallPositions, 3),
  );
  indexedGeo.setIndex(new Array(SECURITY_3D_MAX_INDICES + 1).fill(0));
  indexExcessScene.add(new Mesh(indexedGeo, new MeshStandardMaterial()));

  let indexThrew = false;
  let indexErrMsg = '';
  try {
    SceneQuotaValidator.validate(indexExcessScene);
  } catch (e: any) {
    indexThrew = true;
    indexErrMsg = e.message;
  }
  assert(
    indexThrew && indexErrMsg.includes('SECURITY_3D_MAX_INDICES'),
    'Excessive index count (>300k) rejected',
  );

  // 5. SceneQuotaValidator: Mesh Count Limit
  const meshExcessScene = new Scene();
  const dummyGeo = new BoxGeometry(1, 1, 1);
  const dummyMat = new MeshStandardMaterial();
  for (let i = 0; i <= SECURITY_3D_MAX_MESHES; i++) {
    meshExcessScene.add(new Mesh(dummyGeo, dummyMat));
  }

  let meshThrew = false;
  let meshErrMsg = '';
  try {
    SceneQuotaValidator.validate(meshExcessScene);
  } catch (e: any) {
    meshThrew = true;
    meshErrMsg = e.message;
  }
  assert(
    meshThrew && meshErrMsg.includes('SECURITY_3D_MAX_MESHES'),
    'Excessive mesh count (>1,000) rejected',
  );

  // 6. SceneQuotaValidator: Texture Count Limit
  const texExcessScene = new Scene();
  for (let i = 0; i <= SECURITY_3D_MAX_TEXTURES; i++) {
    const mat = new MeshStandardMaterial();
    mat.map = new Texture(`tex_${i}.png`);
    texExcessScene.add(new Mesh(dummyGeo, mat));
  }

  let texThrew = false;
  let texErrMsg = '';
  try {
    SceneQuotaValidator.validate(texExcessScene);
  } catch (e: any) {
    texThrew = true;
    texErrMsg = e.message;
  }
  assert(
    texThrew && texErrMsg.includes('SECURITY_3D_MAX_TEXTURES'),
    'Excessive texture count (>16) rejected',
  );

  // 7. SceneQuotaValidator: Texture Dimension Limit
  const dimExcessScene = new Scene();
  const largeMat = new MeshStandardMaterial();
  const oversizedTex = new Texture('huge.png');
  (oversizedTex as any).image = {width: 4096, height: 4096};
  largeMat.map = oversizedTex;
  dimExcessScene.add(new Mesh(dummyGeo, largeMat));

  let dimThrew = false;
  let dimErrMsg = '';
  try {
    SceneQuotaValidator.validate(dimExcessScene);
  } catch (e: any) {
    dimThrew = true;
    dimErrMsg = e.message;
  }
  assert(
    dimThrew && dimErrMsg.includes('SECURITY_3D_MAX_TEXTURE_DIMENSION'),
    'Oversized texture dimension (>2048) rejected',
  );

  // 8. Sandboxed WebGLRenderer Frame 1 (Zero-Copy GLB) & Frame 2+ (Transforms Map)
  const postedMessages: Array<{msg: any; transfer?: any[]}> = [];
  // Mock global Worker self.postMessage
  const originalSelf = (globalThis as any).self;
  (globalThis as any).self = {
    postMessage: (msg: any, transfer?: any[]) => {
      postedMessages.push({msg, transfer});
    },
  };

  try {
    const sandboxedScene = new Scene();
    const animatedMesh = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({color: 0xff0000}),
    );
    animatedMesh.name = 'HeroCube';
    animatedMesh.position.set(1, 2, 3);
    sandboxedScene.add(animatedMesh);

    const camera = new PerspectiveCamera(60, 1.5, 0.1, 100);
    const sandboxedRenderer = new WebGLRenderer({
      isSandboxed: true,
      containerId: 'ae_c3d_42',
    });

    assert(
      sandboxedRenderer.isSandboxed === true,
      'Renderer initialized in sandboxed mode',
    );

    // Frame 1 Render: should validate quota, serialize GLB, and post 3D_MODEL_READY with transferable ArrayBuffer
    sandboxedRenderer.render(sandboxedScene, camera);
    assert(postedMessages.length === 1, 'Frame 1 posted exactly 1 message');
    const frame1 = postedMessages[0];
    assert(
      frame1.msg.type === '3D_MODEL_READY',
      'Frame 1 message type is 3D_MODEL_READY',
    );
    assert(
      frame1.msg.containerId === 'ae_c3d_42',
      'Frame 1 message includes containerId',
    );
    assert(
      frame1.msg.glbBuffer instanceof ArrayBuffer,
      'Frame 1 message glbBuffer is an ArrayBuffer',
    );
    assert(
      frame1.transfer !== undefined &&
        frame1.transfer[0] === frame1.msg.glbBuffer,
      'Frame 1 transfers GLB ArrayBuffer zero-copy',
    );

    // Frame 2 Render: should stream matrix transforms only (no full GLB reserialization)
    animatedMesh.position.x = 99;
    sandboxedRenderer.render(sandboxedScene, camera);
    assert(postedMessages.length === 2, 'Frame 2 posted second message');
    const frame2 = postedMessages[1];
    assert(
      frame2.msg.type === '3D_UPDATE_TRANSFORMS',
      'Frame 2 message type is 3D_UPDATE_TRANSFORMS',
    );
    assert(
      frame2.msg.containerId === 'ae_c3d_42',
      'Frame 2 message includes containerId',
    );
    assert(
      typeof frame2.msg.transforms === 'object',
      'Frame 2 message transforms is a plain record',
    );
    assert(
      'HeroCube' in frame2.msg.transforms,
      "Frame 2 transforms map contains 'HeroCube'",
    );
    const matrix = frame2.msg.transforms['HeroCube'];
    assert(
      matrix[12] === 99,
      'Frame 2 transforms reflects updated X coordinate (99)',
    );

    // Frame 3 Render: should continue streaming transforms
    animatedMesh.rotation.y = 1.57;
    sandboxedRenderer.render(sandboxedScene, camera);
    assert(postedMessages.length === 3, 'Frame 3 posted third message');
    assert(
      postedMessages[2].msg.type === '3D_UPDATE_TRANSFORMS',
      'Frame 3 is 3D_UPDATE_TRANSFORMS',
    );
  } finally {
    (globalThis as any).self = originalSelf;
  }

  // 9. P0-1: Mandatory sandboxing — sandbox="none", sandbox="unsafe-host-realm",
  //    and any non-sandboxed mode are rejected outright with SecurityError.
  for (const forbiddenMode of ['none', 'unsafe-host-realm', 'false', 'host']) {
    const modeErrors: Error[] = [];
    let modeRejected = false;
    try {
      await authorScriptRunner.execute(
        'throw new Error("should never execute");',
        forbiddenMode,
        {
          onModelReady: () => {},
          onError: (e) => modeErrors.push(e),
        },
      );
    } catch (e: unknown) {
      modeRejected = true;
      const msg = e instanceof Error ? e.message : String(e);
      assert(
        msg.includes('SecurityError'),
        `sandbox="${forbiddenMode}" rejection throws SecurityError`,
      );
    }
    assert(
      modeRejected &&
        modeErrors.length === 1 &&
        modeErrors[0] instanceof Error &&
        modeErrors[0].message.includes('SecurityError'),
      `sandbox="${forbiddenMode}" is rejected and dispatches SecurityError to onError`,
    );
  }

  // 10. P0-4: BufferAttribute rejects an itemSize that would poison `count`.
  //     A NaN/Infinity/zero itemSize used to yield a non-finite `count`, and
  //     because `NaN > MAX` is false it silently disabled every quota.
  for (const badItemSize of [0, -1, 1.5, NaN, Infinity, 17]) {
    let threw = false;
    try {
      const badAttr = new Float32BufferAttribute(
        new Float32Array(12),
        badItemSize,
      );
      assert(badAttr.itemSize === badItemSize, 'unreachable');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      threw = msg.includes('itemSize');
    }
    assert(threw, `BufferAttribute rejects itemSize=${String(badItemSize)}`);
  }
  let goodItemSizeThrew = false;
  try {
    const goodAttr = new Float32BufferAttribute(new Float32Array(12), 3);
    assert(goodAttr.itemSize === 3, 'BufferAttribute sets itemSize=3');
  } catch {
    goodItemSizeThrew = true;
  }
  assert(!goodItemSizeThrew, 'BufferAttribute still accepts itemSize=3');

  // 11. P0-4: a non-finite count fails closed instead of disabling the quota.
  const poisonedScene = new Scene();
  const poisonedGeo = new BufferGeometry();
  const poisonedAttr = new Float32BufferAttribute(new Float32Array(9), 3);
  (poisonedAttr as unknown as Record<string, unknown>)['count'] = NaN;
  poisonedGeo.setAttribute('position', poisonedAttr);
  poisonedScene.add(new Mesh(poisonedGeo, new MeshStandardMaterial()));

  let poisonedThrew = false;
  let poisonedMsg = '';
  try {
    SceneQuotaValidator.validate(poisonedScene);
  } catch (e: unknown) {
    poisonedThrew = true;
    poisonedMsg = e instanceof Error ? e.message : String(e);
  }
  assert(
    poisonedThrew && poisonedMsg.includes('non-finite'),
    'Non-finite vertex count fails closed instead of bypassing the quota',
  );

  // 12. P0-4: quotas are enforced by the serializers, not just the renderer.
  //     The script runner calls scene.toCanvas3D() directly, so this is the
  //     only choke point that actually covers it.
  for (const method of ['toCanvas3D', 'toGLB', 'toUSDZ'] as const) {
    let serializerThrew = false;
    try {
      vertexExcessScene[method]();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      serializerThrew = msg.includes('SECURITY_3D_MAX_VERTICES');
    }
    assert(serializerThrew, `Scene.${method}() enforces the vertex quota`);
  }

  // 13. P0-4: MAX_SCRIPT_BYTES is enforced on the web path, matching Rust.
  let oversizedRejected = false;
  try {
    await authorScriptRunner.execute(
      'a'.repeat(SECURITY_3D_MAX_SCRIPT_BYTES + 1),
      'worker',
      {onModelReady: () => {}, onError: () => {}},
    );
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    oversizedRejected = msg.includes('SECURITY_3D_MAX_SCRIPT_BYTES');
  }
  assert(
    oversizedRejected,
    'Scripts over SECURITY_3D_MAX_SCRIPT_BYTES are rejected',
  );

  // 14. P0-5: the texture dimension check is reachable via Texture's own
  //     width/height, not only via an externally-attached `image` object.
  const explicitDimScene = new Scene();
  const explicitMat = new MeshStandardMaterial();
  const explicitTex = new Texture('huge.png');
  explicitTex.width = SECURITY_3D_MAX_TEXTURE_DIMENSION + 1;
  explicitTex.height = 16;
  explicitMat.map = explicitTex;
  explicitDimScene.add(new Mesh(dummyGeo, explicitMat));

  let explicitDimThrew = false;
  try {
    SceneQuotaValidator.validate(explicitDimScene);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    explicitDimThrew = msg.includes('SECURITY_3D_MAX_TEXTURE_DIMENSION');
  }
  assert(
    explicitDimThrew,
    'Texture.width above the ceiling is rejected (check is no longer dead)',
  );

  // 15. P0-1/P0-2: exercise the generated worker body against a stub worker
  //     global. The worker is built as a string, so this is the only thing
  //     standing between a typo and a silently broken sandbox.
  const WORKER_NONCE = 'test-nonce';

  interface PostedMessage {
    type?: string;
    nonce?: string;
    error?: string;
    transforms?: unknown;
  }

  interface StubWorkerSelf {
    THREE: unknown;
    importScripts: () => void;
    postMessage: (msg: PostedMessage) => void;
    onmessage: ((event: {data: unknown}) => void) | null;
    fetch?: () => void;
    XMLHttpRequest?: () => void;
    indexedDB?: Record<string, unknown>;
    navigator?: Record<string, unknown>;
    WebSocket?: () => void;
    [key: string]: unknown;
  }

  interface StubWorker {
    self: StubWorkerSelf;
    posted: PostedMessage[];
    run(script: string): void;
  }

  const g = globalThis as Record<string, unknown>;

  function bootWorker(): StubWorker {
    const posted: PostedMessage[] = [];
    const stubSelf: StubWorkerSelf = {
      // three-author installs THREE on globalThis at import time, which is
      // exactly what importScripts() achieves inside a real worker.
      THREE: g['THREE'],
      importScripts: () => {},
      postMessage: (msg: PostedMessage) => posted.push(msg),
      onmessage: null,
      // Ambient authority the sandbox is expected to strip.
      fetch: () => {},
      XMLHttpRequest: () => {},
      indexedDB: {},
      navigator: {sendBeacon: () => {}},
      WebSocket: () => {},
    };
    const previousSelf = g['self'];
    g['self'] = stubSelf;
    try {
      new Function(
        buildSandboxWorkerSource(
          'https://example.test/three-live.min.js',
          WORKER_NONCE,
        ),
      )();
    } finally {
      g['self'] = previousSelf;
    }
    return {
      self: stubSelf,
      posted,
      run(script: string) {
        const previous = g['self'];
        g['self'] = stubSelf;
        try {
          stubSelf.onmessage?.({
            data: {type: 'EXECUTE', script, nonce: WORKER_NONCE},
          });
        } finally {
          g['self'] = previous;
        }
      },
    };
  }

  const bootstrapped = bootWorker();
  assert(
    bootstrapped.posted.some((m) => m.type === 'READY'),
    'Worker announces READY once the engine is loaded',
  );

  // Ambient authority must be gone, and must stay gone.
  for (const revoked of [
    'fetch',
    'XMLHttpRequest',
    'WebSocket',
    'indexedDB',
    'navigator',
    'importScripts',
  ]) {
    assert(
      bootstrapped.self[revoked] === undefined,
      `Worker revokes self.${revoked}`,
    );
  }
  let restoreSucceeded = true;
  try {
    bootstrapped.self.fetch = () => 'restored';
    restoreSucceeded = bootstrapped.self.fetch !== undefined;
  } catch {
    restoreSucceeded = false;
  }
  assert(!restoreSucceeded, 'Revoked globals cannot be restored by the script');

  // A plain scene script produces a model followed by DONE.
  const simple = bootWorker();
  simple.run(
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));',
  );
  const simpleModel = simple.posted.find((m) => m.type === '3D_MODEL_READY');
  assert(
    simpleModel !== undefined && simpleModel.nonce === WORKER_NONCE,
    'Worker posts a nonce-stamped 3D_MODEL_READY for a plain script',
  );
  assert(
    simple.posted.some((m) => m.type === 'DONE'),
    'Worker signals DONE after the script completes',
  );
  assert(
    !simple.posted.some((m) => m.type === 'ERROR'),
    'Plain scene script produces no error',
  );

  // Scripts that declare their own `const scene = new THREE.Scene()` and
  // `return scene;` (like xr-live presets) must not collide with the outer
  // `scene` parameter.
  const customSceneWorker = bootWorker();
  customSceneWorker.run(
    'const scene = new THREE.Scene();' +
      'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));' +
      'return scene;',
  );
  assert(
    !customSceneWorker.posted.some((m) => m.type === 'ERROR') &&
      customSceneWorker.posted.some((m) => m.type === '3D_MODEL_READY'),
    'Worker supports scripts declaring `const scene = new THREE.Scene(); return scene;`',
  );

  // renderer.render() must still reach the host: it is the idiomatic call, and
  // the sandboxed renderer routes it through self.postMessage.
  const rendered = bootWorker();
  rendered.run(
    'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));' +
      'renderer.render(scene, camera);',
  );
  assert(
    !rendered.posted.some((m) => m.type === 'ERROR'),
    'renderer.render() inside the sandbox does not throw',
  );
  assert(
    rendered.posted.filter((m) => m.type === '3D_MODEL_READY').length === 1,
    'renderer.render() emits exactly one 3D_MODEL_READY (no duplicate fallback)',
  );

  // Arbitrary message shapes are refused.
  const forging = bootWorker();
  forging.run('self.postMessage({type: "EVIL", payload: 1});');
  assert(
    forging.posted.some((m) => m.type === 'ERROR'),
    'Posting a non-scene message type from the sandbox is rejected',
  );
  assert(
    !forging.posted.some((m) => m.type === 'EVIL'),
    'The forged message never reaches the host',
  );

  // Script errors are reported, not swallowed.
  const broken = bootWorker();
  broken.run('throw new Error("boom");');
  assert(
    broken.posted.some(
      (m) => m.type === 'ERROR' && String(m.message).includes('boom'),
    ),
    'Worker reports script exceptions as ERROR',
  );

  // A mismatched nonce is ignored entirely.
  const nonceGated = bootWorker();
  nonceGated.self.onmessage({
    data: {
      type: 'EXECUTE',
      script: 'scene.add(new THREE.Mesh());',
      nonce: 'wrong',
    },
  });
  assert(
    !nonceGated.posted.some((m) => m.type === '3D_MODEL_READY'),
    'Worker ignores EXECUTE messages carrying the wrong nonce',
  );

  // 16. P1-2 (WEB-10): THREE namespace is frozen & __THREE_LIVE_REGISTRY__ is non-writable.
  assert(Object.isFrozen(THREE), 'P1-2: THREE namespace proxy is frozen');
  let threeMutationThrew = false;
  try {
    (THREE as Record<string, unknown>)['BoxGeometry'] = 'tampered';
  } catch {
    threeMutationThrew = true;
  }
  assert(
    threeMutationThrew && THREE.BoxGeometry === BoxGeometry,
    'P1-2: Mutating THREE.BoxGeometry is rejected',
  );
  const regDesc = Object.getOwnPropertyDescriptor(
    globalThis,
    '__THREE_LIVE_REGISTRY__',
  );
  assert(
    regDesc !== undefined &&
      regDesc.writable === false &&
      regDesc.configurable === false,
    'P1-2: globalThis.__THREE_LIVE_REGISTRY__ is non-writable and non-configurable',
  );

  // 17. P1-6 (WEB-15): Worker-to-host message validation (validateSandboxWorkerMessage).
  assert(
    validateSandboxWorkerMessage(
      {type: 'READY', nonce: 'wrong'},
      WORKER_NONCE,
    ) === null,
    'P1-6: validateSandboxWorkerMessage rejects mismatched nonces',
  );
  assert(
    validateSandboxWorkerMessage(
      {
        type: '3D_MODEL_READY',
        nonce: WORKER_NONCE,
        glbBuffer: 'not-an-arraybuffer',
      },
      WORKER_NONCE,
    ) === null,
    'P1-6: validateSandboxWorkerMessage rejects non-ArrayBuffer glbBuffer',
  );
  assert(
    validateSandboxWorkerMessage(
      {
        type: '3D_MODEL_READY',
        nonce: WORKER_NONCE,
        glbBuffer: {byteLength: SECURITY_3D_MAX_HEAP_BYTES + 1},
      },
      WORKER_NONCE,
    ) === null,
    'P1-6: validateSandboxWorkerMessage rejects malformed/oversized glbBuffer',
  );
  assert(
    validateSandboxWorkerMessage(
      {
        type: '3D_MODEL_READY',
        nonce: WORKER_NONCE,
        glbBuffer: new ArrayBuffer(64),
      },
      WORKER_NONCE,
    )?.type === '3D_MODEL_READY',
    'P1-6: validateSandboxWorkerMessage accepts valid ArrayBuffer within budget',
  );
  assert(
    validateSandboxWorkerMessage(
      {
        type: '3D_UPDATE_TRANSFORMS',
        nonce: WORKER_NONCE,
        transforms: [[1, 2, 3]],
      },
      WORKER_NONCE,
    ) === null,
    'P1-6: validateSandboxWorkerMessage rejects transform matrices not of length 16',
  );
  const nanMat = new Array<number>(16).fill(0);
  nanMat[0] = NaN;
  assert(
    validateSandboxWorkerMessage(
      {
        type: '3D_UPDATE_TRANSFORMS',
        nonce: WORKER_NONCE,
        transforms: [nanMat],
      },
      WORKER_NONCE,
    ) === null,
    'P1-6: validateSandboxWorkerMessage rejects transform matrices containing NaN',
  );
  const validMat = new Array<number>(16).fill(0);
  validMat[0] = 1;
  validMat[5] = 1;
  validMat[10] = 1;
  validMat[15] = 1;
  assert(
    validateSandboxWorkerMessage(
      {
        type: '3D_UPDATE_TRANSFORMS',
        nonce: WORKER_NONCE,
        transforms: [validMat],
      },
      WORKER_NONCE,
    )?.type === '3D_UPDATE_TRANSFORMS',
    'P1-6: validateSandboxWorkerMessage accepts valid 16-element finite transform matrices',
  );
  const longErrorRes = validateSandboxWorkerMessage(
    {
      type: 'ERROR',
      nonce: WORKER_NONCE,
      message: 'x\x00'.repeat(2000),
    },
    WORKER_NONCE,
  );
  assert(
    longErrorRes !== null &&
      longErrorRes.type === 'ERROR' &&
      longErrorRes.message.length === 1024 &&
      !longErrorRes.message.includes('\x00'),
    'P1-6: validateSandboxWorkerMessage strips control chars and caps error messages at 1024 chars',
  );

  // 18a. Tier-1: Prototype-chain scrubbing across WorkerGlobalScope.prototype
  //      and DedicatedWorkerGlobalScope.prototype
  const protoPosted: PostedMessage[] = [];
  let importScriptsArg: unknown = null;
  const workerGlobalProto: Record<string, unknown> = {
    fetch: () => 'exfiltrated-via-proto',
    importScripts: (url: unknown) => {
      importScriptsArg = url;
    },
    WebTransport: () => {},
    FontFace: () => {},
    FontFaceSet: () => {},
    fonts: {load: () => {}},
    RTCPeerConnection: () => {},
    RTCDataChannel: () => {},
    indexedDB: {open: () => {}},
    caches: {open: () => {}},
    WorkerGlobalScope: () => {},
    DedicatedWorkerGlobalScope: () => {},
    performance: {
      now: () => 123.456789,
      getEntries: () => ['secret-resource-timing'],
    },
  };
  const dedicatedWorkerProto: Record<string, unknown> =
    Object.create(workerGlobalProto);
  dedicatedWorkerProto['postMessage'] = (msg: PostedMessage) =>
    protoPosted.push(msg);

  const protoSelf = Object.create(dedicatedWorkerProto) as StubWorkerSelf;
  protoSelf.THREE = g['THREE'];
  protoSelf.onmessage = null;
  protoSelf['trustedTypes'] = {
    createPolicy: (
      name: string,
      rules: {createScriptURL: (u: string) => string},
    ) => ({
      name,
      createScriptURL: (u: string) => ({
        __trustedScriptURL: rules.createScriptURL(u),
        toString() {
          return this.__trustedScriptURL;
        },
      }),
    }),
  };

  const prevSelfForProto = g['self'];
  g['self'] = protoSelf;
  try {
    new Function(
      buildSandboxWorkerSource(
        'https://example.test/three-live.min.js',
        WORKER_NONCE,
      ),
    )();
  } finally {
    g['self'] = prevSelfForProto;
  }

  assert(
    importScriptsArg !== null &&
      typeof importScriptsArg === 'object' &&
      String(importScriptsArg) === 'https://example.test/three-live.min.js',
    'Tier-1: Worker bootstrap wraps ENGINE_SRC in a TrustedScriptURL when trustedTypes is present',
  );
  assert(
    protoSelf['trustedTypes'] === undefined,
    'Tier-1: Worker revokes self.trustedTypes after engine bootstrap',
  );
  for (const api of [
    'fetch',
    'importScripts',
    'WebTransport',
    'FontFace',
    'FontFaceSet',
    'fonts',
    'RTCPeerConnection',
    'RTCDataChannel',
    'indexedDB',
    'caches',
    'WorkerGlobalScope',
    'DedicatedWorkerGlobalScope',
  ]) {
    assert(
      workerGlobalProto[api] === undefined && protoSelf[api] === undefined,
      `Tier-1: Worker scrubs ${api} from WorkerGlobalScope.prototype and self`,
    );
  }

  // 18b. Tier-1: Author script execution with coarsened performance and prototype checks
  const prevSelfRun = g['self'];
  g['self'] = protoSelf;
  try {
    protoSelf.onmessage?.({
      data: {
        type: 'EXECUTE',
        nonce: WORKER_NONCE,
        script:
          'var proto = Object.getPrototypeOf(self);' +
          'var rootProto = Object.getPrototypeOf(proto);' +
          'if (proto.fetch || rootProto.fetch || rootProto.importScripts) {' +
          '  throw new Error("Prototype leak detected");' +
          '}' +
          'var clock = new THREE.Clock();' +
          'clock.getDelta();' +
          'if (self.performance.getEntries) {' +
          '  throw new Error("performance.getEntries should be stripped");' +
          '}' +
          'scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));',
      },
    });
  } finally {
    g['self'] = prevSelfRun;
  }
  assert(
    !protoPosted.some((m) => m.type === 'ERROR') &&
      protoPosted.some((m) => m.type === '3D_MODEL_READY'),
    'Tier-1: Prototype chain has no fetch/importScripts leak and coarsened performance supports THREE.Clock',
  );

  // 18c. Tier-1: Prototype postMessage is guarded against forged message types
  let protoPostBypassMsg = '';
  try {
    (
      Object.getPrototypeOf(protoSelf) as {postMessage: (m: unknown) => void}
    ).postMessage.call(protoSelf, {type: 'EVIL_BYPASS'});
  } catch (e: unknown) {
    protoPostBypassMsg = e instanceof Error ? e.message : String(e);
  }
  assert(
    protoPostBypassMsg.includes(
      'Sandboxed scripts may only post Three-Live scene messages',
    ) && !protoPosted.some((m) => m.type === 'EVIL_BYPASS'),
    'Tier-1: Object.getPrototypeOf(self).postMessage is guarded against forged message types',
  );

  // 19. Tier-1: Sealed noopProxy blocks .constructor / prototype traversal
  assert(
    noopProxy.constructor === undefined &&
      noopProxy.__proto__ === undefined &&
      noopProxy.prototype === undefined &&
      Object.getPrototypeOf(noopProxy) === null,
    'Tier-1: noopProxy blocks .constructor, .__proto__, .prototype, and Object.getPrototypeOf',
  );
  assert(
    (THREE as Record<string, Record<string, unknown>>)['NonExistentClass'][
      'constructor'
    ] === undefined,
    'Tier-1: THREE.NonExistentClass.constructor does not leak Function',
  );

  // 20. Tier-1: Engine URL scheme & origin validation (isAllowedSandboxEngineUrl)
  assert(
    isAllowedSandboxEngineUrl('https://cdn.example.com/three-live.min.js') ===
      true,
    'Tier-1: isAllowedSandboxEngineUrl accepts https: URL',
  );
  assert(
    isAllowedSandboxEngineUrl('blob:https://example.com/1234-5678') === true,
    'Tier-1: isAllowedSandboxEngineUrl accepts blob: URL',
  );
  assert(
    isAllowedSandboxEngineUrl('javascript:alert(1)') === false,
    'Tier-1: isAllowedSandboxEngineUrl rejects javascript: URL',
  );
  assert(
    isAllowedSandboxEngineUrl('data:text/javascript,alert(1)') === false,
    'Tier-1: isAllowedSandboxEngineUrl rejects data: URL',
  );

  // 21. Tier-1: Host Trusted Types helper (toTrustedWorkerScriptURL)
  const prevTrustedTypes = g['trustedTypes'];
  let createdPolicyName = '';
  g['trustedTypes'] = {
    createPolicy: (
      name: string,
      rules: {createScriptURL: (u: string) => string},
    ) => {
      createdPolicyName = name;
      return {
        createScriptURL: (u: string) => ({
          __ttUrl: rules.createScriptURL(u),
          toString() {
            return this.__ttUrl;
          },
        }),
      };
    },
  };
  try {
    const wrapped = toTrustedWorkerScriptURL(
      'blob:https://example.com/worker-uuid',
    );
    assert(
      createdPolicyName === 'three-live#worker' &&
        typeof wrapped === 'object' &&
        String(wrapped) === 'blob:https://example.com/worker-uuid',
      'Tier-1: toTrustedWorkerScriptURL creates three-live#worker policy and returns TrustedScriptURL',
    );
    let evilUrlErrorMsg = '';
    try {
      toTrustedWorkerScriptURL('javascript:alert(1)');
    } catch (e: unknown) {
      evilUrlErrorMsg = e instanceof Error ? e.message : String(e);
    }
    assert(
      evilUrlErrorMsg.includes('SecurityError'),
      'Tier-1: toTrustedWorkerScriptURL rejects javascript: URLs with SecurityError',
    );
  } finally {
    g['trustedTypes'] = prevTrustedTypes;
    setSandboxEngineSrc(null);
    setSandboxIframeSrc(null);
  }

  // 22a. Tier-2 Option B: getSandboxIframeSrc auto-derivation and explicit override
  setSandboxEngineSrc('https://cdn.example.com/assets/three-live.min.js');
  const derivedIframeSrc = getSandboxIframeSrc();
  setSandboxIframeSrc('https://sandbox.example.com/three-live-sandbox.html');
  const overriddenIframeSrc = getSandboxIframeSrc();
  assert(
    derivedIframeSrc ===
      'https://cdn.example.com/assets/three-live-sandbox.html',
    'Tier-2: getSandboxIframeSrc derives three-live-sandbox.html alongside sandboxEngineSrc',
  );
  assert(
    overriddenIframeSrc ===
      'https://sandbox.example.com/three-live-sandbox.html',
    'Tier-2: setSandboxIframeSrc overrides auto-derived iframe URL',
  );

  // 22b. Tier-2 Option B: Opaque-origin <iframe sandbox="allow-scripts"> bridge execution
  const prevDocument = g['document'];
  const prevAddEventListener = g['addEventListener'];
  const prevRemoveEventListener = g['removeEventListener'];
  const windowListeners = new Set<
    (event: {source: unknown; data: unknown}) => void
  >();
  interface StubIframeElement {
    attrs: Map<string, string>;
    style: {display: string};
    tabIndex: number;
    src: string;
    removed: boolean;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    contentWindow: {
      posted: Array<Record<string, unknown>>;
      postMessage: (msg: Record<string, unknown>) => void;
    };
    setAttribute: (k: string, v: string) => void;
    getAttribute: (k: string) => string | null;
    remove: () => void;
  }
  let createdElementTag = '';
  let mountedIframe: StubIframeElement | null = null;

  g['addEventListener'] = (
    type: string,
    listener: (event: {source: unknown; data: unknown}) => void,
  ) => {
    if (type === 'message') windowListeners.add(listener);
  };
  g['removeEventListener'] = (
    type: string,
    listener: (event: {source: unknown; data: unknown}) => void,
  ) => {
    if (type === 'message') windowListeners.delete(listener);
  };
  g['document'] = {
    baseURI: 'https://host.example.com/app/',
    createElement: (tag: string): StubIframeElement => {
      createdElementTag = tag;
      const attrs = new Map<string, string>();
      const posted: Array<Record<string, unknown>> = [];
      const el: StubIframeElement = {
        attrs,
        style: {display: ''},
        tabIndex: 0,
        src: '',
        removed: false,
        onload: null,
        onerror: null,
        contentWindow: {
          posted,
          postMessage: (msg: Record<string, unknown>) => {
            posted.push(msg);
          },
        },
        setAttribute: (k: string, v: string) => {
          attrs.set(k, v);
        },
        getAttribute: (k: string) => attrs.get(k) ?? null,
        remove: () => {
          el.removed = true;
        },
      };
      return el;
    },
    body: {
      appendChild: (el: StubIframeElement) => {
        mountedIframe = el;
      },
    },
  };

  try {
    // Act 0: Verify Use Case 1 (authorScriptRunner.execute) fails closed by default when allowClientScripts is false
    assert(
      getAllowClientScripts() === false,
      'Tier-2: getAllowClientScripts() defaults to false',
    );
    let defaultOptInRejected = false;
    let defaultOptInMessage = '';
    try {
      await authorScriptRunner.execute(
        'scene.add(new THREE.Mesh());',
        'iframe',
        {onModelReady: () => {}},
      );
    } catch (error: unknown) {
      defaultOptInRejected = true;
      defaultOptInMessage =
        error instanceof Error ? error.message : String(error);
    }
    assert(
      defaultOptInRejected &&
        defaultOptInMessage.includes('SecurityError') &&
        defaultOptInMessage.includes('allowClientScripts'),
      'Tier-2: authorScriptRunner.execute (Use Case 1) fails closed by default until opted in',
    );

    // Enable Use Case 1 opt-in for iframe test
    setAllowClientScripts(true);
    assert(
      getAllowClientScripts() === true,
      'Tier-2: setAllowClientScripts(true) enables client script compilation',
    );

    let iframeModelReady: ArrayBuffer | null = null;
    const iframeErrors: Error[] = [];
    const expectedGlb = new ArrayBuffer(48);

    // Act 1: Start iframe sandbox execution and perform IFRAME_READY handshake
    await authorScriptRunner.execute('scene.add(new THREE.Mesh());', 'iframe', {
      onModelReady: (payload) => {
        if (payload instanceof ArrayBuffer) iframeModelReady = payload;
      },
      onError: (error) => iframeErrors.push(error),
    });
    for (const listener of Array.from(windowListeners)) {
      listener({
        source: mountedIframe!.contentWindow,
        data: {type: 'IFRAME_READY'},
      });
    }

    // Assert 1: Verify iframe element attributes, src, and SANDBOX_RUN payload
    assert(createdElementTag === 'iframe', 'Tier-2: creates an iframe element');
    assert(mountedIframe !== null, 'Tier-2: mounts hidden sandbox iframe');
    assert(
      mountedIframe!.src ===
        'https://sandbox.example.com/three-live-sandbox.html',
      'Tier-2: iframe src is set to configured sandbox iframe URL',
    );
    const sandboxAttr = mountedIframe!.getAttribute('sandbox') ?? '';
    assert(
      sandboxAttr === 'allow-scripts' &&
        !sandboxAttr.includes('allow-same-origin'),
      'Tier-2: iframe uses sandbox="allow-scripts" and omits allow-same-origin for opaque null origin',
    );
    assert(
      mountedIframe!.style.display === 'none' &&
        mountedIframe!.getAttribute('aria-hidden') === 'true' &&
        mountedIframe!.tabIndex === -1,
      'Tier-2: sandbox iframe is hidden and removed from accessibility tree',
    );
    assert(
      mountedIframe!.contentWindow.posted.length === 1 &&
        mountedIframe!.contentWindow.posted[0]['type'] === 'SANDBOX_RUN' &&
        mountedIframe!.contentWindow.posted[0]['script'] ===
          'scene.add(new THREE.Mesh());' &&
        typeof mountedIframe!.contentWindow.posted[0]['nonce'] === 'string' &&
        String(mountedIframe!.contentWindow.posted[0]['nonce']).length > 0,
      'Tier-2: host sends SANDBOX_RUN payload with script and nonce upon IFRAME_READY',
    );

    const runNonce = String(mountedIframe!.contentWindow.posted[0]['nonce']);

    // Act 2: Emit spoofed message from foreign source, then valid messages from iframe.contentWindow
    for (const listener of Array.from(windowListeners)) {
      listener({
        source: {},
        data: {
          type: '3D_MODEL_READY',
          nonce: runNonce,
          glbBuffer: new ArrayBuffer(32),
        },
      });
    }
    const modelAfterForeignSource = iframeModelReady;
    for (const listener of Array.from(windowListeners)) {
      listener({
        source: mountedIframe!.contentWindow,
        data: {
          type: '3D_MODEL_READY',
          nonce: runNonce,
          glbBuffer: expectedGlb,
        },
      });
      listener({
        source: mountedIframe!.contentWindow,
        data: {
          type: 'DONE',
          nonce: runNonce,
        },
      });
    }

    // Assert 2: Foreign source is ignored, valid source succeeds and cleans up
    assert(
      modelAfterForeignSource === null,
      'Tier-2: host ignores postMessage events not originating from iframe.contentWindow',
    );
    assert(
      iframeModelReady === expectedGlb && iframeErrors.length === 0,
      'Tier-2: iframe sandbox delivers validated 3D_MODEL_READY ArrayBuffer to host',
    );
    assert(
      mountedIframe!.removed === true && windowListeners.size === 0,
      'Tier-2: iframe and window message listener are cleaned up upon DONE',
    );

    // Act 3: Disable allowClientScripts (default) and verify Use Case 2 (executeUrl)
    // passes scriptUrl directly to the sandbox iframe and resolves relative URLs
    setAllowClientScripts(false);
    mountedIframe = null;
    let urlModelReady: ArrayBuffer | null = null;
    await authorScriptRunner.executeUrl!('/api/scenes/orbiter.js', 'iframe', {
      onModelReady: (payload) => {
        if (payload instanceof ArrayBuffer) urlModelReady = payload;
      },
      onError: (error) => iframeErrors.push(error),
    });
    for (const listener of Array.from(windowListeners)) {
      listener({
        source: mountedIframe!.contentWindow,
        data: {type: 'IFRAME_READY'},
      });
    }
    const urlPosted = mountedIframe!.contentWindow.posted[0];
    const urlNonce = String(urlPosted['nonce']);
    for (const listener of Array.from(windowListeners)) {
      listener({
        source: mountedIframe!.contentWindow,
        data: {
          type: '3D_MODEL_READY',
          nonce: urlNonce,
          glbBuffer: expectedGlb,
        },
      });
      listener({
        source: mountedIframe!.contentWindow,
        data: {type: 'DONE', nonce: urlNonce},
      });
    }

    // Assert 3: Use Case 2 resolves scriptUrl against baseURI and runs with allowClientScripts=false
    assert(
      urlPosted['type'] === 'SANDBOX_RUN' &&
        urlPosted['scriptUrl'] ===
          'https://host.example.com/api/scenes/orbiter.js' &&
        urlPosted['script'] === undefined &&
        urlModelReady === expectedGlb &&
        iframeErrors.length === 0,
      'Tier-2: executeUrl (Use Case 2) sends resolved scriptUrl to sandbox iframe without requiring allowClientScripts',
    );
  } finally {
    g['document'] = prevDocument;
    g['addEventListener'] = prevAddEventListener;
    g['removeEventListener'] = prevRemoveEventListener;
    setAllowClientScripts(false);
    setSandboxEngineSrc(null);
    setSandboxIframeSrc(null);
  }

  // 23. Use Case 2: Direct worker compilation of server-generated scriptUrl via nativeImportScripts (zero eval)
  const urlWorkerPosted: PostedMessage[] = [];
  const importedUrls: string[] = [];
  const serverSceneUrl = 'https://cdn.example.com/scenes/generated-torus.js';
  const urlWorkerProto: Record<string, unknown> = {
    importScripts: (u: unknown) => {
      const urlStr = String(u);
      importedUrls.push(urlStr);
      if (urlStr === serverSceneUrl) {
        // Simulate server-generated Three.js script executing against self.THREE and self.scene
        const workerGlobal = g['self'] as Record<string, unknown>;
        if (typeof workerGlobal['importScripts'] !== 'undefined') {
          throw new Error('self.importScripts should already be revoked');
        }
        const threeNs = workerGlobal['THREE'] as typeof THREE;
        const targetScene = workerGlobal['scene'] as Scene;
        targetScene.add(
          new threeNs.Mesh(
            new threeNs.BoxGeometry(1, 1, 1),
            new threeNs.MeshStandardMaterial(),
          ),
        );
      }
    },
    postMessage: (msg: PostedMessage) => urlWorkerPosted.push(msg),
  };
  const urlWorkerSelf = Object.create(urlWorkerProto) as StubWorkerSelf;
  urlWorkerSelf.THREE = g['THREE'];
  urlWorkerSelf.onmessage = null;

  const prevSelfForUrl = g['self'];
  g['self'] = urlWorkerSelf;
  try {
    new Function(
      buildSandboxWorkerSource(
        'https://cdn.example.com/three-live.min.js',
        WORKER_NONCE,
        {
          allowClientScripts: false,
          allowedScriptUrl: serverSceneUrl,
        },
      ),
    )();
    urlWorkerSelf.onmessage?.({
      data: {
        type: 'EXECUTE_URL',
        nonce: WORKER_NONCE,
        scriptUrl: serverSceneUrl,
      },
    });
  } finally {
    g['self'] = prevSelfForUrl;
  }

  assert(
    importedUrls.length === 2 &&
      importedUrls[0] === 'https://cdn.example.com/three-live.min.js' &&
      importedUrls[1] === serverSceneUrl &&
      !urlWorkerPosted.some((m) => m.type === 'ERROR') &&
      urlWorkerPosted.some((m) => m.type === '3D_MODEL_READY') &&
      urlWorkerPosted.some((m) => m.type === 'DONE'),
    'Use Case 2: Worker loads server scriptUrl directly via private nativeImportScripts after scrubbing self.importScripts',
  );

  console.log(
    `\n🏆 Three-Author Sandboxing Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runSandboxedAuthorTests();
