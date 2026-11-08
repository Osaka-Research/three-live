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
import {cadPlugin} from '../src/plugins/cad';
import {
  installProceduralExtension,
  proceduralPlugin,
} from '../src/plugins/procedural';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  buildSandboxWorkerSource,
  clearAuthorWarnings,
  getAuthorWarnings,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SceneQuotaValidator,
  SphereGeometry,
  THREE,
  Vector3,
} from '../src/three-author';
import {sceneToCanvas3D, sceneToGLB, sceneToUSDZ} from '../src/three-convert';

registerPlugin(cadPlugin);
registerPlugin(proceduralPlugin);

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

function approx(a: number, b: number, eps = 1e-4): boolean {
  return Math.abs(a - b) <= eps;
}

function runProceduralTests(): void {
  console.log('📐 Running Three-Procedural (Box3 & Sphere) Unit Tests...\n');

  clearAuthorWarnings();

  // 1. Zero unsupported warnings & Worker standalone serialization
  const Box3Ctor = THREE.Box3;
  const SphereCtor = THREE.Sphere;
  assert(
    typeof Box3Ctor === 'function' && typeof SphereCtor === 'function',
    'THREE.Box3 and THREE.Sphere are exposed via authorNamespace',
  );
  assert(
    getAuthorWarnings().length === 0,
    'Accessing THREE.Box3 and THREE.Sphere emits zero unsupported warnings',
  );

  const fnSource = installProceduralExtension.toString();
  assert(
    !fnSource.includes('__publicField'),
    'installProceduralExtension.toString() contains no external esbuild class-field helpers',
  );
  const isolatedFn = new Function(`return (${fnSource});`)();
  assert(
    typeof isolatedFn === 'function',
    'installProceduralExtension deserializes cleanly in an isolated Worker scope',
  );
  const workerSrc = buildSandboxWorkerSource('/three-live.min.js', 'nonce123');
  assert(
    workerSrc.includes('isBox3') && workerSrc.includes('isSphere'),
    'buildSandboxWorkerSource embeds procedural extension installer for Web Workers',
  );

  // 2. Empty Box3 & Sphere invariants
  const emptyBox = new THREE.Box3();
  assert(emptyBox.isBox3 === true && emptyBox.isEmpty(), 'Default Box3 is empty');
  assert(
    emptyBox.getCenter().equals(new Vector3(0, 0, 0)) &&
      emptyBox.getSize().equals(new Vector3(0, 0, 0)),
    'Empty Box3 getCenter() and getSize() return (0, 0, 0)',
  );
  assert(
    emptyBox.distanceToPoint(new Vector3(1, 2, 3)) === Infinity,
    'Empty Box3 distanceToPoint is Infinity',
  );
  emptyBox.expandByScalar(5).translate(new Vector3(1, 2, 3));
  assert(
    emptyBox.isEmpty(),
    'Expanding or translating an empty Box3 leaves it empty',
  );

  const emptySphere = new THREE.Sphere();
  assert(
    emptySphere.isSphere === true && emptySphere.isEmpty(),
    'Default Sphere is empty (radius = -1)',
  );
  assert(
    emptySphere.distanceToPoint(new Vector3(0, 0, 0)) === Infinity &&
      !emptySphere.containsPoint(new Vector3(0, 0, 0)),
    'Empty Sphere distanceToPoint is Infinity and containsPoint is false',
  );

  // 3. Negative expandByScalar shrinking below 0 normalizes to empty
  const shrunk = new THREE.Box3(
    new Vector3(-1, -1, -1),
    new Vector3(1, 1, 1),
  ).expandByScalar(-2);
  assert(
    shrunk.isEmpty() && shrunk.min.x === Infinity && shrunk.max.x === -Infinity,
    'Shrinking Box3 past zero size normalizes to canonical empty bounds',
  );

  // 4. NaN resilience in expandByPoint
  const nanBox = new THREE.Box3()
    .expandByPoint({x: NaN, y: 1, z: 2})
    .expandByPoint({x: 2, y: 4, z: 6});
  assert(
    !nanBox.isEmpty() && nanBox.min.x === 2 && nanBox.max.z === 6,
    'Box3.expandByPoint ignores NaN coordinates without corrupting bounds',
  );

  // 5. BufferAttribute getY / getZ bounds safety on 1D and 2D attributes
  const attr1D = new BufferAttribute(new Float32Array([10, 20, 30]), 1);
  assert(
    attr1D.getX(0) === 10 && attr1D.getY(0) === 0 && attr1D.getZ(0) === 0,
    'BufferAttribute getY/getZ return 0 instead of reading adjacent items when itemSize < 3',
  );

  // 6. Nested Group transforms + precise vs fast AABB
  const root = new Group();
  root.position.set(10, 0, -5);
  const childGroup = new Group();
  childGroup.rotation.z = Math.PI / 4;
  childGroup.scale.set(2, 2, 2);
  const sphereMesh = new Mesh(
    new SphereGeometry(1, 24, 16),
    new MeshStandardMaterial(),
  );
  childGroup.add(sphereMesh);
  root.add(childGroup);

  const fastBox = new THREE.Box3().setFromObject(root, false);
  const preciseBox = new THREE.Box3().setFromObject(root, true);
  const preciseCenter = preciseBox.getCenter();
  const preciseSize = preciseBox.getSize();
  assert(
    approx(preciseCenter.x, 10, 1e-3) &&
      approx(preciseCenter.y, 0, 1e-3) &&
      approx(preciseCenter.z, -5, 1e-3),
    'setFromObject computes world-space center across nested groups',
  );
  assert(
    approx(preciseSize.x, 4, 0.05) && fastBox.getSize().x > preciseSize.x,
    'setFromObject(root, true) produces tighter bounds on rotated sphere than 8-corner AABB',
  );

  // 7. InstancedMesh bounds (count=0, count=2, and out-of-bounds count clamp)
  const inst = new InstancedMesh(
    new BoxGeometry(1, 2, 1),
    new MeshStandardMaterial(),
    2,
  );
  inst.setMatrixAt(0, new Matrix4().makeTranslation(-5, 1, 0));
  inst.setMatrixAt(1, new Matrix4().makeTranslation(5, 1, 0));
  inst.count = 0;
  assert(
    new THREE.Box3().setFromObject(inst).isEmpty(),
    'InstancedMesh with count=0 produces an empty Box3',
  );
  inst.count = 999; // Exceeds capacity of 2
  const instBox = new THREE.Box3().setFromObject(inst);
  assert(
    approx(instBox.min.x, -5.5) &&
      approx(instBox.max.x, 5.5) &&
      approx(instBox.min.y, 0) &&
      approx(instBox.max.y, 2),
    'InstancedMesh bounds union active instances and clamp excessive inst.count safely',
  );

  // 8. Declarative userData.xr.text materialization before measuring bounds
  const labelMesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
  labelMesh.userData.xr = {text: 'HI', size: 0.5};
  const labelBox = new THREE.Box3().setFromObject(labelMesh);
  assert(
    !labelBox.isEmpty() && labelBox.getSize().x > 0.1,
    'Box3.setFromObject materializes declarative userData.xr.text before measuring',
  );

  // 9. Cyclic hierarchy resilience
  const cycleA = new Group();
  const cycleB = new Group();
  cycleA.add(new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial()));
  cycleA.children.push(cycleB);
  cycleB.children.push(cycleA);
  const cycleBox = new THREE.Box3().setFromObject(cycleA);
  assert(
    approx(cycleBox.getSize().x, 2),
    'Box3.setFromObject handles cyclic scene graphs without infinite recursion',
  );

  // 10. Intersection, clamping, parameter, intersect, union, Sphere operations
  const boxA = new THREE.Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
  const boxB = new THREE.Box3(new Vector3(1, 1, 1), new Vector3(3, 3, 3));
  const boxDisjoint = new THREE.Box3(
    new Vector3(5, 5, 5),
    new Vector3(6, 6, 6),
  );
  assert(
    boxA.intersectsBox(boxB) && !boxA.intersectsBox(boxDisjoint),
    'Box3.intersectsBox detects overlapping and disjoint AABBs',
  );
  assert(
    boxA.clone().intersect(boxDisjoint).isEmpty(),
    'Disjoint Box3.intersect() returns an empty Box3',
  );
  const param = boxA.getParameter(new Vector3(0.5, 1.0, 2.0));
  assert(
    approx(param.x, 0.25) && approx(param.y, 0.5) && approx(param.z, 1.0),
    'Box3.getParameter returns normalized coordinates',
  );

  const s1 = new THREE.Sphere(new Vector3(0, 0, 0), 1);
  const s2 = new THREE.Sphere(new Vector3(4, 0, 0), 1);
  assert(
    !s1.intersectsSphere(s2) && boxA.intersectsSphere(s1),
    'Sphere.intersectsSphere and Box3.intersectsSphere agree on contact',
  );
  const mergedSphere = s1.clone().union(s2);
  assert(
    approx(mergedSphere.center.x, 2) && approx(mergedSphere.radius, 3),
    'Sphere.union computes minimal enclosing sphere of two disjoint spheres',
  );
  const clamped = s1.clampPoint(new Vector3(10, 0, 0));
  assert(
    approx(clamped.x, 1) && approx(clamped.y, 0) && approx(clamped.z, 0),
    'Sphere.clampPoint projects exterior point onto sphere surface',
  );

  // 11. BufferGeometry.computeBoundingSphere + update on geometry.scale()
  const boxGeo = new BoxGeometry(2, 2, 2);
  const bs = boxGeo.computeBoundingSphere();
  assert(
    approx(bs.radius, Math.sqrt(3), 1e-3),
    'BoxGeometry(2,2,2).computeBoundingSphere() radius is sqrt(3)',
  );
  boxGeo.scale(2, 2, 2);
  assert(
    approx(boxGeo.boundingSphere.radius, 2 * Math.sqrt(3), 1e-3),
    'BufferGeometry.scale() refreshes existing boundingSphere automatically',
  );

  // 12. Empty BufferGeometry.center() does not produce NaN
  const emptyGeo = new BufferGeometry();
  emptyGeo.center();
  assert(
    emptyGeo.boundingBox.isEmpty(),
    'Empty BufferGeometry.center() preserves empty boundingBox without NaN',
  );

  // 13. Virtual 2D <canvas> + THREE.CanvasTexture (multi-block PNG, post-draw auto-sync, zlib verification)
  assert(
    typeof THREE.CanvasTexture === 'function' &&
      typeof document !== 'undefined' &&
      typeof document.createElement === 'function',
    'THREE.CanvasTexture and headless document.createElement("canvas") are installed',
  );

  const canvas: any = document.createElement('canvas');
  assert(
    canvas.width === 300 && canvas.height === 150,
    'document.createElement("canvas") defaults to 300x150 per HTML5 spec',
  );
  canvas.width = 256;
  canvas.height = 256;
  // Create CanvasTexture BEFORE drawing to verify automatic post-draw sync!
  const ctex = new THREE.CanvasTexture(canvas);
  const ctx = canvas.getContext('2d');
  assert(ctx !== null, 'canvas.getContext("2d") returns VirtualCanvasContext2D');

  // Linear gradient background (requires >65535 raw bytes at 256x256 -> multi-block DEFLATE!)
  const grad = ctx.createLinearGradient(0, 0, 256, 256);
  grad.addColorStop(0, '#dc2626');
  grad.addColorStop(0.5, 'rgb(37, 99, 235)');
  grad.addColorStop(1, 'hsl(150, 80%, 40%)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Even-odd hollow ring + roundRect + curves + dashed stroke + clip + typography
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(16, 16, 224, 224, 20);
  ctx.clip();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(128, 128, 60, 0, Math.PI * 2);
  ctx.arc(128, 128, 30, 0, Math.PI * 2);
  ctx.fill('evenodd');

  ctx.strokeStyle = 'gold';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 6]);
  ctx.beginPath();
  ctx.moveTo(24, 210);
  ctx.quadraticCurveTo(128, 180, 232, 210);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = '#0f172a';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const metrics = ctx.measureText('SECTOR 7');
  assert(
    metrics.width > 80 && metrics.actualBoundingBoxAscent > 15,
    'ctx.measureText computes positive glyph width and ascent metrics',
  );
  ctx.fillText('SECTOR 7', 128, 48);
  ctx.strokeStyle = '#38bdf8';
  ctx.strokeText('OK', 128, 224);
  ctx.restore();

  // Verify center of hollow even-odd ring kept gradient background (not white) while ring annulus is white
  const centerPx = ctx.getImageData(128, 128, 1, 1).data;
  const ringPx = ctx.getImageData(128 + 45, 128, 1, 1).data;
  assert(
    ringPx[0] > 220 &&
      ringPx[1] > 220 &&
      ringPx[2] > 220 &&
      centerPx[0] < 120 &&
      centerPx[2] > 180,
    'ctx.fill("evenodd") leaves inner hole un-filled while filling outer annulus',
  );

  // Verify putImageData / getImageData exact 1:1 round-trip and drawImage composition
  const patch = ctx.createImageData(4, 4);
  for (let i = 0; i < patch.data.length; i += 4) {
    patch.data[i] = 12;
    patch.data[i + 1] = 234;
    patch.data[i + 2] = 56;
    patch.data[i + 3] = 255;
  }
  ctx.putImageData(patch, 4, 4);
  const readBack = ctx.getImageData(4, 4, 2, 2).data;
  assert(
    readBack[0] === 12 &&
      readBack[1] === 234 &&
      readBack[2] === 56 &&
      readBack[3] === 255,
    'putImageData + getImageData round-trips exact RGBA8 pixel bytes',
  );

  // Verify multi-block PNG generated by CanvasTexture decompresses cleanly with Node's native zlib!
  const zlib = require('zlib') as typeof import('zlib');
  const pngUri: string = ctex.source;
  assert(
    ctex.isCanvasTexture === true &&
      ctex.flipY === true &&
      pngUri.startsWith('data:image/png;base64,'),
    'CanvasTexture auto-syncs post-construction canvas draws into PNG data URI without manual needsUpdate',
  );
  const pngBytes = Buffer.from(
    pngUri.slice('data:image/png;base64,'.length),
    'base64',
  );
  const ihdrW = pngBytes.readUInt32BE(16);
  const ihdrH = pngBytes.readUInt32BE(20);
  const idatLen = pngBytes.readUInt32BE(33);
  const inflated = zlib.inflateSync(pngBytes.subarray(41, 41 + idatLen));
  assert(
    ihdrW === 256 &&
      ihdrH === 256 &&
      inflated.length === 256 * (1 + 256 * 4),
    '256x256 CanvasTexture multi-block stored-DEFLATE IDAT stream passes native zlib.inflateSync',
  );

  // Export scene with CanvasTexture to Canvas3D / GLB / USDZ
  const ctexScene = new Scene();
  ctexScene.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({map: ctex}),
    ),
  );
  const {gltf: ctexGltf} = sceneToCanvas3D(ctexScene);
  const ctexGlb = sceneToGLB(ctexScene);
  const ctexUsdz = sceneToUSDZ(ctexScene);
  assert(
    ctexGltf.images?.[0]?.uri === pngUri &&
      ctexGlb.byteLength > 1000 &&
      ctexUsdz.byteLength > 1000,
    'Scene with THREE.CanvasTexture exports cleanly to Canvas3D, GLB, and USDZ',
  );

  // 14. CanvasTexture edge cases: zero size, >2048 quota guard, pathological arc sweep, prototype freeze
  const zeroCanvas: any = document.createElement('canvas');
  zeroCanvas.width = 0;
  zeroCanvas.height = 0;
  const zCtx = zeroCanvas.getContext('2d');
  zCtx.fillRect(0, 0, 10, 10);
  zCtx.fillText('NOOP', 5, 5);
  const zTex = new THREE.CanvasTexture(zeroCanvas);
  assert(
    zTex.source === '',
    'Zero-dimension CanvasTexture safely produces empty source without throwing',
  );

  const hugeCanvas: any = document.createElement('canvas');
  hugeCanvas.width = 4096;
  hugeCanvas.height = 4096;
  assert(
    hugeCanvas._data.byteLength <= 512 * 512 * 4,
    'Oversized VirtualCanvas caps internal pixel allocation at 512x512 (<= 1 MB)',
  );
  const hugeScene = new Scene();
  hugeScene.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({map: new THREE.CanvasTexture(hugeCanvas)}),
    ),
  );
  let quotaRejected = false;
  try {
    SceneQuotaValidator.validate(hugeScene);
  } catch (e: unknown) {
    quotaRejected = String(e).includes('SECURITY_3D_MAX_TEXTURE_DIMENSION');
  }
  assert(
    quotaRejected,
    'SceneQuotaValidator rejects >2048 CanvasTexture with SECURITY_3D_MAX_TEXTURE_DIMENSION',
  );

  // Pathological huge sweep angle completes immediately and VirtualCanvas.prototype is frozen
  const arcCanvas: any = document.createElement('canvas');
  arcCanvas.width = 64;
  arcCanvas.height = 64;
  const arcCtx = arcCanvas.getContext('2d');
  arcCtx.beginPath();
  arcCtx.arc(32, 32, 20, 0, 1e9);
  arcCtx.stroke();
  assert(
    Object.isFrozen(Object.getPrototypeOf(arcCanvas)) &&
      Object.isFrozen(Object.getPrototypeOf(arcCtx)),
    'VirtualCanvas.prototype and VirtualCanvasContext2D.prototype are frozen against prototype pollution',
  );

  // 15. THREE.MathUtils.seededRandom, randInt, and randFloatSpread
  clearAuthorWarnings();
  const s1a = THREE.MathUtils.seededRandom(42);
  const s1b = THREE.MathUtils.seededRandom();
  const s1c = THREE.MathUtils.seededRandom();
  const s2a = THREE.MathUtils.seededRandom(42);
  const s2b = THREE.MathUtils.seededRandom();
  const s2c = THREE.MathUtils.seededRandom();
  assert(
    s1a === s2a &&
      s1b === s2b &&
      s1c === s2c &&
      s1a >= 0 &&
      s1a < 1 &&
      s1a !== s1b,
    'THREE.MathUtils.seededRandom(seed) generates repeatable Mulberry32 sequences in [0, 1)',
  );
  const sOther = THREE.MathUtils.seededRandom(99);
  assert(
    sOther !== s1a,
    'Different seeds produce distinct THREE.MathUtils.seededRandom values',
  );
  const sNanA = THREE.MathUtils.seededRandom(NaN);
  const sNanB = THREE.MathUtils.seededRandom();
  assert(
    Number.isFinite(sNanA) && Number.isFinite(sNanB) && sNanA !== sNanB,
    'Non-finite seed in seededRandom(NaN) falls back cleanly without poisoning subsequent calls',
  );
  const ri = THREE.MathUtils.randInt(5, 10);
  const rfs = THREE.MathUtils.randFloatSpread(4);
  assert(
    Number.isInteger(ri) && ri >= 5 && ri <= 10 && rfs >= -2 && rfs <= 2,
    'THREE.MathUtils.randInt and randFloatSpread stay within bounds',
  );

  // 16. THREE.ImprovedNoise (Ken Perlin 2002 3D gradient noise)
  const perlin = new THREE.ImprovedNoise();
  assert(
    getAuthorWarnings().length === 0 &&
      Object.isFrozen(THREE.ImprovedNoise.prototype),
    'THREE.ImprovedNoise emits zero warnings and has frozen prototype',
  );
  assert(
    perlin.noise(0, 0, 0) === 0 &&
      perlin.noise(3, -7, 12) === 0 &&
      perlin.noise(255, 128, -64) === 0,
    'ImprovedNoise vanishes at integer lattice points',
  );
  assert(
    perlin.noise(1.35, 2.75) === perlin.noise(1.35, 2.75, 0),
    'ImprovedNoise.noise(x, y) defaults z to 0',
  );
  assert(
    approx(
      perlin.noise(1.35 + 256, -2.4 + 512, 0.7 - 256),
      perlin.noise(1.35, -2.4, 0.7),
      1e-9,
    ),
    'ImprovedNoise is 256-periodic along X, Y, and Z',
  );
  let perlinMin = Infinity;
  let perlinMax = -Infinity;
  let maxDelta = 0;
  for (let i = 0; i < 200; i++) {
    const px = i * 0.137 - 5.2;
    const py = i * 0.219 + 1.1;
    const pz = i * 0.083 - 2.7;
    const v = perlin.noise(px, py, pz);
    const vNear = perlin.noise(px + 1e-4, py - 1e-4, pz + 1e-4);
    perlinMin = Math.min(perlinMin, v);
    perlinMax = Math.max(perlinMax, v);
    maxDelta = Math.max(maxDelta, Math.abs(vNear - v));
  }
  assert(
    perlinMin >= -1.05 &&
      perlinMax <= 1.05 &&
      perlinMax - perlinMin > 0.4 &&
      maxDelta < 1e-3,
    'ImprovedNoise is smooth, non-degenerate, and bounded across 3D domain',
  );
  assert(
    perlin.noise(NaN, 1, 2) === 0 &&
      perlin.noise(1, Infinity, 2) === 0 &&
      perlin.noise(1, 2, -Infinity) === 0,
    'ImprovedNoise returns 0 safely on NaN / Infinity inputs',
  );

  // 17. THREE.SimplexNoise (2D, 3D, 4D + seeded PRNG overloads)
  THREE.MathUtils.seededRandom(1337);
  const simA = new THREE.SimplexNoise({
    random: () => THREE.MathUtils.seededRandom(),
  });
  THREE.MathUtils.seededRandom(1337);
  const simB = new THREE.SimplexNoise(() => THREE.MathUtils.seededRandom());
  const simC = new THREE.SimplexNoise(99999);
  assert(
    Object.isFrozen(THREE.SimplexNoise.prototype) &&
      getAuthorWarnings().length === 0,
    'THREE.SimplexNoise emits zero warnings and has frozen prototype',
  );

  let allMatch = true;
  let anyDiffFromOtherSeed = false;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (let i = 0; i < 120; i++) {
    const x = i * 0.17 - 4.0;
    const y = i * 0.23 + 0.5;
    const z = i * 0.11 - 1.3;
    const w = i * 0.07 + 2.2;
    const n2a = simA.noise(x, y);
    const n2b = simB.noise2D(x, y);
    const n3a = simA.noise3d(x, y, z);
    const n3b = simB.noise3D(x, y, z);
    const n4a = simA.noise4d(x, y, z, w);
    const n4b = simB.noise4D(x, y, z, w);
    if (n2a !== n2b || n3a !== n3b || n4a !== n4b) allMatch = false;
    if (Math.abs(n3a - simC.noise3d(x, y, z)) > 1e-4) {
      anyDiffFromOtherSeed = true;
    }
    sMin = Math.min(sMin, n2a, n3a, n4a);
    sMax = Math.max(sMax, n2a, n3a, n4a);
  }
  assert(
    allMatch && anyDiffFromOtherSeed,
    'SimplexNoise seeded via {random} and function match identically across 2D/3D/4D and differ across seeds',
  );
  assert(
    sMin >= -1.05 && sMax <= 1.05 && sMax - sMin > 0.5,
    `SimplexNoise 2D/3D/4D stays within [-1, 1] with healthy variance (min=${sMin.toFixed(3)}, max=${sMax.toFixed(3)})`,
  );
  const brokenRngSim = new THREE.SimplexNoise(() => NaN);
  assert(
    Number.isFinite(brokenRngSim.noise(1.2, 3.4)) &&
      simA.noise(NaN, 1) === 0 &&
      simA.noise3d(1, Infinity, 2) === 0 &&
      simA.noise4d(1, 2, 3, -Infinity) === 0,
    'SimplexNoise handles broken PRNGs and non-finite coordinates without producing NaN',
  );

  // 18. Terrain heightmap displacement + GLB/USDZ export integration
  const terrainGeo = new THREE.PlaneGeometry(4, 4, 16, 16);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vy = posAttr.getY(i);
    const h =
      0.35 * simA.noise(vx * 0.6, vy * 0.6) +
      0.15 * perlin.noise(vx * 1.4, vy * 1.4, 0.5);
    posAttr.setZ(i, h);
  }
  terrainGeo.computeVertexNormals();
  const terrainMesh = new Mesh(
    terrainGeo,
    new MeshStandardMaterial({color: 0x4ade80, roughness: 0.85}),
  );
  terrainMesh.rotation.x = -Math.PI / 2;
  const terrainScene = new Scene();
  terrainScene.add(terrainMesh);
  const terrainGlb = sceneToGLB(terrainScene);
  const terrainUsdz = sceneToUSDZ(terrainScene);
  assert(
    terrainGlb.byteLength > 1000 && terrainUsdz.byteLength > 1000,
    'Procedural SimplexNoise + ImprovedNoise displaced terrain exports cleanly to GLB and USDZ',
  );

  // 19. Full PBR Material Texture Channels (A4: normalMap/normalScale, roughnessMap+metalnessMap ORM packing, emissiveMap, aoMap/aoMapIntensity, bumpMap/bumpScale)
  const makeSolidDataTex = (
    r: number,
    g: number,
    b: number,
    w = 4,
    h = 4,
  ) => {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
    return new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  };
  const roughTex = makeSolidDataTex(64, 64, 64);
  const metalTex = makeSolidDataTex(220, 220, 220);
  const aoTex = makeSolidDataTex(120, 120, 120);
  const emTex = makeSolidDataTex(255, 128, 0);

  // Slope heightmap for bumpMap -> tangent-space normal conversion
  const bumpPx = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const hVal = Math.round((x / 7) * 255);
      const o = (y * 8 + x) * 4;
      bumpPx[o] = hVal;
      bumpPx[o + 1] = hVal;
      bumpPx[o + 2] = hVal;
      bumpPx[o + 3] = 255;
    }
  }
  const bumpTex = new THREE.DataTexture(bumpPx, 8, 8, THREE.RGBAFormat);

  const pbrMat = new MeshStandardMaterial({
    color: 0xdddddd,
    roughnessMap: roughTex,
    metalnessMap: metalTex,
    aoMap: aoTex,
    aoMapIntensity: 0.65,
    emissiveMap: emTex,
    emissiveIntensity: 1.5,
    bumpMap: bumpTex,
    bumpScale: 2.0,
  });
  assert(
    pbrMat.roughness === 1 && pbrMat.metalness === 1,
    'MeshStandardMaterial defaults roughness/metalness factors to 1.0 when roughnessMap/metalnessMap are supplied',
  );

  const pbrScene = new Scene();
  pbrScene.add(new Mesh(new BoxGeometry(1, 1, 1), pbrMat));
  const pbrData = sceneToCanvas3D(pbrScene);
  const gltfMat = pbrData.gltf.materials[0];
  assert(
    gltfMat.pbrMetallicRoughness?.metallicRoughnessTexture?.index !==
      undefined &&
      gltfMat.normalTexture?.index !== undefined &&
      gltfMat.emissiveTexture?.index !== undefined &&
      gltfMat.occlusionTexture?.index !== undefined &&
      approx(gltfMat.occlusionTexture.strength, 0.65, 1e-5) &&
      Array.isArray(gltfMat.emissiveFactor) &&
      approx(gltfMat.emissiveFactor[0], 1.5, 1e-5),
    'sceneToCanvas3D serializes packed ORM, bump->normal, emissiveTexture+default emissiveFactor, and occlusionTexture.strength',
  );

  const samplePngPixel = (uri: string, x: number, y: number): number[] => {
    const buf = Buffer.from(
      uri.slice('data:image/png;base64,'.length),
      'base64',
    );
    const w = buf.readUInt32BE(16);
    const len = buf.readUInt32BE(33);
    const raw = zlib.inflateSync(buf.subarray(41, 41 + len));
    const o = y * (1 + w * 4) + 1 + x * 4;
    return [raw[o], raw[o + 1], raw[o + 2], raw[o + 3]];
  };

  // Verify packed ORM PNG bytes (G = 64 from roughnessMap, B = 220 from metalnessMap)
  const mrImgUri: string =
    pbrData.gltf.images[
      pbrData.gltf.textures[
        gltfMat.pbrMetallicRoughness.metallicRoughnessTexture.index
      ].source
    ].uri;
  const mrSample = samplePngPixel(mrImgUri, 1, 1);
  assert(
    mrSample[0] === 255 && mrSample[1] === 64 && mrSample[2] === 220,
    `ORM channel packer places roughness in G (got ${mrSample[1]}) and metalness in B (got ${mrSample[2]})`,
  );

  // Verify bumpMap -> normalTexture PNG has tilted X normal (R < 128 for positive +X height slope)
  const normImgUri: string =
    pbrData.gltf.images[
      pbrData.gltf.textures[gltfMat.normalTexture.index].source
    ].uri;
  const normSample = samplePngPixel(normImgUri, 3, 3);
  assert(
    normSample[0] < 120 &&
      Math.abs(normSample[1] - 128) <= 2 &&
      normSample[2] > 128,
    `bumpMap Sobel normal baker tilts normal X on +X height ramp (rgba=${normSample[0]},${normSample[1]},${normSample[2]})`,
  );

  // Explicit emissive: 0x000000 suppresses auto-white emissiveFactor, and Vector2 normalScale averages cleanly
  const explicitZeroMat = new MeshStandardMaterial({
    normalMap: makeSolidDataTex(128, 128, 255),
    normalScale: new THREE.Vector2(0.4, 0.8),
    emissive: 0x000000,
    emissiveMap: emTex,
  });
  const explicitScene = new Scene();
  explicitScene.add(new Mesh(new BoxGeometry(1, 1, 1), explicitZeroMat));
  const explicitGltfMat = sceneToCanvas3D(explicitScene).gltf.materials[0];
  assert(
    explicitGltfMat.emissiveFactor === undefined &&
      approx(explicitGltfMat.normalTexture?.scale ?? 0, 0.6, 1e-5),
    'Explicit emissive: 0x000000 preserves zero emissiveFactor and Vector2 normalScale serializes to glTF normalTexture.scale',
  );

  // SceneQuotaValidator enforces texture dimension limits on bumpMap
  const bumpOnlyScene = new Scene();
  bumpOnlyScene.add(
    new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({bumpMap: new THREE.CanvasTexture(hugeCanvas)}),
    ),
  );
  let bumpQuotaRejected = false;
  try {
    SceneQuotaValidator.validate(bumpOnlyScene);
  } catch (e: unknown) {
    bumpQuotaRejected = String(e).includes('SECURITY_3D_MAX_TEXTURE_DIMENSION');
  }
  assert(
    bumpQuotaRejected,
    'SceneQuotaValidator enforces texture quota and dimension bounds on bumpMap',
  );

  // USDZ export wires all 5 UsdUVTexture shaders cleanly
  const pbrUsdz = sceneToUSDZ(pbrScene);
  const pbrUsdzText = new TextDecoder().decode(pbrUsdz);
  assert(
    pbrUsdz.byteLength > 1000 &&
      pbrUsdzText.includes('MetallicRoughnessTexture.outputs:g') &&
      pbrUsdzText.includes('MetallicRoughnessTexture.outputs:b') &&
      pbrUsdzText.includes('NormalTexture.outputs:rgb') &&
      pbrUsdzText.includes('EmissiveTexture.outputs:rgb') &&
      pbrUsdzText.includes('OcclusionTexture.outputs:r'),
    'sceneToUSDZ wires Roughness, Metallic, Normal, Emissive, and Occlusion UsdUVTexture channels',
  );

  // =========================================================================
  // 14. A5: True HemisphereLight(skyColor, groundColor, intensity) & Sprite
  // =========================================================================
  clearAuthorWarnings();
  const hemiScene = new Scene();
  const hemi = new THREE.HemisphereLight(0x2288ff, 0xff5511, 1.4);
  hemi.position.set(0, 5, 0);
  const hemiClone = hemi.clone();
  assert(
    getAuthorWarnings().length === 0 &&
      hemi.type === 'hemisphere' &&
      hemiClone.type === 'hemisphere' &&
      Math.abs(hemiClone.groundColor.r - hemi.groundColor.r) < 1e-6 &&
      Math.abs(hemiClone.intensity - 1.4) < 1e-6,
    'HemisphereLight emits zero degraded-alias warnings and clone() preserves groundColor + intensity',
  );
  hemiScene.add(hemi);

  const badgeCanvas: any = document.createElement('canvas');
  badgeCanvas.width = 16;
  badgeCanvas.height = 16;
  const bCtx = badgeCanvas.getContext('2d')!;
  bCtx.fillStyle = '#00e5ff';
  bCtx.fillRect(0, 0, 16, 16);
  const badgeTex = new THREE.CanvasTexture(badgeCanvas);
  const spriteMat = new THREE.SpriteMaterial({
    map: badgeTex,
    color: 0xffffff,
    opacity: 0.85,
    rotation: Math.PI / 2,
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.center.set(0, 0);
  sprite.scale.set(0.6, 0.3, 1);
  sprite.position.set(0, 1.5, 0);
  hemiScene.add(sprite);

  const spriteOptOut = new THREE.Sprite({color: 0xffaa00});
  spriteOptOut.userData.xr = {billboard: false};
  spriteOptOut.position.set(1, 1.5, 0);
  hemiScene.add(spriteOptOut);

  const hemiC3d = sceneToCanvas3D(hemiScene);
  const spriteClone = sprite.clone();
  hemiScene.add(spriteClone);
  const hemiC3d2 = sceneToCanvas3D(hemiScene);
  assert(
    getAuthorWarnings().length === 0,
    'Sprite and SpriteMaterial emit zero degraded-alias or unsupported warnings',
  );
  const exportedHemi = (hemiC3d.lights || []).find(
    (l: any) => l.type === 'hemisphere',
  ) as any;
  const assetHemi = (hemiC3d.gltf.asset?.extras?.lights || []).find(
    (l: any) => l.type === 'hemisphere',
  );
  assert(
    Boolean(exportedHemi) &&
      Array.isArray(exportedHemi.groundColor) &&
      exportedHemi.groundColor[0] > exportedHemi.groundColor[2] &&
      exportedHemi.color[2] > exportedHemi.color[0] &&
      Boolean(assetHemi?.groundColor),
    'sceneToCanvas3D preserves HemisphereLight sky color and groundColor in lights and gltf.asset.extras.lights',
  );
  assert(
    hemiC3d.gltf.materials[0]?.alphaMode === 'BLEND',
    'SpriteMaterial with transparency exports alphaMode: "BLEND" in glTF material',
  );
  const spriteNode0 = hemiC3d.gltf.nodes.find((n: any) => n.name === sprite.name);
  const optOutNode = hemiC3d.gltf.nodes.find(
    (n: any) => n.name === spriteOptOut.name,
  );
  assert(
    spriteNode0?.extras?.xr?.billboard === 'spherical' &&
      optOutNode?.extras?.xr?.billboard === undefined &&
      sprite.name !== spriteClone.name &&
      hemiC3d2.gltf.nodes.filter((n: any) => n.mesh !== undefined).length === 3,
    'Sprite defaults to spherical billboard, supports billboard:false opt-out, and assigns distinct auto-names on clone()',
  );
  // Verify center=(0,0) + rotation=PI/2 transformed vertices into x in [-1,0], y in [0,1]
  sprite.geometry.computeBoundingBox();
  const sbb = sprite.geometry.boundingBox!;
  assert(
    Math.abs(sbb.min.x - -1) < 1e-5 &&
      Math.abs(sbb.max.x - 0) < 1e-5 &&
      Math.abs(sbb.min.y - 0) < 1e-5 &&
      Math.abs(sbb.max.y - 1) < 1e-5,
    'Sprite._bakeAuthorGeometry shifts pivot by center=(0,0) and rotates quad by SpriteMaterial.rotation',
  );

  const hemiUsdzText = new TextDecoder().decode(sceneToUSDZ(hemiScene));
  assert(
    hemiUsdzText.includes('string billboard = "spherical"'),
    'sceneToUSDZ exports spherical billboard trait on Sprite nodes',
  );

  assert(
    Object.isFrozen(THREE.Sprite.prototype) &&
      Object.isFrozen(THREE.SpriteMaterial.prototype),
    'Sprite.prototype and SpriteMaterial.prototype are frozen against sandbox pollution',
  );
  const spriteMatClone = spriteMat.clone();
  assert(
    spriteMatClone.isSpriteMaterial &&
      Math.abs(spriteMatClone.rotation - Math.PI / 2) < 1e-6 &&
      Math.abs(spriteMatClone.opacity - 0.85) < 1e-6,
    'SpriteMaterial.clone() preserves rotation, opacity, and isSpriteMaterial',
  );
  const preBakeSprite = new THREE.Sprite();
  preBakeSprite.center.set(0, 0);
  const preBakeBox = new THREE.Box3().setFromObject(preBakeSprite);
  assert(
    Math.abs(preBakeBox.min.x) < 1e-5 && Math.abs(preBakeBox.max.x - 1) < 1e-5,
    'Box3.setFromObject(sprite) bakes Sprite.center pivot offset before measuring bounds',
  );

  // RectAreaLight still emits degraded-alias warning
  clearAuthorWarnings();
  const _rect = new THREE.RectAreaLight(0xffffff, 1);
  assert(
    Boolean(_rect) &&
      getAuthorWarnings().some((w) => w.includes('RectAreaLight')),
    'RectAreaLight continues to emit degraded-alias warning',
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProceduralTests();
