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

import {mat4Multiply} from '../../../three-live/src/math';
import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
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
}

function allocate(count: number): SplatData {
  return {
    count,
    positions: new Float32Array(count * 3),
    scales: new Float32Array(count * 3),
    colors: new Uint8Array(count * 4),
    rotations: new Float32Array(count * 4),
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
    const q = (j: number): number => (bytes[b + 28 + j] - 128) / 128;
    out.rotations.set([q(1), q(2), q(3), q(0)], i * 4);
    normalizeQuat(out.rotations, i * 4);
  }
  return out;
}

/** Decompresses gzip data with `DecompressionStream`, enforcing a size cap. */
export async function gunzip(bytes: Uint8Array, maxBytes = MAX_SPZ_DECOMPRESSED_BYTES): Promise<Uint8Array> {
  const DS = (globalThis as {DecompressionStream?: typeof DecompressionStream}).DecompressionStream;
  if (typeof DS !== 'function') throw new Error('splat-loader: DecompressionStream unavailable');
  const stream = new Blob([bytes]).stream().pipeThrough(new DS('gzip'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('splat-loader: decompressed .spz exceeds size limit');
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

/**
 * Parses a decompressed `.spz` payload (versions 2 and 3). Layout: 16-byte
 * header, then SoA blocks of 24-bit fixed-point positions, alphas, colors
 * (SH DC), log scales, and rotations (3-byte xyz for v2, 4-byte
 * smallest-three for v3). Spherical-harmonic bands are ignored.
 */
export function parseSpzPayload(bytes: Uint8Array): SplatData {
  if (bytes.byteLength < 16) throw new Error('splat-loader: .spz header truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== SPZ_MAGIC) throw new Error('splat-loader: bad .spz magic');
  const version = view.getUint32(4, true);
  if (version !== 2 && version !== 3) throw new Error(`splat-loader: unsupported .spz version ${version}`);
  const count = view.getUint32(8, true);
  if (count > MAX_SPLATS) throw new Error('splat-loader: too many splats');
  const fractionalBits = bytes[13];
  if (fractionalBits > 24) throw new Error('splat-loader: invalid .spz fractional bits');
  const rotBytes = version === 3 ? 4 : 3;
  const needed = 16 + count * (9 + 1 + 3 + 3 + rotBytes);
  if (bytes.byteLength < needed) throw new Error('splat-loader: .spz payload truncated');
  const out = allocate(count);
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
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      const dc = (bytes[colorStart + i * 3 + k] / 255 - 0.5) / 0.15;
      out.colors[i * 4 + k] = Math.max(0, Math.min(255, Math.round((0.5 + SH_C0 * dc) * 255)));
      out.scales[i * 3 + k] = Math.exp(bytes[scaleStart + i * 3 + k] / 16 - 10);
    }
    out.colors[i * 4 + 3] = bytes[alphaStart + i];
    const r = rotStart + i * rotBytes;
    if (version === 2) {
      const x = bytes[r] / 127.5 - 1;
      const y = bytes[r + 1] / 127.5 - 1;
      const z = bytes[r + 2] / 127.5 - 1;
      out.rotations.set([x, y, z, Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z))], i * 4);
    } else {
      let comp = (bytes[r] | (bytes[r + 1] << 8) | (bytes[r + 2] << 16) | (bytes[r + 3] << 24)) >>> 0;
      const largest = comp >>> 30;
      const q = [0, 0, 0, 0];
      let sum = 0;
      for (let k = 3; k >= 0; k--) {
        if (k === largest) continue;
        const mag = comp & 511;
        const neg = (comp >>> 9) & 1;
        comp >>>= 10;
        q[k] = (Math.SQRT1_2 * mag) / 511 * (neg ? -1 : 1);
        sum += q[k] * q[k];
      }
      q[largest] = Math.sqrt(Math.max(0, 1 - sum));
      out.rotations.set(q, i * 4);
    }
    normalizeQuat(out.rotations, i * 4);
  }
  return out;
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
      base ?? (typeof document !== 'undefined' ? document.baseURI : 'https://localhost/');
    const url = new URL(raw.trim(), fallbackBase);
    const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    const schemeOk =
      url.protocol === 'https:' || url.protocol === 'blob:' || (url.protocol === 'http:' && loopback);
    if (!schemeOk) return null;
    if (!allowCrossOrigin && url.protocol !== 'blob:' && url.origin !== new URL(fallbackBase).origin) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

/** Reads a response body with a running byte cap (no Content-Length needed). */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error('splat-loader: file too large');
    return buf;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('splat-loader: file too large');
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
  if (declared > MAX_SPLAT_FILE_BYTES) throw new Error('splat-loader: file too large');
  const buf = await readCapped(res, MAX_SPLAT_FILE_BYTES);
  const isSpz =
    /\.spz(\?|#|$)/i.test(new URL(resolved).pathname) ||
    (buf[0] === 0x1f && buf[1] === 0x8b) ||
    (buf.byteLength >= 4 && new DataView(buf.buffer).getUint32(0, true) === SPZ_MAGIC);
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
 * views) with a single-pass 16-bit counting sort.
 */
export function sortSplatsByDepth(
  data: Pick<SplatData, 'count' | 'positions'>,
  mvp: ArrayLike<number>,
  out: Uint32Array = new Uint32Array(data.count),
  scratch: SplatSortScratch = createSplatSortScratch(data.count),
): Uint32Array {
  const n = data.count;
  const p = data.positions;
  const {depths, keys, counts} = scratch;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const w = mvp[3] * p[i * 3] + mvp[7] * p[i * 3 + 1] + mvp[11] * p[i * 3 + 2] + mvp[15];
    depths[i] = w;
    if (w < min) min = w;
    if (w > max) max = w;
  }
  const buckets = 65536;
  counts.fill(0);
  const range = max - min || 1;
  for (let i = 0; i < n; i++) {
    // Largest w (farthest) gets key 0 so it is drawn first.
    const k = Math.min(buckets - 1, Math.floor(((max - depths[i]) / range) * (buckets - 1)));
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
uniform mat4 uMVP;
uniform float uFocalPx;
out vec4 vColor;
void main(){
vec4 c=uMVP*vec4(aPos,1.0);
gl_Position=c;
gl_PointSize=clamp(3.0*aRadius*uFocalPx/max(c.w,1e-3),1.0,256.0);
vColor=aColor;
}`;
const FS = `#version 300 es
precision mediump float;
in vec4 vColor;
out vec4 o;
void main(){
vec2 d=gl_PointCoord*2.0-1.0;
float r=dot(d,d);
if(r>1.0)discard;
float a=vColor.a*exp(-4.0*r);
o=vec4(vColor.rgb*a,a);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/** Uploads a splat cloud and draws it as sorted Gaussian point sprites. */
export class SplatRenderer {
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private readonly buffers: WebGLBuffer[] = [];
  private indexBuffer: WebGLBuffer | null = null;
  private uMVP: WebGLUniformLocation | null = null;
  private uFocal: WebGLUniformLocation | null = null;
  private order: Uint32Array;
  private readonly scratch: SplatSortScratch;
  private readonly mvp = new Float32Array(16);
  private framesSinceSort = Infinity;

  constructor(private readonly gl: WebGL2RenderingContext, readonly data: SplatData) {
    this.order = new Uint32Array(data.count);
    this.scratch = createSplatSortScratch(data.count);
    const vs = compile(gl, gl.VERTEX_SHADER, VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      return;
    }
    this.program = prog;
    this.uMVP = gl.getUniformLocation(prog, 'uMVP');
    this.uFocal = gl.getUniformLocation(prog, 'uFocalPx');
    const radii = new Float32Array(data.count);
    for (let i = 0; i < data.count; i++) {
      radii[i] = Math.max(data.scales[i * 3], data.scales[i * 3 + 1], data.scales[i * 3 + 2]);
    }
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attrib = (loc: number, arr: ArrayBufferView, size: number, type: number, norm: boolean): void => {
      const b = gl.createBuffer();
      if (!b) return;
      this.buffers.push(b);
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, type, norm, 0, 0);
    };
    attrib(0, data.positions, 3, gl.FLOAT, false);
    attrib(1, data.colors, 4, gl.UNSIGNED_BYTE, true);
    attrib(2, radii, 1, gl.FLOAT, false);
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.order.byteLength, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }

  /**
   * Draws the cloud with world matrix `model` (re-sorting every 4th frame).
   * Leaves the program, VAO, blend, and depth-mask state as the main renderer
   * expects: no VAO bound, blending disabled, depth writes enabled.
   */
  draw(vp: Float32Array, model: Float32Array, focalPx: number): void {
    const gl = this.gl;
    if (!this.program || !this.vao || !this.indexBuffer || this.data.count === 0) return;
    const mvp = this.mvp;
    mat4Multiply(mvp, vp, model);
    // Bind our VAO *before* touching ELEMENT_ARRAY_BUFFER: that binding is VAO
    // state, and the renderer leaves its last mesh VAO bound.
    gl.bindVertexArray(this.vao);
    if (++this.framesSinceSort >= 4) {
      sortSplatsByDepth(this.data, mvp, this.order, this.scratch);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.order);
      this.framesSinceSort = 0;
    }
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uMVP, false, mvp);
    gl.uniform1f(this.uFocal, focalPx);
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
    for (const b of this.buffers) gl.deleteBuffer(b);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
    this.vao = null;
  }
}

interface SplatEntry {
  readonly url: string;
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
    const allowRemote = Boolean(viewer.container?.hasAttribute?.('allow-remote-splats'));
    for (const mesh of meshes) {
      const raw = getMeshXRTraits(mesh)?.splatUrl;
      if (!raw) continue;
      const url = resolveSplatUrl(raw, undefined, allowRemote);
      if (!url || !mesh?.transform) continue;
      live.add(mesh);
      const existing = this.entries.get(mesh);
      if (existing?.url === url) continue;
      existing?.renderer?.dispose();
      const entry: SplatEntry = {url, renderer: null, failed: false};
      this.entries.set(mesh, entry);
      if (!gl) continue;
      loadSplat(url, this.fetchFn, allowRemote).then(
        (data) => {
          if (this.entries.get(mesh) === entry) entry.renderer = new SplatRenderer(gl, data);
        },
        () => {
          entry.failed = true;
        },
      );
    }
    for (const [mesh, entry] of [...this.entries]) {
      if (live.has(mesh)) continue;
      entry.renderer?.dispose();
      this.entries.delete(mesh);
    }
  }

  /** Draws every loaded splat cloud. */
  draw(viewer: PluginViewer, vp: Float32Array): void {
    const gl = viewer.gl;
    if (!gl || this.entries.size === 0) return;
    // Per-eye viewport and projection while presenting; desktop otherwise.
    const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array | null;
    const heightPx = viewport?.[3] || gl.drawingBufferHeight;
    const focalPx = ((resolveProjection(viewer)?.[5] ?? 1.7) * heightPx) / 2;
    const model = new Float32Array(16);
    for (const [mesh, entry] of this.entries) {
      if (!entry.renderer || (mesh as {visible?: boolean}).visible === false) continue;
      const transform = (mesh as {transform: Float32Array}).transform;
      if (viewer.modelRootMatrix) {
        mat4Multiply(model, viewer.modelRootMatrix, transform);
      } else {
        model.set(transform);
      }
      entry.renderer.draw(vp, model, focalPx);
    }
  }

  /** Disposes every renderer. */
  dispose(): void {
    for (const e of this.entries.values()) e.renderer?.dispose();
    this.entries.clear();
  }
}

const loaders = new WeakMap<object, XRSplatLoader>();

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
  onUpdate(viewer: PluginViewer): void {
    if (viewer && Array.isArray(viewer.meshes)) getSplatLoader(viewer).sync(viewer);
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    if (v && Array.isArray(v.meshes)) getSplatLoader(v).sync(v);
  },
  onAfterRender(_gl: WebGL2RenderingContext, viewer: PluginViewer, vpMatrix: Float32Array): void {
    loaders.get(viewer)?.draw(viewer, vpMatrix);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    loaders.get(viewer)?.dispose();
    loaders.delete(viewer);
  },
};
