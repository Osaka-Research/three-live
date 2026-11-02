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
 * @fileoverview Universal Spatial and Augmented Reality (AR) Module for Three-Live.
 * Provides unified cross-platform spatial capabilities:
 * - iOS AR Quick Look: In-memory USDA serializer and 64-byte aligned zero-dependency USDZ packager.
 * - Android Scene Viewer: Native ARCore Intent launcher.
 * - In-Browser WebXR: WebGL2 immersive-ar session manager with surface hit-testing and reticle placement.
 */

import {registeredPlugins, XR_LIVE_AR_SURFACE_Y} from './plugin';
import {
  buildUSDZZip,
  calculateCRC32,
  createUSDZBlob,
  generateUSDA,
  generateUSDZ,
  glbToUSDZ,
  type SceneOrGLBSource,
  type USDAMeshData,
  type ZipEntry,
} from './three-convert';
import {type GLBData, type ThreeView} from './three-view';

export {
  buildUSDZZip,
  calculateCRC32,
  createUSDZBlob,
  generateUSDA,
  generateUSDZ,
  glbToUSDZ,
  type SceneOrGLBSource,
  type USDAMeshData,
  type ZipEntry,
};

export type ARMode = 'webxr' | 'quick-look' | 'scene-viewer';

export interface ARCapabilities {
  webxr: boolean;
  quickLook: boolean;
  sceneViewer: boolean;
  availableModes: ARMode[];
  bestMode: ARMode | null;
}

export interface QuickLookOptions {
  allowScale?: boolean;
  canonicalWebPageUrl?: string;
  checkoutTitle?: string;
  checkoutSubtitle?: string;
  price?: string;
}

export interface SceneViewerOptions {
  title?: string;
  link?: string;
  resizable?: boolean;
  enableVerticalPlacement?: boolean;
  mode?: 'ar_preferred' | 'ar_only' | '3d_preferred' | '3d_only';
}

export interface WebXROptions {
  requiredFeatures?: string[];
  optionalFeatures?: string[];
  reticleColor?: number[];
  arScale?: 'auto' | 'fixed';
  arPlacement?: 'floor' | 'wall';
  onPlaced?: (matrix: Float32Array) => void;
  onHit?: (hitMatrix: Float32Array) => void;
  onExit?: () => void;
  onError?: (err: Error) => void;
}

export interface ARLaunchOptions {
  model: SceneOrGLBSource | string;
  glbUrl?: string;
  view?: ThreeView;
  element?: any;
  preferredModes?: ARMode[];
  arScale?: 'auto' | 'fixed';
  arPlacement?: 'floor' | 'wall';
  quickLookOptions?: QuickLookOptions;
  sceneViewerOptions?: SceneViewerOptions;
  webXROptions?: WebXROptions;
}

export interface ARLaunchResult {
  mode: ARMode;
  success: boolean;
  session?: WebXRSessionManager;
  error?: Error;
}

// ---------------------------------------------------------------------------
// 1. Device & Capability Detection
// ---------------------------------------------------------------------------

/**
 * Checks whether Apple Quick Look (USDZ) is supported by the current client.
 */
export function isQuickLookSupported(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (!isIOS) return false;

  const tempAnchor = document.createElement('a');
  return (
    tempAnchor.relList !== undefined &&
    tempAnchor.relList.supports !== undefined &&
    tempAnchor.relList.supports('ar')
  );
}

/**
 * Checks whether Google Scene Viewer (Android ARCore) is supported.
 */
export function isSceneViewerSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /android/i.test(ua);
}

/**
 * Checks whether WebXR 'immersive-ar' or 'immersive-vr' session is supported.
 */
export async function isWebXRSupported(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as any;
  if (!nav.xr || typeof nav.xr.isSessionSupported !== 'function') {
    return false;
  }
  try {
    if (await nav.xr.isSessionSupported('immersive-ar')) return true;
    return await nav.xr.isSessionSupported('immersive-vr');
  } catch {
    return false;
  }
}

/**
 * Queries all supported AR modes on the current platform.
 */
export async function getAvailableARModes(): Promise<ARMode[]> {
  const modes: ARMode[] = [];
  if (await isWebXRSupported()) {
    modes.push('webxr');
  }
  if (isQuickLookSupported()) {
    modes.push('quick-look');
  }
  if (isSceneViewerSupported()) {
    modes.push('scene-viewer');
  }
  return modes;
}

/**
 * Returns the best AR mode available for the current environment.
 */
export async function getBestARMode(): Promise<ARMode | null> {
  return (await getARCapabilities()).bestMode;
}

/**
 * Returns comprehensive AR capability report.
 */
export async function getARCapabilities(): Promise<ARCapabilities> {
  const [webxr, quickLook, sceneViewer] = await Promise.all([
    isWebXRSupported(),
    Promise.resolve(isQuickLookSupported()),
    Promise.resolve(isSceneViewerSupported()),
  ]);

  const availableModes: ARMode[] = [];
  if (quickLook) availableModes.push('quick-look');
  if (webxr) availableModes.push('webxr');
  if (sceneViewer) availableModes.push('scene-viewer');

  let bestMode: ARMode | null = null;
  if (quickLook) bestMode = 'quick-look';
  else if (webxr) bestMode = 'webxr';
  else if (sceneViewer) bestMode = 'scene-viewer';

  return {webxr, quickLook, sceneViewer, availableModes, bestMode};
}

// ---------------------------------------------------------------------------
// 2. Apple AR Quick Look Launcher
// ---------------------------------------------------------------------------

/**
 * Launches Apple AR Quick Look via an `<a rel="ar">` element.
 */
export function launchQuickLook(
  usdzBlobOrUrl: Blob | string,
  options: QuickLookOptions = {},
): void {
  if (typeof document === 'undefined') {
    throw new Error('launchQuickLook requires a browser DOM environment');
  }

  let url: string;
  let shouldRevoke = false;

  if (typeof usdzBlobOrUrl === 'string') {
    // This URL is about to be assigned to an <a href> that we click
    // programmatically, so an unchecked `javascript:` or `data:text/html`
    // string would execute in the host page. Allowlist the scheme first.
    url = sanitizeQuickLookUrl(usdzBlobOrUrl);
    if (!url) {
      throw new Error('[XR-Live Security] Quick Look URL is empty.');
    }
  } else {
    url = URL.createObjectURL(usdzBlobOrUrl);
    shouldRevoke = true;
  }

  const hashParams: string[] = [];
  if (options.allowScale === false) {
    hashParams.push('allowsContentScaling=0');
  }
  if (options.canonicalWebPageUrl) {
    const safeCanonical = sanitizeSceneViewerUrl(
      options.canonicalWebPageUrl,
      false,
    );
    if (safeCanonical) {
      hashParams.push(
        `canonicalWebPageURL=${encodeURIComponent(safeCanonical)}`,
      );
    }
  }
  if (options.checkoutTitle) {
    hashParams.push(
      `checkoutTitle=${encodeURIComponent(options.checkoutTitle)}`,
    );
  }
  if (options.checkoutSubtitle) {
    hashParams.push(
      `checkoutSubtitle=${encodeURIComponent(options.checkoutSubtitle)}`,
    );
  }
  if (options.price) {
    hashParams.push(`price=${encodeURIComponent(options.price)}`);
  }

  if (hashParams.length > 0) {
    url += `#${hashParams.join('&')}`;
  }

  const anchor = document.createElement('a');
  anchor.setAttribute('rel', 'ar');
  anchor.setAttribute('href', url);

  // iOS Safari requires a child <img> element inside <a rel="ar"> to trigger Quick Look
  const img = document.createElement('img');
  img.setAttribute('src', 'data:image/svg+xml;utf8,<svg/>');
  img.style.display = 'none';
  anchor.appendChild(img);

  document.body.appendChild(anchor);
  anchor.click();

  setTimeout(() => {
    document.body.removeChild(anchor);
    if (shouldRevoke) {
      URL.revokeObjectURL(url.split('#')[0]);
    }
  }, 3000);
}

// ---------------------------------------------------------------------------
// 3. Android Google Scene Viewer Intent Builder
// ---------------------------------------------------------------------------

function sanitizeSceneViewerUrl(url: string, allowBlob = false): string {
  if (typeof url !== 'string') return '';
  // Strip ASCII C0 control characters and DEL before checking scheme so
  // "java\tscript:..." cannot bypass the scheme regex (WHATWG URL parser strips
  // tabs/newlines during scheme parsing).
  const cleaned = url.replace(/[\x00-\x1f\x7f]+/g, '').trim();
  if (!cleaned) return '';
  if (/^[\\/]{2}/.test(cleaned)) {
    throw new Error(
      `[XR-Live Security] Rejected protocol-relative URL in Scene Viewer intent: ${cleaned.slice(0, 32)}`,
    );
  }
  const lower = cleaned.toLowerCase();
  if (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    (allowBlob && lower.startsWith('blob:'))
  ) {
    return cleaned;
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(cleaned)) {
    return cleaned;
  }
  throw new Error(
    `[XR-Live Security] Rejected unsafe URL scheme in Scene Viewer intent: ${cleaned.slice(0, 32)}`,
  );
}

/**
 * Allowlists the scheme of a URL destined for an `<a rel="ar" href>` that we
 * click programmatically. Permits https/http, blob (produced by the Blob
 * branch of {@link launchQuickLook}) and relative URLs; rejects everything
 * else, notably `javascript:` and `data:`.
 */
function sanitizeQuickLookUrl(url: string): string {
  try {
    return sanitizeSceneViewerUrl(url, /* allowBlob= */ true);
  } catch {
    throw new Error(
      `[XR-Live Security] Rejected unsafe URL scheme in Quick Look launch: ${(url || '').trim().slice(0, 32)}`,
    );
  }
}

/**
 * Builds the canonical Android Scene Viewer intent URI for ARCore.
 */
export function createSceneViewerIntent(
  glbUrl: string,
  options: SceneViewerOptions = {},
): string {
  const safeGlbUrl = sanitizeSceneViewerUrl(glbUrl, true);
  const mode = options.mode || 'ar_preferred';
  const params = new URLSearchParams({
    file: safeGlbUrl,
    mode,
    resizable: options.resizable !== false ? 'true' : 'false',
    enable_vertical_placement: options.enableVerticalPlacement
      ? 'true'
      : 'false',
  });

  if (options.title) params.set('title', options.title);
  if (options.link) {
    params.set('link', sanitizeSceneViewerUrl(options.link, false));
  }

  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}#Intent;scheme=https;package=com.google.ar.core;action=android.intent.action.VIEW;end;`;
}

/**
 * Launches Android Google Scene Viewer.
 */
export function launchSceneViewer(
  glbUrl: string,
  options: SceneViewerOptions = {},
): void {
  if (typeof window === 'undefined') {
    throw new Error('launchSceneViewer requires a browser environment');
  }
  const intentUrl = createSceneViewerIntent(glbUrl, options);
  window.location.href = intentUrl;
}

// ---------------------------------------------------------------------------
// 4. In-Browser WebXR Session Manager (immersive-ar)
// ---------------------------------------------------------------------------

let activeWebXRManager: WebXRSessionManager | null = null;

function createARReticleGpu(gl: WebGL2RenderingContext, color?: number[]): any {
  const segs = 24;
  const pos = new Float32Array(segs * 6);
  const norm = new Float32Array(segs * 6);
  const uvs = new Float32Array(segs * 4);
  const idx = new Uint16Array(segs * 6);
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a),
      v0 = i * 2,
      v1 = v0 + 1,
      n0 = ((i + 1) % segs) * 2;
    pos[v0 * 3] = c * 0.11;
    pos[v0 * 3 + 1] = 0.002;
    pos[v0 * 3 + 2] = s * 0.11;
    pos[v1 * 3] = c * 0.145;
    pos[v1 * 3 + 1] = 0.002;
    pos[v1 * 3 + 2] = s * 0.145;
    norm[v0 * 3 + 1] = norm[v1 * 3 + 1] = 1;
    idx.set([v0, n0, v1, v1, n0, n0 + 1], i * 6);
  }
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const mk = (d: Float32Array, loc: number, sz: number) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, 0, 0);
    return b;
  };
  const buffers = [mk(pos, 0, 3), mk(norm, 1, 3), mk(uvs, 2, 2)];
  const ib = gl.createBuffer()!;
  buffers.push(ib);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return {
    name: '__xr_reticle__',
    nodeIndex: -1,
    worldSpace: true,
    visible: false,
    transform: new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ]),
    normalMatrix: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    primitives: [
      {
        vao,
        indexCount: idx.length,
        indexType: gl.UNSIGNED_SHORT,
        baseColor: (color && color.length >= 3
          ? [color[0], color[1], color[2], color[3] ?? 0.95]
          : [0.22, 0.74, 0.97, 0.95]) as [number, number, number, number],
        metallic: 0,
        roughness: 0.2,
        positions: pos,
        indices: idx,
        texture: null,
        metallicRoughnessTexture: null,
        normalTexture: null,
        occlusionTexture: null,
        normalScale: 1,
        occlusionStrength: 1,
        buffers,
      },
    ],
  };
}

function buildARMatrix(
  out: Float32Array,
  anchor: [number, number, number],
  pivot: [number, number, number],
  yaw: number,
  scale: number,
): void {
  const c = Math.cos(yaw),
    sn = Math.sin(yaw),
    s = Math.max(0.01, scale);
  out.fill(0);
  out[0] = s * c;
  out[2] = -s * sn;
  out[5] = s;
  out[8] = s * sn;
  out[10] = s * c;
  out[12] = anchor[0] - s * (c * pivot[0] + sn * pivot[2]);
  out[13] = anchor[1] - s * pivot[1];
  out[14] = anchor[2] - s * (-sn * pivot[0] + c * pivot[2]);
  out[15] = 1;
}

/**
 * Manages an in-browser WebXR 'immersive-ar' session with surface hit-testing.
 */
export class WebXRSessionManager {
  private s: any = null;
  private placed = false;
  private placedMat = new Float32Array([
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);
  private opts: WebXROptions;
  private cleanFn: (() => void) | null = null;

  constructor(options: WebXROptions = {}) {
    this.opts = options;
  }

  public isSessionActive(): boolean {
    return this.s !== null;
  }

  public hasPlacedModel(): boolean {
    return this.placed;
  }

  public getPlacedMatrix(): Float32Array {
    return this.placedMat;
  }

  public async start(view: ThreeView, element?: any): Promise<void> {
    if (typeof navigator === 'undefined' || !(navigator as any).xr) {
      throw new Error('WebXR is not supported on this browser.');
    }
    if (
      activeWebXRManager &&
      activeWebXRManager !== this &&
      activeWebXRManager.isSessionActive()
    ) {
      await activeWebXRManager.stop().catch(() => {});
    }

    const navXR = (navigator as any).xr;
    const opts = this.opts;
    const el = element || (view as any)?.container;
    const isXRLive = String(el?.tagName || '').toLowerCase() === 'xr-live';
    const b = (view as any)?.bounds;
    const rad = Number(b?.radius) || 1;
    const ctr = Array.isArray(b?.center) ? b.center : [0, 0, 0];
    const mn = Array.isArray(b?.min) ? b.min : [-0.5, -0.5, -0.5];
    const ua =
      typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
    const isHandheldPhone =
      /Android|iPhone|iPad|iPod/i.test(ua) &&
      !/Quest|Oculus|Pico|Vision/i.test(ua);
    const baseScale = isXRLive
      ? opts.arScale === 'fixed'
        ? 1
        : isHandheldPhone
          ? 0.55
          : 1
      : opts.arScale === 'fixed'
        ? 1
        : rad > 0.45
          ? 0.3 / rad
          : rad < 0.05
            ? 0.12 / Math.max(rad, 0.001)
            : 1;
    const pivot: [number, number, number] = isXRLive
      ? [0, XR_LIVE_AR_SURFACE_Y, 0]
      : [
          ctr[0] || 0,
          opts.arPlacement === 'wall' ? ctr[1] : (mn[1] ?? 0),
          ctr[2] || 0,
        ];

    let mode: 'immersive-ar' | 'immersive-vr' = 'immersive-ar';
    try {
      if (!(await navXR.isSessionSupported('immersive-ar'))) {
        mode = 'immersive-vr';
      }
    } catch {
      mode = 'immersive-vr';
    }

    let overlayRoot: HTMLElement | null =
      el?.querySelector?.('[slot="ar-overlay"]') || null;
    let ownsOverlay = false;
    let pill: HTMLElement | null = null;
    const rmOverlay = () => {
      if (ownsOverlay && overlayRoot?.parentNode) {
        overlayRoot.parentNode.removeChild(overlayRoot);
      }
      overlayRoot = null;
      pill = null;
      ownsOverlay = false;
    };

    if (mode === 'immersive-ar') {
      if (overlayRoot) {
        overlayRoot.addEventListener?.('beforexrselect', (e: Event) =>
          e.preventDefault(),
        );
      } else if (
        typeof document !== 'undefined' &&
        document.body &&
        typeof document.createElement === 'function'
      ) {
        const root = document.createElement('div');
        root.style.cssText =
          'position:fixed;inset:0;pointer-events:none;background:transparent!important;z-index:2147483647;font-family:system-ui,sans-serif;user-select:none';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '✕ Exit AR';
        btn.style.cssText =
          'position:absolute;top:max(16px,env(safe-area-inset-top,16px));right:16px;pointer-events:auto;padding:8px 14px;border-radius:99px;border:1px solid rgba(255,255,255,.3);background:rgba(15,23,42,.8);color:#f8fafc;font:600 13px system-ui,sans-serif';
        btn.addEventListener('beforexrselect', (e: Event) =>
          e.preventDefault(),
        );
        btn.addEventListener('click', (e: Event) => {
          e.stopPropagation();
          this.stop().catch(() => {});
        });
        pill = document.createElement('div');
        pill.style.cssText =
          'position:absolute;bottom:max(28px,env(safe-area-inset-bottom,28px));left:50%;transform:translateX(-50%);padding:8px 15px;border-radius:99px;border:1px solid rgba(56,189,248,.4);background:rgba(15,23,42,.82);color:#f8fafc;font:500 12.5px system-ui,sans-serif;text-align:center;max-width:88vw';
        pill.textContent = 'Move phone to detect a surface • Tap to place';
        root.appendChild(btn);
        root.appendChild(pill);
        document.body.appendChild(root);
        overlayRoot = root;
        ownsOverlay = true;
      }
    }

    const optSet = new Set<string>(
      opts.optionalFeatures || [
        'local',
        'local-floor',
        'hit-test',
        'light-estimation',
      ],
    );
    const sessionInit: any = {
      requiredFeatures: opts.requiredFeatures ? [...opts.requiredFeatures] : [],
      optionalFeatures: Array.from(optSet),
    };
    if (overlayRoot) {
      optSet.add('dom-overlay');
      sessionInit.optionalFeatures = Array.from(optSet);
      sessionInit.domOverlay = {root: overlayRoot};
    }
    for (const plugin of registeredPlugins) {
      plugin.onConfigureXRSessionInit?.(el, sessionInit);
    }
    if (
      Array.isArray(sessionInit.optionalFeatures) &&
      sessionInit.optionalFeatures.includes('dom-overlay') &&
      !sessionInit.domOverlay?.root
    ) {
      sessionInit.optionalFeatures = sessionInit.optionalFeatures.filter(
        (f: string) => f !== 'dom-overlay',
      );
    }

    const isFatalPerm = (e: any) => {
      const n = String(e?.name || '');
      return n === 'NotAllowedError' || n === 'SecurityError';
    };
    try {
      this.s = await navXR.requestSession(mode, sessionInit);
    } catch (e1: any) {
      rmOverlay();
      if (isFatalPerm(e1)) {
        opts.onError?.(e1);
        throw e1;
      }
      try {
        this.s = await navXR.requestSession(mode, {
          requiredFeatures: [],
          optionalFeatures: ['local', 'hit-test'],
        });
      } catch (e2: any) {
        if (isFatalPerm(e2)) {
          opts.onError?.(e2);
          throw e2;
        }
        try {
          this.s = await navXR.requestSession(mode);
        } catch (e3: any) {
          opts.onError?.(e3);
          throw e3;
        }
      }
    }

    const session = this.s;
    activeWebXRManager = this;
    this.placed = false;

    let refSpace: any = null;
    let hitSource: any = null;
    let reticle: any = null;
    let hitMat: Float32Array | null = null;
    let hitPos: [number, number, number] | null = null;
    let previewPos: [number, number, number] = [0, -0.25, -1.2];
    let placedPos: [number, number, number] = [0, -0.25, -1.2];
    const activeMat = new Float32Array(16);
    let hasPreview = false;
    let userScale = 1;
    let yaw = 0;
    let dragging = false;
    let lastDist: number | null = null;
    let lastAng: number | null = null;
    let lastTime = 0;
    let cleanTouch: (() => void) | null = null;

    const cleanup = () => {
      if (activeWebXRManager === this) activeWebXRManager = null;
      cleanTouch?.();
      cleanTouch = null;
      try {
        hitSource?.cancel?.();
      } catch (_) {}
      hitSource = null;
      if (reticle) {
        const meshes = (view as any)?.meshes;
        if (Array.isArray(meshes)) {
          const idx = meshes.indexOf(reticle);
          if (idx !== -1) meshes.splice(idx, 1);
        }
        const gl = view.getGLContext?.() || (view as any)?.gl;
        if (gl) {
          for (const pr of reticle.primitives || []) {
            gl.deleteVertexArray?.(pr.vao);
            for (const bf of pr.buffers || []) gl.deleteBuffer?.(bf);
          }
        }
        reticle = null;
      }
      (view as any)?.setXRSessionActive?.(false);
      rmOverlay();
      this.s = null;
      this.placed = false;
      this.cleanFn = null;
    };
    this.cleanFn = cleanup;

    session.addEventListener('end', () => {
      cleanup();
      opts.onExit?.();
    });
    session.addEventListener('select', () => {
      if (!this.placed) {
        const a = hitPos || previewPos;
        placedPos = [a[0], a[1], a[2]];
        buildARMatrix(
          this.placedMat,
          placedPos,
          pivot,
          yaw,
          baseScale * userScale,
        );
        this.placed = true;
        if (reticle) reticle.visible = false;
        if (pill) pill.textContent = 'Placed • Drag to move • Pinch to scale';
        opts.onPlaced?.(this.placedMat);
      }
    });

    try {
      const gl = view.getGLContext?.() || (view as any)?.gl;
      if (gl && typeof (gl as any).makeXRCompatible === 'function') {
        await (gl as any).makeXRCompatible();
      }
      const LayerCtor =
        typeof XRWebGLLayer !== 'undefined'
          ? XRWebGLLayer
          : (globalThis as any)?.XRWebGLLayer;
      if (
        gl &&
        typeof LayerCtor === 'function' &&
        typeof session.updateRenderState === 'function'
      ) {
        session.updateRenderState({
          baseLayer: new LayerCtor(session, gl, {alpha: true}),
        });
      }

      try {
        refSpace = await session.requestReferenceSpace('local');
      } catch {
        try {
          refSpace = await session.requestReferenceSpace('local-floor');
        } catch {
          refSpace = await session.requestReferenceSpace('viewer');
        }
      }
      const viewerSpace = await session
        .requestReferenceSpace('viewer')
        .catch(() => refSpace);
      if (typeof session.requestHitTestSource === 'function' && viewerSpace) {
        hitSource = await session
          .requestHitTestSource({space: viewerSpace})
          .catch(() => null);
      }

      if (
        mode === 'immersive-ar' &&
        gl &&
        typeof gl.createVertexArray === 'function' &&
        Array.isArray((view as any).meshes)
      ) {
        reticle = createARReticleGpu(gl, opts.reticleColor);
        (view as any).meshes.push(reticle);
      }

      if (
        typeof window !== 'undefined' &&
        typeof window.addEventListener === 'function'
      ) {
        const tDist = (e: TouchEvent) =>
          Math.hypot(
            e.touches[1].clientX - e.touches[0].clientX,
            e.touches[1].clientY - e.touches[0].clientY,
          );
        const tAng = (e: TouchEvent) =>
          Math.atan2(
            e.touches[1].clientY - e.touches[0].clientY,
            e.touches[1].clientX - e.touches[0].clientX,
          );
        const onStart = (e: TouchEvent) => {
          if (!this.s) return;
          if (e.touches.length === 1 && this.placed) dragging = true;
          else if (e.touches.length >= 2) {
            dragging = false;
            lastDist = tDist(e);
            lastAng = tAng(e);
          }
        };
        const onMove = (e: TouchEvent) => {
          if (!this.s || e.touches.length < 2) return;
          const d = tDist(e),
            a = tAng(e);
          if (lastDist && lastDist > 4 && opts.arScale !== 'fixed') {
            userScale = Math.max(
              0.15,
              Math.min(6, userScale * (d / lastDist)),
            );
          }
          if (lastAng !== null) {
            let da = a - lastAng;
            if (da > Math.PI) da -= Math.PI * 2;
            if (da < -Math.PI) da += Math.PI * 2;
            yaw -= da;
          }
          lastDist = d;
          lastAng = a;
        };
        const onEnd = (e: TouchEvent) => {
          if (!e.touches || e.touches.length === 0) dragging = false;
          if (!e.touches || e.touches.length < 2) {
            lastDist = null;
            lastAng = null;
          }
        };
        window.addEventListener('touchstart', onStart, {passive: true});
        window.addEventListener('touchmove', onMove, {passive: true});
        window.addEventListener('touchend', onEnd, {passive: true});
        window.addEventListener('touchcancel', onEnd, {passive: true});
        cleanTouch = () => {
          window.removeEventListener('touchstart', onStart);
          window.removeEventListener('touchmove', onMove);
          window.removeEventListener('touchend', onEnd);
          window.removeEventListener('touchcancel', onEnd);
        };
      }

      (view as any).setXRSessionActive?.(true);

      const onFrame = (time: number, frame: any) => {
        if (this.s !== session) return;
        session.requestAnimationFrame(onFrame);
        const dt =
          lastTime > 0
            ? Math.min(Math.max((time - lastTime) / 1000, 0), 0.1)
            : 1 / 60;
        lastTime = time;
        (view as any)?.stepXRUpdate?.(dt);

        const pose = frame.getViewerPose(refSpace);
        if (!pose) return;

        const fv = pose.views?.[0];
        if (!hasPreview && fv?.transform) {
          const p = fv.transform.position;
          const m = fv.transform.matrix;
          const px = p?.x ?? (m ? m[12] : 0),
            py = p?.y ?? (m ? m[13] : 0),
            pz = p?.z ?? (m ? m[14] : 0);
          let fx = m ? -m[8] : 0,
            fz = m ? -m[10] : -1;
          const hl = Math.hypot(fx, fz);
          if (hl > 1e-4) {
            fx /= hl;
            fz /= hl;
          } else {
            fx = 0;
            fz = -1;
          }
          previewPos = [px + fx * 1.2, py - 0.25, pz + fz * 1.2];
          yaw = Math.atan2(-fx, -fz);
          hasPreview = true;
        }

        if (
          hitSource &&
          typeof frame.getHitTestResults === 'function' &&
          (!this.placed || dragging)
        ) {
          const results = frame.getHitTestResults(hitSource) || [];
          let matched = false;
          for (const hit of results) {
            const hp = hit.getPose(refSpace);
            if (hp?.transform?.matrix) {
              const m = hp.transform.matrix;
              const ny = m[5];
              if (opts.arPlacement === 'wall' && Math.abs(ny) > 0.35) continue;
              if (opts.arPlacement === 'floor' && Math.abs(ny) < 0.65) continue;
              if (!hitMat) hitMat = new Float32Array(16);
              hitMat.set(m);
              hitPos = [m[12], m[13], m[14]];
              if (this.placed && dragging) placedPos = [m[12], m[13], m[14]];
              if (reticle) {
                reticle.visible = !this.placed || dragging;
                reticle.transform.set(m);
              }
              if (!this.placed && pill) {
                pill.textContent =
                  'Surface found • Tap to place • Pinch to scale';
              }
              opts.onHit?.(hitMat);
              matched = true;
              break;
            }
          }
          if (!matched && reticle) reticle.visible = false;
        }

        buildARMatrix(
          activeMat,
          this.placed ? placedPos : hitPos || previewPos,
          pivot,
          yaw,
          baseScale * userScale,
        );
        if (this.placed) this.placedMat.set(activeMat);
        if ((view as any).modelRootMatrix) {
          (view as any).modelRootMatrix.set(activeMat);
        }

        for (const plugin of registeredPlugins) {
          plugin.onXRFrame?.(view, session, frame, refSpace);
        }

        const glRef = view.getGLContext?.() || (view as any)?.gl;
        const glLayer = session.renderState?.baseLayer;
        if (glRef && glLayer && glLayer.framebuffer !== undefined) {
          glRef.bindFramebuffer(glRef.FRAMEBUFFER, glLayer.framebuffer);
        }

        const isAR = mode === 'immersive-ar';
        const views = pose.views || [];
        for (let i = 0; i < views.length; i++) {
          const xrView = views[i];
          if (typeof (view as any).renderXRView === 'function') {
            let vpTuple: [number, number, number, number] | undefined;
            if (glLayer && typeof glLayer.getViewport === 'function') {
              const vp = glLayer.getViewport(xrView);
              if (vp && vp.width > 0 && vp.height > 0) {
                vpTuple = [vp.x, vp.y, vp.width, vp.height];
              }
            } else if (
              glLayer?.framebufferWidth > 0 &&
              glLayer?.framebufferHeight > 0
            ) {
              vpTuple = [
                0,
                0,
                glLayer.framebufferWidth,
                glLayer.framebufferHeight,
              ];
            }
            (view as any).renderXRView(
              xrView,
              activeMat,
              this.placed,
              vpTuple,
              isAR,
              i,
            );
          }
        }

        if (glRef && glLayer && glLayer.framebuffer) {
          glRef.bindFramebuffer(glRef.FRAMEBUFFER, null);
        }
      };

      session.requestAnimationFrame(onFrame);
    } catch (setupErr: any) {
      if (typeof session.end === 'function') {
        await session.end().catch(() => {});
      }
      cleanup();
      opts.onError?.(setupErr);
      throw setupErr;
    }
  }

  public async stop(): Promise<void> {
    const s = this.s;
    if (s) {
      try {
        await s.end();
      } catch (_) {
      } finally {
        this.cleanFn?.();
      }
    } else {
      this.cleanFn?.();
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Universal AR Launcher
// ---------------------------------------------------------------------------

/**
 * Universal AR entry point: determines best supported AR format and launches it.
 */
export async function activateAR(
  options: ARLaunchOptions,
): Promise<ARLaunchResult> {
  const caps = await getARCapabilities();
  const preferred = options.preferredModes || [
    'quick-look',
    'webxr',
    'scene-viewer',
  ];

  let selectedMode: ARMode | null = null;
  for (const pref of preferred) {
    if (caps.availableModes.includes(pref)) {
      selectedMode = pref;
      break;
    }
  }

  if (!selectedMode) {
    selectedMode = caps.bestMode;
  }

  if (!selectedMode) {
    const err = new Error(
      'No augmented reality viewing mode is supported on this device.',
    );
    return {mode: 'quick-look', success: false, error: err};
  }

  const qlOptions: QuickLookOptions = {
    ...options.quickLookOptions,
    allowScale:
      options.arScale === 'fixed'
        ? false
        : options.quickLookOptions?.allowScale,
  };
  const svOptions: SceneViewerOptions = {
    ...options.sceneViewerOptions,
    resizable:
      options.arScale === 'fixed'
        ? false
        : options.sceneViewerOptions?.resizable,
    enableVerticalPlacement:
      options.arPlacement === 'wall'
        ? true
        : options.sceneViewerOptions?.enableVerticalPlacement,
  };
  const xrOptions: WebXROptions = {
    ...options.webXROptions,
    arScale: options.arScale || options.webXROptions?.arScale,
    arPlacement: options.arPlacement || options.webXROptions?.arPlacement,
  };

  try {
    if (selectedMode === 'quick-look') {
      let usdzBlob: Blob;
      if (
        options.model instanceof Blob &&
        options.model.type === 'model/vnd.usdz+zip'
      ) {
        usdzBlob = options.model;
      } else if (typeof options.model === 'string') {
        launchQuickLook(options.model, qlOptions);
        return {mode: 'quick-look', success: true};
      } else {
        usdzBlob = createUSDZBlob(options.model as any);
      }
      launchQuickLook(usdzBlob, qlOptions);
      return {mode: 'quick-look', success: true};
    }

    if (selectedMode === 'scene-viewer') {
      const glbUrl =
        options.glbUrl ||
        (typeof options.model === 'string' ? options.model : null);
      if (!glbUrl) {
        throw new Error(
          'Scene Viewer requires a hosted GLB URL (glbUrl option).',
        );
      }
      launchSceneViewer(glbUrl, svOptions);
      return {mode: 'scene-viewer', success: true};
    }

    if (selectedMode === 'webxr') {
      if (!options.view) {
        throw new Error('WebXR AR mode requires an active ThreeView instance.');
      }
      const mgr = new WebXRSessionManager(xrOptions);
      await mgr.start(options.view, options.element);
      return {mode: 'webxr', success: true, session: mgr};
    }
  } catch (err: any) {
    return {mode: selectedMode, success: false, error: err};
  }

  return {
    mode: selectedMode,
    success: false,
    error: new Error(`Unhandled AR mode: ${selectedMode}`),
  };
}
