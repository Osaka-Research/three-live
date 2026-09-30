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

# Three-Live iOS, visionOS, tvOS & macOS Swift Package

Native Swift bindings and C-ABI bridge for `three-live-compiler`.

## Platforms

Platform | Minimum | `ThreeCompiler` | `RealityKitHelper` | `QuickLookHelper`
-------- | ------- | :-------------: | :----------------: | :---------------:
iOS      | 15.0    | ✅               | ✅                  | ✅
visionOS | 1.0     | ✅               | ✅                  | ✅
macOS    | 12.0    | ✅               | ✅                  | —
tvOS     | 15.0    | ✅               | —                  | —

`RealityKitHelper` is excluded on tvOS because RealityKit's `Entity` loading
APIs are not available there below tvOS 26, and `QuickLookHelper` requires UIKit
and QuickLook.

## Installation

### Swift Package Manager (Xcode)

In your `Package.swift` or Xcode Project:

```swift
dependencies: [
    .package(url: "https://github.com/google/three-live.git", from: "1.0.0")
]
```

Add `ThreeLiveCompiler` to your app target:

```swift
.target(
    name: "MyApp",
    dependencies: [
        .product(name: "ThreeLiveCompiler", package: "three-live")
    ]
)
```

> **AR Quick Look requires a camera purpose string.** If your app calls
> `QuickLookHelper.presentAR`, add `NSCameraUsageDescription` to your
> `Info.plist`. AR Quick Look places models using the device camera, and App
> Store review rejects binaries that reach the camera without one.

## Quick Start

### 1. Compile Procedural Scene (Zero-Copy)

```swift
import ThreeLiveCompiler

Task {
    do {
        let script = """
            const g = new THREE.TorusKnotGeometry(0.6, 0.2, 64, 16);
            const m = new THREE.MeshStandardMaterial({ color: 0xff6600, metalness: 0.8 });
            scene.add(new THREE.Mesh(g, m));
        """

        // Runs on a dedicated serial queue, never on Swift Concurrency's cooperative
        // thread pool; wraps the native pointer with zero copies.
        let glbData: Data = try await ThreeCompiler.compile(script)

        print("Compiled GLB data size: \(glbData.count) bytes")
    } catch {
        print("Compilation failed: \(error.localizedDescription)")
    }
}
```

### 2. Stream to Apple RealityKit (3D Viewports)

```swift
import RealityKit
import ThreeLiveCompiler

@MainActor
func setupScene() async {
    do {
        // Compiles directly to USDZ with 64-byte RealityKit memory-alignment
        let entity = try await RealityKitHelper.loadEntity(from: script)
        realityViewContent.add(entity)
    } catch {
        print("Failed to load procedural entity: \(error)")
    }
}
```

### 3. Launch Apple AR Quick Look

```swift
import ThreeLiveCompiler

@MainActor
func openAR(viewController: UIViewController) async {
    do {
        // JIT compiles script to USDZ and launches native Apple AR Quick Look
        try await QuickLookHelper.presentAR(from: viewController, script: script)
    } catch {
        print("AR launch failed: \(error)")
    }
}
```

## Building the XCFramework locally

```bash
bash scripts/build_ios_xcframework.sh
```

Output: `mobile/ios/ThreeLiveCompiler.xcframework` (gitignored).

The framework carries seven slices:

Slice              | Architectures
------------------ | -----------------
iOS device         | `arm64`
iOS simulator      | `arm64`, `x86_64`
macOS              | `arm64`, `x86_64`
visionOS device    | `arm64`
visionOS simulator | `arm64`
tvOS device        | `arm64`
tvOS simulator     | `arm64`

visionOS and tvOS slices are skipped with a warning if the corresponding SDK is
not installed. Set `THREE_LIVE_REQUIRE_ALL_PLATFORMS=1` to make a missing SDK a
hard error; the release workflow does this so a release can never ship a partial
framework.

The build finishes by running `scripts/verify_xcframework.sh`, which asserts
every slice contains a non-stub static library exporting the complete C ABI.

When a local framework is present, `Package.swift` binds to it directly;
otherwise it downloads the release artifact. The release tag and SHA-256 in
`Package.swift` are written automatically by
`scripts/update_spm_binary_target.sh` during the release workflow, which then
verifies the published package by resolving and running it as an external
consumer.

## Keeping the C header in sync

SwiftPM requires the public header inside the `ThreeLiveCompilerC` target, so
the repository carries two copies of it.
`compiler/include/three_live_compiler.h` is canonical:

```bash
bash scripts/sync_c_header.sh          # regenerate the SwiftPM copy
bash scripts/sync_c_header.sh --check  # what CI runs
```
