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
  safeAnchorId,
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

/** Rigid-body simulation modes supported by `rigid-body` (`xr.physics` / `xr.rigidBody`). */
export const PHYSICS_BODY_MODES = ['dynamic', 'static', 'kinematic'] as const;
/** One rigid-body simulation mode. */
export type PhysicsBodyMode = (typeof PHYSICS_BODY_MODES)[number];

/** Collision shapes supported by `rigid-body`. */
export const PHYSICS_BODY_SHAPES = [
  'auto',
  'box',
  'sphere',
  'cylinder',
] as const;
/** One rigid-body collision shape. */
export type PhysicsBodyShape = (typeof PHYSICS_BODY_SHAPES)[number];

/** Normalized `rigidBody` / object `physics` trait options (`rigid-body`). */
export interface PhysicsBodyOptions {
  readonly body: PhysicsBodyMode;
  readonly shape: PhysicsBodyShape;
  readonly mass: number;
  readonly restitution: number;
  readonly friction: number;
  readonly linearDamping: number;
  readonly angularDamping: number;
  readonly gravityScale: number;
  readonly velocity: TraitVec3;
  readonly angularVelocity: TraitVec3;
  readonly lockRotation: boolean;
}

/** Alias for {@link PhysicsBodyOptions}. */
export type RigidBodyOptions = PhysicsBodyOptions;

function parseBoundedVec3(
  raw: unknown,
  lo: number,
  hi: number,
  fallback: TraitVec3 = [0, 0, 0],
): TraitVec3 {
  if (!isFiniteVec3(raw)) return fallback;
  return [
    clampNum(raw[0], lo, hi, fallback[0]),
    clampNum(raw[1], lo, hi, fallback[1]),
    clampNum(raw[2], lo, hi, fallback[2]),
  ];
}

/**
 * Parses a `rigidBody` or rich `physics` trait (`true`, `'dynamic' | 'static' |
 * 'kinematic'`, or `{ body, shape, mass, restitution, friction, linearDamping,
 * angularDamping, gravityScale, velocity, angularVelocity, lockRotation }`).
 */
export function parsePhysicsBody(raw: unknown): PhysicsBodyOptions | null {
  if (raw === undefined || raw === null || raw === false) return null;
  if (typeof raw === 'string') {
    if (!(PHYSICS_BODY_MODES as readonly string[]).includes(raw)) return null;
    const body = raw as PhysicsBodyMode;
    return {
      body,
      shape: 'auto',
      mass: body === 'dynamic' ? 1 : 0,
      restitution: 0.35,
      friction: 0.5,
      linearDamping: 0.05,
      angularDamping: 0.1,
      gravityScale: 1,
      velocity: [0, 0, 0],
      angularVelocity: [0, 0, 0],
      lockRotation: false,
    };
  }
  const r = raw === true ? {} : asRecord(raw);
  if (!r || r['enabled'] === false) return null;
  const rawBody = r['body'] ?? r['type'] ?? r['mode'];
  const body: PhysicsBodyMode =
    typeof rawBody === 'string' &&
    (PHYSICS_BODY_MODES as readonly string[]).includes(rawBody)
      ? (rawBody as PhysicsBodyMode)
      : 'dynamic';
  const rawShape = r['shape'] ?? r['collider'];
  const shape: PhysicsBodyShape =
    typeof rawShape === 'string' &&
    (PHYSICS_BODY_SHAPES as readonly string[]).includes(rawShape)
      ? (rawShape as PhysicsBodyShape)
      : 'auto';
  const mass = body === 'dynamic' ? clampNum(r['mass'], 0.01, 1000, 1) : 0;
  return {
    body,
    shape,
    mass,
    restitution: clampNum(r['restitution'] ?? r['bounciness'], 0, 1, 0.35),
    friction: clampNum(r['friction'], 0, 1, 0.5),
    linearDamping: clampNum(r['linearDamping'] ?? r['damping'], 0, 20, 0.05),
    angularDamping: clampNum(r['angularDamping'], 0, 20, 0.1),
    gravityScale: clampNum(r['gravityScale'], -5, 5, 1),
    velocity: parseBoundedVec3(r['velocity'], -200, 200),
    angularVelocity: parseBoundedVec3(r['angularVelocity'], -100, 100),
    lockRotation: r['lockRotation'] === true,
  };
}

/** Alias for {@link parsePhysicsBody}. */
export const parseRigidBody = parsePhysicsBody;

/** Mechanical joint types supported by `rigid-body` (`xr.joint`). */
export const JOINT_TYPES = ['hinge', 'slider', 'spring', 'ball'] as const;
/** One mechanical joint constraint type. */
export type JointType = (typeof JOINT_TYPES)[number];

/** Normalized `joint` trait options (`xr.joint`). */
export interface JointOptions {
  readonly type: JointType;
  /** Connected node name (`''` means anchored to world space). */
  readonly target: string;
  /** Local anchor offset `[x, y, z]` in meters relative to this node's initial origin. */
  readonly anchor: TraitVec3;
  /** Unit axis `[x, y, z]` in world/parent space. */
  readonly axis: TraitVec3;
  /** Optional angle `[minDeg, maxDeg]` (`hinge`/`ball`) or distance `[minM, maxM]` (`slider`/`spring`). */
  readonly limits: [number, number] | null;
  readonly stiffness: number;
  readonly damping: number;
  readonly restLength: number;
  readonly motorSpeed: number;
  readonly motorMaxForce: number;
}

const JOINT_TYPE_ALIASES: Readonly<Record<string, JointType>> = {
  hinge: 'hinge',
  revolute: 'hinge',
  slider: 'slider',
  prismatic: 'slider',
  spring: 'spring',
  distance: 'spring',
  ball: 'ball',
  spherical: 'ball',
};

const AXIS_SHORTHANDS: Readonly<Record<string, TraitVec3>> = {
  x: [1, 0, 0],
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  y: [0, 1, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  z: [0, 0, 1],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

function parseJointAxis(raw: unknown, fb: TraitVec3): TraitVec3 {
  if (typeof raw === 'string') {
    const sh = AXIS_SHORTHANDS[raw.trim().toLowerCase()];
    return sh ? [...sh] : [...fb];
  }
  const len = isFiniteVec3(raw) ? Math.hypot(raw[0], raw[1], raw[2]) : 0;
  return len > 1e-6 && isFiniteVec3(raw)
    ? [raw[0] / len, raw[1] / len, raw[2] / len]
    : [...fb];
}

/**
 * Parses a `joint` trait (`'hinge' | 'slider' | 'spring' | 'ball'`, `true`, or
 * `{ type, target, anchor, axis, limits, stiffness, damping, restLength,
 * motorSpeed, motorMaxForce }`).
 */
export function parseJoint(raw: unknown): JointOptions | null {
  if (!raw || raw === 'none') return null;
  const r =
    raw === true ? {} : typeof raw === 'string' ? {type: raw} : asRecord(raw);
  if (!r || r['enabled'] === false) return null;
  const rt = r['type'] ?? r['kind'] ?? r['mode'];
  const type =
    typeof rt === 'string'
      ? JOINT_TYPE_ALIASES[rt.trim().toLowerCase()]
      : 'hinge';
  if (!type) return null;
  const rawTgt = r['target'] ?? r['connectedBody'] ?? r['parent'];
  const target =
    typeof rawTgt === 'string' && rawTgt.trim().toLowerCase() === 'world'
      ? ''
      : (safeAnchorId(rawTgt) ?? '');
  const anchor = parseBoundedVec3(
    r['anchor'] ?? r['pivot'],
    -100,
    100,
    [0, 0, 0],
  );
  const axis = parseJointAxis(
    r['axis'],
    type === 'slider'
      ? [0, 0, 1]
      : type === 'spring'
        ? [0, -1, 0]
        : [0, 1, 0],
  );
  const isAng = type === 'hinge' || type === 'ball';
  const limLo = isAng ? -360 : type === 'spring' ? 0 : -100;
  const limHi = isAng ? 360 : 100;
  const rl = r['limits'];
  const loR =
    Array.isArray(rl) && rl.length >= 2
      ? rl[0]
      : (r['min'] ?? (isAng ? r['minAngle'] : r['minDistance']));
  const hiR =
    Array.isArray(rl) && rl.length >= 2
      ? rl[1]
      : (r['max'] ?? (isAng ? r['maxAngle'] : r['maxDistance']));
  const hasLim = Array.isArray(rl)
    ? rl.length >= 2 && Number.isFinite(rl[0]) && Number.isFinite(rl[1])
    : (typeof loR === 'number' && Number.isFinite(loR)) ||
      (typeof hiR === 'number' && Number.isFinite(hiR));
  const a = clampNum(loR, limLo, limHi, limLo);
  const b = clampNum(hiR, limLo, limHi, limHi);
  const limits: [number, number] | null = hasLim
    ? [Math.min(a, b), Math.max(a, b)]
    : null;
  const motorSpeed = clampNum(r['motorSpeed'], -100, 100, 0);
  return {
    type,
    target,
    anchor,
    axis,
    limits,
    stiffness: clampNum(r['stiffness'], 0, 10000, type === 'spring' ? 40 : 0),
    damping: clampNum(r['damping'], 0, 1000, type === 'spring' ? 4 : 0.5),
    restLength: clampNum(r['restLength'], 0, 100, 0),
    motorSpeed,
    motorMaxForce: clampNum(
      r['motorMaxForce'] ?? r['maxMotorForce'],
      0,
      10000,
      motorSpeed !== 0 ? 50 : 0,
    ),
  };
}

/** Normalizes, and serializes to SceneCore and USD, every sim trait. */
const SIM_TRAIT_EXTENSION: XRTraitExtension = {
  normalize(r, out) {
    const rawChar =
      r['character'] ?? r['player'] ?? r['avatar'] ?? r['controller'];
    const charSource =
      rawChar !== undefined &&
      rawChar !== null &&
      rawChar !== false &&
      (typeof r['speed'] === 'number' ||
        typeof r['height'] === 'number' ||
        typeof r['radius'] === 'number')
        ? {
            speed: r['speed'],
            height: r['height'],
            radius: r['radius'],
            ...(typeof rawChar === 'string'
              ? {cameraMode: rawChar}
              : typeof rawChar === 'object'
                ? rawChar
                : {}),
          }
        : rawChar;
    const character = parseCharacter(charSource);
    if (character) out.character = character;
    const agent = parseAgent(
      r['agent'] ??
        r['ai'] ??
        r['npc'] ??
        r['enemy'] ??
        r['bot'] ??
        r['steering'],
    );
    if (agent) out.agent = agent;
    const integrity = parseIntegrity(
      r['integrity'] ?? r['health'] ?? r['hp'] ?? r['hitpoints'],
    );
    if (integrity) out.integrity = integrity;
    const rawZone =
      r['zone'] ?? r['trigger'] ?? r['hitbox'] ?? r['sensor'] ?? r['hazard'];
    const zoneSource =
      rawZone !== undefined &&
      rawZone !== null &&
      rawZone !== false &&
      typeof r['radius'] === 'number'
        ? {
            radius: r['radius'],
            ...(typeof rawZone === 'string'
              ? {shape: rawZone}
              : typeof rawZone === 'object'
                ? rawZone
                : {}),
          }
        : rawZone;
    const zone = parseZone(zoneSource);
    if (zone) out.zone = zone;
    const spawner = parseSpawner(r['spawner'] ?? r['spawn']);
    if (spawner) out.spawner = spawner;
    const objective = parseObjective(
      r['objective'] ?? r['goal'] ?? r['quest'] ?? r['collectible'] ?? r['pickup'],
    );
    if (objective) out.objective = objective;
    const audioCues = parseAudioCues(r['audioCues'] ?? r['sfx']);
    if (audioCues) out.audioCues = audioCues;
    const rawPhys = r['physics'];
    const hasTopPhysProps =
      typeof r['mass'] === 'number' ||
      typeof r['restitution'] === 'number' ||
      typeof r['bounciness'] === 'number' ||
      typeof r['friction'] === 'number';
    const rawRb =
      r['rigidBody'] ??
      r['rigidbody'] ??
      (rawPhys === 'kinematic' ||
      rawPhys === true ||
      (typeof rawPhys === 'object' && rawPhys !== null)
        ? rawPhys
        : typeof rawPhys === 'string' && hasTopPhysProps
          ? rawPhys
          : rawPhys === undefined && typeof r['mass'] === 'number'
            ? true
            : undefined);
    const rbSource =
      hasTopPhysProps &&
      rawRb !== undefined &&
      rawRb !== null &&
      rawRb !== false
        ? {
            mass: r['mass'],
            restitution: r['restitution'] ?? r['bounciness'],
            friction: r['friction'],
            ...(typeof rawRb === 'string'
              ? {body: rawRb}
              : typeof rawRb === 'object'
                ? rawRb
                : {}),
          }
        : rawRb;
    const rigidBody = parsePhysicsBody(rbSource);
    if (rigidBody) {
      out.rigidBody = rigidBody;
      if (
        !out.physics &&
        (rigidBody.body === 'dynamic' || rigidBody.body === 'static')
      ) {
        out.physics = rigidBody.body;
      }
    }
    if (
      r['collidable'] === true ||
      r['collides'] === true ||
      r['collider'] === true ||
      r['solid'] === true ||
      r['obstacle'] === true
    ) {
      out.collidable = true;
    }
    const joint = parseJoint(r['joint'] ?? r['constraint']);
    if (joint) out.joint = joint;
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
    if (n.rigidBody) {
      comp['rigidbody'] = {
        type: n.rigidBody.body,
        ...n.rigidBody,
        velocity: [...n.rigidBody.velocity],
        angularVelocity: [...n.rigidBody.angularVelocity],
      };
    }
    if (n.collidable) comp['collidable'] = {enabled: true};
    if (n.joint) {
      comp['joint'] = {
        ...n.joint,
        anchor: [...n.joint.anchor],
        axis: [...n.joint.axis],
        limits: n.joint.limits ? [...n.joint.limits] : null,
      };
    }
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
    if (n.rigidBody) {
      out['rigidBody'] = true;
      out['physics'] = n.rigidBody.body;
      put('rigidBody', n.rigidBody);
    }
    if (n.collidable) out['collidable'] = true;
    if (n.joint) {
      out['joint'] = n.joint.type;
      put('joint', {...n.joint, type: undefined, limits: undefined});
      if (n.joint.limits) {
        out['jointMin'] = n.joint.limits[0];
        out['jointMax'] = n.joint.limits[1];
      }
    }
  },
  usdPrims(n) {
    const j = n.joint;
    if (!j) return '';
    const PRIMS: Record<JointType, string> = {
      hinge: 'PhysicsRevoluteJoint',
      slider: 'PhysicsPrismaticJoint',
      spring: 'PhysicsDistanceJoint',
      ball: 'PhysicsSphericalJoint',
    };
    const [ax, ay, az] = j.axis;
    const axisTok =
      Math.abs(ax) >= Math.abs(ay) && Math.abs(ax) >= Math.abs(az)
        ? 'X'
        : Math.abs(az) >= Math.abs(ay)
          ? 'Z'
          : 'Y';
    let body = `point3f physics:localPos0 = (${j.anchor.join(', ')})\n`;
    if (j.type === 'hinge' || j.type === 'slider') {
      body += `uniform token physics:axis = "${axisTok}"\n`;
      if (j.limits) {
        body += `float physics:lowerLimit = ${j.limits[0]}\nfloat physics:upperLimit = ${j.limits[1]}\n`;
      }
    } else if (j.limits) {
      const [lo, hi] = j.limits;
      const c = Math.max(Math.abs(lo), Math.abs(hi));
      body +=
        j.type === 'spring'
          ? `float physics:minDistance = ${lo}\nfloat physics:maxDistance = ${hi}\n`
          : `float physics:coneAngle0Limit = ${c}\nfloat physics:coneAngle1Limit = ${c}\n`;
    }
    return `def ${PRIMS[j.type]} "Joint"\n{\n${body}}\n`;
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
