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
 * @fileoverview `objectives` plugin for `xr-live-sim`.
 *
 * Tracks `objective` nodes (pickups, checkpoints, keys, time bonuses, and
 * integrity restores), score, attempts, and an optional countdown, and ends
 * the scenario with `pass`, `fail`, or `timeout`. Objectives complete when the
 * controlled character (or, in XR, the user) comes within `radius`, or on tap
 * when no character is active. Ordered objectives (`order > 0`) only count in
 * ascending order.
 *
 * Host attributes: `objectives` (`none` disables), `scenario-timer` (seconds),
 * `target-score`, `attempts`, and `sim-hud` (`auto` | `minimal` | `none`).
 *
 * Events: `xrobjective`, `xrscorechange`, and `xrscenarioend`.
 */

import {clampNum} from '../../../three-live/src/xr-trait-schema';
import {
  bodyCenter,
  registerSimSystem,
  type SimBody,
  type SimSystem,
  type SimWorld,
} from './core';

/** Scenario outcome. */
export type ScenarioStatus = 'running' | 'pass' | 'fail' | 'timeout';

/** Minimum time between out-of-order rejections per objective (ms). */
export const OBJECTIVE_REJECT_COOLDOWN_MS = 1000;

interface ObjectivesState {
  score: number;
  attemptsLeft: number;
  timerMs: number;
  elapsedMs: number;
  targetScore: number;
  status: ScenarioStatus;
  readonly done: Set<SimBody>;
  readonly respawnAt: Map<SimBody, number>;
  readonly unsubs: Array<() => void>;
  hud: HTMLElement | null;
  hudText: string;
}

const STATE_KEY = 'objectives';

function enabled(world: SimWorld): boolean {
  const a = world.attr('objectives');
  if (a === 'none' || a === 'false') return false;
  return (
    a !== null ||
    world.attr('target-score') !== null ||
    world.attr('scenario-timer') !== null ||
    world.attr('attempts') !== null ||
    world.bodies.some((b) => b.traits.objective)
  );
}

function stateOf(world: SimWorld): ObjectivesState {
  let st = world.state.get(STATE_KEY) as ObjectivesState | undefined;
  if (st) return st;
  const attempts = world.numAttr('attempts');
  st = {
    score: 0,
    attemptsLeft:
      attempts === undefined
        ? Infinity
        : Math.round(clampNum(attempts, 1, 1e6, 1)),
    timerMs: clampNum(world.numAttr('scenario-timer'), 0, 86400, 0) * 1000,
    elapsedMs: 0,
    targetScore: clampNum(world.numAttr('target-score'), 0, 1e9, 0),
    status: 'running',
    done: new Set(),
    respawnAt: new Map(),
    unsubs: [],
    hud: null,
    hudText: '',
  };
  world.state.set(STATE_KEY, st);
  const s = st;
  st.unsubs.push(
    world.on('xrdepleted', (d, refs) => {
      const v = Number(d['scoreValue']);
      if (Number.isFinite(v) && v !== 0) addScore(world, s, v);
      if (refs.body && refs.body === world.character) loseAttempt(world, s);
    }),
    world.on('agentreach', (_d, refs) => {
      const ch = world.character;
      if (ch && refs.other === ch && !ch.traits.integrity)
        loseAttempt(world, s);
    }),
  );
  return st;
}

function emitScore(world: SimWorld, st: ObjectivesState, delta: number): void {
  world.emit('xrscorechange', {
    score: st.score,
    delta,
    attemptsLeft: Number.isFinite(st.attemptsLeft) ? st.attemptsLeft : null,
    timeRemaining:
      st.timerMs > 0
        ? Math.max(0, Math.round((st.timerMs - st.elapsedMs) / 100) / 10)
        : null,
  });
}

function addScore(world: SimWorld, st: ObjectivesState, delta: number): void {
  if (st.status !== 'running') return;
  st.score += delta;
  emitScore(world, st, delta);
}

function endScenario(
  world: SimWorld,
  st: ObjectivesState,
  outcome: Exclude<ScenarioStatus, 'running'>,
): void {
  if (st.status !== 'running') return;
  st.status = outcome;
  world.ended = true;
  world.emit('xrscenarioend', {
    outcome,
    finalScore: st.score,
    elapsedSec: Math.round(st.elapsedMs / 100) / 10,
  });
}

function loseAttempt(world: SimWorld, st: ObjectivesState): void {
  if (st.status !== 'running') return;
  st.attemptsLeft -= 1;
  emitScore(world, st, 0);
  if (st.attemptsLeft <= 0) {
    endScenario(world, st, 'fail');
    return;
  }
  const ch = world.character;
  if (ch) {
    ch.pos = [...ch.initPos];
    ch.vel = [0, 0, 0];
    ch.yaw = 0;
    ch.hidden = false;
    ch.integrity = ch.traits.integrity?.max ?? 0;
  }
}

function requiredRemaining(world: SimWorld, st: ObjectivesState): number {
  return world
    .active()
    .filter((b) => b.traits.objective?.required && !st.done.has(b)).length;
}

/** Lowest `order` among incomplete ordered objectives, or `0`. */
export function nextObjectiveOrder(
  world: SimWorld,
  done: ReadonlySet<SimBody>,
): number {
  let next = 0;
  for (const b of world.active()) {
    const o = b.traits.objective?.order ?? 0;
    if (o > 0 && !done.has(b) && (next === 0 || o < next)) next = o;
  }
  return next;
}

/** Attempts to complete objective `b`. Returns true when it completed. */
export function completeObjective(world: SimWorld, b: SimBody): boolean {
  const opts = b.traits.objective;
  if (!opts || b.hidden || b.isTemplate || world.ended) return false;
  const st = stateOf(world);
  if (st.status !== 'running') return false;
  if (opts.order > 0 && opts.order !== nextObjectiveOrder(world, st.done)) {
    const last = (b.data['objRejectMs'] as number | undefined) ?? -Infinity;
    if (world.timeMs - last >= OBJECTIVE_REJECT_COOLDOWN_MS) {
      b.data['objRejectMs'] = world.timeMs;
      world.emit(
        'xrobjective',
        {
          nodeId: b.name,
          tag: opts.tag,
          type: opts.type,
          amount: 0,
          totalScore: st.score,
          remainingRequired: requiredRemaining(world, st),
          outOfOrder: true,
        },
        {body: b},
      );
    }
    return false;
  }
  let scoreDelta = 0;
  if (opts.type === 'time-bonus') {
    if (st.timerMs > 0) st.timerMs += opts.amount * 1000;
  } else if (opts.type === 'restore') {
    const ch = world.character;
    const max = ch?.traits.integrity?.max;
    if (ch && max !== undefined) {
      ch.integrity = Math.max(0, Math.min(max, ch.integrity + opts.amount));
    }
  } else {
    scoreDelta = opts.amount;
  }
  st.done.add(b);
  b.hidden = true;
  if (opts.respawnSec > 0)
    st.respawnAt.set(b, world.timeMs + opts.respawnSec * 1000);
  st.score += scoreDelta;
  world.emit(
    'xrobjective',
    {
      nodeId: b.name,
      tag: opts.tag,
      type: opts.type,
      amount: opts.amount,
      totalScore: st.score,
      remainingRequired: requiredRemaining(world, st),
      outOfOrder: false,
    },
    {body: b},
  );
  if (scoreDelta !== 0) emitScore(world, st, scoreDelta);
  return true;
}

function checkPass(world: SimWorld, st: ObjectivesState): void {
  const objs = world.active().filter((b) => b.traits.objective);
  const required = objs.filter((b) => b.traits.objective!.required);
  if (required.length > 0 && required.every((b) => st.done.has(b))) {
    endScenario(world, st, 'pass');
  } else if (st.targetScore > 0 && st.score >= st.targetScore) {
    endScenario(world, st, 'pass');
  } else if (required.length === 0 && st.targetScore === 0) {
    const oneShot = objs.filter((b) => b.traits.objective!.respawnSec === 0);
    if (oneShot.length > 0 && oneShot.every((b) => st.done.has(b))) {
      endScenario(world, st, 'pass');
    }
  }
}

function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** HUD text for the current state (`''` hides the HUD). */
export function objectivesHudText(
  world: SimWorld,
  mode: 'auto' | 'minimal',
): string {
  const st = world.state.get(STATE_KEY) as ObjectivesState | undefined;
  if (!st) return '';
  const parts = [mode === 'auto' ? `Score ${st.score}` : String(st.score)];
  if (st.timerMs > 0) parts.push(formatClock(st.timerMs - st.elapsedMs));
  if (mode === 'auto' && Number.isFinite(st.attemptsLeft)) {
    parts.push(`Attempts ${st.attemptsLeft}`);
  }
  if (st.status !== 'running') {
    parts.push(
      st.status === 'pass' ? 'Pass' : st.status === 'fail' ? 'Fail' : 'Time',
    );
  }
  return parts.join(' · ');
}

function syncHud(world: SimWorld, st: ObjectivesState): void {
  const raw = world.attr('sim-hud')?.trim().toLowerCase();
  const mode =
    raw === 'minimal' || raw === 'auto'
      ? raw
      : raw === undefined && world.attr('objectives') !== null
        ? 'auto'
        : null;
  if (!mode) {
    st.hud?.remove();
    st.hud = null;
    return;
  }
  const el = world.element;
  if (!st.hud && typeof document !== 'undefined' && el?.appendChild) {
    const d = document.createElement('div');
    d.setAttribute('part', 'sim-hud');
    d.setAttribute('role', 'status');
    d.setAttribute('aria-live', 'polite');
    d.style.cssText =
      'position:absolute;top:12px;left:12px;z-index:5;padding:6px 12px;' +
      'border-radius:999px;background:rgba(15,23,42,.6);color:#fff;' +
      'font:600 14px/1.4 system-ui,sans-serif;pointer-events:none;' +
      'backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);';
    try {
      if (getComputedStyle(el).position === 'static')
        el.style.position = 'relative';
    } catch {
      // Non-element hosts.
    }
    el.appendChild(d);
    st.hud = d;
    st.hudText = '';
  }
  const text = objectivesHudText(world, mode);
  if (st.hud && text !== st.hudText) {
    st.hud.textContent = text;
    st.hudText = text;
  }
}

/** `SimSystem` for objectives, scoring, attempts, and the scenario timer. */
export const objectivesSystem: SimSystem = {
  name: 'objectives',
  priority: 40,
  step(world: SimWorld, dt: number): void {
    if (!enabled(world)) return;
    const st = stateOf(world);
    if (st.status !== 'running') return;
    st.elapsedMs += dt * 1000;
    const t = world.timeMs / 1000;
    for (const [b, at] of st.respawnAt) {
      if (world.timeMs >= at) {
        st.respawnAt.delete(b);
        b.hidden = false;
      }
    }
    const collectors = [];
    const ch = world.character;
    if (ch && !ch.hidden) collectors.push(bodyCenter(ch));
    if (world.xrActive) collectors.push(world.headPosition());
    for (const b of world.active()) {
      const o = b.traits.objective;
      if (!o || b.hidden) continue;
      if (o.spinSpeed !== 0) b.yaw = (b.yaw + o.spinSpeed * dt) % (Math.PI * 2);
      if (o.bobAmplitude > 0) {
        b.pos = [
          b.pos[0],
          b.initPos[1] + o.bobAmplitude * Math.sin(t * 2.4),
          b.pos[2],
        ];
      }
      const c = bodyCenter(b);
      for (const p of collectors) {
        if (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) <= o.radius) {
          completeObjective(world, b);
          break;
        }
      }
    }
    if (st.timerMs > 0 && st.elapsedMs >= st.timerMs) {
      endScenario(world, st, 'timeout');
      return;
    }
    checkPass(world, st);
  },
  sync(world: SimWorld): void {
    if (!enabled(world)) return;
    syncHud(world, stateOf(world));
  },
  select(world: SimWorld, body: SimBody | null): boolean {
    if (!body?.traits.objective || world.character || !enabled(world)) {
      return false;
    }
    return completeObjective(world, body);
  },
  reset(world: SimWorld): void {
    const st = world.state.get(STATE_KEY) as ObjectivesState | undefined;
    if (!st) return;
    for (const u of st.unsubs) u();
    st.hud?.remove();
    world.state.delete(STATE_KEY);
  },
  dispose(world: SimWorld): void {
    objectivesSystem.reset!(world);
  },
};

/** Current score, attempts, and status (for hosts and tests). */
export function getScenarioState(world: SimWorld): {
  score: number;
  attemptsLeft: number;
  status: ScenarioStatus;
  timeRemainingSec: number | null;
} | null {
  const st = world.state.get(STATE_KEY) as ObjectivesState | undefined;
  return st
    ? {
        score: st.score,
        attemptsLeft: st.attemptsLeft,
        status: st.status,
        timeRemainingSec:
          st.timerMs > 0
            ? Math.max(0, (st.timerMs - st.elapsedMs) / 1000)
            : null,
      }
    : null;
}

registerSimSystem(objectivesSystem);
