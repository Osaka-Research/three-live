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
 * @fileoverview Spatial `splat-loader` plugin for `<xr-live>`.
 *
 * Loads 3D Gaussian Splat captures (`.splat` 32-byte records, or Niantic
 * `.spz` v2/v3, gzip-compressed or raw) for any mesh tagged with
 * `userData.xr.splatUrl`, depth-sorts splats back-to-front with a 16-bit
 * counting sort, and draws them as alpha-blended Gaussian point sprites after
 * the main pass (an isotropic "splat-lite" approximation sized by the largest
 * axis of each Gaussian).
 */

import {createProgram} from '../../../three-live/src/gl-program';
import {mat3NormalFromMat4, mat4Multiply} from '../../../three-live/src/math';
import {
  getSharedRegistry,
  type SplatGPUFrameOutput,
  type ThreeLivePlugin,
} from '../../../three-live/src/plugin';
import {getMeshXRTraits} from '../xr-traits';
import {cacheXRFrame, type PluginViewer, resolveProjection} from './common';

/** Maximum splats accepted from a single file. */
export const MAX_SPLATS = 1_000_000;
/** Maximum downloaded (compressed) file size in bytes. */
export const MAX_SPLAT_FILE_BYTES = 128 * 1024 * 1024;
/** Maximum decompressed `.spz` payload size in bytes. */
export const MAX_SPZ_DECOMPRESSED_BYTES = 256 * 1024 * 1024;

const SPLAT_RECORD_BYTES = 32;
const SPZ_MAGIC = 0x5053474e;
const SH_C0 = 0.28209479177387814;
const SH_C1 = 0.4886025119029199;
const SH_C2_0 = 1.0925484305920792;
const SH_C2_1 = -1.0925484305920792;
const SH_C2_2 = 0.31539156525252005;
const SH_C2_3 = -1.0925484305920792;
const SH_C2_4 = 0.5462742152960396;
const SH_C3_0 = -0.5900435899266435;
const SH_C3_1 = 2.890611442640554;
const SH_C3_2 = -0.4570457994644658;
const SH_C3_3 = 0.3731763325901154;
const SH_C3_4 = -0.4570457994644658;
const SH_C3_5 = 1.445305721320277;
const SH_C3_6 = -0.5900435899266435;

/** Number of higher-order SH basis functions (excluding DC) for degree `0..3`. */
export function shBasisCountForDegree(shDegree: number): number {
  switch (shDegree) {
    case 1:
      return 3;
    case 2:
      return 8;
    case 3:
      return 15;
    default:
      return 0;
  }
}

/** Decoded Gaussian splat cloud (structure of arrays). */
export interface SplatData {
  readonly count: number;
  /** xyz per splat. */
  readonly positions: Float32Array;
  /** Linear (not log) xyz scale per splat. */
  readonly scales: Float32Array;
  /** RGBA8 per splat. */
  readonly colors: Uint8Array;
  /** Unit quaternion xyzw per splat. */
  readonly rotations: Float32Array;
  /** Optional Spherical Harmonics degree (`0`, `1`, `2`, or `3`). */
  readonly shDegree?: number;
  /**
   * Optional higher-order Spherical Harmonics coefficients in `[-1, 1]`
   * (`count * shBasisCountForDegree(shDegree) * 3` floats, RGB-interleaved per basis).
   */
  readonly sh?: Float32Array | null;
  /**
   * True when the `.spz` header flags byte (byte 14) has the antialiased bit
   * (bit 0) set: the cloud was trained with a 0.3 px screen-space blur, so the
   * renderer applies opacity compensation `sqrt(det(S) / det(S + 0.3 I))`.
   */
  readonly antialiased?: boolean;
}

function allocate(count: number, shDegree = 0): SplatData {
  const basisCount = shBasisCountForDegree(shDegree);
  return {
    count,
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3),
    colors: new Uint8Array(count * 4),
    rotations: new Float32Array(count * 4),
    shDegree,
    sh: basisCount > 0 ? new Float32Array(count * basisCount * 3) : null,
  };
}

function normalizeQuat(q: Float32Array, o: number): void {
  const len = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]);
  if (len > 1e-8 && Number.isFinite(len)) {
    for (let k = 0; k < 4; k++) q[o + k] /= len;
  } else {
    q.set([0, 0, 0, 1], o);
  }
}

/**
 * Parses an antimatter15-style `.splat` buffer: per splat, position f32x3,
 * scale f32x3, RGBA u8x4, rotation u8x4 (`(b - 128) / 128`, order w,x,y,z).
 */
export function parseSplat(buffer: ArrayBuffer | Uint8Array): SplatData {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.byteLength % SPLAT_RECORD_BYTES !== 0) {
    throw new Error('splat-loader: .splat size is not a multiple of 32 bytes');
  }
  const count = bytes.byteLength / SPLAT_RECORD_BYTES;
  if (count > MAX_SPLATS) throw new Error('splat-loader: too many splats');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = allocate(count);
  for (let i = 0; i < count; i++) {
    const b = i * SPLAT_RECORD_BYTES;
    for (let k = 0; k < 3; k++) {
      const p = view.getFloat32(b + k * 4, true);
      const s = view.getFloat32(b + 12 + k * 4, true);
      out.positions[i * 3 + k] = Number.isFinite(p) ? p : 0;
      out.scales[i * 3 + k] = Number.isFinite(s) ? Math.abs(s) : 0;
    }
    out.colors.set(bytes.subarray(b + 24, b + 28), i * 4);
    // The packed quaternion is wxyz; store xyzw without per-splat arrays.
    for (let k = 0; k < 4; k++) {
      out.rotations[i * 4 + k] = (bytes[b + 28 + ((k + 1) & 3)] - 128) / 128;
    }
    normalizeQuat(out.rotations, i * 4);
  }
  return out;
}

/** Decompresses gzip data with `DecompressionStream`, enforcing a size cap. */
export async function gunzip(
  bytes: Uint8Array,
  maxBytes = MAX_SPZ_DECOMPRESSED_BYTES,
): Promise<Uint8Array> {
  const DS = (globalThis as {DecompressionStream?: typeof DecompressionStream})
    .DecompressionStream;
  if (typeof DS !== 'function') {
    throw new Error('splat-loader: DecompressionStream unavailable');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DS('gzip'));
  return readStreamCapped(
    stream.getReader(), maxBytes,
    'splat-loader: decompressed .spz exceeds size limit',
  );
}

/**
 * Parses a decompressed `.spz` payload (versions 2 and 3). Layout: 16-byte
 * header, then SoA blocks of 24-bit fixed-point positions, alphas, colors
 * (SH DC), log scales, rotations (3-byte xyz for v2, 4-byte smallest-three
 * for v3), and optional trailing Spherical Harmonics (bands 1–3, header byte 12).
 */
export function parseSpzPayload(bytes: Uint8Array): SplatData {
  if (bytes.byteLength < 16) {
    throw new Error('splat-loader: .spz header truncated');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SPZ_MAGIC) {
    throw new Error('splat-loader: bad .spz magic');
  }
  const version = view.getUint32(4, true);
  if (version !== 2 && version !== 3) {
    throw new Error(`splat-loader: unsupported .spz version ${version}`);
  }
  const count = view.getUint32(8, true);
  if (count > MAX_SPLATS) throw new Error('splat-loader: too many splats');
  const rawShDegree = bytes[12];
  if (rawShDegree > 3) {
    throw new Error(`splat-loader: invalid .spz shDegree ${rawShDegree}`);
  }
  const fractionalBits = bytes[13];
  if (fractionalBits > 24) {
    throw new Error('splat-loader: invalid .spz fractional bits');
  }
  const rotBytes = version === 3 ? 4 : 3;
  const baseNeeded = 16 + count * (9 + 1 + 3 + 3 + rotBytes);
  if (bytes.byteLength < baseNeeded) {
    throw new Error('splat-loader: .spz payload truncated');
  }
  const shBasisCount = shBasisCountForDegree(rawShDegree);
  const shBytesPerSplat = shBasisCount * 3;
  const hasFullShBlock =
    shBytesPerSplat > 0 &&
    bytes.byteLength >= baseNeeded + count * shBytesPerSplat;
  const out = allocate(count, hasFullShBlock ? rawShDegree : 0);
  const fixed = Math.pow(2, -fractionalBits);
  let o = 16;
  for (let i = 0; i < count * 3; i++, o += 3) {
    let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
    if (v & 0x800000) v |= ~0xffffff;
    out.positions[i] = v * fixed;
  }
  const alphaStart = o;
  const colorStart = alphaStart + count;
  const scaleStart = colorStart + count * 3;
  const rotStart = scaleStart + count * 3;
  const shStart = rotStart + count * rotBytes;
  // Reuse the v3 decode scratch; all four components are overwritten per splat.
  const q = [0, 0, 0, 0];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const dc = (bytes[colorStart + i * 3 + k] / 255 - 0.5) / 0.15;
      out.colors[i * 4 + k] = Math.max(
        0,
        Math.min(255, Math.round((0.5 + SH_C0 * dc) * 255)),
      );
      out.scales[i * 3 + k] = Math.exp(bytes[scaleStart + i * 3 + k] / 16 - 10);
    }
    out.colors[i * 4 + 3] = bytes[alphaStart + i];
    const r = rotStart + i * rotBytes;
    if (version === 2) {
      const x = bytes[r] / 127.5 - 1;
      const y = bytes[r + 1] / 127.5 - 1;
      const z = bytes[r + 2] / 127.5 - 1;
      out.rotations.set(
        [x, y, z, Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))],
        i * 4,
      );
    } else {
      let comp =
        (bytes[r] |
          (bytes[r + 1] << 8) |
          (bytes[r + 2] << 16) |
          (bytes[r + 3] << 24)) >>>
        0;
      const largest = comp >>> 30;
      let sum = 0;
      for (let k = 3; k >= 0; k--) {
        if (k === largest) continue;
        const mag = comp & 511;
        const neg = (comp >>> 9) & 1;
        comp >>>= 10;
        q[k] = ((Math.SQRT1_2 * mag) / 511) * (neg ? -1 : 1);
        sum += q[k] * q[k];
      }
      q[largest] = Math.sqrt(Math.max(0, 1 - sum));
      out.rotations.set(q, i * 4);
    }
    normalizeQuat(out.rotations, i * 4);
  }
  if (hasFullShBlock && out.sh) {
    const totalSh = count * shBytesPerSplat;
    for (let j = 0; j < totalSh; j++) {
      out.sh[j] = (bytes[shStart + j] - 128) / 128;
    }
  }
  // Header byte 14 is the flags byte; bit 0 marks antialiased training.
  return (bytes[14] & 1) !== 0 ? {...out, antialiased: true} : out;
}

/**
 * Evaluates view-dependent RGB color `[0..255]` for splat `index` along unit
 * view direction `(dirX, dirY, dirZ)` (from camera to splat) using decoded
 * Spherical Harmonics bands 1..3 when present.
 */
export function evaluateSplatSH(
  data: SplatData,
  index: number,
  dirX: number,
  dirY: number,
  dirZ: number,
): [number, number, number] {
  const deg = data.shDegree ?? 0;
  const basisCount = shBasisCountForDegree(deg);
  const sh = data.sh;
  if (
    basisCount === 0 ||
    !sh ||
    index < 0 ||
    index >= data.count ||
    sh.length < (index + 1) * basisCount * 3
  ) {
    return [
      data.colors[index * 4] ?? 0,
      data.colors[index * 4 + 1] ?? 0,
      data.colors[index * 4 + 2] ?? 0,
    ];
  }
  const len = Math.hypot(dirX, dirY, dirZ) || 1;
  const x = dirX / len;
  const y = dirY / len;
  const z = dirZ / len;
  const offset = index * basisCount * 3;
  let r = data.colors[index * 4] / 255;
  let g = data.colors[index * 4 + 1] / 255;
  let b = data.colors[index * 4 + 2] / 255;

  const addBasis = (basisIdx: number, weight: number) => {
    const o = offset + basisIdx * 3;
    r += weight * sh[o];
    g += weight * sh[o + 1];
    b += weight * sh[o + 2];
  };

  // A nonzero basis count guarantees a validated degree of 1, 2 or 3.
  addBasis(0, -SH_C1 * y);
  addBasis(1, SH_C1 * z);
  addBasis(2, -SH_C1 * x);
  if (deg >= 2) {
    const xx = x * x;
    const yy = y * y;
    const zz = z * z;
    const xy = x * y;
    const yz = y * z;
    const xz = x * z;
    addBasis(3, SH_C2_0 * xy);
    addBasis(4, SH_C2_1 * yz);
    addBasis(5, SH_C2_2 * (2 * zz - xx - yy));
    addBasis(6, SH_C2_3 * xz);
    addBasis(7, SH_C2_4 * (xx - yy));
    if (deg >= 3) {
      addBasis(8, SH_C3_0 * y * (3 * xx - yy));
      addBasis(9, SH_C3_1 * xy * z);
      addBasis(10, SH_C3_2 * y * (4 * zz - xx - yy));
      addBasis(11, SH_C3_3 * z * (2 * zz - 3 * xx - 3 * yy));
      addBasis(12, SH_C3_4 * x * (4 * zz - xx - yy));
      addBasis(13, SH_C3_5 * z * (xx - yy));
      addBasis(14, SH_C3_6 * x * (xx - 3 * yy));
    }
  }
  return [
    Math.max(0, Math.min(255, Math.round(r * 255))),
    Math.max(0, Math.min(255, Math.round(g * 255))),
    Math.max(0, Math.min(255, Math.round(b * 255))),
  ];
}

/**
 * Computes the 6 unique upper-triangular elements `[cxx, cxy, cxz, cyy, cyz, czz]`
 * of the 3D Gaussian covariance matrix `Sigma = R * S * S^T * R^T` for splat `index`.
 */
export function computeSplatCovariance3D(
  scales: Float32Array,
  rotations: Float32Array,
  index: number,
  out: Float32Array = new Float32Array(6),
  outOffset = 0,
): Float32Array {
  const sx = scales[index * 3];
  const sy = scales[index * 3 + 1];
  const sz = scales[index * 3 + 2];
  const qx = rotations[index * 4];
  const qy = rotations[index * 4 + 1];
  const qz = rotations[index * 4 + 2];
  const qw = rotations[index * 4 + 3];

  const r00 = 1 - 2 * (qy * qy + qz * qz);
  const r01 = 2 * (qx * qy - qw * qz);
  const r02 = 2 * (qx * qz + qw * qy);
  const r10 = 2 * (qx * qy + qw * qz);
  const r11 = 1 - 2 * (qx * qx + qz * qz);
  const r12 = 2 * (qy * qz - qw * qx);
  const r20 = 2 * (qx * qz - qw * qy);
  const r21 = 2 * (qy * qz + qw * qx);
  const r22 = 1 - 2 * (qx * qx + qy * qy);

  const m00 = r00 * sx;
  const m01 = r01 * sy;
  const m02 = r02 * sz;
  const m10 = r10 * sx;
  const m11 = r11 * sy;
  const m12 = r12 * sz;
  const m20 = r20 * sx;
  const m21 = r21 * sy;
  const m22 = r22 * sz;

  out[outOffset] = m00 * m00 + m01 * m01 + m02 * m02;
  out[outOffset + 1] = m00 * m10 + m01 * m11 + m02 * m12;
  out[outOffset + 2] = m00 * m20 + m01 * m21 + m02 * m22;
  out[outOffset + 3] = m10 * m10 + m11 * m11 + m12 * m12;
  out[outOffset + 4] = m10 * m20 + m11 * m21 + m12 * m22;
  out[outOffset + 5] = m20 * m20 + m21 * m21 + m22 * m22;
  return out;
}

/** Projected 2D screen-space Gaussian covariance and principal ellipse axes. */
export interface SplatEllipse2D {
  /** 2D covariance `[cov_xx, cov_xy, cov_yy]` in pixel^2 units. */
  readonly cov2d: [number, number, number];
  /** Eigenvalues `[lambda1, lambda2]` (`lambda1 >= lambda2`). */
  readonly eigenvalues: [number, number];
  /** Major axis half-extent vector `[vx, vy]` in pixels (`3 * sqrt(lambda1)`). */
  readonly majorAxisPx: [number, number];
  /** Minor axis half-extent vector `[vx, vy]` in pixels (`3 * sqrt(lambda2)`). */
  readonly minorAxisPx: [number, number];
}

/**
 * Projects a 3D covariance `[cxx, cxy, cxz, cyy, cyz, czz]` to 2D screen space
 * via the perspective Jacobian `J` and view transform `modelView` (column-major 4x4):
 * `Sigma_2D = J * W * Sigma * W^T * J^T + 0.3 * I`.
 */
export function projectSplatCovariance2D(
  cov3d: ArrayLike<number>,
  modelView: ArrayLike<number>,
  localPos: ArrayLike<number>,
  focalX: number,
  focalY: number = focalX,
): SplatEllipse2D {
  const px = localPos[0];
  const py = localPos[1];
  const pz = localPos[2];
  const vx =
    modelView[0] * px + modelView[4] * py + modelView[8] * pz + modelView[12];
  const vy =
    modelView[1] * px + modelView[5] * py + modelView[9] * pz + modelView[13];
  const vz =
    modelView[2] * px + modelView[6] * py + modelView[10] * pz + modelView[14];
  const tz = Math.max(Math.abs(vz), 1e-3);
  const signZ = vz < 0 ? -1 : 1;

  const j00 = focalX / tz;
  const j02 = (-signZ * focalX * vx) / (tz * tz);
  const j11 = focalY / tz;
  const j12 = (-signZ * focalY * vy) / (tz * tz);

  // T = J * W (2x3 matrix, row-major: [t00, t01, t02; t10, t11, t12])
  const w00 = modelView[0];
  const w01 = modelView[4];
  const w02 = modelView[8];
  const w10 = modelView[1];
  const w11 = modelView[5];
  const w12 = modelView[9];
  const w20 = modelView[2];
  const w21 = modelView[6];
  const w22 = modelView[10];

  const t00 = j00 * w00 + j02 * w20;
  const t01 = j00 * w01 + j02 * w21;
  const t02 = j00 * w02 + j02 * w22;
  const t10 = j11 * w10 + j12 * w20;
  const t11 = j11 * w11 + j12 * w21;
  const t12 = j11 * w12 + j12 * w22;

  const s00 = cov3d[0];
  const s01 = cov3d[1];
  const s02 = cov3d[2];
  const s11 = cov3d[3];
  const s12 = cov3d[4];
  const s22 = cov3d[5];

  // Sigma * T^T
  const st00 = s00 * t00 + s01 * t01 + s02 * t02;
  const st10 = s01 * t00 + s11 * t01 + s12 * t02;
  const st20 = s02 * t00 + s12 * t01 + s22 * t02;
  const st01 = s00 * t10 + s01 * t11 + s02 * t12;
  const st11 = s01 * t10 + s11 * t11 + s12 * t12;
  const st21 = s02 * t10 + s12 * t11 + s22 * t12;

  const a = t00 * st00 + t01 * st10 + t02 * st20 + 0.3;
  const b = t00 * st01 + t01 * st11 + t02 * st21;
  const c = t10 * st01 + t11 * st11 + t12 * st21 + 0.3;

  const mid = 0.5 * (a + c);
  const diff = 0.5 * (a - c);
  const disc = Math.hypot(diff, b);
  const lambda1 = Math.max(0.1, mid + disc);
  const lambda2 = Math.max(0.1, mid - disc);

  let dx = b;
  let dy = lambda1 - a;
  const dLen = Math.hypot(dx, dy);
  if (dLen > 1e-8) {
    dx /= dLen;
    dy /= dLen;
  } else {
    dx = a >= c ? 1 : 0;
    dy = a >= c ? 0 : 1;
  }
  const r1 = Math.min(256, 3 * Math.sqrt(lambda1));
  const r2 = Math.min(256, 3 * Math.sqrt(lambda2));
  return {
    cov2d: [a, b, c],
    eigenvalues: [lambda1, lambda2],
    majorAxisPx: [dx * r1, dy * r1],
    minorAxisPx: [-dy * r2, dx * r2],
  };
}

/** Parses `.spz` bytes, transparently gunzipping when gzip-compressed. */
export async function parseSpz(bytes: Uint8Array): Promise<SplatData> {
  const gz = bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return parseSpzPayload(gz ? await gunzip(bytes) : bytes);
}

/**
 * Validates a splat URL: `https:`, `blob:`, or `http:` on loopback hosts, plus
 * relative URLs resolved against the document. Unless `allowCrossOrigin` is
 * set (host attribute `allow-remote-splats`), the URL must be same-origin so a
 * third-party `.glb` cannot make the viewer contact arbitrary servers.
 * Returns the resolved URL, or `null` when rejected.
 */
export function resolveSplatUrl(
  raw: unknown,
  base?: string,
  allowCrossOrigin = true,
): string | null {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4096) return null;
  try {
    const fallbackBase =
      base ??
      (typeof document !== 'undefined'
        ? document.baseURI
        : 'https://localhost/');
    const url = new URL(raw.trim(), fallbackBase);
    const loopback =
      url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const schemeOk =
      url.protocol === 'https:' ||
      url.protocol === 'blob:' ||
      (url.protocol === 'http:' && loopback);
    if (!schemeOk) return null;
    if (
      !allowCrossOrigin &&
      url.protocol !== 'blob:' &&
      url.origin !== new URL(fallbackBase).origin
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Reads a response body with a running byte cap (no Content-Length needed). */
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      throw new Error('splat-loader: file too large');
    }
    return buf;
  }
  return readStreamCapped(reader, maxBytes, 'splat-loader: file too large');
}

/** Collects byte streams without retaining data beyond the size limit. */
async function readStreamCapped(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number,
  limitMessage: string,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(limitMessage);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

/** Downloads and decodes a `.splat` / `.spz` file with size limits. */
export async function loadSplat(
  url: string,
  fetchFn: typeof fetch = fetch,
  allowCrossOrigin = true,
): Promise<SplatData> {
  const resolved = resolveSplatUrl(url, undefined, allowCrossOrigin);
  if (!resolved) throw new Error('splat-loader: URL rejected');
  const res = await fetchFn(resolved, {credentials: 'same-origin'});
  if (!res.ok) throw new Error(`splat-loader: HTTP ${res.status}`);
  const declared = Number(res.headers?.get?.('content-length') ?? 0);
  if (declared > MAX_SPLAT_FILE_BYTES) {
    throw new Error('splat-loader: file too large');
  }
  const buf = await readCapped(res, MAX_SPLAT_FILE_BYTES);
  const isSpz =
    /\.spz(\?|#|$)/i.test(new URL(resolved).pathname) ||
    (buf[0] === 0x1f && buf[1] === 0x8b) ||
    (buf.byteLength >= 4 &&
      new DataView(buf.buffer).getUint32(0, true) === SPZ_MAGIC);
  return isSpz ? parseSpz(buf) : parseSplat(buf);
}

/** Reusable scratch buffers for {@link sortSplatsByDepth}. */
export interface SplatSortScratch {
  depths: Float32Array;
  keys: Uint16Array;
  counts: Uint32Array;
}

/** Allocates sort scratch buffers for `count` splats. */
export function createSplatSortScratch(count: number): SplatSortScratch {
  return {
    depths: new Float32Array(count),
    keys: new Uint16Array(count),
    counts: new Uint32Array(65536),
  };
}

/**
 * Returns splat indices sorted back-to-front for a column-major
 * model-view-projection matrix, keyed on clip-space `w` (view distance along
 * the camera axis, valid for any perspective projection including per-eye XR
 * views), or clip-space z for orthographic views, with a single-pass
 * 16-bit counting sort.
 */
export function sortSplatsByDepth(
  data: Pick<SplatData, 'count' | 'positions'>,
  mvp: ArrayLike<number>,
  out: Uint32Array = new Uint32Array(data.count),
  scratch: SplatSortScratch = createSplatSortScratch(data.count),
): Uint32Array {
  const n = data.count;
  const p = data.positions;
  const row = mvp[3] === 0 && mvp[7] === 0 && mvp[11] === 0 ? 2 : 3;
  const {depths, keys, counts} = scratch;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const w =
      mvp[row] * p[i * 3] +
      mvp[4 + row] * p[i * 3 + 1] +
      mvp[8 + row] * p[i * 3 + 2] +
      mvp[12 + row];
    depths[i] = w;
    // Use the stored float32 value: a finite double can overflow to ±Infinity.
    const d = depths[i];
    if (!Number.isFinite(d)) continue;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  if (!(max >= min)) {
    min = 0;
    max = 0;
  }
  const buckets = 65536;
  counts.fill(0);
  const range = max - min || 1;
  for (let i = 0; i < n; i++) {
    // Largest w (farthest) gets key 0 so it is drawn first. Non-finite depths
    // clamp into range (NaN -> farthest) so every index is emitted once.
    const f = ((max - depths[i]) / range) * (buckets - 1);
    const k = f >= 0 ? Math.min(buckets - 1, Math.floor(f)) : 0;
    keys[i] = k;
    counts[k]++;
  }
  for (let k = 1; k < buckets; k++) counts[k] += counts[k - 1];
  for (let i = n - 1; i >= 0; i--) out[--counts[keys[i]]] = i;
  return out;
}

const VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aColor;
layout(location=2) in float aRadius;
layout(location=3) in vec3 aCovA;
layout(location=4) in vec3 aCovB;
uniform mat4 uMVP;
uniform mat4 uMV;
uniform float uFocalPx;
uniform int uUseAniso;
uniform int uAntialias;
out vec4 vColor;
out vec3 vConic;
void main(){
vec4 c=uMVP*vec4(aPos,1.0);
gl_Position=c;
vColor=aColor;
if(uUseAniso!=0){
vec4 v=uMV*vec4(aPos,1.0);
float tz=max(abs(v.z),1e-3);
float sz=v.z<0.0?-1.0:1.0;
float j00=uFocalPx/tz;
float j02=(-sz*uFocalPx*v.x)/(tz*tz);
float j11=uFocalPx/tz;
float j12=(-sz*uFocalPx*v.y)/(tz*tz);
mat3 W=mat3(uMV);
vec3 t0=vec3(j00*W[0].x+j02*W[0].z,j00*W[1].x+j02*W[1].z,j00*W[2].x+j02*W[2].z);
vec3 t1=vec3(j11*W[0].y+j12*W[0].z,j11*W[1].y+j12*W[1].z,j11*W[2].y+j12*W[2].z);
mat3 S=mat3(aCovA.x,aCovA.y,aCovA.z,aCovA.y,aCovB.x,aCovB.y,aCovA.z,aCovB.y,aCovB.z);
vec3 st0=S*t0;
vec3 st1=S*t1;
float ca=dot(t0,st0)+0.3;
float cb=dot(t0,st1);
float cc=dot(t1,st1)+0.3;
float mid=0.5*(ca+cc);
float disc=length(vec2(0.5*(ca-cc),cb));
float l1=max(0.1,mid+disc);
float det=max(ca*cc-cb*cb,1e-6);
if(uAntialias!=0)vColor.a*=sqrt(clamp(((ca-0.3)*(cc-0.3)-cb*cb)/det,0.0,1.0));
gl_PointSize=clamp(6.0*sqrt(l1),1.0,512.0);
vConic=vec3(cc,cb,ca)*(l1/det);
}else{
gl_PointSize=clamp(6.0*aRadius*uFocalPx/max(c.w,1e-3),1.0,512.0);
vConic=vec3(1.0,0.0,1.0);
}
}`;
const FS = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec3 vConic;
out vec4 o;
void main(){
vec2 d=gl_PointCoord*2.0-1.0;
float r=vConic.x*d.x*d.x+2.0*vConic.y*d.x*d.y+vConic.z*d.y*d.y;
if(r>1.0)discard;
float a=vColor.a*exp(-4.5*r);
o=vec4(vColor.rgb*a,a);
}`;

/**
 * Writes view-dependent RGBA8 colors for every splat into `out` (length
 * `count * 4`) for eye position `cameraWorldPos` and world matrix `model`.
 * SH coefficients live in the splat's local frame, so the camera-to-splat
 * direction is mapped world -> local with the inverse of `model`'s 3x3 (falls
 * back to the transpose when singular; `evaluateSplatSH` normalizes).
 */
export function computeSplatViewColors(
  data: SplatData,
  model: ArrayLike<number>,
  cameraWorldPos: ArrayLike<number>,
  out: Uint8Array,
): Uint8Array {
  // Normal-matrix storage is column-major inverse-transpose, which is also
  // row-major inverse. Initialize the transpose fallback for singular models.
  const inverse = new Float64Array([
    model[0], model[1], model[2],
    model[4], model[5], model[6],
    model[8], model[9], model[10],
  ]);
  const [i00, i01, i02, i10, i11, i12, i20, i21, i22] =
    mat3NormalFromMat4(inverse, model, 1e-12);
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

interface SortedSplatView {
  readonly buffer: WebGLBuffer;
  readonly depth: Float32Array;
  age: number;
}

/** Two eye slots reference up to two physical GPU orders. */
interface SplatEye {
  eye: string;
  key: Float32Array;
  order?: SortedSplatView;
  /** Set only after a successful update; absent slots have not drawn. */
  seen?: boolean;
}

function sameSplatDepth(a: Float32Array, b: Float32Array): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

/** Exact depth rows share an order, including during the moving-view cooldown. */
function createSplatSortCache(
  gl: WebGL2RenderingContext,
  data: SplatData,
) {
  const target = gl.ELEMENT_ARRAY_BUFFER;
  let current: SplatEye | undefined;
  let previous: SplatEye | undefined;
  const orders: SortedSplatView[] = [];
  const order = new Uint32Array(data.count);
  const scratch = createSplatSortScratch(data.count);
  return {
    update(
      matrix: Float32Array,
      eye: string,
      externalOrder?: Uint32Array | null,
    ): SortedSplatView | undefined {
      const row = matrix[3] === 0 && matrix[7] === 0 && matrix[11] === 0 ? 2 : 3;
      if (current?.eye !== eye) {
        const next = previous?.eye === eye ? previous :
          {eye, key: new Float32Array(4)};
        previous = current;
        current = next;
      }
      const view = current;
      for (let i = 0; i < 4; i++) view.key[i] = matrix[i * 4 + row];
      // Repeating an eye starts the next draw cycle. The second eye shares
      // the first eye's cooldown instead of advancing it a second time.
      if (view.seen && previous) previous.seen = false;
      if (
        !externalOrder &&
        previous?.seen &&
        previous.order &&
        sameSplatDepth(previous.key, view.key)
      ) {
        view.order = previous.order;
      } else {
        // A first eye may update a shared buffer. A divergent second eye
        // must split before writing, so it cannot replace the first eye's order.
        if (!view.order || (previous?.seen && view.order === previous.order)) {
          let storage = orders.find(o => o !== previous?.order);
          if (!storage) {
            const buffer = gl.createBuffer();
            if (!buffer) return;
            storage = {buffer, depth: new Float32Array(4).fill(NaN), age: 4};
            orders.push(storage);
            gl.bindBuffer(target, buffer);
            gl.bufferData(target, order.byteLength, gl.DYNAMIC_DRAW);
          }
          view.order = storage;
          storage.age = 4;
        }
        if (view.order.age < 4) view.order.age++;
      }
      const storage = view.order;
      gl.bindBuffer(target, storage.buffer);
      if (externalOrder && externalOrder.length === data.count) {
        gl.bufferSubData(target, 0, externalOrder);
        storage.depth.set(view.key);
        storage.age = 0;
      } else if (storage.age >= 4 && !sameSplatDepth(storage.depth, view.key)) {
        sortSplatsByDepth(data, matrix, order, scratch);
        gl.bufferSubData(target, 0, order);
        storage.depth.set(view.key);
        storage.age = 0;
      }
      view.seen = true;
      return storage;
    },
    dispose(): void {
      for (const view of orders.splice(0)) {
        gl.deleteBuffer(view.buffer);
      }
      current = previous = undefined;
    }
  };
}

/** Uploads a splat cloud and draws it as sorted Gaussian point sprites. */
export class SplatRenderer {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private readonly buffers: WebGLBuffer[] = [];
  private colorBuffer: WebGLBuffer | null = null;
  private readonly sorter: ReturnType<typeof createSplatSortCache>;
  private uMVP: WebGLUniformLocation | null = null;
  private uMV: WebGLUniformLocation | null = null;
  private uFocal: WebGLUniformLocation | null = null;
  private uUseAniso: WebGLUniformLocation | null = null;
  private uAntialias: WebGLUniformLocation | null = null;
  private readonly mvp = new Float32Array(16);
  private shColors: Uint8Array | null = null;
  private shDirty = false;
  private framesSinceColor = Infinity;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly data: SplatData,
  ) {
    this.sorter = createSplatSortCache(gl, data);
    const prog = createProgram(gl, VS, FS, false);
    if (!prog) return;
    this.program = prog;
    this.uMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uMV = gl.getUniformLocation(prog, 'uMV');
    this.uFocal = gl.getUniformLocation(prog, 'uFocalPx');
    this.uUseAniso = gl.getUniformLocation(prog, 'uUseAniso');
    this.uAntialias = gl.getUniformLocation(prog, 'uAntialias');
    const radii = new Float32Array(data.count);
    const covA = new Float32Array(data.count * 3);
    const covB = new Float32Array(data.count * 3);
    const cov6 = new Float32Array(6);
    for (let i = 0; i < data.count; i++) {
      radii[i] = Math.max(
        data.scales[i * 3],
        data.scales[i * 3 + 1],
        data.scales[i * 3 + 2],
      );
      computeSplatCovariance3D(data.scales, data.rotations, i, cov6, 0);
      covA[i * 3] = cov6[0];
      covA[i * 3 + 1] = cov6[1];
      covA[i * 3 + 2] = cov6[2];
      covB[i * 3] = cov6[3];
      covB[i * 3 + 1] = cov6[4];
      covB[i * 3 + 2] = cov6[5];
    }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attrib = (
      loc: number,
      arr: ArrayBufferView,
      size: number,
      type: number,
      norm: boolean,
      usage = gl.STATIC_DRAW,
    ): WebGLBuffer | null => {
      const b = gl.createBuffer();
      if (!b) return null;
      this.buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
      return b;
    };
    attrib(0, data.positions, 3, gl.FLOAT, false);
    this.colorBuffer = attrib(
      1,
      data.colors,
      4,
      gl.UNSIGNED_BYTE,
      true,
      data.sh ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW,
    );
    attrib(2, radii, 1, gl.FLOAT, false);
    attrib(3, covA, 3, gl.FLOAT, false);
    attrib(4, covB, 3, gl.FLOAT, false);
    gl.bindVertexArray(null);
  }

  /**
   * Re-evaluates view-dependent Spherical Harmonics colors when `data.sh` is
   * present and uploads them to the color attribute buffer.
   */
  updateViewColors(
    cameraWorldPos: ArrayLike<number>,
    model: ArrayLike<number>,
  ): void {
    const gl = this.gl;
    if (!this.colorBuffer || !this.data.sh || (this.data.shDegree ?? 0) <= 0) {
      return;
    }
    if (!this.shColors) {
      this.shColors = new Uint8Array(this.data.colors);
    }
    const out = computeSplatViewColors(
      this.data,
      model,
      cameraWorldPos,
      this.shColors,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, out);
    this.shDirty = true;
  }

  /**
   * Draws the cloud with cached depth orders; moving views refresh every fourth
   * draw cycle. Parallel eyes share an order; divergent eyes use separate buffers.
   * Leaves the program, VAO, blend, and depth-mask state as the main renderer
   * expects: no VAO bound, blending disabled, depth writes enabled.
   */
  draw(
    vp: Float32Array,
    model: Float32Array,
    focalPx: number,
    modelView?: Float32Array | null,
    cameraPos?: ArrayLike<number> | null,
    highQualitySH = false,
    eye: 'left' | 'right' | 'none' = 'none',
    externalGpu?: SplatGPUFrameOutput | null,
  ): void {
    const gl = this.gl;
    if (
      !this.program ||
      !this.vao ||
      this.data.count === 0
    ) {
      return;
    }
    const mvp = this.mvp;
    mat4Multiply(mvp, vp, model);
    // Bind our VAO *before* touching ELEMENT_ARRAY_BUFFER: that binding is VAO
    // state, and the renderer leaves its last mesh VAO bound.
    gl.bindVertexArray(this.vao);
    if (!this.sorter.update(mvp, eye, externalGpu?.order)) {
      gl.bindVertexArray(null);
      return;
    }
    // SH changes on lateral camera moves even when the depth order is cached.
    if (
      highQualitySH &&
      externalGpu?.colors &&
      this.colorBuffer &&
      externalGpu.colors.length === this.data.count * 4
    ) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, externalGpu.colors);
      this.shDirty = true;
      this.framesSinceColor = 0;
    } else if (highQualitySH && externalGpu?.shHandled) {
      this.framesSinceColor = 0;
    } else if (++this.framesSinceColor >= 4) {
      if (highQualitySH && cameraPos) {
        this.updateViewColors(cameraPos, model);
      } else if (this.shDirty && this.colorBuffer) {
        // Quality dropped back to normal: restore the base (DC) colors.
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.colors);
        this.shColors = null;
        this.shDirty = false;
      }
      this.framesSinceColor = 0;
    }
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMVP, false, mvp);
    if (modelView && this.uMV !== null) {
      gl.uniformMatrix4fv(this.uMV, false, modelView);
      gl.uniform1i?.(this.uUseAniso, 1);
    } else {
      gl.uniform1i?.(this.uUseAniso, 0);
    }
    gl.uniform1f(this.uFocal, focalPx);
    gl.uniform1i?.(this.uAntialias, this.data.antialiased ? 1 : 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.drawElements(gl.POINTS, this.data.count, gl.UNSIGNED_INT, 0);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** Frees GPU resources. */
  dispose(): void {
    const gl = this.gl;
    for (const b of this.buffers.splice(0)) gl.deleteBuffer(b);
    this.sorter.dispose();
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
    this.vao = null;
  }
}

interface SplatEntry {
  readonly url: string;
  data?: SplatData | null;
  renderer: SplatRenderer | null;
  failed: boolean;
}

/** Loads, caches, and renders `splatUrl` traits for one viewer. */
export class XRSplatLoader {
  private readonly entries = new Map<object, SplatEntry>();

  constructor(private readonly fetchFn: typeof fetch = (u, i) => fetch(u, i)) {}

  /** Starts loads for new `splatUrl` traits and drops removed ones. */
  sync(viewer: PluginViewer): void {
    const gl = viewer.gl;
    const meshes = viewer.meshes ?? [];
    const live = new Set<object>();
    const allowRemote = Boolean(
      viewer.container?.hasAttribute?.('allow-remote-splats'),
    );
    for (const mesh of meshes) {
      const raw = getMeshXRTraits(mesh)?.splatUrl;
      if (!raw) continue;
      const url = resolveSplatUrl(raw, undefined, allowRemote);
      if (!url || !mesh?.transform) continue;
      live.add(mesh);
      const existing = this.entries.get(mesh);
      if (existing?.url === url) continue;
      const prevData = existing?.data ?? existing?.renderer?.data;
      if (prevData) {
        getSharedRegistry().splatAccelerator?.disposeCloud?.(prevData);
      }
      existing?.renderer?.dispose();
      const entry: SplatEntry = {url, data: null, renderer: null, failed: false};
      this.entries.set(mesh, entry);
      if (!gl) continue;
      loadSplat(url, this.fetchFn, allowRemote).then(
        (data) => {
          if (this.entries.get(mesh) === entry) {
            entry.data = data;
            if (!getSharedRegistry().splatAccelerator) {
              entry.renderer = new SplatRenderer(gl, data);
            }
          }
        },
        () => {
          entry.failed = true;
        },
      );
    }
    for (const [mesh, entry] of [...this.entries]) {
      if (live.has(mesh)) continue;
      const prevData = entry.data ?? entry.renderer?.data;
      if (prevData) {
        getSharedRegistry().splatAccelerator?.disposeCloud?.(prevData);
      }
      entry.renderer?.dispose();
      this.entries.delete(mesh);
    }
  }

  /** Draws every loaded splat cloud. */
  draw(
    viewer: PluginViewer,
    vp: Float32Array,
    eye: 'left' | 'right' | 'none' = 'none',
    viewport?: readonly number[],
    projection?: Float32Array,
  ): void {
    const gl = viewer.gl;
    if (!gl) return;
    const accel = getSharedRegistry().splatAccelerator;
    if (this.entries.size === 0) {
      accel?.beginFrame?.(viewer);
      accel?.endFrame?.(viewer);
      return;
    }
    accel?.beginFrame?.(viewer);
    try {
      // Per-eye viewport and projection while presenting; desktop otherwise.
      const widthPx = viewport?.[2] ?? gl.drawingBufferWidth;
      const heightPx = viewport?.[3] ?? gl.drawingBufferHeight;
      const proj = projection ?? resolveProjection(viewer);
      const focalPx = (Math.abs(proj?.[5] ?? 1.7) * heightPx) / 2;
      const focalXPx = proj?.[0] ? (Math.abs(proj[0]) * widthPx) / 2 : focalPx;
      const model = new Float32Array(16);
      const mvp = accel ? new Float32Array(16) : null;
      // Covariance must be projected with the view actually being drawn (per-eye
      // in WebXR / stereo), not the desktop orbit camera.
      const view = viewer.activeViewMatrix ?? viewer.viewMatrix;
      const modelView = view ? new Float32Array(16) : null;
      const cameraPos = frameEye.get(viewer) ?? null;
      for (const [mesh, entry] of this.entries) {
        const data = entry.data ?? entry.renderer?.data ?? null;
        if (
          !data ||
          data.count === 0 ||
          (mesh as {visible?: boolean}).visible === false
        ) {
          continue;
        }
        const transform = (mesh as {transform: Float32Array}).transform;
        if (viewer.modelRootMatrix) {
          mat4Multiply(model, viewer.modelRootMatrix, transform);
        } else {
          model.set(transform);
        }
        if (modelView && view) {
          mat4Multiply(modelView, view, model);
        }
        const traits = getMeshXRTraits(mesh) as {splatQuality?: string} | null;
        const highQualitySH =
          traits?.splatQuality === 'high' ||
          viewer.container?.getAttribute?.('splat-quality') === 'high';
        let accelOut: SplatGPUFrameOutput | null = null;
        if (accel && mvp) {
          mat4Multiply(mvp, vp, model);
          const res = accel.drawCloud({
            viewer,
            mesh,
            data,
            vp,
            mvp,
            model,
            modelView,
            cameraPos,
            focalX: focalXPx,
            focalY: focalPx,
            viewportWidth: widthPx,
            viewportHeight: heightPx,
            highQualitySH,
            eye,
          });
          if (res === 'rendered') continue;
          accelOut = res;
        }
        if (!entry.renderer) {
          entry.renderer = new SplatRenderer(gl, data);
        }
        entry.renderer.draw(
          vp,
          model,
          focalPx,
          modelView,
          cameraPos,
          highQualitySH,
          eye,
          accelOut,
        );
      }
    } finally {
      accel?.endFrame?.(viewer);
    }
  }

  /** Disposes every renderer. */
  dispose(): void {
    const accel = getSharedRegistry().splatAccelerator;
    for (const e of this.entries.values()) {
      const d = e.data ?? e.renderer?.data;
      if (d) accel?.disposeCloud?.(d);
      e.renderer?.dispose();
    }
    this.entries.clear();
  }
}

const loaders = new WeakMap<object, XRSplatLoader>();
/** Eye position of the view being drawn, captured in `onBeforeDrawScene`. */
const frameEye = new WeakMap<object, [number, number, number]>();

/** Records the active world-space camera position for `viewer`'s splat SH pass. */
export function setSplatViewerEye(
  viewer: object,
  cameraPos: readonly [number, number, number],
): void {
  frameEye.set(viewer, [cameraPos[0], cameraPos[1], cameraPos[2]]);
}

/** Returns (creating on first use) the splat loader for `viewer`. */
export function getSplatLoader(viewer: object): XRSplatLoader {
  let l = loaders.get(viewer);
  if (!l) {
    l = new XRSplatLoader();
    loaders.set(viewer, l);
  }
  return l;
}

/** `ThreeLivePlugin` that renders `splatUrl` traits after the main pass. */
export const splatLoaderPlugin: ThreeLivePlugin = {
  name: 'xr-live-splat-loader',
  onClearScene(viewer: PluginViewer): void {
    if (viewer) {
      loaders.get(viewer)?.sync(viewer);
      getSharedRegistry().splatAccelerator?.hideOverlay?.(viewer);
    }
  },
  onUpdate(viewer: PluginViewer): void {
    if (viewer && Array.isArray(viewer.meshes)) {
      getSplatLoader(viewer).sync(viewer);
    }
  },
  onXRFrame(
    viewer: unknown,
    _session: unknown,
    frame: unknown,
    refSpace: unknown,
  ): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    if (v && Array.isArray(v.meshes)) getSplatLoader(v).sync(v);
  },
  onBeforeDrawScene(
    viewer: PluginViewer,
    _gl: WebGL2RenderingContext,
    _vp: Float32Array,
    cameraPos: [number, number, number],
  ): void {
    if (viewer) {
      if (cameraPos) {
        frameEye.set(viewer, [cameraPos[0], cameraPos[1], cameraPos[2]]);
      }
      getSharedRegistry().splatAccelerator?.beginFrame?.(viewer);
    }
  },
  onAfterRender(
    _gl: WebGL2RenderingContext,
    viewer: PluginViewer,
    vpMatrix: Float32Array,
    eye?: 'left' | 'right' | 'none',
    viewport?: readonly number[],
    projection?: Float32Array,
  ): void {
    const l = loaders.get(viewer);
    if (l) {
      l.draw(viewer, vpMatrix, eye, viewport, projection);
    } else if (viewer) {
      const accel = getSharedRegistry().splatAccelerator;
      accel?.beginFrame?.(viewer);
      accel?.endFrame?.(viewer);
    }
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    loaders.get(viewer)?.dispose();
    loaders.delete(viewer);
    if (viewer) getSharedRegistry().splatAccelerator?.disposeViewer?.(viewer);
  },
};
