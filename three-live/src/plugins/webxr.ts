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
 * @fileoverview In-Browser WebXR Augmented Reality Plugin Suite for three-live.
 * Augments `WebXRSessionManager` with:
 * - Custom `[slot="ar-overlay"]` DOM Overlay binding + `beforexrselect` event shielding
 *   (never binding the opaque `<three-live>` / `<xr-live>` host element itself)
 * - Real-World Environmental Lighting Estimation (`light-estimation` probe
 *   syncing directional sun vector + 9-band Spherical Harmonics `uSH[9]`)
 */

import type {ThreeLivePlugin} from '../plugin';
import {setEnvironmentSH} from './envmap';

interface XRPluginState {
  lightProbe: any | null;
}

const sessionStates = new WeakMap<object, XRPluginState>();

export const webxrPlugin: ThreeLivePlugin = {
  name: 'webxr-suite',

  onConfigureXRSessionInit(element: any, sessionInit: XRSessionInit): void {
    const optional = new Set<string>(sessionInit.optionalFeatures || []);
    optional.add('hit-test');
    optional.add('light-estimation');

    // Only bind custom user-provided [slot="ar-overlay"] here; WebXRSessionManager
    // provides a dedicated transparent HUD overlay when none is specified.
    const customOverlayRoot =
      element?.querySelector?.('[slot="ar-overlay"]') || null;

    if (customOverlayRoot) {
      optional.add('dom-overlay');
      (sessionInit as any).domOverlay = {root: customOverlayRoot};
      customOverlayRoot.addEventListener?.('beforexrselect', (e: Event) => {
        e.preventDefault();
      });
    }
    sessionInit.optionalFeatures = Array.from(optional);
  },

  onXRFrame(view: any, session: any, frame: any, refSpace: any): void {
    if (!view || !session || !frame || !refSpace) return;

    let state = sessionStates.get(session);
    if (!state) {
      state = {lightProbe: null};
      sessionStates.set(session, state);

      if (typeof session.requestLightProbe === 'function') {
        session
          .requestLightProbe()
          .then((probe: any) => {
            if (state && probe) state.lightProbe = probe;
          })
          .catch(() => {});
      }
    }

    if (state.lightProbe && typeof frame.getLightEstimate === 'function') {
      const estimate = frame.getLightEstimate(state.lightProbe);
      if (estimate) {
        const dir = estimate.primaryLightDirection;
        const intensity = estimate.primaryLightIntensity;
        if (dir && intensity && Array.isArray(view.lights)) {
          let dirLight = view.lights.find((l: any) => l.type === 'directional');
          if (!dirLight) {
            dirLight = {
              type: 'directional',
              direction: [0.5, 1.0, 0.8],
              color: [1, 1, 1],
              intensity: 1.0,
            };
            view.lights.push(dirLight);
          }
          dirLight.direction = [dir.x, dir.y, dir.z];
          const maxChannel = Math.max(
            intensity.x,
            intensity.y,
            intensity.z,
            0.001,
          );
          dirLight.color = [
            intensity.x / maxChannel,
            intensity.y / maxChannel,
            intensity.z / maxChannel,
          ];
          dirLight.intensity = maxChannel;
        }
        if (estimate.sphericalHarmonicsCoefficients && view.gl) {
          setEnvironmentSH(view.gl, estimate.sphericalHarmonicsCoefficients);
        }
      }
    }
  },
};
