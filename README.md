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

<div align="center">

# Three-Live

**AI-First Native 3D, CAD & Spatial Computing:** On-device JIT compiler turning live, AI-generated **Three.js** into native **Android (Google Filament & Jetpack XR)**, **iOS & visionOS (Apple RealityKit)**, and **WebXR**.

[![CI](https://github.com/google/three-live/actions/workflows/ci.yml/badge.svg)](https://github.com/google/three-live/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/google/three-live?include_prereleases&label=Release)](https://github.com/google/three-live/releases)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**[⚡ Quickstarts (Android • iOS • CLI • Web)](#quickstarts)** •
**[📦 Install (JitPack • SwiftPM • Cargo • npm)](#install-packages-and-bundles)** •
**[▶ Live 3D Studio](https://google.github.io/three-live/three/)** •
**[🥽 Live Spatial XR Studio](https://google.github.io/three-live/xr/)** •
**[📚 Docs](#documentation-guide)**

</div>

![Three-Live Hero Showcase: Native Android & iOS XR, Parametric CAD & CSG, Spatial Traits & 60 Hz Physics, and AI Agent CLI](docs/assets/hero-showcase.gif)

LLMs and developers excel at writing concise **Three.js** code—not hundreds of
lines of platform-specific native 3D, shader, and AR boilerplate. **Three-Live**
compiles standard Three.js (`THREE.Mesh`, `THREE.CSG`, `userData.xr`,
`KHR_interactivity`) on-device in a sandboxed Rust VM and renders natively in
**Google Filament and Jetpack XR SceneCore on Android**, **Apple RealityKit and
Quick Look on iOS and visionOS**, **headless 4-up PNG contact sheets
(`three-live-cli`)** for AI coding agents, and **WebGL2 / WebXR** on the Web.

--------------------------------------------------------------------------------

## Quickstarts

### 1. Run Three.js natively on Android (Google Filament & Jetpack XR SceneCore)

Compile standard Three.js code over zero-copy JNI and drive native **Google
Filament** rendering, **60 Hz physics**, and **Jetpack XR SceneCore** spatial
entities:

```kotlin
import com.google.threelive.FilamentHelper
import com.google.threelive.XRLiveRuntimeSession
import com.google.threelive.XRLiveSceneCoreHelper

val threeJsCode = """
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.55, 3),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.85, roughness: 0.15 })
  );
  core.userData.xr = { grab: '2-hand', orbit: { speed: -0.4 } };
  scene.add(core);
""".trimIndent()

// Compile Three.js to a zero-copy GLB ByteBuffer and load directly into Google Filament
val holder = FilamentHelper.loadModelZeroCopy(threeJsCode) { buffer ->
    assetLoader.createAssetFromBinary(buffer)
}

// Step live KHR_interactivity graphs, 60 Hz rigid-body physics, and spatial traits per frame
val runtime = XRLiveRuntimeSession.fromGlb(holder.byteBuffer)
runtime.step(dtSeconds = 1.0 / 60.0)

// Or attach interactive spatial traits (grab, scale, billboard, anchor) in Android XR SceneCore
XRLiveSceneCoreHelper.attachTraitsFromGlb(xrSession, entity, holder.byteBuffer)
```

### 2. Run Three.js natively on iOS, macOS, and visionOS (Apple RealityKit)

Compile the exact same Three.js code into **Apple RealityKit** (`ARView` /
`RealityView`) or `.usdz`:

```swift
import ThreeLiveCompiler
import RealityKit

@MainActor
func loadSpatialScene(from threeJsCode: String, into arView: ARView) async throws -> XRLiveRealityKitSession? {
    let glb = try ThreeCompiler.compileToGLB(script: threeJsCode)
    let entity = try await RealityKitHelper.loadEntity(fromGLB: glb)
    XRLiveRealityKit.installTraits(on: entity, in: arView)

    // Bind live KHR_interactivity, 60 Hz physics, and spatial traits to RealityKit SceneEvents.Update
    let session = XRLiveRealityKitSession(glbData: glb, root: entity)
    session?.installInputTargets()
    session?.start()
    return session
}
```

### 3. Verify & compile Three.js headlessly for AI agents (`three-live-cli` & MCP server)

Render a 4-up orthographic/camera contact sheet (zero GPU required), run the
spatial linter for JSON frustum/overlap telemetry, compile `scene.js` to `.glb`
/ `.usdz`, or attach `three-live-cli mcp` as a zero-dependency **Model Context
Protocol (MCP)** stdio server (`three_live_validate`, `three_live_render`,
`three_live_convert`, `three_live_sim`, `three_live_link`) in Gemini CLI, Google
Antigravity, Claude Code, or any MCP client. `three-live-cli link scene.js --qr`
prints a playground link (and a terminal QR code) that opens the scene on a
phone, one tap from AR:

```bash
$ npx three-live-cli render scene.js --view=quad --grid --annotations -o contact_sheet.png
$ npx three-live-cli validate scene.js --json
$ npx three-live-cli link scene.js --qr
$ npx three-live-cli convert scene.js -o model.usdz

# Or register the built-in MCP server for closed-loop visual + spatial AI verification:
$ claude mcp add three-live -- npx -y -p three-live three-live-cli mcp
```

### 4. Run on the Web (`<three-live>` and `<xr-live>`)

On the web, `<three-live>` (`< 30 KB gz` viewer, `< 72 KB gz` with the live
Three.js compiler) and `<xr-live>` (`< 84 KB gz`) render the same Three.js
scenes in WebGL2 and 6DoF WebXR with 1-tap mobile AR handoff:

```js
// Standard Three.js scene (runs identically in Android, iOS, CLI, and Web)
const mesh = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.4, 0.14, 64, 16),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.8, roughness: 0.15 })
);
mesh.userData.xr = { grab: '1-hand', billboard: 'capsule' };
scene.add(mesh);
```

--------------------------------------------------------------------------------

## Install packages and bundles

### Package installation

*   **1. Android (JitPack, GitHub Packages Maven, prebuilt release AAR, or
    source):**

    *   **JitPack (`https://jitpack.io`, no authentication required):** Add
        `maven("https://jitpack.io")` to `settings.gradle.kts`, then add:

        ```kotlin
        dependencies {
          implementation("com.github.google.three-live:compiler:v1.3.2")
          // Optional adapters: :filament, :firebase-ai, :detect-mlkit, :hands-androidxr, :hands-mediapipe
        }
        ```
    *   **GitHub Packages Maven
        (`https://maven.pkg.github.com/google/three-live`):** Configure the
        repository in `settings.gradle.kts` and add
        `implementation("com.google.threelive:compiler:1.3.2")` (plus optional
        `:filament`, `:firebase-ai`, `:detect-mlkit`, `:hands-androidxr`,
        `:hands-mediapipe`).
    *   **Prebuilt AAR:** Download `three-live-compiler-release.aar` (includes
        `arm64-v8a`, `armeabi-v7a`, and `x86_64` JNI `.so` libraries) and
        optional adapter AARs (`three-live-filament-release.aar`, etc.) from
        **[GitHub Releases](https://github.com/google/three-live/releases)**
        into `app/libs/` and add
        `implementation(files("libs/three-live-compiler-release.aar"))`.
    *   **Maven Local (`com.google.threelive:compiler:1.3.2`):** Run
        `./gradlew :mobile:android:publishReleasePublicationToMavenLocal` and
        add `implementation("com.google.threelive:compiler:1.3.2")`.
    *   **From source:** Run `make android` (or
        `bash scripts/build_android_aar.sh`).
*   **2. iOS, macOS, and visionOS (Swift Package Manager):**

    ```swift
    .package(url: "https://github.com/google/three-live.git", from: "1.0.0")
    ```

    Swift Package Manager automatically resolves the prebuilt, checksum-pinned
    `ThreeLiveCompiler.xcframework.zip` archive from GitHub Releases—no local
    Rust or Node.js toolchain is required.
*   **3. Rust CLI (`three-live-cli`) and library crate (`Crates.io`, prebuilt
    binaries, or source):**

    *   **Crates.io (library & CLI):**

        ```bash
        cargo add three-live-compiler
        # Or install the standalone CLI binary from Crates.io:
        cargo install three-live-compiler --bin three-live-cli
        ```
    *   **Prebuilt binaries:** Download standalone binaries for macOS (`arm64`
        and `x86_64`), Linux (`x86_64` and `aarch64`), and Windows
        (`x86_64.exe`) from
        **[GitHub Releases](https://github.com/google/three-live/releases)**.
    *   **From source:** Run `make rust` (`npm run build && cargo build
        --manifest-path compiler/Cargo.toml --release --bin three-live-cli`).
*   **4. Web (npm, CDN, prebuilt release, or source):**

    *   **npm:**

        ```bash
        npm install three-live xr-live
        ```
    *   **Hosted ES module (`jsDelivr` or GitHub Pages CDN):** Load
        `https://cdn.jsdelivr.net/npm/three-live/dist/three-live.min.js` or
        `https://google.github.io/three-live/dist/three-live.min.js`.
    *   **Prebuilt bundle archive:** Download `three-live-web-dist.zip` from
        **[GitHub Releases](https://github.com/google/three-live/releases)**.
    *   **From source:** Run `git clone https://github.com/google/three-live.git
        && cd three-live && npm install && npm run build`.

---

## Why Three-Live and XR-Live

### Native mobile and headset AR/XR from Three.js

In practice, browser WebXR (`navigator.xr`) only covers part of the device
landscape:

*   **Android System `WebView`, iOS Safari, and iOS `WKWebView` don't support
    WebXR.** A WebXR-only app can't run inside an embedded `WebView` or
    `WKWebView` in a native Android or iOS app, and can't enter AR in Safari on
    iPhone or iPad.
*   **Static OS handoffs (`Scene Viewer` and `AR Quick Look`) strip
    interactivity.** Exporting a static `.glb` or `.usdz` file to the OS
    previewer works for viewing a model, but drops Three.js `animate()` loops,
    60 Hz physics, custom state, and interactive plugins.
*   **Browser WebXR doesn't use native spatial compositors.** On Android,
    browser WebXR renders WebGL2 in the browser process rather than using Google
    Filament or Jetpack XR SceneCore's `HomeSpace` shared space. On visionOS,
    browser WebXR runs in an isolated fullscreen VR session without camera
    passthrough or SwiftUI Shared Space integration.

Three-Live solves this by compiling the same Three.js code on-device and running
it natively on each platform's own engine:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Target environment | What happens with browser WebXR or static AR handoff | What you can do with Three-Live and XR-Live |
| :--- | :--- | :--- |
| **Android phones and tablets (native Compose or View app)** | `android.webkit.WebView` has no WebXR; `Scene Viewer` only shows static `.glb` files | Compile Three.js over JNI and render natively in **Google Filament and ARCore** (`XRLiveRuntimeSession`) inside your app UI. |
| **Android XR and Apple Vision Pro headsets** | Browser WebXR is isolated in a fullscreen WebGL session | Attach native **Jetpack XR SceneCore** (`GltfEntity`, `MovableComponent`, `Anchor`) or **RealityKit** entities that live in the system shared space alongside native panels. |
| **iPhone and iPad (native SwiftUI app)** | `WKWebView` has no WebXR; `AR Quick Look` only shows static `.usdz` files | Run live Three.js scenes, `animate()` loops, `KHR_interactivity`, and spatial plugins natively in **ARKit and RealityKit** (`ARView` and `RealityView`). |
| **Mobile and headset web browsers** | Standard WebXR works on Android Chrome and headsets; iOS Safari has no WebXR | Run 6DoF WebXR where supported, with automatic Stereo SBS, gyroscope, and in-memory `.usdz` and `.glb` AR handoff on iOS Safari. |
<!-- mdformat on -->

### Compare `<three-live>` and `<xr-live>`

The following table compares the two runtime tiers across Android, iOS, and Web:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Capability | `three-live` (Core 3D, CAD & Animation) | `xr-live` (Spatial Computing & Simulation) |
| :---------------------- | :---------------------- | :----------------------- |
| **Primary use case** | 3D product viewers, parametric CAD/CSG, skeletal animation, and 1-tap AR handoff | Interactive 6DoF XR, native mobile AR/XR, spatial UI cards, depth physics, hand tracking, and 60 Hz simulations |
| **Three.js JIT compiler** | Yes (sandboxed Rust `Boa`/QuickJS VM on Android/iOS/CLI, Web Worker on Web) | Yes (inherits `three-author` JIT compiler plus `userData.xr` spatial traits) |
| **Android & iOS runtime** | Google Filament (`FilamentHelper`), Apple RealityKit (`RealityKitHelper`), and `.glb`/`.usdz` export | Native Android (`Filament` + Jetpack XR `SceneCore` + `XRLiveRuntimeSession`) and native iOS/visionOS (`RealityKit` + `XRLiveRealityKitSession`) |
| **Spatial interaction** | Orbit controls, mesh picking, 3D surface hotspots, `KHR_interactivity` | Declarative `userData.xr` traits (`grab`, `scale`, `billboard`, `anchor`, `handles`, `snapTo`, `gaze`, `explode`, `navigable`, `sync`, `audioEmitter`), 15 spatial plugins, 6 `xr-live-sim` simulation plugins, 25-joint hands, and `KHR_interactivity` |
| **Web bundle budget** | **`< 30 KB gz`** (viewer), **`< 72 KB gz`** (`three-live.min.js`) | **`< 54 KB gz`** (viewer), **`< 84 KB gz`** (`xr-live.min.js`), **`< 232 KB gz`** (`xr-live-full.min.js`) |
<!-- mdformat on -->

### HTML attribute compatibility with `<model-viewer>`

On the web, `<three-live>` supports the core HTML attributes used by
[`<model-viewer>`](https://github.com/google/model-viewer) (`src`, `poster`,
`camera-controls`, `camera-orbit`, `camera-target`, `min-camera-orbit`,
`max-camera-orbit`, `field-of-view`, `auto-rotate`, `auto-rotate-delay`,
`rotation-per-second`, `ar`, `ar-modes`, `ar-scale`, `ar-placement`, `exposure`,
`shadow-intensity`, `shadow-softness`, `tone-mapping`, `environment-image`,
`skybox-image`, `autoplay`, `animation-name`, `variant-name`, and
`slot="hotspot-*"`).

If you have existing `<model-viewer>` HTML markup and want to add procedural
Three.js scripts, native Android/iOS runtime targets, or CLI/MCP scene
validation without renaming tags, call `ThreeLiveElement.defineModelViewer()`
(or `defineModelViewer()`) to register `<three-live>` under the `<model-viewer>`
custom element name when `@google/model-viewer` is not loaded.

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Dimension | [`<model-viewer>`](https://github.com/google/model-viewer) | `<three-live>` / `<xr-live>` |
| :--- | :--- | :--- |
| **Primary focus** | Displaying pre-authored `.glb` and `.gltf` 3D assets on the web and launching mobile AR (`Scene Viewer`, `WebXR`, `Quick Look`). | Compiling and running procedural Three.js scripts, parametric CAD/CSG, and `.glb` / `.usdz` / `.spz` scenes across **Android, iOS/visionOS, and Web**. |
| **Scene inputs** | Static `.glb` and `.gltf` files. | Static `.glb`, `.usdz`, and `.spz` files, plus inline or external `THREE.Scene` scripts (`type="text/three"` or `.js`) compiled in a worker/iframe sandbox or Rust VM. |
| **Target platforms** | Web Custom Element (`<model-viewer>`). | Native **Android** SDK (`ThreeCompiler` JNI + Google Filament / Jetpack XR), native **iOS / visionOS** SDK (`ThreeCompiler` XCFramework + RealityKit), **Rust CLI / MCP server** (`three-live-cli`), and **Web** Custom Elements (`<three-live>`, `<xr-live>`). |
| **Post-processing & effects** | Provided via the companion `@google/model-viewer-effects` package (`<effect-composer>`, `<bloom-effect>`, `<outline-effect>`). | Built-in HTML attributes (`bloom`, `bloom-threshold`, `bloom-radius`, `outline`, `outline-selected`, `outline-color`, `tone-mapping`) with no external effect dependencies. |
| **Interactivity & simulation** | Camera orbit/pan/zoom, animation playback, material variants, hotspots, and scene-graph material API. | Includes the above plus glTF `KHR_interactivity` behavior graphs, declarative `userData.xr` spatial traits (`grab`, `scale`, `anchor`, `snapTo`), and 60 Hz deterministic simulation plugins (`rigid-body`, `character-controller`, `navigation`, `objectives`). |
| **Web bundle size (gzipped)** | Full Three.js renderer + glTF pipeline (~250 KB gz). | Modular tiers: `< 30 KB gz` (`three-live-viewer`), `< 72 KB gz` (`three-live`), `< 136 KB gz` (`three-live-full`), `< 232 KB gz` (`xr-live-full`). |
<!-- mdformat on -->

### Modular plugins across Android, iOS, and Web

Every capability works on both prebuilt `.glb`, `.usdz`, and `.spz` assets and
live Three.js scenes:

*   **Compact core (`< 30 KB` to `< 84 KB gz` on Web):** The 3D viewer
    (`three-live-viewer.min.js`) is `< 30 KB gz` (`< 72 KB gz` with the live
    Three.js compiler in `three-live.min.js`), and the WebXR viewer
    (`xr-live-viewer.min.js`) is `< 54 KB gz` (`< 84 KB gz` with the live
    Three.js compiler in `xr-live.min.js`).
*   **Core 3D, CAD, procedural, and animation plugins (`three-live`, 16 plugins):** Optional
    domain bundles (`three-live-studio.min.js` at `< 29 KB gz`,
    `three-live-cad.min.js` at `< 10 KB gz`, `three-live-procedural.min.js` at
    `< 22 KB gz`, and `three-live-animation.min.js`
    at `< 11 KB gz`, or `< 136 KB gz` combined in `three-live-full.min.js`) add
    `KHR_interactivity` behavior graphs, PBR Next materials,
    `KHR_materials_variants`, `EXT_meshopt_compression`, HDRI and
    spherical-harmonics lighting, contact shadows, 3D hotspots, post-processing
    (`bloom` and `outline`), automatic multi-tier Level-of-Detail (`lod` /
    `THREE.LOD` / `MSFT_lod`), 2D `Shape`/`ExtrudeGeometry`, 3D `CSG` Booleans,
    3D vector `TextGeometry`, 64-joint GPU skeletal skinning, morph targets,
    keyframe cross-fading, and two-bone / FABRIK inverse kinematics (`ik`).
*   **Hardware XR sensors (`xr-live-sensors.min.js`, `< 10 KB gz`):** Adds
    hardware XR depth occlusion (`XRDepthManager`), analytical heightfield
    physics (`XRHeightfieldPhysics`), 25-joint hand gesture classification
    (`XRHandGestureClassifier`), the desktop 6DoF keyboard/mouse simulator
    (`XRDesktopSimulator`), HRTF spatial audio earcons, and WebMCP agent tools.
*   **Spatial computing plugins (`xr-live-spatial.min.js`, 15 plugins,
    `< 63 KB gz`):** Each advanced spatial capability in
    `xr-live-spatial.min.js` is a standalone, zero-dependency plugin
    (`~2 to 5 KB gz` each) with a matching native implementation in the Android
    and iOS SDKs.
*   **Simulation and scenario plugins (`xr-live-sim.min.js`, 6 plugins,
    `< 26 KB gz`):** Six plugins for games, training drills, and safety
    walkthroughs add a controllable character, autonomous steering agents,
    deterministic 60 Hz rigid-body physics (`rigid-body`), integrity and trigger
    zones, checklist objectives with scoring and timers, and procedural audio
    cues across Android, iOS, and Web.

#### Core 3D, CAD, and animation plugins (`three-live`)

The following table lists the fifteen modular 3D, CAD, and animation plugins:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Plugin | Attribute or Three.js API | What it adds |
| :--- | :--- | :--- |
| **`interactivity`** | `userData.interactivity`, `KHR_interactivity` | Compiles and executes glTF `KHR_interactivity` behavior graphs (`onSelect`, `onHoverIn`, `onStart`, `toggleTransform`, `interpolate`, `cycleMaterialColor`, and `sendEvent`) with step and tween budgets. |
| **`materials`** | `MeshPhysicalMaterial`, `variant-name` | PBR Next material properties (`clearcoat`, `transmission`, `ior`, `thickness`, `attenuationColor`, `sheen`, `iridescence`, and `anisotropy`). |
| **`variants`** | `variant-name`, `userData.variants` | `KHR_materials_variants` multi-colorway configurators and USDZ `VariantSet` export. |
| **`meshopt`** | `EXT_meshopt_compression` | Zero-WASM decoder and encoder for `EXT_meshopt_compression` vertex, index, and animation buffers (`OCTAHEDRAL`, `QUATERNION`, `EXPONENTIAL`). |
| **`envmap`** | `environment-image`, `skybox-image`, `exposure` | Procedural studio environment lighting, HDRI skyboxes, and 9-band spherical-harmonics diffuse irradiance. |
| **`shadows`** | `shadow-intensity`, `shadow-softness` | Soft ground-plane contact shadows and dynamic shadow-map updates matching scene bounds. |
| **`hotspots`** | `slot="hotspot-*"`, `data-position`, `data-normal` | 3D surface-anchored annotations with normal-facing visibility culling and SVG leader lines. |
| **`webxr`** | `ar`, `ar-modes`, `ar-scale`, `ar-placement` | Zero-server runtime `.glb` and `.usdz` packaging for 1-tap mobile AR handoff across Android Scene Viewer, iOS Quick Look, and WebXR. |
| **`postprocessing`** | `bloom`, `outline`, `tone-mapping`, `xr.bloom`, `xr.outline` | Dual-Kawase mipmap bloom, selection/hover silhouette outlines, and `neutral`, `aces`, `agx`, `reinhard`, and `none` tone mapping. |
| **`lod`** | `THREE.LOD`, `xr.lod`, `MSFT_lod` | Distance-based multi-tier Level-of-Detail switching with hysteresis, far-distance culling, automatic vertex-clustering mesh decimation (`decimateGeometry`), and `MSFT_lod` / `KHR_node_visibility` export. |
| **`cad`** | `THREE.Shape`, `THREE.ExtrudeGeometry`, `THREE.CSG`, `THREE.TextGeometry` | 2D `Path`/`Shape` with ear-clipping hole triangulation, `ExtrudeGeometry` with beveling, 3D BSP `CSG` Booleans (`union`, `subtract`, `intersect`), and stroke-font `TextGeometry`. |
| **`procedural`** | `THREE.Box3`, `THREE.Sphere`, `THREE.CanvasTexture` | Extended 3D bounding-volume helpers (`Box3`, `Sphere`, `setFromObject`, `expandByObject`, `InstancedMesh` bounds), `CanvasTexture` with a zero-DOM headless 2D `<canvas>` rasterizer (`document.createElement('canvas').getContext('2d')`), and procedural authoring utilities. |
| **`skinning`** | `animation-name`, `autoplay` | 64-joint GPU vertex skinning and skeletal hierarchy evaluation. |
| **`morph`** | `morphTargetInfluences` | GPU morph-target vertex displacement and weight blending. |
| **`keyframes`** | `animationCrossfadeDuration` | Linear, step, and cubic-spline (`CUBICSPLINE`) TRS keyframe interpolation with smooth clip cross-fading. |
| **`ik`** | `THREE.IKSolver`, `xr.ik` | Analytic two-bone (arm/leg with pole vector) and multi-joint FABRIK inverse kinematics chains. |
<!-- mdformat on -->

#### Spatial perception, splat, audio, and multimodal AI plugins (`xr-live`)

The following table lists the eight perception, rendering, audio, and AI plugins
across Android Filament, iOS RealityKit, and WebXR:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Plugin | Attribute or `userData.xr` trait | What it adds across Android Filament, iOS RealityKit, and WebXR |
| :--- | :--- | :--- |
| **`head-follow`** | `xr.follow`, `xr.orbit` | Lazy HUD head or hand follow with an angular deadzone and critically damped spring, plus 3D satellite orbits. |
| **`manipulation-handles`** | `xr.handles` | Four top-corner uniform scale handles and a bottom pedestal yaw-rotation bar that emit `xr-handles-change` events. |
| **`world-understanding`** | `world-understanding="planes reticle"` | Real-world plane and mesh tracking, surface-normal gaze reticle, `XRTapeMeasure`, and 2D-to-3D bounding-box unprojection (`detectObjects`). |
| **`gemini-live`** | `connectGeminiLive()`, `xr.holdToAsk` | Real-time bidirectional WebSocket vision and 16/24 kHz PCM voice streaming, barge-in cancellation, live transcription, and press-and-hold mesh queries. |
| **`spatial-paint`** | `spatial-paint="#38bdf8"` | Pinch-to-paint 3D Catmull-Rom spline strokes extruded as twist-free parallel-transport tubes with `undo()` and `clear()`. |
| **`depth-particles`** | `xr.particles` | GPU-friendly `rain`, `snow`, `sparks`, and `confetti` emitters (up to 2,000 particles per emitter) that collide with floors and real-world depth maps. |
| **`splat-loader`** | `xr.splatUrl`, `allow-remote-splats` | Streams `.splat` and `.spz` (v2 and v3) 3D Gaussian Splats (up to 1,000,000 splats) with per-frame 16-bit counting sort. |
| **`spatial-audio`** | `xr.audioEmitter`, `xr.audio`, `KHR_audio_emitter` | 3D positional and directional spatial audio emitters with 8 zero-asset ambient loop presets (`hum`, `reactor`, `wind`, `beacon`, `geiger`, `chimeLoop`, `machinery`, `water`), `inverse`/`linear`/`exponential` distance falloff, directional cones, and `KHR_audio_emitter` / USDZ `SpatialAudio` export. |
<!-- mdformat on -->

#### CAD review, spatial layout, locomotion, and co-presence plugins (`xr-live`)

The following table lists the seven CAD, layout, locomotion, and multi-user
plugins across Android Filament, iOS RealityKit, and WebXR:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Plugin | Attribute or `userData.xr` trait | What it adds across Android Filament, iOS RealityKit, and WebXR |
| :--- | :--- | :--- |
| **`spatial-measure`** | `spatial-measure="bounds\|tape\|all"`, `xr.dimensions` | Live `W × H × D` bounding-box dimension callout bars with 3D vector-glyph labels (`m`, `cm`, `mm`, `in`, and `ft-in`) and point-to-point AR tape measure. |
| **`magnetic-snap`** | `magnetic-snap`, `xr.snapTo`, `xr.snapSocket` | Magnetic socket snapping with `1.25×` breakaway hysteresis and pulsing preview rings, plus Cartesian grid, yaw angle, and surface snapping. |
| **`gaze-dwell`** | `gaze-dwell`, `xr.gaze` | Hands-free eye and head gaze raycasting with EMA smoothing, `1.5°` micro-saccade grace cone, and radial dwell progress ring (`select` or `ask`). |
| **`exploded-view`** | `explode="0..1"`, `section-plane`, `xr.explode` | Multi-part CAD assembly explosion with staggered layers, dashed leader lines, two-hand spread gesture, and GPU cross-section slicer. |
| **`persistent-anchors`** | `persistent-anchors`, `persist-url-hash`, `xr.anchor.persist` | Three-tier pose persistence across reloads and sessions via shareable `#xr-state=<base64url>` URLs, `localStorage`, and native anchors. |
| **`spatial-locomotion`** | `locomotion="teleport snap-turn"`, `xr.navigable` | Ballistic parabolic teleport arc with walkable and blocked surface validation, thumbstick snap-turn or smooth glide, and a `120ms` FOV comfort vignette. |
| **`shared-room`** | `shared-room="<id>\|wss://..."`, `xr.sync` | Zero-dependency multi-user co-presence (`20 Hz` quantized avatars and laser rays, optimistic grab locks with deterministic tie-breaking, and synced explode and paint). |
<!-- mdformat on -->

#### Interactive simulation, agent, and scenario plugins (`xr-live-sim`)

The following table lists the six simulation plugins across Android Filament,
iOS RealityKit, and Web:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Plugin | Attribute or `userData.xr` trait | What it adds across Android Filament, iOS RealityKit, and Web |
| :--- | :--- | :--- |
| **`character-controller`** | `character-controller`, `xr.character` | Capsule kinematics with floor and slope stepping, jump with coyote time, keyboard, gamepad, and touch-joystick input, and `third-person`, `first-person`, `top-down`, or `fixed-camera` rig follow. |
| **`steering-agents`** | `steering-agents`, `xr.agent` | Autonomous kinematic agents (`patrol`, `chase`, `flee`, `follow`, and `wander`) with vision-cone target acquisition, obstacle avoidance, and `agentstatechange` and `agentreach` events. |
| **`rigid-body`** | `xr.physics`, `xr.rigidBody` | Deterministic 60 Hz Sequential Impulse rigid-body solver (`dynamic`, `static`, `kinematic`; `box`, `sphere`, `cylinder`, `auto`; `mass`, `restitution`, `friction`, damping, sleeping, and `xrcollision` / `xrsleep` events) plus USDZ `PhysicsRigidBodyAPI` / `PhysicsMassAPI`. |
| **`hit-zones`** | `hit-zones`, `xr.integrity`, `xr.zone`, `xr.spawner` | Part and target `integrity` with world-space bars, hit flashes, `projectile`, `hitscan`, and `contact` interactions, burst fragments, colored trigger `zone` volumes, and timed template `spawner` pooling. |
| **`objectives`** | `objectives`, `scenario-timer`, `target-score`, `attempts`, `xr.objective` | Ordered or unordered checklist objectives (`reach`, `clear`, `collect`, `activate`, and `hold`), score, attempt counter, countdown timer, HUD overlay (`sim-hud`), and `scenario-reset-key` resets. |
| **`synth-audio`** | `synth-audio`, `synth-volume`, `xr.audioCues` | Zero-asset procedural audio synthesis (`beep`, `chime`, `buzz`, `thud`, `sweep`, `click`, `alarm`, and `whoosh`) bound to simulation events via Android `AudioTrack`, iOS `AVAudioEngine`, and Web Audio. |
<!-- mdformat on -->

### JavaScript bundles and enforced size budgets (Web)

Every web bundle targets `es2020`, strips full license blocks
(`--legal-comments=none`), and emits a single four-line SPDX header:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Family | Bundle file | Enforced budget (`.min.js.gz`) | Included capabilities |
| :--------------- | :-------------------------------- | :------------: | :-------------------------- |
| **`three-live`** | **`three-live-viewer.min.js`** | **`< 30 KB gz`** | Lean `.glb` and `.usdz` WebGL2 PBR viewer, TRS animations, orbit controls, and AR packager. |
|  | **`three-live.min.js`** | **`< 72 KB gz`** | Standard `<three-live>` + **`three-author`** (live Three.js compiler, `InstancedMesh` GPU instancing, `KHR_interactivity` compiler, 5 tone-mapping modes, contact shadows) + AR packager. |
|  | **`three-live-studio.min.js`** | **`< 29 KB gz`** | Add-on plugin: PBR Next extensions, HDRI and SH irradiance, `bloom`/`outline` post-processing, `KHR_materials_variants`, `EXT_meshopt_compression`, `KHR_interactivity` VM, `lod` (`THREE.LOD` / `MSFT_lod`), 3D hotspots, and WebXR AR. |
|  | **`three-live-cad.min.js`** | **`< 10 KB gz`** | Add-on plugin: 2D `Path`/`Shape` with ear-clipping hole triangulation, `ExtrudeGeometry` with beveling, 3D `CSG` BSP Booleans (`union`, `subtract`, `intersect`), and 3D stroke-font `TextGeometry`. |
|  | **`three-live-procedural.min.js`** | **`< 22 KB gz`** | Add-on plugin: `Box3` & `Sphere` bounding-volume helpers, `CanvasTexture` + headless 2D `<canvas>` rasterizer, and procedural authoring utilities. |
|  | **`three-live-animation.min.js`** | **`< 11 KB gz`** | Add-on plugin: 64-joint GPU skeletal skinning, morph targets, animation cross-fading, and two-bone / FABRIK inverse kinematics (`ik` / `THREE.IKSolver`). |
|  | **`three-live-full.min.js`** | **`< 136 KB gz`** | All-in-one 3D bundle (`three-live` + `studio` + `cad` + `procedural` + `animation`, all 16 plugins auto-registered). |
| **`xr-live`** | **`xr-live-viewer.min.js`** | **`< 54 KB gz`** | Lean `.glb` and `.usdz` WebXR viewer + spatial traits (`grab`, `scale`, `billboard`, `anchor`), `<div slot="spatial">`, and mobile AR bridge. |
|  | **`xr-live.min.js`** | **`< 84 KB gz`** | Standard `<xr-live>` + **`three-author`** (live Three.js compiler) + runtime USDZ and GLB compiler. |
|  | **`xr-live-sensors.min.js`** | **`< 10 KB gz`** | Add-on plugin: Hardware XR sensors (`XRDepthManager`, `XRHeightfieldPhysics`, 25-joint `XRHandGestureClassifier`), `XRDesktopSimulator`, Spatial Audio, Skybox, and WebMCP tools. |
|  | **`xr-live-spatial.min.js`** | **`< 63 KB gz`** | Add-on plugin bundle registering all 15 spatial plugins (`head-follow`, `manipulation-handles`, `world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`, `exploded-view`, `persistent-anchors`, `spatial-locomotion`, `shared-room`, `spatial-audio`). |
|  | **`xr-live-sim.min.js`** | **`< 26 KB gz`** | Add-on simulation plugin bundle registering all six simulation plugins (`character-controller`, `steering-agents`, `rigid-body`, `hit-zones`, `objectives`, `synth-audio`). |
|  | **`xr-live-full.min.js`** | **`< 232 KB gz`** | All-in-one 3D, XR, and simulation bundle (`three-live-full` + `xr-live` + `xr-live-sensors` + all 15 spatial plugins + all 6 simulation plugins). |
<!-- mdformat on -->

### Safe execution for live, AI-generated Three.js

Because LLMs already know Three.js, an agent or backend can generate a complete
interactive 3D or XR scene in 15 to 30 lines of JavaScript without external
binary assets. Three-Live executes Three.js scripts inside a sandboxed Rust
`Boa`/QuickJS VM on Android and iOS, and inside a dedicated Web Worker or
opaque-origin `<iframe sandbox="allow-scripts">` (`connect-src 'none'`) on the
web—with network and storage globals removed, `Object.prototype` frozen, CPU
instruction fuel limits, and scene geometry memory quotas.

---

## Project status

Three-Live is in **Beta**. Its core 3D, mobile AR/XR, and spatial computing
runtime, versioned `userData.xr` trait schema (`schemaVersion: 1`), sandboxed
JIT compiler, and three-target parity across Android XR, Apple RealityKit, and
Web are feature-complete and ready for integration and evaluation.

*   **Prebuilt distributions:** The Android release AAR
    (`three-live-compiler-release.aar`), the Apple XCFramework
    (`ThreeLiveCompiler.xcframework.zip`), native `three-live-cli` binaries for
    macOS, Linux, and Windows, and standalone web JavaScript bundles
    (`three-live-web-dist.zip`) are published on
    **[GitHub Releases](https://github.com/google/three-live/releases)**.
*   **Package registries:** Published on **JitPack / GitHub Packages Maven**,
    **Swift Package Manager**,
    **[Crates.io (`three-live-compiler`)](https://crates.io/crates/three-live-compiler)**,
    **[npm (`three-live`)](https://www.npmjs.com/package/three-live)**,
    **[npm (`xr-live`)](https://www.npmjs.com/package/xr-live)**, **GitHub
    Releases**, and the **jsDelivr / GitHub Pages CDNs** (see
    [Install packages and bundles](#install-packages-and-bundles)).
*   **Release notes:** See [`CHANGELOG.md`](CHANGELOG.md) for release history
    and architectural notes.

--------------------------------------------------------------------------------

## Documentation guide

The following guides cover the native mobile SDKs, spatial plugins, web
components, and LLM authoring workflows:

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| Guide | Audience | Contents |
| :--------------------------------------------- | :------- | :------- |
| **[`docs/xr-live.md`](docs/xr-live.md)** | Android, iOS, and XR developers | Complete spatial and native SDK guide: Android (`Filament` + Jetpack XR `SceneCore`), iOS/visionOS (`RealityKit`), canonical `userData.xr` traits, all 15 spatial plugins, the six `xr-live-sim` simulation plugins, depth and physics, 25-joint hands, and WebMCP. |
| **[`docs/three-live.md`](docs/three-live.md)** | Mobile and web developers | Complete 3D reference: Three.js authoring, `KHR_interactivity`, PBR Next and HDRI, CAD/CSG/Text, animations, 3D hotspots, and sandboxing. |
| **[`docs/cookbook.md`](docs/cookbook.md)** | All developers | Copy-pasteable Three.js recipes for e-commerce configurators, precision manipulation handles, Gemini Live spatial assistants, 3D spatial paint, CAD exploded views and measurements, magnetic snapping and persistent anchors, multi-user co-presence, and interactive training and simulation drills (`xr-live-sim`). |
| **[`docs/llm-guide.md`](docs/llm-guide.md)** | LLMs and agents | Copy-paste system prompt snippet, canonical `userData.xr` and `userData.interactivity` schemas, strict `THREE.*` allowlist, scene quotas, and few-shot templates. |
| **[`AGENTS.md`](AGENTS.md)** | Coding agents | Repository rules, three-target cross-platform parity contract, build and test commands, bundle budgets, and security invariants. |
| **[`skills/`](skills/)** | Agent skills | Progressive-disclosure `SKILL.md` skills for authoring scenes ([`three-live-authoring`](skills/three-live-authoring/SKILL.md)) and developing plugins ([`xr-live-plugin-dev`](skills/xr-live-plugin-dev/SKILL.md)). |
| **[`llms.txt`](llms.txt) and [`llms-full.txt`](llms-full.txt)** | LLM context feeds | Single-file concise index (`llms.txt`) and complete concatenated reference (`llms-full.txt`) for LLM context windows. |
| **[`CHANGELOG.md`](CHANGELOG.md)** | All users | Release notes and architectural summary for Three-Live releases. |
<!-- mdformat on -->

---

## Build and run demos

Run `make` (or `make help`) from the repository root to build packages, run tests, or open the interactive studio demos:

```bash
$ make doctor        # Check installed toolchains (Android NDK, Xcode, Rust, Node)
$ make android-demo  # Build JNI .so slices and debug Compose APK, and open Android Studio
$ make ios-demo      # Build XCFramework, generate .xcodeproj, and open in Xcode (macOS)
$ make test          # Run full Android, iOS, Rust compiler, and Web parity test suites
$ make web           # Compile all <three-live> and <xr-live> JS bundles and embedded engine
$ make web-demo      # Launch web playgrounds at http://localhost:8888/three/ and /xr/
```

---

## Security

Untrusted client Three.js script execution is disabled by default on the web
(`allow-client-scripts` required) and always runs inside an isolated QuickJS/Boa
VM on Android and iOS or a sandboxed Worker / opaque-origin `<iframe>`
(`connect-src 'none'`) on Web—with network and storage globals stripped,
`Object.prototype` frozen, CPU instruction fuel limits, and geometry memory
quotas.

To report a vulnerability, please follow the instructions in
[`SECURITY.md`](SECURITY.md).

## Contributing

Contributions are welcome! Please read [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) before submitting a pull request.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
