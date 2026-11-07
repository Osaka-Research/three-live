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
  InstancedMesh,
  Light,
  LightGpu,
  Material,
  Mesh,
  Object3D,
  Scene,
} from './three-author';
import {toGLBData, type GLBData} from './three-view';

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
  anchor?:
    | 'horizontal'
    | 'vertical'
    | 'floor'
    | 'wall'
    | 'ceiling'
    | 'table'
    | {
        target?:
          | 'horizontal'
          | 'vertical'
          | 'floor'
          | 'wall'
          | 'ceiling'
          | 'table'
          | 'none';
        id?: string;
        persist?: boolean;
      };
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
  /** Live 3D bounding dimension callouts (`spatial-measure`). */
  dimensions?:
    | boolean
    | {
        enabled?: boolean;
        unit?: 'm' | 'cm' | 'mm' | 'in' | 'ft-in' | 'auto';
        axes?: Array<'x' | 'y' | 'z'>;
        color?: string;
        showOnSelect?: boolean;
      };
  /** Magnetic socket, grid, surface, and angle snapping (`magnetic-snap`). */
  snapTo?:
    | boolean
    | {
        grid?: [number, number, number] | number | null;
        angleDeg?: number;
        surface?: 'none' | 'floor' | 'wall' | 'ceiling' | 'any';
        socketTag?: string;
        radius?: number;
      };
  /** Target magnetic socket descriptor (`magnetic-snap`). */
  snapSocket?:
    | string
    | {
        tag: string;
        radius?: number;
        alignRotation?: boolean;
        highlightColor?: string;
      };
  /** Hands-free gaze reticle & dwell selection (`gaze-dwell`). */
  gaze?:
    | boolean
    | {
        enabled?: boolean;
        dwellMs?: number;
        repeat?: boolean;
        action?: 'select' | 'ask';
      };
  /** Multi-part exploded-view displacement & leader line (`exploded-view`). */
  explode?:
    | boolean
    | {
        enabled?: boolean;
        direction?: [number, number, number] | null;
        distance?: number;
        layer?: number;
        leaderLine?: boolean;
      };
  /** Marks a mesh as walkable or blocked for parabolic teleportation (`spatial-locomotion`). */
  navigable?: boolean | 'walkable' | 'blocked';
  /** Syncs node transform & ownership lease across `shared-room` peers (default `true` for grabbable nodes). */
  sync?: boolean;
  /** In-scene 3D vector text label (`THREE.TextGeometry` / `userData.xr.text`). */
  text?:
    | string
    | {
        text: string;
        size?: number;
        depth?: number;
        color?: string;
      };
  /** Camera-distance level of detail (`THREE.LOD` / `userData.xr.lod`). */
  lod?:
    | boolean
    | number[]
    | {
        enabled?: boolean;
        distances?: number[];
        ratios?: number[];
        hysteresis?: number;
        cullDistance?: number;
        levels?: Array<{
          distance: number;
          ratio?: number;
          hysteresis?: number;
          childIndex?: number;
          node?: string;
        }>;
      };
  [key: string]: any;
}

export interface USDAMeshTimeSamples {
  times: number[];
  translations?: Array<[number, number, number]>;
  rotations?: Array<[number, number, number, number]>;
  scales?: Array<[number, number, number]>;
}

export interface USDAMeshTexture {
  file: string;
  data?: Uint8Array;
  wrapS?: 'repeat' | 'clamp' | 'mirror';
  wrapT?: 'repeat' | 'clamp' | 'mirror';
  scale?: [number, number, number, number];
  bias?: [number, number, number, number];
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
  textures?: Array<USDAMeshTexture | undefined>;
  xrTraits?: XRMeshTraits;
  timeSamples?: USDAMeshTimeSamples;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: USDAMeshData[];
  isXform?: boolean;
  invisible?: boolean;
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

const finUsd = (v: unknown, fb: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fb;

function uniqName(used: Set<string>, base: string): string {
  let name = base;
  let s = 1;
  while (used.has(name)) name = `${base}_${s++}`;
  used.add(name);
  return name;
}

function decomposeMat4ToTRS(
  m: ArrayLike<number>,
  offset = 0,
): {
  t: [number, number, number];
  r: [number, number, number, number];
  s: [number, number, number];
} {
  const [m00, m01, m02, , m10, m11, m12, , m20, m21, m22, , tx, ty, tz] =
    Array.from({length: 15}, (_, k) =>
      finUsd(m[offset + k], k % 5 === 0 ? 1 : 0),
    );

  let sx = Math.hypot(m00, m01, m02);
  const sy = Math.hypot(m10, m11, m12);
  const sz = Math.hypot(m20, m21, m22);

  const det =
    m00 * (m11 * m22 - m21 * m12) -
    m10 * (m01 * m22 - m21 * m02) +
    m20 * (m01 * m12 - m11 * m02);
  if (det < 0) sx = -sx;

  const invSx = Math.abs(sx) > 1e-8 ? 1 / sx : 0;
  const invSy = Math.abs(sy) > 1e-8 ? 1 / sy : 0;
  const invSz = Math.abs(sz) > 1e-8 ? 1 / sz : 0;

  const r00 = m00 * invSx;
  const r01 = m01 * invSx;
  const r02 = m02 * invSx;
  const r10 = m10 * invSy;
  const r11 = m11 * invSy;
  const r12 = m12 * invSy;
  const r20 = m20 * invSz;
  const r21 = m21 * invSz;
  const r22 = m22 * invSz;

  const trace = r00 + r11 + r22;
  let qx = 0;
  let qy = 0;
  let qz = 0;
  let qw = 1;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (r12 - r21) * s;
    qy = (r20 - r02) * s;
    qz = (r01 - r10) * s;
  } else if (r00 > r11 && r00 > r22) {
    const s = 2.0 * Math.sqrt(Math.max(0, 1.0 + r00 - r11 - r22));
    if (s > 1e-8) {
      qw = (r12 - r21) / s;
      qx = 0.25 * s;
      qy = (r10 + r01) / s;
      qz = (r20 + r02) / s;
    }
  } else if (r11 > r22) {
    const s = 2.0 * Math.sqrt(Math.max(0, 1.0 + r11 - r00 - r22));
    if (s > 1e-8) {
      qw = (r20 - r02) / s;
      qx = (r10 + r01) / s;
      qy = 0.25 * s;
      qz = (r12 + r21) / s;
    }
  } else {
    const s = 2.0 * Math.sqrt(Math.max(0, 1.0 + r22 - r00 - r11));
    if (s > 1e-8) {
      qw = (r01 - r10) / s;
      qx = (r20 + r02) / s;
      qy = (r12 + r21) / s;
      qz = 0.25 * s;
    }
  }
  const qLen = Math.hypot(qx, qy, qz, qw);
  if (qLen > 1e-8 && Number.isFinite(qLen)) {
    qx /= qLen;
    qy /= qLen;
    qz /= qLen;
    qw /= qLen;
  } else {
    qx = 0;
    qy = 0;
    qz = 0;
    qw = 1;
  }
  return {t: [tx, ty, tz], r: [qx, qy, qz, qw], s: [sx, sy, sz]};
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
      target:
        typeof xr.follow === 'object' ? (xr.follow.mode ?? 'head') : xr.follow,
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

type ConvertAnimOptions = {
  animateFn?: (time: number) => void;
  animateCallback?: (time: number) => void;
  duration?: number;
  fps?: number;
};

const clampUsd = (v: unknown, lo: number, hi: number, fb: number): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.max(lo, Math.min(hi, v))
    : fb;

// tslint:disable-next-line:no-any
function readAudioEmitter(xr: any): {
  ae: Record<string, any>;
  src?: string;
  preset?: string;
  volume: number;
  loop: boolean;
  isGlobal: boolean;
} | null {
  const raw =
    xr?.audioEmitter ??
    xr?.spatialAudio ??
    (typeof xr?.audio === 'object' &&
    xr.audio &&
    ('preset' in xr.audio ||
      'distanceModel' in xr.audio ||
      'coneInnerAngle' in xr.audio ||
      'maxDistance' in xr.audio ||
      'volume' in xr.audio)
      ? xr.audio
      : typeof xr?.audio === 'string' &&
          /^(hum|reactor|wind|beacon|geiger|chimeLoop|machinery|water)$/.test(
            xr.audio,
          )
        ? {preset: xr.audio}
        : undefined);
  if (!raw || (typeof raw === 'object' && raw.enabled === false)) return null;
  const ae = typeof raw === 'string' ? {preset: raw} : raw;
  const src =
    typeof ae.src === 'string' &&
    !/[\x00-\x20\\%]|^\s*(javascript|data|file|http):/i.test(ae.src)
      ? ae.src
      : undefined;
  const preset = typeof ae.preset === 'string' ? ae.preset : undefined;
  if (!src && !preset) return null;
  return {
    ae,
    src,
    preset,
    volume: clampUsd(ae.volume, 0, 2, 0.6),
    loop: typeof ae.loop === 'boolean' ? ae.loop : true,
    isGlobal: ae.type === 'global' || ae.positional === false,
  };
}

/**
 * Serializes a Three.js Scene into in-memory GLBData ({ gltf, bin }) for WebGL2 rendering.
 * Automatically preserves `userData.xr` traits in `node.extras.xr` and bakes `animate(time)`
 * callbacks into standard glTF 2.0 animation tracks when present.
 */
export function sceneToCanvas3D(
  scene: Scene,
  options?: ConvertAnimOptions,
): GLBData {
  return serializeScene(scene, options)[0];
}

function serializeScene(
  scene: Scene,
  options?: ConvertAnimOptions,
): [GLBData, Object3D[]] {
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
  const images: Array<{uri: string}> = [];
  const samplers: Array<Record<string, number>> = [];
  const textures: Array<{sampler: number; source: number}> = [];
  const textureLookup = new Map<string, number>();
  const variantNames: string[] = [];
  const lights: LightGpu[] = [];

  function serializeMaterial(rawMat: Material): number {
    let matIdx = matMap.get(rawMat);
    if (matIdx !== undefined) return matIdx;
    matIdx = materials.length;
    matMap.set(rawMat, matIdx);
    const m = rawMat as Material & {
      emissive?: {r: number; g: number; b: number};
      emissiveIntensity?: number;
      clearcoat?: number;
      clearcoatRoughness?: number;
      sheen?: number;
      sheenColor?: {r: number; g: number; b: number};
      sheenRoughness?: number;
      transmission?: number;
      thickness?: number;
      attenuationDistance?: number;
      attenuationColor?: {r: number; g: number; b: number};
      ior?: number;
      dispersion?: number;
      iridescence?: number;
      iridescenceIOR?: number;
      doubleSided?: boolean;
    };
    const r = m.color?.r ?? 1.0;
    const g = m.color?.g ?? 1.0;
    const b = m.color?.b ?? 1.0;
    const opacity = m.opacity ?? 1.0;
    const pbr: Record<string, unknown> = {
      baseColorFactor: [r, g, b, opacity],
      metallicFactor: m.metalness ?? 0.0,
      roughnessFactor: m.roughness ?? 0.5,
    };
    const matExtras: Record<string, unknown> = {};
    const addTex = (t: any): {index: number} | undefined => {
      if (!t) return undefined;
      const raw =
        typeof t === 'string'
          ? t
          : typeof t.source === 'string'
            ? t.source
            : typeof t.image === 'string'
              ? t.image
              : '';
      const s = raw.trim();
      if (
        !s ||
        /[\x00-\x1f\x7f\\]|\.\./.test(s) ||
        !(/^data:image\/(png|jpeg|jpg|webp|ktx2|avif)(;|,)/i.test(s) ||
          (!s.startsWith('//') && !/^[a-z][a-z0-9+.-]*:/i.test(s)))
      ) {
        return undefined;
      }
      let texIdx = textureLookup.get(s);
      if (texIdx === undefined) {
        const imgIdx = images.length;
        images.push({uri: s});
        if (samplers.length === 0) {
          samplers.push({
            magFilter: 9729,
            minFilter: 9987,
            wrapS: 10497,
            wrapT: 10497,
          });
        }
        texIdx = textures.length;
        textures.push({sampler: 0, source: imgIdx});
        textureLookup.set(s, texIdx);
      }
      return {index: texIdx};
    };
    const baseTex = addTex(m.map);
    if (baseTex) pbr.baseColorTexture = baseTex;
    const mrTex = addTex((m as any).roughnessMap || (m as any).metalnessMap);
    if (mrTex) pbr.metallicRoughnessTexture = mrTex;
    const avg = (m.map as any)?.avgColor;
    if (Array.isArray(avg) && avg.length >= 3) {
      matExtras.avgColor = [avg[0], avg[1], avg[2]];
    }
    const normTex = addTex((m as any).normalMap);
    const emTex = addTex((m as any).emissiveMap);
    const aoTex = addTex((m as any).aoMap);
    const matDef: Record<string, unknown> = {
      name: m.name || '',
      pbrMetallicRoughness: pbr,
      doubleSided: m.side === 2 || Boolean(m.doubleSided),
      ...(normTex ? {normalTexture: normTex} : {}),
      ...(emTex ? {emissiveTexture: emTex} : {}),
      ...(aoTex ? {occlusionTexture: aoTex} : {}),
      ...(Object.keys(matExtras).length > 0 ? {extras: matExtras} : {}),
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
    const ext: Record<string, unknown> = {};
    if (m.clearcoat && m.clearcoat > 0) {
      ext.KHR_materials_clearcoat = {
        clearcoatFactor: m.clearcoat,
        clearcoatRoughnessFactor: m.clearcoatRoughness || 0,
      };
    }
    if (m.sheen && m.sheen > 0) {
      ext.KHR_materials_sheen = {
        sheenColorFactor: m.sheenColor
          ? [m.sheenColor.r, m.sheenColor.g, m.sheenColor.b]
          : [1, 1, 1],
        sheenRoughnessFactor: m.sheenRoughness || 0,
      };
    }
    if (m.transmission && m.transmission > 0) {
      ext.KHR_materials_transmission = {
        transmissionFactor: m.transmission,
      };
    }
    if (m.thickness && m.thickness > 0) {
      ext.KHR_materials_volume = {
        thicknessFactor: m.thickness,
        attenuationDistance: m.attenuationDistance ?? Infinity,
        attenuationColor: m.attenuationColor
          ? [m.attenuationColor.r, m.attenuationColor.g, m.attenuationColor.b]
          : [1, 1, 1],
      };
    }
    if (m.ior !== undefined && m.ior !== 1.5) {
      ext.KHR_materials_ior = {ior: m.ior};
    }
    if (m.dispersion && m.dispersion > 0) {
      ext.KHR_materials_dispersion = {dispersion: m.dispersion};
    }
    if (m.iridescence && m.iridescence > 0) {
      ext.KHR_materials_iridescence = {
        iridescenceFactor: m.iridescence,
        iridescenceIor: m.iridescenceIOR ?? 1.3,
      };
    }
    if (Object.keys(ext).length > 0) {
      matDef.extensions = ext;
    }
    materials.push(matDef);
    return matIdx;
  }

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
      const me = (node as any).matrixWorld?.elements;
      const px = finUsd(me ? me[12] : node.position?.x, 0),
        py = finUsd(me ? me[13] : node.position?.y, 0),
        pz = finUsd(me ? me[14] : node.position?.z, 0);
      const tgt = (node as any).target;
      const te = tgt?.parent ? tgt?.matrixWorld?.elements : undefined;
      const tx = finUsd(te ? te[12] : tgt?.position?.x, 0),
        ty = finUsd(te ? te[13] : tgt?.position?.y, 0),
        tz = finUsd(te ? te[14] : tgt?.position?.z, 0);
      const dx = tx - px,
        dy = ty - py,
        dz = tz - pz,
        dLen = Math.hypot(dx, dy, dz);
      const outerAngle = Math.max(
        0.01,
        Math.min(Math.PI / 2, finUsd((node as any).angle, Math.PI / 3)),
      );
      const pen = Math.max(0, Math.min(1, finUsd((node as any).penumbra, 0)));
      lights.push({
        type: node.type,
        color: [node.color.r, node.color.g, node.color.b],
        intensity: node.intensity,
        position: [px, py, pz],
        ...(node.type === 'spot'
          ? {
              direction:
                dLen > 1e-6 ? [dx / dLen, dy / dLen, dz / dLen] : [0, -1, 0],
              outerConeAngle: outerAngle,
              innerConeAngle: Math.max(0, outerAngle * (1 - pen)),
              range: Math.max(0, finUsd((node as any).distance, 0)),
            }
          : node.type === 'point'
            ? {range: Math.max(0, finUsd((node as any).distance, 0))}
            : {}),
      });
    }
  });

  const rootNodeIndices: number[] = [];
  const seenObjs = new Set<Object3D>([scene]);
  const nodeStack: Array<{obj: Object3D; parentKids: number[]}> = [];
  if (Array.isArray(scene.children)) {
    for (let i = scene.children.length - 1; i >= 0; i--) {
      nodeStack.push({obj: scene.children[i], parentKids: rootNodeIndices});
    }
  }

  while (nodeStack.length > 0) {
    const {obj, parentKids} = nodeStack.pop()!;
    if (!obj || typeof obj !== 'object' || seenObjs.has(obj)) continue;
    seenObjs.add(obj);
    (obj as any)._bakeAuthorGeometry?.();
    getSharedRegistry().materializeDeclarativeGeometry?.(obj);

    const hasInteractiveTraits = Boolean(
      obj.userData &&
        ((obj.userData.xr &&
          typeof obj.userData.xr === 'object' &&
          Object.keys(obj.userData.xr).length > 0) ||
          (obj.userData.interactivity &&
            typeof obj.userData.interactivity === 'object' &&
            Object.keys(obj.userData.interactivity).length > 0)),
    );
    const node: any = {
      name:
        obj.name || (hasInteractiveTraits ? `Node_${nodes.length}` : ''),
    };
    const px = finUsd(obj.position?.x, 0),
      py = finUsd(obj.position?.y, 0),
      pz = finUsd(obj.position?.z, 0);
    const rx = finUsd(obj.quaternion?.x, 0),
      ry = finUsd(obj.quaternion?.y, 0),
      rz = finUsd(obj.quaternion?.z, 0),
      rw = finUsd(obj.quaternion?.w, 1);
    const sx = finUsd(obj.scale?.x, 1),
      sy = finUsd(obj.scale?.y, 1),
      sz = finUsd(obj.scale?.z, 1);
    if (px || py || pz) node.translation = [px, py, pz];
    if (rx || ry || rz || rw !== 1) node.rotation = [rx, ry, rz, rw];
    if (sx !== 1 || sy !== 1 || sz !== 1) node.scale = [sx, sy, sz];
    if (obj.visible === false) {
      node.extensions = {
        ...(node.extensions || {}),
        KHR_node_visibility: {visible: false},
      };
      nodeExtensionsUsed.add('KHR_node_visibility');
    }

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
        nodeExtensionsUsed
          .add('MOZ_hubs_components')
          .add('ANDROID_xr_scenecore');
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

        const rawMat = Array.isArray(obj.material)
          ? obj.material[0]
          : obj.material;
        if (rawMat) {
          primitive.material = serializeMaterial(rawMat);
        }

        const rawVariants = obj.userData?.variants;
        if (rawVariants && typeof rawVariants === 'object') {
          const matToVarIndices = new Map<number, number[]>();
          for (const k of Object.keys(rawVariants)) {
            if (
              !k ||
              k === '__proto__' ||
              k === 'constructor' ||
              k === 'prototype'
            ) {
              continue;
            }
            const vMat = rawVariants[k];
            if (!vMat || typeof vMat !== 'object') continue;
            let vIdx = variantNames.indexOf(k);
            if (vIdx === -1 && variantNames.length < 256) {
              vIdx = variantNames.length;
              variantNames.push(k);
            }
            if (vIdx === -1) continue;
            const mIdx = serializeMaterial(vMat);
            let list = matToVarIndices.get(mIdx);
            if (!list) {
              list = [];
              matToVarIndices.set(mIdx, list);
            }
            list.push(vIdx);
          }
          if (matToVarIndices.size > 0) {
            const mappings: Array<{material: number; variants: number[]}> = [];
            for (const [mIdx, vIndices] of matToVarIndices.entries()) {
              mappings.push({material: mIdx, variants: vIndices});
            }
            primitive.extensions = {
              ...(primitive.extensions || {}),
              KHR_materials_variants: {mappings},
            };
            nodeExtensionsUsed.add('KHR_materials_variants');
          }
        }

        const maybeInst = obj as Partial<InstancedMesh>;
        if (
          maybeInst.isInstancedMesh &&
          typeof maybeInst.count === 'number' &&
          maybeInst.count > 0 &&
          maybeInst.instanceMatrix?.array
        ) {
          const instCount = Math.min(10000, Math.floor(maybeInst.count));
          const matArray = maybeInst.instanceMatrix.array as Float32Array;
          const tArr = new Float32Array(instCount * 3);
          const rArr = new Float32Array(instCount * 4);
          const sArr = new Float32Array(instCount * 3);
          for (let inst = 0; inst < instCount; inst++) {
            const {t, r, s} = decomposeMat4ToTRS(matArray, inst * 16);
            tArr[inst * 3] = t[0];
            tArr[inst * 3 + 1] = t[1];
            tArr[inst * 3 + 2] = t[2];
            rArr[inst * 4] = r[0];
            rArr[inst * 4 + 1] = r[1];
            rArr[inst * 4 + 2] = r[2];
            rArr[inst * 4 + 3] = r[3];
            sArr[inst * 3] = s[0];
            sArr[inst * 3 + 1] = s[1];
            sArr[inst * 3 + 2] = s[2];
          }
          const instAttrs: Record<string, number> = {
            TRANSLATION: addAccessor(tArr, 'VEC3', 0, 5126, instCount),
            ROTATION: addAccessor(rArr, 'VEC4', 0, 5126, instCount),
            SCALE: addAccessor(sArr, 'VEC3', 0, 5126, instCount),
          };
          if (
            maybeInst.instanceColor?.array &&
            maybeInst.instanceColor.array.length >= instCount * 3
          ) {
            const cArr = new Float32Array(
              (maybeInst.instanceColor.array as Float32Array).subarray(
                0,
                instCount * 3,
              ),
            );
            instAttrs._COLOR_0 = addAccessor(cArr, 'VEC3', 0, 5126, instCount);
          }
          node.extensions = {
            ...(node.extensions || {}),
            EXT_mesh_gpu_instancing: {attributes: instAttrs},
          };
          nodeExtensionsUsed.add('EXT_mesh_gpu_instancing');
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
    parentKids.push(nodeIdx);

    const kids = obj.children;
    if (Array.isArray(kids) && kids.length > 0) {
      const childIndices: number[] = [];
      node.children = childIndices;
      for (let i = kids.length - 1; i >= 0; i--) {
        nodeStack.push({obj: kids[i], parentKids: childIndices});
      }
    }
  }
  for (let ni = 0; ni < nodes.length; ni++) {
    const n = nodes[ni];
    if (n.children && n.children.length === 0) {
      delete n.children;
    } else if (
      n.children &&
      n.children.length > 0 &&
      (n.extras?.xr?.lod ||
        n.extensions?.ANDROID_xr_scenecore?.lod ||
        (nodeObjects[ni] as {isLOD?: boolean})?.isLOD)
    ) {
      n.extensions = {
        ...(n.extensions || {}),
        MSFT_lod: {ids: [...n.children]},
      };
      nodeExtensionsUsed.add('MSFT_lod');
    }
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

    const saved = nodeObjects.map((o) => [
      finUsd(o.position?.x, 0),
      finUsd(o.position?.y, 0),
      finUsd(o.position?.z, 0),
      finUsd(o.quaternion?.x, 0),
      finUsd(o.quaternion?.y, 0),
      finUsd(o.quaternion?.z, 0),
      finUsd(o.quaternion?.w, 1),
      finUsd(o.scale?.x, 1),
      finUsd(o.scale?.y, 1),
      finUsd(o.scale?.z, 1),
    ]);

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
        posTracks[i][step * 3] = finUsd(o.position?.x, 0);
        posTracks[i][step * 3 + 1] = finUsd(o.position?.y, 0);
        posTracks[i][step * 3 + 2] = finUsd(o.position?.z, 0);
        let qx = finUsd(o.quaternion?.x, 0),
          qy = finUsd(o.quaternion?.y, 0),
          qz = finUsd(o.quaternion?.z, 0),
          qw = finUsd(o.quaternion?.w, 1);
        const qLen = Math.hypot(qx, qy, qz, qw) || 1;
        qx /= qLen;
        qy /= qLen;
        qz /= qLen;
        qw /= qLen;
        if (step > 0) {
          const b = (step - 1) * 4,
            r = rotTracks[i];
          if (r[b] * qx + r[b + 1] * qy + r[b + 2] * qz + r[b + 3] * qw < 0) {
            qx = -qx;
            qy = -qy;
            qz = -qz;
            qw = -qw;
          }
        }
        rotTracks[i][step * 4] = qx;
        rotTracks[i][step * 4 + 1] = qy;
        rotTracks[i][step * 4 + 2] = qz;
        rotTracks[i][step * 4 + 3] = qw;
        sclTracks[i][step * 3] = finUsd(o.scale?.x, 1);
        sclTracks[i][step * 3 + 1] = finUsd(o.scale?.y, 1);
        sclTracks[i][step * 3 + 2] = finUsd(o.scale?.z, 1);
      }
    }

    // Restore original node transforms
    for (let i = 0; i < nodeObjects.length; i++) {
      const o = nodeObjects[i];
      const s = saved[i];
      o.position?.set(s[0], s[1], s[2]);
      o.quaternion?.set(s[3], s[4], s[5], s[6]);
      o.scale?.set(s[7], s[8], s[9]);
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
      const chg = (tr: Float32Array, st: number, off: number) =>
        tr.some((v, k) => Math.abs(v - s[off + (k % st)]) > 1e-4);
      const pushTrack = (
        changed: boolean,
        arr: Float32Array,
        type: string,
        path: string,
      ) => {
        if (!changed) return;
        channels.push({
          sampler:
            samplers.push({
              input: ensureTimeAccessor(),
              interpolation: 'LINEAR',
              output: addAccessor(arr, type, 0, 5126, numSteps),
            }) - 1,
          target: {node: i, path},
        });
      };
      pushTrack(chg(posTracks[i], 3, 0), posTracks[i], 'VEC3', 'translation');
      pushTrack(chg(rotTracks[i], 4, 3), rotTracks[i], 'VEC4', 'rotation');
      pushTrack(chg(sclTracks[i], 3, 7), sclTracks[i], 'VEC3', 'scale');
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

  const audioClips: Array<{uri: string}> = [];
  const audioSources: Array<Record<string, unknown>> = [];
  const audioEmitters: Array<Record<string, unknown>> = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const parsedAe = readAudioEmitter(node.extras?.xr);
    if (!parsedAe) continue;
    const {ae, src, preset, volume, loop, isGlobal} = parsedAe;
    const nodeName = node.name || `Node_${i}`;
    const sourceIdx = audioSources.length;
    audioSources.push({
      name: `${nodeName}_source`,
      gain: volume,
      loop,
      autoPlay: typeof ae.autoplay === 'boolean' ? ae.autoplay : true,
      ...(src !== undefined ? {audio: audioClips.push({uri: src}) - 1} : {}),
      ...(preset
        ? {extras: {preset, pitch: clampUsd(ae.pitch, 0.25, 4, 1)}}
        : {}),
    });
    const emitterIdx = audioEmitters.length;
    const refDistance = clampUsd(ae.refDistance, 0.05, 100, 1);
    const coneInnerDeg = clampUsd(ae.coneInnerAngle, 0, 360, 360);
    const coneOuterDeg = clampUsd(ae.coneOuterAngle, coneInnerDeg, 360, 360);
    audioEmitters.push({
      name: `${nodeName}_emitter`,
      type: isGlobal ? 'global' : 'positional',
      gain: volume,
      sources: [sourceIdx],
      ...(isGlobal
        ? {}
        : {
            positional: {
              distanceModel:
                ae.distanceModel === 'linear' ||
                ae.distanceModel === 'exponential'
                  ? ae.distanceModel
                  : 'inverse',
              refDistance,
              maxDistance: clampUsd(
                ae.maxDistance,
                refDistance,
                500,
                Math.max(refDistance, 25),
              ),
              rolloffFactor: clampUsd(ae.rolloffFactor, 0, 10, 1),
              coneInnerAngle: +((coneInnerDeg * Math.PI) / 180).toFixed(6),
              coneOuterAngle: +((coneOuterDeg * Math.PI) / 180).toFixed(6),
              coneOuterGain: clampUsd(ae.coneOuterGain, 0, 1, 0),
            },
          }),
    });
    node.extensions = {
      ...(node.extensions || {}),
      KHR_audio_emitter: {emitter: emitterIdx},
    };
    nodeExtensionsUsed.add('KHR_audio_emitter');
  }

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
    ...(images.length > 0 ? {images} : {}),
    ...(samplers.length > 0 ? {samplers} : {}),
    ...(textures.length > 0 ? {textures} : {}),
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
    ...(interactivityExt || variantNames.length > 0 || audioEmitters.length > 0
      ? {
          extensions: {
            ...(interactivityExt ? {KHR_interactivity: interactivityExt} : {}),
            ...(variantNames.length > 0
              ? {
                  KHR_materials_variants: {
                    variants: variantNames.map((name) => ({name})),
                  },
                }
              : {}),
            ...(audioEmitters.length > 0
              ? {
                  KHR_audio_emitter: {
                    ...(audioClips.length > 0 ? {audio: audioClips} : {}),
                    sources: audioSources,
                    emitters: audioEmitters,
                  },
                }
              : {}),
          },
        }
      : {}),
  };

  const bin = new Uint8Array(byteOffset);
  let offset = 0;
  for (const b of buffers) {
    bin.set(b, offset);
    offset += b.byteLength;
  }

  return [
    {
      gltf,
      bin: bin.buffer,
      lights,
      environmentIntensity: scene.environmentIntensity,
    },
    nodeObjects,
  ];
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

export function extractMeshesFromScene(
  scene: Scene,
  options?: ConvertAnimOptions,
): USDAMeshData[] {
  const [glb, rawNodes] = serializeScene(scene, options);
  return extractMeshesFromGLB(glb, rawNodes);
}

// =========================================================================
// 4. GLB Mesh Extraction for USDZ
// =========================================================================

/**
 * Extracts hierarchical node and mesh data from GLBData for USDA serialization.
 */
export function extractMeshesFromGLB(
  glb: GLBData,
  rawNodes?: Object3D[],
): USDAMeshData[] {
  const result: USDAMeshData[] = [];
  const gltf = glb.gltf;
  const meshoptDec = getSharedRegistry().decoders.get('meshopt');
  if (meshoptDec && typeof meshoptDec.decodeBufferViews === 'function') {
    meshoptDec.decodeBufferViews(gltf, glb);
  }
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
  const gltfTextures = gltf.textures || [];
  const gltfImages = gltf.images || [];
  const gltfSamplers = gltf.samplers || [];
  const usedMatNames = new Set<string>();
  const matIdNames: string[] = materials.map((m: any, idx: number) =>
    uniqName(usedMatNames, sanitizeUsdIdentifier(m?.name, `Material_${idx}`)),
  );
  const imgCache = new Map<number, {file: string; data: Uint8Array} | null>();

  function decodeB64DataUri(uri: string): Uint8Array | null {
    const m =
      /^data:image\/(png|jpe?g)(?:;[^,]*)?;base64,([A-Za-z0-9+/=\s]+)$/i.exec(
        uri,
      );
    if (!m) return null;
    const clean = m[2].replace(/\s+/g, '');
    const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    const out = new Uint8Array(((clean.length * 3) >> 2) - pad);
    const b64v = (i: number) => {
      const c = clean.charCodeAt(i);
      return c > 96
        ? c - 71
        : c > 64
          ? c - 65
          : c > 47
            ? c + 4
            : c === 43
              ? 62
              : c === 47
                ? 63
                : 0;
    };
    let p = 0;
    for (let i = 0; i < clean.length; i += 4) {
      const n =
        (b64v(i) << 18) | (b64v(i + 1) << 12) | (b64v(i + 2) << 6) | b64v(i + 3);
      out[p++] = (n >> 16) & 255;
      if (p < out.length) out[p++] = (n >> 8) & 255;
      if (p < out.length) out[p++] = n & 255;
    }
    return out;
  }

  function resolveTex(
    info: any,
    scale?: [number, number, number, number],
    bias?: [number, number, number, number],
  ): USDAMeshTexture | undefined {
    const tIdx = info?.index;
    if (typeof tIdx !== 'number') return undefined;
    const tDef = gltfTextures[tIdx];
    const imgIdx = tDef?.source;
    if (typeof imgIdx !== 'number' || !gltfImages[imgIdx]) return undefined;
    let cached = imgCache.get(imgIdx);
    if (cached === undefined) {
      cached = null;
      const imgDef = gltfImages[imgIdx];
      let bytes: Uint8Array | null = null;
      if (typeof imgDef.bufferView === 'number') {
        const bv = bufferViews[imgDef.bufferView];
        const off = bv?.byteOffset || 0;
        const len = bv?.byteLength || 0;
        if (bv && len > 0 && off >= 0 && off + len <= binBuffer.byteLength) {
          bytes = new Uint8Array(binBuffer, off, len);
        }
      } else if (typeof imgDef.uri === 'string') {
        bytes = decodeB64DataUri(imgDef.uri);
      }
      if (bytes && bytes.byteLength > 0) {
        const isJpg =
          (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
          (!(bytes[0] === 0x89 && bytes[1] === 0x50) &&
            /jpe?g/i.test(imgDef.mimeType || imgDef.uri || ''));
        cached = {
          file: `texture_${imgIdx}.${isJpg ? 'jpg' : 'png'}`,
          data: bytes,
        };
      }
      imgCache.set(imgIdx, cached);
    }
    if (!cached) return undefined;
    const samp =
      typeof tDef.sampler === 'number' ? gltfSamplers[tDef.sampler] : undefined;
    const wrap = (w?: number): 'repeat' | 'clamp' | 'mirror' =>
      w === 33071 ? 'clamp' : w === 33648 ? 'mirror' : 'repeat';
    return {
      file: cached.file,
      data: cached.data,
      wrapS: wrap(samp?.wrapS),
      wrapT: wrap(samp?.wrapT),
      ...(scale ? {scale} : {}),
      ...(bias ? {bias} : {}),
    };
  }

  function getBufferSlice(accessorIndex: number): {
    acc: any;
    buffer: ArrayBuffer;
  } {
    const acc = accessors[accessorIndex];
    if (!acc) throw new Error(`Accessor ${accessorIndex} not found`);
    const bv = bufferViews[acc.bufferView || 0];
    const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const byteLength = bv.byteLength || 0;
    return {acc, buffer: binBuffer.slice(byteOffset, byteOffset + byteLength)};
  }

  function extractPrimitives(
    meshIdx: number,
    instanceName: string,
    nodeXr?: XRMeshTraits,
    invisible?: boolean,
  ): USDAMeshData[] {
    const out: USDAMeshData[] = [];
    const mesh = meshes[meshIdx];
    if (!mesh) return out;
    const prims = mesh.primitives || [];
    for (let pIdx = 0; pIdx < prims.length; pIdx++) {
      const prim = prims[pIdx];
      const posAccIdx = prim.attributes?.POSITION;
      if (posAccIdx === undefined) continue;

      const {acc: posAcc, buffer: posBuf} = getBufferSlice(posAccIdx);
      const positions = new Float32Array(posBuf, 0, posAcc.count * 3);

      let normals: Float32Array | undefined;
      const normAccIdx = prim.attributes?.NORMAL;
      if (normAccIdx !== undefined) {
        const {acc: normAcc, buffer: normBuf} = getBufferSlice(normAccIdx);
        const rawNormals = new Float32Array(normBuf, 0, normAcc.count * 3);
        normals = new Float32Array(rawNormals.length);
        for (let i = 0; i < normAcc.count; i++) {
          const nx = rawNormals[i * 3];
          const ny = rawNormals[i * 3 + 1];
          const nz = rawNormals[i * 3 + 2];
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
        indices =
          idxAcc.componentType === 5125
            ? new Uint32Array(idxBuf, 0, idxAcc.count)
            : new Uint16Array(idxBuf, 0, idxAcc.count);
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
      let color: [number, number, number] = [1, 1, 1];
      let roughness = 0.5;
      let metallic = 0.0;
      let clearcoat = 0.0;
      let clearcoatRoughness = 0.0;
      let ior = 1.5;
      let opacity = 1.0;
      let emissiveColor: [number, number, number] = [0, 0, 0];
      let textures: Array<USDAMeshTexture | undefined> | undefined;

      if (prim.material !== undefined && materials[prim.material]) {
        const mat = materials[prim.material];
        materialName = matIdNames[prim.material] || `Material_${prim.material}`;
        const pbr = mat.pbrMetallicRoughness || {};
        const rgb3 = (
          a: unknown,
          fb: [number, number, number],
        ): [number, number, number] =>
          Array.isArray(a) && a.length >= 3 ? [a[0], a[1], a[2]] : fb;
        color = rgb3(pbr.baseColorFactor, [1, 1, 1]);
        const baseOp =
          Array.isArray(pbr.baseColorFactor) &&
          typeof pbr.baseColorFactor[3] === 'number'
            ? pbr.baseColorFactor[3]
            : 1;
        const hasColorScale =
          color[0] !== 1 || color[1] !== 1 || color[2] !== 1 || baseOp !== 1;
        const dt = resolveTex(
          pbr.baseColorTexture,
          hasColorScale ? [color[0], color[1], color[2], baseOp] : undefined,
        );
        const avgColor = mat.extras?.avgColor;
        if (!dt && Array.isArray(avgColor) && avgColor.length >= 3) {
          color = [
            color[0] * avgColor[0],
            color[1] * avgColor[1],
            color[2] * avgColor[2],
          ];
        }
        if (typeof pbr.roughnessFactor === 'number')
          roughness = pbr.roughnessFactor;
        if (typeof pbr.metallicFactor === 'number')
          metallic = pbr.metallicFactor;
        const rf =
          typeof pbr.roughnessFactor === 'number' ? pbr.roughnessFactor : 1;
        const mf =
          typeof pbr.metallicFactor === 'number' ? pbr.metallicFactor : 1;
        const mrt = resolveTex(
          pbr.metallicRoughnessTexture,
          rf !== 1 || mf !== 1 ? [1, rf, mf, 1] : undefined,
        );
        emissiveColor = rgb3(mat.emissiveFactor, [0, 0, 0]);
        const hasEmissive =
          emissiveColor[0] > 0 || emissiveColor[1] > 0 || emissiveColor[2] > 0;
        const emScale: [number, number, number, number] | undefined =
          hasEmissive &&
          (emissiveColor[0] !== 1 ||
            emissiveColor[1] !== 1 ||
            emissiveColor[2] !== 1)
            ? [emissiveColor[0], emissiveColor[1], emissiveColor[2], 1]
            : undefined;
        const et = resolveTex(mat.emissiveTexture, emScale);
        const nt = resolveTex(mat.normalTexture, [2, 2, 2, 1], [-1, -1, -1, 0]);
        const ot = resolveTex(mat.occlusionTexture);
        if (dt || mrt || nt || et || ot) textures = [dt, mrt, nt, et, ot];
        const ext = mat.extensions || {};
        if (ext.KHR_materials_clearcoat) {
          clearcoat = ext.KHR_materials_clearcoat.clearcoatFactor ?? 0;
          clearcoatRoughness =
            ext.KHR_materials_clearcoat.clearcoatRoughnessFactor ?? 0;
        }
        if (typeof ext.KHR_materials_ior?.ior === 'number') {
          ior = ext.KHR_materials_ior.ior;
        }
        opacity =
          baseOp * (1 - (ext.KHR_materials_transmission?.transmissionFactor ?? 0));
      }

      out.push({
        name: prims.length > 1 ? `${instanceName}_p${pIdx}` : instanceName,
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
        ...(textures ? {textures} : {}),
        xrTraits: nodeXr || mesh.extras?.xr,
        ...(invisible ? {invisible: true} : {}),
      });
    }
    return out;
  }

  if (nodes.length > 0) {
    const emptyF32 = new Float32Array(0);
    const emptyU16 = new Uint16Array(0);
    const readVec = (aIdx: number | undefined, stride: number) => {
      if (aIdx === undefined) return null;
      const {acc, buffer} = getBufferSlice(aIdx);
      return new Float32Array(buffer, 0, acc.count * stride);
    };
    const v3 = (a: unknown, fb: number): [number, number, number] =>
      Array.isArray(a) && a.length >= 3
        ? [finUsd(a[0], fb), finUsd(a[1], fb), finUsd(a[2], fb)]
        : [fb, fb, fb];
    const slice3 = (
      b: Float32Array | null,
      k: number,
      fb: [number, number, number],
    ): [number, number, number] =>
      b && b.length >= (k + 1) * 3
        ? [b[k * 3]!, b[k * 3 + 1]!, b[k * 3 + 2]!]
        : fb;
    const slice4 = (
      b: Float32Array | null,
      k: number,
      fb: [number, number, number, number],
    ): [number, number, number, number] =>
      b && b.length >= (k + 1) * 4
        ? [b[k * 4]!, b[k * 4 + 1]!, b[k * 4 + 2]!, b[k * 4 + 3]!]
        : fb;

    const animByNode = new Map<
      number,
      {input: number; t?: number; r?: number; s?: number}
    >();
    const anim0 = gltf.animations?.[0];
    if (anim0 && Array.isArray(anim0.channels) && Array.isArray(anim0.samplers)) {
      for (const ch of anim0.channels) {
        const samp = anim0.samplers[ch?.sampler];
        const nIdx = ch?.target?.node;
        const p = ch?.target?.path;
        if (!samp || typeof nIdx !== 'number' || samp.input === undefined) continue;
        let rec = animByNode.get(nIdx);
        if (!rec) {
          rec = {input: samp.input};
          animByNode.set(nIdx, rec);
        }
        if (p === 'translation') rec.t = samp.output;
        else if (p === 'rotation') rec.r = samp.output;
        else if (p === 'scale') rec.s = samp.output;
      }
    }

    let rootIndices: number[] =
      gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? [];
    if (!Array.isArray(rootIndices) || rootIndices.length === 0) {
      const childSet = new Set<number>();
      for (const n of nodes) {
        if (Array.isArray(n?.children)) {
          for (const c of n.children) childSet.add(c);
        }
      }
      rootIndices = [];
      for (let i = 0; i < nodes.length; i++) {
        if (!childSet.has(i)) rootIndices.push(i);
      }
      if (rootIndices.length === 0) rootIndices = [0];
    }

    const seenNodes = new Set<number>();
    const stack: Array<{idx: number; out: USDAMeshData[]}> = [];
    const pushNodeIndices = (indices: unknown, out: USDAMeshData[]) => {
      if (!Array.isArray(indices)) return;
      for (let i = indices.length - 1; i >= 0; i--) {
        stack.push({idx: indices[i], out});
      }
    };
    pushNodeIndices(rootIndices, result);

    while (stack.length > 0) {
      const {idx: nIdx, out} = stack.pop()!;
      if (
        typeof nIdx !== 'number' ||
        nIdx < 0 ||
        nIdx >= nodes.length ||
        seenNodes.has(nIdx)
      ) {
        continue;
      }
      seenNodes.add(nIdx);
      const node = nodes[nIdx];
      if (!node) continue;

      let translation: [number, number, number] = [0, 0, 0];
      let rotation: [number, number, number, number] = [0, 0, 0, 1];
      let scale: [number, number, number] = [1, 1, 1];
      if (Array.isArray(node.matrix) && node.matrix.length === 16) {
        const trs = decomposeMat4ToTRS(node.matrix);
        translation = trs.t;
        rotation = trs.r;
        scale = trs.s;
      } else {
        translation = v3(node.translation, 0);
        if (Array.isArray(node.rotation) && node.rotation.length >= 4) {
          rotation = [
            finUsd(node.rotation[0], 0),
            finUsd(node.rotation[1], 0),
            finUsd(node.rotation[2], 0),
            finUsd(node.rotation[3], 1),
          ];
        }
        scale = v3(node.scale, 1);
      }

      let timeSamples: USDAMeshTimeSamples | undefined;
      const anim = animByNode.get(nIdx);
      if (anim) {
        const timesBuf = readVec(anim.input, 1);
        if (timesBuf && timesBuf.length > 0) {
          const tBuf = readVec(anim.t, 3);
          const rBuf = readVec(anim.r, 4);
          const sBuf = readVec(anim.s, 3);
          const times = Array.from(timesBuf);
          const translations: Array<[number, number, number]> = [];
          const rotations: Array<[number, number, number, number]> = [];
          const scales: Array<[number, number, number]> = [];
          for (let k = 0; k < timesBuf.length; k++) {
            translations.push(slice3(tBuf, k, translation));
            rotations.push(slice4(rBuf, k, rotation));
            scales.push(slice3(sBuf, k, scale));
          }
          timeSamples = {times, translations, rotations, scales};
        }
      }

      const rawKids = Array.isArray(node.children) ? node.children : [];
      const hasMesh =
        typeof node.mesh === 'number' &&
        node.mesh >= 0 &&
        node.mesh < meshes.length;
      const nodeXr: XRMeshTraits | undefined =
        rawNodes?.[nIdx]?.userData?.xr ?? node.extras?.xr;
      if (
        !hasMesh &&
        rawKids.length === 0 &&
        (node.camera !== undefined ||
          node.extensions?.KHR_lights_punctual ||
          (!node.name && !node.extras && !nodeXr && !timeSamples))
      ) {
        continue;
      }

      const mkXform = (
        name: string,
        children: USDAMeshData[],
        invisible?: boolean,
      ): USDAMeshData => ({
        name,
        positions: emptyF32,
        indices: emptyU16,
        isXform: true,
        xrTraits: nodeXr,
        timeSamples,
        translation,
        rotation,
        scale,
        children,
        ...(invisible ? {invisible: true} : {}),
      });
      const isInvisible =
        node.visible === false ||
        node.extensions?.KHR_node_visibility?.visible === false ||
        rawNodes?.[nIdx]?.visible === false;

      if (hasMesh) {
        const instanceName =
          node.name || meshes[node.mesh]?.name || `Mesh_${nIdx}`;
        const primMeshes = extractPrimitives(
          node.mesh,
          instanceName,
          nodeXr,
          isInvisible,
        );
        const instExt = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
        if (instExt && typeof instExt === 'object' && primMeshes.length > 0) {
          const tData = readVec(instExt.TRANSLATION, 3);
          const rData = readVec(instExt.ROTATION, 4);
          const sData = readVec(instExt.SCALE, 3);
          const cData = readVec(instExt._COLOR_0, 3);
          const instCount = Math.min(
            1000,
            tData
              ? tData.length / 3
              : rData
                ? rData.length / 4
                : sData
                  ? sData.length / 3
                  : 0,
          );
          if (instCount > 0) {
            const children: USDAMeshData[] = [];
            for (let inst = 0; inst < instCount; inst++) {
              const t = slice3(tData, inst, [0, 0, 0]);
              const r = slice4(rData, inst, [0, 0, 0, 1]);
              const s = slice3(sData, inst, [1, 1, 1]);
              for (const pm of primMeshes) {
                const baseCol = pm.color || [0.8, 0.8, 0.8];
                const hasCol = cData && cData.length >= (inst + 1) * 3;
                children.push({
                  ...pm,
                  name: `${pm.name}_${inst}`,
                  materialName: hasCol
                    ? `${pm.materialName}_inst_${inst}`
                    : pm.materialName,
                  color: hasCol
                    ? [
                        baseCol[0] * cData![inst * 3]!,
                        baseCol[1] * cData![inst * 3 + 1]!,
                        baseCol[2] * cData![inst * 3 + 2]!,
                      ]
                    : pm.color,
                  translation: t,
                  rotation: r,
                  scale: s,
                });
              }
            }
            pushNodeIndices(rawKids, children);
            out.push(mkXform(instanceName, children, isInvisible));
            continue;
          }
        }

        if (primMeshes.length === 1) {
          primMeshes[0].translation = translation;
          primMeshes[0].rotation = rotation;
          primMeshes[0].scale = scale;
          primMeshes[0].timeSamples = timeSamples;
          if (rawKids.length > 0) {
            primMeshes[0].children = [];
            pushNodeIndices(rawKids, primMeshes[0].children);
          }
          out.push(primMeshes[0]);
        } else {
          const children = [...primMeshes];
          pushNodeIndices(rawKids, children);
          out.push(mkXform(instanceName, children, isInvisible));
        }
      } else {
        const children: USDAMeshData[] = [];
        pushNodeIndices(rawKids, children);
        out.push(mkXform(node.name || `Group_${nIdx}`, children, isInvisible));
      }
    }
  } else {
    for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
      const meshName = meshes[mIdx].name || `Mesh_${mIdx}`;
      result.push(
        ...extractPrimitives(mIdx, meshName, meshes[mIdx].extras?.xr),
      );
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

const f3 = (a: number, b: number, c: number): string =>
  `(${formatNum(a)}, ${formatNum(b)}, ${formatNum(c)})`;
const f4 = (a: number, b: number, c: number, d: number): string =>
  `(${formatNum(a)}, ${formatNum(b)}, ${formatNum(c)}, ${formatNum(d)})`;

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
    parts[i] = f3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
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
 * Generates valid Universal Scene Description ASCII (.usda) text from mesh/node data.
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
      textures?: Array<USDAMeshTexture | undefined>;
    }
  >();

  let maxTimeCode = 0;
  let rootAnchorPlane: string | null = null;
  const scanStack: USDAMeshData[] = [...meshes];
  while (scanStack.length > 0) {
    const m = scanStack.pop()!;
    const hasMeshGeo = !m.isXform && m.positions && m.positions.length > 0;
    if (hasMeshGeo) {
      const matName = sanitizeUsdIdentifier(m.materialName, 'DefaultMaterial');
      if (!materialsMap.has(matName)) {
        materialsMap.set(matName, {
          color: m.color || [1, 1, 1],
          roughness: m.roughness ?? 0.5,
          metallic: m.metallic ?? 0.0,
          clearcoat: m.clearcoat ?? 0.0,
          clearcoatRoughness: m.clearcoatRoughness ?? 0.0,
          ior: m.ior ?? 1.5,
          opacity: m.opacity ?? 1.0,
          emissiveColor: m.emissiveColor || [0, 0, 0],
          textures: m.textures,
        });
      }
    }
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
    if (m.children) {
      for (let i = m.children.length - 1; i >= 0; i--) {
        scanStack.push(m.children[i]);
      }
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
    const matPath = `/Root/Materials/${matName}`;
    const [dt, mrt, nt, et, ot] = matProps.textures || [];
    const conn = (n: string, o: string) => `.connect = <${matPath}/${n}.outputs:${o}>`;
    const diffuseLine = dt
      ? `color3f inputs:diffuseColor${conn('DiffuseTexture', 'rgb')}`
      : `color3f inputs:diffuseColor = ${f3(r, g, b)}`;
    const mrLines = mrt
      ? `float inputs:metallic${conn('MetallicRoughnessTexture', 'b')}\nfloat inputs:roughness${conn('MetallicRoughnessTexture', 'g')}`
      : `float inputs:metallic = ${formatNum(matProps.metallic)}\nfloat inputs:roughness = ${formatNum(matProps.roughness)}`;
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
    if (et) {
      extraInputs += `color3f inputs:emissiveColor${conn('EmissiveTexture', 'rgb')}\n`;
    } else if (er > 0 || eg > 0 || eb > 0) {
      extraInputs += `color3f inputs:emissiveColor = ${f3(er, eg, eb)}\n`;
    }
    if (nt) {
      extraInputs += `normal3f inputs:normal${conn('NormalTexture', 'rgb')}\n`;
    }
    if (ot) {
      extraInputs += `float inputs:occlusion${conn('OcclusionTexture', 'r')}\n`;
    }
    let texShaders = '';
    if (dt || mrt || nt || et || ot) {
      texShaders += `def Shader "PrimvarReader"\n{\nuniform token info:id = "UsdPrimvarReader_float2"\nstring inputs:varname = "st"\nfloat2 outputs:result\n}\n`;
      const emitTex = (
        nodeName: string,
        tex: USDAMeshTexture | undefined,
        cs: 'sRGB' | 'raw',
        outs: string,
      ) => {
        if (!tex) return;
        const sc = tex.scale
          ? `float4 inputs:scale = ${f4(tex.scale[0], tex.scale[1], tex.scale[2], tex.scale[3])}\n`
          : '';
        const bi = tex.bias
          ? `float4 inputs:bias = ${f4(tex.bias[0], tex.bias[1], tex.bias[2], tex.bias[3])}\n`
          : '';
        texShaders += `def Shader "${nodeName}"\n{\nuniform token info:id = "UsdUVTexture"\nasset inputs:file = @${sanitizeUsdStringLiteral(tex.file)}@\nfloat2 inputs:st${conn('PrimvarReader', 'result')}\ntoken inputs:sourceColorSpace = "${cs}"\ntoken inputs:wrapS = "${tex.wrapS || 'repeat'}"\ntoken inputs:wrapT = "${tex.wrapT || 'repeat'}"\n${sc}${bi}${outs}}\n`;
      };
      emitTex('DiffuseTexture', dt, 'sRGB', 'float3 outputs:rgb\n');
      emitTex(
        'MetallicRoughnessTexture',
        mrt,
        'raw',
        'float outputs:g\nfloat outputs:b\n',
      );
      emitTex('NormalTexture', nt, 'raw', 'float3 outputs:rgb\n');
      emitTex('EmissiveTexture', et, 'sRGB', 'float3 outputs:rgb\n');
      emitTex('OcclusionTexture', ot, 'raw', 'float outputs:r\n');
    }
    usda += `def Material "${matName}"
{
def Shader "PBRShader"
{
uniform token info:id = "UsdPreviewSurface"
${diffuseLine}
${mrLines}
${extraInputs}token outputs:surface
}
token outputs:surface${conn('PBRShader', 'surface')}
${texShaders}}
`;
  }

  usda += `}
def Scope "Meshes"
{
`;

  const formatPrimMeta = (
    xr: XRMeshTraits | undefined,
    isMesh: boolean,
    invisible?: boolean,
  ): {header: string; body: string; tail: string} => {
    const schemas: string[] = [];
    if (isMesh) schemas.push('"MaterialBindingAPI"');
    const hasRigidBody = Boolean(
      xr?.rigidBody &&
        xr.rigidBody !== 'none' &&
        (typeof xr.rigidBody !== 'object' || xr.rigidBody.enabled !== false),
    );
    const hasPhysics = Boolean(
      (xr?.physics && xr.physics !== 'none') || hasRigidBody,
    );
    if (hasPhysics) {
      schemas.push(
        ...(hasRigidBody
          ? [
              '"PhysicsBodyAPI"',
              '"PhysicsRigidBodyAPI"',
              '"PhysicsCollisionAPI"',
              '"PhysicsMassAPI"',
            ]
          : ['"PhysicsBodyAPI"', '"PhysicsCollisionAPI"']),
      );
    }
    const metaLines: string[] = [];
    if (schemas.length > 0) {
      metaLines.push(`prepend apiSchemas = [${schemas.join(', ')}]`);
    }
    if (xr) {
      const xrDictLines: string[] =
        getSharedRegistry().xrTraitSerializer?.usdLines(
          xr,
          sanitizeUsdStringLiteral,
        ) ?? [];
      if (!xrDictLines.length) {
        for (const k of [
          'grab',
          'billboard',
          'follow',
          'anchor',
          'physics',
        ] as const) {
          const v: unknown =
            k === 'follow' && typeof xr.follow === 'object'
              ? (xr.follow.mode ?? 'head')
              : xr[k];
          if (v !== undefined)
            xrDictLines.push(`string ${k} = "${sanitizeUsdStringLiteral(v)}"`);
        }
      }
      if (xrDictLines.length > 0) {
        metaLines.push(
          `customData = {\n  dictionary xr = {\n    ${xrDictLines.join('\n    ')}\n  }\n}`,
        );
      }
    }
    const header = metaLines.length > 0 ? ` (\n${metaLines.join('\n')}\n)` : '';
    let body = invisible ? 'uniform token visibility = "invisible"\n' : '';
    if (hasPhysics) {
      // tslint:disable-next-line:no-any Compact physics trait inspection.
      const rb: any = xr?.rigidBody ?? xr?.physics;
      const mode = rb?.body ?? rb?.mode ?? rb;
      body += `bool physics:rigidBodyEnabled = true\nbool physics:kinematicEnabled = ${mode === 'static' || mode === 'kinematic'}\nbool physics:collisionEnabled = true\n`;
      if (rb?.mass > 0 && Number.isFinite(rb.mass)) {
        body += `float physics:mass = ${formatNum(rb.mass)}\n`;
      }
    }
    const parsedAe = readAudioEmitter(xr);
    const tail = parsedAe
      ? `def SpatialAudio "AudioEmitter"\n{\n${parsedAe.src ? `asset inputs:file = @${sanitizeUsdStringLiteral(parsedAe.src)}@\n` : ''}uniform token inputs:auralMode = "${parsedAe.isGlobal ? 'nonSpatial' : 'spatial'}"\nuniform token inputs:playbackMode = "${parsedAe.loop ? 'loopFromStart' : 'onceFromStart'}"\ndouble gain = ${formatNum(parsedAe.volume)}\n}\n`
      : '';
    return {header, body, tail};
  };

  const formatXformOps = (node: USDAMeshData): string => {
    if (node.timeSamples && node.timeSamples.times.length > 0) {
      const ts = node.timeSamples;
      const fmtTs = <T>(
        arr: T[] | undefined,
        fb: T,
        fn: (v: T) => string,
      ) =>
        ts.times
          .map((t, idx) => `${formatNum(t)}: ${fn(arr?.[idx] || fb)}`)
          .join(', ');
      const tSamples = fmtTs(ts.translations, [0, 0, 0], (p) =>
        f3(p[0], p[1], p[2]),
      );
      const rSamples = fmtTs(ts.rotations, [0, 0, 0, 1], (q) => {
        const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        return f4(q[3] / len, q[0] / len, q[1] / len, q[2] / len);
      });
      const sSamples = fmtTs(ts.scales, [1, 1, 1], (s) =>
        f3(s[0], s[1], s[2]),
      );
      return `double3 xformOp:translate.timeSamples = { ${tSamples} }\nquatf xformOp:orient.timeSamples = { ${rSamples} }\ndouble3 xformOp:scale.timeSamples = { ${sSamples} }\nuniform token[] xformOpOrder = ["xformOp:translate", "xformOp:orient", "xformOp:scale"]\n`;
    }
    const ops: string[] = [];
    let out = '';
    const t = node.translation;
    if (
      t &&
      (Math.abs(t[0]) > 1e-7 || Math.abs(t[1]) > 1e-7 || Math.abs(t[2]) > 1e-7)
    ) {
      out += `double3 xformOp:translate = ${f3(t[0], t[1], t[2])}\n`;
      ops.push('"xformOp:translate"');
    }
    const q = node.rotation;
    if (q) {
      const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
      const qx = q[0] / len,
        qy = q[1] / len,
        qz = q[2] / len,
        qw = q[3] / len;
      if (1 - Math.abs(qw) > 1e-7 || Math.hypot(qx, qy, qz) > 1e-7) {
        out += `quatf xformOp:orient = ${f4(qw, qx, qy, qz)}\n`;
        ops.push('"xformOp:orient"');
      }
    }
    const s = node.scale;
    if (
      s &&
      (Math.abs(s[0] - 1) > 1e-7 ||
        Math.abs(s[1] - 1) > 1e-7 ||
        Math.abs(s[2] - 1) > 1e-7)
    ) {
      out += `float3 xformOp:scale = ${f3(s[0], s[1], s[2])}\n`;
      ops.push('"xformOp:scale"');
    }
    if (ops.length > 0) {
      out += `uniform token[] xformOpOrder = [${ops.join(', ')}]\n`;
    }
    return out;
  };

  const formatMeshBody = (mesh: USDAMeshData): string => {
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
    const faceVertexCountsStr =
      triCount > 0
        ? triCount === 1
          ? '3'
          : '3, '.repeat(triCount - 1) + '3'
        : '';
    let body = `float3[] extent = [${f3(minX, minY, minZ)}, ${f3(maxX, maxY, maxZ)}]
int[] faceVertexCounts = [${faceVertexCountsStr}]
int[] faceVertexIndices = [${formatIndicesArray(mesh.indices)}]
point3f[] points = [${formatPointsArray(mesh.positions)}]
`;
    if (mesh.normals && mesh.normals.length === mesh.positions.length) {
      body += `normal3f[] normals = [${formatPointsArray(mesh.normals)}] (
interpolation = "vertex"
)
`;
    }
    if (mesh.uvs && mesh.uvs.length === posCount * 2) {
      body += `texCoord2f[] primvars:st = [${formatUVsArray(mesh.uvs, posCount)}] (
interpolation = "vertex"
)
`;
    }
    body += `rel material:binding = </Root/Materials/${matBinding}>\n`;
    return body;
  };

  type EmitTask =
    | {close: true}
    | {close?: false; node: USDAMeshData; siblings: Set<string>};
  const rootSiblings = new Set<string>();
  const emitStack: EmitTask[] = [];
  for (let i = meshes.length - 1; i >= 0; i--) {
    emitStack.push({node: meshes[i], siblings: rootSiblings});
  }

  let primIdx = 0;
  while (emitStack.length > 0) {
    const item = emitStack.pop()!;
    if (item.close) {
      usda += `}\n`;
      continue;
    }
    const {node, siblings} = item;
    const isXformOnly = Boolean(node.isXform || node.positions.length === 0);
    const safeName = uniqName(
      siblings,
      sanitizeUsdIdentifier(
        node.name,
        isXformOnly ? `Group_${primIdx}` : `Mesh_${primIdx}`,
      ),
    );
    primIdx++;

    const kids = node.children || [];
    if (isXformOnly) {
      const meta = formatPrimMeta(node.xrTraits, false, node.invisible);
      usda += `def Xform "${safeName}"${meta.header}\n{\n${meta.body}${formatXformOps(node)}${meta.tail}`;
      emitStack.push({close: true});
      const childSiblings = new Set<string>();
      for (let i = kids.length - 1; i >= 0; i--) {
        emitStack.push({node: kids[i], siblings: childSiblings});
      }
    } else if (kids.length > 0) {
      // Avoid nested Gprims: wrap mesh + children inside a parent Xform.
      const xformMeta = formatPrimMeta(node.xrTraits, false, node.invisible);
      const meshChildName = `${safeName}_mesh`;
      usda += `def Xform "${safeName}"${xformMeta.header}\n{\n${xformMeta.body}${formatXformOps(node)}${xformMeta.tail}`;
      usda += `def Mesh "${meshChildName}" (\nprepend apiSchemas = ["MaterialBindingAPI"]\n)\n{\n${formatMeshBody(node)}}\n`;
      emitStack.push({close: true});
      const childSiblings = new Set<string>([meshChildName]);
      for (let i = kids.length - 1; i >= 0; i--) {
        emitStack.push({node: kids[i], siblings: childSiblings});
      }
    } else {
      const meta = formatPrimMeta(node.xrTraits, true, node.invisible);
      usda += `def Mesh "${safeName}"${meta.header}\n{\n${meta.body}${formatXformOps(node)}${formatMeshBody(node)}${meta.tail}}\n`;
    }
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
    const rem = (currentOffset + localHeaderBase) % 64;
    let extraPadding = rem !== 0 ? 64 - rem : 0;
    if (extraPadding > 0 && extraPadding < 4) extraPadding += 64;

    const localHeader = new Uint8Array(localHeaderBase + extraPadding);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true); // PK\x03\x04
    view.setUint16(4, 20, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, uncompressedSize, true);
    view.setUint32(22, uncompressedSize, true);
    view.setUint16(26, filenameBytes.length, true);
    view.setUint16(28, extraPadding, true);
    localHeader.set(filenameBytes, 30);
    if (extraPadding >= 4) {
      view.setUint16(localHeaderBase, 0x1986, true);
      view.setUint16(localHeaderBase + 2, extraPadding - 4, true);
    }

    fileHeaders.push({
      offset: currentOffset,
      size: uncompressedSize,
      crc,
      filenameBytes,
      entry,
    });

    chunks.push(localHeader, entry.data);
    currentOffset += localHeader.length + entry.data.length;
  }

  const centralDirStart = currentOffset;

  for (const h of fileHeaders) {
    const cdRecord = new Uint8Array(46 + h.filenameBytes.length);
    const view = new DataView(cdRecord.buffer);

    view.setUint32(0, 0x02014b50, true); // PK\x01\x02
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(16, h.crc, true);
    view.setUint32(20, h.size, true);
    view.setUint32(24, h.size, true);
    view.setUint16(28, h.filenameBytes.length, true);
    view.setUint32(42, h.offset, true);

    cdRecord.set(h.filenameBytes, 46);
    chunks.push(cdRecord);
    currentOffset += cdRecord.length;
  }

  const centralDirSize = currentOffset - centralDirStart;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // PK\x05\x06
  eocdView.setUint16(8, fileHeaders.length, true);
  eocdView.setUint16(10, fileHeaders.length, true);
  eocdView.setUint32(12, centralDirSize, true);
  eocdView.setUint32(16, centralDirStart, true);

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

function packMeshesToUSDZ(meshes: USDAMeshData[]): Uint8Array {
  const entries: ZipEntry[] = [
    {filename: 'model.usda', data: encodeUtf8(generateUSDAFromMeshes(meshes))},
  ];
  const seenFiles = new Set<string>(['model.usda']);
  const stack: USDAMeshData[] = [...meshes];
  while (stack.length > 0) {
    const m = stack.pop()!;
    for (const tex of m.textures || []) {
      if (tex?.file && tex.data?.byteLength && !seenFiles.has(tex.file)) {
        seenFiles.add(tex.file);
        entries.push({filename: tex.file, data: tex.data});
      }
    }
    if (m.children) {
      for (let i = m.children.length - 1; i >= 0; i--) {
        stack.push(m.children[i]);
      }
    }
  }
  return buildUSDZZip(entries);
}

/**
 * Directly compiles a Three.js Scene into Apple USDZ format with 64-byte alignment.
 */
export function sceneToUSDZ(scene: Scene): Uint8Array {
  return packMeshesToUSDZ(extractMeshesFromScene(scene));
}

/**
 * Converts a pre-existing binary GLB buffer or GLBData into Apple USDZ format.
 */
export function glbToUSDZ(
  glbOrBuffer: GLBData | ArrayBuffer | ArrayBufferView,
): Uint8Array {
  return packMeshesToUSDZ(extractMeshesFromGLB(toGLBData(glbOrBuffer)));
}

/**
 * Universal USDZ generator accepting either Scene, GLBData, or binary buffer.
 */
export function generateUSDZ(source: SceneOrGLBSource): Uint8Array {
  if (source && typeof (source as any).toUSDZ === 'function') {
    return (source as any).toUSDZ();
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
