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

import type {AIChatContentPart, AIChatMessage} from './ai';

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
