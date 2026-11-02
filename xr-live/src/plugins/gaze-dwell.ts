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
 * @fileoverview `gaze-dwell` plugin for `<xr-live>`.
 *
 * Provides hands-free eye/head gaze raycasting with an EMA jitter filter, a
 * 1.5° angular grace cone, a 150ms grace delay, a constant-angular-size
 * surface-normal reticle + radial progress arc, and automatic dispatch to
 * `meshclick` / `KHR_interactivity` (`action: 'select'`) or `gemini-live`
 * (`action: 'ask'`).
 */

import {getRegisteredPlugins, type ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  clampNum,
  parseGaze,
  parseHoldToAsk,
  type GazeAction,
  type GazeOptions,
} from '../../../three-live/src/xr-trait-schema';
import {extractPosition, getMeshXRTraits} from '../xr-traits';
import {
  cacheXRFrame,
  createDynamicMesh,
  type DynamicGeometry,
  emitPluginEvent,
  isXRFrameFresh,
  normalizeRayDir,
  type PluginViewer,
  quatFromUnitVectors,
  raycastSceneMeshes,
  reattachDynamicMesh,
  removeDynamicMesh,
  resolveHeadPose,
  setWorldTRS,
  updateDynamicMesh,
  vAdd,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Vec3,
} from './common';
import {buildHoldToAskPrompt, getGeminiLiveController} from './gemini-live';

export {parseGaze, type GazeAction, type GazeOptions};

/** EMA smoothing factor for raw eye/head ray directions. */
export const GAZE_EMA_ALPHA = 0.25;
/** Micro-saccade / head-tremor grace cone (degrees) around an active target. */
export const GAZE_GRACE_CONE_DEG = 1.5;
/** Initial grace delay before radial dwell arc starts filling (ms). */
export const GAZE_GRACE_MS = 150;
/** Constant angular outer radius multiplier (`outerRadius = 0.018 * distance`). */
export const GAZE_RETICLE_ANGULAR_SCALE = 0.018;

/**
 * Smooths a raw gaze ray direction using an exponential moving average (`alpha`)
 * and normalizes the result.
 */
export function smoothGazeDirection(
  prev: readonly number[] | null,
  raw: readonly number[],
  alpha = GAZE_EMA_ALPHA,
): Vec3 {
  const target = vNorm(raw, [0, 0, -1]);
  if (!prev || !prev.every(Number.isFinite)) return target;
  const p = vNorm(prev, target);
  const a = clampNum(alpha, 0.01, 1, GAZE_EMA_ALPHA);
  const d = Math.max(-1, Math.min(1, vDot(p, target)));
  if (d > 0.9995) {
    return vNorm(
      [
        p[0] + (target[0] - p[0]) * a,
        p[1] + (target[1] - p[1]) * a,
        p[2] + (target[2] - p[2]) * a,
      ],
      target,
    );
  }
  if (d < -0.9995) {
    const ref: Vec3 = Math.abs(p[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perp = vNorm(
      [
        ref[1] * p[2] - ref[2] * p[1],
        ref[2] * p[0] - ref[0] * p[2],
        ref[0] * p[1] - ref[1] * p[0],
      ],
      [0, 1, 0],
    );
    const theta = a * Math.PI;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    return vNorm(
      [p[0] * ct + perp[0] * st, p[1] * ct + perp[1] * st, p[2] * ct + perp[2] * st],
      target,
    );
  }
  const omega = Math.acos(d);
  const sinOmega = Math.sin(omega);
  const w0 = Math.sin((1 - a) * omega) / sinOmega;
  const w1 = Math.sin(a * omega) / sinOmega;
  return vNorm(
    [
      p[0] * w0 + target[0] * w1,
      p[1] * w0 + target[1] * w1,
      p[2] * w0 + target[2] * w1,
    ],
    target,
  );
}

/** Returns the angle in degrees (`0..180`) between two direction vectors. */
export function angleBetweenDirectionsDeg(
  a: readonly number[],
  b: readonly number[],
): number {
  const na = vNorm(a, [0, 0, -1]);
  const nb = vNorm(b, [0, 0, -1]);
  const c = Math.max(-1, Math.min(1, vDot(na, nb)));
  return (Math.acos(c) * 180) / Math.PI;
}

/**
 * Computes normalized `[0..1]` radial dwell progress after `graceMs` over a
 * total duration of `dwellMs`.
 */
export function computeDwellProgress(
  elapsedMs: number,
  dwellMs: number,
  graceMs = GAZE_GRACE_MS,
): number {
  const total = clampNum(dwellMs, 250, 10000, 1200);
  const grace = Math.min(total - 1, Math.max(0, graceMs));
  if (!Number.isFinite(elapsedMs) || elapsedMs <= grace) return 0;
  return Math.max(0, Math.min(1, (elapsedMs - grace) / (total - grace)));
}

/**
 * Generates a double-sided dual-ring + progress arc mesh of unit outer radius
 * (`1.0`) in the XY plane facing `+Z`. Scaled at draw time by
 * `outerRadius = 0.018 * distance` to maintain constant angular size.
 */
export function buildGazeReticleGeometry(
  progress: number,
  segments = 24,
): DynamicGeometry {
  const segs = Math.max(8, Math.min(64, Math.floor(segments)));
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const arcSegs = p > 1e-3 ? Math.max(1, Math.round(p * segs)) : 0;
  const totalQuads = segs + arcSegs;

  // Each quad has front + back faces (8 verts, 12 indices) so surface-normal
  // orientation is always visible regardless of face culling.
  const positions = new Float32Array(totalQuads * 8 * 3);
  const normals = new Float32Array(totalQuads * 8 * 3);
  const indices = new Uint16Array(totalQuads * 12);

  let vi = 0;
  let ii = 0;
  const appendRingQuad = (
    a0: number,
    a1: number,
    rInner: number,
    rOuter: number,
    zOff: number,
  ): void => {
    const c0 = Math.cos(a0);
    const s0 = Math.sin(a0);
    const c1 = Math.cos(a1);
    const s1 = Math.sin(a1);
    const pts: Array<[number, number]> = [
      [c0 * rInner, s0 * rInner],
      [c1 * rInner, s1 * rInner],
      [c1 * rOuter, s1 * rOuter],
      [c0 * rOuter, s0 * rOuter],
    ];
    const front = vi;
    for (const [x, y] of pts) {
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = zOff;
      normals[vi * 3 + 2] = 1;
      vi++;
    }
    indices.set([front, front + 1, front + 2, front, front + 2, front + 3], ii);
    ii += 6;

    const back = vi;
    for (const [x, y] of pts) {
      positions[vi * 3] = x;
      positions[vi * 3 + 1] = y;
      positions[vi * 3 + 2] = -zOff;
      normals[vi * 3 + 2] = -1;
      vi++;
    }
    indices.set([back, back + 2, back + 1, back, back + 3, back + 2], ii);
    ii += 6;
  };

  // Outer static ring [0.84 .. 1.0].
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const a1 = ((i + 1) / segs) * Math.PI * 2;
    appendRingQuad(a0, a1, 0.84, 1.0, 0.0005);
  }
  // Inner radial progress arc [0.42 .. 0.72], starting at 12 o'clock (+Y) clockwise.
  for (let i = 0; i < arcSegs; i++) {
    const t0 = i / arcSegs;
    const t1 = (i + 1) / arcSegs;
    const a0 = Math.PI * 0.5 - t0 * p * Math.PI * 2;
    const a1 = Math.PI * 0.5 - t1 * p * Math.PI * 2;
    appendRingQuad(a1, a0, 0.42, 0.72, 0.0012);
  }

  return {positions, normals, indices};
}

/** Element-level `<xr-live gaze-dwell ...>` configuration. */
export interface GazeElementConfig {
  readonly mode: 'off' | 'on' | 'auto';
  readonly defaultDwellMs: number;
}

/** Parses `gaze-dwell` and `dwell-time` attributes on `<xr-live>`. */
// tslint:disable-next-line:no-any Host element is `<xr-live>`.
export function resolveGazeElementConfig(element: any): GazeElementConfig {
  const hasAttr =
    typeof element?.hasAttribute === 'function' &&
    element.hasAttribute('gaze-dwell');
  const raw = (element?.getAttribute?.('gaze-dwell') ?? '').trim().toLowerCase();
  const dwellTimeAttr = element?.getAttribute?.('dwell-time');
  const defaultDwellMs = Math.round(
    clampNum(
      dwellTimeAttr !== null && dwellTimeAttr !== undefined && dwellTimeAttr !== ''
        ? Number(dwellTimeAttr)
        : undefined,
      250,
      10000,
      1200,
    ),
  );
  if (!hasAttr || raw === 'false' || raw === 'none') {
    return {mode: 'off', defaultDwellMs};
  }
  if (raw === 'auto') {
    return {mode: 'auto', defaultDwellMs};
  }
  return {mode: 'on', defaultDwellMs};
}

/** Explicit ray input override for unit tests or XR gaze input sources. */
export interface GazeRayInput {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

function forwardFromMatrix(m: ArrayLike<number>): Vec3 {
  return vNorm([-(m[8] ?? 0), -(m[9] ?? 0), -(m[10] ?? 1)], [0, 0, -1]);
}

function resolveXRInputGaze(
  // tslint:disable-next-line:no-any WebXR session.
  session: any,
  // tslint:disable-next-line:no-any WebXR frame.
  frame: any,
  refSpace: unknown,
): {gazeRay: GazeRayInput | null; hasTrackedControllers: boolean} {
  let gazeRay: GazeRayInput | null = null;
  let hasTrackedControllers = false;
  const sources: Iterable<any> = session?.inputSources ?? [];
  for (const src of sources) {
    if (!src) continue;
    if (src.targetRayMode === 'tracked-pointer') {
      hasTrackedControllers = true;
    } else if (src.targetRayMode === 'gaze' && !gazeRay && src.targetRaySpace) {
      try {
        const pose = frame?.getPose?.(src.targetRaySpace, refSpace);
        const mat = pose?.transform?.matrix;
        if (mat && mat.length === 16) {
          gazeRay = {
            origin: extractPosition(mat),
            direction: forwardFromMatrix(mat),
          };
        }
      } catch {
        // Ignore transient tracking loss.
      }
    }
  }
  return {gazeRay, hasTrackedControllers};
}

/**
 * Per-element controller driving hands-free gaze raycasting, dwell progress,
 * 3D surface-normal reticle rendering, and `gazeenter`/`gazeleave`/`gazedwell`
 * dispatch.
 */
export class XRGazeDwellController {
  private smoothedDir: Vec3 | null = null;
  // tslint:disable-next-line:no-any Active target GPU mesh.
  private activeMesh: any = null;
  private activePoint: Vec3 = [0, 0, -1];
  private activeNormal: Vec3 = [0, 0, 1];
  private activeDistance = 1;
  private elapsedMs = 0;
  private latched = false;
  // tslint:disable-next-line:no-any Dynamic reticle GPU mesh.
  private reticleMesh: any = null;
  private lastBucket = -1;

  private resolveMeshGazeOptions(
    // tslint:disable-next-line:no-any GPU mesh.
    mesh: any,
    elemCfg: GazeElementConfig,
    autoEnabled: boolean,
  ): GazeOptions | null {
    const rawTraits = getMeshXRTraits(mesh);
    if (rawTraits && rawTraits.gaze === false) return null;
    const explicit = parseGaze(rawTraits?.gaze);
    if (explicit) {
      const hasCustomDwell =
        typeof rawTraits?.gaze === 'object' &&
        rawTraits.gaze !== null &&
        typeof (rawTraits.gaze as {dwellMs?: unknown}).dwellMs === 'number';
      return hasCustomDwell
        ? explicit
        : {...explicit, dwellMs: elemCfg.defaultDwellMs};
    }
    const elementActive =
      elemCfg.mode === 'on' || (elemCfg.mode === 'auto' && autoEnabled);
    if (!elementActive) return null;

    // Under element-wide `gaze-dwell`, target interactive/grabbable/spatial/named scene meshes
    // (or all pickable meshes without `pointerEvents: 'none'`).
    const action: GazeAction = rawTraits?.holdToAsk ? 'ask' : 'select';
    return {
      enabled: true,
      dwellMs: elemCfg.defaultDwellMs,
      repeat: false,
      action,
    };
  }

  /** Steps gaze raycast, dwell accumulation, reticle mesh, and DOM events. */
  step(
    viewer: PluginViewer,
    dtSeconds: number,
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element?: any,
    rayOverride?: GazeRayInput | null,
    autoEnabled = false,
  ): {
    // tslint:disable-next-line:no-any Active mesh.
    target: any;
    progress: number;
    triggered: boolean;
  } {
    const elemCfg = resolveGazeElementConfig(element);
    const anyNodeHasGaze =
      Array.isArray(viewer.meshes) &&
      viewer.meshes.some((m) => m && !m.isPluginMesh && Boolean(parseGaze(getMeshXRTraits(m)?.gaze)));
    const active =
      elemCfg.mode === 'on' ||
      (elemCfg.mode === 'auto' && autoEnabled) ||
      anyNodeHasGaze;
    if (!active) {
      this.clearTarget(element);
      if (this.reticleMesh) this.reticleMesh.visible = false;
      return {target: null, progress: 0, triggered: false};
    }

    const dtMs = clampNum(dtSeconds, 0, 0.25, 1 / 60) * 1000;
    const head = resolveHeadPose(viewer);
    const origin: Vec3 = rayOverride?.origin
      ? [...rayOverride.origin]
      : [...head.position];
    const rawDir: Vec3 = rayOverride?.direction
      ? (normalizeRayDir(rayOverride.direction) ?? forwardFromMatrix(head.matrix))
      : forwardFromMatrix(head.matrix);
    this.smoothedDir = smoothGazeDirection(this.smoothedDir, rawDir, GAZE_EMA_ALPHA);

    const hit = raycastSceneMeshes(viewer, origin, this.smoothedDir, 30, (m) => {
      const pe = m.extras?.xr?.pointerEvents ?? m.userData?.xr?.pointerEvents;
      if (pe === 'none') return false;
      return this.resolveMeshGazeOptions(m, elemCfg, autoEnabled) !== null;
    });

    // tslint:disable-next-line:no-any Chosen target mesh.
    let nextMesh: any = hit?.mesh ?? null;
    let nextPoint: Vec3 = hit?.point ?? [0, 0, -1];
    let nextNormal: Vec3 = hit?.normal ?? [0, 0, 1];
    let nextDist = hit?.distance ?? 1;

    // 1.5° micro-jitter angular grace cone around an active target.
    if (
      this.activeMesh &&
      nextMesh !== this.activeMesh &&
      Array.isArray(viewer.meshes) &&
      viewer.meshes.includes(this.activeMesh) &&
      this.activeMesh.visible !== false
    ) {
      const toPrev = vSub(this.activePoint, origin);
      if (
        vLen(toPrev) > 1e-4 &&
        angleBetweenDirectionsDeg(this.smoothedDir, toPrev) <= GAZE_GRACE_CONE_DEG
      ) {
        nextMesh = this.activeMesh;
        nextPoint = this.activePoint;
        nextNormal = this.activeNormal;
        nextDist = vLen(toPrev);
      }
    }

    if (nextMesh !== this.activeMesh) {
      if (this.activeMesh) {
        emitPluginEvent(element, 'gazeleave', {node: this.activeMesh});
      }
      this.activeMesh = nextMesh;
      this.elapsedMs = 0;
      this.latched = false;
      if (nextMesh) {
        this.activePoint = [...nextPoint];
        this.activeNormal = [...nextNormal];
        this.activeDistance = nextDist;
        emitPluginEvent(element, 'gazeenter', {
          node: nextMesh,
          point: [...nextPoint],
        });
      }
    } else if (nextMesh) {
      this.activePoint = [...nextPoint];
      this.activeNormal = [...nextNormal];
      this.activeDistance = nextDist;
    }

    if (!this.activeMesh) {
      if (this.reticleMesh) this.reticleMesh.visible = false;
      return {target: null, progress: 0, triggered: false};
    }

    const opts = this.resolveMeshGazeOptions(this.activeMesh, elemCfg, autoEnabled);
    if (!opts) {
      this.clearTarget(element);
      if (this.reticleMesh) this.reticleMesh.visible = false;
      return {target: null, progress: 0, triggered: false};
    }

    let triggered = false;
    let progress = 0;
    if (!this.latched) {
      this.elapsedMs += dtMs;
      progress = computeDwellProgress(this.elapsedMs, opts.dwellMs, GAZE_GRACE_MS);
      if (progress >= 1) {
        triggered = true;
        this.fireDwellAction(viewer, element, this.activeMesh, this.activePoint, this.activeNormal, this.activeDistance, opts);
        if (opts.repeat) {
          this.elapsedMs = 0;
          progress = 0;
        } else {
          this.latched = true;
          progress = 1;
        }
      }
    } else {
      progress = 1;
    }

    this.syncReticle(viewer, this.activePoint, this.activeNormal, this.activeDistance, progress);
    return {target: this.activeMesh, progress, triggered};
  }

  private fireDwellAction(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element: any,
    // tslint:disable-next-line:no-any Target GPU mesh.
    mesh: any,
    point: Vec3,
    normal: Vec3,
    distance: number,
    opts: GazeOptions,
  ): void {
    emitPluginEvent(element, 'gazedwell', {
      node: mesh,
      point: [...point],
      action: opts.action,
    });

    if (opts.action === 'ask') {
      const rawTraits = getMeshXRTraits(mesh);
      const holdOpts = parseHoldToAsk(rawTraits?.holdToAsk) ?? {
        prompt: 'What is this?',
        holdMs: 600,
      };
      const meshName = mesh.name ?? 'object';
      const prompt = buildHoldToAskPrompt(meshName, holdOpts, '');
      emitPluginEvent(element, 'xr-hold-to-ask', {
        mesh: meshName,
        transcript: '',
        prompt,
      });
      if (element && typeof element === 'object') {
        getGeminiLiveController(element).sendText(prompt);
      }
      return;
    }

    // `action === 'select'`: synthesize `meshclick` / `meshClick` and notify
    // `KHR_interactivity` (`onMeshSelect`) + spatial UI slot controls.
    const meshIndex = Array.isArray(viewer.meshes) ? viewer.meshes.indexOf(mesh) : -1;
    const hitDetail = {
      meshIndex,
      meshName: mesh.name ?? '',
      nodeIndex: typeof mesh.nodeIndex === 'number' ? mesh.nodeIndex : -1,
      distance: Math.round(distance * 1000) / 1000,
      hitPoint: [...point] as Vec3,
      normal: [...normal] as Vec3,
      screenX: 0,
      screenY: 0,
    };
    for (const plugin of getRegisteredPlugins()) {
      plugin.onMeshSelect?.(viewer, hitDetail);
    }
    // tslint:disable-next-line:no-any Optional host/viewer click hooks.
    const vAny = viewer as any;
    if (typeof vAny?.onMeshSelect === 'function') {
      vAny.onMeshSelect(mesh, hitDetail);
    }
    if (typeof vAny?.opts?.onMeshClick === 'function') {
      vAny.opts.onMeshClick(hitDetail);
    }
    if (mesh?.isSpatialSlot && typeof element?.inputManager?.onSpatialSlotHit === 'function') {
      element.inputManager.onSpatialSlotHit(
        {mesh, distance, point: [...point] as Vec3, normal: [...normal] as Vec3},
        'click',
      );
    }
    const target = element ?? viewer.container;
    emitPluginEvent(target, 'meshclick', hitDetail);
    emitPluginEvent(target, 'meshClick', hitDetail);
  }

  private syncReticle(
    viewer: PluginViewer,
    point: Vec3,
    normal: Vec3,
    distance: number,
    progress: number,
  ): void {
    const bucket = Math.round(progress * 24);
    if (!this.reticleMesh) {
      this.reticleMesh = createDynamicMesh(
        viewer,
        buildGazeReticleGeometry(progress, 24),
        {
          name: '__xr_gaze_reticle__',
          color: [0.22, 0.74, 0.97, 0.92],
          roughness: 0.2,
          alphaBlend: true,
          pickable: false,
          worldSpace: true,
        },
      );
      this.lastBucket = bucket;
    } else {
      reattachDynamicMesh(viewer, this.reticleMesh);
      if (bucket !== this.lastBucket) {
        updateDynamicMesh(
          viewer,
          this.reticleMesh,
          buildGazeReticleGeometry(progress, 24),
        );
        this.lastBucket = bucket;
      }
    }
    this.reticleMesh.visible = true;
    const outerRadius = clampNum(
      GAZE_RETICLE_ANGULAR_SCALE * Math.max(0.15, distance),
      0.004,
      0.25,
      0.018,
    );
    const n = vNorm(normal, [0, 0, 1]);
    const pos = vAdd(point, vScale(n, 0.003));
    const q = quatFromUnitVectors([0, 0, 1], n);
    setWorldTRS(viewer, this.reticleMesh, q, pos, [outerRadius, outerRadius, outerRadius]);
  }

  // tslint:disable-next-line:no-any Host element.
  private clearTarget(element?: any): void {
    if (this.activeMesh) {
      emitPluginEvent(element, 'gazeleave', {node: this.activeMesh});
    }
    this.activeMesh = null;
    this.elapsedMs = 0;
    this.latched = false;
  }

  /** Resets active gaze target and hides the reticle. */
  // tslint:disable-next-line:no-any Host element.
  reset(viewer?: PluginViewer, element?: any): void {
    this.clearTarget(element);
    this.smoothedDir = null;
    if (this.reticleMesh) this.reticleMesh.visible = false;
    if (viewer && this.reticleMesh) reattachDynamicMesh(viewer, this.reticleMesh);
  }

  /** Disposes reticle GPU buffers and resets controller state. */
  dispose(viewer: PluginViewer | undefined): void {
    this.activeMesh = null;
    this.smoothedDir = null;
    this.elapsedMs = 0;
    this.latched = false;
    this.lastBucket = -1;
    removeDynamicMesh(viewer, this.reticleMesh);
    this.reticleMesh = null;
  }
}

const controllers = new WeakMap<object, XRGazeDwellController>();

/** Returns (creating on first use) the `gaze-dwell` controller for `key`. */
export function getGazeDwellController(key: object): XRGazeDwellController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRGazeDwellController();
    controllers.set(key, c);
  }
  return c;
}

/** `ThreeLivePlugin` providing hands-free gaze reticle & dwell selection. */
export const gazeDwellPlugin: ThreeLivePlugin = {
  name: 'xr-live-gaze-dwell',
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    controllers.get(element)?.dispose(element?._view ?? element?.viewer);
  },
  onXRFrame(viewer: unknown, session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    const {gazeRay, hasTrackedControllers} = resolveXRInputGaze(session, frame, refSpace);
    const autoEnabled = gazeRay !== null || !hasTrackedControllers;
    getGazeDwellController(host ?? v).step(v, 1 / 72, host, gazeRay, autoEnabled);
  },
  onUpdate(viewer: PluginViewer, dt: number): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getGazeDwellController(host ?? viewer).step(viewer, dt, host, null, false);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.dispose(viewer);
  },
};
