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
 * @fileoverview Studio Extras & WebXR AR Suite plugin bundle for <three-live>.
 * Includes Planar Contact Shadows, 3D Interactive Hotspots,
 * Custom HDR/LDR Radiance Maps & True IBL (Spherical Harmonics + Karis Split-Sum),
 * Luxury PBR & Optical Materials (Clearcoat, Sheen, Transmission, Volume, IOR, Dispersion, Iridescence),
 * and In-Browser WebXR Augmented Reality Suite (DOM Overlay, Hit-Test Reticle & Gestures, Light Estimation).
 */

import {registerPlugin} from './plugin';
import {
  environmentMapPlugin,
  getEnvironmentSH,
  setEnvironmentSH,
} from './plugins/envmap';
import {hotspotPlugin} from './plugins/hotspots';
import {materialsPlugin, registerMaterialShader} from './plugins/materials';
import {contactShadowPlugin} from './plugins/shadows';
import {webxrPlugin} from './plugins/webxr';

// Auto-register Studio Extras & WebXR Suite plugins
registerPlugin(contactShadowPlugin);
registerPlugin(hotspotPlugin);
registerPlugin(environmentMapPlugin);
registerPlugin(materialsPlugin);
registerPlugin(webxrPlugin);

export {
  contactShadowPlugin,
  environmentMapPlugin,
  getEnvironmentSH,
  hotspotPlugin,
  materialsPlugin,
  registerMaterialShader,
  setEnvironmentSH,
  webxrPlugin,
};
