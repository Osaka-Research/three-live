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
 * @fileoverview Spatial `head-follow` plugin for `<xr-live>`.
 *
 * Implements lazy head-follow HUD behavior (angular deadzone
 * plus a critically damped spring) and the `Orbit` satellite behavior:
 *
 * ```js
 * hud.userData.xr = {follow: {mode: 'head', distance: 1.2, deadzoneDeg: 20}};
 * moon.userData.xr = {orbit: {target: 'planet', radius: 0.4, speed: 0.6}};
 * ```
 *
 * String-valued `follow` traits (`'head'`, `'hand-left'`, `'hand-right'`) keep
 * the built-in eager spring in `XRTraitSystem`; object-valued `follow` traits
 * are owned by this plugin when it is registered.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  type LazyFollowOptions,
  type OrbitOptions,
  parseLazyFollow,
  parseOrbit,
} from '../../../three-live/src/xr-trait-schema';
import {extractPosition, extractQuaternion, extractScale, getMeshXRTraits, type XRPose6DoF} from '../xr-traits';
import {
  cacheXRFrame,
  clampNum,
  horizontalForward,
  isXRFrameFresh,
  meshWorldMatrix,
  type PluginViewer,
  type Quat,
  quatFromYaw,
  resolveHeadPose,
  rootMatrix,
  setWorldTRS,
  transformPoint,
  vAdd,
  vDot,
  vLen,
  vNorm,
  vSub,
  type Vec3,
} from './common';

/** Plugin name used for registration and for `XRTraitSystem` hand-off. */
export const HEAD_FOLLOW_PLUGIN_NAME = 'xr-live-head-follow';

export {parseLazyFollow, parseOrbit};
export type {LazyFollowOptions, OrbitOptions};

/** Per-axis state of a critically damped spring. */
export interface SpringState {
  position: Vec3;
  velocity: Vec3;
}

/**
 * Advances a critically damped spring toward `target` by `dt` seconds with
 * angular frequency `omega`, using the exact closed-form solution so the step
 * is unconditionally stable for any frame time.
 */
export function stepCriticallyDampedSpring(
  state: SpringState,
  target: readonly number[],
  omega: number,
  dt: number,
): void {
  const decay = Math.exp(-omega * dt);
  for (let a = 0; a < 3; a++) {
    const delta = state.position[a] - target[a];
    const temp = (state.velocity[a] + omega * delta) * dt;
    state.velocity[a] = (state.velocity[a] - omega * temp) * decay;
    state.position[a] = target[a] + (delta + temp) * decay;
  }
}

/** Computes the desired world position for a lazy follower. */
export function computeFollowTarget(
  anchor: XRPose6DoF,
  options: LazyFollowOptions,
): Vec3 {
  if (options.mode !== 'head') {
    return vAdd(anchor.position, [0, options.height, 0]);
  }
  const fwd = horizontalForward(anchor.quaternion);
  return [
    anchor.position[0] + fwd[0] * options.distance,
    anchor.position[1] + options.height,
    anchor.position[2] + fwd[2] * options.distance,
  ];
}

/**
 * Returns the horizontal angle (degrees) between the anchor's forward vector
 * and the direction from the anchor to `point`.
 */
export function angleFromForwardDeg(
  anchor: XRPose6DoF,
  point: readonly number[],
): number {
  const fwd = horizontalForward(anchor.quaternion);
  const to = vSub(point, anchor.position);
  to[1] = 0;
  if (vLen(to) < 1e-5) return 0;
  const dir = vNorm(to);
  return (Math.acos(Math.max(-1, Math.min(1, vDot(fwd, dir)))) * 180) / Math.PI;
}

/** Computes the orbit position at accumulated time `t` seconds. */
export function computeOrbitPosition(
  center: readonly number[],
  options: OrbitOptions,
  t: number,
): Vec3 {
  const theta = options.phase + options.speed * t;
  return [
    center[0] + Math.cos(theta) * options.radius,
    center[1] + options.height,
    center[2] + Math.sin(theta) * options.radius,
  ];
}

function yawTowards(from: readonly number[], to: readonly number[]): Quat {
  return quatFromYaw(Math.atan2(to[0] - from[0], to[2] - from[2]));
}

interface FollowState {
  spring: SpringState;
  following: boolean;
}

/** Hand poses keyed by handedness, as produced by `XRInputManager`. */
export type HandPoseMap = Partial<Record<'left' | 'right' | 'screen', XRPose6DoF>>;

/**
 * Steps lazy `follow` and `orbit` traits for a set of GPU mesh records.
 * Poses are world-space; when a `viewer` with a `modelRootMatrix` (AR
 * placement or turntable) is supplied, transforms are compensated so meshes
 * land at the requested world pose. State is keyed weakly per mesh.
 */
export class XRHeadFollowController {
  private readonly followState = new WeakMap<object, FollowState>();
  private readonly orbitTime = new WeakMap<object, number>();

  /** Forgets cached spring/orbit state for `mesh` (e.g. after a teleport). */
  reset(mesh: object): void {
    this.followState.delete(mesh);
    this.orbitTime.delete(mesh);
  }

  /** Returns whether `mesh` is currently catching up to its follow target. */
  isFollowing(mesh: object): boolean {
    return this.followState.get(mesh)?.following ?? false;
  }

  /**
   * Advances all followers and orbiters by `dt` seconds. Meshes for which
   * `isGrabbed(mesh)` returns true are skipped and their spring is re-seeded
   * from the current transform on release.
   */
  update(
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    meshes: readonly any[],
    headPose: XRPose6DoF,
    handPoses: HandPoseMap,
    dt: number,
    isGrabbed: (mesh: object) => boolean = () => false,
    viewer?: PluginViewer,
  ): void {
    const step = clampNum(dt, 0, 0.1, 1 / 60);
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    const byName = new Map<string, any>();
    for (const m of meshes) {
      if (m?.name && !byName.has(m.name)) byName.set(m.name, m);
    }
    for (const mesh of meshes) {
      if (!mesh?.transform || mesh.isPluginMesh) continue;
      const traits = getMeshXRTraits(mesh);
      if (!traits) continue;
      if (isGrabbed(mesh)) {
        this.followState.delete(mesh);
        continue;
      }
      const follow = parseLazyFollow(traits.follow);
      if (follow) {
        this.stepFollow(mesh, follow, headPose, handPoses, step, viewer);
        continue;
      }
      const orbit = parseOrbit(traits.orbit);
      if (orbit) this.stepOrbit(mesh, orbit, headPose, byName, step, viewer);
    }
  }

  private stepFollow(
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    mesh: any,
    options: LazyFollowOptions,
    headPose: XRPose6DoF,
    handPoses: HandPoseMap,
    dt: number,
    viewer?: PluginViewer,
  ): void {
    const anchor =
      options.mode === 'hand-left'
        ? handPoses.left
        : options.mode === 'hand-right'
          ? handPoses.right
          : headPose;
    if (!anchor) return;
    const world = meshWorldMatrix(viewer, mesh);
    const target = computeFollowTarget(anchor, options);
    let state = this.followState.get(mesh);
    if (!state) {
      const start = options.snapOnStart ? target : extractPosition(world);
      state = {spring: {position: [...start], velocity: [0, 0, 0]}, following: false};
      this.followState.set(mesh, state);
    }
    const err = vLen(vSub(state.spring.position, target));
    if (!state.following) {
      // Yaw is governed by the angular deadzone; distance/height drift (e.g.
      // the user walking) by a radial/vertical slack that ignores rotation.
      const angle = angleFromForwardDeg(anchor, state.spring.position);
      const rel = vSub(state.spring.position, anchor.position);
      const radialErr =
        options.mode === 'head' ? Math.abs(Math.hypot(rel[0], rel[2]) - options.distance) : err;
      const verticalErr = Math.abs(rel[1] - options.height);
      const slack = Math.max(0.05, options.distance * 0.35);
      if (angle > options.deadzoneDeg || radialErr > slack || verticalErr > slack) {
        state.following = true;
      }
    }
    if (state.following) {
      stepCriticallyDampedSpring(state.spring, target, options.stiffness, dt);
      if (vLen(vSub(state.spring.position, target)) < 0.01 && vLen(state.spring.velocity) < 0.01) {
        state.following = false;
      }
    }
    const quat = options.faceUser
      ? yawTowards(state.spring.position, headPose.position)
      : extractQuaternion(world);
    setWorldTRS(viewer, mesh, quat, state.spring.position, extractScale(world));
  }

  private stepOrbit(
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    mesh: any,
    options: OrbitOptions,
    headPose: XRPose6DoF,
    // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
    byName: ReadonlyMap<string, any>,
    dt: number,
    viewer?: PluginViewer,
  ): void {
    let center: Vec3;
    if (Array.isArray(options.target)) {
      // Literal targets are authored in scene (model) space.
      center = transformPoint(rootMatrix(viewer), options.target);
    } else if (options.target === 'head') {
      center = [...headPose.position];
    } else {
      const ref = byName.get(options.target);
      if (!ref || ref === mesh) return;
      center = extractPosition(meshWorldMatrix(viewer, ref));
    }
    const t = (this.orbitTime.get(mesh) ?? 0) + dt;
    this.orbitTime.set(mesh, t);
    const world = meshWorldMatrix(viewer, mesh);
    const pos = computeOrbitPosition(center, options, t);
    const quat = options.faceCenter ? yawTowards(pos, center) : extractQuaternion(world);
    setWorldTRS(viewer, mesh, quat, pos, extractScale(world));
  }
}

const controllers = new WeakMap<object, XRHeadFollowController>();

/** Returns (creating on first use) the follow controller bound to `viewer`. */
export function getHeadFollowController(viewer: object): XRHeadFollowController {
  let c = controllers.get(viewer);
  if (!c) {
    c = new XRHeadFollowController();
    controllers.set(viewer, c);
  }
  return c;
}

function stepViewer(viewer: PluginViewer, dt: number): void {
  if (!viewer || !Array.isArray(viewer.meshes)) return;
  const host = viewer.container;
  getHeadFollowController(viewer).update(
    viewer.meshes,
    resolveHeadPose(viewer),
    host?.inputManager?.getHandPoses?.() ?? {},
    dt,
    (mesh) => Boolean(host?.traitSystem?.isGrabbing?.(mesh)),
    viewer,
  );
}

/** `ThreeLivePlugin` that steps lazy `follow` and `orbit` traits every frame. */
export const headFollowPlugin: ThreeLivePlugin = {
  name: HEAD_FOLLOW_PLUGIN_NAME,
  onUpdate(viewer: PluginViewer, dt: number): void {
    // While presenting, onXRFrame drives the step with the headset pose.
    if (!isXRFrameFresh(viewer)) stepViewer(viewer, dt);
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    stepViewer(v, 1 / 72);
  },
};
