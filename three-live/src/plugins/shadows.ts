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
 * @fileoverview Per-Object Dynamic Contact & Drop Shadow Plugin for three-live.
 * Renders soft Gaussian-falloff contact shadows under 3D meshes via onAfterRender,
 * dynamically scaling penumbra softness and attenuating opacity with height above
 * the underlying support surface (tabletop, floor, or scene bounds).
 */

import {type ThreeLivePlugin, XR_LIVE_AR_SURFACE_Y} from '../plugin';
import type {ThreeView} from '../three-view';

const VS_SHADOW = `#version 300 es
layout(location=0) in vec3 aPosition;layout(location=1) in vec2 aUV;uniform mat4 uMVP;out vec2 vUV;void main(){vUV=aUV;gl_Position=uMVP*vec4(aPosition,1.);}`;

const FS_SHADOW = `#version 300 es
precision highp float;in vec2 vUV;uniform float uShadowIntensity,uShadowSoftness;out vec4 fragColor;void main(){vec2 p=(vUV-.5)*2.;float d=clamp(length(p),0.,1.);fragColor=vec4(0.,0.,0.,pow(1.-d*d,mix(1.2,2.8,uShadowSoftness))*smoothstep(1.,.85-uShadowSoftness*.6,d)*uShadowIntensity);}`;

interface ShadowGpuContext {
  prog: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  uMVP: WebGLUniformLocation | null;
  uIntensity: WebGLUniformLocation | null;
  uSoftness: WebGLUniformLocation | null;
}

const shadowContexts = new WeakMap<WebGL2RenderingContext, ShadowGpuContext>();
const _quadVerts = new Float32Array(20);

function xform(
  m: Float32Array,
  b: number[],
): [number, number, number, number, number, number] {
  const [cx, cy, cz, hx, hy, hz] = b;
  return [
    m[0] * cx + m[4] * cy + m[8] * cz + m[12],
    m[1] * cx + m[5] * cy + m[9] * cz + m[13],
    m[2] * cx + m[6] * cy + m[10] * cz + m[14],
    Math.abs(m[0]) * hx + Math.abs(m[4]) * hy + Math.abs(m[8]) * hz,
    Math.abs(m[1]) * hx + Math.abs(m[5]) * hy + Math.abs(m[9]) * hz,
    Math.abs(m[2]) * hx + Math.abs(m[6]) * hy + Math.abs(m[10]) * hz,
  ];
}

function getLocalBounds(mesh: any): number[] | null {
  if (mesh._lb !== undefined) return mesh._lb;
  let x0 = 1e9,
    y0 = 1e9,
    z0 = 1e9,
    x1 = -1e9,
    y1 = -1e9,
    z1 = -1e9;
  for (const p of mesh.primitives || []) {
    const pos = p.positions as Float32Array | undefined;
    if (pos) {
      for (let i = 0; i < pos.length; i += 3) {
        if (pos[i] < x0) x0 = pos[i];
        if (pos[i + 1] < y0) y0 = pos[i + 1];
        if (pos[i + 2] < z0) z0 = pos[i + 2];
        if (pos[i] > x1) x1 = pos[i];
        if (pos[i + 1] > y1) y1 = pos[i + 1];
        if (pos[i + 2] > z1) z1 = pos[i + 2];
      }
    }
  }
  return (mesh._lb =
    x0 <= x1
      ? [
          (x0 + x1) * 0.5,
          (y0 + y1) * 0.5,
          (z0 + z1) * 0.5,
          (x1 - x0) * 0.5,
          (y1 - y0) * 0.5,
          (z1 - z0) * 0.5,
        ]
      : null);
}

function getShadowContext(gl: WebGL2RenderingContext): ShadowGpuContext {
  let ctx = shadowContexts.get(gl);
  if (ctx) return ctx;

  const mkS = (t: number, s: string) => {
    const sh = gl.createShader(t)!;
    gl.shaderSource(sh, s);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, mkS(gl.VERTEX_SHADER, VS_SHADOW));
  gl.attachShader(prog, mkS(gl.FRAGMENT_SHADER, FS_SHADOW));
  gl.linkProgram(prog);

  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  const ibo = gl.createBuffer()!;

  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, 80, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    gl.STATIC_DRAW,
  );
  gl.bindVertexArray(null);

  ctx = {
    prog,
    vao,
    vbo,
    ibo,
    uMVP: gl.getUniformLocation(prog, 'uMVP'),
    uIntensity: gl.getUniformLocation(prog, 'uShadowIntensity'),
    uSoftness: gl.getUniformLocation(prog, 'uShadowSoftness'),
  };
  shadowContexts.set(gl, ctx);
  return ctx;
}

export const contactShadowPlugin: ThreeLivePlugin = {
  name: 'contact-shadow',

  onContextRestored(gl: WebGL2RenderingContext): void {
    shadowContexts.delete(gl);
  },

  onAfterRender(
    gl: WebGL2RenderingContext,
    viewer: ThreeView,
    vpMatrix: Float32Array,
  ): void {
    const intensity = viewer.shadowIntensity;
    if (intensity <= 0 || !viewer.bounds) return;

    const ctx = getShadowContext(gl);
    const hasBackdrop =
      !viewer.xrSessionActive && (viewer.backdropMeshes?.length ?? 0) > 0;
    const casters: number[][] = [];
    const supports: number[][] = [];

    for (const mesh of viewer.meshes || []) {
      if (
        !mesh ||
        (mesh as any).visible === false ||
        (mesh as any).isPluginMesh ||
        mesh.name === '__xr_reticle__' ||
        mesh.name?.startsWith('__xr_slot_')
      ) {
        continue;
      }
      let b = getLocalBounds(mesh);
      if (!b) continue;
      if (mesh.transform) b = xform(mesh.transform, b);
      if (viewer.modelRootMatrix) b = xform(viewer.modelRootMatrix, b);
      const [wx, wy, wz, whx, why, whz] = b;
      const item = [wx, wz, whx, whz, wy - why, wy + why];
      if (
        /floor|table|pedestal|ground|base|plane/i.test(mesh.name || '') ||
        (why < 0.14 && Math.min(whx, whz) > 0.45)
      ) {
        supports.push(item);
      } else {
        casters.push(item);
      }
    }

    const clusters: number[][] = [];
    const bCenter = viewer.bounds.center || [0, 0, 0];
    const bRadius = Math.max(0.05, Number(viewer.bounds.radius) || 0.5);
    const bMin = viewer.bounds.min;
    let rawBoundsBox: [number, number, number, number, number, number] = bMin
      ? [
          bCenter[0],
          bCenter[1],
          bCenter[2],
          bRadius,
          Math.max(0.01, bCenter[1] - bMin[1]),
          bRadius,
        ]
      : [bCenter[0], bCenter[1], bCenter[2], bRadius, bRadius, bRadius];
    if (viewer.modelRootMatrix) {
      rawBoundsBox = xform(viewer.modelRootMatrix, rawBoundsBox);
    }
    const isXRLiveAR =
      viewer.xrSessionActive &&
      supports.length === 0 &&
      String((viewer as any).container?.tagName || '').toLowerCase() ===
        'xr-live';
    const defaultMinY = isXRLiveAR
      ? (viewer.modelRootMatrix
          ? viewer.modelRootMatrix[5] * XR_LIVE_AR_SURFACE_Y +
            viewer.modelRootMatrix[13]
          : XR_LIVE_AR_SURFACE_Y) + 0.002
      : rawBoundsBox[1] - rawBoundsBox[4] + 0.002;

    for (const [wx, wz, whx, whz, minY] of casters) {
      let surfaceY = -Infinity;
      for (const [sx, sz, shx, shz, , sMaxY] of supports) {
        if (
          minY >= sMaxY - 0.08 &&
          Math.abs(wx - sx) <= shx &&
          Math.abs(wz - sz) <= shz &&
          sMaxY + 0.002 > surfaceY
        ) {
          surfaceY = sMaxY + 0.002;
        }
      }
      if (hasBackdrop) {
        surfaceY = Math.max(
          surfaceY,
          wx >= 0.04 && wx <= 0.36 && wz >= -0.34 && wz <= -0.04 && minY >= 0.01
            ? 0.036
            : Math.hypot(wx, wz) <= 0.66 && minY >= -0.06
              ? 0.003
              : -0.477,
        );
      }
      if (!isFinite(surfaceY)) surfaceY = defaultMinY;

      const hit = clusters.find(
        (k) =>
          Math.hypot(wx - k[0], wz - k[1]) < 0.06 &&
          Math.abs(surfaceY - k[5]) < 0.05,
      );
      if (hit) {
        hit[2] = Math.max(hit[2], whx * 0.78);
        hit[3] = Math.max(hit[3], whz * 0.78);
        hit[4] = Math.min(hit[4], minY);
      } else {
        clusters.push([wx, wz, whx, whz, minY, surfaceY]);
      }
    }

    if (clusters.length === 0) {
      const r = Math.max(0.1, rawBoundsBox[3] * 1.5) / 1.45;
      clusters.push([
        rawBoundsBox[0],
        rawBoundsBox[2],
        r,
        r,
        defaultMinY,
        defaultMinY,
      ]);
    }

    gl.useProgram(ctx.prog);
    gl.uniformMatrix4fv(ctx.uMVP, false, vpMatrix);
    gl.enable(gl.BLEND);
    (gl.blendFuncSeparate || gl.blendFunc).call(
      gl,
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      1,
      gl.ONE_MINUS_SRC_ALPHA,
    );
    gl.depthMask(false);
    gl.bindVertexArray(ctx.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, ctx.vbo);

    for (const [wx, wz, whx, whz, minY, surfaceY] of clusters) {
      const h = Math.max(0, minY - surfaceY);
      const itemIntensity = intensity / (1.0 + h * 2.0);
      if (itemIntensity < 0.02) continue;
      const spread = 1.0 + Math.min(0.75, h * 0.85);
      const sx = Math.max(0.045, whx * 1.45 * spread);
      const sz = Math.max(0.045, whz * 1.45 * spread);
      _quadVerts.set([
        wx - sx,
        surfaceY,
        wz - sz,
        0,
        0,
        wx + sx,
        surfaceY,
        wz - sz,
        1,
        0,
        wx + sx,
        surfaceY,
        wz + sz,
        1,
        1,
        wx - sx,
        surfaceY,
        wz + sz,
        0,
        1,
      ]);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, _quadVerts);
      gl.uniform1f(ctx.uIntensity, itemIntensity);
      gl.uniform1f(
        ctx.uSoftness,
        Math.min(1.0, viewer.shadowSoftness + Math.min(0.45, h * 0.6)),
      );
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }

    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  },

  onDestroy(gl: WebGL2RenderingContext): void {
    const ctx = shadowContexts.get(gl);
    if (!ctx) return;
    gl.deleteVertexArray(ctx.vao);
    gl.deleteBuffer(ctx.vbo);
    gl.deleteBuffer(ctx.ibo);
    gl.deleteProgram(ctx.prog);
    shadowContexts.delete(gl);
  },
};
