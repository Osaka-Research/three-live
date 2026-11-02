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

import {rayIntersectsTriangle} from '../src/math';
import {
  environmentMapPlugin,
  getEnvironmentSH,
  setEnvironmentSH,
} from '../src/plugins/envmap';
import {
  type AnimationChannel,
  crossFadeTo,
  keyframeAnimationPlugin,
  parseAnimations,
  quatSlerp,
  sampleChannel,
  vec3Lerp,
} from '../src/plugins/keyframes';
import {materialsPlugin} from '../src/plugins/materials';
import {morphPlugin, setMorphTargetWeight} from '../src/plugins/morph';
import {contactShadowPlugin} from '../src/plugins/shadows';
import {webxrPlugin} from '../src/plugins/webxr';
import THREE from '../src/three-author';
import {
  isGLBData,
  mat4Create,
  mat4LookAt,
  mat4Perspective,
  MicroViewer,
  parseGLB,
  registerPlugin,
  resolveNodeWorldMatrices,
  sanitizeTextureUri,
  ThreeView,
  toGLBData,
} from '../src/three-view';

registerPlugin(keyframeAnimationPlugin);

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

async function runThreeViewTests() {
  console.log('🤖 Running three-view Engine Unit Tests...\n');

  // 1. Export check
  assert(ThreeView !== undefined, 'ThreeView class is exported');
  assert(
    MicroViewer === ThreeView,
    'MicroViewer is backwards-compatible alias for ThreeView',
  );
  assert(
    typeof (ThreeView.prototype as any).setCamera === 'function',
    'ThreeView has setCamera method',
  );
  assert(
    typeof (ThreeView.prototype as any).resetCamera === 'function',
    'ThreeView has resetCamera method',
  );
  assert(
    typeof (ThreeView.prototype as any).setInitialCamera === 'function',
    'ThreeView has setInitialCamera method',
  );
  assert(
    typeof (ThreeView.prototype as any).setShadow === 'function',
    'ThreeView has setShadow method',
  );
  assert(
    typeof (ThreeView.prototype as any).getShadowIntensity === 'function',
    'ThreeView has getShadowIntensity method',
  );
  assert(
    typeof (ThreeView.prototype as any).getShadowSoftness === 'function',
    'ThreeView has getShadowSoftness method',
  );
  assert(
    typeof (ThreeView.prototype as any).setToneMapping === 'function',
    'ThreeView has setToneMapping method',
  );
  assert(
    typeof (ThreeView.prototype as any).getToneMapping === 'function',
    'ThreeView has getToneMapping method',
  );
  assert(
    typeof (ThreeView.prototype as any).playAnimation === 'function',
    'ThreeView has playAnimation method',
  );
  assert(
    typeof (ThreeView.prototype as any).pauseAnimation === 'function',
    'ThreeView has pauseAnimation method',
  );
  assert(
    typeof (ThreeView.prototype as any).getAvailableAnimations === 'function',
    'ThreeView has getAvailableAnimations method',
  );
  assert(
    typeof (ThreeView.prototype as any).evaluateAnimation === 'function',
    'ThreeView has evaluateAnimation method',
  );
  assert(
    typeof (ThreeView.prototype as any).setTarget === 'function',
    'ThreeView has setTarget method',
  );
  assert(
    typeof (ThreeView.prototype as any).getTarget === 'function',
    'ThreeView has getTarget method',
  );
  assert(
    typeof (ThreeView.prototype as any).setFieldOfView === 'function',
    'ThreeView has setFieldOfView method',
  );
  assert(
    typeof (ThreeView.prototype as any).getFieldOfView === 'function',
    'ThreeView has getFieldOfView method',
  );
  assert(
    typeof (ThreeView.prototype as any).setOrbitLimits === 'function',
    'ThreeView has setOrbitLimits method',
  );
  assert(
    typeof (ThreeView.prototype as any).getOrbitLimits === 'function',
    'ThreeView has getOrbitLimits method',
  );
  assert(
    typeof (ThreeView.prototype as any).projectPointToScreen === 'function',
    'ThreeView has projectPointToScreen method',
  );
  assert(
    typeof ThreeView.registerDecoder === 'function',
    'ThreeView has static registerDecoder method',
  );
  assert(
    typeof ThreeView.getDecoder === 'function',
    'ThreeView has static getDecoder method',
  );
  assert(
    typeof (ThreeView.prototype as any).setExposure === 'function',
    'ThreeView has setExposure method',
  );
  assert(
    typeof (ThreeView.prototype as any).getExposure === 'function',
    'ThreeView has getExposure method',
  );
  assert(
    (ThreeView.prototype as any).setEnvironmentIntensity === undefined,
    'ThreeView does not expose legacy setEnvironmentIntensity method',
  );
  assert(
    (ThreeView.prototype as any).setCameraTarget === undefined,
    'ThreeView does not expose obsolete setCameraTarget method',
  );

  // 2. glTF Binary (GLB) Parsing & Environment Intensity
  const scene = new THREE.Scene();
  assert(
    scene.environmentIntensity === 1.0,
    'Scene default environmentIntensity is 1.0',
  );
  scene.environmentIntensity = 0.75;
  assert(
    scene.environmentIntensity === 0.75,
    'Scene environmentIntensity can be modified',
  );

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(2, 3, 4),
    new THREE.MeshStandardMaterial({
      color: 0x00ff88,
      roughness: 0.5,
      metalness: 0.5,
    }),
  );
  box.name = 'ViewerTestBox';
  box.position.set(1, 2, 3);
  scene.add(box);

  const ambLight = new THREE.AmbientLight(0x222222, 1.0);
  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(10, 20, 30);
  scene.add(ambLight);
  scene.add(dirLight);

  const glbBytes = scene.toGLB();
  const parsed = parseGLB(glbBytes.buffer);
  assert(parsed.gltf !== null, 'parseGLB parses glTF JSON chunk');
  assert(parsed.bin.byteLength > 0, 'parseGLB parses binary BIN chunk');
  assert(parsed.gltf.meshes.length === 1, 'Parsed GLB contains 1 mesh');
  assert(parsed.gltf.materials.length === 1, 'Parsed GLB contains 1 material');
  assert(parsed.gltf.nodes.length >= 1, 'Parsed GLB contains nodes');
  assert(
    parsed.gltf.asset?.extras?.environmentIntensity === 0.75,
    'Parsed GLB preserves environmentIntensity in asset.extras',
  );

  // 3. Option B Reactive Matrix Generation & Viewer Compatibility
  const transforms = scene.getMeshTransforms();
  assert(transforms instanceof Map, 'scene.getMeshTransforms produces Map');
  assert(transforms.has('ViewerTestBox'), 'Transforms map contains named mesh');
  const matrix = transforms.get('ViewerTestBox')!;
  assert(
    matrix[12] === 1 && matrix[13] === 2 && matrix[14] === 3,
    'Matrix translation coordinates match position',
  );

  // 4. In-memory AST direct ingestion
  const ast = scene.toCanvas3D();
  assert(ast.gltf !== null, 'toCanvas3D returns gltf AST');
  assert(ast.bin instanceof ArrayBuffer, 'toCanvas3D returns bin buffer');
  assert(ast.lights!.length === 2, 'toCanvas3D returns 2 dynamic lights');
  assert(
    ast.environmentIntensity === 0.75,
    'toCanvas3D returns environmentIntensity',
  );

  // 5. Centralized format validation and normalization (toGLBData & isGLBData)
  assert(isGLBData(ast), 'isGLBData returns true for GLBData AST');
  assert(
    !isGLBData(glbBytes.buffer),
    'isGLBData returns false for ArrayBuffer',
  );
  assert(!isGLBData(glbBytes), 'isGLBData returns false for Uint8Array');
  assert(!isGLBData(null), 'isGLBData returns false for null');
  assert(!isGLBData({}), 'isGLBData returns false for empty object');

  assert(toGLBData(ast) === ast, 'toGLBData preserves in-memory AST reference');
  const normalizedFromBuf = toGLBData(glbBytes.buffer);
  assert(
    isGLBData(normalizedFromBuf) && normalizedFromBuf.gltf.meshes.length === 1,
    'toGLBData parses ArrayBuffer into valid GLBData',
  );
  const normalizedFromView = toGLBData(glbBytes);
  assert(
    isGLBData(normalizedFromView) &&
      normalizedFromView.gltf.meshes.length === 1,
    'toGLBData parses ArrayBufferView into valid GLBData',
  );

  let threwError = false;
  try {
    toGLBData(12345 as any);
  } catch (e) {
    threwError = e instanceof TypeError;
  }
  assert(threwError, 'toGLBData throws TypeError on invalid payload');

  // 6. Hierarchical glTF node transform accumulation (resolveNodeWorldMatrices)
  const mockGltf = {
    nodes: [
      // Node 0: Root positioned at (10, 0, 0), has child 1
      {
        name: 'Root',
        translation: [10, 0, 0],
        children: [1],
      },
      // Node 1: Child positioned at (0, 5, 0), rotated 90 deg around Y, has child 2
      {
        name: 'Arm',
        translation: [0, 5, 0],
        // 90 deg around Y axis: q = [0, sin(45°), 0, cos(45°)] = [0, 0.7071068, 0, 0.7071068]
        rotation: [0, 0.7071068, 0, 0.7071068],
        children: [2],
      },
      // Node 2: Grandchild positioned locally at (0, 0, 2)
      {
        name: 'Hand',
        translation: [0, 0, 2],
        mesh: 0,
      },
    ],
    scenes: [{nodes: [0]}],
    scene: 0,
  };

  const worldMats = resolveNodeWorldMatrices(mockGltf);
  assert(
    worldMats.length === 3,
    'resolveNodeWorldMatrices returns matrices for all 3 nodes',
  );
  assert(
    worldMats[0][12] === 10 && worldMats[0][13] === 0 && worldMats[0][14] === 0,
    'Root node world position is (10, 0, 0)',
  );
  assert(
    worldMats[1][12] === 10 && worldMats[1][13] === 5 && worldMats[1][14] === 0,
    'Arm node world position is (10, 5, 0)',
  );
  const handX = Math.round(worldMats[2][12]);
  const handY = Math.round(worldMats[2][13]);
  const handZ = Math.round(worldMats[2][14]);
  assert(
    handX === 12 && handY === 5 && handZ === 0,
    `Hand node world position correctly accumulates parent transforms: (${handX}, ${handY}, ${handZ}) === (12, 5, 0)`,
  );

  // 7. Vector and Quaternion Interpolation Math (Phase 2)
  const vOut = [0, 0, 0];
  vec3Lerp(vOut, [0, 10, 20], [10, 20, 40], 0.5);
  assert(
    vOut[0] === 5 && vOut[1] === 15 && vOut[2] === 30,
    'vec3Lerp correctly linearly interpolates between 3D vectors at t=0.5',
  );

  const qOut = [0, 0, 0, 1];
  // 0 deg around Y: [0, 0, 0, 1]
  // 90 deg around Y: [0, 0.7071068, 0, 0.7071068]
  quatSlerp(qOut, [0, 0, 0, 1], [0, 0.7071068, 0, 0.7071068], 0.5);
  // Expected at 45 deg: [0, sin(22.5°), 0, cos(22.5°)] ≈ [0, 0.38268, 0, 0.92388]
  const qY = Math.round(qOut[1] * 1000) / 1000;
  const qW = Math.round(qOut[3] * 1000) / 1000;
  assert(
    qY === 0.383 && qW === 0.924,
    `quatSlerp correctly spherically interpolates quaternions at t=0.5: (${qY}, ${qW})`,
  );

  // 8. Animation Track Channel Sampling (Phase 2)
  const testChannel: AnimationChannel = {
    nodeIndex: 0,
    path: 'translation',
    times: new Float32Array([0.0, 1.0, 2.0]),
    values: new Float32Array([0, 0, 0, 10, 20, 30, 100, 200, 300]),
    interpolation: 'LINEAR',
  };
  const sampled = [0, 0, 0];
  sampleChannel(testChannel, 0.0, sampled);
  assert(
    sampled[0] === 0 && sampled[1] === 0 && sampled[2] === 0,
    'sampleChannel correctly samples at boundary keyframe t=0.0',
  );
  sampleChannel(testChannel, 0.5, sampled);
  assert(
    sampled[0] === 5 && sampled[1] === 10 && sampled[2] === 15,
    'sampleChannel correctly linearly interpolates at t=0.5',
  );
  sampleChannel(testChannel, 1.5, sampled);
  assert(
    sampled[0] === 55 && sampled[1] === 110 && sampled[2] === 165,
    'sampleChannel correctly linearly interpolates at t=1.5',
  );
  sampleChannel(testChannel, 3.0, sampled);
  assert(
    sampled[0] === 100 && sampled[1] === 200 && sampled[2] === 300,
    'sampleChannel clamps to last keyframe when t >= maxTime',
  );

  // 9. glTF Animation Ingestion (parseAnimations)
  const animTimes = new Float32Array([0.0, 1.0]);
  const animValues = new Float32Array([0, 0, 0, 10, 0, 0]);
  const binBuf = new ArrayBuffer(animTimes.byteLength + animValues.byteLength);
  new Float32Array(binBuf, 0, 2).set(animTimes);
  new Float32Array(binBuf, animTimes.byteLength, 6).set(animValues);

  const mockAnimGltf = {
    nodes: [{name: 'AnimatedNode'}],
    accessors: [
      {bufferView: 0, byteOffset: 0, count: 2, componentType: 5126},
      {bufferView: 1, byteOffset: 0, count: 2, componentType: 5126},
    ],
    bufferViews: [
      {byteOffset: 0, byteLength: animTimes.byteLength},
      {byteOffset: animTimes.byteLength, byteLength: animValues.byteLength},
    ],
    animations: [
      {
        name: 'Slide',
        samplers: [{input: 0, output: 1, interpolation: 'LINEAR'}],
        channels: [{sampler: 0, target: {node: 0, path: 'translation'}}],
      },
    ],
  };
  const parsedClips = parseAnimations(mockAnimGltf, binBuf);
  assert(parsedClips.length === 1, 'parseAnimations parses 1 clip');
  assert(parsedClips[0].name === 'Slide', 'Parsed clip name matches');
  assert(parsedClips[0].duration === 1.0, 'Parsed clip duration is 1.0s');
  assert(
    parsedClips[0].channels.length === 1,
    'Parsed clip contains 1 channel',
  );
  assert(
    parsedClips[0].channels[0].path === 'translation',
    'Parsed channel path is translation',
  );

  // 10. Pluggable Decoders & GLB Extensions Validation
  function createMockGLB(json: any): ArrayBuffer {
    const jsonStr = JSON.stringify(json);
    const jsonBytes = Buffer.from(jsonStr, 'utf8');
    const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
    const jsonChunkLen = jsonBytes.length + jsonPadding;

    const totalLen = 12 + 8 + jsonChunkLen;
    const buffer = new ArrayBuffer(totalLen);
    const dv = new DataView(buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, totalLen, true);

    dv.setUint32(12, jsonChunkLen, true);
    dv.setUint32(16, 0x4e4f534a, true);
    const u8 = new Uint8Array(buffer);
    u8.set(jsonBytes, 20);
    for (let i = 0; i < jsonPadding; i++) {
      u8[20 + jsonBytes.length + i] = 0x20;
    }
    return buffer;
  }

  const dracoGlb = createMockGLB({
    asset: {version: '2.0'},
    extensionsRequired: ['KHR_draco_mesh_compression'],
  });

  let threwMissingDraco = false;
  try {
    parseGLB(dracoGlb);
  } catch (e: any) {
    threwMissingDraco = Boolean(
      e?.message?.includes('KHR_draco_mesh_compression'),
    );
  }
  assert(
    threwMissingDraco,
    'parseGLB throws actionable error when KHR_draco_mesh_compression decoder is missing',
  );

  let mockDecodeCalled = false;
  ThreeView.registerDecoder('draco', {
    decodePrimitive: () => {
      mockDecodeCalled = true;
    },
  });
  assert(
    ThreeView.getDecoder('draco') !== undefined,
    'ThreeView.getDecoder returns registered draco decoder',
  );

  const parsedDracoGlb = parseGLB(dracoGlb);
  assert(
    parsedDracoGlb.gltf !== null,
    'parseGLB succeeds when required decoder is registered',
  );

  // 11. projectPointToScreen Projection & Occlusion Culling
  const proj = mat4Create();
  const view = mat4Create();
  mat4Perspective(proj, Math.PI / 4, 800 / 600, 0.1, 100);
  mat4LookAt(view, [0, 0, 3], [0, 0, 0], [0, 1, 0]);

  const mockViewerContext = {
    projMatrix: proj,
    viewMatrix: view,
    canvas: {
      getBoundingClientRect: () => ({width: 800, height: 600}),
      clientWidth: 800,
      clientHeight: 600,
      width: 800,
      height: 600,
    },
    customTarget: null,
    bounds: {center: [0, 0, 0], radius: 1},
    currDistance: 3,
    currPhi: 0,
    currTheta: 0,
  };

  // Center point facing camera
  const frontProj = (ThreeView.prototype as any).projectPointToScreen.call(
    mockViewerContext,
    [0, 0, 0],
    [0, 0, 1],
  );
  assert(
    Math.round(frontProj.x) === 400 && Math.round(frontProj.y) === 300,
    `Front point projects to screen center (400, 300): got (${Math.round(frontProj.x)}, ${Math.round(frontProj.y)})`,
  );
  assert(frontProj.visible === true, 'Front point facing camera is visible');

  // Center point facing away from camera (occluded)
  const backProj = (ThreeView.prototype as any).projectPointToScreen.call(
    mockViewerContext,
    [0, 0, 0],
    [0, 0, -1],
  );
  assert(
    backProj.visible === false,
    'Surface point facing away from camera is occluded (visible: false)',
  );

  // Point behind camera
  const behindProj = (ThreeView.prototype as any).projectPointToScreen.call(
    mockViewerContext,
    [0, 0, 5],
  );
  assert(
    behindProj.visible === false,
    'Point behind camera is culled (visible: false)',
  );

  // 14. Feature 1A: Luxury Optical Materials Plugin (Transmission, Dispersion, Volume, IOR, Iridescence)
  const dummyVS =
    '#version 300 es\nuniform mat4 uMVP,uModel;\nvoid main(){vec4 world=uModel*vec4(aPosition,1.0);gl_Position=uMVP*vec4(aPosition,1.0);}';
  const dummyFS =
    '#version 300 es\nout vec4 fragColor;\nvoid main(){vec3 F0=mix(vec3(0.04),base.rgb,metallic);vec3 F=F_SchlickRoughness(F0,roughness,NoV);vec3 diffuseIBL=kD*base.rgb*(uAmbientColor+envDiffuse*0.5)*occ;fragColor=vec4(color,base.a);}';

  const opticalMatDef = {
    name: 'CrystalGlass',
    extensions: {
      KHR_materials_transmission: {transmissionFactor: 0.92},
      KHR_materials_volume: {
        thicknessFactor: 0.6,
        attenuationDistance: 0.4,
        attenuationColor: [0.8, 0.9, 1.0],
      },
      KHR_materials_ior: {ior: 1.54},
      KHR_materials_dispersion: {dispersion: 0.35},
      KHR_materials_iridescence: {
        iridescenceFactor: 0.75,
        iridescenceIor: 1.33,
      },
    },
  };
  const resolvedOptical = materialsPlugin.onResolveShader?.(
    {},
    opticalMatDef,
    dummyVS,
    dummyFS,
  );
  assert(
    !!resolvedOptical && resolvedOptical.fs.includes('uTransmissionTex'),
    'materialsPlugin injects uTransmissionTex uniform for KHR_materials_transmission',
  );
  assert(
    !!resolvedOptical &&
      resolvedOptical.fs.includes('refractedR') &&
      resolvedOptical.fs.includes('refractedB'),
    'materialsPlugin injects Cauchy RGB chromatic dispersion rays for KHR_materials_dispersion',
  );
  assert(
    !!resolvedOptical && resolvedOptical.fs.includes('volumeAtten'),
    'materialsPlugin injects Beer-Lambert volume absorption for KHR_materials_volume',
  );
  assert(
    !!resolvedOptical && resolvedOptical.fs.includes('iridColor'),
    'materialsPlugin injects thin-film interference for KHR_materials_iridescence',
  );

  // 15. Feature 1B: Radiance Maps & True IBL Plugin (Karis Split-Sum BRDF & Spherical Harmonics)
  const shTarget = {};
  const shData = new Float32Array(27);
  shData[0] = 0.85;
  setEnvironmentSH(shTarget, shData);
  const retrievedSH = getEnvironmentSH(shTarget);
  assert(
    retrievedSH !== undefined &&
      retrievedSH.length === 27 &&
      Math.abs(retrievedSH[0] - 0.85) < 1e-5,
    'setEnvironmentSH / getEnvironmentSH stores and retrieves 9-band RGB Spherical Harmonics',
  );

  const iblBaseFS =
    '#version 300 es\nout vec4 fragColor;\nvoid main(){\nif(uHasEnvironmentMap==1){\nspecularIBL=texture(uEnvironmentMap,equirectangularUV(R)).rgb*(F*brdf.x+brdf.y);\nenvDiffuse=texture(uEnvironmentMap,equirectangularUV(N)).rgb;\n}\nfragColor=vec4(color,base.a);}';
  const resolvedIBL = environmentMapPlugin.onResolveShader?.(
    {},
    {},
    dummyVS,
    iblBaseFS,
  );
  assert(
    !!resolvedIBL &&
      resolvedIBL.fs.includes('evalSHIrradiance') &&
      resolvedIBL.fs.includes('integrateBRDFApprox'),
    'environmentMapPlugin injects evalSHIrradiance and Karis integrateBRDFApprox into fragment shader',
  );

  // 16. Feature 1C: Morph Targets Data Texture & Animation Mixer Cross-Fading
  const morphPrimDef = {
    targets: [{POSITION: 0}, {POSITION: 1}],
  };
  const resolvedMorph = morphPlugin.onResolveShader?.(
    morphPrimDef,
    {},
    dummyVS,
    dummyFS,
  );
  assert(
    !!resolvedMorph &&
      resolvedMorph.vs.includes('uMorphDeltasTex') &&
      resolvedMorph.vs.includes('texelFetch'),
    'morphPlugin injects uMorphDeltasTex and texelFetch vertex displacement by gl_VertexID',
  );

  const mockViewerForMixer: any = {
    isPlayingAnimation: true,
    animationTime: 0,
    gltf: {nodes: [{name: 'Root'}]},
    initialNodeTransforms: [{t: [0, 0, 0], r: [0, 0, 0, 1], s: [1, 1, 1]}],
    meshes: [
      {
        nodeIndex: 0,
        transform: mat4Create(),
        normalMatrix: new Float32Array(9),
        primitives: [
          {
            pluginData: {
              morph: {numTargets: 2, weights: new Float32Array([0, 0])},
            },
          },
        ],
      },
    ],
    animations: [
      {
        name: 'Idle',
        duration: 1.0,
        channels: [
          {
            nodeIndex: 0,
            path: 'translation',
            times: new Float32Array([0, 1]),
            values: new Float32Array([0, 0, 0, 0, 0, 0]),
            interpolation: 'LINEAR',
          },
        ],
      },
      {
        name: 'Walk',
        duration: 1.0,
        channels: [
          {
            nodeIndex: 0,
            path: 'translation',
            times: new Float32Array([0, 1]),
            values: new Float32Array([10, 0, 0, 10, 0, 0]),
            interpolation: 'LINEAR',
          },
        ],
      },
    ],
  };
  mockViewerForMixer.currentClip = mockViewerForMixer.animations[0];
  crossFadeTo(mockViewerForMixer, 'Walk', 0.5);
  keyframeAnimationPlugin.onUpdate?.(mockViewerForMixer, 0.25);
  const blendedX = mockViewerForMixer.meshes[0].transform[12];
  assert(
    Math.abs(blendedX - 5.0) < 0.1,
    `crossFadeTo smoothly blends 50% between Idle (x=0) and Walk (x=10) at t=0.25s: got x=${blendedX.toFixed(2)}`,
  );

  setMorphTargetWeight(mockViewerForMixer, 1, 0.77);
  assert(
    Math.abs(
      mockViewerForMixer.meshes[0].primitives[0].pluginData.morph.weights[1] -
        0.77,
    ) < 1e-4,
    'setMorphTargetWeight updates primitive morph weights array',
  );

  // 17. Features 2.1 - 2.3: In-Browser WebXR Suite Configuration
  let shieldedSelect = false;
  const customOverlay = {
    addEventListener: (_type: string, cb: any) => {
      cb({
        preventDefault: () => {
          shieldedSelect = true;
        },
      });
    },
  };
  const mockHostWithoutSlot = {
    querySelector: () => null,
  };
  const noSlotInit: any = {optionalFeatures: []};
  webxrPlugin.onConfigureXRSessionInit?.(mockHostWithoutSlot, noSlotInit);
  assert(
    noSlotInit.optionalFeatures.includes('hit-test') &&
      noSlotInit.optionalFeatures.includes('light-estimation') &&
      !noSlotInit.domOverlay,
    'webxrPlugin adds hit-test and light-estimation without binding opaque host element when no [slot="ar-overlay"] exists',
  );

  const mockElement = {
    querySelector: (sel: string) =>
      sel === '[slot="ar-overlay"]' ? customOverlay : null,
  };
  const sessionInit: any = {optionalFeatures: []};
  webxrPlugin.onConfigureXRSessionInit?.(mockElement, sessionInit);
  assert(
    sessionInit.optionalFeatures.includes('hit-test') &&
      sessionInit.optionalFeatures.includes('light-estimation') &&
      sessionInit.optionalFeatures.includes('dom-overlay'),
    'webxrPlugin adds hit-test, light-estimation, and dom-overlay when [slot="ar-overlay"] is present',
  );
  assert(
    sessionInit.domOverlay?.root === customOverlay && shieldedSelect === true,
    'webxrPlugin sets domOverlay.root to [slot="ar-overlay"] and shields beforexrselect events',
  );

  // 18. Regression Test: Mesh Inspector Ray-Triangle Intersection (OuterOrbitRing & QuantumCore)
  const orbitRingGeo = new THREE.TorusGeometry(1.95, 0.06, 16, 64);
  const orbitRingPos = orbitRingGeo.attributes.position.array;
  const orbitRingIdx = orbitRingGeo.index!.array;
  let orbitRingHits = 0;
  // Test a ray directed at the torus ring at (x=1.95, y=0, z=0) from camera at (1.95, 0, 5)
  const ringHit = {
    distance: Infinity,
    point: [0, 0, 0] as [number, number, number],
    normal: [0, 1, 0] as [number, number, number],
  };
  for (let t = 0; t < orbitRingIdx.length / 3; t++) {
    const i0 = orbitRingIdx[t * 3];
    const i1 = orbitRingIdx[t * 3 + 1];
    const i2 = orbitRingIdx[t * 3 + 2];
    if (
      rayIntersectsTriangle(
        1.95,
        0.01,
        5.0,
        0,
        0,
        -1,
        orbitRingPos[i0 * 3],
        orbitRingPos[i0 * 3 + 1],
        orbitRingPos[i0 * 3 + 2],
        orbitRingPos[i1 * 3],
        orbitRingPos[i1 * 3 + 1],
        orbitRingPos[i1 * 3 + 2],
        orbitRingPos[i2 * 3],
        orbitRingPos[i2 * 3 + 1],
        orbitRingPos[i2 * 3 + 2],
        ringHit,
        1e-4,
      )
    ) {
      orbitRingHits++;
    }
  }
  assert(
    orbitRingHits > 0 &&
      isFinite(ringHit.distance) &&
      ringHit.distance > 4.0 &&
      ringHit.distance < 5.0,
    `rayIntersectsTriangle accurately hits OuterOrbitRing torus geometry: distance=${ringHit.distance.toFixed(3)}`,
  );

  const quantumCoreGeo = new THREE.SphereGeometry(0.95, 48, 48);
  const corePos = quantumCoreGeo.attributes.position.array;
  const coreIdx = quantumCoreGeo.index!.array;
  const coreHit = {
    distance: Infinity,
    point: [0, 0, 0] as [number, number, number],
    normal: [0, 1, 0] as [number, number, number],
  };
  // Ray targeting off-equator upper hemisphere of QuantumCore (x=0.3, y=0.6, z=5 -> dir=[0,0,-1])
  for (let t = 0; t < coreIdx.length / 3; t++) {
    const i0 = coreIdx[t * 3];
    const i1 = coreIdx[t * 3 + 1];
    const i2 = coreIdx[t * 3 + 2];
    rayIntersectsTriangle(
      0.3,
      0.6,
      5.0,
      0,
      0,
      -1,
      corePos[i0 * 3],
      corePos[i0 * 3 + 1],
      corePos[i0 * 3 + 2],
      corePos[i1 * 3],
      corePos[i1 * 3 + 1],
      corePos[i1 * 3 + 2],
      corePos[i2 * 3],
      corePos[i2 * 3 + 1],
      corePos[i2 * 3 + 2],
      coreHit,
      1e-4,
    );
  }
  assert(
    isFinite(coreHit.distance) &&
      Math.abs(coreHit.point[0] - 0.3) < 0.05 &&
      Math.abs(coreHit.point[1] - 0.6) < 0.05,
    `rayIntersectsTriangle accurately hits off-equator QuantumCore sphere geometry: point=[${coreHit.point.map((n) => n.toFixed(2)).join(', ')}]`,
  );

  // 15. Multi-file JSON .gltf helpful error detection in parseGLB
  let gltfJsonError = '';
  try {
    const jsonBytes = new TextEncoder().encode('{"asset":{"version":"2.0"}}');
    parseGLB(jsonBytes.buffer);
  } catch (e: any) {
    gltfJsonError = e.message || String(e);
  }
  assert(
    gltfJsonError.includes('Multi-file JSON .gltf is not supported'),
    'parseGLB throws helpful error message when given JSON .gltf bytes',
  );

  // 16. Imperative Camera, Material Editing, and Screen-Space Raycasting APIs
  const mockCanvas: any = {
    width: 400,
    height: 400,
    clientWidth: 400,
    clientHeight: 400,
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 400,
    }),
    getContext: () =>
      new Proxy(
        {
          canvas: {width: 400, height: 400},
          getShaderParameter: () => true,
          getProgramParameter: () => true,
          getAttribLocation: () => 0,
        },
        {
          get(target: any, prop: string) {
            if (prop in target) return target[prop];
            return () => ({});
          },
        },
      ),
  };

  const viewInstance = new ThreeView(mockCanvas, mockCanvas, {
    autoRotate: false,
  });
  await viewInstance.loadModel(glbBytes.buffer);

  // Camera state APIs
  viewInstance.setCamera(30, 60, 4.0);
  viewInstance.jumpCameraToGoal();
  const orbit = viewInstance.getCameraOrbit();
  assert(
    Math.abs(orbit.theta - (30 * Math.PI) / 180) < 1e-4 &&
      Math.abs(orbit.phi - (60 * Math.PI) / 180) < 1e-4 &&
      Math.abs(orbit.radius - 4.0) < 1e-4,
    'getCameraOrbit returns spherical coordinates after jumpCameraToGoal',
  );
  const target = viewInstance.getCameraTarget();
  assert(
    typeof target.x === 'number' &&
      typeof target.y === 'number' &&
      typeof target.z === 'number',
    'getCameraTarget returns 3D target coordinates',
  );

  // Interactive toggle
  assert(
    viewInstance.isInteractive() === true,
    'Interactive is true by default',
  );
  viewInstance.setInteractive(false);
  assert(
    viewInstance.isInteractive() === false,
    'setInteractive(false) disables interaction',
  );

  // Material proxy editing
  const materials = viewInstance.getModelMaterials();
  assert(materials.length === 1, 'getModelMaterials returns 1 material proxy');
  materials[0].pbrMetallicRoughness.setBaseColorFactor([1.0, 0.2, 0.3, 1.0]);
  materials[0].pbrMetallicRoughness.setMetallicFactor(0.9);
  materials[0].pbrMetallicRoughness.setRoughnessFactor(0.1);
  assert(
    Math.abs(materials[0].pbrMetallicRoughness.baseColorFactor[0] - 1.0) <
      1e-4 &&
      Math.abs(materials[0].pbrMetallicRoughness.metallicFactor - 0.9) < 1e-4 &&
      Math.abs(materials[0].pbrMetallicRoughness.roughnessFactor - 0.1) < 1e-4,
    'Material proxy updates baseColorFactor, metallicFactor, and roughnessFactor',
  );

  // Screen-space raycast (center of canvas looking at box)
  viewInstance.setTarget(1, 2, 3);
  viewInstance.setCamera(0, 0, 5.0);
  viewInstance.jumpCameraToGoal();
  const hitCenter = viewInstance.raycastFromScreenPoint(200, 200);
  assert(
    hitCenter !== null && hitCenter.meshName === 'ViewerTestBox',
    `raycastFromScreenPoint hits ViewerTestBox at center of screen: meshName=${hitCenter?.meshName}`,
  );

  // 17. <model-viewer>-compatible Turntable Auto-Rotate (turntableRotation, resetTurntableRotation, autoRotateDelay)
  const defaultView = new ThreeView(mockCanvas, mockCanvas);
  assert(
    defaultView.getAutoRotate() === false,
    'ThreeView defaults autoRotate to false (matching <model-viewer>)',
  );
  assert(
    Math.abs(defaultView.getAutoRotateSpeed() - Math.PI / 6) < 1e-5,
    'ThreeView defaults autoRotateSpeed to 30deg/s (Math.PI / 6 rad/s)',
  );
  assert(
    defaultView.getAutoRotateDelay() === 3000,
    'ThreeView defaults autoRotateDelay to 3000ms',
  );

  viewInstance.setAutoRotate(true);
  viewInstance.setAutoRotateSpeed(Math.PI / 2); // 90 deg/s
  viewInstance.setAutoRotateDelay(1000);
  const thetaBeforeSpin = viewInstance.getCameraOrbit().theta;
  (viewInstance as any).update(1.0); // 1 second step -> +PI/2 rad turntable rotation
  assert(
    Math.abs(viewInstance.turntableRotation - Math.PI / 2) < 1e-4,
    `auto-rotate increments turntableRotation by speed*dt: got ${viewInstance.turntableRotation.toFixed(4)}`,
  );
  assert(
    Math.abs(viewInstance.getCameraOrbit().theta - thetaBeforeSpin) < 1e-4,
    'auto-rotate rotates model on turntable without orbiting camera theta',
  );
  assert(
    Math.abs(viewInstance.modelRootMatrix[0] - Math.cos(Math.PI / 2)) < 1e-4 &&
      Math.abs(viewInstance.modelRootMatrix[8] - Math.sin(Math.PI / 2)) < 1e-4,
    'turntableRotation updates modelRootMatrix yaw around bounds.center',
  );

  // Verify autoRotateDelay pauses turntable rotation after user interaction
  (viewInstance as any).lastInteractionTime =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  (viewInstance as any).update(0.5);
  assert(
    Math.abs(viewInstance.turntableRotation - Math.PI / 2) < 1e-4,
    'auto-rotate pauses while within autoRotateDelay window after user interaction',
  );

  viewInstance.resetTurntableRotation(0.25);
  assert(
    Math.abs(viewInstance.turntableRotation - 0.25) < 1e-5 &&
      Math.abs(viewInstance.modelRootMatrix[0] - Math.cos(0.25)) < 1e-4,
    'resetTurntableRotation(theta) sets turntableRotation and updates modelRootMatrix',
  );
  viewInstance.resetTurntableRotation();
  assert(
    viewInstance.turntableRotation === 0 &&
      Math.abs(viewInstance.modelRootMatrix[0] - 1.0) < 1e-5,
    'resetTurntableRotation() resets turntableRotation to 0 and modelRootMatrix to identity',
  );

  // 18. Per-Object Dynamic Contact Shadows (contactShadowPlugin)
  const shadowQuads: Float32Array[] = [];
  const shadowUniforms: Array<{name: string; val: number}> = [];
  const shadowGl: any = new Proxy(
    {
      canvas: {width: 400, height: 400},
      getShaderParameter: () => true,
      getProgramParameter: () => true,
      getUniformLocation: (_prog: any, name: string) => ({name}),
      bufferSubData: (_target: number, _offset: number, data: Float32Array) => {
        shadowQuads.push(new Float32Array(data));
      },
      uniform1f: (loc: any, val: number) => {
        if (loc?.name) shadowUniforms.push({name: loc.name, val});
      },
    },
    {
      get(target: any, prop: string) {
        if (prop in target) return target[prop];
        return () => ({});
      },
    },
  );

  const shadowScene = new THREE.Scene();
  // Resting object on tabletop at (-0.2, 0.05, 0.0)
  const restingBox = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.1, 0.1),
    new THREE.MeshStandardMaterial({color: 0xffaa00}),
  );
  restingBox.name = 'RestingBox';
  restingBox.position.set(-0.2, 0.05, 0.0);
  shadowScene.add(restingBox);

  // Concentric ring around RestingBox at (-0.2, 0.05, 0.0) -> should merge into same shadow cluster
  const concentricRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.08, 0.01, 8, 16),
    new THREE.MeshStandardMaterial({color: 0x00ffcc}),
  );
  concentricRing.name = 'ConcentricRing';
  concentricRing.position.set(-0.2, 0.05, 0.0);
  shadowScene.add(concentricRing);

  // Floating sphere above tabletop at (+0.25, 0.40, 0.0)
  const floatingOrb = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 12),
    new THREE.MeshStandardMaterial({color: 0x38bdf8}),
  );
  floatingOrb.name = 'FloatingOrb';
  floatingOrb.position.set(0.25, 0.4, 0.0);
  shadowScene.add(floatingOrb);

  const shadowView = new ThreeView(
    {
      ...mockCanvas,
      getContext: () => shadowGl,
    },
    {
      ...mockCanvas,
      getContext: () => shadowGl,
    },
    {shadowIntensity: 0.8, shadowSoftness: 0.4},
  );
  await shadowView.loadModel(shadowScene.toGLB().buffer);
  // Simulate living room backdrop active so coffee table surface (y ≈ 0.003) is used
  (shadowView as any).backdropMeshes = [
    {
      name: 'LivingRoomBackdrop',
      transform: mat4Create(),
      normalMatrix: new Float32Array(9),
      primitives: [],
    },
  ];

  shadowQuads.length = 0;
  shadowUniforms.length = 0;
  contactShadowPlugin.onAfterRender!(shadowGl, shadowView, mat4Create());

  assert(
    shadowQuads.length === 2,
    `contactShadowPlugin clusters concentric meshes and draws 2 per-object shadow quads (got ${shadowQuads.length})`,
  );
  const intensities = shadowUniforms
    .filter((u) => u.name === 'uShadowIntensity')
    .map((u) => u.val);
  const softnesses = shadowUniforms
    .filter((u) => u.name === 'uShadowSoftness')
    .map((u) => u.val);
  assert(
    intensities.length === 2 && intensities[0] > intensities[1],
    `Resting object casts darker contact shadow (${intensities[0]?.toFixed(3)}) than floating orb (${intensities[1]?.toFixed(3)})`,
  );
  assert(
    softnesses.length === 2 && softnesses[1] > softnesses[0],
    `Floating orb casts softer drop shadow (${softnesses[1]?.toFixed(3)}) than resting object (${softnesses[0]?.toFixed(3)})`,
  );
  assert(
    Math.abs(shadowQuads[0][1] - 0.003) < 1e-4 &&
      Math.abs(shadowQuads[1][1] - 0.003) < 1e-4,
    'Per-object contact shadows project onto coffee table surface (y = 0.003)',
  );

  // Verify shadow quads rotate across tabletop when turntableRotation is applied
  const initialOrbShadowCenterZ =
    (shadowQuads[1][2] + shadowQuads[1][12]) * 0.5;
  shadowQuads.length = 0;
  shadowView.resetTurntableRotation(Math.PI / 2);
  contactShadowPlugin.onAfterRender!(shadowGl, shadowView, mat4Create());
  const rotatedOrbShadowCenterZ =
    (shadowQuads[1][2] + shadowQuads[1][12]) * 0.5;
  assert(
    Math.abs(rotatedOrbShadowCenterZ - initialOrbShadowCenterZ) > 0.1,
    `Per-object shadows follow turntable rotation across tabletop (z shifted from ${initialOrbShadowCenterZ.toFixed(2)} to ${rotatedOrbShadowCenterZ.toFixed(2)})`,
  );

  // Verify built-in KHR_materials_clearcoat parsing on ThreeView primitives
  const clearcoatScene = new THREE.Scene();
  const clearcoatSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 8),
    new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      metalness: 0.1,
      roughness: 0.15,
      clearcoat: 0.9,
      clearcoatRoughness: 0.08,
    }),
  );
  clearcoatSphere.name = 'ClearcoatOrb';
  clearcoatScene.add(clearcoatSphere);
  await shadowView.loadModel(clearcoatScene.toGLB().buffer);
  const ccPrim = (shadowView as any).meshes[0]?.primitives[0];
  assert(
    ccPrim &&
      Math.abs(ccPrim.clearcoat - 0.9) < 1e-4 &&
      Math.abs(ccPrim.clearcoatRoughness - 0.08) < 1e-4,
    'ThreeView parses KHR_materials_clearcoat factor and roughness into PrimitiveGpu',
  );

  // P1-1 (WEB-09): glTF images[].uri scheme allowlist
  assert(
    sanitizeTextureUri('https://example.com/tex.png') ===
      'https://example.com/tex.png',
    'sanitizeTextureUri allows https:// URIs',
  );
  assert(
    sanitizeTextureUri('blob:https://example.com/1234') ===
      'blob:https://example.com/1234',
    'sanitizeTextureUri allows blob: URIs',
  );
  assert(
    sanitizeTextureUri('data:image/png;base64,iVBORw0KGgo=') !== null &&
      sanitizeTextureUri('data:image/jpeg;base64,/9j/') !== null &&
      sanitizeTextureUri('data:image/webp;base64,UklGR') !== null &&
      sanitizeTextureUri('data:image/ktx2;base64,AAAA') !== null,
    'sanitizeTextureUri allows raster/compressed data:image/* URIs',
  );
  assert(
    sanitizeTextureUri('textures/albedo.png') === 'textures/albedo.png',
    'sanitizeTextureUri allows clean relative texture paths',
  );
  for (const blockedUri of [
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    '//attacker.example/steal.png',
    '../secrets/key.png',
    'https://example.com/bad\x00.png',
  ]) {
    assert(
      sanitizeTextureUri(blockedUri) === null,
      `sanitizeTextureUri blocks unsafe URI: ${blockedUri.slice(0, 28)}`,
    );
  }

  console.log(
    `\n🏆 three-view Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runThreeViewTests();
