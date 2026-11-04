# Copy-Paste Recipes for `<three-live>` and `<xr-live>`

All 9 recipes below use features available in the repository today and work
without external build steps.

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
  import { connectGeminiLive } from '/dist/xr-live-spatial.min.js';

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

--------------------------------------------------------------------------------

## Recipe 7: CAD Exploded View, Cross-Section Slicer, 3D Dimensions & Gaze Dwell

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  explode="0.55"
  explode-mode="axial-y"
  section-plane="interactive"
  spatial-measure="all"
  measure-unit="mm"
  gaze-dwell="auto"
  dwell-time="950"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <script type="text/three">
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.3, 0.14, 36),
      new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.25 })
    );
    base.name = 'housing-base';
    base.position.set(0, 0.75, -1.1);
    base.userData.xr = {
      explode: false,
      dimensions: { unit: 'mm', axes: ['x', 'y', 'z'], color: '#38bdf8' }
    };
    scene.add(base);

    const shroud = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.14, 36),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.65, roughness: 0.2 })
    );
    shroud.name = 'upper-shroud';
    shroud.position.set(0, 0.92, -1.1);
    shroud.userData.xr = {
      explode: { direction: [0, 1, 0], distance: 0.38, layer: 2, leaderLine: true },
      gaze: { dwellMs: 900, action: 'select' }
    };
    scene.add(shroud);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.2));
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## Recipe 8: Magnetic Socket Snapping, `#xr-state` URL Persistence & XR Locomotion

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  magnetic-snap="all"
  snap-grid="0.05"
  snap-angle="15"
  persistent-anchors="workbench"
  persist-url-hash
  locomotion="teleport snap-turn"
  snap-turn-deg="30"
  xr-simulator="office"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <script type="text/three">
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    );
    floor.name = 'walkable-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.userData.xr = { navigable: 'walkable' };
    scene.add(floor);

    const socketPedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.04, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b })
    );
    socketPedestal.name = 'dock-socket';
    socketPedestal.position.set(0, 0.8, -1.1);
    socketPedestal.userData.xr = {
      snapSocket: { tag: 'bay-a', radius: 0.18, alignRotation: true, highlightColor: '#22c55e' }
    };
    scene.add(socketPedestal);

    const moduleCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.5, roughness: 0.25 })
    );
    moduleCube.name = 'snap-module';
    moduleCube.position.set(0.35, 0.9, -1.1);
    moduleCube.userData.xr = {
      grab: '1-hand',
      snapTo: { socketTag: 'bay-a', radius: 0.18, grid: 0.05, angleDeg: 15 },
      anchor: { id: 'snap-module', persist: true }
    };
    scene.add(moduleCube);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.0));
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## Recipe 9: Zero-Backend Multi-User Co-Presence & Shared Spatial Paint (`shared-room`)

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  shared-room="studio-room-1"
  peer-name="Designer"
  peer-color="#38bdf8"
  spatial-paint="#38bdf8"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <script type="text/three">
    const artifact = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.18, 0.055, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.65, roughness: 0.2 })
    );
    artifact.name = 'shared-artifact';
    artifact.position.set(0, 1.0, -1.1);
    artifact.userData.xr = {
      grab: '2-hand',
      handles: { rotateAxis: 'y', minScale: 0.4, maxScale: 2.5 },
      sync: true
    };
    scene.add(artifact);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.2));
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## Recipe 10: Timed Training Drill with a Safety Zone (`xr-live-sim`)

Ordered task steps, a countdown, and an alarm zone around a robot cell. Load
`xr-live-sim.min.js` (or use `xr-live-full.min.js`). Taps complete steps in
order; out-of-order taps play an `error` cue.

```html
<!-- Load after xr-live.min.js; xr-live-full.min.js already includes it. -->
<script src="/dist/xr-live-sim.min.js"></script>

<xr-live
  id="drill"
  allow-client-scripts
  objectives
  scenario-timer="60"
  synth-audio
  style="width: 100%; height: 520px; display: block;">
  <script type="text/three">
    const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.4 });

    // Ordered, required task steps (tap them in sequence)
    ['Step_1_Valve', 'Step_2_Filter', 'Step_3_Cap'].forEach((name, i) => {
      const part = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat(0x38bdf8));
      part.name = name;
      part.position.set(i * 0.4 - 0.4, 1.0, -1.0);
      part.userData.xr = {
        objective: { type: 'checkpoint', order: i + 1, required: true, amount: 10 },
        audioCues: { onObjective: 'confirm' }
      };
      scene.add(part);
    });

    // Robot cell: alarm while the AGV is inside
    const cell = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xef4444, transparent: true, opacity: 0.15 })
    );
    cell.name = 'Robot_Cell';
    cell.position.set(1.4, 0.5, -2);
    cell.userData.xr = {
      zone: { shape: 'box', size: [1.2, 1, 1.2], color: '#ef4444', watchGroups: ['agent'] },
      audioCues: { onZoneEnter: 'alarm' }
    };
    scene.add(cell);

    // AGV patrolling through the cell
    const agv = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.2, 0.6), mat(0xf59e0b));
    agv.name = 'AGV';
    agv.position.set(-1.5, 0.1, -2);
    agv.userData.xr = {
      agent: { mode: 'patrol', speed: 0.8, waypoints: [[-1.5, 0.1, -2], [2.5, 0.1, -2]] }
    };
    scene.add(agv);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</xr-live>

<script>
  const drill = document.getElementById('drill');
  drill.addEventListener('xrobjective', (e) => {
    if (e.detail.outOfOrder) console.warn('Out of order:', e.detail.nodeId);
  });
  drill.addEventListener('xrzoneenter', (e) => {
    console.log(e.detail.nodeId, 'entered', e.detail.zoneId);
  });
  drill.addEventListener('xrscenarioend', (e) => {
    console.log('Outcome:', e.detail.outcome, 'in', e.detail.elapsedSec, 's');
  });
</script>
```

--------------------------------------------------------------------------------

## Recipe 11: Procedural CAD Extrusion, CSG Booleans, 3D Text & GPU Instancing (`<three-live>`)

```html
<script type="module" src="/dist/three-live.min.js"></script>

<three-live
  allow-client-scripts
  camera-controls
  auto-rotate
  ar
  tone-mapping="aces"
  bloom="1.2"
  outline="#38bdf8 0.025"
  style="width: 100%; height: 520px; display: block;">
  <script type="text/three">
    const profile = new THREE.Shape();
    profile.absarc(0, 0, 0.55, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, 0.22, 0, Math.PI * 2, true);
    profile.holes.push(hole);

    const steel = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.24 });
    const rawFlange = new THREE.Mesh(
      new THREE.ExtrudeGeometry(profile, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015 }),
      steel
    );
    rawFlange.rotation.x = -Math.PI / 2;

    const slotCutter = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 0.16), steel);
    slotCutter.position.set(0, 0.12, 0);
    const machined = THREE.CSG.subtract(rawFlange, slotCutter);
    machined.name = 'machined-flange';
    machined.userData.xr = { outline: { color: '#38bdf8', thickness: 0.02 } };
    scene.add(machined);

    const label = new THREE.Mesh(
      new THREE.TextGeometry('CAD R1', { size: 0.14, depth: 0.035, bevelEnabled: true }),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x0ea5e9, emissiveIntensity: 0.45 })
    );
    label.position.set(-0.32, 0.28, 0);
    scene.add(label);

    const bolts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.15 }),
      12
    );
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      p.set(Math.cos(a) * 0.39, 0.09, Math.sin(a) * 0.39);
      m.compose(p, q, s);
      bolts.setMatrixAt(i, m);
    }
    scene.add(bolts);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.4));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</three-live>
```

--------------------------------------------------------------------------------

## Recipe 12: Articulated Robotic Arm with 2-Bone / FABRIK IK & Spatialized Voice (`<xr-live>`)

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  allow-client-scripts
  bloom="1.3"
  outline="#38bdf8 0.025"
  tone-mapping="agx"
  shared-room="robotics-cell"
  shared-room-voice
  camera-controls
  style="width: 100%; height: 540px; display: block;">
  <script type="text/three">
    const armMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.25 });
    const shoulder = new THREE.Group();
    shoulder.name = 'Shoulder';
    shoulder.position.set(0, 0.75, -1.1);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.32), armMat);
    upper.position.set(0, 0, 0.16);
    shoulder.add(upper);

    const forearm = new THREE.Group();
    forearm.name = 'Forearm';
    forearm.position.set(0, 0, 0.32);
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.28), armMat);
    lower.position.set(0, 0, 0.14);
    forearm.add(lower);
    shoulder.add(forearm);

    const wrist = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.6 })
    );
    wrist.name = 'WristEffector';
    wrist.position.set(0, 0, 0.28);
    wrist.userData.xr = {
      ik: { target: 'GripperTarget', poleTarget: 'ElbowPole', solver: 'two-bone', chainLength: 2 }
    };
    forearm.add(wrist);
    scene.add(shoulder);

    const pole = new THREE.Group();
    pole.name = 'ElbowPole';
    pole.position.set(0, 1.35, -0.95);
    scene.add(pole);

    const target = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.8 })
    );
    target.name = 'GripperTarget';
    target.position.set(0.22, 1.02, -0.78);
    target.userData.xr = { grab: '1-hand', outline: { color: '#22c55e', thickness: 0.025 } };
    scene.add(target);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.2));
  </script>
</xr-live>
```
