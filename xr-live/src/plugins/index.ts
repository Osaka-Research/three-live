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
 * @fileoverview Optional spatial UX, world-understanding, splat, AI & co-presence plugin bundle for `<xr-live>`
 * (`xr-live-spatial.min.js`). Importing this module registers all 15
 * plugins; each is inert until a scene opts in via `userData.xr` traits or
 * host attributes:
 *
 * | Plugin                 | Opt-in                                        |
 * | ---------------------- | --------------------------------------------- |
 * | `head-follow`          | `userData.xr.follow = {...}` / `orbit`        |
 * | `manipulation-handles` | `userData.xr.handles`                         |
 * | `world-understanding`  | `world-understanding` attr / trait            |
 * | `gemini-live`          | `connectGeminiLive()` / `userData.xr.holdToAsk` |
 * | `spatial-paint`        | `spatial-paint` attribute                     |
 * | `depth-particles`      | `userData.xr.particles`                       |
 * | `splat-loader`         | `userData.xr.splatUrl`                        |
 * | `spatial-measure`      | `spatial-measure` attr / `userData.xr.dimensions` |
 * | `magnetic-snap`        | `magnetic-snap` attr / `userData.xr.snapTo`   |
 * | `gaze-dwell`           | `gaze-dwell` attr / `userData.xr.gaze`        |
 * | `exploded-view`        | `explode` / `section-plane` attr / `userData.xr.explode` |
 * | `persistent-anchors`   | `persistent-anchors` / `persist-url-hash` attr / `userData.xr.anchor.persist` |
 * | `spatial-locomotion`   | `locomotion` attr / `userData.xr.navigable`   |
 * | `shared-room`          | `shared-room` attr / `userData.xr.sync`       |
 * | `spatial-audio`        | `userData.xr.audioEmitter` / `KHR_audio_emitter` |
 *
 * To register only a subset, import the individual modules and call
 * `registerPlugin()` yourself instead of importing this entry point.
 */

import {registerPlugin} from '../../../three-live/src/plugin';
import {registerXRTraitSerializer} from '../../../three-live/src/xr-trait-schema';
import {depthParticlesPlugin} from './depth-particles';
import {explodedViewPlugin} from './exploded-view';
import {gazeDwellPlugin} from './gaze-dwell';
import {geminiLivePlugin} from './gemini-live';
import {headFollowPlugin} from './head-follow';
import {magneticSnapPlugin} from './magnetic-snap';
import {manipulationHandlesPlugin} from './manipulation-handles';
import {persistentAnchorsPlugin} from './persistent-anchors';
import {sharedRoomPlugin} from './shared-room';
import {spatialAudioPlugin} from './spatial-audio';
import {spatialLocomotionPlugin} from './spatial-locomotion';
import {spatialMeasurePlugin} from './spatial-measure';
import {spatialPaintPlugin} from './spatial-paint';
import {splatLoaderPlugin} from './splat-loader';
import {worldUnderstandingPlugin} from './world-understanding';

/** Every `<xr-live>` spatial plugin, in registration order. */
export const xrSpatialPlugins = [
  headFollowPlugin,
  manipulationHandlesPlugin,
  worldUnderstandingPlugin,
  geminiLivePlugin,
  spatialPaintPlugin,
  depthParticlesPlugin,
  splatLoaderPlugin,
  spatialMeasurePlugin,
  magneticSnapPlugin,
  gazeDwellPlugin,
  explodedViewPlugin,
  persistentAnchorsPlugin,
  spatialLocomotionPlugin,
  sharedRoomPlugin,
  spatialAudioPlugin,
] as const;

for (const plugin of xrSpatialPlugins) registerPlugin(plugin);
// Exports (GLB / USDZ) now carry the full normalized spatial trait set.
registerXRTraitSerializer();

// This bundle may load after `<xr-live>` elements already connected; attach
// element-level listeners now (each plugin's hook is idempotent).
if (
  typeof document !== 'undefined' &&
  typeof document.querySelectorAll === 'function'
) {
  for (const el of Array.from(
    document.querySelectorAll('xr-live, three-live'),
  )) {
    if (!el.isConnected) continue;
    for (const plugin of xrSpatialPlugins) plugin.onElementConnected?.(el);
  }
}

export {
  buildXRSceneCoreExtension,
  flattenXRTraitsForUsd,
  normalizeXRTraits,
  parseAnchorPersist,
  parseBloomTrait,
  parseDimensions,
  parseExplode,
  parseGaze,
  parseIKTrait,
  parseNavigable,
  parseOutlineTrait,
  parseSnapSocket,
  parseSnapTo,
  parseSpatialAudio,
  parseTextTrait,
  parseWorldUnderstanding,
  registerXRTraitSerializer,
  XR_TRAIT_SCHEMA_VERSION,
  type BloomTraitOptions,
  type IKTraitOptions,
  type NormalizedXRTraits,
  type OutlineTraitOptions,
  type TextTraitOptions,
} from '../../../three-live/src/xr-trait-schema';
export * from './depth-particles';
export * from './exploded-view';
export * from './gaze-dwell';
export * from './gemini-live';
export * from './head-follow';
export * from './magnetic-snap';
export * from './manipulation-handles';
export * from './persistent-anchors';
export * from './shared-room';
export * from './spatial-audio';
export * from './spatial-locomotion';
export * from './spatial-measure';
export * from './spatial-paint';
export * from './splat-loader';
export * from './world-understanding';
