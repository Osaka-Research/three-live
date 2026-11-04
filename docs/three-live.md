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

# `<three-live>` Reference Guide

`<three-live>` is a lightweight WebGL2 3D viewer, procedural Three.js JIT
compiler, and `<model-viewer>` drop-in replacement with universal Augmented
Reality handoff (iOS Quick Look, Android Scene Viewer, and WebXR).

For interactive 6DoF WebXR spatial computing, declarative spatial traits
(`grab`, `scale`, `billboard`, `anchor`), spatial HTML cards (`<div
slot="spatial">`), depth/physics, and 25-joint hand tracking, see
**[`docs/xr-live.md`](xr-live.md)**. See **[`README.md`](../README.md)** for JS
bundles and entry points.

--------------------------------------------------------------------------------

## Quickstart

```html
<script type="module" src="/dist/three-live.min.js"></script>

<three-live
  src="/models/chair.glb"
  poster="/images/chair_poster.webp"
  camera-controls
  camera-orbit="30deg 20deg 3m"
  selected-mesh="cushion"
  ar
  ar-modes="quick-look scene-viewer webxr"
  auto-rotate
  style="width: 100%; height: 500px; display: block;">
</three-live>

<script>
  const viewer = document.querySelector('three-live');

  // Listen for mesh part selection
  viewer.addEventListener('meshclick', (e) => {
    console.log('Selected part:', e.detail.meshName);
  });

  // Reset camera view
  viewer.resetCamera();
</script>
```

--------------------------------------------------------------------------------

## Observed Attributes

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Attribute | Type | Bundle | Description |
| :--- | :--- | :--- | :--- |
| `src` | `string` | `three-live-viewer`+ | URL or path to binary `.glb` model. |
| `ios-src` | `string` | `three-live-viewer`+ | Optional URL or path to Apple `.usdz` model for iOS Quick Look (auto-transcoded from GLB if omitted). |
| `poster` | `string` | `three-live-viewer`+ | URL to a placeholder image shown before 3D rendering initializes. |
| `scale` | `string` | `three-live-viewer`+ | Uniform or per-axis scale multiplier `"x y z"` (e.g. `"2 2 2"`). |
| `camera-orbit` | `string` (str/JSON) | `three-live-viewer`+ | Initial camera orbit angles and distance (`"45deg 20deg 3m"` or `{"theta": 0.8, "phi": 0.35, "zoom": 3}`). |
| `camera-target` | `string` | `three-live-viewer`+ | Orbit center coordinate `"x y z"` (e.g. `"0m 1.5m 0m"`, defaults to model bounding center). |
| `min-camera-orbit` | `string` | `three-live-viewer`+ | Lower bounds for camera orbit `"theta phi radius"` (e.g. `"-45deg 0deg 1m"` or `"auto 0deg auto"`). |
| `max-camera-orbit` | `string` | `three-live-viewer`+ | Upper bounds for camera orbit (e.g. `"auto 90deg auto"` prevents orbiting beneath the ground plane). |
| `field-of-view` | `string` | `three-live-viewer`+ | Vertical field of view angle (e.g. `"45deg"`, clamps between `10deg` and `90deg`). |
| `selected-mesh` | `string` | `three-live-viewer`+ | Name of the sub-mesh to highlight. |
| `camera-controls` | `boolean` | `three-live-viewer`+ | Enables interactive orbit/pan/zoom camera controls (disabled by default unless `camera-controls` is present, matching `<model-viewer>`). |
| `ar` | `boolean` | `three-live-viewer`+ | Enables the augmented reality launcher button. |
| `ar-modes` | `string` | `three-live-viewer`+ | Space-delimited AR modes: `quick-look`, `scene-viewer`, `webxr`. |
| `ar-scale` | `string` | `three-live-viewer`+ | Controls whether the model can be scaled in AR: `"auto"` (default) or `"fixed"`. |
| `ar-placement` | `string` | `three-live-viewer`+ | Controls AR surface placement mode: `"floor"` (default) or `"wall"`. |
| `script-src` | `string` | `three-live`+ | URL or path to a server-generated procedural Three.js scene script. |
| `sandbox` | `string` | `three-live`+ | Mandatory sandbox mode (`"worker"` or `"iframe"`). Default: `"worker"`. |
| `allow-client-scripts` | `boolean` | `three-live`+ | Explicit opt-in allowing client-modified script strings via `executeScript()` or inline `<script>`. |
| `exposure` | `number` | `three-live-viewer`+ | Linear exposure applied to all lighting before tone mapping, like model-viewer (default: `1.0`). |
| `environment-image` | `string` | `three-live-studio` | Equirectangular `.hdr`/`.pic` radiance map or LDR environment image for ambient reflections and SH irradiance. |
| `skybox-image` | `string` | `three-live-studio` | Visible background equirectangular skybox image URL rendered behind the 3D scene. |
| `shadow-intensity` | `number` | `three-live`+ | Ground contact shadow opacity from `0.0` (off) to `1.0` (default: `0.7`). |
| `shadow-softness` | `number` | `three-live`+ | Radial Gaussian blur falloff of contact shadow from `0.0` (hard) to `1.0` (soft). |
| `tone-mapping` | `string` | `three-live-viewer`+ | Tone mapping mode: `"neutral"` (default, Khronos PBR Neutral), `"aces"` (ACES Filmic), `"agx"` (AgX Filmic), `"reinhard"`, or `"none"`. |
| `variant-name` | `string` | `three-live-studio` | Active `KHR_materials_variants` product material variant name (e.g. `"Midnight Black"`). Also readable/writable via `viewer.variantName` and `viewer.availableVariants`. |
| `bloom` | `boolean \| string` | `three-live-studio` | Enables HDR emissive bloom (`bloom`, `bloom="1.4"`, or `bloom="strength:1.2 threshold:0.75 radius:0.5"`). |
| `outline` | `boolean \| string` | `three-live-studio` | Enables silhouette outlines on `selected-mesh`, nodes with `userData.xr.outline`, or all foreground meshes (`outline`, `outline="#38bdf8"`, or `outline="#38bdf8 0.025"`). |
| `autoplay` | `boolean` | `three-live-viewer`+ | Automatically starts keyframe animation playback on model load. |
| `animation-name` | `string` | `three-live-viewer`+ | Name of specific glTF animation clip to play (defaults to first clip). |
| `auto-rotate` | `boolean` | `three-live-viewer`+ | Automatically rotates the camera around the model. |
<!-- mdformat on -->

--------------------------------------------------------------------------------

## `<model-viewer>` Drop-in Imperative API

`<three-live>` provides full drop-in compatibility for `<model-viewer>`
JavaScript configurators, hotspot managers, and AR launchers:

-   **Camera & Screenshot:** `viewer.getCameraOrbit()`,
    `viewer.getCameraTarget()`, `viewer.getFieldOfView()`,
    `viewer.jumpCameraToGoal()`, `viewer.toDataURL()`, `await viewer.toBlob()`
-   **AR Status & Activation:** `viewer.canActivateAR` (boolean getter), `await
    viewer.activateAR()`
-   **Surface Raycasting:** `viewer.positionAndNormalFromPoint(pixelX, pixelY)`
    returns `{ position: { x, y, z, toString() }, normal: { x, y, z, toString()
    } } | null`
-   **Live Material Editing & `KHR_materials_variants`
    (`viewer.model.materials`, `viewer.availableVariants`,
    `viewer.variantName`):**

    ```js
    // Switch a glTF KHR_materials_variants colorway (or USDZ VariantSet)
    console.log(viewer.availableVariants); // ['Midnight Black', 'Titanium Silver']
    viewer.variantName = 'Titanium Silver';

    // Or edit PBR material factors directly
    const mat = viewer.model.getMaterialByName('Leather') || viewer.model.materials[0];
    mat.pbrMetallicRoughness.setBaseColorFactor([0.8, 0.2, 0.1, 1.0]);
    mat.pbrMetallicRoughness.setRoughnessFactor(0.35);
    ```

--------------------------------------------------------------------------------

## DOM Events

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Event | Detail Payload | Description |
| :--- | :--- | :--- |
| `load` | `{ model: GLBData }` | Fired when the 3D model or procedural scene finishes loading. |
| `error` | `{ error: Error }` | Fired if model loading or script execution fails. |
| `camera-change` | `{ theta, phi, distance }` | Fired whenever the camera orbit changes. |
| `ar-status` | `{ status: 'session-started' \| 'not-presenting' \| 'failed', error? }` | Fired when AR session status transitions (`<model-viewer>` standard). |
| `meshclick` | `{ meshName, hitPoint, normal, distance }` | Fired when a user clicks or taps a sub-mesh. |
<!-- mdformat on -->

--------------------------------------------------------------------------------

## Custom AR Button Overlay (`slot="ar-button"` / `activateAR()`)

Provide a child element with `slot="ar-button"` to replace the default AR button
overlay with your own custom styled button. `<three-live>` automatically hides
its built-in button, manages visibility when `ar` is enabled, and triggers
`activateAR()` on click:

```html
<three-live src="/models/chair.glb" camera-controls ar style="width: 100%; height: 500px;">
  <button slot="ar-button" class="custom-ar-btn">
    ✨ View in Your Space
  </button>
</three-live>
```

--------------------------------------------------------------------------------

## Visual Extensions & Plugins

### 3D Hotspots & Annotations (`three-live/studio`)

Import `three-live/studio` (or use `three-live-full.min.js`) to attach
interactive HTML buttons or callouts pinned to 3D surface coordinates. Hotspots
automatically orbit with the camera and support surface normal occlusion
culling:

```html
<script type="module" src="/dist/three-live-full.min.js"></script>

<three-live src="/models/astronaut.glb" camera-controls camera-target="0 1.2 0" style="width: 100%; height: 500px; display: block;">
  <button slot="hotspot-visor" data-position="0 1.5 0.3" data-normal="0 0 1" class="hotspot">
    Gold-coated Visor
  </button>
  <div slot="hotspot-pack" data-position="0 1.3 -0.4" data-normal="0 0 -1" class="hotspot">
    Life Support Unit
  </div>
</three-live>
```

Update a hotspot dynamically at runtime using `viewer.updateHotspot({ name,
position, normal })`.

### PBR Rendering, Tone Mapping, Post-Processing & Lighting Extensions

-   **Core WebGL2 PBR (`three-live-viewer`+):**
    -   **Screen-Space Derivative Normal Maps:** Perturbs normals via GLSL
        `dFdx`/`dFdy` without requiring glTF vertex tangents.
    -   **5 Filmic & Commerce Tone Mapping Modes (`tone-mapping`):** Supports
        `"neutral"` (default Khronos PBR Neutral for accurate e-commerce
        colors), `"aces"` (Narkowicz ACES Filmic), `"agx"` (Sobotka AgX Filmic
        with smooth highlight chroma desaturation), `"reinhard"`, and `"none"`.
    -   **GPU Instancing (`EXT_mesh_gpu_instancing` / `THREE.InstancedMesh`):**
        Renders up to `MAX_INSTANCE_COUNT = 10,000` instances per mesh with
        per-instance `MAT4` transforms and optional per-instance `COLOR_0` tints
        (one `drawElementsInstanced` call per primitive, with per-instance
        vertex attributes), exporting to glTF `EXT_mesh_gpu_instancing` and USDZ
        `PointInstancer`.
-   **HDR Emissive Bloom & Silhouette Outlines (`three-live/studio` /
    `postprocessingPlugin`):**
    -   **Bloom (`bloom` attribute or `mesh.userData.xr.bloom`):** Dual-Kawase
        MIP-chain HDR bloom and soft emissive halo generation
        (`{ strength: 1.2, threshold: 0.8, radius: 0.5 }`).
    -   **Selection & Highlight Outlines (`outline` attribute or
        `mesh.userData.xr.outline`):** Inverted-hull and screen-space Sobel
        silhouette outlines (`{ color: '#38bdf8', thickness: 0.03 }`),
        automatically highlighting `selected-mesh` or outlined nodes.
-   **PBR Next Materials, HDRI & Contact Shadows (`three-live/studio`):**
    -   **glTF PBR Next Extensions:** Shader support for Clearcoat
        (`KHR_materials_clearcoat`), Transmission
        (`KHR_materials_transmission`), Dispersion (`KHR_materials_dispersion`),
        Volume Attenuation (`KHR_materials_volume`), Iridescence
        (`KHR_materials_iridescence`), and Sheen (`KHR_materials_sheen`).
    -   **HDRI Radiance Maps & Spherical Harmonics:** Set
        `environment-image="/env/studio.hdr"` to parse Radiance `.hdr` RGBE
        textures, prefilter GGX specular mipmaps, and project 9-coefficient
        Spherical Harmonics diffuse irradiance.
    -   **Analytical Ground Contact Shadows:** Set `shadow-intensity="0.7"` and
        `shadow-softness="0.5"` for soft ground ambient occlusion without shadow
        map pass overhead.

### Animations: Rigid-Body TRS, Skeletal/Morph & Inverse Kinematics (IK)

-   **Rigid-Body Keyframe Animations (`three-live-viewer`+):** Node translation,
    rotation, and scale (`TRS`) keyframe tracks are built into all bundles
    (`el.availableAnimations`, `el.play()`, `el.pause()`).
-   **GPU Skeletal Skinning, Morph Targets & Cross-Fading
    (`three-live/animation`):** Import `three-live/animation` (or use
    `three-live-full.min.js`) to enable 64-joint GPU vertex skinning
    (`JOINTS_0`/`WEIGHTS_0`), morph target blending (`weights`), and smooth clip
    cross-fading (`el.crossFadeTo('Walk', 0.3)`).
-   **Analytical 2-Bone & FABRIK Inverse Kinematics (`ikPlugin` /
    `userData.xr.ik` / `THREE.IKSolver`):** Attach `mesh.userData.xr.ik = {
    root: 'Shoulder', mid: 'Forearm', effector: 'Wrist', target: 'TargetNode',
    pole: 'ElbowPole', solver: 'two-bone' | 'fabrik', iterations: 10 }` to solve
    robotic arms, mechanical linkages, and character limbs at runtime across
    Web, Android, and iOS, or call `THREE.IKSolver.solveTwoBone(...)` /
    `THREE.IKSolver.solveFABRIK(...)` directly inside
    `<script type="text/three">`.

### Declarative `KHR_interactivity` Behavior Graphs (`userData.interactivity`)

Inside `<script type="text/three">`, any `THREE.Mesh` or `THREE.Group` can
attach declarative `userData.interactivity` triggers (`onSelect`, `onHoverIn`,
`onHoverOut`, `onStart`, `onReceive`) that compile into standard Khronos
`KHR_interactivity` bytecode embedded inside exported `.glb` files and executed
by the `three-live/studio` VM on Web, Android, and iOS:

```html
<three-live allow-client-scripts camera-controls style="width: 100%; height: 480px; display: block;">
  <script type="text/three">
    const button = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.3, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.4, roughness: 0.3 })
    );
    button.name = ' interactive-box';
    button.userData.interactivity = {
      onSelect: [
        {
          action: 'toggleTransform',
          property: 'translation',
          from: [0, 0, 0],
          to: [0, 0.4, 0],
          duration: 0.35
        },
        {
          action: 'cycleMaterialColor',
          colors: [
            [0.22, 0.74, 0.97, 1.0],
            [0.13, 0.77, 0.37, 1.0],
            [0.96, 0.25, 0.37, 1.0]
          ],
          duration: 0.25
        }
      ]
    };
    scene.add(button);
  </script>
</three-live>
```

Supported action objects in `onSelect` / `onHoverIn` / `onHoverOut` / `onStart` / `onReceive[eventName]`:

- `toggleTransform`: `{ action: 'toggleTransform', property: 'translation' | 'rotation' | 'scale', from?: number[], to: number[], duration?: number }`
- `interpolate`: `{ action: 'interpolate', target?: string, property: 'translation' | 'rotation' | 'scale' | 'baseColorFactor' | 'metallicFactor' | 'roughnessFactor' | 'emissiveFactor', to: number | number[], duration?: number }`
- `setProperty`: `{ action: 'setProperty', target?: string, property: string, value: unknown }`
- `toggleVisibility`: `{ action: 'toggleVisibility', target?: string }`
- `cycleMaterialColor`: `{ action: 'cycleMaterialColor', colors: Array<[number, number, number, number?]>, duration?: number }`
- `playAnimation` / `stopAnimation`: `{ action: 'playAnimation', animation?: number }` / `{ action: 'stopAnimation' }`
- `sendEvent`: `{ action: 'sendEvent', event: string, values?: Record<string, unknown> }` (dispatches `interactivityEvent` on the host element).

### Built-in `EXT_meshopt_compression` & Pluggable Decoders

`EXT_meshopt_compression` and `KHR_meshopt_compression` (`ATTRIBUTES` vertex
codec v0/v1, `TRIANGLES` index codec, and `INDICES` index-sequence codec, plus
the `OCTAHEDRAL`, `QUATERNION`, `EXPONENTIAL`, and `COLOR` filters) are decoded
**out of the box** in pure TypeScript with zero WASM dependencies
(`decodeMeshoptBuffer` / `decodeMeshoptGLB` in
`three-live/src/plugins/meshopt.ts`). The decoders are byte-exact with the
reference meshoptimizer library, so `gltfpack` output loads directly, including
its `KHR_mesh_quantization` attributes (normalized / integer positions, normals,
UVs, skin weights, morph deltas and animation outputs) and the
`KHR_texture_transform` it uses to dequantize UVs. For Draco or KTX2 Basis
Universal textures, register external decoders on demand:

```javascript
import { ThreeLiveElement } from 'three-live';

ThreeLiveElement.registerDecoder('draco', myDracoDecoder);
```

--------------------------------------------------------------------------------

## Procedural Scene Scripting (`three-author`)

`<three-live>` supports two procedural scene compilation workflows:

1.  **Server-Generated Scene Scripts (Default — `script-src` /
    `loadScriptFromSrc(url)`):** The client passes a script URL directly to the
    sandbox (`<three-live script-src="https://.../scene.js">`). The sandbox
    Worker loads and compiles the script directly via `importScripts` without
    requiring `'unsafe-eval'` or `new Function()`.
2.  **Client-Modified Scene Scripts (Opt-In — `allow-client-scripts` /
    `ThreeLiveElement.allowClientScripts = true`):** For interactive code
    editors or client-modified scripts (`el.executeScript(code)` or inline
    `<script type="text/three">`), explicitly opt in via the
    `allow-client-scripts` attribute or `ThreeLiveElement.allowClientScripts =
    true`:

```html
<three-live
  allow-client-scripts
  camera-controls
  style="width: 100%; height: 500px; display: block;">
  <script type="text/three">
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4285f4 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);
  </script>
</three-live>
```

### Security & Sandboxing Architecture

Three-Live operates under a **fail-closed** security model for untrusted or
AI-generated script execution:

-   **Isolated Web Worker (default, `sandbox="worker"`):** Scripts run in a
    dedicated Worker with no DOM access. Before any author code runs, the worker
    revokes its own ambient authority — `fetch`, `XMLHttpRequest`, `WebSocket`,
    `EventSource`, `importScripts`, `navigator` (and therefore `sendBeacon`),
    `indexedDB`, `caches`, `Worker`, `SharedWorker`, `BroadcastChannel`,
    `SharedArrayBuffer` and `Atomics` are all made permanently `undefined`. The
    channel back to the host is captured in a closure and `self.postMessage` is
    replaced with a throwing stub, so a script cannot forge a result message.
-   **Execution watchdog:** A script that exceeds
    `SECURITY_3D_SANDBOX_TIMEOUT_MS` (3 s) has its worker terminated and raises
    an `error` event. At most `SECURITY_3D_MAX_CONCURRENT_TASKS` (32) sandbox
    workers may be alive at once.
-   **Quota enforcement:** `Scene.toCanvas3D()`, `toGLB()` and `toUSDZ()` all
    run `SceneQuotaValidator`, so no serialization path can skip the vertex,
    index, mesh and texture ceilings. Scripts larger than
    `SECURITY_3D_MAX_SCRIPT_BYTES` (1 MiB) are rejected before execution.
-   **Fail-Closed Guarantee & Mandatory Sandboxing:** Sandboxing is strictly
    required for all live procedural compilation and cannot be bypassed.
    `sandbox="none"` and `sandbox="unsafe-host-realm"` are prohibited and
    rejected with a `SecurityError`. If Web Workers or the sandbox iframe are
    unavailable or blocked by Content Security Policy (CSP), Three-Live **fails
    closed**: it halts execution, emits an `error` event, and throws rather than
    evaluating code in the host realm.
-   **Opaque-Origin Iframe + Worker Isolation (`sandbox="iframe"`):** For hosts
    enforcing strict CSP (`require-trusted-types-for 'script'`, no
    `'unsafe-eval'` on the host document), set `sandbox="iframe"` or configure
    `ThreeLiveElement.sandboxIframeSrc` to point at `three-live-sandbox.html`.
    Three-Live mounts a hidden `<iframe sandbox="allow-scripts">` (omitting
    `allow-same-origin` so the iframe and its Worker run in a unique `null`
    opaque origin) with its own `connect-src 'none'` CSP, completely isolating
    script evaluation from the host page's origin, cookies, storage, and CSP.

#### Pointing the sandbox at the engine

The worker loads the Three-Live runtime by URL. When the library is included via
a classic `<script src="three-live.min.js">` tag this is auto-detected. If you
bundle Three-Live with webpack, Vite or Rollup, set it explicitly:

```js
import {ThreeLiveElement} from 'three-live';

ThreeLiveElement.sandboxEngineSrc =
    new URL('three-live/dist/three-live.min.js', import.meta.url).href;

// Optional: enable opaque-origin <iframe sandbox="allow-scripts"> isolation
// across all <three-live> elements on strict-CSP pages:
ThreeLiveElement.sandboxIframeSrc =
    new URL('three-live/dist/three-live-sandbox.html', import.meta.url).href;
```

The URL must point at an **IIFE** build (`*.min.js`), be same-origin or
CORS-enabled, and be permitted by your CSP `script-src`. If it cannot be
resolved, sandboxed execution fails closed rather than falling back to the host
realm. This mirrors how Monaco, PDF.js and Tesseract.js require their worker
assets to be located.

### Supported Procedural Scripting Subset

-   **Math & Core:** `Vector2`, `Vector3`, `Vector4`, `Euler`, `Quaternion`,
    `Matrix3`, `Matrix4`, `Color`, `MathUtils`, `Clock`, `IKSolver`
    (`solveTwoBone`, `solveFABRIK`).
-   **Primitives, CAD & Text Geometries:** `BoxGeometry`, `PlaneGeometry`,
    `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`,
    `TorusKnotGeometry`, `LatheGeometry`, `TubeGeometry`, `Shape`, `Path`,
    `ShapeGeometry`, `ExtrudeGeometry` (with holes and multi-segment bevels),
    `TextGeometry` (built-in 3D extruded vector font), `CSG` (`THREE.CSG.union`,
    `THREE.CSG.subtract`, `THREE.CSG.intersect`), `BufferGeometry`,
    `BufferAttribute`.
-   **Materials & Variants:** `MeshStandardMaterial`, `MeshBasicMaterial`,
    `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshPhysicalMaterial` (mapped
    to glTF PBR metallic-roughness + PBR Next extensions, plus
    `mesh.userData.variants` for `KHR_materials_variants`).
-   **Scene Graph & GPU Instancing:** `Scene`, `Group`, `Mesh`, `InstancedMesh`
    (`setMatrixAt`, `getMatrixAt`, `setColorAt`, `getColorAt`, `count`),
    `Object3D` (`position`, `rotation`, `scale`, `matrix`, `add`, `remove`,
    `traverse`).
-   **Lights & Cameras:** `AmbientLight`, `DirectionalLight`, `PointLight`,
    `Camera`, `PerspectiveCamera`.
-   **Permissive LLM Fallbacks & Warnings:** Unsupported Three.js shaders
    (`ShaderMaterial`, `RawShaderMaterial`), polyhedra/extended geometries
    (`IcosahedronGeometry`, `OctahedronGeometry`, `CapsuleGeometry`,
    `RingGeometry`, `CircleGeometry`), lights (`SpotLight`, `HemisphereLight`,
    `RectAreaLight`), and headless browser globals (`requestAnimationFrame`,
    `window`, `document`) gracefully degrade to standard PBR/primitive
    equivalents without crashing the 3D/XR scene. All fallback events emit a
    deduplicated warning and can be inspected via `THREE.getAuthorWarnings()`.
-   **Scene Quotas:** Max **1,000 meshes**, **100,000 vertices**, **300,000
    indices**, **16 textures** (max 2048×2048), and a **5-second** wall-clock
    execution watchdog.
