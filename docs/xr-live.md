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

It brings declarative spatial traits (`userData.xr`), the 14 modular **spatial plugins** (`head-follow`, `manipulation-handles`, `world-understanding`,
`gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`, `exploded-view`, `persistent-anchors`, `spatial-locomotion`, `shared-room`), interactive
HTML/CSS spatial cards (`<div slot="spatial">`), real-world depth occlusion &
heightfield physics, 25-joint hand gesture recognition, a desktop 6DoF
simulator, WebMCP browser AI tools, and zero-webview native mobile AR/XR
bridges.

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
| `<xr-live>` | `spatial-measure` | `'' \| 'bounds' \| 'tape' \| 'all' \| 'none'` | — | Enables `xr-live-spatial-measure` 3D bounding-box dimension callouts and/or AR point-to-point tape measure. |
| `<xr-live>` | `measure-unit` | `'auto' \| 'm' \| 'cm' \| 'mm' \| 'in' \| 'ft-in'` | `'auto'` | Default measurement display unit for `spatial-measure`. |
| `<xr-live>` | `magnetic-snap` | `'' \| 'grid' \| 'surface' \| 'sockets' \| 'all' \| 'none'` | — | Enables `xr-live-magnetic-snap` socket, Cartesian grid, surface, and yaw-angle snapping. |
| `<xr-live>` | `snap-grid` | `number` or `'gx gy gz'` (meters) | — | Default Cartesian snap grid spacing in meters (e.g. `'0.05'` or `'0.05 0.05 0.05'`). |
| `<xr-live>` | `snap-angle` | `number` (`0..180` degrees) | `0` | Default yaw rotation snap increment in degrees. |
| `<xr-live>` | `gaze-dwell` | `'' \| 'auto' \| 'false' \| 'none'` | — | Enables `xr-live-gaze-dwell` hands-free eye/head gaze reticle and radial dwell selection. |
| `<xr-live>` | `dwell-time` | `number` (`250..10000` ms) | `1200` | Default gaze dwell duration in milliseconds before triggering selection. |
| `<xr-live>` | `explode` | `number` (`0..1`) | `0` | Normalized multi-part assembly explosion factor (`xr-live-exploded-view`). |
| `<xr-live>` | `explode-mode` | `'radial' \| 'axial-x' \| 'axial-y' \| 'axial-z' \| 'hierarchical'` | `'radial'` | Automatic explosion vector strategy when a part omits `userData.xr.explode.direction`. |
| `<xr-live>` | `explode-scale` | `number` | `1.0` | Global distance multiplier applied to per-part explosion offsets. |
| `<xr-live>` | `section-plane` | `'none' \| 'x:<d>' \| 'y:<d>' \| 'z:<d>' \| '-x:<d>' \| '-y:<d>' \| '-z:<d>' \| 'interactive'` | `'none'` | Real-time GPU cross-section clipping plane in scene (model) space (`d` in meters; the cut follows the model through AR placement and turntable rotation) with optional draggable gizmo frame. |
| `<xr-live>` | `persistent-anchors` | `''` or `string` (namespace) | — | Enables `xr-live-persistent-anchors` cross-session transform persistence (`xr-live:anchors:<ns>`). |
| `<xr-live>` | `persist-url-hash` | `boolean` | `false` | Syncs persisted node poses into `#xr-state=<base64url>` (`<= 8 KB`) for zero-backend link sharing. |
| `<xr-live>` | `locomotion` | `'' \| 'teleport' \| 'snap-turn' \| 'smooth' \| 'teleport snap-turn' \| 'none'` | — | Enables `xr-live-spatial-locomotion` parabolic teleportation, thumbstick snap-turn, or smooth glide. |
| `<xr-live>` | `snap-turn-deg` | `number` (degrees) | `30` | Horizontal thumbstick snap-turn angle in degrees. |
| `<xr-live>` | `comfort-vignette` | `boolean` | `true` | Renders a `120ms` peripheral FOV comfort vignette during teleports and snap-turns. |
| `<xr-live>` | `shared-room` | `'<room-id>'` or `'wss://...'` | — | Enables `xr-live-shared-room` multi-user co-presence via `BroadcastChannel` or WebSocket relay. |
| `<xr-live>` | `peer-name` | `string` (max `32` chars) | — | Local peer display name broadcast to room participants. |
| `<xr-live>` | `peer-color` | `'#rrggbb'` | `'#38bdf8'` | Local peer 3D visor & laser ray tint color in `shared-room`. |
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
| **`billboard`** | `'capsule' \| 'cylindrical' \| 'spherical' \| true` | Orients node toward the viewer (`'capsule'` and `'cylindrical'` rotate around Y; `'spherical'` faces camera in 3D). |
| **`follow`** | `'head' \| 'hand-left' \| 'hand-right'` **or** `{ mode, lazy, distance, deadzoneDeg, stiffness, height, faceUser, snapOnStart }` | String values apply an eager spring follow; object values activate lazy head/hand follow with angular deadzone (`deadzoneDeg`, default `15°`) and critically damped spring (`stiffness`, default `6`). |
| **`anchor`** | `'floor' \| 'wall' \| 'ceiling' \| 'table' \| 'horizontal' \| 'vertical'` **or** `{ target?, id?, persist? }` | Pins the node to a detected real-world plane or simulator surface; setting `persist: true` (or `id`) persists user-moved transforms across reloads and `#xr-state` links. |
| **`physics`** | `'dynamic' \| 'static'` | Steps rigid-body gravity, restitution bounce (`userData.xr.restitution`), sphere-to-sphere collisions, and depth heightfield collisions. |
| **`orbit`** | `{ target: [x,y,z] \| string, radius?: number, speed?: number, height?: number, phase?: number, faceCenter?: boolean }` | Orbits around a 3D world point or another mesh's `name` at `speed` rad/s. |
| **`handles`** | `{ rotateAxis?: 'y' \| 'none', minScale?: number, maxScale?: number } \| true` | Adds 4 top-corner uniform scale handles and a bottom pedestal yaw-rotation bar; emits `xr-handles-change`. |
| **`dimensions`** | `{ enabled?: boolean, unit?: 'auto' \| 'm' \| 'cm' \| 'mm' \| 'in' \| 'ft-in', axes?: Array<'x' \| 'y' \| 'z'>, color?: string, showOnSelect?: boolean } \| true` | Renders live `W × H × D` bounding-box dimension guide bars and camera-facing vector-glyph metric/imperial labels (`spatial-measure`). |
| **`snapTo`** | `{ grid?: number \| [x,y,z], angleDeg?: number, surface?: 'none' \| 'floor' \| 'wall' \| 'ceiling' \| 'any', socketTag?: string, radius?: number } \| true` | Snaps grabbed meshes to matching `snapSocket` anchors (with `1.25×` breakaway hysteresis), Cartesian grids, surfaces, and yaw increments (`magnetic-snap`). |
| **`snapSocket`** | `string` **or** `{ tag: string, radius?: number, alignRotation?: boolean, highlightColor?: string }` | Marks a node as a magnetic snap target socket with a pulsing proximity highlight ring (`magnetic-snap`). |
| **`gaze`** | `{ enabled?: boolean, dwellMs?: number, repeat?: boolean, action?: 'select' \| 'ask' } \| true` | Opts a mesh into hands-free eye/head gaze dwell (`dwellMs` in `[250, 10000]`, default `1200`), firing `meshclick` / `KHR_interactivity` (`'select'`) or Gemini Live (`'ask'`). |
| **`explode`** | `{ enabled?: boolean, direction?: [x,y,z], distance?: number, layer?: number, leaderLine?: boolean } \| boolean` | Configures per-part explosion vector, distance (`0..10m`), staggered `layer` (`1..10`), and dashed leader lines (`exploded-view`); `false` pins a base part in place. |
| **`navigable`** | `boolean \| 'walkable' \| 'blocked'` | Marks floor/platform meshes as valid (`'walkable'`) or forbidden (`'blocked'`) landing targets for parabolic XR teleportation (`spatial-locomotion`). |
| **`sync`** | `boolean` | Controls whether user manipulations on a node synchronize across peers in `shared-room` (defaults to `true` on grabbable nodes; set `false` to keep local-only). |
| **`particles`** | `{ preset: 'rain' \| 'snow' \| 'sparks' \| 'confetti', count?: number, area?: number \| [x,y,z], speed?: number }` | Turns the node into a particle emitter volume (`count` up to `2,000`) that collides with floor and WebXR depth surfaces. |
| **`holdToAsk`** | `{ prompt?: string, holdMs?: number } \| true` | Press-and-hold on the mesh starts speech recognition and sends a contextual prompt to Gemini Live; emits `xr-hold-to-ask`. |
| **`worldUnderstanding`** | `{ planes?: boolean, meshes?: boolean, reticle?: boolean, objects?: boolean }` | Opts the scene into WebXR plane and mesh detection and the gaze surface reticle (`__xr_reticle__`). |
| **`splatUrl`** | `string` (`https://` or relative `.splat` or `.spz` URL) | Loads and back-to-front depth-sorts 3D Gaussian Splats (`.splat` or Niantic `.spz` v2 and v3, up to `1,000,000` splats). |
| **`audio`** | `string` **or** `{ src: string, refDistance?: number, loop?: boolean }` | Attaches a 3D `PannerNode` HRTF audio source to the mesh. |
| **`pointerEvents`** | `'none'` | Excludes the mesh from raycast picking so rays pass through it. |

---

## Spatial plugin suite

All 14 spatial plugins are included automatically in `xr-live-full.min.js` (or can be loaded modularly via `xr-live-plugins.min.js` or `xr-live/plugins`):

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
8. **`spatial-measure` (`xr-live-spatial-measure`):**
   - Renders live `W × H × D` bounding-box dimension callout bars and procedural 3D vector-glyph labels (`userData.xr.dimensions` or `spatial-measure="bounds"`), plus an interactive point-to-point AR/3D tape measure (`spatial-measure="tape"` / `"all"`, up to `MAX_TAPE_SEGMENTS = 16`) that emits `measurecomplete` and clears via double-pinch or `element.clearMeasurements()`.
9. **`magnetic-snap` (`xr-live-magnetic-snap`):**
   - Provides declarative socket snapping (`userData.xr.snapSocket` + `userData.xr.snapTo.socketTag`) with `1.25×` breakaway hysteresis and a pulsing preview ring (`1.5×` radius), plus Cartesian grid (`snap-grid`), rotational yaw (`snap-angle`), and real-world/simulator surface (`floor` / `wall` / `ceiling` / `any`) quantization. Dispatches `xrsnap` and `xrunsnap`.
10. **`gaze-dwell` (`xr-live-gaze-dwell`):**
    - Hands-free eye/head gaze raycasting for Apple Vision Pro, Android XR, and accessibility (`gaze-dwell` / `userData.xr.gaze`). Applies EMA ray smoothing (`alpha = 0.25`), a `1.5°` micro-saccade grace cone, a `150ms` grace delay, and a constant-angular-size surface-normal progress ring, dispatching `gazeenter`, `gazeleave`, and `gazedwell` (routing `'select'` to `meshclick` + `KHR_interactivity`, or `'ask'` to `gemini-live`).
11. **`exploded-view` (`xr-live-exploded-view`):**
    - Explodes multi-part CAD/engineering assemblies (`explode="0..1"`, `explode-mode`, `userData.xr.explode`) with staggered per-layer timing (`layer: 1..10`), spring-smoothed interpolation, dashed leader lines, two-hand XR spread gestures, and a real-time GPU fragment cross-section clipping slicer (`section-plane="x:0"` / `"interactive"`). Dispatches `explodechange`.
12. **`persistent-anchors` (`xr-live-persistent-anchors`):**
    - Restores and auto-saves user-manipulated transforms (`persistent-anchors` / `userData.xr.anchor.persist`) across a 3-tier pipeline: `#xr-state=<base64url>` shareable URL hashes (`persist-url-hash`, capped at `MAX_HASH_BYTES = 8192`), namespaced `localStorage` (`MAX_PERSISTED_NODES = 128`), and WebXR `XRAnchor` persistent handles. Dispatches `anchorsrestored`.
13. **`spatial-locomotion` (`xr-live-spatial-locomotion`):**
    - Comfortable room-scale and architectural XR navigation (`locomotion="teleport snap-turn"` / `userData.xr.navigable`) with a ballistic parabolic teleport arc + cyan/red landing ring, hysteresis-guarded thumbstick snap-turns (`snap-turn-deg`, default `30°`), optional smooth glide, and a `120ms` peripheral FOV comfort vignette (`comfort-vignette`). Dispatches `xrteleport`.
14. **`shared-room` (`xr-live-shared-room`):**
    - Zero-dependency multi-user co-presence (`shared-room="<room-id>"` via same-origin `BroadcastChannel("xr-live:room:<id>")` or cross-device `wss://` relay, `MAX_PEERS = 16`, `MAX_PAYLOAD_BYTES = 16384`). Broadcasts `20 Hz` quantized head poses + tinted 3D peer visor pills & laser rays, enforces `2000ms` optimistic soft-lock ownership leases on grabbed nodes (local grabs on a node another peer holds are refused; near-simultaneous grabs resolve to the lowest `peerId` on every peer), and synchronizes `exploded-view` factors and `spatial-paint` 3D tube strokes (`MAX_REMOTE_STROKES = 64`). Dispatches `peerjoin`, `peerleave`, `peersync`, and `peergrabconflict`.

---

## Spatial DOM cards (`<div slot="spatial">`)

Any child element with `slot="spatial"` is projected into 3D space as an interactive textured quad inside WebXR and inline 3D views:

* **Sanitized SVG `<foreignObject>` rasterization:** Renders live HTML and CSS into a crisp GPU texture with automatic XSS hardening (strips dangerous tags and handlers, blocks `javascript:` and `data:text/html` URIs, and escapes XML entities).
* **3D raycast hit-testing:** Controller rays, hand pinch rays, and pointer clicks compute UV intersection coordinates and dispatch synthetic `click`, `pointerdown`, `pointermove`, and `pointerup` events to the underlying DOM elements (for example, `<button>`).
* **Trait support:** Add `data-xr-traits="grab billboard"` and `data-position="x y z"` directly on `<div slot="spatial">`.

---

## Imperative methods and DOM events

### Imperative Methods
- `await element.enterSpatialAR(sourceOverride?, forceFallback?)`: Launches WebXR `immersive-ar`, iOS Quick Look (`.usdz`), or Android Scene Viewer (`intent://`).
- `element.transitionToVR({ color?: [r, g, b], durationMs?: number })`: Smoothly fades the viewport background from transparent AR passthrough to an opaque VR environment.
- `element.transitionToAR({ durationMs?: number })`: Smoothly fades back to transparent AR passthrough.
- `await element.captureViewFrame({ format?, quality?, includeDepth? })`: Captures the current rendered viewport (`dataUrl`, `base64`), camera `viewMatrix` / `projectionMatrix`, `headPosition`, and optional 8×8 `depthGridMeters`.
- `element.stepSpatialFrame(dtSeconds)`: Steps all spatial subsystems (automatically called during WebXR and simulator frames).
- `element.clearMeasurements()`: Clears all active and locked 3D tape-measure segments (`spatial-measure`).
- `element.setExplode(factor)`: Smoothly animates the assembly explosion factor (`0..1`) and emits `explodechange` (`exploded-view`).
- `element.savePersistedAnchors()` / `element.clearPersistedAnchors()`: Saves or clears persisted anchor poses across `localStorage`, `#xr-state`, and WebXR handles (`persistent-anchors`).
- `element.exportAnchorState()` / `element.importAnchorState(token)`: Exports or imports a compact base64url layout state token (`persistent-anchors`).
- `element.teleportTo([x, y, z])`: Teleports the viewer rig to `[x, y, z]` and emits `xrteleport` (`spatial-locomotion`).
- `element.getSharedPeers()`: Returns the list of currently active remote peers (`RemotePeerState[]`) in `shared-room`.

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
| `measurecomplete` | `{ start: [x,y,z], end: [x,y,z], distanceMeters: number, formatted: string }` | Fired when a `spatial-measure` point-to-point tape segment is locked. |
| `xrsnap` | `{ node, socket, position: [x,y,z], quaternion: [x,y,z,w], mode: 'socket' \| 'grid' \| 'surface' \| 'angle' }` | Fired when `magnetic-snap` snaps a grabbed or released mesh. |
| `xrunsnap` | `{ node, socket }` | Fired when a mesh is pulled past the `1.25×` breakaway radius of a `snapSocket`. |
| `gazeenter` / `gazeleave` | `{ node, point }` / `{ node }` | Fired when the smoothed `gaze-dwell` ray enters or leaves a gazeable mesh. |
| `gazedwell` | `{ node, point: [x,y,z], action: 'select' \| 'ask' }` | Fired when radial gaze dwell reaches `100%`. |
| `explodechange` | `{ factor: number, source: 'attribute' \| 'gesture' \| 'api' \| 'peer' }` | Fired when `exploded-view` updates the assembly explosion factor. |
| `anchorsrestored` | `{ count: number, source: 'xr-anchor' \| 'storage' \| 'url-hash' }` | Fired when `persistent-anchors` restores saved node poses. |
| `xrteleport` | `{ from: [x,y,z], to: [x,y,z], yawDeg: number }` | Fired when `spatial-locomotion` teleports the viewer rig. |
| `peerjoin` / `peerleave` | `{ peerId: string, name: string, color: string }` | Fired when a remote participant joins, disconnects, or times out of `shared-room`. |
| `peergrabconflict` | `{ peerId: string, nodeId: string }` | Fired when a remote participant wins a near-simultaneous grab of the same node and the local hold is released. |
| `peersync` | `{ peerId: string, nodeId: string }` | Fired when `shared-room` applies a remote node transform, explode factor (`__explode__`), or paint stroke (`paint:<id>`). |
| `xr-webmcp-capture` | `{}` | Fired when a WebMCP agent invokes `capture_xr_view` (sets `data-xr-webmcp-indicator="active"`). |

---

## Native mobile spatial bridges (no WebViews required)

`xr-live` compiles scenes into self-contained `.glb` and `.usdz` binaries with embedded spatial trait metadata (`extras.xr`, `ANDROID_xr_scenecore`, and USDZ `customData.xr`), allowing native Android and iOS or visionOS apps to run full 6DoF spatial experiences natively:

### Android (`mobile/android/src/main/java/com/google/threelive/`)

-   **[`XRLiveRuntimeSession.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveRuntimeSession.kt), [`XRSpatialFeatures.kt`](../mobile/android/src/main/java/com/google/threelive/XRSpatialFeatures.kt), & Modular Feature Controllers (`SpatialMeasure.kt`, `MagneticSnap.kt`, `GazeDwell.kt`, `ExplodedView.kt`, `PersistentAnchors.kt`, `SpatialLocomotion.kt`, `SharedRoom.kt`):**
    Executes lazy head-follow springs, orbits, manipulation handles, Catmull-Rom
    spatial paint tubes, depth-colliding particles, Gaussian splat sorting, 3D
    dimension callouts & tape measure, magnetic socket/grid snapping, gaze dwell,
    exploded-view assemblies & section clipping, persistent anchors, parabolic
    locomotion, multi-user room sync, and `KHR_interactivity` behavior graphs
    natively on Google Filament. In a shared room, start host grabs with
    `XRSpatialFeatures.requestGrab(node)` (or check the return value of
    `XRLiveRuntimeSession.setNodeGrabbed(node, true)`) and cancel the gesture
    when it returns `false`: another peer holds the node. Near-simultaneous grabs
    resolve like the web (lowest peer ID wins) and report
    `Listener.onPeerGrabConflict`.
-   **[`XRLiveSceneCoreHelper.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveSceneCoreHelper.kt):**
    Jetpack XR SceneCore integration for Android XR headsets and phones,
    attaching `MovableComponent`, `ResizableComponent`, `Anchor`, and billboard
    updates directly from compiled `.glb` bytes.
-   **[`XRGeminiLiveController.kt`](../mobile/android/src/main/java/com/google/threelive/gemini/XRGeminiLiveController.kt):**
    Native Kotlin WebSocket + PCM audio streaming client for Gemini Live.

### iOS and visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`)

-   **[`XRLiveRealityKit.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKit.swift), [`XRSpatialRealityKitFeatures.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRSpatialRealityKitFeatures.swift), & Modular Feature Controllers (`SpatialMeasure.swift`, `MagneticSnap.swift`, `GazeDwell.swift`, `ExplodedView.swift`, `PersistentAnchors.swift`, `SpatialLocomotion.swift`, `SharedRoom.swift`):**
    Native Swift + RealityKit runtime supporting all 14 spatial plugin behaviors,
    `userData.xr` traits, manipulation handles, spatial paint tubes, particle
    emitters, Gaussian splats, `KHR_interactivity`, and
    `XRGeminiLiveController.swift`. In a shared room, start host grabs with
    `XRSpatialRealityKitFeatures.requestGrab(_:)` and cancel the gesture when it
    returns `false` (another peer holds the node); near-simultaneous grabs
    resolve like the web and call `onPeerGrabConflict`.
