/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Talk-to-Select confirmation chips (roadmap B2b-4). After a push-to-talk
 * selection, a small overlay lists the selected meshes (each with ×), offers the candidates
 * when the reference was ambiguous, and an Apply button when an edit is waiting for
 * confirmation. Not shown during realtime voice sessions: there, the model reads the
 * selection back.
 */

import {type AISelectionMode, getSelection, setSelection} from './ai-select';

/** What the chips show. */
export interface AISelectChipsState {
  /** A question (ambiguous reference); `candidates` are offered as buttons. */
  readonly question?: string;
  readonly candidates?: readonly string[];
  /** How a picked candidate changes the selection (default `replace`). */
  readonly mode?: AISelectionMode;
  /** The spoken reference, reported with picks. */
  readonly query?: string;
  /** An edit waiting for confirmation ("make it red"). */
  readonly pending?: string;
}

/** The element surface the chips use. */
export interface AISelectChipsElement {
  selectedMesh?: string | null;
  appendChild?(node: unknown): unknown;
  addEventListener?(type: string, fn: (e: Event) => void): void;
  removeEventListener?(type: string, fn: (e: Event) => void): void;
  getAttribute?(name: string): string | null;
  __tlChips?: {root: HTMLElement; off: () => void; state: AISelectChipsState} | null;
}

const MAX_CHIPS = 12;

/** Display form of a mesh name: `"FloorLamp_2"` → `"Floor Lamp 2"`. */
function label(name: string): string {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Whether chips are enabled on `el` (`ai-select-chips="off"` disables them). */
export function chipsEnabled(el: AISelectChipsElement): boolean {
  if (typeof document === 'undefined') return false;
  const v = (el.getAttribute?.('ai-select-chips') ?? '').toLowerCase();
  return v !== 'off' && v !== 'false';
}

function button(text: string, aria: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.setAttribute('aria-label', aria);
  Object.assign(b.style, {
    border: 'none',
    borderRadius: '14px',
    padding: '4px 10px',
    font: '13px system-ui, sans-serif',
    cursor: 'pointer',
    background: primary ? '#1a73e8' : 'rgba(255,255,255,0.92)',
    color: primary ? '#fff' : '#202124',
  });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}

/** Removes the chips overlay. */
export function hideSelectionChips(el: AISelectChipsElement): void {
  const c = el.__tlChips;
  if (!c) return;
  c.off();
  c.root.remove();
  el.__tlChips = null;
}

/**
 * Shows (or updates) the chips. `apply` runs a pending edit when the user taps Apply.
 * Returns the overlay root, or `null` when chips are disabled or there is no DOM.
 */
export function showSelectionChips(
  el: AISelectChipsElement,
  state: AISelectChipsState,
  apply?: (instruction: string) => unknown,
): HTMLElement | null {
  if (!chipsEnabled(el)) return null;
  let c = el.__tlChips;
  if (!c) {
    const root = document.createElement('div');
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('part', 'selection-chips');
    Object.assign(root.style, {
      position: 'absolute',
      left: '64px',
      bottom: '12px',
      maxWidth: 'calc(100% - 76px)',
      boxSizing: 'border-box',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '6px',
      padding: '6px 8px',
      borderRadius: '18px',
      background: 'rgba(32,33,36,0.85)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      zIndex: '10',
      font: '13px system-ui, sans-serif',
      color: '#fff',
      pointerEvents: 'auto',
    });
    const onSelect = () => {
      if (el.__tlChips && !el.__tlChips.state.question) render(el, el.__tlChips.state, apply);
    };
    el.addEventListener?.('three-live-select', onSelect);
    el.appendChild?.(root);
    c = {root, off: () => el.removeEventListener?.('three-live-select', onSelect), state};
    el.__tlChips = c;
  }
  render(el, state, apply);
  return c.root;
}

function render(
  el: AISelectChipsElement,
  state: AISelectChipsState,
  apply?: (instruction: string) => unknown,
): void {
  const c = el.__tlChips;
  if (!c) return;
  c.state = state;
  const root = c.root;
  root.replaceChildren();
  const text = (t: string) => {
    const s = document.createElement('span');
    s.textContent = t;
    root.appendChild(s);
  };
  if (state.question) {
    text(state.question);
    for (const name of (state.candidates ?? []).slice(0, MAX_CHIPS)) {
      root.appendChild(
        button(label(name), `Select ${label(name)}`, () => {
          setSelection(el, [name], {
            mode: state.mode === 'add' || state.mode === 'remove' ? state.mode : 'replace',
            source: 'tap',
            query: state.query,
          });
          render(el, {pending: state.pending}, apply);
        }),
      );
    }
  } else {
    const selected = getSelection(el);
    if (!selected.length && !state.pending) {
      hideSelectionChips(el);
      return;
    }
    text(selected.length ? 'Selected:' : 'Nothing selected');
    for (const name of selected.slice(0, MAX_CHIPS)) {
      root.appendChild(
        button(`${label(name)} ×`, `Remove ${label(name)} from the selection`, () =>
          setSelection(el, [name], {mode: 'remove', source: 'tap'}),
        ),
      );
    }
    if (selected.length > MAX_CHIPS) text(`+${selected.length - MAX_CHIPS} more`);
    if (state.pending && apply && selected.length) {
      const pending = state.pending;
      root.appendChild(
        button(`Apply: ${pending.slice(0, 40)}`, `Apply: ${pending.slice(0, 200)}`, () => {
          render(el, {}, apply);
          void apply(pending);
        }, true),
      );
    }
  }
  root.appendChild(button('✕', 'Dismiss', () => hideSelectionChips(el)));
}
