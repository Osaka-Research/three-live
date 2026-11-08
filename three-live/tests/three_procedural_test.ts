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
  SphereGeometry,
  THREE,
  Vector3,
} from '../src/three-author';

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

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProceduralTests();
