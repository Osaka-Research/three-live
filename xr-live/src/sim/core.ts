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
 * @fileoverview Shared runtime for the optional `xr-live-sim` plugins.
 *
 * A {@link SimWorld} is built per viewer from glTF nodes whose `extras.xr`
 * carries sim traits. Each such node becomes a {@link SimBody} that owns the
 * meshes of its subtree (a mesh belongs to its nearest ancestor body). Systems
 * (character-controller, steering-agents, hit-zones, objectives) step at a
 * fixed 60 Hz and move bodies by position and yaw; the core then writes
 * `delta * base` into each owned mesh transform, so authored animation on
 * child meshes keeps playing underneath the simulated motion.
 *
 * Conventions shared with the Android and iOS / visionOS runtimes:
 * - Positions are scene-local (before the viewer's model-root matrix).
 * - Yaw rotates about +Y; a body faces local +Z (the glTF / Three.js object
 *   convention) when its yaw delta is 0.
 */

import {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Multiply,
  resolveNodeWorldMatrices,
} from '../../../three-live/src/math';
import {
  registerPlugin,
  type ThreeLivePlugin,
} from '../../../three-live/src/plugin';
import {
  normalizeSimTraits,
  registerSimTraitSchema,
} from '../../../three-live/src/xr-sim-schema';
import type {NormalizedXRTraits} from '../../../three-live/src/xr-trait-schema';
import {
  computeLocalBounds,
  emitPluginEvent,
  horizontalForward,
  inverseRootMatrix,
  isXRFrameFresh,
  resolveHeadPose,
  transformPoint,
  vNorm,
  type PluginViewer,
  type Vec3,
} from '../plugins/common';

registerSimTraitSchema();

/** Fixed simulation step (seconds). */
export const SIM_STEP = 1 / 60;
/** Maximum fixed steps per rendered frame (prevents spiral of death). */
export const SIM_MAX_SUBSTEPS = 5;
/** Maximum spawned instances alive at once across all spawners in a world. */
export const SIM_MAX_INSTANCES = 128;

/** Returns normalized sim traits when `raw` carries at least one. */
export const simTraitsOf = normalizeSimTraits;

/** One simulated object: a glTF node (or standalone mesh) and its meshes. */
export interface SimBody {
  /** Unique within a world: `node:<i>`, `mesh:<i>`, or `spawn:<n>`. */
  readonly key: string;
  readonly name: string;
  readonly traits: NormalizedXRTraits;
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  readonly meshes: any[];
  /** Scene-local origin when the world was built. */
  readonly initPos: Vec3;
  pos: Vec3;
  /** Yaw delta (radians) applied about the body origin. */
  yaw: number;
  /** 3D rotation delta quaternion `[x, y, z, w]` applied about the body origin (for non-Y joints). */
  rot: [number, number, number, number];
  vel: Vec3;
  hidden: boolean;
  /** AABB center offset from `pos` (yaw 0), in meters. */
  readonly center: Vec3;
  /** AABB half extents, in meters. */
  readonly half: Vec3;
  /** Bounding sphere radius around the AABB center, in meters. */
  readonly radius: number;
  /** Referenced by a spawner: hidden and skipped by every system. */
  isTemplate: boolean;
  /** Key of the spawner that created this instance. */
  spawnedFrom?: string;
  /** Live integrity value (when the body has an `integrity` trait). */
  integrity: number;
  /** World time (ms) of the last accepted hit. */
  lastHitMs: number;
  /** Per-system scratch state. */
  readonly data: Record<string, unknown>;
}

/** Plain event detail plus the bodies involved (internal bus only). */
export interface SimEventRefs {
  readonly body?: SimBody;
  readonly other?: SimBody;
}

type SimListener = (
  detail: Record<string, unknown>,
  refs: SimEventRefs,
) => void;

/** A simulation system stepped by the shared fixed-step driver. */
export interface SimSystem {
  readonly name: string;
  /** Lower runs first within each fixed step. */
  readonly priority: number;
  step?(world: SimWorld, dt: number): void;
  /** Runs once per rendered frame after transforms are applied. */
  sync?(world: SimWorld): void;
  /** Handles a tap / XR select on a body; return true to consume it. */
  select?(world: SimWorld, body: SimBody | null, point: Vec3 | null): boolean;
  /** Restores per-world state for {@link resetSimScenario}. */
  reset?(world: SimWorld): void;
  /** Frees GPU meshes, DOM overlays, and listeners for a world. */
  dispose?(world: SimWorld): void;
}

const systems: SimSystem[] = [];

/** Registers a system and the shared driver plugin. Idempotent by name. */
export function registerSimSystem(system: SimSystem): void {
  if (!systems.some((s) => s.name === system.name)) {
    systems.push(system);
    systems.sort((a, b) => a.priority - b.priority);
  }
  registerPlugin(simCorePlugin);
}

/** Registered systems in step order. */
export function getSimSystems(): readonly SimSystem[] {
  return systems;
}

interface MeshState {
  base: Float32Array;
  written: Float32Array;
  /** Last visibility the sim wrote (other plugins may toggle it between). */
  visible?: boolean;
}
// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
const meshStates = new WeakMap<any, MeshState>();

function sameMatrix(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Rotates `v` about +Y by `yaw` radians. */
export function rotateY(v: readonly number[], yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}

/** Wraps an angle into `(-PI, PI]`. */
export function wrapAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x <= -Math.PI) x += Math.PI * 2;
  return x;
}

/** Moves `from` toward `to` by at most `maxStep` radians along the short arc. */
export function turnToward(from: number, to: number, maxStep: number): number {
  const d = wrapAngle(to - from);
  return wrapAngle(from + Math.max(-maxStep, Math.min(maxStep, d)));
}

/** Yaw that points local +Z along XZ direction `dir`. */
export function yawFromDir(dir: readonly number[]): number {
  return Math.atan2(dir[0], dir[2]);
}

/** World-space (scene-local) AABB center of a body. */
export function bodyCenter(b: SimBody): Vec3 {
  const c = rotateY(b.center, b.yaw);
  return [b.pos[0] + c[0], b.pos[1] + c[1], b.pos[2] + c[2]];
}

/** Scene-local AABB `[min, max]` of a body (yaw ignored for extents). */
export function bodyAABB(b: SimBody): [Vec3, Vec3] {
  const c = bodyCenter(b);
  return [
    [c[0] - b.half[0], c[1] - b.half[1], c[2] - b.half[2]],
    [c[0] + b.half[0], c[1] + b.half[1], c[2] + b.half[2]],
  ];
}

/**
 * Pushes a vertical cylinder (center `p` on XZ, `radius`) out of an AABB on the
 * XZ plane. Returns the corrected XZ position, or `null` when not overlapping.
 */
export function pushCircleOutOfAABB(
  p: readonly number[],
  radius: number,
  min: readonly number[],
  max: readonly number[],
): [number, number] | null {
  const cx = Math.max(min[0], Math.min(max[0], p[0]));
  const cz = Math.max(min[2], Math.min(max[2], p[2]));
  const dx = p[0] - cx;
  const dz = p[2] - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    return [cx + (dx / d) * radius, cz + (dz / d) * radius];
  }
  // Center inside the box: exit through the nearest face.
  const exits: Array<[number, number, number]> = [
    [p[0] - min[0], min[0] - radius, p[2]],
    [max[0] - p[0], max[0] + radius, p[2]],
    [p[2] - min[2], p[0], min[2] - radius],
    [max[2] - p[2], p[0], max[2] + radius],
  ];
  let best = exits[0];
  for (const e of exits) if (e[0] < best[0]) best = e;
  return [best[1], best[2]];
}

/**
 * Returns the smallest `t` in `[0, 1]` where segment `a -> b` enters the
 * sphere, or `null` when it misses.
 */
export function intersectSegmentSphere(
  a: readonly number[],
  b: readonly number[],
  center: readonly number[],
  radius: number,
): number | null {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const f: Vec3 = [a[0] - center[0], a[1] - center[1], a[2] - center[2]];
  const aa = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const c = f[0] * f[0] + f[1] * f[1] + f[2] * f[2] - radius * radius;
  if (c <= 0) return 0;
  if (aa < 1e-12) return null;
  const bb = 2 * (f[0] * d[0] + f[1] * d[1] + f[2] * d[2]);
  const disc = bb * bb - 4 * aa * c;
  if (disc < 0) return null;
  const t = (-bb - Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Returns the smallest `t` in `[0, 1]` where segment `a -> b` enters the AABB,
 * or `null` when it misses (slab method).
 */
export function intersectSegmentAABB(
  a: readonly number[],
  b: readonly number[],
  min: readonly number[],
  max: readonly number[],
): number | null {
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    const d = b[i] - a[i];
    if (Math.abs(d) < 1e-12) {
      if (a[i] < min[i] || a[i] > max[i]) return null;
      continue;
    }
    let ta = (min[i] - a[i]) / d;
    let tb = (max[i] - a[i]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  return t0;
}

/** Deterministic 32-bit PRNG (mulberry32) returning values in `[0, 1)`. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, for per-body deterministic seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Keyboard, gamepad, and touch input merged for one element. */
export interface SimInputState {
  /** Strafe axis, `-1` (left) to `1` (right). */
  x: number;
  /** Forward axis, `-1` (back) to `1` (forward). */
  z: number;
  sprint: boolean;
  /** Edge-triggered; consumed by the character controller. */
  jumpQueued: boolean;
  /** Edge-triggered; consumed by hit-zones. */
  fireQueued: boolean;
}

/** Per-viewer simulation state. */
export class SimWorld {
  bodies: SimBody[] = [];
  /** First body per name (spawned instances are `Name#n`). */
  readonly byName = new Map<string, SimBody>();
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  readonly ownerOf = new Map<any, SimBody>();
  /** Simulated milliseconds since the last build or reset. */
  timeMs = 0;
  accumulator = 0;
  /** Set by objectives when the scenario ends; freezes stepping. */
  ended = false;
  /** Scene-local floor fallback (min Y of the scene bounds). */
  floorY = 0;
  /** Controlled character, when character-controller is active. */
  character: SimBody | null = null;
  readonly input: SimInputState = {
    x: 0,
    z: 0,
    sprint: false,
    jumpQueued: false,
    fireQueued: false,
  };
  /** Per-system per-world state. */
  readonly state = new Map<string, unknown>();
  // tslint:disable-next-line:no-any The glTF JSON this world was built from.
  gltf: any = undefined;
  spawnCounter = 0;
  readonly rng = makeRng(0x5eed);
  private readonly listeners = new Map<string, Set<SimListener>>();

  constructor(readonly viewer: PluginViewer) {}

  /** Host `<xr-live>` / `<three-live>` element, when attached to the DOM. */
  // tslint:disable-next-line:no-any Host element.
  get element(): any {
    return this.viewer.container;
  }

  /** Reads a host attribute, or `null` when absent. */
  attr(name: string): string | null {
    const el = this.element;
    return typeof el?.getAttribute === 'function'
      ? el.getAttribute(name)
      : null;
  }

  /** Reads a finite numeric attribute, or `undefined`. */
  numAttr(name: string): number | undefined {
    const raw = this.attr(name);
    if (raw === null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  /** True while an immersive WebXR session drives this viewer. */
  get xrActive(): boolean {
    return Boolean(this.viewer.xrSessionActive) || isXRFrameFresh(this.viewer);
  }

  /** Scene-local head (camera) position. */
  headPosition(): Vec3 {
    return transformPoint(
      inverseRootMatrix(this.viewer),
      resolveHeadPose(this.viewer).position,
    );
  }

  /** Scene-local horizontal camera forward (unit XZ vector). */
  cameraForwardXZ(): Vec3 {
    const f = horizontalForward(resolveHeadPose(this.viewer).quaternion);
    const inv = inverseRootMatrix(this.viewer);
    const d: Vec3 = [
      inv[0] * f[0] + inv[8] * f[2],
      0,
      inv[2] * f[0] + inv[10] * f[2],
    ];
    return vNorm(d, [0, 0, -1]);
  }

  /** Scene-local 3D camera forward (unit vector). */
  cameraForward(): Vec3 {
    const m = resolveHeadPose(this.viewer).matrix;
    const inv = inverseRootMatrix(this.viewer);
    const f = [-m[8], -m[9], -m[10]];
    return vNorm(
      [
        inv[0] * f[0] + inv[4] * f[1] + inv[8] * f[2],
        inv[1] * f[0] + inv[5] * f[1] + inv[9] * f[2],
        inv[2] * f[0] + inv[6] * f[1] + inv[10] * f[2],
      ],
      [0, 0, -1],
    );
  }

  /**
   * Position the `'user'` agent target resolves to: the controlled character,
   * else the head (camera).
   */
  userPosition(): Vec3 {
    return this.character && !this.character.hidden
      ? [...this.character.pos]
      : this.headPosition();
  }

  /** Bodies that systems should step (not templates). */
  active(): SimBody[] {
    return this.bodies.filter((b) => !b.isTemplate);
  }

  /** Subscribes to an internal event; returns an unsubscribe function. */
  on(name: string, fn: SimListener): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Dispatches `name` on the host element and the internal bus. */
  emit(
    name: string,
    detail: Record<string, unknown>,
    refs: SimEventRefs = {},
  ): void {
    for (const fn of [...(this.listeners.get(name) ?? [])]) {
      try {
        fn(detail, refs);
      } catch {
        // One faulty listener must not stop the simulation.
      }
    }
    emitPluginEvent(this.element, name, detail);
  }

  /** Adds a body and indexes its meshes. */
  addBody(b: SimBody): void {
    this.bodies.push(b);
    if (!this.byName.has(b.name)) this.byName.set(b.name, b);
    for (const m of b.meshes) this.ownerOf.set(m, b);
  }

  /** Removes a body (and, for spawned instances, its cloned meshes). */
  removeBody(b: SimBody): void {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    if (this.byName.get(b.name) === b) this.byName.delete(b.name);
    for (const m of b.meshes) {
      this.ownerOf.delete(m);
      if (b.spawnedFrom !== undefined) {
        const list = this.viewer.meshes;
        const j = Array.isArray(list) ? list.indexOf(m) : -1;
        // Clones share GPU buffers with their template; only detach them.
        if (j >= 0) list!.splice(j, 1);
      }
    }
    if (this.character === b) this.character = null;
  }
}

/** Creates a body record with derived bounds. */
export function makeBody(
  key: string,
  name: string,
  traits: NormalizedXRTraits,
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  meshes: any[],
  initPos: Vec3,
): SimBody {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    const lb = computeLocalBounds(m);
    const t = meshStates.get(m)?.base ?? m.transform;
    for (let i = 0; i < 8; i++) {
      const p = transformPoint(t, [
        i & 1 ? lb.max[0] : lb.min[0],
        i & 2 ? lb.max[1] : lb.min[1],
        i & 4 ? lb.max[2] : lb.min[2],
      ]);
      for (let a = 0; a < 3; a++) {
        if (p[a] < min[a]) min[a] = p[a];
        if (p[a] > max[a]) max[a] = p[a];
      }
    }
  }
  const has = Number.isFinite(min[0]);
  const center: Vec3 = has
    ? [
        (min[0] + max[0]) / 2 - initPos[0],
        (min[1] + max[1]) / 2 - initPos[1],
        (min[2] + max[2]) / 2 - initPos[2],
      ]
    : [0, 0, 0];
  const half: Vec3 = has
    ? [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2]
    : [0, 0, 0];
  return {
    key,
    name,
    traits,
    meshes,
    initPos: [...initPos],
    pos: [...initPos],
    yaw: 0,
    rot: [0, 0, 0, 1],
    vel: [0, 0, 0],
    hidden: false,
    center,
    half,
    radius: Math.hypot(half[0], half[1], half[2]),
    isTemplate: false,
    integrity: traits.integrity?.current ?? 0,
    lastHitMs: -Infinity,
    data: {},
  };
}

/** Rebuilds a world's bodies from the viewer's current glTF and meshes. */
export function buildSimWorld(world: SimWorld): void {
  const viewer = world.viewer;
  // tslint:disable-next-line:no-any glTF JSON.
  const gltf: any = (viewer as any).gltf;
  world.gltf = gltf;
  world.bodies = [];
  world.byName.clear();
  world.ownerOf.clear();
  world.character = null;
  world.timeMs = 0;
  world.accumulator = 0;
  world.ended = false;
  world.spawnCounter = 0;
  // tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
  const meshes: any[] = Array.isArray(viewer.meshes) ? viewer.meshes : [];
  // tslint:disable-next-line:no-any glTF node JSON.
  const nodes: any[] = Array.isArray(gltf?.nodes) ? gltf.nodes : [];
  // tslint:disable-next-line:no-any Bounds on ThreeView.
  const bounds = (viewer as any).bounds;
  world.floorY = Number.isFinite(bounds?.min?.[1]) ? bounds.min[1] : 0;

  const parent = new Int32Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => {
    for (const c of Array.isArray(n?.children) ? n.children : []) {
      if (Number.isInteger(c) && c >= 0 && c < nodes.length && c !== i) {
        parent[c] = i;
      }
    }
  });
  const nodeTraits = nodes.map((n) => simTraitsOf(n?.extras?.xr));
  let worldMats: Float32Array[] = [];
  if (nodeTraits.some((t) => t)) {
    try {
      worldMats = resolveNodeWorldMatrices(gltf);
    } catch {
      worldMats = [];
    }
  }
  const nodeBodies = new Map<number, SimBody>();
  const ownerMeshes = new Map<number, unknown[]>();
  const owned = new Set<unknown>();
  for (const m of meshes) {
    if (!m || m.isPluginMesh || !(m.transform instanceof Float32Array))
      continue;
    let i = typeof m.nodeIndex === 'number' ? m.nodeIndex : -1;
    for (let depth = 0; i >= 0 && i < nodes.length && depth < 256; depth++) {
      if (nodeTraits[i]) {
        const list = ownerMeshes.get(i) ?? [];
        list.push(m);
        ownerMeshes.set(i, list);
        owned.add(m);
        break;
      }
      i = parent[i];
    }
  }
  nodeTraits.forEach((traits, i) => {
    if (!traits) return;
    const wm = worldMats[i];
    const initPos: Vec3 = wm ? [wm[12], wm[13], wm[14]] : [0, 0, 0];
    const body = makeBody(
      `node:${i}`,
      String(nodes[i]?.name || `Node_${i}`),
      traits,
      ownerMeshes.get(i) ?? [],
      initPos,
    );
    nodeBodies.set(i, body);
    world.addBody(body);
  });
  // Standalone meshes (no glTF node) carrying sim traits.
  meshes.forEach((m, i) => {
    if (!m || owned.has(m) || m.isPluginMesh) return;
    if (!(m.transform instanceof Float32Array)) return;
    const raw = m.userData?.xr ?? m.extras?.xr;
    const traits =
      typeof m.nodeIndex === 'number' && m.nodeIndex >= 0
        ? null
        : simTraitsOf(raw);
    if (!traits) return;
    const t = m.transform;
    world.addBody(
      makeBody(
        `mesh:${i}`,
        String(m.name || `Mesh_${i}`),
        traits,
        [m],
        [t[12], t[13], t[14]],
      ),
    );
  });
  // Nodes referenced by another node's spawner are templates: hidden and
  // excluded from simulation (including their own spawner trait).
  for (const b of world.bodies) {
    if (
      world.bodies.some((s) => s !== b && s.traits.spawner?.template === b.name)
    ) {
      b.isTemplate = true;
      b.hidden = true;
    }
  }
  for (const b of world.bodies) {
    for (const m of b.meshes) m.visible = !b.hidden;
  }
}

/** Writes each body's pose into its meshes (`delta * base`). */
export function applySimBodies(world: SimWorld): void {
  const delta = mat4Create();
  for (const b of world.bodies) {
    if (b.meshes.length === 0) continue;
    const identityRot =
      b.rot[0] === 0 && b.rot[1] === 0 && b.rot[2] === 0 && b.rot[3] === 1;
    const identity =
      b.yaw === 0 &&
      identityRot &&
      b.pos[0] === b.initPos[0] &&
      b.pos[1] === b.initPos[1] &&
      b.pos[2] === b.initPos[2];
    if (!identity) {
      let q: [number, number, number, number] = [
        0,
        Math.sin(b.yaw / 2),
        0,
        Math.cos(b.yaw / 2),
      ];
      let r: Vec3;
      if (identityRot) {
        r = rotateY(b.initPos, b.yaw);
      } else {
        const [ax, ay, az, aw] = b.rot;
        const [, by, , bw] = q;
        q = [
          aw * 0 + ax * bw + ay * 0 - az * by,
          aw * by + ay * bw,
          ax * by + az * bw,
          aw * bw - ay * by,
        ];
        const [qx, qy, qz, qw] = q;
        const [vx, vy, vz] = b.initPos;
        const tx = 2 * (qy * vz - qz * vy);
        const ty = 2 * (qz * vx - qx * vz);
        const tz = 2 * (qx * vy - qy * vx);
        r = [
          vx + qw * tx + (qy * tz - qz * ty),
          vy + qw * ty + (qz * tx - qx * tz),
          vz + qw * tz + (qx * ty - qy * tx),
        ];
      }
      mat4FromRotationTranslationScale(
        delta,
        q,
        [b.pos[0] - r[0], b.pos[1] - r[1], b.pos[2] - r[2]],
        [1, 1, 1],
      );
    }
    for (const m of b.meshes) {
      if (!(m.transform instanceof Float32Array)) continue;
      let st = meshStates.get(m);
      if (!st) {
        st = {
          base: new Float32Array(m.transform),
          written: new Float32Array(16),
        };
        meshStates.set(m, st);
      } else if (!sameMatrix(m.transform, st.written)) {
        // Something else (an animation clip) rewrote the transform: rebase.
        st.base.set(m.transform);
      }
      if (identity) m.transform.set(st.base);
      else mat4Multiply(m.transform, delta, st.base);
      st.written.set(m.transform);
      if (m.normalMatrix) mat3NormalFromMat4(m.normalMatrix, m.transform);
      const visible = !b.hidden && b.data['viewHidden'] !== true;
      if (st.visible !== visible) {
        m.visible = visible;
        st.visible = visible;
      }
    }
  }
}

/** Returns the authored (pre-simulation) transform of a mesh. */
// tslint:disable-next-line:no-any Mesh records are heterogeneous GPU structs.
export function baseTransformOf(m: any): Float32Array {
  return meshStates.get(m)?.base ?? m.transform;
}

const worlds = new WeakMap<object, SimWorld>();

/** Returns (creating on first use) the world for a viewer. */
export function getSimWorld(viewer: PluginViewer): SimWorld {
  let w = worlds.get(viewer);
  if (!w) {
    w = new SimWorld(viewer);
    worlds.set(viewer, w);
  }
  return w;
}

function disposeWorld(viewer: PluginViewer | undefined): void {
  const w = viewer ? worlds.get(viewer) : undefined;
  if (!w) return;
  for (const s of systems) {
    try {
      s.dispose?.(w);
    } catch {
      // Keep disposing the remaining systems.
    }
  }
  w.state.clear();
  worlds.delete(viewer!);
}

/**
 * Advances a world by `dt` seconds of real time using fixed steps, then applies
 * body transforms and runs per-frame sync. Exposed for tests and native-parity
 * fixtures.
 */
export function stepSimWorld(world: SimWorld, dt: number): void {
  // tslint:disable-next-line:no-any glTF JSON.
  if (world.gltf !== (world.viewer as any).gltf) {
    for (const s of systems) s.dispose?.(world);
    world.state.clear();
    buildSimWorld(world);
  }
  if (world.bodies.length === 0) return;
  const frameDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;
  world.accumulator = Math.min(
    world.accumulator + frameDt,
    SIM_STEP * SIM_MAX_SUBSTEPS,
  );
  while (world.accumulator >= SIM_STEP - 1e-9) {
    world.accumulator -= SIM_STEP;
    if (world.ended) continue;
    world.timeMs += SIM_STEP * 1000;
    for (const s of systems) {
      try {
        s.step?.(world, SIM_STEP);
      } catch {
        // A failing system must not break rendering or other systems.
      }
    }
  }
  applySimBodies(world);
  for (const s of systems) {
    try {
      s.sync?.(world);
    } catch {
      // Visual sync is best effort.
    }
  }
}

/**
 * Restores every body to its authored state, removes spawned instances, and
 * restarts the scenario timer. Accepts the host element or its viewer.
 */
// tslint:disable-next-line:no-any Host element or viewer.
export function resetSimScenario(target: any): void {
  const viewer: PluginViewer | undefined =
    target?.viewer ?? target?._view ?? target;
  const w = viewer ? worlds.get(viewer) : undefined;
  if (!w) return;
  for (const b of [...w.bodies]) {
    if (b.spawnedFrom !== undefined) {
      w.removeBody(b);
      continue;
    }
    b.pos = [...b.initPos];
    b.yaw = 0;
    b.rot = [0, 0, 0, 1];
    b.vel = [0, 0, 0];
    b.hidden = b.isTemplate;
    b.integrity = b.traits.integrity?.current ?? 0;
    b.lastHitMs = -Infinity;
    for (const k of Object.keys(b.data)) delete b.data[k];
  }
  w.timeMs = 0;
  w.accumulator = 0;
  w.ended = false;
  w.input.jumpQueued = false;
  w.input.fireQueued = false;
  for (const s of systems) s.reset?.(w);
  applySimBodies(w);
}

/** Shared driver: builds worlds, steps systems, and routes selections. */
export const simCorePlugin: ThreeLivePlugin = {
  name: 'xr-live-sim-core',
  onUpdate(viewer: PluginViewer, dt: number): void {
    if (!viewer || systems.length === 0) return;
    stepSimWorld(getSimWorld(viewer), dt);
  },
  // tslint:disable-next-line:no-any Hit detail from ThreeView.
  onMeshSelect(viewer: PluginViewer, hit: any): void {
    const w = viewer ? worlds.get(viewer) : undefined;
    if (!w || w.ended || w.bodies.length === 0) return;
    const mesh =
      typeof hit?.meshIndex === 'number'
        ? viewer.meshes?.[hit.meshIndex]
        : null;
    const body = mesh ? (w.ownerOf.get(mesh) ?? null) : null;
    const hp = hit?.hitPoint;
    const point =
      Array.isArray(hp) && hp.length >= 3 && hp.every(Number.isFinite)
        ? transformPoint(inverseRootMatrix(viewer), hp)
        : null;
    if (body?.isTemplate || body?.hidden) return;
    for (const s of systems) {
      if (s.select?.(w, body, point)) break;
    }
  },
  // tslint:disable-next-line:no-any Host element.
  onElementDisconnected(element: any): void {
    disposeWorld(element?.viewer ?? element?._view);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    disposeWorld(viewer);
  },
};
