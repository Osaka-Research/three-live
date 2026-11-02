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
 * @fileoverview `exploded-view` plugin for `<xr-live>`.
 *
 * Provides interactive multi-part assembly explosion (`radial`, `axial-x/y/z`,
 * `hierarchical`), staggered per-layer timing, spring-smoothed interpolation,
 * dashed leader lines, two-hand XR spread gestures (`explodechange`), and a
 * GPU shader cross-section clipping slicer (`section-plane`) with an optional
 * interactive gizmo frame.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  clampNum,
  parseExplode,
  type ExplodeOptions,
} from '../../../three-live/src/xr-trait-schema';
import {
  extractPosition,
  extractQuaternion,
  extractScale,
  getMeshXRTraits,
} from '../xr-traits';
import {
  cacheXRFrame,
  claimEvent,
  computeLocalBounds,
  createDynamicMesh,
  type DynamicGeometry,
  emitPluginEvent,
  isEventClaimed,
  inverseRootMatrix,
  isXRFrameFresh,
  measureFrameDt,
  type PluginViewer,
  type Quat,
  quatFromUnitVectors,
  reattachDynamicMesh,
  removeDynamicMesh,
  rootMatrix,
  setLocalTRS,
  setWorldTRS,
  transformPoint,
  updateDynamicMesh,
  vAdd,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Vec3,
} from './common';
import {buildDashedSegments, buildSegmentBarsGeometry} from './spatial-measure';

export {parseExplode, type ExplodeOptions};

/** Supported multi-part explosion modes. */
export type ExplodeMode =
  | 'radial'
  | 'axial-x'
  | 'axial-y'
  | 'axial-z'
  | 'hierarchical';

const EXPLODE_MODES = new Set<ExplodeMode>([
  'radial',
  'axial-x',
  'axial-y',
  'axial-z',
  'hierarchical',
]);

/** Inter-hand spread distance in meters corresponding to a full `0 -> 1` explode. */
export const TWO_HAND_EXPLODE_SPAN_METERS = 0.4;

/**
 * Computes staggered per-layer explosion progress `t_L` in `[0..1]` so inner
 * layers remain seated while outer layers peel away first (layer 1 moves before
 * layer 2..N), reaching exact `0` at `factor = 0` and exact `1` at `factor = 1`.
 */
export function computeLayerFactor(
  factor: number,
  layer: number,
  maxLayer: number,
): number {
  const f = clampNum(factor, 0, 1, 0);
  if (f <= 0) return 0;
  if (f >= 1) return 1;
  const maxL = Math.max(1, Math.round(clampNum(maxLayer, 1, 10, 1)));
  if (maxL <= 1) return f * f * (3 - 2 * f);
  const clampedL = Math.max(1, Math.min(maxL, Math.round(clampNum(layer, 1, 10, 1))));
  const stagger = 0.35;
  const span = 1 / (1 + (maxL - 1) * stagger);
  const start = (clampedL - 1) * stagger * span;
  const u = Math.max(0, Math.min(1, (f - start) / span));
  return u * u * (3 - 2 * u);
}

/** Parameters for {@link computeExplodedNodeOffset}. */
export interface ExplodedNodeOffsetParams {
  readonly restPosition: readonly number[];
  readonly assemblyCenter: readonly number[];
  readonly assemblyRadius: number;
  readonly factor: number;
  readonly mode?: ExplodeMode;
  readonly explodeScale?: number;
  readonly trait?: ExplodeOptions | null;
  readonly maxLayer?: number;
  readonly nodeIndex?: number;
  readonly nodeCount?: number;
  readonly hierarchyDepth?: number;
}

/**
 * Computes the local/scene-space displacement offset `t_L * d_i * dir_i` for a
 * single assembly part. Shared across Web, Android (`XRSpatialMath.kt`), and
 * iOS/visionOS (`XRSpatialMath.swift`).
 */
export function computeExplodedNodeOffset(
  params: ExplodedNodeOffsetParams,
): Vec3 {
  const f = clampNum(params.factor, 0, 1, 0);
  if (f <= 1e-6) return [0, 0, 0];

  const mode: ExplodeMode = params.mode && EXPLODE_MODES.has(params.mode) ? params.mode : 'radial';
  const scale = clampNum(params.explodeScale, 0, 10, 1.5);
  const radius = Math.max(0.05, Number.isFinite(params.assemblyRadius) ? params.assemblyRadius : 0.5);
  const trait = params.trait ?? null;
  const layer = trait?.layer ?? 1;
  const maxLayer = Math.max(layer, params.maxLayer ?? 1);
  const tL = computeLayerFactor(f, layer, maxLayer);
  if (tL <= 1e-6) return [0, 0, 0];

  const rel: Vec3 = [
    (params.restPosition[0] ?? 0) - (params.assemblyCenter[0] ?? 0),
    (params.restPosition[1] ?? 0) - (params.assemblyCenter[1] ?? 0),
    (params.restPosition[2] ?? 0) - (params.assemblyCenter[2] ?? 0),
  ];
  const relDist = vLen(rel);

  let dir: Vec3;
  let maxDist: number;

  if (trait?.direction) {
    dir = vNorm(trait.direction, [0, 1, 0]);
    maxDist = trait.distance * scale;
  } else {
    const idx = params.nodeIndex ?? 0;
    const count = Math.max(1, params.nodeCount ?? 1);
    const spreadSlot = count > 1 ? (idx / (count - 1)) * 2 - 1 : 0;

    if (mode === 'axial-x' || mode === 'axial-y' || mode === 'axial-z') {
      const axisIdx = mode === 'axial-x' ? 0 : mode === 'axial-y' ? 1 : 2;
      const comp = rel[axisIdx];
      const sign = Math.abs(comp) > 1e-4 ? Math.sign(comp) : spreadSlot >= 0 ? 1 : -1;
      dir = [0, 0, 0];
      dir[axisIdx] = sign;
      const weight = Math.abs(comp) > 1e-4 ? Math.abs(comp) / radius : Math.abs(spreadSlot) * 0.6 + 0.25;
      maxDist = (trait ? trait.distance : radius * Math.max(0.2, weight)) * scale;
    } else if (mode === 'hierarchical') {
      const depth = Math.max(1, params.hierarchyDepth ?? 1);
      if (relDist > 1e-4) {
        dir = vScale(rel, 1 / relDist);
      } else {
        const angle = (idx / count) * Math.PI * 2;
        dir = [Math.cos(angle), 0.35, Math.sin(angle)];
        dir = vNorm(dir, [0, 1, 0]);
      }
      const depthWeight = 0.35 + 0.3 * Math.min(4, depth);
      maxDist = (trait ? trait.distance : radius * depthWeight) * scale;
    } else {
      // `radial`
      if (relDist > 1e-4) {
        dir = vScale(rel, 1 / relDist);
        const shellWeight = Math.max(0.25, Math.min(1.6, relDist / radius + 0.25));
        maxDist = (trait ? trait.distance : radius * shellWeight) * scale;
      } else {
        // Coincident center parts fan out deterministically in XZ/Y.
        const angle = (idx / count) * Math.PI * 2;
        dir = vNorm([Math.cos(angle), 0.25 * spreadSlot, Math.sin(angle)], [0, 1, 0]);
        maxDist = (trait ? trait.distance : radius * 0.35) * scale;
      }
    }
  }

  const d = tL * maxDist;
  return [dir[0] * d, dir[1] * d, dir[2] * d];
}

/** Maps a two-hand spread gesture (`startDistance -> currentDistance`) to `[-1..1]`. */
export function computeTwoHandExplodeDelta(
  startDistance: number,
  currentDistance: number,
  spanMeters = TWO_HAND_EXPLODE_SPAN_METERS,
): number {
  if (!Number.isFinite(startDistance) || !Number.isFinite(currentDistance)) return 0;
  const span = Math.max(0.05, spanMeters);
  return Math.max(-1, Math.min(1, (currentDistance - startDistance) / span));
}

/** Parsed cross-section clipping plane state (`dot(worldPos, normal) > constant` discards). */
export interface SectionPlaneState {
  readonly enabled: boolean;
  readonly normal: Vec3;
  readonly constant: number;
  readonly interactive: boolean;
}

/**
 * Parses a `section-plane` attribute value (`"none"`, `"x:0.2"`, `"y:0.0"`,
 * `"z:-0.1"`, `"-x:0.1"`, `"interactive"`) into a normalized plane equation.
 */
export function parseSectionPlaneSpec(
  raw: string | null | undefined,
  defaultCenter: readonly number[] = [0, 0, 0],
): SectionPlaneState {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s || s === 'none' || s === 'false') {
    return {enabled: false, normal: [1, 0, 0], constant: 0, interactive: false};
  }
  if (s === 'interactive') {
    const cx = Number.isFinite(defaultCenter[0]) ? defaultCenter[0] : 0;
    return {enabled: true, normal: [1, 0, 0], constant: cx, interactive: true};
  }
  const m = /^([+-]?[xyz])\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/.exec(s);
  if (!m) {
    return {enabled: false, normal: [1, 0, 0], constant: 0, interactive: false};
  }
  const axisToken = m[1];
  const sign = axisToken.startsWith('-') ? -1 : 1;
  const axisChar = axisToken.replace(/^[+-]/, '');
  const val = clampNum(Number(m[2]), -1000, 1000, 0);
  const normal: Vec3 =
    axisChar === 'x'
      ? [sign, 0, 0]
      : axisChar === 'y'
        ? [0, sign, 0]
        : [0, 0, sign];
  return {
    enabled: true,
    normal,
    constant: val * sign,
    interactive: false,
  };
}

/**
 * Transforms a scene-space section plane `dot(p, n) > c` into world space via
 * the viewer root matrix (rigid rotation + translation + uniform scale).
 */
export function sectionPlaneToWorld(
  plane: SectionPlaneState,
  root: ArrayLike<number>,
): SectionPlaneState {
  if (!plane.enabled) return plane;
  const n = vNorm(plane.normal, [1, 0, 0]);
  const wn = vNorm(
    [
      root[0] * n[0] + root[4] * n[1] + root[8] * n[2],
      root[1] * n[0] + root[5] * n[1] + root[9] * n[2],
      root[2] * n[0] + root[6] * n[1] + root[10] * n[2],
    ],
    n,
  );
  const wp = transformPoint(root, vScale(n, plane.constant));
  return {...plane, normal: wn, constant: vDot(wn, wp)};
}

/** Builds a 4-bar rectangular gizmo frame in the XY plane facing `+Z`. */
export function buildSectionGizmoGeometry(halfExtent = 0.35): DynamicGeometry {
  const h = Math.max(0.05, halfExtent);
  const c0: Vec3 = [-h, -h, 0];
  const c1: Vec3 = [h, -h, 0];
  const c2: Vec3 = [h, h, 0];
  const c3: Vec3 = [-h, h, 0];
  return buildSegmentBarsGeometry(
    [
      [c0, c1],
      [c1, c2],
      [c2, c3],
      [c3, c0],
    ],
    Math.max(0.002, h * 0.012),
  );
}

interface RestPartRecord {
  // tslint:disable-next-line:no-any Scene GPU mesh.
  readonly mesh: any;
  readonly restLocalPos: Vec3;
  readonly restLocalQuat: Quat;
  readonly restLocalScale: Vec3;
  readonly restCenterLocal: Vec3;
  readonly hierarchyDepth: number;
}

function computeNodeDepthMap(gltf: unknown): Map<number, number> {
  const depths = new Map<number, number>();
  const nodes = (gltf as {nodes?: Array<{children?: number[]}>} | null)?.nodes;
  if (!Array.isArray(nodes)) return depths;
  const childSet = new Set<number>();
  for (const n of nodes) {
    for (const c of n?.children ?? []) {
      if (typeof c === 'number') childSet.add(c);
    }
  }
  const walk = (idx: number, d: number): void => {
    if (d > 64 || depths.has(idx)) return;
    depths.set(idx, d);
    for (const c of nodes[idx]?.children ?? []) {
      if (typeof c === 'number') walk(c, d + 1);
    }
  };
  for (let i = 0; i < nodes.length; i++) {
    if (!childSet.has(i)) walk(i, 1);
  }
  return depths;
}

/** Resolved `<xr-live>` element configuration for `exploded-view`. */
export interface ExplodedViewElementConfig {
  readonly hasExplodeAttr: boolean;
  readonly targetFactor: number;
  readonly mode: ExplodeMode;
  readonly scale: number;
  readonly sectionSpec: string;
}

/** Parses `explode`, `explode-mode`, `explode-scale`, and `section-plane` on `<xr-live>`. */
// tslint:disable-next-line:no-any Host element is `<xr-live>`.
export function resolveExplodedViewConfig(element: any): ExplodedViewElementConfig {
  const hasExplodeAttr =
    typeof element?.hasAttribute === 'function' && element.hasAttribute('explode');
  const rawExplode = element?.getAttribute?.('explode');
  const targetFactor =
    rawExplode === ''
      ? 1
      : rawExplode !== null && rawExplode !== undefined
        ? clampNum(Number(rawExplode), 0, 1, 0)
        : 0;
  const rawMode = (element?.getAttribute?.('explode-mode') ?? 'radial').trim().toLowerCase();
  const mode: ExplodeMode = EXPLODE_MODES.has(rawMode as ExplodeMode)
    ? (rawMode as ExplodeMode)
    : 'radial';
  const rawScale = element?.getAttribute?.('explode-scale');
  const scale =
    rawScale !== null && rawScale !== undefined && rawScale !== ''
      ? clampNum(Number(rawScale), 0, 10, 1.5)
      : 1.5;
  const sectionSpec = (element?.getAttribute?.('section-plane') ?? 'none').trim();
  return {hasExplodeAttr, targetFactor, mode, scale, sectionSpec};
}

/**
 * Per-element controller driving assembly rest-pose capture, explosion offsets,
 * leader-line meshes, two-hand spread gestures, and cross-section clipping.
 */
export class XRExplodedViewController {
  private parts: RestPartRecord[] = [];
  private capturedMeshSet = new Set<object>();
  private consideredMeshSet = new Set<object>();
  private assemblyCenter: Vec3 = [0, 0, 0];
  private assemblyRadius = 0.5;
  private targetFactor = 0;
  private currentFactor = 0;
  private wasExploded = false;
  private apiOverrideFactor: number | null = null;
  // tslint:disable-next-line:no-any Batched dashed leader lines GPU mesh.
  private leaderMesh: any = null;
  private lastLeaderKey = '';
  // tslint:disable-next-line:no-any Section plane gizmo GPU mesh.
  private sectionGizmoMesh: any = null;
  private sectionGizmoRadius = 0;
  private activeSection: SectionPlaneState = {
    enabled: false,
    normal: [1, 0, 0],
    constant: 0,
    interactive: false,
  };
  private interactivePlaneOffset: number | null = null;
  private worldSection: SectionPlaneState = {
    enabled: false,
    normal: [1, 0, 0],
    constant: 0,
    interactive: false,
  };

  // Two-hand spread gesture & interactive section drag state.
  private readonly handPositions = new Map<string, Vec3>();
  private spreadGesture: {startDist: number; startFactor: number} | null = null;
  private planeDrag: {hand: string; startProj: number; startConst: number} | null = null;

  /** Returns the current interpolated explosion factor in `[0..1]`. */
  get factor(): number {
    return this.currentFactor;
  }

  /**
   * Returns the active section plane in world space (what the shader clips
   * against). `section-plane` specs are authored in scene space so the cut
   * follows the model through AR placement and turntable rotation.
   */
  get sectionPlane(): SectionPlaneState {
    return this.worldSection;
  }

  /** Returns the active section plane in scene (model) space. */
  get sceneSectionPlane(): SectionPlaneState {
    return this.activeSection;
  }

  /** Programmatically sets the target explosion factor and emits `explodechange`. */
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  setExplode(
    factor: number,
    element?: any,
    source: 'attribute' | 'gesture' | 'api' | 'peer' = 'api',
  ): void {
    const clamped = clampNum(factor, 0, 1, 0);
    if (source === 'api' || source === 'gesture' || source === 'peer') {
      this.apiOverrideFactor = clamped;
    } else {
      this.apiOverrideFactor = null;
    }
    if (Math.abs(clamped - this.targetFactor) > 1e-5) {
      this.targetFactor = clamped;
      emitPluginEvent(element, 'explodechange', {factor: clamped, source});
    } else {
      this.targetFactor = clamped;
    }
  }

  /** Captures rest poses from `viewer.meshes` on model load or scene change. */
  captureRestPoses(viewer: PluginViewer, gltf?: unknown): void {
    const meshes = viewer.meshes;
    if (!Array.isArray(meshes)) return;
    const sceneMeshes = meshes.filter(
      (m) =>
        m &&
        !m.isPluginMesh &&
        !(typeof m.name === 'string' && m.name.startsWith('__xr_')),
    );
    if (
      sceneMeshes.length === this.consideredMeshSet.size &&
      sceneMeshes.every((m) => this.consideredMeshSet.has(m))
    ) {
      return;
    }

    this.parts = [];
    this.capturedMeshSet = new Set<object>();
    // Every scene mesh seen in this capture, including skipped ones (explode:
    // false, floor anchors). Comparing against `parts` alone would re-capture
    // every frame whenever a mesh is skipped, baking exploded offsets into the
    // rest pose so parts fly away.
    this.consideredMeshSet = new Set<object>(sceneMeshes);
    const depthMap = computeNodeDepthMap(gltf ?? (viewer as {gltf?: unknown}).gltf);
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];

    for (const m of sceneMeshes) {
      const traits = getMeshXRTraits(m);
      if (traits?.explode === false) continue;
      const anchorTarget =
        typeof traits?.anchor === 'string'
          ? traits.anchor
          : (traits?.anchor as {target?: string} | null | undefined)?.target;
      if (anchorTarget === 'floor' && !traits?.explode) continue;

      const restLocalPos = extractPosition(m.transform);
      const restLocalQuat = extractQuaternion(m.transform);
      const restLocalScale = extractScale(m.transform);
      const lb = computeLocalBounds(m);
      const localMid: Vec3 = [
        (lb.min[0] + lb.max[0]) * 0.5,
        (lb.min[1] + lb.max[1]) * 0.5,
        (lb.min[2] + lb.max[2]) * 0.5,
      ];
      const restCenterLocal = transformPoint(m.transform, localMid);
      for (const corner of [lb.min, lb.max]) {
        const wc = transformPoint(m.transform, corner);
        for (let a = 0; a < 3; a++) {
          if (Number.isFinite(wc[a])) {
            if (wc[a] < min[a]) min[a] = wc[a];
            if (wc[a] > max[a]) max[a] = wc[a];
          }
        }
      }
      const depth =
        typeof m.nodeIndex === 'number' ? (depthMap.get(m.nodeIndex) ?? 1) : 1;
      this.parts.push({
        mesh: m,
        restLocalPos,
        restLocalQuat,
        restLocalScale,
        restCenterLocal,
        hierarchyDepth: depth,
      });
      this.capturedMeshSet.add(m);
    }

    if (Number.isFinite(min[0]) && Number.isFinite(max[0])) {
      this.assemblyCenter = [
        (min[0] + max[0]) * 0.5,
        (min[1] + max[1]) * 0.5,
        (min[2] + max[2]) * 0.5,
      ];
      this.assemblyRadius = Math.max(0.05, vLen(vSub(max, min)) * 0.5);
    } else {
      this.assemblyCenter = [0, 0, 0];
      this.assemblyRadius = 0.5;
    }
  }

  /** Handles pointer/pinch start for 2-hand spread or interactive section plane. */
  handleSelectStart(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element: any,
    hand: string,
    pivot: Vec3 | undefined,
    hasHitMesh: boolean,
  ): boolean {
    if (!pivot || !pivot.every(Number.isFinite)) return false;

    // Interactive section-plane drag when pinching near the cut gizmo
    // (plane math runs in scene space).
    if (this.activeSection.enabled && this.activeSection.interactive && !hasHitMesh) {
      const local = transformPoint(inverseRootMatrix(viewer), pivot);
      const signed = vDot(local, this.activeSection.normal) - this.activeSection.constant;
      if (Math.abs(signed) <= Math.max(0.12, this.assemblyRadius * 0.35)) {
        this.planeDrag = {
          hand,
          startProj: vDot(local, this.activeSection.normal),
          startConst: this.activeSection.constant,
        };
        return true;
      }
    }

    // Two-hand XR pull-apart gesture inside assembly bounding sphere.
    if (hand !== 'left' && hand !== 'right') return false;
    const isGrabbingAny =
      typeof element?.traitSystem?.getGrabbedMeshes === 'function' &&
      element.traitSystem.getGrabbedMeshes().length > 0;
    if (isGrabbingAny) return false;

    const worldCenter = transformPoint(rootMatrix(viewer), this.assemblyCenter);
    if (vLen(vSub(pivot, worldCenter)) > Math.max(0.5, this.assemblyRadius * 2.0)) {
      return false;
    }
    this.handPositions.set(hand, [...pivot]);
    const left = this.handPositions.get('left');
    const right = this.handPositions.get('right');
    if (left && right) {
      this.spreadGesture = {
        startDist: vLen(vSub(right, left)),
        startFactor: this.currentFactor,
      };
      return true;
    }
    return false;
  }

  /** Updates active 2-hand spread or interactive section plane drag. */
  handleSelectMove(
    // tslint:disable-next-line:no-any Host element.
    element: any,
    hand: string,
    pivot: Vec3 | undefined,
    viewer?: PluginViewer,
  ): void {
    if (!pivot || !pivot.every(Number.isFinite)) return;
    if (this.planeDrag && this.planeDrag.hand === hand) {
      const local = transformPoint(inverseRootMatrix(viewer), pivot);
      const proj = vDot(local, this.activeSection.normal);
      this.interactivePlaneOffset = clampNum(
        this.planeDrag.startConst + (proj - this.planeDrag.startProj),
        -1000,
        1000,
        0,
      );
      return;
    }
    if (!this.handPositions.has(hand)) return;
    this.handPositions.set(hand, [...pivot]);
    if (this.spreadGesture) {
      const left = this.handPositions.get('left');
      const right = this.handPositions.get('right');
      if (left && right) {
        const dist = vLen(vSub(right, left));
        const delta = computeTwoHandExplodeDelta(this.spreadGesture.startDist, dist);
        this.setExplode(this.spreadGesture.startFactor + delta, element, 'gesture');
      }
    }
  }

  /** Ends active hand tracking for 2-hand spread or section plane drag. */
  handleSelectEnd(hand: string): void {
    if (this.planeDrag?.hand === hand) {
      this.planeDrag = null;
    }
    this.handPositions.delete(hand);
    if (this.handPositions.size < 2) {
      this.spreadGesture = null;
    }
  }

  /** Steps assembly interpolation, leader lines, and section plane gizmo. */
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  update(viewer: PluginViewer, dt = 1 / 60, element?: any): void {
    const meshes = viewer.meshes;
    if (!Array.isArray(meshes)) return;
    const cfg = resolveExplodedViewConfig(element);
    const anyNodeExplode = meshes.some(
      (m) => m && !m.isPluginMesh && Boolean(parseExplode(getMeshXRTraits(m)?.explode)),
    );
    const desiredTarget =
      this.apiOverrideFactor !== null ? this.apiOverrideFactor : cfg.targetFactor;
    this.targetFactor = desiredTarget;

    const sectionParsed = parseSectionPlaneSpec(cfg.sectionSpec, this.assemblyCenter);
    if (!sectionParsed.interactive) {
      this.interactivePlaneOffset = null;
    }
    this.activeSection =
      sectionParsed.interactive && this.interactivePlaneOffset !== null
        ? {...sectionParsed, constant: this.interactivePlaneOffset}
        : sectionParsed;
    this.worldSection = sectionPlaneToWorld(this.activeSection, rootMatrix(viewer));

    const active =
      cfg.hasExplodeAttr ||
      this.apiOverrideFactor !== null ||
      this.currentFactor > 1e-4 ||
      anyNodeExplode ||
      this.activeSection.enabled;
    if (!active) {
      this.disposeVisuals(viewer);
      return;
    }

    this.captureRestPoses(viewer);
    const clampedDt = clampNum(dt, 0.001, 0.25, 1 / 60);
    const alpha = 1 - Math.exp(-clampedDt * 14);
    this.currentFactor += (this.targetFactor - this.currentFactor) * alpha;
    if (Math.abs(this.targetFactor - this.currentFactor) < 1e-4) {
      this.currentFactor = this.targetFactor;
    }

    const root = rootMatrix(viewer);
    const leaderSegments: Array<[Vec3, Vec3]> = [];
    const isGrabbing = (m: unknown): boolean =>
      Boolean(element?.traitSystem?.isGrabbing?.(m));
    const isNowExploded = this.currentFactor > 1e-4 || this.targetFactor > 0;

    if (isNowExploded || this.wasExploded) {
      if (isNowExploded && !this.wasExploded) {
        // Re-capture resting poses right as explosion starts from 0 so any prior
        // grab/snap/physics adjustments are preserved as the assembly baseline.
        this.parts = [];
        this.capturedMeshSet.clear();
        this.consideredMeshSet.clear();
        this.captureRestPoses(viewer);
      }
      let maxLayer = 1;
      const parsedTraits: Array<ExplodeOptions | null> = [];
      for (const part of this.parts) {
        const t = parseExplode(getMeshXRTraits(part.mesh)?.explode);
        parsedTraits.push(t);
        if (t && t.layer > maxLayer) maxLayer = t.layer;
      }
      for (let i = 0; i < this.parts.length; i++) {
        const part = this.parts[i];
        if (!part.mesh || part.mesh.visible === false || isGrabbing(part.mesh)) continue;
        const trait = parsedTraits[i];
        const offset = computeExplodedNodeOffset({
          restPosition: part.restCenterLocal,
          assemblyCenter: this.assemblyCenter,
          assemblyRadius: this.assemblyRadius,
          factor: this.currentFactor,
          mode: cfg.mode,
          explodeScale: cfg.scale,
          trait,
          maxLayer,
          nodeIndex: i,
          nodeCount: this.parts.length,
          hierarchyDepth: part.hierarchyDepth,
        });
        const nextLocalPos: Vec3 =
          this.currentFactor <= 1e-4 && this.targetFactor === 0
            ? [...part.restLocalPos]
            : vAdd(part.restLocalPos, offset);
        setLocalTRS(part.mesh, part.restLocalQuat, nextLocalPos, extractScale(part.mesh.transform));

        const showLeader = trait ? trait.leaderLine : true;
        if (this.currentFactor > 0.02 && showLeader && vLen(offset) > 0.008) {
          // Leader geometry lives in scene space (drawn through the root
          // matrix) so it stays attached while the model turns or is placed.
          const restPt = part.restCenterLocal;
          const explodedPt = vAdd(part.restCenterLocal, offset);
          for (const seg of buildDashedSegments(restPt, explodedPt, 0.022, 0.014, 32)) {
            leaderSegments.push(seg);
          }
        }
      }
      this.wasExploded = isNowExploded;
    }

    // Update dashed leader-line dynamic mesh.
    if (leaderSegments.length > 0) {
      const key = `${Math.round(this.currentFactor * 500)}:${cfg.mode}:${Math.round(cfg.scale * 100)}:${leaderSegments.length}`;
      if (!this.leaderMesh) {
        this.leaderMesh = createDynamicMesh(
          viewer,
          buildSegmentBarsGeometry(leaderSegments, 0.0016),
          {
            name: '__xr_explode_leaders__',
            color: [0.58, 0.82, 0.98, 0.85],
            roughness: 0.35,
            alphaBlend: true,
            pickable: false,
          },
        );
        this.lastLeaderKey = key;
      } else {
        reattachDynamicMesh(viewer, this.leaderMesh);
        this.leaderMesh.visible = true;
        if (key !== this.lastLeaderKey) {
          updateDynamicMesh(
            viewer,
            this.leaderMesh,
            buildSegmentBarsGeometry(leaderSegments, 0.0016),
          );
          this.lastLeaderKey = key;
        }
      }
    } else if (this.leaderMesh) {
      this.leaderMesh.visible = false;
    }

    // Update cross-section plane gizmo frame.
    if (this.activeSection.enabled) {
      const half = Math.max(0.12, this.assemblyRadius * 1.15);
      if (!this.sectionGizmoMesh || Math.abs(this.sectionGizmoRadius - half) > 1e-3) {
        removeDynamicMesh(viewer, this.sectionGizmoMesh);
        this.sectionGizmoMesh = createDynamicMesh(
          viewer,
          buildSectionGizmoGeometry(half),
          {
            name: '__xr_section_gizmo__',
            color: [0.96, 0.62, 0.04, 0.85],
            roughness: 0.25,
            alphaBlend: true,
            pickable: false,
            worldSpace: true,
          },
        );
        this.sectionGizmoRadius = half;
      } else {
        reattachDynamicMesh(viewer, this.sectionGizmoMesh);
      }
      this.sectionGizmoMesh.visible = true;
      const worldCenter = transformPoint(root, this.assemblyCenter);
      const n = this.worldSection.normal;
      const dist = vDot(worldCenter, n) - this.worldSection.constant;
      const planeOrigin = vSub(worldCenter, vScale(n, dist));
      const q = quatFromUnitVectors([0, 0, 1], n);
      setWorldTRS(viewer, this.sectionGizmoMesh, q, planeOrigin, [1, 1, 1]);
    } else if (this.sectionGizmoMesh) {
      this.sectionGizmoMesh.visible = false;
    }
  }

  /** Resets rest-pose cache when a new GLB model is loaded. */
  resetForNewModel(viewer: PluginViewer, gltf?: unknown): void {
    this.parts = [];
    this.capturedMeshSet.clear();
    this.consideredMeshSet.clear();
    this.lastLeaderKey = '';
    this.captureRestPoses(viewer, gltf);
  }

  private disposeVisuals(viewer: PluginViewer | undefined): void {
    removeDynamicMesh(viewer, this.leaderMesh);
    this.leaderMesh = null;
    this.lastLeaderKey = '';
    removeDynamicMesh(viewer, this.sectionGizmoMesh);
    this.sectionGizmoMesh = null;
    this.sectionGizmoRadius = 0;
  }

  /** Restores rest transforms and disposes dynamic meshes. */
  dispose(viewer: PluginViewer | undefined): void {
    for (const part of this.parts) {
      if (part.mesh?.transform) {
        setLocalTRS(part.mesh, part.restLocalQuat, part.restLocalPos, part.restLocalScale);
      }
    }
    this.disposeVisuals(viewer);
    this.parts = [];
    this.capturedMeshSet.clear();
    this.consideredMeshSet.clear();
    this.wasExploded = false;
    this.handPositions.clear();
    this.spreadGesture = null;
    this.planeDrag = null;
    this.activeSection = {enabled: false, normal: [1, 0, 0], constant: 0, interactive: false};
    this.worldSection = this.activeSection;
  }
}

const controllers = new WeakMap<object, XRExplodedViewController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();
const activeSectionByGl = new WeakMap<WebGL2RenderingContext, SectionPlaneState | null>();
const sectionUniformCache = new WeakMap<
  WebGLProgram,
  {enabled: WebGLUniformLocation | null; plane: WebGLUniformLocation | null}
>();

/** Returns (creating on first use) the `exploded-view` controller for `key`. */
export function getExplodedViewController(key: object): XRExplodedViewController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRExplodedViewController();
    controllers.set(key, c);
  }
  return c;
}

interface SelectDetail {
  readonly hand?: string;
  readonly pivotPosition?: Vec3;
  readonly hit?: {mesh?: unknown} | null;
}

/** `ThreeLivePlugin` providing multi-part exploded views & section clipping. */
export const explodedViewPlugin: ThreeLivePlugin = {
  name: 'xr-live-exploded-view',
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element) return;
    const ctrl = getExplodedViewController(element);
    element.setExplode = (factor: number) => ctrl.setExplode(factor, element, 'api');
    if (typeof element.addEventListener !== 'function' || listeners.has(element)) return;

    const viewerOf = (): PluginViewer | undefined => element._view ?? element.viewer;
    const onStart = (e: Event): void => {
      if (isEventClaimed(e)) return;
      const v = viewerOf();
      if (!v) return;
      const d = (e as CustomEvent<SelectDetail>).detail;
      if (ctrl.handleSelectStart(v, element, d?.hand ?? 'screen', d?.pivotPosition, Boolean(d?.hit?.mesh))) {
        claimEvent(e);
      }
    };
    const onMove = (e: Event): void => {
      const d = (e as CustomEvent<SelectDetail>).detail;
      ctrl.handleSelectMove(element, d?.hand ?? 'screen', d?.pivotPosition, viewerOf());
    };
    const onEnd = (e: Event): void => {
      const d = (e as CustomEvent<SelectDetail>).detail;
      ctrl.handleSelectEnd(d?.hand ?? 'screen');
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
  onAttributeChanged(element: any, name: string, _oldVal: string | null, newVal: string | null): void {
    if (!element) return;
    if (name === 'explode') {
      const ctrl = getExplodedViewController(element);
      const next =
        newVal === ''
          ? 1
          : newVal !== null && newVal !== undefined
            ? clampNum(Number(newVal), 0, 1, 0)
            : 0;
      ctrl.setExplode(next, element, 'attribute');
    }
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    for (const [name, fn] of listeners.get(element) ?? []) {
      element.removeEventListener?.(name, fn);
    }
    listeners.delete(element);
    controllers.get(element)?.dispose(element?._view ?? element?.viewer);
  },
  // tslint:disable-next-line:no-any Viewer and glTF JSON.
  onLoadModel(viewer: any, gltf: any): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.resetForNewModel(viewer, gltf);
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    const ctrl = getExplodedViewController(host ?? v);
    ctrl.update(v, measureFrameDt(ctrl), host);
  },
  onUpdate(viewer: PluginViewer, dt: number): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getExplodedViewController(host ?? viewer).update(viewer, dt, host);
  },
  // tslint:disable-next-line:no-any Viewer struct.
  onBeforeDrawScene(viewer: any, gl: WebGL2RenderingContext): void {
    const host = viewer?.container;
    const ctrl = controllers.get(host ?? viewer);
    activeSectionByGl.set(gl, ctrl?.sectionPlane.enabled ? ctrl.sectionPlane : null);
  },
  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    _primitiveGpu: unknown,
    // tslint:disable-next-line:no-any GPU mesh struct.
    meshGpu: any,
  ): void {
    const section = activeSectionByGl.get(gl);
    if (!section || !section.enabled) {
      const cached = sectionUniformCache.get(program);
      if (cached?.enabled) gl.uniform1i(cached.enabled, 0);
      return;
    }
    let locs = sectionUniformCache.get(program);
    if (!locs) {
      locs = {
        enabled: gl.getUniformLocation(program, 'uSectionEnabled'),
        plane: gl.getUniformLocation(program, 'uSectionPlane'),
      };
      sectionUniformCache.set(program, locs);
    }
    if (!locs.enabled || !locs.plane) return;
    if (meshGpu?.isPluginMesh) {
      gl.uniform1i(locs.enabled, 0);
      return;
    }
    gl.uniform1i(locs.enabled, 1);
    gl.uniform4f(
      locs.plane,
      section.normal[0],
      section.normal[1],
      section.normal[2],
      section.constant,
    );
  },
  onDestroy(gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    activeSectionByGl.delete(gl);
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.dispose(viewer);
  },
};
