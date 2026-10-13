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
 * @fileoverview Default lean entrypoint for <three-live> Web Component.
 * Bundles the WebGL2 PBR renderer (three-view), Universal Spatial AR (three-xr),
 * and custom element (ThreeLiveElement) without three-author.
 */

import {registerPlugin} from './plugin';
import {contactShadowPlugin} from './plugins/shadows';
import {authorScriptRunner, THREE} from './three-author';
import {ThreeLiveElement} from './three-live-element';
import {
  activateAR,
  createUSDZBlob,
  getARCapabilities,
  getBestARMode,
  isQuickLookSupported,
  isSceneViewerSupported,
  isWebXRSupported,
  type ARCapabilities,
} from './three-xr';

// Automatically register AR provider, contact shadows, and Three.js script runner for the default bundle
ThreeLiveElement.registerAR({activateAR, createUSDZBlob});
ThreeLiveElement.registerScriptRunner(authorScriptRunner);
registerPlugin(contactShadowPlugin);

export {
  ThreeLiveElement,
  type ARLaunchOptions,
  type ARLaunchResult,
  type ARMode,
  type ARProvider,
  type CameraState,
} from './three-live-element';
export {
  ThreeView,
  toGLBData,
  type CameraDetail,
  type GLBData,
  type HitDetail,
} from './three-view';
export {
  activateAR,
  createUSDZBlob,
  getARCapabilities,
  getBestARMode,
  isQuickLookSupported,
  isSceneViewerSupported,
  isWebXRSupported,
  type ARCapabilities,
} from './three-xr';
export {THREE};
