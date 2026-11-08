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
 * @fileoverview Extended Three.js bounding volumes (`Box3`, `Sphere`) and
 * procedural authoring utilities (`proceduralPlugin`).
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
    setFromObject(object: any, precise = false): this {
      return this.makeEmpty().expandByObject(object, precise);
    }

    // tslint:disable-next-line:no-any Dynamic Object3D instance.
    expandByObject(object: any, precise = false): this {
      if (!object) return this;
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
            this.expandByPoint(v);
          }
        } else {
          const localBox = new Box3().setFromBufferAttribute(pos);
          if (!localBox.isEmpty()) {
            this.union(scratchBox.copy(localBox).applyMatrix4(m));
          }
        }
      };

      // tslint:disable-next-line:no-any Dynamic Object3D hierarchy.
      const visit = (node: any) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);
        reg?.materializeDeclarativeGeometry?.(node);
        const geo = node.geometry;
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

  const exportsMap = {
    Box3,
    Sphere,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, exportsMap);
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
