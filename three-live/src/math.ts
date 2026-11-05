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
 * @fileoverview Pure Self-Contained Matrix & Transform Math for Three-Live.
 * Zero dependencies, allocation-conscious 3D math routines and glTF hierarchy evaluation.
 */

export function mat4Create(): Float32Array {
  const out = new Float32Array(16);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

export function mat4Perspective(
  out: Float32Array,
  fovy: number,
  aspect: number,
  near: number,
  far: number,
): Float32Array {
  const f = 1.0 / Math.tan(fovy / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  const nf = 1 / (near - far);
  out[10] = (far + near) * nf;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(
  out: Float32Array,
  eye: [number, number, number],
  target: [number, number, number],
  up: [number, number, number],
): Float32Array {
  const [eyex, eyey, eyez] = eye;
  const [upx, upy, upz] = up;
  const [targetx, targety, targetz] = target;

  let z0 = eyex - targetx;
  let z1 = eyey - targety;
  let z2 = eyez - targetz;
  let len = Math.hypot(z0, z1, z2);
  if (len <= 0.00001) {
    z0 = 0;
    z1 = 0;
    z2 = 1;
  } else {
    z0 /= len;
    z1 /= len;
    z2 /= len;
  }

  let x0 = upy * z2 - upz * z1;
  let x1 = upz * z0 - upx * z2;
  let x2 = upx * z1 - upy * z0;
  len = Math.hypot(x0, x1, x2);
  if (len <= 0.00001) {
    x0 = 0;
    x1 = 0;
    x2 = 0;
  } else {
    x0 /= len;
    x1 /= len;
    x2 /= len;
  }

  let y0 = z1 * x2 - z2 * x1;
  let y1 = z2 * x0 - z0 * x2;
  let y2 = z0 * x1 - z1 * x0;
  len = Math.hypot(y0, y1, y2);
  if (len <= 0.00001) {
    y0 = 0;
    y1 = 0;
    y2 = 0;
  } else {
    y0 /= len;
    y1 /= len;
    y2 /= len;
  }

  out[0] = x0;
  out[1] = y0;
  out[2] = z0;
  out[3] = 0;
  out[4] = x1;
  out[5] = y1;
  out[6] = z1;
  out[7] = 0;
  out[8] = x2;
  out[9] = y2;
  out[10] = z2;
  out[11] = 0;
  out[12] = -(x0 * eyex + x1 * eyey + x2 * eyez);
  out[13] = -(y0 * eyex + y1 * eyey + y2 * eyez);
  out[14] = -(z0 * eyex + z1 * eyey + z2 * eyez);
  out[15] = 1;
  return out;
}

export function mat4Multiply(
  out: Float32Array,
  a: Float32Array,
  b: Float32Array,
): Float32Array {
  const a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  const a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  const a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  const a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  let b0 = b[0],
    b1 = b[1],
    b2 = b[2],
    b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

export function mat4FromRotationTranslationScale(
  out: Float32Array,
  q: [number, number, number, number] | Float32Array | number[],
  v: [number, number, number] | Float32Array | number[],
  s: [number, number, number] | Float32Array | number[],
): Float32Array {
  const x = q[0],
    y = q[1],
    z = q[2],
    w = q[3];
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  const sx = s[0],
    sy = s[1],
    sz = s[2];

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = v[0];
  out[13] = v[1];
  out[14] = v[2];
  out[15] = 1;
  return out;
}

/**
 * Computes a 3x3 normal matrix (inverse transpose of upper-left 3x3) from a 4x4 matrix.
 * A positive minDeterminant also rejects nonfinite and near-singular matrices,
 * leaving the caller-provided fallback in out. Zero preserves exact-singular behavior.
 */
export function mat3NormalFromMat4<T extends Float32Array | Float64Array>(
  out: T,
  a: ArrayLike<number>,
  minDeterminant = 0,
): T {
  const a00 = a[0];
  const a01 = a[1];
  const a02 = a[2];
  const a10 = a[4];
  const a11 = a[5];
  const a12 = a[6];
  const a20 = a[8];
  const a21 = a[9];
  const a22 = a[10];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  let det = a00 * b01 + a01 * b11 + a02 * b21;
  if (!det || (minDeterminant > 0 &&
      (!Number.isFinite(det) || Math.abs(det) <= minDeterminant))) return out;
  det = 1.0 / det;

  out[0] = b01 * det;
  out[1] = b11 * det;
  out[2] = b21 * det;
  out[3] = (-a22 * a01 + a02 * a21) * det;
  out[4] = (a22 * a00 - a02 * a20) * det;
  out[5] = (-a21 * a00 + a01 * a20) * det;
  out[6] = (a12 * a01 - a02 * a11) * det;
  out[7] = (-a12 * a00 + a02 * a10) * det;
  out[8] = (a11 * a00 - a01 * a10) * det;
  return out;
}

/**
 * Inverts a 4x4 matrix into `out`, or returns null if the matrix is singular.
 */
export function mat4Invert(
  out: Float32Array,
  a: Float32Array,
): Float32Array | null {
  const a00 = a[0];
  const a01 = a[1];
  const a02 = a[2];
  const a03 = a[3];
  const a10 = a[4];
  const a11 = a[5];
  const a12 = a[6];
  const a13 = a[7];
  const a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  const a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det =
    b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1.0 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

export interface RayHit {
  distance: number;
  point: [number, number, number];
  normal: [number, number, number];
}

export function unprojectPoint(
  out: [number, number, number],
  nx: number,
  ny: number,
  nz: number,
  invM: Float32Array,
): void {
  const x = invM[0] * nx + invM[4] * ny + invM[8] * nz + invM[12];
  const y = invM[1] * nx + invM[5] * ny + invM[9] * nz + invM[13];
  const z = invM[2] * nx + invM[6] * ny + invM[10] * nz + invM[14];
  const w = invM[3] * nx + invM[7] * ny + invM[11] * nz + invM[15];
  const invW = w !== 0 ? 1.0 / w : 1.0;
  out[0] = x * invW;
  out[1] = y * invW;
  out[2] = z * invW;
}

export function rayIntersectsTriangle(
  roX: number,
  roY: number,
  roZ: number,
  rdX: number,
  rdY: number,
  rdZ: number,
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number,
  outHit: RayHit,
  epsilon = 0.0,
): boolean {
  const e1x = v1x - v0x,
    e1y = v1y - v0y,
    e1z = v1z - v0z;
  const e2x = v2x - v0x,
    e2y = v2y - v0y,
    e2z = v2z - v0z;
  const hx = rdY * e2z - rdZ * e2y;
  const hy = rdZ * e2x - rdX * e2z;
  const hz = rdX * e2y - rdY * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -1e-7 && a < 1e-7) return false;
  const f = 1.0 / a;
  const sx = roX - v0x,
    sy = roY - v0y,
    sz = roZ - v0z;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < -epsilon || u > 1.0 + epsilon) return false;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * (rdX * qx + rdY * qy + rdZ * qz);
  if (v < -epsilon || u + v > 1.0 + epsilon) return false;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  if (t > 1e-4 && t < outHit.distance) {
    outHit.distance = t;
    outHit.point = [roX + rdX * t, roY + rdY * t, roZ + rdZ * t];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const nLen = Math.hypot(nx, ny, nz) || 1.0;
    outHit.normal = [nx / nLen, ny / nLen, nz / nLen];
    return true;
  }
  return false;
}

/**
 * Evaluates the full glTF 2.0 node hierarchy, recursively accumulating
 * parent-child transformations into world space 4x4 matrices.
 */
export function resolveNodeWorldMatrices(
  gltf: any,
  localMatrices?: Float32Array[],
): Float32Array[] {
  const nodeCount = Array.isArray(gltf?.nodes) ? gltf.nodes.length : 0;
  const nodeWorldMatrices: Float32Array[] = [];
  for (let i = 0; i < nodeCount; i++) {
    nodeWorldMatrices.push(mat4Create());
  }

  if (nodeCount === 0) return nodeWorldMatrices;

  const childIndices = new Set<number>();
  for (const node of gltf.nodes) {
    if (Array.isArray(node.children)) {
      for (const c of node.children) {
        childIndices.add(c);
      }
    }
  }

  const visitedNodes = new Set<number>();
  const maxDepth = 128;

  const computeWorld = (
    nodeIdx: number,
    parentWorld: Float32Array | null,
    depth = 0,
  ) => {
    if (
      depth > maxDepth ||
      nodeIdx < 0 ||
      nodeIdx >= nodeCount ||
      visitedNodes.has(nodeIdx)
    ) {
      return;
    }
    visitedNodes.add(nodeIdx);
    const node = gltf.nodes[nodeIdx];
    if (!node) return;
    const local = mat4Create();
    if (localMatrices && localMatrices[nodeIdx]) {
      local.set(localMatrices[nodeIdx]);
    } else if (node.matrix && node.matrix.length === 16) {
      local.set(node.matrix);
    } else {
      const t = node.translation || [0, 0, 0];
      const r = node.rotation || [0, 0, 0, 1];
      const s = node.scale || [1, 1, 1];
      mat4FromRotationTranslationScale(local, r, t, s);
    }
    const world = nodeWorldMatrices[nodeIdx];
    if (parentWorld) {
      mat4Multiply(world, parentWorld, local);
    } else {
      world.set(local);
    }
    if (Array.isArray(node.children)) {
      for (const childIdx of node.children) {
        if (typeof childIdx === 'number') {
          computeWorld(childIdx, world, depth + 1);
        }
      }
    }
  };

  const sceneRoots: number[] = [];
  const activeScene =
    gltf.scenes && gltf.scenes[gltf.scene !== undefined ? gltf.scene : 0];
  if (activeScene && Array.isArray(activeScene.nodes)) {
    sceneRoots.push(...activeScene.nodes);
  } else {
    for (let i = 0; i < nodeCount; i++) {
      if (!childIndices.has(i)) sceneRoots.push(i);
    }
  }
  for (const rootIdx of sceneRoots) {
    computeWorld(rootIdx, null);
  }
  for (let i = 0; i < nodeCount; i++) {
    if (!childIndices.has(i) && !sceneRoots.includes(i)) {
      computeWorld(i, null);
    }
  }

  return nodeWorldMatrices;
}
