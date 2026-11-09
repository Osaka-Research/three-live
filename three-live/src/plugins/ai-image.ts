/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Runtime Image -> Scene (`compileFromImage`, roadmap item B4).
 *
 * Shared prompt construction, metric spatial-prior formatting (`AISpatialPriors`),
 * and repair message builders for converting a reference photo, sketch, or AR
 * camera frame into a validated `<script type="text/three">` scene.
 *
 * All constants and formatting rules are mirrored in `compiler/src/ai_image.rs`
 * and verified against `three-live/tests/fixtures/image_cases.json`.
 */

import {
  type AIChatContentPart,
  type AIChatMessage,
  type AIEditableElement,
  currentSource,
  dryRunCompile,
  type EditSceneResult,
  extractScript,
  MAX_HISTORY,
  MAX_SCRIPT_BYTES,
  resolveProvider,
  sceneSummary,
  type ThreeLiveAIProvider,
} from './ai';
import {setSelection} from './ai-select';

/** One tracked plane in world meters (+Y up). */
export interface AISpatialPlane {
  /** Optional semantic tag ('floor', 'table', 'wall', 'ceiling', 'seat', 'door', 'window'). */
  readonly label?: string;
  readonly orientation: 'horizontal' | 'vertical';
  /** Plane center [x, y, z] in world meters (+Y up). */
  readonly center: readonly [number, number, number];
  /** Optional plane [width, depthOrHeight] in meters. */
  readonly extent?: readonly [number, number];
  /** Optional unit normal [nx, ny, nz]. */
  readonly normal?: readonly [number, number, number];
}

/** One detected 3D object bounding box in world meters (+Y up). */
export interface AISpatialObject {
  /** Semantic class ('table', 'chair', 'sofa', 'mug', 'laptop', 'lamp', 'storage', ...). */
  readonly label: string;
  /** Object 3D bounding-box center [x, y, z] in world meters (+Y up). */
  readonly center: readonly [number, number, number];
  /** Optional 3D bounding-box [width, height, depth] in meters. */
  readonly size?: readonly [number, number, number];
  /** Optional rotation around +Y in degrees. */
  readonly yawDeg?: number;
}

/** Camera pose when the reference image was captured (world meters, +Y up). */
export interface AISpatialCamera {
  readonly eye: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDeg?: number;
}

/** Metric spatial priors from ARCore, ARKit, RoomPlan, or WorldUnderstanding. */
export interface AISpatialPriors {
  /** Metric floor height in meters (defaults to 0). */
  readonly floorY?: number;
  /** Camera pose when the image was captured (world meters). */
  readonly camera?: AISpatialCamera;
  /** Up to 32 tracked planes. */
  readonly planes?: readonly AISpatialPlane[];
  /** Up to 32 detected 3D objects. */
  readonly objects?: readonly AISpatialObject[];
}

/** Maximum planes formatted into a prompt. */
export const MAX_PRIOR_PLANES = 32;
/** Maximum 3D objects formatted into a prompt. */
export const MAX_PRIOR_OBJECTS = 32;
/** Maximum characters in a plane or object label. */
export const MAX_PRIOR_LABEL_CHARS = 80;
/** Maximum characters in a user prompt instruction. */
export const MAX_IMAGE_PROMPT_CHARS = 2000;
/** Maximum raw image byte size (32 MB). */
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
/** Default longest-edge downscale target in pixels. */
export const DEFAULT_IMAGE_MAX_EDGE = 1024;
/** Minimum allowed `maxEdge` in pixels. */
export const MIN_IMAGE_MAX_EDGE = 256;
/** Maximum allowed `maxEdge` in pixels. */
export const MAX_IMAGE_MAX_EDGE = 2048;

/** Supported image sources for {@link compileFromImage} and {@link normalizeImageInput}. */
export type AIImageInput =
  | string
  | Blob
  | HTMLImageElement
  | HTMLVideoElement
  | HTMLCanvasElement
  | ImageBitmap
  | ArrayBuffer
  | ArrayBufferView;

/** Options for {@link compileFromImage}. */
export interface CompileFromImageOptions {
  /** Provider override (defaults to `el.aiProvider`, then `ai-*` attributes). */
  readonly provider?: ThreeLiveAIProvider;
  /** Optional text guidance (e.g. `'reconstruct this desk and make the lamp brass'`). */
  readonly prompt?: string;
  /** Optional metric spatial priors from AR / WorldUnderstanding / RoomPlan. */
  readonly priors?: AISpatialPriors | null;
  /** Downscale longest image edge to at most `maxEdge` px before encoding (256..2048, default 1024). */
  readonly maxEdge?: number;
  /** Automatic repair turns on compile error or linter warning (0..3, default 1). */
  readonly maxRepairs?: number;
  /** Validate only; do not hot-swap the live scene. */
  readonly dryRun?: boolean;
  /** Aborts the request (a newer `compileFromImage` or `editScene` call also aborts older ones). */
  readonly signal?: AbortSignal;
  /** Optional `fetch` implementation used when normalizing remote or relative image URLs. */
  readonly fetch?: typeof fetch;
}

/**
 * System prompt for reconstructing a 3D scene from a reference image.
 * Kept in sync with `IMAGE_SYSTEM_PROMPT` in `compiler/src/ai_image.rs`.
 */
export const IMAGE_SYSTEM_PROMPT = [
  'You reconstruct a 3D scene from a reference image into a Three.js script for Three-Live, which compiles it to glTF for Web, Android, and iOS.',
  'Reply with the COMPLETE script in a single ```js code block and nothing else.',
  'Rules:',
  '- Use the pre-defined globals `THREE`, `scene`, and `camera`. No imports, renderer, loaders, DOM, network, or timers.',
  '- Decompose visible objects into `THREE.Group` and `THREE.Mesh` hierarchies with a unique, descriptive `.name` on every Mesh and Group (for example `Table`, `Chair_Left`, `Desk_Lamp`) before attaching `userData.xr` or `userData.interactivity`.',
  '- Use real-world meters (1 unit = 1 m), +Y up, with the floor or resting surface at y = 0 (or the given metric floorY).',
  '- When metric spatial priors (floor height, camera pose, planes, or 3D object boxes) are provided, place meshes at those exact metric [x, y, z] coordinates, dimensions, and yaw angles, and set `mesh.userData.xr = { grab: true }` on movable props.',
  '- Supported: core geometries (`BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `CapsuleGeometry`, `PlaneGeometry`, `TorusGeometry`, `LatheGeometry`, `ExtrudeGeometry`, `TubeGeometry`, `Shape`, `Path`), `THREE.CSG`, `MeshStandardMaterial` / `MeshPhysicalMaterial`, `THREE.CanvasTexture`, `THREE.ProceduralTexture` presets (`wood`, `marble`, `brick`, `concrete`, `brushedMetal`, `rust`, `leather`, `fabric`, `carbonFiber`, `checkerboard`, `grid`), lights (`AmbientLight`, `HemisphereLight`, `DirectionalLight`, `PointLight`, `SpotLight`), and canonical `node.userData.xr` traits (`grab`, `anchor`, `physics`, `joint`, `handles`, `dimensions`, `billboard`, `orbit`, `follow`).',
  '- Always include balanced lighting (`AmbientLight` or `HemisphereLight` plus a `DirectionalLight` or `PointLight`) and frame `camera.position.set(x, y, z)` and `camera.lookAt(tx, ty, tz)` so 100% of meshes are inside the camera frustum.',
].join('\n');

function cleanLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let out = '';
  let prevSpace = true;
  for (const ch of raw) {
    const code = ch.charCodeAt(0);
    const isCtrlOrSpace =
      code <= 0x20 || code === 0x7f || ch === '"' || /\s/.test(ch);
    if (isCtrlOrSpace) {
      if (!prevSpace) {
        out += ' ';
        prevSpace = true;
      }
    } else {
      out += ch;
      prevSpace = false;
    }
  }
  return Array.from(out.trim()).slice(0, MAX_PRIOR_LABEL_CHARS).join('');
}

function fmtMeters(v: number): string {
  const rounded = Math.round(v * 100) / 100;
  const zeroNormalized = Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? 0 : rounded;
  return zeroNormalized.toFixed(2);
}

function fmtDeg(v: number): string {
  const rounded = Math.round(v);
  const zeroNormalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(zeroNormalized);
}

function asVec3(raw: unknown): [number, number, number] | null {
  if (!Array.isArray(raw) || raw.length < 3) return null;
  const x = Number(raw[0]);
  const y = Number(raw[1]);
  const z = Number(raw[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return [x, y, z];
}

function asPosVec2(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const w = Number(raw[0]);
  const h = Number(raw[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return [w, h];
}

function asPosVec3(raw: unknown): [number, number, number] | null {
  const v = asVec3(raw);
  if (!v || v[0] <= 0 || v[1] <= 0 || v[2] <= 0) return null;
  return v;
}

function fmtVec3(v: readonly [number, number, number]): string {
  return `[${fmtMeters(v[0])}, ${fmtMeters(v[1])}, ${fmtMeters(v[2])}]`;
}

/**
 * Formats `AISpatialPriors` into a deterministic, sanitized prompt block.
 * Returns `""` when no valid priors are present.
 */
export function formatSpatialPriors(
  priors: AISpatialPriors | null | undefined,
): string {
  if (!priors || typeof priors !== 'object') return '';
  const body: string[] = [];

  if (typeof priors.floorY === 'number' && Number.isFinite(priors.floorY)) {
    body.push(`- Floor height: y = ${fmtMeters(priors.floorY)} m`);
  }

  if (priors.camera && typeof priors.camera === 'object') {
    const eye = asVec3(priors.camera.eye);
    const target = asVec3(priors.camera.target);
    if (eye && target) {
      let camLine = `- Camera: eye ${fmtVec3(eye)}, target ${fmtVec3(target)}`;
      const fov = Number(priors.camera.fovDeg);
      if (Number.isFinite(fov) && fov >= 1 && fov <= 179) {
        camLine += `, fov ${fmtDeg(fov)} deg`;
      }
      body.push(camLine);
    }
  }

  if (Array.isArray(priors.planes)) {
    const planeLines: string[] = [];
    for (const p of priors.planes) {
      if (planeLines.length >= MAX_PRIOR_PLANES) break;
      if (!p || typeof p !== 'object') continue;
      const center = asVec3(p.center);
      if (!center) continue;
      const orient =
        String(p.orientation ?? '').toLowerCase() === 'vertical'
          ? 'vertical'
          : 'horizontal';
      const label = cleanLabel(p.label);
      const extent = asPosVec2(p.extent);
      const normal = asVec3(p.normal);
      let line = `  ${planeLines.length + 1}. ${orient}`;
      if (label) line += ` "${label}"`;
      line += ` at ${fmtVec3(center)}`;
      if (extent) {
        line += `, extent ${fmtMeters(extent[0])}m x ${fmtMeters(extent[1])}m`;
      }
      if (normal) {
        line += `, normal ${fmtVec3(normal)}`;
      }
      planeLines.push(line);
    }
    if (planeLines.length > 0) {
      body.push('- Planes:', ...planeLines);
    }
  }

  if (Array.isArray(priors.objects)) {
    const objLines: string[] = [];
    for (const o of priors.objects) {
      if (objLines.length >= MAX_PRIOR_OBJECTS) break;
      if (!o || typeof o !== 'object') continue;
      const label = cleanLabel(o.label);
      const center = asVec3(o.center);
      if (!label || !center) continue;
      const size = asPosVec3(o.size);
      const yaw =
        typeof o.yawDeg === 'number' && Number.isFinite(o.yawDeg)
          ? o.yawDeg
          : null;
      let line = `  ${objLines.length + 1}. "${label}" at ${fmtVec3(center)}`;
      if (size) {
        line += `, size ${fmtMeters(size[0])}m x ${fmtMeters(size[1])}m x ${fmtMeters(size[2])}m`;
      }
      if (yaw !== null) {
        line += `, yaw ${fmtDeg(yaw)} deg`;
      }
      objLines.push(line);
    }
    if (objLines.length > 0) {
      body.push(
        '- Detected 3D objects (place meshes at these metric bounds):',
        ...objLines,
      );
    }
  }

  if (body.length === 0) return '';
  return `Metric spatial priors (world meters, +Y up):\n${body.join('\n')}\n`;
}

/** Checks whether `url` is a permitted `data:image/...;base64,...` or `https:` / loopback `http:` URL. */
export function isAllowedImageUrl(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=\s]+$/i.test(s)) {
    const commaIdx = s.indexOf(',');
    return commaIdx > 0 && s.slice(commaIdx + 1).trim().length > 0;
  }
  if (/[\s\x00-\x1f\x7f]/.test(s)) return false;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:') return Boolean(u.hostname);
    return (
      u.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
    );
  } catch {
    return false;
  }
}

/** Builds the user text prompt for `buildImageMessages`. */
export function buildImageUserText(
  prompt?: string | null,
  priors?: AISpatialPriors | null,
): string {
  let out =
    'Reconstruct the 3D scene shown in this reference image as a complete Three-Live script.\n';
  out += formatSpatialPriors(priors);
  const cleanPrompt = Array.from(String(prompt ?? '').trim())
    .slice(0, MAX_IMAGE_PROMPT_CHARS)
    .join('');
  if (cleanPrompt) {
    out += `Additional instructions: ${cleanPrompt}\n`;
  }
  out += 'Return only the complete script in a single ```js code block.';
  return out;
}

/**
 * Builds the multimodal Chat Completions messages for converting `imageUrl` into
 * a `<script type="text/three">` scene.
 */
export function buildImageMessages(
  imageUrl: string,
  prompt?: string | null,
  priors?: AISpatialPriors | null,
): AIChatMessage[] {
  const url = String(imageUrl ?? '').trim();
  if (!isAllowedImageUrl(url)) {
    throw new Error(
      'compileFromImage: imageUrl must be a base64 data:image/(png|jpeg|webp) URI or an https:// URL.',
    );
  }
  const text = buildImageUserText(prompt, priors);
  const content: AIChatContentPart[] = [
    {type: 'image_url', image_url: {url}},
    {type: 'text', text},
  ];
  return [
    {role: 'system', content: IMAGE_SYSTEM_PROMPT},
    {role: 'user', content},
  ];
}

/**
 * Builds the follow-up repair message when a candidate script fails compilation
 * or produces repairable compiler/spatial warnings.
 */
export function imageRepairMessage(
  error?: string | null,
  warnings?: readonly string[] | null,
): string {
  const errText = String(error ?? '').trim();
  const warnList = (warnings ?? [])
    .map((w) => String(w ?? '').trim())
    .filter(Boolean)
    .slice(0, 20);
  if (errText) {
    let msg = `That script was rejected by the Three-Live sandbox: ${errText}\n`;
    if (warnList.length > 0) {
      msg += `Additional diagnostics:\n${warnList.map((w) => `- ${w}`).join('\n')}\n`;
    }
    msg += 'Return the complete corrected script in a single ```js code block.';
    return msg;
  }
  if (warnList.length > 0) {
    return (
      'The script compiled, but the Three-Live linter reported warnings that should be fixed:\n' +
      `${warnList.map((w) => `- ${w}`).join('\n')}\n` +
      'Fix every warning above (assign unique `.name` values before attaching `userData.xr`, use only canonical `userData.xr` traits, replace unsupported classes with supported Three-Live primitives, and frame `camera.position` and `camera.lookAt` so all meshes are inside the frustum) while keeping the full scene intact.\n' +
      'Return the complete corrected script in a single ```js code block.'
    );
  }
  return 'Return the complete corrected script in a single ```js code block.';
}

/** Detects PNG, JPEG, or WebP magic bytes from a binary buffer. */
export function detectImageMime(
  bytes: Uint8Array,
): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  const g = globalThis as unknown as {
    Buffer?: {
      from(
        buf: ArrayBufferLike,
        offset: number,
        length: number,
      ): {toString(enc: string): string};
    };
  };
  if (g.Buffer && typeof g.Buffer.from === 'function') {
    return g.Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString('base64');
  }
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, Math.min(i + chunk, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function clampMaxEdge(raw: number | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_IMAGE_MAX_EDGE;
  return Math.max(
    MIN_IMAGE_MAX_EDGE,
    Math.min(MAX_IMAGE_MAX_EDGE, Math.round(n)),
  );
}

function encodeBytesToDataUrl(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) {
    throw new Error('compileFromImage: image buffer is empty.');
  }
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('compileFromImage: image exceeds the 32 MB limit.');
  }
  const mime = detectImageMime(bytes);
  if (!mime) {
    throw new Error(
      'compileFromImage: unsupported image format (expected PNG, JPEG, or WebP magic bytes).',
    );
  }
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function downscaleDrawableToDataUrl(
  source: unknown,
  width: number,
  height: number,
  maxEdge: number,
): string | null {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));
  const srcWithDataUrl = source as {
    toDataURL?: (type?: string, quality?: number) => string;
  };
  if (scale === 1 && typeof srcWithDataUrl.toDataURL === 'function') {
    try {
      const direct = srcWithDataUrl.toDataURL('image/jpeg', 0.88);
      if (isAllowedImageUrl(direct)) return direct;
    } catch {}
  }
  if (
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  ) {
    try {
      const canvas = document.createElement('canvas');
      if (canvas && typeof canvas.getContext === 'function') {
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx && typeof ctx.drawImage === 'function') {
          ctx.drawImage(source as CanvasImageSource, 0, 0, targetW, targetH);
          if (typeof canvas.toDataURL === 'function') {
            const out = canvas.toDataURL('image/jpeg', 0.88);
            if (isAllowedImageUrl(out)) return out;
          }
        }
      }
    } catch {}
  }
  if (typeof srcWithDataUrl.toDataURL === 'function') {
    try {
      const fallback = srcWithDataUrl.toDataURL('image/jpeg', 0.88);
      if (isAllowedImageUrl(fallback)) return fallback;
    } catch {}
  }
  return null;
}

/**
 * Normalizes any {@link AIImageInput} (`data:` URI, `https://` URL, `Blob`,
 * `HTMLImageElement`, `HTMLVideoElement`, `HTMLCanvasElement`, `ImageBitmap`,
 * `ArrayBuffer`, or `Uint8Array`) into a validated `data:image/...;base64,...`
 * or `https://` URL ready for {@link buildImageMessages}.
 */
export async function normalizeImageInput(
  input: AIImageInput,
  options: {
    readonly maxEdge?: number;
    readonly signal?: AbortSignal;
    readonly fetch?: typeof fetch;
  } = {},
): Promise<string> {
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error('compileFromImage aborted');
  }
  if (input == null) {
    throw new Error('compileFromImage: image input is required.');
  }
  const maxEdge = clampMaxEdge(options.maxEdge);

  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) {
      throw new Error('compileFromImage: image input is empty.');
    }
    if (/^data:/i.test(s)) {
      if (!isAllowedImageUrl(s)) {
        throw new Error(
          'compileFromImage: data URI must be a base64-encoded image/png, image/jpeg, or image/webp.',
        );
      }
      const commaIdx = s.indexOf(',');
      const header = s
        .slice(0, commaIdx)
        .toLowerCase()
        .replace('image/jpg', 'image/jpeg');
      const b64 = s.slice(commaIdx + 1).replace(/\s+/g, '');
      const approxBytes = Math.floor((b64.length * 3) / 4);
      if (approxBytes > MAX_IMAGE_BYTES) {
        throw new Error('compileFromImage: image exceeds the 32 MB limit.');
      }
      return `${header},${b64}`;
    }
    if (/^(javascript|vbscript|file|ftp|ws|wss):/i.test(s)) {
      throw new Error('compileFromImage: unsupported or unsafe image URL scheme.');
    }
    if (/^http:/i.test(s) && !isAllowedImageUrl(s)) {
      throw new Error(
        'compileFromImage: remote image URLs must use https:// (or http:// on localhost).',
      );
    }
    const isDirectRemote = /^https?:/i.test(s) && isAllowedImageUrl(s);
    if (isDirectRemote && !options.fetch) {
      return s;
    }
    let resolvedUrl = s;
    if (!/^https?:|^blob:/i.test(s)) {
      const base = (globalThis as {location?: {href?: string}}).location?.href;
      if (!base) {
        throw new Error(
          'compileFromImage: imageUrl must be a base64 data:image/(png|jpeg|webp) URI or an https:// URL.',
        );
      }
      resolvedUrl = new URL(s, base).href;
      if (!/^blob:/i.test(resolvedUrl) && !isAllowedImageUrl(resolvedUrl)) {
        throw new Error(
          'compileFromImage: resolved image URL must use https:// (or http:// on localhost).',
        );
      }
    }
    const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
    if (typeof doFetch !== 'function') {
      if (isDirectRemote) return s;
      throw new Error('compileFromImage: no fetch() implementation is available.');
    }
    const res = await doFetch(resolvedUrl, {
      mode: 'cors',
      credentials: 'omit',
      signal: options.signal,
    });
    if (!res.ok) {
      throw new Error(
        `compileFromImage: failed to fetch image (HTTP ${res.status}).`,
      );
    }
    const contentLen = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(contentLen) && contentLen > MAX_IMAGE_BYTES) {
      throw new Error('compileFromImage: image exceeds the 32 MB limit.');
    }
    const ab = await res.arrayBuffer();
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('compileFromImage aborted');
    }
    return encodeBytesToDataUrl(new Uint8Array(ab));
  }

  if (
    input instanceof ArrayBuffer ||
    Object.prototype.toString.call(input) === '[object ArrayBuffer]'
  ) {
    return encodeBytesToDataUrl(new Uint8Array(input as ArrayBuffer));
  }

  if (ArrayBuffer.isView(input)) {
    return encodeBytesToDataUrl(
      new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
    );
  }

  if (
    (typeof Blob !== 'undefined' && input instanceof Blob) ||
    typeof (input as Blob).arrayBuffer === 'function'
  ) {
    const blob = input as Blob;
    if (typeof blob.size === 'number' && blob.size > MAX_IMAGE_BYTES) {
      throw new Error('compileFromImage: image exceeds the 32 MB limit.');
    }
    const ab = await blob.arrayBuffer();
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('compileFromImage aborted');
    }
    return encodeBytesToDataUrl(new Uint8Array(ab));
  }

  const drawable = input as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
    toDataURL?: (type?: string, quality?: number) => string;
    src?: string;
  };
  const w = Number(
    drawable.videoWidth || drawable.naturalWidth || drawable.width || 0,
  );
  const h = Number(
    drawable.videoHeight || drawable.naturalHeight || drawable.height || 0,
  );
  if (w > 0 && h > 0) {
    const scaled = downscaleDrawableToDataUrl(input, w, h, maxEdge);
    if (scaled) return scaled;
  }
  if (typeof drawable.toDataURL === 'function') {
    const dataUrl = drawable.toDataURL('image/jpeg', 0.88);
    if (isAllowedImageUrl(dataUrl)) return dataUrl;
  }
  if (typeof drawable.src === 'string' && drawable.src.trim()) {
    return normalizeImageInput(drawable.src, options);
  }
  throw new Error('compileFromImage: unsupported or unloaded image source.');
}

/**
 * Reconstructs a 3D scene from a reference image (`Blob`, `HTMLImageElement`,
 * `HTMLVideoElement`, `HTMLCanvasElement`, `ImageBitmap`, `ArrayBuffer`,
 * `Uint8Array`, `data:image/...` URI, or `https://` URL) using an LLM,
 * validating the generated script in the sandbox and auto-repairing both
 * compile errors and linter warnings before hot-swapping the live scene.
 */
export async function compileFromImage(
  el: AIEditableElement,
  image: AIImageInput,
  options: CompileFromImageOptions = {},
): Promise<EditSceneResult> {
  if (!el?.allowClientScripts) {
    throw new Error(
      'compileFromImage requires client scripts: add the allow-client-scripts attribute.',
    );
  }
  const provider = resolveProvider(el, options, 'compileFromImage');
  const prevSource = currentSource(el);

  // A newer compileFromImage or editScene call supersedes an in-flight one.
  el.__tlAiAbort?.abort(
    new Error('compileFromImage superseded by a newer call'),
  );
  const ctrl = new AbortController();
  el.__tlAiAbort = ctrl;
  const onOuterAbort = () => ctrl.abort(options.signal?.reason);
  if (options.signal?.aborted) onOuterAbort();
  options.signal?.addEventListener('abort', onOuterAbort, {once: true});
  const signal = ctrl.signal;

  const prompt = Array.from(String(options.prompt ?? '').trim())
    .slice(0, MAX_IMAGE_PROMPT_CHARS)
    .join('');
  const hasPriors = formatSpatialPriors(options.priors).length > 0;
  const maxRepairs = Math.max(
    0,
    Math.min(3, Math.floor(Number(options.maxRepairs ?? 1)) || 0),
  );

  let code = '';
  let error = '';
  let warnings: string[] = [];
  let repairs = 0;
  let bestCandidate: {code: string; warnings: string[]} | null = null;

  try {
    const imageUrl = await normalizeImageInput(image, {
      maxEdge: options.maxEdge,
      signal,
      fetch: options.fetch,
    });
    if (signal.aborted) throw signal.reason;
    const messages = buildImageMessages(imageUrl, prompt, options.priors);

    el.fireEvent?.('three-live-image-start', {prompt, hasPriors});

    for (let turn = 0; turn <= maxRepairs; turn++) {
      const reply = await provider.complete({messages, signal});
      if (signal.aborted) throw signal.reason;
      code = extractScript(reply);
      warnings = [];
      if (!code) {
        error = 'The model reply did not contain a scene script.';
      } else if (new TextEncoder().encode(code).length > MAX_SCRIPT_BYTES) {
        error = 'The generated script exceeds the 1 MB script limit.';
      } else {
        try {
          const res = await dryRunCompile(el, code, signal, 'compileFromImage');
          warnings = [...res.warnings];
          const summary = sceneSummary(res.model);
          if (
            summary.unnamedXrNodes > 0 &&
            !warnings.some((w) => w.includes('TL204'))
          ) {
            warnings.push(
              '[TL204] Node with userData.xr is missing a unique .name.',
            );
          }
          if (summary.meshes === 0) {
            error = 'The generated scene contains no meshes.';
          } else {
            error = '';
            bestCandidate = {code, warnings: [...warnings]};
          }
        } catch (caught: unknown) {
          if (signal.aborted) throw signal.reason;
          const e = caught as {name?: string; message?: string} | null;
          const msg = String(e?.message || caught);
          error =
            e?.name && e.name !== 'Error' && !msg.startsWith(e.name)
              ? `${e.name}: ${msg}`
              : msg;
        }
      }
      if (!error && warnings.length === 0) break;
      if (turn < maxRepairs) {
        repairs++;
        messages.push(
          {role: 'assistant', content: reply},
          {role: 'user', content: imageRepairMessage(error, warnings)},
        );
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort);
    if (el.__tlAiAbort === ctrl) el.__tlAiAbort = null;
  }

  // If a warning-repair turn failed to compile, fall back to the earlier compiling candidate.
  if (error && bestCandidate) {
    code = bestCandidate.code;
    warnings = bestCandidate.warnings;
    error = '';
  }

  if (!error && !options.dryRun) {
    try {
      await el.executeScript(code);
      if (prevSource.trim()) {
        const history: string[] = (el.__tlAiHistory ??= []);
        history.push(prevSource);
        if (history.length > MAX_HISTORY) history.shift();
      }
      el.__tlAiSource = code;
      setSelection(el as never, [], {mode: 'clear', source: 'api'});
    } catch (e: unknown) {
      error = `The generated scene compiled but failed to load: ${(e as Error)?.message || String(e)}`;
      el.__tlAiSource = prevSource;
      if (prevSource.trim()) {
        el.executeScript(prevSource).catch(() => {});
      }
    }
  }

  const applied = !error;
  const result: EditSceneResult = {
    applied,
    code,
    repairs,
    warnings,
    ...(error ? {error} : {}),
  };
  el.fireEvent?.('three-live-image', {prompt, ...result});
  return result;
}
