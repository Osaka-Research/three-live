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
  HOST_BLOOM_DEFAULT_RADIUS,
  HOST_BLOOM_DEFAULT_THRESHOLD,
} from '../src/constants';
import {
  mat3NormalFromMat4,
  mat4Multiply,
  rayIntersectsTriangle,
} from '../src/math';
import {
  environmentMapPlugin,
  getEnvironmentSH,
  setEnvironmentSH,
} from '../src/plugins/envmap';
import {
  ikPlugin,
  IKSolver,
  quatFromUnitVectors,
  solveFABRIK,
  solveTwoBoneIK,
} from '../src/plugins/ik';
import {
  crossFadeTo,
  keyframeAnimationPlugin,
  parseAnimations,
  quatSlerp,
  sampleChannel,
  vec3Lerp,
  type AnimationChannel,
} from '../src/plugins/keyframes';
import {getLodController, lodPlugin} from '../src/plugins/lod';
import {materialsPlugin} from '../src/plugins/materials';
import {morphPlugin, setMorphTargetWeight} from '../src/plugins/morph';
import {
  computeOutlineClipOffset,
  evaluateKawaseBloom,
  parseHexRgb,
  postprocessingPlugin,
  resolveMeshOutline,
} from '../src/plugins/postprocessing';
import {contactShadowPlugin} from '../src/plugins/shadows';
import {webxrPlugin} from '../src/plugins/webxr';
import THREE from '../src/three-author';
import {
  evaluateToneMapping,
  isGLBData,
  mat4Create,
  mat4LookAt,
  mat4Perspective,
  MicroViewer,
  normalizeToneMapping,
  parseGLB,
  registerPlugin,
  resolveNodeWorldMatrices,
  sanitizeTextureUri,
  ThreeView,
  toGLBData,
  toneMappingShaderIndex,
  type ToneMappingMode,
} from '../src/three-view';
import {
  parseBloomTrait,
  parseIKTrait,
  parseOutlineTrait,
} from '../src/xr-trait-schema';

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

  // Replacements retire playback only after GPU preparation succeeds.
  const priorModel = (viewInstance as any).lastGlbData;
  const clip = {name: 'Old', duration: 2, channels: []};
  viewInstance.animations = [clip];
  viewInstance.currentClip = clip;
  viewInstance.isPlayingAnimation = true;
  viewInstance.animationTime = 0.75;
  crossFadeTo(viewInstance, 'Old', 1);
  let replacementFailed = false;
  try {
    viewInstance.loadGLBData({
      gltf: {asset: {version: '2.0'}, meshes: 'invalid'},
      bin: new ArrayBuffer(0),
    } as any);
  } catch {
    replacementFailed = true;
  }
  assert(
    replacementFailed &&
      viewInstance.currentClip === clip &&
      viewInstance.isPlayingAnimation &&
      (viewInstance as any).lastGlbData === priorModel,
    'failed scene preparation preserves playback and context-restoration source',
  );
  viewInstance.loadGLBData(priorModel);
  assert(
    viewInstance.currentClip === null &&
      !viewInstance.isPlayingAnimation &&
      viewInstance.animationTime === 0,
    'accepted scene replacement retires previous clip and clock',
  );
  viewInstance.isPlayingAnimation = true;
  keyframeAnimationPlugin.onUpdate?.(viewInstance, 0.25);
  assert(
    viewInstance.animationTime === 0,
    'accepted replacement retires stale crossfade mixers',
  );
  viewInstance.clearScene();
  assert(
    (viewInstance as any).lastGlbData === null &&
      viewInstance.animationTime === 0,
    'explicit clear cannot resurrect the old scene on context restoration',
  );
  viewInstance.loadGLBData(priorModel);

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

  // 19. Extended Tone Mapping ('neutral' | 'aces' | 'agx' | 'reinhard' | 'none') & Post-Processing (Bloom & Outline)
  const hdrSample: [number, number, number] = [4.0, 1.5, 0.25];
  const tmNeutral = evaluateToneMapping(hdrSample, 'neutral', 1.0);
  const tmAces = evaluateToneMapping(hdrSample, 'aces', 1.0);
  const tmAgx = evaluateToneMapping(hdrSample, 'agx', 1.0);
  const tmReinhard = evaluateToneMapping(hdrSample, 'reinhard', 1.0);
  const tmNone = evaluateToneMapping(hdrSample, 'none', 1.0);
  assert(
    tmNeutral[0] > 0.7 &&
      tmNeutral[0] <= 1.0 &&
      tmAces[0] > 0.8 &&
      tmAces[0] <= 1.0 &&
      tmAgx[0] > 0.6 &&
      tmAgx[0] <= 1.0 &&
      Math.abs(tmReinhard[0] - 4.0 / 5.0) < 1e-4 &&
      tmNone[0] === 1.0,
    `evaluateToneMapping supports neutral (${tmNeutral[0].toFixed(3)}), aces (${tmAces[0].toFixed(3)}), agx (${tmAgx[0].toFixed(3)}), reinhard (${tmReinhard[0].toFixed(3)}), and none (${tmNone[0].toFixed(3)})`,
  );
  viewInstance.setToneMapping('aces');
  assert(
    viewInstance.getToneMapping() === 'aces',
    'ThreeView.setToneMapping("aces") updates toneMapping mode',
  );
  viewInstance.setToneMapping('agx');
  assert(
    viewInstance.getToneMapping() === 'agx',
    'ThreeView.setToneMapping("agx") updates toneMapping mode',
  );
  viewInstance.setToneMapping(' ACES ' as ToneMappingMode);
  assert(
    viewInstance.getToneMapping() === 'aces',
    'ThreeView.setToneMapping normalizes case and whitespace ("ACES" -> "aces")',
  );
  viewInstance.setToneMapping('bogus' as ToneMappingMode);
  assert(
    viewInstance.getToneMapping() === 'neutral',
    'ThreeView.setToneMapping falls back to "neutral" for unknown modes',
  );
  assert(
    normalizeToneMapping(null) === 'neutral' &&
      normalizeToneMapping('Reinhard') === 'reinhard',
    'normalizeToneMapping maps null to neutral and lowercases known modes',
  );
  assert(
    toneMappingShaderIndex('neutral') === 0 &&
      toneMappingShaderIndex('reinhard') === 1 &&
      toneMappingShaderIndex('none') === 2 &&
      toneMappingShaderIndex('aces') === 3 &&
      toneMappingShaderIndex('agx') === 4 &&
      toneMappingShaderIndex('bogus') === 0,
    'toneMappingShaderIndex pins the applyToneMapping mode indices',
  );
  // Cross-platform golden values (identical in the Kotlin and Swift tests).
  const toneGoldens: Array<[ToneMappingMode, [number, number, number]]> = [
    ['neutral', [0.983256, 0.554125, 0.33956]],
    ['aces', [0.934211, 0.780548, 0.215326]],
    ['agx', [0.907921, 0.704809, 0.389573]],
    ['reinhard', [0.8, 0.6, 0.2]],
    ['none', [1.0, 1.0, 0.25]],
  ];
  for (const [mode, want] of toneGoldens) {
    const got = evaluateToneMapping(hdrSample, mode, 1.0);
    assert(
      got.every((v, i) => Math.abs(v - want[i]) < 1e-5),
      `evaluateToneMapping(${mode}) golden value [${got.map((v) => v.toFixed(6))}]`,
    );
    const zeros = [
      evaluateToneMapping([NaN, -1, 0], mode, 1.0),
      evaluateToneMapping([4, 1.5, 0.25], mode, 0),
    ];
    assert(
      zeros.every((c) => c.every((v) => v === 0)),
      `evaluateToneMapping(${mode}) maps NaN/negative input and exposure 0 to black`,
    );
    let prev = -1;
    let monotonic = true;
    for (const x of [0.01, 0.1, 0.18, 0.5, 1, 2, 4, 16]) {
      const y = evaluateToneMapping([x, x, x], mode, 1.0)[0];
      if (y < prev - 1e-9) monotonic = false;
      prev = y;
    }
    assert(monotonic, `evaluateToneMapping(${mode}) is monotonic in luminance`);
  }

  // Kawase Bloom & Outline helpers + trait parsers
  const bloomBelow = evaluateKawaseBloom([0.2, 0.25, 0.1], 0.5, 0.8);
  const bloomAbove = evaluateKawaseBloom([2.0, 1.2, 0.4], 0.8, 0.8);
  assert(
    bloomBelow[0] === 0 && bloomBelow[1] === 0 && bloomBelow[2] === 0,
    'evaluateKawaseBloom suppresses pixels below luminance threshold',
  );
  assert(
    bloomAbove[0] > 0.4 && bloomAbove[1] > 0.2,
    `evaluateKawaseBloom extracts soft-knee HDR glow above threshold: [${bloomAbove.map((v) => v.toFixed(2)).join(', ')}]`,
  );
  const clipOff = computeOutlineClipOffset([1, 0], 2.0, 4.0, [400, 200]);
  assert(
    Math.abs(clipOff[0] - (4.0 * 2.0 * 2.0) / 400) < 1e-6 && clipOff[1] === 0,
    `computeOutlineClipOffset computes perspective-compensated clip-space extrusion: [${clipOff[0].toFixed(4)}, ${clipOff[1].toFixed(4)}]`,
  );
  const rgbSky = parseHexRgb('#38bdf8');
  assert(
    Math.abs(rgbSky[0] - 0x38 / 255) < 1e-4 &&
      Math.abs(rgbSky[1] - 0xbd / 255) < 1e-4 &&
      Math.abs(rgbSky[2] - 0xf8 / 255) < 1e-4,
    'parseHexRgb parses 6-digit hex color string into normalized RGB tuple',
  );
  const rgbShort = parseHexRgb('#abc');
  const rgbShortUpper = parseHexRgb('#ABC');
  assert(
    Math.abs(rgbShort[0] - 0xaa / 255) < 1e-6 &&
      Math.abs(rgbShort[1] - 0xbb / 255) < 1e-6 &&
      Math.abs(rgbShort[2] - 0xcc / 255) < 1e-6 &&
      rgbShortUpper.every((v, i) => v === rgbShort[i]),
    'parseHexRgb expands 3-digit #abc / #ABC hex colors',
  );
  const rgbBad = parseHexRgb('not-a-color', [0.1, 0.2, 0.3]);
  assert(
    rgbBad[0] === 0.1 && rgbBad[1] === 0.2 && rgbBad[2] === 0.3,
    'parseHexRgb returns the fallback for invalid colors',
  );
  assert(
    parseOutlineTrait({thickness: 0.025})?.thickness === 3.5 &&
      parseOutlineTrait({width: 0.005})?.thickness === 1.5 &&
      parseOutlineTrait({thickness: 0.3})?.thickness === 0.5 &&
      parseOutlineTrait({thickness: 4})?.thickness === 4,
    'parseOutlineTrait converts metre-sized thickness (< 0.25) to pixels, matching Android and iOS',
  );
  const bloomTrait = parseBloomTrait({
    strength: 1.2,
    threshold: 0.65,
    radius: 0.5,
  });
  const outlineTrait = parseOutlineTrait({color: '#22c55e', thickness: 4});
  assert(
    bloomTrait !== null &&
      Math.abs(bloomTrait.strength - 1.2) < 1e-6 &&
      Math.abs(bloomTrait.threshold - 0.65) < 1e-6 &&
      Math.abs(bloomTrait.radius - 0.5) < 1e-6,
    'parseBloomTrait normalizes bloom trait options',
  );
  assert(
    outlineTrait !== null &&
      outlineTrait.color === '#22c55e' &&
      outlineTrait.thickness === 4,
    'parseOutlineTrait normalizes outline trait options',
  );
  assert(
    postprocessingPlugin.name === 'postprocessing' &&
      typeof postprocessingPlugin.onAfterRender === 'function',
    'postprocessingPlugin exposes ThreeLivePlugin onAfterRender hook',
  );
  {
    let blendFuncSeparateCalled = false;
    let drawArraysCalls = 0;
    const mockBloomGl = {
      VERTEX_SHADER: 35633,
      FRAGMENT_SHADER: 35632,
      TEXTURE_2D: 3553,
      TEXTURE0: 33984,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      TEXTURE_MIN_FILTER: 10241,
      TEXTURE_MAG_FILTER: 10240,
      TEXTURE_WRAP_S: 10242,
      TEXTURE_WRAP_T: 10243,
      LINEAR: 9729,
      CLAMP_TO_EDGE: 33071,
      FRAMEBUFFER: 36160,
      COLOR_ATTACHMENT0: 36064,
      DEPTH_TEST: 2929,
      BLEND: 3042,
      ONE: 1,
      ONE_MINUS_SRC_ALPHA: 771,
      SRC_ALPHA: 770,
      TRIANGLES: 4,
      createShader: () => ({}),
      shaderSource: () => {},
      compileShader: () => {},
      createProgram: () => ({}),
      attachShader: () => {},
      linkProgram: () => {},
      getUniformLocation: () => ({}),
      createVertexArray: () => ({}),
      bindVertexArray: () => {},
      createTexture: () => ({}),
      bindTexture: () => {},
      texImage2D: () => {},
      texParameteri: () => {},
      createFramebuffer: () => ({}),
      bindFramebuffer: () => {},
      framebufferTexture2D: () => {},
      activeTexture: () => {},
      copyTexSubImage2D: () => {},
      viewport: () => {},
      disable: () => {},
      enable: () => {},
      depthMask: () => {},
      useProgram: () => {},
      uniform1i: () => {},
      uniform1f: () => {},
      uniform2f: () => {},
      blendFunc: () => {},
      blendFuncSeparate: (
        srcRgb: number,
        dstRgb: number,
        srcA: number,
        dstA: number,
      ) => {
        if (srcRgb === 1 && dstRgb === 1 && srcA === 1 && dstA === 771) {
          blendFuncSeparateCalled = true;
        }
      },
      drawArrays: () => {
        drawArraysCalls++;
      },
    } as unknown as WebGL2RenderingContext;
    const mockBloomViewer = {
      canvas: {width: 400, height: 300},
      container: {
        getAttribute: (name: string) => (name === 'bloom' ? '1.2' : null),
      },
      meshes: [{name: 'Core', visible: true, primitives: []}],
    } as unknown as ThreeView;
    postprocessingPlugin.onAfterRender!(
      mockBloomGl,
      mockBloomViewer,
      new Float32Array(16),
    );
    assert(
      blendFuncSeparateCalled && drawArraysCalls === 6,
      'postprocessingPlugin runs 3-level Dual-Kawase pyramid (6 passes) and preserves transparent canvas background alpha via blendFuncSeparate',
    );

    // Recording mock GL for the outline / bloom / shader-lifecycle tests.
    // Every test builds a fresh mock because GPU state is cached per context.
    const makeRecordingGl = (overrides: Record<string, unknown> = {}) => {
      const rec = {
        createShader: 0,
        deleteShader: 0,
        detachShader: 0,
        createProgram: 0,
        deleteProgram: 0,
        draws: 0,
        uniform2f: [] as number[][],
        uniform1f: [] as Array<[string, number]>,
      };
      const gl = {
        VERTEX_SHADER: 35633,
        FRAGMENT_SHADER: 35632,
        LINK_STATUS: 35714,
        VIEWPORT: 2978,
        TEXTURE_2D: 3553,
        FRAMEBUFFER: 36160,
        TRIANGLES: 4,
        ONE: 1,
        ONE_MINUS_SRC_ALPHA: 771,
        createShader: () => (rec.createShader++, {}),
        deleteShader: () => void rec.deleteShader++,
        detachShader: () => void rec.detachShader++,
        shaderSource: () => {},
        compileShader: () => {},
        createProgram: () => (rec.createProgram++, {}),
        deleteProgram: () => void rec.deleteProgram++,
        attachShader: () => {},
        linkProgram: () => {},
        getProgramParameter: () => true,
        getUniformLocation: (_p: unknown, name: string) => ({name}),
        createVertexArray: () => ({}),
        deleteVertexArray: () => {},
        deleteTexture: () => {},
        deleteFramebuffer: () => {},
        bindVertexArray: () => {},
        createTexture: () => ({}),
        bindTexture: () => {},
        texImage2D: () => {},
        texParameteri: () => {},
        createFramebuffer: () => ({}),
        bindFramebuffer: () => {},
        framebufferTexture2D: () => {},
        activeTexture: () => {},
        copyTexSubImage2D: () => {},
        viewport: () => {},
        disable: () => {},
        enable: () => {},
        cullFace: () => {},
        depthFunc: () => {},
        depthMask: () => {},
        useProgram: () => {},
        uniform1i: () => {},
        uniform1f: (loc: {name: string}, v: number) =>
          void rec.uniform1f.push([loc.name, v]),
        uniform2f: (_loc: unknown, x: number, y: number) =>
          void rec.uniform2f.push([x, y]),
        uniform4f: () => {},
        uniformMatrix3fv: () => {},
        uniformMatrix4fv: () => {},
        blendFunc: () => {},
        blendFuncSeparate: () => {},
        getParameter: () => null,
        drawArrays: () => void rec.draws++,
        drawElements: () => void rec.draws++,
        ...overrides,
      } as unknown as WebGL2RenderingContext;
      return {gl, rec};
    };
    const identity16 = () => {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    };
    const makeOutlineViewer = (
      attrs: Record<string, string>,
      meshes: Array<Record<string, unknown>>,
      extra: Record<string, unknown> = {},
    ) =>
      ({
        canvas: {width: 400, height: 300},
        modelRootMatrix: identity16(),
        container: {
          getAttribute: (n: string) => attrs[n] ?? null,
          hasAttribute: (n: string) => n in attrs,
        },
        meshes: meshes.map((m) => ({
          visible: true,
          transform: identity16(),
          primitives: [{vao: {}, indices: null, indexCount: 3}],
          ...m,
        })),
        ...extra,
      }) as unknown as ThreeView;

    // F6: outline thickness uses the current (eye) viewport, not the canvas.
    {
      const {gl, rec} = makeRecordingGl({
        getParameter: (p: number) => (p === 2978 ? [200, 0, 200, 300] : null),
      });
      postprocessingPlugin.onAfterRender!(
        gl,
        makeOutlineViewer({}, [{name: 'Orb', extras: {xr: {outline: true}}}]),
        new Float32Array(16),
      );
      assert(
        rec.uniform2f.length > 0 &&
          rec.uniform2f[0][0] === 200 &&
          rec.uniform2f[0][1] === 300 &&
          rec.draws === 1,
        `outline pass sizes thickness by gl.VIEWPORT (200x300 eye), not the 400x300 canvas: [${rec.uniform2f[0]}]`,
      );
    }

    // F7: skinned / morphed primitives are skipped (bind-pose hull).
    for (const pluginData of [
      {skinning: {hasSkin: true}},
      {morph: {hasMorph: true}},
    ]) {
      const {gl, rec} = makeRecordingGl();
      postprocessingPlugin.onAfterRender!(
        gl,
        makeOutlineViewer({}, [
          {
            name: 'Avatar',
            extras: {xr: {outline: true}},
            primitives: [{vao: {}, indices: null, indexCount: 3, pluginData}],
          },
        ]),
        new Float32Array(16),
      );
      assert(
        rec.draws === 0,
        `outline pass skips ${Object.keys(pluginData)[0]} primitives (no bind-pose hull)`,
      );
    }

    // Bloom bypass in WebXR / side-by-side stereo keeps the outline pass.
    for (const flag of ['xrSessionActive', 'stereoSBS']) {
      const {gl, rec} = makeRecordingGl();
      postprocessingPlugin.onAfterRender!(
        gl,
        makeOutlineViewer(
          {bloom: '1'},
          [{name: 'Orb', extras: {xr: {outline: true}}}],
          {[flag]: true},
        ),
        new Float32Array(16),
      );
      assert(
        rec.draws === 1,
        `${flag} bypasses the bloom pyramid while the outline still draws (draws=${rec.draws})`,
      );
    }

    // F9: empty / junk bloom-threshold falls back to the shared host default.
    for (const thAttr of ['', '  ', 'abc']) {
      const {gl, rec} = makeRecordingGl();
      postprocessingPlugin.onAfterRender!(
        gl,
        makeOutlineViewer(
          {bloom: '1', 'bloom-threshold': thAttr, 'bloom-radius': ''},
          [{name: 'Orb'}],
        ),
        new Float32Array(16),
      );
      const th = rec.uniform1f.find(([n]) => n === 'uThreshold')?.[1];
      const rad = rec.uniform1f.find(([n]) => n === 'uRadius')?.[1];
      assert(
        th === HOST_BLOOM_DEFAULT_THRESHOLD &&
          rad === HOST_BLOOM_DEFAULT_RADIUS,
        `bloom-threshold="${thAttr}" falls back to the host defaults (threshold=${th}, radius=${rad})`,
      );
    }

    // F12: shaders are detached/deleted after linking; link failure disables
    // the pass; dead programs after context loss are rebuilt.
    {
      const {gl, rec} = makeRecordingGl();
      const viewer = makeOutlineViewer({bloom: '1'}, [
        {name: 'Orb', extras: {xr: {outline: true}}},
      ]);
      postprocessingPlugin.onAfterRender!(gl, viewer, new Float32Array(16));
      assert(
        rec.createShader === 6 &&
          rec.deleteShader === 6 &&
          rec.detachShader === 6 &&
          rec.createProgram === 3,
        `postprocessing frees all 6 shaders after linking 3 programs (created=${rec.createShader}, deleted=${rec.deleteShader})`,
      );
      postprocessingPlugin.onDestroy!(gl);
    }
    {
      const {gl, rec} = makeRecordingGl({getProgramParameter: () => false});
      const viewer = makeOutlineViewer({bloom: '1'}, [
        {name: 'Orb', extras: {xr: {outline: true}}},
      ]);
      postprocessingPlugin.onAfterRender!(gl, viewer, new Float32Array(16));
      postprocessingPlugin.onAfterRender!(gl, viewer, new Float32Array(16));
      assert(
        rec.draws === 0 && rec.createProgram === 3 && rec.deleteProgram === 3,
        `postprocessing disables itself (no draws, no per-frame recompiles) when shaders fail to link (draws=${rec.draws}, programs=${rec.createProgram})`,
      );
    }
    {
      let alive = true;
      const {gl, rec} = makeRecordingGl({isProgram: () => alive});
      const viewer = makeOutlineViewer({}, [
        {name: 'Orb', extras: {xr: {outline: true}}},
      ]);
      postprocessingPlugin.onAfterRender!(gl, viewer, new Float32Array(16));
      postprocessingPlugin.onAfterRender!(gl, viewer, new Float32Array(16));
      const beforeLoss = rec.createProgram;
      alive = false;
      postprocessingPlugin.onAfterRender!(gl, viewer, new Float32Array(16));
      assert(
        beforeLoss === 3 && rec.createProgram === 6 && rec.draws === 3,
        `postprocessing rebuilds programs after WebGL context loss/restore (programs ${beforeLoss} -> ${rec.createProgram})`,
      );
    }

    // F11 + precedence: resolveMeshOutline.
    {
      const mesh = (name: string, xr?: Record<string, unknown>) =>
        ({name, extras: xr ? {xr} : {}}) as unknown as ThreeView['meshes'][0];
      const v = (attrs: Record<string, string>, selected = ''): ThreeView =>
        makeOutlineViewer(attrs, [], {getSelectedMesh: () => selected});
      assert(
        resolveMeshOutline(
          v({outline: 'false'}),
          mesh('Orb', {outline: '#ff0000'}),
        ) === null,
        'resolveMeshOutline: host outline="false" overrides node traits',
      );
      assert(
        resolveMeshOutline(v({}), mesh('Orb', {outline: '#ff0000'}))?.color ===
          '#ff0000',
        'resolveMeshOutline: node outline trait applies without host attributes',
      );
      const sel = v({'outline-selected': ''}, 'Gear');
      assert(
        resolveMeshOutline(sel, mesh('Gear')) !== null &&
          resolveMeshOutline(sel, mesh('Bolt')) === null,
        'resolveMeshOutline: selected-mesh + outline-selected outlines only the selected mesh',
      );
      assert(
        resolveMeshOutline(
          v({'outline-selected': 'false'}, 'Gear'),
          mesh('Gear'),
        ) === null,
        'resolveMeshOutline: outline-selected="false" disables the selection outline',
      );
      const host = v({outline: 'true'});
      const outlined = ['Tablet', 'Vegetable', 'Keypad', 'Launchpad', 'Orb'];
      const skipped = [
        'floor_01',
        'Ground Plane',
        'GroundPlane',
        'table',
        'Grid',
      ];
      assert(
        outlined.every((n) => resolveMeshOutline(host, mesh(n)) !== null) &&
          skipped.every((n) => resolveMeshOutline(host, mesh(n)) === null),
        'resolveMeshOutline: host outline skips staging meshes by whole name token only',
      );
      const hostThin = resolveMeshOutline(
        v({outline: '0.02 #00ff00'}),
        mesh('Orb'),
      );
      assert(
        hostThin !== null && Math.abs(hostThin.thickness - 2.8) < 1e-9,
        'resolveMeshOutline: metre-sized host outline thickness converts to pixels',
      );
    }

    // Regression test: mat3NormalFromMat4 must return the column-major
    // inverse-transpose (so a pure rotation R_y(theta) * R_x(-90 deg) maps
    // local +Z [0, 0, 1] to world +Y [0, 1, 0] at every turntable angle).
    const rxMinus90 = new Float32Array([
      1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
    ]);
    const cosT = Math.cos(1.1);
    const sinT = Math.sin(1.1);
    const ryTurntable = new Float32Array([
      cosT,
      0,
      -sinT,
      0,
      0,
      1,
      0,
      0,
      sinT,
      0,
      cosT,
      0,
      0,
      0,
      0,
      1,
    ]);
    const combinedRot = mat4Create();
    mat4Multiply(combinedRot, ryTurntable, rxMinus90);
    const nMat = new Float32Array(9);
    mat3NormalFromMat4(nMat, combinedRot);
    // Transform local +Z normal [0, 0, 1] -> column 2 of nMat: [nMat[6], nMat[7], nMat[8]]
    assert(
      Math.abs(nMat[6]) < 1e-6 &&
        Math.abs(nMat[7] - 1.0) < 1e-6 &&
        Math.abs(nMat[8]) < 1e-6,
      'mat3NormalFromMat4 preserves world +Y normal for R_y(theta) * R_x(-90 deg) across turntable rotation',
    );
  }

  // 20. Analytic Two-Bone & FABRIK Inverse Kinematics (ikPlugin & THREE.IKSolver)
  const q90z = quatFromUnitVectors([1, 0, 0], [0, 1, 0]);
  assert(
    Math.abs(q90z[2] - Math.sin(Math.PI / 4)) < 1e-4 &&
      Math.abs(q90z[3] - Math.cos(Math.PI / 4)) < 1e-4,
    'quatFromUnitVectors rotates +X onto +Y by +90 deg around +Z',
  );
  const q180 = quatFromUnitVectors([1, 0, 0], [-1, 0, 0]);
  const q180Len = Math.hypot(q180[0], q180[1], q180[2], q180[3]);
  assert(
    Math.abs(q180Len - 1.0) < 1e-4 && Math.abs(q180[3]) < 1e-4,
    'quatFromUnitVectors handles 180-degree opposite vectors cleanly',
  );

  const twoBone = solveTwoBoneIK(
    [0, 0, 0],
    [0, 0.5, 0],
    [0, 1.0, 0],
    [0.5, 0.5, 0],
    [0, 1, 0],
  );
  const d1 = Math.hypot(
    twoBone.midPos[0],
    twoBone.midPos[1],
    twoBone.midPos[2],
  );
  const d2 = Math.hypot(
    twoBone.effectorPos[0] - twoBone.midPos[0],
    twoBone.effectorPos[1] - twoBone.midPos[1],
    twoBone.effectorPos[2] - twoBone.midPos[2],
  );
  const errTwoBone = Math.hypot(
    twoBone.effectorPos[0] - 0.5,
    twoBone.effectorPos[1] - 0.5,
    twoBone.effectorPos[2],
  );
  assert(
    Math.abs(d1 - 0.5) < 1e-4 && Math.abs(d2 - 0.5) < 1e-4 && errTwoBone < 1e-4,
    `solveTwoBoneIK reaches target [0.5, 0.5, 0] while preserving bone lengths (${d1.toFixed(3)}, ${d2.toFixed(3)})`,
  );

  const fabrik = solveFABRIK(
    [
      [0, 0, 0],
      [0, 0.4, 0],
      [0, 0.8, 0],
      [0, 1.2, 0],
    ],
    [0.6, 0.6, 0.2],
    12,
    1e-4,
  );
  const endPos = fabrik.positions[3];
  const fabrikErr = Math.hypot(
    endPos[0] - 0.6,
    endPos[1] - 0.6,
    endPos[2] - 0.2,
  );
  assert(
    fabrikErr < 1e-3 && fabrik.rotations.length === 3,
    `solveFABRIK 4-joint chain converges within 1mm (err=${fabrikErr.toFixed(5)})`,
  );

  ikPlugin.onRegister?.();
  assert(
    Boolean(THREE.IKSolver) &&
      typeof IKSolver.solveTwoBone === 'function' &&
      typeof THREE.IKSolver.solveTwoBone === 'function' &&
      typeof THREE.IKSolver.solveFABRIK === 'function' &&
      typeof THREE.IKSolver.parseIKTrait === 'function',
    'THREE.IKSolver is exposed in three-author sandbox API when ikPlugin is registered',
  );
  const ikTrait = parseIKTrait({
    solver: 'two-bone',
    root: 'Shoulder',
    mid: 'Elbow',
    effector: 'Wrist',
    target: 'TargetOrb',
    pole: [0, 1, -0.5],
    iterations: 10,
  });
  assert(
    ikTrait !== null &&
      ikTrait.solver === 'two-bone' &&
      ikTrait.root === 'Shoulder' &&
      ikTrait.mid === 'Elbow' &&
      ikTrait.effector === 'Wrist' &&
      ikTrait.target === 'TargetOrb' &&
      Array.isArray(ikTrait.pole) &&
      ikTrait.iterations === 10,
    'parseIKTrait normalizes two-bone IK trait configuration',
  );
  assert(
    ikPlugin.name === 'ik' && typeof ikPlugin.onUpdate === 'function',
    'ikPlugin exposes ThreeLivePlugin onUpdate hook',
  );
  {
    const mkBoneMesh = (
      name: string,
      pos: [number, number, number],
      xr?: Record<string, unknown>,
    ) => {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      m[12] = pos[0];
      m[13] = pos[1];
      m[14] = pos[2];
      return {
        name,
        modelMatrix: m,
        extras: xr ? {xr} : {},
      };
    };
    const shoulder = mkBoneMesh('Shoulder', [0, 0, 0]);
    const elbow = mkBoneMesh('Elbow', [0, 0.5, 0]);
    const wrist = mkBoneMesh('Wrist', [0, 1.0, 0], {
      ik: {
        solver: 'two-bone',
        root: 'Shoulder',
        mid: 'Elbow',
        effector: 'Wrist',
        target: 'hand-right',
        pole: [0, 1, 0],
        weight: 0.5,
      },
    });
    const mockViewer = {
      meshes: [shoulder, elbow, wrist],
      handPoses: {right: [0.5, 0.5, 0]},
    } as unknown as Parameters<NonNullable<typeof ikPlugin.onUpdate>>[0];
    for (let f = 0; f < 10; f++) {
      ikPlugin.onUpdate?.(mockViewer, 0.016);
    }
    const len1 = Math.hypot(
      elbow.modelMatrix[12] - shoulder.modelMatrix[12],
      elbow.modelMatrix[13] - shoulder.modelMatrix[13],
      elbow.modelMatrix[14] - shoulder.modelMatrix[14],
    );
    const len2 = Math.hypot(
      wrist.modelMatrix[12] - elbow.modelMatrix[12],
      wrist.modelMatrix[13] - elbow.modelMatrix[13],
      wrist.modelMatrix[14] - elbow.modelMatrix[14],
    );
    assert(
      Math.abs(len1 - 0.5) < 1e-4 &&
        Math.abs(len2 - 0.5) < 1e-4 &&
        wrist.modelMatrix[12] > 0.1,
      `ikPlugin.onUpdate preserves bone lengths (${len1.toFixed(3)}, ${len2.toFixed(3)}) across multi-frame weight<1 blending and resolves 'hand-right' target`,
    );
  }

  // 20b. IK regression and edge-case coverage.
  {
    const finite3 = (p: readonly number[]) =>
      Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
    const dist = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

    // Named pole (`pole` or `poleTarget` alias) in both parsers.
    for (const parse of [parseIKTrait, IKSolver.parseIKTrait]) {
      const named = parse({root: 'A', effector: 'C', target: 'T', pole: 'P'});
      const alias = parse({
        root: 'A',
        effector: 'C',
        target: 'T',
        poleTarget: 'P',
      });
      const legacy = parse({target: 'T', poleTarget: 'P', chainLength: 2});
      assert(
        named?.pole === 'P' && alias?.pole === 'P' && legacy === null,
        'parseIKTrait accepts a named pole / poleTarget alias and rejects the root-less schema',
      );
    }

    const mkBone = (
      name: string,
      pos: [number, number, number],
      xr?: Record<string, unknown>,
    ) => {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      m[12] = pos[0];
      m[13] = pos[1];
      m[14] = pos[2];
      return {name, modelMatrix: m, extras: xr ? {xr} : {}};
    };
    type IKViewer = Parameters<NonNullable<typeof ikPlugin.onUpdate>>[0];
    const pos = (m: {modelMatrix: Float32Array}) => [
      m.modelMatrix[12],
      m.modelMatrix[13],
      m.modelMatrix[14],
    ];

    // Named pole resolves through scene meshes and picks the bend side.
    for (const pz of [1, -1]) {
      const shoulder = mkBone('Shoulder', [0, 0, 0]);
      const elbow = mkBone('Elbow', [0, 0.5, 0]);
      const pole = mkBone('ElbowPole', [0, 0.25, pz]);
      const wrist = mkBone('Wrist', [0, 1, 0], {
        ik: {
          root: 'Shoulder',
          mid: 'Elbow',
          effector: 'Wrist',
          target: [0.5, 0.5, 0],
          pole: 'ElbowPole',
        },
      });
      ikPlugin.onUpdate?.(
        {meshes: [shoulder, elbow, pole, wrist]} as unknown as IKViewer,
        0.016,
      );
      assert(
        Math.sign(elbow.modelMatrix[14]) === pz &&
          dist(pos(wrist), [0.5, 0.5, 0]) < 1e-3,
        `ikPlugin resolves named pole 'ElbowPole' (z=${pz}) and bends the elbow toward it`,
      );
    }

    // Missing joint names warn once instead of silently doing nothing.
    {
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(' '));
      };
      try {
        const shoulder = mkBone('Shoulder', [0, 0, 0]);
        const wrist = mkBone('Wrist', [0, 1, 0], {
          ik: {
            root: 'Shoulder',
            mid: 'Elbow',
            effector: 'Wrist',
            target: [1, 0, 0],
          },
        });
        const viewer = {meshes: [shoulder, wrist]} as unknown as IKViewer;
        ikPlugin.onUpdate?.(viewer, 0.016);
        ikPlugin.onUpdate?.(viewer, 0.016);
      } finally {
        console.warn = origWarn;
      }
      assert(
        warnings.length === 1 && warnings[0].includes("'Elbow'"),
        `ikPlugin warns once when a chain joint is missing (${warnings.length} warnings)`,
      );
    }

    // World-space hand targets are mapped into scene space via modelRootMatrix.
    {
      const shoulder = mkBone('Shoulder', [0, 0, 0]);
      const elbow = mkBone('Elbow', [0, 0.5, 0]);
      const wrist = mkBone('Wrist', [0, 1, 0], {
        ik: {
          root: 'Shoulder',
          mid: 'Elbow',
          effector: 'Wrist',
          target: 'hand-right',
          pole: [0, 1, 0],
        },
      });
      const root = mat4Create();
      root[12] = 10;
      ikPlugin.onUpdate?.(
        {
          meshes: [shoulder, elbow, wrist],
          handPoses: {right: [10.5, 0.5, 0]},
          modelRootMatrix: root,
        } as unknown as IKViewer,
        0.016,
      );
      assert(
        dist(pos(wrist), [0.5, 0.5, 0]) < 1e-3,
        `ikPlugin maps world hand target through inverse modelRootMatrix (wrist=${pos(wrist).map((v) => v.toFixed(3))})`,
      );
    }

    // Weighted blending never collapses a bone to zero length.
    {
      const root = mkBone('Root', [0, 0, 0]);
      const tip = mkBone('Tip', [0, 1, 0], {
        ik: {
          root: 'Root',
          effector: 'Tip',
          target: [0, -5, 0],
          solver: 'fabrik',
          weight: 0.5,
        },
      });
      ikPlugin.onUpdate?.({meshes: [root, tip]} as unknown as IKViewer, 0.016);
      const len = dist(pos(tip), pos(root));
      assert(
        Math.abs(len - 1) < 1e-4,
        `ikPlugin weight=0.5 mirrored blend keeps bone length (${len.toFixed(4)})`,
      );
    }

    // solveTwoBoneIK edge cases.
    const unreach = solveTwoBoneIK(
      [0, 0, 0],
      [0, 0.5, 0],
      [0, 1, 0],
      [3, 0, 0],
    );
    assert(
      Math.abs(dist(unreach.effectorPos, [0, 0, 0]) - (1 - 1e-5)) < 1e-4 &&
        Math.abs(dist(unreach.midPos, [0, 0, 0]) - 0.5) < 1e-4 &&
        Math.abs(dist(unreach.effectorPos, unreach.midPos) - 0.5) < 1e-4 &&
        unreach.effectorPos[0] > 0.999,
      'solveTwoBoneIK unreachable target stretches straight toward it with lengths preserved',
    );
    const atRoot = solveTwoBoneIK([0, 0, 0], [0, 0.6, 0], [0, 1, 0], [0, 0, 0]);
    assert(
      finite3(atRoot.midPos) &&
        finite3(atRoot.effectorPos) &&
        Math.abs(dist(atRoot.effectorPos, [0, 0, 0]) - 0.2) < 1e-3,
      'solveTwoBoneIK target at root folds to |l1-l2| without NaN',
    );
    const zeroBone = solveTwoBoneIK([0, 0, 0], [0, 0, 0], [0, 1, 0], [1, 0, 0]);
    assert(
      zeroBone.rootRotation.join() === '0,0,0,1' &&
        zeroBone.midRotation.join() === '0,0,0,1' &&
        zeroBone.effectorPos.join() === '0,1,0',
      'solveTwoBoneIK zero-length bone returns identity rotations and unchanged positions',
    );
    const colinear = solveTwoBoneIK(
      [0, 0, 0],
      [0, 0.5, 0],
      [0, 1, 0],
      [0.5, 0.5, 0],
      [1, 1, 0],
    );
    assert(
      finite3(colinear.midPos) &&
        Math.abs(colinear.midPos[2]) > 0.1 &&
        dist(colinear.effectorPos, [0.5, 0.5, 0]) < 1e-4,
      'solveTwoBoneIK pole colinear with target uses a perpendicular fallback bend',
    );
    const nanT = solveTwoBoneIK([0, 0, 0], [0, 0.5, 0], [0, 1, 0], [NaN, 0, 0]);
    assert(
      finite3(nanT.midPos) &&
        finite3(nanT.effectorPos) &&
        nanT.rootRotation.every(Number.isFinite) &&
        dist(nanT.effectorPos, [0, 0, 0]) < 1e-3,
      'solveTwoBoneIK NaN target folds to minDist without NaN output',
    );

    // solveFABRIK edge cases.
    const fUnreach = solveFABRIK(
      [
        [0, 0, 0],
        [0, 1, 0],
        [0, 2, 0],
      ],
      [5, 0, 0],
    );
    assert(
      fUnreach.iterations === 1 &&
        dist(fUnreach.positions[1], [1, 0, 0]) < 1e-6 &&
        dist(fUnreach.positions[2], [2, 0, 0]) < 1e-6,
      'solveFABRIK unreachable target yields a straight collinear chain in 1 iteration',
    );
    const fZero = solveFABRIK(
      [
        [0, 0, 0],
        [0, 0, 0],
      ],
      [1, 0, 0],
    );
    assert(
      fZero.positions.every((p) => dist(p, [0, 0, 0]) < 1e-9) &&
        fZero.iterations <= 32,
      'solveFABRIK zero total length collapses to root and terminates',
    );
    const stuck: Array<[number, number, number]> = [
      [0, 0, 0],
      [0, 1, 0],
    ];
    const itersFor = (n: number) =>
      solveFABRIK(stuck, [0, 0.5, 0], n).iterations;
    assert(
      itersFor(0) === 1 && itersFor(1000) === 32 && itersFor(NaN) === 8,
      `solveFABRIK clamps maxIterations 0/1000/NaN to 1/32/8 (${itersFor(0)}/${itersFor(1000)}/${itersFor(NaN)})`,
    );
    assert(
      solveFABRIK(
        [
          [0, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
        ],
        [1, 1, 0],
      ).iterations === 0,
      'solveFABRIK already-converged chain reports iterations === 0',
    );
  }

  // 20c. IK on the glTF node graph: mesh-less Group joints, rotations, and
  // child meshes following their joints.
  {
    const ident = () => {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    };
    type V3 = [number, number, number];
    const mkViewer = (target: V3, solver: string, weight = 1) => {
      // 0 Shoulder (group) -> 1 Forearm (group) -> 2 Wrist (mesh); 3 UpperLink (mesh) under Shoulder.
      const nodes = [
        {name: 'Shoulder', translation: [0, 0, 0], children: [1, 3]},
        {name: 'Forearm', translation: [0, 1, 0], children: [2]},
        {name: 'Wrist', translation: [0, 1, 0], mesh: 0},
        {name: 'UpperLink', translation: [0, 0.5, 0], mesh: 1},
      ];
      const initialNodeTransforms = nodes.map((n) => ({
        t: n.translation as V3,
        r: [0, 0, 0, 1] as [number, number, number, number],
        s: [1, 1, 1] as V3,
      }));
      const worldMatrices = [ident(), ident(), ident(), ident()];
      worldMatrices[1][13] = 1;
      worldMatrices[2][13] = 2;
      worldMatrices[3][13] = 0.5;
      const wrist = {
        name: 'Wrist',
        nodeIndex: 2,
        transform: Float32Array.from(worldMatrices[2]),
        normalMatrix: new Float32Array(9),
        userData: {
          xr: {
            ik: {
              root: 'Shoulder',
              mid: 'Forearm',
              effector: 'Wrist',
              target,
              solver,
              weight,
              pole: [1, 0, 0],
            },
          },
        },
      };
      const link = {
        name: 'UpperLink',
        nodeIndex: 3,
        transform: Float32Array.from(worldMatrices[3]),
        normalMatrix: new Float32Array(9),
      };
      return {
        viewer: {
          gltf: {nodes, scenes: [{nodes: [0]}]},
          initialNodeTransforms,
          worldMatrices,
          meshes: [wrist, link],
        },
        wrist,
        link,
      };
    };
    type IKViewer2 = Parameters<NonNullable<typeof ikPlugin.onUpdate>>[0];
    const p3 = (m: Float32Array): V3 => [m[12], m[13], m[14]];
    for (const solver of ['two-bone', 'fabrik']) {
      const {viewer, wrist, link} = mkViewer([1, 1, 0], solver);
      const warn = console.warn;
      let warned = 0;
      console.warn = () => warned++;
      ikPlugin.onUpdate?.(viewer as unknown as IKViewer2, 0.016);
      ikPlugin.onUpdate?.(viewer as unknown as IKViewer2, 0.016);
      console.warn = warn;
      const w = p3(wrist.transform);
      const elbow = p3(viewer.worldMatrices[1]);
      const l = p3(link.transform);
      const shoulderRot = viewer.worldMatrices[0];
      assert(
        warned === 0 &&
          Math.hypot(w[0] - 1, w[1] - 1, w[2]) < 2e-3 &&
          Math.abs(Math.hypot(...elbow) - 1) < 1e-4 &&
          Math.abs(
            Math.hypot(w[0] - elbow[0], w[1] - elbow[1], w[2] - elbow[2]) - 1,
          ) < 1e-4,
        `${solver}: node-graph IK reaches the target through mesh-less Group joints (wrist ${w.map((v) => v.toFixed(3))})`,
      );
      // UpperLink sits halfway along the Shoulder->Forearm bone in rest pose,
      // so after the Shoulder rotates it must stay halfway along the new bone.
      assert(
        Math.hypot(
          l[0] - elbow[0] / 2,
          l[1] - elbow[1] / 2,
          l[2] - elbow[2] / 2,
        ) < 1e-4 &&
          // The pole bends the two-bone elbow to +X, so the Shoulder must rotate.
          (solver !== 'two-bone' || Math.abs(shoulderRot[0] - 1) > 1e-3),
        `${solver}: child meshes follow the rotated joint (UpperLink ${l.map((v) => v.toFixed(3))})`,
      );
    }
    {
      const {viewer, wrist} = mkViewer([1, 1, 0], 'two-bone', 0);
      ikPlugin.onUpdate?.(viewer as unknown as IKViewer2, 0.016);
      const w = p3(wrist.transform);
      assert(
        Math.abs(w[0]) < 1e-6 && Math.abs(w[1] - 2) < 1e-6,
        'weight 0 leaves the node-graph chain in its rest pose',
      );
      const half = mkViewer([1, 1, 0], 'two-bone', 0.5);
      ikPlugin.onUpdate?.(half.viewer as unknown as IKViewer2, 0.016);
      const hw = p3(half.wrist.transform);
      const he = p3(half.viewer.worldMatrices[1]);
      assert(
        Math.abs(Math.hypot(...he) - 1) < 1e-4 &&
          Math.abs(
            Math.hypot(hw[0] - he[0], hw[1] - he[1], hw[2] - he[2]) - 1,
          ) < 1e-4 &&
          hw[0] > 0.05 &&
          Math.hypot(hw[0] - 1, hw[1] - 1, hw[2]) > 1e-2,
        'weight 0.5 blends joint rotations by slerp and keeps bone lengths',
      );
    }
  }

  // 21. EXT_mesh_gpu_instancing reader, load cleanup & KHR_materials_variants indexing.
  {
    const glCounts = {createTexture: 0, deleteTexture: 0};
    const countingGl = new Proxy(
      {
        canvas: {width: 400, height: 400},
        getShaderParameter: () => true,
        getProgramParameter: () => true,
        getAttribLocation: () => 0,
        createTexture: () => {
          glCounts.createTexture++;
          return {};
        },
        deleteTexture: () => {
          glCounts.deleteTexture++;
        },
      },
      {
        get(target: Record<string, unknown>, prop: string) {
          if (prop in target) return target[prop];
          return () => ({});
        },
      },
    );
    const instCanvas = {...mockCanvas, getContext: () => countingGl};
    const instView = new ThreeView(instCanvas, instCanvas, {autoRotate: false});

    // bin: [0,36) triangle positions, then per-test instance data.
    const mkInstGlb = (
      instBytes: Uint8Array,
      accessors: Array<Record<string, unknown>>,
      attributes: Record<string, number>,
      extra: Record<string, unknown> = {},
    ) => {
      const bin = new Uint8Array(36 + instBytes.byteLength);
      new Float32Array(bin.buffer, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      bin.set(instBytes, 36);
      return {
        gltf: {
          asset: {version: '2.0'},
          buffers: [{byteLength: bin.byteLength}],
          bufferViews: [
            {buffer: 0, byteOffset: 0, byteLength: 36},
            {buffer: 0, byteOffset: 36, byteLength: instBytes.byteLength},
            {
              buffer: 0,
              byteOffset: 36,
              byteLength: instBytes.byteLength,
              byteStride: 8,
            },
          ],
          accessors: [
            {
              bufferView: 0,
              componentType: 5126,
              count: 3,
              type: 'VEC3',
              min: [0, 0, 0],
              max: [1, 1, 0],
            },
            ...accessors,
          ],
          meshes: [{primitives: [{attributes: {POSITION: 0}}]}],
          nodes: [
            {mesh: 0, extensions: {EXT_mesh_gpu_instancing: {attributes}}},
          ],
          ...extra,
        },
        bin: bin.buffer,
      };
    };
    const noNaN = (a?: Float32Array) =>
      !!a && Array.from(a).every(Number.isFinite);
    const boundsOk = () =>
      [
        ...instView.bounds.min,
        ...instView.bounds.max,
        instView.bounds.radius,
      ].every(Number.isFinite);

    // TRANSLATION float32 @0 (2 x 12 B), ROTATION int16-normalized @24 (2 x 8 B),
    // _COLOR_0 uint8-normalized VEC4 in a byteStride-8 view @40.
    const quantBytes = new Uint8Array(56);
    const qdv = new DataView(quantBytes.buffer);
    [1, 2, 3, 4, 5, 6].forEach((v, i) => qdv.setFloat32(i * 4, v, true));
    for (let i = 0; i < 2; i++) qdv.setInt16(24 + i * 8 + 6, 32767, true);
    quantBytes.set([255, 0, 0, 255], 40);
    quantBytes.set([0, 255, 0, 255], 48);
    instView.loadModel(
      mkInstGlb(
        quantBytes,
        [
          {bufferView: 1, componentType: 5126, count: 2, type: 'VEC3'},
          {
            bufferView: 1,
            byteOffset: 24,
            componentType: 5122,
            normalized: true,
            count: 2,
            type: 'VEC4',
          },
          {
            bufferView: 2,
            byteOffset: 40,
            componentType: 5121,
            normalized: true,
            count: 2,
            type: 'VEC4',
          },
        ],
        {TRANSLATION: 1, ROTATION: 2, _COLOR_0: 3},
      ),
    );
    const qm = instView.meshes[0]?.instanceMatrices;
    const qc = instView.meshes[0]?.instanceColors;
    assert(
      !!qm &&
        Math.abs(qm[0] - 1) < 1e-4 &&
        Math.abs(qm[5] - 1) < 1e-4 &&
        Math.abs(qm[10] - 1) < 1e-4 &&
        qm[12] === 1 &&
        qm[28] === 4 &&
        !!qc &&
        Math.abs(qc[0] - 1) < 1e-6 &&
        Math.abs(qc[4] - 1) < 1e-6 &&
        qc[3] === 0,
      'instancing reader honors normalized int16 ROTATION, uint8 _COLOR_0 and byteStride',
    );

    // Real GPU instancing: per-instance attributes with divisor 1 and a single
    // drawArraysInstanced per primitive instead of one draw per instance.
    {
      const calls: Record<string, unknown[][]> = {};
      const rec =
        (name: string) =>
        (...args: unknown[]) => {
          (calls[name] ??= []).push(args);
          return {};
        };
      const instGl = new Proxy(
        {
          canvas: {width: 400, height: 400},
          getShaderParameter: () => true,
          getProgramParameter: () => true,
          getAttribLocation: () => 0,
          vertexAttribDivisor: rec('vertexAttribDivisor'),
          drawArraysInstanced: rec('drawArraysInstanced'),
          drawElementsInstanced: rec('drawElementsInstanced'),
          drawArrays: rec('drawArrays'),
          drawElements: rec('drawElements'),
        },
        {
          get(target: Record<string, unknown>, prop: string) {
            if (prop in target) return target[prop];
            return () => ({});
          },
        },
      );
      const c = {...mockCanvas, getContext: () => instGl};
      const v = new ThreeView(c, c, {autoRotate: false});
      v.loadModel(
        mkInstGlb(
          quantBytes,
          [
            {bufferView: 1, componentType: 5126, count: 2, type: 'VEC3'},
            {
              bufferView: 1,
              byteOffset: 24,
              componentType: 5122,
              normalized: true,
              count: 2,
              type: 'VEC4',
            },
          ],
          {TRANSLATION: 1, ROTATION: 2},
        ),
      );
      for (const k of Object.keys(calls)) calls[k] = [];
      v.render();
      const inst = calls['drawArraysInstanced'] ?? [];
      const divisors = (calls['vertexAttribDivisor'] ?? []).length;
      assert(
        v.meshes[0]?.primitives[0]?.instanced === true &&
          inst.length >= 1 &&
          inst.every((a) => a[3] === 2) &&
          (calls['drawArrays'] ?? []).length === 0,
        `instanced meshes draw once per primitive with drawArraysInstanced (instanced draws: ${inst.length}, plain draws: ${(calls['drawArrays'] ?? []).length}, divisors at load: ${divisors})`,
      );
    }

    // Short ROTATION accessor and an out-of-bounds SCALE are skipped, not NaN.
    const shortBytes = new Uint8Array(48 + 16);
    for (let i = 0; i < 4; i++) {
      new DataView(shortBytes.buffer).setFloat32(i * 12, i, true);
    }
    instView.loadModel(
      mkInstGlb(
        shortBytes,
        [
          {bufferView: 1, componentType: 5126, count: 4, type: 'VEC3'},
          {
            bufferView: 1,
            byteOffset: 48,
            componentType: 5126,
            count: 2,
            type: 'VEC4',
          },
          {
            bufferView: 1,
            byteOffset: 61,
            componentType: 5126,
            count: 4,
            type: 'VEC3',
          },
        ],
        {TRANSLATION: 1, ROTATION: 2, SCALE: 3},
      ),
    );
    const sm = instView.meshes[0]?.instanceMatrices;
    assert(
      noNaN(sm) &&
        sm!.length === 64 &&
        sm![48 + 12] === 3 &&
        sm![48] === 1 &&
        boundsOk(),
      'instancing skips short / out-of-bounds accessors: identity rotation & scale, no NaN bounds',
    );

    // A failed load releases every texture it created.
    glCounts.createTexture = 0;
    glCounts.deleteTexture = 0;
    let instThrew = false;
    try {
      instView.loadModel(
        mkInstGlb(
          new Uint8Array(12),
          [{bufferView: 1, componentType: 5126, count: 10001, type: 'VEC3'}],
          {TRANSLATION: 1},
          {
            textures: [{source: 0}, {source: 0}],
            images: [{uri: 'javascript:void(0)'}],
          },
        ),
      );
    } catch {
      instThrew = true;
    }
    assert(
      instThrew &&
        glCounts.createTexture === 2 &&
        glCounts.deleteTexture === glCounts.createTexture,
      `buildGpuScene releases textures when it throws (created ${glCounts.createTexture}, deleted ${glCounts.deleteTexture})`,
    );

    // Unnamed variants keep indices; 'default' is a selectable name; stale
    // variant names are cleared when the next model lacks them.
    const variantGlb = (names: Array<string | undefined>) => {
      const g = mkInstGlb(new Uint8Array(0), [], {});
      // tslint:disable-next-line:no-any Mutating a loosely-typed glTF fixture.
      const gltf: any = g.gltf;
      delete gltf.nodes[0].extensions;
      gltf.materials = [{}, {}, {}];
      gltf.extensions = {
        KHR_materials_variants: {
          variants: names.map((name) => (name ? {name} : {})),
        },
      };
      gltf.meshes[0].primitives[0].material = 0;
      gltf.meshes[0].primitives[0].extensions = {
        KHR_materials_variants: {
          mappings: [
            {material: 1, variants: [1]},
            {material: 2, variants: [2]},
          ],
        },
      };
      return g;
    };
    instView.loadModel(variantGlb([undefined, 'Gold', 'default']));
    const goldOk =
      instView.selectVariant('Gold') &&
      instView.meshes[0].primitives[0].materialIndex === 1;
    const defaultOk =
      instView.selectVariant('default') &&
      instView.getVariantName() === 'default' &&
      instView.meshes[0].primitives[0].materialIndex === 2;
    instView.selectVariant('Gold');
    instView.loadModel(variantGlb(['Silver']));
    assert(
      goldOk &&
        defaultOk &&
        instView.getAvailableVariants()[0] === 'Silver' &&
        instView.getVariantName() === null,
      'variants keep indices for unnamed entries, select "default" by name, and clear stale names on load',
    );

    // Variant switching re-resolves the shader and transmission per material:
    // unlit default -> plain PBR variant drops the custom program, and an
    // opaque variant over a transmissive default is not drawn transmissive.
    registerPlugin(materialsPlugin);
    const shaderGlb = variantGlb([undefined, 'Plain', 'Glass']);
    // tslint:disable-next-line:no-any Mutating a loosely-typed glTF fixture.
    const sg: any = shaderGlb.gltf;
    sg.materials = [
      {extensions: {KHR_materials_unlit: {}}},
      {},
      {extensions: {KHR_materials_transmission: {transmissionFactor: 1}}},
    ];
    instView.loadModel(shaderGlb);
    const prim0 = instView.meshes[0].primitives[0];
    const unlitProgram = prim0.customProgram;
    instView.selectVariant('Plain');
    const plainProgram = prim0.customProgram;
    const plainTrans = prim0.isTransmissive;
    instView.selectVariant('Glass');
    const glassTrans = prim0.isTransmissive;
    instView.selectVariant(null);
    assert(
      !!unlitProgram &&
        plainProgram === null &&
        plainTrans === false &&
        glassTrans === true &&
        prim0.customProgram === unlitProgram,
      'variant switching re-resolves custom shaders and transmission for the selected material (cached per material)',
    );

    // Exposure is a pre-tone-mapping multiplier, independent of IBL strength.
    instView.setExposure(2);
    const exp2 = instView.getExposure();
    instView.setExposure(Number.NaN);
    assert(
      exp2 === 2 && instView.getExposure() === 1,
      'setExposure stores a finite linear exposure (NaN -> 1) read back by getExposure',
    );
    instView.setExposure(1);

    // WebGL context loss: rendering stops while lost; restore recompiles the
    // core programs, notifies plugins, and re-uploads the last model.
    {
      const listeners: Record<string, (e: Event) => void> = {};
      let programs = 0;
      let restoredHooks = 0;
      registerPlugin({
        name: 'ctx-restore-probe',
        onContextRestored: () => {
          restoredHooks++;
        },
      });
      const lossGl = new Proxy(
        {
          canvas: {width: 400, height: 400},
          getShaderParameter: () => true,
          getProgramParameter: () => true,
          getAttribLocation: () => 0,
          createProgram: () => {
            programs++;
            return {};
          },
        },
        {
          get(target: Record<string, unknown>, prop: string) {
            if (prop in target) return target[prop];
            return () => ({});
          },
        },
      );
      const lossCanvas = {
        ...mockCanvas,
        getContext: () => lossGl,
        addEventListener: (type: string, fn: (e: Event) => void) => {
          listeners[type] = fn;
        },
        removeEventListener: () => {},
      };
      const lv = new ThreeView(lossCanvas, lossCanvas, {autoRotate: false});
      lv.loadModel(variantGlb(['A']));
      const programsBefore = programs;
      let prevented = false;
      listeners['webglcontextlost']?.({
        preventDefault: () => {
          prevented = true;
        },
      } as unknown as Event);
      const lostFlag = lv.contextLost;
      lv.render(); // no-op while lost
      listeners['webglcontextrestored']?.({} as Event);
      assert(
        prevented &&
          lostFlag &&
          !lv.contextLost &&
          programs >= programsBefore + 2 &&
          restoredHooks === 1 &&
          lv.meshes.length === 1,
        `WebGL context loss pauses rendering and restore rebuilds programs, plugins and the last model (programs ${programsBefore} -> ${programs}, hooks ${restoredHooks})`,
      );
    }

    // 25. Distance-Based Level of Detail (lodPlugin & LodController)
    {
      registerPlugin(lodPlugin);
      const lodScene = new THREE.Scene();
      const lod = new THREE.LOD();
      lod.name = 'LodStatue';
      const m0 = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({color: 0x38bdf8}),
      );
      m0.name = 'LodStatue_L0';
      const m1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        new THREE.MeshStandardMaterial({color: 0x22c55e}),
      );
      m1.name = 'LodStatue_L1';
      lod.addLevel(m0, 0);
      lod.addLevel(m1, 5);
      lod.userData.xr = {
        lod: {distances: [0, 5], cullDistance: 15, hysteresis: 0.05},
      };
      lodScene.add(lod);
      const lodGlb = parseGLB(lodScene.toGLB().buffer);
      instView.loadModel(lodGlb);
      const ctrl = getLodController(instView);
      assert(
        ctrl !== undefined && ctrl.getGroups().length === 1,
        'lodPlugin registers LodController on ThreeView with 1 LOD group',
      );
      instView.setOrbitLimits({minDistance: 0.1, maxDistance: 100});
      instView.setTarget(0, 0, 0);
      instView.setCamera(0, 0, 2.0);
      instView.jumpCameraToGoal();
      lodPlugin.onUpdate?.(instView, 1 / 60);
      const activeNear = ctrl!.getActiveLevel('LodStatue');
      const visNear0 = instView.meshes[0]?.visible;
      const visNear1 = instView.meshes[1]?.visible;

      instView.setCamera(0, 0, 8.0);
      instView.jumpCameraToGoal();
      lodPlugin.onUpdate?.(instView, 1 / 60);
      const activeFar = ctrl!.getActiveLevel('LodStatue');
      const visFar0 = instView.meshes[0]?.visible;
      const visFar1 = instView.meshes[1]?.visible;

      instView.setCamera(0, 0, 20.0);
      instView.jumpCameraToGoal();
      lodPlugin.onUpdate?.(instView, 1 / 60);
      const activeCulled = ctrl!.getActiveLevel('LodStatue');
      const visCulled0 = instView.meshes[0]?.visible;
      const visCulled1 = instView.meshes[1]?.visible;

      ctrl!.forceLodLevel('LodStatue', 0);
      const activeForced = ctrl!.getActiveLevel('LodStatue');
      const visForced0 = instView.meshes[0]?.visible;
      const visForced1 = instView.meshes[1]?.visible;
      ctrl!.forceLodLevel('LodStatue', null);

      assert(
        activeNear === 0 &&
          visNear0 === true &&
          visNear1 === false &&
          activeFar === 1 &&
          visFar0 === false &&
          visFar1 === true &&
          activeCulled === -1 &&
          visCulled0 === false &&
          visCulled1 === false &&
          activeForced === 0 &&
          visForced0 === true &&
          visForced1 === false,
        'LodController switches ThreeView child mesh visibility across near, far, culled, and forced LOD levels',
      );
    }
  }

  console.log(
    `\n🏆 three-view Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runThreeViewTests();
