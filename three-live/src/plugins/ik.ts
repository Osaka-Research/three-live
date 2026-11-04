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
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Invert,
  mat4Multiply,
} from '../math';
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

        const stepPt = (
          from: TraitVec3,
          to: TraitVec3,
          l: number,
          fallback: TraitVec3,
          sign: number,
        ): TraitVec3 => {
          const dx = to[0] - from[0];
          const dy = to[1] - from[1];
          const dz = to[2] - from[2];
          const d = Math.hypot(dx, dy, dz);
          if (d > 1e-6) {
            const scale = l / d;
            return [
              from[0] + dx * scale,
              from[1] + dy * scale,
              from[2] + dz * scale,
            ];
          }
          return [
            from[0] + fallback[0] * l * sign,
            from[1] + fallback[1] * l * sign,
            from[2] + fallback[2] * l * sign,
          ];
        };

        pts[n - 1] = [targetPos[0], targetPos[1], targetPos[2]];
        for (let i = n - 2; i >= 0; i--) {
          pts[i] = stepPt(pts[i + 1], pts[i], lengths[i], initDirs[i], -1);
        }

        pts[0] = [root[0], root[1], root[2]];
        for (let i = 0; i < n - 1; i++) {
          pts[i + 1] = stepPt(pts[i], pts[i + 1], lengths[i], initDirs[i], 1);
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
    const clampVec3 = (v: unknown): TraitVec3 | undefined =>
      Array.isArray(v) &&
      v.length === 3 &&
      v.every((x) => typeof x === 'number' && Number.isFinite(x))
        ? [
            clampLocal(v[0], -1000, 1000, 0),
            clampLocal(v[1], -1000, 1000, 0),
            clampLocal(v[2], -1000, 1000, 0),
          ]
        : undefined;

    const root = safeId(r['root']);
    const effector = safeId(r['effector']);
    if (!root || !effector) return null;
    const mid = safeId(r['mid']);
    const target = clampVec3(r['target']) ?? safeId(r['target']);
    if (!target) return null;
    // `pole` is a scene-space point or a node name resolved like `target`;
    // `poleTarget` is accepted as an alias.
    const rawPole = r['pole'] ?? r['poleTarget'];
    const pole: TraitVec3 | string | undefined =
      clampVec3(rawPole) ?? safeId(rawPole);
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
  // Rest and solved children mirror each other about the parent, so the lerp
  // collapsed onto it: keep the bone length by following the solved direction.
  const sx = solvedChildPos[0] - parentPos[0];
  const sy = solvedChildPos[1] - parentPos[1];
  const sz = solvedChildPos[2] - parentPos[2];
  const sl = Math.hypot(sx, sy, sz);
  if (sl > 1e-6 && segLen > 1e-6) {
    const s = segLen / sl;
    return [
      parentPos[0] + sx * s,
      parentPos[1] + sy * s,
      parentPos[2] + sz * s,
    ];
  }
  return [bx, by, bz];
}

/**
 * Converts a world-space point (head / hand poses) into the scene space of
 * `mesh.transform` by applying the inverse of `viewer.modelRootMatrix`.
 */
// tslint:disable-next-line:no-any Viewer instance.
function worldToScene(viewer: any, p: TraitVec3): TraitVec3 {
  const r = viewer?.modelRootMatrix;
  if (!r || r.length !== 16) return p;
  const inv = new Float32Array(16);
  if (!mat4Invert(inv, r instanceof Float32Array ? r : Float32Array.from(r))) {
    return p;
  }
  return [
    inv[0] * p[0] + inv[4] * p[1] + inv[8] * p[2] + inv[12],
    inv[1] * p[0] + inv[5] * p[1] + inv[9] * p[2] + inv[13],
    inv[2] * p[0] + inv[6] * p[1] + inv[10] * p[2] + inv[14],
  ];
}

/**
 * Emits a one-time console warning per mesh and missing joint name so IK
 * chains that cannot resolve a joint do not fail silently.
 */
// tslint:disable-next-line:no-any Heterogeneous viewer mesh record.
function warnMissingIKJoint(mesh: any, name: string): void {
  if (!mesh.__ikWarned) mesh.__ikWarned = new Set<string>();
  const warned: Set<string> = mesh.__ikWarned;
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(
    `[three-live] ik: joint '${name}' on '${mesh?.name ?? ''}' not found ` +
      'among scene nodes or meshes.',
  );
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
  // Head / hand poses are world space; joints live in scene space.
  let p: unknown;
  if (target === 'head') {
    p =
      viewer?.headPose?.position ?? viewer?.headPose ?? viewer?.cameraPosition;
  } else if (target === 'hand-left') {
    p =
      viewer?.handPoses?.left?.position ??
      viewer?.handPoses?.left ??
      viewer?.hands?.left?.position ??
      viewer?.hands?.left;
  } else if (target === 'hand-right') {
    p =
      viewer?.handPoses?.right?.position ??
      viewer?.handPoses?.right ??
      viewer?.hands?.right?.position ??
      viewer?.hands?.right;
  }
  if (
    (Array.isArray(p) || ArrayBuffer.isView(p)) &&
    (p as ArrayLike<number>).length >= 3
  ) {
    const a = p as ArrayLike<number>;
    return worldToScene(viewer, [a[0], a[1], a[2]]);
  }
  return null;
}

// --- Host-side quaternion / node-graph helpers (not part of the worker installer) ---

type Q = [number, number, number, number];

function qMul(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

function qConj(q: Q): Q {
  return [-q[0], -q[1], -q[2], q[3]];
}

function qNormalize(q: Q): Q {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

/** Slerp from identity to `q` by `t` (weight blending of a delta rotation). */
function qPow(q: Q, t: number): Q {
  if (t >= 1) return q;
  if (t <= 0) return [0, 0, 0, 1];
  let [x, y, z, w] = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const half = Math.acos(Math.min(1, w));
  const sinHalf = Math.sin(half);
  if (sinHalf < 1e-9) return [0, 0, 0, 1];
  const k = Math.sin(half * t) / sinHalf;
  return qNormalize([x * k, y * k, z * k, Math.cos(half * t)]);
}

/** Rotation quaternion of a column-major 4x4 (columns normalized to drop scale). */
function qFromMat4(m: ArrayLike<number>): Q {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  const m00 = m[0] / sx,
    m10 = m[1] / sx,
    m20 = m[2] / sx;
  const m01 = m[4] / sy,
    m11 = m[5] / sy,
    m21 = m[6] / sy;
  const m02 = m[8] / sz,
    m12 = m[9] / sz,
    m22 = m[10] / sz;
  const tr = m00 + m11 + m22;
  let q: Q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return qNormalize(q);
}

/** Left-multiplies the rotation `q` into the upper 3x3 of column-major `m`. */
function rotateMat3InPlace(
  m: Float32Array | number[],
  rest: ArrayLike<number>,
  q: Q,
): void {
  const [x, y, z, w] = q;
  const r00 = 1 - 2 * (y * y + z * z),
    r01 = 2 * (x * y - z * w),
    r02 = 2 * (x * z + y * w);
  const r10 = 2 * (x * y + z * w),
    r11 = 1 - 2 * (x * x + z * z),
    r12 = 2 * (y * z - x * w);
  const r20 = 2 * (x * z - y * w),
    r21 = 2 * (y * z + x * w),
    r22 = 1 - 2 * (x * x + y * y);
  for (let c = 0; c < 3; c++) {
    const a = rest[c * 4],
      b = rest[c * 4 + 1],
      d = rest[c * 4 + 2];
    m[c * 4] = r00 * a + r01 * b + r02 * d;
    m[c * 4 + 1] = r10 * a + r11 * b + r12 * d;
    m[c * 4 + 2] = r20 * a + r21 * b + r22 * d;
  }
}

function dirBetween(a: TraitVec3, b: TraitVec3): TraitVec3 | null {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz);
  return l > 1e-9 ? [dx / l, dy / l, dz / l] : null;
}

function updateNormalMatrix(mesh: any): void {
  if (mesh?.normalMatrix && mesh?.transform) {
    mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
  }
}

const parentCache = new WeakMap<object, Int32Array>();

// tslint:disable-next-line:no-any glTF JSON.
function nodeParents(gltf: any): Int32Array {
  let parents = parentCache.get(gltf);
  if (!parents) {
    parents = new Int32Array(gltf.nodes.length).fill(-1);
    gltf.nodes.forEach((n: any, i: number) => {
      for (const c of Array.isArray(n?.children) ? n.children : []) {
        if (typeof c === 'number' && c >= 0 && c < parents!.length)
          parents![c] = i;
      }
    });
    parentCache.set(gltf, parents);
  }
  return parents;
}

/**
 * Solves an IK chain on the glTF node graph (joints may be mesh-less groups):
 * starting from the rest pose (`initialNodeTransforms`) of the root's subtree,
 * it rotates each joint by the weighted shortest-arc delta that aligns its
 * bone with the solved direction, then writes the subtree's world matrices
 * into `viewer.worldMatrices` and every descendant mesh's `transform`, so
 * child geometry follows the joints. Returns false when the chain cannot be
 * resolved as nodes (callers fall back to the flat-mesh path).
 */
// tslint:disable-next-line:no-any Viewer instance.
function solveIKOnNodeGraph(
  viewer: any,
  ik: IKTraitOptions,
  // tslint:disable-next-line:no-any Heterogeneous mesh lookup.
  byName: Map<string, any>,
): boolean {
  const gltf = viewer?.gltf;
  const nodes = gltf?.nodes;
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  const nodeByName = new Map<string, number>();
  nodes.forEach((n: any, i: number) => {
    if (typeof n?.name === 'string' && n.name && !nodeByName.has(n.name)) {
      nodeByName.set(n.name, i);
    }
  });
  const names = ik.mid
    ? [ik.root, ik.mid, ik.effector]
    : [ik.root, ik.effector];
  const joints = names.map((n) => nodeByName.get(n));
  if (joints.some((j) => j === undefined)) return false;
  const chain = joints as number[];
  const parents = nodeParents(gltf);
  // Each joint must be an ancestor of the next.
  for (let k = 1; k < chain.length; k++) {
    let p = parents[chain[k]];
    let guard = 0;
    while (p >= 0 && p !== chain[k - 1] && guard++ < 256) p = parents[p];
    if (p !== chain[k - 1]) return false;
  }

  const root = chain[0];
  const rest = viewer.initialNodeTransforms;
  const local = new Map<number, {t: TraitVec3; r: Q; s: TraitVec3}>();
  const subtree: number[] = [];
  const stack = [root];
  while (stack.length && subtree.length < 4096) {
    const n = stack.pop()!;
    if (local.has(n)) continue;
    const init = rest?.[n];
    const node = nodes[n];
    local.set(n, {
      t: init
        ? [init.t[0], init.t[1], init.t[2]]
        : node?.translation
          ? ([...node.translation] as TraitVec3)
          : [0, 0, 0],
      r: init
        ? [init.r[0], init.r[1], init.r[2], init.r[3]]
        : node?.rotation
          ? ([...node.rotation] as Q)
          : [0, 0, 0, 1],
      s: init
        ? [init.s[0], init.s[1], init.s[2]]
        : node?.scale
          ? ([...node.scale] as TraitVec3)
          : [1, 1, 1],
    });
    subtree.push(n);
    for (const c of Array.isArray(node?.children) ? node.children : []) {
      if (typeof c === 'number') stack.push(c);
    }
  }
  const rootParent = parents[root];
  const parentWorld =
    rootParent >= 0 && viewer.worldMatrices?.[rootParent]?.length === 16
      ? Float32Array.from(viewer.worldMatrices[rootParent])
      : mat4Create();

  const world = new Map<number, Float32Array>();
  const recompute = () => {
    const visit = (n: number, pw: Float32Array) => {
      const trs = local.get(n);
      if (!trs) return;
      const l = mat4Create();
      mat4FromRotationTranslationScale(l, trs.r, trs.t, trs.s);
      const w = mat4Create();
      mat4Multiply(w, pw, l);
      world.set(n, w);
      for (const c of Array.isArray(nodes[n]?.children)
        ? nodes[n].children
        : []) {
        if (typeof c === 'number') visit(c, w);
      }
    };
    visit(root, parentWorld);
  };
  const pos = (n: number): TraitVec3 => {
    const w = world.get(n)!;
    return [w[12], w[13], w[14]];
  };
  recompute();

  const restPositions = chain.map(pos);
  const resolve = (t: string | TraitVec3): TraitVec3 | null => {
    if (typeof t === 'string' && !byName.has(t)) {
      const ni = nodeByName.get(t);
      const wm =
        ni !== undefined
          ? (world.get(ni) ?? viewer.worldMatrices?.[ni])
          : undefined;
      if (wm && wm.length === 16) return [wm[12], wm[13], wm[14]];
    }
    return resolveTargetPosition(t, byName, viewer);
  };
  const targetPos = resolve(ik.target);
  if (!targetPos) return true;
  const polePos = ik.pole ? (resolve(ik.pole) ?? undefined) : undefined;

  const solvedPositions = solveChainPositions(
    restPositions,
    ik,
    targetPos,
    polePos,
  );

  const weight = clampNum(ik.weight, 0, 1, 1);
  for (let k = 0; k < chain.length - 1; k++) {
    const cur = dirBetween(pos(chain[k]), pos(chain[k + 1]));
    const want = dirBetween(solvedPositions[k], solvedPositions[k + 1]);
    if (!cur || !want) continue;
    const delta = qPow(quatFromUnitVectors(cur, want) as Q, weight);
    const j = chain[k];
    const pj = parents[j];
    const pw =
      pj === rootParent || pj < 0
        ? parentWorld
        : (world.get(pj) ?? parentWorld);
    const pRot = qFromMat4(pw);
    const trs = local.get(j)!;
    // world' = delta * P * L  =>  L' = P^-1 * delta * P * L
    trs.r = qNormalize(qMul(qConj(pRot), qMul(delta, qMul(pRot, trs.r))));
    recompute();
  }

  if (Array.isArray(viewer.worldMatrices)) {
    for (const [n, w] of world) {
      if (viewer.worldMatrices[n]?.set) viewer.worldMatrices[n].set(w);
    }
  }
  for (const mesh of viewer.meshes ?? []) {
    const w = world.get(mesh?.nodeIndex);
    if (w && mesh.transform?.set) {
      mesh.transform.set(w);
      updateNormalMatrix(mesh);
    }
  }
  return true;
}

function solveChainPositions(
  rest: TraitVec3[],
  ik: IKTraitOptions,
  targetPos: TraitVec3,
  polePos?: TraitVec3,
): TraitVec3[] {
  if (ik.solver === 'two-bone' && rest.length === 3) {
    const s = solveTwoBoneIK(rest[0], rest[1], rest[2], targetPos, polePos);
    return [rest[0], s.midPos, s.effectorPos];
  }
  return solveFABRIK(rest, targetPos, ik.iterations, ik.tolerance).positions;
}

/**
 * Flat-mesh fallback: rotates each joint mesh (except the effector) from its
 * cached rest orientation by the shortest arc between its rest bone direction
 * and its solved bone direction, so joints turn as well as move.
 */
// tslint:disable-next-line:no-any Heterogeneous viewer mesh records.
function applyFlatJointRotations(
  owner: any,
  chainMeshes: any[],
  solved: TraitVec3[],
): void {
  const offsets: TraitVec3[] | undefined = owner.__ikRestOffsets;
  const restMats: number[][] | undefined = owner.__ikRestMats;
  if (!offsets || !restMats) return;
  for (let k = 0; k < chainMeshes.length - 1; k++) {
    const m = chainMeshes[k]?.transform ?? chainMeshes[k]?.modelMatrix;
    const rest = restMats[k];
    const restDir = dirBetween([0, 0, 0], offsets[k]);
    const newDir = dirBetween(solved[k], solved[k + 1]);
    if (!m || m.length < 16 || !rest || rest.length < 16 || !restDir || !newDir)
      continue;
    rotateMat3InPlace(m, rest, quatFromUnitVectors(restDir, newDir) as Q);
    updateNormalMatrix(chainMeshes[k]);
  }
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

      // Preferred: solve on the glTF node graph so mesh-less Group joints
      // resolve and child meshes follow the rotated joints.
      if (solveIKOnNodeGraph(viewer, ik, byName)) continue;

      const rootMesh = byName.get(ik.root);
      const effMesh = byName.get(ik.effector);
      const midMesh = ik.mid ? byName.get(ik.mid) : undefined;
      if (!rootMesh) warnMissingIKJoint(mesh, ik.root);
      if (!effMesh) warnMissingIKJoint(mesh, ik.effector);
      if (ik.mid && !midMesh) warnMissingIKJoint(mesh, ik.mid);
      if (!rootMesh || !effMesh) continue;

      const targetPos = resolveTargetPosition(ik.target, byName, viewer);
      if (!targetPos) continue;
      const polePos = ik.pole
        ? (resolveTargetPosition(ik.pole, byName, viewer) ?? undefined)
        : undefined;
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
        mesh.__ikRestMats = chainMeshes.map((m) =>
          Array.from((m.transform ?? m.modelMatrix ?? []) as ArrayLike<number>),
        );
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

      const solvedPositions = solveChainPositions(
        restChain,
        ik,
        targetPos,
        polePos,
      );
      let parentPos = restChain[0];
      const blendedChain: TraitVec3[] = [restChain[0]];
      for (let i = 1; i < chainMeshes.length; i++) {
        const off = offsets[i - 1];
        const restFromParent: TraitVec3 = [
          parentPos[0] + off[0],
          parentPos[1] + off[1],
          parentPos[2] + off[2],
        ];
        const solvedFromParent: TraitVec3 = [
          parentPos[0] + (solvedPositions[i][0] - solvedPositions[i - 1][0]),
          parentPos[1] + (solvedPositions[i][1] - solvedPositions[i - 1][1]),
          parentPos[2] + (solvedPositions[i][2] - solvedPositions[i - 1][2]),
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
        blendedChain.push(blended);
      }
      applyFlatJointRotations(mesh, chainMeshes, blendedChain);
    }
  },
};
