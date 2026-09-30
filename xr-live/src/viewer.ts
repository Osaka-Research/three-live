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
 * @fileoverview Production .glb/.usdz WebXR Viewer bundle entry point for <xr-live>.
 * Includes <xr-live> Custom Element, WebGL2 PBR renderer (ThreeView), AR/USDZ packager,
 * 6DoF Input & Raycasting, 1/2-hand Grab & Scale traits, Capsule Billboarding,
 * <div slot="spatial"> DOM projection, and iOS QuickLook / Android Scene Viewer AR bridge.
 * Excludes the Three.js script authoring compiler (three-author) and heavy XR extras.
 */

import {ThreeLiveElement} from '../../three-live/src/three-live-element';
import {activateAR, createUSDZBlob} from '../../three-live/src/three-xr';
import {
  XRAnchorElement,
  XRLiveElement,
  xrLiveSpatialPlugin,
  type XRDepthMode,
  type XRHandsMode,
  type XRMode,
  type XRProfile,
  type XRSimulatorRoom,
} from './xr-live-element';

ThreeLiveElement.registerAR({activateAR, createUSDZBlob});

export {ThreeLiveElement, ThreeView} from '../../three-live/src/viewer';
export * from './xr-input';
export * from './xr-mobile-bridge';
export * from './xr-spatial-slot';
export * from './xr-traits';
export {
  XRAnchorElement,
  XRLiveElement,
  xrLiveSpatialPlugin,
  type XRDepthMode,
  type XRHandsMode,
  type XRMode,
  type XRProfile,
  type XRSimulatorRoom,
};
