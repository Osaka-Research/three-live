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
 * @fileoverview Full bundle entrypoint for three-live.
 * Includes the <three-live> custom element, ThreeView runtime, ThreeXR AR packager,
 * and ThreeAuthor imperative Three.js scene graph authoring.
 */

import {authorScriptRunner} from './three-author';
import {ThreeLiveElement} from './three-live-element';

import * as ThreeLiveBundleExports from './full';

ThreeLiveElement.registerScriptRunner(authorScriptRunner);

if (typeof window !== 'undefined') {
  (window as any).ThreeLiveBundle = ThreeLiveBundleExports;
}

export * from './animation';
export * from './cad';
export * from './index';
export * from './procedural';
export * from './studio';
export * from './three-author';
