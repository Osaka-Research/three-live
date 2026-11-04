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
 * @fileoverview Analytic 2-bone law-of-cosines and N-bone FABRIK inverse
 * kinematics solvers and `<three-live>` plugin (`userData.xr.ik`).
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';
import type {IKTraitOptions, TraitVec3} from '../xr-trait-schema';

/** 4-component unit quaternion `[x, y, z, w]`. */
export type IKQuat = [number, number, number, number];

/** Solved joint positions and delta rotations for a 2-bone IK chain. */
export interface TwoBoneIKSolution {
  readonly rootPos: TraitVec3;
  readonly midPos: TraitVec3;
  readonly effectorPos: TraitVec3;
  readonly rootRotation: IKQuat;
  readonly midRotation: IKQuat;
}

/** Solved joint positions and segment delta rotations for an N-bone FABRIK chain. */
export interface FABRIKSolution {
  readonly positions: TraitVec3[];
  readonly rotations: IKQuat[];
  readonly iterations: number;
}

/**
 * Self-contained installer for `THREE.IKSolver` so it can be invoked both on
 * the host thread and inside isolated Web Worker sandboxes via
 * `Function.prototype.toString()`.
 */
// tslint:disable-next-line:no-any Dynamic THREE / registry namespaces across realms.
export function installIKExtension(_threeNs?: any, reg?: any) {
  function clampLocal(
    val: unknown,
    min: number,
    max: number,
    fallback: number,
  ): number {
    const n = typeof val === 'number' ? val : Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function quatFromUnitVectorsLocal(
    fromDir: readonly [number, number, number],
    toDir: readonly [number, number, number],
  ): IKQuat {
    const dot =
      fromDir[0] * toDir[0] + fromDir[1] * toDir[1] + fromDir[2] * toDir[2];
    const r = dot + 1;
    if (r < 1e-6) {
      if (Math.abs(fromDir[0]) > Math.abs(fromDir[2])) {
        const len = Math.hypot(fromDir[1], fromDir[0]) || 1;
        return [-fromDir[1] / len, fromDir[0] / len, 0, 0];
      }
      const len = Math.hypot(fromDir[2], fromDir[1]) || 1;
      return [0, -fromDir[2] / len, fromDir[1] / len, 0];
    }
    const cx = fromDir[1] * toDir[2] - fromDir[2] * toDir[1];
    const cy = fromDir[2] * toDir[0] - fromDir[0] * toDir[2];
    const cz = fromDir[0] * toDir[1] - fromDir[1] * toDir[0];
    const len = Math.hypot(cx, cy, cz, r) || 1;
    return [cx / len, cy / len, cz / len, r / len];
  }

  function solveTwoBoneIKLocal(
    rootPos: readonly [number, number, number],
    midPos: readonly [number, number, number],
    effectorPos: readonly [number, number, number],
    targetPos: readonly [number, number, number],
    polePos?: readonly [number, number, number],
  ): TwoBoneIKSolution {
    const v1x = midPos[0] - rootPos[0];
    const v1y = midPos[1] - rootPos[1];
    const v1z = midPos[2] - rootPos[2];
    const l1 = Math.hypot(v1x, v1y, v1z);

    const v2x = effectorPos[0] - midPos[0];
    const v2y = effectorPos[1] - midPos[1];
    const v2z = effectorPos[2] - midPos[2];
    const l2 = Math.hypot(v2x, v2y, v2z);

    if (l1 < 1e-6 || l2 < 1e-6) {
      return {
        rootPos: [rootPos[0], rootPos[1], rootPos[2]],
        midPos: [midPos[0], midPos[1], midPos[2]],
        effectorPos: [effectorPos[0], effectorPos[1], effectorPos[2]],
        rootRotation: [0, 0, 0, 1],
        midRotation: [0, 0, 0, 1],
      };
    }

    const initDir1: TraitVec3 = [v1x / l1, v1y / l1, v1z / l1];
    const initDir2: TraitVec3 = [v2x / l2, v2y / l2, v2z / l2];

    const tx = targetPos[0] - rootPos[0];
    const ty = targetPos[1] - rootPos[1];
    const tz = targetPos[2] - rootPos[2];
    const rawDist = Math.hypot(tx, ty, tz);

    const dirToTarget: TraitVec3 =
      rawDist > 1e-6 ? [tx / rawDist, ty / rawDist, tz / rawDist] : initDir1;

    const minDist = Math.abs(l1 - l2) + 1e-5;
    const maxDist = Math.max(minDist, l1 + l2 - 1e-5);
    const d = Math.max(
      minDist,
      Math.min(maxDist, rawDist > 1e-6 ? rawDist : minDist),
    );

    const cosAlpha = clampLocal(
      (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d),
      -1,
      1,
      1,
    );
    const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));

    const poleVecX = polePos ? polePos[0] - rootPos[0] : v1x;
    const poleVecY = polePos ? polePos[1] - rootPos[1] : v1y;
    const poleVecZ = polePos ? polePos[2] - rootPos[2] : v1z;

    const projDot =
      poleVecX * dirToTarget[0] +
      poleVecY * dirToTarget[1] +
      poleVecZ * dirToTarget[2];
    let px = poleVecX - dirToTarget[0] * projDot;
    let py = poleVecY - dirToTarget[1] * projDot;
    let pz = poleVecZ - dirToTarget[2] * projDot;
    let pLen = Math.hypot(px, py, pz);

    if (pLen <= 1e-6) {
      const rx = Math.abs(dirToTarget[1]) < 0.99 ? 0 : 1;
      const ry = Math.abs(dirToTarget[1]) < 0.99 ? 1 : 0;
      const rz = 0;
      px = dirToTarget[1] * rz - dirToTarget[2] * ry;
      py = dirToTarget[2] * rx - dirToTarget[0] * rz;
      pz = dirToTarget[0] * ry - dirToTarget[1] * rx;
      pLen = Math.hypot(px, py, pz) || 1;
    }

    const bendDir: TraitVec3 = [px / pLen, py / pLen, pz / pLen];

    const solvedMid: TraitVec3 = [
      rootPos[0] +
        dirToTarget[0] * (l1 * cosAlpha) +
        bendDir[0] * (l1 * sinAlpha),
      rootPos[1] +
        dirToTarget[1] * (l1 * cosAlpha) +
        bendDir[1] * (l1 * sinAlpha),
      rootPos[2] +
        dirToTarget[2] * (l1 * cosAlpha) +
        bendDir[2] * (l1 * sinAlpha),
    ];

    const clampedTarget: TraitVec3 = [
      rootPos[0] + dirToTarget[0] * d,
      rootPos[1] + dirToTarget[1] * d,
      rootPos[2] + dirToTarget[2] * d,
    ];

    const effVecX = clampedTarget[0] - solvedMid[0];
    const effVecY = clampedTarget[1] - solvedMid[1];
    const effVecZ = clampedTarget[2] - solvedMid[2];
    const effLen = Math.hypot(effVecX, effVecY, effVecZ);
    const solvedDir2: TraitVec3 =
      effLen > 1e-6
        ? [effVecX / effLen, effVecY / effLen, effVecZ / effLen]
        : dirToTarget;

    const solvedEffector: TraitVec3 = [
      solvedMid[0] + solvedDir2[0] * l2,
      solvedMid[1] + solvedDir2[1] * l2,
      solvedMid[2] + solvedDir2[2] * l2,
    ];

    const solvedDir1: TraitVec3 = [
      (solvedMid[0] - rootPos[0]) / l1,
      (solvedMid[1] - rootPos[1]) / l1,
      (solvedMid[2] - rootPos[2]) / l1,
    ];

    return {
      rootPos: [rootPos[0], rootPos[1], rootPos[2]],
      midPos: solvedMid,
      effectorPos: solvedEffector,
      rootRotation: quatFromUnitVectorsLocal(initDir1, solvedDir1),
      midRotation: quatFromUnitVectorsLocal(initDir2, solvedDir2),
    };
  }

  function solveFABRIKLocal(
    positions: ReadonlyArray<readonly [number, number, number]>,
    targetPos: readonly [number, number, number],
    maxIterations = 8,
    tolerance = 1e-3,
  ): FABRIKSolution {
    const n = positions.length;
    if (n < 2) {
      return {
        positions: positions.map((p) => [p[0], p[1], p[2]]),
        rotations: [],
        iterations: 0,
      };
    }

    const pts: TraitVec3[] = positions.map((p) => [p[0], p[1], p[2]]);
    const lengths: number[] = [];
    const initDirs: TraitVec3[] = [];
    let totalLength = 0;

    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      const dz = pts[i + 1][2] - pts[i][2];
      const len = Math.hypot(dx, dy, dz);
      lengths.push(len);
      totalLength += len;
      initDirs.push(len > 1e-6 ? [dx / len, dy / len, dz / len] : [0, 1, 0]);
    }

    const root: TraitVec3 = [pts[0][0], pts[0][1], pts[0][2]];
    const maxIters = Math.round(clampLocal(maxIterations, 1, 32, 8));
    const tol = clampLocal(tolerance, 1e-5, 0.1, 1e-3);

    const tx = targetPos[0] - root[0];
    const ty = targetPos[1] - root[1];
    const tz = targetPos[2] - root[2];
    const distToTarget = Math.hypot(tx, ty, tz);

    let usedIters = 0;
    if (distToTarget >= totalLength && totalLength > 1e-6) {
      const dir: TraitVec3 =
        distToTarget > 1e-6
          ? [tx / distToTarget, ty / distToTarget, tz / distToTarget]
          : initDirs[0];
      pts[0] = [root[0], root[1], root[2]];
      for (let i = 0; i < n - 1; i++) {
        const l = lengths[i];
        pts[i + 1] = [
          pts[i][0] + dir[0] * l,
          pts[i][1] + dir[1] * l,
          pts[i][2] + dir[2] * l,
        ];
      }
      usedIters = 1;
    } else {
      for (let iter = 1; iter <= maxIters; iter++) {
        const end = pts[n - 1];
        const err = Math.hypot(
          end[0] - targetPos[0],
          end[1] - targetPos[1],
          end[2] - targetPos[2],
        );
        if (err <= tol) {
          break;
        }
        usedIters = iter;

        pts[n - 1] = [targetPos[0], targetPos[1], targetPos[2]];
        for (let i = n - 2; i >= 0; i--) {
          const dx = pts[i][0] - pts[i + 1][0];
          const dy = pts[i][1] - pts[i + 1][1];
          const dz = pts[i][2] - pts[i + 1][2];
          const d = Math.hypot(dx, dy, dz);
          const l = lengths[i];
          if (d > 1e-6) {
            const scale = l / d;
            pts[i] = [
              pts[i + 1][0] + dx * scale,
              pts[i + 1][1] + dy * scale,
              pts[i + 1][2] + dz * scale,
            ];
          } else {
            const fallback = initDirs[i];
            pts[i] = [
              pts[i + 1][0] - fallback[0] * l,
              pts[i + 1][1] - fallback[1] * l,
              pts[i + 1][2] - fallback[2] * l,
            ];
          }
        }

        pts[0] = [root[0], root[1], root[2]];
        for (let i = 0; i < n - 1; i++) {
          const dx = pts[i + 1][0] - pts[i][0];
          const dy = pts[i + 1][1] - pts[i][1];
          const dz = pts[i + 1][2] - pts[i][2];
          const d = Math.hypot(dx, dy, dz);
          const l = lengths[i];
          if (d > 1e-6) {
            const scale = l / d;
            pts[i + 1] = [
              pts[i][0] + dx * scale,
              pts[i][1] + dy * scale,
              pts[i][2] + dz * scale,
            ];
          } else {
            const fallback = initDirs[i];
            pts[i + 1] = [
              pts[i][0] + fallback[0] * l,
              pts[i][1] + fallback[1] * l,
              pts[i][2] + fallback[2] * l,
            ];
          }
        }
      }
    }

    const rotations: IKQuat[] = [];
    for (let i = 0; i < n - 1; i++) {
      const dx = pts[i + 1][0] - pts[i][0];
      const dy = pts[i + 1][1] - pts[i][1];
      const dz = pts[i + 1][2] - pts[i][2];
      const segLen = Math.hypot(dx, dy, dz);
      const solvedDir: TraitVec3 =
        segLen > 1e-6 ? [dx / segLen, dy / segLen, dz / segLen] : initDirs[i];
      rotations.push(quatFromUnitVectorsLocal(initDirs[i], solvedDir));
    }

    return {positions: pts, rotations, iterations: usedIters};
  }

  function parseIKTraitLocal(raw: unknown): IKTraitOptions | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;
    if (r['enabled'] === false) return null;
    const safeId = (v: unknown): string | undefined => {
      if (typeof v !== 'string') return undefined;
      const t = v.trim().slice(0, 64);
      return /^[A-Za-z0-9_.:-]+$/.test(t) ? t : undefined;
    };
    const isVec3 = (v: unknown): v is [number, number, number] =>
      Array.isArray(v) &&
      v.length === 3 &&
      typeof v[0] === 'number' &&
      Number.isFinite(v[0]) &&
      typeof v[1] === 'number' &&
      Number.isFinite(v[1]) &&
      typeof v[2] === 'number' &&
      Number.isFinite(v[2]);

    const root = safeId(r['root']);
    const effector = safeId(r['effector']);
    if (!root || !effector) return null;
    const mid = safeId(r['mid']);
    const rawTarget = r['target'];
    let target: TraitVec3 | string;
    if (isVec3(rawTarget)) {
      target = [
        clampLocal(rawTarget[0], -1000, 1000, 0),
        clampLocal(rawTarget[1], -1000, 1000, 0),
        clampLocal(rawTarget[2], -1000, 1000, 0),
      ];
    } else {
      const tId = safeId(rawTarget);
      if (!tId) return null;
      target = tId;
    }
    const rawPole = r['pole'];
    const pole: TraitVec3 | undefined = isVec3(rawPole)
      ? [
          clampLocal(rawPole[0], -1000, 1000, 0),
          clampLocal(rawPole[1], -1000, 1000, 0),
          clampLocal(rawPole[2], -1000, 1000, 0),
        ]
      : undefined;
    const solver: 'two-bone' | 'fabrik' =
      r['solver'] === 'fabrik'
        ? 'fabrik'
        : r['solver'] === 'two-bone'
          ? 'two-bone'
          : mid
            ? 'two-bone'
            : 'fabrik';
    return {
      root,
      ...(mid ? {mid} : {}),
      effector,
      target,
      ...(pole ? {pole} : {}),
      solver,
      iterations: Math.round(clampLocal(r['iterations'], 1, 32, 8)),
      tolerance: clampLocal(r['tolerance'], 1e-5, 0.1, 1e-3),
      weight: clampLocal(r['weight'], 0, 1, 1),
    };
  }

  const IKSolverObj = Object.freeze({
    solveTwoBone: solveTwoBoneIKLocal,
    solveFABRIK: solveFABRIKLocal,
    parseIKTrait: parseIKTraitLocal,
  });

  if (reg && typeof reg === 'object') {
    reg.authorNamespace = reg.authorNamespace || {};
    reg.authorNamespace['IKSolver'] = IKSolverObj;
  }

  return {
    clampNum: clampLocal,
    parseIKTrait: parseIKTraitLocal,
    quatFromUnitVectors: quatFromUnitVectorsLocal,
    solveTwoBoneIK: solveTwoBoneIKLocal,
    solveFABRIK: solveFABRIKLocal,
    IKSolver: IKSolverObj,
  };
}

const _ikExt = /* @__PURE__ */ installIKExtension();
const clampNum = _ikExt.clampNum;
const parseIKTrait = _ikExt.parseIKTrait;

/**
 * Computes the shortest-arc unit quaternion `[x, y, z, w]` rotating unit
 * vector `fromDir` onto unit vector `toDir`.
 */
export const quatFromUnitVectors = _ikExt.quatFromUnitVectors;

/**
 * Analytic 2-bone inverse kinematics solver using the law of cosines and
 * pole-vector bend-plane projection.
 */
export const solveTwoBoneIK = _ikExt.solveTwoBoneIK;

/**
 * Forward And Backward Reaching Inverse Kinematics (FABRIK) solver for an
 * N-joint chain, preserving every bone segment length.
 */
export const solveFABRIK = _ikExt.solveFABRIK;

/** Authoring helper namespace exposed as `THREE.IKSolver`. */
export const IKSolver = _ikExt.IKSolver;

// tslint:disable-next-line:no-any Heterogeneous viewer mesh record.
function readMeshPosition(mesh: any): TraitVec3 {
  const m = mesh?.transform ?? mesh?.modelMatrix;
  if (m && m.length >= 16) {
    return [m[12] || 0, m[13] || 0, m[14] || 0];
  }
  return [0, 0, 0];
}

// tslint:disable-next-line:no-any Heterogeneous viewer mesh record.
function writeMeshPositionExact(mesh: any, pos: TraitVec3): void {
  const m = mesh?.transform ?? mesh?.modelMatrix;
  if (!m || m.length < 16) return;
  m[12] = pos[0];
  m[13] = pos[1];
  m[14] = pos[2];
}

function blendSegmentPosition(
  parentPos: TraitVec3,
  restChildPos: TraitVec3,
  solvedChildPos: TraitVec3,
  segLen: number,
  weight: number,
): TraitVec3 {
  const w = clampNum(weight, 0, 1, 1);
  const bx = restChildPos[0] + (solvedChildPos[0] - restChildPos[0]) * w;
  const by = restChildPos[1] + (solvedChildPos[1] - restChildPos[1]) * w;
  const bz = restChildPos[2] + (solvedChildPos[2] - restChildPos[2]) * w;
  const dx = bx - parentPos[0];
  const dy = by - parentPos[1];
  const dz = bz - parentPos[2];
  const d = Math.hypot(dx, dy, dz);
  if (d > 1e-6 && segLen > 1e-6) {
    const s = segLen / d;
    return [
      parentPos[0] + dx * s,
      parentPos[1] + dy * s,
      parentPos[2] + dz * s,
    ];
  }
  return [bx, by, bz];
}

// tslint:disable-next-line:no-any Viewer is a ThreeView / XR host instance.
function resolveTargetPosition(
  target: string | TraitVec3,
  // tslint:disable-next-line:no-any Heterogeneous mesh lookup.
  byName: Map<string, any>,
  // tslint:disable-next-line:no-any Viewer instance.
  viewer: any,
): TraitVec3 | null {
  if (Array.isArray(target)) {
    return [target[0], target[1], target[2]];
  }
  const targetMesh = byName.get(target);
  if (targetMesh) {
    return readMeshPosition(targetMesh);
  }
  if (target === 'head') {
    const p =
      viewer?.headPose?.position ?? viewer?.headPose ?? viewer?.cameraPosition;
    if (Array.isArray(p) && p.length >= 3) return [p[0], p[1], p[2]];
  } else if (target === 'hand-left') {
    const p =
      viewer?.handPoses?.left?.position ??
      viewer?.handPoses?.left ??
      viewer?.hands?.left?.position ??
      viewer?.hands?.left;
    if (Array.isArray(p) && p.length >= 3) return [p[0], p[1], p[2]];
  } else if (target === 'hand-right') {
    const p =
      viewer?.handPoses?.right?.position ??
      viewer?.handPoses?.right ??
      viewer?.hands?.right?.position ??
      viewer?.hands?.right;
    if (Array.isArray(p) && p.length >= 3) return [p[0], p[1], p[2]];
  }
  return null;
}

/**
 * `<three-live>` plugin evaluating declarative `userData.xr.ik` chains on
 * scene meshes each frame, and registering `THREE.IKSolver` in the authoring
 * runtime.
 */
export const ikPlugin: ThreeLivePlugin = {
  name: 'ik',

  onRegister(): void {
    const reg = getSharedRegistry();
    registerWorkerExtensionInstaller(installIKExtension);
    installIKExtension(reg.threeNamespace, reg);
  },

  // tslint:disable-next-line:no-any Viewer is a ThreeView instance.
  onUpdate(viewer: any): void {
    const meshes = viewer?.meshes;
    if (!Array.isArray(meshes) || meshes.length === 0) return;

    // tslint:disable-next-line:no-any Heterogeneous mesh records.
    let byName: Map<string, any> | null = null;
    for (const mesh of meshes) {
      const rawIK =
        mesh?.userData?.xr?.ik ??
        mesh?.extras?.xr?.ik ??
        mesh?.extensions?.ANDROID_xr_scenecore?.ik;
      if (!rawIK) continue;
      const ik: IKTraitOptions | null = parseIKTrait(rawIK);
      if (!ik || ik.weight <= 0) continue;

      if (!byName) {
        byName = new Map();
        for (const m of meshes) {
          if (m && typeof m.name === 'string' && m.name) {
            byName.set(m.name, m);
          }
        }
      }

      const rootMesh = byName.get(ik.root);
      const effMesh = byName.get(ik.effector);
      if (!rootMesh || !effMesh) continue;

      const targetPos = resolveTargetPosition(ik.target, byName, viewer);
      if (!targetPos) continue;

      const midMesh = ik.mid ? byName.get(ik.mid) : undefined;
      const chainMeshes = midMesh
        ? [rootMesh, midMesh, effMesh]
        : [rootMesh, effMesh];

      // Cache initial segment offsets so bone lengths remain invariant across frames
      // even when weight < 1.0.
      const cacheKey = chainMeshes.map((m) => m.name || '').join('>');
      if (!mesh.__ikRestOffsets || mesh.__ikRestKey !== cacheKey) {
        const curPositions = chainMeshes.map(readMeshPosition);
        const offsets: TraitVec3[] = [];
        for (let i = 0; i < curPositions.length - 1; i++) {
          offsets.push([
            curPositions[i + 1][0] - curPositions[i][0],
            curPositions[i + 1][1] - curPositions[i][1],
            curPositions[i + 1][2] - curPositions[i][2],
          ]);
        }
        mesh.__ikRestOffsets = offsets;
        mesh.__ikRestKey = cacheKey;
      }

      const offsets: TraitVec3[] = mesh.__ikRestOffsets;
      const curRoot = readMeshPosition(rootMesh);
      const restChain: TraitVec3[] = [curRoot];
      const segLengths: number[] = [];
      for (let i = 0; i < offsets.length; i++) {
        const prev = restChain[i];
        const off = offsets[i];
        restChain.push([prev[0] + off[0], prev[1] + off[1], prev[2] + off[2]]);
        segLengths.push(Math.hypot(off[0], off[1], off[2]));
      }

      if (ik.solver === 'two-bone' && midMesh && restChain.length === 3) {
        const solved = solveTwoBoneIK(
          restChain[0],
          restChain[1],
          restChain[2],
          targetPos,
          ik.pole,
        );
        const blendedMid = blendSegmentPosition(
          restChain[0],
          restChain[1],
          solved.midPos,
          segLengths[0],
          ik.weight,
        );
        const effRestFromBlendedMid: TraitVec3 = [
          blendedMid[0] + offsets[1][0],
          blendedMid[1] + offsets[1][1],
          blendedMid[2] + offsets[1][2],
        ];
        const solvedEffOffset: TraitVec3 = [
          blendedMid[0] + (solved.effectorPos[0] - solved.midPos[0]),
          blendedMid[1] + (solved.effectorPos[1] - solved.midPos[1]),
          blendedMid[2] + (solved.effectorPos[2] - solved.midPos[2]),
        ];
        const blendedEff = blendSegmentPosition(
          blendedMid,
          effRestFromBlendedMid,
          solvedEffOffset,
          segLengths[1],
          ik.weight,
        );
        writeMeshPositionExact(midMesh, blendedMid);
        writeMeshPositionExact(effMesh, blendedEff);
      } else {
        const solved = solveFABRIK(
          restChain,
          targetPos,
          ik.iterations,
          ik.tolerance,
        );
        let parentPos = restChain[0];
        for (let i = 1; i < chainMeshes.length; i++) {
          const off = offsets[i - 1];
          const restFromParent: TraitVec3 = [
            parentPos[0] + off[0],
            parentPos[1] + off[1],
            parentPos[2] + off[2],
          ];
          const solvedFromParent: TraitVec3 = [
            parentPos[0] +
              (solved.positions[i][0] - solved.positions[i - 1][0]),
            parentPos[1] +
              (solved.positions[i][1] - solved.positions[i - 1][1]),
            parentPos[2] +
              (solved.positions[i][2] - solved.positions[i - 1][2]),
          ];
          const blended = blendSegmentPosition(
            parentPos,
            restFromParent,
            solvedFromParent,
            segLengths[i - 1],
            ik.weight,
          );
          writeMeshPositionExact(chainMeshes[i], blended);
          parentPos = blended;
        }
      }
    }
  },
};
