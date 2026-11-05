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

Goal                                                                                          | Element        | Recommended Bundle            | Enforced Budget
:-------------------------------------------------------------------------------------------- | :------------- | :---------------------------- | :-------------:
`.glb` / `.usdz` 3D viewer + 1-tap AR handoff (no scripting)                                  | `<three-live>` | `three-live-viewer.min.js`    | `< 29 KB gz`
Procedural `<script type="text/three">` + `InstancedMesh` + `KHR_interactivity` + AR          | `<three-live>` | `three-live.min.js`           | `< 61 KB gz`
Add-on: PBR Next, HDRI/SH, `bloom`/`outline`, `KHR_materials_variants`, `meshopt`, hotspots   | `<three-live>` | `three-live-studio.min.js`    | `< 24 KB gz`
Add-on: 2D `Shape`/`ExtrudeGeometry`, 3D `CSG` BSP Booleans, 3D stroke-font `TextGeometry`    | `<three-live>` | `three-live-cad.min.js`       | `< 10 KB gz`
Add-on: 64-joint skinning, morph targets, keyframe cross-fading, 2-bone/FABRIK `IKSolver`     | `<three-live>` | `three-live-animation.min.js` | `< 11 KB gz`
Full 3D viewer + studio + CAD/CSG/Text + animation + IK                                       | `<three-live>` | `three-live-full.min.js`      | `< 97 KB gz`
6DoF WebXR + spatial traits (`grab`, `scale`, `billboard`, `anchor`) + `<div slot="spatial">` | `<xr-live>`    | `xr-live.min.js`              | `< 72 KB gz`
Add-on: hardware XR depth occlusion, heightfield physics, 25-joint hands, simulator, WebMCP   | `<xr-live>`    | `xr-live-sensors.min.js`      | `< 10 KB gz`
Add-on bundle with all 14 modular `<xr-live>` spatial UX, world, splat & AI plugins           | `<xr-live>`    | `xr-live-spatial.min.js`      | `< 57 KB gz`
Add-on bundle with the 5 simulation plugins (character, agents, hit zones, objectives, audio) | `<xr-live>`    | `xr-live-sim.min.js`          | `< 22 KB gz`
Full Spatial Computing + Depth Physics + 25-Joint Hands + all 14 spatial + 5 sim plugins      | `<xr-live>`    | `xr-live-full.min.js`         | `< 184 KB gz`

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
      character: { mode: 'third-person', speed: 4.5, jumpVelocity: 5.5, radius: 0.35, height: 1.6 },
      agent: { behavior: 'patrol', speed: 2.2, waypoints: [[-2, 0, -2], [2, 0, -2]], alertBehavior: 'chase' },
      integrity: { max: 100, group: 'hazard', scoreValue: 25, removeOnDeplete: true },
      zone: { shape: 'cylinder', radius: 1.2, height: 2.0, action: 'checkpoint', color: '#22c55e' },
      spawner: { template: 'DroneTemplate', intervalSec: 4, maxActive: 4, maxTotal: 12 },
      objective: { id: 'step-1', label: 'Reach checkpoint', type: 'reach', points: 50, order: 1 },
      audioCues: { onHit: 'thud', onDeplete: 'buzz', onObjective: 'chime', onScenarioPass: 'sweep' },
      bloom: { strength: 1.4, threshold: 0.75, radius: 0.5 }, // HDR emissive bloom (or host `bloom` attr)
      outline: { color: '#38bdf8', thickness: 0.03 }, // inverted-hull or screen-space silhouette outline
      ik: { root: 'Shoulder', mid: 'Forearm', effector: 'WristEffector', target: 'GripperTarget', pole: 'ElbowPole' }, // 2-bone / FABRIK IK
      text: { text: '3D Label', size: 0.18, depth: 0.04, bevelEnabled: true }, // 3D extruded vector text trait
    };
    ```
5.  **Procedural CAD, Instancing & IK Helpers (`THREE` in
    `<script type="text/three">`):**

    -   **2D Shapes & Extrusion:** `new THREE.Shape()`,
        `shape.moveTo/lineTo/quadraticCurveTo/bezierCurveTo/absarc()`,
        `shape.holes.push(holePath)`, `new THREE.ExtrudeGeometry(shape, { depth,
        bevelEnabled, bevelThickness, bevelSize, bevelSegments })`.
    -   **CSG Booleans:** `THREE.CSG.union(meshA, meshB)`,
        `THREE.CSG.subtract(meshA, meshB)`, `THREE.CSG.intersect(meshA, meshB)`
        (returns a new `THREE.Mesh` with normals; polygon soup, not guaranteed
        manifold).
    -   **3D Extruded Text:** `new THREE.TextGeometry('HELLO', { size: 0.3,
        depth: 0.06, bevelEnabled: true })` (built-in stroke/contour vector
        font).
    -   **GPU Instancing:** `const inst = new THREE.InstancedMesh(geo, mat,
        count); inst.setMatrixAt(i, mat4); inst.setColorAt(i, color);` (exports
        `EXT_mesh_gpu_instancing` and USDZ `PointInstancer`; the WebGL2 renderer
        draws each primitive with one `drawElementsInstanced`).
    -   **Inverse Kinematics:** `THREE.IKSolver.solveTwoBone(rootPos, midPos,
        effPos, targetPos, polePos)` and `THREE.IKSolver.solveFABRIK(positions,
        lengths, targetPos, iterations, tolerance)` (or declarative
        `userData.xr.ik`).
6.  **Use `mesh.userData.interactivity` for `KHR_interactivity` behavior
    graphs:**

    ```js
    mesh.userData.interactivity = {
     onSelect: [
       { action: 'toggleTransform', property: 'rotation', to: [0, 0.7071, 0, 0.7071], duration: 0.4 },
       { action: 'cycleMaterialColor', colors: [[0.2, 0.6, 1, 1], [1, 0.3, 0.5, 1]], duration: 0.25 },
     ],
    };
    ```
7.  **Respect sandbox quotas:** Max `1,000` meshes, `100,000` vertices,
    `300,000` indices, `16` textures (`2048x2048` max), `1 MiB` script size, and
    `3,000 ms` execution timeout.

---

## 3. Cross-Platform Architecture & 3-Target Parity Contract

Every procedural scene and `userData.xr` trait runs across **Web**, **Android**, and **iOS / visionOS**:

1.  **Canonical Trait Schema (`three-live/src/xr-trait-schema.ts` &
    `three-live/src/xr-sim-schema.ts`):**
    -   Single source of truth for normalizing and clamping `userData.xr` fields
        (`normalizeXRTraits()`, `normalizeXRSimTraits()`), emitting glTF
        `nodes[i].extras.xr` + `nodes[i].extensions.ANDROID_xr_scenecore`
        (`buildXRSceneCoreExtension()`), and flattening USDZ
        `customData = {dictionary xr = {...}}` (`flattenXRTraitsForUsd()`).
2. **Web Runtime (`three-live/src/` & `xr-live/src/`):**
    -   `<three-live>` (`three-live/src/three-live-element.ts`) and `ThreeView`
        (`three-live/src/three-view.ts`) provide WebGL2 PBR rendering,
        `EXT_mesh_gpu_instancing` (`drawElementsInstanced`), 5 tone-mapping
        curves (`neutral`, `aces`, `agx`, `reinhard`, `none`), built-in
        `EXT_meshopt_compression` decoding
        (`three-live/src/plugins/meshopt.ts`), `KHR_materials_variants`
        (`three-live/src/plugins/variants.ts`), HDR bloom & silhouette outlines
        (`three-live/src/plugins/postprocessing.ts`), analytical 2-bone & FABRIK
        IK (`three-live/src/plugins/ik.ts`), Worker/iframe sandboxing, and
        plugin hooks (`three-live/src/plugin.ts`).
    -   `<xr-live>` (`xr-live/src/xr-live-element.ts`), the 14 spatial plugins
        (`xr-live/src/plugins/index.ts`: `head-follow`, `manipulation-handles`,
        `world-understanding`, `gemini-live`, `spatial-paint`,
        `depth-particles`, `splat-loader` with 3D covariance + SH degree 1–3,
        `spatial-measure`, `magnetic-snap`, `gaze-dwell`, `exploded-view`,
        `persistent-anchors`, `spatial-locomotion`, `shared-room` with opt-in
        WebRTC voice signaling), and the 5 `xr-live-sim` simulation plugins
        (`xr-live/src/sim/index.ts`: `character-controller`, `steering-agents`,
        `hit-zones`, `objectives`, `synth-audio`) implement 6DoF WebXR, desktop
        simulation, and interactive scenarios.
3. **In-Process Rust Compiler (`compiler/`):**
    -   Embeds `compiler/assets/three-author-engine.min.js` inside an isolated
        Boa JS context with strict opcode/wall-clock watchdogs, outputting
        `.glb` (including `EXT_mesh_gpu_instancing` and
        `KHR_materials_variants`) and `.usdz` (including `PointInstancer` and
        `VariantSets`) bytes via C FFI (`compiler/include/three_live.h`) and
        `three-live-cli`.
4. **Native Mobile SDKs (`mobile/android/` & `mobile/ios/`):**
    -   **Android (`mobile/android/src/main/java/com/google/threelive/`):**
        `XRLiveSceneCoreHelper.kt`, `XRSpatialMath.kt`, `XRSpatialFeatures.kt` +
        modular feature controllers (`SpatialMeasure.kt`, `MagneticSnap.kt`,
        `GazeDwell.kt`, `ExplodedView.kt`, `PersistentAnchors.kt`,
        `SpatialLocomotion.kt`, `SharedRoom.kt`, `IKSolver.kt`),
        `XRSimWorld.kt` + simulation controllers (`CharacterController.kt`,
        `SteeringAgents.kt`, `HitZones.kt`, `Objectives.kt`, `SynthAudio.kt`,
        `XRSimParity.kt`, `XRSimRenderBridge.kt`), `XRLiveRuntimeSession.kt`,
        and `mobile/android-filament/` (`ThreeLiveFilamentRenderer.kt`).
    -   **iOS & visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`):**
        `XRLiveRuntimeSession.swift`, `XRLiveRealityKitSession.swift`,
        `XRSpatialRealityKitFeatures.swift` + modular feature controllers
        (`SpatialMeasure.swift`, `MagneticSnap.swift`, `GazeDwell.swift`,
        `ExplodedView.swift`, `PersistentAnchors.swift`,
        `SpatialLocomotion.swift`, `SharedRoom.swift`, `IKSolver.swift`),
        `XRSimWorld.swift` + simulation controllers
        (`CharacterController.swift`, `SteeringAgents.swift`, `HitZones.swift`,
        `Objectives.swift`, `SynthAudio.swift`, `XRSimRealityKitBridge.swift`),
        and `XRLiveRealityKit.swift`.

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

### 4.1 AI Agent Verification Loop (Closed-Loop CLI)

Whenever you author or modify a `<script type="text/three">` scene or `.html`
demo, verify it headlessly without a browser using `three-live-cli`:

```bash
# 1. Static + Spatial Linting (Structured JSON Diagnostics TL100-TL402 + Frustum/Grounding/Lighting)
three-live-cli validate scene.js --json

# 2. Visual Verification (2x2 Orthographic + Camera Contact Sheet with 1m Grid & AABB Annotations)
three-live-cli render scene.js -o preview.png --view=quad --grid --annotations

# 3. Temporal & Interactive Verification (4-Frame Filmstrip PNG or Animated GIF89a)
three-live-cli render scene.js -o anim.png --frames=4 --duration=2.0 --trigger-select=crystal

# 4. Headless 60Hz Scenario & KHR_interactivity Simulation
three-live-cli sim scene.js --duration=5.0 --actions='[{"at":0.5,"type":"select","target":"crystal"}]' --json
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
