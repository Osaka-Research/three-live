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
 * @fileoverview `synth-audio` plugin for `xr-live-sim`.
 *
 * Plays short procedural cues (oscillators, noise, and filters; no audio
 * files) for sim events, mapped per node by the `audioCues` trait:
 * `onTap`, `onObjective`, `onHit`, `onDepleted`, `onZoneEnter`, `onZoneExit`,
 * `onSpawn`, `onJump`, and `onLand`. An `alarm` zone-enter cue repeats while
 * the zone stays occupied. Out-of-order objectives play `error`, and the
 * scenario end plays `pass` or `fail`.
 *
 * Host attributes: `synth-audio` (`''` on, `muted` off) and `synth-volume`
 * (`0`-`1`, default `0.7`). Audio starts after the first pointer or key press
 * on the element, as browsers require.
 */

import type {
  AudioCue,
  AudioCueEvent,
} from '../../../three-live/src/xr-sim-schema';
import {clampNum} from '../../../three-live/src/xr-trait-schema';
import {
  bodyCenter,
  registerSimSystem,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';

/** One oscillator or noise voice of a cue. */
export interface CueVoice {
  readonly wave: 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise';
  /** Start frequency (Hz); filter cutoff for noise voices. */
  readonly f0: number;
  /** End frequency (Hz) for sweeps. */
  readonly f1?: number;
  /** Offset from the cue start (s). */
  readonly at: number;
  readonly dur: number;
  readonly gain: number;
  /** Filter applied to noise voices. */
  readonly filter?: 'lowpass' | 'bandpass' | 'highpass';
}

const tone = (
  wave: CueVoice['wave'],
  f0: number,
  at: number,
  dur: number,
  gain = 0.3,
  f1?: number,
  filter?: CueVoice['filter'],
): CueVoice => ({wave, f0, f1, at, dur, gain, filter});

const seq = (
  wave: CueVoice['wave'],
  freqs: number[],
  step: number,
  gain = 0.25,
): CueVoice[] => freqs.map((f, i) => tone(wave, f, i * step, step, gain));

/** Synthesis recipe per cue (shared with the Android and iOS runtimes). */
export const CUE_RECIPES: Readonly<Record<AudioCue, readonly CueVoice[]>> = {
  confirm: seq('sine', [660, 880], 0.08, 0.3),
  error: seq('square', [330, 247], 0.09, 0.18),
  alarm: [
    tone('square', 880, 0, 0.25, 0.18),
    tone('square', 660, 0.25, 0.25, 0.18),
  ],
  warning: [tone('triangle', 520, 0, 0.2, 0.35)],
  pickup: [
    tone('square', 987.77, 0, 0.06, 0.2),
    tone('square', 1318.51, 0.06, 0.22, 0.2),
  ],
  jump: [tone('triangle', 180, 0, 0.14, 0.35, 520)],
  beam: [tone('sawtooth', 880, 0, 0.11, 0.2, 110)],
  impact: [
    tone('noise', 1200, 0, 0.09, 0.4, undefined, 'bandpass'),
    tone('triangle', 120, 0, 0.09, 0.4, 45),
  ],
  burst: [tone('noise', 2000, 0, 0.45, 0.5, 200, 'lowpass')],
  powerup: seq('square', [523.25, 659.25, 783.99, 1046.5], 0.07, 0.2),
  step: [tone('noise', 2500, 0, 0.04, 0.25, undefined, 'bandpass')],
  pass: seq('triangle', [523.25, 659.25, 783.99, 1046.5], 0.1, 0.3),
  fail: seq('sine', [392, 311.13, 261.63], 0.133, 0.3),
};

/** Interval between repeats of a zone `alarm` cue (ms). */
export const ALARM_REPEAT_MS = 500;

interface AudioState {
  ctx: AudioContext | null;
  master: GainNode | null;
  noise: AudioBuffer | null;
  readonly unsubs: Array<() => void>;
  /** Occupant count and next repeat time for zones with an alarm cue. */
  readonly alarms: Map<SimBody, {count: number; nextMs: number}>;
}

const STATE_KEY = 'synth-audio';

function enabled(world: SimWorld): boolean {
  const a = world.attr('synth-audio');
  return a !== null && a.trim().toLowerCase() !== 'muted' && a !== 'false';
}

function unlock(world: SimWorld, st: AudioState): void {
  if (st.ctx) {
    if (st.ctx.state === 'suspended') st.ctx.resume().catch(() => {});
    return;
  }
  // tslint:disable-next-line:no-any Prefixed constructor on older Safari.
  const g = globalThis as any;
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx: AudioContext = new Ctor();
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    st.ctx = ctx;
    st.master = master;
    st.noise = noise;
  } catch {
    // Audio unavailable (autoplay policy, sandbox); cues stay silent.
  }
}

/** Stereo pan (`-1`..`1`) and distance gain for a scene-local source. */
export function spatialize(
  world: SimWorld,
  pos: readonly number[],
): {pan: number; gain: number} {
  const head = world.headPosition();
  const f = world.cameraForwardXZ();
  const rel = [pos[0] - head[0], pos[1] - head[1], pos[2] - head[2]];
  const d = Math.hypot(rel[0], rel[1], rel[2]);
  const right = [-f[2], 0, f[0]];
  const pan = d > 1e-6 ? (rel[0] * right[0] + rel[2] * right[2]) / d : 0;
  return {
    pan: Math.max(-1, Math.min(1, pan)),
    gain: 1 / (1 + Math.max(0, d - 1) * 0.5),
  };
}

/** Schedules `cue` now. Returns false when audio is not yet unlocked. */
export function playCue(
  world: SimWorld,
  cue: AudioCue,
  source: SimBody | null = null,
): boolean {
  const st = world.state.get(STATE_KEY) as AudioState | undefined;
  const ctx = st?.ctx;
  if (!st || !ctx || !st.master || !enabled(world)) return false;
  const opts = source?.traits.audioCues;
  const jitter = opts?.pitchJitter ?? 0;
  const pitch = 1 + (Math.random() * 2 - 1) * jitter;
  let gain = opts?.volume ?? 1;
  let out: AudioNode = st.master;
  if (source && opts?.spatial !== false) {
    const s = spatialize(world, bodyCenter(source));
    gain *= s.gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = s.pan;
      p.connect(st.master);
      out = p;
    }
  }
  st.master.gain.value = clampNum(world.numAttr('synth-volume'), 0, 1, 0.7);
  const now = ctx.currentTime + 0.01;
  for (const v of CUE_RECIPES[cue] ?? []) {
    const t0 = now + v.at;
    const t1 = t0 + v.dur;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.linearRampToValueAtTime(
      Math.max(0.0001, v.gain * gain),
      t0 + 0.005,
    );
    env.gain.exponentialRampToValueAtTime(0.0001, t1);
    env.connect(out);
    let src: AudioScheduledSourceNode;
    if (v.wave === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = st.noise;
      const f = ctx.createBiquadFilter();
      f.type = v.filter ?? 'lowpass';
      f.frequency.setValueAtTime(v.f0 * pitch, t0);
      if (v.f1) f.frequency.exponentialRampToValueAtTime(v.f1 * pitch, t1);
      n.connect(f);
      f.connect(env);
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = v.wave;
      o.frequency.setValueAtTime(v.f0 * pitch, t0);
      if (v.f1) o.frequency.exponentialRampToValueAtTime(v.f1 * pitch, t1);
      o.connect(env);
      src = o;
    }
    src.start(t0);
    src.stop(t1 + 0.02);
  }
  return true;
}

function cueFor(
  b: SimBody | undefined,
  ev: AudioCueEvent,
): AudioCue | undefined {
  return b?.traits.audioCues?.cues[ev];
}

function stateOf(world: SimWorld): AudioState {
  let st = world.state.get(STATE_KEY) as AudioState | undefined;
  if (st) return st;
  const s: AudioState = {
    ctx: null,
    master: null,
    noise: null,
    unsubs: [],
    alarms: new Map(),
  };
  world.state.set(STATE_KEY, s);
  const el = world.element;
  if (typeof el?.addEventListener === 'function') {
    const onGesture = () => unlock(world, s);
    for (const type of ['pointerdown', 'keydown']) {
      el.addEventListener(type, onGesture);
      s.unsubs.push(() => el.removeEventListener(type, onGesture));
    }
  }
  const map = (name: string, ev: AudioCueEvent, useOther = false) =>
    s.unsubs.push(
      world.on(name, (_d, refs) => {
        const b = useOther ? refs.other : refs.body;
        const cue = cueFor(b, ev);
        if (cue) playCue(world, cue, b ?? null);
      }),
    );
  map('xrhit', 'onHit');
  map('xrdepleted', 'onDepleted');
  map('xrspawn', 'onSpawn');
  map('characterjump', 'onJump');
  map('characterland', 'onLand');
  map('xrzoneexit', 'onZoneExit');
  s.unsubs.push(
    world.on('xrzoneenter', (_d, refs) => {
      const z = refs.body;
      const cue = cueFor(z, 'onZoneEnter');
      if (!z || !cue) return;
      if (cue === 'alarm') {
        const a = s.alarms.get(z) ?? {count: 0, nextMs: world.timeMs};
        a.count++;
        s.alarms.set(z, a);
      } else {
        playCue(world, cue, z);
      }
    }),
    world.on('xrzoneexit', (_d, refs) => {
      const a = refs.body ? s.alarms.get(refs.body) : undefined;
      if (a && --a.count <= 0) s.alarms.delete(refs.body!);
    }),
    world.on('xrobjective', (d, refs) => {
      if (d['outOfOrder']) playCue(world, 'error', refs.body ?? null);
      else {
        const cue = cueFor(refs.body, 'onObjective');
        if (cue) playCue(world, cue, refs.body ?? null);
      }
    }),
    world.on('xrscenarioend', (d) => {
      playCue(world, d['outcome'] === 'pass' ? 'pass' : 'fail');
    }),
  );
  return s;
}

/** `SimSystem` wiring sim events to procedural cues. */
export const synthAudioSystem: SimSystem = {
  name: 'synth-audio',
  priority: 50,
  step(world: SimWorld): void {
    if (!enabled(world)) return;
    const st = stateOf(world);
    for (const [z, a] of st.alarms) {
      if (z.hidden || !world.bodies.includes(z)) {
        st.alarms.delete(z);
      } else if (world.timeMs >= a.nextMs) {
        a.nextMs = world.timeMs + ALARM_REPEAT_MS;
        playCue(world, 'alarm', z);
      }
    }
  },
  select(world: SimWorld, body: SimBody | null): boolean {
    if (!enabled(world)) return false;
    const st = stateOf(world);
    unlock(world, st);
    const cue = cueFor(body ?? undefined, 'onTap');
    if (cue) playCue(world, cue, body);
    return false;
  },
  reset(world: SimWorld): void {
    (world.state.get(STATE_KEY) as AudioState | undefined)?.alarms.clear();
  },
  dispose(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as AudioState | undefined;
    if (!st) return;
    for (const u of st.unsubs) u();
    st.ctx?.close().catch(() => {});
    world.state.delete(STATE_KEY);
  },
};

registerSimSystem(synthAudioSystem);
