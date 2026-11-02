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
 * @fileoverview `spatial-locomotion` plugin for `<xr-live>`.
 *
 * Provides comfortable room-scale and architectural XR navigation:
 * 1. Ballistic parabolic teleport arc onto `navigable` floor/platform surfaces
 * 2. Glowing ribbon + cyan/red landing ring preview
 * 3. Hysteresis-guarded thumbstick snap-turn (`snap-turn-deg`, default `30°`)
 * 4. Optional smooth thumbstick glide + `120ms` peripheral FOV comfort vignette
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
} from '../../../three-live/src/math';
import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  clampNum,
  parseNavigable,
  type NavigableMode,
} from '../../../three-live/src/xr-trait-schema';
import {extractPosition, getMeshXRTraits, quatFromEulerYXZ} from '../xr-traits';
import {
  applyWorldMatrix,
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
  vCross,
  vLen,
  vNorm,
  vScale,
  vSub,
  type Vec3,
} from './common';
import {buildSnapRingGeometry} from './magnetic-snap';

export {parseNavigable, type NavigableMode};

/** Default ballistic launch speed in meters per second. */
export const TELEPORT_SPEED = 6.0;

/** Vertical gravitational acceleration in `m/s^2`. */
export const TELEPORT_GRAVITY = -9.8;

/** Default number of sampled segments along the parabolic teleport arc. */
export const TELEPORT_SEGMENTS = 20;

/** Time step in seconds per parabolic arc segment. */
export const TELEPORT_STEP_DT = 0.08;

/** Minimum world surface normal `Y` (`cos 45.6°`) required for walkable landing. */
export const MIN_WALKABLE_NORMAL_Y = 0.7;

/** Thumbstick horizontal threshold (`|x| > 0.65`) that triggers a snap-turn. */
export const SNAP_TURN_TRIGGER = 0.65;

/** Thumbstick horizontal reset threshold (`|x| < 0.25`) before next snap-turn. */
export const SNAP_TURN_RESET = 0.25;

/** Duration of the peripheral comfort vignette fade in milliseconds. */
export const COMFORT_VIGNETTE_MS = 120;

/** Samples `segments + 1` points along a ballistic projectile parabola. */
export function sampleTeleportParabola(
  origin: readonly number[],
  direction: readonly number[],
  speed = TELEPORT_SPEED,
  gravity = TELEPORT_GRAVITY,
  segments = TELEPORT_SEGMENTS,
  stepDt = TELEPORT_STEP_DT,
): Vec3[] {
  const p0: Vec3 = [origin[0] ?? 0, origin[1] ?? 0, origin[2] ?? 0];
  const dir = vNorm(direction, [0, 0, -1]);
  const v0 = clampNum(speed, 0.5, 30, TELEPORT_SPEED);
  const g = clampNum(gravity, -30, -0.5, TELEPORT_GRAVITY);
  const segs = Math.max(2, Math.min(64, Math.floor(segments)));
  const dt = clampNum(stepDt, 0.01, 0.25, TELEPORT_STEP_DT);

  const pts: Vec3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i * dt;
    pts.push([
      p0[0] + dir[0] * v0 * t,
      p0[1] + dir[1] * v0 * t + 0.5 * g * t * t,
      p0[2] + dir[2] * v0 * t,
    ]);
  }
  return pts;
}

/** Result of evaluating a parabolic teleport trajectory against scene geometry. */
export interface TeleportArcHit {
  readonly valid: boolean;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly points: Vec3[];
  // tslint:disable-next-line:no-any Optional hit scene mesh.
  readonly hitMesh: any;
}

/**
 * Evaluates a parabolic teleport ray against `viewer.meshes`, enforcing
 * `userData.xr.navigable` (`'walkable'` vs `'blocked'`), walkable slope
 * (`normal[1] > 0.7`), and ground-plane fallback (`y = floorY`) when no
 * explicit `navigable: true` mesh is tagged in the scene.
 */
export function evaluateTeleportArc(
  viewer: PluginViewer,
  origin: readonly number[],
  direction: readonly number[],
  options?: {
    floorY?: number;
    speed?: number;
    gravity?: number;
    segments?: number;
    stepDt?: number;
  },
): TeleportArcHit {
  const floorY = clampNum(options?.floorY, -100, 100, 0);
  const samples = sampleTeleportParabola(
    origin,
    direction,
    options?.speed ?? TELEPORT_SPEED,
    options?.gravity ?? TELEPORT_GRAVITY,
    options?.segments ?? TELEPORT_SEGMENTS,
    options?.stepDt ?? TELEPORT_STEP_DT,
  );
  const meshes = Array.isArray(viewer.meshes) ? viewer.meshes : [];
  const hasExplicitWalkable = meshes.some(
    (m) =>
      m &&
      !m.isPluginMesh &&
      m.visible !== false &&
      parseNavigable(getMeshXRTraits(m)?.navigable) === 'walkable',
  );

  const visited: Vec3[] = [samples[0]];
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const delta = vSub(b, a);
    const segLen = vLen(delta);
    if (segLen < 1e-5) continue;
    const segDir = vScale(delta, 1 / segLen);

    const hit = raycastSceneMeshes(viewer, a, segDir, segLen + 1e-4, (m) => {
      const pe = m.extras?.xr?.pointerEvents ?? m.userData?.xr?.pointerEvents;
      return pe !== 'none';
    });

    if (hit && hit.distance <= segLen + 1e-3) {
      visited.push(hit.point);
      const nav = parseNavigable(getMeshXRTraits(hit.mesh)?.navigable);
      const slopeOk = hit.normal[1] > MIN_WALKABLE_NORMAL_Y;
      const navOk = hasExplicitWalkable ? nav === 'walkable' : nav !== 'blocked';
      return {
        valid: slopeOk && navOk,
        point: hit.point,
        normal: hit.normal,
        points: visited,
        hitMesh: hit.mesh,
      };
    }

    // Ground-plane `y = floorY` fallback when no explicit navigable mesh is tagged.
    if (!hasExplicitWalkable && a[1] >= floorY && b[1] <= floorY && a[1] !== b[1]) {
      const u = (a[1] - floorY) / (a[1] - b[1]);
      const groundPt: Vec3 = [
        a[0] + delta[0] * u,
        floorY,
        a[2] + delta[2] * u,
      ];
      visited.push(groundPt);
      return {
        valid: true,
        point: groundPt,
        normal: [0, 1, 0],
        points: visited,
        hitMesh: null,
      };
    }

    visited.push(b);
  }

  const tail = visited[visited.length - 1];
  return {
    valid: false,
    point: tail,
    normal: [0, 1, 0],
    points: visited,
    hitMesh: null,
  };
}

/** Evaluates thumbstick snap-turn hysteresis (`|x| > 0.65` trigger, `< 0.25` reset). */
export function evaluateSnapTurn(
  axisX: number,
  wasLatched: boolean,
  snapTurnDeg = 30,
): {deltaYawDeg: number; latched: boolean} {
  const stepDeg = clampNum(snapTurnDeg, 15, 90, 30);
  if (!Number.isFinite(axisX)) {
    return {deltaYawDeg: 0, latched: wasLatched};
  }
  const absX = Math.abs(axisX);
  if (wasLatched) {
    return {deltaYawDeg: 0, latched: absX >= SNAP_TURN_RESET};
  }
  if (absX > SNAP_TURN_TRIGGER) {
    // Pushing stick right (`axisX > 0`) turns right (`-stepDeg` around `+Y`).
    return {deltaYawDeg: axisX > 0 ? -stepDeg : stepDeg, latched: true};
  }
  return {deltaYawDeg: 0, latched: false};
}

/** Builds a double-sided 3D ribbon mesh along a polyline of world-space points. */
export function buildTeleportArcGeometry(
  points: readonly Vec3[],
  halfWidth = 0.014,
): DynamicGeometry {
  if (points.length < 2) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }
  const hw = Math.max(0.002, halfWidth);
  const segCount = points.length - 1;
  // Double-sided quad per segment (8 vertices, 12 indices).
  const positions = new Float32Array(segCount * 8 * 3);
  const normals = new Float32Array(segCount * 8 * 3);
  const indices = new Uint16Array(segCount * 12);
  let vi = 0;
  let ii = 0;

  for (let i = 0; i < segCount; i++) {
    const a = points[i];
    const b = points[i + 1];
    const tangent = vNorm(vSub(b, a), [0, 0, -1]);
    let side = vCross(tangent, [0, 1, 0]);
    if (vLen(side) < 1e-4) side = [1, 0, 0];
    side = vScale(vNorm(side, [1, 0, 0]), hw);
    const up = vNorm(vCross(side, tangent), [0, 1, 0]);

    const corners: Vec3[] = [
      vSub(a, side),
      vAdd(a, side),
      vAdd(b, side),
      vSub(b, side),
    ];
    const front = vi;
    for (const c of corners) {
      positions[vi * 3] = c[0];
      positions[vi * 3 + 1] = c[1];
      positions[vi * 3 + 2] = c[2];
      normals[vi * 3] = up[0];
      normals[vi * 3 + 1] = up[1];
      normals[vi * 3 + 2] = up[2];
      vi++;
    }
    indices.set([front, front + 1, front + 2, front, front + 2, front + 3], ii);
    ii += 6;

    const back = vi;
    for (const c of corners) {
      positions[vi * 3] = c[0];
      positions[vi * 3 + 1] = c[1];
      positions[vi * 3 + 2] = c[2];
      normals[vi * 3] = -up[0];
      normals[vi * 3 + 1] = -up[1];
      normals[vi * 3 + 2] = -up[2];
      vi++;
    }
    indices.set([back, back + 2, back + 1, back, back + 3, back + 2], ii);
    ii += 6;
  }

  return {positions, normals, indices};
}

/** Resolved `<xr-live locomotion ...>` element configuration. */
export interface LocomotionElementConfig {
  readonly teleport: boolean;
  readonly snapTurn: boolean;
  readonly smooth: boolean;
  readonly snapTurnDeg: number;
  readonly comfortVignette: boolean;
}

/** Parses `locomotion`, `snap-turn-deg`, and `comfort-vignette` on `<xr-live>`. */
// tslint:disable-next-line:no-any Host element is `<xr-live>`.
export function resolveLocomotionConfig(element: any): LocomotionElementConfig {
  const hasAttr =
    typeof element?.hasAttribute === 'function' &&
    element.hasAttribute('locomotion');
  const raw = (element?.getAttribute?.('locomotion') ?? '').trim().toLowerCase();
  const snapTurnDeg = clampNum(
    element?.getAttribute?.('snap-turn-deg') !== null &&
      element?.getAttribute?.('snap-turn-deg') !== undefined &&
      element?.getAttribute?.('snap-turn-deg') !== ''
      ? Number(element.getAttribute('snap-turn-deg'))
      : undefined,
    15,
    90,
    30,
  );
  const rawVig = (element?.getAttribute?.('comfort-vignette') ?? 'true')
    .trim()
    .toLowerCase();
  const comfortVignette = rawVig !== 'false' && rawVig !== 'none' && rawVig !== '0';

  if (!hasAttr || raw === 'none' || raw === 'false') {
    return {
      teleport: false,
      snapTurn: false,
      smooth: false,
      snapTurnDeg,
      comfortVignette,
    };
  }
  if (!raw || raw === 'true') {
    return {
      teleport: true,
      snapTurn: true,
      smooth: false,
      snapTurnDeg,
      comfortVignette,
    };
  }
  const tokens = new Set(raw.split(/[\s,|+]+/).filter(Boolean));
  return {
    teleport: tokens.has('teleport'),
    snapTurn: tokens.has('snap-turn'),
    smooth: tokens.has('smooth'),
    snapTurnDeg,
    comfortVignette,
  };
}

function forwardFromMatrix(m: ArrayLike<number>): Vec3 {
  return vNorm([-(m[8] ?? 0), -(m[9] ?? 0), -(m[10] ?? 1)], [0, 0, -1]);
}

interface ThumbstickSample {
  readonly axisX: number;
  readonly axisY: number;
  readonly rayOrigin: Vec3;
  readonly rayDirection: Vec3;
}

function readXRThumbstick(
  // tslint:disable-next-line:no-any WebXR session.
  session: any,
  // tslint:disable-next-line:no-any WebXR frame.
  frame: any,
  refSpace: unknown,
  fallbackOrigin: Vec3,
  fallbackDir: Vec3,
): ThumbstickSample | null {
  const sources: Iterable<any> = session?.inputSources ?? [];
  for (const src of sources) {
    const axes: readonly number[] | undefined = src?.gamepad?.axes;
    if (!axes || axes.length < 2) continue;
    const axisX = axes.length >= 4 ? axes[2] : axes[0];
    const axisY = axes.length >= 4 ? axes[3] : axes[1];
    if (Math.abs(axisX) < 0.05 && Math.abs(axisY) < 0.05) continue;

    let rayOrigin = fallbackOrigin;
    let rayDirection = fallbackDir;
    if (src.targetRaySpace && typeof frame?.getPose === 'function') {
      try {
        const pose = frame.getPose(src.targetRaySpace, refSpace);
        const mat = pose?.transform?.matrix;
        if (mat && mat.length === 16) {
          rayOrigin = extractPosition(mat);
          rayDirection = forwardFromMatrix(mat);
        }
      } catch {
        // Ignore transient tracking loss.
      }
    }
    return {axisX, axisY, rayOrigin, rayDirection};
  }
  return null;
}

/**
 * Per-element controller driving parabolic teleportation, snap-turns, smooth
 * glide, rig offsets, and peripheral comfort vignette fades.
 */
export class XRSpatialLocomotionController {
  private rigPosition: Vec3 = [0, 0, 0];
  private rigYawDeg = 0;
  private hasShiftedModelRoot = false;
  private snapLatched = false;
  private aimingTeleport = false;
  private lastArcHit: TeleportArcHit | null = null;
  private vignetteRemainingMs = 0;
  // tslint:disable-next-line:no-any Dynamic arc ribbon GPU mesh.
  private arcMesh: any = null;
  // tslint:disable-next-line:no-any Dynamic landing ring GPU mesh.
  private ringMesh: any = null;
  private ringValidState: boolean | null = null;
  // tslint:disable-next-line:no-any Optional DOM vignette overlay element.
  private vignetteEl: any = null;

  /** Current accumulated viewer rig foot position `[x, y, z]`. */
  get position(): Vec3 {
    return [...this.rigPosition];
  }

  /** Current accumulated viewer rig yaw angle in degrees. */
  get yawDeg(): number {
    return this.rigYawDeg;
  }

  /** Current normalized `[0..1]` peripheral comfort vignette opacity. */
  get vignetteIntensity(): number {
    return Math.max(0, Math.min(1, this.vignetteRemainingMs / COMFORT_VIGNETTE_MS));
  }

  /** Previews a parabolic teleport arc from `(origin, direction)` and updates visuals. */
  aimTeleport(
    viewer: PluginViewer,
    origin: readonly number[],
    direction: readonly number[],
    floorY = 0,
  ): TeleportArcHit {
    const dir = normalizeRayDir(direction) ?? [0, 0, -1];
    const hit = evaluateTeleportArc(viewer, origin, dir, {floorY});
    this.aimingTeleport = true;
    this.lastArcHit = hit;
    this.syncVisuals(viewer, hit);
    return hit;
  }

  /** Commits the currently aimed teleport if valid, hiding preview visuals. */
  commitTeleport(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element?: any,
  ): boolean {
    const hit = this.lastArcHit;
    this.aimingTeleport = false;
    this.lastArcHit = null;
    this.hideVisuals();
    if (!hit || !hit.valid) return false;
    const isSim = Boolean(
      element?.simulator?.active && Array.isArray(element.simulator.headPosition),
    );
    const sceneTarget: Vec3 =
      !isSim && this.hasShiftedModelRoot
        ? this.worldToScenePoint(hit.point)
        : hit.point;
    this.teleportTo(viewer, sceneTarget, element);
    return true;
  }

  private worldToScenePoint(worldPt: readonly number[]): Vec3 {
    const alpha = (this.rigYawDeg * Math.PI) / 180;
    const cosA = Math.cos(alpha);
    const sinA = Math.sin(alpha);
    const wx = worldPt[0] ?? 0;
    const wy = worldPt[1] ?? 0;
    const wz = worldPt[2] ?? 0;
    return [
      this.rigPosition[0] + wx * cosA + wz * sinA,
      this.rigPosition[1] + wy,
      this.rigPosition[2] - wx * sinA + wz * cosA,
    ];
  }

  /** Teleports the viewer rig to `targetFootPos` and dispatches `xrteleport`. */
  teleportTo(
    viewer: PluginViewer,
    targetFootPos: readonly number[],
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element?: any,
  ): void {
    const cfg = resolveLocomotionConfig(element);
    const from: Vec3 = [...this.rigPosition];
    const to: Vec3 = [
      clampNum(targetFootPos[0], -1000, 1000, 0),
      clampNum(targetFootPos[1], -1000, 1000, 0),
      clampNum(targetFootPos[2], -1000, 1000, 0),
    ];
    this.rigPosition = to;
    this.applyRigToHost(viewer, element);
    if (cfg.comfortVignette) {
      this.vignetteRemainingMs = COMFORT_VIGNETTE_MS;
      this.syncVignetteDom(viewer);
    }
    emitPluginEvent(element, 'xrteleport', {
      from,
      to: [...to],
      yawDeg: this.rigYawDeg,
    });
  }

  /** Evaluates a horizontal thumbstick sample and applies a comfort snap-turn when triggered. */
  applySnapTurnAxis(
    viewer: PluginViewer,
    axisX: number,
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element?: any,
  ): number {
    const cfg = resolveLocomotionConfig(element);
    const res = evaluateSnapTurn(axisX, this.snapLatched, cfg.snapTurnDeg);
    this.snapLatched = res.latched;
    if (res.deltaYawDeg !== 0) {
      this.rigYawDeg = ((this.rigYawDeg + res.deltaYawDeg) % 360 + 540) % 360 - 180;
      this.applyRigToHost(viewer, element, res.deltaYawDeg);
      if (cfg.comfortVignette) {
        this.vignetteRemainingMs = COMFORT_VIGNETTE_MS * 0.75;
        this.syncVignetteDom(viewer);
      }
    }
    return res.deltaYawDeg;
  }

  /** Steps thumbstick locomotion, arc visuals, and comfort vignette decay. */
  step(
    viewer: PluginViewer,
    dtSeconds: number,
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element?: any,
    // tslint:disable-next-line:no-any Optional WebXR session/frame/refSpace.
    xrCtx?: {session?: any; frame?: any; refSpace?: any},
  ): void {
    const cfg = resolveLocomotionConfig(element);
    const dtMs = clampNum(dtSeconds, 0, 0.25, 1 / 60) * 1000;
    if (this.vignetteRemainingMs > 0) {
      this.vignetteRemainingMs = Math.max(0, this.vignetteRemainingMs - dtMs);
      this.syncVignetteDom(viewer);
    }

    if (!cfg.teleport && !cfg.snapTurn && !cfg.smooth) {
      this.hideVisuals();
      return;
    }

    if (xrCtx?.session) {
      const head = resolveHeadPose(viewer);
      const headFwd = forwardFromMatrix(head.matrix);
      const stick = readXRThumbstick(
        xrCtx.session,
        xrCtx.frame,
        xrCtx.refSpace,
        head.position,
        headFwd,
      );
      const floorY = clampNum(element?.simulator?.room?.floorY, -100, 100, 0);

      if (cfg.snapTurn) {
        this.applySnapTurnAxis(viewer, stick?.axisX ?? 0, element);
      }

      if (cfg.teleport) {
        const isSim = Boolean(
          element?.simulator?.active && Array.isArray(element.simulator.headPosition),
        );
        const worldFloorY =
          !isSim && this.hasShiftedModelRoot ? floorY - this.rigPosition[1] : floorY;
        if (stick && stick.axisY < -0.5) {
          this.aimTeleport(viewer, stick.rayOrigin, stick.rayDirection, worldFloorY);
        } else if (this.aimingTeleport && (!stick || stick.axisY >= -0.35)) {
          this.commitTeleport(viewer, element);
        }
      }

      if (cfg.smooth && stick && Math.abs(stick.axisY) > 0.2) {
        const dt = clampNum(dtSeconds, 0, 0.1, 1 / 60);
        const speed = 2.2 * -stick.axisY * dt;
        const flatWorldFwd = vNorm([headFwd[0], 0, headFwd[2]], [0, 0, -1]);
        const isSim = Boolean(
          element?.simulator?.active && Array.isArray(element.simulator.headPosition),
        );
        const alpha = !isSim ? (this.rigYawDeg * Math.PI) / 180 : 0;
        const cosA = Math.cos(alpha);
        const sinA = Math.sin(alpha);
        const sceneDx = flatWorldFwd[0] * cosA + flatWorldFwd[2] * sinA;
        const sceneDz = -flatWorldFwd[0] * sinA + flatWorldFwd[2] * cosA;
        this.rigPosition = [
          clampNum(this.rigPosition[0] + sceneDx * speed, -1000, 1000, 0),
          this.rigPosition[1],
          clampNum(this.rigPosition[2] + sceneDz * speed, -1000, 1000, 0),
        ];
        this.applyRigToHost(viewer, element);
        if (cfg.comfortVignette) {
          this.vignetteRemainingMs = Math.max(this.vignetteRemainingMs, 60);
          this.syncVignetteDom(viewer);
        }
      }
    }
  }

  private applyRigToHost(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element is `<xr-live>`.
    element: any,
    deltaYawDeg = 0,
  ): void {
    if (element?.simulator?.active && Array.isArray(element.simulator.headPosition)) {
      const floorY = clampNum(element.simulator.room?.floorY, -100, 100, 0);
      const eyeOffset = Math.max(0.2, (element.simulator.headPosition[1] ?? 1.6) - floorY);
      element.simulator.headPosition = [
        this.rigPosition[0],
        this.rigPosition[1] + eyeOffset,
        this.rigPosition[2],
      ];
      if (deltaYawDeg !== 0 && typeof element.simulator.headYaw === 'number') {
        element.simulator.headYaw += (deltaYawDeg * Math.PI) / 180;
      }
      return;
    }

    // Apply inverse rig transform to `viewer.modelRootMatrix` so world content
    // shifts smoothly beneath the user in WebXR or standalone viewer sessions.
    const yawRad = (-this.rigYawDeg * Math.PI) / 180;
    const q = quatFromEulerYXZ(0, yawRad, 0);
    const cosY = Math.cos(yawRad);
    const sinY = Math.sin(yawRad);
    const tx = -this.rigPosition[0] * cosY - this.rigPosition[2] * sinY;
    const ty = -this.rigPosition[1];
    const tz = this.rigPosition[0] * sinY - this.rigPosition[2] * cosY;
    const m = viewer.modelRootMatrix ?? mat4Create();
    mat4FromRotationTranslationScale(m, q, [tx, ty, tz], [1, 1, 1]);
    viewer.modelRootMatrix = m;
    this.hasShiftedModelRoot = true;
  }

  private syncVisuals(viewer: PluginViewer, hit: TeleportArcHit): void {
    const color: [number, number, number, number] = hit.valid
      ? [0.22, 0.74, 0.97, 0.9]
      : [0.96, 0.25, 0.37, 0.9];
    const arcGeo = buildTeleportArcGeometry(hit.points, 0.014);
    if (!this.arcMesh) {
      this.arcMesh = createDynamicMesh(viewer, arcGeo, {
        name: '__xr_teleport_arc__',
        color,
        roughness: 0.2,
        alphaBlend: true,
        pickable: false,
        worldSpace: true,
      });
    } else {
      reattachDynamicMesh(viewer, this.arcMesh);
      updateDynamicMesh(viewer, this.arcMesh, arcGeo);
      if (this.arcMesh.primitives?.[0]?.material) {
        this.arcMesh.primitives[0].material.baseColorFactor = color;
      }
      applyWorldMatrix(viewer, this.arcMesh);
    }
    this.arcMesh.visible = true;

    if (!this.ringMesh || this.ringValidState !== hit.valid) {
      removeDynamicMesh(viewer, this.ringMesh);
      this.ringMesh = createDynamicMesh(viewer, buildSnapRingGeometry(0.18, 0.014), {
        name: '__xr_teleport_ring__',
        color,
        roughness: 0.2,
        alphaBlend: true,
        pickable: false,
        worldSpace: true,
      });
      this.ringValidState = hit.valid;
    } else {
      reattachDynamicMesh(viewer, this.ringMesh);
    }
    this.ringMesh.visible = true;
    const n = vNorm(hit.normal, [0, 1, 0]);
    const pos = vAdd(hit.point, vScale(n, 0.008));
    const q = quatFromUnitVectors([0, 1, 0], n);
    setWorldTRS(viewer, this.ringMesh, q, pos, [1, 1, 1]);
  }

  private hideVisuals(): void {
    if (this.arcMesh) this.arcMesh.visible = false;
    if (this.ringMesh) this.ringMesh.visible = false;
  }

  private syncVignetteDom(viewer: PluginViewer): void {
    const opacity = this.vignetteIntensity;
    // tslint:disable-next-line:no-any Optional DOM container.
    const container = viewer?.container as any;
    const doc = container?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof container?.appendChild !== 'function') return;

    if (opacity <= 1e-3) {
      if (this.vignetteEl?.style) {
        this.vignetteEl.style.opacity = '0';
      }
      return;
    }
    if (!this.vignetteEl) {
      const el = doc.createElement('div');
      el.setAttribute('data-xr-comfort-vignette', '');
      if (el.style) {
        el.style.position = 'absolute';
        el.style.inset = '0';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '10';
        el.style.background =
          'radial-gradient(circle, rgba(0,0,0,0) 42%, rgba(0,0,0,0.82) 95%)';
        el.style.transition = 'opacity 60ms linear';
      }
      container.appendChild(el);
      this.vignetteEl = el;
    }
    if (this.vignetteEl.style) {
      this.vignetteEl.style.opacity = String(Math.round(opacity * 100) / 100);
    }
  }

  /** Disposes dynamic arc/ring GPU buffers and DOM comfort vignette overlay. */
  dispose(viewer: PluginViewer | undefined): void {
    removeDynamicMesh(viewer, this.arcMesh);
    this.arcMesh = null;
    removeDynamicMesh(viewer, this.ringMesh);
    this.ringMesh = null;
    this.ringValidState = null;
    this.aimingTeleport = false;
    this.lastArcHit = null;
    this.vignetteRemainingMs = 0;
    if (this.vignetteEl?.parentNode) {
      this.vignetteEl.parentNode.removeChild(this.vignetteEl);
    }
    this.vignetteEl = null;
  }
}

const controllers = new WeakMap<object, XRSpatialLocomotionController>();

/** Returns (creating on first use) the `spatial-locomotion` controller for `key`. */
export function getSpatialLocomotionController(
  key: object,
): XRSpatialLocomotionController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRSpatialLocomotionController();
    controllers.set(key, c);
  }
  return c;
}

/** `ThreeLivePlugin` providing parabolic teleportation, snap-turns & comfort vignette. */
export const spatialLocomotionPlugin: ThreeLivePlugin = {
  name: 'xr-live-spatial-locomotion',
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element) return;
    const ctrl = getSpatialLocomotionController(element);
    const viewerOf = (): PluginViewer | undefined => element._view ?? element.viewer;
    element.teleportTo = (target: Vec3) => {
      const v = viewerOf();
      if (v) ctrl.teleportTo(v, target, element);
    };
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    controllers.get(element)?.dispose(element?._view ?? element?.viewer);
  },
  onXRFrame(viewer: unknown, session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    getSpatialLocomotionController(host ?? v).step(v, 1 / 72, host, {
      session,
      frame,
      refSpace,
    });
  },
  onUpdate(viewer: PluginViewer, dt: number): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getSpatialLocomotionController(host ?? viewer).step(viewer, dt, host);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.dispose(viewer);
  },
};
