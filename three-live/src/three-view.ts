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
  decodeBufferViews?(gltf: unknown, glbData: GLBData): void;
}

export interface OrbitLimits {
  minTheta?: number;
  maxTheta?: number;
  minPhi?: number;
  maxPhi?: number;
  minDistance?: number;
  maxDistance?: number;
}

/** Supported tone mapping curves for `<three-live>` and `ThreeView`. */
export type ToneMappingMode = 'neutral' | 'aces' | 'agx' | 'reinhard' | 'none';

const TONE_MAPPING_MODES: readonly ToneMappingMode[] = [
  'neutral',
  'reinhard',
  'none',
  'aces',
  'agx',
];

/**
 * Normalizes a host-supplied tone-mapping value (case-insensitive, trimmed).
 * Unknown, empty, or missing values fall back to `'neutral'`, matching the
 * Kotlin and Swift evaluators.
 */
export function normalizeToneMapping(v: unknown): ToneMappingMode {
  const s = String(v ?? '')
    .trim()
    .toLowerCase() as ToneMappingMode;
  return TONE_MAPPING_MODES.includes(s) ? s : 'neutral';
}

/**
 * Maps a tone-mapping mode to the `uToneMapping` index used by
 * `applyToneMapping` in `FS_RENDER` (`neutral=0`, `reinhard=1`, `none=2`,
 * `aces=3`, `agx=4`).
 */
export function toneMappingShaderIndex(mode: unknown): number {
  return TONE_MAPPING_MODES.indexOf(normalizeToneMapping(mode));
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
  toneMapping?: ToneMappingMode;
  environmentImage?: string | HTMLImageElement | ImageBitmap | null;
  autoplay?: boolean;
  animationName?: string;
  variantName?: string;
  fieldOfView?: number;
  distanceMode?: 'auto' | 'relative' | 'absolute';
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

import {createProgram} from './gl-program';
import {
  applyTextureTransform,
  readAccessorAsFloat32,
  type TextureTransformLike,
} from './accessor';
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
  getRegisteredPlugins,
  getSharedRegistry,
  registerPlugin,
  registeredPlugins,
  type ThreeLivePlugin,
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
  for (const ext of ['EXT_meshopt_compression', 'KHR_meshopt_compression']) {
    if (extensionsRequired.includes(ext) && !getDecoder('meshopt')) {
      throw new Error(
        `Model requires ${ext}. Register a decoder via ThreeLiveElement.registerDecoder('meshopt', decoder).`,
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
layout(location=8) in vec4 aInst0;
layout(location=9) in vec4 aInst1;
layout(location=10) in vec4 aInst2;
layout(location=11) in vec4 aInst3;
layout(location=12) in vec4 aInstColor;
uniform int uInstanced;
uniform mat4 uViewProj;
out vec4 vInstTint;
mat4 xrModel(){return uInstanced==1?uModel*mat4(aInst0,aInst1,aInst2,aInst3):uModel;}
mat4 xrMVP(){return uInstanced==1?uViewProj*xrModel():uMVP;}
mat3 xrNormalMatrix(){return uInstanced==1?transpose(inverse(mat3(xrModel()))):uNormalMatrix;}
#define uModel xrModel()
#define uMVP xrMVP()
#define uNormalMatrix xrNormalMatrix()
out vec3 vNormal,vWorldPos;
out vec2 vUV;
void main(){
vInstTint=uInstanced==1?aInstColor:vec4(1.0);
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
in vec4 vInstTint;
#define uBaseColor (uBaseColor*vInstTint)
uniform float uMetallic,uRoughness,uEmissive,uEnvIntensity,uExposure;
uniform vec2 uClearcoat;
uniform vec3 uCameraPos,uAmbientColor;
uniform sampler2D uBaseColorTexture,uMetallicRoughnessTexture,uNormalTexture,uOcclusionTexture,uEnvironmentMap;
uniform int uHasTexture,uHasMetallicRoughnessTexture,uHasNormalTexture,uHasOcclusionTexture,uHasEnvironmentMap;
uniform float uNormalScale,uOcclusionStrength;
/*XRD_U*/
uniform vec2 uViewportSize;
uniform vec4 uSectionPlane;
uniform int uToneMapping,uNumDirLights,uNumPointLights,uSectionEnabled;
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
float ki=pow(max(dot(R,kd),0.0),mix(96.0,1.5,r))*mix(2.4,0.5,r);
vec3 fd=normalize(vec3(-0.85,0.45,-0.35));
float fi=pow(max(dot(R,fd),0.0),mix(36.0,1.2,r))*mix(1.3,0.35,r);
float ri=pow(clamp(1.0-abs(R.y),0.0,1.0),3.5)*mix(0.55,0.22,r);
vec3 ag=mix(vec3(0.06,0.06,0.08),vec3(0.48,0.50,0.55),R.y*0.5+0.5);
return ag+vec3(1.0,0.98,0.94)*ki+vec3(0.85,0.92,1.0)*fi+vec3(0.65,0.72,0.85)*ri;
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

vec3 acesToneMapping(vec3 color){
color*=0.6;
return clamp((color*(2.51*color+0.03))/(color*(2.43*color+0.59)+0.14),0.0,1.0);
}

vec3 agxToneMapping(vec3 color){
color=max(color,vec3(0.0));
vec3 inset=vec3(
0.84247906*color.r+0.0784336*color.g+0.07922375*color.b,
0.04232824*color.r+0.87846864*color.g+0.07916613*color.b,
0.04237565*color.r+0.0784336*color.g+0.87914297*color.b);
vec3 ev=clamp((log2(max(inset,vec3(1e-6)))+12.47393)/16.5,0.0,1.0);
vec3 x2=ev*ev;
vec3 x4=x2*x2;
vec3 s=15.5*x4*x2-40.14*x4*ev+31.96*x4-6.868*x2*ev+0.4298*x2+0.1191*ev-0.00232;
vec3 outset=vec3(
1.196879*s.r-0.09802088*s.g-0.09902974*s.b,
-0.05289685*s.r+1.15190313*s.g-0.09896118*s.b,
-0.05297164*s.r-0.09804345*s.g+1.15107367*s.b);
return clamp(pow(max(outset,vec3(0.0)),vec3(2.2)),0.0,1.0);
}

vec3 applyToneMapping(vec3 color,int mode){
if(mode==0)return neutralToneMapping(color);
if(mode==1)return color/(color+vec3(1.0));
if(mode==3)return acesToneMapping(color);
if(mode==4)return agxToneMapping(color);
return color;
}

void main(){
if(uSectionEnabled==1&&dot(vWorldPos,uSectionPlane.xyz)>uSectionPlane.w)discard;
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

float gloss=1.0-roughness;
float specExp=mix(16.0,256.0,gloss*gloss);
float specWeight=mix(0.22*gloss,1.0,metallic);
vec3 directLight=vec3(0.0);
for(int i=0;i<2;i++){
if(i>=uNumDirLights)break;
vec3 L=normalize(uDirLightDir[i]);
float NdotL=max(dot(N,L),0.0);
vec3 H=normalize(L+V);
float NoH=max(dot(N,H),0.0);
float spec=pow(NoH,specExp)*specWeight+uClearcoat.x*pow(NoH,mix(64.0,512.0,1.0-uClearcoat.y))*0.35;
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
float NoH=max(dot(N,H),0.0);
float spec=pow(NoH,specExp)*specWeight+uClearcoat.x*pow(NoH,mix(64.0,512.0,1.0-uClearcoat.y))*0.35;
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
if(uClearcoat.x>0.0){
vec3 ccF=F_SchlickRoughness(vec3(0.04),uClearcoat.y,NoV)*uClearcoat.x;
color=color*(vec3(1.0)-ccF)+getStudioRadiance(R,uClearcoat.y)*ccF*uEnvIntensity;
}
color*=uExposure;
color=applyToneMapping(color,uToneMapping);
float outAlpha=base.a;
/*XRD_O*/
fragColor=vec4(color,outAlpha);
}`;

/**
 * Evaluates the canonical PBR tone-mapping curve (`neutral`, `aces`, `agx`,
 * `reinhard`, or `none`) on a linear RGB color with optional exposure scale,
 * matching the WebGL2 shader in `FS_RENDER`.
 */
export function evaluateToneMapping(
  rgb: readonly [number, number, number],
  mode: ToneMappingMode,
  exposure = 1.0,
): [number, number, number] {
  mode = normalizeToneMapping(mode);
  const exp = Number.isFinite(exposure) ? Math.max(0, exposure) : 1.0;
  let r = Math.max(0, (Number(rgb[0]) || 0) * exp);
  let g = Math.max(0, (Number(rgb[1]) || 0) * exp);
  let b = Math.max(0, (Number(rgb[2]) || 0) * exp);
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

  if (mode === 'none') {
    return [clamp01(r), clamp01(g), clamp01(b)];
  }
  if (mode === 'reinhard') {
    return [r / (r + 1), g / (g + 1), b / (b + 1)];
  }
  if (mode === 'aces') {
    const aces = (x: number): number => {
      const c = x * 0.6;
      return clamp01((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14));
    };
    return [aces(r), aces(g), aces(b)];
  }
  if (mode === 'agx') {
    const ir = 0.84247906 * r + 0.0784336 * g + 0.07922375 * b;
    const ig = 0.04232824 * r + 0.87846864 * g + 0.07916613 * b;
    const ib = 0.04237565 * r + 0.0784336 * g + 0.87914297 * b;
    const sig = (v: number): number => {
      const ev = clamp01((Math.log2(Math.max(v, 1e-6)) + 12.47393) / 16.5);
      const x2 = ev * ev;
      const x4 = x2 * x2;
      return (
        15.5 * x4 * x2 -
        40.14 * x4 * ev +
        31.96 * x4 -
        6.868 * x2 * ev +
        0.4298 * x2 +
        0.1191 * ev -
        0.00232
      );
    };
    const sr = sig(ir);
    const sg = sig(ig);
    const sb = sig(ib);
    const or = 1.196879 * sr - 0.09802088 * sg - 0.09902974 * sb;
    const og = -0.05289685 * sr + 1.15190313 * sg - 0.09896118 * sb;
    const ob = -0.05297164 * sr - 0.09804345 * sg + 1.15107367 * sb;
    return [
      clamp01(Math.pow(Math.max(or, 0), 2.2)),
      clamp01(Math.pow(Math.max(og, 0), 2.2)),
      clamp01(Math.max(0, Math.pow(Math.max(ob, 0), 2.2))),
    ];
  }
  // Khronos PBR Neutral ('neutral')
  const startCompression = 0.76;
  const desaturation = 0.15;
  const x = Math.min(r, g, b);
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset;
  g -= offset;
  b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < startCompression) {
    return [clamp01(r), clamp01(g), clamp01(b)];
  }
  const d = 1.0 - startCompression;
  const newPeak = 1.0 - (d * d) / (peak + d - startCompression);
  const scale = newPeak / peak;
  r *= scale;
  g *= scale;
  b *= scale;
  const gt = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return [
    clamp01(r + (newPeak - r) * gt),
    clamp01(g + (newPeak - g) * gt),
    clamp01(b + (newPeak - b) * gt),
  ];
}

const VS_PICK = `#version 300 es
layout(location=0) in vec3 aPosition;
uniform mat4 uMVP;
void main(){gl_Position=uMVP*vec4(aPosition,1.0);}`;

const FS_PICK = `#version 300 es
precision highp float;
uniform vec4 uColorId;
out vec4 fragColor;
void main(){fragColor=uColorId;}`;

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
  'uInstanced',
  'uViewProj',
  'uNormalMatrix',
  'uUvTransform',
  'uBaseColor',
  'uMetallic',
  'uRoughness',
  'uClearcoat',
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
  'uExposure',
  'uViewportSize',
  'uSectionPlane',
  'uSectionEnabled',
] as const;

/**
 * Returns the render fragment shader and its uniform names, with WebXR depth
 * occlusion spliced in only when `xr-depth-shader.ts` has installed it. The
 * lean `<three-live>` viewer never imports that module, so it ships no XR
 * depth GLSL or binding code.
 */
function renderShaderSpec(): {fs: string; uniforms: readonly string[]} {
  const x = getSharedRegistry().xrDepthShader;
  return {
    fs: FS_RENDER.replace('/*XRD_U*/', x?.uniformsGLSL || '').replace(
      '/*XRD_O*/',
      x?.occlusionGLSL || '',
    ),
    uniforms: x ? [...RENDER_UNIFORMS, ...x.uniformNames] : RENDER_UNIFORMS,
  };
}

interface PrimitiveGpu {
  vao: WebGLVertexArrayObject;
  /** True when the VAO carries per-instance attributes (EXT_mesh_gpu_instancing). */
  instanced?: boolean;
  indexCount: number;
  indexType: number;
  baseColor: [number, number, number, number];
  metallic: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
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
  defaultMaterialIndex?: number;
  variantMappings?: Array<{material: number; variants: number[]}>;
  pluginData?: Record<string, any>;
  customProgram?: WebGLProgram | null;
  customUniforms?: Record<string, WebGLUniformLocation | null> | null;
  /** Source glTF primitive, used to re-resolve shaders when the material changes. */
  primitiveDef?: any;
  /** Programs resolved per material index (KHR_materials_variants switching). */
  programCache?: Map<number, ResolvedProgram>;
  isTransmissive?: boolean;
}

interface MeshGpu {
  name: string;
  nodeIndex: number;
  transform: Float32Array;
  normalMatrix: Float32Array;
  primitives: PrimitiveGpu[];
  extras?: Record<string, any>;
  instanceMatrices?: Float32Array;
  instanceColors?: Float32Array;
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
  uvTransform?: TextureTransformLike | null,
): Float32Array | null {
  if (accIdx === undefined || !gltf.accessors?.[accIdx]) return null;
  // Dequantizes KHR_mesh_quantization / normalized integer attributes and
  // honors byteStride, so CPU-side copies (bounds, picking) stay in floats.
  let data = readAccessorAsFloat32(gltf, bin, gltf.accessors[accIdx], size);
  if (!data) return null;
  if (uvTransform) {
    data = data.slice();
    applyTextureTransform(data, uvTransform);
  }
  const vbo = gl.createBuffer()!;
  buffers.push(vbo);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  return data;
}

/** Clamps an exposure value to a finite, non-negative number (default 1). */
function sanitizeExposure(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, n) : 1.0;
}

interface ResolvedProgram {
  program: WebGLProgram | null;
  uniforms: Record<string, WebGLUniformLocation | null> | null;
}

/**
 * Runs every plugin's `onResolveShader` for a glTF primitive and material and
 * compiles the resulting custom program (null when no plugin customizes it).
 */
function resolvePrimitiveProgram(
  gl: WebGL2RenderingContext,
  // tslint:disable-next-line:no-any glTF primitive / material JSON.
  primDef: any,
  // tslint:disable-next-line:no-any
  mat: any,
): ResolvedProgram {
  const spec = renderShaderSpec();
  let vsSource = VS_RENDER;
  let fsSource = spec.fs;
  let hasCustomShader = false;
  for (const plugin of registeredPlugins) {
    if (plugin.onResolveShader) {
      const shaders = plugin.onResolveShader(primDef, mat, vsSource, fsSource);
      if (shaders) {
        vsSource = shaders.vs;
        fsSource = shaders.fs;
        hasCustomShader = true;
      }
    }
  }
  const program = hasCustomShader
    ? createProgram(gl, vsSource, fsSource)
    : null;
  return {
    program,
    uniforms: program ? getUniforms(gl, program, spec.uniforms) : null,
  };
}

/**
 * Uploads `EXT_mesh_gpu_instancing` matrices and colors as per-instance vertex
 * attributes (locations 8-11 = model matrix columns, 12 = color, divisor 1) on
 * the currently bound VAO, so the mesh draws with one `drawElementsInstanced`.
 * Returns false when the context cannot draw instanced geometry.
 */
function bindInstanceAttributes(
  gl: WebGL2RenderingContext,
  mesh: {instanceMatrices?: Float32Array; instanceColors?: Float32Array},
  buffers: WebGLBuffer[],
): boolean {
  const mats = mesh.instanceMatrices;
  if (
    !mats ||
    mats.length < 16 ||
    typeof gl.vertexAttribDivisor !== 'function' ||
    typeof gl.drawElementsInstanced !== 'function'
  ) {
    return false;
  }
  const n = mats.length >> 4;
  const cols = mesh.instanceColors;
  const data = new Float32Array(n * 20);
  for (let i = 0; i < n; i++) {
    data.set(mats.subarray(i * 16, i * 16 + 16), i * 20);
    data[i * 20 + 16] = cols ? cols[i * 3] : 1;
    data[i * 20 + 17] = cols ? cols[i * 3 + 1] : 1;
    data[i * 20 + 18] = cols ? cols[i * 3 + 2] : 1;
    data[i * 20 + 19] = 1;
  }
  const vbo = gl.createBuffer()!;
  buffers.push(vbo);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  for (let c = 0; c < 5; c++) {
    gl.enableVertexAttribArray(8 + c);
    gl.vertexAttribPointer(8 + c, 4, gl.FLOAT, false, 80, c * 16);
    gl.vertexAttribDivisor(8 + c, 1);
  }
  return true;
}

/**
 * Returns the `KHR_texture_transform` of the primitive's material (base color
 * first, then the other PBR textures). gltfpack uses it to dequantize
 * normalized TEXCOORD_0 attributes, so it is baked into the uploaded UVs.
 */
function primitiveTextureTransform(
  gltf: any,
  prim: any,
): TextureTransformLike | null {
  const mat = gltf.materials?.[prim?.material];
  if (!mat) return null;
  const infos = [
    mat.pbrMetallicRoughness?.baseColorTexture,
    mat.pbrMetallicRoughness?.metallicRoughnessTexture,
    mat.normalTexture,
    mat.occlusionTexture,
    mat.emissiveTexture,
  ];
  for (const info of infos) {
    const t = info?.extensions?.KHR_texture_transform;
    if (t && typeof t === 'object') return t as TextureTransformLike;
  }
  return null;
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

/** GL objects created so far by `buildGpuScene`, released if it throws. */
interface GpuBuildTrack {
  meshes: MeshGpu[];
  mesh: MeshGpu | null;
  gpuTextures: Array<WebGLTexture | null>;
  vao: WebGLVertexArrayObject | null;
  buffers: WebGLBuffer[];
}

function drawPrim(gl: WebGL2RenderingContext, prim: PrimitiveGpu): void {
  if (prim.indices) {
    gl.drawElements(gl.TRIANGLES, prim.indexCount, prim.indexType, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, prim.indexCount);
  }
}

function extractMaterialProps(
  // tslint:disable-next-line:no-any glTF material JSON.
  mat: any,
  gpuTextures: Array<WebGLTexture | null>,
): Pick<
  PrimitiveGpu,
  | 'baseColor'
  | 'metallic'
  | 'roughness'
  | 'clearcoat'
  | 'clearcoatRoughness'
  | 'texture'
  | 'metallicRoughnessTexture'
  | 'normalTexture'
  | 'normalScale'
  | 'occlusionTexture'
  | 'occlusionStrength'
  | 'isTransmissive'
> {
  const pbr = mat?.pbrMetallicRoughness;
  const bcf = pbr?.baseColorFactor;
  const ccExt = mat?.extensions?.KHR_materials_clearcoat;
  const tex = (info: {index: number} | undefined) =>
    info !== undefined && gpuTextures[info.index]
      ? gpuTextures[info.index]
      : null;
  return {
    baseColor: bcf
      ? [bcf[0], bcf[1], bcf[2], bcf[3] ?? 1.0]
      : [0.8, 0.8, 0.8, 1.0],
    metallic: pbr?.metallicFactor ?? 0.1,
    roughness: pbr?.roughnessFactor ?? 0.5,
    clearcoat: ccExt ? (ccExt.clearcoatFactor ?? 1.0) : 0.0,
    clearcoatRoughness: Math.max(0.04, ccExt?.clearcoatRoughnessFactor ?? 0.04),
    texture: tex(pbr?.baseColorTexture),
    metallicRoughnessTexture: tex(pbr?.metallicRoughnessTexture),
    normalTexture: tex(mat?.normalTexture),
    normalScale: mat?.normalTexture?.scale ?? 1.0,
    occlusionTexture: tex(mat?.occlusionTexture),
    occlusionStrength: mat?.occlusionTexture?.strength ?? 1.0,
    isTransmissive:
      (mat?.extensions?.KHR_materials_transmission?.transmissionFactor ?? 0) >
      0,
  };
}

/**
 * Deletes the VAOs, buffers, textures and custom programs owned by `list`
 * (plus `extraTextures`), deleting each texture once.
 */
function deleteMeshListGl(
  gl: WebGL2RenderingContext,
  list: MeshGpu[],
  extraTextures?: Array<WebGLTexture | null>,
): void {
  const deletedTextures = new Set<WebGLTexture>();
  const deleteTex = (tex: WebGLTexture | null | undefined) => {
    if (tex && !deletedTextures.has(tex)) {
      deletedTextures.add(tex);
      gl.deleteTexture(tex);
    }
  };
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
      deleteTex(prim.texture);
      deleteTex(prim.metallicRoughnessTexture);
      deleteTex(prim.normalTexture);
      deleteTex(prim.occlusionTexture);
      const programs = new Set<WebGLProgram>();
      if (prim.customProgram) programs.add(prim.customProgram);
      for (const entry of prim.programCache?.values() ?? []) {
        if (entry.program) programs.add(entry.program);
      }
      for (const p of programs) gl.deleteProgram(p);
    }
  }
  if (extraTextures) {
    for (const tex of extraTextures) {
      deleteTex(tex);
    }
  }
}

function buildGpuScene(
  gl: WebGL2RenderingContext,
  data: GLBData,
  limits: HostSceneLimits = UNBOUNDED_HOST_SCENE_LIMITS,
  onTextureLoad?: () => void,
): ReturnType<typeof buildGpuSceneUnchecked> {
  const track: GpuBuildTrack = {
    meshes: [],
    mesh: null,
    gpuTextures: [],
    vao: null,
    buffers: [],
  };
  try {
    return buildGpuSceneUnchecked(gl, data, limits, onTextureLoad, track);
  } catch (e) {
    // Release everything created before the failure (textures, finished
    // meshes, and the in-progress mesh / primitive) so a bad GLB can't leak.
    const list =
      track.mesh && !track.meshes.includes(track.mesh)
        ? [...track.meshes, track.mesh]
        : track.meshes;
    deleteMeshListGl(gl, list, track.gpuTextures);
    if (track.vao) gl.deleteVertexArray(track.vao);
    for (const buf of track.buffers) gl.deleteBuffer(buf);
    throw e;
  }
}

function buildGpuSceneUnchecked(
  gl: WebGL2RenderingContext,
  data: GLBData,
  limits: HostSceneLimits,
  onTextureLoad: (() => void) | undefined,
  track: GpuBuildTrack,
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
  worldMatrices: Float32Array[];
  gpuTextures: Array<WebGLTexture | null>;
  availableVariants: string[];
} {
  if (!data || !data.gltf) {
    throw new Error(
      'Invalid GLBData passed to buildGpuScene: missing gltf object.',
    );
  }
  const {gltf} = data;
  const meshoptDec = getDecoder('meshopt');
  if (meshoptDec?.decodeBufferViews) {
    meshoptDec.decodeBufferViews(gltf, data);
  }
  const bin = data.bin;
  const meshes: MeshGpu[] = [];
  track.meshes = meshes;

  const availableVariants: string[] = [];
  const rootVarExt = gltf.extensions?.KHR_materials_variants;
  if (rootVarExt && Array.isArray(rootVarExt.variants)) {
    // Keep variant indices aligned with mappings: unnamed variants get a
    // `Variant_<i>` placeholder (matching `extractMaterialVariants`).
    rootVarExt.variants.forEach((v: {name?: unknown} | null, i: number) => {
      availableVariants.push(
        typeof v?.name === 'string' && v.name ? v.name : `Variant_${i}`,
      );
    });
  }

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
  track.gpuTextures = gpuTextures;
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
    track.mesh = meshGpu;

    const instExt = item.node?.extensions?.EXT_mesh_gpu_instancing;
    if (
      instExt &&
      instExt.attributes &&
      typeof instExt.attributes === 'object'
    ) {
      const attrs = instExt.attributes;
      const tAcc =
        attrs.TRANSLATION !== undefined
          ? gltf.accessors?.[attrs.TRANSLATION]
          : null;
      const rAcc =
        attrs.ROTATION !== undefined ? gltf.accessors?.[attrs.ROTATION] : null;
      const sAcc =
        attrs.SCALE !== undefined ? gltf.accessors?.[attrs.SCALE] : null;
      const cAcc =
        attrs._COLOR_0 !== undefined ? gltf.accessors?.[attrs._COLOR_0] : null;
      const rawInstCount = Number(
        tAcc?.count ?? rAcc?.count ?? sAcc?.count ?? 0,
      );
      if (
        !Number.isFinite(rawInstCount) ||
        rawInstCount < 0 ||
        rawInstCount > 10000
      ) {
        throw new Error(
          `SecurityError: EXT_mesh_gpu_instancing exceeds maximum instance limit (10000). Found: ${rawInstCount}`,
        );
      }
      if (rawInstCount > 0) {
        // Reads `rawInstCount` elements honoring componentType, normalized and
        // byteStride. Returns null (attribute skipped, with a warning) when the
        // accessor is short, out of bounds, or yields non-finite values.
        const readAccFloats = (
          acc:
            | {
                bufferView?: number;
                byteOffset?: number;
                componentType?: number;
                normalized?: boolean;
                count?: number;
                type?: string;
              }
            | null
            | undefined,
          comps: number,
        ): Float32Array | null => {
          if (
            !acc ||
            acc.bufferView === undefined ||
            !gltf.bufferViews?.[acc.bufferView]
          ) {
            return null;
          }
          const ct = acc.componentType ?? 5126;
          const skip = (why: string): null => {
            console.warn(
              `[three-live] EXT_mesh_gpu_instancing: skipping accessor (${why})`,
            );
            return null;
          };
          if (
            ct !== 5120 &&
            ct !== 5121 &&
            ct !== 5122 &&
            ct !== 5123 &&
            ct !== 5126
          ) {
            return skip(`componentType ${ct}`);
          }
          if (!(Number(acc.count) >= rawInstCount)) {
            return skip(`count ${acc.count} < ${rawInstCount}`);
          }
          let out: Float32Array | null = null;
          try {
            out = readAccessorAsFloat32(
              gltf,
              bin,
              {...acc, count: rawInstCount},
              comps,
            );
          } catch {
            return skip('out of bounds');
          }
          if (!out || !out.every(Number.isFinite)) {
            return skip('non-finite value');
          }
          return out;
        };
        const tData = readAccFloats(tAcc, 3);
        const rData = readAccFloats(rAcc, 4);
        const sData = readAccFloats(sAcc, 3);
        const cComps = cAcc?.type === 'VEC4' ? 4 : 3;
        const cData = readAccFloats(cAcc, cComps);
        const instMatrices = new Float32Array(rawInstCount * 16);
        const tmpMat = mat4Create();
        for (let inst = 0; inst < rawInstCount; inst++) {
          const t: [number, number, number] = tData
            ? [tData[inst * 3], tData[inst * 3 + 1], tData[inst * 3 + 2]]
            : [0, 0, 0];
          const r: [number, number, number, number] = rData
            ? [
                rData[inst * 4],
                rData[inst * 4 + 1],
                rData[inst * 4 + 2],
                rData[inst * 4 + 3],
              ]
            : [0, 0, 0, 1];
          const s: [number, number, number] = sData
            ? [sData[inst * 3], sData[inst * 3 + 1], sData[inst * 3 + 2]]
            : [1, 1, 1];
          mat4FromRotationTranslationScale(tmpMat, r, t, s);
          instMatrices.set(tmpMat, inst * 16);
        }
        meshGpu.instanceMatrices = instMatrices;
        if (cData) {
          const instColors = new Float32Array(rawInstCount * 3);
          for (let inst = 0; inst < rawInstCount; inst++) {
            instColors[inst * 3] = cData[inst * cComps];
            instColors[inst * 3 + 1] = cData[inst * cComps + 1];
            instColors[inst * 3 + 2] = cData[inst * cComps + 2];
          }
          meshGpu.instanceColors = instColors;
        }
      }
    }

    for (const prim of m.primitives || []) {
      if (prim.extensions?.KHR_draco_mesh_compression) {
        const decoder = getDecoder('draco');
        if (decoder) {
          decoder.decodePrimitive(gltf, prim, bin);
        }
      }
      const buffers: WebGLBuffer[] = [];
      const vao = gl.createVertexArray()!;
      track.vao = vao;
      track.buffers = buffers;
      gl.bindVertexArray(vao);
      const instancedVao = bindInstanceAttributes(gl, meshGpu, buffers);

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
        const expandBounds = (mat: Float32Array) => {
          for (let c = 0; c < 3; c++) {
            let wMin = mat[12 + c];
            let wMax = mat[12 + c];
            for (let j = 0; j < 3; j++) {
              const a = mat[j * 4 + c] * posAcc.min[j];
              const b = mat[j * 4 + c] * posAcc.max[j];
              wMin += a < b ? a : b;
              wMax += a > b ? a : b;
            }
            if (wMin < min[c]) min[c] = wMin;
            if (wMax > max[c]) max[c] = wMax;
          }
        };
        if (meshGpu.instanceMatrices && meshGpu.instanceMatrices.length >= 16) {
          const instCount = meshGpu.instanceMatrices.length >> 4;
          const instWorld = mat4Create();
          for (let inst = 0; inst < instCount; inst++) {
            const instMat = meshGpu.instanceMatrices.subarray(
              inst * 16,
              inst * 16 + 16,
            );
            mat4Multiply(instWorld, trans, instMat);
            expandBounds(instWorld);
          }
        } else {
          expandBounds(trans);
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
        primitiveTextureTransform(gltf, prim),
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
        } else if (idxAcc.componentType === 5121) {
          // UNSIGNED_BYTE indices (valid glTF) are widened to 16-bit.
          idxDataRaw = Uint16Array.from(
            new Uint8Array(bin, idxOffset, idxAcc.count),
          );
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxDataRaw, gl.STATIC_DRAW);
        } else {
          idxDataRaw =
            idxOffset % 2 === 0
              ? new Uint16Array(bin, idxOffset, idxAcc.count)
              : new Uint16Array(
                  bin.slice(idxOffset, idxOffset + idxAcc.count * 2),
                );
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

      const {program: customProgram, uniforms: customUniforms} =
        resolvePrimitiveProgram(gl, prim, mat);

      const matProps = extractMaterialProps(mat, gpuTextures);
      const isTransmissive = Boolean(
        mat?.extensions?.KHR_materials_transmission ||
          pluginData.materials?.isTransmissive,
      );

      const rawMappings = prim.extensions?.KHR_materials_variants?.mappings;
      const variantMappings:
        | Array<{material: number; variants: number[]}>
        | undefined = Array.isArray(rawMappings)
        ? (rawMappings as Array<Record<string, unknown>>)
            .filter(
              (mp) =>
                mp &&
                typeof mp.material === 'number' &&
                Array.isArray(mp.variants),
            )
            .map((mp) => ({
              material: (mp.material as number) | 0,
              variants: (mp.variants as unknown[]).map((v) => Number(v) | 0),
            }))
        : undefined;

      meshGpu.primitives.push({
        vao,
        instanced: instancedVao,
        indexCount,
        indexType,
        ...matProps,
        positions: posData,
        indices: idxDataRaw,
        buffers,
        materialIndex: prim.material,
        defaultMaterialIndex: prim.material,
        variantMappings,
        primitiveDef: prim,
        programCache: new Map([
          [
            prim.material ?? -1,
            {program: customProgram, uniforms: customUniforms},
          ],
        ]),
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
    gpuTextures,
    availableVariants,
  };
}

// =========================================================================
// 4. Arcball Interaction & GPU Color-ID MicroViewer
// =========================================================================

function getOrbitEye(v: {
  customTarget: [number, number, number] | null;
  bounds: {center: [number, number, number]};
  currDistance: number;
  currPhi: number;
  currTheta: number;
}): [number, number, number] {
  const c = v.customTarget || v.bounds.center;
  const cosPhi = v.currDistance * Math.cos(v.currPhi);
  return [
    c[0] + cosPhi * Math.sin(v.currTheta),
    c[1] + v.currDistance * Math.sin(v.currPhi),
    c[2] + cosPhi * Math.cos(v.currTheta),
  ];
}

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
  /** Linear pre-tone-mapping exposure multiplier (model-viewer `exposure`). */
  private exposure = 1.0;
  public shadowIntensity = 0.0;
  public shadowSoftness = 0.5;
  private toneMapping: ToneMappingMode = 'neutral';
  public environmentTexture: WebGLTexture | null = null;
  public animations: AnimationClip[] = [];
  public currentClip: AnimationClip | null = null;
  public animationTime = 0.0;
  public isPlayingAnimation = false;
  public autoplay = false;
  public animationName = '';
  gpuTextures: Array<WebGLTexture | null> = [];
  availableVariants: string[] = [];
  private activeVariantName: string | null = null;
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
  /** View matrix of the pass being rendered (per-eye in XR / stereo). */
  activeViewMatrix: Float32Array | null = null;
  private modelMatrix = mat4Create();
  private mvpMatrix = mat4Create();
  private normalMatrix = new Float32Array(9);

  // Baseline initial camera state (remembered for resetCamera)
  private initialTheta = 0.6;
  private initialPhi = 0.35;
  private initialDistance: number | null = null;
  private customDistance = false;
  private distanceMode: 'auto' | 'relative' | 'absolute' = 'auto';
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
  public xrSessionActive = false;
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
      this.exposure = sanitizeExposure(this.opts.exposure);
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
      this.toneMapping = normalizeToneMapping(this.opts.toneMapping);
    }
    if (this.opts.autoplay !== undefined) {
      this.autoplay = this.opts.autoplay;
    }
    if (this.opts.animationName !== undefined) {
      this.animationName = this.opts.animationName;
    }
    if (this.opts.variantName !== undefined) {
      this.activeVariantName = this.opts.variantName || null;
    }
    if (this.opts.fieldOfView !== undefined) {
      this.fov = (this.opts.fieldOfView * Math.PI) / 180;
    }
    if (this.opts.distanceMode !== undefined) {
      this.distanceMode = this.opts.distanceMode;
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
    this.initGlState();
    this.setupEvents();
    this.setupContextLossHandling();

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

  /** True between `webglcontextlost` and `webglcontextrestored`. */
  public contextLost = false;
  private lastGlbData: GLBData | null = null;
  private lastLimits: HostSceneLimits | undefined;
  private boundContextLost: ((e: Event) => void) | null = null;
  private boundContextRestored: (() => void) | null = null;

  /**
   * Handles WebGL context loss: stops rendering while lost, then on restore
   * recompiles the core programs, rebuilds the picking target, and re-uploads
   * the last model and environment so the viewer recovers without a reload.
   */
  private setupContextLossHandling(): void {
    const c = this.canvas as HTMLCanvasElement;
    if (typeof c?.addEventListener !== 'function') return;
    this.boundContextLost = (e: Event) => {
      e.preventDefault?.();
      this.contextLost = true;
      this.stop();
    };
    this.boundContextRestored = () => this.restoreContext();
    c.addEventListener('webglcontextlost', this.boundContextLost);
    c.addEventListener('webglcontextrestored', this.boundContextRestored);
  }

  private initGlState(): void {
    const gl = this.gl;
    const spec = renderShaderSpec();
    this.renderProg = createProgram(gl, VS_RENDER, spec.fs)!;
    this.pickProg = createProgram(gl, VS_PICK, FS_PICK)!;
    this.uRender = getUniforms(gl, this.renderProg, spec.uniforms);
    this.uPick = getUniforms(gl, this.pickProg, ['uMVP', 'uColorId']);
    this.setupPickingFbo();
  }

  /** Re-creates GPU state after `webglcontextrestored` (public for tests). */
  public restoreContext(): void {
    const gl = this.gl;
    this.contextLost = false;
    this.initGlState();
    for (const plugin of registeredPlugins) {
      plugin.onContextRestored?.(gl, this);
    }
    // Old handles died with the context; drop them without deleting.
    this.meshes = [];
    this.gpuTextures = [];
    this.environmentTexture = null;
    if (this.lastGlbData) {
      this.loadGLBData(this.lastGlbData, this.lastLimits);
    }
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
    this.lastGlbData = glbData;
    this.lastLimits = limits;
    const {
      meshes,
      bounds,
      lights,
      animations,
      worldMatrices,
      gpuTextures,
      availableVariants,
    } = buildGpuScene(this.gl, glbData, limits, () => this.render());
    this.disposeMeshGpuResources();
    this.meshes = meshes;
    this.bounds = bounds;
    this.turntableRotation = 0;
    this.updateTurntableMatrix();
    this.lights = lights;
    this.animations = animations || [];
    this.worldMatrices = worldMatrices || [];
    this.gpuTextures = gpuTextures || [];
    this.availableVariants = availableVariants || [];
    this.gltf = glbData.gltf;
    if (
      this.activeVariantName &&
      !this.applyVariantMaterial(this.activeVariantName)
    ) {
      // The new model does not define the previously selected variant.
      this.activeVariantName = null;
    }

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
      this.initialDistance =
        this.distanceMode === 'absolute' ? 3.0 : bounds.radius * 2.5;
      this.targetDistance = this.initialDistance;
      this.currDistance = this.initialDistance;
    }

    const glbExposure =
      glbData.exposure ??
      glbData.gltf?.extras?.exposure ??
      glbData.gltf?.asset?.extras?.exposure;
    if (glbExposure !== undefined) {
      this.exposure = sanitizeExposure(glbExposure);
    }
    const glbEnvIntensity =
      glbData.environmentIntensity ??
      glbData.gltf?.extras?.environmentIntensity ??
      glbData.gltf?.asset?.extras?.environmentIntensity;
    if (glbEnvIntensity !== undefined) {
      this.envIntensity = Math.max(0, Number(glbEnvIntensity) || 0);
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
   * Immediately clears all foreground scene meshes, animations, and lights so the
   * viewport renders blank while a new scene is being fetched or compiled.
   */
  public clearScene(): void {
    this.disposeMeshGpuResources();
    this.lights = [];
    this.animations = [];
    this.currentClip = null;
    this.isPlayingAnimation = false;
    this.worldMatrices = [];
    this.gltf = null;
    this.initialNodeTransforms = [];
    this.turntableRotation = 0;
    this.updateTurntableMatrix();
    if (this.gl) {
      this.render();
    }
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

  /**
   * Sets the linear exposure applied to all lighting before tone mapping
   * (model-viewer semantics). Image-based lighting strength comes separately
   * from the model's `environmentIntensity` extras.
   */
  public setExposure(exposure: number): void {
    this.exposure = sanitizeExposure(exposure);
  }

  public getExposure(): number {
    return this.exposure;
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

  setToneMapping(mode: ToneMappingMode): void {
    this.toneMapping = normalizeToneMapping(mode);
  }

  getToneMapping(): ToneMappingMode {
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

  getAvailableVariants(): string[] {
    return [...this.availableVariants];
  }

  getVariantName(): string | null {
    return this.activeVariantName;
  }

  selectVariant(name: string | null): boolean {
    const applied = this.applyVariantMaterial(name);
    if (applied && this.gl) {
      this.render();
    }
    return applied;
  }

  private applyVariantMaterial(name: string | null): boolean {
    // Only null / '' reset; a variant literally named 'default' is selectable.
    const isReset = name === null || name === '';
    let variantIdx = -1;
    if (!isReset) {
      variantIdx = this.availableVariants.indexOf(name);
      if (variantIdx < 0) return false;
      this.activeVariantName = name;
    } else {
      this.activeVariantName = null;
    }

    const materials = this.gltf?.materials;
    if (!Array.isArray(materials)) return isReset;

    for (const mesh of this.meshes) {
      for (const prim of mesh.primitives) {
        let targetMatIdx = prim.defaultMaterialIndex;
        if (!isReset && Array.isArray(prim.variantMappings)) {
          for (const mapping of prim.variantMappings) {
            if (
              Array.isArray(mapping.variants) &&
              mapping.variants.includes(variantIdx)
            ) {
              targetMatIdx = mapping.material;
              break;
            }
          }
        }
        const mat =
          targetMatIdx !== undefined ? materials[targetMatIdx] : undefined;
        prim.materialIndex = mat ? targetMatIdx : undefined;
        Object.assign(prim, extractMaterialProps(mat, this.gpuTextures));
        this.applyPrimitiveProgram(prim, prim.materialIndex, mat ?? null);
      }
    }
    return true;
  }

  /** Switches `prim` to the (cached) program resolved for material `matIdx`. */
  private applyPrimitiveProgram(
    prim: PrimitiveGpu,
    matIdx: number | undefined,
    // tslint:disable-next-line:no-any glTF material JSON.
    mat: any,
  ): void {
    if (!this.gl || !prim.primitiveDef) return;
    prim.programCache ??= new Map();
    const key = matIdx ?? -1;
    let entry = prim.programCache.get(key);
    if (!entry) {
      entry = resolvePrimitiveProgram(
        this.gl,
        {...prim.primitiveDef, material: matIdx},
        mat,
      );
      prim.programCache.set(key, entry);
    }
    prim.customProgram = entry.program;
    prim.customUniforms = entry.uniforms;
    if (prim.pluginData) {
      prim.pluginData.materials = prim.isTransmissive
        ? {isTransmissive: true}
        : undefined;
    }
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

  public setDistanceMode(mode: 'auto' | 'relative' | 'absolute'): void {
    this.distanceMode = mode;
    if (!this.customDistance) {
      const d = this.clampDistance(
        this.distanceMode === 'absolute' ? 3.0 : this.bounds.radius * 2.5,
      );
      this.initialDistance = d;
      this.targetDistance = d;
      this.currDistance = d;
      if (
        this.gl &&
        (this.meshes.length > 0 || this.backdropMeshes.length > 0)
      ) {
        this.update(0);
        this.render();
      }
    }
  }

  public getDistanceMode(): 'auto' | 'relative' | 'absolute' {
    return this.distanceMode;
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
    } else {
      this.customDistance = false;
      const d = this.clampDistance(
        this.distanceMode === 'absolute' ? 3.0 : this.bounds.radius * 2.5,
      );
      this.initialDistance = d;
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
      const [eyeX, eyeY, eyeZ] = getOrbitEye(this);
      const eyeToPoint = [wx - eyeX, wy - eyeY, wz - eyeZ];
      const dot = nx * eyeToPoint[0] + ny * eyeToPoint[1] + nz * eyeToPoint[2];
      if (dot > 0.05) {
        visible = false;
      }
    }

    return {x: screenX, y: screenY, z: ndcZ, visible};
  }

  public setSelectedMesh(meshName: string): void {
    this.selectedMeshName = meshName || '';
  }

  getSelectedMesh(): string {
    return this.selectedMeshName;
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
    if (this.boundContextLost) {
      c.removeEventListener('webglcontextlost', this.boundContextLost);
      this.boundContextLost = null;
    }
    if (this.boundContextRestored) {
      c.removeEventListener('webglcontextrestored', this.boundContextRestored);
      this.boundContextRestored = null;
    }
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
    canvasX = this.mapStereoPickX(canvasX, w);
    const vp = mat4Create();
    mat4Multiply(vp, this.projMatrix, this.viewMatrix);

    let candidateMeshes: MeshGpu[] = [];
    const clampedX = Math.max(0, Math.min(w - 1, canvasX));
    const readY = Math.max(0, Math.min(h - 1, h - 1 - canvasY));

    if (this.pickFbo && gl && !this.xrSessionActive) {
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
        const mesh = this.meshes[i] as any;
        // Plugin overlays (handles, particles, strokes) are not pickable.
        if (mesh.visible === false || mesh.isPluginMesh) continue;
        const id = i + 1;
        const r = (id & 0xff) / 255.0;
        const g = ((id >> 8) & 0xff) / 255.0;
        const b = ((id >> 16) & 0xff) / 255.0;
        gl.uniform4f(this.uPick.uColorId, r, g, b, 1.0);

        mat4Multiply(this.modelMatrix, this.modelRootMatrix, mesh.transform);
        const instMats: Float32Array | undefined = mesh.instanceMatrices;
        if (instMats && instMats.length >= 16) {
          const instCount = instMats.length >> 4;
          const instModel = mat4Create();
          for (const prim of mesh.primitives) {
            gl.bindVertexArray(prim.vao);
            for (let inst = 0; inst < instCount; inst++) {
              mat4Multiply(
                instModel,
                this.modelMatrix,
                instMats.subarray(inst * 16, inst * 16 + 16),
              );
              mat4Multiply(this.mvpMatrix, vp, instModel);
              gl.uniformMatrix4fv(this.uPick.uMVP, false, this.mvpMatrix);
              drawPrim(gl, prim);
            }
          }
        } else {
          mat4Multiply(this.mvpMatrix, vp, this.modelMatrix);
          gl.uniformMatrix4fv(this.uPick.uMVP, false, this.mvpMatrix);

          for (const prim of mesh.primitives) {
            gl.bindVertexArray(prim.vao);
            drawPrim(gl, prim);
          }
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

    const [eyeX, eyeY, eyeZ] = getOrbitEye(this);

    const baseModelMat = mat4Create();
    for (const hitMesh of candidateMeshes) {
      mat4Multiply(baseModelMat, this.modelRootMatrix, hitMesh.transform);
      const instMats = hitMesh.instanceMatrices;
      const instCount =
        instMats && instMats.length >= 16 ? instMats.length >> 4 : 1;

      for (let inst = 0; inst < instCount; inst++) {
        if (instMats && instMats.length >= 16) {
          mat4Multiply(
            this.modelMatrix,
            baseModelMat,
            instMats.subarray(inst * 16, inst * 16 + 16),
          );
        } else {
          this.modelMatrix.set(baseModelMat);
        }
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

  public stereoSBS = false;

  /**
   * Maps a canvas X coordinate inside one Stereo SBS eye half onto the
   * equivalent full-canvas X for picking. Each eye uses the same vertical FOV
   * at half the aspect ratio, so eye NDC `n` lands at full-canvas NDC `n / 2`.
   * The ±32 mm eye offset is ignored (sub-pixel at typical viewing distances).
   * Returns `canvasX` unchanged outside inline SBS rendering.
   */
  private mapStereoPickX(canvasX: number, fullW: number): number {
    if (!this.stereoSBS || this.xrSessionActive || fullW < 2) return canvasX;
    const halfW = Math.max(1, Math.floor(fullW * 0.5));
    const inRight = canvasX >= halfW;
    const eyeX = inRight ? canvasX - halfW : canvasX;
    const eyeW = inRight ? Math.max(1, fullW - halfW) : halfW;
    const eyeNdc = ((eyeX + 0.5) / eyeW) * 2 - 1;
    return Math.floor((eyeNdc * 0.5 + 1) * 0.5 * fullW);
  }

  public setStereoSBS(enabled: boolean): void {
    this.stereoSBS = Boolean(enabled);
    if (!this.xrSessionActive) {
      this.syncCameraMatrices();
      this.render();
    }
  }

  private syncCameraMatrices(): void {
    const aspect =
      Math.max(1, this.canvas.width || 1) /
      Math.max(1, this.canvas.height || 1);
    const farPlane =
      this.backdropMeshes.length > 0
        ? Math.max(this.bounds.radius * 20, 120)
        : Math.max(this.bounds.radius * 20, 10);
    mat4Perspective(this.projMatrix, this.fov, aspect, 0.1, farPlane);

    const c = this.customTarget || this.bounds.center;
    mat4LookAt(this.viewMatrix, getOrbitEye(this), c, [0, 1, 0]);
    mat4Multiply(this.mvpMatrix, this.projMatrix, this.viewMatrix);
    mat3NormalFromMat4(this.normalMatrix, this.modelMatrix);
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
      if (!this.xrSessionActive) {
        this.syncCameraMatrices();
      }
    } else if (!this.xrSessionActive && this.projMatrix[0] === 0) {
      this.syncCameraMatrices();
    }
  }

  public getGLContext(): WebGL2RenderingContext {
    return this.gl;
  }

  public setXRSessionActive(active: boolean): void {
    const wasActive = this.xrSessionActive;
    this.xrSessionActive = active;
    if (wasActive && !active) {
      this.xrDepthState.enabled = false;
      for (const plugin of registeredPlugins) {
        plugin.onXRSessionEnd?.(this);
      }
      this.lastTime =
        typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.updateTurntableMatrix();
      if (this.isVisible) {
        try {
          this.resize();
          this.syncCameraMatrices();
          this.render();
        } catch (err) {
          // Never let a post-session redraw abort WebXR session teardown.
          this.reportRenderError(err);
        }
      }
    }
  }

  private renderErrorReported = false;

  /** Logs the first per-frame render error once so failures stay debuggable. */
  private reportRenderError(err: unknown): void {
    if (this.renderErrorReported) return;
    this.renderErrorReported = true;
    if (typeof console !== 'undefined') {
      console.warn('[three-live] render frame failed:', err);
    }
  }

  public stepXRUpdate(dt: number): void {
    for (const plugin of registeredPlugins) {
      plugin.onUpdate?.(this, dt);
    }
  }

  public start(): void {
    if (this.animFrameId !== null) return;
    this.lastTime =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const renderLoop = (time: number) => {
      if (this.animFrameId === null) return;
      const dt = Math.min(Math.max((time - this.lastTime) / 1000, 0), 0.1);
      this.lastTime = time;

      if (this.isVisible && !this.xrSessionActive) {
        try {
          this.resize();
          this.update(dt);
          this.render();
        } catch (err) {
          // Keep animation loop alive across transient plugin/context errors.
          this.reportRenderError(err);
        }
      }
      if (this.animFrameId !== null) {
        this.animFrameId = requestAnimationFrame(renderLoop);
      }
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

    this.syncCameraMatrices();

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
    /** `'texture-array'` for per-eye GPU depth layers (e.g. Quest 3). */
    textureType?: 'texture' | 'texture-array';
    /** Array layer to sample when `textureType` is `'texture-array'`. */
    layer?: number;
    /**
     * Near/far planes of non-linear (projected) GPU depth. When `depthFar >
     * depthNear`, samples are linearized instead of scaled by
     * `rawValueToMeters`.
     */
    depthNear?: number;
    depthFar?: number;
    /**
     * World-to-clip matrix of the depth camera. When set, fragments are
     * reprojected into the depth camera instead of using `uvTransform`.
     */
    depthViewProj?: Float32Array | null;
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
    isAR = true,
    viewIndex = 0,
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
    if (placementMatrix) {
      this.modelRootMatrix.set(placementMatrix);
    } else if (isPlaced && placementMatrix) {
      this.modelRootMatrix.set(placementMatrix);
    }
    this.render({
      viewMatrix,
      projMatrix,
      eyePos,
      viewport,
      eye: (xrView?.eye as 'left' | 'right' | 'none') || 'none',
      clear: viewIndex > 0 ? false : xrView?.eye !== 'right',
      isAR,
    });
  }

  render(xrOverride?: {
    viewMatrix: Float32Array;
    projMatrix: Float32Array;
    eyePos: [number, number, number];
    viewport?: [number, number, number, number];
    eye?: 'left' | 'right' | 'none';
    clear?: boolean;
    isAR?: boolean;
  }): void {
    if (this.contextLost) return;
    if (!xrOverride && this.stereoSBS) {
      const fullW = Math.max(2, this.canvas.width || 2);
      const fullH = Math.max(1, this.canvas.height || 1);
      const halfW = Math.max(1, Math.floor(fullW * 0.5));
      const rightW = Math.max(1, fullW - halfW);
      const farPlane =
        this.backdropMeshes.length > 0
          ? Math.max(this.bounds.radius * 20, 120)
          : Math.max(this.bounds.radius * 20, 10);
      const c = this.customTarget || this.bounds.center;
      const [baseEyeX, baseEyeY, baseEyeZ] = getOrbitEye(this);
      const rightVecX = Math.cos(this.currTheta);
      const rightVecZ = -Math.sin(this.currTheta);
      const halfIpd = 0.032;

      const leftProj = mat4Create();
      const leftView = mat4Create();
      const leftEye: [number, number, number] = [
        baseEyeX - rightVecX * halfIpd,
        baseEyeY,
        baseEyeZ - rightVecZ * halfIpd,
      ];
      const leftTarget: [number, number, number] = [
        c[0] - rightVecX * halfIpd * 0.25,
        c[1],
        c[2] - rightVecZ * halfIpd * 0.25,
      ];
      mat4Perspective(leftProj, this.fov, halfW / fullH, 0.1, farPlane);
      mat4LookAt(leftView, leftEye, leftTarget, [0, 1, 0]);

      const rightProj = mat4Create();
      const rightView = mat4Create();
      const rightEye: [number, number, number] = [
        baseEyeX + rightVecX * halfIpd,
        baseEyeY,
        baseEyeZ + rightVecZ * halfIpd,
      ];
      const rightTarget: [number, number, number] = [
        c[0] + rightVecX * halfIpd * 0.25,
        c[1],
        c[2] + rightVecZ * halfIpd * 0.25,
      ];
      mat4Perspective(rightProj, this.fov, rightW / fullH, 0.1, farPlane);
      mat4LookAt(rightView, rightEye, rightTarget, [0, 1, 0]);

      this.render({
        viewMatrix: leftView,
        projMatrix: leftProj,
        eyePos: leftEye,
        viewport: [0, 0, halfW, fullH],
        eye: 'left',
        clear: true,
        isAR: false,
      });
      this.render({
        viewMatrix: rightView,
        projMatrix: rightProj,
        eyePos: rightEye,
        viewport: [halfW, 0, rightW, fullH],
        eye: 'right',
        clear: false,
        isAR: false,
      });
      this.gl.viewport(0, 0, fullW, fullH);
      return;
    }

    const gl = this.gl;
    let vpX = 0;
    let vpY = 0;
    let vpW = this.canvas.width;
    let vpH = this.canvas.height;
    if (xrOverride?.viewport) {
      vpX = xrOverride.viewport[0];
      vpY = xrOverride.viewport[1];
      vpW = xrOverride.viewport[2];
      vpH = xrOverride.viewport[3];
      gl.viewport(vpX, vpY, vpW, vpH);
    } else {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    gl.enable(gl.DEPTH_TEST);
    if (!xrOverride || xrOverride.clear !== false) {
      if (xrOverride?.isAR) {
        gl.clearColor(0, 0, 0, 0);
      } else {
        gl.clearColor(
          this.clearColor[0],
          this.clearColor[1],
          this.clearColor[2],
          this.clearColor[3],
        );
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    const vp = mat4Create();
    const activeView = xrOverride?.viewMatrix ?? this.viewMatrix;
    this.activeViewMatrix = activeView;
    mat4Multiply(vp, xrOverride?.projMatrix ?? this.projMatrix, activeView);
    const xrDepth = getSharedRegistry().xrDepthShader;

    const toneMode = toneMappingShaderIndex(this.toneMapping);

    const [eyeX, eyeY, eyeZ] = xrOverride
      ? xrOverride.eyePos
      : getOrbitEye(this);

    for (const plugin of registeredPlugins) {
      (plugin as any).onBeforeDrawScene?.(
        this,
        gl,
        vp,
        [eyeX, eyeY, eyeZ],
        toneMode,
      );
    }

    const numBackdrop = xrOverride?.isAR ? 0 : this.backdropMeshes.length;
    if (this.meshes.length === 0 && numBackdrop === 0) return;

    const currentEye = xrOverride?.eye || 'none';
    let hasTransmissive = false;
    const renderList =
      numBackdrop > 0 ? [...this.backdropMeshes, ...this.meshes] : this.meshes;
    const drawPass = (transmissivePass: boolean) => {
      for (let i = 0; i < renderList.length; i++) {
        const mesh = renderList[i];
        if ((mesh as any).visible === false) continue;
        const isSelected =
          this.selectedMeshName !== '' && mesh.name === this.selectedMeshName;

        if (
          i < numBackdrop ||
          (mesh as any).worldSpace === true ||
          mesh.name === '__xr_reticle__'
        ) {
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
          if (u.uExposure) gl.uniform1f(u.uExposure, this.exposure);
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
          xrDepth?.bind(gl, u, this.xrDepthState, activeView, [
            vpX,
            vpY,
            Math.max(1, vpW),
            Math.max(1, vpH),
          ]);

          if (this.environmentTexture) {
            gl.activeTexture(gl.TEXTURE4);
            gl.bindTexture(gl.TEXTURE_2D, this.environmentTexture);
            gl.uniform1i(u.uEnvironmentMap, 4);
            gl.uniform1i(u.uHasEnvironmentMap, 1);
          } else {
            gl.uniform1i(u.uHasEnvironmentMap, 0);
          }

          this.bindLights(u);
          if (u.uSectionEnabled) gl.uniform1i(u.uSectionEnabled, 0);

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
          if (u.uClearcoat) {
            gl.uniform2f(
              u.uClearcoat,
              prim.clearcoat ?? 0,
              prim.clearcoatRoughness ?? 0.04,
            );
          }

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
          const instMats = mesh.instanceMatrices;
          if (
            instMats &&
            instMats.length >= 16 &&
            prim.instanced &&
            u.uInstanced &&
            u.uViewProj
          ) {
            // EXT_mesh_gpu_instancing: one instanced draw per primitive.
            const instCount = instMats.length >> 4;
            gl.uniform1i(u.uInstanced, 1);
            gl.uniformMatrix4fv(u.uViewProj, false, vp);
            if (prim.indices) {
              gl.drawElementsInstanced(
                gl.TRIANGLES,
                prim.indexCount,
                prim.indexType,
                0,
                instCount,
              );
            } else {
              gl.drawArraysInstanced(
                gl.TRIANGLES,
                0,
                prim.indexCount,
                instCount,
              );
            }
            gl.uniform1i(u.uInstanced, 0);
          } else if (instMats && instMats.length >= 16) {
            const instCount = instMats.length >> 4;
            const instColors = mesh.instanceColors;
            const instModel = mat4Create();
            const instNormal = new Float32Array(9);
            const tintedColor: [number, number, number, number] = [
              prim.baseColor[0],
              prim.baseColor[1],
              prim.baseColor[2],
              prim.baseColor[3],
            ];
            for (let inst = 0; inst < instCount; inst++) {
              mat4Multiply(
                instModel,
                this.modelMatrix,
                instMats.subarray(inst * 16, inst * 16 + 16),
              );
              mat4Multiply(this.mvpMatrix, vp, instModel);
              mat3NormalFromMat4(instNormal, instModel);
              gl.uniformMatrix4fv(u.uMVP, false, this.mvpMatrix);
              gl.uniformMatrix4fv(u.uModel, false, instModel);
              gl.uniformMatrix3fv(u.uNormalMatrix, false, instNormal);
              if (instColors) {
                tintedColor[0] = prim.baseColor[0] * instColors[inst * 3];
                tintedColor[1] = prim.baseColor[1] * instColors[inst * 3 + 1];
                tintedColor[2] = prim.baseColor[2] * instColors[inst * 3 + 2];
                tintedColor[3] = prim.baseColor[3];
                gl.uniform4fv(u.uBaseColor, tintedColor);
              }
              drawPrim(gl, prim);
            }
          } else {
            drawPrim(gl, prim);
          }
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
      plugin.onAfterRender?.(
        gl, this, vp, xrOverride?.eye ?? 'none',
        [vpX, vpY, vpW, vpH], xrOverride?.projMatrix ?? this.projMatrix,
      );
    }
  }

  private disposeMeshListGpuResources(
    list: MeshGpu[],
    extraTextures?: Array<WebGLTexture | null>,
  ): void {
    deleteMeshListGl(this.gl, list, extraTextures);
  }

  private disposeMeshGpuResources(): void {
    this.disposeMeshListGpuResources(this.meshes, this.gpuTextures);
    this.meshes = [];
    this.gpuTextures = [];
    this.availableVariants = [];
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
