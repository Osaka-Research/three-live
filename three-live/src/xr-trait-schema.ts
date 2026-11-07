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
import type {
  AgentOptions,
  AudioCueOptions,
  CharacterOptions,
  IntegrityOptions,
  ObjectiveOptions,
  PhysicsBodyOptions,
  SpawnerOptions,
  ZoneOptions,
} from './xr-sim-schema';

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

/** Returns `raw` as a plain record, or `null` for arrays and non-objects. */
export function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** Returns a non-empty string truncated to `max` chars, else `undefined`. */
export function shortString(v: unknown, max = 256): string | undefined {
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
    r['mode'] === 'hand-left' || r['mode'] === 'hand-right'
      ? r['mode']
      : 'head';
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
  const minScale = clampNum(r['minScale'] ?? r['min'], 0.001, 1000, 0.1);
  const maxScale = clampNum(
    r['maxScale'] ?? r['max'],
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
export const PARTICLE_DEFAULT_COUNTS: Readonly<Record<ParticlePreset, number>> =
  {
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
    r['preset'] === 'snow' ||
    r['preset'] === 'sparks' ||
    r['preset'] === 'confetti'
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
      clampNum(
        r['count'],
        1,
        MAX_PARTICLES_PER_EMITTER,
        PARTICLE_DEFAULT_COUNTS[preset],
      ),
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
export function parseWorldUnderstanding(
  raw: unknown,
): WorldUnderstandingTrait | null {
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
  if (url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url))
    return undefined;
  return url.split(/[/?#]/).includes('..') ? undefined : url;
}

/** Parses an `audio` trait (string URL or `{src, refDistance, loop}`). */
export function parseSpatialAudio(raw: unknown): SpatialAudioTrait | null {
  const r = typeof raw === 'string' ? {src: raw} : asRecord(raw);
  const src = safeMediaUrl(r?.['src']);
  if (!r || !src) return null;
  return {
    src,
    refDistance: clampNum(r['refDistance'], 0.01, 1000, 1),
    loop: r['loop'] === true,
  };
}

/** Built-in procedural ambient loop presets for `userData.xr.audioEmitter`. */
export const AMBIENT_SOUND_PRESETS = [
  'hum',
  'reactor',
  'wind',
  'beacon',
  'geiger',
  'chimeLoop',
  'machinery',
  'water',
] as const;

/** Procedural ambient sound preset name. */
export type AmbientSoundPreset = (typeof AMBIENT_SOUND_PRESETS)[number];

/** Built-in one-shot synth cue presets usable on `audioEmitter`. */
export const ONE_SHOT_AUDIO_PRESETS = [
  'confirm',
  'error',
  'alarm',
  'warning',
  'pickup',
  'jump',
  'beam',
  'impact',
  'burst',
  'powerup',
  'step',
  'pass',
  'fail',
] as const;

/** Any supported procedural preset name (ambient loop or one-shot cue). */
export type AudioPresetName =
  | AmbientSoundPreset
  | (typeof ONE_SHOT_AUDIO_PRESETS)[number];

/** Distance attenuation curve model (`KHR_audio_emitter` / Web Audio `PannerNode`). */
export type AudioDistanceModel = 'inverse' | 'linear' | 'exponential';

/** Normalized 3D positional/directional audio emitter trait (`userData.xr.audioEmitter`). */
export interface AudioEmitterOptions {
  readonly preset?: AudioPresetName;
  readonly src?: string;
  readonly type: 'positional' | 'global';
  readonly volume: number;
  readonly pitch: number;
  readonly loop: boolean;
  readonly autoplay: boolean;
  readonly distanceModel: AudioDistanceModel;
  readonly refDistance: number;
  readonly maxDistance: number;
  readonly rolloffFactor: number;
  readonly coneInnerAngle: number;
  readonly coneOuterAngle: number;
  readonly coneOuterGain: number;
  readonly playOnSelect: boolean;
}

const AMBIENT_SET: ReadonlySet<string> = new Set(AMBIENT_SOUND_PRESETS);
const ONE_SHOT_SET: ReadonlySet<string> = new Set(ONE_SHOT_AUDIO_PRESETS);

function isAudioPresetName(s: string | undefined): s is AudioPresetName {
  return Boolean(s && (AMBIENT_SET.has(s) || ONE_SHOT_SET.has(s)));
}

/**
 * Parses an `audioEmitter` / `spatialAudio` / extended `audio` trait into
 * {@link AudioEmitterOptions}, or `null` when absent, disabled, or invalid.
 */
export function parseAudioEmitter(raw: unknown): AudioEmitterOptions | null {
  if (!raw) return null;
  let r: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    r = isAudioPresetName(trimmed) ? {preset: trimmed} : {src: trimmed};
  } else {
    r = asRecord(raw);
  }
  if (!r || r['enabled'] === false) return null;
  const rawPreset = shortString(r['preset'], 32)?.trim();
  const preset = isAudioPresetName(rawPreset) ? rawPreset : undefined;
  const src = safeMediaUrl(r['src'] ?? r['url'] ?? r['uri']);
  if (!preset && !src) return null;
  const isAmbient = !preset || AMBIENT_SET.has(preset);
  const type =
    r['type'] === 'global' || r['positional'] === false
      ? 'global'
      : 'positional';
  const volume = clampNum(r['volume'] ?? r['gain'], 0, 2, 0.6);
  const pitch = clampNum(r['pitch'] ?? r['playbackRate'], 0.25, 4, 1);
  const loop = typeof r['loop'] === 'boolean' ? r['loop'] : isAmbient;
  const autoplay =
    typeof r['autoplay'] === 'boolean'
      ? r['autoplay']
      : typeof r['autoPlay'] === 'boolean'
        ? r['autoPlay']
        : true;
  const distanceModel: AudioDistanceModel =
    r['distanceModel'] === 'linear' || r['distanceModel'] === 'exponential'
      ? r['distanceModel']
      : 'inverse';
  const refDistance = clampNum(r['refDistance'], 0.05, 100, 1);
  const maxDistance = clampNum(
    r['maxDistance'],
    refDistance,
    500,
    Math.max(refDistance, 25),
  );
  const rolloffFactor = clampNum(r['rolloffFactor'], 0, 10, 1);
  const coneInnerAngle = clampNum(r['coneInnerAngle'], 0, 360, 360);
  const coneOuterAngle = clampNum(
    r['coneOuterAngle'],
    coneInnerAngle,
    360,
    Math.max(coneInnerAngle, 360),
  );
  const coneOuterGain = clampNum(r['coneOuterGain'], 0, 1, 0);
  const playOnSelect = r['playOnSelect'] === true || r['playOnTap'] === true;
  return {
    ...(preset ? {preset} : {}),
    ...(src ? {src} : {}),
    type,
    volume,
    pitch,
    loop,
    autoplay,
    distanceModel,
    refDistance,
    maxDistance,
    rolloffFactor,
    coneInnerAngle,
    coneOuterAngle,
    coneOuterGain,
    playOnSelect,
  };
}

/** Evaluated 3D spatial audio mix for a single emitter at a listener pose. */
export interface SpatialAudioMix {
  readonly gain: number;
  readonly pan: number;
  readonly leftGain: number;
  readonly rightGain: number;
  readonly distance: number;
  readonly coneAttenuation: number;
}

/**
 * Pure 3D spatial audio distance, directional cone, and constant-power stereo
 * pan law shared across Web, Android, and iOS.
 */
export function computeSpatialAudioMix(
  listenerPos: readonly [number, number, number],
  _listenerForward: readonly [number, number, number],
  listenerRight: readonly [number, number, number],
  emitterPos: readonly [number, number, number],
  emitterForward: readonly [number, number, number],
  opts: Pick<
    AudioEmitterOptions,
    | 'type'
    | 'volume'
    | 'distanceModel'
    | 'refDistance'
    | 'maxDistance'
    | 'rolloffFactor'
    | 'coneInnerAngle'
    | 'coneOuterAngle'
    | 'coneOuterGain'
  >,
): SpatialAudioMix {
  const vol = clampNum(opts.volume, 0, 2, 0.6);
  if (opts.type === 'global') {
    const s = Math.SQRT1_2 * vol;
    return {
      gain: vol,
      pan: 0,
      leftGain: s,
      rightGain: s,
      distance: 0,
      coneAttenuation: 1,
    };
  }
  const dx = emitterPos[0] - listenerPos[0];
  const dy = emitterPos[1] - listenerPos[1];
  const dz = emitterPos[2] - listenerPos[2];
  const distance = Math.hypot(dx, dy, dz);
  const dRef = Math.max(1e-4, opts.refDistance);
  const dMax = Math.max(dRef, opts.maxDistance);
  const rolloff = Math.max(0, opts.rolloffFactor);
  const dClamped = Math.max(dRef, Math.min(distance, dMax));

  let distGain = 1;
  if (opts.distanceModel === 'linear') {
    const span = dMax - dRef;
    distGain = span > 1e-6 ? 1 - rolloff * ((dClamped - dRef) / span) : 1;
  } else if (opts.distanceModel === 'exponential') {
    distGain = Math.pow(dClamped / dRef, -rolloff);
  } else {
    distGain = dRef / (dRef + rolloff * (dClamped - dRef));
  }
  distGain = Math.max(0, Math.min(1, Number.isFinite(distGain) ? distGain : 0));

  let coneAttenuation = 1;
  const innerDeg = clampNum(opts.coneInnerAngle, 0, 360, 360);
  const outerDeg = clampNum(opts.coneOuterAngle, innerDeg, 360, 360);
  if (distance > 1e-6 && (innerDeg < 360 || outerDeg < 360)) {
    const efLen =
      Math.hypot(emitterForward[0], emitterForward[1], emitterForward[2]) || 1;
    const toLx = -dx / distance;
    const toLy = -dy / distance;
    const toLz = -dz / distance;
    const cosTheta = Math.max(
      -1,
      Math.min(
        1,
        (emitterForward[0] * toLx +
          emitterForward[1] * toLy +
          emitterForward[2] * toLz) /
          efLen,
      ),
    );
    const angleDeg = (Math.acos(cosTheta) * 180) / Math.PI;
    const halfInner = innerDeg * 0.5;
    const halfOuter = outerDeg * 0.5;
    const outerGain = clampNum(opts.coneOuterGain, 0, 1, 0);
    if (angleDeg <= halfInner) {
      coneAttenuation = 1;
    } else if (angleDeg >= halfOuter) {
      coneAttenuation = outerGain;
    } else {
      const t = (angleDeg - halfInner) / Math.max(1e-6, halfOuter - halfInner);
      coneAttenuation = 1 + (outerGain - 1) * t;
    }
  }

  let pan = 0;
  if (distance > 1e-6) {
    const lrLen =
      Math.hypot(listenerRight[0], listenerRight[1], listenerRight[2]) || 1;
    const dotRight =
      (dx * listenerRight[0] + dy * listenerRight[1] + dz * listenerRight[2]) /
      (distance * lrLen);
    pan = Math.max(-1, Math.min(1, Number.isFinite(dotRight) ? dotRight : 0));
  }

  const gain = vol * distGain * coneAttenuation;
  const panAngle = ((pan + 1) * Math.PI) / 4;
  return {
    gain,
    pan,
    leftGain: gain * Math.cos(panAngle),
    rightGain: gain * Math.sin(panAngle),
    distance,
    coneAttenuation,
  };
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

const DIM_UNITS = new Set<DimensionUnit>([
  'm',
  'cm',
  'mm',
  'in',
  'ft-in',
  'auto',
]);
const ALL_AXES: readonly DimensionAxis[] = ['x', 'y', 'z'];

/** Parses a `dimensions` trait (`true` or options), returning `null` when disabled. */
export function parseDimensions(raw: unknown): DimensionsOptions | null {
  if (!raw) return null;
  const r = asRecord(raw);
  if (r && r['enabled'] === false) return null;
  const u = r?.['unit'];
  const unit: DimensionUnit =
    typeof u === 'string' && DIM_UNITS.has(u as DimensionUnit)
      ? (u as DimensionUnit)
      : 'auto';
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

const SNAP_SURFACES = new Set<SnapSurfaceMode>([
  'none',
  'floor',
  'wall',
  'ceiling',
  'any',
]);

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
  const r = typeof raw === 'string' ? {tag: raw} : asRecord(raw);
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
  const rawDir = r?.['direction'] ?? r?.['offset'];
  let direction: TraitVec3 | null = null;
  let offsetLen: number | undefined;
  if (isFiniteVec3(rawDir)) {
    const len = Math.hypot(rawDir[0], rawDir[1], rawDir[2]);
    if (len > 1e-8) {
      direction = [rawDir[0] / len, rawDir[1] / len, rawDir[2] / len];
      if (r?.['direction'] === undefined && r?.['offset'] !== undefined) {
        offsetLen = len;
      }
    }
  }
  const rawDist =
    typeof r?.['distance'] === 'number' && Number.isFinite(r['distance'])
      ? r['distance']
      : offsetLen;
  if (typeof rawDist === 'number' && rawDist < 0 && direction) {
    direction = [-direction[0], -direction[1], -direction[2]];
  }
  return {
    enabled: true,
    direction,
    distance: clampNum(
      typeof rawDist === 'number' ? Math.abs(rawDist) : undefined,
      0,
      10,
      0.35,
    ),
    layer: Math.round(clampNum(r?.['layer'], 1, 10, 1)),
    leaderLine: r?.['leaderLine'] !== false,
  };
}

/** Identifiers rejected everywhere they could become object keys. */
export const FORBIDDEN_ANCHOR_IDS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Sanitizes an `anchor.id` or persistence key, rejecting prototype-pollution keys and control chars. */
export function safeAnchorId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim().slice(0, 128);
  if (
    !trimmed ||
    FORBIDDEN_ANCHOR_IDS.has(trimmed) ||
    /[\x00-\x1f\x7f]/.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed;
}

/** Normalized persistence metadata for `anchor: {id, persist}` (`persistent-anchors`). */
export interface AnchorPersistOptions {
  readonly id?: string;
  readonly persist: boolean;
}

/** Parses object-valued `anchor` persistence metadata, returning `null` for plain plane anchors. */
export function parseAnchorPersist(raw: unknown): AnchorPersistOptions | null {
  const r = asRecord(raw);
  if (!r) return null;
  if (r['persist'] === false) return null;
  const id = safeAnchorId(r['id']);
  if (r['persist'] !== true && !id) return null;
  return id ? {id, persist: true} : {persist: true};
}

/** Normalized locomotion surface mode (`spatial-locomotion`). */
export type NavigableMode = 'walkable' | 'blocked';

/** Parses a `navigable` trait (`true | false | 'walkable' | 'blocked'`). */
export function parseNavigable(raw: unknown): NavigableMode | null {
  if (raw === true || raw === 'walkable') return 'walkable';
  if (raw === false || raw === 'blocked') return 'blocked';
  return null;
}

/** Normalized 3D vector text trait (`userData.xr.text`). */
export interface TextTraitOptions {
  readonly text: string;
  readonly size: number;
  readonly depth: number;
  readonly color: string;
}

/** Parses a `text` trait (string or `{text | value, size, depth | height, color}`). */
export function parseTextTrait(raw: unknown): TextTraitOptions | null {
  const r = typeof raw === 'string' ? {text: raw} : asRecord(raw);
  const text = shortString(r?.['text'] ?? r?.['value'], 256);
  if (!r || !text) return null;
  const size = clampNum(r['size'], 0.005, 10, 0.12);
  return {
    text,
    size,
    depth: clampNum(r['depth'] ?? r['height'], 0.001, 5, size * 0.2),
    color: safeHexColor(r['color'], '#ffffff'),
  };
}

/** Normalized bloom post-processing trait (`userData.xr.bloom`). */
export interface BloomTraitOptions {
  readonly enabled: true;
  readonly strength: number;
  readonly threshold: number;
  readonly radius: number;
}

/** Parses a `bloom` trait (`true`, number strength, or `{strength, threshold, radius}`), returning `null` when disabled. */
export function parseBloomTrait(raw: unknown): BloomTraitOptions | null {
  if (!raw || (typeof raw === 'number' && !(raw > 0 && Number.isFinite(raw)))) {
    return null;
  }
  const r =
    raw === true
      ? {}
      : typeof raw === 'number'
        ? {strength: raw}
        : asRecord(raw);
  if (!r || r['enabled'] === false) return null;
  const strength = clampNum(r['strength'] ?? r['intensity'], 0, 5, 0.35);
  return strength > 0
    ? {
        enabled: true,
        strength,
        threshold: clampNum(r['threshold'], 0, 4, 0.8),
        radius: clampNum(r['radius'], 0, 2, 0.5),
      }
    : null;
}

/** Normalized silhouette outline trait (`userData.xr.outline`). */
export interface OutlineTraitOptions {
  readonly enabled: true;
  readonly color: string;
  readonly thickness: number;
  readonly pulse: boolean;
}

/** Parses an `outline` trait (`true`, color string, or `{color, thickness, pulse}`), returning `null` when disabled. */
export function parseOutlineTrait(raw: unknown): OutlineTraitOptions | null {
  if (!raw) return null;
  const r =
    raw === true
      ? {}
      : typeof raw === 'string'
        ? {color: raw}
        : asRecord(raw);
  if (!r || r['enabled'] === false) return null;
  const rawT = r['thickness'] ?? r['width'];
  return {
    enabled: true,
    color: safeHexColor(r['color'], '#38bdf8'),
    // Thickness is in pixels; metre-sized values (< 0.25, e.g. the documented
    // `0.025`) are converted the same way on web, Android, and iOS.
    thickness: clampNum(
      typeof rawT === 'number' && rawT > 0 && rawT < 0.25
        ? Math.max(1.5, rawT * 140)
        : rawT,
      0.5,
      20,
      3,
    ),
    pulse: r['pulse'] === true,
  };
}

/** Normalized inverse-kinematics chain trait (`userData.xr.ik`). */
export interface IKTraitOptions {
  readonly root: string;
  readonly mid?: string;
  readonly effector: string;
  readonly target: TraitVec3 | string;
  /** Scene-space pole point, or a node name resolved like `target`. */
  readonly pole?: TraitVec3 | string;
  readonly solver: 'two-bone' | 'fabrik';
  readonly iterations: number;
  readonly tolerance: number;
  readonly weight: number;
}

/** Parses an `ik` trait (`{root, mid?, effector, target, pole?, solver?, iterations?, tolerance?, weight?}`). */
export function parseIKTrait(raw: unknown): IKTraitOptions | null {
  const r = asRecord(raw);
  if (!r || r['enabled'] === false) return null;
  const root = safeAnchorId(r['root']);
  const effector = safeAnchorId(r['effector']);
  if (!root || !effector) return null;
  const mid = safeAnchorId(r['mid']);
  const rawTarget = r['target'];
  let target: TraitVec3 | string;
  if (isFiniteVec3(rawTarget)) {
    target = [
      clampNum(rawTarget[0], -1000, 1000, 0),
      clampNum(rawTarget[1], -1000, 1000, 0),
      clampNum(rawTarget[2], -1000, 1000, 0),
    ];
  } else {
    const tId = safeAnchorId(rawTarget);
    if (!tId) return null;
    target = tId;
  }
  // `pole` is a scene-space point or a node name resolved like `target`;
  // `poleTarget` is accepted as an alias.
  const rawPole = r['pole'] ?? r['poleTarget'];
  const pole: TraitVec3 | string | undefined = isFiniteVec3(rawPole)
    ? [
        clampNum(rawPole[0], -1000, 1000, 0),
        clampNum(rawPole[1], -1000, 1000, 0),
        clampNum(rawPole[2], -1000, 1000, 0),
      ]
    : safeAnchorId(rawPole);
  const solver: 'two-bone' | 'fabrik' =
    r['solver'] === 'fabrik'
      ? 'fabrik'
      : r['solver'] === 'two-bone'
        ? 'two-bone'
        : mid
          ? 'two-bone'
          : 'fabrik';
  return {
    root,
    ...(mid ? {mid} : {}),
    effector,
    target,
    ...(pole ? {pole} : {}),
    solver,
    iterations: Math.round(clampNum(r['iterations'], 1, 32, 8)),
    tolerance: clampNum(r['tolerance'], 1e-5, 0.1, 1e-3),
    weight: clampNum(r['weight'], 0, 1, 1),
  };
}

/** Single distance-based level of detail (`lod`). */
export interface LodLevel {
  /** Camera distance threshold in meters (>= 0). */
  readonly distance: number;
  /** Optional per-level hysteresis fraction (`0..0.5`). */
  readonly hysteresis?: number;
  /** Optional vertex decimation ratio (`0.05..1.0`) for auto-decimated levels. */
  readonly ratio?: number;
  /** Child index (`0..K-1`) under the LOD parent node. */
  readonly childIndex?: number;
  /** Optional named child mesh node. */
  readonly node?: string;
}

/** Normalized level-of-detail trait (`userData.xr.lod`). */
export interface LodOptions {
  /** Monotonically sorted LOD levels (starting with level 0 at distance 0). */
  readonly levels: readonly LodLevel[];
  /** Monotonically sorted distance thresholds `[0, d1, d2, ...]`. */
  readonly distances: readonly number[];
  /** Optional vertex decimation ratios `[r1, r2, ...]` for declarative auto-decimation. */
  readonly ratios?: readonly number[];
  /** Hysteresis deadband fraction (`0..0.5`, default `0.05`). */
  readonly hysteresis: number;
  /** Optional far distance threshold in meters beyond which all LOD levels are culled (`1..10000`). */
  readonly cullDistance?: number;
}

/**
 * Selects the active LOD level index (`0..distances.length - 1`), or `-1` when
 * culled beyond `cullDistance`, applying a symmetric hysteresis deadband around
 * each distance threshold so camera micro-jitter does not flicker levels.
 */
export function selectLodLevelIndex(
  distances: readonly number[],
  currentDistance: number,
  previousIndex = 0,
  hysteresis = 0.05,
  cullDistance?: number,
): number {
  if (!distances.length) return -1;
  const thresh = distances[0] > 0 ? [0, ...distances] : distances;
  const d = Number.isFinite(currentDistance) ? Math.max(0, currentDistance) : 0;
  const h = Number.isFinite(hysteresis)
    ? Math.max(0, Math.min(0.5, hysteresis))
    : 0.05;
  if (
    typeof cullDistance === 'number' &&
    Number.isFinite(cullDistance) &&
    cullDistance > 0
  ) {
    const cullThreshold =
      previousIndex === -1 ? cullDistance * (1 - h) : cullDistance * (1 + h);
    if (d > cullThreshold) return -1;
  }
  let baseIdx = 0;
  for (let i = thresh.length - 1; i >= 1; i--) {
    if (d >= thresh[i]) {
      baseIdx = i;
      break;
    }
  }
  if (
    previousIndex < 0 ||
    previousIndex >= thresh.length ||
    previousIndex === baseIdx
  ) {
    return baseIdx;
  }
  if (baseIdx > previousIndex) {
    let idx = previousIndex;
    for (let i = previousIndex + 1; i <= baseIdx; i++) {
      if (d >= thresh[i] * (1 + h)) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }
  let idx = previousIndex;
  for (let i = previousIndex; i > baseIdx; i--) {
    if (d < thresh[i] * (1 - h)) {
      idx = i - 1;
    } else {
      break;
    }
  }
  return idx;
}

/** Parses a `lod` trait (`true`, distance array, or `{levels?, distances?, ratios?, hysteresis?, cullDistance?}`). */
export function parseLod(raw: unknown): LodOptions | null {
  if (!raw) return null;
  const r =
    raw === true
      ? {distances: [4, 10], ratios: [0.5, 0.25]}
      : Array.isArray(raw)
        ? {distances: raw}
        : asRecord(raw);
  if (!r || r['enabled'] === false) return null;
  const hysteresis = clampNum(r['hysteresis'], 0, 0.5, 0.05);
  let levels: LodLevel[] = [];
  let ratios: number[] | undefined;

  if (Array.isArray(r['levels']) && r['levels'].length > 0) {
    const rawLevels = r['levels'].slice(0, 8);
    for (let i = 0; i < rawLevels.length; i++) {
      const lv = asRecord(rawLevels[i]);
      if (!lv) continue;
      const dist = clampNum(lv['distance'], 0, 10000, i === 0 ? 0 : i * 4);
      const h =
        typeof lv['hysteresis'] === 'number'
          ? clampNum(lv['hysteresis'], 0, 0.5, hysteresis)
          : undefined;
      const ratio =
        typeof lv['ratio'] === 'number'
          ? clampNum(lv['ratio'], 0.05, 1, 0.5)
          : undefined;
      const childIndex =
        typeof lv['childIndex'] === 'number' &&
        Number.isFinite(lv['childIndex'])
          ? Math.max(0, Math.round(lv['childIndex']))
          : undefined;
      const node = safeAnchorId(lv['node']);
      levels.push({
        distance: dist,
        ...(h !== undefined ? {hysteresis: h} : {}),
        ...(ratio !== undefined ? {ratio} : {}),
        ...(childIndex !== undefined ? {childIndex} : {}),
        ...(node ? {node} : {}),
      });
    }
    levels.sort((a, b) => a.distance - b.distance);
    if (levels.length > 0 && levels[0].distance > 0) {
      levels.unshift({distance: 0, childIndex: 0});
    }
    // Enforce monotonic non-decreasing distances and default childIndex
    let prevD = 0;
    levels = levels.slice(0, 8).map((lv, idx) => {
      const d = idx === 0 ? 0 : Math.max(prevD, lv.distance);
      prevD = d;
      return {
        ...lv,
        distance: d,
        childIndex: lv.childIndex ?? idx,
      };
    });
  }

  if (Array.isArray(r['ratios']) && r['ratios'].length > 0) {
    const parsedRatios: number[] = [];
    for (const rv of r['ratios'].slice(0, 7)) {
      if (typeof rv === 'number') {
        parsedRatios.push(clampNum(rv, 0.05, 1, 0.5));
      }
    }
    if (parsedRatios.length > 0) ratios = parsedRatios;
  }

  if (levels.length === 0) {
    const rawDist = Array.isArray(r['distances']) ? r['distances'] : [];
    const numDist: number[] = [];
    for (const dv of rawDist.slice(0, 8)) {
      if (typeof dv === 'number') {
        numDist.push(clampNum(dv, 0, 10000, 4));
      }
    }
    if (numDist.length === 0 && ratios && ratios.length > 0) {
      for (let i = 0; i < ratios.length; i++) {
        numDist.push((i + 1) * 4);
      }
    }
    if (numDist.length === 0 && r['cullDistance'] === undefined) {
      return null;
    }
    if (numDist.length === 0 || numDist[0] > 0) {
      numDist.unshift(0);
    } else if (ratios && ratios.length === numDist.length && ratios[0] === 1) {
      ratios = ratios.slice(1);
    }
    let prevD = 0;
    for (let i = 0; i < Math.min(8, numDist.length); i++) {
      const d = i === 0 ? 0 : Math.max(prevD, numDist[i]);
      prevD = d;
      const ratio = i > 0 && ratios ? ratios[i - 1] : undefined;
      levels.push({
        distance: d,
        childIndex: i,
        ...(ratio !== undefined ? {ratio} : {}),
      });
    }
  } else if (!ratios) {
    const levelRatios: number[] = [];
    for (let i = 1; i < levels.length; i++) {
      if (typeof levels[i].ratio === 'number') {
        levelRatios.push(levels[i].ratio!);
      }
    }
    if (levelRatios.length > 0) ratios = levelRatios;
  }

  const distances = levels.map((l) => l.distance);
  const maxLevelDist = distances[distances.length - 1] ?? 0;
  const cullDistance =
    r['cullDistance'] !== undefined &&
    r['cullDistance'] !== null &&
    r['cullDistance'] !== false
      ? clampNum(r['cullDistance'], Math.max(1, maxLevelDist), 10000, 100)
      : undefined;

  return {
    levels,
    distances,
    ...(ratios ? {ratios} : {}),
    hysteresis,
    ...(cullDistance !== undefined ? {cullDistance} : {}),
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
  anchor?: 'horizontal' | 'vertical' | 'floor' | 'wall' | 'ceiling' | 'table';
  anchorPersist?: AnchorPersistOptions;
  physics?: 'dynamic' | 'static';
  orbit?: OrbitOptions;
  handles?: HandlesOptions;
  particles?: ParticleOptions;
  holdToAsk?: HoldToAskOptions;
  worldUnderstanding?: WorldUnderstandingTrait;
  splatUrl?: string;
  splatQuality?: 'standard' | 'high';
  spatialSlot?: string;
  audio?: SpatialAudioTrait;
  dimensions?: DimensionsOptions;
  snapTo?: SnapToOptions;
  snapSocket?: SnapSocketOptions;
  gaze?: GazeOptions;
  explode?: ExplodeOptions;
  navigable?: NavigableMode;
  text?: TextTraitOptions;
  bloom?: BloomTraitOptions;
  outline?: OutlineTraitOptions;
  ik?: IKTraitOptions;
  lod?: LodOptions;
  sync?: boolean;
  pointerEvents?: 'none';
  character?: CharacterOptions;
  agent?: AgentOptions;
  integrity?: IntegrityOptions;
  zone?: ZoneOptions;
  spawner?: SpawnerOptions;
  objective?: ObjectiveOptions;
  audioCues?: AudioCueOptions;
  audioEmitter?: AudioEmitterOptions;
  rigidBody?: PhysicsBodyOptions;
  /** Static obstacle for `character-controller` and `steering-agents`. */
  collidable?: true;
}

const ANCHORS = new Set([
  'horizontal',
  'vertical',
  'floor',
  'wall',
  'ceiling',
  'table',
]);
const BILLBOARDS = new Set(['capsule', 'cylindrical', 'spherical']);

/**
 * Optional trait family (such as `xr-sim-schema.ts`) that extends
 * normalization and serialization without growing bundles that don't use it.
 */
export interface XRTraitExtension {
  /** Parses this family's keys from the authored bag into `out`. */
  normalize(raw: Record<string, unknown>, out: NormalizedXRTraits): void;
  /** Adds this family's `ANDROID_xr_scenecore` components to `comp`. */
  sceneCore(n: NormalizedXRTraits, comp: Record<string, unknown>): void;
  /** Adds this family's flat USD `customData` entries to `out`. */
  usd(
    n: NormalizedXRTraits,
    put: (prefix: string, obj: object) => void,
    out: Record<string, UsdCustomValue>,
  ): void;
}

// Module-scoped (not on the shared global registry) so untrusted scene scripts
// in the compiler engine cannot inject extensions.
const XR_TRAIT_EXTENSIONS: XRTraitExtension[] = [];

/** Registers an optional trait family. Idempotent per extension object. */
export function registerXRTraitExtension(ext: XRTraitExtension): void {
  if (!XR_TRAIT_EXTENSIONS.includes(ext)) XR_TRAIT_EXTENSIONS.push(ext);
}

/**
 * Normalizes an authored `userData.xr` bag into {@link NormalizedXRTraits}.
 * Accepts legacy aliases (`grabbable`, `scalable`, `traits: ['grab', ...]`).
 * Returns `null` when no recognized trait is present.
 */
export function normalizeXRTraits(raw: unknown): NormalizedXRTraits | null {
  const r = asRecord(raw);
  if (!r) return null;
  const traitList = Array.isArray(r['traits'])
    ? (r['traits'] as unknown[])
    : [];
  const has = (name: string): boolean => traitList.includes(name);
  const out: NormalizedXRTraits = {};

  const grab = r['grab'] ?? r['grabbable'];
  if (grab === '1-hand' || grab === '2-hand') out.grab = grab;
  else if (
    grab === true ||
    r['draggable'] === true ||
    r['movable'] === true ||
    r['interactable'] === true ||
    r['interactive'] === true ||
    has('grab')
  )
    out.grab = '2-hand';
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
  const followMode =
    typeof follow === 'string' ? follow : asRecord(follow)?.['mode'];
  if (
    typeof follow === 'string' ? follow : asRecord(follow)?.['lazy'] === false
  ) {
    // Strings and `{lazy: false}` objects are eager spring follows.
    out.follow =
      followMode === 'hand-left' || followMode === 'hand-right'
        ? followMode
        : 'head';
  } else {
    const lazy = parseLazyFollow(follow);
    if (lazy) out.follow = lazy;
  }

  const anchor =
    r['anchor'] ??
    (r['floor'] === true || r['ground'] === true ? 'floor' : undefined);
  if (typeof anchor === 'string' && ANCHORS.has(anchor)) {
    out.anchor = anchor as NormalizedXRTraits['anchor'];
  } else {
    const anchorObj = asRecord(anchor);
    const target = anchorObj?.['target'];
    if (typeof target === 'string' && ANCHORS.has(target)) {
      out.anchor = target as NormalizedXRTraits['anchor'];
    }
    const persist =
      parseAnchorPersist(anchor) ?? parseAnchorPersist(r['anchorPersist']);
    if (persist) out.anchorPersist = persist;
  }
  if (!out.anchorPersist) {
    const persistExplicit =
      parseAnchorPersist(r['anchorPersist']) ??
      (out.anchor && r['persist'] === true
        ? {
            persist: true,
            ...(safeAnchorId(r['id']) ? {id: safeAnchorId(r['id'])} : {}),
          }
        : null);
    if (persistExplicit) out.anchorPersist = persistExplicit;
  }
  if (r['physics'] === 'dynamic' || r['physics'] === 'static')
    out.physics = r['physics'];

  const orbit = parseOrbit(
    r['orbit'] ??
      (typeof r['radius'] === 'number' &&
      (typeof r['speed'] === 'number' || r['target'] !== undefined) &&
      r['character'] === undefined &&
      r['agent'] === undefined &&
      r['zone'] === undefined &&
      r['objective'] === undefined &&
      r['snapTo'] === undefined &&
      r['snapSocket'] === undefined
        ? r
        : undefined),
  );
  if (orbit) out.orbit = orbit;
  const handles = parseHandles(
    r['handles'] ?? r['resizable'] ?? r['scaleLimits'],
  );
  if (handles) out.handles = handles;
  const particles = parseParticles(r['particles'] ?? r['emitter']);
  if (particles) out.particles = particles;
  const hold = parseHoldToAsk(r['holdToAsk']);
  if (hold) out.holdToAsk = hold;
  const wu = parseWorldUnderstanding(r['worldUnderstanding']);
  if (wu) out.worldUnderstanding = wu;
  const splat = safeMediaUrl(r['splatUrl']);
  if (splat) out.splatUrl = splat;
  if (r['splatQuality'] === 'high' || r['splatQuality'] === 'standard') {
    out.splatQuality = r['splatQuality'];
  }
  const slot = shortString(r['spatialSlot']);
  if (slot) out.spatialSlot = slot;
  const isStringPreset =
    typeof r['audio'] === 'string' && isAudioPresetName(r['audio'].trim());
  const audio = isStringPreset ? null : parseSpatialAudio(r['audio']);
  if (audio) out.audio = audio;
  const rawEmitter =
    r['audioEmitter'] ??
    r['spatialAudio'] ??
    r['positionalAudio'] ??
    r['sound'] ??
    r['panner'];
  if (rawEmitter !== undefined) {
    const emitter = parseAudioEmitter(rawEmitter);
    if (emitter) out.audioEmitter = emitter;
  } else if (r['audio'] !== undefined) {
    const audioRec = asRecord(r['audio']);
    const hasExtendedKeys = Boolean(
      audioRec &&
        ('preset' in audioRec ||
          'type' in audioRec ||
          'positional' in audioRec ||
          'volume' in audioRec ||
          'gain' in audioRec ||
          'pitch' in audioRec ||
          'playbackRate' in audioRec ||
          'autoplay' in audioRec ||
          'autoPlay' in audioRec ||
          'distanceModel' in audioRec ||
          'maxDistance' in audioRec ||
          'rolloffFactor' in audioRec ||
          'coneInnerAngle' in audioRec ||
          'coneOuterAngle' in audioRec ||
          'coneOuterGain' in audioRec ||
          'playOnSelect' in audioRec ||
          'playOnTap' in audioRec),
    );
    if (!audio || hasExtendedKeys) {
      const emitter = parseAudioEmitter(r['audio']);
      if (emitter) out.audioEmitter = emitter;
    }
  }
  const dims = parseDimensions(
    r['dimensions'] ?? r['measure'] ?? r['measurement'] ?? r['ruler'],
  );
  if (dims) out.dimensions = dims;
  const snapTo = parseSnapTo(r['snapTo'] ?? r['snap'] ?? r['magnetic']);
  if (snapTo) out.snapTo = snapTo;
  const snapSocket = parseSnapSocket(r['snapSocket']);
  if (snapSocket) out.snapSocket = snapSocket;
  const gaze = parseGaze(r['gaze'] ?? r['dwell']);
  if (gaze) out.gaze = gaze;
  const explode = parseExplode(
    r['explode'] ?? r['exploded'] ?? r['disassemble'],
  );
  if (explode) out.explode = explode;
  const navigable = parseNavigable(
    r['navigable'] ??
      (r['walkable'] !== undefined
        ? r['walkable']
          ? 'walkable'
          : 'blocked'
        : r['teleport'] === true
          ? 'walkable'
          : undefined),
  );
  if (navigable) out.navigable = navigable;
  const textTrait = parseTextTrait(
    r['text'] ?? r['label'] ?? r['title'] ?? r['caption'] ?? r['spatialLabel'],
  );
  if (textTrait) out.text = textTrait;
  const bloomTrait = parseBloomTrait(r['bloom'] ?? r['glow']);
  if (bloomTrait) out.bloom = bloomTrait;
  const outlineTrait = parseOutlineTrait(r['outline']);
  if (outlineTrait) out.outline = outlineTrait;
  const ikTrait = parseIKTrait(r['ik']);
  if (ikTrait) out.ik = ikTrait;
  const lodTrait = parseLod(
    r['lod'] ??
      r['levelOfDetail'] ??
      r['detail'] ??
      r['decimate'] ??
      r['simplify'],
  );
  if (lodTrait) out.lod = lodTrait;
  if (typeof r['sync'] === 'boolean') out.sync = r['sync'];
  if (r['pointerEvents'] === 'none') out.pointerEvents = 'none';

  for (const ext of XR_TRAIT_EXTENSIONS) ext.normalize(r, out);

  return Object.keys(out).length > 0 ? out : null;
}

/** Canonical schema version for `ANDROID_xr_scenecore` and USD `customData.xr`. */
export const XR_TRAIT_SCHEMA_VERSION = 1;

/**
 * Builds the `ANDROID_xr_scenecore` node extension (Jetpack XR SceneCore
 * component descriptors) for a normalized trait set.
 */
export function buildXRSceneCoreExtension(
  n: NormalizedXRTraits,
): Record<string, unknown> {
  const comp: Record<string, unknown> = {
    schemaVersion: XR_TRAIT_SCHEMA_VERSION,
  };
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
  if (n.anchor || n.anchorPersist) {
    const anchorComp: Record<string, unknown> = {};
    if (n.anchor) {
      anchorComp['planeType'] =
        n.anchor === 'vertical' || n.anchor === 'wall'
          ? 'VERTICAL'
          : 'HORIZONTAL';
      anchorComp['semanticType'] = n.anchor.toUpperCase();
    }
    if (n.anchorPersist) {
      anchorComp['persist'] = n.anchorPersist.persist;
      if (n.anchorPersist.id) anchorComp['id'] = n.anchorPersist.id;
    }
    comp['anchor'] = anchorComp;
  }
  if (n.physics) comp['rigidbody'] = {type: n.physics};
  if (n.orbit) comp['orbit'] = {...n.orbit};
  if (n.handles) comp['resizable'] = {...n.handles};
  if (n.particles) comp['particles'] = {...n.particles};
  if (n.holdToAsk) comp['holdToAsk'] = {...n.holdToAsk};
  if (n.worldUnderstanding)
    comp['worldUnderstanding'] = {...n.worldUnderstanding};
  if (n.splatUrl) {
    comp['splat'] = n.splatQuality
      ? {url: n.splatUrl, quality: n.splatQuality}
      : {url: n.splatUrl};
  }
  if (n.spatialSlot) comp['spatialPanel'] = {slot: n.spatialSlot};
  if (n.audio) comp['spatialAudio'] = {...n.audio};
  if (n.audioEmitter) comp['audioEmitter'] = {...n.audioEmitter};
  if (n.dimensions)
    comp['dimensions'] = {...n.dimensions, axes: [...n.dimensions.axes]};
  if (n.snapTo) {
    comp['snapTo'] = {
      ...n.snapTo,
      grid: n.snapTo.grid ? [...n.snapTo.grid] : null,
    };
  }
  if (n.snapSocket) comp['snapSocket'] = {...n.snapSocket};
  if (n.gaze) comp['gaze'] = {...n.gaze};
  if (n.explode) {
    comp['explode'] = {
      ...n.explode,
      direction: n.explode.direction ? [...n.explode.direction] : null,
    };
  }
  if (n.navigable) comp['navigable'] = {mode: n.navigable};
  if (n.text) comp['text3d'] = {...n.text};
  if (n.bloom) comp['bloom'] = {...n.bloom};
  if (n.outline) comp['outline'] = {...n.outline};
  if (n.ik) {
    comp['ik'] = {
      ...n.ik,
      ...(Array.isArray(n.ik.target) ? {target: [...n.ik.target]} : {}),
      ...(Array.isArray(n.ik.pole) ? {pole: [...n.ik.pole]} : {}),
    };
  }
  if (n.lod) {
    comp['lod'] = {
      distances: [...n.lod.distances],
      ...(n.lod.ratios ? {ratios: [...n.lod.ratios]} : {}),
      hysteresis: n.lod.hysteresis,
      ...(n.lod.cullDistance !== undefined
        ? {cullDistance: n.lod.cullDistance}
        : {}),
    };
  }
  if (typeof n.sync === 'boolean') comp['sync'] = {enabled: n.sync};
  for (const ext of XR_TRAIT_EXTENSIONS) ext.sceneCore(n, comp);
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
  const out: Record<string, UsdCustomValue> = {
    schemaVersion: XR_TRAIT_SCHEMA_VERSION,
  };
  const put = (prefix: string, obj: object): void => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix + k[0].toUpperCase() + k.slice(1);
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      )
        out[key] = v;
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
  if (n.anchorPersist) {
    out['anchorPersist'] = n.anchorPersist.persist;
    if (n.anchorPersist.id) out['anchorId'] = n.anchorPersist.id;
  }
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
  if (n.splatQuality) out['splatQuality'] = n.splatQuality;
  if (n.spatialSlot) out['spatialSlot'] = n.spatialSlot;
  if (n.audio) put('audio', n.audio);
  if (n.audioEmitter) put('audioEmitter', n.audioEmitter);
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
  if (n.navigable) out['navigable'] = n.navigable;
  if (n.text) put('text', n.text);
  if (n.bloom) put('bloom', n.bloom);
  if (n.outline) put('outline', n.outline);
  if (n.ik) put('ik', n.ik);
  if (n.lod) {
    out['lodEnabled'] = true;
    out['lodHysteresis'] = n.lod.hysteresis;
    out['lodDistances'] = n.lod.distances.join(',');
    if (n.lod.ratios) out['lodRatios'] = n.lod.ratios.join(',');
    if (n.lod.cullDistance !== undefined) {
      out['lodCullDistance'] = n.lod.cullDistance;
    }
  }
  if (typeof n.sync === 'boolean') out['sync'] = n.sync;
  if (n.pointerEvents) out['pointerEvents'] = n.pointerEvents;
  for (const ext of XR_TRAIT_EXTENSIONS) ext.usd(n, put, out);
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
  const mergedXR: Record<string, unknown> = {...node.extras?.xr, ...normalized};
  if (
    normalized.anchor === undefined &&
    typeof mergedXR['anchor'] === 'object'
  ) {
    delete mergedXR['anchor'];
  }
  if (
    normalized.physics === undefined &&
    typeof mergedXR['physics'] === 'object'
  ) {
    delete mergedXR['physics'];
  }
  node.extras = {...node.extras, xr: mergedXR};
  node.extensions = {
    ...node.extensions,
    MOZ_hubs_components: buildHubsExtension(normalized),
    ANDROID_xr_scenecore: buildXRSceneCoreExtension(normalized),
  };
}

/** Builds the Mozilla Hubs `MOZ_hubs_components` map for normalized traits. */
export function buildHubsExtension(
  n: NormalizedXRTraits,
): Record<string, unknown> {
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
  for (const [key, value] of Object.entries(
    flattenXRTraitsForUsd(normalized),
  )) {
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
      value: Object.freeze({
        gltfNode: upgradeGltfNodeXR,
        usdLines: buildUsdXRLines,
      }),
      writable: false,
      configurable: false,
      enumerable: true,
    });
  } catch {
    // Already registered (e.g. a second bundle on the same page).
  }
}

/** Structured compiler/schema diagnostic emitted during scene validation. */
export interface SchemaDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning' | 'info';
  readonly message: string;
  readonly node?: string;
  readonly hint?: string;
}

const CANONICAL_XR_KEYS: ReadonlySet<string> = new Set([
  'grab',
  'scale',
  'billboard',
  'follow',
  'anchor',
  'anchorPersist',
  'physics',
  'orbit',
  'handles',
  'particles',
  'holdToAsk',
  'worldUnderstanding',
  'splatUrl',
  'splatQuality',
  'spatialSlot',
  'audio',
  'audioEmitter',
  'spatialAudio',
  'dimensions',
  'snapTo',
  'snapSocket',
  'gaze',
  'explode',
  'navigable',
  'text',
  'bloom',
  'outline',
  'ik',
  'lod',
  'sync',
  'pointerEvents',
  'character',
  'agent',
  'integrity',
  'zone',
  'spawner',
  'objective',
  'audioCues',
  'rigidBody',
  'collidable',
  'traits',
  'schemaVersion',
]);

const XR_KEY_SYNONYMS: Readonly<
  Record<string, {target: string; hint: string}>
> = {
  rigidbody: {
    target: 'rigidBody',
    hint: "Use 'rigidBody: { body: \"dynamic\", mass: 1, restitution: 0.35 }' or 'physics' instead of 'rigidbody'.",
  },
  levelofdetail: {
    target: 'lod',
    hint: "Use 'lod: { distances: [3, 8], ratios: [0.5, 0.2] }' instead of 'levelOfDetail'.",
  },
  detail: {
    target: 'lod',
    hint: "Use 'lod: { distances: [3, 8], ratios: [0.5, 0.2] }' instead of 'detail'.",
  },
  decimate: {
    target: 'lod',
    hint: "Use 'lod: { distances: [3, 8], ratios: [0.5, 0.2] }' instead of 'decimate'.",
  },
  simplify: {
    target: 'lod',
    hint: "Use 'lod: { distances: [3, 8], ratios: [0.5, 0.2] }' instead of 'simplify'.",
  },
  grabbable: {
    target: 'grab',
    hint: "Use 'grab: true' or 'grab: \"1-hand\" | \"2-hand\"' instead of 'grabbable'.",
  },
  draggable: {
    target: 'grab',
    hint: "Use 'grab: true' or 'grab: \"1-hand\" | \"2-hand\"' instead of 'draggable'.",
  },
  movable: {
    target: 'grab',
    hint: "Use 'grab: true' or 'grab: \"1-hand\" | \"2-hand\"' instead of 'movable'.",
  },
  interactable: {
    target: 'grab',
    hint: "Use 'grab: true' or 'userData.interactivity' instead of 'interactable'.",
  },
  scalable: {
    target: 'scale',
    hint: "Use 'scale: { min: 0.05, max: 5 }' instead of 'scalable'.",
  },
  resizable: {
    target: 'handles',
    hint: "Use 'handles: true' or 'scale: { min, max }' instead of 'resizable'.",
  },
  health: {
    target: 'integrity',
    hint: "Use 'integrity: { max: 100, group: \"...\" }' instead of 'health'.",
  },
  hp: {
    target: 'integrity',
    hint: "Use 'integrity: { max: 100, group: \"...\" }' instead of 'hp'.",
  },
  hitpoints: {
    target: 'integrity',
    hint: "Use 'integrity: { max: 100, group: \"...\" }' instead of 'hitpoints'.",
  },
  damage: {
    target: 'integrity',
    hint: "Use 'integrity: { contactAmount: ... }' instead of 'damage'.",
  },
  team: {
    target: 'integrity',
    hint: "Use 'integrity: { group: \"...\" }' instead of 'team'.",
  },
  faction: {
    target: 'integrity',
    hint: "Use 'integrity: { group: \"...\" }' instead of 'faction'.",
  },
  collides: {
    target: 'collidable',
    hint: "Use 'collidable: true' or 'physics: \"static\" | \"dynamic\"' instead of 'collides'.",
  },
  collider: {
    target: 'collidable',
    hint: "Use 'collidable: true' or 'physics: \"static\" | \"dynamic\"' instead of 'collider'.",
  },
  solid: {
    target: 'collidable',
    hint: "Use 'collidable: true' instead of 'solid'.",
  },
  obstacle: {
    target: 'collidable',
    hint: "Use 'collidable: true' instead of 'obstacle'.",
  },
  walkable: {
    target: 'navigable',
    hint: "Use 'navigable: \"walkable\"' instead of 'walkable'.",
  },
  floor: {
    target: 'anchor',
    hint: "Use 'anchor: \"floor\"' or 'navigable: \"walkable\"' instead of 'floor'.",
  },
  ground: {
    target: 'anchor',
    hint: "Use 'anchor: \"floor\"' or 'navigable: \"walkable\"' instead of 'ground'.",
  },
  teleport: {
    target: 'navigable',
    hint: "Use 'navigable: \"walkable\"' instead of 'teleport'.",
  },
  sound: {
    target: 'audioEmitter',
    hint: "Use 'audioEmitter: { preset: \"hum\", refDistance: 1 }' or 'audio' instead of 'sound'.",
  },
  positionalaudio: {
    target: 'audioEmitter',
    hint: "Use 'audioEmitter: { preset: \"hum\", refDistance: 1 }' instead of 'positionalAudio'.",
  },
  panner: {
    target: 'audioEmitter',
    hint: "Use 'audioEmitter: { preset: \"hum\", coneInnerAngle: 90 }' instead of 'panner'.",
  },
  sfx: {
    target: 'audioCues',
    hint: "Use 'audioCues: { onTap: \"confirm\" }' instead of 'sfx'.",
  },
  measure: {
    target: 'dimensions',
    hint: "Use 'dimensions: true' instead of 'measure'.",
  },
  interactive: {
    target: 'grab',
    hint: "Use 'grab: true' instead of 'interactive'.",
  },
  scaleLimits: {
    target: 'handles',
    hint: "Use 'handles: { minScale, maxScale }' instead of 'scaleLimits'.",
  },
  scalelimits: {
    target: 'handles',
    hint: "Use 'handles: { minScale, maxScale }' instead of 'scaleLimits'.",
  },
  spatialLabel: {
    target: 'text',
    hint: "Use 'text: \"...\"' instead of 'spatialLabel'.",
  },
  spatiallabel: {
    target: 'text',
    hint: "Use 'text: \"...\"' instead of 'spatialLabel'.",
  },
  measurement: {
    target: 'dimensions',
    hint: "Use 'dimensions: true' instead of 'measurement'.",
  },
  ruler: {
    target: 'dimensions',
    hint: "Use 'dimensions: true' instead of 'ruler'.",
  },
  snap: {
    target: 'snapTo',
    hint: "Use 'snapTo' or 'snapSocket' instead of 'snap'.",
  },
  magnetic: {
    target: 'snapTo',
    hint: "Use 'snapTo' or 'snapSocket' instead of 'magnetic'.",
  },
  dwell: {
    target: 'gaze',
    hint: "Use 'gaze: { dwellMs: 1200 }' instead of 'dwell'.",
  },
  exploded: {
    target: 'explode',
    hint: "Use 'explode: { distance: 0.35, layer: 1 }' instead of 'exploded'.",
  },
  disassemble: {
    target: 'explode',
    hint: "Use 'explode: true' instead of 'disassemble'.",
  },
  label: {
    target: 'text',
    hint: "Use 'text: { text: \"...\", size: 0.12 }' instead of 'label'.",
  },
  title: {
    target: 'text',
    hint: "Use 'text: { text: \"...\", size: 0.12 }' instead of 'title'.",
  },
  caption: {
    target: 'text',
    hint: "Use 'text: { text: \"...\", size: 0.12 }' instead of 'caption'.",
  },
  mass: {
    target: 'rigidBody',
    hint: "Use 'rigidBody: { body: \"dynamic\", mass: 1 }' instead of top-level 'mass'.",
  },
  restitution: {
    target: 'rigidBody',
    hint: "Use 'rigidBody: { body: \"dynamic\", restitution: 0.35 }' instead of top-level 'restitution'.",
  },
  bounciness: {
    target: 'rigidBody',
    hint: "Use 'rigidBody: { body: \"dynamic\", restitution: 0.35 }' instead of 'bounciness'.",
  },
  friction: {
    target: 'rigidBody',
    hint: "Use 'rigidBody: { body: \"dynamic\", friction: 0.5 }' instead of top-level 'friction'.",
  },
  glow: {
    target: 'bloom',
    hint: "Use 'bloom: { strength: 0.5 }' or 'outline' instead of 'glow'.",
  },
  emissive: {
    target: 'bloom',
    hint: "Use 'bloom: { strength: 0.5 }' on userData.xr or material.emissive.",
  },
  ai: {
    target: 'agent',
    hint: 'Use \'agent: { mode: "patrol" | "chase" | "wander" }\' instead of \'ai\'.',
  },
  npc: {
    target: 'agent',
    hint: "Use 'agent: { mode: \"wander\" }' instead of 'npc'.",
  },
  enemy: {
    target: 'agent',
    hint: "Use 'agent: { mode: \"chase\" }' and 'integrity: { group: \"enemy\" }' instead of 'enemy'.",
  },
  bot: {
    target: 'agent',
    hint: "Use 'agent: { mode: \"patrol\" }' instead of 'bot'.",
  },
  steering: {
    target: 'agent',
    hint: "Use 'agent' instead of 'steering'.",
  },
  player: {
    target: 'character',
    hint: "Use 'character: { speed: 4, cameraMode: \"third-person\" }' instead of 'player'.",
  },
  avatar: {
    target: 'character',
    hint: "Use 'character: true' instead of 'avatar'.",
  },
  controller: {
    target: 'character',
    hint: "Use 'character: true' instead of 'controller'.",
  },
  trigger: {
    target: 'zone',
    hint: "Use 'zone: { shape: \"box\", size: [1, 1, 1] }' instead of 'trigger'.",
  },
  hitbox: {
    target: 'zone',
    hint: "Use 'zone' or 'integrity' instead of 'hitbox'.",
  },
  sensor: {
    target: 'zone',
    hint: "Use 'zone' instead of 'sensor'.",
  },
  hazard: {
    target: 'zone',
    hint: "Use 'zone: { shape: \"box\", watchGroups: [\"player\"] }' instead of 'hazard'.",
  },
  persist: {
    target: 'anchorPersist',
    hint: "Use 'anchor: { target: \"wall\", persist: true }' or 'anchorPersist: { persist: true }' instead of top-level 'persist'.",
  },
  spawn: {
    target: 'spawner',
    hint: "Use 'spawner: { template: \"...\" }' instead of 'spawn'.",
  },
  emitter: {
    target: 'particles',
    hint: "Use 'particles: { preset: \"sparks\" }' or 'spawner' instead of 'emitter'.",
  },
  goal: {
    target: 'objective',
    hint: 'Use \'objective: { type: "pickup" | "checkpoint" }\' instead of \'goal\'.',
  },
  quest: {
    target: 'objective',
    hint: "Use 'objective' instead of 'quest'.",
  },
  collectible: {
    target: 'objective',
    hint: "Use 'objective: { type: \"pickup\" }' instead of 'collectible'.",
  },
  pickup: {
    target: 'objective',
    hint: "Use 'objective: { type: \"pickup\" }' instead of 'pickup'.",
  },
};

function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({length: n + 1}, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

let canonicalKeyListCache: string[] | null = null;

function closestCanonicalTrait(key: string): string | null {
  const lower = key.toLowerCase();
  let best: string | null = null;
  let bestDist = 4;
  const list = (canonicalKeyListCache ??= Array.from(CANONICAL_XR_KEYS));
  for (let i = 0; i < list.length; i++) {
    const cand = list[i];
    if (cand === 'traits') continue;
    const d = editDistance(lower, cand.toLowerCase());
    if (d < bestDist) {
      bestDist = d;
      best = cand;
    }
  }
  return best;
}

/**
 * Validates an authored `userData.xr` bag and returns structured `TL201`
 * (unknown/synonym key), `TL202` (clamped numeric range), and `TL203`
 * (security rejection) diagnostics.
 */
export function validateXRTraits(
  raw: unknown,
  nodeName = 'unnamed',
): SchemaDiagnostic[] {
  const diags: SchemaDiagnostic[] = [];
  if (raw === undefined || raw === null) return diags;
  const pushDiag = (
    code: string,
    message: string,
    hint: string,
    severity: 'warning' | 'error' | 'info' = 'warning',
  ) => diags.push({code, severity, node: nodeName, message, hint});
  const r = asRecord(raw);
  if (!r) {
    pushDiag(
      'TL201',
      `userData.xr on node '${nodeName}' must be a plain object.`,
      'Assign an object such as mesh.userData.xr = { grab: true }.',
    );
    return diags;
  }

  for (const key of Object.keys(r)) {
    if (CANONICAL_XR_KEYS.has(key)) continue;
    const syn = XR_KEY_SYNONYMS[key] ?? XR_KEY_SYNONYMS[key.toLowerCase()];
    if (syn) {
      pushDiag(
        'TL201',
        `Unrecognized key '${key}' in userData.xr on node '${nodeName}' (auto-normalized to '${syn.target}'); did you mean '${syn.target}'?`,
        syn.hint,
        'info',
      );
    } else if (
      (key === 'radius' || key === 'speed' || key === 'target') &&
      typeof r['radius'] === 'number' &&
      (typeof r['speed'] === 'number' || r['target'] !== undefined) &&
      r['character'] === undefined &&
      r['player'] === undefined &&
      r['avatar'] === undefined &&
      r['controller'] === undefined
    ) {
      pushDiag(
        'TL201',
        `Top-level '${key}' in userData.xr on node '${nodeName}' auto-normalized to 'orbit.${key}'.`,
        "Use 'orbit: { target, radius, speed }' instead of top-level orbit properties.",
        'info',
      );
    } else if (
      (key === 'speed' || key === 'height' || key === 'radius') &&
      (r['character'] !== undefined ||
        r['player'] !== undefined ||
        r['avatar'] !== undefined ||
        r['controller'] !== undefined)
    ) {
      pushDiag(
        'TL201',
        `Top-level '${key}' in userData.xr on node '${nodeName}' auto-normalized to 'character.${key}'.`,
        "Use 'character: { speed, height, radius }' instead of top-level character properties.",
        'info',
      );
    } else if (
      key === 'radius' &&
      (r['zone'] !== undefined ||
        r['trigger'] !== undefined ||
        r['hitbox'] !== undefined ||
        r['sensor'] !== undefined ||
        r['hazard'] !== undefined)
    ) {
      pushDiag(
        'TL201',
        `Top-level 'radius' in userData.xr on node '${nodeName}' auto-normalized to 'zone.radius'.`,
        "Use 'zone: { shape: \"sphere\", radius }' instead of top-level 'radius'.",
        'info',
      );
    } else {
      const closest = closestCanonicalTrait(key);
      pushDiag(
        'TL201',
        closest
          ? `Unknown key '${key}' on node '${nodeName}'; did you mean '${closest}'?`
          : `Unknown key '${key}' in userData.xr on node '${nodeName}'.`,
        closest
          ? `Replace '${key}' with '${closest}'.`
          : 'Supported userData.xr traits include: grab, scale, billboard, follow, anchor, physics, orbit, handles, particles, holdToAsk, audio, dimensions, snapTo, snapSocket, gaze, explode, navigable, text, bloom, outline, ik, character, agent, integrity, zone, spawner, objective, audioCues, collidable.',
      );
    }
  }

  if (Array.isArray(r['traits'])) {
    for (const item of r['traits']) {
      if (typeof item === 'string' && !CANONICAL_XR_KEYS.has(item)) {
        const syn =
          XR_KEY_SYNONYMS[item] ?? XR_KEY_SYNONYMS[item.toLowerCase()];
        const closest = syn?.target ?? closestCanonicalTrait(item);
        pushDiag(
          'TL201',
          closest
            ? `Unknown trait '${item}' in userData.xr.traits on node '${nodeName}'; did you mean '${closest}'?`
            : `Unknown trait '${item}' in userData.xr.traits on node '${nodeName}'.`,
          syn?.hint ??
            (closest
              ? `Use '${closest}' instead of '${item}'.`
              : 'Use canonical trait keys on userData.xr directly.'),
        );
      }
    }
  }

  const checkRange = (
    path: string,
    val: unknown,
    lo: number,
    hi: number,
  ): void => {
    if (typeof val !== 'number') return;
    if (!Number.isFinite(val)) {
      pushDiag(
        'TL202',
        `Numeric trait parameter '${path}' on node '${nodeName}' is non-finite (${val}); clamped to default.`,
        `Provide a finite number in [${lo}, ${hi}] for '${path}'.`,
      );
      return;
    }
    if (val < lo || val > hi) {
      const clamped = Math.max(lo, Math.min(hi, val));
      pushDiag(
        'TL202',
        `Numeric trait parameter '${path}' (${val}) on node '${nodeName}' is out of range [${lo}, ${hi}]; clamped to ${clamped}.`,
        `Keep '${path}' within [${lo}, ${hi}].`,
      );
    }
  };

  // Range checks (TL202)
  const scaleObj = asRecord(r['scale']);
  if (scaleObj) {
    checkRange('scale.min', scaleObj['min'], 0.001, 1000);
    const min = clampNum(scaleObj['min'], 0.001, 1000, 0.05);
    checkRange('scale.max', scaleObj['max'], min, 1000);
  }
  const followObj = asRecord(r['follow']);
  if (followObj && followObj['lazy'] !== false) {
    checkRange('follow.distance', followObj['distance'], 0.1, 10);
    checkRange('follow.deadzoneDeg', followObj['deadzoneDeg'], 0, 90);
    checkRange('follow.stiffness', followObj['stiffness'], 0.5, 40);
    checkRange('follow.height', followObj['height'], -2, 2);
  }
  const orbitObj = asRecord(r['orbit']);
  if (orbitObj) {
    checkRange('orbit.radius', orbitObj['radius'], 0.01, 50);
    checkRange('orbit.speed', orbitObj['speed'], -20, 20);
    checkRange('orbit.height', orbitObj['height'], -10, 10);
    checkRange('orbit.phase', orbitObj['phase'], -1e6, 1e6);
  }
  const handlesObj = asRecord(r['handles']);
  if (handlesObj) {
    checkRange('handles.minScale', handlesObj['minScale'], 0.001, 1000);
    const minS = clampNum(handlesObj['minScale'], 0.001, 1000, 0.1);
    checkRange('handles.maxScale', handlesObj['maxScale'], minS, 1000);
  }
  const particlesObj = asRecord(r['particles']);
  if (particlesObj) {
    checkRange(
      'particles.count',
      particlesObj['count'],
      1,
      MAX_PARTICLES_PER_EMITTER,
    );
    checkRange('particles.speed', particlesObj['speed'], 0.05, 10);
    if (typeof particlesObj['area'] === 'number') {
      checkRange('particles.area', particlesObj['area'], 0.05, 50);
    } else if (Array.isArray(particlesObj['area'])) {
      for (let i = 0; i < Math.min(3, particlesObj['area'].length); i++) {
        checkRange(`particles.area[${i}]`, particlesObj['area'][i], 0.05, 50);
      }
    }
  }
  const holdObj = asRecord(r['holdToAsk']);
  if (holdObj) {
    checkRange('holdToAsk.holdMs', holdObj['holdMs'], 100, 5000);
  }
  const audioObj = asRecord(r['audio']);
  if (audioObj) {
    checkRange('audio.refDistance', audioObj['refDistance'], 0.01, 1000);
  }
  const emitterObj =
    asRecord(r['audioEmitter']) ??
    asRecord(r['spatialAudio']) ??
    (audioObj && !audioObj['src'] ? audioObj : null);
  if (emitterObj && emitterObj['enabled'] !== false) {
    checkRange(
      'audioEmitter.volume',
      emitterObj['volume'] ?? emitterObj['gain'],
      0,
      2,
    );
    checkRange(
      'audioEmitter.pitch',
      emitterObj['pitch'] ?? emitterObj['playbackRate'],
      0.25,
      4,
    );
    checkRange(
      'audioEmitter.refDistance',
      emitterObj['refDistance'],
      0.05,
      100,
    );
    const refD = clampNum(emitterObj['refDistance'], 0.05, 100, 1);
    checkRange(
      'audioEmitter.maxDistance',
      emitterObj['maxDistance'],
      refD,
      500,
    );
    checkRange(
      'audioEmitter.rolloffFactor',
      emitterObj['rolloffFactor'],
      0,
      10,
    );
    checkRange(
      'audioEmitter.coneInnerAngle',
      emitterObj['coneInnerAngle'],
      0,
      360,
    );
    const innerA = clampNum(emitterObj['coneInnerAngle'], 0, 360, 360);
    checkRange(
      'audioEmitter.coneOuterAngle',
      emitterObj['coneOuterAngle'],
      innerA,
      360,
    );
    checkRange('audioEmitter.coneOuterGain', emitterObj['coneOuterGain'], 0, 1);
  }
  const snapToObj = asRecord(r['snapTo']);
  if (snapToObj) {
    checkRange('snapTo.angleDeg', snapToObj['angleDeg'], 0, 180);
    checkRange('snapTo.radius', snapToObj['radius'], 0.01, 2.0);
    if (typeof snapToObj['grid'] === 'number' && snapToObj['grid'] > 0) {
      checkRange('snapTo.grid', snapToObj['grid'], 0.001, 100);
    } else if (Array.isArray(snapToObj['grid'])) {
      for (let i = 0; i < Math.min(3, snapToObj['grid'].length); i++) {
        checkRange(`snapTo.grid[${i}]`, snapToObj['grid'][i], 0.001, 100);
      }
    }
  }
  const snapSocketObj = asRecord(r['snapSocket']);
  if (snapSocketObj) {
    checkRange('snapSocket.radius', snapSocketObj['radius'], 0.01, 2.0);
  }
  const gazeObj = asRecord(r['gaze']);
  if (gazeObj && gazeObj['enabled'] !== false) {
    checkRange('gaze.dwellMs', gazeObj['dwellMs'], 250, 10000);
  }
  const explodeObj = asRecord(r['explode']);
  if (explodeObj && explodeObj['enabled'] !== false) {
    checkRange('explode.distance', explodeObj['distance'], -10, 10);
    checkRange('explode.layer', explodeObj['layer'], 1, 10);
  }
  const textObj = asRecord(r['text']);
  if (textObj) {
    checkRange('text.size', textObj['size'], 0.005, 10);
    checkRange('text.depth', textObj['depth'] ?? textObj['height'], 0.001, 5);
  }
  if (typeof r['bloom'] === 'number' && r['bloom'] > 0) {
    checkRange('bloom', r['bloom'], 0, 5);
  } else {
    const bloomObj = asRecord(r['bloom']);
    if (bloomObj && bloomObj['enabled'] !== false) {
      checkRange(
        'bloom.strength',
        bloomObj['strength'] ?? bloomObj['intensity'],
        0,
        5,
      );
      checkRange('bloom.threshold', bloomObj['threshold'], 0, 4);
      checkRange('bloom.radius', bloomObj['radius'], 0, 2);
    }
  }
  const outlineObj = asRecord(r['outline']);
  if (outlineObj && outlineObj['enabled'] !== false) {
    const rawT = outlineObj['thickness'] ?? outlineObj['width'];
    if (typeof rawT === 'number' && !(rawT > 0 && rawT < 0.25)) {
      checkRange('outline.thickness', rawT, 0.5, 20);
    }
  }
  const ikObj = asRecord(r['ik']);
  if (ikObj && ikObj['enabled'] !== false) {
    checkRange('ik.iterations', ikObj['iterations'], 1, 32);
    checkRange('ik.tolerance', ikObj['tolerance'], 1e-5, 0.1);
    checkRange('ik.weight', ikObj['weight'], 0, 1);
  }
  const lodObj = asRecord(r['lod']);
  if (lodObj && lodObj['enabled'] !== false) {
    checkRange('lod.hysteresis', lodObj['hysteresis'], 0, 0.5);
    if (
      lodObj['cullDistance'] !== undefined &&
      lodObj['cullDistance'] !== null &&
      lodObj['cullDistance'] !== false
    ) {
      checkRange('lod.cullDistance', lodObj['cullDistance'], 1, 10000);
    }
    if (Array.isArray(lodObj['distances'])) {
      let prevD = -Infinity;
      for (let i = 0; i < Math.min(8, lodObj['distances'].length); i++) {
        const dv = lodObj['distances'][i];
        checkRange(`lod.distances[${i}]`, dv, 0, 10000);
        if (typeof dv === 'number' && Number.isFinite(dv)) {
          if (dv < prevD) {
            pushDiag(
              'TL202',
              `lod.distances[${i}] (${dv}) on node '${nodeName}' is less than previous distance (${prevD}); clamped to monotonic order.`,
              'Sort lod.distances in non-decreasing order (e.g. [3, 8]).',
            );
          }
          prevD = Math.max(prevD, dv);
        }
      }
    }
    if (Array.isArray(lodObj['ratios'])) {
      for (let i = 0; i < Math.min(7, lodObj['ratios'].length); i++) {
        checkRange(`lod.ratios[${i}]`, lodObj['ratios'][i], 0.05, 1);
      }
    }
  }
  const charObj = asRecord(r['character']);
  if (charObj && charObj['enabled'] !== false) {
    checkRange('character.speed', charObj['speed'], 0.1, 20);
    checkRange('character.runMultiplier', charObj['runMultiplier'], 1, 4);
    checkRange('character.jumpVelocity', charObj['jumpVelocity'], 0, 30);
    checkRange('character.gravity', charObj['gravity'], 0, 50);
    checkRange('character.radius', charObj['radius'], 0.05, 5);
    const rad = clampNum(charObj['radius'], 0.05, 5, 0.35);
    checkRange('character.height', charObj['height'], rad * 2, 10);
    checkRange('character.cameraDistance', charObj['cameraDistance'], 0.5, 50);
    checkRange('character.cameraHeight', charObj['cameraHeight'], -10, 50);
  }
  const agentObj = asRecord(r['agent']);
  if (agentObj && agentObj['enabled'] !== false) {
    checkRange('agent.speed', agentObj['speed'], 0.1, 20);
    checkRange('agent.turnSpeed', agentObj['turnSpeed'], 0.1, 50);
    checkRange('agent.sightRadius', agentObj['sightRadius'], 0, 100);
    checkRange('agent.stopDistance', agentObj['stopDistance'], 0.01, 10);
    checkRange('agent.separationRadius', agentObj['separationRadius'], 0, 10);
  }
  if (typeof r['integrity'] === 'number') {
    checkRange('integrity.max', r['integrity'], 1, 1e6);
  } else {
    const intObj = asRecord(r['integrity']);
    if (intObj && intObj['enabled'] !== false) {
      checkRange('integrity.max', intObj['max'], 1, 1e6);
      const maxI = clampNum(intObj['max'], 1, 1e6, 100);
      checkRange('integrity.current', intObj['current'], 0, maxI);
      checkRange('integrity.cooldownMs', intObj['cooldownMs'], 0, 10000);
      checkRange('integrity.scoreValue', intObj['scoreValue'], -1e6, 1e6);
      checkRange('integrity.contactAmount', intObj['contactAmount'], 0, 1e6);
    }
  }
  const zoneObj = asRecord(r['zone']);
  if (zoneObj && zoneObj['enabled'] !== false) {
    checkRange('zone.radius', zoneObj['radius'], 0.01, 1000);
    if (typeof zoneObj['size'] === 'number') {
      checkRange('zone.size', zoneObj['size'], 0.01, 1000);
    } else if (Array.isArray(zoneObj['size'])) {
      for (let i = 0; i < Math.min(3, zoneObj['size'].length); i++) {
        checkRange(`zone.size[${i}]`, zoneObj['size'][i], 0.01, 1000);
      }
    }
  }
  const spawnerObj = asRecord(r['spawner']);
  if (spawnerObj && spawnerObj['enabled'] !== false) {
    checkRange('spawner.intervalSec', spawnerObj['intervalSec'], 0.05, 3600);
    checkRange('spawner.maxActive', spawnerObj['maxActive'], 1, 32);
    checkRange('spawner.totalCount', spawnerObj['totalCount'], 0, 10000);
    checkRange('spawner.spawnRadius', spawnerObj['spawnRadius'], 0, 100);
  }
  const objTrait = asRecord(r['objective']);
  if (objTrait && objTrait['enabled'] !== false) {
    checkRange(
      'objective.amount',
      objTrait['amount'] ?? objTrait['points'],
      -1e6,
      1e6,
    );
    checkRange('objective.radius', objTrait['radius'], 0.05, 50);
    checkRange('objective.order', objTrait['order'], 0, 1000);
    checkRange('objective.spinSpeed', objTrait['spinSpeed'], -50, 50);
    checkRange('objective.bobAmplitude', objTrait['bobAmplitude'], 0, 5);
    checkRange('objective.respawnSec', objTrait['respawnSec'], 0, 3600);
  }
  const audioCuesObj = asRecord(r['audioCues']);
  if (audioCuesObj) {
    checkRange('audioCues.pitchJitter', audioCuesObj['pitchJitter'], 0, 0.5);
    checkRange('audioCues.volume', audioCuesObj['volume'], 0, 1);
  }
  const physObj = asRecord(r['rigidBody']) ?? asRecord(r['physics']);
  if (physObj && physObj['enabled'] !== false) {
    checkRange('rigidBody.mass', physObj['mass'], 0, 1000);
    checkRange('rigidBody.restitution', physObj['restitution'], 0, 1);
    checkRange('rigidBody.friction', physObj['friction'], 0, 1);
    checkRange('rigidBody.linearDamping', physObj['linearDamping'], 0, 20);
    checkRange('rigidBody.angularDamping', physObj['angularDamping'], 0, 20);
    checkRange('rigidBody.gravityScale', physObj['gravityScale'], -5, 5);
  }

  // Security checks (TL203)
  const checkUrl = (field: string, val: unknown): void => {
    if (val === undefined || val === null) return;
    if (!safeMediaUrl(val)) {
      pushDiag(
        'TL203',
        `Unsafe or disallowed media URL in '${field}' (${JSON.stringify(val)}) on node '${nodeName}' rejected by safeMediaUrl().`,
        "Use an 'https://' URL or a clean relative path without '..', '\\\\', '%', or custom schemes (e.g. http:, javascript:, file:, data:).",
        'error',
      );
    }
  };
  const checkAnchorIdField = (field: string, val: unknown): void => {
    if (val === undefined || val === null) return;
    if (!safeAnchorId(val)) {
      pushDiag(
        'TL203',
        `Unsafe or invalid identifier in '${field}' (${JSON.stringify(val)}) on node '${nodeName}' rejected by safeAnchorId().`,
        "Anchor and bone identifiers must be non-empty strings without control characters or prototype-pollution keys ('__proto__', 'constructor', 'prototype').",
        'error',
      );
    }
  };

  if (r['splatUrl'] !== undefined && r['splatUrl'] !== null) {
    checkUrl('splatUrl', r['splatUrl']);
  }
  if (typeof r['audio'] === 'string') {
    if (!isAudioPresetName(r['audio'].trim())) {
      checkUrl('audio', r['audio']);
    }
  } else if (audioObj) {
    if (audioObj['src'] !== undefined) {
      checkUrl('audio.src', audioObj['src']);
    } else if (
      audioObj['preset'] === undefined &&
      Object.keys(audioObj).some((k) => k.startsWith('on'))
    ) {
      pushDiag(
        'TL201',
        `userData.xr.audio on node '${nodeName}' contains event keys without 'src'; did you mean 'audioCues'?`,
        'Use \'audioCues: { onTap: "confirm", onHit: "impact" }\' for procedural synth cues, or provide \'audio: { src: "https://..." }\' for spatial audio files.',
      );
    }
  }
  const rawEmitterVal = r['audioEmitter'] ?? r['spatialAudio'];
  if (typeof rawEmitterVal === 'string') {
    if (!isAudioPresetName(rawEmitterVal.trim())) {
      checkUrl('audioEmitter', rawEmitterVal);
    }
  } else if (emitterObj) {
    const srcCandidate =
      emitterObj['src'] ?? emitterObj['url'] ?? emitterObj['uri'];
    if (srcCandidate !== undefined) {
      checkUrl('audioEmitter.src', srcCandidate);
    }
    if (
      typeof emitterObj['preset'] === 'string' &&
      !isAudioPresetName(emitterObj['preset'].trim())
    ) {
      pushDiag(
        'TL201',
        `Unknown audio preset '${emitterObj['preset']}' in audioEmitter on node '${nodeName}'.`,
        `Supported ambient presets: ${AMBIENT_SOUND_PRESETS.join(', ')}.`,
      );
    }
  }
  const checkSimIdField = (field: string, val: unknown): void => {
    if (val === undefined || val === null || val === '') return;
    const s = typeof val === 'string' ? val.trim() : '';
    if (
      !s ||
      !/^[A-Za-z0-9_.:-]{1,64}$/.test(s) ||
      FORBIDDEN_ANCHOR_IDS.has(s)
    ) {
      pushDiag(
        'TL203',
        `Unsafe or invalid identifier in '${field}' (${JSON.stringify(val)}) on node '${nodeName}' rejected by safeSimId().`,
        "Simulation group/tag IDs must be 1-64 characters of [A-Za-z0-9_.:-] and must not use prototype-pollution keys ('__proto__', 'constructor', 'prototype').",
        'error',
      );
    }
  };
  const intRec = asRecord(r['integrity']);
  if (intRec && intRec['group'] !== undefined) {
    checkSimIdField('integrity.group', intRec['group']);
  }
  if (zoneObj && zoneObj['watchGroups'] !== undefined) {
    const wg = Array.isArray(zoneObj['watchGroups'])
      ? zoneObj['watchGroups']
      : [zoneObj['watchGroups']];
    for (let i = 0; i < wg.length; i++) {
      checkSimIdField(`zone.watchGroups[${i}]`, wg[i]);
    }
  }
  if (objTrait && objTrait['tag'] !== undefined) {
    checkSimIdField('objective.tag', objTrait['tag']);
  }
  const anchorRec = asRecord(r['anchor']);
  if (anchorRec && anchorRec['id'] !== undefined) {
    checkAnchorIdField('anchor.id', anchorRec['id']);
  }
  const anchorPersistRec = asRecord(r['anchorPersist']);
  if (anchorPersistRec && anchorPersistRec['id'] !== undefined) {
    checkAnchorIdField('anchorPersist.id', anchorPersistRec['id']);
  }
  if (ikObj && ikObj['enabled'] !== false) {
    checkAnchorIdField('ik.root', ikObj['root']);
    checkAnchorIdField('ik.effector', ikObj['effector']);
    if (ikObj['mid'] !== undefined) checkAnchorIdField('ik.mid', ikObj['mid']);
    if (ikObj['target'] !== undefined && !Array.isArray(ikObj['target'])) {
      checkAnchorIdField('ik.target', ikObj['target']);
    }
    const rawPole = ikObj['pole'] ?? ikObj['poleTarget'];
    if (rawPole !== undefined && !Array.isArray(rawPole)) {
      checkAnchorIdField('ik.pole', rawPole);
    }
  }

  return diags;
}
