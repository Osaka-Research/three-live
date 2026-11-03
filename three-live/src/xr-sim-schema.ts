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
 * @fileoverview Canonical `userData.xr` traits for the optional `xr-live-sim`
 * plugins: `character` (character-controller), `agent` (steering-agents),
 * `integrity`, `zone`, and `spawner` (hit-zones), `objective` (objectives),
 * `audioCues` (synth-audio), and `collidable`.
 *
 * Kept out of `xr-trait-schema.ts` so bundles that don't use simulation
 * features don't pay for these parsers. Call {@link registerSimTraitSchema} to
 * add them to `normalizeXRTraits` and the glTF / USDZ serializers. Clamp ranges
 * are mirrored by the Android (`XRLiveTraits.kt`) and iOS / visionOS
 * (`XRLiveTraits.swift`) parsers.
 */

import {
  asRecord,
  clampNum,
  FORBIDDEN_ANCHOR_IDS,
  isFiniteVec3,
  registerXRTraitExtension,
  safeHexColor,
  shortString,
  type NormalizedXRTraits,
  type TraitVec3,
  type XRTraitExtension,
} from './xr-trait-schema';

/** Sanitizes a group or tag identifier: 1-64 chars of `[A-Za-z0-9_.:-]`. */
export function safeSimId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(s) && !FORBIDDEN_ANCHOR_IDS.has(s)
    ? s
    : undefined;
}

/** Picks `raw` when it is one of `allowed`, else `fallback`. */
function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

/** Camera modes supported by `character-controller`. */
export type CharacterCameraMode =
  | 'third-person'
  | 'first-person'
  | 'top-down'
  | 'fixed';
/** Animation states driven by `character-controller`. */
export type CharacterClipState = 'idle' | 'walk' | 'run' | 'jump';
const CHARACTER_CAMERA_MODES: readonly CharacterCameraMode[] = [
  'third-person',
  'first-person',
  'top-down',
  'fixed',
];
const CHARACTER_CLIP_STATES: readonly CharacterClipState[] = [
  'idle',
  'walk',
  'run',
  'jump',
];

/** Normalized `character` trait options (`character-controller`). */
export interface CharacterOptions {
  readonly speed: number;
  readonly runMultiplier: number;
  readonly jumpVelocity: number;
  readonly gravity: number;
  readonly radius: number;
  readonly height: number;
  readonly cameraMode: CharacterCameraMode;
  readonly cameraDistance: number;
  readonly cameraHeight: number;
  /** glTF animation clip names by state; missing states play nothing. */
  readonly clips: Readonly<Partial<Record<CharacterClipState, string>>>;
}

/**
 * Parses a `character` trait (`true`, camera-mode string, or options),
 * returning `null` when disabled.
 */
export function parseCharacter(raw: unknown): CharacterOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? (typeof raw === 'string' ? {cameraMode: raw} : {});
  if (r['enabled'] === false) return null;
  const radius = clampNum(r['radius'], 0.05, 5, 0.35);
  const clipsRaw = asRecord(r['clips']) ?? {};
  const clips: Partial<Record<CharacterClipState, string>> = {};
  for (const state of CHARACTER_CLIP_STATES) {
    const name = shortString(clipsRaw[state], 128);
    if (name) clips[state] = name;
  }
  return {
    speed: clampNum(r['speed'], 0.1, 20, 4),
    runMultiplier: clampNum(r['runMultiplier'], 1, 4, 1.6),
    jumpVelocity: clampNum(r['jumpVelocity'], 0, 30, 5.5),
    gravity: clampNum(r['gravity'], 0, 50, 15),
    radius,
    // A capsule is never shorter than its own diameter.
    height: clampNum(r['height'], radius * 2, 10, Math.max(1.4, radius * 2)),
    cameraMode: oneOf(r['cameraMode'], CHARACTER_CAMERA_MODES, 'third-person'),
    cameraDistance: clampNum(r['cameraDistance'], 0.5, 50, 3.5),
    cameraHeight: clampNum(r['cameraHeight'], -10, 50, 1.8),
    clips,
  };
}

/** Steering modes supported by `steering-agents`. */
export type AgentMode = 'patrol' | 'chase' | 'flee' | 'wander' | 'follow';
const AGENT_MODES: readonly AgentMode[] = [
  'patrol',
  'chase',
  'flee',
  'wander',
  'follow',
];
/** Maximum waypoints kept per agent. */
export const MAX_AGENT_WAYPOINTS = 32;
/** Target value meaning "the user" (camera, XR viewer, or controlled character). */
export const AGENT_TARGET_USER = 'user';

/** Normalized `agent` trait options (`steering-agents`). */
export interface AgentOptions {
  readonly mode: AgentMode;
  /** Node name, {@link AGENT_TARGET_USER}, or `''` for no target. */
  readonly target: string;
  readonly speed: number;
  readonly turnSpeed: number;
  readonly sightRadius: number;
  readonly stopDistance: number;
  readonly separationRadius: number;
  readonly waypoints: TraitVec3[];
  readonly loopWaypoints: boolean;
}

/** Parses an `agent` trait (mode string or options), returning `null` when absent. */
export function parseAgent(raw: unknown): AgentOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? (typeof raw === 'string' ? {mode: raw} : {});
  if (r['enabled'] === false) return null;
  const mode = oneOf(r['mode'], AGENT_MODES, 'wander');
  const t = r['target'];
  let target =
    t === 'camera' || t === AGENT_TARGET_USER
      ? AGENT_TARGET_USER
      : (shortString(t, 256) ?? '');
  // Target-seeking modes default to the user rather than idling.
  if (!target && (mode === 'chase' || mode === 'flee' || mode === 'follow')) {
    target = AGENT_TARGET_USER;
  }
  const coord = (v: number): number => clampNum(v, -1e4, 1e4, 0);
  const waypoints: TraitVec3[] = Array.isArray(r['waypoints'])
    ? (r['waypoints'] as unknown[])
        .filter(isFiniteVec3)
        .slice(0, MAX_AGENT_WAYPOINTS)
        .map((p) => [coord(p[0]), coord(p[1]), coord(p[2])])
    : [];
  return {
    mode,
    target,
    speed: clampNum(r['speed'], 0.1, 20, 2),
    turnSpeed: clampNum(r['turnSpeed'], 0.1, 50, 6),
    sightRadius: clampNum(r['sightRadius'], 0, 100, 6),
    stopDistance: clampNum(r['stopDistance'], 0.01, 10, 0.6),
    separationRadius: clampNum(r['separationRadius'], 0, 10, 0.8),
    waypoints,
    loopWaypoints: r['loopWaypoints'] !== false,
  };
}

/** Normalized `integrity` trait options (`hit-zones`). */
export interface IntegrityOptions {
  readonly max: number;
  readonly current: number;
  readonly group: string;
  readonly showBar: boolean;
  readonly cooldownMs: number;
  readonly hideOnDepleted: boolean;
  readonly scoreValue: number;
  readonly contactAmount: number;
}

/** Parses an `integrity` trait (max number, `true`, or options). */
export function parseIntegrity(raw: unknown): IntegrityOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? (typeof raw === 'number' ? {max: raw} : {});
  if (r['enabled'] === false) return null;
  const max = clampNum(r['max'], 1, 1e6, 100);
  return {
    max,
    current: clampNum(r['current'], 0, max, max),
    group: safeSimId(r['group']) ?? 'neutral',
    showBar: r['showBar'] === true,
    cooldownMs: Math.round(clampNum(r['cooldownMs'], 0, 10000, 250)),
    hideOnDepleted: r['hideOnDepleted'] !== false,
    scoreValue: clampNum(r['scoreValue'], -1e6, 1e6, 0),
    contactAmount: clampNum(r['contactAmount'], 0, 1e6, 0),
  };
}

/** Zone shapes supported by `hit-zones`. */
export type ZoneShape = 'box' | 'sphere';
/** Maximum groups a zone can watch. */
export const MAX_ZONE_WATCH_GROUPS = 16;

/** Normalized `zone` trait options (`hit-zones`). */
export interface ZoneOptions {
  readonly shape: ZoneShape;
  /** Full box extents in meters (local space). */
  readonly size: TraitVec3;
  /** Sphere radius in meters (local space). */
  readonly radius: number;
  /** Groups that trigger enter/exit events; empty watches every tracked node. */
  readonly watchGroups: string[];
  /** Outline color; absent hides the zone. */
  readonly color?: string;
}

/** Parses a `zone` trait (`true`, shape string, or options). */
export function parseZone(raw: unknown): ZoneOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? (typeof raw === 'string' ? {shape: raw} : {});
  if (r['enabled'] === false) return null;
  const shape = oneOf(r['shape'], ['box', 'sphere'] as const, 'box');
  const s = r['size'];
  const side = (v: unknown): number => clampNum(v, 0.01, 1000, 1);
  const size: TraitVec3 = isFiniteVec3(s)
    ? [side(s[0]), side(s[1]), side(s[2])]
    : typeof s === 'number'
      ? [side(s), side(s), side(s)]
      : [1, 1, 1];
  const radius = clampNum(
    r['radius'] ?? (typeof s === 'number' ? s : undefined),
    0.01,
    1000,
    0.5,
  );
  const wg = r['watchGroups'];
  const watchGroups = [
    ...new Set(
      (Array.isArray(wg) ? wg : wg === undefined ? [] : [wg])
        .map(safeSimId)
        .filter((g): g is string => g !== undefined),
    ),
  ].slice(0, MAX_ZONE_WATCH_GROUPS);
  const out: ZoneOptions = {shape, size, radius, watchGroups};
  const color = safeHexColor(r['color'], '');
  return color ? {...out, color} : out;
}

/** Hard cap on simultaneously active instances per spawner. */
export const MAX_SPAWNER_ACTIVE = 32;

/** Normalized `spawner` trait options (`hit-zones`). */
export interface SpawnerOptions {
  readonly template: string;
  readonly intervalSec: number;
  readonly maxActive: number;
  /** Total instances to spawn; `0` is unlimited. */
  readonly totalCount: number;
  readonly spawnRadius: number;
}

/** Parses a `spawner` trait (template name or options), returning `null` without a template. */
export function parseSpawner(raw: unknown): SpawnerOptions | null {
  const r = asRecord(raw) ?? (typeof raw === 'string' ? {template: raw} : null);
  const template = shortString(r?.['template'], 256)?.trim();
  if (!r || !template || r['enabled'] === false) return null;
  return {
    template,
    intervalSec: clampNum(r['intervalSec'], 0.05, 3600, 3),
    maxActive: Math.round(clampNum(r['maxActive'], 1, MAX_SPAWNER_ACTIVE, 8)),
    totalCount: Math.round(clampNum(r['totalCount'], 0, 10000, 0)),
    spawnRadius: clampNum(r['spawnRadius'], 0, 100, 0),
  };
}

/** Objective kinds supported by `objectives`. */
export type ObjectiveType =
  | 'pickup'
  | 'checkpoint'
  | 'time-bonus'
  | 'restore'
  | 'key';
const OBJECTIVE_TYPES: readonly ObjectiveType[] = [
  'pickup',
  'checkpoint',
  'time-bonus',
  'restore',
  'key',
];

/** Normalized `objective` trait options (`objectives`). */
export interface ObjectiveOptions {
  readonly type: ObjectiveType;
  /** Points (`pickup`/`checkpoint`/`key`), seconds (`time-bonus`), or integrity (`restore`). */
  readonly amount: number;
  readonly tag: string;
  readonly radius: number;
  readonly required: boolean;
  /** `0` for any order; `>0` enforces ascending sequence among ordered objectives. */
  readonly order: number;
  readonly spinSpeed: number;
  readonly bobAmplitude: number;
  /** `0` completes once; `>0` makes the objective available again after N seconds. */
  readonly respawnSec: number;
}

/** Parses an `objective` trait (`true`, type string, or options). */
export function parseObjective(raw: unknown): ObjectiveOptions | null {
  if (!raw) return null;
  const r = asRecord(raw) ?? (typeof raw === 'string' ? {type: raw} : {});
  if (r['enabled'] === false) return null;
  const type = oneOf(r['type'], OBJECTIVE_TYPES, 'pickup');
  // Only pickups idle-animate by default; checkpoints and keys stay still.
  const animated = type === 'pickup';
  return {
    type,
    amount: clampNum(r['amount'] ?? r['points'], -1e6, 1e6, 10),
    tag: safeSimId(r['tag']) ?? '',
    radius: clampNum(r['radius'], 0.05, 50, 0.65),
    required: r['required'] === true,
    order: Math.round(clampNum(r['order'], 0, 1000, 0)),
    spinSpeed: clampNum(r['spinSpeed'], -50, 50, animated ? 2.5 : 0),
    bobAmplitude: clampNum(r['bobAmplitude'], 0, 5, animated ? 0.08 : 0),
    respawnSec: clampNum(r['respawnSec'], 0, 3600, 0),
  };
}

/** Procedural cues synthesized by `synth-audio`. */
export const AUDIO_CUES = [
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
/** One procedural `synth-audio` cue name. */
export type AudioCue = (typeof AUDIO_CUES)[number];
/** Node events that can trigger an {@link AudioCue}. */
export const AUDIO_CUE_EVENTS = [
  'onTap',
  'onObjective',
  'onHit',
  'onDepleted',
  'onZoneEnter',
  'onZoneExit',
  'onSpawn',
  'onJump',
  'onLand',
] as const;
/** One node event key accepted by the `audioCues` trait. */
export type AudioCueEvent = (typeof AUDIO_CUE_EVENTS)[number];

/** Normalized `audioCues` trait options (`synth-audio`). */
export interface AudioCueOptions {
  readonly cues: Readonly<Partial<Record<AudioCueEvent, AudioCue>>>;
  readonly pitchJitter: number;
  readonly volume: number;
  readonly spatial: boolean;
}

/**
 * Parses an `audioCues` trait, returning `null` when no event maps to a known
 * cue. (Named `audioCues` because `audio` is the file-based spatial audio trait.)
 */
export function parseAudioCues(raw: unknown): AudioCueOptions | null {
  const r = asRecord(raw);
  if (!r) return null;
  const cues: Partial<Record<AudioCueEvent, AudioCue>> = {};
  for (const ev of AUDIO_CUE_EVENTS) {
    const cue = r[ev];
    if (
      typeof cue === 'string' &&
      (AUDIO_CUES as readonly string[]).includes(cue)
    ) {
      cues[ev] = cue as AudioCue;
    }
  }
  if (Object.keys(cues).length === 0) return null;
  return {
    cues,
    pitchJitter: clampNum(r['pitchJitter'], 0, 0.5, 0.08),
    volume: clampNum(r['volume'], 0, 1, 1),
    spatial: r['spatial'] !== false,
  };
}

/** Normalizes, and serializes to SceneCore and USD, every sim trait. */
const SIM_TRAIT_EXTENSION: XRTraitExtension = {
  normalize(r, out) {
    const character = parseCharacter(r['character']);
    if (character) out.character = character;
    const agent = parseAgent(r['agent']);
    if (agent) out.agent = agent;
    const integrity = parseIntegrity(r['integrity']);
    if (integrity) out.integrity = integrity;
    const zone = parseZone(r['zone']);
    if (zone) out.zone = zone;
    const spawner = parseSpawner(r['spawner']);
    if (spawner) out.spawner = spawner;
    const objective = parseObjective(r['objective']);
    if (objective) out.objective = objective;
    const audioCues = parseAudioCues(r['audioCues']);
    if (audioCues) out.audioCues = audioCues;
    if (r['collidable'] === true) out.collidable = true;
  },
  sceneCore(n, comp) {
    if (n.character) {
      comp['character'] = {...n.character, clips: {...n.character.clips}};
    }
    if (n.agent) {
      comp['agent'] = {
        ...n.agent,
        waypoints: n.agent.waypoints.map((p) => [...p]),
      };
    }
    if (n.integrity) comp['integrity'] = {...n.integrity};
    if (n.zone) {
      comp['zone'] = {
        ...n.zone,
        size: [...n.zone.size],
        watchGroups: [...n.zone.watchGroups],
      };
    }
    if (n.spawner) comp['spawner'] = {...n.spawner};
    if (n.objective) comp['objective'] = {...n.objective};
    if (n.audioCues) {
      comp['audioCues'] = {...n.audioCues, cues: {...n.audioCues.cues}};
    }
    if (n.collidable) comp['collidable'] = {enabled: true};
  },
  usd(n, put, out) {
    if (n.character) {
      out['character'] = true;
      put('character', {...n.character, clips: undefined});
      for (const [state, clip] of Object.entries(n.character.clips)) {
        out['characterClip' + state[0].toUpperCase() + state.slice(1)] = clip;
      }
    }
    if (n.agent) {
      put('agent', {...n.agent, waypoints: undefined});
      out['agentWaypointCount'] = n.agent.waypoints.length;
      n.agent.waypoints.forEach((p, i) => {
        out[`agentWaypoint${i}`] = [p[0], p[1], p[2]];
      });
    }
    if (n.integrity) {
      out['integrity'] = true;
      put('integrity', n.integrity);
    }
    if (n.zone) {
      // Group ids are `[A-Za-z0-9_.:-]`, so a comma join is unambiguous.
      put('zone', {...n.zone, watchGroups: n.zone.watchGroups.join(',')});
    }
    if (n.spawner) put('spawner', n.spawner);
    if (n.objective) put('objective', n.objective);
    if (n.audioCues) {
      put('audioCues', {...n.audioCues, cues: undefined});
      put('audioCues', n.audioCues.cues);
    }
    if (n.collidable) out['collidable'] = true;
  },
};

/**
 * Normalizes only the sim traits of an authored `userData.xr` bag, returning
 * `null` when none are present. Lets runtimes skip the full trait schema.
 */
export function normalizeSimTraits(raw: unknown): NormalizedXRTraits | null {
  const r = asRecord(raw);
  if (!r) return null;
  const out: NormalizedXRTraits = {};
  SIM_TRAIT_EXTENSION.normalize(r, out);
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Adds the sim traits to `normalizeXRTraits`, `buildXRSceneCoreExtension`, and
 * `flattenXRTraitsForUsd` for this bundle. Idempotent.
 */
export function registerSimTraitSchema(): void {
  registerXRTraitExtension(SIM_TRAIT_EXTENSION);
}
