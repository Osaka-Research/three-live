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

import THREE from '../src/three-author';
import {generateUSDA, generateUSDZ} from '../src/three-convert';
import {parseGLB, ThreeView} from '../src/three-view';
import {
  activateAR,
  buildUSDZZip,
  createSceneViewerIntent,
  getARCapabilities,
  getAvailableARModes,
  getBestARMode,
  isQuickLookSupported,
  isSceneViewerSupported,
  isWebXRSupported,
  launchQuickLook,
  WebXRSessionManager,
} from '../src/three-xr';

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

async function runXRTests() {
  console.log('🥽 Running three-xr Spatial & AR Unit Tests...\n');

  // -------------------------------------------------------------------------
  // 1. Device & Capability Detection Tests
  // -------------------------------------------------------------------------
  assert(
    typeof isQuickLookSupported() === 'boolean',
    'isQuickLookSupported returns boolean',
  );
  assert(
    typeof isSceneViewerSupported() === 'boolean',
    'isSceneViewerSupported returns boolean',
  );

  const webxrSupported = await isWebXRSupported();
  assert(
    typeof webxrSupported === 'boolean',
    'isWebXRSupported returns boolean',
  );

  const modes = await getAvailableARModes();
  assert(Array.isArray(modes), 'getAvailableARModes returns array');

  const caps = await getARCapabilities();
  assert(
    caps !== null && typeof caps === 'object',
    'getARCapabilities returns capability object',
  );

  // -------------------------------------------------------------------------
  // 2. USDA Text Serialization Tests
  // -------------------------------------------------------------------------
  const scene = new THREE.Scene();
  const boxGeo = new THREE.BoxGeometry(2, 4, 6);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.25,
    metalness: 0.75,
  });
  const mesh = new THREE.Mesh(boxGeo, mat);
  mesh.name = 'HeroCube';
  scene.add(mesh);

  const glbBuffer = scene.toGLB();
  assert(glbBuffer.byteLength > 0, 'toGLB generates non-empty GLB buffer');

  const usda = generateUSDA(glbBuffer);
  assert(usda.startsWith('#usda 1.0'), 'USDA starts with #usda 1.0 header');
  assert(usda.includes('metersPerUnit = 1.0'), 'USDA includes metersPerUnit');
  assert(usda.includes('upAxis = "Y"'), 'USDA specifies Y-up axis');
  assert(
    usda.includes('def Xform "Root"'),
    'USDA includes Root Xform component',
  );
  assert(
    usda.includes('def Scope "Materials"'),
    'USDA includes Materials scope',
  );
  assert(
    usda.includes('uniform token info:id = "UsdPreviewSurface"'),
    'USDA uses UsdPreviewSurface shader',
  );
  assert(
    usda.includes('inputs:diffuseColor'),
    'USDA material includes diffuseColor',
  );
  assert(
    usda.includes('inputs:roughness = 0.25'),
    'USDA preserves roughness factor (0.25)',
  );
  assert(
    usda.includes('inputs:metallic = 0.75'),
    'USDA preserves metallic factor (0.75)',
  );
  assert(usda.includes('def Scope "Meshes"'), 'USDA includes Meshes scope');
  assert(
    usda.includes('float3[] extent = [(-1.0, -2.0, -3.0), (1.0, 2.0, 3.0)]'),
    'USDA extent matches BoxGeometry bounding box',
  );
  assert(usda.includes('point3f[] points'), 'USDA defines vertex points');
  assert(usda.includes('normal3f[] normals'), 'USDA defines vertex normals');
  assert(
    usda.includes(
      'int[] faceVertexCounts = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]',
    ),
    'USDA specifies 12 triangle face counts for box',
  );
  assert(
    usda.includes('rel material:binding'),
    'USDA links mesh to material binding',
  );

  // -------------------------------------------------------------------------
  // 3. USDZ Packaging & Apple 64-Byte Alignment Tests
  // -------------------------------------------------------------------------
  const usdzBytes = generateUSDZ(glbBuffer);
  assert(usdzBytes.length > 0, 'generateUSDZ generates binary bytes');

  // Verify ZIP Local Header Magic: 0x04034b50
  const zipMagic =
    (usdzBytes[0] |
      (usdzBytes[1] << 8) |
      (usdzBytes[2] << 16) |
      (usdzBytes[3] << 24)) >>>
    0;
  assert(
    zipMagic === 0x04034b50,
    'USDZ has valid ZIP local file header signature',
  );

  // Verify Apple USDZ 64-Byte Payload Alignment Requirement
  // In each local file header, the data payload must begin at a byte offset that is a multiple of 64
  const filenameLen = usdzBytes[26] | (usdzBytes[27] << 8);
  const extraLen = usdzBytes[28] | (usdzBytes[29] << 8);
  const dataOffset = 30 + filenameLen + extraLen;
  assert(
    dataOffset % 64 === 0,
    `USDZ payload offset (${dataOffset}) is strictly 64-byte aligned`,
  );

  // Verify file content in ZIP matches generated USDA
  const payloadBytes = usdzBytes.slice(
    dataOffset,
    dataOffset + new TextEncoder().encode(usda).length,
  );
  const extractedUSDA = new TextDecoder().decode(payloadBytes);
  assert(
    extractedUSDA === usda,
    'Uncompressed USDZ payload matches exact USDA text',
  );

  // Verify EOCD signature: 0x06054b50
  const eocdOffset = usdzBytes.length - 22;
  const eocdMagic =
    (usdzBytes[eocdOffset] |
      (usdzBytes[eocdOffset + 1] << 8) |
      (usdzBytes[eocdOffset + 2] << 16) |
      (usdzBytes[eocdOffset + 3] << 24)) >>>
    0;
  assert(
    eocdMagic === 0x06054b50,
    'USDZ contains valid End of Central Directory record',
  );

  // Test multi-entry ZIP packaging with 64-byte alignment
  const multiZip = buildUSDZZip([
    {filename: 'file1.txt', data: new Uint8Array([1, 2, 3, 4, 5])},
    {filename: 'file2.txt', data: new Uint8Array([6, 7, 8, 9, 10, 11, 12])},
  ]);
  assert(multiZip.length > 0, 'buildUSDZZip creates multi-entry archive');

  // Verify first entry payload alignment
  const fn1Len = multiZip[26] | (multiZip[27] << 8);
  const ex1Len = multiZip[28] | (multiZip[29] << 8);
  const data1Offset = 30 + fn1Len + ex1Len;
  assert(
    data1Offset % 64 === 0,
    `Multi-entry file1 data offset (${data1Offset}) is 64-byte aligned`,
  );

  // Verify second entry payload alignment
  const nextHeaderOffset = data1Offset + 5;
  const fn2Len =
    multiZip[nextHeaderOffset + 26] | (multiZip[nextHeaderOffset + 27] << 8);
  const ex2Len =
    multiZip[nextHeaderOffset + 28] | (multiZip[nextHeaderOffset + 29] << 8);
  const data2Offset = nextHeaderOffset + 30 + fn2Len + ex2Len;
  assert(
    data2Offset % 64 === 0,
    `Multi-entry file2 data offset (${data2Offset}) is 64-byte aligned`,
  );

  // -------------------------------------------------------------------------
  // 4. Android Scene Viewer Intent Tests
  // -------------------------------------------------------------------------
  const intentUrl = createSceneViewerIntent(
    'https://example.com/models/chair.glb',
    {
      title: 'Modern Chair',
      resizable: false,
      mode: 'ar_preferred',
    },
  );
  assert(
    intentUrl.startsWith('intent://arvr.google.com/scene-viewer/1.0?'),
    'Scene Viewer URL has correct scheme',
  );
  assert(
    intentUrl.includes('file=https%3A%2F%2Fexample.com%2Fmodels%2Fchair.glb'),
    'Scene Viewer encodes GLB URL',
  );
  assert(
    intentUrl.includes('title=Modern+Chair') ||
      intentUrl.includes('title=Modern%20Chair'),
    'Scene Viewer includes title',
  );
  assert(
    intentUrl.includes('resizable=false'),
    'Scene Viewer disables resizing',
  );
  assert(
    intentUrl.includes('package=com.google.ar.core'),
    'Scene Viewer targets ARCore package',
  );

  const wallIntentUrl = createSceneViewerIntent(
    'https://example.com/models/painting.glb',
    {
      resizable: false,
      enableVerticalPlacement: true,
    },
  );
  assert(
    wallIntentUrl.includes('enable_vertical_placement=true') &&
      wallIntentUrl.includes('resizable=false'),
    'Scene Viewer encodes enable_vertical_placement=true and resizable=false for ar-placement="wall" and ar-scale="fixed"',
  );

  // -------------------------------------------------------------------------
  // 5. WebXRSessionManager Lifecycle & Mock Tests
  // -------------------------------------------------------------------------
  let hitTriggered = false;
  let placedTriggered = false;

  const mockXRManager = new WebXRSessionManager({
    onHit: () => {
      hitTriggered = true;
    },
    onPlaced: () => {
      placedTriggered = true;
    },
  });
  assert(!mockXRManager.isSessionActive(), 'New session manager is not active');
  assert(
    !mockXRManager.hasPlacedModel(),
    'New session manager has no placed model',
  );

  // -------------------------------------------------------------------------
  // 6. Universal activateAR Error & Fallback Handling Tests
  // -------------------------------------------------------------------------
  const fallbackRes = await activateAR({
    model: glbBuffer,
    preferredModes: ['scene-viewer'],
    // Omit glbUrl to trigger error handling
  });
  assert(
    !fallbackRes.success,
    'activateAR without glbUrl fails gracefully for Scene Viewer',
  );
  assert(
    fallbackRes.error !== undefined,
    'activateAR returns structured Error object',
  );

  // -------------------------------------------------------------------------
  // 7. Quick Look URL Scheme Allowlist
  // -------------------------------------------------------------------------
  // launchQuickLook assigns its argument to an <a href> and clicks it
  // programmatically, so an unchecked scheme is a click-triggered XSS.
  const clickedHrefs: string[] = [];
  const makeStubAnchor = () => ({
    _attrs: new Map<string, string>(),
    style: {} as Record<string, string>,
    setAttribute(name: string, value: string) {
      this._attrs.set(name, value);
    },
    appendChild() {},
    click() {
      clickedHrefs.push(this._attrs.get('href') ?? '');
    },
  });
  const g = globalThis as Record<string, unknown>;
  const originalDocument = g['document'];
  const originalSetTimeout = globalThis.setTimeout;
  g['document'] = {
    createElement: () => makeStubAnchor(),
    body: {appendChild() {}, removeChild() {}},
  };
  // launchQuickLook defers anchor cleanup by 3s. Swallow it so it cannot fire
  // after the stub DOM is torn down (and so the suite does not idle waiting).
  g['setTimeout'] = () => 0;

  try {
    for (const hostile of [
      'javascript:alert(document.cookie)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      let rejected = false;
      try {
        launchQuickLook(hostile);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        rejected = msg.includes('XR-Live Security');
      }
      assert(rejected, `launchQuickLook rejects ${hostile.slice(0, 24)}`);
    }
    assert(
      clickedHrefs.length === 0,
      'No hostile Quick Look URL ever reached anchor.click()',
    );

    let safeThrew = false;
    try {
      launchQuickLook('https://example.com/model.usdz');
      launchQuickLook('/models/relative.usdz');
    } catch {
      safeThrew = true;
    }
    assert(!safeThrew, 'launchQuickLook still accepts https and relative URLs');
    assert(
      clickedHrefs.length === 2,
      'Both safe Quick Look URLs reached anchor.click()',
    );
  } finally {
    g['document'] = originalDocument;
    g['setTimeout'] = originalSetTimeout;
  }

  // -------------------------------------------------------------------------
  // 8. Android WebXR Regression Tests: getGLContext, XRWebGLLayer, Viewport,
  //    Progressive requestSession Fallback & Wedged-Session Cleanup
  // -------------------------------------------------------------------------
  assert(
    typeof ThreeView.prototype.getGLContext === 'function',
    'ThreeView exposes getGLContext() for WebXR XRWebGLLayer binding',
  );

  const origNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setMockNavigator = (val: unknown) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: val,
      configurable: true,
      writable: true,
    });
  };
  const origXRWebGLLayer = g['XRWebGLLayer'];
  try {
    let makeXRCompatibleCalled = false;
    let baseLayerAssigned: any = null;
    let requestAttempts = 0;
    let capturedXRCallback: ((time: number, frame: any) => void) | null = null;
    let selectListener: (() => void) | null = null;
    let renderedViewport: [number, number, number, number] | undefined;
    let renderedMatrix: Float32Array | null = null;
    let xrSessionEnded = false;
    let hitTriggered = false;
    let placedTriggered = false;

    const fakeFramebuffer = {id: 'xr-fbo'};
    g['XRWebGLLayer'] = class FakeXRWebGLLayer {
      session: any;
      gl: any;
      options: any;
      framebuffer = fakeFramebuffer;
      constructor(session: any, gl: any, options: any) {
        this.session = session;
        this.gl = gl;
        this.options = options;
      }
      getViewport() {
        return {x: 0, y: 0, width: 1080, height: 2400};
      }
    };

    const fakeSession: any = {
      renderState: {} as any,
      addEventListener(type: string, cb: () => void) {
        if (type === 'select') selectListener = cb;
      },
      updateRenderState(state: any) {
        baseLayerAssigned = state.baseLayer;
        this.renderState.baseLayer = state.baseLayer;
      },
      async requestReferenceSpace() {
        return {kind: 'local'};
      },
      async requestHitTestSource() {
        return {cancel() {}};
      },
      requestAnimationFrame(cb: (time: number, frame: any) => void) {
        capturedXRCallback = cb;
      },
      async end() {
        xrSessionEnded = true;
      },
    };

    setMockNavigator({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/134.0',
      xr: {
        async isSessionSupported(mode: string) {
          return mode === 'immersive-ar';
        },
        async requestSession(_mode: string, init?: any) {
          requestAttempts++;
          // Simulate an Android browser rejecting advanced sessionInit on attempt 1
          if (
            requestAttempts === 1 &&
            init?.optionalFeatures?.includes('light-estimation')
          ) {
            throw new Error('Unsupported optional feature dictionary');
          }
          return fakeSession;
        },
      },
    });

    const fakeGl: any = {
      FRAMEBUFFER: 0x8d40,
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      STATIC_DRAW: 0x88e4,
      FLOAT: 0x1406,
      UNSIGNED_SHORT: 0x1403,
      async makeXRCompatible() {
        makeXRCompatibleCalled = true;
      },
      bindFramebuffer() {},
      createVertexArray: () => ({}),
      bindVertexArray() {},
      createBuffer: () => ({}),
      bindBuffer() {},
      bufferData() {},
      enableVertexAttribArray() {},
      vertexAttribPointer() {},
      deleteVertexArray() {},
      deleteBuffer() {},
    };

    const fakeView: any = {
      gl: fakeGl,
      bounds: {
        center: [0, 0, 0],
        radius: 2.0,
        min: [-2, -1, -2],
        max: [2, 1, 2],
      },
      meshes: [],
      modelRootMatrix: new Float32Array(16),
      xrActive: false,
      getGLContext() {
        return this.gl;
      },
      setXRSessionActive(active: boolean) {
        this.xrActive = active;
      },
      stepXRUpdate() {},
      renderXRView(
        _xrView: any,
        placementMatrix: Float32Array | null,
        _isPlaced: boolean,
        viewport?: [number, number, number, number],
      ) {
        renderedMatrix = placementMatrix
          ? new Float32Array(placementMatrix)
          : null;
        renderedViewport = viewport;
      },
    };

    const mgr = new WebXRSessionManager({
      onHit: () => {
        hitTriggered = true;
      },
      onPlaced: () => {
        placedTriggered = true;
      },
    });
    await mgr.start(fakeView);

    assert(
      requestAttempts === 2,
      'WebXRSessionManager retries with minimal features if first requestSession rejects',
    );
    assert(
      makeXRCompatibleCalled && baseLayerAssigned !== null,
      'WebXRSessionManager calls gl.makeXRCompatible() and attaches XRWebGLLayer baseLayer',
    );
    assert(
      fakeView.xrActive === true,
      'WebXRSessionManager pauses inline render loop while immersive XR session is active',
    );

    const hitMat = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.25, -0.4, -1.3, 1,
    ]);
    capturedXRCallback!(16, {
      getViewerPose: () => ({
        views: [
          {
            eye: 'none',
            projectionMatrix: new Float32Array(16),
            transform: {
              position: {x: 0, y: 1.5, z: 0},
              matrix: new Float32Array([
                1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.5, 0, 1,
              ]),
              inverse: {matrix: new Float32Array(16)},
            },
          },
        ],
      }),
      getHitTestResults: () => [
        {
          getPose: () => ({transform: {matrix: hitMat}}),
        },
      ],
    });

    assert(
      hitTriggered &&
        renderedViewport !== undefined &&
        renderedViewport[2] === 1080 &&
        renderedViewport[3] === 2400 &&
        renderedMatrix !== null &&
        Math.hypot(renderedMatrix[0], renderedMatrix[2]) < 0.2,
      'WebXRSessionManager passes full camera XRWebGLLayer viewport and auto-scales oversized scenes (~0.30m tabletop radius)',
    );

    selectListener!();
    assert(
      placedTriggered && mgr.hasPlacedModel(),
      'WebXRSessionManager locks placement matrix on select tap',
    );

    await mgr.stop();
    assert(
      xrSessionEnded && !mgr.isSessionActive() && fakeView.xrActive === false,
      'WebXRSessionManager.stop() ends session, cleans up reticle, and resumes inline viewer',
    );

    // Verify setup failure calls session.end() so Chrome never stays wedged
    let brokenEnded = false;
    setMockNavigator({
      xr: {
        async isSessionSupported() {
          return true;
        },
        async requestSession() {
          return {
            addEventListener() {},
            async requestReferenceSpace() {
              throw new Error('ReferenceSpace unavailable');
            },
            async end() {
              brokenEnded = true;
            },
          };
        },
      },
    });
    let setupFailedAsExpected = false;
    const brokenMgr = new WebXRSessionManager();
    try {
      await brokenMgr.start(fakeView);
    } catch {
      setupFailedAsExpected = true;
    }
    assert(
      setupFailedAsExpected && brokenEnded && !brokenMgr.isSessionActive(),
      'WebXRSessionManager calls session.end() on post-requestSession failure so subsequent AR taps never wedge',
    );
  } finally {
    if (origNavDesc) {
      Object.defineProperty(globalThis, 'navigator', origNavDesc);
    } else {
      delete g['navigator'];
    }
    g['XRWebGLLayer'] = origXRWebGLLayer;
  }

  console.log(
    `\n🏆 three-xr Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runXRTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
