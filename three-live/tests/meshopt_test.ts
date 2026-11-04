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

// Spec-conformance tests for the EXT_meshopt_compression / KHR_meshopt_compression
// decoders against golden vectors produced by the reference meshoptimizer
// library (`third_party/meshoptimizer`, scalar build): `meshopt_encodeVertexBufferLevel`
// (codec v0 and v1), `meshopt_encodeIndexBuffer` (v0 and v1),
// `meshopt_encodeIndexSequence`, and `meshopt_encodeFilter{Oct,Quat,Exp,Color}`
// followed by the matching `meshopt_decodeFilter*`.

import {applyTextureTransform, readAccessorAsFloat32} from '../src/accessor';
import {
  applyMeshoptFilter,
  decodeMeshoptBuffer,
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
  type MeshoptFilter,
  type MeshoptMode,
} from '../src/plugins/meshopt';
import golden from './testdata/meshopt_golden.json';

let passed = 0;
let failed = 0;
function assert(condition: boolean, testName: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${testName}`);
  } else {
    failed++;
    console.error(`  FAIL: ${testName}`);
  }
}

const g = golden as Record<string, string>;
function hex(name: string): Uint8Array {
  const s = g[name];
  if (!s) throw new Error(`missing golden vector ${name}`);
  return new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

console.log('meshopt spec conformance');

// 1. Vertex codec (ATTRIBUTES): v0 + v1, multi-block, all bit widths/channels.
const vertexCases: Array<[string, number, number]> = [
  ['vb_37x12_v0', 37, 12],
  ['vb_37x12_v1', 37, 12],
  ['vb_300x16_v0', 300, 16],
  ['vb_300x16_v1', 300, 16],
  ['vb_5x4_v0', 5, 4],
  ['vb_300x8_v1', 300, 8],
];
for (const [name, count, stride] of vertexCases) {
  const raw = hex(`${name}_raw`);
  const enc = hex(`${name}_enc`);
  assert(
    bytesEqual(decodeMeshoptBuffer(enc, count, stride, 'ATTRIBUTES'), raw),
    `${name}: decodes meshoptimizer output byte-for-byte`,
  );
  assert(
    throws(() =>
      decodeMeshoptBuffer(
        enc.subarray(0, enc.length - 1),
        count,
        stride,
        'ATTRIBUTES',
      ),
    ),
    `${name}: truncated stream throws`,
  );
  const padded = new Uint8Array(enc.length + 1);
  padded.set(enc);
  assert(
    throws(() => decodeMeshoptBuffer(padded, count, stride, 'ATTRIBUTES')),
    `${name}: trailing data throws`,
  );
  const ours = encodeMeshoptBuffer(raw, count, stride, 'ATTRIBUTES');
  assert(
    ours[0] === 0xa0 &&
      bytesEqual(decodeMeshoptBuffer(ours, count, stride, 'ATTRIBUTES'), raw),
    `${name}: encodeMeshoptBuffer emits a v0 stream that round-trips`,
  );
}
{
  const enc = hex('vb_37x12_v0_enc').slice();
  enc[0] = 0xa2;
  assert(
    throws(() => decodeMeshoptBuffer(enc, 37, 12, 'ATTRIBUTES')),
    'ATTRIBUTES: unknown codec version (0xa2) throws',
  );
  assert(
    throws(() =>
      decodeMeshoptBuffer(hex('vb_37x12_v0_enc'), 37, 10, 'ATTRIBUTES'),
    ),
    'ATTRIBUTES: byteStride not a multiple of 4 throws',
  );
}

// 2. Index codec (TRIANGLES) v0 + v1 and index sequence codec (INDICES).
{
  const want = hex('ib_decoded_u32');
  const count = want.length / 4;
  for (const v of ['ib_v0_enc', 'ib_v1_enc']) {
    assert(
      bytesEqual(decodeMeshoptBuffer(hex(v), count, 4, 'TRIANGLES'), want),
      `${v}: decodes meshopt_encodeIndexBuffer output (u32)`,
    );
  }
  const u16 = new Uint16Array(
    decodeMeshoptBuffer(hex('ib_v1_enc'), count, 2, 'TRIANGLES').buffer,
  );
  const u32 = new Uint32Array(want.buffer);
  assert(
    u16.every((v, i) => v === (u32[i]! & 0xffff)),
    'TRIANGLES: 16-bit output truncates like the reference',
  );
  assert(
    throws(() =>
      decodeMeshoptBuffer(
        hex('ib_v1_enc').subarray(0, 40),
        count,
        4,
        'TRIANGLES',
      ),
    ),
    'TRIANGLES: truncated stream throws',
  );
  const legacy = hex('ib_v1_enc').slice();
  legacy[0] = 0xb0;
  assert(
    throws(() => decodeMeshoptBuffer(legacy, count, 4, 'TRIANGLES')),
    'TRIANGLES: non-spec 0xb0 header throws',
  );
  const ours = encodeMeshoptBuffer(want, count, 4, 'TRIANGLES');
  assert(
    (ours[0]! & 0xf0) === 0xe0 &&
      bytesEqual(decodeMeshoptBuffer(ours, count, 4, 'TRIANGLES'), want),
    'TRIANGLES: encodeMeshoptBuffer emits a spec stream that round-trips',
  );

  const seq = hex('seq_u32');
  const n = seq.length / 4;
  assert(
    bytesEqual(decodeMeshoptBuffer(hex('seq_enc'), n, 4, 'INDICES'), seq),
    'INDICES: decodes meshopt_encodeIndexSequence output (two baselines)',
  );
  const seqOurs = encodeMeshoptBuffer(seq, n, 4, 'INDICES');
  assert(
    (seqOurs[0]! & 0xf0) === 0xd0 &&
      bytesEqual(decodeMeshoptBuffer(seqOurs, n, 4, 'INDICES'), seq),
    'INDICES: encodeMeshoptBuffer emits a spec stream that round-trips',
  );
  assert(
    throws(() => decodeMeshoptBuffer(hex('seq_enc'), n + 1, 4, 'INDICES')),
    'INDICES: count larger than the stream throws',
  );
  assert(
    throws(() =>
      decodeMeshoptBuffer(hex('seq_enc'), n, 4, 'INDICES', 'OCTAHEDRAL'),
    ),
    'INDICES: filters are rejected outside ATTRIBUTES',
  );
}

// 3. Filters: identical to the reference scalar decoders.
const filterCases: Array<[string, number, number, MeshoptFilter]> = [
  ['oct8', 8, 4, 'OCTAHEDRAL'],
  ['oct16', 8, 8, 'OCTAHEDRAL'],
  ['quat', 6, 8, 'QUATERNION'],
  ['exp', 4, 12, 'EXPONENTIAL'],
  ['color8', 5, 4, 'COLOR'],
  ['color16', 5, 8, 'COLOR'],
];
for (const [name, count, stride, filter] of filterCases) {
  const buf = hex(`${name}_enc`);
  applyMeshoptFilter(buf, count, stride, filter);
  assert(
    bytesEqual(buf, hex(`${name}_dec`)),
    `filter ${filter} (${name}) matches meshopt_decodeFilter*`,
  );
}

// 4. decodeMeshoptGLB: gltfpack layout (compressed data in buffer 0, the
// uncompressed view pointing at a data-less fallback buffer 1), KHR variant.
function gltfpackLike(
  extName: string,
  enc: Uint8Array,
  count: number,
  stride: number,
  mode: MeshoptMode,
  filter?: MeshoptFilter,
) {
  const bin = new Uint8Array(8 + enc.length);
  bin.set(enc, 8);
  const gltf = {
    buffers: [
      {byteLength: bin.length},
      {byteLength: count * stride, extensions: {[extName]: {fallback: true}}},
    ],
    bufferViews: [
      {
        buffer: 1,
        byteOffset: 0,
        byteLength: count * stride,
        byteStride: mode === 'ATTRIBUTES' ? stride : undefined,
        extensions: {
          [extName]: {
            buffer: 0,
            byteOffset: 8,
            byteLength: enc.length,
            byteStride: stride,
            count,
            mode,
            ...(filter ? {filter} : {}),
          },
        },
      } as Record<string, unknown>,
    ],
  };
  return {gltf, bin: bin.buffer} as unknown as Parameters<
    typeof decodeMeshoptGLB
  >[0] & {gltf: typeof gltf; bin: ArrayBuffer};
}
{
  const raw = hex('vb_37x12_v1_raw');
  const glb = gltfpackLike(
    'EXT_meshopt_compression',
    hex('vb_37x12_v1_enc'),
    37,
    12,
    'ATTRIBUTES',
  );
  decodeMeshoptGLB(glb);
  const bv = glb.gltf.bufferViews[0] as {
    buffer: number;
    byteOffset: number;
    byteLength: number;
    extensions: Record<string, unknown>;
  };
  assert(
    bv.buffer === 0 &&
      bv.byteOffset % 4 === 0 &&
      bytesEqual(new Uint8Array(glb.bin, bv.byteOffset, bv.byteLength), raw) &&
      !('EXT_meshopt_compression' in bv.extensions),
    'decodeMeshoptGLB repoints a fallback-buffer view at decoded bytes in buffer 0',
  );
  const binBefore = glb.bin;
  decodeMeshoptGLB(glb);
  assert(glb.bin === binBefore, 'decodeMeshoptGLB is idempotent');

  // color8_enc is filter-encoded data, so wrap it in a vertex stream first.
  const khrVb = encodeMeshoptBuffer(hex('color8_enc'), 5, 4, 'ATTRIBUTES');
  const khrGlb = gltfpackLike(
    'KHR_meshopt_compression',
    khrVb,
    5,
    4,
    'ATTRIBUTES',
    'COLOR',
  );
  decodeMeshoptGLB(khrGlb);
  const kbv = khrGlb.gltf.bufferViews[0] as {
    byteOffset: number;
    byteLength: number;
  };
  assert(
    bytesEqual(
      new Uint8Array(khrGlb.bin, kbv.byteOffset, kbv.byteLength),
      hex('color8_dec'),
    ),
    'decodeMeshoptGLB decodes KHR_meshopt_compression with the COLOR filter',
  );
  const extColor = gltfpackLike(
    'EXT_meshopt_compression',
    khrVb,
    5,
    4,
    'ATTRIBUTES',
    'COLOR',
  );
  assert(
    throws(() => decodeMeshoptGLB(extColor)),
    'decodeMeshoptGLB rejects the COLOR filter under EXT_meshopt_compression',
  );
}

// 5. KHR_mesh_quantization accessor reads and KHR_texture_transform baking.
{
  const bin = new ArrayBuffer(64);
  const dv = new DataView(bin);
  // Two VEC3 normalized SHORT normals with byteStride 8 (padding per glTF).
  dv.setInt16(0, 32767, true);
  dv.setInt16(2, -32768, true);
  dv.setInt16(4, 0, true);
  dv.setInt16(8, 0, true);
  dv.setInt16(10, 16384, true);
  dv.setInt16(12, -16384, true);
  // Two VEC2 normalized UNSIGNED_SHORT UVs at offset 16.
  dv.setUint16(16, 65535, true);
  dv.setUint16(18, 0, true);
  dv.setUint16(20, 32768, true);
  dv.setUint16(22, 65535, true);
  // Two VEC3 non-normalized UNSIGNED_BYTE positions at offset 24 (stride 4).
  new Uint8Array(bin, 24, 8).set([1, 2, 3, 0, 250, 0, 7, 0]);
  const gltf = {
    bufferViews: [
      {byteOffset: 0, byteStride: 8},
      {byteOffset: 16},
      {byteOffset: 24, byteStride: 4},
    ],
  };
  const n = readAccessorAsFloat32(
    gltf,
    bin,
    {bufferView: 0, componentType: 5122, normalized: true, count: 2},
    3,
  )!;
  assert(
    n[0] === 1 &&
      n[1] === -1 &&
      n[2] === 0 &&
      Math.abs(n[4]! - 16384 / 32767) < 1e-7,
    'readAccessorAsFloat32 dequantizes normalized SHORT with byteStride (clamps -32768 to -1)',
  );
  const uv = readAccessorAsFloat32(
    gltf,
    bin,
    {bufferView: 1, componentType: 5123, normalized: true, count: 2},
    2,
  )!;
  assert(
    uv[0] === 1 && uv[1] === 0 && uv[3] === 1,
    'readAccessorAsFloat32 dequantizes normalized UNSIGNED_SHORT',
  );
  const p = readAccessorAsFloat32(
    gltf,
    bin,
    {bufferView: 2, componentType: 5121, count: 2},
    3,
  )!;
  assert(
    Array.from(p).join(',') === '1,2,3,250,0,7',
    'readAccessorAsFloat32 reads non-normalized UNSIGNED_BYTE as integers',
  );
  assert(
    throws(() =>
      readAccessorAsFloat32(
        gltf,
        bin,
        {bufferView: 2, componentType: 5126, count: 20},
        3,
      ),
    ),
    'readAccessorAsFloat32 throws when the accessor reads past the buffer',
  );
  const baked = Float32Array.from([0, 0, 1, 1, 0.5, 0.25]);
  applyTextureTransform(baked, {offset: [0.1, 0.2], scale: [2, 4]});
  assert(
    Math.abs(baked[0]! - 0.1) < 1e-6 &&
      Math.abs(baked[1]! - 0.2) < 1e-6 &&
      Math.abs(baked[2]! - 2.1) < 1e-6 &&
      Math.abs(baked[3]! - 4.2) < 1e-6 &&
      Math.abs(baked[4]! - 1.1) < 1e-6 &&
      Math.abs(baked[5]! - 1.2) < 1e-6,
    'applyTextureTransform bakes gltfpack-style offset/scale dequantization',
  );
}

console.log(`\nmeshopt_test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
