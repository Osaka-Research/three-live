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
 * @fileoverview Phase 2.3: Zero-WASM 25-Joint Hand Gesture Classifier.
 * Replaces 2.0 MB MediaPipe/LiteRT WASM with a pure geometric classifier operating
 * directly on the 25 3D joint positions provided by WebXR's `XRHand` API.
 */

import {emitXREvent} from './xr-traits';

export type XRHandGestureName =
  | 'pinch'
  | 'point'
  | 'fist'
  | 'open-palm'
  | 'thumbs-up'
  | 'spread'
  | 'none';

export type XRHandJointMap = Record<string, [number, number, number]>;

export interface XRGestureResult {
  gesture: XRHandGestureName;
  confidence: number;
  curls: {
    thumb: number;
    index: number;
    middle: number;
    ring: number;
    pinky: number;
  };
}

function computeFingerCurl(
  wrist: [number, number, number],
  proximal: [number, number, number],
  tip: [number, number, number],
): number {
  const ux = proximal[0] - wrist[0];
  const uy = proximal[1] - wrist[1];
  const uz = proximal[2] - wrist[2];
  const uLen = Math.hypot(ux, uy, uz) || 1;

  const vx = tip[0] - proximal[0];
  const vy = tip[1] - proximal[1];
  const vz = tip[2] - proximal[2];
  const vLen = Math.hypot(vx, vy, vz) || 1;

  const dot = (ux * vx + uy * vy + uz * vz) / (uLen * vLen);
  // dot = 1 -> straight (curl 0), dot = -1 -> fully folded (curl 1)
  return Math.max(0, Math.min(1, (1 - dot) * 0.5));
}

function dist3(
  a: [number, number, number],
  b: [number, number, number],
): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Classifies a 25-joint `XRHand` landmark map into one of 6 canonical spatial gestures.
 */
export function classifyHandJoints(joints: XRHandJointMap): XRGestureResult {
  const wrist = joints['wrist'] || [0, 0, 0];
  const thumbProx =
    joints['thumb-phalanx-proximal'] || joints['thumb-metacarpal'] || wrist;
  const thumbTip = joints['thumb-tip'] || wrist;

  const indexProx =
    joints['index-finger-phalanx-proximal'] ||
    joints['index-finger-metacarpal'] ||
    wrist;
  const indexTip = joints['index-finger-tip'] || wrist;

  const middleProx =
    joints['middle-finger-phalanx-proximal'] ||
    joints['middle-finger-metacarpal'] ||
    wrist;
  const middleTip = joints['middle-finger-tip'] || wrist;

  const ringProx =
    joints['ring-finger-phalanx-proximal'] ||
    joints['ring-finger-metacarpal'] ||
    wrist;
  const ringTip = joints['ring-finger-tip'] || wrist;

  const pinkyProx =
    joints['pinky-finger-phalanx-proximal'] ||
    joints['pinky-finger-metacarpal'] ||
    wrist;
  const pinkyTip = joints['pinky-finger-tip'] || wrist;

  const curls = {
    thumb: computeFingerCurl(wrist, thumbProx, thumbTip),
    index: computeFingerCurl(wrist, indexProx, indexTip),
    middle: computeFingerCurl(wrist, middleProx, middleTip),
    ring: computeFingerCurl(wrist, ringProx, ringTip),
    pinky: computeFingerCurl(wrist, pinkyProx, pinkyTip),
  };

  // 1. Thumbs-Up: thumb extended upward (dy > 0.70) and 4 fingers curled (> 0.60)
  const thumbVecY = thumbTip[1] - thumbProx[1];
  const thumbLen = dist3(thumbTip, thumbProx) || 1;
  if (
    curls.thumb < 0.3 &&
    thumbVecY / thumbLen > 0.7 &&
    curls.index > 0.6 &&
    curls.middle > 0.6 &&
    curls.ring > 0.6 &&
    curls.pinky > 0.6
  ) {
    return {gesture: 'thumbs-up', confidence: 0.95, curls};
  }

  // 2. Fist: all 4 fingers curled (> 0.65) and thumb curled (> 0.5)
  if (
    curls.thumb > 0.5 &&
    curls.index > 0.65 &&
    curls.middle > 0.65 &&
    curls.ring > 0.65 &&
    curls.pinky > 0.65
  ) {
    return {gesture: 'fist', confidence: 0.92, curls};
  }

  // 3. Pinch: thumb-tip and index-finger-tip within 1.8cm
  const pinchDist = dist3(thumbTip, indexTip);
  if (pinchDist > 0 && pinchDist < 0.018) {
    return {
      gesture: 'pinch',
      confidence: Math.min(1, (0.022 - pinchDist) / 0.015),
      curls,
    };
  }

  // 4. Point: index extended (< 0.25), middle/ring/pinky curled (> 0.60)
  if (
    curls.index < 0.25 &&
    curls.middle > 0.6 &&
    curls.ring > 0.6 &&
    curls.pinky > 0.6
  ) {
    return {gesture: 'point', confidence: 0.94, curls};
  }

  // 5. Spread vs Open-Palm: all 5 digits extended (< 0.25)
  if (
    curls.thumb < 0.3 &&
    curls.index < 0.25 &&
    curls.middle < 0.25 &&
    curls.ring < 0.25 &&
    curls.pinky < 0.25
  ) {
    const spreadDist =
      (dist3(indexTip, middleTip) +
        dist3(middleTip, ringTip) +
        dist3(ringTip, pinkyTip)) /
      3;
    if (spreadDist > 0.042) {
      return {gesture: 'spread', confidence: 0.91, curls};
    }
    return {gesture: 'open-palm', confidence: 0.93, curls};
  }

  return {gesture: 'none', confidence: 0, curls};
}

export class XRHandGestureClassifier {
  private lastGestures: Record<'left' | 'right', XRHandGestureName> = {
    left: 'none',
    right: 'none',
  };

  public processXRFrame(
    element: any,
    session: any,
    frame: any,
    refSpace: any,
  ): void {
    if (
      !session ||
      !frame ||
      !refSpace ||
      typeof frame.getJointPose !== 'function'
    ) {
      return;
    }
    const sources = session.inputSources || [];
    for (const source of sources) {
      if (!source.hand) continue;
      const handSide: 'left' | 'right' =
        source.handedness === 'left' ? 'left' : 'right';
      const joints: XRHandJointMap = {};
      for (const [jointName, jointSpace] of source.hand.entries()) {
        const pose = frame.getJointPose(jointSpace, refSpace);
        if (pose?.transform?.position) {
          const p = pose.transform.position;
          joints[jointName] = [p.x, p.y, p.z];
        }
      }
      const result = classifyHandJoints(joints);
      if (
        result.gesture !== 'none' &&
        result.gesture !== this.lastGestures[handSide]
      ) {
        this.lastGestures[handSide] = result.gesture;
        emitXREvent(element, 'xr-gesture', {
          hand: handSide,
          gesture: result.gesture,
          confidence: result.confidence,
          curls: result.curls,
        });
      } else if (result.gesture === 'none') {
        this.lastGestures[handSide] = 'none';
      }
    }
  }
}
