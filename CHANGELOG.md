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

# Changelog

All notable changes to **Three-Live** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.0.0] - 2026-10-06 (Developer Preview)

Initial public **Developer Preview** release of **Three-Live**: an AI-first, multi-platform 3D and spatial computing library with an on-device JIT compiler that turns live, AI-generated Three.js scripts into native **Android Filament & Jetpack XR SceneCore**, **iOS/visionOS RealityKit & Quick Look**, and **WebGL2 / WebXR**.

### Added

- **`<three-live>` Web Component (`three-live`):**
  - Drop-in `<model-viewer>`-compatible custom element supporting `.glb` / `.usdz` assets and inline procedural `<script type="text/three">` compilation.
  - Strictly enforced gzipped bundle budgets: `three-live-viewer.min.js` (`< 24 KB gz`), `three-live.min.js` (`< 48 KB gz`), and `three-live-full.min.js` (`< 58 KB gz`).
  - Modular add-on plugins for PBR Next material extensions (`clearcoat`, `transmission`, `sheen`, `iridescence`, `anisotropy`), procedural studio HDRI & spherical harmonics irradiance, baked contact shadows, 3D surface hotspots, and 64-joint GPU skeletal skinning & morph targets.
  - Built-in runtime binary `.glb` and uncompressed `.usdz` packagers for zero-server 1-tap mobile AR handoff to Apple Quick Look and Android Scene Viewer.

- **`<xr-live>` Spatial Computing Suite (`xr-live`):**
  - Extends `<three-live>` with declarative 6DoF WebXR spatial traits (`grab`, `scale`, `billboard`, `anchor`) via `<xr-anchor>` and procedural `userData.xrTraits`.
  - Live raycastable 3D HTML UI cards via `<div slot="spatial">`.
  - Deep XR add-on (`xr-live-extras.min.js`): `XRDepthManager` real-world depth occlusion, `XRHeightfieldPhysics` rigid-body ballistics, 25-joint `XRHandGestureClassifier` (`pinch`, `poke`, `palm-up`), `XRDesktopSimulator` for headset-free keyboard/mouse testing, spatial Web Audio, and WebMCP agent tools.

- **Two-Tier Web Sandbox & Security Architecture:**
  - **Tier 1 (Default):** Isolated Web Worker execution (`buildSandboxWorkerSource`) with network/storage primitives stripped, `Object.prototype` frozen, and strict per-frame execution time and geometry quotas (`SceneQuotaValidator`).
  - **Tier 2 (`sandbox="iframe"`):** Opaque-origin `<iframe sandbox="allow-scripts">` (`three-live-sandbox.html`) with a strict `connect-src 'none'` Content Security Policy and W3C Trusted Types support.

- **Native Rust/QuickJS JIT Compiler (`compiler/` & `three-live-cli`):**
  - Embedded deterministic QuickJS engine (`rquickjs`) executing procedural Three.js scripts in-process on mobile and desktop without a browser or Node.js runtime.
  - Hardened resource limits (memory ceiling, interrupt handler timeout, stack limit, and vertex/triangle/material quotas) and panic-safe C FFI / Android JNI boundaries (`catch_unwind`).
  - Standalone `three-live-cli` binary (`three-live-cli convert scene.js -o output.glb`) with prebuilt release binaries for Linux (`x86_64`, `aarch64`), macOS (`arm64`, `x86_64`), and Windows (`x86_64`).

- **Native Android & Apple Mobile SDKs (`mobile/`):**
  - **Android (`com.google.threelive`):** Zero-copy `DirectByteBuffer` JNI bridge for **Google Filament** (`FilamentHelper`), **Android Scene Viewer** AR launcher, **Jetpack XR `SceneCore`** trait hydration (`XRLiveSceneCoreHelper`), and a Jetpack Compose demo app (`mobile/examples/android_compose`).
  - **iOS, macOS, visionOS & tvOS (`ThreeLiveCompiler`):** Swift Package Manager library and prebuilt `ThreeLiveCompiler.xcframework` with async `RealityKit` `Entity` loading (`RealityKitHelper`), `ARQuickLook` presentation (`QuickLookHelper`), spatial trait gesture installation (`XRLiveRealityKit`), and a SwiftUI demo app (`mobile/examples/ios_swiftui`).
