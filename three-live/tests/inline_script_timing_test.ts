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

// Inline `<script type="text/three">` scenes must run whether the bundle loads
// with `defer` / `type="module"` / at the end of `<body>` (element upgraded
// before the bundle registers its script runner) or as a classic `<script>` in
// `<head>` (element upgraded before its children are parsed).

import {ThreeLiveElement} from '../src/three-live-element';

let passed = 0;
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
  console.log(`   ✅ [PASS] ${message}`);
  passed++;
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

interface FakeDoc {
  readyState: string;
  listeners: Array<() => void>;
  addEventListener(type: string, fn: () => void): void;
  fire(): void;
}

function fakeDocument(readyState: string): FakeDoc {
  const doc: FakeDoc = {
    readyState,
    listeners: [],
    addEventListener(type, fn) {
      if (type === 'DOMContentLoaded') doc.listeners.push(fn);
    },
    fire() {
      doc.readyState = 'interactive';
      for (const fn of doc.listeners.splice(0)) fn();
    },
  };
  (globalThis as any).document = doc;
  return doc;
}

function element(script: string | null) {
  const el: any = Object.create(ThreeLiveElement.prototype);
  el.loadController = null;
  el.ran = [] as string[];
  el.script = script;
  Object.defineProperty(el, 'isConnected', {value: true, writable: true});
  el.querySelector = () => (el.script === null ? null : {textContent: el.script});
  el.executeScript = (code: string) => {
    el.ran.push(code);
    el.loadController = new AbortController();
    return Promise.resolve();
  };
  return el;
}

async function main() {
  console.log('\n📜 Inline scene script timing');
  const originalDocument = (globalThis as any).document;
  try {
    // 1. Bundle defines the element before registering its runner: the inline
    //    script must not run synchronously inside connectedCallback.
    {
      fakeDocument('interactive');
      const el = element('scene.add(a)');
      el.scheduleInlineScript();
      assert(el.ran.length === 0, 'Inline script waits until the bundle finishes evaluating');
      await flush();
      assert(el.ran[0] === 'scene.add(a)', 'Inline script runs once the microtask fires');
    }

    // 2. Classic <script> in <head>: children are not parsed yet.
    {
      const doc = fakeDocument('loading');
      const el = element(null);
      el.scheduleInlineScript();
      await flush();
      assert(el.ran.length === 0 && doc.listeners.length === 1, 'Missing script waits for DOMContentLoaded');
      el.script = 'scene.add(b)';
      doc.fire();
      assert(el.ran[0] === 'scene.add(b)', 'Inline script parsed later runs on DOMContentLoaded');
    }

    // 3. A load started in the meantime wins.
    {
      const doc = fakeDocument('loading');
      const el = element(null);
      el.scheduleInlineScript();
      await flush();
      el.loadController = new AbortController(); // e.g. el.executeScript() or src
      el.script = 'scene.add(c)';
      doc.fire();
      assert(el.ran.length === 0, 'A newer load is not overwritten by the inline script');
    }
    {
      fakeDocument('interactive');
      const el = element('scene.add(d)');
      el.scheduleInlineScript();
      el.loadController = new AbortController();
      await flush();
      assert(el.ran.length === 0, 'A load started before the microtask also wins');
    }

    // 4. Disconnected elements do nothing.
    {
      fakeDocument('interactive');
      const el = element('scene.add(e)');
      el.scheduleInlineScript();
      // disconnectedCallback() aborts via beginLoad(), which replaces loadController.
      el.loadController = new AbortController();
      await flush();
      assert(el.ran.length === 0, 'Disconnected elements skip the inline script');
    }

    // 5. Document already loaded and no inline script: nothing runs.
    {
      fakeDocument('complete');
      const el = element(null);
      el.scheduleInlineScript();
      await flush();
      assert(el.ran.length === 0, 'No inline script, nothing runs');
    }
  } finally {
    (globalThis as any).document = originalDocument;
  }
  console.log(`\nResults: ${passed} passed, 0 failed.`);
}

main().catch((e) => {
  console.error(`   ❌ [FAIL] ${e?.message ?? e}`);
  process.exit(1);
});
