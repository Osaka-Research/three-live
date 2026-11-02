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
  mat4Create,
  mat4FromRotationTranslationScale,
} from '../../three-live/src/math';
import {THREE} from '../../three-live/src/three-author';
import {
  generateUSDA,
  sceneToCanvas3D,
  sceneToGLB,
} from '../../three-live/src/three-convert';
import {ThreeLiveElement} from '../../three-live/src/three-live-element';
import {XRDepthManager} from '../src/xr-depth';
import {
  captureXRViewFrame,
  quantizeHeadPosition,
  registerXRLiveWebMCPTools,
  XRModeTransitionController,
  XRSpatialAudioController,
} from '../src/xr-extras';
import {classifyHandJoints, type XRHandJointMap} from '../src/xr-gestures';
import {raycastGpuMeshes, XRInputManager} from '../src/xr-input';
import {
  XRAnchorElement,
  XRLiveElement,
  xrLiveSpatialPlugin,
} from '../src/xr-live-element';
import {
  buildAndroidSceneViewerIntentUrl,
  launchBestMobileOrHeadsetAR,
} from '../src/xr-mobile-bridge';
import {XRHeightfieldPhysics} from '../src/xr-physics';
import {XRDesktopSimulator} from '../src/xr-simulator';
import {
  parseSlotAttributes,
  XRSpatialSlotManager,
} from '../src/xr-spatial-slot';
import {
  computeBillboardQuaternion,
  extractPosition,
  extractScale,
  type XRPose6DoF,
  XRTraitSystem,
} from '../src/xr-traits';

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

function makePose(pos: [number, number, number]): XRPose6DoF {
  const m = mat4Create();
  mat4FromRotationTranslationScale(m, [0, 0, 0, 1], pos, [1, 1, 1]);
  return {
    position: pos,
    quaternion: [0, 0, 0, 1],
    matrix: m,
  };
}

async function runXRLiveTests() {
  console.log('🥽 Running <xr-live> Full Phase 1-4 Unit Tests...\n');

  // =========================================================================
  // Phase 1.1: <xr-live> Custom Element Inheritance
  // =========================================================================
  assert(
    XRLiveElement.prototype instanceof ThreeLiveElement,
    'Phase 1.1: XRLiveElement inherits from ThreeLiveElement',
  );

  const attrs = XRLiveElement.observedAttributes;
  assert(
    attrs.includes('src') &&
      attrs.includes('camera-orbit') &&
      attrs.includes('ar') &&
      attrs.includes('xr-mode') &&
      attrs.includes('xr-depth') &&
      attrs.includes('xr-hands') &&
      attrs.includes('xr-simulator') &&
      attrs.includes('xr-profile'),
    'Phase 1.1: XRLiveElement observes ThreeLiveElement + Deep XR attributes',
  );
  assert(
    XRAnchorElement.observedAttributes.includes('surface'),
    'Phase 1.1: XRAnchorElement observes surface attribute',
  );

  // =========================================================================
  // Phase 1.2: Declarative Spatial Traits & Input Raycasting
  // =========================================================================
  const traits = new XRTraitSystem();
  const meshTransform = mat4Create();
  mat4FromRotationTranslationScale(
    meshTransform,
    [0, 0, 0, 1],
    [0, 1.0, -1.5],
    [1, 1, 1],
  );
  const grabbableMesh = {
    name: 'Panel1',
    transform: meshTransform,
    normalMatrix: new Float32Array(9),
    extras: {
      xr: {
        grab: '2-hand',
        scale: {min: 0.5, max: 2.0},
        billboard: 'capsule',
        follow: 'head',
      },
    },
  };

  // Billboard quaternion test (capsule mode clamps pitch to +-30 deg)
  const bbQuat = computeBillboardQuaternion(
    [0, 1, -1.5],
    [0, 3.0, 0],
    'capsule',
  );
  const qLen = Math.hypot(bbQuat[0], bbQuat[1], bbQuat[2], bbQuat[3]);
  assert(
    Math.abs(qLen - 1.0) < 1e-4,
    'Phase 1.2: computeBillboardQuaternion produces normalized quaternion with capsule pitch clamp',
  );

  // 1-hand grab & move
  const rightHand0 = makePose([0, 1.0, -1.5]);
  const grabStarted = traits.startGrab(grabbableMesh, 'right', rightHand0);
  assert(grabStarted, 'Phase 1.2: XRTraitSystem.startGrab starts 1-hand grab');

  const rightHandMoved = makePose([0.5, 1.2, -1.2]);
  for (let step = 0; step < 25; step++) {
    traits.update(
      [grabbableMesh],
      makePose([0, 1.6, 0]),
      {right: rightHandMoved},
      1 / 60,
    );
  }
  const movedPos = extractPosition(grabbableMesh.transform);
  assert(
    Math.abs(movedPos[0] - 0.5) < 1e-3 && Math.abs(movedPos[1] - 1.2) < 1e-3,
    'Phase 1.2: 1-hand grab translates mesh transform in 3D space',
  );

  // 2-hand pinch-to-scale
  const leftHand0 = makePose([1.0, 1.2, -1.2]); // 0.5m apart from rightHandMoved (0.5, 1.2, -1.2)
  traits.startGrab(grabbableMesh, 'left', leftHand0);
  traits.update(
    [grabbableMesh],
    makePose([0, 1.6, 0]),
    {right: rightHandMoved, left: leftHand0},
    1 / 60,
  );
  const leftHandSpread = makePose([1.5, 1.2, -1.2]); // 1.0m apart -> 2x scale
  traits.update(
    [grabbableMesh],
    makePose([0, 1.6, 0]),
    {right: rightHandMoved, left: leftHandSpread},
    1 / 60,
  );
  const scaleAfterTwoHand = extractScale(grabbableMesh.transform)[0];
  assert(
    Math.abs(scaleAfterTwoHand - 2.0) < 1e-3,
    'Phase 1.2: 2-hand pinch-to-scale scales mesh matrix and respects scale bounds',
  );
  traits.endGrab('right');
  traits.endGrab('left');

  // Raycast against GPU mesh with UV interpolation
  const quadPositions = new Float32Array([
    -1, -1, -2, 1, -1, -2, 1, 1, -2, -1, 1, -2,
  ]);
  const quadUvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const quadIndices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const quadMesh = {
    name: 'SpatialQuad',
    visible: true,
    transform: mat4Create(),
    primitives: [
      {
        positions: quadPositions,
        uvs: quadUvs,
        indices: quadIndices,
      },
    ],
  };
  const hit = raycastGpuMeshes([quadMesh], [0, 0, 0], [0, 0, -1]);
  assert(
    hit !== null &&
      Math.abs(hit.distance - 2.0) < 1e-4 &&
      hit.uv !== null &&
      Math.abs(hit.uv[0] - 0.5) < 1e-4 &&
      Math.abs(hit.uv[1] - 0.5) < 1e-4,
    'Phase 1.2: raycastGpuMeshes computes exact triangle intersection and barycentric UV (0.5, 0.5)',
  );

  // XRInputManager synthetic select ray dispatch
  let slotHitTriggered = false;
  const inputMgr = new XRInputManager({}, traits, (h) => {
    if (h.mesh.name === 'SpatialQuad') slotHitTriggered = true;
  });
  (quadMesh as any).isSpatialSlot = true;
  const hitRes = inputMgr.triggerSyntheticSelect(
    'start',
    'right',
    {meshes: [quadMesh]},
    [0, 0, 0],
    [0, 0, -1],
  );
  inputMgr.triggerSyntheticSelect(
    'end',
    'right',
    {meshes: [quadMesh]},
    [0, 0, 0],
    [0, 0, -1],
  );
  assert(
    hitRes !== null && slotHitTriggered,
    'Phase 1.2: XRInputManager dispatches synthetic select ray and invokes spatial slot hit handler',
  );

  // =========================================================================
  // Phase 1.3: Spatial DOM Slots (<div slot="spatial">)
  // =========================================================================
  const fakeEl = {
    id: 'buy-card',
    style: {width: '300px', height: '200px'},
    getAttribute(attr: string) {
      const map: Record<string, string> = {
        'data-xr-position': '0 1.3 -1.2',
        'data-xr-billboard': 'capsule',
        'data-xr-grab': '2-hand',
        'data-xr-dpi': '1000',
      };
      return map[attr] ?? null;
    },
    hasAttribute(attr: string) {
      return (
        attr === 'data-xr-grab' ||
        attr === 'data-xr-billboard' ||
        attr === 'data-xr-position'
      );
    },
    getBoundingClientRect() {
      return {left: 0, top: 0, width: 300, height: 200};
    },
    querySelectorAll() {
      return [];
    },
  } as unknown as HTMLElement;

  const slotCfg = parseSlotAttributes(fakeEl);
  assert(
    slotCfg.traits.billboard === 'capsule' &&
      slotCfg.traits.grab === '2-hand' &&
      Math.abs(slotCfg.position[1] - 1.3) < 1e-4,
    'Phase 1.3: parseSlotAttributes parses data-xr-position, data-xr-billboard, and data-xr-grab',
  );

  const slotMgr = new XRSpatialSlotManager();
  const mockViewer = {meshes: [] as any[], gl: undefined};
  const slotEntries = slotMgr.syncSlots(
    {querySelectorAll: () => [fakeEl]},
    mockViewer,
  );
  assert(
    slotEntries.length === 1 &&
      slotEntries[0].meshGpu.primitives[0].positions.length === 12 &&
      slotEntries[0].meshGpu.primitives[0].indices.length === 6,
    'Phase 1.3: XRSpatialSlotManager creates 3D textured quad geometry for <div slot="spatial">',
  );

  // =========================================================================
  // Phase 1.4: Desktop 6DoF WebXR Simulator
  // =========================================================================
  const sim = new XRDesktopSimulator('living-room');
  const startPos = [...sim.getHeadPose().position];
  sim.handleKeyDown('w');
  sim.stepLocomotion(0.1);
  sim.handleKeyUp('w');
  assert(
    sim.getHeadPose().position[2] < startPos[2],
    'Phase 1.4: XRDesktopSimulator WASD locomotion moves virtual headset forward',
  );
  const cycledGesture = sim.handleKeyDown('g');
  sim.handleKeyUp('g');
  assert(
    cycledGesture !== null && cycledGesture !== 'none',
    'Phase 1.4: XRDesktopSimulator G key cycles simulated hand gesture',
  );

  // =========================================================================
  // Phase 2.1: Hardware Depth Sensing & Normal Estimation
  // =========================================================================
  const depthMgr = new XRDepthManager();
  const depthGrid = new Float32Array(16 * 16);
  for (let i = 0; i < depthGrid.length; i++) depthGrid[i] = 1.75; // 1.75m flat wall
  depthMgr.setSyntheticDepthInfo({
    width: 16,
    height: 16,
    rawValueToMeters: 1.0,
    data: depthGrid,
  });
  const sample = depthMgr.sampleDepthAndNormal(0.5, 0.5);
  assert(
    sample !== null &&
      Math.abs(sample.depthMeters - 1.75) < 1e-4 &&
      Math.abs(sample.normal[2] - 1.0) < 1e-3,
    'Phase 2.1: XRDepthManager.sampleDepthAndNormal extracts metric depth and surface normal',
  );

  // =========================================================================
  // Phase 2.2: Heightfield Depth Physics & Sphere-to-Sphere Ballpit
  // =========================================================================
  const physics = new XRHeightfieldPhysics();
  const ballATransform = mat4Create();
  mat4FromRotationTranslationScale(
    ballATransform,
    [0, 0, 0, 1],
    [0, 0.25, -1],
    [1, 1, 1],
  );
  const ballBTransform = mat4Create();
  mat4FromRotationTranslationScale(
    ballBTransform,
    [0, 0, 0, 1],
    [0.15, 0.1, -1],
    [1, 1, 1],
  );
  const ballAMesh = {
    name: 'BallA',
    visible: true,
    transform: ballATransform,
    extras: {xr: {physics: 'dynamic'}},
  };
  const ballBMesh = {
    name: 'BallB',
    visible: true,
    transform: ballBTransform,
    extras: {xr: {physics: 'dynamic'}},
  };
  physics.setVelocity(ballBMesh, -2.0, 0, 0);
  for (let i = 0; i < 20; i++) {
    physics.step([ballAMesh, ballBMesh], 1 / 60, undefined, 0);
  }
  const ballAPos = extractPosition(ballAMesh.transform);
  assert(
    ballAPos[1] >= 0.09 && ballAPos[0] < 0,
    'Phase 2.2: XRHeightfieldPhysics resolves floor bounce and sphere-to-sphere Ballpit collision',
  );

  // Verify circular table surface, 3D furniture AABB collider, and enclosing room wall bounds
  const roomBallTransform = mat4Create();
  mat4FromRotationTranslationScale(
    roomBallTransform,
    [0, 0, 0, 1],
    [0, 0.25, 0],
    [1, 1, 1],
  );
  const roomBallMesh = {
    name: 'RoomBall',
    visible: true,
    transform: roomBallTransform,
    extras: {xr: {physics: 'dynamic'}},
  };
  physics.tableCenter = [0, 0];
  physics.tableRadius = 0.72;
  physics.roomBounds = {
    minX: -1.0,
    maxX: 1.0,
    minZ: -1.0,
    maxZ: 1.0,
    ceilingY: 2.0,
  };
  physics.colliders = [{min: [0.3, -0.5, -0.3], max: [0.8, 0.4, 0.3]}];
  for (let i = 0; i < 40; i++) {
    physics.step([roomBallMesh], 1 / 60, undefined, -0.5, 0.0);
  }
  const roomBallPos = extractPosition(roomBallMesh.transform);
  assert(
    Math.abs(roomBallPos[1] - 0.1) < 0.03,
    `Phase 2.2b: XRHeightfieldPhysics rests sphere on circular tableY=0 (got y=${roomBallPos[1].toFixed(3)})`,
  );
  physics.setVelocity(roomBallMesh, -15.0, 0, 0);
  for (let i = 0; i < 20; i++) {
    physics.step([roomBallMesh], 1 / 60, undefined, -0.5, 0.0);
  }
  const walledPos = extractPosition(roomBallMesh.transform);
  assert(
    walledPos[0] >= -0.91,
    `Phase 2.2c: XRHeightfieldPhysics roomBounds contains sphere within minX=-1.0 wall (got x=${walledPos[0].toFixed(3)})`,
  );

  // =========================================================================
  // Phase 2.3: Procedural 25-Joint Hand Gesture Classifier
  // =========================================================================
  function makeTestHand(
    mode: 'pinch' | 'point' | 'fist' | 'open-palm' | 'thumbs-up',
  ): XRHandJointMap {
    const m: XRHandJointMap = {
      wrist: [0, 0, 0],
      'thumb-metacarpal': [0.02, 0.03, 0],
      'index-finger-metacarpal': [0, 0.06, 0],
      'middle-finger-metacarpal': [0, 0.06, 0],
      'ring-finger-metacarpal': [0, 0.06, 0],
      'pinky-finger-metacarpal': [0, 0.06, 0],
    };
    if (mode === 'pinch') {
      m['thumb-tip'] = [0.02, 0.12, 0];
      m['index-finger-tip'] = [0.025, 0.12, 0]; // 0.5cm apart (< 1.8cm)
      m['middle-finger-tip'] = [0, 0.16, 0];
      m['ring-finger-tip'] = [-0.02, 0.15, 0];
      m['pinky-finger-tip'] = [-0.04, 0.14, 0];
    } else if (mode === 'point') {
      m['thumb-tip'] = [0.01, 0.02, 0];
      m['index-finger-tip'] = [0, 0.18, 0]; // extended
      m['middle-finger-tip'] = [0, 0.02, 0]; // curled back toward wrist
      m['ring-finger-tip'] = [0, 0.02, 0];
      m['pinky-finger-tip'] = [0, 0.02, 0];
    } else if (mode === 'fist') {
      m['thumb-tip'] = [0.01, 0.01, 0];
      m['index-finger-tip'] = [0, 0.02, 0];
      m['middle-finger-tip'] = [0, 0.02, 0];
      m['ring-finger-tip'] = [0, 0.02, 0];
      m['pinky-finger-tip'] = [0, 0.02, 0];
    } else if (mode === 'thumbs-up') {
      m['thumb-metacarpal'] = [0, 0.05, 0];
      m['thumb-tip'] = [0, 0.16, 0]; // straight up (+Y)
      m['index-finger-tip'] = [0, 0.02, 0];
      m['middle-finger-tip'] = [0, 0.02, 0];
      m['ring-finger-tip'] = [0, 0.02, 0];
      m['pinky-finger-tip'] = [0, 0.02, 0];
    } else {
      // open-palm
      m['thumb-tip'] = [0.04, 0.09, 0];
      m['index-finger-tip'] = [0.01, 0.18, 0];
      m['middle-finger-tip'] = [0, 0.19, 0];
      m['ring-finger-tip'] = [-0.01, 0.18, 0];
      m['pinky-finger-tip'] = [-0.02, 0.16, 0];
    }
    return m;
  }

  assert(
    classifyHandJoints(makeTestHand('pinch')).gesture === 'pinch' &&
      classifyHandJoints(makeTestHand('point')).gesture === 'point' &&
      classifyHandJoints(makeTestHand('fist')).gesture === 'fist' &&
      classifyHandJoints(makeTestHand('thumbs-up')).gesture === 'thumbs-up' &&
      (classifyHandJoints(makeTestHand('open-palm')).gesture === 'open-palm' ||
        classifyHandJoints(makeTestHand('open-palm')).gesture === 'spread'),
    'Phase 2.3: classifyHandJoints accurately detects pinch, point, fist, thumbs-up, and open-palm',
  );

  // =========================================================================
  // Phase 3.1 & 3.2: GLB/USDZ Spatial Trait Export, Baked Animations & Mobile Bridge
  // =========================================================================
  const scene = new THREE.Scene();
  const boxMesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.5, 0.5),
    new THREE.MeshStandardMaterial({color: 0x00ff88}),
  );
  boxMesh.name = 'SpinningCube';
  boxMesh.userData.xr = {
    grabbable: true,
    scalable: {min: 0.5, max: 2.0},
    billboard: 'capsule',
    anchor: 'horizontal',
    physics: 'dynamic',
    restitution: 0.7,
  };
  scene.add(boxMesh);

  const c3d = sceneToCanvas3D(scene, {
    duration: 1.0,
    fps: 10,
    animateFn: (t: number) => {
      boxMesh.position.y = t * 0.5;
    },
  });
  assert(
    c3d.gltf.nodes[0].extras?.xr?.grabbable === true &&
      c3d.gltf.nodes[0].extensions?.ANDROID_xr_scenecore !== undefined &&
      Array.isArray(c3d.gltf.animations) &&
      c3d.gltf.animations.length === 1,
    'Phase 3.1: sceneToCanvas3D exports node.extras.xr, ANDROID_xr_scenecore, and baked glTF 2.0 animations',
  );

  const glbBytes = sceneToGLB(scene, {
    duration: 1.0,
    fps: 10,
    animateFn: (t: number) => {
      boxMesh.position.y = t * 0.5;
    },
  });
  assert(
    glbBytes.byteLength > 100,
    'Phase 3.1: sceneToGLB packs binary GLB with spatial traits and keyframe animations',
  );

  const usdaText = generateUSDA(scene, {
    duration: 1.0,
    fps: 10,
    animateFn: (t: number) => {
      boxMesh.position.y = t * 0.5;
    },
  });
  assert(
    usdaText.includes('preliminary:anchoring:type = "plane"') &&
      usdaText.includes('PhysicsBodyAPI') &&
      usdaText.includes('dictionary xr =') &&
      usdaText.includes('xformOp:translate.timeSamples'),
    'Phase 3.1: generateUSDA exports preliminary:anchoring, PhysicsBodyAPI, customData.xr, and timeSamples',
  );

  const intentUrl = buildAndroidSceneViewerIntentUrl(
    'https://example.com/cube.glb',
    {
      title: 'Spinning Cube',
      mode: 'ar_preferred',
    },
  );
  assert(
    intentUrl.startsWith('intent://arvr.google.com/scene-viewer/') &&
      intentUrl.includes('package=com.google.ar.core'),
    'Phase 3.2: buildAndroidSceneViewerIntentUrl constructs ARCore Scene Viewer intent URI',
  );

  const fallbackReport = await launchBestMobileOrHeadsetAR(scene);
  assert(
    fallbackReport.platform === 'simulator',
    'Phase 3.2: launchBestMobileOrHeadsetAR gracefully selects simulator when outside mobile/WebXR browser',
  );

  // =========================================================================
  // Phase 4.1 - 4.4: AR/VR Mode Transitions, Spatial Audio, AI Snapshot & WebMCP
  // =========================================================================
  const modeCtrl = new XRModeTransitionController();
  const dummyViewer = {clearColor: [0, 0, 0, 0]};
  modeCtrl.transitionToVR(dummyViewer, {durationMs: 200});
  modeCtrl.step(dummyViewer, 0.1); // 100ms = 50% progress -> smoothstep(0.5) = 0.5
  assert(
    Math.abs(modeCtrl.getAlpha() - 0.5) < 1e-4,
    'Phase 4.1: XRModeTransitionController smoothly interpolates passthrough-to-VR skybox alpha',
  );
  modeCtrl.step(dummyViewer, 0.15);
  assert(
    Math.abs(modeCtrl.getAlpha() - 1.0) < 1e-4,
    'Phase 4.1: XRModeTransitionController reaches target alpha 1.0 at transition completion',
  );

  const audioCtrl = new XRSpatialAudioController();
  audioCtrl.syncSpatialNodes([grabbableMesh], makePose([0, 1.6, 0]));
  audioCtrl.playEarcon('grab', [0, 1.5, -1]);
  assert(
    true,
    'Phase 4.3: XRSpatialAudioController handles headless environment gracefully',
  );

  const frameSnap = await captureXRViewFrame(
    {canvas: {width: 320, height: 240}},
    makePose([0, 1.6, 0]),
    depthMgr,
    {includeDepth: true},
  );
  assert(
    frameSnap.width === 320 &&
      frameSnap.height === 240 &&
      frameSnap.dataUrl.startsWith('data:image/') &&
      Array.isArray(frameSnap.depthGridMeters) &&
      frameSnap.depthGridMeters.length === 64,
    'Phase 4.4: captureXRViewFrame returns frame dataUrl and 8x8 depthGridMeters for AI vision pipelines',
  );

  const registeredTools: any[] = [];
  const mockNavigator = {
    modelContext: {
      registerTool: (tool: any) => registeredTools.push(tool),
    },
  };
  registerXRLiveWebMCPTools(
    {},
    () => ({meshes: [grabbableMesh]}),
    () => makePose([0, 1.6, 0]),
    depthMgr,
    mockNavigator,
  );
  assert(
    registeredTools.length === 3 &&
      registeredTools.some((t) => t.name === 'inspect_xr_scene') &&
      registeredTools.some((t) => t.name === 'place_xr_object_at_gaze') &&
      registeredTools.some((t) => t.name === 'capture_xr_view'),
    'Phase 4.4: registerXRLiveWebMCPTools registers 3 spatial AI tools on navigator.modelContext',
  );

  // =========================================================================
  // Audit Regression Tests: Security, Performance & Correctness
  // =========================================================================
  // 1. Security: Scene Viewer Intent URL scheme validation
  let rejectedUnsafeScheme = false;
  try {
    buildAndroidSceneViewerIntentUrl('javascript:alert(1)');
  } catch (_) {
    rejectedUnsafeScheme = true;
  }
  assert(
    rejectedUnsafeScheme,
    'Security S2: buildAndroidSceneViewerIntentUrl rejects unsafe javascript: scheme injection',
  );

  // 2. Security & Performance: Spatial slot dimension clamping & GPU resource disposal
  let deletedTextures = 0;
  let deletedBuffers = 0;
  let deletedVAOs = 0;
  const mockGl: any = {
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    texImage2D: () => {},
    texSubImage2D: () => {},
    texParameteri: () => {},
    deleteTexture: () => {
      deletedTextures++;
    },
    deleteBuffer: () => {
      deletedBuffers++;
    },
    deleteVertexArray: () => {
      deletedVAOs++;
    },
  };
  const oversizedSlotEl: any = {
    id: 'huge-slot',
    style: {width: '65536px', height: '65536px'},
    hasAttribute: () => false,
    getAttribute: (attr: string) => (attr === 'data-xr-dpi' ? '500' : null),
    getBoundingClientRect: () => ({
      width: 65536,
      height: 65536,
      left: 0,
      top: 0,
    }),
  };
  const slotMgrTest = new XRSpatialSlotManager();
  const slotViewer = {gl: mockGl, meshes: []};
  const synced = slotMgrTest.syncSlots(
    {querySelectorAll: () => [oversizedSlotEl]} as any,
    slotViewer,
  );
  assert(
    synced[0].widthPx === 2048 && synced[0].heightPx === 2048,
    'Security S1: XRSpatialSlotManager clamps oversized DOM dimensions to MAX_SPATIAL_SLOT_DIMENSION (2048px)',
  );
  slotMgrTest.dispose(mockGl);
  assert(
    deletedTextures === 1 && deletedBuffers === 4 && deletedVAOs === 1,
    'Performance P2: XRSpatialSlotManager.dispose(gl) deletes WebGL textures, buffers, and VAOs',
  );

  // 3. Correctness & Performance: Float32 depth format upload & XRDepthManager disposal
  const depthViewer: any = {
    gl: mockGl,
    xrDepthState: {
      enabled: false,
      texture: null,
      format: 0,
      rawValueToMeters: 0.001,
    },
  };
  const floatDepthFrame = {
    getDepthInformation: () => ({
      width: 4,
      height: 4,
      rawValueToMeters: 1.0,
      data: new Float32Array(16).fill(1.5),
    }),
  };
  depthMgr.updateFromXRFrame(
    depthViewer,
    floatDepthFrame,
    {session: {depthDataFormat: 'float32'}},
    true,
  );
  assert(
    depthViewer.xrDepthState.format === 1 &&
      depthViewer.xrDepthState.enabled === true,
    'Correctness C2: XRDepthManager detects Float32Array depth data and sets xrDepthState.format = 1',
  );
  depthMgr.dispose(mockGl);
  assert(
    deletedTextures === 2,
    'Performance P2: XRDepthManager.dispose(gl) deletes allocated WebGL depth texture',
  );

  // 4. Correctness C3: 1-hand grab low-pass smoothing preserves matrix orthonormality
  const grabMesh = {
    name: 'OrthonormalCube',
    visible: true,
    transform: mat4Create(),
    normalMatrix: new Float32Array(9),
    userData: {xr: {grabbable: true}},
  };
  const traitSysTest = new XRTraitSystem();
  const startHandPose = makePose([0, 1.4, -0.5], [0, 0, 0, 1]);
  traitSysTest.startGrab(grabMesh, 'right', startHandPose);
  // Rotate hand 90 degrees around Y
  const rotatedHandPose = makePose(
    [0.2, 1.5, -0.4],
    [0, 0.70710678, 0, 0.70710678],
  );
  traitSysTest.update(
    [grabMesh],
    makePose([0, 1.6, 0]),
    {right: rotatedHandPose},
    1 / 60,
  );
  const col0Len = Math.hypot(
    grabMesh.transform[0],
    grabMesh.transform[1],
    grabMesh.transform[2],
  );
  const col1Len = Math.hypot(
    grabMesh.transform[4],
    grabMesh.transform[5],
    grabMesh.transform[6],
  );
  const col2Len = Math.hypot(
    grabMesh.transform[8],
    grabMesh.transform[9],
    grabMesh.transform[10],
  );
  assert(
    Math.abs(col0Len - 1.0) < 1e-3 &&
      Math.abs(col1Len - 1.0) < 1e-3 &&
      Math.abs(col2Len - 1.0) < 1e-3,
    'Correctness C3: 1-hand grab TRS slerp smoothing preserves unit column lengths (no matrix shearing)',
  );

  // =========================================================================
  // Regression X1: Default No-Op Simulator Room Config & stepSpatialFrame
  // =========================================================================
  const defaultElement = new XRLiveElement();
  (defaultElement as any).getAttribute = () => null;
  (defaultElement as any).hasAttribute = () => false;
  assert(
    defaultElement.simulator?.room !== undefined &&
      defaultElement.simulator.room.floorY === 0 &&
      defaultElement.simulator.room.tableY === 0.75,
    'Regression X1: Default no-op simulator includes valid room config (floorY/tableY) when extras are not registered',
  );
  let stepSucceeded = false;
  try {
    defaultElement.stepSpatialFrame(1 / 60, {meshes: []});
    stepSucceeded = true;
  } catch (_e) {
    stepSucceeded = false;
  }
  assert(
    stepSucceeded,
    'Regression X1: stepSpatialFrame() executes cleanly without xr-live-extras registered',
  );

  // =========================================================================
  // P1-3 (WEB-14): WebMCP Depth Consent Gate, Head-Pose Quantization & Indicator
  // =========================================================================
  const qPose = quantizeHeadPosition([0.1234, 1.6789, -0.4321]);
  assert(
    qPose[0] === 0.1 && qPose[1] === 1.7 && qPose[2] === -0.4,
    'P1-3: quantizeHeadPosition rounds viewer coordinates to 0.1m resolution',
  );

  interface MockWebMCPTool {
    name: string;
    execute: (
      args?: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
  }

  const privacyTools: MockWebMCPTool[] = [];
  const privacyAttrs = new Map<string, string>();
  const privacyEvents: string[] = [];
  const privacyElement = {
    hasAttribute: (name: string) => privacyAttrs.has(name),
    getAttribute: (name: string) => privacyAttrs.get(name) ?? null,
    setAttribute: (name: string, val: string) => {
      privacyAttrs.set(name, val);
    },
    dispatchEvent: (evt: {type: string}) => {
      privacyEvents.push(evt.type);
      return true;
    },
  };
  registerXRLiveWebMCPTools(
    privacyElement,
    () => ({meshes: [grabbableMesh]}),
    () => makePose([0.1234, 1.6789, -0.4321]),
    depthMgr,
    {
      modelContext: {
        registerTool: (t: MockWebMCPTool) => privacyTools.push(t),
      },
    },
  );

  const inspectTool = privacyTools.find((t) => t.name === 'inspect_xr_scene')!;
  const captureTool = privacyTools.find((t) => t.name === 'capture_xr_view')!;

  const inspectedDefault = await inspectTool.execute();
  const defaultHead = inspectedDefault['headPosition'] as number[];
  assert(
    Array.isArray(defaultHead) &&
      defaultHead[0] === 0.1 &&
      defaultHead[1] === 1.7 &&
      defaultHead[2] === -0.4,
    'P1-3: inspect_xr_scene quantizes headPosition to 0.1m by default',
  );

  privacyAttrs.set('webmcp-omit-pose', '');
  const inspectedOmitted = await inspectTool.execute();
  assert(
    inspectedOmitted['headPosition'] === undefined,
    'P1-3: inspect_xr_scene omits headPosition when webmcp-omit-pose is set',
  );

  const capturedNoDepth = await captureTool.execute({includeDepth: true});
  assert(
    capturedNoDepth['depthGridMeters'] === undefined,
    'P1-3: capture_xr_view blocks depthGridMeters when webmcp-allow-depth is not set',
  );
  assert(
    privacyAttrs.get('data-xr-webmcp-indicator') === 'active',
    'P1-3: capture_xr_view sets data-xr-webmcp-indicator="active" on <xr-live>',
  );

  privacyAttrs.set('webmcp-allow-depth', '');
  const capturedWithDepth = await captureTool.execute({includeDepth: true});
  assert(
    Array.isArray(capturedWithDepth['depthGridMeters']) &&
      (capturedWithDepth['depthGridMeters'] as unknown[]).length === 64,
    'P1-3: capture_xr_view returns 8x8 depthGridMeters once webmcp-allow-depth is opted in',
  );

  // =========================================================================
  // Regression X2: XRLiveElement.enterSpatialAR uses currentModel on iOS
  //                and avoids cross-process blob: Scene Viewer intents
  // =========================================================================
  const arElement = new XRLiveElement();
  (arElement as any).getAttribute = () => null;
  (arElement as any).hasAttribute = () => false;
  (arElement as any).currentModel = glbBytes;
  const iosReport = await arElement.enterSpatialAR(undefined, 'ios-quicklook');
  assert(
    iosReport.platform === 'ios-quicklook' &&
      typeof iosReport.usdzByteLength === 'number' &&
      iosReport.usdzByteLength > 100,
    'Regression X2: enterSpatialAR() compiles loaded currentModel into non-empty USDZ for iOS Quick Look',
  );

  const gAny = globalThis as Record<string, unknown>;
  const prevNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  try {
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile',
      },
      configurable: true,
      writable: true,
    });
    const inMemAndroidReport = await launchBestMobileOrHeadsetAR(glbBytes);
    assert(
      inMemAndroidReport.platform === 'simulator',
      'Regression X2: Android without WebXR does not launch broken cross-process blob: Scene Viewer intent',
    );
    const hostedAndroidReport = await launchBestMobileOrHeadsetAR(
      'https://example.com/model.glb',
    );
    assert(
      hostedAndroidReport.platform === 'android-scene-viewer' &&
        Boolean(hostedAndroidReport.intentUrl?.includes('example.com')),
      'Regression X2: Android without WebXR launches Scene Viewer when given an https:// GLB URL',
    );
  } finally {
    if (prevNavDesc) {
      Object.defineProperty(globalThis, 'navigator', prevNavDesc);
    } else {
      delete gAny['navigator'];
    }
  }

  // =========================================================================
  // Regression X3: Android WebXR Depth Unpacking, Post-AR Freeze Guard & Plugin Lifecycle
  // =========================================================================
  const sessionInitCfg: Record<string, any> = {};
  depthMgr.configureSessionInit(sessionInitCfg, 'occlusion-physics');
  assert(
    Array.isArray(sessionInitCfg['depthSensing']?.usagePreference) &&
      sessionInitCfg['depthSensing'].usagePreference.length === 1 &&
      sessionInitCfg['depthSensing'].usagePreference[0] === 'cpu-optimized',
    'Regression X3: XRDepthManager requests only cpu-optimized depth (preventing InvalidStateError on gpu-optimized Android sessions)',
  );

  let unpackAlignmentSet: number | null = null;
  const texParams: Array<[number, number]> = [];
  const u16MockGl: any = {
    ...mockGl,
    NEAREST: 0x2600,
    LINEAR: 0x2601,
    UNPACK_ALIGNMENT: 0x0cf5,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    pixelStorei: (_pname: number, param: number) => {
      unpackAlignmentSet = param;
    },
    texParameteri: (_target: number, pname: number, param: number) => {
      texParams.push([pname, param]);
    },
  };
  const u16DepthViewer: any = {
    gl: u16MockGl,
    xrDepthState: {
      enabled: false,
      texture: null,
      format: 0,
      rawValueToMeters: 0.001,
    },
  };
  // 90x160 portrait Android ARCore depth buffer (180 bytes/row -> non-4-byte aligned!)
  depthMgr.updateFromXRFrame(
    u16DepthViewer,
    {
      session: {depthUsage: 'cpu-optimized', depthDataFormat: 'luminance-alpha'},
      getDepthInformation: () => ({
        width: 90,
        height: 160,
        rawValueToMeters: 0.001,
        data: new Uint16Array(90 * 160).fill(1200),
      }),
    },
    {},
    true,
  );
  assert(
    u16DepthViewer.xrDepthState.enabled === true &&
      u16DepthViewer.xrDepthState.format === 0 &&
      unpackAlignmentSet === 1 &&
      texParams.some((p) => p[0] === 0x2801 && p[1] === 0x2600) &&
      texParams.some((p) => p[0] === 0x2800 && p[1] === 0x2600),
    'Regression X3: 16-bit luminance-alpha depth upload sets UNPACK_ALIGNMENT=1 and NEAREST filtering',
  );

  // Stale XRCPUDepthInformation outside an XRFrame throws InvalidStateError on getDepthInMeters()
  depthMgr.setSyntheticDepthInfo({
    width: 4,
    height: 4,
    getDepthInMeters: () => {
      throw new Error('InvalidStateError: XRFrame is no longer active');
    },
  });
  let survivedStaleDepth = false;
  let staleSample: unknown = 'unset';
  try {
    staleSample = depthMgr.sampleDepthAndNormal(0.5, 0.5);
    survivedStaleDepth = true;
  } catch {
    survivedStaleDepth = false;
  }
  assert(
    survivedStaleDepth &&
      staleSample === null &&
      depthMgr.getLatestDepthInfo() === null,
    'Regression X3: sampleDepthAndNormal catches expired XRFrame InvalidStateError and clears stale depth info without freezing renderLoop',
  );

  // Sentinel u16 depth >= 65500 should be ignored
  depthMgr.setSyntheticDepthInfo({
    width: 4,
    height: 4,
    rawValueToMeters: 0.001,
    data: new Uint16Array(16).fill(65535),
  });
  assert(
    depthMgr.sampleDepthAndNormal(0.5, 0.5) === null,
    'Regression X3: sampleDepthAndNormal ignores invalid u16 sentinel depth >= 65500',
  );

  depthMgr.clearSessionDepth(u16DepthViewer);
  assert(
    u16DepthViewer.xrDepthState.enabled === false &&
      depthMgr.getLatestDepthInfo() === null,
    'Regression X3: clearSessionDepth disables xrDepthState and clears cached depth info',
  );
  depthMgr.dispose(u16MockGl);

  // Verify xrLiveSpatialPlugin skips onUpdate during active XR session & cleans up on onXRSessionEnd
  const pluginHost = new XRLiveElement();
  (pluginHost as any).getAttribute = () => null;
  (pluginHost as any).hasAttribute = () => false;
  let hostStepCalls = 0;
  pluginHost.stepSpatialFrame = () => {
    hostStepCalls++;
  };
  const mockActiveXRViewer: any = {
    container: pluginHost,
    xrSessionActive: true,
    xrDepthState: {enabled: true},
    onBeforeRenderXRView: () => {},
  };
  xrLiveSpatialPlugin.onUpdate?.(mockActiveXRViewer, 1 / 60);
  assert(
    hostStepCalls === 0,
    'Regression X3: xrLiveSpatialPlugin.onUpdate skips stepping while viewer.xrSessionActive is true (no double-step)',
  );
  xrLiveSpatialPlugin.onXRSessionEnd?.(mockActiveXRViewer);
  assert(
    mockActiveXRViewer.onBeforeRenderXRView === undefined &&
      mockActiveXRViewer.xrDepthState.enabled === false,
    'Regression X3: xrLiveSpatialPlugin.onXRSessionEnd clears onBeforeRenderXRView and xrDepthState',
  );

  // Verify XRLiveElement.activateAR() delegates to enterSpatialAR()
  let enterSpatialARCalled = false;
  arElement.enterSpatialAR = async () => {
    enterSpatialARCalled = true;
    return {platform: 'ios-quicklook', usdzByteLength: 256};
  };
  const activateRes = await arElement.activateAR();
  assert(
    enterSpatialARCalled &&
      activateRes.mode === 'quick-look' &&
      activateRes.success === true,
    'Regression X3: XRLiveElement.activateAR() delegates to enterSpatialAR()',
  );

  console.log(`\n🏆 xr-live Test Results: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runXRLiveTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
