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

# LLM & Agent Authoring Guide (`three-live` & `xr-live`)

This guide is designed for **LLMs, coding assistants, and autonomous agents**
generating 3D and Spatial Computing (AR/VR/XR) code with `<three-live>` and
`<xr-live>`.

- **Repository Agent Instructions:** [`AGENTS.md`](../AGENTS.md)
- **Installable Agent Skills:**
  - [`skills/three-live-authoring/SKILL.md`](../skills/three-live-authoring/SKILL.md) (building 3D/XR scenes and apps)
  - [`skills/xr-live-plugin-dev/SKILL.md`](../skills/xr-live-plugin-dev/SKILL.md) (contributing cross-platform traits and plugins)
- **Single-File Context Feeds:** [`/llms.txt`](../llms.txt) (concise index) and [`/llms-full.txt`](../llms-full.txt) (complete reference)

You can copy the **System Prompt Snippet** below directly into any LLM prompt or
agent skill to guarantee valid, zero-hallucination output.

--------------------------------------------------------------------------------

## Copy-Paste System Prompt Snippet for LLMs

```markdown
You are authoring 3D and Spatial Computing scenes using Google's `three-live` and `xr-live` web components.

### 1. Choose the Right Component & Bundle
- Use `<three-live>` (`three-live.min.js` or `three-live-full.min.js`) for 3D product viewers, procedural Three.js scenes, `KHR_interactivity` behavior graphs, PBR Next materials, and 1-tap mobile AR handoff (Quick Look / Scene Viewer / WebXR).
- Use `<xr-live>` (`xr-live.min.js` or `xr-live-full.min.js`) when the scene requires interactive 6DoF WebXR, declarative spatial traits (`userData.xr`), spatial HTML cards (`<div slot="spatial">`), depth occlusion & physics (`xr-depth`), 25-joint hand tracking (`xr-hands`), any of the 15 spatial plugins (`head-follow`, `manipulation-handles`, `world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`, `exploded-view`, `persistent-anchors`, `spatial-locomotion`, `shared-room`, `spatial-audio`), or any of the 6 `xr-live-sim` simulation plugins (`character-controller`, `steering-agents`, `rigid-body`, `hit-zones`, `objectives`, `synth-audio`; available in `xr-live-sim.min.js` and `xr-live-full.min.js`).

### 2. Procedural `<script type="text/three">` Rules
- Inside `<script type="text/three">`, the globals `THREE` and `scene` (a `THREE.Scene` instance) are pre-defined.
- ALWAYS add the `allow-client-scripts` attribute to any `<three-live>` or `<xr-live>` element that contains an inline `<script type="text/three">`; without it the script is refused and nothing renders.
- Add all meshes, groups, and lights directly to `scene.add(...)`, and give interactive meshes a unique `mesh.name = '...'`.
- Attach canonical spatial traits via `mesh.userData.xr = { ... }`:
  - `grab`: `'1-hand' | '2-hand' | true`
  - `scale`: `{ min: 0.1, max: 5.0 } | true`
  - `billboard`: `'capsule' | 'cylindrical' | 'spherical' | true`
  - `follow`: `'head' | 'hand-left' | 'hand-right'` or `{ mode: 'head', lazy: true, distance: 1.2, deadzoneDeg: 15, stiffness: 6, height: -0.1, faceUser: true }`
  - `anchor`: `'floor' | 'wall' | 'ceiling' | 'table' | 'horizontal' | 'vertical'` or `{ target: 'table', id: 'part-1', persist: true }`
  - `physics` / `rigidBody`: `'dynamic' | 'static' | 'kinematic' | true` or `{ body: 'dynamic' | 'static' | 'kinematic', shape: 'auto' | 'box' | 'sphere' | 'cylinder', mass: 1, restitution: 0.35, friction: 0.5, linearDamping: 0.05, angularDamping: 0.1, gravityScale: 1, velocity: [0, 0, 0], angularVelocity: [0, 0, 0], lockRotation: false }`
  - `joint`: `'hinge' | 'slider' | 'spring' | 'ball' | true` or `{ type: 'hinge' | 'slider' | 'spring' | 'ball', target: 'nodeName' | 'world', anchor: [0, 0, 0], axis: 'x' | 'y' | 'z' | [0, 1, 0], limits: [-45, 90], stiffness: 40, damping: 4, restLength: 0.5, motorSpeed: 0, motorMaxForce: 10 }`
  - `orbit`: `{ target: [x, y, z] | 'nodeName', radius: 0.5, speed: 0.8, height: 0, faceCenter: true }`
  - `handles`: `{ rotateAxis: 'y' | 'none', minScale: 0.2, maxScale: 3.0 } | true`
  - `dimensions`: `{ unit: 'auto' | 'm' | 'cm' | 'mm' | 'in' | 'ft-in', axes: ['x', 'y', 'z'], color: '#38bdf8', showOnSelect: false } | true`
  - `snapTo`: `{ grid: 0.05, angleDeg: 15, surface: 'floor' | 'wall' | 'ceiling' | 'any' | 'none', socketTag: 'dock', radius: 0.15 } | true`
  - `snapSocket`: `'dock'` or `{ tag: 'dock', radius: 0.15, alignRotation: true, highlightColor: '#22c55e' }`
  - `gaze`: `{ dwellMs: 1200, action: 'select' | 'ask', repeat: false } | true`
  - `explode`: `{ direction: [0, 1, 0], distance: 0.35, layer: 1, leaderLine: true } | boolean`
  - `navigable`: `true | 'walkable' | 'blocked'`
  - `sync`: `boolean` (multi-user `shared-room` transform sync; defaults to `true` on grabbable nodes)
  - `particles`: `{ preset: 'rain' | 'snow' | 'sparks' | 'confetti', count: 400, area: [2, 2, 2], speed: 1.0 }`
  - `holdToAsk`: `{ prompt: 'What is this?', holdMs: 600 } | true`
  - `worldUnderstanding`: `{ planes: true, meshes: false, reticle: true }`
  - `splatUrl`: `'https://.../capture.spz'` (or `.splat`)
  - `splat`: `{ url: 'https://.../capture.spz', shDegree: 3, maxSplats: 500000 }`
  - `bloom`: `{ strength: 1.2, threshold: 0.8, radius: 0.5 } | boolean | number`
  - `outline`: `{ color: '#38bdf8', thickness: 0.03 } | boolean | string`
  - `ik`: `{ root: 'RootNode', mid: 'MidNode', effector: 'EffectorNode', target: 'TargetNodeName' | [x, y, z], pole: 'PoleNodeName' | [x, y, z], solver: 'two-bone' | 'fabrik', iterations: 10, tolerance: 0.001, weight: 1 }`
  - `lod`: `true` or `[0, 5, 12]` or `{ distances: [0, 5, 12], ratios: [1.0, 0.4, 0.15], cullDistance: 30, hysteresis: 0.05 }` (also `new THREE.LOD()` with `.addLevel(obj, distance)`)
  - `text`: `{ text: '3D Label', size: 0.2, depth: 0.04, bevelEnabled: true }`
  - `audioEmitter` / `audio`: `'hum'` or `{ preset: 'hum' | 'reactor' | 'wind' | 'beacon' | 'geiger' | 'chimeLoop' | 'machinery' | 'water' | 'confirm', src: 'https://.../sound.mp3', volume: 0.7, loop: true, autoplay: true, playOnSelect: false, distanceModel: 'inverse' | 'linear' | 'exponential', refDistance: 1.0, maxDistance: 20.0, rolloffFactor: 1.0, coneInnerAngle: 360, coneOuterAngle: 360, coneOuterGain: 0, pitchHz: 440 }`
  - `character`: `true` or `{ mode: 'third-person' | 'first-person' | 'top-down' | 'fixed-camera', speed: 4, jumpVelocity: 5.5, gravity: 15, radius: 0.35, height: 1.7, cameraDistance: 3.5, cameraHeight: 1.6 }`
  - `agent`: `'patrol'` or `{ behavior: 'patrol' | 'chase' | 'flee' | 'follow' | 'wander', speed: 2.5, waypoints: [[x, y, z], ...], loop: true, sightDistance: 8, sightAngleDeg: 110, reachDistance: 0.6, target: 'character' | 'nodeName', alertBehavior: 'chase' }`
  - `integrity`: `100` or `{ max: 100, current: 100, group: 'hazard' | 'player' | 'prop', scoreValue: 25, removeOnDeplete: true, hitCooldownMs: 120, contactAmount: 25 }`
  - `zone`: `{ shape: 'box' | 'sphere' | 'cylinder', size: [2, 2, 2], radius: 1.5, height: 2, triggerGroup: 'player', action: 'checkpoint' | 'hazard' | 'complete' | 'fail' | 'event', ratePerSec: 20, once: false, color: '#22c55e' }`
  - `spawner`: `{ template: 'BotNode', intervalSec: 3, maxActive: 5, maxTotal: 15, radius: 1.5, autoStart: true }`
  - `objective`: `'Inspect valve'` or `{ id: 'valve-1', label: 'Inspect valve', type: 'reach' | 'clear' | 'collect' | 'activate' | 'hold', points: 50, order: 1, required: true, holdSec: 1.5, reachRadius: 1.2 }`
  - `audioCues`: `{ onHit: 'thud', onDeplete: 'buzz', onCollect: 'chime', onObjective: 'beep', onJump: 'whoosh', onScenarioPass: 'sweep', onScenarioFail: 'alarm', pitchHz: 440, gain: 0.7 }`
- Attach declarative `KHR_interactivity` behaviors via `mesh.userData.interactivity = { onSelect: [...], onHoverIn: [...], onStart: [...] }` using actions `toggleTransform`, `interpolate`, `setProperty`, `toggleVisibility`, `cycleMaterialColor`, `playAnimation`, `stopAnimation`, or `sendEvent`.
- NEVER use `GLTFLoader`, `OBJLoader`, `TextureLoader`, `EffectComposer`, `ShaderMaterial`, `RawShaderMaterial`, or `requestAnimationFrame` inside `<script type="text/three">`.
- NEVER create a `THREE.WebGLRenderer` or attach DOM canvas elements inside `<script type="text/three">`.
- Respect strict scene quotas: max 1,000 meshes, 100,000 vertices, 300,000 indices, 16 textures, 3-second execution timeout.

### 3. Allowed `THREE.*` Constructors inside `<script type="text/three">`
- Math & IK: `Vector2`, `Vector3`, `Vector4`, `Euler`, `Quaternion`, `Matrix3`, `Matrix4`, `Color`, `MathUtils`, `Clock`, `IKSolver` (`solveTwoBone`, `solveFABRIK`)
- Geometries & CAD: `BoxGeometry`, `PlaneGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`, `TorusKnotGeometry`, `LatheGeometry`, `TubeGeometry`, `Shape`, `Path`, `ShapeGeometry`, `ExtrudeGeometry`, `TextGeometry`, `CSG` (`union`, `subtract`, `intersect`), `BufferGeometry`, `BufferAttribute`
- Materials: `MeshStandardMaterial`, `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshPhysicalMaterial` (plus `mesh.userData.variants` for `KHR_materials_variants`)
- Material presets (`procedural` plugin; built into the CLI/MCP compiler): spread `THREE.ProceduralTexture.wood({ color: 0x8b5a2b, scale: 10, seed: 3 })` (also `marble`, `brick`, `concrete`, `brushedMetal`, `rust`, `leather`, `fabric`, `carbonFiber`, `checkerboard`, `grid`) into `MeshStandardMaterial` for seamless, deterministic `map` + `normalMap` + roughness/metalness textures, or set `mesh.userData.xr = { material: 'marble' }` to bake a preset tinted by the material color (when non-white). Each preset adds up to 3 textures against the 16-texture scene quota: identical options return shared textures, and `normalStrength: 0` skips the normal map.
- Scene Graph, LOD & Instancing: `Scene`, `Group`, `Mesh`, `LOD` (`addLevel`, `getObjectForDistance`), `InstancedMesh` (`setMatrixAt`, `getMatrixAt`, `setColorAt`, `getColorAt`, `count`), `Object3D` (`position`, `rotation`, `scale`, `matrix`, `add`, `remove`, `traverse`)
- Lights & Cameras: `AmbientLight`, `DirectionalLight`, `PointLight`, `Camera`, `PerspectiveCamera`
```

--------------------------------------------------------------------------------

## DO vs. DO NOT Cheat Sheet

| DO (Supported & Fast) | DO NOT (Unsupported / Anti-Pattern) |
| :------------------------------------------------------------------------------ | :------------------------------------------------------------------ |
| Use `new THREE.MeshStandardMaterial({ color, metalness, roughness })` | Do NOT use `THREE.ShaderMaterial` or custom GLSL strings in scripts |
| Add objects to the global `scene` (`scene.add(mesh)`) | Do NOT instantiate `new THREE.WebGLRenderer()` or call `renderer.render()` |
| Set `mesh.userData.xr = { grab: '2-hand', handles: { rotateAxis: 'y' } }` | Do NOT write manual WebXR session setup (`navigator.xr.requestSession`) |
| Set `mesh.userData.interactivity = { onSelect: [{ action: 'toggleTransform', ... }] }` | Do NOT try to access `window` or `document` inside sandboxed `<script type="text/three">` |
| Use `<div slot="spatial" data-position="x y z" data-xr-traits="grab billboard">` for spatial HTML UI | Do NOT use `new THREE.GLTFLoader().load(...)` inside procedural scripts (use `src="..."` or `<xr-anchor src="...">`) |

### Permissive Fallback Shims & Diagnostic Warnings (JS & Rust Compiler)

While LLMs should prefer the canonical APIs above for highest fidelity, both the
JavaScript authoring runtime (`three-author`) and the native Rust compiler
(`compiler/`) include **permissive fallback shims** so common LLM-generated
Three.js assumptions never crash or abort a 3D/XR scene:

-   **Shaders (`ShaderMaterial`, `RawShaderMaterial`):** Gracefully downgraded
    to `MeshStandardMaterial`, preserving `uniforms.color.value` /
    `params.color` and opacity so the mesh renders in 3D and XR.
-   **Polyhedra & Extended Geometries (`IcosahedronGeometry`,
    `OctahedronGeometry`, `DodecahedronGeometry`, `TetrahedronGeometry`,
    `CapsuleGeometry`, `RingGeometry`, `CircleGeometry`):** Mapped to
    parameter-compatible `SphereGeometry` or `CylinderGeometry` primitives.
-   **Lights (`SpotLight`, `HemisphereLight`, `RectAreaLight`):** Mapped to
    `PointLight` or `AmbientLight`.
-   **Unknown / Hallucinated Classes:** Any unknown `THREE.*` class resolves to
    a safe recursive no-op proxy, and `new THREE.Mesh(geo, mat)` automatically
    substitutes a fallback `BoxGeometry` / `MeshStandardMaterial` if passed a
    non-geometry or non-material proxy.
-   **Browser Boilerplate (`requestAnimationFrame`, `window`, `document`):**
    Safely shimmed in headless/Worker/Rust sandboxes so trailing render loops
    (`requestAnimationFrame(animate)`) or `window.innerWidth /
    window.innerHeight` checks do not throw `ReferenceError`.
-   **Diagnostic Warnings:** Every degraded feature logs a deduplicated
    `console.warn` and is recorded in `THREE.getAuthorWarnings()` (reset via
    `THREE.clearAuthorWarnings()`).

--------------------------------------------------------------------------------

## Canonical Few-Shot Templates

### Template 1: Interactive 3D Scene with `KHR_interactivity` & AR Handoff (`<three-live>`)

```html
<script type="module" src="/dist/three-live-full.min.js"></script>

<three-live allow-client-scripts camera-controls ar auto-rotate shadow-intensity="0.7" style="width: 100%; height: 500px; display: block;">
  <script type="text/three">
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.7, 0.2, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 })
    );
    base.name = 'pedestal';
    scene.add(base);

    const crystal = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.1, roughness: 0.1 })
    );
    crystal.name = 'crystal';
    crystal.position.set(0, 0.55, 0);
    crystal.userData.interactivity = {
      onSelect: [
        { action: 'toggleTransform', property: 'translation', from: [0, 0.55, 0], to: [0, 0.85, 0], duration: 0.35 },
        { action: 'cycleMaterialColor', colors: [[0.22, 0.74, 0.97, 1], [0.66, 0.33, 0.97, 1]], duration: 0.25 }
      ]
    };
    scene.add(crystal);

    const light = new THREE.DirectionalLight(0xffffff, 2.0);
    light.position.set(2, 4, 3);
    scene.add(light);
  </script>
</three-live>
```

### Template 2: Full Spatial Computing Scene with Extended XR Traits (`<xr-live>`)

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  xr-mode="ar"
  xr-depth="occlusion-physics"
  xr-hands="gestures"
  xr-simulator="living-room"
  world-understanding="planes reticle"
  spatial-paint="#38bdf8"
  camera-controls
  style="width: 100%; height: 600px; display: block;">

  <!-- Interactive procedural 3D objects with canonical userData.xr traits -->
  <script type="text/three">
    const sculpture = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.18, 0.06, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.6, roughness: 0.25 })
    );
    sculpture.name = 'sculpture';
    sculpture.position.set(0, 1.1, -1.0);
    sculpture.userData.xr = {
      grab: '2-hand',
      handles: { rotateAxis: 'y', minScale: 0.3, maxScale: 3.0 },
      holdToAsk: { prompt: 'What is this sculpture?', holdMs: 600 }
    };
    scene.add(sculpture);

    const satellite = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
    );
    satellite.name = 'satellite';
    satellite.userData.xr = {
      orbit: { target: 'sculpture', radius: 0.38, speed: 1.0, faceCenter: true }
    };
    scene.add(satellite);
  </script>

  <!-- Live HTML spatial card floating next to the 3D object -->
  <div slot="spatial" data-position="0.45 1.1 -1.0" data-xr-traits="grab billboard">
    <div style="padding: 14px; background: #111827; color: #f9fafb; border-radius: 12px; width: 220px;">
      <h4>Spatial Control Panel</h4>
      <p>Drag corner handles to scale, or pinch in empty space to paint in 3D.</p>
      <button onclick="console.log('Clicked in 3D space!')">Inspect Details</button>
    </div>
  </div>
</xr-live>
```

### Template 3: Collaborative CAD Studio (`exploded-view` + `spatial-measure` + `magnetic-snap` + `shared-room`)

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  spatial-measure="all"
  measure-unit="cm"
  magnetic-snap="all"
  gaze-dwell="auto"
  explode="0.4"
  explode-mode="axial-y"
  section-plane="x:0"
  persistent-anchors="cad-review"
  persist-url-hash
  locomotion="teleport snap-turn"
  shared-room="cad-review-room"
  peer-name="Reviewer"
  peer-color="#38bdf8"
  camera-controls
  style="width: 100%; height: 600px; display: block;">
  <script type="text/three">
    const deck = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 0.04, 48),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 })
    );
    deck.name = 'walkable-deck';
    deck.position.set(0, -0.45, -1.2);
    deck.userData.xr = { navigable: 'walkable', explode: false, sync: false };
    scene.add(deck);

    const chassis = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.32, 0.16, 36),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.25 })
    );
    chassis.name = 'turbine-chassis';
    chassis.position.set(0, 0.75, -1.2);
    chassis.userData.xr = {
      dimensions: { unit: 'cm', axes: ['x', 'y', 'z'] },
      snapSocket: { tag: 'rotor-bay', radius: 0.18, highlightColor: '#22c55e' },
      explode: false
    };
    scene.add(chassis);

    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.22, 36),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.65, roughness: 0.2 })
    );
    shroud.name = 'upper-shroud';
    shroud.position.set(0, 0.96, -1.2);
    shroud.userData.xr = {
      grab: '1-hand',
      snapTo: { socketTag: 'rotor-bay', radius: 0.18, angleDeg: 15 },
      explode: { direction: [0, 1, 0], distance: 0.32, layer: 2, leaderLine: true },
      gaze: { dwellMs: 1000, action: 'select' },
      anchor: { id: 'upper-shroud', persist: true },
      sync: true
    };
    scene.add(shroud);

    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2, 4, 3);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## 5. Closed-Loop AI Agent Verification (`three-live-cli` & MCP Server)

AI coding agents can validate, visually inspect, and simulate
`<script type="text/three">` scenes, `.html` host documents, and `.glb` files in
under `50 ms` without launching a headless browser—either via CLI subcommands or
via the built-in **Model Context Protocol (MCP)** stdio server
(`three-live-cli mcp`):

```bash
# Register the MCP stdio server in Claude Code, Cursor, Gemini CLI, or Windsurf:
claude mcp add three-live -- npx -y -p three-live three-live-cli mcp
```

Or add to `.mcp.json` / `claude_desktop_config.json` / `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "three-live": {
      "command": "npx",
      "args": ["-y", "-p", "three-live", "three-live-cli", "mcp"]
    }
  }
}
```

The MCP server exposes 8 tools (`three_live_validate`, `three_live_render`,
`three_live_convert`, `three_live_sim`, `three_live_link`, `three_live_gym_reset`,
`three_live_gym_step`, `three_live_gym_close`), 1 resource
(`three-live://docs/authoring-guide`), and 2 prompts (`author_three_live_scene`,
`build_from_reference`). Note that `three_live_render` returns MCP `image/png`
content blocks directly into multimodal LLM context so agents can visually
self-correct camera framing, overlap, and lighting.

### Reference-Driven Authoring (`reference`)

When the user supplies a photo, product shot, design mockup, sketch, or CAD
blueprint, pass it to `three_live_render` as `reference` (a local PNG/JPEG path
or a `data:image/...;base64,` URI; remote URLs are never fetched):

```json
{ "name": "three_live_render",
  "arguments": { "inputPath": "lamp.js", "reference": "lamp_photo.jpg", "view": "camera" } }
```

-   The scene renders at the reference's aspect ratio into a **REFERENCE |
    RENDER | OVERLAY | SILHOUETTE DIFF** sheet. On plain or transparent
    backgrounds the OVERLAY is auto-aligned for position and scale, and the DIFF
    panel marks render-only areas orange and reference-only areas cyan.
-   The JSON `reference` block reports `silhouetteIou` (scale/translation
    invariant), `referenceAspect` / `renderAspect` / `aspectError`,
    `silhouetteReliable`, and `guidance`. Aim for `silhouetteIou >= 0.85` and
    `|aspectError| < 0.05` when `silhouetteReliable` is true; for busy photo
    backgrounds or line-art sketches, judge by the OVERLAY panel.
-   Use `view: "front" | "right" | "top"` for orthographic blueprints and
    `view: "camera"` (default) for perspective photos, tuning `cameraPosition`,
    `cameraTarget`, and `cameraFov` to match the photo's perspective.
-   JPEG EXIF orientation is honored; PNG supports every color type, bit depth,
    transparency, and Adam7 interlacing.

You can also invoke the CLI directly from shell tools:

```bash
# 1. Structured JSON Diagnostics (TL100-TL402) + Spatial Frustum/Grounding/Lighting Linter
three-live-cli validate scene.js --json

# 2. 4-Up Quad Contact Sheet (Perspective + Front + Right + Top with 1m Grid & AABB Labels)
three-live-cli render scene.js -o preview.png --view=quad --grid --annotations

# 3. Multi-Frame Temporal Filmstrip or Animated GIF89a (`animate(t)` + KHR_interactivity Tweens)
three-live-cli render scene.js -o anim.png --frames=4 --duration=2.0 --trigger-select=crystal

# 4. Deterministic 60Hz Scenario & KHR_interactivity Simulation
three-live-cli sim scene.js --duration=5.0 \
  --actions='[{"at":0.2,"type":"select","target":"crystal"},{"at":0.5,"type":"moveCharacter","direction":[0,0,-1],"duration":1.5,"jump":true}]' \
  --json
```

### Closed-Loop Agent Gym (`three_live_gym_reset` / `three_live_gym_step`)

`three_live_sim` runs a script you write up front. The gym lets an agent *play*
a scene instead: act, look at the result, and decide the next action, like a
reinforcement-learning environment. Use it to check that a level is winnable,
tune enemy speed or jump heights, or test interactive scenes end to end.

```json
{ "name": "three_live_gym_reset",
  "arguments": { "inputPath": "level.js", "watch": ["Hero", "Coin"] } }
// -> { "sessionId": "gym-1", "tick": 0, "scenarioState": "running", "bodies": [...] }

{ "name": "three_live_gym_step",
  "arguments": { "sessionId": "gym-1", "ticks": 30,
                 "actions": [{ "type": "moveCharacter", "direction": [0, 0, -1], "jump": true }] } }
// -> { "tick": 30, "reward": 5, "events": ["objectiveComplete:Coin"],
//      "newObjectives": ["Coin"], "done": true, "scenarioState": "victory", ... }
```

-   Each step applies `actions` (same shapes as `three_live_sim`; `at` is a
    delay in seconds from the start of the step) and advances `ticks` 60 Hz
    ticks (default 30, max 600). `moveCharacter` lasts the whole step unless
    you pass `duration`.
-   Every observation lists `bodies` (position, rotation, scale, visible,
    grounded, health, destroyed; at most 64, use `watch` to choose), `score`,
    `reward` (score gained this step), and the `events`, `audioCues`, and
    `newObjectives` fired during the step.
-   `done` turns true on `victory` (all `required: true` objectives done),
    on `defeat` (the character is destroyed), or at the 120 s / 240-step limit.
    Further steps fail; call `three_live_gym_reset` again.
-   Pass `includeFrame: true` (with `view`, `width`, `height`) to get a PNG of
    the state after the step.
-   The reset observation lists the `events` and `audioCues` fired at `t = 0`
    (`onSpawn`, `onStart`, trait registrations).
-   Episodes are deterministic: the same actions always give the same
    observations. Steps on static scenes are near-instant; scenes with
    `animate(t)` or `requestAnimationFrame` re-run their script once per step
    (about 0.2 s), so prefer fewer, longer steps there. Close sessions you
    are done with (`three_live_gym_close`); beyond 16 the least recently used
    is evicted.

Without MCP, use `three-live-cli gym`. One command per step suits shell-tool
agents; the session file holds the scene and every step, and each call replays
it deterministically:

```bash
three-live-cli gym reset level.js --session ep.json --watch Hero,Coin
three-live-cli gym step --session ep.json --ticks 30 \
  --actions '[{"type":"moveCharacter","direction":[0,0,-1]}]' --frame step.png
```

For scripts and RL harnesses, `three-live-cli gym play level.js` prints the
`t = 0` observation, then reads one JSON step per stdin line
(`{"actions": [...], "ticks": 30, "frame": "f.png"}`) and prints one
observation (or `{"error": ...}`) per line, keeping state in memory.

### Diagnostic Code Summary (`TL100–TL402`)

| Code    | Category | Meaning & Fix                        |
| :------ | :------- | :----------------------------------- |
| `TL100` | Compiler | JavaScript syntax error, uncaught    |
:         :          : runtime exception, or sandbox quota  :
:         :          : violation (includes 1-based          :
:         :          : `line`/`column`).                    :
| `TL101` | Compiler | Unsupported material                 |
:         :          : (`ShaderMaterial`,                   :
:         :          : `RawShaderMaterial`) downgraded to   :
:         :          : `MeshStandardMaterial`.              :
| `TL102` | Compiler | Unsupported geometry                 |
:         :          : (`IcosahedronGeometry`,              :
:         :          : `OctahedronGeometry`,                :
:         :          : `DodecahedronGeometry`,              :
:         :          : `TetrahedronGeometry`,               :
:         :          : `TubeGeometry`,                      :
:         :          : `PolyhedronGeometry`) approximated   :
:         :          : as sphere/cylinder.                  :
| `TL103` | Compiler | Blocked network/loader API           |
:         :          : (`THREE.GLTFLoader`,                 :
:         :          : `TextureLoader`, `fetch`) inside     :
:         :          : sandbox; use `<three-live            :
:         :          : src="...">`.                         :
| `TL104` | Compiler | `requestAnimationFrame` used in      |
:         :          : static `.glb`/`.usdz` export; prefer :
:         :          : `userData.xr.orbit` or               :
:         :          : `userData.interactivity`.            :
| `TL105` | Compiler | Unknown `THREE.*` property           |
:         :          : intercepted by chaining proxy.       :
| `TL201` | Schema   | Unrecognized `userData.xr` or        |
:         :          : `userData.interactivity` key with    :
:         :          : Levenshtein typo suggestion (e.g.,   :
:         :          : `grabbable` -> `grab`, `onClick` ->  :
:         :          : `onSelect`).                         :
| `TL202` | Schema   | Out-of-range numeric trait clamped   |
:         :          : to valid domain (`dwellMs`,          :
:         :          : `bloom.strength`,                    :
:         :          : `outline.thickness`,                 :
:         :          : `splat.shDegree`).                   :
| `TL203` | Schema   | Unsafe URL or anchor ID rejected     |
:         :          : (`safeMediaUrl`, `isAllowedLiveUrl`, :
:         :          : `safeAnchorId`).                     :
| `TL204` | Schema   | Broken node reference                |
:         :          : (`orbit.target`, `joint.target`,     :
:         :          : `ik.root`/`mid`/`effector`/`target`, :
:         :          : `spawner.template`,                  :
:         :          : `interactivity.*.target`).           :
| `TL205` | Schema   | Unnamed interactive or spatial mesh  |
:         :          : (`mesh.name === ""`); assign a       :
:         :          : unique `mesh.name`.                  :
| `TL301` | Spatial  | Empty scene (`meshCount == 0` or     |
:         :          : `vertexCount == 0`).                 :
| `TL302` | Spatial  | Camera position is enclosed inside a |
:         :          : mesh's world AABB.                   :
| `TL303` | Spatial  | Mesh is outside the camera frustum   |
:         :          : (or scenes fill `< 1%` / `> 95%` of  :
:         :          : the viewport).                       :
| `TL304` | Spatial  | Scene diagonal is microscopic (`<    |
:         :          : 0.01 m`) or gigantic (`> 200 m`,     :
:         :          : e.g. millimeter units).              :
| `TL305` | Spatial  | Metallic PBR materials (`metalness > |
:         :          : 0.5`) with no scene lights and no    :
:         :          : `environment`.                       :
| `TL306` | Spatial  | Two non-floor sibling meshes share   |
:         :          : `> 80%` AABB intersection volume     :
:         :          : (accidental duplicate placement).    :
| `TL307` | Spatial  | Scene or `character`/`physics:       |
:         :          : "dynamic"` mesh is floating          :
:         :          : (`min.y > 0.25 m`) or buried (`min.y :
:         :          : < -0.5 m`).                          :
| `TL401` | HTML     | `<three-live>` / `<xr-live>`         |
:         :          : contains `<script                    :
:         :          : type="text/three">` without          :
:         :          : `allow-client-scripts`.              :
| `TL402` | HTML     | `<xr-live>` spatial attributes/slots |
:         :          : (`xr-hands`, `gemini-live`,          :
:         :          : `plugins`, `slot="spatial"`) placed  :
:         :          : on `<three-live>`.                   :
