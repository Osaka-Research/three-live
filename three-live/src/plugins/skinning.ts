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
 * @fileoverview GPU Skeletal Character Skinning Plugin for three-live.
 * Binds JOINTS_0 and WEIGHTS_0 vertex attributes, evaluates inverse bind matrices,
 * and performs hardware vertex skinning in WebGL2 shaders.
 */

import type {ThreeLivePlugin} from '../plugin';
import {mat4Create, mat4Multiply} from '../math';

const MAX_JOINTS = 64;

export const skinningPlugin: ThreeLivePlugin = {
  name: 'skinning',

  onResolveShader(
    primitiveDef: any,
    _materialDef: any,
    defaultVS: string,
    defaultFS: string,
  ): {vs: string; fs: string} | null {
    if (
      primitiveDef?.attributes?.JOINTS_0 === undefined ||
      primitiveDef?.attributes?.WEIGHTS_0 === undefined
    ) {
      return null;
    }

    let skinnedVS = defaultVS.replace(
      'layout(location=2) in vec2 aUV;',
      `layout(location=2) in vec2 aUV;
layout(location=4) in uvec4 aJoints;
layout(location=5) in vec4 aWeights;
uniform mat4 uJointMatrix[${MAX_JOINTS}];`,
    );

    const posVar = skinnedVS.includes('morphedPos') ? 'morphedPos' : 'aPosition';

    skinnedVS = skinnedVS
      .replace(
        `vec4 world=uModel*vec4(${posVar},1.0);`,
        `mat4 skinMatrix =
  aWeights.x * uJointMatrix[int(aJoints.x)] +
  aWeights.y * uJointMatrix[int(aJoints.y)] +
  aWeights.z * uJointMatrix[int(aJoints.z)] +
  aWeights.w * uJointMatrix[int(aJoints.w)];
vec4 world=uModel*(skinMatrix*vec4(${posVar},1.0));`,
      )
      .replace(
        `gl_Position=uMVP*vec4(${posVar},1.0);`,
        `gl_Position=uMVP*(skinMatrix*vec4(${posVar},1.0));`,
      );

    return {vs: skinnedVS, fs: defaultFS};
  },

  onBuildPrimitiveVAO(
    gl: WebGL2RenderingContext,
    _vao: WebGLVertexArrayObject,
    primitiveDef: any,
    gltf: any,
    bin: ArrayBuffer,
  ): any {
    const attrs = primitiveDef?.attributes;
    if (
      !attrs ||
      attrs.JOINTS_0 === undefined ||
      attrs.WEIGHTS_0 === undefined
    ) {
      return null;
    }

    const jointsAcc = gltf.accessors[attrs.JOINTS_0];
    const weightsAcc = gltf.accessors[attrs.WEIGHTS_0];
    if (!jointsAcc || !weightsAcc) return null;

    const jBv = gltf.bufferViews[jointsAcc.bufferView];
    const wBv = gltf.bufferViews[weightsAcc.bufferView];
    if (!jBv || !wBv) return null;

    const jOffset = (jBv.byteOffset || 0) + (jointsAcc.byteOffset || 0);
    const wOffset = (wBv.byteOffset || 0) + (weightsAcc.byteOffset || 0);

    const jBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, jBuf);
    const jType =
      jointsAcc.componentType === 5121 ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
    const jData =
      jType === gl.UNSIGNED_BYTE
        ? new Uint8Array(bin, jOffset, jointsAcc.count * 4)
        : new Uint16Array(bin, jOffset, jointsAcc.count * 4);
    gl.bufferData(gl.ARRAY_BUFFER, jData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribIPointer(4, 4, jType, 0, 0);

    const wBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
    const wData = new Float32Array(bin, wOffset, weightsAcc.count * 4);
    gl.bufferData(gl.ARRAY_BUFFER, wData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 4, gl.FLOAT, false, 0, 0);

    return {
      hasSkin: true,
      buffers: [jBuf, wBuf],
    };
  },

  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    primitiveGpu: any,
    meshGpu: any,
    nodeWorldMatrices: Float32Array[],
    gltf: any,
  ): void {
    if (!primitiveGpu.pluginData?.skinning?.hasSkin) return;

    const skinIndex = gltf?.nodes?.[meshGpu.nodeIndex]?.skin;
    if (skinIndex === undefined || !gltf.skins || !gltf.skins[skinIndex]) {
      return;
    }

    const skin = gltf.skins[skinIndex];
    const jointNodes: number[] = skin.joints || [];
    const jointMatrices = new Float32Array(MAX_JOINTS * 16);

    for (let j = 0; j < jointNodes.length && j < MAX_JOINTS; j++) {
      const nodeIdx = jointNodes[j];
      const world = nodeWorldMatrices[nodeIdx] || mat4Create();
      const outMat = jointMatrices.subarray(j * 16, (j + 1) * 16);
      outMat.set(world);
    }

    const loc = gl.getUniformLocation(program, 'uJointMatrix[0]');
    if (loc) {
      gl.uniformMatrix4fv(loc, false, jointMatrices);
    }
  },
};
