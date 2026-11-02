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

# `<xr-live>` Spatial Computing & XR Blocks Guide

`<xr-live>` extends `<three-live>` into a full spatial computing runtime for
**WebXR (Android XR, Meta Quest, Apple Vision Pro)**, **Mobile Web AR**, and
**Native Android XR (`SceneCore` / `Filament`) & iOS/visionOS (`RealityKit`)**.

It brings declarative spatial traits (`userData.xr`), the 7 **XR Blocks**
plugins (`head-follow`, `manipulation-handles`, `world-understanding`,
`gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`), interactive
HTML/CSS spatial cards (`<div slot="spatial">`), real-world depth occlusion &
heightfield physics, 25-joint hand gesture recognition, a desktop 6DoF
simulator, WebMCP browser AI tools, and zero-webview native mobile AR/XR
bridges.

For standard 3D viewing, `<model-viewer>` drop-in compatibility,
`KHR_interactivity`, and PBR materials, see
**[`docs/three-live.md`](three-live.md)**. For end-to-end recipes, see
**[`docs/cookbook.md`](cookbook.md)**.

--------------------------------------------------------------------------------

## Quickstart

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
  sound-feedback
  camera-controls
  style="width: 100%; height: 600px; display: block;">

  <!-- Procedural 3D nodes with canonical userData.xr traits -->
  <script type="text/three">
    const sculpture = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.18, 0.06, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.7, roughness: 0.2 })
    );
    sculpture.name = 'sculpture';
    sculpture.position.set(0, 1.0, -1.1);
    sculpture.userData.xr = {
      grab: '2-hand',
      handles: { rotateAxis: 'y', minScale: 0.4, maxScale: 2.5 },
      holdToAsk: { prompt: 'Describe this sculpture.', holdMs: 600 }
    };
    scene.add(sculpture);
  </script>

  <!-- Live HTML/CSS spatial UI card rendered inside the 3D/XR scene -->
  <div slot="spatial" data-position="0.45 1.1 -1.1" data-xr-traits="grab billboard">
    <div style="padding: 16px; background: #0f172a; color: #f8fafc; border-radius: 16px; width: 240px;">
      <h3>Spatial Control Card</h3>
      <p>Pinch to grab, drag corner handles to scale, or pinch in empty space to paint.</p>
      <button id="buy-btn">Inspect in AR</button>
    </div>
  </div>
</xr-live>
```

--------------------------------------------------------------------------------

## Observed Attributes (`<xr-live>` & `<xr-anchor>`)

`<xr-live>` inherits all
[`<three-live>` attributes](three-live.md#observed-attributes) plus the
following spatial attributes:

| Element | Attribute | Type / Values | Default | Description |
| :---------- | :-------------------- | :---------------------------------------------------- | :------ | :---------- |
| `<xr-live>` | `xr-mode` | `'ar' \| 'vr' \| 'inline' \| 'auto'` | `'auto'` | Target WebXR session mode (`ar` requests `immersive-ar`; `vr` requests `immersive-vr`). |
| `<xr-live>` | `xr-depth` | `'occlusion' \| 'occlusion-physics' \| 'mesh' \| 'none'` | `'none'` | Enables WebXR `depth-sensing`, PBR depth occlusion, and analytical heightfield physics. |
| `<xr-live>` | `xr-hands` | `'gestures' \| 'joints' \| 'pinch' \| 'none'` | `'none'` | Enables 25-joint `XRHand` tracking (`hand-tracking`) and gesture classification. |
| `<xr-live>` | `xr-simulator` | `'living-room' \| 'office' \| 'tabletop' \| 'none'` | `'none'` | Enables desktop 6DoF keyboard/mouse simulator (`WASD` + `Q`/`E` + mouse look + virtual hands). |
| `<xr-live>` | `xr-profile` | `'quest3' \| 'android-xr' \| 'visionos' \| 'auto'` | `'auto'` | Target spatial hardware profile hint. |
| `<xr-live>` | `sound-feedback` | `boolean` | `false` | Plays procedural Web Audio earcons (`grab`, `release`, `bounce`, `hover`) and mobile haptics. |
| `<xr-live>` | `world-understanding` | `'' \| 'planes' \| 'planes reticle' \| 'false'` | — | Enables `xr-live-world-understanding` plane/mesh detection and gaze surface reticle. |
| `<xr-live>` | `spatial-paint` | `'' \| '#rrggbb' \| 'false'` | — | Enables `xr-live-spatial-paint`; pinching in empty space extrudes 3D Catmull-Rom tube strokes. |
| `<xr-live>` | `webmcp` | `boolean` | `false` | Registers spatial AI tools (`inspect_xr_scene`, `place_xr_object_at_gaze`, `capture_xr_view`) on `navigator.modelContext`. |
| `<xr-live>` | `webmcp-allow-depth` | `boolean` | `false` | Opt-in gate required before `capture_xr_view` exposes the 8×8 metric `depthGridMeters` array. |
| `<xr-live>` | `webmcp-omit-pose` | `boolean` | `false` | Omits `headPosition` from `inspect_xr_scene` responses. |
| `<xr-anchor>` | `surface` | `'floor' \| 'wall' \| 'table' \| 'ceiling'` | `'floor'` | Target semantic surface for declarative child placement. |
| `<xr-anchor>` | `magnetic` | `boolean` | `false` | Continuously snaps child anchor to the nearest matching surface plane. |

--------------------------------------------------------------------------------

## Canonical `userData.xr` Spatial Traits

Defined in [`three-live/src/xr-trait-schema.ts`](../three-live/src/xr-trait-schema.ts), `mesh.userData.xr` traits are normalized, clamped to identical ranges, and exported into `.glb` (`nodes[i].extras.xr` + `nodes[i].extensions.ANDROID_xr_scenecore`) and `.usdz` (`customData = {dictionary xr = {...}}`) so scenes behave identically on Web, Android, and iOS/visionOS:

| Trait Key | Type / Options | Description |
| :------------------- | :----------------------------------------------------------------------------------------------- | :---------- |
| **`grab`** | `'1-hand' \| '2-hand' \| true` | 6DoF single-hand grab/rotate (`'1-hand'`) or two-hand grab + pinch-scale/twist (`'2-hand'`). Legacy `grabbable: true` is also accepted. |
| **`scale`** | `{ min?: number, max?: number } \| true` | Two-handed pinch scaling clamped to `[min, max]` (defaults to `{ min: 0.05, max: 5 }`). |
| **`billboard`** | `'capsule' \| 'cylindrical' \| 'spherical' \| true` | Orients node toward the viewer (`'capsule'` and `'cylindrical'` rotate around Y; `'spherical'` faces camera in 3D). |
| **`follow`** | `'head' \| 'hand-left' \| 'hand-right'` **or** `{ mode, lazy, distance, deadzoneDeg, stiffness, height, faceUser, snapOnStart }` | String values apply an eager spring follow; object values activate XR Blocks lazy head/hand follow with angular deadzone (`deadzoneDeg`, default `15°`) and critically damped spring (`stiffness`, default `6`). |
| **`anchor`** | `'floor' \| 'wall' \| 'table' \| 'horizontal' \| 'vertical'` | Pins the node to a detected real-world plane or simulator surface. |
| **`physics`** | `'dynamic' \| 'static'` | Steps rigid-body gravity, restitution bounce (`userData.xr.restitution`), sphere-to-sphere collisions, and depth heightfield collisions. |
| **`orbit`** | `{ target: [x,y,z] \| string, radius?: number, speed?: number, height?: number, phase?: number, faceCenter?: boolean }` | Orbits around a 3D world point or another mesh's `name` at `speed` rad/s. |
| **`handles`** | `{ rotateAxis?: 'y' \| 'none', minScale?: number, maxScale?: number } \| true` | Adds 4 top-corner uniform scale handles and a bottom pedestal yaw-rotation bar; emits `xr-handles-change`. |
| **`particles`** | `{ preset: 'rain' \| 'snow' \| 'sparks' \| 'confetti', count?: number, area?: number \| [x,y,z], speed?: number }` | Turns the node into a particle emitter volume (`count` up to `2,000`) that collides with floor and WebXR depth surfaces. |
| **`holdToAsk`** | `{ prompt?: string, holdMs?: number } \| true` | Press-and-hold on the mesh starts speech recognition and sends a contextual prompt to Gemini Live; emits `xr-hold-to-ask`. |
| **`worldUnderstanding`** | `{ planes?: boolean, meshes?: boolean, reticle?: boolean, objects?: boolean }` | Opts the scene into WebXR plane/mesh detection and the gaze surface reticle (`__xr_reticle__`). |
| **`splatUrl`** | `string` (`https://` or relative `.splat` / `.spz` URL) | Loads and back-to-front depth-sorts 3D Gaussian Splats (`.splat` or Niantic `.spz` v2/v3, up to `1,000,000` splats). |
| **`audio`** | `string` **or** `{ src: string, refDistance?: number, loop?: boolean }` | Attaches a 3D PannerNode HRTF audio source to the mesh. |
| **`pointerEvents`** | `'none'` | Excludes the mesh from raycast picking so rays pass through it. |

--------------------------------------------------------------------------------

## XR Blocks Plugin Suite (`xr-live-blocks.min.js` / `xr-live-full.min.js`)

All 7 XR Blocks plugins are included automatically in `xr-live-full.min.js` (or can be loaded modularly via `xr-live-blocks.min.js` or `xr-live/plugins`):

1. **`head-follow` (`xr-live-head-follow`):**
   - Implements `FollowHead` lazy HUD behavior (angular deadzone + critically damped spring `stepCriticallyDampedSpring`) and `Orbit` satellite motion (`userData.xr.orbit`).
2. **`manipulation-handles` (`xr-live-manipulation-handles`):**
   - Attaches 4 top-corner uniform-scale handles and a bottom pedestal yaw-rotation bar to any mesh with `userData.xr.handles`. Dispatches `xr-handles-change` (`{ mesh, scale, yawDeg }`).
3. **`world-understanding` (`xr-live-world-understanding`):**
   - Tracks WebXR `detectedPlanes` (`MAX_TRACKED_PLANES = 64`) and `detectedMeshes`, updates a surface-normal gaze reticle (`__xr_reticle__`), provides `XRTapeMeasure`, and unprojects 2D bounding boxes (`[ymin, xmin, ymax, xmax]`) into 3D world space via `detectObjects(element, detections)`, dispatching `xr-object-detected`.
4. **`gemini-live` (`xr-live-gemini-live`):**
   - Streams viewport frames and 16 kHz PCM microphone audio to a Gemini Live `wss://` endpoint (`connectGeminiLive(element, options)`), plays 24 kHz PCM model audio with barge-in cancellation (`xr-gemini-interrupted`), emits live `xr-transcription` (`{ speaker, text, isFinal }`), answers `report_objects` tool calls with 3D unprojection, and wires `userData.xr.holdToAsk` press-and-hold queries (`xr-hold-to-ask-listening`, `xr-hold-to-ask`).
5. **`spatial-paint` (`xr-live-spatial-paint`):**
   - Enabled via the `spatial-paint` attribute (e.g. `spatial-paint="#ff3366"`). Pinching in empty space smooths input points with a uniform Catmull-Rom spline and extrudes twist-free parallel-transport tubes (`TubeStrokeBuilder`), emitting `xr-paint-stroke` (`{ index, points, lengthMeters }`). Supports programmatic `undo()` and `clear()` via `getSpatialPaintController(element)`.
6. **`depth-particles` (`xr-live-depth-particles`):**
   - Simulates `rain`, `snow`, `sparks`, and `confetti` emitters (`userData.xr.particles`, up to `MAX_EMITTERS = 8` and `2,000` particles/emitter) with deterministic PRNG and real-world WebXR depth collision (`isOccludedByDepth`).
7. **`splat-loader` (`xr-live-splat-loader`):**
   - Streams `.splat` (32-byte records) and Niantic `.spz` (v2/v3, raw or gzipped) 3D Gaussian Splat files for any node with `userData.xr.splatUrl`, sorting splats back-to-front with a 16-bit counting sort each frame.

--------------------------------------------------------------------------------

## Spatial DOM Cards (`<div slot="spatial">`)

Any child element with `slot="spatial"` is automatically projected into 3D space
as an interactive textured quad inside WebXR and inline 3D views:

-   **Sanitized SVG `<foreignObject>` Rasterization:** Renders live HTML/CSS
    into a crisp GPU texture with automatic XSS hardening (strips dangerous
    tags/handlers, blocks `javascript:`/`data:text/html` URIs, escapes XML
    entities).
-   **3D Raycast Hit-Testing:** Controller rays, hand pinch rays, and pointer
    clicks automatically compute UV intersection coordinates and dispatch
    synthetic `click`, `pointerdown`, `pointermove`, and `pointerup` events to
    the underlying DOM elements (e.g., `<button>`).
-   **Trait Support:** Add `data-xr-traits="grab billboard"` and
    `data-position="x y z"` directly on `<div slot="spatial">`.

--------------------------------------------------------------------------------

## Imperative Methods & DOM Events (`<xr-live>`)

### Imperative Methods
- `await element.enterSpatialAR(sourceOverride?, forceFallback?)`: Launches WebXR `immersive-ar`, iOS Quick Look (`.usdz`), or Android Scene Viewer (`intent://`).
- `element.transitionToVR({ color?: [r, g, b], durationMs?: number })`: Smoothly fades the viewport background from transparent AR passthrough to an opaque VR environment.
- `element.transitionToAR({ durationMs?: number })`: Smoothly fades back to transparent AR passthrough.
- `await element.captureViewFrame({ format?, quality?, includeDepth? })`: Captures the current rendered viewport (`dataUrl`, `base64`), camera `viewMatrix` / `projectionMatrix`, `headPosition`, and optional 8×8 `depthGridMeters`.
- `element.stepSpatialFrame(dtSeconds)`: Steps all spatial subsystems (automatically called during WebXR and simulator frames).

### Spatial DOM Events
| Event | `event.detail` Payload | Description |
| :------------------------ | :----------------------------------------------------------------------- | :---------- |
| `xr-select-start` / `move` / `end` | `{ hand: 'left' \| 'right' \| 'screen', pivotPosition, quaternion, rayOrigin, rayDirection, hit }` | Fired on controller trigger, hand pinch, or screen touch ray. |
| `xr-handles-change` | `{ mesh, scale: number, yawDeg: number }` | Fired when a `userData.xr.handles` corner scale or yaw bar is dragged. |
| `xr-object-detected` | `{ label: string, position: [number, number, number], distanceMeters: number, source: 'plane' \| 'depth' \| 'fallback' }` | Fired for each 2D detection unprojected into 3D by `world-understanding`. |
| `xr-transcription` | `{ speaker: 'user' \| 'model', text: string, isFinal: boolean }` | Fired as Gemini Live user/model speech transcripts arrive. |
| `xr-hold-to-ask-listening` | `{ mesh: string }` | Fired when a press-and-hold on a `holdToAsk` mesh begins listening. |
| `xr-hold-to-ask` | `{ mesh: string, transcript: string, prompt: string }` | Fired when a `holdToAsk` voice/text query is dispatched to Gemini Live. |
| `xr-gemini-interrupted` | `{}` | Fired when user speech barges in and cancels Gemini Live audio playback. |
| `xr-paint-stroke` | `{ index: number, points: number, lengthMeters: number }` | Fired when a 3D `spatial-paint` tube stroke completes. |
| `xr-webmcp-capture` | `{}` | Fired when a WebMCP agent invokes `capture_xr_view` (sets `data-xr-webmcp-indicator="active"`). |

--------------------------------------------------------------------------------

## Native Mobile Spatial Bridges (No WebViews Required)

`xr-live` compiles scenes into self-contained `.glb` and `.usdz` binaries with
embedded spatial trait metadata (`extras.xr`, `ANDROID_xr_scenecore`, and USDZ
`customData.xr`), allowing native Android and iOS/visionOS apps to run full
6DoF spatial experiences natively:

### Android (`mobile/android/src/main/java/com/google/threelive/`)

-   **[`XRLiveRuntimeSession.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveRuntimeSession.kt) & [`XRBlocksFeatures.kt`](../mobile/android/src/main/java/com/google/threelive/XRBlocksFeatures.kt):**
    Executes lazy head-follow springs, orbits, manipulation handles, Catmull-Rom
    spatial paint tubes, depth-colliding particles, Gaussian splat sorting, and
    `KHR_interactivity` behavior graphs natively on Google Filament.
-   **[`XRLiveSceneCoreHelper.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveSceneCoreHelper.kt):**
    Jetpack XR SceneCore integration for Android XR headsets and phones,
    attaching `MovableComponent`, `ResizableComponent`, `Anchor`, and billboard
    updates directly from compiled `.glb` bytes.
-   **[`XRGeminiLiveController.kt`](../mobile/android/src/main/java/com/google/threelive/gemini/XRGeminiLiveController.kt):**
    Native Kotlin WebSocket + PCM audio streaming client for Gemini Live.

### iOS & visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`)

-   **[`XRLiveRealityKit.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKit.swift) & [`XRBlocksRealityKitFeatures.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRBlocksRealityKitFeatures.swift):**
    Native Swift + RealityKit runtime supporting all `userData.xr` traits,
    manipulation handles, spatial paint tubes, particle emitters, Gaussian
    splats, `KHR_interactivity`, and `XRGeminiLiveController.swift`.
