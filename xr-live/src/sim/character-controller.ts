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
 * @fileoverview `character-controller` plugin for `xr-live-sim`.
 *
 * Moves the first node with a `character` trait from keyboard (WASD / arrows,
 * Space to jump, Shift to sprint), gamepad, or the touch joystick. Movement is
 * relative to the camera heading; the capsule slides along `collidable` nodes,
 * stands on their tops, and falls back to its spawn height as the floor. The
 * orbit camera follows the character unless `cameraMode` is `'fixed'` or an
 * immersive session is presenting. Animation clips switch between `idle`,
 * `walk`, `run`, and `jump` through the viewer's clip player.
 *
 * Host attributes: `character-controller` (`third-person` | `first-person` |
 * `top-down` | `fixed-camera` | `none`), `character-speed`, `character-jump`,
 * `touch-joystick` (`auto` | `always` | `none`).
 */

import type {
  CharacterCameraMode,
  CharacterClipState,
  CharacterOptions,
} from '../../../three-live/src/xr-sim-schema';
import {clampNum} from '../../../three-live/src/xr-trait-schema';
import type {Vec3} from '../plugins/common';
import {
  bodyAABB,
  pushCircleOutOfAABB,
  registerSimSystem,
  turnToward,
  yawFromDir,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';
import {
  disposeSimInput,
  ensureSimInput,
  isTouchDevice,
  updateSimInput,
} from './input';

/** Horizontal velocity smoothing rate (1/s). */
export const CHARACTER_ACCEL = 12;
/** Maximum character turn rate (rad/s). */
export const CHARACTER_TURN_SPEED = 12;
/** Ledge height the character steps onto without jumping (m). */
export const CHARACTER_STEP_HEIGHT = 0.05;

/** Effective controller options after host attribute overrides. */
export interface ResolvedCharacterOptions extends CharacterOptions {
  readonly touchJoystick: boolean;
}

interface CharacterState {
  body: SimBody;
  grounded: boolean;
  vy: number;
  clip: CharacterClipState | null;
  cameraMode: CharacterCameraMode | null;
}

const STATE_KEY = 'character-controller';

/** Returns null when the host disables the controller. */
export function resolveCharacterOptions(
  world: SimWorld,
  base: CharacterOptions,
): ResolvedCharacterOptions | null {
  const mode = world.attr('character-controller')?.trim().toLowerCase();
  if (mode === 'none' || mode === 'false') return null;
  const cameraMode: CharacterCameraMode =
    mode === 'fixed-camera' || mode === 'fixed'
      ? 'fixed'
      : mode === 'first-person' ||
          mode === 'top-down' ||
          mode === 'third-person'
        ? mode
        : base.cameraMode;
  const joy = world.attr('touch-joystick')?.trim().toLowerCase() ?? 'auto';
  return {
    ...base,
    cameraMode,
    speed: clampNum(world.numAttr('character-speed'), 0.1, 20, base.speed),
    jumpVelocity: clampNum(
      world.numAttr('character-jump'),
      0,
      30,
      base.jumpVelocity,
    ),
    touchJoystick: joy === 'always' || (joy !== 'none' && isTouchDevice()),
  };
}

/** Picks the animation state for a horizontal speed and grounded flag. */
export function characterClipState(
  speed: number,
  maxSpeed: number,
  grounded: boolean,
): CharacterClipState {
  if (!grounded) return 'jump';
  if (speed < 0.05) return 'idle';
  return speed < 0.7 * maxSpeed ? 'walk' : 'run';
}

function feetOffset(b: SimBody): number {
  return b.half[1] > 0 ? b.center[1] - b.half[1] : 0;
}

function playClip(world: SimWorld, name: string | undefined): void {
  // tslint:disable-next-line:no-any ThreeView clip player.
  const v = world.viewer as any;
  if (!name) return;
  const available: string[] =
    typeof v.getAvailableAnimations === 'function'
      ? v.getAvailableAnimations()
      : [];
  if (!available.includes(name)) return;
  v.setAnimationName?.(name);
  v.playAnimation?.(name);
}

/**
 * Camera framing for the controlled character, shared with the Android and
 * iOS hosts: the orbit target to follow every frame, plus the polar angle
 * (`phiDeg`, 0 = straight down) and distance to apply when `mode` changes.
 */
export interface CharacterCameraRig {
  readonly mode: 'third-person' | 'first-person' | 'top-down';
  readonly target: Vec3;
  readonly phiDeg: number;
  readonly distance: number;
}

/**
 * Returns the camera rig for the controlled character, or null when there is
 * none, it is hidden, the camera is `fixed`, or an immersive session drives
 * the camera.
 */
export function characterCameraRig(world: SimWorld): CharacterCameraRig | null {
  const st = world.state.get(STATE_KEY) as CharacterState | undefined;
  if (!st || st.body.hidden || world.xrActive) return null;
  const opts = resolveCharacterOptions(world, st.body.traits.character!);
  if (!opts || opts.cameraMode === 'fixed') return null;
  const b = st.body;
  const feet = b.pos[1] + feetOffset(b);
  const mode = opts.cameraMode;
  const fp = mode === 'first-person';
  const target: Vec3 = [
    b.pos[0],
    feet + opts.height * (fp ? 0.9 : 0.6),
    b.pos[2],
  ];
  if (fp) return {mode, target, phiDeg: 90, distance: 0.05};
  if (mode === 'top-down') {
    return {
      mode,
      target,
      phiDeg: 1,
      distance: Math.hypot(opts.cameraDistance, opts.cameraHeight),
    };
  }
  const h = Math.max(0.01, opts.cameraHeight);
  return {
    mode,
    target,
    phiDeg: (Math.atan2(opts.cameraDistance, h) * 180) / Math.PI,
    distance: Math.hypot(opts.cameraDistance, h),
  };
}

function updateCamera(
  world: SimWorld,
  st: CharacterState,
  opts: ResolvedCharacterOptions,
): void {
  // The first-person camera sits inside the character; hide its meshes.
  st.body.data['viewHidden'] =
    opts.cameraMode === 'first-person' && !world.xrActive;
  const rig = characterCameraRig(world);
  if (!rig) return;
  // tslint:disable-next-line:no-any ThreeView camera internals.
  const v = world.viewer as any;
  // Assigned directly: `setTarget()` re-enters `update()`.
  v.customTarget = [...rig.target];
  if (st.cameraMode === rig.mode) return;
  st.cameraMode = rig.mode;
  v.setAutoRotate?.(false);
  v.setCamera?.(undefined, rig.phiDeg, rig.distance);
}

/**
 * Fallback floor height for a character: the scene's lowest point when the
 * scene has `collidable` platforms (so the character can fall off them), else
 * its spawn height.
 */
export function characterFloor(world: SimWorld, b: SimBody): number {
  const platforms = world.bodies.some(
    (o) =>
      o !== b &&
      (o.traits.collidable || o.traits.rigidBody?.body === 'static') &&
      !o.isTemplate,
  );
  const spawnFeet = b.initPos[1] + feetOffset(b);
  return platforms ? Math.min(world.floorY, spawnFeet) : spawnFeet;
}

/**
 * Advances one character by `dt`. Exposed for tests and native-parity
 * fixtures; `move` is the camera-relative input already rotated into the
 * scene's XZ plane (length at most 1).
 */
export function stepCharacter(
  world: SimWorld,
  st: CharacterState,
  opts: CharacterOptions,
  move: readonly [number, number],
  sprint: boolean,
  jump: boolean,
  dt: number,
): void {
  const b = st.body;
  const len = Math.min(1, Math.hypot(move[0], move[1]));
  const target = opts.speed * (sprint ? opts.runMultiplier : 1) * len;
  const dir = len > 1e-6 ? [move[0] / len, move[1] / len] : [0, 0];
  const k = Math.min(1, dt * CHARACTER_ACCEL);
  b.vel[0] += (dir[0] * target - b.vel[0]) * k;
  b.vel[2] += (dir[1] * target - b.vel[2]) * k;
  if (len > 0.05) {
    b.yaw = turnToward(
      b.yaw,
      yawFromDir([dir[0], 0, dir[1]]),
      CHARACTER_TURN_SPEED * dt,
    );
  }
  if (jump && st.grounded && opts.jumpVelocity > 0) {
    st.vy = opts.jumpVelocity;
    st.grounded = false;
    world.emit(
      'characterjump',
      {nodeId: b.name, position: [...b.pos]},
      {body: b},
    );
  }
  st.vy -= opts.gravity * dt;
  const next: Vec3 = [
    b.pos[0] + b.vel[0] * dt,
    b.pos[1] + st.vy * dt,
    b.pos[2] + b.vel[2] * dt,
  ];
  const foot = feetOffset(b);
  let feet = next[1] + foot;
  let ground = characterFloor(world, b);
  for (const o of world.bodies) {
    if (
      o === b ||
      o.hidden ||
      o.isTemplate ||
      (!o.traits.collidable && o.traits.rigidBody?.body !== 'static')
    ) {
      continue;
    }
    const [min, max] = bodyAABB(o);
    const top = max[1];
    // Tops at or below the feet (plus a small step) are floors, not walls.
    if (top <= feet + CHARACTER_STEP_HEIGHT + Math.max(0, -st.vy * dt)) {
      const cx = Math.max(min[0], Math.min(max[0], next[0]));
      const cz = Math.max(min[2], Math.min(max[2], next[2]));
      if (Math.hypot(next[0] - cx, next[2] - cz) < opts.radius * 0.7) {
        ground = Math.max(ground, top);
      }
      continue;
    }
    if (min[1] >= feet + opts.height) continue;
    const pushed = pushCircleOutOfAABB(next, opts.radius, min, max);
    if (pushed) {
      next[0] = pushed[0];
      next[2] = pushed[1];
    }
  }
  if (feet <= ground) {
    if (!st.grounded && st.vy < 0) {
      world.emit(
        'characterland',
        {
          nodeId: b.name,
          position: [next[0], ground - foot, next[2]],
          fallSpeed: Math.round(-st.vy * 1000) / 1000,
        },
        {body: b},
      );
    }
    feet = ground;
    st.vy = 0;
    st.grounded = true;
  } else if (feet > ground + 0.01) {
    st.grounded = false;
  }
  b.pos = [next[0], feet - foot, next[2]];
}

/** `SimSystem` driving the controlled character. */
export const characterControllerSystem: SimSystem = {
  name: 'character-controller',
  priority: 10,
  step(world: SimWorld, dt: number): void {
    let st = world.state.get(STATE_KEY) as CharacterState | undefined;
    if (!st || !world.bodies.includes(st.body)) {
      const body = world
        .active()
        .find((b) => b.traits.character && b.spawnedFrom === undefined);
      world.character = null;
      if (!body) return;
      st = {body, grounded: true, vy: 0, clip: null, cameraMode: null};
      world.state.set(STATE_KEY, st);
    }
    const opts = resolveCharacterOptions(world, st.body.traits.character!);
    if (!opts || st.body.hidden) {
      world.character = opts ? st.body : null;
      return;
    }
    world.character = st.body;
    const fireOn = /^(|projectile|hitscan)$/.test(
      world.attr('hit-zones') ?? 'off',
    );
    ensureSimInput(world, opts.touchJoystick, opts.touchJoystick && fireOn);
    updateSimInput(world);
    const fwd = world.cameraForwardXZ();
    const right = [-fwd[2], fwd[0]];
    const {x, z} = world.input;
    const move: [number, number] = [
      right[0] * x + fwd[0] * z,
      right[1] * x + fwd[2] * z,
    ];
    const jump = world.input.jumpQueued;
    world.input.jumpQueued = false;
    stepCharacter(world, st, opts, move, world.input.sprint, jump, dt);
    const speed = Math.hypot(st.body.vel[0], st.body.vel[2]);
    const clip = characterClipState(
      speed,
      opts.speed * opts.runMultiplier,
      st.grounded,
    );
    if (clip !== st.clip) {
      st.clip = clip;
      playClip(world, opts.clips[clip]);
    }
  },
  sync(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as CharacterState | undefined;
    if (!st || st.body.hidden) return;
    const opts = resolveCharacterOptions(world, st.body.traits.character!);
    if (opts) updateCamera(world, st, opts);
  },
  reset(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as CharacterState | undefined;
    if (st) {
      st.grounded = true;
      st.vy = 0;
      st.clip = null;
    }
  },
  dispose(world: SimWorld): void {
    disposeSimInput(world);
    world.state.delete(STATE_KEY);
    world.character = null;
  },
};

registerSimSystem(characterControllerSystem);
