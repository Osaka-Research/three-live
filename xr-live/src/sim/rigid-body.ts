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
 */

/**
 * @fileoverview `rigid-body` plugin for `xr-live-sim`.
 *
 * Deterministic 60 Hz Sequential Impulse rigid-body solver for nodes with
 * `userData.xr.rigidBody` or rich `userData.xr.physics` (`'dynamic' | 'static' |
 * 'kinematic'` or `{ body, shape, mass, restitution, friction, linearDamping,
 * angularDamping, gravityScale, velocity, angularVelocity, lockRotation }`).
 *
 * Runs at priority 25 (after `character-controller` and `steering-agents`,
 * before `hit-zones` and `objectives`) so character-push impulses and trigger
 * zone occupancy resolve in the same 60 Hz tick.
 */

import type {
  PhysicsBodyOptions,
  PhysicsBodyShape,
} from '../../../three-live/src/xr-sim-schema';
import type {Vec3} from '../plugins/common';
import {
  bodyAABB,
  bodyCenter,
  pushCircleOutOfAABB,
  registerSimSystem,
  wrapAngle,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';

/** Vertical gravitational acceleration (m/s^2). */
export const RIGID_BODY_GRAVITY = -9.81;
/** Sequential impulse velocity + position solver iterations per 60 Hz step. */
export const RIGID_BODY_SOLVER_ITERS = 6;
/** Normal speed threshold below which restitution is suppressed (m/s). */
export const RIGID_BODY_RESTITUTION_SLOP = 0.25;
/** Minimum normal impact speed that emits an `xrcollision` event (m/s). */
export const RIGID_BODY_COLLISION_SPEED_MIN = 0.5;
/** Linear speed threshold for sleep counter (m/s). */
export const RIGID_BODY_SLEEP_LINEAR_EPS = 0.04;
/** Angular speed threshold for sleep counter (rad/s). */
export const RIGID_BODY_SLEEP_ANGULAR_EPS = 0.08;
/** Consecutive low-energy ticks (0.5 s at 60 Hz) before a body sleeps. */
export const RIGID_BODY_SLEEP_TICKS = 30;

interface BodyPhysicsState {
  initialized: boolean;
  angVel: Vec3;
  sleeping: boolean;
  sleepTicks: number;
}

interface RigidContact {
  a: SimBody;
  b: SimBody | null;
  normal: Vec3;
  depth: number;
  restitution: number;
  friction: number;
  invMassA: number;
  invMassB: number;
}

const STATE_KEY = 'rigid-body';

const STATIC_COLLIDABLE_FALLBACK: PhysicsBodyOptions = {
  body: 'static',
  shape: 'box',
  mass: 0,
  restitution: 0.25,
  friction: 0.6,
  linearDamping: 0,
  angularDamping: 0,
  gravityScale: 0,
  velocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  lockRotation: true,
};

function bodyStateOf(b: SimBody): BodyPhysicsState | undefined {
  return b.data[STATE_KEY] as BodyPhysicsState | undefined;
}

function physicsOptsOf(b: SimBody): PhysicsBodyOptions | null {
  if (b.traits.rigidBody) return b.traits.rigidBody;
  if (
    b.traits.collidable &&
    b !== null &&
    !b.traits.character &&
    !b.traits.agent
  ) {
    return STATIC_COLLIDABLE_FALLBACK;
  }
  return null;
}

function ensureBodyState(
  b: SimBody,
  opts: PhysicsBodyOptions,
): BodyPhysicsState {
  let bs = bodyStateOf(b);
  if (!bs || !bs.initialized) {
    b.vel = [...opts.velocity];
    bs = {
      initialized: true,
      angVel: [...opts.angularVelocity],
      sleeping: false,
      sleepTicks: 0,
    };
    b.data[STATE_KEY] = bs;
  }
  return bs;
}

/** Resolves `'auto'` collision shape from the body's AABB half-extents. */
export function resolveRigidBodyShape(
  b: SimBody,
  opts: PhysicsBodyOptions,
): Exclude<PhysicsBodyShape, 'auto'> {
  if (
    opts.shape === 'sphere' ||
    opts.shape === 'box' ||
    opts.shape === 'cylinder'
  ) {
    return opts.shape;
  }
  const [hx, hy, hz] = b.half;
  const maxH = Math.max(hx, hy, hz);
  const minH = Math.min(hx, hy, hz);
  if (maxH > 1e-4 && maxH - minH <= maxH * 0.05) return 'sphere';
  return 'box';
}

function sphereRadiusOf(b: SimBody): number {
  return Math.max(0.01, Math.max(b.half[0], b.half[1], b.half[2]));
}

function verticalHalfExtent(b: SimBody, opts: PhysicsBodyOptions): number {
  return resolveRigidBodyShape(b, opts) === 'sphere'
    ? sphereRadiusOf(b)
    : Math.max(0.01, b.half[1]);
}

function invMassOf(opts: PhysicsBodyOptions): number {
  return opts.body === 'dynamic' && opts.mass > 0 ? 1 / opts.mass : 0;
}

/** Returns true when a dynamic rigid body is currently in its sleep state. */
export function isRigidBodySleeping(_world: SimWorld, body: SimBody): boolean {
  return bodyStateOf(body)?.sleeping === true;
}

/**
 * Applies a world-space linear impulse (N*s) to a dynamic rigid body and wakes
 * it if sleeping. Returns `true` when the body accepted the impulse.
 */
export function applyRigidBodyImpulse(
  _world: SimWorld,
  body: SimBody,
  impulse: readonly number[],
): boolean {
  const opts = body.traits.rigidBody;
  if (
    !opts ||
    opts.body !== 'dynamic' ||
    body.hidden ||
    body.isTemplate ||
    !Array.isArray(impulse) ||
    impulse.length < 3 ||
    !Number.isFinite(impulse[0]) ||
    !Number.isFinite(impulse[1]) ||
    !Number.isFinite(impulse[2])
  ) {
    return false;
  }
  const bs = ensureBodyState(body, opts);
  bs.sleeping = false;
  bs.sleepTicks = 0;
  const invMass = invMassOf(opts);
  body.vel = [
    Math.max(-200, Math.min(200, body.vel[0] + impulse[0] * invMass)),
    Math.max(-200, Math.min(200, body.vel[1] + impulse[1] * invMass)),
    Math.max(-200, Math.min(200, body.vel[2] + impulse[2] * invMass)),
  ];
  return true;
}

function collidePair(
  a: SimBody,
  optsA: PhysicsBodyOptions,
  b: SimBody,
  optsB: PhysicsBodyOptions,
): {normal: Vec3; depth: number} | null {
  const shapeA = resolveRigidBodyShape(a, optsA);
  const shapeB = resolveRigidBodyShape(b, optsB);
  const ca = bodyCenter(a);
  const cb = bodyCenter(b);
  if (shapeA === 'sphere' && shapeB === 'sphere') {
    const rSum = sphereRadiusOf(a) + sphereRadiusOf(b);
    const dx = cb[0] - ca[0];
    const dy = cb[1] - ca[1];
    const dz = cb[2] - ca[2];
    const dist = Math.hypot(dx, dy, dz);
    if (dist >= rSum) return null;
    const normal: Vec3 =
      dist > 1e-9 ? [dx / dist, dy / dist, dz / dist] : [0, 1, 0];
    return {normal, depth: rSum - dist};
  }
  const ha: Vec3 =
    shapeA === 'sphere'
      ? [sphereRadiusOf(a), sphereRadiusOf(a), sphereRadiusOf(a)]
      : [
          Math.max(0.01, a.half[0]),
          Math.max(0.01, a.half[1]),
          Math.max(0.01, a.half[2]),
        ];
  const hb: Vec3 =
    shapeB === 'sphere'
      ? [sphereRadiusOf(b), sphereRadiusOf(b), sphereRadiusOf(b)]
      : [
          Math.max(0.01, b.half[0]),
          Math.max(0.01, b.half[1]),
          Math.max(0.01, b.half[2]),
        ];
  const dx = cb[0] - ca[0];
  const dy = cb[1] - ca[1];
  const dz = cb[2] - ca[2];
  const ox = ha[0] + hb[0] - Math.abs(dx);
  const oy = ha[1] + hb[1] - Math.abs(dy);
  const oz = ha[2] + hb[2] - Math.abs(dz);
  if (ox <= 0 || oy <= 0 || oz <= 0) return null;
  if (oy <= ox && oy <= oz) {
    return {normal: [0, dy >= 0 ? 1 : -1, 0], depth: oy};
  }
  if (ox <= oz) {
    return {normal: [dx >= 0 ? 1 : -1, 0, 0], depth: ox};
  }
  return {normal: [0, 0, dz >= 0 ? 1 : -1], depth: oz};
}

function stepCharacterPush(world: SimWorld): void {
  const ch = world.character;
  const chOpts = ch?.traits.character;
  if (!ch || !chOpts || ch.hidden) return;
  const chFoot = ch.pos[1] + (ch.half[1] > 0 ? ch.center[1] - ch.half[1] : 0);
  const chTop = chFoot + chOpts.height;
  for (const b of world.bodies) {
    const opts = b.traits.rigidBody;
    if (
      !opts ||
      opts.body !== 'dynamic' ||
      b.hidden ||
      b.isTemplate ||
      b === ch
    ) {
      continue;
    }
    const [bMin, bMax] = bodyAABB(b);
    if (bMax[1] <= chFoot + 0.05 || bMin[1] >= chTop) continue;
    const pushed = pushCircleOutOfAABB(ch.pos, chOpts.radius, bMin, bMax);
    if (!pushed) continue;
    const dx = ch.pos[0] - pushed[0];
    const dz = ch.pos[2] - pushed[1];
    const dLen = Math.hypot(dx, dz);
    if (dLen <= 1e-6) continue;
    const bs = ensureBodyState(b, opts);
    bs.sleeping = false;
    bs.sleepTicks = 0;
    b.pos = [b.pos[0] + dx, b.pos[1], b.pos[2] + dz];
    const nx = dx / dLen;
    const nz = dz / dLen;
    const chSpeed = Math.hypot(ch.vel[0], ch.vel[2]);
    const pushSpeed = Math.max(chSpeed, 1.5) / Math.max(0.5, opts.mass * 0.5);
    const vn = b.vel[0] * nx + b.vel[2] * nz;
    if (vn < pushSpeed) {
      b.vel = [
        b.vel[0] + (pushSpeed - vn) * nx,
        b.vel[1],
        b.vel[2] + (pushSpeed - vn) * nz,
      ];
    }
  }
}

/** Steps all rigid bodies in `world` by `dt` seconds. */
export function stepRigidBodies(world: SimWorld, dt: number): void {
  const off = world.attr('rigid-body');
  if (off === 'false' || off === 'none') return;
  const hasDynamicOrKinematic = world.bodies.some(
    (b) =>
      !b.hidden &&
      !b.isTemplate &&
      b.traits.rigidBody &&
      (b.traits.rigidBody.body === 'dynamic' ||
        b.traits.rigidBody.body === 'kinematic'),
  );
  if (!hasDynamicOrKinematic) return;

  const groundY = Math.min(0, world.floorY);

  // 1. Symplectic Euler velocity & position integration.
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate) continue;
    const opts = b.traits.rigidBody;
    if (!opts) continue;
    const bs = ensureBodyState(b, opts);
    if (opts.body === 'kinematic') {
      b.pos = [
        b.pos[0] + b.vel[0] * dt,
        b.pos[1] + b.vel[1] * dt,
        b.pos[2] + b.vel[2] * dt,
      ];
      if (!opts.lockRotation && bs.angVel[1] !== 0) {
        b.yaw = wrapAngle(b.yaw + bs.angVel[1] * dt);
      }
      continue;
    }
    if (opts.body !== 'dynamic' || bs.sleeping) continue;
    const dampL = Math.max(0, 1 - opts.linearDamping * dt);
    const dampA = Math.max(0, 1 - opts.angularDamping * dt);
    const vx = b.vel[0] * dampL;
    const vy = (b.vel[1] + RIGID_BODY_GRAVITY * opts.gravityScale * dt) * dampL;
    const vz = b.vel[2] * dampL;
    b.vel = [
      Math.max(-200, Math.min(200, vx)),
      Math.max(-200, Math.min(200, vy)),
      Math.max(-200, Math.min(200, vz)),
    ];
    bs.angVel = [
      bs.angVel[0] * dampA,
      bs.angVel[1] * dampA,
      bs.angVel[2] * dampA,
    ];
    b.pos = [
      b.pos[0] + b.vel[0] * dt,
      b.pos[1] + b.vel[1] * dt,
      b.pos[2] + b.vel[2] * dt,
    ];
    if (!opts.lockRotation && bs.angVel[1] !== 0) {
      b.yaw = wrapAngle(b.yaw + bs.angVel[1] * dt);
    }
  }

  // 2. Character push coupling.
  stepCharacterPush(world);

  // 3. Narrowphase contact detection (ground plane + pairwise bodies).
  const contacts: RigidContact[] = [];
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate) continue;
    const opts = b.traits.rigidBody;
    if (!opts || opts.body !== 'dynamic') continue;
    const hy = verticalHalfExtent(b, opts);
    const bottomY = b.pos[1] + b.center[1] - hy;
    if (bottomY < groundY) {
      contacts.push({
        a: b,
        b: null,
        normal: [0, -1, 0],
        depth: groundY - bottomY,
        restitution: opts.restitution,
        friction: opts.friction,
        invMassA: invMassOf(opts),
        invMassB: 0,
      });
    }
  }

  const nBodies = world.bodies.length;
  for (let i = 0; i < nBodies; i++) {
    const a = world.bodies[i];
    if (a.hidden || a.isTemplate || a === world.character) continue;
    const optsA = physicsOptsOf(a);
    if (!optsA) continue;
    const invA = invMassOf(optsA);
    const bsA = ensureBodyState(a, optsA);
    for (let j = i + 1; j < nBodies; j++) {
      const b = world.bodies[j];
      if (b.hidden || b.isTemplate || b === world.character) continue;
      const optsB = physicsOptsOf(b);
      if (!optsB) continue;
      const invB = invMassOf(optsB);
      if (invA === 0 && invB === 0) continue;
      const bsB = ensureBodyState(b, optsB);
      if (bsA.sleeping && bsB.sleeping) continue;
      const hit = collidePair(a, optsA, b, optsB);
      if (!hit) continue;
      const rvx = b.vel[0] - a.vel[0];
      const rvy = b.vel[1] - a.vel[1];
      const rvz = b.vel[2] - a.vel[2];
      const relSpeed = Math.hypot(rvx, rvy, rvz);
      if (relSpeed > RIGID_BODY_SLEEP_LINEAR_EPS) {
        if (invA > 0) {
          bsA.sleeping = false;
          bsA.sleepTicks = 0;
        }
        if (invB > 0) {
          bsB.sleeping = false;
          bsB.sleepTicks = 0;
        }
      }
      contacts.push({
        a,
        b,
        normal: hit.normal,
        depth: hit.depth,
        restitution: Math.max(optsA.restitution, optsB.restitution),
        friction: Math.sqrt(optsA.friction * optsB.friction),
        invMassA: invA,
        invMassB: invB,
      });
    }
  }

  // Emit collision events for high-speed impacts before velocity resolution.
  for (const c of contacts) {
    const vxB = c.b ? c.b.vel[0] : 0;
    const vyB = c.b ? c.b.vel[1] : 0;
    const vzB = c.b ? c.b.vel[2] : 0;
    const vn =
      (vxB - c.a.vel[0]) * c.normal[0] +
      (vyB - c.a.vel[1]) * c.normal[1] +
      (vzB - c.a.vel[2]) * c.normal[2];
    const impactSpeed = -vn;
    if (impactSpeed >= RIGID_BODY_COLLISION_SPEED_MIN) {
      world.emit(
        'xrcollision',
        {
          nodeId: c.a.name,
          otherId: c.b ? c.b.name : 'ground',
          speed: Math.round(impactSpeed * 1000) / 1000,
          normal: [-c.normal[0], -c.normal[1], -c.normal[2]],
        },
        {body: c.a, other: c.b ?? undefined},
      );
    }
  }

  // 4. Sequential Impulse velocity solver (6 iterations).
  for (let iter = 0; iter < RIGID_BODY_SOLVER_ITERS; iter++) {
    for (const c of contacts) {
      const invSum = c.invMassA + c.invMassB;
      if (invSum <= 0) continue;
      const vxB = c.b ? c.b.vel[0] : 0;
      const vyB = c.b ? c.b.vel[1] : 0;
      const vzB = c.b ? c.b.vel[2] : 0;
      const rvx = vxB - c.a.vel[0];
      const rvy = vyB - c.a.vel[1];
      const rvz = vzB - c.a.vel[2];
      const vn = rvx * c.normal[0] + rvy * c.normal[1] + rvz * c.normal[2];
      if (vn >= 0) continue;
      const e =
        iter === 0 && -vn > RIGID_BODY_RESTITUTION_SLOP ? c.restitution : 0;
      const j = (-(1 + e) * vn) / invSum;
      const ix = c.normal[0] * j;
      const iy = c.normal[1] * j;
      const iz = c.normal[2] * j;
      if (c.invMassA > 0) {
        c.a.vel = [
          c.a.vel[0] - ix * c.invMassA,
          c.a.vel[1] - iy * c.invMassA,
          c.a.vel[2] - iz * c.invMassA,
        ];
      }
      if (c.b && c.invMassB > 0) {
        c.b.vel = [
          c.b.vel[0] + ix * c.invMassB,
          c.b.vel[1] + iy * c.invMassB,
          c.b.vel[2] + iz * c.invMassB,
        ];
      }
      // Tangential Coulomb friction impulse.
      const tvx = rvx - vn * c.normal[0];
      const tvy = rvy - vn * c.normal[1];
      const tvz = rvz - vn * c.normal[2];
      const tLen = Math.hypot(tvx, tvy, tvz);
      if (tLen > 1e-7) {
        const tx = tvx / tLen;
        const ty = tvy / tLen;
        const tz = tvz / tLen;
        const maxJt = j * c.friction;
        const jt = Math.max(-maxJt, Math.min(maxJt, -tLen / invSum));
        if (c.invMassA > 0) {
          c.a.vel = [
            c.a.vel[0] - tx * jt * c.invMassA,
            c.a.vel[1] - ty * jt * c.invMassA,
            c.a.vel[2] - tz * jt * c.invMassA,
          ];
        }
        if (c.b && c.invMassB > 0) {
          c.b.vel = [
            c.b.vel[0] + tx * jt * c.invMassB,
            c.b.vel[1] + ty * jt * c.invMassB,
            c.b.vel[2] + tz * jt * c.invMassB,
          ];
        }
      }
    }
  }

  // 5. Split-impulse positional projection (multi-pass for zero-sag stacking).
  for (let pass = 0; pass < RIGID_BODY_SOLVER_ITERS; pass++) {
    for (const b of world.bodies) {
      if (b.hidden || b.isTemplate) continue;
      const opts = b.traits.rigidBody;
      if (!opts || opts.body !== 'dynamic') continue;
      const hy = verticalHalfExtent(b, opts);
      const bottomY = b.pos[1] + b.center[1] - hy;
      if (bottomY < groundY) {
        b.pos = [b.pos[0], b.pos[1] + (groundY - bottomY), b.pos[2]];
        if (Math.abs(b.vel[1]) < 1e-4) b.vel = [b.vel[0], 0, b.vel[2]];
      }
    }
    for (let i = 0; i < nBodies; i++) {
      const a = world.bodies[i];
      if (a.hidden || a.isTemplate || a === world.character) continue;
      const optsA = physicsOptsOf(a);
      if (!optsA) continue;
      const invA = invMassOf(optsA);
      const bsA = bodyStateOf(a);
      for (let j = i + 1; j < nBodies; j++) {
        const b = world.bodies[j];
        if (b.hidden || b.isTemplate || b === world.character) continue;
        const optsB = physicsOptsOf(b);
        if (!optsB) continue;
        const invB = invMassOf(optsB);
        const invSum = invA + invB;
        if (invSum <= 0) continue;
        const bsB = bodyStateOf(b);
        if (bsA?.sleeping && bsB?.sleeping) continue;
        const hit = collidePair(a, optsA, b, optsB);
        if (!hit || hit.depth <= 1e-5) continue;
        const corr = hit.depth / invSum;
        if (invA > 0) {
          a.pos = [
            a.pos[0] - hit.normal[0] * corr * invA,
            a.pos[1] - hit.normal[1] * corr * invA,
            a.pos[2] - hit.normal[2] * corr * invA,
          ];
        }
        if (invB > 0) {
          b.pos = [
            b.pos[0] + hit.normal[0] * corr * invB,
            b.pos[1] + hit.normal[1] * corr * invB,
            b.pos[2] + hit.normal[2] * corr * invB,
          ];
        }
      }
    }
  }

  // Final ground clamp after pair projection.
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate) continue;
    const opts = b.traits.rigidBody;
    if (!opts || opts.body !== 'dynamic') continue;
    const hy = verticalHalfExtent(b, opts);
    const bottomY = b.pos[1] + b.center[1] - hy;
    if (bottomY < groundY) {
      b.pos = [b.pos[0], b.pos[1] + (groundY - bottomY), b.pos[2]];
      if (b.vel[1] < 0) b.vel = [b.vel[0], 0, b.vel[2]];
    }
  }

  // 6. Sleep threshold counter.
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate) continue;
    const opts = b.traits.rigidBody;
    if (!opts || opts.body !== 'dynamic') continue;
    const bs = ensureBodyState(b, opts);
    if (bs.sleeping) continue;
    const linSpeed = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
    const angSpeed = Math.hypot(bs.angVel[0], bs.angVel[1], bs.angVel[2]);
    if (
      linSpeed < RIGID_BODY_SLEEP_LINEAR_EPS &&
      angSpeed < RIGID_BODY_SLEEP_ANGULAR_EPS
    ) {
      bs.sleepTicks++;
      if (bs.sleepTicks >= RIGID_BODY_SLEEP_TICKS) {
        bs.sleeping = true;
        b.vel = [0, 0, 0];
        bs.angVel = [0, 0, 0];
        world.emit(
          'xrsleep',
          {nodeId: b.name, position: [...b.pos]},
          {body: b},
        );
      }
    } else {
      bs.sleepTicks = 0;
    }
  }
}

/** `SimSystem` driving `rigid-body` dynamics. */
export const rigidBodySystem: SimSystem = {
  name: 'rigid-body',
  priority: 25,
  step(world: SimWorld, dt: number): void {
    stepRigidBodies(world, dt);
  },
  reset(world: SimWorld): void {
    for (const b of world.bodies) delete b.data[STATE_KEY];
  },
  dispose(world: SimWorld): void {
    for (const b of world.bodies) delete b.data[STATE_KEY];
  },
};

registerSimSystem(rigidBodySystem);
