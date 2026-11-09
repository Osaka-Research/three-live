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

import {strict as assert} from 'node:assert';
import {mat4Create, mat4Multiply} from '../../three-live/src/math';
import {
  getSharedRegistry,
  registeredPlugins,
  registerPlugin,
} from '../../three-live/src/plugin';
import {
  computeSplatCovariance3D,
  computeSplatViewColors,
  setSplatViewerEye,
  shBasisCountForDegree,
  sortSplatsByDepth,
  type SplatData,
  splatLoaderPlugin,
  XRSplatLoader,
} from '../src/plugins/splat-loader';
import {
  acquireWebGPUDevice,
  getWebGPUSplatAccelerator,
  resolveSplatRenderMode,
  type WebGPUBufferLike,
  type WebGPUCanvasContextLike,
  type WebGPUDeviceLike,
  WebGPUSplatAccelerator,
  webgpuSplatPlugin,
} from '../src/webgpu';
import {
  CLOUD_INDIRECT_OFFSET_BYTES,
  float32ToFloat16Bits,
  packSplatBaseBuffer,
  packSplatSHBuffer,
  SPLAT_BASE_STRIDE_BYTES,
  SPLAT_PREP_COMPUTE_WGSL,
  SPLAT_RENDER_WGSL,
  SPLAT_SORT_COMPUTE_WGSL,
  SPLAT_UNIFORM_BYTES,
  shWordsPerSplatForDegree,
  writeSplatUniforms,
} from '../src/webgpu/shaders';
import {
  float16BitsToFloat32,
  floatBitsToSortableUint,
  simulateWebGPUSplatSort,
  sortableUintToFloat,
} from '../src/webgpu/sim-ref';
import {
  hasVisibleNonSplatMeshes,
  resetWebGPUDevice,
  setWebGPUDeviceForTests,
  StandaloneWebGPUSplatLoader,
} from '../src/webgpu/splat-accelerator';

function seededRng(seed = 0x12345678): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function makeCloud(
  count: number,
  shDegree: 0 | 1 | 2 | 3 = 0,
  seed = 42,
): SplatData {
  const rng = seededRng(seed);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const rotations = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (rng() - 0.5) * 20;
    positions[i * 3 + 1] = (rng() - 0.5) * 20;
    positions[i * 3 + 2] = -1 - rng() * 30;
    scales[i * 3] = 0.02 + rng() * 0.3;
    scales[i * 3 + 1] = 0.02 + rng() * 0.3;
    scales[i * 3 + 2] = 0.02 + rng() * 0.3;
    colors[i * 4] = Math.floor(rng() * 256);
    colors[i * 4 + 1] = Math.floor(rng() * 256);
    colors[i * 4 + 2] = Math.floor(rng() * 256);
    colors[i * 4 + 3] = 64 + Math.floor(rng() * 191);
    let qx = rng() * 2 - 1;
    let qy = rng() * 2 - 1;
    let qz = rng() * 2 - 1;
    let qw = rng() * 2 - 1;
    const len = Math.hypot(qx, qy, qz, qw) || 1;
    qx /= len;
    qy /= len;
    qz /= len;
    qw /= len;
    rotations.set([qx, qy, qz, qw], i * 4);
  }
  const basis = shBasisCountForDegree(shDegree);
  const sh = basis > 0 ? new Float32Array(count * basis * 3) : null;
  if (sh) {
    for (let j = 0; j < sh.length; j++) {
      sh[j] = (rng() * 2 - 1) * 0.35;
    }
  }
  return {count, positions, scales, colors, rotations, shDegree, sh};
}

function perspectiveVP(camZ = 5): Float32Array {
  // Simple perspective projection * translation(0, 0, -camZ)
  const near = 0.1;
  const far = 100;
  const f = 1.7320508;
  const nf = 1 / (near - far);
  const proj = new Float32Array([
    f, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
  const view = mat4Create();
  view[14] = -camZ;
  const vp = mat4Create();
  mat4Multiply(vp, proj, view);
  return vp;
}

/** Evaluates the exact WGSL fp16 SH formula in JS to verify precision parity. */
function evaluateWGSLFp16SHColors(
  baseBuf: ArrayBuffer,
  shWords: Uint32Array,
  uniformBuf: ArrayBuffer,
): Uint8Array {
  const uf = new Float32Array(uniformBuf, 0, 76);
  const uu = new Uint32Array(uniformBuf, 0, 76);
  const n = uu[68];
  const deg = uu[70];
  const wordsPerSplat = uu[71];
  const bf = new Float32Array(baseBuf);
  const bu = new Uint32Array(baseBuf);
  const out = new Uint8Array(n * 4);
  const outU32 = new Uint32Array(out.buffer);

  const rsh = (bw: number, f: number): number => {
    const w = shWords[bw + (f >>> 1)] ?? 0;
    return float16BitsToFloat32((f & 1) === 0 ? w & 0xffff : w >>> 16);
  };
  const rsh3 = (bw: number, bi: number): [number, number, number] => {
    const f = bi * 3;
    return [rsh(bw, f), rsh(bw, f + 1), rsh(bw, f + 2)];
  };

  for (let i = 0; i < n; i++) {
    const rgba = bu[i * 12 + 10];
    if (deg === 0) {
      outU32[i] = rgba;
      continue;
    }
    const px = bf[i * 12];
    const py = bf[i * 12 + 1];
    const pz = bf[i * 12 + 2];
    const wpx =
      uf[32] * px + uf[36] * py + uf[40] * pz + uf[44] - uf[60];
    const wpy =
      uf[33] * px + uf[37] * py + uf[41] * pz + uf[45] - uf[61];
    const wpz =
      uf[34] * px + uf[38] * py + uf[42] * pz + uf[46] - uf[62];
    let lx = uf[48] * wpx + uf[49] * wpy + uf[50] * wpz;
    let ly = uf[52] * wpx + uf[53] * wpy + uf[54] * wpz;
    let lz = uf[56] * wpx + uf[57] * wpy + uf[58] * wpz;
    const dl = Math.hypot(lx, ly, lz);
    if (dl > 0) {
      lx /= dl;
      ly /= dl;
      lz /= dl;
    }
    const bw = i * wordsPerSplat;
    let r = (rgba & 0xff) / 255;
    let g = ((rgba >>> 8) & 0xff) / 255;
    let b = ((rgba >>> 16) & 0xff) / 255;
    const add = (c: [number, number, number], w: number) => {
      r += w * c[0];
      g += w * c[1];
      b += w * c[2];
    };
    add(rsh3(bw, 0), -0.48860251 * ly);
    add(rsh3(bw, 1), 0.48860251 * lz);
    add(rsh3(bw, 2), -0.48860251 * lx);
    if (deg >= 2) {
      const xx = lx * lx;
      const yy = ly * ly;
      const zz = lz * lz;
      const xy = lx * ly;
      const yz = ly * lz;
      const xz = lx * lz;
      add(rsh3(bw, 3), 1.0925484 * xy);
      add(rsh3(bw, 4), -1.0925484 * yz);
      add(rsh3(bw, 5), 0.31539157 * (2 * zz - xx - yy));
      add(rsh3(bw, 6), -1.0925484 * xz);
      add(rsh3(bw, 7), 0.5462742 * (xx - yy));
      if (deg >= 3) {
        add(rsh3(bw, 8), -0.5900436 * ly * (3 * xx - yy));
        add(rsh3(bw, 9), 2.8906114 * xy * lz);
        add(rsh3(bw, 10), -0.4570458 * ly * (4 * zz - xx - yy));
        add(rsh3(bw, 11), 0.37317633 * lz * (2 * zz - 3 * xx - 3 * yy));
        add(rsh3(bw, 12), -0.4570458 * lx * (4 * zz - xx - yy));
        add(rsh3(bw, 13), 1.4453057 * lz * (xx - yy));
        add(rsh3(bw, 14), -0.5900436 * lx * (xx - 3 * yy));
      }
    }
    out[i * 4] = Math.round(Math.max(0, Math.min(1, r)) * 255);
    out[i * 4 + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
    out[i * 4 + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
    out[i * 4 + 3] = (rgba >>> 24) & 0xff;
  }
  return out;
}

interface MockBuffer extends WebGPUBufferLike {
  bytes: Uint8Array;
  usage: number;
  destroyed: boolean;
  mapped: boolean;
}

function createMockWebGPUDevice(opts?: {autoResolveMaps?: boolean}) {
  const autoResolve = opts?.autoResolveMaps ?? true;
  const buffers: MockBuffer[] = [];
  const pendingMaps: Array<() => void> = [];
  const bindGroupLayouts: Array<{
    entries: Array<{
      binding: number;
      visibility: number;
      buffer: {type: string};
    }>;
  }> = [];
  const computePipelines: string[] = [];
  const renderPasses: Array<{
    loadOp: string;
    indirectOffset: number;
    indirectArgs: number[];
  }> = [];
  let computeSubmissions = 0;
  let lostResolver: ((info: unknown) => void) | null = null;
  const lost = new Promise<unknown>((resolve) => {
    lostResolver = resolve;
  });

  const device: WebGPUDeviceLike = {
    lost,
    queue: {
      writeBuffer(
        buffer: WebGPUBufferLike,
        bufferOffset: number,
        data: ArrayBufferView | ArrayBuffer,
      ) {
        const dst = (buffer as MockBuffer).bytes;
        const src =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        dst.set(src, bufferOffset);
      },
      submit(commandBuffers: unknown[]) {
        for (const cb of commandBuffers as Array<() => void>) cb();
      },
    },
    createBuffer(desc) {
      const b: MockBuffer = {
        bytes: new Uint8Array(Math.max(4, desc.size)),
        usage: desc.usage,
        destroyed: false,
        mapped: Boolean(desc.mappedAtCreation),
        getMappedRange(offset = 0, size = b.bytes.byteLength - offset) {
          assert.equal(b.mapped, true, 'getMappedRange requires mapped buffer');
          return b.bytes.buffer.slice(offset, offset + size) as ArrayBuffer;
        },
        mapAsync() {
          return new Promise<void>((resolve, reject) => {
            const finish = () => {
              if (b.destroyed) {
                reject(new Error('Buffer destroyed before mapAsync resolved'));
                return;
              }
              b.mapped = true;
              resolve();
            };
            if (autoResolve) queueMicrotask(finish);
            else pendingMaps.push(finish);
          });
        },
        unmap() {
          b.mapped = false;
        },
        destroy() {
          b.destroyed = true;
          b.mapped = false;
        },
      };
      buffers.push(b);
      return b;
    },
    createShaderModule(desc) {
      assert.ok(desc.code.length > 100);
      return desc;
    },
    createBindGroupLayout(desc) {
      const typed = desc as (typeof bindGroupLayouts)[number];
      // Enforce WebGPU baseline limit: <= 8 storage buffers per stage!
      const storageCount = typed.entries.filter(
        (e) =>
          e.buffer.type === 'storage' || e.buffer.type === 'read-only-storage',
      ).length;
      assert.ok(
        storageCount <= 8,
        `BindGroupLayout exceeds 8 storage buffers (${storageCount})`,
      );
      bindGroupLayouts.push(typed);
      return typed;
    },
    createPipelineLayout(desc) {
      return desc;
    },
    createComputePipeline(desc) {
      const ep = (desc as {compute: {entryPoint: string}}).compute.entryPoint;
      computePipelines.push(ep);
      return {entryPoint: ep};
    },
    createRenderPipeline(desc) {
      return desc;
    },
    createBindGroup(desc) {
      return desc;
    },
    createCommandEncoder() {
      const ops: Array<() => void> = [];
      return {
        beginComputePass() {
          let activePrepBG: {
            entries: Array<{binding: number; resource: {buffer: MockBuffer}}>;
          } | null = null;
          const dispatched: string[] = [];
          return {
            setPipeline(p: unknown) {
              dispatched.push((p as {entryPoint: string}).entryPoint);
            },
            setBindGroup(_idx: number, bg: unknown) {
              const typed = bg as {
                entries: Array<{binding: number; resource: {buffer: MockBuffer}}>;
              };
              if (typed.entries.length === 8) activePrepBG = typed;
            },
            dispatchWorkgroups(x: number) {
              assert.ok(x >= 1);
            },
            end() {
              ops.push(() => {
                computeSubmissions++;
                assert.equal(dispatched.length, 13);
                if (!activePrepBG) return;
                const getB = (i: number) => activePrepBG!.entries[i].resource.buffer;
                const uBuf = getB(0).bytes.buffer as ArrayBuffer;
                const baseBuf = getB(1).bytes.buffer as ArrayBuffer;
                const shWords = new Uint32Array(getB(2).bytes.buffer);
                const metaU32 = new Uint32Array(getB(4).bytes.buffer);
                const colOut = getB(5).bytes;
                const valsA = getB(7).bytes;

                const uu = new Uint32Array(uBuf, 0, 76);
                const uf = new Float32Array(uBuf, 0, 76);
                const n = uu[68];
                // Extract positions from packed 48B SplatBase buffer
                const bf = new Float32Array(baseBuf);
                const pos = new Float32Array(n * 3);
                for (let i = 0; i < n; i++) {
                  pos[i * 3] = bf[i * 12];
                  pos[i * 3 + 1] = bf[i * 12 + 1];
                  pos[i * 3 + 2] = bf[i * 12 + 2];
                }
                const sorted = simulateWebGPUSplatSort(
                  {count: n, positions: pos},
                  uf.subarray(0, 16),
                );
                new Uint32Array(valsA.buffer, 0, n).set(sorted);
                const shColors = evaluateWGSLFp16SHColors(
                  baseBuf,
                  shWords,
                  uBuf,
                );
                colOut.set(shColors.subarray(0, n * 4));
                // Write drawIndirect args [4, n, 0, 0] at byte offset 8 (u32 index 2)
                metaU32[2] = 4;
                metaU32[3] = n;
                metaU32[4] = 0;
                metaU32[5] = 0;
              });
            },
          };
        },
        beginRenderPass(desc: unknown) {
          const d = desc as {colorAttachments: Array<{loadOp: string}>};
          const loadOp = d.colorAttachments[0].loadOp;
          let indirectBuf: MockBuffer | null = null;
          let indirectOffset = 0;
          return {
            setPipeline() {},
            setBindGroup() {},
            draw() {},
            drawIndirect(buf: WebGPUBufferLike, offset: number) {
              indirectBuf = buf as MockBuffer;
              indirectOffset = offset;
            },
            end() {
              ops.push(() => {
                const args = indirectBuf
                  ? Array.from(
                      new Uint32Array(
                        indirectBuf.bytes.buffer,
                        indirectOffset,
                        4,
                      ),
                    )
                  : [];
                renderPasses.push({
                  loadOp,
                  indirectOffset,
                  indirectArgs: args,
                });
              });
            },
          };
        },
        copyBufferToBuffer(src, srcOff, dst, dstOff, size) {
          ops.push(() => {
            const s = (src as MockBuffer).bytes.subarray(srcOff, srcOff + size);
            (dst as MockBuffer).bytes.set(s, dstOff);
          });
        },
        finish() {
          return () => {
            for (const op of ops) op();
          };
        },
      };
    },
  };

  return {
    device,
    buffers,
    bindGroupLayouts,
    computePipelines,
    renderPasses,
    get computeSubmissions() {
      return computeSubmissions;
    },
    flushMaps() {
      while (pendingMaps.length > 0) pendingMaps.shift()!();
    },
    triggerDeviceLost() {
      lostResolver?.({reason: 'destroyed'});
    },
  };
}

function mockGL(withCanvasParent = true) {
  type GLBuf = {order: Uint32Array | null};
  type VAO = {element: GLBuf | null};
  let vao: VAO | null = null;
  const uploads: number[][] = [];
  const colorUploads: number[][] = [];
  const draws: number[][] = [];
  let createdPrograms = 0;

  const children: unknown[] = [];
  const glCanvas = {
    tagName: 'CANVAS',
    parentElement: null as unknown,
    get nextSibling(): unknown {
      const idx = children.indexOf(glCanvas);
      return idx >= 0 && idx + 1 < children.length ? children[idx + 1] : null;
    },
  };
  const attrs = new Map<string, string>();
  const parent = {
    style: {position: 'relative'},
    children,
    getAttribute: (k: string) => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    hasAttribute: (k: string) => attrs.has(k),
    removeAttribute: (k: string) => attrs.delete(k),
    appendChild(child: {parentElement?: unknown}) {
      child.parentElement = parent;
      children.push(child);
      return child;
    },
    insertBefore(child: {parentElement?: unknown}, ref: unknown) {
      child.parentElement = parent;
      const idx = ref ? children.indexOf(ref) : -1;
      if (idx >= 0) children.splice(idx, 0, child);
      else children.push(child);
      return child;
    },
  };
  if (withCanvasParent) parent.appendChild(glCanvas);

  const gl = {
    canvas: withCanvasParent ? glCanvas : null,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    DYNAMIC_DRAW: 0x88e8,
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    FLOAT: 0x1406,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_INT: 0x1405,
    POINTS: 0,
    BLEND: 0x0be2,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    createShader: () => ({}),
    shaderSource() {},
    compileShader() {},
    getShaderParameter: () => true,
    deleteShader() {},
    createProgram: () => {
      createdPrograms++;
      return {};
    },
    attachShader() {},
    linkProgram() {},
    getProgramParameter: () => true,
    deleteProgram() {},
    getUniformLocation: (_p: unknown, name: string) => name,
    createVertexArray: (): VAO => ({element: null}),
    bindVertexArray(v: VAO | null) {
      vao = v;
    },
    deleteVertexArray() {},
    createBuffer: (): GLBuf => ({order: null}),
    deleteBuffer() {},
    bindBuffer(target: number, buf: GLBuf) {
      if (target === 0x8893 && vao) vao.element = buf;
    },
    bufferData(target: number, size: number | ArrayBufferView) {
      if (target === 0x8893 && vao?.element && typeof size === 'number') {
        vao.element.order = new Uint32Array(size / 4);
      }
    },
    bufferSubData(target: number, _offset: number, data: ArrayBufferView) {
      if (target === 0x8892) {
        colorUploads.push(
          Array.from(
            new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
          ),
        );
      } else if (target === 0x8893 && vao?.element?.order) {
        const u32 = new Uint32Array(
          data.buffer,
          data.byteOffset,
          data.byteLength / 4,
        );
        vao.element.order.set(u32);
        uploads.push(Array.from(u32));
      }
    },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    useProgram() {},
    uniformMatrix4fv() {},
    uniform1i() {},
    uniform1f() {},
    enable() {},
    disable() {},
    blendFunc() {},
    depthMask() {},
    drawElements(_mode: number, count: number) {
      if (vao?.element?.order) {
        draws.push(Array.from(vao.element.order.subarray(0, count)));
      }
    },
  };

  return {
    gl: gl as unknown as WebGL2RenderingContext,
    parent,
    glCanvas,
    children,
    uploads,
    colorUploads,
    draws,
    get createdPrograms() {
      return createdPrograms;
    },
  };
}

function installFakeDOM() {
  const prevDoc = (globalThis as Record<string, unknown>).document;
  const createdCanvases: Array<{
    className: string;
    width: number;
    height: number;
    style: {cssText: string; display: string};
    parentElement: {children?: unknown[]} | null;
    configured: Array<{format: string; alphaMode?: string}>;
    unconfigured: number;
    removed: boolean;
    getContext(id: string): WebGPUCanvasContextLike | null;
  }> = [];

  (globalThis as Record<string, unknown>).document = {
    baseURI: 'https://example.test/app/',
    createElement(tag: string) {
      assert.equal(tag, 'canvas');
      const configured: Array<{format: string; alphaMode?: string}> = [];
      const style = {cssText: '', display: 'block'};
      const ctx: WebGPUCanvasContextLike = {
        configure(cfg) {
          configured.push({format: cfg.format, alphaMode: cfg.alphaMode});
        },
        unconfigure() {
          canvasObj.unconfigured++;
        },
        getCurrentTexture() {
          return {createView: () => ({})};
        },
      };
      const canvasObj = {
        tagName: 'CANVAS',
        className: '',
        width: 0,
        height: 0,
        style,
        parentElement: null as {children?: unknown[]} | null,
        configured,
        unconfigured: 0,
        removed: false,
        setAttribute() {},
        getContext(id: string) {
          return id === 'webgpu' ? ctx : null;
        },
        remove() {
          canvasObj.removed = true;
          const arr = canvasObj.parentElement?.children;
          if (arr) {
            const idx = arr.indexOf(canvasObj);
            if (idx >= 0) arr.splice(idx, 1);
          }
          canvasObj.parentElement = null;
        },
      };
      createdCanvases.push(canvasObj);
      return canvasObj;
    },
  };

  return {
    createdCanvases,
    restore() {
      if (prevDoc === undefined) {
        delete (globalThis as Record<string, unknown>).document;
      } else {
        (globalThis as Record<string, unknown>).document = prevDoc;
      }
    },
  };
}

function packSplatBytes(data: SplatData): Uint8Array {
  const out = new Uint8Array(data.count * 32);
  const view = new DataView(out.buffer);
  for (let i = 0; i < data.count; i++) {
    const b = i * 32;
    for (let k = 0; k < 3; k++) {
      view.setFloat32(b + k * 4, data.positions[i * 3 + k], true);
      view.setFloat32(b + 12 + k * 4, data.scales[i * 3 + k], true);
    }
    out.set(data.colors.subarray(i * 4, i * 4 + 4), b + 24);
    out[b + 28] = Math.round(data.rotations[i * 4 + 3] * 128 + 128);
    out[b + 29] = Math.round(data.rotations[i * 4] * 128 + 128);
    out[b + 30] = Math.round(data.rotations[i * 4 + 1] * 128 + 128);
    out[b + 31] = Math.round(data.rotations[i * 4 + 2] * 128 + 128);
  }
  return out;
}

const flushMicrotasks = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}`, err);
  }
}

async function main() {
  await test('WGSL shaders contain all required entry points and <= 8 storage bindings', () => {
    for (const ep of ['kResetBounds', 'kDepthAndSH', 'kQuantizeKeys']) {
      assert.ok(SPLAT_PREP_COMPUTE_WGSL.includes(`fn ${ep}`));
    }
    for (const ep of [
      'kRadixHistogram',
      'kScanBlocks',
      'kScanTop',
      'kAddBlockSums',
      'kRadixScatter',
    ]) {
      assert.ok(SPLAT_SORT_COMPUTE_WGSL.includes(`fn ${ep}`));
    }
    assert.ok(SPLAT_RENDER_WGSL.includes('fn vsMain'));
    assert.ok(SPLAT_RENDER_WGSL.includes('fn fsMain'));
  });

  await test('IEEE-754 sortable-uint mapping is strictly monotonic across negative, zero, and positive floats', () => {
    const samples = [
      -3.4e38, -1e10, -100.5, -1, -1e-6, -0, 0, 1e-6, 1, 42.25, 1e10, 3.4e38,
    ];
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);
    let prev = -1;
    for (const v of samples) {
      f32[0] = v;
      const su = floatBitsToSortableUint(u32[0]);
      if (v !== 0) assert.ok(su > prev, `Expected monotonic increase at ${v}`);
      assert.equal(sortableUintToFloat(su), f32[0]);
      prev = su;
    }
  });

  await test('WebGPU 2-pass 8-bit tiled radix sort matches CPU sortSplatsByDepth bit-for-bit across single-tile and multi-tile clouds', () => {
    for (const count of [1, 7, 256, 257, 1024, 1025, 2600]) {
      const data = makeCloud(count, 0, count * 17);
      const perspMvp = perspectiveVP(8);
      const gpuPersp = simulateWebGPUSplatSort(data, perspMvp);
      const cpuPersp = sortSplatsByDepth(data, perspMvp);
      assert.deepEqual(
        Array.from(gpuPersp),
        Array.from(cpuPersp),
        `Perspective mismatch at count=${count}`,
      );

      // Orthographic matrix (mvp[3] == mvp[7] == mvp[11] == 0 -> uses row 2)
      const orthoMvp = mat4Create();
      orthoMvp[10] = -0.1;
      orthoMvp[14] = 0.5;
      const gpuOrtho = simulateWebGPUSplatSort(data, orthoMvp);
      const cpuOrtho = sortSplatsByDepth(data, orthoMvp);
      assert.deepEqual(
        Array.from(gpuOrtho),
        Array.from(cpuOrtho),
        `Orthographic mismatch at count=${count}`,
      );
    }
  });

  await test('WebGPU radix sort preserves stability on duplicate depths and handles behind-camera, extreme-range, and NaN/Inf depths', () => {
    // Duplicate depths + negative w (behind camera)
    const dup = makeCloud(600, 0, 99);
    for (let i = 0; i < 600; i++) {
      dup.positions[i * 3 + 2] = (i % 5) * 2 - 4; // includes positive & negative view distances
    }
    const mvp = perspectiveVP(2);
    assert.deepEqual(
      Array.from(simulateWebGPUSplatSort(dup, mvp)),
      Array.from(sortSplatsByDepth(dup, mvp)),
    );

    // Extreme finite range (-2e38 .. +2e38) must not overflow f32 in half-range quantization
    const extremePos = new Float32Array([
      0, 0, -2e38,
      0, 0, 0,
      0, 0, 2e38,
    ]);
    const orthoIdentity = mat4Create();
    const extremeOrder = simulateWebGPUSplatSort(
      {count: 3, positions: extremePos},
      orthoIdentity,
    );
    assert.deepEqual(Array.from(extremeOrder), [2, 1, 0]);

    // Non-finite positions (NaN -> key 0, +Inf -> key 0, -Inf -> key 65535)
    const nonFinitePos = new Float32Array([
      0, 0, -1,
      0, 0, NaN,
      0, 0, -Infinity,
      0, 0, Infinity,
      0, 0, 5,
    ]);
    const nfGpu = simulateWebGPUSplatSort(
      {count: 5, positions: nonFinitePos},
      orthoIdentity,
    );
    const nfCpu = sortSplatsByDepth(
      {count: 5, positions: nonFinitePos},
      orthoIdentity,
    );
    assert.deepEqual(Array.from(nfGpu), Array.from(nfCpu));

    // All-NaN cloud produces identity permutation [0, 1, 2]
    const allNan = new Float32Array(9).fill(NaN);
    assert.deepEqual(
      Array.from(
        simulateWebGPUSplatSort({count: 3, positions: allNan}, orthoIdentity),
      ),
      [0, 1, 2],
    );
  });

  await test('fp16 packing and WGSL SH Degree 1-3 evaluation match CPU computeSplatViewColors within +-1/255', () => {
    assert.equal(float16BitsToFloat32(float32ToFloat16Bits(0)), 0);
    assert.equal(float16BitsToFloat32(float32ToFloat16Bits(-0.5)), -0.5);
    assert.equal(float16BitsToFloat32(float32ToFloat16Bits(1.25)), 1.25);
    assert.ok(Number.isNaN(float16BitsToFloat32(float32ToFloat16Bits(NaN))));
    assert.equal(shWordsPerSplatForDegree(0), 0);
    assert.equal(shWordsPerSplatForDegree(1), 5);
    assert.equal(shWordsPerSplatForDegree(2), 12);
    assert.equal(shWordsPerSplatForDegree(3), 23);

    // Non-identity rotated + non-uniformly scaled model matrix
    const model = mat4Create();
    const angle = 0.65;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    model[0] = 1.5 * c;
    model[1] = 1.5 * s;
    model[4] = -0.8 * s;
    model[5] = 0.8 * c;
    model[10] = 1.2;
    model[12] = 0.7;
    model[13] = -0.4;
    model[14] = 1.1;
    const cameraPos: [number, number, number] = [2.5, 1.8, 4.2];
    const mvp = perspectiveVP(5);

    for (const deg of [1, 2, 3] as const) {
      const data = makeCloud(48, deg, 100 + deg);
      const baseBuf = packSplatBaseBuffer(data);
      const packedSH = packSplatSHBuffer(data);
      assert.equal(packedSH.shDegree, deg);
      assert.equal(packedSH.wordsPerSplat, shWordsPerSplatForDegree(deg));

      const uBuf = new ArrayBuffer(SPLAT_UNIFORM_BYTES);
      writeSplatUniforms(uBuf, {
        mvp,
        modelView: model,
        model,
        cameraPos,
        focalX: 520,
        focalY: 520,
        viewportWidth: 800,
        viewportHeight: 600,
        splatCount: data.count,
        shDegreeEffective: deg,
        shWordsPerSplat: packedSH.wordsPerSplat,
        antialiased: false,
      });

      const gpuColors = evaluateWGSLFp16SHColors(
        baseBuf,
        packedSH.words,
        uBuf,
      );
      const cpuColors = computeSplatViewColors(
        data,
        model,
        cameraPos,
        new Uint8Array(data.count * 4),
      );
      for (let i = 0; i < cpuColors.length; i++) {
        const diff = Math.abs(gpuColors[i] - cpuColors[i]);
        assert.ok(
          diff <= 1,
          `Degree ${deg} byte ${i}: GPU=${gpuColors[i]} vs CPU=${cpuColors[i]}`,
        );
      }
    }
  });

  await test('packSplatBaseBuffer packs 48-byte SplatBase records with 3D covariance and RGBA8', () => {
    const data = makeCloud(5, 0, 7);
    const buf = packSplatBaseBuffer(data);
    assert.equal(buf.byteLength, 5 * SPLAT_BASE_STRIDE_BYTES);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    const expectedCov = computeSplatCovariance3D(data.scales, data.rotations, 2);
    for (let k = 0; k < 6; k++) {
      assert.ok(Math.abs(f32[2 * 12 + 4 + k] - expectedCov[k]) < 1e-6);
    }
    const rgba = u32[2 * 12 + 10];
    assert.equal(rgba & 0xff, data.colors[8]);
    assert.equal((rgba >>> 8) & 0xff, data.colors[9]);
    assert.equal((rgba >>> 16) & 0xff, data.colors[10]);
    assert.equal((rgba >>> 24) & 0xff, data.colors[11]);
  });

  await test('resolveSplatRenderMode selects vram-overlay, hybrid, or webgl2 accurately', () => {
    const splatMesh = {
      visible: true,
      primitives: [],
      userData: {xr: {splatUrl: 'https://example.test/room.spz'}},
    };
    const gltfMesh = {
      visible: true,
      primitives: [{vao: {}}],
    };
    const attrs = new Map<string, string>();
    const container = {getAttribute: (k: string) => attrs.get(k) ?? null};

    // Pure-splat desktop scene defaults to Fast Path A ('vram-overlay')
    assert.equal(
      resolveSplatRenderMode({container, meshes: [splatMesh]}),
      'vram-overlay',
    );
    assert.equal(hasVisibleNonSplatMeshes({meshes: [splatMesh]}), false);

    // Mixed glTF + splat scene defaults to Fast Path B ('hybrid') for Z-occlusion
    assert.equal(
      hasVisibleNonSplatMeshes({meshes: [splatMesh, gltfMesh]}),
      true,
    );
    assert.equal(
      resolveSplatRenderMode({container, meshes: [splatMesh, gltfMesh]}),
      'hybrid',
    );

    // Hidden glTF mesh does not block vram-overlay
    assert.equal(
      resolveSplatRenderMode({
        container,
        meshes: [splatMesh, {...gltfMesh, visible: false}],
      }),
      'vram-overlay',
    );

    // Active WebXR session or stereo eye pass ALWAYS selects 'hybrid' (even if splat-renderer="webgpu")
    attrs.set('splat-renderer', 'webgpu');
    assert.equal(
      resolveSplatRenderMode(
        {container, meshes: [splatMesh], xrSessionActive: true},
        'none',
      ),
      'hybrid',
    );
    assert.equal(
      resolveSplatRenderMode({container, meshes: [splatMesh]}, 'left'),
      'hybrid',
    );

    // Explicit overrides
    attrs.set('splat-renderer', 'hybrid');
    assert.equal(
      resolveSplatRenderMode({container, meshes: [splatMesh]}),
      'hybrid',
    );
    attrs.set('splat-renderer', 'webgl2');
    assert.equal(
      resolveSplatRenderMode({container, meshes: [splatMesh]}, 'right'),
      'webgl2',
    );
  });

  await test('Fast Path A (vram-overlay) renders splats via WebGPU drawIndirect without allocating WebGL2 SplatRenderer', async () => {
    const dom = installFakeDOM();
    const gpuMock = createMockWebGPUDevice();
    setWebGPUDeviceForTests(gpuMock.device);
    registerPlugin(splatLoaderPlugin);
    registerPlugin(webgpuSplatPlugin);

    try {
      const data = makeCloud(16, 2, 123);
      const rawBytes = packSplatBytes(data);
      const loader = new XRSplatLoader(
        async () => new Response(rawBytes as BodyInit),
      );
      const {gl, parent, glCanvas, children, draws, createdPrograms} = mockGL();
      const mesh = {
        visible: true,
        primitives: [],
        transform: mat4Create(),
        userData: {xr: {splatUrl: 'https://example.test/cloud.splat'}},
      };
      const viewer = {
        gl,
        container: parent,
        meshes: [mesh],
        viewMatrix: mat4Create(),
        projMatrix: perspectiveVP(4),
      };

      loader.sync(viewer);
      await flushMicrotasks();

      // WebGL2 SplatRenderer was NOT eagerly allocated while accelerator is registered
      assert.equal(createdPrograms, 0);

      const vp = perspectiveVP(4);
      setSplatViewerEye(viewer, [0, 0, 4]);
      loader.draw(viewer, vp, 'none', [0, 0, 800, 600], vp);

      // WebGL2 drawElements was skipped; WebGPU rendered via drawIndirect
      assert.equal(draws.length, 0);
      assert.equal(createdPrograms, 0);
      assert.equal(gpuMock.renderPasses.length, 1);
      assert.equal(gpuMock.renderPasses[0].loadOp, 'clear');
      assert.equal(
        gpuMock.renderPasses[0].indirectOffset,
        CLOUD_INDIRECT_OFFSET_BYTES,
      );
      assert.deepEqual(gpuMock.renderPasses[0].indirectArgs, [4, 16, 0, 0]);

      // Overlay canvas inserted AFTER glCanvas with premultiplied alpha
      assert.equal(dom.createdCanvases.length, 1);
      const overlay = dom.createdCanvases[0];
      assert.equal(overlay.className, 'three-live-webgpu-layer');
      assert.equal(children[0], glCanvas);
      assert.equal(children[1], overlay);
      assert.equal(overlay.configured[0].alphaMode, 'premultiplied');
      assert.equal(overlay.style.display, 'block');

      // Hiding the mesh hides the overlay canvas on the next frame
      mesh.visible = false;
      loader.draw(viewer, vp, 'none', [0, 0, 800, 600], vp);
      assert.equal(overlay.style.display, 'none');

      // Clearing meshes hides overlay in beginFrame (even if onAfterRender returns early)
      mesh.visible = true;
      loader.draw(viewer, vp, 'none', [0, 0, 800, 600], vp);
      assert.equal(overlay.style.display, 'block');
      viewer.meshes = [];
      getWebGPUSplatAccelerator().beginFrame(viewer);
      assert.equal(overlay.style.display, 'none');

      loader.dispose();
      getWebGPUSplatAccelerator().disposeViewer(viewer);
      assert.equal(overlay.removed, true);
    } finally {
      resetWebGPUDevice();
      dom.restore();
    }
  });

  await test('Fast Path A clears on first cloud and preserves prior clouds with loadOp=load', async () => {
    const dom = installFakeDOM();
    const gpuMock = createMockWebGPUDevice();
    setWebGPUDeviceForTests(gpuMock.device);
    registerPlugin(webgpuSplatPlugin);

    try {
      const c1 = makeCloud(8, 0, 1);
      const c2 = makeCloud(10, 0, 2);
      const loader = new XRSplatLoader(async (url) =>
        new Response(
          (String(url).includes('one')
            ? packSplatBytes(c1)
            : packSplatBytes(c2)) as BodyInit,
        ),
      );
      const {gl, parent} = mockGL();
      const viewer = {
        gl,
        container: parent,
        meshes: [
          {
            visible: true,
            primitives: [],
            transform: mat4Create(),
            userData: {xr: {splatUrl: 'https://example.test/one.splat'}},
          },
          {
            visible: true,
            primitives: [],
            transform: mat4Create(),
            userData: {xr: {splatUrl: 'https://example.test/two.splat'}},
          },
        ],
        viewMatrix: mat4Create(),
        projMatrix: perspectiveVP(3),
      };
      loader.sync(viewer);
      await flushMicrotasks();

      const vp = perspectiveVP(3);
      loader.draw(viewer, vp, 'none', [0, 0, 640, 480], vp);
      assert.equal(gpuMock.renderPasses.length, 2);
      assert.equal(gpuMock.renderPasses[0].loadOp, 'clear');
      assert.deepEqual(gpuMock.renderPasses[0].indirectArgs, [4, 8, 0, 0]);
      assert.equal(gpuMock.renderPasses[1].loadOp, 'load');
      assert.deepEqual(gpuMock.renderPasses[1].indirectArgs, [4, 10, 0, 0]);

      loader.dispose();
      getWebGPUSplatAccelerator().disposeViewer(viewer);
    } finally {
      resetWebGPUDevice();
      dom.restore();
    }
  });

  await test('Fast Path B (hybrid) feeds async GPU-sorted indices & SH colors into WebGL2, skips stationary frames, isolates stereo eyes, and restores DC colors when SH turns off', async () => {
    const gpuMock = createMockWebGPUDevice({autoResolveMaps: false});
    setWebGPUDeviceForTests(gpuMock.device);
    registerPlugin(splatLoaderPlugin);
    registerPlugin(webgpuSplatPlugin);

    try {
      const data = makeCloud(24, 2, 777);
      const {gl, parent, draws, colorUploads} = mockGL();
      parent.setAttribute('splat-renderer', 'hybrid');
      parent.setAttribute('splat-quality', 'high');

      // Construct SplatData with SH bands directly via custom XRSplatLoader entry
      const accel = new WebGPUSplatAccelerator();
      getSharedRegistry().splatAccelerator = accel;
      const loader = new XRSplatLoader(
        async () => new Response(packSplatBytes(data) as BodyInit),
      );
      const mesh = {
        visible: true,
        primitives: [],
        transform: mat4Create(),
        userData: {xr: {splatUrl: 'https://localhost/sh.splat'}},
      };
      const viewer = {
        gl,
        container: parent,
        meshes: [mesh],
        viewMatrix: mat4Create(),
        projMatrix: perspectiveVP(6),
        xrSessionActive: true,
      };
      loader.sync(viewer);
      await flushMicrotasks();
      // Replace parsed .splat entry data with full SH Degree-2 cloud so SH readback is exercised
      const internalEntries = (
        loader as unknown as {entries: Map<object, {data: SplatData}>}
      ).entries;
      internalEntries.get(mesh)!.data = data;

      const vpLeft = perspectiveVP(6);
      const vpRight = perspectiveVP(6.2);
      setSplatViewerEye(viewer, [0, 0, 6]);

      // Frame 0 (cold start before mapAsync resolves): falls back to CPU sort without stalling
      loader.draw(viewer, vpLeft, 'left', [0, 0, 800, 600], vpLeft);
      assert.equal(draws.length, 1);
      assert.equal(gpuMock.computeSubmissions, 1);
      const expectedLeft = Array.from(sortSplatsByDepth(data, vpLeft));
      assert.deepEqual(draws[0], expectedLeft);
      const initialColorUploads = colorUploads.length;

      // Resolve mapAsync for 'left' eye -> Frame 1 uploads GPU order + GPU SH colors, and skips re-dispatch because camera is stationary!
      gpuMock.flushMaps();
      await flushMicrotasks();

      loader.draw(viewer, vpLeft, 'left', [0, 0, 800, 600], vpLeft);
      assert.equal(draws.length, 2);
      assert.deepEqual(draws[1], expectedLeft);
      assert.equal(
        gpuMock.computeSubmissions,
        1,
        'Stationary camera must not re-dispatch compute',
      );
      assert.equal(
        colorUploads.length,
        initialColorUploads + 1,
        'GPU SH colors uploaded to WebGL2 colorBuffer',
      );

      // Stereo 'right' eye has independent slot ring & signature
      loader.draw(viewer, vpRight, 'right', [800, 0, 800, 600], vpRight);
      assert.equal(gpuMock.computeSubmissions, 2);
      gpuMock.flushMaps();
      await flushMicrotasks();
      loader.draw(viewer, vpRight, 'right', [800, 0, 800, 600], vpRight);
      assert.deepEqual(
        draws[draws.length - 1],
        Array.from(sortSplatsByDepth(data, vpRight)),
      );

      // Turning off splat-quality="high" restores base DC colors on SplatRenderer's 4-draw cadence
      const beforeRestore = colorUploads.length;
      parent.setAttribute('splat-quality', 'normal');
      for (let frame = 0; frame < 4; frame++) {
        loader.draw(viewer, vpLeft, 'left', [0, 0, 800, 600], vpLeft);
      }
      assert.equal(colorUploads.length, beforeRestore + 1);
      assert.deepEqual(colorUploads[colorUploads.length - 1], Array.from(data.colors));

      loader.dispose();
    } finally {
      getSharedRegistry().splatAccelerator = getWebGPUSplatAccelerator();
      resetWebGPUDevice();
    }
  });

  await test('StandaloneWebGPUSplatLoader renders splats when xr-live-spatial is absent and yields cleanly when spatial is present', async () => {
    const dom = installFakeDOM();
    const gpuMock = createMockWebGPUDevice();
    setWebGPUDeviceForTests(gpuMock.device);

    // Temporarily remove xr-live-splat-loader from registeredPlugins to simulate standalone xr-live-webgpu
    const savedPlugins = [...registeredPlugins];
    registeredPlugins.length = 0;
    registerPlugin(webgpuSplatPlugin);

    try {
      const data = makeCloud(12, 0, 55);
      const standalone = new StandaloneWebGPUSplatLoader(
        async () => new Response(packSplatBytes(data) as BodyInit),
      );
      const {gl, parent} = mockGL();
      const viewer = {
        gl,
        container: parent,
        meshes: [
          {
            visible: true,
            primitives: [],
            transform: mat4Create(),
            userData: {xr: {splatUrl: 'https://example.test/solo.splat'}},
          },
        ],
        viewMatrix: mat4Create(),
        projMatrix: perspectiveVP(5),
      };

      standalone.sync(viewer);
      await flushMicrotasks();
      const vp = perspectiveVP(5);
      standalone.draw(viewer, vp, 'none', [0, 0, 800, 600], vp);
      assert.equal(gpuMock.renderPasses.length, 1);
      assert.deepEqual(gpuMock.renderPasses[0].indirectArgs, [4, 12, 0, 0]);

      standalone.dispose();
      getWebGPUSplatAccelerator().disposeViewer(viewer);
    } finally {
      registeredPlugins.length = 0;
      registeredPlugins.push(...savedPlugins);
      getSharedRegistry().splatAccelerator = getWebGPUSplatAccelerator();
      resetWebGPUDevice();
      dom.restore();
    }
  });

  await test('Missing navigator.gpu and GPUDevice.lost recover cleanly without throwing', async () => {
    const dom = installFakeDOM();
    resetWebGPUDevice();

    // 1. No navigator.gpu -> acquireWebGPUDevice resolves null & drawCloud returns null
    const devNull = await acquireWebGPUDevice();
    assert.equal(devNull, null);

    // 2. Inject mock device via navigator.gpu, trigger device.lost, then verify recovery
    const gpuMock1 = createMockWebGPUDevice();
    const gpuMock2 = createMockWebGPUDevice();
    let useSecond = false;
    const prevNav = (globalThis as Record<string, unknown>).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        gpu: {
          getPreferredCanvasFormat: () => 'bgra8unorm',
          requestAdapter: async () => ({
            requestDevice: async () =>
              useSecond ? gpuMock2.device : gpuMock1.device,
          }),
        },
      },
    });

    try {
      resetWebGPUDevice();
      const d1 = await acquireWebGPUDevice();
      assert.equal(d1, gpuMock1.device);

      const data = makeCloud(6, 0, 33);
      const {gl, parent} = mockGL();
      const viewer = {
        gl,
        container: parent,
        meshes: [
          {
            visible: true,
            primitives: [],
            transform: mat4Create(),
            userData: {xr: {splatUrl: 'https://example.test/lost.splat'}},
          },
        ],
      };
      const vp = perspectiveVP(4);
      const accel = getWebGPUSplatAccelerator();
      accel.beginFrame(viewer);
      const res1 = accel.drawCloud({
        viewer,
        mesh: viewer.meshes[0],
        data,
        vp,
        mvp: vp,
        model: mat4Create(),
        modelView: mat4Create(),
        cameraPos: [0, 0, 4],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      accel.endFrame(viewer);
      assert.equal(res1, 'rendered');

      // Fire device.lost -> destroys gpuMock1 buffers, hides overlay, allows acquiring gpuMock2
      useSecond = true;
      gpuMock1.triggerDeviceLost();
      await flushMicrotasks();
      assert.ok(gpuMock1.buffers.every((b) => b.destroyed));
      assert.equal(dom.createdCanvases[0].style.display, 'none');

      const d2 = await acquireWebGPUDevice();
      assert.equal(d2, gpuMock2.device);
      accel.beginFrame(viewer);
      const res2 = accel.drawCloud({
        viewer,
        mesh: viewer.meshes[0],
        data,
        vp,
        mvp: vp,
        model: mat4Create(),
        modelView: mat4Create(),
        cameraPos: [0, 0, 4],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      accel.endFrame(viewer);
      assert.equal(res2, 'rendered');
      assert.equal(gpuMock2.renderPasses.length, 1);

      accel.disposeCloud(data);
      accel.disposeViewer(viewer);
    } finally {
      if (prevNav === undefined) {
        delete (globalThis as Record<string, unknown>).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: prevNav,
        });
      }
      resetWebGPUDevice();
      dom.restore();
    }
  });

  await test('packSplatBaseBuffer sanitizes non-finite scales and StandaloneWebGPUSplatLoader renders mixed scenes on desktop without dropping splats', async () => {
    const dom = installFakeDOM();
    const gpuMock = createMockWebGPUDevice();
    setWebGPUDeviceForTests(gpuMock.device);

    // 1. Non-finite scale sanitization
    const dirty = makeCloud(2, 0, 9);
    dirty.scales[0] = NaN;
    dirty.scales[1] = -0.25;
    dirty.scales[2] = NaN;
    const packed = new Float32Array(packSplatBaseBuffer(dirty));
    assert.equal(packed[3], 0.25);

    // 2. StandaloneWebGPUSplatLoader in mixed scene ([splatMesh, gltfMesh]) and splat-renderer="hybrid"
    const savedPlugins = [...registeredPlugins];
    registeredPlugins.length = 0;
    registerPlugin(webgpuSplatPlugin);
    try {
      const data = makeCloud(10, 0, 88);
      const standalone = new StandaloneWebGPUSplatLoader(
        async () => new Response(packSplatBytes(data) as BodyInit),
      );
      const {gl, parent} = mockGL();
      parent.setAttribute('splat-renderer', 'hybrid');
      const viewer = {
        gl,
        container: parent,
        meshes: [
          {
            visible: true,
            primitives: [],
            transform: mat4Create(),
            userData: {xr: {splatUrl: 'https://example.test/mixed.splat'}},
          },
          {
            visible: true,
            primitives: [{vao: {}}],
            transform: mat4Create(),
          },
        ],
        viewMatrix: mat4Create(),
        projMatrix: perspectiveVP(5),
        xrSessionActive: false,
      };
      standalone.sync(viewer);
      await flushMicrotasks();
      const vp = perspectiveVP(5);
      standalone.draw(viewer, vp, 'none', [0, 0, 800, 600], vp);
      assert.equal(
        gpuMock.renderPasses.length,
        1,
        'Standalone mode must render via vram-overlay on desktop even with glTF meshes',
      );

      // In WebXR stereo without xr-live-spatial, standalone skips compute waste cleanly
      const prevSubmits = gpuMock.computeSubmissions;
      viewer.xrSessionActive = true;
      standalone.draw(viewer, vp, 'left', [0, 0, 800, 600], vp);
      assert.equal(gpuMock.computeSubmissions, prevSubmits);

      standalone.dispose();
      getWebGPUSplatAccelerator().disposeViewer(viewer);
    } finally {
      registeredPlugins.length = 0;
      registeredPlugins.push(...savedPlugins);
      getSharedRegistry().splatAccelerator = getWebGPUSplatAccelerator();
      resetWebGPUDevice();
      dom.restore();
    }
  });

  await test('Shared SplatData across multiple meshes in hybrid mode maintains isolated per-mesh sorted order caches', async () => {
    const gpuMock = createMockWebGPUDevice({autoResolveMaps: true});
    setWebGPUDeviceForTests(gpuMock.device);
    const accel = new WebGPUSplatAccelerator();

    try {
      const sharedData = makeCloud(20, 0, 404);
      const {gl, parent} = mockGL();
      parent.setAttribute('splat-renderer', 'hybrid');
      const meshA = {visible: true, primitives: []};
      const meshB = {visible: true, primitives: []};
      const viewer = {gl, container: parent, meshes: [meshA, meshB]};

      const vp = perspectiveVP(10);
      const modelA = mat4Create();
      // Rotate meshB 180 degrees around X (z -> -z) so depth order reverses!
      const modelB = mat4Create();
      modelB[5] = -1;
      modelB[10] = -1;
      const mvpA = mat4Create();
      const mvpB = mat4Create();
      mat4Multiply(mvpA, vp, modelA);
      mat4Multiply(mvpB, vp, modelB);

      // Cold frame dispatches both meshes independently
      assert.equal(
        accel.drawCloud({
          viewer,
          mesh: meshA,
          data: sharedData,
          vp,
          mvp: mvpA,
          model: modelA,
          modelView: modelA,
          cameraPos: [0, 0, 10],
          focalX: 500,
          focalY: 500,
          viewportWidth: 800,
          viewportHeight: 600,
          highQualitySH: false,
          eye: 'none',
        }),
        null,
      );
      assert.equal(
        accel.drawCloud({
          viewer,
          mesh: meshB,
          data: sharedData,
          vp,
          mvp: mvpB,
          model: modelB,
          modelView: modelB,
          cameraPos: [0, 0, 10],
          focalX: 500,
          focalY: 500,
          viewportWidth: 800,
          viewportHeight: 600,
          highQualitySH: false,
          eye: 'none',
        }),
        null,
      );
      await flushMicrotasks();

      const outA = accel.drawCloud({
        viewer,
        mesh: meshA,
        data: sharedData,
        vp,
        mvp: mvpA,
        model: modelA,
        modelView: modelA,
        cameraPos: [0, 0, 10],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      const outB = accel.drawCloud({
        viewer,
        mesh: meshB,
        data: sharedData,
        vp,
        mvp: mvpB,
        model: modelB,
        modelView: modelB,
        cameraPos: [0, 0, 10],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      if (
        !outA ||
        outA === 'rendered' ||
        !outA.order ||
        !outB ||
        outB === 'rendered' ||
        !outB.order
      ) {
        throw new Error('Expected hybrid sorted outputs for meshA and meshB');
      }
      assert.deepEqual(
        Array.from(outA.order),
        Array.from(sortSplatsByDepth(sharedData, mvpA)),
      );
      assert.deepEqual(
        Array.from(outB.order),
        Array.from(sortSplatsByDepth(sharedData, mvpB)),
      );
      assert.notDeepEqual(Array.from(outA.order), Array.from(outB.order));

      accel.disposeCloud(sharedData);
    } finally {
      resetWebGPUDevice();
    }
  });

  await test('OOM in buildCloud destroys partial buffers without 60Hz retry storms, and swapchain getCurrentTexture errors fall back to hybrid', async () => {
    const dom = installFakeDOM();
    const gpuMock = createMockWebGPUDevice();
    setWebGPUDeviceForTests(gpuMock.device);
    const accel = new WebGPUSplatAccelerator();

    try {
      const dataOOM = makeCloud(8, 0, 501);
      const {gl, parent} = mockGL();
      const viewer = {
        gl,
        container: parent,
        meshes: [
          {
            visible: true,
            primitives: [],
            userData: {xr: {splatUrl: 'https://example.test/oom.splat'}},
          },
        ],
      };
      const vp = perspectiveVP(4);

      // Fail on 5th buffer allocation inside buildCloud
      const origCreateBuffer = gpuMock.device.createBuffer.bind(gpuMock.device);
      let calls = 0;
      gpuMock.device.createBuffer = (desc) => {
        calls++;
        if (calls === 5) throw new Error('Out of GPU memory');
        return origCreateBuffer(desc);
      };

      const r1 = accel.drawCloud({
        viewer,
        mesh: viewer.meshes[0],
        data: dataOOM,
        vp,
        mvp: vp,
        model: mat4Create(),
        modelView: mat4Create(),
        cameraPos: [0, 0, 4],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      assert.equal(r1, null);
      assert.equal(gpuMock.buffers.length, 4);
      assert.ok(
        gpuMock.buffers.every((b) => b.destroyed),
        'Partially allocated GPU buffers must be destroyed on OOM',
      );

      // Second frame must short-circuit via bad WeakSet without re-allocating
      const r2 = accel.drawCloud({
        viewer,
        mesh: viewer.meshes[0],
        data: dataOOM,
        vp,
        mvp: vp,
        model: mat4Create(),
        modelView: mat4Create(),
        cameraPos: [0, 0, 4],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      assert.equal(r2, null);
      assert.equal(calls, 5);

      // Restore createBuffer and verify swapchain getCurrentTexture() error falls back to hybrid
      gpuMock.device.createBuffer = origCreateBuffer;
      const dataOK = makeCloud(8, 0, 502);
      accel.beginFrame(viewer);
      assert.equal(
        accel.drawCloud({
          viewer,
          mesh: viewer.meshes[0],
          data: dataOK,
          vp,
          mvp: vp,
          model: mat4Create(),
          modelView: mat4Create(),
          cameraPos: [0, 0, 4],
          focalX: 500,
          focalY: 500,
          viewportWidth: 800,
          viewportHeight: 600,
          highQualitySH: false,
          eye: 'none',
        }),
        'rendered',
      );
      accel.endFrame(viewer);

      const overlay = dom.createdCanvases[0];
      const wgpuCtx = overlay.getContext('webgpu')!;
      wgpuCtx.getCurrentTexture = () => {
        throw new Error('Swapchain texture lost');
      };
      accel.beginFrame(viewer);
      const fallbackOut = accel.drawCloud({
        viewer,
        mesh: viewer.meshes[0],
        data: dataOK,
        vp,
        mvp: vp,
        model: mat4Create(),
        modelView: mat4Create(),
        cameraPos: [0, 0, 4],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      accel.endFrame(viewer);
      assert.equal(overlay.style.display, 'none');
      assert.equal(fallbackOut, null); // cold hybrid frame kicked off mapAsync
      await flushMicrotasks();
      const readyOut = accel.drawCloud({
        viewer,
        mesh: viewer.meshes[0],
        data: dataOK,
        vp,
        mvp: vp,
        model: mat4Create(),
        modelView: mat4Create(),
        cameraPos: [0, 0, 4],
        focalX: 500,
        focalY: 500,
        viewportWidth: 800,
        viewportHeight: 600,
        highQualitySH: false,
        eye: 'none',
      });
      assert.ok(readyOut && readyOut !== 'rendered' && readyOut.order);

      accel.disposeCloud(dataOK);
      accel.disposeViewer(viewer);
    } finally {
      resetWebGPUDevice();
      dom.restore();
    }
  });

  await test('Snapshot compositing hooks glCanvas.toDataURL, onClearScene hides overlay, and acquireWebGPUDevice requests elevated adapter limits', async () => {
    const dom = installFakeDOM();
    const drawnSources: unknown[] = [];
    const origCreateElement = (
      (globalThis as Record<string, unknown>).document as {
        createElement: (t: string) => Record<string, unknown>;
      }
    ).createElement;
    (
      (globalThis as Record<string, unknown>).document as {
        createElement: (t: string) => Record<string, unknown>;
      }
    ).createElement = (tag: string) => {
      const c = origCreateElement(tag);
      const origGetCtx = c.getContext as (id: string) => unknown;
      c.getContext = (id: string) => {
        if (id === '2d') {
          return {
            drawImage(src: unknown) {
              drawnSources.push(src);
            },
          };
        }
        return origGetCtx(id);
      };
      c.toDataURL = () => 'data:image/png;base64,COMPOSITED';
      return c;
    };

    const gpuMock = createMockWebGPUDevice();
    const requestedDescs: unknown[] = [];
    const prevNav = (globalThis as Record<string, unknown>).navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        gpu: {
          getPreferredCanvasFormat: () => 'bgra8unorm',
          requestAdapter: async () => ({
            limits: {
              maxStorageBufferBindingSize: 536870912,
              maxBufferSize: 1073741824,
            },
            requestDevice: async (desc?: unknown) => {
              requestedDescs.push(desc);
              return gpuMock.device;
            },
          }),
        },
      },
    });

    registerPlugin(splatLoaderPlugin);
    registerPlugin(webgpuSplatPlugin);

    try {
      resetWebGPUDevice();
      const dev = await acquireWebGPUDevice();
      assert.equal(dev, gpuMock.device);
      assert.deepEqual(requestedDescs[0], {
        requiredLimits: {
          maxStorageBufferBindingSize: 536870912,
          maxBufferSize: 1073741824,
        },
      });

      const {gl, parent, glCanvas} = mockGL();
      (glCanvas as unknown as {width: number; height: number; toDataURL: () => string}).width = 800;
      (glCanvas as unknown as {width: number; height: number; toDataURL: () => string}).height = 600;
      const origToDataURL = () => 'data:image/png;base64,RAW_GL';
      (glCanvas as unknown as {toDataURL: () => string}).toDataURL = origToDataURL;

      const data = makeCloud(6, 0, 606);
      const mesh = {
        visible: true,
        primitives: [],
        transform: mat4Create(),
        userData: {xr: {splatUrl: 'https://example.test/snap.splat'}},
      };
      const viewer = {
        gl,
        container: parent,
        meshes: [mesh],
        viewMatrix: mat4Create(),
        projMatrix: perspectiveVP(4),
      };
      const vp = perspectiveVP(4);
      const accel = getWebGPUSplatAccelerator();
      accel.beginFrame(viewer);
      assert.equal(
        accel.drawCloud({
          viewer,
          mesh,
          data,
          vp,
          mvp: vp,
          model: mat4Create(),
          modelView: mat4Create(),
          cameraPos: [0, 0, 4],
          focalX: 500,
          focalY: 500,
          viewportWidth: 800,
          viewportHeight: 600,
          highQualitySH: false,
          eye: 'none',
        }),
        'rendered',
      );
      accel.endFrame(viewer);

      const overlay = dom.createdCanvases[0];
      assert.equal(
        (glCanvas as unknown as {toDataURL: () => string}).toDataURL(),
        'data:image/png;base64,COMPOSITED',
      );
      assert.deepEqual(drawnSources, [glCanvas, overlay]);

      // splatLoaderPlugin.onClearScene hides the overlay -> toDataURL falls back to RAW_GL
      viewer.meshes = [];
      splatLoaderPlugin.onClearScene?.(viewer);
      assert.equal(overlay.style.display, 'none');
      assert.equal(
        (glCanvas as unknown as {toDataURL: () => string}).toDataURL(),
        'data:image/png;base64,RAW_GL',
      );

      // disposeViewer restores original toDataURL function reference
      accel.disposeCloud(data);
      accel.disposeViewer(viewer);
      assert.equal(
        (glCanvas as unknown as {toDataURL: () => string}).toDataURL,
        origToDataURL,
      );
    } finally {
      if (prevNav === undefined) {
        delete (globalThis as Record<string, unknown>).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          value: prevNav,
        });
      }
      resetWebGPUDevice();
      dom.restore();
    }
  });

  console.log(`\nWebGPU splat tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
