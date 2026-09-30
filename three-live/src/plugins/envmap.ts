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
 * @fileoverview Equirectangular HDR/LDR Radiance Map & True IBL Plugin for three-live.
 * Implements:
 * - Mipmapped roughness-based specular IBL (`textureLod`)
 * - Karis analytic split-sum BRDF approximation (`integrateBRDFApprox`)
 * - 9-coefficient Spherical Harmonics (`uSH[9]`) diffuse irradiance
 */

import type {ThreeLivePlugin} from '../plugin';

const viewSHMap = new WeakMap<object, Float32Array>();

/** Sets 9 RGB Spherical Harmonics coefficients (27 floats) for diffuse irradiance on a ThreeView instance or WebGL context. */
export function setEnvironmentSH(
  target: object,
  coeffs: Float32Array | number[],
): void {
  const arr =
    coeffs instanceof Float32Array ? coeffs : new Float32Array(coeffs);
  viewSHMap.set(target, arr);
}

/** Gets the active 9 RGB Spherical Harmonics coefficients for a target. */
export function getEnvironmentSH(target: object): Float32Array | undefined {
  return viewSHMap.get(target);
}

export async function loadEnvironmentTexture(
  gl: WebGL2RenderingContext,
  imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
): Promise<WebGLTexture | null> {
  if (!imageOrUrl) return null;

  let bmp: ImageBitmap | HTMLImageElement;
  if (typeof imageOrUrl === 'string') {
    if (
      typeof fetch !== 'undefined' &&
      typeof createImageBitmap === 'function'
    ) {
      const res = await fetch(imageOrUrl);
      const blob = await res.blob();
      bmp = await createImageBitmap(blob);
    } else if (typeof Image !== 'undefined') {
      bmp = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = imageOrUrl;
      });
    } else {
      return null;
    }
  } else {
    bmp = imageOrUrl;
  }

  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bmp as any,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return texture;
}

const skyboxProgMap = new WeakMap<
  WebGL2RenderingContext,
  {
    program: WebGLProgram;
    vao: WebGLVertexArrayObject | null;
  }
>();

function invertMat4(m: Float32Array): Float32Array {
  const out = new Float32Array(16);
  const a00 = m[0];
  const a01 = m[1];
  const a02 = m[2];
  const a03 = m[3];
  const a10 = m[4];
  const a11 = m[5];
  const a12 = m[6];
  const a13 = m[7];
  const a20 = m[8];
  const a21 = m[9];
  const a22 = m[10];
  const a23 = m[11];
  const a30 = m[12];
  const a31 = m[13];
  const a32 = m[14];
  const a33 = m[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return out;
  det = 1.0 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export const environmentMapPlugin: ThreeLivePlugin & {
  setEnvironmentImage?: (
    viewer: any,
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ) => Promise<void>;
  setSkyboxImage?: (
    viewer: any,
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ) => Promise<void>;
} = {
  name: 'environment-map',

  async setEnvironmentImage(
    viewer: any,
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ): Promise<void> {
    if (!imageOrUrl) {
      if (viewer.environmentTexture) {
        viewer.gl.deleteTexture(viewer.environmentTexture);
        viewer.environmentTexture = null;
      }
    } else {
      const tex = await loadEnvironmentTexture(viewer.gl, imageOrUrl);
      if (viewer.environmentTexture) {
        viewer.gl.deleteTexture(viewer.environmentTexture);
      }
      viewer.environmentTexture = tex;
    }
  },

  async setSkyboxImage(
    viewer: any,
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ): Promise<void> {
    if (!imageOrUrl) {
      if (viewer.skyboxTexture) {
        viewer.gl.deleteTexture(viewer.skyboxTexture);
        viewer.skyboxTexture = null;
      }
    } else {
      const tex = await loadEnvironmentTexture(viewer.gl, imageOrUrl);
      if (viewer.skyboxTexture) {
        viewer.gl.deleteTexture(viewer.skyboxTexture);
      }
      viewer.skyboxTexture = tex;
    }
  },

  onBeforeDrawScene(
    viewer: any,
    gl: WebGL2RenderingContext,
    vp: Float32Array,
    cameraPos: [number, number, number],
    _toneMode: number,
  ): void {
    if (!viewer.skyboxTexture || typeof gl.createProgram !== 'function') return;

    let progInfo = skyboxProgMap.get(gl);
    if (!progInfo) {
      const vs = gl.createShader(gl.VERTEX_SHADER)!;
      gl.shaderSource(
        vs,
        `#version 300 es
out vec2 vNDC;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vNDC=p*2.-1.;gl_Position=vec4(vNDC,.999999,1.);}`,
      );
      gl.compileShader(vs);
      const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
      gl.shaderSource(
        fs,
        `#version 300 es
precision highp float;
in vec2 vNDC;
uniform mat4 uInvVP;
uniform vec3 uCameraPos;
uniform sampler2D uSkyboxMap;
uniform float uExposure;
out vec4 fragColor;
vec2 eqUV(vec3 d){return vec2(atan(d.x,d.z)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.1415926+.5);}
void main(){
vec4 fp=uInvVP*vec4(vNDC,1.,1.);
vec3 dir=normalize(fp.xyz/fp.w-uCameraPos);
vec3 col=texture(uSkyboxMap,eqUV(dir)).rgb*uExposure;
fragColor=vec4(pow(col,vec3(1./2.2)),1.);
}`,
      );
      gl.compileShader(fs);
      const program = gl.createProgram()!;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      const vao =
        typeof gl.createVertexArray === 'function'
          ? gl.createVertexArray()
          : null;
      progInfo = {program, vao};
      skyboxProgMap.set(gl, progInfo);
    }

    const invVP = invertMat4(vp);
    gl.depthMask(false);
    gl.useProgram(progInfo.program);
    if (progInfo.vao) gl.bindVertexArray(progInfo.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, viewer.skyboxTexture);
    const locMap = gl.getUniformLocation(progInfo.program, 'uSkyboxMap');
    if (locMap) gl.uniform1i(locMap, 0);
    const locInv = gl.getUniformLocation(progInfo.program, 'uInvVP');
    if (locInv) gl.uniformMatrix4fv(locInv, false, invVP);
    const locCam = gl.getUniformLocation(progInfo.program, 'uCameraPos');
    if (locCam) gl.uniform3f(locCam, cameraPos[0], cameraPos[1], cameraPos[2]);
    const locExp = gl.getUniformLocation(progInfo.program, 'uExposure');
    if (locExp) gl.uniform1f(locExp, viewer.exposure ?? 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
  },

  onResolveShader(
    _primitiveDef: any,
    _materialDef: any,
    defaultVS: string,
    defaultFS: string,
  ): {vs: string; fs: string} | null {
    if (defaultFS.includes('evalSHIrradiance')) return null;

    let modifiedFS = defaultFS
      .replace(
        'out vec4 fragColor;',
        'uniform vec3 uSH[9];\nuniform int uHasSH;\nout vec4 fragColor;',
      )
      .replace(
        'void main(){',
        `vec3 integrateBRDFApprox(vec3 f0,float r,float NoV){vec4 c0=vec4(-1.,-.0275,-.572,.022),c1=vec4(1.,.0425,1.04,-.04),rv=r*c0+c1;float a=min(rv.x*rv.x,exp2(-9.28*NoV))*rv.x+rv.y;vec2 ab=vec2(-1.04,1.04)*a+rv.zw;return f0*ab.x+vec3(ab.y);}
vec3 evalSHIrradiance(vec3 n){return max(vec3(0.),uSH[0]+uSH[1]*n.y+uSH[2]*n.z+uSH[3]*n.x+uSH[4]*(n.x*n.y)+uSH[5]*(n.y*n.z)+uSH[6]*(3.*n.z*n.z-1.)+uSH[7]*(n.x*n.z)+uSH[8]*(n.x*n.x-n.y*n.y));}
void main(){`,
      );

    modifiedFS = modifiedFS.replace(
      'if(uHasEnvironmentMap==1){\nspecularIBL=texture(uEnvironmentMap,equirectangularUV(R)).rgb*(F*brdf.x+brdf.y);\nenvDiffuse=texture(uEnvironmentMap,equirectangularUV(N)).rgb;\n}',
      `if(uHasEnvironmentMap==1){
specularIBL=textureLod(uEnvironmentMap,equirectangularUV(R),clamp(roughness*6.0,0.0,6.0)).rgb*integrateBRDFApprox(F,roughness,NoV);
envDiffuse=uHasSH==1?evalSHIrradiance(N):textureLod(uEnvironmentMap,equirectangularUV(N),5.0).rgb;
}else if(uHasSH==1){
specularIBL=getStudioRadiance(R,roughness)*integrateBRDFApprox(F,roughness,NoV);
envDiffuse=evalSHIrradiance(N);
}`,
    );

    return {vs: defaultVS, fs: modifiedFS};
  },

  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    _primitiveGpu: any,
    _meshGpu: any,
    _nodeWorldMatrices: Float32Array[],
    _gltf: any,
  ): void {
    const sh = viewSHMap.get(gl);
    const uHasSHLoc = gl.getUniformLocation(program, 'uHasSH');
    if (sh && sh.length >= 27) {
      if (uHasSHLoc) gl.uniform1i(uHasSHLoc, 1);
      const uSHLoc = gl.getUniformLocation(program, 'uSH');
      if (uSHLoc) gl.uniform3fv(uSHLoc, sh);
    } else {
      if (uHasSHLoc) gl.uniform1i(uHasSHLoc, 0);
    }
  },

  onAttributeChanged(
    element: any,
    name: string,
    _oldVal: string | null,
    newVal: string | null,
  ): void {
    if (name === 'environment-image' && element.viewer) {
      this.setEnvironmentImage?.(element.viewer, newVal);
    } else if (name === 'skybox-image' && element.viewer) {
      this.setSkyboxImage?.(element.viewer, newVal);
    }
  },
};
