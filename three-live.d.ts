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
 * @fileoverview Ambient and module declarations for three-live and xr-live.
 * Enables zero-config, type-safe usage of <three-live> and <xr-live> in React 19,
 * Next.js, Vue, Svelte, and modern TSX/JSX environments.
 */

import type {
  CameraState,
  ThreeLiveElement,
} from './three-live/src/three-live-element';
import type {
  CameraDetail,
  GLBData,
  HitDetail,
  ThreeView,
} from './three-live/src/three-view';
import type {ARLaunchResult, ARMode} from './three-live/src/three-xr';
import type {TranscriptEvent} from './xr-live/src/plugins/gemini-live';
import type {Detection3D} from './xr-live/src/plugins/world-understanding';
import type {
  XRAnchorElement,
  XRDepthMode,
  XRHandsMode,
  XRLiveElement,
  XRMode,
  XRProfile,
  XRSimulatorRoom,
} from './xr-live/src/xr-live-element';

export * from './three-live/src/core';
export {
  getInteractivityVM,
  interactivityPlugin,
  InteractivityVM,
  parseSafeGltfPointer,
  sendInteractivityEvent,
  type InteractivityDeclaration,
  type InteractivityEventDef,
  type InteractivityFlowTarget,
  type InteractivityGraph,
  type InteractivityNode,
  type InteractivityValue,
  type InteractivityValueSocket,
  type InteractivityVariableDef,
} from './three-live/src/plugins/interactivity';
export {
  ThreeLiveElement,
  type ARLaunchOptions,
  type ARLaunchResult,
  type ARMode,
  type ARProvider,
  type CameraState,
} from './three-live/src/three-live-element';
export {
  XRAnchorElement,
  XRLiveElement,
  type XRDepthMode,
  type XRHandsMode,
  type XRMode,
  type XRProfile,
  type XRSimulatorRoom,
} from './xr-live/src/xr-live-element';
/** Optional XR Blocks plugins (`xr-live/blocks`, `xr-live-blocks.min.js`). */
export * from './xr-live/src/plugins/index';

/**
 * Declarative JSX / HTML attributes supported by the <three-live> custom element.
 */
export interface ThreeLiveAttributes {
  /** URL to glTF 2.0 binary (.glb) model. */
  'src'?: string;
  /** URL to Apple Universal Scene Description (.usdz) model for iOS Quick Look. */
  'ios-src'?: string;
  /** URL or inline script for procedural Three.js scene generation. */
  'script-src'?: string;
  /** Responsive image preview shown before 3D model finishes hydration. */
  'poster'?: string;
  /** Uniform or per-axis scale multiplier ("x y z"). */
  'scale'?: string;
  /** Initial camera orbit angles and distance: "theta phi [radius]" (e.g. "0deg 75deg 3m") or JSON string. */
  'camera-orbit'?: string | CameraState;
  /** Orbit center coordinate "x y z". */
  'camera-target'?: string;
  /** Lower bounds for camera orbit ("theta phi radius"). */
  'min-camera-orbit'?: string;
  /** Upper bounds for camera orbit ("theta phi radius"). */
  'max-camera-orbit'?: string;
  /** Vertical field of view angle (e.g. "45deg"). */
  'field-of-view'?: string;
  /** Sub-mesh name to highlight with interactive selection color. */
  'selected-mesh'?: string;
  /** Exposure / lighting multiplier for studio IBL lighting (default: 1.0). */
  'exposure'?: number | string;
  /** Equirectangular HDR/LDR environment map URL. */
  'environment-image'?: string;
  /** Visible background equirectangular skybox image URL. */
  'skybox-image'?: string;
  /** Ground contact shadow opacity (0.0 to 1.0). */
  'shadow-intensity'?: number | string;
  /** Radial Gaussian blur falloff of contact shadow (0.0 to 1.0). */
  'shadow-softness'?: number | string;
  /** Tone mapping mode ("neutral", "reinhard", "none"). */
  'tone-mapping'?: string;
  /** Enable or disable interactive camera orbit/pan/zoom controls (default: true). */
  'camera-controls'?: boolean | string;
  /** Automatically start keyframe animation playback. */
  'autoplay'?: boolean | string;
  /** Name of specific glTF animation clip to play. */
  'animation-name'?: string;
  /** Automatically rotate scene around the Y-axis when user is idle. */
  'auto-rotate'?: boolean | string;
  /** Delay in milliseconds before auto-rotation resumes after user interaction (default: 3000). */
  'auto-rotate-delay'?: number | string;
  /** Rate of turntable auto-rotation (e.g. "30deg", "0.5rad", "100%", default: "30deg"). */
  'rotation-per-second'?: string;
  /** Enable one-tap Augmented Reality button overlay. */
  'ar'?: boolean | string;
  /** Ordered list of AR launch targets ('webxr', 'quick-look', 'scene-viewer'). */
  'ar-modes'?: string;
  /** Controls whether the model can be scaled in AR ("auto" or "fixed"). */
  'ar-scale'?: 'auto' | 'fixed';
  /** Controls whether the model is placed on horizontal surfaces ("floor") or vertical surfaces ("wall"). */
  'ar-placement'?: 'floor' | 'wall';
  /**
   * Mandatory isolation level for procedural scripts. Defaults to `'worker'`,
   * which runs the script in a dedicated Web Worker with network, storage and
   * thread-spawning capabilities revoked across the prototype chain. `'iframe'`
   * runs the Worker inside an opaque-origin `<iframe sandbox="allow-scripts">`
   * (`three-live-sandbox.html`) with a strict `connect-src 'none'` Content
   * Security Policy.
   */
  sandbox?: 'worker' | 'iframe';
  /**
   * Opt-in attribute allowing client-modified Three.js script strings
   * (`executeScript(code)` and inline `<script type="text/three-live">`).
   * Server-generated scripts (`script-src`) are enabled by default.
   */
  'allow-client-scripts'?: boolean | string;

  // React 19 / JSX Event Listeners
  onload?: (e: CustomEvent<{model: GLBData}>) => void;
  onerror?: (e: CustomEvent<{error: any}>) => void;
  onmeshclick?: (e: CustomEvent<HitDetail>) => void;
  'oncamera-change'?: (e: CustomEvent<CameraDetail>) => void;
  'onar-status'?: (
    e: CustomEvent<{
      status: 'session-started' | 'not-presenting' | 'failed';
      error?: any;
    }>,
  ) => void;

  // Standard HTML / JSX attributes
  id?: string;
  className?: string;
  class?: string;
  style?: any;
  ref?: any;
  key?: any;
  slot?: string;
  tabIndex?: number;
  role?: string;
  'aria-label'?: string;
  children?: any;
}

/**
 * Declarative JSX / HTML attributes supported by the <xr-live> spatial computing element.
 */
export interface XRLiveAttributes extends ThreeLiveAttributes {
  /** WebXR session target mode ("ar", "vr", "inline", or "auto"). */
  'xr-mode'?: XRMode;
  /** Real-world hardware depth occlusion or physics mode ("occlusion", "occlusion-physics", "mesh", "none"). */
  'xr-depth'?: XRDepthMode;
  /** 25-joint hand tracking and gesture recognition mode ("gestures", "joints", "pinch", "none"). */
  'xr-hands'?: XRHandsMode;
  /** Desktop room simulator environment ("living-room", "office", "tabletop", "none"). */
  'xr-simulator'?: XRSimulatorRoom;
  /** Spatial UI profile ("quest3", "android-xr", "visionos", "auto"). */
  'xr-profile'?: XRProfile;
  /** XR Blocks: enables plane/mesh detection; include "reticle" for a gaze reticle. */
  'world-understanding'?: boolean | string;
  /** XR Blocks: pinch in empty space to paint 3D tubes (optional `#rrggbb` color). */
  'spatial-paint'?: boolean | string;
  'onxr-object-detected'?: (e: CustomEvent<Detection3D>) => void;
  'onxr-transcription'?: (e: CustomEvent<TranscriptEvent>) => void;
  'onxr-hold-to-ask'?: (
    e: CustomEvent<{mesh: string; transcript: string; prompt: string}>,
  ) => void;
  'onxr-handles-change'?: (
    e: CustomEvent<{mesh: string; scale: number; yawDeg: number}>,
  ) => void;
  'onxr-paint-stroke'?: (
    e: CustomEvent<{index: number; points: number; lengthMeters: number}>,
  ) => void;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'three-live': ThreeLiveAttributes;
      'xr-live': XRLiveAttributes;
    }
  }

  interface HTMLElementTagNameMap {
    'three-live': ThreeLiveElement;
    'xr-live': XRLiveElement;
    'xr-anchor': XRAnchorElement;
  }
}
