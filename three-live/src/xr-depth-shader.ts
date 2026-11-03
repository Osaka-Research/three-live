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
 * @fileoverview WebXR real-world depth occlusion for `ThreeView`.
 *
 * Installs a GLSL chunk and uniform binder on the shared registry. Importing
 * this module (done by `xr-live-element.ts`) enables occlusion; bundles that
 * never request WebXR depth (all `<three-live>` bundles) omit it entirely.
 *
 * Supports CPU depth uploaded by `XRDepthManager` (16-bit luminance-alpha or
 * float32, sampled through `normDepthBufferFromNormView`) and GPU depth
 * (per-eye texture arrays, non-linear depth linearized via near/far planes,
 * and reprojection into the depth camera when its pose is known).
 */

import {getSharedRegistry, type XRDepthShaderChunk} from './plugin';

const UNIFORMS_GLSL = `uniform sampler2D uXrDepthTex;
uniform highp sampler2DArray uXrDTA;
uniform int uXrDepthEnabled,uXrDepthFormat,uXrDL,uXrDR;
uniform float uXrRawValueToMeters;
uniform mat4 uXrDepthUVTransform,uXrDVP;
uniform vec2 uXrNF;
uniform vec4 uViewport;
uniform vec3 uCameraFwd;`;

// WebXR depth is planar Z distance, so virtual depth is measured along the
// camera forward axis (radial distance over-occludes toward screen edges).
// `normViewUV` flips gl_FragCoord.y into WebXR's top-left normalized view
// space. 16-bit luminance-alpha unpacks as low + high * 256 bytes.
const OCCLUSION_GLSL = `if(uXrDepthEnabled==1){
vec2 dUV;float vD;bool inV=true;vec2 nf=uXrNF;
if(uXrDR==1){vec4 dc=uXrDVP*vec4(vWorldPos,1.0);inV=dc.w>0.0;dUV=dc.xy/max(dc.w,1e-4)*0.5+0.5;vD=dc.w;}
else{dUV=(uXrDepthUVTransform*vec4((gl_FragCoord.x-uViewport.x)/max(uViewport.z,1.0),1.0-(gl_FragCoord.y-uViewport.y)/max(uViewport.w,1.0),0.0,1.0)).xy;
vD=dot(uCameraFwd,uCameraFwd)>0.5?dot(vWorldPos-uCameraPos,uCameraFwd):length(uCameraPos-vWorldPos);}
if(inV&&dUV.x>=0.0&&dUV.x<=1.0&&dUV.y>=0.0&&dUV.y<=1.0){
vec4 ds=uXrDL>=0?texture(uXrDTA,vec3(dUV,float(uXrDL))):texture(uXrDepthTex,dUV);
float rD=uXrDepthFormat==1?ds.r:(ds.r*255.0+ds.a*65280.0);
bool nl=nf.y>nf.x;
float realDepth=nl?2.0*nf.x*nf.y/max(nf.y+nf.x-(rD*2.0-1.0)*(nf.y-nf.x),1e-5):rD*uXrRawValueToMeters;
if((nl?rD<1.0:(uXrDepthFormat==1||rD<65500.0))&&rD>0.0&&realDepth>0.15&&realDepth<20.0&&vD>realDepth+0.02){
outAlpha*=1.0-smoothstep(0.0,0.035,vD-realDepth-0.02);
if(outAlpha<0.01)discard;
}
}
}`;

export const xrDepthShader: XRDepthShaderChunk = {
  uniformsGLSL: UNIFORMS_GLSL,
  occlusionGLSL: OCCLUSION_GLSL,
  // Every `u[A-Z]...` identifier declared in UNIFORMS_GLSL.
  uniformNames: UNIFORMS_GLSL.match(/\bu[A-Z]\w*/g) || [],
  bind(gl, u, ds, view, vp) {
    const i = (n: string, v: number) => u[n] && gl.uniform1i(u[n], v);
    const m = (n: string, v?: Float32Array | null) =>
      u[n] && v && gl.uniformMatrix4fv(u[n], false, v);
    if (u['uViewport'])
      gl.uniform4f(u['uViewport'], vp[0], vp[1], vp[2], vp[3]);
    if (u['uCameraFwd']) {
      gl.uniform3f(u['uCameraFwd'], -view[2], -view[6], -view[10]);
    }
    // The array sampler must always sit on its own unit: two samplers of
    // different types on the same unit fail every draw call.
    i('uXrDTA', 7);
    const on = Boolean(ds?.enabled && ds.texture);
    i('uXrDepthEnabled', on ? 1 : 0);
    if (!on) return;
    const arr =
      ds.textureType === 'texture-array' && (gl as any).TEXTURE_2D_ARRAY;
    gl.activeTexture(gl.TEXTURE0 + (arr ? 7 : 5));
    gl.bindTexture(arr || gl.TEXTURE_2D, ds.texture);
    i('uXrDepthTex', 5);
    i('uXrDepthFormat', ds.format || 0);
    i('uXrDL', arr ? ds.layer || 0 : -1);
    i('uXrDR', ds.depthViewProj ? 1 : 0);
    m('uXrDVP', ds.depthViewProj);
    m('uXrDepthUVTransform', ds.uvTransform);
    if (u['uXrNF'])
      gl.uniform2f(u['uXrNF'], ds.depthNear || 0, ds.depthFar || 0);
    if (u['uXrRawValueToMeters']) {
      gl.uniform1f(u['uXrRawValueToMeters'], ds.rawValueToMeters);
    }
  },
};

/** Enables WebXR depth occlusion for every `ThreeView` created afterwards. */
export function installXRDepthShader(): void {
  getSharedRegistry().xrDepthShader = xrDepthShader;
}
