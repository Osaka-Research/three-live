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
 * @fileoverview Phase 1.3: HTML-First Spatial UI Slot Rasterizer (`<div slot="spatial">`).
 * Converts standard HTML/CSS child elements with `slot="spatial"` into interactive 3D
 * stereo quads in `ThreeView` with `userData.xr` manipulation/billboard/follow traits
 * and a UV-to-DOM synthetic pointer/click event bridge.
 */

import {
  mat3NormalFromMat4,
  mat4Create,
  mat4FromRotationTranslationScale,
} from '../../three-live/src/math';
import type {XRMeshTraits} from '../../three-live/src/three-convert';
import type {XRInputHit} from './xr-input';
import {quatFromEulerYXZ} from './xr-traits';

export const MAX_SPATIAL_SLOT_DIMENSION = 2048;

export interface SpatialSlotEntry {
  element: HTMLElement;
  meshGpu: any;
  widthPx: number;
  heightPx: number;
  widthMeters: number;
  heightMeters: number;
  dirty: boolean;
  observer: MutationObserver | null;
  canvas?: HTMLCanvasElement | null;
  texAllocated?: boolean;
}

export function parseSlotAttributes(el: HTMLElement): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  dpi: number;
  traits: XRMeshTraits;
} {
  const posAttr = el.getAttribute('data-xr-position') || '0 1.4 -0.8';
  const posParts = posAttr
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const position: [number, number, number] = [
    Number.isFinite(posParts[0]) ? posParts[0] : 0,
    Number.isFinite(posParts[1]) ? posParts[1] : 1.4,
    Number.isFinite(posParts[2]) ? posParts[2] : -0.8,
  ];

  const rotAttr = el.getAttribute('data-xr-rotation') || '0 0 0';
  const rotParts = rotAttr
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const rotation: [number, number, number] = [
    ((Number.isFinite(rotParts[0]) ? rotParts[0] : 0) * Math.PI) / 180,
    ((Number.isFinite(rotParts[1]) ? rotParts[1] : 0) * Math.PI) / 180,
    ((Number.isFinite(rotParts[2]) ? rotParts[2] : 0) * Math.PI) / 180,
  ];

  const scaleAttr = el.getAttribute('data-xr-scale') || '1';
  const scaleParts = scaleAttr
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  const sVal = Number.isFinite(scaleParts[0]) ? scaleParts[0] : 1;
  const scale: [number, number, number] = [sVal, sVal, sVal];

  const dpi = Math.max(100, Number(el.getAttribute('data-xr-dpi')) || 1000);

  const traits: XRMeshTraits = {};
  if (
    typeof el.hasAttribute === 'function' &&
    el.hasAttribute('data-xr-grab')
  ) {
    const val = el.getAttribute('data-xr-grab');
    traits.grab = val === '1-hand' || val === '2-hand' ? val : val !== 'false';
  }
  if (el.hasAttribute('data-xr-billboard')) {
    const val = el.getAttribute('data-xr-billboard') as any;
    traits.billboard =
      val === 'cylindrical' || val === 'spherical' || val === 'capsule'
        ? val
        : val !== 'false'
          ? 'capsule'
          : false;
  }
  if (el.hasAttribute('data-xr-follow')) {
    traits.follow = el.getAttribute('data-xr-follow') || 'head';
  }
  if (el.hasAttribute('data-xr-anchor')) {
    traits.anchor = (el.getAttribute('data-xr-anchor') as any) || 'horizontal';
  }
  if (scaleParts.length >= 2) {
    traits.scale = {min: scaleParts[0], max: scaleParts[1]};
  }

  return {position, rotation, scale, dpi, traits};
}

export class XRSpatialSlotManager {
  private entries: SpatialSlotEntry[] = [];

  public syncSlots(hostElement: any, viewer: any): SpatialSlotEntry[] {
    if (!hostElement || !viewer) return [];
    const slotElements: HTMLElement[] = Array.from(
      hostElement.querySelectorAll?.('[slot="spatial"]') || [],
    );

    // Clean up removed slots
    this.entries = this.entries.filter((entry) => {
      if (!slotElements.includes(entry.element)) {
        this.deleteEntryGpuResources(entry, viewer?.gl);
        const idx = viewer.meshes?.indexOf(entry.meshGpu) ?? -1;
        if (idx !== -1) viewer.meshes.splice(idx, 1);
        return false;
      }
      return true;
    });

    for (const el of slotElements) {
      let existing = this.entries.find((e) => e.element === el);
      if (!existing) {
        existing = this.createSlotEntry(el, viewer);
        this.entries.push(existing);
      }
      if (existing.dirty) {
        this.rasterizeSlotToTexture(existing, viewer.gl);
        existing.dirty = false;
      }
    }

    return this.entries;
  }

  private createSlotEntry(el: HTMLElement, viewer: any): SpatialSlotEntry {
    const {position, rotation, scale, dpi, traits} = parseSlotAttributes(el);
    const rect =
      typeof el.getBoundingClientRect === 'function'
        ? el.getBoundingClientRect()
        : {width: 0, height: 0};
    const styleWidth = parseInt(el.style?.width || '0', 10);
    const styleHeight = parseInt(el.style?.height || '0', 10);
    const rawWidthPx = Math.max(64, rect.width || styleWidth || 320);
    const rawHeightPx = Math.max(48, rect.height || styleHeight || 180);
    const widthMeters = rawWidthPx / dpi;
    const heightMeters = rawHeightPx / dpi;
    const widthPx = Math.min(MAX_SPATIAL_SLOT_DIMENSION, rawWidthPx);
    const heightPx = Math.min(MAX_SPATIAL_SLOT_DIMENSION, rawHeightPx);

    const hw = widthMeters * 0.5;
    const hh = heightMeters * 0.5;

    const positions = new Float32Array([
      -hw,
      -hh,
      0,
      hw,
      -hh,
      0,
      hw,
      hh,
      0,
      -hw,
      hh,
      0,
    ]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const gl = viewer.gl as WebGL2RenderingContext | undefined;
    let vao: WebGLVertexArrayObject | null = null;
    let tex: WebGLTexture | null = null;
    const buffers: WebGLBuffer[] = [];

    if (gl && typeof gl.createVertexArray === 'function') {
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      const posBuf = gl.createBuffer()!;
      buffers.push(posBuf);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      const normBuf = gl.createBuffer()!;
      buffers.push(normBuf);
      gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
      gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

      const uvBuf = gl.createBuffer()!;
      buffers.push(uvBuf);
      gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

      const idxBuf = gl.createBuffer()!;
      buffers.push(idxBuf);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

      gl.bindVertexArray(null);

      tex = gl.createTexture();
      if (tex) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array([30, 35, 45, 235]),
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }

    const transform = mat4Create();
    const quat = quatFromEulerYXZ(rotation[0], rotation[1], rotation[2]);
    mat4FromRotationTranslationScale(transform, quat, position, scale);
    const normalMatrix = new Float32Array(9);
    mat3NormalFromMat4(normalMatrix, transform);

    const meshGpu = {
      name: el.id
        ? `spatial_slot_${el.id}`
        : `spatial_slot_${this.entries.length}`,
      nodeIndex: -1,
      visible: true,
      isSpatialSlot: true,
      spatialElement: el,
      transform,
      normalMatrix,
      extras: {xr: traits},
      userData: {xr: traits},
      primitives: [
        {
          vao,
          indexCount: indices.length,
          indexType: gl ? gl.UNSIGNED_SHORT : 5123,
          baseColor: [1, 1, 1, 0.96] as [number, number, number, number],
          metallic: 0.0,
          roughness: 0.4,
          positions,
          uvs,
          indices,
          texture: tex,
          metallicRoughnessTexture: null,
          normalTexture: null,
          occlusionTexture: null,
          normalScale: 1.0,
          occlusionStrength: 1.0,
          buffers,
        },
      ],
    };

    if (Array.isArray(viewer.meshes)) {
      viewer.meshes.push(meshGpu);
    }

    let observer: MutationObserver | null = null;
    const entry: SpatialSlotEntry = {
      element: el,
      meshGpu,
      widthPx,
      heightPx,
      widthMeters,
      heightMeters,
      dirty: true,
      observer: null,
    };

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        entry.dirty = true;
      });
      try {
        observer.observe(el, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });
      } catch (_) {}
      entry.observer = observer;
    }

    return entry;
  }

  private rasterizeSlotToTexture(
    entry: SpatialSlotEntry,
    gl: WebGL2RenderingContext | undefined,
  ): void {
    if (!gl || typeof document === 'undefined') return;
    const tex = entry.meshGpu.primitives?.[0]?.texture;
    if (!tex) return;

    const targetW = Math.min(
      MAX_SPATIAL_SLOT_DIMENSION,
      Math.max(64, entry.widthPx),
    );
    const targetH = Math.min(
      MAX_SPATIAL_SLOT_DIMENSION,
      Math.max(48, entry.heightPx),
    );

    let canvas = entry.canvas;
    let sizeChanged = false;
    if (!canvas) {
      canvas = document.createElement('canvas');
      entry.canvas = canvas;
      sizeChanged = true;
    }
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
      sizeChanged = true;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Immediate procedural 2D canvas render of card background & child text/buttons
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(22, 26, 36, 0.92)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = 'rgba(120, 160, 255, 0.45)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    const textLines = (entry.element.textContent || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    let y = 28;
    for (const line of textLines.slice(0, 6)) {
      ctx.fillText(line.slice(0, 42), 16, y);
      y += 24;
    }

    try {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      if (
        !entry.texAllocated ||
        sizeChanged ||
        typeof gl.texSubImage2D !== 'function'
      ) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          canvas,
        );
        entry.texAllocated = true;
      } else {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          canvas,
        );
      }
    } catch (_) {}
  }

  /**
   * Maps a 3D raycast UV hit `(u, v)` on a spatial quad to the corresponding child DOM element
   * and dispatches synthetic pointer/click events.
   */
  public handleHit(
    hit: XRInputHit,
    eventType: 'pointerdown' | 'pointerup' | 'pointermove' | 'click' = 'click',
  ): HTMLElement | null {
    const entry = this.entries.find((e) => e.meshGpu === hit.mesh);
    if (!entry) return null;

    const [u, v] = hit.uv;
    const localX = u * entry.widthPx;
    const localY = (1 - v) * entry.heightPx;

    const interactiveChildren = Array.from(
      entry.element.querySelectorAll?.(
        'button, input, select, a, [role="button"], [data-xr-action]',
      ) || [],
    ) as HTMLElement[];

    let targetEl: HTMLElement = entry.element;
    if (interactiveChildren.length > 0) {
      const parentRect =
        typeof entry.element.getBoundingClientRect === 'function'
          ? entry.element.getBoundingClientRect()
          : {left: 0, top: 0, width: entry.widthPx, height: entry.heightPx};

      for (const child of interactiveChildren) {
        const r =
          typeof child.getBoundingClientRect === 'function'
            ? child.getBoundingClientRect()
            : null;
        if (r && r.width > 0 && r.height > 0) {
          const cx = r.left - parentRect.left;
          const cy = r.top - parentRect.top;
          if (
            localX >= cx &&
            localX <= cx + r.width &&
            localY >= cy &&
            localY <= cy + r.height
          ) {
            targetEl = child;
            break;
          }
        } else {
          const idx = Math.min(
            interactiveChildren.length - 1,
            Math.floor((1 - v) * interactiveChildren.length),
          );
          targetEl = interactiveChildren[Math.max(0, idx)];
          break;
        }
      }
    }

    if (typeof targetEl.click === 'function' && eventType === 'click') {
      targetEl.click();
    } else if (
      typeof targetEl.dispatchEvent === 'function' &&
      typeof Event !== 'undefined'
    ) {
      targetEl.dispatchEvent(new Event(eventType, {bubbles: true}));
    }

    if (eventType !== 'pointermove') {
      entry.dirty = true;
    }
    return targetEl;
  }

  private deleteEntryGpuResources(
    entry: SpatialSlotEntry,
    gl?: WebGL2RenderingContext | null,
  ): void {
    entry.observer?.disconnect();
    entry.observer = null;
    entry.canvas = null;
    if (!gl) return;
    const prim = entry.meshGpu?.primitives?.[0];
    if (!prim) return;
    if (prim.texture && typeof gl.deleteTexture === 'function') {
      gl.deleteTexture(prim.texture);
      prim.texture = null;
    }
    if (Array.isArray(prim.buffers) && typeof gl.deleteBuffer === 'function') {
      for (const buf of prim.buffers) {
        if (buf) gl.deleteBuffer(buf);
      }
      prim.buffers = [];
    }
    if (prim.vao && typeof gl.deleteVertexArray === 'function') {
      gl.deleteVertexArray(prim.vao);
      prim.vao = null;
    }
  }

  public dispose(gl?: WebGL2RenderingContext | null): void {
    for (const entry of this.entries) {
      this.deleteEntryGpuResources(entry, gl);
    }
    this.entries = [];
  }
}
