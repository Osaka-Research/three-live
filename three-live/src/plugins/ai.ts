/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Bring-your-own-LLM scene editing for `<three-live>` and
 * `<xr-live>` (`three-live-ai.min.js`, roadmap item B2a).
 *
 * `el.editScene('make the roof red')` sends the current scene script (plus the
 * selected mesh) to any configured LLM provider, then compiles the reply in
 * the element's sandbox *before* touching the live scene. A compile failure
 * gets one automatic repair turn with the exact error; a reply that still
 * fails is rejected and the running scene stays untouched. Accepted edits are
 * hot-swapped and can be undone with `el.undoEdit()`.
 *
 * Providers:
 * - `ai-chat`: any Chat Completions-compatible HTTP endpoint (a backend proxy,
 *   Ollama, LM Studio, vLLM, OpenRouter, the Gemini compatibility endpoint, …).
 * - Custom: any object with `complete({messages, signal}) => Promise<string>`.
 *
 * API keys never belong in page code: point `ai-endpoint` at your own backend
 * proxy (or a local model), or pass short-lived credentials via `headers`.
 */

import {getSharedRegistry, type ThreeLivePlugin} from '../plugin';
import {
  type AIVoiceEditOptions,
  type AIVoiceEditResult,
  type AIVoiceSelection,
  selectByVoice,
  type AIVoiceElement,
  type AIVoiceSession,
  type AIVoiceSessionOptions,
  connectVoice,
  installVoiceButton,
  setSelectOnTap,
  startVoiceEdit,
} from './ai-voice';
import {type AISelectionMode, installSelectionState} from './ai-select';

/** One part of a multimodal chat message (`text` or `image_url`). */
export type AIChatContentPart =
  | {readonly type: 'text'; readonly text: string}
  | {
      readonly type: 'image_url';
      readonly image_url: {
        readonly url: string;
        readonly detail?: 'auto' | 'low' | 'high';
      };
    };

/** One chat message sent to an AI provider. */
export interface AIChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string | readonly AIChatContentPart[];
}

/** A pluggable LLM backend. */
export interface ThreeLiveAIProvider {
  complete(request: {
    readonly messages: readonly AIChatMessage[];
    readonly signal?: AbortSignal;
  }): Promise<string>;
}

/** Options for {@link createAIChatProvider}. */
export interface AIChatProviderOptions {
  /** Full Chat Completions URL (`https://…`, or `http://` on loopback only). */
  readonly endpoint: string;
  /** Model name forwarded in the request body. */
  readonly model?: string;
  /** Extra request headers (e.g. a short-lived bearer token for your proxy). */
  readonly headers?: Readonly<Record<string, string>>;
  /** Sampling temperature (default 0.2). */
  readonly temperature?: number;
  /** Request timeout in milliseconds (default 120000). */
  readonly timeoutMs?: number;
  /** `fetch` implementation (defaults to the global `fetch`). */
  readonly fetch?: typeof fetch;
}

/** Options for `editScene`. */
export interface EditSceneOptions {
  /** Provider override (defaults to `el.aiProvider`, then `ai-*` attributes). */
  readonly provider?: ThreeLiveAIProvider;
  /**
   * Mesh name(s) the instruction refers to (defaults to `el.selectedMeshes`, then
   * `el.selectedMesh`). Pass `null` or `[]` for no selection.
   */
  readonly selection?: string | readonly string[] | null;
  /** Script to edit (defaults to the element's current scene script). */
  readonly source?: string;
  /** Automatic repair turns after a failed compile (0..3, default 1). */
  readonly maxRepairs?: number;
  /** Validate only; do not hot-swap the live scene. */
  readonly dryRun?: boolean;
  /** Aborts the request (a newer `editScene` call also aborts older ones). */
  readonly signal?: AbortSignal;
}

/** Result of `editScene`. */
export interface EditSceneResult {
  /** True when the edit compiled and was applied (or would be, for `dryRun`). */
  readonly applied: boolean;
  /** The validated script (or the last rejected candidate). */
  readonly code: string;
  /** Number of automatic repair turns used. */
  readonly repairs: number;
  /** Non-fatal messages from the sandbox compile (degraded features, …). */
  readonly warnings: readonly string[];
  /** Why the edit was rejected, when `applied` is false. */
  readonly error?: string;
}

/** The subset of `<three-live>` / `<xr-live>` that editing relies on. */
export interface AIEditableElement {
  allowClientScripts?: boolean;
  sandbox?: string;
  selectedMesh?: string | null;
  selectedMeshes?: readonly string[];
  aiProvider?: ThreeLiveAIProvider;
  getAttribute?(name: string): string | null;
  querySelector?(selector: string): {textContent: string | null} | null;
  executeScript(script: string): Promise<unknown>;
  fireEvent?(type: string, detail?: unknown): void;
  editScene?: (
    instruction: string,
    options?: EditSceneOptions,
  ) => Promise<EditSceneResult>;
  undoEdit?: () => Promise<boolean>;
  startVoiceEdit?: (options?: AIVoiceEditOptions) => Promise<AIVoiceEditResult>;
  selectByVoice?: (query: string, options?: {mode?: AISelectionMode}) => Promise<AIVoiceSelection>;
  connectVoice?: (options: AIVoiceSessionOptions) => Promise<AIVoiceSession>;
  setSelectOnTap?: (enabled: boolean) => void;
  hasAttribute?(name: string): boolean;
  readonly sceneSource?: string;
  __tlAiSource?: string;
  __tlAiHistory?: string[];
  __tlAiAbort?: AbortController | null;
  __tlAiInstalled?: boolean;
}

const MAX_SCRIPT_BYTES = 1048576;
const MAX_HISTORY = 20;
const DRY_RUN_TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = [
  'You edit Three.js scene scripts for Three-Live, which compiles them to glTF for Web, Android, and iOS.',
  'Reply with the COMPLETE updated script in a single ```js code block and nothing else.',
  'Rules:',
  '- Use the pre-defined globals `THREE`, `scene`, and `camera`. No imports, renderer, loaders, DOM, network, or timers.',
  '- Change only what the instruction asks; keep every other object, name, and value as it is.',
  '- Give new meshes and groups descriptive `.name` values; keep existing names stable.',
  '- Keep objects resting on y = 0 and within view of the camera.',
  '- Supported: core geometries and materials (MeshStandardMaterial / MeshPhysicalMaterial with PBR maps), lights,',
  '  Group, InstancedMesh, THREE.CSG, THREE.CanvasTexture, THREE.ProceduralTexture presets',
  '  (wood, marble, brick, concrete, brushedMetal, rust, leather, fabric, carbonFiber, checkerboard, grid),',
  '  and declarative mesh.userData.xr traits. Optional per-frame motion: function animate(t) { ... }.',
].join('\n');

function isAllowedEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Creates an `ai-chat` provider for any Chat Completions-compatible endpoint
 * (`POST {model, messages}` → `choices[0].message.content`).
 */
export function createAIChatProvider(
  options: AIChatProviderOptions,
): ThreeLiveAIProvider {
  const endpoint = String(options?.endpoint ?? '');
  if (!isAllowedEndpoint(endpoint)) {
    throw new Error(
      'ai-chat: endpoint must be an https:// URL (or http:// on localhost).',
    );
  }
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof doFetch !== 'function') {
    throw new Error('ai-chat: no fetch() implementation is available.');
  }
  const temperature = Number.isFinite(options.temperature)
    ? Number(options.temperature)
    : 0.2;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 120000);
  return {
    async complete({messages, signal}) {
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(signal?.reason);
      if (signal?.aborted) onAbort();
      signal?.addEventListener('abort', onAbort, {once: true});
      const timer = setTimeout(
        () => ctrl.abort(new Error(`ai-chat: timed out after ${timeoutMs} ms`)),
        timeoutMs,
      );
      try {
        const body: Record<string, unknown> = {
          messages,
          temperature,
          stream: false,
        };
        if (options.model) body['model'] = options.model;
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', ...options.headers},
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(
            `ai-chat: HTTP ${res.status} from endpoint: ${text.slice(0, 300)}`,
          );
        }
        // tslint:disable-next-line:no-any Untyped provider JSON.
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          throw new Error('ai-chat: endpoint returned non-JSON content.');
        }
        const content = json?.choices?.[0]?.message?.content;
        const out = Array.isArray(content)
          ? content
              .map((p: unknown) =>
                typeof p === 'string'
                  ? p
                  : String((p as {text?: unknown} | null)?.text ?? ''),
              )
              .join('')
          : content;
        if (typeof out !== 'string' || !out.trim()) {
          throw new Error('ai-chat: response had no message content.');
        }
        return out;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

/** Extracts the script from an LLM reply (first fenced block, else raw code). */
export function extractScript(reply: string): string {
  const text = String(reply ?? '');
  const fence = /```[ \t]*([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let first = '';
  while ((m = fence.exec(text))) {
    const lang = m[1].toLowerCase();
    if (!first) first = m[2];
    if (['js', 'javascript', 'ts', 'typescript', 'mjs'].includes(lang)) {
      return m[2].trim();
    }
  }
  if (first) return first.trim();
  // Unterminated fence (truncated reply): take everything after it.
  const open = /```[^\n]*\n([\s\S]*)$/.exec(text);
  if (open) return open[1].trim();
  return /\bscene\b/.test(text) ? text.trim() : '';
}

function sceneSummary(model: unknown): {
  meshNames: Set<string>;
  meshes: number;
} {
  const meshNames = new Set<string>();
  // tslint:disable-next-line:no-any Untyped glTF JSON.
  let gltf: any = (model as {gltf?: unknown} | null)?.gltf;
  if (!gltf && model instanceof ArrayBuffer && model.byteLength >= 20) {
    const dv = new DataView(model);
    if (dv.getUint32(0, true) === 0x46546c67) {
      const len = dv.getUint32(12, true);
      try {
        gltf = JSON.parse(
          new TextDecoder().decode(new Uint8Array(model, 20, len)),
        );
      } catch {}
    }
  }
  let meshes = 0;
  for (const n of gltf?.nodes ?? []) {
    if (typeof n?.name === 'string') meshNames.add(n.name);
    if (n?.mesh !== undefined) meshes++;
  }
  return {meshNames, meshes};
}

/** Compiles `script` in the element's sandbox without touching the live scene. */
function dryRunCompile(
  el: AIEditableElement,
  script: string,
  signal?: AbortSignal,
): Promise<{model: unknown; warnings: string[]}> {
  const runner = getSharedRegistry().scriptRunner;
  if (!runner || typeof runner.execute !== 'function') {
    return Promise.reject(
      new Error(
        'editScene needs a script runner (load three-live.min.js or three-live-full.min.js).',
      ),
    );
  }
  const warnings: string[] = [];
  return new Promise((resolve, reject) => {
    let handle: {terminate?: () => void} | void;
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      try {
        handle?.terminate?.();
      } catch {}
      fn();
    };
    const onAbort = () =>
      finish(() => reject(signal?.reason ?? new Error('editScene aborted')));
    const timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              `Scene did not finish compiling within ${DRY_RUN_TIMEOUT_MS} ms.`,
            ),
          ),
        ),
      DRY_RUN_TIMEOUT_MS,
    );
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, {once: true});
    Promise.resolve(
      runner.execute(
        script,
        el.sandbox ?? 'worker',
        {
          onModelReady: (model: unknown) =>
            finish(() => resolve({model, warnings})),
          onError: (err: Error) =>
            finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
          onToast: (msg: string) => {
            if (warnings.length < 20) warnings.push(String(msg));
          },
        },
        {allowClientScripts: true},
      ),
    ).then(
      (h) => {
        handle = h;
        if (done) {
          try {
            h?.terminate?.();
          } catch {}
        }
      },
      (err) =>
        finish(() => reject(err instanceof Error ? err : new Error(String(err)))),
    );
  });
}

/** Longest selection forwarded to a model. */
const MAX_SELECTED = 50;

/** Normalizes a selection to a de-duplicated list of non-empty mesh names. */
export function normalizeSelection(
  value: string | readonly string[] | null | undefined,
): string[] {
  const list = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const v of list) {
    const name = typeof v === 'string' ? v.slice(0, 200) : '';
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= MAX_SELECTED) break;
  }
  return out;
}

/** The prompt sentence describing the selection (shared wording with the Rust core). */
export function selectionSentence(selected: readonly string[]): string {
  if (selected.length === 0) return '';
  if (selected.length === 1) {
    return `The user selected the mesh named "${selected[0]}"; the instruction refers to it.\n`;
  }
  return `The user selected the meshes named ${selected.map((m) => `"${m}"`).join(', ')}; the instruction refers to them.\n`;
}

function resolveProvider(
  el: AIEditableElement,
  options: EditSceneOptions,
): ThreeLiveAIProvider {
  const explicit = options.provider ?? el.aiProvider;
  if (explicit && typeof explicit.complete === 'function') return explicit;
  const endpoint = el.getAttribute?.('ai-endpoint');
  if (!endpoint) {
    throw new Error(
      'editScene: no AI provider. Set el.aiProvider, or the ai-endpoint (and ai-model) attributes.',
    );
  }
  const kind = (el.getAttribute?.('ai-provider') || 'ai-chat').toLowerCase();
  if (kind !== 'ai-chat') {
    throw new Error(
      `editScene: unknown ai-provider '${kind}' (supported: ai-chat, or set el.aiProvider).`,
    );
  }
  return createAIChatProvider({
    endpoint,
    model: el.getAttribute?.('ai-model') || undefined,
  });
}

function currentSource(el: AIEditableElement): string {
  if (typeof el.__tlAiSource === 'string') return el.__tlAiSource;
  const inline = el.querySelector?.(
    'script[type="text/three"], script[type="text/three-live"]',
  );
  return inline?.textContent ?? '';
}

/**
 * Edits the scene of a `<three-live>` / `<xr-live>` element with an LLM,
 * validating the result in the sandbox before applying it.
 */
export async function editScene(
  el: AIEditableElement,
  instruction: string,
  options: EditSceneOptions = {},
): Promise<EditSceneResult> {
  const text = String(instruction ?? '').trim();
  if (!text) throw new Error('editScene: instruction is empty.');
  if (!el?.allowClientScripts) {
    throw new Error(
      'editScene requires client scripts: add the allow-client-scripts attribute.',
    );
  }
  const source = options.source ?? currentSource(el);
  if (!source.trim()) {
    throw new Error(
      'editScene needs a Three.js scene script (inline <script type="text/three"> or a prior editScene/executeScript).',
    );
  }
  const provider = resolveProvider(el, options);

  // A newer edit supersedes an in-flight one.
  el.__tlAiAbort?.abort(new Error('editScene superseded by a newer call'));
  const ctrl = new AbortController();
  el.__tlAiAbort = ctrl;
  const onOuterAbort = () => ctrl.abort(options.signal?.reason);
  if (options.signal?.aborted) onOuterAbort();
  options.signal?.addEventListener('abort', onOuterAbort, {once: true});
  const signal = ctrl.signal;

  const selected = normalizeSelection(
    options.selection === undefined
      ? (el.selectedMeshes ?? el.selectedMesh)
      : options.selection,
  );
  // Kept as a string for one mesh so events and prompts stay as before.
  const selection = selected.length > 1 ? selected : (selected[0] ?? null);
  const maxRepairs = Math.max(
    0,
    Math.min(3, Math.floor(Number(options.maxRepairs ?? 1)) || 0),
  );
  const messages: AIChatMessage[] = [
    {role: 'system', content: SYSTEM_PROMPT},
    {
      role: 'user',
      content:
        `Current scene script:\n\`\`\`js\n${source}\n\`\`\`\n` +
        selectionSentence(selected) +
        `Instruction: ${text}`,
    },
  ];

  el.fireEvent?.('three-live-edit-start', {instruction: text, selection});
  let code = '';
  let error = '';
  let warnings: string[] = [];
  let repairs = 0;
  try {
    for (let turn = 0; turn <= maxRepairs; turn++) {
      const reply = await provider.complete({messages, signal});
      if (signal.aborted) throw signal.reason;
      code = extractScript(reply);
      if (!code) {
        error = 'The model reply did not contain a scene script.';
      } else if (new TextEncoder().encode(code).length > MAX_SCRIPT_BYTES) {
        error = 'The generated script exceeds the 1 MB script limit.';
      } else {
        try {
          const res = await dryRunCompile(el, code, signal);
          warnings = res.warnings;
          const summary = sceneSummary(res.model);
          if (summary.meshes === 0) {
            error = 'The edited scene contains no meshes.';
          } else if (
            selected.some((m) => !summary.meshNames.has(m)) &&
            !/\b(remove|delete|rename)\b/i.test(text)
          ) {
            const lost = selected.filter((m) => !summary.meshNames.has(m));
            error =
              lost.length === 1
                ? `The edited scene no longer contains the selected mesh "${lost[0]}".`
                : `The edited scene no longer contains the selected meshes ${lost.map((m) => `"${m}"`).join(', ')}.`;
          } else {
            error = '';
          }
        } catch (caught: unknown) {
          if (signal.aborted) throw signal.reason;
          const e = caught as {name?: string; message?: string} | null;
          const msg = String(e?.message || caught);
          // Keep the error class (SyntaxError, TypeError, …): models repair better with it.
          error =
            e?.name && e.name !== 'Error' && !msg.startsWith(e.name)
              ? `${e.name}: ${msg}`
              : msg;
        }
      }
      if (!error) break;
      if (turn < maxRepairs) {
        repairs++;
        messages.push(
          {role: 'assistant', content: reply},
          {
            role: 'user',
            content: `That script was rejected by the Three-Live sandbox: ${error}\nReturn the complete corrected script in a single \`\`\`js code block.`,
          },
        );
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', onOuterAbort);
    if (el.__tlAiAbort === ctrl) el.__tlAiAbort = null;
  }

  if (!error && !options.dryRun) {
    try {
      await el.executeScript(code);
      const history: string[] = (el.__tlAiHistory ??= []);
      history.push(source);
      if (history.length > MAX_HISTORY) history.shift();
      el.__tlAiSource = code;
    } catch (e: unknown) {
      error = `The edit compiled but failed to load: ${(e as Error)?.message || String(e)}`;
      el.__tlAiSource = source;
      // Best effort: restore the previous scene.
      el.executeScript(source).catch(() => {});
    }
  }
  const applied = !error;
  const result: EditSceneResult = {
    applied,
    code,
    repairs,
    warnings,
    ...(error ? {error} : {}),
  };
  el.fireEvent?.('three-live-edit', {instruction: text, ...result});
  return result;
}

/** Restores the scene script from before the last applied `editScene`. */
export async function undoEdit(el: AIEditableElement): Promise<boolean> {
  const prev = el?.__tlAiHistory?.pop();
  if (typeof prev !== 'string') return false;
  el.__tlAiSource = prev;
  await el.executeScript(prev);
  return true;
}

/**
 * `<three-live>` / `<xr-live>` plugin adding `el.editScene()`, `el.undoEdit()`,
 * `el.aiProvider`, and `el.sceneSource` to every element.
 */
export const aiPlugin: ThreeLivePlugin = {
  name: 'ai',
  onRegister(): void {
    // Elements connected before this bundle loaded.
    if (typeof document === 'undefined') return;
    document
      .querySelectorAll?.('three-live, xr-live')
      .forEach((node) => aiPlugin.onElementConnected?.(node));
  },
  onElementConnected(host: unknown): void {
    const el = host as AIEditableElement;
    if (!el || el.__tlAiInstalled) return;
    el.__tlAiInstalled = true;
    el.editScene = (instruction: string, options?: EditSceneOptions) =>
      editScene(el, instruction, options);
    el.undoEdit = () => undoEdit(el);
    installSelectionState(el as never);
    const voiceEl = el as AIVoiceElement;
    el.startVoiceEdit = (options?: AIVoiceEditOptions) =>
      startVoiceEdit(voiceEl, options);
    voiceEl.__tlSelectProvider = () => {
      try {
        return resolveProvider(el, {});
      } catch {
        return null;
      }
    };
    el.selectByVoice = (query: string, options?: {mode?: AISelectionMode}) =>
      selectByVoice(voiceEl, query, options);
    el.connectVoice = (options: AIVoiceSessionOptions) =>
      connectVoice(voiceEl, options);
    el.setSelectOnTap = (enabled: boolean) => setSelectOnTap(voiceEl, enabled);
    if (el.hasAttribute?.('ai-select-on-tap')) setSelectOnTap(voiceEl, true);
    if (el.hasAttribute?.('ai-voice-button')) installVoiceButton(voiceEl);
    if (!('sceneSource' in el)) {
      Object.defineProperty(el, 'sceneSource', {
        get: () => currentSource(el),
        configurable: true,
      });
    }
    // Track scripts loaded programmatically so later edits start from them.
    const original = el.executeScript;
    if (typeof original === 'function') {
      el.executeScript = (script: string) =>
        original.call(el, script).then((res: unknown) => {
          el.__tlAiSource = String(script);
          return res;
        });
    }
  },
};
