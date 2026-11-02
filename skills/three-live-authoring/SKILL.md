---
name: three-live-authoring
description: >-
  Builds interactive 3D viewers, procedural Three.js scenes, AR product
  configurators, and 6DoF WebXR, Android XR, and iOS/visionOS spatial computing
  apps using <three-live> and <xr-live>. Use when creating or editing
  <three-live> or <xr-live> HTML elements, writing <script type="text/three">
  procedural scenes, configuring userData.xr spatial traits or
  userData.interactivity behavior graphs, building <div slot="spatial"> 3D HTML
  cards, or integrating native Android (Filament / Jetpack XR SceneCore) and
  iOS/visionOS (RealityKit) spatial views.
---

# Authoring 3D & Spatial Apps with `<three-live>` and `<xr-live>`

`<three-live>` and `<xr-live>` compile declarative HTML and sandboxed Three.js scripts (`<script type="text/three">`) into WebGL2/WebXR on the web, Google Filament & Jetpack XR SceneCore on Android, and Apple RealityKit & Quick Look on iOS/visionOS.

## 1. Choose the Right Component & Bundle

- **Use `<three-live>` (`three-live.min.js` or `three-live-full.min.js`)** when you need:
  - A 3D `.glb` / `.usdz` model viewer (`<model-viewer>` drop-in replacement)
  - A procedural Three.js scene with orbit controls and 1-tap mobile AR handoff (`ar`)
  - PBR Next materials (clearcoat, transmission, dispersion, iridescence, sheen, volume), `.hdr` environment lighting, ground contact shadows, skeletal animations (`three-live/animation`), or 2D screen-space hotspots (`slot="hotspot-*"`)
- **Use `<xr-live>` (`xr-live-full.min.js`)** when you need:
  - 6DoF WebXR (`xr-mode="ar"` / `"vr"` / `"auto"`) or desktop 6DoF simulation (`xr-simulator="living-room"`)
  - Declarative spatial manipulation traits (`grab`, `scale`, `billboard`, `follow`, `anchor`, `physics`, `orbit`, `handles`)
  - True 3D raycastable HTML/CSS spatial cards (`<div slot="spatial">`)
  - Real-world depth occlusion & heightfield physics (`xr-depth="occlusion-physics"`), 25-joint hand gesture recognition (`xr-hands="gestures"`), spatial 3D painting (`spatial-paint`), depth-colliding particles (`particles`), 3D Gaussian Splats (`splatUrl`), world plane/reticle understanding (`world-understanding`), or multimodal Gemini Live (`connectGeminiLive()` / `holdToAsk`).

---

## 2. Critical Rules That Prevent Broken Scenes

1. **Include `allow-client-scripts` whenever using inline `<script type="text/three">` or `executeScript()`:**
   - `<three-live>` and `<xr-live>` reject inline client scripts unless `allow-client-scripts` is present on the host element.
   - Server-hosted scripts loaded via `script-src="/path/to/scene.js"` do not require `allow-client-scripts`.
2. **Use the pre-defined `THREE` and `scene` globals inside `<script type="text/three">`:**
   - Do **not** `import * as THREE from 'three'`, do **not** create a `new THREE.WebGLRenderer()`, and do **not** call `document.body.appendChild(...)` inside `<script type="text/three">`. The script runs inside an isolated Web Worker (or Rust Boa sandbox) with zero DOM access and populates the global `scene` directly (`scene.add(mesh)`).
3. **Never use `GLTFLoader` or `TextureLoader` inside `<script type="text/three">`:**
   - Network APIs (`fetch`, `XMLHttpRequest`) are revoked inside the procedural sandbox. Load `.glb` assets declaratively via `<three-live src="model.glb">` or `<xr-anchor src="model.glb">`.
4. **Prefer `mesh.userData.xr = { ... }` over legacy `userData.xrTraits`:**
   - The structured `userData.xr` object supports all core and XR Blocks traits and exports cleanly to `.glb` (`extras.xr` + `ANDROID_xr_scenecore`) and `.usdz` (`customData.xr`).
5. **Always name interactive meshes (`mesh.name = '...'`):**
   - `meshclick` events, `selected-mesh`, `userData.xr.orbit.target`, `userData.interactivity` target references, `holdToAsk` prompts, and WebMCP `place_xr_object_at_gaze` all identify nodes by `mesh.name`.

---

## 3. Canonical `userData.xr` Trait Quick Reference

Attach `userData.xr` to any `THREE.Mesh` or `THREE.Group` inside `<script type="text/three">`:

| Trait Key | Accepted Values | Behavior |
| :--- | :--- | :--- |
| `grab` | `'1-hand' \| '2-hand' \| true` | Enables 6DoF pinch / controller trigger grabbing (`true` defaults to `'2-hand'`). |
| `scale` | `{ min?: number, max?: number } \| true` | Two-hand pinch-to-scale clamped to `[min, max]` (default `0.05`–`5.0`). |
| `billboard` | `'capsule' \| 'cylindrical' \| 'spherical' \| true` | Faces the active viewer camera (`'capsule'` / `'cylindrical'` yaw-only; `'spherical'` full 3D). |
| `follow` | `'head' \| 'hand-left' \| 'hand-right'` **or** `{ mode, lazy, distance, deadzoneDeg, stiffness, height, faceUser, snapOnStart }` | String values use eager spring follow; object values activate XR Blocks lazy follow with angular deadzone + critically damped spring. |
| `anchor` | `'floor' \| 'wall' \| 'table' \| 'horizontal' \| 'vertical'` | Snaps node to detected real-world planes or simulated room surfaces. |
| `physics` | `'dynamic' \| 'static'` | Participates in gravity, restitution (`userData.xr.restitution`), sphere-to-sphere, and real-world depth heightfield collisions. |
| `orbit` | `{ target: [x,y,z] \| 'nodeName', radius, speed, height, phase, faceCenter }` | Orbits around a 3D point or named target mesh at `speed` rad/s. |
| `handles` | `{ rotateAxis?: 'y' \| 'none', minScale?: number, maxScale?: number } \| true` | Spawns 4 top-corner uniform-scale handles and a bottom pedestal yaw-rotation bar; emits `xr-handles-change`. |
| `particles` | `{ preset: 'rain' \| 'snow' \| 'sparks' \| 'confetti', count?: number, area?: [x,y,z], speed?: number }` | Emits up to `2,000` depth-colliding particles inside `area`. |
| `holdToAsk` | `{ prompt?: string, holdMs?: number } \| true` | Press-and-hold on the mesh starts speech recognition and queries Gemini Live; emits `xr-hold-to-ask`. |
| `worldUnderstanding` | `{ planes?: boolean, meshes?: boolean, reticle?: boolean, objects?: boolean }` | Enables WebXR plane/mesh detection and gaze surface reticle (`__xr_reticle__`). |
| `splatUrl` | `'https://.../scene.splat'` or `'.spz'` | Streams and depth-sorts 3D Gaussian Splats (`.splat` or Niantic `.spz` v2/v3). |
| `audio` | `'https://.../sound.mp3'` or `{ src, refDistance?: number, loop?: boolean }` | Attaches an HRTF 3D spatial audio source to the node. |
| `pointerEvents` | `'none'` | Excludes the mesh from raycast picking so rays pass through to objects behind it. |

---

## 4. Progressive Disclosure References

Read these reference files when you need detailed schemas, copy-pasteable recipes, or debugging steps:

- **[`references/xr-traits-and-plugins.md`](references/xr-traits-and-plugins.md)**: Complete attribute tables, clamping ranges, DOM events, `userData.interactivity` (`KHR_interactivity`) actions, Gemini Live API, and WebMCP tool schemas.
- **[`references/recipes.md`](references/recipes.md)**: 6 production-ready, copy-pasteable code templates (E-commerce configurator, Physics ballpit & spatial HTML UI, XR Blocks handles & lazy HUD, Gemini Live + World Understanding, Spatial Paint + Particles + Gaussian Splats, and Native Android/iOS integration).
- **[`references/debugging-and-csp.md`](references/debugging-and-csp.md)**: Diagnosing blank scenes, inspecting `THREE.getAuthorWarnings()`, configuring Worker/iframe sandboxes under strict CSP / Trusted Types, and verifying bundle budgets.
