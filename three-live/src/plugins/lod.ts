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
 * @fileoverview Level of Detail (`lodPlugin`) for `<three-live>` and `<xr-live>`.
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';
import type {LodLevel, LodOptions} from '../xr-trait-schema';

export type {LodLevel, LodOptions};

/** Runtime state for a single LOD group node inside `LodController`. */
export interface LodGroupState {
  readonly nodeIndex: number;
  readonly name: string;
  readonly distances: readonly number[];
  readonly hysteresis: number;
  readonly cullDistance?: number;
  readonly childNodeIndices: readonly number[];
  // tslint:disable-next-line:no-any Heterogeneous viewer MeshGpu records.
  readonly levelMeshes: ReadonlyArray<readonly any[]>;
  activeLevelIndex: number;
  lastDistance: number;
  forcedLevelIndex?: number | null;
}

/**
 * Self-contained installer that attaches `LOD`, `decimateGeometry`, and
 * declarative `userData.xr.lod` mesh materialization onto a `THREE` namespace
 * and shared registry.
 *
 * NOTE: This function is serialized with `Function.prototype.toString()` into
 * sandboxed Web Workers, so it must remain 100% self-contained (do not reference
 * module-scoped imports or variables inside its body, and initialize all class
 * properties inside `constructor` rather than with class field initializers).
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installLodExtension(threeNs?: any, reg?: any): any {
  const clampLocal = (
    val: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number => {
    const n = typeof val === 'number' ? val : Number(val);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  };

  function selectLodLevelIndexLocal(
    distances: readonly number[],
    currentDistance: number,
    previousIndex = 0,
    hysteresis = 0.05,
    cullDistance?: number,
  ): number {
    if (!distances || !distances.length) return -1;
    const thresh = distances[0] > 0 ? [0, ...distances] : distances;
    const d = Number.isFinite(currentDistance)
      ? Math.max(0, currentDistance)
      : 0;
    const h = Number.isFinite(hysteresis)
      ? Math.max(0, Math.min(0.5, hysteresis))
      : 0.05;
    if (
      typeof cullDistance === 'number' &&
      Number.isFinite(cullDistance) &&
      cullDistance > 0
    ) {
      const cullThreshold =
        previousIndex === -1 ? cullDistance * (1 - h) : cullDistance * (1 + h);
      if (d > cullThreshold) return -1;
    }
    let baseIdx = 0;
    for (let i = thresh.length - 1; i >= 1; i--) {
      if (d >= thresh[i]) {
        baseIdx = i;
        break;
      }
    }
    if (
      previousIndex < 0 ||
      previousIndex >= thresh.length ||
      previousIndex === baseIdx
    ) {
      return baseIdx;
    }
    if (baseIdx > previousIndex) {
      let idx = previousIndex;
      for (let i = previousIndex + 1; i <= baseIdx; i++) {
        if (d >= thresh[i] * (1 + h)) {
          idx = i;
        } else {
          break;
        }
      }
      return idx;
    }
    let idx = previousIndex;
    for (let i = previousIndex; i > baseIdx; i--) {
      if (d < thresh[i] * (1 - h)) {
        idx = i - 1;
      } else {
        break;
      }
    }
    return idx;
  }

  function parseLodLocal(raw: unknown): LodOptions | null {
    if (!raw) return null;
    const r: Record<string, unknown> | null =
      raw === true
        ? {distances: [4, 10], ratios: [0.5, 0.25]}
        : Array.isArray(raw)
          ? {distances: raw}
          : typeof raw === 'object'
            ? (raw as Record<string, unknown>)
            : null;
    if (!r || r['enabled'] === false) return null;
    const hysteresis = clampLocal(r['hysteresis'], 0, 0.5, 0.05);
    let levels: LodLevel[] = [];
    let ratios: number[] | undefined;

    if (Array.isArray(r['levels']) && r['levels'].length > 0) {
      const rawLevels = r['levels'].slice(0, 8);
      for (let i = 0; i < rawLevels.length; i++) {
        const lv = rawLevels[i];
        if (!lv || typeof lv !== 'object' || Array.isArray(lv)) continue;
        const lRec = lv as Record<string, unknown>;
        const dist = clampLocal(
          lRec['distance'],
          0,
          10000,
          i === 0 ? 0 : i * 4,
        );
        const h =
          typeof lRec['hysteresis'] === 'number'
            ? clampLocal(lRec['hysteresis'], 0, 0.5, hysteresis)
            : undefined;
        const ratio =
          typeof lRec['ratio'] === 'number'
            ? clampLocal(lRec['ratio'], 0.05, 1, 0.5)
            : undefined;
        const childIndex =
          typeof lRec['childIndex'] === 'number' &&
          Number.isFinite(lRec['childIndex'])
            ? Math.max(0, Math.round(lRec['childIndex']))
            : undefined;
        const node =
          typeof lRec['node'] === 'string' &&
          /^[A-Za-z0-9_.:-]+$/.test(lRec['node'].trim())
            ? lRec['node'].trim().slice(0, 64)
            : undefined;
        levels.push({
          distance: dist,
          ...(h !== undefined ? {hysteresis: h} : {}),
          ...(ratio !== undefined ? {ratio} : {}),
          ...(childIndex !== undefined ? {childIndex} : {}),
          ...(node ? {node} : {}),
        });
      }
      levels.sort((a, b) => a.distance - b.distance);
      if (levels.length > 0 && levels[0].distance > 0) {
        levels.unshift({distance: 0, childIndex: 0});
      }
      let prevD = 0;
      levels = levels.slice(0, 8).map((lv, idx) => {
        const d = idx === 0 ? 0 : Math.max(prevD, lv.distance);
        prevD = d;
        return {...lv, distance: d, childIndex: lv.childIndex ?? idx};
      });
    }

    if (Array.isArray(r['ratios']) && r['ratios'].length > 0) {
      const parsedRatios: number[] = [];
      for (const rv of r['ratios'].slice(0, 7)) {
        if (typeof rv === 'number') {
          parsedRatios.push(clampLocal(rv, 0.05, 1, 0.5));
        }
      }
      if (parsedRatios.length > 0) ratios = parsedRatios;
    }

    if (levels.length === 0) {
      const rawDist = Array.isArray(r['distances']) ? r['distances'] : [];
      const numDist: number[] = [];
      for (const dv of rawDist.slice(0, 8)) {
        if (typeof dv === 'number') {
          numDist.push(clampLocal(dv, 0, 10000, 4));
        }
      }
      if (numDist.length === 0 && ratios && ratios.length > 0) {
        for (let i = 0; i < ratios.length; i++) {
          numDist.push((i + 1) * 4);
        }
      }
      if (numDist.length === 0 && r['cullDistance'] === undefined) {
        return null;
      }
      if (numDist.length === 0 || numDist[0] > 0) {
        numDist.unshift(0);
      } else if (
        ratios &&
        ratios.length === numDist.length &&
        ratios[0] === 1
      ) {
        ratios = ratios.slice(1);
      }
      let prevD = 0;
      for (let i = 0; i < Math.min(8, numDist.length); i++) {
        const d = i === 0 ? 0 : Math.max(prevD, numDist[i]);
        prevD = d;
        const ratio = i > 0 && ratios ? ratios[i - 1] : undefined;
        levels.push({
          distance: d,
          childIndex: i,
          ...(ratio !== undefined ? {ratio} : {}),
        });
      }
    } else if (!ratios) {
      const levelRatios: number[] = [];
      for (let i = 1; i < levels.length; i++) {
        if (typeof levels[i].ratio === 'number') {
          levelRatios.push(levels[i].ratio!);
        }
      }
      if (levelRatios.length > 0) ratios = levelRatios;
    }

    const distances = levels.map((l) => l.distance);
    const maxLevelDist = distances[distances.length - 1] ?? 0;
    const cullDistance =
      r['cullDistance'] !== undefined &&
      r['cullDistance'] !== null &&
      r['cullDistance'] !== false
        ? clampLocal(r['cullDistance'], Math.max(1, maxLevelDist), 10000, 100)
        : undefined;

    return {
      levels,
      distances,
      ...(ratios ? {ratios} : {}),
      hysteresis,
      ...(cullDistance !== undefined ? {cullDistance} : {}),
    };
  }

  /**
   * Simplifies a `BufferGeometry` to approximately `ratio` (`0.05..1.0`) of its
   * original triangle count via fast spatial vertex-grid clustering, preserving
   * smoothed normals and UV coordinates.
   */
  // tslint:disable-next-line:no-any Accepts ThreeAuthor or duck-typed BufferGeometry.
  function decimateGeometryLocal(geom: any, ratio: number): any {
    const posAttr = geom?.attributes?.position;
    if (!posAttr || !posAttr.array || posAttr.count < 3) return geom;
    const r = clampLocal(ratio, 0.05, 1, 0.5);
    const pos = posAttr.array as Float32Array;
    const vCount = posAttr.count;
    const norm = geom.attributes?.normal?.array as Float32Array | undefined;
    const uv = geom.attributes?.uv?.array as Float32Array | undefined;
    const srcIdx = geom.index?.array as Uint16Array | Uint32Array | undefined;
    const triCount = Math.floor((srcIdx ? srcIdx.length : vCount) / 3);
    if (triCount < 1) return geom;

    const targetTris = Math.max(
      1,
      Math.min(triCount, Math.round(triCount * r)),
    );

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < vCount; i++) {
      const px = pos[i * 3];
      const py = pos[i * 3 + 1];
      const pz = pos[i * 3 + 2];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (pz < minZ) minZ = pz;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
      if (pz > maxZ) maxZ = pz;
    }
    const spanX = Math.max(1e-5, maxX - minX);
    const spanY = Math.max(1e-5, maxY - minY);
    const spanZ = Math.max(1e-5, maxZ - minZ);
    const maxSpan = Math.max(spanX, spanY, spanZ);

    const clusterAtGrid = (gridRes: number) => {
      const gx = Math.max(1, Math.round((spanX / maxSpan) * gridRes));
      const gy = Math.max(1, Math.round((spanY / maxSpan) * gridRes));
      const gz = Math.max(1, Math.round((spanZ / maxSpan) * gridRes));
      const cellToCluster = new Map<number, number>();
      const vToCluster = new Int32Array(vCount);
      const sumP: number[] = [];
      const sumN: number[] = [];
      const outUv: number[] = [];
      const counts: number[] = [];

      for (let v = 0; v < vCount; v++) {
        const px = pos[v * 3];
        const py = pos[v * 3 + 1];
        const pz = pos[v * 3 + 2];
        const ix = Math.min(
          gx - 1,
          Math.max(0, Math.floor(((px - minX) / spanX) * gx)),
        );
        const iy = Math.min(
          gy - 1,
          Math.max(0, Math.floor(((py - minY) / spanY) * gy)),
        );
        const iz = Math.min(
          gz - 1,
          Math.max(0, Math.floor(((pz - minZ) / spanZ) * gz)),
        );
        const key = ix + iy * gx + iz * gx * gy;
        let cIdx = cellToCluster.get(key);
        if (cIdx === undefined) {
          cIdx = counts.length;
          cellToCluster.set(key, cIdx);
          sumP.push(px, py, pz);
          if (norm) {
            sumN.push(norm[v * 3], norm[v * 3 + 1], norm[v * 3 + 2]);
          }
          if (uv) {
            outUv.push(uv[v * 2], uv[v * 2 + 1]);
          }
          counts.push(1);
        } else {
          sumP[cIdx * 3] += px;
          sumP[cIdx * 3 + 1] += py;
          sumP[cIdx * 3 + 2] += pz;
          if (norm) {
            sumN[cIdx * 3] += norm[v * 3];
            sumN[cIdx * 3 + 1] += norm[v * 3 + 1];
            sumN[cIdx * 3 + 2] += norm[v * 3 + 2];
          }
          counts[cIdx]++;
        }
        vToCluster[v] = cIdx;
      }

      const tris: number[] = [];
      const seenFaces = new Set<string>();
      for (let t = 0; t < triCount; t++) {
        const a = srcIdx ? srcIdx[t * 3] : t * 3;
        const b = srcIdx ? srcIdx[t * 3 + 1] : t * 3 + 1;
        const c = srcIdx ? srcIdx[t * 3 + 2] : t * 3 + 2;
        const ca = vToCluster[a];
        const cb = vToCluster[b];
        const cc = vToCluster[c];
        if (ca === cb || cb === cc || cc === ca) continue;
        const lo = Math.min(ca, cb, cc);
        const hi = Math.max(ca, cb, cc);
        const mid = ca + cb + cc - lo - hi;
        const faceKey = `${lo}_${mid}_${hi}`;
        if (seenFaces.has(faceKey)) continue;
        seenFaces.add(faceKey);
        tris.push(ca, cb, cc);
      }

      const numClusters = counts.length;
      const outPos = new Float32Array(numClusters * 3);
      const outNorm = norm ? new Float32Array(numClusters * 3) : null;
      for (let c = 0; c < numClusters; c++) {
        const inv = 1 / counts[c];
        outPos[c * 3] = sumP[c * 3] * inv;
        outPos[c * 3 + 1] = sumP[c * 3 + 1] * inv;
        outPos[c * 3 + 2] = sumP[c * 3 + 2] * inv;
        if (outNorm) {
          const nx = sumN[c * 3];
          const ny = sumN[c * 3 + 1];
          const nz = sumN[c * 3 + 2];
          const len = Math.hypot(nx, ny, nz) || 1;
          outNorm[c * 3] = nx / len;
          outNorm[c * 3 + 1] = ny / len;
          outNorm[c * 3 + 2] = nz / len;
        }
      }

      return {
        pos: outPos,
        norm: outNorm,
        uv: uv ? new Float32Array(outUv) : null,
        tris,
        triCount: tris.length / 3,
        vertCount: numClusters,
      };
    };

    const g0 = Math.max(2, Math.round(Math.sqrt(targetTris / 4)));
    let res = clusterAtGrid(g0);
    if (res.triCount > targetTris * 1.25 && g0 > 2) {
      const g1 = Math.max(
        2,
        Math.round(g0 * Math.sqrt(targetTris / res.triCount)),
      );
      if (g1 !== g0) {
        const res1 = clusterAtGrid(g1);
        if (res1.triCount >= Math.min(4, targetTris)) {
          res = res1;
        }
      }
    } else if (res.triCount < Math.min(4, targetTris)) {
      const resFine = clusterAtGrid(Math.max(g0 * 2, 8));
      if (resFine.triCount > res.triCount) {
        res = resFine;
      }
    }

    // If spatial clustering still left more triangles than targetTris (e.g., on
    // a low-segment mesh whose vertices lie at bounding-box extrema), subsample
    // triangles deterministically to honor the requested ratio budget.
    let finalTris = res.tris;
    if (r < 1 && res.triCount > targetTris) {
      const subTris: number[] = [];
      const step = res.triCount / targetTris;
      for (let i = 0; i < targetTris; i++) {
        const srcT = Math.min(res.triCount - 1, Math.floor(i * step));
        subTris.push(
          res.tris[srcT * 3],
          res.tris[srcT * 3 + 1],
          res.tris[srcT * 3 + 2],
        );
      }
      finalTris = subTris;
    }

    // Fallback if all triangles collapsed on an ultra-thin / 1-triangle mesh.
    if (finalTris.length < 3) {
      finalTris = [];
      for (let i = 0; i < targetTris * 3; i++) {
        finalTris.push(srcIdx ? srcIdx[i] : i);
      }
      res = {
        pos: pos.slice(),
        norm: norm ? norm.slice() : null,
        uv: uv ? uv.slice() : null,
        tris: finalTris,
        triCount: targetTris,
        vertCount: vCount,
      };
    }

    const ns =
      threeNs ??
      reg?.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    // tslint:disable-next-line:no-any Resolve BufferGeometry & BufferAttribute ctors.
    const BGCtor: any = ns?.BufferGeometry ?? geom.constructor;
    // tslint:disable-next-line:no-any
    const BACtor: any = ns?.BufferAttribute ?? posAttr.constructor;
    const outGeom = new BGCtor();
    outGeom.setAttribute('position', new BACtor(res.pos, 3));
    if (res.norm) {
      outGeom.setAttribute('normal', new BACtor(res.norm, 3));
    }
    if (res.uv) {
      outGeom.setAttribute('uv', new BACtor(res.uv, 2));
    }
    const indexArray =
      res.vertCount > 65535
        ? new Uint32Array(finalTris)
        : new Uint16Array(finalTris);
    if (typeof outGeom.setIndex === 'function') {
      outGeom.setIndex(new BACtor(indexArray, 1));
    } else {
      outGeom.index = new BACtor(indexArray, 1);
    }
    return outGeom;
  }

  // tslint:disable-next-line:no-any Resolve base Object3D class when available.
  const BaseObject3D: any =
    threeNs?.Object3D ??
    reg?.threeNamespace?.Object3D ??
    class FallbackObject3D {
      declare name: string;
      // tslint:disable-next-line:no-any
      declare position: any;
      // tslint:disable-next-line:no-any
      declare rotation: any;
      // tslint:disable-next-line:no-any
      declare quaternion: any;
      // tslint:disable-next-line:no-any
      declare scale: any;
      declare visible: boolean;
      // tslint:disable-next-line:no-any
      declare parent: any;
      // tslint:disable-next-line:no-any
      declare children: any[];
      // tslint:disable-next-line:no-any
      declare userData: Record<string, any>;
      constructor() {
        this.name = '';
        this.position = {x: 0, y: 0, z: 0};
        this.rotation = {x: 0, y: 0, z: 0};
        this.quaternion = {x: 0, y: 0, z: 0, w: 1};
        this.scale = {x: 1, y: 1, z: 1};
        this.visible = true;
        this.parent = null;
        this.children = [];
        this.userData = {};
      }
      // tslint:disable-next-line:no-any
      add(...objs: any[]): this {
        for (const o of objs) {
          if (o) {
            o.parent = this;
            this.children.push(o);
          }
        }
        return this;
      }
    };

  /**
   * Three.js-compatible `THREE.LOD` level-of-detail scene graph container.
   *
   * Automatically populates `this.userData.xr.lod` so imperative `new THREE.LOD()`
   * exports to `.glb` (`MSFT_lod` + `ANDROID_xr_scenecore.lod`) and `.usdz`
   * (`VariantSet("LOD")`) identically to declarative `userData.xr.lod`.
   */
  class LOD extends BaseObject3D {
    declare readonly isLOD: boolean;
    declare type: string;
    declare autoUpdate: boolean;
    // tslint:disable-next-line:no-any Object3D level entries.
    declare levels: Array<{object: any; distance: number; hysteresis: number}>;
    declare private _currentLevel: number;

    constructor() {
      super();
      this.isLOD = true;
      this.type = 'LOD';
      this.autoUpdate = true;
      this.levels = [];
      this._currentLevel = 0;
    }

    // tslint:disable-next-line:no-any Object3D instance.
    addLevel(object: any, distance = 0, hysteresis = 0.05): this {
      if (!object) return this;
      const d = Math.max(
        0,
        Number.isFinite(Number(distance)) ? Number(distance) : 0,
      );
      const h = clampLocal(hysteresis, 0, 0.5, 0.05);
      let insertIdx = this.levels.length;
      for (let i = 0; i < this.levels.length; i++) {
        if (d < this.levels[i].distance) {
          insertIdx = i;
          break;
        }
      }
      this.levels.splice(insertIdx, 0, {object, distance: d, hysteresis: h});
      this.add(object);
      // Keep children order aligned with sorted LOD levels
      const levelObjs = this.levels.map((l) => l.object);
      const otherChildren = this.children.filter(
        // tslint:disable-next-line:no-any
        (c: any) => !levelObjs.includes(c),
      );
      this.children = [...levelObjs, ...otherChildren];
      for (let i = 0; i < this.levels.length; i++) {
        this.levels[i].object.visible = i === this._currentLevel;
      }
      this.syncUserDataTrait();
      return this;
    }

    getCurrentLevel(): number {
      return this._currentLevel;
    }

    // tslint:disable-next-line:no-any
    getObjectForDistance(distance: number): any | null {
      if (!this.levels.length) return null;
      const idx = selectLodLevelIndexLocal(
        this.levels.map((l) => l.distance),
        distance,
        this._currentLevel,
        this.levels[0]?.hysteresis ?? 0.05,
        this.userData?.xr?.lod?.cullDistance,
      );
      return idx >= 0 && idx < this.levels.length
        ? this.levels[idx].object
        : null;
    }

    // tslint:disable-next-line:no-any Camera or Object3D with position / matrixWorld.
    update(camera: any): void {
      if (this.levels.length === 0 || !camera) return;
      const camPos = camera.position ?? {x: 0, y: 0, z: 0};
      const myPos = this.position ?? {x: 0, y: 0, z: 0};
      const dist = Math.hypot(
        (Number(camPos.x) || 0) - (Number(myPos.x) || 0),
        (Number(camPos.y) || 0) - (Number(myPos.y) || 0),
        (Number(camPos.z) || 0) - (Number(myPos.z) || 0),
      );
      const activeIdx = selectLodLevelIndexLocal(
        this.levels.map((l) => l.distance),
        dist,
        this._currentLevel,
        this.levels[0]?.hysteresis ?? 0.05,
        this.userData?.xr?.lod?.cullDistance,
      );
      this._currentLevel = activeIdx;
      for (let i = 0; i < this.levels.length; i++) {
        this.levels[i].object.visible = i === activeIdx;
      }
    }

    private syncUserDataTrait(): void {
      this.userData = this.userData || {};
      this.userData.xr = this.userData.xr || {};
      const existingCull = this.userData.xr.lod?.cullDistance;
      this.userData.xr.lod = {
        levels: this.levels.map((lv, idx) => ({
          distance: lv.distance,
          hysteresis: lv.hysteresis,
          childIndex: idx,
          ...(lv.object?.name ? {node: lv.object.name} : {}),
        })),
        distances: this.levels.map((lv) => lv.distance),
        hysteresis: this.levels[0]?.hysteresis ?? 0.05,
        ...(existingCull !== undefined ? {cullDistance: existingCull} : {}),
      };
    }
  }

  /**
   * Materializes declarative `mesh.userData.xr.lod` (with `ratios` or `lod: true`)
   * on a single `Mesh` into child LOD meshes (`_LOD0`, `_LOD1`, ...) so that
   * Web, Rust CLI, Android SceneCore, and iOS RealityKit can toggle child
   * level visibility identically to `new THREE.LOD()`.
   */
  // tslint:disable-next-line:no-any
  function materializeLodGeometry(node: any): void {
    if (!node || node._lodMaterialized || !node.userData?.xr?.lod) return;
    if (
      node.isLOD ||
      (Array.isArray(node.children) && node.children.length > 0)
    ) {
      return;
    }
    const posAttr = node.geometry?.attributes?.position;
    if (!posAttr || !posAttr.array || posAttr.count < 3) return;

    const lod = parseLodLocal(node.userData.xr.lod);
    if (!lod || lod.levels.length < 2) {
      return;
    }

    node._lodMaterialized = true;
    const origGeom = node.geometry;
    node._lodOriginalGeometry = origGeom;

    const ns =
      threeNs ??
      reg?.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    // tslint:disable-next-line:no-any
    const MeshCtor: any = ns?.Mesh ?? node.constructor;
    // tslint:disable-next-line:no-any
    const BGCtor: any = ns?.BufferGeometry ?? origGeom.constructor;
    const baseName =
      typeof node.name === 'string' && node.name.trim()
        ? node.name.trim()
        : 'Mesh';

    const child0 = new MeshCtor(origGeom, node.material);
    child0.name = `${baseName}_LOD0`;
    child0.visible = true;
    child0.castShadow = Boolean(node.castShadow);
    child0.receiveShadow = Boolean(node.receiveShadow);
    node.add(child0);

    for (let k = 1; k < lod.levels.length; k++) {
      const ratio =
        lod.levels[k].ratio ??
        lod.ratios?.[k - 1] ??
        Math.max(0.05, Math.pow(0.5, k));
      const decGeom = decimateGeometryLocal(origGeom, ratio);
      const childK = new MeshCtor(decGeom, node.material);
      childK.name = `${baseName}_LOD${k}`;
      childK.visible = false;
      childK.castShadow = Boolean(node.castShadow);
      childK.receiveShadow = Boolean(node.receiveShadow);
      node.add(childK);
    }

    // Convert parent node into a geometry-less LOD container so hiding level 0
    // does not hide child levels 1..K-1 in hierarchical scene graphs.
    node.geometry = new BGCtor();
    node.userData.xr.lod = {
      ...lod,
      levels: lod.levels.map((lv, idx) => ({
        ...lv,
        childIndex: idx,
        node: `${baseName}_LOD${idx}`,
      })),
    };
  }

  const exportsMap = {
    LOD,
    decimateGeometry: decimateGeometryLocal,
    selectLodLevelIndex: selectLodLevelIndexLocal,
    parseLod: parseLodLocal,
    materializeLodGeometry,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, {
      LOD,
      decimateGeometry: decimateGeometryLocal,
    });
    reg._lodMaterialize = materializeLodGeometry;
    // tslint:disable-next-line:no-any
    reg.materializeDeclarativeGeometry = (node: any) => {
      reg._cadMaterialize?.(node);
      reg._lodMaterialize?.(node);
    };
  }

  return exportsMap;
}

const _lodExt = /* @__PURE__ */ installLodExtension();

/**
 * Simplifies a `BufferGeometry` to approximately `ratio` (`0.05..1.0`) of its
 * original triangle count via fast spatial vertex-grid clustering.
 */
export const decimateGeometry = _lodExt.decimateGeometry as <T>(
  geometry: T,
  ratio: number,
) => T;

/**
 * Selects the active LOD level index (`0..distances.length - 1`), or `-1` when
 * culled beyond `cullDistance`, applying a symmetric hysteresis deadband.
 */
export const selectLodLevelIndex = _lodExt.selectLodLevelIndex as (
  distances: readonly number[],
  currentDistance: number,
  previousIndex?: number,
  hysteresis?: number,
  cullDistance?: number,
) => number;

/** Parses a `lod` trait (`true`, distance array, or `{levels?, distances?, ratios?, hysteresis?, cullDistance?}`). */
export const parseLod = _lodExt.parseLod as (raw: unknown) => LodOptions | null;

/** Materializes declarative `userData.xr.lod` child levels on a `THREE.Mesh`. */
export const materializeLodGeometry = _lodExt.materializeLodGeometry as (
  // tslint:disable-next-line:no-any
  node: any,
) => void;

/** Three.js-compatible `THREE.LOD` level-of-detail container class. */
export const LOD = _lodExt.LOD;

const controllers = new WeakMap<object, LodController>();

/** Returns the active `LodController` attached to a `ThreeView` instance. */
// tslint:disable-next-line:no-any Heterogeneous ThreeView instance.
export function getLodController(viewer: any): LodController | undefined {
  return viewer && typeof viewer === 'object'
    ? controllers.get(viewer)
    : undefined;
}

/**
 * Runtime Level-of-Detail controller evaluating camera-to-node Euclidean
 * distances with hysteresis deadbands and toggling child level visibility.
 */
export class LodController {
  readonly groups: LodGroupState[] = [];
  // tslint:disable-next-line:no-any
  private readonly viewer: any;
  // tslint:disable-next-line:no-any
  private readonly gltf: any;

  // tslint:disable-next-line:no-any
  constructor(viewer: any, gltf: any) {
    this.viewer = viewer;
    this.gltf = gltf;
    this.rebuild();
  }

  /** Scans `gltf.nodes` and binds LOD group levels to `viewer.meshes`. */
  rebuild(): void {
    this.groups.length = 0;
    const gNodes = this.gltf?.nodes;
    if (!Array.isArray(gNodes) || gNodes.length === 0) return;

    // Map each glTF node index to all viewer.meshes entries in its subtree.
    // tslint:disable-next-line:no-any
    const meshesByNode = new Map<number, any[]>();
    for (const mesh of this.viewer?.meshes ?? []) {
      if (typeof mesh?.nodeIndex === 'number' && mesh.nodeIndex >= 0) {
        let list = meshesByNode.get(mesh.nodeIndex);
        if (!list) {
          list = [];
          meshesByNode.set(mesh.nodeIndex, list);
        }
        list.push(mesh);
      }
    }

    // tslint:disable-next-line:no-any
    const collectSubtreeMeshes = (rootIdx: number): any[] => {
      // tslint:disable-next-line:no-any
      const out: any[] = [];
      const visited = new Set<number>();
      const stack = [rootIdx];
      while (stack.length > 0) {
        const curr = stack.pop()!;
        if (visited.has(curr) || curr < 0 || curr >= gNodes.length) continue;
        visited.add(curr);
        const direct = meshesByNode.get(curr);
        if (direct) out.push(...direct);
        const ch = gNodes[curr]?.children;
        if (Array.isArray(ch)) {
          for (let i = ch.length - 1; i >= 0; i--) {
            if (typeof ch[i] === 'number') stack.push(ch[i]);
          }
        }
      }
      return out;
    };

    for (let nIdx = 0; nIdx < gNodes.length; nIdx++) {
      const node = gNodes[nIdx];
      if (!node || typeof node !== 'object') continue;
      const rawLod =
        node.extras?.xr?.lod ??
        node.extensions?.ANDROID_xr_scenecore?.lod ??
        node.extensions?.MOZ_hubs_components?.lod;
      const msftIds = Array.isArray(node.extensions?.MSFT_lod?.ids)
        ? (node.extensions.MSFT_lod.ids as unknown[]).filter(
            (id): id is number =>
              typeof id === 'number' &&
              Number.isInteger(id) &&
              id >= 0 &&
              id < gNodes.length,
          )
        : [];

      let lodOpts = parseLod(rawLod);
      if (!lodOpts && msftIds.length > 0) {
        lodOpts = parseLod({
          distances: msftIds.map((_, idx) => idx * 4),
        });
      }
      if (!lodOpts) continue;

      const rawChildren: number[] =
        msftIds.length > 0
          ? msftIds
          : Array.isArray(node.children)
            ? node.children.filter(
                (c: unknown): c is number =>
                  typeof c === 'number' &&
                  Number.isInteger(c) &&
                  c >= 0 &&
                  c < gNodes.length,
              )
            : [];

      const childNodeIndices: number[] = [];
      // tslint:disable-next-line:no-any
      const levelMeshes: any[][] = [];

      if (rawChildren.length > 0) {
        const count = Math.min(rawChildren.length, lodOpts.levels.length);
        for (let i = 0; i < count; i++) {
          const cIdx = rawChildren[i];
          childNodeIndices.push(cIdx);
          levelMeshes.push(collectSubtreeMeshes(cIdx));
        }
      } else {
        const selfMeshes = meshesByNode.get(nIdx) ?? [];
        if (selfMeshes.length === 0) continue;
        childNodeIndices.push(nIdx);
        levelMeshes.push(selfMeshes);
      }

      const distances = lodOpts.distances.slice(0, levelMeshes.length);
      if (distances.length === 0) distances.push(0);

      const state: LodGroupState = {
        nodeIndex: nIdx,
        name: typeof node.name === 'string' ? node.name : `LOD_${nIdx}`,
        distances,
        hysteresis: lodOpts.hysteresis,
        ...(lodOpts.cullDistance !== undefined
          ? {cullDistance: lodOpts.cullDistance}
          : {}),
        childNodeIndices,
        levelMeshes,
        activeLevelIndex: 0,
        lastDistance: 0,
      };
      this.applyGroupVisibility(state, 0);
      this.groups.push(state);
    }
  }

  /** Returns all discovered LOD group states on this viewer. */
  getGroups(): readonly LodGroupState[] {
    return this.groups;
  }

  /**
   * Returns the active LOD level index (`0..K-1`, or `-1` when distance-culled)
   * for a group identified by node name or `gltf.nodes` index, or `null` if not found.
   */
  getActiveLevel(nameOrIndex: string | number): number | null {
    const g = this.findGroup(nameOrIndex);
    return g ? g.activeLevelIndex : null;
  }

  /**
   * Forces a specific LOD level index (`0..K-1`, or `-1` to cull), or passes
   * `null` to restore automatic camera-distance evaluation.
   */
  forceLodLevel(nameOrIndex: string | number, levelIndex: number | null): void {
    const g = this.findGroup(nameOrIndex);
    if (!g) return;
    if (levelIndex === null || levelIndex === undefined) {
      g.forcedLevelIndex = null;
      const restored = selectLodLevelIndex(
        g.distances,
        g.lastDistance,
        g.activeLevelIndex,
        g.hysteresis,
        g.cullDistance,
      );
      g.activeLevelIndex = restored;
      this.applyGroupVisibility(g, restored);
      return;
    }
    const clamped =
      levelIndex < 0
        ? -1
        : Math.min(
            Math.max(0, Math.trunc(levelIndex)),
            g.levelMeshes.length - 1,
          );
    g.forcedLevelIndex = clamped;
    g.activeLevelIndex = clamped;
    this.applyGroupVisibility(g, clamped);
  }

  private findGroup(nameOrIndex: string | number): LodGroupState | undefined {
    if (typeof nameOrIndex === 'number') {
      return (
        this.groups.find((g) => g.nodeIndex === nameOrIndex) ??
        this.groups[nameOrIndex]
      );
    }
    return this.groups.find((g) => g.name === nameOrIndex);
  }

  /**
   * Evaluates camera distance to each LOD group and updates child mesh
   * visibility (`visible` + `KHR_node_visibility`).
   */
  update(cameraPos: readonly [number, number, number]): void {
    if (this.groups.length === 0) return;
    const wmList = this.viewer?.worldMatrices;
    const rootMat = this.viewer?.modelRootMatrix;

    for (const group of this.groups) {
      const wm =
        Array.isArray(wmList) && group.nodeIndex < wmList.length
          ? wmList[group.nodeIndex]
          : null;
      const lx = wm ? wm[12] || 0 : 0;
      const ly = wm ? wm[13] || 0 : 0;
      const lz = wm ? wm[14] || 0 : 0;
      const wx = rootMat
        ? rootMat[0] * lx + rootMat[4] * ly + rootMat[8] * lz + rootMat[12]
        : lx;
      const wy = rootMat
        ? rootMat[1] * lx + rootMat[5] * ly + rootMat[9] * lz + rootMat[13]
        : ly;
      const wz = rootMat
        ? rootMat[2] * lx + rootMat[6] * ly + rootMat[10] * lz + rootMat[14]
        : lz;

      const dist = Math.hypot(
        (cameraPos[0] || 0) - wx,
        (cameraPos[1] || 0) - wy,
        (cameraPos[2] || 0) - wz,
      );
      group.lastDistance = dist;
      if (
        group.forcedLevelIndex !== undefined &&
        group.forcedLevelIndex !== null
      ) {
        if (group.activeLevelIndex !== group.forcedLevelIndex) {
          group.activeLevelIndex = group.forcedLevelIndex;
          this.applyGroupVisibility(group, group.forcedLevelIndex);
        }
        continue;
      }
      const nextIdx = selectLodLevelIndex(
        group.distances,
        dist,
        group.activeLevelIndex,
        group.hysteresis,
        group.cullDistance,
      );
      if (nextIdx !== group.activeLevelIndex) {
        group.activeLevelIndex = nextIdx;
        this.applyGroupVisibility(group, nextIdx);
      }
    }
  }

  private applyGroupVisibility(group: LodGroupState, activeIdx: number): void {
    const gNodes = this.gltf?.nodes;
    for (let i = 0; i < group.levelMeshes.length; i++) {
      const isVis = i === activeIdx;
      for (const mesh of group.levelMeshes[i]) {
        mesh.visible = isVis;
      }
      const cIdx = group.childNodeIndices[i];
      const gNode = Array.isArray(gNodes) ? gNodes[cIdx] : null;
      if (gNode && typeof gNode === 'object') {
        gNode.visible = isVis;
        gNode.extensions = gNode.extensions || {};
        gNode.extensions.KHR_node_visibility = {visible: isVis};
      }
    }
  }
}

/**
 * `<three-live>` and `<xr-live>` plugin registering `THREE.LOD`,
 * `decimateGeometry`, declarative `userData.xr.lod` auto-decimation, and
 * per-frame `LodController` evaluation.
 */
export const lodPlugin: ThreeLivePlugin = {
  name: 'lod',
  onRegister(): void {
    registerWorkerExtensionInstaller(installLodExtension);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    installLodExtension(threeNs, reg);
  },
  // tslint:disable-next-line:no-any
  onLoadModel(viewer: any, gltf: any): void {
    if (!viewer || typeof viewer !== 'object') return;
    controllers.set(viewer, new LodController(viewer, gltf));
  },
  // tslint:disable-next-line:no-any
  onUpdate(viewer: any): void {
    const ctrl = controllers.get(viewer);
    if (!ctrl || typeof viewer?.getCameraOrbit !== 'function') return;
    const orbit = viewer.getCameraOrbit();
    const target =
      typeof viewer.getCameraTarget === 'function'
        ? viewer.getCameraTarget()
        : {x: 0, y: 0, z: 0};
    const r = orbit?.radius ?? 3;
    const phi = orbit?.phi ?? 0;
    const theta = orbit?.theta ?? 0;
    const cosPhi = Math.cos(phi);
    const eyeX = (target.x || 0) + r * cosPhi * Math.sin(theta);
    const eyeY = (target.y || 0) + r * Math.sin(phi);
    const eyeZ = (target.z || 0) + r * cosPhi * Math.cos(theta);
    ctrl.update([eyeX, eyeY, eyeZ]);
  },
  onBeforeDrawScene(
    // tslint:disable-next-line:no-any
    viewer: any,
    _gl: WebGL2RenderingContext,
    _vpMatrix: Float32Array,
    cameraPos: [number, number, number],
  ): void {
    const ctrl = controllers.get(viewer);
    if (ctrl) {
      ctrl.update(cameraPos);
    }
  },
  // tslint:disable-next-line:no-any
  onDestroy(_gl: WebGL2RenderingContext, viewer: any): void {
    if (viewer && typeof viewer === 'object') {
      controllers.delete(viewer);
    }
  },
};
