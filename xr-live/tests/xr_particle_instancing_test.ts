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


import {strict as assert} from 'node:assert';
import {mat4Create} from '../../three-live/src/math';
import {skinningPlugin} from '../../three-live/src/plugins/skinning';
import {morphPlugin} from '../../three-live/src/plugins/morph';
import {ThreeView} from '../../three-live/src/three-view';
import {type PluginViewer, createDynamicMesh, reattachDynamicMesh, updateDynamicMesh} from '../src/plugins/common';
import {buildParticleTopology, ParticleEmitter, XRDepthParticlesController} from '../src/plugins/depth-particles';

function mockGL() {
  let nextId = 0;
  const uploads: Array<{buffer: any; bytes: number; usage?: number}> = [];
  const deleted = new Set<any>();
  const divisors: number[][] = [];
  const bound = new Map<number, any>();
  const gl: any = {
    createVertexArray: () => ({vao: ++nextId}),
    bindVertexArray() {},
    createBuffer: () => ({buffer: ++nextId}),
    bindBuffer: (target: number, buffer: any) => bound.set(target, buffer),
    bufferData: (target: number, data: ArrayBufferView, usage: number) => {
      uploads.push({buffer: bound.get(target), bytes: data.byteLength, usage});
    },
    bufferSubData: (target: number, _offset: number, data: ArrayBufferView) => {
      uploads.push({buffer: bound.get(target), bytes: data.byteLength});
    },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    vertexAttribDivisor: (...values: number[]) => divisors.push(values),
    drawElementsInstanced() {},
    deleteBuffer: (buffer: any) => deleted.add(buffer),
    deleteVertexArray: (vao: any) => deleted.add(vao),
  };
  return {gl, uploads, deleted, divisors};
}

function source(preset = 'rain', count = 2000) {
  const transform = mat4Create();
  transform[13] = 1;
  transform[14] = -2;
  return {name: 'cloud', transform, userData: {xr: {particles: {
    preset, count, area: [2, 2, 2], speed: 1,
  }}}};
}

for (const preset of ['rain', 'snow', 'sparks', 'confetti']) {
  for (const count of [1, 257, 2000]) {
    const gpu = mockGL();
    const origin = source(preset, count);
    const viewer = {gl: gpu.gl, supportsInstanceOffsets: true, meshes: [origin] as any[]};
    const fallbackOrigin = source(preset, count);
    const fallback = {meshes: [fallbackOrigin] as any[]};
    const ctrl = new XRDepthParticlesController();
    const fallbackCtrl = new XRDepthParticlesController();
    const depth = {view: mat4Create(), proj: mat4Create(), sample: () => 2};
    for (let frame = 0; frame < 40; frame++) {
      // Exercise floor/depth respawns, drag, gravity, movement and dt clamping.
      origin.transform[12] = fallbackOrigin.transform[12] = Math.sin(frame * 0.4) * 0.1;
      const dt = frame % 5 === 0 ? 0.2 : 1 / 72;
      ctrl.update(viewer, dt, 0, depth);
      fallbackCtrl.update(fallback, dt, 0, depth);
      const actual = ctrl.emitterFor(origin)!;
      const expected = fallbackCtrl.emitterFor(fallbackOrigin)!;
      assert.deepEqual(actual.positions, expected.positions, `${preset}: positions`);
      assert.deepEqual(actual.velocities, expected.velocities, `${preset}: velocities`);
      assert.equal(actual.collisions, expected.collisions, `${preset}: collisions`);
      const prim = viewer.meshes[1].primitives[0];
      const reference = fallback.meshes[1].primitives[0];
      assert.equal(prim.positions.length, 24);
      assert.equal(prim.indices.length, 12);
      assert.equal(prim.instanceCount, count);
      assert.equal(prim.translations, actual.positions, 'no per-frame packing or copies');
      assert.deepEqual(prim.baseColor, reference.baseColor);
      assert.equal(viewer.meshes[1].extras.xr.pointerEvents, 'none');
      for (let i = 0; i < count; i++) {
        for (let j = 0; j < 24; j++) {
          // A GPU float add may differ from JS double-add-then-round by one ULP.
          const expanded = Math.fround(actual.positions[i * 3 + j % 3] + prim.positions[j]);
          assert.ok(Math.abs(expanded - reference.positions[i * 24 + j]) < 1e-6,
            `${preset}: cross-quad position ${i}:${j}`);
          assert.equal(prim.normals[j], reference.normals[i * 24 + j]);
        }
        for (let j = 0; j < 12; j++) {
          assert.equal(prim.indices[j] + i * 8, reference.indices[i * 12 + j]);
        }
      }
    }
    const data = gpu.uploads.filter(x => x.usage !== undefined);
    assert.equal(data.length, 5, 'one-time geometry/center allocation');
    assert.deepEqual(data.slice(0, 4).map(x => x.usage), [35044, 35044, 35044, 35044]);
    assert.equal(data[4].usage, 35048);
    assert.deepEqual(gpu.divisors, [[3, 1]]);
    const updates = gpu.uploads.filter(x => x.usage === undefined);
    assert.equal(updates.length, 40);
    assert.ok(updates.every(x => x.bytes === count * 12 && x.buffer === data[4].buffer));
    ctrl.dispose(viewer);
    ctrl.dispose(viewer);
    assert.equal(viewer.meshes.length, 1);
    assert.equal(gpu.deleted.size, 6, 'all five buffers and VAO released exactly once');
  }
}

for (const missing of ['marker', 'drawElementsInstanced', 'vertexAttribDivisor']) {
  const gpu = mockGL();
  if (missing !== 'marker') delete gpu.gl[missing];
  const viewer = {gl: gpu.gl, supportsInstanceOffsets: missing !== 'marker', meshes: [source()] as any[]};
  const ctrl = new XRDepthParticlesController();
  ctrl.update(viewer, 1 / 60);
  assert.equal(viewer.meshes[1].primitives[0].positions.byteLength, 192000);
  assert.equal(viewer.meshes[1].primitives[0].instanceCount, undefined);
  assert.equal(gpu.uploads.at(-1)!.bytes, 192000, `${missing}: expanded fallback`);
  ctrl.dispose(viewer);
}

{
  const gpu = mockGL();
  const sources = Array.from({length: 9}, () => source('snow', 1e9));
  const viewer = {gl: gpu.gl, supportsInstanceOffsets: true, meshes: [...sources] as any[]};
  const ctrl = new XRDepthParticlesController();
  ctrl.update(viewer, 1 / 60);
  assert.equal(ctrl.emitterCount, 8);
  assert.equal(gpu.uploads.filter(x => x.usage === undefined).reduce((n, x) => n + x.bytes, 0), 192000);
  sources[0].userData.xr.particles.count = 5;
  ctrl.update(viewer, 1 / 60);
  assert.equal(ctrl.emitterFor(sources[0])!.positions.length, 15);
  assert.equal(gpu.deleted.size, 6, 'option change releases old geometry');
  viewer.meshes.splice(viewer.meshes.indexOf(sources[0]), 1);
  ctrl.update(viewer, 1 / 60);
  assert.equal(ctrl.emitterFor(sources[0]), undefined);
  ctrl.dispose(viewer);
  assert.ok(viewer.meshes.every(m => !m.isPluginMesh));
}

{
  const gpu = mockGL();
  const viewer = {gl: gpu.gl, supportsInstanceOffsets: true, meshes: [] as any[]};
  const geometry = {positions: new Float32Array(24), normals: new Float32Array(24),
    indices: new Uint16Array(12), translations: new Float32Array(6)};
  const mesh = createDynamicMesh(viewer, geometry, {name: 'reattach', pickable: false});
  viewer.meshes.length = 0;
  reattachDynamicMesh(viewer, mesh);
  assert.equal(mesh.primitives[0].instanceCount, 2);
  assert.equal(mesh.primitives[0].buffers.length, 5);
  assert.equal(viewer.meshes[0], mesh);
  updateDynamicMesh(viewer, mesh, {...geometry, translations: undefined});
  assert.equal(mesh.primitives[0].instanceCount, undefined);
  assert.equal(mesh.primitives[0].buffers.length, 4);
}

// The geometry template must not change seeded simulation or consume its RNG.
const a = new ParticleEmitter({preset: 'rain', count: 1, area: [1, 1, 1], speed: 1}, 7);
const b = new ParticleEmitter(a.options, 7);
a.writeVertices(new Float32Array(24));
a.reset([1, 2, 3]); b.reset([1, 2, 3]);
assert.deepEqual(a.positions, b.positions);
console.log('PASS particle instancing: topology, simulation/depth, uploads, caps, fallback and lifecycle');

{
  const draws: any[][] = [];
  const genericOffsets: number[][] = [];
  const shaders: string[] = [];
  const instancedModes: number[] = [];
  const mock = mockGL();
  const gl: any = new Proxy({...mock.gl,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getUniformLocation: (_program: any, name: string) => name,
    uniform1i: (name: string, value: number) => {if (name === 'uInstanced') instancedModes.push(value);},
    drawArraysInstanced: (...args: any[]) => draws.push(['arrays-instanced', ...args]),
    shaderSource: (_shader: any, source: string) => shaders.push(source),
    drawElements: (...args: any[]) => draws.push(['ordinary', ...args]),
    drawElementsInstanced: (...args: any[]) => draws.push(['instanced', ...args]),
    vertexAttrib3f: (...args: number[]) => genericOffsets.push(args),
  }, {get: (target: any, key: string) => key in target ? target[key] : () => ({})});
  const attached: any[][] = [], detached: any[][] = [];
  const canvas: any = {width: 64, height: 64, clientWidth: 64, clientHeight: 64,
    style: {}, getContext: () => gl, addEventListener: (...args: any[]) => attached.push(args.slice(0, 2)),
    removeEventListener: (...args: any[]) => detached.push(args.slice(0, 2)),
    getBoundingClientRect: () => ({left: 0, top: 0, width: 64, height: 64})};
  const viewer = new ThreeView(canvas, canvas, {autoStart: false, autoRotate: false});
  const origin = source('rain', 2000);
  viewer.meshes.push({...origin, normalMatrix: new Float32Array(9), nodeIndex: 0, primitives: []} as any);
  const ctrl = new XRDepthParticlesController();
  const pluginViewer = viewer as unknown as PluginViewer;
  ctrl.update(pluginViewer, 1 / 60);
  createDynamicMesh(pluginViewer, {positions: new Float32Array(9), normals: new Float32Array(9),
    indices: new Uint16Array([0, 1, 2])}, {name: 'ordinary'});
  viewer.render();
  assert.deepEqual(draws.map(d => [d[0], d[2], d[5]]), [
    ['instanced', 12, 2000], ['ordinary', 3, undefined],
  ]);
  assert.deepEqual(genericOffsets, [[3, 0, 0, 0], [3, 0, 0, 0]]);
  assert.ok(shaders.some(s => s.includes('vec3 aPosition=aPos+aOff;')));
  assert.ok(shaders.some(s => s.includes('vec4 world=uModel*vec4(aPosition,1.0);') &&
    s.includes('gl_Position=uMVP*vec4(aPosition,1.0);')), 'position translates in both world and clip space');
  const ordinary = viewer.meshes.find((m: any) => m.name === 'ordinary') as any;
  ordinary.instanceMatrices = new Float32Array([...mat4Create(), ...mat4Create()]);
  draws.length = 0;
  viewer.render();
  assert.equal(draws.filter(d => d[0] === 'ordinary').length, 2,
    'existing mesh instance-matrix path still draws both instances');
  assert.equal(draws.filter(d => d[0] === 'instanced').length, 1,
    'particle primitive keeps its separate hardware-instancing path');
  // The upstream EXT_mesh_gpu_instancing VAO uses locations 8..12, not
  // the independent particle translation at location 3. Exercise both draw
  // forms and then another frame to catch leaked uInstanced state.
  ordinary.primitives[0].instanced = true;
  for (const indexed of [true, false]) {
    ordinary.primitives[0].indices = indexed ? new Uint16Array([0, 1, 2]) : null;
    draws.length = 0;
    instancedModes.length = 0;
    viewer.render();
    assert.deepEqual(draws.map(d => d[0]), ['instanced', indexed ? 'instanced' : 'arrays-instanced']);
    assert.equal(draws[1].at(-1), 2, 'upstream hardware mesh instance count');
    assert.deepEqual(instancedModes, [0, 0, 1, 0], 'particle uses offsets without mesh TRS and mesh mode resets');
  }
  ordinary.primitives[0].indices = new Uint16Array([0, 1, 2]);
  delete ordinary.instanceMatrices;
  const actualVS = shaders.find(s => s.includes('vec3 aPosition=aPos+aOff;'))!;
  for (let location = 8; location <= 12; location++) {
    assert.ok(actualVS.includes(`layout(location=${location}) in vec4 aInst`));
  }
  assert.ok(actualVS.includes('uModel*mat4(aInst0,aInst1,aInst2,aInst3)'));
  const morphed = morphPlugin.onResolveShader!({targets: [{POSITION: 0}]}, {}, actualVS, '')!;
  const skinned = skinningPlugin.onResolveShader!({attributes: {JOINTS_0: 0, WEIGHTS_0: 1}}, {}, actualVS, '')!;
  const combined = skinningPlugin.onResolveShader!({attributes: {JOINTS_0: 0, WEIGHTS_0: 1}}, {}, morphed.vs, '')!;
  assert.ok(morphed.vs.includes('gl_Position=uMVP*vec4(morphedPos,1.0);'));
  assert.ok(skinned.vs.includes('gl_Position=uMVP*(skinMatrix*vec4(aPosition,1.0));'));
  assert.ok(combined.vs.includes('gl_Position=uMVP*(skinMatrix*vec4(morphedPos,1.0));'),
    'actual viewer shader deforms morph, skin and their combination');
  const particle = viewer.meshes.find((m: any) => m.name.startsWith('__xr_particles')) as any;
  const before = particle.primitives[0];
  const vao = before.vao, buffers = [...before.buffers];
  const offsets = new Float32Array(before.translations.length); offsets.fill(2);
  updateDynamicMesh(pluginViewer, particle, {positions: before.positions, normals: before.normals, indices: before.indices, translations: offsets});
  assert.equal(before.vao, vao); assert.deepEqual(before.buffers, buffers);
  assert.equal(mock.uploads.at(-1)?.buffer, buffers[4], 'instance update reuses and updates the fifth buffer');
  assert.equal(before.translations, offsets);
  ctrl.dispose(pluginViewer);
  viewer.dispose();
  assert.equal(detached.length, attached.length);
  assert.ok(attached.every(([name, fn]) => detached.some(([n, f]) => n === name && f === fn)),
    'viewer disposal releases every registered canvas/container listener');
  console.log('PASS shared renderer: instanced draw count and ordinary draw isolation');
}

// Failed allocation must not publish a half-created mesh or leak its prefix.
for (let failedAt = 0; failedAt <= 5; failedAt++) {
  const gpu = mockGL();
  const viewer = {gl: gpu.gl, meshes: []};
  const geometry = {positions: new Float32Array(24), normals: new Float32Array(24),
    indices: new Uint16Array(12), translations: new Float32Array(3)};
  let allocated = 0;
  if (failedAt === 0) gpu.gl.createVertexArray = () => null;
  else {
    const create = gpu.gl.createBuffer;
    gpu.gl.createBuffer = () => ++allocated === failedAt ? null : create();
  }
  assert.throws(() => createDynamicMesh(viewer, geometry, {name: 'failed'}), /allocation failed/);
  assert.equal(viewer.meshes.length, 0);
  assert.equal(gpu.deleted.size, failedAt);
}
console.log('PASS failed dynamic allocations release every owned GPU object');

// Topology normals are sparse unit axes; initialization must not allocate a
// temporary three-element array for every vertex.
{
  const {normals, indices} = buildParticleTopology(2000);
  for (let i = 0; i < normals.length / 3; i++) {
    assert.deepEqual(Array.from(normals.subarray(i * 3, i * 3 + 3)),
      i % 8 < 4 ? [0, 0, 1] : [1, 0, 0]);
  }
  assert.equal(indices.length, 24000);
}

// Confetti drag depends on frame time, never on particle index. Compute it
// once per frame even at the particle cap; the velocity formula is unchanged.
{
  const emitter = new ParticleEmitter({preset: 'confetti', count: 2000,
    area: [100, 100, 100], speed: 1}, 7);
  emitter.reset([0, 0, 0]);
  const velocity = emitter.velocities.slice();
  const pow = Math.pow;
  let calls = 0;
  Math.pow = (base, exponent) => { calls++; return pow(base, exponent); };
  try {
    emitter.step(1 / 72, [0, 0, 0]);
  } finally {
    Math.pow = pow;
  }
  assert.equal(calls, 1);
  const drag = pow(0.9, 60 / 72);
  for (let i = 0; i < 2000; i++) {
    assert.equal(emitter.velocities[i * 3], Math.fround(velocity[i * 3] * drag));
    assert.equal(emitter.velocities[i * 3 + 2], Math.fround(velocity[i * 3 + 2] * drag));
  }
}
console.log('PASS particle setup allocations and frame-invariant drag');
