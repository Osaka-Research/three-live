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
 * @fileoverview `spatial-measure` plugin for `<xr-live>`.
 *
 * Provides live 3D bounding-box dimension callouts (`W × H × D` guide bars +
 * camera-facing vector-glyph labels) and an interactive point-to-point AR/3D
 * tape measure that emits `measurecomplete`.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  parseDimensions,
  type DimensionAxis,
  type DimensionsOptions,
  type DimensionUnit,
} from '../../../three-live/src/xr-trait-schema';
import {
  computeBillboardQuaternion,
  getMeshXRTraits,
} from '../xr-traits';
import {
  applyWorldMatrix,
  cacheXRFrame,
  claimEvent,
  computeLocalBounds,
  createDynamicMesh,
  type DynamicGeometry,
  emitPluginEvent,
  isEventClaimed,
  isXRFrameFresh,
  meshWorldMatrix,
  normalizeRayDir,
  type PluginViewer,
  reattachDynamicMesh,
  removeDynamicMesh,
  resolveHeadPose,
  setWorldTRS,
  updateDynamicMesh,
  vAdd,
  vCross,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Vec3,
} from './common';
import {parseHexColor} from './spatial-paint';
import {
  getWorldUnderstandingController,
  hitTestPlanes,
  type TrackedPlane,
} from './world-understanding';

export {
  parseDimensions,
  type DimensionAxis,
  type DimensionsOptions,
  type DimensionUnit,
};

/** Maximum retained interactive tape-measure segments per element. */
export const MAX_TAPE_SEGMENTS = 16;
/** Maximum active 3D dimension labels per element. */
export const MAX_DIMENSION_LABELS = 32;
/** Default world-space offset of callout guide lines outside the AABB (meters). */
export const CALLOUT_OFFSET_METERS = 0.04;
/** Default half-length of perpendicular end-ticks on callout lines (meters). */
export const CALLOUT_TICK_HALF_METERS = 0.015;

const METERS_PER_INCH = 0.0254;

/**
 * Formats a metric distance into a human-readable spatial measurement string.
 * Mirrors `SpatialMeasure.formatDimension` on Android and iOS/visionOS.
 */
export function formatSpatialDimension(
  meters: number,
  unit: DimensionUnit = 'auto',
): string {
  const d = Number.isFinite(meters) && meters >= 0 ? meters : 0;
  const resolved: Exclude<DimensionUnit, 'auto'> =
    unit === 'auto' ? (d < 1.0 ? 'cm' : 'm') : unit;
  switch (resolved) {
    case 'mm':
      return `${Math.round(d * 1000)} mm`;
    case 'cm':
      return `${(d * 100).toFixed(1)} cm`;
    case 'in':
      return `${(d / METERS_PER_INCH).toFixed(1)} in`;
    case 'ft-in': {
      const totalInches = d / METERS_PER_INCH;
      let feet = Math.floor(totalInches / 12);
      let inches = Math.round((totalInches - feet * 12) * 10) / 10;
      if (inches >= 12.0) {
        feet += 1;
        inches = 0;
      }
      return `${feet}' ${inches.toFixed(1)}"`;
    }
    case 'm':
    default:
      return `${d.toFixed(2)} m`;
  }
}

/** World-space axis-aligned bounding box with extents. */
export interface WorldBounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly size: Vec3;
}

/**
 * Computes the world-space AABB of a local `[localMin, localMax]` box
 * transformed by column-major 4x4 `worldMatrix`.
 */
export function computeWorldBounds(
  localMin: readonly number[],
  localMax: readonly number[],
  worldMatrix: ArrayLike<number>,
): WorldBounds {
  const tx = worldMatrix[12] ?? 0;
  const ty = worldMatrix[13] ?? 0;
  const tz = worldMatrix[14] ?? 0;
  const min: Vec3 = [tx, ty, tz];
  const max: Vec3 = [tx, ty, tz];
  for (let col = 0; col < 3; col++) {
    const lo = localMin[col] ?? 0;
    const hi = localMax[col] ?? 0;
    for (let row = 0; row < 3; row++) {
      const m = worldMatrix[col * 4 + row] ?? (col === row ? 1 : 0);
      const a = m * lo;
      const b = m * hi;
      min[row] += Math.min(a, b);
      max[row] += Math.max(a, b);
    }
  }
  if (!min.every(Number.isFinite) || !max.every(Number.isFinite)) {
    return {min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5], size: [1, 1, 1]};
  }
  return {
    min,
    max,
    size: [
      Math.max(0, max[0] - min[0]),
      Math.max(0, max[1] - min[1]),
      Math.max(0, max[2] - min[2]),
    ],
  };
}

/** Descriptor for one axis callout bar, end-ticks, and label anchor. */
export interface DimensionCallout {
  readonly axis: DimensionAxis;
  readonly start: Vec3;
  readonly end: Vec3;
  readonly tickStartA: Vec3;
  readonly tickStartB: Vec3;
  readonly tickEndA: Vec3;
  readonly tickEndB: Vec3;
  readonly labelPosition: Vec3;
  readonly lengthMeters: number;
}

/**
 * Builds world-space dimension callout descriptors along the requested axes of
 * an AABB `[min, max]`, offset outside the box by `offset` meters.
 */
export function buildDimensionCallouts(
  min: readonly number[],
  max: readonly number[],
  axes: readonly DimensionAxis[] = ['x', 'y', 'z'],
  offset = CALLOUT_OFFSET_METERS,
  tickHalf = CALLOUT_TICK_HALF_METERS,
): DimensionCallout[] {
  const out: DimensionCallout[] = [];
  const off = Number.isFinite(offset) ? Math.max(0.005, offset) : CALLOUT_OFFSET_METERS;
  const tick = Number.isFinite(tickHalf) ? Math.max(0.003, tickHalf) : CALLOUT_TICK_HALF_METERS;

  for (const axis of axes) {
    if (axis === 'x') {
      const len = Math.max(0, max[0] - min[0]);
      const y = min[1] - off * 0.5;
      const z = max[2] + off;
      const start: Vec3 = [min[0], y, z];
      const end: Vec3 = [max[0], y, z];
      out.push({
        axis: 'x',
        start,
        end,
        tickStartA: [min[0], y - tick, z],
        tickStartB: [min[0], y + tick, z],
        tickEndA: [max[0], y - tick, z],
        tickEndB: [max[0], y + tick, z],
        labelPosition: [(min[0] + max[0]) * 0.5, y - tick * 1.8, z],
        lengthMeters: len,
      });
    } else if (axis === 'y') {
      const len = Math.max(0, max[1] - min[1]);
      const x = max[0] + off;
      const z = max[2] + off;
      const start: Vec3 = [x, min[1], z];
      const end: Vec3 = [x, max[1], z];
      out.push({
        axis: 'y',
        start,
        end,
        tickStartA: [x - tick, min[1], z],
        tickStartB: [x + tick, min[1], z],
        tickEndA: [x - tick, max[1], z],
        tickEndB: [x + tick, max[1], z],
        labelPosition: [x + tick * 2.4, (min[1] + max[1]) * 0.5, z],
        lengthMeters: len,
      });
    } else if (axis === 'z') {
      const len = Math.max(0, max[2] - min[2]);
      const x = max[0] + off;
      const y = min[1] - off * 0.5;
      const start: Vec3 = [x, y, min[2]];
      const end: Vec3 = [x, y, max[2]];
      out.push({
        axis: 'z',
        start,
        end,
        tickStartA: [x - tick, y, min[2]],
        tickStartB: [x + tick, y, min[2]],
        tickEndA: [x - tick, y, max[2]],
        tickEndB: [x + tick, y, max[2]],
        labelPosition: [x + tick * 2.4, y, (min[2] + max[2]) * 0.5],
        lengthMeters: len,
      });
    }
  }
  return out;
}

const BOX_CORNERS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/**
 * Builds a single batched 3D rectangular-bar mesh from 3D line segments `[a, b]`.
 */
export function buildSegmentBarsGeometry(
  segments: ReadonlyArray<readonly [Vec3, Vec3]>,
  halfThickness = 0.002,
): DynamicGeometry {
  const valid = segments.filter(([a, b]) => vLen(vSub(b, a)) > 1e-5);
  if (valid.length === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }
  const r = Math.max(0.0005, halfThickness);
  const vertCount = valid.length * 24;
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices =
    vertCount > 65535
      ? new Uint32Array(valid.length * 36)
      : new Uint16Array(valid.length * 36);

  let vOut = 0;
  let iOut = 0;
  for (const [a, b] of valid) {
    const mid: Vec3 = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5, (a[2] + b[2]) * 0.5];
    const diff = vSub(b, a);
    const halfLen = vLen(diff) * 0.5;
    const t = vNorm(diff, [1, 0, 0]);
    const ref: Vec3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = vNorm(vCross(t, ref), [0, 0, 1]);
    const v = vNorm(vCross(t, u), [0, 1, 0]);

    const axes: Array<[Vec3, Vec3, Vec3, number, number, number]> = [
      [t, u, v, halfLen, r, r],
      [vScale(t, -1), u, vScale(v, -1), halfLen, r, r],
      [u, v, t, r, r, halfLen],
      [vScale(u, -1), v, vScale(t, -1), r, r, halfLen],
      [v, t, u, r, halfLen, r],
      [vScale(v, -1), vScale(t, -1), u, r, halfLen, r],
    ];
    for (const [fn, fu, fv, dn, du, dv] of axes) {
      const base = vOut;
      for (const [su, sv] of BOX_CORNERS) {
        const px = mid[0] + fn[0] * dn + fu[0] * (du * su) + fv[0] * (dv * sv);
        const py = mid[1] + fn[1] * dn + fu[1] * (du * su) + fv[1] * (dv * sv);
        const pz = mid[2] + fn[2] * dn + fu[2] * (du * su) + fv[2] * (dv * sv);
        positions[vOut * 3] = px;
        positions[vOut * 3 + 1] = py;
        positions[vOut * 3 + 2] = pz;
        normals[vOut * 3] = fn[0];
        normals[vOut * 3 + 1] = fn[1];
        normals[vOut * 3 + 2] = fn[2];
        vOut++;
      }
      indices[iOut++] = base;
      indices[iOut++] = base + 1;
      indices[iOut++] = base + 2;
      indices[iOut++] = base;
      indices[iOut++] = base + 2;
      indices[iOut++] = base + 3;
    }
  }
  return {positions, normals, indices};
}

/** Builds dashed 3D segment pairs between `start` and `end`. */
export function buildDashedSegments(
  start: Vec3,
  end: Vec3,
  dashLength = 0.03,
  gapLength = 0.02,
  maxDashes = 128,
): Array<[Vec3, Vec3]> {
  const diff = vSub(end, start);
  const total = vLen(diff);
  if (total <= 1e-4) return [];
  const dir = vScale(diff, 1 / total);
  const stride = Math.max(0.005, dashLength + gapLength);
  const count = Math.min(maxDashes, Math.max(1, Math.ceil(total / stride)));
  const actualStride = total / count;
  const dash = Math.min(dashLength, actualStride * 0.65);
  const out: Array<[Vec3, Vec3]> = [];
  for (let i = 0; i < count; i++) {
    const t0 = i * actualStride;
    const t1 = Math.min(total, t0 + dash);
    if (t1 - t0 > 1e-4) {
      out.push([vAdd(start, vScale(dir, t0)), vAdd(start, vScale(dir, t1))]);
    }
  }
  return out;
}

/**
 * Compact 2D stroke font in `[0..1] x [0..1]` glyph space for crisp,
 * zero-texture 3D dimension labels (`0-9`, `.`, `-`, `'`, `"`, `m`, `c`, `i`, `n`).
 */
const GLYPH_STROKES: Readonly<Record<string, ReadonlyArray<readonly [number, number, number, number]>>> = {
  '0': [[0.1, 0, 0.9, 0], [0.9, 0, 0.9, 1], [0.9, 1, 0.1, 1], [0.1, 1, 0.1, 0]],
  '1': [[0.5, 0, 0.5, 1], [0.25, 0.8, 0.5, 1], [0.2, 0, 0.8, 0]],
  '2': [[0.1, 1, 0.9, 1], [0.9, 1, 0.9, 0.5], [0.9, 0.5, 0.1, 0.5], [0.1, 0.5, 0.1, 0], [0.1, 0, 0.9, 0]],
  '3': [[0.1, 1, 0.9, 1], [0.9, 1, 0.9, 0], [0.1, 0.5, 0.9, 0.5], [0.1, 0, 0.9, 0]],
  '4': [[0.1, 1, 0.1, 0.5], [0.1, 0.5, 0.9, 0.5], [0.8, 1, 0.8, 0]],
  '5': [[0.9, 1, 0.1, 1], [0.1, 1, 0.1, 0.5], [0.1, 0.5, 0.9, 0.5], [0.9, 0.5, 0.9, 0], [0.9, 0, 0.1, 0]],
  '6': [[0.9, 1, 0.1, 1], [0.1, 1, 0.1, 0], [0.1, 0, 0.9, 0], [0.9, 0, 0.9, 0.5], [0.9, 0.5, 0.1, 0.5]],
  '7': [[0.1, 1, 0.9, 1], [0.9, 1, 0.4, 0]],
  '8': [[0.1, 0, 0.9, 0], [0.9, 0, 0.9, 1], [0.9, 1, 0.1, 1], [0.1, 1, 0.1, 0], [0.1, 0.5, 0.9, 0.5]],
  '9': [[0.1, 0, 0.9, 0], [0.9, 0, 0.9, 1], [0.9, 1, 0.1, 1], [0.1, 1, 0.1, 0.5], [0.1, 0.5, 0.9, 0.5]],
  '.': [[0.4, 0, 0.6, 0], [0.5, 0, 0.5, 0.15]],
  '-': [[0.15, 0.5, 0.85, 0.5]],
  "'": [[0.5, 1, 0.45, 0.68]],
  '"': [[0.32, 1, 0.28, 0.68], [0.68, 1, 0.64, 0.68]],
  'c': [[0.85, 0.6, 0.15, 0.6], [0.15, 0.6, 0.15, 0], [0.15, 0, 0.85, 0]],
  'm': [[0.08, 0, 0.08, 0.6], [0.08, 0.6, 0.5, 0.6], [0.5, 0.6, 0.5, 0], [0.5, 0.6, 0.92, 0.6], [0.92, 0.6, 0.92, 0]],
  'i': [[0.5, 0, 0.5, 0.58], [0.5, 0.76, 0.5, 0.9]],
  'n': [[0.15, 0, 0.15, 0.6], [0.15, 0.6, 0.85, 0.6], [0.85, 0.6, 0.85, 0]],
};

/**
 * Generates crisp, double-sided 3D vector-glyph geometry centered at `(0, 0, 0)`
 * in the XY plane facing `+Z` so camera-facing billboarding requires zero textures.
 */
export function buildVectorLabelGeometry(
  text: string,
  charHeight = 0.028,
  strokeWidth = 0.0038,
): DynamicGeometry {
  const clean = String(text ?? '').slice(0, 32);
  const h = Math.max(0.004, charHeight);
  const w = h * 0.62;
  const advance = w * 1.28;
  const halfStroke = Math.max(0.0005, strokeWidth * 0.5);

  const quads: Array<[number, number, number, number]> = [];
  let cursorX = 0;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === ' ') {
      cursorX += advance * 0.65;
      continue;
    }
    const strokes = GLYPH_STROKES[ch] ?? GLYPH_STROKES[ch.toLowerCase()];
    if (strokes) {
      for (const [x0, y0, x1, y1] of strokes) {
        quads.push([cursorX + x0 * w, y0 * h, cursorX + x1 * w, y1 * h]);
      }
    }
    cursorX += ch === '.' || ch === "'" ? advance * 0.55 : advance;
  }

  if (quads.length === 0) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }

  const totalWidth = Math.max(0, cursorX - advance * 0.28);
  const offsetX = -totalWidth * 0.5;
  const offsetY = -h * 0.5;
  // Front + back faces so labels remain readable from any angle.
  const positions = new Float32Array(quads.length * 8 * 3);
  const normals = new Float32Array(quads.length * 8 * 3);
  const indices = new Uint16Array(quads.length * 12);

  let v = 0;
  let k = 0;
  for (const [ax, ay, bx, by] of quads) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * halfStroke;
    const ny = (dx / len) * halfStroke;
    const ex = (dx / len) * halfStroke * 0.5;
    const ey = (dy / len) * halfStroke * 0.5;
    const x0 = ax - ex + offsetX;
    const y0 = ay - ey + offsetY;
    const x1 = bx + ex + offsetX;
    const y1 = by + ey + offsetY;
    const pts: Array<[number, number]> = [
      [x0 - nx, y0 - ny],
      [x1 - nx, y1 - ny],
      [x1 + nx, y1 + ny],
      [x0 + nx, y0 + ny],
    ];
    const frontBase = v;
    for (const [px, py] of pts) {
      positions[v * 3] = px;
      positions[v * 3 + 1] = py;
      positions[v * 3 + 2] = 0.0005;
      normals[v * 3 + 2] = 1;
      v++;
    }
    indices.set(
      [frontBase, frontBase + 1, frontBase + 2, frontBase, frontBase + 2, frontBase + 3],
      k,
    );
    k += 6;

    const backBase = v;
    for (const [px, py] of pts) {
      positions[v * 3] = px;
      positions[v * 3 + 1] = py;
      positions[v * 3 + 2] = -0.0005;
      normals[v * 3 + 2] = -1;
      v++;
    }
    indices.set(
      [backBase, backBase + 2, backBase + 1, backBase, backBase + 3, backBase + 2],
      k,
    );
    k += 6;
  }

  return {positions, normals, indices};
}

interface NodeCalloutVisual {
  // tslint:disable-next-line:no-any GPU mesh struct.
  barMesh: any;
  // tslint:disable-next-line:no-any GPU mesh structs.
  labelMeshes: any[];
  labelPositions: Vec3[];
  cacheKey: string;
}

/** Completed or live AR tape-measure segment. */
export interface TapeSegmentRecord {
  readonly start: Vec3;
  readonly end: Vec3;
  readonly distanceMeters: number;
  readonly formatted: string;
  // tslint:disable-next-line:no-any GPU mesh struct.
  lineMesh: any;
  // tslint:disable-next-line:no-any GPU mesh struct.
  labelMesh: any;
}

/** Resolved `<xr-live>` element-level `spatial-measure` settings. */
export interface SpatialMeasureElementConfig {
  readonly boundsEnabled: boolean;
  readonly tapeEnabled: boolean;
  readonly defaultUnit: DimensionUnit;
  readonly disabled?: boolean;
}

/** Parses `spatial-measure` and `measure-unit` attributes on `<xr-live>`. */
// tslint:disable-next-line:no-any Host element is `<xr-live>`.
export function resolveSpatialMeasureConfig(element: any): SpatialMeasureElementConfig {
  const hasAttr = typeof element?.hasAttribute === 'function' && element.hasAttribute('spatial-measure');
  const rawMode = (element?.getAttribute?.('spatial-measure') ?? '').trim().toLowerCase();
  const rawUnit = (element?.getAttribute?.('measure-unit') ?? 'auto').trim().toLowerCase();
  const unit: DimensionUnit =
    rawUnit === 'm' || rawUnit === 'cm' || rawUnit === 'mm' || rawUnit === 'in' || rawUnit === 'ft-in'
      ? rawUnit
      : 'auto';
  if (hasAttr && (rawMode === 'false' || rawMode === 'none' || rawMode === 'off')) {
    return {boundsEnabled: false, tapeEnabled: false, defaultUnit: unit, disabled: true};
  }
  if (!hasAttr) {
    return {boundsEnabled: false, tapeEnabled: false, defaultUnit: unit, disabled: false};
  }
  if (rawMode === 'tape') {
    return {boundsEnabled: false, tapeEnabled: true, defaultUnit: unit, disabled: false};
  }
  if (rawMode === 'both' || rawMode === 'all') {
    return {boundsEnabled: true, tapeEnabled: true, defaultUnit: unit, disabled: false};
  }
  // `""`, `"bounds"`, or `"true"` enables bounding-box callouts.
  return {boundsEnabled: true, tapeEnabled: false, defaultUnit: unit, disabled: false};
}

function quantKey(v: readonly number[]): string {
  return `${Math.round(v[0] * 1000)},${Math.round(v[1] * 1000)},${Math.round(v[2] * 1000)}`;
}

/**
 * Per-element controller driving bounding-box dimension callouts and interactive
 * point-to-point AR tape measurements.
 */
export class XRSpatialMeasureController {
  private readonly nodeVisuals = new Map<object, NodeCalloutVisual>();
  readonly tapeSegments: TapeSegmentRecord[] = [];
  private activeTape: {
    hand: string;
    start: Vec3;
    current: Vec3;
    // tslint:disable-next-line:no-any GPU mesh struct.
    lineMesh: any;
    // tslint:disable-next-line:no-any GPU mesh struct.
    labelMesh: any;
  } | null = null;
  private lastTapMs = 0;

  /** Starts a live tape-measure segment at `start`. */
  beginTape(viewer: PluginViewer, start: Vec3, hand = 'screen', unit: DimensionUnit = 'auto'): void {
    this.cancelActiveTape(viewer);
    const lineGeo = buildSegmentBarsGeometry([[start, start]], 0.0025);
    const labelGeo = buildVectorLabelGeometry(formatSpatialDimension(0, unit));
    const lineMesh = createDynamicMesh(viewer, lineGeo, {
      name: '__xr_tape_active_line__',
      color: [0.22, 0.74, 0.97, 1],
      roughness: 0.3,
      pickable: false,
      worldSpace: true,
    });
    const labelMesh = createDynamicMesh(viewer, labelGeo, {
      name: '__xr_tape_active_label__',
      color: [1, 1, 1, 1],
      roughness: 0.2,
      pickable: false,
      worldSpace: true,
    });
    setWorldTRS(viewer, labelMesh, [0, 0, 0, 1], [start[0], start[1] + 0.03, start[2]], [1, 1, 1]);
    this.activeTape = {
      hand,
      start: [...start],
      current: [...start],
      lineMesh,
      labelMesh,
    };
  }

  /** Updates the live endpoint of an active tape-measure drag. */
  updateTape(
    viewer: PluginViewer,
    end: Vec3,
    hand?: string,
    unit: DimensionUnit = 'auto',
  ): boolean {
    const a = this.activeTape;
    if (!a || (hand !== undefined && hand !== a.hand)) return false;
    if (!end.every(Number.isFinite)) return false;
    a.current = [...end];
    const dist = vLen(vSub(a.current, a.start));
    const dashes = buildDashedSegments(a.start, a.current, 0.025, 0.015);
    updateDynamicMesh(viewer, a.lineMesh, buildSegmentBarsGeometry(dashes, 0.0022));
    updateDynamicMesh(
      viewer,
      a.labelMesh,
      buildVectorLabelGeometry(formatSpatialDimension(dist, unit)),
    );
    const head = resolveHeadPose(viewer);
    const mid: Vec3 = [
      (a.start[0] + a.current[0]) * 0.5,
      (a.start[1] + a.current[1]) * 0.5 + 0.035,
      (a.start[2] + a.current[2]) * 0.5,
    ];
    const q = computeBillboardQuaternion(mid, head.position, 'spherical');
    setWorldTRS(viewer, a.labelMesh, q, mid, [1, 1, 1]);
    return true;
  }

  /**
   * Finishes the active tape-measure drag, locking Anchor B and returning the
   * `measurecomplete` event payload (or `null` if the drag was negligible).
   */
  endTape(
    viewer: PluginViewer | undefined,
    hand?: string,
    unit: DimensionUnit = 'auto',
    nowMs = Date.now(),
  ): {start: Vec3; end: Vec3; distanceMeters: number; formatted: string} | null {
    const a = this.activeTape;
    if (!a || (hand !== undefined && hand !== a.hand)) return null;
    this.activeTape = null;
    const dist = vLen(vSub(a.current, a.start));
    if (dist < 0.002 || !viewer) {
      removeDynamicMesh(viewer, a.lineMesh);
      removeDynamicMesh(viewer, a.labelMesh);
      // Double-pinch / double-tap in empty space clears all tape measurements.
      if (viewer && nowMs - this.lastTapMs > 0 && nowMs - this.lastTapMs < 320) {
        this.clearMeasurements(viewer);
        this.lastTapMs = 0;
      } else {
        this.lastTapMs = nowMs;
      }
      return null;
    }
    this.lastTapMs = 0;
    const formatted = formatSpatialDimension(dist, unit);
    const dashes = buildDashedSegments(a.start, a.current, 0.025, 0.015);
    updateDynamicMesh(viewer, a.lineMesh, buildSegmentBarsGeometry(dashes, 0.0022));
    updateDynamicMesh(viewer, a.labelMesh, buildVectorLabelGeometry(formatted));

    if (this.tapeSegments.length >= MAX_TAPE_SEGMENTS) {
      const oldest = this.tapeSegments.shift();
      removeDynamicMesh(viewer, oldest?.lineMesh);
      removeDynamicMesh(viewer, oldest?.labelMesh);
    }
    const rec: TapeSegmentRecord = {
      start: [...a.start],
      end: [...a.current],
      distanceMeters: dist,
      formatted,
      lineMesh: a.lineMesh,
      labelMesh: a.labelMesh,
    };
    this.tapeSegments.push(rec);
    return {
      start: [...rec.start],
      end: [...rec.end],
      distanceMeters: dist,
      formatted,
    };
  }

  private cancelActiveTape(viewer: PluginViewer | undefined): void {
    if (!this.activeTape) return;
    removeDynamicMesh(viewer, this.activeTape.lineMesh);
    removeDynamicMesh(viewer, this.activeTape.labelMesh);
    this.activeTape = null;
  }

  /** Clears all locked and active tape-measure segments. */
  clearMeasurements(viewer: PluginViewer | undefined): void {
    this.cancelActiveTape(viewer);
    while (this.tapeSegments.length > 0) {
      const seg = this.tapeSegments.pop();
      removeDynamicMesh(viewer, seg?.lineMesh);
      removeDynamicMesh(viewer, seg?.labelMesh);
    }
  }

  /** Syncs bounding-box dimension callouts and tape billboards for the frame. */
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  update(viewer: PluginViewer, element?: any): void {
    const meshes = viewer.meshes;
    if (!Array.isArray(meshes)) return;
    const elemCfg = resolveSpatialMeasureConfig(element);
    const head = resolveHeadPose(viewer);
    const selectedName = element?.getAttribute?.('selected-mesh') ?? null;
    const isGrabbing = (m: unknown): boolean =>
      Boolean(element?.traitSystem?.isGrabbing?.(m));

    const seen = new Set<object>();
    let activeLabelCount = 0;

    for (const mesh of meshes) {
      if (elemCfg.disabled) break;
      if (!mesh || mesh.isPluginMesh || mesh.visible === false) continue;
      if (typeof mesh.name === 'string' && mesh.name.startsWith('__xr_')) continue;
      const rawTraits = getMeshXRTraits(mesh);
      const dims =
        parseDimensions(rawTraits?.dimensions) ??
        (elemCfg.boundsEnabled
          ? {
              enabled: true as const,
              unit: elemCfg.defaultUnit,
              axes: ['x', 'y', 'z'] as DimensionAxis[],
              color: '#38bdf8',
              showOnSelect: false,
            }
          : null);
      if (!dims) continue;

      const isSelected =
        isGrabbing(mesh) ||
        Boolean(selectedName && mesh.name && mesh.name === selectedName);
      if (dims.showOnSelect && !isSelected) continue;

      seen.add(mesh);
      const local = computeLocalBounds(mesh);
      const worldMat = meshWorldMatrix(viewer, mesh);
      const wb = computeWorldBounds(local.min, local.max, worldMat);
      const effectiveUnit: DimensionUnit =
        dims.unit === 'auto' && elemCfg.defaultUnit !== 'auto'
          ? elemCfg.defaultUnit
          : dims.unit;
      const allowedLabels = Math.max(
        0,
        Math.min(dims.axes.length, MAX_DIMENSION_LABELS - activeLabelCount),
      );
      const cacheKey = `${quantKey(wb.min)}|${quantKey(wb.max)}|${effectiveUnit}|${dims.axes.join('')}|${dims.color}|${allowedLabels}`;

      let vis = this.nodeVisuals.get(mesh);
      if (vis) {
        reattachDynamicMesh(viewer, vis.barMesh);
        for (const lm of vis.labelMeshes) reattachDynamicMesh(viewer, lm);
      }

      if (!vis || vis.cacheKey !== cacheKey) {
        const callouts = buildDimensionCallouts(wb.min, wb.max, dims.axes);
        const segs: Array<[Vec3, Vec3]> = [];
        for (const c of callouts) {
          segs.push([c.start, c.end], [c.tickStartA, c.tickStartB], [c.tickEndA, c.tickEndB]);
        }
        const barGeo = buildSegmentBarsGeometry(segs, 0.002);
        const rgba = parseHexColor(dims.color);
        if (!vis) {
          const barMesh = createDynamicMesh(viewer, barGeo, {
            name: `__xr_dim_bars_${mesh.name || 'node'}`,
            color: rgba,
            roughness: 0.35,
            pickable: false,
            worldSpace: true,
          });
          vis = {barMesh, labelMeshes: [], labelPositions: [], cacheKey};
          this.nodeVisuals.set(mesh, vis);
        } else {
          updateDynamicMesh(viewer, vis.barMesh, barGeo);
          vis.barMesh.primitives[0].baseColor = [...rgba];
          vis.cacheKey = cacheKey;
        }

        const labelCount = Math.min(callouts.length, allowedLabels);
        while (vis.labelMeshes.length > labelCount) {
          removeDynamicMesh(viewer, vis.labelMeshes.pop());
        }
        vis.labelPositions = [];
        for (let i = 0; i < labelCount; i++) {
          const c = callouts[i];
          const text = formatSpatialDimension(c.lengthMeters, effectiveUnit);
          const lGeo = buildVectorLabelGeometry(text);
          if (i < vis.labelMeshes.length) {
            updateDynamicMesh(viewer, vis.labelMeshes[i], lGeo);
            vis.labelMeshes[i].primitives[0].baseColor = [...rgba];
          } else {
            vis.labelMeshes.push(
              createDynamicMesh(viewer, lGeo, {
                name: `__xr_dim_label_${mesh.name || 'node'}_${c.axis}`,
                color: rgba,
                roughness: 0.25,
                pickable: false,
                worldSpace: true,
              }),
            );
          }
          vis.labelPositions.push(c.labelPosition);
        }
      }

      activeLabelCount += vis.labelMeshes.length;
      applyWorldMatrix(viewer, vis.barMesh);
      for (let i = 0; i < vis.labelMeshes.length; i++) {
        const pos = vis.labelPositions[i];
        const q = computeBillboardQuaternion(pos, head.position, 'spherical');
        setWorldTRS(viewer, vis.labelMeshes[i], q, pos, [1, 1, 1]);
      }
    }

    for (const [m, vis] of this.nodeVisuals.entries()) {
      if (!seen.has(m)) {
        removeDynamicMesh(viewer, vis.barMesh);
        for (const lm of vis.labelMeshes) removeDynamicMesh(viewer, lm);
        this.nodeVisuals.delete(m);
      }
    }

    // Keep locked & active tape segments attached and billboarded toward the viewer.
    for (const seg of this.tapeSegments) {
      reattachDynamicMesh(viewer, seg.lineMesh);
      reattachDynamicMesh(viewer, seg.labelMesh);
      applyWorldMatrix(viewer, seg.lineMesh);
      const mid: Vec3 = [
        (seg.start[0] + seg.end[0]) * 0.5,
        (seg.start[1] + seg.end[1]) * 0.5 + 0.035,
        (seg.start[2] + seg.end[2]) * 0.5,
      ];
      const q = computeBillboardQuaternion(mid, head.position, 'spherical');
      setWorldTRS(viewer, seg.labelMesh, q, mid, [1, 1, 1]);
    }
    if (this.activeTape) {
      reattachDynamicMesh(viewer, this.activeTape.lineMesh);
      reattachDynamicMesh(viewer, this.activeTape.labelMesh);
      applyWorldMatrix(viewer, this.activeTape.lineMesh);
    }
  }

  /** Disposes all callouts and tape segments. */
  dispose(viewer: PluginViewer | undefined): void {
    this.clearMeasurements(viewer);
    for (const vis of this.nodeVisuals.values()) {
      removeDynamicMesh(viewer, vis.barMesh);
      for (const lm of vis.labelMeshes) removeDynamicMesh(viewer, lm);
    }
    this.nodeVisuals.clear();
  }
}

const controllers = new WeakMap<object, XRSpatialMeasureController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the `spatial-measure` controller for `key`. */
export function getSpatialMeasureController(key: object): XRSpatialMeasureController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRSpatialMeasureController();
    controllers.set(key, c);
  }
  return c;
}

interface SelectDetail {
  readonly hand?: string;
  readonly pivotPosition?: Vec3;
  readonly rayOrigin?: Vec3;
  readonly rayDirection?: Vec3;
  // tslint:disable-next-line:no-any Hit mesh struct.
  readonly hit?: {mesh?: any; point?: Vec3} | null;
}

/** Resolves a 3D surface anchor point for the interactive AR tape measure. */
export function resolveTapeHitPoint(
  viewer: PluginViewer,
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  element: any,
  detail: SelectDetail | undefined,
  planesOverride?: readonly TrackedPlane[],
): Vec3 | null {
  if (!detail) return null;
  if (detail.hit?.point && detail.hit.point.every(Number.isFinite)) {
    return [...detail.hit.point];
  }
  const origin = detail.rayOrigin;
  const dir = detail.rayDirection ? normalizeRayDir(detail.rayDirection) : null;
  if (!origin || !origin.every(Number.isFinite) || !dir) {
    return detail.pivotPosition && detail.pivotPosition.every(Number.isFinite)
      ? [...detail.pivotPosition]
      : null;
  }

  const planes =
    planesOverride ??
    (element ? getWorldUnderstandingController(element).planes : []);
  const planeHit = hitTestPlanes(planes, origin, dir);
  if (planeHit) return planeHit.point;

  // Intersect horizontal y=0 ground plane when pointing downward.
  if (dir[1] < -1e-4) {
    const t = -origin[1] / dir[1];
    if (t > 0.02 && t < 20) {
      return vAdd(origin, vScale(dir, t));
    }
  }
  return vAdd(origin, vScale(dir, 1.0));
}

/** `ThreeLivePlugin` providing 3D dimension callouts and AR tape measurement. */
export const spatialMeasurePlugin: ThreeLivePlugin = {
  name: 'xr-live-spatial-measure',
  // tslint:disable-next-line:no-any WebXR session init dictionary.
  onConfigureXRSessionInit(element: any, sessionInit: any): void {
    const cfg = resolveSpatialMeasureConfig(element);
    if (!cfg.tapeEnabled || !sessionInit) return;
    const optional = new Set<string>(sessionInit.optionalFeatures ?? []);
    optional.add('plane-detection');
    optional.add('hit-test');
    sessionInit.optionalFeatures = [...optional];
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element) return;
    const ctrl = getSpatialMeasureController(element);
    const viewerOf = (): PluginViewer | undefined => element._view ?? element.viewer;
    element.clearMeasurements = () => ctrl.clearMeasurements(viewerOf());

    if (typeof element.addEventListener !== 'function' || listeners.has(element)) return;
    const onStart = (e: Event): void => {
      const cfg = resolveSpatialMeasureConfig(element);
      const viewer = viewerOf();
      if (!cfg.tapeEnabled || !viewer || isEventClaimed(e)) return;
      const d = (e as CustomEvent<SelectDetail>).detail;
      // Defer to object grabbing or plugin gizmos when hit.
      if (d?.hit?.mesh?.isPluginMesh) return;
      const hitTraits = d?.hit?.mesh ? getMeshXRTraits(d.hit.mesh) : undefined;
      if (hitTraits?.grab || (hitTraits as {grabbable?: boolean} | undefined)?.grabbable) return;
      const pt = resolveTapeHitPoint(viewer, element, d);
      if (!pt) return;
      claimEvent(e);
      ctrl.beginTape(viewer, pt, d?.hand ?? 'screen', cfg.defaultUnit);
    };
    const onMove = (e: Event): void => {
      const cfg = resolveSpatialMeasureConfig(element);
      const viewer = viewerOf();
      if (!cfg.tapeEnabled || !viewer) return;
      const d = (e as CustomEvent<SelectDetail>).detail;
      const pt = resolveTapeHitPoint(viewer, element, d);
      if (pt) ctrl.updateTape(viewer, pt, d?.hand, cfg.defaultUnit);
    };
    const onEnd = (e: Event): void => {
      const cfg = resolveSpatialMeasureConfig(element);
      const viewer = viewerOf();
      const d = (e as CustomEvent<SelectDetail>).detail;
      if (viewer && cfg.tapeEnabled) {
        const pt = resolveTapeHitPoint(viewer, element, d);
        if (pt) ctrl.updateTape(viewer, pt, d?.hand, cfg.defaultUnit);
      }
      const completed = ctrl.endTape(viewer, d?.hand, cfg.defaultUnit);
      if (completed) emitPluginEvent(element, 'measurecomplete', completed);
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
    for (const [name, fn] of listeners.get(element) ?? []) {
      element.removeEventListener?.(name, fn);
    }
    listeners.delete(element);
    controllers.get(element)?.dispose(element?._view ?? element?.viewer);
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    getSpatialMeasureController(host ?? v).update(v, host);
  },
  onUpdate(viewer: PluginViewer): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getSpatialMeasureController(host ?? viewer).update(viewer, host);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.dispose(viewer);
  },
};
