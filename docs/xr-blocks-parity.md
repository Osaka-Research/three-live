# XR Blocks Multi-Platform Parity

`three-live` / `xr-live` scenes are authored once (Three.js `userData` or
glTF) and run on the web (`<three-live>` / `<xr-live>`), Android (Filament +
Jetpack XR SceneCore) and iOS / visionOS (RealityKit). This document is the
contract every platform implements.

## 1. Authoring

```js
lamp.userData.xr = {
  grab: true,                                   // or '1-hand' | '2-hand'
  scale: {min: 0.5, max: 3},
  follow: {mode: 'head', distance: 1.2, deadzoneDeg: 20},  // lazy HUD
  orbit: {target: 'Sun', radius: 0.4, speed: 0.6},
  handles: {rotateAxis: 'y', minScale: 0.5, maxScale: 3},
  particles: {preset: 'snow', count: 400, area: [2, 2, 2]},
  holdToAsk: {prompt: 'What lamp is this?'},
  worldUnderstanding: {planes: true, reticle: true},
  splatUrl: 'room.spz',
  spatialSlot: 'info-card',
  audio: {src: 'hum.mp3', refDistance: 1, loop: true},
};
lamp.userData.interactivity = {onSelect: {action: 'toggleVisibility'}};
```

## 2. Canonical compiled form

The single source of truth is
[`three-live/src/xr-trait-schema.ts`](../three-live/src/xr-trait-schema.ts).
The web exporter (with `xr-live-blocks` loaded) and the Rust compiler (which
runs the same TypeScript inside its embedded engine) both emit:

| Location | Content |
| --- | --- |
| `nodes[i].extras.xr` | Authored keys merged with `normalizeXRTraits()` output (clamped numbers, legacy aliases `grabbable` / `scalable`). |
| `nodes[i].extensions.ANDROID_xr_scenecore` | `buildXRSceneCoreExtension()` component map: `interactable`, `movable`, `billboard`, `follow`, `anchor`, `rigidbody`, `orbit`, `resizable`, `particles`, `holdToAsk`, `worldUnderstanding`, `splat`, `spatialPanel`, `spatialAudio`. |
| root `extensions.KHR_interactivity` (+ `extensionsUsed`) | Behavior graph compiled by `compileInteractivityGraph()` (`interactivity-compiler.ts`). |
| USDZ `customData = {dictionary xr = {...}}` | `flattenXRTraitsForUsd()`: typed scalars such as `double followDistance`, `bool handles`, `string particlesPreset`. |

Eager follows stay strings (`"follow": "head"`, and `{lazy: false}` objects
normalize to strings); XR Blocks lazy follows are objects with `"lazy": true`.

`MOZ_hubs_components` uses the Hubs shape (`grabbable`, `billboard.onlyY`).
`splatUrl` and `audio.src` are kept only when they are `https:` URLs or plain
relative paths (no `..`, `%`, `\`, scheme, or `//`).

### Web and native exports share one node list

Both exporters emit every `Object3D` under the scene (groups, lights, empty
objects and meshes) as a glTF node in the same pre-order DFS, with local
translation / rotation / scale and `children`. Traits and interactivity work
on any node, and numeric indices (`targetNode`, raw `pointer` strings, raw
`scene.userData.interactivity` graphs) mean the same node on web and native.
`compiler/tests/fixtures/hierarchy_parity.expected.json` pins both exporters
to the same output (`three-live/tests/hierarchy_parity_test.ts` and the Rust
test `test_hierarchy_matches_web_exporter_fixture`).

The native compiler additionally enforces size caps: `userData.xr` ≤ 15 KB per
node (larger bags keep only canonical traits), compiled graph ≤ 256 KB, and at
most `SECURITY_3D_MAX_MESHES × 4` nodes.

### Clamping (identical on every platform)

| Trait | Field | Range | Default |
| --- | --- | --- | --- |
| `follow` (head) | `distance` / `deadzoneDeg` / `stiffness` / `height` | 0.1–10 / 0–90 / 0.5–40 / −2–2 | 1.0 / 15 / 6 / −0.1 |
| `follow` (hand) | same | same | 0.15 / 0 / 6 / 0.12 |
| `orbit` | `radius` / `speed` (rad/s) / `height` / `phase` | 0.01–50 / −20–20 / −10–10 / ±1e6 | 0.5 / 0.5 / 0 / 0 |
| `scale` (grab) | `min` / `max` | 0.001–1000, max ≥ min | 0.05 / 5 |
| `handles` | `minScale` / `maxScale` | 0.001–1000, max ≥ min | 0.1 / 10 |
| `particles` | `count` / `area` / `speed` | 1–2000 / 0.05–50 per axis / 0.05–10 | preset / 2 / 1 |
| `holdToAsk` | `holdMs` / `prompt` | 100–5000 / ≤ 4000 chars | 600 / "What is this?" |

## 3. Runtime behavior

| Feature | Web | Android | iOS / visionOS |
| --- | --- | --- | --- |
| `KHR_interactivity` | `plugins/interactivity.ts` | `XRLiveRuntimeSession.kt` | `XRLiveRuntimeSession.swift` |
| Lazy follow + orbit | `plugins/head-follow.ts` | `XRLiveRuntimeSession.step()` | `XRLiveRuntimeSession.step()` |
| Manipulation handles | `plugins/manipulation-handles.ts` | `XRBlocksFeatures` (any `ThreeLiveSceneRenderer` with dynamic meshes) | `XRBlocksRealityKitFeatures` |
| World understanding | `plugins/world-understanding.ts` | `WorldUnderstanding.unprojectDetection()` + ARCore | `WorldUnderstanding.unprojectDetection()` + ARKit |
| Gemini Live / hold-to-ask | `plugins/gemini-live.ts` | `gemini/XRGeminiLiveController` + `HoldToAskController` | `Gemini/XRGeminiLiveController` + `HoldToAskController` |
| Camera + `camera-change` | `three-view.ts` orbit camera | `OrbitCameraState` (via `ThreeLiveRenderer`) | `XROrbitCameraState` |
| Hand gestures | `xr-gestures.ts` | `XRHandGestures` (host supplies joints) | `XRHandGestureClassifier` + `XRHandTrackingSource` (visionOS) |
| Object detection | `world-understanding.ts` | `ThreeLiveDetections.detect()` | `XRDetections.detect()` |
| Rendering | WebGL2 viewer | `ThreeLiveRenderer`; optional `:mobile:android-filament` | RealityKit |
| Spatial paint | `plugins/spatial-paint.ts` | `XRBlocksFeatures.paintColor` (`TubeStrokeBuilder`) | `XRBlocksRealityKitFeatures.paintColor` |
| Depth particles | `plugins/depth-particles.ts` | `XRBlocksFeatures` (`ParticleEmitter`, camera-facing quads) | `XRBlocksRealityKitFeatures` |
| Gaussian splats | `plugins/splat-loader.ts` | `SplatParser` (parse only; rendering not yet native) | `SplatParser` (parse only; rendering not yet native) |

Native source locations:

- Android (`mobile/android/src/main/java/com/google/threelive/`):
  `XRLiveRuntimeSession.kt` (VM + follow/orbit), `XRLiveSceneCoreHelper.kt`
  (canonical trait parsing, SceneCore applier hooks), `XRBlocksMath.kt`
  (follow, handles, world understanding), `TubeStrokeBuilder.kt`,
  `ParticleEmitter.kt`, `SplatParser.kt`, `MiniJson.kt` (zero-dependency JSON).
- iOS / visionOS (`mobile/ios/Sources/ThreeLiveCompiler/`):
  `XRLiveRuntimeSession.swift` (VM + follow/orbit), `XRLiveRealityKitSession.swift`
  (`@MainActor` RealityKit binding), `XRLiveTraits.swift`, `XRBlocksMath.swift`,
  `XRBlocksGeometry.swift`, `SplatParser.swift`.

All three VMs share the same safety limits: 1024 graph nodes, 256 variables,
2048 flow steps per invocation (shared by nested `event/send`), 10 000 value
evaluations per invocation, `flow/for` nesting ≤ 8, 128 tweens, 64 delays,
16 nested custom events, and a pointer whitelist with forbidden-segment
rejection. Native runtimes also cap GLB JSON chunks at 32 MiB, nodes /
materials at 65 536, and decompressed `.spz` at 128 MiB. Native hosts call
`start()` (or it runs lazily on the first `step` / dispatch).

Shared algorithms (all platforms):

- **Lazy follow**: target = anchor + horizontal forward × `distance` +
  `height`. Start following when the horizontal angle to the object exceeds
  `deadzoneDeg`, or the radial / vertical error exceeds
  `max(0.05, 0.35 × distance)`; stop when within 1 cm and slower than 1 cm/s.
  Integrate with the exact critically damped spring
  (`decay = e^(−ω·dt)`, `temp = (v + ω·Δ)·dt`, `v' = (v − ω·temp)·decay`,
  `x' = target + (Δ + temp)·decay`).
- **Orbit**: `θ = phase + speed·t`; position = center + (cos θ·r, height,
  sin θ·r).
- **Handles**: corner drag scales uniformly about the mesh origin by the
  ratio of pointer distances; pedestal drag yaws about +Y by the pointer
  angle delta (`atan2(dx, dz)`).
- **Detection unprojection**: boxes are `[ymin, xmin, ymax, xmax]` in 0–1
  or Gemini 0–1000; the box center is unprojected along the camera ray to the
  sampled depth, a tracked plane, or 1.5 m. Host-supplied detections arrive as
  a JSON string `[{label, box}]` (`box_2d` accepted as an alias), capped at
  16 KB, 32 entries and 256-character labels; malformed entries are skipped.
  Parsers: web `parseDetections()`, Android `ThreeLiveDetections.parse()`,
  iOS `XRDetections.parse(json:)`. Android renderers expose the camera through
  `ThreeLiveSceneRenderer.cameraMatrices()`; `ThreeLiveRuntimeBinding.detect()`
  unprojects against it. For continuous on-device detection (~2 Hz), Android
  provides `ThreeLiveObjectDetector` / `ThreeLiveObjectDetectors` /
  `ObjectDetectionLoop` plus the optional `:mobile:android-detect-mlkit` module
  (`ThreeLiveMlKitDetector.install()`), and iOS provides `XRObjectDetector` /
  `XRObjectDetectors` / `XRObjectDetectionLoop` plus `XRVisionDetector` (Apple
  Vision `VNCoreMLRequest` with an app Core ML model, or built-in animal/human
  requests when no model is supplied).
- **Tube strokes**: uniform Catmull-Rom (4 samples/span), rotation-minimizing
  frames (double reflection), 8 radial segments, flat caps.
- **Particles**: presets `rain` / `snow` / `sparks` / `confetti`, mulberry32
  RNG, respawn at the volume top on floor / depth collision.
- **Splats**: `.splat` (32-byte records) and `.spz` v2 / v3 (gzip or raw).

## 4. Gemini Live on native

The native clients port `gemini-live.ts` (same message shapes, transcript
accumulation, barge-in, 4000-character caps and hold-to-ask prompt) and need no
extra dependencies.

- **Default transport: plain Live API.** Android `WebSocketLiveTransport`
  (built-in RFC 6455 client, platform TLS with hostname verification) and iOS
  `URLSessionLiveTransport`. Only `wss:` URLs are accepted, plus `ws:` to
  loopback for local development.
- **Credentials.** Mint an [ephemeral token](https://ai.google.dev/gemini-api/docs/ephemeral-tokens)
  on your backend and connect with `GeminiLiveEndpoints.ephemeralTokenUrl(token)`
  (Android) / `GeminiLiveEndpoints.ephemeralTokenURL(token:)` (iOS), or point
  the transport at your own `wss://` proxy that adds credentials server-side.
  Constrain tokens on the backend (`live_connect_constraints`: model, system
  instruction, tools).
- **Dev-only API keys.** `devApiKeyUrl(...)` warns loudly and is refused in
  release builds (Android: `FLAG_DEBUGGABLE`; iOS: `#if DEBUG`). Never ship a key.
- **Optional Firebase AI Logic adapter.** Android module
  `:mobile:android-firebase-ai` (`FirebaseLiveTransport`), iOS local package
  `mobile/ios/FirebaseAdapter` (`ThreeLiveFirebaseAI`). The core libraries and
  the root `Package.swift` never depend on Firebase.
- **Audio and speech.** Android `AudioTrackPcmSink`, `MicrophoneStreamer`
  (`RECORD_AUDIO`), `HoldToAskController` (`SpeechRecognizer`); iOS
  `AVAudioPcmSink`, `MicrophoneStreamer` (`NSMicrophoneUsageDescription`),
  `HoldToAskController` (`SFSpeechRecognizer`,
  `NSSpeechRecognitionUsageDescription`). Without speech permission,
  hold-to-ask sends the trait's default prompt.
- Connect only after a user interaction, never at load.
- **Frames.** Like web, native clients stream what the user sees (about 1 fps, longest edge
  768 px, JPEG quality 0.6) once connected. Android: `RendererFrameSource(renderer)` over
  `ThreeLiveSceneRenderer.captureFrame()` (Filament reads back the rendered frame). iOS:
  `ARViewFrameSource(arView:)` (`ARView.snapshot`; includes the camera feed in AR mode). Both
  keep the camera matrices of recently sent frames so detections reported for an image can be
  unprojected against the camera that produced it. Pause them while the view is hidden.
- **Object detection tool (opt-in).** With `detectObjects` (web `GeminiLiveOptions`, Android
  `GeminiLiveOptions`, iOS `connect(..., detectObjects: true)`), the client adds a
  `report_objects({objects: [{label, box_2d: [ymin, xmin, ymax, xmax]}]})` function
  declaration (Gemini's native 0–1000 boxes) to the `setup` tools, answers each call with
  `toolResponse {ok: true, located: n}`, and turns the boxes into object detections: web fires
  `xr-object-detected` (unprojected with the camera of the last frame sent); Android
  `Listener.onObjectsReported(boxes)` and iOS `onObjectsReported` hand them to the host, which
  locates them with `RendererFrameSource.locate()` / `ARViewFrameSource.history.latest`. Tool
  arguments are untrusted model output and go through the same validation as the `detections`
  prop (at most 8 calls per message). Calls to other functions are left to the host. With
  ephemeral tokens whose setup is locked on the backend, declare the tool there (e.g. in
  `live_connect_constraints.config.tools`, using the declaration exported as
  `REPORT_OBJECTS_DECLARATION`), because the client cannot change a locked setup.

## 5. Native XR Blocks features

`XRBlocksFeatures` (Android, renderer-agnostic) and `XRBlocksRealityKitFeatures`
(iOS / visionOS) consume world-space pointer rays from the host and draw with
dynamic meshes:

- **Handles** on nodes with a `handles` trait (needs mesh bounds: `POSITION`
  accessor `min` / `max` on Android, RealityKit visual bounds on iOS). Corner
  drags scale uniformly within the trait's limits; the pedestal bar yaws.
  Reports `{mesh, scale, yawDeg}`.
- **Spatial paint** when a paint color is set: a drag that starts on empty
  space draws a tube 0.4 m in front of the camera (the web screen-paint depth),
  rebuilt every 3 points, capped at 256 strokes × 2048 points. Reports
  `{index, points, lengthMeters}`.
- **Particles** on nodes with a `particles` trait, using the shared
  `ParticleEmitter` (same presets and seeds) as camera-facing quads, with an
  optional floor height.
- **Splats** are parsed natively (`SplatParser`), but native point-sprite
  rendering is not implemented yet; use `<xr-live>` for splat scenes.

Handles use the session's scene-space transforms, so turn auto-rotate off on
scenes that use handles (the turntable rotates the model, as on web).
