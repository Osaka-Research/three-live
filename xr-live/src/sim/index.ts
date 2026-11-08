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
 * @fileoverview Optional simulation plugin bundle for `<xr-live>` and
 * `<three-live>` (`xr-live-sim.min.js`). Importing this module registers all
 * six plugins; each stays inert until a scene opts in:
 *
 * | Plugin                 | Opt-in                                          |
 * | ---------------------- | ----------------------------------------------- |
 * | `character-controller` | `userData.xr.character`                         |
 * | `steering-agents`      | `userData.xr.agent`                             |
 * | `rigid-body`           | `userData.xr.rigidBody` / `userData.xr.physics` |
 * | `hit-zones`            | `integrity` / `zone` / `spawner` traits, `hit-zones` attr |
 * | `objectives`           | `userData.xr.objective`, `objectives` attr      |
 * | `synth-audio`          | `synth-audio` attr + `userData.xr.audioCues`    |
 *
 * To register a subset, import the individual modules instead; each registers
 * itself and the shared driver on import.
 */

import {registerSimTraitSchema} from '../../../three-live/src/xr-sim-schema';
import {characterControllerSystem} from './character-controller';
import {hitZonesSystem} from './hit-zones';
import {objectivesSystem} from './objectives';
import {rigidBodySystem} from './rigid-body';
import {steeringAgentsSystem} from './steering-agents';
import {synthAudioSystem} from './synth-audio';

/** Every `xr-live-sim` system, in step order. */
export const xrSimSystems = [
  characterControllerSystem,
  steeringAgentsSystem,
  rigidBodySystem,
  hitZonesSystem,
  objectivesSystem,
  synthAudioSystem,
] as const;

registerSimTraitSchema();

export {
  AUDIO_CUE_EVENTS,
  AUDIO_CUES,
  JOINT_TYPES,
  parseAgent,
  parseAudioCues,
  parseCharacter,
  parseIntegrity,
  parseJoint,
  parseObjective,
  parsePhysicsBody,
  parseRigidBody,
  parseSpawner,
  parseZone,
  PHYSICS_BODY_MODES,
  PHYSICS_BODY_SHAPES,
  registerSimTraitSchema,
  type AgentOptions,
  type AudioCue,
  type AudioCueOptions,
  type CharacterOptions,
  type IntegrityOptions,
  type JointOptions,
  type JointType,
  type ObjectiveOptions,
  type PhysicsBodyMode,
  type PhysicsBodyOptions,
  type PhysicsBodyShape,
  type RigidBodyOptions,
  type SpawnerOptions,
  type ZoneOptions,
} from '../../../three-live/src/xr-sim-schema';
export * from './character-controller';
export {
  applySimBodies,
  buildSimWorld,
  getSimWorld,
  resetSimScenario,
  simCorePlugin,
  stepSimWorld,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';
export * from './hit-zones';
export * from './objectives';
export * from './rigid-body';
export * from './steering-agents';
export * from './synth-audio';
