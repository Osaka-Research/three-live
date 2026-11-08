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
  JointOptions,
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
const JOINT_STATE_KEY = 'joint';

interface JointRuntimeState {
  initialized: boolean;
  targetLocalAnchor: Vec3;
  worldAnchor: Vec3;
  restLen: number;
  angle: number;
  omega: number;
  slidePos: number;
  slideVel: number;
  omegaVec: Vec3;
}

type Quat4 = [number, number, number, number];

function quatMul4(a: Quat4, b: Quat4): Quat4 {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function quatNormalize4(q: Quat4): Quat4 {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  return len > 1e-9 ? [q[0] / len, q[1] / len, q[2] / len, q[3] / len] : [0, 0, 0, 1];
}

function quatFromAxisAngle4(u: readonly number[], rad: number): Quat4 {
  const half = rad * 0.5;
  const s = Math.sin(half);
  return [u[0] * s, u[1] * s, u[2] * s, Math.cos(half)];
}

function quatRotateVec(q: Quat4, v: readonly number[]): Vec3 {
  const tx = 2 * (q[1] * v[2] - q[2] * v[1]);
  const ty = 2 * (q[2] * v[0] - q[0] * v[2]);
  const tz = 2 * (q[0] * v[1] - q[1] * v[0]);
  return [
    v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
    v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
    v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
  ];
}

function bodyQuat(b: SimBody): Quat4 {
  const qYaw: Quat4 = [0, Math.sin(b.yaw * 0.5), 0, Math.cos(b.yaw * 0.5)];
  const r = b.rot;
  if (r[0] === 0 && r[1] === 0 && r[2] === 0 && r[3] === 1) return qYaw;
  return quatMul4(r, qYaw);
}

function cross3(a: readonly number[], b: readonly number[]): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

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
  const hasJointOnly = !opts && body.traits.joint != null;
  if (
    (!hasJointOnly && (!opts || opts.body !== 'dynamic')) ||
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
  let invMass = 1;
  if (opts) {
    const bs = ensureBodyState(body, opts);
    bs.sleeping = false;
    bs.sleepTicks = 0;
    invMass = invMassOf(opts);
  }
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

/** Steps all mechanical joints (`hinge`, `slider`, `spring`, `ball`) in `world`. */
function stepJoints(world: SimWorld, dt: number): void {
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate) continue;
    const jt: JointOptions | undefined = b.traits.joint;
    if (!jt) continue;

    const tb =
      jt.target !== ''
        ? (world.bodies.find(
            (o) => !o.hidden && !o.isTemplate && o !== b && o.name === jt.target,
          ) ?? null)
        : null;

    let js = b.data[JOINT_STATE_KEY] as JointRuntimeState | undefined;
    if (!js || !js.initialized) {
      const pivot0: Vec3 = [
        b.initPos[0] + jt.anchor[0],
        b.initPos[1] + jt.anchor[1],
        b.initPos[2] + jt.anchor[2],
      ];
      let targetLocalAnchor: Vec3 = [0, 0, 0];
      let d0 = 0;
      if (tb) {
        if (jt.type === 'spring') {
          d0 = Math.hypot(
            pivot0[0] - tb.initPos[0],
            pivot0[1] - tb.initPos[1],
            pivot0[2] - tb.initPos[2],
          );
        } else {
          targetLocalAnchor = [
            pivot0[0] - tb.initPos[0],
            pivot0[1] - tb.initPos[1],
            pivot0[2] - tb.initPos[2],
          ];
        }
      } else if (jt.type === 'spring') {
        d0 = Math.hypot(jt.anchor[0], jt.anchor[1], jt.anchor[2]);
      }
      js = {
        initialized: true,
        targetLocalAnchor,
        worldAnchor: pivot0,
        restLen: jt.restLength > 0 ? jt.restLength : d0,
        angle: 0,
        omega: 0,
        slidePos: 0,
        slideVel: 0,
        omegaVec: [0, 0, 0],
      };
      b.data[JOINT_STATE_KEY] = js;
    }

    const rbOpts = b.traits.rigidBody;
    const hasDynRb = rbOpts?.body === 'dynamic';
    const mass = hasDynRb && rbOpts.mass > 0 ? rbOpts.mass : 1;
    const gScale = rbOpts ? (hasDynRb ? rbOpts.gravityScale : 0) : 1;

    let worldPivot: Vec3 = js.worldAnchor;
    let targetVel: Vec3 = [0, 0, 0];
    if (tb) {
      const off = quatRotateVec(bodyQuat(tb), js.targetLocalAnchor);
      worldPivot = [tb.pos[0] + off[0], tb.pos[1] + off[1], tb.pos[2] + off[2]];
      targetVel = tb.vel;
    }

    if (jt.type === 'hinge') {
      const u = jt.axis;
      const r0: Vec3 = [-jt.anchor[0], -jt.anchor[1], -jt.anchor[2]];
      const qPrev = quatFromAxisAngle4(u, js.angle);
      const rPrev = quatRotateVec(qPrev, r0);
      const uDotR = dot3(u, rPrev);
      const rPerp: Vec3 = [
        rPrev[0] - u[0] * uDotR,
        rPrev[1] - u[1] * uDotR,
        rPrev[2] - u[2] * uDotR,
      ];
      const rPerp2 = dot3(rPerp, rPerp);
      const inertia = Math.max(0.05, mass * Math.max(rPerp2, 0.25));
      const wxRPrev = cross3(u, rPrev);
      const dv: Vec3 = [
        b.vel[0] - (targetVel[0] + wxRPrev[0] * js.omega),
        b.vel[1] - (targetVel[1] + wxRPrev[1] * js.omega),
        b.vel[2] - (targetVel[2] + wxRPrev[2] * js.omega),
      ];
      let omega = js.omega;
      if (rPerp2 > 1e-6) {
        omega += dot3(cross3(rPrev, dv), u) / rPerp2;
      }
      const tauG = hasDynRb
        ? 0
        : dot3(
            cross3(rPrev, [0, mass * RIGID_BODY_GRAVITY * gScale, 0]),
            u,
          );
      const denom = inertia + jt.damping * dt + jt.stiffness * dt * dt;
      omega = (inertia * omega + (tauG - jt.stiffness * js.angle) * dt) / denom;
      if (jt.motorMaxForce > 0) {
        const maxDw = (jt.motorMaxForce / inertia) * dt;
        omega += Math.max(
          -maxDw,
          Math.min(maxDw, jt.motorSpeed - omega),
        );
      }
      omega = Math.max(-50, Math.min(50, omega));
      let angle = js.angle + omega * dt;
      if (jt.limits) {
        const minRad = (jt.limits[0] * Math.PI) / 180;
        const maxRad = (jt.limits[1] * Math.PI) / 180;
        if (angle < minRad) {
          angle = minRad;
          if (omega < 0) omega = 0;
        } else if (angle > maxRad) {
          angle = maxRad;
          if (omega > 0) omega = 0;
        }
      }
      js.angle = angle;
      js.omega = omega;
      const qHinge = quatFromAxisAngle4(u, angle);
      if (Math.abs(u[1]) > 0.9999) {
        b.yaw = wrapAngle(angle * (u[1] >= 0 ? 1 : -1));
        b.rot = [0, 0, 0, 1];
      } else {
        b.yaw = 0;
        b.rot = qHinge;
      }
      const rNew = quatRotateVec(qHinge, r0);
      b.pos = [
        worldPivot[0] + rNew[0],
        worldPivot[1] + rNew[1],
        worldPivot[2] + rNew[2],
      ];
      const wxR = cross3(u, rNew);
      b.vel = [
        targetVel[0] + wxR[0] * omega,
        targetVel[1] + wxR[1] * omega,
        targetVel[2] + wxR[2] * omega,
      ];
      const bs = bodyStateOf(b);
      if (bs && Math.abs(omega) > RIGID_BODY_SLEEP_ANGULAR_EPS) {
        bs.sleeping = false;
        bs.sleepTicks = 0;
      }
    } else if (jt.type === 'slider') {
      const u = jt.axis;
      const origin: Vec3 = [
        worldPivot[0] - jt.anchor[0],
        worldPivot[1] - jt.anchor[1],
        worldPivot[2] - jt.anchor[2],
      ];
      const dv: Vec3 = [
        b.vel[0] - (targetVel[0] + u[0] * js.slideVel),
        b.vel[1] - (targetVel[1] + u[1] * js.slideVel),
        b.vel[2] - (targetVel[2] + u[2] * js.slideVel),
      ];
      let v = js.slideVel + dot3(dv, u);
      const fGrav = hasDynRb ? 0 : mass * RIGID_BODY_GRAVITY * gScale * u[1];
      const denom = mass + jt.damping * dt + jt.stiffness * dt * dt;
      v = (mass * v + (fGrav - jt.stiffness * js.slidePos) * dt) / denom;
      if (jt.motorMaxForce > 0) {
        const maxDv = (jt.motorMaxForce / mass) * dt;
        v += Math.max(-maxDv, Math.min(maxDv, jt.motorSpeed - v));
      }
      v = Math.max(-200, Math.min(200, v));
      let s = js.slidePos + v * dt;
      if (jt.limits) {
        if (s < jt.limits[0]) {
          s = jt.limits[0];
          if (v < 0) v = 0;
        } else if (s > jt.limits[1]) {
          s = jt.limits[1];
          if (v > 0) v = 0;
        }
      }
      js.slidePos = s;
      js.slideVel = v;
      b.pos = [origin[0] + u[0] * s, origin[1] + u[1] * s, origin[2] + u[2] * s];
      b.vel = [
        targetVel[0] + u[0] * v,
        targetVel[1] + u[1] * v,
        targetVel[2] + u[2] * v,
      ];
      const bs = bodyStateOf(b);
      if (bs && Math.abs(v) > RIGID_BODY_SLEEP_LINEAR_EPS) {
        bs.sleeping = false;
        bs.sleepTicks = 0;
      }
    } else if (jt.type === 'spring') {
      if (!rbOpts) {
        b.vel = [
          b.vel[0],
          b.vel[1] + RIGID_BODY_GRAVITY * gScale * dt,
          b.vel[2],
        ];
      }
      const pB: Vec3 = tb ? tb.pos : js.worldAnchor;
      const offA: Vec3 = tb ? quatRotateVec(bodyQuat(b), jt.anchor) : [0, 0, 0];
      const pA: Vec3 = [
        b.pos[0] + offA[0],
        b.pos[1] + offA[1],
        b.pos[2] + offA[2],
      ];
      const d: Vec3 = [pA[0] - pB[0], pA[1] - pB[1], pA[2] - pB[2]];
      const dist = Math.hypot(d[0], d[1], d[2]);
      const dir: Vec3 =
        dist > 1e-6
          ? [d[0] / dist, d[1] / dist, d[2] / dist]
          : [...jt.axis];
      const stretch = dist - js.restLen;
      const invM1 = 1 / mass;
      const tbDyn =
        tb?.traits.rigidBody?.body === 'dynamic' && tb.traits.rigidBody.mass > 0
          ? tb.traits.rigidBody
          : null;
      const invM2 = tbDyn ? 1 / tbDyn.mass : 0;
      const effMass = 1 / (invM1 + invM2);
      const relVel: Vec3 = [
        b.vel[0] - targetVel[0],
        b.vel[1] - targetVel[1],
        b.vel[2] - targetVel[2],
      ];
      const vRel = dot3(relVel, dir);
      const denom = effMass + jt.damping * dt + jt.stiffness * dt * dt;
      const vRelNew = (effMass * vRel - jt.stiffness * stretch * dt) / denom;
      const jImp = (vRelNew - vRel) * effMass;
      const dv1 = jImp * invM1;
      b.vel = [
        Math.max(-200, Math.min(200, b.vel[0] + dir[0] * dv1)),
        Math.max(-200, Math.min(200, b.vel[1] + dir[1] * dv1)),
        Math.max(-200, Math.min(200, b.vel[2] + dir[2] * dv1)),
      ];
      if (!rbOpts) {
        const latDamp = Math.max(0, 1 - Math.min(jt.damping * 0.05, 5) * dt);
        const vnAfter = dot3(b.vel, dir);
        b.vel = [
          dir[0] * vnAfter + (b.vel[0] - dir[0] * vnAfter) * latDamp,
          dir[1] * vnAfter + (b.vel[1] - dir[1] * vnAfter) * latDamp,
          dir[2] * vnAfter + (b.vel[2] - dir[2] * vnAfter) * latDamp,
        ];
        b.pos = [
          b.pos[0] + b.vel[0] * dt,
          b.pos[1] + b.vel[1] * dt,
          b.pos[2] + b.vel[2] * dt,
        ];
      } else if (hasDynRb) {
        b.pos = [
          b.pos[0] + dir[0] * dv1 * dt,
          b.pos[1] + dir[1] * dv1 * dt,
          b.pos[2] + dir[2] * dv1 * dt,
        ];
      }
      if (tb && invM2 > 0) {
        const dv2 = -jImp * invM2;
        tb.vel = [
          Math.max(-200, Math.min(200, tb.vel[0] + dir[0] * dv2)),
          Math.max(-200, Math.min(200, tb.vel[1] + dir[1] * dv2)),
          Math.max(-200, Math.min(200, tb.vel[2] + dir[2] * dv2)),
        ];
        tb.pos = [
          tb.pos[0] + dir[0] * dv2 * dt,
          tb.pos[1] + dir[1] * dv2 * dt,
          tb.pos[2] + dir[2] * dv2 * dt,
        ];
        const tbs = bodyStateOf(tb);
        if (tbs && Math.abs(dv2) > 1e-4) {
          tbs.sleeping = false;
          tbs.sleepTicks = 0;
        }
      }
      if (jt.limits) {
        const pB2: Vec3 = tb ? tb.pos : js.worldAnchor;
        const offA2: Vec3 = tb ? quatRotateVec(bodyQuat(b), jt.anchor) : [0, 0, 0];
        const dx = b.pos[0] + offA2[0] - pB2[0];
        const dy = b.pos[1] + offA2[1] - pB2[1];
        const dz = b.pos[2] + offA2[2] - pB2[2];
        const d2 = Math.hypot(dx, dy, dz);
        const clamped = Math.max(jt.limits[0], Math.min(jt.limits[1], d2));
        if (Math.abs(clamped - d2) > 1e-6) {
          const n: Vec3 =
            d2 > 1e-6 ? [dx / d2, dy / d2, dz / d2] : [...jt.axis];
          const corr = (clamped - d2) / (invM1 + invM2);
          b.pos = [
            b.pos[0] + n[0] * corr * invM1,
            b.pos[1] + n[1] * corr * invM1,
            b.pos[2] + n[2] * corr * invM1,
          ];
          if (tb && invM2 > 0) {
            tb.pos = [
              tb.pos[0] - n[0] * corr * invM2,
              tb.pos[1] - n[1] * corr * invM2,
              tb.pos[2] - n[2] * corr * invM2,
            ];
          }
          const rv = dot3(
            [
              b.vel[0] - (tb ? tb.vel[0] : 0),
              b.vel[1] - (tb ? tb.vel[1] : 0),
              b.vel[2] - (tb ? tb.vel[2] : 0),
            ],
            n,
          );
          if ((d2 > jt.limits[1] && rv > 0) || (d2 < jt.limits[0] && rv < 0)) {
            const jLim = -rv / (invM1 + invM2);
            b.vel = [
              b.vel[0] + n[0] * jLim * invM1,
              b.vel[1] + n[1] * jLim * invM1,
              b.vel[2] + n[2] * jLim * invM1,
            ];
            if (tb && invM2 > 0) {
              tb.vel = [
                tb.vel[0] - n[0] * jLim * invM2,
                tb.vel[1] - n[1] * jLim * invM2,
                tb.vel[2] - n[2] * jLim * invM2,
              ];
            }
          }
        }
      }
      const bs = bodyStateOf(b);
      if (bs && Math.hypot(b.vel[0], b.vel[1], b.vel[2]) > RIGID_BODY_SLEEP_LINEAR_EPS) {
        bs.sleeping = false;
        bs.sleepTicks = 0;
      }
    } else if (jt.type === 'ball') {
      const r0: Vec3 = [-jt.anchor[0], -jt.anchor[1], -jt.anchor[2]];
      const armLen2 = dot3(r0, r0);
      const rPrev = quatRotateVec(b.rot, r0);
      const inertia = Math.max(0.05, mass * Math.max(armLen2, 0.25));
      let w = js.omegaVec;
      if (armLen2 > 1e-8) {
        const wxRPrev = cross3(w, rPrev);
        const dv: Vec3 = [
          b.vel[0] - (targetVel[0] + wxRPrev[0]),
          b.vel[1] - (targetVel[1] + wxRPrev[1]),
          b.vel[2] - (targetVel[2] + wxRPrev[2]),
        ];
        const dw = cross3(rPrev, dv);
        w = [
          w[0] + dw[0] / armLen2,
          w[1] + dw[1] / armLen2,
          w[2] + dw[2] / armLen2,
        ];
      }
      const fg = hasDynRb ? 0 : mass * RIGID_BODY_GRAVITY * gScale;
      const tauG: Vec3 = [-rPrev[2] * fg, 0, rPrev[0] * fg];
      const qPos: Quat4 =
        b.rot[3] < 0
          ? [-b.rot[0], -b.rot[1], -b.rot[2], -b.rot[3]]
          : b.rot;
      const sinHalf = Math.hypot(qPos[0], qPos[1], qPos[2]);
      const swingAngle =
        2 * Math.atan2(sinHalf, Math.max(0, Math.min(1, qPos[3])));
      const swingAxis: Vec3 =
        sinHalf > 1e-7
          ? [qPos[0] / sinHalf, qPos[1] / sinHalf, qPos[2] / sinHalf]
          : [0, 1, 0];
      const denom = inertia + jt.damping * dt + jt.stiffness * dt * dt;
      w = [
        (inertia * w[0] + (tauG[0] - jt.stiffness * swingAngle * swingAxis[0]) * dt) /
          denom,
        (inertia * w[1] + (tauG[1] - jt.stiffness * swingAngle * swingAxis[1]) * dt) /
          denom,
        (inertia * w[2] + (tauG[2] - jt.stiffness * swingAngle * swingAxis[2]) * dt) /
          denom,
      ];
      const wMag = Math.hypot(w[0], w[1], w[2]);
      if (wMag > 50) {
        const scale = 50 / wMag;
        w = [w[0] * scale, w[1] * scale, w[2] * scale];
      }
      const wStep = Math.hypot(w[0], w[1], w[2]);
      if (wStep > 1e-8) {
        const dq = quatFromAxisAngle4(
          [w[0] / wStep, w[1] / wStep, w[2] / wStep],
          wStep * dt,
        );
        b.rot = quatNormalize4(quatMul4(dq, b.rot));
      }
      if (jt.limits) {
        const maxRad =
          (Math.max(Math.abs(jt.limits[0]), Math.abs(jt.limits[1])) * Math.PI) /
          180;
        const qC: Quat4 =
          b.rot[3] < 0
            ? [-b.rot[0], -b.rot[1], -b.rot[2], -b.rot[3]]
            : b.rot;
        const sH = Math.hypot(qC[0], qC[1], qC[2]);
        const ang = 2 * Math.atan2(sH, Math.max(0, Math.min(1, qC[3])));
        if (ang > maxRad && sH > 1e-7) {
          const ax: Vec3 = [qC[0] / sH, qC[1] / sH, qC[2] / sH];
          b.rot = quatFromAxisAngle4(ax, maxRad);
          const wOut = dot3(w, ax);
          if (wOut > 0) {
            w = [w[0] - ax[0] * wOut, w[1] - ax[1] * wOut, w[2] - ax[2] * wOut];
          }
        }
      }
      js.omegaVec = w;
      const rNew = quatRotateVec(b.rot, r0);
      b.pos = [
        worldPivot[0] + rNew[0],
        worldPivot[1] + rNew[1],
        worldPivot[2] + rNew[2],
      ];
      const wxR = cross3(w, rNew);
      b.vel = [
        targetVel[0] + wxR[0],
        targetVel[1] + wxR[1],
        targetVel[2] + wxR[2],
      ];
      const bs = bodyStateOf(b);
      if (bs && Math.hypot(w[0], w[1], w[2]) > RIGID_BODY_SLEEP_ANGULAR_EPS) {
        bs.sleeping = false;
        bs.sleepTicks = 0;
      }
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
      (b.traits.joint !== undefined ||
        (b.traits.rigidBody &&
          (b.traits.rigidBody.body === 'dynamic' ||
            b.traits.rigidBody.body === 'kinematic'))),
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

  // 5b. Mechanical joint constraints (`hinge`, `slider`, `spring`, `ball`).
  stepJoints(world, dt);

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
    for (const b of world.bodies) {
      delete b.data[STATE_KEY];
      delete b.data[JOINT_STATE_KEY];
    }
  },
  dispose(world: SimWorld): void {
    for (const b of world.bodies) {
      delete b.data[STATE_KEY];
      delete b.data[JOINT_STATE_KEY];
    }
  },
};

registerSimSystem(rigidBodySystem);
