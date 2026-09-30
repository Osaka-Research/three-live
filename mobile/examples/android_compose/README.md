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

# Three-Live Android Live Compiler & AR Studio (Jetpack Compose + Google Filament + ARCore)

A complete, turnkey native Android sample application demonstrating on-device
compilation of Three.js JavaScript into binary glTF 2.0 (GLB) with zero memory
copies, rendered interactively using Google Filament in 3D and Google ARCore
Scene Viewer in AR.

## Features

- **Live Code Editor**: Interactive Jetpack Compose monospace text area allowing developers to write, edit, or paste arbitrary Three.js scene scripts directly on Android devices.
-   **Unified Preset Gallery**: One-tap scene presets matching Web and iOS
    (`Quantum Core`, `Torus Knot`, `Emerald Crystal`, `Orbital Spheres`).
- **Sub-Millisecond Rust Compiler**: Embedded `libthree_live_compiler.so` compiled via Rust NDK.
- **Zero-Copy JNI Buffer**: Allocates `.glb` wire bytes in native Rust memory and maps directly to a Java `DirectByteBuffer` (`GlbBuffer`), eliminating GC memory pressure and copies.
- **Google Filament 3D Viewport**: Real-time PBR rendering with camera orbit and dynamic lighting.
-   **Google ARCore Scene Viewer (`View in AR`)**: Exports the compiled GLB via
    `FileProvider` (`SceneViewerHelper.kt`) and launches full-screen Google
    ARCore Scene Viewer (`ar_preferred` mode) to place models onto real-world
    surfaces.

## Quickstart

### 1. Build the Native Compiler AAR

From repository root:

```bash
bash scripts/build_android_aar.sh
```

### 2. Open in Android Studio

1. Open Android Studio (Hedgehog or newer).
2. Select **Open** and choose `mobile/examples/android_compose`.
3. Sync Gradle and click **Run** (on physical device or x86_64 emulator with GLES 3.0+).
