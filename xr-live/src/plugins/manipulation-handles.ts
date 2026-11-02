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
 * @fileoverview Spatial `manipulation-handles` plugin for `<xr-live>`.
 *
 * Adds four top-corner uniform-scale handles and a pedestal yaw-rotation bar
 * to every mesh tagged with `userData.xr.handles`:
 *
 * ```js
 * chair.userData.xr = {handles: {rotateAxis: 'y', minScale: 0.5, maxScale: 3}};
 * ```
 *
 * Dragging a corner scales uniformly about the mesh origin (clamped to
 * `[minScale, maxScale]`); dragging the pedestal bar rotates about +Y only.
 * Emits `xr-handles-change` with `{mesh, scale, yawDeg}` on the host element.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {type HandlesOptions, parseHandles} from '../../../three-live/src/xr-trait-schema';
import {extractPosition, extractQuaternion, extractScale, getMeshXRTraits} from '../xr-traits';
import {
  buildBoxGeometry,
  clampNum,
  cacheXRFrame,
  claimEvent,
  computeLocalBounds,
  createDynamicMesh,
  emitPluginEvent,
  isXRFrameFresh,
  meshWorldMatrix,
  normalizeRayDir,
  type PluginViewer,
  quatFromYaw,
  quatMultiply,
  removeDynamicMesh,
  setMeshTRS,
  setWorldTRS,
  transformPoint,
  vAdd,
  vDot,
  vLen,
  vScale,
  vSub,
  type Vec3,
  yawFromQuat,
} from './common';

export {parseHandles};
export type {HandlesOptions};

/** World-space handle placement for a single mesh. */
export interface HandleLayout {
  readonly origin: Vec3;
  readonly corners: readonly Vec3[];
  readonly pedestalStart: Vec3;
  readonly pedestalEnd: Vec3;
  readonly pedestalCenter: Vec3;
  readonly yaw: number;
  readonly handleRadius: number;
}

/** Identifies which handle a ray picked. */
export type HandleHit =
  | {readonly kind: 'corner'; readonly index: number; readonly distance: number}
  | {readonly kind: 'rotate'; readonly distance: number};

/** Computes world-space corner and pedestal handle positions for `mesh`. */
// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
export function computeHandleLayout(mesh: any, viewer?: PluginViewer): HandleLayout {
  const {min, max} = computeLocalBounds(mesh);
  const m = meshWorldMatrix(viewer, mesh);
  const corners = [
    [min[0], max[1], min[2]],
    [max[0], max[1], min[2]],
    [max[0], max[1], max[2]],
    [min[0], max[1], max[2]],
  ].map((p) => transformPoint(m, p));
  const cz = (min[2] + max[2]) * 0.5;
  const drop: Vec3 = [0, -0.03, 0];
  const pedestalStart = vAdd(transformPoint(m, [min[0], min[1], cz]), drop);
  const pedestalEnd = vAdd(transformPoint(m, [max[0], min[1], cz]), drop);
  const diag = vLen(vSub(corners[0], corners[2]));
  return {
    origin: extractPosition(m),
    corners,
    pedestalStart,
    pedestalEnd,
    pedestalCenter: vScale(vAdd(pedestalStart, pedestalEnd), 0.5),
    yaw: yawFromQuat(extractQuaternion(m)),
    handleRadius: clampNum(diag * 0.06, 0.012, 0.08, 0.02),
  };
}

/** Returns the distance along a ray to its closest approach to point `p`. */
function rayPointDistance(
  origin: readonly number[],
  dir: readonly number[],
  p: readonly number[],
): {t: number; miss: number} {
  const t = Math.max(0, vDot(vSub(p, origin), dir));
  return {t, miss: vLen(vSub(vAdd(origin, vScale(dir, t)), p))};
}

/** Returns the closest-approach distance between a ray and segment `ab`. */
function raySegmentDistance(
  origin: readonly number[],
  dir: readonly number[],
  a: readonly number[],
  b: readonly number[],
): {t: number; miss: number} {
  const ab = vSub(b, a);
  const ao = vSub(origin, a);
  const abLen2 = Math.max(vDot(ab, ab), 1e-10);
  const d1 = vDot(dir, ab);
  const denom = abLen2 - d1 * d1;
  let s =
    Math.abs(denom) < 1e-10
      ? 0
      : (vDot(ao, ab) - d1 * vDot(ao, dir)) / denom;
  s = Math.max(0, Math.min(1, s));
  const onSeg = vAdd(a, vScale(ab, s));
  return rayPointDistance(origin, dir, onSeg);
}

/** Picks the nearest handle under a ray, or `null` when none is hit. */
export function pickHandle(
  layout: HandleLayout,
  origin: readonly number[],
  dir: readonly number[],
  options: HandlesOptions,
): HandleHit | null {
  let best: HandleHit | null = null;
  const r = layout.handleRadius * 1.5;
  layout.corners.forEach((c, index) => {
    const {t, miss} = rayPointDistance(origin, dir, c);
    if (miss <= r && (!best || t < best.distance)) {
      best = {kind: 'corner', index, distance: t};
    }
  });
  if (options.rotateAxis === 'y') {
    const {t, miss} = raySegmentDistance(
      origin,
      dir,
      layout.pedestalStart,
      layout.pedestalEnd,
    );
    if (miss <= r && (!best || t < (best as HandleHit).distance)) {
      best = {kind: 'rotate', distance: t};
    }
  }
  return best;
}

interface DragState {
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  readonly mesh: any;
  readonly hit: HandleHit;
  readonly hand: string;
  readonly startPoint: Vec3;
  /** Model-space (pre-root) scale, rotation and position at drag start. */
  readonly startScale: Vec3;
  readonly startQuat: [number, number, number, number];
  readonly startPos: Vec3;
  /** World-space pivot (mesh origin) used for ratios and angles. */
  readonly origin: Vec3;
  readonly options: HandlesOptions;
  readonly planeY: number;
}

function intersectHorizontalPlane(
  origin: readonly number[],
  dir: readonly number[],
  y: number,
): Vec3 | null {
  if (Math.abs(dir[1]) < 1e-6) return null;
  const t = (y - origin[1]) / dir[1];
  if (t < 0) return null;
  return vAdd(origin, vScale(dir, t));
}

/**
 * Hit-tests, drags, and renders manipulation handles for one viewer. Handle
 * geometry is created lazily and removed when a mesh loses its trait.
 */
export class XRManipulationHandlesController {
  private readonly visuals = new Map<object, {corners: unknown[]; bar: unknown}>();
  private drag: DragState | null = null;

  /** Returns the mesh currently being manipulated, if any. */
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  get activeMesh(): any {
    return this.drag?.mesh ?? null;
  }

  /**
   * Starts a handle drag when the ray picks a handle on any eligible mesh.
   * Returns the picked handle, or `null` so callers fall through to grabs.
   */
  beginDrag(
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    meshes: readonly any[],
    origin: readonly number[],
    rawDir: readonly number[],
    hand = 'screen',
    viewer?: PluginViewer,
  ): HandleHit | null {
    const dir = normalizeRayDir(rawDir);
    if (!dir) return null;
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    let picked: {mesh: any; hit: HandleHit; layout: HandleLayout; options: HandlesOptions} | null = null;
    for (const mesh of meshes) {
      if (!mesh?.transform || mesh.isPluginMesh || mesh.visible === false) continue;
      const options = parseHandles(getMeshXRTraits(mesh)?.handles);
      if (!options) continue;
      const layout = computeHandleLayout(mesh, viewer);
      const hit = pickHandle(layout, origin, dir, options);
      if (hit && (!picked || hit.distance < picked.hit.distance)) {
        picked = {mesh, hit, layout, options};
      }
    }
    if (!picked) return null;
    const {mesh, hit, layout, options} = picked;
    const startPoint =
      hit.kind === 'corner'
        ? [...layout.corners[hit.index]] as Vec3
        : intersectHorizontalPlane(origin, dir, layout.pedestalCenter[1]) ??
          [...layout.pedestalCenter] as Vec3;
    this.drag = {
      mesh,
      hit,
      hand,
      startPoint,
      startScale: extractScale(mesh.transform),
      startQuat: extractQuaternion(mesh.transform),
      startPos: extractPosition(mesh.transform),
      origin: layout.origin,
      options,
      planeY: layout.pedestalCenter[1],
    };
    return hit;
  }

  /** Applies the active drag for a new ray. Returns `false` when idle. */
  updateDrag(origin: readonly number[], rawDir: readonly number[], hand?: string): boolean {
    const d = this.drag;
    if (!d || (hand !== undefined && hand !== d.hand)) return false;
    const dir = normalizeRayDir(rawDir);
    if (!dir) return true;
    if (d.hit.kind === 'corner') {
      const t = rayPointDistance(origin, dir, d.startPoint).t;
      const p = vAdd(origin, vScale(dir, t));
      const r0 = Math.max(vLen(vSub(d.startPoint, d.origin)), 1e-4);
      const ratio = vLen(vSub(p, d.origin)) / r0;
      const s0 = d.startScale[0];
      const s = clampNum(s0 * ratio, d.options.minScale, d.options.maxScale, s0);
      const k = s / Math.max(s0, 1e-6);
      // Uniform scale about the mesh origin is identical in model and world
      // space, so apply the ratio to the model-space start scale.
      setMeshTRS(d.mesh, extractQuaternion(d.mesh.transform), d.startPos, vScale(d.startScale, k));
    } else {
      const p = intersectHorizontalPlane(origin, dir, d.planeY);
      if (!p) return true;
      const a0 = Math.atan2(d.startPoint[0] - d.origin[0], d.startPoint[2] - d.origin[2]);
      const a1 = Math.atan2(p[0] - d.origin[0], p[2] - d.origin[2]);
      // Root placement only yaws/scales/translates, so a world-Y yaw delta
      // equals a model-Y yaw delta.
      const q = quatMultiply(quatFromYaw(a1 - a0), d.startQuat);
      setMeshTRS(d.mesh, q, d.startPos, extractScale(d.mesh.transform));
    }
    return true;
  }

  /** Ends the active drag and returns a change summary (or `null`). */
  endDrag(hand?: string): {mesh: string; scale: number; yawDeg: number} | null {
    const d = this.drag;
    if (!d || (hand !== undefined && hand !== d.hand)) return null;
    this.drag = null;
    return {
      mesh: d.mesh.name ?? '',
      scale: extractScale(d.mesh.transform)[0],
      yawDeg: (yawFromQuat(extractQuaternion(d.mesh.transform)) * 180) / Math.PI,
    };
  }

  /** Creates, repositions, or removes handle visuals for the viewer's meshes. */
  syncVisuals(viewer: PluginViewer): void {
    const meshes = viewer.meshes ?? [];
    const live = new Set<object>();
    for (const mesh of [...meshes]) {
      if (!mesh?.transform || mesh.isPluginMesh) continue;
      const options = parseHandles(getMeshXRTraits(mesh)?.handles);
      if (!options) continue;
      live.add(mesh);
      let v = this.visuals.get(mesh);
      if (!v) {
        const color = [0.95, 0.95, 1.0, 0.9] as const;
        v = {
          corners: [0, 1, 2, 3].map((i) =>
            createDynamicMesh(viewer, buildBoxGeometry(0.5), {
              name: `__xr_handle_${mesh.name ?? 'mesh'}_${i}`,
              color,
              pickable: false,
            }),
          ),
          bar: createDynamicMesh(viewer, buildBoxGeometry(0.5), {
            name: `__xr_handle_${mesh.name ?? 'mesh'}_rotate`,
            color,
            pickable: false,
          }),
        };
        this.visuals.set(mesh, v);
      }
      const layout = computeHandleLayout(mesh, viewer);
      const size = layout.handleRadius * 2;
      const qYaw = quatFromYaw(layout.yaw);
      v.corners.forEach((c, i) => {
        setWorldTRS(viewer, c, qYaw, layout.corners[i], [size, size, size]);
      });
      const len = Math.max(vLen(vSub(layout.pedestalEnd, layout.pedestalStart)), size);
      setWorldTRS(viewer, v.bar, qYaw, layout.pedestalCenter, [len, size * 0.5, size]);
      (v.bar as {visible: boolean}).visible = options.rotateAxis === 'y';
    }
    for (const [mesh, v] of [...this.visuals]) {
      if (live.has(mesh) && meshes.includes(mesh)) continue;
      for (const c of v.corners) removeDynamicMesh(viewer, c);
      removeDynamicMesh(viewer, v.bar);
      this.visuals.delete(mesh);
      if (this.drag?.mesh === mesh) this.drag = null;
    }
  }

  /** Removes every handle visual from `viewer`. */
  dispose(viewer: PluginViewer | undefined): void {
    for (const v of this.visuals.values()) {
      for (const c of v.corners) removeDynamicMesh(viewer, c);
      removeDynamicMesh(viewer, v.bar);
    }
    this.visuals.clear();
    this.drag = null;
  }
}

const controllers = new WeakMap<object, XRManipulationHandlesController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the handles controller bound to `key`. */
export function getManipulationHandlesController(
  key: object,
): XRManipulationHandlesController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRManipulationHandlesController();
    controllers.set(key, c);
  }
  return c;
}

interface SelectDetail {
  readonly hand?: string;
  readonly rayOrigin?: Vec3;
  readonly rayDirection?: Vec3;
}

/** `ThreeLivePlugin` wiring XR select rays to manipulation handles. */
export const manipulationHandlesPlugin: ThreeLivePlugin = {
  name: 'xr-live-manipulation-handles',
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element || typeof element.addEventListener !== 'function') return;
    if (listeners.has(element)) return;
    const ctrl = getManipulationHandlesController(element);
    const meshesOf = (): readonly unknown[] => element._view?.meshes ?? element.viewer?.meshes ?? [];
    const onStart = (e: Event): void => {
      const d = (e as CustomEvent<SelectDetail>).detail;
      if (!d?.rayOrigin || !d.rayDirection) return;
      const viewer = element._view ?? element.viewer;
      if (ctrl.beginDrag(meshesOf(), d.rayOrigin, d.rayDirection, d.hand, viewer)) {
        // A handle owns this pinch: lower-priority plugins (paint, hold-to-ask)
        // skip it, and any whole-object grab it started is released.
        claimEvent(e);
        element.traitSystem?.endGrab?.(
          d.hand ?? 'screen',
          element.inputManager?.getHandPoses?.() ?? {},
        );
      }
    };
    const onMove = (e: Event): void => {
      const d = (e as CustomEvent<SelectDetail>).detail;
      if (d?.rayOrigin && d.rayDirection) ctrl.updateDrag(d.rayOrigin, d.rayDirection, d.hand);
    };
    const onEnd = (e: Event): void => {
      const summary = ctrl.endDrag((e as CustomEvent<SelectDetail>).detail?.hand);
      if (summary) emitPluginEvent(element, 'xr-handles-change', summary);
    };
    const bound: Array<[string, EventListener]> = [
      ['xr-select-start', onStart],
      ['xr-select-move', onMove],
      ['xr-select-end', onEnd],
    ];
    for (const [name, fn] of bound) element.addEventListener(name, fn);
    listeners.set(element, bound);
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    const bound = listeners.get(element);
    if (bound) {
      for (const [name, fn] of bound) element.removeEventListener?.(name, fn);
      listeners.delete(element);
    }
    controllers.get(element)?.dispose(element._view ?? element.viewer);
  },
  onUpdate(viewer: PluginViewer): void {
    const host = viewer?.container;
    if (!host || !Array.isArray(viewer.meshes) || isXRFrameFresh(viewer)) return;
    getManipulationHandlesController(host).syncVisuals(viewer);
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    const host = v?.container;
    if (!host || !Array.isArray(v.meshes)) return;
    cacheXRFrame(v, frame, refSpace);
    getManipulationHandlesController(host).syncVisuals(v);
  },
};
