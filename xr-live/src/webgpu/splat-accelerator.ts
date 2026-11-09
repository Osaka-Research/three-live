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
 * @fileoverview Opt-in WebGPU Gaussian Splatting compute & render accelerator
 * (`xr-live-webgpu.min.js`) for `<xr-live>` and `<three-live>`.
 */

import {mat4Multiply} from '../../../three-live/src/math';
import {
  getRegisteredPlugins,
  getSharedRegistry,
  type SplatGPUAccelerator,
  type SplatGPUDrawParams,
  type SplatGPUFrameOutput,
  type ThreeLivePlugin,
} from '../../../three-live/src/plugin';
import {
  loadSplat,
  resolveSplatUrl,
  type SplatData,
} from '../plugins/splat-loader';
import {
  CLOUD_INDIRECT_OFFSET_BYTES,
  CLOUD_META_BYTES,
  packSplatBaseBuffer,
  packSplatSHBuffer,
  SORT_UNIFORM_BYTES,
  SPLAT_PREP_COMPUTE_WGSL,
  SPLAT_RENDER_WGSL,
  SPLAT_SORT_COMPUTE_WGSL,
  SPLAT_UNIFORM_BYTES,
  WEBGPU_RADIX_TILE_SIZE,
  WEBGPU_WORKGROUP_SIZE,
  writeSplatUniforms,
} from './shaders';

const BUF_MAP_READ = 0x0001;
const BUF_COPY_SRC = 0x0004;
const BUF_COPY_DST = 0x0008;
const BUF_UNIFORM = 0x0040;
const BUF_STORAGE = 0x0080;
const BUF_INDIRECT = 0x0100;
const MAP_READ = 0x0001;
const STAGE_VERTEX = 0x1;
const STAGE_COMPUTE = 0x4;

/** Minimal structural WebGPU interfaces (zero external `@webgpu/types` dep). */
export interface WebGPUBufferLike {
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  unmap(): void;
  destroy(): void;
}

export interface WebGPUComputePassEncoderLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  dispatchWorkgroups(x: number, y?: number, z?: number): void;
  end(): void;
}

export interface WebGPURenderPassEncoderLike {
  setPipeline(pipeline: unknown): void;
  setBindGroup(index: number, bindGroup: unknown): void;
  draw(
    vertexCount: number,
    instanceCount?: number,
    firstVertex?: number,
    firstInstance?: number,
  ): void;
  drawIndirect(indirectBuffer: WebGPUBufferLike, indirectOffset: number): void;
  end(): void;
}

export interface WebGPUCommandEncoderLike {
  beginComputePass(descriptor?: unknown): WebGPUComputePassEncoderLike;
  beginRenderPass(descriptor: unknown): WebGPURenderPassEncoderLike;
  copyBufferToBuffer(
    source: WebGPUBufferLike,
    sourceOffset: number,
    destination: WebGPUBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

export interface WebGPUDeviceLike {
  readonly queue: {
    writeBuffer(
      buffer: WebGPUBufferLike,
      bufferOffset: number,
      data: ArrayBufferView | ArrayBuffer,
      dataOffset?: number,
      size?: number,
    ): void;
    submit(commandBuffers: unknown[]): void;
  };
  readonly lost?: Promise<unknown>;
  createBuffer(descriptor: {
    size: number;
    usage: number;
    mappedAtCreation?: boolean;
  }): WebGPUBufferLike;
  createShaderModule(descriptor: {code: string}): unknown;
  createBindGroupLayout(descriptor: unknown): unknown;
  createPipelineLayout(descriptor: unknown): unknown;
  createComputePipeline(descriptor: unknown): unknown;
  createRenderPipeline(descriptor: unknown): unknown;
  createBindGroup(descriptor: unknown): unknown;
  createCommandEncoder(): WebGPUCommandEncoderLike;
  destroy?(): void;
}

export interface WebGPUCanvasContextLike {
  configure(config: {
    device: WebGPUDeviceLike;
    format: string;
    alphaMode?: string;
  }): void;
  unconfigure?(): void;
  getCurrentTexture(): {createView(): unknown};
}

/** Public attribute value accepted by `splat-renderer="..."`. */
export type SplatRendererPreference = 'auto' | 'webgpu' | 'hybrid' | 'webgl2';

/** Effective execution path chosen for a splat draw call. */
export type ResolvedSplatRenderMode = 'vram-overlay' | 'hybrid' | 'webgl2';

interface SplatViewerLike {
  gl?: WebGL2RenderingContext;
  // tslint:disable-next-line:no-any
  meshes?: any[];
  // tslint:disable-next-line:no-any
  container?: any;
  viewMatrix?: Float32Array;
  activeViewMatrix?: Float32Array | null;
  projMatrix?: Float32Array;
  modelRootMatrix?: Float32Array;
  xrSessionActive?: boolean;
}

let cachedDevice: WebGPUDeviceLike | null = null;
let devicePromise: Promise<WebGPUDeviceLike | null> | null = null;
let deviceFailed = false;
let preferredCanvasFormat = 'bgra8unorm';

function getNavigatorGPU(): {
  requestAdapter(opts?: unknown): Promise<{
    limits?: Record<string, number>;
    requestDevice(desc?: unknown): Promise<WebGPUDeviceLike>;
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

/**
 * Lazily acquires and caches a shared `GPUDevice` (with automatic reset on
 * `device.lost`). Returns `null` when WebGPU is unsupported or denied.
 */
export function acquireWebGPUDevice(): Promise<WebGPUDeviceLike | null> {
  if (cachedDevice) return Promise.resolve(cachedDevice);
  if (deviceFailed) return Promise.resolve(null);
  if (devicePromise) return devicePromise;

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
      for (const [k, m] of [
        ['maxStorageBufferBindingSize', 134217728],
        ['maxBufferSize', 268435456],
      ] as const) {
        if ((lim?.[k] ?? 0) > m) req[k] = lim![k];
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
          sharedAccelerator?.onDeviceLost(dev);
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

/** Synchronously returns the active `GPUDevice` if initialized, else kicks off acquisition. */
export function peekOrRequestWebGPUDevice(): WebGPUDeviceLike | null {
  if (!cachedDevice && !deviceFailed && !devicePromise) {
    void acquireWebGPUDevice();
  }
  return cachedDevice;
}

/** Injects or clears a mock `GPUDevice` for deterministic unit tests. */
export function setWebGPUDeviceForTests(
  device: WebGPUDeviceLike | null,
  format = 'bgra8unorm',
): void {
  cachedDevice = device;
  devicePromise = null;
  deviceFailed = false;
  preferredCanvasFormat = format;
}

/** Resets cached WebGPU device state. */
export function resetWebGPUDevice(): void {
  if (cachedDevice) sharedAccelerator?.onDeviceLost(cachedDevice);
  cachedDevice = null;
  devicePromise = null;
  deviceFailed = false;
}

// tslint:disable-next-line:no-any
const xrOf = (m: any): Record<string, unknown> | undefined =>
  m?.extras?.xr ?? m?.userData?.xr;

/** Returns true if `viewer.meshes` contains any visible non-splat glTF geometry. */
export function hasVisibleNonSplatMeshes(viewer: SplatViewerLike): boolean {
  return Boolean(
    viewer?.meshes?.some?.(
      (m) =>
        m &&
        m.visible !== false &&
        !xrOf(m)?.splatUrl &&
        m.primitives?.length !== 0,
    ),
  );
}

/**
 * Resolves the execution path (`'vram-overlay' | 'hybrid' | 'webgl2'`) for the
 * current viewer and eye pass.
 */
export function resolveSplatRenderMode(
  viewer: SplatViewerLike,
  eye: 'left' | 'right' | 'none' = 'none',
): ResolvedSplatRenderMode {
  const raw = (viewer?.container?.getAttribute?.('splat-renderer') ?? 'auto')
    .trim()
    .toLowerCase();
  return raw === 'webgl2'
    ? 'webgl2'
    : viewer?.xrSessionActive ||
        eye !== 'none' ||
        raw === 'hybrid' ||
        (raw !== 'webgpu' && hasVisibleNonSplatMeshes(viewer))
      ? 'hybrid'
      : 'vram-overlay';
}

const BUF_TYPES = ['uniform', 'read-only-storage', 'storage'] as const;

function makeBGL(
  device: WebGPUDeviceLike,
  visibility: number,
  types: readonly number[],
): unknown {
  return device.createBindGroupLayout({
    entries: types.map((t, binding) => ({
      binding,
      visibility,
      buffer: {type: BUF_TYPES[t]},
    })),
  });
}

function makeBG(
  device: WebGPUDeviceLike,
  layout: unknown,
  buffers: readonly WebGPUBufferLike[],
): unknown {
  return device.createBindGroup({
    layout,
    entries: buffers.map((buffer, binding) => ({binding, resource: {buffer}})),
  });
}

interface DevicePipelines {
  pB: unknown;
  sB: unknown;
  rB: unknown;
  pP: unknown[];
  sP: unknown[];
  rM: unknown;
  rL: unknown;
  rF: Map<string, unknown>;
}

const pipelineCache = new WeakMap<WebGPUDeviceLike, DevicePipelines>();

function getPipelines(device: WebGPUDeviceLike): DevicePipelines {
  let c = pipelineCache.get(device);
  if (c) return c;

  const pB = makeBGL(device, STAGE_COMPUTE, [0, 1, 1, 2, 2, 2, 2, 2]);
  const pL = device.createPipelineLayout({bindGroupLayouts: [pB]});
  const pM = device.createShaderModule({code: SPLAT_PREP_COMPUTE_WGSL});

  const sB = makeBGL(device, STAGE_COMPUTE, [0, 1, 1, 2, 2, 2, 2]);
  const sL = device.createPipelineLayout({bindGroupLayouts: [sB]});
  const sM = device.createShaderModule({code: SPLAT_SORT_COMPUTE_WGSL});

  const rB = makeBGL(device, STAGE_VERTEX, [0, 1, 1, 1]);
  const rL = device.createPipelineLayout({bindGroupLayouts: [rB]});
  const rM = device.createShaderModule({code: SPLAT_RENDER_WGSL});

  const mk = (module: unknown, layout: unknown, entryPoint: string) =>
    device.createComputePipeline({layout, compute: {module, entryPoint}});

  c = {
    pB,
    sB,
    rB,
    pP: ['kResetBounds', 'kDepthAndSH', 'kQuantizeKeys'].map((e) =>
      mk(pM, pL, e),
    ),
    sP: [
      'kRadixHistogram',
      'kScanBlocks',
      'kScanTop',
      'kAddBlockSums',
      'kRadixScatter',
    ].map((e) => mk(sM, sL, e)),
    rM,
    rL,
    rF: new Map(),
  };
  pipelineCache.set(device, c);
  return c;
}

function getRenderPipeline(
  device: WebGPUDeviceLike,
  pipes: DevicePipelines,
  format: string,
): unknown {
  let rp = pipes.rF.get(format);
  if (!rp) {
    const b = {srcFactor: 'one', dstFactor: 'one-minus-src-alpha'};
    rp = device.createRenderPipeline({
      layout: pipes.rL,
      vertex: {module: pipes.rM, entryPoint: 'vsMain'},
      fragment: {
        module: pipes.rM,
        entryPoint: 'fsMain',
        targets: [{format, blend: {color: b, alpha: b}}],
      },
      primitive: {topology: 'triangle-strip'},
    });
    pipes.rF.set(format, rp);
  }
  return rp;
}

interface HybridSlot {
  o: WebGPUBufferLike;
  c: WebGPUBufferLike | null;
  b: boolean;
  x: boolean;
}

interface HybridEye {
  s: [HybridSlot, HybridSlot];
  g: Float32Array;
  q: boolean;
  o: Uint32Array | null;
  c: Uint8Array | null;
  f: boolean;
  k: boolean;
}

interface CloudGPU {
  d: WebGPUDeviceLike;
  n: number;
  t: number;
  deg: number;
  w: number;
  aa: boolean;
  uC: ArrayBuffer;
  uB: WebGPUBufferLike;
  m: WebGPUBufferLike;
  cO: WebGPUBufferLike;
  vA: WebGPUBufferLike;
  bs: WebGPUBufferLike[];
  pB: unknown;
  sB: [unknown, unknown];
  rB: unknown;
  e: WeakMap<object, WeakMap<object, Map<string, HybridEye>>>;
  sl: HybridSlot[];
  x: boolean;
}

interface ViewerState {
  cv: HTMLCanvasElement | null;
  cx: WebGPUCanvasContextLike | null;
  d: WebGPUDeviceLike | null;
  uh: (() => void) | null;
  fm: string;
  v: boolean;
  a: boolean;
  dr: number;
  er: boolean;
}

const SIG_LEN = 37;

function writeSig(
  out: Float32Array,
  mvp: ArrayLike<number>,
  model: ArrayLike<number>,
  cam: readonly number[] | null,
  shEff: number,
): void {
  out.set(mvp, 0);
  out.set(model, 16);
  out[32] = cam ? cam[0] : 0;
  out[33] = cam ? cam[1] : 0;
  out[34] = cam ? cam[2] : 0;
  out[35] = cam ? 1 : 0;
  out[36] = shEff;
}

function sameSig(a: Float32Array, b: Float32Array): boolean {
  for (let i = 0; i < SIG_LEN; i++) if (a[i] !== b[i]) return false;
  return true;
}

const safe = (fn: () => unknown): void => {
  try {
    fn();
  } catch {}
};

function hideViewerOverlay(st: ViewerState): void {
  if (st.cv && st.v) {
    if (st.cv.style) st.cv.style.display = 'none';
    st.v = false;
  }
}

function hookSnapshot(glCv: HTMLCanvasElement, st: ViewerState): () => void {
  const anyCv = glCv as unknown as Record<string, unknown>;
  const restores: Array<() => void> = [];
  const comp = (): HTMLCanvasElement | null => {
    if (!st.v || !st.cv) return null;
    try {
      const tmp = document.createElement('canvas');
      const w = (tmp.width = st.cv.width || glCv.width || 1);
      const h = (tmp.height = st.cv.height || glCv.height || 1);
      const c2d = tmp.getContext?.('2d');
      if (!c2d) return null;
      c2d.drawImage(glCv, 0, 0, w, h);
      c2d.drawImage(st.cv, 0, 0, w, h);
      return tmp;
    } catch {
      return null;
    }
  };
  const patch = (
    k: 'toDataURL' | 'toBlob',
    wrap: (orig: (...a: unknown[]) => unknown) => unknown,
  ) => {
    const raw = anyCv[k];
    if (typeof raw !== 'function') return;
    const own = Object.prototype.hasOwnProperty.call(glCv, k);
    anyCv[k] = wrap(raw.bind(glCv));
    restores.push(() => {
      if (own) anyCv[k] = raw;
      else delete anyCv[k];
    });
  };
  patch('toDataURL', (o) => (t?: string, q?: number) => {
    const c = comp();
    return c ? c.toDataURL(t, q) : o(t, q);
  });
  patch('toBlob', (o) => (cb: BlobCallback, t?: string, q?: number) => {
    const c = comp();
    if (c && typeof c.toBlob === 'function') c.toBlob(cb, t, q);
    else o(cb, t, q);
  });
  return () => restores.forEach((r) => r());
}

function destroyCloud(c: CloudGPU): void {
  if (c.x) return;
  c.x = true;
  for (const s of c.sl) {
    s.x = true;
    safe(() => s.o.destroy());
    safe(() => s.c?.destroy());
  }
  c.sl.length = 0;
  for (const b of c.bs) safe(() => b.destroy());
}

function buildCloud(dev: WebGPUDeviceLike, data: SplatData): CloudGPU {
  const bs: WebGPUBufferLike[] = [];
  try {
    const pipes = getPipelines(dev);
    const n = data.count;
    const t = Math.max(1, Math.ceil(n / WEBGPU_RADIX_TILE_SIZE));
    const elemBytes = Math.max(4, n * 4);
    const mkBuf = (size: number, usage: number) => {
      const b = dev.createBuffer({size, usage});
      bs.push(b);
      return b;
    };

    const packedBase = packSplatBaseBuffer(data);
    const baseBuf = mkBuf(packedBase.byteLength, BUF_STORAGE | BUF_COPY_DST);
    dev.queue.writeBuffer(baseBuf, 0, packedBase);

    const packedSH = packSplatSHBuffer(data);
    const shBuf = mkBuf(packedSH.words.byteLength, BUF_STORAGE | BUF_COPY_DST);
    dev.queue.writeBuffer(shBuf, 0, packedSH.words);

    const uC = new ArrayBuffer(SPLAT_UNIFORM_BYTES);
    const uB = mkBuf(SPLAT_UNIFORM_BYTES, BUF_UNIFORM | BUF_COPY_DST);
    const mkSortU = (shift: number) => {
      const b = mkBuf(SORT_UNIFORM_BYTES, BUF_UNIFORM | BUF_COPY_DST);
      dev.queue.writeBuffer(b, 0, new Uint32Array([n, t, shift, 0]));
      return b;
    };
    const sU0 = mkSortU(0);
    const sU1 = mkSortU(8);
    const m = mkBuf(
      CLOUD_META_BYTES,
      BUF_STORAGE | BUF_INDIRECT | BUF_COPY_DST,
    );
    const cO = mkBuf(elemBytes, BUF_STORAGE | BUF_COPY_SRC);
    const keysA = mkBuf(elemBytes, BUF_STORAGE);
    const vA = mkBuf(elemBytes, BUF_STORAGE | BUF_COPY_SRC);
    const keysB = mkBuf(elemBytes, BUF_STORAGE);
    const valsB = mkBuf(elemBytes, BUF_STORAGE);
    const hist = mkBuf(Math.max(4, 256 * t * 4), BUF_STORAGE);
    const bSums = mkBuf(Math.max(4, t * 4), BUF_STORAGE);

    return {
      d: dev,
      n,
      t,
      deg: packedSH.shDegree,
      w: packedSH.wordsPerSplat,
      aa: Boolean(data.antialiased),
      uC,
      uB,
      m,
      cO,
      vA,
      bs,
      pB: makeBG(dev, pipes.pB, [uB, baseBuf, shBuf, keysB, m, cO, keysA, vA]),
      sB: [
        makeBG(dev, pipes.sB, [sU0, keysA, vA, keysB, valsB, hist, bSums]),
        makeBG(dev, pipes.sB, [sU1, keysB, valsB, keysA, vA, hist, bSums]),
      ],
      rB: makeBG(dev, pipes.rB, [uB, baseBuf, vA, cO]),
      e: new WeakMap(),
      sl: [],
      x: false,
    };
  } catch (err) {
    for (const b of bs) safe(() => b.destroy());
    throw err;
  }
}

function encodeCompute(
  enc: WebGPUCommandEncoderLike,
  pipes: DevicePipelines,
  c: CloudGPU,
): void {
  const wg = Math.max(1, Math.ceil(c.n / WEBGPU_WORKGROUP_SIZE));
  const t = c.t;
  const pass = enc.beginComputePass();
  pass.setBindGroup(0, c.pB);
  const prepCounts = [1, wg, wg];
  for (let i = 0; i < 3; i++) {
    pass.setPipeline(pipes.pP[i]);
    pass.dispatchWorkgroups(prepCounts[i]);
  }
  const sortCounts = [t, t, 1, t, t];
  for (const bg of c.sB) {
    pass.setBindGroup(0, bg);
    for (let i = 0; i < 5; i++) {
      pass.setPipeline(pipes.sP[i]);
      pass.dispatchWorkgroups(sortCounts[i]);
    }
  }
  pass.end();
}

function ensureOverlay(
  viewer: SplatViewerLike,
  st: ViewerState,
  dev: WebGPUDeviceLike,
  width: number,
  height: number,
): WebGPUCanvasContextLike | null {
  if (st.er) return null;
  if (!st.cv || !st.cx) {
    if (typeof document === 'undefined' || !document.createElement) {
      st.er = true;
      return null;
    }
    const glCanvas = (viewer.gl as {canvas?: HTMLCanvasElement | null} | undefined)
      ?.canvas;
    const parent: HTMLElement | null =
      (glCanvas?.parentElement as HTMLElement | null) ??
      (viewer.container?.appendChild ? (viewer.container as HTMLElement) : null);
    if (!parent) {
      st.er = true;
      return null;
    }
    const cv = document.createElement('canvas');
    cv.className = 'three-live-webgpu-layer';
    cv.setAttribute?.('aria-hidden', 'true');
    if (cv.style) {
      cv.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:1';
    }
    const ctx =
      (
        cv as unknown as {getContext?(id: string): WebGPUCanvasContextLike | null}
      ).getContext?.('webgpu') ?? null;
    if (!ctx) {
      st.er = true;
      return null;
    }
    if (
      parent.style &&
      globalThis.getComputedStyle?.(parent).position === 'static'
    ) {
      parent.style.position = 'relative';
    }
    if (glCanvas?.parentElement === parent && parent.insertBefore) {
      parent.insertBefore(cv, glCanvas.nextSibling);
    } else {
      parent.appendChild(cv);
    }
    st.cv = cv;
    st.cx = ctx;
    st.v = true;
    if (glCanvas) st.uh = hookSnapshot(glCanvas, st);
  }
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  if (st.cv.width !== w) st.cv.width = w;
  if (st.cv.height !== h) st.cv.height = h;
  if (!st.v) {
    if (st.cv.style) st.cv.style.display = 'block';
    st.v = true;
  }
  if (st.d !== dev || st.fm !== preferredCanvasFormat) {
    try {
      st.cx.configure({
        device: dev,
        format: preferredCanvasFormat,
        alphaMode: 'premultiplied',
      });
      st.d = dev;
      st.fm = preferredCanvasFormat;
    } catch {
      st.er = true;
      hideViewerOverlay(st);
      return null;
    }
  }
  return st.cx;
}

function getHybridEye(
  c: CloudGPU,
  viewer: object,
  owner: object,
  eye: string,
): HybridEye | null {
  let byMesh = c.e.get(viewer);
  if (!byMesh) c.e.set(viewer, (byMesh = new WeakMap()));
  let byEye = byMesh.get(owner);
  if (!byEye) byMesh.set(owner, (byEye = new Map()));
  let e = byEye.get(eye);
  if (!e) {
    const size = Math.max(4, c.n * 4);
    let s0: HybridSlot | null = null;
    try {
      const mk = (): HybridSlot => {
        const s: HybridSlot = {
          o: c.d.createBuffer({size, usage: BUF_MAP_READ | BUF_COPY_DST}),
          c: null,
          b: false,
          x: false,
        };
        c.sl.push(s);
        return s;
      };
      s0 = mk();
      e = {
        s: [s0, mk()],
        g: new Float32Array(SIG_LEN).fill(NaN),
        q: false,
        o: null,
        c: null,
        f: false,
        k: false,
      };
      byEye.set(eye, e);
    } catch {
      if (s0) {
        s0.x = true;
        safe(() => s0!.o.destroy());
      }
      return null;
    }
  }
  return e;
}

/** WebGPU Gaussian Splatting compute & render accelerator. */
export class WebGPUSplatAccelerator implements SplatGPUAccelerator {
  declare beginFrame: (viewer: object) => void;
  declare endFrame: (viewer: object) => void;
  declare hideOverlay: (viewer: object) => void;
  declare drawCloud: (
    params: SplatGPUDrawParams,
  ) => 'rendered' | SplatGPUFrameOutput | null;
  declare disposeCloud: (data: unknown) => void;
  declare disposeViewer: (viewer: object) => void;
  declare onDeviceLost: (lostDevice: WebGPUDeviceLike) => void;

  constructor() {
    const clouds = new WeakMap<object, CloudGPU>();
    const cloudSet = new Set<CloudGPU>();
    let bad = new WeakSet<object>();
    const viewers = new WeakMap<object, ViewerState>();
    const viewerSet = new Set<ViewerState>();
    const sig = new Float32Array(SIG_LEN);

    const getState = (viewer: object): ViewerState => {
      let st = viewers.get(viewer);
      if (!st) {
        st = {
          cv: null,
          cx: null,
          d: null,
          uh: null,
          fm: '',
          v: false,
          a: false,
          dr: 0,
          er: false,
        };
        viewers.set(viewer, st);
        viewerSet.add(st);
      }
      return st;
    };

    this.beginFrame = (viewer: object): void => {
      const st = getState(viewer);
      const v = viewer as SplatViewerLike;
      if (Array.isArray(v.meshes) && v.meshes.length === 0) {
        hideViewerOverlay(st);
      }
      if (!st.a) {
        st.a = true;
        st.dr = 0;
      }
    };

    this.endFrame = (viewer: object): void => {
      const st = viewers.get(viewer);
      if (!st) return;
      if (st.dr === 0) hideViewerOverlay(st);
      st.a = false;
      st.dr = 0;
    };

    this.hideOverlay = (viewer: object): void => {
      const st = viewers.get(viewer);
      if (st) {
        st.dr = 0;
        this.endFrame(viewer);
      }
    };

    this.drawCloud = (
      params: SplatGPUDrawParams,
    ): 'rendered' | SplatGPUFrameOutput | null => {
      const viewer = params.viewer as SplatViewerLike;
      const data = params.data as SplatData | null;
      if (!viewer || !data || data.count <= 0 || bad.has(data)) return null;

      let mode = resolveSplatRenderMode(viewer, params.eye);
      if (mode === 'webgl2') return null;
      if (params.standalone) {
        if (viewer.xrSessionActive || params.eye !== 'none') return null;
        mode = 'vram-overlay';
      }

      const dev = peekOrRequestWebGPUDevice();
      if (!dev) return null;

      const st = getState(viewer);
      let cloud = clouds.get(data);
      if (!cloud || cloud.d !== dev || cloud.x) {
        if (cloud) {
          cloudSet.delete(cloud);
          destroyCloud(cloud);
        }
        try {
          cloud = buildCloud(dev, data);
        } catch {
          bad.add(data);
          return null;
        }
        clouds.set(data, cloud);
        cloudSet.add(cloud);
      }
      const cRef = cloud;
      const pipes = getPipelines(dev);
      const shEff =
        params.highQualitySH && params.cameraPos && cRef.deg > 0 ? cRef.deg : 0;

      let overlayCtx: WebGPUCanvasContextLike | null = null;
      if (mode === 'vram-overlay') {
        overlayCtx = ensureOverlay(
          viewer,
          st,
          dev,
          params.viewportWidth,
          params.viewportHeight,
        );
        if (!overlayCtx) {
          if (params.standalone) return null;
          mode = 'hybrid';
        }
      }

      const writeU = () => {
        writeSplatUniforms(cRef.uC, {
          ...params,
          splatCount: cRef.n,
          shDegreeEffective: shEff,
          shWordsPerSplat: cRef.w,
          antialiased: cRef.aa,
        });
        dev.queue.writeBuffer(cRef.uB, 0, cRef.uC);
      };

      if (mode === 'vram-overlay' && overlayCtx) {
        try {
          writeU();
          const enc = dev.createCommandEncoder();
          encodeCompute(enc, pipes, cRef);
          const rp = enc.beginRenderPass({
            colorAttachments: [
              {
                view: overlayCtx.getCurrentTexture().createView(),
                loadOp: st.dr === 0 ? 'clear' : 'load',
                storeOp: 'store',
              },
            ],
          });
          rp.setPipeline(getRenderPipeline(dev, pipes, preferredCanvasFormat));
          rp.setBindGroup(0, cRef.rB);
          rp.drawIndirect(cRef.m, CLOUD_INDIRECT_OFFSET_BYTES);
          rp.end();
          dev.queue.submit([enc.finish()]);
          st.dr++;
          return 'rendered';
        } catch {
          hideViewerOverlay(st);
          if (params.standalone) return null;
          mode = 'hybrid';
        }
      }

      const owner = (params.mesh && typeof params.mesh === 'object'
        ? params.mesh
        : viewer) as object;
      const eye = getHybridEye(cRef, viewer, owner, params.eye);
      if (!eye) return null;
      let outOrder: Uint32Array | null = null;
      let outColors: Uint8Array | null = null;
      if (eye.f) {
        outOrder = eye.o;
        outColors = params.highQualitySH ? eye.c : null;
        eye.f = false;
        eye.k = true;
      }

      writeSig(sig, params.mvp, params.model, params.cameraPos, shEff);
      if (!eye.q || !sameSig(sig, eye.g)) {
        const slot = eye.s.find((s) => !s.b && !s.x);
        if (slot) {
          try {
            writeU();
            const bytes = cRef.n * 4;
            const needCols = shEff > 0;
            if (needCols && !slot.c) {
              slot.c = dev.createBuffer({
                size: Math.max(4, bytes),
                usage: BUF_MAP_READ | BUF_COPY_DST,
              });
            }
            const enc = dev.createCommandEncoder();
            encodeCompute(enc, pipes, cRef);
            enc.copyBufferToBuffer(cRef.vA, 0, slot.o, 0, bytes);
            if (needCols && slot.c) {
              enc.copyBufferToBuffer(cRef.cO, 0, slot.c, 0, bytes);
            }
            dev.queue.submit([enc.finish()]);

            slot.b = true;
            eye.g.set(sig);
            eye.q = true;
            const cBuf = needCols ? slot.c : null;
            Promise.all([
              slot.o.mapAsync(MAP_READ, 0, bytes),
              cBuf ? cBuf.mapAsync(MAP_READ, 0, bytes) : Promise.resolve(),
            ])
              .then(() => {
                if (slot.x || cRef.x) return;
                const dstO =
                  eye.o?.length === cRef.n ? eye.o : new Uint32Array(cRef.n);
                dstO.set(new Uint32Array(slot.o.getMappedRange(0, bytes)));
                slot.o.unmap();
                eye.o = dstO;
                if (cBuf) {
                  const dstC =
                    eye.c?.length === bytes ? eye.c : new Uint8Array(bytes);
                  dstC.set(new Uint8Array(cBuf.getMappedRange(0, bytes)));
                  cBuf.unmap();
                  eye.c = dstC;
                }
                slot.b = false;
                eye.f = true;
              })
              .catch(() => {
                safe(() => slot.o.unmap());
                safe(() => cBuf?.unmap());
                slot.b = false;
                eye.q = false;
              });
          } catch {
            slot.b = false;
            eye.q = false;
          }
        }
      }

      if (!outOrder && !outColors && !eye.k) return null;
      return {
        order: outOrder,
        colors: outColors,
        shHandled: eye.k && cRef.deg > 0,
      };
    };

    this.disposeCloud = (data: unknown): void => {
      if (!data || typeof data !== 'object') return;
      bad.delete(data);
      const res = clouds.get(data);
      if (res) {
        clouds.delete(data);
        cloudSet.delete(res);
        destroyCloud(res);
      }
    };

    this.disposeViewer = (viewer: object): void => {
      const st = viewers.get(viewer);
      if (!st) return;
      viewers.delete(viewer);
      viewerSet.delete(st);
      safe(() => st.uh?.());
      safe(() => st.cx?.unconfigure?.());
      safe(() => st.cv?.remove?.());
      st.uh = st.cv = st.cx = st.d = null;
      st.v = false;
    };

    this.onDeviceLost = (lostDevice: WebGPUDeviceLike): void => {
      bad = new WeakSet();
      for (const c of [...cloudSet]) {
        if (c.d === lostDevice) {
          cloudSet.delete(c);
          destroyCloud(c);
        }
      }
      for (const st of viewerSet) {
        if (st.d === lostDevice) {
          st.d = null;
          st.er = false;
          hideViewerOverlay(st);
        }
      }
    };
  }
}

let sharedAccelerator: WebGPUSplatAccelerator | null = null;

/** Returns (creating on first use) the singleton `WebGPUSplatAccelerator`. */
export function getWebGPUSplatAccelerator(): WebGPUSplatAccelerator {
  return (sharedAccelerator ??= new WebGPUSplatAccelerator());
}

interface StandaloneEntry {
  url: string;
  data: SplatData | null;
}

/**
 * Lightweight standalone `.splat` / `.spz` loader used when `xr-live-webgpu` is
 * loaded without `xr-live-spatial`.
 */
export class StandaloneWebGPUSplatLoader {
  declare sync: (viewer: SplatViewerLike) => void;
  declare draw: (
    viewer: SplatViewerLike,
    vp: Float32Array,
    eye?: 'left' | 'right' | 'none',
    viewport?: readonly number[],
    projection?: Float32Array,
  ) => void;
  declare dispose: () => void;

  constructor(fetchFn?: typeof fetch) {
    const doFetch: typeof fetch = fetchFn ?? ((u, i) => fetch(u, i));
    const entries = new Map<object, StandaloneEntry>();

    this.sync = (viewer: SplatViewerLike): void => {
      const meshes = viewer.meshes ?? [];
      const live = new Set<object>();
      const allowRemote = Boolean(
        viewer.container?.hasAttribute?.('allow-remote-splats'),
      );
      const accel = getWebGPUSplatAccelerator();
      for (const mesh of meshes) {
        const raw = xrOf(mesh)?.splatUrl;
        if (!raw) continue;
        const url = resolveSplatUrl(raw, undefined, allowRemote);
        if (!url || !mesh?.transform) continue;
        live.add(mesh);
        const existing = entries.get(mesh);
        if (existing?.url === url) continue;
        if (existing?.data) accel.disposeCloud(existing.data);
        const entry: StandaloneEntry = {url, data: null};
        entries.set(mesh, entry);
        loadSplat(url, doFetch, allowRemote).then(
          (data) => {
            if (entries.get(mesh) === entry) entry.data = data;
          },
          () => {},
        );
      }
      for (const [mesh, entry] of [...entries]) {
        if (live.has(mesh)) continue;
        if (entry.data) accel.disposeCloud(entry.data);
        entries.delete(mesh);
      }
    };

    this.draw = (
      viewer: SplatViewerLike,
      vp: Float32Array,
      eye: 'left' | 'right' | 'none' = 'none',
      viewport?: readonly number[],
      projection?: Float32Array,
    ): void => {
      const gl = viewer.gl;
      const accel = getWebGPUSplatAccelerator();
      accel.beginFrame(viewer);
      if (!gl || entries.size === 0) {
        accel.endFrame(viewer);
        return;
      }
      const widthPx = viewport?.[2] ?? gl.drawingBufferWidth;
      const heightPx = viewport?.[3] ?? gl.drawingBufferHeight;
      const proj = projection ?? viewer.projMatrix;
      const focalY = (Math.abs(proj?.[5] ?? 1.7) * heightPx) / 2;
      const focalX = proj?.[0] ? (Math.abs(proj[0]) * widthPx) / 2 : focalY;
      const model = new Float32Array(16);
      const mvp = new Float32Array(16);
      const view = viewer.activeViewMatrix ?? viewer.viewMatrix;
      const modelView = view ? new Float32Array(16) : null;
      const cameraPos = standaloneEyes.get(viewer) ?? null;
      try {
        for (const [mesh, entry] of entries) {
          if (
            !entry.data ||
            entry.data.count === 0 ||
            (mesh as {visible?: boolean}).visible === false
          ) {
            continue;
          }
          const transform = (mesh as {transform: Float32Array}).transform;
          if (viewer.modelRootMatrix) {
            mat4Multiply(model, viewer.modelRootMatrix, transform);
          } else {
            model.set(transform);
          }
          if (modelView && view) mat4Multiply(modelView, view, model);
          mat4Multiply(mvp, vp, model);
          accel.drawCloud({
            viewer,
            mesh,
            data: entry.data,
            vp,
            mvp,
            model,
            modelView,
            cameraPos,
            focalX,
            focalY,
            viewportWidth: widthPx,
            viewportHeight: heightPx,
            highQualitySH:
              xrOf(mesh)?.splatQuality === 'high' ||
              viewer.container?.getAttribute?.('splat-quality') === 'high',
            eye,
            standalone: true,
          });
        }
      } finally {
        accel.endFrame(viewer);
      }
    };

    this.dispose = (): void => {
      const accel = getWebGPUSplatAccelerator();
      for (const e of entries.values()) {
        if (e.data) accel.disposeCloud(e.data);
      }
      entries.clear();
    };
  }
}

const standaloneLoaders = new WeakMap<object, StandaloneWebGPUSplatLoader>();
const standaloneEyes = new WeakMap<object, [number, number, number]>();

function hasSpatialSplatPlugin(): boolean {
  return getRegisteredPlugins().some((p) => p.name === 'xr-live-splat-loader');
}

function dropStandaloneIfSpatialPresent(viewer: object): boolean {
  if (!hasSpatialSplatPlugin()) return false;
  const existing = standaloneLoaders.get(viewer);
  if (existing) {
    existing.dispose();
    standaloneLoaders.delete(viewer);
  }
  return true;
}

function syncStandalone(viewer: unknown): void {
  const v = viewer as SplatViewerLike;
  if (!v || dropStandaloneIfSpatialPresent(v) || !Array.isArray(v.meshes)) {
    return;
  }
  let l = standaloneLoaders.get(v);
  if (!l) {
    l = new StandaloneWebGPUSplatLoader();
    standaloneLoaders.set(v, l);
  }
  l.sync(v);
}

/** `ThreeLivePlugin` registered by `xr-live-webgpu.min.js`. */
export const webgpuSplatPlugin: ThreeLivePlugin = {
  name: 'xr-live-webgpu-splat',
  onRegister(): void {
    getSharedRegistry().splatAccelerator = getWebGPUSplatAccelerator();
    if (getNavigatorGPU()) void acquireWebGPUDevice();
  },
  onElementDisconnected(element: {viewer?: object | null}): void {
    if (element?.viewer) getWebGPUSplatAccelerator().disposeViewer(element.viewer);
  },
  onClearScene(viewer: SplatViewerLike): void {
    if (viewer) {
      getWebGPUSplatAccelerator().hideOverlay(viewer);
      standaloneLoaders.get(viewer)?.sync(viewer);
    }
  },
  onUpdate: syncStandalone,
  onXRFrame: syncStandalone,
  onBeforeDrawScene(
    viewer: SplatViewerLike,
    _gl: WebGL2RenderingContext,
    _vp: Float32Array,
    cameraPos: [number, number, number],
  ): void {
    if (!viewer) return;
    getWebGPUSplatAccelerator().beginFrame(viewer);
    if (!hasSpatialSplatPlugin() && cameraPos) {
      standaloneEyes.set(viewer, [cameraPos[0], cameraPos[1], cameraPos[2]]);
    }
  },
  onAfterRender(
    _gl: WebGL2RenderingContext,
    viewer: SplatViewerLike,
    vpMatrix: Float32Array,
    eye?: 'left' | 'right' | 'none',
    viewport?: readonly number[],
    projection?: Float32Array,
  ): void {
    if (!viewer || dropStandaloneIfSpatialPresent(viewer)) return;
    const loader = standaloneLoaders.get(viewer);
    if (loader) {
      loader.draw(viewer, vpMatrix, eye, viewport, projection);
    } else {
      getWebGPUSplatAccelerator().hideOverlay(viewer);
    }
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: SplatViewerLike): void {
    standaloneLoaders.get(viewer)?.dispose();
    standaloneLoaders.delete(viewer);
    if (viewer) getWebGPUSplatAccelerator().disposeViewer(viewer);
  },
};
