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

# `<xr-live>` Spatial Computing & Deep XR Guide

`<xr-live>` extends `<three-live>` into a full spatial computing runtime for
**WebXR (Android XR, Meta Quest, Apple Vision Pro)**, **Mobile Web AR**, and
**Native Android XR / iOS RealityKit**.

It brings declarative spatial traits (`grab`, `scale`, `billboard`, `anchor`),
interactive HTML/CSS spatial cards (`<div slot="spatial">`), real-world depth
occlusion & heightfield physics, 25-joint hand gesture recognition, a desktop
6DoF simulator, and zero-webview native mobile AR/XR bridges.

For standard 3D viewing, `<model-viewer>` drop-in compatibility, and PBR
materials, see **[`docs/three-live.md`](three-live.md)**. See
**[`README.md`](../README.md)** for JS bundles and entry points.

--------------------------------------------------------------------------------

## Quickstart

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  xr-mode="inline-ar"
  xr-depth
  xr-hands
  xr-simulator
  camera-controls
  style="width: 100%; height: 600px; display: block;">

  <!-- Declarative 3D anchor with spatial traits -->
  <xr-anchor
    name="desk-lamp"
    src="/models/lamp.glb"
    position="0 0.8 -1.2"
    data-xr-traits="grab scale billboard">
  </xr-anchor>

  <!-- Live HTML/CSS spatial UI card rendered inside the 3D/XR scene -->
  <div slot="spatial" data-position="0.45 1.1 -1.1" data-xr-traits="grab billboard">
    <div style="padding: 16px; background: #0f172a; color: #f8fafc; border-radius: 16px; width: 240px;">
      <h3>Studio Desk Lamp</h3>
      <p>Pinch to grab or scale in 3D space.</p>
      <button id="buy-btn">Add to Cart — $129</button>
    </div>
  </div>
</xr-live>
```

--------------------------------------------------------------------------------

## Observed Attributes (`<xr-live>` & `<xr-anchor>`)

`<xr-live>` inherits all
[`<three-live>` attributes](three-live.md#observed-attributes) plus the
following spatial attributes:

| Element       | Attribute        | Type      | Default       | Description        |
| :------------ | :--------------- | :-------- | :------------ | :----------------- |
| `<xr-live>` | `xr-mode` | `string` | `"inline-ar"` | Session mode: `"inline-ar"` (passthrough AR), `"immersive-vr"`, or `"inline"`. |
| `<xr-live>` | `xr-depth` | `boolean` | `false` | Enables WebXR real-world depth sensing (`depth-sensing`), shader occlusion, and heightfield physics terrain extraction. |
| `<xr-live>` | `xr-hands` | `boolean` | `false` | Enables 25-joint WebXR hand tracking (`hand-tracking`) and gesture classification. |
| `<xr-live>` | `xr-simulator` | `boolean` | `false` | Enables desktop 6DoF keyboard/mouse simulator (`WASD` + mouse look + synthetic rays). |
| `<xr-live>` | `xr-profile` | `string` | `"auto"` | Device profile hint (`"android-xr"`, `"vision-os"`, `"quest"`, `"mobile-ar"`). |
| `<xr-anchor>` | `name` | `string` | — | Unique identifier for the spatial anchor / node. |
| `<xr-anchor>` | `src` | `string` | — | Optional `.glb` model URL attached to this anchor. |
| `<xr-anchor>` | `position` | `string` | `"0 0 0"` | Initial 3D world position `"x y z"` in meters. |
| `<xr-anchor>` | `rotation` | `string` | `"0 0 0"` | Euler rotation `"rx ry rz"` in degrees. |
| `<xr-anchor>` | `scale` | `string` | `"1 1 1"` | Scale vector `"sx sy sz"`. |
| `<xr-anchor>` | `data-xr-traits` | `string` | — | Space-separated spatial traits: `"grab"`, `"scale"`, `"billboard"`, `"anchor"`. |

--------------------------------------------------------------------------------

## Declarative Spatial Traits (`grab`, `scale`, `billboard`, `anchor`)

Spatial traits work identically across **WebXR**, **Mobile Web AR**, and
**Native Android/iOS** (encoded directly into `.glb` `extras.xrTraits` and
`.usdz` custom metadata):

| Trait           | Behavior                                                   |
| :-------------- | :--------------------------------------------------------- |
| **`grab`** | Allows 6DoF single-hand pinch / controller trigger grabbing and direct spatial manipulation with smooth spring damping. |
| **`scale`** | Enables two-handed pinch-to-scale (or scroll/pinch gesture scaling) around the object's pivot. |
| **`billboard`** | Smoothly orients the object toward the user's active XR camera / head pose around the world Y-axis. |
| **`anchor`** | Pins the object to a persistent world surface hit-test anchor (`XRAnchor` on WebXR, `AnchorEntity` on RealityKit, `Anchor` on Android XR SceneCore). |

### Authoring Traits in `<script type="text/three">`

You can attach traits directly to procedural Three.js meshes or groups:

```html
<xr-live allow-client-scripts xr-mode="inline-ar" style="width: 100%; height: 500px;">
  <script type="text/three">
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 32, 32),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.4, roughness: 0.2 })
    );
    orb.position.set(0, 1.2, -0.8);
    orb.userData.xrTraits = ['grab', 'scale', 'billboard'];
    scene.add(orb);
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## Spatial DOM Cards (`<div slot="spatial">`)

Any child element with `slot="spatial"` is automatically projected into 3D space
as an interactive textured quad inside WebXR and inline 3D views:

-   **Sanitized SVG `<foreignObject>` Rasterization:** Renders live HTML/CSS
    into a crisp GPU texture with automatic XSS hardening (strips dangerous
    tags/handlers, blocks `javascript:`/`data:text/html` URIs, escapes XML
    entities).
-   **3D Raycast Hit-Testing:** Controller rays, hand pinch rays, and pointer
    clicks automatically compute UV intersection coordinates and dispatch
    synthetic `click`, `pointerdown`, `pointermove`, and `pointerup` events to
    the underlying DOM elements (e.g., `<button>`).
-   **Trait Support:** Add `data-xr-traits="grab billboard"` and
    `data-position="x y z"` directly on `<div slot="spatial">`.

--------------------------------------------------------------------------------

## Deep XR Features (`xr-live/extras` / `xr-live-full`)

Import `xr-live/extras` (or load `xr-live-full.min.js`) to unlock advanced
spatial computing subsystems:

### 1. Real-World Depth Occlusion (`XRDepthManager`)

-   Queries WebXR `XRCPUDepthInformation` / `XRWebGLDepthInformation` each frame
    with zero per-frame heap allocations (reusable `Float32Array` buffer pools).
-   Uploads depth textures and UV transforms to the PBR shader for realistic
    real-world hand/furniture occlusion.

### 2. Heightfield Physics (`XRHeightfieldPhysics`)

-   Samples real-world depth maps into a spatial heightfield grid and steps
    rigid-body physics (`gravity`, restitution bounce, friction, and sphere/box
    colliders) at 60–90 Hz.

### 3. 25-Joint Hand Gesture Recognition (`XRHandGestureClassifier`)

-   Evaluates 25 skeletal hand joints (`XRHand`) each frame to classify:
    -   **`pinch`** (thumb tip to index tip distance < threshold)
    -   **`grab`** (curled fingers fist/grab pose)
    -   **`point`** (index extended, middle/ring/pinky curled)
    -   **`palm-up`** (open palm facing the user's head pose — ideal for
        summoning spatial menus)

### 4. Desktop 6DoF Simulator (`XRDesktopSimulator`)

-   Enables testing full 6DoF spatial apps on any laptop without a headset:
    -   `W` / `A` / `S` / `D` + `Q` / `E`: 6DoF head translation
    -   Mouse drag: Head pitch/yaw look
    -   Synthetic controller raycasting & pinch triggers

### 5. Spatial Audio, Skybox & Gemini WebMCP Tools

-   **`XRSpatialAudioController`:** PannerNode HRTF 3D audio sources attached to
    scene nodes.
-   **AR/VR Skybox Transitions:** Smooth alpha cross-fading between passthrough
    AR and equirectangular VR environments.
-   **Gemini WebMCP Tools:** Exposes structured spatial scene inspection and
    manipulation tools for AI agents.

--------------------------------------------------------------------------------

## Native Mobile Spatial Bridges (No WebViews Required)

`xr-live` compiles scenes into self-contained `.glb` and `.usdz` binaries with
embedded spatial trait metadata, allowing native Android and iOS apps to run
full 6DoF spatial experiences natively:

### Android (`mobile/android/src/main/java/com/google/threelive/`)

-   **[`SceneViewerHelper.kt`](../mobile/android/src/main/java/com/google/threelive/SceneViewerHelper.kt):**
    Zero-webview Google Scene Viewer intent builder (`ar_only` / `ar_preferred`,
    sound, title, resizable) with direct file/URI streaming.
-   **[`XRLiveSceneCoreHelper.kt`](../mobile/android/src/main/java/com/google/threelive/XRLiveSceneCoreHelper.kt):**
    Jetpack XR SceneCore integration for Android XR headsets and phones:
    -   Parses GLB `extras.xrTraits` with strict RFC-compliant chunk bounds
        validation.
    -   Automatically attaches Jetpack SceneCore `MovableComponent` (`grab`),
        `ResizableComponent` (`scale`), world `Anchor` placement (`anchor`), and
        smooth Y-axis `billboard` updates.

### iOS & visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`)

-   **[`XRLiveRealityKit.swift`](../mobile/ios/Sources/ThreeLiveCompiler/XRLiveRealityKit.swift):**
    Native Swift + RealityKit spatial runtime:
    -   Loads compiled `.usdz` / `.glb` entities via `RealityKitHelper` with
        zero-copy memory bridging.
    -   Applies RealityKit `InputTargetComponent` + `CollisionComponent`,
        drag/pinch gesture recognizers (`grab`, `scale`),
        `AnchorEntity(.plane(...))` (`anchor`), and per-frame camera-facing
        `billboard` orientation.
