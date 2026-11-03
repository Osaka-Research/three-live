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
 * @fileoverview `hit-zones` plugin for `xr-live-sim`.
 *
 * - **Integrity:** nodes with an `integrity` trait take hits, flash briefly,
 *   show an optional floating bar, and emit `xrdepleted` at zero (hiding with
 *   a small particle burst when `hideOnDepleted`).
 * - **Firing** (host attribute `hit-zones` = `projectile` (default) |
 *   `hitscan` | `contact`): `F` / Enter / gamepad RT / the touch fire button
 *   fire from the character (or the camera); a tap or XR select fires at the
 *   selected point. Hits skip targets in the shooter's own `group`.
 * - **Contacts:** a node with `integrity.contactAmount > 0` applies that amount
 *   to overlapping nodes of other groups (limited by the target cooldown).
 * - **Zones:** `zone` nodes emit `xrzoneenter` / `xrzoneexit` when tracked
 *   nodes (character, agents, integrity nodes, and the user in XR) cross them.
 * - **Spawners:** `spawner` nodes clone a template node on an interval.
 *
 * Other host attributes: `fire-rate`, `projectile-speed`, `projectile-gravity`,
 * `hit-amount`.
 */

import {clampNum} from '../../../three-live/src/xr-trait-schema';
import {
  buildBoxGeometry,
  createDynamicMesh,
  removeDynamicMesh,
  setLocalTRS,
  type DynamicGeometry,
  type Vec3,
} from '../plugins/common';
import {
  baseTransformOf,
  bodyAABB,
  bodyCenter,
  intersectSegmentAABB,
  intersectSegmentSphere,
  makeBody,
  registerSimSystem,
  rotateY,
  SIM_MAX_INSTANCES,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';
import {disposeSimInput, ensureSimInput, updateSimInput} from './input';

/** Pooled projectile count per world. */
export const MAX_PROJECTILES = 32;
/** Pooled burst fragment count per world. */
export const MAX_FRAGMENTS = 32;
/** Projectile lifetime (s). */
export const PROJECTILE_LIFETIME_S = 3;
/** Hit flash duration (ms). */
export const HIT_FLASH_MS = 120;
/** Delay before a depleted, hidden spawned instance is removed (ms). */
export const DESPAWN_DELAY_MS = 500;
/** Hitscan range (m). */
export const HITSCAN_RANGE = 100;

/** Firing mode from the `hit-zones` host attribute. */
export type HitMode = 'off' | 'projectile' | 'hitscan' | 'contact';

/** Resolves the `hit-zones` attribute (`''` means `projectile`). */
export function resolveHitMode(world: SimWorld): HitMode {
  const raw = world.attr('hit-zones');
  if (raw === null) return 'off';
  const v = raw.trim().toLowerCase();
  return v === 'hitscan' || v === 'contact'
    ? v
    : v === '' || v === 'projectile'
      ? 'projectile'
      : 'off';
}

interface Particle {
  active: boolean;
  pos: Vec3;
  vel: Vec3;
  life: number;
  source: SimBody | null;
  group: string;
  color: number[] | null;
  // tslint:disable-next-line:no-any Dynamic GPU mesh record.
  mesh: any;
}

interface HitState {
  lastFireMs: number;
  shots: Particle[];
  frags: Particle[];
  zones: Map<SimBody, Set<string>>;
  // tslint:disable-next-line:no-any Dynamic GPU mesh records.
  outlines: Map<SimBody, any>;
  // tslint:disable-next-line:no-any Dynamic GPU mesh records.
  bars: Map<SimBody, {bg: any; fill: any}>;
  flashes: Map<SimBody, number>;
  spawners: Map<SimBody, {timer: number; spawned: number}>;
  despawn: Map<SimBody, number>;
}

const STATE_KEY = 'hit-zones';
// tslint:disable-next-line:no-any Primitive GPU struct.
const origColors = new WeakMap<any, number[]>();

function stateOf(world: SimWorld): HitState {
  let st = world.state.get(STATE_KEY) as HitState | undefined;
  if (!st) {
    const pool = () => ({
      active: false,
      pos: [0, 0, 0] as Vec3,
      vel: [0, 0, 0] as Vec3,
      life: 0,
      source: null,
      group: '',
      color: null,
      mesh: null,
    });
    st = {
      lastFireMs: -Infinity,
      shots: Array.from({length: MAX_PROJECTILES}, pool),
      frags: Array.from({length: MAX_FRAGMENTS}, pool),
      zones: new Map(),
      outlines: new Map(),
      bars: new Map(),
      flashes: new Map(),
      spawners: new Map(),
      despawn: new Map(),
    };
    world.state.set(STATE_KEY, st);
  }
  return st;
}

/** Group used for hit filtering and zone watching. */
export function groupOf(world: SimWorld, b: SimBody): string {
  return (
    b.traits.integrity?.group ??
    (b === world.character ? 'character' : b.traits.agent ? 'agent' : 'neutral')
  );
}

function canTarget(b: SimBody, group: string, source: SimBody | null): boolean {
  return Boolean(
    b.traits.integrity &&
      !b.hidden &&
      !b.isTemplate &&
      b !== source &&
      b.integrity > 0 &&
      b.traits.integrity.group !== group,
  );
}

function tint(b: SimBody, on: boolean): void {
  for (const m of b.meshes) {
    for (const prim of m.primitives ?? []) {
      if (!Array.isArray(prim.baseColor)) continue;
      const orig = origColors.get(prim);
      if (on) {
        const o = orig ?? [...prim.baseColor];
        origColors.set(prim, o);
        prim.baseColor = [
          o[0] + (1 - o[0]) * 0.6,
          o[1] + (0.25 - o[1]) * 0.6,
          o[2] + (0.25 - o[2]) * 0.6,
          o[3] ?? 1,
        ];
      } else if (orig) {
        prim.baseColor = orig;
        origColors.delete(prim);
      }
    }
  }
}

function burst(world: SimWorld, st: HitState, b: SimBody): void {
  const c = bodyCenter(b);
  const color = b.meshes[0]?.primitives?.[0]?.baseColor;
  let n = 0;
  for (const f of st.frags) {
    if (f.active || n >= 8) continue;
    const a = (n / 8) * Math.PI * 2 + world.rng();
    const s = 1.5 + world.rng() * 1.5;
    f.active = true;
    f.pos = [...c];
    f.vel = [Math.cos(a) * s, 2 + world.rng() * 2, Math.sin(a) * s];
    f.life = 0.6;
    f.source = b;
    f.color = Array.isArray(color) ? [...color] : null;
    n++;
  }
}

/**
 * Applies `amount` to `target`. Returns false when blocked by the cooldown or
 * the target has no integrity left.
 */
export function applyHit(
  world: SimWorld,
  target: SimBody,
  amount: number,
  source: SimBody | null,
  point: Vec3 | null,
): boolean {
  const opts = target.traits.integrity;
  if (!opts || target.integrity <= 0 || target.hidden) return false;
  if (world.timeMs - target.lastHitMs < opts.cooldownMs) return false;
  target.lastHitMs = world.timeMs;
  const amt = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  target.integrity = Math.max(0, target.integrity - amt);
  const st = stateOf(world);
  st.flashes.set(target, world.timeMs + HIT_FLASH_MS);
  tint(target, true);
  const at = point ?? bodyCenter(target);
  world.emit(
    'xrhit',
    {
      targetId: target.name,
      sourceId: source?.name ?? 'user',
      amount: amt,
      remaining: target.integrity,
      point: [...at],
    },
    {body: target, other: source ?? undefined},
  );
  if (target.integrity <= 0) {
    world.emit(
      'xrdepleted',
      {
        targetId: target.name,
        group: opts.group,
        scoreValue: opts.scoreValue,
        position: [...target.pos],
      },
      {body: target, other: source ?? undefined},
    );
    if (opts.hideOnDepleted) {
      burst(world, st, target);
      target.hidden = true;
      tint(target, false);
      st.flashes.delete(target);
      if (target.spawnedFrom !== undefined) {
        st.despawn.set(target, world.timeMs + DESPAWN_DELAY_MS);
      }
    }
  }
  return true;
}

function fireOrigin(world: SimWorld): {
  pos: Vec3;
  dir: Vec3;
  source: SimBody | null;
} {
  const ch = world.character;
  if (ch && !ch.hidden) {
    const fwd = rotateY([0, 0, 1], ch.yaw);
    const c = bodyCenter(ch);
    const r = Math.max(ch.half[0], ch.half[2]) + 0.1;
    return {
      pos: [c[0] + fwd[0] * r, c[1], c[2] + fwd[2] * r],
      dir: fwd,
      source: ch,
    };
  }
  return {pos: world.headPosition(), dir: world.cameraForward(), source: null};
}

/** Nearest target along a ray, honoring `collidable` occluders. */
export function raycastTargets(
  world: SimWorld,
  origin: Vec3,
  dir: Vec3,
  group: string,
  source: SimBody | null,
  range = HITSCAN_RANGE,
): {body: SimBody; point: Vec3} | null {
  const end: Vec3 = [
    origin[0] + dir[0] * range,
    origin[1] + dir[1] * range,
    origin[2] + dir[2] * range,
  ];
  let best: SimBody | null = null;
  let bestT = Infinity;
  let blockT = Infinity;
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate || b === source) continue;
    if (canTarget(b, group, source)) {
      const t = intersectSegmentSphere(
        origin,
        end,
        bodyCenter(b),
        Math.max(0.05, b.radius),
      );
      if (t !== null && t < bestT) {
        bestT = t;
        best = b;
      }
    } else if (b.traits.collidable) {
      const [min, max] = bodyAABB(b);
      const t = intersectSegmentAABB(origin, end, min, max);
      if (t !== null && t < blockT) blockT = t;
    }
  }
  if (!best || bestT > blockT) return null;
  return {
    body: best,
    point: [
      origin[0] + (end[0] - origin[0]) * bestT,
      origin[1] + (end[1] - origin[1]) * bestT,
      origin[2] + (end[2] - origin[2]) * bestT,
    ],
  };
}

function fire(world: SimWorld, mode: HitMode, toward: Vec3 | null): void {
  const st = stateOf(world);
  const rate = clampNum(world.numAttr('fire-rate'), 0.1, 30, 4);
  if (world.timeMs - st.lastFireMs < 1000 / rate) return;
  st.lastFireMs = world.timeMs;
  const o = fireOrigin(world);
  let dir = o.dir;
  if (toward) {
    const d = [
      toward[0] - o.pos[0],
      toward[1] - o.pos[1],
      toward[2] - o.pos[2],
    ];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len > 1e-6) dir = [d[0] / len, d[1] / len, d[2] / len];
  }
  const group = o.source ? groupOf(world, o.source) : 'user';
  const amount = clampNum(world.numAttr('hit-amount'), 0, 1e6, 25);
  if (mode === 'hitscan') {
    const hit = raycastTargets(world, o.pos, dir, group, o.source);
    if (hit) applyHit(world, hit.body, amount, o.source, hit.point);
    return;
  }
  const shot = st.shots.find((s) => !s.active);
  if (!shot) return;
  const speed = clampNum(world.numAttr('projectile-speed'), 0.5, 200, 14);
  shot.active = true;
  shot.pos = [...o.pos];
  shot.vel = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
  shot.life = PROJECTILE_LIFETIME_S;
  shot.source = o.source;
  shot.group = group;
}

function stepShots(world: SimWorld, st: HitState, dt: number): void {
  const g = clampNum(world.numAttr('projectile-gravity'), 0, 50, 0);
  const amount = clampNum(world.numAttr('hit-amount'), 0, 1e6, 25);
  for (const s of st.shots) {
    if (!s.active) continue;
    s.life -= dt;
    s.vel[1] -= g * dt;
    const prev: Vec3 = [...s.pos];
    s.pos = [
      s.pos[0] + s.vel[0] * dt,
      s.pos[1] + s.vel[1] * dt,
      s.pos[2] + s.vel[2] * dt,
    ];
    let best: SimBody | null = null;
    let bestT = Infinity;
    let blocked = Infinity;
    for (const b of world.bodies) {
      if (b.hidden || b.isTemplate || b === s.source) continue;
      if (canTarget(b, s.group, s.source)) {
        const t = intersectSegmentSphere(
          prev,
          s.pos,
          bodyCenter(b),
          Math.max(0.05, b.radius),
        );
        if (t !== null && t < bestT) {
          bestT = t;
          best = b;
        }
      } else if (b.traits.collidable) {
        const [min, max] = bodyAABB(b);
        const t = intersectSegmentAABB(prev, s.pos, min, max);
        if (t !== null && t < blocked) blocked = t;
      }
    }
    if (best && bestT <= blocked) {
      const p: Vec3 = [
        prev[0] + (s.pos[0] - prev[0]) * bestT,
        prev[1] + (s.pos[1] - prev[1]) * bestT,
        prev[2] + (s.pos[2] - prev[2]) * bestT,
      ];
      applyHit(world, best, amount, s.source, p);
      s.active = false;
    } else if (blocked <= 1 || s.life <= 0 || s.pos[1] < world.floorY - 50) {
      s.active = false;
    }
  }
  for (const f of st.frags) {
    if (!f.active) continue;
    f.life -= dt;
    f.vel[1] -= 9.8 * dt;
    f.pos = [
      f.pos[0] + f.vel[0] * dt,
      f.pos[1] + f.vel[1] * dt,
      f.pos[2] + f.vel[2] * dt,
    ];
    if (f.life <= 0) f.active = false;
  }
}

function stepContacts(world: SimWorld): void {
  const live = world.bodies.filter(
    (b) => b.traits.integrity && !b.hidden && !b.isTemplate,
  );
  for (const src of live) {
    const amt = src.traits.integrity!.contactAmount;
    if (amt <= 0 || src.integrity <= 0) continue;
    const cs = bodyCenter(src);
    for (const t of live) {
      if (!canTarget(t, src.traits.integrity!.group, src)) continue;
      const ct = bodyCenter(t);
      const r = Math.max(0.05, src.radius) + Math.max(0.05, t.radius);
      const d = Math.hypot(cs[0] - ct[0], cs[1] - ct[1], cs[2] - ct[2]);
      if (d < r) applyHit(world, t, amt, src, null);
    }
  }
}

/** True when scene-local point `p` is inside zone body `z`. */
export function pointInZone(z: SimBody, p: readonly number[]): boolean {
  const opts = z.traits.zone!;
  const local = rotateY(
    [p[0] - z.pos[0], p[1] - z.pos[1], p[2] - z.pos[2]],
    -z.yaw,
  );
  if (opts.shape === 'sphere') {
    return Math.hypot(local[0], local[1], local[2]) <= opts.radius;
  }
  return (
    Math.abs(local[0]) <= opts.size[0] / 2 &&
    Math.abs(local[1]) <= opts.size[1] / 2 &&
    Math.abs(local[2]) <= opts.size[2] / 2
  );
}

function stepZones(world: SimWorld, st: HitState): void {
  // Occupancy is keyed by body key: node names may repeat.
  const tracked: Array<{
    key: string;
    id: string;
    group: string;
    pos: Vec3;
    body?: SimBody;
  }> = [];
  for (const b of world.bodies) {
    if (b.hidden || b.isTemplate) continue;
    if (b === world.character || b.traits.agent || b.traits.integrity) {
      tracked.push({
        key: b.key,
        id: b.name,
        group: groupOf(world, b),
        pos: bodyCenter(b),
        body: b,
      });
    }
  }
  if (world.xrActive) {
    tracked.push({
      key: 'user',
      id: 'user',
      group: 'user',
      pos: world.headPosition(),
    });
  }
  for (const z of world.bodies) {
    if (!z.traits.zone || z.isTemplate) continue;
    const inside = st.zones.get(z) ?? new Set<string>();
    const watch = z.traits.zone.watchGroups;
    const now = new Set<string>();
    if (!z.hidden) {
      for (const t of tracked) {
        if (t.body === z) continue;
        if (watch.length > 0 && !watch.includes(t.group)) continue;
        if (pointInZone(z, t.pos)) now.add(t.key);
      }
    }
    for (const t of tracked) {
      const was = inside.has(t.key);
      const is = now.has(t.key);
      if (was === is) continue;
      world.emit(
        is ? 'xrzoneenter' : 'xrzoneexit',
        {zoneId: z.name, nodeId: t.id, group: t.group},
        {body: z, other: t.body},
      );
    }
    // Nodes that vanished (hidden / removed) while inside also exit.
    for (const key of inside) {
      if (now.has(key) || tracked.some((t) => t.key === key)) continue;
      const gone = world.bodies.find((b) => b.key === key);
      world.emit(
        'xrzoneexit',
        {
          zoneId: z.name,
          nodeId: gone?.name ?? key,
          group: gone ? groupOf(world, gone) : '',
        },
        {body: z, other: gone},
      );
    }
    st.zones.set(z, now);
  }
}

/** Clones the template body of `spawner` at the spawner's position. */
export function spawnInstance(
  world: SimWorld,
  spawner: SimBody,
): SimBody | null {
  const opts = spawner.traits.spawner!;
  const tpl = world.bodies.find(
    (b) => b.isTemplate && b.name === opts.template,
  );
  if (!tpl || tpl.meshes.length === 0) return null;
  const n = ++world.spawnCounter;
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  const clones = tpl.meshes.map((m: any) => ({
    ...m,
    transform: new Float32Array(baseTransformOf(m)),
    normalMatrix: new Float32Array(9),
    visible: true,
    // Own primitive records (sharing GPU buffers) so a hit flash on one
    // instance doesn't tint the template and every other clone.
    // tslint:disable-next-line:no-any Primitive GPU structs.
    primitives: (m.primitives ?? []).map((p: any) => ({
      ...p,
      baseColor: Array.isArray(p.baseColor) ? [...p.baseColor] : p.baseColor,
    })),
  }));
  const meshes = world.viewer.meshes;
  if (Array.isArray(meshes)) meshes.push(...clones);
  const traits = {...tpl.traits, spawner: undefined};
  const inst = makeBody(`spawn:${n}`, `${tpl.name}#${n}`, traits, clones, [
    ...tpl.initPos,
  ]);
  inst.spawnedFrom = spawner.key;
  const a = world.rng() * Math.PI * 2;
  const r = Math.sqrt(world.rng()) * opts.spawnRadius;
  inst.pos = [
    spawner.pos[0] + Math.cos(a) * r,
    spawner.pos[1],
    spawner.pos[2] + Math.sin(a) * r,
  ];
  world.addBody(inst);
  return inst;
}

function stepSpawners(world: SimWorld, st: HitState, dt: number): void {
  let total = world.bodies.filter((b) => b.spawnedFrom !== undefined).length;
  for (const s of world.bodies) {
    const opts = s.traits.spawner;
    if (!opts || s.hidden || s.isTemplate) continue;
    let sp = st.spawners.get(s);
    if (!sp) st.spawners.set(s, (sp = {timer: opts.intervalSec, spawned: 0}));
    sp.timer -= dt;
    if (sp.timer > 0) continue;
    sp.timer += opts.intervalSec;
    if (opts.totalCount > 0 && sp.spawned >= opts.totalCount) continue;
    const active = world.bodies.filter((b) => b.spawnedFrom === s.key).length;
    if (active >= opts.maxActive || total >= SIM_MAX_INSTANCES) continue;
    const inst = spawnInstance(world, s);
    if (!inst) continue;
    sp.spawned++;
    total++;
    world.emit(
      'xrspawn',
      {spawnerId: s.name, instanceId: inst.name, index: sp.spawned},
      {body: s, other: inst},
    );
  }
  for (const [b, at] of st.despawn) {
    if (world.timeMs >= at) {
      st.despawn.delete(b);
      removeBar(world, st, b);
      world.removeBody(b);
    }
  }
}

function removeBar(world: SimWorld, st: HitState, b: SimBody): void {
  const bar = st.bars.get(b);
  if (!bar) return;
  removeDynamicMesh(world.viewer, bar.bg);
  removeDynamicMesh(world.viewer, bar.fill);
  st.bars.delete(b);
}

/** Merged 12-edge wireframe box of unit size (edges `t` thick). */
export function buildEdgeBoxGeometry(t = 0.02): DynamicGeometry {
  const unit = buildBoxGeometry(0.5);
  const parts: Array<[Vec3, Vec3]> = [];
  for (const a of [0, 1, 2]) {
    for (const u of [-0.5, 0.5]) {
      for (const v of [-0.5, 0.5]) {
        const c: Vec3 = [0, 0, 0];
        const s: Vec3 = [t, t, t];
        const o = [0, 1, 2].filter((k) => k !== a);
        c[o[0]] = u;
        c[o[1]] = v;
        s[a] = 1 + t;
        parts.push([c, s]);
      }
    }
  }
  const nv = unit.positions.length;
  const positions = new Float32Array(nv * parts.length);
  const normals = new Float32Array(nv * parts.length);
  const indices = new Uint16Array(unit.indices.length * parts.length);
  parts.forEach(([c, s], p) => {
    for (let i = 0; i < nv; i += 3) {
      for (let k = 0; k < 3; k++) {
        positions[p * nv + i + k] = unit.positions[i + k] * s[k] + c[k];
        normals[p * nv + i + k] = unit.normals[i + k];
      }
    }
    unit.indices.forEach((ix, j) => {
      indices[p * unit.indices.length + j] = ix + (p * nv) / 3;
    });
  });
  return {positions, normals, indices};
}

function hexToRgba(hex: string, a: number): [number, number, number, number] {
  const h = hex.replace('#', '');
  const f =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const n = parseInt(f, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}

/** Integrity bar above a body, facing the viewer. */
export interface SimBarVisual {
  readonly body: SimBody;
  readonly center: Vec3;
  /** Yaw (radians) that faces the bar toward the head. */
  readonly yaw: number;
  readonly width: number;
  /** Remaining integrity fraction (0-1). */
  readonly frac: number;
  readonly color: [number, number, number, number];
}

/** Wireframe outline of a `zone` with a `color`. */
export interface SimZoneVisual {
  readonly body: SimBody;
  readonly center: Vec3;
  readonly yaw: number;
  readonly size: Vec3;
  readonly color: [number, number, number, number];
}

/**
 * What `hit-zones` draws this frame. The Android and iOS runtimes compute the
 * same list (`HitZones.visuals`) so every renderer shows the same feedback.
 */
export interface SimVisuals {
  /** Bodies inside their 120 ms hit flash. */
  readonly flashing: SimBody[];
  readonly bars: SimBarVisual[];
  /** Active projectile positions. */
  readonly projectiles: Vec3[];
  /** Active burst fragments and the body whose color they take. */
  readonly fragments: Array<{pos: Vec3; source: SimBody | null}>;
  readonly zones: SimZoneVisual[];
}

/** Integrity bar fill color for a remaining fraction. */
export function barColor(frac: number): [number, number, number, number] {
  return frac > 0.6
    ? [0.13, 0.77, 0.37, 1]
    : frac > 0.3
      ? [0.92, 0.7, 0.03, 1]
      : [0.94, 0.27, 0.27, 1];
}

/** Computes this frame's {@link SimVisuals}. */
export function computeSimVisuals(world: SimWorld): SimVisuals {
  const st = world.state.get(STATE_KEY) as HitState | undefined;
  const out: SimVisuals = {
    flashing: [],
    bars: [],
    projectiles: [],
    fragments: [],
    zones: [],
  };
  if (st) {
    for (const [b, until] of st.flashes) {
      if (world.timeMs < until && !b.hidden) out.flashing.push(b);
    }
    for (const p of st.shots) if (p.active) out.projectiles.push([...p.pos]);
    for (const f of st.frags) {
      if (f.active) out.fragments.push({pos: [...f.pos], source: f.source});
    }
  }
  const head = world.headPosition();
  for (const b of world.bodies) {
    if (b.isTemplate) continue;
    const zone = b.traits.zone;
    if (zone?.color && !b.hidden) {
      out.zones.push({
        body: b,
        center: [...b.pos],
        yaw: b.yaw,
        size:
          zone.shape === 'sphere'
            ? [zone.radius * 2, zone.radius * 2, zone.radius * 2]
            : [...zone.size],
        color: hexToRgba(zone.color, 1),
      });
    }
    const iopts = b.traits.integrity;
    if (!iopts?.showBar || b.hidden || b.integrity <= 0) continue;
    const c = bodyCenter(b);
    const center: Vec3 = [c[0], c[1] + b.half[1] + 0.12, c[2]];
    const frac = Math.max(0, Math.min(1, b.integrity / iopts.max));
    out.bars.push({
      body: b,
      center,
      yaw: Math.atan2(head[0] - center[0], head[2] - center[2]),
      width: Math.max(0.3, Math.min(1.2, 2 * Math.max(b.half[0], b.half[2]))),
      frac,
      color: barColor(frac),
    });
  }
  return out;
}

function syncVisuals(world: SimWorld, st: HitState): void {
  const v = world.viewer;
  const q0 = [0, 0, 0, 1];
  const vis = computeSimVisuals(world);
  const flashing = new Set(vis.flashing);
  for (const b of [...st.flashes.keys()]) {
    if (!flashing.has(b)) {
      tint(b, false);
      st.flashes.delete(b);
    }
  }
  const sync = (
    p: Particle,
    size: number,
    color: [number, number, number, number],
  ) => {
    if (!p.mesh && p.active) {
      p.mesh = createDynamicMesh(v, buildBoxGeometry(size), {
        name: '__xr_sim_particle__',
        color,
        pickable: false,
      });
    }
    if (!p.mesh) return;
    p.mesh.visible = p.active;
    if (p.active) {
      if (p.color) p.mesh.primitives[0].baseColor = p.color;
      setLocalTRS(p.mesh, q0, p.pos, [1, 1, 1]);
    }
  };
  for (const s of st.shots) sync(s, 0.035, [1, 0.85, 0.2, 1]);
  for (const f of st.frags) sync(f, 0.02, [1, 1, 1, 1]);

  const zoneShown = new Set<SimBody>();
  for (const z of vis.zones) {
    zoneShown.add(z.body);
    let mesh = st.outlines.get(z.body);
    if (!mesh) {
      mesh = createDynamicMesh(v, buildEdgeBoxGeometry(0.02), {
        name: '__xr_sim_zone__',
        color: z.color,
        pickable: false,
      });
      st.outlines.set(z.body, mesh);
    }
    mesh.visible = true;
    setLocalTRS(
      mesh,
      [0, Math.sin(z.yaw / 2), 0, Math.cos(z.yaw / 2)],
      z.center,
      z.size,
    );
  }
  for (const [b, mesh] of st.outlines) {
    if (!zoneShown.has(b)) mesh.visible = false;
  }

  const barShown = new Set<SimBody>();
  for (const bv of vis.bars) {
    barShown.add(bv.body);
    let bar = st.bars.get(bv.body);
    if (!bar) {
      bar = {
        bg: createDynamicMesh(v, buildBoxGeometry(0.5), {
          name: '__xr_sim_bar_bg__',
          color: [0.06, 0.09, 0.16, 1],
          pickable: false,
        }),
        fill: createDynamicMesh(v, buildBoxGeometry(0.5), {
          name: '__xr_sim_bar__',
          color: bv.color,
          pickable: false,
        }),
      };
      st.bars.set(bv.body, bar);
    }
    bar.bg.visible = true;
    bar.fill.visible = true;
    const {center: top, yaw, width: w, frac} = bv;
    const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    setLocalTRS(bar.bg, q, top, [w + 0.02, 0.07, 0.01]);
    // Left-align the fill along the bar's local X axis, slightly in front.
    const off = rotateY([(-(1 - frac) * w) / 2, 0, 0.006], yaw);
    setLocalTRS(
      bar.fill,
      q,
      [top[0] + off[0], top[1], top[2] + off[2]],
      [Math.max(1e-3, w * frac), 0.05, 0.012],
    );
    bar.fill.primitives[0].baseColor = bv.color;
  }
  for (const [b, bar] of st.bars) {
    if (!barShown.has(b)) {
      bar.bg.visible = false;
      bar.fill.visible = false;
    }
  }
}

/** `SimSystem` for integrity, firing, contacts, zones, and spawners. */
export const hitZonesSystem: SimSystem = {
  name: 'hit-zones',
  priority: 30,
  step(world: SimWorld, dt: number): void {
    const st = stateOf(world);
    const mode = resolveHitMode(world);
    if (mode === 'projectile' || mode === 'hitscan') {
      if (!world.character) {
        ensureSimInput(world, false, false);
        updateSimInput(world);
      }
      if (world.input.fireQueued) {
        world.input.fireQueued = false;
        fire(world, mode, null);
      }
    } else {
      world.input.fireQueued = false;
    }
    stepShots(world, st, dt);
    stepContacts(world);
    stepSpawners(world, st, dt);
    stepZones(world, st);
  },
  sync(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as HitState | undefined;
    if (st) syncVisuals(world, st);
  },
  select(world: SimWorld, body: SimBody | null, point: Vec3 | null): boolean {
    const mode = resolveHitMode(world);
    if (mode === 'projectile' && point) {
      fire(world, mode, point);
      return false;
    }
    if (mode !== 'hitscan' || !body?.traits.integrity) return false;
    const st = stateOf(world);
    const rate = clampNum(world.numAttr('fire-rate'), 0.1, 30, 4);
    if (world.timeMs - st.lastFireMs < 1000 / rate) return true;
    st.lastFireMs = world.timeMs;
    const src =
      world.character && !world.character.hidden ? world.character : null;
    const group = src ? groupOf(world, src) : 'user';
    if (canTarget(body, group, src)) {
      applyHit(
        world,
        body,
        clampNum(world.numAttr('hit-amount'), 0, 1e6, 25),
        src,
        point,
      );
    }
    return true;
  },
  reset(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as HitState | undefined;
    if (!st) return;
    for (const p of [...st.shots, ...st.frags]) p.active = false;
    for (const b of st.flashes.keys()) tint(b, false);
    st.flashes.clear();
    st.zones.clear();
    st.spawners.clear();
    st.despawn.clear();
    for (const b of [...st.bars.keys()]) {
      if (!world.bodies.includes(b)) removeBar(world, st, b);
    }
    st.lastFireMs = -Infinity;
  },
  dispose(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as HitState | undefined;
    disposeSimInput(world);
    if (!st) return;
    for (const b of st.flashes.keys()) tint(b, false);
    for (const p of [...st.shots, ...st.frags]) {
      removeDynamicMesh(world.viewer, p.mesh);
    }
    for (const m of st.outlines.values()) removeDynamicMesh(world.viewer, m);
    for (const b of [...st.bars.keys()]) removeBar(world, st, b);
    world.state.delete(STATE_KEY);
  },
};

registerSimSystem(hitZonesSystem);
