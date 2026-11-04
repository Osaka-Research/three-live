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
  import { connectGeminiLive } from '/dist/xr-live-spatial.min.js';

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

--------------------------------------------------------------------------------

## 6. CAD Exploded-View Assembly, Cross-Section Slicer, 3D Dimensions & Gaze Dwell (`<xr-live>`)

Combines `exploded-view` (`explode` + `section-plane`), `spatial-measure`
(`userData.xr.dimensions` + point-to-point tape), and hands-free `gaze-dwell`
selection for engineering design reviews:

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<input type="range" min="0" max="1" step="0.01" value="0.5"
  oninput="document.getElementById('cad-xr').setExplode(Number(this.value))" />

<xr-live
  id="cad-xr"
  allow-client-scripts
  explode="0.5"
  explode-mode="axial-y"
  section-plane="interactive"
  spatial-measure="all"
  measure-unit="mm"
  gaze-dwell="auto"
  dwell-time="1000"
  camera-controls
  style="width: 100%; height: 580px; display: block;">
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

    const core = new THREE.Mesh(
      new THREE.TorusGeometry(0.16, 0.045, 24, 48),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.2 })
    );
    core.name = 'stator-coil';
    core.rotation.x = Math.PI / 2;
    core.position.set(0, 0.86, -1.1);
    core.userData.xr = {
      explode: { direction: [0, 1, 0], distance: 0.24, layer: 1, leaderLine: true },
      gaze: { dwellMs: 900, action: 'select' }
    };
    scene.add(core);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.26, 0.1, 36),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.65, roughness: 0.2 })
    );
    cap.name = 'top-cover';
    cap.position.set(0, 0.96, -1.1);
    cap.userData.xr = {
      explode: { direction: [0, 1, 0], distance: 0.48, layer: 2, leaderLine: true },
      gaze: { dwellMs: 900, action: 'select' }
    };
    scene.add(cap);

    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(2, 4, 3);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## 7. Modular Magnetic Snapping, Persistent `#xr-state` Layouts & XR Locomotion (`<xr-live>`)

Uses `magnetic-snap` (`snapSocket` + `snapTo`), `persistent-anchors` with
`persist-url-hash` so rearranged layouts encode directly into `#xr-state=...`
links, and `spatial-locomotion` parabolic teleportation across walkable floors:

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  id="layout-xr"
  allow-client-scripts
  magnetic-snap="all"
  snap-grid="0.05"
  snap-angle="15"
  persistent-anchors="workbench-v1"
  persist-url-hash
  locomotion="teleport snap-turn"
  snap-turn-deg="30"
  comfort-vignette
  xr-simulator="office"
  camera-controls
  style="width: 100%; height: 580px; display: block;">
  <script type="text/three">
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 4),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 })
    );
    floor.name = 'studio-floor';
    floor.rotation.x = -Math.PI / 2;
    floor.userData.xr = { navigable: 'walkable' };
    scene.add(floor);

    const dock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.18, 0.04, 32),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.3 })
    );
    dock.name = 'charging-dock';
    dock.position.set(0, 0.8, -1.1);
    dock.userData.xr = {
      snapSocket: { tag: 'module-bay', radius: 0.18, alignRotation: true, highlightColor: '#22c55e' }
    };
    scene.add(dock);

    const modulePod = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x6366f1, metalness: 0.5, roughness: 0.25 })
    );
    modulePod.name = 'sensor-pod';
    modulePod.position.set(0.38, 0.9, -1.1);
    modulePod.userData.xr = {
      grab: '1-hand',
      snapTo: { socketTag: 'module-bay', radius: 0.18, grid: 0.05, angleDeg: 15 },
      anchor: { id: 'sensor-pod', persist: true }
    };
    scene.add(modulePod);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.0));
  </script>
</xr-live>
```

--------------------------------------------------------------------------------

## 8. Multi-User Co-Presence & Shared 3D Annotations (`shared-room` + `spatial-paint`)

Open two browser tabs on the same page to see live `20 Hz` 3D peer visor
avatars, tinted pointer rays, `2000ms` soft-locked object handoffs, and
synchronized 3D paint strokes via `BroadcastChannel`—or point
`shared-room="wss://..."` at any WebSocket relay for cross-device headset +
phone collaboration:

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  id="collab-xr"
  allow-client-scripts
  shared-room="design-review-42"
  peer-name="Architect"
  peer-color="#38bdf8"
  spatial-paint="#38bdf8"
  explode="0"
  camera-controls
  style="width: 100%; height: 580px; display: block;">
  <script type="text/three">
    const block = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.18, 0.055, 64, 16),
      new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.65, roughness: 0.2 })
    );
    block.name = 'shared-prototype';
    block.position.set(0, 1.0, -1.1);
    block.userData.xr = {
      grab: '2-hand',
      handles: { rotateAxis: 'y', minScale: 0.4, maxScale: 2.5 },
      explode: { direction: [0, 1, 0], distance: 0.3 },
      sync: true
    };
    scene.add(block);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</xr-live>

<script>
  const collab = document.getElementById('collab-xr');
  collab.addEventListener('peerjoin', (e) => {
    console.log('Peer joined:', e.detail.name, e.detail.color);
  });
  collab.addEventListener('peersync', (e) => {
    console.log('Synced update from', e.detail.peerId, 'on', e.detail.nodeId);
  });
</script>
```

--------------------------------------------------------------------------------

## 9. Timed Training Drill with a Robot-Cell Safety Zone (`xr-live-sim`)

The optional `xr-live-sim` bundle turns a scene into a scored simulation. This
drill asks the user to tap three parts in order within 60 seconds, while an
automated guided vehicle (AGV) patrols through a robot cell that sounds an alarm
whenever it's occupied. See
[Simulation plugins](xr-live.md#simulation-plugins-xr-live-sim) for every trait,
attribute, and event.

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

To build a game instead, add a `character` node (moved with WASD, a gamepad, or
the touch joystick), set `hit-zones="projectile"`, and give targets an
`integrity` trait with a `scoreValue`.

--------------------------------------------------------------------------------

## 10. Procedural CAD Extrusion, CSG Booleans, 3D Text & GPU Instancing (`<three-live>`)

Combines 2D `THREE.Shape` + hole paths with `THREE.ExtrudeGeometry`, manifold
CSG Boolean subtraction (`THREE.CSG.subtract`), extruded 3D vector text
(`THREE.TextGeometry`), and single-draw-call hardware GPU instancing
(`THREE.InstancedMesh` -> glTF `EXT_mesh_gpu_instancing` / USDZ
`PointInstancer`) with ACES Filmic tone mapping and HDR emissive bloom:

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
  shadow-intensity="0.8"
  style="width: 100%; height: 540px; display: block;">
  <script type="text/three">
    // 1. 2D CAD profile with central bore hole -> ExtrudeGeometry with bevels
    const flangeProfile = new THREE.Shape();
    flangeProfile.absarc(0, 0, 0.55, 0, Math.PI * 2, false);
    const centerHole = new THREE.Path();
    centerHole.absarc(0, 0, 0.22, 0, Math.PI * 2, true);
    flangeProfile.holes.push(centerHole);

    const flangeGeo = new THREE.ExtrudeGeometry(flangeProfile, {
      depth: 0.16,
      bevelEnabled: true,
      bevelThickness: 0.025,
      bevelSize: 0.02,
      bevelSegments: 2,
      curveSegments: 32
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.78,
      roughness: 0.24
    });
    const rawFlange = new THREE.Mesh(flangeGeo, steelMat);
    rawFlange.rotation.x = -Math.PI / 2;

    // 2. CSG Boolean Subtraction: machine a precision cross-slot through the flange
    const cutter = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.14, 0.16),
      steelMat
    );
    cutter.position.set(0, 0.12, 0);
    const machinedPart = THREE.CSG.subtract(rawFlange, cutter);
    machinedPart.name = 'machined-flange';
    machinedPart.userData.xr = { outline: { color: '#38bdf8', thickness: 0.02 } };
    scene.add(machinedPart);

    // 3. 3D Extruded Vector Text badge
    const badge = new THREE.Mesh(
      new THREE.TextGeometry('CAD R1', {
        size: 0.14,
        depth: 0.035,
        bevelEnabled: true,
        bevelThickness: 0.006,
        bevelSize: 0.005
      }),
      new THREE.MeshStandardMaterial({
        color: 0xf8fafc,
        emissive: 0x0ea5e9,
        emissiveIntensity: 0.45,
        metalness: 0.5,
        roughness: 0.2
      })
    );
    badge.name = 'cad-badge';
    badge.position.set(-0.32, 0.28, 0);
    scene.add(badge);

    // 4. GPU Instanced Bolt Ring (single draw call via EXT_mesh_gpu_instancing)
    const boltCount = 12;
    const bolts = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.22, 16),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.15 }),
      boltCount
    );
    bolts.name = 'bolt-ring';
    const mat4 = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < boltCount; i++) {
      const a = (i / boltCount) * Math.PI * 2;
      pos.set(Math.cos(a) * 0.39, 0.09, Math.sin(a) * 0.39);
      mat4.compose(pos, quat, scl);
      bolts.setMatrixAt(i, mat4);
    }
    scene.add(bolts);

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</three-live>
```

--------------------------------------------------------------------------------

## 11. Robotic Arm Inverse Kinematics (2-Bone & FABRIK IK) & Spatial Voice (`<xr-live>`)

Attaches declarative `userData.xr.ik` (`solver: 'two-bone'` or `'fabrik'`) so a
multi-joint articulated robotic arm continuously solves joint rotations toward a
grabbable 6DoF target orb, paired with `shared-room-voice` for WebRTC
peer-to-peer spatialized voice chat:

```html
<script type="module" src="/dist/xr-live-full.min.js"></script>

<xr-live
  id="ik-workbench"
  allow-client-scripts
  bloom="1.3"
  outline="#38bdf8 0.025"
  tone-mapping="agx"
  shared-room="robotics-lab-1"
  shared-room-voice
  peer-name="Operator"
  camera-controls
  style="width: 100%; height: 560px; display: block;">
  <script type="text/three">
    const armMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.25 });

    // Hierarchical bone chain: Shoulder -> Forearm -> WristEffector
    const shoulder = new THREE.Group();
    shoulder.name = 'Shoulder';
    shoulder.position.set(0, 0.75, -1.1);
    const upperLink = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.32), armMat);
    upperLink.position.set(0, 0, 0.16);
    shoulder.add(upperLink);

    const forearm = new THREE.Group();
    forearm.name = 'Forearm';
    forearm.position.set(0, 0, 0.32);
    const lowerLink = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.28), armMat);
    lowerLink.position.set(0, 0, 0.14);
    forearm.add(lowerLink);
    shoulder.add(forearm);

    const effector = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.6 })
    );
    effector.name = 'WristEffector';
    effector.position.set(0, 0, 0.28);
    effector.userData.xr = {
      ik: {
        target: 'GripperTarget',
        poleTarget: 'ElbowPole',
        solver: 'two-bone',
        chainLength: 2
      }
    };
    forearm.add(effector);
    scene.add(shoulder);

    // Pole vector hint keeping the elbow oriented upward
    const pole = new THREE.Group();
    pole.name = 'ElbowPole';
    pole.position.set(0, 1.35, -0.95);
    scene.add(pole);

    // Grabbable 6DoF target orb that the robotic arm tracks in real time
    const targetOrb = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 24, 24),
      new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.8 })
    );
    targetOrb.name = 'GripperTarget';
    targetOrb.position.set(0.22, 1.02, -0.78);
    targetOrb.userData.xr = {
      grab: '1-hand',
      outline: { color: '#22c55e', thickness: 0.025 },
      sync: true
    };
    scene.add(targetOrb);

    scene.add(new THREE.DirectionalLight(0xffffff, 2.2));
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  </script>
</xr-live>
```
