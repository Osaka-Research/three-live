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

import assert from 'node:assert/strict';
import {mat3NormalFromMat4} from '../../three-live/src/math';
import {computeSplatViewColors, evaluateSplatSH, type SplatData}
  from '../src/plugins/splat-loader';

// Independent scalar implementation retained to detect rounding and fallback
// regressions when the renderer shares the engine's normal-matrix helper.
function referenceViewColors(
  data: SplatData,
  model: ArrayLike<number>,
  cameraWorldPos: ArrayLike<number>,
  out: Uint8Array,
): Uint8Array {
  const [m0, m1, m2, m4, m5, m6, m8, m9, m10] = [
    model[0],
    model[1],
    model[2],
    model[4],
    model[5],
    model[6],
    model[8],
    model[9],
    model[10],
  ];
  // Rows of inverse(M3) (= adjugate / det), mapping world -> local.
  let i00 = m5 * m10 - m6 * m9;
  let i01 = m8 * m6 - m4 * m10;
  let i02 = m4 * m9 - m8 * m5;
  let i10 = m9 * m2 - m1 * m10;
  let i11 = m0 * m10 - m8 * m2;
  let i12 = m8 * m1 - m0 * m9;
  let i20 = m1 * m6 - m5 * m2;
  let i21 = m4 * m2 - m0 * m6;
  let i22 = m0 * m5 - m4 * m1;
  const det = m0 * i00 + m1 * i01 + m2 * i02;
  if (Math.abs(det) > 1e-12 && Number.isFinite(det)) {
    i00 /= det;
    i01 /= det;
    i02 /= det;
    i10 /= det;
    i11 /= det;
    i12 /= det;
    i20 /= det;
    i21 /= det;
    i22 /= det;
  } else {
    [i00, i01, i02, i10, i11, i12, i20, i21, i22] = [
      m0,
      m1,
      m2,
      m4,
      m5,
      m6,
      m8,
      m9,
      m10,
    ];
  }
  const cx = cameraWorldPos[0];
  const cy = cameraWorldPos[1];
  const cz = cameraWorldPos[2];
  const pos = data.positions;
  for (let i = 0; i < data.count; i++) {
    const lx = pos[i * 3];
    const ly = pos[i * 3 + 1];
    const lz = pos[i * 3 + 2];
    const dx = model[0] * lx + model[4] * ly + model[8] * lz + model[12] - cx;
    const dy = model[1] * lx + model[5] * ly + model[9] * lz + model[13] - cy;
    const dz = model[2] * lx + model[6] * ly + model[10] * lz + model[14] - cz;
    const [r, g, b] = evaluateSplatSH(
      data,
      i,
      i00 * dx + i01 * dy + i02 * dz,
      i10 * dx + i11 * dy + i12 * dz,
      i20 * dx + i21 * dy + i22 * dz,
    );
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = data.colors[i * 4 + 3];
  }
  return out;
}

let seed = 0x51a7;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const count = 32;
const data: SplatData = {
  count,
  positions: Float32Array.from({length: count * 3}, () => (random() - 0.5) * 100),
  colors: Uint8Array.from({length: count * 4}, () => Math.floor(random() * 256)),
  scales: new Float32Array(count * 3).fill(1),
  rotations: new Float32Array(count * 4),
  shDegree: 3,
  sh: Float32Array.from({length: count * 45}, () => (random() - 0.5) * 2),
};
let cases = 0;
function compare(model: ArrayLike<number>, camera: ArrayLike<number>): void {
  const expected = referenceViewColors(data, model, camera, new Uint8Array(count * 4));
  assert.deepEqual(computeSplatViewColors(data, model, camera, new Uint8Array(count * 4)),
    expected, `RGBA colors differ for case ${cases}`);
  cases++;
}
for (let i = 0; i < 10000; i++) {
  const model = Float64Array.from({length: 16}, () => (random() - 0.5) * 20);
  model[3] = model[7] = model[11] = 0; model[15] = 1;
  compare(model, [(random() - 0.5) * 100, (random() - 0.5) * 100, (random() - 0.5) * 100]);
}
// Explicit rotation, reflection, nonuniform scale, translation, singular,
// near-singular, and nonfinite inputs exercise the determinant fallback.
for (const scale of [1, -1, 0, 1e-13, 1e-12, 1.001e-12, 1e12, Infinity, NaN]) {
  const model = new Float64Array([
    0, 0, -scale, 0, 0, 2, 0, 0, 0.5, 0, 0, 0, 20, -3, 7, 1,
  ]);
  compare(model, [-5, 4, 2]);
}
const singular = new Float32Array(16);
const retained = new Float32Array(9).fill(7);
assert.equal(mat3NormalFromMat4(retained, singular), retained);
assert.deepEqual(Array.from(retained), Array(9).fill(7));
const nonfinite = new Float32Array([Infinity,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
assert.ok(Number.isNaN(mat3NormalFromMat4(new Float32Array(9), nonfinite)[4]),
  'default normal-matrix behavior for nonfinite inputs remains unchanged');
console.log(`Splat SH colors: ${cases} exact RGBA differential cases passed.`);
