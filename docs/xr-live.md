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

It brings declarative spatial traits (`userData.xr`), 14 optional **spatial
plugins** for advanced features (`head-follow`, `manipulation-handles`,
`world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`,
`splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`,
`exploded-view`, `persistent-anchors`, `spatial-locomotion`, and `shared-room`),
interactive HTML and CSS spatial cards (`<div slot="spatial">`), real-world
depth occlusion and heightfield physics, 25-joint hand gesture recognition, a
desktop 6DoF simulator, WebMCP browser AI tools, and zero-webview native mobile
AR and XR runtimes.

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

*   **On the web (`<xr-live>`):** Starts with small core bundles (`< 46 KB gz`
    for `xr-live-viewer.min.js`, or `< 66 KB gz` for `xr-live.min.js` with live
    Three.js authoring) and optional plugins for advanced features (`~2–5 KB gz`
    each, or `< 52 KB gz` for all 14 combined).
*   **In native Android, iOS, and visionOS apps (`XRLiveRuntimeSession` and
    `XRLiveRealityKitSession`):** The in-process Rust compiler
    (`ThreeLiveCompiler`) compiles `<script type="text/three">` on-device,
    serializes normalized `userData.xr` traits into `.glb` (`extras.xr` and
    `ANDROID_xr_scenecore`) and `.usdz` (`customData.xr`), and drives **Google
    Filament and Jetpack XR SceneCore** on Android and **Apple ARKit and
    RealityKit** on iOS and visionOS at 60 to 120 Hz—so interactive AR,
    `animate()` loops, `KHR_interactivity`, and all 14 spatial plugins work
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
`<xr-live>` core (`three-live/xr-live` at `< 66 KB gz`, or
`three-live/xr-live-viewer` at `< 46 KB gz`) with only the specific plugins your
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

To load all 14 spatial plugins without a bundler, import
`/dist/xr-live-plugins.min.js` (`< 52 KB gz`) or `/dist/xr-live-full.min.js`
(`< 151 KB gz`, which also includes the 5 `xr-live-sim` simulation plugins).

--------------------------------------------------------------------------------

## Observed attributes (`<xr-live>` and `<xr-anchor>`)

`<xr-live>` inherits all
[`<three-live>` attributes](three-live.md#observed-attributes) and adds the
spatial attributes listed in the following table:

| Element       | Attribute             | Type and values     | Default     | Description                      |
| :------------ | :-------------------- | :------------------ | :---------- | :------------------------------- |
| `<xr-live>` | `xr-mode` | `'ar' \| 'vr' \|    | `'auto'`    | Target WebXR session mode (`ar` 'inline' | 'auto'`  :             : requests `immersive-ar`; `vr` |
| `<xr-live>` | `xr-depth` | `'occlusion' \|     | `'none'`    | Enables WebXR `depth-sensing`, | 'mesh' | 'none'`  :             : analytical heightfield physics. |
| `<xr-live>` | `xr-hands` | `'gestures' \|      | `'none'`    | Enables 25-joint `XRHand` | 'none'`           :             : gesture classification. |
| `<xr-live>` | `xr-simulator` | `'living-room' \|   | `'none'`    | Enables the desktop 6DoF 'none'`             :             : look, and virtual hands). |
| `<xr-live>` | `xr-profile` | `'quest3' \|        | `'auto'`    | Target spatial hardware profile 'auto'`             :             : |
| `<xr-live>` | `sound-feedback` | `boolean` | `false` | Plays procedural Web Audio earcons (`grab`, `release`, `bounce`, `hover`) and mobile haptics. |
| `<xr-live>` | `world-understanding` | `'' \| 'planes' \|  | —           | Enables 'false'`            :             : plane and mesh detection and the |
| `<xr-live>` | `spatial-paint` | `'' \| '#rrggbb' \| | —           | Enables `xr-live-spatial-paint`; 'false'`            :             : pinching in empty space extrudes |
| `<xr-live>` | `spatial-measure` | `'' \| 'bounds' \|  | —           | Enables 'none'`             :             : bounding-box dimension callouts |
| `<xr-live>` | `measure-unit` | `'auto' \| 'm' \|   | `'auto'`    | Default measurement display unit | 'ft-in'`          :             : |
| `<xr-live>` | `magnetic-snap` | `'' \| 'grid' \|    | —           | Enables `xr-live-magnetic-snap` 'none'`             :             : |
| `<xr-live>` | `snap-grid` | `number` or `'gx gy | —           | Default Cartesian snap grid gz'` (meters)       :             : spacing in meters (for example, |
| `<xr-live>` | `snap-angle` | `number` (`0..180` degrees) | `0` | Default yaw rotation snap increment in degrees. |
| `<xr-live>` | `gaze-dwell` | `'' \| 'auto' \|    | —           | Enables `xr-live-gaze-dwell` 'false' | 'none'`   :             : hands-free eye and head gaze |
| `<xr-live>` | `dwell-time` | `number` (`250..10000` ms) | `1200` | Default gaze dwell duration in milliseconds before triggering selection. |
| `<xr-live>` | `explode` | `number` (`0..1`) | `0` | Normalized multi-part assembly explosion factor (`xr-live-exploded-view`). |
| `<xr-live>` | `explode-mode` | `'radial' \|        | `'radial'`  | Automatic explosion vector 'hierarchical'`     :             : |
| `<xr-live>` | `explode-scale` | `number` | `1.0` | Global distance multiplier applied to per-part explosion offsets. |
| `<xr-live>` | `section-plane` | `'none' \| 'x:<d>'  | `'none'`    | Real-time GPU cross-section 'interactive'`      :             : draggable gizmo frame. |
| `<xr-live>` | `persistent-anchors` | `''` or `string` (namespace) | — | Enables `xr-live-persistent-anchors` cross-session transform persistence (`xr-live:anchors:<ns>`). |
| `<xr-live>` | `persist-url-hash` | `boolean` | `false` | Syncs persisted node poses into `#xr-state=<base64url>` (`<= 8 KB`) for zero-backend link sharing. |
| `<xr-live>` | `locomotion` | `'' \| 'teleport'   | —           | Enables 'none'`             :             : |
| `<xr-live>` | `snap-turn-deg` | `number` (degrees) | `30` | Horizontal thumbstick snap-turn angle in degrees. |
| `<xr-live>` | `comfort-vignette` | `boolean` | `true` | Renders a `120ms` peripheral FOV comfort vignette during teleports and snap-turns. |
| `<xr-live>` | `shared-room` | `'<room-id>'` or `'wss://...'` | — | Enables `xr-live-shared-room` multi-user co-presence via `BroadcastChannel` or WebSocket relay. |
| `<xr-live>` | `peer-name` | `string` (max `32` chars) | — | Local peer display name broadcast to room participants. |
| `<xr-live>` | `peer-color` | `'#rrggbb'` | `'#38bdf8'` | Local peer 3D visor and laser ray tint color in `shared-room`. |
| `<xr-live>` | `webmcp` | `boolean` | `false` | Registers spatial AI tools (`inspect_xr_scene`, `place_xr_object_at_gaze`, `capture_xr_view`) on `navigator.modelContext`. |
| `<xr-live>` | `webmcp-allow-depth` | `boolean` | `false` | Opt-in gate required before `capture_xr_view` exposes the 8×8 metric `depthGridMeters` array. |
| `<xr-live>` | `webmcp-omit-pose` | `boolean` | `false` | Omits `headPosition` from `inspect_xr_scene` responses. |
| `<xr-anchor>` | `surface` | `'floor' \| 'wall'  | `'floor'`   | Target semantic surface for 'ceiling'`          :             : |
| `<xr-anchor>` | `magnetic` | `boolean` | `false` | Continuously snaps the child anchor to the nearest matching surface plane. |

--------------------------------------------------------------------------------

## Canonical `userData.xr` spatial traits

Defined in
[`three-live/src/xr-trait-schema.ts`](../three-live/src/xr-trait-schema.ts),
`mesh.userData.xr` traits are normalized, clamped to identical ranges, and
exported into `.glb` (`nodes[i].extras.xr` and
`nodes[i].extensions.ANDROID_xr_scenecore`) and `.usdz`
(`customData = {dictionary xr = {...}}`) so scenes behave identically on Web,
Android, and iOS or visionOS. The following table describes each trait key:

| Trait key                | Type and options   | Description                  |
| :----------------------- | :----------------- | :--------------------------- |
| **`grab`** | `'1-hand' \|       | 6DoF single-hand grab and '2-hand' | true`   : rotate (`'1-hand'`) or |
| **`scale`** | `{ min?: number,   | Two-handed pinch scaling true`              : (defaults to `{ min: 0.05, |
| **`billboard`** | `'capsule' \|      | Orients the node toward the true`              : around the Y axis; |
| **`follow`** | `'head' \|         | String values apply an eager 'hand-right'`      : activate lazy head or hand **or** `{ mode,    : follow with an angular snapOnStart }`     : |
| **`anchor`** | `'floor' \| 'wall' | Pins the node to a detected 'vertical'` **or** : persists user-moved `{ target?, id?,   : transforms across reloads persist? }`        : and `#xr-state` links. |
| **`physics`** | `'dynamic' \|      | Steps rigid-body gravity, 'static'`          : restitution bounce |
| **`orbit`** | `{ target: [x,y,z] | Orbits around a 3D world boolean }`         : |
| **`handles`** | `{ rotateAxis?:    | Adds four top-corner uniform } | true`          : |
| **`dimensions`** | `{ enabled?:       | Renders live `W × H × D` boolean } | true`  : |
| **`snapTo`** | `{ grid?: number   | Snaps grabbed meshes to number } | true`   : |
| **`snapSocket`** | `string` **or** `{ | Marks a node as a magnetic string }`          : |
| **`gaze`** | `{ enabled?:       | Opts a mesh into hands-free | 'ask' } | true`  : `KHR_interactivity` |
| **`explode`** | `{ enabled?:       | Configures per-part boolean`           : |
| **`navigable`** | `boolean \|        | Marks floor and platform 'blocked'`         : (`'walkable'`) or forbidden |
| **`sync`** | `boolean` | Controls whether user manipulations on a node synchronize across peers in `shared-room` (defaults to `true` on grabbable nodes; set `false` to keep local-only). |
| **`particles`** | `{ preset: 'rain'  | Turns the node into a number }`          : |
| **`holdToAsk`** | `{ prompt?:        | Press-and-hold on the mesh number } | true`   : and sends a contextual |
| **`worldUnderstanding`** | `{ planes?:        | Opts the scene into WebXR }`                 : |
| **`splatUrl`** | `string` (`https://` or relative `.splat` or `.spz` URL) | Loads and back-to-front depth-sorts 3D Gaussian Splats (`.splat` or Niantic `.spz` v2 and v3, up to `1,000,000` splats). |
| **`audio`** | `string` **or** `{ | Attaches a 3D `PannerNode` boolean }`         : |
| **`pointerEvents`** | `'none'` | Excludes the mesh from raycast picking so rays pass through it. |

--------------------------------------------------------------------------------

## Spatial plugin suite

All 14 spatial plugins are included in `xr-live-full.min.js` and
`xr-live-plugins.min.js`, or can be imported individually from
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
*   **`splat-loader` (`xr-live-splat-loader`):** Streams `.splat` (32-byte
    records) and Niantic `.spz` (v2 and v3, raw or gzipped) 3D Gaussian Splat
    files for any node with `userData.xr.splatUrl`, sorting splats back-to-front
    with a 16-bit counting sort on each frame.
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
    lowest `peerId` on every peer), and synchronizes `exploded-view` factors and
    `spatial-paint` 3D tube strokes (`MAX_REMOTE_STROKES = 64`). Dispatches
    `peerjoin`, `peerleave`, `peersync`, and `peergrabconflict`.

--------------------------------------------------------------------------------

## Simulation plugins (`xr-live-sim`)

The optional `xr-live-sim` bundle adds five plugins for interactive simulations:
games, training drills, safety walkthroughs, and robot-cell or factory-floor
rehearsals. Each plugin reads `userData.xr` traits from your scene and
`<xr-live>` attributes from the host element, so a scene needs no per-frame
code.

Load the bundle after the core, or use `xr-live-full.min.js`, which includes it:

```html
<script src="/dist/xr-live.min.js"></script>
<script src="/dist/xr-live-sim.min.js"></script> <!-- < 22 KB gz, global XRSim -->
```

With a bundler, import `xr-live/sim`. Importing the module registers all five
plugins.

| Plugin                 | What it does                                        |
| :--------------------- | :-------------------------------------------------- |
| `character-controller` | Moves the first `character` node with WASD or arrow keys, a gamepad, or a touch joystick. Jump with Space, sprint with Shift. Slides along `collidable` nodes, follows with the camera, and switches `idle`, `walk`, `run`, and `jump` clips. |
| `steering-agents` | Moves `agent` nodes with `patrol`, `chase`, `flee`, `follow`, or `wander` steering, with separation and wall push-out. |
| `hit-zones` | Tracks `integrity`, fires projectiles or hitscan rays, applies contact amounts, emits zone enter and exit events, and runs `spawner` nodes. |
| `objectives` | Tracks pickups, checkpoints, keys, time bonuses, and restores, plus score, attempts, a countdown, and the pass, fail, or timeout outcome. |
| `synth-audio` | Plays procedural cues (no audio files) mapped per node by the `audioCues` trait. |

### Simulation traits

Add these keys to `userData.xr` on any mesh or group:

| Trait       | Shape                                              |
| :---------- | :------------------------------------------------- |
| `character` | `true`, a camera mode, or `{ speed, runMultiplier, jumpVelocity, gravity, radius, height, cameraMode, cameraDistance, cameraHeight, |

\: : clips: { idle, walk, run, jump }
}`. Camera modes: `third-person`, : : :`first-person`, `top-down`, `fixed`. : |`agent`|
A mode string
or`{ mode, target, speed, turnSpeed, sightRadius, | : : stopDistance, separationRadius, waypoints, loopWaypoints }`. `target`: : : is a node name or`'user'`(the character, else the viewer). : |`integrity`|
A max number
or`{ max, current, group, showBar, cooldownMs, | : : hideOnDepleted, scoreValue, contactAmount }`. Hits skip nodes in the : : : shooter's own`group`. : |`zone`|`'box'`, `'sphere'`, or`{ shape, size, radius, watchGroups, color }`. | |`spawner`|
A template node name
or`{ template, intervalSec, maxActive, | : : totalCount, spawnRadius }`. The template node is hidden. : |`objective`|
A type
or`{ type, amount, tag, radius, required, order, spinSpeed, | : : bobAmplitude, respawnSec }`. Types: `pickup`, `checkpoint`, `key`, : : :`time-bonus`, `restore`. `order >
0`enforces ascending order. : |`audioCues`|`{ onTap, onObjective, onHit, onDepleted, onZoneEnter, onZoneExit, | : : onSpawn, onJump, onLand, pitchJitter, volume, spatial }`. Cue names: : : :`confirm`, `error`, `alarm`, `warning`, `pickup`, `jump`, `beam`, : : :`impact`, `burst`, `powerup`, `step`, `pass`, `fail`. : |`collidable`|`true`
makes the node a wall or floor for characters and agents. |

`audioCues` is separate from the file-based `audio` trait. Characters and agents
face local +Z.

### Simulation attributes

| Attribute              | Values                   | Default                  |
| :--------------------- | :----------------------- | :----------------------- |
| `character-controller` | `third-person`, `first-person`, `top-down`, `fixed-camera`, `none` | trait value |
| `character-speed`      | meters per second        | trait value              |
| `character-jump` | jump velocity in meters per second | trait value |
| `touch-joystick` | `auto` (touch screens), `always`, `none` | `auto` |
| `steering-agents` | `false` or `none` pauses agents | on |
| `hit-zones` | `projectile` (or empty), `hitscan`, `contact` | off |
| `fire-rate`            | shots per second         | `4`                      |
| `projectile-speed`     | meters per second        | `14`                     |
| `projectile-gravity` | meters per second squared | `0` |
| `hit-amount` | integrity removed per hit | `25` |
| `objectives` | present enables; `none` disables | on with objective traits |
| `scenario-timer`       | countdown in seconds     | none                     |
| `target-score` | score that passes the scenario | none |
| `attempts`             | lives before `fail`      | unlimited                |
| `sim-hud` | `auto`, `minimal`, `none` | `auto` with `objectives` |
| `synth-audio` | present enables; `muted` disables | off |
| `synth-volume`         | `0` to `1`               | `0.7`                    |

To restart a scenario, call `XRSim.resetSimScenario(element)` (or import
`resetSimScenario` from `xr-live/sim`). The Aether view restarts when its
`scenarioResetKey` prop changes.

### Simulation events

All events bubble from the host element:

| Event              | `detail`                                               |
| :----------------- | :----------------------------------------------------- |
| `characterjump`    | `{ nodeId, position }`                                 |
| `characterland`    | `{ nodeId, fallSpeed }`                                |
| `agentstatechange` | `{ nodeId, state, targetId }`                          |
| `agentreach`       | `{ agentId, targetId, position }`                      |
| `xrhit`            | `{ targetId, sourceId, amount, remaining, point }`     |
| `xrdepleted`       | `{ targetId, group, scoreValue }`                      |
| `xrzoneenter`      | `{ zoneId, nodeId, group }`                            |
| `xrzoneexit`       | `{ zoneId, nodeId, group }`                            |
| `xrspawn`          | `{ spawnerId, instanceId, index }`                     |
| `xrobjective` | `{ nodeId, tag, type, amount, totalScore, remainingRequired, outOfOrder }` |
| `xrscorechange`    | `{ score, delta, attemptsLeft, timeRemaining }`        |
| `xrscenarioend` | `{ outcome: 'pass' \| 'fail' \| 'timeout', finalScore, elapsedSec }` |

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

| Event | `event.detail` payload | Description |
| :------------------------- | :--------------- | :------------------------------------ |
| `xr-select-start`, | `{ hand: 'left'  | Fired on controller trigger, hand hit }`           : |
| `xr-handles-change` | `{ mesh, scale:  | Fired when a `userData.xr.handles` number }`        : dragged. |
| `xr-object-detected` | `{ label:        | Fired for each 2D detection 'fallback' }`    : |
| `xr-transcription` | `{ speaker:      | Fired as Gemini Live user and model boolean }`       : |
| `xr-hold-to-ask-listening` | `{ mesh: string  | Fired when a press-and-hold on a }`               : `holdToAsk` mesh begins listening. |
| `xr-hold-to-ask` | `{ mesh: string, | Fired when a `holdToAsk` voice or string }`        : |
| `xr-gemini-interrupted` | `{}` | Fired when user speech barges in and cancels Gemini Live audio playback. |
| `xr-paint-stroke` | `{ index:        | Fired when a 3D `spatial-paint` tube number }`        : |
| `measurecomplete` | `{ start:        | Fired when a `spatial-measure` string }`        : |
| `xrsnap` | `{ node, socket, | Fired when `magnetic-snap` snaps a 'angle' }`       : |
| `xrunsnap` | `{ node, socket  | Fired when a mesh is pulled past the }`               : `1.25×` breakaway radius of a |
| `gazeenter`, `gazeleave` | `{ node, point   | Fired when the smoothed `gaze-dwell` }` or `{ node }` : ray enters or leaves a gazeable mesh. |
| `gazedwell` | `{ node, point:  | Fired when radial gaze dwell reaches }`               : |
| `explodechange` | `{ factor:       | Fired when `exploded-view` updates }`               : |
| `anchorsrestored` | `{ count:        | Fired when `persistent-anchors` 'url-hash' }`    : |
| `xrteleport` | `{ from:         | Fired when `spatial-locomotion` }`               : |
| `peerjoin`, `peerleave` | `{ peerId:       | Fired when a remote participant string }`        : |
| `peergrabconflict` | `{ peerId:       | Fired when a remote participant wins string }`        : node and the local hold is released. |
| `peersync` | `{ peerId:       | Fired when `shared-room` applies a string }`        : (`__explode__`), or paint stroke |
| `xr-webmcp-capture` | `{}` | Fired when a WebMCP agent invokes `capture_xr_view` (sets `data-xr-webmcp-indicator="active"`). |

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
    `SpatialLocomotion.kt`, `SharedRoom.kt`):** Executes lazy head-follow
    springs, orbits, manipulation handles, Catmull-Rom spatial paint tubes,
    depth-colliding particles, Gaussian splat sorting, 3D dimension callouts and
    tape measure, magnetic socket and grid snapping, gaze dwell, exploded-view
    assemblies and section clipping, persistent anchors, parabolic locomotion,
    multi-user room sync, and `KHR_interactivity` behavior graphs natively on
    Google Filament. In a shared room, start host grabs with
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
    `PersistentAnchors.swift`, `SpatialLocomotion.swift`, `SharedRoom.swift`):**
    Native Swift and RealityKit runtime supporting all 14 spatial plugin
    behaviors, `userData.xr` traits, manipulation handles, spatial paint tubes,
    particle emitters, Gaussian splats, `KHR_interactivity`, and
    `XRGeminiLiveController.swift`. In a shared room, start host grabs with
    `XRSpatialRealityKitFeatures.requestGrab(_:)` and cancel the gesture when it
    returns `false` (another peer holds the node); near-simultaneous grabs
    resolve like the web and call `onPeerGrabConflict`.
