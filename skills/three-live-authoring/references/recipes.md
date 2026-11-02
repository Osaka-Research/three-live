# Copy-Paste Recipes for `<three-live>` and `<xr-live>`

All 6 recipes below use features available in the repository today and work without external build steps.

---

## Recipe 1: Interactive 3D Product Configurator (`<three-live>` + `KHR_interactivity` + Hotspots)

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
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.65, 0.14, 48),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.25 })
    );
    pedestal.name = 'pedestal';
    pedestal.position.set(0, -0.35, 0);
    scene.add(pedestal);

    const watchCase = new THREE.Mesh(
      new THREE.TorusGeometry(0.32, 0.09, 32, 64),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.85, roughness: 0.15 })
    );
    watchCase.name = 'watch-case';
    watchCase.position.set(0, 0.15, 0);
    // Compile-to-GLB KHR_interactivity behavior on click/tap:
    watchCase.userData.interactivity = {
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
          to: [1.18, 1.18, 1.18],
          duration: 0.25
        }
      ]
    };
    scene.add(watchCase);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>

  <button slot="hotspot-case" data-position="0 0.45 0.1" data-normal="0 1 0">
    Tap Ring to Cycle Finish
  </button>
</three-live>
```

---

## Recipe 2: Spatial UI Card & Depth-Physics Ballpit (`<xr-live>`)

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  xr-mode="ar"
  xr-depth="occlusion-physics"
  xr-hands="gestures"
  xr-simulator="living-room"
  sound-feedback
  camera-controls
  style="width: 100%; height: 600px; display: block;">

  <script type="text/three">
    const palette = [0x38bdf8, 0xf43f5e, 0x22c55e, 0xeab308, 0xa855f7];
    for (let i = 0; i < 12; i++) {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.08, 24, 24),
        new THREE.MeshStandardMaterial({
          color: palette[i % palette.length],
          metalness: 0.2,
          roughness: 0.25
        })
      );
      ball.name = `ball-${i}`;
      ball.position.set((i % 4 - 1.5) * 0.22, 1.3 + Math.floor(i / 4) * 0.22, -1.1);
      ball.userData.xr = {
        grab: '1-hand',
        physics: 'dynamic',
        restitution: 0.78
      };
      scene.add(ball);
    }

    const light = new THREE.DirectionalLight(0xffffff, 2.0);
    light.position.set(1, 3, 2);
    scene.add(light);
  </script>

  <div slot="spatial" data-position="0.55 1.25 -1.1" data-xr-traits="grab billboard">
    <div style="padding: 16px; background: #0f172a; color: #f8fafc; border-radius: 14px; width: 220px;">
      <h4 style="margin: 0 0 8px;">Physics Controls</h4>
      <p style="margin: 0 0 12px; font-size: 13px;">Grab spheres or bounce them off real-world surfaces.</p>
      <button onclick="document.querySelector('xr-live').transitionToVR({ durationMs: 400 })">
        Toggle VR Environment
      </button>
    </div>
  </div>
</xr-live>
```

---

## Recipe 3: Precision Manipulation Handles, Lazy Head-Follow HUD & Orbiting Satellites

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  xr-simulator="office"
  camera-controls
  style="width: 100%; height: 560px; display: block;">

  <script type="text/three">
    // Centerpiece with 4 corner scale handles + pedestal yaw rotation bar
    const sculpture = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.22, 0.07, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.7, roughness: 0.2 })
    );
    sculpture.name = 'sculpture';
    sculpture.position.set(0, 0.9, -1.2);
    sculpture.userData.xr = {
      grab: '2-hand',
      handles: { rotateAxis: 'y', minScale: 0.4, maxScale: 2.5 }
    };
    scene.add(sculpture);

    // Satellite orbiting the named 'sculpture' node
    const orbiter = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7 })
    );
    orbiter.name = 'orbiter';
    orbiter.userData.xr = {
      orbit: { target: 'sculpture', radius: 0.45, speed: 1.2, height: 0.08, faceCenter: true }
    };
    scene.add(orbiter);

    // Lazy head-follow status pill with 18-degree angular deadzone
    const hudPill = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.08, 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 })
    );
    hudPill.name = 'hud-pill';
    hudPill.userData.xr = {
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
    scene.add(hudPill);
  </script>
</xr-live>
```

---

## Recipe 4: Multimodal Gemini Live Assistant + Hold-to-Ask + World Understanding

```html
<script type="module">
  import '/dist/xr-live-full.min.js';
  import { connectGeminiLive } from '/dist/xr-live-blocks.min.js';

  const xr = document.getElementById('gemini-xr');

  xr.addEventListener('xr-transcription', (e) => {
    console.log(`[${e.detail.speaker}] ${e.detail.text}`);
  });

  xr.addEventListener('xr-object-detected', (e) => {
    console.log(`Located ${e.detail.label} at`, e.detail.position);
  });

  // Connect only after user gesture (never on page load):
  document.getElementById('connect-btn').addEventListener('click', () => {
    connectGeminiLive(xr, {
      url: 'wss://your-proxy.example.com/gemini-live',
      frameIntervalMs: 1000,
      streamAudio: true,
      playAudio: true,
      detectObjects: true
    });
  });
</script>

<button id="connect-btn">Start Gemini Live Session</button>

<xr-live
  id="gemini-xr"
  allow-client-scripts
  world-understanding="planes reticle"
  xr-depth="occlusion"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <script type="text/three">
    const artifact = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.22, 0.4, 32),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.6, roughness: 0.3 })
    );
    artifact.name = 'turbine-core';
    artifact.position.set(0, 1.0, -1.0);
    artifact.userData.xr = {
      grab: '1-hand',
      holdToAsk: {
        prompt: 'Explain the role of this turbine core and inspect its orientation.',
        holdMs: 600
      }
    };
    scene.add(artifact);
  </script>
</xr-live>
```

---

## Recipe 5: 3D Spatial Paint, Depth Particles & Gaussian Splats

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  spatial-paint="#38bdf8"
  xr-depth="occlusion"
  xr-simulator="tabletop"
  camera-controls
  style="width: 100%; height: 560px; display: block;">

  <script type="text/three">
    // Depth-colliding snow emitter volume
    const snowVolume = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 0.01),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    snowVolume.name = 'snow-emitter';
    snowVolume.position.set(0, 1.4, -1.2);
    snowVolume.userData.xr = {
      particles: { preset: 'snow', count: 500, area: [2.5, 2.0, 2.5], speed: 0.9 }
    };
    scene.add(snowVolume);

    // 3D Gaussian Splat node (.splat or .spz)
    const splatAnchor = new THREE.Group();
    splatAnchor.name = 'garden-splat';
    splatAnchor.position.set(0, 0.8, -1.2);
    splatAnchor.userData.xr = {
      grab: '2-hand',
      splatUrl: 'https://example.com/assets/bonsai.spz'
    };
    scene.add(splatAnchor);
  </script>
</xr-live>
```

---

## Recipe 6: Native Android (Kotlin) & iOS/visionOS (Swift) Integration

### Android (Google Filament + Jetpack XR SceneCore)
```kotlin
import com.google.threelive.ThreeLiveRuntimeSession
import com.google.threelive.XRLiveSceneCoreHelper
import com.google.threelive.filament.ThreeLiveFilament

// 1. Install the Filament renderer once at startup
ThreeLiveFilament.install()

// 2. Compile procedural Three.js and step XR traits / handles / particles natively
val session = ThreeLiveRuntimeSession.fromScript(scriptSource)
session.stepFrame(dtSeconds = 1f / 60f)

// 3. Or attach traits directly to an Android XR SceneCore entity from GLB bytes
XRLiveSceneCoreHelper.attachTraitsFromGlb(xrSession, rootEntity, glbByteBuffer)
```

### iOS & visionOS (Apple RealityKit)
```swift
import ThreeLiveCompiler
import RealityKit

@MainActor
func mountSpatialScene(script: String, in arView: ARView) async throws {
    let entity = try await RealityKitHelper.loadEntity(from: script)
    XRLiveRealityKit.installTraits(on: entity, in: arView)
}
```
