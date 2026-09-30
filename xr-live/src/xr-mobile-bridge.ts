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
 * @fileoverview Phase 3.2: Mobile Web AR Bridges for iOS Safari & Android In-App Browsers.
 * - On iPhone/iPad Safari (where Apple disables WebXR), compiles the live scene + `userData.xr`
 *   schemas (`preliminary_anchoring`, `PhysicsBodyAPI`, `timeSamples`) into an in-memory `.usdz`
 *   in <15ms and launches native iOS ARKit Quick Look (`<a rel="ar">`).
 * - On Android In-App WebViews (where WebXR is unavailable), compiles the live scene into a
 *   `.glb` and launches native Google ARCore Scene Viewer via `intent://`.
 */

import type {SceneOrGLBSource} from '../../three-live/src/three-convert';
import {
  createSceneViewerIntent,
  isQuickLookSupported,
  isSceneViewerSupported,
  isWebXRSupported,
  launchQuickLook,
  type QuickLookOptions,
  type SceneViewerOptions,
} from '../../three-live/src/three-xr';
import {getXRSceneConverter} from './xr-registry';

export interface MobileARLaunchReport {
  platform: 'webxr' | 'ios-quicklook' | 'android-scene-viewer' | 'simulator';
  usdzByteLength?: number;
  glbByteLength?: number;
  intentUrl?: string;
}

export const buildAndroidSceneViewerIntentUrl = createSceneViewerIntent;

/**
 * Resolves the optimal mobile/headset AR launch path for `<xr-live>`.
 */
export async function launchBestMobileOrHeadsetAR(
  source: SceneOrGLBSource,
  options?: {
    quickLook?: QuickLookOptions;
    sceneViewer?: SceneViewerOptions;
    forceFallback?: 'ios-quicklook' | 'android-scene-viewer';
  },
): Promise<MobileARLaunchReport> {
  const converter = getXRSceneConverter();
  if (
    options?.forceFallback === 'ios-quicklook' ||
    (!options?.forceFallback &&
      !(await isWebXRSupported()) &&
      isQuickLookSupported())
  ) {
    const blob = converter
      ? converter.createUSDZBlob(source)
      : new Blob([source instanceof Uint8Array ? source : new Uint8Array(0)], {
          type: 'model/vnd.usdz+zip',
        });
    if (typeof document !== 'undefined') {
      launchQuickLook(blob, options?.quickLook);
    }
    return {
      platform: 'ios-quicklook',
      usdzByteLength: blob.size,
    };
  }

  if (
    options?.forceFallback === 'android-scene-viewer' ||
    (!options?.forceFallback &&
      !(await isWebXRSupported()) &&
      isSceneViewerSupported())
  ) {
    let glbBytes: Uint8Array;
    if (source && typeof (source as any).traverse === 'function' && converter) {
      glbBytes = converter.sceneToGLB(source as any);
    } else if (source instanceof Uint8Array) {
      glbBytes = source;
    } else if (source instanceof ArrayBuffer) {
      glbBytes = new Uint8Array(source);
    } else {
      glbBytes = new Uint8Array(0);
    }

    let blobUrl = 'blob:scene.glb';
    if (
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const blob = new Blob([glbBytes], {type: 'model/gltf-binary'});
      const createdUrl = URL.createObjectURL(blob);
      blobUrl = createdUrl;
      if (typeof URL.revokeObjectURL === 'function') {
        setTimeout(() => {
          try {
            URL.revokeObjectURL(createdUrl);
          } catch (_) {}
        }, 60000);
      }
    }
    const intentUrl = buildAndroidSceneViewerIntentUrl(
      blobUrl,
      options?.sceneViewer,
    );
    if (typeof window !== 'undefined' && window.location) {
      try {
        window.location.href = intentUrl;
      } catch (_) {}
    }
    return {
      platform: 'android-scene-viewer',
      glbByteLength: glbBytes.byteLength,
      intentUrl,
    };
  }

  if (await isWebXRSupported()) {
    return {platform: 'webxr'};
  }

  return {platform: 'simulator'};
}
