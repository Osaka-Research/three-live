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
 * @fileoverview `magnetic-snap` plugin for `<xr-live>`.
 *
 * Provides declarative socket snapping with 1.25× breakaway hysteresis and a
 * pulsing ghost preview ring, plus Cartesian grid, rotational increment, and
 * AR surface (`floor` / `wall` / `ceiling` / `any`) quantization.
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Multiply,
} from '../../../three-live/src/math';
import {
  type ThreeLivePlugin,
  XR_LIVE_AR_SURFACE_Y,
} from '../../../three-live/src/plugin';
import {
  clampNum,
  parseSnapSocket,
  parseSnapTo,
  type SnapSocketOptions,
  type SnapSurfaceMode,
  type SnapToOptions,
} from '../../../three-live/src/xr-trait-schema';
import {
  computeMeshBottomOffset,
  extractPosition,
  extractQuaternion,
  extractScale,
  getMeshXRTraits,
  quatFromEulerYXZ,
  quatSlerp,
} from '../xr-traits';
import {
  cacheXRFrame,
  createDynamicMesh,
  type DynamicGeometry,
  emitPluginEvent,
  isXRFrameFresh,
  measureFrameDt,
  meshWorldMatrix,
  type PluginViewer,
  type Quat,
  reattachDynamicMesh,
  removeDynamicMesh,
  rootMatrix,
  setWorldTRS,
  vDot,
  type Vec3,
  vLen,
  vNorm,
  vScale,
  vSub,
} from './common';
import {parseHexColor} from './spatial-paint';
import {
  getWorldUnderstandingController,
  type TrackedPlane,
} from './world-understanding';

export {
  parseSnapSocket,
  parseSnapTo,
  type SnapSocketOptions,
  type SnapSurfaceMode,
  type SnapToOptions,
};

/** Breakaway hysteresis multiplier applied once locked into a socket. */
export const SOCKET_UNSNAP_MULTIPLIER = 1.25;
/** Preview highlight ring activation multiplier relative to `snapRadius`. */
export const SOCKET_PREVIEW_MULTIPLIER = 1.5;

function normalizeQuat(q: readonly number[]): Quat {
  const x = Number.isFinite(q[0]) ? q[0] : 0;
  const y = Number.isFinite(q[1]) ? q[1] : 0;
  const z = Number.isFinite(q[2]) ? q[2] : 0;
  const w = Number.isFinite(q[3]) ? q[3] : 1;
  const len = Math.hypot(x, y, z, w);
  return len > 1e-8 ? [x / len, y / len, z / len, w / len] : [0, 0, 0, 1];
}

/**
 * Decomposes a unit quaternion `[x, y, z, w]` into intrinsic YXZ Euler angles
 * `[pitchX, yawY, rollZ]` (exact inverse of `quatFromEulerYXZ`).
 */
export function eulerYXZFromQuat(
  q: readonly number[],
): [number, number, number] {
  const [x, y, z, w] = normalizeQuat(q);
  const sinPitch = Math.max(-1, Math.min(1, 2 * (w * x - y * z)));
  const pitchX = Math.asin(sinPitch);
  if (Math.abs(sinPitch) < 0.99999) {
    const yawY = Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
    const rollZ = Math.atan2(2 * (x * y + w * z), 1 - 2 * (x * x + z * z));
    return [pitchX, yawY, rollZ];
  }
  const yawY = Math.atan2(2 * (w * y - x * z), 1 - 2 * (y * y + z * z));
  return [pitchX, yawY, 0];
}

/**
 * Quantizes a quaternion's YXZ Euler angles to multiples of `angleDeg` degrees.
 */
export function quantizeQuaternionAngle(
  q: readonly number[],
  angleDeg: number,
): Quat {
  const norm = normalizeQuat(q);
  if (!Number.isFinite(angleDeg) || angleDeg <= 0) return norm;
  const step = (Math.min(180, angleDeg) * Math.PI) / 180;
  const [px, yy, rz] = eulerYXZFromQuat(norm);
  const qx = Math.round(px / step) * step;
  const qy = Math.round(yy / step) * step;
  const qz = Math.round(rz / step) * step;
  return quatFromEulerYXZ(qx, qy, qz);
}

/**
 * Quantizes a 3D world position to the Cartesian step vector `grid` (meters).
 */
export function quantizeGridPosition(
  pos: readonly number[],
  grid: readonly [number, number, number] | null,
): Vec3 {
  const p: Vec3 = [
    Number.isFinite(pos[0]) ? pos[0] : 0,
    Number.isFinite(pos[1]) ? pos[1] : 0,
    Number.isFinite(pos[2]) ? pos[2] : 0,
  ];
  if (!grid) return p;
  return [
    grid[0] > 0 ? Math.round(p[0] / grid[0]) * grid[0] + 0 : p[0],
    grid[1] > 0 ? Math.round(p[1] / grid[1]) * grid[1] + 0 : p[1],
    grid[2] > 0 ? Math.round(p[2] / grid[2]) * grid[2] + 0 : p[2],
  ];
}

/** World-space snap socket descriptor. */
export interface SnapSocketCandidate {
  readonly id: string;
  readonly tag: string;
  readonly position: Vec3;
  readonly quaternion: Quat;
  readonly radius: number;
  readonly alignRotation: boolean;
  readonly highlightColor: string;
  // tslint:disable-next-line:no-any Optional scene mesh reference.
  readonly node?: any;
}

/** Surface plane descriptor accepted by `evaluateMagneticSnap`. */
export interface SnapSurfacePlane {
  readonly position: readonly number[];
  readonly normal: readonly number[];
  readonly orientation?: 'horizontal' | 'vertical';
  readonly semanticLabel?: string;
}

/** Parameters for `evaluateMagneticSnap`. */
export interface EvaluateMagneticSnapParams {
  readonly position: readonly number[];
  readonly quaternion: readonly number[];
  readonly config: SnapToOptions;
  readonly sockets?: readonly SnapSocketCandidate[];
  readonly planes?: readonly SnapSurfacePlane[];
  readonly currentSocketId?: string | null;
  readonly bottomOffset?: number;
  readonly defaultFloorY?: number;
}

/** Result of evaluating magnetic snap constraints for one pose. */
export interface MagneticSnapEvaluation {
  readonly position: Vec3;
  readonly quaternion: Quat;
  readonly mode: 'socket' | 'grid' | 'surface' | 'none';
  readonly matchedSocketId: string | null;
  readonly previewSocketId: string | null;
}

function planeMatchesSurface(
  plane: SnapSurfacePlane,
  mode: SnapSurfaceMode,
): boolean {
  if (mode === 'none') return false;
  if (mode === 'any') return true;
  const n = vNorm(plane.normal, [0, 1, 0]);
  const label = (plane.semanticLabel ?? '').toLowerCase();
  if (mode === 'floor') {
    return label === 'floor' || (label !== 'ceiling' && n[1] > 0.7);
  }
  if (mode === 'ceiling') {
    return label === 'ceiling' || n[1] < -0.7;
  }
  if (mode === 'wall') {
    return (
      label === 'wall' ||
      plane.orientation === 'vertical' ||
      Math.abs(n[1]) <= 0.35
    );
  }
  return false;
}

/**
 * Pure cross-platform snap evaluator shared in structure with
 * `MagneticSnap.evaluate` on Android (`MagneticSnap.kt`) and iOS/visionOS
 * (`MagneticSnap.swift`).
 */
export function evaluateMagneticSnap(
  params: EvaluateMagneticSnapParams,
): MagneticSnapEvaluation {
  const pos: Vec3 = [
    Number.isFinite(params.position[0]) ? params.position[0] : 0,
    Number.isFinite(params.position[1]) ? params.position[1] : 0,
    Number.isFinite(params.position[2]) ? params.position[2] : 0,
  ];
  const quat = normalizeQuat(params.quaternion);
  const {config} = params;
  const sockets = params.sockets ?? [];
  const planes = params.planes ?? [];
  const bottomOffset = Number.isFinite(params.bottomOffset)
    ? (params.bottomOffset as number)
    : 0;
  const floorY = Number.isFinite(params.defaultFloorY)
    ? (params.defaultFloorY as number)
    : 0;

  // 1. Socket matching with 1.25x breakaway hysteresis + 1.5x preview ring.
  let matchedSocket: SnapSocketCandidate | null = null;
  let previewSocket: SnapSocketCandidate | null = null;
  if (config.socketTag) {
    if (params.currentSocketId) {
      const held = sockets.find(
        (s) => s.id === params.currentSocketId && s.tag === config.socketTag,
      );
      if (held) {
        const snapR = Math.min(config.radius, held.radius);
        const unsnapR = SOCKET_UNSNAP_MULTIPLIER * snapR;
        if (vLen(vSub(pos, held.position)) <= unsnapR) {
          matchedSocket = held;
          previewSocket = held;
        }
      }
    }
    if (!matchedSocket) {
      let bestSnapDist = Infinity;
      let bestPreviewDist = Infinity;
      for (const s of sockets) {
        if (s.tag !== config.socketTag) continue;
        const snapR = Math.min(config.radius, s.radius);
        const d = vLen(vSub(pos, s.position));
        if (d <= snapR && d < bestSnapDist) {
          bestSnapDist = d;
          matchedSocket = s;
        }
        if (d <= SOCKET_PREVIEW_MULTIPLIER * snapR && d < bestPreviewDist) {
          bestPreviewDist = d;
          previewSocket = s;
        }
      }
    }
  }

  if (matchedSocket) {
    const snappedQuat = matchedSocket.alignRotation
      ? normalizeQuat(matchedSocket.quaternion)
      : config.angleDeg > 0
        ? quantizeQuaternionAngle(quat, config.angleDeg)
        : quat;
    return {
      position: [...matchedSocket.position],
      quaternion: snappedQuat,
      mode: 'socket',
      matchedSocketId: matchedSocket.id,
      previewSocketId: matchedSocket.id,
    };
  }

  // 2. Fallback: Cartesian grid, surface clamping, and angle quantization.
  let nextPos = quantizeGridPosition(pos, config.grid);
  let surfaceApplied = false;

  if (config.surface !== 'none') {
    let bestPlane: SnapSurfacePlane | null = null;
    let bestPlaneErr = Infinity;
    const captureLimit = Math.max(config.radius, 0.35);
    for (const p of planes) {
      if (!planeMatchesSurface(p, config.surface)) continue;
      const n = vNorm(p.normal, [0, 1, 0]);
      // Only upward-facing support surfaces lift the object by its bottom
      // offset; walls and ceilings snap the pivot onto the plane.
      const lift = n[1] > 0.7 ? bottomOffset : 0;
      const signed = vDot(vSub(nextPos, p.position), n) - lift;
      const absErr = Math.abs(signed);
      if (absErr <= captureLimit && absErr < bestPlaneErr) {
        bestPlaneErr = absErr;
        bestPlane = p;
      }
    }
    if (bestPlane) {
      const n = vNorm(bestPlane.normal, [0, 1, 0]);
      const lift = n[1] > 0.7 ? bottomOffset : 0;
      const signed = vDot(vSub(nextPos, bestPlane.position), n) - lift;
      nextPos = vSub(nextPos, vScale(n, signed));
      surfaceApplied = true;
    } else if (config.surface === 'floor' || config.surface === 'any') {
      nextPos = [nextPos[0], floorY + bottomOffset, nextPos[2]];
      surfaceApplied = true;
    }
  }

  const nextQuat =
    config.angleDeg > 0 ? quantizeQuaternionAngle(quat, config.angleDeg) : quat;
  const gridOrAngleApplied = config.grid !== null || config.angleDeg > 0;
  const mode: MagneticSnapEvaluation['mode'] =
    surfaceApplied && config.grid === null
      ? 'surface'
      : gridOrAngleApplied
        ? 'grid'
        : surfaceApplied
          ? 'surface'
          : 'none';

  return {
    position: nextPos,
    quaternion: nextQuat,
    mode,
    matchedSocketId: null,
    previewSocketId: previewSocket?.id ?? null,
  };
}

/**
 * Generates a 3D torus ring in the XZ plane (`+Y` normal) for socket preview.
 */
export function buildSnapRingGeometry(
  majorRadius = 0.12,
  tubeRadius = 0.008,
  radialSegments = 24,
  tubularSegments = 8,
): DynamicGeometry {
  const R = Math.max(0.01, majorRadius);
  const r = Math.max(0.001, Math.min(R * 0.45, tubeRadius));
  const segU = Math.max(8, Math.floor(radialSegments));
  const segV = Math.max(4, Math.floor(tubularSegments));

  const vertCount = (segU + 1) * (segV + 1);
  const positions = new Float32Array(vertCount * 3);
  const normals = new Float32Array(vertCount * 3);
  const indices = new Uint16Array(segU * segV * 6);

  let vi = 0;
  for (let i = 0; i <= segU; i++) {
    const u = (i / segU) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * Math.PI * 2;
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const rad = R + r * cv;
      positions[vi * 3] = rad * cu;
      positions[vi * 3 + 1] = r * sv;
      positions[vi * 3 + 2] = rad * su;
      normals[vi * 3] = cv * cu;
      normals[vi * 3 + 1] = sv;
      normals[vi * 3 + 2] = cv * su;
      vi++;
    }
  }

  let ii = 0;
  const stride = segV + 1;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * stride + j;
      const b = (i + 1) * stride + j;
      const c = (i + 1) * stride + (j + 1);
      const d = i * stride + (j + 1);
      indices[ii++] = a;
      indices[ii++] = c;
      indices[ii++] = b;
      indices[ii++] = a;
      indices[ii++] = d;
      indices[ii++] = c;
    }
  }
  return {positions, normals, indices};
}

/** Element-level `<xr-live magnetic-snap ...>` fallback defaults. */
export interface MagneticSnapElementDefaults {
  readonly enabled: boolean;
  readonly grid: [number, number, number] | null;
  readonly angleDeg: number;
  readonly surface: SnapSurfaceMode;
}

function parseGridAttr(
  raw: string | null | undefined,
): [number, number, number] | null {
  if (!raw) return null;
  const parts = raw
    .split(/[\s,]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 1) {
    const g = clampNum(parts[0], 0.001, 100, 0.1);
    return [g, g, g];
  }
  if (parts.length >= 3) {
    return [
      clampNum(parts[0], 0.001, 100, 0.1),
      clampNum(parts[1], 0.001, 100, 0.1),
      clampNum(parts[2], 0.001, 100, 0.1),
    ];
  }
  return null;
}

/** Parses `magnetic-snap`, `snap-grid`, and `snap-angle` attributes on `<xr-live>`. */
// tslint:disable-next-line:no-any Host element is `<xr-live>`.
export function resolveMagneticSnapDefaults(
  element: any,
): MagneticSnapElementDefaults {
  const hasAttr =
    typeof element?.hasAttribute === 'function' &&
    element.hasAttribute('magnetic-snap');
  const rawMode = (element?.getAttribute?.('magnetic-snap') ?? '')
    .trim()
    .toLowerCase();
  const gridAttr = parseGridAttr(element?.getAttribute?.('snap-grid'));
  const rawAngle = element?.getAttribute?.('snap-angle');
  const angleDeg =
    rawAngle !== null && rawAngle !== undefined && rawAngle !== ''
      ? clampNum(Number(rawAngle), 0, 180, 0)
      : 0;

  if (!hasAttr || rawMode === 'false' || rawMode === 'none') {
    const implicit = gridAttr !== null || angleDeg > 0;
    return {
      enabled: implicit,
      grid: gridAttr,
      angleDeg,
      surface: 'none',
    };
  }
  if (rawMode === 'surface') {
    return {
      enabled: true,
      grid: gridAttr,
      angleDeg,
      surface: 'any',
    };
  }
  if (rawMode === 'sockets') {
    // Socket snapping only: per-node `snapTo.socketTag` drives matches; no
    // grid, angle, or surface quantization unless explicitly configured.
    return {enabled: true, grid: gridAttr, angleDeg, surface: 'none'};
  }
  if (rawMode === 'all') {
    return {
      enabled: true,
      grid: gridAttr ?? [0.1, 0.1, 0.1],
      angleDeg,
      surface: 'any',
    };
  }
  if (rawMode === 'grid') {
    return {
      enabled: true,
      grid: gridAttr ?? [0.1, 0.1, 0.1],
      angleDeg,
      surface: 'none',
    };
  }
  return {
    enabled: true,
    grid: gridAttr ?? (angleDeg > 0 ? null : [0.1, 0.1, 0.1]),
    angleDeg,
    surface: gridAttr === null && angleDeg === 0 ? 'floor' : 'none',
  };
}

interface ActiveNodeSnapState {
  matchedSocketId: string | null;
  // tslint:disable-next-line:no-any Socket scene mesh reference.
  matchedSocketNode: any;
  smoothedPos: Vec3;
  smoothedQuat: Quat;
  lastEval: MagneticSnapEvaluation;
  lastEmittedKey: string;
  config: SnapToOptions;
  bottomOffset: number;
}

function snapEventKey(ev: MagneticSnapEvaluation): string {
  if (ev.mode === 'none') return '';
  if (ev.mode === 'socket') return `socket:${ev.matchedSocketId ?? ''}`;
  const p = ev.position.map((v) => Math.round(v * 1000)).join(',');
  const q = ev.quaternion.map((v) => Math.round(v * 1000)).join(',');
  return `${ev.mode}:${p}:${q}`;
}

/**
 * Per-element controller indexing `snapSocket` nodes, applying magnetic snap
 * constraints to active grabs, rendering the preview torus ring, and emitting
 * `xrsnap` / `xrunsnap` DOM events.
 */
export class XRMagneticSnapController {
  private readonly activeStates = new Map<object, ActiveNodeSnapState>();
  // tslint:disable-next-line:no-any GPU mesh struct.
  private previewRingMesh: any = null;
  private previewRingRadius = 0;
  private pulsePhase = 0;

  /** Collects all visible `snapSocket` meshes in the scene in world space. */
  collectSockets(viewer: PluginViewer): SnapSocketCandidate[] {
    const meshes = viewer.meshes;
    if (!Array.isArray(meshes)) return [];
    const out: SnapSocketCandidate[] = [];
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m || m.isPluginMesh || m.visible === false) continue;
      const traits = getMeshXRTraits(m);
      const sock = parseSnapSocket(traits?.snapSocket);
      if (!sock) continue;
      const wm = meshWorldMatrix(viewer, m);
      out.push({
        id: m.name ? `${m.name}#${i}` : `socket#${i}`,
        tag: sock.tag,
        position: extractPosition(wm),
        quaternion: extractQuaternion(wm),
        radius: sock.radius,
        alignRotation: sock.alignRotation,
        highlightColor: sock.highlightColor,
        node: m,
      });
    }
    return out;
  }

  private resolveNodeSnapConfig(
    // tslint:disable-next-line:no-any Mesh struct.
    mesh: any,
    defaults: MagneticSnapElementDefaults,
  ): SnapToOptions | null {
    const rawTraits = getMeshXRTraits(mesh);
    const parsed = parseSnapTo(rawTraits?.snapTo);
    if (parsed) {
      return {
        grid:
          parsed.grid ?? (rawTraits?.snapTo === true ? defaults.grid : null),
        angleDeg:
          parsed.angleDeg > 0
            ? parsed.angleDeg
            : rawTraits?.snapTo === true
              ? defaults.angleDeg
              : 0,
        surface:
          parsed.surface !== 'none'
            ? parsed.surface
            : rawTraits?.snapTo === true
              ? defaults.surface
              : 'none',
        socketTag: parsed.socketTag,
        radius: parsed.radius,
      };
    }
    if (!defaults.enabled) return null;
    return {
      grid: defaults.grid,
      angleDeg: defaults.angleDeg,
      surface: defaults.surface,
      socketTag: '',
      radius: 0.15,
    };
  }

  /** Steps magnetic snap evaluation for active and newly-released grabs. */
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  update(
    viewer: PluginViewer,
    dt = 1 / 60,
    element?: any,
    planesOverride?: readonly TrackedPlane[],
  ): void {
    const clampedDt = Math.max(
      0.001,
      Math.min(0.1, Number.isFinite(dt) ? dt : 1 / 60),
    );
    this.pulsePhase += clampedDt * 5.0;
    const traitSystem = element?.traitSystem;
    const defaults = resolveMagneticSnapDefaults(element);
    const sockets = this.collectSockets(viewer);
    const socketById = new Map<string, SnapSocketCandidate>();
    for (const s of sockets) socketById.set(s.id, s);

    const planes =
      planesOverride ??
      (element ? getWorldUnderstandingController(element).planes : []);
    const root = rootMatrix(viewer);
    // In AR the virtual floor is the detected surface the scene is pinned to
    // (`XR_LIVE_AR_SURFACE_Y` in scene space), not world y = 0.
    const floorY = viewer.xrSessionActive
      ? root[5] * XR_LIVE_AR_SURFACE_Y + root[13]
      : Number.isFinite(element?.simulator?.room?.floorY)
        ? element.simulator.room.floorY
        : 0;

    const grabbedList: unknown[] =
      typeof traitSystem?.getGrabbedMeshes === 'function'
        ? traitSystem.getGrabbedMeshes()
        : [];
    const grabbedSet = new Set<object>(
      grabbedList.filter(
        (m): m is object => typeof m === 'object' && m !== null,
      ),
    );

    let activePreviewSocket: SnapSocketCandidate | null = null;

    // 1. Finalize any mesh whose grab just ended on this frame.
    for (const [meshObj, state] of this.activeStates.entries()) {
      if (grabbedSet.has(meshObj)) continue;
      // tslint:disable-next-line:no-any Mesh struct.
      const mesh = meshObj as any;
      const worldScale = extractScale(meshWorldMatrix(viewer, mesh));
      if (state.lastEval.mode !== 'none') {
        setWorldTRS(
          viewer,
          mesh,
          state.lastEval.quaternion,
          state.lastEval.position,
          worldScale,
        );
        const key = snapEventKey(state.lastEval);
        if (key && key !== state.lastEmittedKey) {
          emitPluginEvent(element, 'xrsnap', {
            node: mesh,
            socket: state.matchedSocketNode ?? null,
            position: [...state.lastEval.position],
            quaternion: [...state.lastEval.quaternion],
            mode: state.lastEval.mode,
          });
        }
      }
      this.activeStates.delete(meshObj);
    }

    // 2. Evaluate all currently grabbed meshes.
    for (const meshObj of grabbedSet) {
      // tslint:disable-next-line:no-any Mesh struct.
      const mesh = meshObj as any;
      const cfg = this.resolveNodeSnapConfig(mesh, defaults);
      if (!cfg) continue;

      const worldMatNow = meshWorldMatrix(viewer, mesh);
      const worldScale = extractScale(worldMatNow);
      const rawLocal = traitSystem?.getRawGrabPose?.(mesh);
      let rawWorldPos: Vec3;
      let rawWorldQuat: Quat;
      if (rawLocal) {
        const localMat = mat4Create();
        mat4FromRotationTranslationScale(
          localMat,
          rawLocal.quaternion,
          rawLocal.position,
          extractScale(mesh.transform),
        );
        const rawWorldMat = mat4Create();
        mat4Multiply(rawWorldMat, root, localMat);
        rawWorldPos = extractPosition(rawWorldMat);
        rawWorldQuat = extractQuaternion(rawWorldMat);
      } else {
        rawWorldPos = extractPosition(worldMatNow);
        rawWorldQuat = extractQuaternion(worldMatNow);
      }

      const prev = this.activeStates.get(meshObj);
      const bottomOffset = computeMeshBottomOffset(mesh, worldScale);
      // Never snap a mesh into its own socket, or into a socket another
      // grabbed mesh is already seated in.
      const occupied = new Set<string>();
      for (const [other, st] of this.activeStates) {
        if (other !== meshObj && st.matchedSocketId)
          occupied.add(st.matchedSocketId);
      }
      const availableSockets = sockets.filter(
        (s) => s.node !== mesh && !occupied.has(s.id),
      );
      const ev = evaluateMagneticSnap({
        position: rawWorldPos,
        quaternion: rawWorldQuat,
        config: cfg,
        sockets: availableSockets,
        planes,
        currentSocketId: prev?.matchedSocketId ?? null,
        bottomOffset,
        defaultFloorY: floorY,
      });

      const matchedSock = ev.matchedSocketId
        ? (socketById.get(ev.matchedSocketId) ?? null)
        : null;
      const previewSock = ev.previewSocketId
        ? (socketById.get(ev.previewSocketId) ?? null)
        : null;
      if (previewSock && !activePreviewSocket) {
        activePreviewSocket = previewSock;
      }

      // Exponential ease-in (~0.15s settling) into socket pose; crisp follow otherwise.
      const easeAlpha =
        ev.mode === 'socket' ? 1 - Math.exp(-clampedDt / 0.04) : 1;
      const basePos = prev ? prev.smoothedPos : rawWorldPos;
      const baseQuat = prev ? prev.smoothedQuat : rawWorldQuat;
      const smoothedPos: Vec3 = [
        basePos[0] + (ev.position[0] - basePos[0]) * easeAlpha,
        basePos[1] + (ev.position[1] - basePos[1]) * easeAlpha,
        basePos[2] + (ev.position[2] - basePos[2]) * easeAlpha,
      ];
      const smoothedQuat = quatSlerp(baseQuat, ev.quaternion, easeAlpha);

      if (ev.mode !== 'none') {
        setWorldTRS(viewer, mesh, smoothedQuat, smoothedPos, worldScale);
      }

      // Dispatch socket `xrunsnap` / `xrsnap` and deduplicated grid/surface `xrsnap`.
      if (
        prev?.matchedSocketId &&
        prev.matchedSocketId !== ev.matchedSocketId
      ) {
        emitPluginEvent(element, 'xrunsnap', {
          node: mesh,
          socket: prev.matchedSocketNode ?? null,
        });
      }
      const key = snapEventKey(ev);
      let emittedKey = prev?.lastEmittedKey ?? '';
      if (ev.mode === 'socket') {
        if (ev.matchedSocketId !== (prev?.matchedSocketId ?? null)) {
          emitPluginEvent(element, 'xrsnap', {
            node: mesh,
            socket: matchedSock?.node ?? null,
            position: [...ev.position],
            quaternion: [...ev.quaternion],
            mode: 'socket',
          });
          emittedKey = key;
        }
      } else if (ev.mode !== 'none' && key !== emittedKey) {
        emitPluginEvent(element, 'xrsnap', {
          node: mesh,
          socket: null,
          position: [...ev.position],
          quaternion: [...ev.quaternion],
          mode: ev.mode,
        });
        emittedKey = key;
      }

      this.activeStates.set(meshObj, {
        matchedSocketId: ev.matchedSocketId,
        matchedSocketNode: matchedSock?.node ?? null,
        smoothedPos,
        smoothedQuat,
        lastEval: ev,
        lastEmittedKey: emittedKey,
        config: cfg,
        bottomOffset,
      });
    }

    this.syncPreviewRing(viewer, activePreviewSocket);
  }

  private syncPreviewRing(
    viewer: PluginViewer,
    socket: SnapSocketCandidate | null,
  ): void {
    if (!socket) {
      if (this.previewRingMesh) {
        this.previewRingMesh.visible = false;
      }
      return;
    }
    const radius = Math.max(0.03, socket.radius * 0.75);
    const rgba = parseHexColor(socket.highlightColor, [0.13, 0.77, 0.37, 0.65]);
    rgba[3] = 0.55;
    if (
      !this.previewRingMesh ||
      Math.abs(this.previewRingRadius - radius) > 1e-3
    ) {
      removeDynamicMesh(viewer, this.previewRingMesh);
      this.previewRingMesh = createDynamicMesh(
        viewer,
        buildSnapRingGeometry(radius, Math.max(0.004, radius * 0.08)),
        {
          name: '__xr_snap_ring__',
          color: rgba,
          roughness: 0.25,
          alphaBlend: true,
          pickable: false,
          worldSpace: true,
        },
      );
      this.previewRingRadius = radius;
    } else {
      reattachDynamicMesh(viewer, this.previewRingMesh);
      this.previewRingMesh.primitives[0].baseColor = [...rgba];
    }
    this.previewRingMesh.visible = true;
    const pulse = 1 + 0.07 * Math.sin(this.pulsePhase);
    setWorldTRS(
      viewer,
      this.previewRingMesh,
      socket.quaternion,
      socket.position,
      [pulse, pulse, pulse],
    );
  }

  /** Disposes preview ring GPU resources and clears active state. */
  dispose(viewer: PluginViewer | undefined): void {
    removeDynamicMesh(viewer, this.previewRingMesh);
    this.previewRingMesh = null;
    this.previewRingRadius = 0;
    this.activeStates.clear();
  }
}

const controllers = new WeakMap<object, XRMagneticSnapController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the `magnetic-snap` controller for `key`. */
export function getMagneticSnapController(
  key: object,
): XRMagneticSnapController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRMagneticSnapController();
    controllers.set(key, c);
  }
  return c;
}

/** `ThreeLivePlugin` providing socket, grid, surface, and angle snapping. */
export const magneticSnapPlugin: ThreeLivePlugin = {
  name: 'xr-live-magnetic-snap',
  // tslint:disable-next-line:no-any WebXR session init dictionary.
  onConfigureXRSessionInit(element: any, sessionInit: any): void {
    const def = resolveMagneticSnapDefaults(element);
    if (def.surface === 'none' || !sessionInit) return;
    const optional = new Set<string>(sessionInit.optionalFeatures ?? []);
    optional.add('plane-detection');
    sessionInit.optionalFeatures = [...optional];
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (
      !element ||
      typeof element.addEventListener !== 'function' ||
      listeners.has(element)
    ) {
      return;
    }
    const step = (): void => {
      const viewer: PluginViewer | undefined = element._view ?? element.viewer;
      if (viewer)
        getMagneticSnapController(element).update(viewer, 1 / 60, element);
    };
    const bound: Array<[string, EventListener]> = [
      ['xr-select-start', step],
      ['xr-select-end', step],
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
  onXRFrame(
    viewer: unknown,
    _session: unknown,
    frame: unknown,
    refSpace: unknown,
  ): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    const ctrl = getMagneticSnapController(host ?? v);
    ctrl.update(v, measureFrameDt(ctrl), host);
  },
  onUpdate(viewer: PluginViewer, dt: number): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getMagneticSnapController(host ?? viewer).update(viewer, dt, host);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.dispose(viewer);
  },
};
