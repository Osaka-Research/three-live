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
 * @fileoverview 3D Interactive Hotspot & Annotation Plugin for three-live.
 * Projects HTML elements with slot="hotspot-*" onto 3D screen space with occlusion culling.
 */

import type {ThreeLivePlugin} from '../plugin';

const observers = new WeakMap<HTMLElement, MutationObserver>();

export function updateHotspotsForElement(
  element: HTMLElement,
  viewer?: any,
): void {
  const v = viewer || (element as any).viewer;
  if (!v || typeof v.projectPointToScreen !== 'function') return;

  const hotspots =
    (element as any).mockHotspots ||
    element.querySelectorAll<HTMLElement>(
      '[slot^="hotspot-"], [data-position]',
    );
  for (let i = 0; i < hotspots.length; i++) {
    const el = hotspots[i];
    const posStr = el.getAttribute('data-position');
    if (!posStr) continue;

    const posParts = posStr
      .trim()
      .split(/\s+/)
      .map((s) => parseFloat(s.replace(/m$/, '')));
    if (posParts.length < 3 || posParts.some(isNaN)) continue;

    const normStr = el.getAttribute('data-normal');
    let normal: [number, number, number] | undefined;
    if (normStr) {
      const normParts = normStr
        .trim()
        .split(/\s+/)
        .map((s) => parseFloat(s));
      if (normParts.length >= 3 && !normParts.some(isNaN)) {
        normal = [normParts[0], normParts[1], normParts[2]];
      }
    }

    const projected = v.projectPointToScreen(
      [posParts[0], posParts[1], posParts[2]],
      normal,
    );

    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.transform = `translate(-50%, -50%) translate3d(${projected.x}px, ${projected.y}px, 0)`;
    el.style.zIndex = '3';

    if (projected.visible) {
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      el.removeAttribute('data-occluded');
    } else {
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.setAttribute('data-occluded', '');
    }
  }
}

export const hotspotPlugin: ThreeLivePlugin & {
  updateHotspotsForElement?: typeof updateHotspotsForElement;
} = {
  name: 'hotspots',
  updateHotspotsForElement,

  onElementConnected(element: any): void {
    if (typeof MutationObserver === 'undefined' || !element) return;
    const observer = new MutationObserver(() => {
      updateHotspotsForElement(element);
    });
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-position', 'data-normal'],
    });
    observers.set(element, observer);
  },

  onCameraChange(viewer: ThreeView, element?: any): void {
    if (element) {
      updateHotspotsForElement(element, viewer);
    }
  },

  onElementDisconnected(element: any): void {
    const observer = observers.get(element);
    if (observer) {
      observer.disconnect();
      observers.delete(element);
    }
  },
};
