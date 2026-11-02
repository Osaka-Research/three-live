// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Canonical, cross-platform schema for `userData.xr` spatial
 * traits. This module is the single source of truth used by:
 *
 * - the optional `<xr-live>` spatial plugins (runtime parsing on web),
 * - `three-convert.ts` (`extras.xr`, `ANDROID_xr_scenecore`, USDZ
 *   `customData`) once {@link registerXRTraitSerializer} has run, and
 * - the embedded Rust compiler engine (`ENABLE_SERVER_EXTRACT`), whose
 *   output is consumed by the Android (`XRLiveRuntimeSession.kt`) and
 *   iOS/visionOS (`XRLiveRuntimeSession.swift`) runtimes.
 *
 * All numeric fields are clamped to the same ranges on every platform so a
 * scene authored once behaves identically everywhere.
 */

import {getSharedRegistry} from './plugin';

/** Mutable 3-component vector. */
export type TraitVec3 = [number, number, number];

/** Clamps `v` into `[lo, hi]`, mapping non-finite values to `fallback`. */
export function clampNum(
  v: unknown,
  lo: number,
  hi: number,
  fallback: number,
): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.max(lo, Math.min(hi, n));
}

/** Returns `true` when `v` is an array whose first 3 entries are finite. */
export function isFiniteVec3(v: unknown): v is TraitVec3 {
  return (
    Array.isArray(v) &&
    v.length >= 3 &&
    Number.isFinite(v[0]) &&
    Number.isFinite(v[1]) &&
    Number.isFinite(v[2])
  );
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

function shortString(v: unknown, max = 256): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
}

/** Normalized lazy-follow spatial options. */
export interface LazyFollowOptions {
  readonly mode: 'head' | 'hand-left' | 'hand-right';
  readonly lazy: boolean;
  readonly distance: number;
  readonly deadzoneDeg: number;
  readonly stiffness: number;
  readonly height: number;
  readonly faceUser: boolean;
  readonly snapOnStart: boolean;
}

/**
 * Parses an object-valued `follow` trait. Returns `null` for string-valued or
 * missing traits, which remain owned by the core `XRTraitSystem` on web.
 */
export function parseLazyFollow(raw: unknown): LazyFollowOptions | null {
  const r = asRecord(raw);
  if (!r || r['lazy'] === false) return null;
  const mode =
    r['mode'] === 'hand-left' || r['mode'] === 'hand-right' ? r['mode'] : 'head';
  const isHand = mode !== 'head';
  return {
    mode,
    lazy: true,
    distance: clampNum(r['distance'], 0.1, 10, isHand ? 0.15 : 1.0),
    deadzoneDeg: clampNum(r['deadzoneDeg'], 0, 90, isHand ? 0 : 15),
    stiffness: clampNum(r['stiffness'], 0.5, 40, 6),
    height: clampNum(r['height'], -2, 2, isHand ? 0.12 : -0.1),
    faceUser: r['faceUser'] !== false,
    snapOnStart: r['snapOnStart'] !== false,
  };
}

/** Normalized orbit options. */
export interface OrbitOptions {
  readonly target: TraitVec3 | string;
  readonly radius: number;
  readonly speed: number;
  readonly height: number;
  readonly phase: number;
  readonly faceCenter: boolean;
}

/** Parses an `orbit` trait, returning `null` when absent or malformed. */
export function parseOrbit(raw: unknown): OrbitOptions | null {
  const r = asRecord(raw);
  if (!r) return null;
  const t = r['target'];
  const target: TraitVec3 | string = isFiniteVec3(t)
    ? [t[0], t[1], t[2]]
    : typeof t === 'string' && t.length > 0 && t.length <= 256
      ? t
      : [0, 0, 0];
  return {
    target,
    radius: clampNum(r['radius'], 0.01, 50, 0.5),
    speed: clampNum(r['speed'], -20, 20, 0.5),
    height: clampNum(r['height'], -10, 10, 0),
    phase: clampNum(r['phase'], -1e6, 1e6, 0),
    faceCenter: r['faceCenter'] === true,
  };
}

/** Normalized manipulation-handle options. */
export interface HandlesOptions {
  readonly rotateAxis: 'y' | 'none';
  readonly minScale: number;
  readonly maxScale: number;
}

/** Parses a `handles` trait, returning `null` when absent or disabled. */
export function parseHandles(raw: unknown): HandlesOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? {};
  const minScale = clampNum(r['minScale'], 0.001, 1000, 0.1);
  const maxScale = clampNum(
    r['maxScale'],
    minScale,
    1000,
    Math.max(minScale, 10),
  );
  return {
    rotateAxis: r['rotateAxis'] === 'none' ? 'none' : 'y',
    minScale,
    maxScale,
  };
}

/** Supported particle presets. */
export type ParticlePreset = 'rain' | 'snow' | 'sparks' | 'confetti';
/** Hard cap on particles per emitter (bounds CPU and 16-bit index usage). */
export const MAX_PARTICLES_PER_EMITTER = 2000;
/** Default particle count per preset. */
export const PARTICLE_DEFAULT_COUNTS: Readonly<Record<ParticlePreset, number>> = {
  rain: 600,
  snow: 400,
  sparks: 300,
  confetti: 300,
};

/** Normalized particle emitter options. */
export interface ParticleOptions {
  readonly preset: ParticlePreset;
  readonly count: number;
  readonly area: TraitVec3;
  readonly speed: number;
}

/** Parses a `particles` trait, returning `null` when absent or malformed. */
export function parseParticles(raw: unknown): ParticleOptions | null {
  const r = asRecord(raw);
  if (!r) return null;
  const preset: ParticlePreset =
    r['preset'] === 'snow' || r['preset'] === 'sparks' || r['preset'] === 'confetti'
      ? r['preset']
      : 'rain';
  const a = r['area'];
  const side = (v: unknown): number => clampNum(v, 0.05, 50, 2);
  const area: TraitVec3 = isFiniteVec3(a)
    ? [side(a[0]), side(a[1]), side(a[2])]
    : typeof a === 'number'
      ? [side(a), side(a), side(a)]
      : [2, 2, 2];
  return {
    preset,
    count: Math.round(
      clampNum(r['count'], 1, MAX_PARTICLES_PER_EMITTER, PARTICLE_DEFAULT_COUNTS[preset]),
    ),
    area,
    speed: clampNum(r['speed'], 0.05, 10, 1),
  };
}

/** Maximum characters of a hold-to-ask prompt. */
export const MAX_PROMPT_CHARS = 4000;

/** Normalized `holdToAsk` options. */
export interface HoldToAskOptions {
  readonly prompt: string;
  readonly holdMs: number;
}

/** Parses a `holdToAsk` trait, returning `null` when absent or disabled. */
export function parseHoldToAsk(raw: unknown): HoldToAskOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? {};
  return {
    prompt: shortString(r['prompt'], MAX_PROMPT_CHARS) ?? 'What is this?',
    holdMs: clampNum(r['holdMs'], 100, 5000, 600),
  };
}

/** Normalized world-understanding options. */
export interface WorldUnderstandingTrait {
  readonly planes: boolean;
  readonly meshes: boolean;
  readonly reticle: boolean;
  readonly objects: boolean;
}

/** Parses a `worldUnderstanding` trait. */
export function parseWorldUnderstanding(raw: unknown): WorldUnderstandingTrait | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? {};
  return {
    planes: r['planes'] !== false,
    meshes: r['meshes'] === true,
    reticle: r['reticle'] === true,
    objects: r['objects'] === true,
  };
}

/** Normalized spatial audio options. */
export interface SpatialAudioTrait {
  readonly src: string;
  readonly refDistance: number;
  readonly loop: boolean;
}

/**
 * Returns `raw` when it is an `https:` URL or a plain relative path (no `..`,
 * `\`, `%`, scheme, or protocol-relative `//`), else `undefined`. Applied to
 * every media URL a compiled scene can make a native runtime fetch.
 */
export function safeMediaUrl(raw: unknown): string | undefined {
  const url = shortString(raw, 4096)?.trim();
  if (!url || /[\x00-\x20\\%]/.test(url)) return undefined;
  if (/^https:\/\/[^/]/i.test(url)) return url;
  if (url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) return undefined;
  return url.split(/[/?#]/).includes('..') ? undefined : url;
}

/** Parses an `audio` trait (string URL or `{src, refDistance, loop}`). */
export function parseSpatialAudio(raw: unknown): SpatialAudioTrait | null {
  if (typeof raw === 'string') {
    const src = safeMediaUrl(raw);
    return src ? {src, refDistance: 1, loop: false} : null;
  }
  const r = asRecord(raw);
  const src = safeMediaUrl(r?.['src']);
  if (!r || !src) return null;
  return {src, refDistance: clampNum(r['refDistance'], 0.01, 1000, 1), loop: r['loop'] === true};
}

/** Sanitizes `#rgb` / `#rrggbb` hex strings, returning `fallback` when invalid. */
export function safeHexColor(raw: unknown, fallback: string): string {
  const s = shortString(raw, 16)?.trim();
  if (!s) return fallback;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

/** Supported spatial dimension display units. */
export type DimensionUnit = 'm' | 'cm' | 'mm' | 'in' | 'ft-in' | 'auto';
/** Supported spatial dimension axes. */
export type DimensionAxis = 'x' | 'y' | 'z';

/** Normalized `dimensions` trait options (`spatial-measure`). */
export interface DimensionsOptions {
  readonly enabled: true;
  readonly unit: DimensionUnit;
  readonly axes: DimensionAxis[];
  readonly color: string;
  readonly showOnSelect: boolean;
}

const DIM_UNITS = new Set<DimensionUnit>(['m', 'cm', 'mm', 'in', 'ft-in', 'auto']);
const ALL_AXES: readonly DimensionAxis[] = ['x', 'y', 'z'];

/** Parses a `dimensions` trait (`true` or options), returning `null` when disabled. */
export function parseDimensions(raw: unknown): DimensionsOptions | null {
  if (!raw) return null;
  const r = asRecord(raw);
  if (r && r['enabled'] === false) return null;
  const u = r?.['unit'];
  const unit: DimensionUnit =
    typeof u === 'string' && DIM_UNITS.has(u as DimensionUnit) ? (u as DimensionUnit) : 'auto';
  const rawAxes = r?.['axes'];
  const axisSet = new Set<string>(
    Array.isArray(rawAxes)
      ? rawAxes.filter((x): x is string => typeof x === 'string')
      : typeof rawAxes === 'string'
        ? rawAxes.split('')
        : [],
  );
  const axes = ALL_AXES.filter((a) => axisSet.has(a));
  return {
    enabled: true,
    unit,
    axes: axes.length > 0 ? axes : [...ALL_AXES],
    color: safeHexColor(r?.['color'], '#38bdf8'),
    showOnSelect: r?.['showOnSelect'] === true,
  };
}

/** Supported surface snap targets. */
export type SnapSurfaceMode = 'none' | 'floor' | 'wall' | 'ceiling' | 'any';

/** Normalized `snapTo` trait options (`magnetic-snap`). */
export interface SnapToOptions {
  readonly grid: TraitVec3 | null;
  readonly angleDeg: number;
  readonly surface: SnapSurfaceMode;
  readonly socketTag: string;
  readonly radius: number;
}

const SNAP_SURFACES = new Set<SnapSurfaceMode>(['none', 'floor', 'wall', 'ceiling', 'any']);

/** Parses a `snapTo` trait (`true` or options), returning `null` when absent/disabled. */
export function parseSnapTo(raw: unknown): SnapToOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? {};
  const g = r['grid'];
  const step = (v: unknown): number => clampNum(v, 0.001, 100, 0.1);
  const grid: TraitVec3 | null = isFiniteVec3(g)
    ? [step(g[0]), step(g[1]), step(g[2])]
    : typeof g === 'number' && Number.isFinite(g) && g > 0
      ? [step(g), step(g), step(g)]
      : null;
  const surf = r['surface'];
  return {
    grid,
    angleDeg: clampNum(r['angleDeg'], 0, 180, 0),
    surface:
      typeof surf === 'string' && SNAP_SURFACES.has(surf as SnapSurfaceMode)
        ? (surf as SnapSurfaceMode)
        : 'none',
    socketTag: shortString(r['socketTag'], 128) ?? '',
    radius: clampNum(r['radius'], 0.01, 2.0, 0.15),
  };
}

/** Normalized `snapSocket` trait options (`magnetic-snap`). */
export interface SnapSocketOptions {
  readonly tag: string;
  readonly radius: number;
  readonly alignRotation: boolean;
  readonly highlightColor: string;
}

/** Parses a `snapSocket` trait (tag string or options), returning `null` without a tag. */
export function parseSnapSocket(raw: unknown): SnapSocketOptions | null {
  if (typeof raw === 'string') {
    const tag = shortString(raw, 128);
    return tag ? {tag, radius: 0.15, alignRotation: true, highlightColor: '#22c55e'} : null;
  }
  const r = asRecord(raw);
  const tag = shortString(r?.['tag'], 128);
  if (!r || !tag) return null;
  return {
    tag,
    radius: clampNum(r['radius'], 0.01, 2.0, 0.15),
    alignRotation: r['alignRotation'] !== false,
    highlightColor: safeHexColor(r['highlightColor'], '#22c55e'),
  };
}

/** Supported dwell completion actions (`gaze-dwell`). */
export type GazeAction = 'select' | 'ask';

/** Normalized `gaze` trait options (`gaze-dwell`). */
export interface GazeOptions {
  readonly enabled: boolean;
  readonly dwellMs: number;
  readonly repeat: boolean;
  readonly action: GazeAction;
}

/** Parses a `gaze` trait (`true` or options), returning `null` when disabled. */
export function parseGaze(raw: unknown): GazeOptions | null {
  if (!raw) return null;
  const r = asRecord(raw);
  if (r && r['enabled'] === false) return null;
  const act = r?.['action'];
  return {
    enabled: true,
    dwellMs: Math.round(clampNum(r?.['dwellMs'], 250, 10000, 1200)),
    repeat: r?.['repeat'] === true,
    action: act === 'ask' ? 'ask' : 'select',
  };
}

/** Normalized `explode` trait options (`exploded-view`). */
export interface ExplodeOptions {
  readonly enabled: boolean;
  readonly direction: TraitVec3 | null;
  readonly distance: number;
  readonly layer: number;
  readonly leaderLine: boolean;
}

/** Parses an `explode` trait (`true` or options), returning `null` when disabled. */
export function parseExplode(raw: unknown): ExplodeOptions | null {
  if (!raw) return null;
  const r = asRecord(raw);
  if (r && r['enabled'] === false) return null;
  const rawDir = r?.['direction'];
  let direction: TraitVec3 | null = null;
  if (isFiniteVec3(rawDir)) {
    const len = Math.hypot(rawDir[0], rawDir[1], rawDir[2]);
    if (len > 1e-8) {
      direction = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
    }
  }
  return {
    enabled: true,
    direction,
    distance: clampNum(r?.['distance'], 0, 10, 0.35),
    layer: Math.round(clampNum(r?.['layer'], 1, 10, 1)),
    leaderLine: r?.['leaderLine'] !== false,
  };
}

/** Canonical, fully-normalized trait set for one node. */
export interface NormalizedXRTraits {
  grab?: '1-hand' | '2-hand';
  /** Legacy alias of `grab` kept for older native parsers. */
  grabbable?: true;
  scale?: {min: number; max: number};
  /** Legacy alias of `scale` kept for older native parsers. */
  scalable?: true;
  billboard?: 'capsule' | 'cylindrical' | 'spherical';
  /** Eager spring follow (string) or lazy follow (object). */
  follow?: 'head' | 'hand-left' | 'hand-right' | LazyFollowOptions;
  anchor?: 'horizontal' | 'vertical' | 'floor' | 'wall' | 'table';
  physics?: 'dynamic' | 'static';
  orbit?: OrbitOptions;
  handles?: HandlesOptions;
  particles?: ParticleOptions;
  holdToAsk?: HoldToAskOptions;
  worldUnderstanding?: WorldUnderstandingTrait;
  splatUrl?: string;
  spatialSlot?: string;
  audio?: SpatialAudioTrait;
  dimensions?: DimensionsOptions;
  snapTo?: SnapToOptions;
  snapSocket?: SnapSocketOptions;
  gaze?: GazeOptions;
  explode?: ExplodeOptions;
  pointerEvents?: 'none';
}

const ANCHORS = new Set(['horizontal', 'vertical', 'floor', 'wall', 'table']);
const BILLBOARDS = new Set(['capsule', 'cylindrical', 'spherical']);

/**
 * Normalizes an authored `userData.xr` bag into {@link NormalizedXRTraits}.
 * Accepts legacy aliases (`grabbable`, `scalable`, `traits: ['grab', ...]`).
 * Returns `null` when no recognized trait is present.
 */
export function normalizeXRTraits(raw: unknown): NormalizedXRTraits | null {
  const r = asRecord(raw);
  if (!r) return null;
  const traitList = Array.isArray(r['traits']) ? (r['traits'] as unknown[]) : [];
  const has = (name: string): boolean => traitList.includes(name);
  const out: NormalizedXRTraits = {};

  const grab = r['grab'];
  if (grab === '1-hand' || grab === '2-hand') out.grab = grab;
  else if (grab === true || r['grabbable'] === true || has('grab')) out.grab = '2-hand';
  if (out.grab) out.grabbable = true;

  // `scale: false` deliberately wins over a legacy `scalable: true`.
  const scale = r['scale'] ?? r['scalable'];
  if (scale || has('scale')) {
    const s = asRecord(scale) ?? {};
    // Same defaults as the web XRTraitSystem (0.05–5).
    const min = clampNum(s['min'], 0.001, 1000, 0.05);
    out.scale = {min, max: clampNum(s['max'], min, 1000, Math.max(min, 5))};
    out.scalable = true;
  }

  const bb = r['billboard'];
  if (typeof bb === 'string' && BILLBOARDS.has(bb)) {
    out.billboard = bb as NormalizedXRTraits['billboard'];
  } else if (bb === true || has('billboard')) {
    out.billboard = 'capsule';
  }

  const follow = r['follow'];
  const followMode = typeof follow === 'string' ? follow : asRecord(follow)?.['mode'];
  if (typeof follow === 'string' ? follow : asRecord(follow)?.['lazy'] === false) {
    // Strings and `{lazy: false}` objects are eager spring follows.
    out.follow =
      followMode === 'hand-left' || followMode === 'hand-right' ? followMode : 'head';
  } else {
    const lazy = parseLazyFollow(follow);
    if (lazy) out.follow = lazy;
  }

  const anchor = r['anchor'];
  if (typeof anchor === 'string' && ANCHORS.has(anchor)) {
    out.anchor = anchor as NormalizedXRTraits['anchor'];
  }
  if (r['physics'] === 'dynamic' || r['physics'] === 'static') out.physics = r['physics'];

  const orbit = parseOrbit(r['orbit']);
  if (orbit) out.orbit = orbit;
  const handles = parseHandles(r['handles']);
  if (handles) out.handles = handles;
  const particles = parseParticles(r['particles']);
  if (particles) out.particles = particles;
  const hold = parseHoldToAsk(r['holdToAsk']);
  if (hold) out.holdToAsk = hold;
  const wu = parseWorldUnderstanding(r['worldUnderstanding']);
  if (wu) out.worldUnderstanding = wu;
  const splat = safeMediaUrl(r['splatUrl']);
  if (splat) out.splatUrl = splat;
  const slot = shortString(r['spatialSlot']);
  if (slot) out.spatialSlot = slot;
  const audio = parseSpatialAudio(r['audio']);
  if (audio) out.audio = audio;
  const dims = parseDimensions(r['dimensions']);
  if (dims) out.dimensions = dims;
  const snapTo = parseSnapTo(r['snapTo']);
  if (snapTo) out.snapTo = snapTo;
  const snapSocket = parseSnapSocket(r['snapSocket']);
  if (snapSocket) out.snapSocket = snapSocket;
  const gaze = parseGaze(r['gaze']);
  if (gaze) out.gaze = gaze;
  const explode = parseExplode(r['explode']);
  if (explode) out.explode = explode;
  if (r['pointerEvents'] === 'none') out.pointerEvents = 'none';

  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Builds the `ANDROID_xr_scenecore` node extension (Jetpack XR SceneCore
 * component descriptors) for a normalized trait set.
 */
export function buildXRSceneCoreExtension(
  n: NormalizedXRTraits,
): Record<string, unknown> {
  const comp: Record<string, unknown> = {};
  if (n.grab) {
    comp['interactable'] = {mode: n.grab};
    comp['movable'] = {
      systemMovable: true,
      scaleInZ: Boolean(n.scale),
      minScale: n.scale?.min ?? 0.05,
      maxScale: n.scale?.max ?? 5,
    };
  }
  if (n.billboard) comp['billboard'] = {mode: n.billboard};
  if (typeof n.follow === 'string') {
    comp['follow'] = {target: n.follow, lazy: false};
  } else if (n.follow) {
    comp['follow'] = {
      target: n.follow.mode,
      lazy: true,
      distance: n.follow.distance,
      deadzoneDeg: n.follow.deadzoneDeg,
      stiffness: n.follow.stiffness,
      height: n.follow.height,
      faceUser: n.follow.faceUser,
    };
  }
  if (n.anchor) {
    comp['anchor'] = {
      planeType: n.anchor === 'vertical' || n.anchor === 'wall' ? 'VERTICAL' : 'HORIZONTAL',
      semanticType: n.anchor.toUpperCase(),
    };
  }
  if (n.physics) comp['rigidbody'] = {type: n.physics};
  if (n.orbit) comp['orbit'] = {...n.orbit};
  if (n.handles) comp['resizable'] = {...n.handles};
  if (n.particles) comp['particles'] = {...n.particles};
  if (n.holdToAsk) comp['holdToAsk'] = {...n.holdToAsk};
  if (n.worldUnderstanding) comp['worldUnderstanding'] = {...n.worldUnderstanding};
  if (n.splatUrl) comp['splat'] = {url: n.splatUrl};
  if (n.spatialSlot) comp['spatialPanel'] = {slot: n.spatialSlot};
  if (n.audio) comp['spatialAudio'] = {...n.audio};
  if (n.dimensions) comp['dimensions'] = {...n.dimensions, axes: [...n.dimensions.axes]};
  if (n.snapTo) {
    comp['snapTo'] = {...n.snapTo, grid: n.snapTo.grid ? [...n.snapTo.grid] : null};
  }
  if (n.snapSocket) comp['snapSocket'] = {...n.snapSocket};
  if (n.gaze) comp['gaze'] = {...n.gaze};
  if (n.explode) {
    comp['explode'] = {
      ...n.explode,
      direction: n.explode.direction ? [...n.explode.direction] : null,
    };
  }
  return comp;
}

/** Flat USD `customData` value types. */
export type UsdCustomValue = string | number | boolean | readonly number[];

/**
 * Flattens a normalized trait set into scalar `customData = {dictionary xr}`
 * entries for USDZ (RealityKit on iOS / visionOS). Keys are camelCase and
 * prefixed by trait (`followDistance`, `particlesCount`, ...).
 */
export function flattenXRTraitsForUsd(
  n: NormalizedXRTraits,
): Record<string, UsdCustomValue> {
  const out: Record<string, UsdCustomValue> = {};
  const put = (prefix: string, obj: object): void => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix + k[0].toUpperCase() + k.slice(1);
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[key] = v;
      else if (isFiniteVec3(v)) out[key] = [v[0], v[1], v[2]];
    }
  };
  if (n.grab) out['grab'] = n.grab;
  if (n.scale) put('scale', n.scale);
  if (n.billboard) out['billboard'] = n.billboard;
  if (typeof n.follow === 'string') {
    out['follow'] = n.follow;
  } else if (n.follow) {
    out['follow'] = n.follow.mode;
    put('follow', {...n.follow, mode: undefined});
  }
  if (n.anchor) out['anchor'] = n.anchor;
  if (n.physics) out['physics'] = n.physics;
  if (n.orbit) put('orbit', n.orbit);
  if (n.handles) {
    out['handles'] = true;
    put('handles', n.handles);
  }
  if (n.particles) put('particles', n.particles);
  if (n.holdToAsk) {
    out['holdToAsk'] = true;
    put('holdToAsk', n.holdToAsk);
  }
  if (n.worldUnderstanding) put('worldUnderstanding', n.worldUnderstanding);
  if (n.splatUrl) out['splatUrl'] = n.splatUrl;
  if (n.spatialSlot) out['spatialSlot'] = n.spatialSlot;
  if (n.audio) put('audio', n.audio);
  if (n.dimensions) {
    put('dimensions', {...n.dimensions, axes: n.dimensions.axes.join('')});
  }
  if (n.snapTo) {
    out['snapTo'] = true;
    put('snapTo', n.snapTo);
  }
  if (n.snapSocket) put('snapSocket', n.snapSocket);
  if (n.gaze) put('gaze', n.gaze);
  if (n.explode) put('explode', n.explode);
  if (n.pointerEvents) out['pointerEvents'] = n.pointerEvents;
  return out;
}

/**
 * Upgrades a glTF node (already carrying JSON-safe `extras.xr` copied from
 * `userData.xr`) to the canonical `extras.xr` and `ANDROID_xr_scenecore`.
 * Unknown authored keys (e.g. `restitution`) are preserved.
 */
export function upgradeGltfNodeXR(
  // tslint:disable-next-line:no-any glTF node JSON.
  node: any,
  rawXR: unknown,
): void {
  const normalized = normalizeXRTraits(rawXR);
  if (!normalized) return;
  node.extras = {...node.extras, xr: {...node.extras?.xr, ...normalized}};
  node.extensions = {
    ...node.extensions,
    MOZ_hubs_components: buildHubsExtension(normalized),
    ANDROID_xr_scenecore: buildXRSceneCoreExtension(normalized),
  };
}

/** Builds the Mozilla Hubs `MOZ_hubs_components` map for normalized traits. */
export function buildHubsExtension(n: NormalizedXRTraits): Record<string, unknown> {
  const hubs: Record<string, unknown> = {};
  if (n.grab) hubs['grabbable'] = {cursor: true, hand: true};
  if (n.billboard) hubs['billboard'] = {onlyY: n.billboard !== 'spherical'};
  return hubs;
}

/**
 * Formats the canonical traits as typed USD `customData` dictionary lines
 * (`double followDistance = 1.2`, `bool handles = true`, ...). Returns an
 * empty list when no recognized trait is present.
 */
export function buildUsdXRLines(
  rawXR: unknown,
  sanitize: (v: unknown) => string,
): string[] {
  const normalized = normalizeXRTraits(rawXR);
  const lines: string[] = [];
  if (!normalized) return lines;
  for (const [key, value] of Object.entries(flattenXRTraitsForUsd(normalized))) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key)) continue;
    if (typeof value === 'boolean') {
      lines.push(`bool ${key} = ${value}`);
    } else if (typeof value === 'number') {
      if (Number.isFinite(value)) lines.push(`double ${key} = ${value}`);
    } else if (typeof value === 'string') {
      lines.push(`string ${key} = "${sanitize(value)}"`);
    } else if (value.length === 3 && value.every((v) => Number.isFinite(v))) {
      lines.push(`double3 ${key} = (${value.join(', ')})`);
    }
  }
  return lines;
}

/** Serializer hooks consulted by `three-convert.ts` when registered. */
export interface XRTraitSerializer {
  gltfNode: typeof upgradeGltfNodeXR;
  usdLines: typeof buildUsdXRLines;
}

/**
 * Registers the canonical trait serializer on the shared registry so GLB and
 * USDZ exports emit the full normalized `extras.xr`, `ANDROID_xr_scenecore`,
 * and USD `customData`. Called by the spatial plugins bundle and the compiler engine.
 */
export function registerXRTraitSerializer(): void {
  // Locked so untrusted scene scripts in the compiler engine (which may be
  // reused across requests) cannot swap in a serializer that emits raw USDA.
  try {
    Object.defineProperty(getSharedRegistry(), 'xrTraitSerializer', {
      value: Object.freeze({gltfNode: upgradeGltfNodeXR, usdLines: buildUsdXRLines}),
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already registered (e.g. a second bundle on the same page).
  }
}
