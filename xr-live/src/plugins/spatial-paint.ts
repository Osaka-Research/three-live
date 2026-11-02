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
 * @fileoverview Spatial `spatial-paint` plugin for `<xr-live>`.
 *
 * Add the `spatial-paint` attribute (optionally `spatial-paint="#ff3366"`) and
 * pinch / trigger in empty space to draw. Stroke points are smoothed with a
 * uniform Catmull-Rom spline and extruded into tubes using
 * parallel-transport frames (no twisting). Emits `xr-paint-stroke` with
 * `{index, points, lengthMeters}` when a stroke ends.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  clampNum,
  createDynamicMesh,
  type DynamicGeometry,
  emitPluginEvent,
  type PluginViewer,
  applyWorldMatrix,
  isEventClaimed,
  reattachDynamicMesh,
  removeDynamicMesh,
  updateDynamicMesh,
  vAdd,
  vCross,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Vec3,
} from './common';

/** Maximum raw input points retained per stroke. */
export const MAX_STROKE_POINTS = 2048;
/** Maximum strokes retained per element (oldest are evicted). */
export const MAX_STROKES = 256;

/** Evaluates a uniform Catmull-Rom spline segment between `p1` and `p2`. */
export function catmullRom(
  p0: readonly number[],
  p1: readonly number[],
  p2: readonly number[],
  p3: readonly number[],
  t: number,
): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: Vec3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    out[a] =
      0.5 *
      (2 * p1[a] +
        (-p0[a] + p2[a]) * t +
        (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 +
        (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3);
  }
  return out;
}

/** Options for {@link TubeStrokeBuilder}. */
export interface TubeOptions {
  readonly radius?: number;
  readonly radialSegments?: number;
  readonly samplesPerSpan?: number;
  readonly minSpacing?: number;
}

/**
 * Accumulates 3D stroke points and builds a smoothed, capped tube mesh.
 * Mirrors `TubeStrokeBuilder` in the Android and iOS runtime sessions.
 */
export class TubeStrokeBuilder {
  readonly points: Vec3[] = [];
  readonly radius: number;
  private readonly radial: number;
  private readonly samples: number;
  private readonly minSpacing: number;

  constructor(options: TubeOptions = {}) {
    this.radius = clampNum(options.radius, 0.0005, 0.25, 0.006);
    this.radial = Math.round(clampNum(options.radialSegments, 3, 32, 8));
    this.samples = Math.round(clampNum(options.samplesPerSpan, 1, 16, 4));
    this.minSpacing = clampNum(options.minSpacing, 0, 0.5, 0.004);
  }

  /**
   * Adds a point, ignoring non-finite input, points closer than `minSpacing`
   * to the previous point, and points beyond {@link MAX_STROKE_POINTS}.
   * Returns whether the point was accepted.
   */
  addPoint(p: readonly number[]): boolean {
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) {
      return false;
    }
    if (this.points.length >= MAX_STROKE_POINTS) return false;
    const last = this.points[this.points.length - 1];
    if (last && vLen(vSub(p, last)) < this.minSpacing) return false;
    this.points.push([p[0], p[1], p[2]]);
    return true;
  }

  /** Returns the polyline length of the raw points in meters. */
  get lengthMeters(): number {
    let len = 0;
    for (let i = 1; i < this.points.length; i++) len += vLen(vSub(this.points[i], this.points[i - 1]));
    return len;
  }

  /** Returns the Catmull-Rom-smoothed centerline. */
  smoothedPoints(): Vec3[] {
    const pts = this.points;
    if (pts.length < 3) return pts.map((p) => [...p] as Vec3);
    const out: Vec3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      for (let s = 0; s < this.samples; s++) {
        out.push(catmullRom(p0, pts[i], pts[i + 1], p3, s / this.samples));
      }
    }
    out.push([...pts[pts.length - 1]] as Vec3);
    return out;
  }

  /**
   * Builds the tube geometry (with end caps). Returns `null` for fewer than
   * two points. A single repeated point yields no geometry.
   */
  build(): DynamicGeometry | null {
    const center = this.smoothedPoints();
    if (center.length < 2) return null;
    const n = center.length;
    const radial = this.radial;
    const ringVerts = n * radial;
    // Side rings, then two cap rings (duplicated with axial normals) and two
    // cap centers so caps shade flat instead of inheriting radial normals.
    const vertexCount = ringVerts + radial * 2 + 2;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const triCount = (n - 1) * radial * 2 + radial * 2;
    const indices =
      vertexCount > 65535 ? new Uint32Array(triCount * 3) : new Uint16Array(triCount * 3);

    const tangents: Vec3[] = center.map((_, i) =>
      vNorm(vSub(center[Math.min(n - 1, i + 1)], center[Math.max(0, i - 1)]), [0, 0, 1]),
    );
    // Rotation-minimizing frames via the double-reflection method (Wang et al.
    // 2008): stable through sharp turns and full reversals, unlike projection.
    let normal = vNorm(
      vCross(tangents[0], Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]),
    );
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        const v1 = vSub(center[i], center[i - 1]);
        const c1 = vDot(v1, v1);
        if (c1 > 1e-12) {
          const rL = vSub(normal, vScale(v1, (2 / c1) * vDot(v1, normal)));
          const tL = vSub(tangents[i - 1], vScale(v1, (2 / c1) * vDot(v1, tangents[i - 1])));
          const v2 = vSub(tangents[i], tL);
          const c2 = vDot(v2, v2);
          normal = c2 > 1e-12 ? vSub(rL, vScale(v2, (2 / c2) * vDot(v2, rL))) : rL;
        }
        // Guard against drift: keep the frame orthonormal.
        normal = vNorm(vSub(normal, vScale(tangents[i], vDot(normal, tangents[i]))), normal);
      }
      const binormal = vCross(tangents[i], normal);
      for (let r = 0; r < radial; r++) {
        const a = (r / radial) * Math.PI * 2;
        const dir = vAdd(vScale(normal, Math.cos(a)), vScale(binormal, Math.sin(a)));
        const o = (i * radial + r) * 3;
        positions.set(vAdd(center[i], vScale(dir, this.radius)), o);
        normals.set(dir, o);
      }
    }
    const startRing = ringVerts;
    const endRing = ringVerts + radial;
    const capStart = ringVerts + radial * 2;
    const capEnd = capStart + 1;
    const startNormal = vScale(tangents[0], -1);
    const endNormal = tangents[n - 1];
    for (let r = 0; r < radial; r++) {
      positions.set(positions.subarray(r * 3, r * 3 + 3), (startRing + r) * 3);
      normals.set(startNormal, (startRing + r) * 3);
      const last = ((n - 1) * radial + r) * 3;
      positions.set(positions.subarray(last, last + 3), (endRing + r) * 3);
      normals.set(endNormal, (endRing + r) * 3);
    }
    positions.set(center[0], capStart * 3);
    normals.set(startNormal, capStart * 3);
    positions.set(center[n - 1], capEnd * 3);
    normals.set(endNormal, capEnd * 3);

    let k = 0;
    for (let i = 0; i < n - 1; i++) {
      for (let r = 0; r < radial; r++) {
        const a = i * radial + r;
        const b = i * radial + ((r + 1) % radial);
        const c = a + radial;
        const d = b + radial;
        // Counter-clockwise when viewed from outside the tube.
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = c;
      }
    }
    for (let r = 0; r < radial; r++) {
      const r1 = (r + 1) % radial;
      indices[k++] = capStart;
      indices[k++] = startRing + r1;
      indices[k++] = startRing + r;
      indices[k++] = capEnd;
      indices[k++] = endRing + r;
      indices[k++] = endRing + r1;
    }
    return {positions, normals, indices};
  }
}

/** Parses a `#rgb` / `#rrggbb` color into linear-ish RGBA (alpha 1). */
export function parseHexColor(raw: string | null | undefined): [number, number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((raw ?? '').trim());
  if (!m) return [1, 0.25, 0.45, 1];
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

interface Stroke {
  readonly builder: TubeStrokeBuilder;
  // tslint:disable-next-line:no-any GPU mesh struct.
  mesh: any;
}

/** Manages strokes for one element: begin / extend / end, undo, and clear. */
export class XRSpatialPaintController {
  readonly strokes: Stroke[] = [];
  private active: {stroke: Stroke; hand: string} | null = null;
  color: [number, number, number, number] = [1, 0.25, 0.45, 1];
  radius = 0.006;

  /** Starts a stroke for `hand` at `point`. */
  begin(viewer: PluginViewer, point: readonly number[], hand = 'screen'): void {
    this.end(viewer);
    if (this.strokes.length >= MAX_STROKES) {
      removeDynamicMesh(viewer, this.strokes.shift()?.mesh);
    }
    const stroke: Stroke = {builder: new TubeStrokeBuilder({radius: this.radius}), mesh: null};
    stroke.builder.addPoint(point);
    this.strokes.push(stroke);
    this.active = {stroke, hand};
  }

  /**
   * Extends the active stroke; returns whether geometry changed. The tube is
   * re-extruded every `rebuildEvery` accepted points (and always on `end`) to
   * bound the per-event cost of long strokes.
   */
  extend(viewer: PluginViewer, point: readonly number[], hand?: string, rebuildEvery = 3): boolean {
    const a = this.active;
    if (!a || (hand !== undefined && hand !== a.hand)) return false;
    if (!a.stroke.builder.addPoint(point)) return false;
    const count = a.stroke.builder.points.length;
    if (a.stroke.mesh && count % Math.max(1, rebuildEvery) !== 0) return false;
    return this.rebuild(viewer, a.stroke);
  }

  private rebuild(viewer: PluginViewer, stroke: Stroke): boolean {
    const geometry = stroke.builder.build();
    if (!geometry) return false;
    if (stroke.mesh) {
      updateDynamicMesh(viewer, stroke.mesh, geometry);
    } else {
      stroke.mesh = createDynamicMesh(viewer, geometry, {
        name: `__xr_paint_${this.strokes.indexOf(stroke)}`,
        color: this.color,
        roughness: 0.45,
        pickable: false,
        worldSpace: true,
      });
    }
    return true;
  }


  /** Ends the active stroke and returns its summary (or `null`). */
  end(viewer: PluginViewer | undefined, hand?: string): {index: number; points: number; lengthMeters: number} | null {
    const a = this.active;
    if (!a || (hand !== undefined && hand !== a.hand)) return null;
    this.active = null;
    if (viewer) this.rebuild(viewer, a.stroke);
    const index = this.strokes.indexOf(a.stroke);
    if (!a.stroke.mesh) {
      // Taps without movement leave no geometry behind.
      this.strokes.splice(index, 1);
      return null;
    }
    return {index, points: a.stroke.builder.points.length, lengthMeters: a.stroke.builder.lengthMeters};
  }

  /** Removes the most recent stroke. */
  undo(viewer: PluginViewer | undefined): void {
    const s = this.strokes.pop();
    if (s && this.active?.stroke === s) this.active = null;
    removeDynamicMesh(viewer, s?.mesh);
  }

  /** Removes every stroke. */
  clear(viewer: PluginViewer | undefined): void {
    while (this.strokes.length) this.undo(viewer);
  }

  /**
   * Keeps strokes pinned in world space when the root placement changes and
   * re-uploads strokes whose GPU buffers were freed by a model reload.
   */
  sync(viewer: PluginViewer): void {
    for (const s of this.strokes) {
      if (!s.mesh) continue;
      reattachDynamicMesh(viewer, s.mesh);
      applyWorldMatrix(viewer, s.mesh);
    }
  }

  /** Returns each finished stroke's tube geometry (for GLB/USDZ export). */
  geometries(): DynamicGeometry[] {
    const out: DynamicGeometry[] = [];
    for (const s of this.strokes) {
      const g = s.builder.build();
      if (g) out.push(g);
    }
    return out;
  }
}

const controllers = new WeakMap<object, XRSpatialPaintController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the paint controller for `element`. */
export function getSpatialPaintController(element: object): XRSpatialPaintController {
  let c = controllers.get(element);
  if (!c) {
    c = new XRSpatialPaintController();
    controllers.set(element, c);
  }
  return c;
}

interface SelectDetail {
  readonly hand?: string;
  readonly pivotPosition?: Vec3;
  readonly rayOrigin?: Vec3;
  readonly rayDirection?: Vec3;
  readonly hit?: unknown;
}

/** Distance in front of a screen/camera ray at which strokes are drawn. */
const SCREEN_PAINT_DEPTH = 0.4;

/**
 * Returns the paint point for an input event: the pinch/controller pivot for
 * tracked hands, or a point in front of the camera for screen rays (whose
 * origin is the eye and would otherwise paint on the near plane).
 */
export function paintPointFor(d: SelectDetail | undefined): Vec3 | null {
  if (!d) return null;
  if (d.hand === 'screen' && d.rayOrigin && d.rayDirection) {
    const dir = vNorm(d.rayDirection);
    return vAdd(d.rayOrigin, vScale(dir, SCREEN_PAINT_DEPTH));
  }
  return d.pivotPosition ? [...d.pivotPosition] as Vec3 : null;
}

/** `ThreeLivePlugin` that turns empty-space pinches into 3D paint strokes. */
export const spatialPaintPlugin: ThreeLivePlugin = {
  name: 'xr-live-spatial-paint',
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element || typeof element.addEventListener !== 'function' || listeners.has(element)) return;
    const ctrl = getSpatialPaintController(element);
    const enabled = (): boolean =>
      typeof element.hasAttribute === 'function' &&
      element.hasAttribute('spatial-paint') &&
      element.getAttribute('spatial-paint') !== 'false';
    const viewerOf = (): PluginViewer | undefined => element._view ?? element.viewer;
    const onStart = (e: Event): void => {
      const d = (e as CustomEvent<SelectDetail>).detail;
      const viewer = viewerOf();
      const point = paintPointFor(d);
      if (!enabled() || !viewer || d?.hit || !point || isEventClaimed(e)) return;
      ctrl.color = parseHexColor(element.getAttribute('spatial-paint'));
      ctrl.begin(viewer, point, d.hand);
    };
    const onMove = (e: Event): void => {
      const d = (e as CustomEvent<SelectDetail>).detail;
      const viewer = viewerOf();
      const point = paintPointFor(d);
      if (viewer && point) ctrl.extend(viewer, point, d.hand);
    };
    const onEnd = (e: Event): void => {
      const summary = ctrl.end(viewerOf(), (e as CustomEvent<SelectDetail>).detail?.hand);
      if (summary) emitPluginEvent(element, 'xr-paint-stroke', summary);
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
    for (const [name, fn] of listeners.get(element) ?? []) element.removeEventListener?.(name, fn);
    listeners.delete(element);
    controllers.get(element)?.clear(element._view ?? element.viewer);
  },
  onUpdate(viewer: PluginViewer): void {
    const host = viewer?.container;
    if (host && Array.isArray(viewer.meshes)) controllers.get(host)?.sync(viewer);
  },
  onXRFrame(viewer: unknown): void {
    const v = viewer as PluginViewer;
    const host = v?.container;
    if (host && Array.isArray(v.meshes)) controllers.get(host)?.sync(v);
  },
};
