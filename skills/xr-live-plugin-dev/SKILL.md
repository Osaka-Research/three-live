---
name: xr-live-plugin-dev
description: >-
  Adds or modifies <three-live> and <xr-live> plugins, userData.xr spatial
  traits, glTF ANDROID_xr_scenecore extensions, USDZ customData.xr metadata,
  and native Android (Filament / SceneCore) or iOS/visionOS (RealityKit)
  runtime features. Use when contributing new capabilities to the three-live
  monorepo or keeping Web, Rust, Android, and iOS/visionOS runtimes in parity.
---

# Developing Cross-Platform `<three-live>` & `<xr-live>` Plugins

Every `<xr-live>` feature is authored once and executes across **Web (`WebGL2` / `WebXR`)**, **Android (`Filament` / Jetpack XR `SceneCore`)**, and **iOS & visionOS (`RealityKit`)**. Follow this 5-step workflow whenever adding or modifying a plugin or `userData.xr` trait so the platforms never drift.

---

## Step 1: Canonical Trait Schema (`three-live/src/xr-trait-schema.ts`)

`three-live/src/xr-trait-schema.ts` is the single source of truth for trait validation, clamping, and export serialization:

1. **Define the normalized TypeScript interface** and a pure parser `parse<Feature>(raw: unknown)` using `clampNum(v, lo, hi, fallback)`, `isFiniteVec3(v)`, `shortString(v, max)`, and `safeMediaUrl(v)`.
2. **Add the field to `NormalizedXRTraits` and `normalizeXRTraits(raw)`** so both web plugins and exporters see identical defaults and bounds.
3. **Export to glTF (`buildXRSceneCoreExtension`)**: Map the normalized field into `nodes[i].extensions.ANDROID_xr_scenecore`.
4. **Export to USDZ (`flattenXRTraitsForUsd`)**: Flatten nested objects into camelCase scalar/vec3 keys (`<trait><Field>`) so `buildUsdXRLines()` emits valid USDA `customData = { dictionary xr = { ... } }` lines without injection risk.

---

## Step 2: Web Plugin (`xr-live/src/plugins/<name>.ts`)

1. Implement `ThreeLivePlugin` (`three-live/src/plugin.ts`):
   - `name`: Unique `'xr-live-<name>'` identifier.
   - `onElementConnected(element)` / `onElementDisconnected(element)`: Attach and clean up DOM event listeners (`xr-select-start`, `xr-select-move`, `xr-select-end`) via `WeakMap` state.
   - `onConfigureXRSessionInit(element, sessionInit)`: Add required/optional WebXR features (e.g. `'plane-detection'`, `'mesh-detection'`, `'hand-tracking'`).
   - `onXRFrame(viewer, session, frame, refSpace)` & `onUpdate(viewer, dt)`: Step per-frame simulation and dynamic meshes (`createDynamicMesh`, `updateDynamicMesh`, `removeDynamicMesh`, `setWorldTRS` from `xr-live/src/plugins/common.ts`).
2. **Register and export** the plugin in `xr-live/src/plugins/index.ts`.
3. **Bound all resources:** Enforce explicit constants (`MAX_*`) on any dynamic geometry, array, or network/event payload.

---

## Step 3: Native Android Parity (`mobile/android/`)

Update the Android runtime so compiled `.glb` scenes and scripts execute the trait identically:

1. **`mobile/android/src/main/java/com/google/threelive/XRLiveSceneCoreHelper.kt`:** Parse the new `extras.xr` / `ANDROID_xr_scenecore` fields with the exact same clamping ranges as `xr-trait-schema.ts`.
2.  **Modular Feature File
    (`mobile/android/src/main/java/com/google/threelive/<FeatureName>.kt`) &
    `XRSpatialMath.kt`:** Implement pure, allocation-free math and per-feature
    state machines in a dedicated Kotlin file (e.g. `SpatialMeasure.kt`,
    `MagneticSnap.kt`, `GazeDwell.kt`, `ExplodedView.kt`,
    `PersistentAnchors.kt`, `SpatialLocomotion.kt`, `SharedRoom.kt`) rather than
    bloating a single monolith.
3.  **`mobile/android/src/main/java/com/google/threelive/XRSpatialFeatures.kt` &
    `XRLiveRuntimeSession.kt`:** Wire the modular controller into
    `stepFrame(dtSeconds)` and emit dynamic `ThreeLiveMeshPrimitive` geometry
    (and optional `sectionPlane` uniforms) for `ThreeLiveFilamentRenderer.kt`.

---

## Step 4: Native iOS & visionOS Parity (`mobile/ios/`)

Update the Swift package under `mobile/ios/Sources/ThreeLiveCompiler/`:

1. **`XRLiveRuntimeSession.swift` & `XRLiveRealityKit.swift`:** Parse the trait from GLB `extras.xr` and USDZ `customData.xr`.
2.  **Modular Feature File (`<FeatureName>.swift`),
    `XRSpatialRealityKitFeatures.swift`, & `XRLiveRealityKitSession.swift`:**
    Mirror the math and dynamic entity updates in a dedicated Swift file (e.g.
    `SpatialMeasure.swift`, `MagneticSnap.swift`, `GazeDwell.swift`,
    `ExplodedView.swift`, `PersistentAnchors.swift`, `SpatialLocomotion.swift`,
    `SharedRoom.swift`) orchestrated by `XRSpatialRealityKitFeatures.swift`.
3. **Parity Test Check:** Android's `mobile/android/src/test/java/com/google/threelive/XRLiveSwiftSourceParityTest.kt` verifies that the Swift sources implement all required symbols and trait keys even when building on Linux.

---

## Step 5: Build, Bundle Budget & Test Verification

1. **Rebuild Web bundles & embedded Rust engine asset:**

    ```bash
    node scripts/build.js
    ```

    Verify that all 13 `.min.js.gz` bundles in `scripts/build.js` remain within
    their enforced byte budgets:

    -   `three-live-viewer.min.js`: `< 30 KB gz`
    -   `three-live.min.js`: `< 72 KB gz`
    -   `three-live-studio.min.js`: `< 29 KB gz`
    -   `three-live-cad.min.js`: `< 10 KB gz`
    -   `three-live-procedural.min.js`: `< 22 KB gz`
    -   `three-live-animation.min.js`: `< 11 KB gz`
    -   `three-live-full.min.js`: `< 136 KB gz`
    -   `xr-live-viewer.min.js`: `< 54 KB gz`
    -   `xr-live.min.js`: `< 84 KB gz`
    -   `xr-live-sensors.min.js`: `< 10 KB gz`
    -   `xr-live-spatial.min.js`: `< 63 KB gz`
    -   `xr-live-sim.min.js`: `< 26 KB gz`
    -   `xr-live-full.min.js`: `< 232 KB gz`
2. **Run Web, Rust, and Mobile tests:**

   ```bash
   node scripts/build.js --test
   cd compiler && cargo test
   ```
3. **Update `llms.txt` and `llms-full.txt`:**

   ```bash
   node scripts/build_llms_txt.js
   ```
