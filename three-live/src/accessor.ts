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

/** Minimal glTF accessor shape read by {@link readAccessorAsFloat32}. */
export interface GltfAccessorLike {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  normalized?: boolean;
  count?: number;
}

const COMPONENT_SIZE: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

/**
 * Reads `comps` components per element of a glTF accessor as `Float32Array`,
 * honoring `componentType`, `normalized` (glTF dequantization rules, as used
 * by `KHR_mesh_quantization` / gltfpack), and the bufferView `byteStride`.
 *
 * Tightly packed, 4-byte-aligned FLOAT accessors are returned as a zero-copy
 * view of `bin`. Returns `null` for accessors without a bufferView (or with
 * zero elements) and throws `RangeError` when the accessor reads past `bin`.
 */
export function readAccessorAsFloat32(
  gltf: {bufferViews?: Array<{byteOffset?: number; byteStride?: number}>},
  bin: ArrayBuffer,
  acc: GltfAccessorLike | null | undefined,
  comps: number,
): Float32Array | null {
  if (!acc || acc.bufferView === undefined) return null;
  const bv = gltf.bufferViews?.[acc.bufferView];
  if (!bv) return null;
  const count = Number(acc.count ?? 0);
  if (!Number.isInteger(count) || count <= 0) return null;
  const ct = acc.componentType ?? 5126;
  const size = COMPONENT_SIZE[ct];
  if (!size) {
    throw new RangeError(`glTF accessor has unsupported componentType ${ct}`);
  }
  const elem = size * comps;
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elem;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (
    !Number.isInteger(base) ||
    base < 0 ||
    stride < elem ||
    base + (count - 1) * stride + elem > bin.byteLength
  ) {
    throw new RangeError(
      `glTF accessor reads past the end of the binary buffer (${bin.byteLength} bytes)`,
    );
  }
  if (ct === 5126 && stride === elem && base % 4 === 0) {
    return new Float32Array(bin, base, count * comps);
  }
  const dv = new DataView(bin);
  const norm = acc.normalized === true;
  const out = new Float32Array(count * comps);
  for (let i = 0; i < count; i++) {
    const row = base + i * stride;
    for (let c = 0; c < comps; c++) {
      const o = row + c * size;
      let v: number;
      switch (ct) {
        case 5126:
          v = dv.getFloat32(o, true);
          break;
        case 5120:
          v = dv.getInt8(o);
          if (norm) v = Math.max(v / 127, -1);
          break;
        case 5121:
          v = dv.getUint8(o);
          if (norm) v /= 255;
          break;
        case 5122:
          v = dv.getInt16(o, true);
          if (norm) v = Math.max(v / 32767, -1);
          break;
        case 5123:
          v = dv.getUint16(o, true);
          if (norm) v /= 65535;
          break;
        default:
          v = dv.getUint32(o, true);
          if (norm) v /= 4294967295;
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

/** `KHR_texture_transform` parameters on a glTF `textureInfo`. */
export interface TextureTransformLike {
  offset?: number[];
  rotation?: number;
  scale?: number[];
}

/**
 * Bakes a `KHR_texture_transform` (offset, rotation, scale; same convention as
 * three.js `Matrix3.setUvTransform`) into interleaved `uv` pairs in place.
 */
export function applyTextureTransform(
  uv: Float32Array,
  t: TextureTransformLike,
): void {
  const ox = Number(t.offset?.[0] ?? 0) || 0;
  const oy = Number(t.offset?.[1] ?? 0) || 0;
  const sx = Number(t.scale?.[0] ?? 1);
  const sy = Number(t.scale?.[1] ?? 1);
  const r = Number(t.rotation ?? 0) || 0;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const a = (Number.isFinite(sx) ? sx : 1) * c;
  const b = (Number.isFinite(sx) ? sx : 1) * s;
  const d = -(Number.isFinite(sy) ? sy : 1) * s;
  const e = (Number.isFinite(sy) ? sy : 1) * c;
  for (let i = 0; i + 1 < uv.length; i += 2) {
    const u = uv[i]!;
    const v = uv[i + 1]!;
    uv[i] = a * u + b * v + ox;
    uv[i + 1] = d * u + e * v + oy;
  }
}
