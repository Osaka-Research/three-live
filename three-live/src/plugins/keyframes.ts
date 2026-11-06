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
 * @fileoverview Rigid-Body glTF 2.0 Keyframe Animation Plugin for three-live.
 * Parses and evaluates glTF animation clips, keyframe samplers, and TRS channels.
 */

import {readAccessorAsFloat32} from '../accessor';
import {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  resolveNodeWorldMatrices,
} from '../math';
import type {ThreeLivePlugin} from '../plugin';

export interface AnimationChannel {
  nodeIndex: number;
  path: 'translation' | 'rotation' | 'scale' | 'weights';
  times: Float32Array;
  values: Float32Array;
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
}

export interface AnimationClip {
  name: string;
  duration: number;
  channels: AnimationChannel[];
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

export function quatSlerp(
  out: [number, number, number, number] | Float32Array | number[],
  a: [number, number, number, number] | Float32Array | readonly number[],
  b: [number, number, number, number] | Float32Array | readonly number[],
  t: number,
): [number, number, number, number] | Float32Array | number[] {
  let ax = a[0],
    ay = a[1],
    az = a[2],
    aw = a[3];
  let bx = b[0],
    by = b[1],
    bz = b[2],
    bw = b[3];

  let cosHalfTheta = ax * bx + ay * by + az * bz + aw * bw;
  if (cosHalfTheta < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
    cosHalfTheta = -cosHalfTheta;
  }

  if (Math.abs(cosHalfTheta) >= 1.0) {
    out[0] = ax;
    out[1] = ay;
    out[2] = az;
    out[3] = aw;
    return out;
  }

  const halfTheta = Math.acos(cosHalfTheta);
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
  if (Math.abs(sinHalfTheta) < 0.001) {
    out[0] = 0.5 * (ax + bx);
    out[1] = 0.5 * (ay + by);
    out[2] = 0.5 * (az + bz);
    out[3] = 0.5 * (aw + bw);
    return out;
  }

  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

  out[0] = ax * ratioA + bx * ratioB;
  out[1] = ay * ratioA + by * ratioB;
  out[2] = az * ratioA + bz * ratioB;
  out[3] = aw * ratioA + bw * ratioB;
  return out;
}

export function vec3Lerp(
  out: [number, number, number] | Float32Array | number[],
  a: [number, number, number] | Float32Array | readonly number[],
  b: [number, number, number] | Float32Array | readonly number[],
  t: number,
): [number, number, number] | Float32Array | number[] {
  out[0] = a[0] + t * (b[0] - a[0]);
  out[1] = a[1] + t * (b[1] - a[1]);
  out[2] = a[2] + t * (b[2] - a[2]);
  return out;
}

export function parseAnimations(gltf: any, bin: ArrayBuffer): AnimationClip[] {
  if (!Array.isArray(gltf?.animations)) return [];
  const clips: AnimationClip[] = [];

  for (let i = 0; i < gltf.animations.length; i++) {
    const anim = gltf.animations[i];
    const name = anim.name || `Animation_${i}`;
    const channels: AnimationChannel[] = [];
    let maxTime = 0;

    if (Array.isArray(anim.channels) && Array.isArray(anim.samplers)) {
      for (const ch of anim.channels) {
        if (!ch.target || ch.target.node === undefined || !ch.target.path) {
          continue;
        }
        const sampler = anim.samplers[ch.sampler];
        if (!sampler) continue;

        const inputAcc = gltf.accessors?.[sampler.input];
        const outputAcc = gltf.accessors?.[sampler.output];
        if (!inputAcc || !outputAcc) continue;

        const inputBv = gltf.bufferViews?.[inputAcc.bufferView];
        const outputBv = gltf.bufferViews?.[outputAcc.bufferView];
        if (!inputBv || !outputBv) continue;

        const inOffset = (inputBv.byteOffset || 0) + (inputAcc.byteOffset || 0);
        const outOffset =
          (outputBv.byteOffset || 0) + (outputAcc.byteOffset || 0);

        const times =
          readAccessorAsFloat32(gltf, bin, inputAcc, 1) ??
          readFloat32Array(bin, inOffset, inputAcc.count);
        if (times.length > 0 && times[times.length - 1] > maxTime) {
          maxTime = times[times.length - 1];
        }

        const componentCount =
          ch.target.path === 'rotation'
            ? 4
            : ch.target.path === 'weights'
              ? Math.max(
                  1,
                  Math.round(outputAcc.count / Math.max(1, inputAcc.count)),
                )
              : 3;
        // Rotation / weights outputs may be normalized BYTE/SHORT (glTF spec).
        const valueComps = ch.target.path === 'weights' ? 1 : componentCount;
        const values =
          readAccessorAsFloat32(gltf, bin, outputAcc, valueComps) ??
          readFloat32Array(bin, outOffset, outputAcc.count * valueComps);
        const interpolation =
          sampler.interpolation === 'STEP' ? 'STEP' : 'LINEAR';

        channels.push({
          nodeIndex: ch.target.node,
          path: ch.target.path,
          times,
          values,
          interpolation,
        });
      }
    }

    if (channels.length > 0) {
      clips.push({
        name,
        duration: maxTime,
        channels,
      });
    }
  }

  return clips;
}

export function sampleChannel(
  channel: AnimationChannel,
  t: number,
  out:
    | [number, number, number]
    | [number, number, number, number]
    | Float32Array
    | number[],
): void {
  const {times, values, path, interpolation} = channel;
  const numKeys = times.length;
  if (numKeys === 0) return;

  const stride =
    path === 'rotation'
      ? 4
      : path === 'weights'
        ? Math.max(1, Math.round(values.length / numKeys))
        : 3;

  if (t <= times[0]) {
    for (let i = 0; i < stride; i++) out[i] = values[i];
    return;
  }
  if (t >= times[numKeys - 1]) {
    const lastOffset = (numKeys - 1) * stride;
    for (let i = 0; i < stride; i++) out[i] = values[lastOffset + i];
    return;
  }

  let low = 0;
  let high = numKeys - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (times[mid] <= t) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const i0 = Math.max(0, high);
  const i1 = Math.min(numKeys - 1, i0 + 1);

  if (interpolation === 'STEP' || i0 === i1) {
    const offset = i0 * stride;
    for (let i = 0; i < stride; i++) out[i] = values[offset + i];
    return;
  }

  const t0 = times[i0];
  const t1 = times[i1];
  const alpha = (t - t0) / Math.max(0.00001, t1 - t0);

  const off0 = i0 * stride;
  const off1 = i1 * stride;

  if (path === 'rotation') {
    const q0: [number, number, number, number] = [
      values[off0],
      values[off0 + 1],
      values[off0 + 2],
      values[off0 + 3],
    ];
    const q1: [number, number, number, number] = [
      values[off1],
      values[off1 + 1],
      values[off1 + 2],
      values[off1 + 3],
    ];
    quatSlerp(out, q0, q1, alpha);
  } else {
    for (let i = 0; i < stride; i++) {
      out[i] = values[off0 + i] + alpha * (values[off1 + i] - values[off0 + i]);
    }
  }
}

export interface ActiveClipState {
  clip: AnimationClip;
  time: number;
  weight: number;
  fadeSpeed: number;
}

const viewerMixers = new WeakMap<object, ActiveClipState[]>();

/** Smoothly cross-fades from currently playing animation clip(s) to `clipName` over `duration` seconds. */
export function crossFadeTo(
  viewer: any,
  clipName: string,
  duration: number = 0.3,
): void {
  if (!viewer?.animations) return;
  const targetClip = viewer.animations.find(
    (a: AnimationClip) => a.name === clipName,
  );
  if (!targetClip) return;

  let stack = viewerMixers.get(viewer);
  if (!stack) {
    stack = [];
    if (viewer.currentClip) {
      stack.push({
        clip: viewer.currentClip,
        time: viewer.animationTime || 0,
        weight: 1.0,
        fadeSpeed: 0,
      });
    }
    viewerMixers.set(viewer, stack);
  }

  const invDur = duration > 0 ? 1.0 / duration : 1000.0;
  for (const state of stack) {
    if (state.clip.name !== clipName) {
      state.fadeSpeed = -invDur;
    }
  }

  let existing = stack.find((s) => s.clip.name === clipName);
  if (existing) {
    existing.fadeSpeed = invDur;
  } else {
    stack.push({
      clip: targetClip,
      time: 0,
      weight: duration > 0 ? 0.0 : 1.0,
      fadeSpeed: invDur,
    });
  }
  viewer.currentClip = targetClip;
  viewer.isPlayingAnimation = true;
}

export function evaluateAnimation(viewer: any, t: number): void {
  if (!viewer.gltf || !Array.isArray(viewer.gltf.nodes)) {
    return;
  }

  let stack = viewerMixers.get(viewer);
  if (!stack || stack.length === 0) {
    if (!viewer.currentClip) return;
    stack = [
      {
        clip: viewer.currentClip,
        time: t,
        weight: 1.0,
        fadeSpeed: 0,
      },
    ];
  }

  const nodeCount = viewer.gltf.nodes.length;
  const nodeTRS: Array<{
    t: [number, number, number];
    r: [number, number, number, number];
    s: [number, number, number];
  }> = [];

  for (let i = 0; i < nodeCount; i++) {
    const init = viewer.initialNodeTransforms[i];
    if (init) {
      nodeTRS.push({
        t: [init.t[0], init.t[1], init.t[2]],
        r: [init.r[0], init.r[1], init.r[2], init.r[3]],
        s: [init.s[0], init.s[1], init.s[2]],
      });
    } else {
      nodeTRS.push({
        t: [0, 0, 0],
        r: [0, 0, 0, 1],
        s: [1, 1, 1],
      });
    }
  }

  const sampledT: [number, number, number] = [0, 0, 0];
  const sampledR: [number, number, number, number] = [0, 0, 0, 1];
  const sampledS: [number, number, number] = [1, 1, 1];
  const sampledWeights = new Float32Array(64);

  for (const state of stack) {
    const w = Math.max(0, Math.min(1, state.weight));
    if (w <= 0.0001) continue;

    for (const ch of state.clip.channels) {
      if (ch.nodeIndex < 0 || ch.nodeIndex >= nodeCount) continue;
      const trs = nodeTRS[ch.nodeIndex];
      if (ch.path === 'translation') {
        sampleChannel(ch, state.time, sampledT);
        vec3Lerp(trs.t, trs.t, sampledT, w);
      } else if (ch.path === 'rotation') {
        sampleChannel(ch, state.time, sampledR);
        quatSlerp(trs.r, trs.r, sampledR, w);
      } else if (ch.path === 'scale') {
        sampleChannel(ch, state.time, sampledS);
        vec3Lerp(trs.s, trs.s, sampledS, w);
      } else if (ch.path === 'weights') {
        sampleChannel(ch, state.time, sampledWeights);
        if (viewer.meshes) {
          for (const mesh of viewer.meshes) {
            if (mesh.nodeIndex === ch.nodeIndex) {
              for (const prim of mesh.primitives) {
                if (prim.pluginData?.morph?.weights) {
                  const mw = prim.pluginData.morph.weights;
                  const num = prim.pluginData.morph.numTargets || mw.length;
                  for (let k = 0; k < num; k++) {
                    mw[k] = mw[k] * (1 - w) + sampledWeights[k] * w;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  const localMatrices: Float32Array[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const mat = mat4Create();
    const {t: tr, r: ro, s: sc} = nodeTRS[i];
    mat4FromRotationTranslationScale(mat, ro, tr, sc);
    localMatrices.push(mat);
  }

  const worldMatrices = resolveNodeWorldMatrices(viewer.gltf, localMatrices);
  viewer.worldMatrices = worldMatrices;

  for (const mesh of viewer.meshes) {
    if (mesh.nodeIndex >= 0 && mesh.nodeIndex < worldMatrices.length) {
      mesh.transform.set(worldMatrices[mesh.nodeIndex]);
      mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
    }
  }
}

export const keyframeAnimationPlugin: ThreeLivePlugin & {
  evaluateAnimation?: (viewer: any, t: number) => void;
  crossFadeTo?: (viewer: any, clipName: string, duration?: number) => void;
} = {
  name: 'keyframes',
  evaluateAnimation,
  crossFadeTo,

  onParseGLB(glbData: any): void {
    if (!glbData.animations && glbData.gltf?.animations) {
      glbData.animations = parseAnimations(glbData.gltf, glbData.bin);
    }
  },

  onLoadModel(viewer: any): void {
    viewerMixers.delete(viewer);
  },

  onClearScene(viewer: any): void {
    viewerMixers.delete(viewer);
  },

  onDestroy(_gl: WebGL2RenderingContext, viewer: any): void {
    viewerMixers.delete(viewer);
  },

  onUpdate(viewer: any, dt: number): void {
    if (!viewer.isPlayingAnimation) return;

    const stack = viewerMixers.get(viewer);
    if (stack && stack.length > 0) {
      for (let i = stack.length - 1; i >= 0; i--) {
        const state = stack[i];
        state.time += dt;
        if (state.clip.duration > 0) {
          state.time %= state.clip.duration;
        }
        if (state.fadeSpeed !== 0) {
          state.weight += state.fadeSpeed * dt;
          if (state.weight <= 0) {
            stack.splice(i, 1);
            continue;
          } else if (state.weight >= 1.0) {
            state.weight = 1.0;
            state.fadeSpeed = 0;
          }
        }
      }
      if (stack.length > 0) {
        viewer.animationTime = stack[stack.length - 1].time;
      }
      evaluateAnimation(viewer, viewer.animationTime);
    } else if (viewer.currentClip) {
      viewer.animationTime += dt;
      if (viewer.currentClip.duration > 0) {
        viewer.animationTime %= viewer.currentClip.duration;
      }
      evaluateAnimation(viewer, viewer.animationTime);
    }
  },
};
