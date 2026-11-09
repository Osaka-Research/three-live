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

import {mat4Invert} from '../math';
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
  if (texture) {
    (texture as {__gpuImageSource?: unknown}).__gpuImageSource = bmp;
  }
  return texture;
}

const skyboxProgMap = new WeakMap<
  WebGL2RenderingContext,
  {
    program: WebGLProgram;
    vao: WebGLVertexArrayObject | null;
  }
>();
const _invVP = new Float32Array(16);

async function setTex(
  viewer: any,
  prop: 'environmentTexture' | 'skyboxTexture',
  imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
): Promise<void> {
  const tex = imageOrUrl
    ? await loadEnvironmentTexture(viewer.gl, imageOrUrl)
    : null;
  if (viewer[prop]) viewer.gl.deleteTexture(viewer[prop]);
  viewer[prop] = tex;
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

  onContextRestored(gl: WebGL2RenderingContext): void {
    skyboxProgMap.delete(gl);
  },

  setEnvironmentImage(viewer, imageOrUrl) {
    return setTex(viewer, 'environmentTexture', imageOrUrl);
  },

  setSkyboxImage(viewer, imageOrUrl) {
    return setTex(viewer, 'skyboxTexture', imageOrUrl);
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
      const mkS = (t: number, s: string) => {
        const sh = gl.createShader(t)!;
        gl.shaderSource(sh, s);
        gl.compileShader(sh);
        return sh;
      };
      const program = gl.createProgram()!;
      gl.attachShader(
        program,
        mkS(
          gl.VERTEX_SHADER,
          `#version 300 es\nout vec2 vNDC;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vNDC=p*2.-1.;gl_Position=vec4(vNDC,.999999,1.);}`,
        ),
      );
      gl.attachShader(
        program,
        mkS(
          gl.FRAGMENT_SHADER,
          `#version 300 es\nprecision highp float;in vec2 vNDC;uniform mat4 uInvVP;uniform vec3 uCameraPos;uniform sampler2D uSkyboxMap;uniform float uExposure;out vec4 fragColor;vec2 eqUV(vec3 d){return vec2(atan(d.x,d.z)/6.2831853+.5,asin(clamp(d.y,-1.,1.))/3.1415926+.5);}void main(){vec4 fp=uInvVP*vec4(vNDC,1.,1.);vec3 dir=normalize(fp.xyz/fp.w-uCameraPos);fragColor=vec4(pow(texture(uSkyboxMap,eqUV(dir)).rgb*uExposure,vec3(1./2.2)),1.);}`,
        ),
      );
      gl.linkProgram(program);
      const vao =
        typeof gl.createVertexArray === 'function'
          ? gl.createVertexArray()
          : null;
      progInfo = {program, vao};
      skyboxProgMap.set(gl, progInfo);
    }

    const invVP = mat4Invert(_invVP, vp) || _invVP;
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
