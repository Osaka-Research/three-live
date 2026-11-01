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

import THREE, {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector3,
  WebGLRenderer,
} from '../src/three-author';

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

  const c = new Color(0xff0000);
  assert(c.r === 1 && c.g === 0 && c.b === 0, 'Color hex parsing');
  c.setRGB(0.5, 0.5, 0.5);
  assert(c.getHex() === 0x808080, 'Color getHex');

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
      warnings.some((w: string) => w.includes('IcosahedronGeometry')) &&
      warnings.some((w: string) => w.includes('CapsuleGeometry')),
    'Permissive fallback shims degrade unsupported LLM geometries/materials to valid GLB meshes and record warnings',
  );

  console.log(
    `\n🏆 three-author Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runThreeAuthorTests();
