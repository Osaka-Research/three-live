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

import {getSharedRegistry, type ThreeLivePlugin} from '../plugin';
import type {GLBData, MeshDecoder} from '../three-view';

/** Supported `EXT_meshopt_compression` compression modes. */
export type MeshoptMode = 'ATTRIBUTES' | 'TRIANGLES' | 'INDICES';

/** Supported `EXT_meshopt_compression` post-decompression filters. */
export type MeshoptFilter =
  | 'NONE'
  | 'OCTAHEDRAL'
  | 'QUATERNION'
  | 'EXPONENTIAL'
  | 'COLOR';

/** Hard cap per decompressed bufferView (64 MiB) to prevent decompression-bomb OOMs. */
export const MAX_MESHOPT_BUFFER_BYTES = 64 * 1024 * 1024;

/** Hard cap across all decompressed meshopt bufferViews in a single GLB (128 MiB). */
export const MAX_MESHOPT_TOTAL_BYTES = 128 * 1024 * 1024;

/** Maximum element count accepted in a single meshopt bufferView. */
export const MAX_MESHOPT_COUNT = 16_777_216;

function unzigzag8(v: number): number {
  return ((v >>> 1) ^ -(v & 1)) & 0xff;
}

function unzigzag16(v: number): number {
  return ((v >>> 1) ^ -(v & 1)) & 0xffff;
}

function zigzag8(v: number): number {
  const s = (v << 24) >> 24;
  return ((s << 1) ^ (s >> 7)) & 0xff;
}

function zigzag32(v: number): number {
  return ((v << 1) ^ (v >> 31)) >>> 0;
}

function assertMeshoptFilter(filter: unknown): void {
  if (
    filter !== undefined &&
    filter !== 'NONE' &&
    filter !== 'OCTAHEDRAL' &&
    filter !== 'QUATERNION' &&
    filter !== 'EXPONENTIAL' &&
    filter !== 'COLOR'
  ) {
    throw meshoptError(`unknown filter "${String(filter)}"`);
  }
}

const f32 = Math.fround;

/** Rounds like meshoptimizer's `int(v + (v >= 0 ? 0.5f : -0.5f))`. */
function roundSigned(v: number): number {
  return Math.trunc(f32(v + (v >= 0 ? 0.5 : -0.5)));
}

/**
 * Applies a post-decompression meshopt filter (`OCTAHEDRAL`, `QUATERNION`,
 * `EXPONENTIAL`, or the `KHR_meshopt_compression` `COLOR` filter) in-place on
 * little-endian `buf`, matching the reference meshoptimizer scalar decoders
 * (including float32 rounding).
 */
export function applyMeshoptFilter(
  buf: Uint8Array,
  count: number,
  byteStride: number,
  filter: MeshoptFilter = 'NONE',
): void {
  assertMeshoptFilter(filter);
  if (!filter || filter === 'NONE' || count <= 0) return;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (filter === 'OCTAHEDRAL') {
    if (byteStride !== 4 && byteStride !== 8) {
      throw meshoptError(
        `OCTAHEDRAL filter requires byteStride 4 or 8 (got ${byteStride})`,
      );
    }
    const wide = byteStride === 8;
    const max = wide ? 32767 : 127;
    const get = (o: number) =>
      wide ? view.getInt16(o, true) : view.getInt8(o);
    const set = (o: number, v: number) =>
      wide ? view.setInt16(o, v, true) : view.setInt8(o, (v << 24) >> 24);
    const cs = wide ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const base = i * byteStride;
      let x = get(base);
      let y = get(base + cs);
      const z = f32(get(base + 2 * cs) - Math.abs(x) - Math.abs(y));
      // Fix up octahedral coordinates for z < 0.
      const t = z >= 0 ? 0 : z;
      x = f32(x + (x >= 0 ? t : -t));
      y = f32(y + (y >= 0 ? t : -t));
      const l = f32(Math.sqrt(f32(f32(f32(x * x) + f32(y * y)) + f32(z * z))));
      if (l === 0) {
        // Degenerate (never emitted by encoders): decode to +Z instead of NaN.
        set(base, 0);
        set(base + cs, 0);
        set(base + 2 * cs, max);
        continue;
      }
      const s = f32(max / l);
      set(base, roundSigned(f32(x * s)));
      set(base + cs, roundSigned(f32(y * s)));
      set(base + 2 * cs, roundSigned(f32(z * s)));
    }
    return;
  }

  if (filter === 'QUATERNION') {
    if (byteStride !== 8) {
      throw meshoptError(
        `QUATERNION filter requires byteStride 8 (got ${byteStride})`,
      );
    }
    const scale = f32(32767 / f32(Math.SQRT2));
    for (let i = 0; i < count; i++) {
      const base = i * 8;
      const w3 = view.getInt16(base + 6, true);
      // Recover the scale from the low bits of the 4th component.
      const s = w3 | 3;
      const x = view.getInt16(base, true);
      const y = view.getInt16(base + 2, true);
      const z = view.getInt16(base + 4, true);
      const ws = f32(s * s);
      const ww = f32(
        f32(f32(f32(ws * 2) - f32(x * x)) - f32(y * y)) - f32(z * z),
      );
      const w = f32(Math.sqrt(ww >= 0 ? ww : 0));
      const ss = f32(scale / s);
      const qc = w3 & 3;
      const out = [0, 0, 0, 0];
      out[(qc + 1) & 3] = roundSigned(f32(x * ss));
      out[(qc + 2) & 3] = roundSigned(f32(y * ss));
      out[(qc + 3) & 3] = roundSigned(f32(z * ss));
      out[qc] = Math.trunc(f32(f32(w * ss) + 0.5));
      for (let c = 0; c < 4; c++) {
        view.setInt16(base + c * 2, (out[c]! << 16) >> 16, true);
      }
    }
    return;
  }

  if (filter === 'EXPONENTIAL') {
    if (byteStride < 4 || byteStride % 4 !== 0) {
      throw meshoptError(
        `EXPONENTIAL filter requires byteStride multiple of 4 (got ${byteStride})`,
      );
    }
    const words = (count * byteStride) >>> 2;
    for (let i = 0; i < words; i++) {
      const base = i * 4;
      const v = view.getUint32(base, true);
      const m = (v << 8) >> 8;
      const e = v >> 24;
      // Optimized ldexp(float(m), e) exactly as the reference: build 2^e from
      // its float bits, then multiply in float32.
      view.setUint32(base, ((e + 127) << 23) >>> 0, true);
      const scale = view.getFloat32(base, true);
      view.setFloat32(base, f32(scale * m), true);
    }
    return;
  }

  // COLOR (KHR_meshopt_compression): YCoCg + variable-precision alpha.
  if (byteStride !== 4 && byteStride !== 8) {
    throw new Error(
      `KHR_meshopt_compression: COLOR filter requires byteStride 4 or 8 (got ${byteStride})`,
    );
  }
  const wide = byteStride === 8;
  const max = wide ? 65535 : 255;
  const getU = (o: number) =>
    wide ? view.getUint16(o, true) : view.getUint8(o);
  const getS = (o: number) => (wide ? view.getInt16(o, true) : view.getInt8(o));
  const setU = (o: number, v: number) =>
    wide ? view.setUint16(o, v & 0xffff, true) : view.setUint8(o, v & 0xff);
  const cs = wide ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const base = i * byteStride;
    let as = getU(base + 3 * cs);
    as |= as >> 1;
    as |= as >> 2;
    as |= as >> 4;
    as |= as >> 8;
    const y = getU(base);
    const co = getS(base + cs);
    const cg = getS(base + 2 * cs);
    const r = y + co - cg;
    const g = y + cg;
    const b = y - co - cg;
    let a = getU(base + 3 * cs);
    a = ((a << 1) & as) | (a & 1);
    // `as` is never 0 for encoder output; guard so a malformed alpha decodes to 0.
    const ss = as === 0 ? 0 : f32(max / as);
    setU(base, Math.trunc(f32(f32(r * ss) + 0.5)));
    setU(base + cs, Math.trunc(f32(f32(g * ss) + 0.5)));
    setU(base + 2 * cs, Math.trunc(f32(f32(b * ss) + 0.5)));
    setU(base + 3 * cs, Math.trunc(f32(f32(a * ss) + 0.5)));
  }
}

// --- Vertex codec (meshoptimizer vertexcodec.cpp, versions 0 and 1) ---------

const VERTEX_HEADER = 0xa0;
const BYTE_GROUP_SIZE = 16;
const BYTE_GROUP_DECODE_LIMIT = 24;
const TAIL_MIN_SIZE_V0 = 32;
const TAIL_MIN_SIZE_V1 = 24;
const BITS_V0 = [0, 2, 4, 8];
const BITS_V1 = [0, 1, 2, 4, 8];

function getVertexBlockSize(byteStride: number): number {
  // The block size is implicitly part of the format.
  const result = Math.floor(8192 / byteStride) & ~(BYTE_GROUP_SIZE - 1);
  return result < 256 ? result : 256;
}

function meshoptError(msg: string): Error {
  return new Error(`EXT_meshopt_compression: ${msg}`);
}

function decodeBytesGroup(
  src: Uint8Array,
  pos: number,
  out: Uint8Array,
  outPos: number,
  bits: number,
): number {
  if (bits === 0) {
    out.fill(0, outPos, outPos + BYTE_GROUP_SIZE);
    return pos;
  }
  if (bits === 8) {
    out.set(src.subarray(pos, pos + BYTE_GROUP_SIZE), outPos);
    return pos + BYTE_GROUP_SIZE;
  }
  // Packed values (high bits first; 1-bit groups are low bits first), where an
  // all-ones value means "read the real byte from the trailing outlier bytes".
  const sentinel = (1 << bits) - 1;
  const perByte = 8 / bits;
  let varPos = pos + (BYTE_GROUP_SIZE * bits) / 8;
  for (let i = 0; i < BYTE_GROUP_SIZE; i++) {
    const byte = src[pos + Math.floor(i / perByte)]!;
    const slot = i % perByte;
    const enc =
      bits === 1
        ? (byte >> slot) & 1
        : (byte >> (8 - bits - slot * bits)) & sentinel;
    out[outPos + i] = enc === sentinel ? src[varPos++]! : enc;
  }
  return varPos;
}

function decodeBytes(
  src: Uint8Array,
  pos: number,
  end: number,
  out: Uint8Array,
  outPos: number,
  size: number,
  bits: readonly number[],
  bitsOffset: number,
): number {
  const groups = size / BYTE_GROUP_SIZE;
  const headerSize = (groups + 3) >> 2;
  if (end - pos < headerSize) throw meshoptError('truncated ATTRIBUTES stream');
  const header = pos;
  pos += headerSize;
  for (let g = 0; g < groups; g++) {
    if (end - pos < BYTE_GROUP_DECODE_LIMIT) {
      throw meshoptError('truncated ATTRIBUTES stream');
    }
    const bitsk = (src[header + (g >> 2)]! >> ((g & 3) * 2)) & 3;
    pos = decodeBytesGroup(
      src,
      pos,
      out,
      outPos + g * BYTE_GROUP_SIZE,
      bits[bitsOffset + bitsk]!,
    );
  }
  return pos;
}

function decodeVertexBuffer(
  src: Uint8Array,
  count: number,
  byteStride: number,
  out: Uint8Array,
): void {
  if (byteStride % 4 !== 0 || byteStride > 256) {
    throw meshoptError(
      `ATTRIBUTES byteStride must be a multiple of 4 and <= 256 (got ${byteStride})`,
    );
  }
  const end = src.byteLength;
  if (end < 1) throw meshoptError('truncated ATTRIBUTES stream');
  const header = src[0]!;
  if ((header & 0xf0) !== VERTEX_HEADER) {
    throw meshoptError(
      `unsupported ATTRIBUTES header 0x${header.toString(16)}`,
    );
  }
  const version = header & 0x0f;
  if (version > 1) {
    throw meshoptError(`unsupported ATTRIBUTES codec version ${version}`);
  }
  const tailSize = byteStride + (version === 0 ? 0 : byteStride / 4);
  const tailMin = version === 0 ? TAIL_MIN_SIZE_V0 : TAIL_MIN_SIZE_V1;
  const tailPad = tailSize < tailMin ? tailMin : tailSize;
  if (end - 1 < tailPad) throw meshoptError('truncated ATTRIBUTES stream');

  const tail = end - tailSize;
  const last = src.slice(tail, tail + byteStride);
  const channelsPos = tail + byteStride;
  const blockSize = getVertexBlockSize(byteStride);
  const scratch = new Uint8Array(256 * 4);
  let pos = 1;

  for (let vertexOffset = 0; vertexOffset < count; ) {
    const vc = Math.min(blockSize, count - vertexOffset);
    const aligned = (vc + BYTE_GROUP_SIZE - 1) & ~(BYTE_GROUP_SIZE - 1);
    const controlSize = version === 0 ? 0 : byteStride / 4;
    if (end - pos < controlSize)
      throw meshoptError('truncated ATTRIBUTES stream');
    const controlPos = pos;
    pos += controlSize;

    for (let k = 0; k < byteStride; k += 4) {
      const ctrlByte = version === 0 ? 0 : src[controlPos + k / 4]!;
      for (let j = 0; j < 4; j++) {
        const ctrl = (ctrlByte >> (j * 2)) & 3;
        if (ctrl === 3) {
          // Literal encoding.
          if (end - pos < vc) throw meshoptError('truncated ATTRIBUTES stream');
          scratch.set(src.subarray(pos, pos + vc), j * vc);
          pos += vc;
        } else if (ctrl === 2) {
          scratch.fill(0, j * vc, j * vc + vc);
        } else {
          pos =
            version === 0
              ? decodeBytes(src, pos, end, scratch, j * vc, aligned, BITS_V0, 0)
              : decodeBytes(
                  src,
                  pos,
                  end,
                  scratch,
                  j * vc,
                  aligned,
                  BITS_V1,
                  ctrl,
                );
        }
      }

      const channel = version === 0 ? 0 : src[channelsPos + k / 4]!;
      const type = channel & 3;
      if (type === 0) {
        for (let j = 0; j < 4; j++) {
          let p = last[k + j]!;
          for (let i = 0; i < vc; i++) {
            p = (unzigzag8(scratch[j * vc + i]!) + p) & 0xff;
            out[(vertexOffset + i) * byteStride + k + j] = p;
          }
        }
      } else if (type === 1) {
        for (let h = 0; h < 4; h += 2) {
          let p = last[k + h]! | (last[k + h + 1]! << 8);
          const b0 = h * vc;
          for (let i = 0; i < vc; i++) {
            const v = scratch[b0 + i]! | (scratch[b0 + vc + i]! << 8);
            p = (unzigzag16(v) + p) & 0xffff;
            const o = (vertexOffset + i) * byteStride + k + h;
            out[o] = p & 0xff;
            out[o + 1] = p >> 8;
          }
        }
      } else if (type === 2) {
        const rot = (32 - (channel >> 4)) & 31;
        let p =
          (last[k]! |
            (last[k + 1]! << 8) |
            (last[k + 2]! << 16) |
            (last[k + 3]! << 24)) >>>
          0;
        for (let i = 0; i < vc; i++) {
          let v =
            (scratch[i]! |
              (scratch[vc + i]! << 8) |
              (scratch[2 * vc + i]! << 16) |
              (scratch[3 * vc + i]! << 24)) >>>
            0;
          v = (((v << rot) | (v >>> ((32 - rot) & 31))) ^ p) >>> 0;
          p = v;
          const o = (vertexOffset + i) * byteStride + k;
          out[o] = v & 0xff;
          out[o + 1] = (v >>> 8) & 0xff;
          out[o + 2] = (v >>> 16) & 0xff;
          out[o + 3] = v >>> 24;
        }
      } else {
        throw meshoptError(`invalid ATTRIBUTES channel ${channel}`);
      }
    }

    last.set(
      out.subarray(
        (vertexOffset + vc - 1) * byteStride,
        (vertexOffset + vc) * byteStride,
      ),
    );
    vertexOffset += vc;
  }

  if (end - pos !== tailPad) throw meshoptError('ATTRIBUTES trailing data');
}

// --- Index codecs (meshoptimizer indexcodec.cpp) ------------------------------

const INDEX_HEADER = 0xe0;
const SEQUENCE_HEADER = 0xd0;

/** Reads a meshopt 7-bit varint (at most 5 bytes, always terminates). */
function readVByte(src: Uint8Array, state: {pos: number}): number {
  const lead = src[state.pos++] ?? 0;
  if (lead < 128) return lead;
  let result = lead & 127;
  let shift = 7;
  for (let i = 0; i < 4; i++) {
    const group = src[state.pos++] ?? 0;
    result = (result | ((group & 127) << shift)) >>> 0;
    shift += 7;
    if (group < 128) break;
  }
  return result >>> 0;
}

function decodeIndexDelta(
  src: Uint8Array,
  state: {pos: number},
  last: number,
): number {
  const v = readVByte(src, state);
  const d = (v >>> 1) ^ -(v & 1);
  return (last + d) >>> 0;
}

function decodeIndexBuffer(
  src: Uint8Array,
  count: number,
  write: (i: number, v: number) => void,
): void {
  if (count % 3 !== 0) {
    throw meshoptError(`TRIANGLES count must be divisible by 3 (got ${count})`);
  }
  const triCount = count / 3;
  if (src.byteLength < 1 + triCount + 16) {
    throw meshoptError('truncated TRIANGLES stream');
  }
  const header = src[0]!;
  if ((header & 0xf0) !== INDEX_HEADER) {
    throw meshoptError(`unsupported TRIANGLES header 0x${header.toString(16)}`);
  }
  const version = header & 0x0f;
  if (version > 1) {
    throw meshoptError(`unsupported TRIANGLES codec version ${version}`);
  }

  const edge0 = new Uint32Array(16).fill(0xffffffff);
  const edge1 = new Uint32Array(16).fill(0xffffffff);
  const vfifo = new Uint32Array(16).fill(0xffffffff);
  let edgeOff = 0;
  let vertOff = 0;
  const pushEdge = (a: number, b: number) => {
    edge0[edgeOff] = a;
    edge1[edgeOff] = b;
    edgeOff = (edgeOff + 1) & 15;
  };
  const pushVert = (v: number, cond = 1) => {
    vfifo[vertOff] = v;
    vertOff = (vertOff + cond) & 15;
  };

  let next = 0;
  let last = 0;
  const fecmax = version >= 1 ? 13 : 15;
  const codeEnd = 1 + triCount;
  const dataSafeEnd = src.byteLength - 16;
  const codeaux = dataSafeEnd;
  const state = {pos: codeEnd};
  let out = 0;
  const tri = (a: number, b: number, c: number) => {
    write(out++, a);
    write(out++, b);
    write(out++, c);
  };

  for (let code = 1; code < codeEnd; code++) {
    const codetri = src[code]!;
    if (codetri < 0xf0) {
      const fe = codetri >> 4;
      const ei = (edgeOff - 1 - fe) & 15;
      const a = edge0[ei]!;
      const b = edge1[ei]!;
      let c = 0;
      const fec = codetri & 15;
      if (fec < fecmax) {
        const cf = vfifo[(vertOff - 1 - fec) & 15]!;
        c = fec === 0 ? next : cf;
        const fec0 = fec === 0 ? 1 : 0;
        next = (next + fec0) >>> 0;
        pushVert(c, fec0);
      } else {
        if (state.pos > dataSafeEnd)
          throw meshoptError('truncated TRIANGLES stream');
        // fec * 2 - 27 decodes 13, 14 into -1, 1 (version 1).
        c =
          fec !== 15
            ? (last + (fec * 2 - 27)) >>> 0
            : decodeIndexDelta(src, state, last);
        last = c;
        pushVert(c);
      }
      pushEdge(c, b);
      pushEdge(a, c);
      tri(a, b, c);
    } else if (codetri < 0xfe) {
      const aux = src[codeaux + (codetri & 15)]!;
      const feb = aux >> 4;
      const fec = aux & 15;
      const a = next;
      next = (next + 1) >>> 0;
      const bf = vfifo[(vertOff - feb) & 15]!;
      const b = feb === 0 ? next : bf;
      const feb0 = feb === 0 ? 1 : 0;
      next = (next + feb0) >>> 0;
      const cf = vfifo[(vertOff - fec) & 15]!;
      const c = fec === 0 ? next : cf;
      const fec0 = fec === 0 ? 1 : 0;
      next = (next + fec0) >>> 0;
      tri(a, b, c);
      pushVert(a);
      pushVert(b, feb0);
      pushVert(c, fec0);
      pushEdge(b, a);
      pushEdge(c, b);
      pushEdge(a, c);
    } else {
      if (state.pos > dataSafeEnd)
        throw meshoptError('truncated TRIANGLES stream');
      const aux = src[state.pos++]!;
      const fea = codetri === 0xfe ? 0 : 15;
      const feb = aux >> 4;
      const fec = aux & 15;
      if (aux === 0) next = 0;
      let a = 0;
      if (fea === 0) {
        a = next;
        next = (next + 1) >>> 0;
      }
      let b: number;
      if (feb === 0) {
        b = next;
        next = (next + 1) >>> 0;
      } else {
        b = vfifo[(vertOff - feb) & 15]!;
      }
      let c: number;
      if (fec === 0) {
        c = next;
        next = (next + 1) >>> 0;
      } else {
        c = vfifo[(vertOff - fec) & 15]!;
      }
      if (fea === 15) last = a = decodeIndexDelta(src, state, last);
      if (feb === 15) last = b = decodeIndexDelta(src, state, last);
      if (fec === 15) last = c = decodeIndexDelta(src, state, last);
      tri(a, b, c);
      pushVert(a);
      pushVert(b, feb === 0 || feb === 15 ? 1 : 0);
      pushVert(c, fec === 0 || fec === 15 ? 1 : 0);
      pushEdge(b, a);
      pushEdge(c, b);
      pushEdge(a, c);
    }
  }

  if (state.pos !== dataSafeEnd) throw meshoptError('TRIANGLES trailing data');
}

function decodeIndexSequence(
  src: Uint8Array,
  count: number,
  write: (i: number, v: number) => void,
): void {
  if (src.byteLength < 1 + count + 4) {
    throw meshoptError('truncated INDICES stream');
  }
  const header = src[0]!;
  if ((header & 0xf0) !== SEQUENCE_HEADER) {
    throw meshoptError(`unsupported INDICES header 0x${header.toString(16)}`);
  }
  const version = header & 0x0f;
  if (version > 1) {
    throw meshoptError(`unsupported INDICES codec version ${version}`);
  }
  const dataSafeEnd = src.byteLength - 4;
  const last = [0, 0];
  const state = {pos: 1};
  for (let i = 0; i < count; i++) {
    if (state.pos >= dataSafeEnd)
      throw meshoptError('truncated INDICES stream');
    let v = readVByte(src, state);
    const current = v & 1;
    v >>>= 1;
    const d = (v >>> 1) ^ -(v & 1);
    const index = (last[current]! + d) >>> 0;
    last[current] = index;
    write(i, index);
  }
  if (state.pos !== dataSafeEnd) throw meshoptError('INDICES trailing data');
}

/**
 * Decodes an `EXT_meshopt_compression` / `KHR_meshopt_compression` byte
 * stream (`ATTRIBUTES` vertex codec v0/v1, `TRIANGLES` index codec, or
 * `INDICES` index sequence codec) exactly as the reference meshoptimizer
 * decoder does, then applies the optional filter. Throws on malformed input.
 */
export function decodeMeshoptBuffer(
  src: Uint8Array,
  count: number,
  byteStride: number,
  mode: MeshoptMode,
  filter: MeshoptFilter = 'NONE',
): Uint8Array {
  assertMeshoptFilter(filter);
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > MAX_MESHOPT_COUNT ||
    !Number.isInteger(byteStride) ||
    byteStride <= 0 ||
    byteStride > 256
  ) {
    throw meshoptError(
      `invalid count (${count}) or byteStride (${byteStride})`,
    );
  }
  const totalBytes = count * byteStride;
  if (totalBytes > MAX_MESHOPT_BUFFER_BYTES) {
    throw meshoptError(
      `decompressed size (${totalBytes}) exceeds MAX_MESHOPT_BUFFER_BYTES (${MAX_MESHOPT_BUFFER_BYTES})`,
    );
  }
  if (count === 0) return new Uint8Array(0);
  const out = new Uint8Array(totalBytes);

  if (mode === 'ATTRIBUTES') {
    decodeVertexBuffer(src, count, byteStride, out);
    applyMeshoptFilter(out, count, byteStride, filter);
    return out;
  }

  if (mode === 'TRIANGLES' || mode === 'INDICES') {
    if (byteStride !== 2 && byteStride !== 4) {
      throw meshoptError(
        `${mode} byteStride must be 2 or 4 (got ${byteStride})`,
      );
    }
    if (filter && filter !== 'NONE') {
      throw meshoptError(`filter ${filter} is only valid for ATTRIBUTES`);
    }
    const view = new DataView(out.buffer);
    const write =
      byteStride === 2
        ? (i: number, v: number) => view.setUint16(i * 2, v & 0xffff, true)
        : (i: number, v: number) => view.setUint32(i * 4, v >>> 0, true);
    if (mode === 'TRIANGLES') decodeIndexBuffer(src, count, write);
    else decodeIndexSequence(src, count, write);
    return out;
  }

  throw meshoptError(`unknown mode "${String(mode)}"`);
}

function pushVByte(out: number[], v: number): void {
  v >>>= 0;
  do {
    out.push((v & 127) | (v > 127 ? 128 : 0));
    v >>>= 7;
  } while (v);
}

/**
 * Encodes a raw buffer into a spec-compliant meshopt stream that any
 * `EXT_meshopt_compression` decoder (including meshoptimizer/gltfpack) can
 * read: `ATTRIBUTES` uses vertex codec v0, `TRIANGLES` the index codec v1
 * (every triangle as explicit deltas), and `INDICES` the index sequence codec.
 * The output favors simplicity over ratio; use gltfpack for production assets.
 */
export function encodeMeshoptBuffer(
  raw: Uint8Array,
  count: number,
  byteStride: number,
  mode: MeshoptMode,
): Uint8Array {
  const totalBytes = count * byteStride;
  if (raw.byteLength < totalBytes) {
    throw new Error(
      `encodeMeshoptBuffer: raw buffer (${raw.byteLength}) smaller than count * byteStride (${totalBytes})`,
    );
  }

  if (mode === 'ATTRIBUTES') {
    if (byteStride % 4 !== 0 || byteStride > 256) {
      throw new Error(
        `encodeMeshoptBuffer: ATTRIBUTES byteStride must be a multiple of 4 and <= 256 (got ${byteStride})`,
      );
    }
    const out: number[] = [VERTEX_HEADER];
    const blockSize = getVertexBlockSize(byteStride);
    // The baseline (decoder `last_vertex`) is the first vertex.
    const last = new Uint8Array(byteStride);
    if (count > 0) last.set(raw.subarray(0, byteStride));
    const baseline = last.slice();
    const deltas = new Uint8Array(256);

    for (let vertexOffset = 0; vertexOffset < count; ) {
      const vc = Math.min(blockSize, count - vertexOffset);
      const aligned = (vc + 15) & ~15;
      for (let k = 0; k < byteStride; k++) {
        deltas.fill(0);
        let p = last[k]!;
        for (let i = 0; i < vc; i++) {
          const cur = raw[(vertexOffset + i) * byteStride + k]!;
          deltas[i] = zigzag8((cur - p) & 0xff);
          p = cur;
        }
        last[k] = p;
        const groups = aligned / 16;
        const headerPos = out.length;
        for (let h = 0; h < (groups + 3) >> 2; h++) out.push(0);
        for (let g = 0; g < groups; g++) {
          const grp = deltas.subarray(g * 16, g * 16 + 16);
          if (!grp.every((d) => d === 0)) {
            out[headerPos + (g >> 2)] |= 3 << ((g & 3) * 2);
            for (const d of grp) out.push(d);
          }
        }
      }
      vertexOffset += vc;
    }
    // Tail: zero padding up to 32 bytes, then the baseline vertex.
    for (let i = byteStride; i < TAIL_MIN_SIZE_V0; i++) out.push(0);
    for (let k = 0; k < byteStride; k++) out.push(baseline[k]!);
    return new Uint8Array(out);
  }

  if (byteStride !== 2 && byteStride !== 4) {
    throw new Error(
      `encodeMeshoptBuffer: ${mode} byteStride must be 2 or 4 (got ${byteStride})`,
    );
  }
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const read = (i: number) =>
    byteStride === 2
      ? view.getUint16(i * 2, true)
      : view.getUint32(i * 4, true);

  if (mode === 'INDICES') {
    const out: number[] = [SEQUENCE_HEADER | 1];
    let last = 0;
    for (let i = 0; i < count; i++) {
      const cur = read(i);
      const d = (cur - last) | 0;
      last = cur;
      // Single baseline (low bit 0), zigzag-coded delta.
      pushVByte(out, (zigzag32(d) << 1) >>> 0);
    }
    out.push(0, 0, 0, 0);
    return new Uint8Array(out);
  }

  if (mode === 'TRIANGLES') {
    if (count % 3 !== 0) {
      throw new Error(
        `encodeMeshoptBuffer: TRIANGLES count must be divisible by 3 (got ${count})`,
      );
    }
    const triCount = count / 3;
    const out: number[] = [INDEX_HEADER | 1];
    for (let t = 0; t < triCount; t++) out.push(0xff);
    let last = 0;
    for (let t = 0; t < triCount; t++) {
      // codetri 0xff + codeaux 0xff: all three indices are explicit deltas.
      out.push(0xff);
      for (let c = 0; c < 3; c++) {
        const cur = read(t * 3 + c);
        pushVByte(out, zigzag32((cur - last) | 0));
        last = cur;
      }
    }
    // 16-byte codeaux table (unused by this encoder, required by the format).
    for (let i = 0; i < 16; i++) out.push(0);
    return new Uint8Array(out);
  }

  throw new Error(`encodeMeshoptBuffer: unknown mode "${String(mode)}"`);
}

interface MeshoptGltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
  _decoded?: Uint8Array;
  extensions?: {
    EXT_meshopt_compression?: Record<string, unknown>;
    KHR_meshopt_compression?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

interface MeshoptGltfJson {
  bufferViews?: MeshoptGltfBufferView[];
  [key: string]: unknown;
}

/**
 * Decodes all `bufferViews[].extensions.EXT_meshopt_compression` (and
 * `KHR_meshopt_compression`) in `glbData` into an expanded `glbData.bin` and
 * repoints each bufferView (`buffer`, `byteOffset`, `byteLength`) at the
 * decoded bytes in place, so uncompressed fallback buffers are never read.
 * Idempotent.
 */
export function decodeMeshoptGLB(
  glbDataOrGltf: GLBData | Record<string, unknown>,
  maybeGlbData?: GLBData,
): void {
  const glbData: GLBData =
    maybeGlbData && typeof maybeGlbData === 'object'
      ? maybeGlbData
      : (glbDataOrGltf as GLBData);
  const gltf = (
    maybeGlbData && typeof maybeGlbData === 'object'
      ? glbDataOrGltf
      : glbData?.gltf
  ) as MeshoptGltfJson | undefined;
  if (!gltf || !Array.isArray(gltf.bufferViews)) return;

  const srcBin = new Uint8Array(glbData.bin);
  const decodedViews: Array<{
    index: number;
    bytes: Uint8Array;
    ext: Record<string, unknown>;
  }> = [];
  let totalDecodedBytes = 0;

  for (let i = 0; i < gltf.bufferViews.length; i++) {
    const bv = gltf.bufferViews[i];
    const khrExt = bv?.extensions?.KHR_meshopt_compression;
    const ext = khrExt ?? bv?.extensions?.EXT_meshopt_compression;
    if (!ext || typeof ext !== 'object') continue;
    const extName = khrExt
      ? 'KHR_meshopt_compression'
      : 'EXT_meshopt_compression';

    const count = Number(ext.count);
    const byteStride = Number(ext.byteStride);
    const byteOffset = Number(ext.byteOffset ?? 0);
    const byteLength = Number(ext.byteLength ?? 0);
    const mode = ((ext.mode as string) || 'ATTRIBUTES') as MeshoptMode;
    const filter = ((ext.filter as string) || 'NONE') as MeshoptFilter;
    if (filter === 'COLOR' && !khrExt) {
      throw meshoptError(
        `bufferView ${i} uses the COLOR filter, which requires KHR_meshopt_compression`,
      );
    }
    if (Number(ext.buffer ?? 0) !== 0) {
      throw new Error(
        `${extName}: bufferView ${i} references buffer ${String(ext.buffer)}; only the GLB BIN chunk (buffer 0) is supported`,
      );
    }

    if (
      !Number.isInteger(byteOffset) ||
      byteOffset < 0 ||
      !Number.isInteger(byteLength) ||
      byteLength < 0 ||
      byteOffset + byteLength > srcBin.byteLength
    ) {
      throw new Error(
        `${extName}: bufferView ${i} compressed range [${byteOffset}, ${byteOffset + byteLength}] out of bounds (${srcBin.byteLength})`,
      );
    }

    const expectedBytes = count * byteStride;
    totalDecodedBytes += expectedBytes;
    if (totalDecodedBytes > MAX_MESHOPT_TOTAL_BYTES) {
      throw meshoptError(
        `total decompressed size (${totalDecodedBytes}) exceeds MAX_MESHOPT_TOTAL_BYTES (${MAX_MESHOPT_TOTAL_BYTES})`,
      );
    }

    const compressedSlice = srcBin.subarray(
      byteOffset,
      byteOffset + byteLength,
    );
    const decoded = decodeMeshoptBuffer(
      compressedSlice,
      count,
      byteStride,
      mode,
      filter,
    );
    decodedViews.push({index: i, bytes: decoded, ext});
  }

  if (decodedViews.length === 0) return;

  const alignedSrcLen = (srcBin.byteLength + 3) & ~3;
  let extraLen = 0;
  for (const item of decodedViews) {
    extraLen += (item.bytes.byteLength + 3) & ~3;
  }

  const nextBin = new Uint8Array(alignedSrcLen + extraLen);
  nextBin.set(srcBin, 0);

  let writeOffset = alignedSrcLen;
  for (const item of decodedViews) {
    nextBin.set(item.bytes, writeOffset);
    const bv = gltf.bufferViews[item.index]!;
    bv.buffer = 0;
    bv.byteOffset = writeOffset;
    bv.byteLength = item.bytes.byteLength;
    bv._decoded = item.bytes;
    if (item.ext.mode === 'ATTRIBUTES' && bv.byteStride === undefined) {
      bv.byteStride = Number(item.ext.byteStride);
    }
    if (bv.extensions) {
      delete bv.extensions.EXT_meshopt_compression;
      delete bv.extensions.KHR_meshopt_compression;
    }
    writeOffset += (item.bytes.byteLength + 3) & ~3;
  }

  glbData.bin = nextBin.buffer;
}

/**
 * `MeshDecoder` implementation registered under `'meshopt'` in the shared
 * `<three-live>` decoder registry.
 */
export const meshoptDecoder: MeshDecoder & {
  decodeBufferViews: (gltf: unknown, glbData: GLBData) => void;
} = {
  decodeBufferViews(_gltf: unknown, glbData: GLBData): void {
    decodeMeshoptGLB(glbData);
  },
  decodePrimitive(
    _gltf: unknown,
    primitive: Record<string, unknown>,
    _bin: ArrayBuffer,
  ): void {
    // EXT_meshopt_compression lives on bufferViews, which `decodeBufferViews`
    // already decoded into the real GLBData. Re-decoding here against a
    // temporary `{gltf, bin}` would repoint bufferViews past the caller's
    // `bin`, so this only strips a stray primitive-level extension.
    const ext = primitive?.extensions as Record<string, unknown> | undefined;
    if (ext?.EXT_meshopt_compression) {
      delete ext.EXT_meshopt_compression;
    }
    if (ext?.KHR_meshopt_compression) {
      delete ext.KHR_meshopt_compression;
    }
  },
};

// Auto-register the meshopt decoder when this module is imported.
getSharedRegistry().decoders.set('meshopt', meshoptDecoder);

/**
 * `<three-live>` plugin that registers and executes `EXT_meshopt_compression`
 * bufferView decompression during `parseGLB()`.
 */
export const meshoptPlugin: ThreeLivePlugin = {
  name: 'meshopt',
  onParseGLB(glbData: GLBData) {
    getSharedRegistry().decoders.set('meshopt', meshoptDecoder);
    decodeMeshoptGLB(glbData);
  },
};
