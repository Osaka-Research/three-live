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

# `<three-live>` & `<xr-live>` Developer Cookbook

This cookbook provides copy-pasteable recipes for common 3D and Spatial Computing
applications across Web, Android, and iOS/visionOS.

- **Component Reference:** [`docs/three-live.md`](three-live.md) and [`docs/xr-live.md`](xr-live.md)
- **LLM & Agent Guide:** [`docs/llm-guide.md`](llm-guide.md) and [`skills/three-live-authoring/SKILL.md`](../skills/three-live-authoring/SKILL.md)

--------------------------------------------------------------------------------

## 1. Interactive E-Commerce Product Configurator (`<three-live>`)

Combines procedural PBR geometry, Khronos `KHR_interactivity` click behaviors
(`cycleMaterialColor` + `toggleTransform`), analytical ground contact shadows,
3D surface hotspots, and 1-tap iOS Quick Look / Android Scene Viewer AR handoff.

```html
<script type="module" src="/dist/three-live-full.min.js"></script>

<three-live
  allow-client-scripts
  camera-controls
  auto-rotate
  ar
  shadow-intensity="0.8"
  shadow-softness="0.6"
  tone-mapping="neutral"
  style="width: 100%; height: 520px; display: block;">

  <script type="text/three">
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.25 })
    );
    base.name = 'pedestal';
    base.position.set(0, -0.35, 0);
    scene.add(base);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.09, 32, 64),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.85, roughness: 0.15 })
    );
    ring.name = 'product-ring';
    ring.position.set(0, 0.15, 0);
    ring.userData.interactivity = {
      onSelect: [
        {
          action: 'cycleMaterialColor',
          colors: [
            [0.22, 0.74, 0.97, 1.0],
            [0.96, 0.62, 0.04, 1.0],
            [0.66, 0.33, 0.97, 1.0]
          ],
          duration: 0.3
        },
        {
          action: 'toggleTransform',
          property: 'scale',
          from: [1, 1, 1],
          to: [1.15, 1.15, 1.15],
          duration: 0.25
        }
      ]
    };
    scene.add(ring);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>

  <button slot="hotspot-ring" data-position="0 0.45 0.1" data-normal="0 1 0">
    Click Ring to Cycle Finish
  </button>
</three-live>
```

--------------------------------------------------------------------------------

## 2. Precision Manipulation Handles, Lazy Head-Follow HUD & Orbiting Nodes (`<xr-live>`)

Uses the `manipulation-handles` and `head-follow` plugins so users can
scale a model via 4 top-corner handles, rotate it about Y via the pedestal bar,
and keep a floating HUD within a comfortable 18° deadzone.

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  id="handles-demo"
  allow-client-scripts
  xr-simulator="office"
  camera-controls
  style="width: 100%; height: 560px; display: block;">

  <script type="text/three">
    const centerpiece = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.22, 0.07, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.7, roughness: 0.2 })
    );
    centerpiece.name = 'centerpiece';
    centerpiece.position.set(0, 0.9, -1.2);
    centerpiece.userData.xr = {
      grab: '2-hand',
      handles: { rotateAxis: 'y', minScale: 0.4, maxScale: 2.5 }
    };
    scene.add(centerpiece);

    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7 })
    );
    moon.name = 'moon';
    moon.userData.xr = {
      orbit: { target: 'centerpiece', radius: 0.45, speed: 1.2, height: 0.08, faceCenter: true }
    };
    scene.add(moon);

    const hud = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.08, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })
    );
    hud.name = 'hud';
    hud.userData.xr = {
      follow: {
        mode: 'head',
        lazy: true,
        distance: 1.1,
        deadzoneDeg: 18,
        stiffness: 6,
        height: -0.22,
        faceUser: true
      }
    };
    scene.add(hud);
  </script>
</xr-live>

<script>
  document.getElementById('handles-demo').addEventListener('xr-handles-change', (e) => {
    console.log('Scale:', e.detail.scale.toFixed(2), 'Yaw (deg):', e.detail.yawDeg.toFixed(1));
  });
</script>
```

--------------------------------------------------------------------------------

## 3. Multimodal Gemini Live Assistant & Hold-to-Ask (`<xr-live>`)

Streams the XR viewport and microphone audio to a Gemini Live backend over
`wss://`, unprojects 2D object detections into 3D space via
`world-understanding`, and lets the user press-and-hold any `holdToAsk` mesh to
ask a voice question about that specific part.

```html
<button id="start-gemini">Connect Gemini Live</button>

<xr-live
  id="gemini-scene"
  allow-client-scripts
  world-understanding="planes reticle"
  xr-depth="occlusion"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <script type="text/three">
    const rotor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.4, 32),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.6, roughness: 0.3 })
    );
    rotor.name = 'rotor-assembly';
    rotor.position.set(0, 1.0, -1.0);
    rotor.userData.xr = {
      grab: '1-hand',
      holdToAsk: {
        prompt: 'What is this rotor assembly and how is it oriented?',
        holdMs: 600
      }
    };
    scene.add(rotor);
  </script>
</xr-live>

<script type="module">
  import '/dist/xr-live-full.min.js';
  import { connectGeminiLive } from '/dist/xr-live-plugins.min.js';

  const xr = document.getElementById('gemini-scene');
  xr.addEventListener('xr-transcription', (e) => {
    console.log(`[${e.detail.speaker}] ${e.detail.text}`);
  });
  xr.addEventListener('xr-object-detected', (e) => {
    console.log('Detected 3D object:', e.detail.label, e.detail.position);
  });

  document.getElementById('start-gemini').addEventListener('click', () => {
    connectGeminiLive(xr, {
      url: 'wss://your-backend.example.com/gemini-live',
      frameIntervalMs: 1000,
      streamAudio: true,
      playAudio: true,
      detectObjects: true
    });
  });
</script>
```

--------------------------------------------------------------------------------

## 4. 3D Spatial Paint, Depth Particles & Gaussian Splats (`<xr-live>`)

Combines Catmull-Rom 3D tube painting (`spatial-paint`), depth-colliding particle
emitters (`userData.xr.particles`), and `.splat` / `.spz` 3D Gaussian Splat
streaming (`userData.xr.splatUrl`).

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  id="creative-xr"
  allow-client-scripts
  spatial-paint="#38bdf8"
  xr-depth="occlusion"
  xr-simulator="tabletop"
  camera-controls
  style="width: 100%; height: 560px; display: block;">

  <script type="text/three">
    const emitter = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    emitter.name = 'sparks-emitter';
    emitter.position.set(0, 1.2, -1.0);
    emitter.userData.xr = {
      particles: { preset: 'sparks', count: 300, area: [1.5, 1.5, 1.5], speed: 1.2 }
    };
    scene.add(emitter);

    const splatNode = new THREE.Group();
    splatNode.name = 'bonsai-splat';
    splatNode.position.set(0, 0.8, -1.0);
    splatNode.userData.xr = {
      grab: '2-hand',
      splatUrl: '/assets/bonsai.spz'
    };
    scene.add(splatNode);
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## 5. Native Android & iOS/visionOS Runtime Sessions

Compile the exact same procedural `<script type="text/three">` string on-device
and step all spatial traits natively without a WebView:

### Android (Kotlin + Google Filament + Jetpack XR SceneCore)
```kotlin
import com.google.threelive.ThreeLiveRuntimeSession
import com.google.threelive.XRLiveSceneCoreHelper
import com.google.threelive.filament.ThreeLiveFilament

// Register the Filament renderer once in Application.onCreate()
ThreeLiveFilament.install()

// Compile procedural Three.js and step XR traits at 60-90 Hz
val session = ThreeLiveRuntimeSession.fromScript(scriptString)
session.stepFrame(dtSeconds = 1f / 60f)

// Or attach traits directly to an Android XR SceneCore entity from GLB bytes
XRLiveSceneCoreHelper.attachTraitsFromGlb(xrSession, rootEntity, glbByteBuffer)
```

### iOS & visionOS (Swift + Apple RealityKit)
```swift
import ThreeLiveCompiler
import RealityKit

@MainActor
func mountScene(script: String, in arView: ARView) async throws {
    let entity = try await RealityKitHelper.loadEntity(from: script)
    XRLiveRealityKit.installTraits(on: entity, in: arView)
}
```
