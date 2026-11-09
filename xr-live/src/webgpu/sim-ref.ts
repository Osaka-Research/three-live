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
 *
 * @fileoverview Bit-exact reference helpers for `xr-live/src/webgpu/shaders.ts`
 * (IEEE fp16 unpacking, sortable-uint conversion, and deterministic 2-pass
 * 8-bit tiled radix sort simulation). Kept in a separate module so production
 * bundles (`xr-live-webgpu.min.js`) do not pay for test-only simulation code.
 */

import {type SplatData} from '../plugins/splat-loader';
import {WEBGPU_RADIX_TILE_SIZE} from './shaders';

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** Unpacks an IEEE-754 binary16 (fp16) bit pattern (`0..65535`) to `f32`. */
export function float16BitsToFloat32(h: number): number {
  const sign = (h & 0x8000) << 16;
  const exp = (h >>> 10) & 0x1f;
  const mant = h & 0x03ff;
  if (exp === 0) {
    if (mant === 0) {
      u32Scratch[0] = sign;
      return f32Scratch[0];
    }
    let m = mant;
    let e = -14;
    while ((m & 0x0400) === 0) {
      m <<= 1;
      e--;
    }
    m &= 0x03ff;
    u32Scratch[0] = sign | ((e + 127) << 23) | (m << 13);
    return f32Scratch[0];
  }
  if (exp === 0x1f) {
    u32Scratch[0] = sign | 0x7f800000 | (mant << 13);
    return f32Scratch[0];
  }
  u32Scratch[0] = sign | ((exp - 15 + 127) << 23) | (mant << 13);
  return f32Scratch[0];
}

/** Maps a finite IEEE-754 `f32` bit pattern monotonically onto `u32`. */
export function floatBitsToSortableUint(bits: number): number {
  return (bits & 0x80000000) !== 0
    ? (~bits) >>> 0
    : (bits ^ 0x80000000) >>> 0;
}

/** Inverse of {@link floatBitsToSortableUint}. */
export function sortableUintToFloat(sortable: number): number {
  const s = sortable >>> 0;
  u32Scratch[0] =
    (s & 0x80000000) !== 0 ? (s ^ 0x80000000) >>> 0 : (~s) >>> 0;
  return f32Scratch[0];
}

/**
 * Deterministic JS simulation of the exact WGSL `kDepthAndSH -> kQuantizeKeys
 * -> 2-pass 8-bit tiled radix sort` pipeline (including IEEE-754 sortable-uint
 * bounds reduction, half-range overflow-safe quantization, and multi-tile
 * histogram/scan/scatter) used in Node unit tests to verify bit-for-bit parity
 * with `sortSplatsByDepth`.
 */
export function simulateWebGPUSplatSort(
  data: Pick<SplatData, 'count' | 'positions'>,
  mvp: ArrayLike<number>,
): Uint32Array {
  const n = data.count;
  if (n === 0) return new Uint32Array(0);
  const p = data.positions;
  const row = mvp[3] === 0 && mvp[7] === 0 && mvp[11] === 0 ? 2 : 3;
  const depthsBits = new Uint32Array(n);
  let minS = 0xffffffff;
  let maxS = 0;

  for (let i = 0; i < n; i++) {
    f32Scratch[0] =
      Math.fround(mvp[row]) * Math.fround(p[i * 3]) +
      Math.fround(mvp[4 + row]) * Math.fround(p[i * 3 + 1]) +
      Math.fround(mvp[8 + row]) * Math.fround(p[i * 3 + 2]) +
      Math.fround(mvp[12 + row]);
    const bits = u32Scratch[0];
    depthsBits[i] = bits;
    if ((bits & 0x7f800000) !== 0x7f800000) {
      const su = floatBitsToSortableUint(bits);
      if (su < minS) minS = su;
      if (su > maxS) maxS = su;
    }
  }

  let minD = 0;
  let maxD = 0;
  if (maxS >= minS) {
    minD = sortableUintToFloat(minS);
    maxD = sortableUintToFloat(maxS);
  }

  let keysIn = new Uint32Array(n);
  let valsIn = new Uint32Array(n);
  let keysOut = new Uint32Array(n);
  let valsOut = new Uint32Array(n);

  for (let i = 0; i < n; i++) {
    const bits = depthsBits[i];
    let key = 0;
    if ((bits & 0x7f800000) === 0x7f800000) {
      key = bits === 0xff800000 ? 65535 : 0;
    } else if (maxD > minD) {
      u32Scratch[0] = bits;
      const d = f32Scratch[0];
      const halfRange = Math.fround(
        Math.fround(0.5 * maxD) - Math.fround(0.5 * minD),
      );
      const num = Math.fround(Math.fround(0.5 * maxD) - Math.fround(0.5 * d));
      const raw = Math.fround(Math.fround(num / halfRange) * 65535);
      const f = Math.max(0, Math.min(65535, raw));
      key = Math.floor(f) >>> 0;
    }
    keysIn[i] = key;
    valsIn[i] = i;
  }

  const numTiles = Math.ceil(n / WEBGPU_RADIX_TILE_SIZE);
  const hist = new Uint32Array(256 * numTiles);
  const blockSums = new Uint32Array(numTiles);

  for (const shift of [0, 8]) {
    hist.fill(0);
    for (let t = 0; t < numTiles; t++) {
      const base = t * WEBGPU_RADIX_TILE_SIZE;
      const end = Math.min(n, base + WEBGPU_RADIX_TILE_SIZE);
      for (let i = base; i < end; i++) {
        const d = (keysIn[i] >>> shift) & 0xff;
        hist[d * numTiles + t]++;
      }
    }
    for (let b = 0; b < numTiles; b++) {
      let sum = 0;
      for (let lid = 0; lid < 256; lid++) {
        const gid = b * 256 + lid;
        const v = hist[gid];
        hist[gid] = sum;
        sum = (sum + v) >>> 0;
      }
      blockSums[b] = sum;
    }
    let topRunning = 0;
    for (let b = 0; b < numTiles; b++) {
      const v = blockSums[b];
      blockSums[b] = topRunning;
      topRunning = (topRunning + v) >>> 0;
    }
    for (let b = 0; b < numTiles; b++) {
      const add = blockSums[b];
      for (let lid = 0; lid < 256; lid++) {
        hist[b * 256 + lid] = (hist[b * 256 + lid] + add) >>> 0;
      }
    }
    const digitBase = new Uint32Array(256);
    for (let t = 0; t < numTiles; t++) {
      for (let d = 0; d < 256; d++) {
        digitBase[d] = hist[d * numTiles + t];
      }
      const base = t * WEBGPU_RADIX_TILE_SIZE;
      const end = Math.min(n, base + WEBGPU_RADIX_TILE_SIZE);
      for (let i = base; i < end; i++) {
        const k = keysIn[i];
        const v = valsIn[i];
        const d = (k >>> shift) & 0xff;
        const dst = digitBase[d]++;
        keysOut[dst] = k;
        valsOut[dst] = v;
      }
    }
    [keysIn, keysOut] = [keysOut, keysIn];
    [valsIn, valsOut] = [valsOut, valsIn];
  }

  return valsIn;
}
