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
 * @fileoverview `persistent-anchors` plugin for `<xr-live>`.
 *
 * Persists user-manipulated node transforms across reloads and shared links via
 * a three-tier pipeline:
 * 1. Compact base64url URL hash (`#xr-state=...`, opt-in via `persist-url-hash`)
 * 2. Namespaced `localStorage` (`xr-live:anchors:<namespace>`)
 * 3. WebXR `XRAnchor` / `restorePersistentAnchor` when supported by the headset
 */

import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  clampNum,
  parseAnchorPersist,
  safeAnchorId,
} from '../../../three-live/src/xr-trait-schema';
import {
  extractPosition,
  extractQuaternion,
  extractScale,
  getMeshXRTraits,
} from '../xr-traits';
import {
  cacheXRFrame,
  emitPluginEvent,
  isXRFrameFresh,
  meshWorldMatrix,
  type PluginViewer,
  type Quat,
  setLocalTRS,
  setWorldTRS,
  type Vec3,
} from './common';

export {parseAnchorPersist, safeAnchorId};

/** Hard cap on persisted node entries per namespace. */
export const MAX_PERSISTED_NODES = 128;

/** Maximum encoded base64url byte length accepted from URL hashes or imports. */
export const MAX_HASH_BYTES = 8192;

/** Storage key prefix for `localStorage`. */
export const ANCHOR_STORAGE_PREFIX = 'xr-live:anchors:';

/** Validated, quantized transform record for one persisted node. */
export interface PersistedNodePose {
  readonly p: Vec3;
  readonly q: Quat;
  readonly s: Vec3;
  readonly xrAnchorUuid?: string;
}

/** Source tier from which anchors were restored. */
export type AnchorRestoreSource = 'xr-anchor' | 'storage' | 'url-hash';

/** Minimal Web Storage interface for dependency injection and SSR safety. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Minimal URL hash / pathname adapter for dependency injection and SSR safety. */
export interface UrlHashAdapter {
  getPathname(): string;
  getHash(): string;
  setHash(hash: string): void;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Validates and clamps an untrusted persisted pose record. Returns `null` if
 * any coordinate, quaternion component, or scale component is non-finite or
 * degenerate, preventing NaN poison via crafted URL hashes or storage entries.
 */
export function sanitizePersistedPose(raw: unknown): PersistedNodePose | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const p = r['p'];
  const q = r['q'];
  const s = r['s'];
  if (
    !Array.isArray(p) ||
    p.length < 3 ||
    !Array.isArray(q) ||
    q.length < 4 ||
    !Array.isArray(s) ||
    s.length < 3
  ) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (typeof p[i] !== 'number' || !Number.isFinite(p[i])) return null;
    if (typeof s[i] !== 'number' || !Number.isFinite(s[i])) return null;
  }
  for (let i = 0; i < 4; i++) {
    if (typeof q[i] !== 'number' || !Number.isFinite(q[i])) return null;
  }
  const qLen = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!Number.isFinite(qLen) || qLen < 1e-6) return null;

  const sp: Vec3 = [
    round4(clampNum(p[0], -1000, 1000, 0)),
    round4(clampNum(p[1], -1000, 1000, 0)),
    round4(clampNum(p[2], -1000, 1000, 0)),
  ];
  const sq: Quat = [
    round4(q[0] / qLen),
    round4(q[1] / qLen),
    round4(q[2] / qLen),
    round4(q[3] / qLen),
  ];
  const ss: Vec3 = [
    round4(clampNum(s[0], 0.001, 1000, 1)),
    round4(clampNum(s[1], 0.001, 1000, 1)),
    round4(clampNum(s[2], 0.001, 1000, 1)),
  ];
  const uuid = safeAnchorId(r['xrAnchorUuid']);
  return uuid ? {p: sp, q: sq, s: ss, xrAnchorUuid: uuid} : {p: sp, q: sq, s: ss};
}

function encodeBase64Url(utf8: string): string {
  if (typeof TextEncoder !== 'undefined' && typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(utf8);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) {
      bin += String.fromCharCode(bytes[i]);
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }
  // Node.js fallback for headless tests.
  // tslint:disable-next-line:no-any Node global Buffer.
  const buf = (globalThis as any).Buffer;
  if (buf && typeof buf.from === 'function') {
    return buf
      .from(utf8, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }
  return '';
}

function decodeBase64Url(b64url: string): string | null {
  if (!b64url || b64url.length > MAX_HASH_BYTES) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(b64url)) return null;
  const padded =
    b64url.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((b64url.length + 3) % 4);
  try {
    if (typeof atob === 'function' && typeof TextDecoder !== 'undefined') {
      const bin = atob(padded);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    }
    // tslint:disable-next-line:no-any Node global Buffer.
    const buf = (globalThis as any).Buffer;
    if (buf && typeof buf.from === 'function') {
      return buf.from(padded, 'base64').toString('utf8');
    }
  } catch {
    return null;
  }
  return null;
}

/** Serializes a validated node pose map into a JSON string for `localStorage`. */
export function serializeAnchorPayload(
  poses: ReadonlyMap<string, PersistedNodePose>,
  updatedAt = Date.now(),
): string {
  const nodes: Record<string, PersistedNodePose> = Object.create(null);
  let count = 0;
  for (const [rawKey, pose] of poses.entries()) {
    if (count >= MAX_PERSISTED_NODES) break;
    const key = safeAnchorId(rawKey);
    const clean = sanitizePersistedPose(pose);
    if (!key || !clean) continue;
    nodes[key] = clean;
    count++;
  }
  return JSON.stringify({version: 1, updatedAt, nodes});
}

/** Parses and sanitizes a JSON payload from `localStorage` or decoded URL hash. */
export function deserializeAnchorPayload(
  jsonText: string | null | undefined,
): Map<string, PersistedNodePose> | null {
  if (typeof jsonText !== 'string' || !jsonText || jsonText.length > MAX_HASH_BYTES * 2) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  if (root['version'] !== undefined && root['version'] !== 1) return null;
  const rawNodes = root['nodes'];
  if (!rawNodes || typeof rawNodes !== 'object' || Array.isArray(rawNodes)) {
    return null;
  }
  const out = new Map<string, PersistedNodePose>();
  for (const [rawKey, rawVal] of Object.entries(rawNodes as Record<string, unknown>)) {
    if (out.size >= MAX_PERSISTED_NODES) break;
    const key = safeAnchorId(rawKey);
    if (!key) continue;
    const clean = sanitizePersistedPose(rawVal);
    if (!clean) return null;
    out.set(key, clean);
  }
  return out;
}

/** Encodes a node pose map into a compact base64url token suitable for `#xr-state=`. */
export function encodeAnchorState(
  poses: ReadonlyMap<string, PersistedNodePose>,
  updatedAt = Date.now(),
): string {
  return encodeBase64Url(serializeAnchorPayload(poses, updatedAt));
}

/** Decodes and validates a compact base64url token from `#xr-state=`. */
export function decodeAnchorState(
  token: string | null | undefined,
): Map<string, PersistedNodePose> | null {
  if (typeof token !== 'string' || !token || token.length > MAX_HASH_BYTES) {
    return null;
  }
  const rawToken = token.startsWith('#xr-state=')
    ? token.slice('#xr-state='.length)
    : token.startsWith('xr-state=')
      ? token.slice('xr-state='.length)
      : token;
  if (!rawToken || rawToken.length > MAX_HASH_BYTES) return null;
  const jsonText = decodeBase64Url(rawToken);
  if (!jsonText) return null;
  return deserializeAnchorPayload(jsonText);
}

/** Extracts the `xr-state` token from a `location.hash` string, or `null`. */
export function extractHashAnchorToken(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const trimmed = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!trimmed) return null;
  for (const part of trimmed.split('&')) {
    if (part.startsWith('xr-state=')) {
      const val = part.slice('xr-state='.length);
      return val.length > 0 && val.length <= MAX_HASH_BYTES ? val : null;
    }
  }
  return null;
}

/** Updates or removes `xr-state=<token>` inside a `location.hash` string. */
export function injectHashAnchorToken(
  currentHash: string,
  token: string | null,
): string {
  const trimmed = currentHash.startsWith('#') ? currentHash.slice(1) : currentHash;
  const others = trimmed
    ? trimmed.split('&').filter((p) => p.length > 0 && !p.startsWith('xr-state='))
    : [];
  if (token && token.length <= MAX_HASH_BYTES) {
    others.push(`xr-state=${token}`);
  }
  return others.length > 0 ? `#${others.join('&')}` : '';
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Blocked in sandboxed / private browsing contexts.
  }
  return null;
}

function defaultUrlAdapter(): UrlHashAdapter | null {
  if (typeof window === 'undefined' || !window.location) return null;
  return {
    getPathname: () => window.location.pathname || 'default',
    getHash: () => window.location.hash || '',
    setHash: (nextHash: string) => {
      try {
        const base = window.location.pathname + window.location.search;
        if (typeof window.history?.replaceState === 'function') {
          window.history.replaceState(null, '', base + nextHash);
        } else {
          window.location.hash = nextHash;
        }
      } catch {
        // Ignore SecurityError in opaque origins.
      }
    },
  };
}

/** Resolves the deterministic persistence / room-sync key for a scene mesh. */
// tslint:disable-next-line:no-any Heterogeneous GPU mesh record.
export function resolvePersistableNodeKey(mesh: any, fallbackIndex = 0): string {
  const traits = getMeshXRTraits(mesh);
  const rawAnchor = mesh?.userData?.xr?.anchor ?? mesh?.extras?.xr?.anchor ?? traits?.anchor;
  const persistMeta =
    parseAnchorPersist(rawAnchor) ??
    parseAnchorPersist((traits as {anchorPersist?: unknown} | undefined)?.anchorPersist);
  return (
    persistMeta?.id ??
    safeAnchorId(mesh?.name) ??
    `node_${typeof mesh?.nodeIndex === 'number' ? mesh.nodeIndex : fallbackIndex}`
  );
}

/** Element-level `<xr-live persistent-anchors ...>` configuration. */
export interface PersistentAnchorsElementConfig {
  readonly enabled: boolean;
  readonly namespace: string;
  readonly persistUrlHash: boolean;
}

/** Resolves `persistent-anchors` and `persist-url-hash` attributes on `<xr-live>`. */
export function resolvePersistentAnchorsConfig(
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  element: any,
  fallbackPath = 'default',
): PersistentAnchorsElementConfig {
  const hasAttr =
    typeof element?.hasAttribute === 'function' &&
    element.hasAttribute('persistent-anchors');
  const rawNs = (element?.getAttribute?.('persistent-anchors') ?? '').trim();
  const disabled = rawNs.toLowerCase() === 'false' || rawNs.toLowerCase() === 'none';
  const namespace =
    safeAnchorId(rawNs && rawNs.toLowerCase() !== 'true' ? rawNs : fallbackPath) ??
    'default';
  const hasHashAttr =
    typeof element?.hasAttribute === 'function' &&
    element.hasAttribute('persist-url-hash');
  const rawHash = (element?.getAttribute?.('persist-url-hash') ?? '').trim().toLowerCase();
  const persistUrlHash = hasHashAttr && rawHash !== 'false' && rawHash !== 'none';
  return {
    enabled: (hasAttr && !disabled) || persistUrlHash,
    namespace,
    persistUrlHash,
  };
}

interface PersistableEntry {
  readonly key: string;
  // tslint:disable-next-line:no-any Scene GPU mesh.
  readonly mesh: any;
}

/**
 * Per-element controller managing deterministic node keying, URL-hash /
 * `localStorage` / WebXR `persistentAnchors` restoration, and auto-saving.
 */
export class XRPersistentAnchorsController {
  private storageOverride: StorageLike | null = null;
  private urlOverride: UrlHashAdapter | null = null;
  private restoredForMeshSet = new WeakSet<object>();
  private hasRestoredOnce = false;
  private wasAnyGrabbed = false;
  private xrRestoredSession: unknown = null;
  private readonly liveXrAnchors = new Map<string, unknown>();
  private readonly xrUuids = new Map<string, string>();
  private readonly anchoredPoseKeys = new Map<string, string>();

  constructor(storage?: StorageLike | null, urlAdapter?: UrlHashAdapter | null) {
    this.storageOverride = storage ?? null;
    this.urlOverride = urlAdapter ?? null;
  }

  private getStorage(): StorageLike | null {
    return this.storageOverride ?? defaultStorage();
  }

  private getUrl(): UrlHashAdapter | null {
    return this.urlOverride ?? defaultUrlAdapter();
  }

  private resolveStorageKey(
    // tslint:disable-next-line:no-any Host element.
    element: any,
  ): PersistentAnchorsElementConfig {
    const pathname = this.getUrl()?.getPathname() ?? 'default';
    return resolvePersistentAnchorsConfig(element, pathname);
  }

  /** Enumerates persistable scene meshes and assigns deterministic unique keys. */
  collectPersistableMeshes(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
  ): PersistableEntry[] {
    const meshes = viewer.meshes;
    if (!Array.isArray(meshes)) return [];
    const cfg = this.resolveStorageKey(element);
    const rawNs = (element?.getAttribute?.('persistent-anchors') ?? '').trim().toLowerCase();
    if (rawNs === 'false' || rawNs === 'none') return [];

    const out: PersistableEntry[] = [];
    const usedKeys = new Set<string>();
    for (let i = 0; i < meshes.length; i++) {
      if (out.length >= MAX_PERSISTED_NODES) break;
      const m = meshes[i];
      if (!m || m.isPluginMesh || (typeof m.name === 'string' && m.name.startsWith('__xr_'))) {
        continue;
      }
      const traits = getMeshXRTraits(m);
      const rawAnchor = traits?.anchor;
      if (
        rawAnchor &&
        typeof rawAnchor === 'object' &&
        (rawAnchor as {persist?: unknown}).persist === false
      ) {
        continue;
      }
      const persistMeta =
        parseAnchorPersist(rawAnchor) ??
        parseAnchorPersist((traits as {anchorPersist?: unknown} | undefined)?.anchorPersist);
      const eligible =
        Boolean(persistMeta?.persist) ||
        (cfg.enabled &&
          Boolean(
            traits?.grab ||
              traits?.grabbable ||
              traits?.handles ||
              traits?.snapTo,
          ));
      if (!eligible) continue;

      const baseKey = resolvePersistableNodeKey(m, i);
      let uniqueKey = baseKey;
      let suffix = 2;
      while (usedKeys.has(uniqueKey)) {
        uniqueKey = `${baseKey}#${suffix++}`;
      }
      usedKeys.add(uniqueKey);
      out.push({key: uniqueKey, mesh: m});
    }
    return out;
  }

  /** Builds the current pose map for all persistable meshes in `viewer`. */
  snapshotPoses(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
  ): Map<string, PersistedNodePose> {
    const entries = this.collectPersistableMeshes(viewer, element);
    const map = new Map<string, PersistedNodePose>();
    for (const {key, mesh} of entries) {
      if (!mesh?.transform) continue;
      const rawPose: Record<string, unknown> = {
        p: extractPosition(mesh.transform),
        q: extractQuaternion(mesh.transform),
        s: extractScale(mesh.transform),
      };
      const uuid = this.xrUuids.get(key);
      if (uuid) rawPose['xrAnchorUuid'] = uuid;
      const clean = sanitizePersistedPose(rawPose);
      if (clean) map.set(key, clean);
    }
    return map;
  }

  /** Saves current persistable node transforms to `localStorage` and optional URL hash. */
  save(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
  ): string {
    const entries = this.collectPersistableMeshes(viewer, element);
    if (entries.length === 0) return '';
    const poses = this.snapshotPoses(viewer, element);
    if (poses.size === 0) return '';
    const cfg = this.resolveStorageKey(element);
    const storage = this.getStorage();
    const json = serializeAnchorPayload(poses);
    try {
      storage?.setItem(`${ANCHOR_STORAGE_PREFIX}${cfg.namespace}`, json);
    } catch {
      // Ignore QuotaExceededError.
    }
    const token = encodeAnchorState(poses);
    if (cfg.persistUrlHash && token && token.length <= MAX_HASH_BYTES) {
      const url = this.getUrl();
      if (url) {
        url.setHash(injectHashAnchorToken(url.getHash(), token));
      }
    }
    return token;
  }

  /** Exports current persistable node transforms as a base64url `#xr-state` token. */
  exportAnchorState(
    viewer: PluginViewer | undefined,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
  ): string {
    if (!viewer) return '';
    const poses = this.snapshotPoses(viewer, element);
    return poses.size > 0 ? encodeAnchorState(poses) : '';
  }

  /** Imports a base64url token, applies poses to `viewer`, and persists them. */
  importAnchorState(
    token: string,
    viewer: PluginViewer | undefined,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
  ): number {
    if (!viewer) return 0;
    const poses = decodeAnchorState(token);
    if (!poses) return 0;
    const applied = this.applyPoseMap(viewer, element, poses);
    if (applied > 0) {
      this.save(viewer, element);
      emitPluginEvent(element, 'anchorsrestored', {
        count: applied,
        source: 'url-hash' as AnchorRestoreSource,
      });
    }
    return applied;
  }

  /** Restores persisted poses from URL hash (`#xr-state=`) or `localStorage`. */
  restore(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
  ): {count: number; source: AnchorRestoreSource | null} {
    const entries = this.collectPersistableMeshes(viewer, element);
    if (entries.length === 0) return {count: 0, source: null};

    // Tier 1: URL hash `#xr-state=...` takes precedence for shared layout links.
    const hashToken = extractHashAnchorToken(this.getUrl()?.getHash());
    if (hashToken) {
      const decoded = decodeAnchorState(hashToken);
      if (decoded && decoded.size > 0) {
        const count = this.applyPoseMap(viewer, element, decoded);
        if (count > 0) {
          this.hasRestoredOnce = true;
          emitPluginEvent(element, 'anchorsrestored', {
            count,
            source: 'url-hash' as AnchorRestoreSource,
          });
          return {count, source: 'url-hash'};
        }
      }
    }

    // Tier 2: Namespaced `localStorage`.
    const cfg = this.resolveStorageKey(element);
    const rawJson = this.getStorage()?.getItem(`${ANCHOR_STORAGE_PREFIX}${cfg.namespace}`);
    const stored = deserializeAnchorPayload(rawJson);
    if (stored && stored.size > 0) {
      const count = this.applyPoseMap(viewer, element, stored);
      if (count > 0) {
        this.hasRestoredOnce = true;
        emitPluginEvent(element, 'anchorsrestored', {
          count,
          source: 'storage' as AnchorRestoreSource,
        });
        return {count, source: 'storage'};
      }
    }

    this.hasRestoredOnce = true;
    return {count: 0, source: null};
  }

  private applyPoseMap(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element: any,
    poses: ReadonlyMap<string, PersistedNodePose>,
  ): number {
    const entries = this.collectPersistableMeshes(viewer, element);
    let count = 0;
    for (const {key, mesh} of entries) {
      const pose = poses.get(key);
      if (!pose || !mesh?.transform) continue;
      setLocalTRS(mesh, pose.q, pose.p, pose.s);
      if (pose.xrAnchorUuid) {
        this.xrUuids.set(key, pose.xrAnchorUuid);
      }
      this.restoredForMeshSet.add(mesh);
      count++;
    }
    return count;
  }

  /** Clears persisted state from `localStorage`, URL hash, and WebXR persistent handles. */
  // tslint:disable-next-line:no-any Host element + optional XR session.
  clearPersistedAnchors(element?: any, session?: any): void {
    const cfg = this.resolveStorageKey(element);
    try {
      this.getStorage()?.removeItem(`${ANCHOR_STORAGE_PREFIX}${cfg.namespace}`);
    } catch {
      // Ignore storage access errors.
    }
    const url = this.getUrl();
    if (url && extractHashAnchorToken(url.getHash()) !== null) {
      url.setHash(injectHashAnchorToken(url.getHash(), null));
    }
    if (typeof session?.deletePersistentAnchor === 'function') {
      for (const uuid of this.xrUuids.values()) {
        try {
          Promise.resolve(session.deletePersistentAnchor(uuid)).catch(() => {});
        } catch {
          // Ignore unsupported / unknown handles.
        }
      }
    }
    for (const anchor of this.liveXrAnchors.values()) {
      (anchor as {delete?: () => void} | null)?.delete?.();
    }
    this.liveXrAnchors.clear();
    this.xrUuids.clear();
    this.anchoredPoseKeys.clear();
  }

  /** Steps restoration on initial scene readiness and auto-saves on grab release. */
  update(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element?: any,
    // tslint:disable-next-line:no-any Optional WebXR session/frame/refSpace.
    xrCtx?: {session?: any; frame?: any; refSpace?: any},
  ): void {
    const entries = this.collectPersistableMeshes(viewer, element);
    if (entries.length === 0) return;

    const hasUnseenMesh = entries.some(({mesh}) => !this.restoredForMeshSet.has(mesh));
    if (!this.hasRestoredOnce || hasUnseenMesh) {
      for (const {mesh} of entries) this.restoredForMeshSet.add(mesh);
      this.restore(viewer, element);
    }

    // Tier 3: WebXR `persistentAnchors` restore & pose tracking.
    if (xrCtx?.session && xrCtx.frame && xrCtx.refSpace) {
      this.stepWebXRAnchors(viewer, element, entries, xrCtx.session, xrCtx.frame, xrCtx.refSpace);
    }

    const grabbedCount =
      typeof element?.traitSystem?.getGrabbedMeshes === 'function'
        ? element.traitSystem.getGrabbedMeshes().length
        : 0;
    const isNowGrabbed = grabbedCount > 0;
    if (this.wasAnyGrabbed && !isNowGrabbed) {
      if (xrCtx?.frame && xrCtx.refSpace) {
        this.requestWebXRPersistentAnchors(
          viewer,
          entries,
          xrCtx.frame,
          xrCtx.refSpace,
          element,
          xrCtx.session,
        );
      }
      this.save(viewer, element);
    }
    this.wasAnyGrabbed = isNowGrabbed;
  }

  private stepWebXRAnchors(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host element.
    element: any,
    entries: PersistableEntry[],
    // tslint:disable-next-line:no-any WebXR session.
    session: any,
    // tslint:disable-next-line:no-any WebXR frame.
    frame: any,
    refSpace: unknown,
  ): void {
    if (
      this.xrRestoredSession !== session &&
      typeof session.restorePersistentAnchor === 'function' &&
      this.xrUuids.size > 0
    ) {
      this.xrRestoredSession = session;
      let restoredCount = 0;
      const pending: Array<Promise<void>> = [];
      for (const [key, uuid] of this.xrUuids.entries()) {
        try {
          const p = Promise.resolve(session.restorePersistentAnchor(uuid))
            .then((anchor: unknown) => {
              if (anchor) {
                this.liveXrAnchors.set(key, anchor);
                restoredCount++;
              }
            })
            .catch(() => {});
          pending.push(p);
        } catch {
          // Ignore unsupported UUIDs.
        }
      }
      if (pending.length > 0) {
        void Promise.all(pending).then(() => {
          if (restoredCount > 0) {
            emitPluginEvent(element, 'anchorsrestored', {
              count: restoredCount,
              source: 'xr-anchor' as AnchorRestoreSource,
            });
          }
        });
      }
    }

    for (const {key, mesh} of entries) {
      // tslint:disable-next-line:no-any WebXR XRAnchor.
      const anchor = this.liveXrAnchors.get(key) as any;
      if (!anchor?.anchorSpace || element?.traitSystem?.isGrabbing?.(mesh)) continue;
      try {
        const pose = frame.getPose?.(anchor.anchorSpace, refSpace);
        const mat = pose?.transform?.matrix;
        if (mat && mat.length === 16) {
          setWorldTRS(
            viewer,
            mesh,
            extractQuaternion(mat),
            extractPosition(mat),
            extractScale(mesh.transform),
          );
        }
      } catch {
        // Ignore transient tracking loss.
      }
    }
  }

  private requestWebXRPersistentAnchors(
    viewer: PluginViewer,
    entries: PersistableEntry[],
    // tslint:disable-next-line:no-any WebXR frame.
    frame: any,
    refSpace: unknown,
    // tslint:disable-next-line:no-any Host element.
    element: any,
    // tslint:disable-next-line:no-any WebXR session.
    session?: any,
  ): void {
    if (typeof frame?.createAnchor !== 'function') return;
    // tslint:disable-next-line:no-any Global XRRigidTransform constructor.
    const RigidTransformCtor = (globalThis as any).XRRigidTransform;
    if (typeof RigidTransformCtor !== 'function') return;

    for (const {key, mesh} of entries) {
      const wm = meshWorldMatrix(viewer, mesh);
      const pos = extractPosition(wm);
      const quat = extractQuaternion(wm);
      // Only re-anchor nodes that actually moved: headsets cap persistent
      // anchors, and every release used to re-anchor every node.
      const poseKey = [...pos, ...quat].map((v) => Math.round(v * 1000)).join(',');
      if (this.anchoredPoseKeys.get(key) === poseKey && this.liveXrAnchors.has(key)) {
        continue;
      }
      this.anchoredPoseKeys.set(key, poseKey);
      try {
        const xform = new RigidTransformCtor(
          {x: pos[0], y: pos[1], z: pos[2], w: 1},
          {x: quat[0], y: quat[1], z: quat[2], w: quat[3]},
        );
        void Promise.resolve(frame.createAnchor(xform, refSpace))
          // tslint:disable-next-line:no-any WebXR XRAnchor.
          .then(async (anchor: any) => {
            if (!anchor) return;
            const prev = this.liveXrAnchors.get(key) as {delete?: () => void} | undefined;
            prev?.delete?.();
            this.liveXrAnchors.set(key, anchor);
            if (typeof anchor.requestPersistentHandle === 'function') {
              const uuid = await anchor.requestPersistentHandle();
              const cleanUuid = safeAnchorId(uuid);
              if (cleanUuid) {
                const oldUuid = this.xrUuids.get(key);
                if (
                  oldUuid &&
                  oldUuid !== cleanUuid &&
                  typeof session?.deletePersistentAnchor === 'function'
                ) {
                  // Release the superseded handle so stored anchors don't leak.
                  Promise.resolve(session.deletePersistentAnchor(oldUuid)).catch(() => {});
                }
                this.xrUuids.set(key, cleanUuid);
                this.save(viewer, element);
              }
            }
          })
          .catch(() => {});
      } catch {
        // Ignore anchor creation failure.
      }
    }
  }

  /** Resets model restoration tracking when a new model is loaded. */
  resetForNewModel(): void {
    this.restoredForMeshSet = new WeakSet<object>();
    this.hasRestoredOnce = false;
  }

  /** Releases active WebXR anchor handles without deleting saved storage. */
  dispose(): void {
    for (const anchor of this.liveXrAnchors.values()) {
      (anchor as {delete?: () => void} | null)?.delete?.();
    }
    this.liveXrAnchors.clear();
    this.xrRestoredSession = null;
    this.wasAnyGrabbed = false;
  }
}

const controllers = new WeakMap<object, XRPersistentAnchorsController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the `persistent-anchors` controller for `key`. */
export function getPersistentAnchorsController(
  key: object,
): XRPersistentAnchorsController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRPersistentAnchorsController();
    controllers.set(key, c);
  }
  return c;
}

/** `ThreeLivePlugin` providing cross-session spatial persistence & URL layout sharing. */
export const persistentAnchorsPlugin: ThreeLivePlugin = {
  name: 'xr-live-persistent-anchors',
  // tslint:disable-next-line:no-any Host element and WebXR sessionInit.
  onConfigureXRSessionInit(element: any, sessionInit: any): void {
    const cfg = resolvePersistentAnchorsConfig(element);
    if (!cfg.enabled || !sessionInit) return;
    const optional = new Set<string>(sessionInit.optionalFeatures ?? []);
    optional.add('anchors');
    sessionInit.optionalFeatures = Array.from(optional);
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element) return;
    const ctrl = getPersistentAnchorsController(element);
    const viewerOf = (): PluginViewer | undefined => element._view ?? element.viewer;
    element.savePersistedAnchors = () => {
      const v = viewerOf();
      return v ? ctrl.save(v, element) : '';
    };
    element.clearPersistedAnchors = () =>
      ctrl.clearPersistedAnchors(element, element.activeXRSession);
    element.exportAnchorState = () => ctrl.exportAnchorState(viewerOf(), element);
    element.importAnchorState = (token: string) =>
      ctrl.importAnchorState(token, viewerOf(), element);

    if (typeof element.addEventListener !== 'function' || listeners.has(element)) return;
    const onSaveTrigger = (): void => {
      const v = viewerOf();
      if (v) ctrl.save(v, element);
    };
    const bound: Array<[string, EventListener]> = [
      ['xrsnap', onSaveTrigger],
      ['xr-handles-change', onSaveTrigger],
    ];
    for (const [name, fn] of bound) element.addEventListener(name, fn);
    listeners.set(element, bound);
  },
  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    for (const [name, fn] of listeners.get(element) ?? []) {
      element.removeEventListener?.(name, fn);
    }
    listeners.delete(element);
    controllers.get(element)?.dispose();
  },
  // tslint:disable-next-line:no-any Viewer and glTF JSON.
  onLoadModel(viewer: any): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.resetForNewModel();
  },
  onXRFrame(viewer: unknown, session: unknown, frame: unknown, refSpace: unknown): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    getPersistentAnchorsController(host ?? v).update(v, host, {
      session,
      frame,
      refSpace,
    });
  },
  onUpdate(viewer: PluginViewer): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getPersistentAnchorsController(host ?? viewer).update(viewer, host);
  },
  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    const host = viewer?.container;
    controllers.get(host ?? viewer)?.dispose();
  },
};
