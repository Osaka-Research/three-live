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

import {compileInteractivityGraph} from './interactivity-compiler';
import {
  CLIENT_SCRIPTS_DISABLED_ERROR,
  CLIENT_SCRIPTS_DISABLED_TOAST,
} from './messages';
import {getSharedRegistry} from './plugin';
import {installCadExtension} from './plugins/cad';
import {installIKExtension} from './plugins/ik';
import {installLodExtension} from './plugins/lod';
import {
  calculateCRC32,
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
import {registerSimTraitSchema} from './xr-sim-schema';
import {
  buildHubsExtension,
  buildXRSceneCoreExtension,
  normalizeXRTraits,
  registerXRTraitSerializer,
  type SchemaDiagnostic,
  validateXRTraits,
} from './xr-trait-schema';

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

  public divideScalar(s: number): this {
    return this.multiplyScalar(s ? 1 / s : 0);
  }

  public setScalar(s: number): this {
    return this.set(s, s);
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

  public divideScalar(s: number): this {
    return this.multiplyScalar(s ? 1 / s : 0);
  }

  public setScalar(s: number): this {
    return this.set(s, s, s);
  }

  public addScaledVector(v: Vector3, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
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

  public lerp(v: Vector3, alpha: number): this {
    return this.lerpVectors(this, v, alpha);
  }

  public lerpVectors(v1: Vector3, v2: Vector3, alpha: number): this {
    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    this.z = v1.z + (v2.z - v1.z) * alpha;
    return this;
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

  public identity(): this {
    return this.set(0, 0, 0, 1);
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
    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(halfAngle));
  }

  public normalize(): this {
    const l = Math.hypot(this._x, this._y, this._z, this._w);
    return l === 0
      ? this.set(0, 0, 0, 1)
      : this.set(this._x / l, this._y / l, this._z / l, this._w / l);
  }

  public setFromUnitVectors(vFrom: Vector3, vTo: Vector3): this {
    const r = vFrom.dot(vTo) + 1;
    if (r < 1e-6) {
      return (
        Math.abs(vFrom.x) > Math.abs(vFrom.z)
          ? this.set(-vFrom.y, vFrom.x, 0, 0)
          : this.set(0, -vFrom.z, vFrom.y, 0)
      ).normalize();
    }
    return this.set(
      vFrom.y * vTo.z - vFrom.z * vTo.y,
      vFrom.z * vTo.x - vFrom.x * vTo.z,
      vFrom.x * vTo.y - vFrom.y * vTo.x,
      r,
    ).normalize();
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

const srgbToLinear = (c: number): number =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const linearToSrgb = (c: number): number =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
const CSS_COLORS: Record<string, number> = {
  black: 0,
  white: 0xffffff,
  red: 0xff0000,
  green: 0x8000,
  lime: 0xff00,
  blue: 255,
  yellow: 0xffff00,
  cyan: 0xffff,
  aqua: 0xffff,
  magenta: 0xff00ff,
  fuchsia: 0xff00ff,
  gray: 0x808080,
  grey: 0x808080,
  silver: 0xc0c0c0,
  orange: 0xffa500,
  purple: 0x800080,
  pink: 0xffc0cb,
  gold: 0xffd700,
};

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
      return this.setHex(val);
    }
    if (typeof val === 'string') {
      return this.setStyle(val);
    }
    if (val && typeof val === 'object' && 'r' in val) {
      this.r = Number(val.r);
      this.g = Number(val.g);
      this.b = Number(val.b);
    }
    return this;
  }

  public setStyle(style: string): this {
    const s = style.trim().toLowerCase();
    if (s[0] === '#') {
      let h = s.slice(1);
      if (h.length === 3 || h.length === 4) {
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      } else if (h.length === 8) {
        h = h.slice(0, 6);
      }
      const hex = parseInt(h, 16);
      if (h.length === 6 && !Number.isNaN(hex)) this.setHex(hex);
    } else if (s in CSS_COLORS) {
      this.setHex(CSS_COLORS[s]);
    } else if (s.startsWith('hsl')) {
      const p = /^hsla?\(([^)]+)\)$/.exec(s)?.[1].trim().split(/[\s,/]+/);
      if (p && p.length >= 3) {
        this.setHSL(
          (parseFloat(p[0]) || 0) / 360,
          (parseFloat(p[1]) || 0) / 100,
          (parseFloat(p[2]) || 0) / 100,
        );
      }
    } else {
      const p = /^rgba?\(([^)]+)\)$/.exec(s)?.[1].trim().split(/[\s,/]+/);
      if (p && p.length >= 3) {
        const ch = (x: string) =>
          srgbToLinear(
            Math.max(
              0,
              Math.min(1, (parseFloat(x) || 0) / (x.endsWith('%') ? 100 : 255)),
            ),
          );
        this.setRGB(ch(p[0]), ch(p[1]), ch(p[2]));
      }
    }
    return this;
  }

  public setHSL(h: number, s: number, l: number): this {
    h = (((Number(h) || 0) % 1) + 1) % 1;
    s = Math.max(0, Math.min(1, Number(s) || 0));
    l = Math.max(0, Math.min(1, Number(l) || 0));
    if (s === 0) {
      const lin = srgbToLinear(l);
      return this.setRGB(lin, lin, lin);
    }
    const p = l <= 0.5 ? l * (1 + s) : l + s - l * s;
    const q = 2 * l - p;
    const hue2rgb = (t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return q + (p - q) * 6 * t;
      if (t < 1 / 2) return p;
      if (t < 2 / 3) return q + (p - q) * 6 * (2 / 3 - t);
      return q;
    };
    return this.setRGB(
      srgbToLinear(hue2rgb(h + 1 / 3)),
      srgbToLinear(hue2rgb(h)),
      srgbToLinear(hue2rgb(h - 1 / 3)),
    );
  }

  public lerp(c: Color, alpha: number): this {
    const t = Number(alpha) || 0;
    this.r += (c.r - this.r) * t;
    this.g += (c.g - this.g) * t;
    this.b += (c.b - this.b) * t;
    return this;
  }

  public lerpColors(c1: Color, c2: Color, alpha: number): this {
    const t = Number(alpha) || 0;
    this.r = c1.r + (c2.r - c1.r) * t;
    this.g = c1.g + (c2.g - c1.g) * t;
    this.b = c1.b + (c2.b - c1.b) * t;
    return this;
  }

  public multiplyScalar(s: number): this {
    const f = Number(s) || 0;
    this.r *= f;
    this.g *= f;
    this.b *= f;
    return this;
  }

  public setScalar(s: number): this {
    const f = Number(s) || 0;
    return this.setRGB(f, f, f);
  }

  public setHex(hex: number): this {
    const h = Math.floor(hex);
    this.r = srgbToLinear(((h >> 16) & 255) / 255);
    this.g = srgbToLinear(((h >> 8) & 255) / 255);
    this.b = srgbToLinear((h & 255) / 255);
    return this;
  }

  public setRGB(r: number, g: number, b: number): this {
    this.r = Number(r);
    this.g = Number(g);
    this.b = Number(b);
    return this;
  }

  public convertSRGBToLinear(): this {
    this.r = srgbToLinear(this.r);
    this.g = srgbToLinear(this.g);
    this.b = srgbToLinear(this.b);
    return this;
  }

  public convertLinearToSRGB(): this {
    this.r = linearToSrgb(this.r);
    this.g = linearToSrgb(this.g);
    this.b = linearToSrgb(this.b);
    return this;
  }

  public getHex(): number {
    const ch = (v: number) =>
      Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255);
    return (ch(this.r) << 16) | (ch(this.g) << 8) | ch(this.b);
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
      const fn = (globalThis as any).__three_live_native_f32_array__;
      this.array =
        typeof fn === 'function' ? fn(array) : new Float32Array(array);
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

  public setUsage(_usage: number): this {
    return this;
  }

  public clone(): BufferAttribute {
    const Ctor = (this.array as any)?.constructor || Float32Array;
    return new BufferAttribute(new Ctor(this.array), this.itemSize);
  }
}

export class Float32BufferAttribute extends BufferAttribute {
  constructor(array: any, itemSize: number) {
    const fn = (globalThis as any).__three_live_native_f32_array__;
    super(
      array instanceof Float32Array
        ? array
        : Array.isArray(array) && typeof fn === 'function'
          ? fn(array)
          : new Float32Array(array),
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
      const fn = (globalThis as any).__three_live_native_index_array__;
      if (typeof fn === 'function') {
        this.index = new BufferAttribute(fn(indices), 1);
      } else {
        let maxIdx = 0;
        for (const v of indices) if (v > maxIdx) maxIdx = v;
        this.index = new BufferAttribute(
          new (maxIdx > 65535 ? Uint32Array : Uint16Array)(indices),
          1,
        );
      }
    } else if (indices && indices.buffer) {
      this.index = new BufferAttribute(indices, 1);
    }
    return this;
  }

  public computeVertexNormals(): this {
    const pos = this.attributes.position;
    if (!pos) return this;
    const nativeFn = (globalThis as any)
      .__three_live_native_compute_vertex_normals__;
    if (typeof nativeFn === 'function') {
      const normals = nativeFn(pos.array, this.index?.array);
      this.setAttribute('normal', new BufferAttribute(normals, 3));
      return this;
    }
    const count = pos.count,
      pa = pos.array,
      normals = new Float32Array(count * 3),
      idx = this.index?.array,
      triLen = idx ? idx.length : count;
    for (let i = 0; i < triLen; i += 3) {
      const a3 = (idx ? idx[i] : i) * 3,
        b3 = (idx ? idx[i + 1] : i + 1) * 3,
        c3 = (idx ? idx[i + 2] : i + 2) * 3,
        bx = pa[b3],
        by = pa[b3 + 1],
        bz = pa[b3 + 2],
        cbx = pa[c3] - bx,
        cby = pa[c3 + 1] - by,
        cbz = pa[c3 + 2] - bz,
        abx = pa[a3] - bx,
        aby = pa[a3 + 1] - by,
        abz = pa[a3 + 2] - bz,
        nx = cby * abz - cbz * aby,
        ny = cbz * abx - cbx * abz,
        nz = cbx * aby - cby * abx;
      normals[a3] += nx;
      normals[a3 + 1] += ny;
      normals[a3 + 2] += nz;
      normals[b3] += nx;
      normals[b3 + 1] += ny;
      normals[b3 + 2] += nz;
      normals[c3] += nx;
      normals[c3 + 1] += ny;
      normals[c3 + 2] += nz;
    }

    // Normalize generated normals
    for (let i = 0; i < count * 3; i += 3) {
      const x = normals[i],
        y = normals[i + 1],
        z = normals[i + 2],
        len = Math.hypot(x, y, z) || 1;
      normals[i] = x / len;
      normals[i + 1] = y / len;
      normals[i + 2] = z / len;
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
    this.setAttribute('position', new BufferAttribute(positions, 3));
    this.setAttribute('normal', new BufferAttribute(normals, 3));
    this.setAttribute('uv', new BufferAttribute(uvs, 2));
    this.setIndex(indices);
  }

  public setFromPoints(pts: Array<{x: number; y: number; z?: number}>): this {
    const a: number[] = [];
    if (Array.isArray(pts)) {
      for (const p of pts) {
        a.push(Number(p?.x) || 0, Number(p?.y) || 0, Number(p?.z) || 0);
      }
    }
    return this.setAttribute('position', new BufferAttribute(a, 3));
  }

  computeBoundingBox(): {min: Vector3; max: Vector3} {
    const pos = this.attributes.position;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    if (pos && pos.count > 0) {
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        if (x < min.x) min.x = x;
        if (y < min.y) min.y = y;
        if (z < min.z) min.z = z;
        if (x > max.x) max.x = x;
        if (y > max.y) max.y = y;
        if (z > max.z) max.z = z;
      }
    } else {
      min.set(0, 0, 0);
      max.set(0, 0, 0);
    }
    this.boundingBox = {min, max};
    return this.boundingBox;
  }

  center(): this {
    const box = this.computeBoundingBox();
    return this.translate(
      -(box.min.x + box.max.x) * 0.5,
      -(box.min.y + box.max.y) * 0.5,
      -(box.min.z + box.max.z) * 0.5,
    );
  }

  private _xform(fn: (a: any, i: number) => void, norm?: boolean): this {
    const pos = this.attributes.position;
    if (pos) {
      const a = pos.array;
      for (let i = 0; i < a.length; i += 3) fn(a, i);
      pos.needsUpdate = true;
      if (norm) this.computeVertexNormals();
      this.computeBoundingBox();
    }
    return this;
  }

  public translate(x: number = 0, y: number = 0, z: number = 0): this {
    return this._xform((a, i) => {
      a[i] += x;
      a[i + 1] += y;
      a[i + 2] += z;
    });
  }

  public scale(x: number = 1, y: number = 1, z: number = 1): this {
    return this._xform((a, i) => {
      a[i] *= x;
      a[i + 1] *= y;
      a[i + 2] *= z;
    }, true);
  }

  private _rot(i0: number, i1: number, angle: number): this {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    for (const attr of [this.attributes.position, this.attributes.normal]) {
      if (!attr) continue;
      const a = attr.array;
      for (let i = 0; i < a.length; i += 3) {
        const u = a[i + i0],
          v = a[i + i1];
        a[i + i0] = u * c - v * s;
        a[i + i1] = u * s + v * c;
      }
      attr.needsUpdate = true;
    }
    return this;
  }

  public rotateX(angle: number): this {
    return this._rot(1, 2, angle);
  }

  public rotateY(angle: number): this {
    return this._rot(2, 0, angle);
  }

  public rotateZ(angle: number): this {
    return this._rot(0, 1, angle);
  }

  public applyMatrix4(matrix: Matrix4): this {
    const pos = this.attributes.position;
    if (pos && matrix?.elements) {
      const v = new Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrix);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      this.computeVertexNormals();
    }
    return this;
  }

  public clone(): BufferGeometry {
    const c = new BufferGeometry();
    c.name = this.name;
    for (const k of Object.keys(this.attributes)) {
      c.attributes[k] = this.attributes[k].clone();
    }
    if (this.index) c.index = this.index.clone();
    return c;
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
      -w2, -h2, d2, w2, -h2, d2, w2, h2, d2, -w2, h2, d2,
      w2, -h2, -d2, -w2, -h2, -d2, -w2, h2, -d2, w2, h2, -d2,
      -w2, h2, d2, w2, h2, d2, w2, h2, -d2, -w2, h2, -d2,
      -w2, -h2, -d2, w2, -h2, -d2, w2, -h2, d2, -w2, -h2, d2,
      w2, -h2, d2, w2, -h2, -d2, w2, h2, -d2, w2, h2, d2,
      -w2, -h2, -d2, -w2, -h2, d2, -w2, h2, d2, -w2, h2, -d2,
    ];
    const normals = [
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 0,
    ];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let f = 0; f < 6; f++) {
      const o = f * 4;
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    this.setFromBuffers(positions, normals, uvs, indices);
  }
}

export class PlaneGeometry extends BufferGeometry {
  constructor(
    width: number = 1,
    height: number = 1,
    widthSegments: number = 1,
    heightSegments: number = 1,
  ) {
    super();
    widthSegments = Math.max(1, Math.floor(widthSegments));
    heightSegments = Math.max(1, Math.floor(heightSegments));
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_plane__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(width, height, widthSegments, heightSegments);
        this.setFromBuffers(
          native.positions,
          native.normals,
          native.uvs,
          native.indices,
        );
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= heightSegments; j++) {
      const v = j / heightSegments;
      for (let i = 0; i <= widthSegments; i++) {
        const u = i / widthSegments;
        positions.push((u - 0.5) * width, (0.5 - v) * height, 0);
        normals.push(0, 0, 1);
        uvs.push(u, 1 - v);
        if (j > 0 && i > 0) {
          const a = (widthSegments + 1) * j + i - 1;
          const b = a - (widthSegments + 1);
          indices.push(b, a, b + 1, a, a + 1, b + 1);
        }
      }
    }

    this.setFromBuffers(positions, normals, uvs, indices);
  }
}

export class SphereGeometry extends BufferGeometry {
  constructor(
    radius: number = 1,
    widthSegments: number = 16,
    heightSegments: number = 12,
    phiStart: number = 0,
    phiLength: number = Math.PI * 2,
    thetaStart: number = 0,
    thetaLength: number = Math.PI,
  ) {
    super();
    widthSegments = Math.max(3, Math.floor(widthSegments));
    heightSegments = Math.max(2, Math.floor(heightSegments));
    const isFull =
      !phiStart &&
      !thetaStart &&
      Math.abs(phiLength - Math.PI * 2) < 1e-4 &&
      Math.abs(thetaLength - Math.PI) < 1e-4;
    if (
      isFull &&
      typeof ENABLE_NATIVE_HOOKS !== 'undefined' &&
      ENABLE_NATIVE_HOOKS
    ) {
      const nativeFn = (globalThis as any).__three_live_native_sphere__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(radius, widthSegments, heightSegments);
        this.setFromBuffers(
          native.positions,
          native.normals,
          native.uvs,
          native.indices,
        );
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);

    for (let j = 0; j <= heightSegments; j++) {
      const v = j / heightSegments;
      const phi = thetaStart + v * thetaLength;
      for (let i = 0; i <= widthSegments; i++) {
        const u = i / widthSegments;
        const theta = phiStart + u * phiLength;
        const nx = -Math.cos(theta) * Math.sin(phi);
        const ny = Math.cos(phi);
        const nz = Math.sin(theta) * Math.sin(phi);
        positions.push(radius * nx, radius * ny, radius * nz);
        normals.push(nx, ny, nz);
        uvs.push(u, 1 - v);
        if (j > 0 && i > 0) {
          const d = (widthSegments + 1) * j + i;
          const a = d - (widthSegments + 1);
          const b = a - 1;
          const c = d - 1;
          if (j !== 1 || thetaStart > 0) indices.push(a, b, d);
          if (j !== heightSegments || thetaEnd < Math.PI) indices.push(b, c, d);
        }
      }
    }

    this.setFromBuffers(positions, normals, uvs, indices);
  }
}

export class CylinderGeometry extends BufferGeometry {
  constructor(
    radiusTop: number = 1,
    radiusBottom: number = 1,
    height: number = 1,
    radialSegments: number = 16,
    heightSegments: number = 1,
    openEnded: boolean = false,
    thetaStart: number = 0,
    thetaLength: number = Math.PI * 2,
  ) {
    super();
    radialSegments = Math.max(3, Math.floor(radialSegments));
    heightSegments = Math.max(1, Math.floor(Number(heightSegments) || 1));
    const isStandard =
      heightSegments === 1 &&
      !openEnded &&
      !thetaStart &&
      Math.abs(thetaLength - Math.PI * 2) < 1e-4;
    if (
      isStandard &&
      typeof ENABLE_NATIVE_HOOKS !== 'undefined' &&
      ENABLE_NATIVE_HOOKS
    ) {
      const nativeFn = (globalThis as any).__three_live_native_cylinder__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(
          radiusTop,
          radiusBottom,
          height,
          radialSegments,
        );
        this.setFromBuffers(
          native.positions,
          native.normals,
          native.uvs,
          native.indices,
        );
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const halfHeight = height / 2;
    const slope = (radiusBottom - radiusTop) / (height || 1);

    for (let y = 0; y <= heightSegments; y++) {
      const v = y / heightSegments;
      const radius = v * (radiusBottom - radiusTop) + radiusTop;
      const py = halfHeight - v * height;
      for (let x = 0; x <= radialSegments; x++) {
        const u = x / radialSegments;
        const theta = thetaStart + u * thetaLength;
        const sinTheta = Math.sin(theta),
          cosTheta = Math.cos(theta),
          nl = Math.hypot(sinTheta, slope, cosTheta) || 1;
        positions.push(radius * sinTheta, py, radius * cosTheta);
        normals.push(sinTheta / nl, slope / nl, cosTheta / nl);
        uvs.push(u, 1 - v);
      }
    }

    const stride = radialSegments + 1;
    for (let y = 0; y < heightSegments; y++) {
      for (let x = 0; x < radialSegments; x++) {
        const a = y * stride + x;
        const b = a + stride;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }

    const addCap = (r: number, sign: number) => {
      if (openEnded || r <= 0) return;
      const py = sign * halfHeight;
      const centerIdx = positions.length / 3;
      positions.push(0, py, 0);
      normals.push(0, sign, 0);
      uvs.push(0.5, 0.5);
      const rimStart = positions.length / 3;
      for (let x = 0; x <= radialSegments; x++) {
        const theta = thetaStart + (x / radialSegments) * thetaLength;
        const sinTheta = Math.sin(theta),
          cosTheta = Math.cos(theta);
        positions.push(r * sinTheta, py, r * cosTheta);
        normals.push(0, sign, 0);
        uvs.push(cosTheta * 0.5 + 0.5, 0.5 + sign * sinTheta * 0.5);
      }
      for (let x = 0; x < radialSegments; x++) {
        indices.push(
          centerIdx,
          rimStart + x + (sign > 0 ? 0 : 1),
          rimStart + x + (sign > 0 ? 1 : 0),
        );
      }
    };
    addCap(radiusTop, 1);
    addCap(radiusBottom, -1);

    this.setFromBuffers(positions, normals, uvs, indices);
  }
}

export class ConeGeometry extends CylinderGeometry {
  constructor(
    radius: number = 1,
    height: number = 1,
    radialSegments: number = 16,
    heightSegments: number = 1,
    openEnded: boolean = false,
    thetaStart: number = 0,
    thetaLength: number = Math.PI * 2,
  ) {
    super(
      0,
      radius,
      height,
      radialSegments,
      heightSegments,
      openEnded,
      thetaStart,
      thetaLength,
    );
  }
}

export class TorusGeometry extends BufferGeometry {
  constructor(
    radius: number = 1,
    tube: number = 0.4,
    radialSegments: number = 12,
    tubularSegments: number = 48,
    arc: number = Math.PI * 2,
  ) {
    super();
    radialSegments = Math.max(3, Math.floor(radialSegments));
    tubularSegments = Math.max(3, Math.floor(tubularSegments));
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_torus__;
      if (typeof nativeFn === 'function') {
        const native = nativeFn(
          radius,
          tube,
          radialSegments,
          tubularSegments,
          arc,
        );
        this.setFromBuffers(
          native.positions,
          native.normals,
          native.uvs,
          native.indices,
        );
        return;
      }
    }
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cv = Math.cos(v),
        sv = Math.sin(v);
      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * arc;
        const cu = Math.cos(u),
          su = Math.sin(u);
        positions.push((radius + tube * cv) * cu, (radius + tube * cv) * su, tube * sv);
        normals.push(cv * cu, cv * su, sv);
        uvs.push(i / tubularSegments, j / radialSegments);
        if (j > 0 && i > 0) {
          const a = (tubularSegments + 1) * j + i - 1;
          const b = a - (tubularSegments + 1);
          indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
      }
    }

    this.setFromBuffers(positions, normals, uvs, indices);
  }
}

function buildSweptTube(
  geo: BufferGeometry,
  tubularSegments: number,
  radialSegments: number,
  tube: number,
  samplePt: (u: number, out: Vector3) => void,
): void {
  const tSegs = Math.max(2, Math.min(256, Math.floor(Number(tubularSegments) || 64)));
  const rSegs = Math.max(3, Math.min(64, Math.floor(Number(radialSegments) || 8)));
  const rad = Number(tube) || 0.1;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const pts: Vector3[] = [],
    T = new Vector3(),
    N = new Vector3(),
    B = new Vector3();
  for (let i = 0; i <= tSegs; i++) {
    const p = new Vector3();
    samplePt(i / tSegs, p);
    pts.push(p);
  }
  for (let i = 0; i <= tSegs; i++) {
    const u = i / tSegs,
      p1 = pts[i];
    T.subVectors(pts[Math.min(tSegs, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    if (i === 0) N.set(Math.abs(T.y) > 0.9 ? 1 : 0, Math.abs(T.y) > 0.9 ? 0 : 1, 0);
    B.crossVectors(T, N).normalize();
    N.crossVectors(B, T).normalize();
    for (let j = 0; j <= rSegs; j++) {
      const v = (j / rSegs) * Math.PI * 2,
        nx = -Math.cos(v),
        ny = Math.sin(v),
        ux = nx * N.x + ny * B.x,
        uy = nx * N.y + ny * B.y,
        uz = nx * N.z + ny * B.z;
      positions.push(p1.x + rad * ux, p1.y + rad * uy, p1.z + rad * uz);
      normals.push(ux, uy, uz);
      uvs.push(u, j / rSegs);
    }
  }
  const stride = rSegs + 1;
  for (let i = 1; i <= tSegs; i++) {
    const r1 = stride * (i - 1),
      r2 = r1 + stride;
    for (let j = 1; j <= rSegs; j++) {
      const a = r1 + j - 1,
        b = r2 + j - 1;
      indices.push(a, b, r1 + j, b, r2 + j, r1 + j);
    }
  }
  geo.setFromBuffers(positions, normals, uvs, indices);
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
        this.setFromBuffers(
          native.positions,
          native.normals,
          native.uvs,
          native.indices,
        );
        return;
      }
    }
    buildSweptTube(this, tubularSegments, radialSegments, tube, (uRatio, target) => {
      const u = uRatio * p * Math.PI * 2,
        quOverP = (q / p) * u,
        r0 = radius * (2 + Math.cos(quOverP)) * 0.5;
      target.set(r0 * Math.cos(u), r0 * Math.sin(u), radius * Math.sin(quOverP) * 0.5);
    });
  }
}

export class Curve3 {
  public getPoint(_t: number, out: Vector3 = new Vector3()): Vector3 {
    return out;
  }
  public getPointAt(u: number, out: Vector3 = new Vector3()): Vector3 {
    return this.getPoint(u, out);
  }
  public getTangent(t: number, out: Vector3 = new Vector3()): Vector3 {
    return out
      .subVectors(this.getPoint(Math.min(1, t + 0.001)), this.getPoint(Math.max(0, t - 0.001)))
      .normalize();
  }
  public getPoints(divisions: number = 5): Vector3[] {
    const d = Math.max(1, Math.min(512, Math.floor(Number(divisions) || 5)));
    const pts: Vector3[] = [];
    for (let i = 0; i <= d; i++) pts.push(this.getPoint(i / d));
    return pts;
  }
  public getSpacedPoints(divisions: number = 5): Vector3[] {
    return this.getPoints(divisions);
  }
}

export class LineCurve3 extends Curve3 {
  constructor(
    public v1: Vector3 = new Vector3(),
    public v2: Vector3 = new Vector3(),
  ) {
    super();
  }
  public override getPoint(t: number, out: Vector3 = new Vector3()): Vector3 {
    return out.lerpVectors(this.v1, this.v2, t);
  }
}

export class QuadraticBezierCurve3 extends Curve3 {
  constructor(
    public v0: Vector3 = new Vector3(),
    public v1: Vector3 = new Vector3(),
    public v2: Vector3 = new Vector3(),
  ) {
    super();
  }
  public override getPoint(t: number, out: Vector3 = new Vector3()): Vector3 {
    return out
      .lerpVectors(this.v0, this.v1, t)
      .lerp(new Vector3().lerpVectors(this.v1, this.v2, t), t);
  }
}

export class CubicBezierCurve3 extends Curve3 {
  constructor(
    public v0: Vector3 = new Vector3(),
    public v1: Vector3 = new Vector3(),
    public v2: Vector3 = new Vector3(),
    public v3: Vector3 = new Vector3(),
  ) {
    super();
  }
  public override getPoint(t: number, out: Vector3 = new Vector3()): Vector3 {
    const a = new Vector3().lerpVectors(this.v0, this.v1, t),
      b = new Vector3().lerpVectors(this.v1, this.v2, t),
      c = new Vector3().lerpVectors(this.v2, this.v3, t);
    return out.lerpVectors(a.lerp(b, t), b.lerp(c, t), t);
  }
}

export class CatmullRomCurve3 extends Curve3 {
  public points: Vector3[];
  public closed: boolean;
  constructor(points: Vector3[] = [], closed: boolean = false) {
    super();
    this.points = Array.isArray(points) ? points : [];
    this.closed = Boolean(closed);
  }
  public override getPoint(t: number, out: Vector3 = new Vector3()): Vector3 {
    const pts = this.points,
      n = pts.length;
    if (!n) return out.set(0, 0, 0);
    if (n === 1) return out.copy(pts[0]);
    const p = (this.closed ? n : n - 1) * Math.max(0, Math.min(1, Number(t) || 0));
    let k = Math.floor(p),
      w = p - k;
    if (!this.closed && k >= n - 1) {
      k = n - 2;
      w = 1;
    }
    const at = (i: number) =>
      pts[this.closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
    const p0 = at(k - 1),
      p1 = at(k),
      p2 = at(k + 1),
      p3 = at(k + 2),
      w2 = w * w,
      w3 = w2 * w;
    const cr = (v0: number, v1: number, v2: number, v3: number) =>
      0.5 *
      (2 * v1 +
        (v2 - v0) * w +
        (2 * v0 - 5 * v1 + 4 * v2 - v3) * w2 +
        (3 * v1 - v0 - 3 * v2 + v3) * w3);
    return out.set(
      cr(p0.x, p1.x, p2.x, p3.x),
      cr(p0.y, p1.y, p2.y, p3.y),
      cr(p0.z, p1.z, p2.z, p3.z),
    );
  }
}

export class LatheGeometry extends BufferGeometry {
  constructor(
    points: Array<{x: number; y: number}> = [
      new Vector2(0, -0.5),
      new Vector2(0.5, 0),
      new Vector2(0, 0.5),
    ],
    segments: number = 12,
    phiStart: number = 0,
    phiLength: number = Math.PI * 2,
  ) {
    super();
    const pts =
      Array.isArray(points) && points.length >= 2
        ? points
        : [new Vector2(0.2, 0), new Vector2(0.2, 0.5)];
    const segs = Math.max(3, Math.min(128, Math.floor(Number(segments) || 12)));
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const nPts = pts.length;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs,
        phi = phiStart + u * phiLength,
        sin = Math.sin(phi),
        cos = Math.cos(phi);
      for (let j = 0; j < nPts; j++) {
        const pt = pts[j],
          rx = Number(pt?.x) || 0,
          ry = Number(pt?.y) || 0;
        positions.push(rx * sin, ry, rx * cos);
        const prev = pts[Math.max(0, j - 1)],
          next = pts[Math.min(nPts - 1, j + 1)];
        const dx = (Number(next?.x) || 0) - (Number(prev?.x) || 0),
          dy = (Number(next?.y) || 0) - (Number(prev?.y) || 0),
          nl = Math.hypot(dy, dx) || 1;
        normals.push((dy / nl) * sin, -dx / nl, (dy / nl) * cos);
        uvs.push(u, j / (nPts - 1));
      }
    }
    for (let i = 0; i < segs; i++) {
      const base = i * nPts;
      for (let j = 0; j < nPts - 1; j++) {
        const a = base + j,
          b = base + nPts + j;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    this.setFromBuffers(positions, normals, uvs, indices);
  }
}

export class TubeGeometry extends BufferGeometry {
  constructor(
    path?: Curve3,
    tubularSegments: number = 64,
    radius: number = 1,
    radialSegments: number = 8,
    _closed: boolean = false,
  ) {
    super();
    buildSweptTube(this, tubularSegments, radialSegments, radius, (u, out) => {
      const fn = path?.getPointAt ?? path?.getPoint;
      if (typeof fn === 'function') {
        const pt = fn.call(path, u, out);
        if (pt && pt !== out) out.copy(pt);
      } else {
        out.set(0, u, 0);
      }
    });
  }
}

// =========================================================================
// 4. Materials & Textures
// =========================================================================

const B64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export class Texture {
  public source: string | any;
  public isTexture: boolean = true;
  public wrapS: number = 10497;
  public wrapT: number = 10497;
  public repeat: Vector2 = new Vector2(1, 1);
  public offset: Vector2 = new Vector2(0, 0);

  /**
   * Optional source image descriptor, mirroring `THREE.Texture.image`. Read by
   * {@link SceneQuotaValidator} to enforce SECURITY_3D_MAX_TEXTURE_DIMENSION.
   */
  image: {
    data?: ArrayLike<number> | null;
    width?: number;
    height?: number;
  } | null = null;
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

/**
 * Procedural pixel-buffer texture (`THREE.DataTexture`).
 *
 * Encodes raw pixel buffers (`Uint8Array`, `Uint8ClampedArray`, `Float32Array`,
 * or numeric arrays in `RGBAFormat`, `RGBFormat`, `RGFormat`/`LuminanceAlphaFormat`,
 * or `RedFormat`/`LuminanceFormat`/`AlphaFormat`) into an inline stored-DEFLATE
 * `data:image/png;base64,...` URI and computes linear `avgColor` for fallback
 * tinting on untextured targets.
 */
export class DataTexture extends Texture {
  public readonly isDataTexture: boolean = true;
  public avgColor: [number, number, number, number] = [1, 1, 1, 1];
  public format: number;
  public type: number;
  public magFilter: number;
  public minFilter: number;
  public flipY = false;
  public generateMipmaps = false;
  public unpackAlignment = 1;
  public colorSpace: string;
  private _sig = 0;

  constructor(
    data: ArrayBufferView | ArrayLike<number> | null = null,
    width: number = 1,
    height: number = 1,
    format: number = 1023,
    type: number = 1009,
    _mapping?: number,
    wrapS: number = 1001,
    wrapT: number = 1001,
    magFilter: number = 1003,
    minFilter: number = 1003,
    _anisotropy: number = 1,
    colorSpace: string = '',
  ) {
    super('');
    const w = Number(width);
    const h = Number(height);
    const pixelData =
      data && typeof (data as ArrayLike<number>).length === 'number'
        ? (data as ArrayLike<number>)
        : null;
    this.width = w;
    this.height = h;
    this.image = {data: pixelData, width: w, height: h};
    this.format = Number(format) || 1023;
    this.type = Number(type) || 1009;
    this.wrapS = Number(wrapS) || 1001;
    this.wrapT = Number(wrapT) || 1001;
    this.magFilter = Number(magFilter) || 1003;
    this.minFilter = Number(minFilter) || 1003;
    this.colorSpace = colorSpace || '';
    this._bake();
  }

  public get needsUpdate(): boolean {
    return false;
  }

  public set needsUpdate(v: boolean) {
    if (v) this._bake();
  }

  private _bake(): void {
    const img = this.image;
    const buf = img?.data;
    const rawW = Number(img?.width ?? this.width);
    const rawH = Number(img?.height ?? this.height);
    if (
      !buf ||
      !buf.length ||
      !(rawW > 0 && rawH > 0) ||
      rawW > SECURITY_3D_MAX_TEXTURE_DIMENSION ||
      rawH > SECURITY_3D_MAX_TEXTURE_DIMENSION
    ) {
      this.source = '';
      return;
    }
    const srcW = Math.max(1, rawW | 0);
    const srcH = Math.max(1, rawH | 0);
    const nPx = srcW * srcH;
    const f = this.format;
    const ch =
      f === 1021 || f === 1024 || f === 1028 || buf.length === nPx
        ? 1
        : f === 1025 || f === 1030 || buf.length === nPx * 2
          ? 2
          : f === 1022 || buf.length === nPx * 3
            ? 3
            : 4;
    const isFloat =
      this.type === 1015 ||
      this.type === 1016 ||
      buf instanceof Float32Array ||
      buf instanceof Float64Array;
    const dstW = Math.min(srcW, 48);
    const dstH = Math.min(srcH, 48);
    let sig = (this.flipY ? 257 : 1) ^ this.colorSpace.length ^ buf.length;
    const step = Math.max(1, (buf.length >> 6) | 0);
    for (let i = 0; i < buf.length; i += step) {
      sig = Math.imul(sig ^ ((buf[i] * 256) | 0), 16777619) | 0;
    }
    if (sig === this._sig && this.source) return;
    this._sig = sig;
    const rawLen = dstH * (1 + dstW * 4);
    const png = new Uint8Array(68 + rawLen);
    const dv = new DataView(png.buffer);
    dv.setUint32(0, 0x89504e47);
    dv.setUint32(4, 0x0d0a1a0a);
    dv.setUint32(8, 13);
    dv.setUint32(12, 0x49484452); // IHDR
    dv.setUint32(16, dstW);
    dv.setUint32(20, dstH);
    png[24] = 8;
    png[25] = 6;
    dv.setUint32(29, calculateCRC32(png.subarray(12, 29)));
    dv.setUint32(33, rawLen + 11);
    dv.setUint32(37, 0x49444154); // IDAT
    png[41] = 0x78;
    png[42] = 0x01;
    png[43] = 0x01;
    dv.setUint16(44, rawLen, true);
    dv.setUint16(46, ~rawLen & 0xffff, true);

    let p = 48;
    let s1 = 1;
    let s2 = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;
    const toByte = (v: number): number => {
      if (!Number.isFinite(v)) return 0;
      const x = isFloat && v <= 1 ? v * 255 : v;
      return x > 0 ? (x < 255 ? (x + 0.5) | 0 : 255) : 0;
    };
    for (let y = 0; y < dstH; y++) {
      const row = ((y * srcH) / dstH) | 0;
      const sy = this.flipY ? srcH - 1 - row : row;
      png[p++] = 0;
      s2 += s1;
      for (let x = 0; x < dstW; x++) {
        const i = (sy * srcW + (((x * srcW) / dstW) | 0)) * ch;
        const r = f === 1021 ? 255 : toByte(buf[i] ?? 0);
        const g =
          ch >= 3
            ? toByte(buf[i + 1] ?? 0)
            : f === 1030
              ? toByte(buf[i + 1] ?? 0)
              : r;
        const b = ch >= 3 ? toByte(buf[i + 2] ?? 0) : f === 1030 ? 0 : r;
        const a =
          ch === 4
            ? toByte(buf[i + 3] ?? 255)
            : f === 1021
              ? toByte(buf[i] ?? 255)
              : f === 1025
                ? toByte(buf[i + 1] ?? 255)
                : 255;
        png[p++] = r;
        s1 += r;
        s2 += s1;
        png[p++] = g;
        s1 += g;
        s2 += s1;
        png[p++] = b;
        s1 += b;
        s2 += s1;
        png[p++] = a;
        s1 += a;
        s2 += s1;
        sr += r;
        sg += g;
        sb += b;
        sa += a;
      }
      s1 %= 65521;
      s2 %= 65521;
    }
    dv.setUint32(p, ((s2 << 16) | s1) >>> 0);
    dv.setUint32(p + 4, calculateCRC32(png.subarray(37, p + 4)));
    dv.setUint32(p + 12, 0x49454e44); // IEND
    dv.setUint32(p + 16, 0xae426082);

    const cnt = dstW * dstH * 255;
    const lin = this.colorSpace === 'srgb-linear';
    this.avgColor = [
      lin ? sr / cnt : srgbToLinear(sr / cnt),
      lin ? sg / cnt : srgbToLinear(sg / cnt),
      lin ? sb / cnt : srgbToLinear(sb / cnt),
      sa / cnt,
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
    this.source = parts.join('');
  }
}

export class TextureLoader {
  public load(url: string, onLoad?: (tex: Texture) => void): Texture {
    const tex = new Texture(url);
    onLoad?.(tex);
    return tex;
  }
}

/** Returns `value` as a number, or `fallback` when it is undefined. */
function numberOr(value: unknown, fallback: number): number {
  return value !== undefined ? Number(value) : fallback;
}

/** Returns `value` as a boolean, or `fallback` when it is undefined. */
function booleanOr(value: unknown, fallback: boolean): boolean {
  return value !== undefined ? Boolean(value) : fallback;
}

export class Material {
  // All fields are assigned in the constructor; initializers here would only
  // be overwritten (and would ship twice in the bundle).
  public name: string;
  public color: Color;
  public emissive: Color;
  public emissiveIntensity: number;
  public roughness: number;
  public metalness: number;
  public opacity: number;
  public transparent: boolean;
  public wireframe: boolean;
  public side: number; // 2 = DoubleSide
  public doubleSided: boolean;
  public map: Texture | string | null;

  // Luxury PBR / Physical Material extensions
  public clearcoat: number;
  public clearcoatRoughness: number;
  public sheen: number;
  public sheenColor: Color;
  public sheenRoughness: number;
  public transmission: number;
  public thickness: number;
  public attenuationColor: Color;
  public attenuationDistance: number;
  public ior: number;
  public dispersion: number;
  public iridescence: number;
  public iridescenceIOR: number;

  constructor(params: Record<string, any> = {}) {
    this.name = params.name || '';
    this.color = new Color(
      params.color !== undefined ? params.color : 0xffffff,
    );
    this.emissive = new Color(
      params.emissive !== undefined ? params.emissive : 0x000000,
    );
    this.emissiveIntensity = numberOr(params.emissiveIntensity, 1.0);
    this.roughness = numberOr(params.roughness, 0.5);
    this.metalness = numberOr(params.metalness, 0.0);
    this.opacity = numberOr(params.opacity, 1.0);
    this.transparent = booleanOr(params.transparent, false);
    this.wireframe = booleanOr(params.wireframe, false);
    this.side = numberOr(params.side, 2);
    this.doubleSided = booleanOr(params.doubleSided, true);
    this.map = params.map || null;

    this.clearcoat = numberOr(params.clearcoat, 0.0);
    this.clearcoatRoughness = numberOr(params.clearcoatRoughness, 0.0);
    this.sheen = numberOr(params.sheen, 0.0);
    this.sheenColor = new Color(
      params.sheenColor !== undefined ? params.sheenColor : 0x000000,
    );
    this.sheenRoughness = numberOr(params.sheenRoughness, 0.0);
    this.transmission = numberOr(params.transmission, 0.0);
    this.thickness = numberOr(params.thickness, 0.0);
    this.attenuationColor = new Color(
      params.attenuationColor !== undefined
        ? params.attenuationColor
        : 0xffffff,
    );
    this.attenuationDistance = numberOr(params.attenuationDistance, Infinity);
    this.ior = numberOr(params.ior, 1.5);
    this.dispersion = numberOr(params.dispersion, 0.0);
    this.iridescence = numberOr(params.iridescence, 0.0);
    this.iridescenceIOR = numberOr(params.iridescenceIOR, 1.3);
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
    const seen = new Set<Object3D>();
    const stack: Object3D[] = [this];
    while (stack.length > 0) {
      const n = stack.pop()!;
      if (!n || typeof n !== 'object' || seen.has(n)) continue;
      seen.add(n);
      cb(n);
      const kids = n.children;
      if (Array.isArray(kids)) {
        for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
      }
    }
  }

  public updateMatrix(): void {
    this.matrix.compose(this.position, this.quaternion, this.scale);
  }

  public updateMatrixWorld(force: boolean = false): void {
    this.traverse((n) => {
      materializeDeclarativeGeometry(n);
      if (n.matrixAutoUpdate || force) n.updateMatrix?.();
      if (n.parent && n.parent.matrixWorld) {
        n.matrixWorld?.multiplyMatrices(n.parent.matrixWorld, n.matrix);
      } else if (n.matrix) {
        n.matrixWorld?.copy(n.matrix);
      }
    });
  }

  public lookAt(x: any, y?: number, z?: number): void {
    const target = typeof x === 'object' ? x : new Vector3(x, y, z);
    if ((this as any).target instanceof Vector3) {
      (this as any).target.copy(target);
    } else if ((this as any).target?.position instanceof Vector3) {
      (this as any).target.position.copy(target);
    }
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

  public translateOnAxis(axis: Vector3, d: number): this {
    const v = axis
      .clone()
      .applyMatrix4(new Matrix4().makeRotationFromQuaternion(this.quaternion))
      .multiplyScalar(d);
    this.position.add(v);
    return this;
  }

  public translateX(d: number): this {
    return this.translateOnAxis(new Vector3(1, 0, 0), d);
  }

  public translateY(d: number): this {
    return this.translateOnAxis(new Vector3(0, 1, 0), d);
  }

  public translateZ(d: number): this {
    return this.translateOnAxis(new Vector3(0, 0, 1), d);
  }

  public rotateX(a: number): this {
    this.rotation.x += a;
    return this;
  }

  public rotateY(a: number): this {
    this.rotation.y += a;
    return this;
  }

  public rotateZ(a: number): this {
    this.rotation.z += a;
    return this;
  }

  private _syncWorld(): Float32Array {
    const chain: Object3D[] = [];
    for (let p: Object3D | null = this; p && chain.length < 64; p = p.parent) chain.push(p);
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i]!;
      n.updateMatrix?.();
      if (n.parent?.matrixWorld) n.matrixWorld.multiplyMatrices(n.parent.matrixWorld, n.matrix);
      else n.matrixWorld?.copy(n.matrix);
    }
    return this.matrixWorld.elements;
  }

  public getWorldPosition(target: Vector3 = new Vector3()): Vector3 {
    const e = this._syncWorld();
    return target.set(e[12], e[13], e[14]);
  }

  public getWorldScale(target: Vector3 = new Vector3()): Vector3 {
    const e = this._syncWorld();
    return target.set(
      Math.hypot(e[0], e[1], e[2]),
      Math.hypot(e[4], e[5], e[6]),
      Math.hypot(e[8], e[9], e[10]),
    );
  }

  public getWorldDirection(target: Vector3 = new Vector3()): Vector3 {
    const e = this._syncWorld();
    return target.set(e[8], e[9], e[10]).normalize();
  }

  public getWorldQuaternion(target: Quaternion = new Quaternion()): Quaternion {
    const chain: Object3D[] = [];
    for (let p: Object3D | null = this; p && chain.length < 64; p = p.parent) chain.push(p);
    target.set(0, 0, 0, 1);
    for (let i = chain.length - 1; i >= 0; i--) target.multiply(chain[i]!.quaternion);
    return target;
  }

  public clone(recursive: boolean = true): this {
    const c: any =
      this instanceof Line
        ? new (this.constructor as any)(
            (this as any)._sourceGeo || (this as any).geometry,
            (this as any).material,
          )
        : this instanceof Mesh
          ? new Mesh((this as any).geometry, (this as any).material)
          : new (this.constructor as any)();
    c.name = this.name;
    c.position.copy(this.position);
    c.quaternion.copy(this.quaternion);
    c.scale.copy(this.scale);
    c.visible = this.visible;
    c.castShadow = this.castShadow;
    c.receiveShadow = this.receiveShadow;
    try {
      c.userData = JSON.parse(JSON.stringify(this.userData || {}));
    } catch (_) {
      c.userData = {...(this.userData || {})};
    }
    if (recursive) {
      for (const ch of this.children) c.add(ch.clone(true));
    }
    return c;
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

function materializeDeclarativeGeometry(node: Object3D): void {
  if (typeof (node as any)?._bakeAuthorGeometry === 'function') {
    (node as any)._bakeAuthorGeometry();
  }
  const hook = getSharedRegistry().materializeDeclarativeGeometry;
  if (typeof hook === 'function') {
    hook(node);
  }
}

/** Maximum number of instances permitted per `InstancedMesh` (DoS cap). */
export const MAX_INSTANCES_PER_MESH = 10000;

/**
 * Hardware-instanced mesh that renders `count` transforms (and optional
 * per-instance RGB colors) of a shared `BufferGeometry` + `Material`.
 * Serializes to `EXT_mesh_gpu_instancing` in glTF 2.0 / GLB.
 */
export class InstancedMesh extends Mesh {
  count: number;
  instanceMatrix: BufferAttribute;
  instanceColor: BufferAttribute | null = null;
  isInstancedMesh = true;

  constructor(geometry?: BufferGeometry, material?: Material, count = 1) {
    super(geometry, material);
    const n = Number(count);
    if (!Number.isFinite(n) || n < 0 || n > MAX_INSTANCES_PER_MESH) {
      throw new RangeError(
        `SecurityError: InstancedMesh count (${String(count)}) exceeds MAX_INSTANCES_PER_MESH (${MAX_INSTANCES_PER_MESH})`,
      );
    }
    this.count = Math.floor(n);
    const matArr = new Float32Array(this.count * 16);
    for (let i = 0; i < this.count; i++) {
      const base = i * 16;
      matArr[base] = 1;
      matArr[base + 5] = 1;
      matArr[base + 10] = 1;
      matArr[base + 15] = 1;
    }
    this.instanceMatrix = new BufferAttribute(matArr, 16);
  }

  setMatrixAt(index: number, matrix: Matrix4): void {
    const i = Math.floor(Number(index));
    if (
      !Number.isFinite(i) ||
      i < 0 ||
      i >= this.count ||
      !matrix ||
      !matrix.elements
    ) {
      return;
    }
    const dst = this.instanceMatrix.array as Float32Array;
    const base = i * 16;
    if (base + 16 > dst.length) return;
    for (let k = 0; k < 16; k++) {
      const v = Number(matrix.elements[k]);
      dst[base + k] = Number.isFinite(v) ? v : k % 5 === 0 ? 1 : 0;
    }
  }

  getMatrixAt(index: number, matrix: Matrix4): void {
    const i = Math.floor(Number(index));
    if (
      !Number.isFinite(i) ||
      i < 0 ||
      i >= this.count ||
      !matrix ||
      !matrix.elements
    ) {
      return;
    }
    const src = this.instanceMatrix.array as Float32Array;
    const base = i * 16;
    if (base + 16 > src.length) return;
    for (let k = 0; k < 16; k++) {
      matrix.elements[k] = src[base + k]!;
    }
  }

  setColorAt(index: number, color: Color): void {
    const i = Math.floor(Number(index));
    if (!Number.isFinite(i) || i < 0 || i >= this.count || !color) return;
    if (
      !this.instanceColor ||
      this.instanceColor.array.length < this.count * 3
    ) {
      const colArr = new Float32Array(this.count * 3);
      colArr.fill(1);
      this.instanceColor = new BufferAttribute(colArr, 3);
    }
    const dst = this.instanceColor.array as Float32Array;
    const base = i * 3;
    dst[base] = Number.isFinite(color.r) ? color.r : 1;
    dst[base + 1] = Number.isFinite(color.g) ? color.g : 1;
    dst[base + 2] = Number.isFinite(color.b) ? color.b : 1;
  }

  getColorAt(index: number, color: Color): void {
    const i = Math.floor(Number(index));
    if (!Number.isFinite(i) || i < 0 || i >= this.count || !color) return;
    if (!this.instanceColor || this.instanceColor.array.length < (i + 1) * 3) {
      color.setRGB(1, 1, 1);
      return;
    }
    const src = this.instanceColor.array as Float32Array;
    const base = i * 3;
    color.setRGB(src[base]!, src[base + 1]!, src[base + 2]!);
  }

  dispose(): void {}
}

export class Light extends Object3D {
  public color: Color;
  public intensity: number;
  public type: 'ambient' | 'directional' | 'point' | 'spot';

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
  public distance: number;
  public decay: number;
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
      materializeDeclarativeGeometry(obj);
      if (
        obj instanceof Mesh ||
        Boolean((obj as Mesh).geometry?.attributes?.position?.count)
      ) {
        meshCount++;
        if (meshCount > SECURITY_3D_MAX_MESHES) {
          fail('MESHES', SECURITY_3D_MAX_MESHES, meshCount);
        }
        if (obj instanceof InstancedMesh) {
          const instCount = finite('instance', obj.count);
          if (instCount < 0 || instCount > MAX_INSTANCES_PER_MESH) {
            fail('INSTANCES', MAX_INSTANCES_PER_MESH, instCount);
          }
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
  public isSandboxed: boolean;
  public containerId: string;
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
  if (
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as any).__three_live_sim_time_ms__ === 'number'
  ) {
    return (globalThis as any).__three_live_sim_time_ms__;
  }
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

function resolveAllowedUrl(url: string, label: string): string {
  if (!isAllowedSandboxEngineUrl(url)) {
    throw new Error(
      `SecurityError: Refusing to load ${label} from disallowed URL "${url}". ` +
        'Only http:, https:, and blob: URLs are permitted.',
    );
  }
  return new URL(url, getBaseHref()).href;
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
  return resolveAllowedUrl(src, 'sandbox engine');
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
  return resolveAllowedUrl(src, 'sandbox iframe');
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
  return resolveAllowedUrl(scriptUrl, 'procedural scene script');
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

/** Values baked into a generated sandbox worker. */
interface SandboxWorkerConfig {
  readonly nonce: string;
  readonly engineSrc: string;
  readonly allowedScriptUrl: string | null;
  readonly allowClientScripts: boolean;
  readonly revoked: readonly string[];
}

/**
 * The sandbox worker's entry point.
 *
 * This function is never called in the host realm. `buildSandboxWorkerSource`
 * serializes it with `Function.prototype.toString` and the worker evaluates it,
 * so it must stay self-contained: it may only use its `cfg` argument and worker
 * globals, never anything from this module's scope. Keeping it as real code
 * (rather than a template string) lets esbuild minify it.
 */
function sandboxWorkerMain(
  cfg: SandboxWorkerConfig,
  extInstallers?: Array<(threeNs: unknown, reg: unknown) => void>,
) {
  // The worker global is a WorkerGlobalScope whose members are revoked and
  // patched dynamically below, so it is deliberately untyped here.
  // tslint:disable-next-line:no-any
  const scope: any = self;
  const NONCE = cfg.nonce;
  const ENGINE_SRC = cfg.engineSrc;
  const ALLOWED_SCRIPT_URL = cfg.allowedScriptUrl;
  const ALLOW_CLIENT_SCRIPTS = cfg.allowClientScripts;
  const REVOKED = cfg.revoked;

  // Capture the channel back to the host before the author script can see it,
  // so it cannot forge a 3D_MODEL_READY message.
  const post = scope.postMessage.bind(scope);

  function fail(message: unknown) {
    post({type: 'ERROR', nonce: NONCE, message: String(message)});
  }

  // Capture importScripts in a private closure before scrubbing it from self
  // and WorkerGlobalScope.prototype, so Use Case 2 (server-generated scriptUrl)
  // can load the allowlisted script URL without exposing importScripts to the
  // scene script or requiring 'unsafe-eval'.
  let nativeImportScripts =
    typeof scope.importScripts === 'function'
      ? scope.importScripts.bind(scope)
      : null;
  let sceneScriptUrlToLoad: unknown = ALLOWED_SCRIPT_URL;
  // tslint:disable-next-line:no-any
  let createClientScript: any = null;

  try {
    let scriptUrlToLoad: unknown = ENGINE_SRC;
    if (
      typeof scope.trustedTypes !== 'undefined' &&
      scope.trustedTypes &&
      typeof scope.trustedTypes.createPolicy === 'function'
    ) {
      try {
        // tslint:disable-next-line:no-any
        const policyRules: any = {
          createScriptURL: function (u: string) {
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
          policyRules.createScript = function (s: string) {
            return String(s);
          };
        }
        const bootPolicy = scope.trustedTypes.createPolicy(
          'three-live#worker-boot',
          policyRules,
        );
        scriptUrlToLoad = bootPolicy.createScriptURL(ENGINE_SRC);
        if (ALLOWED_SCRIPT_URL) {
          sceneScriptUrlToLoad = bootPolicy.createScriptURL(ALLOWED_SCRIPT_URL);
        }
        if (
          ALLOW_CLIENT_SCRIPTS &&
          typeof bootPolicy.createScript === 'function'
        ) {
          createClientScript = bootPolicy.createScript.bind(bootPolicy);
        }
      } catch (trustedTypesError) {
        // Fall back to raw URLs if a restrictive policy list blocks creation.
      }
    }
    nativeImportScripts(scriptUrlToLoad);
  } catch (err) {
    fail(
      'Sandbox failed to load the Three-Live engine from "' +
        ENGINE_SRC +
        '". It must be a same-origin (or CORS-enabled) IIFE bundle such as ' +
        // tslint:disable-next-line:no-any
        'three-live.min.js. Underlying error: ' +
        ((err && (err as any).message) || err),
    );
    return;
  }

  const THREE = scope.THREE;
  if (!THREE || typeof THREE.Scene !== 'function') {
    fail(
      'Sandbox loaded "' +
        ENGINE_SRC +
        '" but it did not install a THREE ' +
        'namespace. Point sandboxEngineSrc at an IIFE build (three-live.min.js), ' +
        'not an ES module build.',
    );
    return;
  }

  if (Array.isArray(extInstallers)) {
    const reg = scope.__THREE_LIVE_REGISTRY__;
    for (let i = 0; i < extInstallers.length; i++) {
      if (typeof extInstallers[i] === 'function') {
        try {
          extInstallers[i](THREE, reg);
        } catch (extErr) {}
      }
    }
  }

  // Revoke ambient authority on self AND every prototype along the worker's
  // prototype chain (DedicatedWorkerGlobalScope.prototype -> WorkerGlobalScope.prototype)
  // so scripts cannot bypass self.fetch = undefined via
  // Object.getPrototypeOf(self).fetch.call(self, ...).
  function lockProto(key: string, val: unknown, ownOnly?: boolean) {
    let p = scope;
    while (p && p !== Object.prototype) {
      if (!ownOnly && p !== scope) {
        try {
          delete p[key];
        } catch {}
      }
      if (
        !ownOnly ||
        p === scope ||
        Object.prototype.hasOwnProperty.call(p, key)
      ) {
        try {
          Object.defineProperty(
            p,
            key,
            ownOnly
              ? {value: val, writable: false, configurable: false}
              : {
                  value: val,
                  writable: false,
                  configurable: false,
                  enumerable: false,
                },
          );
        } catch {}
      }
      try {
        p = Object.getPrototypeOf(p);
      } catch {
        break;
      }
    }
  }

  for (let i = 0; i < REVOKED.length; i++) {
    lockProto(REVOKED[i], undefined);
  }

  // Coarsen self.performance to millisecond resolution and strip resource-timing
  // methods while keeping performance.now() functional for THREE.Clock.
  lockProto(
    'performance',
    Object.freeze({
      now: function () {
        return Date.now();
      },
    }),
  );

  // The sandboxed WebGLRenderer legitimately posts scene updates via
  // self.postMessage, so this cannot simply throw. Instead, allowlist the two
  // scene message types and stamp the nonce on self AND across the prototype chain.
  const SCENE_MESSAGE_TYPES = ['3D_MODEL_READY', '3D_UPDATE_TRANSFORMS'];
  let sentModel = false;

  // tslint:disable-next-line:no-any
  function emit(msg: any, transfer?: Transferable[]) {
    if (msg.type === '3D_MODEL_READY') {
      if (sentModel) return;
      sentModel = true;
    }
    msg.nonce = NONCE;
    if (transfer && transfer.length) post(msg, transfer);
    else post(msg);
  }

  // tslint:disable-next-line:no-any
  const guardedPostMessage = function (msg: any, transfer?: Transferable[]) {
    if (!msg || SCENE_MESSAGE_TYPES.indexOf(msg.type) === -1) {
      throw new Error(
        'Sandboxed scripts may only post Three-Live scene messages (' +
          SCENE_MESSAGE_TYPES.join(', ') +
          ').',
      );
    }
    emit(msg, transfer);
  };

  lockProto('postMessage', guardedPostMessage, true);

  let started = false;

  // tslint:disable-next-line:no-any
  scope.onmessage = function (e: any) {
    const data = e && e.data;
    if (!data || data.nonce !== NONCE) return;
    if (data.type !== 'EXECUTE' && data.type !== 'EXECUTE_URL') return;
    if (started) return;
    started = true;

    try {
      let scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
      const renderer = new THREE.WebGLRenderer({isSandboxed: true});

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
        const urlToImport = sceneScriptUrlToLoad || ALLOWED_SCRIPT_URL;
        const runImport = nativeImportScripts;
        nativeImportScripts = null;
        sceneScriptUrlToLoad = null;
        scope.THREE = THREE;
        scope.scene = scene;
        scope.camera = camera;
        scope.renderer = renderer;
        runImport(urlToImport);
        if (typeof scope.__THREE_LIVE_SCENE__ === 'function') {
          const cbRet = scope.__THREE_LIVE_SCENE__(
            THREE,
            scene,
            camera,
            renderer,
          );
          if (cbRet && typeof cbRet.toGLB === 'function') {
            scene = cbRet;
          }
        } else if (scope.scene && typeof scope.scene.toGLB === 'function') {
          scene = scope.scene;
        }
      } else {
        if (!ALLOW_CLIENT_SCRIPTS) {
          fail(
            'SecurityError: Client-modified script compilation (Use Case 1) is disabled in this sandbox worker.',
          );
          return;
        }
        const runClientFn = createClientScript
          ? (0, eval)(
              createClientScript(
                '(function (THREE, scene, camera, renderer) {\n' +
                  'return (function () {\n' +
                  data.script +
                  '\n;\nreturn typeof scene === "object" && scene ? scene : undefined;\n})();\n})',
              ),
            )
          : new Function(
              'THREE',
              'scene',
              'camera',
              'renderer',
              'return (function () {\n' +
                data.script +
                '\n;\nreturn typeof scene === "object" && scene ? scene : undefined;\n})();',
            );
        createClientScript = null;
        const ret = runClientFn(THREE, scene, camera, renderer);
        if (ret && typeof ret.toGLB === 'function') {
          scene = ret;
        }
      }

      // Scripts that never call renderer.render() still get serialized.
      if (!sentModel) {
        if (THREE.SceneQuotaValidator) {
          THREE.SceneQuotaValidator.validate(scene);
        }
        const glbBytes = scene.toGLB();
        const glbBuffer =
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
      // tslint:disable-next-line:no-any
      fail((err && (err as any).message) || err);
    }
  };

  post({type: 'READY', nonce: NONCE});
}

/**
 * Builds the body of the sandbox worker.
 *
 * Exported so tests can execute it against a stub worker global: the result is
 * a plain string evaluated in another realm, so the compiler offers no
 * protection across that boundary.
 */
export function buildSandboxWorkerSource(
  engineSrc: string,
  nonce: string,
  options?: SandboxWorkerSourceOptions,
): string {
  const allowedScriptUrl = options?.allowedScriptUrl ?? null;
  const allowClientScripts =
    options?.allowClientScripts ?? allowedScriptUrl === null;
  const cfg: SandboxWorkerConfig = {
    nonce,
    engineSrc,
    allowedScriptUrl,
    allowClientScripts,
    revoked: REVOKED_WORKER_GLOBALS,
  };
  const installerExprs = (getSharedRegistry().workerExtensionInstallers ?? [])
    .map((fn) => `(${fn.toString()})`)
    .join(',');
  // The 'use strict' prologue applies to the whole worker script; a directive
  // inside the function could be stripped when the bundle is itself strict.
  return `'use strict';(${sandboxWorkerMain.toString()})(${JSON.stringify(cfg)},[${installerExprs}]);`;
}

/** Reports a sandbox job that hit SECURITY_3D_SANDBOX_TIMEOUT_MS. */
function reportSandboxTimeout(callbacks: ScriptExecutionCallbacks): void {
  callbacks.onError?.(
    new Error(
      'SecurityError: Sandboxed script exceeded ' +
        `SECURITY_3D_SANDBOX_TIMEOUT_MS (${SECURITY_3D_SANDBOX_TIMEOUT_MS} ms) ` +
        'and was terminated.',
    ),
  );
  callbacks.onToast?.('Security Error: script timed out and was stopped.');
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
    shutdown();
    reportSandboxTimeout(callbacks);
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
    shutdown();
    reportSandboxTimeout(callbacks);
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

const makeRunnerReject =
  (callbacks: ScriptExecutionCallbacks) =>
  (message: string, toast?: string): Promise<ScriptExecutionHandle | void> => {
    const error = new Error(message);
    callbacks.onError?.(error);
    if (toast) callbacks.onToast?.(toast);
    return Promise.reject(error);
  };

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
    const reject = makeRunnerReject(callbacks);

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
        CLIENT_SCRIPTS_DISABLED_ERROR,
        CLIENT_SCRIPTS_DISABLED_TOAST,
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
    const reject = makeRunnerReject(callbacks);

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

export class PolyhedronGeometry extends BufferGeometry {
  constructor(
    vertices: number[] = [],
    indices: number[] = [],
    radius: number = 1,
    detail: number = 0,
  ) {
    super();
    const r = Number(radius) || 1;
    const d = Math.max(0, Math.min(7, Math.floor(Number(detail) || 0)));
    const cols = d + 1;
    const pos: number[] = [];
    const norm: number[] = [];
    const uvs: number[] = [];
    const idx: number[] = [];
    const vA = new Vector3(),
      vB = new Vector3(),
      vC = new Vector3();
    const getV = (i: number, out: Vector3) =>
      out.set(vertices[i * 3] || 0, vertices[i * 3 + 1] || 0, vertices[i * 3 + 2] || 0);
    const pushV = (v: Vector3, n: Vector3) => {
      const p = v.clone().normalize();
      pos.push(p.x * r, p.y * r, p.z * r);
      norm.push(n.x, n.y, n.z);
      uvs.push(
        Math.atan2(p.z, -p.x) / (2 * Math.PI) + 0.5,
        1 - Math.acos(Math.max(-1, Math.min(1, p.y))) / Math.PI,
      );
    };
    const addTri = (a: Vector3, b: Vector3, c: Vector3) => {
      const base = pos.length / 3;
      const fn =
        d === 0
          ? new Vector3().subVectors(c, b).cross(new Vector3().subVectors(a, b)).normalize()
          : null;
      pushV(a, fn || a.clone().normalize());
      pushV(b, fn || b.clone().normalize());
      pushV(c, fn || c.clone().normalize());
      idx.push(base, base + 1, base + 2);
    };
    for (let f = 0; f < indices.length; f += 3) {
      getV(indices[f], vA);
      getV(indices[f + 1], vB);
      getV(indices[f + 2], vC);
      const grid: Vector3[][] = [];
      for (let i = 0; i <= cols; i++) {
        grid[i] = [];
        const aj = vA.clone().lerp(vC, i / cols),
          bj = vB.clone().lerp(vC, i / cols);
        const rows = cols - i;
        for (let j = 0; j <= rows; j++) {
          grid[i][j] = rows === 0 ? aj.clone() : aj.clone().lerp(bj, j / rows);
        }
      }
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < 2 * (cols - i) - 1; j++) {
          const k = j >> 1;
          if ((j & 1) === 0) addTri(grid[i][k + 1], grid[i + 1][k], grid[i][k]);
          else addTri(grid[i][k + 1], grid[i + 1][k + 1], grid[i + 1][k]);
        }
      }
    }
    this.setFromBuffers(pos, norm, uvs, idx);
  }
}

export const PolyhedronFallbackGeometry = PolyhedronGeometry;

export class TetrahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super(
      [1, 1, 1, -1, -1, 1, -1, 1, -1, 1, -1, -1],
      [2, 1, 0, 0, 3, 2, 1, 3, 0, 2, 3, 1],
      radius,
      detail,
    );
  }
}

const OCTA_V = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1];
const OCTA_I = [
  0, 2, 4, 0, 4, 3, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 3, 1, 3, 4, 1, 4, 2,
];

export class OctahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super(OCTA_V, OCTA_I, radius, detail);
  }
}

const ICO_T = (1 + Math.sqrt(5)) / 2;
export class IcosahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super(
      [
        -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T, 0,
        0, -1, ICO_T, 0, 1, ICO_T, 0, -1, -ICO_T, 0, 1, -ICO_T,
        ICO_T, 0, -1, ICO_T, 0, 1, -ICO_T, 0, -1, -ICO_T, 0, 1,
      ],
      [
        0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
        1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
        3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
        4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
      ],
      radius,
      detail,
    );
  }
}

const DOD_R = 1 / ICO_T;
export class DodecahedronGeometry extends PolyhedronGeometry {
  constructor(radius = 1, detail = 0) {
    super(
      [
        -1, -1, -1, -1, -1, 1, -1, 1, -1, -1, 1, 1,
        1, -1, -1, 1, -1, 1, 1, 1, -1, 1, 1, 1,
        0, -DOD_R, -ICO_T, 0, -DOD_R, ICO_T, 0, DOD_R, -ICO_T, 0, DOD_R, ICO_T,
        -DOD_R, -ICO_T, 0, -DOD_R, ICO_T, 0, DOD_R, -ICO_T, 0, DOD_R, ICO_T, 0,
        -ICO_T, 0, -DOD_R, ICO_T, 0, -DOD_R, -ICO_T, 0, DOD_R, ICO_T, 0, DOD_R,
      ],
      [
        3, 11, 7, 3, 7, 15, 3, 15, 13, 7, 19, 17, 7, 17, 6, 7, 6, 15,
        17, 4, 8, 17, 8, 10, 17, 10, 6, 8, 0, 16, 8, 16, 2, 8, 2, 10,
        0, 12, 1, 0, 1, 18, 0, 18, 16, 6, 10, 2, 6, 2, 13, 6, 13, 15,
        2, 16, 18, 2, 18, 3, 2, 3, 13, 18, 1, 9, 18, 9, 11, 18, 11, 3,
        4, 14, 12, 4, 12, 0, 4, 0, 8, 11, 9, 5, 11, 5, 19, 11, 19, 7,
        19, 5, 14, 19, 14, 4, 19, 4, 17, 1, 12, 14, 1, 14, 5, 1, 5, 9,
      ],
      radius,
      detail,
    );
  }
}

export class CapsuleGeometry extends LatheGeometry {
  constructor(radius = 1, length = 1, capSegments = 4, radialSegments = 8) {
    const r = Math.max(1e-4, Number(radius) || 1),
      hl = Math.max(0, Number.isFinite(Number(length)) ? Number(length) : 1) * 0.5,
      cs = Math.max(2, Math.min(64, Math.floor(Number(capSegments) || 4))),
      pts: Vector2[] = [];
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i <= cs; i++) {
        if (s > 0 && i === 0 && hl === 0) continue;
        const a = (s < 0 ? i / cs - 1 : i / cs) * (Math.PI / 2);
        pts.push(new Vector2(Math.max(0, Math.cos(a) * r), s * hl + Math.sin(a) * r));
      }
    }
    super(pts, Math.max(4, Math.min(128, Math.floor(Number(radialSegments) || 8))));
  }
}

export class RingGeometry extends BufferGeometry {
  constructor(
    innerRadius = 0.5,
    outerRadius = 1,
    thetaSegments = 32,
    phiSegments = 1,
    thetaStart = 0,
    thetaLength = Math.PI * 2,
  ) {
    super();
    const rA = Math.max(1e-4, Number(outerRadius) || 1),
      rawIn = Number(innerRadius),
      rB = Number.isFinite(rawIn) ? Math.max(0, rawIn) : rA * 0.5,
      outerR = Math.max(rA, rB),
      innerR = Math.min(outerR * 0.999, Math.min(rA, rB)),
      tSegs = Math.max(3, Math.min(256, Math.floor(Number(thetaSegments) || 32))),
      pSegs = Math.max(1, Math.min(64, Math.floor(Number(phiSegments) || 1))),
      t0 = Number.isFinite(Number(thetaStart)) ? Number(thetaStart) : 0,
      tL = Number.isFinite(Number(thetaLength)) ? Number(thetaLength) : Math.PI * 2,
      pos: number[] = [],
      norm: number[] = [],
      uvs: number[] = [],
      idx: number[] = [];
    for (let j = 0; j <= pSegs; j++) {
      const r = innerR + (j / pSegs) * (outerR - innerR);
      for (let i = 0; i <= tSegs; i++) {
        const th = t0 + (i / tSegs) * tL,
          c = Math.cos(th),
          s = Math.sin(th);
        pos.push(r * c, r * s, 0);
        norm.push(0, 0, 1);
        uvs.push((r / outerR) * c * 0.5 + 0.5, (r / outerR) * s * 0.5 + 0.5);
        if (j < pSegs && i < tSegs) {
          const a = j * (tSegs + 1) + i,
            b = a + tSegs + 1;
          if (r > 1e-6) idx.push(a, b, a + 1);
          idx.push(b, b + 1, a + 1);
        }
      }
    }
    this.setFromBuffers(pos, norm, uvs, idx);
  }
}

export class CircleGeometry extends RingGeometry {
  constructor(radius = 1, segments = 32, thetaStart = 0, thetaLength = Math.PI * 2) {
    super(0, radius, segments, 1, thetaStart, thetaLength);
  }
}

export class PointsMaterial extends Material {
  public size: number;
  public sizeAttenuation: boolean;
  constructor(params: Record<string, any> = {}) {
    super({roughness: 0.35, metalness: 0.1, side: 2, ...params});
    const s = Number(params.size);
    this.size = Number.isFinite(s) ? Math.max(0.002, Math.min(2, s)) : 0.05;
    this.sizeAttenuation = params.sizeAttenuation !== false;
    if (params.emissive === undefined) {
      this.emissive = this.color.clone();
      this.emissiveIntensity = 0.35;
    }
  }
}

export class LineBasicMaterial extends Material {
  public linewidth: number;
  constructor(params: Record<string, any> = {}) {
    super({roughness: 0.4, metalness: 0.1, side: 2, ...params});
    const lw = Number(params.linewidth);
    this.linewidth = Number.isFinite(lw) ? Math.max(0.5, Math.min(20, lw)) : 1;
    if (params.emissive === undefined) {
      this.emissive = this.color.clone();
      this.emissiveIntensity = 0.3;
    }
  }
}

export class LineDashedMaterial extends LineBasicMaterial {
  public dashSize: number;
  public gapSize: number;
  public scale: number;
  constructor(params: Record<string, any> = {}) {
    super(params);
    this.dashSize = Number(params.dashSize) || 3;
    this.gapSize = Number(params.gapSize) || 1;
    this.scale = Number(params.scale) || 1;
  }
}

function extractGeometryEdges(
  geometry?: BufferGeometry,
  thresholdAngleDeg?: number,
): Float32Array {
  const posAttr = geometry?.attributes?.position;
  if (!posAttr?.array || posAttr.count < 3) return new Float32Array(0);
  const pos = posAttr.array as Float32Array,
    idx = geometry?.index?.array,
    triCount = Math.min(8192, Math.floor((idx ? idx.length : posAttr.count) / 3)),
    vKey = (vi: number) =>
      `${Math.round((pos[vi * 3] || 0) * 1e4)},${Math.round((pos[vi * 3 + 1] || 0) * 1e4)},${Math.round((pos[vi * 3 + 2] || 0) * 1e4)}`,
    isWire = thresholdAngleDeg === undefined,
    threshCos = isWire ? 1 : Math.cos((thresholdAngleDeg * Math.PI) / 180),
    edgeMap: Record<string, {va: number; vb: number; nx: number; ny: number; nz: number; m: number}> = {},
    out: number[] = [],
    pushEdge = (a: number, b: number) =>
      out.push(
        pos[a * 3] || 0,
        pos[a * 3 + 1] || 0,
        pos[a * 3 + 2] || 0,
        pos[b * 3] || 0,
        pos[b * 3 + 1] || 0,
        pos[b * 3 + 2] || 0,
      );
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3]! : t * 3,
      i1 = idx ? idx[t * 3 + 1]! : t * 3 + 1,
      i2 = idx ? idx[t * 3 + 2]! : t * 3 + 2,
      ax = pos[i0 * 3] || 0,
      ay = pos[i0 * 3 + 1] || 0,
      az = pos[i0 * 3 + 2] || 0,
      abx = (pos[i1 * 3] || 0) - ax,
      aby = (pos[i1 * 3 + 1] || 0) - ay,
      abz = (pos[i1 * 3 + 2] || 0) - az,
      acx = (pos[i2 * 3] || 0) - ax,
      acy = (pos[i2 * 3 + 1] || 0) - ay,
      acz = (pos[i2 * 3 + 2] || 0) - az;
    let nx = aby * acz - abz * acy,
      ny = abz * acx - abx * acz,
      nz = abx * acy - aby * acx;
    const nLen = Math.hypot(nx, ny, nz);
    if (!isWire && nLen < 1e-8) continue;
    if (nLen > 0) {
      nx /= nLen;
      ny /= nLen;
      nz /= nLen;
    }
    const verts = [i0, i1, i2];
    for (let e = 0; e < 3; e++) {
      const va = verts[e]!,
        vb = verts[(e + 1) % 3]!,
        ka = vKey(va),
        kb = vKey(vb);
      if (ka === kb) continue;
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`,
        ex = edgeMap[ek];
      if (!ex) {
        edgeMap[ek] = {va, vb, nx, ny, nz, m: isWire ? 1 : 0};
        if (isWire) pushEdge(va, vb);
      } else if (!ex.m) {
        ex.m = 1;
        if (ex.nx * nx + ex.ny * ny + ex.nz * nz <= threshCos) pushEdge(va, vb);
      }
    }
  }
  if (!isWire) {
    const keys = Object.keys(edgeMap);
    for (let k = 0; k < keys.length; k++) {
      const rec = edgeMap[keys[k]!];
      if (rec && !rec.m) pushEdge(rec.va, rec.vb);
    }
  }
  return new Float32Array(out);
}

export class WireframeGeometry extends BufferGeometry {
  constructor(geometry?: BufferGeometry) {
    super();
    this.setAttribute('position', new BufferAttribute(extractGeometryEdges(geometry), 3));
    (this as any).__isSegmentPairs = true;
  }
}

export class EdgesGeometry extends BufferGeometry {
  constructor(geometry?: BufferGeometry, thresholdAngle = 1) {
    super();
    const deg = Number.isFinite(Number(thresholdAngle)) ? Number(thresholdAngle) : 1;
    this.setAttribute('position', new BufferAttribute(extractGeometryEdges(geometry, deg), 3));
    (this as any).__isSegmentPairs = true;
  }
}

function buildLinePrismGeometry(
  sourceGeo: BufferGeometry,
  mode: 'strip' | 'loop' | 'segments',
  linewidth = 1,
): BufferGeometry {
  const outGeo = new BufferGeometry();
  (outGeo as any).__baked = true;
  const posAttr = sourceGeo?.attributes?.position;
  if (!posAttr?.array || posAttr.count < 2) return outGeo;
  const pos = posAttr.array as Float32Array,
    idx = sourceGeo.index?.array,
    effMode = (sourceGeo as any).__isSegmentPairs ? 'segments' : mode,
    count = idx ? idx.length : posAttr.count,
    segCount = Math.min(
      4096,
      Math.max(
        0,
        effMode === 'segments'
          ? Math.floor(count / 2)
          : effMode === 'loop' && count >= 3
            ? count
            : count - 1,
      ),
    );
  if (segCount === 0) return outGeo;
  sourceGeo.computeBoundingBox();
  const bb = sourceGeo.boundingBox,
    diag = bb ? bb.max.distanceTo(bb.min) || 1 : 1,
    r =
      Math.max(0.0015, Math.min(0.025, diag * 0.003)) *
      (0.5 + 0.5 * Math.max(0.5, Math.min(6, Number(linewidth) || 1))),
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];

  for (let s = 0; s < segCount; s++) {
    const iA = effMode === 'segments' ? s * 2 : s,
      iB = effMode === 'segments' ? s * 2 + 1 : (s + 1) % count,
      v0 = idx ? idx[iA]! : iA,
      v1 = idx ? idx[iB]! : iB,
      x0 = pos[v0 * 3] || 0,
      y0 = pos[v0 * 3 + 1] || 0,
      z0 = pos[v0 * 3 + 2] || 0,
      dx = (pos[v1 * 3] || 0) - x0,
      dy = (pos[v1 * 3 + 1] || 0) - y0,
      dz = (pos[v1 * 3 + 2] || 0) - z0,
      len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) continue;
    const tx = dx / len,
      ty = dy / len,
      tz = dz / len,
      uLen = (Math.abs(ty) < 0.9 ? Math.hypot(tz, tx) : Math.hypot(tz, ty)) || 1,
      ux = Math.abs(ty) < 0.9 ? tz / uLen : 0,
      uy = Math.abs(ty) < 0.9 ? 0 : -tz / uLen,
      uz = Math.abs(ty) < 0.9 ? -tx / uLen : ty / uLen,
      vx = ty * uz - tz * uy,
      vy = tz * ux - tx * uz,
      vz = tx * uy - ty * ux,
      base = positions.length / 3,
      dirs = [
        [ux, uy, uz],
        [vx, vy, vz],
        [-ux, -uy, -uz],
        [-vx, -vy, -vz],
      ];
    for (let end = 0; end < 2; end++) {
      const px = x0 + end * dx,
        py = y0 + end * dy,
        pz = z0 + end * dz;
      for (let d = 0; d < 4; d++) {
        const dir = dirs[d]!;
        positions.push(px + dir[0]! * r, py + dir[1]! * r, pz + dir[2]! * r);
        normals.push(dir[0]!, dir[1]!, dir[2]!);
        uvs.push(d / 4, end);
      }
    }
    for (let d = 0; d < 4; d++) {
      const d1 = (d + 1) % 4;
      indices.push(base + d, base + d1, base + 4 + d1, base + d, base + 4 + d1, base + 4 + d);
    }
  }
  if (positions.length > 0) outGeo.setFromBuffers(positions, normals, uvs, indices);
  return outGeo;
}

function buildPointsOctahedraGeometry(
  sourceGeo: BufferGeometry,
  pointSize = 0.05,
): BufferGeometry {
  const outGeo = new BufferGeometry();
  (outGeo as any).__baked = true;
  const posAttr = sourceGeo?.attributes?.position;
  if (!posAttr?.array || posAttr.count < 1) return outGeo;
  const pos = posAttr.array as Float32Array,
    totalPts = posAttr.count,
    emitPts = Math.min(totalPts, 5000),
    r = Math.max(0.003, Math.min(0.25, (Number(pointSize) || 0.05) * 0.6)),
    positions: number[] = [],
    normals: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let p = 0; p < emitPts; p++) {
    const srcIdx = totalPts <= 5000 ? p : Math.floor((p * totalPts) / emitPts),
      cx = pos[srcIdx * 3] || 0,
      cy = pos[srcIdx * 3 + 1] || 0,
      cz = pos[srcIdx * 3 + 2] || 0,
      vBase = p * 6;
    for (let k = 0; k < 6; k++) {
      const ox = OCTA_V[k * 3]!,
        oy = OCTA_V[k * 3 + 1]!,
        oz = OCTA_V[k * 3 + 2]!;
      positions.push(cx + ox * r, cy + oy * r, cz + oz * r);
      normals.push(ox, oy, oz);
      uvs.push(0.5, 0.5);
    }
    for (let t = 0; t < 24; t++) indices.push(vBase + OCTA_I[t]!);
  }
  outGeo.setFromBuffers(positions, normals, uvs, indices);
  return outGeo;
}

export class Line extends Mesh {
  public isLine = true;
  protected _lineMode: 'strip' | 'loop' | 'segments' | 'points';
  protected _sourceGeo: BufferGeometry;

  constructor(
    geometry?: BufferGeometry,
    material?: Material,
    mode: 'strip' | 'loop' | 'segments' | 'points' = 'strip',
  ) {
    const rawOpts = material && typeof material === 'object' ? material : {};
    const mat =
      material instanceof Material
        ? material
        : mode === 'points'
          ? new PointsMaterial(rawOpts)
          : new LineBasicMaterial(rawOpts);
    const srcGeo = geometry instanceof BufferGeometry ? geometry : new BufferGeometry();
    super(srcGeo, mat);
    this._lineMode = mode;
    this._sourceGeo = srcGeo;
  }

  public computeLineDistances(): this {
    return this;
  }

  public _bakeAuthorGeometry(): void {
    if (this.geometry && !(this.geometry as any).__baked) {
      this._sourceGeo = this.geometry;
    }
    const isPts = this._lineMode === 'points';
    if (isPts) {
      const colAttr = this._sourceGeo?.attributes?.color;
      if (
        colAttr?.array &&
        colAttr.count > 0 &&
        this.material?.color.r === 1 &&
        this.material.color.g === 1 &&
        this.material.color.b === 1
      ) {
        const cArr = colAttr.array as Float32Array,
          n = Math.min(colAttr.count, 64);
        let rS = 0,
          gS = 0,
          bS = 0;
        for (let i = 0; i < n; i++) {
          rS += cArr[i * 3] || 0;
          gS += cArr[i * 3 + 1] || 0;
          bS += cArr[i * 3 + 2] || 0;
        }
        this.material.color.setRGB(rS / n, gS / n, bS / n);
      }
    }
    if (
      !(this.geometry as any)?.__baked &&
      this._sourceGeo?.attributes?.position?.count >= (isPts ? 1 : 2)
    ) {
      this.geometry = isPts
        ? buildPointsOctahedraGeometry(this._sourceGeo, (this.material as any)?.size ?? 0.05)
        : buildLinePrismGeometry(
            this._sourceGeo,
            this._lineMode as 'strip' | 'loop' | 'segments',
            (this.material as any)?.linewidth ?? 1,
          );
    }
  }
}

export class LineLoop extends Line {
  public isLineLoop = true;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super(geometry, material, 'loop');
  }
}

export class LineSegments extends Line {
  public isLineSegments = true;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super(geometry, material, 'segments');
  }
}

export class Points extends Line {
  public isPoints = true;
  constructor(geometry?: BufferGeometry, material?: Material) {
    super(geometry, material, 'points');
  }
}

export class SpotLight extends PointLight {
  public target: Object3D = new Object3D();
  public angle: number;
  public penumbra: number;
  constructor(
    color?: any,
    intensity?: number,
    distance = 0,
    angle = Math.PI / 3,
    penumbra = 0,
    decay = 2,
  ) {
    super(color, intensity, distance, decay);
    this.type = 'spot';
    const rawAngle = Number(angle);
    this.angle = Number.isFinite(rawAngle)
      ? Math.max(0.01, Math.min(Math.PI / 2, rawAngle))
      : Math.PI / 3;
    const rawPen = Number(penumbra);
    this.penumbra = Number.isFinite(rawPen)
      ? Math.max(0, Math.min(1, rawPen))
      : 0;
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
  Curve: Curve3,
  Curve3,
  LineCurve3,
  QuadraticBezierCurve3,
  CubicBezierCurve3,
  CatmullRomCurve3,
  LatheGeometry,
  TubeGeometry,
  PolyhedronGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  DodecahedronGeometry,
  TetrahedronGeometry,
  CapsuleGeometry,
  RingGeometry,
  CircleGeometry,
  WireframeGeometry,
  EdgesGeometry,
  FrontSide: 0,
  BackSide: 1,
  DoubleSide: 2,
  NoBlending: 0,
  NormalBlending: 1,
  AdditiveBlending: 2,
  MultiplyBlending: 4,
  RepeatWrapping: 1000,
  ClampToEdgeWrapping: 1001,
  MirroredRepeatWrapping: 1002,
  NearestFilter: 1003,
  NearestMipmapNearestFilter: 1004,
  NearestMipmapLinearFilter: 1005,
  LinearFilter: 1006,
  LinearMipmapNearestFilter: 1007,
  LinearMipmapLinearFilter: 1008,
  UnsignedByteType: 1009,
  ByteType: 1010,
  ShortType: 1011,
  UnsignedShortType: 1012,
  IntType: 1013,
  UnsignedIntType: 1014,
  FloatType: 1015,
  HalfFloatType: 1016,
  AlphaFormat: 1021,
  RGBFormat: 1022,
  RGBAFormat: 1023,
  LuminanceFormat: 1024,
  LuminanceAlphaFormat: 1025,
  RedFormat: 1028,
  RGFormat: 1030,
  NoColorSpace: '',
  SRGBColorSpace: 'srgb',
  LinearSRGBColorSpace: 'srgb-linear',
  StaticDrawUsage: 35044,
  DynamicDrawUsage: 35048,
  ACESFilmicToneMapping: 4,
  PCFSoftShadowMap: 2,
  Texture,
  DataTexture,
  TextureLoader,
  Material,
  MeshStandardMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  PointsMaterial,
  LineBasicMaterial,
  LineDashedMaterial,
  ShaderMaterial,
  RawShaderMaterial,
  Object3D,
  Group,
  Mesh,
  InstancedMesh,
  Line,
  LineLoop,
  LineSegments,
  Points,
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
    const ext = getSharedRegistry().authorNamespace;
    if (ext && typeof prop === 'string' && prop in ext) {
      return ext[prop];
    }
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
  has: (target, prop) => {
    if (prop in target) return true;
    const ext = getSharedRegistry().authorNamespace;
    return Boolean(ext && typeof prop === 'string' && prop in ext);
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

const sharedRegForAuthor = getSharedRegistry();
sharedRegForAuthor.threeNamespace = THREE;
if (sharedRegForAuthor.workerExtensionInstallers) {
  for (const installer of sharedRegForAuthor.workerExtensionInstallers) {
    installer(THREE, sharedRegForAuthor);
  }
}

export const threeAuthorPlugin = {
  name: 'three_author',
  THREE,
};

export const threeMicroPlugin = threeAuthorPlugin;

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
  globalRoot.requestAnimationFrame = (cb?: unknown) => {
    if (
      typeof cb === 'function' &&
      typeof globalRoot.__three_live_raf_cb__ !== 'function'
    ) {
      globalRoot.__three_live_raf_cb__ = cb;
    }
    if (!globalRoot.__three_live_in_step__) {
      warnUnsupported(
        'requestAnimationFrame',
        'single-frame static evaluation',
      );
    }
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
  // Native GLB/USDZ exports carry the full canonical spatial trait set and CAD/IK/LOD authoring extensions.
  registerXRTraitSerializer();
  registerSimTraitSchema();
  installCadExtension(THREE, getSharedRegistry());
  installIKExtension(THREE, getSharedRegistry());
  installLodExtension(THREE, getSharedRegistry());
  // Only the server-extract engine needs a default scene; web builds skip it.
  let defaultScene = new Scene();
  let defaultCamera = new PerspectiveCamera(45, 1, 0.1, 1000);
  defaultCamera.position.set(0, 2, 5);
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
    delete globalRoot.__three_live_sim_time_ms__;
    delete globalRoot.__three_live_raf_cb__;
    delete globalRoot.__three_live_in_step__;
    delete globalRoot.__three_live_interactivity_fired__;
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
  const stepJsFn = function (elapsedSec: number, dtSec: number): void {
    globalRoot.__three_live_sim_time_ms__ = elapsedSec * 1000;
    globalRoot.__three_live_in_step__ = true;
    try {
      const fireSelect = !globalRoot.__three_live_interactivity_fired__ && elapsedSec >= 0.15;
      if (fireSelect) globalRoot.__three_live_interactivity_fired__ = true;
      const seenInter = new Set<object>();
      globalRoot.scene?.traverse?.((n: any) => {
        const inter = n?.userData?.interactivity;
        if (!inter || typeof inter !== 'object' || seenInter.has(inter)) return;
        seenInter.add(inter);
        if (fireSelect) {
          for (const fn of [inter.onSelect, inter.onClick, inter.toggle, inter.onActivate]) {
            if (typeof fn === 'function') {
              try {
                fn.call(inter, n);
              } catch {}
              break;
            }
          }
        }
        if (typeof inter.update === 'function') {
          try {
            inter.update(dtSec, elapsedSec);
          } catch {}
        }
      });
      if (typeof globalRoot.animate === 'function') {
        let takesDt = Boolean(globalRoot.__three_live_animate_takes_dt__);
        if (!takesDt) {
          const src = String(globalRoot.animate);
          const m = src.match(/^(?:function\s*\w*\s*\(\s*([^,)=]*)|\(\s*([^,)=]*)|([a-zA-Z_$][\w$]*)\s*=>)/);
          const p0 = ((m?.[1] || m?.[2] || m?.[3]) ?? '').trim().toLowerCase();
          takesDt = p0 === 'dt' || p0 === 'delta' || p0 === 'deltatime' || p0 === 'step';
        }
        if (takesDt) {
          globalRoot.animate(dtSec, elapsedSec);
        } else {
          globalRoot.animate(elapsedSec, dtSec);
        }
      } else if (typeof globalRoot.__three_live_raf_cb__ === 'function') {
        globalRoot.__three_live_raf_cb__(elapsedSec * 1000);
      }
    } finally {
      globalRoot.__three_live_in_step__ = false;
    }
  };
  Object.defineProperty(globalRoot, '__three_live_step_js__', {
    value: stepJsFn,
    writable: false,
    configurable: false,
  });

  /**
   * Deep-copies JSON-safe data with explicit depth / size limits, dropping
   * functions, non-finite numbers, cycles, and prototype keys. Never recurses
   * deeper than 32 levels, so hostile nesting cannot exhaust the native stack.
   */
  const toSafeJson = function (value: unknown): any {
    // Fast path: most nodes carry no `userData.xr` / `interactivity`.
    if (value === undefined || value === null) return null;
    let budget = 20000;
    let autoNodeId = 0;
    const seen = new Set<object>();
    const copy = (v: unknown, depth: number): unknown => {
      if (--budget < 0 || depth > 32) return undefined;
      if (v === null || typeof v === 'string' || typeof v === 'boolean')
        return v;
      if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
      if (v instanceof Object3D) {
        if (!v.name) v.name = `Node_ref_${++autoNodeId}`;
        return v.name;
      }
      if (v instanceof Vector3) {
        return [
          Number.isFinite(v.x) ? v.x : 0,
          Number.isFinite(v.y) ? v.y : 0,
          Number.isFinite(v.z) ? v.z : 0,
        ];
      }
      if (v instanceof Color) {
        return `#${v.getHex().toString(16).padStart(6, '0')}`;
      }
      if (typeof v !== 'object' || seen.has(v as object)) return undefined;
      seen.add(v as object);
      let out: any;
      if (Array.isArray(v)) {
        out = [];
        for (const item of v) out.push(copy(item, depth + 1) ?? null);
      } else {
        out = {};
        for (const k of Object.keys(v as object)) {
          if (k === '__proto__' || k === 'prototype' || k === 'constructor')
            continue;
          const c = copy((v as Record<string, unknown>)[k], depth + 1);
          if (c !== undefined) out[k] = c;
        }
      }
      seen.delete(v as object);
      return out;
    };
    try {
      return copy(value, 0) ?? null;
    } catch {
      return null;
    }
  };

  /** The per-mesh trait payload cap enforced by the Rust engine (bytes). */
  const MAX_XR_JSON_CHARS = 15 * 1024;

  /** The glTF node cap enforced by the Rust engine (`SECURITY_3D_MAX_MESHES * 4`). */
  const MAX_RAW_NODES = SECURITY_3D_MAX_MESHES * 4;

  /** Canonical XR trait payloads consumed by the Rust GLB / USDZ writers. */
  const serializeXRForCompiler = function (
    safe: unknown,
  ): Record<string, string | null> {
    const normalized = normalizeXRTraits(safe);
    if (!normalized) return {};
    // Unknown authored keys (e.g. `restitution`) are preserved when they fit
    // the native size cap; otherwise only the canonical traits are kept.
    let merged = JSON.stringify({...(safe as object), ...normalized});
    if (merged.length > MAX_XR_JSON_CHARS) {
      warnUnsupported(
        `userData.xr larger than ${MAX_XR_JSON_CHARS} characters`,
        'canonical XR traits only',
      );
      merged = JSON.stringify(normalized);
    }
    return {
      xr_normalized_json: merged,
      xr_scenecore_json: JSON.stringify(buildXRSceneCoreExtension(normalized)),
      xr_hubs_json: JSON.stringify(buildHubsExtension(normalized)),
    };
  };

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
          else if (
            typeof (mat.map as any).source === 'string' &&
            (mat.map as any).source
          ) {
            mapUrl = (mat.map as any).source;
          } else if (typeof (mat.map as any).image === 'string') {
            mapUrl = (mat.map as any).image;
          }
        }
        materials.push({
          name: mat.name || `Material_${materials.length}`,
          base_color: [
            mat.color.r,
            mat.color.g,
            mat.color.b,
            mat.opacity !== undefined ? mat.opacity : 1.0,
          ],
          metallic: mat.metalness !== undefined ? mat.metalness : 0.0,
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

    /** Finite number or `fallback` (scripts can assign anything to a vector). */
    const fin = (v: unknown, fallback: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback;

    /**
     * Raw glTF node list, in exactly `sceneToCanvas3D`'s order: every
     * descendant `Object3D` of the scene (the scene root itself is not a
     * node) in pre-order DFS, with LOCAL translation / rotation / scale.
     * The Rust GLB writer reproduces this list 1:1, so node indices used by
     * `KHR_interactivity` (raw graphs, `targetNode`, explicit pointers) match
     * the web exporter.
     */
    const rawNodes: any[] = [];
    const variantNames: string[] = [];
    /** Per-node `userData.interactivity`, kept off `rawNodes` (read by Rust). */
    const nodeInteractivity: unknown[] = [];
    let anyNodeInteractivity = false;
    const activeScene = globalRoot.scene || defaultScene;
    const sceneWorld = new Matrix4().compose(
      {
        x: fin(activeScene.position?.x, 0),
        y: fin(activeScene.position?.y, 0),
        z: fin(activeScene.position?.z, 0),
      } as Vector3,
      {
        x: fin(activeScene.quaternion?.x, 0),
        y: fin(activeScene.quaternion?.y, 0),
        z: fin(activeScene.quaternion?.z, 0),
        w: fin(activeScene.quaternion?.w, 1),
      } as Quaternion,
      {
        x: fin(activeScene.scale?.x, 1),
        y: fin(activeScene.scale?.y, 1),
        z: fin(activeScene.scale?.z, 1),
      } as Vector3,
    );

    // Iterative (explicit stack) pre-order walk: deep hierarchies cannot hit
    // the VM recursion limit, and `seen` breaks parent/child cycles that a
    // hostile script can build by hand.
    const seen = new Set<Object3D>([activeScene]);

    // Cheap pre-pass: count nodes (stopping one past the cap) before doing any
    // per-node work, so an oversized hierarchy is refused without serializing
    // thousands of nodes first. Rust rejects `nodes.length > MAX_RAW_NODES`.
    {
      const counted = new Set<Object3D>([activeScene]);
      const pending: unknown[] = Array.isArray(activeScene.children)
        ? [...activeScene.children]
        : [];
      let count = 0;
      while (pending.length > 0 && count <= MAX_RAW_NODES) {
        const n = pending.pop();
        if (!(n instanceof Object3D) || counted.has(n)) continue;
        counted.add(n);
        count++;
        if (Array.isArray(n.children)) {
          for (const c of n.children) pending.push(c);
        }
      }
      if (count > MAX_RAW_NODES) {
        return {meshes: [], nodes: new Array(count), materials: [], lights: []};
      }
    }

    const stack: Array<[Object3D, number]> = [];
    const pushChildren = (obj: Object3D, parentIdx: number) => {
      const kids = Array.isArray(obj.children) ? obj.children : [];
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push([kids[i], parentIdx]);
      }
    };
    pushChildren(activeScene, -1);

    /**
     * World matrix of raw node `idx`, composed lazily from the local TRS of
     * its ancestors. Only lights need world positions, so ordinary nodes skip
     * the matrix math entirely (it dominated extraction time for large
     * hierarchies).
     */
    const worldOf = (idx: number): Matrix4 => {
      const chain: number[] = [];
      for (
        let i = idx;
        i >= 0 && chain.length <= rawNodes.length;
        i = rawNodes[i].parent
      ) {
        chain.push(i);
      }
      const world = sceneWorld.clone();
      for (let c = chain.length - 1; c >= 0; c--) {
        const n = rawNodes[chain[c]];
        world.multiply(
          new Matrix4().compose(
            {
              x: n.translation[0],
              y: n.translation[1],
              z: n.translation[2],
            } as Vector3,
            {
              x: n.rotation[0],
              y: n.rotation[1],
              z: n.rotation[2],
              w: n.rotation[3],
            } as Quaternion,
            {x: n.scale[0], y: n.scale[1], z: n.scale[2]} as Vector3,
          ),
        );
      }
      return world;
    };

    while (stack.length > 0) {
      const [node, parentIdx] = stack.pop()!;
      if (!(node instanceof Object3D) || seen.has(node)) continue;
      seen.add(node);

      const translation = [
        fin(node.position?.x, 0),
        fin(node.position?.y, 0),
        fin(node.position?.z, 0),
      ];
      const rotation = [
        fin(node.quaternion?.x, 0),
        fin(node.quaternion?.y, 0),
        fin(node.quaternion?.z, 0),
        fin(node.quaternion?.w, 1),
      ];
      const scale = [
        fin(node.scale?.x, 1),
        fin(node.scale?.y, 1),
        fin(node.scale?.z, 1),
      ];
      // Same mesh predicate as `sceneToCanvas3D`: any node with a non-empty
      // position attribute. Empty geometry yields a mesh-less node.
      materializeDeclarativeGeometry(node);
      let meshIdx = -1;
      const geo = (node as any).geometry;
      const posAttr = geo?.attributes?.position;
      if (posAttr && posAttr.array && posAttr.count > 0) {
        meshIdx = rawMeshes.length;
        let variantMappingsJson: string | null = null;
        const rawVariants = node.userData?.variants;
        if (rawVariants && typeof rawVariants === 'object') {
          const matToVarIndices = new Map<number, number[]>();
          for (const k of Object.keys(rawVariants)) {
            if (
              !k ||
              k === '__proto__' ||
              k === 'constructor' ||
              k === 'prototype'
            ) {
              continue;
            }
            const vMat = rawVariants[k];
            const matObj =
              vMat instanceof Material
                ? vMat
                : vMat && typeof vMat === 'object'
                  ? new MeshStandardMaterial(vMat)
                  : null;
            if (!matObj) continue;
            let vIdx = variantNames.indexOf(k);
            if (vIdx === -1 && variantNames.length < 256) {
              vIdx = variantNames.length;
              variantNames.push(k);
            }
            if (vIdx === -1) continue;
            const mIdx = getMaterialIndex(matObj);
            if (mIdx !== null) {
              let list = matToVarIndices.get(mIdx);
              if (!list) {
                list = [];
                matToVarIndices.set(mIdx, list);
              }
              list.push(vIdx);
            }
          }
          if (matToVarIndices.size > 0) {
            const mappings: Array<{material: number; variants: number[]}> = [];
            for (const [mIdx, vIndices] of matToVarIndices.entries()) {
              mappings.push({material: mIdx, variants: vIndices});
            }
            variantMappingsJson = JSON.stringify({mappings});
          }
        }
        rawMeshes.push({
          name: node.name || `Mesh_${rawMeshes.length}`,
          raw_positions: posAttr.array,
          raw_normals: geo.attributes.normal
            ? geo.attributes.normal.array
            : null,
          raw_uvs: geo.attributes.uv ? geo.attributes.uv.array : null,
          raw_indices: geo.index ? geo.index.array : null,
          vertex_count: posAttr.count,
          material_index: getMaterialIndex(
            (node as any).material instanceof Material
              ? (node as any).material
              : null,
          ),
          variant_mappings_json: variantMappingsJson,
        });
      }

      const safeXR = toSafeJson(node.userData?.xr);
      // `sceneToCanvas3D` only serializes truthy `userData.xr`.
      const hasXR = Boolean(node.userData?.xr) && safeXR !== null;
      const inter = toSafeJson(node.userData?.interactivity);
      const nodeIdx = rawNodes.length;
      const isInstanced =
        node instanceof InstancedMesh &&
        node.count > 0 &&
        node.instanceMatrix?.array;
      const interEvents: string[] = [];
      if (inter && typeof inter === 'object') {
        for (const evKey of [
          'onSelect',
          'onHoverIn',
          'onHoverOut',
          'onStart',
          'onReceive',
        ]) {
          if ((inter as Record<string, unknown>)[evKey]) {
            interEvents.push(evKey);
          }
        }
      }
      rawNodes.push({
        name: typeof node.name === 'string' ? node.name.slice(0, 1024) : '',
        parent: parentIdx,
        translation,
        rotation,
        scale,
        mesh: meshIdx,
        visible: node.visible !== false,
        xr_traits_json: hasXR ? JSON.stringify(safeXR) : null,
        interactivity_events_json:
          interEvents.length > 0 ? JSON.stringify(interEvents) : null,
        interactivity_raw_json: inter ? JSON.stringify(inter) : null,
        ...(hasXR ? serializeXRForCompiler(safeXR) : {}),
        ...(isInstanced
          ? {
              instance_matrices: (
                node.instanceMatrix.array as Float32Array
              ).subarray(0, node.count * 16),
              instance_colors: node.instanceColor?.array
                ? (node.instanceColor.array as Float32Array).subarray(
                    0,
                    node.count * 3,
                  )
                : null,
            }
          : {}),
      });
      nodeInteractivity.push(inter);
      if (inter) anyNodeInteractivity = true;
      // One past the Rust cap is enough for it to reject the scene; stop
      // walking so a huge hierarchy is not serialized just to be refused.
      if (rawNodes.length > MAX_RAW_NODES) break;

      if (node instanceof Light) {
        const e = worldOf(nodeIdx).elements;
        const px = fin(e[12], 0);
        const py = fin(e[13], 0);
        const pz = fin(e[14], 0);
        const lightEntry: Record<string, any> = {
          light_type: node.type,
          color: [node.color.r, node.color.g, node.color.b],
          intensity: node.intensity,
          position: [px, py, pz],
        };
        if (node instanceof SpotLight || node instanceof DirectionalLight) {
          const tgt = node.target;
          let tx = fin(tgt?.position?.x, 0);
          let ty = fin(tgt?.position?.y, 0);
          let tz = fin(tgt?.position?.z, 0);
          if (tgt?.parent) {
            const chain: Object3D[] = [];
            for (
              let cur: Object3D | null = tgt;
              cur && cur !== activeScene && chain.length < 64;
              cur = cur.parent
            ) {
              chain.push(cur);
            }
            const m = new Matrix4();
            for (let ci = chain.length - 1; ci >= 0; ci--) {
              const cObj = chain[ci]!;
              cObj.updateMatrix();
              m.multiply(cObj.matrix);
            }
            tx = fin(m.elements[12], tx);
            ty = fin(m.elements[13], ty);
            tz = fin(m.elements[14], tz);
          }
          if (node instanceof SpotLight) {
            let dx = tx - px;
            let dy = ty - py;
            let dz = tz - pz;
            const dLen = Math.hypot(dx, dy, dz);
            if (dLen > 1e-6) {
              dx /= dLen;
              dy /= dLen;
              dz /= dLen;
            } else {
              dx = 0;
              dy = -1;
              dz = 0;
            }
            lightEntry.direction = [dx, dy, dz];
            const outerAngle = Math.max(
              0.01,
              Math.min(Math.PI / 2, fin(node.angle, Math.PI / 3)),
            );
            const pen = Math.max(0, Math.min(1, fin(node.penumbra, 0)));
            lightEntry.outer_cone_angle = outerAngle;
            lightEntry.inner_cone_angle = Math.max(0, outerAngle * (1 - pen));
            lightEntry.range = Math.max(0, fin(node.distance, 0));
          } else {
            lightEntry.position = [px - tx, py - ty, pz - tz];
          }
        } else if (node instanceof PointLight) {
          lightEntry.range = Math.max(0, fin(node.distance, 0));
        }
        lights.push(lightEntry);
      }

      pushChildren(node, nodeIdx);
    }

    const diagnostics: SchemaDiagnostic[] = [];
    const pushDiag = (
      code: string,
      message: string,
      hint: string,
      node?: string,
      severity: 'warning' | 'info' = 'warning',
    ) => {
      diagnostics.push(
        node
          ? {code, severity, node, message, hint}
          : {code, severity, message, hint},
      );
    };
    for (const message of getAuthorWarnings()) {
      const [code, hint] =
        message.includes('ShaderMaterial') ||
        message.includes('RawShaderMaterial') ||
        message.includes('unsupported material')
          ? [
              'TL101',
              'Use THREE.MeshStandardMaterial({ color, metalness, roughness }) instead of custom GLSL shaders.',
            ]
          : message.includes('requestAnimationFrame')
            ? [
                'TL104',
                'Static exports evaluate a single frame; use userData.xr.orbit, userData.interactivity, or define function animate(t) for time-stepped rendering.',
              ]
            : message.includes('Controls')
              ? [
                   'TL106',
                  'Remove THREE.OrbitControls; <three-live camera-controls> and <xr-live> provide built-in camera controls.',
                ]
              : message.includes('EffectComposer') || message.includes('Pass')
                ? [
                    'TL107',
                    'Use <three-live bloom="0.5" outline-selected> or mesh.userData.xr = { bloom, outline } instead of EffectComposer passes.',
                  ]
                : /THREE\.[A-Za-z0-9_]*Loader\b/.test(message)
                  ? [
                      'TL103',
                      "Load external models via <three-live src='...'> or <xr-anchor src='...'>; camera controls and post-processing are managed by the host viewer.",
                    ]
                  : /THREE\.(?:Points|Line|Sprite)/.test(message)
                    ? [
                        'TL102',
                        'glTF mesh export requires triangle surface meshes (THREE.Mesh or THREE.InstancedMesh). Replace Points/Sprite with InstancedMesh + SphereGeometry, and replace Line/LineSegments with TubeGeometry or CylinderGeometry.',
                      ]
                    : /THREE\.(?:Canvas|Data|Video|Framebuffer)Texture/.test(message)
                      ? [
                          'TL102',
                          'Procedural DOM/pixel textures cannot run in the headless sandbox; use MeshPhysicalMaterial PBR properties, vertex colors, or THREE.TextGeometry / userData.text.',
                        ]
                      : message.includes('larger than')
                        ? [
                            'TL105',
                            'Keep per-node userData.xr metadata under 15 KB.',
                          ]
                        : [
                            'TL102',
                            'Use supported geometries (Box, Sphere, Cylinder, Cone, Torus, TorusKnot, Plane, Lathe, Tube, Extrude, Shape, TextGeometry, CSG, or BufferGeometry) and DirectionalLight / PointLight / AmbientLight.',
                          ];
      pushDiag(code, message, hint);
    }

    const nodeNameSet = new Set<string>();
    for (const rn of rawNodes) {
      if (typeof rn.name === 'string' && rn.name.trim().length > 0) {
        nodeNameSet.add(rn.name);
      }
    }

    for (let i = 0; i < rawNodes.length; i++) {
      const rn = rawNodes[i];
      const explicitName =
        typeof rn.name === 'string' && rn.name.trim().length > 0 ? rn.name : '';
      let nodeLabel =
        explicitName ||
        (rn.mesh >= 0 && rawMeshes[rn.mesh]?.name) ||
        `Node_${i}`;
      if (!explicitName && nodeNameSet.has(nodeLabel)) {
        nodeLabel = `Node_${i}`;
      }
      const inter = nodeInteractivity[i];
      let parsedXR: Record<string, any> | null = null;
      if (rn.xr_traits_json) {
        try {
          parsedXR = JSON.parse(rn.xr_traits_json);
        } catch {
          parsedXR = null;
        }
      }

      if ((parsedXR || inter) && !explicitName) {
        rn.name = nodeLabel;
        nodeNameSet.add(nodeLabel);
        pushDiag(
          'TL205',
          `Interactive node '${nodeLabel}' is missing an explicit mesh.name (auto-named '${nodeLabel}').`,
          "Assign a unique mesh.name = '...' so raycasting, meshclick, and WebMCP tools can target it.",
          nodeLabel,
          'info',
        );
      }

      if (parsedXR !== null) {
        for (const d of validateXRTraits(parsedXR, nodeLabel)) {
          diagnostics.push(d);
        }
        const checkTargetNode = (fieldPath: string, targetName: unknown) => {
          if (
            typeof targetName === 'string' &&
            targetName.trim().length > 0 &&
            !nodeNameSet.has(targetName)
          ) {
            pushDiag(
              'TL204',
              `userData.xr.${fieldPath} on node '${nodeLabel}' references target node '${targetName}', which does not exist in scene.`,
              `Ensure a node with mesh.name = '${targetName}' is added to scene via scene.add().`,
              nodeLabel,
            );
          }
        };
        if (parsedXR.orbit && typeof parsedXR.orbit === 'object') {
          checkTargetNode('orbit.target', parsedXR.orbit.target);
        }
        if (typeof parsedXR.spawner === 'string') {
          checkTargetNode('spawner.template', parsedXR.spawner);
        } else if (parsedXR.spawner && typeof parsedXR.spawner === 'object') {
          checkTargetNode('spawner.template', parsedXR.spawner.template);
        }
        if (parsedXR.agent && typeof parsedXR.agent === 'object') {
          const at = parsedXR.agent.target;
          if (at !== 'user' && at !== 'camera') {
            checkTargetNode('agent.target', at);
          }
        }
        if (
          parsedXR.ik &&
          typeof parsedXR.ik === 'object' &&
          parsedXR.ik.enabled !== false
        ) {
          checkTargetNode('ik.root', parsedXR.ik.root);
          checkTargetNode('ik.mid', parsedXR.ik.mid);
          checkTargetNode('ik.effector', parsedXR.ik.effector);
          if (!Array.isArray(parsedXR.ik.target)) {
            checkTargetNode('ik.target', parsedXR.ik.target);
          }
          const poleRef = parsedXR.ik.pole ?? parsedXR.ik.poleTarget;
          if (!Array.isArray(poleRef)) {
            checkTargetNode('ik.pole', poleRef);
          }
        }
      }

      if (inter && typeof inter === 'object') {
        const VALID_TRIGGERS = new Set([
          'onSelect',
          'onHoverIn',
          'onHoverOut',
          'onStart',
          'onReceive',
        ]);
        const VALID_ACTIONS = new Set([
          'interpolate',
          'toggleTransform',
          'setProperty',
          'toggleVisibility',
          'cycleMaterialColor',
          'playAnimation',
          'stopAnimation',
          'sendEvent',
        ]);
        const inspectActionList = (list: unknown, triggerName: string) => {
          const arr = Array.isArray(list) ? list : [list];
          for (const act of arr) {
            if (!act || typeof act !== 'object') continue;
            const actionKind = (act as Record<string, unknown>)['action'];
            if (
              typeof actionKind === 'string' &&
              !VALID_ACTIONS.has(actionKind)
            ) {
              pushDiag(
                'TL201',
                `Unrecognized action '${actionKind}' in userData.interactivity.${triggerName} on node '${nodeLabel}'.`,
                'Supported interactivity actions: interpolate, toggleTransform, setProperty, toggleVisibility, cycleMaterialColor, playAnimation, stopAnimation, sendEvent.',
                nodeLabel,
              );
            }
            const target = (act as Record<string, unknown>)['target'];
            if (
              typeof target === 'string' &&
              target.length > 0 &&
              !nodeNameSet.has(target)
            ) {
              pushDiag(
                'TL204',
                `userData.interactivity.${triggerName} on node '${nodeLabel}' references target node '${target}', which does not exist in scene.`,
                `Ensure a node with mesh.name = '${target}' is added to scene via scene.add().`,
                nodeLabel,
              );
            }
            const targetNode = (act as Record<string, unknown>)['targetNode'];
            if (
              typeof targetNode === 'number' &&
              (targetNode < 0 || targetNode >= rawNodes.length)
            ) {
              pushDiag(
                'TL204',
                `userData.interactivity.${triggerName} on node '${nodeLabel}' references out-of-range targetNode ${targetNode} (scene has ${rawNodes.length} nodes).`,
                "Prefer referencing nodes by name via target: '<nodeName>'.",
                nodeLabel,
              );
            }
          }
        };
        const interObj = inter as Record<string, unknown>;
        for (const key of Object.keys(interObj)) {
          if (!VALID_TRIGGERS.has(key)) {
            const lowerK = key.toLowerCase();
            const suggested =
              lowerK === 'onclick' ||
              lowerK === 'ontap' ||
              lowerK === 'onpointerdown'
                ? 'onSelect'
                : lowerK === 'onhover' || lowerK === 'onmouseenter'
                  ? 'onHoverIn'
                  : lowerK === 'onmouseleave'
                    ? 'onHoverOut'
                    : null;
            pushDiag(
              'TL201',
              suggested
                ? `Unrecognized trigger '${key}' in userData.interactivity on node '${nodeLabel}'; did you mean '${suggested}'?`
                : `Unrecognized trigger '${key}' in userData.interactivity on node '${nodeLabel}'.`,
              'Supported interactivity triggers: onSelect, onHoverIn, onHoverOut, onStart, onReceive.',
              nodeLabel,
            );
          }
        }
        for (const trig of ['onSelect', 'onHoverIn', 'onHoverOut', 'onStart']) {
          if (interObj[trig]) inspectActionList(interObj[trig], trig);
        }
        if (
          interObj['onReceive'] &&
          typeof interObj['onReceive'] === 'object'
        ) {
          for (const [evKey, acts] of Object.entries(
            interObj['onReceive'] as Record<string, unknown>,
          )) {
            inspectActionList(acts, `onReceive.${evKey}`);
          }
        }
      }
    }

    // Compile `userData.interactivity` with the same compiler as the web
    // exporter, over node stubs that mirror `sceneToCanvas3D`'s nodes (same
    // order, names, mesh indices and non-default TRS), so every node index in
    // the graph matches the web export.
    const isDefault = (v: number[], d: number[]) =>
      v.every((c, i) => c === d[i]);
    const sceneInteractivity = toSafeJson({
      interactivity: activeScene.userData?.interactivity,
      gltfExtensions: {
        KHR_interactivity:
          activeScene.userData?.gltfExtensions?.KHR_interactivity,
      },
    });
    const hasSceneGraph = Boolean(
      sceneInteractivity?.interactivity ??
        sceneInteractivity?.gltfExtensions?.KHR_interactivity,
    );
    // Without any authored interactivity the compiler emits nothing; skip
    // building per-node stubs (a measurable cost for large hierarchies).
    let interactivityExt: Record<string, unknown> | null = null;
    if (anyNodeInteractivity || hasSceneGraph) {
      interactivityExt = compileInteractivityGraph(
        rawNodes.map((n, i) => ({
          name: n.name,
          ...(n.mesh >= 0 ? {mesh: n.mesh} : {}),
          ...(isDefault(n.translation, [0, 0, 0])
            ? {}
            : {translation: n.translation}),
          ...(isDefault(n.rotation, [0, 0, 0, 1])
            ? {}
            : {rotation: n.rotation}),
          ...(isDefault(n.scale, [1, 1, 1]) ? {} : {scale: n.scale}),
          extras: nodeInteractivity[i]
            ? {interactivity: nodeInteractivity[i]}
            : undefined,
        })),
        rawMeshes.map((m) => ({
          primitives: [{material: m.material_index ?? 0}],
        })),
        sceneInteractivity ?? undefined,
      );
    }

    const activeCam = globalRoot.camera || defaultCamera;
    return {
      meshes: rawMeshes,
      nodes: rawNodes,
      materials,
      lights,
      interactivity_json: interactivityExt
        ? JSON.stringify(interactivityExt)
        : null,
      variants_json:
        variantNames.length > 0
          ? JSON.stringify({variants: variantNames.map((name) => ({name}))})
          : null,
      diagnostics_json:
        diagnostics.length > 0 ? JSON.stringify(diagnostics) : null,
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
