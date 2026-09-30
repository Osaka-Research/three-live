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
 * @fileoverview Phase 2.1: WebXR Hardware Depth Occlusion & CPU Heightfield Provider.
 * Requests `depth-sensing`, uploads the hardware depth buffer to `ThreeView.xrDepthState`
 * (`uXrDepthTex`), and exposes `getDepthAndNormalAtUV(u, v)` for heightfield physics.
 */

import {mat4Create} from '../../three-live/src/math';

export interface XRCPUDepthInfo {
  width: number;
  height: number;
  rawValueToMeters: number;
  normDepthBufferFromNormView?: {matrix?: Float32Array};
  data?: ArrayBuffer | Uint16Array | Float32Array;
  getDepthInMeters?: (u: number, v: number) => number;
}

export class XRDepthManager {
  private depthTexture: WebGLTexture | null = null;
  private latestDepthInfo: XRCPUDepthInfo | null = null;

  /**
   * Configures WebXR `XRSessionInit` with `depth-sensing` preferences when `xr-depth` is active.
   */
  public configureSessionInit(sessionInit: any, depthMode: string): void {
    if (depthMode === 'none') return;
    const optional = new Set<string>(sessionInit.optionalFeatures || []);
    optional.add('depth-sensing');
    sessionInit.optionalFeatures = Array.from(optional);
    sessionInit.depthSensing = {
      usagePreference: ['cpu-optimized', 'gpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    };
  }

  /**
   * Updates `viewer.xrDepthState` from the active `XRFrame` and `XRView`.
   */
  public updateFromXRFrame(
    viewer: any,
    frame: any,
    xrView: any,
    enabled = true,
  ): XRCPUDepthInfo | null {
    if (!viewer) return null;
    if (!enabled || !frame || typeof frame.getDepthInformation !== 'function') {
      if (viewer.xrDepthState) {
        viewer.xrDepthState.enabled = false;
      }
      return null;
    }

    const depthInfo: XRCPUDepthInfo | null = frame.getDepthInformation(xrView);
    if (!depthInfo) {
      if (viewer.xrDepthState) {
        viewer.xrDepthState.enabled = false;
      }
      return null;
    }

    this.latestDepthInfo = depthInfo;
    const gl = viewer.gl as WebGL2RenderingContext | undefined;
    const isFloat32 =
      depthInfo.data instanceof Float32Array ||
      (xrView as any)?.session?.depthDataFormat === 'float32';

    if (gl && depthInfo.data && typeof gl.createTexture === 'function') {
      if (!this.depthTexture) {
        this.depthTexture = gl.createTexture();
      }
      if (this.depthTexture) {
        gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
        if (isFloat32) {
          const floatData =
            depthInfo.data instanceof Float32Array
              ? depthInfo.data
              : new Float32Array(
                  depthInfo.data instanceof ArrayBuffer
                    ? depthInfo.data
                    : (depthInfo.data as ArrayBufferView).buffer,
                );
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            (gl as any).R32F || gl.RED,
            depthInfo.width,
            depthInfo.height,
            0,
            gl.RED,
            gl.FLOAT,
            floatData,
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        } else {
          const rawBytes =
            depthInfo.data instanceof Uint8Array
              ? depthInfo.data
              : depthInfo.data instanceof ArrayBuffer
                ? new Uint8Array(depthInfo.data)
                : new Uint8Array(
                    (depthInfo.data as ArrayBufferView).buffer,
                    (depthInfo.data as ArrayBufferView).byteOffset,
                    (depthInfo.data as ArrayBufferView).byteLength,
                  );
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.LUMINANCE_ALPHA,
            depthInfo.width,
            depthInfo.height,
            0,
            gl.LUMINANCE_ALPHA,
            gl.UNSIGNED_BYTE,
            rawBytes,
          );
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }

    if (viewer.xrDepthState) {
      viewer.xrDepthState.enabled = true;
      viewer.xrDepthState.texture = this.depthTexture;
      viewer.xrDepthState.format = isFloat32 ? 1 : 0;
      viewer.xrDepthState.rawValueToMeters =
        depthInfo.rawValueToMeters ?? (isFloat32 ? 1.0 : 0.001);
      viewer.xrDepthState.uvTransform =
        depthInfo.normDepthBufferFromNormView?.matrix || mat4Create();
    }

    return depthInfo;
  }

  public dispose(gl?: WebGL2RenderingContext | null): void {
    if (gl && this.depthTexture && typeof gl.deleteTexture === 'function') {
      gl.deleteTexture(this.depthTexture);
    }
    this.depthTexture = null;
    this.latestDepthInfo = null;
  }

  public setSyntheticDepthInfo(info: XRCPUDepthInfo | null): void {
    this.latestDepthInfo = info;
  }

  public getLatestDepthInfo(): XRCPUDepthInfo | null {
    return this.latestDepthInfo;
  }

  /**
   * Samples real-world depth in meters and computes the surface normal via finite differences
   * at normalized view coordinates `(u, v)` in `[0, 1]`.
   */
  public sampleDepthAndNormal(
    u: number,
    v: number,
  ): {depthMeters: number; normal: [number, number, number]} | null {
    const info = this.latestDepthInfo;
    if (!info) return null;

    const getD = (nu: number, nv: number): number => {
      const cu = Math.max(0, Math.min(1, nu));
      const cv = Math.max(0, Math.min(1, nv));
      if (typeof info.getDepthInMeters === 'function') {
        return info.getDepthInMeters(cu, cv);
      }
      if (info.data) {
        const ix = Math.min(
          info.width - 1,
          Math.floor(cu * Math.max(1, info.width)),
        );
        const iy = Math.min(
          info.height - 1,
          Math.floor(cv * Math.max(1, info.height)),
        );
        const idx = iy * info.width + ix;
        if (info.data instanceof Float32Array) {
          return info.data[idx] * (info.rawValueToMeters ?? 1.0);
        }
        const u16 =
          info.data instanceof Uint16Array
            ? info.data
            : new Uint16Array(info.data as ArrayBuffer);
        return (u16[idx] || 0) * (info.rawValueToMeters ?? 0.001);
      }
      return 0;
    };

    const centerDepth = getD(u, v);
    if (!Number.isFinite(centerDepth) || centerDepth <= 0.05) return null;

    const eps = 0.02;
    const dRight = getD(u + eps, v) || centerDepth;
    const dUp = getD(u, v + eps) || centerDepth;
    const dzdx = (dRight - centerDepth) / eps;
    const dzdy = (dUp - centerDepth) / eps;

    // Surface normal pointing back toward camera (+Z) from depth finite differences
    const nx = -dzdx;
    const ny = -dzdy;
    const nz = 1.0;
    const len = Math.hypot(nx, ny, nz) || 1;
    return {
      depthMeters: centerDepth,
      normal: [nx / len, ny / len, nz / len],
    };
  }
}
