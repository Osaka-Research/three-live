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

# three-live Filament renderer (optional)

A `ThreeLiveRenderer` for Android built on [Filament](https://github.com/google/filament)
and gltfio. The core `com.google.threelive:compiler` library never depends on
it; add this module only when you want three-live to render with Filament.

```kotlin
dependencies {
    implementation("com.google.threelive:compiler:1.0.0")
    implementation("com.google.threelive:filament:1.0.0")
}

// Application.onCreate: register explicitly (there is no auto-initialization).
ThreeLiveFilament.install()
```

What it provides:

- GLB rendering with a sun light, neutral ambient light, and an orbit camera
  that matches the web viewer (`OrbitCameraState`): drag to orbit, pinch to
  zoom, turntable auto-rotate, `camera-change` callbacks.
- glTF node ↔ gltfio entity mapping, so `KHR_interactivity` transform,
  visibility, material-factor, `alphaCutoff` and animation changes from
  `ThreeLiveRuntimeBinding` show up on screen.
- Tap picking (`View.pick`) to the owning glTF node, long press (hold-to-ask),
  and pointer capture for spatial features.
- Dynamic world-space meshes (handles, paint strokes, particles) drawn with
  gltfio's unlit material.

Hit points reported with picks are approximate (where the tap ray enters the
hit renderable's bounding box). All calls must be made on the main thread.
