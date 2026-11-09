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
 * @fileoverview All-in-one 3D & XR bundle entry point for <xr-live> (xr-live-full.min.js).
 * Includes standard <xr-live> (with Three.js authoring), all xr-live-sensors (Depth, Physics,
 * Hand Gestures, Desktop Simulator, Spatial Audio, WebMCP), plus all three-live plugins
 * (three-live-studio lighting/materials/shadows/bloom/outline, three-live-cad extrude/CSG/text,
 * three-live-animation keyframes/skinning/morph/IK, and three-live-ai editScene),
 * the 14 xr-live-spatial plugins (head-follow, manipulation-handles, world-understanding,
 * gemini-live, spatial-paint, depth-particles, splat-loader, etc.), and the
 * xr-live-sim plugins (character-controller, steering-agents, hit-zones,
 * objectives, synth-audio).
 */

export * from '../../three-live/src/full';
export * from './bundle';
export * from './plugins/index';
export * from './sensors';
export * from './sim/index';
export * from './webgpu';
