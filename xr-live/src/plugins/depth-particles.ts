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
 * @fileoverview Spatial `depth-particles` plugin for `<xr-live>`.
 *
 * Any mesh tagged with `userData.xr.particles` becomes an emitter volume:
 *
 * ```js
 * cloud.userData.xr = {particles: {preset: 'rain', count: 600, area: [2, 2, 2]}};
 * ```
 *
 * Particles fall/burst inside the volume and collide with the simulated floor
 * and, when `xr-depth` is active, with real-world surfaces sampled from the
 * WebXR depth buffer; collided particles respawn at the top of the volume.
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  MAX_PARTICLES_PER_EMITTER,
  type ParticleOptions,
  type ParticlePreset,
  parseParticles,
} from '../../../three-live/src/xr-trait-schema';
import {extractPosition, getMeshXRTraits} from '../xr-traits';
import {mat4Create, mat4Invert, mat4Multiply} from '../../../three-live/src/math';
import {
  cacheXRFrame,
  clampNum,
  createDynamicMesh,
  isXRFrameFresh,
  type PluginViewer,
  refreshDynamicPositions,
  removeDynamicMesh,
  resolveHeadPose,
  resolveProjection,
  rootMatrix,
  type Vec3,
} from './common';

const scratch: Vec3 = [0, 0, 0];

export {MAX_PARTICLES_PER_EMITTER, parseParticles};
export type {ParticleOptions, ParticlePreset};

/** Hard cap on simultaneously simulated emitters per viewer. */
export const MAX_EMITTERS = 8;

const VERTS_PER_PARTICLE = 8;

const PRESETS: Record<ParticlePreset, {color: [number, number, number, number]; size: Vec3}> = {
  rain: {color: [0.7, 0.8, 1.0, 0.6], size: [0.002, 0.04, 0.002]},
  snow: {color: [1, 1, 1, 0.9], size: [0.01, 0.01, 0.01]},
  sparks: {color: [1.0, 0.7, 0.2, 1], size: [0.004, 0.004, 0.004]},
  confetti: {color: [1, 0.4, 0.7, 1], size: [0.012, 0.012, 0.002]},
};

/** Small deterministic PRNG (mulberry32) so simulations are reproducible. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Samples real-world view depth (meters along -Z) at viewport `(u, v)`. */
export type ParticleDepthSampler = (u: number, v: number) => number | null;

/** Camera inputs used for depth collision. */
export interface DepthCamera {
  readonly view: ArrayLike<number>;
  readonly proj: ArrayLike<number>;
  readonly sample: ParticleDepthSampler;
}

/**
 * Returns true when world point `p` lies at or behind the real-world surface
 * seen at its projected pixel (with a 2 cm tolerance).
 */
export function isOccludedByDepth(p: readonly number[], cam: DepthCamera): boolean {
  const m = cam.view;
  const vx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const vy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const vz = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const viewDepth = -vz;
  if (viewDepth <= 0.05) return false;
  const P = cam.proj;
  const ndcX = (P[0] * vx + P[8] * vz) / viewDepth;
  const ndcY = (P[5] * vy + P[9] * vz) / viewDepth;
  if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) return false;
  const real = cam.sample((ndcX + 1) * 0.5, (1 - ndcY) * 0.5);
  return typeof real === 'number' && Number.isFinite(real) && real > 0.05 && viewDepth >= real - 0.02;
}

/** CPU particle state for one emitter volume. */
export class ParticleEmitter {
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly options: ParticleOptions;
  collisions = 0;
  private readonly rng: () => number;
  private center: Vec3 = [0, 0, 0];
  private frame = 0;

  constructor(options: ParticleOptions, seed = 1) {
    this.options = options;
    this.rng = createRng(seed);
    this.positions = new Float32Array(options.count * 3);
    this.velocities = new Float32Array(options.count * 3);
  }

  /** Re-seeds every particle uniformly inside the volume around `center`. */
  reset(center: readonly number[]): void {
    this.center = [center[0], center[1], center[2]];
    for (let i = 0; i < this.options.count; i++) this.respawn(i, true);
  }

  private respawn(i: number, anywhere: boolean): void {
    const [w, h, d] = this.options.area;
    const [cx, cy, cz] = this.center;
    const r = this.rng;
    const o = i * 3;
    const sp = this.options.speed;
    const burst = this.options.preset === 'sparks';
    this.positions[o] = burst ? cx : cx + (r() - 0.5) * w;
    this.positions[o + 1] = burst ? cy : anywhere ? cy + (r() - 0.5) * h : cy + h * 0.5;
    this.positions[o + 2] = burst ? cz : cz + (r() - 0.5) * d;
    switch (this.options.preset) {
      case 'rain':
        this.velocities.set([0, -4 * sp, 0], o);
        break;
      case 'snow':
        this.velocities.set([(r() - 0.5) * 0.2, -0.5 * sp, (r() - 0.5) * 0.2], o);
        break;
      case 'sparks': {
        const a = r() * Math.PI * 2;
        const up = 1.5 + r() * 1.5;
        this.velocities.set([Math.cos(a) * sp, up * sp, Math.sin(a) * sp], o);
        break;
      }
      case 'confetti':
        this.velocities.set([(r() - 0.5) * sp, (0.5 + r()) * sp, (r() - 0.5) * sp], o);
        break;
      default: {
        const unreachable: never = this.options.preset;
        throw new Error(`Unknown particle preset ${unreachable}`);
      }
    }
  }

  /**
   * Advances the simulation. `center` moves the volume with its mesh; when
   * provided, `floorY` and `depth` collide particles with real geometry.
   */
  step(dt: number, center: readonly number[], floorY?: number, depth?: DepthCamera): void {
    const step = clampNum(dt, 0, 0.1, 1 / 60);
    this.center = [center[0], center[1], center[2]];
    const preset = this.options.preset;
    const gravity = preset === 'sparks' || preset === 'confetti' ? -9.8 * 0.4 : 0;
    // Every particle uses the same frame-scaled drag coefficient.
    const drag = preset === 'confetti' ? Math.pow(0.9, step * 60) : 1;
    const [w, h, d] = this.options.area;
    const bottom = Math.max(this.center[1] - h * 0.5, floorY ?? -Infinity);
    const p = this.positions;
    const v = this.velocities;
    // Depth tests are amortized: each particle is checked every 4th frame.
    const phase = this.frame++ & 3;
    for (let i = 0; i < this.options.count; i++) {
      const o = i * 3;
      v[o + 1] += gravity * step;
      if (drag !== 1) {
        v[o] *= drag;
        v[o + 2] *= drag;
      }
      if (preset === 'snow') v[o] += Math.sin((p[o + 1] + i) * 3) * 0.02 * step;
      p[o] += v[o] * step;
      p[o + 1] += v[o + 1] * step;
      p[o + 2] += v[o + 2] * step;
      const outside =
        Math.abs(p[o] - this.center[0]) > w * 0.5 + 0.5 ||
        Math.abs(p[o + 2] - this.center[2]) > d * 0.5 + 0.5;
      const hitFloor = p[o + 1] <= bottom;
      let hitDepth = false;
      if (!hitFloor && depth !== undefined && (i & 3) === phase) {
        scratch[0] = p[o];
        scratch[1] = p[o + 1];
        scratch[2] = p[o + 2];
        hitDepth = isOccludedByDepth(scratch, depth);
      }
      if (hitFloor || hitDepth || outside) {
        if (hitFloor || hitDepth) this.collisions++;
        this.respawn(i, false);
      }
    }
  }

  /** Writes particle cross-quads (8 verts each) into `out` (model space). */
  writeVertices(out: Float32Array): void {
    writeParticleVertices(out, this.positions, this.options.count, PRESETS[this.options.preset].size);
  }
}

/** Shared cross-quad writer for simulated centers and the static origin template. */
function writeParticleVertices(out: Float32Array, p: ArrayLike<number>, count: number, size: Vec3): void {
    const [sx, sy, sz] = size;
    const dz = sz + sx;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      let b = i * VERTS_PER_PARTICLE * 3;
      const x = p[o];
      const y = p[o + 1];
      const z = p[o + 2];
      // Quad in the XY plane, then quad in the ZY plane (no allocation).
      out[b++] = x - sx; out[b++] = y - sy; out[b++] = z;
      out[b++] = x + sx; out[b++] = y - sy; out[b++] = z;
      out[b++] = x + sx; out[b++] = y + sy; out[b++] = z;
      out[b++] = x - sx; out[b++] = y + sy; out[b++] = z;
      out[b++] = x; out[b++] = y - sy; out[b++] = z - dz;
      out[b++] = x; out[b++] = y - sy; out[b++] = z + dz;
      out[b++] = x; out[b++] = y + sy; out[b++] = z + dz;
      out[b++] = x; out[b++] = y + sy; out[b++] = z - dz;
    }
}

/** Builds the static index/normal buffers for `count` particle cross-quads. */
export function buildParticleTopology(count: number): {normals: Float32Array; indices: Uint16Array} {
  const normals = new Float32Array(count * VERTS_PER_PARTICLE * 3);
  const indices = new Uint16Array(count * 12);
  for (let i = 0; i < count; i++) {
    const v = i * VERTS_PER_PARTICLE;
    // Typed arrays start at zero; write only each plane's unit normal axis.
    for (let k = 0; k < 4; k++) {
      normals[(v + k) * 3 + 2] = 1;
      normals[(v + k + 4) * 3] = 1;
    }
    indices.set([v, v + 1, v + 2, v, v + 2, v + 3, v + 4, v + 5, v + 6, v + 4, v + 6, v + 7], i * 12);
  }
  return {normals, indices};
}

interface EmitterEntry {
  emitter: ParticleEmitter;
  // tslint:disable-next-line:no-any GPU mesh struct.
  mesh: any;
  key: string;
}

/** Simulates and renders every particle emitter for one viewer. */
export class XRDepthParticlesController {
  private readonly entries = new Map<object, EmitterEntry>();

  /** Number of live emitters. */
  get emitterCount(): number {
    return this.entries.size;
  }

  /** Returns the emitter for `mesh`, if any (for inspection and tests). */
  emitterFor(mesh: object): ParticleEmitter | undefined {
    return this.entries.get(mesh)?.emitter;
  }

  /** Steps all emitters and syncs their GPU geometry. */
  update(viewer: PluginViewer, dt: number, floorY?: number, depth?: DepthCamera): void {
    const meshes = viewer.meshes ?? [];
    const live = new Set<object>();
    for (const mesh of [...meshes]) {
      if (live.size >= MAX_EMITTERS) break;
      if (!mesh?.transform || mesh.isPluginMesh) continue;
      const options = parseParticles(getMeshXRTraits(mesh)?.particles);
      if (!options) continue;
      live.add(mesh);
      const key = JSON.stringify(options);
      let entry = this.entries.get(mesh);
      if (entry && entry.key !== key) {
        removeDynamicMesh(viewer, entry.mesh);
        entry = undefined;
      }
      const center = extractPosition(mesh.transform);
      if (!entry) {
        const emitter = new ParticleEmitter(options, this.entries.size + 1);
        emitter.reset(center);
        const gl = viewer.gl;
        const instanced = viewer.supportsInstanceOffsets === true &&
          typeof gl?.drawElementsInstanced === 'function' &&
          typeof gl?.vertexAttribDivisor === 'function';
        const count = instanced ? 1 : options.count;
        const positions = new Float32Array(count * VERTS_PER_PARTICLE * 3);
        // A zero-centered emitter writes the same cross-quads as the fallback,
        // including the asymmetric Z extent. Simulation remains on the CPU.
        writeParticleVertices(positions, instanced ? [0, 0, 0] : emitter.positions, count, PRESETS[options.preset].size);
        const topo = buildParticleTopology(count);
        const pm = createDynamicMesh(
          viewer,
          {
            positions, normals: topo.normals, indices: topo.indices,
            translations: instanced ? emitter.positions : undefined,
          },
          {name: `__xr_particles_${mesh.name ?? 'emitter'}`, color: PRESETS[options.preset].color, pickable: false},
        );
        entry = {emitter, mesh: pm, key};
        this.entries.set(mesh, entry);
      }
      entry.emitter.step(dt, center, floorY, depth);
      if (!entry.mesh.primitives[0].translations) {
        entry.emitter.writeVertices(entry.mesh.primitives[0].positions);
      }
      refreshDynamicPositions(viewer, entry.mesh);
    }
    for (const [mesh, entry] of [...this.entries]) {
      if (live.has(mesh) && meshes.includes(mesh)) continue;
      removeDynamicMesh(viewer, entry.mesh);
      this.entries.delete(mesh);
    }
  }

  /** Removes every emitter mesh. */
  dispose(viewer: PluginViewer | undefined): void {
    for (const entry of this.entries.values()) removeDynamicMesh(viewer, entry.mesh);
    this.entries.clear();
  }
}

const controllers = new WeakMap<object, XRDepthParticlesController>();

/** Returns (creating on first use) the particle controller for `viewer`. */
export function getDepthParticlesController(viewer: object): XRDepthParticlesController {
  let c = controllers.get(viewer);
  if (!c) {
    c = new XRDepthParticlesController();
    controllers.set(viewer, c);
  }
  return c;
}

function depthCameraFor(viewer: PluginViewer): DepthCamera | undefined {
  const host = viewer.container;
  const dm = host?.depthManager;
  if (!dm || host?.xrDepth === 'none' || typeof dm.sampleDepthAndNormal !== 'function') return undefined;
  // Real-world depth only exists while presenting; use the headset camera.
  const proj = resolveProjection(viewer);
  if (!isXRFrameFresh(viewer) || !proj) return undefined;
  const head = resolveHeadPose(viewer);
  // Particles live in model space: view * root maps them to eye space.
  const view = mat4Create();
  mat4Invert(view, head.matrix);
  mat4Multiply(view, view, rootMatrix(viewer));
  return {
    view,
    proj,
    sample: (u, v) => {
      try {
        return dm.sampleDepthAndNormal(u, v)?.depthMeters ?? null;
      } catch {
        // CPU depth info throws once its XRFrame is no longer active.
        return null;
      }
    },
  };
}

function stepViewer(viewer: PluginViewer, dt: number): void {
  if (!viewer || !Array.isArray(viewer.meshes)) return;
  const floorY = viewer.container?.simulator?.room?.floorY;
  getDepthParticlesController(viewer).update(
    viewer,
    dt,
    typeof floorY === 'number' ? floorY : undefined,
    depthCameraFor(viewer),
  );
}

/** `ThreeLivePlugin` that simulates `particles` traits every frame. */
export const depthParticlesPlugin: ThreeLivePlugin = {
  name: 'xr-live-depth-particles',
  onUpdate(viewer: PluginViewer, dt: number): void {
    if (!isXRFrameFresh(viewer)) stepViewer(viewer, dt);
  },
  onXRFrame(viewer: unknown, _session: unknown, frame: unknown, refSpace: unknown): void {
    cacheXRFrame(viewer as PluginViewer, frame, refSpace);
    stepViewer(viewer as PluginViewer, 1 / 72);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    controllers.get(viewer)?.dispose(viewer);
  },
};
