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
 * @fileoverview Spatial `world-understanding` plugin for `<xr-live>`.
 *
 * - Tracks WebXR `detectedPlanes` / `detectedMeshes` (opt in with the
 *   `world-understanding` attribute or a `userData.xr.worldUnderstanding`
 *   trait) and hit-tests rays against them.
 * - Unprojects 2D detections (`[ymin, xmin, ymax, xmax]`, normalized to 0–1 or
 *   Gemini-style 0–1000) to 3D using hardware depth, tracked planes, or a
 *   fixed fallback distance, and emits `xr-object-detected`.
 * - Places a surface reticle (`__xr_reticle__`) where the user is looking.
 * - Provides a tape-measure accumulator (`XRTapeMeasure`).
 */

import {mat4Create} from '../../../three-live/src/math';
import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {extractPosition, getMeshXRTraits, type XRPose6DoF} from '../xr-traits';
import {
  buildBoxGeometry,
  clampNum,
  createDynamicMesh,
  emitPluginEvent,
  horizontalForward,
  type PluginViewer,
  type Quat,
  cacheXRFrame,
  isXRFrameFresh,
  removeDynamicMesh,
  resolveHeadPose,
  resolveProjection,
  setWorldTRS,
  transformPoint,
  vAdd,
  vCross,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Vec3,
} from './common';

/** Maximum tracked planes retained per frame (bounds per-frame work). */
export const MAX_TRACKED_PLANES = 64;
/** Maximum detections unprojected per `locateDetections` call. */
export const MAX_DETECTIONS = 32;
/** Distance used when neither depth nor a tracked plane is available. */
export const FALLBACK_DEPTH_METERS = 1.5;

/** A tracked real-world plane in reference-space coordinates. */
export interface TrackedPlane {
  readonly orientation: 'horizontal' | 'vertical';
  readonly center: Vec3;
  readonly normal: Vec3;
  /** Bounding radius of the plane polygon in meters. */
  readonly radius: number;
}

/** A 2D detection in normalized `[ymin, xmin, ymax, xmax]` image space. */
export interface Detection2D {
  readonly label: string;
  readonly box: readonly [number, number, number, number];
}

/** Maximum size of a `detections` JSON string, in characters. */
export const MAX_DETECTIONS_JSON_CHARS = 16 * 1024;

/**
 * Parses a `detections` JSON string (`[{label, box: [ymin, xmin, ymax, xmax]}]`, 0–1 or Gemini
 * 0–1000; `box_2d` is accepted as an alias) into at most {@link MAX_DETECTIONS} detections.
 * Malformed entries are skipped; malformed or oversized input yields `[]`.
 */
export function parseDetections(json: unknown): Detection2D[] {
  if (typeof json !== 'string' || !json || json.length > MAX_DETECTIONS_JSON_CHARS) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  return detectionsFromList(raw);
}

/**
 * Validates an already-parsed detection list (e.g. Gemini `report_objects`
 * tool arguments, which are untrusted model output) with the same rules as
 * {@link parseDetections}.
 */
export function detectionsFromList(raw: unknown): Detection2D[] {
  if (!Array.isArray(raw)) return [];
  const out: Detection2D[] = [];
  for (const item of raw) {
    if (out.length >= MAX_DETECTIONS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const box = Array.isArray(rec['box']) ? rec['box'] : rec['box_2d'];
    if (!Array.isArray(box) || box.length < 4) continue;
    const nums = box.slice(0, 4).map(Number);
    if (!nums.every(Number.isFinite)) continue;
    out.push({
      label: typeof rec['label'] === 'string' ? rec['label'].slice(0, 256) : '',
      box: [nums[0], nums[1], nums[2], nums[3]],
    });
  }
  return out;
}

/** Column-major camera world and projection matrices a frame was rendered with. */
export interface DetectionCamera {
  readonly world: Float32Array;
  readonly projection: Float32Array;
}

/**
 * Snapshots the viewer's current camera (world and projection matrices), e.g.
 * when a frame is sent to a model, so later detections can be unprojected
 * against the camera that produced the image.
 */
// tslint:disable-next-line:no-any Host element is `<xr-live>`.
export function snapshotDetectionCamera(element: any): DetectionCamera {
  const viewer: PluginViewer | undefined = element?._view ?? element?.viewer;
  return {
    world: Float32Array.from(resolveHeadPose(viewer).matrix),
    projection: Float32Array.from(resolveProjection(viewer) ?? defaultProjection()),
  };
}

/** A detection located in 3D world space. */
export interface Detection3D {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly depthSource: 'depth' | 'plane' | 'fallback';
}

/** Depth sampler signature compatible with `XRDepthManager`. */
export type DepthSampler = (u: number, v: number) => number | null;

/**
 * Normalizes a `[ymin, xmin, ymax, xmax]` box to `[0, 1]`, accepting either
 * unit or Gemini-style `0..1000` coordinates. Returns `null` when malformed.
 */
export function normalizeBox(
  box: readonly number[],
): [number, number, number, number] | null {
  if (!Array.isArray(box) || box.length < 4) return null;
  if (!box.slice(0, 4).every((v) => Number.isFinite(v))) return null;
  const scale = box.slice(0, 4).some((v) => v > 1.0001) ? 1000 : 1;
  const [y0, x0, y1, x1] = box.slice(0, 4).map((v) => clampNum(v / scale, 0, 1, 0));
  return [Math.min(y0, y1), Math.min(x0, x1), Math.max(y0, y1), Math.max(x0, x1)];
}

/**
 * Returns the world-space ray through normalized viewport coordinates
 * `(u, v)` (origin top-left) for a camera pose and projection matrix.
 */
export function viewportRay(
  u: number,
  v: number,
  cameraWorld: Float32Array,
  proj: ArrayLike<number>,
): {origin: Vec3; dir: Vec3; viewDir: Vec3} {
  const ndcX = u * 2 - 1;
  const ndcY = 1 - v * 2;
  const p0 = proj[0] || 1;
  const p5 = proj[5] || 1;
  const viewDir: Vec3 = [(ndcX + (proj[8] ?? 0)) / p0, (ndcY + (proj[9] ?? 0)) / p5, -1];
  const origin = extractPosition(cameraWorld);
  const far = transformPoint(cameraWorld, viewDir);
  return {origin, dir: vNorm(vSub(far, origin)), viewDir};
}

/** Intersects a ray with tracked planes, returning the nearest hit. */
export function hitTestPlanes(
  planes: readonly TrackedPlane[],
  origin: readonly number[],
  dir: readonly number[],
): {point: Vec3; normal: Vec3; distance: number; plane: TrackedPlane} | null {
  let best: {point: Vec3; normal: Vec3; distance: number; plane: TrackedPlane} | null = null;
  for (const plane of planes) {
    const denom = vDot(plane.normal, dir);
    if (Math.abs(denom) < 1e-6) continue;
    const t = vDot(vSub(plane.center, origin), plane.normal) / denom;
    if (t <= 0.01 || (best && t >= best.distance)) continue;
    const point = vAdd(origin, vScale(dir, t));
    if (vLen(vSub(point, plane.center)) > plane.radius) continue;
    best = {point, normal: [...plane.normal], distance: t, plane};
  }
  return best;
}

/**
 * Unprojects a single 2D detection to 3D. Uses `sampleDepth` (view-space
 * depth in meters along -Z) when available, then tracked planes, then
 * {@link FALLBACK_DEPTH_METERS}.
 */
export function unprojectDetectionTo3D(
  detection: Detection2D,
  cameraWorld: Float32Array,
  proj: ArrayLike<number>,
  planes: readonly TrackedPlane[] = [],
  sampleDepth?: DepthSampler,
): Detection3D | null {
  const box = normalizeBox(detection.box);
  if (!box) return null;
  const [y0, x0, y1, x1] = box;
  const u = (x0 + x1) * 0.5;
  const v = (y0 + y1) * 0.5;
  const ray = viewportRay(u, v, cameraWorld, proj);
  let depth = 0;
  let source: Detection3D['depthSource'] = 'fallback';
  const sampled = sampleDepth?.(u, v);
  if (typeof sampled === 'number' && Number.isFinite(sampled) && sampled > 0.05) {
    depth = sampled;
    source = 'depth';
  } else {
    const hit = hitTestPlanes(planes, ray.origin, ray.dir);
    if (hit) {
      depth = hit.distance / vLen(ray.viewDir);
      source = 'plane';
    } else {
      depth = FALLBACK_DEPTH_METERS;
    }
  }
  const world = transformPoint(cameraWorld, vScale(ray.viewDir, depth));
  const p0 = Math.abs(proj[0] || 1);
  const p5 = Math.abs(proj[5] || 1);
  return {
    label: String(detection.label ?? '').slice(0, 256),
    x: world[0],
    y: world[1],
    z: world[2],
    widthMeters: ((x1 - x0) * 2 * depth) / p0,
    heightMeters: ((y1 - y0) * 2 * depth) / p5,
    depthSource: source,
  };
}

/** Accumulates tape-measure points and reports segment / total lengths. */
export class XRTapeMeasure {
  private readonly points: Vec3[] = [];

  /** Adds a point and returns the length of the newest segment (0 if first). */
  addPoint(p: readonly number[]): number {
    if (!p || !p.slice(0, 3).every((v) => Number.isFinite(v))) return 0;
    this.points.push([p[0], p[1], p[2]]);
    const n = this.points.length;
    return n < 2 ? 0 : vLen(vSub(this.points[n - 1], this.points[n - 2]));
  }

  /** Returns the summed length of every segment in meters. */
  get totalMeters(): number {
    let total = 0;
    for (let i = 1; i < this.points.length; i++) {
      total += vLen(vSub(this.points[i], this.points[i - 1]));
    }
    return total;
  }

  /** Returns a copy of the measured points. */
  get pointList(): Vec3[] {
    return this.points.map((p) => [...p] as Vec3);
  }

  /** Removes every measured point. */
  clear(): void {
    this.points.length = 0;
  }
}

function polygonRadius(polygon: unknown): number {
  let r = 0;
  if (Array.isArray(polygon) || (polygon && typeof polygon === 'object')) {
    for (const p of polygon as Iterable<{x?: number; z?: number}>) {
      const d = Math.hypot(p?.x ?? 0, p?.z ?? 0);
      if (Number.isFinite(d)) r = Math.max(r, d);
    }
  }
  return r || 0.5;
}

/** Quaternion that rotates +Z onto `normal` (used to lay the reticle flat). */
function quatFromNormal(normal: readonly number[]): Quat {
  const z: Vec3 = [0, 0, 1];
  const d = vDot(z, normal);
  if (d > 0.9999) return [0, 0, 0, 1];
  if (d < -0.9999) return [1, 0, 0, 0];
  const axis = vNorm(vCross(z, normal));
  const half = Math.acos(Math.max(-1, Math.min(1, d))) * 0.5;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

/** Tracks planes/meshes, drives the reticle, and locates detections. */
export class XRWorldUnderstandingController {
  planes: TrackedPlane[] = [];
  meshCount = 0;
  readonly tape = new XRTapeMeasure();
  /** Latest reticle hit, or `null` when nothing is under the gaze. */
  reticleHit: {point: Vec3; normal: Vec3} | null = null;
  // tslint:disable-next-line:no-any GPU mesh struct.
  private reticle: any = null;

  /** Refreshes tracked planes and meshes from a WebXR frame. */
  // tslint:disable-next-line:no-any WebXR types are not in the TS lib target.
  updateFromXRFrame(frame: any, refSpace: unknown): void {
    if (!frame || typeof frame.getPose !== 'function') return;
    const next: TrackedPlane[] = [];
    for (const plane of frame.detectedPlanes ?? []) {
      if (next.length >= MAX_TRACKED_PLANES) break;
      const pose = frame.getPose(plane.planeSpace, refSpace);
      const m = pose?.transform?.matrix;
      if (!m || m.length !== 16) continue;
      // The plane's local +Y axis is its normal in WebXR plane detection.
      next.push({
        orientation: plane.orientation === 'vertical' ? 'vertical' : 'horizontal',
        center: [m[12], m[13], m[14]],
        normal: vNorm([m[4], m[5], m[6]], [0, 1, 0]),
        radius: polygonRadius(plane.polygon),
      });
    }
    this.planes = next;
    this.meshCount = frame.detectedMeshes?.size ?? 0;
  }

  /**
   * Projects 2D detections into 3D for `camera` (e.g. the camera of the frame
   * the detections were computed from), or the viewer's current camera.
   */
  locateDetections(
    detections: readonly Detection2D[],
    viewer: PluginViewer | undefined,
    sampleDepth?: DepthSampler,
    camera?: DetectionCamera,
  ): Detection3D[] {
    const world = camera?.world ?? resolveHeadPose(viewer).matrix;
    const proj = camera?.projection ?? resolveProjection(viewer) ?? defaultProjection();
    const out: Detection3D[] = [];
    for (const d of detections.slice(0, MAX_DETECTIONS)) {
      const located = unprojectDetectionTo3D(d, world, proj, this.planes, sampleDepth);
      if (located) out.push(located);
    }
    return out;
  }

  /**
   * Casts the gaze ray against tracked planes (then depth) and positions the
   * reticle mesh. Creates the reticle lazily and hides it on a miss.
   */
  updateReticle(viewer: PluginViewer, head: XRPose6DoF, sampleDepth?: DepthSampler): void {
    const m = head.matrix;
    const fwd = vNorm([-m[8], -m[9], -m[10]], horizontalForward(head.quaternion));
    let hit: {point: Vec3; normal: Vec3} | null = hitTestPlanes(this.planes, head.position, fwd);
    if (!hit) {
      const d = sampleDepth?.(0.5, 0.5);
      if (typeof d === 'number' && Number.isFinite(d) && d > 0.05) {
        hit = {point: vAdd(head.position, vScale(fwd, d)), normal: vScale(fwd, -1)};
      }
    }
    this.reticleHit = hit;
    // Re-create after a model reload replaced (and freed) `viewer.meshes`.
    if (this.reticle && Array.isArray(viewer.meshes) && !viewer.meshes.includes(this.reticle)) {
      this.reticle = null;
    }
    if (!this.reticle) {
      this.reticle = createDynamicMesh(viewer, buildBoxGeometry(0.5), {
        name: '__xr_reticle__',
        color: [1, 1, 1, 0.85],
        pickable: false,
      });
    }
    this.reticle.visible = Boolean(hit);
    if (hit) {
      setWorldTRS(viewer, this.reticle, quatFromNormal(hit.normal), hit.point, [0.06, 0.06, 0.004]);
    }
  }

  /** Hides the reticle (e.g. when the XR session ends). */
  hideReticle(): void {
    if (this.reticle) this.reticle.visible = false;
    this.reticleHit = null;
  }

  /** Removes the reticle from `viewer`. */
  dispose(viewer: PluginViewer | undefined): void {
    removeDynamicMesh(viewer, this.reticle);
    this.reticle = null;
    this.planes = [];
  }
}

function defaultProjection(): Float32Array {
  // 60 degree vertical FOV, square aspect.
  const f = 1 / Math.tan(Math.PI / 6);
  const m = mat4Create();
  m[0] = f;
  m[5] = f;
  m[10] = -1;
  m[11] = -1;
  m[14] = -0.2;
  m[15] = 0;
  return m;
}

const controllers = new WeakMap<object, XRWorldUnderstandingController>();

/** Returns (creating on first use) the controller bound to `key`. */
export function getWorldUnderstandingController(key: object): XRWorldUnderstandingController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRWorldUnderstandingController();
    controllers.set(key, c);
  }
  return c;
}

/** Aggregated `worldUnderstanding` options across the element and scene. */
export interface WorldUnderstandingOptions {
  readonly enabled: boolean;
  readonly planes: boolean;
  readonly meshes: boolean;
  readonly reticle: boolean;
}

/** Reads opt-in flags from the host attribute and any mesh trait. */
// tslint:disable-next-line:no-any Host element and GPU mesh structs.
export function resolveWorldUnderstanding(element: any, meshes: readonly any[] = []): WorldUnderstandingOptions {
  const attr = element?.getAttribute?.('world-understanding');
  let planes = attr != null && attr !== 'false';
  let meshesOn = false;
  let reticle = planes && attr?.includes?.('reticle');
  for (const m of meshes) {
    const wu = getMeshXRTraits(m)?.worldUnderstanding;
    if (!wu || typeof wu !== 'object') continue;
    planes ||= wu.planes !== false;
    meshesOn ||= wu.meshes === true;
    reticle ||= wu.reticle === true;
  }
  return {enabled: planes || meshesOn || Boolean(reticle), planes, meshes: meshesOn, reticle: Boolean(reticle)};
}

function depthSamplerFor(host: unknown): DepthSampler | undefined {
  const dm = (host as {depthManager?: {sampleDepthAndNormal?: (u: number, v: number) => {depthMeters: number} | null}})?.depthManager;
  if (!dm || typeof dm.sampleDepthAndNormal !== 'function') return undefined;
  return (u, v) => {
    try {
      return dm.sampleDepthAndNormal!(u, v)?.depthMeters ?? null;
    } catch {
      // WebXR CPU depth info throws once its XRFrame is no longer active.
      return null;
    }
  };
}

/**
 * Locates 2D detections in 3D for an `<xr-live>` element and dispatches one
 * `xr-object-detected` event per located object. Returns the located objects.
 * Pass `camera` (see {@link snapshotDetectionCamera}) to unproject against the
 * camera of the image the detections came from instead of the current one.
 * `shouldEmit` can stop event delivery if a listener replaces the caller's session.
 */
export function detectObjects(
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  element: any,
  detections: readonly Detection2D[],
  camera?: DetectionCamera,
  shouldEmit?: () => boolean,
): Detection3D[] {
  const viewer: PluginViewer | undefined = element?._view ?? element?.viewer;
  // Depth is only sampled for the live camera; a past frame's depth is gone.
  const located = getWorldUnderstandingController(element).locateDetections(
    detections,
    viewer,
    camera ? undefined : depthSamplerFor(element),
    camera,
  );
  for (const d of located) {
    if (shouldEmit && !shouldEmit()) break;
    emitPluginEvent(element, 'xr-object-detected', d);
  }
  return located;
}

/** `ThreeLivePlugin` enabling WebXR plane/mesh detection and the reticle. */
export const worldUnderstandingPlugin: ThreeLivePlugin = {
  name: 'xr-live-world-understanding',
  // tslint:disable-next-line:no-any WebXR session init dictionary.
  onConfigureXRSessionInit(element: any, sessionInit: any): void {
    const viewer = element?._view ?? element?.viewer;
    const opts = resolveWorldUnderstanding(element, viewer?.meshes ?? []);
    if (!opts.enabled || !sessionInit) return;
    const optional = new Set<string>(sessionInit.optionalFeatures ?? []);
    if (opts.planes || opts.reticle) optional.add('plane-detection');
    if (opts.meshes) optional.add('mesh-detection');
    sessionInit.optionalFeatures = [...optional];
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    const host = v?.container;
    if (!host) return;
    const opts = resolveWorldUnderstanding(host, v.meshes ?? []);
    if (!opts.enabled) return;
    const ctrl = getWorldUnderstandingController(host);
    cacheXRFrame(v, frame, refSpace);
    ctrl.updateFromXRFrame(frame, refSpace);
    if (opts.reticle) ctrl.updateReticle(v, resolveHeadPose(v), depthSamplerFor(host));
  },
  onUpdate(viewer: PluginViewer): void {
    // Outside an immersive session the reticle has no valid surface to sit on.
    const host = viewer?.container;
    if (host && !isXRFrameFresh(viewer)) controllers.get(host)?.hideReticle();
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    controllers.get(element)?.dispose(element?._view ?? element?.viewer);
  },
};
