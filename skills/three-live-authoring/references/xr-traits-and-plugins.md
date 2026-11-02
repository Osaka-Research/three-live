# `<three-live>` & `<xr-live>` Complete Traits, Plugins & Events Reference

## 1. `<xr-live>` Host Attributes

`<xr-live>` inherits every `<three-live>` attribute (`src`, `ios-src`, `poster`, `scale`, `camera-orbit`, `camera-target`, `min-camera-orbit`, `max-camera-orbit`, `field-of-view`, `selected-mesh`, `camera-controls`, `ar`, `ar-modes`, `ar-scale`, `ar-placement`, `script-src`, `sandbox`, `allow-client-scripts`, `exposure`, `environment-image`, `skybox-image`, `shadow-intensity`, `shadow-softness`, `tone-mapping`, `autoplay`, `animation-name`, `auto-rotate`) and adds:

| Attribute | Values | Default | Description |
| :--- | :--- | :--- | :--- |
| `xr-mode` | `'ar' \| 'vr' \| 'inline' \| 'auto'` | `'auto'` | Target WebXR session mode. |
| `xr-depth` | `'occlusion' \| 'occlusion-physics' \| 'mesh' \| 'none'` | `'none'` | Hardware depth occlusion and analytical heightfield physics collision. |
| `xr-hands` | `'gestures' \| 'joints' \| 'pinch' \| 'none'` | `'none'` | 25-joint `XRHand` tracking and gesture classification (`pinch`, `grab`, `point`, `palm-up`). |
| `xr-simulator` | `'living-room' \| 'office' \| 'tabletop' \| 'none'` | `'none'` | Enables the desktop 6DoF keyboard/mouse simulator with room floor/table planes. |
| `xr-profile` | `'quest3' \| 'android-xr' \| 'visionos' \| 'auto'` | `'auto'` | Target hardware profile hint. |
| `sound-feedback` | boolean attribute | `false` | Plays procedural Web Audio earcons (`grab`, `release`, `bounce`, `hover`) on interaction. |
| `world-understanding` | `'' \| 'planes' \| 'planes reticle' \| 'false'` | — | Activates `xr-live-world-understanding` plane/mesh tracking and optional gaze reticle. |
| `spatial-paint` | `'' \| '#rrggbb' \| 'false'` | — | Activates `xr-live-spatial-paint`; pinching in empty space extrudes Catmull-Rom 3D tube strokes. |
| `spatial-measure` | `'' \| 'bounds' \| 'tape' \| 'all' \| 'none'` | — | Activates `xr-live-spatial-measure` 3D dimension callouts and/or interactive AR tape measure. |
| `measure-unit` | `'auto' \| 'm' \| 'cm' \| 'mm' \| 'in' \| 'ft-in'` | `'auto'` | Default display unit for `spatial-measure`. |
| `magnetic-snap` | `'' \| 'grid' \| 'surface' \| 'sockets' \| 'all' \| 'none'` | — | Activates `xr-live-magnetic-snap` socket, grid, surface, and yaw snapping. |
| `snap-grid` | `number` or `'gx gy gz'` (meters) | — | Default Cartesian snap grid spacing in meters. |
| `snap-angle` | `number` (`0..180` degrees) | `0` | Default rotational yaw snap increment in degrees. |
| `gaze-dwell` | `'' \| 'auto' \| 'false' \| 'none'` | — | Activates `xr-live-gaze-dwell` hands-free eye/head gaze reticle and radial dwell selection. |
| `dwell-time` | `number` (`250..10000` ms) | `1200` | Default dwell duration in milliseconds for `gaze-dwell`. |
| `explode` | `number` (`0..1`) | `0` | Normalized multi-part assembly explosion factor (`xr-live-exploded-view`). |
| `explode-mode` | `'radial' \| 'axial-x' \| 'axial-y' \| 'axial-z' \| 'hierarchical'` | `'radial'` | Automatic explosion vector strategy when parts omit `userData.xr.explode.direction`. |
| `explode-scale` | `number` | `1.0` | Multiplier applied to per-part explosion distances. |
| `section-plane` | `'none' \| 'x:<d>' \| 'y:<d>' \| 'z:<d>' \| '-x:<d>' \| '-y:<d>' \| '-z:<d>' \| 'interactive'` | `'none'` | Real-time GPU cross-section clipping plane (`d` in meters) with optional draggable gizmo frame. |
| `persistent-anchors` | `''` or `string` (namespace) | — | Activates `xr-live-persistent-anchors` cross-session transform persistence (`xr-live:anchors:<ns>`). |
| `persist-url-hash` | boolean attribute | `false` | Encodes persisted node poses into `#xr-state=<base64url>` (`<= 8192` bytes) for link sharing. |
| `locomotion` | `'' \| 'teleport' \| 'snap-turn' \| 'smooth' \| 'teleport snap-turn' \| 'none'` | — | Activates `xr-live-spatial-locomotion` parabolic teleportation, snap-turns, or smooth glide. |
| `snap-turn-deg` | `number` (degrees) | `30` | Horizontal thumbstick snap-turn increment in degrees. |
| `comfort-vignette` | boolean attribute | `true` | Shows a `120ms` peripheral FOV comfort vignette during teleports and snap-turns. |
| `shared-room` | `'<room-id>'` or `'wss://...'` | — | Joins a multi-user room via `BroadcastChannel("xr-live:room:<id>")` or a `wss://` relay (`xr-live-shared-room`). |
| `peer-name` | `string` (max `32` chars) | — | Local peer display name broadcast in `shared-room`. |
| `peer-color` | `'#rrggbb'` | `'#38bdf8'` | Local peer 3D visor & laser ray tint color in `shared-room`. |
| `webmcp` | boolean attribute | `false` | Registers `inspect_xr_scene`, `place_xr_object_at_gaze`, and `capture_xr_view` on `navigator.modelContext`. |
| `webmcp-allow-depth` | boolean attribute | `false` | Opt-in gate allowing `capture_xr_view` to include the 8×8 metric `depthGridMeters` array. |
| `webmcp-omit-pose` | boolean attribute | `false` | When present, `inspect_xr_scene` omits `headPosition` entirely. |

---

## 2. Canonical `userData.xr` Normalization & Clamping Rules

Defined in `three-live/src/xr-trait-schema.ts`:

### `follow` (`LazyFollowOptions`)
```ts
mesh.userData.xr = {
  follow: {
    mode: 'head',        // 'head' | 'hand-left' | 'hand-right' (default: 'head')
    lazy: true,          // false uses eager spring; true uses angular deadzone + critically damped spring
    distance: 1.0,       // [0.1, 10.0] meters (default: 1.0 for 'head', 0.15 for hands)
    deadzoneDeg: 15,     // [0, 90] degrees (default: 15 for 'head', 0 for hands)
    stiffness: 6,        // [0.5, 40] angular frequency omega (default: 6)
    height: -0.1,        // [-2.0, 2.0] vertical offset in meters (default: -0.1 for 'head', 0.12 for hands)
    faceUser: true,      // boolean (default: true)
    snapOnStart: true,   // boolean (default: true)
  },
};
```

### `orbit` (`OrbitOptions`)
```ts
mesh.userData.xr = {
  orbit: {
    target: 'sun',       // [x, y, z] finite tuple OR target mesh name (max 256 chars; default: [0, 0, 0])
    radius: 0.5,         // [0.01, 50] meters (default: 0.5)
    speed: 0.5,          // [-20, 20] radians/sec (default: 0.5)
    height: 0.0,         // [-10, 10] meters vertical offset from target (default: 0)
    phase: 0.0,          // [-1e6, 1e6] initial angle in radians (default: 0)
    faceCenter: false,   // boolean (default: false)
  },
};
```

### `handles` (`HandlesOptions`)
```ts
mesh.userData.xr = {
  handles: {
    rotateAxis: 'y',     // 'y' | 'none' (default: 'y')
    minScale: 0.1,       // [0.001, 1000] (default: 0.1)
    maxScale: 10.0,      // [minScale, 1000] (default: max(minScale, 10))
  },
};
```

### `particles` (`ParticleOptions`)
```ts
mesh.userData.xr = {
  particles: {
    preset: 'rain',      // 'rain' | 'snow' | 'sparks' | 'confetti' (default: 'rain')
    count: 600,          // [1, 2000] (defaults: rain=600, snow=400, sparks=300, confetti=300)
    area: [2, 2, 2],     // number or [x, y, z], each axis clamped to [0.05, 50] meters (default: [2, 2, 2])
    speed: 1.0,          // [0.05, 10] speed multiplier (default: 1.0)
  },
};
```

### `holdToAsk` (`HoldToAskOptions`)
```ts
mesh.userData.xr = {
  holdToAsk: {
    prompt: 'What is this?', // max 4000 chars (default: 'What is this?')
    holdMs: 600,             // [100, 5000] ms press-and-hold threshold (default: 600)
  },
};
```

### `dimensions` (`DimensionsOptions`)
```ts
mesh.userData.xr = {
  dimensions: {
    enabled: true,           // false disables (default: true)
    unit: 'auto',            // 'auto' | 'm' | 'cm' | 'mm' | 'in' | 'ft-in' (default: 'auto')
    axes: ['x', 'y', 'z'],   // subset of ['x', 'y', 'z'] or string 'xyz' (default: ['x', 'y', 'z'])
    color: '#38bdf8',        // sanitized #rgb / #rrggbb hex color (default: '#38bdf8')
    showOnSelect: false,     // when true, only displays callouts while selected (default: false)
  },
};
```

### `snapTo` & `snapSocket` (`SnapToOptions` / `SnapSocketOptions`)
```ts
// On the movable / grabbable part:
part.userData.xr = {
  grab: '1-hand',
  snapTo: {
    grid: [0.05, 0.05, 0.05], // number or [gx, gy, gz] clamped to [0.001, 100] m (default: null)
    angleDeg: 15,             // [0, 180] yaw snap increment in degrees (default: 0)
    surface: 'floor',         // 'none' | 'floor' | 'wall' | 'ceiling' | 'any' (default: 'none')
    socketTag: 'module-bay',  // max 128 chars matching a snapSocket.tag (default: '')
    radius: 0.15,             // [0.01, 2.0] m capture radius; 1.25x breakaway hysteresis (default: 0.15)
  },
};

// On the stationary target socket:
dock.userData.xr = {
  snapSocket: {
    tag: 'module-bay',        // required non-empty tag (max 128 chars)
    radius: 0.15,             // [0.01, 2.0] m capture radius; 1.5x pulsing preview ring (default: 0.15)
    alignRotation: true,      // slerps snapped part to socket orientation (default: true)
    highlightColor: '#22c55e',// sanitized hex color for preview ring (default: '#22c55e')
  },
};
```

### `gaze` (`GazeOptions`)
```ts
mesh.userData.xr = {
  gaze: {
    enabled: true,           // false disables (default: true)
    dwellMs: 1200,           // [250, 10000] ms after 150ms grace delay (default: 1200)
    repeat: false,           // when true, re-arms continuously while gazing (default: false)
    action: 'select',        // 'select' (fires meshclick + KHR_interactivity) | 'ask' (queries Gemini Live)
  },
};
```

### `explode` (`ExplodeOptions`)
```ts
mesh.userData.xr = {
  explode: {
    enabled: true,           // false pins a base/chassis mesh at rest (default: true)
    direction: [0, 1, 0],    // normalized [x, y, z] unit vector, or null to use explode-mode
    distance: 0.35,          // [0, 10] meters at explode="1" (default: 0.35)
    layer: 2,                // integer [1, 10] — outer layers separate earlier in staggered mode (default: 1)
    leaderLine: true,        // renders dashed 3D leader line back to rest position (default: true)
  },
};
```

### `anchor` Persistence (`AnchorPersistOptions`), `navigable`, & `sync`
```ts
mesh.userData.xr = {
  anchor: {
    target: 'table',         // optional: 'floor' | 'wall' | 'ceiling' | 'table' | 'horizontal' | 'vertical'
    id: 'turntable-1',       // sanitized key (max 128 chars; rejects __proto__/constructor/prototype)
    persist: true,           // persists across #xr-state URL hash, localStorage, and WebXR XRAnchor
  },
  navigable: 'walkable',     // true | 'walkable' | false | 'blocked' (spatial-locomotion)
  sync: true,                // boolean (shared-room; defaults to true on grabbable nodes)
};
```

---

## 3. Declarative `KHR_interactivity` Authoring (`userData.interactivity`)

Any mesh or group inside `<script type="text/three">` can declare interactive state machines compiled into standard Khronos `KHR_interactivity` graphs (`three-live/src/interactivity-compiler.ts`):

- **Triggers:**
  - `onSelect`: Fired when clicked/tapped or pinched in XR (`pointer/onSelect`).
  - `onHoverIn` / `onHoverOut`: Fired on pointer/ray hover enter and exit.
  - `onStart`: Fired automatically when the scene loads (`event/onStart`).
  - `onReceive`: `{ [eventName: string]: Action | Action[] }` — reacts to custom events sent by `sendEvent`.
- **Actions (single object or array executed in sequence):**
  - `{ action: 'toggleTransform', property: 'translation' | 'rotation' | 'scale', to: number[], from?: number[], duration?: number }`
  - `{ action: 'interpolate', target?: string, property: 'translation' | 'rotation' | 'scale' | 'baseColorFactor' | 'metallicFactor' | 'roughnessFactor' | 'emissiveFactor', to: number | number[], duration?: number }`
  - `{ action: 'setProperty', target?: string, property: string, value: any }`
  - `{ action: 'toggleVisibility', target?: string }`
  - `{ action: 'cycleMaterialColor', colors: Array<[number, number, number, number?]>, duration?: number }`
  - `{ action: 'playAnimation', animation?: number }` / `{ action: 'stopAnimation' }`
  - `{ action: 'sendEvent', event: string, values?: Record<string, any> }`

---

## 4. Programmatic Plugin Controllers (`xr-live/plugins`)

When importing from `xr-live/plugins` (or using `xr-live-plugins.min.js` / `xr-live-full.min.js`):

- **Gemini Live (`gemini-live.ts`):**
  ```ts
  import { connectGeminiLive } from 'xr-live/plugins';

  const live = connectGeminiLive(xrElement, {
    url: 'wss://your-backend.example.com/gemini-live', // wss:// required (or ws://localhost)
    model: 'models/gemini-2.0-flash-exp',
    systemInstruction: 'You are a spatial assistant.',
    frameIntervalMs: 1000,   // clamped to [250, 60000] ms
    streamAudio: true,       // streams 16 kHz PCM mic chunks
    playAudio: true,         // plays streamed 24 kHz PCM model audio
    speakReplies: false,     // SpeechSynthesis fallback
    detectObjects: true,     // auto-registers report_objects tool -> xr-object-detected events
  });
  ```
- **Spatial Paint (`spatial-paint.ts`):**
  ```ts
  import { getSpatialPaintController } from 'xr-live/plugins';

  const paint = getSpatialPaintController(xrElement);
  paint.color = [0.22, 0.74, 0.97, 1.0];
  paint.radius = 0.008;
  paint.undo(xrElement.viewer);
  paint.clear(xrElement.viewer);
  ```
- **World Understanding (`world-understanding.ts`):**
  ```ts
  import { detectObjects, parseDetections, XRTapeMeasure } from 'xr-live/plugins';

  const detections = parseDetections('[{"label":"chair","box":[200,300,800,700]}]');
  const located3D = detectObjects(xrElement, detections);
  ```
- **Spatial Measure, Exploded View, Persistent Anchors, Locomotion & Shared Room:**
  ```ts
  import {
    getSpatialMeasureController,
    getMagneticSnapController,
    getGazeDwellController,
    getExplodedViewController,
    getPersistentAnchorsController,
    getSpatialLocomotionController,
    getSharedRoomController,
  } from 'xr-live/plugins';

  xrElement.setExplode(0.65);                     // Smoothly animate exploded-view [0..1]
  xrElement.clearMeasurements();                  // Clear locked 3D tape-measure segments
  const token = xrElement.exportAnchorState();    // Base64url layout snapshot (<= 8 KB)
  xrElement.importAnchorState(token);             // Restore layout snapshot programmatically
  xrElement.teleportTo([0, 0, -1.5]);             // Teleport viewer rig + emit xrteleport
  const peers = xrElement.getSharedPeers();       // Active RemotePeerState[] in shared-room
  ```

---

## 5. DOM Events Summary

| Event Name | Dispatched By | `event.detail` Payload |
| :--- | :--- | :--- |
| `load` | `<three-live>` / `<xr-live>` | `{ model: GLBData }` |
| `error` | `<three-live>` / `<xr-live>` | `{ error: Error }` |
| `meshclick` | `<three-live>` / `<xr-live>` | `{ meshName, hitPoint, normal, distance }` |
| `camera-change` | `<three-live>` / `<xr-live>` | `{ theta, phi, distance }` |
| `ar-status` | `<three-live>` / `<xr-live>` | `{ status: 'session-started' \| 'not-presenting' \| 'failed', error? }` |
| `interactivityEvent` | `KHR_interactivity` VM | `{ id: string, values: Record<string, any> }` |
| `xr-select-start` / `move` / `end` | `XRInputManager` | `{ hand: 'left' \| 'right' \| 'screen', pivotPosition, quaternion, rayOrigin, rayDirection, hit }` |
| `xr-handles-change` | `manipulation-handles` | `{ mesh, scale: number, yawDeg: number }` |
| `xr-object-detected` | `world-understanding` | `{ label: string, position: [number, number, number], distanceMeters: number, source: 'plane' \| 'depth' \| 'fallback' }` |
| `xr-transcription` | `gemini-live` | `{ speaker: 'user' \| 'model', text: string, isFinal: boolean }` |
| `xr-hold-to-ask-listening` | `gemini-live` | `{ mesh: string }` |
| `xr-hold-to-ask` | `gemini-live` | `{ mesh: string, transcript: string, prompt: string }` |
| `xr-gemini-interrupted` | `gemini-live` | `{}` |
| `xr-paint-stroke` | `spatial-paint` | `{ index: number, points: number, lengthMeters: number }` |
| `measurecomplete` | `spatial-measure` | `{ start: [x,y,z], end: [x,y,z], distanceMeters: number, formatted: string }` |
| `xrsnap` | `magnetic-snap` | `{ node, socket, position: [x,y,z], quaternion: [x,y,z,w], mode: 'socket' \| 'grid' \| 'surface' \| 'angle' }` |
| `xrunsnap` | `magnetic-snap` | `{ node, socket }` |
| `gazeenter` / `gazeleave` | `gaze-dwell` | `{ node, point: [x,y,z] }` / `{ node }` |
| `gazedwell` | `gaze-dwell` | `{ node, point: [x,y,z], action: 'select' \| 'ask' }` |
| `explodechange` | `exploded-view` | `{ factor: number, source: 'attribute' \| 'gesture' \| 'api' \| 'peer' }` |
| `anchorsrestored` | `persistent-anchors` | `{ count: number, source: 'xr-anchor' \| 'storage' \| 'url-hash' }` |
| `xrteleport` | `spatial-locomotion` | `{ from: [x,y,z], to: [x,y,z], yawDeg: number }` |
| `peerjoin` / `peerleave` | `shared-room` | `{ peerId: string, name: string, color: string }` |
| `peersync` | `shared-room` | `{ peerId: string, nodeId: string }` |
| `xr-webmcp-capture` | `xr-extras` (WebMCP) | Fired when `capture_xr_view` captures a frame (`data-xr-webmcp-indicator="active"`). |
