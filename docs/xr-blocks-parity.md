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

### Exporter differences to be aware of

| Topic | Web exporter (`sceneToCanvas3D`) | Native compiler (Rust) |
| --- | --- | --- |
| Nodes | Every `Object3D` (groups, lights, meshes) in DFS order. | One node per non-empty mesh, flat, with the accumulated `translation` / `scale` (rotation of ancestors is not yet propagated). |
| Interactivity targets | `target: '<node name>'` resolves on both. Numeric `targetNode`, raw `pointer` strings and raw `scene.userData.interactivity` graphs use this exporter's node numbering. | Same name resolution; numeric indices refer to the flat mesh list. Prefer `target` names. |
| Traits on groups | Exported on the group node. | Ignored with an author warning; attach traits to meshes. |
| Size caps | None. | `userData.xr` ≤ 15 KB per mesh (larger bags keep only canonical traits), compiled graph ≤ 256 KB. |

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
| Manipulation handles | `plugins/manipulation-handles.ts` | `ManipulationHandles` + SceneCore `ResizableComponent` | `ManipulationHandles` + RealityKit gestures |
| World understanding | `plugins/world-understanding.ts` | `WorldUnderstanding.unprojectDetection()` + ARCore | `WorldUnderstanding.unprojectDetection()` + ARKit |
| Gemini Live / hold-to-ask | `plugins/gemini-live.ts` | `holdToAsk` metadata + host speech APIs | `holdToAsk` metadata + host speech APIs |
| Spatial paint | `plugins/spatial-paint.ts` | `TubeStrokeBuilder` | `TubeStrokeBuilder` |
| Depth particles | `plugins/depth-particles.ts` | `ParticleEmitter` | `ParticleEmitter` |
| Gaussian splats | `plugins/splat-loader.ts` | `SplatParser` | `SplatParser` |

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
  sampled depth, a tracked plane, or 1.5 m.
- **Tube strokes**: uniform Catmull-Rom (4 samples/span), rotation-minimizing
  frames (double reflection), 8 radial segments, flat caps.
- **Particles**: presets `rain` / `snow` / `sparks` / `confetti`, mulberry32
  RNG, respawn at the volume top on floor / depth collision.
- **Splats**: `.splat` (32-byte records) and `.spz` v2 / v3 (gzip or raw).
