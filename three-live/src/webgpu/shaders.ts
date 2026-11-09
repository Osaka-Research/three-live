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
 */

/**
 * @fileoverview WGSL shaders, uniform/storage buffer layouts, and packing
 * utilities for the `three-live-webgpu` `GPURenderBundle` scene accelerator.
 */

/** Byte size of the per-frame `SceneUniforms` buffer (29 x 16B = 464B). */
export const SCENE_UNIFORM_BYTES = 464;

/** Stride in 32-bit words of one `PartInstance` entry in the storage buffer. */
export const PART_STRIDE_WORDS = 32;

/** Stride in bytes of one `PartInstance` entry in the storage buffer (128B). */
export const PART_STRIDE_BYTES = 128;

/** Stride in 32-bit floats of one interleaved vertex (`pos + normal + uv`). */
export const VERTEX_STRIDE_FLOATS = 8;

/** Stride in bytes of one interleaved vertex (32B). */
export const VERTEX_STRIDE_BYTES = 32;

/** Part flag: `model` is already in world space (skip `sc.modelRoot`). */
export const PART_FLAG_WORLD_SPACE = 1;
/** Part flag: primitive binds a baseColor texture at `@group(1) @binding(0)`. */
export const PART_FLAG_HAS_BASE_TEX = 2;
/** Part flag: primitive binds a metallicRoughness texture at `@binding(1)`. */
export const PART_FLAG_HAS_MR_TEX = 4;
/** Part flag: primitive binds a tangent-free normal map at `@binding(2)`. */
export const PART_FLAG_HAS_NORMAL_TEX = 8;
/** Part flag: primitive binds an ambient occlusion map at `@binding(3)`. */
export const PART_FLAG_HAS_OCC_TEX = 16;
/** Part flag: primitive binds an emissive map at `@binding(4)`. */
export const PART_FLAG_HAS_EMISSIVE_TEX = 32;
/** Part flag: skip CAD section-plane clipping (backdrop / plugin gizmo). */
export const PART_FLAG_NO_SECTION_CLIP = 64;
/** Part flag: instance is currently hidden (`mesh.visible === false`). */
export const PART_FLAG_HIDDEN = 128;
/** Part flag shift for inline stereo UV mode (`0=none`, `1=sbs`, `2=ou`). */
export const PART_STEREO_SHIFT = 8;

/** Scene flag bit: equirectangular `environment-image` texture is bound. */
export const SCENE_FLAG_HAS_ENV_MAP = 1;
/** Scene flag bit: CAD section-plane clipping is enabled. */
export const SCENE_FLAG_SECTION_ENABLED = 2;
/** Scene flag bit: current pass renders the right stereo eye. */
export const SCENE_FLAG_RIGHT_EYE = 4;

/** Scene light descriptor matching `ThreeView`'s `LightGpu`. */
export interface SceneLightInput {
  readonly type: 'ambient' | 'directional' | 'point' | 'spot' | 'hemisphere';
  readonly color?: readonly number[];
  readonly groundColor?: readonly number[];
  readonly intensity?: number;
  readonly position?: readonly number[];
  readonly direction?: readonly number[];
  readonly innerConeAngle?: number;
  readonly outerConeAngle?: number;
}

/** Input parameters for packing the per-frame `SceneUniforms` buffer. */
export interface SceneUniformInput {
  readonly vp: ArrayLike<number>;
  readonly modelRoot: ArrayLike<number>;
  readonly eyePos: readonly [number, number, number];
  readonly exposure: number;
  readonly envIntensity: number;
  readonly toneMappingIndex: number;
  readonly lights: readonly SceneLightInput[];
  readonly hasEnvMap: boolean;
  readonly isRightEye?: boolean;
  readonly sectionPlane?: {
    readonly enabled: boolean;
    readonly normal: readonly [number, number, number];
    readonly constant: number;
  } | null;
  readonly contactShadow?: {
    readonly centerX: number;
    readonly floorY: number;
    readonly centerZ: number;
    readonly halfExtentX: number;
    readonly halfExtentZ: number;
    readonly intensity: number;
    readonly softness: number;
  } | null;
}

/**
 * Remaps an OpenGL column-major clip-space matrix (`z_ndc in [-1, 1]`) into
 * WebGPU clip-space (`z_ndc in [0, 1]`) via `z' = 0.5 * (z + w)`.
 */
export function remapClipDepthToZeroOne(
  out: Float32Array,
  vp: ArrayLike<number>,
): Float32Array {
  for (let c = 0; c < 4; c++) {
    const b = c * 4;
    const z = vp[b + 2];
    const w = vp[b + 3];
    out[b] = vp[b];
    out[b + 1] = vp[b + 1];
    out[b + 2] = 0.5 * (z + w);
    out[b + 3] = w;
  }
  return out;
}

/**
 * Packs per-frame camera, lighting, tone-mapping, section-plane, and contact
 * shadow uniforms into `buf` (`SCENE_UNIFORM_BYTES` = 464 bytes).
 */
export function writeSceneUniforms(
  buf: ArrayBuffer,
  input: SceneUniformInput,
): void {
  const f32 = new Float32Array(buf, 0, 116);
  const u32 = new Uint32Array(buf, 0, 116);
  f32.fill(0);

  remapClipDepthToZeroOne(f32.subarray(0, 16), input.vp);
  for (let i = 0; i < 16; i++) {
    f32[16 + i] = input.modelRoot[i] ?? (i % 5 === 0 ? 1 : 0);
  }

  f32[32] = input.eyePos[0];
  f32[33] = input.eyePos[1];
  f32[34] = input.eyePos[2];
  f32[35] = Number.isFinite(input.exposure) ? Math.max(0, input.exposure) : 1.0;

  let ambR = 0.28;
  let ambG = 0.28;
  let ambB = 0.28;
  let hasHemi = false;
  let hemiAxisX = 0;
  let hemiAxisY = 1;
  let hemiAxisZ = 0;
  let numDir = 0;
  let numPt = 0;

  for (const l of input.lights) {
    const col = l.color ?? [1, 1, 1];
    const intensity = l.intensity !== undefined ? l.intensity : 1.0;
    if (l.type === 'ambient') {
      ambR = (col[0] ?? 1) * intensity;
      ambG = (col[1] ?? 1) * intensity;
      ambB = (col[2] ?? 1) * intensity;
    } else if (l.type === 'hemisphere') {
      hasHemi = true;
      const gc = l.groundColor ?? [0.2, 0.2, 0.2];
      const s = intensity * 0.65;
      f32[40] += (col[0] ?? 1) * s;
      f32[41] += (col[1] ?? 1) * s;
      f32[42] += (col[2] ?? 1) * s;
      f32[44] += (gc[0] ?? 0.2) * s;
      f32[45] += (gc[1] ?? 0.2) * s;
      f32[46] += (gc[2] ?? 0.2) * s;
      const p = l.position ?? [0, 1, 0];
      const pl = Math.hypot(p[0] ?? 0, p[1] ?? 1, p[2] ?? 0);
      if (pl > 1e-5) {
        hemiAxisX = (p[0] ?? 0) / pl;
        hemiAxisY = (p[1] ?? 1) / pl;
        hemiAxisZ = (p[2] ?? 0) / pl;
      }
    } else if (l.type === 'directional' && numDir < 2) {
      const d = l.direction ?? [0.5, 1.0, 0.8];
      const base = 52 + numDir * 8;
      f32[base] = d[0] ?? 0.5;
      f32[base + 1] = d[1] ?? 1.0;
      f32[base + 2] = d[2] ?? 0.8;
      f32[base + 4] = (col[0] ?? 1) * intensity;
      f32[base + 5] = (col[1] ?? 1) * intensity;
      f32[base + 6] = (col[2] ?? 1) * intensity;
      numDir++;
    } else if ((l.type === 'point' || l.type === 'spot') && numPt < 2) {
      const p = l.position ?? [0, 0, 0];
      const base = 68 + numPt * 16;
      f32[base] = p[0] ?? 0;
      f32[base + 1] = p[1] ?? 0;
      f32[base + 2] = p[2] ?? 0;
      f32[base + 4] = (col[0] ?? 1) * intensity;
      f32[base + 5] = (col[1] ?? 1) * intensity;
      f32[base + 6] = (col[2] ?? 1) * intensity;
      if (l.type === 'spot') {
        const sd = l.direction ?? [0, -1, 0];
        const outer = Math.max(
          0.01,
          Math.min(Math.PI / 2, l.outerConeAngle ?? Math.PI / 3),
        );
        const inner = Math.max(
          0,
          Math.min(outer - 1e-4, l.innerConeAngle ?? 0),
        );
        const sl = Math.hypot(sd[0] ?? 0, sd[1] ?? -1, sd[2] ?? 0) || 1;
        f32[base + 8] = (sd[0] ?? 0) / sl;
        f32[base + 9] = (sd[1] ?? -1) / sl;
        f32[base + 10] = (sd[2] ?? 0) / sl;
        f32[base + 12] = Math.cos(inner);
        f32[base + 13] = Math.cos(outer);
      } else {
        f32[base + 9] = -1;
        f32[base + 12] = -2;
        f32[base + 13] = -3;
      }
      numPt++;
    }
  }

  if (numDir === 0 && !hasHemi) {
    f32[52] = 0.5;
    f32[53] = 1.0;
    f32[54] = 0.8;
    f32[56] = 1.0;
    f32[57] = 1.0;
    f32[58] = 1.0;
    numDir = 1;
  }

  f32[36] = ambR;
  f32[37] = ambG;
  f32[38] = ambB;
  f32[39] = Number.isFinite(input.envIntensity)
    ? Math.max(0, input.envIntensity)
    : 1.0;
  f32[48] = hemiAxisX;
  f32[49] = hemiAxisY;
  f32[50] = hemiAxisZ;

  let sceneBits = 0;
  if (input.hasEnvMap) {
    sceneBits |= SCENE_FLAG_HAS_ENV_MAP;
  }
  if (input.sectionPlane?.enabled) {
    sceneBits |= SCENE_FLAG_SECTION_ENABLED;
    f32[100] = input.sectionPlane.normal[0];
    f32[101] = input.sectionPlane.normal[1];
    f32[102] = input.sectionPlane.normal[2];
    f32[103] = input.sectionPlane.constant;
  }
  if (input.isRightEye) {
    sceneBits |= SCENE_FLAG_RIGHT_EYE;
  }

  if (input.contactShadow && input.contactShadow.intensity > 0) {
    f32[104] = input.contactShadow.centerX;
    f32[105] = input.contactShadow.floorY;
    f32[106] = input.contactShadow.centerZ;
    f32[107] = Math.max(0.01, input.contactShadow.halfExtentX);
    f32[108] = Math.max(0.01, input.contactShadow.halfExtentZ);
    f32[109] = Math.min(1, Math.max(0, input.contactShadow.intensity));
    f32[110] = Math.min(1, Math.max(0, input.contactShadow.softness));
  }

  u32[112] = Math.max(0, input.toneMappingIndex | 0) >>> 0;
  u32[113] = numDir >>> 0;
  u32[114] = numPt >>> 0;
  u32[115] = sceneBits >>> 0;
}

const SHARED_SCENE_STRUCTS_WGSL = /* wgsl */ `
struct SceneUniforms {
  viewProj: mat4x4<f32>,
  modelRoot: mat4x4<f32>,
  camAndExp: vec4<f32>,
  ambAndEnv: vec4<f32>,
  hemiSky: vec4<f32>,
  hemiGround: vec4<f32>,
  hemiAxis: vec4<f32>,
  dirDir0: vec4<f32>,
  dirCol0: vec4<f32>,
  dirDir1: vec4<f32>,
  dirCol1: vec4<f32>,
  ptPos0: vec4<f32>,
  ptCol0: vec4<f32>,
  ptSpotDir0: vec4<f32>,
  ptSpotCone0: vec4<f32>,
  ptPos1: vec4<f32>,
  ptCol1: vec4<f32>,
  ptSpotDir1: vec4<f32>,
  ptSpotCone1: vec4<f32>,
  sectionPlane: vec4<f32>,
  shadowBox: vec4<f32>,
  shadowParams: vec4<f32>,
  flags: vec4<u32>,
};

struct PartInstance {
  model: mat4x4<f32>,
  baseColor: vec4<f32>,
  pbr: vec4<f32>,
  emissive: vec4<f32>,
  aux: vec2<f32>,
  flags: u32,
  pickId: u32,
};

@group(0) @binding(0) var<uniform> sc: SceneUniforms;
@group(0) @binding(1) var<storage, read> parts: array<PartInstance>;
@group(0) @binding(2) var linSampler: sampler;
@group(0) @binding(3) var envTex: texture_2d<f32>;
`;

/**
 * Storage-buffer + `GPURenderBundle` WGSL PBR shader matching `ThreeView`'s
 * microfacet lighting, IBL, clearcoat, normal/AO/emissive maps, section-plane
 * clipping, and Khronos Neutral / ACES / AgX / Reinhard tone-mapping curves.
 *
 * All derivative (`dpdx`/`dpdy`, Y-flipped to match WebGL2's bottom-up Y) and
 * mipmapped `textureSample` operations run unconditionally at the top of
 * `fsMain` in uniform control flow for strict W3C WGSL uniformity compliance.
 */
export const SCENE_PBR_WGSL =
  SHARED_SCENE_STRUCTS_WGSL +
  /* wgsl */ `
@group(1) @binding(0) var baseTex: texture_2d<f32>;
@group(1) @binding(1) var mrTex: texture_2d<f32>;
@group(1) @binding(2) var normTex: texture_2d<f32>;
@group(1) @binding(3) var occTex: texture_2d<f32>;
@group(1) @binding(4) var emTex: texture_2d<f32>;

struct VsOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(3) @interpolate(flat) instIdx: u32,
};

@vertex
fn vsMain(
  @location(0) aPos: vec3<f32>,
  @location(1) aNormal: vec3<f32>,
  @location(2) aUV: vec2<f32>,
  @builtin(instance_index) instIdx: u32,
) -> VsOut {
  let p = parts[instIdx];
  var out: VsOut;
  if ((p.flags & 128u) != 0u) {
    out.clipPos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.normal = vec3<f32>(0.0, 1.0, 0.0);
    out.uv = vec2<f32>(0.0);
    out.instIdx = instIdx;
    return out;
  }
  var m: mat4x4<f32>;
  if ((p.flags & 1u) != 0u) {
    m = p.model;
  } else {
    m = sc.modelRoot * p.model;
  }
  let world = m * vec4<f32>(aPos, 1.0);

  let c0 = m[0].xyz;
  let c1 = m[1].xyz;
  let c2 = m[2].xyz;
  let adj0 = cross(c1, c2);
  let adj1 = cross(c2, c0);
  let adj2 = cross(c0, c1);
  let det = dot(c0, adj0);
  var rawN = vec3<f32>(0.0);
  if (abs(det) > 1e-12) {
    let sgn = select(-1.0, 1.0, det > 0.0);
    rawN = (adj0 * aNormal.x + adj1 * aNormal.y + adj2 * aNormal.z) * sgn;
  } else {
    rawN = c0 * aNormal.x + c1 * aNormal.y + c2 * aNormal.z;
  }
  let nLen = length(rawN);

  let stereoMode = (p.flags >> 8u) & 3u;
  let isRight = (sc.flags.w & 4u) != 0u;
  var uv = aUV;
  if (stereoMode == 1u) {
    uv = vec2<f32>(aUV.x * 0.5 + select(0.0, 0.5, isRight), aUV.y);
  } else if (stereoMode == 2u) {
    uv = vec2<f32>(aUV.x, aUV.y * 0.5 + select(0.0, 0.5, isRight));
  }

  out.clipPos = sc.viewProj * world;
  out.worldPos = world.xyz;
  out.normal = select(vec3<f32>(0.0), rawN / nLen, nLen > 1e-5);
  out.uv = uv;
  out.instIdx = instIdx;
  return out;
}

fn envBRDF(r: f32, n: f32) -> vec2<f32> {
  let c0 = vec4<f32>(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4<f32>(1.0, 0.0425, 1.04, -0.04);
  let rv = r * c0 + c1;
  let a = min(rv.x * rv.x, exp2(-9.28 * n)) * rv.x + rv.y;
  return vec2<f32>(-1.04, 1.04) * a + rv.zw;
}

fn fSchlickRoughness(f0: vec3<f32>, r: f32, n: f32) -> vec3<f32> {
  return f0 + (max(vec3<f32>(1.0 - r), f0) - f0) * pow(clamp(1.0 - n, 0.0, 1.0), 5.0);
}

fn getStudioRadiance(rDir: vec3<f32>, r: f32) -> vec3<f32> {
  let kd = normalize(vec3<f32>(0.0, 1.0, 0.35));
  let fd = normalize(vec3<f32>(-0.85, 0.45, -0.35));
  let ki = pow(max(dot(rDir, kd), 0.0), mix(96.0, 1.5, r)) * mix(2.4, 0.5, r);
  let fi = pow(max(dot(rDir, fd), 0.0), mix(36.0, 1.2, r)) * mix(1.3, 0.35, r);
  let ri = pow(clamp(1.0 - abs(rDir.y), 0.0, 1.0), 3.5) * mix(0.55, 0.22, r);
  return mix(vec3<f32>(0.06, 0.06, 0.08), vec3<f32>(0.48, 0.50, 0.55), rDir.y * 0.5 + 0.5)
    + vec3<f32>(1.0, 0.98, 0.94) * ki
    + vec3<f32>(0.85, 0.92, 1.0) * fi
    + vec3<f32>(0.65, 0.72, 0.85) * ri;
}

fn equirectangularUV(dir: vec3<f32>) -> vec2<f32> {
  let d = normalize(dir);
  return vec2<f32>(
    atan2(d.z, d.x) * 0.15915494309 + 0.5,
    0.5 - asin(clamp(d.y, -1.0, 1.0)) * 0.31830988618,
  );
}

fn neutralToneMapping(cIn: vec3<f32>) -> vec3<f32> {
  var c = cIn;
  let x = min(c.r, min(c.g, c.b));
  c -= select(0.04, x - 6.25 * x * x, x < 0.08);
  let p = max(c.r, max(c.g, c.b));
  if (p < 0.76) {
    return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  }
  let n = 1.0 - 0.0576 / (p - 0.52);
  c *= n / p;
  return clamp(mix(c, vec3<f32>(n), 1.0 - 1.0 / (0.15 * (p - n) + 1.0)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn acesToneMapping(cIn: vec3<f32>) -> vec3<f32> {
  let c = cIn * 0.6;
  return clamp((c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn agxToneMapping(cIn: vec3<f32>) -> vec3<f32> {
  let c = max(cIn, vec3<f32>(0.0));
  let inset = mat3x3<f32>(
    vec3<f32>(0.84247906, 0.04232824, 0.04237565),
    vec3<f32>(0.0784336, 0.87846864, 0.0784336),
    vec3<f32>(0.07922375, 0.07916613, 0.87914297),
  ) * c;
  let e = clamp((log2(max(inset, vec3<f32>(1e-6))) + 12.47393) / 16.5, vec3<f32>(0.0), vec3<f32>(1.0));
  let x2 = e * e;
  let x4 = x2 * x2;
  let s = 15.5 * x4 * x2 - 40.14 * x4 * e + 31.96 * x4 - 6.868 * x2 * e + 0.4298 * x2 + 0.1191 * e - 0.00232;
  let outset = mat3x3<f32>(
    vec3<f32>(1.196879, -0.05289685, -0.05297164),
    vec3<f32>(-0.09802088, 1.15190313, -0.09804345),
    vec3<f32>(-0.09902974, -0.09896118, 1.15107367),
  ) * s;
  return clamp(pow(max(outset, vec3<f32>(0.0)), vec3<f32>(2.2)), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn applyToneMapping(c: vec3<f32>, mode: u32) -> vec3<f32> {
  if (mode == 0u) { return neutralToneMapping(c); }
  if (mode == 1u) { return c / (c + vec3<f32>(1.0)); }
  if (mode == 3u) { return acesToneMapping(c); }
  if (mode == 4u) { return agxToneMapping(c); }
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn evalLight(lDir: vec3<f32>, vDir: vec3<f32>, nDir: vec3<f32>, baseRgb: vec3<f32>, specExp: f32, specW: f32, cc: vec2<f32>) -> vec3<f32> {
  let h = max(dot(nDir, normalize(lDir + vDir)), 0.0);
  return baseRgb * max(dot(nDir, lDir), 0.0) * 0.75
    + vec3<f32>(pow(h, specExp) * specW + cc.x * pow(h, mix(64.0, 512.0, 1.0 - cc.y)) * 0.35);
}

@fragment
fn fsMain(in: VsOut, @builtin(front_facing) frontFacing: bool) -> @location(0) vec4<f32> {
  let p1 = dpdx(in.worldPos);
  let p2 = -dpdy(in.worldPos);
  let u1 = dpdx(in.uv);
  let u2 = -dpdy(in.uv);
  let baseTexel = textureSample(baseTex, linSampler, in.uv);
  let mrTexel = textureSample(mrTex, linSampler, in.uv);
  let normTexel = textureSample(normTex, linSampler, in.uv);
  let occTexel = textureSample(occTex, linSampler, in.uv);
  let emTexel = textureSample(emTex, linSampler, in.uv);

  let p = parts[in.instIdx];
  let pFlags = p.flags;
  let secOn = (sc.flags.w & 2u) != 0u && (pFlags & 64u) == 0u;
  if (secOn && dot(in.worldPos, sc.sectionPlane.xyz) > sc.sectionPlane.w) {
    discard;
  }

  var base = p.baseColor;
  if ((pFlags & 2u) != 0u) {
    base *= baseTexel;
  }
  if (base.a < 0.004) {
    discard;
  }

  var em = p.emissive.xyz;
  if ((pFlags & 32u) != 0u) {
    em *= emTexel.rgb;
  }
  let selGlow = vec3<f32>(p.emissive.w * 0.35, p.emissive.w * 0.5, p.emissive.w * 0.7);

  let nInLen = length(in.normal);
  if (nInLen < 1e-4 && (pFlags & 2u) != 0u) {
    let unlit = clamp(base.rgb + em + selGlow, vec3<f32>(0.0), vec3<f32>(1.0));
    return vec4<f32>(unlit * base.a, base.a);
  }

  var N: vec3<f32>;
  if (nInLen < 1e-4) {
    let flatCross = cross(p1, p2);
    let fLen = length(flatCross);
    N = select(vec3<f32>(0.0, 1.0, 0.0), flatCross / fLen, fLen > 1e-8);
  } else {
    N = in.normal / nInLen;
  }
  if (!frontFacing) {
    N = -N;
  }

  let toCam = sc.camAndExp.xyz - in.worldPos;
  let camDist = length(toCam);
  let V = select(vec3<f32>(0.0, 0.0, 1.0), toCam / camDist, camDist > 1e-6);

  if ((pFlags & 8u) != 0u) {
    var q = normTexel.xyz * 2.0 - 1.0;
    q = vec3<f32>(q.xy * p.aux.x, q.z);
    let c2 = cross(p2, N);
    let c1 = cross(N, p1);
    let T = c2 * u1.x + c1 * u2.x;
    let B = c2 * u1.y + c1 * u2.y;
    let maxTB = max(dot(T, T), dot(B, B));
    if (maxTB > 1e-12 && length(q) > 1e-5) {
      let k = inverseSqrt(maxTB);
      N = normalize(mat3x3<f32>(T * k, B * k, N) * normalize(q));
    }
  }

  var metallic = p.pbr.x;
  var roughness = p.pbr.y;
  if ((pFlags & 4u) != 0u) {
    roughness *= mrTexel.g;
    metallic *= mrTexel.b;
  }
  roughness = clamp(roughness, 0.04, 1.0);
  metallic = clamp(metallic, 0.0, 1.0);

  var occ = 1.0;
  if ((pFlags & 16u) != 0u) {
    occ = mix(1.0, occTexel.r, p.aux.y);
  }

  let gloss = 1.0 - roughness;
  let specExp = mix(16.0, 256.0, gloss * gloss);
  let specWeight = mix(0.22 * gloss, 1.0, metallic);
  let cc = p.pbr.zw;

  var directLight = vec3<f32>(0.0);
  let numDir = sc.flags.y;
  if (numDir > 0u) {
    directLight += evalLight(normalize(sc.dirDir0.xyz), V, N, base.rgb, specExp, specWeight, cc) * sc.dirCol0.xyz;
  }
  if (numDir > 1u) {
    directLight += evalLight(normalize(sc.dirDir1.xyz), V, N, base.rgb, specExp, specWeight, cc) * sc.dirCol1.xyz;
  }

  let numPt = sc.flags.z;
  if (numPt > 0u) {
    let toL = sc.ptPos0.xyz - in.worldPos;
    let dist = length(toL);
    let L = toL / max(dist, 0.0001);
    var spotAtt = clamp((dot(-L, sc.ptSpotDir0.xyz) - sc.ptSpotCone0.y) / max(sc.ptSpotCone0.x - sc.ptSpotCone0.y, 0.0001), 0.0, 1.0);
    spotAtt *= spotAtt;
    directLight += evalLight(L, V, N, base.rgb, specExp, specWeight, cc) * sc.ptCol0.xyz * spotAtt / (1.0 + 0.09 * dist + 0.032 * dist * dist);
  }
  if (numPt > 1u) {
    let toL = sc.ptPos1.xyz - in.worldPos;
    let dist = length(toL);
    let L = toL / max(dist, 0.0001);
    var spotAtt = clamp((dot(-L, sc.ptSpotDir1.xyz) - sc.ptSpotCone1.y) / max(sc.ptSpotCone1.x - sc.ptSpotCone1.y, 0.0001), 0.0, 1.0);
    spotAtt *= spotAtt;
    directLight += evalLight(L, V, N, base.rgb, specExp, specWeight, cc) * sc.ptCol1.xyz * spotAtt / (1.0 + 0.09 * dist + 0.032 * dist * dist);
  }

  let R = reflect(-V, N);
  let NoV = clamp(dot(N, V), 0.001, 1.0);
  let F0 = mix(vec3<f32>(0.04), base.rgb, metallic);
  let F = fSchlickRoughness(F0, roughness, NoV);
  let brdf = envBRDF(roughness, NoV);

  var specularIBL: vec3<f32>;
  var envDiffuse: vec3<f32>;
  if ((sc.flags.w & 1u) != 0u) {
    specularIBL = textureSampleLevel(envTex, linSampler, equirectangularUV(R), 0.0).rgb * (F * brdf.x + brdf.y);
    envDiffuse = textureSampleLevel(envTex, linSampler, equirectangularUV(N), 0.0).rgb;
  } else {
    specularIBL = getStudioRadiance(R, roughness) * (F * brdf.x + brdf.y);
    envDiffuse = mix(vec3<f32>(0.10, 0.10, 0.12), vec3<f32>(0.52, 0.54, 0.58), N.y * 0.5 + 0.5);
  }

  let kD = (vec3<f32>(1.0) - F) * (1.0 - metallic);
  directLight += kD * base.rgb * mix(sc.hemiGround.xyz, sc.hemiSky.xyz, dot(N, sc.hemiAxis.xyz) * 0.5 + 0.5) * occ;
  let diffuseIBL = kD * base.rgb * (sc.ambAndEnv.xyz + envDiffuse * 0.5) * occ;
  var color = directLight + (diffuseIBL + specularIBL) * sc.ambAndEnv.w + em + selGlow;
  if (cc.x > 0.0) {
    let ccF = fSchlickRoughness(vec3<f32>(0.04), cc.y, NoV) * cc.x;
    color = color * (vec3<f32>(1.0) - ccF) + getStudioRadiance(R, cc.y) * ccF * sc.ambAndEnv.w;
  }
  color = applyToneMapping(color * sc.camAndExp.w, sc.flags.x);
  return vec4<f32>(color * base.a, base.a);
}
`;

/**
 * Procedural 4-vertex Gaussian planar contact shadow WGSL shader reusing
 * `@group(0)` (`SceneUniforms.shadowBox` & `shadowParams`).
 */
export const SCENE_SHADOW_WGSL =
  SHARED_SCENE_STRUCTS_WGSL +
  /* wgsl */ `
struct ShadowVsOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) localUv: vec2<f32>,
};

@vertex
fn vsShadow(@builtin(vertex_index) vid: u32) -> ShadowVsOut {
  let sx = select(-1.0, 1.0, (vid & 1u) != 0u);
  let sz = select(-1.0, 1.0, (vid & 2u) != 0u);
  let world = vec4<f32>(
    sc.shadowBox.x + sx * sc.shadowBox.w,
    sc.shadowBox.y,
    sc.shadowBox.z + sz * sc.shadowParams.x,
    1.0,
  );
  var out: ShadowVsOut;
  out.clipPos = sc.viewProj * world;
  out.localUv = vec2<f32>(sx, sz);
  return out;
}

@fragment
fn fsShadow(in: ShadowVsOut) -> @location(0) vec4<f32> {
  let r2 = dot(in.localUv, in.localUv);
  if (r2 >= 1.0) {
    discard;
  }
  let softness = sc.shadowParams.z;
  let falloff = mix(6.5, 2.2, softness);
  let edgeFade = 1.0 - smoothstep(0.55, 1.0, sqrt(r2));
  let alpha = clamp(exp(-r2 * falloff) * edgeFade * sc.shadowParams.y * 0.72, 0.0, 1.0);
  return vec4<f32>(0.0, 0.0, 0.0, alpha);
}
`;

/**
 * 1x1-scissor GPU Color-ID picking WGSL shader reusing `@group(0)` and the
 * scene vertex/index slabs inside a cached `GPURenderBundle`.
 */
export const SCENE_PICK_WGSL =
  SHARED_SCENE_STRUCTS_WGSL +
  /* wgsl */ `
struct PickVsOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) worldPos: vec3<f32>,
  @location(1) @interpolate(flat) instIdx: u32,
};

@vertex
fn vsPick(
  @location(0) aPos: vec3<f32>,
  @builtin(instance_index) instIdx: u32,
) -> PickVsOut {
  let p = parts[instIdx];
  var out: PickVsOut;
  if (p.pickId == 0u || (p.flags & 128u) != 0u) {
    out.clipPos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
    out.worldPos = vec3<f32>(0.0);
    out.instIdx = instIdx;
    return out;
  }
  var m: mat4x4<f32>;
  if ((p.flags & 1u) != 0u) {
    m = p.model;
  } else {
    m = sc.modelRoot * p.model;
  }
  let world = m * vec4<f32>(aPos, 1.0);
  out.clipPos = sc.viewProj * world;
  out.worldPos = world.xyz;
  out.instIdx = instIdx;
  return out;
}

@fragment
fn fsPick(in: PickVsOut) -> @location(0) vec4<f32> {
  let p = parts[in.instIdx];
  let secOn = (sc.flags.w & 2u) != 0u && (p.flags & 64u) == 0u;
  if (secOn && dot(in.worldPos, sc.sectionPlane.xyz) > sc.sectionPlane.w) {
    discard;
  }
  let id = p.pickId;
  return vec4<f32>(
    f32(id & 255u) / 255.0,
    f32((id >> 8u) & 255u) / 255.0,
    f32((id >> 16u) & 255u) / 255.0,
    1.0,
  );
}
`;
