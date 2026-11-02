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
  private lastUploadFrame: unknown = null;
  private lastUploadEye = '';

  /**
   * Configures WebXR `XRSessionInit` with `depth-sensing` preferences when `xr-depth` is active.
   */
  public configureSessionInit(sessionInit: any, depthMode: string): void {
    if (depthMode === 'none') return;
    const optional = new Set<string>(sessionInit.optionalFeatures || []);
    optional.add('depth-sensing');
    sessionInit.optionalFeatures = Array.from(optional);
    sessionInit.depthSensing = {
      usagePreference: ['cpu-optimized'],
      dataFormatPreference: ['luminance-alpha', 'float32'],
    };
  }

  /**
   * Clears transient WebXR session depth buffers when an immersive session ends
   * so inline post-AR frames never read invalidated `XRCPUDepthInformation`.
   */
  public clearSessionDepth(viewer?: any): void {
    this.latestDepthInfo = null;
    this.lastUploadFrame = null;
    this.lastUploadEye = '';
    if (viewer?.xrDepthState) {
      viewer.xrDepthState.enabled = false;
    }
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
    const session = frame?.session || (xrView as any)?.session;
    if (
      !enabled ||
      !frame ||
      typeof frame.getDepthInformation !== 'function' ||
      (session?.depthUsage && session.depthUsage !== 'cpu-optimized')
    ) {
      this.clearSessionDepth(viewer);
      return null;
    }

    let depthInfo: XRCPUDepthInfo | null = null;
    try {
      depthInfo = frame.getDepthInformation(xrView);
    } catch {
      this.clearSessionDepth(viewer);
      return null;
    }
    if (!depthInfo) {
      this.clearSessionDepth(viewer);
      return null;
    }

    // `onXRFrame` (physics) and `onBeforeRenderXRView` (occlusion) both request
    // depth for the same view every frame; reuse the texture already uploaded
    // for this frame/eye instead of re-uploading identical bytes.
    const eye = String(xrView?.eye ?? 'none');
    if (
      frame === this.lastUploadFrame &&
      eye === this.lastUploadEye &&
      viewer.xrDepthState?.enabled &&
      viewer.xrDepthState.texture === this.depthTexture
    ) {
      this.latestDepthInfo = depthInfo;
      return depthInfo;
    }
    this.lastUploadFrame = frame;
    this.lastUploadEye = eye;

    this.latestDepthInfo = depthInfo;
    const gl = viewer.gl as WebGL2RenderingContext | undefined;
    const isFloat32 =
      depthInfo.data instanceof Float32Array ||
      session?.depthDataFormat === 'float32';

    let uploadedOk = false;
    if (
      gl &&
      depthInfo.data &&
      depthInfo.width > 0 &&
      depthInfo.height > 0 &&
      typeof gl.createTexture === 'function'
    ) {
      try {
        if (!this.depthTexture) {
          this.depthTexture = gl.createTexture();
        }
        if (this.depthTexture) {
          gl.bindTexture(gl.TEXTURE_2D, this.depthTexture);
          gl.pixelStorei?.(gl.UNPACK_ALIGNMENT ?? 0x0cf5, 1);
          if (isFloat32) {
            const floatData =
              depthInfo.data instanceof Float32Array
                ? depthInfo.data
                : new Float32Array(
                    depthInfo.data instanceof ArrayBuffer
                      ? depthInfo.data
                      : (depthInfo.data as ArrayBufferView).buffer,
                    depthInfo.data instanceof ArrayBuffer
                      ? 0
                      : (depthInfo.data as ArrayBufferView).byteOffset,
                    depthInfo.width * depthInfo.height,
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
          }
          // Packed 16-bit LUMINANCE_ALPHA and float depth must use NEAREST so
          // low/high bytes never linearly interpolate across 256-step wraps.
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          uploadedOk = true;
        }
      } catch {
        uploadedOk = false;
      }
    }

    if (viewer.xrDepthState) {
      viewer.xrDepthState.enabled = Boolean(this.depthTexture && uploadedOk);
      viewer.xrDepthState.texture = uploadedOk ? this.depthTexture : null;
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
    this.lastUploadFrame = null;
    this.lastUploadEye = '';
  }

  public setSyntheticDepthInfo(info: XRCPUDepthInfo | null): void {
    this.latestDepthInfo = info;
  }

  public getLatestDepthInfo(): XRCPUDepthInfo | null {
    return this.latestDepthInfo;
  }

  /**
   * Samples real-world depth in meters and computes the view-space surface
   * normal via finite differences at normalized view coordinates `(u, v)` in
   * `[0, 1]` (origin top-left, `v` pointing down).
   *
   * Pass the view's `projMatrix` to convert image-space depth gradients into
   * metric slopes; without it, gradients are treated as unit-scaled.
   */
  public sampleDepthAndNormal(
    u: number,
    v: number,
    projMatrix?: ArrayLike<number> | null,
  ): {depthMeters: number; normal: [number, number, number]} | null {
    const info = this.latestDepthInfo;
    if (!info) return null;

    const getD = (nu: number, nv: number): number => {
      const cu = Math.max(0, Math.min(1, nu));
      const cv = Math.max(0, Math.min(1, nv));
      if (typeof info.getDepthInMeters === 'function') {
        try {
          return info.getDepthInMeters(cu, cv);
        } catch {
          this.latestDepthInfo = null;
          return 0;
        }
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
        const raw = u16[idx] || 0;
        if (raw >= 65500) return 0;
        return raw * (info.rawValueToMeters ?? 0.001);
      }
      return 0;
    };

    const centerDepth = getD(u, v);
    if (!Number.isFinite(centerDepth) || centerDepth <= 0.05) return null;

    const eps = 0.02;
    const dRight = getD(u + eps, v) || centerDepth;
    const dDown = getD(u, v + eps) || centerDepth;
    const dzdu = (dRight - centerDepth) / eps;
    const dzdv = (dDown - centerDepth) / eps;

    // A view-space surface point is P = (x, y, -d(x, y)), so the camera-facing
    // normal is (∂d/∂x, ∂d/∂y, 1). Image `u` runs along view +X; image `v` runs
    // along view -Y. One normalized unit spans 2d / P[0] meters horizontally
    // and 2d / P[5] meters vertically at depth d.
    const p0 = projMatrix ? Math.abs(Number(projMatrix[0])) || 0 : 0;
    const p5 = projMatrix ? Math.abs(Number(projMatrix[5])) || 0 : 0;
    const sx = p0 > 0 ? p0 / (2 * centerDepth) : 1;
    const sy = p5 > 0 ? p5 / (2 * centerDepth) : 1;
    const nx = dzdu * sx;
    const ny = -dzdv * sy;
    const nz = 1.0;
    const len = Math.hypot(nx, ny, nz) || 1;
    return {
      depthMeters: centerDepth,
      normal: [nx / len, ny / len, nz / len],
    };
  }
}
