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
 * @fileoverview Shared helpers for the optional `<xr-live>` spatial plugins
 * (`xr-live/src/plugins/*`): vector math, head-pose resolution, local bounds,
 * and dynamic (CPU-generated) GPU mesh upload / update / disposal.
 */

import {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Invert,
  mat4Multiply,
  type RayHit,
  rayIntersectsTriangle,
} from '../../../three-live/src/math';
import {clampNum, isFiniteVec3} from '../../../three-live/src/xr-trait-schema';
import {
  extractPosition,
  extractQuaternion,
  type XRPose6DoF,
} from '../xr-traits';

/** Mutable 3-component vector. */
export type Vec3 = [number, number, number];
/** Mutable unit quaternion `[x, y, z, w]`. */
export type Quat = [number, number, number, number];

/** Returns `a + b`. */
export function vAdd(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Returns `a - b`. */
export function vSub(a: readonly number[], b: readonly number[]): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Returns `a * s`. */
export function vScale(a: readonly number[], s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Returns the dot product of `a` and `b`. */
export function vDot(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Returns the cross product `a x b`. */
export function vCross(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Returns the Euclidean length of `a`. */
export function vLen(a: readonly number[]): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Returns `a` normalized, or `fallback` when `a` is (near) zero length. */
export function vNorm(a: readonly number[], fallback: Vec3 = [0, 0, -1]): Vec3 {
  const len = vLen(a);
  return len > 1e-8 ? [a[0] / len, a[1] / len, a[2] / len] : [...fallback];
}

export {clampNum, isFiniteVec3};

/** Returns the yaw (rotation about +Y, radians) of quaternion `q`. */
export function yawFromQuat(q: readonly number[]): number {
  return Math.atan2(
    2 * (q[3] * q[1] + q[0] * q[2]),
    1 - 2 * (q[1] * q[1] + q[0] * q[0]),
  );
}

/** Returns the horizontal (XZ-plane) forward vector for quaternion `q`. */
export function horizontalForward(q: readonly number[]): Vec3 {
  const yaw = yawFromQuat(q);
  return [-Math.sin(yaw), 0, -Math.cos(yaw)];
}

/** Returns a quaternion rotating `angle` radians about +Y. */
export function quatFromYaw(angle: number): Quat {
  return [0, Math.sin(angle * 0.5), 0, Math.cos(angle * 0.5)];
}

/** Returns the Hamilton product `a * b`. */
export function quatMultiply(a: readonly number[], b: readonly number[]): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Minimal duck-typed view of the `<three-live>` GPU viewer used by plugins. */
export interface PluginViewer {
  /** Shared renderer accepts per-instance translations at attribute 3. */
  readonly supportsInstanceOffsets?: boolean;
  gl?: WebGL2RenderingContext;
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  meshes?: any[];
  // tslint:disable-next-line:no-any Host element is `<xr-live>` or `<three-live>`.
  container?: any;
  viewMatrix?: Float32Array;
  /**
   * View matrix of the pass currently being rendered (per-eye in WebXR or
   * side-by-side stereo); equals `viewMatrix` on desktop.
   */
  activeViewMatrix?: Float32Array | null;
  projMatrix?: Float32Array;
  /** Root placement matrix applied to every mesh transform when drawing. */
  modelRootMatrix?: Float32Array;
  /** True while an immersive WebXR session is rendering this viewer. */
  xrSessionActive?: boolean;
  /**
   * Optional world-space rig transform `three-xr` pre-multiplies onto the AR
   * placement each WebXR frame (owned by `spatial-locomotion`).
   */
  xrRigMatrix?: Float32Array | null;
}

const DEFAULT_HEAD: Vec3 = [0, 1.6, 0];

/**
 * Resolves the current head (camera) pose for a viewer. Prefers the active
 * `<xr-live>` desktop simulator, then the viewer's camera view matrix, and
 * finally a standing default at 1.6 m.
 */
export function resolveHeadPose(viewer: PluginViewer | undefined): XRPose6DoF {
  const xr = viewer ? xrFrameCache.get(viewer) : undefined;
  if (xr && isXRFrameFresh(viewer)) return xr.head;
  const sim = viewer?.container?.simulator;
  if (sim?.active && typeof sim.getHeadPose === 'function') {
    return sim.getHeadPose();
  }
  const view = viewer?.viewMatrix;
  if (
    view &&
    view.length === 16 &&
    view.some((v, i) => v !== (i % 5 ? 0 : 1))
  ) {
    const world = mat4Create();
    mat4Invert(world, view);
    return {
      position: extractPosition(world),
      quaternion: extractQuaternion(world),
      matrix: world,
    };
  }
  if (sim && typeof sim.getHeadPose === 'function') {
    return sim.getHeadPose();
  }
  const matrix = mat4Create();
  mat4FromRotationTranslationScale(
    matrix,
    [0, 0, 0, 1],
    DEFAULT_HEAD,
    [1, 1, 1],
  );
  return {position: [...DEFAULT_HEAD], quaternion: [0, 0, 0, 1], matrix};
}

interface XRFrameSnapshot {
  head: XRPose6DoF;
  proj: Float32Array | null;
  time: number;
}

const xrFrameCache = new WeakMap<object, XRFrameSnapshot>();
const XR_FRAME_FRESH_MS = 150;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Caches the immersive viewer pose and first-view projection for the current
 * `XRFrame`, so plugins use the headset camera rather than the desktop orbit
 * camera while a WebXR session is presenting.
 */
export function cacheXRFrame(
  viewer: PluginViewer,
  // tslint:disable-next-line:no-any WebXR types are not in the TS lib target.
  frame: any,
  refSpace: unknown,
): void {
  try {
    const pose = frame?.getViewerPose?.(refSpace);
    const m = pose?.transform?.matrix;
    if (!m || m.length !== 16) return;
    const matrix = new Float32Array(m);
    const proj = pose.views?.[0]?.projectionMatrix;
    xrFrameCache.set(viewer, {
      head: {
        position: extractPosition(matrix),
        quaternion: extractQuaternion(matrix),
        matrix,
      },
      proj: proj && proj.length === 16 ? new Float32Array(proj) : null,
      time: nowMs(),
    });
  } catch {
    // Inactive frames throw; keep the previous snapshot.
  }
}

/** Returns true while an XR frame was cached within the last few frames. */
export function isXRFrameFresh(viewer: PluginViewer | undefined): boolean {
  const xr = viewer ? xrFrameCache.get(viewer) : undefined;
  return Boolean(xr && nowMs() - xr.time < XR_FRAME_FRESH_MS);
}

/** Returns the active projection (headset view 0 when presenting). */
export function resolveProjection(
  viewer: PluginViewer | undefined,
): Float32Array | undefined {
  const xr = viewer ? xrFrameCache.get(viewer) : undefined;
  if (xr?.proj && isXRFrameFresh(viewer)) return xr.proj;
  return viewer?.projMatrix;
}

const claimedEvents = new WeakSet<object>();

/** Marks an input event as consumed so lower-priority plugins skip it. */
export function claimEvent(e: object): void {
  claimedEvents.add(e);
}

/** Returns whether a higher-priority plugin already consumed `e`. */
export function isEventClaimed(e: object): boolean {
  return claimedEvents.has(e);
}

/** Normalizes a ray direction, returning `null` for zero/non-finite input. */
export function normalizeRayDir(dir: readonly number[]): Vec3 | null {
  const len = vLen(dir);
  return Number.isFinite(len) && len > 1e-8
    ? [dir[0] / len, dir[1] / len, dir[2] / len]
    : null;
}

const IDENTITY = mat4Create();

/** Returns the viewer's model-root placement matrix (identity if unset). */
export function rootMatrix(viewer: PluginViewer | undefined): Float32Array {
  const m = viewer?.modelRootMatrix;
  return m && m.length === 16 ? m : IDENTITY;
}

/** Inverse of {@link rootMatrix} (world -> scene-local), or identity. */
export function inverseRootMatrix(
  viewer: PluginViewer | undefined,
): Float32Array {
  const root = rootMatrix(viewer);
  const out = mat4Create();
  if (root === IDENTITY || !mat4Invert(out, root)) return mat4Create();
  return out;
}

const lastFrameTimes = new WeakMap<object, number>();

/**
 * Measures real elapsed seconds between successive calls for `key`, clamped to
 * `[1/240, 0.1]`. WebXR frame rates vary (72/90/120 Hz), so timers such as
 * dwell progress must not assume a fixed per-frame step.
 */
export function measureFrameDt(key: object, fallback = 1 / 72): number {
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const prev = lastFrameTimes.get(key);
  lastFrameTimes.set(key, now);
  if (prev === undefined) return fallback;
  const dt = (now - prev) / 1000;
  return Number.isFinite(dt) ? Math.min(0.1, Math.max(1 / 240, dt)) : fallback;
}

/** Returns `modelRootMatrix * mesh.transform` (the mesh's drawn world matrix). */
// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
export function meshWorldMatrix(
  viewer: PluginViewer | undefined,
  mesh: any,
): Float32Array {
  const out = mat4Create();
  mat4Multiply(out, rootMatrix(viewer), mesh.transform);
  return out;
}

/** Writes a local-space TRS directly into `mesh.transform`. */
export function setLocalTRS(
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
  quat: readonly number[],
  pos: readonly number[],
  scale: readonly number[],
): void {
  if (!(mesh?.transform instanceof Float32Array)) return;
  mat4FromRotationTranslationScale(
    mesh.transform,
    quat as Quat,
    pos as Vec3,
    scale as Vec3,
  );
  if (mesh.worldMatrix instanceof Float32Array) {
    mesh.worldMatrix.set(mesh.transform);
  }
}

/**
 * Writes a world-space TRS into `mesh.transform`, compensating for the
 * viewer's `modelRootMatrix` (AR placement / turntable) so the mesh is drawn
 * exactly at the requested world pose.
 */
export function setWorldTRS(
  viewer: PluginViewer | undefined,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
  quat: readonly number[],
  pos: readonly number[],
  scale: readonly number[],
): void {
  const world =
    mesh.worldMatrix instanceof Float32Array ? mesh.worldMatrix : mat4Create();
  mat4FromRotationTranslationScale(
    world,
    quat as Quat,
    pos as Vec3,
    scale as Vec3,
  );
  mesh.worldMatrix = world;
  applyWorldMatrix(viewer, mesh);
}

/** Re-derives `mesh.transform = inverse(root) * mesh.worldMatrix`. */
// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
export function applyWorldMatrix(
  viewer: PluginViewer | undefined,
  mesh: any,
): void {
  if (!(mesh?.worldMatrix instanceof Float32Array)) return;
  const root = rootMatrix(viewer);
  if (root === IDENTITY || isIdentity(root)) {
    mesh.transform.set(mesh.worldMatrix);
  } else {
    const inv = mat4Create();
    mat4Invert(inv, root);
    mat4Multiply(mesh.transform, inv, mesh.worldMatrix);
  }
  if (mesh.normalMatrix) mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
}

function isIdentity(m: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) if (m[i] !== (i % 5 === 0 ? 1 : 0)) return false;
  return true;
}

/** Axis-aligned bounds in mesh-local space. */
export interface LocalBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Computes the local-space AABB across every primitive of a GPU mesh record.
 * Returns a unit cube centered on the origin when no CPU positions exist.
 */
// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
export function computeLocalBounds(mesh: any): LocalBounds {
  const key = mesh?.primitives?.[0]?.positions;
  const cached = key ? boundsCache.get(key) : undefined;
  if (cached && cached.prims === mesh.primitives.length) return cached.bounds;
  const bounds = scanLocalBounds(mesh);
  if (key) boundsCache.set(key, {prims: mesh.primitives.length, bounds});
  return bounds;
}

const boundsCache = new WeakMap<object, {prims: number; bounds: LocalBounds}>();

// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
function scanLocalBounds(mesh: any): LocalBounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh?.primitives ?? []) {
    const p: ArrayLike<number> | undefined = prim?.positions;
    if (!p) continue;
    for (let i = 0; i + 2 < p.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        const v = p[i + a];
        if (!Number.isFinite(v)) continue;
        if (v < min[a]) min[a] = v;
        if (v > max[a]) max[a] = v;
      }
    }
  }
  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) {
    return {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5]};
  }
  return {min, max};
}

/** Transforms point `p` by column-major 4x4 matrix `m`. */
export function transformPoint(
  m: ArrayLike<number>,
  p: readonly number[],
): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

/** CPU geometry for a dynamic plugin mesh. */
export interface DynamicGeometry {
  /** Per-instance translations. Requires `supportsInstanceOffsets`. */
  readonly translations?: Float32Array;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint16Array | Uint32Array;
}

/** Options for {@link createDynamicMesh}. */
export interface DynamicMeshOptions {
  readonly name: string;
  readonly color?: readonly [number, number, number, number];
  readonly roughness?: number;
  readonly metallic?: number;
  /** Excludes the mesh from ray hit-testing (e.g. particles, reticles). */
  readonly pickable?: boolean;
  /**
   * Treats vertex positions as world space: `mesh.worldMatrix` starts as
   * identity and `applyWorldMatrix` cancels the viewer's `modelRootMatrix`.
   */
  readonly worldSpace?: boolean;
  // tslint:disable-next-line:no-any Arbitrary JSON-like trait bag.
  readonly xr?: Record<string, any>;
}

const STATIC_DRAW = 35044;
const DYNAMIC_DRAW = 35048;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

function uploadBuffers(
  gl: WebGL2RenderingContext,
  geometry: DynamicGeometry,
  usage: number,
  existing?: {vao: WebGLVertexArrayObject; buffers: WebGLBuffer[]},
): {vao: WebGLVertexArrayObject | null; buffers: WebGLBuffer[]} {
  const vao = existing?.vao ?? gl.createVertexArray();
  if (!vao) throw new Error('Dynamic mesh allocation failed');
  const buffers: WebGLBuffer[] = existing?.buffers ?? [];
  const data = [geometry.positions, geometry.normals,
    new Float32Array(geometry.positions.length / 3 * 2), geometry.indices];
  if (geometry.translations) data.push(geometry.translations);
  gl.bindVertexArray(vao);
  for (let i = 0; i < data.length; i++) {
    const buffer = buffers[i] ?? gl.createBuffer();
    if (!buffer) {
      releaseBuffers(gl, {buffers, vao});
      gl.bindVertexArray(null);
      throw new Error('Dynamic mesh allocation failed');
    }
    buffers[i] = buffer;
    const target = i === 3 ? ELEMENT_ARRAY_BUFFER : ARRAY_BUFFER;
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data[i], existing || i === 4 ? DYNAMIC_DRAW : geometry.translations ? STATIC_DRAW : usage);
    if (i !== 3) {
      const location = i === 4 ? 3 : i;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, i === 2 ? 2 : 3, FLOAT, false, 0, 0);
      if (i === 4) gl.vertexAttribDivisor(location, 1);
    }
  }
  gl.bindVertexArray(null);
  return {vao, buffers};
}

function releaseBuffers(
  gl: WebGL2RenderingContext | undefined,
  // tslint:disable-next-line:no-any Primitive GPU struct.
  prim: any,
): void {
  if (!gl || !prim) return;
  for (const b of prim.buffers ?? []) gl.deleteBuffer?.(b);
  if (prim.vao) gl.deleteVertexArray?.(prim.vao);
  prim.buffers = [];
  prim.vao = null;
}

/**
 * Creates a CPU-generated mesh record compatible with the `<three-live>` GPU
 * renderer and appends it to `viewer.meshes`. Works headlessly (no `gl`) so the
 * geometry can still be hit-tested and exported in Node tests.
 */
export function createDynamicMesh(
  viewer: PluginViewer,
  geometry: DynamicGeometry,
  options: DynamicMeshOptions,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
): any {
  const gl = viewer.gl;
  const uploaded =
    gl && typeof gl.createVertexArray === 'function'
      ? uploadBuffers(
          gl,
          geometry,
          options.pickable === false ? DYNAMIC_DRAW : STATIC_DRAW,
        )
      : {vao: null, buffers: []};
  const transform = mat4Create();
  const normalMatrix = new Float32Array(9);
  mat3NormalFromMat4(normalMatrix, transform);
  const xr = {...(options.xr ?? {})};
  if (options.pickable === false) xr['pointerEvents'] = 'none';
  const mesh = {
    name: options.name,
    nodeIndex: -1,
    visible: true,
    isPluginMesh: true,
    transform,
    normalMatrix,
    extras: {xr},
    userData: {xr},
    primitives: [
      {
        vao: uploaded.vao,
        ...dynamicGeometryProperties(geometry),
        baseColor: [...(options.color ?? [1, 1, 1, 1])],
        metallic: options.metallic ?? 0,
        roughness: options.roughness ?? 0.6,
        texture: null,
        metallicRoughnessTexture: null,
        normalTexture: null,
        occlusionTexture: null,
        normalScale: 1,
        occlusionStrength: 1,
        buffers: uploaded.buffers,
      },
    ],
  };
  if (Array.isArray(viewer.meshes)) viewer.meshes.push(mesh);
  if (options.worldSpace) {
    (mesh as {worldMatrix?: Float32Array}).worldMatrix = mat4Create();
    applyWorldMatrix(viewer, mesh);
  }
  return mesh;
}

/** Replaces a dynamic mesh's geometry, re-uploading GPU buffers if needed. */
export function updateDynamicMesh(
  viewer: PluginViewer,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
  geometry: DynamicGeometry,
): void {
  const prim = mesh?.primitives?.[0];
  if (!prim) return;
  const gl = viewer.gl;
  const reusable = prim.vao && prim.buffers?.length === (geometry.translations ? 5 : 4);
  if (!gl || !reusable) releaseBuffers(gl, prim);
  if (gl && (reusable || typeof gl.createVertexArray === 'function')) {
    Object.assign(prim, uploadBuffers(gl, geometry, DYNAMIC_DRAW, reusable ? prim : undefined));
  }
  Object.assign(prim, dynamicGeometryProperties(geometry));
  // Invalidate the ray-cast bounding sphere cached by `raycastGpuMeshes`.
  delete prim._boundingSphere;
}

/** CPU geometry and draw metadata shared by initial uploads and replacements. */
function dynamicGeometryProperties(geometry: DynamicGeometry) {
  return {
    positions: geometry.positions,
    normals: geometry.normals,
    indices: geometry.indices,
    translations: geometry.translations,
    instanceCount: geometry.translations ? geometry.translations.length / 3 : undefined,
    indexCount: geometry.indices.length,
    indexType: geometry.indices instanceof Uint32Array ? UNSIGNED_INT : UNSIGNED_SHORT,
  };
}

/** Removes a dynamic mesh from `viewer.meshes` and frees its GPU buffers. */
export function removeDynamicMesh(
  viewer: PluginViewer | undefined,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
): void {
  if (!mesh) return;
  for (const prim of mesh.primitives ?? []) releaseBuffers(viewer?.gl, prim);
  const list = viewer?.meshes;
  if (Array.isArray(list)) {
    const i = list.indexOf(mesh);
    if (i >= 0) list.splice(i, 1);
  }
}

/** Sets a mesh's world TRS and refreshes its normal matrix. */
export function setMeshTRS(
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
  quat: readonly number[],
  pos: readonly number[],
  scale: readonly number[],
): void {
  mat4FromRotationTranslationScale(
    mesh.transform,
    quat as Quat,
    pos as Vec3,
    scale as Vec3,
  );
  if (mesh.normalMatrix) mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
}

/** Generates an axis-aligned box of half-extent `h` centered on the origin. */
export function buildBoxGeometry(h: number): DynamicGeometry {
  const faces: Array<[Vec3, Vec3, Vec3]> = [
    [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    [
      [-1, 0, 0],
      [0, 1, 0],
      [0, 0, -1],
    ],
    [
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ],
    [
      [0, -1, 0],
      [0, 0, -1],
      [1, 0, 0],
    ],
    [
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ],
    [
      [0, 0, -1],
      [-1, 0, 0],
      [0, 1, 0],
    ],
  ];
  const positions = new Float32Array(24 * 3);
  const normals = new Float32Array(24 * 3);
  const indices = new Uint16Array(36);
  faces.forEach(([n, u, v], f) => {
    const corners: Array<[number, number]> = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    corners.forEach(([a, b], c) => {
      const o = (f * 4 + c) * 3;
      for (let k = 0; k < 3; k++) {
        positions[o + k] = (n[k] + u[k] * a + v[k] * b) * h;
        normals[o + k] = n[k];
      }
    });
    const base = f * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], f * 6);
  });
  return {positions, normals, indices};
}

/** Dispatches a bubbling, composed `CustomEvent` on `target` when supported. */
export function emitPluginEvent(
  target: unknown,
  name: string,
  detail: unknown,
): void {
  const el = target as {dispatchEvent?: (e: Event) => boolean} | null;
  if (!el || typeof el.dispatchEvent !== 'function') return;
  if (typeof CustomEvent !== 'function') return;
  el.dispatchEvent(
    new CustomEvent(name, {bubbles: true, composed: true, detail}),
  );
}

/**
 * Re-uploads only positions (or instance centers) in place, keeping the same
 * count and avoiding VAO churn for per-frame animated geometry like particles.
 */
export function refreshDynamicPositions(
  viewer: PluginViewer,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
): void {
  const prim = mesh?.primitives?.[0];
  const gl = viewer.gl;
  if (!prim) return;
  delete prim._boundingSphere;
  const buf = prim.buffers?.[prim.translations ? 4 : 0];
  if (!gl || !buf || typeof gl.bufferSubData !== 'function') return;
  gl.bindBuffer(ARRAY_BUFFER, buf);
  gl.bufferSubData(ARRAY_BUFFER, 0, prim.translations ?? prim.positions);
}

/**
 * Re-creates GPU buffers for a dynamic mesh whose buffers were freed (e.g. by
 * a model reload) and re-appends it to `viewer.meshes` if it was detached.
 */
export function reattachDynamicMesh(
  viewer: PluginViewer,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  mesh: any,
): void {
  const prim = mesh?.primitives?.[0];
  if (!prim || !Array.isArray(viewer.meshes) || viewer.meshes.includes(mesh))
    return;
  prim.vao = null;
  prim.buffers = [];
  updateDynamicMesh(viewer, mesh, {
    translations: prim.translations,
    positions: prim.positions,
    normals: prim.normals,
    indices: prim.indices,
  });
  viewer.meshes.push(mesh);
  applyWorldMatrix(viewer, mesh);
}

/** Returns a unit quaternion rotating unit vector `from` onto unit vector `to`. */
export function quatFromUnitVectors(
  from: readonly number[],
  to: readonly number[],
): Quat {
  const f = vNorm(from, [0, 0, 1]);
  const t = vNorm(to, [0, 0, 1]);
  const dot = vDot(f, t);
  if (dot < -0.999999) {
    let axis = vCross([1, 0, 0], f);
    if (vLen(axis) < 1e-5) axis = vCross([0, 1, 0], f);
    const n = vNorm(axis, [0, 1, 0]);
    return [n[0], n[1], n[2], 0];
  }
  const c = vCross(f, t);
  const w = 1 + dot;
  const len = Math.hypot(c[0], c[1], c[2], w) || 1;
  return [c[0] / len, c[1] / len, c[2] / len, w / len];
}

/** World-space scene mesh raycast hit returned by {@link raycastSceneMeshes}. */
export interface SceneRaycastHit {
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  readonly mesh: any;
  readonly meshIndex: number;
  readonly distance: number;
  readonly point: Vec3;
  readonly normal: Vec3;
}

/**
 * Raycasts CPU-backed GPU meshes in `viewer.meshes` from world `origin` along
 * unit `direction` without pulling in `XRInputManager`.
 */
export function raycastSceneMeshes(
  viewer: PluginViewer | undefined,
  origin: readonly number[],
  direction: readonly number[],
  maxDistance = 50,
  // tslint:disable-next-line:no-any Mesh filter callback.
  filter?: (mesh: any, index: number) => boolean,
): SceneRaycastHit | null {
  const meshes = viewer?.meshes;
  const dir = normalizeRayDir(direction);
  if (!Array.isArray(meshes) || !dir || !origin.every(Number.isFinite))
    return null;

  const invModel = mat4Create();
  const normMat = new Float32Array(9);
  let best: SceneRaycastHit | null = null;
  let bestDist =
    Number.isFinite(maxDistance) && maxDistance > 0 ? maxDistance : 50;

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    if (!mesh || mesh.visible === false || mesh.isPluginMesh) continue;
    const pe =
      mesh.extras?.xr?.pointerEvents ?? mesh.userData?.xr?.pointerEvents;
    if (pe === 'none' && !filter) continue;
    if (filter && !filter(mesh, i)) continue;

    const worldMat = meshWorldMatrix(viewer, mesh);
    if (!mat4Invert(invModel, worldMat)) continue;

    const lo = transformPoint(invModel, origin);
    const ldRaw: Vec3 = [
      invModel[0] * dir[0] + invModel[4] * dir[1] + invModel[8] * dir[2],
      invModel[1] * dir[0] + invModel[5] * dir[1] + invModel[9] * dir[2],
      invModel[2] * dir[0] + invModel[6] * dir[1] + invModel[10] * dir[2],
    ];
    const ldLen = vLen(ldRaw);
    if (ldLen < 1e-8) continue;
    const ld = vScale(ldRaw, 1 / ldLen);

    // Quick local-space AABB slab reject before triangle loop.
    const lb = computeLocalBounds(mesh);
    let tMin = 0;
    let tMax = Infinity;
    let slabMiss = false;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(ld[a]) < 1e-8) {
        if (lo[a] < lb.min[a] - 1e-4 || lo[a] > lb.max[a] + 1e-4) {
          slabMiss = true;
          break;
        }
      } else {
        const invD = 1 / ld[a];
        let t1 = (lb.min[a] - lo[a]) * invD;
        let t2 = (lb.max[a] - lo[a]) * invD;
        if (t1 > t2) {
          const tmp = t1;
          t1 = t2;
          t2 = tmp;
        }
        if (t1 > tMin) tMin = t1;
        if (t2 < tMax) tMax = t2;
        if (tMin > tMax) {
          slabMiss = true;
          break;
        }
      }
    }
    if (slabMiss) continue;

    const outHit: RayHit = {
      distance: Infinity,
      point: [0, 0, 0],
      normal: [0, 1, 0],
    };
    for (const prim of mesh.primitives ?? []) {
      const pos: ArrayLike<number> | undefined = prim?.positions;
      if (!pos) continue;
      const idx: ArrayLike<number> | undefined = prim?.indices;
      const triCount = idx
        ? Math.floor(idx.length / 3)
        : Math.floor(pos.length / 9);
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx[t * 3] : t * 3;
        const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
        const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
        rayIntersectsTriangle(
          lo[0],
          lo[1],
          lo[2],
          ld[0],
          ld[1],
          ld[2],
          pos[i0 * 3],
          pos[i0 * 3 + 1],
          pos[i0 * 3 + 2],
          pos[i1 * 3],
          pos[i1 * 3 + 1],
          pos[i1 * 3 + 2],
          pos[i2 * 3],
          pos[i2 * 3 + 1],
          pos[i2 * 3 + 2],
          outHit,
          1e-5,
        );
      }
    }
    if (!Number.isFinite(outHit.distance)) continue;

    const wp = transformPoint(worldMat, outHit.point);
    const dist = vLen(vSub(wp, origin));
    if (dist >= bestDist) continue;

    mat3NormalFromMat4(normMat, worldMat);
    const ln = outHit.normal;
    let wn = vNorm(
      [
        normMat[0] * ln[0] + normMat[3] * ln[1] + normMat[6] * ln[2],
        normMat[1] * ln[0] + normMat[4] * ln[1] + normMat[7] * ln[2],
        normMat[2] * ln[0] + normMat[5] * ln[1] + normMat[8] * ln[2],
      ],
      [0, 1, 0],
    );
    if (vDot(wn, dir) > 0) wn = vScale(wn, -1);

    bestDist = dist;
    best = {
      mesh,
      meshIndex: i,
      distance: dist,
      point: wp,
      normal: wn,
    };
  }
  return best;
}
