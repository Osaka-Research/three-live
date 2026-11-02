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
| `xr-webmcp-capture` | `xr-extras` (WebMCP) | Fired when `capture_xr_view` captures a frame (`data-xr-webmcp-indicator="active"`). |
