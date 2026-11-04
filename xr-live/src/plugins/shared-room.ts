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
 * @fileoverview `shared-room` plugin for `<xr-live>`.
 *
 * Provides lightweight, zero-dependency multi-user co-presence and state sync:
 * 1. Instant same-origin multi-tab sync via `BroadcastChannel("xr-live:room:<id>")`
 *    or cross-device sync via a `wss://` (or loopback `ws://`) WebSocket relay
 * 2. Rate-limited `20 Hz` (`50ms`) quantized head + pointer ray broadcasts
 * 3. Optimistic `2000ms` soft-lock ownership leases on grabbed / synced nodes
 * 4. Synchronized `exploded-view` state and `spatial-paint` 3D stroke chunks
 * 5. Stylized 3D peer visor pills and tinted laser rays with hit dots
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Multiply,
} from '../../../three-live/src/math';
import type {ThreeLivePlugin} from '../../../three-live/src/plugin';
import {
  clampNum,
  safeAnchorId,
  safeHexColor,
} from '../../../three-live/src/xr-trait-schema';
import {
  extractPosition,
  extractQuaternion,
  extractScale,
  getMeshXRTraits,
} from '../xr-traits';
import {
  applyWorldMatrix,
  buildBoxGeometry,
  cacheXRFrame,
  createDynamicMesh,
  type DynamicGeometry,
  emitPluginEvent,
  inverseRootMatrix,
  isXRFrameFresh,
  type PluginViewer,
  type Quat,
  reattachDynamicMesh,
  removeDynamicMesh,
  resolveHeadPose,
  rootMatrix,
  setLocalTRS,
  setWorldTRS,
  transformPoint,
  updateDynamicMesh,
  type Vec3,
  vLen,
  vSub,
} from './common';
import {getExplodedViewController} from './exploded-view';
import {
  resolvePersistableNodeKey,
  sanitizePersistedPose,
} from './persistent-anchors';
import {buildSegmentBarsGeometry} from './spatial-measure';
import {getSpatialPaintController, TubeStrokeBuilder} from './spatial-paint';

/** Maximum wire payload size in UTF-8 bytes (`16 KB`). */
export const MAX_PAYLOAD_BYTES = 16384;

/** Maximum concurrent remote peers tracked per room. */
export const MAX_PEERS = 16;

/** Silence threshold in milliseconds before a stale peer is pruned. */
export const PEER_TIMEOUT_MS = 5000;

/** Minimum interval in milliseconds between outbound pose ticks (`20 Hz`). */
export const POSE_TICK_INTERVAL_MS = 50;

/** Optimistic soft-lock ownership lease duration in milliseconds. */
export const SOFT_LOCK_TTL_MS = 2000;

/** Maximum characters retained for a peer display name. */
export const MAX_PEER_NAME_CHARS = 32;

/** Maximum remote 3D paint strokes retained per room session. */
export const MAX_REMOTE_STROKES = 64;

/** Maximum remote paint strokes accepted per peer per second (GPU churn guard). */
export const MAX_PAINT_MESSAGES_PER_SEC = 8;

/** Maximum points allowed in a single synced paint stroke message. */
export const MAX_STROKE_CHUNK_POINTS = 128;

/** Maximum characters allowed for an SDP offer/answer or ICE candidate in `rtc` signaling. */
export const MAX_RTC_SIGNAL_CHARS = 8192;

/** Maximum WebRTC signaling (`type: 'rtc'`) messages accepted per peer per second. */
export const MAX_RTC_MESSAGES_PER_SEC = 32;

/** Supported WebRTC signaling message subtypes. */
export type RtcSignalType = 'offer' | 'answer' | 'ice';

/** Spatialized voice attenuation and stereo panning gains for a remote peer. */
export interface SpatialVoiceGain {
  readonly gain: number;
  readonly pan: number;
  readonly leftGain: number;
  readonly rightGain: number;
}

/**
 * Computes inverse-distance spatial voice attenuation and equal-power stereo
 * panning from the listener's 6DoF head pose to a remote peer's head position.
 */
export function computeSpatialVoiceGain(
  listenerPos: readonly [number, number, number],
  listenerQuat: readonly [number, number, number, number],
  peerHeadPos: readonly [number, number, number],
  refDistance = 1,
  maxDistance = 15,
  rolloff = 1,
): SpatialVoiceGain {
  const dx = peerHeadPos[0] - listenerPos[0];
  const dy = peerHeadPos[1] - listenerPos[1];
  const dz = peerHeadPos[2] - listenerPos[2];
  const dist = Math.hypot(dx, dy, dz);

  const refD = Math.max(0.01, Number.isFinite(refDistance) ? refDistance : 1);
  const maxD = Math.max(refD, Number.isFinite(maxDistance) ? maxDistance : 15);
  const roll = Math.max(0, Number.isFinite(rolloff) ? rolloff : 1);
  const clampedDist = Math.max(refD, Math.min(maxD, dist));
  const gain = clampNum(refD / (refD + roll * (clampedDist - refD)), 0, 1, 1);

  const qLen =
    Math.hypot(
      listenerQuat[0],
      listenerQuat[1],
      listenerQuat[2],
      listenerQuat[3],
    ) || 1;
  const qx = listenerQuat[0] / qLen;
  const qy = listenerQuat[1] / qLen;
  const qz = listenerQuat[2] / qLen;
  const qw = listenerQuat[3] / qLen;

  // Listener local +X (right ear) axis in world space
  const rx = 1 - 2 * (qy * qy + qz * qz);
  const ry = 2 * (qx * qy + qz * qw);
  const rz = 2 * (qx * qz - qy * qw);

  const pan =
    dist > 1e-6 ? clampNum((dx * rx + dy * ry + dz * rz) / dist, -1, 1, 0) : 0;
  const angle = (pan + 1) * (Math.PI / 4);
  return {
    gain,
    pan,
    leftGain: gain * Math.cos(angle),
    rightGain: gain * Math.sin(angle),
  };
}

const DEFAULT_PEER_COLOR = '#38bdf8';

/** Pluggable bidirectional room transport (`BroadcastChannel`, `WebSocket`, or test hub). */
export interface SharedRoomTransport {
  send(rawJson: string): void;
  close(): void;
  onMessage?: (rawJson: string) => void;
  onClose?: () => void;
}

/** Parsed target classification for the `<xr-live shared-room="...">` attribute. */
export type RoomTarget =
  | {readonly kind: 'disabled'}
  | {
      readonly kind: 'broadcast';
      readonly channelName: string;
      readonly roomId: string;
    }
  | {readonly kind: 'websocket'; readonly url: string}
  | {readonly kind: 'rejected'; readonly reason: string};

/** Validates a WebSocket room URL (`wss://` or loopback `ws://` only). */
export function isAllowedRoomUrl(raw: string): boolean {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return false;
  try {
    const url = new URL(raw.trim());
    if (url.protocol === 'wss:') return true;
    return (
      url.protocol === 'ws:' &&
      (url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '[::1]')
    );
  } catch {
    return false;
  }
}

/** Parses a `shared-room` attribute value into a validated {@link RoomTarget}. */
export function parseRoomTarget(raw: unknown): RoomTarget {
  if (typeof raw !== 'string') return {kind: 'disabled'};
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (!trimmed || lower === 'false' || lower === 'none') {
    return {kind: 'disabled'};
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    if (isAllowedRoomUrl(trimmed)) {
      return {kind: 'websocket', url: trimmed};
    }
    return {
      kind: 'rejected',
      reason: 'Only wss:// or loopback ws:// room URLs are permitted',
    };
  }
  const cleanId = safeAnchorId(trimmed);
  if (!cleanId) {
    return {kind: 'rejected', reason: 'Invalid shared-room identifier'};
  }
  return {
    kind: 'broadcast',
    roomId: cleanId,
    channelName: `xr-live:room:${cleanId}`,
  };
}

/** Sanitizes an untrusted peer display name (plain text only, max 32 chars). */
export function sanitizePeerName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Peer';
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim()
    .slice(0, MAX_PEER_NAME_CHARS);
  return cleaned || 'Peer';
}

/** Sanitizes a `#rrggbb` / `#rgb` peer accent color. */
export function sanitizePeerColor(raw: unknown): string {
  return safeHexColor(raw, DEFAULT_PEER_COLOR);
}

function nowMs(): number {
  return typeof performance !== 'undefined' &&
    typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Converts a validated `#rrggbb` color string into `[r, g, b, alpha]` floats. */
export function hexColorToRgba(
  hex: string,
  alpha = 1,
): [number, number, number, number] {
  let clean = sanitizePeerColor(hex).slice(1);
  if (clean.length === 3) {
    clean = clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2];
  }
  const r = Number('0x' + clean.slice(0, 2)) / 255;
  const g = Number('0x' + clean.slice(2, 4)) / 255;
  const b = Number('0x' + clean.slice(4, 6)) / 255;
  return [
    Number.isFinite(r) ? r : 0.22,
    Number.isFinite(g) ? g : 0.74,
    Number.isFinite(b) ? b : 0.97,
    clampNum(alpha, 0, 1, 1),
  ];
}

function q4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function utf8ByteLength(str: string): number {
  if (typeof TextEncoder === 'function') {
    return new TextEncoder().encode(str).byteLength;
  }
  return str.length * 3;
}

function generatePeerId(): string {
  const g = globalThis as {
    crypto?: {getRandomValues?: (a: Uint8Array) => Uint8Array};
  };
  if (typeof g.crypto?.getRandomValues === 'function') {
    const bytes = g.crypto.getRandomValues(new Uint8Array(6));
    let hex = 'peer-';
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  return `peer-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Optimistic soft-lock ownership record for a synchronized scene node. */
export interface NodeSoftLock {
  readonly ownerPeerId: string;
  readonly leaseUntilMs: number;
  /** When the current owner first acquired the lease (renewals keep it). */
  readonly acquiredMs?: number;
}

/**
 * Window in which two peers' `grab` messages for the same node count as
 * simultaneous; the lexicographically lower `peerId` wins on every peer.
 */
export const GRAB_CONFLICT_WINDOW_MS = 500;

/**
 * Deterministic tie-break for near-simultaneous grabs: returns `true` when a
 * `grab` from `senderPeerId` should take the node from the current owner.
 * Every peer evaluates the same rule, so all converge on one owner.
 */
export function winsGrabConflict(
  existing: NodeSoftLock | undefined,
  senderPeerId: string,
  grabState: 'grab' | 'move' | 'release',
  atMs: number,
): boolean {
  if (!existing || grabState !== 'grab') return false;
  if (existing.ownerPeerId === senderPeerId || atMs >= existing.leaseUntilMs)
    return false;
  const acquired =
    existing.acquiredMs ?? existing.leaseUntilMs - SOFT_LOCK_TTL_MS;
  return (
    atMs - acquired <= GRAB_CONFLICT_WINDOW_MS &&
    senderPeerId < existing.ownerPeerId
  );
}

/** Returns whether `candidatePeerId` may acquire or renew a soft-lock at `atMs`. */
export function canAcquireNodeLease(
  existing: NodeSoftLock | undefined,
  candidatePeerId: string,
  atMs: number,
): boolean {
  if (!existing) return true;
  if (existing.ownerPeerId === candidatePeerId) return true;
  return atMs >= existing.leaseUntilMs;
}

/** Returns whether a mesh's transform should be synchronized across peers. */
// tslint:disable-next-line:no-any Heterogeneous GPU mesh record.
export function shouldSyncMesh(mesh: any): boolean {
  if (!mesh || mesh.isPluginMesh) return false;
  const traits = getMeshXRTraits(mesh);
  if (typeof traits?.sync === 'boolean') return traits.sync;
  const rawSync = mesh.userData?.xr?.sync ?? mesh.extras?.xr?.sync;
  if (typeof rawSync === 'boolean') return rawSync;
  return Boolean(traits?.grabbable || traits?.grab || traits?.handles);
}

/**
 * Assigns every non-plugin scene mesh a deterministic, unique sync key (the
 * persistence key, suffixed `#2`, `#3`, ... on duplicates). Peers loading the
 * same model derive identical keys, so same-named meshes no longer collide.
 */
// tslint:disable-next-line:no-any Heterogeneous GPU mesh records.
export function buildNodeKeyMaps(meshes: readonly any[] | undefined): {
  // tslint:disable-next-line:no-any Heterogeneous GPU mesh records.
  keyOf: Map<any, string>;
  // tslint:disable-next-line:no-any Heterogeneous GPU mesh records.
  meshOf: Map<string, any>;
} {
  // tslint:disable-next-line:no-any Heterogeneous GPU mesh records.
  const keyOf = new Map<any, string>();
  // tslint:disable-next-line:no-any Heterogeneous GPU mesh records.
  const meshOf = new Map<string, any>();
  // Deduplicate in glTF node order (matching Android / iOS `syncNodeKey`),
  // not draw order, so suffixes agree across platforms.
  const ordered = (meshes ?? [])
    .filter((m) => m && !m.isPluginMesh)
    .map((m, idx) => ({
      m,
      idx,
      order: typeof m.nodeIndex === 'number' ? m.nodeIndex : 1e9 + idx,
    }))
    .sort((a, b) => a.order - b.order);
  for (const {m, idx} of ordered) {
    const base = resolvePersistableNodeKey(m, idx);
    let key = base;
    let suffix = 2;
    while (meshOf.has(key)) key = `${base}#${suffix++}`;
    keyOf.set(m, key);
    meshOf.set(key, m);
  }
  return {keyOf, meshOf};
}

/** Validated incoming wire message variants (`v: 1`). */
export type SharedRoomWireMessage =
  | {
      readonly v: 1;
      readonly type: 'pose';
      readonly peerId: string;
      readonly name: string;
      readonly color: string;
      readonly headPos: Vec3;
      readonly headQuat: Quat;
      readonly rayOrigin: Vec3 | null;
      readonly rayEnd: Vec3 | null;
      readonly hasHit: boolean;
    }
  | {
      readonly v: 1;
      readonly type: 'node';
      readonly peerId: string;
      readonly nodeId: string;
      readonly p: Vec3;
      readonly q: Quat;
      readonly s: Vec3;
      readonly grabState: 'grab' | 'move' | 'release';
    }
  | {
      readonly v: 1;
      readonly type: 'explode';
      readonly peerId: string;
      readonly factor: number;
    }
  | {
      readonly v: 1;
      readonly type: 'paint';
      readonly peerId: string;
      readonly strokeId: string;
      readonly color: string;
      readonly radius: number;
      readonly points: Vec3[];
    }
  | {
      readonly v: 1;
      readonly type: 'rtc';
      readonly peerId: string;
      readonly targetPeerId: string;
      readonly signalType: RtcSignalType;
      readonly sdp: string | null;
      readonly candidate: string | null;
      readonly sdpMid: string | null;
      readonly sdpMLineIndex: number | null;
    }
  | {
      readonly v: 1;
      readonly type: 'leave';
      readonly peerId: string;
    };

function parseBoundedVec3(raw: unknown, maxAbs = 1000): Vec3 | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const x = raw[0];
  const y = raw[1];
  const z = raw[2];
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z)
  ) {
    return null;
  }
  return [
    q4(clampNum(x, -maxAbs, maxAbs, 0)),
    q4(clampNum(y, -maxAbs, maxAbs, 0)),
    q4(clampNum(z, -maxAbs, maxAbs, 0)),
  ];
}

function parseUnitQuat(raw: unknown): Quat | null {
  if (!Array.isArray(raw) || raw.length < 4) return null;
  const x = raw[0];
  const y = raw[1];
  const z = raw[2];
  const w = raw[3];
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof z !== 'number' ||
    typeof w !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(z) ||
    !Number.isFinite(w)
  ) {
    return null;
  }
  const len = Math.hypot(x, y, z, w);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  return [q4(x / len), q4(y / len), q4(z / len), q4(w / len)];
}

/**
 * Parses and strictly validates an untrusted JSON wire payload, enforcing
 * `MAX_PAYLOAD_BYTES`, `safeAnchorId` prototype-pollution checks, and finite
 * coordinate bounds. Returns `null` on any violation.
 */
export function parseSharedRoomMessage(
  rawJson: string,
): SharedRoomWireMessage | null {
  if (
    typeof rawJson !== 'string' ||
    !rawJson ||
    rawJson.length > MAX_PAYLOAD_BYTES
  ) {
    return null;
  }
  if (utf8ByteLength(rawJson) > MAX_PAYLOAD_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const r = parsed as Record<string, unknown>;
  if (r['v'] !== 1) return null;
  const peerId = safeAnchorId(r['peerId']);
  if (!peerId) return null;
  const type = r['type'];

  if (type === 'pose') {
    const headPos = parseBoundedVec3(r['headPos']);
    const headQuat = parseUnitQuat(r['headQuat']);
    if (!headPos || !headQuat) return null;
    const rayOrigin = r['rayOrigin'] ? parseBoundedVec3(r['rayOrigin']) : null;
    const rayEnd = r['rayEnd'] ? parseBoundedVec3(r['rayEnd']) : null;
    return {
      v: 1,
      type: 'pose',
      peerId,
      name: sanitizePeerName(r['name']),
      color: sanitizePeerColor(r['color']),
      headPos,
      headQuat,
      rayOrigin: rayOrigin && rayEnd ? rayOrigin : null,
      rayEnd: rayOrigin && rayEnd ? rayEnd : null,
      hasHit: Boolean(r['hasHit'] && rayOrigin && rayEnd),
    };
  }

  if (type === 'node') {
    const nodeId = safeAnchorId(r['nodeId']);
    if (!nodeId) return null;
    const pose = sanitizePersistedPose({p: r['p'], q: r['q'], s: r['s']});
    if (!pose) return null;
    const gs = r['grabState'];
    const grabState: 'grab' | 'move' | 'release' =
      gs === 'grab' || gs === 'release' ? gs : 'move';
    return {
      v: 1,
      type: 'node',
      peerId,
      nodeId,
      p: pose.p,
      q: pose.q,
      s: pose.s,
      grabState,
    };
  }

  if (type === 'explode') {
    const f = r['factor'];
    if (typeof f !== 'number' || !Number.isFinite(f)) return null;
    return {
      v: 1,
      type: 'explode',
      peerId,
      factor: q4(clampNum(f, 0, 1, 0)),
    };
  }

  if (type === 'paint') {
    const strokeId = safeAnchorId(r['strokeId']);
    if (!strokeId || !Array.isArray(r['points'])) return null;
    const rawPts = r['points'] as unknown[];
    if (rawPts.length < 2 || rawPts.length > MAX_STROKE_CHUNK_POINTS)
      return null;
    const points: Vec3[] = [];
    for (const pt of rawPts) {
      const cleanPt = parseBoundedVec3(pt);
      if (!cleanPt) return null;
      points.push(cleanPt);
    }
    return {
      v: 1,
      type: 'paint',
      peerId,
      strokeId,
      color: sanitizePeerColor(r['color']),
      radius: clampNum(r['radius'], 0.002, 0.1, 0.01),
      points,
    };
  }

  if (type === 'rtc') {
    const targetPeerId = safeAnchorId(r['targetPeerId']);
    if (!targetPeerId || targetPeerId === peerId) return null;
    const st = r['signalType'];
    if (st !== 'offer' && st !== 'answer' && st !== 'ice') return null;
    if (st === 'offer' || st === 'answer') {
      const sdp = r['sdp'];
      if (
        typeof sdp !== 'string' ||
        !sdp ||
        sdp.length > MAX_RTC_SIGNAL_CHARS ||
        sdp.includes('\x00')
      ) {
        return null;
      }
      return {
        v: 1,
        type: 'rtc',
        peerId,
        targetPeerId,
        signalType: st,
        sdp,
        candidate: null,
        sdpMid: null,
        sdpMLineIndex: null,
      };
    }
    const cand = r['candidate'];
    if (
      typeof cand !== 'string' ||
      !cand ||
      cand.length > MAX_RTC_SIGNAL_CHARS ||
      cand.includes('\x00')
    ) {
      return null;
    }
    const rawMid = r['sdpMid'];
    const sdpMid =
      typeof rawMid === 'string' &&
      rawMid.length > 0 &&
      !rawMid.includes('\x00')
        ? rawMid.slice(0, 64)
        : null;
    const rawIdx = r['sdpMLineIndex'];
    const sdpMLineIndex =
      typeof rawIdx === 'number' &&
      Number.isInteger(rawIdx) &&
      rawIdx >= 0 &&
      rawIdx <= 64
        ? rawIdx
        : null;
    return {
      v: 1,
      type: 'rtc',
      peerId,
      targetPeerId,
      signalType: 'ice',
      sdp: null,
      candidate: cand,
      sdpMid,
      sdpMLineIndex,
    };
  }

  if (type === 'leave') {
    return {v: 1, type: 'leave', peerId};
  }

  return null;
}

/** Creates a same-origin `BroadcastChannel` transport (no-op in headless Node). */
export function createBroadcastChannelTransport(
  channelName: string,
): SharedRoomTransport {
  // tslint:disable-next-line:no-any BroadcastChannel may be absent in headless runtimes.
  const BC = (globalThis as {BroadcastChannel?: any}).BroadcastChannel;
  if (typeof BC !== 'function') {
    return {
      send() {},
      close() {},
    };
  }
  const channel = new BC(channelName);
  channel.unref?.();
  const transport: SharedRoomTransport = {
    send(rawJson: string) {
      if (utf8ByteLength(rawJson) <= MAX_PAYLOAD_BYTES) {
        try {
          channel.postMessage(rawJson);
        } catch {
          // Ignore closed channel errors.
        }
      }
    },
    close() {
      try {
        channel.close();
      } catch {
        // Ignore duplicate closes.
      }
      transport.onClose?.();
    },
  };
  channel.onmessage = (ev: {data?: unknown}) => {
    if (typeof ev?.data === 'string') {
      transport.onMessage?.(ev.data);
    }
  };
  return transport;
}

/**
 * Creates a validated `WebSocket` transport (`wss://` or loopback `ws://`)
 * with bounded send buffering and exponential backoff reconnect.
 */
export function createRoomWebSocketTransport(url: string): SharedRoomTransport {
  if (!isAllowedRoomUrl(url)) {
    throw new Error(
      'shared-room: only wss:// (or loopback ws://) endpoints are allowed',
    );
  }
  let ws: WebSocket | null = null;
  let closedByCaller = false;
  let retryAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const queue: string[] = [];

  const transport: SharedRoomTransport = {
    send(rawJson: string) {
      if (closedByCaller || utf8ByteLength(rawJson) > MAX_PAYLOAD_BYTES) return;
      if (ws && ws.readyState === 1) {
        ws.send(rawJson);
      } else if (queue.length < 32) {
        queue.push(rawJson);
      }
    },
    close() {
      closedByCaller = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      queue.length = 0;
      try {
        ws?.close();
      } catch {
        // Ignore close errors.
      }
      ws = null;
      transport.onClose?.();
    },
  };

  const connect = (): void => {
    if (closedByCaller || typeof WebSocket !== 'function') return;
    try {
      const sock = new WebSocket(url);
      ws = sock;
      sock.addEventListener('open', () => {
        retryAttempt = 0;
        for (const item of queue.splice(0)) {
          sock.send(item);
        }
      });
      sock.addEventListener('message', (ev: MessageEvent) => {
        if (
          typeof ev.data === 'string' &&
          ev.data.length <= MAX_PAYLOAD_BYTES
        ) {
          transport.onMessage?.(ev.data);
        }
      });
      sock.addEventListener('close', () => {
        if (closedByCaller) return;
        const backoffMs = Math.min(8000, 250 * Math.pow(2, retryAttempt++));
        reconnectTimer = setTimeout(connect, backoffMs);
      });
      sock.addEventListener('error', () => {
        // `close` event handles backoff retry.
      });
    } catch {
      // Ignore WebSocket constructor errors when offline.
    }
  };

  connect();
  return transport;
}

/** Builds a stylized non-uniform visor capsule box (`0.20m × 0.085m × 0.11m`) for peer heads. */
export function buildPeerVisorGeometry(): DynamicGeometry {
  const unit = buildBoxGeometry(0.5);
  const sx = 0.2;
  const sy = 0.085;
  const sz = 0.11;
  const positions = new Float32Array(unit.positions.length);
  for (let i = 0; i < unit.positions.length; i += 3) {
    positions[i] = unit.positions[i] * sx;
    positions[i + 1] = unit.positions[i + 1] * sy;
    positions[i + 2] = unit.positions[i + 2] * sz;
  }
  return {
    positions,
    normals: new Float32Array(unit.normals),
    indices: new Uint16Array(unit.indices),
  };
}

/** Builds a world-space pointer ray bar (plus optional hit cube) for a remote peer. */
export function buildPeerLaserGeometry(
  origin: Vec3,
  end: Vec3,
  hasHit: boolean,
): DynamicGeometry {
  const segLen = vLen(vSub(end, origin));
  if (segLen < 1e-4) {
    return {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint16Array(0),
    };
  }
  const bar = buildSegmentBarsGeometry([[origin, end]], 0.003);
  if (!hasHit) return bar;

  const dot = buildBoxGeometry(0.012);
  const vCountBar = bar.positions.length / 3;
  const vCountDot = dot.positions.length / 3;
  const positions = new Float32Array((vCountBar + vCountDot) * 3);
  const normals = new Float32Array((vCountBar + vCountDot) * 3);
  const indices = new Uint16Array(bar.indices.length + dot.indices.length);

  positions.set(bar.positions, 0);
  normals.set(bar.normals, 0);
  for (let i = 0; i < dot.positions.length; i += 3) {
    positions[bar.positions.length + i] = dot.positions[i] + end[0];
    positions[bar.positions.length + i + 1] = dot.positions[i + 1] + end[1];
    positions[bar.positions.length + i + 2] = dot.positions[i + 2] + end[2];
  }
  normals.set(dot.normals, bar.normals.length);
  indices.set(bar.indices, 0);
  for (let i = 0; i < dot.indices.length; i++) {
    indices[bar.indices.length + i] = dot.indices[i] + vCountBar;
  }
  return {positions, normals, indices};
}

/** Snapshot of an active remote peer in the shared room. */
export interface RemotePeerState {
  readonly peerId: string;
  name: string;
  color: string;
  headPos: Vec3;
  headQuat: Quat;
  rayOrigin: Vec3 | null;
  rayEnd: Vec3 | null;
  hasHit: boolean;
  lastSeenMs: number;
  // tslint:disable-next-line:no-any Dynamic visor mesh.
  visorMesh: any;
  // tslint:disable-next-line:no-any Dynamic laser mesh.
  laserMesh: any;
  appliedColor: string;
  voiceGain?: SpatialVoiceGain;
}

/** Per-element controller for `shared-room`. */
export class XRSharedRoomController {
  readonly peerId: string;
  private transport: SharedRoomTransport | null = null;
  private activeRoomKey = '';
  private readonly peers = new Map<string, RemotePeerState>();
  private readonly nodeLeases = new Map<string, NodeSoftLock>();
  private readonly paintRate = new Map<
    string,
    {windowStart: number; count: number}
  >();
  private readonly rtcRate = new Map<
    string,
    {windowStart: number; count: number}
  >();
  // tslint:disable-next-line:no-any Dynamic remote paint stroke meshes.
  private readonly remoteStrokes: any[] = [];
  // tslint:disable-next-line:no-any Local meshes actively grabbed in the prior step.
  private readonly heldMeshes = new Set<any>();
  private lastPoseSentMs = -Infinity;
  private lastGrabSentMs = -Infinity;
  private strokeSeq = 0;
  private localRayOrigin: Vec3 | null = null;
  private localRayEnd: Vec3 | null = null;
  private localHasHit = false;
  // tslint:disable-next-line:no-any Cached viewer reference for message callbacks.
  private lastViewer: PluginViewer | undefined;
  // tslint:disable-next-line:no-any Bound host `<xr-live>` element.
  private boundHost: any = null;
  private onHostExplode: ((ev: Event) => void) | null = null;
  private onHostPaintStroke: ((ev: Event) => void) | null = null;
  private grabGuard: ((mesh: unknown) => boolean) | null = null;

  constructor(
    peerId = generatePeerId(),
    private readonly clock: () => number = nowMs,
  ) {
    this.peerId = safeAnchorId(peerId) ?? generatePeerId();
  }

  /** Read-only snapshot of active remote peers. */
  get peerCount(): number {
    return this.peers.size;
  }

  /** Returns active remote peer metadata keyed by `peerId`. */
  getPeers(): ReadonlyArray<{
    peerId: string;
    name: string;
    color: string;
    headPos: Vec3;
    voiceGain?: SpatialVoiceGain;
  }> {
    const out: Array<{
      peerId: string;
      name: string;
      color: string;
      headPos: Vec3;
      voiceGain?: SpatialVoiceGain;
    }> = [];
    for (const p of this.peers.values()) {
      out.push({
        peerId: p.peerId,
        name: p.name,
        color: p.color,
        headPos: [...p.headPos] as Vec3,
        ...(p.voiceGain ? {voiceGain: p.voiceGain} : {}),
      });
    }
    return out;
  }

  /** Returns the current soft-lock owner for `nodeId` if unexpired at `atMs`. */
  getNodeOwner(nodeId: string, atMs = this.clock()): string | null {
    const lease = this.nodeLeases.get(nodeId);
    if (!lease || atMs >= lease.leaseUntilMs) return null;
    return lease.ownerPeerId;
  }

  /** Connects to a room target or custom transport (used for multi-peer tests). */
  connect(
    roomAttr: string,
    viewer?: PluginViewer,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
    customTransport?: SharedRoomTransport,
  ): boolean {
    this.lastViewer = viewer ?? this.lastViewer;
    this.bindHostListeners(element);

    if (customTransport) {
      this.disconnectTransport(viewer, element);
      this.activeRoomKey = `custom:${roomAttr || 'room'}`;
      this.attachTransport(customTransport, viewer, element);
      return true;
    }

    const target = parseRoomTarget(roomAttr);
    if (target.kind === 'disabled' || target.kind === 'rejected') {
      this.disconnectTransport(viewer, element);
      this.activeRoomKey = '';
      return false;
    }

    const nextKey =
      target.kind === 'websocket'
        ? `ws:${target.url}`
        : `bc:${target.channelName}`;
    if (this.transport && this.activeRoomKey === nextKey) {
      return true;
    }

    this.disconnectTransport(viewer, element);
    this.activeRoomKey = nextKey;
    const t =
      target.kind === 'websocket'
        ? createRoomWebSocketTransport(target.url)
        : createBroadcastChannelTransport(target.channelName);
    this.attachTransport(t, viewer, element);
    return true;
  }

  private attachTransport(
    t: SharedRoomTransport,
    viewer: PluginViewer | undefined,
    // tslint:disable-next-line:no-any Host element.
    element: any,
  ): void {
    this.transport = t;
    t.onMessage = (rawJson: string) => {
      this.handleRawMessage(
        rawJson,
        this.lastViewer ?? viewer,
        this.boundHost ?? element,
        this.clock(),
      );
    };
  }

  // tslint:disable-next-line:no-any Host element.
  private bindHostListeners(element: any): void {
    if (this.boundHost === element) return;
    this.unbindHostListeners();
    if (!element || typeof element.addEventListener !== 'function') return;
    this.boundHost = element;
    this.onHostExplode = (ev: Event) => {
      const detail = (ev as CustomEvent<{factor?: number; source?: string}>)
        .detail;
      if (
        !detail ||
        detail.source === 'peer' ||
        typeof detail.factor !== 'number'
      )
        return;
      this.broadcastExplode(detail.factor);
    };
    this.onHostPaintStroke = (ev: Event) => {
      const detail = (ev as CustomEvent<{index?: number}>).detail;
      if (!detail || typeof detail.index !== 'number') return;
      const paintCtrl = getSpatialPaintController(element);
      const stroke = paintCtrl.strokes[detail.index];
      if (!stroke || stroke.builder.points.length < 2) return;
      const rawPaintAttr = element?.getAttribute?.('spatial-paint');
      const paintColor =
        typeof rawPaintAttr === 'string' &&
        /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawPaintAttr.trim())
          ? sanitizePeerColor(rawPaintAttr)
          : '#ff4073';
      const invRoot = inverseRootMatrix(this.lastViewer);
      this.broadcastPaintStroke(
        `s_${++this.strokeSeq}`,
        stroke.builder.points.map((p: Vec3) => transformPoint(invRoot, p)),
        paintColor,
        stroke.builder.radius,
      );
    };
    element.addEventListener('explodechange', this.onHostExplode);
    element.addEventListener('xr-paint-stroke', this.onHostPaintStroke);
    // Refuse local grabs on nodes another peer currently holds, so two users
    // never fight over (and jitter) the same object.
    this.grabGuard = (mesh: unknown): boolean => {
      if (!this.transport) return true;
      const key = buildNodeKeyMaps(this.lastViewer?.meshes).keyOf.get(mesh);
      const owner = key ? this.getNodeOwner(key) : null;
      return !owner || owner === this.peerId;
    };
    element.traitSystem?.grabGuards?.add?.(this.grabGuard);
  }

  private unbindHostListeners(): void {
    if (this.grabGuard) {
      this.boundHost?.traitSystem?.grabGuards?.delete?.(this.grabGuard);
      this.grabGuard = null;
    }
    if (
      this.boundHost &&
      typeof this.boundHost.removeEventListener === 'function'
    ) {
      if (this.onHostExplode) {
        this.boundHost.removeEventListener('explodechange', this.onHostExplode);
      }
      if (this.onHostPaintStroke) {
        this.boundHost.removeEventListener(
          'xr-paint-stroke',
          this.onHostPaintStroke,
        );
      }
    }
    this.onHostExplode = null;
    this.onHostPaintStroke = null;
    this.boundHost = null;
  }

  /** Records the local user's active pointer ray for the next 20 Hz pose tick. */
  setLocalRay(origin: Vec3 | null, end: Vec3 | null, hasHit = false): void {
    this.localRayOrigin = origin ? ([...origin] as Vec3) : null;
    this.localRayEnd = end ? ([...end] as Vec3) : null;
    this.localHasHit = Boolean(hasHit && origin && end);
  }

  /** Broadcasts a local quantized head + pointer pose tick (rate-limited to `20 Hz`). */
  broadcastPoseTick(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
    atMs = this.clock(),
    force = false,
  ): boolean {
    if (!this.transport) return false;
    if (!force && atMs - this.lastPoseSentMs < POSE_TICK_INTERVAL_MS)
      return false;
    this.lastPoseSentMs = atMs;

    // Poses travel in scene (model) space: each device places the shared model
    // independently in AR, so world coordinates are not comparable across peers.
    const invRoot = inverseRootMatrix(viewer);
    const headWorld = resolveHeadPose(viewer);
    const headLocalMat = mat4Create();
    mat4Multiply(headLocalMat, invRoot, headWorld.matrix);
    const head = {
      position: transformPoint(invRoot, headWorld.position),
      quaternion: extractQuaternion(headLocalMat),
    };
    const rayO = this.localRayOrigin
      ? transformPoint(invRoot, this.localRayOrigin)
      : null;
    const rayE = this.localRayEnd
      ? transformPoint(invRoot, this.localRayEnd)
      : null;
    const name = sanitizePeerName(element?.getAttribute?.('peer-name'));
    const color = sanitizePeerColor(element?.getAttribute?.('peer-color'));
    const msg: SharedRoomWireMessage = {
      v: 1,
      type: 'pose',
      peerId: this.peerId,
      name,
      color,
      headPos: [
        q4(head.position[0]),
        q4(head.position[1]),
        q4(head.position[2]),
      ],
      headQuat: [
        q4(head.quaternion[0]),
        q4(head.quaternion[1]),
        q4(head.quaternion[2]),
        q4(head.quaternion[3]),
      ],
      rayOrigin: rayO ? [q4(rayO[0]), q4(rayO[1]), q4(rayO[2])] : null,
      rayEnd: rayE ? [q4(rayE[0]), q4(rayE[1]), q4(rayE[2])] : null,
      hasHit: this.localHasHit,
    };
    this.sendWire(msg);
    return true;
  }

  /**
   * Attempts to acquire/renew the local soft-lock lease for `mesh` and broadcast
   * its transform delta. Returns `false` if another peer currently holds an
   * unexpired soft-lock on the same node.
   */
  broadcastMeshDelta(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Scene mesh record.
    mesh: any,
    grabState: 'grab' | 'move' | 'release' = 'move',
    atMs = this.clock(),
  ): boolean {
    if (!this.transport || !shouldSyncMesh(mesh)) return false;
    const nodeId = buildNodeKeyMaps(viewer.meshes).keyOf.get(mesh);
    if (!nodeId) return false;
    const existing = this.nodeLeases.get(nodeId);
    if (!canAcquireNodeLease(existing, this.peerId, atMs)) {
      return false;
    }

    if (grabState === 'release') {
      this.nodeLeases.delete(nodeId);
    } else {
      this.nodeLeases.set(nodeId, {
        ownerPeerId: this.peerId,
        leaseUntilMs: atMs + SOFT_LOCK_TTL_MS,
        acquiredMs:
          existing?.ownerPeerId === this.peerId
            ? (existing.acquiredMs ?? atMs)
            : atMs,
      });
    }

    const clean = sanitizePersistedPose({
      p: extractPosition(mesh.transform),
      q: extractQuaternion(mesh.transform),
      s: extractScale(mesh.transform),
    });
    if (!clean) return false;

    this.sendWire({
      v: 1,
      type: 'node',
      peerId: this.peerId,
      nodeId,
      p: clean.p,
      q: clean.q,
      s: clean.s,
      grabState,
    });
    return true;
  }

  /** Broadcasts an `exploded-view` factor change (`[0..1]`) to peers. */
  broadcastExplode(factor: number): boolean {
    if (!this.transport || !Number.isFinite(factor)) return false;
    this.sendWire({
      v: 1,
      type: 'explode',
      peerId: this.peerId,
      factor: q4(clampNum(factor, 0, 1, 0)),
    });
    return true;
  }

  /** Broadcasts a `spatial-paint` 3D stroke chunk to peers. */
  broadcastPaintStroke(
    strokeId: string,
    points: readonly Vec3[],
    color = DEFAULT_PEER_COLOR,
    radius = 0.01,
  ): boolean {
    if (!this.transport) return false;
    const cleanId = safeAnchorId(strokeId);
    if (!cleanId || points.length < 2) return false;
    const stride =
      points.length > MAX_STROKE_CHUNK_POINTS
        ? Math.ceil(points.length / MAX_STROKE_CHUNK_POINTS)
        : 1;
    const sampled: Vec3[] = [];
    for (
      let i = 0;
      i < points.length && sampled.length < MAX_STROKE_CHUNK_POINTS;
      i += stride
    ) {
      const p = parseBoundedVec3(points[i]);
      if (p) sampled.push(p);
    }
    const lastPt = parseBoundedVec3(points[points.length - 1]);
    if (lastPt && sampled.length < MAX_STROKE_CHUNK_POINTS) {
      const prev = sampled[sampled.length - 1];
      if (!prev || vLen(vSub(lastPt, prev)) > 1e-4) sampled.push(lastPt);
    }
    if (sampled.length < 2) return false;

    this.sendWire({
      v: 1,
      type: 'paint',
      peerId: this.peerId,
      strokeId: cleanId,
      color: sanitizePeerColor(color),
      radius: clampNum(radius, 0.002, 0.1, 0.01),
      points: sampled,
    });
    return true;
  }

  /**
   * Sends a targeted WebRTC voice signaling payload (`offer`, `answer`, or `ice`)
   * over the room transport to `targetPeerId`.
   */
  broadcastRtcSignal(
    targetPeerId: string,
    signalType: RtcSignalType,
    payload: {
      sdp?: string | null;
      candidate?: string | null;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
    },
  ): boolean {
    if (!this.transport) return false;
    const cleanTarget = safeAnchorId(targetPeerId);
    if (!cleanTarget || cleanTarget === this.peerId) return false;
    if (signalType === 'offer' || signalType === 'answer') {
      const sdp = payload.sdp;
      if (
        typeof sdp !== 'string' ||
        !sdp ||
        sdp.length > MAX_RTC_SIGNAL_CHARS ||
        sdp.includes('\x00')
      ) {
        return false;
      }
      this.sendWire({
        v: 1,
        type: 'rtc',
        peerId: this.peerId,
        targetPeerId: cleanTarget,
        signalType,
        sdp,
        candidate: null,
        sdpMid: null,
        sdpMLineIndex: null,
      });
      return true;
    }
    if (signalType === 'ice') {
      const cand = payload.candidate;
      if (
        typeof cand !== 'string' ||
        !cand ||
        cand.length > MAX_RTC_SIGNAL_CHARS ||
        cand.includes('\x00')
      ) {
        return false;
      }
      const rawMid = payload.sdpMid;
      const sdpMid =
        typeof rawMid === 'string' &&
        rawMid.length > 0 &&
        !rawMid.includes('\x00')
          ? rawMid.slice(0, 64)
          : null;
      const rawIdx = payload.sdpMLineIndex;
      const sdpMLineIndex =
        typeof rawIdx === 'number' &&
        Number.isInteger(rawIdx) &&
        rawIdx >= 0 &&
        rawIdx <= 64
          ? rawIdx
          : null;
      this.sendWire({
        v: 1,
        type: 'rtc',
        peerId: this.peerId,
        targetPeerId: cleanTarget,
        signalType: 'ice',
        sdp: null,
        candidate: cand,
        sdpMid,
        sdpMLineIndex,
      });
      return true;
    }
    return false;
  }

  /** Processes an incoming JSON message, updating peer avatars, soft-locks, and scene state. */
  handleRawMessage(
    rawJson: string,
    viewer?: PluginViewer,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
    atMs = this.clock(),
  ): boolean {
    const msg = parseSharedRoomMessage(rawJson);
    if (!msg || msg.peerId === this.peerId) return false;

    if (msg.type === 'leave') {
      return this.removePeer(msg.peerId, viewer, element);
    }

    if (msg.type === 'pose') {
      let peer = this.peers.get(msg.peerId);
      let joined = false;
      if (!peer) {
        if (this.peers.size >= MAX_PEERS) return false;
        peer = {
          peerId: msg.peerId,
          name: msg.name,
          color: msg.color,
          headPos: msg.headPos,
          headQuat: msg.headQuat,
          rayOrigin: msg.rayOrigin,
          rayEnd: msg.rayEnd,
          hasHit: msg.hasHit,
          lastSeenMs: atMs,
          visorMesh: null,
          laserMesh: null,
          appliedColor: '',
        };
        this.peers.set(msg.peerId, peer);
        joined = true;
      } else {
        peer.name = msg.name;
        peer.color = msg.color;
        peer.headPos = msg.headPos;
        peer.headQuat = msg.headQuat;
        peer.rayOrigin = msg.rayOrigin;
        peer.rayEnd = msg.rayEnd;
        peer.hasHit = msg.hasHit;
        peer.lastSeenMs = atMs;
      }
      if (viewer) this.syncPeerVisuals(viewer, peer);
      if (joined) {
        emitPluginEvent(element, 'peerjoin', {
          peerId: peer.peerId,
          name: peer.name,
          color: peer.color,
        });
      }
      return true;
    }

    // Touch `lastSeenMs` for known peers on state messages too.
    const sender = this.peers.get(msg.peerId);
    if (sender) sender.lastSeenMs = atMs;

    if (msg.type === 'node') {
      const existing = this.nodeLeases.get(msg.nodeId);
      const takesOver = winsGrabConflict(
        existing,
        msg.peerId,
        msg.grabState,
        atMs,
      );
      if (!takesOver && !canAcquireNodeLease(existing, msg.peerId, atMs)) {
        return false;
      }
      const m =
        viewer && Array.isArray(viewer.meshes)
          ? buildNodeKeyMaps(viewer.meshes).meshOf.get(msg.nodeId)
          : undefined;
      if (takesOver && existing?.ownerPeerId === this.peerId && m) {
        // We lost a simultaneous grab: drop our hold without broadcasting a
        // release (which would clear the winner's lease on other peers).
        element?.traitSystem?.releaseMesh?.(m);
        this.heldMeshes.delete(m);
        emitPluginEvent(element, 'peergrabconflict', {
          peerId: msg.peerId,
          nodeId: msg.nodeId,
        });
      }
      if (msg.grabState === 'release') {
        this.nodeLeases.delete(msg.nodeId);
      } else {
        this.nodeLeases.set(msg.nodeId, {
          ownerPeerId: msg.peerId,
          leaseUntilMs: atMs + SOFT_LOCK_TTL_MS,
          acquiredMs:
            existing?.ownerPeerId === msg.peerId
              ? (existing.acquiredMs ?? atMs)
              : atMs,
        });
      }
      if (viewer && Array.isArray(viewer.meshes)) {
        if (m && shouldSyncMesh(m)) {
          setLocalTRS(m, msg.q, msg.p, msg.s);
          emitPluginEvent(element, 'peersync', {
            peerId: msg.peerId,
            nodeId: msg.nodeId,
          });
        }
      }
      return true;
    }

    if (msg.type === 'explode') {
      const targetKey = (
        element && typeof element === 'object' ? element : viewer
      ) as object | undefined;
      if (targetKey) {
        getExplodedViewController(targetKey).setExplode(
          msg.factor,
          element,
          'peer',
        );
      }
      emitPluginEvent(element, 'peersync', {
        peerId: msg.peerId,
        nodeId: '__explode__',
      });
      return true;
    }

    if (msg.type === 'paint') {
      // Each stroke allocates GPU buffers; drop floods from a single peer.
      const bucket = this.paintRate.get(msg.peerId);
      if (!bucket || atMs - bucket.windowStart >= 1000) {
        this.paintRate.set(msg.peerId, {windowStart: atMs, count: 1});
      } else if (++bucket.count > MAX_PAINT_MESSAGES_PER_SEC) {
        return false;
      }
      if (viewer) {
        const builder = new TubeStrokeBuilder({radius: msg.radius});
        for (const pt of msg.points) builder.addPoint(pt);
        const geo = builder.build();
        if (geo && geo.indices.length > 0) {
          while (this.remoteStrokes.length >= MAX_REMOTE_STROKES) {
            removeDynamicMesh(viewer, this.remoteStrokes.shift());
          }
          // Points are scene-space: draw through the root matrix so strokes
          // stay attached to the shared model.
          const mesh = createDynamicMesh(viewer, geo, {
            name: `__xr_peer_stroke_${msg.strokeId}__`,
            color: hexColorToRgba(msg.color, 1),
            roughness: 0.35,
            pickable: false,
          });
          this.remoteStrokes.push(mesh);
        }
      }
      emitPluginEvent(element, 'peersync', {
        peerId: msg.peerId,
        nodeId: `paint:${msg.strokeId}`,
      });
      return true;
    }

    if (msg.type === 'rtc') {
      if (msg.targetPeerId !== this.peerId) {
        return false;
      }
      const bucket = this.rtcRate.get(msg.peerId);
      if (!bucket || atMs - bucket.windowStart >= 1000) {
        this.rtcRate.set(msg.peerId, {windowStart: atMs, count: 1});
      } else if (++bucket.count > MAX_RTC_MESSAGES_PER_SEC) {
        return false;
      }
      emitPluginEvent(element, 'peerrtcsignal', {
        peerId: msg.peerId,
        targetPeerId: msg.targetPeerId,
        signalType: msg.signalType,
        sdp: msg.sdp,
        candidate: msg.candidate,
        sdpMid: msg.sdpMid,
        sdpMLineIndex: msg.sdpMLineIndex,
      });
      return true;
    }

    return false;
  }

  /** Steps room connection sync, 20 Hz pose ticks, and stale peer timeout pruning. */
  step(
    viewer: PluginViewer,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
    atMs = this.clock(),
  ): void {
    this.lastViewer = viewer;
    const attr = element?.getAttribute?.('shared-room');
    if (typeof attr === 'string' && attr.trim()) {
      this.connect(attr, viewer, element);
    } else if (
      attr !== undefined &&
      !this.activeRoomKey.startsWith('custom:')
    ) {
      if (this.transport) this.disconnectTransport(viewer, element);
    }

    if (!this.transport) return;

    // Sync local `traitSystem` grab lifecycle (`grab` -> 20 Hz `move` -> `release`).
    // tslint:disable-next-line:no-any Heterogeneous scene meshes.
    const grabbedList: any[] =
      typeof element?.traitSystem?.getGrabbedMeshes === 'function'
        ? element.traitSystem.getGrabbedMeshes()
        : [];
    // tslint:disable-next-line:no-any Heterogeneous scene meshes.
    const currentGrabbed = new Set<any>(grabbedList);
    const dueMove = atMs - this.lastGrabSentMs >= POSE_TICK_INTERVAL_MS;
    let sentMove = false;
    for (const m of currentGrabbed) {
      if (!this.heldMeshes.has(m)) {
        this.broadcastMeshDelta(viewer, m, 'grab', atMs);
      } else if (dueMove) {
        this.broadcastMeshDelta(viewer, m, 'move', atMs);
        sentMove = true;
      }
    }
    if (sentMove) this.lastGrabSentMs = atMs;
    for (const prev of Array.from(this.heldMeshes)) {
      if (!currentGrabbed.has(prev)) {
        this.broadcastMeshDelta(viewer, prev, 'release', atMs);
      }
    }
    this.heldMeshes.clear();
    for (const m of currentGrabbed) this.heldMeshes.add(m);

    this.broadcastPoseTick(viewer, element, atMs);
    this.pruneStalePeers(viewer, element, atMs);

    for (const peer of this.peers.values()) {
      this.syncPeerVisuals(viewer, peer);
    }
  }

  /** Prunes remote peers silent for longer than `PEER_TIMEOUT_MS` (`5000ms`). */
  pruneStalePeers(
    viewer: PluginViewer | undefined,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
    atMs = this.clock(),
  ): number {
    let removed = 0;
    for (const [id, peer] of Array.from(this.peers.entries())) {
      if (atMs - peer.lastSeenMs > PEER_TIMEOUT_MS) {
        if (this.removePeer(id, viewer, element)) removed++;
      }
    }
    return removed;
  }

  private removePeer(
    peerId: string,
    viewer: PluginViewer | undefined,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
  ): boolean {
    const peer = this.peers.get(peerId);
    if (!peer) return false;
    this.peers.delete(peerId);
    this.paintRate.delete(peerId);
    this.rtcRate.delete(peerId);
    removeDynamicMesh(viewer, peer.visorMesh);
    removeDynamicMesh(viewer, peer.laserMesh);
    for (const [nodeId, lease] of Array.from(this.nodeLeases.entries())) {
      if (lease.ownerPeerId === peerId) this.nodeLeases.delete(nodeId);
    }
    emitPluginEvent(element, 'peerleave', {
      peerId: peer.peerId,
      name: peer.name,
      color: peer.color,
    });
    return true;
  }

  private syncPeerVisuals(viewer: PluginViewer, peer: RemotePeerState): void {
    const colorChanged = peer.appliedColor !== peer.color;
    const visorColor = hexColorToRgba(peer.color, 0.92);
    if (!peer.visorMesh || colorChanged) {
      removeDynamicMesh(viewer, peer.visorMesh);
      peer.visorMesh = createDynamicMesh(viewer, buildPeerVisorGeometry(), {
        name: `__xr_peer_visor_${peer.peerId}__`,
        color: visorColor,
        roughness: 0.25,
        metallic: 0.4,
        pickable: false,
        worldSpace: true,
      });
      peer.appliedColor = peer.color;
    } else {
      reattachDynamicMesh(viewer, peer.visorMesh);
    }
    peer.visorMesh.visible = true;
    const root = rootMatrix(viewer);
    const headLocal = mat4Create();
    mat4FromRotationTranslationScale(
      headLocal,
      peer.headQuat,
      peer.headPos,
      [1, 1, 1],
    );
    const headWorld = mat4Create();
    mat4Multiply(headWorld, root, headLocal);
    const headWorldPos = extractPosition(headWorld);
    setWorldTRS(
      viewer,
      peer.visorMesh,
      extractQuaternion(headWorld),
      headWorldPos,
      [1, 1, 1],
    );
    const listenerHead = resolveHeadPose(viewer);
    peer.voiceGain = computeSpatialVoiceGain(
      listenerHead.position,
      extractQuaternion(listenerHead.matrix),
      headWorldPos,
    );

    if (colorChanged && peer.laserMesh) {
      removeDynamicMesh(viewer, peer.laserMesh);
      peer.laserMesh = null;
    }

    if (peer.rayOrigin && peer.rayEnd) {
      const laserGeo = buildPeerLaserGeometry(
        transformPoint(root, peer.rayOrigin),
        transformPoint(root, peer.rayEnd),
        peer.hasHit,
      );
      const laserColor = hexColorToRgba(peer.color, 0.78);
      if (!peer.laserMesh) {
        peer.laserMesh = createDynamicMesh(viewer, laserGeo, {
          name: `__xr_peer_laser_${peer.peerId}__`,
          color: laserColor,
          roughness: 0.2,
          pickable: false,
          worldSpace: true,
        });
      } else {
        reattachDynamicMesh(viewer, peer.laserMesh);
        updateDynamicMesh(viewer, peer.laserMesh, laserGeo);
        applyWorldMatrix(viewer, peer.laserMesh);
      }
      peer.laserMesh.visible = laserGeo.indices.length > 0;
    } else if (peer.laserMesh) {
      peer.laserMesh.visible = false;
    }
  }

  private sendWire(msg: SharedRoomWireMessage): void {
    if (!this.transport) return;
    const raw = JSON.stringify(msg);
    if (utf8ByteLength(raw) <= MAX_PAYLOAD_BYTES) {
      this.transport.send(raw);
    }
  }

  private disconnectTransport(
    viewer: PluginViewer | undefined,
    // tslint:disable-next-line:no-any Host `<xr-live>` element.
    element?: any,
  ): void {
    if (this.transport) {
      this.sendWire({v: 1, type: 'leave', peerId: this.peerId});
      const t = this.transport;
      this.transport = null;
      t.onMessage = undefined;
      t.close();
    }
    for (const id of Array.from(this.peers.keys())) {
      this.removePeer(id, viewer, element);
    }
    this.nodeLeases.clear();
    this.heldMeshes.clear();
  }

  /** Disconnects from the room and frees all dynamic peer and stroke GPU meshes. */
  dispose(viewer?: PluginViewer): void {
    const v = viewer ?? this.lastViewer;
    this.disconnectTransport(v, this.boundHost);
    this.unbindHostListeners();
    for (const s of this.remoteStrokes.splice(0)) {
      removeDynamicMesh(v, s);
    }
    this.activeRoomKey = '';
    this.localRayOrigin = null;
    this.localRayEnd = null;
    this.localHasHit = false;
  }
}

const controllers = new WeakMap<object, XRSharedRoomController>();
const listeners = new WeakMap<object, Array<[string, EventListener]>>();

/** Returns (creating on first use) the `shared-room` controller for `key`. */
export function getSharedRoomController(key: object): XRSharedRoomController {
  let c = controllers.get(key);
  if (!c) {
    c = new XRSharedRoomController();
    controllers.set(key, c);
  }
  return c;
}

/** `<xr-live>` plugin providing multi-user co-presence and state synchronization. */
export const sharedRoomPlugin: ThreeLivePlugin = {
  name: 'xr-live-shared-room',

  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementConnected(element: any): void {
    if (!element) return;
    const ctrl = getSharedRoomController(element);
    const viewerOf = (): PluginViewer | undefined =>
      element._view ?? element.viewer;
    element.getSharedPeers = () => ctrl.getPeers();

    const initialRoom = element.getAttribute?.('shared-room');
    if (typeof initialRoom === 'string' && initialRoom.trim()) {
      ctrl.connect(initialRoom, viewerOf(), element);
    }

    if (
      typeof element.addEventListener !== 'function' ||
      listeners.has(element)
    )
      return;

    const onSelectRay = (e: Event): void => {
      // tslint:disable-next-line:no-any Custom XR select detail.
      const d = (e as CustomEvent<any>).detail;
      const origin = d?.rayOrigin as Vec3 | undefined;
      const hitPt = d?.hit?.point as Vec3 | undefined;
      const rayDir = d?.rayDirection as Vec3 | undefined;
      if (origin && (hitPt || rayDir)) {
        const end: Vec3 = hitPt ?? [
          origin[0] + (rayDir?.[0] ?? 0) * 2.5,
          origin[1] + (rayDir?.[1] ?? 0) * 2.5,
          origin[2] + (rayDir?.[2] ?? -1) * 2.5,
        ];
        ctrl.setLocalRay(origin, end, Boolean(hitPt));
      }
    };
    const onSelectEnd = (): void => {
      ctrl.setLocalRay(null, null, false);
    };
    const onNodeSettled = (e: Event): void => {
      const v = viewerOf();
      // tslint:disable-next-line:no-any Custom snap/handles event detail.
      const d = (e as CustomEvent<any>).detail;
      const mesh = d?.node ?? d?.mesh;
      if (v && mesh) ctrl.broadcastMeshDelta(v, mesh, 'release');
    };

    const bound: Array<[string, EventListener]> = [
      ['xr-select-start', onSelectRay],
      ['xr-select-move', onSelectRay],
      ['xr-select-end', onSelectEnd],
      ['xrsnap', onNodeSettled],
      ['xr-handles-change', onNodeSettled],
    ];
    for (const [name, fn] of bound) element.addEventListener(name, fn);
    listeners.set(element, bound);
  },

  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onAttributeChanged(
    element: any,
    name: string,
    _oldVal: string | null,
    newVal: string | null,
  ): void {
    if (!element) return;
    const ctrl = getSharedRoomController(element);
    const viewer: PluginViewer | undefined = element._view ?? element.viewer;
    if (name === 'shared-room') {
      if (newVal && newVal.trim()) {
        ctrl.connect(newVal, viewer, element);
      } else {
        ctrl.dispose(viewer);
      }
    } else if ((name === 'peer-name' || name === 'peer-color') && viewer) {
      ctrl.broadcastPoseTick(viewer, element, undefined, true);
    }
  },

  // tslint:disable-next-line:no-any Host element is `<xr-live>`.
  onElementDisconnected(element: any): void {
    for (const [name, fn] of listeners.get(element) ?? []) {
      element.removeEventListener?.(name, fn);
    }
    listeners.delete(element);
    controllers.get(element)?.dispose(element?._view ?? element?.viewer);
  },

  onXRFrame(
    viewer: unknown,
    _session: unknown,
    frame: unknown,
    refSpace: unknown,
  ): void {
    const v = viewer as PluginViewer;
    cacheXRFrame(v, frame, refSpace);
    const host = v?.container;
    getSharedRoomController(host ?? v).step(v, host);
  },

  onUpdate(viewer: PluginViewer): void {
    if (isXRFrameFresh(viewer)) return;
    const host = viewer?.container;
    getSharedRoomController(host ?? viewer).step(viewer, host);
  },

  onDestroy(_gl: WebGL2RenderingContext, viewer: PluginViewer): void {
    const host = viewer?.container;
    const ctrl = controllers.get(host ?? viewer);
    if (ctrl) {
      ctrl.dispose(viewer);
      controllers.delete(host ?? viewer);
    }
  },
};
