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
 * @fileoverview Lightweight registry for XR-Live modular plugins (xr-live-extras and scene converters).
 * Enables tree-shaking between xr-live-viewer, xr-live, xr-live-extras, and xr-live-full.
 */

import {mat4Create} from '../../three-live/src/math';
import {getSharedRegistry} from '../../three-live/src/plugin';
import type {XRPose6DoF} from './xr-traits';

export interface XRExtrasProvider {
  createDepthManager: () => any;
  createPhysics: () => any;
  createGestureClassifier: () => any;
  createSimulator: () => any;
  createTransitionController: () => any;
  createAudioController: () => any;
  captureXRViewFrame: (...args: any[]) => Promise<any>;
  registerXRLiveWebMCPTools: (...args: any[]) => void;
}

export interface XRSceneConverter {
  createUSDZBlob: (source: any) => Blob;
  sceneToGLB: (source: any) => Uint8Array;
}

function createNoopExtras(): XRExtrasProvider {
  const defaultPose = (): XRPose6DoF => ({
    position: [0, 1.6, 0],
    quaternion: [0, 0, 0, 1],
    matrix: mat4Create(),
  });
  return {
    createDepthManager: () => ({
      configureSessionInit() {},
      updateFromXRFrame() {
        return null;
      },
      sampleDepthAndNormal() {
        return null;
      },
      dispose() {},
    }),
    createPhysics: () => ({
      step() {},
    }),
    createGestureClassifier: () => ({
      processXRFrame() {},
    }),
    createSimulator: () => ({
      active: false,
      room: {floorY: 0, tableY: 0.75, wallZ: -2.0},
      configureRoom() {},
      stepLocomotion: defaultPose,
      getHeadPose: defaultPose,
      getVirtualHandPose: () => undefined,
    }),
    createTransitionController: () => ({
      transitionToVR() {},
      transitionToAR() {},
      step() {},
      getAlpha() {
        return 0;
      },
    }),
    createAudioController: () => ({
      syncSpatialNodes() {},
      playEarcon() {},
    }),
    captureXRViewFrame: async () => ({
      dataUrl: '',
      width: 0,
      height: 0,
      timestamp: Date.now(),
      headPose: defaultPose(),
    }),
    registerXRLiveWebMCPTools: () => {},
  };
}

export function registerXRExtras(provider: XRExtrasProvider): void {
  getSharedRegistry().xrExtrasProvider = provider;
}

export function getXRExtras(): XRExtrasProvider {
  const reg = getSharedRegistry();
  if (!reg.xrExtrasProvider) {
    reg.xrExtrasProvider = createNoopExtras();
  }
  return reg.xrExtrasProvider;
}

export function registerXRSceneConverter(converter: XRSceneConverter): void {
  getSharedRegistry().xrSceneConverter = converter;
}

export function getXRSceneConverter(): XRSceneConverter | null {
  return getSharedRegistry().xrSceneConverter ?? null;
}
