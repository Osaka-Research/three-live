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
 */

/**
 * @fileoverview 3D Positional & Directional Spatial Audio plugin for `<xr-live>`
 * (`userData.xr.audioEmitter` / `userData.xr.spatialAudio` / `KHR_audio_emitter`).
 *
 * Provides:
 * - 8 zero-asset procedural ambient loop presets (`hum`, `reactor`, `wind`,
 *   `beacon`, `geiger`, `chimeLoop`, `machinery`, `water`) plus 13 one-shot
 *   procedural cues synthesized as phase-locked, click-free 16-bit PCM.
 * - Real-time 3D distance attenuation (`inverse`, `linear`, `exponential`),
 *   directional cone attenuation (`coneInnerAngle`, `coneOuterAngle`,
 *   `coneOuterGain`), and constant-power stereo panning driven by the XR
 *   head/camera pose and mesh world transforms.
 * - Optional URL-backed audio streaming (`safeMediaUrl` validated) and
 *   `playOnSelect` tap/pinch triggering (`xraudioplay` custom event).
 */

import {
  ThreeLivePlugin,
  ThreeLiveViewer,
  type MeshHit,
} from '../../../three-live/src/plugin';
import {
  AMBIENT_SOUND_PRESETS,
  ONE_SHOT_AUDIO_PRESETS,
  asRecord,
  clampNum,
  computeSpatialAudioMix,
  parseAudioEmitter,
  safeMediaUrl,
  type AmbientSoundPreset,
  type AudioDistanceModel,
  type AudioEmitterOptions,
  type AudioPresetName,
  type SpatialAudioMix,
} from '../../../three-live/src/xr-trait-schema';
import {meshWorldMatrix, resolveHeadPose} from './common';

function userXR(mesh: unknown): Record<string, unknown> | null {
  const rec = asRecord(mesh);
  return (
    asRecord(asRecord(rec?.['userData'])?.['xr']) ??
    asRecord(asRecord(rec?.['extras'])?.['xr'])
  );
}

export {
  AMBIENT_SOUND_PRESETS,
  ONE_SHOT_AUDIO_PRESETS,
  computeSpatialAudioMix,
  parseAudioEmitter,
  type AmbientSoundPreset,
  type AudioDistanceModel,
  type AudioEmitterOptions,
  type AudioPresetName,
  type SpatialAudioMix,
};

const TWO_PI = Math.PI * 2;

/**
 * Synthesizes a deterministic, phase-locked 16-bit mono PCM buffer for any
 * built-in ambient loop preset (`hum`, `reactor`, `wind`, `beacon`, `geiger`,
 * `chimeLoop`, `machinery`, `water`) or one-shot cue.
 *
 * Frequencies are quantized to integer cycle counts over `durationSec` and
 * smoothed across the loop boundary so looping playback is click-free.
 */
export function renderAmbientLoopPcm(
  preset: AudioPresetName,
  sampleRate = 22050,
  durationSec = 2,
): Int16Array {
  const sr = clampNum(sampleRate, 8000, 48000, 22050);
  const dur = clampNum(durationSec, 0.25, 10, 2);
  const n = Math.max(64, Math.round(sr * dur));
  const out = new Int16Array(n);
  // Quantizes `hz` to an exact integer number of cycles over `dur` seconds.
  const cyc = (hz: number): number =>
    (TWO_PI * Math.max(1, Math.round(hz * dur))) / n;

  for (let i = 0; i < n; i++) {
    const u = i / n; // [0, 1) normalized loop phase
    let s = 0;

    switch (preset) {
      case 'hum': {
        const w1 = cyc(60);
        const w2 = cyc(120);
        const w3 = cyc(180);
        const lfo = 0.85 + 0.15 * Math.cos((TWO_PI * i) / n);
        s =
          lfo *
          (0.6 * Math.sin(w1 * i) +
            0.28 * Math.sin(w2 * i) +
            0.12 * Math.sin(w3 * i));
        break;
      }
      case 'reactor': {
        const wA = cyc(55);
        const wB = cyc(56.5);
        const wC = cyc(110);
        const wD = cyc(220);
        const pulse = 0.75 + 0.25 * Math.cos(2 * TWO_PI * u);
        s =
          pulse *
          (0.42 * Math.sin(wA * i) +
            0.38 * Math.sin(wB * i) +
            0.14 * Math.sin(wC * i) +
            0.06 * Math.sin(wD * i));
        break;
      }
      case 'wind': {
        const gust =
          0.55 + 0.3 * Math.cos(TWO_PI * u) + 0.15 * Math.sin(2 * TWO_PI * u);
        let sum = 0;
        for (let k = 1; k <= 12; k++) {
          const freq = 140 + k * 47 + (k % 3) * 19;
          const phase = k * 1.37;
          sum += Math.sin(cyc(freq) * i + phase) / (1 + k * 0.25);
        }
        s = gust * sum * 0.32;
        break;
      }
      case 'beacon': {
        // Two sonar pings per 2-second loop with smooth periodic envelope.
        const pingPhase = (u * 2) % 1;
        const env = Math.sin(Math.PI * pingPhase) * Math.exp(-5.5 * pingPhase);
        s =
          env *
          (0.75 * Math.sin(cyc(880) * i) + 0.25 * Math.sin(cyc(1760) * i));
        break;
      }
      case 'geiger': {
        // Deterministic periodic grain clicks across the loop.
        const clickSlots = [
          0.05, 0.14, 0.19, 0.33, 0.47, 0.52, 0.68, 0.81, 0.91,
        ];
        let acc = 0;
        for (let c = 0; c < clickSlots.length; c++) {
          let d = u - clickSlots[c];
          if (d < 0) d += 1;
          const dtSec = d * dur;
          if (dtSec >= 0 && dtSec < 0.018) {
            const env =
              Math.sin((Math.PI * dtSec) / 0.018) * Math.exp(-180 * dtSec);
            acc += env * Math.sin(cyc(2200 + c * 130) * i);
          }
        }
        s = acc * 0.85 + 0.04 * Math.sin(cyc(60) * i);
        break;
      }
      case 'chimeLoop': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        const slot = Math.floor(u * notes.length) % notes.length;
        const localU = (u * notes.length) % 1;
        const env = Math.sin(Math.PI * localU) * Math.exp(-3.2 * localU);
        const f = notes[slot];
        s =
          env *
          (0.68 * Math.sin(cyc(f) * i) +
            0.22 * Math.sin(cyc(f * 2) * i) +
            0.1 * Math.sin(cyc(f * 3) * i));
        break;
      }
      case 'machinery': {
        const chug = 0.62 + 0.38 * Math.cos(8 * TWO_PI * u);
        s =
          chug *
          (0.48 * Math.sin(cyc(36) * i) +
            0.3 * Math.sin(cyc(72) * i) +
            0.14 * Math.sin(cyc(144) * i) +
            0.08 * Math.sin(cyc(360) * i));
        break;
      }
      case 'water': {
        let drops = 0;
        for (let k = 0; k < 6; k++) {
          let d = u - k / 6;
          if (d < 0) d += 1;
          const local = d * 6;
          if (local < 1) {
            const env = Math.sin(Math.PI * local) * Math.exp(-3.0 * local);
            const f = 420 + k * 75;
            drops +=
              env * Math.sin(cyc(f) * i + 1.5 * Math.sin(cyc(f * 0.5) * i));
          }
        }
        const stream =
          0.18 * Math.sin(cyc(190) * i) + 0.12 * Math.sin(cyc(310) * i);
        s = 0.55 * drops + stream;
        break;
      }
      default: {
        // One-shot cues rendered with smooth fade-in and exponential decay.
        const env = Math.sin(Math.PI * u) * Math.exp(-4.0 * u);
        const baseHz =
          preset === 'error' || preset === 'fail'
            ? 220
            : preset === 'alarm' || preset === 'warning'
              ? 660
              : preset === 'pickup' || preset === 'powerup' || preset === 'pass'
                ? 880
                : 520;
        s =
          env *
          (0.7 * Math.sin(cyc(baseHz) * i) +
            0.3 * Math.sin(cyc(baseHz * 1.5) * i));
        break;
      }
    }

    // Clamp to [-0.95, 0.95] and convert to signed 16-bit PCM.
    const clamped = Math.max(-0.95, Math.min(0.95, s));
    out[i] = Math.round(clamped * 32767);
  }

  // Cross-fade the final 16 samples toward sample 0 to guarantee a zero-step
  // seam even when numerical rounding occurs.
  const fadeLen = Math.min(16, Math.floor(n / 4));
  const startVal = out[0];
  for (let k = 0; k < fadeLen; k++) {
    const idx = n - fadeLen + k;
    const alpha = (k + 1) / (fadeLen + 1);
    out[idx] = Math.round(out[idx] * (1 - alpha) + startVal * alpha);
  }
  return out;
}

/** Live runtime state for a single spatial audio emitter node. */
export interface XRSpatialAudioEmitterState {
  readonly meshIndex: number;
  nodeName: string;
  options: AudioEmitterOptions;
  playing: boolean;
  triggerCount: number;
  lastMix: SpatialAudioMix;
}

interface WebAudioEmitterGraph {
  // tslint:disable-next-line:no-any Web Audio nodes across browser engines.
  source?: any;
  // tslint:disable-next-line:no-any Web Audio nodes across browser engines.
  gainNode?: any;
  // tslint:disable-next-line:no-any Web Audio nodes across browser engines.
  panNode?: any;
  // tslint:disable-next-line:no-any Web Audio nodes across browser engines.
  mediaEl?: any;
}

/**
 * Per-viewer controller managing 3D positional/directional audio emitters.
 * Works both headlessly (computing exact per-frame {@link SpatialAudioMix}
 * state for tests and telemetry) and with Web Audio (`AudioContext`) when
 * running in a browser after user gesture unlock.
 */
export class XRSpatialAudioEmitterController {
  private readonly emitters = new Map<number, XRSpatialAudioEmitterState>();
  private readonly audioGraphs = new Map<number, WebAudioEmitterGraph>();
  private readonly pcmCache = new Map<string, Int16Array>();
  // tslint:disable-next-line:no-any Browser AudioContext.
  private ctx: any = null;
  // tslint:disable-next-line:no-any Browser GainNode.
  private masterGain: any = null;
  private muted = false;

  /** Returns all discovered emitters keyed by `viewer.meshes` index. */
  getEmitters(): ReadonlyMap<number, XRSpatialAudioEmitterState> {
    return this.emitters;
  }

  /** Returns the latest evaluated {@link SpatialAudioMix} for a mesh index or node name. */
  getMix(meshIndexOrName: number | string): SpatialAudioMix | null {
    const state = this.resolveState(meshIndexOrName);
    return state ? state.lastMix : null;
  }

  /** Returns the full emitter state for a mesh index or node name. */
  getState(
    meshIndexOrName: number | string,
  ): XRSpatialAudioEmitterState | null {
    return this.resolveState(meshIndexOrName);
  }

  /** Mutes or unmutes all spatial audio emitters on this viewer. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain?.gain) {
      this.masterGain.gain.value = muted ? 0 : 1;
    }
  }

  /** Returns whether this controller is currently muted. */
  isMuted(): boolean {
    return this.muted;
  }

  /**
   * Synchronizes emitter definitions from `viewer.meshes` (`userData.xr.audioEmitter`,
   * `userData.xr.spatialAudio`, `userData.xr.audio`, or `KHR_audio_emitter`).
   */
  syncFromViewer(viewer: ThreeLiveViewer): void {
    const seen = new Set<number>();
    const khrByMesh = this.extractKhrAudioByMesh(viewer);

    for (let i = 0; i < viewer.meshes.length; i++) {
      const m = viewer.meshes[i];
      const xr = userXR(m);
      const rawTrait =
        xr?.['audioEmitter'] ?? xr?.['spatialAudio'] ?? xr?.['audio'];
      const parsed = parseAudioEmitter(rawTrait) ?? khrByMesh.get(i) ?? null;
      if (!parsed) continue;
      seen.add(i);
      const nodeName = m.name || `Mesh_${i}`;
      const existing = this.emitters.get(i);
      if (existing) {
        existing.nodeName = nodeName;
        existing.options = parsed;
      } else {
        const initialMix = computeSpatialAudioMix(
          [0, 1.6, 0],
          [0, 0, -1],
          [1, 0, 0],
          [0, 0, 0],
          [0, 0, 1],
          parsed,
        );
        this.emitters.set(i, {
          meshIndex: i,
          nodeName,
          options: parsed,
          playing: parsed.autoplay,
          triggerCount: parsed.autoplay ? 1 : 0,
          lastMix: initialMix,
        });
      }
    }

    for (const idx of Array.from(this.emitters.keys())) {
      if (!seen.has(idx)) {
        this.stopGraph(idx);
        this.emitters.delete(idx);
      }
    }
  }

  /**
   * Evaluates 3D distance, cone attenuation, and stereo pan for every active
   * emitter against the current listener head/camera pose.
   */
  update(viewer: ThreeLiveViewer, _dt: number): void {
    this.syncFromViewer(viewer);
    if (this.emitters.size === 0) return;

    const head = resolveHeadPose(viewer);
    const cam = viewer.camera as
      | {position?: number[]; target?: number[]}
      | undefined;
    const lPos: readonly [number, number, number] =
      Array.isArray(cam?.position) && cam.position.length >= 3
        ? [cam.position[0], cam.position[1], cam.position[2]]
        : head.position;
    let lFwd: readonly [number, number, number];
    let lRight: readonly [number, number, number];
    if (
      Array.isArray(cam?.position) &&
      cam.position.length >= 3 &&
      Array.isArray(cam?.target) &&
      cam.target.length >= 3
    ) {
      const dx = cam.target[0] - cam.position[0];
      const dy = cam.target[1] - cam.position[1];
      const dz = cam.target[2] - cam.position[2];
      const dLen = Math.hypot(dx, dy, dz) || 1;
      lFwd = [dx / dLen, dy / dLen, dz / dLen];
      const rx = -lFwd[2];
      const rz = lFwd[0];
      const rLen = Math.hypot(rx, rz);
      lRight = rLen > 1e-5 ? [rx / rLen, 0, rz / rLen] : [1, 0, 0];
    } else if (head.matrix && head.matrix.length === 16) {
      const m = head.matrix;
      const fx = -m[8];
      const fy = -m[9];
      const fz = -m[10];
      const fLen = Math.hypot(fx, fy, fz) || 1;
      lFwd = [fx / fLen, fy / fLen, fz / fLen];
      const rx = m[0];
      const ry = m[1];
      const rz = m[2];
      const rLen = Math.hypot(rx, ry, rz) || 1;
      lRight = [rx / rLen, ry / rLen, rz / rLen];
    } else {
      lFwd = [0, 0, -1];
      lRight = [1, 0, 0];
    }

    for (const [idx, state] of this.emitters.entries()) {
      const mesh = viewer.meshes[idx];
      if (!mesh) continue;
      const mat = meshWorldMatrix(viewer, mesh);
      const ePos: readonly [number, number, number] = [
        mat[12],
        mat[13],
        mat[14],
      ];
      // Mesh +Z column ([mat[8], mat[9], mat[10]]) faces the camera at identity rotation.
      const fx = mat[8];
      const fy = mat[9];
      const fz = mat[10];
      const fLen = Math.hypot(fx, fy, fz) || 1;
      const eFwd: readonly [number, number, number] = [
        fx / fLen,
        fy / fLen,
        fz / fLen,
      ];

      const mix = computeSpatialAudioMix(
        lPos,
        lFwd,
        lRight,
        ePos,
        eFwd,
        state.options,
      );
      state.lastMix =
        state.playing && !this.muted
          ? mix
          : {
              ...mix,
              gain: 0,
              leftGain: 0,
              rightGain: 0,
            };

      this.syncWebAudioNode(idx, state);
    }
  }

  /**
   * Triggers or retriggers an emitter (used by `playOnSelect` and programmatic
   * calls) and dispatches an `xraudioplay` custom event on `viewer.container`.
   */
  trigger(
    viewer: ThreeLiveViewer,
    meshIndexOrName: number | string,
  ): SpatialAudioMix | null {
    this.syncFromViewer(viewer);
    const state = this.resolveState(meshIndexOrName);
    if (!state) return null;
    state.playing = true;
    state.triggerCount++;
    this.update(viewer, 0);
    this.restartWebAudioSource(state.meshIndex, state);

    const container = viewer.container;
    if (
      container &&
      typeof container.dispatchEvent === 'function' &&
      typeof CustomEvent === 'function'
    ) {
      container.dispatchEvent(
        new CustomEvent('xraudioplay', {
          bubbles: true,
          composed: true,
          detail: {
            node: state.nodeName,
            meshIndex: state.meshIndex,
            preset: state.options.preset ?? null,
            src: state.options.src ?? null,
            gain: state.lastMix.gain,
            pan: state.lastMix.pan,
            triggerCount: state.triggerCount,
          },
        }),
      );
    }
    return state.lastMix;
  }

  /** Releases all Web Audio nodes and clears emitter state. */
  dispose(): void {
    for (const idx of Array.from(this.audioGraphs.keys())) {
      this.stopGraph(idx);
    }
    this.emitters.clear();
    if (this.ctx && typeof this.ctx.close === 'function') {
      try {
        void this.ctx.close();
      } catch {
        // Ignore close errors in headless environments.
      }
    }
    this.ctx = null;
    this.masterGain = null;
  }

  private resolveState(
    meshIndexOrName: number | string,
  ): XRSpatialAudioEmitterState | null {
    if (typeof meshIndexOrName === 'number') {
      return this.emitters.get(meshIndexOrName) ?? null;
    }
    for (const state of this.emitters.values()) {
      if (state.nodeName === meshIndexOrName) return state;
    }
    return null;
  }

  private extractKhrAudioByMesh(
    viewer: ThreeLiveViewer,
  ): Map<number, AudioEmitterOptions> {
    const result = new Map<number, AudioEmitterOptions>();
    const gltf = asRecord(viewer.lastGltf);
    if (!gltf) return result;
    const extRoot = asRecord(
      asRecord(gltf['extensions'])?.['KHR_audio_emitter'],
    );
    if (!extRoot) return result;
    const emitters = Array.isArray(extRoot['emitters'])
      ? extRoot['emitters']
      : [];
    const sources = Array.isArray(extRoot['sources']) ? extRoot['sources'] : [];
    const clips = Array.isArray(extRoot['audio']) ? extRoot['audio'] : [];
    const nodes = Array.isArray(gltf['nodes']) ? gltf['nodes'] : [];

    for (const n of nodes) {
      const nodeRec = asRecord(n);
      if (!nodeRec || typeof nodeRec['mesh'] !== 'number') continue;
      const khrNode = asRecord(
        asRecord(nodeRec['extensions'])?.['KHR_audio_emitter'],
      );
      const emitterIdx = khrNode?.['emitter'];
      if (typeof emitterIdx !== 'number') continue;
      const emitterDef = asRecord(emitters[emitterIdx]);
      if (!emitterDef) continue;
      const srcIndices = Array.isArray(emitterDef['sources'])
        ? emitterDef['sources']
        : [];
      const firstSource =
        typeof srcIndices[0] === 'number'
          ? asRecord(sources[srcIndices[0]])
          : null;
      const clipIdx = firstSource?.['audio'];
      const clipDef =
        typeof clipIdx === 'number' ? asRecord(clips[clipIdx]) : null;
      const extras = asRecord(firstSource?.['extras']);
      const pos = asRecord(emitterDef['positional']);
      const parsed = parseAudioEmitter({
        preset: extras?.['preset'],
        pitch: extras?.['pitch'],
        src: safeMediaUrl(clipDef?.['uri']),
        type: emitterDef['type'],
        volume: emitterDef['gain'] ?? firstSource?.['gain'],
        loop: firstSource?.['loop'],
        autoplay: firstSource?.['autoPlay'],
        distanceModel: pos?.['distanceModel'],
        refDistance: pos?.['refDistance'],
        maxDistance: pos?.['maxDistance'],
        rolloffFactor: pos?.['rolloffFactor'],
        coneInnerAngle:
          typeof pos?.['coneInnerAngle'] === 'number'
            ? (pos['coneInnerAngle'] * 180) / Math.PI
            : undefined,
        coneOuterAngle:
          typeof pos?.['coneOuterAngle'] === 'number'
            ? (pos['coneOuterAngle'] * 180) / Math.PI
            : undefined,
        coneOuterGain: pos?.['coneOuterGain'],
      });
      if (parsed) {
        result.set(nodeRec['mesh'], parsed);
      }
    }
    return result;
  }

  private ensureAudioContext(): boolean {
    if (this.ctx) return true;
    if (typeof window === 'undefined') return false;
    // tslint:disable-next-line:no-any Browser AudioContext constructor.
    const w = window as any;
    const Ctor = w.AudioContext || w.webkitAudioContext;
    if (typeof Ctor !== 'function') return false;
    try {
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  private syncWebAudioNode(
    idx: number,
    state: XRSpatialAudioEmitterState,
  ): void {
    if (!state.playing) {
      this.stopGraph(idx);
      return;
    }
    if (!this.ensureAudioContext() || !this.ctx) return;
    let graph = this.audioGraphs.get(idx);
    if (!graph) {
      graph = this.createGraph(state);
      if (graph) {
        this.audioGraphs.set(idx, graph);
      }
    }
    if (graph?.gainNode?.gain) {
      graph.gainNode.gain.value = state.lastMix.gain;
    }
    if (graph?.panNode?.pan) {
      graph.panNode.pan.value = state.lastMix.pan;
    }
    if (graph?.source && 'loop' in graph.source) {
      graph.source.loop = state.options.loop;
      if (graph.source.playbackRate) {
        graph.source.playbackRate.value = state.options.pitch;
      }
    }
    if (graph?.mediaEl) {
      graph.mediaEl.loop = state.options.loop;
      graph.mediaEl.playbackRate = state.options.pitch;
    }
  }

  private restartWebAudioSource(
    idx: number,
    state: XRSpatialAudioEmitterState,
  ): void {
    this.stopGraph(idx);
    this.syncWebAudioNode(idx, state);
  }

  private createGraph(
    state: XRSpatialAudioEmitterState,
  ): WebAudioEmitterGraph | null {
    if (!this.ctx || !this.masterGain) return null;
    try {
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = state.lastMix.gain;
      const panNode =
        typeof this.ctx.createStereoPanner === 'function'
          ? this.ctx.createStereoPanner()
          : null;
      if (panNode) {
        panNode.pan.value = state.lastMix.pan;
        gainNode.connect(panNode);
        panNode.connect(this.masterGain);
      } else {
        gainNode.connect(this.masterGain);
      }

      if (state.options.preset) {
        const key = state.options.preset;
        let pcm = this.pcmCache.get(key);
        if (!pcm) {
          pcm = renderAmbientLoopPcm(state.options.preset, 22050, 2);
          this.pcmCache.set(key, pcm);
        }
        const buf = this.ctx.createBuffer(1, pcm.length, 22050);
        const chan = buf.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) {
          chan[i] = pcm[i] / 32768;
        }
        const source = this.ctx.createBufferSource();
        source.buffer = buf;
        source.loop = state.options.loop;
        if (source.playbackRate) {
          source.playbackRate.value = state.options.pitch;
        }
        source.connect(gainNode);
        source.start(0);
        return {source, gainNode, panNode};
      }
      if (
        state.options.src &&
        typeof Audio === 'function' &&
        typeof this.ctx.createMediaElementSource === 'function'
      ) {
        const mediaEl = new Audio(state.options.src);
        mediaEl.crossOrigin = 'anonymous';
        mediaEl.loop = state.options.loop;
        mediaEl.playbackRate = state.options.pitch;
        const source = this.ctx.createMediaElementSource(mediaEl);
        source.connect(gainNode);
        void mediaEl.play?.().catch?.(() => {});
        return {source, gainNode, panNode, mediaEl};
      }
      return {gainNode, panNode};
    } catch {
      return null;
    }
  }

  private stopGraph(idx: number): void {
    const graph = this.audioGraphs.get(idx);
    if (!graph) return;
    this.audioGraphs.delete(idx);
    try {
      graph.mediaEl?.pause?.();
      graph.source?.stop?.();
      graph.source?.disconnect?.();
      graph.gainNode?.disconnect?.();
      graph.panNode?.disconnect?.();
    } catch {
      // Ignore cleanup errors.
    }
  }
}

const controllers = new WeakMap<
  ThreeLiveViewer,
  XRSpatialAudioEmitterController
>();

/** Returns (or lazily creates) the {@link XRSpatialAudioEmitterController} for `viewer`. */
export function getSpatialAudioController(
  viewer: ThreeLiveViewer,
): XRSpatialAudioEmitterController {
  let ctrl = controllers.get(viewer);
  if (!ctrl) {
    ctrl = new XRSpatialAudioEmitterController();
    controllers.set(viewer, ctrl);
  }
  return ctrl;
}

/**
 * `<xr-live>` plugin providing 3D positional & directional spatial audio
 * (`userData.xr.audioEmitter` / `userData.xr.spatialAudio` / `KHR_audio_emitter`).
 */
export const spatialAudioPlugin: ThreeLivePlugin = {
  name: 'xr-live-spatial-audio',
  onSceneLoaded(viewer: ThreeLiveViewer): void {
    const ctrl = getSpatialAudioController(viewer);
    ctrl.update(viewer, 0);
  },
  onUpdate(viewer: ThreeLiveViewer, dt: number): void {
    const ctrl = getSpatialAudioController(viewer);
    ctrl.update(viewer, dt);
  },
  onMeshSelect(viewer: ThreeLiveViewer, hit: MeshHit): void {
    const ctrl = getSpatialAudioController(viewer);
    ctrl.syncFromViewer(viewer);
    const state = ctrl.getState(hit.meshIndex);
    if (state && (state.options.playOnSelect || !state.options.autoplay)) {
      ctrl.trigger(viewer, hit.meshIndex);
    }
  },
  onDispose(viewer: ThreeLiveViewer): void {
    const ctrl = controllers.get(viewer);
    if (ctrl) {
      ctrl.dispose();
      controllers.delete(viewer);
    }
  },
};
