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
 * @fileoverview <xr-live> Spatial Web Component.
 * Subclasses <three-live> (ThreeLiveElement) to integrate:
 * - Phase 1.1: Stereo WebXR `renderXRView` loop
 * - Phase 1.2: 6DoF Input, 1-hand/2-hand Manipulation, Capsule Billboarding & Followers (`XRInputManager` + `XRTraitSystem`)
 * - Phase 1.3: HTML-First Spatial UI `<div slot="spatial">` Rasterizer & UV Event Bridge (`XRSpatialSlotManager`)
 * - Phase 1.4: Built-in Desktop XR Simulator (`XRDesktopSimulator`)
 * - Phase 2.1: WebXR Hardware Depth Occlusion (`XRDepthManager`)
 * - Phase 2.2: Analytical Depth-Heightfield & Sphere Ballpit Physics (`XRHeightfieldPhysics`)
 * - Phase 2.3: Zero-WASM 25-Joint Hand Gesture Classifier (`XRHandGestureClassifier`)
 * - Phase 3.2: Mobile Web iOS Safari QuickLook & Android Scene Viewer Bridges (`launchBestMobileOrHeadsetAR`)
 * - Phase 4.1–4.4: AR<->VR Transitions, Stereo SBS/OU Media, HRTF Spatial Audio & Earcons, `captureViewFrame()`, and WebMCP
 */

import {
  registerPlugin,
  type ThreeLivePlugin,
  XR_LIVE_AR_SURFACE_Y,
} from '../../three-live/src/plugin';
import {webxrPlugin} from '../../three-live/src/plugins/webxr';
import {ThreeLiveElement} from '../../three-live/src/three-live-element';
import {
  WebXRSessionManager,
  type ARLaunchResult,
} from '../../three-live/src/three-xr';
import type {XRCapturedFrame, XRTransitionOptions} from './xr-extras';
import {XRInputManager} from './xr-input';
import {
  launchBestMobileOrHeadsetAR,
  type MobileARLaunchReport,
} from './xr-mobile-bridge';
import type {XRCameraCollisionContext} from './xr-physics';
import {
  getXRExtras,
  registerXRExtras,
  type XRExtrasProvider,
} from './xr-registry';
import {XRSpatialSlotManager} from './xr-spatial-slot';
import {XRTraitSystem, type XRPose6DoF} from './xr-traits';

registerPlugin(webxrPlugin);

export type {XRExtrasProvider};

/** Target WebXR session mode supported by `<xr-live>`. */
export type XRMode = 'ar' | 'vr' | 'inline' | 'auto';
/** Hardware depth buffer occlusion or mesh physics mode. */
export type XRDepthMode = 'occlusion' | 'occlusion-physics' | 'mesh' | 'none';
/** 25-joint hand tracking and gesture recognition mode. */
export type XRHandsMode = 'gestures' | 'joints' | 'pinch' | 'none';
/** Desktop room simulator environment preset. */
export type XRSimulatorRoom = 'living-room' | 'office' | 'tabletop' | 'none';
/** Target spatial hardware profile for UI theme scaling. */
export type XRProfile = 'quest3' | 'android-xr' | 'visionos' | 'auto';

/**
 * `<xr-live>` Custom Element — extends ThreeLiveElement with full Spatial Computing capabilities.
 */
export class XRLiveElement extends ThreeLiveElement {
  public static registerExtras(provider: XRExtrasProvider): void {
    registerXRExtras(provider);
  }

  public readonly traitSystem = new XRTraitSystem();
  public readonly slotManager = new XRSpatialSlotManager();
  public readonly simulator: any;
  public readonly depthManager: any;
  public readonly physics: any;
  public readonly gestureClassifier: any;
  public readonly transitionController: any;
  public readonly audioController: any;
  public readonly inputManager: XRInputManager;

  constructor() {
    super();
    const ext = getXRExtras();
    this.simulator = ext.createSimulator();
    this.depthManager = ext.createDepthManager();
    this.physics = ext.createPhysics();
    this.gestureClassifier = ext.createGestureClassifier();
    this.transitionController = ext.createTransitionController();
    this.audioController = ext.createAudioController();
    this.inputManager = new XRInputManager(
      this,
      this.traitSystem,
      (hit, type) => {
        this.slotManager.handleHit(hit, type);
        if (this.soundFeedback) {
          this.audioController.playEarcon('grab', hit.point);
        }
      },
    );
  }

  static override get observedAttributes(): string[] {
    return [
      ...ThreeLiveElement.observedAttributes,
      'xr-mode',
      'xr-depth',
      'xr-hands',
      'xr-simulator',
      'xr-profile',
      'sound-feedback',
      'spatial-measure',
      'measure-unit',
      'magnetic-snap',
      'snap-grid',
      'snap-angle',
    ];
  }

  get xrMode(): XRMode {
    return (this.getAttribute('xr-mode') as XRMode) || 'auto';
  }

  set xrMode(value: XRMode) {
    this.setAttribute('xr-mode', value);
  }

  get xrDepth(): XRDepthMode {
    return (this.getAttribute('xr-depth') as XRDepthMode) || 'none';
  }

  set xrDepth(value: XRDepthMode) {
    this.setAttribute('xr-depth', value);
  }

  get xrHands(): XRHandsMode {
    return (this.getAttribute('xr-hands') as XRHandsMode) || 'none';
  }

  set xrHands(value: XRHandsMode) {
    this.setAttribute('xr-hands', value);
  }

  get xrSimulator(): XRSimulatorRoom {
    return (this.getAttribute('xr-simulator') as XRSimulatorRoom) || 'none';
  }

  set xrSimulator(value: XRSimulatorRoom) {
    this.setAttribute('xr-simulator', value);
    if (value !== 'none') {
      this.simulator.active = true;
      this.simulator.configureRoom(value);
    } else {
      this.simulator.active = false;
    }
  }

  get xrProfile(): XRProfile {
    return (this.getAttribute('xr-profile') as XRProfile) || 'auto';
  }

  set xrProfile(value: XRProfile) {
    this.setAttribute('xr-profile', value);
  }

  get soundFeedback(): boolean {
    return (
      this.hasAttribute('sound-feedback') &&
      this.getAttribute('sound-feedback') !== 'false'
    );
  }

  set soundFeedback(value: boolean) {
    if (value) {
      this.setAttribute('sound-feedback', '');
    } else {
      this.removeAttribute('sound-feedback');
    }
  }

  /**
   * Opt-in gate required before `capture_xr_view` exposes the 8x8 metric depth
   * grid (`depthGridMeters`) to WebMCP agents (P1-3 / WEB-14). Defaults to false.
   */
  get webmcpAllowDepth(): boolean {
    return (
      this.hasAttribute('webmcp-allow-depth') &&
      this.getAttribute('webmcp-allow-depth') !== 'false'
    );
  }

  set webmcpAllowDepth(value: boolean) {
    if (value) {
      this.setAttribute('webmcp-allow-depth', '');
    } else {
      this.removeAttribute('webmcp-allow-depth');
    }
  }

  /**
   * When set, `inspect_xr_scene` omits `headPosition` entirely rather than
   * returning the default 0.1m-quantized coarse position (P1-3 / WEB-14).
   */
  get webmcpOmitPose(): boolean {
    return (
      this.hasAttribute('webmcp-omit-pose') &&
      this.getAttribute('webmcp-omit-pose') !== 'false'
    );
  }

  set webmcpOmitPose(value: boolean) {
    if (value) {
      this.setAttribute('webmcp-omit-pose', '');
    } else {
      this.removeAttribute('webmcp-omit-pose');
    }
  }

  private _getViewer(customViewer?: any): any {
    return customViewer || (this as any)._view || (this as any).viewer || null;
  }

  override connectedCallback(): void {
    if (!this.hasAttribute('ar')) {
      this.setAttribute('ar', 'true');
    }
    if (this.xrSimulator !== 'none') {
      this.simulator.active = true;
      this.simulator.configureRoom(this.xrSimulator);
    }
    super.connectedCallback();
    if (this.hasAttribute('webmcp')) {
      getXRExtras().registerXRLiveWebMCPTools(
        this,
        () => this._getViewer(),
        () => this.simulator.getHeadPose(),
        this.depthManager,
      );
    }
  }

  override disconnectedCallback(): void {
    const viewer = this._getViewer();
    this.slotManager.dispose(viewer?.gl);
    this.depthManager.dispose(viewer?.gl);
    super.disconnectedCallback?.();
  }

  /**
   * Steps all `<xr-live>` spatial subsystems (`slots`, `simulator`, `traits`, `physics`, `transitions`, `audio`)
   * for `dt` seconds. Automatically invoked during WebXR frames and desktop simulator loops.
   */
  public stepSpatialFrame(
    dt = 1 / 60,
    customViewer?: any,
    xrCameraContext?: XRCameraCollisionContext & {
      headPositionLocal?: [number, number, number];
    },
  ): void {
    if (!(dt > 0)) return;
    const viewer = this._getViewer(customViewer);
    if (!viewer) return;

    // 1. Sync HTML `<div slot="spatial">` cards into 3D scene quads
    this.slotManager.syncSlots(this, viewer);

    // 2. Determine active head and hand poses
    const baseHeadPose: XRPose6DoF = this.simulator.active
      ? this.simulator.stepLocomotion(dt)
      : this.simulator.getHeadPose();
    const headPose: XRPose6DoF = xrCameraContext?.headPositionLocal
      ? {
          ...baseHeadPose,
          position: xrCameraContext.headPositionLocal,
        }
      : baseHeadPose;

    const handPoses = {
      ...this.inputManager.getHandPoses(),
      ...(this.simulator.active
        ? {
            left: this.simulator.getVirtualHandPose('left'),
            right: this.simulator.getVirtualHandPose('right'),
          }
        : {}),
    };

    const isARSession = Boolean(
      viewer.xrSessionActive && xrCameraContext?.isAR !== false,
    );
    const activeFloorY = isARSession
      ? XR_LIVE_AR_SURFACE_Y
      : this.simulator.room.floorY;
    const activeTableY = isARSession
      ? XR_LIVE_AR_SURFACE_Y
      : this.simulator.room.tableY;

    // 3. Step declarative manipulation, capsule billboarding, follow springs, and plane anchors
    this.traitSystem.update(
      viewer.meshes || [],
      headPose,
      handPoses,
      dt,
      activeFloorY,
      activeTableY,
    );

    // 4. Step analytical heightfield & sphere-to-sphere physics
    this.physics.step(
      viewer.meshes || [],
      dt,
      this.xrDepth !== 'none' ? this.depthManager : undefined,
      activeFloorY,
      activeTableY,
      (mesh, _speed) => {
        if (this.soundFeedback) {
          this.audioController.playEarcon('bounce');
        }
      },
      xrCameraContext,
    );

    // 5. Step AR <-> VR passthrough transition fade & spatial audio
    this.transitionController.step(viewer, dt);
    this.audioController.syncSpatialNodes(viewer.meshes || [], headPose);
  }

  /**
   * Phase 4.1: Smoothly transitions the active XR viewport to VR (opaque background sphere).
   */
  public transitionToVR(
    options?: XRTransitionOptions,
    customViewer?: any,
  ): void {
    this.transitionController.transitionToVR(
      this._getViewer(customViewer),
      options,
    );
  }

  /**
   * Phase 4.1: Smoothly transitions the active XR viewport back to transparent AR passthrough.
   */
  public transitionToAR(
    options?: XRTransitionOptions,
    customViewer?: any,
  ): void {
    this.transitionController.transitionToAR(
      this._getViewer(customViewer),
      options,
    );
  }

  /**
   * Phase 4.4: Captures the current XR viewport image, camera matrices, and optional 8x8 depth grid
   * for multimodal Gemini Live / AI Q&A.
   */
  public async captureViewFrame(
    options?: {
      format?: 'image/jpeg' | 'image/png' | 'image/webp';
      quality?: number;
      includeDepth?: boolean;
    },
    customViewer?: any,
  ): Promise<XRCapturedFrame> {
    return getXRExtras().captureXRViewFrame(
      this._getViewer(customViewer),
      this.simulator.getHeadPose(),
      this.depthManager,
      options,
    );
  }

  /**
   * Overrides `<three-live>`'s default `activateAR()` so clicking the built-in AR button
   * launches the full `<xr-live>` spatial session (hiding virtual floor/pedestal surfaces,
   * configuring hardware depth & hand tracking, and managing WebXR lifecycle).
   */
  public override async activateAR(): Promise<ARLaunchResult> {
    try {
      const report = await this.enterSpatialAR();
      const mode =
        report.platform === 'ios-quicklook'
          ? 'quick-look'
          : report.platform === 'android-scene-viewer'
            ? 'scene-viewer'
            : 'webxr';
      return {
        mode,
        success: report.platform !== 'simulator',
        session: this.activeXRSession || undefined,
      };
    } catch (err: any) {
      return {
        mode: 'webxr',
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  /**
   * Phase 3.2: Launches the best AR experience across Headset/Android WebXR, iPhone Safari (`<15ms` USDZ QuickLook),
   * Android Scene Viewer (`intent://` when hosted GLB URL is available), or Desktop Simulator.
   */
  public async enterSpatialAR(
    sourceOverride?: any,
    forceFallback?: 'ios-quicklook' | 'android-scene-viewer',
  ): Promise<MobileARLaunchReport> {
    if (
      this.activeXRSession &&
      typeof this.activeXRSession.isSessionActive === 'function' &&
      this.activeXRSession.isSessionActive()
    ) {
      await this.activeXRSession.stop().catch(() => {});
      this.activeXRSession = null;
    }

    const source =
      sourceOverride ||
      (this as any)._scene ||
      (this as any)._glbData ||
      this.currentModel;

    if (!source) {
      const err = new Error('No 3D scene is loaded in <xr-live>.');
      this.showToast(err.message, 6000);
      throw err;
    }

    const report = await launchBestMobileOrHeadsetAR(source, {
      forceFallback,
      glbUrl:
        typeof this.currentModel === 'string' ? this.currentModel : undefined,
    });

    if (report.platform === 'webxr' && this.viewer) {
      const savedVisibility = new Map<any, boolean>();
      const hideNames = new Set([
        'Room_Floor',
        'Pedestal_Table',
        'Workbench_Pedestal',
      ]);
      for (const m of this.viewer.meshes || []) {
        if (m && hideNames.has(m.name)) {
          savedVisibility.set(m, m.visible !== false);
          (m as any).visible = false;
        }
      }
      const restoreVisibility = () => {
        for (const [m, vis] of savedVisibility.entries()) {
          m.visible = vis;
        }
        savedVisibility.clear();
      };

      const sessionManager = new WebXRSessionManager({
        arScale: this.arScale,
        arPlacement: this.arPlacement,
        onExit: () => {
          restoreVisibility();
          this.activeXRSession = null;
          this.dispatchEvent(
            new CustomEvent('ar-status', {
              bubbles: true,
              composed: true,
              detail: {status: 'not-presenting'},
            }),
          );
        },
        onError: (err) => {
          restoreVisibility();
          this.activeXRSession = null;
          this.dispatchEvent(
            new CustomEvent('ar-status', {
              bubbles: true,
              composed: true,
              detail: {status: 'failed', error: err},
            }),
          );
          this.showToast(`AR error: ${err.message}`, 6000);
        },
      });
      this.activeXRSession = sessionManager;
      await sessionManager.start(this.viewer, this);
    }
    return report;
  }
}

function resolveXRLiveHost(viewer: any): XRLiveElement | undefined {
  return viewer?.container instanceof XRLiveElement
    ? viewer.container
    : undefined;
}

const lastXRFrameTimes = new WeakMap<object, number>();

/**
 * Registers the `xr-live-spatial-engine` plugin with `ThreeLive` so active WebXR sessions
 * automatically invoke `XRDepthManager`, `XRInputManager`, `XRHandGestureClassifier`, and `stepSpatialFrame`.
 */
export const xrLiveSpatialPlugin: ThreeLivePlugin = {
  name: 'xr-live-spatial-engine',

  onConfigureXRSessionInit(element: any, sessionInit: any): void {
    if (!element || !(element instanceof XRLiveElement)) return;
    element.depthManager.configureSessionInit(sessionInit, element.xrDepth);
    if (element.xrHands !== 'none') {
      const optional = new Set<string>(sessionInit.optionalFeatures || []);
      optional.add('hand-tracking');
      sessionInit.optionalFeatures = Array.from(optional);
    }
  },

  onXRFrame(viewer: any, session: any, frame: any, refSpace: any): void {
    const host = resolveXRLiveHost(viewer);
    if (!host) return;

    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prev = lastXRFrameTimes.get(viewer) || 0;
    lastXRFrameTimes.set(viewer, now);
    const dt =
      prev > 0 ? Math.min(Math.max((now - prev) / 1000, 1 / 120), 0.05) : 1 / 72;

    const viewerPose = frame?.getViewerPose?.(refSpace);
    const firstView = viewerPose?.views?.[0];
    if (firstView) {
      host.depthManager.updateFromXRFrame(
        viewer,
        frame,
        firstView,
        host.xrDepth !== 'none',
      );
    }
    viewer.onBeforeRenderXRView = (xrView: any) => {
      host.depthManager.updateFromXRFrame(
        viewer,
        frame,
        xrView,
        host.xrDepth !== 'none',
      );
    };
    host.inputManager.processXRFrame(viewer, session, frame, refSpace);
    if (host.xrHands !== 'none') {
      host.gestureClassifier.processXRFrame(host, session, frame, refSpace);
    }

    let headPositionLocal: [number, number, number] | undefined;
    const camPos = firstView?.transform?.position;
    const rm = viewer?.modelRootMatrix as Float32Array | undefined;
    if (camPos && rm && rm.length === 16) {
      const s2 = rm[0] * rm[0] + rm[1] * rm[1] + rm[2] * rm[2];
      if (s2 > 1e-6) {
        const dx = camPos.x - rm[12];
        const dy = camPos.y - rm[13];
        const dz = camPos.z - rm[14];
        headPositionLocal = [
          (rm[0] * dx + rm[1] * dy + rm[2] * dz) / s2,
          (rm[4] * dx + rm[5] * dy + rm[6] * dz) / s2,
          (rm[8] * dx + rm[9] * dy + rm[10] * dz) / s2,
        ];
      }
    }

    host.stepSpatialFrame(dt, viewer, {
      modelRootMatrix: rm || null,
      viewMatrix: firstView?.transform?.inverse?.matrix || null,
      projMatrix: firstView?.projectionMatrix || null,
      isAR: session?.environmentBlendMode !== 'opaque',
      headPositionLocal,
    });
  },

  onUpdate(viewer: any, dt: number): void {
    if (viewer?.xrSessionActive) return;
    const host = resolveXRLiveHost(viewer);
    if (host) {
      host.stepSpatialFrame(dt, viewer);
    }
  },

  onXRSessionEnd(viewer: any): void {
    if (viewer && typeof viewer === 'object') {
      lastXRFrameTimes.delete(viewer);
      viewer.onBeforeRenderXRView = undefined;
      if (viewer.xrDepthState) {
        viewer.xrDepthState.enabled = false;
      }
    }
    const host = resolveXRLiveHost(viewer);
    host?.depthManager?.clearSessionDepth?.(viewer);
  },
};

registerPlugin(xrLiveSpatialPlugin);

const BaseHTMLElement: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

/**
 * `<xr-anchor>` Child Element for declarative spatial placement (table, floor, wall, ceiling, hand).
 */
export class XRAnchorElement extends BaseHTMLElement {
  static get observedAttributes(): string[] {
    return ['surface', 'magnetic', 'offset'];
  }

  get surface(): string {
    return this.getAttribute('surface') || 'floor';
  }

  set surface(val: string) {
    this.setAttribute('surface', val);
  }

  get magnetic(): boolean {
    return (
      this.hasAttribute('magnetic') && this.getAttribute('magnetic') !== 'false'
    );
  }

  set magnetic(val: boolean) {
    if (val) {
      this.setAttribute('magnetic', '');
    } else {
      this.removeAttribute('magnetic');
    }
  }
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('xr-live')) {
    customElements.define('xr-live', XRLiveElement);
  }
  if (!customElements.get('xr-anchor')) {
    customElements.define('xr-anchor', XRAnchorElement);
  }
}
