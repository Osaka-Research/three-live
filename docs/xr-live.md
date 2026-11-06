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

`<xr-live>` extends `<three-live>` into a full spatial computing runtime for
**WebXR (Android XR, Meta Quest, and Apple Vision Pro)**, **mobile web AR**, and
**native Android (`Google Filament` and Jetpack XR `SceneCore`) and iOS or
visionOS (`Apple ARKit` and `RealityKit`)**.

It brings declarative spatial traits (`userData.xr`), 15 optional **spatial
plugins** for advanced features (`head-follow`, `manipulation-handles`,
`world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`,
`splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`,
`exploded-view`, `persistent-anchors`, `spatial-locomotion`, `shared-room`, and
`spatial-audio`), interactive HTML and CSS spatial cards
(`<div slot="spatial">`), real-world depth occlusion and heightfield physics,
25-joint hand gesture recognition, a desktop 6DoF simulator, WebMCP browser AI
tools, and zero-webview native mobile AR and XR runtimes.

For standard 3D viewing, `<model-viewer>` drop-in compatibility,
`KHR_interactivity`, and PBR materials, see
[`docs/three-live.md`](three-live.md). For end-to-end recipes, see
[`docs/cookbook.md`](cookbook.md).

--------------------------------------------------------------------------------

## Why `<xr-live>` pairs WebXR with native Filament and RealityKit runtimes

When building spatial features for phones, tablets, and headsets, relying on
browser WebXR (`navigator.xr`) alone has three practical limitations:

*   **iOS Safari, `WKWebView`, and Android System `WebView` don't support
    WebXR:** You can't start a WebXR session in Safari on iPhone or iPad, or
    inside an embedded `WKWebView` (iOS) or `android.webkit.WebView` (Android)
    in a native mobile app. Handing a static `.usdz` or `.glb` file to
    `AR Quick Look` or `Scene Viewer` displays the geometry, but loses
    JavaScript `animate()` loops, `KHR_interactivity` behavior graphs, and
    interactive spatial plugins.
*   **Browser WebXR doesn't use native spatial compositors:** In Chrome on
    Android, WebXR renders WebGL2 in the browser's GPU process rather than using
    Google Filament or Jetpack XR SceneCore's `HomeSpace` shared space. On
    visionOS, browser WebXR is restricted to a fullscreen VR session without
    camera passthrough or SwiftUI Shared Space integration.
*   **Bundle size on the web:** Shipping every XR subsystem in a single bundle
    adds unnecessary weight when a page only needs basic model viewing or one or
    two spatial tools.

`<xr-live>` addresses both web and native apps from a single scene definition:

*   **On the web (`<xr-live>`):** Starts with small core bundles (`< 52 KB gz`
    for `xr-live-viewer.min.js`, or `< 73 KB gz` for `xr-live.min.js` with live
    Three.js authoring) and optional plugins for advanced features (`~2–5 KB gz`
    each, or `< 61 KB gz` for all 15 combined).
*   **In native Android, iOS, and visionOS apps (`XRLiveRuntimeSession` and
    `XRLiveRealityKitSession`):** The in-process Rust compiler
    (`ThreeLiveCompiler`) compiles `<script type="text/three">` on-device,
    serializes normalized `userData.xr` traits into `.glb` (`extras.xr` and
    `ANDROID_xr_scenecore`) and `.usdz` (`customData.xr`), and drives **Google
    Filament and Jetpack XR SceneCore** on Android and **Apple ARKit and
    RealityKit** on iOS and visionOS at 60 to 120 Hz—so interactive AR,
    `animate()` loops, `KHR_interactivity`, and all 15 spatial plugins work
    natively on iOS and Android without a `WebView`.

--------------------------------------------------------------------------------

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

When bundling with Vite, Rollup, esbuild, or Webpack, you can pair the
`<xr-live>` core (`three-live/xr-live` at `< 73 KB gz`, or
`three-live/xr-live-viewer` at `< 52 KB gz`) with only the specific plugins your
application uses:

```ts
import { XRLiveElement } from 'three-live/xr-live';
import { registerXRTraitSerializer } from 'three-live/src/xr-trait-schema';
import { spatialMeasurePlugin } from 'xr-live/src/plugins/spatial-measure';
import { magneticSnapPlugin } from 'xr-live/src/plugins/magnetic-snap';
import { explodedViewPlugin } from 'xr-live/src/plugins/exploded-view';

// Register only the plugins your scene uses (~2-5 KB gz each)
registerXRTraitSerializer();
XRLiveElement.registerPlugin(spatialMeasurePlugin);
XRLiveElement.registerPlugin(magneticSnapPlugin);
XRLiveElement.registerPlugin(explodedViewPlugin);
```

To load all 15 spatial plugins without a bundler, import
`/dist/xr-live-spatial.min.js` (`< 61 KB gz`) or `/dist/xr-live-full.min.js`
(`< 193 KB gz`, which also includes `xr-live-sensors` and the 6 `xr-live-sim`
simulation plugins).

--------------------------------------------------------------------------------

## Observed attributes (`<xr-live>` and `<xr-anchor>`)

`<xr-live>` inherits all
[`<three-live>` attributes](three-live.md#observed-attributes) and adds the
spatial attributes listed in the following table:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Element | Attribute | Type and values | Default | Description |
| :------------ | :-------------------- | :------------------ | :---------- | :------------------------------- |
| `<xr-live>` | `xr-mode` | `'ar' \| 'vr' \| 'inline' \| 'auto'` | `'auto'` | Target WebXR session mode (`ar` requests `immersive-ar`; `vr` requests `immersive-vr`). |
| `<xr-live>` | `xr-depth` | `'occlusion' \| 'occlusion-physics' \| 'mesh' \| 'none'` | `'none'` | Enables WebXR `depth-sensing`, PBR depth occlusion, and analytical heightfield physics. |
| `<xr-live>` | `xr-hands` | `'gestures' \| 'joints' \| 'pinch' \| 'none'` | `'none'` | Enables 25-joint `XRHand` tracking (`hand-tracking`) and gesture classification. |
| `<xr-live>` | `xr-simulator` | `'living-room' \| 'office' \| 'tabletop' \| 'none'` | `'none'` | Enables the desktop 6DoF keyboard and mouse simulator (`WASD`, `Q` and `E`, mouse look, and virtual hands). |
| `<xr-live>` | `xr-profile` | `'quest3' \| 'android-xr' \| 'visionos' \| 'auto'` | `'auto'` | Target spatial hardware profile hint. |
| `<xr-live>` | `sound-feedback` | `boolean` | `false` | Plays procedural Web Audio earcons (`grab`, `release`, `bounce`, `hover`) and mobile haptics. |
| `<xr-live>` | `world-understanding` | `'' \| 'planes' \| 'planes reticle' \| 'false'` | — | Enables `xr-live-world-understanding` plane and mesh detection and the gaze surface reticle. |
| `<xr-live>` | `spatial-paint` | `'' \| '#rrggbb' \| 'false'` | — | Enables `xr-live-spatial-paint`; pinching in empty space extrudes 3D Catmull-Rom tube strokes. |
| `<xr-live>` | `spatial-measure` | `'' \| 'bounds' \| 'tape' \| 'all' \| 'none'` | — | Enables `xr-live-spatial-measure` 3D bounding-box dimension callouts and AR point-to-point tape measure. |
| `<xr-live>` | `measure-unit` | `'auto' \| 'm' \| 'cm' \| 'mm' \| 'in' \| 'ft-in'` | `'auto'` | Default measurement display unit for `spatial-measure`. |
| `<xr-live>` | `magnetic-snap` | `'' \| 'grid' \| 'surface' \| 'sockets' \| 'all' \| 'none'` | — | Enables `xr-live-magnetic-snap` socket, Cartesian grid, surface, and yaw-angle snapping. |
| `<xr-live>` | `snap-grid` | `number` or `'gx gy gz'` (meters) | — | Default Cartesian snap grid spacing in meters (for example, `'0.05'` or `'0.05 0.05 0.05'`). |
| `<xr-live>` | `snap-angle` | `number` (`0..180` degrees) | `0` | Default yaw rotation snap increment in degrees. |
| `<xr-live>` | `gaze-dwell` | `'' \| 'auto' \| 'false' \| 'none'` | — | Enables `xr-live-gaze-dwell` hands-free eye and head gaze reticle and radial dwell selection. |
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
| `<xr-live>` | `shared-room-voice` | `boolean` | `false` | Opts in to voice **signaling** in `shared-room`: relays WebRTC offer/answer/ICE messages (`peerrtcsignal` event, `broadcastRtcSignal()`) and computes per-peer `voiceGain` (`computeSpatialVoiceGain`). Your app owns `getUserMedia`, `RTCPeerConnection`, and audio playback. |
| `<xr-live>` | `peer-name` | `string` (max `32` chars) | — | Local peer display name broadcast to room participants. |
| `<xr-live>` | `peer-color` | `'#rrggbb'` | `'#38bdf8'` | Local peer 3D visor and laser ray tint color in `shared-room`. |
| `<xr-live>` | `bloom` | `boolean \| string` | — | Enables HDR emissive bloom (`bloom`, `bloom="1.4"`, or `bloom="strength:1.2 threshold:0.75 radius:0.5"`). |
| `<xr-live>` | `outline` | `boolean \| string` | — | Enables silhouette outlines on `selected-mesh` or nodes with `userData.xr.outline` (`outline="#38bdf8 0.03"`). |
| `<xr-live>` | `variant-name` | `string` | — | Active `KHR_materials_variants` product material variant name. |
| `<xr-live>` | `webmcp` | `boolean` | `false` | Registers spatial AI tools (`inspect_xr_scene`, `place_xr_object_at_gaze`, `capture_xr_view`) on `navigator.modelContext`. |
| `<xr-live>` | `webmcp-allow-depth` | `boolean` | `false` | Opt-in gate required before `capture_xr_view` exposes the 8×8 metric `depthGridMeters` array. |
| `<xr-live>` | `webmcp-omit-pose` | `boolean` | `false` | Omits `headPosition` from `inspect_xr_scene` responses. |
| `<xr-anchor>` | `surface` | `'floor' \| 'wall' \| 'table' \| 'ceiling'` | `'floor'` | Target semantic surface for declarative child placement. |
| `<xr-anchor>` | `magnetic` | `boolean` | `false` | Continuously snaps the child anchor to the nearest matching surface plane. |
<!-- mdformat on -->

--------------------------------------------------------------------------------

## Canonical `userData.xr` spatial traits

Defined in
[`three-live/src/xr-trait-schema.ts`](../three-live/src/xr-trait-schema.ts),
`mesh.userData.xr` traits are normalized, clamped to identical ranges, and
exported into `.glb` (`nodes[i].extras.xr` and
`nodes[i].extensions.ANDROID_xr_scenecore`) and `.usdz`
(`customData = {dictionary xr = {...}}`) so scenes behave identically on Web,
Android, and iOS or visionOS. The following table describes each trait key:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Trait key | Type and options | Description |
| :----------------------- | :----------------- | :--------------------------- |
| **`grab`** | `'1-hand' \| '2-hand' \| true` | 6DoF single-hand grab and rotate (`'1-hand'`) or two-hand grab, pinch-scale, and twist (`'2-hand'`). Legacy `grabbable: true` is also accepted. |
| **`scale`** | `{ min?: number, max?: number } \| true` | Two-handed pinch scaling clamped to `[min, max]` (defaults to `{ min: 0.05, max: 5 }`). |
| **`billboard`** | `'capsule' \| 'cylindrical' \| 'spherical' \| true` | Orients the node toward the viewer (`'capsule'` and `'cylindrical'` rotate around the Y axis; `'spherical'` faces the camera in 3D). |
| **`follow`** | `'head' \| 'hand-left' \| 'hand-right'` **or** `{ mode, lazy, distance, deadzoneDeg, stiffness, height, faceUser, snapOnStart }` | String values apply an eager spring follow; object values activate lazy head or hand follow with an angular deadzone (`deadzoneDeg`, default `15°`) and a critically damped spring (`stiffness`, default `6`). |
| **`anchor`** | `'floor' \| 'wall' \| 'ceiling' \| 'table' \| 'horizontal' \| 'vertical'` **or** `{ target?, id?, persist? }` | Pins the node to a detected real-world plane or simulator surface; setting `persist: true` (or `id`) persists user-moved transforms across reloads and `#xr-state` links. |
| **`physics`** / **`rigidBody`** | `'dynamic' \| 'static' \| 'kinematic'` **or** `{ body?, shape?: 'auto' \| 'box' \| 'sphere' \| 'cylinder', mass?, restitution?, friction?, linearDamping?, angularDamping?, gravityScale?, velocity?, angularVelocity?, lockRotation? }` | Steps 60 Hz deterministic Sequential Impulse rigid-body physics (gravity, restitution bounce, friction, stacking, sleeping, character push, projectile knockback, and depth heightfield collisions) and exports USDZ `PhysicsRigidBodyAPI` / `PhysicsMassAPI`. |
| **`orbit`** | `{ target: [x,y,z] \| string, radius?: number, speed?: number, height?: number, phase?: number, faceCenter?: boolean }` | Orbits around a 3D world point or another mesh's `name` at `speed` rad/s. |
| **`handles`** | `{ rotateAxis?: 'y' \| 'none', minScale?: number, maxScale?: number } \| true` | Adds four top-corner uniform scale handles and a bottom pedestal yaw-rotation bar; emits `xr-handles-change`. |
| **`dimensions`** | `{ enabled?: boolean, unit?: 'auto' \| 'm' \| 'cm' \| 'mm' \| 'in' \| 'ft-in', axes?: Array<'x' \| 'y' \| 'z'>, color?: string, showOnSelect?: boolean } \| true` | Renders live `W × H × D` bounding-box dimension guide bars and camera-facing vector-glyph metric or imperial labels (`spatial-measure`). |
| **`snapTo`** | `{ grid?: number \| [x,y,z], angleDeg?: number, surface?: 'none' \| 'floor' \| 'wall' \| 'ceiling' \| 'any', socketTag?: string, radius?: number } \| true` | Snaps grabbed meshes to matching `snapSocket` anchors (with `1.25×` breakaway hysteresis), Cartesian grids, surfaces, and yaw increments (`magnetic-snap`). |
| **`snapSocket`** | `string` **or** `{ tag: string, radius?: number, alignRotation?: boolean, highlightColor?: string }` | Marks a node as a magnetic snap target socket with a pulsing proximity highlight ring (`magnetic-snap`). |
| **`gaze`** | `{ enabled?: boolean, dwellMs?: number, repeat?: boolean, action?: 'select' \| 'ask' } \| true` | Opts a mesh into hands-free eye and head gaze dwell (`dwellMs` in `[250, 10000]`, default `1200`), firing `meshclick` and `KHR_interactivity` (`'select'`) or Gemini Live (`'ask'`). |
| **`explode`** | `{ enabled?: boolean, direction?: [x,y,z], distance?: number, layer?: number, leaderLine?: boolean } \| boolean` | Configures per-part explosion vector, distance (`0..10m`), staggered `layer` (`1..10`), and dashed leader lines (`exploded-view`); `false` pins a base part in place. |
| **`navigable`** | `boolean \| 'walkable' \| 'blocked'` | Marks floor and platform meshes as valid (`'walkable'`) or forbidden (`'blocked'`) landing targets for parabolic XR teleportation (`spatial-locomotion`). |
| **`sync`** | `boolean` | Controls whether user manipulations on a node synchronize across peers in `shared-room` (defaults to `true` on grabbable nodes; set `false` to keep local-only). |
| **`particles`** | `{ preset: 'rain' \| 'snow' \| 'sparks' \| 'confetti', count?: number, area?: number \| [x,y,z], speed?: number }` | Turns the node into a particle emitter volume (`count` up to `2,000`) that collides with the floor and WebXR depth surfaces. |
| **`holdToAsk`** | `{ prompt?: string, holdMs?: number } \| true` | Press-and-hold on the mesh starts speech recognition and sends a contextual prompt to Gemini Live; emits `xr-hold-to-ask`. |
| **`worldUnderstanding`** | `{ planes?: boolean, meshes?: boolean, reticle?: boolean, objects?: boolean }` | Opts the scene into WebXR plane and mesh detection and the gaze surface reticle (`__xr_reticle__`). |
| **`splatUrl`** | `string` (`https://` or relative `.splat` or `.spz` URL) | Loads and back-to-front depth-sorts 3D Gaussian Splats (`.splat` or Niantic `.spz` v2 and v3 with anisotropic 3D covariance and SH degree 1–3, up to `1,000,000` splats). |
| **`splat`** | `string` **or** `{ url: string, shDegree?: 0 \| 1 \| 2 \| 3, maxSplats?: number }` | Structured 3D Gaussian Splat trait controlling Spherical Harmonics evaluation degree (`0..3`) and splat cap. |
| **`bloom`** | `{ strength?: number, threshold?: number, radius?: number } \| boolean \| number` | Enables HDR emissive bloom on the scene/node (`strength` in `[0, 5]`, `threshold` in `[0, 2]`, `radius` in `[0, 1]`). |
| **`outline`** | `{ color?: string, thickness?: number } \| boolean \| string` | Renders an inverted-hull / screen-space silhouette outline (`thickness` in `[0.002, 0.25]`) around the node. |
| **`ik`** | `{ root: string, mid?: string, effector: string, target: string \| [x, y, z], pole?: string \| [x, y, z], solver?: 'two-bone' \| 'fabrik', iterations?: number, tolerance?: number, weight?: number }` | Solves analytical 2-bone (`root` → `mid` → `effector`) or FABRIK inverse kinematics toward `target` (and optional `pole`, alias `poleTarget`) every frame. |
| **`text`** | `{ text: string, size?: number, depth?: number, bevelEnabled?: boolean, bevelThickness?: number, bevelSize?: number }` | Extruded 3D vector text metadata exported to glTF `extras.xr.text` and USDZ `customData.xr`. |
| **`audioEmitter`** / **`audio`** | `string` **or** `{ preset?: 'hum' \| 'reactor' \| 'wind' \| 'beacon' \| 'geiger' \| 'chimeLoop' \| 'machinery' \| 'water' \| string, src?: string, volume?: number, loop?: boolean, autoplay?: boolean, playOnSelect?: boolean, distanceModel?: 'inverse' \| 'linear' \| 'exponential', refDistance?: number, maxDistance?: number, rolloffFactor?: number, coneInnerAngle?: number, coneOuterAngle?: number, coneOuterGain?: number, pitchHz?: number }` | Attaches a 3D positional and directional spatial audio emitter (`spatial-audio`), supporting 8 zero-asset ambient loop presets, 13 one-shot cues, or `safeMediaUrl` streams, plus `KHR_audio_emitter` and USDZ `SpatialAudio` export. |
| **`pointerEvents`** | `'none'` | Excludes the mesh from raycast picking so rays pass through it. |
<!-- mdformat on -->

--------------------------------------------------------------------------------

## Spatial plugin suite

All 15 spatial plugins are included in `xr-live-full.min.js` and
`xr-live-spatial.min.js`, or can be imported individually from
`xr-live/src/plugins/<name>` and registered via
`XRLiveElement.registerPlugin(plugin)`. Every plugin has a corresponding native
implementation in Android (`mobile/android/src/main/java/com/google/threelive/`)
and iOS or visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`):

*   **`head-follow` (`xr-live-head-follow`):** Implements `FollowHead` lazy HUD
    behavior (angular deadzone plus critically damped spring
    `stepCriticallyDampedSpring`) and `Orbit` satellite motion
    (`userData.xr.orbit`).
*   **`manipulation-handles` (`xr-live-manipulation-handles`):** Attaches four
    top-corner uniform-scale handles and a bottom pedestal yaw-rotation bar to
    any mesh with `userData.xr.handles`. Dispatches `xr-handles-change`
    (`{ mesh, scale, yawDeg }`).
*   **`world-understanding` (`xr-live-world-understanding`):** Tracks WebXR
    `detectedPlanes` (`MAX_TRACKED_PLANES = 64`) and `detectedMeshes`, updates a
    surface-normal gaze reticle (`__xr_reticle__`), provides `XRTapeMeasure`,
    and unprojects 2D bounding boxes (`[ymin, xmin, ymax, xmax]`) into 3D world
    space via `detectObjects(element, detections)`, dispatching
    `xr-object-detected`.
*   **`gemini-live` (`xr-live-gemini-live`):** Streams viewport frames and 16
    kHz PCM microphone audio to a Gemini Live `wss://` endpoint
    (`connectGeminiLive(element, options)`), plays 24 kHz PCM model audio with
    barge-in cancellation (`xr-gemini-interrupted`), emits live
    `xr-transcription` (`{ speaker, text, isFinal }`), answers `report_objects`
    tool calls with 3D unprojection, and wires `userData.xr.holdToAsk`
    press-and-hold queries (`xr-hold-to-ask-listening`, `xr-hold-to-ask`).
*   **`spatial-paint` (`xr-live-spatial-paint`):** Enabled via the
    `spatial-paint` attribute (for example, `spatial-paint="#ff3366"`). Pinching
    in empty space smooths input points with a uniform Catmull-Rom spline and
    extrudes twist-free parallel-transport tubes (`TubeStrokeBuilder`), emitting
    `xr-paint-stroke` (`{ index, points, lengthMeters }`). Supports programmatic
    `undo()` and `clear()` via `getSpatialPaintController(element)`.
*   **`depth-particles` (`xr-live-depth-particles`):** Simulates `rain`, `snow`,
    `sparks`, and `confetti` emitters (`userData.xr.particles`, up to
    `MAX_EMITTERS = 8` and `2,000` particles per emitter) with a deterministic
    PRNG and real-world WebXR depth collision (`isOccludedByDepth`).
    Browser depth particles use shared static cross-quads when the viewer supports
    instance offsets. Position uploads are 12 bytes per particle update instead of
    96. Older viewers retain the expanded geometry fallback. Existing mesh-instance
    matrices and colors keep their current rendering path.

*   **`splat-loader` (`xr-live-splat-loader`):** Streams `.splat` (32-byte
    records) and Niantic `.spz` (v2 and v3, raw or gzipped) 3D Gaussian Splat
    files for any node with `userData.xr.splatUrl` or `userData.xr.splat`,
    reconstructing full 3D covariance matrices (`computeSplatCovariance3D`),
    projecting EWA 2D elliptical splat axes (`projectSplatCovariance2D`),
    evaluating view-dependent Spherical Harmonics degrees 1–3
    (`evaluateSplatSH`), and sorting splats back-to-front with a 16-bit counting
    sort with cached unchanged depth orders. Moving views refresh every fourth
    draw cycle; parallel stereo eyes with identical depth rows share one GPU
    order, while divergent eyes retain independent orders (at most two).
    Spherical-harmonic color refresh remains independent of index uploads.
*   **`spatial-measure` (`xr-live-spatial-measure`):** Renders live `W × H × D`
    bounding-box dimension callout bars and procedural 3D vector-glyph labels
    (`userData.xr.dimensions` or `spatial-measure="bounds"`), plus an
    interactive point-to-point AR and 3D tape measure (`spatial-measure="tape"`
    or `"all"`, up to `MAX_TAPE_SEGMENTS = 16`) that emits `measurecomplete` and
    clears via double-pinch or `element.clearMeasurements()`.
*   **`magnetic-snap` (`xr-live-magnetic-snap`):** Provides declarative socket
    snapping (`userData.xr.snapSocket` and `userData.xr.snapTo.socketTag`) with
    `1.25×` breakaway hysteresis and a pulsing preview ring (`1.5×` radius),
    plus Cartesian grid (`snap-grid`), rotational yaw (`snap-angle`), and
    real-world or simulator surface (`floor`, `wall`, `ceiling`, or `any`)
    quantization. Dispatches `xrsnap` and `xrunsnap`.
*   **`gaze-dwell` (`xr-live-gaze-dwell`):** Hands-free eye and head gaze
    raycasting for Apple Vision Pro, Android XR, and accessibility (`gaze-dwell`
    or `userData.xr.gaze`). Applies EMA ray smoothing (`alpha = 0.25`), a `1.5°`
    micro-saccade grace cone, a `150ms` grace delay, and a constant-angular-size
    surface-normal progress ring, dispatching `gazeenter`, `gazeleave`, and
    `gazedwell` (routing `'select'` to `meshclick` and `KHR_interactivity`, or
    `'ask'` to `gemini-live`).
*   **`exploded-view` (`xr-live-exploded-view`):** Explodes multi-part CAD and
    engineering assemblies (`explode="0..1"`, `explode-mode`,
    `userData.xr.explode`) with staggered per-layer timing (`layer: 1..10`),
    spring-smoothed interpolation, dashed leader lines, two-hand XR spread
    gestures, and a real-time GPU fragment cross-section clipping slicer
    (`section-plane="x:0"` or `"interactive"`). Dispatches `explodechange`.
*   **`persistent-anchors` (`xr-live-persistent-anchors`):** Restores and
    auto-saves user-manipulated transforms (`persistent-anchors` or
    `userData.xr.anchor.persist`) across a three-tier pipeline:
    `#xr-state=<base64url>` shareable URL hashes (`persist-url-hash`, capped at
    `MAX_HASH_BYTES = 8192`), namespaced `localStorage`
    (`MAX_PERSISTED_NODES = 128`), and WebXR `XRAnchor` persistent handles.
    Dispatches `anchorsrestored`.
*   **`spatial-locomotion` (`xr-live-spatial-locomotion`):** Comfortable
    room-scale and architectural XR navigation
    (`locomotion="teleport snap-turn"` or `userData.xr.navigable`) with a
    ballistic parabolic teleport arc and cyan or red landing ring,
    hysteresis-guarded thumbstick snap-turns (`snap-turn-deg`, default `30°`),
    optional smooth glide, and a `120ms` peripheral FOV comfort vignette
    (`comfort-vignette`). Dispatches `xrteleport`.
*   **`shared-room` (`xr-live-shared-room`):** Zero-dependency multi-user
    co-presence (`shared-room="<room-id>"` via same-origin
    `BroadcastChannel("xr-live:room:<id>")` or cross-device `wss://` relay,
    `MAX_PEERS = 16`, `MAX_PAYLOAD_BYTES = 16384`). Broadcasts `20 Hz` quantized
    head poses and tinted 3D peer visor pills and laser rays, enforces `2000ms`
    optimistic soft-lock ownership leases on grabbed nodes (local grabs on a
    node another peer holds are refused; near-simultaneous grabs resolve to the
    lowest `peerId` on every peer), synchronizes `exploded-view` factors and
    `spatial-paint` 3D tube strokes (`MAX_REMOTE_STROKES = 64`), and supports
    opt-in WebRTC voice **signaling** (`shared-room-voice`: relays
    offer/answer/ICE via `broadcastRtcSignal()` / `peerrtcsignal` and computes
    per-peer `voiceGain` + stereo pan with `computeSpatialVoiceGain`; your app
    creates the `RTCPeerConnection`s and plays the audio, and signaling is
    visible to every room member). Dispatches `peerjoin`, `peerleave`,
    `peersync`, and `peergrabconflict`.
*   **`spatial-audio` (`xr-live-spatial-audio`):** 3D positional and directional
    spatial audio emitters (`userData.xr.audioEmitter`, `userData.xr.audio`, or
    `KHR_audio_emitter`). Synthesizes 8 zero-asset phase-locked ambient loop
    presets (`hum`, `reactor`, `wind`, `beacon`, `geiger`, `chimeLoop`,
    `machinery`, `water`) and 13 one-shot procedural cues
    (`renderAmbientLoopPcm`), or streams validated `safeMediaUrl` audio.
    Evaluates `inverse`, `linear`, and `exponential` distance falloff,
    directional cone attenuation (`coneInnerAngle`, `coneOuterAngle`,
    `coneOuterGain`), and stereo panning (`computeSpatialAudioMix`), and exports
    `KHR_audio_emitter` in `.glb` and `def SpatialAudio "AudioEmitter"` in
    `.usdz`. Dispatches `xraudioplay`.

--------------------------------------------------------------------------------

## Simulation plugins (`xr-live-sim`)

The optional `xr-live-sim` bundle adds six plugins for interactive simulations:
games, training drills, safety walkthroughs, and robot-cell or factory-floor
rehearsals. Each plugin reads `userData.xr` traits from your scene and
`<xr-live>` attributes from the host element, so a scene needs no per-frame
code.

Load the bundle after the core, or use `xr-live-full.min.js`, which includes it:

```html
<script src="/dist/xr-live.min.js"></script>
<script src="/dist/xr-live-sim.min.js"></script> <!-- < 26 KB gz, global XRSim -->
```

With a bundler, import `xr-live/sim`. Importing the module registers all six
plugins.

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Plugin | What it does |
| :--------------------- | :-------------------------------------------------- |
| `character-controller` | Moves the first `character` node with WASD or arrow keys, a gamepad, or a touch joystick. Jump with Space, sprint with Shift. Slides along `collidable` nodes, follows with the camera, and switches `idle`, `walk`, `run`, and `jump` clips. |
| `steering-agents` | Moves `agent` nodes with `patrol`, `chase`, `flee`, `follow`, or `wander` steering, with separation and wall push-out. |
| `rigid-body` | Steps `rigidBody` / `physics` nodes (`dynamic`, `static`, `kinematic`) at 60 Hz with a deterministic Sequential Impulse solver (box, sphere, and cylinder colliders, restitution, friction, stacking, sleeping, character push, and projectile knockback). |
| `hit-zones` | Tracks `integrity`, fires projectiles or hitscan rays, applies contact amounts, emits zone enter and exit events, and runs `spawner` nodes. |
| `objectives` | Tracks pickups, checkpoints, keys, time bonuses, and restores, plus score, attempts, a countdown, and the pass, fail, or timeout outcome. |
| `synth-audio` | Plays procedural cues (no audio files) mapped per node by the `audioCues` trait. |
<!-- mdformat on -->

### Simulation traits

Add these keys to `userData.xr` on any mesh or group:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Trait | Shape |
| :---------- | :------------------------------------------------- |
| `character` | `true`, a camera mode, or `{ speed, runMultiplier, jumpVelocity, gravity, radius, height, cameraMode, cameraDistance, cameraHeight, clips: { idle, walk, run, jump } }`. Camera modes: `third-person`, `first-person`, `top-down`, `fixed`. |
| `agent` | A mode string or `{ mode, target, speed, turnSpeed, sightRadius, stopDistance, separationRadius, waypoints, loopWaypoints }`. `target` is a node name or `'user'` (the character, else the viewer). |
| `rigidBody` / `physics` | `'dynamic' \| 'static' \| 'kinematic' \| true` or `{ body, shape: 'auto' \| 'box' \| 'sphere' \| 'cylinder', mass, restitution, friction, linearDamping, angularDamping, gravityScale, velocity, angularVelocity, lockRotation }`. |
| `integrity` | A max number or `{ max, current, group, showBar, cooldownMs, hideOnDepleted, scoreValue, contactAmount }`. Hits skip nodes in the shooter's own `group`. |
| `zone` | `'box'`, `'sphere'`, or `{ shape, size, radius, watchGroups, color }`. |
| `spawner` | A template node name or `{ template, intervalSec, maxActive, totalCount, spawnRadius }`. The template node is hidden. |
| `objective` | A type or `{ type, amount, tag, radius, required, order, spinSpeed, bobAmplitude, respawnSec }`. Types: `pickup`, `checkpoint`, `key`, `time-bonus`, `restore`. `order > 0` enforces ascending order. |
| `audioCues` | `{ onTap, onObjective, onHit, onDepleted, onZoneEnter, onZoneExit, onSpawn, onJump, onLand, pitchJitter, volume, spatial }`. Cue names: `confirm`, `error`, `alarm`, `warning`, `pickup`, `jump`, `beam`, `impact`, `burst`, `powerup`, `step`, `pass`, `fail`. |
| `collidable` | `true` makes the node a wall or floor for characters and agents. |
<!-- mdformat on -->

`audioCues` is separate from the file-based `audio` trait. Characters and agents
face local +Z.

### Simulation attributes

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Attribute | Values | Default |
| :--------------------- | :----------------------- | :----------------------- |
| `character-controller` | `third-person`, `first-person`, `top-down`, `fixed-camera`, `none` | trait value |
| `character-speed` | meters per second | trait value |
| `character-jump` | jump velocity in meters per second | trait value |
| `touch-joystick` | `auto` (touch screens), `always`, `none` | `auto` |
| `steering-agents` | `false` or `none` pauses agents | on |
| `hit-zones` | `projectile` (or empty), `hitscan`, `contact` | off |
| `fire-rate` | shots per second | `4` |
| `projectile-speed` | meters per second | `14` |
| `projectile-gravity` | meters per second squared | `0` |
| `hit-amount` | integrity removed per hit | `25` |
| `objectives` | present enables; `none` disables | on with objective traits |
| `scenario-timer` | countdown in seconds | none |
| `target-score` | score that passes the scenario | none |
| `attempts` | lives before `fail` | unlimited |
| `sim-hud` | `auto`, `minimal`, `none` | `auto` with `objectives` |
| `synth-audio` | present enables; `muted` disables | off |
| `synth-volume` | `0` to `1` | `0.7` |
<!-- mdformat on -->

To restart a scenario, call `XRSim.resetSimScenario(element)` (or import
`resetSimScenario` from `xr-live/sim`). The Aether view restarts when its
`scenarioResetKey` prop changes.

### Simulation events

All events bubble from the host element:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Event | `detail` |
| :----------------- | :----------------------------------------------------- |
| `xrcollision` | `{ nodeId, otherId, normal, impactSpeed }` |
| `xrsleep` | `{ nodeId }` |
| `characterjump` | `{ nodeId, position }` |
| `characterland` | `{ nodeId, fallSpeed }` |
| `agentstatechange` | `{ nodeId, state, targetId }` |
| `agentreach` | `{ agentId, targetId, position }` |
| `xrhit` | `{ targetId, sourceId, amount, remaining, point }` |
| `xrdepleted` | `{ targetId, group, scoreValue }` |
| `xrzoneenter` | `{ zoneId, nodeId, group }` |
| `xrzoneexit` | `{ zoneId, nodeId, group }` |
| `xrspawn` | `{ spawnerId, instanceId, index }` |
| `xrobjective` | `{ nodeId, tag, type, amount, totalScore, remainingRequired, outOfOrder }` |
| `xrscorechange` | `{ score, delta, attemptsLeft, timeRemaining }` |
| `xrscenarioend` | `{ outcome: 'pass' \| 'fail' \| 'timeout', finalScore, elapsedSec }` |
<!-- mdformat on -->

### Example: a timed training drill

```js
const scene = new THREE.Scene();
['Valve', 'Filter', 'Cap'].forEach((name, i) => {
  const part = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
  );
  part.name = name;
  part.position.set(i * 0.4 - 0.4, 1, 0);
  part.userData.xr = {
    objective: { type: 'checkpoint', order: i + 1, required: true },
    audioCues: { onObjective: 'confirm' }
  };
  scene.add(part);
});
return scene;
```

```html
<xr-live objectives scenario-timer="45" synth-audio>
  <script type="text/three">/* the scene above */</script>
</xr-live>
```

Taps complete steps in order; an out-of-order tap plays `error`. Completing all
required steps ends the scenario with `pass`, and the timer ends it with
`timeout`.

### Native runtimes

The Android (`XRSimWorld.kt`) and iOS or visionOS (`XRSimWorld.swift`) runtimes
step the same systems at a fixed 60 Hz and match the web runtime on two shared
golden scenes in `testdata/golden/`: `sim_scene.json` (movement, agents,
contacts, zones, and scoring) and `sim_visuals_scene.json` (projectiles, bursts,
spawns, integrity bars, hit flashes, zone outlines, and the follow camera).

The shared core also decides what to draw, so every platform shows the same
feedback:

*   `CharacterController.cameraRig` gives the follow-camera target, polar angle,
    and distance (`null` for `fixed-camera` and during XR sessions).
*   `HitZones.visuals` lists hit flashes, integrity bars, projectiles, burst
    fragments, and colored zone outlines.

On Android, `XRSimRenderBridge` draws both through the renderer; the Filament
renderer shows spawned instances as gltfio instances that share the template's
GPU buffers and textures. On iOS and visionOS, `XRSimRealityKitBridge` draws
them with RealityKit and clones the template entity for spawned instances. The
Aether `ThreeLive` view wires these up, together with an on-screen joystick,
jump and fire buttons, and the score HUD.

--------------------------------------------------------------------------------

## Spatial DOM cards (`<div slot="spatial">`)

Any child element with `slot="spatial"` is projected into 3D space as an
interactive textured quad inside WebXR and inline 3D views:

*   **Sanitized SVG `<foreignObject>` rasterization:** Renders live HTML and CSS
    into a crisp GPU texture with automatic XSS hardening (strips dangerous tags
    and handlers, blocks `javascript:` and `data:text/html` URIs, and escapes
    XML entities).
*   **3D raycast hit-testing:** Controller rays, hand pinch rays, and pointer
    clicks compute UV intersection coordinates and dispatch synthetic `click`,
    `pointerdown`, `pointermove`, and `pointerup` events to the underlying DOM
    elements (for example, `<button>`).
*   **Trait support:** Add `data-xr-traits="grab billboard"` and
    `data-position="x y z"` directly on `<div slot="spatial">`.

--------------------------------------------------------------------------------

## Imperative methods and DOM events

### Imperative methods

*   `await element.enterSpatialAR(sourceOverride?, forceFallback?)`: Launches
    WebXR `immersive-ar`, iOS `AR Quick Look` (`.usdz`), or Android
    `Scene Viewer` (`intent://`).
*   `element.transitionToVR({ color?: [r, g, b], durationMs?: number })`:
    Smoothly fades the viewport background from transparent AR passthrough to an
    opaque VR environment.
*   `element.transitionToAR({ durationMs?: number })`: Smoothly fades the
    viewport background back to transparent AR passthrough.
*   `await element.captureViewFrame({ format?, quality?, includeDepth? })`:
    Captures the rendered viewport (`dataUrl`, `base64`), camera `viewMatrix`
    and `projectionMatrix`, `headPosition`, and optional 8×8 `depthGridMeters`.
*   `element.stepSpatialFrame(dtSeconds)`: Steps all spatial subsystems
    (automatically called during WebXR and simulator frames).
*   `element.clearMeasurements()`: Clears all active and locked 3D tape-measure
    segments (`spatial-measure`).
*   `element.setExplode(factor)`: Smoothly animates the assembly explosion
    factor (`0..1`) and emits `explodechange` (`exploded-view`).
*   `element.savePersistedAnchors()` and `element.clearPersistedAnchors()`:
    Saves or clears persisted anchor poses across `localStorage`, `#xr-state`,
    and WebXR handles (`persistent-anchors`).
*   `element.exportAnchorState()` and `element.importAnchorState(token)`:
    Exports or imports a compact base64url layout state token
    (`persistent-anchors`).
*   `element.teleportTo([x, y, z])`: Teleports the viewer rig to `[x, y, z]` and
    emits `xrteleport` (`spatial-locomotion`).
*   `element.getSharedPeers()`: Returns the list of active remote peers
    (`RemotePeerState[]`) in `shared-room`.

### Spatial DOM events

The `<xr-live>` element dispatches the custom events listed in the following
table:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Event | `event.detail` payload | Description |
| :------------------------- | :--------------- | :------------------------------------ |
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
| `gazeenter`, `gazeleave` | `{ node, point }` or `{ node }` | Fired when the smoothed `gaze-dwell` ray enters or leaves a gazeable mesh. |
| `gazedwell` | `{ node, point: [x,y,z], action: 'select' \| 'ask' }` | Fired when radial gaze dwell reaches `100%`. |
| `explodechange` | `{ factor: number, source: 'attribute' \| 'gesture' \| 'api' \| 'peer' }` | Fired when `exploded-view` updates the assembly explosion factor. |
| `anchorsrestored` | `{ count: number, source: 'xr-anchor' \| 'storage' \| 'url-hash' }` | Fired when `persistent-anchors` restores saved node poses. |
| `xrteleport` | `{ from: [x,y,z], to: [x,y,z], yawDeg: number }` | Fired when `spatial-locomotion` teleports the viewer rig. |
| `peerjoin`, `peerleave` | `{ peerId: string, name: string, color: string }` | Fired when a remote participant joins, disconnects, or times out of `shared-room`. |
| `peergrabconflict` | `{ peerId: string, nodeId: string }` | Fired when a remote participant wins a near-simultaneous grab of the same node and the local hold is released. |
| `peersync` | `{ peerId: string, nodeId: string }` | Fired when `shared-room` applies a remote node transform, explode factor (`__explode__`), or paint stroke (`paint:<id>`). |
| `xraudioplay` | `{ node: string, meshIndex: number, preset: string \| null, src: string \| null, gain: number, pan: number, triggerCount: number }` | Fired when a `spatial-audio` emitter is triggered by `playOnSelect` tap/pinch or `playNode()`. |
| `xr-webmcp-capture` | `{}` | Fired when a WebMCP agent invokes `capture_xr_view` (sets `data-xr-webmcp-indicator="active"`). |
<!-- mdformat on -->

--------------------------------------------------------------------------------

## Native mobile spatial bridges (no WebViews required)

`xr-live` compiles scenes into self-contained `.glb` and `.usdz` binaries with
embedded spatial trait metadata (`extras.xr`, `ANDROID_xr_scenecore`, and USDZ
`customData.xr`), allowing native Android and iOS or visionOS apps to run full
6DoF spatial experiences natively:

### Android (`mobile/android/src/main/java/com/google/threelive/`)

*   **[`XRLiveRuntimeSession.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveRuntimeSession.kt),
    [`XRSpatialFeatures.kt`](../mobile/android/src/main/java/com/google/threelive/XRSpatialFeatures.kt),
    and modular feature controllers (`SpatialMeasure.kt`, `MagneticSnap.kt`,
    `GazeDwell.kt`, `ExplodedView.kt`, `PersistentAnchors.kt`,
    `SpatialLocomotion.kt`, `SharedRoom.kt`, `SpatialAudio.kt`):** Executes lazy
    head-follow springs, orbits, manipulation handles, Catmull-Rom spatial paint
    tubes, depth-colliding particles, Gaussian splat sorting, 3D dimension
    callouts and tape measure, magnetic socket and grid snapping, gaze dwell,
    exploded-view assemblies and section clipping, persistent anchors, parabolic
    locomotion, multi-user room sync, and `KHR_interactivity` behavior graphs
    natively on Google Filament. In a shared room, start host grabs with
    `XRSpatialFeatures.requestGrab(node)` (or check the return value of
    `XRLiveRuntimeSession.setNodeGrabbed(node, true)`) and cancel the gesture
    when it returns `false`: another peer holds the node. Near-simultaneous
    grabs resolve like the web (lowest peer ID wins) and report
    `Listener.onPeerGrabConflict`.
*   **[`XRLiveSceneCoreHelper.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveSceneCoreHelper.kt):**
    Jetpack XR SceneCore integration for Android XR headsets and phones,
    attaching `MovableComponent`, `ResizableComponent`, `Anchor`, and billboard
    updates directly from compiled `.glb` bytes.
*   **[`XRGeminiLiveController.kt`](../mobile/android/src/main/java/com/google/threelive/gemini/XRGeminiLiveController.kt):**
    Native Kotlin WebSocket and PCM audio streaming client for Gemini Live.

### iOS and visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`)

*   **[`XRLiveRealityKitSession.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKitSession.swift),
    [`XRLiveRealityKit.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKit.swift),
    [`XRSpatialRealityKitFeatures.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRSpatialRealityKitFeatures.swift),
    and modular feature controllers (`SpatialMeasure.swift`,
    `MagneticSnap.swift`, `GazeDwell.swift`, `ExplodedView.swift`,
    `PersistentAnchors.swift`, `SpatialLocomotion.swift`, `SharedRoom.swift`,
    `SpatialAudio.swift`):** Native Swift and RealityKit runtime supporting all
    15 spatial plugin behaviors, `userData.xr` traits, manipulation handles,
    spatial paint tubes, particle emitters, Gaussian splats,
    `KHR_interactivity`, and `XRGeminiLiveController.swift`. In a shared room,
    start host grabs with `XRSpatialRealityKitFeatures.requestGrab(_:)` and
    cancel the gesture when it returns `false` (another peer holds the node);
    near-simultaneous grabs resolve like the web and call `onPeerGrabConflict`.

### Gemini Live session ownership

Disconnect, remote closure and replacement revoke old capture, timer, transport,
transcription, audio and recognition callbacks. Teardown detaches old state before
external callbacks run. Reentrant replacement keeps the newer session and closes
superseded transports. Synchronous setup failures clean up the failed session.
Ordinary text turns retain the existing text-only wire format.


### Session-bound view questions

`XRGeminiLiveController.sendText(text)` waits for an in-flight local canvas
capture. The resulting conversation turn includes the captured image and text
together. To request a fresh view even when no capture is pending, use
`sendText(text, {captureFrame: true})`; hold-to-ask uses that path. Capture failure
or a replaced session discards the dependent question. No fixed delay is used.
The [Live API content contract](https://ai.google.dev/api/live#BidiGenerateContentClientContent)
binds both parts in the conversation; realtime stream ordering alone is insufficient.
This client contract does not certify the model's answer or live service acceptance.

Explicit disconnect and remote closure clear capture, camera, transcription,
audio and active hold state before teardown callbacks run. Hold timers and
recognition results carry the originating session lease. Gesture cancellation
aborts recognition; normal release can finish speech within the same lease.
