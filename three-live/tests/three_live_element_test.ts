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

import {environmentMapPlugin} from '../src/plugins/envmap';
import {hotspotPlugin} from '../src/plugins/hotspots';
import {authorScriptRunner} from '../src/three-author';
import {ThreeLiveElement} from '../src/three-live-element';
import {ThreeView} from '../src/three-view';

ThreeView.registerPlugin(hotspotPlugin);
ThreeView.registerPlugin(environmentMapPlugin);

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

async function runElementTests() {
  console.log('🧩 Running <three-live> Web Component Unit Tests...\n');

  // 1. Export & Custom Element Definition
  assert(
    typeof ThreeLiveElement === 'function',
    'ThreeLiveElement class is exported',
  );
  assert(
    Array.isArray(ThreeLiveElement.observedAttributes),
    'ThreeLiveElement has observedAttributes array',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('src'),
    'observedAttributes contains src',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('ios-src'),
    'observedAttributes contains ios-src',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('script-src'),
    'observedAttributes contains script-src',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('sandbox'),
    'observedAttributes contains sandbox',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('allow-client-scripts'),
    'observedAttributes contains allow-client-scripts',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('poster'),
    'observedAttributes contains poster',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('camera-orbit'),
    'observedAttributes contains camera-orbit',
  );
  assert(
    !ThreeLiveElement.observedAttributes.includes('camera'),
    'observedAttributes does not contain legacy camera',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('camera-target'),
    'observedAttributes contains camera-target',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('min-camera-orbit'),
    'observedAttributes contains min-camera-orbit',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('max-camera-orbit'),
    'observedAttributes contains max-camera-orbit',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('field-of-view'),
    'observedAttributes contains field-of-view',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('selected-mesh'),
    'observedAttributes contains selected-mesh',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('ar'),
    'observedAttributes contains ar',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('exposure'),
    'observedAttributes contains exposure',
  );
  assert(
    !ThreeLiveElement.observedAttributes.includes('environment-intensity'),
    'observedAttributes does not contain legacy environment-intensity',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('auto-rotate'),
    'observedAttributes contains auto-rotate',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('auto-rotate-delay'),
    'observedAttributes contains auto-rotate-delay',
  );
  assert(
    ThreeLiveElement.observedAttributes.includes('rotation-per-second'),
    'observedAttributes contains rotation-per-second',
  );
  assert(
    typeof ThreeLiveElement.registerDecoder === 'function',
    'ThreeLiveElement has static registerDecoder method',
  );
  assert(
    typeof ThreeLiveElement.getDecoder === 'function',
    'ThreeLiveElement has static getDecoder method',
  );

  // 2. Mock DOM Environment for Component Instance Testing
  const attributes = new Map<string, string>();
  const listeners = new Map<string, Function[]>();

  // Mock minimal subclass for Node testing
  class TestThreeLiveElement extends ThreeLiveElement {
    public override style: any = {};
    public children: any[] = [];

    override getAttribute(name: string): string | null {
      return attributes.get(name) ?? null;
    }
    override setAttribute(name: string, value: string): void {
      const old = this.getAttribute(name);
      attributes.set(name, value);
      this.attributeChangedCallback(name, old, value);
    }
    override removeAttribute(name: string): void {
      const old = this.getAttribute(name);
      attributes.delete(name);
      this.attributeChangedCallback(name, old, null);
    }
    override hasAttribute(name: string): boolean {
      return attributes.has(name);
    }
    override addEventListener(event: string, fn: any): void {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(fn);
    }
    override dispatchEvent(event: any): boolean {
      const fns = listeners.get(event.type) || [];
      for (const fn of fns) fn(event);
      return true;
    }
    public mockHotspots: any[] = [];

    override querySelector(): any {
      return null;
    }
    override querySelectorAll(selector: string): any {
      if (selector.includes('hotspot')) {
        return this.mockHotspots;
      }
      return [];
    }
    override appendChild(child: any): any {
      this.children.push(child);
      return child;
    }
  }

  const instance = new TestThreeLiveElement();
  instance.style = {};
  instance.children = [];

  // Test getters/setters
  instance.src = '/models/sneaker.glb';
  assert(
    attributes.get('src') === '/models/sneaker.glb',
    'src setter updates attribute',
  );
  assert(instance.src === '/models/sneaker.glb', 'src getter reads attribute');
  assert(
    (instance as any).sceneSrc === undefined,
    'legacy sceneSrc property is not exposed',
  );

  instance.cameraOrbit = '0deg 75deg 3m';
  assert(
    attributes.get('camera-orbit') === '0deg 75deg 3m',
    'cameraOrbit setter updates attribute',
  );
  assert(
    instance.cameraOrbit === '0deg 75deg 3m',
    'cameraOrbit getter reads attribute',
  );

  instance.iosSrc = '/models/sneaker.usdz';
  assert(
    attributes.get('ios-src') === '/models/sneaker.usdz',
    'iosSrc setter updates attribute',
  );
  assert(
    instance.iosSrc === '/models/sneaker.usdz',
    'iosSrc getter reads attribute',
  );

  instance.poster = '/images/poster.webp';
  assert(
    attributes.get('poster') === '/images/poster.webp',
    'poster setter updates attribute',
  );
  assert(
    instance.poster === '/images/poster.webp',
    'poster getter reads attribute',
  );

  instance.selectedMesh = 'sole_accent';
  assert(
    attributes.get('selected-mesh') === 'sole_accent',
    'selectedMesh setter updates attribute',
  );
  assert(
    instance.selectedMesh === 'sole_accent',
    'selectedMesh getter reads attribute',
  );

  instance.exposure = 1.75;
  assert(
    attributes.get('exposure') === '1.75',
    'exposure setter updates attribute',
  );
  assert(instance.exposure === 1.75, 'exposure getter reads attribute');
  assert(
    (instance as any).environmentIntensity === undefined,
    'legacy environmentIntensity property is not exposed',
  );

  instance.autoRotate = true;
  assert(attributes.has('auto-rotate'), 'autoRotate setter adds attribute');
  assert(instance.autoRotate === true, 'autoRotate getter returns true');
  assert(
    instance.autoRotateDelay === 3000,
    'autoRotateDelay defaults to 3000ms',
  );
  instance.autoRotateDelay = 1500;
  assert(
    attributes.get('auto-rotate-delay') === '1500' &&
      instance.autoRotateDelay === 1500,
    'autoRotateDelay setter and getter sync with auto-rotate-delay attribute',
  );
  assert(
    instance.rotationPerSecond === '30deg',
    'rotationPerSecond defaults to "30deg"',
  );
  instance.rotationPerSecond = '60deg';
  assert(
    attributes.get('rotation-per-second') === '60deg' &&
      instance.rotationPerSecond === '60deg',
    'rotationPerSecond setter and getter sync with rotation-per-second attribute',
  );

  instance.ar = true;
  assert(attributes.has('ar'), 'ar setter adds attribute');
  assert(instance.ar === true, 'ar getter returns true');

  instance.scriptSrc = '/scripts/procedural.js';
  assert(
    attributes.get('script-src') === '/scripts/procedural.js',
    'scriptSrc setter updates attribute',
  );
  assert(
    instance.scriptSrc === '/scripts/procedural.js',
    'scriptSrc getter reads attribute',
  );

  instance.sandbox = 'iframe';
  assert(
    attributes.get('sandbox') === 'iframe',
    'sandbox setter updates attribute to iframe',
  );
  assert(instance.sandbox === 'iframe', 'sandbox getter reads iframe');

  instance.sandbox = 'worker';
  assert(
    attributes.get('sandbox') === 'worker',
    'sandbox setter updates to worker',
  );
  assert(instance.sandbox === 'worker', 'sandbox getter reads worker');

  instance.removeAttribute('sandbox');
  ThreeLiveElement.sandboxIframeSrc =
    'https://cdn.example.com/three-live-sandbox.html';
  assert(
    ThreeLiveElement.sandboxIframeSrc ===
      'https://cdn.example.com/three-live-sandbox.html',
    'ThreeLiveElement.sandboxIframeSrc getter returns configured URL',
  );
  assert(
    instance.sandbox === 'iframe',
    'sandbox getter defaults to iframe when ThreeLiveElement.sandboxIframeSrc is set',
  );
  ThreeLiveElement.sandboxIframeSrc = null;
  assert(
    instance.sandbox === 'worker',
    'sandbox getter defaults back to worker when ThreeLiveElement.sandboxIframeSrc is null',
  );

  instance.shadowIntensity = 0.85;
  assert(
    attributes.get('shadow-intensity') === '0.85',
    'shadowIntensity setter updates attribute',
  );
  assert(
    instance.shadowIntensity === 0.85,
    'shadowIntensity getter reads attribute',
  );

  instance.shadowSoftness = 0.4;
  assert(
    attributes.get('shadow-softness') === '0.4',
    'shadowSoftness setter updates attribute',
  );
  assert(
    instance.shadowSoftness === 0.4,
    'shadowSoftness getter reads attribute',
  );

  instance.toneMapping = 'neutral';
  assert(
    attributes.get('tone-mapping') === 'neutral',
    'toneMapping setter updates attribute',
  );
  assert(
    instance.toneMapping === 'neutral',
    'toneMapping getter reads attribute',
  );

  instance.environmentImage = '/hdr/studio.jpg';
  assert(
    attributes.get('environment-image') === '/hdr/studio.jpg',
    'environmentImage setter updates attribute',
  );
  assert(
    instance.environmentImage === '/hdr/studio.jpg',
    'environmentImage getter reads attribute',
  );

  instance.autoplay = true;
  assert(attributes.has('autoplay'), 'autoplay setter adds attribute');
  assert(instance.autoplay === true, 'autoplay getter returns true');

  instance.animationName = 'Run';
  assert(
    attributes.get('animation-name') === 'Run',
    'animationName setter updates attribute',
  );
  assert(
    instance.animationName === 'Run',
    'animationName getter reads attribute',
  );
  assert(
    Array.isArray(instance.availableAnimations),
    'availableAnimations returns array',
  );

  instance.cameraTarget = '1m 2m 3m';
  assert(
    attributes.get('camera-target') === '1m 2m 3m',
    'cameraTarget setter updates attribute',
  );
  assert(
    instance.cameraTarget === '1m 2m 3m',
    'cameraTarget getter reads attribute',
  );

  instance.minCameraOrbit = 'auto 45deg auto';
  assert(
    attributes.get('min-camera-orbit') === 'auto 45deg auto',
    'minCameraOrbit setter updates attribute',
  );
  assert(
    instance.minCameraOrbit === 'auto 45deg auto',
    'minCameraOrbit getter reads attribute',
  );

  instance.maxCameraOrbit = 'auto 90deg 10m';
  assert(
    attributes.get('max-camera-orbit') === 'auto 90deg 10m',
    'maxCameraOrbit setter updates attribute',
  );
  assert(
    instance.maxCameraOrbit === 'auto 90deg 10m',
    'maxCameraOrbit getter reads attribute',
  );

  instance.fieldOfView = '60deg';
  assert(
    attributes.get('field-of-view') === '60deg',
    'fieldOfView setter updates attribute',
  );
  assert(
    instance.fieldOfView === '60deg',
    'fieldOfView getter reads attribute',
  );

  // Test pluggable decoders registration API
  let customDecoderCalled = false;
  ThreeLiveElement.registerDecoder('custom', {
    decodePrimitive: () => {
      customDecoderCalled = true;
    },
  });
  assert(
    ThreeLiveElement.getDecoder('custom') !== undefined,
    'ThreeLiveElement.getDecoder returns registered custom decoder',
  );

  // Test 3D Hotspot updates and occlusion
  const mockHotspot = {
    attributes: new Map<string, string>([
      ['slot', 'hotspot-1'],
      ['data-position', '0.5 1.0 -0.2'],
      ['data-normal', '0 1 0'],
    ]),
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    },
    setAttribute(name: string, val: string) {
      this.attributes.set(name, val);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    },
    style: {} as any,
  };
  instance.mockHotspots = [mockHotspot];

  instance.viewer = {
    projectPointToScreen: () => ({x: 120, y: 340, z: 0.2, visible: true}),
  } as any;
  instance.updateHotspots();

  assert(
    mockHotspot.style.transform.includes('120px, 340px'),
    'updateHotspots transforms element to projected screen coordinates',
  );
  assert(
    mockHotspot.style.opacity === '1',
    'Visible hotspot has opacity 1 and normal pointer events',
  );
  assert(
    !mockHotspot.attributes.has('data-occluded'),
    'Visible hotspot does not have data-occluded attribute',
  );

  // Test occlusion culling
  instance.viewer = {
    projectPointToScreen: () => ({x: 120, y: 340, z: 0.2, visible: false}),
  } as any;
  instance.updateHotspots();

  assert(mockHotspot.style.opacity === '0', 'Occluded hotspot has opacity 0');
  assert(
    mockHotspot.attributes.has('data-occluded'),
    'Occluded hotspot has data-occluded attribute set',
  );

  // Test fail-closed security when no script runner is registered
  let unregisteredThrew = false;
  try {
    await instance.executeScript('const m = new THREE.Mesh();');
  } catch (err: any) {
    unregisteredThrew = true;
    assert(
      Boolean(err?.message?.includes('registerScriptRunner')),
      'Unregistered script runner error mentions registerScriptRunner',
    );
  }
  assert(
    unregisteredThrew,
    'executeScript fails closed when ScriptRunner is not registered',
  );

  // Register authorScriptRunner and test Use Case 1 opt-in vs Use Case 2 default
  ThreeLiveElement.registerScriptRunner(authorScriptRunner);
  assert(
    instance.allowClientScripts === false &&
      ThreeLiveElement.allowClientScripts === false,
    'allowClientScripts is disabled by default (Use Case 1 requires opt-in)',
  );

  let clientScriptOptInMessage = '';
  let errorEventFired = false;
  instance.addEventListener('error', () => {
    errorEventFired = true;
  });

  try {
    await instance.executeScript('const m = new THREE.Mesh();');
  } catch (error: unknown) {
    clientScriptOptInMessage =
      error instanceof Error ? error.message : String(error);
  }
  assert(
    clientScriptOptInMessage.includes('SecurityError') &&
      clientScriptOptInMessage.includes('allow-client-scripts') &&
      errorEventFired,
    'executeScript fails closed with SecurityError and dispatches error event when allowClientScripts is false',
  );

  // Opt in via instance.allowClientScripts = true and verify fail-closed Worker check
  instance.allowClientScripts = true;
  assert(
    instance.hasAttribute('allow-client-scripts') &&
      instance.allowClientScripts === true,
    'allowClientScripts=true sets allow-client-scripts attribute',
  );

  let failClosedMessage = '';
  errorEventFired = false;
  try {
    await instance.executeScript('const m = new THREE.Mesh();');
  } catch (error: unknown) {
    failClosedMessage = error instanceof Error ? error.message : String(error);
  }
  assert(
    failClosedMessage.includes('Workers are unavailable') && errorEventFired,
    'executeScript fails closed when Worker unavailable in sandbox=worker mode after allowClientScripts opt-in',
  );

  // Reset allowClientScripts to false and verify Use Case 2 (loadScriptFromSrc)
  // passes scriptUrl directly to the sandbox without requiring allowClientScripts
  instance.allowClientScripts = false;
  let useCase2Message = '';
  try {
    await instance.loadScriptFromSrc('https://cdn.example.com/scene.js');
  } catch (error: unknown) {
    useCase2Message = error instanceof Error ? error.message : String(error);
  }
  assert(
    useCase2Message.includes('Workers are unavailable'),
    'loadScriptFromSrc (Use Case 2) routes directly to sandbox executeUrl without requiring allowClientScripts',
  );

  // Test events dispatch
  let eventFired = false;
  let eventDetail: {meshName?: string; meshIndex?: number} | null = null;
  instance.addEventListener('meshclick', (event: Event) => {
    eventFired = true;
    eventDetail = (
      event as CustomEvent<{meshName?: string; meshIndex?: number}>
    ).detail;
  });

  instance.dispatchEvent(
    new CustomEvent('meshclick', {
      detail: {meshName: 'sole_accent', meshIndex: 2},
    }),
  );
  assert(eventFired, 'CustomEvent meshclick dispatched cleanly');
  assert(
    eventDetail?.meshName === 'sole_accent',
    'meshclick detail contains meshName',
  );

  // 3. Test Pluggable AR Provider & Lifecycle
  assert(
    typeof ThreeLiveElement.registerAR === 'function',
    'ThreeLiveElement has static registerAR method',
  );
  assert(
    typeof ThreeLiveElement.isARSupported === 'function',
    'ThreeLiveElement has static isARSupported method',
  );

  let arInvoked = false;
  let arOptionsReceived: any = null;
  ThreeLiveElement.registerAR(async (options: any) => {
    arInvoked = true;
    arOptionsReceived = options;
    return {mode: 'webxr', success: true};
  });

  assert(
    ThreeLiveElement.isARSupported() === true,
    'isARSupported returns true after registerAR',
  );

  // Test activateAR with mock model
  (instance as any).currentModel = 'test_model.glb';
  instance.setAttribute('ar-modes', 'webxr quick-look');

  let arStatusEvent: any = null;
  instance.addEventListener('ar-status', (e: any) => {
    arStatusEvent = e.detail;
  });

  const res = await instance.activateAR();
  assert(res.success === true, 'activateAR returns success');
  assert(arInvoked === true, 'Registered AR provider was invoked');
  assert(
    arStatusEvent?.status === 'session-started',
    'activateAR dispatches ar-status with status session-started',
  );
  assert(
    arOptionsReceived?.glbUrl === 'test_model.glb',
    'AR provider received glbUrl',
  );
  assert(
    Array.isArray(arOptionsReceived?.preferredModes) &&
      arOptionsReceived.preferredModes[0] === 'webxr',
    'AR provider received preferredModes',
  );

  // Test custom [slot="ar-button"] overlay support
  arInvoked = false;
  let customClickHandled = false;
  const mockCustomBtn: any = {
    style: {display: 'block'},
    dataset: {},
    addEventListener: (evt: string, fn: any) => {
      if (evt === 'click') {
        mockCustomBtn._clickFn = fn;
      }
    },
  };
  (instance as any).querySelector = (sel: string) =>
    sel === '[slot="ar-button"]' ? mockCustomBtn : null;
  (instance as any).arButton = {style: {display: 'flex'}};
  instance.setAttribute('ar', '');
  instance.updateARButtonVisibility();
  assert(
    (instance as any).arButton.style.display === 'none',
    'Default AR button is hidden when [slot="ar-button"] is present',
  );
  assert(
    typeof mockCustomBtn._clickFn === 'function',
    'Custom [slot="ar-button"] receives click listener for activateAR',
  );
  await mockCustomBtn._clickFn({
    stopPropagation: () => {
      customClickHandled = true;
    },
  });
  assert(
    customClickHandled && arInvoked,
    'Clicking custom [slot="ar-button"] invokes activateAR()',
  );

  // Test updateHotspot({ name, position, normal })
  const hotspotAttrs = new Map<string, string>();
  const mockHotspotEl = {
    setAttribute: (k: string, v: string) => hotspotAttrs.set(k, v),
    getAttribute: (k: string) => hotspotAttrs.get(k),
  };
  (instance as any).querySelector = (sel: string) =>
    sel === '[slot="hotspot-visor"]' ? mockHotspotEl : null;
  instance.updateHotspot({
    name: 'hotspot-visor',
    position: '0.1 1.5 0.3',
    normal: '0 0 1',
  });
  assert(
    hotspotAttrs.get('data-position') === '0.1 1.5 0.3',
    'updateHotspot updates data-position attribute on slotted hotspot',
  );
  assert(
    hotspotAttrs.get('data-normal') === '0 0 1',
    'updateHotspot updates data-normal attribute on slotted hotspot',
  );

  // Test cameraControls attribute and property (strict model-viewer default: disabled unless present)
  assert(
    instance.cameraControls === false,
    'cameraControls is disabled by default when camera-controls attribute is absent',
  );
  instance.cameraControls = true;
  assert(
    attributes.has('camera-controls') && instance.cameraControls === true,
    'cameraControls=true sets camera-controls attribute and getter returns true',
  );
  instance.cameraControls = false;
  assert(
    !attributes.has('camera-controls') && instance.cameraControls === false,
    'cameraControls=false removes camera-controls attribute and getter returns false',
  );
  instance.setAttribute('camera-controls', 'false');
  assert(
    instance.cameraControls === false,
    'camera-controls="false" disables cameraControls',
  );

  // Test arScale and arPlacement attributes and properties
  instance.arScale = 'fixed';
  instance.arPlacement = 'wall';
  assert(
    instance.arScale === 'fixed' && instance.arPlacement === 'wall',
    'arScale and arPlacement properties sync with attributes',
  );

  // Test skyboxImage property
  instance.skyboxImage = '/hdr/studio_sky.hdr';
  assert(
    instance.skyboxImage === '/hdr/studio_sky.hdr',
    'skyboxImage property syncs with skybox-image attribute',
  );

  // Test canActivateAR
  assert(
    instance.canActivateAR === true,
    'canActivateAR returns true when arProvider is registered',
  );

  // Test arScale and arPlacement forwarded to activateAR
  await instance.activateAR();
  assert(
    arOptionsReceived?.arScale === 'fixed' &&
      arOptionsReceived?.arPlacement === 'wall',
    'activateAR forwards arScale and arPlacement to arProvider',
  );

  // Test imperative camera and screenshot APIs
  let jumpCalled = false;
  (instance as any).viewer = {
    getCameraOrbit: () => ({theta: 0.4, phi: 1.1, radius: 3.5}),
    getCameraTarget: () => ({x: 0.1, y: 0.2, z: 0.3}),
    getFieldOfView: () => 42,
    jumpCameraToGoal: () => {
      jumpCalled = true;
    },
    getModelMaterials: () => [
      {
        name: 'GoldTrim',
        pbrMetallicRoughness: {
          baseColorFactor: [1, 0.8, 0.2, 1],
          metallicFactor: 1,
          roughnessFactor: 0.2,
          setBaseColorFactor: () => {},
          setMetallicFactor: () => {},
          setRoughnessFactor: () => {},
        },
      },
    ],
    raycastFromScreenPoint: (x: number, y: number) =>
      x === 100 && y === 150
        ? {
            meshName: 'GoldTrim',
            hitPoint: [1, 2, 3],
            normal: [0, 1, 0],
            distance: 2.5,
          }
        : null,
  };
  (instance as any).canvas = {
    getBoundingClientRect: () => ({left: 10, top: 20}),
    toDataURL: () => 'data:image/png;base64,MOCK',
    toBlob: (cb: any) => cb(new Blob(['mock'], {type: 'image/png'})),
  };

  const elemOrbit = instance.getCameraOrbit();
  assert(
    Math.abs(elemOrbit.theta - 0.4) < 1e-4 &&
      Math.abs(elemOrbit.radius - 3.5) < 1e-4,
    'instance.getCameraOrbit() delegates to viewer',
  );
  const elemTarget = instance.getCameraTarget();
  assert(
    Math.abs(elemTarget.y - 0.2) < 1e-4,
    'instance.getCameraTarget() delegates to viewer',
  );
  assert(
    instance.getFieldOfView() === 42,
    'instance.getFieldOfView() returns vertical FOV in degrees',
  );
  instance.jumpCameraToGoal();
  assert(jumpCalled, 'instance.jumpCameraToGoal() delegates to viewer');

  assert(
    instance.toDataURL() === 'data:image/png;base64,MOCK',
    'instance.toDataURL() captures canvas image',
  );
  const blob = await instance.toBlob();
  assert(blob instanceof Blob, 'instance.toBlob() resolves to Blob');

  // Test model.materials and getMaterialByName
  const modelFacade = instance.model;
  assert(
    modelFacade !== null && modelFacade.materials.length === 1,
    'instance.model.materials exposes material proxy list',
  );
  assert(
    modelFacade?.getMaterialByName('GoldTrim')?.name === 'GoldTrim',
    'instance.model.getMaterialByName looks up material by name',
  );

  // Test positionAndNormalFromPoint(pixelX, pixelY)
  const hitRes = instance.positionAndNormalFromPoint(100, 150);
  assert(
    hitRes !== null &&
      hitRes.position.toString() === '1m 2m 3m' &&
      hitRes.normal.toString() === '0m 1m 0m',
    'instance.positionAndNormalFromPoint returns position and normal with model-viewer toString() formatting',
  );

  // Test turntableRotation and resetTurntableRotation delegation
  let resetTheta: number | undefined;
  (instance as any).viewer.turntableRotation = 1.25;
  (instance as any).viewer.resetTurntableRotation = (theta = 0) => {
    resetTheta = theta;
    (instance as any).viewer.turntableRotation = theta;
  };
  assert(
    Math.abs(instance.turntableRotation - 1.25) < 1e-5,
    'instance.turntableRotation reads viewer.turntableRotation',
  );
  instance.resetTurntableRotation(0.5);
  assert(
    resetTheta === 0.5 && Math.abs(instance.turntableRotation - 0.5) < 1e-5,
    'instance.resetTurntableRotation(theta) delegates to viewer.resetTurntableRotation',
  );

  console.log(
    `\n🏆 <three-live> Element Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runElementTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
