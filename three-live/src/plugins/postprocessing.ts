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

// Lightweight Post-Processing Plugin (`bloom` & `outline`) for `<three-live>`
// and `<xr-live>`.
//
// Provides:
// - Dual-Kawase Mipmap Bloom: Soft-knee luminance threshold + downsample /
//   upsample Kawase blur composited additively in 2D canvas mode and bypassed
//   automatically during active WebXR stereo sessions.
// - Silhouette Selection Outline: Inverted-hull clip-space normal-extruded
//   outline pass around `selected-mesh` (when `outline-selected` is set) or
//   any node declaring `userData.xr.outline`.

import {createProgram} from '../gl-program';
import {
  HOST_BLOOM_DEFAULT_RADIUS,
  HOST_BLOOM_DEFAULT_THRESHOLD,
  parseNumericAttr,
} from '../constants';
import {mat3NormalFromMat4, mat4Create, mat4Multiply} from '../math';
import type {ThreeLivePlugin} from '../plugin';
import type {ThreeView} from '../three-view';
import {
  type BloomTraitOptions,
  type OutlineTraitOptions,
  parseBloomTrait,
  parseOutlineTrait,
  safeHexColor,
} from '../xr-trait-schema';

const VS_OUTLINE = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
uniform mat4 uMVP,uVP;
uniform mat3 uNormalMatrix;
uniform vec2 uViewportSize;
uniform float uOutlineThickness;
void main(){
vec4 clipPos=uMVP*vec4(aPosition,1.0);
vec3 nPart=length(aNormal)>1e-5?normalize(aNormal):vec3(0.0);
vec3 pPart=length(aPosition)>1e-5?normalize(aPosition)*0.65:vec3(0.0);
vec3 rawN=nPart+pPart;
vec3 worldN=uNormalMatrix*(length(rawN)>1e-5?normalize(rawN):vec3(0.0,1.0,0.0));
float nLen=length(worldN);
vec3 n=nLen>1e-5?(worldN/nLen):vec3(0.0,1.0,0.0);
vec4 clipN=uVP*vec4(n,0.0);
vec2 dir=length(clipN.xy)>1e-5?normalize(clipN.xy):vec2(0.0);
vec2 pxOffset=dir*(uOutlineThickness*2.0/max(uViewportSize,vec2(1.0)))*clipPos.w;
clipPos.xy+=pxOffset;
clipPos.z+=1e-4*clipPos.w;
gl_Position=clipPos;
}`;

const FS_OUTLINE = `#version 300 es
precision highp float;
uniform vec4 uOutlineColor;
out vec4 fragColor;
void main(){
fragColor=uOutlineColor;
}`;

const VS_FULLSCREEN = `#version 300 es
out vec2 vUV;
void main(){
vec2 pos=vec2((gl_VertexID<<1)&2,gl_VertexID&2);
vUV=pos;
gl_Position=vec4(pos*2.0-1.0,0.0,1.0);
}`;

const FS_KAWASE_DOWN = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSourceTex;
uniform vec2 uTexelSize;
uniform float uThreshold;
out vec4 fragColor;
vec3 prefilter(vec3 c){
float br=max(c.r,max(c.g,c.b));
float knee=max(uThreshold*0.5,1e-4);
float soft=clamp(br-uThreshold+knee,0.0,2.0*knee);
soft=(soft*soft)/(4.0*knee+1e-4);
float contrib=max(soft,br-uThreshold)/max(br,1e-4);
return c*clamp(contrib,0.0,1.0);
}
void main(){
vec2 h=uTexelSize*0.5;
vec3 c=prefilter(texture(uSourceTex,vUV).rgb)*0.5;
c+=prefilter(texture(uSourceTex,vUV+vec2(-h.x,-h.y)).rgb)*0.125;
c+=prefilter(texture(uSourceTex,vUV+vec2(h.x,-h.y)).rgb)*0.125;
c+=prefilter(texture(uSourceTex,vUV+vec2(-h.x,h.y)).rgb)*0.125;
c+=prefilter(texture(uSourceTex,vUV+vec2(h.x,h.y)).rgb)*0.125;
fragColor=vec4(c,1.0);
}`;

// The final composite writes `alpha = min(r, g, b)` with
// `blendFuncSeparate(ONE, ONE, ONE, ONE_MINUS_SRC_ALPHA)`. Over the default
// transparent canvas this deliberately keeps coloured glow additive on top of
// the page backdrop (premultiplied `rgb > alpha`): using `max(r, g, b)` would
// make the browser scale the CSS backdrop by `1 - max` wherever the wide
// low-level halo lands, visibly darkening/tinting the background when bloom is
// toggled (the regression fixed in cl/1013876464). White glow still gains
// coverage alpha.
const FS_KAWASE_UP = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uBloomTex;
uniform vec2 uTexelSize;
uniform float uRadius;
uniform float uStrength;
out vec4 fragColor;
void main(){
vec2 d=uTexelSize*max(0.25,uRadius*2.5);
vec3 sum=vec3(0.0);
sum+=texture(uBloomTex,vUV+vec2(-d.x*2.0,0.0)).rgb;
sum+=texture(uBloomTex,vUV+vec2(-d.x,d.y)).rgb*2.0;
sum+=texture(uBloomTex,vUV+vec2(0.0,d.y*2.0)).rgb;
sum+=texture(uBloomTex,vUV+vec2(d.x,d.y)).rgb*2.0;
sum+=texture(uBloomTex,vUV+vec2(d.x*2.0,0.0)).rgb;
sum+=texture(uBloomTex,vUV+vec2(d.x,-d.y)).rgb*2.0;
sum+=texture(uBloomTex,vUV+vec2(0.0,-d.y*2.0)).rgb;
sum+=texture(uBloomTex,vUV+vec2(-d.x,-d.y)).rgb*2.0;
vec3 bloom=(sum/12.0)*uStrength;
float a=clamp(min(bloom.r,min(bloom.g,bloom.b)),0.0,1.0);
fragColor=vec4(bloom,a);
}`;

const BLOOM_MIP_COUNT = 3;

interface PostprocGpuContext {
  outlineProg: WebGLProgram;
  uOutlineMVP: WebGLUniformLocation | null;
  uOutlineVP: WebGLUniformLocation | null;
  uOutlineNormalMatrix: WebGLUniformLocation | null;
  uOutlineViewportSize: WebGLUniformLocation | null;
  uOutlineThickness: WebGLUniformLocation | null;
  uOutlineColor: WebGLUniformLocation | null;
  downProg: WebGLProgram;
  uDownSourceTex: WebGLUniformLocation | null;
  uDownTexelSize: WebGLUniformLocation | null;
  uDownThreshold: WebGLUniformLocation | null;
  upProg: WebGLProgram;
  uUpBloomTex: WebGLUniformLocation | null;
  uUpTexelSize: WebGLUniformLocation | null;
  uUpRadius: WebGLUniformLocation | null;
  uUpStrength: WebGLUniformLocation | null;
  fsVao: WebGLVertexArrayObject | null;
  sceneTex: WebGLTexture | null;
  bloomTex: Array<WebGLTexture | null>;
  bloomFbo: Array<WebGLFramebuffer | null>;
  mipWidth: number[];
  mipHeight: number[];
  texWidth: number;
  texHeight: number;
}

const postprocContexts = new WeakMap<
  WebGL2RenderingContext,
  PostprocGpuContext
>();

/**
 * Parses a `#rgb` or `#rrggbb` hex string into normalized `[r, g, b]` in `[0, 1]`.
 */
export function parseHexRgb(
  hex: string,
  fallback: readonly [number, number, number] = [0.22, 0.74, 0.97],
): [number, number, number] {
  const clean = safeHexColor(hex, '');
  if (!clean.startsWith('#')) {
    return [fallback[0], fallback[1], fallback[2]];
  }
  const body = clean.slice(1);
  if (body.length === 3) {
    const r = Number('0x' + body[0] + body[0]) / 255;
    const g = Number('0x' + body[1] + body[1]) / 255;
    const b = Number('0x' + body[2] + body[2]) / 255;
    return [r, g, b];
  }
  if (body.length === 6) {
    const r = Number('0x' + body.slice(0, 2)) / 255;
    const g = Number('0x' + body.slice(2, 4)) / 255;
    const b = Number('0x' + body.slice(4, 6)) / 255;
    return [r, g, b];
  }
  return [fallback[0], fallback[1], fallback[2]];
}

/**
 * Evaluates the soft-knee threshold bloom contribution for a linear RGB sample,
 * matching the Dual-Kawase prefilter shader.
 */
export function evaluateKawaseBloom(
  rgb: readonly [number, number, number],
  strength: number,
  threshold = 0.8,
  softKnee = 0.5,
): [number, number, number] {
  const s = Number.isFinite(strength) ? Math.max(0, strength) : 0;
  if (s <= 0) return [0, 0, 0];
  const r = Math.max(0, Number(rgb[0]) || 0);
  const g = Math.max(0, Number(rgb[1]) || 0);
  const b = Math.max(0, Number(rgb[2]) || 0);
  const br = Math.max(r, g, b);
  if (br <= 1e-6) return [0, 0, 0];
  const th = Number.isFinite(threshold) ? Math.max(0, threshold) : 0.8;
  const knee = Math.max(th * Math.max(0, softKnee), 1e-4);
  const soft = Math.max(0, Math.min(2 * knee, br - th + knee));
  const softSq = (soft * soft) / (4 * knee + 1e-4);
  const contrib = Math.min(
    1,
    Math.max(0, Math.max(softSq, br - th) / Math.max(br, 1e-4)),
  );
  const factor = contrib * s;
  return [r * factor, g * factor, b * factor];
}

/**
 * Computes the clip-space XY offset `(dx, dy)` for a silhouette outline vertex
 * extruded by `thicknessPx` screen pixels at perspective depth `clipW`.
 */
export function computeOutlineClipOffset(
  clipNormalXY: readonly [number, number],
  clipW: number,
  thicknessPx: number,
  viewportSize: readonly [number, number],
): [number, number] {
  const nx = Number(clipNormalXY[0]) || 0;
  const ny = Number(clipNormalXY[1]) || 0;
  const len = Math.hypot(nx, ny);
  if (len <= 1e-5 || clipW <= 0 || thicknessPx <= 0) {
    return [0, 0];
  }
  const vw = Math.max(1, Number(viewportSize[0]) || 1);
  const vh = Math.max(1, Number(viewportSize[1]) || 1);
  const scale = Math.max(0, thicknessPx) * 2.0 * clipW;
  return [(nx / len) * (scale / vw), (ny / len) * (scale / vh)];
}

/** Contexts whose postprocessing shaders failed to link (pass disabled). */
const failedPostprocContexts = new WeakSet<WebGL2RenderingContext>();

function getPostprocContext(
  gl: WebGL2RenderingContext,
): PostprocGpuContext | null {
  let ctx = postprocContexts.get(gl);
  if (ctx) {
    // After a WebGL context loss/restore the cached handles are dead.
    if (typeof gl.isProgram !== 'function' || gl.isProgram(ctx.outlineProg)) {
      return ctx;
    }
    postprocContexts.delete(gl);
  }
  if (failedPostprocContexts.has(gl) || gl.isContextLost?.()) return null;

  const outlineProg = createProgram(gl, VS_OUTLINE, FS_OUTLINE, false);
  const downProg = createProgram(gl, VS_FULLSCREEN, FS_KAWASE_DOWN, false);
  const upProg = createProgram(gl, VS_FULLSCREEN, FS_KAWASE_UP, false);
  if (!outlineProg || !downProg || !upProg) {
    for (const p of [outlineProg, downProg, upProg]) {
      if (p) gl.deleteProgram(p);
    }
    failedPostprocContexts.add(gl);
    return null;
  }
  const fsVao =
    typeof gl.createVertexArray === 'function' ? gl.createVertexArray() : null;

  ctx = {
    outlineProg,
    uOutlineMVP: gl.getUniformLocation(outlineProg, 'uMVP'),
    uOutlineVP: gl.getUniformLocation(outlineProg, 'uVP'),
    uOutlineNormalMatrix: gl.getUniformLocation(outlineProg, 'uNormalMatrix'),
    uOutlineViewportSize: gl.getUniformLocation(outlineProg, 'uViewportSize'),
    uOutlineThickness: gl.getUniformLocation(outlineProg, 'uOutlineThickness'),
    uOutlineColor: gl.getUniformLocation(outlineProg, 'uOutlineColor'),
    downProg,
    uDownSourceTex: gl.getUniformLocation(downProg, 'uSourceTex'),
    uDownTexelSize: gl.getUniformLocation(downProg, 'uTexelSize'),
    uDownThreshold: gl.getUniformLocation(downProg, 'uThreshold'),
    upProg,
    uUpBloomTex: gl.getUniformLocation(upProg, 'uBloomTex'),
    uUpTexelSize: gl.getUniformLocation(upProg, 'uTexelSize'),
    uUpRadius: gl.getUniformLocation(upProg, 'uRadius'),
    uUpStrength: gl.getUniformLocation(upProg, 'uStrength'),
    fsVao,
    sceneTex: null,
    bloomTex: [],
    bloomFbo: [],
    mipWidth: [],
    mipHeight: [],
    texWidth: 0,
    texHeight: 0,
  };
  postprocContexts.set(gl, ctx);
  return ctx;
}

function ensureBloomTargets(
  gl: WebGL2RenderingContext,
  ctx: PostprocGpuContext,
  width: number,
  height: number,
): boolean {
  if (
    typeof gl.createFramebuffer !== 'function' ||
    typeof gl.copyTexSubImage2D !== 'function'
  ) {
    return false;
  }
  const w = Math.max(2, width | 0);
  const h = Math.max(2, height | 0);
  if (
    ctx.sceneTex &&
    ctx.bloomFbo.length === BLOOM_MIP_COUNT &&
    ctx.texWidth === w &&
    ctx.texHeight === h
  ) {
    return true;
  }

  if (!ctx.sceneTex) ctx.sceneTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ctx.sceneTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    w,
    h,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let mipW = w;
  let mipH = h;
  for (let i = 0; i < BLOOM_MIP_COUNT; i++) {
    mipW = Math.max(1, mipW >> 1);
    mipH = Math.max(1, mipH >> 1);
    ctx.mipWidth[i] = mipW;
    ctx.mipHeight[i] = mipH;

    if (!ctx.bloomTex[i]) ctx.bloomTex[i] = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, ctx.bloomTex[i]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      mipW,
      mipH,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (!ctx.bloomFbo[i]) ctx.bloomFbo[i] = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.bloomFbo[i]);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      ctx.bloomTex[i],
      0,
    );
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  ctx.texWidth = w;
  ctx.texHeight = h;
  return true;
}

function resolveViewerBloom(viewer: ThreeView): BloomTraitOptions | null {
  const el = viewer.container as HTMLElement | undefined;
  if (el && typeof el.getAttribute === 'function') {
    const rawBloom = el.getAttribute('bloom');
    if (rawBloom !== null) {
      const trimmed = rawBloom.trim().toLowerCase();
      if (trimmed === 'false' || trimmed === '0' || trimmed === 'none') {
        return null;
      }
      const parsedVal =
        trimmed === '' || trimmed === 'true' ? 0.35 : Number(trimmed);
      if (!Number.isFinite(parsedVal) || parsedVal <= 0) {
        return null;
      }
      const trait = parseBloomTrait({
        strength: parsedVal,
        threshold: parseNumericAttr(
          el.getAttribute('bloom-threshold'),
          HOST_BLOOM_DEFAULT_THRESHOLD,
        ),
        radius: parseNumericAttr(
          el.getAttribute('bloom-radius'),
          HOST_BLOOM_DEFAULT_RADIUS,
        ),
      });
      if (trait) return trait;
    }
  }
  let bestTrait: BloomTraitOptions | null = null;
  for (const mesh of viewer.meshes || []) {
    if ((mesh as {visible?: boolean}).visible === false) continue;
    const raw =
      mesh?.extras?.xr?.bloom ??
      (mesh as unknown as {userData?: {xr?: {bloom?: unknown}}})?.userData?.xr
        ?.bloom;
    const trait = parseBloomTrait(raw);
    if (trait && (!bestTrait || trait.strength > bestTrait.strength)) {
      bestTrait = trait;
    }
  }
  return bestTrait;
}

function parseHostOutlineAttribute(
  rawOutline: string | null,
  fallbackColor: string,
): OutlineTraitOptions | null {
  if (rawOutline == null) return null;
  const trimmed = rawOutline.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'false' || lower === '0' || lower === 'none') {
    return null;
  }
  let color = fallbackColor;
  let thickness = 3.5;
  let pulse = false;
  if (trimmed && lower !== 'true') {
    const tokens = trimmed.split(/\s+/);
    for (const token of tokens) {
      if (token.startsWith('#')) {
        color = token;
      } else if (token.toLowerCase() === 'pulse') {
        pulse = true;
      } else {
        const num = Number(token);
        if (Number.isFinite(num) && num > 0) {
          // Metre-sized values (< 0.25) are converted by `parseOutlineTrait`.
          thickness = num;
        }
      }
    }
  }
  return parseOutlineTrait({color, thickness, pulse});
}

/**
 * Mesh name tokens skipped by the host `outline` attribute when no mesh is
 * selected (staging geometry such as floors and pedestals). Names are split
 * into whole tokens on separators, digits, and camelCase boundaries, so
 * `"floor_01"` and `"GroundPlane"` are skipped but `"Tablet"` or `"Keypad"`
 * are outlined.
 */
const HOST_OUTLINE_SKIP_TOKENS = new Set([
  'floor',
  'pedestal',
  'ground',
  'table',
  'grid',
  'pad',
]);

function isHostOutlineStagingMesh(name: string): boolean {
  return name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z]+/)
    .some((t) => HOST_OUTLINE_SKIP_TOKENS.has(t));
}

/**
 * Resolves the outline for `mesh`: host `outline="false"` wins, then the
 * node's `outline` trait, then `selected-mesh` with the host `outline` /
 * `outline-selected` attributes, then the host `outline` attribute.
 */
export function resolveMeshOutline(
  viewer: ThreeView,
  mesh: ThreeView['meshes'][number],
): OutlineTraitOptions | null {
  const el = viewer.container as HTMLElement | undefined;
  const rawHostOutline =
    typeof el?.getAttribute === 'function' ? el.getAttribute('outline') : null;
  if (rawHostOutline != null) {
    const lower = rawHostOutline.trim().toLowerCase();
    if (lower === 'false' || lower === '0' || lower === 'none') {
      return null;
    }
  }

  const raw =
    mesh?.extras?.xr?.outline ??
    (mesh as unknown as {userData?: {xr?: {outline?: unknown}}})?.userData?.xr
      ?.outline;
  const nodeTrait = parseOutlineTrait(raw);
  if (nodeTrait) return nodeTrait;

  const attrColor =
    (typeof el?.getAttribute === 'function' &&
      el.getAttribute('outline-color')) ||
    '#38bdf8';
  const hostTrait = parseHostOutlineAttribute(rawHostOutline, attrColor);
  const outlineSelected =
    el != null &&
    typeof el.hasAttribute === 'function' &&
    el.hasAttribute('outline-selected') &&
    el.getAttribute('outline-selected') !== 'false';

  const selectedName = viewer.getSelectedMesh?.() || '';
  if (selectedName) {
    if (mesh.name !== selectedName) return null;
    if (hostTrait) return hostTrait;
    if (outlineSelected) {
      return parseOutlineTrait({color: attrColor, thickness: 3, pulse: false});
    }
    return null;
  }

  if (hostTrait) {
    const meshName = mesh.name || '';
    if (isHostOutlineStagingMesh(meshName)) {
      return null;
    }
    return hostTrait;
  }
  return null;
}

/**
 * `<three-live>` and `<xr-live>` plugin providing Dual-Kawase Mipmap Bloom and
 * Silhouette Selection Outlines.
 */
export const postprocessingPlugin: ThreeLivePlugin = {
  name: 'postprocessing',

  onAttributeChanged(element: {viewer?: ThreeView | null}, name: string): void {
    if (
      name === 'bloom' ||
      name === 'bloom-threshold' ||
      name === 'bloom-radius' ||
      name === 'outline' ||
      name === 'outline-selected' ||
      name === 'outline-color' ||
      name === 'selected-mesh'
    ) {
      element.viewer?.render?.();
    }
  },

  onAfterRender(
    gl: WebGL2RenderingContext,
    viewer: ThreeView,
    vpMatrix: Float32Array,
  ): void {
    if (!viewer.meshes || viewer.meshes.length === 0) return;

    const w = Math.max(1, viewer.canvas?.width || 300);
    const h = Math.max(1, viewer.canvas?.height || 150);

    // 1. Silhouette Outline Pass
    const outlinedMeshes: Array<{
      mesh: ThreeView['meshes'][number];
      trait: OutlineTraitOptions;
    }> = [];
    for (const mesh of viewer.meshes) {
      if ((mesh as {visible?: boolean}).visible === false) continue;
      const trait = resolveMeshOutline(viewer, mesh);
      if (trait) {
        outlinedMeshes.push({mesh, trait});
      }
    }

    const outlineCtx =
      outlinedMeshes.length > 0 ? getPostprocContext(gl) : null;
    if (outlineCtx) {
      const ctx = outlineCtx;
      const modelMat = mat4Create();
      const mvpMat = mat4Create();
      const normalMat = new Float32Array(9);
      const nowSec =
        (typeof performance !== 'undefined' ? performance.now() : Date.now()) *
        0.001;
      // Thickness is in pixels of the current eye/XR viewport, not the canvas
      // (side-by-side stereo eyes are half-width; XR framebuffers differ).
      const vpArr =
        typeof gl.getParameter === 'function'
          ? (gl.getParameter(gl.VIEWPORT) as ArrayLike<number> | null)
          : null;
      const ow = Math.max(1, vpArr?.[2] || w);
      const oh = Math.max(1, vpArr?.[3] || h);

      gl.useProgram(ctx.outlineProg);
      if (ctx.uOutlineViewportSize) {
        gl.uniform2f(ctx.uOutlineViewportSize, ow, oh);
      }
      if (ctx.uOutlineVP) {
        gl.uniformMatrix4fv(ctx.uOutlineVP, false, vpMatrix);
      }
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.depthMask(false);

      for (const {mesh, trait} of outlinedMeshes) {
        const [r, g, b] = parseHexRgb(trait.color);
        const pulseScale = trait.pulse
          ? 0.8 + 0.25 * Math.sin(nowSec * 4.0)
          : 1.0;
        if (ctx.uOutlineColor) {
          gl.uniform4f(ctx.uOutlineColor, r, g, b, 1.0);
        }
        if (ctx.uOutlineThickness) {
          gl.uniform1f(ctx.uOutlineThickness, trait.thickness * pulseScale);
        }

        if ((mesh as {worldSpace?: boolean}).worldSpace === true) {
          modelMat.set(mesh.transform);
        } else {
          mat4Multiply(modelMat, viewer.modelRootMatrix, mesh.transform);
        }

        const instMats = mesh.instanceMatrices;
        for (const prim of mesh.primitives) {
          // VS_OUTLINE has no skinning/morph code, so its hull would stay in
          // the bind pose and drift from the animated mesh; skip for now.
          if (
            prim.pluginData?.skinning?.hasSkin ||
            prim.pluginData?.morph?.hasMorph
          ) {
            continue;
          }
          gl.bindVertexArray(prim.vao);
          if (instMats && instMats.length >= 16) {
            const instCount = instMats.length >> 4;
            const instModel = mat4Create();
            for (let inst = 0; inst < instCount; inst++) {
              mat4Multiply(
                instModel,
                modelMat,
                instMats.subarray(inst * 16, inst * 16 + 16),
              );
              mat4Multiply(mvpMat, vpMatrix, instModel);
              mat3NormalFromMat4(normalMat, instModel);
              gl.uniformMatrix4fv(ctx.uOutlineMVP, false, mvpMat);
              gl.uniformMatrix3fv(ctx.uOutlineNormalMatrix, false, normalMat);
              if (prim.indices) {
                gl.drawElements(
                  gl.TRIANGLES,
                  prim.indexCount,
                  prim.indexType,
                  0,
                );
              } else {
                gl.drawArrays(gl.TRIANGLES, 0, prim.indexCount);
              }
            }
          } else {
            mat4Multiply(mvpMat, vpMatrix, modelMat);
            mat3NormalFromMat4(normalMat, modelMat);
            gl.uniformMatrix4fv(ctx.uOutlineMVP, false, mvpMat);
            gl.uniformMatrix3fv(ctx.uOutlineNormalMatrix, false, normalMat);
            if (prim.indices) {
              gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
            } else {
              gl.drawArrays(gl.TRIANGLES, 0, prim.indexCount);
            }
          }
        }
      }

      gl.bindVertexArray(null);
      gl.cullFace(gl.BACK);
      gl.disable(gl.CULL_FACE);
      gl.depthFunc(gl.LESS);
      gl.depthMask(true);
    }

    // 2. Dual-Kawase Mipmap Bloom Pass (automatically bypassed in WebXR stereo)
    if (viewer.xrSessionActive || viewer.stereoSBS) return;
    const bloom = resolveViewerBloom(viewer);
    if (!bloom || bloom.strength <= 0) return;

    const ctx = getPostprocContext(gl);
    if (!ctx || !ensureBloomTargets(gl, ctx, w, h) || !ctx.fsVao) return;

    // Copy current rendered frame into sceneTex
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ctx.sceneTex);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);

    // Downsample pyramid: sceneTex -> mip0 (thresholded) -> mip1 -> mip2
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.useProgram(ctx.downProg);
    gl.uniform1i(ctx.uDownSourceTex, 0);
    gl.bindVertexArray(ctx.fsVao);

    let srcTex = ctx.sceneTex;
    let srcW = w;
    let srcH = h;
    for (let i = 0; i < BLOOM_MIP_COUNT; i++) {
      const dstW = ctx.mipWidth[i];
      const dstH = ctx.mipHeight[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.bloomFbo[i]);
      gl.viewport(0, 0, dstW, dstH);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.uniform2f(ctx.uDownTexelSize, 1.0 / srcW, 1.0 / srcH);
      gl.uniform1f(ctx.uDownThreshold, i === 0 ? bloom.threshold : 0.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcTex = ctx.bloomTex[i];
      srcW = dstW;
      srcH = dstH;
    }

    // Upsample pyramid: mip2 -> mip1 -> mip0 -> default framebuffer (w, h)
    gl.enable(gl.BLEND);
    if (typeof gl.blendFuncSeparate === 'function') {
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.blendFunc(gl.ONE, gl.ONE);
    }
    gl.useProgram(ctx.upProg);
    gl.uniform1i(ctx.uUpBloomTex, 0);
    gl.uniform1f(ctx.uUpRadius, bloom.radius);

    for (let i = BLOOM_MIP_COUNT - 1; i >= 1; i--) {
      const dstIdx = i - 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.bloomFbo[dstIdx]);
      gl.viewport(0, 0, ctx.mipWidth[dstIdx], ctx.mipHeight[dstIdx]);
      gl.bindTexture(gl.TEXTURE_2D, ctx.bloomTex[i]);
      gl.uniform2f(
        ctx.uUpTexelSize,
        1.0 / ctx.mipWidth[i],
        1.0 / ctx.mipHeight[i],
      );
      gl.uniform1f(ctx.uUpStrength, 0.85);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // Final upsample + additive composite onto default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, ctx.bloomTex[0]);
    gl.uniform2f(
      ctx.uUpTexelSize,
      1.0 / ctx.mipWidth[0],
      1.0 / ctx.mipHeight[0],
    );
    gl.uniform1f(ctx.uUpStrength, bloom.strength);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
  },

  onDestroy(gl: WebGL2RenderingContext): void {
    const ctx = postprocContexts.get(gl);
    if (!ctx) return;
    gl.deleteProgram(ctx.outlineProg);
    gl.deleteProgram(ctx.downProg);
    gl.deleteProgram(ctx.upProg);
    if (ctx.fsVao) gl.deleteVertexArray(ctx.fsVao);
    if (ctx.sceneTex) gl.deleteTexture(ctx.sceneTex);
    for (const tex of ctx.bloomTex) {
      if (tex) gl.deleteTexture(tex);
    }
    for (const fbo of ctx.bloomFbo) {
      if (fbo) gl.deleteFramebuffer(fbo);
    }
    postprocContexts.delete(gl);
  },
};
