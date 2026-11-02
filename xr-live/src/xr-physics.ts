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
 * @fileoverview Phase 2.2: Zero-WASM Analytical Depth-Heightfield & Plane Physics.
 * Replaces 1.5 MB Rapier3D WASM with a ~120-line semi-implicit Euler rigid-body
 * solver supporting gravity, restitution bounce, real-world WebXR depth heightfield
 * collisions, room plane collisions, and O(N^2) sphere-to-sphere Ballpit collisions.
 */

import type {XRDepthManager} from './xr-depth';
import {
  applyMeshTRS,
  extractPosition,
  extractQuaternion,
  extractScale,
  getMeshXRTraits,
} from './xr-traits';

export interface PhysicsBodyState {
  velocity: [number, number, number];
  radius: number;
  restitution: number;
  friction: number;
}

export interface XRCameraCollisionContext {
  modelRootMatrix?: Float32Array | null;
  viewMatrix?: Float32Array | null;
  projMatrix?: Float32Array | null;
  isAR?: boolean;
}

export class XRHeightfieldPhysics {
  private bodies = new WeakMap<object, PhysicsBodyState>();
  public gravity: [number, number, number] = [0, -9.81, 0];
  public tableCenter: [number, number] = [0, 0];
  public tableRadius = 0.62;
  public colliders: Array<{
    min: [number, number, number];
    max: [number, number, number];
  }> = [];
  public roomBounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
    ceilingY: number;
  } | null = null;

  public getOrCreateBody(mesh: any): PhysicsBodyState {
    let state = this.bodies.get(mesh);
    if (!state) {
      let radius = 0.1;
      const prim = mesh?.primitives?.[0];
      if (prim?.positions && prim.positions.length >= 3) {
        let maxR = 0;
        for (let i = 0; i < prim.positions.length; i += 3) {
          const r = Math.hypot(
            prim.positions[i],
            prim.positions[i + 1],
            prim.positions[i + 2],
          );
          if (r > maxR) maxR = r;
        }
        if (maxR > 0.005) radius = maxR;
      }
      const scl = extractScale(mesh.transform);
      radius *= Math.max(scl[0], scl[1], scl[2]);
      state = {
        velocity: [0, 0, 0],
        radius,
        restitution: 0.65,
        friction: 0.25,
      };
      this.bodies.set(mesh, state);
    }
    return state;
  }

  public setVelocity(mesh: any, vx: number, vy: number, vz: number): void {
    const body = this.getOrCreateBody(mesh);
    body.velocity = [vx, vy, vz];
  }

  /**
   * Steps all `userData.xr.physics = 'dynamic'` meshes for `dt` seconds.
   */
  public step(
    meshes: any[],
    dt: number,
    depthManager?: XRDepthManager,
    floorY = 0,
    tableY?: number,
    onBounce?: (mesh: any, speed: number) => void,
    xrCameraContext?: XRCameraCollisionContext,
  ): void {
    if (!(dt > 0)) return;
    const clampedDt = Math.max(0.001, Math.min(0.05, dt));
    const dynamicMeshes: Array<{mesh: any; body: PhysicsBodyState}> = [];

    for (const mesh of meshes) {
      if (!mesh || mesh.visible === false) continue;
      const traits = getMeshXRTraits(mesh);
      if (traits?.physics !== 'dynamic') continue;

      const body = this.getOrCreateBody(mesh);
      dynamicMeshes.push({mesh, body});

      const pos = extractPosition(mesh.transform);
      const quat = extractQuaternion(mesh.transform);
      const scl = extractScale(mesh.transform);

      // 1. Semi-implicit Euler integration
      body.velocity[0] += this.gravity[0] * clampedDt;
      body.velocity[1] += this.gravity[1] * clampedDt;
      body.velocity[2] += this.gravity[2] * clampedDt;

      pos[0] += body.velocity[0] * clampedDt;
      pos[1] += body.velocity[1] * clampedDt;
      pos[2] += body.velocity[2] * clampedDt;

      // 2. Check WebXR hardware depth heightfield collision
      if (depthManager && depthManager.getLatestDepthInfo()) {
        const viewMat = xrCameraContext?.viewMatrix;
        const projMat = xrCameraContext?.projMatrix;
        if (viewMat && projMat) {
          const rm = xrCameraContext?.modelRootMatrix;
          const sRoot = rm
            ? Math.hypot(rm[0], rm[1], rm[2]) || 1
            : 1;
          const wx = rm
            ? rm[0] * pos[0] + rm[4] * pos[1] + rm[8] * pos[2] + rm[12]
            : pos[0];
          const wy = rm
            ? rm[1] * pos[0] + rm[5] * pos[1] + rm[9] * pos[2] + rm[13]
            : pos[1];
          const wz = rm
            ? rm[2] * pos[0] + rm[6] * pos[1] + rm[10] * pos[2] + rm[14]
            : pos[2];

          const vx =
            viewMat[0] * wx + viewMat[4] * wy + viewMat[8] * wz + viewMat[12];
          const vy =
            viewMat[1] * wx + viewMat[5] * wy + viewMat[9] * wz + viewMat[13];
          const vz =
            viewMat[2] * wx + viewMat[6] * wy + viewMat[10] * wz + viewMat[14];
          const camDist = -vz;

          const cx =
            projMat[0] * vx + projMat[4] * vy + projMat[8] * vz + projMat[12];
          const cy =
            projMat[1] * vx + projMat[5] * vy + projMat[9] * vz + projMat[13];
          const cw =
            projMat[3] * vx + projMat[7] * vy + projMat[11] * vz + projMat[15];

          if (cw > 0.05 && camDist > 0.15) {
            const u = (cx / cw) * 0.5 + 0.5;
            const v = 0.5 - (cy / cw) * 0.5;
            if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
              const sample = depthManager.sampleDepthAndNormal(u, v, projMat);
              const worldRadius = body.radius * sRoot;
              if (
                sample &&
                sample.depthMeters > 0.2 &&
                camDist + worldRadius > sample.depthMeters &&
                camDist - worldRadius < sample.depthMeters + 0.18
              ) {
                const [vnx, vny, vnz] = sample.normal;
                const invS = 1 / sRoot;
                const m00 = rm ? rm[0] * invS : 1,
                  m10 = rm ? rm[1] * invS : 0,
                  m20 = rm ? rm[2] * invS : 0;
                const m01 = rm ? rm[4] * invS : 0,
                  m11 = rm ? rm[5] * invS : 1,
                  m21 = rm ? rm[6] * invS : 0;
                const m02 = rm ? rm[8] * invS : 0,
                  m12 = rm ? rm[9] * invS : 0,
                  m22 = rm ? rm[10] * invS : 1;

                // Column vectors of R_vm = R_v * R_m in view space
                const r00 =
                  viewMat[0] * m00 + viewMat[4] * m10 + viewMat[8] * m20;
                const r10 =
                  viewMat[1] * m00 + viewMat[5] * m10 + viewMat[9] * m20;
                const r20 =
                  viewMat[2] * m00 + viewMat[6] * m10 + viewMat[10] * m20;

                const r01 =
                  viewMat[0] * m01 + viewMat[4] * m11 + viewMat[8] * m21;
                const r11 =
                  viewMat[1] * m01 + viewMat[5] * m11 + viewMat[9] * m21;
                const r21 =
                  viewMat[2] * m01 + viewMat[6] * m11 + viewMat[10] * m21;

                const r02 =
                  viewMat[0] * m02 + viewMat[4] * m12 + viewMat[8] * m22;
                const r12 =
                  viewMat[1] * m02 + viewMat[5] * m12 + viewMat[9] * m22;
                const r22 =
                  viewMat[2] * m02 + viewMat[6] * m12 + viewMat[10] * m22;

                let lnx = r00 * vnx + r10 * vny + r20 * vnz;
                let lny = r01 * vnx + r11 * vny + r21 * vnz;
                let lnz = r02 * vnx + r12 * vny + r22 * vnz;
                const nLen = Math.hypot(lnx, lny, lnz) || 1;
                lnx /= nLen;
                lny /= nLen;
                lnz /= nLen;

                const vDotN =
                  body.velocity[0] * lnx +
                  body.velocity[1] * lny +
                  body.velocity[2] * lnz;
                if (vDotN < 0) {
                  const j = -(1 + body.restitution) * vDotN;
                  body.velocity[0] += j * lnx;
                  body.velocity[1] += j * lny;
                  body.velocity[2] += j * lnz;
                  const pushLocal = Math.min(
                    (camDist + worldRadius - sample.depthMeters) * invS,
                    body.radius * 1.5,
                  );
                  pos[0] += lnx * pushLocal;
                  pos[1] += lny * pushLocal;
                  pos[2] += lnz * pushLocal;
                  onBounce?.(mesh, Math.abs(vDotN));
                }
              }
            }
          }
        } else {
          const u = Math.max(0, Math.min(1, pos[0] * 0.5 + 0.5));
          const v = Math.max(0, Math.min(1, 0.5 - pos[1] * 0.35));
          const sample = depthManager.sampleDepthAndNormal(u, v);
          if (sample) {
            const virtDepth = Math.abs(pos[2]);
            if (
              virtDepth + body.radius > sample.depthMeters &&
              virtDepth - body.radius < sample.depthMeters + 0.25
            ) {
              const [nx, ny, nz] = sample.normal;
              const vDotN =
                body.velocity[0] * nx +
                body.velocity[1] * ny +
                body.velocity[2] * nz;
              if (vDotN < 0) {
                const j = -(1 + body.restitution) * vDotN;
                body.velocity[0] += j * nx;
                body.velocity[1] += j * ny;
                body.velocity[2] += j * nz;
                pos[2] = -Math.max(0.05, sample.depthMeters - body.radius);
                onBounce?.(mesh, Math.abs(vDotN));
              }
            }
          }
        }
      }

      // 3 & 4. Check tabletop surface collision & floor plane collision
      const resolvePlaneBounce = (planeY: number) => {
        const impactSpeed = Math.abs(body.velocity[1]);
        pos[1] = planeY + body.radius;
        if (body.velocity[1] < 0) {
          body.velocity[1] = -body.velocity[1] * body.restitution;
          body.velocity[0] *= 1 - body.friction * clampedDt * 5;
          body.velocity[2] *= 1 - body.friction * clampedDt * 5;
          if (Math.abs(body.velocity[1]) < 0.08) body.velocity[1] = 0;
          if (impactSpeed > 0.2) onBounce?.(mesh, impactSpeed);
        }
      };

      if (tableY !== undefined) {
        const dxT = pos[0] - this.tableCenter[0];
        const dzT = pos[2] - this.tableCenter[1];
        const distT = Math.hypot(dxT, dzT);
        if (
          distT < this.tableRadius + body.radius * 0.4 &&
          pos[1] - body.radius < tableY &&
          pos[1] >= tableY - body.radius - 0.35
        ) {
          resolvePlaneBounce(tableY);
        } else if (
          pos[1] < tableY &&
          pos[1] + body.radius > floorY &&
          distT < this.tableRadius + body.radius &&
          distT > 1e-4
        ) {
          const nx = dxT / distT;
          const nz = dzT / distT;
          pos[0] = this.tableCenter[0] + nx * (this.tableRadius + body.radius);
          pos[2] = this.tableCenter[1] + nz * (this.tableRadius + body.radius);
          const vDotN = body.velocity[0] * nx + body.velocity[2] * nz;
          if (vDotN < 0) {
            body.velocity[0] -= (1 + body.restitution) * vDotN * nx;
            body.velocity[2] -= (1 + body.restitution) * vDotN * nz;
            if (Math.abs(vDotN) > 0.2) onBounce?.(mesh, Math.abs(vDotN));
          }
        }
      }

      const activeColliders = xrCameraContext?.isAR ? [] : this.colliders;
      for (const box of activeColliders) {
        const cx = Math.max(box.min[0], Math.min(box.max[0], pos[0]));
        const cy = Math.max(box.min[1], Math.min(box.max[1], pos[1]));
        const cz = Math.max(box.min[2], Math.min(box.max[2], pos[2]));
        const dx = pos[0] - cx;
        const dy = pos[1] - cy;
        const dz = pos[2] - cz;
        const dist = Math.hypot(dx, dy, dz);
        if (dist < body.radius) {
          let nx = 0,
            ny = 1,
            nz = 0;
          if (dist > 1e-5) {
            nx = dx / dist;
            ny = dy / dist;
            nz = dz / dist;
            pos[0] = cx + nx * body.radius;
            pos[1] = cy + ny * body.radius;
            pos[2] = cz + nz * body.radius;
          } else {
            pos[1] = box.max[1] + body.radius;
          }
          const vDotN =
            body.velocity[0] * nx +
            body.velocity[1] * ny +
            body.velocity[2] * nz;
          if (vDotN < 0) {
            const j = -(1 + body.restitution) * vDotN;
            body.velocity[0] += j * nx;
            body.velocity[1] += j * ny;
            body.velocity[2] += j * nz;
            if (ny > 0.7 && Math.abs(body.velocity[1]) < 0.08) {
              body.velocity[1] = 0;
            }
            if (Math.abs(vDotN) > 0.2) onBounce?.(mesh, Math.abs(vDotN));
          }
        }
      }

      if (pos[1] - body.radius < floorY) {
        resolvePlaneBounce(floorY);
      }

      if (this.roomBounds) {
        const b = this.roomBounds;
        if (pos[1] + body.radius > b.ceilingY) {
          const impactSpeed = Math.abs(body.velocity[1]);
          pos[1] = b.ceilingY - body.radius;
          if (body.velocity[1] > 0) {
            body.velocity[1] = -body.velocity[1] * body.restitution;
            if (impactSpeed > 0.2) onBounce?.(mesh, impactSpeed);
          }
        }
        if (pos[0] - body.radius < b.minX) {
          const impactSpeed = Math.abs(body.velocity[0]);
          pos[0] = b.minX + body.radius;
          if (body.velocity[0] < 0) {
            body.velocity[0] = -body.velocity[0] * body.restitution;
            if (impactSpeed > 0.2) onBounce?.(mesh, impactSpeed);
          }
        } else if (pos[0] + body.radius > b.maxX) {
          const impactSpeed = Math.abs(body.velocity[0]);
          pos[0] = b.maxX - body.radius;
          if (body.velocity[0] > 0) {
            body.velocity[0] = -body.velocity[0] * body.restitution;
            if (impactSpeed > 0.2) onBounce?.(mesh, impactSpeed);
          }
        }
        if (pos[2] - body.radius < b.minZ) {
          const impactSpeed = Math.abs(body.velocity[2]);
          pos[2] = b.minZ + body.radius;
          if (body.velocity[2] < 0) {
            body.velocity[2] = -body.velocity[2] * body.restitution;
            if (impactSpeed > 0.2) onBounce?.(mesh, impactSpeed);
          }
        } else if (pos[2] + body.radius > b.maxZ) {
          const impactSpeed = Math.abs(body.velocity[2]);
          pos[2] = b.maxZ - body.radius;
          if (body.velocity[2] > 0) {
            body.velocity[2] = -body.velocity[2] * body.restitution;
            if (impactSpeed > 0.2) onBounce?.(mesh, impactSpeed);
          }
        }
      }

      applyMeshTRS(mesh, quat, pos, scl);
    }

    // 5. Resolve sphere-to-sphere elastic collisions (for dynamic ballpit scenes!)
    for (let i = 0; i < dynamicMeshes.length; i++) {
      for (let j = i + 1; j < dynamicMeshes.length; j++) {
        const a = dynamicMeshes[i];
        const b = dynamicMeshes[j];
        const posA = extractPosition(a.mesh.transform);
        const posB = extractPosition(b.mesh.transform);
        const dx = posB[0] - posA[0];
        const dy = posB[1] - posA[1];
        const dz = posB[2] - posA[2];
        const dist = Math.hypot(dx, dy, dz);
        const minDist = a.body.radius + b.body.radius;

        if (dist > 1e-5 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const nz = dz / dist;
          const overlap = (minDist - dist) * 0.5;

          posA[0] -= nx * overlap;
          posA[1] -= ny * overlap;
          posA[2] -= nz * overlap;
          posB[0] += nx * overlap;
          posB[1] += ny * overlap;
          posB[2] += nz * overlap;

          const rvx = b.body.velocity[0] - a.body.velocity[0];
          const rvy = b.body.velocity[1] - a.body.velocity[1];
          const rvz = b.body.velocity[2] - a.body.velocity[2];
          const velAlongNormal = rvx * nx + rvy * ny + rvz * nz;

          if (velAlongNormal < 0) {
            const e = Math.min(a.body.restitution, b.body.restitution);
            const impulse = -(1 + e) * velAlongNormal * 0.5;
            a.body.velocity[0] -= impulse * nx;
            a.body.velocity[1] -= impulse * ny;
            a.body.velocity[2] -= impulse * nz;
            b.body.velocity[0] += impulse * nx;
            b.body.velocity[1] += impulse * ny;
            b.body.velocity[2] += impulse * nz;
          }

          applyMeshTRS(
            a.mesh,
            extractQuaternion(a.mesh.transform),
            posA,
            extractScale(a.mesh.transform),
          );
          applyMeshTRS(
            b.mesh,
            extractQuaternion(b.mesh.transform),
            posB,
            extractScale(b.mesh.transform),
          );
        }
      }
    }
  }
}
