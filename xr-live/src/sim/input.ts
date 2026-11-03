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
 * @fileoverview Keyboard, gamepad, and touch input for `xr-live-sim`.
 *
 * Keyboard input is read only while the host element has focus (it becomes
 * focusable and takes focus on pointer down), so the page keeps scrolling and
 * text fields keep working. A touch joystick and buttons are added on touch
 * devices when the character controller or firing is active.
 */

import type {SimWorld} from './core';

/** Gamepad stick dead zone. */
export const GAMEPAD_DEADZONE = 0.15;
/** Touch joystick travel radius in CSS pixels. */
export const JOYSTICK_RADIUS_PX = 40;

const AXIS_KEYS: Readonly<Record<string, [number, number]>> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

interface InputRuntime {
  // tslint:disable-next-line:no-any Host element.
  readonly el: any;
  readonly keys: Set<string>;
  readonly joy: {x: number; z: number};
  readonly cleanup: Array<() => void>;
  overlay: HTMLElement | null;
  jumpButton: HTMLElement | null;
  fireButton: HTMLElement | null;
  padJump: boolean;
  padFire: boolean;
}

const STATE_KEY = 'input';

function isTypingTarget(t: unknown): boolean {
  const el = t as {tagName?: string; isContentEditable?: boolean} | null;
  const tag = el?.tagName?.toUpperCase();
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    el?.isContentEditable === true
  );
}

/** True on devices with a touch screen. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return 'ontouchstart' in window || (nav?.maxTouchPoints ?? 0) > 0;
}

function listen(
  rt: InputRuntime,
  target: EventTarget,
  type: string,
  fn: (e: Event) => void,
  opts?: AddEventListenerOptions,
): void {
  target.addEventListener(type, fn, opts);
  rt.cleanup.push(() => target.removeEventListener(type, fn, opts));
}

function attachKeyboard(world: SimWorld, rt: InputRuntime): void {
  const el = rt.el;
  if (typeof el?.addEventListener !== 'function') return;
  if (typeof el.hasAttribute === 'function' && !el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '0');
  }
  listen(rt, el, 'keydown', (e) => {
    const k = e as KeyboardEvent;
    if (isTypingTarget(k.target) || k.ctrlKey || k.metaKey || k.altKey) return;
    let handled = true;
    if (AXIS_KEYS[k.code]) rt.keys.add(k.code);
    else if (k.code === 'Space') {
      if (!k.repeat) world.input.jumpQueued = true;
    } else if (k.code === 'KeyF' || k.code === 'Enter') {
      if (!k.repeat) world.input.fireQueued = true;
    } else if (k.code === 'ShiftLeft' || k.code === 'ShiftRight') {
      rt.keys.add('Shift');
    } else handled = false;
    if (handled) k.preventDefault();
  });
  listen(rt, el, 'keyup', (e) => {
    const k = e as KeyboardEvent;
    rt.keys.delete(k.code);
    if (k.code === 'ShiftLeft' || k.code === 'ShiftRight') {
      rt.keys.delete('Shift');
    }
  });
  listen(rt, el, 'blur', () => rt.keys.clear());
  listen(rt, el, 'pointerdown', () => {
    try {
      el.focus?.({preventScroll: true});
    } catch {
      // Older engines don't accept focus options.
    }
  });
}

function makeDiv(css: string): HTMLDivElement {
  const d = document.createElement('div');
  d.style.cssText = css;
  return d;
}

function makeButton(
  label: string,
  glyph: string,
  bottomPx: number,
): HTMLElement {
  const b = makeDiv(
    `position:absolute;right:24px;bottom:${bottomPx}px;width:64px;height:64px;` +
      'border-radius:50%;background:rgba(15,23,42,.45);' +
      'border:2px solid rgba(255,255,255,.6);color:#fff;font:600 22px/60px ' +
      'system-ui,sans-serif;text-align:center;pointer-events:auto;' +
      'touch-action:none;',
  );
  b.setAttribute('role', 'button');
  b.setAttribute('aria-label', label);
  b.textContent = glyph;
  return b;
}

function attachOverlay(world: SimWorld, rt: InputRuntime): void {
  const el = rt.el;
  if (
    typeof document === 'undefined' ||
    typeof el?.appendChild !== 'function'
  ) {
    return;
  }
  try {
    if (getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
  } catch {
    // Detached or non-element hosts.
  }
  const root = makeDiv(
    'position:absolute;inset:0;pointer-events:none;z-index:5;' +
      'user-select:none;-webkit-user-select:none;',
  );
  root.setAttribute('part', 'sim-controls');
  const base = makeDiv(
    'position:absolute;left:24px;bottom:24px;width:112px;height:112px;' +
      'border-radius:50%;background:rgba(15,23,42,.35);' +
      'border:2px solid rgba(255,255,255,.5);pointer-events:auto;' +
      'touch-action:none;',
  );
  base.setAttribute('aria-label', 'Movement joystick');
  const knob = makeDiv(
    'position:absolute;left:32px;top:32px;width:48px;height:48px;' +
      'border-radius:50%;background:rgba(255,255,255,.75);',
  );
  base.appendChild(knob);
  let pointerId: number | null = null;
  const move = (e: PointerEvent) => {
    const r = base.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2);
    let dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > JOYSTICK_RADIUS_PX) {
      dx = (dx / len) * JOYSTICK_RADIUS_PX;
      dy = (dy / len) * JOYSTICK_RADIUS_PX;
    }
    rt.joy.x = dx / JOYSTICK_RADIUS_PX;
    rt.joy.z = -dy / JOYSTICK_RADIUS_PX;
    knob.style.transform = `translate(${dx}px,${dy}px)`;
  };
  const end = () => {
    pointerId = null;
    rt.joy.x = 0;
    rt.joy.z = 0;
    knob.style.transform = '';
  };
  listen(rt, base, 'pointerdown', (e) => {
    const p = e as PointerEvent;
    pointerId = p.pointerId;
    base.setPointerCapture?.(p.pointerId);
    move(p);
    p.preventDefault();
    p.stopPropagation();
  });
  listen(rt, base, 'pointermove', (e) => {
    const p = e as PointerEvent;
    if (p.pointerId === pointerId) move(p);
  });
  listen(rt, base, 'pointerup', end);
  listen(rt, base, 'pointercancel', end);
  const jump = makeButton('Jump', '▲', 24);
  const fire = makeButton('Fire', '●', 100);
  const press = (btn: HTMLElement, onPress: () => void) =>
    listen(rt, btn, 'pointerdown', (e) => {
      onPress();
      e.preventDefault();
      e.stopPropagation();
    });
  press(jump, () => (world.input.jumpQueued = true));
  press(fire, () => (world.input.fireQueued = true));
  root.append(base, jump, fire);
  el.appendChild(root);
  rt.overlay = root;
  rt.jumpButton = jump;
  rt.fireButton = fire;
  rt.cleanup.push(() => root.remove());
}

/**
 * Attaches input for `world` (idempotent) and shows or hides the touch
 * controls. `joystick` covers the stick and jump button; `fire` the fire
 * button.
 */
export function ensureSimInput(
  world: SimWorld,
  joystick: boolean,
  fire: boolean,
): void {
  let rt = world.state.get(STATE_KEY) as InputRuntime | undefined;
  if (!rt) {
    rt = {
      el: world.element,
      keys: new Set(),
      joy: {x: 0, z: 0},
      cleanup: [],
      overlay: null,
      jumpButton: null,
      fireButton: null,
      padJump: false,
      padFire: false,
    };
    world.state.set(STATE_KEY, rt);
    attachKeyboard(world, rt);
  }
  if ((joystick || fire) && !rt.overlay) attachOverlay(world, rt);
  if (rt.overlay) {
    const show = (node: HTMLElement | null, on: boolean) => {
      if (node) node.style.display = on ? '' : 'none';
    };
    show(rt.overlay.firstElementChild as HTMLElement | null, joystick);
    show(rt.jumpButton, joystick);
    show(rt.fireButton, fire);
    if (!joystick) {
      rt.joy.x = 0;
      rt.joy.z = 0;
    }
  }
}

/** Applies a stick dead zone, rescaling the remaining range to `[0, 1]`. */
export function applyDeadzone(v: number, dz = GAMEPAD_DEADZONE): number {
  if (!Number.isFinite(v) || Math.abs(v) <= dz) return 0;
  return (Math.sign(v) * (Math.abs(v) - dz)) / (1 - dz);
}

/** Merges keyboard, touch, and gamepad state into `world.input`. */
export function updateSimInput(world: SimWorld): void {
  const rt = world.state.get(STATE_KEY) as InputRuntime | undefined;
  let x = 0;
  let z = 0;
  let sprint = false;
  if (rt) {
    for (const code of rt.keys) {
      const a = AXIS_KEYS[code];
      if (a) {
        x += a[0];
        z += a[1];
      }
    }
    sprint = rt.keys.has('Shift');
    x += rt.joy.x;
    z += rt.joy.z;
    // tslint:disable-next-line:no-any Gamepad API may be missing.
    const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
    let pads: ArrayLike<Gamepad | null> = [];
    try {
      pads = nav?.getGamepads?.() ?? [];
    } catch {
      // Blocked by permissions policy.
    }
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p?.connected) continue;
      x += applyDeadzone(p.axes[0] ?? 0);
      z -= applyDeadzone(p.axes[1] ?? 0);
      const pressed = (n: number) => Boolean(p.buttons[n]?.pressed);
      sprint = sprint || pressed(4) || pressed(10);
      const jump = pressed(0);
      const fire = pressed(7) || pressed(2);
      if (jump && !rt.padJump) world.input.jumpQueued = true;
      if (fire && !rt.padFire) world.input.fireQueued = true;
      rt.padJump = jump;
      rt.padFire = fire;
      break;
    }
  }
  const len = Math.hypot(x, z);
  if (len > 1) {
    x /= len;
    z /= len;
  }
  world.input.x = x;
  world.input.z = z;
  world.input.sprint = sprint;
}

/** Removes listeners and touch controls for `world`. */
export function disposeSimInput(world: SimWorld): void {
  const rt = world.state.get(STATE_KEY) as InputRuntime | undefined;
  if (!rt) return;
  for (const fn of rt.cleanup) {
    try {
      fn();
    } catch {
      // Best effort.
    }
  }
  world.state.delete(STATE_KEY);
}
