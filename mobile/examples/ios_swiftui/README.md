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

# Three-Live iOS Live Compiler & AR Studio (SwiftUI + RealityKit)

A complete native sample application demonstrating on-device compilation of
Three.js JavaScript into Apple USDZ (and glTF 2.0 GLB) with zero memory copies,
rendered interactively using Apple RealityKit in 3D and full-screen Apple AR
Quick Look. The demo target builds for iOS and iPadOS; the underlying
`ThreeLiveCompiler` package also supports visionOS, tvOS, and macOS.

## What the Demo Does

1. **Interactive 3D Viewport (Non-AR Mode)**:
   - Top section displays a pure Metal-accelerated 3D viewport powered by RealityKit (`ARView` in `.nonAR` mode with custom perspective camera and studio lighting).
   - Supports touch/pinch drag gestures for smooth 360° orbital rotation across pitch and yaw.
2. **Real-Time HUD Metrics**:
   - Floating status pill displays sub-millisecond compilation latency and compiled USDZ payload size (e.g. `Compiled in 11.40 ms • 123486 B USDZ`).
3.  **Unified Preset Scene Gallery**:
    -   Segmented control toggles between ready-to-run procedural scenes shared
        across Web, Android, and iOS:
        -   **Quantum Core**: Multi-part sci-fi core with tilted torus orbit
            rings, satellite sensor arrays, and pedestal base.
        -   **Torus Knot**: High-density procedural ruby metallic torus knot.
        -   **Emerald Crystal**: Six-sided hexagonal crystal gem with metallic
            luster.
        -   **Orbital Spheres**: Five procedural metallic spheres arranged in a
            trigonometric ring.
4. **On-Device Code Editor**:
   - Full monospace `TextEditor` allowing developers to write, edit, or paste arbitrary Three.js scripts on device.
5. **Two-Button Action Bar**:
   - **Compile & Render (Blue)**: Runs `ThreeCompiler.compileUSDZ` on a background thread and streams the 64-byte aligned USDZ bytes directly into RealityKit via `RealityKitHelper.loadEntity(fromUSDZ:)`.
   - **View in AR (Green with ARKit icon)**: Launches native full-screen Apple AR Quick Look (`QuickLookHelper.presentAR`) to place the procedural model into the real world with horizontal/vertical surface snapping and environmental lighting.

## Architecture

- **Sub-Millisecond In-Process Compiler**: Embedded `libthree_live_compiler.a` universal binary (Rust + Boa + `three-convert.ts` with native SIMD/CRC32 hooks).
- **Zero-Copy ARC Bridge**: Allocates USDZ wire bytes in native heap and transfers ownership directly to Swift `Data(bytesNoCopy:count:deallocator:)` with automatic deallocation via `three_live_free_buffer`.
- **Apple 64-Byte Payload Alignment**: Output USDZ ZIP archives meet RealityKit's memory-mapped I/O requirements (`offset % 64 == 0`).
-   **Off-Pool Compilation**: The native compiler blocks for the duration of a
    compile, so it runs on a dedicated serial queue rather than Swift
    Concurrency's cooperative thread pool.

## Quickstart

macOS with Xcode 15 or newer is required.

### 1. Build the native compiler XCFramework

From the repository root:

```bash
npm ci && npm run build          # generates the embedded JS engine asset
bash scripts/build_ios_xcframework.sh
```

### 2. Generate the Xcode project

The `.xcodeproj` is generated from [`project.yml`](project.yml) rather than
committed, so that a single reviewable file remains the source of truth for the
app's configuration:

```bash
brew install xcodegen
cd mobile/examples/ios_swiftui
xcodegen generate
```

### 3. Run

```bash
open ThreeLiveDemo.xcodeproj
```

Select an iOS Simulator or a physical device and press **Run** (`Cmd+R`).

> **Note on AR mode.** "View in AR" uses Apple AR Quick Look, which needs the
> device camera and therefore an `NSCameraUsageDescription` purpose string. That
> string is declared in `project.yml` and generated into `Info.plist`. AR
> placement requires a physical device; the simulator can display the model but
> cannot place it in the world.

## Platform Support

This demo targets iOS and iPadOS. The `ThreeLiveCompiler` package itself
additionally supports visionOS, tvOS, and macOS — see
[`mobile/ios/README.md`](../../ios/README.md) for the full matrix.
