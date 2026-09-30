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
 * @fileoverview Deep XR, Simulator & AI Extras plugin bundle for <xr-live> (xr-live-extras.min.js).
 * Includes Hardware Depth Occlusion (XRDepthManager), Heightfield Physics (XRHeightfieldPhysics),
 * 25-Joint Hand Gestures (XRHandGestureClassifier), Desktop WASD Simulator (XRDesktopSimulator),
 * AR/VR Skybox Transitions, Spatial Audio HRTF Earcons, AI Frame Snapshotter, and Gemini WebMCP tools.
 */

import {XRDepthManager} from './xr-depth';
import {
  captureXRViewFrame,
  registerXRLiveWebMCPTools,
  XRModeTransitionController,
  XRSpatialAudioController,
} from './xr-extras';
import {XRHandGestureClassifier} from './xr-gestures';
import {XRHeightfieldPhysics} from './xr-physics';
import {registerXRExtras} from './xr-registry';
import {XRDesktopSimulator} from './xr-simulator';

registerXRExtras({
  createDepthManager: () => new XRDepthManager(),
  createPhysics: () => new XRHeightfieldPhysics(),
  createGestureClassifier: () => new XRHandGestureClassifier(),
  createSimulator: () => new XRDesktopSimulator(),
  createTransitionController: () => new XRModeTransitionController(),
  createAudioController: () => new XRSpatialAudioController(),
  captureXRViewFrame,
  registerXRLiveWebMCPTools,
});

export * from './xr-depth';
export * from './xr-extras';
export * from './xr-gestures';
export * from './xr-physics';
export * from './xr-simulator';
