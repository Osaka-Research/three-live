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
 * @fileoverview Morph Targets (Blend Shapes) Data-Texture Plugin for three-live.
 * Packs glTF primitive.targets delta vectors into a 2D RGBA32F data texture
 * (`uMorphDeltasTex`) indexed by `gl_VertexID` and morph target index,
 * supporting up to 64 simultaneous facial blend shapes without consuming
 * WebGL2 vertex attribute slots.
 */

import type {ThreeLivePlugin} from '../plugin';
import {readFloat32Array} from './keyframes';

const MAX_MORPH_TARGETS = 64;

/** Programmatically sets a morph target weight across all morph-enabled primitives in a viewer. */
export function setMorphTargetWeight(
  viewer: any,
  targetIndex: number,
  weight: number,
): void {
  if (!viewer?.meshes || targetIndex < 0 || targetIndex >= MAX_MORPH_TARGETS) {
    return;
  }
  for (const mesh of viewer.meshes) {
    for (const prim of mesh.primitives) {
      const morphData = prim.pluginData?.morph;
      if (morphData?.weights) {
        morphData.weights[targetIndex] = weight;
      }
    }
  }
}

export const morphPlugin: ThreeLivePlugin = {
  name: 'morph',

  onResolveShader(
    primitiveDef: any,
    _materialDef: any,
    defaultVS: string,
    defaultFS: string,
  ): {vs: string; fs: string} | null {
    if (
      !Array.isArray(primitiveDef?.targets) ||
      primitiveDef.targets.length === 0
    ) {
      return null;
    }

    let morphVS = defaultVS.replace(
      'uniform mat4 uMVP,uModel;',
      `uniform mat4 uMVP,uModel;
uniform sampler2D uMorphDeltasTex;
uniform float uMorphWeights[${MAX_MORPH_TARGETS}];
uniform int uNumMorphTargets;`,
    );

    morphVS = morphVS
      .replace(
        'vec4 world=uModel*vec4(aPosition,1.0);',
        `vec3 morphedPos = aPosition;
for (int m = 0; m < ${MAX_MORPH_TARGETS}; m++) {
  if (m >= uNumMorphTargets) break;
  float w = uMorphWeights[m];
  if (abs(w) > 0.0001) {
    morphedPos += texelFetch(uMorphDeltasTex, ivec2(gl_VertexID, m), 0).xyz * w;
  }
}
vec4 world=uModel*vec4(morphedPos,1.0);`,
      )
      .replace(
        'gl_Position=uMVP*vec4(aPosition,1.0);',
        'gl_Position=uMVP*vec4(morphedPos,1.0);',
      );

    return {vs: morphVS, fs: defaultFS};
  },

  onBuildPrimitiveVAO(
    gl: WebGL2RenderingContext,
    _vao: WebGLVertexArrayObject,
    primitiveDef: any,
    gltf: any,
    bin: ArrayBuffer,
  ): any {
    const targets = primitiveDef?.targets;
    if (!Array.isArray(targets) || targets.length === 0) {
      return null;
    }

    const posAccIdx = primitiveDef.attributes?.POSITION;
    const posAcc = gltf?.accessors?.[posAccIdx];
    if (!posAcc) return null;

    const vertexCount = posAcc.count;
    const numTargets = Math.min(targets.length, MAX_MORPH_TARGETS);
    const data = new Float32Array(vertexCount * numTargets * 4);

    for (let t = 0; t < numTargets; t++) {
      const targetPosIdx = targets[t].POSITION;
      if (targetPosIdx === undefined) continue;
      const tAcc = gltf.accessors?.[targetPosIdx];
      const tBv = gltf.bufferViews?.[tAcc?.bufferView];
      if (!tAcc || !tBv) continue;

      const byteOffset = (tBv.byteOffset || 0) + (tAcc.byteOffset || 0);
      const deltas = readFloat32Array(bin, byteOffset, vertexCount * 3);
      const rowOffset = t * vertexCount * 4;
      for (let v = 0; v < vertexCount; v++) {
        data[rowOffset + v * 4] = deltas[v * 3];
        data[rowOffset + v * 4 + 1] = deltas[v * 3 + 1];
        data[rowOffset + v * 4 + 2] = deltas[v * 3 + 2];
        data[rowOffset + v * 4 + 3] = 0.0;
      }
    }

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      vertexCount,
      numTargets,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const weights = new Float32Array(MAX_MORPH_TARGETS);

    return {
      hasMorph: true,
      morphTex: tex,
      numTargets,
      vertexCount,
      weights,
    };
  },

  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    primitiveGpu: any,
    _meshGpu: any,
    _nodeWorldMatrices: Float32Array[],
    _gltf: any,
  ): void {
    const morphData = primitiveGpu.pluginData?.morph;
    if (!morphData?.hasMorph || !morphData.morphTex) return;

    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, morphData.morphTex);
    const uTexLoc = gl.getUniformLocation(program, 'uMorphDeltasTex');
    if (uTexLoc) gl.uniform1i(uTexLoc, 5);

    const uNumLoc = gl.getUniformLocation(program, 'uNumMorphTargets');
    if (uNumLoc) gl.uniform1i(uNumLoc, morphData.numTargets);

    const uWeightsLoc = gl.getUniformLocation(program, 'uMorphWeights[0]');
    if (uWeightsLoc) {
      gl.uniform1fv(uWeightsLoc, morphData.weights);
    }
  },
};
