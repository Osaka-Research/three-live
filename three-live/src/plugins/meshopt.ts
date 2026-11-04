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
  | 'EXPONENTIAL';

/** Hard cap per decompressed bufferView (64 MiB) to prevent decompression-bomb OOMs. */
export const MAX_MESHOPT_BUFFER_BYTES = 64 * 1024 * 1024;

/** Hard cap across all decompressed meshopt bufferViews in a single GLB (128 MiB). */
export const MAX_MESHOPT_TOTAL_BYTES = 128 * 1024 * 1024;

/** Maximum element count accepted in a single meshopt bufferView. */
export const MAX_MESHOPT_COUNT = 16_777_216;

function zigzag8(v: number): number {
  const s = (v << 24) >> 24;
  return ((s << 1) ^ (s >> 7)) & 0xff;
}

function unzigzag8(v: number): number {
  return ((v >>> 1) ^ -(v & 1)) & 0xff;
}

function zigzag32(v: number): number {
  return ((v << 1) ^ (v >> 31)) >>> 0;
}

function unzigzag32(v: number): number {
  return (v >>> 1) ^ -(v & 1);
}

/**
 * Applies a post-decompression `EXT_meshopt_compression` filter (`OCTAHEDRAL`,
 * `QUATERNION`, or `EXPONENTIAL`) in-place on little-endian `buf`.
 */
export function applyMeshoptFilter(
  buf: Uint8Array,
  count: number,
  byteStride: number,
  filter: MeshoptFilter = 'NONE',
): void {
  if (!filter || filter === 'NONE' || count <= 0) return;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  if (filter === 'OCTAHEDRAL') {
    if (byteStride !== 4 && byteStride !== 8) {
      throw new Error(
        `EXT_meshopt_compression: OCTAHEDRAL filter requires byteStride 4 or 8 (got ${byteStride})`,
      );
    }
    const maxInt = byteStride === 4 ? 127 : 32767;
    for (let i = 0; i < count; i++) {
      const base = i * byteStride;
      const x =
        byteStride === 4 ? view.getInt8(base) : view.getInt16(base, true);
      const y =
        byteStride === 4
          ? view.getInt8(base + 1)
          : view.getInt16(base + 2, true);
      const one =
        byteStride === 4
          ? view.getInt8(base + 2)
          : view.getInt16(base + 4, true);
      const denom = one === 0 ? 1 : one;
      let xf = x / denom;
      let yf = y / denom;
      const zf = 1.0 - Math.abs(xf) - Math.abs(yf);
      const t = Math.max(-zf, 0.0);
      xf += xf >= 0.0 ? -t : t;
      yf += yf >= 0.0 ? -t : t;
      const len = Math.hypot(xf, yf, zf) || 1.0;
      const rx = Math.max(
        -maxInt,
        Math.min(maxInt, Math.round((xf / len) * maxInt)),
      );
      const ry = Math.max(
        -maxInt,
        Math.min(maxInt, Math.round((yf / len) * maxInt)),
      );
      const rz = Math.max(
        -maxInt,
        Math.min(maxInt, Math.round((zf / len) * maxInt)),
      );
      if (byteStride === 4) {
        view.setInt8(base, rx);
        view.setInt8(base + 1, ry);
        view.setInt8(base + 2, rz);
      } else {
        view.setInt16(base, rx, true);
        view.setInt16(base + 2, ry, true);
        view.setInt16(base + 4, rz, true);
      }
    }
    return;
  }

  if (filter === 'QUATERNION') {
    if (byteStride !== 8) {
      throw new Error(
        `EXT_meshopt_compression: QUATERNION filter requires byteStride 8 (got ${byteStride})`,
      );
    }
    for (let i = 0; i < count; i++) {
      const base = i * 8;
      const q0 = view.getInt16(base, true);
      const q1 = view.getInt16(base + 2, true);
      const q2 = view.getInt16(base + 4, true);
      const inputW = view.getInt16(base + 6, true);
      const maxComp = inputW & 3;
      const one = inputW | 3;
      const sf = Math.SQRT1_2 / (one === 0 ? 1 : one);
      const x = q0 * sf;
      const y = q1 * sf;
      const z = q2 * sf;
      const w = Math.sqrt(Math.max(0.0, 1.0 - x * x - y * y - z * z));
      const len = Math.hypot(x, y, z, w) || 1.0;
      const out = [0, 0, 0, 0];
      out[(maxComp + 1) & 3] = Math.max(
        -32767,
        Math.min(32767, Math.round((x / len) * 32767)),
      );
      out[(maxComp + 2) & 3] = Math.max(
        -32767,
        Math.min(32767, Math.round((y / len) * 32767)),
      );
      out[(maxComp + 3) & 3] = Math.max(
        -32767,
        Math.min(32767, Math.round((z / len) * 32767)),
      );
      out[maxComp] = Math.max(
        -32767,
        Math.min(32767, Math.round((w / len) * 32767)),
      );
      view.setInt16(base, out[0], true);
      view.setInt16(base + 2, out[1], true);
      view.setInt16(base + 4, out[2], true);
      view.setInt16(base + 6, out[3], true);
    }
    return;
  }

  if (filter === 'EXPONENTIAL') {
    if (byteStride < 4 || byteStride % 4 !== 0) {
      throw new Error(
        `EXT_meshopt_compression: EXPONENTIAL filter requires byteStride multiple of 4 (got ${byteStride})`,
      );
    }
    const words = (count * byteStride) >>> 2;
    for (let i = 0; i < words; i++) {
      const base = i * 4;
      const v = view.getInt32(base, true);
      const exp = v >> 24;
      const mantissa = (v << 8) >> 8;
      const floatVal = Math.pow(2.0, exp) * mantissa;
      view.setFloat32(base, floatVal, true);
    }
  }
}

function getVertexBlockSize(byteStride: number): number {
  const bs = Math.floor(8192 / byteStride) & ~15;
  return bs < 32 ? 32 : bs > 256 ? 256 : bs;
}

/**
 * Decodes an `EXT_meshopt_compression` byte stream (`ATTRIBUTES`, `TRIANGLES`,
 * or `INDICES`) and applies any optional filter (`OCTAHEDRAL`, `QUATERNION`,
 * `EXPONENTIAL`).
 */
export function decodeMeshoptBuffer(
  src: Uint8Array,
  count: number,
  byteStride: number,
  mode: MeshoptMode,
  filter: MeshoptFilter = 'NONE',
): Uint8Array {
  if (
    !Number.isInteger(count) ||
    count < 0 ||
    count > MAX_MESHOPT_COUNT ||
    !Number.isInteger(byteStride) ||
    byteStride <= 0 ||
    byteStride > 256
  ) {
    throw new Error(
      `EXT_meshopt_compression: invalid count (${count}) or byteStride (${byteStride})`,
    );
  }
  const totalBytes = count * byteStride;
  if (totalBytes > MAX_MESHOPT_BUFFER_BYTES) {
    throw new Error(
      `EXT_meshopt_compression: decompressed size (${totalBytes}) exceeds MAX_MESHOPT_BUFFER_BYTES (${MAX_MESHOPT_BUFFER_BYTES})`,
    );
  }
  if (count === 0) return new Uint8Array(0);

  const out = new Uint8Array(totalBytes);
  const header = src.length > 0 ? src[0] : 0;

  if (mode === 'ATTRIBUTES') {
    if (byteStride % 4 !== 0) {
      throw new Error(
        `EXT_meshopt_compression: ATTRIBUTES byteStride must be a multiple of 4 (got ${byteStride})`,
      );
    }
    if (header !== 0xa0) {
      if (src.byteLength === totalBytes) {
        out.set(src);
        applyMeshoptFilter(out, count, byteStride, filter);
        return out;
      }
      throw new Error(
        `EXT_meshopt_compression: unsupported ATTRIBUTES header 0x${header.toString(16)}`,
      );
    }
    if (src.byteLength < 1 + byteStride) {
      throw new Error('EXT_meshopt_compression: truncated ATTRIBUTES stream');
    }
    const tailOffset = src.byteLength - byteStride;
    const last = new Uint8Array(byteStride);
    last.set(src.subarray(tailOffset, tailOffset + byteStride));

    const vertexBlockSize = getVertexBlockSize(byteStride);
    let pos = 1;
    let vertexOffset = 0;

    while (vertexOffset < count) {
      const blockCount = Math.min(count - vertexOffset, vertexBlockSize);
      const groups = (blockCount + 15) >>> 4;
      const headerBytes = (groups + 3) >>> 2;

      for (let k = 0; k < byteStride; k++) {
        if (pos + headerBytes > tailOffset) {
          throw new Error(
            'EXT_meshopt_compression: truncated ATTRIBUTES control header',
          );
        }
        const ctrlPos = pos;
        pos += headerBytes;
        let prev = last[k];

        for (let g = 0; g < groups; g++) {
          const bits = (src[ctrlPos + (g >>> 2)] >>> ((g & 3) * 2)) & 3;
          const groupStart = g * 16;
          const groupLen = Math.min(16, blockCount - groupStart);

          if (bits === 0) {
            for (let i = 0; i < groupLen; i++) {
              out[(vertexOffset + groupStart + i) * byteStride + k] = prev;
            }
          } else if (bits === 1) {
            if (pos + 4 > tailOffset) {
              throw new Error(
                'EXT_meshopt_compression: truncated ATTRIBUTES 2-bit group',
              );
            }
            for (let i = 0; i < 16; i++) {
              const b = src[pos + (i >>> 2)];
              const val = (b >>> ((i & 3) * 2)) & 3;
              prev = (prev + unzigzag8(val)) & 0xff;
              if (i < groupLen) {
                out[(vertexOffset + groupStart + i) * byteStride + k] = prev;
              }
            }
            pos += 4;
          } else if (bits === 2) {
            if (pos + 8 > tailOffset) {
              throw new Error(
                'EXT_meshopt_compression: truncated ATTRIBUTES 4-bit group',
              );
            }
            for (let i = 0; i < 16; i++) {
              const b = src[pos + (i >>> 1)];
              const val = (b >>> ((i & 1) * 4)) & 15;
              prev = (prev + unzigzag8(val)) & 0xff;
              if (i < groupLen) {
                out[(vertexOffset + groupStart + i) * byteStride + k] = prev;
              }
            }
            pos += 8;
          } else {
            if (pos + 16 > tailOffset) {
              throw new Error(
                'EXT_meshopt_compression: truncated ATTRIBUTES 8-bit group',
              );
            }
            for (let i = 0; i < 16; i++) {
              const val = src[pos + i];
              prev = (prev + unzigzag8(val)) & 0xff;
              if (i < groupLen) {
                out[(vertexOffset + groupStart + i) * byteStride + k] = prev;
              }
            }
            pos += 16;
          }
        }
        last[k] = prev;
      }
      vertexOffset += blockCount;
    }

    applyMeshoptFilter(out, count, byteStride, filter);
    return out;
  }

  if (mode === 'TRIANGLES' || mode === 'INDICES') {
    if (byteStride !== 2 && byteStride !== 4) {
      throw new Error(
        `EXT_meshopt_compression: ${mode} byteStride must be 2 or 4 (got ${byteStride})`,
      );
    }
    if (mode === 'TRIANGLES' && count % 3 !== 0) {
      throw new Error(
        `EXT_meshopt_compression: TRIANGLES count must be divisible by 3 (got ${count})`,
      );
    }
    const expectedHeader = mode === 'TRIANGLES' ? 0xb0 : 0xc0;
    if ((header & 0xf0) !== expectedHeader) {
      if (src.byteLength === totalBytes) {
        out.set(src);
        return out;
      }
      throw new Error(
        `EXT_meshopt_compression: unsupported ${mode} header 0x${header.toString(16)}`,
      );
    }

    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    let pos = 1;
    let last = 0;
    for (let i = 0; i < count; i++) {
      let v = 0;
      let shift = 0;
      while (true) {
        if (pos >= src.byteLength) {
          throw new Error(`EXT_meshopt_compression: truncated ${mode} stream`);
        }
        const b = src[pos++];
        v |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7;
        if (shift > 28) {
          throw new Error(
            `EXT_meshopt_compression: varint overflow in ${mode}`,
          );
        }
      }
      last = (last + unzigzag32(v)) >>> 0;
      if (byteStride === 2) {
        view.setUint16(i * 2, last & 0xffff, true);
      } else {
        view.setUint32(i * 4, last, true);
      }
    }
    return out;
  }

  throw new Error(`EXT_meshopt_compression: unknown mode "${String(mode)}"`);
}

/**
 * Encodes a raw buffer into an `EXT_meshopt_compression` stream (`ATTRIBUTES`,
 * `TRIANGLES`, or `INDICES`).
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
  if (count === 0) return new Uint8Array([mode === 'ATTRIBUTES' ? 0xa0 : 0xb0]);

  if (mode === 'ATTRIBUTES') {
    const vertexBlockSize = getVertexBlockSize(byteStride);
    const chunks: number[] = [0xa0];
    const last = new Uint8Array(byteStride);
    let vertexOffset = 0;

    while (vertexOffset < count) {
      const blockCount = Math.min(count - vertexOffset, vertexBlockSize);
      const groups = (blockCount + 15) >>> 4;
      const headerBytes = (groups + 3) >>> 2;

      for (let k = 0; k < byteStride; k++) {
        const ctrl = new Uint8Array(headerBytes);
        const dataBytes: number[] = [];
        let prev = last[k];

        for (let g = 0; g < groups; g++) {
          const groupStart = g * 16;
          const groupLen = Math.min(16, blockCount - groupStart);
          const deltas = new Uint8Array(16);
          let maxDelta = 0;

          for (let i = 0; i < 16; i++) {
            if (i < groupLen) {
              const cur =
                raw[(vertexOffset + groupStart + i) * byteStride + k]!;
              const d = ((cur - prev) << 24) >> 24;
              const zz = zigzag8(d);
              deltas[i] = zz;
              if (zz > maxDelta) maxDelta = zz;
              prev = cur;
            } else {
              deltas[i] = 0;
            }
          }

          let bits = 0;
          if (maxDelta === 0) {
            bits = 0;
          } else if (maxDelta <= 3) {
            bits = 1;
            for (let i = 0; i < 16; i += 4) {
              dataBytes.push(
                (deltas[i]! & 3) |
                  ((deltas[i + 1]! & 3) << 2) |
                  ((deltas[i + 2]! & 3) << 4) |
                  ((deltas[i + 3]! & 3) << 6),
              );
            }
          } else if (maxDelta <= 15) {
            bits = 2;
            for (let i = 0; i < 16; i += 2) {
              dataBytes.push((deltas[i]! & 15) | ((deltas[i + 1]! & 15) << 4));
            }
          } else {
            bits = 3;
            for (let i = 0; i < 16; i++) {
              dataBytes.push(deltas[i]!);
            }
          }
          ctrl[g >>> 2] |= bits << ((g & 3) * 2);
        }

        for (let i = 0; i < ctrl.length; i++) chunks.push(ctrl[i]!);
        for (let i = 0; i < dataBytes.length; i++) chunks.push(dataBytes[i]!);
        last[k] = prev;
      }
      vertexOffset += blockCount;
    }

    // Append initial baseline (zeros) as the tail block
    for (let k = 0; k < byteStride; k++) chunks.push(0);
    return new Uint8Array(chunks);
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const out: number[] = [mode === 'TRIANGLES' ? 0xb0 : 0xc0];
  let last = 0;
  for (let i = 0; i < count; i++) {
    const cur =
      byteStride === 2
        ? view.getUint16(i * 2, true)
        : view.getUint32(i * 4, true);
    const delta = (cur - last) | 0;
    last = cur;
    let zz = zigzag32(delta);
    while (zz >= 0x80) {
      out.push((zz & 0x7f) | 0x80);
      zz >>>= 7;
    }
    out.push(zz & 0x7f);
  }
  return new Uint8Array(out);
}

interface MeshoptGltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
  _decoded?: Uint8Array;
  extensions?: {
    EXT_meshopt_compression?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

interface MeshoptGltfJson {
  bufferViews?: MeshoptGltfBufferView[];
  [key: string]: unknown;
}

/**
 * Decodes all `bufferViews[].extensions.EXT_meshopt_compression` in `glbData`
 * into an expanded `glbData.bin` and updates each bufferView's `byteOffset`
 * and `byteLength` in place. Idempotent.
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
    const ext = bv?.extensions?.EXT_meshopt_compression;
    if (!ext || typeof ext !== 'object') continue;

    const count = Number(ext.count);
    const byteStride = Number(ext.byteStride);
    const byteOffset = Number(ext.byteOffset ?? 0);
    const byteLength = Number(ext.byteLength ?? 0);
    const mode = ((ext.mode as string) || 'ATTRIBUTES') as MeshoptMode;
    const filter = ((ext.filter as string) || 'NONE') as MeshoptFilter;

    if (
      !Number.isInteger(byteOffset) ||
      byteOffset < 0 ||
      !Number.isInteger(byteLength) ||
      byteLength < 0 ||
      byteOffset + byteLength > srcBin.byteLength
    ) {
      throw new Error(
        `EXT_meshopt_compression: bufferView ${i} compressed range [${byteOffset}, ${byteOffset + byteLength}] out of bounds (${srcBin.byteLength})`,
      );
    }

    const expectedBytes = count * byteStride;
    totalDecodedBytes += expectedBytes;
    if (totalDecodedBytes > MAX_MESHOPT_TOTAL_BYTES) {
      throw new Error(
        `EXT_meshopt_compression: total decompressed size (${totalDecodedBytes}) exceeds MAX_MESHOPT_TOTAL_BYTES (${MAX_MESHOPT_TOTAL_BYTES})`,
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
    bv.byteOffset = writeOffset;
    bv.byteLength = item.bytes.byteLength;
    bv._decoded = item.bytes;
    if (item.ext.mode === 'ATTRIBUTES' && bv.byteStride === undefined) {
      bv.byteStride = Number(item.ext.byteStride);
    }
    if (bv.extensions) {
      delete bv.extensions.EXT_meshopt_compression;
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
    gltf: unknown,
    primitive: Record<string, unknown>,
    bin: ArrayBuffer,
  ): void {
    const ext = primitive?.extensions as Record<string, unknown> | undefined;
    if (ext?.EXT_meshopt_compression) {
      delete ext.EXT_meshopt_compression;
    }
    decodeMeshoptGLB({gltf, bin});
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
