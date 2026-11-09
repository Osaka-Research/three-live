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
 * @fileoverview Opt-in WebGPU `GPURenderBundle` + Storage-Buffer Scene
 * Accelerator (`three-live-webgpu.min.js`) for `<three-live>` and `<xr-live>`.
 *
 * Collapses multi-thousand-part CAD and glTF draw loops (`N` CPU uniform binds +
 * `N` VAO/draw calls per frame in WebGL2) into consolidated GPU vertex/index
 * slabs, a dirty-checked `PartInstance` storage buffer, and pre-recorded
 * `GPURenderBundle`s (`1` `executeBundles` submission + `464 B` scene uniform
 * upload per frame during camera orbit and turntable rotation).
 */

import {mat4Create, mat4Multiply} from '../math';
import {
  getSharedRegistry,
  type GPUSceneAccelerator,
  type GPUSceneRenderParams,
  type RendererPreference,
  type ThreeLivePlugin,
} from '../plugin';
import {
  PART_FLAG_HAS_BASE_TEX,
  PART_FLAG_HAS_EMISSIVE_TEX,
  PART_FLAG_HAS_MR_TEX,
  PART_FLAG_HAS_NORMAL_TEX,
  PART_FLAG_HAS_OCC_TEX,
  PART_FLAG_HIDDEN,
  PART_FLAG_NO_SECTION_CLIP,
  PART_FLAG_WORLD_SPACE,
  PART_STEREO_SHIFT,
  PART_STRIDE_BYTES,
  PART_STRIDE_WORDS,
  SCENE_PBR_WGSL,
  SCENE_PICK_WGSL,
  SCENE_SHADOW_WGSL,
  SCENE_UNIFORM_BYTES,
  type SceneLightInput,
  VERTEX_STRIDE_BYTES,
  VERTEX_STRIDE_FLOATS,
  writeSceneUniforms,
} from './shaders';

const BUF_MAP_READ = 0x0001;
const BUF_COPY_DST = 0x0008;
const BUF_INDEX = 0x0010;
const BUF_VERTEX = 0x0020;
const BUF_UNIFORM = 0x0040;
const BUF_STORAGE = 0x0080;

const TEX_COPY_SRC = 0x01;
const TEX_COPY_DST = 0x02;
const TEX_BINDING = 0x04;
const TEX_RENDER_ATTACHMENT = 0x10;

const MAP_READ = 0x0001;
const STAGE_VERTEX = 0x1;
const STAGE_FRAGMENT = 0x2;
const MSAA_SAMPLES = 4;

/** Minimal structural WebGPU buffer interface (zero `@webgpu/types` dep). */
export interface GPUSceneBufferLike {
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  unmap(): void;
  destroy(): void;
}

/** Minimal structural WebGPU texture interface. */
export interface GPUSceneTextureLike {
  createView(descriptor?: unknown): unknown;
  destroy(): void;
}

/** Minimal structural WebGPU render bundle handle. */
export type GPUSceneRenderBundleLike = object;

/** Minimal structural WebGPU render bundle encoder interface. */
export interface GPUSceneRenderBundleEncoderLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  setVertexBuffer(
    slot: number,
    buffer: GPUSceneBufferLike,
    offset?: number,
    size?: number,
  ): void;
  setIndexBuffer(
    buffer: GPUSceneBufferLike,
    indexFormat: 'uint16' | 'uint32',
    offset?: number,
    size?: number,
  ): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  drawIndexed(
    indexCount: number,
    instanceCount?: number,
    firstIndex?: number,
    baseVertex?: number,
    firstInstance?: number,
  ): void;
  finish(descriptor?: unknown): GPUSceneRenderBundleLike;
}

/** Minimal structural WebGPU render pass encoder interface. */
export interface GPUSceneRenderPassEncoderLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  setViewport?(
    x: number,
    y: number,
    width: number,
    height: number,
    minDepth: number,
    maxDepth: number,
  ): void;
  setScissorRect?(x: number, y: number, width: number, height: number): void;
  executeBundles(bundles: readonly GPUSceneRenderBundleLike[]): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  end(): void;
}

/** Minimal structural WebGPU command encoder interface. */
export interface GPUSceneCommandEncoderLike {
  beginRenderPass(descriptor: unknown): GPUSceneRenderPassEncoderLike;
  copyTextureToBuffer?(
    source: {texture: GPUSceneTextureLike},
    destination: {
      buffer: GPUSceneBufferLike;
      bytesPerRow: number;
      rowsPerImage?: number;
    },
    copySize: {width: number; height: number; depthOrArrayLayers?: number},
  ): void;
  finish(): unknown;
}

/** Minimal structural WebGPU device interface. */
export interface GPUSceneDeviceLike {
  readonly queue: {
    writeBuffer(
      buffer: GPUSceneBufferLike,
      bufferOffset: number,
      data: ArrayBufferView | ArrayBuffer,
      dataOffset?: number,
      size?: number,
    ): void;
    writeTexture?(
      destination: {texture: GPUSceneTextureLike},
      data: ArrayBufferView | ArrayBuffer,
      dataLayout: {offset?: number; bytesPerRow: number; rowsPerImage?: number},
      size: {width: number; height: number; depthOrArrayLayers?: number},
    ): void;
    copyExternalImageToTexture?(
      source: {source: unknown; flipY?: boolean},
      destination: {texture: GPUSceneTextureLike; premultipliedAlpha?: boolean},
      copySize:
        | readonly [number, number]
        | {width: number; height: number; depthOrArrayLayers?: number},
    ): void;
    submit(commandBuffers: unknown[]): void;
  };
  readonly lost?: Promise<unknown>;
  createBuffer(descriptor: {
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }): GPUSceneBufferLike;
  createTexture(descriptor: {
    size:
      | readonly [number, number]
      | {width: number; height: number; depthOrArrayLayers?: number};
    format: string;
    usage: number;
    sampleCount?: number;
  }): GPUSceneTextureLike;
  createSampler(descriptor?: unknown): unknown;
  createShaderModule(descriptor: {code: string}): unknown;
  createBindGroupLayout(descriptor: unknown): unknown;
  createPipelineLayout(descriptor: unknown): unknown;
  createRenderPipeline(descriptor: unknown): unknown;
  createRenderBundleEncoder(descriptor: {
    colorFormats: readonly string[];
    depthStencilFormat?: string;
    sampleCount?: number;
  }): GPUSceneRenderBundleEncoderLike;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): GPUSceneCommandEncoderLike;
  destroy?(): void;
}

/** Minimal structural WebGPU canvas context interface. */
export interface GPUSceneCanvasContextLike {
  configure(config: {
    device: GPUSceneDeviceLike;
    format: string;
    alphaMode?: string;
  }): void;
  unconfigure?(): void;
  getCurrentTexture(): {createView(): unknown};
}

/** Effective execution backend chosen for a scene render pass. */
export type ResolvedSceneBackend = 'webgpu' | 'webgl2';

interface PrimitiveLike {
  positions?: Float32Array | null;
  normals?: Float32Array | null;
  uvs?: Float32Array | null;
  indices?: Uint16Array | Uint32Array | null;
  indexCount?: number;
  instanceCount?: number;
  translations?: Float32Array;
  baseColor?: number[] | Float32Array;
  metallic?: number;
  roughness?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  emissiveFactor?: number[] | Float32Array;
  normalScale?: number;
  occlusionStrength?: number;
  alphaMode?: string;
  texture?: object | null;
  metallicRoughnessTexture?: object | null;
  normalTexture?: object | null;
  occlusionTexture?: object | null;
  emissiveTexture?: object | null;
  isTransmissive?: boolean;
  customProgram?: unknown;
  pluginData?: Record<string, unknown>;
}

interface MeshLike {
  name?: string;
  visible?: boolean;
  worldSpace?: boolean;
  worldMatrix?: Float32Array;
  isPluginMesh?: boolean;
  transform: Float32Array;
  instanceMatrices?: Float32Array;
  instanceColors?: Float32Array;
  extras?: {xr?: Record<string, unknown>};
  userData?: {xr?: Record<string, unknown>};
  primitives: PrimitiveLike[];
}

interface ViewerLike {
  gl?: WebGL2RenderingContext;
  canvas?: HTMLCanvasElement;
  container?: {
    getAttribute?: (name: string) => string | null;
    hasAttribute?: (name: string) => boolean;
  } | null;
  meshes?: MeshLike[];
  backdropMeshes?: MeshLike[];
  lights?: SceneLightInput[];
  bounds?: {
    center: [number, number, number];
    radius: number;
    min: [number, number, number];
    max: [number, number, number];
  };
  clearColor?: [number, number, number, number];
  exposure?: number;
  envIntensity?: number;
  shadowIntensity?: number;
  shadowSoftness?: number;
  selectedMeshName?: string;
  selectedMeshNames?: ReadonlySet<string>;
  stereoSBS?: boolean;
  xrSessionActive?: boolean;
  renderProg?: unknown;
  skyboxTexture?: unknown;
  environmentTexture?: object | null;
  environmentSource?: unknown;
  modelRootMatrix?: Float32Array;
  projMatrix?: Float32Array;
  viewMatrix?: Float32Array;
  renderer?: string;
}

interface UploadedTexEntry {
  tex: GPUSceneTextureLike;
  view: unknown;
  src: unknown;
}

interface FormatPipelines {
  opaque: unknown;
  blend: unknown;
  shadow: unknown;
}

interface DevicePipelines {
  sceneBgl: unknown;
  matBgl: unknown;
  scenePipeLayout: unknown;
  auxPipeLayout: unknown;
  shaderMod: unknown;
  shadowMod: unknown;
  pickMod: unknown;
  pickPipeline: unknown;
  sampler: unknown;
  whiteTex: GPUSceneTextureLike;
  whiteView: unknown;
  defaultMatBg: unknown;
  byFormat: Map<string, FormatPipelines>;
  texCache: WeakMap<object, UploadedTexEntry>;
  ownedTextures: Set<GPUSceneTextureLike>;
}

interface CompiledPartGroup {
  mesh: MeshLike;
  prim: PrimitiveLike;
  posRef: Float32Array;
  idxRef: Uint16Array | Uint32Array | null;
  meshIndex: number;
  isBackdrop: boolean;
  firstVertex: number;
  vertexCount: number;
  indexed: boolean;
  firstIndex: number;
  indexCount: number;
  firstInstance: number;
  instanceCount: number;
  isBlend: boolean;
  tex0: object | null;
  tex1: object | null;
  tex2: object | null;
  tex3: object | null;
  tex4: object | null;
  src0: unknown;
  src1: unknown;
  src2: unknown;
  src3: unknown;
  src4: unknown;
  matBg: unknown;
}

interface CompiledScene {
  meshRefs: MeshLike[];
  backdropCount: number;
  groups: CompiledPartGroup[];
  totalVertices: number;
  totalIndices: number;
  totalInstances: number;
  vertexBuf: GPUSceneBufferLike;
  indexBuf: GPUSceneBufferLike | null;
  partBuf: GPUSceneBufferLike;
  uniformBuf: GPUSceneBufferLike;
  pickUniformBuf: GPUSceneBufferLike | null;
  pickSceneBg: unknown;
  cpuPartBuf: ArrayBuffer;
  cpuPartF32: Float32Array;
  cpuPartU32: Uint32Array;
  gpuPartU32: Uint32Array;
  partsUploadedOnce: boolean;
  envSourceRef: unknown;
  envView: unknown;
  sceneBg: unknown;
  opaqueBundle: GPUSceneRenderBundleLike | null;
  blendBundle: GPUSceneRenderBundleLike | null;
  pickBundle: GPUSceneRenderBundleLike | null;
  bundleFormat: string;
  bundleSamples: number;
  bundlesDirty: boolean;
}

interface ViewerGPUState {
  dev: GPUSceneDeviceLike | null;
  canvas: HTMLCanvasElement | null;
  ctx: GPUSceneCanvasContextLike | null;
  configuredFormat: string;
  visible: boolean;
  width: number;
  height: number;
  sampleCount: number;
  msaaTex: GPUSceneTextureLike | null;
  msaaView: unknown;
  depthTex: GPUSceneTextureLike | null;
  depthView: unknown;
  pickColorTex: GPUSceneTextureLike | null;
  pickColorView: unknown;
  pickDepthTex: GPUSceneTextureLike | null;
  pickDepthView: unknown;
  pickReadBuf: GPUSceneBufferLike | null;
  pickBusy: boolean;
  scene: CompiledScene | null;
  unhookSnapshot: (() => void) | null;
  gen: number;
  uniformScratch: ArrayBuffer;
}

const IDENTITY_MAT4 = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);

let cachedDevice: GPUSceneDeviceLike | null = null;
let devicePromise: Promise<GPUSceneDeviceLike | null> | null = null;
let deviceFailed = false;
let preferredCanvasFormat = 'bgra8unorm';
let sharedSceneAccelerator: WebGPUSceneAccelerator | null = null;

const pipelineCache = new WeakMap<GPUSceneDeviceLike, DevicePipelines>();

function safe(fn: () => unknown): void {
  try {
    fn();
  } catch {}
}

function align4(bytes: number): number {
  return Math.max(16, (bytes + 3) & ~3);
}

function getNavigatorGPU(): {
  requestAdapter(opts?: unknown): Promise<{
    limits?: Record<string, number>;
    requestDevice(desc?: unknown): Promise<GPUSceneDeviceLike>;
  } | null>;
  getPreferredCanvasFormat?(): string;
} | null {
  const gpu = (globalThis as {navigator?: {gpu?: unknown}}).navigator?.gpu as
    | {requestAdapter?: unknown}
    | undefined;
  return gpu && typeof gpu.requestAdapter === 'function'
    ? (gpu as ReturnType<typeof getNavigatorGPU>)
    : null;
}

function isCompatibleSceneDevice(cand: unknown): cand is GPUSceneDeviceLike {
  if (!cand || typeof cand !== 'object') return false;
  const d = cand as Partial<GPUSceneDeviceLike>;
  return (
    typeof d.createBuffer === 'function' &&
    typeof d.createTexture === 'function' &&
    typeof d.createSampler === 'function' &&
    typeof d.createRenderBundleEncoder === 'function' &&
    typeof d.createRenderPipeline === 'function'
  );
}

/**
 * Lazily acquires and caches a shared `GPUDevice` (cooperating with
 * `SharedThreeLiveRegistry.webgpuDeviceProvider` so multiple WebGPU add-ons on
 * the same page share one device). Returns `null` when WebGPU is unavailable.
 */
export function acquireSceneWebGPUDevice(): Promise<GPUSceneDeviceLike | null> {
  if (cachedDevice) return Promise.resolve(cachedDevice);
  const reg = getSharedRegistry();
  const existingPeer = reg.webgpuDeviceProvider?.peekDevice?.();
  if (isCompatibleSceneDevice(existingPeer)) {
    cachedDevice = existingPeer;
    preferredCanvasFormat =
      reg.webgpuDeviceProvider?.getCanvasFormat?.() || preferredCanvasFormat;
    return Promise.resolve(existingPeer);
  }
  if (deviceFailed) return Promise.resolve(null);
  if (devicePromise) return devicePromise;

  if (reg.webgpuDeviceProvider && reg.webgpuDeviceProvider !== localProvider) {
    devicePromise = reg.webgpuDeviceProvider
      .acquireDevice()
      .then((peer) => {
        devicePromise = null;
        if (isCompatibleSceneDevice(peer)) {
          cachedDevice = peer;
          preferredCanvasFormat =
            reg.webgpuDeviceProvider?.getCanvasFormat?.() ||
            preferredCanvasFormat;
          return peer;
        }
        return acquireFromNavigator();
      })
      .catch(() => {
        devicePromise = null;
        return acquireFromNavigator();
      });
    return devicePromise;
  }

  return acquireFromNavigator();
}

function acquireFromNavigator(): Promise<GPUSceneDeviceLike | null> {
  const gpu = getNavigatorGPU();
  if (!gpu) {
    deviceFailed = true;
    return Promise.resolve(null);
  }
  try {
    preferredCanvasFormat = gpu.getPreferredCanvasFormat?.() || 'bgra8unorm';
  } catch {
    preferredCanvasFormat = 'bgra8unorm';
  }

  devicePromise = gpu
    .requestAdapter({powerPreference: 'high-performance'})
    .then(async (adapter) => {
      if (!adapter) {
        deviceFailed = true;
        devicePromise = null;
        return null;
      }
      const lim = adapter.limits;
      const req: Record<string, number> = {};
      for (const [k, minVal] of [
        ['maxStorageBufferBindingSize', 134217728],
        ['maxBufferSize', 268435456],
      ] as const) {
        if ((lim?.[k] ?? 0) > minVal) req[k] = lim![k];
      }
      const dev = await (req['maxBufferSize'] ||
      req['maxStorageBufferBindingSize']
        ? adapter
            .requestDevice({requiredLimits: req})
            .catch(() => adapter.requestDevice())
        : adapter.requestDevice());
      cachedDevice = dev;
      devicePromise = null;
      dev.lost?.then?.(() => {
        if (cachedDevice === dev) {
          cachedDevice = null;
          devicePromise = null;
          deviceFailed = false;
          sharedSceneAccelerator?.onDeviceLost(dev);
        }
      });
      return dev;
    })
    .catch(() => {
      deviceFailed = true;
      devicePromise = null;
      return null;
    });

  return devicePromise;
}

const localProvider = {
  acquireDevice: () => acquireSceneWebGPUDevice(),
  peekDevice: () => cachedDevice,
  getCanvasFormat: () => preferredCanvasFormat,
};

/** Injects a deterministic mock/custom `GPUDevice` for tests. */
export function setSceneWebGPUDeviceForTests(
  dev: GPUSceneDeviceLike | null,
  format = 'bgra8unorm',
): void {
  cachedDevice = dev;
  devicePromise = null;
  deviceFailed = dev === null;
  preferredCanvasFormat = format;
}

/** Resets cached `GPUDevice` acquisition state. */
export function resetSceneWebGPUDevice(): void {
  cachedDevice = null;
  devicePromise = null;
  deviceFailed = false;
  preferredCanvasFormat = 'bgra8unorm';
}

/** Normalizes a host `renderer` attribute string. */
export function normalizeRendererPreference(raw: unknown): RendererPreference {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'webgpu' || s === 'webgl2') return s;
  return 'auto';
}

function getViewerRendererPref(viewer: ViewerLike): RendererPreference {
  const attr =
    viewer.container?.getAttribute?.('renderer') ?? viewer.renderer ?? 'auto';
  return normalizeRendererPreference(attr);
}

function hasActiveAutoFallbackFeature(viewer: ViewerLike): boolean {
  const c = viewer.container;
  const rawBloom = c?.hasAttribute?.('bloom')
    ? (c.getAttribute?.('bloom') ?? '')
    : (c?.getAttribute?.('bloom') ?? null);
  if (rawBloom !== null && !viewer.stereoSBS) {
    const b = rawBloom.trim().toLowerCase();
    if (
      b === '' ||
      b === 'true' ||
      (b !== 'false' && b !== '0' && b !== 'none' && Number(b) > 0)
    ) {
      return true;
    }
  }
  const rawOutline = c?.hasAttribute?.('outline')
    ? (c.getAttribute?.('outline') ?? '')
    : (c?.getAttribute?.('outline') ?? null);
  if (rawOutline !== null) {
    const o = rawOutline.trim().toLowerCase();
    if (o !== 'false' && o !== '0' && o !== 'none') {
      return true;
    }
  }
  const outlineSel = c?.hasAttribute?.('outline-selected')
    ? c.getAttribute?.('outline-selected')
    : null;
  if (
    outlineSel !== null &&
    outlineSel !== 'false' &&
    Boolean(viewer.selectedMeshName)
  ) {
    return true;
  }
  if (viewer.skyboxTexture) return true;

  const lists = [viewer.backdropMeshes ?? [], viewer.meshes ?? []];
  for (const list of lists) {
    for (const mesh of list) {
      if (mesh.visible === false) continue;
      const xr = mesh.extras?.xr ?? mesh.userData?.xr;
      if (
        xr &&
        (xr['bloom'] || xr['outline'] || xr['splatUrl'] || xr['splat'])
      ) {
        return true;
      }
      for (const prim of mesh.primitives ?? []) {
        if (prim.isTransmissive) return true;
        if (
          prim.customProgram &&
          viewer.renderProg &&
          prim.customProgram !== viewer.renderProg
        ) {
          return true;
        }
        if (prim.pluginData?.['morph'] || prim.pluginData?.['skinning']) {
          return true;
        }
        if (prim.instanceCount !== undefined) return true;
      }
    }
  }
  return false;
}

/**
 * Resolves whether `viewer` should render via the WebGPU `GPURenderBundle`
 * backend or fall back to `ThreeView`'s WebGL2 path for the current frame.
 */
export function resolveSceneRenderBackend(
  viewer: object,
  hasDevice = Boolean(cachedDevice || getNavigatorGPU()),
): ResolvedSceneBackend {
  const v = viewer as ViewerLike;
  if (!v || v.xrSessionActive) return 'webgl2';
  const pref = getViewerRendererPref(v);
  if (pref === 'webgl2' || !hasDevice) return 'webgl2';

  let hasRenderable = false;
  for (const list of [v.backdropMeshes ?? [], v.meshes ?? []]) {
    for (const m of list) {
      if (m.visible === false) continue;
      const xr = m.extras?.xr ?? m.userData?.xr;
      if (xr?.['splatUrl'] || xr?.['splat']) continue;
      for (const p of m.primitives ?? []) {
        if (p.positions && p.positions.length >= 3) {
          hasRenderable = true;
          break;
        }
      }
      if (hasRenderable) break;
    }
    if (hasRenderable) break;
  }
  if (!hasRenderable) return 'webgl2';

  if (pref === 'auto' && hasActiveAutoFallbackFeature(v)) {
    return 'webgl2';
  }
  return 'webgpu';
}

function getDevicePipelines(dev: GPUSceneDeviceLike): DevicePipelines {
  let cached = pipelineCache.get(dev);
  if (cached) return cached;

  const sceneBgl = dev.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: STAGE_VERTEX | STAGE_FRAGMENT,
        buffer: {type: 'uniform'},
      },
      {
        binding: 1,
        visibility: STAGE_VERTEX | STAGE_FRAGMENT,
        buffer: {type: 'read-only-storage'},
      },
      {
        binding: 2,
        visibility: STAGE_FRAGMENT,
        sampler: {type: 'filtering'},
      },
      {
        binding: 3,
        visibility: STAGE_FRAGMENT,
        texture: {sampleType: 'float'},
      },
    ],
  });

  const matBgl = dev.createBindGroupLayout({
    entries: [0, 1, 2, 3, 4].map((binding) => ({
      binding,
      visibility: STAGE_FRAGMENT,
      texture: {sampleType: 'float'},
    })),
  });

  const scenePipeLayout = dev.createPipelineLayout({
    bindGroupLayouts: [sceneBgl, matBgl],
  });
  const auxPipeLayout = dev.createPipelineLayout({
    bindGroupLayouts: [sceneBgl],
  });

  const shaderMod = dev.createShaderModule({code: SCENE_PBR_WGSL});
  const shadowMod = dev.createShaderModule({code: SCENE_SHADOW_WGSL});
  const pickMod = dev.createShaderModule({code: SCENE_PICK_WGSL});

  const sampler = dev.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  const whiteTex = dev.createTexture({
    size: {width: 1, height: 1, depthOrArrayLayers: 1},
    format: 'rgba8unorm',
    usage: TEX_BINDING | TEX_COPY_DST | TEX_RENDER_ATTACHMENT,
  });
  safe(() =>
    dev.queue.writeTexture?.(
      {texture: whiteTex},
      new Uint8Array([255, 255, 255, 255]),
      {bytesPerRow: 256, rowsPerImage: 1},
      {width: 1, height: 1, depthOrArrayLayers: 1},
    ),
  );
  const whiteView = whiteTex.createView();

  const defaultMatBg = dev.createBindGroup({
    layout: matBgl,
    entries: [0, 1, 2, 3, 4].map((binding) => ({
      binding,
      resource: whiteView,
    })),
  });

  const pickPipeline = dev.createRenderPipeline({
    layout: auxPipeLayout,
    vertex: {
      module: pickMod,
      entryPoint: 'vsPick',
      buffers: [
        {
          arrayStride: VERTEX_STRIDE_BYTES,
          attributes: [{shaderLocation: 0, offset: 0, format: 'float32x3'}],
        },
      ],
    },
    fragment: {
      module: pickMod,
      entryPoint: 'fsPick',
      targets: [{format: 'rgba8unorm'}],
    },
    primitive: {topology: 'triangle-list', cullMode: 'none'},
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    },
    multisample: {count: 1},
  });

  cached = {
    sceneBgl,
    matBgl,
    scenePipeLayout,
    auxPipeLayout,
    shaderMod,
    shadowMod,
    pickMod,
    pickPipeline,
    sampler,
    whiteTex,
    whiteView,
    defaultMatBg,
    byFormat: new Map(),
    texCache: new WeakMap(),
    ownedTextures: new Set([whiteTex]),
  };
  pipelineCache.set(dev, cached);
  return cached;
}

function getFormatPipelines(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  format: string,
  sampleCount: number,
): FormatPipelines {
  const key = `${format}:${sampleCount}`;
  let fp = pipes.byFormat.get(key);
  if (fp) return fp;

  const vertexBuffers = [
    {
      arrayStride: VERTEX_STRIDE_BYTES,
      attributes: [
        {shaderLocation: 0, offset: 0, format: 'float32x3'},
        {shaderLocation: 1, offset: 12, format: 'float32x3'},
        {shaderLocation: 2, offset: 24, format: 'float32x2'},
      ],
    },
  ];

  const opaque = dev.createRenderPipeline({
    layout: pipes.scenePipeLayout,
    vertex: {
      module: pipes.shaderMod,
      entryPoint: 'vsMain',
      buffers: vertexBuffers,
    },
    fragment: {
      module: pipes.shaderMod,
      entryPoint: 'fsMain',
      targets: [{format}],
    },
    primitive: {topology: 'triangle-list', cullMode: 'none'},
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: true,
      depthCompare: 'less-equal',
    },
    multisample: {count: sampleCount},
  });

  const blend = dev.createRenderPipeline({
    layout: pipes.scenePipeLayout,
    vertex: {
      module: pipes.shaderMod,
      entryPoint: 'vsMain',
      buffers: vertexBuffers,
    },
    fragment: {
      module: pipes.shaderMod,
      entryPoint: 'fsMain',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {topology: 'triangle-list', cullMode: 'none'},
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
    multisample: {count: sampleCount},
  });

  const shadow = dev.createRenderPipeline({
    layout: pipes.auxPipeLayout,
    vertex: {module: pipes.shadowMod, entryPoint: 'vsShadow'},
    fragment: {
      module: pipes.shadowMod,
      entryPoint: 'fsShadow',
      targets: [
        {
          format,
          blend: {
            color: {
              srcFactor: 'src-alpha',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
            alpha: {
              srcFactor: 'one',
              dstFactor: 'one-minus-src-alpha',
              operation: 'add',
            },
          },
        },
      ],
    },
    primitive: {topology: 'triangle-strip', cullMode: 'none'},
    depthStencil: {
      format: 'depth24plus',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
    },
    multisample: {count: sampleCount},
  });

  fp = {opaque, blend, shadow};
  pipes.byFormat.set(key, fp);
  return fp;
}

function getSourceDimensions(src: unknown): [number, number] | null {
  if (!src || typeof src !== 'object') return null;
  const s = src as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  const w = Math.floor(s.naturalWidth || s.videoWidth || s.width || 0);
  const h = Math.floor(s.naturalHeight || s.videoHeight || s.height || 0);
  return w > 0 && h > 0 ? [w, h] : null;
}

function extractImageSource(texOrImg: unknown): unknown {
  if (!texOrImg || typeof texOrImg !== 'object') return null;
  const tagged = (texOrImg as {__gpuImageSource?: unknown}).__gpuImageSource;
  if (tagged) return tagged;
  if (getSourceDimensions(texOrImg)) return texOrImg;
  return null;
}

function resolveGPUTextureView(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  texHandle: object | null | undefined,
): {view: unknown; src: unknown; valid: boolean} {
  if (!texHandle) return {view: pipes.whiteView, src: null, valid: false};
  const src = extractImageSource(texHandle);
  const cached = pipes.texCache.get(texHandle);
  if (cached && cached.src === src) {
    return {view: cached.view, src, valid: src !== null};
  }
  if (!src) {
    return {view: pipes.whiteView, src: null, valid: false};
  }
  const dims = getSourceDimensions(src);
  if (!dims) {
    return {view: pipes.whiteView, src: null, valid: false};
  }

  if (cached) {
    pipes.ownedTextures.delete(cached.tex);
    safe(() => cached.tex.destroy());
  }

  const [w, h] = dims;
  const gpuTex = dev.createTexture({
    size: {width: w, height: h, depthOrArrayLayers: 1},
    format: 'rgba8unorm',
    usage: TEX_BINDING | TEX_COPY_DST | TEX_RENDER_ATTACHMENT,
  });
  let uploaded = false;
  if (typeof dev.queue.copyExternalImageToTexture === 'function') {
    safe(() => {
      dev.queue.copyExternalImageToTexture!(
        {source: src},
        {texture: gpuTex},
        {width: w, height: h, depthOrArrayLayers: 1},
      );
      uploaded = true;
    });
  }
  if (
    !uploaded &&
    typeof dev.queue.writeTexture === 'function' &&
    (src as {data?: Uint8Array | Uint8ClampedArray}).data
  ) {
    const raw = (src as {data: Uint8Array | Uint8ClampedArray}).data;
    const bpr = Math.ceil((w * 4) / 256) * 256;
    const padded = new Uint8Array(bpr * h);
    for (let row = 0; row < h; row++) {
      padded.set(raw.subarray(row * w * 4, (row + 1) * w * 4), row * bpr);
    }
    safe(() => {
      dev.queue.writeTexture!(
        {texture: gpuTex},
        padded,
        {bytesPerRow: bpr, rowsPerImage: h},
        {width: w, height: h, depthOrArrayLayers: 1},
      );
      uploaded = true;
    });
  }
  if (!uploaded) {
    safe(() => gpuTex.destroy());
    return {view: pipes.whiteView, src: null, valid: false};
  }

  const view = gpuTex.createView();
  pipes.ownedTextures.add(gpuTex);
  pipes.texCache.set(texHandle, {tex: gpuTex, view, src});
  return {view, src, valid: true};
}

function buildMaterialBindGroup(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  prim: PrimitiveLike,
): {
  bg: unknown;
  texFlags: number;
  src0: unknown;
  src1: unknown;
  src2: unknown;
  src3: unknown;
  src4: unknown;
} {
  const t0 = resolveGPUTextureView(dev, pipes, prim.texture);
  const t1 = resolveGPUTextureView(dev, pipes, prim.metallicRoughnessTexture);
  const t2 = resolveGPUTextureView(dev, pipes, prim.normalTexture);
  const t3 = resolveGPUTextureView(dev, pipes, prim.occlusionTexture);
  const t4 = resolveGPUTextureView(dev, pipes, prim.emissiveTexture);

  let texFlags = 0;
  if (t0.valid) texFlags |= PART_FLAG_HAS_BASE_TEX;
  if (t1.valid) texFlags |= PART_FLAG_HAS_MR_TEX;
  if (t2.valid) texFlags |= PART_FLAG_HAS_NORMAL_TEX;
  if (t3.valid) texFlags |= PART_FLAG_HAS_OCC_TEX;
  if (t4.valid) texFlags |= PART_FLAG_HAS_EMISSIVE_TEX;

  if (texFlags === 0) {
    return {
      bg: pipes.defaultMatBg,
      texFlags: 0,
      src0: t0.src,
      src1: t1.src,
      src2: t2.src,
      src3: t3.src,
      src4: t4.src,
    };
  }

  const bg = dev.createBindGroup({
    layout: pipes.matBgl,
    entries: [
      {binding: 0, resource: t0.view},
      {binding: 1, resource: t1.view},
      {binding: 2, resource: t2.view},
      {binding: 3, resource: t3.view},
      {binding: 4, resource: t4.view},
    ],
  });
  return {
    bg,
    texFlags,
    src0: t0.src,
    src1: t1.src,
    src2: t2.src,
    src3: t3.src,
    src4: t4.src,
  };
}

function hookCanvasSnapshots(
  glCv: HTMLCanvasElement,
  st: ViewerGPUState,
): () => void {
  const anyCv = glCv as unknown as Record<string, unknown>;
  const restores: Array<() => void> = [];
  const composite = (): HTMLCanvasElement | null => {
    if (!st.visible || !st.canvas) return null;
    try {
      const tmp = document.createElement('canvas');
      const w = (tmp.width = st.canvas.width || glCv.width || 1);
      const h = (tmp.height = st.canvas.height || glCv.height || 1);
      const c2d = tmp.getContext?.('2d');
      if (!c2d) return null;
      c2d.drawImage(glCv, 0, 0, w, h);
      c2d.drawImage(st.canvas, 0, 0, w, h);
      const splatCv = glCv.parentElement?.querySelector?.(
        'canvas.xr-live-webgpu-splat',
      ) as HTMLCanvasElement | null;
      if (splatCv && splatCv.style?.display !== 'none') {
        c2d.drawImage(splatCv, 0, 0, w, h);
      }
      return tmp;
    } catch {
      return null;
    }
  };
  const patch = (
    key: 'toDataURL' | 'toBlob',
    wrap: (orig: (...a: unknown[]) => unknown) => unknown,
  ) => {
    const raw = anyCv[key];
    if (typeof raw !== 'function') return;
    const own = Object.prototype.hasOwnProperty.call(glCv, key);
    anyCv[key] = wrap(raw.bind(glCv));
    restores.push(() => {
      if (own) anyCv[key] = raw;
      else delete anyCv[key];
    });
  };
  patch('toDataURL', (orig) => (type?: string, quality?: number) => {
    const c = composite();
    return c ? c.toDataURL(type, quality) : orig(type, quality);
  });
  patch(
    'toBlob',
    (orig) => (cb: BlobCallback, type?: string, quality?: number) => {
      const c = composite();
      if (c && typeof c.toBlob === 'function') c.toBlob(cb, type, quality);
      else orig(cb, type, quality);
    },
  );
  return () => restores.forEach((r) => r());
}

function parseViewerSectionPlane(viewer: ViewerLike): {
  enabled: boolean;
  normal: [number, number, number];
  constant: number;
} | null {
  for (const m of viewer.meshes ?? []) {
    if (
      m.name === '__xr_section_gizmo__' &&
      m.visible !== false &&
      m.worldMatrix &&
      m.worldMatrix.length >= 16
    ) {
      const wm = m.worldMatrix;
      const nx = wm[8];
      const ny = wm[9];
      const nz = wm[10];
      const nl = Math.hypot(nx, ny, nz) || 1;
      const unx = nx / nl;
      const uny = ny / nl;
      const unz = nz / nl;
      const c = unx * wm[12] + uny * wm[13] + unz * wm[14];
      return {enabled: true, normal: [unx, uny, unz], constant: c};
    }
  }

  const raw = (viewer.container?.getAttribute?.('section-plane') ?? '')
    .trim()
    .toLowerCase();
  if (!raw || raw === 'none' || raw === 'false') return null;

  let localN: [number, number, number] = [1, 0, 0];
  let localC = 0;
  if (raw === 'interactive') {
    localC = viewer.bounds?.center[0] ?? 0;
  } else {
    const m =
      /^([+-]?[xyz])\s*:\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/.exec(raw);
    if (!m) return null;
    const sign = m[1].startsWith('-') ? -1 : 1;
    const axis = m[1].replace(/^[+-]/, '');
    const val = Math.max(-1000, Math.min(1000, Number(m[2]) || 0));
    localN =
      axis === 'x' ? [sign, 0, 0] : axis === 'y' ? [0, sign, 0] : [0, 0, sign];
    localC = val * sign;
  }

  const rm = viewer.modelRootMatrix ?? IDENTITY_MAT4;
  const wnx = rm[0] * localN[0] + rm[4] * localN[1] + rm[8] * localN[2];
  const wny = rm[1] * localN[0] + rm[5] * localN[1] + rm[9] * localN[2];
  const wnz = rm[2] * localN[0] + rm[6] * localN[1] + rm[10] * localN[2];
  const wnl = Math.hypot(wnx, wny, wnz) || 1;
  const unx = wnx / wnl;
  const uny = wny / wnl;
  const unz = wnz / wnl;
  const px = localN[0] * localC;
  const py = localN[1] * localC;
  const pz = localN[2] * localC;
  const wpx = rm[0] * px + rm[4] * py + rm[8] * pz + rm[12];
  const wpy = rm[1] * px + rm[5] * py + rm[9] * pz + rm[13];
  const wpz = rm[2] * px + rm[6] * py + rm[10] * pz + rm[14];
  return {
    enabled: true,
    normal: [unx, uny, unz],
    constant: unx * wpx + uny * wpy + unz * wpz,
  };
}

function computeContactShadowInput(
  viewer: ViewerLike,
  isAR: boolean,
): {
  centerX: number;
  floorY: number;
  centerZ: number;
  halfExtentX: number;
  halfExtentZ: number;
  intensity: number;
  softness: number;
} | null {
  const intensity = Number(viewer.shadowIntensity ?? 0);
  if (!(intensity > 0) || isAR || !viewer.bounds) return null;
  const b = viewer.bounds;
  const softness = Math.max(
    0,
    Math.min(1, Number(viewer.shadowSoftness ?? 0.5)),
  );
  const rm = viewer.modelRootMatrix ?? IDENTITY_MAT4;
  const cx = b.center[0];
  const cy = b.center[1];
  const cz = b.center[2];
  const hx = Math.max(0.02, (b.max[0] - b.min[0]) * 0.5);
  const hy = Math.max(0.02, (b.max[1] - b.min[1]) * 0.5);
  const hz = Math.max(0.02, (b.max[2] - b.min[2]) * 0.5);

  const wcx = rm[0] * cx + rm[4] * cy + rm[8] * cz + rm[12];
  const wcy = rm[1] * cx + rm[5] * cy + rm[9] * cz + rm[13];
  const wcz = rm[2] * cx + rm[6] * cy + rm[10] * cz + rm[14];
  const whx =
    Math.abs(rm[0]) * hx + Math.abs(rm[4]) * hy + Math.abs(rm[8]) * hz;
  const why =
    Math.abs(rm[1]) * hx + Math.abs(rm[5]) * hy + Math.abs(rm[9]) * hz;
  const whz =
    Math.abs(rm[2]) * hx + Math.abs(rm[6]) * hy + Math.abs(rm[10]) * hz;

  const spread = 1.35 + softness * 0.5;
  return {
    centerX: wcx,
    floorY: wcy - why - 0.0005,
    centerZ: wcz,
    halfExtentX: Math.max(0.05, whx * spread),
    halfExtentZ: Math.max(0.05, whz * spread),
    intensity: Math.min(1, intensity),
    softness,
  };
}

function resolveEnvHandle(viewer: ViewerLike): object | null {
  if (
    viewer.environmentTexture &&
    typeof viewer.environmentTexture === 'object'
  ) {
    return viewer.environmentTexture;
  }
  if (
    viewer.environmentSource &&
    typeof viewer.environmentSource === 'object'
  ) {
    return viewer.environmentSource as object;
  }
  return null;
}

function destroyCompiledScene(scene: CompiledScene | null): void {
  if (!scene) return;
  safe(() => scene.vertexBuf.destroy());
  safe(() => scene.indexBuf?.destroy());
  safe(() => scene.partBuf.destroy());
  safe(() => scene.uniformBuf.destroy());
  safe(() => scene.pickUniformBuf?.destroy());
}

function destroyAttachments(st: ViewerGPUState): void {
  safe(() => st.msaaTex?.destroy());
  safe(() => st.depthTex?.destroy());
  st.msaaTex = null;
  st.msaaView = null;
  st.depthTex = null;
  st.depthView = null;
  st.width = 0;
  st.height = 0;
}

function destroyPickTargets(st: ViewerGPUState): void {
  safe(() => st.pickColorTex?.destroy());
  safe(() => st.pickDepthTex?.destroy());
  safe(() => st.pickReadBuf?.destroy());
  st.pickColorTex = null;
  st.pickColorView = null;
  st.pickDepthTex = null;
  st.pickDepthView = null;
  st.pickReadBuf = null;
  st.pickBusy = false;
}

function isSceneTopologyMatching(
  scene: CompiledScene,
  backdrop: readonly MeshLike[],
  meshes: readonly MeshLike[],
): boolean {
  if (scene.backdropCount !== backdrop.length) return false;
  if (scene.meshRefs.length !== backdrop.length + meshes.length) return false;
  for (let i = 0; i < backdrop.length; i++) {
    if (scene.meshRefs[i] !== backdrop[i]) return false;
  }
  for (let i = 0; i < meshes.length; i++) {
    if (scene.meshRefs[backdrop.length + i] !== meshes[i]) return false;
  }
  for (const g of scene.groups) {
    if (g.prim.positions !== g.posRef) return false;
    if ((g.prim.indices ?? null) !== g.idxRef) return false;
    const instMats = g.mesh.instanceMatrices;
    const expectedInst =
      instMats && instMats.length >= 16
        ? instMats.length >> 4
        : g.prim.instanceCount !== undefined && g.prim.translations
          ? g.prim.instanceCount
          : 1;
    if (expectedInst !== g.instanceCount) return false;
  }
  return true;
}

function compileScene(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  viewer: ViewerLike,
  includeBackdrop: boolean,
): CompiledScene | null {
  const backdrop = includeBackdrop ? (viewer.backdropMeshes ?? []) : [];
  const meshes = viewer.meshes ?? [];
  const meshRefs: MeshLike[] = [...backdrop, ...meshes];

  let totalVertices = 0;
  let totalIndices = 0;
  let totalInstances = 0;
  const groups: CompiledPartGroup[] = [];

  for (let mi = 0; mi < meshRefs.length; mi++) {
    const mesh = meshRefs[mi];
    const xr = mesh.extras?.xr ?? mesh.userData?.xr;
    if (xr?.['splatUrl'] || xr?.['splat']) continue;
    const isBackdrop = mi < backdrop.length;
    const meshIndex =
      isBackdrop || mesh.isPluginMesh || xr?.['pointerEvents'] === 'none'
        ? -1
        : mi - backdrop.length;
    const instMats = mesh.instanceMatrices;

    for (const prim of mesh.primitives ?? []) {
      const pos = prim.positions;
      if (!pos || pos.length < 3) continue;
      const vCount = Math.floor(pos.length / 3);
      if (vCount <= 0) continue;

      const idx = prim.indices ?? null;
      const indexed = Boolean(idx && idx.length > 0);
      const iCount = indexed
        ? idx!.length
        : Math.min(vCount, prim.indexCount ?? vCount);
      if (iCount <= 0) continue;

      const instCount =
        instMats && instMats.length >= 16
          ? instMats.length >> 4
          : prim.instanceCount !== undefined && prim.translations
            ? Math.max(1, prim.instanceCount | 0)
            : 1;

      const matInfo = buildMaterialBindGroup(dev, pipes, prim);
      groups.push({
        mesh,
        prim,
        posRef: pos,
        idxRef: idx,
        meshIndex,
        isBackdrop,
        firstVertex: totalVertices,
        vertexCount: vCount,
        indexed,
        firstIndex: totalIndices,
        indexCount: iCount,
        firstInstance: totalInstances,
        instanceCount: instCount,
        isBlend: Boolean(
          prim.alphaMode === 'BLEND' || (prim.baseColor?.[3] ?? 1) < 0.999,
        ),
        tex0: prim.texture ?? null,
        tex1: prim.metallicRoughnessTexture ?? null,
        tex2: prim.normalTexture ?? null,
        tex3: prim.occlusionTexture ?? null,
        tex4: prim.emissiveTexture ?? null,
        src0: matInfo.src0,
        src1: matInfo.src1,
        src2: matInfo.src2,
        src3: matInfo.src3,
        src4: matInfo.src4,
        matBg: matInfo.bg,
      });

      totalVertices += vCount;
      if (indexed) totalIndices += iCount;
      totalInstances += instCount;
    }
  }

  if (groups.length === 0 || totalVertices === 0 || totalInstances === 0) {
    return null;
  }

  const vSlab = new Float32Array(totalVertices * VERTEX_STRIDE_FLOATS);
  const iSlab = totalIndices > 0 ? new Uint32Array(totalIndices) : null;

  for (const g of groups) {
    const pos = g.posRef;
    const norm = g.prim.normals;
    const uvs = g.prim.uvs;
    const vCount = g.vertexCount;
    let dst = g.firstVertex * VERTEX_STRIDE_FLOATS;
    for (let v = 0; v < vCount; v++) {
      const p3 = v * 3;
      const u2 = v * 2;
      vSlab[dst] = pos[p3];
      vSlab[dst + 1] = pos[p3 + 1];
      vSlab[dst + 2] = pos[p3 + 2];
      if (norm && p3 + 2 < norm.length) {
        vSlab[dst + 3] = norm[p3];
        vSlab[dst + 4] = norm[p3 + 1];
        vSlab[dst + 5] = norm[p3 + 2];
      }
      if (uvs && u2 + 1 < uvs.length) {
        vSlab[dst + 6] = uvs[u2];
        vSlab[dst + 7] = uvs[u2 + 1];
      }
      dst += VERTEX_STRIDE_FLOATS;
    }
    if (g.indexed && iSlab && g.idxRef) {
      const srcIdx = g.idxRef;
      const base = g.firstIndex;
      for (let k = 0; k < g.indexCount; k++) {
        iSlab[base + k] = srcIdx[k];
      }
    }
  }

  const vertexBuf = dev.createBuffer({
    size: align4(vSlab.byteLength),
    usage: BUF_VERTEX | BUF_COPY_DST,
  });
  dev.queue.writeBuffer(vertexBuf, 0, vSlab);

  let indexBuf: GPUSceneBufferLike | null = null;
  if (iSlab) {
    indexBuf = dev.createBuffer({
      size: align4(iSlab.byteLength),
      usage: BUF_INDEX | BUF_COPY_DST,
    });
    dev.queue.writeBuffer(indexBuf, 0, iSlab);
  }

  const partBytes = Math.max(
    PART_STRIDE_BYTES,
    totalInstances * PART_STRIDE_BYTES,
  );
  const partBuf = dev.createBuffer({
    size: partBytes,
    usage: BUF_STORAGE | BUF_COPY_DST,
  });
  const uniformBuf = dev.createBuffer({
    size: SCENE_UNIFORM_BYTES,
    usage: BUF_UNIFORM | BUF_COPY_DST,
  });

  const envHandle = resolveEnvHandle(viewer);
  const envInfo = resolveGPUTextureView(dev, pipes, envHandle);
  const sceneBg = dev.createBindGroup({
    layout: pipes.sceneBgl,
    entries: [
      {binding: 0, resource: {buffer: uniformBuf}},
      {binding: 1, resource: {buffer: partBuf}},
      {binding: 2, resource: pipes.sampler},
      {binding: 3, resource: envInfo.view},
    ],
  });

  const cpuPartBuf = new ArrayBuffer(partBytes);
  return {
    meshRefs,
    backdropCount: backdrop.length,
    groups,
    totalVertices,
    totalIndices,
    totalInstances,
    vertexBuf,
    indexBuf,
    partBuf,
    uniformBuf,
    pickUniformBuf: null,
    pickSceneBg: null,
    cpuPartBuf,
    cpuPartF32: new Float32Array(cpuPartBuf),
    cpuPartU32: new Uint32Array(cpuPartBuf),
    gpuPartU32: new Uint32Array(partBytes >>> 2),
    partsUploadedOnce: false,
    envSourceRef: extractImageSource(envHandle),
    envView: envInfo.view,
    sceneBg,
    opaqueBundle: null,
    blendBundle: null,
    pickBundle: null,
    bundleFormat: '',
    bundleSamples: 0,
    bundlesDirty: true,
  };
}

function recordSceneBundles(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  scene: CompiledScene,
  format: string,
  sampleCount: number,
): void {
  const fp = getFormatPipelines(dev, pipes, format, sampleCount);

  const encodePass = (
    blendPass: boolean,
    pipeline: unknown,
  ): GPUSceneRenderBundleLike | null => {
    const matching = scene.groups.filter((g) => g.isBlend === blendPass);
    if (matching.length === 0) return null;

    // Group opaque non-backdrop draws by material bind group (`defaultMatBg`
    // first) so 10,000-part untextured CAD models bind `@group(1)` once.
    const ordered = blendPass
      ? matching
      : [
          ...matching.filter((g) => g.isBackdrop),
          ...matching.filter(
            (g) => !g.isBackdrop && g.matBg === pipes.defaultMatBg,
          ),
          ...matching.filter(
            (g) => !g.isBackdrop && g.matBg !== pipes.defaultMatBg,
          ),
        ];

    const enc = dev.createRenderBundleEncoder({
      colorFormats: [format],
      depthStencilFormat: 'depth24plus',
      sampleCount,
    });
    enc.setPipeline(pipeline);
    enc.setBindGroup(0, scene.sceneBg);
    enc.setVertexBuffer(0, scene.vertexBuf);
    if (scene.indexBuf) {
      enc.setIndexBuffer(scene.indexBuf, 'uint32');
    }

    let lastMatBg: unknown = null;
    for (const g of ordered) {
      if (g.matBg !== lastMatBg) {
        enc.setBindGroup(1, g.matBg);
        lastMatBg = g.matBg;
      }
      if (g.indexed) {
        enc.drawIndexed(
          g.indexCount,
          g.instanceCount,
          g.firstIndex,
          g.firstVertex,
          g.firstInstance,
        );
      } else {
        enc.draw(g.indexCount, g.instanceCount, g.firstVertex, g.firstInstance);
      }
    }
    return enc.finish();
  };

  scene.opaqueBundle = encodePass(false, fp.opaque);
  scene.blendBundle = encodePass(true, fp.blend);
  scene.pickBundle = null;
  scene.bundleFormat = format;
  scene.bundleSamples = sampleCount;
  scene.bundlesDirty = false;
}

function ensurePickBundle(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  scene: CompiledScene,
): GPUSceneRenderBundleLike {
  if (!scene.pickUniformBuf) {
    scene.pickUniformBuf = dev.createBuffer({
      size: SCENE_UNIFORM_BYTES,
      usage: BUF_UNIFORM | BUF_COPY_DST,
    });
  }
  if (!scene.pickSceneBg) {
    scene.pickSceneBg = dev.createBindGroup({
      layout: pipes.sceneBgl,
      entries: [
        {binding: 0, resource: {buffer: scene.pickUniformBuf}},
        {binding: 1, resource: {buffer: scene.partBuf}},
        {binding: 2, resource: pipes.sampler},
        {binding: 3, resource: pipes.whiteView},
      ],
    });
  }
  if (scene.pickBundle) return scene.pickBundle;
  const enc = dev.createRenderBundleEncoder({
    colorFormats: ['rgba8unorm'],
    depthStencilFormat: 'depth24plus',
    sampleCount: 1,
  });
  enc.setPipeline(pipes.pickPipeline);
  enc.setBindGroup(0, scene.pickSceneBg);
  enc.setVertexBuffer(0, scene.vertexBuf);
  if (scene.indexBuf) {
    enc.setIndexBuffer(scene.indexBuf, 'uint32');
  }
  for (const g of scene.groups) {
    if (g.meshIndex < 0) continue;
    if (g.indexed) {
      enc.drawIndexed(
        g.indexCount,
        g.instanceCount,
        g.firstIndex,
        g.firstVertex,
        g.firstInstance,
      );
    } else {
      enc.draw(g.indexCount, g.instanceCount, g.firstVertex, g.firstInstance);
    }
  }
  scene.pickBundle = enc.finish();
  return scene.pickBundle;
}

const _tmpMatA = mat4Create();
const _tmpMatB = mat4Create();

function syncSceneResources(
  dev: GPUSceneDeviceLike,
  pipes: DevicePipelines,
  viewer: ViewerLike,
  scene: CompiledScene,
  params: GPUSceneRenderParams,
): void {
  // 1. Refresh environment IBL bind group if `environmentImage` finished decoding.
  const envHandle = resolveEnvHandle(viewer);
  const envSrc = extractImageSource(envHandle);
  if (envSrc !== scene.envSourceRef) {
    const envInfo = resolveGPUTextureView(dev, pipes, envHandle);
    scene.envSourceRef = envInfo.src;
    if (envInfo.view !== scene.envView) {
      scene.envView = envInfo.view;
      scene.sceneBg = dev.createBindGroup({
        layout: pipes.sceneBgl,
        entries: [
          {binding: 0, resource: {buffer: scene.uniformBuf}},
          {binding: 1, resource: {buffer: scene.partBuf}},
          {binding: 2, resource: pipes.sampler},
          {binding: 3, resource: envInfo.view},
        ],
      });
      scene.bundlesDirty = true;
    }
  }

  // 2. Pack `PartInstance` CPU staging words & detect tight dirty range.
  const f32 = scene.cpuPartF32;
  const u32 = scene.cpuPartU32;
  const selNames = viewer.selectedMeshNames;
  const selName = viewer.selectedMeshName || '';
  const root = viewer.modelRootMatrix ?? IDENTITY_MAT4;
  const allowBillboard = params.eye === 'none' && !viewer.stereoSBS;

  for (const g of scene.groups) {
    const mesh = g.mesh;
    const prim = g.prim;

    // Detect material texture swaps (`selectVariant`) or async image decodes.
    const t0 = prim.texture ?? null;
    const t1 = prim.metallicRoughnessTexture ?? null;
    const t2 = prim.normalTexture ?? null;
    const t3 = prim.occlusionTexture ?? null;
    const t4 = prim.emissiveTexture ?? null;
    if (
      t0 !== g.tex0 ||
      t1 !== g.tex1 ||
      t2 !== g.tex2 ||
      t3 !== g.tex3 ||
      t4 !== g.tex4 ||
      extractImageSource(t0) !== g.src0 ||
      extractImageSource(t1) !== g.src1 ||
      extractImageSource(t2) !== g.src2 ||
      extractImageSource(t3) !== g.src3 ||
      extractImageSource(t4) !== g.src4
    ) {
      const mInfo = buildMaterialBindGroup(dev, pipes, prim);
      g.tex0 = t0;
      g.tex1 = t1;
      g.tex2 = t2;
      g.tex3 = t3;
      g.tex4 = t4;
      g.src0 = mInfo.src0;
      g.src1 = mInfo.src1;
      g.src2 = mInfo.src2;
      g.src3 = mInfo.src3;
      g.src4 = mInfo.src4;
      if (g.matBg !== mInfo.bg) {
        g.matBg = mInfo.bg;
        scene.bundlesDirty = true;
      }
    }

    const bc = prim.baseColor ?? [1, 1, 1, 1];
    const bcR = bc[0] ?? 1;
    const bcG = bc[1] ?? 1;
    const bcB = bc[2] ?? 1;
    const bcA = bc[3] ?? 1;
    const nowBlend = Boolean(prim.alphaMode === 'BLEND' || bcA < 0.999);
    if (nowBlend !== g.isBlend) {
      g.isBlend = nowBlend;
      scene.bundlesDirty = true;
    }

    let flags = 0;
    if (g.src0) flags |= PART_FLAG_HAS_BASE_TEX;
    if (g.src1) flags |= PART_FLAG_HAS_MR_TEX;
    if (g.src2) flags |= PART_FLAG_HAS_NORMAL_TEX;
    if (g.src3) flags |= PART_FLAG_HAS_OCC_TEX;
    if (g.src4) flags |= PART_FLAG_HAS_EMISSIVE_TEX;
    if (g.isBackdrop || mesh.isPluginMesh) flags |= PART_FLAG_NO_SECTION_CLIP;
    if (mesh.visible === false) flags |= PART_FLAG_HIDDEN;

    const xr = mesh.extras?.xr ?? mesh.userData?.xr;
    const stereoMode = xr?.['stereo'];
    if (stereoMode === 'sbs') flags |= 1 << PART_STEREO_SHIFT;
    else if (stereoMode === 'ou') flags |= 2 << PART_STEREO_SHIFT;

    const bb = allowBillboard ? xr?.['billboard'] : undefined;
    const isWorldSpace =
      g.isBackdrop ||
      mesh.worldSpace === true ||
      mesh.name === '__xr_reticle__' ||
      Boolean(bb);
    if (isWorldSpace) flags |= PART_FLAG_WORLD_SPACE;

    let baseMat: Float32Array = mesh.transform;
    if (bb) {
      if (
        g.isBackdrop ||
        mesh.worldSpace === true ||
        mesh.name === '__xr_reticle__'
      ) {
        _tmpMatA.set(mesh.transform);
      } else {
        mat4Multiply(_tmpMatA, root, mesh.transform);
      }
      const m = _tmpMatA;
      const sx = Math.hypot(m[0], m[1], m[2]) || 1;
      const sy = Math.hypot(m[4], m[5], m[6]) || 1;
      const sz = Math.hypot(m[8], m[9], m[10]) || 1;
      const yOnly = bb === 'y' || bb === 'cylindrical' || bb === 'capsule';
      const dx = params.eyePos[0] - m[12];
      const dz = params.eyePos[2] - m[14];
      const dl = Math.hypot(dx, dz);
      const bx = dl > 1e-5 ? dx / dl : 0;
      const bz = dl > 1e-5 ? dz / dl : 1;
      if (yOnly) {
        m[0] = bz * sx;
        m[1] = 0;
        m[2] = -bx * sx;
        m[3] = 0;
        m[4] = 0;
        m[5] = sy;
        m[6] = 0;
        m[7] = 0;
        m[8] = bx * sz;
        m[9] = 0;
        m[10] = bz * sz;
        m[11] = 0;
      } else {
        const av = params.view;
        m[0] = av[0] * sx;
        m[1] = av[4] * sx;
        m[2] = av[8] * sx;
        m[3] = 0;
        m[4] = av[1] * sy;
        m[5] = av[5] * sy;
        m[6] = av[9] * sy;
        m[7] = 0;
        m[8] = av[2] * sz;
        m[9] = av[6] * sz;
        m[10] = av[10] * sz;
        m[11] = 0;
      }
      baseMat = m;
    }

    const metallic = prim.metallic ?? 0;
    const roughness = prim.roughness ?? 0.5;
    const cc = prim.clearcoat ?? 0;
    const ccRough = prim.clearcoatRoughness ?? 0.04;
    const em = prim.emissiveFactor;
    const emR = em?.[0] ?? 0;
    const emG = em?.[1] ?? 0;
    const emB = em?.[2] ?? 0;
    const isSel = selNames
      ? selNames.has(mesh.name)
      : selName !== '' && mesh.name === selName;
    const selGlow = isSel ? 1.0 : 0.0;
    const normScale = prim.normalScale ?? 1.0;
    const occStrength = prim.occlusionStrength ?? 1.0;
    const pickId = g.meshIndex >= 0 ? (g.meshIndex + 1) >>> 0 : 0;

    const instMats = mesh.instanceMatrices;
    const instCols = mesh.instanceColors;
    const dynTrans = prim.translations;

    for (let inst = 0; inst < g.instanceCount; inst++) {
      const w = (g.firstInstance + inst) * PART_STRIDE_WORDS;
      let instMat = baseMat;
      if (instMats && instMats.length >= (inst + 1) * 16) {
        mat4Multiply(
          _tmpMatB,
          baseMat,
          instMats.subarray(inst * 16, inst * 16 + 16),
        );
        instMat = _tmpMatB;
      } else if (dynTrans && dynTrans.length >= (inst + 1) * 3) {
        _tmpMatB.set(baseMat);
        const tx = dynTrans[inst * 3];
        const ty = dynTrans[inst * 3 + 1];
        const tz = dynTrans[inst * 3 + 2];
        _tmpMatB[12] += baseMat[0] * tx + baseMat[4] * ty + baseMat[8] * tz;
        _tmpMatB[13] += baseMat[1] * tx + baseMat[5] * ty + baseMat[9] * tz;
        _tmpMatB[14] += baseMat[2] * tx + baseMat[6] * ty + baseMat[10] * tz;
        instMat = _tmpMatB;
      }

      for (let k = 0; k < 16; k++) f32[w + k] = instMat[k];

      if (instCols && instCols.length >= (inst + 1) * 3) {
        f32[w + 16] = bcR * instCols[inst * 3];
        f32[w + 17] = bcG * instCols[inst * 3 + 1];
        f32[w + 18] = bcB * instCols[inst * 3 + 2];
      } else {
        f32[w + 16] = bcR;
        f32[w + 17] = bcG;
        f32[w + 18] = bcB;
      }
      f32[w + 19] = bcA;

      f32[w + 20] = metallic;
      f32[w + 21] = roughness;
      f32[w + 22] = cc;
      f32[w + 23] = ccRough;

      f32[w + 24] = emR;
      f32[w + 25] = emG;
      f32[w + 26] = emB;
      f32[w + 27] = selGlow;

      f32[w + 28] = normScale;
      f32[w + 29] = occStrength;
      u32[w + 30] = flags >>> 0;
      u32[w + 31] = pickId;
    }
  }

  const totalWords = scene.totalInstances * PART_STRIDE_WORDS;
  if (!scene.partsUploadedOnce) {
    dev.queue.writeBuffer(scene.partBuf, 0, u32, 0, totalWords);
    scene.gpuPartU32.set(u32.subarray(0, totalWords));
    scene.partsUploadedOnce = true;
  } else {
    const mirror = scene.gpuPartU32;
    let firstDirty = -1;
    let lastDirty = -1;
    for (let i = 0; i < totalWords; i++) {
      if (u32[i] !== mirror[i]) {
        if (firstDirty < 0) firstDirty = i;
        lastDirty = i;
        mirror[i] = u32[i];
      }
    }
    if (firstDirty >= 0) {
      const count = lastDirty - firstDirty + 1;
      dev.queue.writeBuffer(
        scene.partBuf,
        firstDirty * 4,
        u32,
        firstDirty,
        count,
      );
    }
  }
}

function buildPixelPickVp(
  out: Float32Array,
  vp: Float32Array,
  px: number,
  py: number,
  width: number,
  height: number,
): Float32Array {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const cx = ((px + 0.5) / w) * 2 - 1;
  const cy = 1 - ((py + 0.5) / h) * 2;
  for (let col = 0; col < 4; col++) {
    const b = col * 4;
    const vx = vp[b];
    const vy = vp[b + 1];
    const vz = vp[b + 2];
    const vw = vp[b + 3];
    out[b] = w * (vx - cx * vw);
    out[b + 1] = h * (vy - cy * vw);
    out[b + 2] = vz;
    out[b + 3] = vw;
  }
  return out;
}

/**
 * WebGPU `GPURenderBundle` + Storage-Buffer Scene Accelerator implementing
 * `GPUSceneAccelerator`.
 */
export class WebGPUSceneAccelerator implements GPUSceneAccelerator {
  private readonly states = new WeakMap<object, ViewerGPUState>();
  private readonly trackedViewers = new Set<object>();

  /** Diagnostic counter: total `renderScene` frames rendered via WebGPU. */
  renderedFrames = 0;
  /** Diagnostic counter: total `GPURenderBundle` compilation passes. */
  bundleRecordCount = 0;

  private getState(viewer: object): ViewerGPUState {
    let st = this.states.get(viewer);
    if (!st) {
      st = {
        dev: null,
        canvas: null,
        ctx: null,
        configuredFormat: '',
        visible: false,
        width: 0,
        height: 0,
        sampleCount: MSAA_SAMPLES,
        msaaTex: null,
        msaaView: null,
        depthTex: null,
        depthView: null,
        pickColorTex: null,
        pickColorView: null,
        pickDepthTex: null,
        pickDepthView: null,
        pickReadBuf: null,
        pickBusy: false,
        scene: null,
        unhookSnapshot: null,
        gen: 0,
        uniformScratch: new ArrayBuffer(SCENE_UNIFORM_BYTES),
      };
      this.states.set(viewer, st);
      this.trackedViewers.add(viewer);
    }
    return st;
  }

  private ensureCanvas(
    viewer: ViewerLike,
    st: ViewerGPUState,
    dev: GPUSceneDeviceLike,
  ): GPUSceneCanvasContextLike | null {
    const glCanvas = viewer.canvas ?? (viewer.gl?.canvas as HTMLCanvasElement);
    if (!glCanvas || typeof document === 'undefined') return null;

    if (!st.canvas) {
      const parent = glCanvas.parentElement;
      if (!parent || typeof parent.insertBefore !== 'function') return null;
      const cv = document.createElement('canvas');
      cv.className = 'three-live-webgpu-scene';
      if (cv.style) {
        cv.style.cssText =
          'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:0';
      }
      parent.insertBefore(cv, glCanvas.nextSibling);
      const ctx = cv.getContext?.(
        'webgpu',
      ) as unknown as GPUSceneCanvasContextLike | null;
      if (!ctx || typeof ctx.configure !== 'function') {
        safe(() => cv.remove?.());
        return null;
      }
      st.canvas = cv;
      st.ctx = ctx;
      st.visible = true;
      st.unhookSnapshot = hookCanvasSnapshots(glCanvas, st);
    }

    const w = Math.max(1, glCanvas.width || 1);
    const h = Math.max(1, glCanvas.height || 1);
    const resized = st.canvas!.width !== w || st.canvas!.height !== h;
    if (resized) {
      st.canvas!.width = w;
      st.canvas!.height = h;
    }

    if (
      st.dev !== dev ||
      st.configuredFormat !== preferredCanvasFormat ||
      resized
    ) {
      st.ctx!.configure({
        device: dev,
        format: preferredCanvasFormat,
        alphaMode: 'premultiplied',
      });
      st.dev = dev;
      st.configuredFormat = preferredCanvasFormat;
    }

    if (st.width !== w || st.height !== h || !st.depthTex) {
      destroyAttachments(st);
      st.width = w;
      st.height = h;
      let samples = MSAA_SAMPLES;
      let msaaTex = null as GPUSceneTextureLike | null;
      safe(() => {
        msaaTex = dev.createTexture({
          size: {width: w, height: h, depthOrArrayLayers: 1},
          format: preferredCanvasFormat,
          sampleCount: MSAA_SAMPLES,
          usage: TEX_RENDER_ATTACHMENT,
        });
      });
      if (!msaaTex) {
        samples = 1;
      }
      const depthTex = dev.createTexture({
        size: {width: w, height: h, depthOrArrayLayers: 1},
        format: 'depth24plus',
        sampleCount: samples,
        usage: TEX_RENDER_ATTACHMENT,
      });
      st.sampleCount = samples;
      st.msaaTex = msaaTex;
      st.msaaView = msaaTex ? msaaTex.createView() : null;
      st.depthTex = depthTex;
      st.depthView = depthTex.createView();
    }

    if (!st.visible && st.canvas?.style) {
      st.canvas.style.display = 'block';
      st.visible = true;
    }
    return st.ctx;
  }

  renderScene(
    viewerObj: object,
    vp: Float32Array,
    proj: Float32Array,
    view: Float32Array,
    eyePos: readonly [number, number, number],
    toneMappingIndex: number,
    viewport: readonly [number, number, number, number],
    eye: 'left' | 'right' | 'none',
    clear: boolean,
    isAR: boolean,
  ): boolean {
    const params: GPUSceneRenderParams = {
      viewer: viewerObj,
      vp,
      proj,
      view,
      eyePos,
      toneMappingIndex,
      viewport,
      eye,
      clear,
      isAR,
    };
    const viewer = params.viewer as ViewerLike;
    const st = this.getState(params.viewer);

    if (!cachedDevice) {
      if (!deviceFailed && !devicePromise) {
        const genAtKickoff = st.gen;
        void acquireSceneWebGPUDevice().then((dev) => {
          if (
            dev &&
            st.gen === genAtKickoff &&
            this.trackedViewers.has(params.viewer)
          ) {
            safe(() => (params.viewer as {render?: () => void}).render?.());
          }
        });
      }
      this.hideLayer(params.viewer);
      return false;
    }

    const dev = cachedDevice;
    if (resolveSceneRenderBackend(viewer, true) !== 'webgpu') {
      this.hideLayer(params.viewer);
      return false;
    }

    if (st.dev && st.dev !== dev) {
      destroyCompiledScene(st.scene);
      st.scene = null;
      destroyAttachments(st);
      destroyPickTargets(st);
    }

    const ctx = this.ensureCanvas(viewer, st, dev);
    if (!ctx) return false;

    const pipes = getDevicePipelines(dev);
    const includeBackdrop = !params.isAR;
    const backdrop = includeBackdrop ? (viewer.backdropMeshes ?? []) : [];
    const meshes = viewer.meshes ?? [];

    if (!st.scene || !isSceneTopologyMatching(st.scene, backdrop, meshes)) {
      destroyCompiledScene(st.scene);
      st.scene = compileScene(dev, pipes, viewer, includeBackdrop);
      if (!st.scene) {
        this.hideLayer(params.viewer);
        return false;
      }
    }

    const scene = st.scene;
    syncSceneResources(dev, pipes, viewer, scene, params);

    if (
      scene.bundlesDirty ||
      scene.bundleFormat !== preferredCanvasFormat ||
      scene.bundleSamples !== st.sampleCount
    ) {
      recordSceneBundles(
        dev,
        pipes,
        scene,
        preferredCanvasFormat,
        st.sampleCount,
      );
      this.bundleRecordCount++;
    }

    const sectionPlane = parseViewerSectionPlane(viewer);
    const contactShadow = computeContactShadowInput(viewer, params.isAR);
    writeSceneUniforms(st.uniformScratch, {
      vp: params.vp,
      modelRoot: viewer.modelRootMatrix ?? IDENTITY_MAT4,
      eyePos: params.eyePos,
      exposure: viewer.exposure ?? 1.0,
      envIntensity: viewer.envIntensity ?? 1.0,
      toneMappingIndex: params.toneMappingIndex,
      lights: viewer.lights ?? [],
      hasEnvMap: scene.envSourceRef !== null,
      isRightEye: params.eye === 'right',
      sectionPlane,
      contactShadow,
    });
    dev.queue.writeBuffer(scene.uniformBuf, 0, st.uniformScratch);

    const canvasView = ctx.getCurrentTexture().createView();
    const cc = params.isAR ? [0, 0, 0, 0] : (viewer.clearColor ?? [0, 0, 0, 0]);
    const ca = cc[3] ?? 0;
    const clearValue = {
      r: (cc[0] ?? 0) * ca,
      g: (cc[1] ?? 0) * ca,
      b: (cc[2] ?? 0) * ca,
      a: ca,
    };
    const keepAttachment = Boolean(viewer.stereoSBS);
    const useMsaa = st.sampleCount > 1 && Boolean(st.msaaView);

    const encoder = dev.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        useMsaa
          ? {
              view: st.msaaView,
              resolveTarget: canvasView,
              loadOp: params.clear ? 'clear' : 'load',
              storeOp: keepAttachment ? 'store' : 'discard',
              clearValue,
            }
          : {
              view: canvasView,
              loadOp: params.clear ? 'clear' : 'load',
              storeOp: 'store',
              clearValue,
            },
      ],
      depthStencilAttachment: {
        view: st.depthView,
        depthClearValue: 1.0,
        depthLoadOp: params.clear ? 'clear' : 'load',
        depthStoreOp: keepAttachment ? 'store' : 'discard',
      },
    });

    const [vpX, vpY, vpW, vpH] = params.viewport;
    if (
      pass.setViewport &&
      (vpX !== 0 || vpY !== 0 || vpW !== st.width || vpH !== st.height)
    ) {
      const clampedVpX = Math.max(0, Math.min(st.width - 1, vpX));
      const clampedTopY = Math.max(
        0,
        Math.min(st.height - 1, st.height - vpY - vpH),
      );
      pass.setViewport(
        clampedVpX,
        clampedTopY,
        Math.max(1, Math.min(st.width - clampedVpX, vpW)),
        Math.max(1, Math.min(st.height - clampedTopY, vpH)),
        0,
        1,
      );
    }

    if (scene.opaqueBundle) {
      pass.executeBundles([scene.opaqueBundle]);
    }
    if (contactShadow) {
      const fp = getFormatPipelines(
        dev,
        pipes,
        preferredCanvasFormat,
        st.sampleCount,
      );
      pass.setPipeline(fp.shadow);
      pass.setBindGroup(0, scene.sceneBg);
      pass.draw(4, 1, 0, 0);
    }
    if (scene.blendBundle) {
      pass.executeBundles([scene.blendBundle]);
    }
    pass.end();
    dev.queue.submit([encoder.finish()]);
    this.renderedFrames++;
    return true;
  }

  /**
   * Asynchronous 1x1 sub-frustum GPU Color-ID mesh picker using a cached
   * `GPURenderBundle` (`>= 0` index into `viewer.meshes`, or `-1` on miss).
   */
  async pickMeshGPU(
    viewerObj: object,
    canvasX: number,
    canvasY: number,
    vpOverride?: Float32Array,
  ): Promise<number> {
    const viewer = viewerObj as ViewerLike;
    const meshes = viewer.meshes ?? [];
    if (meshes.length === 0) return -1;

    const dev = cachedDevice ?? (await acquireSceneWebGPUDevice());
    if (!dev || typeof dev.createCommandEncoder !== 'function') return -1;

    const st = this.getState(viewerObj);
    const genAtStart = st.gen;
    const pipes = getDevicePipelines(dev);
    const backdrop = viewer.backdropMeshes ?? [];
    if (!st.scene || !isSceneTopologyMatching(st.scene, backdrop, meshes)) {
      destroyCompiledScene(st.scene);
      st.scene = compileScene(dev, pipes, viewer, true);
      if (!st.scene) return -1;
    }

    const scene = st.scene;
    const w = Math.max(1, viewer.canvas?.width || st.width || 300);
    const h = Math.max(1, viewer.canvas?.height || st.height || 300);

    let mappedX = canvasX;
    if (viewer.stereoSBS && !viewer.xrSessionActive && w >= 2) {
      const halfW = Math.max(1, Math.floor(w * 0.5));
      const inRight = canvasX >= halfW;
      const eyeX = inRight ? canvasX - halfW : canvasX;
      const eyeW = inRight ? Math.max(1, w - halfW) : halfW;
      const eyeNdc = ((eyeX + 0.5) / eyeW) * 2 - 1;
      mappedX = Math.floor((eyeNdc * 0.5 + 1) * 0.5 * w);
    }
    const clampedX = Math.max(0, Math.min(w - 1, Math.floor(mappedX)));
    const clampedY = Math.max(0, Math.min(h - 1, Math.floor(canvasY)));

    const fullVp = mat4Create();
    if (vpOverride) {
      fullVp.set(vpOverride);
    } else if (viewer.projMatrix && viewer.viewMatrix) {
      mat4Multiply(fullVp, viewer.projMatrix, viewer.viewMatrix);
    } else {
      fullVp.set(IDENTITY_MAT4);
    }

    syncSceneResources(dev, pipes, viewer, scene, {
      viewer: viewerObj,
      vp: fullVp,
      proj: viewer.projMatrix ?? IDENTITY_MAT4,
      view: viewer.viewMatrix ?? IDENTITY_MAT4,
      eyePos: [0, 0, 3],
      toneMappingIndex: 0,
      viewport: [0, 0, w, h],
      eye: 'none',
      clear: true,
      isAR: false,
    });

    if (!st.pickColorTex || !st.pickDepthTex) {
      destroyPickTargets(st);
      st.pickColorTex = dev.createTexture({
        size: {width: 1, height: 1, depthOrArrayLayers: 1},
        format: 'rgba8unorm',
        usage: TEX_RENDER_ATTACHMENT | TEX_COPY_SRC,
      });
      st.pickColorView = st.pickColorTex.createView();
      st.pickDepthTex = dev.createTexture({
        size: {width: 1, height: 1, depthOrArrayLayers: 1},
        format: 'depth24plus',
        usage: TEX_RENDER_ATTACHMENT,
      });
      st.pickDepthView = st.pickDepthTex.createView();
      st.pickReadBuf = dev.createBuffer({
        size: 256,
        usage: BUF_COPY_DST | BUF_MAP_READ,
      });
    }

    const pickVp = buildPixelPickVp(
      mat4Create(),
      fullVp,
      clampedX,
      clampedY,
      w,
      h,
    );
    const pickBundle = ensurePickBundle(dev, pipes, scene);
    const pickUniforms = new ArrayBuffer(SCENE_UNIFORM_BYTES);
    writeSceneUniforms(pickUniforms, {
      vp: pickVp,
      modelRoot: viewer.modelRootMatrix ?? IDENTITY_MAT4,
      eyePos: [0, 0, 0],
      exposure: 1,
      envIntensity: 1,
      toneMappingIndex: 2,
      lights: [],
      hasEnvMap: false,
      sectionPlane: parseViewerSectionPlane(viewer),
    });
    dev.queue.writeBuffer(scene.pickUniformBuf!, 0, pickUniforms);

    const useSharedReadBuf = Boolean(st.pickReadBuf && !st.pickBusy);
    const readBuf = useSharedReadBuf
      ? st.pickReadBuf!
      : dev.createBuffer({size: 256, usage: BUF_COPY_DST | BUF_MAP_READ});
    if (useSharedReadBuf) st.pickBusy = true;

    try {
      const encoder = dev.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: st.pickColorView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: {r: 0, g: 0, b: 0, a: 0},
          },
        ],
        depthStencilAttachment: {
          view: st.pickDepthView,
          depthClearValue: 1.0,
          depthLoadOp: 'clear',
          depthStoreOp: 'discard',
        },
      });
      pass.executeBundles([pickBundle]);
      pass.end();
      encoder.copyTextureToBuffer?.(
        {texture: st.pickColorTex!},
        {buffer: readBuf, bytesPerRow: 256, rowsPerImage: 1},
        {width: 1, height: 1, depthOrArrayLayers: 1},
      );
      dev.queue.submit([encoder.finish()]);

      await readBuf.mapAsync(MAP_READ, 0, 4);
      if (st.gen !== genAtStart) {
        safe(() => readBuf.unmap());
        return -1;
      }
      const bytes = new Uint8Array(readBuf.getMappedRange(0, 4));
      const r = bytes[0];
      const g = bytes[1];
      const b = bytes[2];
      readBuf.unmap();
      const id = r + (g << 8) + (b << 16);
      return id > 0 && id <= meshes.length ? id - 1 : -1;
    } finally {
      if (useSharedReadBuf) {
        st.pickBusy = false;
      } else {
        safe(() => readBuf.destroy());
      }
    }
  }

  hideLayer(viewer: object): void {
    const st = this.states.get(viewer);
    if (!st) return;
    if (st.canvas && st.visible) {
      if (st.canvas.style) st.canvas.style.display = 'none';
      st.visible = false;
    }
  }

  clearViewerScene(viewer: object): void {
    const st = this.states.get(viewer);
    if (!st) return;
    st.gen++;
    destroyCompiledScene(st.scene);
    st.scene = null;
    this.hideLayer(viewer);
  }

  disposeViewer(viewer: object): void {
    const st = this.states.get(viewer);
    if (!st) return;
    st.gen++;
    this.trackedViewers.delete(viewer);
    this.states.delete(viewer);
    st.unhookSnapshot?.();
    st.unhookSnapshot = null;
    destroyCompiledScene(st.scene);
    st.scene = null;
    destroyAttachments(st);
    destroyPickTargets(st);
    safe(() => st.ctx?.unconfigure?.());
    safe(() => st.canvas?.remove?.());
    st.ctx = null;
    st.canvas = null;
    st.dev = null;
    st.visible = false;
  }

  onDeviceLost(lostDev: GPUSceneDeviceLike): void {
    const pipes = pipelineCache.get(lostDev);
    if (pipes) {
      for (const tex of pipes.ownedTextures) {
        safe(() => tex.destroy());
      }
      pipes.ownedTextures.clear();
      pipelineCache.delete(lostDev);
    }
    for (const viewer of this.trackedViewers) {
      const st = this.states.get(viewer);
      if (st && st.dev === lostDev) {
        st.gen++;
        destroyCompiledScene(st.scene);
        st.scene = null;
        destroyAttachments(st);
        destroyPickTargets(st);
        st.dev = null;
        st.configuredFormat = '';
      }
    }
  }
}

/** Returns (creating if needed) the singleton `WebGPUSceneAccelerator`. */
export function getWebGPUSceneAccelerator(): WebGPUSceneAccelerator {
  if (!sharedSceneAccelerator) {
    sharedSceneAccelerator = new WebGPUSceneAccelerator();
  }
  return sharedSceneAccelerator;
}

/**
 * `ThreeLivePlugin` installing `WebGPUSceneAccelerator` onto the shared
 * `<three-live>` / `<xr-live>` registry (`gpuSceneAccelerator`).
 */
export const webgpuScenePlugin: ThreeLivePlugin = {
  name: 'three-live-webgpu-scene',

  onRegister(): void {
    const reg = getSharedRegistry();
    reg.gpuSceneAccelerator = getWebGPUSceneAccelerator();
    if (!reg.webgpuDeviceProvider) {
      reg.webgpuDeviceProvider = localProvider;
    }
    if (!cachedDevice && !deviceFailed && !devicePromise && getNavigatorGPU()) {
      void acquireSceneWebGPUDevice();
    }
  },

  onElementConnected(element: unknown): void {
    const el = element as {viewer?: object | null} | null;
    if (!cachedDevice && !deviceFailed && !devicePromise && getNavigatorGPU()) {
      void acquireSceneWebGPUDevice().then((dev) => {
        if (dev && el?.viewer) {
          safe(() => (el.viewer as {render?: () => void}).render?.());
        }
      });
    }
  },

  onAttributeChanged(element: unknown, name: string): void {
    if (name === 'renderer' || name === 'section-plane') {
      const el = element as {viewer?: {render?: () => void} | null} | null;
      el?.viewer?.render?.();
    }
  },

  onLoadModel(viewer: unknown): void {
    if (viewer && typeof viewer === 'object') {
      const st = getWebGPUSceneAccelerator();
      st.clearViewerScene(viewer);
    }
  },

  onClearScene(viewer: unknown): void {
    if (viewer && typeof viewer === 'object') {
      getWebGPUSceneAccelerator().clearViewerScene(viewer);
    }
  },

  onXRSessionEnd(viewer: unknown): void {
    if (viewer && typeof viewer === 'object') {
      safe(() => (viewer as {render?: () => void}).render?.());
    }
  },

  onDestroy(_gl: WebGL2RenderingContext, viewer: unknown): void {
    if (viewer && typeof viewer === 'object') {
      getWebGPUSceneAccelerator().disposeViewer(viewer);
    }
  },
};
