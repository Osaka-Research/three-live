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
 * @fileoverview Phase 1.2: Declarative Spatial Traits Engine (`userData.xr`).
 * Implements 1-hand grab/rotate, 2-hand pinch-to-scale & twist,
 * billboard (`TurnToFace`) capsule/cylindrical/spherical billboarding,
 * lazy head/hand spring followers, and surface plane anchoring.
 */

import {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Invert,
  mat4Multiply,
} from '../../three-live/src/math';
import {getRegisteredPlugins} from '../../three-live/src/plugin';
import type {XRMeshTraits} from '../../three-live/src/three-convert';

/**
 * Returns true when an object-valued `follow` trait is owned by the optional
 * `xr-live-head-follow` plugin (lazy deadzone + critically damped spring).
 */
function isLazyFollowDelegated(follow: unknown): boolean {
  return (
    (follow as {lazy?: unknown} | null)?.lazy !== false &&
    typeof follow === 'object' &&
    getRegisteredPlugins().some((p) => p.name === 'xr-live-head-follow')
  );
}

export interface XRPose6DoF {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  matrix: Float32Array;
}

export interface ActiveGrabState {
  mesh: any;
  primaryHand: 'left' | 'right' | 'screen';
  secondaryHand: 'left' | 'right' | 'screen' | null;
  relativeMatrix: Float32Array;
  initialHandDist: number;
  initialHandVec: [number, number, number];
  initialScale: [number, number, number];
  initialPosition: [number, number, number];
  initialQuaternion: [number, number, number, number];
}

export function extractPosition(m: Float32Array): [number, number, number] {
  return [m[12], m[13], m[14]];
}

export function extractScale(m: Float32Array): [number, number, number] {
  const sx = Math.hypot(m[0], m[1], m[2]) || 1;
  const sy = Math.hypot(m[4], m[5], m[6]) || 1;
  const sz = Math.hypot(m[8], m[9], m[10]) || 1;
  return [sx, sy, sz];
}

export function extractQuaternion(
  m: Float32Array,
): [number, number, number, number] {
  const [sx, sy, sz] = extractScale(m);
  const m00 = m[0] / sx,
    m01 = m[4] / sy,
    m02 = m[8] / sz;
  const m10 = m[1] / sx,
    m11 = m[5] / sy,
    m12 = m[9] / sz;
  const m20 = m[2] / sx,
    m21 = m[6] / sy,
    m22 = m[10] / sz;
  const trace = m00 + m11 + m22;
  let qx = 0,
    qy = 0,
    qz = 0,
    qw = 1;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1.0);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2.0 * Math.sqrt(1.0 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2.0 * Math.sqrt(1.0 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  const len = Math.hypot(qx, qy, qz, qw) || 1;
  return [qx / len, qy / len, qz / len, qw / len];
}

export function quatFromEulerYXZ(
  pitchX: number,
  yawY: number,
  rollZ = 0,
): [number, number, number, number] {
  const cx = Math.cos(pitchX * 0.5),
    sx = Math.sin(pitchX * 0.5);
  const cy = Math.cos(yawY * 0.5),
    sy = Math.sin(yawY * 0.5);
  const cz = Math.cos(rollZ * 0.5),
    sz = Math.sin(rollZ * 0.5);
  return [
    cy * sx * cz + sy * cx * sz,
    sy * cx * cz - cy * sx * sz,
    cy * cx * sz - sy * sx * cz,
    cy * cx * cz + sy * sx * sz,
  ];
}

export function quatSlerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  let [ax, ay, az, aw] = a;
  let [bx, by, bz, bw] = b;
  let cosom = ax * bx + ay * by + az * bz + aw * bw;
  if (cosom < 0) {
    cosom = -cosom;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let scale0 = 1 - t;
  let scale1 = t;
  if (1 - cosom > 1e-5) {
    const omega = Math.acos(Math.min(1, cosom));
    const sinom = Math.sin(omega);
    scale0 = Math.sin((1 - t) * omega) / sinom;
    scale1 = Math.sin(t * omega) / sinom;
  }
  const rx = scale0 * ax + scale1 * bx;
  const ry = scale0 * ay + scale1 * by;
  const rz = scale0 * az + scale1 * bz;
  const rw = scale0 * aw + scale1 * bw;
  const len = Math.hypot(rx, ry, rz, rw) || 1;
  return [rx / len, ry / len, rz / len, rw / len];
}

export function getMeshXRTraits(mesh: any): XRMeshTraits | undefined {
  if (mesh?.extras?.xr && mesh?.userData?.xr && mesh.extras.xr !== mesh.userData.xr) {
    Object.assign(mesh.extras.xr, mesh.userData.xr);
  }
  return mesh?.extras?.xr || mesh?.userData?.xr;
}

export function computeMeshBottomOffset(
  mesh: any,
  scl: [number, number, number],
): number {
  const prim = mesh?.primitives?.[0];
  if (prim?.positions && prim.positions.length >= 3) {
    let minY = 0;
    for (let i = 1; i < prim.positions.length; i += 3) {
      if (prim.positions[i] < minY) minY = prim.positions[i];
    }
    if (minY < -0.001) return -minY * scl[1];
  }
  return 0;
}

export function applyMeshTRS(
  mesh: any,
  quat: [number, number, number, number],
  pos: [number, number, number],
  scl: [number, number, number],
): void {
  mat4FromRotationTranslationScale(mesh.transform, quat, pos, scl);
  if (mesh.normalMatrix) {
    mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
  }
}

export function emitXREvent(element: any, name: string, detail: any): void {
  if (
    element &&
    typeof element.dispatchEvent === 'function' &&
    typeof CustomEvent !== 'undefined'
  ) {
    element.dispatchEvent(
      new CustomEvent(name, {
        bubbles: true,
        composed: true,
        detail,
      }),
    );
  }
}

/**
 * Computes billboard (`TurnToFace`) quaternion for `'capsule'`, `'cylindrical'`, or `'spherical'` billboarding.
 */
export function computeBillboardQuaternion(
  objectPos: [number, number, number],
  headPos: [number, number, number],
  mode: boolean | 'capsule' | 'cylindrical' | 'spherical',
): [number, number, number, number] {
  const dx = headPos[0] - objectPos[0];
  const dy = headPos[1] - objectPos[1];
  const dz = headPos[2] - objectPos[2];
  const horizDist = Math.hypot(dx, dz);
  const totalDist = Math.hypot(dx, dy, dz);
  if (totalDist < 1e-5) return [0, 0, 0, 1];

  const yaw = Math.atan2(dx, dz);
  let pitch = -Math.atan2(dy, Math.max(horizDist, 1e-5));

  if (mode === 'cylindrical') {
    pitch = 0;
  } else if (mode === 'capsule' || mode === true) {
    // Clamp pitch to [-30 deg, +30 deg] matching the [-30 deg, +30 deg] capsule pitch constraint
    const maxPitch = (30 * Math.PI) / 180;
    pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
  }
  return quatFromEulerYXZ(pitch, yaw, 0);
}

export class XRTraitSystem {
  private activeGrabs = new Map<any, ActiveGrabState>();
  private followOffsets = new WeakMap<object, [number, number, number]>();

  /** Returns whether `mesh` is currently held by a 1-hand or 2-hand grab. */
  public isGrabbing(mesh: unknown): boolean {
    return this.activeGrabs.has(mesh);
  }

  /**
   * Starts a 1-hand or 2-hand grab on a mesh with `userData.xr.grab`.
   */
  public startGrab(
    mesh: any,
    hand: 'left' | 'right' | 'screen',
    handPose: XRPose6DoF,
  ): boolean {
    const traits = getMeshXRTraits(mesh);
    if (!traits?.grab) return false;

    const existing = this.activeGrabs.get(mesh);
    if (existing && existing.primaryHand !== hand && traits.grab !== '1-hand') {
      // Upgrade to 2-hand pinch-to-scale & twist
      existing.secondaryHand = hand;
      existing.initialScale = extractScale(mesh.transform);
      existing.initialPosition = extractPosition(mesh.transform);
      existing.initialQuaternion = extractQuaternion(mesh.transform);
      return true;
    }

    const invController = mat4Create();
    mat4Invert(invController, handPose.matrix);
    const relMat = mat4Create();
    mat4Multiply(relMat, invController, mesh.transform);

    this.activeGrabs.set(mesh, {
      mesh,
      primaryHand: hand,
      secondaryHand: null,
      relativeMatrix: relMat,
      initialHandDist: 0,
      initialHandVec: [1, 0, 0],
      initialScale: extractScale(mesh.transform),
      initialPosition: extractPosition(mesh.transform),
      initialQuaternion: extractQuaternion(mesh.transform),
    });
    return true;
  }

  /**
   * Ends a grab for the specified hand.
   */
  public endGrab(
    hand: 'left' | 'right' | 'screen',
    handPoses?: Partial<Record<'left' | 'right' | 'screen', XRPose6DoF>>,
  ): void {
    for (const [mesh, state] of this.activeGrabs.entries()) {
      if (state.secondaryHand === hand) {
        state.secondaryHand = null;
        state.initialHandDist = 0;
        const primaryPose = handPoses?.[state.primaryHand];
        if (primaryPose) {
          const invC = mat4Create();
          mat4Invert(invC, primaryPose.matrix);
          mat4Multiply(state.relativeMatrix, invC, mesh.transform);
        }
      } else if (state.primaryHand === hand) {
        if (state.secondaryHand && handPoses?.[state.secondaryHand]) {
          state.primaryHand = state.secondaryHand;
          state.secondaryHand = null;
          state.initialHandDist = 0;
          const newPrimaryPose = handPoses[state.primaryHand]!;
          const invC = mat4Create();
          mat4Invert(invC, newPrimaryPose.matrix);
          mat4Multiply(state.relativeMatrix, invC, mesh.transform);
        } else {
          this.activeGrabs.delete(mesh);
        }
      }
    }
  }

  /**
   * Applies direct pinch-scale multiplier (e.g. from 2-finger mobile touch or desktop simulator wheel).
   */
  public applyScaleMultiplier(mesh: any, multiplier: number): void {
    const traits = getMeshXRTraits(mesh);
    if (!traits?.scale && !traits?.grab) return;
    const minS =
      typeof traits.scale === 'object' ? (traits.scale.min ?? 0.05) : 0.05;
    const maxS =
      typeof traits.scale === 'object' ? (traits.scale.max ?? 5.0) : 5.0;

    const pos = extractPosition(mesh.transform);
    const quat = extractQuaternion(mesh.transform);
    const [sx, sy, sz] = extractScale(mesh.transform);
    const nextS = Math.max(minS, Math.min(maxS, sx * multiplier));
    const ratio = nextS / Math.max(sx, 1e-5);

    mat4FromRotationTranslationScale(mesh.transform, quat, pos, [
      sx * ratio,
      sy * ratio,
      sz * ratio,
    ]);
    if (mesh.normalMatrix) {
      mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
    }
  }

  /**
   * Updates all active grabs, billboards, head/hand followers, and surface anchors for the frame.
   */
  public update(
    meshes: any[],
    headPose: XRPose6DoF,
    handPoses: Partial<Record<'left' | 'right' | 'screen', XRPose6DoF>>,
    dt: number,
    floorY = 0,
    tableY = 0.75,
  ): void {
    const clampedDt = Math.max(0.001, Math.min(0.1, dt));

    // 1. Update active 1-hand and 2-hand grabs
    for (const [mesh, state] of this.activeGrabs.entries()) {
      const traits = getMeshXRTraits(mesh) || {};
      const pPose = handPoses[state.primaryHand];
      const sPose = state.secondaryHand ? handPoses[state.secondaryHand] : null;

      if (pPose && sPose) {
        const dx = sPose.position[0] - pPose.position[0];
        const dy = sPose.position[1] - pPose.position[1];
        const dz = sPose.position[2] - pPose.position[2];
        const dist = Math.hypot(dx, dy, dz);

        if (state.initialHandDist <= 1e-4) {
          state.initialHandDist = Math.max(dist, 0.01);
          state.initialHandVec = [dx, dy, dz];
          state.initialScale = extractScale(mesh.transform);
          state.initialPosition = extractPosition(mesh.transform);
          state.initialQuaternion = extractQuaternion(mesh.transform);
        } else {
          const rawRatio = dist / state.initialHandDist;
          const minS =
            typeof traits.scale === 'object'
              ? (traits.scale.min ?? 0.05)
              : 0.05;
          const maxS =
            typeof traits.scale === 'object' ? (traits.scale.max ?? 5.0) : 5.0;
          const clampedScale = Math.max(
            minS,
            Math.min(maxS, state.initialScale[0] * rawRatio),
          );
          const scaleFactor =
            clampedScale / Math.max(state.initialScale[0], 1e-5);

          const midPos: [number, number, number] = [
            (pPose.position[0] + sPose.position[0]) * 0.5,
            (pPose.position[1] + sPose.position[1]) * 0.5,
            (pPose.position[2] + sPose.position[2]) * 0.5,
          ];

          const yaw0 = Math.atan2(
            state.initialHandVec[0],
            state.initialHandVec[2],
          );
          const yaw1 = Math.atan2(dx, dz);
          const deltaQ = quatFromEulerYXZ(0, yaw1 - yaw0, 0);
          const [ix, iy, iz, iw] = state.initialQuaternion;
          const [dqx, dqy, dqz, dqw] = deltaQ;
          const nextQ: [number, number, number, number] = [
            dqw * ix + dqx * iw + dqy * iz - dqz * iy,
            dqw * iy - dqx * iz + dqy * iw + dqz * ix,
            dqw * iz + dqx * iy - dqy * ix + dqz * iw,
            dqw * iw - dqx * ix - dqy * iy - dqz * iz,
          ];

          mat4FromRotationTranslationScale(mesh.transform, nextQ, midPos, [
            state.initialScale[0] * scaleFactor,
            state.initialScale[1] * scaleFactor,
            state.initialScale[2] * scaleFactor,
          ]);
          if (mesh.normalMatrix) {
            mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
          }
        }
      } else if (pPose) {
        const targetMat = mat4Create();
        mat4Multiply(targetMat, pPose.matrix, state.relativeMatrix);
        const alpha = 0.35;
        const currPos = extractPosition(mesh.transform);
        const targetPos = extractPosition(targetMat);
        const currQuat = extractQuaternion(mesh.transform);
        const targetQuat = extractQuaternion(targetMat);
        const currScale = extractScale(mesh.transform);
        const targetScale = extractScale(targetMat);

        const nextPos: [number, number, number] = [
          currPos[0] + (targetPos[0] - currPos[0]) * alpha,
          currPos[1] + (targetPos[1] - currPos[1]) * alpha,
          currPos[2] + (targetPos[2] - currPos[2]) * alpha,
        ];
        const nextScale: [number, number, number] = [
          currScale[0] + (targetScale[0] - currScale[0]) * alpha,
          currScale[1] + (targetScale[1] - currScale[1]) * alpha,
          currScale[2] + (targetScale[2] - currScale[2]) * alpha,
        ];
        const nextQuat = quatSlerp(currQuat, targetQuat, alpha);

        mat4FromRotationTranslationScale(
          mesh.transform,
          nextQuat,
          nextPos,
          nextScale,
        );
        if (mesh.normalMatrix) {
          mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
        }
      }
    }

    // 2. Update declarative follow, billboard, and anchor traits
    for (const mesh of meshes) {
      if (!mesh || this.activeGrabs.has(mesh)) continue;
      const traits = getMeshXRTraits(mesh);
      if (!traits) continue;

      let pos = extractPosition(mesh.transform);
      let quat = extractQuaternion(mesh.transform);
      const scl = extractScale(mesh.transform);
      let modified = false;

      // Lazy spring follow ('head', 'hand-left', 'hand-right')
      if (traits.follow && !isLazyFollowDelegated(traits.follow)) {
        const targetSource =
          traits.follow === 'hand-left'
            ? handPoses.left
            : traits.follow === 'hand-right'
              ? handPoses.right
              : headPose;

        if (targetSource) {
          let offset = this.followOffsets.get(mesh);
          if (!offset) {
            offset = [
              pos[0] - targetSource.position[0],
              pos[1] - targetSource.position[1],
              pos[2] - targetSource.position[2] || -0.8,
            ];
            if (Math.hypot(offset[0], offset[1], offset[2]) < 0.05) {
              offset = [0, -0.1, -0.8];
            }
            this.followOffsets.set(mesh, offset);
          }

          // Transform local offset by target yaw
          const targetQuat = targetSource.quaternion;
          const yaw = Math.atan2(
            2 * (targetQuat[3] * targetQuat[1] + targetQuat[0] * targetQuat[2]),
            1 -
              2 *
                (targetQuat[1] * targetQuat[1] + targetQuat[0] * targetQuat[0]),
          );
          const cosY = Math.cos(yaw);
          const sinY = Math.sin(yaw);
          const desiredPos: [number, number, number] = [
            targetSource.position[0] + offset[0] * cosY + offset[2] * sinY,
            targetSource.position[1] + offset[1],
            targetSource.position[2] - offset[0] * sinY + offset[2] * cosY,
          ];

          const distErr = Math.hypot(
            desiredPos[0] - pos[0],
            desiredPos[1] - pos[1],
            desiredPos[2] - pos[2],
          );
          if (distErr > 0.02) {
            const springLerp = Math.min(1, clampedDt * 6.0);
            pos = [
              pos[0] + (desiredPos[0] - pos[0]) * springLerp,
              pos[1] + (desiredPos[1] - pos[1]) * springLerp,
              pos[2] + (desiredPos[2] - pos[2]) * springLerp,
            ];
            modified = true;
          }
        }
      }

      // Plane surface anchoring ('floor', 'table', 'horizontal')
      if (traits.anchor && !traits.physics) {
        const bottomOffset = computeMeshBottomOffset(mesh, scl);
        if (traits.anchor === 'floor') {
          const restY = floorY + bottomOffset;
          if (Math.abs(pos[1] - restY) > 1e-3) {
            pos[1] = restY;
            modified = true;
          }
        } else if (
          traits.anchor === 'table' ||
          traits.anchor === 'horizontal'
        ) {
          const basePlaneY =
            Math.abs(pos[1] - bottomOffset - tableY) < 0.45 ? tableY : floorY;
          const restY = basePlaneY + bottomOffset;
          if (Math.abs(pos[1] - restY) > 1e-3) {
            pos[1] = restY;
            modified = true;
          }
        }
      }

      // Billboarding ('capsule', 'cylindrical', 'spherical')
      if (traits.billboard) {
        const targetQuat = computeBillboardQuaternion(
          pos,
          headPose.position,
          traits.billboard,
        );
        quat = quatSlerp(quat, targetQuat, Math.min(1, clampedDt * 10.0));
        modified = true;
      }

      if (modified) {
        mat4FromRotationTranslationScale(mesh.transform, quat, pos, scl);
        if (mesh.normalMatrix) {
          mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
        }
      }
    }
  }
}
