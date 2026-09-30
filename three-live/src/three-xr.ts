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

import {registeredPlugins} from './plugin';
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
  const modes = await getAvailableARModes();
  if (modes.includes('quick-look')) return 'quick-look';
  if (modes.includes('webxr')) return 'webxr';
  if (modes.includes('scene-viewer')) return 'scene-viewer';
  return null;
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

/**
 * Manages an in-browser WebXR 'immersive-ar' session with floor hit-testing.
 */
export class WebXRSessionManager {
  private session: any = null;
  private refSpace: any = null;
  private viewerSpace: any = null;
  private hitTestSource: any = null;
  private isPlaced = false;
  private placedMatrix: Float32Array = new Float32Array(16);
  private currentHitMatrix: Float32Array | null = null;
  private view: ThreeView | null = null;
  private options: WebXROptions;

  constructor(options: WebXROptions = {}) {
    this.options = options;
  }

  public isSessionActive(): boolean {
    return this.session !== null;
  }

  public hasPlacedModel(): boolean {
    return this.isPlaced;
  }

  public getPlacedMatrix(): Float32Array {
    return this.placedMatrix;
  }

  /**
   * Starts the WebXR immersive-ar session attached to a ThreeView renderer.
   */
  public async start(view: ThreeView, element?: any): Promise<void> {
    if (typeof navigator === 'undefined' || !(navigator as any).xr) {
      throw new Error('WebXR is not supported on this browser.');
    }
    const navXR = (navigator as any).xr;
    this.view = view;

    const sessionInit: any = {
      requiredFeatures: this.options.requiredFeatures || [],
      optionalFeatures: this.options.optionalFeatures || [
        'local',
        'hit-test',
        'dom-overlay',
        'light-estimation',
      ],
    };

    const el = element || (view as any)?.container;
    for (const plugin of registeredPlugins) {
      plugin.onConfigureXRSessionInit?.(el, sessionInit);
    }

    let targetMode = 'immersive-ar';
    try {
      const arSupported = await navXR.isSessionSupported('immersive-ar');
      if (!arSupported) {
        targetMode = 'immersive-vr';
      }
    } catch {
      targetMode = 'immersive-vr';
    }

    try {
      this.session = await navXR.requestSession(targetMode, sessionInit);
    } catch (err: any) {
      this.options.onError?.(err);
      throw err;
    }

    this.session.addEventListener('end', () => {
      this.cleanup();
      this.options.onExit?.();
    });

    this.session.addEventListener('select', () => {
      this.handleSelect();
    });

    const gl = view.getGLContext?.();
    if (gl && (gl as any).makeXRCompatible) {
      await (gl as any).makeXRCompatible();
    }

    if (
      gl &&
      typeof window !== 'undefined' &&
      typeof (window as any).XRWebGLLayer === 'function' &&
      typeof this.session.updateRenderState === 'function'
    ) {
      const baseLayer = new (window as any).XRWebGLLayer(this.session, gl);
      this.session.updateRenderState({baseLayer});
    }

    this.refSpace = await this.session.requestReferenceSpace('local');
    this.viewerSpace = await this.session.requestReferenceSpace('viewer');

    if (this.session.requestHitTestSource) {
      try {
        this.hitTestSource = await this.session.requestHitTestSource({
          space: this.viewerSpace,
        });
      } catch (_) {}
    }

    this.session.requestAnimationFrame(this.onXRFrame.bind(this));
  }

  /**
   * Ends the active WebXR session.
   */
  public async stop(): Promise<void> {
    if (this.session) {
      await this.session.end();
      this.cleanup();
    }
  }

  private handleSelect(): void {
    if (this.currentHitMatrix && !this.isPlaced) {
      this.placedMatrix.set(this.currentHitMatrix);
      this.isPlaced = true;
      this.options.onPlaced?.(this.placedMatrix);
    }
  }

  private onXRFrame(time: number, frame: any): void {
    if (!this.session) return;
    this.session.requestAnimationFrame(this.onXRFrame.bind(this));

    const pose = frame.getViewerPose(this.refSpace);
    if (!pose) return;

    const gl = this.view?.getGLContext?.();
    const glLayer = this.session.renderState?.baseLayer;
    if (gl && glLayer && glLayer.framebuffer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    }

    if (this.hitTestSource && !this.isPlaced) {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      for (const hit of hitTestResults) {
        const hitPose = hit.getPose(this.refSpace);
        if (hitPose) {
          const m = hitPose.transform.matrix;
          const normalY = m[5];
          if (this.options.arPlacement === 'wall' && Math.abs(normalY) > 0.35) {
            continue;
          }
          if (
            this.options.arPlacement === 'floor' &&
            Math.abs(normalY) < 0.65
          ) {
            continue;
          }
          this.currentHitMatrix = m;
          this.options.onHit?.(this.currentHitMatrix!);
          break;
        }
      }
    }

    for (const plugin of registeredPlugins) {
      plugin.onXRFrame?.(this.view, this.session, frame, this.refSpace);
    }

    // Render WebXR views
    for (const xrView of pose.views) {
      if (this.view && typeof (this.view as any).renderXRView === 'function') {
        (this.view as any).renderXRView(
          xrView,
          this.isPlaced ? this.placedMatrix : this.currentHitMatrix,
          this.isPlaced,
        );
      }
    }

    if (gl && glLayer && glLayer.framebuffer) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  private cleanup(): void {
    if (this.hitTestSource) {
      this.hitTestSource.cancel?.();
      this.hitTestSource = null;
    }
    this.session = null;
    this.refSpace = null;
    this.viewerSpace = null;
    this.currentHitMatrix = null;
    this.isPlaced = false;
    this.view = null;
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
      await mgr.start(options.view);
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
