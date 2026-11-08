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
 * @fileoverview Extended Three.js bounding volumes (`Box3`, `Sphere`),
 * headless `CanvasTexture`, and deterministic procedural noise (`ImprovedNoise`,
 * `SimplexNoise`) for `proceduralPlugin`.
 */

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/**
 * Self-contained installer that attaches `Box3`, `Sphere`, and extended
 * `Vector3` / `Matrix4` / `BufferGeometry` bounding helpers onto a `THREE`
 * namespace and shared registry.
 *
 * NOTE: This function is serialized with `Function.prototype.toString()` into
 * sandboxed Web Workers, so it must remain 100% self-contained (do not
 * reference module-scoped imports or variables inside its body, and initialize
 * all class properties inside `constructor` rather than with class field
 * initializers).
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installProceduralExtension(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.Vector3 || !threeNs.BufferGeometry) return null;

  const Vector3 = threeNs.Vector3;
  const Matrix4 = threeNs.Matrix4;
  const BufferGeometry = threeNs.BufferGeometry;

  // tslint:disable-next-line:no-any Dynamic Vector3 instance from threeNs.
  type Vec3Like = any;

  if (typeof Vector3.prototype.distanceToSquared !== 'function') {
    Vector3.prototype.distanceToSquared = function (v: Vec3Like): number {
      const dx = this.x - Number(v?.x ?? 0);
      const dy = this.y - Number(v?.y ?? 0);
      const dz = this.z - Number(v?.z ?? 0);
      return dx * dx + dy * dy + dz * dz;
    };
  }
  if (typeof Vector3.prototype.addScalar !== 'function') {
    Vector3.prototype.addScalar = function (s: number): Vec3Like {
      const d = Number(s) || 0;
      return this.set(this.x + d, this.y + d, this.z + d);
    };
  }
  if (typeof Vector3.prototype.applyQuaternion !== 'function') {
    // tslint:disable-next-line:no-any Dynamic Quaternion instance.
    Vector3.prototype.applyQuaternion = function (q: any): Vec3Like {
      const x = this.x;
      const y = this.y;
      const z = this.z;
      const qx = Number(q?.x) || 0;
      const qy = Number(q?.y) || 0;
      const qz = Number(q?.z) || 0;
      const qw = q?.w === undefined ? 1 : Number(q.w) || 0;
      const tx = 2 * (qy * z - qz * y);
      const ty = 2 * (qz * x - qx * z);
      const tz = 2 * (qx * y - qy * x);
      return this.set(
        x + qw * tx + (qy * tz - qz * ty),
        y + qw * ty + (qz * tx - qx * tz),
        z + qw * tz + (qx * ty - qy * tx),
      );
    };
  }
  if (typeof Vector3.prototype.min !== 'function') {
    Vector3.prototype.min = function (v: Vec3Like): Vec3Like {
      return this.set(
        Math.min(this.x, v.x),
        Math.min(this.y, v.y),
        Math.min(this.z, v.z),
      );
    };
  }
  if (typeof Vector3.prototype.max !== 'function') {
    Vector3.prototype.max = function (v: Vec3Like): Vec3Like {
      return this.set(
        Math.max(this.x, v.x),
        Math.max(this.y, v.y),
        Math.max(this.z, v.z),
      );
    };
  }
  if (typeof Vector3.prototype.clamp !== 'function') {
    Vector3.prototype.clamp = function (
      minVal: Vec3Like,
      maxVal: Vec3Like,
    ): Vec3Like {
      return this.set(
        Math.max(minVal.x, Math.min(maxVal.x, this.x)),
        Math.max(minVal.y, Math.min(maxVal.y, this.y)),
        Math.max(minVal.z, Math.min(maxVal.z, this.z)),
      );
    };
  }
  if (typeof Vector3.prototype.clampScalar !== 'function') {
    Vector3.prototype.clampScalar = function (
      minVal: number,
      maxVal: number,
    ): Vec3Like {
      return this.set(
        Math.max(minVal, Math.min(maxVal, this.x)),
        Math.max(minVal, Math.min(maxVal, this.y)),
        Math.max(minVal, Math.min(maxVal, this.z)),
      );
    };
  }
  if (typeof Vector3.prototype.negate !== 'function') {
    Vector3.prototype.negate = function (): Vec3Like {
      return this.multiplyScalar(-1);
    };
  }
  if (typeof Vector3.prototype.equals !== 'function') {
    Vector3.prototype.equals = function (v: Vec3Like): boolean {
      return Boolean(v) && v.x === this.x && v.y === this.y && v.z === this.z;
    };
  }

  if (Matrix4 && typeof Matrix4.prototype.getMaxScaleOnAxis !== 'function') {
    Matrix4.prototype.getMaxScaleOnAxis = function (): number {
      const e = this.elements;
      return Math.sqrt(
        Math.max(
          e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
          e[4] * e[4] + e[5] * e[5] + e[6] * e[6],
          e[8] * e[8] + e[9] * e[9] + e[10] * e[10],
        ),
      );
    };
  }

  // Ensure `THREE.MathUtils.seededRandom` (Mulberry32) is available even when
  // `installProceduralExtension` is attached onto an external/host `THREE`.
  if (threeNs.MathUtils && typeof threeNs.MathUtils === 'object') {
    let fallbackSeed = 1234567;
    try {
      if (typeof threeNs.MathUtils.seededRandom !== 'function') {
        threeNs.MathUtils.seededRandom = (s?: number): number => {
          if (s !== undefined) {
            fallbackSeed = Number.isFinite(s) ? s | 0 : 0;
          }
          let t = (fallbackSeed = (fallbackSeed + 0x6d2b79f5) | 0);
          t = Math.imul(t ^ (t >>> 15), t | 1);
          t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
      }
      if (typeof threeNs.MathUtils.randInt !== 'function') {
        threeNs.MathUtils.randInt = (low: number, high: number): number =>
          low + Math.floor(Math.random() * (high - low + 1));
      }
      if (typeof threeNs.MathUtils.randFloatSpread !== 'function') {
        threeNs.MathUtils.randFloatSpread = (range: number): number =>
          range * (0.5 - Math.random());
      }
    } catch {}
  }

  class Box3 {
    declare readonly isBox3: boolean;
    declare min: Vec3Like;
    declare max: Vec3Like;

    constructor(min?: Vec3Like, max?: Vec3Like) {
      this.isBox3 = true;
      this.min =
        min != null
          ? new Vector3(min.x, min.y, min.z)
          : new Vector3(Infinity, Infinity, Infinity);
      this.max =
        max != null
          ? new Vector3(max.x, max.y, max.z)
          : new Vector3(-Infinity, -Infinity, -Infinity);
    }

    set(min: Vec3Like, max: Vec3Like): this {
      this.min.copy(min);
      this.max.copy(max);
      return this;
    }

    makeEmpty(): this {
      this.min.set(Infinity, Infinity, Infinity);
      this.max.set(-Infinity, -Infinity, -Infinity);
      return this;
    }

    isEmpty(): boolean {
      return (
        this.max.x < this.min.x ||
        this.max.y < this.min.y ||
        this.max.z < this.min.z
      );
    }

    clone(): Box3 {
      return new Box3(this.min, this.max);
    }

    copy(box: {min: Vec3Like; max: Vec3Like}): this {
      if (!box) return this;
      this.min.copy(box.min);
      this.max.copy(box.max);
      return this;
    }

    expandByPoint(p: {x: number; y: number; z?: number}): this {
      if (!p) return this;
      const x = Number(p.x);
      const y = Number(p.y);
      const z = p.z === undefined ? 0 : Number(p.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return this;
      }
      if (x < this.min.x) this.min.x = x;
      if (y < this.min.y) this.min.y = y;
      if (z < this.min.z) this.min.z = z;
      if (x > this.max.x) this.max.x = x;
      if (y > this.max.y) this.max.y = y;
      if (z > this.max.z) this.max.z = z;
      return this;
    }

    expandByVector(v: Vec3Like): this {
      if (this.isEmpty() || !v) return this;
      const vx = Number(v.x);
      const vy = Number(v.y);
      const vz = Number(v.z);
      if (!Number.isFinite(vx) || !Number.isFinite(vy) || !Number.isFinite(vz)) {
        return this;
      }
      this.min.set(this.min.x - vx, this.min.y - vy, this.min.z - vz);
      this.max.set(this.max.x + vx, this.max.y + vy, this.max.z + vz);
      if (this.isEmpty()) this.makeEmpty();
      return this;
    }

    expandByScalar(s: number): this {
      const d = Number(s);
      if (this.isEmpty() || !Number.isFinite(d)) return this;
      this.min.set(this.min.x - d, this.min.y - d, this.min.z - d);
      this.max.set(this.max.x + d, this.max.y + d, this.max.z + d);
      if (this.isEmpty()) this.makeEmpty();
      return this;
    }

    setFromArray(array: ArrayLike<number>): this {
      this.makeEmpty();
      if (!array) return this;
      for (let i = 0, n = array.length - 2; i < n; i += 3) {
        this.expandByPoint({x: array[i], y: array[i + 1], z: array[i + 2]});
      }
      return this;
    }

    // tslint:disable-next-line:no-any Dynamic BufferAttribute instance.
    setFromBufferAttribute(attr: any): this {
      this.makeEmpty();
      if (!attr || typeof attr.count !== 'number') return this;
      for (let i = 0; i < attr.count; i++) {
        this.expandByPoint({
          x: attr.getX(i),
          y: attr.getY(i),
          z: attr.getZ(i),
        });
      }
      return this;
    }

    setFromPoints(pts: Array<{x: number; y: number; z?: number}>): this {
      this.makeEmpty();
      if (Array.isArray(pts)) {
        for (const p of pts) this.expandByPoint(p);
      }
      return this;
    }

    setFromCenterAndSize(center: Vec3Like, size: Vec3Like): this {
      if (!center || !size) return this;
      const hx = Math.abs(Number(size.x) || 0) * 0.5;
      const hy = Math.abs(Number(size.y) || 0) * 0.5;
      const hz = Math.abs(Number(size.z) || 0) * 0.5;
      const cx = Number(center.x) || 0;
      const cy = Number(center.y) || 0;
      const cz = Number(center.z) || 0;
      this.min.set(cx - hx, cy - hy, cz - hz);
      this.max.set(cx + hx, cy + hy, cz + hz);
      return this;
    }

    // tslint:disable-next-line:no-any Dynamic Object3D instance.
    setFromObject(object: any, precise?: boolean): this {
      return this.makeEmpty().expandByObject(object, Boolean(precise));
    }

    // tslint:disable-next-line:no-any Dynamic Object3D instance.
    expandByObject(objectIn: any, preciseIn?: boolean): this {
      expandBox3ByObject(this, objectIn, Boolean(preciseIn));
      return this;
    }

    getCenter(target: Vec3Like = new Vector3()): Vec3Like {
      return this.isEmpty()
        ? target.set(0, 0, 0)
        : target.addVectors(this.min, this.max).multiplyScalar(0.5);
    }

    getSize(target: Vec3Like = new Vector3()): Vec3Like {
      return this.isEmpty()
        ? target.set(0, 0, 0)
        : target.subVectors(this.max, this.min);
    }

    getParameter(point: Vec3Like, target: Vec3Like = new Vector3()): Vec3Like {
      const dx = this.max.x - this.min.x;
      const dy = this.max.y - this.min.y;
      const dz = this.max.z - this.min.z;
      return target.set(
        dx !== 0 ? (point.x - this.min.x) / dx : 0,
        dy !== 0 ? (point.y - this.min.y) / dy : 0,
        dz !== 0 ? (point.z - this.min.z) / dz : 0,
      );
    }

    containsPoint(p: Vec3Like): boolean {
      return (
        Boolean(p) &&
        !this.isEmpty() &&
        p.x >= this.min.x &&
        p.x <= this.max.x &&
        p.y >= this.min.y &&
        p.y <= this.max.y &&
        p.z >= this.min.z &&
        p.z <= this.max.z
      );
    }

    containsBox(box: Box3): boolean {
      return (
        Boolean(box) &&
        this.min.x <= box.min.x &&
        box.max.x <= this.max.x &&
        this.min.y <= box.min.y &&
        box.max.y <= this.max.y &&
        this.min.z <= box.min.z &&
        box.max.z <= this.max.z
      );
    }

    intersectsBox(box: Box3): boolean {
      return (
        Boolean(box) &&
        box.max.x >= this.min.x &&
        box.min.x <= this.max.x &&
        box.max.y >= this.min.y &&
        box.min.y <= this.max.y &&
        box.max.z >= this.min.z &&
        box.min.z <= this.max.z
      );
    }

    intersectsSphere(sphere: Sphere): boolean {
      if (!sphere || this.isEmpty() || sphere.isEmpty()) return false;
      const p = this.clampPoint(sphere.center, new Vector3());
      return (
        p.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius
      );
    }

    intersectsPlane(plane: {normal: Vec3Like; constant: number}): boolean {
      if (!plane?.normal || this.isEmpty()) return false;
      const nx = plane.normal.x;
      const ny = plane.normal.y;
      const nz = plane.normal.z;
      const c = Number(plane.constant) || 0;
      const minD =
        (nx > 0 ? nx * this.min.x : nx * this.max.x) +
        (ny > 0 ? ny * this.min.y : ny * this.max.y) +
        (nz > 0 ? nz * this.min.z : nz * this.max.z);
      const maxD =
        (nx > 0 ? nx * this.max.x : nx * this.min.x) +
        (ny > 0 ? ny * this.max.y : ny * this.min.y) +
        (nz > 0 ? nz * this.max.z : nz * this.min.z);
      return minD <= -c && maxD >= -c;
    }

    clampPoint(point: Vec3Like, target: Vec3Like = new Vector3()): Vec3Like {
      if (this.isEmpty()) return target.copy(point);
      return target.copy(point).clamp(this.min, this.max);
    }

    distanceToPoint(point: Vec3Like): number {
      return this.isEmpty()
        ? Infinity
        : this.clampPoint(point, new Vector3()).distanceTo(point);
    }

    getBoundingSphere(target: Sphere = new Sphere()): Sphere {
      if (this.isEmpty()) return target.makeEmpty();
      this.getCenter(target.center);
      target.radius = this.getSize(new Vector3()).length() * 0.5;
      return target;
    }

    intersect(box: Box3): this {
      if (!box) return this;
      this.min.max(box.min);
      this.max.min(box.max);
      if (this.isEmpty()) this.makeEmpty();
      return this;
    }

    union(box: Box3): this {
      if (!box || box.isEmpty()) return this;
      if (this.isEmpty()) return this.copy(box);
      this.min.min(box.min);
      this.max.max(box.max);
      return this;
    }

    // tslint:disable-next-line:no-any Dynamic Matrix4 instance.
    applyMatrix4(matrix: any): this {
      if (this.isEmpty() || !matrix) return this;
      const x0 = this.min.x;
      const y0 = this.min.y;
      const z0 = this.min.z;
      const x1 = this.max.x;
      const y1 = this.max.y;
      const z1 = this.max.z;
      const p = new Vector3();
      this.makeEmpty();
      for (let i = 0; i < 8; i++) {
        p.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).applyMatrix4(
          matrix,
        );
        this.expandByPoint(p);
      }
      return this;
    }

    translate(offset: Vec3Like): this {
      if (this.isEmpty() || !offset) return this;
      this.min.add(offset);
      this.max.add(offset);
      return this;
    }

    equals(box: Box3): boolean {
      return (
        Boolean(box) && box.min.equals(this.min) && box.max.equals(this.max)
      );
    }
  }

  // tslint:disable-next-line:no-any Dynamic Object3D instance.
  function expandBox3ByObject(targetBox: Box3, object: any, precise: boolean): void {
    if (!object) return;
    object.updateMatrixWorld?.(true);
    const v = new Vector3();
    const scratchBox = new Box3();
    const instMat = new Matrix4();
    const worldMat = new Matrix4();
    const seen = new Set<unknown>();

    // tslint:disable-next-line:no-any Dynamic BufferGeometry / Matrix4.
    const expandGeo = (geo: any, m: any) => {
      const pos = geo?.attributes?.position;
      if (!pos || !(pos.count > 0)) return;
      if (precise) {
        for (let i = 0; i < pos.count; i++) {
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
          targetBox.expandByPoint(v);
        }
      } else {
        const localBox = new Box3().setFromBufferAttribute(pos);
        if (!localBox.isEmpty()) {
          targetBox.union(scratchBox.copy(localBox).applyMatrix4(m));
        }
      }
    };

    // tslint:disable-next-line:no-any Dynamic Object3D hierarchy.
    const visit = (node: any) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      reg?.materializeDeclarativeGeometry?.(node);
      if (node.isBoxHelper && node !== object) return;
      if (node.isSprite || node.isBox3Helper) node._bakeAuthorGeometry?.();
      const geo = node._sourceGeo || node.geometry;
      if (geo && geo.attributes?.position && node.matrixWorld) {
        if (node.isInstancedMesh && typeof node.getMatrixAt === 'function') {
          const cap = Math.floor(
            (node.instanceMatrix?.array?.length ?? 0) / 16,
          );
          const n = Math.min(
            Math.max(0, Math.floor(Number(node.count) || 0)),
            cap,
          );
          for (let i = 0; i < n; i++) {
            node.getMatrixAt(i, instMat);
            worldMat.multiplyMatrices(node.matrixWorld, instMat);
            expandGeo(geo, worldMat);
          }
        } else {
          expandGeo(geo, node.matrixWorld);
        }
      }
      if (Array.isArray(node.children)) {
        for (const ch of node.children) visit(ch);
      }
    };

    visit(object);
  }

  class Sphere {
    declare readonly isSphere: boolean;
    declare center: Vec3Like;
    declare radius: number;

    constructor(center?: Vec3Like, radius = -1) {
      this.isSphere = true;
      this.center =
        center != null
          ? new Vector3(center.x, center.y, center.z)
          : new Vector3();
      const r = Number(radius);
      this.radius = Number.isFinite(r) ? r : -1;
    }

    set(center: Vec3Like, radius: number): this {
      if (center) this.center.copy(center);
      const r = Number(radius);
      this.radius = Number.isFinite(r) ? r : -1;
      return this;
    }

    setFromPoints(
      points: Array<{x: number; y: number; z?: number}>,
      optionalCenter?: Vec3Like,
    ): this {
      if (!Array.isArray(points) || points.length === 0) {
        return this.makeEmpty();
      }
      if (optionalCenter) {
        this.center.copy(optionalCenter);
      } else {
        const box = new Box3().setFromPoints(points);
        if (box.isEmpty()) return this.makeEmpty();
        box.getCenter(this.center);
      }
      let maxR2 = 0;
      let anyFinite = false;
      const v = new Vector3();
      for (const p of points) {
        const x = Number(p?.x);
        const y = Number(p?.y);
        const z = p?.z === undefined ? 0 : Number(p.z);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          anyFinite = true;
          maxR2 = Math.max(
            maxR2,
            this.center.distanceToSquared(v.set(x, y, z)),
          );
        }
      }
      if (!anyFinite) return this.makeEmpty();
      this.radius = Math.sqrt(maxR2);
      return this;
    }

    copy(sphere: Sphere): this {
      if (!sphere) return this;
      this.center.copy(sphere.center);
      this.radius = sphere.radius;
      return this;
    }

    clone(): Sphere {
      return new Sphere(this.center, this.radius);
    }

    isEmpty(): boolean {
      return !(this.radius >= 0) || !Number.isFinite(this.radius);
    }

    makeEmpty(): this {
      this.center.set(0, 0, 0);
      this.radius = -1;
      return this;
    }

    containsPoint(point: Vec3Like): boolean {
      return (
        Boolean(point) &&
        !this.isEmpty() &&
        point.distanceToSquared(this.center) <= this.radius * this.radius
      );
    }

    distanceToPoint(point: Vec3Like): number {
      return this.isEmpty()
        ? Infinity
        : point.distanceTo(this.center) - this.radius;
    }

    intersectsSphere(sphere: Sphere): boolean {
      if (!sphere || this.isEmpty() || sphere.isEmpty()) return false;
      const r = this.radius + sphere.radius;
      return sphere.center.distanceToSquared(this.center) <= r * r;
    }

    intersectsBox(box: Box3): boolean {
      return Boolean(box) && box.intersectsSphere(this);
    }

    intersectsPlane(plane: {normal: Vec3Like; constant: number}): boolean {
      if (!plane?.normal || this.isEmpty()) return false;
      const dist =
        plane.normal.dot(this.center) + (Number(plane.constant) || 0);
      return Math.abs(dist) <= this.radius;
    }

    clampPoint(point: Vec3Like, target: Vec3Like = new Vector3()): Vec3Like {
      target.copy(point);
      if (this.isEmpty()) return target;
      const d2 = this.center.distanceToSquared(point);
      if (d2 > this.radius * this.radius) {
        target
          .sub(this.center)
          .normalize()
          .multiplyScalar(this.radius)
          .add(this.center);
      }
      return target;
    }

    getBoundingBox(target: Box3 = new Box3()): Box3 {
      if (this.isEmpty()) return target.makeEmpty();
      target.set(this.center, this.center);
      target.expandByScalar(this.radius);
      return target;
    }

    // tslint:disable-next-line:no-any Dynamic Matrix4 instance.
    applyMatrix4(matrix: any): this {
      if (this.isEmpty() || !matrix) return this;
      const maxScale = matrix.getMaxScaleOnAxis();
      if (!Number.isFinite(maxScale)) return this.makeEmpty();
      this.center.applyMatrix4(matrix);
      this.radius *= maxScale;
      return this;
    }

    translate(offset: Vec3Like): this {
      if (!this.isEmpty() && offset) this.center.add(offset);
      return this;
    }

    expandByPoint(point: Vec3Like): this {
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        !Number.isFinite(point.z)
      ) {
        return this;
      }
      if (this.isEmpty()) {
        this.center.copy(point);
        this.radius = 0;
        return this;
      }
      const d2 = this.center.distanceToSquared(point);
      if (d2 > this.radius * this.radius) {
        const d = Math.sqrt(d2);
        const r = (this.radius + d) * 0.5;
        this.center.addScaledVector(
          new Vector3().subVectors(point, this.center),
          (d - this.radius) / (2 * d),
        );
        this.radius = r;
      }
      return this;
    }

    union(sphere: Sphere): this {
      if (!sphere || sphere.isEmpty()) return this;
      if (this.isEmpty()) return this.copy(sphere);
      if (this.center.equals(sphere.center)) {
        this.radius = Math.max(this.radius, sphere.radius);
        return this;
      }
      const dir = new Vector3().subVectors(sphere.center, this.center);
      const d = dir.length();
      if (d + sphere.radius <= this.radius) return this;
      if (d + this.radius <= sphere.radius) return this.copy(sphere);
      const r = (this.radius + d + sphere.radius) * 0.5;
      this.center.addScaledVector(dir, (r - this.radius) / d);
      this.radius = r;
      return this;
    }

    equals(sphere: Sphere): boolean {
      return (
        Boolean(sphere) &&
        sphere.center.equals(this.center) &&
        sphere.radius === this.radius
      );
    }
  }

  BufferGeometry.prototype.computeBoundingSphere = function (): Sphere {
    if (!this.boundingSphere || !this.boundingSphere.isSphere) {
      this.boundingSphere = new Sphere();
    }
    const pos = this.attributes?.position;
    if (!pos || !(pos.count > 0)) {
      return this.boundingSphere.makeEmpty();
    }
    const localBox = new Box3().setFromBufferAttribute(pos);
    if (localBox.isEmpty()) {
      return this.boundingSphere.makeEmpty();
    }
    const center = localBox.getCenter(this.boundingSphere.center);
    let maxR2 = 0;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        maxR2 = Math.max(maxR2, center.distanceToSquared(v.set(x, y, z)));
      }
    }
    this.boundingSphere.radius = Math.sqrt(maxR2);
    return this.boundingSphere;
  };

  BufferGeometry.prototype.computeBoundingBox = function (): Box3 {
    if (!this.boundingBox || !this.boundingBox.isBox3) {
      this.boundingBox = new Box3();
    }
    const pos = this.attributes?.position;
    if (pos && pos.count > 0) {
      this.boundingBox.setFromBufferAttribute(pos);
    } else {
      this.boundingBox.makeEmpty();
    }
    if (this.boundingSphere) {
      this.computeBoundingSphere();
    }
    return this.boundingBox;
  };

  // =========================================================================
  // Virtual 2D <canvas> + CanvasRenderingContext2D + THREE.CanvasTexture
  // =========================================================================

  const B64_CHARS =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const MAX_BACKING_DIM = 512;
  const MAX_CANVAS_PNG_DIM = 256;
  const MAX_TEXTURE_DIM = 2048;
  const MAX_PATH_POINTS = 16384;
  const MAX_STATE_STACK = 256;

  // Compact 95-glyph (ASCII 32..126) 5x7 font bitmap (5 column bytes per glyph,
  // bit 0 = top row 0 .. bit 6 = bottom row 6).
  const FONT_5X7_B64 =
    'AAAAAAAAAF8AAAAHAAcAFH8UfxQkKn8qEiMTCGRiNklVIlAABQMAAAAcIkEAAEEiHAAUCD4IFAgIPggIAFAwAAAICAgICABgYAAAIBAIBAI+UUlFPgBCf0AAQmFRSUYhQUVLMRgUEn8QJ0VFRTk8SklJMAFxCQUDNklJSTYGSUkpHgA2NgAAAFY2AAAIFCJBABQUFBQUAEEiFAgCAVEJBjJJeUE+fhEREX5/SUlJNj5BQUEif0FBIhx/SUlJQX8JCQkBPkFJSXp/CAgIfwBBf0EAIEBBPwF/CBQiQX9AQEBAfwIMAn9/BAgQfz5BQUE+fwkJCQY+QVEhXn8JGSlGRklJSTEBAX8BAT9AQEA/HyBAIB8/QDhAP2MUCBRjBwhwCAdhUUlFQwB/QUEAAgQIECAAQUF/AAQCAQIEQEBAQEAAAQIEACBUVFR4f0hERDg4REREIDhEREh/OFRUVBgIfgkBAgxSUlI+fwgEBHgARH1AACBARD0AfxAoRAAAQX9AAHwEGAR4fAgEBHg4REREOHwUFBQICBQUGHx8CAQECEhUVFQgBD9EQCA8QEAgfBwgQCAcPEAwQDxEKBAoRAxQUFA8RGRUTEQACDZBAAAAfwAAAEE2CAAIBAgQCA==';

  const b64Lut = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) {
    b64Lut[B64_CHARS.charCodeAt(i)] = i;
  }
  const fontBytes = (() => {
    const out = new Uint8Array(475);
    let buf = 0;
    let bits = 0;
    let p = 0;
    for (let i = 0; i < FONT_5X7_B64.length && p < 475; i++) {
      const code = FONT_5X7_B64.charCodeAt(i);
      if (code === 61) break;
      const v = code < 128 ? b64Lut[code] : -1;
      if (v < 0) continue;
      buf = (buf << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[p++] = (buf >> bits) & 0xff;
      }
    }
    return out;
  })();

  const crcTable = (() => {
    const tbl = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      tbl[n] = c >>> 0;
    }
    return tbl;
  })();

  const crc32Bytes = (bytes: Uint8Array): number => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };

  const srgbLut = (() => {
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const c = i / 255;
      lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    return lut;
  })();

  // tslint:disable-next-line:no-any Optional native Rust accelerator in Boa VM.
  const nativeEncodeRgbaPng: any =
    typeof globalThis !== 'undefined'
      ? (globalThis as Record<string, unknown>)['__three_live_native_encode_rgba_png__']
      : undefined;

  const NAMED_COLORS: Record<string, number> = {};
  for (const pair of (
    'black:000000,white:ffffff,red:ff0000,lime:00ff00,green:008000,blue:0000ff,' +
    'yellow:ffff00,cyan:00ffff,aqua:00ffff,magenta:ff00ff,fuchsia:ff00ff,' +
    'silver:c0c0c0,gray:808080,grey:808080,darkgray:a9a9a9,darkgrey:a9a9a9,' +
    'dimgray:696969,dimgrey:696969,lightgray:d3d3d3,lightgrey:d3d3d3,' +
    'slategray:708090,slategrey:708090,darkslategray:2f4f4f,darkslategrey:2f4f4f,' +
    'maroon:800000,olive:808000,purple:800080,teal:008080,navy:000080,' +
    'orange:ffa500,orangered:ff4500,gold:ffd700,coral:ff7f50,salmon:fa8072,' +
    'tomato:ff6347,crimson:dc143c,pink:ffc0cb,hotpink:ff69b4,deeppink:ff1493,' +
    'indigo:4b0082,violet:ee82ee,plum:dda0dd,orchid:da70d6,brown:a52a2a,' +
    'saddlebrown:8b4513,sienna:a0522d,chocolate:d2691e,peru:cd853f,tan:d2b48c,' +
    'wheat:f5deb3,beige:f5f5dc,ivory:fffff0,linen:faf0e6,snow:fffafa,khaki:f0e68c,' +
    'skyblue:87ceeb,deepskyblue:00bfff,dodgerblue:1e90ff,royalblue:4169e1,' +
    'steelblue:4682b4,turquoise:40e0d0,aquamarine:7fffd4,chartreuse:7fff00,' +
    'forestgreen:228b22,seagreen:2e8b57'
  ).split(',')) {
    const [k, hex] = pair.split(':');
    NAMED_COLORS[k] = parseInt(hex, 16);
  }

  type RgbaTuple = [number, number, number, number];

  const clampByte = (v: number): number =>
    v > 0 ? (v < 255 ? (v + 0.5) | 0 : 255) : 0;

  const parseCssChannel = (tok: string): number => {
    const s = tok.trim();
    if (s.endsWith('%')) {
      return clampByte((parseFloat(s) * 255) / 100);
    }
    return clampByte(parseFloat(s));
  };

  const parseCssAlpha = (tok: string | undefined): number => {
    if (!tok) return 255;
    const s = tok.trim();
    if (!s) return 255;
    const v = s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
    if (!Number.isFinite(v)) return 255;
    return clampByte(Math.max(0, Math.min(1, v)) * 255);
  };

  const parseCssColor = (
    input: unknown,
    fallback: RgbaTuple = [0, 0, 0, 255],
  ): RgbaTuple => {
    if (typeof input !== 'string') return fallback;
    const s = input.trim().toLowerCase();
    if (!s) return fallback;
    if (s === 'transparent') return [0, 0, 0, 0];
    if (s.charCodeAt(0) === 35) {
      const hex = s.slice(1);
      if (hex.length === 3 || hex.length === 4) {
        const r = parseInt(hex[0] + hex[0], 16);
        const g = parseInt(hex[1] + hex[1], 16);
        const b = parseInt(hex[2] + hex[2], 16);
        const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
        if (Number.isFinite(r + g + b + a)) return [r, g, b, a];
      } else if (hex.length === 6 || hex.length === 8) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
        if (Number.isFinite(r + g + b + a)) return [r, g, b, a];
      }
      return fallback;
    }
    const named = NAMED_COLORS[s];
    if (named !== undefined) {
      return [(named >> 16) & 255, (named >> 8) & 255, named & 255, 255];
    }
    const m = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(s);
    if (!m) return fallback;
    const fn = m[1];
    const parts = m[2]
      .replace(/\//g, ' ')
      .split(/[\s,]+/)
      .filter(Boolean);
    if (parts.length < 3) return fallback;
    if (fn.startsWith('rgb')) {
      return [
        parseCssChannel(parts[0]),
        parseCssChannel(parts[1]),
        parseCssChannel(parts[2]),
        parseCssAlpha(parts[3]),
      ];
    }
    // hsl / hsla
    let hRaw = parseFloat(parts[0]);
    if (!Number.isFinite(hRaw)) return fallback;
    if (parts[0].endsWith('turn')) hRaw *= 360;
    else if (parts[0].endsWith('rad')) hRaw = (hRaw * 180) / Math.PI;
    const h = (((hRaw % 360) + 360) % 360) / 360;
    const sat = Math.max(0, Math.min(1, (parseFloat(parts[1]) || 0) / 100));
    const lig = Math.max(0, Math.min(1, (parseFloat(parts[2]) || 0) / 100));
    const a = parseCssAlpha(parts[3]);
    if (sat === 0) {
      const gray = clampByte(lig * 255);
      return [gray, gray, gray, a];
    }
    const q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
    const p = 2 * lig - q;
    const hue2rgb = (tVal: number): number => {
      let t = tVal;
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [
      clampByte(hue2rgb(h + 1 / 3) * 255),
      clampByte(hue2rgb(h) * 255),
      clampByte(hue2rgb(h - 1 / 3) * 255),
      a,
    ];
  };

  /**
   * Encodes an RGBA8 buffer (`srcW x srcH`) into a multi-block stored-DEFLATE
   * `data:image/png;base64,...` URI (capped at `maxDim` with box-filter
   * downsampling when oversized) and computes linear `avgColor`.
   */
  const encodeRgbaToPngDataUri = (
    srcData: ArrayLike<number>,
    srcW: number,
    srcH: number,
    flipY: boolean,
    isLinearColorSpace: boolean,
    maxDim = MAX_CANVAS_PNG_DIM,
  ): {uri: string; avgColor: RgbaTuple} => {
    if (
      !srcData ||
      srcW <= 0 ||
      srcH <= 0 ||
      srcData.length < srcW * srcH * 4
    ) {
      return {uri: '', avgColor: [1, 1, 1, 1]};
    }
    if (typeof nativeEncodeRgbaPng === 'function') {
      const res = nativeEncodeRgbaPng(
        srcData,
        srcW,
        srcH,
        flipY,
        isLinearColorSpace,
        maxDim,
      );
      if (Array.isArray(res) && typeof res[0] === 'string') {
        return {uri: res[0], avgColor: [res[1], res[2], res[3], res[4]]};
      }
    }
    const scale =
      srcW > maxDim || srcH > maxDim ? maxDim / Math.max(srcW, srcH) : 1;
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));
    const stride = 1 + dstW * 4;
    const rawLen = dstH * stride;
    const numBlocks = Math.max(1, Math.ceil(rawLen / 65535));
    const idatLen = 2 + numBlocks * 5 + rawLen + 4;
    // 8 (PNG sig) + 25 (IHDR) + (12 + idatLen) (IDAT) + 12 (IEND)
    const png = new Uint8Array(57 + idatLen);
    const dv = new DataView(png.buffer);
    dv.setUint32(0, 0x89504e47);
    dv.setUint32(4, 0x0d0a1a0a);
    dv.setUint32(8, 13);
    dv.setUint32(12, 0x49484452); // IHDR
    dv.setUint32(16, dstW);
    dv.setUint32(20, dstH);
    png[24] = 8;
    png[25] = 6;
    dv.setUint32(29, crc32Bytes(png.subarray(12, 29)));

    dv.setUint32(33, idatLen);
    dv.setUint32(37, 0x49444154); // IDAT
    png[41] = 0x78;
    png[42] = 0x01;

    // Build raw scanlines first, then chunk into <=65535-byte stored DEFLATE blocks.
    const raw = new Uint8Array(rawLen);
    let rp = 0;
    let s1 = 1;
    let s2 = 0;
    let sumLinR = 0;
    let sumLinG = 0;
    let sumLinB = 0;
    let sumA = 0;
    const exact1to1 = dstW === srcW && dstH === srcH;

    for (let y = 0; y < dstH; y++) {
      raw[rp++] = 0;
      s2 = (s2 + s1) % 65521;
      const py = flipY ? dstH - 1 - y : y;
      const sy0 = exact1to1 ? py : Math.floor((py * srcH) / dstH);
      const sy1 = exact1to1
        ? py + 1
        : Math.max(sy0 + 1, Math.floor(((py + 1) * srcH) / dstH));
      for (let x = 0; x < dstW; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        if (exact1to1) {
          const idx = (sy0 * srcW + x) * 4;
          r = srcData[idx] | 0;
          g = srcData[idx + 1] | 0;
          b = srcData[idx + 2] | 0;
          a = srcData[idx + 3] | 0;
        } else {
          const sx0 = Math.floor((x * srcW) / dstW);
          const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * srcW) / dstW));
          let cnt = 0;
          for (let yy = sy0; yy < sy1 && yy < srcH; yy++) {
            for (let xx = sx0; xx < sx1 && xx < srcW; xx++) {
              const idx = (yy * srcW + xx) * 4;
              r += srcData[idx] | 0;
              g += srcData[idx + 1] | 0;
              b += srcData[idx + 2] | 0;
              a += srcData[idx + 3] | 0;
              cnt++;
            }
          }
          if (cnt > 1) {
            r = (r / cnt + 0.5) | 0;
            g = (g / cnt + 0.5) | 0;
            b = (b / cnt + 0.5) | 0;
            a = (a / cnt + 0.5) | 0;
          }
        }
        raw[rp++] = r;
        s1 += r;
        s2 += s1;
        raw[rp++] = g;
        s1 += g;
        s2 += s1;
        raw[rp++] = b;
        s1 += b;
        s2 += s1;
        raw[rp++] = a;
        s1 += a;
        s2 += s1;
        sumLinR += isLinearColorSpace ? r / 255 : srgbLut[r];
        sumLinG += isLinearColorSpace ? g / 255 : srgbLut[g];
        sumLinB += isLinearColorSpace ? b / 255 : srgbLut[b];
        sumA += a / 255;
      }
      s1 %= 65521;
      s2 %= 65521;
    }

    let wp = 43;
    let rem = rawLen;
    let roff = 0;
    while (rem > 0 || roff === 0) {
      const blkLen = Math.min(65535, rem);
      const isFinal = rem - blkLen === 0 ? 1 : 0;
      png[wp++] = isFinal;
      dv.setUint16(wp, blkLen, true);
      dv.setUint16(wp + 2, ~blkLen & 0xffff, true);
      wp += 4;
      if (blkLen > 0) {
        png.set(raw.subarray(roff, roff + blkLen), wp);
        wp += blkLen;
        roff += blkLen;
        rem -= blkLen;
      }
      if (isFinal) break;
    }
    dv.setUint32(wp, ((s2 << 16) | s1) >>> 0);
    wp += 4;
    dv.setUint32(wp, crc32Bytes(png.subarray(37, wp)));
    wp += 4;
    dv.setUint32(wp, 0);
    dv.setUint32(wp + 4, 0x49454e44); // IEND
    dv.setUint32(wp + 8, 0xae426082);

    const nPx = Math.max(1, dstW * dstH);
    const avgColor: RgbaTuple = [
      sumLinR / nPx,
      sumLinG / nPx,
      sumLinB / nPx,
      sumA / nPx,
    ];
    const parts: string[] = ['data:image/png;base64,'];
    for (let i = 0; i < png.length; i += 3) {
      const n = (png[i] << 16) | ((png[i + 1] ?? 0) << 8) | (png[i + 2] ?? 0);
      parts.push(
        B64_CHARS[(n >> 18) & 63] +
          B64_CHARS[(n >> 12) & 63] +
          (i + 1 < png.length ? B64_CHARS[(n >> 6) & 63] : '=') +
          (i + 2 < png.length ? B64_CHARS[n & 63] : '='),
      );
    }
    return {uri: parts.join(''), avgColor};
  };

  const packRgba = (r: number, g: number, b: number, a: number): number =>
    ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;

  const getGradLut = (g: VirtualCanvasGradient): Uint32Array => {
    if (g._lut) return g._lut;
    const lut = new Uint32Array(256);
    const stops = g.s;
    if (stops.length === 1) {
      const c = stops[0].c;
      lut.fill(packRgba(c[0], c[1], c[2], c[3]));
    } else if (stops.length > 1) {
      let si = 0;
      for (let i = 0; i < 256; i++) {
        const t = i / 255;
        if (t <= stops[0].o) {
          const c = stops[0].c;
          lut[i] = packRgba(c[0], c[1], c[2], c[3]);
        } else if (t >= stops[stops.length - 1].o) {
          const c = stops[stops.length - 1].c;
          lut[i] = packRgba(c[0], c[1], c[2], c[3]);
        } else {
          while (si < stops.length - 2 && t > stops[si + 1].o) si++;
          const s0 = stops[si];
          const s1 = stops[si + 1];
          const span = s1.o - s0.o;
          const u = span > 1e-9 ? (t - s0.o) / span : 0;
          lut[i] = packRgba(
            (s0.c[0] + (s1.c[0] - s0.c[0]) * u + 0.5) | 0,
            (s0.c[1] + (s1.c[1] - s0.c[1]) * u + 0.5) | 0,
            (s0.c[2] + (s1.c[2] - s0.c[2]) * u + 0.5) | 0,
            (s0.c[3] + (s1.c[3] - s0.c[3]) * u + 0.5) | 0,
          );
        }
      }
    }
    g._lut = lut;
    return lut;
  };

  const sampleGradientPacked = (
    g: VirtualCanvasGradient,
    x: number,
    y: number,
  ): number => {
    if (g.s.length === 0) return 0;
    const lut = getGradLut(g);
    let t = 0;
    if (!g.rad) {
      const dx = g.x1 - g.x0;
      const dy = g.y1 - g.y0;
      const len2 = dx * dx + dy * dy;
      if (len2 <= 1e-12) return lut[255];
      t = ((x - g.x0) * dx + (y - g.y0) * dy) / len2;
    } else {
      const dx = g.x1 - g.x0;
      const dy = g.y1 - g.y0;
      const dr = g.r1 - g.r0;
      const fx = x - g.x0;
      const fy = y - g.y0;
      const a = dx * dx + dy * dy - dr * dr;
      const b = -2 * (fx * dx + fy * dy + g.r0 * dr);
      const c = fx * fx + fy * fy - g.r0 * g.r0;
      if (Math.abs(a) < 1e-9) {
        t = Math.abs(b) > 1e-9 ? -c / b : 0;
      } else {
        const sd = Math.sqrt(Math.max(0, b * b - 4 * a * c));
        const t1 = (-b + sd) / (2 * a);
        const t2 = (-b - sd) / (2 * a);
        t =
          g.r0 + t1 * dr >= 0
            ? t1
            : g.r0 + t2 * dr >= 0
              ? t2
              : Math.max(t1, t2);
      }
    }
    const idx = t <= 0 ? 0 : t >= 1 ? 255 : (t * 255 + 0.5) | 0;
    return lut[idx];
  };

  class VirtualCanvasGradient {
    declare readonly _g: number;
    declare readonly rad: boolean;
    declare readonly x0: number;
    declare readonly y0: number;
    declare readonly r0: number;
    declare readonly x1: number;
    declare readonly y1: number;
    declare readonly r1: number;
    declare readonly s: Array<{o: number; c: RgbaTuple; i: number}>;
    declare _lut: Uint32Array | null;

    constructor(
      radial: boolean,
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number,
    ) {
      this._g = 1;
      this.rad = radial;
      this.x0 = Number(x0) || 0;
      this.y0 = Number(y0) || 0;
      this.r0 = Math.max(0, Number(r0) || 0);
      this.x1 = Number(x1) || 0;
      this.y1 = Number(y1) || 0;
      this.r1 = Math.max(0, Number(r1) || 0);
      this.s = [];
      this._lut = null;
    }

    addColorStop(offset: number, color: string): void {
      const o = Math.max(0, Math.min(1, Number(offset) || 0));
      this.s.push({o, c: parseCssColor(color, [0, 0, 0, 255]), i: this.s.length});
      this.s.sort((a, b) => a.o - b.o || a.i - b.i);
      this._lut = null;
    }
  }

  class VirtualCanvasPattern {
    declare readonly _g: number;
    declare readonly d: Uint8ClampedArray;
    declare readonly w: number;
    declare readonly h: number;
    declare readonly rx: boolean;
    declare readonly ry: boolean;

    constructor(
      data: Uint8ClampedArray,
      w: number,
      h: number,
      repetition: string,
    ) {
      this._g = 2;
      this.d = data;
      this.w = Math.max(1, w | 0);
      this.h = Math.max(1, h | 0);
      const rep = (repetition || 'repeat').toLowerCase();
      this.rx = rep === 'repeat' || rep === 'repeat-x';
      this.ry = rep === 'repeat' || rep === 'repeat-y';
    }
  }

  const samplePatternPacked = (
    p: VirtualCanvasPattern,
    x: number,
    y: number,
  ): number => {
    let ix = Math.floor(x);
    let iy = Math.floor(y);
    if (p.rx) ix = ((ix % p.w) + p.w) % p.w;
    else if (ix < 0 || ix >= p.w) return 0;
    if (p.ry) iy = ((iy % p.h) + p.h) % p.h;
    else if (iy < 0 || iy >= p.h) return 0;
    const o = (iy * p.w + ix) * 4;
    return packRgba(p.d[o], p.d[o + 1], p.d[o + 2], p.d[o + 3]);
  };

  type FillStrokeStyle = string | VirtualCanvasGradient | VirtualCanvasPattern;
  type StateTuple = [
    number[],
    FillStrokeStyle,
    FillStrokeStyle,
    number,
    string,
    number,
    string,
    string,
    number[],
    number,
    string,
    string,
    string,
    string,
    number,
    number,
    number,
    Uint8Array | null,
  ];

  interface SubPath {
    pts: Array<[number, number]>;
    closed: boolean;
  }

  const mapUnicodeAscii = (cp: number): number => {
    if (cp >= 32 && cp <= 126) return cp;
    if (cp === 0x00b0) return 39;
    if (cp === 0x2022 || cp === 0x00b7) return 42;
    if (cp === 0x2013 || cp === 0x2014 || cp === 0x2212) return 45;
    if (cp === 0x00d7) return 120;
    if (cp === 0x2018 || cp === 0x2019) return 39;
    if (cp === 0x201c || cp === 0x201d) return 34;
    return 63;
  };

  const glyphMaskCache: Array<Uint8Array | undefined> = new Array(190);

  const buildGlyphMask10x14 = (ascii: number, bold: boolean): Uint8Array => {
    const cacheIdx = (ascii - 32) * 2 + (bold ? 1 : 0);
    const cached = glyphMaskCache[cacheIdx];
    if (cached) return cached;
    const g5 = new Uint8Array(63);
    const off = (ascii - 32) * 5;
    for (let c = 0; c < 5; c++) {
      const col = fontBytes[off + c] ?? 0;
      for (let r = 0; r < 7; r++) {
        if ((col >> r) & 1) g5[(r + 1) * 7 + (c + 1)] = 1;
      }
    }
    const out = new Uint8Array(140);
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        const idx = (r + 1) * 7 + (c + 1);
        const p = g5[idx];
        const a = g5[idx - 7];
        const b = g5[idx + 1];
        const cc = g5[idx - 1];
        const d = g5[idx + 7];
        const oy = r * 2;
        const ox = c * 2;
        out[oy * 10 + ox] = cc === a && cc !== d && a !== b ? a : p;
        out[oy * 10 + ox + 1] = a === b && a !== cc && b !== d ? b : p;
        out[(oy + 1) * 10 + ox] = d === cc && d !== b && cc !== a ? cc : p;
        out[(oy + 1) * 10 + ox + 1] = b === d && b !== a && d !== cc ? d : p;
      }
    }
    if (bold) {
      for (let y = 0; y < 14; y++) {
        for (let x = 9; x >= 1; x--) {
          if (out[y * 10 + x - 1]) out[y * 10 + x] = 1;
        }
      }
    }
    glyphMaskCache[cacheIdx] = out;
    return out;
  };

  const parseFontSpec = (
    fontStr: string,
  ): {sizePx: number; bold: boolean} => {
    const s = String(fontStr || '10px sans-serif');
    const bold = /\b(bold|bolder|[6-9]00)\b/i.test(s);
    const m = /(\d+(?:\.\d+)?)\s*(px|pt|em|rem)\b/i.exec(s);
    if (!m) return {sizePx: 10, bold};
    let px = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    if (unit === 'pt') px *= 4 / 3;
    else if (unit === 'em' || unit === 'rem') px *= 16;
    return {
      sizePx: Number.isFinite(px) && px > 0 ? Math.min(1024, px) : 10,
      bold,
    };
  };

  const resetCtx = (ctx: VirtualCanvasContext2D): void => {
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = '#000000';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.lineDashOffset = 0;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 0, 0, 0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx._m = [1, 0, 0, 1, 0, 0];
    ctx._dash = [];
    ctx._clip = null;
    ctx._stack = [];
    ctx._subs = [];
    ctx._cur = null;
    ctx._pts = 0;
  };

  const toBuf = (
    ctx: VirtualCanvasContext2D,
    x: number,
    y: number,
  ): [number, number] => {
    const m = ctx._m;
    return [
      (m[0] * x + m[2] * y + m[4]) * ctx.canvas._sx,
      (m[1] * x + m[3] * y + m[5]) * ctx.canvas._sy,
    ];
  };

  const invTransform = (
    ctx: VirtualCanvasContext2D,
  ): [number, number, number, number, number, number] => {
    const invSx = ctx.canvas._sx > 0 ? 1 / ctx.canvas._sx : 1;
    const invSy = ctx.canvas._sy > 0 ? 1 / ctx.canvas._sy : 1;
    const m = ctx._m;
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return [0, 0, 0, 0, 0, 0];
    const invDet = 1 / det;
    return [
      m[3] * invSx * invDet,
      -m[2] * invSy * invDet,
      (-m[3] * m[4] + m[2] * m[5]) * invDet,
      -m[1] * invSx * invDet,
      m[0] * invSy * invDet,
      (m[1] * m[4] - m[0] * m[5]) * invDet,
    ];
  };

  const fromBuf = (
    ctx: VirtualCanvasContext2D,
    bx: number,
    by: number,
  ): [number, number] => {
    const [ixx, ixy, ix0, iyx, iyy, iy0] = invTransform(ctx);
    return [ixx * bx + ixy * by + ix0, iyx * bx + iyy * by + iy0];
  };

  const resolveOp = (ctx: VirtualCanvasContext2D): number => {
    const op = String(ctx.globalCompositeOperation || 'source-over').toLowerCase();
    if (op === 'source-over') return 0;
    if (op === 'copy') return 1;
    if (op === 'destination-out') return 2;
    if (op === 'lighter' || op === 'add') return 3;
    if (op === 'multiply') return 4;
    if (op === 'screen') return 5;
    return 0;
  };

  const pushPt = (
    ctx: VirtualCanvasContext2D,
    bx: number,
    by: number,
  ): void => {
    if (ctx._pts >= MAX_PATH_POINTS || !ctx._cur) return;
    ctx._cur.pts.push([bx, by]);
    ctx._pts++;
  };

  const makeShader = (
    ctx: VirtualCanvasContext2D,
    style: FillStrokeStyle,
  ): ((bx: number, by: number) => number) => {
    const rawGa = Number(ctx.globalAlpha);
    const ga = Number.isFinite(rawGa) ? Math.max(0, Math.min(1, rawGa)) : 1;
    const ga256 = Math.round(ga * 256);
    if (typeof style === 'string') {
      const c = parseCssColor(style, [0, 0, 0, 255]);
      const solid = packRgba(c[0], c[1], c[2], (c[3] * ga256 + 128) >> 8);
      return () => solid;
    }
    const tag = style ? (style as VirtualCanvasGradient)._g : 0;
    if (tag === 1 || tag === 2) {
      const [ixx, ixy, ix0, iyx, iyy, iy0] = invTransform(ctx);
      return (bx: number, by: number): number => {
        const ux = ixx * bx + ixy * by + ix0;
        const uy = iyx * bx + iyy * by + iy0;
        const p =
          tag === 1
            ? sampleGradientPacked(style as VirtualCanvasGradient, ux, uy)
            : samplePatternPacked(style as VirtualCanvasPattern, ux, uy);
        if (ga256 >= 256) return p;
        const a = (((p >>> 24) * ga256 + 128) >> 8) & 255;
        return ((p & 0x00ffffff) | (a << 24)) >>> 0;
      };
    }
    const def = packRgba(0, 0, 0, (255 * ga256 + 128) >> 8);
    return () => def;
  };

  const blendPx = (
    ctx: VirtualCanvasContext2D,
    op: number,
    px: number,
    py: number,
    rgba32: number,
  ): void => {
    const bw = ctx.canvas._bw;
    const bh = ctx.canvas._bh;
    if (px < 0 || px >= bw || py < 0 || py >= bh) return;
    const pIdx = py * bw + px;
    if (ctx._clip && !ctx._clip[pIdx]) return;
    const data = ctx.canvas._data;
    const o = pIdx * 4;
    const sr0 = rgba32 & 255;
    const sg0 = (rgba32 >>> 8) & 255;
    const sb0 = (rgba32 >>> 16) & 255;
    const sa = rgba32 >>> 24;
    if (op === 1) {
      data[o] = sr0;
      data[o + 1] = sg0;
      data[o + 2] = sb0;
      data[o + 3] = sa;
      return;
    }
    if (sa <= 0) return;
    if (sa >= 255 && op === 0) {
      data[o] = sr0;
      data[o + 1] = sg0;
      data[o + 2] = sb0;
      data[o + 3] = 255;
      return;
    }
    if (op === 2) {
      data[o + 3] = ((data[o + 3] * (255 - sa) + 127) / 255) | 0;
      if (data[o + 3] === 0) data[o] = data[o + 1] = data[o + 2] = 0;
      return;
    }
    if (op === 3) {
      data[o] = Math.min(255, data[o] + (((sr0 * sa + 127) / 255) | 0));
      data[o + 1] = Math.min(255, data[o + 1] + (((sg0 * sa + 127) / 255) | 0));
      data[o + 2] = Math.min(255, data[o + 2] + (((sb0 * sa + 127) / 255) | 0));
      data[o + 3] = Math.min(255, data[o + 3] + sa);
      return;
    }
    const da = data[o + 3];
    const sA = sa / 255;
    const dA = da / 255;
    const outA = sA + dA * (1 - sA);
    if (outA <= 1e-6) {
      data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
      return;
    }
    let sr = sr0;
    let sg = sg0;
    let sb = sb0;
    if (op === 4 && da > 0) {
      sr = (sr * data[o] + 127) / 255;
      sg = (sg * data[o + 1] + 127) / 255;
      sb = (sb * data[o + 2] + 127) / 255;
    } else if (op === 5 && da > 0) {
      sr = 255 - ((255 - sr) * (255 - data[o])) / 255;
      sg = 255 - ((255 - sg) * (255 - data[o + 1])) / 255;
      sb = 255 - ((255 - sb) * (255 - data[o + 2])) / 255;
    }
    data[o] = clampByte((sr * sA + data[o] * dA * (1 - sA)) / outA);
    data[o + 1] = clampByte((sg * sA + data[o + 1] * dA * (1 - sA)) / outA);
    data[o + 2] = clampByte((sb * sA + data[o + 2] * dA * (1 - sA)) / outA);
    data[o + 3] = clampByte(outA * 255);
  };

  const scanlineSubpaths = (
    ctx: VirtualCanvasContext2D,
    subs: SubPath[],
    fillRule: string,
    onPixel: (px: number, py: number) => void,
  ): void => {
    if (ctx.canvas.width <= 0 || ctx.canvas.height <= 0) return;
    const bw = ctx.canvas._bw;
    const bh = ctx.canvas._bh;
    const edges: Array<[number, number, number, number, number]> = [];
    let minY = bh;
    let maxY = -1;
    for (const sp of subs) {
      const pts = sp.pts;
      const n = pts.length;
      if (n < 2) continue;
      for (let i = 0; i < n; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[(i + 1) % n];
        if (y0 === y1) continue;
        const ey0 = Math.min(y0, y1);
        const ey1 = Math.max(y0, y1);
        edges.push([
          ey0,
          ey1,
          y1 > y0 ? x0 : x1,
          (y1 > y0 ? x1 - x0 : x0 - x1) / (ey1 - ey0),
          y1 > y0 ? 1 : -1,
        ]);
        if (ey0 < minY) minY = ey0;
        if (ey1 > maxY) maxY = ey1;
      }
    }
    if (edges.length === 0) return;
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(bh - 1, Math.ceil(maxY));
    const isEvenOdd = fillRule === 'evenodd';
    const emitSpan = (py: number, x0: number, x1: number): void => {
      for (let px = x0; px <= x1; px++) onPixel(px, py);
    };
    const crossings: Array<[number, number]> = [];
    for (let py = yStart; py <= yEnd; py++) {
      const sy = py + 0.5;
      crossings.length = 0;
      for (let e = 0; e < edges.length; e++) {
        const ed = edges[e];
        if (ed[0] <= sy && ed[1] > sy) {
          crossings.push([ed[2] + (sy - ed[0]) * ed[3], ed[4]]);
        }
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a[0] - b[0]);
      if (isEvenOdd) {
        for (let i = 0; i + 1 < crossings.length; i += 2) {
          emitSpan(
            py,
            Math.max(0, Math.ceil(crossings[i][0] - 0.5)),
            Math.min(bw - 1, Math.floor(crossings[i + 1][0] - 0.5)),
          );
        }
      } else {
        let w = 0;
        let spanStart = 0;
        for (let i = 0; i < crossings.length; i++) {
          const prevW = w;
          w += crossings[i][1];
          if (prevW === 0 && w !== 0) {
            spanStart = crossings[i][0];
          } else if (prevW !== 0 && w === 0) {
            emitSpan(
              py,
              Math.max(0, Math.ceil(spanStart - 0.5)),
              Math.min(bw - 1, Math.floor(crossings[i][0] - 0.5)),
            );
          }
        }
      }
    }
  };

  const drawTextImpl = (
    ctx: VirtualCanvasContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number | undefined,
    isStroke: boolean,
  ): void => {
    if (
      !Number.isFinite(x + y) ||
      ctx.canvas.width <= 0 ||
      ctx.canvas.height <= 0
    ) {
      return;
    }
    const str = String(text ?? '').slice(0, 1024);
    if (!str) return;
    const chars = Array.from(str);
    const {sizePx, bold} = parseFontSpec(ctx.font);
    const cellH = sizePx;
    const cellW = sizePx * (bold ? 0.54 : 0.5);
    const advance = sizePx * (bold ? 0.64 : 0.6);
    const rawW = chars.length * advance - sizePx * 0.1;
    let squeezeX = 1;
    if (maxWidth !== undefined && Number.isFinite(maxWidth)) {
      if (maxWidth <= 0) return;
      if (rawW > maxWidth && rawW > 0) squeezeX = maxWidth / rawW;
    }
    const totalW = rawW * squeezeX;
    let startX = x;
    if (ctx.textAlign === 'center') startX -= totalW * 0.5;
    else if (ctx.textAlign === 'right' || ctx.textAlign === 'end') startX -= totalW;

    let topY = y;
    const base = ctx.textBaseline;
    if (base === 'middle') topY -= cellH * 0.5;
    else if (base === 'bottom' || base === 'ideographic') topY -= cellH;
    else if (base === 'alphabetic') topY -= cellH * 0.82;
    else if (base === 'hanging') topY -= cellH * 0.08;

    const shader = makeShader(ctx, isStroke ? ctx.strokeStyle : ctx.fillStyle);
    const op = resolveOp(ctx);
    const [ixx, ixy, ix0, iyx, iyy, iy0] = invTransform(ctx);
    const bw = ctx.canvas._bw;
    const bh = ctx.canvas._bh;
    const stamp = new Uint8Array(bw * bh);
    const gw = cellW * squeezeX;
    if (gw <= 1e-6 || cellH <= 1e-6) return;
    const invGw = 1 / gw;
    const invCellH = 1 / cellH;

    for (let ci = 0; ci < chars.length; ci++) {
      const ascii = mapUnicodeAscii(chars[ci].codePointAt(0) ?? 32);
      if (ascii === 32) continue;
      const gx0 = startX + ci * advance * squeezeX;
      const mask = buildGlyphMask10x14(ascii, bold);
      const c0 = toBuf(ctx, gx0, topY);
      const c1 = toBuf(ctx, gx0 + gw, topY);
      const c2 = toBuf(ctx, gx0 + gw, topY + cellH);
      const c3 = toBuf(ctx, gx0, topY + cellH);
      const minX = Math.max(0, Math.floor(Math.min(c0[0], c1[0], c2[0], c3[0])));
      const maxX = Math.min(bw - 1, Math.ceil(Math.max(c0[0], c1[0], c2[0], c3[0])));
      const minY = Math.max(0, Math.floor(Math.min(c0[1], c1[1], c2[1], c3[1])));
      const maxY = Math.min(bh - 1, Math.ceil(Math.max(c0[1], c1[1], c2[1], c3[1])));
      for (let py = minY; py <= maxY; py++) {
        const cy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const pIdx = py * bw + px;
          if (stamp[pIdx]) continue;
          const cx = px + 0.5;
          const ux = ixx * cx + ixy * cy + ix0;
          const uy = iyx * cx + iyy * cy + iy0;
          const u = (ux - gx0) * invGw;
          const v = (uy - topY) * invCellH;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
          const mx = Math.min(9, (u * 10) | 0);
          const my = Math.min(13, (v * 14) | 0);
          if (mask[my * 10 + mx] !== 1) continue;
          if (
            isStroke &&
            mx > 0 &&
            mx < 9 &&
            my > 0 &&
            my < 13 &&
            mask[my * 10 + mx - 1] &&
            mask[my * 10 + mx + 1] &&
            mask[(my - 1) * 10 + mx] &&
            mask[(my + 1) * 10 + mx]
          ) {
            continue;
          }
          stamp[pIdx] = 1;
          blendPx(ctx, op, px, py, shader(cx, cy));
        }
      }
    }
    ctx.canvas._ver++;
  };

  class VirtualCanvasContext2D {
    // tslint:disable-next-line:no-any Forward reference to VirtualCanvas.
    declare readonly canvas: any;
    declare fillStyle: FillStrokeStyle;
    declare strokeStyle: FillStrokeStyle;
    declare globalAlpha: number;
    declare globalCompositeOperation: string;
    declare lineWidth: number;
    declare lineCap: string;
    declare lineJoin: string;
    declare lineDashOffset: number;
    declare font: string;
    declare textAlign: string;
    declare textBaseline: string;
    declare shadowColor: string;
    declare shadowBlur: number;
    declare shadowOffsetX: number;
    declare shadowOffsetY: number;
    declare _m: number[];
    declare _dash: number[];
    declare _clip: Uint8Array | null;
    declare _stack: StateTuple[];
    declare _subs: SubPath[];
    declare _cur: SubPath | null;
    declare _pts: number;

    // tslint:disable-next-line:no-any Forward reference to VirtualCanvas.
    constructor(canvas: any) {
      this.canvas = canvas;
      resetCtx(this);
    }

    save(): void {
      if (this._stack.length >= MAX_STATE_STACK) return;
      this._stack.push([
        this._m.slice(),
        this.fillStyle,
        this.strokeStyle,
        this.globalAlpha,
        this.globalCompositeOperation,
        this.lineWidth,
        this.lineCap,
        this.lineJoin,
        this._dash.slice(),
        this.lineDashOffset,
        this.font,
        this.textAlign,
        this.textBaseline,
        this.shadowColor,
        this.shadowBlur,
        this.shadowOffsetX,
        this.shadowOffsetY,
        this._clip ? new Uint8Array(this._clip) : null,
      ]);
    }

    restore(): void {
      const s = this._stack.pop();
      if (!s) return;
      [
        this._m,
        this.fillStyle,
        this.strokeStyle,
        this.globalAlpha,
        this.globalCompositeOperation,
        this.lineWidth,
        this.lineCap,
        this.lineJoin,
        this._dash,
        this.lineDashOffset,
        this.font,
        this.textAlign,
        this.textBaseline,
        this.shadowColor,
        this.shadowBlur,
        this.shadowOffsetX,
        this.shadowOffsetY,
        this._clip,
      ] = s;
    }

    setLineDash(segments: number[]): void {
      if (!Array.isArray(segments)) return;
      const clean: number[] = [];
      for (let i = 0; i < Math.min(64, segments.length); i++) {
        const v = Number(segments[i]);
        if (!Number.isFinite(v) || v < 0) return;
        clean.push(v);
      }
      this._dash = clean.length % 2 === 1 ? [...clean, ...clean] : clean;
    }

    getLineDash(): number[] {
      return [...this._dash];
    }

    resetTransform(): void {
      this._m = [1, 0, 0, 1, 0, 0];
    }

    // tslint:disable-next-line:no-any Accepts DOMMatrix-like object or 6 numbers.
    setTransform(a?: any, b?: number, c?: number, d?: number, e?: number, f?: number): void {
      if (a && typeof a === 'object') {
        this.setTransform(a.a ?? 1, a.b ?? 0, a.c ?? 0, a.d ?? 1, a.e ?? 0, a.f ?? 0);
        return;
      }
      const na = Number(a ?? 1);
      const nb = Number(b ?? 0);
      const nc = Number(c ?? 0);
      const nd = Number(d ?? 1);
      const ne = Number(e ?? 0);
      const nf = Number(f ?? 0);
      if (Number.isFinite(na + nb + nc + nd + ne + nf)) {
        this._m = [na, nb, nc, nd, ne, nf];
      }
    }

    getTransform(): {a: number; b: number; c: number; d: number; e: number; f: number} {
      const m = this._m;
      return {a: m[0], b: m[1], c: m[2], d: m[3], e: m[4], f: m[5]};
    }

    transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
      if (!Number.isFinite(a + b + c + d + e + f)) return;
      const m = this._m;
      this._m = [
        m[0] * a + m[2] * b,
        m[1] * a + m[3] * b,
        m[0] * c + m[2] * d,
        m[1] * c + m[3] * d,
        m[0] * e + m[2] * f + m[4],
        m[1] * e + m[3] * f + m[5],
      ];
    }

    translate(x: number, y: number): void {
      this.transform(1, 0, 0, 1, x, y);
    }

    rotate(angle: number): void {
      if (!Number.isFinite(angle)) return;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      this.transform(c, s, -s, c, 0, 0);
    }

    scale(x: number, y: number): void {
      this.transform(x, 0, 0, y, 0, 0);
    }

    createLinearGradient(x0: number, y0: number, x1: number, y1: number): VirtualCanvasGradient {
      return new VirtualCanvasGradient(false, x0, y0, 0, x1, y1, 0);
    }

    createRadialGradient(
      x0: number,
      y0: number,
      r0: number,
      x1: number,
      y1: number,
      r1: number,
    ): VirtualCanvasGradient {
      return new VirtualCanvasGradient(true, x0, y0, r0, x1, y1, r1);
    }

    // tslint:disable-next-line:no-any Accepts VirtualCanvas, ImageData, or Texture-like object.
    createPattern(image: any, repetition = 'repeat'): VirtualCanvasPattern | null {
      const ex = extractPixelsFromSource(image);
      return ex
        ? new VirtualCanvasPattern(ex.data, ex.width, ex.height, repetition)
        : null;
    }

    beginPath(): void {
      this._subs.length = 0;
      this._cur = null;
      this._pts = 0;
    }

    closePath(): void {
      if (this._cur && this._cur.pts.length > 0) {
        this._cur.closed = true;
        const first = this._cur.pts[0];
        this._cur = {pts: [[first[0], first[1]]], closed: false};
        this._subs.push(this._cur);
      }
    }

    moveTo(x: number, y: number): void {
      if (!Number.isFinite(x + y)) return;
      this._cur = {pts: [toBuf(this, x, y)], closed: false};
      this._subs.push(this._cur);
      this._pts++;
    }

    lineTo(x: number, y: number): void {
      if (!Number.isFinite(x + y)) return;
      if (!this._cur || this._cur.pts.length === 0) {
        this.moveTo(x, y);
        return;
      }
      const p = toBuf(this, x, y);
      pushPt(this, p[0], p[1]);
    }

    rect(x: number, y: number, w: number, h: number): void {
      if (!Number.isFinite(x + y + w + h)) return;
      this.moveTo(x, y);
      this.lineTo(x + w, y);
      this.lineTo(x + w, y + h);
      this.lineTo(x, y + h);
      this.closePath();
    }

    // tslint:disable-next-line:no-any Radii may be number, DOMPointInit, or array.
    roundRect(x: number, y: number, w: number, h: number, radii?: any): void {
      if (!Number.isFinite(x + y + w + h)) return;
      if (w < 0) {
        x += w;
        w = -w;
      }
      if (h < 0) {
        y += h;
        h = -h;
      }
      const list = Array.isArray(radii) ? radii : radii !== undefined ? [radii] : [0];
      const readR = (v: unknown): number => {
        const raw =
          v && typeof v === 'object'
            ? Number((v as {x?: unknown}).x ?? 0)
            : Number(v ?? 0);
        return Number.isFinite(raw) ? Math.max(0, raw) : 0;
      };
      let tl = readR(list[0]);
      let tr = readR(list[1] ?? list[0]);
      let br = readR(list[2] ?? list[0]);
      let bl = readR(list[3] ?? list[1] ?? list[0]);
      const sc = Math.min(
        1,
        w / Math.max(1e-6, tl + tr),
        w / Math.max(1e-6, bl + br),
        h / Math.max(1e-6, tl + bl),
        h / Math.max(1e-6, tr + br),
      );
      tl *= sc;
      tr *= sc;
      br *= sc;
      bl *= sc;
      if (tl + tr + br + bl <= 1e-4) {
        this.rect(x, y, w, h);
        return;
      }
      this.moveTo(x + tl, y);
      this.lineTo(x + w - tr, y);
      if (tr > 0) this.arc(x + w - tr, y + tr, tr, -Math.PI / 2, 0);
      this.lineTo(x + w, y + h - br);
      if (br > 0) this.arc(x + w - br, y + h - br, br, 0, Math.PI / 2);
      this.lineTo(x + bl, y + h);
      if (bl > 0) this.arc(x + bl, y + h - bl, bl, Math.PI / 2, Math.PI);
      this.lineTo(x, y + tl);
      if (tl > 0) this.arc(x + tl, y + tl, tl, Math.PI, (Math.PI * 3) / 2);
      this.closePath();
    }

    quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void {
      if (!Number.isFinite(cpx + cpy + x + y)) return;
      if (!this._cur || this._cur.pts.length === 0) this.moveTo(cpx, cpy);
      const pts = this._cur!.pts;
      const [x0, y0] = pts[pts.length - 1];
      const [bx1, by1] = toBuf(this, cpx, cpy);
      const [bx2, by2] = toBuf(this, x, y);
      const segs = Math.max(
        4,
        Math.min(
          64,
          Math.ceil(
            (Math.hypot(bx1 - x0, by1 - y0) + Math.hypot(bx2 - bx1, by2 - by1)) *
              0.5,
          ),
        ),
      );
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const u = 1 - t;
        pushPt(
          this,
          u * u * x0 + 2 * u * t * bx1 + t * t * bx2,
          u * u * y0 + 2 * u * t * by1 + t * t * by2,
        );
      }
    }

    bezierCurveTo(
      cp1x: number,
      cp1y: number,
      cp2x: number,
      cp2y: number,
      x: number,
      y: number,
    ): void {
      if (!Number.isFinite(cp1x + cp1y + cp2x + cp2y + x + y)) return;
      if (!this._cur || this._cur.pts.length === 0) this.moveTo(cp1x, cp1y);
      const pts = this._cur!.pts;
      const [x0, y0] = pts[pts.length - 1];
      const [bx1, by1] = toBuf(this, cp1x, cp1y);
      const [bx2, by2] = toBuf(this, cp2x, cp2y);
      const [bx3, by3] = toBuf(this, x, y);
      const segs = Math.max(
        6,
        Math.min(
          64,
          Math.ceil(
            (Math.hypot(bx1 - x0, by1 - y0) +
              Math.hypot(bx2 - bx1, by2 - by1) +
              Math.hypot(bx3 - bx2, by3 - by2)) *
              0.4,
          ),
        ),
      );
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const u = 1 - t;
        const uu = u * u;
        const tt = t * t;
        pushPt(
          this,
          uu * u * x0 + 3 * uu * t * bx1 + 3 * u * tt * bx2 + tt * t * bx3,
          uu * u * y0 + 3 * uu * t * by1 + 3 * u * tt * by2 + tt * t * by3,
        );
      }
    }

    ellipse(
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      rotation = 0,
      startAngle = 0,
      endAngle = Math.PI * 2,
      counterclockwise = false,
    ): void {
      if (!Number.isFinite(x + y + radiusX + radiusY + rotation + startAngle + endAngle)) {
        return;
      }
      const rx = Math.max(0, radiusX);
      const ry = Math.max(0, radiusY);
      const tau = Math.PI * 2;
      let sweep = endAngle - startAngle;
      if (!counterclockwise) {
        if (sweep >= tau) sweep = tau;
        else if (sweep < 0) sweep = ((sweep % tau) + tau) % tau;
      } else {
        if (sweep <= -tau) sweep = -tau;
        else if (sweep > 0) sweep = -(((tau - (sweep % tau)) % tau) || tau);
      }
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      const estScale = Math.hypot(
        this._m[0] * this.canvas._sx,
        this._m[1] * this.canvas._sy,
        this._m[2] * this.canvas._sx,
        this._m[3] * this.canvas._sy,
      );
      const segs = Math.max(
        8,
        Math.min(96, Math.ceil((Math.abs(sweep) * Math.max(1, rx, ry) * estScale) / 3)),
      );
      for (let i = 0; i <= segs; i++) {
        const a = startAngle + (sweep * i) / segs;
        const ex = rx * Math.cos(a);
        const ey = ry * Math.sin(a);
        const px = x + ex * cosR - ey * sinR;
        const py = y + ex * sinR + ey * cosR;
        if (i === 0 && (!this._cur || this._cur.pts.length === 0)) this.moveTo(px, py);
        else this.lineTo(px, py);
      }
    }

    arc(
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      counterclockwise = false,
    ): void {
      this.ellipse(x, y, radius, radius, 0, startAngle, endAngle, counterclockwise);
    }

    arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
      if (!Number.isFinite(x1 + y1 + x2 + y2 + radius)) return;
      const r = Math.max(0, radius);
      if (!this._cur || this._cur.pts.length === 0) {
        this.moveTo(x1, y1);
        return;
      }
      if (r <= 1e-6) {
        this.lineTo(x1, y1);
        return;
      }
      const pts = this._cur.pts;
      const [bx0, by0] = pts[pts.length - 1];
      const [x0, y0] = fromBuf(this, bx0, by0);
      const v1x = x0 - x1;
      const v1y = y0 - y1;
      const v2x = x2 - x1;
      const v2y = y2 - y1;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-6 || l2 < 1e-6) {
        this.lineTo(x1, y1);
        return;
      }
      const u1x = v1x / l1;
      const u1y = v1y / l1;
      const u2x = v2x / l2;
      const u2y = v2y / l2;
      const cross = u1x * u2y - u1y * u2x;
      if (Math.abs(cross) < 1e-6) {
        this.lineTo(x1, y1);
        return;
      }
      const halfA = Math.acos(Math.max(-1, Math.min(1, u1x * u2x + u1y * u2y))) * 0.5;
      const dist = r / Math.tan(halfA);
      const bisX = u1x + u2x;
      const bisY = u1y + u2y;
      const bisL = Math.hypot(bisX, bisY) || 1;
      const cDist = r / Math.sin(halfA);
      const cx = x1 + (bisX / bisL) * cDist;
      const cy = y1 + (bisY / bisL) * cDist;
      this.arc(
        cx,
        cy,
        r,
        Math.atan2(y1 + u1y * dist - cy, x1 + u1x * dist - cx),
        Math.atan2(y1 + u2y * dist - cy, x1 + u2x * dist - cx),
        cross > 0,
      );
    }

    fill(fillRule?: string): void {
      if (this.canvas.width <= 0 || this.canvas.height <= 0) return;
      const shader = makeShader(this, this.fillStyle);
      const op = resolveOp(this);
      scanlineSubpaths(
        this,
        this._subs,
        typeof fillRule === 'string' ? fillRule : 'nonzero',
        (px, py) => blendPx(this, op, px, py, shader(px + 0.5, py + 0.5)),
      );
      this.canvas._ver++;
    }

    clip(fillRule?: string): void {
      const bw = this.canvas._bw;
      const bh = this.canvas._bh;
      const next = new Uint8Array(bw * bh);
      scanlineSubpaths(
        this,
        this._subs,
        typeof fillRule === 'string' ? fillRule : 'nonzero',
        (px, py) => {
          next[py * bw + px] = 1;
        },
      );
      if (this._clip) {
        for (let i = 0; i < next.length; i++) next[i] &= this._clip[i];
      }
      this._clip = next;
    }

    stroke(): void {
      if (this.canvas.width <= 0 || this.canvas.height <= 0) return;
      const m = this._m;
      const avgScale =
        (Math.hypot(m[0] * this.canvas._sx, m[1] * this.canvas._sy) +
          Math.hypot(m[2] * this.canvas._sx, m[3] * this.canvas._sy)) *
        0.5;
      const rawLw = Number(this.lineWidth);
      const lw = Number.isFinite(rawLw) && rawLw > 0 ? rawLw : 1;
      const halfW = Math.max(0.5, lw * avgScale * 0.5);
      const r2 = halfW * halfW;
      const cap = this.lineCap;
      const bw = this.canvas._bw;
      const bh = this.canvas._bh;
      const shader = makeShader(this, this.strokeStyle);
      const op = resolveOp(this);
      const stamp = new Uint8Array(bw * bh);
      let dashTotal = 0;
      const scaledDash: number[] = [];
      for (let i = 0; i < this._dash.length; i++) {
        const d = this._dash[i] * avgScale;
        scaledDash.push(d);
        dashTotal += d;
      }

      const drawThickSeg = (
        ax: number,
        ay: number,
        bx: number,
        by: number,
        startCap: boolean,
        endCap: boolean,
      ) => {
        let x0 = ax;
        let y0 = ay;
        let x1 = bx;
        let y1 = by;
        let dx = x1 - x0;
        let dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (cap === 'square' && len > 1e-6) {
          const ux = (dx / len) * halfW;
          const uy = (dy / len) * halfW;
          if (startCap) {
            x0 -= ux;
            y0 -= uy;
          }
          if (endCap) {
            x1 += ux;
            y1 += uy;
          }
          dx = x1 - x0;
          dy = y1 - y0;
        }
        const segL2 = dx * dx + dy * dy;
        const pad = halfW + 0.5;
        const minX = Math.max(0, Math.floor(Math.min(x0, x1) - pad));
        const maxX = Math.min(bw - 1, Math.ceil(Math.max(x0, x1) + pad));
        const minY = Math.max(0, Math.floor(Math.min(y0, y1) - pad));
        const maxY = Math.min(bh - 1, Math.ceil(Math.max(y0, y1) + pad));
        for (let py = minY; py <= maxY; py++) {
          const cy = py + 0.5;
          for (let px = minX; px <= maxX; px++) {
            const pIdx = py * bw + px;
            if (stamp[pIdx]) continue;
            const cx = px + 0.5;
            let t = segL2 > 1e-9 ? ((cx - x0) * dx + (cy - y0) * dy) / segL2 : 0;
            if (cap === 'butt' && ((t < 0 && startCap) || (t > 1 && endCap))) continue;
            t = Math.max(0, Math.min(1, t));
            const qx = x0 + t * dx;
            const qy = y0 + t * dy;
            if ((cx - qx) * (cx - qx) + (cy - qy) * (cy - qy) <= r2) {
              stamp[pIdx] = 1;
              blendPx(this, op, px, py, shader(cx, cy));
            }
          }
        }
      };

      const rawOff = Number(this.lineDashOffset);
      const dashOff = Number.isFinite(rawOff) ? rawOff : 0;
      for (const sp of this._subs) {
        const pts = sp.pts;
        const n = pts.length;
        if (n < 2) continue;
        const segCount = sp.closed ? n : n - 1;
        let distAcc =
          dashTotal > 1e-6
            ? (((dashOff * avgScale) % dashTotal) + dashTotal) % dashTotal
            : 0;
        for (let i = 0; i < segCount; i++) {
          const [ax, ay] = pts[i];
          const [bx, by] = pts[(i + 1) % n];
          if (dashTotal <= 1e-6) {
            drawThickSeg(ax, ay, bx, by, !sp.closed && i === 0, !sp.closed && i === segCount - 1);
          } else {
            const segLen = Math.hypot(bx - ax, by - ay);
            if (segLen <= 1e-6) continue;
            let pos = 0;
            while (pos < segLen) {
              let rem = distAcc;
              let di = 0;
              while (di < scaledDash.length && rem >= scaledDash[di]) {
                rem -= scaledDash[di];
                di++;
              }
              const step = Math.min(
                segLen - pos,
                di < scaledDash.length ? Math.max(0.25, scaledDash[di] - rem) : segLen - pos,
              );
              if (di % 2 === 0) {
                const t0 = pos / segLen;
                const t1 = (pos + step) / segLen;
                drawThickSeg(
                  ax + (bx - ax) * t0,
                  ay + (by - ay) * t0,
                  ax + (bx - ax) * t1,
                  ay + (by - ay) * t1,
                  true,
                  true,
                );
              }
              pos += step;
              distAcc = (distAcc + step) % dashTotal;
            }
          }
        }
      }
      this.canvas._ver++;
    }

    clearRect(x: number, y: number, w: number, h: number): void {
      if (
        !Number.isFinite(x + y + w + h) ||
        this.canvas.width <= 0 ||
        this.canvas.height <= 0
      ) {
        return;
      }
      const m = this._m;
      if (
        m[0] === 1 &&
        m[1] === 0 &&
        m[2] === 0 &&
        m[3] === 1 &&
        m[4] === 0 &&
        m[5] === 0 &&
        !this._clip &&
        x <= 0 &&
        y <= 0 &&
        x + w >= this.canvas.width &&
        y + h >= this.canvas.height
      ) {
        this.canvas._data.fill(0);
        this.canvas._ver++;
        return;
      }
      const data = this.canvas._data;
      const bw = this.canvas._bw;
      const clip = this._clip;
      scanlineSubpaths(
        this,
        [
          {
            pts: [
              toBuf(this, x, y),
              toBuf(this, x + w, y),
              toBuf(this, x + w, y + h),
              toBuf(this, x, y + h),
            ],
            closed: true,
          },
        ],
        'nonzero',
        (px, py) => {
          const pIdx = py * bw + px;
          if (clip && !clip[pIdx]) return;
          const o = pIdx * 4;
          data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 0;
        },
      );
      this.canvas._ver++;
    }

    fillRect(x: number, y: number, w: number, h: number): void {
      if (
        !Number.isFinite(x + y + w + h) ||
        w === 0 ||
        h === 0 ||
        this.canvas.width <= 0 ||
        this.canvas.height <= 0
      ) {
        return;
      }
      const shader = makeShader(this, this.fillStyle);
      const op = resolveOp(this);
      const m = this._m;
      if (m[1] === 0 && m[2] === 0) {
        const bw = this.canvas._bw;
        const bh = this.canvas._bh;
        const ax = (m[0] * x + m[4]) * this.canvas._sx;
        const bx = (m[0] * (x + w) + m[4]) * this.canvas._sx;
        const ay = (m[3] * y + m[5]) * this.canvas._sy;
        const by = (m[3] * (y + h) + m[5]) * this.canvas._sy;
        const x0 = Math.max(0, Math.ceil(Math.min(ax, bx) - 0.5));
        const x1 = Math.min(bw - 1, Math.ceil(Math.max(ax, bx) - 0.5) - 1);
        const y0 = Math.max(0, Math.ceil(Math.min(ay, by) - 0.5));
        const y1 = Math.min(bh - 1, Math.ceil(Math.max(ay, by) - 0.5) - 1);
        if (x0 <= x1 && y0 <= y1) {
          if (!this._clip && typeof this.fillStyle === 'string') {
            const c32 = shader(0, 0);
            const sa = c32 >>> 24;
            if ((op === 0 && sa >= 255) || op === 1) {
              const word = new Uint32Array(
                new Uint8Array([
                  c32 & 255,
                  (c32 >>> 8) & 255,
                  (c32 >>> 16) & 255,
                  sa,
                ]).buffer,
              )[0]!;
              const data = this.canvas._data;
              const u32 = new Uint32Array(data.buffer, data.byteOffset, bw * bh);
              if (x0 === 0 && x1 === bw - 1) {
                u32.fill(word, y0 * bw, (y1 + 1) * bw);
              } else {
                for (let py = y0; py <= y1; py++) {
                  u32.fill(word, py * bw + x0, py * bw + x1 + 1);
                }
              }
              this.canvas._ver++;
              return;
            }
          }
          const shadeRow = (py: number): void => {
            const cy = py + 0.5;
            for (let px = x0; px <= x1; px++) {
              blendPx(this, op, px, py, shader(px + 0.5, cy));
            }
          };
          for (let py = y0; py <= y1; py++) shadeRow(py);
        }
        this.canvas._ver++;
        return;
      }
      scanlineSubpaths(
        this,
        [
          {
            pts: [
              toBuf(this, x, y),
              toBuf(this, x + w, y),
              toBuf(this, x + w, y + h),
              toBuf(this, x, y + h),
            ],
            closed: true,
          },
        ],
        'nonzero',
        (px, py) => blendPx(this, op, px, py, shader(px + 0.5, py + 0.5)),
      );
      this.canvas._ver++;
    }

    strokeRect(x: number, y: number, w: number, h: number): void {
      if (!Number.isFinite(x + y + w + h) || (w === 0 && h === 0)) return;
      const sSubs = this._subs;
      const sCur = this._cur;
      const sPts = this._pts;
      this._subs = [];
      this._cur = null;
      this._pts = 0;
      this.rect(x, y, w, h);
      this.stroke();
      this._subs = sSubs;
      this._cur = sCur;
      this._pts = sPts;
    }

    measureText(text: string): {
      width: number;
      actualBoundingBoxAscent: number;
      actualBoundingBoxDescent: number;
      fontBoundingBoxAscent: number;
      fontBoundingBoxDescent: number;
    } {
      const {sizePx, bold} = parseFontSpec(this.font);
      const n = Array.from(String(text ?? '')).length;
      return {
        width: n > 0 ? n * sizePx * (bold ? 0.64 : 0.6) - sizePx * 0.1 : 0,
        actualBoundingBoxAscent: sizePx * 0.8,
        actualBoundingBoxDescent: sizePx * 0.2,
        fontBoundingBoxAscent: sizePx * 0.85,
        fontBoundingBoxDescent: sizePx * 0.2,
      };
    }

    fillText(text: string, x: number, y: number, maxWidth?: number): void {
      drawTextImpl(this, text, x, y, maxWidth, false);
    }

    strokeText(text: string, x: number, y: number, maxWidth?: number): void {
      drawTextImpl(this, text, x, y, maxWidth, true);
    }

    // tslint:disable-next-line:no-any Accepts (sw, sh) or existing ImageData.
    createImageData(swOrImg: any, sh?: number): {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    } {
      const isObj = swOrImg && typeof swOrImg === 'object';
      const w = Math.max(
        1,
        Math.min(
          MAX_TEXTURE_DIM,
          Math.floor(Math.abs(Number(isObj ? swOrImg.width : swOrImg)) || 1),
        ),
      );
      const h = Math.max(
        1,
        Math.min(
          MAX_TEXTURE_DIM,
          Math.floor(Math.abs(Number(isObj ? swOrImg.height : sh)) || 1),
        ),
      );
      return {data: new Uint8ClampedArray(w * h * 4), width: w, height: h};
    }

    getImageData(
      sx: number,
      sy: number,
      sw: number,
      sh: number,
    ): {data: Uint8ClampedArray; width: number; height: number} {
      let x0 = Math.floor(Number(sx) || 0);
      let y0 = Math.floor(Number(sy) || 0);
      let w = Math.floor(Number(sw) || 0);
      let h = Math.floor(Number(sh) || 0);
      if (w < 0) {
        x0 += w;
        w = -w;
      }
      if (h < 0) {
        y0 += h;
        h = -h;
      }
      w = Math.max(1, Math.min(MAX_TEXTURE_DIM, w));
      h = Math.max(1, Math.min(MAX_TEXTURE_DIM, h));
      const out = new Uint8ClampedArray(w * h * 4);
      if (this.canvas.width <= 0 || this.canvas.height <= 0) {
        return {data: out, width: w, height: h};
      }
      const bw = this.canvas._bw;
      const bh = this.canvas._bh;
      const sxS = this.canvas._sx;
      const syS = this.canvas._sy;
      const src = this.canvas._data;
      for (let row = 0; row < h; row++) {
        const ly = y0 + row;
        if (ly < 0 || ly >= this.canvas.height) continue;
        const by = Math.min(bh - 1, Math.floor((ly + 0.5) * syS));
        for (let col = 0; col < w; col++) {
          const lx = x0 + col;
          if (lx < 0 || lx >= this.canvas.width) continue;
          const si = (by * bw + Math.min(bw - 1, Math.floor((lx + 0.5) * sxS))) * 4;
          const di = (row * w + col) * 4;
          out[di] = src[si];
          out[di + 1] = src[si + 1];
          out[di + 2] = src[si + 2];
          out[di + 3] = src[si + 3];
        }
      }
      return {data: out, width: w, height: h};
    }

    putImageData(
      imageData: {data: ArrayLike<number>; width: number; height: number},
      dx: number,
      dy: number,
      dirtyX = 0,
      dirtyY = 0,
      dirtyWidth?: number,
      dirtyHeight?: number,
    ): void {
      if (
        !imageData?.data ||
        this.canvas.width <= 0 ||
        this.canvas.height <= 0
      ) {
        return;
      }
      const iw = Math.floor(Number(imageData.width) || 0);
      const ih = Math.floor(Number(imageData.height) || 0);
      if (iw <= 0 || ih <= 0) return;
      let rx = Math.floor(Number(dirtyX) || 0);
      let ry = Math.floor(Number(dirtyY) || 0);
      let rw = dirtyWidth !== undefined ? Math.floor(Number(dirtyWidth)) : iw;
      let rh = dirtyHeight !== undefined ? Math.floor(Number(dirtyHeight)) : ih;
      if (rw < 0) {
        rx += rw;
        rw = -rw;
      }
      if (rh < 0) {
        ry += rh;
        rh = -rh;
      }
      const xStart = Math.max(0, rx);
      const yStart = Math.max(0, ry);
      const xEnd = Math.min(iw, rx + rw);
      const yEnd = Math.min(ih, ry + rh);
      if (xStart >= xEnd || yStart >= yEnd) return;
      const ox = Math.floor(Number(dx) || 0);
      const oy = Math.floor(Number(dy) || 0);
      const bw = this.canvas._bw;
      const bh = this.canvas._bh;
      const invSx = 1 / this.canvas._sx;
      const invSy = 1 / this.canvas._sy;
      const dst = this.canvas._data;
      const src = imageData.data;
      const bx0 = Math.max(0, Math.floor((ox + xStart) * this.canvas._sx));
      const bx1 = Math.min(bw - 1, Math.ceil((ox + xEnd) * this.canvas._sx) - 1);
      const by0 = Math.max(0, Math.floor((oy + yStart) * this.canvas._sy));
      const by1 = Math.min(bh - 1, Math.ceil((oy + yEnd) * this.canvas._sy) - 1);
      for (let by = by0; by <= by1; by++) {
        const iy = Math.floor((by + 0.5) * invSy) - oy;
        if (iy < yStart || iy >= yEnd) continue;
        for (let bx = bx0; bx <= bx1; bx++) {
          const ix = Math.floor((bx + 0.5) * invSx) - ox;
          if (ix < xStart || ix >= xEnd) continue;
          const si = (iy * iw + ix) * 4;
          const di = (by * bw + bx) * 4;
          dst[di] = src[si] | 0;
          dst[di + 1] = src[si + 1] | 0;
          dst[di + 2] = src[si + 2] | 0;
          dst[di + 3] = src[si + 3] | 0;
        }
      }
      this.canvas._ver++;
    }

    // tslint:disable-next-line:no-any Supports 3-, 5-, and 9-arg drawImage forms.
    drawImage(image: any, ...args: number[]): void {
      const src = extractPixelsFromSource(image);
      if (
        !src ||
        src.width <= 0 ||
        src.height <= 0 ||
        this.canvas.width <= 0 ||
        this.canvas.height <= 0
      ) {
        return;
      }
      const logSrcW = Number(image?.width) > 0 ? Number(image.width) : src.width;
      const logSrcH = Number(image?.height) > 0 ? Number(image.height) : src.height;
      let sx = 0;
      let sy = 0;
      let sw = logSrcW;
      let sh = logSrcH;
      let dx = 0;
      let dy = 0;
      let dw = logSrcW;
      let dh = logSrcH;
      if (args.length >= 8) [sx, sy, sw, sh, dx, dy, dw, dh] = args;
      else if (args.length >= 4) [dx, dy, dw, dh] = args;
      else if (args.length >= 2) [dx, dy] = args;
      else return;
      if (
        !Number.isFinite(sx + sy + sw + sh + dx + dy + dw + dh) ||
        sw === 0 ||
        sh === 0 ||
        dw === 0 ||
        dh === 0
      ) {
        return;
      }
      const rawGa = Number(this.globalAlpha);
      const ga = Number.isFinite(rawGa) ? Math.max(0, Math.min(1, rawGa)) : 1;
      const ga256 = Math.round(ga * 256);
      const op = resolveOp(this);
      const [ixx, ixy, ix0, iyx, iyy, iy0] = invTransform(this);
      const invDw = 1 / dw;
      const invDh = 1 / dh;
      const scaleSrcX = src.width / logSrcW;
      const scaleSrcY = src.height / logSrcH;
      scanlineSubpaths(
        this,
        [
          {
            pts: [
              toBuf(this, dx, dy),
              toBuf(this, dx + dw, dy),
              toBuf(this, dx + dw, dy + dh),
              toBuf(this, dx, dy + dh),
            ],
            closed: true,
          },
        ],
        'nonzero',
        (px, py) => {
          const cx = px + 0.5;
          const cy = py + 0.5;
          const ux = ixx * cx + ixy * cy + ix0;
          const uy = iyx * cx + iyy * cy + iy0;
          const u = (ux - dx) * invDw;
          const v = (uy - dy) * invDh;
          if (u < 0 || u >= 1 || v < 0 || v >= 1) return;
          const ix = Math.floor((sx + u * sw) * scaleSrcX);
          const iy = Math.floor((sy + v * sh) * scaleSrcY);
          if (ix < 0 || ix >= src.width || iy < 0 || iy >= src.height) return;
          const si = (iy * src.width + ix) * 4;
          blendPx(
            this,
            op,
            px,
            py,
            packRgba(
              src.data[si],
              src.data[si + 1],
              src.data[si + 2],
              (src.data[si + 3] * ga256 + 128) >> 8,
            ),
          );
        },
      );
      this.canvas._ver++;
    }
  }

  const reallocCanvas = (c: VirtualCanvas, rawW: number, rawH: number): void => {
    const nw = Math.floor(Number(rawW));
    const nh = Math.floor(Number(rawH));
    c._w = Number.isFinite(nw) && nw >= 0 ? nw : 0;
    c._h = Number.isFinite(nh) && nh >= 0 ? nh : 0;
    c._bw = c._w > 0 ? Math.min(MAX_BACKING_DIM, c._w) : 1;
    c._bh = c._h > 0 ? Math.min(MAX_BACKING_DIM, c._h) : 1;
    c._sx = c._w > 0 ? c._bw / c._w : 1;
    c._sy = c._h > 0 ? c._bh / c._h : 1;
    c._data = new Uint8ClampedArray(c._bw * c._bh * 4);
    if (c._ctx2d) resetCtx(c._ctx2d);
    c._ver++;
  };

  class VirtualCanvas {
    declare readonly _vc: boolean;
    declare _w: number;
    declare _h: number;
    declare _bw: number;
    declare _bh: number;
    declare _sx: number;
    declare _sy: number;
    declare _data: Uint8ClampedArray;
    declare _ver: number;
    declare _ctx2d: VirtualCanvasContext2D | null;
    declare style: Record<string, unknown>;

    constructor(width = 300, height = 150) {
      this._vc = true;
      this._ver = 1;
      this._ctx2d = null;
      this.style = {};
      reallocCanvas(this, width, height);
    }

    get width(): number {
      return this._w;
    }
    set width(v: number) {
      reallocCanvas(this, v, this._h);
    }

    get height(): number {
      return this._h;
    }
    set height(v: number) {
      reallocCanvas(this, this._w, v);
    }

    getContext(contextId: string): VirtualCanvasContext2D | null {
      if (String(contextId).toLowerCase() !== '2d') return null;
      return (this._ctx2d ??= new VirtualCanvasContext2D(this));
    }

    toDataURL(): string {
      if (
        this._w <= 0 ||
        this._h <= 0 ||
        this._w > MAX_TEXTURE_DIM ||
        this._h > MAX_TEXTURE_DIM
      ) {
        return '';
      }
      return encodeRgbaToPngDataUri(this._data, this._bw, this._bh, false, false).uri;
    }

    addEventListener(): void {}
    removeEventListener(): void {}
    getBoundingClientRect(): {
      left: number;
      top: number;
      width: number;
      height: number;
      right: number;
      bottom: number;
    } {
      return {
        left: 0,
        top: 0,
        width: this._w,
        height: this._h,
        right: this._w,
        bottom: this._h,
      };
    }
  }

  // tslint:disable-next-line:no-any Heterogeneous canvas / ImageData / Texture source.
  function extractPixelsFromSource(src: any): {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    logicalW: number;
    logicalH: number;
    ver: number;
  } | null {
    if (!src || typeof src !== 'object') return null;
    const vc = src._vc
      ? src
      : src.canvas?._vc
        ? src.canvas
        : src.image?._vc
          ? src.image
          : null;
    if (vc) {
      return {
        data: vc._data,
        width: vc._bw,
        height: vc._bh,
        logicalW: vc._w,
        logicalH: vc._h,
        ver: vc._ver,
      };
    }
    const target = src.image && typeof src.image === 'object' ? src.image : src;
    if (
      target.data &&
      typeof target.data.length === 'number' &&
      Number(target.width) > 0 &&
      Number(target.height) > 0
    ) {
      const w = Math.floor(Number(target.width));
      const h = Math.floor(Number(target.height));
      const u8 =
        target.data instanceof Uint8ClampedArray
          ? target.data
          : new Uint8ClampedArray(target.data);
      return {data: u8, width: w, height: h, logicalW: w, logicalH: h, ver: -1};
    }
    if (typeof target.getContext === 'function') {
      const w = Math.floor(Number(target.width) || 0);
      const h = Math.floor(Number(target.height) || 0);
      if (w > 0 && h > 0 && w <= MAX_TEXTURE_DIM && h <= MAX_TEXTURE_DIM) {
        try {
          const id = target.getContext('2d')?.getImageData?.(0, 0, w, h);
          if (id?.data) {
            return {
              data:
                id.data instanceof Uint8ClampedArray
                  ? id.data
                  : new Uint8ClampedArray(id.data),
              width: w,
              height: h,
              logicalW: w,
              logicalH: h,
              ver: -1,
            };
          }
        } catch {}
      }
    }
    return null;
  }

  const TextureBase =
    threeNs.Texture ??
    class FallbackTexture {
      // tslint:disable-next-line:no-any Matches Texture signature.
      declare source: any;
      declare isTexture: boolean;
      declare image: unknown;
      declare width: number;
      declare height: number;
      // tslint:disable-next-line:no-any
      constructor(s: any = '') {
        this.source = s;
        this.isTexture = true;
        this.image = null;
        this.width = 0;
        this.height = 0;
      }
      dispose(): void {}
    };

  const syncCanvasTex = (tex: CanvasTexture): void => {
    const px = extractPixelsFromSource(tex.image);
    if (!px) {
      tex.width = Number(tex.image?.width ?? 0) || 0;
      tex.height = Number(tex.image?.height ?? 0) || 0;
      tex._cs = '';
      return;
    }
    tex.width = px.logicalW;
    tex.height = px.logicalH;
    if (
      px.logicalW <= 0 ||
      px.logicalH <= 0 ||
      px.logicalW > MAX_TEXTURE_DIM ||
      px.logicalH > MAX_TEXTURE_DIM
    ) {
      tex._cs = '';
      return;
    }
    const key = `${px.ver >= 0 ? px.ver : tex._fs}|${px.logicalW}x${px.logicalH}|${tex.flipY ? 1 : 0}|${tex.colorSpace}`;
    if (key === tex._bk && tex._cs) return;
    tex._bk = key;
    const encoded = encodeRgbaToPngDataUri(
      px.data,
      px.width,
      px.height,
      tex.flipY,
      tex.colorSpace === 'srgb-linear',
    );
    tex._cs = encoded.uri;
    tex._ca = encoded.avgColor;
  };

  class CanvasTexture extends TextureBase {
    declare readonly isCanvasTexture: boolean;
    declare readonly isDataTexture: boolean;
    declare format: number;
    declare type: number;
    declare magFilter: number;
    declare minFilter: number;
    declare flipY: boolean;
    declare generateMipmaps: boolean;
    declare unpackAlignment: number;
    declare colorSpace: string;
    declare _bk: string;
    declare _cs: string;
    declare _ca: RgbaTuple;
    declare _ms: string;
    declare _fs: number;

    constructor(
      // tslint:disable-next-line:no-any Accepts VirtualCanvas, HTMLCanvasElement, OffscreenCanvas, or ImageData.
      canvas: any = null,
      _mapping?: number,
      wrapS = 1001,
      wrapT = 1001,
      magFilter = 1006,
      minFilter = 1008,
      format = 1023,
      type = 1009,
      _anisotropy = 1,
      colorSpace = 'srgb',
    ) {
      super('');
      delete (this as Record<string, unknown>)['source'];
      this.isCanvasTexture = true;
      this.isDataTexture = true;
      this.image = canvas;
      this.width = Number(canvas?.width ?? 0) || 0;
      this.height = Number(canvas?.height ?? 0) || 0;
      this.wrapS = Number(wrapS) || 1001;
      this.wrapT = Number(wrapT) || 1001;
      this.magFilter = Number(magFilter) || 1006;
      this.minFilter = Number(minFilter) || 1008;
      this.format = Number(format) || 1023;
      this.type = Number(type) || 1009;
      this.flipY = true;
      this.generateMipmaps = true;
      this.unpackAlignment = 4;
      this.colorSpace = colorSpace || 'srgb';
      this._bk = '';
      this._cs = '';
      this._ca = [1, 1, 1, 1];
      this._ms = '';
      this._fs = 1;
    }

    get needsUpdate(): boolean {
      return false;
    }
    set needsUpdate(v: boolean) {
      if (v) {
        this._ms = '';
        this._fs++;
        this.width = Number(this.image?.width ?? 0) || 0;
        this.height = Number(this.image?.height ?? 0) || 0;
      }
    }

    get source(): string {
      if (this._ms) return this._ms;
      syncCanvasTex(this);
      return this._cs;
    }
    set source(v: string) {
      this._ms = typeof v === 'string' ? v : '';
    }

    get avgColor(): RgbaTuple {
      syncCanvasTex(this);
      return this._ca;
    }
    set avgColor(v: RgbaTuple) {
      if (Array.isArray(v) && v.length === 4) {
        this._ca = [v[0], v[1], v[2], v[3]];
      }
    }
  }

  try {
    Object.freeze(VirtualCanvasGradient.prototype);
    Object.freeze(VirtualCanvasPattern.prototype);
    Object.freeze(VirtualCanvasContext2D.prototype);
    Object.freeze(VirtualCanvas.prototype);
  } catch {}

  const createCanvas = (width = 300, height = 150): VirtualCanvas =>
    new VirtualCanvas(width, height);

  // Install virtual `document.createElement('canvas')` in headless/Worker/Boa
  // realms where no real browser `HTMLCanvasElement` exists, leaving real DOM
  // pages untouched.
  try {
    // tslint:disable-next-line:no-any Probe global realm safely across browser, worker, Node, and Boa.
    const g: any =
      typeof globalThis !== 'undefined'
        ? globalThis
        : typeof self !== 'undefined'
          ? self
          : undefined;
    if (g && typeof g.HTMLCanvasElement === 'undefined') {
      const makeStubElement = (tag: unknown) => {
        if (String(tag).toLowerCase() === 'canvas') {
          return new VirtualCanvas(300, 150);
        }
        return {
          style: {},
          getContext: () => null,
          addEventListener: () => {},
          removeEventListener: () => {},
          appendChild: () => {},
          removeChild: () => {},
          setAttribute: () => {},
        };
      };
      if (typeof g.document === 'undefined' || g.document === null) {
        const docBody = Object.freeze({
          appendChild: () => {},
          removeChild: () => {},
          style: {},
        });
        const docEl = Object.freeze({style: {}});
        g.document = Object.freeze({
          __threeLiveVirtualCanvas: true,
          createElement: makeStubElement,
          createTextNode: () => ({}),
          querySelectorAll: () => [],
          querySelector: () => null,
          getElementById: () => null,
          head: docBody,
          body: docBody,
          documentElement: docEl,
          addEventListener: () => {},
          removeEventListener: () => {},
        });
      } else if (
        typeof g.document === 'object' &&
        !g.document.__threeLiveVirtualCanvas
      ) {
        const prevCreate =
          typeof g.document.createElement === 'function'
            ? g.document.createElement.bind(g.document)
            : null;
        try {
          g.document.__threeLiveVirtualCanvas = true;
          g.document.createElement = (tag: unknown) =>
            String(tag).toLowerCase() === 'canvas'
              ? new VirtualCanvas(300, 150)
              : prevCreate
                ? prevCreate(tag)
                : makeStubElement(tag);
        } catch {}
      }
    }
  } catch {}

  // =========================================================================
  // Procedural Noise (`THREE.ImprovedNoise` & `THREE.SimplexNoise`)
  // =========================================================================

  const PERLIN_BASE = new Uint8Array([
    151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140,
    36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148, 247, 120,
    234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33,
    88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71,
    134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133,
    230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161,
    1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130,
    116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64, 52, 217, 226, 250,
    124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227,
    47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44,
    154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98,
    108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34,
    242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14,
    239, 107, 49, 192, 214, 31, 181, 199, 106, 157, 184, 84, 204, 176, 115, 121,
    50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243,
    141, 128, 195, 78, 66, 215, 61, 156, 180,
  ]);
  const perlinP = new Uint8Array(512);
  for (let i = 0; i < 256; i++) {
    perlinP[i] = PERLIN_BASE[i];
    perlinP[i + 256] = PERLIN_BASE[i];
  }

  const perlinFade = (t: number): number =>
    t * t * t * (t * (t * 6 - 15) + 10);
  const perlinLerp = (t: number, a: number, b: number): number =>
    a + t * (b - a);
  const perlinGrad = (hash: number, x: number, y: number, z: number): number => {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  };

  class ImprovedNoise {
    noise(xIn: number, yIn: number, zIn = 0): number {
      let x = Number(xIn);
      let y = Number(yIn);
      let z = Number(zIn);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return 0;
      }
      const floorX = Math.floor(x);
      const floorY = Math.floor(y);
      const floorZ = Math.floor(z);
      const X = floorX & 255;
      const Y = floorY & 255;
      const Z = floorZ & 255;
      x -= floorX;
      y -= floorY;
      z -= floorZ;
      const xMinus1 = x - 1;
      const yMinus1 = y - 1;
      const zMinus1 = z - 1;
      const u = perlinFade(x);
      const v = perlinFade(y);
      const w = perlinFade(z);
      const A = perlinP[X] + Y;
      const AA = perlinP[A] + Z;
      const AB = perlinP[A + 1] + Z;
      const B = perlinP[X + 1] + Y;
      const BA = perlinP[B] + Z;
      const BB = perlinP[B + 1] + Z;
      return perlinLerp(
        w,
        perlinLerp(
          v,
          perlinLerp(
            u,
            perlinGrad(perlinP[AA], x, y, z),
            perlinGrad(perlinP[BA], xMinus1, y, z),
          ),
          perlinLerp(
            u,
            perlinGrad(perlinP[AB], x, yMinus1, z),
            perlinGrad(perlinP[BB], xMinus1, yMinus1, z),
          ),
        ),
        perlinLerp(
          v,
          perlinLerp(
            u,
            perlinGrad(perlinP[AA + 1], x, y, zMinus1),
            perlinGrad(perlinP[BA + 1], xMinus1, y, zMinus1),
          ),
          perlinLerp(
            u,
            perlinGrad(perlinP[AB + 1], x, yMinus1, zMinus1),
            perlinGrad(perlinP[BB + 1], xMinus1, yMinus1, zMinus1),
          ),
        ),
      );
    }
  }
  Object.freeze(ImprovedNoise.prototype);

  const SIMPLEX_GRAD3 = new Int8Array([
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0,
    -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1,
  ]);
  const SIMPLEX_GRAD4 = new Int8Array([
    0, 1, 1, 1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1, 0, -1, 1, 1, 0, -1, 1,
    -1, 0, -1, -1, 1, 0, -1, -1, -1, 1, 0, 1, 1, 1, 0, 1, -1, 1, 0, -1, 1, 1, 0,
    -1, -1, -1, 0, 1, 1, -1, 0, 1, -1, -1, 0, -1, 1, -1, 0, -1, -1, 1, 1, 0, 1,
    1, 1, 0, -1, 1, -1, 0, 1, 1, -1, 0, -1, -1, 1, 0, 1, -1, 1, 0, -1, -1, -1,
    0, 1, -1, -1, 0, -1, 1, 1, 1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1, -1, -1, 0, -1,
    1, 1, 0, -1, 1, -1, 0, -1, -1, 1, 0, -1, -1, -1, 0,
  ]);
  const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
  const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;
  const F3 = 1.0 / 3.0;
  const G3 = 1.0 / 6.0;
  const F4 = (Math.sqrt(5.0) - 1.0) / 4.0;
  const G4 = (5.0 - Math.sqrt(5.0)) / 20.0;

  const dot2 = (gi3: number, x: number, y: number): number =>
    SIMPLEX_GRAD3[gi3] * x + SIMPLEX_GRAD3[gi3 + 1] * y;
  const dot3 = (gi3: number, x: number, y: number, z: number): number =>
    SIMPLEX_GRAD3[gi3] * x +
    SIMPLEX_GRAD3[gi3 + 1] * y +
    SIMPLEX_GRAD3[gi3 + 2] * z;
  const dot4 = (
    gi4: number,
    x: number,
    y: number,
    z: number,
    w: number,
  ): number =>
    SIMPLEX_GRAD4[gi4] * x +
    SIMPLEX_GRAD4[gi4 + 1] * y +
    SIMPLEX_GRAD4[gi4 + 2] * z +
    SIMPLEX_GRAD4[gi4 + 3] * w;

  type RandomSource =
    | {random: () => number}
    | (() => number)
    | number
    | undefined;

  function resolveSimplexRandomFn(rIn?: RandomSource): () => number {
    const r: RandomSource = rIn === undefined ? Math : rIn;
    if (typeof r === 'function') {
      return r;
    }
    if (typeof r === 'number') {
      let localSeed = Number.isFinite(r) ? r | 0 : 0;
      return (): number => {
        let t = (localSeed = (localSeed + 0x6d2b79f5) | 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    if (r && typeof r === 'object' && typeof r.random === 'function') {
      return () => r.random();
    }
    return Math.random;
  }

  class SimplexNoise {
    declare p: Uint8Array;
    declare perm: Uint8Array;
    declare permMod12: Uint8Array;

    constructor(rIn?: RandomSource) {
      const randFn = resolveSimplexRandomFn(rIn);

      const p = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        const rv = Number(randFn());
        const unit = Number.isFinite(rv) ? ((rv % 1) + 1) % 1 : 0;
        p[i] = Math.floor(unit * 256) & 255;
      }
      const perm = new Uint8Array(512);
      const permMod12 = new Uint8Array(512);
      for (let i = 0; i < 512; i++) {
        const v = p[i & 255];
        perm[i] = v;
        permMod12[i] = v % 12;
      }
      this.p = p;
      this.perm = perm;
      this.permMod12 = permMod12;
    }

    noise(xin: number, yin: number): number {
      const xIn = Number(xin);
      const yIn = Number(yin);
      if (!Number.isFinite(xIn) || !Number.isFinite(yIn)) return 0;

      const perm = this.perm;
      const permMod12 = this.permMod12;
      const s = (xIn + yIn) * F2;
      const i = Math.floor(xIn + s);
      const j = Math.floor(yIn + s);
      const t = (i + j) * G2;
      const X0 = i - t;
      const Y0 = j - t;
      const x0 = xIn - X0;
      const y0 = yIn - Y0;

      const i1 = x0 > y0 ? 1 : 0;
      const j1 = x0 > y0 ? 0 : 1;

      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1.0 + 2.0 * G2;
      const y2 = y0 - 1.0 + 2.0 * G2;

      const ii = i & 255;
      const jj = j & 255;
      const gi0 = permMod12[ii + perm[jj]] * 3;
      const gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
      const gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;

      let n0 = 0;
      let t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) {
        t0 *= t0;
        n0 = t0 * t0 * dot2(gi0, x0, y0);
      }
      let n1 = 0;
      let t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) {
        t1 *= t1;
        n1 = t1 * t1 * dot2(gi1, x1, y1);
      }
      let n2 = 0;
      let t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) {
        t2 *= t2;
        n2 = t2 * t2 * dot2(gi2, x2, y2);
      }
      return 70.0 * (n0 + n1 + n2);
    }

    noise3d(xin: number, yin: number, zin: number): number {
      const xIn = Number(xin);
      const yIn = Number(yin);
      const zIn = Number(zin);
      if (
        !Number.isFinite(xIn) ||
        !Number.isFinite(yIn) ||
        !Number.isFinite(zIn)
      ) {
        return 0;
      }

      const perm = this.perm;
      const permMod12 = this.permMod12;
      const s = (xIn + yIn + zIn) * F3;
      const i = Math.floor(xIn + s);
      const j = Math.floor(yIn + s);
      const k = Math.floor(zIn + s);
      const t = (i + j + k) * G3;
      const x0 = xIn - (i - t);
      const y0 = yIn - (j - t);
      const z0 = zIn - (k - t);

      let i1: number;
      let j1: number;
      let k1: number;
      let i2: number;
      let j2: number;
      let k2: number;
      if (x0 >= y0) {
        if (y0 >= z0) {
          i1 = 1;
          j1 = 0;
          k1 = 0;
          i2 = 1;
          j2 = 1;
          k2 = 0;
        } else if (x0 >= z0) {
          i1 = 1;
          j1 = 0;
          k1 = 0;
          i2 = 1;
          j2 = 0;
          k2 = 1;
        } else {
          i1 = 0;
          j1 = 0;
          k1 = 1;
          i2 = 1;
          j2 = 0;
          k2 = 1;
        }
      } else if (y0 < z0) {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else if (x0 < z0) {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      }

      const x1 = x0 - i1 + G3;
      const y1 = y0 - j1 + G3;
      const z1 = z0 - k1 + G3;
      const x2 = x0 - i2 + 2.0 * G3;
      const y2 = y0 - j2 + 2.0 * G3;
      const z2 = z0 - k2 + 2.0 * G3;
      const x3 = x0 - 1.0 + 3.0 * G3;
      const y3 = y0 - 1.0 + 3.0 * G3;
      const z3 = z0 - 1.0 + 3.0 * G3;

      const ii = i & 255;
      const jj = j & 255;
      const kk = k & 255;
      const gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
      const gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
      const gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
      const gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;

      let n0 = 0;
      let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
      if (t0 >= 0) {
        t0 *= t0;
        n0 = t0 * t0 * dot3(gi0, x0, y0, z0);
      }
      let n1 = 0;
      let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
      if (t1 >= 0) {
        t1 *= t1;
        n1 = t1 * t1 * dot3(gi1, x1, y1, z1);
      }
      let n2 = 0;
      let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
      if (t2 >= 0) {
        t2 *= t2;
        n2 = t2 * t2 * dot3(gi2, x2, y2, z2);
      }
      let n3 = 0;
      let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
      if (t3 >= 0) {
        t3 *= t3;
        n3 = t3 * t3 * dot3(gi3, x3, y3, z3);
      }
      return 32.0 * (n0 + n1 + n2 + n3);
    }

    noise4d(x: number, y: number, z: number, w: number): number {
      const xIn = Number(x);
      const yIn = Number(y);
      const zIn = Number(z);
      const wIn = Number(w);
      if (
        !Number.isFinite(xIn) ||
        !Number.isFinite(yIn) ||
        !Number.isFinite(zIn) ||
        !Number.isFinite(wIn)
      ) {
        return 0;
      }

      const perm = this.perm;
      const s = (xIn + yIn + zIn + wIn) * F4;
      const i = Math.floor(xIn + s);
      const j = Math.floor(yIn + s);
      const k = Math.floor(zIn + s);
      const l = Math.floor(wIn + s);
      const t = (i + j + k + l) * G4;
      const x0 = xIn - (i - t);
      const y0 = yIn - (j - t);
      const z0 = zIn - (k - t);
      const w0 = wIn - (l - t);

      const rankx =
        (x0 > y0 ? 1 : 0) + (x0 > z0 ? 1 : 0) + (x0 > w0 ? 1 : 0);
      const ranky =
        (x0 <= y0 ? 1 : 0) + (y0 > z0 ? 1 : 0) + (y0 > w0 ? 1 : 0);
      const rankz =
        (x0 <= z0 ? 1 : 0) + (y0 <= z0 ? 1 : 0) + (z0 > w0 ? 1 : 0);
      const rankw =
        (x0 <= w0 ? 1 : 0) + (y0 <= w0 ? 1 : 0) + (z0 <= w0 ? 1 : 0);

      const i1 = rankx >= 3 ? 1 : 0;
      const j1 = ranky >= 3 ? 1 : 0;
      const k1 = rankz >= 3 ? 1 : 0;
      const l1 = rankw >= 3 ? 1 : 0;
      const i2 = rankx >= 2 ? 1 : 0;
      const j2 = ranky >= 2 ? 1 : 0;
      const k2 = rankz >= 2 ? 1 : 0;
      const l2 = rankw >= 2 ? 1 : 0;
      const i3 = rankx >= 1 ? 1 : 0;
      const j3 = ranky >= 1 ? 1 : 0;
      const k3 = rankz >= 1 ? 1 : 0;
      const l3 = rankw >= 1 ? 1 : 0;

      const x1 = x0 - i1 + G4;
      const y1 = y0 - j1 + G4;
      const z1 = z0 - k1 + G4;
      const w1 = w0 - l1 + G4;
      const x2 = x0 - i2 + 2.0 * G4;
      const y2 = y0 - j2 + 2.0 * G4;
      const z2 = z0 - k2 + 2.0 * G4;
      const w2 = w0 - l2 + 2.0 * G4;
      const x3 = x0 - i3 + 3.0 * G4;
      const y3 = y0 - j3 + 3.0 * G4;
      const z3 = z0 - k3 + 3.0 * G4;
      const w3 = w0 - l3 + 3.0 * G4;
      const x4 = x0 - 1.0 + 4.0 * G4;
      const y4 = y0 - 1.0 + 4.0 * G4;
      const z4 = z0 - 1.0 + 4.0 * G4;
      const w4 = w0 - 1.0 + 4.0 * G4;

      const ii = i & 255;
      const jj = j & 255;
      const kk = k & 255;
      const ll = l & 255;
      const gi0 = (perm[ii + perm[jj + perm[kk + perm[ll]]]] & 31) * 4;
      const gi1 =
        (perm[ii + i1 + perm[jj + j1 + perm[kk + k1 + perm[ll + l1]]]] & 31) *
        4;
      const gi2 =
        (perm[ii + i2 + perm[jj + j2 + perm[kk + k2 + perm[ll + l2]]]] & 31) *
        4;
      const gi3 =
        (perm[ii + i3 + perm[jj + j3 + perm[kk + k3 + perm[ll + l3]]]] & 31) *
        4;
      const gi4 =
        (perm[ii + 1 + perm[jj + 1 + perm[kk + 1 + perm[ll + 1]]]] & 31) * 4;

      let n0 = 0;
      let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
      if (t0 >= 0) {
        t0 *= t0;
        n0 = t0 * t0 * dot4(gi0, x0, y0, z0, w0);
      }
      let n1 = 0;
      let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
      if (t1 >= 0) {
        t1 *= t1;
        n1 = t1 * t1 * dot4(gi1, x1, y1, z1, w1);
      }
      let n2 = 0;
      let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
      if (t2 >= 0) {
        t2 *= t2;
        n2 = t2 * t2 * dot4(gi2, x2, y2, z2, w2);
      }
      let n3 = 0;
      let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
      if (t3 >= 0) {
        t3 *= t3;
        n3 = t3 * t3 * dot4(gi3, x3, y3, z3, w3);
      }
      let n4 = 0;
      let t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
      if (t4 >= 0) {
        t4 *= t4;
        n4 = t4 * t4 * dot4(gi4, x4, y4, z4, w4);
      }
      return 27.0 * (n0 + n1 + n2 + n3 + n4);
    }

    noise2D(x: number, y: number): number {
      return this.noise(x, y);
    }

    noise3D(x: number, y: number, z: number): number {
      return this.noise3d(x, y, z);
    }

    noise4D(x: number, y: number, z: number, w: number): number {
      return this.noise4d(x, y, z, w);
    }
  }
  Object.freeze(SimplexNoise.prototype);

  // =========================================================================
  // PBR Channel Packing (`roughnessMap` + `metalnessMap` -> ORM, `bumpMap` -> normal)
  // =========================================================================

  interface RawPbrPixels {
    buf: ArrayLike<number>;
    w: number;
    h: number;
    ch: number;
    isFloat: boolean;
    flipY: boolean;
  }

  const getPbrTexPixels = (t: unknown): RawPbrPixels | null => {
    if (!t || typeof t !== 'object') return null;
    // tslint:disable-next-line:no-any Heterogeneous DataTexture / CanvasTexture / VirtualCanvas.
    const tx = t as Record<string, any>;
    const img = tx.image;
    const vc = extractPixelsFromSource(img ?? tx);
    if (vc && img?._vc) {
      return {
        buf: vc.data,
        w: vc.width,
        h: vc.height,
        ch: 4,
        isFloat: false,
        flipY: Boolean(tx.flipY),
      };
    }
    const buf = img?.data;
    const w = Number(img?.width ?? tx.width) | 0;
    const h = Number(img?.height ?? tx.height) | 0;
    if (!buf || !(w > 0 && h > 0) || !buf.length) return null;
    const n = w * h;
    const f = tx.format;
    const ch =
      f === 1021 || f === 1024 || f === 1028 || buf.length === n
        ? 1
        : f === 1025 || f === 1030 || buf.length === n * 2
          ? 2
          : f === 1022 || buf.length === n * 3
            ? 3
            : 4;
    return {
      buf,
      w,
      h,
      ch,
      isFloat:
        tx.type === 1015 ||
        tx.type === 1016 ||
        buf instanceof Float32Array ||
        buf instanceof Float64Array,
      flipY: Boolean(tx.flipY),
    };
  };

  const samplePbrByte = (
    px: RawPbrPixels,
    u: number,
    v: number,
    comp: number,
  ): number => {
    const x = Math.min(px.w - 1, Math.max(0, (u * px.w) | 0));
    const row = Math.min(px.h - 1, Math.max(0, (v * px.h) | 0));
    const y = px.flipY ? px.h - 1 - row : row;
    const raw = Number(
      px.buf[(y * px.w + x) * px.ch + Math.min(comp, px.ch - 1)] ?? 0,
    );
    if (!Number.isFinite(raw)) return 0;
    const b = px.isFloat && raw <= 1 ? raw * 255 : raw;
    return b > 0 ? (b < 255 ? (b + 0.5) | 0 : 255) : 0;
  };

  const matProto =
    threeNs.MeshStandardMaterial?.prototype &&
    (Object.getPrototypeOf(threeNs.MeshStandardMaterial.prototype) ||
      threeNs.MeshStandardMaterial.prototype);
  if (matProto && typeof matProto._packPbr !== 'function') {
    // tslint:disable-next-line:no-any Bound to Material instance.
    matProto._packPbr = function (this: any): {
      mrUri?: string;
      normUri?: string;
      normScale?: number;
    } {
      let mrUri: string | undefined;
      if (
        (this.roughnessMap || this.metalnessMap) &&
        this.roughnessMap !== this.metalnessMap
      ) {
        const pr = getPbrTexPixels(this.roughnessMap);
        const pm = getPbrTexPixels(this.metalnessMap);
        if (pr || pm) {
          const w = Math.min(128, Math.max(pr?.w ?? 1, pm?.w ?? 1));
          const h = Math.min(128, Math.max(pr?.h ?? 1, pm?.h ?? 1));
          const out = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) {
            const v = (y + 0.5) / h;
            for (let x = 0; x < w; x++) {
              const u = (x + 0.5) / w;
              const o = (y * w + x) * 4;
              out[o] = 255;
              out[o + 1] = pr ? samplePbrByte(pr, u, v, 1) : 255;
              out[o + 2] = pm ? samplePbrByte(pm, u, v, 2) : 255;
              out[o + 3] = 255;
            }
          }
          mrUri = encodeRgbaToPngDataUri(out, w, h, false, true, 128).uri;
        }
      }

      let normUri: string | undefined;
      let normScale: number | undefined;
      if (!this.normalMap && this.bumpMap) {
        const pb = getPbrTexPixels(this.bumpMap);
        if (pb) {
          const bs = Number.isFinite(this.bumpScale) ? this.bumpScale : 1;
          const w = Math.min(128, pb.w);
          const h = Math.min(128, pb.h);
          const out = new Uint8ClampedArray(w * h * 4);
          const hAt = (ix: number, iy: number): number =>
            samplePbrByte(
              pb,
              ((((ix % w) + w) % w) + 0.5) / w,
              ((((iy % h) + h) % h) + 0.5) / h,
              0,
            ) / 255;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * bs * 2;
              const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * bs * 2;
              const inv = 1 / Math.hypot(dx, dy, 1);
              const o = (y * w + x) * 4;
              out[o] = ((-dx * inv * 0.5 + 0.5) * 255 + 0.5) | 0;
              out[o + 1] = ((dy * inv * 0.5 + 0.5) * 255 + 0.5) | 0;
              out[o + 2] = ((inv * 0.5 + 0.5) * 255 + 0.5) | 0;
              out[o + 3] = 255;
            }
          }
          normUri = encodeRgbaToPngDataUri(out, w, h, false, true, 128).uri;
          normScale = 1;
        }
      }
      return {mrUri, normUri, normScale};
    };
  }

  let spriteAutoId = 0;
  const Vector2 = threeNs.Vector2;
  const PlaneGeometry = threeNs.PlaneGeometry;
  const Mesh = threeNs.Mesh;
  const Material = threeNs.Material;

  class SpriteMaterial extends Material {
    // tslint:disable-next-line:no-any Heterogeneous Three.js material options.
    rotation!: number;
    sizeAttenuation!: boolean;
    isSpriteMaterial!: boolean;
    // tslint:disable-next-line:no-any Heterogeneous Three.js material options.
    constructor(params: Record<string, any> = {}) {
      super({
        roughness: 0.85,
        metalness: 0,
        side: 2,
        transparent: params.transparent ?? true,
        ...params,
      });
      this.isSpriteMaterial = true;
      const rot = Number(params.rotation);
      this.rotation = Number.isFinite(rot) ? rot : 0;
      this.sizeAttenuation = params.sizeAttenuation !== false;
      if (params.emissive === undefined) {
        this.emissive = this.color.clone();
        this.emissiveIntensity = 0.35;
        if (this.map && !this.emissiveMap) this.emissiveMap = this.map;
      }
    }

    clone(): SpriteMaterial {
      return new SpriteMaterial({
        ...this,
        emissive: this._em ? this.emissive : undefined,
      });
    }
  }

  class Sprite extends Mesh {
    isSprite!: boolean;
    // tslint:disable-next-line:no-any Dynamic Vector2 instance from threeNs.
    center!: any;
    _autoNamed?: boolean;
    _noBillboard?: boolean;
    _bakedOwner?: Sprite;
    _bakedKey?: string;
    // tslint:disable-next-line:no-any Material instance or options bag.
    constructor(material?: any) {
      super(
        new PlaneGeometry(1, 1),
        material instanceof Material
          ? material
          : new SpriteMaterial(material || {}),
      );
      this.isSprite = true;
      this.center = new Vector2(0.5, 0.5);
      this.userData = {xr: {billboard: 'spherical'}};
    }

    _cloneCustom(): Sprite {
      const c = new Sprite(this.material);
      c.center.copy(this.center);
      c._autoNamed = Boolean(this._autoNamed);
      c._noBillboard = Boolean(this._noBillboard);
      return c;
    }

    _bakeAuthorGeometry(): void {
      if (this._bakedOwner !== this) {
        if (!this.name || this._autoNamed) {
          this.name = `Sprite_${++spriteAutoId}`;
          this._autoNamed = true;
        }
        this._bakedOwner = this;
      } else if (!this.name) {
        this.name = `Sprite_${++spriteAutoId}`;
        this._autoNamed = true;
      }
      const rawBb = this.userData?.xr?.billboard;
      if (rawBb === false || rawBb === null) {
        this._noBillboard = true;
        delete this.userData.xr.billboard;
        if (Object.keys(this.userData.xr).length === 0) delete this.userData.xr;
      } else {
        if (typeof rawBb === 'string' || rawBb === true) {
          this._noBillboard = false;
        }
        if (!this._noBillboard) {
          if (!this.userData || typeof this.userData !== 'object') {
            this.userData = {xr: {billboard: 'spherical'}};
          } else if (
            !this.userData.xr ||
            typeof this.userData.xr !== 'object'
          ) {
            this.userData.xr = {billboard: 'spherical'};
          } else if (this.userData.xr.billboard === undefined) {
            this.userData.xr.billboard = 'spherical';
          }
        }
      }
      const cx = Number.isFinite(this.center?.x) ? this.center.x : 0.5;
      const cy = Number.isFinite(this.center?.y) ? this.center.y : 0.5;
      const rotRaw = Number(this.material?.rotation);
      const rot = Number.isFinite(rotRaw) ? rotRaw : 0;
      const key = `${cx},${cy},${rot}`;
      if (
        this._bakedKey !== key &&
        (this._bakedKey !== undefined || cx !== 0.5 || cy !== 0.5 || rot !== 0)
      ) {
        const geo = new PlaneGeometry(1, 1);
        const arr = geo.attributes.position?.array as Float32Array | undefined;
        const ox = 0.5 - cx;
        const oy = 0.5 - cy;
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        if (arr) {
          for (let i = 0; i < arr.length; i += 3) {
            const px = arr[i]! + ox;
            const py = arr[i + 1]! + oy;
            arr[i] = px * cr - py * sr;
            arr[i + 1] = px * sr + py * cr;
          }
          geo.boundingBox = null;
          geo.boundingSphere = null;
        }
        geo.__baked = true;
        this._bakedKey = key;
        this.geometry = geo;
      }
    }
  }

  Object.freeze(SpriteMaterial.prototype);
  Object.freeze(Sprite.prototype);

  // =========================================================================
  // A6: 2D Curves & Exportable Scene Helpers
  // =========================================================================
  if (Vector2?.prototype) {
    // tslint:disable-next-line:no-any Dynamic Vector2 prototype methods.
    const vp: any = Vector2.prototype;
    const def = (k: string, fn: Function) => {
      if (typeof vp[k] !== 'function') vp[k] = fn;
    };
    def('length', function (this: {x: number; y: number}) {
      return Math.hypot(this.x, this.y);
    });
    // tslint:disable-next-line:no-any Dynamic Vector2 instance.
    def('normalize', function (this: any) {
      return this.divideScalar(Math.hypot(this.x, this.y) || 1);
    });
    // tslint:disable-next-line:no-any Dynamic Vector2 instances.
    def('distanceTo', function (this: any, v: any) {
      return Math.hypot(this.x - (v?.x || 0), this.y - (v?.y || 0));
    });
    // tslint:disable-next-line:no-any Dynamic Vector2 instances.
    def('dot', function (this: any, v: any) {
      return this.x * (v?.x || 0) + this.y * (v?.y || 0);
    });
    // tslint:disable-next-line:no-any Dynamic Vector2 instances.
    def('lerp', function (this: any, v: any, a: number) {
      const t = Number(a) || 0;
      return this.set(
        this.x + ((v?.x || 0) - this.x) * t,
        this.y + ((v?.y || 0) - this.y) * t,
      );
    });
    // tslint:disable-next-line:no-any Dynamic Vector2 instances.
    def('lerpVectors', function (this: any, v1: any, v2: any, a: number) {
      const t = Number(a) || 0;
      const x1 = v1?.x || 0;
      const y1 = v1?.y || 0;
      return this.set(
        x1 + ((v2?.x || 0) - x1) * t,
        y1 + ((v2?.y || 0) - y1) * t,
      );
    });
    // tslint:disable-next-line:no-any Dynamic Vector2 instances.
    def('equals', function (this: any, v: any) {
      return Boolean(v) && v.x === this.x && v.y === this.y;
    });
  }

  const finNum = (v: unknown, d = 0): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const clamp01 = (v: unknown): number =>
    Math.max(0, Math.min(1, finNum(v, 0)));
  // tslint:disable-next-line:no-any Coerce Vector2-like object to fresh Vector2.
  const toV2 = (v: any): any => new Vector2(finNum(v?.x), finNum(v?.y));

  class Curve2 {
    type!: string;
    arcLengthDivisions!: number;
    _lenCache!: number[] | null;

    constructor(type = 'Curve') {
      this.type = type;
      this.arcLengthDivisions = 200;
      this._lenCache = null;
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 target.
    getPoint(_t: number, target: any = new Vector2()): any {
      return target.set(0, 0);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 target.
    getPointAt(u: number, target?: any): any {
      return this.getPoint(this.getUtoTMapping(u), target);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 array.
    getPoints(divisions = 5): any[] {
      const divs = Math.max(1, Math.min(1024, Math.floor(finNum(divisions, 5))));
      const pts = [];
      for (let d = 0; d <= divs; d++) pts.push(this.getPoint(d / divs));
      return pts;
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 array.
    getSpacedPoints(divisions = 5): any[] {
      const divs = Math.max(1, Math.min(1024, Math.floor(finNum(divisions, 5))));
      const pts = [];
      for (let d = 0; d <= divs; d++) pts.push(this.getPointAt(d / divs));
      return pts;
    }

    getLength(): number {
      const lens = this.getLengths();
      return lens[lens.length - 1] || 0;
    }

    getLengths(divisions = this.arcLengthDivisions): number[] {
      const divs = Math.max(
        1,
        Math.min(2048, Math.floor(finNum(divisions, 200))),
      );
      if (this._lenCache && this._lenCache.length === divs + 1) {
        return this._lenCache;
      }
      const cache = [0];
      let sum = 0;
      let prev = this.getPoint(0);
      for (let p = 1; p <= divs; p++) {
        const cur = this.getPoint(p / divs);
        sum += Math.hypot(
          finNum(cur.x) - finNum(prev.x),
          finNum(cur.y) - finNum(prev.y),
          finNum(cur.z) - finNum(prev.z),
        );
        cache.push(sum);
        prev = cur;
      }
      if (divs === this.arcLengthDivisions) this._lenCache = cache;
      return cache;
    }

    updateArcLengths(): void {
      this._lenCache = null;
      this.getLengths();
    }

    getUtoTMapping(u: number, distance?: number): number {
      const arcLengths = this.getLengths();
      const il = arcLengths.length;
      const total = arcLengths[il - 1] || 0;
      if (total <= 0 || il < 2) return clamp01(u);
      const targetLen =
        distance !== undefined && Number.isFinite(Number(distance))
          ? Math.max(0, Math.min(total, Number(distance)))
          : clamp01(u) * total;
      let low = 0;
      let high = il - 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const diff = arcLengths[mid]! - targetLen;
        if (diff < 0) low = mid + 1;
        else if (diff > 0) high = mid - 1;
        else return mid / (il - 1);
      }
      const idx = Math.max(0, low - 1);
      const before = arcLengths[idx]!;
      const segLen = (arcLengths[idx + 1] ?? total) - before;
      return (idx + (segLen > 1e-12 ? (targetLen - before) / segLen : 0)) / (il - 1);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 target.
    getTangent(t: number, target?: any): any {
      const s = clamp01(t);
      const pt1 = this.getPoint(Math.max(0, s - 1e-4));
      const pt2 = this.getPoint(Math.min(1, s + 1e-4));
      const dx = finNum(pt2.x) - finNum(pt1.x);
      const dy = finNum(pt2.y) - finNum(pt1.y);
      if ('z' in pt1 || target?.isVector3) {
        const dz = finNum(pt2.z) - finNum(pt1.z);
        const l = Math.hypot(dx, dy, dz) || 1;
        return (target || new Vector3()).set(dx / l, dy / l, dz / l);
      }
      const l = Math.hypot(dx, dy) || 1;
      return (target || new Vector2()).set(dx / l, dy / l);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 target.
    getTangentAt(u: number, target?: any): any {
      return this.getTangent(this.getUtoTMapping(u), target);
    }

    clone(): this {
      // tslint:disable-next-line:no-any Polymorphic curve constructor.
      return new (this.constructor as any)().copy(this);
    }

    copy(src: this): this {
      if (!src || typeof src !== 'object') return this;
      // tslint:disable-next-line:no-any Generic deep copy for Curve2 subclasses.
      const s = src as any;
      // tslint:disable-next-line:no-any Generic deep copy for Curve2 subclasses.
      const d = this as any;
      for (const k of Object.keys(s)) {
        if (k === 'type' || k.startsWith('is')) continue;
        if (k.startsWith('_')) {
          d[k] = null;
          continue;
        }
        const val = s[k];
        if (Array.isArray(val)) {
          d[k] = val.map((it) =>
            it?.clone ? it.clone() : it && typeof it === 'object' && 'x' in it ? toV2(it) : it,
          );
        } else if (val?.clone) {
          d[k] = val.clone();
        } else if (val && typeof val === 'object' && 'x' in val) {
          d[k] = toV2(val);
        } else {
          d[k] = val;
        }
      }
      return this;
    }
  }

  class LineCurve extends Curve2 {
    isLineCurve!: boolean;
    // tslint:disable-next-line:no-any Dynamic Vector2 endpoints.
    v1!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 endpoints.
    v2!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 endpoints.
    constructor(v1?: any, v2?: any) {
      super('LineCurve');
      this.isLineCurve = true;
      this.v1 = toV2(v1);
      this.v2 = toV2(v2);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2 target.
    override getPoint(t: number, target: any = new Vector2()): any {
      const s = finNum(t, 0);
      const x1 = finNum(this.v1.x);
      const y1 = finNum(this.v1.y);
      return s === 1
        ? target.set(finNum(this.v2.x), finNum(this.v2.y))
        : target.set(x1 + (finNum(this.v2.x) - x1) * s, y1 + (finNum(this.v2.y) - y1) * s);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2 target.
    override getPointAt(u: number, target: any = new Vector2()): any {
      return this.getPoint(clamp01(u), target);
    }
  }

  class QuadraticBezierCurve extends Curve2 {
    isQuadraticBezierCurve!: boolean;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v0!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v1!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v2!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    constructor(v0?: any, v1?: any, v2?: any) {
      super('QuadraticBezierCurve');
      this.isQuadraticBezierCurve = true;
      this.v0 = toV2(v0);
      this.v1 = toV2(v1);
      this.v2 = toV2(v2);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2 target.
    override getPoint(t: number, target: any = new Vector2()): any {
      const s = clamp01(t);
      const m = 1 - s;
      return target.set(
        m * m * finNum(this.v0.x) + 2 * m * s * finNum(this.v1.x) + s * s * finNum(this.v2.x),
        m * m * finNum(this.v0.y) + 2 * m * s * finNum(this.v1.y) + s * s * finNum(this.v2.y),
      );
    }
  }

  class CubicBezierCurve extends Curve2 {
    isCubicBezierCurve!: boolean;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v0!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v1!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v2!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    v3!: any;
    // tslint:disable-next-line:no-any Dynamic Vector2 control points.
    constructor(v0?: any, v1?: any, v2?: any, v3?: any) {
      super('CubicBezierCurve');
      this.isCubicBezierCurve = true;
      this.v0 = toV2(v0);
      this.v1 = toV2(v1);
      this.v2 = toV2(v2);
      this.v3 = toV2(v3);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2 target.
    override getPoint(t: number, target: any = new Vector2()): any {
      const s = clamp01(t);
      const m = 1 - s;
      const m2 = m * m;
      const s2 = s * s;
      return target.set(
        m2 * m * finNum(this.v0.x) +
          3 * m2 * s * finNum(this.v1.x) +
          3 * m * s2 * finNum(this.v2.x) +
          s2 * s * finNum(this.v3.x),
        m2 * m * finNum(this.v0.y) +
          3 * m2 * s * finNum(this.v1.y) +
          3 * m * s2 * finNum(this.v2.y) +
          s2 * s * finNum(this.v3.y),
      );
    }
  }

  class SplineCurve extends Curve2 {
    isSplineCurve!: boolean;
    // tslint:disable-next-line:no-any Dynamic Vector2 knot list.
    points!: any[];
    // tslint:disable-next-line:no-any Dynamic Vector2 knot list.
    constructor(points: any[] = []) {
      super('SplineCurve');
      this.isSplineCurve = true;
      this.points = Array.isArray(points) ? points : [];
    }

    // tslint:disable-next-line:no-any Dynamic Vector2 target.
    override getPoint(t: number, target: any = new Vector2()): any {
      const pts = this.points;
      const n = Array.isArray(pts) ? pts.length : 0;
      if (n === 0) return target.set(0, 0);
      if (n === 1) return target.set(finNum(pts[0]?.x), finNum(pts[0]?.y));
      const p = (n - 1) * clamp01(t);
      let k = Math.floor(p);
      let w = p - k;
      if (k >= n - 1) {
        k = n - 2;
        w = 1;
      }
      const p0 = pts[k === 0 ? 0 : k - 1];
      const p1 = pts[k];
      const p2 = pts[k + 1];
      const p3 = pts[k > n - 3 ? n - 1 : k + 2];
      const w2 = w * w;
      const w3 = w2 * w;
      const cr = (v0: number, v1: number, v2: number, v3: number) =>
        0.5 *
        (2 * v1 +
          (v2 - v0) * w +
          (2 * v0 - 5 * v1 + 4 * v2 - v3) * w2 +
          (3 * v1 - v0 - 3 * v2 + v3) * w3);
      return target.set(
        cr(finNum(p0?.x), finNum(p1?.x), finNum(p2?.x), finNum(p3?.x)),
        cr(finNum(p0?.y), finNum(p1?.y), finNum(p2?.y), finNum(p3?.y)),
      );
    }
  }

  class EllipseCurve extends Curve2 {
    isEllipseCurve!: boolean;
    aX!: number;
    aY!: number;
    xRadius!: number;
    yRadius!: number;
    aStartAngle!: number;
    aEndAngle!: number;
    aClockwise!: boolean;
    aRotation!: number;

    constructor(
      aX = 0,
      aY = 0,
      xRadius = 1,
      yRadius = 1,
      aStartAngle = 0,
      aEndAngle = Math.PI * 2,
      aClockwise = false,
      aRotation = 0,
    ) {
      super('EllipseCurve');
      this.isEllipseCurve = true;
      this.aX = finNum(aX, 0);
      this.aY = finNum(aY, 0);
      this.xRadius = finNum(xRadius, 1);
      this.yRadius = finNum(yRadius, 1);
      this.aStartAngle = finNum(aStartAngle, 0);
      this.aEndAngle = finNum(aEndAngle, Math.PI * 2);
      this.aClockwise = Boolean(aClockwise);
      this.aRotation = finNum(aRotation, 0);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2 target.
    override getPoint(t: number, target: any = new Vector2()): any {
      const twoPi = Math.PI * 2;
      const start = finNum(this.aStartAngle, 0);
      let delta = finNum(this.aEndAngle, twoPi) - start;
      if (Math.abs(delta) >= 1e-9) {
        delta = ((delta % twoPi) + twoPi) % twoPi;
        if (delta < 1e-9) delta = twoPi;
        if (this.aClockwise) delta = delta === twoPi ? -twoPi : delta - twoPi;
      } else {
        delta = 0;
      }
      const angle = start + clamp01(t) * delta;
      const tx = finNum(this.xRadius, 1) * Math.cos(angle);
      const ty = finNum(this.yRadius, 1) * Math.sin(angle);
      const rot = finNum(this.aRotation, 0);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      return target.set(
        this.aX + tx * cos - ty * sin,
        this.aY + tx * sin + ty * cos,
      );
    }
  }

  class ArcCurve extends EllipseCurve {
    isArcCurve!: boolean;
    constructor(
      aX = 0,
      aY = 0,
      aRadius = 1,
      aStartAngle = 0,
      aEndAngle = Math.PI * 2,
      aClockwise = false,
    ) {
      super(aX, aY, aRadius, aRadius, aStartAngle, aEndAngle, aClockwise, 0);
      this.type = 'ArcCurve';
      this.isArcCurve = true;
    }
  }

  class CurvePath extends Curve2 {
    isCurvePath!: boolean;
    // tslint:disable-next-line:no-any Heterogeneous 2D/3D sub-curves.
    curves!: any[];
    autoClose!: boolean;
    _curveLens!: number[] | null;

    constructor() {
      super('CurvePath');
      this.isCurvePath = true;
      this.curves = [];
      this.autoClose = false;
      this._curveLens = null;
    }

    // tslint:disable-next-line:no-any Sub-curve instance.
    add(curve: any): this {
      if (curve && typeof curve.getPoint === 'function') {
        this.curves.push(curve);
        this._curveLens = null;
        this._lenCache = null;
      }
      return this;
    }

    closePath(): this {
      if (this.curves.length === 0) return this;
      const s = this.curves[0].getPoint(0);
      const e = this.curves[this.curves.length - 1].getPoint(1);
      const is3D = Boolean(s && ('z' in s || s.isVector3));
      if (
        Math.hypot(
          finNum(s?.x) - finNum(e?.x),
          finNum(s?.y) - finNum(e?.y),
          is3D ? finNum(s?.z) - finNum(e?.z) : 0,
        ) > 1e-6
      ) {
        const L3 = threeNs.LineCurve3;
        this.add(is3D && L3 ? new L3(e, s) : new LineCurve(e, s));
      }
      return this;
    }

    getCurveLengths(): number[] {
      if (this._curveLens && this._curveLens.length === this.curves.length) {
        return this._curveLens;
      }
      const lengths: number[] = [];
      let sums = 0;
      for (const c of this.curves) {
        let len = 0;
        if (typeof c?.getLength === 'function') {
          len = finNum(c.getLength(), 0);
        } else if (typeof c?.getPoints === 'function') {
          const pts = c.getPoints(32);
          for (let i = 1; i < pts.length; i++) {
            len += Math.hypot(
              finNum(pts[i]?.x) - finNum(pts[i - 1]?.x),
              finNum(pts[i]?.y) - finNum(pts[i - 1]?.y),
              finNum(pts[i]?.z) - finNum(pts[i - 1]?.z),
            );
          }
        }
        sums += len;
        lengths.push(sums);
      }
      this._curveLens = lengths;
      return lengths;
    }

    override getLength(): number {
      const lens = this.getCurveLengths();
      return lens[lens.length - 1] || 0;
    }

    override updateArcLengths(): void {
      this._curveLens = null;
      this._lenCache = null;
      for (const c of this.curves) c?.updateArcLengths?.();
      this.getCurveLengths();
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 target.
    override getPoint(t: number, optionalTarget?: any): any {
      if (this.curves.length === 0) {
        return (optionalTarget || new Vector2()).set(0, 0);
      }
      const lens = this.getCurveLengths();
      const total = lens[lens.length - 1] || 0;
      if (total <= 1e-12) return this.curves[0].getPoint(0, optionalTarget);
      const d = clamp01(t) * total;
      for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i]! || i === lens.length - 1) {
          const prev = i > 0 ? lens[i - 1]! : 0;
          const subLen = lens[i]! - prev;
          const u = subLen > 1e-12 ? (d - prev) / subLen : 0;
          const c = this.curves[i];
          return typeof c.getPointAt === 'function'
            ? c.getPointAt(u, optionalTarget)
            : c.getPoint(u, optionalTarget);
        }
      }
      return this.curves[this.curves.length - 1].getPoint(1, optionalTarget);
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 array.
    override getPoints(divisions = 12): any[] {
      const divs = Math.max(1, Math.min(1024, Math.floor(finNum(divisions, 12))));
      const points = [];
      // tslint:disable-next-line:no-any Previous point for deduplication.
      let last: any = null;
      for (const curve of this.curves) {
        const res = curve?.isEllipseCurve
          ? divs * 2
          : curve?.isLineCurve || curve instanceof (threeNs.LineCurve3 || Function)
            ? 1
            : curve?.isSplineCurve && Array.isArray(curve.points)
              ? divs * Math.max(1, curve.points.length)
              : divs;
        for (const pt of curve.getPoints(Math.min(1024, res))) {
          if (
            last &&
            Math.hypot(
              finNum(last.x) - finNum(pt.x),
              finNum(last.y) - finNum(pt.y),
              finNum(last.z) - finNum(pt.z),
            ) < 1e-6
          ) {
            continue;
          }
          points.push(pt);
          last = pt;
        }
      }
      if (this.autoClose && points.length > 1) {
        const first = points[0];
        if (
          Math.hypot(
            finNum(last.x) - finNum(first.x),
            finNum(last.y) - finNum(first.y),
            finNum(last.z) - finNum(first.z),
          ) > 1e-6
        ) {
          points.push(first.clone ? first.clone() : first);
        }
      }
      return points;
    }

    // tslint:disable-next-line:no-any Dynamic Vector2/Vector3 array.
    override getSpacedPoints(divisions = 40): any[] {
      const divs = Math.max(1, Math.min(1024, Math.floor(finNum(divisions, 40))));
      const pts = [];
      for (let i = 0; i <= divs; i++) pts.push(this.getPoint(i / divs));
      if (this.autoClose && pts.length > 0) {
        pts.push(pts[0].clone ? pts[0].clone() : pts[0]);
      }
      return pts;
    }
  }

  const BufferAttribute = threeNs.BufferAttribute;
  const Object3D = threeNs.Object3D;
  const Line = threeNs.Line;
  const LineSegments = threeNs.LineSegments;
  const LineBasicMaterial = threeNs.LineBasicMaterial;
  const MeshBasicMaterial = threeNs.MeshBasicMaterial;
  const ConeGeometry = threeNs.ConeGeometry;
  const Color = threeNs.Color;

  // tslint:disable-next-line:no-any Copy common Object3D state onto cloned helper.
  const copyObjBase = (dst: any, src: any, skipKids: number, recursive: boolean) => {
    dst.name = src.name;
    dst.position.copy(src.position);
    dst.quaternion.copy(src.quaternion);
    dst.scale.copy(src.scale);
    dst.visible = src.visible;
    dst.castShadow = src.castShadow;
    dst.receiveShadow = src.receiveShadow;
    try {
      dst.userData = JSON.parse(JSON.stringify(src.userData || {}));
    } catch {
      dst.userData = {...(src.userData || {})};
    }
    if (recursive && Array.isArray(src.children)) {
      for (let i = skipKids; i < src.children.length; i++) {
        dst.add(src.children[i].clone(true));
      }
    }
    return dst;
  };

  // tslint:disable-next-line:no-any Segment-pair BufferGeometry builder.
  const segPairGeo = (coords: number[]): any => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(coords), 3));
    g.__isSegmentPairs = true;
    return g;
  };

  const boxWireEdges = [
    0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 3, 7, 2, 6,
  ];
  // tslint:disable-next-line:no-any 12-edge AABB wireframe BufferGeometry builder.
  const boxWireGeo = (
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
  ): any => {
    if (
      !Number.isFinite(x0 + y0 + z0 + x1 + y1 + z1) ||
      x1 < x0 ||
      y1 < y0 ||
      z1 < z0
    ) {
      return new BufferGeometry();
    }
    const coords: number[] = [];
    for (const c of boxWireEdges) {
      coords.push(c & 1 ? x1 : x0, c & 2 ? y1 : y0, c & 4 ? z1 : z0);
    }
    return segPairGeo(coords);
  };

  class GridHelper extends LineSegments {
    type!: string;
    isGridHelper!: boolean;
    _size!: number;
    _divisions!: number;
    // tslint:disable-next-line:no-any Optional distinct center-crosshair child LineSegments.
    _centerLines?: any;
    _internalKids!: number;

    constructor(
      size = 10,
      divisions = 10,
      // tslint:disable-next-line:no-any Color hex, string, or Color instance.
      color1: any = 0x444444,
      // tslint:disable-next-line:no-any Color hex, string, or Color instance.
      color2: any = 0x888888,
    ) {
      const sz = Math.max(1e-4, Math.abs(finNum(size, 10)));
      const divs = Math.max(1, Math.min(256, Math.floor(finNum(divisions, 10))));
      const c1 = new Color(color1 ?? 0x444444);
      const c2 = new Color(color2 ?? 0x888888);
      const half = sz * 0.5;
      const step = sz / divs;
      const split = divs % 2 === 0 && c1.getHex() !== c2.getHex() ? divs >> 1 : -1;
      const minor: number[] = [];
      const major: number[] = [];
      for (let i = 0, k = -half; i <= divs; i++, k += step) {
        (i === split ? major : minor).push(
          -half, 0, k, half, 0, k, k, 0, -half, k, 0, half,
        );
      }
      super(
        segPairGeo(minor.length ? minor : major),
        new LineBasicMaterial({color: minor.length ? c2 : c1}),
      );
      this.type = 'GridHelper';
      this.isGridHelper = true;
      this._size = sz;
      this._divisions = divs;
      this._internalKids = 0;
      if (major.length && minor.length) {
        const cl = new LineSegments(segPairGeo(major), new LineBasicMaterial({color: c1}));
        this._centerLines = cl;
        this._internalKids = 1;
        this.add(cl);
      }
    }

    override _bakeAuthorGeometry(): void {
      if (this._centerLines?.material && this.material) {
        this._centerLines.material.transparent = this.material.transparent;
        this._centerLines.material.opacity = this.material.opacity;
      }
      super._bakeAuthorGeometry();
    }

    override clone(recursive = true): this {
      const c = new GridHelper(
        this._size,
        this._divisions,
        this._centerLines ? this._centerLines.material.color : this.material.color,
        this.material.color,
      );
      c.material.transparent = this.material.transparent;
      c.material.opacity = this.material.opacity;
      return copyObjBase(c, this, this._internalKids, recursive);
    }

    dispose(): void {}
  }

  class AxesHelper extends LineSegments {
    type!: string;
    isAxesHelper!: boolean;
    _size!: number;
    // tslint:disable-next-line:no-any +Y and +Z child LineSegments.
    _yAxis!: any;
    // tslint:disable-next-line:no-any +Y and +Z child LineSegments.
    _zAxis!: any;

    constructor(size = 1) {
      const s = Math.max(1e-4, Math.abs(finNum(size, 1)));
      super(segPairGeo([0, 0, 0, s, 0, 0]), new LineBasicMaterial({color: 0xff3300}));
      this.type = 'AxesHelper';
      this.isAxesHelper = true;
      this._size = s;
      this._yAxis = new LineSegments(
        segPairGeo([0, 0, 0, 0, s, 0]),
        new LineBasicMaterial({color: 0x33ff00}),
      );
      this._zAxis = new LineSegments(
        segPairGeo([0, 0, 0, 0, 0, s]),
        new LineBasicMaterial({color: 0x0088ff}),
      );
      this.add(this._yAxis);
      this.add(this._zAxis);
    }

    // tslint:disable-next-line:no-any Color hex, string, or Color instance.
    setColors(xColor: any, yColor: any, zColor: any): this {
      this.material.color.set(xColor);
      this._yAxis.material.color.set(yColor);
      this._zAxis.material.color.set(zColor);
      return this;
    }

    override _bakeAuthorGeometry(): void {
      for (const ch of [this._yAxis, this._zAxis]) {
        if (ch?.material && this.material) {
          ch.material.transparent = this.material.transparent;
          ch.material.opacity = this.material.opacity;
        }
      }
      super._bakeAuthorGeometry();
    }

    override clone(recursive = true): this {
      const c = new AxesHelper(this._size).setColors(
        this.material.color,
        this._yAxis.material.color,
        this._zAxis.material.color,
      );
      c.material.transparent = this.material.transparent;
      c.material.opacity = this.material.opacity;
      return copyObjBase(c, this, 2, recursive);
    }

    dispose(): void {}
  }

  class ArrowHelper extends Object3D {
    type!: string;
    isArrowHelper!: boolean;
    // tslint:disable-next-line:no-any Shaft Line child.
    line!: any;
    // tslint:disable-next-line:no-any Head Cone Mesh child.
    cone!: any;

    constructor(
      // tslint:disable-next-line:no-any Direction Vector3.
      dir: any = new Vector3(0, 0, 1),
      // tslint:disable-next-line:no-any Origin Vector3.
      origin: any = new Vector3(0, 0, 0),
      length = 1,
      // tslint:disable-next-line:no-any Color hex, string, or Color instance.
      color: any = 0xffff00,
      headLength?: number,
      headWidth?: number,
    ) {
      super();
      this.type = 'ArrowHelper';
      this.isArrowHelper = true;
      this.position.set(finNum(origin?.x), finNum(origin?.y), finNum(origin?.z));
      const lg = new BufferGeometry();
      lg.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 1, 0]), 3));
      this.line = new Line(lg, new LineBasicMaterial({color}));
      this.cone = new Mesh(
        new ConeGeometry(0.5, 1, 8).translate(0, -0.5, 0),
        new MeshBasicMaterial({color}),
      );
      this.add(this.line);
      this.add(this.cone);
      this.setDirection(dir).setLength(length, headLength, headWidth);
    }

    // tslint:disable-next-line:no-any Direction Vector3.
    setDirection(dir: any): this {
      const dx = finNum(dir?.x, 0);
      const dy = finNum(dir?.y, 0);
      const dz = finNum(dir?.z, 1);
      const len = Math.hypot(dx, dy, dz);
      const nx = len > 1e-9 ? dx / len : 0;
      const ny = len > 1e-9 ? dy / len : 1;
      const nz = len > 1e-9 ? dz / len : 0;
      if (ny > 0.99999) this.quaternion.set(0, 0, 0, 1);
      else if (ny < -0.99999) this.quaternion.set(1, 0, 0, 0);
      else {
        this.quaternion.setFromAxisAngle(
          new Vector3(nz, 0, -nx).normalize(),
          Math.acos(Math.max(-1, Math.min(1, ny))),
        );
      }
      return this;
    }

    setLength(length: number, headLength?: number, headWidth?: number): this {
      const len = Math.max(1e-4, Math.abs(finNum(length, 1)));
      const hl =
        headLength !== undefined && Number.isFinite(Number(headLength))
          ? Math.max(1e-4, Math.abs(Number(headLength)))
          : 0.2 * len;
      const hw =
        headWidth !== undefined && Number.isFinite(Number(headWidth))
          ? Math.max(1e-4, Math.abs(Number(headWidth)))
          : 0.2 * hl;
      this.line.scale.set(1, Math.max(1e-4, len - hl), 1);
      this.line.updateMatrix?.();
      this.cone.scale.set(hw, hl, hw);
      this.cone.position.set(0, len, 0);
      this.cone.updateMatrix?.();
      return this;
    }

    // tslint:disable-next-line:no-any Color hex, string, or Color instance.
    setColor(color: any): this {
      this.line.material.color.set(color);
      this.cone.material.color.set(color);
      return this;
    }

    override clone(recursive = true): this {
      const c = new ArrowHelper();
      c.line.scale.copy(this.line.scale);
      c.cone.scale.copy(this.cone.scale);
      c.cone.position.copy(this.cone.position);
      c.setColor(this.cone.material.color);
      c.line.material.transparent = this.line.material.transparent;
      c.line.material.opacity = this.line.material.opacity;
      c.cone.material.transparent = this.cone.material.transparent;
      c.cone.material.opacity = this.cone.material.opacity;
      return copyObjBase(c, this, 2, recursive);
    }

    dispose(): void {}
  }

  class Box3Helper extends LineSegments {
    type!: string;
    isBox3Helper!: boolean;
    box!: Box3;

    // tslint:disable-next-line:no-any Box3 + Color arguments.
    constructor(box: Box3 = new Box3(), color: any = 0xffff00) {
      const b = box instanceof Box3 ? box : new Box3(box?.min, box?.max);
      super(
        b.isEmpty()
          ? new BufferGeometry()
          : boxWireGeo(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z),
        new LineBasicMaterial({color}),
      );
      this.type = 'Box3Helper';
      this.isBox3Helper = true;
      this.box = b;
    }

    override _bakeAuthorGeometry(): void {
      const b = this.box;
      const g =
        !b || b.isEmpty()
          ? new BufferGeometry()
          : boxWireGeo(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
      this._sourceGeo = g;
      this.geometry = g;
      super._bakeAuthorGeometry();
    }

    override clone(recursive = true): this {
      const c = new Box3Helper(this.box.clone(), this.material.color);
      c.material.transparent = this.material.transparent;
      c.material.opacity = this.material.opacity;
      return copyObjBase(c, this, 0, recursive);
    }

    dispose(): void {}
  }

  class BoxHelper extends LineSegments {
    type!: string;
    isBoxHelper!: boolean;
    // tslint:disable-next-line:no-any Target Object3D being framed.
    object!: any;

    // tslint:disable-next-line:no-any Object3D + Color arguments.
    constructor(object?: any, color: any = 0xffff00) {
      super(new BufferGeometry(), new LineBasicMaterial({color}));
      this.type = 'BoxHelper';
      this.isBoxHelper = true;
      this.object = object;
      if (object) this.update();
    }

    // tslint:disable-next-line:no-any Optional updated target Object3D.
    update(object?: any): this {
      if (object !== undefined) this.object = object;
      const b = new Box3();
      if (this.object && this.object !== this) b.setFromObject(this.object);
      const g = b.isEmpty()
        ? new BufferGeometry()
        : boxWireGeo(b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z);
      this.position.set(0, 0, 0);
      this.quaternion.set(0, 0, 0, 1);
      this.scale.set(1, 1, 1);
      this._sourceGeo = g;
      this.geometry = g;
      return this;
    }

    // tslint:disable-next-line:no-any Target Object3D.
    setFromObject(object: any): this {
      return this.update(object);
    }

    override _bakeAuthorGeometry(): void {
      this.update();
      super._bakeAuthorGeometry();
    }

    override clone(recursive = true): this {
      const c = new BoxHelper(this.object, this.material.color);
      c.material.transparent = this.material.transparent;
      c.material.opacity = this.material.opacity;
      return copyObjBase(c, this, 0, recursive);
    }

    dispose(): void {}
  }

  for (const cls of [
    Curve2,
    LineCurve,
    QuadraticBezierCurve,
    CubicBezierCurve,
    SplineCurve,
    EllipseCurve,
    ArcCurve,
    CurvePath,
    GridHelper,
    AxesHelper,
    ArrowHelper,
    Box3Helper,
    BoxHelper,
  ]) {
    Object.freeze(cls.prototype);
  }

  const exportsMap = {
    Box3,
    Sphere,
    CanvasTexture,
    ImprovedNoise,
    SimplexNoise,
    SpriteMaterial,
    Sprite,
    LineCurve,
    QuadraticBezierCurve,
    CubicBezierCurve,
    SplineCurve,
    EllipseCurve,
    ArcCurve,
    CurvePath,
    GridHelper,
    AxesHelper,
    ArrowHelper,
    Box3Helper,
    BoxHelper,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, exportsMap);
    reg.createCanvas = createCanvas;
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` plugin registering `Box3`, `Sphere`, and
 * procedural authoring utilities onto `THREE` and worker sandboxes.
 */
export const proceduralPlugin: ThreeLivePlugin = {
  name: 'procedural',
  onRegister(): void {
    registerWorkerExtensionInstaller(installProceduralExtension);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installProceduralExtension(threeNs, reg);
    }
  },
};
