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
 * Ultra-lightweight Three.js API-compatible compiler with 1:1 Canvas3D parity.
 * Compiles procedural Three.js scene graphs directly into Canvas3D GPU buffers
 * or binary glTF 2.0 (.glb) files.
 *
 * Features:
 * - Full Math primitives: Vector2, Vector3, Vector4, Euler, Quaternion, Matrix4, Matrix3, Color.
 * - Standard Geometries: BufferGeometry, Box, Sphere, Plane, Cylinder, Cone, Torus, TorusKnot.
 * - PBR Materials: MeshStandardMaterial + aliases (Basic, Lambert, Phong, Physical).
 * - Dynamic Lights: AmbientLight, DirectionalLight, PointLight (KHR_lights_punctual).
 * - Option B Reactive Transforms: 60 FPS transform mutations via scene.getMeshTransforms().
 * - Universal Chaining Proxy: Safely stubs unsupported Three.js symbols with zero crashes.
 * - Dual Exporter: scene.toCanvas3D() in-memory AST (0 ms) & scene.toGLB() binary writer.
 */

import {getSharedRegistry} from './plugin';
import {
  generateUSDZ,
  glbToUSDZ,
  sceneToCanvas3D,
  sceneToGLB,
  sceneToUSDZ,
} from './three-convert';
import {
  type GLBData,
  mat3NormalFromMat4,
  mat4FromRotationTranslationScale,
  mat4LookAt,
  mat4Multiply,
} from './three-view';

declare const SECURITY_3D_MAX_CONCURRENT_TASKS: number;
declare const SECURITY_3D_MAX_HEAP_BYTES: number;
declare const SECURITY_3D_MAX_INDICES: number;
declare const SECURITY_3D_MAX_MESHES: number;
declare const SECURITY_3D_MAX_SCRIPT_BYTES: number;
declare const SECURITY_3D_MAX_TEXTURES: number;
declare const SECURITY_3D_MAX_TEXTURE_DIMENSION: number;
declare const SECURITY_3D_MAX_VERTICES: number;
declare const SECURITY_3D_SANDBOX_TIMEOUT_MS: number;

// Compile-time feature flags configured via esbuild --define
declare const ENABLE_NATIVE_HOOKS: boolean;
declare const ENABLE_SERVER_EXTRACT: boolean;

// =========================================================================
// 1. Core Math Foundation
// =========================================================================

export class Vector2 {
  public x: number;
  public y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = Number(x);
    this.y = Number(y);
  }

  public set(x: number, y: number): this {
    this.x = Number(x);
    this.y = Number(y);
    return this;
  }

  public clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  public copy(v: Vector2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  public add(v: Vector2): this {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  public sub(v: Vector2): this {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  public multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }
}

export class Vector3 {
  public x: number;
  public y: number;
  public z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
  }

  public set(x: number, y: number, z: number): this {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
    return this;
  }

  public clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  public copy(v: {x: number; y: number; z: number}): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  public add(v: Vector3): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  public addVectors(a: Vector3, b: Vector3): this {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }

  public sub(v: Vector3): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  public subVectors(a: Vector3, b: Vector3): this {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  public multiplyScalar(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  public length(): number {
    return Math.hypot(this.x, this.y, this.z);
  }

  public normalize(): this {
    const l = this.length();
    if (l > 0.00001) {
      this.x /= l;
      this.y /= l;
      this.z /= l;
    }
    return this;
  }

  public cross(v: Vector3): this {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  public crossVectors(a: Vector3, b: Vector3): this {
    const ax = a.x,
      ay = a.y,
      az = a.z;
    const bx = b.x,
      by = b.y,
      bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }

  public dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  public distanceTo(v: Vector3): number {
    return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  public applyMatrix4(m: Matrix4): this {
    const x = this.x,
      y = this.y,
      z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
}

export class Vector4 {
  public x: number;
  public y: number;
  public z: number;
  public w: number;

  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
    this.w = Number(w);
  }

  public set(x: number, y: number, z: number, w: number): this {
    this.x = Number(x);
    this.y = Number(y);
    this.z = Number(z);
    this.w = Number(w);
    return this;
  }
}

export class Euler {
  private _x: number;
  private _y: number;
  private _z: number;
  public order: string;
  public _onChangeCallback: (() => void) | null = null;

  constructor(
    x: number = 0,
    y: number = 0,
    z: number = 0,
    order: string = 'XYZ',
  ) {
    this._x = Number(x);
    this._y = Number(y);
    this._z = Number(z);
    this.order = order;
  }

  get x(): number {
    return this._x;
  }
  set x(val: number) {
    this._x = Number(val);
    this._onChangeCallback?.();
  }

  get y(): number {
    return this._y;
  }
  set y(val: number) {
    this._y = Number(val);
    this._onChangeCallback?.();
  }

  get z(): number {
    return this._z;
  }
  set z(val: number) {
    this._z = Number(val);
    this._onChangeCallback?.();
  }

  public set(
    x: number,
    y: number,
    z: number,
    order: string = this.order,
  ): this {
    this._x = Number(x);
    this._y = Number(y);
    this._z = Number(z);
    this.order = order;
    this._onChangeCallback?.();
    return this;
  }

  public copy(e: Euler): this {
    this._x = e.x;
    this._y = e.y;
    this._z = e.z;
    this.order = e.order;
    this._onChangeCallback?.();
    return this;
  }

  public clone(): Euler {
    return new Euler(this._x, this._y, this._z, this.order);
  }

  public _onChange(cb: () => void): this {
    this._onChangeCallback = cb;
    return this;
  }
}

export class Quaternion {
  private _x: number;
  private _y: number;
  private _z: number;
  private _w: number;
  public _onChangeCallback: (() => void) | null = null;

  constructor(x: number = 0, y: number = 0, z: number = 0, w: number = 1) {
    this._x = Number(x);
    this._y = Number(y);
    this._z = Number(z);
    this._w = Number(w);
  }

  get x(): number {
    return this._x;
  }
  set x(val: number) {
    this._x = Number(val);
    this._onChangeCallback?.();
  }

  get y(): number {
    return this._y;
  }
  set y(val: number) {
    this._y = Number(val);
    this._onChangeCallback?.();
  }

  get z(): number {
    return this._z;
  }
  set z(val: number) {
    this._z = Number(val);
    this._onChangeCallback?.();
  }

  get w(): number {
    return this._w;
  }
  set w(val: number) {
    this._w = Number(val);
    this._onChangeCallback?.();
  }

  public set(x: number, y: number, z: number, w: number): this {
    this._x = Number(x);
    this._y = Number(y);
    this._z = Number(z);
    this._w = Number(w);
    this._onChangeCallback?.();
    return this;
  }

  public copy(q: Quaternion): this {
    this._x = q.x;
    this._y = q.y;
    this._z = q.z;
    this._w = q.w;
    this._onChangeCallback?.();
    return this;
  }

  public clone(): Quaternion {
    return new Quaternion(this._x, this._y, this._z, this._w);
  }

  public setFromEuler(euler: Euler, update: boolean = true): this {
    const x = euler.x,
      y = euler.y,
      z = euler.z;
    const c1 = Math.cos(x / 2),
      c2 = Math.cos(y / 2),
      c3 = Math.cos(z / 2);
    const s1 = Math.sin(x / 2),
      s2 = Math.sin(y / 2),
      s3 = Math.sin(z / 2);

    this._x = s1 * c2 * c3 + c1 * s2 * s3;
    this._y = c1 * s2 * c3 - s1 * c2 * s3;
    this._z = c1 * c2 * s3 + s1 * s2 * c3;
    this._w = c1 * c2 * c3 - s1 * s2 * s3;

    if (update) this._onChangeCallback?.();
    return this;
  }

  public setFromAxisAngle(axis: Vector3, angle: number): this {
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);
    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(halfAngle);
    this._onChangeCallback?.();
    return this;
  }

  public multiply(q: Quaternion): this {
    return this.multiplyQuaternions(this, q);
  }

  public multiplyQuaternions(a: Quaternion, b: Quaternion): this {
    const qax = a.x,
      qay = a.y,
      qaz = a.z,
      qaw = a.w;
    const qbx = b.x,
      qby = b.y,
      qbz = b.z,
      qbw = b.w;
    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._onChangeCallback?.();
    return this;
  }

  public _onChange(cb: () => void): this {
    this._onChangeCallback = cb;
    return this;
  }
}

export class Matrix4 {
  public elements: Float32Array;

  constructor() {
    this.elements = new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]);
  }

  public identity(): this {
    const e = this.elements;
    e.fill(0);
    e[0] = 1;
    e[5] = 1;
    e[10] = 1;
    e[15] = 1;
    return this;
  }

  public copy(m: Matrix4): this {
    this.elements.set(m.elements);
    return this;
  }

  public clone(): Matrix4 {
    const m = new Matrix4();
    m.copy(this);
    return m;
  }

  public compose(pos: Vector3, quat: Quaternion, scale: Vector3): this {
    mat4FromRotationTranslationScale(
      this.elements,
      [quat.x, quat.y, quat.z, quat.w],
      [pos.x, pos.y, pos.z],
      [scale.x, scale.y, scale.z],
    );
    return this;
  }

  public multiply(m: Matrix4): this {
    return this.multiplyMatrices(this, m);
  }

  public multiplyMatrices(a: Matrix4, b: Matrix4): this {
    mat4Multiply(this.elements, a.elements, b.elements);
    return this;
  }

  public lookAt(eye: Vector3, target: Vector3, up: Vector3): this {
    mat4LookAt(
      this.elements,
      [eye.x, eye.y, eye.z],
      [target.x, target.y, target.z],
      [up.x, up.y, up.z],
    );
    return this;
  }

  public makeRotationFromQuaternion(q: Quaternion): this {
    const zero = new Vector3(0, 0, 0);
    const one = new Vector3(1, 1, 1);
    return this.compose(zero, q, one);
  }

  public makeTranslation(x: number, y: number, z: number): this {
    this.identity();
    this.elements[12] = Number(x);
    this.elements[13] = Number(y);
    this.elements[14] = Number(z);
    return this;
  }

  public makeScale(x: number, y: number, z: number): this {
    this.identity();
    this.elements[0] = Number(x);
    this.elements[5] = Number(y);
    this.elements[10] = Number(z);
    return this;
  }
}

export class Matrix3 {
  public elements: Float32Array;

  constructor() {
    this.elements = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }

  public identity(): this {
    const e = this.elements;
    e.fill(0);
    e[0] = 1;
    e[4] = 1;
    e[8] = 1;
    return this;
  }

  public getNormalMatrix(matrix4: Matrix4): this {
    mat3NormalFromMat4(this.elements, matrix4.elements);
    return this;
  }
}

export class Color {
  public r: number = 1;
  public g: number = 1;
  public b: number = 1;

  constructor(r?: any, g?: number, b?: number) {
    if (r !== undefined) {
      if (g !== undefined && b !== undefined) {
        this.setRGB(r, g, b);
      } else {
        this.set(r);
      }
    }
  }

  public set(val: any): this {
    if (typeof val === 'number') {
      this.setHex(val);
    } else if (typeof val === 'string') {
      if (val.startsWith('#')) {
        const hex = parseInt(val.slice(1), 16);
        this.setHex(hex);
      } else if (val === 'red') {
        this.setRGB(1, 0, 0);
      } else if (val === 'green') {
        this.setRGB(0, 1, 0);
      } else if (val === 'blue') {
        this.setRGB(0, 0, 1);
      } else if (val === 'white') {
        this.setRGB(1, 1, 1);
      } else if (val === 'black') {
        this.setRGB(0, 0, 0);
      }
    } else if (val && typeof val === 'object' && 'r' in val) {
      this.r = Number(val.r);
      this.g = Number(val.g);
      this.b = Number(val.b);
    }
    return this;
  }

  public setHex(hex: number): this {
    const h = Math.floor(hex);
    this.r = ((h >> 16) & 255) / 255;
    this.g = ((h >> 8) & 255) / 255;
    this.b = (h & 255) / 255;
    return this;
  }

  public setRGB(r: number, g: number, b: number): this {
    this.r = Number(r);
    this.g = Number(g);
    this.b = Number(b);
    return this;
  }

  public getHex(): number {
    return (
      (Math.round(Math.max(0, Math.min(1, this.r)) * 255) << 16) |
      (Math.round(Math.max(0, Math.min(1, this.g)) * 255) << 8) |
      Math.round(Math.max(0, Math.min(1, this.b)) * 255)
    );
  }

  public getHexString(): string {
    return ('000000' + this.getHex().toString(16)).slice(-6);
  }

  public copy(c: Color): this {
    this.r = c.r;
    this.g = c.g;
    this.b = c.b;
    return this;
  }

  public equals(c: Color): boolean {
    return c.r === this.r && c.g === this.g && c.b === this.b;
  }

  public clone(): Color {
    return new Color(this.r, this.g, this.b);
  }
}

export const MathUtils = {
  degToRad: (deg: number) => (deg * Math.PI) / 180,
  radToDeg: (rad: number) => (rad * 180) / Math.PI,
  clamp: (val: number, min: number, max: number) =>
    Math.max(min, Math.min(max, val)),
  lerp: (x: number, y: number, t: number) => x + (y - x) * t,
  generateUUID: () => Math.random().toString(36).substring(2, 15),
  randFloat: (low: number, high: number) => low + Math.random() * (high - low),
};

// =========================================================================
// 2. Buffer Geometry & Attributes
// =========================================================================

export class BufferAttribute {
  public array: Float32Array | Uint16Array | Uint32Array;
  public itemSize: number;
  public count: number;
  public needsUpdate: boolean = false;

  constructor(array: any, itemSize: number) {
    // `count` is derived from `itemSize`, and every geometry quota is derived
    // from `count`. A non-finite or non-positive `itemSize` therefore poisons
    // the quota arithmetic: `NaN > MAX` is false, so the ceilings stop firing
    // entirely. Reject bad values here rather than propagating them.
    if (
      typeof itemSize !== 'number' ||
      !Number.isInteger(itemSize) ||
      itemSize < 1 ||
      itemSize > 16
    ) {
      throw new Error(
        `SecurityError: BufferAttribute itemSize must be an integer in [1, 16]. Received: ${String(itemSize)}`,
      );
    }

    if (Array.isArray(array)) {
      this.array = new Float32Array(array);
    } else {
      this.array = array;
    }
    this.itemSize = itemSize;

    const length = this.array ? this.array.length : 0;
    if (!Number.isFinite(length) || length < 0) {
      throw new Error(
        `SecurityError: BufferAttribute array has a non-finite length: ${String(length)}`,
      );
    }
    this.count = Math.floor(length / itemSize);
  }

  public getX(index: number): number {
    return this.array[index * this.itemSize];
  }
  public getY(index: number): number {
    return this.array[index * this.itemSize + 1];
  }
  public getZ(index: number): number {
    return this.array[index * this.itemSize + 2];
  }

  public setX(index: number, x: number): this {
    this.array[index * this.itemSize] = x;
    this.needsUpdate = true;
    return this;
  }

  public setY(index: number, y: number): this {
    this.array[index * this.itemSize + 1] = y;
    this.needsUpdate = true;
    return this;
  }

  public setZ(index: number, z: number): this {
    this.array[index * this.itemSize + 2] = z;
    this.needsUpdate = true;
    return this;
  }

  public setXYZ(index: number, x: number, y: number, z: number): this {
    const offset = index * this.itemSize;
    this.array[offset] = x;
    this.array[offset + 1] = y;
    this.array[offset + 2] = z;
    this.needsUpdate = true;
    return this;
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: any, itemSize: number) {
    super(
      array instanceof Float32Array ? array : new Float32Array(array),
      itemSize,
    );
  }
}

export class Uint16BufferAttribute extends BufferAttribute {
  constructor(array: any, itemSize: number) {
    super(
      array instanceof Uint16Array ? array : new Uint16Array(array),
      itemSize,
    );
  }
}

export class Uint32BufferAttribute extends BufferAttribute {
  constructor(array: any, itemSize: number) {
    super(
      array instanceof Uint32Array ? array : new Uint32Array(array),
      itemSize,
    );
  }
}

export class BufferGeometry {
  public name: string = '';
  public attributes: Record<string, BufferAttribute> = {};
  public index: BufferAttribute | null = null;
  public boundingBox: {min: Vector3; max: Vector3} | null = null;

  public setAttribute(name: string, attribute: BufferAttribute): this {
    this.attributes[name] = attribute;
    return this;
  }

  public getAttribute(name: string): BufferAttribute | undefined {
    return this.attributes[name];
  }

  public setIndex(indices: any): this {
    if (indices instanceof BufferAttribute) {
      this.index = indices;
    } else if (Array.isArray(indices)) {
      let maxIdx = 0;
      for (let i = 0; i < indices.length; i++) {
        if (indices[i] > maxIdx) maxIdx = indices[i];
      }
      const typed =
        maxIdx > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
      this.index = new BufferAttribute(typed, 1);
    } else if (indices && indices.buffer) {
      this.index = new BufferAttribute(indices, 1);
    }
    return this;
  }

  public computeVertexNormals(): this {
    const pos = this.attributes.position;
    if (!pos) return this;
    const count = pos.count;
    const normals = new Float32Array(count * 3);

    const vA = new Vector3(),
      vB = new Vector3(),
      vC = new Vector3();
    const cb = new Vector3(),
      ab = new Vector3();

    if (this.index) {
      const idx = this.index.array;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i],
          b = idx[i + 1],
          c = idx[i + 2];
        vA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
        vB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
        vC.set(pos.getX(c), pos.getY(c), pos.getZ(c));

        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab).normalize();

        for (const vi of [a, b, c]) {
          normals[vi * 3] += cb.x;
          normals[vi * 3 + 1] += cb.y;
          normals[vi * 3 + 2] += cb.z;
        }
      }
    } else {
      for (let i = 0; i < count; i += 3) {
        vA.set(pos.getX(i), pos.getY(i), pos.getZ(i));
        vB.set(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
        vC.set(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab).normalize();

        for (let j = 0; j < 3; j++) {
          normals[(i + j) * 3] = cb.x;
          normals[(i + j) * 3 + 1] = cb.y;
          normals[(i + j) * 3 + 2] = cb.z;
        }
      }
    }

    // Normalize generated normals
    for (let i = 0; i < count; i++) {
      const x = normals[i * 3],
        y = normals[i * 3 + 1],
        z = normals[i * 3 + 2];
      const len = Math.hypot(x, y, z) || 1.0;
      normals[i * 3] = x / len;
      normals[i * 3 + 1] = y / len;
      normals[i * 3 + 2] = z / len;
    }

    this.setAttribute('normal', new BufferAttribute(normals, 3));
    return this;
  }

  public setFromBuffers(
    positions: ArrayLike<number>,
    normals: ArrayLike<number>,
    uvs: ArrayLike<number>,
    indices: ArrayLike<number>,
  ): void {
    this.setAttribute(
      'position',
      new BufferAttribute(
        positions instanceof Float32Array
          ? positions
          : new Float32Array(positions),
        3,
      ),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(
        normals instanceof Float32Array ? normals : new Float32Array(normals),
        3,
      ),
    );
    this.setAttribute(
      'uv',
      new BufferAttribute(
        uvs instanceof Float32Array ? uvs : new Float32Array(uvs),
        2,
      ),
    );
    this.setIndex(indices);
  }

  public dispose(): void {}
}

// =========================================================================
// 3. Procedural Geometries
// =========================================================================

export class BoxGeometry extends BufferGeometry {
  constructor(width: number = 1, height: number = 1, depth: number = 1) {
    super();
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_box__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(width, height, depth);
        this.setFromBuffers(
          native.positions,
          native.normals,
          native.uvs,
          native.indices,
        );
        return;
      }
    }
    const w2 = width / 2,
      h2 = height / 2,
      d2 = depth / 2;
    const positions = [
      // +Z
      -w2,
      -h2,
      d2,
      w2,
      -h2,
      d2,
      w2,
      h2,
      d2,
      -w2,
      h2,
      d2,
      // -Z
      w2,
      -h2,
      -d2,
      -w2,
      -h2,
      -d2,
      -w2,
      h2,
      -d2,
      w2,
      h2,
      -d2,
      // +Y
      -w2,
      h2,
      d2,
      w2,
      h2,
      d2,
      w2,
      h2,
      -d2,
      -w2,
      h2,
      -d2,
      // -Y
      -w2,
      -h2,
      -d2,
      w2,
      -h2,
      -d2,
      w2,
      -h2,
      d2,
      -w2,
      -h2,
      d2,
      // +X
      w2,
      -h2,
      d2,
      w2,
      -h2,
      -d2,
      w2,
      h2,
      -d2,
      w2,
      h2,
      d2,
      // -X
      -w2,
      -h2,
      -d2,
      -w2,
      -h2,
      d2,
      -w2,
      h2,
      d2,
      -w2,
      h2,
      -d2,
    ];
    const normals = [
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 0,
    ];
    const uvs = [
      0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0,
      0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
    ];
    const indices: number[] = [];
    for (let f = 0; f < 6; f++) {
      const o = f * 4;
      indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(width: number = 1, height: number = 1) {
    super();
    const w2 = width / 2,
      h2 = height / 2;
    const positions = [-w2, h2, 0, w2, h2, 0, -w2, -h2, 0, w2, -h2, 0];
    const normals = [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
    const uvs = [0, 1, 1, 1, 0, 0, 1, 0];
    const indices = [0, 2, 1, 2, 3, 1];
    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(
    radius: number = 1,
    widthSegments: number = 16,
    heightSegments: number = 12,
  ) {
    super();
    widthSegments = Math.max(3, Math.floor(widthSegments));
    heightSegments = Math.max(2, Math.floor(heightSegments));
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_sphere__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(radius, widthSegments, heightSegments);
        this.setAttribute('position', new BufferAttribute(native.positions, 3));
        this.setAttribute('normal', new BufferAttribute(native.normals, 3));
        this.setAttribute('uv', new BufferAttribute(native.uvs, 2));
        this.setIndex(native.indices);
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const grid: number[][] = [];

    for (let iy = 0; iy <= heightSegments; iy++) {
      const row: number[] = [];
      const v = iy / heightSegments;
      for (let ix = 0; ix <= widthSegments; ix++) {
        const u = ix / widthSegments;
        const theta = u * Math.PI * 2;
        const phi = v * Math.PI;
        const x = -radius * Math.cos(theta) * Math.sin(phi);
        const y = radius * Math.cos(phi);
        const z = radius * Math.sin(theta) * Math.sin(phi);
        positions.push(x, y, z);
        const len = Math.hypot(x, y, z) || 1.0;
        normals.push(x / len, y / len, z / len);
        uvs.push(u, 1 - v);
        row.push(positions.length / 3 - 1);
      }
      grid.push(row);
    }

    for (let iy = 0; iy < heightSegments; iy++) {
      for (let ix = 0; ix < widthSegments; ix++) {
        const a = grid[iy][ix + 1];
        const b = grid[iy][ix];
        const c = grid[iy + 1][ix];
        const d = grid[iy + 1][ix + 1];
        if (iy !== 0) indices.push(a, b, d);
        if (iy !== heightSegments - 1) indices.push(b, c, d);
      }
    }

    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(
    radiusTop: number = 1,
    radiusBottom: number = 1,
    height: number = 1,
    radialSegments: number = 16,
  ) {
    super();
    radialSegments = Math.max(3, Math.floor(radialSegments));
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_cylinder__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(
          radiusTop,
          radiusBottom,
          height,
          radialSegments,
        );
        this.setAttribute('position', new BufferAttribute(native.positions, 3));
        this.setAttribute('normal', new BufferAttribute(native.normals, 3));
        this.setAttribute('uv', new BufferAttribute(native.uvs, 2));
        this.setIndex(native.indices);
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const halfHeight = height / 2;

    for (let y = 0; y <= 1; y++) {
      const v = y;
      const radius = y === 0 ? radiusTop : radiusBottom;
      const py = y === 0 ? halfHeight : -halfHeight;
      for (let x = 0; x <= radialSegments; x++) {
        const u = x / radialSegments;
        const theta = u * Math.PI * 2;
        const sinTheta = Math.sin(theta),
          cosTheta = Math.cos(theta);
        positions.push(radius * sinTheta, py, radius * cosTheta);
        normals.push(sinTheta, 0, cosTheta);
        uvs.push(u, 1 - v);
      }
    }

    for (let x = 0; x < radialSegments; x++) {
      const a = x;
      const b = x + radialSegments + 1;
      const c = x + radialSegments + 2;
      const d = x + 1;
      indices.push(a, b, d, b, c, d);
    }

    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(
    radius: number = 1,
    height: number = 1,
    radialSegments: number = 16,
  ) {
    super(0, radius, height, radialSegments);
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(
    radius: number = 1,
    tube: number = 0.4,
    radialSegments: number = 12,
    tubularSegments: number = 32,
  ) {
    super();
    radialSegments = Math.max(3, Math.floor(radialSegments));
    tubularSegments = Math.max(3, Math.floor(tubularSegments));
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * Math.PI * 2;
        const x = (radius + tube * Math.cos(v)) * Math.cos(u);
        const y = (radius + tube * Math.cos(v)) * Math.sin(u);
        const z = tube * Math.sin(v);
        positions.push(x, y, z);

        const cx = radius * Math.cos(u),
          cy = radius * Math.sin(u);
        const nx = x - cx,
          ny = y - cy,
          nz = z;
        const len = Math.hypot(nx, ny, nz) || 1.0;
        normals.push(nx / len, ny / len, nz / len);
        uvs.push(i / tubularSegments, j / radialSegments);
      }
    }

    for (let j = 1; j <= radialSegments; j++) {
      for (let i = 1; i <= tubularSegments; i++) {
        const a = (tubularSegments + 1) * j + i - 1;
        const b = (tubularSegments + 1) * (j - 1) + i - 1;
        const c = (tubularSegments + 1) * (j - 1) + i;
        const d = (tubularSegments + 1) * j + i;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
  }
}

export class TorusKnotGeometry extends BufferGeometry {
  constructor(
    radius: number = 1,
    tube: number = 0.4,
    tubularSegments: number = 64,
    radialSegments: number = 8,
    p: number = 2,
    q: number = 3,
  ) {
    super();
    tubularSegments = Math.floor(tubularSegments);
    radialSegments = Math.floor(radialSegments);
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_torus_knot__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(
          radius,
          tube,
          tubularSegments,
          radialSegments,
          p,
          q,
        );
        this.setAttribute('position', new BufferAttribute(native.positions, 3));
        this.setAttribute('normal', new BufferAttribute(native.normals, 3));
        this.setAttribute('uv', new BufferAttribute(native.uvs, 2));
        this.setIndex(native.indices);
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    const p1 = new Vector3(),
      p2 = new Vector3();
    const T = new Vector3(),
      N = new Vector3(),
      B = new Vector3();

    function setCurvePos(target: Vector3, u: number): void {
      const cu = Math.cos(u),
        su = Math.sin(u);
      const quOverP = (q / p) * u;
      const r0 = radius * (2 + Math.cos(quOverP)) * 0.5;
      target.set(r0 * cu, r0 * su, radius * Math.sin(quOverP) * 0.5);
    }

    const cosSin: number[] = [];
    for (let j = 0; j <= radialSegments; ++j) {
      const v = (j / radialSegments) * Math.PI * 2;
      cosSin.push(-tube * Math.cos(v), tube * Math.sin(v), j / radialSegments);
    }

    for (let i = 0; i <= tubularSegments; ++i) {
      const uRatio = i / tubularSegments;
      const u = uRatio * p * Math.PI * 2;
      setCurvePos(p1, u);
      setCurvePos(p2, u + 0.01);
      T.subVectors(p2, p1).normalize();
      N.addVectors(p1, p2).normalize();
      B.crossVectors(T, N).normalize();
      N.crossVectors(B, T).normalize();

      for (let j = 0; j <= radialSegments; ++j) {
        const idx = j * 3;
        const cx = cosSin[idx],
          cy = cosSin[idx + 1],
          vRatio = cosSin[idx + 2];
        const dx = cx * N.x + cy * B.x;
        const dy = cx * N.y + cy * B.y;
        const dz = cx * N.z + cy * B.z;
        positions.push(p1.x + dx, p1.y + dy, p1.z + dz);
        const len = Math.hypot(dx, dy, dz) || 1.0;
        normals.push(dx / len, dy / len, dz / len);
        uvs.push(uRatio, vRatio);
      }
    }

    const stride = radialSegments + 1;
    for (let j = 1; j <= tubularSegments; j++) {
      const row1 = stride * (j - 1);
      const row2 = row1 + stride;
      for (let i = 1; i <= radialSegments; i++) {
        const a = row1 + (i - 1);
        const b = row2 + (i - 1);
        const c = row2 + i;
        const d = row1 + i;
        indices.push(a, b, d, b, c, d);
      }
    }

    this.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    this.setAttribute(
      'normal',
      new BufferAttribute(new Float32Array(normals), 3),
    );
    this.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.setIndex(indices);
  }
}

// =========================================================================
// 4. Materials & Textures
// =========================================================================

export class Texture {
  public source: string | any;
  public isTexture: boolean = true;
  public wrapS: number = 10497;
  public wrapT: number = 10497;

  /**
   * Optional source image descriptor, mirroring `THREE.Texture.image`. Read by
   * {@link SceneQuotaValidator} to enforce SECURITY_3D_MAX_TEXTURE_DIMENSION.
   */
  image: {width?: number; height?: number} | null = null;
  /** Optional explicit dimensions, used when `image` is not set. */
  width = 0;
  height = 0;

  constructor(source: string | any = '') {
    this.source = source;
    if (source && typeof source === 'object') {
      this.image = source as {width?: number; height?: number};
    }
  }

  public dispose(): void {}
}

export class TextureLoader {
  public load(url: string, onLoad?: (tex: Texture) => void): Texture {
    const tex = new Texture(url);
    onLoad?.(tex);
    return tex;
  }
}

export class Material {
  public name: string = '';
  public color: Color;
  public emissive: Color;
  public emissiveIntensity: number = 1.0;
  public roughness: number = 0.5;
  public metalness: number = 0.1;
  public opacity: number = 1.0;
  public transparent: boolean = false;
  public wireframe: boolean = false;
  public side: number = 2; // 2 = DoubleSide
  public doubleSided: boolean = true;
  public map: Texture | string | null = null;

  // Luxury PBR / Physical Material extensions
  public clearcoat: number = 0.0;
  public clearcoatRoughness: number = 0.0;
  public sheen: number = 0.0;
  public sheenColor: Color;
  public sheenRoughness: number = 0.0;
  public transmission: number = 0.0;
  public thickness: number = 0.0;
  public attenuationColor: Color;
  public attenuationDistance: number = Infinity;
  public ior: number = 1.5;
  public dispersion: number = 0.0;
  public iridescence: number = 0.0;
  public iridescenceIOR: number = 1.3;

  constructor(params: Record<string, any> = {}) {
    this.name = params.name || '';
    this.color = new Color(
      params.color !== undefined ? params.color : 0xffffff,
    );
    this.emissive = new Color(
      params.emissive !== undefined ? params.emissive : 0x000000,
    );
    this.emissiveIntensity =
      params.emissiveIntensity !== undefined
        ? Number(params.emissiveIntensity)
        : 1.0;
    this.roughness =
      params.roughness !== undefined ? Number(params.roughness) : 0.5;
    this.metalness =
      params.metalness !== undefined ? Number(params.metalness) : 0.1;
    this.opacity = params.opacity !== undefined ? Number(params.opacity) : 1.0;
    this.transparent =
      params.transparent !== undefined ? Boolean(params.transparent) : false;
    this.wireframe =
      params.wireframe !== undefined ? Boolean(params.wireframe) : false;
    this.side = params.side !== undefined ? Number(params.side) : 2;
    this.doubleSided =
      params.doubleSided !== undefined ? Boolean(params.doubleSided) : true;
    this.map = params.map || null;

    this.clearcoat =
      params.clearcoat !== undefined ? Number(params.clearcoat) : 0.0;
    this.clearcoatRoughness =
      params.clearcoatRoughness !== undefined
        ? Number(params.clearcoatRoughness)
        : 0.0;
    this.sheen = params.sheen !== undefined ? Number(params.sheen) : 0.0;
    this.sheenColor = new Color(
      params.sheenColor !== undefined ? params.sheenColor : 0x000000,
    );
    this.sheenRoughness =
      params.sheenRoughness !== undefined ? Number(params.sheenRoughness) : 0.0;
    this.transmission =
      params.transmission !== undefined ? Number(params.transmission) : 0.0;
    this.thickness =
      params.thickness !== undefined ? Number(params.thickness) : 0.0;
    this.attenuationColor = new Color(
      params.attenuationColor !== undefined
        ? params.attenuationColor
        : 0xffffff,
    );
    this.attenuationDistance =
      params.attenuationDistance !== undefined
        ? Number(params.attenuationDistance)
        : Infinity;
    this.ior = params.ior !== undefined ? Number(params.ior) : 1.5;
    this.dispersion =
      params.dispersion !== undefined ? Number(params.dispersion) : 0.0;
    this.iridescence =
      params.iridescence !== undefined ? Number(params.iridescence) : 0.0;
    this.iridescenceIOR =
      params.iridescenceIOR !== undefined ? Number(params.iridescenceIOR) : 1.3;
  }

  public dispose(): void {}
}

export class MeshStandardMaterial extends Material {}
export class MeshBasicMaterial extends Material {}
export class MeshLambertMaterial extends Material {}
export class MeshPhongMaterial extends Material {}
export class MeshPhysicalMaterial extends Material {}

// =========================================================================
// 5. Scene Graph, Cameras, & Lights
// =========================================================================

export class Object3D {
  public name: string = '';
  public position: Vector3;
  public rotation: Euler;
  public quaternion: Quaternion;
  public scale: Vector3;
  public matrix: Matrix4;
  public matrixWorld: Matrix4;
  public matrixAutoUpdate: boolean = true;
  public visible: boolean = true;
  public castShadow: boolean = false;
  public receiveShadow: boolean = false;
  public parent: Object3D | null = null;
  public children: Object3D[] = [];
  public userData: Record<string, any> = {};

  constructor() {
    this.position = new Vector3();
    this.rotation = new Euler();
    this.quaternion = new Quaternion();
    this.scale = new Vector3(1, 1, 1);
    this.matrix = new Matrix4();
    this.matrixWorld = new Matrix4();

    // Bi-directional Euler / Quaternion synchronization
    this.rotation._onChange(() => {
      this.quaternion.setFromEuler(this.rotation, false);
    });
    this.quaternion._onChange(() => {
      const q = this.quaternion;
      const x = Math.atan2(
        2 * (q.w * q.x + q.y * q.z),
        1 - 2 * (q.x * q.x + q.y * q.y),
      );
      const y = Math.asin(
        Math.max(-1, Math.min(1, 2 * (q.w * q.y - q.z * q.x))),
      );
      const z = Math.atan2(
        2 * (q.w * q.z + q.x * q.y),
        1 - 2 * (q.y * q.y + q.z * q.z),
      );
      this.rotation.set(x, y, z);
    });
  }

  public add(...objects: Object3D[]): this {
    for (const obj of objects) {
      if (obj && obj instanceof Object3D) {
        if (obj.parent) obj.parent.remove(obj);
        obj.parent = this;
        this.children.push(obj);
      }
    }
    return this;
  }

  public remove(...objects: Object3D[]): this {
    for (const obj of objects) {
      const idx = this.children.indexOf(obj);
      if (idx !== -1) {
        obj.parent = null;
        this.children.splice(idx, 1);
      }
    }
    return this;
  }

  public traverse(cb: (node: Object3D) => void): void {
    cb(this);
    for (const child of this.children) {
      child.traverse(cb);
    }
  }

  public updateMatrix(): void {
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }

  public updateMatrixWorld(force: boolean = false): void {
    if (this.matrixAutoUpdate || force) this.updateMatrix();
    if (this.parent) {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    } else {
      this.matrixWorld.copy(this.matrix);
    }
    for (const child of this.children) {
      child.updateMatrixWorld(force);
    }
  }

  public lookAt(x: any, y?: number, z?: number): void {
    const target = typeof x === 'object' ? x : new Vector3(x, y, z);
    this.updateMatrixWorld(true);
    const m = new Matrix4();
    m.lookAt(this.position, target, new Vector3(0, 1, 0));
    const te = m.elements;
    const m11 = te[0],
      m12 = te[4],
      m13 = te[8];
    const m21 = te[1],
      m22 = te[5],
      m23 = te[9];
    const m31 = te[2],
      m32 = te[6],
      m33 = te[10];
    const trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1.0);
      this.quaternion.set(
        (m32 - m23) * s,
        (m13 - m31) * s,
        (m21 - m12) * s,
        0.25 / s,
      );
    }
  }
}

export class Group extends Object3D {}

export class Mesh extends Object3D {
  public geometry: BufferGeometry;
  public material: Material;
  public isMesh: boolean = true;

  constructor(geometry?: BufferGeometry, material?: Material) {
    super();
    const mat = Array.isArray(material) ? material[0] : material;
    this.geometry =
      geometry instanceof BufferGeometry
        ? geometry
        : geometry
          ? (warnUnsupported('unsupported geometry', 'BoxGeometry'),
            new BoxGeometry(0.5, 0.5, 0.5))
          : new BufferGeometry();
    this.material =
      mat instanceof Material
        ? mat
        : mat
          ? (warnUnsupported('unsupported material', 'MeshStandardMaterial'),
            new MeshStandardMaterial({color: 0xcccccc}))
          : new MeshStandardMaterial();
  }
}

export class Light extends Object3D {
  public color: Color;
  public intensity: number;
  public type: 'ambient' | 'directional' | 'point';

  constructor(color: any = 0xffffff, intensity: number = 1) {
    super();
    this.color = new Color(color);
    this.intensity = Number(intensity);
    this.type = 'directional';
  }
}

export class AmbientLight extends Light {
  constructor(color?: any, intensity?: number) {
    super(color, intensity);
    this.type = 'ambient';
  }
}

export class DirectionalLight extends Light {
  public target: Object3D = new Object3D();
  constructor(color?: any, intensity?: number) {
    super(color, intensity);
    this.type = 'directional';
  }
}

export class PointLight extends Light {
  public distance: number = 0;
  public decay: number = 2;
  constructor(
    color?: any,
    intensity?: number,
    distance: number = 0,
    decay: number = 2,
  ) {
    super(color, intensity);
    this.type = 'point';
    this.distance = distance;
    this.decay = decay;
  }
}

export class Camera extends Object3D {}

export class PerspectiveCamera extends Camera {
  public fov: number;
  public aspect: number;
  public near: number;
  public far: number;
  public target: Vector3 = new Vector3(0, 0, 0);

  constructor(
    fov: number = 45,
    aspect: number = 1,
    near: number = 0.1,
    far: number = 1000,
  ) {
    super();
    this.fov = Number(fov);
    this.aspect = Number(aspect);
    this.near = Number(near);
    this.far = Number(far);
  }
}

// =========================================================================
// 6. Scene & Serializers (glTF 2.0 / Canvas3D)
// =========================================================================

export class Scene extends Object3D {
  public background: Color | Texture | string | null = null;
  public environmentIntensity: number = 1.0;

  // Quota enforcement lives here rather than in the renderer because these
  // three methods are the only way a scene leaves the authoring sandbox. The
  // renderer is not on the path taken by the script runner.
  public toCanvas3D(): GLBData {
    SceneQuotaValidator.validate(this);
    return sceneToCanvas3D(this);
  }

  public toGLB(): Uint8Array {
    SceneQuotaValidator.validate(this);
    return sceneToGLB(this);
  }

  public toUSDZ(): Uint8Array {
    SceneQuotaValidator.validate(this);
    return sceneToUSDZ(this);
  }

  public getMeshTransforms(): Map<string | number, Float32Array> {
    this.updateMatrixWorld(true);
    const map = new Map<string | number, Float32Array>();
    let meshIdx = 0;
    this.traverse((node) => {
      if (node instanceof Mesh) {
        const trans = new Float32Array(node.matrixWorld.elements);
        map.set(meshIdx, trans);
        if (node.name) map.set(node.name, trans);
        meshIdx++;
      }
    });
    return map;
  }
}

export const exportSceneToCanvas3D = sceneToCanvas3D;
export const exportSceneToGLB = sceneToGLB;
export const exportSceneToUSDZ = sceneToUSDZ;

export {generateUSDZ, glbToUSDZ, sceneToCanvas3D, sceneToGLB, sceneToUSDZ};

// =========================================================================
// 7. Security Quota Validation & Sandboxed Renderer
// =========================================================================

export class SceneQuotaValidator {
  public static validate(scene: Scene): void {
    let totalVerts = 0;
    let totalIndices = 0;
    let meshCount = 0;
    const textures = new Set<Texture>();
    const fail = (name: string, max: number, found: number): never => {
      throw new Error(
        `SecurityError: Scene exceeds SECURITY_3D_MAX_${name} (${max}). Found: ${found}`,
      );
    };
    // Every ceiling below is a `>` comparison, and `NaN > anything` is false.
    // A single non-finite count would therefore disable the whole quota system,
    // so treat non-finite as an immediate failure rather than a pass.
    const finite = (name: string, value: number): number => {
      if (!Number.isFinite(value)) {
        throw new Error(
          `SecurityError: Scene reports a non-finite ${name} count (${String(value)}), which cannot be bounds-checked.`,
        );
      }
      return value;
    };

    scene.traverse((obj) => {
      if (obj instanceof Mesh) {
        meshCount++;
        if (meshCount > SECURITY_3D_MAX_MESHES) {
          fail('MESHES', SECURITY_3D_MAX_MESHES, meshCount);
        }
        const geo = obj.geometry;
        if (geo) {
          let posCount = 0;
          if (geo.attributes.position) {
            posCount = finite('vertex', geo.attributes.position.count);
            totalVerts += posCount;
            if (totalVerts > SECURITY_3D_MAX_VERTICES) {
              fail('VERTICES', SECURITY_3D_MAX_VERTICES, totalVerts);
            }
          }
          if (geo.index) {
            const idxCount = finite('index', geo.index.count);
            totalIndices += idxCount;
            if (totalIndices > SECURITY_3D_MAX_INDICES) {
              fail('INDICES', SECURITY_3D_MAX_INDICES, totalIndices);
            }
            const idxArray = geo.index.array;
            if (idxArray && posCount > 0) {
              const checkLen = Math.min(idxCount, idxArray.length);
              for (let i = 0; i < checkLen; i++) {
                const idx = idxArray[i];
                if (!Number.isFinite(idx) || idx < 0 || idx >= posCount) {
                  throw new Error(
                    `SecurityError: Index buffer value (${String(idx)}) out of vertex bounds [0, ${posCount}).`,
                  );
                }
              }
            }
          }
        }
        if (obj.material) {
          const mat = obj.material as any;
          if (mat.map) textures.add(mat.map);
          if (mat.normalMap) textures.add(mat.normalMap);
          if (mat.roughnessMap) textures.add(mat.roughnessMap);
        }
      }
    });

    if (textures.size > SECURITY_3D_MAX_TEXTURES) {
      fail('TEXTURES', SECURITY_3D_MAX_TEXTURES, textures.size);
    }

    for (const tex of textures) {
      const texRecord = tex as {
        image?: {width?: unknown; height?: unknown};
        width?: unknown;
        height?: unknown;
      };
      const img = texRecord.image;
      const width = Number(img?.width ?? texRecord.width ?? 0) || 0;
      const height = Number(img?.height ?? texRecord.height ?? 0) || 0;
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width > SECURITY_3D_MAX_TEXTURE_DIMENSION ||
        height > SECURITY_3D_MAX_TEXTURE_DIMENSION
      ) {
        fail(
          'TEXTURE_DIMENSION',
          SECURITY_3D_MAX_TEXTURE_DIMENSION,
          Math.max(width, height),
        );
      }
    }
  }
}

export class WebGLRenderer {
  public domElement: HTMLElement;
  public shadowMap = {enabled: false, type: 0};
  public capabilities = {isWebGL2: true, maxTextures: 16};
  private boundViewer: any = null;
  public isSandboxed: boolean = false;
  public containerId: string = '';
  private hasInitialModelRendered: boolean = false;

  constructor(opts: Record<string, any> = {}) {
    this.domElement =
      opts.canvas ||
      (typeof document !== 'undefined'
        ? document.createElement('canvas')
        : ({} as any));
    if (opts.viewer) this.boundViewer = opts.viewer;
    if (opts.container?.threeLiveViewer)
      this.boundViewer = opts.container.threeLiveViewer;
    if (opts.canvas?.parentElement?.threeLiveViewer) {
      this.boundViewer = opts.canvas.parentElement.threeLiveViewer;
    }
    const isWorkerEnv =
      typeof WorkerGlobalScope !== 'undefined' &&
      typeof self !== 'undefined' &&
      self instanceof WorkerGlobalScope;
    this.isSandboxed = opts.isSandboxed || isWorkerEnv;
    this.containerId = opts.containerId || '';
  }

  public setSize(_w: number, _h: number): this {
    return this;
  }
  public setPixelRatio(_dpr: number): this {
    return this;
  }
  public setClearColor(color: any, alpha: number = 1.0): this {
    const col = new Color(color);
    if (
      this.boundViewer &&
      typeof this.boundViewer.setClearColor === 'function'
    ) {
      this.boundViewer.setClearColor(col.r, col.g, col.b, alpha);
    }
    return this;
  }
  public clear(): this {
    return this;
  }
  public dispose(): void {}

  public render(scene: Scene, camera?: Camera): void {
    if (this.isSandboxed) {
      SceneQuotaValidator.validate(scene);
      const post = (msg: any, transfer?: Transferable[]) => {
        if (
          typeof self !== 'undefined' &&
          typeof (self as any).postMessage === 'function'
        ) {
          if (transfer && transfer.length)
            (self as any).postMessage(msg, transfer);
          else (self as any).postMessage(msg);
        }
      };

      if (!this.hasInitialModelRendered) {
        this.hasInitialModelRendered = true;
        const payload = exportSceneToCanvas3D(scene);
        const glb = exportSceneToGLB(scene);
        const dynamicLights = (payload.lights || []).map((l: any) => ({
          type: l.type,
          color: l.color,
          intensity: l.intensity,
          position: l.position,
        }));
        post(
          {
            type: '3D_MODEL_READY',
            containerId: this.containerId,
            glbBuffer: glb.buffer,
            dynamicLights,
            camera: camera
              ? {
                  fov: (camera as any).fov || 60,
                  position: [
                    camera.position.x,
                    camera.position.y,
                    camera.position.z,
                  ],
                }
              : undefined,
          },
          [glb.buffer],
        );
      } else {
        const transformsMap = scene.getMeshTransforms();
        const plainTransforms: Record<string, number[]> = {};
        for (const [k, v] of transformsMap.entries()) {
          plainTransforms[k] = Array.from(v);
        }
        post({
          type: '3D_UPDATE_TRANSFORMS',
          containerId: this.containerId,
          transforms: plainTransforms,
        });
      }
      return;
    }

    let viewer = this.boundViewer;
    if (
      !viewer &&
      this.domElement?.parentElement &&
      (this.domElement.parentElement as any).threeLiveViewer
    ) {
      viewer = (this.domElement.parentElement as any).threeLiveViewer;
      this.boundViewer = viewer;
    }
    if (!viewer && typeof window !== 'undefined') {
      viewer = (window as any).__three_live_active_viewer__;
      this.boundViewer = viewer;
    }
    if (viewer && typeof viewer.loadModel === 'function') {
      if (!viewer._hasThreeLiveModelLoaded) {
        viewer.loadModel(scene.toCanvas3D());
        viewer._hasThreeLiveModelLoaded = true;
      } else if (typeof viewer.updateMeshTransforms === 'function') {
        // Option B: 60 FPS reactive matrix updates!
        viewer.updateMeshTransforms(scene.getMeshTransforms());
      }
    }
  }
}

function readClockTimeMs(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export class Clock {
  public autoStart: boolean;
  public startTime: number = 0;
  public oldTime: number = 0;
  public elapsedTime: number = 0;
  public running: boolean = false;

  constructor(autoStart: boolean = true) {
    this.autoStart = autoStart;
    if (autoStart) this.start();
  }

  public start(): void {
    this.startTime = readClockTimeMs();
    this.oldTime = this.startTime;
    this.elapsedTime = 0;
    this.running = true;
  }

  public stop(): void {
    this.getElapsedTime();
    this.running = false;
    this.autoStart = false;
  }

  public getElapsedTime(): number {
    this.getDelta();
    return this.elapsedTime;
  }

  public getDelta(): number {
    let diff = 0;
    if (this.autoStart && !this.running) this.start();
    if (this.running) {
      const newTime = readClockTimeMs();
      diff = (newTime - this.oldTime) / 1000;
      this.oldTime = newTime;
      this.elapsedTime += diff;
    }
    return diff;
  }
}

function noop() {}
export const noopProxy: any = new Proxy(noop, {
  get: (_target, prop) => {
    if (prop === 'isProxy') return true;
    if (
      prop === 'constructor' ||
      prop === '__proto__' ||
      prop === 'prototype'
    ) {
      return undefined;
    }
    if (prop === 'domElement')
      return typeof document !== 'undefined'
        ? document.createElement('canvas')
        : {};
    if (prop === 'shadowMap') return {enabled: false, type: 0};
    if (prop === 'capabilities') return {isWebGL2: true, maxTextures: 16};
    if (prop === Symbol.toPrimitive) return () => 0;
    return noopProxy;
  },
  getPrototypeOf: () => null,
  setPrototypeOf: () => false,
  apply: () => noopProxy,
  construct: () => noopProxy,
});

export interface ScriptExecutionCallbacks {
  onModelReady: (glbBuffer: ArrayBuffer | GLBData) => void;
  onUpdateTransforms?: (transforms: any) => void;
  onError?: (err: Error) => void;
  onToast?: (message: string) => void;
}

export interface ScriptExecutionHandle {
  terminate: () => void;
}

/**
 * Mandatory sandbox mode for procedural script execution.
 *
 * - `'worker'` (default): the script runs in a dedicated Web Worker with
 *   network, storage and thread-spawning capabilities revoked across the
 *   prototype chain.
 * - `'iframe'`: the script runs in a dedicated Web Worker inside an
 *   opaque-origin `<iframe sandbox="allow-scripts">` (`three-live-sandbox.html`)
 *   with a strict `connect-src 'none'` Content Security Policy.
 */
export type SandboxMode = 'worker' | 'iframe';

/** Options controlling procedural script execution security policy. */
export interface ScriptExecutionOptions {
  readonly allowClientScripts?: boolean;
}

export interface ScriptRunner {
  execute(
    script: string,
    sandbox: SandboxMode | string,
    callbacks: ScriptExecutionCallbacks,
    options?: ScriptExecutionOptions,
  ): Promise<ScriptExecutionHandle | void>;
  executeUrl?(
    scriptUrl: string,
    sandbox: SandboxMode | string,
    callbacks: ScriptExecutionCallbacks,
  ): Promise<ScriptExecutionHandle | void>;
}

// -------------------------------------------------------------------------
// 7a. Sandbox engine URL resolution & Trusted Types support
// -------------------------------------------------------------------------

/**
 * URL of a Three-Live IIFE bundle (e.g. `three-live.min.js`) that the worker
 * sandbox loads to obtain the `THREE` namespace.
 *
 * Auto-detected when the library is loaded via a classic `<script src="...">`
 * tag. Bundler users must set it explicitly, the same way Monaco, PDF.js and
 * Tesseract.js require their worker asset to be pointed at.
 *
 * Backed by the shared registry so `ThreeLiveElement.sandboxEngineSrc` and this
 * module agree even when they end up in different bundles.
 */

/** Captured at module-evaluation time; `document.currentScript` is only valid then. */
const autoDetectedEngineSrc: string | null = (() => {
  try {
    if (typeof document === 'undefined') return null;
    // Narrow SVGScriptElement | HTMLScriptElement union to HTMLScriptElement
    // to read the standard `src` property.
    const current = document.currentScript as HTMLScriptElement | null;
    if (current?.src) return current.src;
    if (
      current?.textContent &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      return URL.createObjectURL(
        new Blob([current.textContent], {type: 'text/javascript'}),
      );
    }
    return null;
  } catch {
    return null;
  }
})();

/** Options for validating a candidate sandbox engine URL. */
export interface SandboxEngineUrlValidationOptions {
  readonly requireSameOrigin?: boolean;
}

function getBaseHref(): string {
  if (typeof document !== 'undefined' && document.baseURI) {
    return document.baseURI;
  }
  if (typeof location !== 'undefined' && location.href) {
    return location.href;
  }
  return 'https://localhost/';
}

/**
 * Validates that a candidate worker/engine script URL uses a safe protocol
 * (`https:`, `http:`, or `blob:`) and, when `options.requireSameOrigin` is set,
 * matches the host document's origin.
 */
export function isAllowedSandboxEngineUrl(
  rawUrl: string,
  options?: SandboxEngineUrlValidationOptions,
): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  const trimmed = rawUrl.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed, getBaseHref());
    if (
      parsed.protocol !== 'https:' &&
      parsed.protocol !== 'http:' &&
      parsed.protocol !== 'blob:'
    ) {
      return false;
    }
    if (
      options?.requireSameOrigin &&
      parsed.protocol !== 'blob:' &&
      typeof location !== 'undefined' &&
      location.origin &&
      location.origin !== 'null'
    ) {
      if (parsed.origin !== location.origin) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

interface TrustedScriptURLLike {
  toString(): string;
}

interface TrustedTypePolicyLike {
  createScriptURL(input: string): TrustedScriptURLLike;
}

interface TrustedTypePolicyFactoryLike {
  createPolicy(
    policyName: string,
    policyOptions: {createScriptURL: (input: string) => string},
  ): TrustedTypePolicyLike;
}

let cachedTrustedTypesFactory: TrustedTypePolicyFactoryLike | undefined;
let cachedWorkerTrustedTypesPolicy: TrustedTypePolicyLike | null | undefined;

/**
 * Wraps a validated Worker or engine script URL in a `TrustedScriptURL` when
 * the host environment enforces `require-trusted-types-for 'script'`.
 */
export function toTrustedWorkerScriptURL(
  url: string,
): string | TrustedScriptURLLike {
  if (!isAllowedSandboxEngineUrl(url)) {
    throw new Error(
      `SecurityError: Refusing to create TrustedScriptURL for disallowed URL "${url}".`,
    );
  }
  // Access the ambient browser Trusted Types API, which is not present on
  // standard ES2020 globalThis typings.
  const globalWithTrustedTypes = globalThis as {
    trustedTypes?: TrustedTypePolicyFactoryLike;
  };
  const factory = globalWithTrustedTypes.trustedTypes;
  if (!factory || typeof factory.createPolicy !== 'function') {
    return url;
  }
  if (
    cachedWorkerTrustedTypesPolicy === undefined ||
    cachedTrustedTypesFactory !== factory
  ) {
    cachedTrustedTypesFactory = factory;
    try {
      cachedWorkerTrustedTypesPolicy = factory.createPolicy(
        'three-live#worker',
        {
          createScriptURL: (input: string) => {
            if (!isAllowedSandboxEngineUrl(input)) {
              throw new TypeError(
                `SecurityError: Disallowed Three-Live worker script URL "${input}".`,
              );
            }
            return input;
          },
        },
      );
    } catch {
      cachedWorkerTrustedTypesPolicy = null;
    }
  }
  return cachedWorkerTrustedTypesPolicy
    ? cachedWorkerTrustedTypesPolicy.createScriptURL(url)
    : url;
}

/**
 * Overrides the bundle URL used by the worker sandbox. Pass `null` to fall back
 * to auto-detection.
 */
export function setSandboxEngineSrc(src: string | null): void {
  getSharedRegistry().sandboxEngineSrc = src;
}

/** Returns the bundle URL the worker sandbox would use, or `null`. */
export function getSandboxEngineSrc(): string | null {
  const configured = getSharedRegistry().sandboxEngineSrc;
  if (configured) return configured;
  if (autoDetectedEngineSrc) return autoDetectedEngineSrc;
  try {
    if (typeof document === 'undefined') return null;
    const baseHref = getBaseHref();
    const scripts = Array.from(
      document.querySelectorAll<HTMLScriptElement>('script[src]'),
    );
    for (const scriptElement of scripts) {
      const src = scriptElement.src;
      if (!src) continue;
      const pathname = new URL(src, baseHref).pathname;
      if (
        /(?:^|\/)(?:three|xr)-live[^/]*\.js$/.test(pathname) &&
        isAllowedSandboxEngineUrl(src, {requireSameOrigin: true})
      ) {
        return src;
      }
    }
  } catch {
    // Fall through to the fail-closed path below.
  }
  return null;
}

function resolveSandboxEngineSrc(): string {
  const src = getSandboxEngineSrc();
  if (!src) {
    throw new Error(
      'Three-Live could not locate its own bundle URL, which the worker ' +
        'sandbox needs in order to load the THREE runtime. Set it explicitly, ' +
        "e.g. ThreeLiveElement.sandboxEngineSrc = new URL('three-live.min.js', " +
        'import.meta.url).href. Refusing to execute the script, because ' +
        'unsandboxed host-realm execution is prohibited.',
    );
  }
  if (!isAllowedSandboxEngineUrl(src)) {
    throw new Error(
      `SecurityError: Refusing to load sandbox engine from disallowed URL "${src}". ` +
        'Only http:, https:, and blob: URLs are permitted.',
    );
  }
  return new URL(src, getBaseHref()).href;
}

/**
 * Overrides the URL of `three-live-sandbox.html` used in `'iframe'` sandbox
 * mode. Pass `null` to derive it automatically alongside `sandboxEngineSrc`.
 */
export function setSandboxIframeSrc(src: string | null): void {
  getSharedRegistry().sandboxIframeSrc = src;
}

/**
 * Returns the configured or auto-derived URL of `three-live-sandbox.html`, or
 * `null` if neither `sandboxIframeSrc` nor `sandboxEngineSrc` can be located.
 */
export function getSandboxIframeSrc(): string | null {
  const configured = getSharedRegistry().sandboxIframeSrc;
  if (configured) return configured;
  const engineSrc = getSandboxEngineSrc();
  if (!engineSrc || !isAllowedSandboxEngineUrl(engineSrc)) return null;
  const engineUrl = new URL(engineSrc, getBaseHref());
  if (engineUrl.protocol === 'blob:') return null;
  return new URL('three-live-sandbox.html', engineUrl).href;
}

function resolveSandboxIframeSrc(): string {
  const src = getSandboxIframeSrc();
  if (!src) {
    throw new Error(
      'Three-Live could not locate three-live-sandbox.html for iframe ' +
        'sandbox execution. Set ThreeLiveElement.sandboxIframeSrc ' +
        '(or ThreeLiveElement.sandboxEngineSrc) explicitly.',
    );
  }
  if (!isAllowedSandboxEngineUrl(src)) {
    throw new Error(
      `SecurityError: Refusing to load sandbox iframe from disallowed URL "${src}". ` +
        'Only http:, https:, and blob: URLs are permitted.',
    );
  }
  return new URL(src, getBaseHref()).href;
}

/**
 * Enables or disables client-modified procedural script string compilation
 * (Use Case 1: `executeScript(code)` and inline `<script type="text/three-live">`).
 * Defaults to `false` so only server-generated script URLs (`script-src`) are
 * permitted unless explicitly opted into.
 */
export function setAllowClientScripts(allow: boolean): void {
  getSharedRegistry().allowClientScripts = allow;
}

/**
 * Returns whether client-modified procedural script strings (Use Case 1) are
 * currently enabled. Defaults to `false`.
 */
export function getAllowClientScripts(): boolean {
  return Boolean(getSharedRegistry().allowClientScripts);
}

function resolveSandboxScriptUrl(scriptUrl: string): string {
  if (!isAllowedSandboxEngineUrl(scriptUrl)) {
    throw new Error(
      `SecurityError: Refusing to load procedural scene script from disallowed URL "${scriptUrl}". ` +
        'Only http:, https:, and blob: URLs are permitted.',
    );
  }
  return new URL(scriptUrl, getBaseHref()).href;
}

// -------------------------------------------------------------------------
// 7b. Worker sandbox
// -------------------------------------------------------------------------

/**
 * Capabilities revoked inside the worker (and across its prototype chain)
 * before any author code runs.
 *
 * The worker realm has no DOM, but it does inherit the page's origin, cookies
 * and network authority, so an un-neutered worker is an exfiltration primitive
 * rather than a sandbox. `importScripts` is on this list, which is why
 * revocation must happen *after* the engine bundle is loaded.
 */
const REVOKED_WORKER_GLOBALS: readonly string[] = [
  // Exfiltration & network transports.
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebSocketStream',
  'WebTransport',
  'EventSource',
  'importScripts',
  'Request',
  'Response',
  'Headers',
  'navigator', // also removes navigator.sendBeacon & navigator.storage
  'WorkerNavigator',
  'WorkerLocation',
  'RTCPeerConnection',
  'RTCDataChannel',
  'FontFace',
  'FontFaceSet',
  'fonts', // self.fonts can trigger outbound font network fetches
  'PerformanceObserver',
  'ReportingObserver',
  // Persistence & storage.
  'indexedDB',
  'IDBFactory',
  'caches',
  'CacheStorage',
  'Cache',
  'cookieStore',
  'StorageManager',
  'FileSystemHandle',
  // Realm escape, IPC, and resource amplification.
  'Worker',
  'SharedWorker',
  'ServiceWorker',
  'ServiceWorkerContainer',
  'ServiceWorkerRegistration',
  'registration',
  'clients',
  'BroadcastChannel',
  'MessageChannel',
  'MessagePort',
  'createImageBitmap',
  'OffscreenCanvas',
  'WebAssembly',
  'WorkerGlobalScope',
  'DedicatedWorkerGlobalScope',
  'trustedTypes',
  'TrustedTypePolicyFactory',
  // High-resolution timer sources used to sharpen speculative-execution attacks.
  'SharedArrayBuffer',
  'Atomics',
];

/** Options controlling the execution capabilities of a generated sandbox worker. */
export interface SandboxWorkerSourceOptions {
  readonly allowClientScripts?: boolean;
  readonly allowedScriptUrl?: string | null;
}

/**
 * Builds the body of the sandbox worker.
 *
 * Exported so tests can execute it against a stub worker global: this is a
 * plain string, so the compiler offers no protection here.
 */
export function buildSandboxWorkerSource(
  engineSrc: string,
  nonce: string,
  options?: SandboxWorkerSourceOptions,
): string {
  const allowedScriptUrl = options?.allowedScriptUrl ?? null;
  const allowClientScripts =
    options?.allowClientScripts ?? allowedScriptUrl === null;
  return `
'use strict';
(function () {
  var NONCE = ${JSON.stringify(nonce)};
  var ENGINE_SRC = ${JSON.stringify(engineSrc)};
  var ALLOWED_SCRIPT_URL = ${JSON.stringify(allowedScriptUrl)};
  var ALLOW_CLIENT_SCRIPTS = ${JSON.stringify(allowClientScripts)};
  var REVOKED = ${JSON.stringify(REVOKED_WORKER_GLOBALS)};

  // Capture the channel back to the host before the author script can see it,
  // so it cannot forge a 3D_MODEL_READY message.
  var post = self.postMessage.bind(self);

  function fail(message) {
    post({type: 'ERROR', nonce: NONCE, message: String(message)});
  }

  // Capture importScripts in a private closure before scrubbing it from self
  // and WorkerGlobalScope.prototype, so Use Case 2 (server-generated scriptUrl)
  // can load the allowlisted script URL without exposing importScripts to the
  // scene script or requiring 'unsafe-eval'.
  var nativeImportScripts =
    typeof self.importScripts === 'function'
      ? self.importScripts.bind(self)
      : null;
  var sceneScriptUrlToLoad = ALLOWED_SCRIPT_URL;
  var createClientScript = null;

  try {
    var scriptUrlToLoad = ENGINE_SRC;
    if (
      typeof self.trustedTypes !== 'undefined' &&
      self.trustedTypes &&
      typeof self.trustedTypes.createPolicy === 'function'
    ) {
      try {
        var policyRules = {
          createScriptURL: function (u) {
            if (
              u !== ENGINE_SRC &&
              (!ALLOWED_SCRIPT_URL || u !== ALLOWED_SCRIPT_URL)
            ) {
              throw new TypeError('Disallowed worker importScripts URL');
            }
            return u;
          },
        };
        if (ALLOW_CLIENT_SCRIPTS) {
          policyRules.createScript = function (s) {
            return String(s);
          };
        }
        var bootPolicy = self.trustedTypes.createPolicy(
          'three-live#worker-boot',
          policyRules,
        );
        scriptUrlToLoad = bootPolicy.createScriptURL(ENGINE_SRC);
        if (ALLOWED_SCRIPT_URL) {
          sceneScriptUrlToLoad = bootPolicy.createScriptURL(ALLOWED_SCRIPT_URL);
        }
        if (ALLOW_CLIENT_SCRIPTS && typeof bootPolicy.createScript === 'function') {
          createClientScript = bootPolicy.createScript.bind(bootPolicy);
        }
      } catch (trustedTypesError) {
        // Fall back to raw URLs if a restrictive policy list blocks creation.
      }
    }
    nativeImportScripts(scriptUrlToLoad);
  } catch (err) {
    fail(
      'Sandbox failed to load the Three-Live engine from "' + ENGINE_SRC +
        '". It must be a same-origin (or CORS-enabled) IIFE bundle such as ' +
        'three-live.min.js. Underlying error: ' + (err && err.message || err),
    );
    return;
  }

  var THREE = self.THREE;
  if (!THREE || typeof THREE.Scene !== 'function') {
    fail(
      'Sandbox loaded "' + ENGINE_SRC + '" but it did not install a THREE ' +
        'namespace. Point sandboxEngineSrc at an IIFE build (three-live.min.js), ' +
        'not an ES module build.',
    );
    return;
  }

  // Revoke ambient authority on self AND every prototype along the worker's
  // prototype chain (DedicatedWorkerGlobalScope.prototype -> WorkerGlobalScope.prototype)
  // so scripts cannot bypass self.fetch = undefined via
  // Object.getPrototypeOf(self).fetch.call(self, ...).
  for (var i = 0; i < REVOKED.length; i++) {
    var key = REVOKED[i];
    var proto = self;
    while (proto && proto !== Object.prototype) {
      if (proto !== self) {
        try {
          delete proto[key];
        } catch (e) {}
      }
      try {
        Object.defineProperty(proto, key, {
          value: undefined,
          writable: false,
          configurable: false,
          enumerable: false,
        });
      } catch (e) {}
      try {
        proto = Object.getPrototypeOf(proto);
      } catch (e) {
        break;
      }
    }
  }

  // Coarsen self.performance to millisecond resolution and strip resource-timing
  // methods while keeping performance.now() functional for THREE.Clock.
  var coarsePerformance = Object.freeze({
    now: function () {
      return Date.now();
    },
  });
  var perfProto = self;
  while (perfProto && perfProto !== Object.prototype) {
    if (perfProto !== self) {
      try {
        delete perfProto.performance;
      } catch (e) {}
    }
    try {
      Object.defineProperty(perfProto, 'performance', {
        value: coarsePerformance,
        writable: false,
        configurable: false,
        enumerable: false,
      });
    } catch (e) {}
    try {
      perfProto = Object.getPrototypeOf(perfProto);
    } catch (e) {
      break;
    }
  }

  // The sandboxed WebGLRenderer legitimately posts scene updates via
  // self.postMessage, so this cannot simply throw. Instead, allowlist the two
  // scene message types and stamp the nonce on self AND across the prototype chain.
  var SCENE_MESSAGE_TYPES = ['3D_MODEL_READY', '3D_UPDATE_TRANSFORMS'];
  var sentModel = false;

  function emit(msg, transfer) {
    if (msg.type === '3D_MODEL_READY') {
      if (sentModel) return;
      sentModel = true;
    }
    msg.nonce = NONCE;
    if (transfer && transfer.length) post(msg, transfer);
    else post(msg);
  }

  var guardedPostMessage = function (msg, transfer) {
    if (!msg || SCENE_MESSAGE_TYPES.indexOf(msg.type) === -1) {
      throw new Error(
        'Sandboxed scripts may only post Three-Live scene messages (' +
          SCENE_MESSAGE_TYPES.join(', ') + ').',
      );
    }
    emit(msg, transfer);
  };

  var pmProto = self;
  while (pmProto && pmProto !== Object.prototype) {
    if (
      pmProto === self ||
      Object.prototype.hasOwnProperty.call(pmProto, 'postMessage')
    ) {
      try {
        Object.defineProperty(pmProto, 'postMessage', {
          value: guardedPostMessage,
          writable: false,
          configurable: false,
        });
      } catch (e) {}
    }
    try {
      pmProto = Object.getPrototypeOf(pmProto);
    } catch (e) {
      break;
    }
  }

  var started = false;

  self.onmessage = function (e) {
    var data = e && e.data;
    if (!data || data.nonce !== NONCE) return;
    if (data.type !== 'EXECUTE' && data.type !== 'EXECUTE_URL') return;
    if (started) return;
    started = true;

    try {
      var scene = new THREE.Scene();
      var camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      var renderer = new THREE.WebGLRenderer({isSandboxed: true});

      if (data.type === 'EXECUTE_URL') {
        if (
          !ALLOWED_SCRIPT_URL ||
          data.scriptUrl !== ALLOWED_SCRIPT_URL ||
          typeof nativeImportScripts !== 'function'
        ) {
          fail(
            'SecurityError: Refusing to execute unapproved script URL inside sandbox worker.',
          );
          return;
        }
        var urlToImport = sceneScriptUrlToLoad || ALLOWED_SCRIPT_URL;
        var runImport = nativeImportScripts;
        nativeImportScripts = null;
        sceneScriptUrlToLoad = null;
        self.THREE = THREE;
        self.scene = scene;
        self.camera = camera;
        self.renderer = renderer;
        runImport(urlToImport);
        if (typeof self.__THREE_LIVE_SCENE__ === 'function') {
          var cbRet = self.__THREE_LIVE_SCENE__(
            THREE,
            scene,
            camera,
            renderer,
          );
          if (cbRet && typeof cbRet.toGLB === 'function') {
            scene = cbRet;
          }
        } else if (self.scene && typeof self.scene.toGLB === 'function') {
          scene = self.scene;
        }
      } else {
        if (!ALLOW_CLIENT_SCRIPTS) {
          fail(
            'SecurityError: Client-modified script compilation (Use Case 1) is disabled in this sandbox worker.',
          );
          return;
        }
        var runClientFn = createClientScript
          ? (0, eval)(
              createClientScript(
                '(function (THREE, scene, camera, renderer) {\\n' +
                  'return (function () {\\n' +
                  data.script +
                  '\\n})();\\n})',
              ),
            )
          : new Function(
              'THREE',
              'scene',
              'camera',
              'renderer',
              'return (function () {\\n' + data.script + '\\n})();',
            );
        createClientScript = null;
        var ret = runClientFn(THREE, scene, camera, renderer);
        if (ret && typeof ret.toGLB === 'function') {
          scene = ret;
        }
      }

      // Scripts that never call renderer.render() still get serialized.
      if (!sentModel) {
        if (THREE.SceneQuotaValidator) {
          THREE.SceneQuotaValidator.validate(scene);
        }
        var glbBytes = scene.toGLB();
        var glbBuffer =
          glbBytes instanceof ArrayBuffer
            ? glbBytes
            : glbBytes.buffer.slice(
                glbBytes.byteOffset,
                glbBytes.byteOffset + glbBytes.byteLength,
              );
        emit(
          {
            type: '3D_MODEL_READY',
            glbBuffer: glbBuffer,
          },
          [glbBuffer],
        );
      }
      post({type: 'DONE', nonce: NONCE});
    } catch (err) {
      fail((err && err.message) || err);
    }
  };

  post({type: 'READY', nonce: NONCE});
})();
`;
}

/** Number of sandbox workers currently alive, capped by MAX_CONCURRENT_TASKS. */
let liveSandboxWorkers = 0;

function newSandboxNonce(): string {
  try {
    const randomBuffer = new Uint32Array(4);
    // Access Web Crypto API on globalThis across browser and worker runtimes.
    const globalWithCrypto = globalThis as {
      crypto?: {getRandomValues(arr: Uint32Array): void};
    };
    globalWithCrypto.crypto?.getRandomValues(randomBuffer);
    return Array.from(randomBuffer, (n) =>
      n.toString(16).padStart(8, '0'),
    ).join('');
  } catch {
    return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  }
}

function scriptByteLength(script: string): number {
  try {
    return new TextEncoder().encode(script).length;
  } catch {
    return script.length;
  }
}

/** Validated message payload accepted from a sandboxed Web Worker (P1-6 / WEB-15). */
export type ValidatedSandboxWorkerMessage =
  | {type: 'READY'}
  | {type: 'DONE'}
  | {type: 'ERROR'; message: string}
  | {
      type: '3D_UPDATE_TRANSFORMS';
      transforms:
        | Array<number[] | Float32Array>
        | Record<string, number[] | Float32Array>;
    }
  | {type: '3D_MODEL_READY'; payload: ArrayBuffer};

const MAX_WORKER_ERROR_LENGTH = 1024;
const MAX_TRANSFORM_KEY_LENGTH = 256;

function isValidMatrix16(val: unknown): val is number[] | Float32Array {
  if (!Array.isArray(val) && !(val instanceof Float32Array)) {
    return false;
  }
  if (val.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    const num = val[i];
    if (typeof num !== 'number' || !Number.isFinite(num)) {
      return false;
    }
  }
  return true;
}

/**
 * Validates and sanitizes a raw postMessage payload arriving from a sandboxed
 * Web Worker before handing any field to the host viewer (P1-6 / WEB-15).
 * Returns `null` if the nonce mismatches or the payload violates size/schema bounds.
 */
export function validateSandboxWorkerMessage(
  raw: unknown,
  expectedNonce: string,
): ValidatedSandboxWorkerMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  // Safe cast: `raw` is verified to be a non-null object above.
  const record = raw as Record<string, unknown>;
  if (record['nonce'] !== expectedNonce) return null;
  const type = record['type'];
  switch (type) {
    case 'READY':
      return {type: 'READY'};
    case 'DONE':
      return {type: 'DONE'};
    case 'ERROR': {
      const rawMessage =
        typeof record['message'] === 'string'
          ? record['message']
          : String(record['message'] ?? 'Unknown worker error');
      const cleaned = rawMessage
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
        .slice(0, MAX_WORKER_ERROR_LENGTH);
      return {type: 'ERROR', message: cleaned};
    }
    case '3D_UPDATE_TRANSFORMS': {
      const transforms = record['transforms'];
      if (Array.isArray(transforms)) {
        if (transforms.length > SECURITY_3D_MAX_MESHES) {
          return null;
        }
        for (const item of transforms) {
          if (!isValidMatrix16(item)) return null;
        }
        // Safe cast: every element of `transforms` passed `isValidMatrix16`.
        return {
          type: '3D_UPDATE_TRANSFORMS',
          transforms: transforms as Array<number[] | Float32Array>,
        };
      }
      if (transforms && typeof transforms === 'object') {
        const keys = Object.keys(transforms);
        if (keys.length > SECURITY_3D_MAX_MESHES) {
          return null;
        }
        const safeMap = Object.create(null) as Record<
          string,
          number[] | Float32Array
        >;
        // Safe cast: `transforms` is verified to be a non-null object above.
        const transformRecord = transforms as Record<string, unknown>;
        for (const key of keys) {
          if (
            key.length > MAX_TRANSFORM_KEY_LENGTH ||
            key === '__proto__' ||
            key === 'constructor' ||
            key === 'prototype'
          ) {
            return null;
          }
          const mat = transformRecord[key];
          if (!isValidMatrix16(mat)) return null;
          safeMap[key] = mat;
        }
        return {
          type: '3D_UPDATE_TRANSFORMS',
          transforms: safeMap,
        };
      }
      return null;
    }
    case '3D_MODEL_READY': {
      const glbBuffer = record['glbBuffer'];
      if (
        !(glbBuffer instanceof ArrayBuffer) ||
        glbBuffer.byteLength > SECURITY_3D_MAX_HEAP_BYTES
      ) {
        return null;
      }
      return {type: '3D_MODEL_READY', payload: glbBuffer};
    }
    default:
      return null;
  }
}

function assertScriptWithinBudget(script: string): void {
  const bytes = scriptByteLength(script);
  if (bytes > SECURITY_3D_MAX_SCRIPT_BYTES) {
    throw new Error(
      `SecurityError: Script length (${bytes} bytes) exceeds ` +
        `SECURITY_3D_MAX_SCRIPT_BYTES (${SECURITY_3D_MAX_SCRIPT_BYTES}).`,
    );
  }
}

interface SandboxDispatchState {
  modelDispatched: boolean;
}

function dispatchValidatedSandboxMessage(
  validated: ValidatedSandboxWorkerMessage,
  callbacks: ScriptExecutionCallbacks,
  shutdown: () => void,
  state: SandboxDispatchState,
): void {
  switch (validated.type) {
    case 'READY':
      return;
    case '3D_UPDATE_TRANSFORMS':
      callbacks.onUpdateTransforms?.(validated.transforms);
      return;
    case '3D_MODEL_READY':
      if (state.modelDispatched) return;
      state.modelDispatched = true;
      callbacks.onModelReady(validated.payload);
      return;
    case 'DONE':
      // The script has finished and flushed every frame it is going to
      // send, so the sandbox can be retired.
      shutdown();
      return;
    case 'ERROR':
      shutdown();
      callbacks.onError?.(
        new Error(`Worker script error: ${validated.message}`),
      );
      return;
    default: {
      const exhaustiveCheck: never = validated;
      return exhaustiveCheck;
    }
  }
}

type SandboxExecutionJob =
  | {readonly kind: 'script'; readonly script: string}
  | {readonly kind: 'url'; readonly scriptUrl: string};

function executeInSandboxIframe(
  job: SandboxExecutionJob,
  engineSrc: string,
  iframeSrc: string,
  callbacks: ScriptExecutionCallbacks,
): ScriptExecutionHandle {
  const nonce = newSandboxNonce();
  const workerSource = buildSandboxWorkerSource(
    engineSrc,
    nonce,
    job.kind === 'url'
      ? {allowClientScripts: false, allowedScriptUrl: job.scriptUrl}
      : {allowClientScripts: true, allowedScriptUrl: null},
  );
  const iframe = document.createElement('iframe');
  // Omit `allow-same-origin` so the iframe and its Worker run in a unique
  // opaque origin (`origin === "null"`) with an independent CSP.
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.display = 'none';
  iframe.src = iframeSrc;

  liveSandboxWorkers++;
  let settled = false;
  let runMessageSent = false;
  const dispatchState: SandboxDispatchState = {modelDispatched: false};
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const sendRunPayload = (): void => {
    if (settled || runMessageSent) return;
    const targetWindow = iframe.contentWindow;
    if (!targetWindow || typeof targetWindow.postMessage !== 'function') {
      return;
    }
    runMessageSent = true;
    targetWindow.postMessage(
      job.kind === 'url'
        ? {
            type: 'SANDBOX_RUN',
            nonce,
            workerSource,
            scriptUrl: job.scriptUrl,
          }
        : {
            type: 'SANDBOX_RUN',
            nonce,
            workerSource,
            script: job.script,
          },
      '*',
    );
  };

  let shutdown = (): void => {};

  const onWindowMessage = (event: MessageEvent): void => {
    if (settled) return;
    if (!iframe.contentWindow || event.source !== iframe.contentWindow) {
      return;
    }
    const rawData = event.data;
    if (
      rawData &&
      typeof rawData === 'object' &&
      // Safe cast: `rawData` is verified to be a non-null object above.
      (rawData as Record<string, unknown>)['type'] === 'IFRAME_READY'
    ) {
      sendRunPayload();
      return;
    }
    const validated = validateSandboxWorkerMessage(rawData, nonce);
    if (!validated) return;
    dispatchValidatedSandboxMessage(
      validated,
      callbacks,
      shutdown,
      dispatchState,
    );
  };

  shutdown = (): void => {
    if (settled) return;
    settled = true;
    if (watchdog !== undefined) clearTimeout(watchdog);
    liveSandboxWorkers = Math.max(0, liveSandboxWorkers - 1);
    if (typeof globalThis.removeEventListener === 'function') {
      globalThis.removeEventListener('message', onWindowMessage);
    }
    if (typeof iframe.remove === 'function') {
      iframe.remove();
    } else if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  watchdog = setTimeout(() => {
    if (settled) return;
    const error = new Error(
      'SecurityError: Sandboxed script exceeded ' +
        `SECURITY_3D_SANDBOX_TIMEOUT_MS (${SECURITY_3D_SANDBOX_TIMEOUT_MS} ms) ` +
        'and was terminated.',
    );
    shutdown();
    callbacks.onError?.(error);
    callbacks.onToast?.('Security Error: script timed out and was stopped.');
  }, SECURITY_3D_SANDBOX_TIMEOUT_MS);

  if (typeof globalThis.addEventListener === 'function') {
    globalThis.addEventListener('message', onWindowMessage);
  }

  iframe.onload = (): void => {
    sendRunPayload();
  };
  iframe.onerror = (): void => {
    shutdown();
    callbacks.onError?.(
      new Error(
        `Sandbox iframe failed to load "${iframeSrc}". Verify that three-live-sandbox.html is served at that URL.`,
      ),
    );
  };

  const container = document.body || document.documentElement;
  if (!container || typeof container.appendChild !== 'function') {
    shutdown();
    const error = new Error(
      'SecurityError: Cannot mount sandbox iframe because document.body is unavailable.',
    );
    callbacks.onError?.(error);
    throw error;
  }
  container.appendChild(iframe);
  return {terminate: shutdown};
}

function runSandboxedJob(
  job: SandboxExecutionJob,
  sandbox: SandboxMode | string,
  callbacks: ScriptExecutionCallbacks,
  reject: (
    message: string,
    toast?: string,
  ) => Promise<ScriptExecutionHandle | void>,
): Promise<ScriptExecutionHandle | void> {
  if (sandbox === 'worker' && typeof Worker === 'undefined') {
    return reject(
      'Sandboxed procedural execution requires Web Workers, but Workers are ' +
        'unavailable in this environment. For host security, Three-Live ' +
        'prohibits unsandboxed in-process evaluation.',
      'Security Error: Web Workers unavailable. Script execution aborted.',
    );
  }

  if (
    sandbox === 'iframe' &&
    (typeof document === 'undefined' ||
      typeof document.createElement !== 'function')
  ) {
    return reject(
      'Sandboxed iframe execution requires a DOM environment with ' +
        'document.createElement. Refusing to evaluate in the host realm.',
      'Security Error: DOM unavailable for iframe sandbox.',
    );
  }

  if (liveSandboxWorkers >= SECURITY_3D_MAX_CONCURRENT_TASKS) {
    return reject(
      `SecurityError: ${liveSandboxWorkers} sandbox workers are already ` +
        'running, which meets SECURITY_3D_MAX_CONCURRENT_TASKS ' +
        `(${SECURITY_3D_MAX_CONCURRENT_TASKS}). Refusing to start another.`,
      'Security Error: too many concurrent sandboxed scripts.',
    );
  }

  let engineSrc: string;
  try {
    engineSrc = resolveSandboxEngineSrc();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return reject(
      message,
      'Security Error: sandbox engine URL is not configured.',
    );
  }

  if (sandbox === 'iframe') {
    let iframeSrc: string;
    try {
      iframeSrc = resolveSandboxIframeSrc();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reject(
        message,
        'Security Error: sandbox iframe URL is not configured.',
      );
    }
    try {
      return Promise.resolve(
        executeInSandboxIframe(job, engineSrc, iframeSrc, callbacks),
      );
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  const nonce = newSandboxNonce();
  const workerSource = buildSandboxWorkerSource(
    engineSrc,
    nonce,
    job.kind === 'url'
      ? {allowClientScripts: false, allowedScriptUrl: job.scriptUrl}
      : {allowClientScripts: true, allowedScriptUrl: null},
  );
  let worker: Worker;
  try {
    const blob = new Blob([workerSource], {
      type: 'application/javascript',
    });
    const workerUrl = URL.createObjectURL(blob);
    try {
      const trustedUrl = toTrustedWorkerScriptURL(workerUrl);
      // Double cast is necessary to bridge `TrustedScriptURLLike` to the
      // `Worker` constructor parameter, which browsers accept at runtime
      // under `require-trusted-types-for 'script'` even though `lib.dom.d.ts`
      // types it as `string | URL`.
      worker = new Worker(trustedUrl as unknown as string);
    } finally {
      URL.revokeObjectURL(workerUrl);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return reject(
      'Failed to initialize Web Worker for sandboxed execution (CSP may ' +
        `block blob workers): ${message}`,
      'Security Error: Failed to start Worker sandbox.',
    );
  }

  liveSandboxWorkers++;
  let settled = false;
  const dispatchState: SandboxDispatchState = {modelDispatched: false};
  let watchdog: ReturnType<typeof setTimeout> | undefined;

  const shutdown = (): void => {
    if (settled) return;
    settled = true;
    if (watchdog !== undefined) clearTimeout(watchdog);
    liveSandboxWorkers = Math.max(0, liveSandboxWorkers - 1);
    worker.terminate();
  };

  watchdog = setTimeout(() => {
    if (settled) return;
    const error = new Error(
      'SecurityError: Sandboxed script exceeded ' +
        `SECURITY_3D_SANDBOX_TIMEOUT_MS (${SECURITY_3D_SANDBOX_TIMEOUT_MS} ms) ` +
        'and was terminated.',
    );
    shutdown();
    callbacks.onError?.(error);
    callbacks.onToast?.('Security Error: script timed out and was stopped.');
  }, SECURITY_3D_SANDBOX_TIMEOUT_MS);

  worker.onmessage = (event: MessageEvent): void => {
    const validated = validateSandboxWorkerMessage(event.data, nonce);
    if (!validated) return;
    dispatchValidatedSandboxMessage(
      validated,
      callbacks,
      shutdown,
      dispatchState,
    );
  };

  worker.onerror = (event: ErrorEvent): void => {
    shutdown();
    callbacks.onError?.(new Error(`Worker execution error: ${event.message}`));
  };

  if (job.kind === 'url') {
    worker.postMessage({
      type: 'EXECUTE_URL',
      scriptUrl: job.scriptUrl,
      nonce,
    });
  } else {
    worker.postMessage({type: 'EXECUTE', script: job.script, nonce});
  }
  return Promise.resolve({terminate: shutdown});
}

function validateRequestedSandboxMode(
  sandbox: SandboxMode | string,
  reject: (
    message: string,
    toast?: string,
  ) => Promise<ScriptExecutionHandle | void>,
): Promise<ScriptExecutionHandle | void> | null {
  if (sandbox === 'none' || sandbox === 'unsafe-host-realm') {
    return reject(
      `SecurityError: sandbox="${sandbox}" is prohibited. Sandboxing is ` +
        'mandatory for live compilation and cannot be bypassed. Use ' +
        'sandbox="worker" (default) or sandbox="iframe".',
      `Security Error: sandbox="${sandbox}" is not permitted.`,
    );
  }

  if (sandbox !== 'worker' && sandbox !== 'iframe') {
    return reject(
      `SecurityError: Unsupported sandbox mode "${sandbox}". Live ` +
        'compilation requires sandbox="worker" or sandbox="iframe".',
      'Security Error: unsupported sandbox mode.',
    );
  }
  return null;
}

/**
 * Sandboxed procedural Three.js script runner supporting both server-generated
 * script URLs (`executeUrl`) and opt-in client script strings (`execute`).
 */
export const authorScriptRunner: ScriptRunner = {
  execute(
    script: string,
    sandbox: SandboxMode | string,
    callbacks: ScriptExecutionCallbacks,
    options?: ScriptExecutionOptions,
  ): Promise<ScriptExecutionHandle | void> {
    const reject = (
      message: string,
      toast?: string,
    ): Promise<ScriptExecutionHandle | void> => {
      const error = new Error(message);
      callbacks.onError?.(error);
      if (toast) callbacks.onToast?.(toast);
      return Promise.reject(error);
    };

    const modeError = validateRequestedSandboxMode(sandbox, reject);
    if (modeError) return modeError;

    try {
      assertScriptWithinBudget(script);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reject(message, 'Security Error: script exceeds the size limit.');
    }

    const clientScriptsAllowed =
      options?.allowClientScripts ?? getAllowClientScripts();
    if (!clientScriptsAllowed) {
      return reject(
        'SecurityError: Client-modified script compilation (Use Case 1) is ' +
          'disabled by default to satisfy strict CSP and Trusted Types ' +
          'requirements. Use script-src="..." or loadScriptFromSrc(url) for ' +
          'server-generated scripts (Use Case 2), or explicitly opt in via ' +
          'ThreeLiveElement.allowClientScripts = true (or the ' +
          'allow-client-scripts attribute).',
        'Security Error: client-side scripts require allow-client-scripts opt-in.',
      );
    }

    return runSandboxedJob(
      {kind: 'script', script},
      sandbox,
      callbacks,
      reject,
    );
  },

  executeUrl(
    scriptUrl: string,
    sandbox: SandboxMode | string,
    callbacks: ScriptExecutionCallbacks,
  ): Promise<ScriptExecutionHandle | void> {
    const reject = (
      message: string,
      toast?: string,
    ): Promise<ScriptExecutionHandle | void> => {
      const error = new Error(message);
      callbacks.onError?.(error);
      if (toast) callbacks.onToast?.(toast);
      return Promise.reject(error);
    };

    const modeError = validateRequestedSandboxMode(sandbox, reject);
    if (modeError) return modeError;

    let resolvedScriptUrl: string;
    try {
      resolvedScriptUrl = resolveSandboxScriptUrl(scriptUrl);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reject(message, 'Security Error: disallowed scene script URL.');
    }

    return runSandboxedJob(
      {kind: 'url', scriptUrl: resolvedScriptUrl},
      sandbox,
      callbacks,
      reject,
    );
  },
};

const unsupportedWarnings = new Set<string>();

export function warnUnsupported(feature: string, fallback: string): void {
  const msg = `[three-live] ${feature} is unsupported; degraded to ${fallback}.`;
  if (!unsupportedWarnings.has(msg)) {
    unsupportedWarnings.add(msg);
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(msg);
    }
  }
}

export function getAuthorWarnings(): string[] {
  return Array.from(unsupportedWarnings);
}

export function clearAuthorWarnings(): void {
  unsupportedWarnings.clear();
}

export class ShaderMaterial extends MeshStandardMaterial {
  public uniforms: Record<string, any>;
  constructor(params: Record<string, any> = {}) {
    warnUnsupported('ShaderMaterial', 'MeshStandardMaterial');
    const u = params.uniforms || {};
    const rawCol =
      u.color?.value ?? u.uColor?.value ?? u.diffuse?.value ?? params.color;
    super({
      color: rawCol !== undefined ? rawCol : 0x808080,
      opacity: u.opacity?.value ?? params.opacity ?? 1.0,
      transparent: Boolean(params.transparent),
      wireframe: Boolean(params.wireframe),
      side: params.side,
    });
    this.uniforms = u;
  }
}

export const RawShaderMaterial = ShaderMaterial;

export class PolyhedronFallbackGeometry extends SphereGeometry {
  constructor(radius = 1, detail = 0, name = 'PolyhedronGeometry') {
    warnUnsupported(name, 'SphereGeometry');
    const seg = Math.max(4, Math.min(32, 4 << Math.min(detail, 3)));
    super(radius, seg, seg);
  }
}

export class IcosahedronGeometry extends PolyhedronFallbackGeometry {
  constructor(radius = 1, detail = 0) {
    super(radius, detail, 'IcosahedronGeometry');
  }
}

export class OctahedronGeometry extends PolyhedronFallbackGeometry {
  constructor(radius = 1, detail = 0) {
    super(radius, detail, 'OctahedronGeometry');
  }
}

export class DodecahedronGeometry extends PolyhedronFallbackGeometry {
  constructor(radius = 1, detail = 0) {
    super(radius, detail, 'DodecahedronGeometry');
  }
}

export class TetrahedronGeometry extends PolyhedronFallbackGeometry {
  constructor(radius = 1, detail = 0) {
    super(radius, detail, 'TetrahedronGeometry');
  }
}

export class CapsuleGeometry extends CylinderGeometry {
  constructor(radius = 1, length = 1, _capSegments = 4, radialSegments = 8) {
    warnUnsupported('CapsuleGeometry', 'CylinderGeometry');
    super(radius, radius, length + radius * 2, radialSegments);
  }
}

export class RingGeometry extends CylinderGeometry {
  constructor(_innerRadius = 0.5, outerRadius = 1, thetaSegments = 16) {
    warnUnsupported('RingGeometry', 'CylinderGeometry');
    super(outerRadius, outerRadius, 0.01, Math.max(8, thetaSegments));
  }
}

export class CircleGeometry extends CylinderGeometry {
  constructor(radius = 1, segments = 16) {
    warnUnsupported('CircleGeometry', 'CylinderGeometry');
    super(radius, radius, 0.01, Math.max(8, segments));
  }
}

export class SpotLight extends PointLight {
  public target: Object3D = new Object3D();
  public angle: number = Math.PI / 3;
  public penumbra: number = 0;
  constructor(
    color?: any,
    intensity?: number,
    distance = 0,
    angle = Math.PI / 3,
    penumbra = 0,
    decay = 2,
  ) {
    warnUnsupported('SpotLight', 'PointLight');
    super(color, intensity, distance, decay);
    this.angle = angle;
    this.penumbra = penumbra;
  }
}

export class HemisphereLight extends AmbientLight {
  public groundColor: Color;
  constructor(skyColor?: any, groundColor?: any, intensity?: number) {
    warnUnsupported('HemisphereLight', 'AmbientLight');
    super(skyColor, intensity);
    this.groundColor = new Color(groundColor ?? 0x444444);
  }
}

export const RectAreaLight = HemisphereLight;

const threeExports: Record<string, any> = {
  Vector2,
  Vector3,
  Vector4,
  Euler,
  Quaternion,
  Matrix4,
  Matrix3,
  Color,
  MathUtils,
  BufferAttribute,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Uint32BufferAttribute,
  BufferGeometry,
  BoxGeometry,
  PlaneGeometry,
  SphereGeometry,
  CylinderGeometry,
  ConeGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  DodecahedronGeometry,
  TetrahedronGeometry,
  CapsuleGeometry,
  RingGeometry,
  CircleGeometry,
  Texture,
  TextureLoader,
  Material,
  MeshStandardMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  ShaderMaterial,
  RawShaderMaterial,
  Object3D,
  Group,
  Mesh,
  Light,
  AmbientLight,
  DirectionalLight,
  PointLight,
  SpotLight,
  HemisphereLight,
  RectAreaLight,
  Camera,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Clock,
  SceneQuotaValidator,
  exportSceneToCanvas3D,
  exportSceneToGLB,
  exportSceneToUSDZ,
  generateUSDZ,
  glbToUSDZ,
  sceneToCanvas3D,
  sceneToGLB,
  sceneToUSDZ,
  authorScriptRunner,
  getAuthorWarnings,
  clearAuthorWarnings,
};

Object.freeze(SceneQuotaValidator);
Object.freeze(SceneQuotaValidator.prototype);
Object.freeze(Scene.prototype);
Object.freeze(threeExports);

export const THREE: any = new Proxy(threeExports, {
  get: (target, prop) => {
    if (prop in target) return (target as Record<PropertyKey, unknown>)[prop];
    if (
      typeof prop === 'string' &&
      prop !== 'then' &&
      prop !== 'toJSON' &&
      !prop.startsWith('__')
    ) {
      warnUnsupported(`THREE.${prop}`, 'no-op proxy');
    }
    return noopProxy;
  },
  set: (_target, prop) => {
    throw new TypeError(
      `Cannot assign to read only property '${String(prop)}' of #<THREE>`,
    );
  },
  defineProperty: (_target, prop) => {
    throw new TypeError(
      `Cannot define property '${String(prop)}', object is not extensible`,
    );
  },
  deleteProperty: (_target, prop) => {
    throw new TypeError(`Cannot delete property '${String(prop)}' of #<THREE>`);
  },
  setPrototypeOf: () => {
    throw new TypeError('#<THREE> is not extensible');
  },
});

export const threeAuthorPlugin = {
  name: 'three_author',
  THREE,
};

export const threeMicroPlugin = threeAuthorPlugin;

let defaultScene = new Scene();
let defaultCamera = new PerspectiveCamera(45, 1, 0.1, 1000);
defaultCamera.position.set(0, 2, 5);

const globalRoot = (
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : this
) as any;

if (typeof globalRoot.THREE === 'undefined') {
  globalRoot.THREE = THREE;
}
if (typeof globalRoot.requestAnimationFrame !== 'function') {
  globalRoot.requestAnimationFrame = () => {
    warnUnsupported('requestAnimationFrame', 'single-frame static evaluation');
    return 0;
  };
}
if (typeof globalRoot.cancelAnimationFrame !== 'function') {
  globalRoot.cancelAnimationFrame = () => {};
}

if (typeof window !== 'undefined') {
  const win = window as any;
  win.ThreeLive = win.ThreeLive || {};
  win.ThreeLive.THREE = THREE;
  win.ThreeLivePlugins = win.ThreeLivePlugins || {};
  win.ThreeLivePlugins.threeAuthor = threeAuthorPlugin;
  win.ThreeLivePlugins['three_author'] = threeAuthorPlugin;
  win.ThreeLivePlugins['three-author'] = threeAuthorPlugin;
}

if (typeof ENABLE_SERVER_EXTRACT !== 'undefined' && ENABLE_SERVER_EXTRACT) {
  globalRoot.scene = defaultScene;
  globalRoot.camera = defaultCamera;
  if (typeof globalRoot.window === 'undefined') {
    globalRoot.window = {
      innerWidth: 1024,
      innerHeight: 768,
      devicePixelRatio: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  }
  if (typeof globalRoot.document === 'undefined') {
    globalRoot.document = {
      createElement: () => ({
        getContext: () => noopProxy,
        style: {},
        addEventListener: () => {},
      }),
      body: {appendChild: () => {}, style: {}},
      addEventListener: () => {},
    };
  }
  const resetSceneFn = function (): void {
    clearAuthorWarnings();
    defaultScene = new Scene();
    defaultCamera = new PerspectiveCamera(45, 1, 0.1, 1000);
    defaultCamera.position.set(0, 2, 5);
    globalRoot.scene = defaultScene;
    globalRoot.camera = defaultCamera;
  };
  Object.defineProperty(globalRoot, '__three_live_reset_scene__', {
    value: resetSceneFn,
    writable: false,
    configurable: false,
  });

  const extractSceneRawFn = function () {
    const rawMeshes: any[] = [];
    const materials: any[] = [];
    const lights: any[] = [];

    const materialRefs: Material[] = [];
    function getMaterialIndex(mat: Material | null): number | null {
      if (!mat) return null;
      let idx = materialRefs.indexOf(mat);
      if (idx === -1) {
        materialRefs.push(mat);
        let mapUrl = '';
        if (mat.map) {
          if (typeof mat.map === 'string') mapUrl = mat.map;
          else if ((mat.map as any).source) mapUrl = (mat.map as any).source;
          else if ((mat.map as any).image) mapUrl = (mat.map as any).image;
        }
        materials.push({
          name: mat.name || `Material_${materials.length}`,
          base_color: [
            mat.color.r,
            mat.color.g,
            mat.color.b,
            mat.opacity !== undefined ? mat.opacity : 1.0,
          ],
          metallic: mat.metalness !== undefined ? mat.metalness : 0.1,
          roughness: mat.roughness !== undefined ? mat.roughness : 0.5,
          double_sided: mat.side === 2 || mat.doubleSided,
          base_color_texture: mapUrl || null,
          clearcoat: mat.clearcoat || 0.0,
          clearcoat_roughness: mat.clearcoatRoughness || 0.0,
          transmission: mat.transmission || 0.0,
          ior: mat.ior !== undefined ? mat.ior : 1.5,
          thickness: mat.thickness || 0.0,
        });
        idx = materials.length - 1;
      }
      return idx;
    }

    function traverse(
      node: Object3D,
      currentPos: [number, number, number],
      scale: [number, number, number],
    ) {
      const pos: [number, number, number] = [
        currentPos[0] + node.position.x * scale[0],
        currentPos[1] + node.position.y * scale[1],
        currentPos[2] + node.position.z * scale[2],
      ];
      const nextScale: [number, number, number] = [
        scale[0] * node.scale.x,
        scale[1] * node.scale.y,
        scale[2] * node.scale.z,
      ];

      if (node instanceof Mesh && node.geometry) {
        const geo = node.geometry;
        const posAttr = geo.attributes.position;
        if (posAttr && posAttr.array) {
          rawMeshes.push({
            name: node.name || `Mesh_${rawMeshes.length}`,
            raw_positions: posAttr.array,
            raw_normals: geo.attributes.normal
              ? geo.attributes.normal.array
              : null,
            raw_uvs: geo.attributes.uv ? geo.attributes.uv.array : null,
            raw_indices: geo.index ? geo.index.array : null,
            vertex_count: posAttr.count,
            pos,
            scale: nextScale,
            material_index: getMaterialIndex(node.material),
            xr_traits_json:
              node.userData && node.userData.xr
                ? JSON.stringify(node.userData.xr)
                : null,
          });
        }
      } else if (node instanceof Light) {
        lights.push({
          light_type: node.type,
          color: [node.color.r, node.color.g, node.color.b],
          intensity: node.intensity,
          position: [pos[0], pos[1], pos[2]],
        });
      }

      for (const child of node.children) {
        traverse(child, pos, nextScale);
      }
    }

    const activeScene = globalRoot.scene || defaultScene;
    traverse(activeScene, [0, 0, 0], [1, 1, 1]);

    const activeCam = globalRoot.camera || defaultCamera;
    return {
      meshes: rawMeshes,
      materials,
      lights,
      camera: {
        fov: activeCam.fov || 45,
        position: activeCam.position
          ? [activeCam.position.x, activeCam.position.y, activeCam.position.z]
          : [0, 2, 5],
        target: activeCam.target
          ? [activeCam.target.x, activeCam.target.y, activeCam.target.z]
          : [0, 0, 0],
      },
    };
  };

  Object.defineProperty(globalRoot, '__three_live_extract_scene_raw__', {
    value: extractSceneRawFn,
    writable: false,
    configurable: false,
  });
}

export default THREE;
