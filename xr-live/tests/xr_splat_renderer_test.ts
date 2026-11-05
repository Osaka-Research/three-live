/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {strict as assert} from 'node:assert';
import {mat4Create, mat4Multiply} from '../../three-live/src/math';
import {registerPlugin, registeredPlugins} from '../../three-live/src/plugin';
import {ThreeView} from '../../three-live/src/three-view';
import {
  getSplatLoader,
  computeSplatViewColors,
  type SplatData,
  SplatRenderer,
  splatLoaderPlugin,
  sortSplatsByDepth,
} from '../src/plugins/splat-loader';

/** Models the VAO-owned element binding, not just the last bound buffer. */
function mockGL() {
  type Buffer = {order: Uint32Array | null};
  type VAO = {element: Buffer | null};
  let vao: VAO | null = null;
  let defaultElement: Buffer | null = null;
  const buffers: Buffer[] = [];
  const deleted: Buffer[] = [];
  const uploads: number[][] = [];
  const draws: number[][] = [];
  const matrices: number[][] = [];
  const focals: number[] = [];
  const colors: number[][] = [];
  const uniforms: Array<[unknown, number]> = [];
  let allocations = 0;
  let failBuffer = false;
  let depthWrite = true;
  let blend = false;
  const gl = {
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4, DYNAMIC_DRAW: 0x88e8,
    VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
    FLOAT: 0x1406, UNSIGNED_BYTE: 0x1401, UNSIGNED_INT: 0x1405,
    POINTS: 0, BLEND: 0x0be2, ONE: 1, ONE_MINUS_SRC_ALPHA: 0x0303,
    createShader: () => ({}), shaderSource() {}, compileShader() {},
    getShaderParameter: () => true, deleteShader() {},
    createProgram: () => ({}), attachShader() {}, linkProgram() {},
    getProgramParameter: () => true, deleteProgram() {},
    getUniformLocation: (_program: unknown, name: string) => name,
    createVertexArray: (): VAO => ({element: null}),
    bindVertexArray(value: VAO | null) { vao = value; },
    deleteVertexArray() {},
    createBuffer(): Buffer | null {
      if (failBuffer) return null;
      const buffer = {order: null};
      buffers.push(buffer);
      return buffer;
    },
    deleteBuffer(buffer: Buffer) { deleted.push(buffer); },
    bindBuffer(target: number, buffer: Buffer) {
      if (target !== gl.ELEMENT_ARRAY_BUFFER) return;
      if (vao) vao.element = buffer;
      else defaultElement = buffer;
    },
    bufferData(target: number, size: number | ArrayBufferView) {
      if (target !== gl.ELEMENT_ARRAY_BUFFER) return;
      const element = vao ? vao.element : defaultElement;
      assert.ok(element);
      assert.equal(typeof size, 'number');
      element.order = new Uint32Array((size as number) / 4);
      allocations++;
    },
    bufferSubData(target: number, offset: number, data: Uint32Array) {
      if (target === gl.ARRAY_BUFFER) { colors.push(Array.from(data)); return; }
      assert.equal(target, gl.ELEMENT_ARRAY_BUFFER);
      assert.equal(offset, 0);
      assert.ok(vao?.element?.order);
      vao.element.order.set(data);
      uploads.push(Array.from(data));
    },
    enableVertexAttribArray() {}, vertexAttribPointer() {}, useProgram() {},
    uniformMatrix4fv(_location: unknown, _transpose: boolean, matrix: Float32Array) {
      matrices.push(Array.from(matrix));
    },
    uniform1i(location: unknown, value: number) { uniforms.push([location, value]); },
    uniform1f(_location: unknown, focal: number) { focals.push(focal); },
    enable() { blend = true; }, disable() { blend = false; }, blendFunc() {},
    depthMask(value: boolean) { depthWrite = value; },
    drawElements(_mode: number, count: number) {
      assert.ok(vao?.element?.order);
      assert.equal(depthWrite, false);
      assert.equal(blend, true);
      draws.push(Array.from(vao.element.order.subarray(0, count)));
    },
  };
  return {
    gl: gl as unknown as WebGL2RenderingContext,
    raw: gl, uploads, draws, matrices, focals, colors, uniforms, buffers, deleted,
    get allocations() { return allocations; },
    get vao() { return vao; },
    get depthWrite() { return depthWrite; },
    get blend() { return blend; },
    set failBuffer(value: boolean) { failBuffer = value; },
  };
}

function cloud(positions = [2, 0, -2, -2, 0, -2, 0, 1, -3]): SplatData {
  const count = positions.length / 3;
  return {
    count,
    positions: new Float32Array(positions),
    colors: new Uint8Array(count * 4).fill(128),
    scales: new Float32Array(count * 3).fill(0.2),
    rotations: new Float32Array(count * 4),
  };
}

function view(x = 0, y = 0, z = -1, w = 0): Float32Array {
  const matrix = mat4Create();
  matrix[3] = x;
  matrix[7] = y;
  matrix[11] = z;
  matrix[15] = w;
  return matrix;
}

function expected(data: SplatData, vp: Float32Array, model = mat4Create()): number[] {
  const mvp = mat4Create();
  mat4Multiply(mvp, vp, model);
  return Array.from(sortSplatsByDepth(data, mvp));
}

let passed = 0;
let failed = 0;
function test(name: string, run: () => void): void {
  try {
    run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}`, error);
  }
}

test('Float32 depth rounding cannot produce negative buckets or duplicate indices', () => {
  const order = sortSplatsByDepth(cloud(), view(Math.sin(4)));
  assert.deepEqual(Array.from(order), [1, 2, 0]);
});

test('mono, WebXR, and side-by-side render hooks forward the active eye to the loader', () => {
  const mock = mockGL();
  const gl = Object.assign(mock.raw, {viewport() {}, clearColor() {}, clear() {}});
  const viewer = {
    gl, canvas: {width: 96, height: 96}, bounds: {center: [0, 0, 0], radius: 1},
    clearColor: [0, 0, 0], backdropMeshes: [], meshes: [{visible: false}],
    viewMatrix: mat4Create(), projMatrix: mat4Create(), modelRootMatrix: mat4Create(),
    currDistance: 3, currPhi: 0, currTheta: 0, fov: Math.PI / 3,
    stereoSBS: false, render: ThreeView.prototype.render,
  };
  const eyes: Array<string | undefined> = [];
  const viewports: Array<readonly number[] | undefined> = [];
  const projections: Array<Float32Array | undefined> = [];
  const loader = getSplatLoader(viewer);
  loader.draw = (_viewer, _vp, eye, viewport, projection) => {
    eyes.push(eye); viewports.push(viewport); projections.push(projection);
  };
  registerPlugin(splatLoaderPlugin);
  try {
    viewer.render();
    for (const eye of ['left', 'right']) {
      ThreeView.prototype.renderXRView.call(viewer as unknown as ThreeView, {
        eye, projectionMatrix: mat4Create(),
        transform: {inverse: {matrix: mat4Create()}},
      });
    }
    viewer.stereoSBS = true;
    viewer.render();
    assert.deepEqual(eyes, ['none', 'left', 'right', 'left', 'right']);
    assert.deepEqual(viewports[0], [0, 0, 96, 96]);
    assert.deepEqual(viewports.slice(3), [[0, 0, 48, 96], [48, 0, 48, 96]]);
    assert.ok(projections.every(p => p?.length === 16));
  } finally {
    registeredPlugins.splice(registeredPlugins.indexOf(splatLoaderPlugin), 1);
    splatLoaderPlugin.onDestroy!(mock.gl, viewer);
  }
});

test('first draw sorts, then 32 unchanged draws avoid sorting and uploading', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  for (let i = 0; i < 33; i++) renderer.draw(view(), mat4Create(), 500);
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.allocations, 1);
  assert.equal(mock.draws.length, 33);
  for (const order of mock.draws) assert.deepEqual(order, expected(data, view()));
  assert.equal(mock.vao, null);
  assert.equal(mock.depthWrite, true);
  assert.equal(mock.blend, false);
});

test('moving mono retains the four-draw cadence and one GPU index buffer', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  for (let i = 0; i < 120; i++) {
    const vp = view(Math.sin(i));
    renderer.draw(vp, mat4Create(), 500);
    assert.deepEqual(mock.draws.at(-1), expected(data, view(Math.sin(i - i % 4))));
  }
  assert.equal(mock.uploads.length, 30);
  assert.equal(mock.allocations, 1);
});

test('model changes invalidate the depth order even when the VP object is unchanged', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  const model = mat4Create();
  const vp = view(1);
  renderer.draw(vp, model, 500);
  for (let i = 0; i < 3; i++) renderer.draw(vp, model, 500);
  model[0] = -1;
  renderer.draw(vp, model, 500);
  assert.equal(mock.uploads.length, 2);
  assert.notDeepEqual(mock.draws[0], mock.draws.at(-1));
  assert.deepEqual(mock.draws.at(-1), expected(data, vp, model));
  model[14] = -2;
  for (let i = 0; i < 4; i++) renderer.draw(vp, model, 500);
  assert.equal(mock.uploads.length, 3, 'depth offset is part of the exact sort key');
});

test('non-depth projection and focal changes update uniforms without re-sorting', () => {
  const mock = mockGL();
  const renderer = new SplatRenderer(mock.gl, cloud());
  const vp = view();
  renderer.draw(vp, mat4Create(), 500);
  vp[0] = 2;
  vp[5] = 3;
  vp[8] = 0.2;
  vp[9] = -0.1;
  vp[10] = -1.01;
  vp[14] = -0.2;
  for (let i = 0; i < 16; i++) renderer.draw(vp, mat4Create(), 700);
  assert.equal(mock.uploads.length, 1);
  assert.deepEqual(mock.matrices.at(-1), Array.from(vp));
  assert.equal(mock.focals.at(-1), 700);
});

test('parallel stereo projections share one physical GPU order', () => {
  const mock = mockGL();
  const renderer = new SplatRenderer(mock.gl, cloud());
  const left = view();
  const right = view();
  left[8] = 0.1;
  left[12] = 0.032;
  right[8] = -0.1;
  right[12] = -0.032;
  for (let frame = 0; frame < 16; frame++) {
    renderer.draw(left, mat4Create(), 500, undefined, undefined, false, 'left');
    renderer.draw(right, mat4Create(), 500, undefined, undefined, false, 'right');
  }
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.allocations, 1);
  assert.equal(mock.draws.length, 32);
});

test('moving parallel eyes share one sort per four frames even when eye order reverses', () => {
  for (const orthographic of [false, true]) {
    const mock = mockGL(), data = cloud(), renderer = new SplatRenderer(mock.gl, data);
    for (let frame = 0; frame < 60; frame++) {
      const depth = Math.sin(frame + 1);
      const matrix = orthographic ? mat4Create() : view(depth);
      if (orthographic) { matrix[2] = depth; matrix[10] = -1; }
      const wanted = orthographic ? mat4Create() : view(Math.sin(frame - frame % 4 + 1));
      if (orthographic) { wanted[2] = Math.sin(frame - frame % 4 + 1); wanted[10] = -1; }
      for (const eye of frame % 2 ? ['right', 'left'] as const : ['left', 'right'] as const) {
        // These projection/translation changes do not alter the active depth row.
        matrix[8] = eye === 'left' ? .1 : -.1;
        matrix[12] = eye === 'left' ? .032 : -.032;
        renderer.draw(matrix, mat4Create(), 500, undefined, undefined, false, eye);
        assert.deepEqual(mock.draws.at(-1), expected(data, wanted));
      }
    }
    assert.equal(mock.uploads.length, 15);
    assert.equal(mock.allocations, 1);
    assert.equal(mock.draws.length, 120);
    renderer.dispose(); renderer.dispose();
    assert.equal(mock.deleted.length, mock.buffers.length, 'shared storage retired once');
  }
});

test('sharing uses exact coefficients, never a tolerance or matching CPU order', () => {
  const mock = mockGL(), renderer = new SplatRenderer(mock.gl, cloud());
  renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, 'left');
  renderer.draw(view(1 + 2 ** -22), mat4Create(), 500, undefined, undefined, false, 'right');
  assert.equal(mock.allocations, 2); assert.equal(mock.uploads.length, 2);
});

test('parallel/canted transitions split before overwriting another eye and reuse bounded storage', () => {
  const mock = mockGL(), data = cloud(), renderer = new SplatRenderer(mock.gl, data);
  for (let cycle = 0; cycle < 100; cycle++) {
    // Keep each mode long enough to exhaust the approximate sorting cooldown.
    for (let frame = 0; frame < 8; frame++) {
      const parallel = cycle % 2 === 0;
      for (const [eye, x] of [['left', 1], ['right', parallel ? 1 : -1]] as const) {
        renderer.draw(view(x), mat4Create(), 500, undefined, undefined, false, eye);
        if (frame >= 4) assert.deepEqual(mock.draws.at(-1), expected(data, view(x)));
      }
    }
  }
  assert.equal(mock.allocations, 2);
  renderer.dispose(); renderer.dispose();
  assert.equal(mock.deleted.length, mock.buffers.length);
});

test('a divergent second eye cannot use the shared buffer when its split allocation fails', () => {
  const mock = mockGL(), data = cloud(), renderer = new SplatRenderer(mock.gl, data);
  for (let i = 0; i < 8; i++) for (const eye of ['left', 'right'] as const) {
    renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, eye);
  }
  assert.equal(mock.allocations, 1);
  renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, 'left');
  const before = mock.draws.length;
  mock.failBuffer = true;
  renderer.draw(view(-1), mat4Create(), 500, undefined, undefined, false, 'right');
  assert.equal(mock.draws.length, before);
  assert.equal(mock.vao, null);
  renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, 'left');
  assert.deepEqual(mock.draws.at(-1), expected(data, view(1)));
  mock.failBuffer = false;
  renderer.draw(view(-1), mat4Create(), 500, undefined, undefined, false, 'right');
  assert.deepEqual(mock.draws.at(-1), expected(data, view(-1)));
  assert.equal(mock.allocations, 2);
});

test('canted stereo retains and binds each eye\'s independent cached GPU order', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  const left = view(1);
  const right = view(-1);
  assert.notDeepEqual(expected(data, left), expected(data, right));
  for (let frame = 0; frame < 16; frame++) {
    renderer.draw(left, mat4Create(), 500, undefined, undefined, false, 'left');
    renderer.draw(right, mat4Create(), 500, undefined, undefined, false, 'right');
    assert.deepEqual(mock.draws[frame * 2], expected(data, left));
    assert.deepEqual(mock.draws[frame * 2 + 1], expected(data, right));
  }
  assert.equal(mock.uploads.length, 2);
  assert.equal(mock.allocations, 2);
});

test('moving stereo keeps independent four-draw cadences and settles without uploads', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  for (let frame = 0; frame < 60; frame++) {
    for (const [eye, sign] of [['left', 1], ['right', -1]] as const) {
      renderer.draw(view(sign * Math.sin(frame + 1)), mat4Create(), 500, undefined, undefined, false, eye);
      const sortedFrame = frame - frame % 4;
      assert.deepEqual(mock.draws.at(-1), expected(data, view(sign * Math.sin(sortedFrame + 1))));
    }
  }
  assert.equal(mock.uploads.length, 30);
  for (let frame = 0; frame < 8; frame++) {
    renderer.draw(view(8), mat4Create(), 500, undefined, undefined, false, 'left');
    renderer.draw(view(-8), mat4Create(), 500, undefined, undefined, false, 'right');
    assert.deepEqual(mock.draws.at(-2), expected(data, view(8)));
    assert.deepEqual(mock.draws.at(-1), expected(data, view(-8)));
  }
  assert.equal(mock.uploads.length, 32, 'each eye sorts once when it settles');
  assert.equal(mock.allocations, 2, 'moving views reuse bounded GPU storage');
});

test('a settled camera change sorts immediately after the cooldown has elapsed', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  for (let i = 0; i < 12; i++) renderer.draw(view(1), mat4Create(), 500);
  renderer.draw(view(-1), mat4Create(), 500);
  assert.equal(mock.uploads.length, 2);
  assert.deepEqual(mock.draws.at(-1), expected(data, view(-1)));
});

test('mode changes evict the least-recent eye and sort it correctly on return', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  const cases = [['left', view(1)], ['right', view(-1)], ['left', view(1)],
    ['none', view(0, 1)], ['left', view(1)]] as const;
  for (const [eye, vp] of cases) {
    renderer.draw(vp, mat4Create(), 500, undefined, undefined, false, eye);
    assert.deepEqual(mock.draws.at(-1), expected(data, vp));
  }
  assert.equal(mock.uploads.length, 3, 'recent left eye survives mode change');
  renderer.draw(view(-1), mat4Create(), 500, undefined, undefined, false, 'right');
  assert.equal(mock.uploads.length, 4);
  assert.deepEqual(mock.draws.at(-1), expected(data, view(-1)));
  assert.equal(mock.allocations, 2);
});

test('cached depth order does not suppress the existing SH color refresh cadence', () => {
  const mock = mockGL(), renderer = new SplatRenderer(mock.gl, cloud());
  const modelView = mat4Create(); modelView[14] = -3;
  const refreshes: number[][] = [];
  renderer.updateViewColors = camera => { refreshes.push(Array.from(camera)); };
  for (let frame = 0; frame < 12; frame++) for (const eye of ['left', 'right'] as const) {
    renderer.draw(view(), mat4Create(), 500, modelView, [frame, 0, 3], true, eye);
  }
  assert.equal(mock.uploads.length, 1, 'stationary shared indices upload once');
  assert.equal(refreshes.length, 6, 'SH keeps its existing once-per-four-draw refresh');
  assert.ok(refreshes.at(-1)![0] > refreshes[0][0], 'lateral camera changes still reach SH');
  assert.deepEqual(mock.matrices.at(-1), Array.from(modelView), 'fourth argument remains model-view');
});

test('replacement cloud starts with an invalid cache even at the same transform', () => {
  const mock = mockGL();
  const before = new SplatRenderer(mock.gl, cloud());
  before.draw(view(), mat4Create(), 500);
  before.dispose();
  const data = cloud([0, 0, -4, 0, 0, -1]);
  const after = new SplatRenderer(mock.gl, data);
  after.draw(view(), mat4Create(), 500);
  assert.equal(mock.uploads.length, 2);
  assert.deepEqual(mock.draws.at(-1), expected(data, view()));
});

test('cache misses and hits do not change another mesh VAO\'s element binding', () => {
  const mock = mockGL();
  const renderer = new SplatRenderer(mock.gl, cloud());
  const other = mock.raw.createVertexArray();
  const otherBuffer = mock.raw.createBuffer()!;
  mock.raw.bindVertexArray(other);
  mock.raw.bindBuffer(mock.raw.ELEMENT_ARRAY_BUFFER, otherBuffer);
  for (const vp of [view(1), view(-1), view(1), view(0, 1)]) {
    mock.raw.bindVertexArray(other);
    renderer.draw(vp, mat4Create(), 500);
    assert.equal(other.element, otherBuffer);
    assert.equal(mock.vao, null);
  }
});

test('empty cloud does not allocate index buffers or draw', () => {
  const mock = mockGL();
  const renderer = new SplatRenderer(mock.gl, cloud([]));
  renderer.draw(view(), mat4Create(), 500);
  assert.equal(mock.allocations, 0);
  assert.equal(mock.uploads.length, 0);
  assert.equal(mock.draws.length, 0);
});

test('failed index allocation leaves the VAO unbound and retries on the next draw', () => {
  const mock = mockGL();
  const renderer = new SplatRenderer(mock.gl, cloud());
  mock.failBuffer = true;
  renderer.draw(view(), mat4Create(), 500);
  assert.equal(mock.vao, null);
  assert.equal(mock.draws.length, 0);
  mock.failBuffer = false;
  renderer.draw(view(), mat4Create(), 500);
  assert.equal(mock.uploads.length, 1);
  assert.equal(mock.draws.length, 1);
});

test('dispose frees both cached GPU orders and prevents further draws', () => {
  const mock = mockGL();
  const renderer = new SplatRenderer(mock.gl, cloud());
  renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, 'left');
  renderer.draw(view(-1), mat4Create(), 500, undefined, undefined, false, 'right');
  renderer.dispose();
  assert.equal(mock.buffers.length, 7, 'five attributes plus two index buffers');
  assert.deepEqual(new Set(mock.deleted), new Set(mock.buffers));
  renderer.draw(view(), mat4Create(), 500);
  assert.equal(mock.draws.length, 2);
});

test('failed second index allocation preserves the first cached view', () => {
  const mock = mockGL();
  const data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, 'left');
  mock.failBuffer = true;
  renderer.draw(view(-1), mat4Create(), 500, undefined, undefined, false, 'right');
  assert.equal(mock.vao, null);
  assert.equal(mock.draws.length, 1);
  renderer.draw(view(1), mat4Create(), 500, undefined, undefined, false, 'left');
  assert.deepEqual(mock.draws.at(-1), expected(data, view(1)));
  assert.equal(mock.uploads.length, 1);
  mock.failBuffer = false;
  renderer.draw(view(-1), mat4Create(), 500, undefined, undefined, false, 'right');
  assert.deepEqual(mock.draws.at(-1), expected(data, view(-1)));
  assert.equal(mock.uploads.length, 2);
  assert.equal(mock.allocations, 2);
});

test('nonfinite and float32-overflow depths preserve every input index exactly once', () => {
  for (const values of [[0, NaN, 2], [0, Infinity, -Infinity], [1e38, 2e38, 3e38]]) {
    const data = {count: values.length, positions: new Float32Array(values.flatMap(x => [x, 0, 0]))};
    const matrix = mat4Create(); matrix[3] = 100;
    const out = sortSplatsByDepth(data, matrix);
    assert.deepEqual([...out].sort((a, b) => a - b), [0, 1, 2]);
  }
});
test('orthographic depth changes invalidate the cached view order', () => {
  const mock = mockGL(), data = cloud();
  const renderer = new SplatRenderer(mock.gl, data);
  const matrix = mat4Create(); matrix[2] = 1;
  renderer.draw(matrix, mat4Create(), 100);
  const first = [...mock.draws[0]];
  matrix[2] = -1;
  for (let i = 0; i < 4; i++) renderer.draw(matrix, mat4Create(), 100);
  assert.notDeepEqual(mock.draws.at(-1), first);
  renderer.dispose();
});


test('cached stereo indices preserve local-space SH, DC restoration, and antialias uniforms', () => {
  const mock = mockGL();
  const data = cloud([0, 0, 0]);
  data.shDegree = 1;
  data.sh = new Float32Array(9);
  data.sh[3] = 0.9;
  data.antialiased = true;
  const renderer = new SplatRenderer(mock.gl, data);
  const model = new Float32Array([0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 2, 0, 0, 1]);
  const camera = [-5, 0, 0];
  const expectedColors = computeSplatViewColors(data, model, camera, new Uint8Array(4));
  assert.ok(expectedColors[0] > data.colors[0] + 40);
  renderer.draw(view(), model, 500, mat4Create(), camera, true, 'left');
  renderer.draw(view(), model, 500, mat4Create(), camera, true, 'right');
  assert.deepEqual(mock.colors[0], Array.from(expectedColors));
  for (let frame = 0; frame < 4; frame++) {
    for (const eye of ['left', 'right'] as const) {
      renderer.draw(view(), model, 500, mat4Create(), camera, false, eye);
    }
  }
  assert.equal(mock.uploads.length, 1, 'restoring DC does not require a sort upload');
  assert.deepEqual(mock.colors.at(-1), Array.from(data.colors));
  assert.equal(mock.uniforms.filter(([name, value]) => name === 'uAntialias' && value === 1).length, 10);
  renderer.dispose();
});

test('loader uses current per-eye covariance, frame eye, viewport and projection with cached sorting', () => {
  const mock = mockGL();
  const data = cloud([0, 0, 0]);
  data.shDegree = 1;
  data.sh = new Float32Array(9);
  data.sh[3] = 0.9;
  const renderer = new SplatRenderer(mock.gl, data);
  const model = mat4Create();
  const mesh = {transform: model};
  const activeView = mat4Create(); activeView[14] = -9;
  const viewer = {
    gl: mock.gl, meshes: [mesh], viewMatrix: mat4Create(),
    activeViewMatrix: activeView, cameraPos: [999, 999, 999],
    container: {getAttribute: () => 'high'},
  };
  const loader = getSplatLoader(viewer);
  (loader as unknown as {entries: Map<unknown, unknown>}).entries.set(mesh, {renderer});
  const projection = mat4Create(); projection[5] = 2;
  try {
    for (let frame = 0; frame < 3; frame++) {
      for (const eye of ['left', 'right'] as const) {
        const camera: [number, number, number] = [frame, 0, 5];
        splatLoaderPlugin.onBeforeDrawScene!(viewer, mock.gl, view(), camera, 0);
        splatLoaderPlugin.onAfterRender!(mock.gl, viewer, view(), eye, [0, 0, 320, 240], projection);
      }
    }
    assert.equal(mock.uploads.length, 1);
    assert.ok(mock.focals.every(value => value === 240));
    assert.deepEqual(mock.matrices.at(-1), Array.from(activeView));
    assert.deepEqual(mock.colors.at(-1), Array.from(computeSplatViewColors(data, model, [2, 0, 5], new Uint8Array(4))));
  } finally {
    splatLoaderPlugin.onDestroy!(mock.gl, viewer);
  }
});

console.log(`Splat renderer: ${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
