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

You can copy the **System Prompt Snippet** below directly into any LLM prompt or
agent skill to guarantee valid, zero-hallucination output.

--------------------------------------------------------------------------------

## Copy-Paste System Prompt Snippet for LLMs

```markdown
You are authoring 3D / Spatial Computing scenes using Google's `three-live` and `xr-live` web components.

### 1. Choose the Right Component & Bundle
- Use `<three-live>` (`three-live.min.js`) for 3D product viewers, procedural Three.js scenes, and 1-tap mobile AR handoff (Quick Look / Scene Viewer / WebXR).
- Use `<xr-live>` (`xr-live.min.js` or `xr-live-full.min.js`) when the scene requires interactive 6DoF WebXR, spatial traits (`grab`, `scale`, `billboard`, `anchor`), spatial HTML cards (`<div slot="spatial">`), depth/physics (`xr-depth`), or hand tracking (`xr-hands`).

### 2. Procedural `<script type="text/three">` Rules
- Inside `<script type="text/three">`, the globals `THREE` and `scene` (a `THREE.Scene` instance) are pre-defined.
- Add all meshes, groups, and lights directly to `scene.add(...)`.
- Attach spatial traits to procedural objects via `mesh.userData.xrTraits = ['grab', 'scale', 'billboard', 'anchor']`.
- NEVER use `GLTFLoader`, `OBJLoader`, `TextureLoader`, `EffectComposer`, `ShaderMaterial`, `RawShaderMaterial`, or `requestAnimationFrame` inside `<script type="text/three">`.
- NEVER create a `THREE.WebGLRenderer` or attach DOM canvas elements inside `<script type="text/three">`.
- Respect strict scene quotas: max 1,000 meshes, 100,000 vertices, 300,000 indices, 16 textures, 5-second execution timeout.

### 3. Allowed `THREE.*` Constructors inside `<script type="text/three">`
- Math: `Vector2`, `Vector3`, `Vector4`, `Euler`, `Quaternion`, `Matrix3`, `Matrix4`, `Color`, `MathUtils`, `Clock`
- Geometries: `BoxGeometry`, `PlaneGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `TorusGeometry`, `TorusKnotGeometry`, `BufferGeometry`, `BufferAttribute`
- Materials: `MeshStandardMaterial`, `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`, `MeshPhysicalMaterial`
- Scene Graph: `Scene`, `Group`, `Mesh`, `Object3D` (`position`, `rotation`, `scale`, `matrix`, `add`, `remove`, `traverse`)
- Lights & Cameras: `AmbientLight`, `DirectionalLight`, `PointLight`, `Camera`, `PerspectiveCamera`
```

--------------------------------------------------------------------------------

## DO vs. DO NOT Cheat Sheet

| DO (Supported & Fast)               | DO NOT (Unsupported / Anti-Pattern)   |
| :---------------------------------- | :------------------------------------ |
| Use `new THREE.MeshStandardMaterial({ color, metalness, roughness })` | Do NOT use `THREE.ShaderMaterial` or custom GLSL strings in scripts |
| Add objects to the global `scene` (`scene.add(mesh)`) | Do NOT instantiate `new THREE.WebGLRenderer()` or call `renderer.render()` |
| Set `mesh.userData.xrTraits = ['grab', 'scale', 'billboard']` | Do NOT write manual WebXR session setup (`navigator.xr.requestSession`) |
| Use `<div slot="spatial" data-position="x y z" data-xr-traits="grab billboard">` for spatial HTML UI | Do NOT try to access `window` or `document` inside sandboxed `<script type="text/three">` |
| Load external `.glb` files via `<three-live src="...">` or `<xr-anchor src="...">` | Do NOT use `new THREE.GLTFLoader().load(...)` inside procedural scripts |

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

### Template 1: Procedural 3D Scene with AR Handoff (`<three-live>`)

```html
<script type="module" src="/dist/three-live.min.js"></script>

<three-live camera-controls ar auto-rotate style="width: 100%; height: 500px; display: block;">
  <script type="text/three">
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.7, 0.2, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.2 })
    );
    scene.add(base);

    const crystal = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.1, roughness: 0.1 })
    );
    crystal.position.set(0, 0.55, 0);
    scene.add(crystal);

    const light = new THREE.DirectionalLight(0xffffff, 2.0);
    light.position.set(2, 4, 3);
    scene.add(light);
  </script>
</three-live>
```

### Template 2: Interactive Spatial Computing Scene (`<xr-live>`)

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  xr-mode="inline-ar"
  xr-depth
  xr-hands
  xr-simulator
  camera-controls
  style="width: 100%; height: 600px; display: block;">

  <!-- Interactive procedural 3D object with spatial traits -->
  <script type="text/three">
    const group = new THREE.Group();
    group.position.set(0, 1.1, -1.0);
    group.userData.xrTraits = ['grab', 'scale', 'anchor'];

    const torus = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.18, 0.06, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.6, roughness: 0.25 })
    );
    group.add(torus);
    scene.add(group);
  </script>

  <!-- Live HTML spatial card floating next to the 3D object -->
  <div slot="spatial" data-position="0.4 1.1 -1.0" data-xr-traits="grab billboard">
    <div style="padding: 14px; background: #111827; color: #f9fafb; border-radius: 12px; width: 220px;">
      <h4>Spatial Control Panel</h4>
      <p>Pinch to grab or scale the sculpture.</p>
      <button onclick="console.log('Clicked in 3D space!')">Inspect Details</button>
    </div>
  </div>
</xr-live>
```
