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

// Procedural 2D/3D CAD & Vector Text plugin bundle for <three-live> (three-live-cad.min.js).
// Includes 2D Path & Shape with ear-clipping hole triangulation, ExtrudeGeometry with Beveling,
// 3D BSP-tree CSG Boolean Operations (union, subtract, intersect), and built-in stroke-font TextGeometry.

import {registerPlugin} from './plugin';
import {
  cadPlugin,
  installCadExtension,
  MAX_BSP_DEPTH,
  MAX_CSG_TRIANGLES,
  MAX_SHAPE_POINTS,
  MAX_TEXT_GEOMETRY_CHARS,
  type ExtrudeGeometryOptions,
  type TextGeometryOptions,
} from './plugins/cad';

// Auto-register CAD & Vector Text plugin
registerPlugin(cadPlugin);

export {
  cadPlugin,
  installCadExtension,
  MAX_BSP_DEPTH,
  MAX_CSG_TRIANGLES,
  MAX_SHAPE_POINTS,
  MAX_TEXT_GEOMETRY_CHARS,
  type ExtrudeGeometryOptions,
  type TextGeometryOptions,
};
