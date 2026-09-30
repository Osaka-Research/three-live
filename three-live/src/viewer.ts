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
 * @fileoverview Ultra-lean 3D viewer entrypoint for <three-live> Web Component.
 * Bundles the WebGL2 PBR renderer (ThreeView) and custom element (ThreeLiveElement)
 * WITHOUT spatial AR (three-xr) or scene authoring (three-author).
 * Ideal for desktop web, product catalogs, dashboards, and zero-AR applications.
 */

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
