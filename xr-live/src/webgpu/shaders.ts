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
 * @fileoverview WGSL compute & render shaders and IEEE fp16 / 3D covariance
 * buffer packers for `xr-live-webgpu.min.js`.
 */

import {mat3NormalFromMat4} from '../../../three-live/src/math';
import {
  computeSplatCovariance3D,
  shBasisCountForDegree,
  type SplatData,
} from '../plugins/splat-loader';

/** Workgroup thread count shared across all compute passes. */
export const WEBGPU_WORKGROUP_SIZE = 256;
/** Splats processed per radix-sort tile (`4 * WEBGPU_WORKGROUP_SIZE`). */
export const WEBGPU_RADIX_TILE_SIZE = 1024;
/** Byte stride of `SplatBase` (`12 * 4 = 48` bytes/splat). */
export const SPLAT_BASE_STRIDE_BYTES = 48;
/** Byte size of `SplatUniforms` (`76 * 4 = 304` bytes). */
export const SPLAT_UNIFORM_BYTES = 304;
/** Byte size of `SortUniforms` (`4 * 4 = 16` bytes). */
export const SORT_UNIFORM_BYTES = 16;
/** Byte size of `CloudMeta` (`6 * 4 = 24` bytes; indirect args at byte 8). */
export const CLOUD_META_BYTES = 24;
/** Byte offset of `drawIndirect` arguments inside `CloudMeta`. */
export const CLOUD_INDIRECT_OFFSET_BYTES = 8;

const f32Scratch = new Float32Array(1);
const u32Scratch = new Uint32Array(f32Scratch.buffer);

/** Converts a JS number to IEEE-754 binary16 (fp16) bit pattern (`0..65535`). */
export function float32ToFloat16Bits(val: number): number {
  f32Scratch[0] = val;
  const x = u32Scratch[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x0200 : 0);
  const halfExp = exp - 127 + 15;
  if (halfExp >= 0x1f) return sign | 0x7c00;
  if (halfExp <= 0) {
    if (halfExp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - halfExp;
    const halfMant = mant >>> shift;
    const roundBit = 1 << (shift - 1);
    const roundUp =
      (mant & roundBit) !== 0 &&
      ((mant & (roundBit - 1)) !== 0 || (halfMant & 1) !== 0)
        ? 1
        : 0;
    return sign | (halfMant + roundUp);
  }
  const halfMant = mant >>> 13;
  const roundUp =
    (mant & 0x1000) !== 0 && ((mant & 0x0fff) !== 0 || (halfMant & 1) !== 0)
      ? 1
      : 0;
  return sign + ((halfExp << 10) | halfMant) + roundUp;
}

/** Number of `u32` words per splat required for packed fp16 SH coefficients. */
export function shWordsPerSplatForDegree(shDegree: number): number {
  const floats = shBasisCountForDegree(shDegree) * 3;
  return floats > 0 ? Math.ceil(floats / 2) : 0;
}

/**
 * Packs `SplatData` static geometry (`pos`, `maxRadius`, `cov3d[6]`, `rgba8`)
 * into a 48-byte-per-splat `ArrayBuffer` matching WGSL `struct SplatBase`.
 */
export function packSplatBaseBuffer(data: SplatData): ArrayBuffer {
  const n = data.count;
  const buf = new ArrayBuffer(
    Math.max(SPLAT_BASE_STRIDE_BYTES, n * SPLAT_BASE_STRIDE_BYTES),
  );
  const f32 = new Float32Array(buf);
  const u32 = new Uint32Array(buf);
  const pos = data.positions;
  const scales = data.scales;
  const rots = data.rotations;
  const cols = data.colors;
  for (let i = 0; i < n; i++) {
    const base = i * 12;
    const p3 = i * 3;
    const c4 = i * 4;
    f32[base] = pos[p3];
    f32[base + 1] = pos[p3 + 1];
    f32[base + 2] = pos[p3 + 2];
    f32[base + 3] = Math.max(
      0,
      Math.abs(scales[p3]) || 0,
      Math.abs(scales[p3 + 1]) || 0,
      Math.abs(scales[p3 + 2]) || 0,
    );
    computeSplatCovariance3D(scales, rots, i, f32, base + 4);
    u32[base + 10] =
      (cols[c4] |
        (cols[c4 + 1] << 8) |
        (cols[c4 + 2] << 16) |
        (cols[c4 + 3] << 24)) >>>
      0;
    u32[base + 11] = 0;
  }
  return buf;
}

/**
 * Packs higher-order Spherical Harmonics (`data.sh`) as pairs of IEEE fp16
 * values into `u32` words (`<= 92 B/splat` at Degree 3).
 */
export function packSplatSHBuffer(data: SplatData): {
  words: Uint32Array;
  shDegree: number;
  wordsPerSplat: number;
} {
  const rawDeg = data.shDegree ?? 0;
  const floatsPerSplat = shBasisCountForDegree(rawDeg) * 3;
  const sh = data.sh;
  if (
    floatsPerSplat === 0 ||
    !sh ||
    data.count === 0 ||
    sh.length < data.count * floatsPerSplat
  ) {
    return {words: new Uint32Array(1), shDegree: 0, wordsPerSplat: 0};
  }
  const wordsPerSplat = shWordsPerSplatForDegree(rawDeg);
  const out = new Uint32Array(Math.max(1, data.count * wordsPerSplat));
  for (let i = 0; i < data.count; i++) {
    const srcBase = i * floatsPerSplat;
    const dstBase = i * wordsPerSplat;
    for (let f = 0; f < floatsPerSplat; f += 2) {
      const lo = float32ToFloat16Bits(sh[srcBase + f]);
      const hi =
        f + 1 < floatsPerSplat ? float32ToFloat16Bits(sh[srcBase + f + 1]) : 0;
      out[dstBase + (f >> 1)] = (lo | (hi << 16)) >>> 0;
    }
  }
  return {words: out, shDegree: rawDeg, wordsPerSplat};
}

/** Parameters written into the 304-byte `SplatUniforms` buffer. */
export interface SplatUniformInput {
  mvp: ArrayLike<number>;
  modelView: ArrayLike<number> | null;
  model: ArrayLike<number>;
  cameraPos: ArrayLike<number> | null;
  focalX: number;
  focalY: number;
  viewportWidth: number;
  viewportHeight: number;
  splatCount: number;
  shDegreeEffective: number;
  shWordsPerSplat: number;
  antialiased: boolean;
}

const invScratch = new Float64Array(9);

/** Fills `outBuffer` (`304` bytes) with `SplatUniforms` data. */
export function writeSplatUniforms(
  outBuffer: ArrayBuffer,
  input: SplatUniformInput,
): void {
  const f32 = new Float32Array(outBuffer, 0, 76);
  const u32 = new Uint32Array(outBuffer, 0, 76);
  const {mvp, modelView, model, cameraPos} = input;
  f32.fill(0);
  f32.set(mvp, 0);
  if (modelView) {
    f32.set(modelView, 16);
  } else {
    f32[16] = f32[21] = f32[26] = f32[31] = 1;
  }
  f32.set(model, 32);
  for (let r = 0; r < 3; r++) {
    invScratch[r * 3] = model[r];
    invScratch[r * 3 + 1] = model[4 + r];
    invScratch[r * 3 + 2] = model[8 + r];
  }
  const inv = mat3NormalFromMat4(invScratch, model, 1e-12);
  for (let r = 0; r < 3; r++) {
    f32[48 + r * 4] = inv[r * 3];
    f32[49 + r * 4] = inv[r * 3 + 1];
    f32[50 + r * 4] = inv[r * 3 + 2];
  }
  if (cameraPos) {
    f32[60] = cameraPos[0];
    f32[61] = cameraPos[1];
    f32[62] = cameraPos[2];
    f32[63] = 1;
  }
  f32[64] = Math.max(1e-3, input.focalX);
  f32[65] = Math.max(1e-3, input.focalY);
  f32[66] = Math.max(1, input.viewportWidth);
  f32[67] = Math.max(1, input.viewportHeight);
  u32[68] = input.splatCount >>> 0;
  u32[69] = Math.max(1, Math.ceil(input.splatCount / WEBGPU_RADIX_TILE_SIZE)) >>> 0;
  u32[70] = input.shDegreeEffective >>> 0;
  u32[71] = input.shWordsPerSplat >>> 0;
  u32[72] = mvp[3] === 0 && mvp[7] === 0 && mvp[11] === 0 ? 2 : 3;
  u32[73] = modelView ? 1 : 0;
  u32[74] = input.antialiased ? 1 : 0;
  u32[75] = 0;
}

const WGSL_BASE =
  'struct SB{px:f32,py:f32,pz:f32,rad:f32,c0:f32,c1:f32,c2:f32,c3:f32,c4:f32,c5:f32,rgba:u32,pad:u32};' +
  'struct SU{mvp:mat4x4f,mv:mat4x4f,m:mat4x4f,im0:vec4f,im1:vec4f,im2:vec4f,cam:vec4f,proj:vec4f,cnt:vec4u,flg:vec4u};';

/** WGSL compute module Part 1: bounds reset, depth + fp16 SH, key quantization. */
export const SPLAT_PREP_COMPUTE_WGSL =
  WGSL_BASE +
  'struct CM{mn:atomic<u32>,mx:atomic<u32>,vc:u32,ic:u32,fv:u32,fi:u32};' +
  '@group(0) @binding(0) var<uniform> u:SU;' +
  '@group(0) @binding(1) var<storage,read> sb:array<SB>;' +
  '@group(0) @binding(2) var<storage,read> shp:array<u32>;' +
  '@group(0) @binding(3) var<storage,read_write> db:array<u32>;' +
  '@group(0) @binding(4) var<storage,read_write> cm:CM;' +
  '@group(0) @binding(5) var<storage,read_write> colOut:array<u32>;' +
  '@group(0) @binding(6) var<storage,read_write> kA:array<u32>;' +
  '@group(0) @binding(7) var<storage,read_write> vA:array<u32>;' +
  'fn s2f(s:u32)->f32{return bitcast<f32>(select(~s,s^0x80000000u,(s&0x80000000u)!=0u));}' +
  'fn rsh(b:u32,f:u32)->f32{let p=unpack2x16float(shp[b+(f>>1u)]);return select(p.y,p.x,(f&1u)==0u);}' +
  'fn h(b:u32,k:u32)->vec3f{let f=k*3u;return vec3f(rsh(b,f),rsh(b,f+1u),rsh(b,f+2u));}' +
  '@compute @workgroup_size(1) fn kResetBounds(){atomicStore(&cm.mn,0xFFFFFFFFu);atomicStore(&cm.mx,0u);cm.vc=4u;cm.ic=u.cnt.x;cm.fv=0u;cm.fi=0u;}' +
  'var<workgroup> wMn:atomic<u32>;var<workgroup> wMx:atomic<u32>;' +
  '@compute @workgroup_size(256) fn kDepthAndSH(@builtin(local_invocation_id) lv:vec3u,@builtin(global_invocation_id) gv:vec3u){' +
  'let l=lv.x;let i=gv.x;if(l==0u){atomicStore(&wMn,0xFFFFFFFFu);atomicStore(&wMx,0u);}workgroupBarrier();' +
  'if(i<u.cnt.x){let s=sb[i];let p=vec4f(s.px,s.py,s.pz,1.0);' +
  'let d=dot(transpose(u.mvp)[u.flg.x],p);let b=bitcast<u32>(d);db[i]=b;' +
  'if((b&0x7F800000u)!=0x7F800000u){let su=select(b^0x80000000u,~b,(b&0x80000000u)!=0u);atomicMin(&wMn,su);atomicMax(&wMx,su);}' +
  'let deg=u.cnt.z;if(deg==0u){colOut[i]=s.rgba;}else{' +
  'let bc=unpack4x8unorm(s.rgba);let wp=(u.m*p).xyz-u.cam.xyz;' +
  'let lr=transpose(mat3x3f(u.im0.xyz,u.im1.xyz,u.im2.xyz))*wp;let dl=length(lr);let dir=select(vec3f(0.0),lr/max(dl,1e-12),dl>1e-12);' +
  'let x=dir.x;let y=dir.y;let z=dir.z;let w=i*u.cnt.w;' +
  'var rgb=bc.rgb+0.48860251*(z*h(w,1u)-y*h(w,0u)-x*h(w,2u));' +
  'if(deg>=2u){let xx=x*x;let yy=y*y;let zz=z*z;let xy=x*y;let yz=y*z;let xz=x*z;' +
  'rgb+=1.0925484*(xy*h(w,3u)-yz*h(w,4u)-xz*h(w,6u))+(0.31539157*(2.0*zz-xx-yy))*h(w,5u)+(0.5462742*(xx-yy))*h(w,7u);' +
  'if(deg>=3u){rgb+=-0.5900436*(y*(3.0*xx-yy)*h(w,8u)+x*(xx-3.0*yy)*h(w,14u))+(2.8906114*xy*z)*h(w,9u)-0.4570458*(4.0*zz-xx-yy)*(y*h(w,10u)+x*h(w,12u))+(0.37317633*z*(2.0*zz-3.0*xx-3.0*yy))*h(w,11u)+(1.4453057*z*(xx-yy))*h(w,13u);}}' +
  'colOut[i]=pack4x8unorm(vec4f(clamp(rgb,vec3f(0.0),vec3f(1.0)),bc.a));}}workgroupBarrier();' +
  'if(l==0u){let mn=atomicLoad(&wMn);let mx=atomicLoad(&wMx);if(mn<=mx){atomicMin(&cm.mn,mn);atomicMax(&cm.mx,mx);}}}' +
  '@compute @workgroup_size(256) fn kQuantizeKeys(@builtin(global_invocation_id) gv:vec3u){' +
  'let i=gv.x;if(i>=u.cnt.x){return;}let mnS=atomicLoad(&cm.mn);let mxS=atomicLoad(&cm.mx);' +
  'var mnD=0.0;var mxD=0.0;if(mxS>=mnS){mnD=s2f(mnS);mxD=s2f(mxS);}let b=db[i];var k=0u;' +
  'if((b&0x7F800000u)==0x7F800000u){k=select(0u,65535u,b==0xFF800000u);}' +
  'else if(mxD>mnD){let d=bitcast<f32>(b);k=u32(floor(clamp(((0.5*mxD-0.5*d)/(0.5*mxD-0.5*mnD))*65535.0,0.0,65535.0)));}' +
  'kA[i]=k;vA[i]=i;}';

/** WGSL compute module Part 2: 2-pass 8-bit tiled deterministic radix sort. */
export const SPLAT_SORT_COMPUTE_WGSL =
  'struct RU{n:u32,nt:u32,sh:u32,pad:u32};' +
  '@group(0) @binding(0) var<uniform> su:RU;' +
  '@group(0) @binding(1) var<storage,read> kIn:array<u32>;' +
  '@group(0) @binding(2) var<storage,read> vIn:array<u32>;' +
  '@group(0) @binding(3) var<storage,read_write> kOut:array<u32>;' +
  '@group(0) @binding(4) var<storage,read_write> vOut:array<u32>;' +
  '@group(0) @binding(5) var<storage,read_write> hst:array<u32>;' +
  '@group(0) @binding(6) var<storage,read_write> bSum:array<u32>;' +
  'var<workgroup> lh:array<atomic<u32>,256>;' +
  '@compute @workgroup_size(256) fn kRadixHistogram(@builtin(local_invocation_id) lv:vec3u,@builtin(workgroup_id) wv:vec3u){' +
  'let l=lv.x;let t=wv.x;atomicStore(&lh[l],0u);workgroupBarrier();let tb=t*1024u;' +
  'for(var s=0u;s<4u;s++){let i=tb+s*256u+l;if(i<su.n){atomicAdd(&lh[(kIn[i]>>su.sh)&0xFFu],1u);}}' +
  'workgroupBarrier();hst[l*su.nt+t]=atomicLoad(&lh[l]);}' +
  'var<workgroup> sc:array<u32,256>;' +
  'fn wgScan(l:u32,v:u32)->u32{sc[l]=v;workgroupBarrier();for(var o=1u;o<256u;o<<=1u){var a=0u;if(l>=o){a=sc[l-o];}workgroupBarrier();sc[l]+=a;workgroupBarrier();}return sc[l];}' +
  '@compute @workgroup_size(256) fn kScanBlocks(@builtin(local_invocation_id) lv:vec3u,@builtin(workgroup_id) wv:vec3u){' +
  'let l=lv.x;let b=wv.x;let g=b*256u+l;let v=hst[g];let inc=wgScan(l,v);hst[g]=inc-v;if(l==255u){bSum[b]=inc;}}' +
  '@compute @workgroup_size(256) fn kScanTop(@builtin(local_invocation_id) lv:vec3u){' +
  'let l=lv.x;let n=su.nt;var c=0u;' +
  'for(var o=0u;o<n;o+=256u){let b=o+l;let v=select(0u,bSum[b],b<n);let inc=wgScan(l,v);if(b<n){bSum[b]=c+inc-v;}let t=sc[255u];workgroupBarrier();c+=t;}}' +
  '@compute @workgroup_size(256) fn kAddBlockSums(@builtin(local_invocation_id) lv:vec3u,@builtin(workgroup_id) wv:vec3u){let b=wv.x;hst[b*256u+lv.x]+=bSum[b];}' +
  'var<workgroup> dm:array<atomic<u32>,2048>;var<workgroup> db:array<u32,256>;' +
  '@compute @workgroup_size(256) fn kRadixScatter(@builtin(local_invocation_id) lv:vec3u,@builtin(workgroup_id) wv:vec3u){' +
  'let l=lv.x;let t=wv.x;db[l]=hst[l*su.nt+t];workgroupBarrier();let wd=l>>5u;let bt=l&31u;let lm=(1u<<bt)-1u;let tb=t*1024u;' +
  'for(var s=0u;s<4u;s++){for(var w=0u;w<8u;w++){atomicStore(&dm[l*8u+w],0u);}workgroupBarrier();' +
  'let i=tb+s*256u+l;let ok=i<su.n;var k=0u;var v=0u;var d=0u;if(ok){k=kIn[i];v=vIn[i];d=(k>>su.sh)&0xFFu;atomicOr(&dm[d*8u+wd],1u<<bt);}workgroupBarrier();' +
  'if(ok){var rk=0u;for(var w=0u;w<wd;w++){rk+=countOneBits(atomicLoad(&dm[d*8u+w]));}rk+=countOneBits(atomicLoad(&dm[d*8u+wd])&lm);let dst=db[d]+rk;kOut[dst]=k;vOut[dst]=v;}' +
  'var tot=0u;for(var w=0u;w<8u;w++){tot+=countOneBits(atomicLoad(&dm[l*8u+w]));}workgroupBarrier();db[l]+=tot;workgroupBarrier();}}';

/** WGSL render module: instanced 4-vertex anisotropic eigenvector quads. */
export const SPLAT_RENDER_WGSL =
  WGSL_BASE +
  'struct VO{@builtin(position) pos:vec4f,@location(0) col:vec4f,@location(1) uv:vec2f};' +
  '@group(0) @binding(0) var<uniform> u:SU;' +
  '@group(0) @binding(1) var<storage,read> sb:array<SB>;' +
  '@group(0) @binding(2) var<storage,read> idxBuf:array<u32>;' +
  '@group(0) @binding(3) var<storage,read> colBuf:array<u32>;' +
  '@vertex fn vsMain(@builtin(vertex_index) vid:u32,@builtin(instance_index) iid:u32)->VO{' +
  'var o:VO;o.pos=vec4f(2.0,2.0,2.0,1.0);o.col=vec4f(0.0);o.uv=vec2f(0.0);if(iid>=u.cnt.x){return o;}' +
  'let si=idxBuf[iid];let s=sb[si];var c=unpack4x8unorm(colBuf[si]);let p=vec4f(s.px,s.py,s.pz,1.0);let cl=u.mvp*p;let pr=u.flg.x==3u;' +
  'if((pr&&cl.w<=1e-4)||(!pr&&abs(cl.w)<=1e-6)||c.a<(0.5/255.0)){return o;}' +
  'let iw=1.0/cl.w;let ndc=cl.xy*iw;let zn=0.5*(cl.z*iw+1.0);if(zn<0.0||zn>1.0){return o;}' +
  'let uv=vec2f(select(-1.0,1.0,(vid&1u)!=0u),select(-1.0,1.0,(vid&2u)!=0u));' +
  'var e1=vec2f(1.0,0.0);var r1=1.0;var r2=1.0;let fx=u.proj.x;let fy=u.proj.y;' +
  'if(u.flg.y!=0u){let v=u.mv*p;let tz=max(abs(v.z),1e-3);let sz=select(1.0,-1.0,v.z<0.0);let iz2=1.0/(tz*tz);' +
  'let W=transpose(mat3x3f(u.mv[0].xyz,u.mv[1].xyz,u.mv[2].xyz));' +
  'let t0=W*vec3f(fx/tz,0.0,-sz*fx*v.x*iz2);let t1=W*vec3f(0.0,fy/tz,-sz*fy*v.y*iz2);' +
  'let S=mat3x3f(vec3f(s.c0,s.c1,s.c2),vec3f(s.c1,s.c3,s.c4),vec3f(s.c2,s.c4,s.c5));' +
  'let ca=dot(t0,S*t0)+0.3;let cb=dot(t0,S*t1);let cc=dot(t1,S*t1)+0.3;' +
  'if(u.flg.z!=0u){let dt=max(ca*cc-cb*cb,1e-6);c.a*=sqrt(clamp(((ca-0.3)*(cc-0.3)-cb*cb)/dt,0.0,1.0));}' +
  'let md=0.5*(ca+cc);let hd=0.5*(ca-cc);let ds=length(vec2f(hd,cb));let l1=max(0.1,md+ds);let l2=max(0.1,md-ds);' +
  'if(ds>1e-6){let rw=select(vec2f(cb,ds-hd),vec2f(hd+ds,cb),ca>=cc);let rl=length(rw);if(rl>1e-8){e1=rw/rl;}}' +
  'r1=clamp(3.0*sqrt(l1),0.5,1024.0);r2=clamp(3.0*sqrt(l2),0.5,1024.0);' +
  '}else{let rd=clamp(3.0*s.rad*fy/max(abs(cl.w),1e-3),0.5,256.0);r1=rd;r2=rd;}' +
  'let e2=vec2f(-e1.y,e1.x);o.pos=vec4f(ndc+(uv.x*r1*e1+uv.y*r2*e2)*(2.0/u.proj.zw),zn,1.0);o.col=c;o.uv=uv;return o;}' +
  '@fragment fn fsMain(in:VO)->@location(0) vec4f{let r=dot(in.uv,in.uv);if(r>1.0){discard;}let a=in.col.a*exp(-4.5*r);if(a<(1.0/255.0)){discard;}return vec4f(in.col.rgb*a,a);}';
