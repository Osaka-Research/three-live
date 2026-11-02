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
 * @fileoverview Universal 3D format conversion module for Three-Live.
 * Provides decoupled transcoding between Three.js Scene graphs, binary glTF 2.0 (GLB),
 * and Apple Universal Scene Description (USDZ with 64-byte alignment).
 */

import {compileInteractivityGraph} from './interactivity-compiler';
import {getSharedRegistry} from './plugin';
import type {
  Light,
  LightGpu,
  Material,
  Mesh,
  Object3D,
  Scene,
} from './three-author';
import {
  mat3NormalFromMat4,
  mat4Create,
  resolveNodeWorldMatrices,
  toGLBData,
  type GLBData,
} from './three-view';

declare const ENABLE_NATIVE_HOOKS: boolean;

// =========================================================================
// 1. Data Types & Interfaces
// =========================================================================

export interface XRMeshTraits {
  grab?: boolean | '1-hand' | '2-hand';
  scale?: boolean | {min?: number; max?: number};
  billboard?: boolean | 'capsule' | 'cylindrical' | 'spherical';
  follow?:
    | 'head'
    | 'hand-left'
    | 'hand-right'
    | string
    | {
        mode?: 'head' | 'hand-left' | 'hand-right';
        distance?: number;
        deadzoneDeg?: number;
        stiffness?: number;
        height?: number;
        faceUser?: boolean;
        snapOnStart?: boolean;
      };
  anchor?: 'horizontal' | 'vertical' | 'floor' | 'wall' | 'table';
  physics?: 'dynamic' | 'static' | 'none';
  stereo?: 'sbs' | 'ou' | 'mono';
  audio?: string | {src: string; refDistance?: number; loop?: boolean};
  pointerEvents?: 'auto' | 'none';
  /** Spatial `Orbit`: circles a point, the head, or a named mesh. */
  orbit?: {
    target?: [number, number, number] | 'head' | string;
    radius?: number;
    speed?: number;
    height?: number;
    phase?: number;
    faceCenter?: boolean;
  };
  /** Spatial manipulation handles (corner scale + pedestal yaw bar). */
  handles?:
    | boolean
    | {rotateAxis?: 'y' | 'none'; minScale?: number; maxScale?: number};
  /** Depth-colliding particle emitter. */
  particles?: {
    preset?: 'rain' | 'snow' | 'sparks' | 'confetti';
    count?: number;
    area?: number | [number, number, number];
    speed?: number;
  };
  /** Press-and-hold "ask Gemini about this object". */
  holdToAsk?: boolean | {prompt?: string; holdMs?: number};
  /** World understanding (planes, meshes, reticle, detection). */
  worldUnderstanding?: {
    planes?: boolean;
    meshes?: boolean;
    reticle?: boolean;
    objects?: boolean;
  };
  /** URL of a `.splat` / `.spz` Gaussian splat rendered at this node. */
  splatUrl?: string;
  /** Id of a `<div slot="spatial">` card anchored to this node. */
  spatialSlot?: string;
  [key: string]: any;
}

export interface USDAMeshTimeSamples {
  times: number[];
  translations?: Array<[number, number, number]>;
  rotations?: Array<[number, number, number, number]>;
  scales?: Array<[number, number, number]>;
}

export interface USDAMeshData {
  name: string;
  positions: Float32Array;
  indices: Uint16Array | Uint32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  materialName?: string;
  color?: [number, number, number];
  roughness?: number;
  metallic?: number;
  clearcoat?: number;
  clearcoatRoughness?: number;
  ior?: number;
  opacity?: number;
  emissiveColor?: [number, number, number];
  xrTraits?: XRMeshTraits;
  timeSamples?: USDAMeshTimeSamples;
}

export interface ZipEntry {
  filename: string;
  data: Uint8Array;
}

export type SceneOrGLBSource = Scene | GLBData | ArrayBuffer | ArrayBufferView;

// =========================================================================
// 2. GLB Serialization (Three.js Scene -> glTF 2.0 / GLB)
// =========================================================================

function align4(n: number): number {
  return (n + 3) & ~3;
}

function buildSceneCoreExtension(xr: XRMeshTraits): Record<string, any> {
  const comp: Record<string, any> = {};
  if (xr.grab) {
    comp.interactable = {
      mode: typeof xr.grab === 'string' ? xr.grab : '2-hand',
    };
    comp.movable = {
      scaleInZ: Boolean(xr.scale),
      minScale: typeof xr.scale === 'object' ? (xr.scale.min ?? 0.1) : 0.1,
      maxScale: typeof xr.scale === 'object' ? (xr.scale.max ?? 10.0) : 10.0,
    };
  }
  if (xr.billboard) {
    comp.billboard = {
      mode: typeof xr.billboard === 'string' ? xr.billboard : 'capsule',
    };
  }
  if (xr.follow) {
    comp.follow = {
      target: typeof xr.follow === 'object' ? (xr.follow.mode ?? 'head') : xr.follow,
    };
  }
  if (xr.anchor) {
    comp.anchor = {plane: xr.anchor};
  }
  if (xr.physics && xr.physics !== 'none') {
    comp.rigidbody = {type: xr.physics};
  }
  return comp;
}

export {compileInteractivityGraph};

/**
 * Serializes a Three.js Scene into in-memory GLBData ({ gltf, bin }) for WebGL2 rendering.
 * Automatically preserves `userData.xr` traits in `node.extras.xr` and bakes `animate(time)`
 * callbacks into standard glTF 2.0 animation tracks when present.
 */
export function sceneToCanvas3D(
  scene: Scene,
  options?: {
    animateFn?: (time: number) => void;
    duration?: number;
    fps?: number;
  },
): GLBData {
  scene.updateMatrixWorld(true);
  const buffers: Uint8Array[] = [];
  let byteOffset = 0;
  const bufferViews: any[] = [];
  const accessors: any[] = [];
  const meshes: any[] = [];
  const nodes: any[] = [];
  const nodeExtensionsUsed = new Set<string>();
  const nodeObjects: Object3D[] = [];
  const materials: any[] = [];
  const matMap = new Map<Material, number>();
  const lights: LightGpu[] = [];

  function addBufferData(typedArray: ArrayBufferView, target: number): number {
    const bytes = new Uint8Array(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength,
    );
    const paddedLength = align4(bytes.byteLength);
    const paddedBytes = new Uint8Array(paddedLength);
    paddedBytes.set(bytes);
    buffers.push(paddedBytes);

    const bvIndex = bufferViews.length;
    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      target,
    });
    byteOffset += paddedLength;
    return bvIndex;
  }

  function addAccessor(
    typedArray: ArrayBufferView,
    type: string,
    target: number,
    componentType: number,
    count: number,
    min?: number[],
    max?: number[],
  ): number {
    const bvIdx = addBufferData(typedArray, target);
    const accIdx = accessors.length;
    const acc: any = {
      bufferView: bvIdx,
      byteOffset: 0,
      componentType,
      count,
      type,
    };
    if (min) acc.min = min;
    if (max) acc.max = max;
    accessors.push(acc);
    return accIdx;
  }

  scene.traverse((node) => {
    if (
      (node as any).isLight ||
      ((node as any).color && (node as any).intensity !== undefined)
    ) {
      lights.push({
        type: node.type,
        color: [node.color.r, node.color.g, node.color.b],
        intensity: node.intensity,
        position: [node.position.x, node.position.y, node.position.z],
      });
    }
  });

  const rootNodeIndices: number[] = [];

  function processNode(obj: Object3D): number {
    const node: any = {name: obj.name || ''};
    const pos = obj.position,
      rot = obj.quaternion,
      scl = obj.scale;
    if (pos.x || pos.y || pos.z) node.translation = [pos.x, pos.y, pos.z];
    if (rot.x || rot.y || rot.z || rot.w !== 1)
      node.rotation = [rot.x, rot.y, rot.z, rot.w];
    if (scl.x !== 1 || scl.y !== 1 || scl.z !== 1)
      node.scale = [scl.x, scl.y, scl.z];

    if (obj.userData && Object.keys(obj.userData).length > 0) {
      node.extras = JSON.parse(
        JSON.stringify(obj.userData, (k, v) => {
          if (k === '__proto__' || k === 'prototype' || k === 'constructor') {
            return undefined;
          }
          return typeof v === 'function' ? undefined : v;
        }),
      );
      if (obj.userData.xr) {
        const sceneCoreExt = buildSceneCoreExtension(obj.userData.xr);
        node.extensions = {
          ...(node.extensions || {}),
          MOZ_hubs_components: sceneCoreExt,
          ANDROID_xr_scenecore: sceneCoreExt,
        };
        // The canonical serializer (spatial plugins bundle / compiler engine) upgrades
        // `extras.xr` and `ANDROID_xr_scenecore` to the normalized trait set.
        getSharedRegistry().xrTraitSerializer?.gltfNode(node, obj.userData.xr);
        nodeExtensionsUsed.add('MOZ_hubs_components').add('ANDROID_xr_scenecore');
      }
    }

    if ((obj as any).geometry) {
      const geo = (obj as any).geometry;
      const posAttr = geo.attributes.position;
      if (posAttr && posAttr.count > 0) {
        let min = [Infinity, Infinity, Infinity],
          max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < posAttr.count; i++) {
          const x = posAttr.getX(i),
            y = posAttr.getY(i),
            z = posAttr.getZ(i);
          if (x < min[0]) min[0] = x;
          if (x > max[0]) max[0] = x;
          if (y < min[1]) min[1] = y;
          if (y > max[1]) max[1] = y;
          if (z < min[2]) min[2] = z;
          if (z > max[2]) max[2] = z;
        }

        const posAcc = addAccessor(
          posAttr.array,
          'VEC3',
          34962,
          5126,
          posAttr.count,
          min,
          max,
        );
        const primitive: any = {attributes: {POSITION: posAcc}};

        if (geo.attributes.normal) {
          primitive.attributes.NORMAL = addAccessor(
            geo.attributes.normal.array,
            'VEC3',
            34962,
            5126,
            geo.attributes.normal.count,
          );
        }
        if (geo.attributes.uv) {
          primitive.attributes.TEXCOORD_0 = addAccessor(
            geo.attributes.uv.array,
            'VEC2',
            34962,
            5126,
            geo.attributes.uv.count,
          );
        }
        if (geo.index) {
          const isU32 = geo.index.array instanceof Uint32Array;
          primitive.indices = addAccessor(
            geo.index.array,
            'SCALAR',
            34963,
            isU32 ? 5125 : 5123,
            geo.index.count,
          );
        }

        if (obj.material) {
          let matIdx = matMap.get(obj.material);
          if (matIdx === undefined) {
            matIdx = materials.length;
            matMap.set(obj.material, matIdx);
            const m = obj.material as any;
            const matDef: any = {
              name: m.name || '',
              pbrMetallicRoughness: {
                baseColorFactor: [m.color.r, m.color.g, m.color.b, m.opacity],
                metallicFactor: m.metalness,
                roughnessFactor: m.roughness,
              },
              doubleSided: m.side === 2 || m.doubleSided,
            };
            if (
              m.emissive &&
              (m.emissive.r > 0 || m.emissive.g > 0 || m.emissive.b > 0)
            ) {
              const ei = m.emissiveIntensity ?? 1.0;
              matDef.emissiveFactor = [
                m.emissive.r * ei,
                m.emissive.g * ei,
                m.emissive.b * ei,
              ];
            }
            const ext: Record<string, any> = {};
            if (m.clearcoat > 0) {
              ext.KHR_materials_clearcoat = {
                clearcoatFactor: m.clearcoat,
                clearcoatRoughnessFactor: m.clearcoatRoughness || 0,
              };
            }
            if (m.sheen > 0) {
              ext.KHR_materials_sheen = {
                sheenColorFactor: m.sheenColor
                  ? [m.sheenColor.r, m.sheenColor.g, m.sheenColor.b]
                  : [1, 1, 1],
                sheenRoughnessFactor: m.sheenRoughness || 0,
              };
            }
            if (m.transmission > 0) {
              ext.KHR_materials_transmission = {
                transmissionFactor: m.transmission,
              };
            }
            if (m.thickness > 0) {
              ext.KHR_materials_volume = {
                thicknessFactor: m.thickness,
                attenuationDistance: m.attenuationDistance ?? Infinity,
                attenuationColor: m.attenuationColor
                  ? [
                      m.attenuationColor.r,
                      m.attenuationColor.g,
                      m.attenuationColor.b,
                    ]
                  : [1, 1, 1],
              };
            }
            if (m.ior !== undefined && m.ior !== 1.5) {
              ext.KHR_materials_ior = {ior: m.ior};
            }
            if (m.dispersion > 0) {
              ext.KHR_materials_dispersion = {dispersion: m.dispersion};
            }
            if (m.iridescence > 0) {
              ext.KHR_materials_iridescence = {
                iridescenceFactor: m.iridescence,
                iridescenceIor: m.iridescenceIOR ?? 1.3,
              };
            }
            if (Object.keys(ext).length > 0) {
              matDef.extensions = ext;
            }
            materials.push(matDef);
          }
          primitive.material = matIdx;
        }

        const meshIdx = meshes.length;
        meshes.push({
          primitives: [primitive],
          name: obj.name,
          ...(node.extras ? {extras: node.extras} : {}),
        });
        node.mesh = meshIdx;
      }
    }

    const nodeIdx = nodes.length;
    nodes.push(node);
    nodeObjects.push(obj);

    if (obj.children.length > 0) {
      node.children = [];
      for (const child of obj.children) {
        node.children.push(processNode(child));
      }
    }
    return nodeIdx;
  }

  for (const child of scene.children) {
    rootNodeIndices.push(processNode(child));
  }

  // Auto-bake procedural animate(time) function if provided on options, scene.userData, or globalThis
  const animateFn =
    (options as any)?.animateCallback ||
    options?.animateFn ||
    (typeof (scene as any).userData?.animate === 'function'
      ? (scene as any).userData.animate
      : typeof (scene as any).__animateFn === 'function'
        ? (scene as any).__animateFn
        : typeof (globalThis as any).animate === 'function'
          ? (globalThis as any).animate
          : undefined);

  const gltfAnimations: any[] = [];
  if (typeof animateFn === 'function' && nodeObjects.length > 0) {
    const duration = options?.duration ?? 4.0;
    const fps = options?.fps ?? 15;
    const numSteps = Math.max(2, Math.round(duration * fps) + 1);
    const times = new Float32Array(numSteps);

    const saved = nodeObjects.map((o) => ({
      px: o.position.x,
      py: o.position.y,
      pz: o.position.z,
      qx: o.quaternion.x,
      qy: o.quaternion.y,
      qz: o.quaternion.z,
      qw: o.quaternion.w,
      sx: o.scale.x,
      sy: o.scale.y,
      sz: o.scale.z,
    }));

    const posTracks = nodeObjects.map(() => new Float32Array(numSteps * 3));
    const rotTracks = nodeObjects.map(() => new Float32Array(numSteps * 4));
    const sclTracks = nodeObjects.map(() => new Float32Array(numSteps * 3));

    for (let step = 0; step < numSteps; step++) {
      const t = (step / (numSteps - 1)) * duration;
      times[step] = t;
      try {
        animateFn(t);
      } catch (_) {}
      for (let i = 0; i < nodeObjects.length; i++) {
        const o = nodeObjects[i];
        posTracks[i][step * 3] = o.position.x;
        posTracks[i][step * 3 + 1] = o.position.y;
        posTracks[i][step * 3 + 2] = o.position.z;
        rotTracks[i][step * 4] = o.quaternion.x;
        rotTracks[i][step * 4 + 1] = o.quaternion.y;
        rotTracks[i][step * 4 + 2] = o.quaternion.z;
        rotTracks[i][step * 4 + 3] = o.quaternion.w;
        sclTracks[i][step * 3] = o.scale.x;
        sclTracks[i][step * 3 + 1] = o.scale.y;
        sclTracks[i][step * 3 + 2] = o.scale.z;
      }
    }

    // Restore original node transforms
    for (let i = 0; i < nodeObjects.length; i++) {
      const o = nodeObjects[i];
      const s = saved[i];
      o.position.set(s.px, s.py, s.pz);
      o.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      o.scale.set(s.sx, s.sy, s.sz);
    }
    scene.updateMatrixWorld(true);

    let timeAccIdx: number | null = null;
    const ensureTimeAccessor = (): number => {
      if (timeAccIdx === null) {
        timeAccIdx = addAccessor(
          times,
          'SCALAR',
          0,
          5126,
          numSteps,
          [0],
          [duration],
        );
      }
      return timeAccIdx;
    };

    const samplers: any[] = [];
    const channels: any[] = [];

    for (let i = 0; i < nodeObjects.length; i++) {
      const s = saved[i];
      let posChanged = false;
      let rotChanged = false;
      let sclChanged = false;
      for (let step = 0; step < numSteps; step++) {
        if (
          Math.abs(posTracks[i][step * 3] - s.px) > 1e-4 ||
          Math.abs(posTracks[i][step * 3 + 1] - s.py) > 1e-4 ||
          Math.abs(posTracks[i][step * 3 + 2] - s.pz) > 1e-4
        ) {
          posChanged = true;
        }
        if (
          Math.abs(rotTracks[i][step * 4] - s.qx) > 1e-4 ||
          Math.abs(rotTracks[i][step * 4 + 1] - s.qy) > 1e-4 ||
          Math.abs(rotTracks[i][step * 4 + 2] - s.qz) > 1e-4 ||
          Math.abs(rotTracks[i][step * 4 + 3] - s.qw) > 1e-4
        ) {
          rotChanged = true;
        }
        if (
          Math.abs(sclTracks[i][step * 3] - s.sx) > 1e-4 ||
          Math.abs(sclTracks[i][step * 3 + 1] - s.sy) > 1e-4 ||
          Math.abs(sclTracks[i][step * 3 + 2] - s.sz) > 1e-4
        ) {
          sclChanged = true;
        }
      }

      if (posChanged) {
        const outAcc = addAccessor(posTracks[i], 'VEC3', 0, 5126, numSteps);
        const sampIdx = samplers.length;
        samplers.push({
          input: ensureTimeAccessor(),
          interpolation: 'LINEAR',
          output: outAcc,
        });
        channels.push({
          sampler: sampIdx,
          target: {node: i, path: 'translation'},
        });
      }
      if (rotChanged) {
        const outAcc = addAccessor(rotTracks[i], 'VEC4', 0, 5126, numSteps);
        const sampIdx = samplers.length;
        samplers.push({
          input: ensureTimeAccessor(),
          interpolation: 'LINEAR',
          output: outAcc,
        });
        channels.push({
          sampler: sampIdx,
          target: {node: i, path: 'rotation'},
        });
      }
      if (sclChanged) {
        const outAcc = addAccessor(sclTracks[i], 'VEC3', 0, 5126, numSteps);
        const sampIdx = samplers.length;
        samplers.push({
          input: ensureTimeAccessor(),
          interpolation: 'LINEAR',
          output: outAcc,
        });
        channels.push({
          sampler: sampIdx,
          target: {node: i, path: 'scale'},
        });
      }
    }

    if (channels.length > 0) {
      gltfAnimations.push({
        name: 'ProceduralLoop',
        samplers,
        channels,
      });
    }
  }

  const interactivityExt = compileInteractivityGraph(
    nodes,
    meshes,
    scene.userData,
  );

  const gltf: any = {
    asset: {
      version: '2.0',
      generator: 'ThreeLiveConvert',
      extras: {
        environmentIntensity: scene.environmentIntensity,
      },
    },
    scenes: [{nodes: rootNodeIndices}],
    scene: 0,
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{byteLength: byteOffset}],
    ...(gltfAnimations.length > 0 ? {animations: gltfAnimations} : {}),
    ...(interactivityExt || nodeExtensionsUsed.size > 0
      ? {
          extensionsUsed: [
            ...(interactivityExt ? ['KHR_interactivity'] : []),
            ...nodeExtensionsUsed,
          ],
        }
      : {}),
    ...(interactivityExt
      ? {extensions: {KHR_interactivity: interactivityExt}}
      : {}),
  };

  const bin = new Uint8Array(byteOffset);
  let offset = 0;
  for (const b of buffers) {
    bin.set(b, offset);
    offset += b.byteLength;
  }

  return {
    gltf,
    bin: bin.buffer,
    lights,
    environmentIntensity: scene.environmentIntensity,
  };
}

export function encodeUtf8(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Serializes a Three.js Scene into a binary glTF 2.0 (.glb) byte array.
 */
export function sceneToGLB(
  scene: Scene,
  options?: {
    animateFn?: (time: number) => void;
    animateCallback?: (time: number) => void;
    duration?: number;
    fps?: number;
  },
): Uint8Array {
  const {gltf, bin} = sceneToCanvas3D(scene, options);
  const jsonStr = JSON.stringify(gltf);
  const jsonBytes = encodeUtf8(jsonStr);
  const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
  const jsonPaddedLength = jsonBytes.byteLength + jsonPadding;

  const totalLength = 12 + 8 + jsonPaddedLength + 8 + bin.byteLength;
  const glb = new Uint8Array(totalLength);
  const dv = new DataView(glb.buffer);

  // 12-byte GLB Header
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true); // version 2
  dv.setUint32(8, totalLength, true);

  // Chunk 0: JSON
  dv.setUint32(12, jsonPaddedLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  glb.set(jsonBytes, 20);
  for (let i = 0; i < jsonPadding; i++)
    glb[20 + jsonBytes.byteLength + i] = 0x20;

  // Chunk 1: BIN
  const binHeaderOffset = 20 + jsonPaddedLength;
  dv.setUint32(binHeaderOffset, bin.byteLength, true);
  dv.setUint32(binHeaderOffset + 4, 0x004e4942, true); // "BIN\0"
  glb.set(new Uint8Array(bin), binHeaderOffset + 8);

  return glb;
}

// =========================================================================
// 3. Direct Scene Graph Mesh Extraction for USDZ
// =========================================================================

/**
 * Extracts mesh geometry data directly from an in-memory Three.js Scene.
 * Bypasses glTF serialization entirely, applying world transforms in a single pass.
 */
export function extractMeshesFromScene(
  scene: Scene,
  options?: {
    animateFn?: (time: number) => void;
    animateCallback?: (time: number) => void;
    duration?: number;
    fps?: number;
  },
): USDAMeshData[] {
  scene.updateMatrixWorld(true);
  const result: USDAMeshData[] = [];

  scene.traverse((obj: Object3D) => {
    if ((obj as any).geometry) {
      const geo = (obj as any).geometry;
      const posAttr = geo.attributes.position;
      if (!posAttr || posAttr.count === 0) return;

      const posCount = posAttr.count;
      const positions = new Float32Array(posCount * 3);
      const m = obj.matrixWorld.elements;

      for (let i = 0; i < posCount; i++) {
        const x = posAttr.getX(i);
        const y = posAttr.getY(i);
        const z = posAttr.getZ(i);
        positions[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        positions[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        positions[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }

      let normals: Float32Array | undefined;
      if (geo.attributes.normal) {
        const normAttr = geo.attributes.normal;
        normals = new Float32Array(posCount * 3);
        const normalMat = new Float32Array(9);
        mat3NormalFromMat4(normalMat, m);

        for (let i = 0; i < posCount; i++) {
          const x = normAttr.getX(i);
          const y = normAttr.getY(i);
          const z = normAttr.getZ(i);
          const nx = normalMat[0] * x + normalMat[3] * y + normalMat[6] * z;
          const ny = normalMat[1] * x + normalMat[4] * y + normalMat[7] * z;
          const nz = normalMat[2] * x + normalMat[5] * y + normalMat[8] * z;
          const len = Math.hypot(nx, ny, nz) || 1;
          normals[i * 3] = nx / len;
          normals[i * 3 + 1] = ny / len;
          normals[i * 3 + 2] = nz / len;
        }
      }

      let uvs: Float32Array | undefined;
      if (geo.attributes.uv) {
        const uvAttr = geo.attributes.uv;
        uvs = new Float32Array(posCount * 2);
        for (let i = 0; i < posCount; i++) {
          uvs[i * 2] = uvAttr.getX(i);
          uvs[i * 2 + 1] = uvAttr.getY(i);
        }
      }

      let indices: Uint16Array | Uint32Array;
      if (geo.index) {
        indices = geo.index.array;
      } else {
        indices =
          posCount > 65535
            ? new Uint32Array(posCount)
            : new Uint16Array(posCount);
        for (let i = 0; i < posCount; i++) indices[i] = i;
      }

      let materialName = 'DefaultMaterial';
      let color: [number, number, number] = [0.8, 0.8, 0.8];
      let roughness = 0.5;
      let metallic = 0.1;
      let clearcoat = 0.0;
      let clearcoatRoughness = 0.0;
      let ior = 1.5;
      let opacity = 1.0;
      let emissiveColor: [number, number, number] = [0, 0, 0];

      if (obj.material) {
        const mat = obj.material as any;
        materialName = mat.name || `Material_${result.length}`;
        if (mat.color) {
          color = [mat.color.r, mat.color.g, mat.color.b];
        }
        if (typeof mat.roughness === 'number') roughness = mat.roughness;
        if (typeof mat.metalness === 'number') metallic = mat.metalness;
        if (typeof mat.clearcoat === 'number') clearcoat = mat.clearcoat;
        if (typeof mat.clearcoatRoughness === 'number')
          clearcoatRoughness = mat.clearcoatRoughness;
        if (typeof mat.ior === 'number') ior = mat.ior;
        const baseOp = typeof mat.opacity === 'number' ? mat.opacity : 1.0;
        const trans =
          typeof mat.transmission === 'number' ? mat.transmission : 0.0;
        opacity = baseOp * (1.0 - trans);
        if (
          mat.emissive &&
          (mat.emissive.r > 0 || mat.emissive.g > 0 || mat.emissive.b > 0)
        ) {
          const ei = mat.emissiveIntensity ?? 1.0;
          emissiveColor = [
            mat.emissive.r * ei,
            mat.emissive.g * ei,
            mat.emissive.b * ei,
          ];
        }
      }

      let timeSamples: USDAMeshTimeSamples | undefined;
      const animateFn =
        options?.animateCallback ||
        options?.animateFn ||
        (typeof (scene as any).userData?.animate === 'function'
          ? (scene as any).userData.animate
          : typeof (scene as any).__animateFn === 'function'
            ? (scene as any).__animateFn
            : typeof (globalThis as any).animate === 'function'
              ? (globalThis as any).animate
              : undefined);
      if (typeof animateFn === 'function') {
        const duration = options?.duration ?? 4.0;
        const fps = options?.fps ?? 4;
        const numSteps = Math.max(2, Math.round(duration * fps) + 1);
        const times: number[] = [];
        const translations: Array<[number, number, number]> = [];
        const rotations: Array<[number, number, number, number]> = [];
        const scales: Array<[number, number, number]> = [];
        const origP = [obj.position.x, obj.position.y, obj.position.z];
        const origQ = [
          obj.quaternion.x,
          obj.quaternion.y,
          obj.quaternion.z,
          obj.quaternion.w,
        ];
        const origS = [obj.scale.x, obj.scale.y, obj.scale.z];
        let changed = false;
        for (let step = 0; step < numSteps; step++) {
          const t = (step / (numSteps - 1)) * duration;
          times.push(t);
          try {
            animateFn(t);
          } catch (_) {}
          translations.push([obj.position.x, obj.position.y, obj.position.z]);
          rotations.push([
            obj.quaternion.x,
            obj.quaternion.y,
            obj.quaternion.z,
            obj.quaternion.w,
          ]);
          scales.push([obj.scale.x, obj.scale.y, obj.scale.z]);
          if (
            Math.abs(obj.position.x - origP[0]) > 1e-4 ||
            Math.abs(obj.position.y - origP[1]) > 1e-4 ||
            Math.abs(obj.position.z - origP[2]) > 1e-4 ||
            Math.abs(obj.quaternion.x - origQ[0]) > 1e-4 ||
            Math.abs(obj.quaternion.y - origQ[1]) > 1e-4 ||
            Math.abs(obj.quaternion.z - origQ[2]) > 1e-4 ||
            Math.abs(obj.quaternion.w - origQ[3]) > 1e-4 ||
            Math.abs(obj.scale.x - origS[0]) > 1e-4
          ) {
            changed = true;
          }
        }
        obj.position.set(origP[0], origP[1], origP[2]);
        obj.quaternion.set(origQ[0], origQ[1], origQ[2], origQ[3]);
        obj.scale.set(origS[0], origS[1], origS[2]);
        if (changed) {
          timeSamples = {times, translations, rotations, scales};
        }
      }

      result.push({
        name: obj.name || `Mesh_${result.length}`,
        positions,
        indices,
        normals,
        uvs,
        materialName,
        color,
        roughness,
        metallic,
        clearcoat,
        clearcoatRoughness,
        ior,
        opacity,
        emissiveColor,
        xrTraits: obj.userData?.xr,
        timeSamples,
      });
    }
  });

  return result;
}

// =========================================================================
// 4. GLB Mesh Extraction for USDZ
// =========================================================================

/**
 * Extracts mesh geometry data from GLBData for USDA serialization.
 */
export function extractMeshesFromGLB(glb: GLBData): USDAMeshData[] {
  const result: USDAMeshData[] = [];
  const gltf = glb.gltf;
  const rawBin = glb.bin;
  const binBuffer: ArrayBuffer =
    rawBin instanceof ArrayBuffer
      ? rawBin
      : (rawBin as any).buffer.slice(
          (rawBin as any).byteOffset,
          (rawBin as any).byteOffset + (rawBin as any).byteLength,
        );

  const accessors = gltf.accessors || [];
  const bufferViews = gltf.bufferViews || [];
  const materials = gltf.materials || [];
  const meshes = gltf.meshes || [];
  const nodes = gltf.nodes || [];

  function getBufferSlice(accessorIndex: number): {
    acc: any;
    buffer: ArrayBuffer;
  } {
    const acc = accessors[accessorIndex];
    if (!acc) throw new Error(`Accessor ${accessorIndex} not found`);
    const bv = bufferViews[acc.bufferView || 0];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const byteLength = bv.byteLength || 0;
    const slice = binBuffer.slice(byteOffset, byteOffset + byteLength);
    return {acc, buffer: slice};
  }

  const nodeTransforms = new Map<number, Float32Array>();

  if (nodes.length > 0) {
    const worldMatrices = resolveNodeWorldMatrices(gltf);
    for (let i = 0; i < worldMatrices.length; i++) {
      nodeTransforms.set(i, worldMatrices[i]);
    }
  }

  function processMeshInstance(
    meshIdx: number,
    worldMatrix: Float32Array,
    instanceName: string,
    nodeExtras?: Record<string, any>,
  ) {
    const mesh = meshes[meshIdx];
    if (!mesh) return;

    const normalMat = new Float32Array(9);
    mat3NormalFromMat4(normalMat, worldMatrix);

    for (let pIdx = 0; pIdx < (mesh.primitives || []).length; pIdx++) {
      const prim = mesh.primitives[pIdx];
      const posAccIdx = prim.attributes?.POSITION;
      if (posAccIdx === undefined) continue;

      const {acc: posAcc, buffer: posBuf} = getBufferSlice(posAccIdx);
      const rawPositions = new Float32Array(posBuf, 0, posAcc.count * 3);
      const positions = new Float32Array(rawPositions.length);

      for (let i = 0; i < posAcc.count; i++) {
        const x = rawPositions[i * 3];
        const y = rawPositions[i * 3 + 1];
        const z = rawPositions[i * 3 + 2];
        positions[i * 3] =
          worldMatrix[0] * x +
          worldMatrix[4] * y +
          worldMatrix[8] * z +
          worldMatrix[12];
        positions[i * 3 + 1] =
          worldMatrix[1] * x +
          worldMatrix[5] * y +
          worldMatrix[9] * z +
          worldMatrix[13];
        positions[i * 3 + 2] =
          worldMatrix[2] * x +
          worldMatrix[6] * y +
          worldMatrix[10] * z +
          worldMatrix[14];
      }

      let normals: Float32Array | undefined;
      const normAccIdx = prim.attributes?.NORMAL;
      if (normAccIdx !== undefined) {
        const {acc: normAcc, buffer: normBuf} = getBufferSlice(normAccIdx);
        const rawNormals = new Float32Array(normBuf, 0, normAcc.count * 3);
        normals = new Float32Array(rawNormals.length);
        for (let i = 0; i < normAcc.count; i++) {
          const x = rawNormals[i * 3];
          const y = rawNormals[i * 3 + 1];
          const z = rawNormals[i * 3 + 2];
          const nx = normalMat[0] * x + normalMat[3] * y + normalMat[6] * z;
          const ny = normalMat[1] * x + normalMat[4] * y + normalMat[7] * z;
          const nz = normalMat[2] * x + normalMat[5] * y + normalMat[8] * z;
          const len = Math.hypot(nx, ny, nz) || 1;
          normals[i * 3] = nx / len;
          normals[i * 3 + 1] = ny / len;
          normals[i * 3 + 2] = nz / len;
        }
      }

      let uvs: Float32Array | undefined;
      const uvAccIdx = prim.attributes?.TEXCOORD_0;
      if (uvAccIdx !== undefined) {
        const {acc: uvAcc, buffer: uvBuf} = getBufferSlice(uvAccIdx);
        uvs = new Float32Array(uvBuf, 0, uvAcc.count * 2);
      }

      let indices: Uint16Array | Uint32Array;
      if (prim.indices !== undefined) {
        const {acc: idxAcc, buffer: idxBuf} = getBufferSlice(prim.indices);
        if (idxAcc.componentType === 5125) {
          indices = new Uint32Array(idxBuf, 0, idxAcc.count);
        } else {
          indices = new Uint16Array(idxBuf, 0, idxAcc.count);
        }
        // Validate on the host: the sandbox worker's own index checks are not
        // a trust boundary, and out-of-range indices are invalid glTF that
        // would otherwise be written verbatim into USDA faceVertexIndices.
        const vertexCount = posAcc.count;
        for (const idx of indices) {
          if (idx >= vertexCount) {
            throw new Error(
              `SecurityError: Index buffer value (${idx}) out of vertex ` +
                `bounds [0, ${vertexCount}).`,
            );
          }
        }
      } else {
        const vCount = posAcc.count;
        indices =
          vCount > 65535 ? new Uint32Array(vCount) : new Uint16Array(vCount);
        for (let i = 0; i < vCount; i++) indices[i] = i;
      }

      let materialName = 'DefaultMaterial';
      let color: [number, number, number] = [0.8, 0.8, 0.8];
      let roughness = 0.5;
      let metallic = 0.1;
      let clearcoat = 0.0;
      let clearcoatRoughness = 0.0;
      let ior = 1.5;
      let opacity = 1.0;
      let emissiveColor: [number, number, number] = [0, 0, 0];

      if (prim.material !== undefined && materials[prim.material]) {
        const mat = materials[prim.material];
        materialName = mat.name || `Material_${prim.material}`;
        const pbr = mat.pbrMetallicRoughness || {};
        let baseOp = 1.0;
        if (Array.isArray(pbr.baseColorFactor)) {
          color = [
            pbr.baseColorFactor[0],
            pbr.baseColorFactor[1],
            pbr.baseColorFactor[2],
          ];
          if (typeof pbr.baseColorFactor[3] === 'number') {
            baseOp = pbr.baseColorFactor[3];
          }
        }
        if (typeof pbr.roughnessFactor === 'number')
          roughness = pbr.roughnessFactor;
        if (typeof pbr.metallicFactor === 'number')
          metallic = pbr.metallicFactor;

        if (
          Array.isArray(mat.emissiveFactor) &&
          mat.emissiveFactor.length >= 3
        ) {
          emissiveColor = [
            mat.emissiveFactor[0],
            mat.emissiveFactor[1],
            mat.emissiveFactor[2],
          ];
        }
        const ext = mat.extensions || {};
        if (ext.KHR_materials_clearcoat) {
          clearcoat = ext.KHR_materials_clearcoat.clearcoatFactor ?? 0.0;
          clearcoatRoughness =
            ext.KHR_materials_clearcoat.clearcoatRoughnessFactor ?? 0.0;
        }
        if (
          ext.KHR_materials_ior &&
          typeof ext.KHR_materials_ior.ior === 'number'
        ) {
          ior = ext.KHR_materials_ior.ior;
        }
        const trans = ext.KHR_materials_transmission?.transmissionFactor ?? 0.0;
        opacity = baseOp * (1.0 - trans);
      }

      const pName =
        (mesh.primitives || []).length > 1
          ? `${instanceName}_p${pIdx}`
          : instanceName;
      result.push({
        name: pName,
        positions,
        indices,
        normals,
        uvs,
        materialName,
        color,
        roughness,
        metallic,
        clearcoat,
        clearcoatRoughness,
        ior,
        opacity,
        emissiveColor,
        xrTraits: nodeExtras?.xr || mesh.extras?.xr,
      });
    }
  }

  if (nodes.length > 0) {
    for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
      const node = nodes[nIdx];
      if (node.mesh !== undefined && node.mesh < meshes.length) {
        const worldM = nodeTransforms.get(nIdx) || mat4Create();
        const instanceName =
          node.name || meshes[node.mesh].name || `Node_${nIdx}`;
        processMeshInstance(node.mesh, worldM, instanceName, node.extras);
      }
    }
  } else {
    const identity = mat4Create();
    for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
      const meshName = meshes[mIdx].name || `Mesh_${mIdx}`;
      processMeshInstance(mIdx, identity, meshName, meshes[mIdx].extras);
    }
  }

  return result;
}

// =========================================================================
// 5. USDA Text Formatting
// =========================================================================

/**
 * Sanitizes an untrusted string into a valid USD identifier (`^[A-Za-z_][A-Za-z0-9_]*$`),
 * preventing USDA scene graph and asset reference injection.
 */
export function sanitizeUsdIdentifier(
  name: string | undefined,
  fallback: string,
): string {
  if (!name || typeof name !== 'string') return fallback;
  let clean = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(clean)) {
    clean = '_' + clean;
  }
  return clean || fallback;
}

/**
 * Escapes backslashes and double quotes and strips ASCII control characters
 * (`\x00`–`\x1F`, `\x7F`) before interpolating an untrusted string into a USDA
 * double-quoted literal (P1-5 / WEB-11).
 */
export function sanitizeUsdStringLiteral(val: unknown): string {
  return String(val ?? '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1e-7) return '0';
  const str = Number(n.toFixed(5)).toString();
  return str.indexOf('.') === -1 ? `${str}.0` : str;
}

function formatPointsArray(positions: Float32Array): string {
  if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
    const nativeFn = (globalThis as any)
      .__three_live_native_format_usda_points__;
    if (typeof nativeFn === 'function') {
      return nativeFn(positions);
    }
  }
  const posCount = positions.length / 3;
  const parts: string[] = new Array(posCount);
  for (let i = 0; i < posCount; i++) {
    parts[i] = `(${formatNum(positions[i * 3])}, ${formatNum(
      positions[i * 3 + 1],
    )}, ${formatNum(positions[i * 3 + 2])})`;
  }
  return parts.join(', ');
}

function formatUVsArray(uvs: Float32Array, posCount: number): string {
  if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
    const nativeFn = (globalThis as any).__three_live_native_format_usda_uvs__;
    if (typeof nativeFn === 'function') {
      return nativeFn(uvs);
    }
  }
  const parts: string[] = new Array(posCount);
  for (let i = 0; i < posCount; i++) {
    parts[i] = `(${formatNum(uvs[i * 2])}, ${formatNum(1.0 - uvs[i * 2 + 1])})`;
  }
  return parts.join(', ');
}

function formatIndicesArray(
  indices: Uint16Array | Uint32Array | number[],
): string {
  if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
    const nativeFn = (globalThis as any).__three_live_native_format_usda_ints__;
    if (typeof nativeFn === 'function') {
      return nativeFn(indices);
    }
  }
  return Array.from(indices).join(', ');
}

/**
 * Generates valid Universal Scene Description ASCII (.usda) text from mesh data.
 */
export function generateUSDAFromMeshes(meshes: USDAMeshData[]): string {
  const materialsMap = new Map<
    string,
    {
      color: [number, number, number];
      roughness: number;
      metallic: number;
      clearcoat: number;
      clearcoatRoughness: number;
      ior: number;
      opacity: number;
      emissiveColor: [number, number, number];
    }
  >();
  for (const m of meshes) {
    const matName = sanitizeUsdIdentifier(m.materialName, 'DefaultMaterial');
    if (!materialsMap.has(matName)) {
      materialsMap.set(matName, {
        color: m.color || [0.8, 0.8, 0.8],
        roughness: m.roughness ?? 0.5,
        metallic: m.metallic ?? 0.0,
        clearcoat: m.clearcoat ?? 0.0,
        clearcoatRoughness: m.clearcoatRoughness ?? 0.0,
        ior: m.ior ?? 1.5,
        opacity: m.opacity ?? 1.0,
        emissiveColor: m.emissiveColor || [0, 0, 0],
      });
    }
  }

  let maxTimeCode = 0;
  let rootAnchorPlane: string | null = null;
  for (const m of meshes) {
    if (m.timeSamples && m.timeSamples.times.length > 0) {
      const lastT = m.timeSamples.times[m.timeSamples.times.length - 1];
      if (lastT > maxTimeCode) maxTimeCode = lastT;
    }
    if (m.xrTraits?.anchor && !rootAnchorPlane) {
      rootAnchorPlane =
        m.xrTraits.anchor === 'vertical' || m.xrTraits.anchor === 'wall'
          ? 'vertical'
          : 'horizontal';
    }
  }

  let stageTiming = '';
  if (maxTimeCode > 0) {
    stageTiming = `startTimeCode = 0\nendTimeCode = ${formatNum(maxTimeCode)}\ntimeCodesPerSecond = 1.0\n`;
  }

  let rootAnchorAttrs = '';
  if (rootAnchorPlane) {
    rootAnchorAttrs = `uniform token preliminary:anchoring:type = "plane"\nuniform token preliminary:planeAnchoring:alignment = "${rootAnchorPlane}"\n`;
  }

  let usda = `#usda 1.0
(
defaultPrim = "Root"
metersPerUnit = 1.0
upAxis = "Y"
${stageTiming})

def Xform "Root" (
kind = "component"
)
{
${rootAnchorAttrs}def Scope "Materials"
{
`;

  for (const [matName, matProps] of materialsMap.entries()) {
    const [r, g, b] = matProps.color;
    const [er, eg, eb] = matProps.emissiveColor;
    let extraInputs = '';
    if (matProps.clearcoat > 0) {
      extraInputs += `float inputs:clearcoat = ${formatNum(matProps.clearcoat)}\n`;
      extraInputs += `float inputs:clearcoatRoughness = ${formatNum(matProps.clearcoatRoughness)}\n`;
    }
    if (matProps.ior !== 1.5) {
      extraInputs += `float inputs:ior = ${formatNum(matProps.ior)}\n`;
    }
    if (matProps.opacity < 1.0) {
      extraInputs += `float inputs:opacity = ${formatNum(matProps.opacity)}\n`;
    }
    if (er > 0 || eg > 0 || eb > 0) {
      extraInputs += `color3f inputs:emissiveColor = (${formatNum(er)}, ${formatNum(eg)}, ${formatNum(eb)})\n`;
    }
    usda += `def Material "${matName}"
{
def Shader "PBRShader"
{
uniform token info:id = "UsdPreviewSurface"
color3f inputs:diffuseColor = (${formatNum(r)}, ${formatNum(g)}, ${formatNum(b)})
float inputs:metallic = ${formatNum(matProps.metallic)}
float inputs:roughness = ${formatNum(matProps.roughness)}
${extraInputs}token outputs:surface
}
token outputs:surface.connect = </Root/Materials/${matName}/PBRShader.outputs:surface>
}
`;
  }

  usda += `}
def Scope "Meshes"
{
`;

  const usedMeshNames = new Set<string>();
  for (let meshIdx = 0; meshIdx < meshes.length; meshIdx++) {
    const mesh = meshes[meshIdx];
    const posCount = mesh.positions.length / 3;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let i = 0; i < posCount; i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    if (!isFinite(minX)) {
      minX = minY = minZ = -1;
      maxX = maxY = maxZ = 1;
    }

    const triCount = Math.floor(mesh.indices.length / 3);
    const matBinding = sanitizeUsdIdentifier(
      mesh.materialName,
      'DefaultMaterial',
    );
    let safeMeshName = sanitizeUsdIdentifier(mesh.name, `Mesh_${meshIdx}`);
    if (usedMeshNames.has(safeMeshName)) {
      safeMeshName = `${safeMeshName}_${meshIdx}`;
    }
    usedMeshNames.add(safeMeshName);

    const faceVertexCountsStr =
      triCount > 0
        ? triCount === 1
          ? '3'
          : '3, '.repeat(triCount - 1) + '3'
        : '';

    const xr = mesh.xrTraits;
    let meshHeaderMeta = '';
    if (xr) {
      const metaLines: string[] = [];
      if (xr.physics && xr.physics !== 'none') {
        metaLines.push(
          `prepend apiSchemas = ["PhysicsBodyAPI", "PhysicsCollisionAPI"]`,
        );
      }
      const xrDictLines: string[] = getSharedRegistry().xrTraitSerializer?.usdLines(
        xr,
        sanitizeUsdStringLiteral,
      ) ?? [];
      if (!xrDictLines.length) {
        for (const k of ['grab', 'billboard', 'follow', 'anchor', 'physics'] as const) {
          const v: unknown = k === 'follow' && typeof xr.follow === 'object' ? xr.follow.mode ?? 'head' : xr[k];
          if (v !== undefined) xrDictLines.push(`string ${k} = "${sanitizeUsdStringLiteral(v)}"`);
        }
      }
      if (xrDictLines.length > 0) {
        metaLines.push(
          `customData = {\n  dictionary xr = {\n    ${xrDictLines.join('\n    ')}\n  }\n}`,
        );
      }
      if (metaLines.length > 0) {
        meshHeaderMeta = ` (\n${metaLines.join('\n')}\n)`;
      }
    }

    usda += `def Mesh "${safeMeshName}"${meshHeaderMeta}
{
`;
    if (xr?.physics && xr.physics !== 'none') {
      const isKinematic = xr.physics === 'static' ? 'true' : 'false';
      usda += `bool physics:rigidBodyEnabled = true\nbool physics:kinematicEnabled = ${isKinematic}\nbool physics:collisionEnabled = true\n`;
    }

    if (mesh.timeSamples && mesh.timeSamples.times.length > 0) {
      const ts = mesh.timeSamples;
      const tSamples = ts.times
        .map((t, idx) => {
          const p = ts.translations?.[idx] || [0, 0, 0];
          return `${formatNum(t)}: (${formatNum(p[0])}, ${formatNum(p[1])}, ${formatNum(p[2])})`;
        })
        .join(', ');
      const rSamples = ts.times
        .map((t, idx) => {
          const q = ts.rotations?.[idx] || [0, 0, 0, 1];
          return `${formatNum(t)}: (${formatNum(q[3])}, ${formatNum(q[0])}, ${formatNum(q[1])}, ${formatNum(q[2])})`;
        })
        .join(', ');
      const sSamples = ts.times
        .map((t, idx) => {
          const s = ts.scales?.[idx] || [1, 1, 1];
          return `${formatNum(t)}: (${formatNum(s[0])}, ${formatNum(s[1])}, ${formatNum(s[2])})`;
        })
        .join(', ');
      usda += `double3 xformOp:translate.timeSamples = { ${tSamples} }\nquatf xformOp:orient.timeSamples = { ${rSamples} }\ndouble3 xformOp:scale.timeSamples = { ${sSamples} }\nuniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient", "xformOp:scale"]\n`;
    }

    usda += `float3[] extent = [(${formatNum(minX)}, ${formatNum(minY)}, ${formatNum(minZ)}), (${formatNum(maxX)}, ${formatNum(maxY)}, ${formatNum(maxZ)})]
int[] faceVertexCounts = [${faceVertexCountsStr}]
int[] faceVertexIndices = [${formatIndicesArray(mesh.indices)}]
point3f[] points = [${formatPointsArray(mesh.positions)}]
`;

    if (mesh.normals && mesh.normals.length === mesh.positions.length) {
      usda += `normal3f[] normals = [${formatPointsArray(mesh.normals)}] (
interpolation = "vertex"
)
`;
    }

    if (mesh.uvs && mesh.uvs.length === posCount * 2) {
      usda += `texCoord2f[] primvars:st = [${formatUVsArray(mesh.uvs, posCount)}] (
interpolation = "vertex"
)
`;
    }

    usda += `rel material:binding = </Root/Materials/${matBinding}>
}
`;
  }

  usda += `}
}
`;

  return usda;
}

/**
 * Universal USDA generation entry point.
 * Accepts either a Three.js Scene, GLBData, ArrayBuffer, or ArrayBufferView.
 */
export function generateUSDA(
  source: SceneOrGLBSource,
  options?: {
    animateFn?: (time: number) => void;
    animateCallback?: (time: number) => void;
    duration?: number;
    fps?: number;
  },
): string {
  if (source && typeof (source as any).traverse === 'function') {
    const meshes = extractMeshesFromScene(source as Scene, options);
    return generateUSDAFromMeshes(meshes);
  }
  const glb = toGLBData(source as GLBData | ArrayBuffer | ArrayBufferView);
  const meshes = extractMeshesFromGLB(glb);
  return generateUSDAFromMeshes(meshes);
}

// =========================================================================
// 6. 64-Byte Aligned USDZ ZIP Packager
// =========================================================================

let CRC_TABLE: Uint32Array | null = null;

export function calculateCRC32(bytes: Uint8Array): number {
  if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
    const nativeFn = (globalThis as any).__three_live_native_crc32__;
    if (typeof nativeFn === 'function') {
      return nativeFn(bytes);
    }
  }
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      CRC_TABLE[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds an uncompressed (Store, Method 0) ZIP archive with 64-byte file alignment
 * strictly complying with Apple's USDZ package specification.
 */
export function buildUSDZZip(entries: ZipEntry[]): Uint8Array {
  if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
    const nativeFn = (globalThis as any).__three_live_native_build_usdz_zip__;
    if (typeof nativeFn === 'function') {
      return nativeFn(entries);
    }
  }

  const fileHeaders: {
    offset: number;
    size: number;
    crc: number;
    filenameBytes: Uint8Array;
    entry: ZipEntry;
  }[] = [];

  let currentOffset = 0;
  const chunks: Uint8Array[] = [];

  for (const entry of entries) {
    const filenameBytes = encodeUtf8(entry.filename);
    const crc = calculateCRC32(entry.data);
    const uncompressedSize = entry.data.length;

    const localHeaderBase = 30 + filenameBytes.length;
    let potentialDataOffset = currentOffset + localHeaderBase;
    let extraPadding = 0;
    const rem = potentialDataOffset % 64;
    if (rem !== 0) {
      extraPadding = 64 - rem;
    }

    const localHeader = new Uint8Array(localHeaderBase + extraPadding);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // PK\x03\x04
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true); // Stored (uncompressed)
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, uncompressedSize, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, filenameBytes.length, true);
    view.setUint16(28, extraPadding, true);

    localHeader.set(filenameBytes, 30);
    if (extraPadding > 0) {
      localHeader.fill(0, 30 + filenameBytes.length);
    }

    fileHeaders.push({
      offset: currentOffset,
      size: uncompressedSize,
      crc,
      filenameBytes,
      entry,
    });

    chunks.push(localHeader);
    chunks.push(entry.data);
    currentOffset += localHeader.length + entry.data.length;
  }

  const centralDirStart = currentOffset;

  for (const h of fileHeaders) {
    const cdRecord = new Uint8Array(46 + h.filenameBytes.length);
    const view = new DataView(cdRecord.buffer);

    view.setUint32(0, 0x02014b50, true); // PK\x01\x02
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, h.crc, true);
    view.setUint32(20, h.size, true);
    view.setUint32(24, h.size, true);
    view.setUint16(28, h.filenameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, h.offset, true);

    cdRecord.set(h.filenameBytes, 46);
    chunks.push(cdRecord);
    currentOffset += cdRecord.length;
  }

  const centralDirSize = currentOffset - centralDirStart;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // PK\x05\x06
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, fileHeaders.length, true);
  eocdView.setUint16(10, fileHeaders.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirStart, true);
  eocdView.setUint16(20, 0, true);

  chunks.push(eocd);
  currentOffset += 22;

  const finalZip = new Uint8Array(currentOffset);
  let pos = 0;
  for (const chunk of chunks) {
    finalZip.set(chunk, pos);
    pos += chunk.length;
  }

  return finalZip;
}

// =========================================================================
// 7. High-Level Conversion APIs
// =========================================================================

/**
 * Directly compiles a Three.js Scene into Apple USDZ format with 64-byte alignment.
 */
export function sceneToUSDZ(scene: Scene): Uint8Array {
  const usdaText = generateUSDA(scene);
  const usdaBytes = encodeUtf8(usdaText);
  return buildUSDZZip([{filename: 'model.usda', data: usdaBytes}]);
}

/**
 * Converts a pre-existing binary GLB buffer or GLBData into Apple USDZ format.
 */
export function glbToUSDZ(
  glbOrBuffer: GLBData | ArrayBuffer | ArrayBufferView,
): Uint8Array {
  const glb = toGLBData(glbOrBuffer);
  const meshes = extractMeshesFromGLB(glb);
  const usdaText = generateUSDAFromMeshes(meshes);
  const usdaBytes = encodeUtf8(usdaText);
  return buildUSDZZip([{filename: 'model.usda', data: usdaBytes}]);
}

/**
 * Universal USDZ generator accepting either Scene, GLBData, or binary buffer.
 */
export function generateUSDZ(source: SceneOrGLBSource): Uint8Array {
  if (source && typeof (source as any).toUSDZ === 'function') {
    return (source as any).toUSDZ();
  }
  if (source && typeof (source as any).traverse === 'function') {
    return sceneToUSDZ(source as Scene);
  }
  return glbToUSDZ(source as GLBData | ArrayBuffer | ArrayBufferView);
}

/**
 * Creates an in-memory browser Blob with MIME type `model/vnd.usdz+zip`.
 */
export function createUSDZBlob(source: SceneOrGLBSource): Blob {
  const usdzBytes = generateUSDZ(source);
  return new Blob([usdzBytes], {type: 'model/vnd.usdz+zip'});
}
