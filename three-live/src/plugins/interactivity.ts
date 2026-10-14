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
 * @fileoverview Khronos glTF 2.0 `KHR_interactivity` Behavior Graph VM Plugin.
 * Executes declarative, Turing-incomplete glTF 2.0 behavior graphs with strict
 * execution step budgets, tween/delay limits, and RFC 6901 JSON Pointer
 * sandboxing.
 */

import {mat3NormalFromMat4, resolveNodeWorldMatrices} from '../math';
import type {ThreeLivePlugin} from '../plugin';
import {quatSlerp} from './keyframes';

/** Maximum number of nodes permitted in a single behavior graph. */
export const MAX_GRAPH_NODES = 1024;
/** Maximum number of mutable state variables permitted in a single graph. */
export const MAX_VARIABLES = 256;
/** Maximum synchronous flow steps executed per event invocation. */
export const MAX_STEPS_PER_INVOCATION = 2048;
/** Maximum concurrent property/variable tweens active per viewer. */
export const MAX_ACTIVE_TWEENS = 128;
/** Maximum concurrent scheduled delays active per viewer. */
export const MAX_ACTIVE_DELAYS = 64;
const MAX_EVENT_NESTING_DEPTH = 16;
/** Maximum value-socket evaluations per top-level invocation. */
const MAX_EVALS_PER_INVOCATION = 10000;
/** Maximum nesting of `flow/for` bodies (each recursion uses native stack). */
const MAX_FOR_NESTING = 8;

const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/** Supported primitive and vector value types inside the Interactivity VM. */
export type InteractivityValue =
  | boolean
  | number
  | string
  | number[]
  | undefined;

/** Outbound flow socket target connection in a `KHR_interactivity` node. */
export interface InteractivityFlowTarget {
  readonly node: number;
  readonly socket?: string;
}

/** Input value socket binding (upstream node link or literal value). */
export interface InteractivityValueSocket {
  readonly node?: number;
  readonly socket?: string;
  readonly value?: InteractivityValue;
  readonly type?: number;
}

/** Single node inside a `KHR_interactivity` behavior graph. */
export interface InteractivityNode {
  readonly declaration?: number;
  readonly op?: string;
  readonly configuration?: Record<string, unknown>;
  readonly values?: Record<string, InteractivityValueSocket | InteractivityValue>;
  readonly flows?: Record<string, InteractivityFlowTarget>;
}

/** Declaration entry mapping a node's `declaration` index to an operation string. */
export interface InteractivityDeclaration {
  readonly op: string;
  readonly inputValueSockets?: Record<string, unknown>;
  readonly outputValueSockets?: Record<string, unknown>;
}

/** State variable definition in a `KHR_interactivity` graph. */
export interface InteractivityVariableDef {
  readonly id?: string;
  readonly name?: string;
  readonly type?: number | string;
  readonly value?: InteractivityValue;
}

/** Custom event definition in a `KHR_interactivity` graph. */
export interface InteractivityEventDef {
  readonly id: string;
  readonly values?: Record<string, unknown>;
}

/** Normalized `KHR_interactivity` behavior graph structure. */
export interface InteractivityGraph {
  readonly declarations?: readonly InteractivityDeclaration[];
  readonly nodes?: readonly InteractivityNode[];
  readonly variables?: readonly InteractivityVariableDef[];
  readonly events?: readonly InteractivityEventDef[];
  readonly types?: readonly unknown[];
}

interface ActiveTween {
  readonly key: string;
  readonly ptr?: string;
  readonly varKey?: string | number;
  readonly from: InteractivityValue;
  readonly to: InteractivityValue;
  readonly dur: number;
  elapsed: number;
  readonly quat: boolean;
  readonly linear: boolean;
  readonly done?: InteractivityFlowTarget;
}

interface ActiveDelay {
  readonly id: number;
  readonly nodeIdx: number;
  rem: number;
  readonly done?: InteractivityFlowTarget;
}

const UNARY_MATH: Record<string, (x: number) => number> = {
  neg: (x) => -x,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  fract: (x) => x - Math.floor(x),
  sqrt: (x) => Math.sqrt(Math.max(0, x)),
  cbrt: Math.cbrt,
  exp: Math.exp,
  log: (x) => (x > 0 ? Math.log(x) : 0),
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: (x) => Math.asin(Math.max(-1, Math.min(1, x))),
  acos: (x) => Math.acos(Math.max(-1, Math.min(1, x))),
  atan: Math.atan,
  rad: (x) => (x * Math.PI) / 180,
  deg: (x) => (x * 180) / Math.PI,
  saturate: (x) => Math.max(0, Math.min(1, x)),
};

const BINARY_MATH: Record<string, (x: number, y: number) => number> = {
  add: (x, y) => x + y,
  sub: (x, y) => x - y,
  mul: (x, y) => x * y,
  div: (x, y) => (Math.abs(y) < 1e-12 ? 0 : x / y),
  rem: (x, y) => (Math.abs(y) < 1e-12 ? 0 : x % y),
  mod: (x, y) => (Math.abs(y) < 1e-12 ? 0 : x % y),
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  atan2: Math.atan2,
};

const TRS_DEFAULTS: Record<string, readonly number[]> = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

const hasOwn = (obj: unknown, key: string): boolean =>
  obj !== null &&
  typeof obj === 'object' &&
  !FORBIDDEN_SEGMENTS.has(key) &&
  Object.prototype.hasOwnProperty.call(obj, key);

const cloneVal = (v: InteractivityValue): InteractivityValue =>
  Array.isArray(v) ? [...v] : v;

const unwrapCfg = (raw: unknown): unknown =>
  raw !== null &&
  typeof raw === 'object' &&
  !Array.isArray(raw) &&
  hasOwn(raw, 'value')
    ? (raw as Record<string, unknown>)['value']
    : raw;

const readCfg = (n: InteractivityNode, k: string): unknown =>
  hasOwn(n.configuration, k) ? unwrapCfg(n.configuration![k]) : undefined;

const num = (v: InteractivityValue, fb = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
};

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const bool = (v: InteractivityValue): boolean =>
  typeof v === 'boolean'
    ? v
    : typeof v === 'number'
      ? v !== 0 && !Number.isNaN(v)
      : typeof v === 'string'
        ? v.length > 0 && v !== 'false'
        : Boolean(v);

/**
 * Validates and splits an RFC 6901 JSON Pointer (`gltf-pointer`), rejecting
 * prototype-pollution tokens (`__proto__`, `constructor`, `prototype`).
 */
export function parseSafeGltfPointer(
  pointer: string,
): {readonly segments: readonly string[]} | null {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return null;
  const segments: string[] = [];
  for (const raw of pointer.slice(1).split('/')) {
    const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!seg || FORBIDDEN_SEGMENTS.has(seg) || FORBIDDEN_SEGMENTS.has(raw)) {
      return null;
    }
    segments.push(seg);
  }
  return {segments};
}

const parseIdx = (seg: string | undefined, max: number): number => {
  if (seg === undefined || !/^\d+$/.test(seg)) return -1;
  const idx = Number(seg);
  return Number.isSafeInteger(idx) && idx >= 0 && idx < max ? idx : -1;
};

const normQuat = (q: readonly number[]): [number, number, number, number] => {
  const x = num(q[0]),
    y = num(q[1]),
    z = num(q[2]),
    w = num(q[3], 1);
  const l = Math.hypot(x, y, z, w);
  return l > 1e-8 ? [x / l, y / l, z / l, w / l] : [0, 0, 0, 1];
};

const lerpVal = (
  a: InteractivityValue,
  b: InteractivityValue,
  t: number,
  isQuat: boolean,
): InteractivityValue => {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (isQuat && a.length === 4 && b.length === 4) {
      const out: [number, number, number, number] = [0, 0, 0, 1];
      quatSlerp(out, normQuat(a), normQuat(b), t);
      return out;
    }
    return a.slice(0, b.length).map((v, i) => v + (b[i] - v) * t);
  }
  return t >= 0.5 ? b : a;
};

const applyBin = (
  a: InteractivityValue,
  b: InteractivityValue,
  fn: (x: number, y: number) => number,
): InteractivityValue =>
  Array.isArray(a) && Array.isArray(b)
    ? a.slice(0, b.length).map((x, i) => fn(num(x), num(b[i])))
    : Array.isArray(a)
      ? a.map((x) => fn(num(x), num(b)))
      : Array.isArray(b)
        ? b.map((y) => fn(num(a), num(y)))
        : fn(num(a), num(b));

const applyUn = (
  a: InteractivityValue,
  fn: (x: number) => number,
): InteractivityValue =>
  Array.isArray(a) ? a.map((x) => fn(num(x))) : fn(num(a));

const valEq = (a: InteractivityValue, b: InteractivityValue): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-6)
    : a === b;

/**
 * Sandboxed Virtual Machine for a single viewer's `KHR_interactivity` graph.
 */
export class InteractivityVM {
  public readonly fireOnStart: () => void;
  // tslint:disable-next-line:no-any
  public readonly fireOnSelect: (hit: any) => void;
  public readonly receiveCustomEvent: (
    eventIdOrIndex: string | number,
    payload?: Record<string, InteractivityValue>,
  ) => void;
  public readonly tick: (dt: number) => void;
  public readonly dispose: () => void;
  public readonly readScenePointer: (pointer: string) => InteractivityValue;
  public readonly writeScenePointer: (
    pointer: string,
    value: InteractivityValue,
  ) => boolean;

  constructor(
    // tslint:disable-next-line:no-any
    viewer: any,
    // tslint:disable-next-line:no-any
    gltf: any,
    graph: InteractivityGraph,
  ) {
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    if (nodes.length > MAX_GRAPH_NODES) {
      throw new Error(`SecurityError: Exceeds MAX_GRAPH_NODES (${MAX_GRAPH_NODES})`);
    }
    const rawVars = Array.isArray(graph.variables) ? graph.variables : [];
    if (rawVars.length > MAX_VARIABLES) {
      throw new Error(`SecurityError: Exceeds MAX_VARIABLES (${MAX_VARIABLES})`);
    }
    const decls = Array.isArray(graph.declarations) ? graph.declarations : [];
    const events = Array.isArray(graph.events) ? graph.events : [];
    const vars = new Map<string | number, InteractivityValue>();
    const outputs = new Map<number, Record<string, InteractivityValue>>();
    const doNCounts = new Map<number, number>();
    const waitAll = new Map<number, Set<string>>();
    const throttles = new Map<number, number>();
    const multiGates = new Map<number, number>();
    const tweens: ActiveTween[] = [];
    const delays: ActiveDelay[] = [];
    const parentMap = new Map<number, number>();
    let nextDelayId = 1;
    let elapsed = 0;
    let eventDepth = 0;
    let evalCount = 0;
    let forDepth = 0;
    let transformsDirty = false;
    let visibilityDirty = false;
    let renderDirty = false;

    rawVars.forEach((v, i) => {
      if (!v || typeof v !== 'object') return;
      const init = cloneVal(unwrapCfg(v.value) as InteractivityValue);
      vars.set(i, init);
      const id = v.id ?? v.name;
      if (typeof id === 'string' && id && !FORBIDDEN_SEGMENTS.has(id)) {
        vars.set(id, init);
      }
    });

    (gltf?.nodes || []).forEach(
      // tslint:disable-next-line:no-any
      (gn: any, i: number) => {
        for (const c of gn?.children || []) {
          if (typeof c === 'number') parentMap.set(c, i);
        }
      },
    );

    const getOp = (n: InteractivityNode): string =>
      n.op || (typeof n.declaration === 'number' ? decls[n.declaration]?.op || '' : '');

    const setOut = (idx: number, sock: string, val: InteractivityValue) => {
      if (FORBIDDEN_SEGMENTS.has(sock)) return;
      let rec = outputs.get(idx);
      if (!rec) outputs.set(idx, (rec = Object.create(null) as Record<string, InteractivityValue>));
      rec[sock] = val;
    };

    const setVar = (key: unknown, val: InteractivityValue) => {
      if (
        (typeof key !== 'number' && typeof key !== 'string') ||
        (typeof key === 'string' && FORBIDDEN_SEGMENTS.has(key)) ||
        (!vars.has(key) && vars.size >= MAX_VARIABLES * 2)
      ) {
        return;
      }
      const c = cloneVal(val);
      vars.set(key, c);
      if (typeof key === 'number') {
        const alias = rawVars[key]?.id ?? rawVars[key]?.name;
        if (typeof alias === 'string' && !FORBIDDEN_SEGMENTS.has(alias)) {
          vars.set(alias, c);
        }
      }
    };

    const resolveEventId = (ev: unknown): string =>
      typeof ev === 'number'
        ? events[ev]?.id ?? String(ev)
        : typeof ev === 'string'
          ? /^\d+$/.test(ev) && events[Number(ev)]?.id
            ? events[Number(ev)].id
            : ev
          : '';

    const isAncestor = (hitIdx: number, targetIdx: number): boolean => {
      for (
        let cur: number | undefined = hitIdx, d = 0;
        cur !== undefined && cur >= 0 && d < 128;
        cur = parentMap.get(cur), d++
      ) {
        if (cur === targetIdx) return true;
      }
      return false;
    };

    const cancelTween = (key: string) => {
      for (let i = tweens.length - 1; i >= 0; i--) {
        if (tweens[i].key === key) tweens.splice(i, 1);
      }
    };

    const addTween = (tw: ActiveTween) => {
      cancelTween(tw.key);
      if (tweens.length >= MAX_ACTIVE_TWEENS) tweens.shift();
      tweens.push(tw);
    };

    const readPtr = (pointer: string): InteractivityValue => {
      const s = parseSafeGltfPointer(pointer)?.segments;
      if (!s) return undefined;
      if (s[0] === 'nodes' && Array.isArray(gltf?.nodes)) {
        const n = gltf.nodes[parseIdx(s[1], gltf.nodes.length)];
        if (!n) return undefined;
        const prop = s[2];
        if (prop in TRS_DEFAULTS) {
          const def = TRS_DEFAULTS[prop];
          const src = n[prop] || def;
          return def.map((d, i) => num(src[i], d));
        }
        if (prop === 'weights') {
          const w = Array.isArray(n.weights) ? n.weights : [0];
          const wi = s.length === 4 ? parseIdx(s[3], 64) : -2;
          return wi === -2
            ? w.map((x: unknown) => num(x as number))
            : wi >= 0
              ? num(w[wi])
              : undefined;
        }
        if (
          prop === 'visible' ||
          (prop === 'extensions' &&
            s[3] === 'KHR_node_visibility' &&
            s[4] === 'visible')
        ) {
          return n.extensions?.KHR_node_visibility?.visible ?? n.visible ?? true;
        }
      } else if (s[0] === 'materials' && Array.isArray(gltf?.materials)) {
        const m = gltf.materials[parseIdx(s[1], gltf.materials.length)];
        if (!m) return undefined;
        const pbr = m.pbrMetallicRoughness || {};
        if (s[2] === 'pbrMetallicRoughness') {
          if (s[3] === 'baseColorFactor') {
            const c = pbr.baseColorFactor || [1, 1, 1, 1];
            return [num(c[0], 1), num(c[1], 1), num(c[2], 1), num(c[3], 1)];
          }
          if (s[3] === 'metallicFactor' || s[3] === 'roughnessFactor') {
            return num(pbr[s[3]], 1);
          }
        }
        if (s[2] === 'emissiveFactor') {
          const e = m.emissiveFactor || [0, 0, 0];
          return [num(e[0]), num(e[1]), num(e[2])];
        }
        if (s[2] === 'alphaCutoff') return num(m.alphaCutoff, 0.5);
      }
      return undefined;
    };

    const writePtr = (pointer: string, value: InteractivityValue): boolean => {
      const s = parseSafeGltfPointer(pointer)?.segments;
      if (!s) return false;
      if (s[0] === 'nodes' && Array.isArray(gltf?.nodes)) {
        const idx = parseIdx(s[1], gltf.nodes.length);
        const n = gltf.nodes[idx];
        if (!n) return false;
        const prop = s[2];
        if (prop in TRS_DEFAULTS && Array.isArray(value)) {
          const def = TRS_DEFAULTS[prop];
          if (value.length < def.length) return false;
          let next = def.map((d, i) => num(value[i], d));
          if (prop === 'rotation') {
            const l = Math.hypot(...next);
            next = l > 1e-8 ? next.map((v) => v / l) : [0, 0, 0, 1];
          }
          n[prop] = next;
          delete n.matrix;
          const initTr = viewer?.initialNodeTransforms?.[idx];
          if (initTr) initTr[prop[0]] = [...next];
          transformsDirty = true;
          return true;
        }
        if (prop === 'weights') {
          if (!Array.isArray(n.weights)) n.weights = [];
          const syncW = (wi: number, wv: number) => {
            for (const mesh of viewer?.meshes || []) {
              if (mesh.nodeIndex === idx) {
                for (const p of mesh.primitives || []) {
                  if (p.pluginData?.morph?.weights) p.pluginData.morph.weights[wi] = wv;
                }
              }
            }
          };
          if (s.length === 4) {
            const wi = parseIdx(s[3], 64);
            if (wi < 0) return false;
            syncW(wi, (n.weights[wi] = num(value)));
          } else if (Array.isArray(value)) {
            n.weights = value.slice(0, 64).map((w) => num(w));
            n.weights.forEach((wv: number, wi: number) => syncW(wi, wv));
          } else return false;
          renderDirty = true;
          return true;
        }
        if (
          prop === 'visible' ||
          (prop === 'extensions' &&
            s[3] === 'KHR_node_visibility' &&
            s[4] === 'visible')
        ) {
          const vis = bool(value);
          n.visible = vis;
          if (!n.extensions || typeof n.extensions !== 'object') n.extensions = {};
          n.extensions.KHR_node_visibility = {visible: vis};
          visibilityDirty = true;
          return true;
        }
      } else if (s[0] === 'materials' && Array.isArray(gltf?.materials)) {
        const idx = parseIdx(s[1], gltf.materials.length);
        const m = gltf.materials[idx];
        if (!m) return false;
        const pbr = (m.pbrMetallicRoughness ||= {});
        // tslint:disable-next-line:no-any
        const syncPrims = (fn: (p: any) => void) => {
          for (const mesh of viewer?.meshes || []) {
            for (const p of mesh.primitives || []) {
              if ((p.materialIndex ?? 0) === idx) {
                fn(p);
              }
            }
          }
        };
        if (s[2] === 'pbrMetallicRoughness') {
          if (s[3] === 'baseColorFactor' && Array.isArray(value) && value.length >= 3) {
            const rgba = [
              clamp01(num(value[0], 1)),
              clamp01(num(value[1], 1)),
              clamp01(num(value[2], 1)),
              value[3] !== undefined ? clamp01(num(value[3], 1)) : (pbr.baseColorFactor?.[3] ?? 1),
            ];
            pbr.baseColorFactor = rgba;
            syncPrims((p) => (p.baseColor = [...rgba]));
            return (renderDirty = true);
          }
          if (s[3] === 'metallicFactor' || s[3] === 'roughnessFactor') {
            const isM = s[3] === 'metallicFactor';
            const v = clamp01(num(value, isM ? 0 : 0.5));
            pbr[s[3]] = v;
            syncPrims((p) => (p[isM ? 'metallic' : 'roughness'] = v));
            return (renderDirty = true);
          }
        }
        if (s[2] === 'emissiveFactor' && Array.isArray(value) && value.length >= 3) {
          m.emissiveFactor = [0, 1, 2].map((i) => Math.max(0, num(value[i])));
          return (renderDirty = true);
        }
        if (s[2] === 'alphaCutoff') {
          m.alphaCutoff = clamp01(num(value, 0.5));
          return (renderDirty = true);
        }
      }
      return false;
    };

    const resolvePtr = (
      nodeIdx: number,
      node: InteractivityNode,
      // Shared with the caller's evaluation so templated pointer cycles stop.
      visited: Set<number> = new Set(),
    ): string | null => {
      const raw = readCfg(node, 'pointer');
      if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
      const sub = raw.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, param) => {
        const i = Math.trunc(Number(readIn(nodeIdx, param, undefined, visited) ?? readCfg(node, param)));
        return Number.isSafeInteger(i) && i >= 0 ? String(i) : '-1';
      });
      return parseSafeGltfPointer(sub) ? sub : null;
    };

    const readIn = (
      nodeIdx: number,
      sock: string,
      fb: InteractivityValue,
      visited: Set<number>,
    ): InteractivityValue => {
      const vals = nodes[nodeIdx]?.values;
      if (!hasOwn(vals, sock)) return fb;
      const b = vals![sock];
      if (b === null || b === undefined) return fb;
      if (typeof b !== 'object' || Array.isArray(b)) return cloneVal(b);
      const s = b as InteractivityValueSocket;
      return typeof s.node === 'number'
        ? evalSocket(s.node, s.socket || 'value', visited)
        : hasOwn(s, 'value')
          ? cloneVal(s.value)
          : fb;
    };

    const evalSocket = (
      nodeIdx: number,
      sock: string,
      visited: Set<number>,
    ): InteractivityValue => {
      if (
        nodeIdx < 0 ||
        nodeIdx >= nodes.length ||
        visited.has(nodeIdx) ||
        visited.size > 128 ||
        // Diamond-shaped value DAGs would otherwise cost 2^N evaluations.
        ++evalCount > MAX_EVALS_PER_INVOCATION
      ) {
        return undefined;
      }
      const node = nodes[nodeIdx];
      const op = getOp(node);
      // Trigger/flow nodes expose their last outputs (e.g. onSelect nodeIndex).
      if (/^(event\/|pointer\/on|scene\/on|flow\/)/.test(op)) {
        return cloneVal(outputs.get(nodeIdx)?.[sock]);
      }
      visited.add(nodeIdx);
      try {
        const inp = (name: string, fb: InteractivityValue = 0) =>
          readIn(nodeIdx, name, fb, visited);
        if (op === 'variable/get') {
          const k = readCfg(node, 'variable') ?? readCfg(node, 'id');
          return typeof k === 'number' || typeof k === 'string'
            ? cloneVal(vars.get(k))
            : undefined;
        }
        if (op === 'pointer/get') {
          const p = resolvePtr(nodeIdx, node, visited);
          return p ? readPtr(p) : undefined;
        }
        if (op.startsWith('math/')) {
          const m = op.slice(5);
          if (m in UNARY_MATH) return applyUn(inp('a'), UNARY_MATH[m]);
          if (m in BINARY_MATH) {
            const dB = /^(mul|div|rem|mod|pow)$/.test(m) ? 1 : 0;
            return applyBin(inp('a', m === 'mul' ? 1 : 0), inp('b', dB), BINARY_MATH[m]);
          }
          if (m === 'pi') return Math.PI;
          if (m === 'e') return Math.E;
          if (m === 'random') return Math.random();
          if (m === 'clamp') {
            return applyBin(
              applyBin(inp('a'), inp('b', inp('min', 0)), Math.max),
              inp('c', inp('max', 1)),
              Math.min,
            );
          }
          if (m === 'mix' || m === 'quatSlerp') {
            return lerpVal(inp('a', 0), inp('b', 1), num(inp('c', inp('t', 0.5)), 0.5), m === 'quatSlerp');
          }
          if (m === 'dot') {
            const a = inp('a'), b = inp('b');
            return Array.isArray(a) && Array.isArray(b)
              ? a.reduce((s, v, i) => s + (v || 0) * (b[i] || 0), 0)
              : num(a) * num(b);
          }
          if (m === 'cross') {
            const a = inp('a', [0, 0, 0]), b = inp('b', [0, 0, 0]);
            return Array.isArray(a) && Array.isArray(b)
              ? [
                  (a[1] || 0) * (b[2] || 0) - (a[2] || 0) * (b[1] || 0),
                  (a[2] || 0) * (b[0] || 0) - (a[0] || 0) * (b[2] || 0),
                  (a[0] || 0) * (b[1] || 0) - (a[1] || 0) * (b[0] || 0),
                ]
              : [0, 0, 0];
          }
          if (m === 'length') {
            const a = inp('a');
            return Array.isArray(a) ? Math.hypot(...a) : Math.abs(num(a));
          }
          if (m === 'distance') {
            const a = inp('a'), b = inp('b');
            return Array.isArray(a) && Array.isArray(b)
              ? Math.hypot(...a.map((v, i) => (v || 0) - (b[i] || 0)))
              : Math.abs(num(a) - num(b));
          }
          if (m === 'normalize') {
            const a = inp('a');
            if (!Array.isArray(a)) return num(a) >= 0 ? 1 : -1;
            const l = Math.hypot(...a);
            return l > 1e-8 ? a.map((x) => x / l) : a.map(() => 0);
          }
          if (m.startsWith('combine')) {
            return ['a', 'b', 'c', 'd'].slice(0, Number(m[7]) || 2).map((k) => num(inp(k)));
          }
          if (m.startsWith('extract')) {
            const v = inp('a');
            return Array.isArray(v)
              ? (v[sock === '0' || sock === 'x' ? 0 : sock === '1' || sock === 'y' ? 1 : sock === '2' || sock === 'z' ? 2 : 3] ?? 0)
              : 0;
          }
          if (m === 'eq') return valEq(inp('a'), inp('b'));
          if (m === 'ne') return !valEq(inp('a'), inp('b'));
          if (m === 'lt') return num(inp('a')) < num(inp('b'));
          if (m === 'le') return num(inp('a')) <= num(inp('b'));
          if (m === 'gt') return num(inp('a')) > num(inp('b'));
          if (m === 'ge') return num(inp('a')) >= num(inp('b'));
          if (m === 'isNaN') return Number.isNaN(Number(inp('a')));
          if (m === 'isInf') {
            const n = Number(inp('a'));
            return !Number.isFinite(n) && !Number.isNaN(n);
          }
          if (m === 'and') return bool(inp('a', false)) && bool(inp('b', false));
          if (m === 'or') return bool(inp('a', false)) || bool(inp('b', false));
          if (m === 'xor') return bool(inp('a', false)) !== bool(inp('b', false));
          if (m === 'not') return !bool(inp('a', false));
          if (m === 'select') return cloneVal(bool(inp('condition', false)) ? inp('a') : inp('b'));
          return undefined;
        }
        if (op === 'type/boolToInt' || op === 'type/boolToFloat') return bool(inp('a', false)) ? 1 : 0;
        if (op === 'type/intToBool' || op === 'type/floatToBool') return num(inp('a', 0)) !== 0;
        if (op === 'type/intToFloat') return num(inp('a', 0));
        if (op === 'type/floatToInt') return Math.trunc(num(inp('a', 0)));
        return undefined;
      } finally {
        visited.delete(nodeIdx);
      }
    };

    const flushSync = () => {
      if (transformsDirty) {
        transformsDirty = false;
        renderDirty = true;
        const wm = resolveNodeWorldMatrices(gltf);
        if (viewer) {
          viewer.worldMatrices = wm;
          for (const mesh of viewer.meshes || []) {
            if (mesh.nodeIndex >= 0 && mesh.nodeIndex < wm.length) {
              mesh.transform.set(wm[mesh.nodeIndex]);
              mat3NormalFromMat4(mesh.normalMatrix, mesh.transform);
            }
          }
        }
      }
      if (visibilityDirty) {
        visibilityDirty = false;
        renderDirty = true;
        const gNodes = gltf?.nodes;
        if (Array.isArray(viewer?.meshes) && Array.isArray(gNodes)) {
          for (const mesh of viewer.meshes) {
            let vis = true;
            for (
              let cur: number | undefined = mesh.nodeIndex, d = 0;
              cur !== undefined && cur >= 0 && d < 128;
              cur = parentMap.get(cur), d++
            ) {
              const gn = gNodes[cur];
              if (gn?.visible === false || gn?.extensions?.KHR_node_visibility?.visible === false) {
                vis = false;
                break;
              }
            }
            mesh.visible = vis;
          }
        }
      }
      if (renderDirty) {
        renderDirty = false;
        viewer?.render?.();
      }
    };

    const followFlow = (
      startTarget: InteractivityFlowTarget | undefined,
      budget: {steps: number} = {steps: 0},
    ) => {
      if (!startTarget || typeof startTarget.node !== 'number') return;
      if (budget.steps === 0) evalCount = 0;
      const queue: InteractivityFlowTarget[] = [startTarget];
      // Bounded enqueue: pending work never exceeds the remaining step budget.
      const enqueue = (t: InteractivityFlowTarget): void => {
        if (queue.length + budget.steps < MAX_STEPS_PER_INVOCATION) queue.push(t);
      };
      while (queue.length > 0 && budget.steps < MAX_STEPS_PER_INVOCATION) {
        budget.steps++;
        const cur = queue.shift();
        if (!cur || cur.node < 0 || cur.node >= nodes.length) continue;
        const nodeIdx = cur.node;
        const node = nodes[nodeIdx];
        if (!node) continue;
        const inSock = cur.socket || 'in';
        const op = getOp(node);
        const inp = (name: string, fb: InteractivityValue = undefined) =>
          readIn(nodeIdx, name, fb, new Set());
        const pushOut = (sock = 'out') => {
          const t = node.flows?.[sock];
          if (t) enqueue(t);
        };

        switch (op) {
          case 'flow/branch':
            pushOut(bool(inp('condition', false)) ? 'true' : 'false');
            break;
          case 'flow/sequence':
            for (const k of Object.keys(node.flows || {}).sort(
              (a, b) => Number(a) - Number(b) || a.localeCompare(b),
            )) {
              pushOut(k);
            }
            break;
          case 'flow/switch': {
            const next =
              node.flows?.[String(inp('selection', inp('value', 0)))] ??
              node.flows?.['default'];
            if (next) enqueue(next);
            break;
          }
          case 'flow/for': {
            const sIdx = Math.trunc(num(inp('startIndex', 0)));
            const eIdx = Math.trunc(num(inp('endIndex', 0)));
            const stp = Math.max(1, Math.trunc(num(inp('step', 1), 1)));
            const body = node.flows?.['body'];
            if (body && eIdx > sIdx && forDepth < MAX_FOR_NESTING) {
              const maxIt = Math.min(Math.ceil((eIdx - sIdx) / stp), MAX_STEPS_PER_INVOCATION);
              forDepth++;
              try {
                for (let it = 0; it < maxIt && budget.steps < MAX_STEPS_PER_INVOCATION; it++) {
                  setOut(nodeIdx, 'index', sIdx + it * stp);
                  followFlow(body, budget);
                }
              } finally {
                forDepth--;
              }
            }
            const done = node.flows?.['completed'] ?? node.flows?.['out'];
            if (done) enqueue(done);
            break;
          }
          case 'flow/doN': {
            const c = inSock === 'reset' ? 0 : (doNCounts.get(nodeIdx) || 0) + 1;
            doNCounts.set(nodeIdx, c);
            setOut(nodeIdx, 'currentCount', c);
            setOut(nodeIdx, 'count', c);
            if (inSock !== 'reset') {
              const maxC = Math.trunc(
                num(inp('n', (readCfg(node, 'stopIterations') as number) ?? (readCfg(node, 'n') as number) ?? 1), 1),
              );
              if (c <= maxC) pushOut();
            }
            break;
          }
          case 'flow/multiGate': {
            if (inSock === 'reset') {
              multiGates.set(nodeIdx, 0);
              break;
            }
            const keys = Object.keys(node.flows || {}).sort();
            if (!keys.length) break;
            const idx = readCfg(node, 'isRandom')
              ? Math.floor(Math.random() * keys.length)
              : multiGates.get(nodeIdx) || 0;
            if (idx < keys.length) {
              pushOut(keys[idx]);
              multiGates.set(nodeIdx, readCfg(node, 'isLoop') !== false ? (idx + 1) % keys.length : idx + 1);
            }
            break;
          }
          case 'flow/waitAll': {
            if (inSock === 'reset') {
              waitAll.delete(nodeIdx);
              break;
            }
            let set = waitAll.get(nodeIdx);
            if (!set) waitAll.set(nodeIdx, (set = new Set()));
            set.add(inSock);
            if (set.size >= Math.max(1, Math.trunc(Number(readCfg(node, 'inputFlows') ?? 2) || 2))) {
              set.clear();
              pushOut('out');
              pushOut('completed');
            }
            break;
          }
          case 'flow/throttle': {
            if (inSock === 'reset') {
              throttles.delete(nodeIdx);
              break;
            }
            const dur = Math.max(0, num(inp('duration', 0)));
            const last = throttles.get(nodeIdx);
            if (last === undefined || elapsed - last >= dur) {
              throttles.set(nodeIdx, elapsed);
              setOut(nodeIdx, 'lastRemainingTime', 0);
              pushOut();
            } else {
              setOut(nodeIdx, 'lastRemainingTime', Math.max(0, dur - (elapsed - last)));
            }
            break;
          }
          case 'flow/delay':
          case 'flow/setDelay': {
            if (inSock === 'cancel') {
              for (let i = delays.length - 1; i >= 0; i--) {
                if (delays[i].nodeIdx === nodeIdx) delays.splice(i, 1);
              }
              setOut(nodeIdx, 'lastDelayIndex', -1);
              break;
            }
            const dur = Math.max(0, num(inp('duration', (readCfg(node, 'duration') as number) ?? 0)));
            const done = node.flows?.['done'] ?? node.flows?.['out'];
            if (dur <= 0) {
              setOut(nodeIdx, 'lastDelayIndex', -1);
              if (done) enqueue(done);
              break;
            }
            if (delays.length >= MAX_ACTIVE_DELAYS) delays.shift();
            const id = nextDelayId++;
            setOut(nodeIdx, 'lastDelayIndex', id);
            delays.push({id, nodeIdx, rem: dur, done});
            if (op === 'flow/setDelay' && node.flows?.['out'] && node.flows?.['done']) pushOut('out');
            break;
          }
          case 'flow/cancelDelay': {
            const dIdx = Math.trunc(num(inp('delayIndex', -1), -1));
            if (dIdx < 0) delays.length = 0;
            else {
              for (let i = delays.length - 1; i >= 0; i--) {
                if (delays[i].id === dIdx) delays.splice(i, 1);
              }
            }
            pushOut();
            break;
          }
          case 'variable/set':
            setVar(readCfg(node, 'variable') ?? readCfg(node, 'id'), inp('value'));
            pushOut();
            break;
          case 'variable/interpolate': {
            const vk = (readCfg(node, 'variable') ?? readCfg(node, 'id')) as string | number | undefined;
            const target = inp('value', inp('target'));
            const dur = Math.max(0, num(inp('duration', (readCfg(node, 'duration') as number) ?? 0.3), 0.3));
            if (vk !== undefined && target !== undefined) {
              addTween({
                key: `var:${String(vk)}`,
                varKey: vk,
                from: cloneVal(inp('from') ?? vars.get(vk) ?? 0),
                to: cloneVal(target),
                dur,
                elapsed: 0,
                quat: false,
                linear: readCfg(node, 'easing') === 'linear',
                done: node.flows?.['done'],
              });
            }
            pushOut();
            break;
          }
          case 'pointer/set': {
            const ptr = resolvePtr(nodeIdx, node);
            const val = inp('value');
            if (ptr && val !== undefined) {
              cancelTween(`ptr:${ptr}`);
              writePtr(ptr, val);
            }
            pushOut();
            break;
          }
          case 'pointer/interpolate': {
            const ptr = resolvePtr(nodeIdx, node);
            const target = inp('value', inp('target'));
            const dur = Math.max(0, num(inp('duration', (readCfg(node, 'duration') as number) ?? 0.3), 0.3));
            if (ptr && target !== undefined) {
              const curVal = inp('from') ?? readPtr(ptr);
              if (curVal !== undefined) {
                if (dur <= 0) {
                  writePtr(ptr, target);
                  pushOut('done');
                } else {
                  addTween({
                    key: `ptr:${ptr}`,
                    ptr,
                    from: cloneVal(curVal),
                    to: cloneVal(target),
                    dur,
                    elapsed: 0,
                    quat: ptr.endsWith('/rotation'),
                    linear: readCfg(node, 'easing') === 'linear',
                    done: node.flows?.['done'],
                  });
                }
              }
            }
            pushOut();
            break;
          }
          case 'animation/start': {
            const ref = inp('animation') ?? readCfg(node, 'animation') ?? readCfg(node, 'clipName');
            const name =
              typeof ref === 'number'
                ? viewer?.animations?.[ref]?.name ?? gltf?.animations?.[ref]?.name
                : typeof ref === 'string'
                  ? ref
                  : undefined;
            viewer?.playAnimation?.(name);
            renderDirty = true;
            pushOut();
            break;
          }
          case 'animation/stop':
          case 'animation/resetAt':
            viewer?.pauseAnimation?.();
            if (op === 'animation/resetAt') viewer?.evaluateAnimation?.(num(inp('time', 0)));
            renderDirty = true;
            pushOut();
            break;
          case 'event/send':
          case 'customEvent/send': {
            const id = resolveEventId(readCfg(node, 'event') ?? readCfg(node, 'id'));
            const payload: Record<string, InteractivityValue> = {};
            for (const k of Object.keys(node.values || {})) {
              if (!FORBIDDEN_SEGMENTS.has(k)) payload[k] = inp(k);
            }
            if (id) {
              if (typeof CustomEvent !== 'undefined' && typeof viewer?.container?.dispatchEvent === 'function') {
                viewer.container.dispatchEvent(
                  new CustomEvent('interactivityEvent', {
                    bubbles: true,
                    composed: true,
                    detail: {id, values: payload},
                  }),
                );
              }
              // Share this invocation's budget so send->receive loops stay bounded.
              receiveWithBudget(id, payload, budget);
            }
            pushOut();
            break;
          }
          default:
            pushOut();
            break;
        }
      }
    };

    this.readScenePointer = readPtr;
    this.writeScenePointer = writePtr;

    this.fireOnStart = () => {
      nodes.forEach((n) => {
        if (getOp(n) === 'event/onStart') followFlow(n.flows?.['out']);
      });
      flushSync();
    };

    // tslint:disable-next-line:no-any
    this.fireOnSelect = (hit: any) => {
      if (!hit) return;
      const mIdx = typeof hit.meshIndex === 'number' ? hit.meshIndex : -1;
      const nIdx =
        typeof hit.nodeIndex === 'number'
          ? hit.nodeIndex
          : (viewer?.meshes?.[mIdx]?.nodeIndex ?? -1);
      nodes.forEach((node, i) => {
        if (!/^(pointer|event|scene)\/onSelect$/.test(getOp(node))) return;
        const tNode =
          readCfg(node, 'nodeIndex') ??
          readCfg(node, 'node') ??
          readIn(i, 'nodeIndex', undefined, new Set());
        const tMesh = readCfg(node, 'meshName');
        const matches =
          typeof tMesh === 'string' && tMesh
            ? hit.meshName === tMesh
            : tNode === undefined || tNode === null || Number(tNode) < 0 || Number.isNaN(Number(tNode))
              ? true
              : isAncestor(nIdx, Math.trunc(Number(tNode)));
        if (!matches) return;
        setOut(i, 'nodeIndex', nIdx);
        setOut(i, 'meshIndex', mIdx);
        if (Array.isArray(hit.hitPoint)) {
          const pt = [num(hit.hitPoint[0]), num(hit.hitPoint[1]), num(hit.hitPoint[2])];
          setOut(i, 'hitPoint', pt);
          setOut(i, 'point', pt);
          setOut(i, 'intersectionPoint', pt);
        }
        if (Array.isArray(hit.normal)) {
          const nm = [num(hit.normal[0]), num(hit.normal[1], 1), num(hit.normal[2])];
          setOut(i, 'normal', nm);
          setOut(i, 'hitNormal', nm);
        }
        if (typeof hit.distance === 'number') setOut(i, 'distance', hit.distance);
        followFlow(node.flows?.['out']);
      });
      flushSync();
    };

    this.receiveCustomEvent = (
      eventIdOrIndex: string | number,
      payload: Record<string, InteractivityValue> = {},
    ) => receiveWithBudget(eventIdOrIndex, payload, {steps: 0});

    function receiveWithBudget(
      eventIdOrIndex: string | number,
      payload: Record<string, InteractivityValue>,
      budget: {steps: number},
    ): void {
      if (eventDepth >= MAX_EVENT_NESTING_DEPTH) return;
      eventDepth++;
      try {
        const targetId = resolveEventId(eventIdOrIndex);
        nodes.forEach((node, i) => {
          if (!/^(customE|e)vent\/receive$/.test(getOp(node))) return;
          const cfgEv = readCfg(node, 'event') ?? readCfg(node, 'id');
          if (resolveEventId(cfgEv) !== targetId && String(cfgEv) !== String(eventIdOrIndex)) return;
          for (const [k, v] of Object.entries(payload)) {
            if (!FORBIDDEN_SEGMENTS.has(k)) setOut(i, k, cloneVal(v));
          }
          followFlow(node.flows?.['out'], budget);
        });
        flushSync();
      } finally {
        eventDepth--;
      }
    }

    this.tick = (dt: number) => {
      if (!Number.isFinite(dt) || dt < 0) return;
      const d = Math.min(dt, 0.25);
      elapsed += d;
      nodes.forEach((n, i) => {
        if (getOp(n) === 'event/onTick') {
          setOut(i, 'timeDelta', d);
          setOut(i, 'dt', d);
          setOut(i, 'timeElapsed', elapsed);
          followFlow(n.flows?.['out']);
        }
      });
      const doneFlows: InteractivityFlowTarget[] = [];
      for (let i = tweens.length - 1; i >= 0; i--) {
        const tw = tweens[i];
        tw.elapsed += d;
        const rt = tw.dur > 1e-6 ? clamp01(tw.elapsed / tw.dur) : 1;
        const et = tw.linear ? rt : rt * rt * (3 - 2 * rt);
        const cur = lerpVal(tw.from, tw.to, et, tw.quat);
        if (tw.ptr) writePtr(tw.ptr, cur);
        else if (tw.varKey !== undefined) setVar(tw.varKey, cur);
        if (rt >= 1) {
          tweens.splice(i, 1);
          if (tw.done) doneFlows.push(tw.done);
        }
      }
      for (let i = delays.length - 1; i >= 0; i--) {
        const dl = delays[i];
        dl.rem -= d;
        if (dl.rem <= 0) {
          delays.splice(i, 1);
          if (dl.done) doneFlows.push(dl.done);
        }
      }
      for (const f of doneFlows) followFlow(f);
      flushSync();
    };

    this.dispose = () => {
      tweens.length = 0;
      delays.length = 0;
      vars.clear();
      outputs.clear();
      doNCounts.clear();
      waitAll.clear();
      throttles.clear();
      multiGates.clear();
    };
  }
}

const viewerVMs = new WeakMap<object, InteractivityVM>();

/**
 * Returns the active `InteractivityVM` bound to `viewer` (or a `<three-live>` /
 * `<xr-live>` element).
 */
// tslint:disable-next-line:no-any
export function getInteractivityVM(viewerOrElement: any): InteractivityVM | undefined {
  if (!viewerOrElement || typeof viewerOrElement !== 'object') return undefined;
  return (
    viewerVMs.get(viewerOrElement) ||
    viewerVMs.get(viewerOrElement.viewer) ||
    viewerVMs.get(viewerOrElement._view)
  );
}

/**
 * Dispatches a custom `KHR_interactivity` event (`event/receive`) into the
 * behavior graph attached to `viewerOrElement`.
 */
export function sendInteractivityEvent(
  // tslint:disable-next-line:no-any
  viewerOrElement: any,
  eventIdOrIndex: string | number,
  values?: Record<string, InteractivityValue>,
): boolean {
  const vm = getInteractivityVM(viewerOrElement);
  if (!vm) return false;
  vm.receiveCustomEvent(eventIdOrIndex, values);
  return true;
}

/**
 * Khronos glTF 2.0 `KHR_interactivity` Runtime Plugin for Three-Live.
 */
export const interactivityPlugin: ThreeLivePlugin & {
  sendInteractivityEvent: typeof sendInteractivityEvent;
  getInteractivityVM: typeof getInteractivityVM;
} = {
  name: 'khr-interactivity',
  sendInteractivityEvent,
  getInteractivityVM,

  // tslint:disable-next-line:no-any
  onLoadModel(viewer: any, gltf: any): void {
    if (!viewer || typeof viewer !== 'object') return;
    viewerVMs.get(viewer)?.dispose();
    viewerVMs.delete(viewer);
    const ext = gltf?.extensions?.KHR_interactivity;
    const graph = Array.isArray(ext?.graphs) ? ext.graphs[ext.graph ?? 0] : ext;
    if (!graph || !Array.isArray(graph.nodes)) return;
    const vm = new InteractivityVM(viewer, gltf, graph);
    viewerVMs.set(viewer, vm);
    vm.fireOnStart();
  },

  // tslint:disable-next-line:no-any
  onMeshSelect(viewer: any, hit: any): void {
    viewerVMs.get(viewer)?.fireOnSelect(hit);
  },

  // tslint:disable-next-line:no-any
  onUpdate(viewer: any, dt: number): void {
    viewerVMs.get(viewer)?.tick(dt);
  },

  // tslint:disable-next-line:no-any
  onDestroy(_gl: WebGL2RenderingContext, viewer: any): void {
    viewerVMs.get(viewer)?.dispose();
    viewerVMs.delete(viewer);
  },
};
