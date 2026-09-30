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
 * @fileoverview Phase 4: Closing High-Value XR Blocks Gaps.
 * - Phase 4.1: Smooth AR <-> VR Passthrough Transitions (`transitionToVR` / `transitionToAR`)
 * - Phase 4.3: Zero-Dependency HRTF Spatial Audio & Procedural Earcons (`XRSpatialAudioController`)
 * - Phase 4.4: Multimodal AI / Gemini Live Frame Capture (`captureViewFrame`) & WebMCP Spatial Tools
 */

import {mat4FromRotationTranslationScale} from '../../three-live/src/math';
import type {XRDepthManager} from './xr-depth';
import {
  extractPosition,
  extractQuaternion,
  extractScale,
  getMeshXRTraits,
  type XRPose6DoF,
} from './xr-traits';

export interface XRTransitionOptions {
  color?: [number, number, number];
  durationMs?: number;
}

export class XRModeTransitionController {
  private currentAlpha = 0.0;
  private startAlpha = 0.0;
  private targetAlpha = 0.0;
  private targetColor: [number, number, number] = [0.05, 0.06, 0.1];
  private elapsedMs = 0;
  private durationMs = 500;
  private transitioning = false;

  public transitionToVR(viewer: any, options: XRTransitionOptions = {}): void {
    this.startAlpha = this.currentAlpha;
    this.targetAlpha = 1.0;
    if (options.color) this.targetColor = options.color;
    this.durationMs = Math.max(1, options.durationMs ?? 500);
    this.elapsedMs = 0;
    this.transitioning = true;
    if (this.durationMs <= 1 && viewer) {
      this.currentAlpha = 1.0;
      this.transitioning = false;
      viewer.clearColor = [
        this.targetColor[0],
        this.targetColor[1],
        this.targetColor[2],
        1.0,
      ];
    }
  }

  public transitionToAR(viewer: any, options: XRTransitionOptions = {}): void {
    this.startAlpha = this.currentAlpha;
    this.targetAlpha = 0.0;
    this.durationMs = Math.max(1, options.durationMs ?? 500);
    this.elapsedMs = 0;
    this.transitioning = true;
    if (this.durationMs <= 1 && viewer) {
      this.currentAlpha = 0.0;
      this.transitioning = false;
      viewer.clearColor = [
        this.targetColor[0],
        this.targetColor[1],
        this.targetColor[2],
        0.0,
      ];
    }
  }

  public step(viewer: any, dtSeconds: number): number {
    if (!this.transitioning) return this.currentAlpha;
    this.elapsedMs += dtSeconds * 1000;
    const t = Math.min(1, this.elapsedMs / Math.max(1, this.durationMs));
    // Smoothstep ease-in-out
    const smoothT = t * t * (3 - 2 * t);
    this.currentAlpha =
      this.startAlpha + (this.targetAlpha - this.startAlpha) * smoothT;
    if (viewer) {
      viewer.clearColor = [
        this.targetColor[0],
        this.targetColor[1],
        this.targetColor[2],
        this.currentAlpha,
      ];
    }
    if (t >= 1) {
      this.transitioning = false;
    }
    return this.currentAlpha;
  }

  public getAlpha(): number {
    return this.currentAlpha;
  }
}

export class XRSpatialAudioController {
  private ctx: any = null;
  private panners = new WeakMap<object, any>();
  public enabled = true;

  private hasUserActivation(): boolean {
    if (typeof navigator === 'undefined') return true;
    const ua = (navigator as any).userActivation;
    return ua ? Boolean(ua.hasBeenActive) : true;
  }

  private ensureContext(): any {
    if (!this.hasUserActivation()) return null;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume?.().catch(() => {});
      }
      return this.ctx;
    }
    if (typeof window !== 'undefined') {
      const AudioCtx =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (typeof AudioCtx === 'function') {
        try {
          this.ctx = new AudioCtx();
        } catch (_) {}
      }
    }
    return this.ctx;
  }

  /**
   * Plays a procedural zero-asset Web Audio earcon for spatial interactions (`grab`, `release`, `bounce`, `hover`)
   * plus optional mobile haptic feedback (`navigator.vibrate`).
   */
  public playEarcon(
    type: 'grab' | 'release' | 'bounce' | 'hover',
    position?: [number, number, number],
  ): void {
    if (!this.enabled || !this.hasUserActivation()) return;

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      try {
        navigator.vibrate(type === 'bounce' ? 15 : 8);
      } catch (_) {}
    }

    const ctx = this.ensureContext();
    if (!ctx || typeof ctx.createOscillator !== 'function') return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime || 0;

      if (type === 'grab') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(780, now + 0.065);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      } else if (type === 'release') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(680, now);
        osc.frequency.exponentialRampToValueAtTime(440, now + 0.065);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      } else if (type === 'bounce') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(240, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
      } else {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
      }

      if (position && typeof ctx.createPanner === 'function') {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.positionX?.setValueAtTime(position[0], now);
        panner.positionY?.setValueAtTime(position[1], now);
        panner.positionZ?.setValueAtTime(position[2], now);
        osc.connect(gain);
        gain.connect(panner);
        panner.connect(ctx.destination);
      } else {
        osc.connect(gain);
        gain.connect(ctx.destination);
      }

      osc.start(now);
      osc.stop(now + 0.09);
    } catch (_) {}
  }

  /**
   * Syncs the Web Audio `AudioListener` with the active head pose and updates HRTF `PannerNode`s
   * for any mesh with `userData.xr.audio`.
   */
  public syncSpatialNodes(meshes: any[], headPose: XRPose6DoF): void {
    if (!this.enabled) return;
    const ctx = this.ctx;
    if (!ctx?.listener) return;
    const now = ctx.currentTime || 0;
    const [hx, hy, hz] = headPose.position;
    ctx.listener.positionX?.setValueAtTime(hx, now);
    ctx.listener.positionY?.setValueAtTime(hy, now);
    ctx.listener.positionZ?.setValueAtTime(hz, now);

    for (const mesh of meshes) {
      const traits = getMeshXRTraits(mesh);
      if (!traits?.audio) continue;
      let panner = this.panners.get(mesh);
      if (!panner && typeof ctx.createPanner === 'function') {
        panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance =
          typeof traits.audio === 'object'
            ? (traits.audio.refDistance ?? 1.0)
            : 1.0;
        panner.connect(ctx.destination);
        this.panners.set(mesh, panner);
      }
      if (panner) {
        const [mx, my, mz] = extractPosition(mesh.transform);
        panner.positionX?.setValueAtTime(mx, now);
        panner.positionY?.setValueAtTime(my, now);
        panner.positionZ?.setValueAtTime(mz, now);
      }
    }
  }
}

export interface XRCapturedFrame {
  dataUrl: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  viewMatrix: number[];
  projectionMatrix: number[];
  headPosition: [number, number, number];
  depthGridMeters?: number[];
}

/**
 * Phase 4.4: Captures a snapshot of the current XR view (plus camera intrinsics, pose, and optional
 * sub-sampled depth grid) for multimodal Gemini Live / AI Studio visual Q&A.
 */
export async function captureXRViewFrame(
  viewer: any,
  headPose: XRPose6DoF,
  depthManager?: XRDepthManager,
  options?: {
    format?: 'image/jpeg' | 'image/png' | 'image/webp';
    quality?: number;
    includeDepth?: boolean;
  },
): Promise<XRCapturedFrame> {
  const format = options?.format || 'image/jpeg';
  const quality = options?.quality ?? 0.85;
  const canvas = viewer?.canvas as HTMLCanvasElement | undefined;
  const width = canvas?.width || 640;
  const height = canvas?.height || 480;

  let dataUrl = 'data:image/jpeg;base64,';
  if (canvas && typeof canvas.toDataURL === 'function') {
    try {
      viewer.render?.();
      dataUrl = canvas.toDataURL(format, quality);
    } catch (_) {}
  }

  const commaIdx = dataUrl.indexOf(',');
  const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : '';

  let depthGridMeters: number[] | undefined;
  if (options?.includeDepth && depthManager) {
    depthGridMeters = [];
    const gridN = 8;
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const u = (gx + 0.5) / gridN;
        const v = (gy + 0.5) / gridN;
        const sample = depthManager.sampleDepthAndNormal(u, v);
        depthGridMeters.push(
          sample ? Number(sample.depthMeters.toFixed(3)) : 0,
        );
      }
    }
  }

  return {
    dataUrl,
    base64,
    mimeType: format,
    width,
    height,
    viewMatrix: Array.from(viewer?.viewMatrix || []),
    projectionMatrix: Array.from(viewer?.projMatrix || []),
    headPosition: headPose.position,
    depthGridMeters,
  };
}

/**
 * Quantizes a 3D head-pose coordinate vector to 0.1m (10 cm) resolution so
 * WebMCP spatial tools can place objects near the viewer without leaking
 * sub-millimeter biometric height/tremor telemetry (P1-3 / WEB-14).
 */
export function quantizeHeadPosition(
  pos: [number, number, number],
): [number, number, number] {
  const q = (v: number): number =>
    Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
  return [q(pos[0]), q(pos[1]), q(pos[2])];
}

function isWebMCPDepthAllowed(element: unknown): boolean {
  if (!element || typeof element !== 'object') return false;
  const el = element as {
    webmcpAllowDepth?: boolean;
    hasAttribute?: (name: string) => boolean;
    getAttribute?: (name: string) => string | null;
  };
  if (el.webmcpAllowDepth === true) return true;
  if (typeof el.hasAttribute === 'function') {
    return (
      el.hasAttribute('webmcp-allow-depth') &&
      el.getAttribute?.('webmcp-allow-depth') !== 'false'
    );
  }
  return false;
}

function isWebMCPPoseOmitted(element: unknown): boolean {
  if (!element || typeof element !== 'object') return false;
  const el = element as {
    webmcpOmitPose?: boolean;
    hasAttribute?: (name: string) => boolean;
    getAttribute?: (name: string) => string | null;
  };
  if (el.webmcpOmitPose === true) return true;
  if (typeof el.hasAttribute === 'function') {
    return (
      el.hasAttribute('webmcp-omit-pose') &&
      el.getAttribute?.('webmcp-omit-pose') !== 'false'
    );
  }
  return false;
}

function markWebMCPCaptureActive(element: unknown): void {
  if (!element || typeof element !== 'object') return;
  const el = element as {
    setAttribute?: (name: string, val: string) => void;
    dispatchEvent?: (evt: Event) => boolean;
  };
  try {
    el.setAttribute?.('data-xr-webmcp-indicator', 'active');
    if (
      typeof CustomEvent === 'function' &&
      typeof el.dispatchEvent === 'function'
    ) {
      el.dispatchEvent(new CustomEvent('xr-webmcp-capture'));
    }
  } catch {
    // Ignore indicator errors in headless test environments.
  }
}

/**
 * Phase 4.4: Registers spatial WebMCP (`navigator.modelContext`) tools on `<xr-live>`
 * so browser AI agents and Gemini Live can inspect and place objects in 3D space.
 */
export function registerXRLiveWebMCPTools(
  element: any,
  getViewer: () => any,
  getHeadPose: () => XRPose6DoF,
  depthManager?: XRDepthManager,
  customNavigator?: any,
): void {
  const nav =
    customNavigator ||
    (typeof navigator !== 'undefined' ? navigator : undefined);
  if (!nav) return;
  const mc = (nav as any).modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return;

  try {
    mc.registerTool({
      name: 'inspect_xr_scene',
      description:
        'Returns all 3D objects in the active <xr-live> spatial scene along with their world positions and XR manipulation traits.',
      inputSchema: {type: 'object', properties: {}},
      execute: async () => {
        const viewer = getViewer();
        const meshes = (viewer?.meshes || []).map((m: any) => ({
          name: m.name,
          position: extractPosition(m.transform),
          scale: extractScale(m.transform),
          xrTraits: getMeshXRTraits(m) || {},
        }));
        const headPosition = isWebMCPPoseOmitted(element)
          ? undefined
          : quantizeHeadPosition(getHeadPose().position);
        return {
          headPosition,
          objectCount: meshes.length,
          objects: meshes,
        };
      },
    });

    mc.registerTool({
      name: 'place_xr_object_at_gaze',
      description:
        'Moves a named 3D object in <xr-live> in front of the user at the specified distance in meters.',
      inputSchema: {
        type: 'object',
        properties: {
          name: {type: 'string'},
          distanceMeters: {type: 'number'},
        },
        required: ['name'],
      },
      execute: async (args: {name: string; distanceMeters?: number}) => {
        const viewer = getViewer();
        const mesh = (viewer?.meshes || []).find(
          (m: any) => m.name === args.name,
        );
        if (!mesh)
          return {success: false, error: `Object ${args.name} not found`};
        const dist = args.distanceMeters ?? 0.8;
        const hp = quantizeHeadPosition(getHeadPose().position);
        const targetPos: [number, number, number] = [
          hp[0],
          hp[1] - 0.1,
          hp[2] - dist,
        ];
        mat4FromRotationTranslationScale(
          mesh.transform,
          extractQuaternion(mesh.transform),
          targetPos,
          extractScale(mesh.transform),
        );
        return {success: true, newPosition: targetPos};
      },
    });

    mc.registerTool({
      name: 'capture_xr_view',
      description:
        'Captures the user current XR viewport frame and optional depth map (when webmcp-allow-depth is enabled on <xr-live>) for visual Q&A.',
      inputSchema: {
        type: 'object',
        properties: {includeDepth: {type: 'boolean'}},
      },
      execute: async (args: {includeDepth?: boolean}) => {
        markWebMCPCaptureActive(element);
        const allowDepth =
          Boolean(args?.includeDepth) && isWebMCPDepthAllowed(element);
        const pose = getHeadPose();
        const quantizedPose: XRPose6DoF = {
          ...pose,
          position: quantizeHeadPosition(pose.position),
        };
        return captureXRViewFrame(getViewer(), quantizedPose, depthManager, {
          includeDepth: allowDepth,
        });
      },
    });
  } catch (err: unknown) {
    console.warn(
      '[XR-Live WebMCP] Failed to register navigator.modelContext tool:',
      err,
    );
  }
}
