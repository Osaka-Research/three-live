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
import {gzipSync} from 'node:zlib';
import {gunzip, loadSplat, parseSplat, parseSpzPayload, MAX_SPLAT_FILE_BYTES} from '../src/plugins/splat-loader';

async function run(): Promise<void> {
  const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(await gunzip(gzipSync(bytes), bytes.length), bytes);
  await assert.rejects(gunzip(gzipSync(bytes), bytes.length - 1),
    /decompressed \.spz exceeds size limit/);
  await assert.rejects(gunzip(new Uint8Array([31, 139, 8]), 100));

  // Minimal .splat with nonzero scales and a valid quaternion.
  const record = new Uint8Array(32);
  const view = new DataView(record.buffer);
  for (const offset of [12, 16, 20]) view.setFloat32(offset, 1, true);
  record.set([255, 128, 128, 128], 28);
  const response = (body: unknown, arrayBuffer?: () => Promise<ArrayBuffer>) => ({
    ok: true, status: 200, headers: {get: () => null}, body, arrayBuffer,
  }) as unknown as Response;
  let reads = 0;
  const chunks = [record.slice(0, 7), record.slice(7)];
  const fetchChunks = async () => response({getReader: () => ({
    read: async () => reads < chunks.length
      ? {done: false, value: chunks[reads++]} : {done: true},
  })});
  const streamed = await loadSplat('https://localhost/scene.splat', fetchChunks as typeof fetch);
  const fallback = await loadSplat('https://localhost/scene.splat',
    (async () => response(null, async () => record.buffer)) as typeof fetch);
  assert.equal(streamed.count, 1);
  assert.deepEqual(streamed, fallback);

  let cancelled = false;
  let oversizedReads = 0;
  const oversized = new Uint8Array(MAX_SPLAT_FILE_BYTES + 1);
  const fetchOversized = async () => response({getReader: () => ({
    read: async () => { oversizedReads++; return {done: false, value: oversized}; },
    cancel: async () => { cancelled = true; },
  })});
  await assert.rejects(loadSplat('https://localhost/scene.splat', fetchOversized as typeof fetch),
    /file too large/);
  assert.equal(cancelled, true);
  assert.equal(oversizedReads, 1, 'stop reading immediately after the cap');
  await assert.rejects(loadSplat('https://localhost/scene.splat',
    (async () => response(null, async () => oversized.buffer)) as typeof fetch), /file too large/);
  const fetchFailed = async () => response({getReader: () => ({
    read: async () => { throw new Error('stream interrupted'); },
  })});
  await assert.rejects(loadSplat('https://localhost/scene.splat', fetchFailed as typeof fetch),
    /stream interrupted/);
  // Every packed wxyz quaternion must retain its original Float32 rounding.
  const records = new Uint8Array(256 * 32);
  for (let i = 0; i < records.length; i++) records[i] = (i * 37 + (i >>> 5)) & 255;
  const parsed = parseSplat(records);
  for (let i = 0; i < parsed.count; i++) {
    const q = new Float32Array([1, 2, 3, 0].map(k => (records[i * 32 + 28 + k] - 128) / 128));
    const len = Math.hypot(...q);
    if (len > 1e-8) for (let k = 0; k < 4; k++) q[k] /= len;
    else q.set([0, 0, 0, 1]);
    assert.deepEqual(parsed.rotations.subarray(i * 4, i * 4 + 4), q);
  }

  // Alternate every v3 omitted component, catching stale shared scratch.
  const count = 256;
  const payload = new Uint8Array(16 + count * 20);
  const header = new DataView(payload.buffer);
  header.setUint32(0, 0x5053474e, true);
  header.setUint32(4, 3, true);
  header.setUint32(8, count, true);
  const rotOffset = 16 + count * 16;
  const expected = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const largest = i % 4;
    const parts = [i * 7 & 1023, i * 19 & 1023, i * 31 & 1023];
    const packed = ((largest << 30) | (parts[2] << 20) | (parts[1] << 10) | parts[0]) >>> 0;
    header.setUint32(rotOffset + i * 4, packed, true);
    const q = [0, 0, 0, 0];
    let part = 0, sum = 0;
    for (let k = 3; k >= 0; k--) {
      if (k === largest) continue;
      const value = parts[part++];
      q[k] = (Math.SQRT1_2 * (value & 511) / 511) * (value & 512 ? -1 : 1);
      sum += q[k] * q[k];
    }
    q[largest] = Math.sqrt(Math.max(0, 1 - sum));
    const rounded = new Float32Array(q);
    const len = Math.hypot(...rounded);
    for (let k = 0; k < 4; k++) rounded[k] /= len;
    expected.set(rounded, i * 4);
  }
  assert.deepEqual(parseSpzPayload(payload).rotations, expected);
  console.log('PASS capped splat streams and allocation-free quaternion decode');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
