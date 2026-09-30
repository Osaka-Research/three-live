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
 * @fileoverview Planar Ground Contact Shadow Plugin for three-live.
 * Renders a dynamic Gaussian falloff contact shadow under 3D models via onAfterRender.
 */

import type {ThreeLivePlugin} from '../plugin';

const VS_SHADOW = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=1) in vec2 aUV;
uniform mat4 uMVP;
out vec2 vUV;
void main(){
vUV=aUV;
gl_Position=uMVP*vec4(aPosition,1.0);
}`;

const FS_SHADOW = `#version 300 es
precision highp float;
in vec2 vUV;
uniform float uShadowIntensity,uShadowSoftness;
out vec4 fragColor;
void main(){
vec2 fromCenter=(vUV-vec2(0.5))*2.0;
float dist=length(fromCenter);
float falloff=smoothstep(1.0,1.0-uShadowSoftness*0.7,dist);
fragColor=vec4(0.0,0.0,0.0,falloff*uShadowIntensity);
}`;

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

function getShadowContext(gl: WebGL2RenderingContext): ShadowGpuContext {
  let ctx = shadowContexts.get(gl);
  if (ctx) return ctx;

  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, VS_SHADOW);
  gl.compileShader(vs);

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, FS_SHADOW);
  gl.compileShader(fs);

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  const vao = gl.createVertexArray()!;
  const vbo = gl.createBuffer()!;
  const ibo = gl.createBuffer()!;

  gl.bindVertexArray(vao);

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, 20 * 4, gl.DYNAMIC_DRAW);

  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 5 * 4, 0);

  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 5 * 4, 3 * 4);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

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

  onAfterRender(
    gl: WebGL2RenderingContext,
    viewer: ThreeView,
    vpMatrix: Float32Array,
  ): void {
    const intensity = viewer.shadowIntensity;
    if (intensity <= 0 || !viewer.bounds) return;

    const ctx = getShadowContext(gl);
    const c = viewer.bounds.center;
    const minY = viewer.bounds.min
      ? viewer.bounds.min[1]
      : c[1] - viewer.bounds.radius;
    const s = Math.max(0.1, viewer.bounds.radius * 1.5);

    const vertices = new Float32Array([
      c[0] - s, minY, c[2] - s, 0.0, 0.0,
      c[0] + s, minY, c[2] - s, 1.0, 0.0,
      c[0] + s, minY, c[2] + s, 1.0, 1.0,
      c[0] - s, minY, c[2] + s, 0.0, 1.0,
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, ctx.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);

    gl.useProgram(ctx.prog);
    gl.uniformMatrix4fv(ctx.uMVP, false, vpMatrix);
    gl.uniform1f(ctx.uIntensity, intensity);
    gl.uniform1f(ctx.uSoftness, viewer.shadowSoftness);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    gl.bindVertexArray(ctx.vao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
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
