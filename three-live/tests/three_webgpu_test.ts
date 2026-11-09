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

import * as assert from 'assert';
import {mat4LookAt, mat4Multiply, mat4Perspective} from '../src/math';
import {getSharedRegistry} from '../src/plugin';
import {ThreeLiveElement} from '../src/three-live-element';
import {ThreeView} from '../src/three-view';
import {
  acquireSceneWebGPUDevice,
  getWebGPUSceneAccelerator,
  type GPUSceneBufferLike,
  type GPUSceneCanvasContextLike,
  type GPUSceneDeviceLike,
  type GPUSceneTextureLike,
  normalizeRendererPreference,
  PART_STRIDE_BYTES,
  PART_STRIDE_WORDS,
  remapClipDepthToZeroOne,
  resetSceneWebGPUDevice,
  resolveSceneRenderBackend,
  SCENE_PBR_WGSL,
  SCENE_PICK_WGSL,
  SCENE_SHADOW_WGSL,
  SCENE_UNIFORM_BYTES,
  setSceneWebGPUDeviceForTests,
  VERTEX_STRIDE_BYTES,
  webgpuScenePlugin,
  writeSceneUniforms,
} from '../src/webgpu';
import {
  PART_FLAG_HAS_BASE_TEX,
  PART_FLAG_HIDDEN,
  PART_FLAG_NO_SECTION_CLIP,
  PART_FLAG_WORLD_SPACE,
  SCENE_FLAG_HAS_ENV_MAP,
  SCENE_FLAG_RIGHT_EYE,
  SCENE_FLAG_SECTION_ENABLED,
} from '../src/webgpu/shaders';

interface RecordedWrite {
  readonly buffer: MockGPUBuffer;
  readonly bufferOffset: number;
  readonly byteLength: number;
  readonly snapshot: Uint8Array;
}

class MockGPUBuffer implements GPUSceneBufferLike {
  readonly size: number;
  readonly usage: number;
  readonly bytes: Uint8Array;
  destroyed = false;
  mapped = false;
  mapCalls = 0;

  constructor(size: number, usage: number) {
    this.size = size;
    this.usage = usage;
    this.bytes = new Uint8Array(size);
  }

  async mapAsync(): Promise<void> {
    if (this.mapped) {
      throw new Error('GPUBuffer already mapped');
    }
    this.mapCalls++;
    await Promise.resolve();
    this.mapped = true;
  }

  getMappedRange(offset = 0, size?: number): ArrayBuffer {
    const len = size ?? this.size - offset;
    return this.bytes.slice(offset, offset + len).buffer;
  }

  unmap(): void {
    this.mapped = false;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

class MockGPUTexture implements GPUSceneTextureLike {
  readonly desc: {
    size: unknown;
    format: string;
    usage: number;
    sampleCount?: number;
  };
  destroyed = false;

  constructor(desc: {
    size: unknown;
    format: string;
    usage: number;
    sampleCount?: number;
  }) {
    this.desc = desc;
  }

  createView(): object {
    return {texture: this};
  }

  destroy(): void {
    this.destroyed = true;
  }
}

interface RecordedBundleOp {
  readonly kind:
    | 'pipeline'
    | 'bindGroup'
    | 'vertexBuffer'
    | 'indexBuffer'
    | 'draw'
    | 'drawIndexed';
  readonly args: unknown[];
}

interface RecordedPass {
  readonly descriptor: Record<string, unknown>;
  readonly viewports: number[][];
  readonly bundles: Array<{ops: RecordedBundleOp[]}>;
  readonly draws: number[][];
}

function createMockGPUDevice(opts?: {
  disableMsaa?: boolean;
  pickPixel?: [number, number, number, number];
}) {
  let resolveLost!: (info: unknown) => void;
  const lost = new Promise<unknown>((res) => {
    resolveLost = res;
  });

  const buffers: MockGPUBuffer[] = [];
  const textures: MockGPUTexture[] = [];
  const shaderCodes: string[] = [];
  const pipelines: Array<Record<string, unknown>> = [];
  const writes: RecordedWrite[] = [];
  const externalCopies: Array<{source: unknown; texture: MockGPUTexture}> = [];
  const passes: RecordedPass[] = [];
  let submitCount = 0;

  const device: GPUSceneDeviceLike = {
    lost,
    queue: {
      writeBuffer(
        buffer: GPUSceneBufferLike,
        bufferOffset: number,
        data: ArrayBufferView | ArrayBuffer,
        dataOffset?: number,
        size?: number,
      ): void {
        const mb = buffer as MockGPUBuffer;
        let srcBytes: Uint8Array;
        if (ArrayBuffer.isView(data)) {
          const bpe =
            (data as unknown as {BYTES_PER_ELEMENT?: number})
              .BYTES_PER_ELEMENT ?? 1;
          const elemOff = (dataOffset ?? 0) * bpe;
          const byteLen =
            size !== undefined ? size * bpe : data.byteLength - elemOff;
          srcBytes = new Uint8Array(
            data.buffer,
            data.byteOffset + elemOff,
            byteLen,
          );
        } else {
          const off = dataOffset ?? 0;
          const len = size ?? data.byteLength - off;
          srcBytes = new Uint8Array(data, off, len);
        }
        mb.bytes.set(srcBytes, bufferOffset);
        writes.push({
          buffer: mb,
          bufferOffset,
          byteLength: srcBytes.byteLength,
          snapshot: srcBytes.slice(),
        });
      },
      writeTexture(): void {},
      copyExternalImageToTexture(src, dst): void {
        const tex = dst.texture as MockGPUTexture;
        // Enforce W3C WebGPU spec requirement: RENDER_ATTACHMENT (0x10) must be set.
        if ((tex.desc.usage & 0x10) === 0) {
          throw new Error(
            'copyExternalImageToTexture requires GPUTextureUsage.RENDER_ATTACHMENT',
          );
        }
        externalCopies.push({source: src.source, texture: tex});
      },
      submit(cmds: unknown[]): void {
        submitCount += cmds.length;
      },
    },
    createBuffer(desc) {
      const b = new MockGPUBuffer(desc.size, desc.usage);
      buffers.push(b);
      return b;
    },
    createTexture(desc) {
      if (opts?.disableMsaa && (desc.sampleCount ?? 1) > 1) {
        throw new Error('MSAA disabled in mock');
      }
      const t = new MockGPUTexture(desc);
      textures.push(t);
      return t;
    },
    createSampler(desc) {
      return {sampler: desc};
    },
    createShaderModule(desc) {
      shaderCodes.push(desc.code);
      return {code: desc.code};
    },
    createBindGroupLayout(desc) {
      return {bgl: desc};
    },
    createPipelineLayout(desc) {
      return {pl: desc};
    },
    createRenderPipeline(desc) {
      const rec = desc as Record<string, unknown>;
      pipelines.push(rec);
      return rec;
    },
    createBindGroup(desc) {
      return {bg: desc};
    },
    createRenderBundleEncoder(desc) {
      const ops: RecordedBundleOp[] = [];
      return {
        setPipeline: (p) => ops.push({kind: 'pipeline', args: [p]}),
        setBindGroup: (i, bg) => ops.push({kind: 'bindGroup', args: [i, bg]}),
        setVertexBuffer: (s, b) =>
          ops.push({kind: 'vertexBuffer', args: [s, b]}),
        setIndexBuffer: (b, fmt) =>
          ops.push({kind: 'indexBuffer', args: [b, fmt]}),
        draw: (...a) => ops.push({kind: 'draw', args: a}),
        drawIndexed: (...a) => ops.push({kind: 'drawIndexed', args: a}),
        finish: () => ({desc, ops}),
      };
    },
    createCommandEncoder() {
      return {
        beginRenderPass(descriptor) {
          const rec: RecordedPass = {
            descriptor: descriptor as Record<string, unknown>,
            viewports: [],
            bundles: [],
            draws: [],
          };
          passes.push(rec);
          return {
            setPipeline: () => {},
            setBindGroup: () => {},
            setViewport: (...vp) => rec.viewports.push(vp),
            setScissorRect: () => {},
            executeBundles: (bs) => {
              for (const b of bs) {
                rec.bundles.push(b as {ops: RecordedBundleOp[]});
              }
            },
            draw: (...d) => rec.draws.push(d),
            end: () => {},
          };
        },
        copyTextureToBuffer(_src, dst) {
          if (dst.bytesPerRow % 256 !== 0) {
            throw new Error('bytesPerRow must be a multiple of 256');
          }
          const mb = dst.buffer as MockGPUBuffer;
          const px = opts?.pickPixel ?? [0, 0, 0, 0];
          mb.bytes[0] = px[0];
          mb.bytes[1] = px[1];
          mb.bytes[2] = px[2];
          mb.bytes[3] = px[3];
        },
        finish: () => ({}),
      };
    },
  };

  return {
    device,
    buffers,
    textures,
    shaderCodes,
    pipelines,
    writes,
    externalCopies,
    passes,
    getSubmitCount: () => submitCount,
    triggerLost: () => resolveLost({reason: 'destroyed'}),
  };
}

function createMockHarness(width = 640, height = 480) {
  let glDrawCalls = 0;
  let glClears = 0;
  const children: unknown[] = [];

  const attrs = new Map<string, string>();
  const container = {
    style: {} as Record<string, string>,
    children,
    getAttribute: (k: string) => (attrs.has(k) ? attrs.get(k)! : null),
    setAttribute: (k: string, v: string) => {
      attrs.set(k, String(v));
    },
    removeAttribute: (k: string) => {
      attrs.delete(k);
    },
    hasAttribute: (k: string) => attrs.has(k),
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    appendChild: (el: {parentElement?: unknown}) => {
      el.parentElement = container;
      children.push(el);
      return el;
    },
    insertBefore: (el: {parentElement?: unknown}, ref: unknown) => {
      el.parentElement = container;
      const idx = children.indexOf(ref);
      if (idx >= 0) children.splice(idx, 0, el);
      else children.push(el);
      return el;
    },
    querySelector: (sel: string) => {
      if (sel === 'canvas.xr-live-webgpu-splat') {
        return (
          children.find(
            (c) =>
              (c as {className?: string}).className === 'xr-live-webgpu-splat',
          ) ?? null
        );
      }
      return null;
    },
  };

  const glContext: Record<string, unknown> = {
    VERTEX_SHADER: 35633,
    FRAGMENT_SHADER: 35632,
    COMPILE_STATUS: 35713,
    LINK_STATUS: 35714,
    ARRAY_BUFFER: 34962,
    ELEMENT_ARRAY_BUFFER: 34963,
    STATIC_DRAW: 35044,
    DYNAMIC_DRAW: 35048,
    FLOAT: 5126,
    UNSIGNED_SHORT: 5123,
    UNSIGNED_INT: 5125,
    TRIANGLES: 4,
    DEPTH_TEST: 2929,
    COLOR_BUFFER_BIT: 16384,
    DEPTH_BUFFER_BIT: 256,
    TEXTURE_2D: 3553,
    TEXTURE0: 33984,
    TEXTURE1: 33985,
    TEXTURE2: 33986,
    TEXTURE3: 33987,
    TEXTURE4: 33988,
    TEXTURE8: 33992,
    RGBA: 6408,
    UNSIGNED_BYTE: 5121,
    NEAREST: 9728,
    LINEAR: 9729,
    LINEAR_MIPMAP_LINEAR: 9987,
    REPEAT: 10497,
    CLAMP_TO_EDGE: 33071,
    TEXTURE_MIN_FILTER: 10241,
    TEXTURE_MAG_FILTER: 10240,
    TEXTURE_WRAP_S: 10242,
    TEXTURE_WRAP_T: 10243,
    FRAMEBUFFER: 36160,
    RENDERBUFFER: 36161,
    COLOR_ATTACHMENT0: 36064,
    DEPTH_ATTACHMENT: 36096,
    DEPTH_COMPONENT16: 33189,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    deleteShader: () => {},
    deleteProgram: () => {},
    getUniformLocation: (_p: unknown, name: string) => ({name}),
    createVertexArray: () => ({}),
    bindVertexArray: () => {},
    deleteVertexArray: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    deleteBuffer: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    vertexAttribDivisor: () => {},
    vertexAttrib3f: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    texImage2D: () => {},
    texParameteri: () => {},
    generateMipmap: () => {},
    deleteTexture: () => {},
    activeTexture: () => {},
    createFramebuffer: () => ({}),
    bindFramebuffer: () => {},
    framebufferTexture2D: () => {},
    createRenderbuffer: () => ({}),
    bindRenderbuffer: () => {},
    renderbufferStorage: () => {},
    framebufferRenderbuffer: () => {},
    deleteFramebuffer: () => {},
    deleteRenderbuffer: () => {},
    viewport: () => {},
    enable: () => {},
    disable: () => {},
    clearColor: () => {},
    clear: () => {
      glClears++;
    },
    useProgram: () => {},
    uniform1i: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform3fv: () => {},
    uniform4f: () => {},
    uniform4fv: () => {},
    uniformMatrix3fv: () => {},
    uniformMatrix4fv: () => {},
    drawElements: () => {
      glDrawCalls++;
    },
    drawArrays: () => {
      glDrawCalls++;
    },
    drawElementsInstanced: () => {
      glDrawCalls++;
    },
    drawArraysInstanced: () => {
      glDrawCalls++;
    },
    readPixels: (
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      _f: number,
      _t: number,
      out: Uint8Array,
    ) => {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 255;
    },
  };

  const gpuConfigurations: Array<Record<string, unknown>> = [];
  let unconfigured = 0;
  const webgpuCtx: GPUSceneCanvasContextLike = {
    configure(cfg) {
      gpuConfigurations.push(cfg as unknown as Record<string, unknown>);
    },
    unconfigure() {
      unconfigured++;
    },
    getCurrentTexture() {
      return {createView: () => ({canvasSwapView: true})};
    },
  };

  const glCanvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    tabIndex: -1,
    style: {} as Record<string, string>,
    parentElement: container as unknown,
    nextSibling: null as unknown,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width,
      height,
    }),
    getAttribute: () => null,
    setAttribute: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
    getContext: (kind: string) => (kind === 'webgl2' ? glContext : null),
    toDataURL: () => 'data:image/png;base64,RAW_GL',
    toBlob: (cb: (b: unknown) => void) => cb({kind: 'raw-gl-blob'}),
  };
  glContext['canvas'] = glCanvas;
  container.appendChild(glCanvas);

  let compositedDraws: unknown[] = [];
  const prevDoc = (globalThis as Record<string, unknown>)['document'];
  (globalThis as Record<string, unknown>)['document'] = {
    createElement(tag: string) {
      if (tag === 'canvas') {
        const c = {
          className: '',
          width: 1,
          height: 1,
          style: {cssText: '', display: 'block'},
          parentElement: null as unknown,
          remove() {
            const idx = children.indexOf(c);
            if (idx >= 0) children.splice(idx, 1);
            c.parentElement = null;
          },
          getContext(type: string) {
            if (type === 'webgpu') return webgpuCtx;
            if (type === '2d') {
              return {
                drawImage(img: unknown) {
                  compositedDraws.push(img);
                },
              };
            }
            return null;
          },
          toDataURL: () => 'data:image/png;base64,COMPOSITED_WEBGPU',
          toBlob: (cb: (b: unknown) => void) =>
            cb({kind: 'composited-webgpu-blob'}),
        };
        return c;
      }
      return {style: {}, appendChild: () => {}, setAttribute: () => {}};
    },
  };

  return {
    container: container as unknown as HTMLElement,
    glCanvas: glCanvas as unknown as HTMLCanvasElement,
    attrs,
    children,
    gpuConfigurations,
    getUnconfigured: () => unconfigured,
    getGlDrawCalls: () => glDrawCalls,
    resetGlDrawCalls: () => {
      glDrawCalls = 0;
    },
    getGlClears: () => glClears,
    getCompositedDraws: () => compositedDraws,
    resetCompositedDraws: () => {
      compositedDraws = [];
    },
    restoreGlobals: () => {
      if (prevDoc === undefined) {
        delete (globalThis as Record<string, unknown>)['document'];
      } else {
        (globalThis as Record<string, unknown>)['document'] = prevDoc;
      }
    },
  };
}

function buildMultiPartCadGLBData(partCount: number) {
  // Unit triangle per part so 5,000 parts stay fast and memory-light in Node.
  const triPos = new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]);
  const triNorm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const triIdx = new Uint16Array([0, 1, 2]); // 6 bytes -> pad to 8

  const bin = new ArrayBuffer(36 + 36 + 8);
  new Float32Array(bin, 0, 9).set(triPos);
  new Float32Array(bin, 36, 9).set(triNorm);
  new Uint16Array(bin, 72, 3).set(triIdx);

  const nodes = [];
  const meshes = [];
  const nodeIndices = [];
  for (let i = 0; i < partCount; i++) {
    nodes.push({
      name: `cad_part_${i}`,
      mesh: i,
      translation: [(i % 50) * 0.15, Math.floor(i / 50) * 0.15, 0],
    });
    meshes.push({
      name: `cad_part_${i}`,
      primitives: [
        {
          attributes: {POSITION: 0, NORMAL: 1},
          indices: 2,
          material: 0,
        },
      ],
    });
    nodeIndices.push(i);
  }

  return {
    gltf: {
      asset: {version: '2.0'},
      scene: 0,
      scenes: [{nodes: nodeIndices}],
      nodes,
      meshes,
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorFactor: [0.75, 0.78, 0.82, 1.0],
            metallicFactor: 0.85,
            roughnessFactor: 0.25,
          },
        },
      ],
      bufferViews: [
        {buffer: 0, byteOffset: 0, byteLength: 36},
        {buffer: 0, byteOffset: 36, byteLength: 36},
        {buffer: 0, byteOffset: 72, byteLength: 6},
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [0, 0, 0],
          max: [0.1, 0.1, 0],
        },
        {
          bufferView: 1,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
        },
        {
          bufferView: 2,
          componentType: 5123,
          count: 3,
          type: 'SCALAR',
        },
      ],
    },
    bin,
  };
}

async function runTests(): Promise<void> {
  let passed = 0;
  const test = async (name: string, fn: () => Promise<void> | void) => {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  };

  console.log('Running three-live-webgpu test suite...');

  await test('WGSL shaders satisfy W3C uniformity, Y-derivative flip, and struct layout invariants', () => {
    assert.strictEqual(SCENE_UNIFORM_BYTES, 464);
    assert.strictEqual(PART_STRIDE_BYTES, 128);
    assert.strictEqual(PART_STRIDE_WORDS, 32);
    assert.strictEqual(VERTEX_STRIDE_BYTES, 32);

    for (const code of [SCENE_PBR_WGSL, SCENE_SHADOW_WGSL, SCENE_PICK_WGSL]) {
      assert.ok(code.includes('struct SceneUniforms'));
      assert.ok(code.includes('struct PartInstance'));
      // `select` must never be invoked on matrix types in WGSL.
      assert.ok(!/select\s*\([^)]*mat[234]x[234]/.test(code));
    }

    const fsIdx = SCENE_PBR_WGSL.indexOf('fn fsMain');
    assert.ok(fsIdx > 0, 'fsMain entry point must exist');
    const fsBody = SCENE_PBR_WGSL.slice(fsIdx);
    const firstIf = fsBody.indexOf('if (');
    const firstDiscard = fsBody.indexOf('discard;');
    const firstBranch = Math.min(firstIf, firstDiscard);
    assert.ok(firstBranch > 0);

    // Every derivative (`dpdx`/`dpdy`) and implicit-LOD `textureSample(` must
    // execute unconditionally BEFORE the first branch/discard in `fsMain`.
    for (const op of ['dpdx(', 'dpdy(', 'textureSample(']) {
      let searchFrom = 0;
      let count = 0;
      while (true) {
        const at = fsBody.indexOf(op, searchFrom);
        if (at < 0) break;
        assert.ok(
          at < firstBranch,
          `${op} at offset ${at} must precede first non-uniform branch (${firstBranch})`,
        );
        count++;
        searchFrom = at + op.length;
      }
      assert.ok(count > 0, `expected ${op} in fsMain`);
    }

    // WebGPU framebuffer Y points downward: verify `-dpdy(...)` flips Y derivatives.
    assert.ok(fsBody.includes('let p2 = -dpdy(in.worldPos);'));
    assert.ok(fsBody.includes('let u2 = -dpdy(in.uv);'));
    // Mirrored CAD scale (`det < 0`) must preserve normal orientation via cofactor sign.
    assert.ok(SCENE_PBR_WGSL.includes('let adj0 = cross(c1, c2);'));
    assert.ok(
      SCENE_PBR_WGSL.includes('let sgn = select(-1.0, 1.0, det > 0.0);'),
    );
  });

  await test('remapClipDepthToZeroOne & writeSceneUniforms pack camera, lights, section plane, and contact shadow accurately', () => {
    const glProj = new Float32Array(16);
    const view = new Float32Array(16);
    const vp = new Float32Array(16);
    mat4Perspective(glProj, Math.PI / 4, 1.5, 0.1, 100);
    mat4LookAt(view, [0, 0, 5], [0, 0, 0], [0, 1, 0]);
    mat4Multiply(vp, glProj, view);

    const wgpuVp = remapClipDepthToZeroOne(new Float32Array(16), vp);
    const transformZ = (m: Float32Array, wz: number) => {
      const cz = m[2] * 0 + m[6] * 0 + m[10] * wz + m[14];
      const cw = m[3] * 0 + m[7] * 0 + m[11] * wz + m[15];
      return cz / cw;
    };
    // Eye at z=5 looking toward -Z: near plane is at world z = 4.9, far at z = -95.
    assert.ok(Math.abs(transformZ(vp, 4.9) - -1.0) < 1e-4);
    assert.ok(Math.abs(transformZ(wgpuVp, 4.9) - 0.0) < 1e-4);
    assert.ok(Math.abs(transformZ(vp, -95.0) - 1.0) < 1e-4);
    assert.ok(Math.abs(transformZ(wgpuVp, -95.0) - 1.0) < 1e-4);

    // Default synthetic directional light when no directional/hemisphere lights exist.
    const bufA = new ArrayBuffer(SCENE_UNIFORM_BYTES);
    writeSceneUniforms(bufA, {
      vp,
      modelRoot: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      eyePos: [1, 2, 3],
      exposure: Number.NaN,
      envIntensity: 1.5,
      toneMappingIndex: 3,
      lights: [],
      hasEnvMap: false,
    });
    const fA = new Float32Array(bufA);
    const uA = new Uint32Array(bufA);
    assert.strictEqual(fA[35], 1.0, 'NaN exposure falls back to 1.0');
    assert.strictEqual(fA[39], 1.5, 'envIntensity');
    assert.strictEqual(uA[112], 3, 'ACES tone-mapping index');
    assert.strictEqual(uA[113], 1, '1 synthetic directional light');
    assert.strictEqual(uA[114], 0, '0 point lights');
    assert.strictEqual(uA[115], 0, 'no scene flags');

    // Full light rig: ambient + hemisphere + 2 directional + point + spot + section + shadow.
    const bufB = new ArrayBuffer(SCENE_UNIFORM_BYTES);
    writeSceneUniforms(bufB, {
      vp,
      modelRoot: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      eyePos: [0, 2, 4],
      exposure: 1.25,
      envIntensity: 0.8,
      toneMappingIndex: 4,
      lights: [
        {type: 'ambient', color: [0.5, 0.4, 0.3], intensity: 2.0},
        {
          type: 'hemisphere',
          color: [0.8, 0.9, 1.0],
          groundColor: [0.2, 0.1, 0.05],
          position: [0, 2, 0],
          intensity: 1.0,
        },
        {
          type: 'directional',
          color: [1, 0.9, 0.8],
          direction: [0, 1, 0],
          intensity: 2.0,
        },
        {
          type: 'directional',
          color: [0.2, 0.3, 1.0],
          direction: [1, 0, 0],
          intensity: 0.5,
        },
        {type: 'point', color: [1, 0, 0], position: [1, 2, 3], intensity: 3},
        {
          type: 'spot',
          color: [0, 1, 0],
          position: [0, 5, 0],
          direction: [0, -2, 0],
          innerConeAngle: Math.PI / 6,
          outerConeAngle: Math.PI / 4,
          intensity: 4,
        },
      ],
      hasEnvMap: true,
      isRightEye: true,
      sectionPlane: {enabled: true, normal: [1, 0, 0], constant: 0.25},
      contactShadow: {
        centerX: 0.1,
        floorY: -0.5,
        centerZ: 0.2,
        halfExtentX: 1.4,
        halfExtentZ: 1.6,
        intensity: 0.65,
        softness: 0.4,
      },
    });
    const fB = new Float32Array(bufB);
    const uB = new Uint32Array(bufB);
    assert.ok(Math.abs(fB[36] - 1.0) < 1e-5, 'ambient R = 0.5 * 2');
    assert.strictEqual(fB[49], 1.0, 'normalized hemisphere +Y axis');
    assert.strictEqual(uB[113], 2, '2 directional lights');
    assert.strictEqual(uB[114], 2, '2 point/spot lights');
    assert.strictEqual(fB[68 + 12], -2, 'point light cosInner sentinel = -2');
    assert.ok(
      Math.abs(fB[84 + 12] - Math.cos(Math.PI / 6)) < 1e-5,
      'spot light cosInner',
    );
    assert.ok(
      Math.abs(fB[84 + 13] - Math.cos(Math.PI / 4)) < 1e-5,
      'spot light cosOuter',
    );
    assert.strictEqual(fB[100], 1, 'sectionPlane.x');
    assert.strictEqual(fB[103], 0.25, 'sectionPlane.w');
    assert.ok(Math.abs(fB[109] - 0.65) < 1e-5, 'contactShadow intensity');
    assert.strictEqual(
      uB[115],
      SCENE_FLAG_HAS_ENV_MAP |
        SCENE_FLAG_SECTION_ENABLED |
        SCENE_FLAG_RIGHT_EYE,
    );
  });

  await test('5,000-part CAD assembly compiles into 1 GPURenderBundle with 0 part uploads during orbit & turntable', () => {
    const harness = createMockHarness(800, 600);
    const gpu = createMockGPUDevice();
    setSceneWebGPUDeviceForTests(gpu.device, 'bgra8unorm');
    const accel = getWebGPUSceneAccelerator();
    const prevBundles = accel.bundleRecordCount;
    const prevFrames = accel.renderedFrames;

    try {
      harness.attrs.set('renderer', 'webgpu');
      const viewer = new ThreeView(harness.container, harness.glCanvas, {
        autoStart: false,
      });
      viewer.loadGLBData(buildMultiPartCadGLBData(5000));

      // `loadGLBData` triggers the initial `render()` synchronously!
      assert.strictEqual(
        harness.getGlDrawCalls(),
        0,
        'WebGL2 per-mesh draw loop must be bypassed completely (0 WebGL2 draws)',
      );
      assert.strictEqual(accel.renderedFrames - prevFrames, 1);
      assert.strictEqual(accel.bundleRecordCount - prevBundles, 1);
      assert.strictEqual(gpu.passes.length, 1);
      assert.strictEqual(gpu.passes[0].bundles.length, 1);

      // Inspect recorded GPURenderBundle: 5,000 drawIndexed calls, ONLY 1 `@group(1)` bind!
      const bundleOps = gpu.passes[0].bundles[0].ops;
      const drawOps = bundleOps.filter((op) => op.kind === 'drawIndexed');
      const matBindOps = bundleOps.filter(
        (op) => op.kind === 'bindGroup' && op.args[0] === 1,
      );
      assert.strictEqual(drawOps.length, 5000, 'all 5,000 CAD parts recorded');
      assert.strictEqual(
        matBindOps.length,
        1,
        'untextured 5,000-part CAD assembly binds @group(1) defaultMatBg once',
      );
      assert.strictEqual(
        drawOps[4999].args[4],
        4999,
        '5000th draw uses firstInstance = 4999',
      );

      // Simulate 5 frames of camera orbit + turntable rotation (`modelRootMatrix`).
      const writesBeforeOrbit = gpu.writes.length;
      for (let f = 1; f <= 5; f++) {
        viewer.setCamera(f * 15, 25, 10);
        viewer.resetTurntableRotation(f * 0.2); // updates modelRootMatrix + calls render()
      }
      const orbitWrites = gpu.writes.slice(writesBeforeOrbit);
      assert.strictEqual(
        orbitWrites.length,
        5,
        'each orbit/turntable frame performs ONLY 1 uniform write (0 storage writes)',
      );
      for (const w of orbitWrites) {
        assert.strictEqual(
          w.byteLength,
          SCENE_UNIFORM_BYTES,
          'only the 464B SceneUniforms buffer is written during orbit/turntable',
        );
      }
      assert.strictEqual(
        accel.bundleRecordCount - prevBundles,
        1,
        'GPURenderBundle is never re-recorded during orbit/turntable',
      );

      // Mutate a single part (#2500) in-place: only that single part's slice is uploaded!
      const writesBeforePartMove = gpu.writes.length;
      viewer.meshes[2500].transform[12] = 42.5;
      viewer.render();
      const partMoveWrites = gpu.writes.slice(writesBeforePartMove);
      assert.strictEqual(
        partMoveWrites.length,
        2,
        '1 dirty part slice write + 1 scene uniform write',
      );
      assert.ok(
        partMoveWrites[0].byteLength <= PART_STRIDE_BYTES,
        `expected <= 128B dirty upload for single-part transform edit, got ${partMoveWrites[0].byteLength}B`,
      );
      assert.strictEqual(
        accel.bundleRecordCount - prevBundles,
        1,
        'single-part transform edit does not re-record GPURenderBundle',
      );

      viewer.destroy();
      assert.strictEqual(harness.getUnconfigured(), 1);
    } finally {
      resetSceneWebGPUDevice();
      harness.restoreGlobals();
    }
  });

  await test('EXT_mesh_gpu_instancing + _COLOR_0, visibility flags, live alpha blend split, async texture upload, shadows, and section-plane', () => {
    const harness = createMockHarness(640, 480);
    const gpu = createMockGPUDevice();
    setSceneWebGPUDeviceForTests(gpu.device, 'bgra8unorm');

    try {
      harness.attrs.set('renderer', 'webgpu');
      harness.attrs.set('section-plane', 'x:0.5');
      const viewer = new ThreeView(harness.container, harness.glCanvas, {
        autoStart: false,
        shadowIntensity: 0.6,
        shadowSoftness: 0.5,
      });
      viewer.loadGLBData(buildMultiPartCadGLBData(2));

      // Attach 3 GPU instances + per-instance RGB colors to mesh[0].
      const instMats = new Float32Array(3 * 16);
      for (let i = 0; i < 3; i++) {
        instMats[i * 16] = 1;
        instMats[i * 16 + 5] = 1;
        instMats[i * 16 + 10] = 1;
        instMats[i * 16 + 12] = i * 2.0;
        instMats[i * 16 + 15] = 1;
      }
      viewer.meshes[0].instanceMatrices = instMats;
      viewer.meshes[0].instanceColors = new Float32Array([
        1, 0, 0, 0, 1, 0, 0, 0, 1,
      ]);

      // Hide mesh[1] (`lodPlugin` behavior) and add a world-space backdrop mesh.
      (viewer.meshes[1] as unknown as {visible: boolean}).visible = false;
      viewer.backdropMeshes.push({
        name: '__ground__',
        nodeIndex: -1,
        transform: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1,
        ]),
        normalMatrix: new Float32Array(9),
        primitives: [
          {
            ...viewer.meshes[0].primitives[0],
            baseColor: [0.2, 0.2, 0.2, 1.0],
          },
        ],
      } as unknown as (typeof viewer.meshes)[number]);

      viewer.render();
      const lastPass = gpu.passes[gpu.passes.length - 1];
      assert.strictEqual(lastPass.bundles.length, 1, 'opaque bundle');
      assert.strictEqual(
        lastPass.draws.length,
        1,
        'planar contact shadow draw (4-vertex strip)',
      );
      assert.deepStrictEqual(lastPass.draws[0], [4, 1, 0, 0]);

      // Verify PartInstance storage buffer contents:
      // Instance 0 = backdrop (`WORLD_SPACE | NO_SECTION_CLIP`)
      // Instances 1..3 = mesh[0] (`instanceCount = 3` tinted by `instanceColors`)
      // Instance 4 = mesh[1] (`PART_FLAG_HIDDEN`)
      const partStorageBuf = gpu.buffers.find(
        (b) => !b.destroyed && b.size === 5 * PART_STRIDE_BYTES,
      );
      assert.ok(
        partStorageBuf,
        '5 total part instances (1 backdrop + 3 inst + 1 hidden)',
      );
      const pU32 = new Uint32Array(
        partStorageBuf!.bytes.buffer,
        partStorageBuf!.bytes.byteOffset,
        5 * PART_STRIDE_WORDS,
      );
      const pF32 = new Float32Array(
        partStorageBuf!.bytes.buffer,
        partStorageBuf!.bytes.byteOffset,
        5 * PART_STRIDE_WORDS,
      );
      assert.strictEqual(
        pU32[30] & (PART_FLAG_WORLD_SPACE | PART_FLAG_NO_SECTION_CLIP),
        PART_FLAG_WORLD_SPACE | PART_FLAG_NO_SECTION_CLIP,
      );
      assert.strictEqual(pU32[31], 0, 'backdrop pickId === 0');
      assert.ok(
        pF32[1 * 32 + 16] > 0.7 && pF32[1 * 32 + 17] === 0,
        'inst 0 red tint',
      );
      assert.ok(
        pF32[2 * 32 + 17] > 0.7 && pF32[2 * 32 + 16] === 0,
        'inst 1 green tint',
      );
      assert.strictEqual(pU32[1 * 32 + 31], 1, 'mesh[0] pickId === 1');
      assert.ok(
        (pU32[4 * 32 + 30] & PART_FLAG_HIDDEN) !== 0,
        'hidden mesh[1] carries PART_FLAG_HIDDEN',
      );

      // Simulate async glTF texture decode + live alpha fade (`0.4` -> blendBundle!).
      const fakeTexHandle: Record<string, unknown> = {};
      viewer.meshes[0].primitives[0].texture =
        fakeTexHandle as unknown as WebGLTexture;
      viewer.meshes[0].primitives[0].baseColor = [1, 1, 1, 0.4];
      fakeTexHandle['__gpuImageSource'] = {width: 64, height: 64};

      viewer.render();
      assert.strictEqual(
        gpu.externalCopies.length,
        1,
        'decoded __gpuImageSource uploaded via copyExternalImageToTexture',
      );
      const blendPass = gpu.passes[gpu.passes.length - 1];
      assert.strictEqual(
        blendPass.bundles.length,
        2,
        'opaqueBundle + blendBundle both executed once mesh[0] becomes translucent',
      );
      assert.ok(
        (pU32[1 * 32 + 30] & PART_FLAG_HAS_BASE_TEX) !== 0,
        'PART_FLAG_HAS_BASE_TEX set after async texture upload',
      );

      viewer.destroy();
    } finally {
      resetSceneWebGPUDevice();
      harness.restoreGlobals();
    }
  });

  await test('stereoSBS preserves MSAA attachments across left/right eye passes & pickMeshGPU resolves 24-bit Color-ID safely under concurrency', async () => {
    const harness = createMockHarness(800, 400);
    // Encode meshId = 2 (meshIndex = 1): r=2, g=0, b=0, a=255
    const gpu = createMockGPUDevice({pickPixel: [2, 0, 0, 255]});
    setSceneWebGPUDeviceForTests(gpu.device, 'bgra8unorm');
    const accel = getWebGPUSceneAccelerator();

    try {
      harness.attrs.set('renderer', 'webgpu');
      const viewer = new ThreeView(harness.container, harness.glCanvas, {
        autoStart: false,
      });
      viewer.loadGLBData(buildMultiPartCadGLBData(3));

      const passesBeforeStereo = gpu.passes.length;
      viewer.setStereoSBS(true);
      const stereoPasses = gpu.passes.slice(passesBeforeStereo);
      assert.strictEqual(stereoPasses.length, 2, 'left + right eye passes');

      const leftAtt = (
        stereoPasses[0].descriptor['colorAttachments'] as Array<
          Record<string, unknown>
        >
      )[0];
      const rightAtt = (
        stereoPasses[1].descriptor['colorAttachments'] as Array<
          Record<string, unknown>
        >
      )[0];
      assert.strictEqual(leftAtt['loadOp'], 'clear');
      assert.strictEqual(
        leftAtt['storeOp'],
        'store',
        'left MSAA eye MUST store samples so right eye loadOp:load preserves left half',
      );
      assert.strictEqual(rightAtt['loadOp'], 'load');
      assert.strictEqual(rightAtt['storeOp'], 'store');
      assert.deepStrictEqual(
        stereoPasses[0].viewports[0],
        [0, 0, 400, 400, 0, 1],
      );
      assert.deepStrictEqual(
        stereoPasses[1].viewports[0],
        [400, 0, 400, 400, 0, 1],
      );

      // Concurrent `pickMeshGPU` calls must not collide on `mapAsync`!
      const [hitA, hitB] = await Promise.all([
        accel.pickMeshGPU(viewer, 200, 200),
        accel.pickMeshGPU(viewer, 600, 200),
      ]);
      assert.strictEqual(hitA, 1, 'decoded meshIndex = 1 (id = 2)');
      assert.strictEqual(hitB, 1, 'concurrent second pick succeeds cleanly');

      viewer.destroy();
    } finally {
      resetSceneWebGPUDevice();
      harness.restoreGlobals();
    }
  });

  await test('renderer="auto | webgpu | webgl2" fallback matrix, snapshot compositing, device.lost recovery, and shared device provider', async () => {
    const harness = createMockHarness(640, 480);
    const gpu1 = createMockGPUDevice();
    setSceneWebGPUDeviceForTests(gpu1.device, 'bgra8unorm');

    try {
      assert.strictEqual(normalizeRendererPreference(null), 'auto');
      assert.strictEqual(normalizeRendererPreference('WEBGPU'), 'webgpu');
      assert.strictEqual(normalizeRendererPreference('webgl2'), 'webgl2');
      assert.strictEqual(normalizeRendererPreference('invalid'), 'auto');

      const origToDataURL = harness.glCanvas.toDataURL;
      const viewer = new ThreeView(harness.container, harness.glCanvas, {
        autoStart: false,
      });
      viewer.loadGLBData(buildMultiPartCadGLBData(4));

      // Default `renderer="auto"` on a standard mesh scene uses WebGPU!
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgpu');
      assert.strictEqual(
        harness.glCanvas.toDataURL(),
        'data:image/png;base64,COMPOSITED_WEBGPU',
      );
      let blobResult: unknown = null;
      harness.glCanvas.toBlob((b) => {
        blobResult = b as unknown;
      });
      assert.deepStrictEqual(blobResult, {kind: 'composited-webgpu-blob'});

      // Auto-mode fallback triggers: bloom, outline, xrSessionActive, transmissive, renderer="webgl2".
      harness.attrs.set('bloom', '0.8');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgl2');
      viewer.render();
      assert.ok(harness.getGlDrawCalls() > 0, 'WebGL2 rendered bloom frame');
      assert.strictEqual(
        harness.glCanvas.toDataURL(),
        'data:image/png;base64,RAW_GL',
        'hidden WebGPU layer falls back to raw WebGL2 snapshot',
      );

      // Explicit `renderer="webgpu"` overrides `auto` heuristics (except active WebXR).
      harness.resetGlDrawCalls();
      harness.attrs.set('renderer', 'webgpu');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgpu');
      viewer.render();
      assert.strictEqual(harness.getGlDrawCalls(), 0);

      // Active WebXR session ALWAYS yields to WebGL2 (`XRWebGLLayer`).
      viewer.xrSessionActive = true;
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgl2');
      viewer.xrSessionActive = false;

      // Explicit `renderer="webgl2"` forces WebGL2.
      harness.attrs.set('renderer', 'webgl2');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgl2');
      harness.attrs.set('renderer', 'auto');
      harness.attrs.delete('bloom');

      // Simulate `GPUDevice.lost` and recovery onto a second `GPUDevice`!
      gpu1.triggerLost();
      await Promise.resolve();
      const gpu2 = createMockGPUDevice({disableMsaa: true}); // Also exercises sampleCount=1 fallback!
      setSceneWebGPUDeviceForTests(gpu2.device, 'rgba8unorm');
      viewer.render();
      assert.strictEqual(
        gpu2.passes.length,
        1,
        'recovered cleanly onto new GPUDevice with sampleCount=1 fallback',
      );

      // `clearScene()` hides layer; `destroy()` restores original `toDataURL`.
      viewer.clearScene();
      assert.strictEqual(
        harness.glCanvas.toDataURL(),
        'data:image/png;base64,RAW_GL',
      );
      viewer.destroy();
      assert.strictEqual(harness.glCanvas.toDataURL, origToDataURL);

      // Verify `SharedThreeLiveRegistry.webgpuDeviceProvider` reuse!
      resetSceneWebGPUDevice();
      const sharedMock = createMockGPUDevice();
      const reg = getSharedRegistry();
      const prevProvider = reg.webgpuDeviceProvider;
      reg.webgpuDeviceProvider = {
        acquireDevice: async () => sharedMock.device,
        peekDevice: () => sharedMock.device,
        getCanvasFormat: () => 'rgba8unorm',
      };
      try {
        const acquired = await acquireSceneWebGPUDevice();
        assert.strictEqual(acquired, sharedMock.device);
      } finally {
        reg.webgpuDeviceProvider = prevProvider;
      }

      // Verify `ThreeLiveElement.observedAttributes` & property reflection for `renderer`.
      assert.ok(ThreeLiveElement.observedAttributes.includes('renderer'));
      assert.strictEqual(webgpuScenePlugin.name, 'three-live-webgpu-scene');
    } finally {
      resetSceneWebGPUDevice();
      harness.restoreGlobals();
    }
  });

  await test('audit edge cases: boolean bloom/outline attrs, IBL __gpuImageSource, pickUniformBuf isolation, gizmo section plane, billboards, non-indexed draw, and stale async device safety', async () => {
    const harness = createMockHarness(640, 480);
    const gpu = createMockGPUDevice({pickPixel: [1, 0, 0, 255]});
    setSceneWebGPUDeviceForTests(gpu.device, 'bgra8unorm');
    const accel = getWebGPUSceneAccelerator();

    try {
      const viewer = new ThreeView(harness.container, harness.glCanvas, {
        autoStart: false,
      });
      viewer.loadGLBData(buildMultiPartCadGLBData(2));

      // 1. Boolean `<three-live bloom>` ("") and `<three-live outline>` ("") trigger WebGL2 fallback,
      // while `bloom="0"` and `outline="0"` stay on WebGPU.
      harness.attrs.set('bloom', '');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgl2');
      harness.attrs.set('bloom', '0');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgpu');
      harness.attrs.delete('bloom');

      harness.attrs.set('outline', '');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgl2');
      harness.attrs.set('outline', '0');
      assert.strictEqual(resolveSceneRenderBackend(viewer, true), 'webgpu');
      harness.attrs.delete('outline');

      // 2. Non-indexed primitive + `billboard: 'y'` + `billboard: true` + `selectedMeshName`
      // + interactive `__xr_section_gizmo__` + `environmentTexture.__gpuImageSource` IBL!
      viewer.meshes[0].primitives[0].indices = null;
      viewer.meshes[0].extras = {xr: {billboard: 'y'}};
      viewer.meshes[1].extras = {xr: {billboard: true}};
      viewer.selectedMeshName = viewer.meshes[0].name;
      viewer.environmentSource = null;
      const envTexHandle = {__gpuImageSource: {width: 32, height: 16}};
      viewer.environmentTexture = envTexHandle as unknown as WebGLTexture;

      const gizmoWorld = new Float32Array([
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0, // world normal +Z
        0,
        0,
        0.75,
        1, // plane origin (0, 0, 0.75) -> constant = 0.75
      ]);
      viewer.meshes.push({
        name: '__xr_section_gizmo__',
        nodeIndex: -1,
        isPluginMesh: true,
        worldMatrix: gizmoWorld,
        transform: new Float32Array([
          1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
        ]),
        normalMatrix: new Float32Array(9),
        primitives: [],
      } as unknown as (typeof viewer.meshes)[number]);

      const extCopiesBefore = gpu.externalCopies.length;
      viewer.render();
      assert.strictEqual(
        gpu.externalCopies.length - extCopiesBefore,
        1,
        'IBL environmentTexture.__gpuImageSource uploaded to WebGPU',
      );
      const lastPass = gpu.passes[gpu.passes.length - 1];
      const nonIndexedDraws = lastPass.bundles[0].ops.filter(
        (op) => op.kind === 'draw',
      );
      assert.strictEqual(
        nonIndexedDraws.length,
        1,
        'non-indexed primitive recorded via bundle.draw()',
      );

      // Verify render SceneUniforms buffer has HAS_ENV_MAP + SECTION_ENABLED (constant = 0.75),
      // and verify `pickMeshGPU` writes to `pickUniformBuf` WITHOUT mutating `scene.uniformBuf`!
      const renderUniformWrite = gpu.writes[gpu.writes.length - 1];
      assert.strictEqual(renderUniformWrite.byteLength, SCENE_UNIFORM_BYTES);
      const renderUniformBuf = renderUniformWrite.buffer;
      const beforePickBytes = renderUniformBuf.bytes.slice();
      const rF32 = new Float32Array(
        beforePickBytes.buffer,
        beforePickBytes.byteOffset,
        116,
      );
      const rU32 = new Uint32Array(
        beforePickBytes.buffer,
        beforePickBytes.byteOffset,
        116,
      );
      assert.strictEqual(
        rU32[115] & (SCENE_FLAG_HAS_ENV_MAP | SCENE_FLAG_SECTION_ENABLED),
        SCENE_FLAG_HAS_ENV_MAP | SCENE_FLAG_SECTION_ENABLED,
      );
      assert.ok(
        Math.abs(rF32[103] - 0.75) < 1e-5,
        'gizmo section constant = 0.75',
      );

      const picked = await accel.pickMeshGPU(viewer, 320, 240);
      assert.strictEqual(picked, 0);
      assert.deepStrictEqual(
        renderUniformBuf.bytes,
        beforePickBytes,
        'pickMeshGPU must isolate pickUniformBuf and never overwrite render scene.uniformBuf',
      );

      viewer.destroy();

      // 3. Stale async `acquireSceneWebGPUDevice()` resolving AFTER `viewer.destroy()`
      // must NOT call `render()` on the disposed viewer.
      resetSceneWebGPUDevice();
      let resolveAdapter!: (v: unknown) => void;
      const prevNavDesc = Object.getOwnPropertyDescriptor(
        globalThis,
        'navigator',
      );
      const reg = getSharedRegistry();
      const prevProvider = reg.webgpuDeviceProvider;
      reg.webgpuDeviceProvider = undefined;
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        writable: true,
        value: {
          gpu: {
            getPreferredCanvasFormat: () => 'bgra8unorm',
            requestAdapter: () =>
              new Promise((res) => {
                resolveAdapter = res;
              }),
          },
        },
      });
      try {
        const v2 = new ThreeView(harness.container, harness.glCanvas, {
          autoStart: false,
        });
        v2.loadGLBData(buildMultiPartCadGLBData(1));
        let postDestroyRenderCalls = 0;
        const origRender = v2.render.bind(v2);
        v2.render = () => {
          postDestroyRenderCalls++;
          origRender();
        };
        v2.destroy();
        assert.strictEqual(typeof resolveAdapter, 'function');
        resolveAdapter({
          limits: {},
          requestDevice: async () => gpu.device,
        });
        await new Promise((r) => setTimeout(r, 0));
        assert.strictEqual(
          postDestroyRenderCalls,
          0,
          'disposed viewer must not be re-rendered when late GPUDevice resolves',
        );
      } finally {
        reg.webgpuDeviceProvider = prevProvider;
        if (prevNavDesc) {
          Object.defineProperty(globalThis, 'navigator', prevNavDesc);
        } else {
          delete (globalThis as Record<string, unknown>)['navigator'];
        }
      }
    } finally {
      resetSceneWebGPUDevice();
      harness.restoreGlobals();
    }
  });

  console.log(`All ${passed} three-live-webgpu test suites passed!`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
