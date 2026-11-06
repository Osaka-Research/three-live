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
 * @fileoverview `steering-agents` plugin for `xr-live-sim`.
 *
 * Moves every node with an `agent` trait on the XZ plane using steering
 * behaviors (after Craig Reynolds): `patrol` (waypoints), `chase`, `flee`,
 * `follow`, and `wander`, plus separation between agents and push-out from
 * `collidable` nodes. `sightRadius` gates engagement (`0` means unlimited for
 * `chase` / `flee` / `follow`, and never-engage for `patrol` / `wander`).
 *
 * Events: `agentstatechange` `{nodeId, state, targetId}` and `agentreach`
 * `{agentId, targetId, position}` (1 s cooldown per agent).
 */

import {
  AGENT_TARGET_USER,
  type AgentOptions,
} from '../../../three-live/src/xr-sim-schema';
import type {Vec3} from '../plugins/common';
import {
  bodyAABB,
  hashString,
  makeRng,
  pushCircleOutOfAABB,
  registerSimSystem,
  turnToward,
  yawFromDir,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';

/** Effective state of an agent. */
export type AgentState =
  | 'idle'
  | 'patrol'
  | 'chase'
  | 'flee'
  | 'wander'
  | 'follow';

/** Minimum time between `agentreach` events per agent (ms). */
export const AGENT_REACH_COOLDOWN_MS = 1000;
/** Wander heading jitter (rad/s). */
export const AGENT_WANDER_JITTER = 1.5;

interface AgentRuntime {
  state: AgentState;
  waypoint: number;
  wanderYaw: number;
  lastReachMs: number;
  rng: () => number;
}

function runtimeOf(b: SimBody): AgentRuntime {
  let rt = b.data['agent'] as AgentRuntime | undefined;
  if (!rt) {
    const rng = makeRng(hashString(b.key));
    rt = {
      state: 'idle',
      waypoint: 0,
      wanderYaw: rng() * Math.PI * 2,
      lastReachMs: -Infinity,
      rng,
    };
    b.data['agent'] = rt;
  }
  return rt;
}

/** Resolves an agent target to a scene-local position and optional body. */
export function resolveAgentTarget(
  world: SimWorld,
  target: string,
): {pos: Vec3; body: SimBody | null; id: string} | null {
  if (!target) return null;
  if (target === AGENT_TARGET_USER) {
    const ch = world.character;
    return {pos: world.userPosition(), body: ch, id: ch?.name ?? 'user'};
  }
  const body = world.byName.get(target);
  if (body && !body.hidden && !body.isTemplate) {
    return {pos: [...body.pos], body, id: body.name};
  }
  // Fall back to a plain (non-simulated) mesh with that name.
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  const mesh = (world.viewer.meshes ?? []).find((m: any) => m?.name === target);
  const t = mesh?.transform;
  return t ? {pos: [t[12], t[13], t[14]], body: null, id: target} : null;
}

/** Chooses the effective state from the authored mode and target distance. */
export function chooseAgentState(
  opts: AgentOptions,
  targetDistance: number | null,
  patrolDone: boolean,
): AgentState {
  const inSight =
    targetDistance !== null &&
    (opts.sightRadius === 0 || targetDistance <= opts.sightRadius);
  const roam: AgentState =
    opts.waypoints.length > 0 && !patrolDone ? 'patrol' : 'wander';
  switch (opts.mode) {
    case 'chase':
    case 'flee':
      return inSight ? opts.mode : roam;
    case 'follow':
      return inSight ? 'follow' : 'idle';
    case 'patrol':
    case 'wander':
      if (
        targetDistance !== null &&
        opts.sightRadius > 0 &&
        targetDistance <= opts.sightRadius
      ) {
        return 'chase';
      }
      if (opts.mode === 'patrol') {
        return opts.waypoints.length === 0
          ? 'wander'
          : patrolDone
            ? 'idle'
            : 'patrol';
      }
      return 'wander';
    default:
      return 'idle';
  }
}

function separation(world: SimWorld, b: SimBody, radius: number): Vec3 {
  const push: Vec3 = [0, 0, 0];
  if (radius <= 0) return push;
  for (const o of world.bodies) {
    if (o === b || o.hidden || o.isTemplate || !o.traits.agent) continue;
    const dx = b.pos[0] - o.pos[0];
    const dz = b.pos[2] - o.pos[2];
    const d = Math.hypot(dx, dz);
    if (d >= radius) continue;
    if (d < 1e-6) {
      // Coincident agents: separate along a stable per-pair direction.
      const a = (hashString(b.key) % 628) / 100;
      push[0] += Math.sin(a);
      push[2] += Math.cos(a);
      continue;
    }
    const w = 1 - d / radius;
    push[0] += (dx / d) * w;
    push[2] += (dz / d) * w;
  }
  return push;
}

/** Advances one agent by `dt`. Exposed for tests and parity fixtures. */
export function stepAgent(world: SimWorld, b: SimBody, dt: number): void {
  const opts = b.traits.agent!;
  const rt = runtimeOf(b);
  const tgt = resolveAgentTarget(world, opts.target);
  const dist = tgt
    ? Math.hypot(tgt.pos[0] - b.pos[0], tgt.pos[2] - b.pos[2])
    : null;
  const patrolDone =
    !opts.loopWaypoints && rt.waypoint >= opts.waypoints.length;
  const state = chooseAgentState(opts, dist, patrolDone);
  if (state !== rt.state) {
    rt.state = state;
    world.emit(
      'agentstatechange',
      {
        nodeId: b.name,
        state,
        targetId:
          state === 'chase' || state === 'flee' || state === 'follow'
            ? (tgt?.id ?? null)
            : null,
      },
      {body: b, other: tgt?.body ?? undefined},
    );
  }

  let dir: [number, number] = [0, 0];
  let scale = 1;
  if ((state === 'chase' || state === 'follow') && tgt && dist !== null) {
    if (dist > 1e-6) {
      dir = [(tgt.pos[0] - b.pos[0]) / dist, (tgt.pos[2] - b.pos[2]) / dist];
    }
    // Slow down near the target but keep a floor speed so the agent actually
    // arrives instead of approaching `stopDistance` asymptotically.
    scale =
      dist <= opts.stopDistance
        ? 0
        : Math.max(
            0.25,
            Math.min(1, (dist - opts.stopDistance) / opts.stopDistance),
          );
  } else if (state === 'flee' && tgt && dist !== null) {
    dir =
      dist > 1e-6
        ? [(b.pos[0] - tgt.pos[0]) / dist, (b.pos[2] - tgt.pos[2]) / dist]
        : [Math.sin(rt.wanderYaw), Math.cos(rt.wanderYaw)];
  } else if (state === 'patrol') {
    const wp = opts.waypoints[Math.min(rt.waypoint, opts.waypoints.length - 1)];
    const dx = wp[0] - b.pos[0];
    const dz = wp[2] - b.pos[2];
    const d = Math.hypot(dx, dz);
    if (d < Math.max(0.15, opts.stopDistance * 0.5)) {
      rt.waypoint = opts.loopWaypoints
        ? (rt.waypoint + 1) % opts.waypoints.length
        : rt.waypoint + 1;
    } else {
      dir = [dx / d, dz / d];
    }
  } else if (state === 'wander') {
    rt.wanderYaw += (rt.rng() - 0.5) * 2 * AGENT_WANDER_JITTER * dt;
    dir = [Math.sin(rt.wanderYaw), Math.cos(rt.wanderYaw)];
    // tslint:disable-next-line:no-any ThreeView bounds.
    const bounds = (world.viewer as any).bounds;
    const min = bounds?.min;
    const max = bounds?.max;
    if (Array.isArray(min) && Array.isArray(max)) {
      const out =
        b.pos[0] < min[0] ||
        b.pos[0] > max[0] ||
        b.pos[2] < min[2] ||
        b.pos[2] > max[2];
      if (out) {
        const cx = (min[0] + max[0]) / 2 - b.pos[0];
        const cz = (min[2] + max[2]) / 2 - b.pos[2];
        const d = Math.hypot(cx, cz) || 1;
        dir = [cx / d, cz / d];
        rt.wanderYaw = Math.atan2(dir[0], dir[1]);
      }
    }
  }

  const sep = separation(world, b, opts.separationRadius);
  const want: [number, number] = [
    dir[0] * scale + sep[0] * 1.5,
    dir[1] * scale + sep[2] * 1.5,
  ];
  const wantLen = Math.hypot(want[0], want[1]);
  if (wantLen > 1e-3) {
    const wantYaw = yawFromDir([want[0], 0, want[1]]);
    b.yaw = turnToward(b.yaw, wantYaw, opts.turnSpeed * dt);
    // Slow down while facing away so agents turn in place instead of looping.
    const align = Math.max(0, Math.cos(b.yaw - wantYaw));
    const speed = opts.speed * Math.min(1, wantLen) * align;
    const step = speed * dt;
    b.vel = [Math.sin(b.yaw) * speed, 0, Math.cos(b.yaw) * speed];
    const next: Vec3 = [
      b.pos[0] + Math.sin(b.yaw) * step,
      b.pos[1],
      b.pos[2] + Math.cos(b.yaw) * step,
    ];
    const r = Math.max(0.05, Math.max(b.half[0], b.half[2]));
    const feet = b.pos[1] + b.center[1] - b.half[1];
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
      if (max[1] <= feet + 0.05 || min[1] >= feet + b.half[1] * 2) continue;
      const pushed = pushCircleOutOfAABB(next, r, min, max);
      if (pushed) {
        next[0] = pushed[0];
        next[2] = pushed[1];
      }
    }
    b.pos = next;
  } else {
    b.vel = [0, 0, 0];
  }

  if (
    tgt &&
    dist !== null &&
    (state === 'chase' || state === 'follow') &&
    dist <= opts.stopDistance + 1e-3 &&
    world.timeMs - rt.lastReachMs >= AGENT_REACH_COOLDOWN_MS
  ) {
    rt.lastReachMs = world.timeMs;
    world.emit(
      'agentreach',
      {agentId: b.name, targetId: tgt.id, position: [...b.pos]},
      {body: b, other: tgt.body ?? undefined},
    );
  }
}

/** `SimSystem` stepping every agent. */
export const steeringAgentsSystem: SimSystem = {
  name: 'steering-agents',
  priority: 20,
  step(world: SimWorld, dt: number): void {
    const off = world.attr('steering-agents');
    if (off === 'false' || off === 'none') return;
    for (const b of world.bodies) {
      if (b.traits.agent && !b.hidden && !b.isTemplate) stepAgent(world, b, dt);
    }
  },
};

registerSimSystem(steeringAgentsSystem);
