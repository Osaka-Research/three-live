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

> **Disclaimer:** This is not an officially supported Google product.

# Three-Live

[![CI](https://github.com/google/three-live/actions/workflows/ci.yml/badge.svg)](https://github.com/google/three-live/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/google/three-live?include_prereleases&label=Release)](https://github.com/google/three-live/releases)
[![Status: Developer Preview](https://img.shields.io/badge/Status-Developer%20Preview%20(Alpha)-orange.svg)](#project-status)
[![Live Playground](https://img.shields.io/badge/Demo-Live%20Playground-brightgreen.svg)](https://google.github.io/three-live/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**AI-First Native 3D & AR:** On-device JIT compiler turning live, AI-generated Three.js into native Android Filament, iOS RealityKit, and WebXR.

LLMs excel at generating Three.js code. Three-Live compiles it on-device in a sandbox and renders natively with Google Filament and Scene Viewer on Android, Apple RealityKit and Quick Look on iOS, and WebGL2 and WebXR on Web.

> **Live interactive playgrounds (no build required):** *
> **[Playground hub](https://google.github.io/three-live/)** — Launch either
> studio in your desktop, mobile, or headset browser. *
> **[`<three-live>` 3D and AR studio](https://google.github.io/three-live/three/)**
> — Procedural Three.js editor, PBR inspector, and 1-tap USDZ, GLB, and AR
> export (`< 54 KB gz`). *
> **[`<xr-live>` spatial computing studio](https://google.github.io/three-live/xr/)**
> — 6DoF WebXR, spatial HTML `<div slot="spatial">` cards, depth physics, hand
> tracking, 14 spatial plugins, and 5 simulation plugins (`< 66 KB gz` core,
> `< 151 KB gz` full).

---

## Why Three-Live and XR-Live

### Interactive AR and XR that works on iOS, Android, and headsets

In practice, browser WebXR (`navigator.xr`) only covers part of the device
landscape:

*   **iOS Safari, iOS `WKWebView`, and Android System `WebView` don't support
    WebXR.** A WebXR-only app can't enter AR in Safari on iPhone or iPad, and
    can't run WebXR inside an embedded `WebView` or `WKWebView` in a native
    mobile app.
*   **Static OS handoffs (`AR Quick Look` and `Scene Viewer`) strip
    interactivity.** Exporting a static `.usdz` or `.glb` file to the OS
    previewer works for viewing a model, but drops JavaScript `animate()` loops,
    custom state, and interactive plugins.
*   **Browser WebXR doesn't use native spatial compositors.** In Chrome on
    Android, WebXR renders WebGL2 in the browser process rather than using
    Google Filament or Jetpack XR SceneCore's `HomeSpace` shared space. On
    visionOS, browser WebXR runs in an isolated fullscreen VR session without
    camera passthrough or SwiftUI Shared Space integration.

Three-Live solves this by compiling the same Three.js script on-device and
running it natively on each platform's own engine. The following table shows
what you get in each environment:

| Target environment     | What happens with        | What you can do with     |
:                        : browser WebXR or static  : Three-Live and XR-Live   :
:                        : AR handoff               :                          :
| :--------------------- | :----------------------- | :----------------------- |
| **iPhone and iPad      | `WKWebView` has no       | Run live Three.js        |
: (native SwiftUI app)** : WebXR; `AR Quick Look`   : scenes, `animate()`      :
:                        : only shows static        : loops,                   :
:                        : `.usdz` files            : `KHR_interactivity`, and :
:                        :                          : spatial plugins natively :
:                        :                          : in **ARKit and           :
:                        :                          : RealityKit** (`ARView`   :
:                        :                          : and `RealityView`).      :
| **Android phones and   | `android.webkit.WebView` | Compile Three.js over    |
: tablets (native        : has no WebXR; `Scene     : JNI and render natively  :
: Compose or View app)** : Viewer` only shows       : in **Google Filament and :
:                        : static `.glb` files      : ARCore**                 :
:                        :                          : (`XRLiveRuntimeSession`) :
:                        :                          : inside your app UI.      :
| **Android XR and Apple | Browser WebXR is         | Attach native **Jetpack  |
: Vision Pro headsets**  : isolated in a fullscreen : XR SceneCore**           :
:                        : WebGL session            : (`GltfEntity`,           :
:                        :                          : `MovableComponent`,      :
:                        :                          : `Anchor`) or             :
:                        :                          : **RealityKit** entities  :
:                        :                          : that live in the system  :
:                        :                          : shared space alongside   :
:                        :                          : native panels.           :
| **Mobile and headset   | Standard WebXR works on  | Run 6DoF WebXR where     |
: web browsers**         : Android Chrome and       : supported, with          :
:                        : headsets; iOS Safari has : automatic Stereo SBS,    :
:                        : no WebXR                 : gyroscope, and in-memory :
:                        :                          : `.usdz` and `.glb` AR    :
:                        :                          : handoff on iOS Safari.   :

### Small core bundles with optional plugins for advanced features

Three-Live keeps its web footprint small so you can drop 3D or XR into a page
without shipping unused code:

*   **Compact core:** The 3D viewer (`three-live-viewer.min.js`) is
    `< 25.5 KB gz` (`< 54 KB gz` with the live Three.js compiler), and the WebXR
    viewer (`xr-live-viewer.min.js`) is `< 46 KB gz` (`< 66 KB gz` with the live
    Three.js compiler).
*   **Optional spatial plugins (`~2–5 KB gz` each):** Each advanced spatial
    capability in `<xr-live>` is a standalone, zero-dependency plugin
    (`< 52 KB gz` for all 14 combined). You can import and register only the
    plugins your app needs, or load the full suite. Every plugin also has a
    matching native implementation in the Android and iOS SDKs.
*   **Optional simulation plugins (`xr-live-sim.min.js`, `< 22 KB gz`):** Five
    plugins for games, training drills, and safety walkthroughs: a controllable
    character, steering agents, integrity and trigger zones, objectives with
    scoring and timers, and procedural audio cues. They are driven by
    `userData.xr` traits and host attributes, run natively on Android and iOS,
    and are documented in
    [Simulation plugins](docs/xr-live.md#simulation-plugins-xr-live-sim).

The following table lists the 14 modular spatial plugins:

| Plugin                     | Attribute or `userData.xr` trait       | What it adds across     |
:                            :                                        : WebXR, Android          :
:                            :                                        : Filament, and iOS       :
:                            :                                        : RealityKit              :
| :------------------------- | :------------------------------------- | :---------------------- |
| **`head-follow`**          | `xr.follow`, `xr.orbit`                | Lazy HUD head or hand   |
:                            :                                        : follow with an angular  :
:                            :                                        : deadzone and critically :
:                            :                                        : damped spring, plus 3D  :
:                            :                                        : satellite orbits.       :
| **`manipulation-handles`** | `xr.handles`                           | Four top-corner uniform |
:                            :                                        : scale handles and a     :
:                            :                                        : bottom pedestal         :
:                            :                                        : yaw-rotation bar that   :
:                            :                                        : emit                    :
:                            :                                        : `xr-handles-change`     :
:                            :                                        : events.                 :
| **`world-understanding`**  | `world-understanding="planes reticle"` | Real-world plane and    |
:                            :                                        : mesh tracking,          :
:                            :                                        : surface-normal gaze     :
:                            :                                        : reticle,                :
:                            :                                        : `XRTapeMeasure`, and    :
:                            :                                        : 2D-to-3D bounding-box   :
:                            :                                        : unprojection            :
:                            :                                        : (`detectObjects`).      :
| **`gemini-live`**          | `connectGeminiLive()`, `xr.holdToAsk`  | Real-time bidirectional |
:                            :                                        : WebSocket vision and    :
:                            :                                        : 16/24 kHz PCM voice     :
:                            :                                        : streaming, barge-in     :
:                            :                                        : cancellation, live      :
:                            :                                        : transcription, and      :
:                            :                                        : press-and-hold mesh     :
:                            :                                        : queries.                :
| **`spatial-paint`**        | `spatial-paint="#38bdf8"`              | Pinch-to-paint 3D       |
:                            :                                        : Catmull-Rom spline      :
:                            :                                        : strokes extruded as     :
:                            :                                        : twist-free              :
:                            :                                        : parallel-transport      :
:                            :                                        : tubes with `undo()` and :
:                            :                                        : `clear()`.              :
| **`depth-particles`**      | `xr.particles`                         | GPU-friendly `rain`,    |
:                            :                                        : `snow`, `sparks`, and   :
:                            :                                        : `confetti` emitters (up :
:                            :                                        : to 2,000 particles per  :
:                            :                                        : emitter) that collide   :
:                            :                                        : with floors and         :
:                            :                                        : real-world depth maps.  :
| **`splat-loader`**         | `xr.splatUrl`                          | Streams `.splat` and    |
:                            :                                        : Niantic `.spz` (v2 and  :
:                            :                                        : v3) 3D Gaussian Splats  :
:                            :                                        : (up to 1,000,000        :
:                            :                                        : splats) with per-frame  :
:                            :                                        : 16-bit counting sort.   :
| **`spatial-measure`**      | `spatial-measure="bounds\|tape\|all"`, | Live `W × H × D`        |
:                            : `xr.dimensions`                        : bounding-box dimension  :
:                            :                                        : callout bars with 3D    :
:                            :                                        : vector-glyph labels     :
:                            :                                        : (`m`, `cm`, `mm`, `in`, :
:                            :                                        : `ft-in`) and            :
:                            :                                        : point-to-point AR tape  :
:                            :                                        : measure.                :
| **`magnetic-snap`**        | `magnetic-snap`, `xr.snapTo`,          | Magnetic socket         |
:                            : `xr.snapSocket`                        : snapping with `1.25×`   :
:                            :                                        : breakaway hysteresis    :
:                            :                                        : and pulsing preview     :
:                            :                                        : rings, plus Cartesian   :
:                            :                                        : grid, yaw angle, and    :
:                            :                                        : surface snapping.       :
| **`gaze-dwell`**           | `gaze-dwell`, `xr.gaze`                | Hands-free eye and head |
:                            :                                        : gaze raycasting with    :
:                            :                                        : EMA smoothing, `1.5°`   :
:                            :                                        : micro-saccade grace     :
:                            :                                        : cone, and radial dwell  :
:                            :                                        : progress ring (`select` :
:                            :                                        : or `ask`).              :
| **`exploded-view`**        | `explode="0..1"`, `section-plane`,     | Multi-part CAD assembly |
:                            : `xr.explode`                           : explosion with          :
:                            :                                        : staggered layers,       :
:                            :                                        : dashed leader lines,    :
:                            :                                        : two-hand spread         :
:                            :                                        : gesture, and GPU        :
:                            :                                        : cross-section slicer.   :
| **`persistent-anchors`**   | `persistent-anchors`,                  | Three-tier pose         |
:                            : `persist-url-hash`,                    : persistence across      :
:                            : `xr.anchor.persist`                    : reloads and sessions    :
:                            :                                        : via shareable           :
:                            :                                        : `#xr-state=<base64url>` :
:                            :                                        : URLs, `localStorage`,   :
:                            :                                        : and native anchors.     :
| **`spatial-locomotion`**   | `locomotion="teleport snap-turn"`,     | Ballistic parabolic     |
:                            : `xr.navigable`                         : teleport arc with       :
:                            :                                        : walkable and blocked    :
:                            :                                        : surface validation,     :
:                            :                                        : thumbstick snap-turn or :
:                            :                                        : smooth glide, and a     :
:                            :                                        : `120ms` FOV comfort     :
:                            :                                        : vignette.               :
| **`shared-room`**          | `shared-room="<id>\|wss://..."`,       | Zero-dependency         |
:                            : `xr.sync`                              : multi-user co-presence  :
:                            :                                        : (`20 Hz` quantized      :
:                            :                                        : avatars and laser rays, :
:                            :                                        : optimistic grab locks   :
:                            :                                        : with deterministic      :
:                            :                                        : tie-breaking, synced    :
:                            :                                        : explode and paint).     :

The following table lists the 5 modular simulation plugins (`xr-live-sim.min.js`
/ `xr-live/sim`):

| Plugin                     | Attribute or            | What it adds across   |
:                            : `userData.xr` trait     : Web, Android          :
:                            :                         : Filament, and iOS     :
:                            :                         : RealityKit            :
| :------------------------- | :---------------------- | :-------------------- |
| **`character-controller`** | `character-controller`, | Capsule kinematics    |
:                            : `xr.character`          : with floor and slope  :
:                            :                         : stepping, jump with   :
:                            :                         : coyote time, WASD,    :
:                            :                         : Arrow, Gamepad, and   :
:                            :                         : touch joystick input, :
:                            :                         : and `third-person`,   :
:                            :                         : `first-person`,       :
:                            :                         : `top-down`, or        :
:                            :                         : `fixed-camera` rig    :
:                            :                         : follow.               :
| **`steering-agents`**      | `steering-agents`,      | Autonomous kinematic  |
:                            : `xr.agent`              : agents (`patrol`,     :
:                            :                         : `chase`, `flee`,      :
:                            :                         : `follow`, `wander`)   :
:                            :                         : with vision-cone      :
:                            :                         : target acquisition,   :
:                            :                         : obstacle avoidance,   :
:                            :                         : and                   :
:                            :                         : `agentstatechange` /  :
:                            :                         : `agentreach` events.  :
| **`hit-zones`**            | `hit-zones`,            | Part and target       |
:                            : `xr.integrity`,         : `integrity` with      :
:                            : `xr.zone`, `xr.spawner` : world-space health    :
:                            :                         : bars, hit flashes,    :
:                            :                         : `projectile` /        :
:                            :                         : `hitscan` / `contact` :
:                            :                         : interaction, burst    :
:                            :                         : fragments, colored    :
:                            :                         : trigger `zone`        :
:                            :                         : volumes, and timed    :
:                            :                         : template `spawner`    :
:                            :                         : pooling.              :
| **`objectives`**           | `objectives`,           | Ordered or unordered  |
:                            : `scenario-timer`,       : checklist objectives  :
:                            : `target-score`,         : (`reach`, `clear`,    :
:                            : `attempts`,             : `collect`,            :
:                            : `xr.objective`          : `activate`, `hold`),  :
:                            :                         : score, attempt        :
:                            :                         : counter, countdown    :
:                            :                         : timer, HUD overlay    :
:                            :                         : (`sim-hud`), and      :
:                            :                         : `scenario-reset-key`  :
:                            :                         : resets.               :
| **`synth-audio`**          | `synth-audio`,          | Zero-asset procedural |
:                            : `synth-volume`,         : audio synthesis       :
:                            : `xr.audioCues`          : (`beep`, `chime`,     :
:                            :                         : `buzz`, `thud`,       :
:                            :                         : `sweep`, `click`,     :
:                            :                         : `alarm`, `whoosh`)    :
:                            :                         : bound to simulation   :
:                            :                         : events via Web Audio, :
:                            :                         : Android `AudioTrack`, :
:                            :                         : and iOS               :
:                            :                         : `AVAudioEngine`.      :

### Safe execution for live, AI-generated Three.js

Because LLMs already know Three.js, an agent or backend can generate a complete
interactive 3D or XR scene in 15 to 30 lines of JavaScript without external
binary assets. Three-Live executes client scripts inside a dedicated Web Worker
or an opaque-origin `<iframe sandbox="allow-scripts">` (`connect-src 'none'`) on
the web, and inside a sandboxed Rust `Boa` VM on Android and iOS—with network
and storage globals removed, `Object.prototype` frozen, CPU instruction fuel
limits, and scene geometry memory quotas.

---

## Compare `<three-live>` and `<xr-live>`

The following table compares `<three-live>` with `<xr-live>`:

| Capability              | `<three-live>`          | `<xr-live>` (extends     |
:                         :                         : `<three-live>`)          :
| :---------------------- | :---------------------- | :----------------------- |
| **Primary use case**    | 3D product viewers,     | Interactive 6DoF WebXR,  |
:                         : procedural scenes, and  : native mobile XR,        :
:                         : 1-tap AR handoff        : spatial UI cards, depth  :
:                         :                         : physics, and hand        :
:                         :                         : tracking                 :
| **Procedural `<script   | Yes (sandboxed Web      | Yes (inherits            |
: type="text/three">`**   : Worker or `<iframe>`    : `three-author` JIT       :
:                         : JIT compiler)           : compiler plus            :
:                         :                         : `userData.xr` traits)    :
| **Mobile AR and XR**    | Universal AR handoff    | Native Android           |
:                         : (`AR Quick Look`,       : (`Filament` and          :
:                         : `Scene Viewer`, WebXR)  : `SceneCore`), native iOS :
:                         :                         : and visionOS             :
:                         :                         : (`RealityKit`), and      :
:                         :                         : WebXR                    :
| **Spatial interaction** | Orbit controls, mesh    | Declarative              |
:                         : picking, 3D surface     : `userData.xr` traits     :
:                         : hotspots,               : (`grab`, `scale`,        :
:                         : `KHR_interactivity`     : `billboard`, `anchor`,   :
:                         :                         : `handles`, `snapTo`,     :
:                         :                         : `gaze`, `explode`,       :
:                         :                         : `navigable`, `sync`), 14 :
:                         :                         : spatial plugins, 5       :
:                         :                         : `xr-live-sim` simulation :
:                         :                         : plugins, 25-joint hands, :
:                         :                         : and `KHR_interactivity`  :
| **Spatial HTML UI**     | 2D screen-space overlay | 3D textured and          |
:                         : hotspots                : raycastable HTML cards   :
:                         : (`slot="hotspot-*"`)    : (`<div slot="spatial">`) :
| **Default bundle        | **`< 25.5 KB gz`**      | **`< 46 KB gz`**         |
: budget**                : (viewer), **`< 54 KB    : (viewer), **`< 66 KB     :
:                         : gz`**                   : gz`**                    :
:                         : (`three-live.min.js`)   : (`xr-live.min.js`), **`< :
:                         :                         : 151 KB gz`**             :
:                         :                         : (`xr-live-full.min.js`)  :

---

## Quickstarts

### Render a procedural 3D scene with `<three-live>`

```html
<script type="module" src="/dist/three-live.min.js"></script>

<three-live allow-client-scripts camera-controls ar auto-rotate style="width: 100%; height: 480px; display: block;">
  <script type="text/three">
    const mesh = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.4, 0.14, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0x4285f4, metalness: 0.6, roughness: 0.2 })
    );
    scene.add(mesh);
  </script>
</three-live>
```

### Build a spatial scene with `<xr-live>`

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  xr-mode="inline-ar"
  xr-depth="occlusion-physics"
  xr-hands="gestures"
  world-understanding="planes reticle"
  spatial-paint="#38bdf8"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <xr-anchor name="chair" src="/models/chair.glb" position="0 0 -1.2" data-xr-traits="grab scale anchor"></xr-anchor>

  <div slot="spatial" data-position="0.45 0.9 -1.1" data-xr-traits="grab billboard">
    <div style="padding: 14px; background: #0f172a; color: #fff; border-radius: 12px;">
      <h4>Spatial product card</h4>
      <button>Pinch to interact</button>
    </div>
  </div>
</xr-live>
```

### Register optional plugins for advanced features

If you use a bundler and only need specific spatial plugins on top of the
`< 66 KB gz` `<xr-live>` core, import and register just those plugins:

```ts
import { XRLiveElement } from 'three-live/xr-live';
import { spatialMeasurePlugin } from 'xr-live/src/plugins/spatial-measure';
import { magneticSnapPlugin } from 'xr-live/src/plugins/magnetic-snap';

XRLiveElement.registerPlugin(spatialMeasurePlugin);
XRLiveElement.registerPlugin(magneticSnapPlugin);
```

### Run natively on Android with Google Filament and Jetpack XR SceneCore

```kotlin
import com.google.threelive.FilamentHelper
import com.google.threelive.XRLiveRuntimeSession
import com.google.threelive.XRLiveSceneCoreHelper

// Compile a Three.js script to a zero-copy GLB buffer and render in Google Filament
val holder = FilamentHelper.loadModelZeroCopy(script) { buffer ->
    assetLoader.createAssetFromBinary(buffer)
}

// Drive live KHR_interactivity graphs, head-follow springs, orbits, and spatial features on each frame
val runtime = XRLiveRuntimeSession.fromGlb(holder.byteBuffer)
runtime.step(dtSeconds = 1.0 / 60.0)

// Or hydrate interactive spatial traits (grab, scale, billboard, anchor) in Android XR SceneCore
XRLiveSceneCoreHelper.attachTraitsFromGlb(xrSession, entity, holder.byteBuffer)
```

### Run natively on iOS and visionOS with Apple RealityKit

```swift
import ThreeLiveCompiler
import RealityKit

@MainActor
func loadSpatialScene(from script: String, into arView: ARView) async throws -> XRLiveRealityKitSession? {
    let glb = try ThreeCompiler.compileToGLB(script: script)
    let entity = try await RealityKitHelper.loadEntity(fromGLB: glb)
    XRLiveRealityKit.installTraits(on: entity, in: arView)

    // Bind live KHR_interactivity and spatial traits to RealityKit SceneEvents.Update
    let session = XRLiveRealityKitSession(glbData: glb, root: entity)
    session?.installInputTargets()
    session?.start()
    return session
}
```

### Compile scenes from the command line (`three-live-cli`)

```bash
$ three-live-cli convert scene.js -o output.glb
```

---

## Project status

Three-Live is in **Developer Preview (Alpha)**. It is an experimental
open-source library exploring AI-driven procedural 3D and spatial computing
across Web, Android, and Apple platforms.

*   **Prebuilt distributions:** Standalone web JavaScript bundles
    (`three-live-web-dist.zip`), the Apple XCFramework
    (`ThreeLiveCompiler.xcframework.zip`), the Android release AAR
    (`three-live-compiler-release.aar`), and native `three-live-cli` binaries
    for macOS, Linux, and Windows are published on
    **[GitHub Releases](https://github.com/google/three-live/releases)**.
*   **Package registries:** Direct consumption through **Swift Package
    Manager**, **GitHub Releases**, and the **GitHub Pages CDN** works today
    (see [Install packages and bundles](#install-packages-and-bundles)).
    Publishing to public package registries (`npm`, `Crates.io`, and Maven) is
    planned for a future release.
*   **Release notes:** See [`CHANGELOG.md`](CHANGELOG.md) for release history
    and architectural notes.

--------------------------------------------------------------------------------

## Install packages and bundles

### Package installation

*   **Web (CDN, prebuilt release, or source):**

    *   **Hosted ES module (`<script>`):**

        ```html
        <script type="module" src="https://google.github.io/three-live/dist/three-live.min.js"></script>
        ```
    *   **Prebuilt bundle archive:** Download `three-live-web-dist.zip` from
        **[GitHub Releases](https://github.com/google/three-live/releases)**.
    *   **From source:** Run `git clone https://github.com/google/three-live.git
        && cd three-live && npm install && npm run build`.
*   **iOS, macOS, and visionOS (Swift Package Manager):**

    ```swift
    .package(url: "https://github.com/google/three-live.git", from: "1.0.0")
    ```

    Swift Package Manager automatically resolves the prebuilt, checksum-pinned
    `ThreeLiveCompiler.xcframework.zip` archive from GitHub Releases—no local
    Rust or Node.js toolchain is required.
*   **Android (prebuilt release AAR or source):**

    *   **Prebuilt AAR:** Download `three-live-compiler-release.aar` (includes
        `arm64-v8a`, `armeabi-v7a`, and `x86_64` JNI `.so` libraries) from
        **[GitHub Releases](https://github.com/google/three-live/releases)**
        into `app/libs/` and add
        `implementation(files("libs/three-live-compiler-release.aar"))`.
    *   **From source:** Run `make android` (or
        `bash scripts/build_android_aar.sh`).
*   **Rust CLI (`three-live-cli`) and crate:**

    *   **Prebuilt binaries:** Download standalone binaries for macOS (`arm64`
        and `x86_64`), Linux (`x86_64` and `aarch64`), and Windows
        (`x86_64.exe`) from
        **[GitHub Releases](https://github.com/google/three-live/releases)**.
    *   **From source:** Run `make rust` (`npm run build && cargo build
        --manifest-path compiler/Cargo.toml --release --bin three-live-cli`).

### JavaScript bundles and enforced size budgets

Every bundle targets `es2020`, strips full license blocks
(`--legal-comments=none`), and emits a single four-line SPDX header. The
following table lists each bundle and its enforced gzipped budget:

| Family           | Bundle file                       | Enforced       | Included capabilities       |
:                  :                                   : budget         :                             :
:                  :                                   : (`.min.js.gz`) :                             :
| :--------------- | :-------------------------------- | :------------: | :-------------------------- |
| **`three-live`** | **`three-live-viewer.min.js`**    | **`< 25.5 KB   | Lean `.glb` and `.usdz`     |
:                  :                                   : gz`**          : WebGL2 PBR viewer, TRS      :
:                  :                                   :                : animations, orbit controls, :
:                  :                                   :                : and AR packager.            :
|                  | **`three-live.min.js`**           | **`< 54 KB     | Standard `<three-live>` +   |
:                  :                                   : gz`**          : **`three-author`**          :
:                  :                                   :                : (`<script                   :
:                  :                                   :                : type="text/three">`,        :
:                  :                                   :                : `KHR_interactivity`         :
:                  :                                   :                : compiler) + AR packager.    :
|                  | **`three-live-extras.min.js`**    | **`< 17 KB     | Add-on plugin:              |
:                  :                                   : gz`**          : `KHR_interactivity` VM, PBR :
:                  :                                   :                : Next extensions, HDRI and   :
:                  :                                   :                : SH irradiance, dynamic      :
:                  :                                   :                : contact shadows, and 3D     :
:                  :                                   :                : hotspots.                   :
|                  | **`three-live-animation.min.js`** | **`< 6.5 KB    | Add-on plugin: 64-joint GPU |
:                  :                                   : gz`**          : skeletal skinning, morph    :
:                  :                                   :                : targets, and animation      :
:                  :                                   :                : cross-fading.               :
|                  | **`three-live-full.min.js`**      | **`< 69 KB     | All-in-one 3D bundle        |
:                  :                                   : gz`**          : (`three-live` + `extras` +  :
:                  :                                   :                : `animation`, all nine       :
:                  :                                   :                : plugins auto-registered).   :
| **`xr-live`**    | **`xr-live-viewer.min.js`**       | **`< 46 KB     | Lean `.glb` and `.usdz`     |
:                  :                                   : gz`**          : WebXR viewer + spatial      :
:                  :                                   :                : traits (`grab`, `scale`,    :
:                  :                                   :                : `billboard`, `anchor`),     :
:                  :                                   :                : `<div slot="spatial">`, and :
:                  :                                   :                : mobile AR bridge.           :
|                  | **`xr-live.min.js`**              | **`< 66 KB     | Standard `<xr-live>` +      |
:                  :                                   : gz`**          : **`three-author`**          :
:                  :                                   :                : (`<script                   :
:                  :                                   :                : type="text/three">`) +      :
:                  :                                   :                : runtime USDZ and GLB        :
:                  :                                   :                : compiler.                   :
|                  | **`xr-live-extras.min.js`**       | **`< 10 KB     | Add-on plugin: Deep XR      |
:                  :                                   : gz`**          : (`XRDepthManager`,          :
:                  :                                   :                : `XRHeightfieldPhysics`,     :
:                  :                                   :                : 25-joint                    :
:                  :                                   :                : `XRHandGestureClassifier`), :
:                  :                                   :                : `XRDesktopSimulator`,       :
:                  :                                   :                : Spatial Audio, Skybox, and  :
:                  :                                   :                : WebMCP tools.               :
|                  | **`xr-live-plugins.min.js`**      | **`< 52 KB     | Add-on plugin bundle        |
:                  :                                   : gz`**          : registering all 14 spatial  :
:                  :                                   :                : plugins (`head-follow`,     :
:                  :                                   :                : `manipulation-handles`,     :
:                  :                                   :                : `world-understanding`,      :
:                  :                                   :                : `gemini-live`,              :
:                  :                                   :                : `spatial-paint`,            :
:                  :                                   :                : `depth-particles`,          :
:                  :                                   :                : `splat-loader`,             :
:                  :                                   :                : `spatial-measure`,          :
:                  :                                   :                : `magnetic-snap`,            :
:                  :                                   :                : `gaze-dwell`,               :
:                  :                                   :                : `exploded-view`,            :
:                  :                                   :                : `persistent-anchors`,       :
:                  :                                   :                : `spatial-locomotion`,       :
:                  :                                   :                : `shared-room`).             :
|                  | **`xr-live-sim.min.js`**          | **`< 22 KB     | Add-on plugin bundle        |
:                  :                                   : gz`**          : registering the 5           :
:                  :                                   :                : simulation plugins          :
:                  :                                   :                : (`character-controller`,    :
:                  :                                   :                : `steering-agents`,          :
:                  :                                   :                : `hit-zones`, `objectives`,  :
:                  :                                   :                : `synth-audio`).             :
|                  | **`xr-live-full.min.js`**         | **`< 151 KB    | All-in-one 3D and XR bundle |
:                  :                                   : gz`**          : (`three-live-full` +        :
:                  :                                   :                : `xr-live` +                 :
:                  :                                   :                : `xr-live-extras` + all 14   :
:                  :                                   :                : spatial plugins + 5         :
:                  :                                   :                : simulation plugins).        :

--------------------------------------------------------------------------------

## Documentation guide

The following guides cover the web components, spatial plugins, native SDKs, and
LLM authoring workflows:

| Guide                                          | Audience   | Contents                                                         |
| :--------------------------------------------- | :--------- | :--------------------------------------------------------------- |
| **[`docs/three-live.md`](docs/three-live.md)** | Web and    | Complete `<three-live>` reference: attributes, `<model-viewer>`  |
:                                                : mobile     : drop-in JavaScript API, DOM events, `KHR_interactivity`          :
:                                                : developers : authoring, 3D hotspots, PBR Next and HDRI, animations, and       :
:                                                :            : sandboxing.                                                      :
| **[`docs/xr-live.md`](docs/xr-live.md)**       | Spatial    | Complete `<xr-live>` and plugins guide: why native bridges       |
:                                                : and XR     : matter, optional plugin registration, canonical `userData.xr`    :
:                                                : developers : traits, all 14 spatial plugins, the 5 `xr-live-sim` simulation   :
:                                                :            : plugins, `<div slot="spatial">` cards, depth and physics,        :
:                                                :            : 25-joint hands, WebMCP, and native Android and iOS runtimes.     :
| **[`docs/cookbook.md`](docs/cookbook.md)**     | All        | Copy-pasteable recipes for e-commerce configurators, precision   |
:                                                : developers : manipulation handles, Gemini Live spatial assistants, 3D spatial :
:                                                :            : paint, CAD exploded views and measurements, magnetic snapping    :
:                                                :            : and persistent anchors, multi-user co-presence, and interactive  :
:                                                :            : training/simulation drills (`xr-live-sim`).                      :
| **[`docs/llm-guide.md`](docs/llm-guide.md)**   | LLMs and   | Copy-paste system prompt snippet, canonical `userData.xr` and    |
:                                                : agents     : `userData.interactivity` schemas, strict `THREE.*` allowlist,    :
:                                                :            : scene quotas, and few-shot templates.                            :
| **[`AGENTS.md`](AGENTS.md)**                   | Coding     | Repository rules, three-target cross-platform parity contract,   |
:                                                : agents     : build and test commands, bundle budgets, and security            :
:                                                :            : invariants.                                                      :
| **[`skills/`](skills/)**                       | Agent      | Progressive-disclosure `SKILL.md` skills for authoring scenes    |
:                                                : skills     : ([`three-live-authoring`](skills/three-live-authoring/SKILL.md)) :
:                                                :            : and developing plugins                                           :
:                                                :            : ([`xr-live-plugin-dev`](skills/xr-live-plugin-dev/SKILL.md)).    :
| **[`llms.txt`](llms.txt) and                   | LLM        | Single-file concise index (`llms.txt`) and complete concatenated |
: [`llms-full.txt`](llms-full.txt)**             : context    : reference (`llms-full.txt`) for LLM context windows.             :
:                                                : feeds      :                                                                  :
| **[`CHANGELOG.md`](CHANGELOG.md)**             | All users  | Release notes and architectural summary for the Developer        |
:                                                :            : Preview release.                                                 :

---

## Build and run demos

Run `make` (or `make help`) from the repository root to build packages, run tests, or open the interactive studio demos:

```bash
$ make doctor        # Check installed toolchains (Node, Rust, Xcode, Android NDK)
$ make web           # Compile all <three-live> and <xr-live> JS bundles and embedded engine
$ make web-demo      # Launch web playgrounds at http://localhost:8888/three/ and /xr/
$ make test          # Run full web, Rust compiler, and mobile parity test suites
$ make ios-demo      # Build XCFramework, generate .xcodeproj, and open in Xcode (macOS)
$ make android-demo  # Build JNI .so slices and debug Compose APK, and open Android Studio
```

---

## Repository structure

The repository is organized into the following directories:

```none
three-live/
├── Makefile               # Unified web, Rust, iOS (Xcode), and Android Studio build targets
├── three-live/            # Core 3D and AR engine and <three-live> Web Component
├── xr-live/               # Spatial computing and Deep XR SDK, <xr-live>, 14 spatial plugins, and 5 sim plugins
├── mobile/                # Native Android (Kotlin, Filament, SceneCore) and iOS (Swift, RealityKit) SDKs
├── compiler/              # In-process Rust procedural Three.js to GLB and USDZ compiler and CLI
├── docs/                  # Reference documentation for <three-live>, <xr-live>, and LLMs
├── examples/              # Web and mobile example applications
└── scripts/               # Build and bundle verification scripts
```

---

## Security and license

*   **Security:** See [`SECURITY.md`](SECURITY.md) for instructions on reporting
    vulnerabilities. Eligibility for the
    [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security)
    is determined by the
    [Google Open Source Software Vulnerability Reward Program Rules](https://bughunters.google.com/about/rules/open-source/google-open-source-software-vulnerability-reward-program-rules).
*   **License:** Apache 2.0 (see [`LICENSE`](LICENSE)).
