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
 * @fileoverview In-Browser WebXR Augmented Reality Plugin Suite for three-live.
 * Implements:
 * - Feature 2.1: WebXR DOM Overlay (`dom-overlay` + `beforexrselect` event shielding)
 * - Feature 2.2: Plane Detection (`hit-test`), Procedural Floor Ring Reticle,
 *                Tap-to-Place, 1-Finger Floor Drag, and 2-Finger Y-Axis Rotation
 * - Feature 2.3: Real-World Environmental Lighting Estimation (`light-estimation` probe
 *                syncing directional sun vector + 9-band Spherical Harmonics `uSH[9]`)
 */

import type {ThreeLivePlugin} from '../plugin';
import {mat4Create, mat3NormalFromMat4} from '../math';
import {setEnvironmentSH} from './envmap';

interface XRPluginState {
  initialized: boolean;
  hitTestSource: any | null;
  lightProbe: any | null;
  reticleMesh: any | null;
  lastHitMatrix: Float32Array | null;
  hasPlaced: boolean;
  rotationY: number;
  isDragging: boolean;
  lastTouchAngle: number | null;
}

const sessionStates = new WeakMap<object, XRPluginState>();

function createReticleMeshGpu(gl: WebGL2RenderingContext): any {
  const segments = 32;
  const innerR = 0.12;
  const outerR = 0.15;
  const positions = new Float32Array(segments * 2 * 3);
  const normals = new Float32Array(segments * 2 * 3);
  const uvs = new Float32Array(segments * 2 * 2);
  const indices = new Uint16Array(segments * 6);

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);

    const idx0 = i * 2;
    const idx1 = i * 2 + 1;

    positions[idx0 * 3] = cos * innerR;
    positions[idx0 * 3 + 1] = 0.002;
    positions[idx0 * 3 + 2] = sin * innerR;

    positions[idx1 * 3] = cos * outerR;
    positions[idx1 * 3 + 1] = 0.002;
    positions[idx1 * 3 + 2] = sin * outerR;

    normals[idx0 * 3 + 1] = 1.0;
    normals[idx1 * 3 + 1] = 1.0;

    const next0 = ((i + 1) % segments) * 2;
    const next1 = next0 + 1;

    const baseIdx = i * 6;
    indices[baseIdx] = idx0;
    indices[baseIdx + 1] = next0;
    indices[baseIdx + 2] = idx1;
    indices[baseIdx + 3] = idx1;
    indices[baseIdx + 4] = next0;
    indices[baseIdx + 5] = next1;
  }

  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

  const normBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
  gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);

  const transform = mat4Create();
  const normalMatrix = new Float32Array(9);
  normalMatrix[0] = 1;
  normalMatrix[4] = 1;
  normalMatrix[8] = 1;

  return {
    name: '__xr_reticle__',
    nodeIndex: -1,
    visible: false,
    transform,
    normalMatrix,
    primitives: [
      {
        vao,
        indexCount: indices.length,
        indexType: gl.UNSIGNED_SHORT,
        baseColor: [1.0, 1.0, 1.0, 0.95] as [number, number, number, number],
        metallic: 0.0,
        roughness: 0.2,
        positions,
        indices,
        texture: null,
        metallicRoughnessTexture: null,
        normalTexture: null,
        occlusionTexture: null,
        normalScale: 1.0,
        occlusionStrength: 1.0,
        buffers: [posBuf, normBuf, uvBuf, idxBuf],
      },
    ],
  };
}

function applyRootPlacement(
  outMatrix: Float32Array,
  hitMatrix: Float32Array,
  rotationY: number,
): void {
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);
  outMatrix.set(hitMatrix);
  // Rotate around local Y axis while preserving hit world position (indices 12, 13, 14)
  outMatrix[0] = cos;
  outMatrix[1] = 0;
  outMatrix[2] = -sin;
  outMatrix[4] = 0;
  outMatrix[5] = 1;
  outMatrix[6] = 0;
  outMatrix[8] = sin;
  outMatrix[9] = 0;
  outMatrix[10] = cos;
}

export const webxrPlugin: ThreeLivePlugin = {
  name: 'webxr-suite',

  onConfigureXRSessionInit(element: any, sessionInit: XRSessionInit): void {
    const optional = new Set<string>(sessionInit.optionalFeatures || []);
    optional.add('hit-test');
    optional.add('light-estimation');
    optional.add('dom-overlay');
    sessionInit.optionalFeatures = Array.from(optional);

    const overlayRoot =
      element?.querySelector?.('[slot="ar-overlay"]') || element;

    if (overlayRoot) {
      (sessionInit as any).domOverlay = {root: overlayRoot};
      overlayRoot.addEventListener('beforexrselect', (e: Event) => {
        e.preventDefault();
      });
    }
  },

  onXRFrame(
    view: any,
    session: any,
    frame: any,
    refSpace: any,
  ): void {
    if (!view || !session || !frame || !refSpace) return;

    let state = sessionStates.get(session);
    if (!state) {
      state = {
        initialized: true,
        hitTestSource: null,
        lightProbe: null,
        reticleMesh: createReticleMeshGpu(view.gl),
        lastHitMatrix: null,
        hasPlaced: false,
        rotationY: 0,
        isDragging: false,
        lastTouchAngle: null,
      };
      sessionStates.set(session, state);
      view.meshes.push(state.reticleMesh);

      // 1. Request viewer-space hit-test source
      if (typeof session.requestReferenceSpace === 'function') {
        session
          .requestReferenceSpace('viewer')
          .then((viewerSpace: any) => {
            if (typeof session.requestHitTestSource === 'function') {
              return session.requestHitTestSource({space: viewerSpace});
            }
            return null;
          })
          .then((source: any) => {
            if (state && source) state.hitTestSource = source;
          })
          .catch(() => {});
      }

      // 2. Request real-world environmental light probe
      if (typeof session.requestLightProbe === 'function') {
        session
          .requestLightProbe()
          .then((probe: any) => {
            if (state && probe) state.lightProbe = probe;
          })
          .catch(() => {});
      }

      // 3. Tap-to-place via WebXR select event
      const onSelect = () => {
        if (state && state.lastHitMatrix) {
          state.hasPlaced = true;
          applyRootPlacement(
            view.modelRootMatrix,
            state.lastHitMatrix,
            state.rotationY,
          );
        }
      };
      session.addEventListener('select', onSelect);

      // 4. Touch gestures for 1-finger drag & 2-finger twist rotation
      const onTouchStart = (e: TouchEvent) => {
        if (!state) return;
        if (e.touches.length === 1 && state.hasPlaced) {
          state.isDragging = true;
        } else if (e.touches.length === 2) {
          state.isDragging = false;
          const dx = e.touches[1].clientX - e.touches[0].clientX;
          const dy = e.touches[1].clientY - e.touches[0].clientY;
          state.lastTouchAngle = Math.atan2(dy, dx);
        }
      };
      const onTouchMove = (e: TouchEvent) => {
        if (!state) return;
        if (e.touches.length === 1 && state.isDragging && state.lastHitMatrix) {
          applyRootPlacement(
            view.modelRootMatrix,
            state.lastHitMatrix,
            state.rotationY,
          );
        } else if (e.touches.length === 2 && state.lastTouchAngle !== null) {
          const dx = e.touches[1].clientX - e.touches[0].clientX;
          const dy = e.touches[1].clientY - e.touches[0].clientY;
          const angle = Math.atan2(dy, dx);
          state.rotationY += angle - state.lastTouchAngle;
          state.lastTouchAngle = angle;
          if (state.lastHitMatrix) {
            applyRootPlacement(
              view.modelRootMatrix,
              state.lastHitMatrix,
              state.rotationY,
            );
          }
        }
      };
      const onTouchEnd = () => {
        if (!state) return;
        state.isDragging = false;
        state.lastTouchAngle = null;
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('touchstart', onTouchStart, {passive: true});
        window.addEventListener('touchmove', onTouchMove, {passive: true});
        window.addEventListener('touchend', onTouchEnd, {passive: true});
      }

      // Cleanup on session end
      session.addEventListener('end', () => {
        if (state?.reticleMesh) {
          const idx = view.meshes.indexOf(state.reticleMesh);
          if (idx !== -1) view.meshes.splice(idx, 1);
        }
        view.modelRootMatrix = mat4Create();
        if (typeof window !== 'undefined') {
          window.removeEventListener('touchstart', onTouchStart);
          window.removeEventListener('touchmove', onTouchMove);
          window.removeEventListener('touchend', onTouchEnd);
        }
      });
    }

    // Evaluate Hit-Test & Floor Reticle
    if (state.hitTestSource && typeof frame.getHitTestResults === 'function') {
      const results = frame.getHitTestResults(state.hitTestSource);
      if (results && results.length > 0) {
        const pose = results[0].getPose(refSpace);
        if (pose?.transform?.matrix) {
          const hitMat = pose.transform.matrix as Float32Array;
          state.lastHitMatrix = hitMat;
          state.reticleMesh.visible = !state.hasPlaced || state.isDragging;
          state.reticleMesh.transform.set(hitMat);
          mat3NormalFromMat4(
            state.reticleMesh.normalMatrix,
            state.reticleMesh.transform,
          );
          if (!state.hasPlaced) {
            applyRootPlacement(view.modelRootMatrix, hitMat, state.rotationY);
          }
        }
      } else {
        state.reticleMesh.visible = false;
      }
    }

    // Evaluate Real-World Lighting Estimation
    if (state.lightProbe && typeof frame.getLightEstimate === 'function') {
      const estimate = frame.getLightEstimate(state.lightProbe);
      if (estimate) {
        const dir = estimate.primaryLightDirection;
        const intensity = estimate.primaryLightIntensity;
        if (dir && intensity && Array.isArray(view.lights)) {
          let dirLight = view.lights.find((l: any) => l.type === 'directional');
          if (!dirLight) {
            dirLight = {
              type: 'directional',
              direction: [0.5, 1.0, 0.8],
              color: [1, 1, 1],
              intensity: 1.0,
            };
            view.lights.push(dirLight);
          }
          dirLight.direction = [dir.x, dir.y, dir.z];
          const maxChannel = Math.max(intensity.x, intensity.y, intensity.z, 0.001);
          dirLight.color = [
            intensity.x / maxChannel,
            intensity.y / maxChannel,
            intensity.z / maxChannel,
          ];
          dirLight.intensity = maxChannel;
        }
        if (estimate.sphericalHarmonicsCoefficients) {
          setEnvironmentSH(view.gl, estimate.sphericalHarmonicsCoefficients);
        }
      }
    }
  },
};
