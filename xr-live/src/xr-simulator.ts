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
 * @fileoverview Phase 1.4: Built-in Desktop XR Simulator.
 * Provides 6DoF WASD+Q/E head locomotion, mouse look, virtual controller/hand ray,
 * 1-hand grab, 2-hand pinch-scale simulation, gesture cycling (`G`), and procedural
 * floor/table/wall room planes so XR scenes work identically on desktop laptops.
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
} from '../../three-live/src/math';
import type {XRHandGestureName} from './xr-gestures';
import type {XRInputManager} from './xr-input';
import {emitXREvent, quatFromEulerYXZ, type XRPose6DoF} from './xr-traits';

export interface SimulatorRoomConfig {
  floorY: number;
  tableY: number;
  wallZ: number;
}

const GESTURE_CYCLE: XRHandGestureName[] = [
  'open-palm',
  'pinch',
  'point',
  'fist',
  'thumbs-up',
  'spread',
];

export class XRDesktopSimulator {
  public active = false;
  public headPosition: [number, number, number] = [0, 1.6, 0.5];
  public headYaw = 0;
  public headPitch = 0;
  public handOffset: [number, number, number] = [0.2, -0.25, -0.5];
  public currentGestureIndex = 0;
  public room: SimulatorRoomConfig = {
    floorY: 0,
    tableY: 0.75,
    wallZ: -2.0,
  };

  private keysDown = new Set<string>();
  private isGrabbing = false;

  public configureRoom(preset: string): void {
    if (preset === 'tabletop') {
      this.headPosition = [0, 1.25, 0.4];
      this.room = {floorY: 0, tableY: 0.75, wallZ: -1.5};
    } else if (preset === 'office') {
      this.headPosition = [0, 1.55, 0.6];
      this.room = {floorY: 0, tableY: 0.72, wallZ: -2.5};
    } else {
      this.headPosition = [0, 1.6, 0.5];
      this.room = {floorY: 0, tableY: 0.75, wallZ: -2.0};
    }
  }

  public getHeadPose(): XRPose6DoF {
    const quat = quatFromEulerYXZ(this.headPitch, this.headYaw, 0);
    const matrix = mat4Create();
    mat4FromRotationTranslationScale(
      matrix,
      quat,
      this.headPosition,
      [1, 1, 1],
    );
    return {
      position: [...this.headPosition],
      quaternion: quat,
      matrix,
    };
  }

  public getVirtualHandPose(hand: 'left' | 'right' = 'right'): XRPose6DoF {
    const sideSign = hand === 'left' ? -1 : 1;
    const cosY = Math.cos(this.headYaw);
    const sinY = Math.sin(this.headYaw);
    const ox = this.handOffset[0] * sideSign;
    const oy = this.handOffset[1];
    const oz = this.handOffset[2];

    const pos: [number, number, number] = [
      this.headPosition[0] + ox * cosY + oz * sinY,
      this.headPosition[1] + oy,
      this.headPosition[2] - ox * sinY + oz * cosY,
    ];
    const quat = quatFromEulerYXZ(this.headPitch, this.headYaw, 0);
    const matrix = mat4Create();
    mat4FromRotationTranslationScale(matrix, quat, pos, [1, 1, 1]);
    return {
      position: pos,
      quaternion: quat,
      matrix,
    };
  }

  public stepLocomotion(dt: number): XRPose6DoF {
    const speed = 2.0 * Math.max(0.001, Math.min(0.1, dt));
    const cosY = Math.cos(this.headYaw);
    const sinY = Math.sin(this.headYaw);

    if (this.keysDown.has('w') || this.keysDown.has('arrowup')) {
      this.headPosition[0] -= sinY * speed;
      this.headPosition[2] -= cosY * speed;
    }
    if (this.keysDown.has('s') || this.keysDown.has('arrowdown')) {
      this.headPosition[0] += sinY * speed;
      this.headPosition[2] += cosY * speed;
    }
    if (this.keysDown.has('a') || this.keysDown.has('arrowleft')) {
      this.headPosition[0] -= cosY * speed;
      this.headPosition[2] += sinY * speed;
    }
    if (this.keysDown.has('d') || this.keysDown.has('arrowright')) {
      this.headPosition[0] += cosY * speed;
      this.headPosition[2] -= sinY * speed;
    }
    if (this.keysDown.has('e')) {
      this.headPosition[1] += speed;
    }
    if (this.keysDown.has('q')) {
      this.headPosition[1] = Math.max(0.2, this.headPosition[1] - speed);
    }

    return this.getHeadPose();
  }

  public handleKeyDown(key: string, element?: any): XRHandGestureName | null {
    const lower = key.toLowerCase();
    this.keysDown.add(lower);
    if (lower === 'g') {
      this.currentGestureIndex =
        (this.currentGestureIndex + 1) % GESTURE_CYCLE.length;
      const gesture = GESTURE_CYCLE[this.currentGestureIndex];
      emitXREvent(element, 'xr-gesture', {
        hand: 'right',
        gesture,
        confidence: 0.99,
        wristPose: this.getVirtualHandPose('right'),
      });
      return gesture;
    }
    return null;
  }

  public handleKeyUp(key: string): void {
    this.keysDown.delete(key.toLowerCase());
  }

  public simulatePointerAction(
    type: 'start' | 'move' | 'end',
    viewer: any,
    inputManager: XRInputManager,
    origin?: [number, number, number],
    direction?: [number, number, number],
  ): void {
    const handPose = this.getVirtualHandPose('right');
    const rayOrigin = origin || handPose.position;
    const rayDir: [number, number, number] = direction || [
      -Math.sin(this.headYaw) * Math.cos(this.headPitch),
      Math.sin(this.headPitch),
      -Math.cos(this.headYaw) * Math.cos(this.headPitch),
    ];
    this.isGrabbing = type !== 'end';
    inputManager.triggerSyntheticSelect(
      type,
      'right',
      viewer,
      rayOrigin,
      rayDir,
      handPose.quaternion,
    );
  }
}
