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

--------------------------------------------------------------------------------

## 4. Network CSP & Plugin Security Quotas (`gemini-live`, `shared-room`, `persistent-anchors`)

-   **Host `connect-src` for Live Relays:** The procedural
    `<script type="text/three">` Worker always runs with network access revoked
    (`connect-src 'none'`). Host-level plugins (`connectGeminiLive()` and
    `shared-room="wss://..."`) connect from the main thread and enforce `wss://`
    (or loopback `ws://localhost` / `ws://127.0.0.1` / `ws://[::1]`). If your
    page serves a strict Content Security Policy and uses remote WebSocket
    relays, allow your relay origin in `connect-src` (e.g.
    `connect-src 'self' wss://your-relay.example.com`). Same-origin
    `shared-room="room-id"` uses `BroadcastChannel` and needs no `connect-src`
    allowance.
-   **Persistence & Co-Presence Caps:**
    -   `persistent-anchors`: `MAX_PERSISTED_NODES = 128`,
        `MAX_HASH_BYTES = 8192` (`#xr-state` tokens larger than `8 KB` or
        containing prototype-pollution keys are rejected).
    -   `shared-room`: `MAX_PEERS = 16`, `MAX_PAYLOAD_BYTES = 16384` (`16 KB`),
        `MAX_REMOTE_STROKES = 64`, `POSE_TICK_INTERVAL_MS = 50` (`20 Hz`),
        `SOFT_LOCK_TTL_MS = 2000`.

--------------------------------------------------------------------------------

## 5. Closed-Loop CLI Diagnostics (`TL100–TL402`), Headless Contact Sheets & Scenario Simulation

Use `three-live-cli` to verify `.js`, `.html`, and `.glb` scenes without a
browser:

```bash
# 1. Validate syntax, schema, HTML attributes, and 3D spatial layout
three-live-cli validate scene.js --json

# 2. Render a 2x2 quad contact sheet (Camera, Front, Right, Top) with 1m grid & AABB labels
three-live-cli render scene.js -o preview.png --view=quad --grid --annotations

# 3. Render a 4-frame temporal filmstrip or animated GIF with KHR_interactivity onSelect trigger
three-live-cli render scene.js -o anim.png --frames=4 --duration=2.0 --trigger-select=crystal

# 4. Run a 60Hz deterministic scenario simulation
three-live-cli sim scene.js --duration=5.0 \
  --actions='[{"at":0.2,"type":"select","target":"crystal"},{"at":0.5,"type":"moveCharacter","direction":[0,0,-1],"duration":1.5}]' \
  --json
```

### Diagnostic Code Table (`TL100–TL402`)

Code    | Severity  | Condition                                                          | Actionable Fix
:------ | :-------- | :----------------------------------------------------------------- | :-------------
`TL100` | `error`   | Syntax error, runtime exception, or quota exceeded                 | Check `line`/`column` in JSON output and fix JS syntax or reduce vertex/mesh count.
`TL101` | `warning` | `ShaderMaterial` / `RawShaderMaterial` fallback                    | Replace with `THREE.MeshStandardMaterial` or `THREE.MeshPhysicalMaterial`.
`TL102` | `warning` | Polyhedron/Tube geometry fallback                                  | Use `SphereGeometry`, `CylinderGeometry`, `ExtrudeGeometry`, `LatheGeometry`, or `THREE.CSG`.
`TL103` | `warning` | `THREE.GLTFLoader` / `TextureLoader` / `fetch`                     | Load external `.glb` via `<three-live src="model.glb">` or `<xr-anchor src="model.glb">`.
`TL104` | `info`    | `requestAnimationFrame` in static export                           | Use `userData.xr.orbit` or `userData.interactivity` so motion survives `.glb`/`.usdz` export.
`TL105` | `warning` | Unknown `THREE.*` constructor/method                               | Remove unsupported Three.js helper call.
`TL201` | `warning` | Unknown `userData.xr` or `userData.interactivity` key              | Apply the Levenshtein suggestion in `suggestion` (e.g. `grabbable` -> `grab`).
`TL202` | `warning` | Out-of-range numeric trait clamped                                 | Keep `gaze.dwellMs` in `[200, 10000]`, `bloom.strength` in `[0, 5]`, `outline.thickness` in `[0.002, 0.25]`.
`TL203` | `error`   | Unsafe media/live/room URL or anchor ID                            | Use `https://` (or clean relative paths) for media, `wss://` for relays, and alphanumeric anchor IDs.
`TL204` | `error`   | Broken target node reference                                       | Ensure `orbit.target`, `ik.*`, `spawner.template`, and `interactivity.*.target` match an existing `mesh.name`.
`TL205` | `warning` | Unnamed interactive/spatial mesh                                   | Set a unique `mesh.name = "..."` before attaching `userData.xr` or `userData.interactivity`.
`TL301` | `error`   | Empty scene (`meshCount == 0`)                                     | Call `scene.add(mesh)` with at least one non-empty geometry.
`TL302` | `warning` | Camera inside mesh AABB                                            | Move camera outside `summary.worldBounds` or shrink the enclosing mesh.
`TL303` | `warning` | Mesh outside camera frustum or extreme framing                     | Reposition the mesh or adjust camera `position` / `lookAt` so `screenCoveragePct` is between `5%` and `85%`.
`TL304` | `warning` | Extreme scene scale (`< 0.01 m` or `> 200 m`)                      | Author dimensions in meters (`1 unit = 1 meter`); scale millimeter meshes by `0.001`.
`TL305` | `warning` | Unlit metallic PBR material                                        | Add a `DirectionalLight` / `AmbientLight` or set `environment` on `<three-live>`.
`TL306` | `warning` | Co-located sibling meshes (`> 80%` overlap)                        | Offset sibling positions or use `THREE.CSG.subtract(a, b)` for boolean cutouts.
`TL307` | `info`    | Floating or buried scene / character                               | Align `min.y` to `0.0` (`mesh.position.y = height / 2`) so AR/VR placement sits on the floor.
`TL401` | `error`   | Inline `<script type="text/three">` without `allow-client-scripts` | Add `allow-client-scripts` to `<three-live>` or `<xr-live>`.
`TL402` | `warning` | `<xr-live>` feature used on `<three-live>`                         | Upgrade the tag from `<three-live>` to `<xr-live>` and load `xr-live.min.js`.
