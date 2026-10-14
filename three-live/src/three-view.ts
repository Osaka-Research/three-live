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
 * Ultra-lightweight standalone WebGL2 PBR 3D viewer.
 * Zero external dependencies (~16 KB raw, ~5.8 KB gzip).
 *
 * Features:
 * - Direct binary glTF 2.0 (.glb) parser & zero-copy GPU buffer ingestion.
 * - Arcball orbit camera: rotate, zoom (wheel/pinch), auto-rotate spin, inertial damping.
 * - Gesture disambiguation: drag (>=5px) vs tap/click (<5px).
 * - GPU Color-ID picking with sub-mesh selection & highlight.
 * - Dynamic lighting loop (ambient, directional, point lights with attenuation).
 * - Reinhard tone mapping and two-sided normal correction.
 * - Option B 60 FPS matrix updates (updateMeshTransforms).
 */

export interface HitDetail {
  meshIndex: number;
  meshName: string;
  nodeIndex?: number;
  distance: number;
  hitPoint: [number, number, number];
  normal: [number, number, number];
  screenX: number;
  screenY: number;
}

export interface CameraDetail {
  theta: number;
  phi: number;
  zoom: number;
  distance: number;
}

export type CameraChangeHandler = (cam: CameraDetail) => void;

export interface AnimationChannel {
  nodeIndex: number;
  path: 'translation' | 'rotation' | 'scale';
  times: Float32Array;
  values: Float32Array;
  interpolation: 'LINEAR' | 'STEP';
}

export interface AnimationClip {
  name: string;
  duration: number;
  channels: AnimationChannel[];
}

export type DecoderType = 'draco' | 'meshopt' | 'ktx2';

export interface MeshDecoder {
  decodePrimitive(
    gltf: any,
    primitive: any,
    bin: ArrayBuffer,
  ): void | Promise<void>;
}

export interface OrbitLimits {
  minTheta?: number;
  maxTheta?: number;
  minPhi?: number;
  maxPhi?: number;
  minDistance?: number;
  maxDistance?: number;
}

export interface ViewOptions {
  canvas?: HTMLCanvasElement;
  clearColor?: [number, number, number, number];
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  autoRotateDelay?: number;
  autoStart?: boolean;
  exposure?: number;
  shadowIntensity?: number;
  shadowSoftness?: number;
  toneMapping?: 'neutral' | 'reinhard' | 'none';
  environmentImage?: string | HTMLImageElement | ImageBitmap | null;
  autoplay?: boolean;
  animationName?: string;
  fieldOfView?: number;
  cameraTarget?: [number, number, number];
  minCameraOrbit?: {theta?: number; phi?: number; distance?: number};
  maxCameraOrbit?: {theta?: number; phi?: number; distance?: number};
  camera?: {
    theta?: number;
    phi?: number;
    distance?: number;
    zoom?: number;
  };
  onMeshClick?: (hit: HitDetail) => void;
  onCameraChange?: CameraChangeHandler;
}

// 1. Minimal Self-Contained Matrix Math
// =========================================================================

import {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  rayIntersectsTriangle,
  resolveNodeWorldMatrices,
  unprojectPoint,
} from './math';
export {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Invert,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  rayIntersectsTriangle,
  resolveNodeWorldMatrices,
  unprojectPoint,
};

// =========================================================================
// 2. glTF 2.0 Binary (.glb) Parser
// =========================================================================

export interface LightGpu {
  type: 'ambient' | 'directional' | 'point';
  color: [number, number, number];
  intensity: number;
  position?: [number, number, number];
  direction?: [number, number, number];
}

export interface GLBData {
  gltf: any;
  bin: ArrayBuffer;
  lights?: LightGpu[];
  animations?: AnimationClip[];
  exposure?: number;
  environmentIntensity?: number;
}

export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

import {
  type ThreeLivePlugin,
  getRegisteredPlugins,
  getSharedRegistry,
  registerPlugin,
  registeredPlugins,
} from './plugin';
export {getRegisteredPlugins, registerPlugin, type ThreeLivePlugin};

const decoders: Map<string, MeshDecoder> = getSharedRegistry().decoders;

export function registerDecoder(type: string, decoder: MeshDecoder): void {
  decoders.set(type.toLowerCase(), decoder);
}

export function getDecoder(type: string): MeshDecoder | undefined {
  return decoders.get(type.toLowerCase());
}

export function parseGLB(input: ArrayBuffer | ArrayBufferView): GLBData {
  const buffer = ArrayBuffer.isView(input)
    ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
    : input;
  const dv = new DataView(buffer);
  if (buffer.byteLength < 12) {
    throw new Error(`Invalid GLB buffer size: ${buffer.byteLength} bytes`);
  }
  const magic = dv.getUint32(0, true);
  if (magic !== 0x46546c67) {
    const firstByte = dv.getUint8(0);
    if (
      firstByte === 0x7b ||
      firstByte === 0x20 ||
      firstByte === 0x0a ||
      firstByte === 0x0d
    ) {
      throw new Error(
        '[three-live] Multi-file JSON .gltf is not supported for performance reasons. Please pack your asset into a single binary .glb file.',
      );
    }
    throw new Error(`Invalid GLB magic: 0x${magic.toString(16)}`);
  }
  const version = dv.getUint32(4, true);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version: ${version}`);
  }
  const totalLength = dv.getUint32(8, true);

  let offset = 12;
  let jsonChunk: any = null;
  let binChunk: ArrayBuffer | null = null;

  while (offset + 8 <= totalLength && offset + 8 <= buffer.byteLength) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;

    if (chunkDataOffset + chunkLength > buffer.byteLength) {
      throw new Error(
        `Truncated GLB chunk: required ${chunkDataOffset + chunkLength} bytes, buffer has ${buffer.byteLength}`,
      );
    }

    if (chunkType === 0x4e4f534a) {
      const jsonBytes = new Uint8Array(buffer, chunkDataOffset, chunkLength);
      const jsonStr = decodeUtf8(jsonBytes);
      jsonChunk = JSON.parse(jsonStr, (key, value) =>
        key === '__proto__' || key === 'constructor' || key === 'prototype'
          ? undefined
          : value,
      );
    } else if (chunkType === 0x004e4942) {
      binChunk = buffer.slice(chunkDataOffset, chunkDataOffset + chunkLength);
    }
    offset = chunkDataOffset + chunkLength;
  }

  if (!jsonChunk) {
    throw new Error('Missing JSON chunk in GLB');
  }

  const extensionsRequired: string[] = jsonChunk.extensionsRequired || [];
  if (extensionsRequired.includes('KHR_draco_mesh_compression')) {
    const decoder = getDecoder('draco');
    if (!decoder) {
      throw new Error(
        "Model requires KHR_draco_mesh_compression. Register a decoder via ThreeLiveElement.registerDecoder('draco', decoder).",
      );
    }
  }
  if (extensionsRequired.includes('EXT_meshopt_compression')) {
    const decoder = getDecoder('meshopt');
    if (!decoder) {
      throw new Error(
        "Model requires EXT_meshopt_compression. Register a decoder via ThreeLiveElement.registerDecoder('meshopt', decoder).",
      );
    }
  }
  if (extensionsRequired.includes('KHR_texture_basisu')) {
    const decoder = getDecoder('ktx2');
    if (!decoder) {
      throw new Error(
        "Model requires KHR_texture_basisu. Register a decoder via ThreeLiveElement.registerDecoder('ktx2', decoder).",
      );
    }
  }

  const bin = binChunk || new ArrayBuffer(0);
  const glbData: GLBData = {
    gltf: jsonChunk,
    bin,
    animations: [],
  };
  for (const plugin of registeredPlugins) {
    plugin.onParseGLB?.(glbData);
  }
  return glbData;
}

export function readFloat32Array(
  bin: ArrayBuffer,
  byteOffset: number,
  count: number,
): Float32Array {
  if (byteOffset % 4 === 0) {
    return new Float32Array(bin, byteOffset, count);
  }
  return new Float32Array(bin.slice(byteOffset, byteOffset + count * 4));
}

/**
 * Type guard verifying if an unknown value satisfies the GLBData interface.
 */
export function isGLBData(val: unknown): val is GLBData {
  return (
    typeof val === 'object' &&
    val !== null &&
    'gltf' in val &&
    typeof (val as Record<string, unknown>).gltf === 'object' &&
    (val as Record<string, unknown>).gltf !== null &&
    'bin' in val &&
    ((val as Record<string, unknown>).bin instanceof ArrayBuffer ||
      ArrayBuffer.isView((val as Record<string, unknown>).bin))
  );
}

/**
 * Authoritative normalizer that safely transforms any supported 3D model payload
 * (GLBData, ArrayBuffer, or ArrayBufferView) into a canonical GLBData AST.
 */
export function toGLBData(
  input: GLBData | ArrayBuffer | ArrayBufferView,
): GLBData {
  if (isGLBData(input)) {
    return input;
  }
  if (input instanceof ArrayBuffer || ArrayBuffer.isView(input)) {
    return parseGLB(input);
  }
  throw new TypeError(
    'Invalid 3D model input: expected GLBData ({ gltf, bin }) or binary GLB (ArrayBuffer / ArrayBufferView).',
  );
}

// =========================================================================
// 3. WebGL2 Microfacet Shaders & Pipeline
// =========================================================================

const VS_RENDER = `#version 300 es
layout(location=0) in vec3 aPosition;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aUV;
uniform mat4 uMVP,uModel;
uniform mat3 uNormalMatrix;
uniform vec4 uUvTransform;
out vec3 vNormal,vWorldPos;
out vec2 vUV;
void main(){
vec3 rawN=uNormalMatrix*aNormal;
vNormal=length(rawN)>1e-5?normalize(rawN):vec3(0.0);
vec4 world=uModel*vec4(aPosition,1.0);
vWorldPos=world.xyz;
vec2 scaleUV=uUvTransform.zw;
if(scaleUV.x==0.0&&scaleUV.y==0.0)scaleUV=vec2(1.0);
vUV=aUV*scaleUV+uUvTransform.xy;
gl_Position=uMVP*vec4(aPosition,1.0);
}`;

const FS_RENDER = `#version 300 es
precision highp float;
in vec3 vNormal,vWorldPos;
in vec2 vUV;
uniform vec4 uBaseColor;
uniform float uMetallic,uRoughness,uEmissive,uEnvIntensity;
uniform vec3 uCameraPos,uAmbientColor;
uniform sampler2D uBaseColorTexture,uMetallicRoughnessTexture,uNormalTexture,uOcclusionTexture,uEnvironmentMap,uXrDepthTex;
uniform int uHasTexture,uHasMetallicRoughnessTexture,uHasNormalTexture,uHasOcclusionTexture,uHasEnvironmentMap,uXrDepthEnabled,uXrDepthFormat;
uniform float uNormalScale,uOcclusionStrength,uXrRawValueToMeters;
uniform mat4 uXrDepthUVTransform;
uniform vec2 uViewportSize;
uniform int uToneMapping,uNumDirLights,uNumPointLights;
uniform vec3 uDirLightDir[2],uDirLightColor[2],uPointLightPos[2],uPointLightColor[2];
out vec4 fragColor;

vec2 envBRDF(float r,float n){
vec4 c0=vec4(-1.0,-0.0275,-0.572,0.022),c1=vec4(1.0,0.0425,1.04,-0.04);
vec4 rv=r*c0+c1;
float a=min(rv.x*rv.x,exp2(-9.28*n))*rv.x+rv.y;
return vec2(-1.04,1.04)*a+rv.zw;
}

vec3 F_SchlickRoughness(vec3 F0,float r,float n){
return F0+(max(vec3(1.0-r),F0)-F0)*pow(clamp(1.0-n,0.0,1.0),5.0);
}

vec3 getStudioRadiance(vec3 R,float r){
vec3 kd=normalize(vec3(0.0,1.0,0.35));
float ki=pow(max(dot(R,kd),0.0),mix(48.0,1.5,r))*mix(1.8,0.5,r);
vec3 fd=normalize(vec3(-0.85,0.45,-0.35));
float fi=pow(max(dot(R,fd),0.0),mix(24.0,1.2,r))*mix(1.0,0.35,r);
float ri=pow(clamp(1.0-abs(R.y),0.0,1.0),3.0)*0.25;
vec3 ag=mix(vec3(0.06,0.06,0.08),vec3(0.48,0.50,0.55),R.y*0.5+0.5);
return ag+vec3(1.0,0.98,0.94)*ki+vec3(0.85,0.92,1.0)*fi+vec3(0.6)*ri;
}

vec3 perturbNormal(vec3 N,vec3 V,vec2 uv,sampler2D normalMap,float scale){
vec3 mapNormal=texture(normalMap,uv).xyz*2.0-1.0;
mapNormal.xy*=scale;
vec3 dp1=dFdx(vWorldPos);
vec3 dp2=dFdy(vWorldPos);
vec2 duv1=dFdx(uv);
vec2 duv2=dFdy(uv);
vec3 dp2perp=cross(dp2,N);
vec3 dp1perp=cross(N,dp1);
vec3 T=dp2perp*duv1.x+dp1perp*duv2.x;
vec3 B=dp2perp*duv1.y+dp1perp*duv2.y;
float invmax=inversesqrt(max(dot(T,T),dot(B,B)));
return normalize(mat3(T*invmax,B*invmax,N)*normalize(mapNormal));
}

vec2 equirectangularUV(vec3 dir){
vec3 d=normalize(dir);
float u=atan(d.z,d.x)*0.15915494309+0.5;
float v=asin(clamp(d.y,-1.0,1.0))*0.31830988618+0.5;
return vec2(u,1.0-v);
}

vec3 neutralToneMapping(vec3 color){
const float startCompression=0.76;
const float desaturation=0.15;
float x=min(color.r,min(color.g,color.b));
float offset=x<0.08?x-6.25*x*x:0.04;
color-=offset;
float peak=max(color.r,max(color.g,color.b));
if(peak<startCompression)return color;
const float d=1.0-startCompression;
float newPeak=1.0-d*d/(peak+d-startCompression);
color*=newPeak/peak;
float g=1.0-1.0/(desaturation*(peak-newPeak)+1.0);
return mix(color,newPeak*vec3(1.0),g);
}

vec3 applyToneMapping(vec3 color,int mode){
if(mode==0)return neutralToneMapping(color);
if(mode==1)return color/(color+vec3(1.0));
return color;
}

void main(){
vec4 base=uBaseColor;
if(uHasTexture==1)base*=texture(uBaseColorTexture,vUV);
if(length(vNormal)<1e-4&&uHasTexture==1){
vec3 unlit=base.rgb+vec3(uEmissive*0.35,uEmissive*0.5,uEmissive*0.7);
fragColor=vec4(unlit,base.a);
return;
}
vec3 N=length(vNormal)<1e-4?normalize(cross(dFdx(vWorldPos),dFdy(vWorldPos))):normalize(vNormal);
if(!gl_FrontFacing)N=-N;
vec3 V=normalize(uCameraPos-vWorldPos);
if(uHasNormalTexture==1){
N=perturbNormal(N,V,vUV,uNormalTexture,uNormalScale);
}

float metallic=uMetallic;
float roughness=uRoughness;
if(uHasMetallicRoughnessTexture==1){
vec4 mr=texture(uMetallicRoughnessTexture,vUV);
roughness*=mr.g;
metallic*=mr.b;
}
roughness=clamp(roughness,0.04,1.0);
metallic=clamp(metallic,0.0,1.0);

float occ=1.0;
if(uHasOcclusionTexture==1){
occ=mix(1.0,texture(uOcclusionTexture,vUV).r,uOcclusionStrength);
}

vec3 directLight=vec3(0.0);
for(int i=0;i<2;i++){
if(i>=uNumDirLights)break;
vec3 L=normalize(uDirLightDir[i]);
float NdotL=max(dot(N,L),0.0);
vec3 H=normalize(L+V);
float spec=pow(max(dot(N,H),0.0),mix(16.0,128.0,1.0-roughness))*metallic;
directLight+=(base.rgb*NdotL*0.75+vec3(spec))*uDirLightColor[i];
}
for(int i=0;i<2;i++){
if(i>=uNumPointLights)break;
vec3 toLight=uPointLightPos[i]-vWorldPos;
float dist=length(toLight);
vec3 L=toLight/max(dist,0.0001);
float atten=1.0/(1.0+0.09*dist+0.032*dist*dist);
float NdotL=max(dot(N,L),0.0);
vec3 H=normalize(L+V);
float spec=pow(max(dot(N,H),0.0),mix(16.0,128.0,1.0-roughness))*metallic;
directLight+=(base.rgb*NdotL*0.75+vec3(spec))*uPointLightColor[i]*atten;
}

vec3 R=reflect(-V,N);
float NoV=clamp(dot(N,V),0.001,1.0);
vec3 F0=mix(vec3(0.04),base.rgb,metallic);
vec3 F=F_SchlickRoughness(F0,roughness,NoV);
vec2 brdf=envBRDF(roughness,NoV);

vec3 specularIBL;
vec3 envDiffuse;
if(uHasEnvironmentMap==1){
specularIBL=texture(uEnvironmentMap,equirectangularUV(R)).rgb*(F*brdf.x+brdf.y);
envDiffuse=texture(uEnvironmentMap,equirectangularUV(N)).rgb;
}else{
specularIBL=getStudioRadiance(R,roughness)*(F*brdf.x+brdf.y);
envDiffuse=mix(vec3(0.10,0.10,0.12),vec3(0.52,0.54,0.58),N.y*0.5+0.5);
}

vec3 kD=(vec3(1.0)-F)*(1.0-metallic);
vec3 diffuseIBL=kD*base.rgb*(uAmbientColor+envDiffuse*0.5)*occ;
vec3 color=directLight+(diffuseIBL+specularIBL)*uEnvIntensity+vec3(uEmissive*0.35,uEmissive*0.5,uEmissive*0.7);
color=applyToneMapping(color,uToneMapping);
float outAlpha=base.a;
if(uXrDepthEnabled==1){
vec2 normViewUV=gl_FragCoord.xy/max(uViewportSize,vec2(1.0));
vec2 depthUV=(uXrDepthUVTransform*vec4(normViewUV,0.0,1.0)).xy;
vec4 depthSample=texture(uXrDepthTex,depthUV);
float realDepth=(uXrDepthFormat==1?depthSample.r:(depthSample.r+depthSample.a*256.0))*uXrRawValueToMeters;
float virtDepth=length(uCameraPos-vWorldPos);
if(realDepth>0.05&&virtDepth>realDepth){
float occAlpha=1.0-smoothstep(0.0,0.025,virtDepth-realDepth);
outAlpha*=occAlpha;
if(outAlpha<0.01)discard;
}
}
fragColor=vec4(color,outAlpha);
}`;

const VS_PICK = `#version 300 es
layout(location=0) in vec3 aPosition;
uniform mat4 uMVP;
void main(){gl_Position=uMVP*vec4(aPosition,1.0);}`;

const FS_PICK = `#version 300 es
precision highp float;
uniform vec4 uColorId;
out vec4 fragColor;
void main(){fragColor=uColorId;}`;

function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const err = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${err}`);
  }
  return shader;
}

function createProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
): WebGLProgram {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const err = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${err}`);
  }
  return prog;
}

function getUniforms<T extends string>(
  gl: WebGL2RenderingContext,
  prog: WebGLProgram,
  names: readonly T[],
): Record<T, WebGLUniformLocation | null> {
  const res = {} as Record<T, WebGLUniformLocation | null>;
  for (const n of names) {
    res[n] = gl.getUniformLocation(prog, n);
  }
  return res;
}

const RENDER_UNIFORMS = [
  'uMVP',
  'uModel',
  'uNormalMatrix',
  'uUvTransform',
  'uBaseColor',
  'uMetallic',
  'uRoughness',
  'uEmissive',
  'uCameraPos',
  'uBaseColorTexture',
  'uHasTexture',
  'uMetallicRoughnessTexture',
  'uHasMetallicRoughnessTexture',
  'uNormalTexture',
  'uHasNormalTexture',
  'uNormalScale',
  'uOcclusionTexture',
  'uHasOcclusionTexture',
  'uOcclusionStrength',
  'uToneMapping',
  'uEnvironmentMap',
  'uHasEnvironmentMap',
  'uAmbientColor',
  'uNumDirLights',
  'uDirLightDir',
  'uDirLightColor',
  'uNumPointLights',
  'uPointLightPos',
  'uPointLightColor',
  'uEnvIntensity',
  'uXrDepthTex',
  'uXrDepthEnabled',
  'uXrDepthFormat',
  'uXrRawValueToMeters',
  'uXrDepthUVTransform',
  'uViewportSize',
] as const;

interface PrimitiveGpu {
  vao: WebGLVertexArrayObject;
  indexCount: number;
  indexType: number;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  positions: Float32Array;
  indices: Uint16Array | Uint32Array | null;
  texture: WebGLTexture | null;
  metallicRoughnessTexture: WebGLTexture | null;
  normalTexture: WebGLTexture | null;
  occlusionTexture: WebGLTexture | null;
  normalScale: number;
  occlusionStrength: number;
  buffers: WebGLBuffer[];
  materialIndex?: number;
  pluginData?: Record<string, any>;
  customProgram?: WebGLProgram | null;
  customUniforms?: Record<string, WebGLUniformLocation | null> | null;
  isTransmissive?: boolean;
}

interface MeshGpu {
  name: string;
  nodeIndex: number;
  transform: Float32Array;
  normalMatrix: Float32Array;
  primitives: PrimitiveGpu[];
  extras?: Record<string, any>;
}

/**
 * Validates and normalizes a glTF `images[].uri` value before assigning it to
 * `HTMLImageElement.src` (audit finding WEB-09 / P1-1).
 *
 * Allows `https://`, `blob:`, safe raster `data:image/(png|jpeg|jpg|webp|ktx2|avif)`
 * URIs (rejecting `data:image/svg+xml` and `data:text/html`), and relative paths
 * without `..` traversal or protocol-relative `//` prefixes.
 */
export function sanitizeTextureUri(uri: string): string | null {
  if (typeof uri !== 'string') return null;
  const trimmed = uri.trim();
  if (!trimmed || /[\x00-\x1f\x7f]/.test(trimmed)) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('data:')) {
    if (/^data:image\/(png|jpeg|jpg|webp|ktx2|avif)(;|,)/i.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  if (lower.startsWith('https://') || lower.startsWith('blob:')) {
    return trimmed;
  }
  if (lower.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null;
  }
  if (/(^|[\\/])\.\.([\\/]|$)/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function bindBufferAttribute(
  gl: WebGL2RenderingContext,
  gltf: any,
  bin: ArrayBuffer,
  accIdx: number | undefined,
  loc: number,
  size: number,
  buffers: WebGLBuffer[],
): Float32Array | null {
  if (accIdx === undefined || !gltf.accessors?.[accIdx]) return null;
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const offset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const strideFloats =
    bv.byteStride && bv.byteStride > size * 4 ? bv.byteStride >> 2 : size;
  let data: Float32Array;
  if (strideFloats === size) {
    data = new Float32Array(bin, offset, acc.count * size);
  } else {
    data = new Float32Array(acc.count * size);
    const src = new Float32Array(
      bin,
      bv.byteOffset || 0,
      Math.floor(bv.byteLength / 4),
    );
    const startFloat = (acc.byteOffset || 0) >> 2;
    for (let i = 0; i < acc.count; i++) {
      const base = startFloat + i * strideFloats;
      for (let c = 0; c < size; c++) {
        data[i * size + c] = src[base + c];
      }
    }
  }
  const vbo = gl.createBuffer()!;
  buffers.push(vbo);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return data;
}

/**
 * Size ceilings applied by the host renderer before uploading a GLB to the GPU.
 *
 * Only models produced by the untrusted script sandbox are held to finite
 * ceilings; embedder-supplied `src` models are trusted to the same degree as
 * any other asset the page chooses to load, and real-world CAD or scanned
 * models routinely exceed the sandbox budget.
 */
export interface HostSceneLimits {
  readonly maxMeshes: number;
  readonly maxTextures: number;
  readonly maxVertices: number;
  readonly maxIndices: number;
}

/** Ceilings for GLBs returned by the script sandbox. */
export const SANDBOX_HOST_SCENE_LIMITS: HostSceneLimits = Object.freeze({
  maxMeshes: 1000,
  maxTextures: 64,
  maxVertices: 1_000_000,
  maxIndices: 3_000_000,
});

const UNBOUNDED_HOST_SCENE_LIMITS: HostSceneLimits = Object.freeze({
  maxMeshes: Infinity,
  maxTextures: Infinity,
  maxVertices: Infinity,
  maxIndices: Infinity,
});

function buildGpuScene(
  gl: WebGL2RenderingContext,
  data: GLBData,
  limits: HostSceneLimits = UNBOUNDED_HOST_SCENE_LIMITS,
  onTextureLoad?: () => void,
): {
  meshes: MeshGpu[];
  bounds: {
    center: [number, number, number];
    radius: number;
    min: [number, number, number];
    max: [number, number, number];
  };
  lights: LightGpu[];
  animations: AnimationClip[];
} {
  if (!data || !data.gltf) {
    throw new Error(
      'Invalid GLBData passed to buildGpuScene: missing gltf object.',
    );
  }
  const {gltf, bin} = data;
  const meshes: MeshGpu[] = [];

  // 1. Resolve node world transforms from glTF hierarchy
  const nodeWorldMatrices = resolveNodeWorldMatrices(gltf);

  // Find all nodes that instantiate a mesh
  const nodesWithMeshes: Array<{
    node: any;
    nodeIdx: number;
    meshIdx: number;
  }> = [];
  if (Array.isArray(gltf.nodes)) {
    for (let nIdx = 0; nIdx < gltf.nodes.length; nIdx++) {
      const node = gltf.nodes[nIdx];
      if (node.mesh !== undefined && gltf.meshes && gltf.meshes[node.mesh]) {
        nodesWithMeshes.push({node, nodeIdx: nIdx, meshIdx: node.mesh});
      }
    }
  }

  const itemsToBuild =
    nodesWithMeshes.length > 0
      ? nodesWithMeshes
      : (gltf.meshes || []).map((m: any, mIdx: number) => ({
          node: m,
          nodeIdx: -1,
          meshIdx: mIdx,
        }));

  // 2. Extract lights from data.lights or glTF KHR_lights_punctual
  const lights: LightGpu[] = [];
  if (Array.isArray(data.lights) && data.lights.length > 0) {
    lights.push(...data.lights);
  } else if (gltf.extensions?.KHR_lights_punctual?.lights) {
    const rawLights = gltf.extensions.KHR_lights_punctual.lights;
    for (const rl of rawLights) {
      const type =
        rl.type === 'directional'
          ? 'directional'
          : rl.type === 'point'
            ? 'point'
            : 'ambient';
      lights.push({
        type,
        color: rl.color || [1, 1, 1],
        intensity: rl.intensity !== undefined ? rl.intensity : 1.0,
      });
    }
  }

  // Default illumination if no lights specified
  if (lights.length === 0) {
    lights.push({type: 'ambient', color: [1, 1, 1], intensity: 0.35});
    lights.push({
      type: 'directional',
      color: [1, 1, 1],
      intensity: 0.85,
      direction: [0.5, 1.0, 0.8],
    });
  }

  if (itemsToBuild.length > limits.maxMeshes) {
    throw new Error(
      `SecurityError: GLB scene exceeds host mesh limit (${limits.maxMeshes}). Found: ${itemsToBuild.length}`,
    );
  }

  // Load Textures from glTF
  const gpuTextures: (WebGLTexture | null)[] = [];
  if (gltf.textures && gltf.images) {
    if (gltf.textures.length > limits.maxTextures) {
      throw new Error(
        `SecurityError: GLB scene exceeds host texture limit (${limits.maxTextures}). Found: ${gltf.textures.length}`,
      );
    }
    for (let tIdx = 0; tIdx < gltf.textures.length; tIdx++) {
      const texDef = gltf.textures[tIdx];
      const imgDef = gltf.images[texDef.source];
      if (imgDef) {
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        // Default 1x1 white texture while loading
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([255, 255, 255, 255]),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        if (imgDef.bufferView !== undefined) {
          const bv = gltf.bufferViews[imgDef.bufferView];
          const imgSlice = bin.slice(
            bv.byteOffset || 0,
            (bv.byteOffset || 0) + bv.byteLength,
          );
          const blob = new Blob([imgSlice], {
            type: imgDef.mimeType || 'image/png',
          });
          if (typeof createImageBitmap === 'function') {
            createImageBitmap(blob)
              .then((bmp) => {
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.texImage2D(
                  gl.TEXTURE_2D,
                  0,
                  gl.RGBA,
                  gl.RGBA,
                  gl.UNSIGNED_BYTE,
                  bmp,
                );
                gl.generateMipmap(gl.TEXTURE_2D);
                onTextureLoad?.();
              })
              .catch(() => {});
          }
        } else if (imgDef.uri) {
          const safeUri = sanitizeTextureUri(imgDef.uri);
          if (safeUri) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.referrerPolicy = 'no-referrer';
            img.onload = () => {
              gl.bindTexture(gl.TEXTURE_2D, tex);
              gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                img,
              );
              gl.generateMipmap(gl.TEXTURE_2D);
              onTextureLoad?.();
            };
            img.src = safeUri;
          } else {
            console.warn(
              '[Three-Live Security] Blocked unsafe glTF image URI:',
              imgDef.uri,
            );
          }
        }
        gpuTextures.push(tex);
      } else {
        gpuTextures.push(null);
      }
    }
  }

  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  let totalHostVertices = 0;
  let totalHostIndices = 0;

  for (let i = 0; i < itemsToBuild.length; i++) {
    const item = itemsToBuild[i];
    const m = gltf.meshes[item.meshIdx];
    const trans =
      item.nodeIdx >= 0 ? nodeWorldMatrices[item.nodeIdx] : mat4Create();
    const normMat = new Float32Array(9);
    mat3NormalFromMat4(normMat, trans);
    const meshGpu: MeshGpu = {
      name: item.node.name || m.name || `Mesh_${item.meshIdx}`,
      nodeIndex: item.nodeIdx,
      transform: trans,
      normalMatrix: normMat,
      primitives: [],
      extras: item.node.extras || m.extras,
    };

    for (const prim of m.primitives || []) {
      if (prim.extensions?.KHR_draco_mesh_compression) {
        const decoder = getDecoder('draco');
        if (decoder) {
          decoder.decodePrimitive(gltf, prim, bin);
        }
      }
      const buffers: WebGLBuffer[] = [];
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);

      // 1. POSITION (required)
      const posAcc = gltf.accessors[prim.attributes.POSITION];
      const primVertCount = Number(posAcc?.count ?? 0);
      if (
        !Number.isFinite(primVertCount) ||
        primVertCount < 0 ||
        totalHostVertices + primVertCount > limits.maxVertices
      ) {
        throw new Error(
          `SecurityError: GLB scene exceeds host vertex limit (${limits.maxVertices}).`,
        );
      }
      totalHostVertices += primVertCount;
      if (posAcc?.min && posAcc?.max) {
        for (let c = 0; c < 3; c++) {
          if (posAcc.min[c] < min[c]) min[c] = posAcc.min[c];
          if (posAcc.max[c] > max[c]) max[c] = posAcc.max[c];
        }
      }
      const posData = bindBufferAttribute(
        gl,
        gltf,
        bin,
        prim.attributes.POSITION,
        0,
        3,
        buffers,
      )!;

      // 2. NORMAL & TEXCOORD_0 (optional)
      bindBufferAttribute(gl, gltf, bin, prim.attributes.NORMAL, 1, 3, buffers);
      bindBufferAttribute(
        gl,
        gltf,
        bin,
        prim.attributes.TEXCOORD_0,
        2,
        2,
        buffers,
      );

      // 3. INDICES
      let indexCount = 0;
      let indexType = gl.UNSIGNED_SHORT;
      let idxDataRaw: Uint16Array | Uint32Array | null = null;
      if (prim.indices !== undefined) {
        const idxAcc = gltf.accessors[prim.indices];
        const idxBv = gltf.bufferViews[idxAcc.bufferView];
        const idxOffset = (idxBv.byteOffset || 0) + (idxAcc.byteOffset || 0);
        indexCount = Number(idxAcc.count ?? 0);
        if (
          !Number.isFinite(indexCount) ||
          indexCount < 0 ||
          totalHostIndices + indexCount > limits.maxIndices
        ) {
          throw new Error(
            `SecurityError: GLB scene exceeds host index limit (${limits.maxIndices}).`,
          );
        }
        totalHostIndices += indexCount;
        indexType =
          idxAcc.componentType === 5125
            ? gl.UNSIGNED_INT || 5125
            : gl.UNSIGNED_SHORT || 5123;

        const ibo = gl.createBuffer()!;
        buffers.push(ibo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        if (idxAcc.componentType === 5125) {
          idxDataRaw = new Uint32Array(bin, idxOffset, idxAcc.count);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxDataRaw, gl.STATIC_DRAW);
        } else {
          idxDataRaw = new Uint16Array(bin, idxOffset, idxAcc.count);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxDataRaw, gl.STATIC_DRAW);
        }
      } else {
        indexCount = posAcc.count;
      }

      const pluginData: Record<string, any> = {};
      for (const plugin of registeredPlugins) {
        if (plugin.onBuildPrimitiveVAO) {
          const res = plugin.onBuildPrimitiveVAO(gl, vao, prim, gltf, bin);
          if (res) pluginData[plugin.name] = res;
        }
      }

      gl.bindVertexArray(null);

      // 4. MATERIAL
      const mat =
        gltf.materials && prim.material !== undefined
          ? gltf.materials[prim.material]
          : null;

      let vsSource = VS_RENDER;
      let fsSource = FS_RENDER;
      let hasCustomShader = false;
      for (const plugin of registeredPlugins) {
        if (plugin.onResolveShader) {
          const shaders = plugin.onResolveShader(prim, mat, vsSource, fsSource);
          if (shaders) {
            vsSource = shaders.vs;
            fsSource = shaders.fs;
            hasCustomShader = true;
          }
        }
      }
      const customProgram = hasCustomShader
        ? createProgram(gl, vsSource, fsSource)
        : null;
      const customUniforms = customProgram
        ? getUniforms(gl, customProgram, RENDER_UNIFORMS)
        : null;

      const pbr = mat?.pbrMetallicRoughness;
      const baseColor: [number, number, number, number] =
        pbr?.baseColorFactor || [0.8, 0.8, 0.8, 1.0];
      const metallic = pbr?.metallicFactor ?? 0.1;
      const roughness = pbr?.roughnessFactor ?? 0.5;
      const texture =
        pbr?.baseColorTexture !== undefined &&
        gpuTextures[pbr.baseColorTexture.index]
          ? gpuTextures[pbr.baseColorTexture.index]
          : null;
      const metallicRoughnessTexture =
        pbr?.metallicRoughnessTexture !== undefined &&
        gpuTextures[pbr.metallicRoughnessTexture.index]
          ? gpuTextures[pbr.metallicRoughnessTexture.index]
          : null;
      const normalTexture =
        mat?.normalTexture !== undefined && gpuTextures[mat.normalTexture.index]
          ? gpuTextures[mat.normalTexture.index]
          : null;
      const normalScale = mat?.normalTexture?.scale ?? 1.0;
      const occlusionTexture =
        mat?.occlusionTexture !== undefined &&
        gpuTextures[mat.occlusionTexture.index]
          ? gpuTextures[mat.occlusionTexture.index]
          : null;
      const occlusionStrength = mat?.occlusionTexture?.strength ?? 1.0;

      const isTransmissive = Boolean(
        mat?.extensions?.KHR_materials_transmission ||
          pluginData.materials?.isTransmissive,
      );

      meshGpu.primitives.push({
        vao,
        indexCount,
        indexType,
        baseColor,
        metallic,
        roughness,
        positions: posData,
        indices: idxDataRaw,
        texture,
        metallicRoughnessTexture,
        normalTexture,
        occlusionTexture,
        normalScale,
        occlusionStrength,
        buffers,
        materialIndex: prim.material,
        pluginData,
        customProgram,
        customUniforms,
        isTransmissive,
      });
    }

    meshes.push(meshGpu);
  }

  if (!isFinite(min[0])) min = [-1, -1, -1];
  if (!isFinite(max[0])) max = [1, 1, 1];
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const dx = max[0] - min[0];
  const dy = max[1] - min[1];
  const dz = max[2] - min[2];
  const radius = Math.max(Math.hypot(dx, dy, dz) / 2, 0.5);
  const minCoord: [number, number, number] = [min[0], min[1], min[2]];
  const maxCoord: [number, number, number] = [max[0], max[1], max[2]];
  let animations = data.animations;
  if (!animations) {
    for (const plugin of registeredPlugins) {
      plugin.onParseGLB?.(data);
      if (data.animations) {
        animations = data.animations;
        break;
      }
    }
  }
  if (!animations) animations = [];

  return {
    meshes,
    bounds: {center, radius, min: minCoord, max: maxCoord},
    lights,
    animations,
    worldMatrices: nodeWorldMatrices,
  };
}

// =========================================================================
// 4. Arcball Interaction & GPU Color-ID MicroViewer
// =========================================================================

export class ThreeView {
  public gl: WebGL2RenderingContext;
  public canvas: HTMLCanvasElement;
  public container: HTMLElement;
  public opts: ViewOptions;
  public renderProg!: WebGLProgram;
  private pickProg!: WebGLProgram;
  private uRender!: Record<string, WebGLUniformLocation | null>;
  private uPick!: Record<string, WebGLUniformLocation | null>;
  public meshes: MeshGpu[] = [];
  public backdropMeshes: MeshGpu[] = [];
  public bounds: any = {
    center: [0, 0, 0] as [number, number, number],
    radius: 1,
    min: [-1, -1, -1] as [number, number, number],
    max: [1, 1, 1] as [number, number, number],
  };
  public lights: LightGpu[] = [];
  public modelRootMatrix = mat4Create();
  private clearColor: [number, number, number, number] = [0, 0, 0, 0];
  private envIntensity = 1.0;
  public shadowIntensity = 0.0;
  public shadowSoftness = 0.5;
  private toneMapping: 'neutral' | 'reinhard' | 'none' = 'neutral';
  public environmentTexture: WebGLTexture | null = null;
  public animations: AnimationClip[] = [];
  public currentClip: AnimationClip | null = null;
  public animationTime = 0.0;
  public isPlayingAnimation = false;
  public autoplay = false;
  public animationName = '';
  public gltf: any = null;
  public worldMatrices: Float32Array[] = [];
  public initialNodeTransforms: Array<{
    t: [number, number, number];
    r: [number, number, number, number];
    s: [number, number, number];
  }> = [];

  public static registerPlugin = registerPlugin;
  public static getRegisteredPlugins = getRegisteredPlugins;

  private projMatrix = mat4Create();
  private viewMatrix = mat4Create();
  private modelMatrix = mat4Create();
  private mvpMatrix = mat4Create();
  private normalMatrix = new Float32Array(9);

  // Baseline initial camera state (remembered for resetCamera)
  private initialTheta = 0.6;
  private initialPhi = 0.35;
  private initialDistance: number | null = null;
  private customDistance = false;
  private initialCustomTarget: [number, number, number] | null = null;

  // Active camera state
  private customTarget: [number, number, number] | null = null;
  private fov = Math.PI / 4;
  private minTheta = -Infinity;
  private maxTheta = Infinity;
  private minPhi = -Math.PI * 0.48;
  private maxPhi = Math.PI * 0.48;
  private minDistanceLimit: number | null = null;
  private maxDistanceLimit: number | null = null;
  private activePointers = new Map<number, {x: number; y: number}>();
  private isPanning = false;

  private targetTheta = 0.6;
  private currTheta = 0.6;
  private targetPhi = 0.35;
  private currPhi = 0.35;
  private targetDistance = 3.0;
  private currDistance = 3.0;
  private autoRotate = false;
  private autoRotateSpeed = Math.PI / 6;
  private autoRotateDelay = 3000;
  private lastInteractionTime = -Infinity;
  public turntableRotation = 0;

  private isPointerDown = false;
  private interactive = true;
  public skyboxTexture: WebGLTexture | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private totalDragDist = 0;

  // Selected mesh name for visual highlight
  private selectedMeshName = '';

  private pickFbo: WebGLFramebuffer | null = null;
  private pickTexture: WebGLTexture | null = null;
  private pickDepth: WebGLRenderbuffer | null = null;
  private pickFboWidth = 0;
  private pickFboHeight = 0;

  private animFrameId: number | null = null;
  private isVisible = true;
  private lastTime = 0;
  private lastReportedTheta = -999;
  private lastReportedPhi = -999;
  private lastReportedZoom = -999;

  public static registerDecoder(type: string, decoder: MeshDecoder): void {
    registerDecoder(type, decoder);
  }

  public static getDecoder(type: string): MeshDecoder | undefined {
    return getDecoder(type);
  }

  private boundPointerDown: ((e: PointerEvent) => void) | null = null;
  private boundPointerMove: ((e: PointerEvent) => void) | null = null;
  private boundPointerUp: ((e: PointerEvent) => void) | null = null;
  private boundWheel: ((e: WheelEvent) => void) | null = null;
  private boundKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private boundContextMenu: ((e: MouseEvent) => void) | null = null;
  private boundSetCamera: ((e: any) => void) | null = null;
  private boundResetCamera: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    canvasOrOpts?: HTMLCanvasElement | ViewOptions,
    maybeOpts?: ViewOptions,
  ) {
    this.container = container;
    let canvas: HTMLCanvasElement | undefined;
    let opts: ViewOptions | undefined;

    if (
      canvasOrOpts &&
      typeof (canvasOrOpts as any).getContext === 'function'
    ) {
      canvas = canvasOrOpts as HTMLCanvasElement;
      opts = maybeOpts;
    } else {
      opts = canvasOrOpts as ViewOptions | undefined;
      canvas = opts?.canvas;
    }

    if (!canvas) {
      let existing = container.querySelector<HTMLCanvasElement>('canvas');
      if (!existing) {
        existing = document.createElement('canvas');
        existing.style.width = '100%';
        existing.style.height = '100%';
        existing.style.display = 'block';
        existing.style.touchAction = 'none';
        container.prepend(existing);
      }
      canvas = existing;
    }

    this.canvas = canvas;
    this.opts = opts || {};
    if (this.opts.clearColor) {
      this.clearColor = this.opts.clearColor;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (this.opts.autoRotate !== undefined) {
      this.autoRotate = this.opts.autoRotate && !prefersReducedMotion;
    } else if (prefersReducedMotion) {
      this.autoRotate = false;
    }
    if (this.opts.autoRotateSpeed !== undefined) {
      this.autoRotateSpeed = this.opts.autoRotateSpeed;
    }
    if (this.opts.autoRotateDelay !== undefined) {
      this.autoRotateDelay = Math.max(
        0,
        Number(this.opts.autoRotateDelay) || 0,
      );
    }
    if (this.opts.exposure !== undefined) {
      this.envIntensity = Math.max(0, Number(this.opts.exposure));
    }
    if (this.opts.camera) {
      this.setInitialCamera(
        this.opts.camera.theta,
        this.opts.camera.phi,
        this.opts.camera.distance,
        this.opts.camera.zoom,
      );
    }
    if (this.opts.shadowIntensity !== undefined) {
      this.shadowIntensity = Math.max(
        0,
        Math.min(1, Number(this.opts.shadowIntensity) || 0),
      );
    }
    if (this.opts.shadowSoftness !== undefined) {
      this.shadowSoftness = Math.max(
        0,
        Math.min(1, Number(this.opts.shadowSoftness) || 0),
      );
    }
    if (this.opts.toneMapping !== undefined) {
      this.toneMapping = this.opts.toneMapping;
    }
    if (this.opts.autoplay !== undefined) {
      this.autoplay = this.opts.autoplay;
    }
    if (this.opts.animationName !== undefined) {
      this.animationName = this.opts.animationName;
    }
    if (this.opts.fieldOfView !== undefined) {
      this.fov = (this.opts.fieldOfView * Math.PI) / 180;
    }
    if (this.opts.cameraTarget !== undefined) {
      this.setTarget(
        this.opts.cameraTarget[0],
        this.opts.cameraTarget[1],
        this.opts.cameraTarget[2],
      );
      this.initialCustomTarget = [...this.opts.cameraTarget];
    }
    if (this.opts.minCameraOrbit || this.opts.maxCameraOrbit) {
      this.setOrbitLimits({
        minTheta: this.opts.minCameraOrbit?.theta,
        maxTheta: this.opts.maxCameraOrbit?.theta,
        minPhi: this.opts.minCameraOrbit?.phi,
        maxPhi: this.opts.maxCameraOrbit?.phi,
        minDistance: this.opts.minCameraOrbit?.distance,
        maxDistance: this.opts.maxCameraOrbit?.distance,
      });
    }

    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      xrCompatible: true,
    } as WebGLContextAttributes);
    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this.gl = gl;
    this.renderProg = createProgram(gl, VS_RENDER, FS_RENDER);
    this.pickProg = createProgram(gl, VS_PICK, FS_PICK);
    this.uRender = getUniforms(gl, this.renderProg, RENDER_UNIFORMS);
    this.uPick = getUniforms(gl, this.pickProg, ['uMVP', 'uColorId']);

    this.setupPickingFbo();
    this.setupEvents();

    if (this.opts.environmentImage) {
      this.setEnvironmentImage(this.opts.environmentImage).catch(() => {});
    }

    if (
      typeof requestAnimationFrame !== 'undefined' &&
      this.opts.autoStart !== false
    ) {
      this.start();
    }
  }

  private setupPickingFbo(): void {
    const gl = this.gl;
    if (typeof gl.createFramebuffer !== 'function') return;
    this.pickFbo = gl.createFramebuffer();
    this.pickTexture = gl.createTexture();
    this.pickDepth = gl.createRenderbuffer();

    const w = Math.max(1, this.canvas.width);
    const h = Math.max(1, this.canvas.height);
    this.pickFboWidth = w;
    this.pickFboHeight = h;

    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.pickTexture,
      0,
    );
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_ATTACHMENT,
      gl.RENDERBUFFER,
      this.pickDepth,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private resizePickingFbo(width: number, height: number): void {
    if (!this.pickFbo) return;
    const gl = this.gl;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    this.pickFboWidth = w;
    this.pickFboHeight = h;
    gl.bindTexture(gl.TEXTURE_2D, this.pickTexture);
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
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
  }

  /**
   * Explicit, zero-copy loader for in-memory AST representations (GLBData).
   *
   * Pass `limits` (e.g. `SANDBOX_HOST_SCENE_LIMITS`) when the model comes from
   * an untrusted source such as the script sandbox.
   */
  loadGLBData(glbData: GLBData, limits?: HostSceneLimits): void {
    const {meshes, bounds, lights, animations, worldMatrices} = buildGpuScene(
      this.gl,
      glbData,
      limits,
      () => this.render(),
    );
    this.disposeMeshGpuResources();
    this.meshes = meshes;
    this.bounds = bounds;
    this.turntableRotation = 0;
    this.updateTurntableMatrix();
    this.lights = lights;
    this.animations = animations || [];
    this.worldMatrices = worldMatrices || [];
    this.gltf = glbData.gltf;

    this.initialNodeTransforms = [];
    if (Array.isArray(glbData.gltf?.nodes)) {
      for (const n of glbData.gltf.nodes) {
        this.initialNodeTransforms.push({
          t: n.translation
            ? [n.translation[0], n.translation[1], n.translation[2]]
            : [0, 0, 0],
          r: n.rotation
            ? [n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]]
            : [0, 0, 0, 1],
          s: n.scale ? [n.scale[0], n.scale[1], n.scale[2]] : [1, 1, 1],
        });
      }
    }

    if (this.autoplay && this.animations.length > 0) {
      this.playAnimation(this.animationName || undefined);
    }

    for (const plugin of registeredPlugins) {
      plugin.onLoadModel?.(this, this.gltf);
    }

    if (!this.customDistance) {
      this.initialDistance = bounds.radius * 2.5;
      this.targetDistance = this.initialDistance;
      this.currDistance = this.initialDistance;
    }

    const glbExposure =
      glbData.exposure ??
      glbData.environmentIntensity ??
      glbData.gltf?.extras?.exposure ??
      glbData.gltf?.extras?.environmentIntensity ??
      glbData.gltf?.asset?.extras?.exposure ??
      glbData.gltf?.asset?.extras?.environmentIntensity;
    if (glbExposure !== undefined) {
      this.envIntensity = Math.max(0, Number(glbExposure));
    }

    if (
      this.container &&
      typeof this.container.hasAttribute === 'function' &&
      this.container.hasAttribute('poster')
    ) {
      this.container.removeAttribute('poster');
    }

    // Immediately trigger layout sync, camera update, and first frame paint
    this.resize();
    this.update(0);
    this.render();

    if (
      this.animFrameId === null &&
      typeof requestAnimationFrame !== 'undefined' &&
      this.opts.autoStart !== false
    ) {
      this.start();
    }
  }

  /**
   * Explicit loader for binary glTF 2.0 containers (.glb ArrayBuffer or ArrayBufferView).
   */
  public loadGLB(buffer: ArrayBuffer | ArrayBufferView): void {
    this.loadGLBData(parseGLB(buffer));
  }

  /**
   * Canonical polymorphic entry point normalizing GLBData or binary buffer.
   */
  public loadModel(data: GLBData | ArrayBuffer | ArrayBufferView): void {
    this.loadGLBData(toGLBData(data));
  }

  /**
   * Loads an optional room/environment GLB backdrop that renders behind/around
   * the foreground `meshes` without altering `bounds` (camera framing) or exports.
   */
  public setBackdropGLB(
    data: GLBData | ArrayBuffer | ArrayBufferView | null,
    offset?: [number, number, number],
  ): void {
    this.disposeMeshListGpuResources(this.backdropMeshes);
    this.backdropMeshes = [];
    if (!data) {
      this.update(0);
      this.render();
      return;
    }
    const glbData = toGLBData(data);
    const {meshes} = buildGpuScene(
      this.gl,
      glbData,
      UNBOUNDED_HOST_SCENE_LIMITS,
      () => this.render(),
    );
    if (offset) {
      for (const m of meshes) {
        m.transform[12] += offset[0];
        m.transform[13] += offset[1];
        m.transform[14] += offset[2];
        mat3NormalFromMat4(m.normalMatrix, m.transform);
      }
    }
    this.backdropMeshes = meshes;
    this.update(0);
    this.render();
  }

  public setClearColor(r: number, g: number, b: number, a: number = 1.0): void {
    this.clearColor = [r, g, b, a];
  }

  public updateMeshTransforms(
    transforms:
      | Map<string | number, Float32Array>
      | Record<string | number, Float32Array>
      | Array<number[] | Float32Array>,
  ): void {
    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      let t: Float32Array | number[] | undefined;
      if (transforms instanceof Map) {
        t = transforms.get(m.name) ?? transforms.get(i);
      } else if (Array.isArray(transforms)) {
        t = transforms[i];
      } else if (transforms && typeof transforms === 'object') {
        if (Object.prototype.hasOwnProperty.call(transforms, m.name)) {
          t = (transforms as Record<string, Float32Array | number[]>)[m.name];
        } else if (Object.prototype.hasOwnProperty.call(transforms, i)) {
          t = (transforms as Record<number, Float32Array | number[]>)[i];
        }
      }
      if (t && t.length === 16) {
        m.transform.set(t);
        mat3NormalFromMat4(m.normalMatrix, m.transform);
      }
    }
  }

  private bindLights(
    u: Record<string, WebGLUniformLocation | null> = this.uRender,
  ): void {
    const gl = this.gl;
    let amb = [0.28, 0.28, 0.28];
    const dirDirs: number[] = [];
    const dirCols: number[] = [];
    const ptPositions: number[] = [];
    const ptCols: number[] = [];

    for (const l of this.lights) {
      const col = l.color || [1, 1, 1];
      const intensity = l.intensity !== undefined ? l.intensity : 1.0;
      if (l.type === 'ambient') {
        amb = [col[0] * intensity, col[1] * intensity, col[2] * intensity];
      } else if (l.type === 'directional' && dirDirs.length < 6) {
        const d = l.direction || [0.5, 1.0, 0.8];
        dirDirs.push(d[0], d[1], d[2]);
        dirCols.push(
          col[0] * intensity,
          col[1] * intensity,
          col[2] * intensity,
        );
      } else if (l.type === 'point' && ptPositions.length < 6) {
        const p = l.position || [0, 0, 0];
        ptPositions.push(p[0], p[1], p[2]);
        ptCols.push(col[0] * intensity, col[1] * intensity, col[2] * intensity);
      }
    }

    if (dirDirs.length === 0) {
      dirDirs.push(0.5, 1.0, 0.8);
      dirCols.push(1.0, 1.0, 1.0);
    }

    gl.uniform3fv(u.uAmbientColor, amb);
    gl.uniform1i(u.uNumDirLights, dirDirs.length / 3);
    if (dirDirs.length > 0) {
      gl.uniform3fv(u.uDirLightDir, dirDirs);
      gl.uniform3fv(u.uDirLightColor, dirCols);
    }
    gl.uniform1i(u.uNumPointLights, ptPositions.length / 3);
    if (ptPositions.length > 0) {
      gl.uniform3fv(u.uPointLightPos, ptPositions);
      gl.uniform3fv(u.uPointLightColor, ptCols);
    }
    gl.uniform1f(u.uEnvIntensity, this.envIntensity);
  }

  public setExposure(exposure: number): void {
    this.envIntensity = Math.max(0, Number(exposure));
  }

  public getExposure(): number {
    return this.envIntensity;
  }

  public setShadow(intensity: number, softness?: number): void {
    this.shadowIntensity = Math.max(0, Math.min(1, Number(intensity) || 0));
    if (softness !== undefined) {
      this.shadowSoftness = Math.max(0, Math.min(1, Number(softness) || 0));
    }
  }

  public getShadowIntensity(): number {
    return this.shadowIntensity;
  }

  public getShadowSoftness(): number {
    return this.shadowSoftness;
  }

  public setToneMapping(mode: 'neutral' | 'reinhard' | 'none'): void {
    this.toneMapping = mode;
  }

  public getToneMapping(): 'neutral' | 'reinhard' | 'none' {
    return this.toneMapping;
  }

  public async setEnvironmentImage(
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ): Promise<void> {
    for (const plugin of registeredPlugins) {
      if ((plugin as any).setEnvironmentImage) {
        await (plugin as any).setEnvironmentImage(this, imageOrUrl);
        return;
      }
    }
  }

  public async setSkyboxImage(
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ): Promise<void> {
    for (const plugin of registeredPlugins) {
      if ((plugin as any).setSkyboxImage) {
        await (plugin as any).setSkyboxImage(this, imageOrUrl);
        return;
      }
    }
  }

  public setInteractive(interactive: boolean): void {
    this.interactive = interactive;
  }

  public isInteractive(): boolean {
    return this.interactive;
  }

  public getCameraOrbit(): {
    theta: number;
    phi: number;
    radius: number;
    toString(): string;
  } {
    const theta = this.currTheta;
    const phi = this.currPhi;
    const radius = this.currDistance;
    return {
      theta,
      phi,
      radius,
      toString() {
        return `${theta.toFixed(4)}rad ${phi.toFixed(4)}rad ${radius.toFixed(4)}m`;
      },
    };
  }

  public getCameraTarget(): {
    x: number;
    y: number;
    z: number;
    toString(): string;
  } {
    const c = this.customTarget || this.bounds.center;
    return {
      x: c[0],
      y: c[1],
      z: c[2],
      toString() {
        return `${c[0].toFixed(4)}m ${c[1].toFixed(4)}m ${c[2].toFixed(4)}m`;
      },
    };
  }

  public jumpCameraToGoal(): void {
    this.currTheta = this.targetTheta;
    this.currPhi = this.targetPhi;
    this.currDistance = this.targetDistance;
    this.update(0);
    this.render();
  }

  public getModelMaterials(): Array<{
    name: string;
    pbrMetallicRoughness: {
      baseColorFactor: [number, number, number, number];
      metallicFactor: number;
      roughnessFactor: number;
      setBaseColorFactor: (rgba: [number, number, number, number]) => void;
      setMetallicFactor: (val: number) => void;
      setRoughnessFactor: (val: number) => void;
    };
  }> {
    const rawMats = this.gltf?.materials?.length
      ? this.gltf.materials
      : [{name: 'DefaultMaterial', pbrMetallicRoughness: {}}];
    return rawMats.map((gMat: any, idx: number) => {
      const matchingPrims = this.meshes.flatMap((m) =>
        m.primitives.filter(
          (p) =>
            p.materialIndex === idx ||
            (rawMats.length === 1 && p.materialIndex === undefined),
        ),
      );
      const firstPrim = matchingPrims[0];
      const baseColorFactor: [number, number, number, number] = firstPrim
        ? [...firstPrim.baseColor]
        : gMat.pbrMetallicRoughness?.baseColorFactor || [0.8, 0.8, 0.8, 1.0];
      const metallicFactor = firstPrim
        ? firstPrim.metallic
        : (gMat.pbrMetallicRoughness?.metallicFactor ?? 0.1);
      const roughnessFactor = firstPrim
        ? firstPrim.roughness
        : (gMat.pbrMetallicRoughness?.roughnessFactor ?? 0.5);

      const pbrProxy = {
        baseColorFactor,
        metallicFactor,
        roughnessFactor,
        setBaseColorFactor: (rgba: [number, number, number, number]) => {
          const next: [number, number, number, number] = [
            rgba[0],
            rgba[1],
            rgba[2],
            rgba[3] ?? 1.0,
          ];
          pbrProxy.baseColorFactor = next;
          if (gMat.pbrMetallicRoughness) {
            gMat.pbrMetallicRoughness.baseColorFactor = next;
          }
          for (const p of matchingPrims) {
            p.baseColor = next;
          }
          this.render();
        },
        setMetallicFactor: (val: number) => {
          pbrProxy.metallicFactor = val;
          if (gMat.pbrMetallicRoughness) {
            gMat.pbrMetallicRoughness.metallicFactor = val;
          }
          for (const p of matchingPrims) {
            p.metallic = val;
          }
          this.render();
        },
        setRoughnessFactor: (val: number) => {
          pbrProxy.roughnessFactor = val;
          if (gMat.pbrMetallicRoughness) {
            gMat.pbrMetallicRoughness.roughnessFactor = val;
          }
          for (const p of matchingPrims) {
            p.roughness = val;
          }
          this.render();
        },
      };

      return {
        name: gMat.name || `Material_${idx}`,
        pbrMetallicRoughness: pbrProxy,
      };
    });
  }

  public playAnimation(name?: string): void {
    if (this.animations.length === 0) return;
    if (name) {
      const found = this.animations.find((a) => a.name === name);
      if (found) {
        this.currentClip = found;
      }
    } else if (!this.currentClip) {
      this.currentClip = this.animations[0];
    }
    this.isPlayingAnimation = true;
  }

  public pauseAnimation(): void {
    this.isPlayingAnimation = false;
  }

  public getAvailableAnimations(): string[] {
    return this.animations.map((a) => a.name);
  }

  public setAutoplay(autoplay: boolean): void {
    this.autoplay = autoplay;
    if (autoplay) {
      this.playAnimation(this.animationName || undefined);
    } else {
      this.pauseAnimation();
    }
  }

  public setAnimationName(name: string): void {
    this.animationName = name;
    if (this.isPlayingAnimation || this.autoplay) {
      this.playAnimation(name);
    }
  }

  public evaluateAnimation(t: number): void {
    for (const plugin of registeredPlugins) {
      if ((plugin as any).evaluateAnimation) {
        (plugin as any).evaluateAnimation(this, t);
        return;
      }
    }
  }

  public setTarget(x: number, y: number, z: number): void {
    this.customTarget = [x, y, z];
    if (this.gl && (this.meshes.length > 0 || this.backdropMeshes.length > 0)) {
      this.update(0);
      this.render();
    }
  }

  public getTarget(): [number, number, number] | null {
    return this.customTarget ? [...this.customTarget] : null;
  }

  public setFieldOfView(fovDeg: number): void {
    const clamped = Math.max(10, Math.min(90, fovDeg));
    this.fov = (clamped * Math.PI) / 180;
  }

  public getFieldOfView(): number {
    return (this.fov * 180) / Math.PI;
  }

  public setOrbitLimits(limits: OrbitLimits): void {
    if (limits.minTheta !== undefined) {
      this.minTheta = (limits.minTheta * Math.PI) / 180;
    }
    if (limits.maxTheta !== undefined) {
      this.maxTheta = (limits.maxTheta * Math.PI) / 180;
    }
    if (limits.minPhi !== undefined) {
      this.minPhi = Math.max(-Math.PI * 0.48, (limits.minPhi * Math.PI) / 180);
    }
    if (limits.maxPhi !== undefined) {
      this.maxPhi = Math.min(Math.PI * 0.48, (limits.maxPhi * Math.PI) / 180);
    }
    if (limits.minDistance !== undefined) {
      this.minDistanceLimit = limits.minDistance;
    }
    if (limits.maxDistance !== undefined) {
      this.maxDistanceLimit = limits.maxDistance;
    }
    this.targetTheta = this.clampTheta(this.targetTheta);
    this.targetPhi = this.clampPhi(this.targetPhi);
    this.targetDistance = this.clampDistance(this.targetDistance);
  }

  public getOrbitLimits(): OrbitLimits {
    return {
      minTheta: isFinite(this.minTheta)
        ? (this.minTheta * 180) / Math.PI
        : undefined,
      maxTheta: isFinite(this.maxTheta)
        ? (this.maxTheta * 180) / Math.PI
        : undefined,
      minPhi: (this.minPhi * 180) / Math.PI,
      maxPhi: (this.maxPhi * 180) / Math.PI,
      minDistance:
        this.minDistanceLimit !== null ? this.minDistanceLimit : undefined,
      maxDistance:
        this.maxDistanceLimit !== null ? this.maxDistanceLimit : undefined,
    };
  }

  private clampTheta(theta: number): number {
    return Math.max(this.minTheta, Math.min(this.maxTheta, theta));
  }

  private clampPhi(phi: number): number {
    return Math.max(this.minPhi, Math.min(this.maxPhi, phi));
  }

  private clampDistance(distance: number): number {
    const minDist =
      this.minDistanceLimit !== null
        ? this.minDistanceLimit
        : this.bounds
          ? this.bounds.radius * 0.5
          : 0.1;
    const maxDist =
      this.maxDistanceLimit !== null
        ? this.maxDistanceLimit
        : this.bounds
          ? this.bounds.radius * 8.0
          : 100;
    return Math.max(minDist, Math.min(maxDist, distance));
  }

  public setCamera(
    thetaDeg?: number,
    phiDeg?: number,
    distance?: number,
    zoom?: number,
  ): void {
    if (thetaDeg !== undefined) {
      this.targetTheta = this.clampTheta((thetaDeg * Math.PI) / 180);
    }
    if (phiDeg !== undefined) {
      this.targetPhi = this.clampPhi((phiDeg * Math.PI) / 180);
    }
    if (distance !== undefined && distance > 0) {
      this.targetDistance = this.clampDistance(distance);
    }
    if (zoom !== undefined && zoom > 0) {
      this.targetDistance = this.clampDistance(
        (this.bounds.radius * 2.5) / zoom,
      );
    }
  }

  public setInitialCamera(
    thetaDeg?: number,
    phiDeg?: number,
    distance?: number,
    zoom?: number,
  ): void {
    if (thetaDeg !== undefined) {
      this.initialTheta = this.clampTheta((thetaDeg * Math.PI) / 180);
      this.targetTheta = this.initialTheta;
      this.currTheta = this.initialTheta;
    }
    if (phiDeg !== undefined) {
      this.initialPhi = this.clampPhi((phiDeg * Math.PI) / 180);
      this.targetPhi = this.initialPhi;
      this.currPhi = this.initialPhi;
    }
    if (distance !== undefined && distance > 0) {
      const d = this.clampDistance(distance);
      this.initialDistance = d;
      this.customDistance = true;
      this.targetDistance = d;
      this.currDistance = d;
    } else if (zoom !== undefined && zoom > 0) {
      const d = this.clampDistance((this.bounds.radius * 2.5) / zoom);
      this.initialDistance = d;
      this.customDistance = true;
      this.targetDistance = d;
      this.currDistance = d;
    }
    if (this.gl && (this.meshes.length > 0 || this.backdropMeshes.length > 0)) {
      this.update(0);
      this.render();
    }
  }

  public resetCamera(): void {
    this.targetTheta = this.clampTheta(this.initialTheta);
    this.targetPhi = this.clampPhi(this.initialPhi);
    if (this.initialDistance !== null) {
      this.targetDistance = this.clampDistance(this.initialDistance);
    } else {
      this.targetDistance = this.clampDistance(this.bounds.radius * 2.5);
    }
    if (this.initialCustomTarget) {
      this.customTarget = [...this.initialCustomTarget];
    } else {
      this.customTarget = null;
    }
    this.turntableRotation = 0;
    this.updateTurntableMatrix();
  }

  public projectPointToScreen(
    worldPos: [number, number, number],
    normal?: [number, number, number],
  ): {x: number; y: number; z: number; visible: boolean} {
    const vp = mat4Create();
    mat4Multiply(vp, this.projMatrix, this.viewMatrix);

    let [wx, wy, wz] = worldPos;
    let nx = normal ? normal[0] : 0;
    let ny = normal ? normal[1] : 0;
    let nz = normal ? normal[2] : 0;
    const rm = this.modelRootMatrix;
    if (rm) {
      wx =
        rm[0] * worldPos[0] +
        rm[4] * worldPos[1] +
        rm[8] * worldPos[2] +
        rm[12];
      wy =
        rm[1] * worldPos[0] +
        rm[5] * worldPos[1] +
        rm[9] * worldPos[2] +
        rm[13];
      wz =
        rm[2] * worldPos[0] +
        rm[6] * worldPos[1] +
        rm[10] * worldPos[2] +
        rm[14];
      if (normal) {
        nx = rm[0] * normal[0] + rm[4] * normal[1] + rm[8] * normal[2];
        ny = rm[1] * normal[0] + rm[5] * normal[1] + rm[9] * normal[2];
        nz = rm[2] * normal[0] + rm[6] * normal[1] + rm[10] * normal[2];
      }
    }
    const clipX = vp[0] * wx + vp[4] * wy + vp[8] * wz + vp[12];
    const clipY = vp[1] * wx + vp[5] * wy + vp[9] * wz + vp[13];
    const clipZ = vp[2] * wx + vp[6] * wy + vp[10] * wz + vp[14];
    const clipW = vp[3] * wx + vp[7] * wy + vp[11] * wz + vp[15];

    if (clipW <= 0.0001) {
      return {x: 0, y: 0, z: 1, visible: false};
    }

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;

    const rect = this.canvas.getBoundingClientRect();
    const width =
      rect.width || this.canvas.clientWidth || this.canvas.width || 300;
    const height =
      rect.height || this.canvas.clientHeight || this.canvas.height || 150;

    const screenX = (ndcX * 0.5 + 0.5) * width;
    const screenY = (-ndcY * 0.5 + 0.5) * height;

    let visible =
      ndcX >= -1.1 &&
      ndcX <= 1.1 &&
      ndcY >= -1.1 &&
      ndcY <= 1.1 &&
      ndcZ >= -1.0 &&
      ndcZ <= 1.0;

    if (visible && normal) {
      const c = this.customTarget || this.bounds.center;
      const eyeX =
        c[0] +
        this.currDistance * Math.cos(this.currPhi) * Math.sin(this.currTheta);
      const eyeY = c[1] + this.currDistance * Math.sin(this.currPhi);
      const eyeZ =
        c[2] +
        this.currDistance * Math.cos(this.currPhi) * Math.cos(this.currTheta);

      const eyeToPoint = [wx - eyeX, wy - eyeY, wz - eyeZ];
      const dot =
        nx * eyeToPoint[0] + ny * eyeToPoint[1] + nz * eyeToPoint[2];
      if (dot > 0.05) {
        visible = false;
      }
    }

    return {x: screenX, y: screenY, z: ndcZ, visible};
  }

  public setSelectedMesh(meshName: string): void {
    this.selectedMeshName = meshName || '';
  }

  private setupEvents(): void {
    const c = this.canvas;

    this.boundContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    c.addEventListener('contextmenu', this.boundContextMenu);

    this.boundPointerDown = (e: PointerEvent) => {
      if (!this.interactive) return;
      this.isPointerDown = true;
      this.lastInteractionTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.totalDragDist = 0;
      this.activePointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      this.isPanning =
        e.button === 2 || e.shiftKey || this.activePointers.size === 2;
      c.setPointerCapture(e.pointerId);
    };
    c.addEventListener('pointerdown', this.boundPointerDown);

    this.boundPointerMove = (e: PointerEvent) => {
      if (!this.isPointerDown || !this.interactive) return;
      this.lastInteractionTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const prev = this.activePointers.get(e.pointerId) || {
        x: this.lastPointerX,
        y: this.lastPointerY,
      };
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this.activePointers.set(e.pointerId, {x: e.clientX, y: e.clientY});
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.totalDragDist += Math.hypot(dx, dy);

      if (
        this.isPanning ||
        e.button === 2 ||
        e.shiftKey ||
        this.activePointers.size === 2
      ) {
        const right = [
          this.viewMatrix[0],
          this.viewMatrix[4],
          this.viewMatrix[8],
        ];
        const up = [this.viewMatrix[1], this.viewMatrix[5], this.viewMatrix[9]];
        const target = this.customTarget
          ? [...this.customTarget]
          : [...this.bounds.center];
        const factor =
          (this.currDistance / Math.max(c.clientHeight || 300, 1)) * 1.5;
        target[0] += (-dx * right[0] + dy * up[0]) * factor;
        target[1] += (-dx * right[1] + dy * up[1]) * factor;
        target[2] += (-dx * right[2] + dy * up[2]) * factor;
        this.customTarget = target as [number, number, number];
      } else {
        this.targetTheta = this.clampTheta(this.targetTheta - dx * 0.008);
        this.targetPhi = this.clampPhi(this.targetPhi + dy * 0.008);
      }
    };
    c.addEventListener('pointermove', this.boundPointerMove);

    this.boundPointerUp = (e: PointerEvent) => {
      this.lastInteractionTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size === 0) {
        this.isPointerDown = false;
        this.isPanning = false;
      } else if (this.activePointers.size === 1) {
        this.isPanning = false;
      }
      try {
        c.releasePointerCapture(e.pointerId);
      } catch (_) {}

      // Gesture disambiguation: drag >= 5px suppresses click, < 5px performs tap & mesh pick
      if (this.totalDragDist < 5 && e.button === 0) {
        const rect = c.getBoundingClientRect();
        const clickX = Math.floor(
          (e.clientX - rect.left) * (c.width / Math.max(rect.width, 1)),
        );
        const clickY = Math.floor(
          (e.clientY - rect.top) * (c.height / Math.max(rect.height, 1)),
        );
        this.performMeshPick(clickX, clickY, true);
      }
    };
    c.addEventListener('pointerup', this.boundPointerUp);

    this.boundWheel = (e: WheelEvent) => {
      if (!this.interactive) return;
      e.preventDefault();
      this.lastInteractionTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      const factor = Math.exp(e.deltaY * 0.001);
      this.targetDistance = this.clampDistance(this.targetDistance * factor);
    };
    c.addEventListener('wheel', this.boundWheel, {passive: false});

    // Event-driven programmatic camera control
    this.boundSetCamera = (e: any) => {
      const d = e.detail || {};
      if (d.reset) {
        this.resetCamera();
      } else {
        this.setCamera(d.theta, d.phi, d.distance, d.zoom);
      }
    };
    this.container.addEventListener('setCamera', this.boundSetCamera);

    this.boundResetCamera = () => {
      this.resetCamera();
    };
    this.container.addEventListener('resetCamera', this.boundResetCamera);

    // Keyboard navigation for accessibility (WCAG 2.1.1 Keyboard Accessible)
    if (c.tabIndex !== undefined && c.tabIndex < 0) {
      c.tabIndex = 0;
    }
    if (!c.getAttribute?.('role')) {
      c.setAttribute?.('role', 'region');
    }
    if (!c.getAttribute?.('aria-label')) {
      c.setAttribute?.('aria-label', 'Interactive 3D model viewport');
    }

    this.boundKeyDown = (e: KeyboardEvent) => {
      if (!this.interactive) return;
      const now =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      switch (e.key) {
        case 'ArrowLeft':
          this.lastInteractionTime = now;
          this.targetTheta = this.clampTheta(this.targetTheta - 0.1);
          e.preventDefault();
          break;
        case 'ArrowRight':
          this.lastInteractionTime = now;
          this.targetTheta = this.clampTheta(this.targetTheta + 0.1);
          e.preventDefault();
          break;
        case 'ArrowUp':
          this.lastInteractionTime = now;
          this.targetPhi = this.clampPhi(this.targetPhi + 0.08);
          e.preventDefault();
          break;
        case 'ArrowDown':
          this.lastInteractionTime = now;
          this.targetPhi = this.clampPhi(this.targetPhi - 0.08);
          e.preventDefault();
          break;
        case '+':
        case '=': {
          this.lastInteractionTime = now;
          this.targetDistance = this.clampDistance(this.targetDistance * 0.9);
          e.preventDefault();
          break;
        }
        case '-':
        case '_': {
          this.lastInteractionTime = now;
          this.targetDistance = this.clampDistance(this.targetDistance * 1.1);
          e.preventDefault();
          break;
        }
        case 'Home':
          this.lastInteractionTime = now;
          this.resetCamera();
          e.preventDefault();
          break;
      }
    };
    c.addEventListener('keydown', this.boundKeyDown);
  }

  private teardownEvents(): void {
    const c = this.canvas;
    if (this.boundContextMenu) {
      c.removeEventListener('contextmenu', this.boundContextMenu);
      this.boundContextMenu = null;
    }
    if (this.boundPointerDown) {
      c.removeEventListener('pointerdown', this.boundPointerDown);
      this.boundPointerDown = null;
    }
    if (this.boundPointerMove) {
      c.removeEventListener('pointermove', this.boundPointerMove);
      this.boundPointerMove = null;
    }
    if (this.boundPointerUp) {
      c.removeEventListener('pointerup', this.boundPointerUp);
      this.boundPointerUp = null;
    }
    if (this.boundWheel) {
      c.removeEventListener('wheel', this.boundWheel);
      this.boundWheel = null;
    }
    if (this.boundKeyDown) {
      c.removeEventListener('keydown', this.boundKeyDown);
      this.boundKeyDown = null;
    }
    if (this.boundSetCamera) {
      this.container.removeEventListener('setCamera', this.boundSetCamera);
      this.boundSetCamera = null;
    }
    if (this.boundResetCamera) {
      this.container.removeEventListener('resetCamera', this.boundResetCamera);
      this.boundResetCamera = null;
    }
  }

  public raycastFromScreenPoint(
    clientX: number,
    clientY: number,
  ): HitDetail | null {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const w = c.width || 300;
    const h = c.height || 300;
    const canvasX =
      rect.width > 0
        ? Math.floor((clientX - rect.left) * (w / rect.width))
        : Math.floor(clientX);
    const canvasY =
      rect.height > 0
        ? Math.floor((clientY - rect.top) * (h / rect.height))
        : Math.floor(clientY);
    return this.performMeshPick(canvasX, canvasY, false);
  }

  private performMeshPick(
    canvasX: number,
    canvasY: number,
    emit = true,
  ): HitDetail | null {
    if (this.meshes.length === 0) return null;
    const gl = this.gl;
    const w = Math.max(1, this.canvas.width || 300);
    const h = Math.max(1, this.canvas.height || 300);
    const vp = mat4Create();
    mat4Multiply(vp, this.projMatrix, this.viewMatrix);

    let candidateMeshes: MeshGpu[] = [];
    const clampedX = Math.max(0, Math.min(w - 1, canvasX));
    const readY = Math.max(0, Math.min(h - 1, h - 1 - canvasY));

    if (this.pickFbo && gl) {
      if (this.pickFboWidth !== w || this.pickFboHeight !== h) {
        this.resizePickingFbo(w, h);
      }

      gl.bindFramebuffer(gl.FRAMEBUFFER, this.pickFbo);
      gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.pickProg);

      for (let i = 0; i < this.meshes.length; i++) {
        const mesh = this.meshes[i];
        if ((mesh as any).visible === false) continue;
        const id = i + 1;
        const r = (id & 0xff) / 255.0;
        const g = ((id >> 8) & 0xff) / 255.0;
        const b = ((id >> 16) & 0xff) / 255.0;
        gl.uniform4f(this.uPick.uColorId, r, g, b, 1.0);

        mat4Multiply(this.modelMatrix, this.modelRootMatrix, mesh.transform);
        mat4Multiply(this.mvpMatrix, vp, this.modelMatrix);
        gl.uniformMatrix4fv(this.uPick.uMVP, false, this.mvpMatrix);

        for (const prim of mesh.primitives) {
          gl.bindVertexArray(prim.vao);
          gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
        }
      }

      const pixel = new Uint8Array(4);
      gl.readPixels(clampedX, readY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      const pickedId = pixel[0] + (pixel[1] << 8) + (pixel[2] << 16);
      if (pickedId > 0 && pickedId <= this.meshes.length) {
        candidateMeshes = [this.meshes[pickedId - 1]];
      }
    }

    if (candidateMeshes.length === 0) {
      candidateMeshes = this.meshes.filter((m) => (m as any).visible !== false);
    }

    let bestHitMesh: MeshGpu | null = null;
    let bestHitDistance = Infinity;
    let bestHitPoint: [number, number, number] = [0, 0, 0];
    let bestHitNormal: [number, number, number] = [0, 1, 0];

    const c = this.customTarget || this.bounds.center;
    const eyeX =
      c[0] +
      this.currDistance * Math.cos(this.currPhi) * Math.sin(this.currTheta);
    const eyeY = c[1] + this.currDistance * Math.sin(this.currPhi);
    const eyeZ =
      c[2] +
      this.currDistance * Math.cos(this.currPhi) * Math.cos(this.currTheta);

    for (const hitMesh of candidateMeshes) {
      mat4Multiply(this.modelMatrix, this.modelRootMatrix, hitMesh.transform);
      mat4Multiply(this.mvpMatrix, vp, this.modelMatrix);

      const invMvp = mat4Create();
      if (!mat4Invert(invMvp, this.mvpMatrix)) continue;

      const ndcX = ((clampedX + 0.5) / w) * 2.0 - 1.0;
      const ndcY = ((readY + 0.5) / h) * 2.0 - 1.0;

      const nearP: [number, number, number] = [0, 0, 0];
      const farP: [number, number, number] = [0, 0, 0];
      unprojectPoint(nearP, ndcX, ndcY, -1.0, invMvp);
      unprojectPoint(farP, ndcX, ndcY, 1.0, invMvp);

      const rdX = farP[0] - nearP[0];
      const rdY = farP[1] - nearP[1];
      const rdZ = farP[2] - nearP[2];
      const rdLen = Math.hypot(rdX, rdY, rdZ) || 1.0;
      const dirX = rdX / rdLen,
        dirY = rdY / rdLen,
        dirZ = rdZ / rdLen;

      const outHit: RayHit = {
        distance: Infinity,
        point: [0, 0, 0],
        normal: [0, 1, 0],
      };

      const runRaycastPass = (eps: number) => {
        for (const prim of hitMesh.primitives) {
          if (!prim.positions) continue;
          const pos = prim.positions;
          const idx = prim.indices;
          const numTriangles = idx
            ? Math.floor(idx.length / 3)
            : Math.floor(pos.length / 9);

          for (let t = 0; t < numTriangles; t++) {
            const i0 = idx ? idx[t * 3] : t * 3;
            const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
            const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;

            rayIntersectsTriangle(
              nearP[0],
              nearP[1],
              nearP[2],
              dirX,
              dirY,
              dirZ,
              pos[i0 * 3],
              pos[i0 * 3 + 1],
              pos[i0 * 3 + 2],
              pos[i1 * 3],
              pos[i1 * 3 + 1],
              pos[i1 * 3 + 2],
              pos[i2 * 3],
              pos[i2 * 3 + 1],
              pos[i2 * 3 + 2],
              outHit,
              eps,
            );
          }
        }
      };

      runRaycastPass(1e-4);

      if (isFinite(outHit.distance)) {
        const lx = outHit.point[0],
          ly = outHit.point[1],
          lz = outHit.point[2];
        const m = this.modelMatrix;
        const wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
        const wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
        const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14];

        const viewDirX = wx - eyeX,
          viewDirY = wy - eyeY,
          viewDirZ = wz - eyeZ;
        const dist = Math.hypot(viewDirX, viewDirY, viewDirZ);
        if (dist < bestHitDistance) {
          mat3NormalFromMat4(this.normalMatrix, this.modelMatrix);
          const nm = this.normalMatrix;
          const lnx = outHit.normal[0],
            lny = outHit.normal[1],
            lnz = outHit.normal[2];
          let wnx = nm[0] * lnx + nm[3] * lny + nm[6] * lnz;
          let wny = nm[1] * lnx + nm[4] * lny + nm[7] * lnz;
          let wnz = nm[2] * lnx + nm[5] * lny + nm[8] * lnz;
          const wnLen = Math.hypot(wnx, wny, wnz) || 1.0;
          wnx /= wnLen;
          wny /= wnLen;
          wnz /= wnLen;

          if (wnx * viewDirX + wny * viewDirY + wnz * viewDirZ > 0) {
            wnx = -wnx;
            wny = -wny;
            wnz = -wnz;
          }

          bestHitMesh = hitMesh;
          bestHitDistance = Math.round(dist * 1000) / 1000;
          bestHitPoint = [
            Math.round(wx * 1000) / 1000,
            Math.round(wy * 1000) / 1000,
            Math.round(wz * 1000) / 1000,
          ];
          bestHitNormal = [
            Math.round(wnx * 1000) / 1000,
            Math.round(wny * 1000) / 1000,
            Math.round(wnz * 1000) / 1000,
          ];
        }
      }
    }

    if (!bestHitMesh) return null;

    const meshIndex = this.meshes.indexOf(bestHitMesh);
    const detail: HitDetail = {
      meshIndex,
      meshName: bestHitMesh.name,
      nodeIndex: bestHitMesh.nodeIndex,
      distance: bestHitDistance,
      hitPoint: bestHitPoint,
      normal: bestHitNormal,
      screenX: canvasX,
      screenY: canvasY,
    };

    if (emit) {
      for (const plugin of registeredPlugins) {
        plugin.onMeshSelect?.(this, detail);
      }
      if (this.opts.onMeshClick) {
        this.opts.onMeshClick(detail);
      }
      if (
        typeof CustomEvent !== 'undefined' &&
        typeof this.container.dispatchEvent === 'function'
      ) {
        this.container.dispatchEvent(
          new CustomEvent('meshClick', {
            bubbles: true,
            detail,
          }),
        );
      }
    }
    return detail;
  }

  public resize(): void {
    const dpr = Math.min(
      (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
      2,
    );
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.resizePickingFbo(w, h);
    }
  }

  public start(): void {
    if (this.animFrameId !== null) return;
    this.lastTime = performance.now();
    const renderLoop = (time: number) => {
      const dt = Math.min((time - this.lastTime) / 1000, 0.1);
      this.lastTime = time;

      if (this.isVisible) {
        this.resize();
        this.update(dt);
        this.render();
      }
      this.animFrameId = requestAnimationFrame(renderLoop);
    };
    this.animFrameId = requestAnimationFrame(renderLoop);
  }

  public stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  public setAutoRotate(enabled: boolean): void {
    this.autoRotate = enabled;
  }

  public getAutoRotate(): boolean {
    return this.autoRotate;
  }

  public setAutoRotateSpeed(speed: number): void {
    this.autoRotateSpeed = speed;
  }

  public getAutoRotateSpeed(): number {
    return this.autoRotateSpeed;
  }

  public setAutoRotateDelay(ms: number): void {
    this.autoRotateDelay = Math.max(0, Number(ms) || 0);
  }

  public getAutoRotateDelay(): number {
    return this.autoRotateDelay;
  }

  public resetTurntableRotation(theta = 0): void {
    this.turntableRotation = Number(theta) || 0;
    this.updateTurntableMatrix();
    this.render();
  }

  private updateTurntableMatrix(): void {
    const cosA = Math.cos(this.turntableRotation);
    const sinA = Math.sin(this.turntableRotation);
    const cx = this.bounds.center[0];
    const cz = this.bounds.center[2];
    const m = this.modelRootMatrix;
    m[0] = cosA;
    m[1] = 0;
    m[2] = -sinA;
    m[3] = 0;
    m[4] = 0;
    m[5] = 1;
    m[6] = 0;
    m[7] = 0;
    m[8] = sinA;
    m[9] = 0;
    m[10] = cosA;
    m[11] = 0;
    m[12] = cx - (cosA * cx + sinA * cz);
    m[13] = 0;
    m[14] = cz - (-sinA * cx + cosA * cz);
    m[15] = 1;
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
  }

  private update(dt: number): void {
    for (const plugin of registeredPlugins) {
      plugin.onUpdate?.(this, dt);
    }

    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (
      !this.isPointerDown &&
      this.autoRotate &&
      now - this.lastInteractionTime >= this.autoRotateDelay
    ) {
      this.turntableRotation += this.autoRotateSpeed * dt;
      this.updateTurntableMatrix();
      for (const plugin of registeredPlugins) {
        plugin.onCameraChange?.(this, this.container);
      }
    }
    this.currTheta += (this.targetTheta - this.currTheta) * 0.12;
    this.currPhi += (this.targetPhi - this.currPhi) * 0.12;
    this.currDistance += (this.targetDistance - this.currDistance) * 0.12;

    const aspect = (this.canvas.width || 1) / (this.canvas.height || 1);
    const farPlane =
      this.backdropMeshes.length > 0
        ? Math.max(this.bounds.radius * 20, 120)
        : this.bounds.radius * 20;
    mat4Perspective(this.projMatrix, this.fov, aspect, 0.1, farPlane);

    const c = this.customTarget || this.bounds.center;
    const eyeX =
      c[0] +
      this.currDistance * Math.cos(this.currPhi) * Math.sin(this.currTheta);
    const eyeY = c[1] + this.currDistance * Math.sin(this.currPhi);
    const eyeZ =
      c[2] +
      this.currDistance * Math.cos(this.currPhi) * Math.cos(this.currTheta);

    mat4LookAt(this.viewMatrix, [eyeX, eyeY, eyeZ], c, [0, 1, 0]);
    mat4Multiply(this.mvpMatrix, this.projMatrix, this.viewMatrix);
    mat3NormalFromMat4(this.normalMatrix, this.modelMatrix);

    // Telemetry emission (cameraChange)
    const thetaDeg = Math.round(
      ((((this.currTheta * 180) / Math.PI) % 360) + 360) % 360,
    );
    const phiDeg = Math.round((this.currPhi * 180) / Math.PI);
    const zoom =
      Math.round(((this.bounds.radius * 2.5) / this.currDistance) * 100) / 100;

    if (
      Math.abs(thetaDeg - this.lastReportedTheta) >= 1 ||
      Math.abs(phiDeg - this.lastReportedPhi) >= 1 ||
      Math.abs(zoom - this.lastReportedZoom) >= 0.02
    ) {
      this.lastReportedTheta = thetaDeg;
      this.lastReportedPhi = phiDeg;
      this.lastReportedZoom = zoom;

      const detail = {
        theta: thetaDeg,
        phi: phiDeg,
        zoom,
        distance: Math.round(this.currDistance * 100) / 100,
      };

      if (this.opts.onCameraChange) {
        this.opts.onCameraChange(detail);
      }
      if (
        typeof CustomEvent !== 'undefined' &&
        typeof this.container.dispatchEvent === 'function'
      ) {
        this.container.dispatchEvent(
          new CustomEvent('cameraChange', {
            bubbles: true,
            detail,
          }),
        );
      }
    }
  }

  public xrDepthState: {
    enabled: boolean;
    texture: WebGLTexture | null;
    uvTransform: Float32Array;
    rawValueToMeters: number;
    format?: 0 | 1;
  } = {
    enabled: false,
    texture: null,
    uvTransform: mat4Create(),
    rawValueToMeters: 0.001,
    format: 0,
  };

  onBeforeRenderXRView?: (xrView: any) => void;

  renderXRView(
    xrView: {
      transform?: {
        inverse?: {matrix?: Float32Array};
        position?: {x: number; y: number; z: number};
      };
      projectionMatrix?: Float32Array;
      eye?: string;
    },
    placementMatrix?: Float32Array | null,
    isPlaced?: boolean,
    viewport?: [number, number, number, number],
  ): void {
    if (this.onBeforeRenderXRView) {
      this.onBeforeRenderXRView(xrView);
    }
    const viewMatrix = xrView?.transform?.inverse?.matrix || this.viewMatrix;
    const projMatrix = xrView?.projectionMatrix || this.projMatrix;
    const pos = xrView?.transform?.position;
    const eyePos: [number, number, number] = pos
      ? [pos.x, pos.y, pos.z]
      : [0, 1.6, 0];
    if (isPlaced && placementMatrix) {
      this.modelRootMatrix.set(placementMatrix);
    }
    this.render({
      viewMatrix,
      projMatrix,
      eyePos,
      viewport,
      eye: (xrView?.eye as 'left' | 'right' | 'none') || 'none',
      clear: xrView?.eye !== 'right',
    });
  }

  render(xrOverride?: {
    viewMatrix: Float32Array;
    projMatrix: Float32Array;
    eyePos: [number, number, number];
    viewport?: [number, number, number, number];
    eye?: 'left' | 'right' | 'none';
    clear?: boolean;
  }): void {
    const gl = this.gl;
    let vpW = this.canvas.width;
    let vpH = this.canvas.height;
    if (xrOverride?.viewport) {
      gl.viewport(
        xrOverride.viewport[0],
        xrOverride.viewport[1],
        xrOverride.viewport[2],
        xrOverride.viewport[3],
      );
      vpW = xrOverride.viewport[2];
      vpH = xrOverride.viewport[3];
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.enable(gl.DEPTH_TEST);
    if (!xrOverride || xrOverride.clear !== false) {
      gl.clearColor(
        this.clearColor[0],
        this.clearColor[1],
        this.clearColor[2],
        this.clearColor[3],
      );
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    const vp = mat4Create();
    mat4Multiply(
      vp,
      xrOverride?.projMatrix ?? this.projMatrix,
      xrOverride?.viewMatrix ?? this.viewMatrix,
    );

    const toneMode =
      this.toneMapping === 'reinhard' ? 1 : this.toneMapping === 'none' ? 2 : 0;

    const c = this.customTarget || this.bounds.center;
    const eyeX = xrOverride
      ? xrOverride.eyePos[0]
      : c[0] +
        this.currDistance * Math.cos(this.currPhi) * Math.sin(this.currTheta);
    const eyeY = xrOverride
      ? xrOverride.eyePos[1]
      : c[1] + this.currDistance * Math.sin(this.currPhi);
    const eyeZ = xrOverride
      ? xrOverride.eyePos[2]
      : c[2] +
        this.currDistance * Math.cos(this.currPhi) * Math.cos(this.currTheta);

    for (const plugin of registeredPlugins) {
      (plugin as any).onBeforeDrawScene?.(
        this,
        gl,
        vp,
        [eyeX, eyeY, eyeZ],
        toneMode,
      );
    }

    if (this.meshes.length === 0 && this.backdropMeshes.length === 0) return;

    const currentEye = xrOverride?.eye || 'none';
    let hasTransmissive = false;
    const numBackdrop = this.backdropMeshes.length;
    const renderList =
      numBackdrop > 0
        ? [...this.backdropMeshes, ...this.meshes]
        : this.meshes;
    const drawPass = (transmissivePass: boolean) => {
      for (let i = 0; i < renderList.length; i++) {
        const mesh = renderList[i];
        if ((mesh as any).visible === false) continue;
        const isSelected =
          this.selectedMeshName !== '' && mesh.name === this.selectedMeshName;

        if (i < numBackdrop) {
          this.modelMatrix.set(mesh.transform);
        } else {
          mat4Multiply(this.modelMatrix, this.modelRootMatrix, mesh.transform);
        }
        mat4Multiply(this.mvpMatrix, vp, this.modelMatrix);
        mat3NormalFromMat4(mesh.normalMatrix, this.modelMatrix);

        const stereoMode =
          mesh.extras?.xr?.stereo || (mesh as any).userData?.xr?.stereo;
        let uvOffsetX = 0.0;
        let uvOffsetY = 0.0;
        let uvScaleX = 1.0;
        let uvScaleY = 1.0;
        if (stereoMode === 'sbs') {
          uvScaleX = 0.5;
          uvOffsetX = currentEye === 'right' ? 0.5 : 0.0;
        } else if (stereoMode === 'ou') {
          uvScaleY = 0.5;
          uvOffsetY = currentEye === 'right' ? 0.5 : 0.0;
        }

        for (const prim of mesh.primitives) {
          const isTrans = Boolean((prim as any).isTransmissive);
          if (!transmissivePass && isTrans) {
            hasTransmissive = true;
            continue;
          }
          if (transmissivePass && !isTrans) continue;

          const prog = prim.customProgram || this.renderProg;
          const u = prim.customUniforms || this.uRender;
          gl.useProgram(prog);

          gl.uniform1i(u.uToneMapping, toneMode);
          gl.uniform1f(u.uEnvIntensity, this.envIntensity);
          gl.uniform3f(u.uCameraPos, eyeX, eyeY, eyeZ);
          gl.uniform1f(u.uEmissive, isSelected ? 1.0 : 0.0);
          gl.uniformMatrix4fv(u.uMVP, false, this.mvpMatrix);
          gl.uniformMatrix4fv(u.uModel, false, this.modelMatrix);
          gl.uniformMatrix3fv(u.uNormalMatrix, false, mesh.normalMatrix);
          if (u.uUvTransform) {
            gl.uniform4f(
              u.uUvTransform,
              uvOffsetX,
              uvOffsetY,
              uvScaleX,
              uvScaleY,
            );
          }
          if (u.uViewportSize) {
            gl.uniform2f(u.uViewportSize, Math.max(1, vpW), Math.max(1, vpH));
          }
          if (this.xrDepthState.enabled && this.xrDepthState.texture) {
            gl.activeTexture(gl.TEXTURE5);
            gl.bindTexture(gl.TEXTURE_2D, this.xrDepthState.texture);
            if (u.uXrDepthTex) gl.uniform1i(u.uXrDepthTex, 5);
            if (u.uXrDepthEnabled) gl.uniform1i(u.uXrDepthEnabled, 1);
            if (u.uXrDepthFormat) {
              gl.uniform1i(u.uXrDepthFormat, this.xrDepthState.format || 0);
            }
            if (u.uXrRawValueToMeters) {
              gl.uniform1f(
                u.uXrRawValueToMeters,
                this.xrDepthState.rawValueToMeters,
              );
            }
            if (u.uXrDepthUVTransform) {
              gl.uniformMatrix4fv(
                u.uXrDepthUVTransform,
                false,
                this.xrDepthState.uvTransform,
              );
            }
          } else {
            if (u.uXrDepthEnabled) gl.uniform1i(u.uXrDepthEnabled, 0);
          }

          if (this.environmentTexture) {
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, this.environmentTexture);
            gl.uniform1i(u.uEnvironmentMap, 4);
            gl.uniform1i(u.uHasEnvironmentMap, 1);
          } else {
            gl.uniform1i(u.uHasEnvironmentMap, 0);
          }

          this.bindLights(u);

          for (const plugin of registeredPlugins) {
            plugin.onBeforeDrawPrimitive?.(
              gl,
              prog,
              prim,
              mesh,
              this.worldMatrices || [],
              this.gltf,
            );
          }

          gl.uniform4fv(u.uBaseColor, prim.baseColor);
          gl.uniform1f(u.uMetallic, prim.metallic);
          gl.uniform1f(u.uRoughness, prim.roughness);

          if (prim.texture) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, prim.texture);
            gl.uniform1i(u.uBaseColorTexture, 0);
            gl.uniform1i(u.uHasTexture, 1);
          } else {
            gl.uniform1i(u.uHasTexture, 0);
          }

          if (prim.metallicRoughnessTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, prim.metallicRoughnessTexture);
            gl.uniform1i(u.uMetallicRoughnessTexture, 1);
            gl.uniform1i(u.uHasMetallicRoughnessTexture, 1);
          } else {
            gl.uniform1i(u.uHasMetallicRoughnessTexture, 0);
          }

          if (prim.normalTexture) {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, prim.normalTexture);
            gl.uniform1i(u.uNormalTexture, 2);
            gl.uniform1i(u.uHasNormalTexture, 1);
            gl.uniform1f(u.uNormalScale, prim.normalScale);
          } else {
            gl.uniform1i(u.uHasNormalTexture, 0);
          }

          if (prim.occlusionTexture) {
            gl.activeTexture(gl.TEXTURE3);
            gl.bindTexture(gl.TEXTURE_2D, prim.occlusionTexture);
            gl.uniform1i(u.uOcclusionTexture, 3);
            gl.uniform1i(u.uHasOcclusionTexture, 1);
            gl.uniform1f(u.uOcclusionStrength, prim.occlusionStrength);
          } else {
            gl.uniform1i(u.uHasOcclusionTexture, 0);
          }

          gl.bindVertexArray(prim.vao);
          gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
        }
      }
    };

    drawPass(false);
    if (hasTransmissive) {
      for (const plugin of registeredPlugins) {
        plugin.onBeforeTransmissivePass?.(gl, this);
      }
      drawPass(true);
    }

    for (const plugin of registeredPlugins) {
      plugin.onAfterRender?.(gl, this, vp);
    }
  }

  private disposeMeshListGpuResources(list: MeshGpu[]): void {
    const gl = this.gl;
    for (const mesh of list) {
      for (const prim of mesh.primitives) {
        if (prim.vao) {
          gl.deleteVertexArray(prim.vao);
        }
        if (prim.buffers) {
          for (const buf of prim.buffers) {
            gl.deleteBuffer(buf);
          }
        }
        if (prim.texture) {
          gl.deleteTexture(prim.texture);
        }
        if (prim.metallicRoughnessTexture) {
          gl.deleteTexture(prim.metallicRoughnessTexture);
        }
        if (prim.normalTexture) {
          gl.deleteTexture(prim.normalTexture);
        }
        if (prim.occlusionTexture) {
          gl.deleteTexture(prim.occlusionTexture);
        }
        if (prim.customProgram) {
          gl.deleteProgram(prim.customProgram);
        }
      }
    }
  }

  private disposeMeshGpuResources(): void {
    this.disposeMeshListGpuResources(this.meshes);
    this.meshes = [];
  }

  disposeGpuResources(): void {
    const gl = this.gl;
    this.disposeMeshGpuResources();
    this.disposeMeshListGpuResources(this.backdropMeshes);
    this.backdropMeshes = [];

    for (const plugin of registeredPlugins) {
      plugin.onDestroy?.(gl, this);
    }

    if (this.environmentTexture) {
      gl.deleteTexture(this.environmentTexture);
      this.environmentTexture = null;
    }

    if (this.renderProg) gl.deleteProgram(this.renderProg);
    if (this.pickProg) gl.deleteProgram(this.pickProg);
    if (this.pickFbo) gl.deleteFramebuffer(this.pickFbo);
    if (this.pickTexture) gl.deleteTexture(this.pickTexture);
    if (this.pickDepth) gl.deleteRenderbuffer(this.pickDepth);
    this.pickFbo = null;
    this.pickTexture = null;
    this.pickDepth = null;
  }

  public dispose(): void {
    this.stop();
    this.teardownEvents();
    this.disposeGpuResources();
  }

  public destroy(): void {
    this.dispose();
  }
}

// =========================================================================

// Backwards compatibility alias
export {ThreeView as MicroViewer};
export default ThreeView;
