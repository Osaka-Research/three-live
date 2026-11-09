/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Selection for Tap & Speak / Talk-to-Select (`three-live-ai`, roadmap B2b-4).
 *
 * `el.selectedMeshes` is the multi-select set; `selected-mesh` / `el.selectedMesh` stays its
 * first entry for compatibility. Every change fires `three-live-select` with
 * `{mesh, meshes, added, removed, source, query?}` and highlights the whole set.
 */

import {
  buildSelectIndex,
  DEFAULT_SELECT_CAMERA,
  matchSelection,
  type SelectCamera,
  type SelectIndexEntry,
  type SelectMatch,
  type SelectRawEntry,
} from './ai-select-match';

/** What changed the selection. */
export type AISelectionSource = 'tap' | 'voice' | 'api';

/** How a request changes the selection. */
export type AISelectionMode = 'replace' | 'add' | 'remove' | 'toggle' | 'clear';

/** Payload of the `three-live-select` event. */
export interface AISelectionEventDetail {
  /** First selected mesh (compatibility with single selection), or `null`. */
  readonly mesh: string | null;
  readonly meshes: readonly string[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly source: AISelectionSource;
  /** The spoken / typed reference that produced this selection, if any. */
  readonly query?: string;
}

/** The element surface selection relies on. */
export interface AISelectableElement {
  selectedMesh?: string | null;
  selectedMeshes?: readonly string[];
  viewer?: {setSelectedMeshes?(names: readonly string[]): void} | null;
  fireEvent?(type: string, detail?: unknown): void;
  addEventListener?(type: string, fn: (e: Event) => void): void;
  __tlSelection?: string[];
  __tlSelectionInstalled?: boolean;
}

/** Most meshes one selection may hold. */
export const MAX_SELECTION = 50;

function clean(names: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const n of names) {
    const name = typeof n === 'string' ? n.slice(0, 200) : '';
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_SELECTION) break;
  }
  return out;
}

/**
 * The current selection. When `selected-mesh` was changed outside this module (an app setting
 * `el.selectedMesh`), that wins and becomes the whole selection.
 */
export function getSelection(el: AISelectableElement): string[] {
  const list = el.__tlSelection ?? [];
  const attr = el.selectedMesh || null;
  if ((list[0] ?? null) !== attr) return attr ? [attr] : [];
  return [...list];
}

/**
 * Changes the selection, highlights it, and fires `three-live-select`. Returns the event
 * detail, or `null` when nothing changed.
 */
export function setSelection(
  el: AISelectableElement,
  names: readonly string[] | string | null,
  options: {mode?: AISelectionMode; source?: AISelectionSource; query?: string} = {},
): AISelectionEventDetail | null {
  const mode = options.mode ?? 'replace';
  const before = getSelection(el);
  const given = clean(typeof names === 'string' ? [names] : (names ?? []));
  let next: string[];
  switch (mode) {
    case 'clear':
      next = [];
      break;
    case 'add':
      next = clean([...before, ...given]);
      break;
    case 'remove':
      next = before.filter((m) => !given.includes(m));
      break;
    case 'toggle':
      next = clean([
        ...before.filter((m) => !given.includes(m)),
        ...given.filter((m) => !before.includes(m)),
      ]);
      break;
    default:
      next = given;
  }
  const added = next.filter((m) => !before.includes(m));
  const removed = before.filter((m) => !next.includes(m));
  if (!added.length && !removed.length && next.join('\n') === before.join('\n')) return null;
  el.__tlSelection = next;
  // The attribute drives single-mesh consumers; the viewer then gets the full set.
  el.selectedMesh = next[0] ?? null;
  el.viewer?.setSelectedMeshes?.(next);
  const detail: AISelectionEventDetail = {
    mesh: next[0] ?? null,
    meshes: next,
    added,
    removed,
    source: options.source ?? 'api',
    ...(options.query ? {query: String(options.query).slice(0, 2000)} : {}),
  };
  el.fireEvent?.('three-live-select', detail);
  return detail;
}

/** Adds `el.selectedMeshes` and keeps the highlight across scene reloads. Idempotent. */
export function installSelectionState(el: AISelectableElement): void {
  if (!el || el.__tlSelectionInstalled) return;
  el.__tlSelectionInstalled = true;
  if (!('selectedMeshes' in el)) {
    Object.defineProperty(el, 'selectedMeshes', {
      get: () => getSelection(el),
      set: (v: readonly string[] | null) => {
        setSelection(el, v ?? [], {mode: 'replace', source: 'api'});
      },
      configurable: true,
    });
  }
  // A reload (e.g. an applied edit) re-applies only `selected-mesh`; restore the full set.
  el.addEventListener?.('three-load', () => {
    const current = getSelection(el);
    if (current.length > 1) el.viewer?.setSelectedMeshes?.(current);
  });
}

/** Describes a selection for a voice model ("the meshes "A" and "B""). */
export function describeSelection(meshes: readonly string[]): string {
  if (!meshes.length) return 'The user cleared the selection.';
  if (meshes.length === 1) {
    return `The user selected the mesh "${meshes[0]}". "This" or "it" now refers to it.`;
  }
  const shown = meshes.slice(0, 20).map((m) => `"${m}"`);
  const more = meshes.length > 20 ? ` and ${meshes.length - 20} more` : '';
  return `The user selected ${meshes.length} meshes: ${shown.join(', ')}${more}. "These", "them", or "it" refer to them.`;
}

// ---------------------------------------------------------------------------------------------
// Talk-to-Select: the web scene index and camera for the tier-1 matcher.

type Vec3 = [number, number, number];

/** The viewer surface the scene index reads (`ThreeView`). */
interface IndexableViewer {
  meshes?: ReadonlyArray<{
    name: string;
    transform: ArrayLike<number>;
    visible?: boolean;
    primitives: ReadonlyArray<{positions?: ArrayLike<number>; baseColor?: readonly number[]}>;
  }>;
  getCameraOrbit?(): {theta: number; phi: number; radius: number};
  getCameraTarget?(): {x: number; y: number; z: number};
}

/** Local-space boxes per positions array (computed once per geometry). */
const localBoxes = new WeakMap<object, [Vec3, Vec3] | null>();

function localBox(positions: ArrayLike<number>): [Vec3, Vec3] | null {
  const key = positions as unknown as object;
  if (localBoxes.has(key)) return localBoxes.get(key)!;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  const box: [Vec3, Vec3] | null = Number.isFinite(lo[0]) ? [lo, hi] : null;
  localBoxes.set(key, box);
  return box;
}

/**
 * One raw entry per visible named mesh: its world box (from the node transform) and its first
 * primitive's linear base color.
 */
export function sceneSelectEntries(el: {viewer?: unknown}): SelectRawEntry[] {
  const meshes = (el.viewer as IndexableViewer | null | undefined)?.meshes ?? [];
  const out: SelectRawEntry[] = [];
  for (const mesh of meshes.slice(0, 5000)) {
    if (!mesh?.name || mesh.visible === false) continue;
    const m = mesh.transform;
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const p of mesh.primitives ?? []) {
      const box = p.positions ? localBox(p.positions) : null;
      if (!box) continue;
      for (let i = 0; i < 8; i++) {
        const x = box[i & 1 ? 1 : 0][0];
        const y = box[i & 2 ? 1 : 0][1];
        const z = box[i & 4 ? 1 : 0][2];
        for (let k = 0; k < 3; k++) {
          const v = m ? m[k] * x + m[4 + k] * y + m[8 + k] * z + m[12 + k] : [x, y, z][k];
          if (v < lo[k]) lo[k] = v;
          if (v > hi[k]) hi[k] = v;
        }
      }
    }
    if (!Number.isFinite(lo[0])) continue;
    const c = mesh.primitives?.[0]?.baseColor;
    out.push({name: mesh.name, min: lo, max: hi, color: c ? [c[0], c[1], c[2]] : null});
  }
  return out;
}

/** The viewer's orbit camera as eye + target (the matcher's default when unavailable). */
export function selectCamera(el: {viewer?: unknown}): SelectCamera {
  const v = el.viewer as IndexableViewer | null | undefined;
  const o = v?.getCameraOrbit?.();
  const t = v?.getCameraTarget?.();
  if (!o || !t || ![o.theta, o.phi, o.radius, t.x, t.y, t.z].every(Number.isFinite)) {
    return DEFAULT_SELECT_CAMERA;
  }
  const flat = o.radius * Math.cos(o.phi);
  return {
    eye: [t.x + flat * Math.sin(o.theta), t.y + o.radius * Math.sin(o.phi), t.z + flat * Math.cos(o.theta)],
    target: [t.x, t.y, t.z],
  };
}

/** Resolves a spoken reference against the element's current scene (tier 1). */
export function resolveSelection(
  el: AISelectableElement & {viewer?: unknown},
  query: string,
  options: {within?: readonly string[] | null} = {},
): SelectMatch {
  const index = buildSelectIndex(sceneSelectEntries(el));
  return matchSelection(index, query, selectCamera(el), options.within ?? null);
}

// ---------------------------------------------------------------------------------------------
// Talk-to-Select tier 2: the code model resolves references tier 1 can't ("the cup next to the
// sofa", other languages). Shared wording with `compiler/src/ai_select.rs`.

/** System prompt for tier-2 selection. */
export const SELECT_PROMPT = [
  'You find the objects a user means in a 3D scene.',
  'Reply with JSON only: {"ids": [numbers], "confidence": "high" or "low", "question": "text"}.',
  'Use only ids from the objects list.',
  'Left and right are as seen from the camera: "right" is the camera\'s right direction.',
  'If several objects fit equally, or none fits, set confidence to "low" and ask one short question that names the options.',
].join(' ');

/** The minimal provider surface tier 2 needs (`ThreeLiveAIProvider`). */
export interface AISelectProvider {
  complete(request: {
    messages: Array<{role: 'system' | 'user' | 'assistant'; content: string}>;
    signal?: AbortSignal;
  }): Promise<string>;
}

/** Tier-2 result. */
export interface AIModelSelection {
  readonly names: string[];
  readonly confidence: 'high' | 'low';
  readonly question: string;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Chat messages for tier 2 (index, camera, current selection, request). */
export function selectMessages(
  index: readonly SelectIndexEntry[],
  query: string,
  camera: SelectCamera,
  selected: readonly string[] = [],
): Array<{role: 'system' | 'user'; content: string}> {
  const f = [0, 1, 2].map((k) => camera.target[k] - camera.eye[k]);
  const rl = Math.hypot(f[2], f[0]) || 1;
  const payload = {
    camera: {
      eye: camera.eye.map(round2),
      target: camera.target.map(round2),
      right: [round2(-f[2] / rl), 0, round2(f[0] / rl)],
    },
    objects: index.slice(0, 300).map((e) => ({
      id: e.id,
      name: e.name,
      color: e.colorName,
      center: e.center.map(round2),
      size: round2(Math.cbrt(e.size)),
    })),
    selected: selected.slice(0, 50),
    request: String(query).slice(0, 500),
  };
  return [
    {role: 'system', content: SELECT_PROMPT},
    {role: 'user', content: JSON.stringify(payload)},
  ];
}

/** Parses a tier-2 reply; ids outside the index are dropped. */
export function parseSelectReply(reply: string, index: readonly SelectIndexEntry[]): AIModelSelection {
  const text = String(reply ?? '');
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  let v: {ids?: unknown; confidence?: unknown; question?: unknown} = {};
  if (a >= 0 && b > a) {
    try {
      v = JSON.parse(text.slice(a, b + 1)) ?? {};
    } catch {}
  }
  const names: string[] = [];
  for (const id of Array.isArray(v.ids) ? v.ids : []) {
    const e = Number.isInteger(id) ? index[id as number] : undefined;
    if (e && !names.includes(e.name) && names.length < MAX_SELECTION) names.push(e.name);
  }
  const question = (typeof v.question === 'string' ? v.question : '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 300);
  return {names, confidence: v.confidence === 'high' && names.length ? 'high' : 'low', question};
}

/** Tier 2: asks the code model which meshes `query` means. */
export async function resolveSelectionWithModel(
  el: AISelectableElement & {viewer?: unknown},
  query: string,
  provider: AISelectProvider,
  options: {within?: readonly string[] | null; signal?: AbortSignal} = {},
): Promise<AIModelSelection> {
  let entries = sceneSelectEntries(el);
  if (options.within) entries = entries.filter((e) => options.within!.includes(e.name));
  const index = buildSelectIndex(entries);
  if (!index.length) return {names: [], confidence: 'low', question: ''};
  const reply = await provider.complete({
    messages: selectMessages(index, query, selectCamera(el), getSelection(el)),
    signal: options.signal,
  });
  return parseSelectReply(reply, index);
}
