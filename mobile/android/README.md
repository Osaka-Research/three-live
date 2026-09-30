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

# Three-Live Android Library

Android Kotlin and Java bindings for `three-live-compiler`.

## Installation

### Gradle (Maven Central)

```kotlin
dependencies {
    implementation("com.google.threelive:compiler:1.0.0")
    // If using Google Filament for 3D rendering:
    implementation("com.google.android.filament:filament-android:1.51.0")
    implementation("com.google.android.filament:gltfio-android:1.51.0")
}
```

## Quick Start

### 1. Compile to Direct ByteBuffer (Zero-Copy)

```kotlin
import com.google.threelive.ThreeCompiler

// In your ViewModel or CoroutineScope:
lifecycleScope.launch {
    try {
        val script = """
            const g = new THREE.BoxGeometry(1, 1, 1);
            const m = new THREE.MeshStandardMaterial({ color: 0x3366cc, roughness: 0.2 });
            scene.add(new THREE.Mesh(g, m));
        """.trimIndent()

        // Compiles on Dispatchers.Default and wraps direct native memory
        ThreeCompiler.compile(script).use { glb ->
            // Pass glb.byteBuffer directly to Filament or OpenGL ES without copying!
            assetLoader.createAssetFromBinary(glb.byteBuffer)
        }
    } catch (e: ThreeCompilerException) {
        Log.e("ThreeLive", "Compilation failed: ${e.message}")
    }
}
```

### 2. Zero-Copy Google Filament Pipeline

```kotlin
import com.google.threelive.FilamentHelper

val asset = FilamentHelper.loadModelZeroCopy(script) { buffer ->
    assetLoader.createAssetFromBinary(buffer)
}
```

### 3. Compile to Standard ByteArray

If you need a conventional JVM `ByteArray` (for disk caching or HTTP upload):

```kotlin
val bytes: ByteArray = ThreeCompiler.compileToBytes(script)
```

## Native Memory and Leak Detection

A `GlbBuffer` owns memory allocated outside the JVM heap. The garbage collector
will reclaim the Kotlin wrapper but *not* that memory, so always close a buffer
when you are done with it — `glbBuffer.use { ... }` is the idiomatic way, and
`FilamentHelper.loadModelZeroCopy` handles it for you.

As a safety net, buffers that become unreachable without being closed are freed
and reported by `GlbBufferLeakDetector`. Reports go to `java.util.logging` by
default; to route them to logcat instead:

```kotlin
GlbBufferLeakDetector.listener = { leak ->
    Log.w("ThreeLive", leak.toString(), leak.allocationSite)
}
```

`leak.allocationSite` is a stack trace captured where the leaked buffer was
allocated, which is usually enough to identify the offending call site. Set
`GlbBufferLeakDetector.captureAllocationSites = false` to skip capturing it, or
`GlbBufferLeakDetector.enabled = false` to turn the detector off entirely.

Reclamation happens whenever the garbage collector gets around to it, which may
be long after the memory was last needed. Treat a leak report as a bug to fix,
not as working memory management.

## Supported Architectures

The prebuilt AAR bundles native binaries for:

- `arm64-v8a` (Modern 64-bit Android devices)
- `x86_64` (Android Studio Emulators)
- `armeabi-v7a` (32-bit ARM devices)

## Building the AAR from Source

### One-time setup: the Gradle wrapper

`gradle/wrapper/gradle-wrapper.jar` is **not** checked in — it is a compiled
binary, and this repository is mirrored from a source tree that does not accept
build artifacts. The Gradle version is still pinned in
`gradle/wrapper/gradle-wrapper.properties`.

Generate the wrapper jar once per clone:

```bash
./scripts/bootstrap_gradle_wrapper.sh
```

This needs Gradle on your `PATH` (`sdk install gradle`, `brew install gradle`,
or your distro's package manager). After it runs, `./gradlew` uses the pinned
version like any other project. CI does not need this step: it provisions the
pinned version directly via `gradle/actions/setup-gradle`.

### Build

To cross-compile the native `.so` libraries and build the `.aar`:

```bash
./scripts/build_android_aar.sh
```
Output: `mobile/android/build/outputs/aar/three-live-compiler-release.aar`
