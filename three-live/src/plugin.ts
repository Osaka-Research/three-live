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
 * @fileoverview Unified Plugin Architecture for Three-Live.
 * Provides extensible hooks across lifecycle, glTF parsing, shaders, and rendering.
 */

export interface ThreeLivePlugin {
  readonly name: string;
  onRegister?(): void;
  onElementConnected?(element: any): void;
  onAttributeChanged?(
    element: any,
    name: string,
    oldVal: string | null,
    newVal: string | null,
  ): void;
  onCameraChange?(viewer: any, element?: any): void;
  onElementDisconnected?(element: any): void;
  onParseGLB?(glbData: any): void;
  onLoadModel?(viewer: any, gltf: any): void;
  onMeshSelect?(viewer: any, hit: any): void;
  onResolveShader?(
    primitiveDef: any,
    materialDef: any,
    defaultVS: string,
    defaultFS: string,
  ): {vs: string; fs: string} | null;
  onBuildPrimitiveVAO?(
    gl: WebGL2RenderingContext,
    vao: WebGLVertexArrayObject,
    primitiveDef: any,
    gltf: any,
    bin: ArrayBuffer,
  ): any;
  onUpdate?(viewer: any, dt: number): void;
  onBeforeDrawPrimitive?(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    primitiveGpu: any,
    meshGpu: any,
    nodeWorldMatrices: Float32Array[],
    gltf: any,
  ): void;
  onBeforeTransmissivePass?(gl: WebGL2RenderingContext, viewer: unknown): void;
  onAfterRender?(
    gl: WebGL2RenderingContext,
    viewer: any,
    vpMatrix: Float32Array,
    eye?: 'left' | 'right' | 'none',
    viewport?: readonly number[],
    projection?: Float32Array,
  ): void;
  onBeforeDrawScene?(
    viewer: any,
    gl: WebGL2RenderingContext,
    vpMatrix: Float32Array,
    cameraPos: [number, number, number],
    toneMappingMode: number,
  ): void;
  setSkyboxImage?(
    viewer: any,
    imageOrUrl: string | HTMLImageElement | ImageBitmap | null,
  ): Promise<void>;
  onConfigureXRSessionInit?(element: any, sessionInit: any): void;
  onXRFrame?(
    viewer: unknown,
    session: unknown,
    frame: unknown,
    refSpace: unknown,
  ): void;
  onXRSessionEnd?(viewer: unknown): void;
  /**
   * Called after a lost WebGL context is restored (`webglcontextrestored`), so
   * plugins drop GL objects cached for `gl`, which are no longer valid.
   */
  // tslint:disable-next-line:no-any
  onContextRestored?(gl: WebGL2RenderingContext, viewer: any): void;
  onDestroy?(gl: WebGL2RenderingContext, viewer: any): void;
}

/**
 * Local-space Y of the `<xr-live>` scene that `WebXRSessionManager` pins to
 * the detected AR surface. AR physics floors, table anchors, and contact
 * shadows must all use this same height so objects rest on the real surface.
 */
export const XR_LIVE_AR_SURFACE_Y = -0.25;

/** WebXR depth-occlusion chunk spliced into `ThreeView`'s render shader. */
export interface XRDepthShaderChunk {
  /** GLSL uniform declarations replacing the `XRD_U` placeholder. */
  uniformsGLSL: string;
  /** GLSL occlusion block (may scale `outAlpha` or discard). */
  occlusionGLSL: string;
  /** Uniform names to resolve on render programs. */
  uniformNames: readonly string[];
  /** Binds per-draw depth uniforms and textures. */
  bind(
    gl: WebGL2RenderingContext,
    u: Record<string, WebGLUniformLocation | null>,
    depthState: any,
    viewMatrix: Float32Array,
    viewport: [number, number, number, number],
  ): void;
}

export interface SharedThreeLiveRegistry {
  plugins: ThreeLivePlugin[];
  decoders: Map<string, any>;
  arProvider?: any;
  scriptRunner?: any;
  xrExtrasProvider?: any;
  xrSceneConverter?: any;
  /**
   * WebXR depth-occlusion shader chunk installed by `xr-depth-shader.ts`.
   * `ThreeView` splices it into its render program only when present, so the
   * lean viewer bundle carries no XR depth code.
   */
  xrDepthShader?: XRDepthShaderChunk;
  /**
   * Canonical `userData.xr` serializer (`xr-trait-schema.ts`). When present,
   * GLB/USDZ exports emit fully normalized spatial traits.
   */
  xrTraitSerializer?: import('./xr-trait-schema').XRTraitSerializer;
  /**
   * URL of the Three-Live IIFE bundle the worker sandbox loads to obtain THREE.
   * Lives on the shared registry so the lean element bundle can set it without
   * taking a dependency on three-author.
   */
  sandboxEngineSrc?: string | null;
  /**
   * URL of `three-live-sandbox.html` used when executing procedural scripts in
   * `'iframe'` sandbox mode (`<iframe sandbox="allow-scripts">`).
   */
  sandboxIframeSrc?: string | null;
  /**
   * Explicit opt-in flag allowing client-modified Three.js script strings
   * (Use Case 1: `executeScript(code)` and inline `<script type="text/three-live">`).
   * Defaults to `false` so only server-generated script URLs (`script-src`) are
   * permitted unless explicitly enabled.
   */
  allowClientScripts?: boolean;
  /** Reference to the host `THREE` namespace installed by `three-author.ts`. */
  threeNamespace?: unknown;
  /**
   * Optional authoring constructors (`Path`, `Shape`, `ShapeGeometry`,
   * `ExtrudeGeometry`, `TextGeometry`, `CSG`, `IKSolver`) registered by
   * `cadPlugin` and `ikPlugin` and exposed on `THREE`.
   */
  authorNamespace?: Record<string, unknown>;
  /**
   * Hook invoked before world-matrix and GLB/USDZ serialization to materialize
   * declarative `userData.xr.text` and `userData.csg` meshes when `cadPlugin`
   * is loaded.
   */
  materializeDeclarativeGeometry?: (node: unknown) => void;
  /**
   * Self-contained worker bootstrap functions `(THREE, reg) => void` serialized
   * into `buildSandboxWorkerSource` so Web Worker sandboxes install optional
   * authoring extensions (`cadPlugin`, `ikPlugin`).
   */
  workerExtensionInstallers?: Array<(threeNs: unknown, reg: unknown) => void>;
}

const SHARED_REGISTRY_KEY = '__THREE_LIVE_REGISTRY__';

export function getSharedRegistry(): SharedThreeLiveRegistry {
  const g = (typeof globalThis !== 'undefined' ? globalThis : {}) as Record<
    string,
    unknown
  >;
  if (!g[SHARED_REGISTRY_KEY]) {
    const registry: SharedThreeLiveRegistry = {
      plugins: [],
      decoders: new Map<string, unknown>(),
    };
    try {
      Object.defineProperty(g, SHARED_REGISTRY_KEY, {
        value: registry,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch {
      g[SHARED_REGISTRY_KEY] = registry;
    }
  }
  return g[SHARED_REGISTRY_KEY] as SharedThreeLiveRegistry;
}

export const registeredPlugins: ThreeLivePlugin[] = getSharedRegistry().plugins;

/**
 * Registers a self-contained installer function that extends `THREE` and the
 * shared registry both on the host thread and inside isolated Web Worker
 * sandboxes.
 */
export function registerWorkerExtensionInstaller(
  installer: (threeNs: unknown, reg: unknown) => void,
): void {
  const reg = getSharedRegistry();
  if (!reg.workerExtensionInstallers) {
    reg.workerExtensionInstallers = [];
  }
  if (!reg.workerExtensionInstallers.includes(installer)) {
    reg.workerExtensionInstallers.push(installer);
  }
}

export function registerPlugin(plugin: ThreeLivePlugin): void {
  const plugins = getSharedRegistry().plugins;
  if (!plugins.some((p) => p.name === plugin.name)) {
    plugins.push(plugin);
  }
  plugin.onRegister?.();
}

export function getRegisteredPlugins(): readonly ThreeLivePlugin[] {
  return getSharedRegistry().plugins;
}
