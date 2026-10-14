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
[![Status: Developer Preview](https://img.shields.io/badge/Status-Developer%20Preview%20(Alpha)-orange.svg)](#project-status-developer-preview)
[![Live Playground](https://img.shields.io/badge/Demo-Live%20Playground-brightgreen.svg)](https://google.github.io/three-live/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

**AI-First Native 3D & AR:** On-device JIT compiler turning live, AI-generated Three.js into native Android Filament, iOS RealityKit, and WebXR.

LLMs excel at generating Three.js code. Three-Live compiles it on-device in a sandbox and renders natively with Google Filament and Scene Viewer on Android, Apple RealityKit and Quick Look on iOS, and WebGL2 and WebXR on Web.

> **Live Interactive Playgrounds (No Build Required):**
> - **[Playground Hub](https://google.github.io/three-live/)** — Launch either studio in your desktop or mobile browser
> - **[`<three-live>` 3D & AR Studio](https://google.github.io/three-live/three/)** — Procedural Three.js editor, PBR inspector, and 1-tap USDZ / GLB / AR export (`< 51 KB gz`)
> - **[`<xr-live>` Spatial Computing Studio](https://google.github.io/three-live/xr/)** — 6DoF WebXR, spatial HTML `<div slot="spatial">` cards, depth physics, and hand tracking (`< 62 KB gz`)

---

## Project Status: Developer Preview

Three-Live is currently in **Developer Preview (Alpha)**. It is an experimental open-source library exploring AI-driven procedural 3D and spatial computing across Web, Android, and Apple platforms.

- **Prebuilt Distributions:** Standalone Web JS bundles (`three-live-web-dist.zip`), the Apple XCFramework (`ThreeLiveCompiler.xcframework.zip`), the Android release AAR (`three-live-compiler-release.aar`), and native `three-live-cli` binaries for macOS, Linux, and Windows are published on **[GitHub Releases](https://github.com/google/three-live/releases)**.
- **Package Registries:** Direct consumption via **Swift Package Manager**, **GitHub Releases**, and **GitHub Pages CDN** works today (see [Installation & JS Bundles](#installation--js-bundles)). Publishing to public package registries (`npm`, `Crates.io`, and Maven) is planned for a future release.
- **Release Notes:** See **[`CHANGELOG.md`](CHANGELOG.md)** for full release history and architectural notes.

---

## `<three-live>` vs. `<xr-live>` at a Glance

| Capability | `<three-live>` | `<xr-live>` (extends `<three-live>`) |
| :---------------------- | :---------------------- | :----------------------- |
| **Primary Use Case** | 3D product viewers, procedural scenes, 1-tap AR handoff | Interactive 6DoF WebXR, spatial UI cards, depth/physics, hand tracking |
| **Procedural `<script type="text/three">`** | Yes (sandboxed Web Worker JIT compiler) | Yes (inherits full `three-author` JIT compiler + `userData.xrTraits`) |
| **Mobile AR / XR** | Universal AR handoff (Quick Look, Scene Viewer, WebXR) | Native Android XR (`SceneCore`), iOS/visionOS (`RealityKit`), & WebXR |
| **Spatial Interaction** | Orbit controls, mesh picking, 3D surface hotspots, `KHR_interactivity` | Declarative traits (`grab`, `scale`, `billboard`, `anchor`) + 25-joint hands + `KHR_interactivity` |
| **Spatial HTML UI** | 2D screen-space overlay hotspots (`slot="hotspot-*"`) | True 3D textured & raycastable HTML cards (`<div slot="spatial">`) |
| **Default Bundle Budget** | **`< 51 KB gz`** (`three-live.min.js`) | **`< 62 KB gz`** (`xr-live.min.js`) / **`< 99 KB gz`** (`xr-live-full.min.js`) |

---

## Quickstarts

### 1. `<three-live>` — 3D Viewer, Procedural Scripting & AR Handoff

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

### 2. `<xr-live>` — Spatial Computing, Traits & Live HTML Cards

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live xr-mode="inline-ar" xr-depth xr-hands xr-simulator camera-controls style="width: 100%; height: 560px; display: block;">
  <xr-anchor name="chair" src="/models/chair.glb" position="0 0 -1.2" data-xr-traits="grab scale anchor"></xr-anchor>

  <div slot="spatial" data-position="0.45 0.9 -1.1" data-xr-traits="grab billboard">
    <div style="padding: 14px; background: #0f172a; color: #fff; border-radius: 12px;">
      <h4>Spatial Product Card</h4>
      <button>Pinch to Interact</button>
    </div>
  </div>
</xr-live>
```

### 3. Android (Kotlin — Google Filament & Jetpack XR SceneCore)

```kotlin
import com.google.threelive.FilamentHelper
import com.google.threelive.XRLiveSceneCoreHelper

// 1. Render zero-copy GLB in Google Filament
val holder = FilamentHelper.loadModelZeroCopy(script) { buffer ->
    assetLoader.createAssetFromBinary(buffer)
}

// 2. Or hydrate interactive spatial traits (grab/scale/billboard/anchor) in Android XR SceneCore
XRLiveSceneCoreHelper.attachTraitsFromGlb(session, entity, glbByteBuffer)
```

### 4. iOS & visionOS (Swift — Apple RealityKit)

```swift
import ThreeLiveCompiler
import RealityKit

@MainActor
func loadSpatialScene(from script: String, into arView: ARView) async throws {
    let entity = try await RealityKitHelper.loadEntity(from: script)
    XRLiveRealityKit.installTraits(on: entity, in: arView)
}
```

### 5. Rust CLI & Library (`three-live-cli`)

```bash
# Compile a procedural Three.js script to a binary GLB file
three-live-cli convert scene.js -o output.glb
```

---

## Installation & JS Bundles

### Package Installation

-   **Web (CDN / Prebuilt Release / Source):**
    -   **Hosted ES Module (`<script>`):**
        ```html
        <script type="module" src="https://google.github.io/three-live/dist/three-live.min.js"></script>
        ```
    -   **Prebuilt Bundle Archive:** Download `three-live-web-dist.zip` from **[GitHub Releases](https://github.com/google/three-live/releases)**.
    -   **From Source:** `git clone https://github.com/google/three-live.git && cd three-live && npm install && npm run build` *(public `npm` registry publishing is planned for a future release)*.
-   **iOS, macOS & visionOS (Swift Package Manager):**
    ```swift
    .package(url: "https://github.com/google/three-live.git", from: "1.0.0")
    ```
    *(Automatically resolves the prebuilt, checksum-pinned `ThreeLiveCompiler.xcframework.zip` from GitHub Releases—no local Rust or Node.js toolchain required).*
-   **Android (Prebuilt Release AAR / Source):**
    -   **Prebuilt AAR:** Download `three-live-compiler-release.aar` (includes `arm64-v8a`, `armeabi-v7a`, and `x86_64` JNI `.so` libraries) from **[GitHub Releases](https://github.com/google/three-live/releases)** into `app/libs/` and add `implementation(files("libs/three-live-compiler-release.aar"))`.
    -   **From Source:** Run `make android` (or `bash scripts/build_android_aar.sh`).
-   **Rust CLI (`three-live-cli`) & Crate:**
    -   **Prebuilt Binaries:** Download standalone binaries for macOS (`arm64` / `x86_64`), Linux (`x86_64` / `aarch64`), and Windows (`x86_64.exe`) from **[GitHub Releases](https://github.com/google/three-live/releases)**.
    -   **From Source:** Run `make rust` (`npm run build && cargo build --manifest-path compiler/Cargo.toml --release --bin three-live-cli`).

### JS Bundles & Enforced Size Budgets (`es2020`, `SPDX-License-Identifier: Apache-2.0`)

Every bundle targets `es2020`, strips full license blocks
(`--legal-comments=none`), and emits a single 4-line SPDX header:

| Family | Bundle File | Enforced Budget (`.min.js.gz`) | Included Capabilities |
| :--------------- | :-------------------------------- | :------------: | :-------------------------- |
| **`three-live`** | **`three-live-viewer.min.js`** | **`< 25.5 KB gz`** | Lean `.glb`/`.usdz` WebGL2 PBR viewer, TRS animations, orbit controls, AR packager. |
|  | **`three-live.min.js`** | **`< 51 KB gz`** | Standard `<three-live>` + **`three-author`** (`<script type="text/three">`, `KHR_interactivity` compiler) + AR packager. |
|  | **`three-live-extras.min.js`** | **`< 17 KB gz`** | Add-on plugin: `KHR_interactivity` VM, PBR Next extensions, HDRI/SH irradiance, dynamic contact shadows, 3D hotspots. |
|  | **`three-live-animation.min.js`** | **`< 6.5 KB gz`** | Add-on plugin: 64-joint GPU skeletal skinning, morph targets, animation cross-fading. |
|  | **`three-live-full.min.js`** | **`< 66 KB gz`** | All-in-one 3D bundle (`three-live` + `extras` + `animation`, all 9 plugins auto-registered). |
| **`xr-live`** | **`xr-live-viewer.min.js`** | **`< 42 KB gz`** | Lean `.glb`/`.usdz` WebXR viewer + spatial traits (`grab`, `scale`, `billboard`, `anchor`), `<div slot="spatial">`, mobile AR bridge. |
|  | **`xr-live.min.js`** | **`< 62 KB gz`** | Standard `<xr-live>` + **`three-author`** (`<script type="text/three">`) + runtime USDZ/GLB compiler. |
|  | **`xr-live-extras.min.js`** | **`< 9.5 KB gz`** | Add-on plugin: Deep XR (`XRDepthManager`, `XRHeightfieldPhysics`, 25-joint `XRHandGestureClassifier`), `XRDesktopSimulator`, Spatial Audio, Skybox, WebMCP tools. |
|  | **`xr-live-full.min.js`** | **`< 99 KB gz`** | All-in-one 3D & XR bundle (`three-live-full` + `xr-live` + `xr-live-extras` + all 7 XR Blocks plugins). |
|  | **`xr-live-blocks.min.js`** | **`< 23.5 KB gz`** | Add-on plugin: XR Blocks (`head-follow`, `manipulation-handles`, `world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`). |

--------------------------------------------------------------------------------

## Documentation Guide (Humans & LLMs)

| Guide                                          | Audience | Contents           |
| :--------------------------------------------- | :------- | :----------------- |
| **[`docs/three-live.md`](docs/three-live.md)** | Web & Mobile Devs | Complete `<three-live>` reference: attributes, `<model-viewer>` drop-in JS API, DOM events, 3D hotspots, PBR Next & HDRI, animations, and sandboxing. |
| **[`docs/xr-live.md`](docs/xr-live.md)** | Spatial & XR Devs | Complete `<xr-live>` & Native Mobile Spatial guide: declarative traits (`grab`, `scale`, `billboard`, `anchor`), spatial DOM cards (`<div slot="spatial">`), depth/physics, 25-joint hand tracking, desktop simulator, and Android XR / RealityKit bridges. |
| **[`docs/llm-guide.md`](docs/llm-guide.md)** | LLMs & Agents | Copy-paste system prompt snippet, strict `THREE.*` allowlist, scene quotas, and zero-hallucination few-shot templates. |
| **[`CHANGELOG.md`](CHANGELOG.md)** | All Users | Release notes and architectural summary for the Developer Preview release. |

---

## Building & Running Demos (`Makefile`)

Run `make` (or `make help`) from the repository root to build packages, run tests, or open the interactive studio demos:

```bash
make doctor        # Check installed toolchains (Node, Rust, Xcode, Android NDK)
make web           # Compile all <three-live> & <xr-live> JS bundles + embedded engine
make web-demo      # Launch Web playgrounds at http://localhost:8888/three/ & /xr/
make test          # Run full Web + Rust compiler + mobile parity test suites
make ios-demo      # Build XCFramework, generate .xcodeproj, and open in Xcode (macOS)
make android-demo  # Build JNI .so slices + debug Compose APK and open Android Studio
```

---

## Repository Structure

```text
three-live/
├── Makefile               # Unified Web, Rust, iOS (Xcode), & Android Studio build targets
├── three-live/            # Core 3D & AR engine + <three-live> Web Component
├── xr-live/               # Spatial Computing & Deep XR SDK + <xr-live> Web Component
├── mobile/                # Native Android (Kotlin/Filament/SceneCore) & iOS (Swift/RealityKit) SDKs
├── compiler/              # In-process Rust procedural Three.js -> GLB/USDZ compiler & CLI
├── docs/                  # Reference documentation for <three-live>, <xr-live>, and LLMs/Agents
├── examples/              # Web & mobile example applications
└── scripts/               # Build and bundle verification scripts
```

---

## Security & License

-   **Security:** See [SECURITY.md](SECURITY.md) for reporting vulnerabilities.
    Eligibility for the [Google Open Source Software Vulnerability Rewards Program](https://bughunters.google.com/open-source-security) is determined by the [Google Open Source Software Vulnerability Reward Program Rules](https://bughunters.google.com/about/rules/open-source/google-open-source-software-vulnerability-reward-program-rules).
-   **License:** Apache 2.0 (see [LICENSE](LICENSE)).
