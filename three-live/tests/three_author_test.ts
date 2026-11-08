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

import {registerPlugin} from '../src/plugin';
import {
  cadPlugin,
  installCadExtension,
  MAX_BSP_DEPTH,
  MAX_SHAPE_POINTS,
  MAX_TEXT_GEOMETRY_CHARS,
} from '../src/plugins/cad';
import {
  decimateGeometry,
  installLodExtension,
  lodPlugin,
} from '../src/plugins/lod';
import {
  applyMeshoptFilter,
  decodeMeshoptBuffer,
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
  MAX_MESHOPT_COUNT,
  meshoptDecoder,
  type MeshoptFilter,
} from '../src/plugins/meshopt';
import {
  extractMaterialVariants,
  extractPrimitiveVariantMappings,
  selectMaterialVariant,
} from '../src/plugins/variants';
import THREE, {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector3,
  WebGLRenderer,
} from '../src/three-author';

registerPlugin(cadPlugin);
registerPlugin(lodPlugin);
const {Path, Shape, ShapeGeometry, ExtrudeGeometry, TextGeometry, CSG} = THREE;

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

function runThreeAuthorTests() {
  console.log('🤖 Running three-author Unit Tests...\n');

  // 1. Math and Vectors
  const v1 = new Vector3(1, 2, 3);
  const v2 = new Vector3(4, 5, 6);
  v1.add(v2);
  assert(v1.x === 5 && v1.y === 7 && v1.z === 9, 'Vector3 addition');
  assert(v1.dot(v2) === 5 * 4 + 7 * 5 + 9 * 6, 'Vector3 dot product');

  const vLerp = new Vector3(0, 10, 20).lerp(new Vector3(10, 20, 40), 0.25);
  assert(
    vLerp.x === 2.5 && vLerp.y === 12.5 && vLerp.z === 25,
    'Vector3.lerp interpolates components',
  );
  const vLerpVecs = new Vector3().lerpVectors(
    new Vector3(-2, 0, 4),
    new Vector3(6, 8, -4),
    0.5,
  );
  assert(
    vLerpVecs.x === 2 && vLerpVecs.y === 4 && vLerpVecs.z === 0,
    'Vector3.lerpVectors interpolates between v1 and v2',
  );

  const qNorm = new Quaternion(0, 0, 2, 2).normalize();
  assert(
    Math.abs(Math.hypot(qNorm.x, qNorm.y, qNorm.z, qNorm.w) - 1) < 1e-6 &&
      Math.abs(qNorm.z - Math.SQRT1_2) < 1e-6,
    'Quaternion.normalize normalizes to unit length',
  );
  const qZero = new Quaternion(0, 0, 0, 0).normalize();
  assert(
    qZero.x === 0 && qZero.y === 0 && qZero.z === 0 && qZero.w === 1,
    'Quaternion.normalize handles zero quaternion safely',
  );
  const qUnit = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    new Vector3(1, 0, 0),
  );
  assert(
    Math.abs(qUnit.z + Math.SQRT1_2) < 1e-6 &&
      Math.abs(qUnit.w - Math.SQRT1_2) < 1e-6,
    'Quaternion.setFromUnitVectors 90-degree rotation (+Y to +X)',
  );
  const qOpposite = new Quaternion().setFromUnitVectors(
    new Vector3(0, 1, 0),
    new Vector3(0, -1, 0),
  );
  assert(
    Math.abs(
      Math.hypot(qOpposite.x, qOpposite.y, qOpposite.z, qOpposite.w) - 1,
    ) < 1e-6 && Math.abs(qOpposite.w) < 1e-6,
    'Quaternion.setFromUnitVectors 180-degree opposite vectors',
  );

  const c = new Color(0xff0000);
  assert(c.r === 1 && c.g === 0 && c.b === 0, 'Color hex parsing');
  c.setHex(0x808080);
  assert(
    Math.abs(c.r - 0.2158605) < 1e-5 && c.getHex() === 0x808080,
    'Color setHex sRGB-to-linear and getHex round-trip',
  );
  c.setStyle('#3366ff');
  assert(
    Math.abs(c.r - 0.0331048) < 1e-5 &&
      Math.abs(c.g - 0.1328683) < 1e-5 &&
      c.b === 1 &&
      c.getHex() === 0x3366ff,
    'Color CSS hex sRGB-to-linear and getHex round-trip',
  );
  c.setRGB(0.5, 0.5, 0.5);
  assert(
    c.r === 0.5 && c.getHex() === 0xbcbcbc,
    'Color linear setRGB to sRGB getHex',
  );

  // 2. Geometries
  const box = new BoxGeometry(2, 2, 2);
  assert(box.attributes.position.count === 24, 'BoxGeometry vertex count');
  assert(box.index!.count === 36, 'BoxGeometry index count');

  const cyl = new CylinderGeometry(1, 1, 2, 16);
  assert(
    cyl.attributes.position.count === (16 + 1) * 4 + 2,
    'CylinderGeometry capped vertex count',
  );
  assert(
    cyl.index!.count === 16 * 6 + 16 * 3 * 2,
    'CylinderGeometry capped index count',
  );

  const sphere = new SphereGeometry(1, 16, 16);
  assert(sphere.attributes.position.count > 0, 'SphereGeometry vertices');

  const torus = new TorusGeometry(10, 3, 16, 32);
  assert(torus.attributes.position.count > 0, 'TorusGeometry vertices');

  const knot = new TorusKnotGeometry(10, 3, 32, 8);
  assert(knot.attributes.position.count > 0, 'TorusKnotGeometry vertices');

  // 3. Scene graph & Lights
  const scene = new Scene();
  const group = new Group();
  const mat = new MeshStandardMaterial({
    color: 0x00ff00,
    roughness: 0.3,
    metalness: 0.7,
  });
  const mesh = new Mesh(box, mat);
  mesh.name = 'MyBox';
  mesh.position.set(3, 4, 5);
  group.add(mesh);
  scene.add(group);

  const dirLight = new DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const ambLight = new AmbientLight(0x404040, 0.5);
  scene.add(ambLight);

  const ptLight = new PointLight(0xff8800, 2.0, 50);
  ptLight.position.set(-2, 4, 1);
  scene.add(ptLight);

  // 4. Exporters
  const payload = scene.toCanvas3D();
  assert(payload.lights!.length === 3, 'toCanvas3D includes 3 dynamic lights');
  assert(
    payload.gltf.asset.version === '2.0',
    'toCanvas3D generates valid glTF 2.0 AST',
  );
  assert(
    payload.bin instanceof ArrayBuffer,
    'toCanvas3D generates binary buffer',
  );

  const glb = scene.toGLB();
  assert(glb instanceof Uint8Array, 'toGLB generates binary GLB');
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert(dv.getUint32(0, true) === 0x46546c67, 'GLB magic check 0x46546c67');
  assert(dv.getUint32(4, true) === 2, 'GLB version 2 check');

  // 5. Option B Matrix-Only 60 FPS Reactive Transforms
  const transforms = scene.getMeshTransforms();
  assert(transforms instanceof Map, 'getMeshTransforms returns Map');
  assert(transforms.has('MyBox'), 'getMeshTransforms contains mesh by name');
  assert(
    transforms.get('MyBox')![12] === 3,
    'Transform contains X translation',
  );

  // 6. WebGLRenderer Reactive Handoff
  let loadModelCalls = 0;
  let updateTransformCalls = 0;
  const mockViewer = {
    loadModel: () => {
      loadModelCalls++;
    },
    updateMeshTransforms: () => {
      updateTransformCalls++;
    },
  };
  const renderer = new WebGLRenderer({viewer: mockViewer});
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);

  renderer.render(scene, camera);
  assert(
    loadModelCalls === 1 && updateTransformCalls === 0,
    'Renderer triggers loadModel on frame 1',
  );

  mesh.position.x = 10;
  renderer.render(scene, camera);
  assert(
    loadModelCalls === 1 && updateTransformCalls === 1,
    'Renderer triggers updateMeshTransforms on frame 2',
  );

  // 7. Permissive Chaining Proxy & LLM Fallback Shims for Unsupported APIs
  THREE.clearAuthorWarnings();
  const controls = new (THREE as any).OrbitControls(camera, null);
  controls.enableDamping = true;
  controls.update();

  const axes = new (THREE as any).AxesHelper(5);
  scene.add(axes);

  const spot = new THREE.SpotLight(0xff0000, 1.5);
  scene.add(spot);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.8);
  scene.add(hemi);
  scene.add(new THREE.RectAreaLight(0xffffff, 0.5));

  const shaderMat = new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color(0x00ff88)}},
  });
  const icosa = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.4, 1),
    shaderMat,
  );
  scene.add(icosa);

  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.6),
    new THREE.MeshStandardMaterial({color: 0x3b82f6}),
  );
  scene.add(capsule);

  // Even a Mesh passed completely unknown proxy geometry/material must degrade safely and export to GLB
  const unknownMesh = new THREE.Mesh(
    new (THREE as any).CompletelyInventedGeometry(1, 2, 3),
    new (THREE as any).CompletelyInventedMaterial({foo: 'bar'}),
  );
  scene.add(unknownMesh);

  (THREE as any).NonExistentModule.Deeply.Nested.Call('foo', 123).chain();

  const fallbackGlb = scene.toGLB();
  const warnings = THREE.getAuthorWarnings();
  assert(
    fallbackGlb.byteLength > 100 &&
      warnings.some((w: string) => w.includes('ShaderMaterial')) &&
      warnings.some((w: string) => w.includes('RectAreaLight')) &&
      !warnings.some((w: string) => w.includes('HemisphereLight')) &&
      !warnings.some((w: string) => w.includes('IcosahedronGeometry')) &&
      !warnings.some((w: string) => w.includes('CapsuleGeometry')) &&
      !warnings.some((w: string) => w.includes('SpotLight')),
    'Permissive fallback shims degrade unsupported LLM geometries/materials to valid GLB meshes and record warnings',
  );

  // Native polyhedron geometries (Tetrahedron, Octahedron, Icosahedron, Dodecahedron)
  const tetra0 = new THREE.TetrahedronGeometry(1, 0);
  const octa0 = new THREE.OctahedronGeometry(1, 0);
  const icosa0 = new THREE.IcosahedronGeometry(1, 0);
  const dodeca0 = new THREE.DodecahedronGeometry(1, 0);
  const icosa1 = new THREE.IcosahedronGeometry(1, 1);
  assert(
    tetra0.attributes.position.count === 12 &&
      octa0.attributes.position.count === 24 &&
      icosa0.attributes.position.count === 60 &&
      dodeca0.attributes.position.count === 108 &&
      icosa1.attributes.position.count === 240,
    'Native Polyhedron geometries (Tetrahedron, Octahedron, Icosahedron, Dodecahedron) generate exact facet & subdivided vertex counts',
  );

  // Native CapsuleGeometry, RingGeometry, CircleGeometry, SpotLight, Points, and Line/Edges/Wireframe lowering
  {
    const capGeo = new THREE.CapsuleGeometry(0.5, 1.0, 4, 8);
    capGeo.computeBoundingBox();
    const ringGeo = new THREE.RingGeometry(0.5, 1.0, 16, 1);
    const circleGeo = new THREE.CircleGeometry(1.0, 16);
    assert(
      capGeo.attributes.position.count === 90 &&
        Math.abs((capGeo.boundingBox?.max.y ?? 0) - 1.0) < 1e-4 &&
        ringGeo.attributes.position.count === 34 &&
        (ringGeo.index?.count ?? 0) === 96 &&
        circleGeo.attributes.position.count === 34 &&
        (circleGeo.index?.count ?? 0) === 48,
      'Native CapsuleGeometry, RingGeometry, and CircleGeometry generate true hemispherical caps, annulus holes, and planar disks',
    );

    const spotLight = new THREE.SpotLight(0xffaa00, 2.5, 15, Math.PI / 4, 0.5, 2);
    spotLight.position.set(0, 5, 5);
    spotLight.lookAt(1, 0, -2);
    assert(
      spotLight.type === 'spot' &&
        spotLight.target.position.x === 1 &&
        spotLight.target.position.y === 0 &&
        spotLight.target.position.z === -2 &&
        spotLight.penumbra === 0.5,
      'Native SpotLight preserves cone angle, penumbra, range, and target.position on lookAt()',
    );

    // Points + deferred BufferGeometry + Line / EdgesGeometry / WireframeGeometry lowering
    const ptsGeo = new THREE.BufferGeometry();
    const ptsMat = new THREE.PointsMaterial({color: 0x00ffcc, size: 0.08});
    const ptsObj = new THREE.Points(ptsGeo, ptsMat);
    // Deferred attribute assignment after Points construction (common in LLM particle scripts)
    ptsGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1, -1, 2, 0], 3),
    );

    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1), 15);
    const lineSegs = new THREE.LineSegments(
      edgesGeo,
      new THREE.LineBasicMaterial({color: 0xffffff}),
    );
    const wireGeo = new THREE.WireframeGeometry(new THREE.TetrahedronGeometry(1, 0));
    const wireLine = new THREE.LineSegments(
      wireGeo,
      new THREE.LineDashedMaterial({color: 0xff0088}),
    );
    const clonedPts = ptsObj.clone();
    const lowerScene = new THREE.Scene();
    lowerScene.add(ptsObj, lineSegs, wireLine);
    const lowerGlb = lowerScene.toGLB();
    assert(
      lowerGlb.byteLength > 200 &&
        clonedPts instanceof THREE.Points &&
        ptsObj.geometry.attributes.position.count === 3 * 6 &&
        (ptsObj.geometry.index?.count ?? 0) === 3 * 24 &&
        edgesGeo.attributes.position.count === 12 * 2 &&
        lineSegs.geometry.attributes.position.count > 24 &&
        wireGeo.attributes.position.count === 6 * 2,
      'Points, LineSegments, EdgesGeometry, and WireframeGeometry lower cleanly to renderable triangle meshes (including deferred BufferGeometry and clone())',
    );
  }

  // 8. EXT_meshopt_compression (ATTRIBUTES, TRIANGLES, INDICES + Filters + Caps)
  {
    const attrCount = 20;
    const attrStride = 8;
    const attrOrig = new Uint8Array(attrCount * attrStride);
    for (let i = 0; i < attrOrig.length; i++) {
      attrOrig[i] = (i * 13 + 7) & 0xff;
    }
    const attrCompressed = encodeMeshoptBuffer(
      attrOrig,
      attrCount,
      attrStride,
      'ATTRIBUTES',
    );
    const attrDecoded = decodeMeshoptBuffer(
      attrCompressed,
      attrCount,
      attrStride,
      'ATTRIBUTES',
    );
    let attrMatch = attrDecoded.length === attrOrig.length;
    for (let i = 0; i < attrOrig.length && attrMatch; i++) {
      if (attrDecoded[i] !== attrOrig[i]) attrMatch = false;
    }
    assert(attrMatch, 'meshopt ATTRIBUTES encode/decode round-trip');

    const triIndices = [0, 1, 2, 0, 2, 3, 2, 1, 4, 3, 2, 5];
    const triRaw = new Uint8Array(new Uint16Array(triIndices).buffer);
    const triComp = encodeMeshoptBuffer(
      triRaw,
      triIndices.length,
      2,
      'TRIANGLES',
    );
    const triDec = new Uint16Array(
      decodeMeshoptBuffer(triComp, triIndices.length, 2, 'TRIANGLES').buffer,
    );
    assert(
      triDec.length === triIndices.length &&
        triDec[0] === 0 &&
        triDec[5] === 3 &&
        triDec[8] === 4 &&
        triDec[11] === 5,
      'meshopt TRIANGLES 16-bit FIFO/edge round-trip',
    );

    const idxValues = [0, 1, 2, 3, 10, 11, 12, 50];
    const idxRaw = new Uint8Array(new Uint32Array(idxValues).buffer);
    const idxComp = encodeMeshoptBuffer(idxRaw, idxValues.length, 4, 'INDICES');
    const idxDec = new Uint32Array(
      decodeMeshoptBuffer(idxComp, idxValues.length, 4, 'INDICES').buffer,
    );
    assert(
      idxDec.length === idxValues.length &&
        idxDec[4] === 10 &&
        idxDec[7] === 50,
      'meshopt INDICES 32-bit varint delta round-trip',
    );

    // Filters: OCTAHEDRAL, QUATERNION, EXPONENTIAL
    const octBuf = new Uint8Array(4);
    const octView = new Int8Array(octBuf.buffer);
    octView[0] = 0;
    octView[1] = 0;
    octView[2] = 100;
    octView[3] = 127;
    applyMeshoptFilter(octBuf, 1, 4, 'OCTAHEDRAL');
    assert(
      octView[0] === 0 && octView[1] === 0 && octView[2] === 127,
      'meshopt OCTAHEDRAL 4-byte filter decodes +Z unit vector',
    );

    const quatBuf = new Uint8Array(8);
    const quatView = new Int16Array(quatBuf.buffer);
    quatView[0] = 0;
    quatView[1] = 0;
    quatView[2] = 0;
    quatView[3] = 0x4000 | 3; // maxComponent = 3 (w = 1)
    applyMeshoptFilter(quatBuf, 1, 8, 'QUATERNION');
    assert(
      quatView[0] === 0 &&
        quatView[1] === 0 &&
        quatView[2] === 0 &&
        quatView[3] === 32767,
      'meshopt QUATERNION 8-byte filter reconstructs identity quaternion',
    );

    const expBuf = new Uint8Array(4);
    const expIn = new DataView(expBuf.buffer);
    // e = -1, m = 1 -> 2^-1 * 1 = 0.5
    expIn.setInt32(0, (-1 << 24) | 1, true);
    applyMeshoptFilter(expBuf, 1, 4, 'EXPONENTIAL');
    assert(
      Math.abs(expIn.getFloat32(0, true) - 0.5) < 1e-6,
      'meshopt EXPONENTIAL filter reconstructs IEEE-754 float',
    );

    let bombCaught = false;
    try {
      decodeMeshoptBuffer(
        new Uint8Array([0xba, 1]),
        MAX_MESHOPT_COUNT + 1,
        4,
        'ATTRIBUTES',
      );
    } catch {
      bombCaught = true;
    }
    assert(bombCaught, 'meshopt rejects count exceeding MAX_MESHOPT_COUNT');

    // decodeMeshoptGLB end-to-end
    const fakeGltf: {
      bufferViews: Array<{
        byteLength: number;
        _decoded?: Uint8Array;
        extensions?: Record<string, unknown>;
      }>;
    } = {
      bufferViews: [
        {
          byteLength: attrOrig.byteLength,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteOffset: 0,
              byteLength: attrCompressed.byteLength,
              byteStride: attrStride,
              count: attrCount,
              mode: 'ATTRIBUTES',
            },
          },
        },
      ],
    };
    const fakeGlb = {
      gltf: fakeGltf,
      bin: attrCompressed.buffer.slice(
        attrCompressed.byteOffset,
        attrCompressed.byteOffset + attrCompressed.byteLength,
      ),
    };
    decodeMeshoptGLB(fakeGltf, fakeGlb);
    assert(
      fakeGltf.bufferViews[0]._decoded instanceof Uint8Array &&
        fakeGltf.bufferViews[0]._decoded.length === attrOrig.length &&
        fakeGltf.bufferViews[0]._decoded[5] === attrOrig[5],
      'decodeMeshoptGLB populates bufferView._decoded in-place',
    );

    // QUATERNION: out[(qc+1)&3]=x, out[(qc+2)&3]=y, out[(qc+3)&3]=z, out[qc]=w.
    for (let qc = 0; qc < 3; qc++) {
      const qBuf = new Uint8Array(8);
      const qView = new Int16Array(qBuf.buffer);
      qView.set([16384, 0, -16384, 0x7ffc | qc]);
      applyMeshoptFilter(qBuf, 1, 8, 'QUATERNION');
      assert(
        Math.abs(qView[(qc + 1) & 3] - 11585) <= 2 &&
          Math.abs(qView[(qc + 2) & 3]) <= 2 &&
          Math.abs(qView[(qc + 3) & 3] + 11585) <= 2 &&
          Math.abs(qView[qc] - 28378) <= 2,
        `meshopt QUATERNION maxComp=${qc} writes components in spec order (${Array.from(qView)})`,
      );
    }

    const throwsErr = (fn: () => unknown) => {
      try {
        fn();
        return false;
      } catch {
        return true;
      }
    };
    assert(
      throwsErr(() =>
        applyMeshoptFilter(
          new Uint8Array(8),
          1,
          8,
          'FOO' as unknown as MeshoptFilter,
        ),
      ) &&
        throwsErr(() =>
          decodeMeshoptBuffer(
            attrCompressed,
            attrCount,
            attrStride,
            'ATTRIBUTES',
            'FOO' as unknown as MeshoptFilter,
          ),
        ),
      'meshopt rejects an unknown filter value',
    );
    assert(
      throwsErr(() =>
        decodeMeshoptBuffer(new Uint8Array(16), 4, 4, 'ATTRIBUTES'),
      ) &&
        throwsErr(() =>
          decodeMeshoptBuffer(new Uint8Array(12), 6, 2, 'INDICES'),
        ),
      'meshopt rejects raw-sized streams with a wrong header instead of copying them',
    );

    // decodePrimitive must not repoint bufferViews past the caller's bin.
    const primGltf = {
      bufferViews: [
        {
          byteLength: attrOrig.byteLength,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteOffset: 0,
              byteLength: attrCompressed.byteLength,
              byteStride: attrStride,
              count: attrCount,
              mode: 'ATTRIBUTES',
            },
          },
        } as {byteOffset?: number; byteLength: number},
      ],
    };
    const primBin = attrCompressed.slice().buffer;
    meshoptDecoder.decodePrimitive(primGltf, {}, primBin);
    assert(
      primGltf.bufferViews[0].byteOffset === undefined &&
        primGltf.bufferViews[0].byteLength === attrOrig.byteLength,
      'meshoptDecoder.decodePrimitive does not repoint bufferViews past the caller bin',
    );
  }

  // 9. KHR_materials_variants (Product Configurator) & GPU Instancing (EXT_mesh_gpu_instancing)
  {
    const cfgScene = new Scene();
    const midnightMat = new MeshStandardMaterial({
      name: 'Midnight',
      color: 0x111827,
      roughness: 0.2,
    });
    const goldMat = new MeshStandardMaterial({
      name: 'SolarGold',
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.9,
    });
    const watchBody = new Mesh(new BoxGeometry(1, 1, 0.2), midnightMat);
    watchBody.name = 'WatchCase';
    watchBody.userData.variants = {
      Midnight: midnightMat,
      'Solar Gold': goldMat,
    };
    cfgScene.add(watchBody);

    // Add an InstancedMesh with 3 instances + per-instance colors
    const studGeo = new CylinderGeometry(0.05, 0.05, 0.1, 8);
    const studMat = new MeshStandardMaterial({color: 0xffffff});
    const studs = new InstancedMesh(studGeo, studMat, 3);
    studs.name = 'BezelStuds';
    for (let i = 0; i < 3; i++) {
      const m = new Matrix4().makeTranslation(i * 0.5, 0.2, 0);
      studs.setMatrixAt(i, m);
      studs.setColorAt(i, new Color(i === 0 ? 0xff0000 : 0x00ff00));
    }
    cfgScene.add(studs);

    const outM = new Matrix4();
    studs.getMatrixAt(2, outM);
    const outC = new Color();
    studs.getColorAt(0, outC);
    assert(
      Math.abs(outM.elements[12] - 1.0) < 1e-6 && outC.r === 1 && outC.g === 0,
      'InstancedMesh setMatrixAt/getMatrixAt and setColorAt/getColorAt',
    );

    const cfgPayload = cfgScene.toCanvas3D();
    const variantsList = extractMaterialVariants(cfgPayload.gltf);
    assert(
      variantsList.length === 2 &&
        variantsList.includes('Midnight') &&
        variantsList.includes('Solar Gold'),
      'KHR_materials_variants emitted in root extensions and extracted by extractMaterialVariants',
    );

    const mappings = extractPrimitiveVariantMappings(
      cfgPayload.gltf.meshes[0].primitives[0],
    );
    assert(
      mappings !== null &&
        mappings.length === 2 &&
        selectMaterialVariant(cfgPayload.gltf, mappings, 'Solar Gold', 0) === 1,
      'KHR_materials_variants primitive mappings resolve variant name to material index',
    );

    const instNode = (
      cfgPayload.gltf.nodes as Array<{
        name?: string;
        extensions?: {
          EXT_mesh_gpu_instancing?: {
            attributes?: Record<string, number>;
          };
        };
      }>
    ).find((n) => n.name === 'BezelStuds');
    assert(
      Boolean(
        instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes
          ?.TRANSLATION !== undefined &&
          instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes
            ?.ROTATION !== undefined &&
          instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes?.SCALE !==
            undefined &&
          instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes
            ?._COLOR_0 !== undefined &&
          cfgPayload.gltf.extensionsUsed?.includes('EXT_mesh_gpu_instancing'),
      ),
      'InstancedMesh emits EXT_mesh_gpu_instancing with TRANSLATION, ROTATION, SCALE, _COLOR_0',
    );

    const usdzBytes = cfgScene.toUSDZ();
    assert(
      usdzBytes instanceof Uint8Array && usdzBytes.byteLength > 200,
      'InstancedMesh expands cleanly during USDZ export',
    );

    let instQuotaCaught = false;
    try {
      const tooMany = new InstancedMesh(studGeo, studMat, 10001);
      assert(tooMany.count <= 10000, 'unreachable');
    } catch {
      instQuotaCaught = true;
    }
    assert(
      instQuotaCaught,
      'InstancedMesh enforces MAX_INSTANCES_PER_MESH = 10000 quota',
    );
  }

  // =========================================================================
  // 10. Phase 2: Shape, ExtrudeGeometry, CSG Booleans, and 3D Vector Text
  // =========================================================================
  {
    const bracketShape = new Shape();
    bracketShape.moveTo(-1, -1);
    bracketShape.lineTo(1, -1);
    bracketShape.lineTo(1, 1);
    bracketShape.quadraticCurveTo(0, 1.3, -1, 1);
    bracketShape.closePath();

    const boltHole = new Path();
    boltHole.absarc(0, 0, 0.35, 0, Math.PI * 2, false);
    bracketShape.holes.push(boltHole);

    const shapeGeo = new ShapeGeometry(bracketShape, 8);
    assert(
      Boolean(
        shapeGeo.attributes.position &&
          shapeGeo.attributes.position.count >= 10 &&
          shapeGeo.index &&
          shapeGeo.index.count >= 18,
      ),
      'ShapeGeometry triangulates outer contour with interior circular hole',
    );

    const extrudeGeo = new ExtrudeGeometry(bracketShape, {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 8,
    });
    extrudeGeo.center();
    assert(
      Boolean(
        extrudeGeo.attributes.position &&
          extrudeGeo.attributes.position.count >
            shapeGeo.attributes.position.count &&
          extrudeGeo.boundingBox &&
          Math.abs(
            extrudeGeo.boundingBox.min.z + extrudeGeo.boundingBox.max.z,
          ) < 1e-4,
      ),
      'ExtrudeGeometry generates front/back caps, bevels, and side walls and centers cleanly',
    );

    // CSG subtract, union, intersect
    const cubeA = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({color: 0x3b82f6}),
    );
    const cubeB = new Mesh(
      new BoxGeometry(0.6, 0.6, 1.4),
      new MeshStandardMaterial({color: 0xef4444}),
    );
    cubeB.position.set(0.1, 0.1, 0);

    const subMesh = CSG.subtract(cubeA, cubeB);
    const unionMesh = CSG.union(cubeA, cubeB);
    const interMesh = CSG.intersect(cubeA, cubeB);
    assert(
      Boolean(
        subMesh.geometry.attributes.position.count > 24 &&
          unionMesh.geometry.attributes.position.count > 24 &&
          interMesh.geometry.attributes.position.count > 0,
      ),
      'CSG.subtract, CSG.union, and CSG.intersect produce valid non-empty boolean meshes',
    );

    // Declarative userData.csg
    const plate = new Mesh(
      new BoxGeometry(1, 1, 0.2),
      new MeshStandardMaterial({color: 0x94a3b8}),
    );
    const punch = new Mesh(new BoxGeometry(0.4, 0.4, 0.5));
    plate.userData.csg = {op: 'subtract', target: punch};

    // TextGeometry & declarative userData.xr.text
    const textGeo = new TextGeometry('XR-2026', {
      size: 0.2,
      depth: 0.04,
    });
    assert(
      Boolean(
        textGeo.attributes.position &&
          textGeo.attributes.position.count > 40 &&
          textGeo.index &&
          textGeo.index.count > 60,
      ),
      'TextGeometry extrudes 3D vector glyph strokes without external font files',
    );

    const cadScene = new Scene();
    cadScene.add(subMesh);
    cadScene.add(plate);
    const labelNode = new Mesh();
    labelNode.name = 'PartNumber';
    labelNode.userData.xr = {
      text: {text: 'PART #42', size: 0.12, depth: 0.02, color: '#38bdf8'},
    };
    cadScene.add(labelNode);

    const cadGlb = cadScene.toGLB();
    assert(
      cadGlb instanceof Uint8Array &&
        cadGlb.byteLength > 1000 &&
        labelNode.geometry.attributes.position.count > 20,
      'Scene with CSG, declarative userData.csg, and userData.xr.text compiles to GLB',
    );

    // Regression test: high-segment beveled ExtrudeGeometry with interior bore
    // hole + cross-slot CSG.subtract must clip cutter top caps above the flange
    // surface (no stray inverted cap triangles at y = 0.25 that would paint
    // solid during inverted-hull outline rendering).
    const flangeShape = new Shape();
    flangeShape.absarc(0, 0, 1.25, 0, Math.PI * 2, false);
    const centerBore = new Path();
    centerBore.absarc(0, 0, 0.48, 0, Math.PI * 2, true);
    flangeShape.holes.push(centerBore);

    const flangeGeo = new ExtrudeGeometry(flangeShape, {
      depth: 0.38,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 36,
    });
    flangeGeo.center();

    const rawBlank = new Mesh(
      flangeGeo,
      new MeshStandardMaterial({color: 0x94a3b8}),
    );
    rawBlank.rotation.x = -Math.PI / 2;

    const slotX = new Mesh(new BoxGeometry(2.8, 0.26, 0.32));
    slotX.position.set(0, 0.12, 0);
    const slotZ = new Mesh(new BoxGeometry(0.32, 0.26, 2.8));
    slotZ.position.set(0, 0.12, 0);

    const step1 = CSG.subtract(rawBlank, slotX);
    const machinedFlange = CSG.subtract(step1, slotZ);
    const flangePos = machinedFlange.geometry.attributes.position
      .array as Float32Array;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 2; i < flangePos.length; i += 3) {
      if (flangePos[i] < minZ) minZ = flangePos[i];
      if (flangePos[i] > maxZ) maxZ = flangePos[i];
    }
    assert(
      Boolean(
        maxZ <= 0.231 &&
          minZ >= -0.231 &&
          machinedFlange.geometry.attributes.position.count > 500,
      ),
      'CSG.subtract on 36-segment beveled ExtrudeGeometry clips all cutter caps above top surface',
    );

    runCadRegressionTests(cubeA, cubeB, subMesh, unionMesh, interMesh, plate);
  }

  console.log(
    `\n🏆 three-author Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

// ---------------------------------------------------------------------------
// CAD / CSG / Text geometry helpers and regression tests (audit F1-F10).
// ---------------------------------------------------------------------------

/** Minimal structural view of a BufferGeometry used by the CAD helpers. */
interface TestGeometry {
  index: {array: ArrayLike<number>; count: number} | null;
  attributes: {
    [name: string]: {
      count: number;
      array: ArrayLike<number>;
      getX(i: number): number;
      getY(i: number): number;
      getZ(i: number): number;
    };
  };
}

/** Iterates indexed (or non-indexed) triangles as [i0, i1, i2] vertex ids. */
function forEachTri(
  geo: TestGeometry,
  fn: (a: number, b: number, c: number) => void,
) {
  const idx = geo.index ? geo.index.array : null;
  const n = idx ? idx.length : geo.attributes.position.count;
  for (let t = 0; t + 2 < n; t += 3) {
    if (idx) fn(idx[t], idx[t + 1], idx[t + 2]);
    else fn(t, t + 1, t + 2);
  }
}

function vtx(geo: TestGeometry, i: number, name = 'position'): number[] {
  const a = geo.attributes[name];
  return [a.getX(i), a.getY(i), a.getZ(i)];
}

function sub3(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Generic normals-vs-winding check: every non-degenerate triangle's
 * geometric normal must agree with the stored normal of each of its vertices.
 * Returns the number of offending triangles.
 */
function countNormalWindingMismatches(geo: TestGeometry): number {
  let bad = 0;
  forEachTri(geo, (a, b, c) => {
    const p0 = vtx(geo, a);
    const fn = cross3(sub3(vtx(geo, b), p0), sub3(vtx(geo, c), p0));
    const len = Math.hypot(fn[0], fn[1], fn[2]);
    if (len < 1e-10) return;
    for (const v of [a, b, c]) {
      if (dot3(fn, vtx(geo, v, 'normal')) <= 0) {
        bad++;
        return;
      }
    }
  });
  return bad;
}

/** Sum of signed XY triangle areas, plus the most negative single triangle. */
function xyAreaStats(geo: TestGeometry): {sum: number; minTri: number} {
  let sum = 0;
  let minTri = Infinity;
  forEachTri(geo, (a, b, c) => {
    const p0 = vtx(geo, a);
    const p1 = vtx(geo, b);
    const p2 = vtx(geo, c);
    const ar =
      0.5 *
      ((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]));
    sum += ar;
    minTri = Math.min(minTri, ar);
  });
  return {sum, minTri};
}

function polyArea(pts: Array<{x: number; y: number}>): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return Math.abs(a) * 0.5;
}

/** Enclosed volume via the divergence theorem (sum of signed tetrahedra). */
function meshVolume(geo: TestGeometry): number {
  let vol = 0;
  forEachTri(geo, (a, b, c) => {
    vol += dot3(vtx(geo, a), cross3(vtx(geo, b), vtx(geo, c))) / 6;
  });
  return vol;
}

function surfaceArea(geo: TestGeometry): number {
  let area = 0;
  forEachTri(geo, (a, b, c) => {
    const p0 = vtx(geo, a);
    const n = cross3(sub3(vtx(geo, b), p0), sub3(vtx(geo, c), p0));
    area += 0.5 * Math.hypot(n[0], n[1], n[2]);
  });
  return area;
}

function allFinite(geo: TestGeometry): boolean {
  const arr = geo.attributes.position.array;
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return arr.length > 0;
}

/** Asserts a ShapeGeometry covers exactly `expected` area with no flipped tris. */
function assertShapeArea(
  geo: TestGeometry,
  expected: number,
  testName: string,
) {
  const {sum, minTri} = xyAreaStats(geo);
  assert(
    Math.abs(sum - expected) < 1e-6 * Math.max(1, expected) &&
      minTri >= -1e-9 * Math.max(1, expected),
    `${testName} (area ${sum.toFixed(6)} vs ${expected.toFixed(6)}, min tri ${minTri})`,
  );
}

function runCadRegressionTests(
  cubeA: Mesh,
  cubeB: Mesh,
  subMesh: Mesh,
  unionMesh: Mesh,
  interMesh: Mesh,
  plate: Mesh,
) {
  // F1: convex operand with ~1100 planes must give a correct boolean.
  {
    const r = CSG.subtract(
      new Mesh(new BoxGeometry(1, 1, 1)),
      new Mesh(new SphereGeometry(0.7, 48, 24)),
    );
    let inside = 0;
    forEachTri(r.geometry, (a, b, c) => {
      const p0 = vtx(r.geometry, a);
      const p1 = vtx(r.geometry, b);
      const p2 = vtx(r.geometry, c);
      const cen = [0, 1, 2].map((k) => (p0[k] + p1[k] + p2[k]) / 3);
      if (Math.hypot(cen[0], cen[1], cen[2]) < 0.69) inside++;
    });
    assert(
      r.geometry.index.count > 0 && inside === 0,
      `F1: CSG.subtract(box, SphereGeometry(0.7,48,24)) leaves no box faces inside the sphere (${inside} inside)`,
    );

    let depthError = '';
    try {
      CSG.subtract(
        new Mesh(new BoxGeometry(1, 1, 1)),
        new Mesh(new SphereGeometry(0.7, 90, 44)),
      );
    } catch (e) {
      depthError = String(e);
    }
    assert(
      MAX_BSP_DEPTH >= 2048 &&
        /RangeError: SecurityError: CSG BSP/.test(depthError),
      'F1: CSG beyond MAX_BSP_DEPTH throws a clear RangeError instead of returning wrong geometry',
    );
  }

  // F2: hole bridges must not cross other holes / depend on units.
  {
    const notch = new Shape();
    notch.moveTo(0, 0);
    for (const [x, y] of [
      [10, 0],
      [10, 4.9],
      [6, 5],
      [10, 5.1],
      [10, 10],
      [0, 10],
    ]) {
      notch.lineTo(x, y);
    }
    notch.closePath();
    const slit = new Path();
    slit.moveTo(5, 1);
    slit.lineTo(5.1, 1);
    slit.lineTo(5.1, 9);
    slit.lineTo(5, 9);
    slit.closePath();
    const square = new Path();
    square.moveTo(3, 4.5);
    square.lineTo(4, 4.5);
    square.lineTo(4, 5.5);
    square.lineTo(3, 5.5);
    square.closePath();
    notch.holes.push(slit, square);
    assertShapeArea(
      new ShapeGeometry(notch),
      97.8,
      'F2: notch + slit + square holes conserve area (bridge does not cross slit)',
    );

    const disc = new Shape();
    disc.absarc(0, 0, 3000, 0, Math.PI * 2, false);
    const mmHole = new Path();
    mmHole.moveTo(-2500, -50);
    mmHole.lineTo(-2400, -50);
    mmHole.lineTo(-2400, 50);
    mmHole.lineTo(-2500, 50);
    mmHole.closePath();
    disc.holes.push(mmHole);
    const discPts = disc.extractPoints(24);
    assertShapeArea(
      new ShapeGeometry(disc, 24),
      polyArea(discPts.shape) - polyArea(discPts.holes[0]),
      'F2: mm-scale r=3000 disc with off-center hole conserves area',
    );

    const bracket = new Shape();
    bracket.moveTo(-1, -1);
    bracket.lineTo(1, -1);
    bracket.lineTo(1, 1);
    bracket.quadraticCurveTo(0, 1.3, -1, 1);
    bracket.closePath();
    const bolt = new Path();
    bolt.absarc(0, 0, 0.35, 0, Math.PI * 2, false);
    bracket.holes.push(bolt);
    const bracketPts = bracket.extractPoints(8);
    assertShapeArea(
      new ShapeGeometry(bracket, 8),
      polyArea(bracketPts.shape) - polyArea(bracketPts.holes[0]),
      'F2: bracket with bolt hole conserves area',
    );
  }

  // F3: degenerate contours (collinear runs) still triangulate to the exact area.
  {
    const comb = new Shape();
    comb.moveTo(0, 0);
    for (let i = 1; i <= 8; i++) comb.lineTo(i, 0);
    comb.lineTo(8, 1);
    for (let i = 7; i >= 0; i--) {
      comb.lineTo(i + 0.5, i % 2 === 0 ? 2 : 1);
      comb.lineTo(i, 1);
    }
    comb.closePath();
    assertShapeArea(
      new ShapeGeometry(comb),
      polyArea(comb.getPoints()),
      'F3: comb contour with collinear vertices conserves area',
    );

    // Degenerate / self-touching contours reach the forced-clip fallback. The
    // vertex whose triangle is emitted must be the one removed, so a clipped
    // ear tip never shows up in a later triangle.
    let reused = 0;
    for (const pts of [
      [
        [4, 1],
        [0, 1],
        [2, 1],
        [4, 2],
        [3, 4],
      ],
      [
        [1, 4],
        [2, 4],
        [3, 3],
        [2, 2],
        [3, 4],
        [1, 3],
        [1, 2],
      ],
      [
        [3, 3],
        [4, 1],
        [1, 3],
        [3, 0],
        [3, 2],
        [4, 4],
      ],
    ]) {
      const s = new Shape();
      s.moveTo(pts[0][0], pts[0][1]);
      for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
      s.closePath();
      const idx = Array.from(new ShapeGeometry(s).index.array as number[]);
      const clipped = new Set<number>();
      for (let t = 0; t < idx.length; t += 3) {
        if (idx.slice(t, t + 3).some((v) => clipped.has(v))) reused++;
        clipped.add(idx[t + 1]);
      }
    }
    assert(
      reused === 0,
      `F3: fallback clip removes the emitted ear tip (${reused} reused)`,
    );
  }

  // F4: normals agree with triangle winding across Text/Extrude/Shape/CSG.
  {
    const sq = new Shape();
    sq.moveTo(-1, -1);
    sq.lineTo(1, -1);
    sq.lineTo(1, 1);
    sq.lineTo(-1, 1);
    sq.closePath();
    const holed = new Shape();
    holed.absarc(0, 0, 1, 0, Math.PI * 2, false);
    const bore = new Path();
    bore.absarc(0, 0, 0.4, 0, Math.PI * 2, true);
    holed.holes.push(bore);
    const cases: Array<[string, TestGeometry]> = [
      ['TextGeometry("HI1")', new TextGeometry('HI1')],
      ['ExtrudeGeometry(square)', new ExtrudeGeometry(sq, {depth: 0.5})],
      [
        'ExtrudeGeometry(holed, bevel)',
        new ExtrudeGeometry(holed, {depth: 0.3, bevelEnabled: true}),
      ],
      ['ShapeGeometry(holed)', new ShapeGeometry(holed)],
      ['CSG.subtract', subMesh.geometry],
      ['CSG.union', unionMesh.geometry],
      ['CSG.intersect', interMesh.geometry],
    ];
    for (const [name, geo] of cases) {
      const bad = countNormalWindingMismatches(geo);
      assert(bad === 0, `F4: ${name} normals agree with winding (${bad} bad)`);
    }
  }

  // F5: shape point cap and linear-ish ear scan.
  {
    const huge = new Shape();
    huge.moveTo(0, 0);
    for (let i = 1; i <= 5000; i++) {
      const a = (i / 5000) * Math.PI * 2;
      huge.lineTo(Math.cos(a), Math.sin(a));
    }
    let capMsg = '';
    try {
      assert(new ShapeGeometry(huge) === null, 'unreachable: cap not enforced');
    } catch (e) {
      capMsg = String(e);
    }
    assert(
      MAX_SHAPE_POINTS === 4096 &&
        capMsg.includes('RangeError') &&
        capMsg.includes('MAX_SHAPE_POINTS'),
      'F5: Shape with 5000 points throws RangeError mentioning MAX_SHAPE_POINTS',
    );

    const star = new Shape();
    const starN = 2000;
    for (let i = 0; i < starN; i++) {
      const a = (i / starN) * Math.PI * 2;
      const r = i % 2 === 0 ? 1 : 0.6;
      if (i === 0) star.moveTo(r * Math.cos(a), r * Math.sin(a));
      else star.lineTo(r * Math.cos(a), r * Math.sin(a));
    }
    star.closePath();
    const t0 = Date.now();
    const starGeo = new ShapeGeometry(star);
    const ms = Date.now() - t0;
    assert(ms < 500, `F5: 2000-point star triangulates in < 500 ms (${ms} ms)`);
    assertShapeArea(
      starGeo,
      polyArea(star.getPoints()),
      'F5: 2000-point star conserves area',
    );
  }

  // F6: non-finite numeric options fall back to defaults.
  {
    // Deliberately non-numeric option values, as untrusted author scripts
    // could pass.
    const bad = (v: string) => v as unknown as number;
    const t = new TextGeometry('A', {size: NaN, depth: bad('x')});
    const sq = new Shape();
    sq.moveTo(0, 0);
    sq.lineTo(1, 0);
    sq.lineTo(1, 1);
    sq.lineTo(0, 1);
    sq.closePath();
    const e = new ExtrudeGeometry(sq, {
      steps: bad('x'),
      depth: Infinity,
      bevelEnabled: true,
      bevelThickness: NaN,
      bevelSize: bad('big'),
      bevelOffset: NaN,
      bevelSegments: NaN,
    });
    // caps (2 x 4) + >= 1 layer of 4 quads for each of the side layers
    assert(
      allFinite(t) && allFinite(e) && e.attributes.position.count >= 8 + 4 * 4,
      'F6: NaN / non-numeric Text and Extrude options produce finite geometry with side walls',
    );
  }

  // F7: CSG keeps smooth vertex normals and uses the normal matrix.
  {
    const cutter = new Mesh(new BoxGeometry(0.3, 0.3, 0.3));
    cutter.position.set(0, 1, 0);
    const r = CSG.subtract(new Mesh(new SphereGeometry(1, 24, 12)), cutter);
    let checked = 0;
    let bad = 0;
    for (let i = 0; i < r.geometry.attributes.position.count; i++) {
      const p = vtx(r.geometry, i);
      const len = Math.hypot(p[0], p[1], p[2]);
      if (Math.abs(len - 1) > 1e-3 || p[1] > 0.7) continue;
      checked++;
      if (dot3(vtx(r.geometry, i, 'normal'), p) / len < 0.99) bad++;
    }
    assert(
      checked > 50 && bad === 0,
      `F7: CSG output keeps smooth sphere vertex normals (${bad}/${checked} bad)`,
    );

    // Non-uniform scale: normals must follow the inverse transpose.
    const ell = new Mesh(new SphereGeometry(1, 16, 8));
    ell.scale.set(2, 0.5, 1);
    ell.position.set(5, 0, 0);
    const u = CSG.union(new Mesh(new BoxGeometry(0.2, 0.2, 0.2)), ell);
    let ellChecked = 0;
    let ellBad = 0;
    for (let i = 0; i < u.geometry.attributes.position.count; i++) {
      const p = vtx(u.geometry, i);
      if (p[0] < 2) continue;
      // Only original surface vertices (BSP split vertices lie on chords).
      const q = ((p[0] - 5) / 2) ** 2 + (p[1] / 0.5) ** 2 + p[2] ** 2;
      if (Math.abs(q - 1) > 1e-4) continue;
      const g = [(p[0] - 5) / 4, p[1] / 0.25, p[2]];
      const gl = Math.hypot(g[0], g[1], g[2]);
      if (gl < 1e-6) continue;
      ellChecked++;
      if (dot3(vtx(u.geometry, i, 'normal'), g) / gl < 0.99) ellBad++;
    }
    assert(
      ellChecked > 50 && ellBad === 0,
      `F7: CSG transforms normals by the normal matrix under non-uniform scale (${ellBad}/${ellChecked} bad)`,
    );
  }

  // F8: tiny models keep all split fragments (no cracks).
  {
    const s = 1e-3;
    const a = new Mesh(new BoxGeometry(s, s, s));
    const b = new Mesh(new BoxGeometry(0.6 * s, 0.6 * s, 1.4 * s));
    b.position.set(0.1 * s, 0.1 * s, 0);
    const small = CSG.subtract(a, b);
    const ratio =
      surfaceArea(small.geometry) / (surfaceArea(subMesh.geometry) * s * s);
    assert(
      Math.abs(ratio - 1) < 0.01,
      `F8: subtract at 1e-3 scale keeps surface area (ratio ${ratio.toFixed(4)})`,
    );

    // Curved operand: small split slivers used to be dropped when their first
    // three vertices were nearly collinear, losing area at small scales.
    const sphereCut = (sc: number): number => {
      const cutter = new Mesh(new BoxGeometry(1.2 * sc, 0.37 * sc, 0.53 * sc));
      cutter.position.set(0.31 * sc, 0.13 * sc, 0.07 * sc);
      cutter.rotation.set(0.3, 0.2, 0.1);
      const res = CSG.subtract(
        new Mesh(new SphereGeometry(sc, 32, 16)),
        cutter,
      );
      return surfaceArea(res.geometry) / (sc * sc);
    };
    const sphereRatio = sphereCut(0.002) / sphereCut(1);
    assert(
      Math.abs(sphereRatio - 1) < 2e-6,
      `F8: sphere subtract at 2e-3 scale keeps all split fragments (ratio ${sphereRatio.toFixed(8)})`,
    );
  }

  // F9: CR / tab handling and no per-update rebuild of empty sliced text.
  {
    const crlf = new TextGeometry('A\r\nB');
    const lf = new TextGeometry('A\nB');
    assert(
      crlf.attributes.position.count === lf.attributes.position.count,
      'F9: TextGeometry skips \\r (A\\r\\nB has the same vertices as A\\nB)',
    );
    const tab = new TextGeometry('A\tB', {center: false});
    const spc = new TextGeometry('A B', {center: false});
    assert(
      tab.attributes.position.count === spc.attributes.position.count &&
        tab.boundingBox.max.x > spc.boundingBox.max.x,
      'F9: tab renders no glyph and advances further than a space',
    );
    const ws = new Mesh();
    ws.userData.xr = {text: ' '.repeat(200) + 'X'};
    ws.updateMatrixWorld();
    const g1 = ws.geometry;
    ws.updateMatrixWorld();
    assert(
      g1 === ws.geometry,
      'F9: whitespace-only sliced text is not rebuilt on every updateMatrixWorld',
    );
  }

  // F10 + coverage: declarative csg subtracts; over-limit op is skipped, not fatal.
  {
    assert(
      plate.geometry.attributes.position.count > 24,
      'Declarative userData.csg actually subtracted the punch (plate has > 24 vertices)',
    );
    const plate2 = new Mesh(new BoxGeometry(1, 1, 0.2));
    plate2.userData.csg = {target: new Mesh(new SphereGeometry(1, 128, 64))};
    const sc = new Scene();
    sc.add(plate2);
    const origWarn = console.warn;
    let warned = false;
    console.warn = () => {
      warned = true;
    };
    let glb2: Uint8Array | null = null;
    try {
      glb2 = sc.toGLB();
    } finally {
      console.warn = origWarn;
    }
    assert(
      glb2 instanceof Uint8Array &&
        glb2.byteLength > 100 &&
        warned &&
        plate2.geometry.attributes.position.count === 24,
      'F10: over-limit userData.csg is skipped with a warning and toGLB still succeeds',
    );
  }

  // Coverage: CSG volumes obey inclusion-exclusion (divergence theorem).
  {
    const vA = meshVolume(cubeA.geometry);
    const vB = 0.6 * 0.6 * 1.4;
    const vSub = meshVolume(subMesh.geometry);
    const vUni = meshVolume(unionMesh.geometry);
    const vInt = meshVolume(interMesh.geometry);
    assert(
      Math.abs(vA - 1) < 1e-6 &&
        Math.abs(vSub - 0.64) < 1e-4 &&
        Math.abs(vInt - 0.36) < 1e-4 &&
        Math.abs(vA + vB - (vUni + vInt)) < 1e-4,
      `CSG volumes: subtract 0.64 (${vSub.toFixed(5)}), intersect 0.36 (${vInt.toFixed(5)}), V(A)+V(B)=V(A∪B)+V(A∩B) (${(vUni + vInt).toFixed(5)})`,
    );
    assert(cubeB.position.x === 0.1, 'CSG operands are not mutated');
  }

  // Coverage: text longer than MAX_TEXT_GEOMETRY_CHARS is truncated.
  {
    const long = 'AB'.repeat(100);
    assert(
      new TextGeometry(long).attributes.position.count ===
        new TextGeometry(long.slice(0, MAX_TEXT_GEOMETRY_CHARS)).attributes
          .position.count,
      'TextGeometry truncates text to MAX_TEXT_GEOMETRY_CHARS',
    );
  }

  // Coverage: the installer survives Function.prototype.toString round-trip
  // (it is stringified into the Worker sandbox).
  {
    const fresh = new Function('return ' + installCadExtension.toString())()(
      THREE,
      {},
    );
    const sq = new fresh.Shape();
    sq.moveTo(0, 0);
    sq.lineTo(1, 0);
    sq.lineTo(0, 1);
    sq.closePath();
    assert(
      new fresh.ShapeGeometry(sq).index.count === 3 &&
        typeof fresh.CSG.subtract === 'function',
      'installCadExtension is self-contained (toString round-trip works)',
    );
  }

  // Coverage: THREE.LOD, decimateGeometry, and userData.xr.lod materialization + MSFT_lod export.
  {
    const freshLod = new Function('return ' + installLodExtension.toString())()(
      THREE,
      {},
    );
    assert(
      typeof freshLod.LOD === 'function' &&
        typeof freshLod.decimateGeometry === 'function',
      'installLodExtension is self-contained (toString round-trip works)',
    );

    const hiSphere = new SphereGeometry(1, 24, 16);
    const decimated = decimateGeometry(hiSphere, 0.35);
    assert(
      decimated.index !== null &&
        decimated.index.count > 0 &&
        decimated.index.count < hiSphere.index!.count &&
        allFinite(decimated),
      `decimateGeometry reduces sphere triangles (${hiSphere.index!.count / 3} -> ${decimated.index!.count / 3}) with finite vertices`,
    );

    const lodScene = new Scene();
    const lodGroup = new THREE.LOD();
    lodGroup.name = 'HeroTurretLOD';
    lodGroup.addLevel(
      new Mesh(
        new SphereGeometry(0.5, 24, 16),
        new MeshStandardMaterial({color: 0x38bdf8}),
      ),
      0,
    );
    lodGroup.addLevel(
      new Mesh(
        new BoxGeometry(0.8, 0.8, 0.8),
        new MeshStandardMaterial({color: 0x22c55e}),
      ),
      6,
    );
    lodScene.add(lodGroup);

    const autoMesh = new Mesh(
      new SphereGeometry(0.6, 20, 14),
      new MeshStandardMaterial({color: 0xf59e0b}),
    );
    autoMesh.name = 'AutoDecimatedTree';
    autoMesh.userData.xr = {
      lod: {distances: [0, 4, 10], ratios: [1.0, 0.45, 0.2], cullDistance: 25},
    };
    lodScene.add(autoMesh);

    const {gltf: lodGltf} = lodScene.toCanvas3D();
    const heroNode = lodGltf.nodes.find(
      (n: {name?: string}) => n.name === 'HeroTurretLOD',
    );
    const autoNode = lodGltf.nodes.find(
      (n: {name?: string}) => n.name === 'AutoDecimatedTree',
    );
    assert(
      Array.isArray(lodGltf.extensionsUsed) &&
        lodGltf.extensionsUsed.includes('MSFT_lod') &&
        lodGltf.extensionsUsed.includes('KHR_node_visibility') &&
        heroNode?.children?.length === 2 &&
        heroNode?.extensions?.MSFT_lod?.ids?.length === 2 &&
        lodGltf.nodes[heroNode.children[1]]?.extensions?.KHR_node_visibility
          ?.visible === false &&
        autoNode?.children?.length === 3 &&
        autoNode?.extensions?.MSFT_lod?.ids?.length === 3,
      'THREE.LOD and userData.xr.lod materialize LOD child tiers and export MSFT_lod + KHR_node_visibility',
    );
  }

  // Coverage: THREE.DataTexture (RGBA, RGB, Red/Luminance, Float32Array, post-constructor needsUpdate, GLB & USDZ export).
  {
    const w = 16;
    const h = 16;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 180;
      rgba[i * 4 + 1] = 90;
      rgba[i * 4 + 2] = 40;
      rgba[i * 4 + 3] = 255;
    }
    const dtex = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
    dtex.needsUpdate = true;
    assert(
      dtex.isTexture === true &&
        dtex.isDataTexture === true &&
        typeof dtex.source === 'string' &&
        dtex.source.startsWith('data:image/png;base64,') &&
        dtex.avgColor[0] > dtex.avgColor[1] &&
        dtex.avgColor[1] > dtex.avgColor[2],
      'THREE.DataTexture encodes RGBA buffer into stored-DEFLATE PNG data URI and computes linear avgColor',
    );

    // Post-constructor mutation + needsUpdate = true re-bakes URI and avgColor
    const prevUri = dtex.source;
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 20;
      rgba[i * 4 + 1] = 200;
      rgba[i * 4 + 2] = 220;
    }
    dtex.needsUpdate = true;
    assert(
      dtex.source !== prevUri &&
        dtex.avgColor[2] > dtex.avgColor[0] &&
        dtex.avgColor[1] > dtex.avgColor[0],
      'THREE.DataTexture re-bakes PNG data URI and avgColor after pixel mutation + needsUpdate = true',
    );

    // 3-channel RGBFormat and Float32Array support
    const f32Rgb = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0]);
    const floatTex = new THREE.DataTexture(
      f32Rgb,
      2,
      2,
      THREE.RGBFormat,
      THREE.FloatType,
    );
    assert(
      floatTex.source.startsWith('data:image/png;base64,') &&
        floatTex.avgColor[0] > 0.2 &&
        floatTex.avgColor[1] > 0.2,
      'THREE.DataTexture supports RGBFormat and FloatType Float32Array buffers',
    );

    // Scene export to Canvas3D / GLB / USDZ preserves baseColorTexture and USDZ average-color tint
    const texScene = new Scene();
    const texMat = new MeshStandardMaterial({
      map: dtex,
      roughness: 0.4,
      metalness: 0.2,
    });
    texScene.add(new Mesh(new BoxGeometry(1, 1, 1), texMat));
    const {gltf: texGltf} = texScene.toCanvas3D();
    assert(
      Array.isArray(texGltf.images) &&
        texGltf.images.length === 1 &&
        texGltf.images[0].uri === dtex.source &&
        Array.isArray(texGltf.textures) &&
        texGltf.textures.length === 1 &&
        texGltf.materials[0]?.pbrMetallicRoughness?.baseColorTexture?.index ===
          0,
      'scene.toCanvas3D() serializes DataTexture into gltf.images, gltf.textures, and pbrMetallicRoughness.baseColorTexture',
    );
    const usdzBytes = texScene.toUSDZ();
    const usdzText = new TextDecoder().decode(usdzBytes);
    assert(
      usdzText.includes('diffuseColor') &&
        !usdzText.includes('diffuseColor = (1.0, 1.0, 1.0)'),
      'scene.toUSDZ() tints untextured USDA diffuseColor using DataTexture avgColor',
    );
  }

  // Coverage: Partial-arc SphereGeometry and openEnded / partial-arc CylinderGeometry & ConeGeometry.
  {
    const hemi = new SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
    hemi.computeBoundingBox();
    assert(
      allFinite(hemi) &&
        hemi.boundingBox!.min.y >= -1e-4 &&
        hemi.boundingBox!.max.y > 0.95,
      'SphereGeometry honors thetaLength = Math.PI * 0.5 (upper hemisphere with y >= 0)',
    );

    const openCyl = new CylinderGeometry(1, 1, 2, 16, 2, true);
    const closedCyl = new CylinderGeometry(1, 1, 2, 16, 1, false);
    assert(
      allFinite(openCyl) &&
        allFinite(closedCyl) &&
        openCyl.index!.count < closedCyl.index!.count + 16 * 6,
      'CylinderGeometry honors heightSegments and openEnded = true without cap triangles',
    );

    const halfArcCone = new THREE.ConeGeometry(1, 2, 16, 1, true, 0, Math.PI);
    halfArcCone.computeBoundingBox();
    assert(
      allFinite(halfArcCone) && halfArcCone.index!.count === 16 * 6,
      'ConeGeometry forwards heightSegments, openEnded, thetaStart, and thetaLength to CylinderGeometry',
    );
  }
}

runThreeAuthorTests();
