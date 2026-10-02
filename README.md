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
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![NPM Version](https://img.shields.io/npm/v/three-live.svg)](https://www.npmjs.com/package/three-live)
[![Crates.io](https://img.shields.io/crates/v/three-live-compiler.svg)](https://crates.io/crates/three-live-compiler)

**AI-First Native 3D & AR:** On-device JIT compiler turning live, AI-generated Three.js into native Android Filament, iOS RealityKit, and WebXR.

LLMs excel at generating Three.js code. Three-Live compiles it on-device in a sandbox and renders natively with Google Filament and Scene Viewer on Android, Apple RealityKit and Quick Look on iOS, and WebGL2 and WebXR on Web.

---

## `<three-live>` vs. `<xr-live>` at a Glance

| Capability | `<three-live>` | `<xr-live>` (extends `<three-live>`) |
| :---------------------- | :---------------------- | :----------------------- |
| **Primary Use Case** | 3D product viewers, procedural scenes, 1-tap AR handoff | Interactive 6DoF WebXR, spatial UI cards, depth/physics, hand tracking |
| **Procedural `<script type="text/three">`** | Yes (sandboxed Web Worker JIT compiler) | Yes (inherits full `three-author` JIT compiler + `userData.xrTraits`) |
| **Mobile AR / XR** | Universal AR handoff (Quick Look, Scene Viewer, WebXR) | Native Android XR (`SceneCore`), iOS/visionOS (`RealityKit`), & WebXR |
| **Spatial Interaction** | Orbit controls, mesh picking, 3D surface hotspots | Declarative traits (`grab`, `scale`, `billboard`, `anchor`) + 25-joint hands |
| **Spatial HTML UI** | 2D screen-space overlay hotspots (`slot="hotspot-*"`) | True 3D textured & raycastable HTML cards (`<div slot="spatial">`) |
| **Default Bundle Budget** | **`< 38 KB gz`** (`three-live.min.js`) | **`< 49 KB gz`** (`xr-live.min.js`) / **`< 61 KB gz`** (`xr-live-full.min.js`) |

---

## Quickstarts

### 1. `<three-live>` — 3D Viewer, Procedural Scripting & AR Handoff

```html
<script type="module" src="/dist/three-live.min.js"></script>

<three-live camera-controls ar auto-rotate style="width: 100%; height: 480px; display: block;">
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

-   **Web (npm):** `npm install three-live`
-   **Android (Gradle):**
    `implementation("com.google.threelive:compiler:1.0.0")`
-   **iOS (Swift Package Manager):** `.package(url:
    "https://github.com/google/three-live", from: "1.0.0")`
-   **Rust CLI / Crate:** `cargo install three-live-compiler` / `cargo add
    three-live-compiler`

### JS Bundles & Enforced Size Budgets (`es2020`, `SPDX-License-Identifier: Apache-2.0`)

Every bundle targets `es2020`, strips full license blocks
(`--legal-comments=none`), and emits a single 4-line SPDX header:

| Family | Bundle File | Enforced Budget (`.min.js.gz`) | Included Capabilities |
| :--------------- | :-------------------------------- | :------------: | :-------------------------- |
| **`three-live`** | **`three-live-viewer.min.js`** | **`< 22 KB gz`** | Lean `.glb`/`.usdz` WebGL2 PBR viewer, TRS animations, orbit controls, AR packager. |
|  | **`three-live.min.js`** | **`< 38 KB gz`** | Standard `<three-live>` + **`three-author`** (`<script type="text/three">`) + AR packager. |
|  | **`three-live-extras.min.js`** | **`< 7.5 KB gz`** | Add-on plugin: PBR Next extensions, HDRI/SH irradiance, contact shadows, 3D hotspots. |
|  | **`three-live-animation.min.js`** | **`< 5.5 KB gz`** | Add-on plugin: 64-joint GPU skeletal skinning, morph targets, animation cross-fading. |
|  | **`three-live-full.min.js`** | **`< 48 KB gz`** | All-in-one 3D bundle (`three-live` + `extras` + `animation`, all 8 plugins auto-registered). |
| **`xr-live`** | **`xr-live-viewer.min.js`** | **`< 38 KB gz`** | Lean `.glb`/`.usdz` WebXR viewer + spatial traits (`grab`, `scale`, `billboard`, `anchor`), `<div slot="spatial">`, mobile AR bridge. |
|  | **`xr-live.min.js`** | **`< 49 KB gz`** | Standard `<xr-live>` + **`three-author`** (`<script type="text/three">`) + runtime USDZ/GLB compiler. |
|  | **`xr-live-extras.min.js`** | **`< 7.5 KB gz`** | Add-on plugin: Deep XR (`XRDepthManager`, `XRHeightfieldPhysics`, 25-joint `XRHandGestureClassifier`), `XRDesktopSimulator`, Spatial Audio, Skybox, WebMCP tools. |
|  | **`xr-live-full.min.js`** | **`< 61 KB gz`** | All-in-one 3D & XR bundle (`three-live-full` + `xr-live` + `xr-live-extras`). |

--------------------------------------------------------------------------------

## Documentation Guide (Humans & LLMs)

| Guide                                          | Audience | Contents           |
| :--------------------------------------------- | :------- | :----------------- |
| **[`docs/three-live.md`](docs/three-live.md)** | Web & Mobile Devs | Complete `<three-live>` reference: attributes, `<model-viewer>` drop-in JS API, DOM events, 3D hotspots, PBR Next & HDRI, animations, and sandboxing. |
| **[`docs/xr-live.md`](docs/xr-live.md)** | Spatial & XR Devs | Complete `<xr-live>` & Native Mobile Spatial guide: declarative traits (`grab`, `scale`, `billboard`, `anchor`), spatial DOM cards (`<div slot="spatial">`), depth/physics, 25-joint hand tracking, desktop simulator, and Android XR / RealityKit bridges. |
| **[`docs/llm-guide.md`](docs/llm-guide.md)** | LLMs & Agents | Copy-paste system prompt snippet, strict `THREE.*` allowlist, scene quotas, and zero-hallucination few-shot templates. |

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
-   **License:** Apache 2.0 (see [LICENSE](LICENSE)).
