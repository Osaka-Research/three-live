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
 * @fileoverview Phase 1.2: 6DoF Input, Ray/Direct-Pinch & Mobile Screen Touch Manager.
 * Tracks WebXR controllers, 25-joint XRHand pinch hysteresis, and mobile screen touch rays,
 * performing mesh raycasting & poke detection and dispatching `xr-select-*` & `xr-squeeze` events.
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
  rayIntersectsTriangle,
} from '../../three-live/src/math';
import {
  extractPosition,
  extractQuaternion,
  getMeshXRTraits,
  type XRPose6DoF,
  type XRTraitSystem,
} from './xr-traits';

export interface XRInputHit {
  mesh: any;
  distance: number;
  point: [number, number, number];
  uv: [number, number];
}

export interface XRSelectEventDetail {
  hand: 'left' | 'right' | 'screen';
  pivotPosition: [number, number, number];
  quaternion: [number, number, number, number];
  rayOrigin: [number, number, number];
  rayDirection: [number, number, number];
  hit: XRInputHit | null;
}

/**
 * Raycasts a 3D world ray `(origin, dir)` against all interactive `MeshGpu` instances in `ThreeView`.
 */
const _v0: [number, number, number] = [0, 0, 0];
const _v1: [number, number, number] = [0, 0, 0];
const _v2: [number, number, number] = [0, 0, 0];
const _sphereCenter: [number, number, number] = [0, 0, 0];

function getOrComputePrimitiveSphere(
  prim: any,
  pos: Float32Array,
): {
  cx: number;
  cy: number;
  cz: number;
  r: number;
} {
  if (prim._boundingSphere) return prim._boundingSphere;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i];
    const y = pos[i + 1];
    const z = pos[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const r = Math.hypot(maxX - cx, maxY - cy, maxZ - cz);
  prim._boundingSphere = {cx, cy, cz, r};
  return prim._boundingSphere;
}

function maxMatrixScale(m: Float32Array): number {
  const sx = Math.hypot(m[0], m[1], m[2]);
  const sy = Math.hypot(m[4], m[5], m[6]);
  const sz = Math.hypot(m[8], m[9], m[10]);
  return Math.max(sx, sy, sz, 1e-4);
}

function rayIntersectsSphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  maxDist: number,
): boolean {
  const vx = cx - ox;
  const vy = cy - oy;
  const vz = cz - oz;
  const proj = vx * dx + vy * dy + vz * dz;
  if (proj + r < 0 || proj - r > maxDist) return false;
  const distSq = vx * vx + vy * vy + vz * vz - proj * proj;
  return distSq <= r * r;
}

export function raycastGpuMeshes(
  meshes: any[],
  modelRootMatrixOrOrigin: Float32Array | [number, number, number] | null,
  originOrDir: [number, number, number],
  maybeDir?: [number, number, number],
): XRInputHit | null {
  let modelRootMatrix: Float32Array | null = null;
  let origin: [number, number, number];
  let dir: [number, number, number];

  if (maybeDir !== undefined) {
    modelRootMatrix = modelRootMatrixOrOrigin as Float32Array | null;
    origin = originOrDir;
    dir = maybeDir;
  } else {
    origin = modelRootMatrixOrOrigin as [number, number, number];
    dir = originOrDir;
  }

  let closestHit: XRInputHit | null = null;
  const outHit = {
    distance: Infinity,
    point: [0, 0, 0] as [number, number, number],
    normal: [0, 0, 1] as [number, number, number],
  };

  const rootScale = modelRootMatrix ? maxMatrixScale(modelRootMatrix) : 1.0;

  for (const mesh of meshes) {
    if (!mesh || mesh.visible === false || mesh.name === '__xr_reticle__') {
      continue;
    }
    const traits = getMeshXRTraits(mesh);
    if (traits?.pointerEvents === 'none') continue;

    const m = mesh.transform;
    const meshScale = maxMatrixScale(m) * rootScale;

    for (const prim of mesh.primitives || []) {
      const pos = prim.positions as Float32Array | undefined;
      if (!pos || pos.length < 9) continue;

      const sphere = getOrComputePrimitiveSphere(prim, pos);
      transformCoordsOut(
        _sphereCenter,
        sphere.cx,
        sphere.cy,
        sphere.cz,
        m,
        modelRootMatrix,
      );
      const worldRadius = sphere.r * meshScale + 0.05;
      if (
        !rayIntersectsSphere(
          origin[0],
          origin[1],
          origin[2],
          dir[0],
          dir[1],
          dir[2],
          _sphereCenter[0],
          _sphereCenter[1],
          _sphereCenter[2],
          worldRadius,
          outHit.distance,
        )
      ) {
        continue;
      }

      const uvs = prim.uvs as Float32Array | undefined;
      const indices = prim.indices as Uint16Array | Uint32Array | null;
      const triCount = indices
        ? Math.floor(indices.length / 3)
        : Math.floor(pos.length / 9);

      for (let t = 0; t < triCount; t++) {
        const i0 = indices ? indices[t * 3] : t * 3;
        const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
        const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;

        transformPointOut(_v0, pos, i0, m, modelRootMatrix);
        transformPointOut(_v1, pos, i1, m, modelRootMatrix);
        transformPointOut(_v2, pos, i2, m, modelRootMatrix);

        const hit = rayIntersectsTriangle(
          origin[0],
          origin[1],
          origin[2],
          dir[0],
          dir[1],
          dir[2],
          _v0[0],
          _v0[1],
          _v0[2],
          _v1[0],
          _v1[1],
          _v1[2],
          _v2[0],
          _v2[1],
          _v2[2],
          outHit,
        );
        if (hit) {
          const hitPoint: [number, number, number] = [
            outHit.point[0],
            outHit.point[1],
            outHit.point[2],
          ];
          const uv = computeBarycentricUV(
            hitPoint,
            _v0,
            _v1,
            _v2,
            uvs,
            i0,
            i1,
            i2,
          );
          closestHit = {
            mesh,
            distance: outHit.distance,
            point: hitPoint,
            uv,
          };
        }
      }
    }
  }

  return closestHit;
}

function transformCoordsOut(
  out: [number, number, number],
  x: number,
  y: number,
  z: number,
  meshMat: Float32Array,
  rootMat: Float32Array | null,
): void {
  let wx = meshMat[0] * x + meshMat[4] * y + meshMat[8] * z + meshMat[12];
  let wy = meshMat[1] * x + meshMat[5] * y + meshMat[9] * z + meshMat[13];
  let wz = meshMat[2] * x + meshMat[6] * y + meshMat[10] * z + meshMat[14];
  if (rootMat) {
    const rx =
      rootMat[0] * wx + rootMat[4] * wy + rootMat[8] * wz + rootMat[12];
    const ry =
      rootMat[1] * wx + rootMat[5] * wy + rootMat[9] * wz + rootMat[13];
    const rz =
      rootMat[2] * wx + rootMat[6] * wy + rootMat[10] * wz + rootMat[14];
    wx = rx;
    wy = ry;
    wz = rz;
  }
  out[0] = wx;
  out[1] = wy;
  out[2] = wz;
}

function transformPointOut(
  out: [number, number, number],
  pos: Float32Array,
  idx: number,
  meshMat: Float32Array,
  rootMat: Float32Array | null,
): void {
  transformCoordsOut(
    out,
    pos[idx * 3],
    pos[idx * 3 + 1],
    pos[idx * 3 + 2],
    meshMat,
    rootMat,
  );
}

function computeBarycentricUV(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
  uvs: Float32Array | undefined,
  i0: number,
  i1: number,
  i2: number,
): [number, number] {
  if (!uvs || uvs.length <= Math.max(i0, i1, i2) * 2 + 1) {
    return [0.5, 0.5];
  }
  const v0x = b[0] - a[0],
    v0y = b[1] - a[1],
    v0z = b[2] - a[2];
  const v1x = c[0] - a[0],
    v1y = c[1] - a[1],
    v1z = c[2] - a[2];
  const v2x = p[0] - a[0],
    v2y = p[1] - a[1],
    v2z = p[2] - a[2];
  const d00 = v0x * v0x + v0y * v0y + v0z * v0z;
  const d01 = v0x * v1x + v0y * v1y + v0z * v1z;
  const d11 = v1x * v1x + v1y * v1y + v1z * v1z;
  const d20 = v2x * v0x + v2y * v0y + v2z * v0z;
  const d21 = v2x * v1x + v2y * v1y + v2z * v1z;
  const denom = d00 * d11 - d01 * d01;
  if (Math.abs(denom) < 1e-8) return [0.5, 0.5];
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1.0 - v - w;
  const texU = u * uvs[i0 * 2] + v * uvs[i1 * 2] + w * uvs[i2 * 2];
  const texV = u * uvs[i0 * 2 + 1] + v * uvs[i1 * 2 + 1] + w * uvs[i2 * 2 + 1];
  return [Math.max(0, Math.min(1, texU)), Math.max(0, Math.min(1, texV))];
}

export class XRInputManager {
  private isPinching: Record<'left' | 'right' | 'screen', boolean> = {
    left: false,
    right: false,
    screen: false,
  };
  private handPoses: Partial<Record<'left' | 'right' | 'screen', XRPose6DoF>> =
    {};
  private onSpatialSlotHit?: (hit: XRInputHit, type: string) => void;

  constructor(
    private element: any,
    private traitSystem: XRTraitSystem,
    onSpatialSlotHit?: (hit: XRInputHit, type: string) => void,
  ) {
    this.onSpatialSlotHit = onSpatialSlotHit;
  }

  public getHandPoses(): Partial<
    Record<'left' | 'right' | 'screen', XRPose6DoF>
  > {
    return this.handPoses;
  }

  /**
   * Processes a single WebXR frame's input sources (6DoF controllers, 25-joint hands, and mobile screen rays).
   */
  public processXRFrame(
    viewer: any,
    session: any,
    frame: any,
    refSpace: any,
  ): void {
    if (!viewer || !session || !frame || !refSpace) return;
    const sources = session.inputSources || [];

    for (const source of sources) {
      const handedness: 'left' | 'right' | 'screen' =
        source.handedness === 'left'
          ? 'left'
          : source.handedness === 'right'
            ? 'right'
            : 'screen';

      let poseMat: Float32Array | null = null;
      if (source.targetRaySpace && typeof frame.getPose === 'function') {
        const rayPose = frame.getPose(source.targetRaySpace, refSpace);
        if (rayPose?.transform?.matrix) {
          poseMat = new Float32Array(rayPose.transform.matrix);
        }
      }

      // Check 25-joint XRHand pinch state (distance between index-finger-tip and thumb-tip)
      let handPinchState: boolean | null = null;
      if (source.hand && typeof frame.getJointPose === 'function') {
        const indexTip = source.hand.get('index-finger-tip');
        const thumbTip = source.hand.get('thumb-tip');
        if (indexTip && thumbTip) {
          const indexPose = frame.getJointPose(indexTip, refSpace);
          const thumbPose = frame.getJointPose(thumbTip, refSpace);
          if (
            indexPose?.transform?.position &&
            thumbPose?.transform?.position
          ) {
            const ip = indexPose.transform.position;
            const tp = thumbPose.transform.position;
            const dist = Math.hypot(ip.x - tp.x, ip.y - tp.y, ip.z - tp.z);
            const wasPinching = this.isPinching[handedness];
            // Hysteresis: trigger at 1.8cm, release at 2.6cm
            handPinchState = wasPinching ? dist < 0.026 : dist < 0.018;

            // Use midpoint between thumb and index tip as the manipulation pivot
            const midPos: [number, number, number] = [
              (ip.x + tp.x) * 0.5,
              (ip.y + tp.y) * 0.5,
              (ip.z + tp.z) * 0.5,
            ];
            const quat = poseMat
              ? extractQuaternion(poseMat)
              : ([0, 0, 0, 1] as [number, number, number, number]);
            poseMat = mat4Create();
            mat4FromRotationTranslationScale(poseMat, quat, midPos, [1, 1, 1]);
          }
        }
      }

      if (!poseMat) continue;

      const position = extractPosition(poseMat);
      const quaternion = extractQuaternion(poseMat);
      const rayDirection: [number, number, number] = [
        -poseMat[8],
        -poseMat[9],
        -poseMat[10],
      ];
      const len =
        Math.hypot(rayDirection[0], rayDirection[1], rayDirection[2]) || 1;
      rayDirection[0] /= len;
      rayDirection[1] /= len;
      rayDirection[2] /= len;

      const currentPose: XRPose6DoF = {
        position,
        quaternion,
        matrix: poseMat,
      };
      this.handPoses[handedness] = currentPose;

      // Determine select active state from either XRHand pinch or Gamepad button 0
      const gamepadPressed = Boolean(source.gamepad?.buttons?.[0]?.pressed);
      const squeezePressed = Boolean(source.gamepad?.buttons?.[1]?.pressed);
      const isNowSelecting =
        handPinchState !== null ? handPinchState : gamepadPressed;
      const wasSelecting = this.isPinching[handedness];

      const hit = raycastGpuMeshes(
        viewer.meshes || [],
        viewer.modelRootMatrix || null,
        position,
        rayDirection,
      );

      const eventDetail: XRSelectEventDetail = {
        hand: handedness,
        pivotPosition: position,
        quaternion,
        rayOrigin: position,
        rayDirection,
        hit,
      };

      if (isNowSelecting && !wasSelecting) {
        this.isPinching[handedness] = true;
        if (hit) {
          this.traitSystem.startGrab(hit.mesh, handedness, currentPose);
          if (hit.mesh.isSpatialSlot && this.onSpatialSlotHit) {
            this.onSpatialSlotHit(hit, 'click');
          }
        }
        this.dispatchXREvent('xr-select-start', eventDetail);
      } else if (isNowSelecting && wasSelecting) {
        this.dispatchXREvent('xr-select-move', eventDetail);
      } else if (!isNowSelecting && wasSelecting) {
        this.isPinching[handedness] = false;
        this.traitSystem.endGrab(handedness, this.handPoses);
        this.dispatchXREvent('xr-select-end', eventDetail);
      }

      if (squeezePressed) {
        this.dispatchXREvent('xr-squeeze', eventDetail);
      }
    }
  }

  /**
   * Simulates a 6DoF select start/move/end from the Desktop Simulator or programmatic tests.
   */
  public triggerSyntheticSelect(
    type: 'start' | 'move' | 'end',
    hand: 'left' | 'right' | 'screen',
    viewer: any,
    origin: [number, number, number],
    direction: [number, number, number],
    quaternion: [number, number, number, number] = [0, 0, 0, 1],
  ): XRInputHit | null {
    const matrix = mat4Create();
    mat4FromRotationTranslationScale(matrix, quaternion, origin, [1, 1, 1]);
    const pose: XRPose6DoF = {position: origin, quaternion, matrix};
    this.handPoses[hand] = pose;

    const hit = raycastGpuMeshes(
      viewer?.meshes || [],
      viewer?.modelRootMatrix || null,
      origin,
      direction,
    );

    const detail: XRSelectEventDetail = {
      hand,
      pivotPosition: origin,
      quaternion,
      rayOrigin: origin,
      rayDirection: direction,
      hit,
    };

    if (type === 'start') {
      this.isPinching[hand] = true;
      if (hit) {
        this.traitSystem.startGrab(hit.mesh, hand, pose);
        if (hit.mesh.isSpatialSlot && this.onSpatialSlotHit) {
          this.onSpatialSlotHit(hit, 'click');
        }
      }
      this.dispatchXREvent('xr-select-start', detail);
    } else if (type === 'move') {
      this.dispatchXREvent('xr-select-move', detail);
    } else {
      this.isPinching[hand] = false;
      this.traitSystem.endGrab(hand, this.handPoses);
      this.dispatchXREvent('xr-select-end', detail);
    }

    return hit;
  }

  private dispatchXREvent(name: string, detail: XRSelectEventDetail): void {
    if (
      this.element &&
      typeof this.element.dispatchEvent === 'function' &&
      typeof CustomEvent !== 'undefined'
    ) {
      this.element.dispatchEvent(
        new CustomEvent(name, {
          bubbles: true,
          composed: true,
          detail,
        }),
      );
    }
  }
}
