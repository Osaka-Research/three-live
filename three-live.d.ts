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
import type {
  Detection3D,
  DimensionUnit,
  ExplodeMode,
  RemotePeerState,
  SnapSurfaceMode,
  TranscriptEvent,
} from './xr-live/src/plugins/index';
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
  cadPlugin,
  installCadExtension,
  MAX_BSP_DEPTH,
  MAX_CSG_TRIANGLES,
  MAX_SHAPE_POINTS,
  MAX_TEXT_GEOMETRY_CHARS,
  type ExtrudeGeometryOptions,
  type TextGeometryOptions,
} from './three-live/src/plugins/cad';
export {
  installProceduralExtension,
  proceduralPlugin,
} from './three-live/src/plugins/procedural';
export {
  ikPlugin,
  IKSolver,
  quatFromUnitVectors,
  solveFABRIK,
  solveTwoBoneIK,
  type FABRIKSolution,
  type IKQuat,
  type TwoBoneIKSolution,
} from './three-live/src/plugins/ik';
export {
  extractNodeInstancing,
  instancingPlugin,
} from './three-live/src/plugins/instancing';
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
  decimateGeometry,
  getLodController,
  installLodExtension,
  LOD,
  LodController,
  lodPlugin,
  materializeLodGeometry,
  parseLod,
  selectLodLevelIndex,
  type LodGroupState,
  type LodLevel,
  type LodOptions,
} from './three-live/src/plugins/lod';
export {
  applyMeshoptFilter,
  decodeMeshoptBuffer,
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
  meshoptDecoder,
  meshoptPlugin,
  type MeshoptFilter,
  type MeshoptMode,
} from './three-live/src/plugins/meshopt';
export {
  computeOutlineClipOffset,
  evaluateKawaseBloom,
  parseHexRgb,
  postprocessingPlugin,
  resolveViewerBloom,
} from './three-live/src/plugins/postprocessing';
export {
  extractMaterialVariants,
  extractPrimitiveVariantMappings,
  selectMaterialVariant,
  variantsPlugin,
  type VariantMapping,
} from './three-live/src/plugins/variants';
export {
  defineModelViewer,
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
/** Opt-in bring-your-own-LLM scene editing (`three-live/ai`, `three-live-ai.min.js`). */
export {
  aiPlugin,
  createAIChatProvider,
  editScene,
  extractScript,
  undoEdit,
} from './three-live/src/plugins/ai';
export type {
  AIChatMessage,
  AIChatProviderOptions,
  EditSceneOptions,
  EditSceneResult,
  ThreeLiveAIProvider,
} from './three-live/src/plugins/ai';
/** "Tap & Speak" voice editing (part of `three-live-ai.min.js`). */
export {
  AIVoiceSession,
  connectVoice,
  createWebSpeechRecognizer,
  describeEditResult,
  geminiLiveAdapter,
  realtimeAdapter,
  setSelectOnTap,
  startVoiceEdit,
} from './three-live/src/plugins/ai-voice';
export type {
  AIAudioSink,
  AIMicrophoneSource,
  AISpeechRecognizer,
  AIVoiceAdapter,
  AIVoiceEditOptions,
  AIVoiceEditResult,
  AIVoiceEventDetail,
  AIVoiceProviderName,
  AIVoiceSessionOptions,
  AIVoiceState,
  AIVoiceTransport,
} from './three-live/src/plugins/ai-voice';
/** Optional spatial plugins (`xr-live/spatial`, `xr-live-spatial.min.js`). */
export * from './xr-live/src/plugins/index';
/** Optional simulation plugins (`xr-live/sim`, `xr-live-sim.min.js`). */
export * from './xr-live/src/sim/index';

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
  /** Tone mapping mode ("neutral", "aces", "agx", "reinhard", "none"). */
  'tone-mapping'?: string;
  /** Dual-Kawase bloom intensity (0.0 to 5.0). */
  'bloom'?: number | string;
  /** Luminance threshold for bloom extraction (default: 0.8). */
  'bloom-threshold'?: number | string;
  /** Blur radius multiplier for bloom passes (default: 0.5). */
  'bloom-radius'?: number | string;
  /** Declarative silhouette outline toggle or config. */
  'outline'?: boolean | string;
  /** Highlight the currently `selected-mesh` with a silhouette outline. */
  'outline-selected'?: boolean | string;
  /** Silhouette outline CSS hex color (default: "#38bdf8"). */
  'outline-color'?: string;
  /** Enable or disable interactive camera orbit/pan/zoom controls (default: true). */
  'camera-controls'?: boolean | string;
  /** Automatically start keyframe animation playback. */
  'autoplay'?: boolean | string;
  /** Name of specific glTF animation clip to play. */
  'animation-name'?: string;
  /** Name of the active KHR_materials_variants material variant. */
  'variant-name'?: string;
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
  /** `three-live-ai`: Chat Completions-compatible endpoint (your proxy or a local model) for `editScene()`. */
  'ai-endpoint'?: string;
  /** `three-live-ai`: model name sent to `ai-endpoint`. */
  'ai-model'?: string;
  /** `three-live-ai`: provider protocol for `ai-endpoint` (`'ai-chat'`, the default). */
  'ai-provider'?: 'ai-chat';
  /** `three-live-ai`: tapping a mesh sets `selected-mesh` (tap again to clear) for voice and text edits. */
  'ai-select-on-tap'?: boolean | string;
  /** `three-live-ai`: show a mic button (push-to-talk, or a realtime session when `ai-voice-url` is set). */
  'ai-voice-button'?: boolean | string;
  /** `three-live-ai`: `wss://` realtime voice endpoint (your proxy or an ephemeral-token URL) for the mic button. */
  'ai-voice-url'?: string;
  /** `three-live-ai`: realtime voice protocol for `ai-voice-url` (`'ai-realtime'`, the default, or `'gemini-live'`). */
  'ai-voice-provider'?: 'ai-realtime' | 'gemini-live';
  /** `three-live-ai`: model name sent in the realtime session setup. */
  'ai-voice-model'?: string;

  // React 19 / JSX Event Listeners
  onload?: (e: CustomEvent<{model: GLBData}>) => void;
  onerror?: (e: CustomEvent<{error: any}>) => void;
  'onthree-load'?: (
    e: CustomEvent<{model: GLBData; source?: 'src' | 'model'}>,
  ) => void;
  'onthree-error'?: (
    e: CustomEvent<{error: any; message: string; stage: string}>,
  ) => void;
  'onthree-context-lost'?: (e: CustomEvent<{originalEvent?: Event}>) => void;
  'onthree-context-restored'?: (
    e: CustomEvent<{originalEvent?: Event}>,
  ) => void;
  onmeshclick?: (e: CustomEvent<HitDetail>) => void;
  'oncamera-change'?: (e: CustomEvent<CameraDetail>) => void;
  'onvariant-applied'?: (e: CustomEvent<{variantName: string | null}>) => void;
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
  /** Desktop 3D room preview environment, unrelated to `xr-live-sim` ("living-room", "office", "tabletop", "none"). */
  'xr-simulator'?: XRSimulatorRoom;
  /** Spatial UI profile ("quest3", "android-xr", "visionos", "auto"). */
  'xr-profile'?: XRProfile;
  /** Play procedural Web Audio earcons and haptics on spatial interactions. */
  'sound-feedback'?: boolean | string;
  /** Spatial plugin: enables plane/mesh detection; include "reticle" for a gaze reticle. */
  'world-understanding'?: boolean | string;
  /** Spatial plugin: pinch in empty space to paint 3D tubes (optional `#rrggbb` color). */
  'spatial-paint'?: boolean | string;
  /** Spatial plugin: 3D dimension callouts and AR tape measure ("bounds", "tape", "all", "none"). */
  'spatial-measure'?: boolean | 'bounds' | 'tape' | 'all' | 'none' | string;
  /** Default display unit for `spatial-measure` ("auto", "m", "cm", "mm", "in", "ft-in"). */
  'measure-unit'?: DimensionUnit;
  /** Spatial plugin: socket, grid, surface, and angle snapping ("grid", "surface", "sockets", "all", "none"). */
  'magnetic-snap'?:
    | boolean
    | 'grid'
    | 'surface'
    | 'sockets'
    | 'all'
    | 'none'
    | string;
  /** Cartesian snap grid step in meters ("0.05" or "0.05 0.05 0.05"). */
  'snap-grid'?: number | string;
  /** Rotational yaw snap increment in degrees (0 to 180). */
  'snap-angle'?: number | string;
  /** Spatial plugin: hands-free eye/head gaze reticle and dwell selection ("auto", "none", or boolean). */
  'gaze-dwell'?: boolean | 'auto' | 'none' | string;
  /** Default dwell duration in milliseconds for `gaze-dwell` (250 to 10000, default: 1200). */
  'dwell-time'?: number | string;
  /** Spatial plugin: normalized [0..1] multi-part exploded-view factor. */
  'explode'?: number | string;
  /** Multi-part explosion vector strategy ("radial", "axial-x", "axial-y", "axial-z", "hierarchical"). */
  'explode-mode'?: ExplodeMode;
  /** Multiplier applied to per-part explosion distances (default: 1.0). */
  'explode-scale'?: number | string;
  /** Real-time cross-section clipping plane ("none", "x:0", "y:0.2", "-z:0", "interactive"). */
  'section-plane'?: string;
  /** Spatial plugin: persist manipulated anchor transforms under an optional storage namespace. */
  'persistent-anchors'?: boolean | string;
  /** Sync persisted anchor transforms into `#xr-state=<base64url>` for zero-backend link sharing. */
  'persist-url-hash'?: boolean | string;
  /** Spatial plugin: XR locomotion mode ("teleport", "snap-turn", "smooth", "teleport snap-turn", "none"). */
  'locomotion'?: boolean | string;
  /** Thumbstick snap-turn increment in degrees (default: 30). */
  'snap-turn-deg'?: number | string;
  /** Show a 120ms peripheral FOV comfort vignette on teleport/turn (default: true). */
  'comfort-vignette'?: boolean | string;
  /** Spatial plugin: join a multi-user room via BroadcastChannel ID or `wss://` relay URL. */
  'shared-room'?: string;
  /** Local display name broadcast to peers in `shared-room` (max 32 chars). */
  'peer-name'?: string;
  /** Local avatar visor & laser color (`#rrggbb`) in `shared-room`. */
  'peer-color'?: string;
  /** Opt-in WebRTC voice signaling relay (offer/answer/ICE) and `voiceGain` helpers in `shared-room`. Apps own `RTCPeerConnection` and audio. */
  'shared-room-voice'?: boolean | string;
  /** xr-live-sim: character camera mode, or `none` to disable the character. */
  'character-controller'?:
    | 'third-person'
    | 'first-person'
    | 'top-down'
    | 'fixed-camera'
    | 'none';
  /** xr-live-sim: character speed override (m/s). */
  'character-speed'?: number | string;
  /** xr-live-sim: character jump velocity override (m/s). */
  'character-jump'?: number | string;
  /** xr-live-sim: on-screen joystick (`auto` shows it on touch screens). */
  'touch-joystick'?: 'auto' | 'always' | 'none';
  /** xr-live-sim: `false` or `none` pauses steering agents. */
  'steering-agents'?: boolean | string;
  /** xr-live-sim: firing mode (empty means `projectile`). */
  'hit-zones'?: '' | 'projectile' | 'hitscan' | 'contact' | 'off';
  /** xr-live-sim: shots per second (default: 4). */
  'fire-rate'?: number | string;
  /** xr-live-sim: projectile speed in m/s (default: 14). */
  'projectile-speed'?: number | string;
  /** xr-live-sim: projectile gravity in m/s² (default: 0). */
  'projectile-gravity'?: number | string;
  /** xr-live-sim: integrity removed per hit (default: 25). */
  'hit-amount'?: number | string;
  /** xr-live-sim: enables objectives and scoring (`none` disables). */
  'objectives'?: boolean | string;
  /** xr-live-sim: scenario countdown in seconds. */
  'scenario-timer'?: number | string;
  /** xr-live-sim: score that passes the scenario. */
  'target-score'?: number | string;
  /** xr-live-sim: attempts before the scenario fails. */
  'attempts'?: number | string;
  /** xr-live-sim: score HUD style. */
  'sim-hud'?: 'auto' | 'minimal' | 'none';
  /** xr-live-sim: plays procedural audio cues (`muted` disables). */
  'synth-audio'?: boolean | string;
  /** xr-live-sim: cue volume from 0 to 1 (default: 0.7). */
  'synth-volume'?: number | string;
  /** Register WebMCP browser AI tools on `navigator.modelContext`. */
  'webmcp'?: boolean | string;
  /** Opt-in gate allowing WebMCP `capture_xr_view` to include the 8x8 depth grid. */
  'webmcp-allow-depth'?: boolean | string;
  /** Omit `headPosition` from WebMCP `inspect_xr_scene` responses. */
  'webmcp-omit-pose'?: boolean | string;

  'onxr-object-detected'?: (e: CustomEvent<Detection3D>) => void;
  'onxr-transcription'?: (e: CustomEvent<TranscriptEvent>) => void;
  'onxr-hold-to-ask'?: (
    e: CustomEvent<{mesh: string; transcript: string; prompt: string}>,
  ) => void;
  'onxr-handles-change'?: (
    e: CustomEvent<{mesh: any; scale: number; yawDeg: number}>,
  ) => void;
  'onxr-paint-stroke'?: (
    e: CustomEvent<{index: number; points: number; lengthMeters: number}>,
  ) => void;
  onmeasurecomplete?: (
    e: CustomEvent<{
      start: [number, number, number];
      end: [number, number, number];
      distanceMeters: number;
      formatted: string;
    }>,
  ) => void;
  onxrsnap?: (
    e: CustomEvent<{
      node: any;
      socket: any;
      position: [number, number, number];
      quaternion: [number, number, number, number];
      mode: 'socket' | 'grid' | 'surface' | 'angle';
    }>,
  ) => void;
  onxrunsnap?: (e: CustomEvent<{node: any; socket: any}>) => void;
  ongazeenter?: (
    e: CustomEvent<{node: any; point: [number, number, number]}>,
  ) => void;
  ongazeleave?: (e: CustomEvent<{node: any}>) => void;
  ongazedwell?: (
    e: CustomEvent<{
      node: any;
      point: [number, number, number];
      action: 'select' | 'ask';
    }>,
  ) => void;
  onexplodechange?: (
    e: CustomEvent<{
      factor: number;
      source: 'attribute' | 'gesture' | 'api' | 'peer';
    }>,
  ) => void;
  onanchorsrestored?: (
    e: CustomEvent<{
      count: number;
      source: 'xr-anchor' | 'storage' | 'url-hash';
    }>,
  ) => void;
  onxrteleport?: (
    e: CustomEvent<{
      from: [number, number, number];
      to: [number, number, number];
      yawDeg: number;
    }>,
  ) => void;
  onpeerjoin?: (
    e: CustomEvent<Pick<RemotePeerState, 'peerId' | 'name' | 'color'>>,
  ) => void;
  onpeerleave?: (
    e: CustomEvent<Pick<RemotePeerState, 'peerId' | 'name' | 'color'>>,
  ) => void;
  onpeersync?: (e: CustomEvent<{peerId: string; nodeId: string}>) => void;
  onpeergrabconflict?: (
    e: CustomEvent<{peerId: string; nodeId: string}>,
  ) => void;
  onpeerrtcsignal?: (
    e: CustomEvent<{
      peerId: string;
      targetPeerId: string;
      signalType: 'offer' | 'answer' | 'ice';
      sdp: string | null;
      candidate: string | null;
      sdpMid: string | null;
      sdpMLineIndex: number | null;
    }>,
  ) => void;
  onxraudioplay?: (
    e: CustomEvent<{
      node: string;
      meshIndex: number;
      preset: string | null;
      src: string | null;
      gain: number;
      pan: number;
      triggerCount: number;
    }>,
  ) => void;
  /** xr-live-sim events. */
  onxrcollision?: (
    e: CustomEvent<{
      nodeId: string;
      otherId: string;
      normal: [number, number, number];
      impactSpeed: number;
    }>,
  ) => void;
  onxrsleep?: (e: CustomEvent<{nodeId: string}>) => void;
  oncharacterjump?: (
    e: CustomEvent<{nodeId: string; position: [number, number, number]}>,
  ) => void;
  oncharacterland?: (
    e: CustomEvent<{nodeId: string; fallSpeed: number}>,
  ) => void;
  onagentstatechange?: (
    e: CustomEvent<{nodeId: string; state: string; targetId: string | null}>,
  ) => void;
  onagentreach?: (
    e: CustomEvent<{
      agentId: string;
      targetId: string;
      position: [number, number, number];
    }>,
  ) => void;
  onxrhit?: (
    e: CustomEvent<{
      targetId: string;
      /** Shooter node name, or `'user'`. */
      sourceId: string;
      amount: number;
      remaining: number;
      point: [number, number, number];
    }>,
  ) => void;
  onxrdepleted?: (
    e: CustomEvent<{targetId: string; group: string; scoreValue: number}>,
  ) => void;
  onxrzoneenter?: (
    e: CustomEvent<{zoneId: string; nodeId: string; group: string}>,
  ) => void;
  onxrzoneexit?: (
    e: CustomEvent<{zoneId: string; nodeId: string; group: string}>,
  ) => void;
  onxrspawn?: (
    e: CustomEvent<{spawnerId: string; instanceId: string; index: number}>,
  ) => void;
  onxrobjective?: (
    e: CustomEvent<{
      nodeId: string;
      tag: string;
      type: string;
      amount: number;
      totalScore: number;
      remainingRequired: number;
      outOfOrder: boolean;
    }>,
  ) => void;
  onxrscorechange?: (
    e: CustomEvent<{
      score: number;
      delta: number;
      attemptsLeft: number | null;
      timeRemaining: number | null;
    }>,
  ) => void;
  onxrscenarioend?: (
    e: CustomEvent<{
      outcome: 'pass' | 'fail' | 'timeout';
      finalScore: number;
      elapsedSec: number;
    }>,
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
