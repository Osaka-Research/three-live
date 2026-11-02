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

# `<xr-live>` spatial computing and plugins guide

`<xr-live>` extends `<three-live>` into a full spatial computing runtime for **WebXR (Android XR, Meta Quest, and Apple Vision Pro)**, **mobile web AR**, and **native Android (`Google Filament` and Jetpack XR `SceneCore`) and iOS or visionOS (`Apple ARKit` and `RealityKit`)**.

It brings declarative spatial traits (`userData.xr`), seven optional **spatial plugins** for advanced features (`head-follow`, `manipulation-handles`, `world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`, and `splat-loader`), interactive HTML and CSS spatial cards (`<div slot="spatial">`), real-world depth occlusion and heightfield physics, 25-joint hand gesture recognition, a desktop 6DoF simulator, WebMCP browser AI tools, and zero-webview native mobile AR and XR runtimes.

For standard 3D viewing, `<model-viewer>` drop-in compatibility, `KHR_interactivity`, and PBR materials, see [`docs/three-live.md`](three-live.md). For end-to-end recipes, see [`docs/cookbook.md`](cookbook.md).

---

## Why `<xr-live>` pairs WebXR with native Filament and RealityKit runtimes

When building spatial features for phones, tablets, and headsets, relying on browser WebXR (`navigator.xr`) alone has three practical limitations:

* **iOS Safari, `WKWebView`, and Android System `WebView` don't support WebXR:** You can't start a WebXR session in Safari on iPhone or iPad, or inside an embedded `WKWebView` (iOS) or `android.webkit.WebView` (Android) in a native mobile app. Handing a static `.usdz` or `.glb` file to `AR Quick Look` or `Scene Viewer` displays the geometry, but loses JavaScript `animate()` loops, `KHR_interactivity` behavior graphs, and interactive spatial plugins.
* **Browser WebXR doesn't use native spatial compositors:** In Chrome on Android, WebXR renders WebGL2 in the browser's GPU process rather than using Google Filament or Jetpack XR SceneCore's `HomeSpace` shared space. On visionOS, browser WebXR is restricted to a fullscreen VR session without camera passthrough or SwiftUI Shared Space integration.
* **Bundle size on the web:** Shipping every XR subsystem in a single bundle adds unnecessary weight when a page only needs basic model viewing or one or two spatial tools.

`<xr-live>` addresses both web and native apps from a single scene definition:
* **On the web (`<xr-live>`):** Starts with small core bundles (`< 45 KB gz` for `xr-live-viewer.min.js`, or `< 65 KB gz` for `xr-live.min.js` with live Three.js authoring) and optional plugins for advanced features (`~2–4 KB gz` each, or `< 23.5 KB gz` for all seven combined).
* **In native Android, iOS, and visionOS apps (`XRLiveRuntimeSession` and `XRLiveRealityKitSession`):** The in-process Rust compiler (`ThreeLiveCompiler`) compiles `<script type="text/three">` on-device, serializes normalized `userData.xr` traits into `.glb` (`extras.xr` and `ANDROID_xr_scenecore`) and `.usdz` (`customData.xr`), and drives **Google Filament and Jetpack XR SceneCore** on Android and **Apple ARKit and RealityKit** on iOS and visionOS at 60 to 120 Hz—so interactive AR, `animate()` loops, `KHR_interactivity`, and all seven spatial plugins work natively on iOS and Android without a `WebView`.

---

## Quickstart

### Load the all-in-one bundle in HTML (`xr-live-full.min.js`)

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

  <!-- Live HTML and CSS spatial UI card rendered inside the 3D and XR scene -->
  <div slot="spatial" data-position="0.45 1.1 -1.1" data-xr-traits="grab billboard">
    <div style="padding: 16px; background: #0f172a; color: #f8fafc; border-radius: 16px; width: 240px;">
      <h3>Spatial control card</h3>
      <p>Pinch to grab, drag corner handles to scale, or pinch in empty space to paint.</p>
      <button id="buy-btn">Inspect in AR</button>
    </div>
  </div>
</xr-live>
```

### Register optional plugins for advanced features

When bundling with Vite, Rollup, esbuild, or Webpack, you can pair the `<xr-live>` core (`three-live/xr-live` at `< 65 KB gz`, or `three-live/xr-live-viewer` at `< 45 KB gz`) with only the specific plugins your application uses:

```ts
import { XRLiveElement } from 'three-live/xr-live';
import { registerXRTraitSerializer } from 'three-live/src/xr-trait-schema';
import { manipulationHandlesPlugin } from 'xr-live/src/plugins/manipulation-handles';
import { headFollowPlugin } from 'xr-live/src/plugins/head-follow';
import { spatialPaintPlugin } from 'xr-live/src/plugins/spatial-paint';

// Register only the plugins your scene uses (~2-4 KB gz each)
registerXRTraitSerializer();
XRLiveElement.registerPlugin(manipulationHandlesPlugin);
XRLiveElement.registerPlugin(headFollowPlugin);
XRLiveElement.registerPlugin(spatialPaintPlugin);
```

To load all seven spatial plugins without a bundler, import `/dist/xr-live-plugins.min.js` (`< 23.5 KB gz`) or `/dist/xr-live-full.min.js` (`< 104 KB gz`).

---

## Observed attributes (`<xr-live>` and `<xr-anchor>`)

`<xr-live>` inherits all [`<three-live>` attributes](three-live.md#observed-attributes) and adds the spatial attributes listed in the following table:

| Element | Attribute | Type and values | Default | Description |
| :---------- | :-------------------- | :---------------------------------------------------- | :------ | :---------- |
| `<xr-live>` | `xr-mode` | `'ar' \| 'vr' \| 'inline' \| 'auto'` | `'auto'` | Target WebXR session mode (`ar` requests `immersive-ar`; `vr` requests `immersive-vr`). |
| `<xr-live>` | `xr-depth` | `'occlusion' \| 'occlusion-physics' \| 'mesh' \| 'none'` | `'none'` | Enables WebXR `depth-sensing`, PBR depth occlusion, and analytical heightfield physics. |
| `<xr-live>` | `xr-hands` | `'gestures' \| 'joints' \| 'pinch' \| 'none'` | `'none'` | Enables 25-joint `XRHand` tracking (`hand-tracking`) and gesture classification. |
| `<xr-live>` | `xr-simulator` | `'living-room' \| 'office' \| 'tabletop' \| 'none'` | `'none'` | Enables the desktop 6DoF keyboard and mouse simulator (`WASD`, `Q` and `E`, mouse look, and virtual hands). |
| `<xr-live>` | `xr-profile` | `'quest3' \| 'android-xr' \| 'visionos' \| 'auto'` | `'auto'` | Target spatial hardware profile hint. |
| `<xr-live>` | `sound-feedback` | `boolean` | `false` | Plays procedural Web Audio earcons (`grab`, `release`, `bounce`, `hover`) and mobile haptics. |
| `<xr-live>` | `world-understanding` | `'' \| 'planes' \| 'planes reticle' \| 'false'` | — | Enables `xr-live-world-understanding` plane and mesh detection and the gaze surface reticle. |
| `<xr-live>` | `spatial-paint` | `'' \| '#rrggbb' \| 'false'` | — | Enables `xr-live-spatial-paint`; pinching in empty space extrudes 3D Catmull-Rom tube strokes. |
| `<xr-live>` | `webmcp` | `boolean` | `false` | Registers spatial AI tools (`inspect_xr_scene`, `place_xr_object_at_gaze`, `capture_xr_view`) on `navigator.modelContext`. |
| `<xr-live>` | `webmcp-allow-depth` | `boolean` | `false` | Opt-in gate required before `capture_xr_view` exposes the 8×8 metric `depthGridMeters` array. |
| `<xr-live>` | `webmcp-omit-pose` | `boolean` | `false` | Omits `headPosition` from `inspect_xr_scene` responses. |
| `<xr-anchor>` | `surface` | `'floor' \| 'wall' \| 'table' \| 'ceiling'` | `'floor'` | Target semantic surface for declarative child placement. |
| `<xr-anchor>` | `magnetic` | `boolean` | `false` | Continuously snaps the child anchor to the nearest matching surface plane. |

---

## Canonical `userData.xr` spatial traits

Defined in [`three-live/src/xr-trait-schema.ts`](../three-live/src/xr-trait-schema.ts), `mesh.userData.xr` traits are normalized, clamped to identical ranges, and exported into `.glb` (`nodes[i].extras.xr` and `nodes[i].extensions.ANDROID_xr_scenecore`) and `.usdz` (`customData = {dictionary xr = {...}}`) so scenes behave identically on Web, Android, and iOS or visionOS. The following table describes each trait key:

| Trait key | Type and options | Description |
| :------------------- | :----------------------------------------------------------------------------------------------- | :---------- |
| **`grab`** | `'1-hand' \| '2-hand' \| true` | 6DoF single-hand grab and rotate (`'1-hand'`) or two-hand grab, pinch-scale, and twist (`'2-hand'`). Legacy `grabbable: true` is also accepted. |
| **`scale`** | `{ min?: number, max?: number } \| true` | Two-handed pinch scaling clamped to `[min, max]` (defaults to `{ min: 0.05, max: 5 }`). |
| **`billboard`** | `'capsule' \| 'cylindrical' \| 'spherical' \| true` | Orients the node toward the viewer (`'capsule'` and `'cylindrical'` rotate around the Y axis; `'spherical'` faces the camera in 3D). |
| **`follow`** | `'head' \| 'hand-left' \| 'hand-right'` **or** `{ mode, lazy, distance, deadzoneDeg, stiffness, height, faceUser, snapOnStart }` | String values apply an eager spring follow; object values activate lazy head or hand follow with an angular deadzone (`deadzoneDeg`, default `15°`) and a critically damped spring (`stiffness`, default `6`). |
| **`anchor`** | `'floor' \| 'wall' \| 'table' \| 'horizontal' \| 'vertical'` | Pins the node to a detected real-world plane or simulator surface. |
| **`physics`** | `'dynamic' \| 'static'` | Steps rigid-body gravity, restitution bounce (`userData.xr.restitution`), sphere-to-sphere collisions, and depth heightfield collisions. |
| **`orbit`** | `{ target: [x,y,z] \| string, radius?: number, speed?: number, height?: number, phase?: number, faceCenter?: boolean }` | Orbits around a 3D world point or another mesh's `name` at `speed` rad/s. |
| **`handles`** | `{ rotateAxis?: 'y' \| 'none', minScale?: number, maxScale?: number } \| true` | Adds four top-corner uniform scale handles and a bottom pedestal yaw-rotation bar; emits `xr-handles-change`. |
| **`particles`** | `{ preset: 'rain' \| 'snow' \| 'sparks' \| 'confetti', count?: number, area?: number \| [x,y,z], speed?: number }` | Turns the node into a particle emitter volume (`count` up to `2,000`) that collides with the floor and WebXR depth surfaces. |
| **`holdToAsk`** | `{ prompt?: string, holdMs?: number } \| true` | Press-and-hold on the mesh starts speech recognition and sends a contextual prompt to Gemini Live; emits `xr-hold-to-ask`. |
| **`worldUnderstanding`** | `{ planes?: boolean, meshes?: boolean, reticle?: boolean, objects?: boolean }` | Opts the scene into WebXR plane and mesh detection and the gaze surface reticle (`__xr_reticle__`). |
| **`splatUrl`** | `string` (`https://` or relative `.splat` or `.spz` URL) | Loads and back-to-front depth-sorts 3D Gaussian Splats (`.splat` or Niantic `.spz` v2 and v3, up to `1,000,000` splats). |
| **`audio`** | `string` **or** `{ src: string, refDistance?: number, loop?: boolean }` | Attaches a 3D `PannerNode` HRTF audio source to the mesh. |
| **`pointerEvents`** | `'none'` | Excludes the mesh from raycast picking so rays pass through it. |

---

## Spatial plugin suite

All seven spatial plugins are included in `xr-live-full.min.js` and `xr-live-plugins.min.js`, or can be imported individually from `xr-live/src/plugins/<name>` and registered via `XRLiveElement.registerPlugin(plugin)`. Every plugin has a corresponding native implementation in Android (`mobile/android/src/main/java/com/google/threelive/`) and iOS or visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`):

* **`head-follow` (`xr-live-head-follow`):** Implements `FollowHead` lazy HUD behavior (angular deadzone plus critically damped spring `stepCriticallyDampedSpring`) and `Orbit` satellite motion (`userData.xr.orbit`).
* **`manipulation-handles` (`xr-live-manipulation-handles`):** Attaches four top-corner uniform-scale handles and a bottom pedestal yaw-rotation bar to any mesh with `userData.xr.handles`. Dispatches `xr-handles-change` (`{ mesh, scale, yawDeg }`).
* **`world-understanding` (`xr-live-world-understanding`):** Tracks WebXR `detectedPlanes` (`MAX_TRACKED_PLANES = 64`) and `detectedMeshes`, updates a surface-normal gaze reticle (`__xr_reticle__`), provides `XRTapeMeasure`, and unprojects 2D bounding boxes (`[ymin, xmin, ymax, xmax]`) into 3D world space via `detectObjects(element, detections)`, dispatching `xr-object-detected`.
* **`gemini-live` (`xr-live-gemini-live`):** Streams viewport frames and 16 kHz PCM microphone audio to a Gemini Live `wss://` endpoint (`connectGeminiLive(element, options)`), plays 24 kHz PCM model audio with barge-in cancellation (`xr-gemini-interrupted`), emits live `xr-transcription` (`{ speaker, text, isFinal }`), answers `report_objects` tool calls with 3D unprojection, and wires `userData.xr.holdToAsk` press-and-hold queries (`xr-hold-to-ask-listening`, `xr-hold-to-ask`).
* **`spatial-paint` (`xr-live-spatial-paint`):** Enabled via the `spatial-paint` attribute (for example, `spatial-paint="#ff3366"`). Pinching in empty space smooths input points with a uniform Catmull-Rom spline and extrudes twist-free parallel-transport tubes (`TubeStrokeBuilder`), emitting `xr-paint-stroke` (`{ index, points, lengthMeters }`). Supports programmatic `undo()` and `clear()` via `getSpatialPaintController(element)`.
* **`depth-particles` (`xr-live-depth-particles`):** Simulates `rain`, `snow`, `sparks`, and `confetti` emitters (`userData.xr.particles`, up to `MAX_EMITTERS = 8` and `2,000` particles per emitter) with a deterministic PRNG and real-world WebXR depth collision (`isOccludedByDepth`).
* **`splat-loader` (`xr-live-splat-loader`):** Streams `.splat` (32-byte records) and Niantic `.spz` (v2 and v3, raw or gzipped) 3D Gaussian Splat files for any node with `userData.xr.splatUrl`, sorting splats back-to-front with a 16-bit counting sort on each frame.

---

## Spatial DOM cards (`<div slot="spatial">`)

Any child element with `slot="spatial"` is projected into 3D space as an interactive textured quad inside WebXR and inline 3D views:

* **Sanitized SVG `<foreignObject>` rasterization:** Renders live HTML and CSS into a crisp GPU texture with automatic XSS hardening (strips dangerous tags and handlers, blocks `javascript:` and `data:text/html` URIs, and escapes XML entities).
* **3D raycast hit-testing:** Controller rays, hand pinch rays, and pointer clicks compute UV intersection coordinates and dispatch synthetic `click`, `pointerdown`, `pointermove`, and `pointerup` events to the underlying DOM elements (for example, `<button>`).
* **Trait support:** Add `data-xr-traits="grab billboard"` and `data-position="x y z"` directly on `<div slot="spatial">`.

---

## Imperative methods and DOM events

### Imperative methods

* `await element.enterSpatialAR(sourceOverride?, forceFallback?)`: Launches WebXR `immersive-ar`, iOS `AR Quick Look` (`.usdz`), or Android `Scene Viewer` (`intent://`).
* `element.transitionToVR({ color?: [r, g, b], durationMs?: number })`: Smoothly fades the viewport background from transparent AR passthrough to an opaque VR environment.
* `element.transitionToAR({ durationMs?: number })`: Smoothly fades the viewport background back to transparent AR passthrough.
* `await element.captureViewFrame({ format?, quality?, includeDepth? })`: Captures the rendered viewport (`dataUrl`, `base64`), camera `viewMatrix` and `projectionMatrix`, `headPosition`, and optional 8×8 `depthGridMeters`.
* `element.stepSpatialFrame(dtSeconds)`: Steps all spatial subsystems (automatically called during WebXR and simulator frames).

### Spatial DOM events

The `<xr-live>` element dispatches the custom events listed in the following table:

| Event | `event.detail` payload | Description |
| :------------------------ | :----------------------------------------------------------------------- | :---------- |
| `xr-select-start`, `xr-select-move`, `xr-select-end` | `{ hand: 'left' \| 'right' \| 'screen', pivotPosition, quaternion, rayOrigin, rayDirection, hit }` | Fired on controller trigger, hand pinch, or screen touch ray. |
| `xr-handles-change` | `{ mesh, scale: number, yawDeg: number }` | Fired when a `userData.xr.handles` corner scale handle or yaw bar is dragged. |
| `xr-object-detected` | `{ label: string, position: [number, number, number], distanceMeters: number, source: 'plane' \| 'depth' \| 'fallback' }` | Fired for each 2D detection unprojected into 3D by `world-understanding`. |
| `xr-transcription` | `{ speaker: 'user' \| 'model', text: string, isFinal: boolean }` | Fired as Gemini Live user and model speech transcripts arrive. |
| `xr-hold-to-ask-listening` | `{ mesh: string }` | Fired when a press-and-hold on a `holdToAsk` mesh begins listening. |
| `xr-hold-to-ask` | `{ mesh: string, transcript: string, prompt: string }` | Fired when a `holdToAsk` voice or text query is dispatched to Gemini Live. |
| `xr-gemini-interrupted` | `{}` | Fired when user speech barges in and cancels Gemini Live audio playback. |
| `xr-paint-stroke` | `{ index: number, points: number, lengthMeters: number }` | Fired when a 3D `spatial-paint` tube stroke completes. |
| `xr-webmcp-capture` | `{}` | Fired when a WebMCP agent invokes `capture_xr_view` (sets `data-xr-webmcp-indicator="active"`). |

---

## Native mobile spatial bridges (no WebViews required)

`xr-live` compiles scenes into self-contained `.glb` and `.usdz` binaries with embedded spatial trait metadata (`extras.xr`, `ANDROID_xr_scenecore`, and USDZ `customData.xr`), allowing native Android and iOS or visionOS apps to run full 6DoF spatial experiences natively:

### Android (`mobile/android/src/main/java/com/google/threelive/`)

* **[`XRLiveRuntimeSession.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveRuntimeSession.kt) and [`XRSpatialFeatures.kt`](../mobile/android/src/main/java/com/google/threelive/XRSpatialFeatures.kt):** Executes lazy head-follow springs, orbits, manipulation handles, Catmull-Rom spatial paint tubes, depth-colliding particles, Gaussian splat sorting, and `KHR_interactivity` behavior graphs natively on Google Filament.
* **[`XRLiveSceneCoreHelper.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveSceneCoreHelper.kt):** Jetpack XR SceneCore integration for Android XR headsets and phones, attaching `MovableComponent`, `ResizableComponent`, `Anchor`, and billboard updates directly from compiled `.glb` bytes.
* **[`XRGeminiLiveController.kt`](../mobile/android/src/main/java/com/google/threelive/gemini/XRGeminiLiveController.kt):** Native Kotlin WebSocket and PCM audio streaming client for Gemini Live.

### iOS and visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`)

* **[`XRLiveRealityKitSession.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKitSession.swift), [`XRLiveRealityKit.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKit.swift), and [`XRSpatialRealityKitFeatures.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRSpatialRealityKitFeatures.swift):** Native Swift and RealityKit runtime supporting all `userData.xr` traits, manipulation handles, spatial paint tubes, particle emitters, Gaussian splats, `KHR_interactivity`, and `XRGeminiLiveController.swift`.
