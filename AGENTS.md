<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# AGENTS.md — Three-Live & XR-Live Guide for Coding Agents

This file provides high-signal context, architectural invariants, and authoring rules for AI coding assistants working in or building with the `three-live` repository.

- **Building 3D / XR scenes or apps?** Read [`skills/three-live-authoring/SKILL.md`](skills/three-live-authoring/SKILL.md) and [`docs/llm-guide.md`](docs/llm-guide.md).
- **Adding or modifying engine features / plugins?** Read [`skills/xr-live-plugin-dev/SKILL.md`](skills/xr-live-plugin-dev/SKILL.md).

---

## 1. Component & Bundle Selection

Goal                                                                                          | Element        | Recommended Bundle         | Enforced Budget
:-------------------------------------------------------------------------------------------- | :------------- | :------------------------- | :-------------:
`.glb` / `.usdz` 3D viewer + 1-tap AR handoff (no scripting)                                  | `<three-live>` | `three-live-viewer.min.js` | `< 25.5 KB gz`
Procedural `<script type="text/three">` + `KHR_interactivity` + AR                            | `<three-live>` | `three-live.min.js`        | `< 54 KB gz`
Full 3D viewer + PBR Next + HDRI + contact shadows + skeletal animation + hotspots            | `<three-live>` | `three-live-full.min.js`   | `< 69 KB gz`
6DoF WebXR + spatial traits (`grab`, `scale`, `billboard`, `anchor`) + `<div slot="spatial">` | `<xr-live>`    | `xr-live.min.js`           | `< 66 KB gz`
Add-on bundle with all 14 modular `<xr-live>` spatial plugins                                 | `<xr-live>`    | `xr-live-plugins.min.js`   | `< 52 KB gz`
Add-on bundle with the 5 simulation plugins (character, agents, hit zones, objectives, audio) | `<xr-live>`    | `xr-live-sim.min.js`       | `< 22 KB gz`
Full Spatial Computing + Depth Physics + 25-Joint Hands + all 14 spatial + 5 sim plugins      | `<xr-live>`    | `xr-live-full.min.js`      | `< 151 KB gz`

---

## 2. Scene Authoring Golden Rules (`<script type="text/three">`)

1. **Opt in to inline scripts:** Always set `allow-client-scripts` on any `<three-live>` or `<xr-live>` element that contains an inline `<script type="text/three">` or calls `element.executeScript(code)`. Without `allow-client-scripts`, client-side script strings are refused by default.
2. **Use pre-injected globals:** Inside `<script type="text/three">`, `THREE` and `scene` (`new THREE.Scene()`) are already defined in the isolated Worker sandbox. Add nodes via `scene.add(mesh)`.
3. **Never create a renderer or render loop:** Do not instantiate `THREE.WebGLRenderer`, append `<canvas>` elements, or call `GLTFLoader` / `TextureLoader` inside `<script type="text/three">`. Load external `.glb` models via `<three-live src="...">` or `<xr-anchor src="...">`.
4. **Use canonical `mesh.userData.xr` traits:** Attach spatial behaviors using the structured `userData.xr` object (serialized identically to WebXR, glTF `ANDROID_xr_scenecore`, and USDZ `customData`):

    ```js
    mesh.userData.xr = {
      grab: '2-hand', // '1-hand' | '2-hand' | true
      scale: { min: 0.25, max: 3.0 },
      billboard: 'capsule', // 'capsule' | 'cylindrical' | 'spherical' | true
      follow: { mode: 'head', lazy: true, distance: 1.2, deadzoneDeg: 15, stiffness: 6 },
      anchor: { target: 'table', id: 'turbine-1', persist: true }, // string or { target?, id?, persist? }
      physics: 'dynamic', // 'dynamic' | 'static'
      orbit: { target: [0, 1, -1], radius: 0.4, speed: 0.8, height: 0.1, faceCenter: true },
      handles: { rotateAxis: 'y', minScale: 0.2, maxScale: 4.0 },
      dimensions: { unit: 'cm', axes: ['x', 'y', 'z'], color: '#38bdf8', showOnSelect: false },
      snapTo: { grid: 0.05, angleDeg: 15, surface: 'floor', socketTag: 'dock', radius: 0.15 },
      snapSocket: { tag: 'dock', radius: 0.15, alignRotation: true, highlightColor: '#22c55e' },
      gaze: { dwellMs: 1200, action: 'select', repeat: false },
      explode: { direction: [0, 1, 0], distance: 0.35, layer: 2, leaderLine: true },
      navigable: 'walkable', // true | 'walkable' | 'blocked'
      sync: true, // multi-user shared-room sync (default true on grabbable nodes)
      particles: { preset: 'sparks', count: 300, area: [2, 2, 2], speed: 1.0 },
      holdToAsk: { prompt: 'What is this component?', holdMs: 600 },
      worldUnderstanding: { planes: true, meshes: false, reticle: true },
      splatUrl: 'https://example.com/capture.spz',
      audio: { src: 'https://example.com/chime.mp3', refDistance: 1.0, loop: false },
    };
    ```
5. **Use `mesh.userData.interactivity` for `KHR_interactivity` behavior graphs:**

   ```js
   mesh.userData.interactivity = {
     onSelect: [
       { action: 'toggleTransform', property: 'rotation', to: [0, 0.7071, 0, 0.7071], duration: 0.4 },
       { action: 'cycleMaterialColor', colors: [[0.2, 0.6, 1, 1], [1, 0.3, 0.5, 1]], duration: 0.25 },
     ],
   };
   ```
6. **Respect sandbox quotas:** Max `1,000` meshes, `100,000` vertices, `300,000` indices, `16` textures (`2048x2048` max), `1 MiB` script size, and `3,000 ms` execution timeout.

---

## 3. Cross-Platform Architecture & 3-Target Parity Contract

Every procedural scene and `userData.xr` trait runs across **Web**, **Android**, and **iOS / visionOS**:

1. **Canonical Trait Schema (`three-live/src/xr-trait-schema.ts`):**
   - Single source of truth for normalizing and clamping `userData.xr` fields (`normalizeXRTraits()`), emitting glTF `nodes[i].extras.xr` + `nodes[i].extensions.ANDROID_xr_scenecore` (`buildXRSceneCoreExtension()`), and flattening USDZ `customData = {dictionary xr = {...}}` (`flattenXRTraitsForUsd()`).
2. **Web Runtime (`three-live/src/` & `xr-live/src/`):**
    - `<three-live>` (`three-live/src/three-live-element.ts`) and `ThreeView` (`three-live/src/three-view.ts`) provide WebGL2 PBR rendering, Worker/iframe sandboxing, and plugin hooks (`three-live/src/plugin.ts`).
    -   `<xr-live>` (`xr-live/src/xr-live-element.ts`) and the 14 spatial
        plugins (`xr-live/src/plugins/index.ts`: `head-follow`,
        `manipulation-handles`, `world-understanding`, `gemini-live`,
        `spatial-paint`, `depth-particles`, `splat-loader`, `spatial-measure`,
        `magnetic-snap`, `gaze-dwell`, `exploded-view`, `persistent-anchors`,
        `spatial-locomotion`, `shared-room`) implement 6DoF WebXR and desktop
        simulation.
3. **In-Process Rust Compiler (`compiler/`):**
   - Embeds `compiler/assets/three-author-engine.min.js` inside an isolated Boa JS context with strict opcode/wall-clock watchdogs, outputting `.glb` and `.usdz` bytes via C FFI (`compiler/include/three_live.h`) and `three-live-cli`.
4. **Native Mobile SDKs (`mobile/android/` & `mobile/ios/`):**
    -   **Android (`mobile/android/src/main/java/com/google/threelive/`):**
        `XRLiveSceneCoreHelper.kt`, `XRSpatialMath.kt`, `XRSpatialFeatures.kt` +
        modular feature controllers (`SpatialMeasure.kt`, `MagneticSnap.kt`,
        `GazeDwell.kt`, `ExplodedView.kt`, `PersistentAnchors.kt`,
        `SpatialLocomotion.kt`, `SharedRoom.kt`), `XRLiveRuntimeSession.kt`, and
        `mobile/android-filament/` (`ThreeLiveFilamentRenderer.kt`).
    -   **iOS & visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`):**
        `XRLiveRuntimeSession.swift`, `XRLiveRealityKitSession.swift`,
        `XRSpatialRealityKitFeatures.swift` + modular feature controllers
        (`SpatialMeasure.swift`, `MagneticSnap.swift`, `GazeDwell.swift`,
        `ExplodedView.swift`, `PersistentAnchors.swift`,
        `SpatialLocomotion.swift`, `SharedRoom.swift`), and
        `XRLiveRealityKit.swift`.

**Parity Rule:** Whenever you add or modify a trait in `three-live/src/xr-trait-schema.ts`, you must update its handling in Web (`xr-live/src/plugins/`), Android (`mobile/android/`), and iOS/visionOS (`mobile/ios/`) and keep `XRLiveSwiftSourceParityTest.kt` green.

---

## 4. Build, Test & Verification Commands

Run from the repository root:

```bash
# 1. Build all Web bundles + embedded Rust engine asset and verify size budgets
make web               # or: node scripts/build.js

# 2. Regenerate llms.txt and llms-full.txt after editing docs/ or skills/
node scripts/build_llms_txt.js

# 3. Run Web unit & sandbox security tests
make test-web          # or: node scripts/build.js --test

# 4. Run Rust compiler & GLB/USDZ parity tests
make test-rust         # or: cd compiler && cargo test

# 5. Run full Web + Rust test suite
make test
```

---

## 5. Security Invariants (Never Bypass)

- **Mandatory Sandboxing:** Procedural scripts must execute inside a dedicated Web Worker (`sandbox="worker"`) or opaque-origin iframe + Worker (`sandbox="iframe"`). Never evaluate author scripts in the host realm (`eval` / `new Function` on the main thread).
-   **Safe URLs & Anchor IDs Only:** Media and splat URLs in traits must pass
    `safeMediaUrl()` (`https://` or clean relative paths without `..`,
    ``\`, ``%`, or protocol-relative `//`). Gemini Live and `shared-room`WebSocket endpoints must pass`isAllowedLiveUrl()`/`isAllowedRoomUrl()` (`wss://`, or `ws://`only on`localhost`/`127.0.0.1`/`[::1]`). Persisted anchor keys and `nodeId`s must pass `safeAnchorId()`(rejecting`**proto**`, `constructor`, `prototype`,
    and control characters).
-   **Bounded Resources:** All parsers and plugins enforce hard caps
    (`MAX_PARTICLES_PER_EMITTER = 2000`, `MAX_EMITTERS = 8`,
    `MAX_STROKES = 256`, `MAX_STROKE_POINTS = 2048`, `MAX_SPLATS = 1_000_000`,
    `MAX_TRACKED_PLANES = 64`, `MAX_DETECTIONS = 32`, `MAX_TAPE_SEGMENTS = 16`,
    `MAX_DIMENSION_LABELS = 32`, `MAX_PERSISTED_NODES = 128`,
    `MAX_HASH_BYTES = 8192`, `MAX_PEERS = 16`, `MAX_PAYLOAD_BYTES = 16384`,
    `MAX_REMOTE_STROKES = 64`).
- **WebMCP Privacy:** `inspect_xr_scene` quantizes `headPosition` to `0.1m` (and omits it when `webmcp-omit-pose` is set); `capture_xr_view` only includes the 8×8 depth grid when `webmcp-allow-depth` is explicitly enabled.
