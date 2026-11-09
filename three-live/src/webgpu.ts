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
 * @fileoverview Entry point for `three-live-webgpu.min.js`: opt-in WebGPU
 * `GPURenderBundle` + Storage-Buffer Scene Accelerator for `<three-live>` and
 * `<xr-live>`.
 */

import {registerPlugin} from './plugin';
import {webgpuScenePlugin} from './webgpu/scene-accelerator';

registerPlugin(webgpuScenePlugin);

export type {RendererPreference} from './plugin';
export {
  acquireSceneWebGPUDevice,
  getWebGPUSceneAccelerator,
  normalizeRendererPreference,
  resetSceneWebGPUDevice,
  resolveSceneRenderBackend,
  setSceneWebGPUDeviceForTests,
  WebGPUSceneAccelerator,
  webgpuScenePlugin,
  type GPUSceneBufferLike,
  type GPUSceneCanvasContextLike,
  type GPUSceneCommandEncoderLike,
  type GPUSceneDeviceLike,
  type GPUSceneRenderBundleEncoderLike,
  type GPUSceneRenderBundleLike,
  type GPUSceneRenderPassEncoderLike,
  type GPUSceneTextureLike,
  type ResolvedSceneBackend,
} from './webgpu/scene-accelerator';
export {
  PART_STRIDE_BYTES,
  PART_STRIDE_WORDS,
  remapClipDepthToZeroOne,
  SCENE_PBR_WGSL,
  SCENE_PICK_WGSL,
  SCENE_SHADOW_WGSL,
  SCENE_UNIFORM_BYTES,
  VERTEX_STRIDE_BYTES,
  VERTEX_STRIDE_FLOATS,
  writeSceneUniforms,
  type SceneLightInput,
  type SceneUniformInput,
} from './webgpu/shaders';
