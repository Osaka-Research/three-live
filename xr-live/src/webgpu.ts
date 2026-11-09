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
 * @fileoverview Entry point for `xr-live-webgpu.min.js`: opt-in WebGPU Gaussian
 * Splatting compute & render accelerator for `<xr-live>` and `<three-live>`.
 */

import {registerPlugin} from '../../three-live/src/plugin';
import {webgpuSplatPlugin} from './webgpu/splat-accelerator';

registerPlugin(webgpuSplatPlugin);

export type {SplatUniformInput} from './webgpu/shaders';
export {
  acquireWebGPUDevice,
  getWebGPUSplatAccelerator,
  type ResolvedSplatRenderMode,
  resolveSplatRenderMode,
  type SplatRendererPreference,
  type WebGPUBufferLike,
  type WebGPUCanvasContextLike,
  type WebGPUCommandEncoderLike,
  type WebGPUComputePassEncoderLike,
  type WebGPUDeviceLike,
  type WebGPURenderPassEncoderLike,
  WebGPUSplatAccelerator,
  webgpuSplatPlugin,
} from './webgpu/splat-accelerator';
