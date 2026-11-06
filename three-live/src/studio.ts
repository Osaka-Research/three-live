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

// Studio Rendering & WebXR AR Suite plugin bundle for <three-live> (three-live-studio.min.js).
// Includes Planar Contact Shadows, 3D Interactive Hotspots,
// Custom HDR/LDR Radiance Maps & True IBL (Spherical Harmonics + Karis Split-Sum),
// Luxury PBR & Optical Materials (Clearcoat, Sheen, Transmission, Volume, IOR, Dispersion, Iridescence),
// HDR Kawase Bloom & Silhouette Outlines, KHR_materials_variants, EXT_meshopt_compression,
// KHR_interactivity VM, and In-Browser WebXR Augmented Reality Suite.

import {registerPlugin} from './plugin';
import {
  environmentMapPlugin,
  getEnvironmentSH,
  setEnvironmentSH,
} from './plugins/envmap';
import {hotspotPlugin} from './plugins/hotspots';
import {
  getInteractivityVM,
  interactivityPlugin,
  InteractivityVM,
  parseSafeGltfPointer,
  sendInteractivityEvent,
} from './plugins/interactivity';
import {
  decimateGeometry,
  getLodController,
  installLodExtension,
  LOD,
  LodController,
  lodPlugin,
  parseLod,
  selectLodLevelIndex,
  type LodGroupState,
  type LodLevel,
  type LodOptions,
} from './plugins/lod';
import {materialsPlugin, registerMaterialShader} from './plugins/materials';
import {
  applyMeshoptFilter,
  decodeMeshoptBuffer,
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
  meshoptDecoder,
  meshoptPlugin,
  type MeshoptFilter,
  type MeshoptMode,
} from './plugins/meshopt';
import {
  computeOutlineClipOffset,
  evaluateKawaseBloom,
  parseHexRgb,
  postprocessingPlugin,
} from './plugins/postprocessing';
import {contactShadowPlugin} from './plugins/shadows';
import {
  extractMaterialVariants,
  extractPrimitiveVariantMappings,
  selectMaterialVariant,
  variantsPlugin,
  type VariantMapping,
} from './plugins/variants';
import {webxrPlugin} from './plugins/webxr';

// Auto-register Studio Rendering & WebXR Suite plugins
registerPlugin(contactShadowPlugin);
registerPlugin(hotspotPlugin);
registerPlugin(environmentMapPlugin);
registerPlugin(materialsPlugin);
registerPlugin(webxrPlugin);
registerPlugin(interactivityPlugin);
registerPlugin(meshoptPlugin);
registerPlugin(variantsPlugin);
registerPlugin(postprocessingPlugin);
registerPlugin(lodPlugin);

export {
  applyMeshoptFilter,
  computeOutlineClipOffset,
  contactShadowPlugin,
  decimateGeometry,
  decodeMeshoptBuffer,
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
  environmentMapPlugin,
  evaluateKawaseBloom,
  extractMaterialVariants,
  extractPrimitiveVariantMappings,
  getEnvironmentSH,
  getInteractivityVM,
  getLodController,
  hotspotPlugin,
  installLodExtension,
  interactivityPlugin,
  InteractivityVM,
  LOD,
  LodController,
  lodPlugin,
  materialsPlugin,
  meshoptDecoder,
  meshoptPlugin,
  parseHexRgb,
  parseLod,
  parseSafeGltfPointer,
  postprocessingPlugin,
  registerMaterialShader,
  selectLodLevelIndex,
  selectMaterialVariant,
  sendInteractivityEvent,
  setEnvironmentSH,
  variantsPlugin,
  webxrPlugin,
  type LodGroupState,
  type LodLevel,
  type LodOptions,
  type MeshoptFilter,
  type MeshoptMode,
  type VariantMapping,
};
