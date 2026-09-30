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
 * @fileoverview Standard <xr-live> bundle entry point (xr-live.min.js).
 * Includes everything in xr-live-viewer plus live <script type="text/three">
 * procedural Three.js scene authoring and runtime GLB/USDZ baking.
 */

import {authorScriptRunner} from '../../three-live/src/three-author';
import {createUSDZBlob, sceneToGLB} from '../../three-live/src/three-convert';
import {ThreeLiveElement} from '../../three-live/src/three-live-element';
import {registerXRSceneConverter} from './xr-registry';

ThreeLiveElement.registerScriptRunner(authorScriptRunner);
registerXRSceneConverter({createUSDZBlob, sceneToGLB});

export * from '../../three-live/src/three-author';
export * from '../../three-live/src/three-convert';
export * from './viewer';
