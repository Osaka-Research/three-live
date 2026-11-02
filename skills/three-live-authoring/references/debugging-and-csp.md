# Debugging, Sandboxing & CSP Guide (`<three-live>` & `<xr-live>`)

## 1. Why Nothing Renders (Top 4 Causes)

1. **Missing `allow-client-scripts` attribute:**
   - **Symptom:** `<three-live>` or `<xr-live>` with an inline `<script type="text/three">` stays blank and dispatches an `error` event with `CLIENT_SCRIPTS_DISABLED_ERROR`.
   - **Fix:** Add `allow-client-scripts` to the element (`<three-live allow-client-scripts ...>`) or set `ThreeLiveElement.allowClientScripts = true` before connecting.
2. **Bundler moved the Worker engine asset (`sandboxEngineSrc`):**
   - **Symptom:** When bundling with Vite, Webpack, or Rollup instead of loading `/dist/three-live.min.js` via `<script>`, the sandbox Worker cannot auto-detect the IIFE bundle URL and fails closed.
   - **Fix:** Explicitly point `ThreeLiveElement.sandboxEngineSrc` at the IIFE `.min.js` bundle:
     ```js
     import { ThreeLiveElement } from 'three-live';
     ThreeLiveElement.sandboxEngineSrc =
       new URL('three-live/dist/three-live.min.js', import.meta.url).href;
     ```
3. **Strict Host CSP (`require-trusted-types-for 'script'` or blocked `blob:` Workers):**
   - **Symptom:** The host page's Content Security Policy blocks Worker creation or script evaluation.
   - **Fix:** Set `sandbox="iframe"` on the element and configure `ThreeLiveElement.sandboxIframeSrc` to point at `three-live-sandbox.html`, which runs inside an opaque-origin `<iframe sandbox="allow-scripts">`.
4. **Calling `new THREE.GLTFLoader()` or `fetch()` inside `<script type="text/three">`:**
   - **Symptom:** External model does not appear because `fetch` and `XMLHttpRequest` are permanently revoked inside the sandbox Worker.
   - **Fix:** Use `<three-live src="/path/to/model.glb">` or `<xr-anchor src="/path/to/model.glb">`.

---

## 2. Inspecting Permissive Fallback Warnings (`THREE.getAuthorWarnings()`)

When an LLM-generated `<script type="text/three">` uses unsupported Three.js classes (`ShaderMaterial`, `SpotLight`, `IcosahedronGeometry`, `CapsuleGeometry`, or unknown `THREE.*` constructors), `three-author` downgrades them gracefully instead of crashing.

To inspect which fallbacks were triggered during a scene compilation:
```js
// Inside <script type="text/three"> or unit tests:
const warnings = THREE.getAuthorWarnings();
console.log('Author warnings:', warnings);
THREE.clearAuthorWarnings();
```

---

## 3. Enforced Sandbox Quotas

Every procedural compilation (`toCanvas3D()`, `toGLB()`, `toUSDZ()`) runs `SceneQuotaValidator` with these defaults:
- **Max Script Size:** `1,048,576` bytes (`1 MiB`)
- **Max Meshes:** `1,000`
- **Max Vertices:** `100,000`
- **Max Indices:** `300,000`
- **Max Textures:** `16` (max dimension `2048×2048`)
- **Execution Watchdog:** `3,000 ms` wall-clock timeout (`250 ms` CPU ceiling inside Rust Boa compiler)
- **Max Concurrent Sandbox Workers:** `32`
