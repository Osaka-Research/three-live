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

# Changelog

All notable changes to **Three-Live** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

--------------------------------------------------------------------------------

## [Unreleased]

### Added

-   **Runtime Image → Scene (`compileFromImage`, B4):** Synthesizes procedural
    Three.js scenes from photos, sketches, or blueprints across Web
    (`el.compileFromImage(image, { prompt, priors, maxDimension, quality,
    maxRepairs, dryRun, signal })`), Android
    (`ThreeLiveAIEditor.compileFromImage(bitmap / jpegOrPngBytes / imageDataUrl,
    ...)`), iOS/visionOS
    (`AIEditor.compileFromImage(cgImage: / imageData: / imageDataUrl:, ...)`),
    CLI (`three-live-cli from-image <input> [-o out.js] [--glb out.glb] [--usdz
    out.usdz] [--render out.png] [--prompt ...] [--priors priors.json]`), and
    MCP (`three_live_from_image`). Shared Rust core (`compiler/src/ai_image.rs`,
    `ai_call` ops `from_image_messages`, `from_image_validate`, and
    `from_image_repair_messages`) enforces spatial quality gates
    (`meshCount >= 2`, finite non-degenerate bounds, `frustumCoverage >= 0.05`,
    and zero critical overlap errors), performs one-turn auto-repair with exact
    compiler/spatial diagnostics, preserves a compiling fallback candidate when
    repair fails, supports optional metric spatial priors (`AISpatialPriors`:
    `userHeight`, `floorNormal`, and detected 3D object boxes), and records undo
    history so `undoEdit()` reverts to the previous scene. Multimodal
    `AIChatMessage` support (`content: string | AIChatContentPart[]`) added
    across Web, Android, iOS, and Rust.

-   **Opt-in WebGPU `GPURenderBundle` scene accelerator
    (`three-live-webgpu.min.js`, `< 17 KB gz`):** Compiles multi-thousand-part
    CAD assemblies, `EXT_mesh_gpu_instancing` scenes, and glTF PBR models into
    pre-recorded 4× MSAA `GPURenderBundle`s backed by a 128-byte-stride storage
    buffer and a single 464-byte per-frame `SceneUniforms` upload, with zero
    byte impact on `three-live-viewer`, `three-live`, `xr-live-viewer`, and
    `xr-live`. Supports `renderer="auto | webgpu | webgl2"` (default `"auto"`),
    equirectangular IBL, all 5 tone-mapping curves (`neutral`, `reinhard`,
    `none`, `aces`, `agx`), clearcoat, normal/MR/AO/emissive maps, planar
    contact shadows, CAD section-plane clipping, `stereoSBS`, 1×1-scissor
    `pickMeshGPU`, shared `GPUDevice` coordination, and automatic WebGL2
    fallback for WebXR, `bloom`/`outline`, transmission, skinning/morphs, and
    custom shaders. Included in `three-live-full` (`< 180 KB gz`) and
    `xr-live-full` (`< 288 KB gz`).

-   **Opt-in WebGPU Gaussian Splatting accelerator (`xr-live-webgpu.min.js`,
    `< 12 KB gz`):** Offloads `.splat` and `.spz` depth sorting (deterministic
    2-pass 8-bit tiled WGSL `@compute` radix sort matching `sortSplatsByDepth`
    bit-for-bit) and Degree 1–3 fp16-packed Spherical Harmonics to WebGPU, with
    zero byte overhead on `three-live-viewer`, `three-live`, `xr-live-viewer`,
    and `xr-live`. Supports `splat-renderer="auto | webgpu | hybrid | webgl2"`
    (default `"auto"`): renders oriented anisotropic eigenvector quads directly
    from VRAM via `drawIndirect` onto a premultiplied
    `<canvas class="three-live-webgpu-layer">` overlay for pure-splat desktop
    scenes, and automatically switches to a double-buffered `GPUBuffer.mapAsync`
    WebGL2 coprocessor during active WebXR `XRWebGLLayer` stereo sessions or
    mixed glTF + splat Z-occluded scenes. Included in `xr-live-full` (budget
    `< 259 KB gz`).

-   **Bring-your-own-LLM scene editing (`three-live-ai.min.js`, `< 5 KB gz`):**
    `el.editScene(instruction, { selection, maxRepairs, dryRun, signal })` sends
    the current scene script and selected mesh to any LLM, compiles the reply in
    the element's sandbox before touching the live scene, retries once with the
    exact error, rejects edits that empty the scene or silently drop the
    selected mesh, then hot-swaps (`el.undoEdit()` reverts). Providers:
    `ai-chat` (any Chat Completions-compatible endpoint via `ai-endpoint` /
    `ai-model`, or `createAIChatProvider()`) or any custom
    `{ complete({ messages, signal }) }` object. Emits `three-live-edit-start`
    and `three-live-edit` events. Included in `three-live-full` and
    `xr-live-full` (budgets raised to `< 146 KB gz` and `< 246 KB gz`); core
    bundles are unchanged.

-   **Talk-to-Select (B2b-4), multi-select:** `el.selectedMeshes` holds the
    selection (`selected-mesh` stays its first entry); `setSelection(el, names,
    {mode: 'replace' | 'add' | 'remove' | 'toggle' | 'clear'})` changes it; the
    viewer highlights every selected mesh; `three-live-select` now carries
    `{mesh, meshes, added, removed, source, query?}`. With `ai-select-on-tap`,
    Shift / Ctrl / Cmd-tap or a long press adds to the selection. `editScene`
    (web and the shared Rust core) accepts several selected meshes and rejects
    edits that lose any of them. Removing `selected-mesh` now also clears the
    highlight. `xr-live-viewer.min.js` budget: `< 55 KB gz` (was `< 54`).

-   **Talk-to-Select (B2b-4), voice selection without a model call:** say
    "select the two red chairs on the left" and the tier-1 matcher resolves it
    against the loaded scene: names (with synonyms and plurals), material
    colors, camera-relative left / right / front / back, top / bottom,
    biggest / smallest / tallest, ordinals ("the second mug"), counts
    ("both", "three"), "all … except …", and lists ("the lamp and the sofa").
    It also recognizes relations ("the cup next to the sofa") and leaves them
    to a model. Push-to-talk (`startVoiceEdit`) understands "select / also
    select / deselect … / clear the selection" and "select X and make it red",
    which edits right away only when the reference was unambiguous; otherwise
    it asks "Which one: A or B?" and changes nothing. New
    `el.selectByVoice(query, {mode})`, `resolveSelection`, `matchSelection`,
    `parseVoiceCommand`. The Rust core implements the same matcher
    (`ai_call` ops `select` and `parse_command`); a shared fixture keeps the
    two identical.

-   **Talk-to-Select (B2b-4), model fallback, voice tool, and chips:** when
    the local matcher can't resolve a reference (relations such as "the lamp
    next to the sofa", unknown words, other languages), the configured code
    model picks from a compact scene index (`SELECT_PROMPT`; tier 2) and either
    selects or asks one short question. Realtime voice sessions get a
    `select_meshes` tool (`query`, `names`, or `mode`) and instructions to
    select first and read the selection back. Push-to-talk shows confirmation
    chips (selected meshes with ×, candidate buttons for "Which one?", and
    Apply for an edit waiting on a model-resolved selection) in an
    `aria-live` region; `ai-select-chips="off"` or `{chips: false}` disables
    them. The Rust core adds `select_messages` / `select_parse` and the
    `select_meshes` tool. Budgets for B2b-4 as a whole:
    `three-live-ai.min.js` `< 20 KB gz` (was `< 11`), `three-live-full.min.js`
    `< 160 KB gz` (was `< 151`), `xr-live-full.min.js` `< 268 KB gz` (was
    `< 259`).

-   **Talk-to-Select on Android and iOS (B2b-4):** `ThreeLiveAIEditor` /
    `AIEditor` hold several selected meshes (`selections`, `setSelection`,
    `toggleSelection(name, additive)`, `onSelectionsChanged` with its source)
    and add `selectByVoice(query, mode)`, `selectNames`, `parseCommand`, and
    `camera` for camera-relative references. `VoiceEditController` handles
    selection commands and "select X and make it red". `AIVoiceSession`
    handles the `select_meshes` tool and no longer echoes voice selections back
    as context. All wording (confirmations, questions, selection context) now
    comes from the core (`select_say`, `select_context`), so every platform says
    the same thing. The `selection` parameter of `editScene` is now a list.

-   **Tap & Speak on Android and iOS (B2b-2/3):** `ThreeLiveAIEditor` (Android)
    and `AIEditor` (iOS/visionOS) bring `editScene` / `undoEdit` to native apps
    with any `ai-chat` code model; tap-to-select via `toggleSelection`;
    push-to-talk `VoiceEditController` (platform speech recognition and TTS);
    and `AIVoiceSession` realtime voice over `ai-realtime` or `gemini-live` with
    `edit_scene` / `undo_edit` tools. The prompt, reply parsing, edit
    validation, and voice protocols live in a new shared Rust core
    (`ai_edit.rs`, `ai_voice.rs`) exposed as `three_live_ai_call` (C, freed with
    `three_live_free_string`) and `ThreeCompiler.nativeAiCall` (JNI), with tests
    that keep the prompt and tools identical to the web plugin.
    `MicrophoneStreamer` now takes any sample rate and callback (the
    `XRGeminiLiveController` constructor still works); on Android it records
    with `VOICE_COMMUNICATION` for echo cancellation while model audio plays.

-   **Tap & Speak voice scene editing (`three-live-ai`):** `ai-select-on-tap`
    makes tapping a mesh set `selected-mesh` (tap again to clear);
    `el.startVoiceEdit()` is push-to-talk with the browser's speech recognizer
    and a spoken result; `el.connectVoice({provider, url})` starts a realtime
    voice conversation over `ai-realtime` (any server speaking the Realtime
    WebSocket event protocol) or `gemini-live`, where the voice model calls an
    `edit_scene` / `undo_edit` tool that runs `editScene` with your code model.
    Includes microphone capture, gapless playback with barge-in, selection
    context, and a built-in `ai-voice-button` (or `slot="voice-button"`).
    Progress is reported as `three-live-voice` events and selection changes as
    `three-live-select`. Budgets: `three-live-ai` `< 10 KB gz`,
    `three-live-full` `< 151 KB gz`, `xr-live-full` `< 259 KB gz`; core bundles
    are unchanged.

-   **`three-live-cli gym` (closed-loop agent gym without MCP):**
    `gym reset scene.js --session ep.json` and
    `gym step --session ep.json --actions '[...]' --ticks 30` play a scene one
    command per step for shell-tool agents (the session file embeds the scene
    and every step and is replayed deterministically on each call);
    `gym play scene.js` is a JSON-lines stdin/stdout loop for scripts and RL
    harnesses. Both accept `--watch` and `--frame out.png`. Observation
    positions are now rounded to 0.1 mm (rotations to 1e-5) in both the CLI and
    the MCP tools.

-   **Closed-loop agent gym (`three_live_gym_reset`, `three_live_gym_step`,
    `three_live_gym_close` MCP tools):** Agents can play a scene step by step
    instead of scripting it up front ("gym" as in the OpenAI Gym / Gymnasium
    reset/step pattern; no ML involved). Each step applies actions, advances the
    deterministic 60 Hz simulation by `ticks`, and returns body states, `reward`
    (score delta), the `events`, `audioCues`, and `newObjectives` fired during
    the step, `done`, and an optional rendered frame. State carries over between
    steps (a new resumable `SimStepper` in the compiler), so a step on a static
    scene takes well under a millisecond; scenes with `animate(t)` /
    `requestAnimationFrame` hooks are re-sampled once per step.

-   **Deterministic PBR material presets (`THREE.ProceduralTexture`,
    `userData.xr.material`):** 11 seamlessly tiling presets (`wood`, `marble`,
    `brick`, `concrete`, `brushedMetal`, `rust`, `leather`, `fabric`,
    `carbonFiber`, `checkerboard`, `grid`) return
    `{ map, normalMap, roughnessMap, metalnessMap }` to spread into
    `MeshStandardMaterial`, with `color`, `color2`, `scale`, `seed`,
    `roughness`, `normalStrength`, and `size` options.
    `mesh.userData.xr = { material: 'wood' }` bakes a preset tinted by the
    mesh's material color. Identical options share textures and
    `normalStrength: 0` skips the normal map (each preset otherwise uses 3 of
    the 16 scene textures). Native Rust kernels (CLI, MCP, Android, iOS) and the
    JS kernels (Web workers) are byte-identical, pinned by cross-language hash
    tests; each preset generates in under 20 ms at 256 px.
    `three-live-procedural.min.js` budget raised to `< 28 KB gz`
    (`three-live-full` `< 142 KB gz`, `xr-live-full` `< 242 KB gz`); core
    bundles are unchanged.

-   **Reference-driven authoring (`three_live_render` `reference`,
    `three-live-cli render --reference`):** renders the scene at a reference
    image's aspect ratio into a `REFERENCE | RENDER | OVERLAY | SILHOUETTE DIFF`
    comparison sheet (auto-aligned overlay on plain/transparent backgrounds)
    with scale/translation-invariant `silhouetteIou`, `aspectError`,
    `silhouetteReliable`, and actionable `guidance`, so agents can match photos,
    mockups, sketches, and blueprints in a few turns. Accepts PNG (all color
    types, bit depths, `tRNS`, Adam7) and JPEG (baseline/progressive, EXIF
    orientation) from local paths or `data:` URIs; remote URLs are never
    fetched. Adds the `build_from_reference` MCP prompt.

### Changed

-   **Faster simulation, gym, and filmstrips (warm JS engine reuse):**
    `three_live_sim`, `three-live-cli sim`, temporal `render --frames`, and the
    agent gym now reuse the thread's warm JS engine (as GLB/USDZ conversion
    already did) instead of building a new one per call, which took ~210 ms. Gym
    steps on animated scenes drop from ~220 ms to ~18 ms and gym reset /
    one-shot `sim` calls from ~0.45 s to ~0.25 s; output is unchanged.

### Fixed

-   **Inline `<script type="text/three">` scenes now load however the bundle is
    included.** With a `defer`, `type="module"`, `async`, or end-of-`<body>`
    bundle, elements already in the page upgraded before the bundle registered
    its script runner and showed "Script execution requires three-live/full";
    with a classic `<script>` in `<head>`, the element upgraded before its
    inline script was parsed and rendered nothing. The inline scene now runs
    after the bundle finishes evaluating (or on `DOMContentLoaded`), unless a
    newer load (`src`, `executeScript`) started first. `three-live.min.js`
    budget: `< 73 KB gz` (was `< 72`).

-   **Warm-engine isolation:** top-level `var` and function declarations from
    one scene are no longer visible to the next scene compiled on the same
    reused engine (they are non-configurable globals that the sandbox reset
    could not delete; they are now blanked).

-   **`validate` / `render` now report texture-quota overflows:** scenes whose
    materials reference more than `SECURITY_3D_MAX_TEXTURES` (16) unique images
    get a `TL105` error up front instead of passing validation and then failing
    `.glb` / `.usdz` export.

--------------------------------------------------------------------------------

## [1.3.2] - 2026-11-08 (Beta)

### Added

-   **Shareable Playground Links & QR Codes (`#p=`, `#s=z:`):** The `/three/`
    and `/xr/` web playgrounds open scenes directly from the URL fragment:
    `#p=<preset>` for built-in and gallery scenes, and `#s=z:<payload>` for any
    scene script (raw DEFLATE, unpadded base64url; decoded client-side via
    `DecompressionStream('deflate-raw')` so scene code never touches a server).
    Added **🔗 Share**, a centered **📱 Run on phone** QR code modal, a persistent
    **Compiled in X ms** header badge, a 3-tab **Camera / Mesh / Spatial & AR**
    inspector, and **🏯 AI Pagoda** (`#p=pagoda`) and **🚜 AI Forklift Drill**
    (`#p=forklift`) gallery presets.
-   **Native Outputs Panel:** Live mesh count, `.glb` and `.usdz` byte sizes,
    and copyable Android (Kotlin), iOS (Swift), and Web HTML snippets for the
    active scene in `/three/`.
-   **`three-live-cli link` & `three_live_link` MCP Tool:** Validates a scene
    and returns a shareable playground URL (`#s=z:<deflate-base64url>`) plus a
    dependency-free ISO/IEC 18004 Model 2 QR code (UTF-8 half-block terminal
    rendering via `--qr` and vector SVG via MCP).
-   **USDZ Embedded Texture Packaging (`UsdUVTexture`):** Packages embedded
    `.glb` and procedural `THREE.DataTexture` images (PNG, JPEG, WebP) as
    64-byte-aligned entries inside `.usdz` archives and emits connected
    `UsdUVTexture` + `UsdPrimvarReader_float2` shader graphs on both Web and
    Rust compilers.
-   **60 Hz Temporal Simulation Harness (`three-live-cli sim` &
    `three_live_sim`):** Headless deterministic simulation runner stepping
    `KHR_interactivity`, `xr-live-sim` rigid-body physics, character
    controllers, and objectives with optional contact-sheet filmstrips.
-   **`Object3D` World-Transform Helpers & `defineModelViewer()`:** Added
    `getWorldPosition`, `getWorldQuaternion`, `getWorldScale`,
    `getWorldDirection`, `localToWorld`, `worldToLocal`,
    `Quaternion.identity()`, `defineModelViewer()` custom-element alias, and
    native partial-arc (`thetaStart`/`thetaLength`/`phiStart`/`phiLength`/`arc`)
    support across `CylinderGeometry`, `SphereGeometry`, `RingGeometry`,
    `CircleGeometry`, and `TorusGeometry`.

### Fixed

-   **XR Collect Game Drone Patrols:** Updated `Drone_Patrol` and `Drone_Chaser`
    routes so enemy drones circulate continuously around inner walls instead of
    stopping at the far corners.
-   **macOS Quick Look (`.usdz`) Button Label:** Clarified the desktop Safari AR
    button label and tooltip when downloading `.usdz` for Finder Quick Look.

--------------------------------------------------------------------------------

## [1.3.1] - 2026-11-07 (Beta)

### Added

-   **Built-In Model Context Protocol (MCP) Stdio Server
    (`three-live-cli mcp`)**: Added a zero-dependency JSON-RPC 2.0 MCP server in
    `compiler/src/mcp.rs` supporting both newline-delimited JSON and
    `Content-Length` framing for Claude Code, Cursor, Gemini CLI, Windsurf, and
    MCP Inspector
    (`claude mcp add three-live -- npx -y -p three-live three-live-cli mcp`):
    -   `three_live_validate` — Runs the Three.js compiler, schema checker, and
        3D spatial/frustum/grounding/collision linter (`TL100`–`TL402`).
    -   `three_live_render` — Renders headless 4-up orthographic/camera contact
        sheets (`quad`), single views, or temporal/turntable animations and
        returns native MCP `image/png` / `image/gif` base64 content blocks
        directly into vision-capable agent context windows.
    -   `three_live_convert` — Compiles Three.js / HTML / `.glb` to `.glb` or
        64-byte-aligned Apple `.usdz`.
    -   `three_live_sim` — Steps deterministic 60 Hz `KHR_interactivity` graphs,
        `xr-live-sim` rigid-body physics, character controllers, and objectives
        with optional keyframe filmstrips.
    -   Exposes `three-live://docs/authoring-guide` (`resources/read`) and
        `author_three_live_scene` (`prompts/get`), plus `server.json` (Official
        MCP Registry), `smithery.yaml`, and `.mcp.json`.
-   **Procedural `THREE.DataTexture` Support (`Web`, `Rust`, `GLB`, `USDZ`)**:
    Added `THREE.DataTexture` compilation (`RGBAFormat`, `RGBFormat`,
    `LuminanceFormat`, `RepeatWrapping` / `ClampToEdgeWrapping`), inline PNG
    data-URI serialization in `.glb`, `avgColor` material tinting in `.usdz`,
    and software rasterizer sampling in `three-live-cli render`.
-   **Distance-Based Level-of-Detail (`lod` / `THREE.LOD` / `MSFT_lod`)**: Added
    multi-tier distance switching with hysteresis, far-distance culling,
    automatic vertex-clustering mesh decimation (`decimateGeometry`), and
    `MSFT_lod` / `KHR_node_visibility` export across Web, Android
    (`LodController.kt`), iOS (`LodController.swift`), and the Rust compiler.
-   **3D Spatial Audio Emitters (`spatial-audio` / `KHR_audio_emitter`) & 60 Hz
    Rigid-Body Physics (`rigid-body`)**: Added 8 zero-asset ambient spatial loop
    presets, `KHR_audio_emitter` / USDZ `SpatialAudio` export, and deterministic
    60 Hz Sequential Impulse rigid-body dynamics across Android, iOS, and Web.
-   **Mobile-First Documentation & Animated Hero Showcase**: Redesigned
    `README.md` to lead with native Android (Google Filament & Jetpack XR
    SceneCore), iOS/visionOS (Apple RealityKit), and `three-live-cli` / MCP,
    with an animated 4-stage hero showcase GIF
    (`docs/assets/hero-showcase.gif`).

--------------------------------------------------------------------------------

## [1.3.0] - 2026-11-05 (Beta)

### Added

-   **Graduated from Developer Preview (Alpha) to Beta**: Stabilized the core
    TypeScript, Rust, Swift/RealityKit, and Kotlin/Android XR APIs across
    `three-live`, `xr-live`, and `three-live-compiler`.
-   **Zero-Install `npx three-live-cli` Launcher (`bin/three-live-cli.js`)**:
    Added `bin.three-live-cli` to `package.json` so AI coding agents and web
    developers can run `npx three-live-cli validate | render | sim` without a
    local Rust toolchain. Automatically locates local release/debug builds or
    downloads and caches the platform binary from GitHub Releases into
    `~/.cache/three-live/v<version>/`.
-   **Cross-Platform Visual Regression Golden Baselines**: Added perceptual RMSE
    and SSIM (`compareRmse`, `compareSsim` in `compiler/src/rasterizer.rs`) and
    deterministic golden assertions across `Orbital Spheres`, `Quantum Core`,
    `Architecture`, `CAD Flange` (`THREE.CSG`), and `Game Simulator` so Web,
    Android, and iOS presets stay pixel-aligned in CI.
-   **Canonical `userData` Trait Schema & JSON Schema Export (`xr-trait-schema`)**:
    Added a single typed validator (`validateTraits`) and JSON Schema 2020-12
    generator (`generateTraitJsonSchema`, `three-live-cli schema`) shared across
    Web (`xr-live`), Rust (`compiler/src/linter.rs`), Android (`XRSceneLoader`),
    and iOS (`RealityKitSceneLoader`), with typo suggestions (`collectable` ->
    `collectible`, ` anchor` -> `anchor`, ` exploded` -> `explode`) and dynamic
    node-name reference checks (`patrolTargets`, `followTarget`, `fleeTarget`).
-   **WebGL Context Loss Recovery & GPU Resource Disposal**:
    -   Added automatic `webglcontextlost` / `webglcontextrestored` handling on
        `WebGLRenderer` and `<three-live>` (pausing animation loops on loss,
        invalidating stale GPU state maps, and recompiling shaders/programs,
        textures, VAOs/VBOs, shadows, and post-processing targets on restore
        while dispatching `contextlost` / `contextrestored` `CustomEvent`s).
    -   Added `renderer.disposeScene(root)` and `renderer.getMemoryStats()` for
        deterministic GPU memory reclamation and leak auditing across repeated
        `<three-live>` and `ThreeLiveStudio` mount/unmount cycles.
-   **Native Rust Acceleration for Primitives & `THREE.CSG`**: Accelerated
    `PlaneGeometry`, `TorusGeometry`, and `THREE.CSG` (`subtract`, `union`,
    `intersect`) in the Rust/Boa compiler (`compiler/src/primitives.rs` and
    `compiler/src/csg.rs`), achieving up to 17.5x faster compilation on
    boolean-heavy CAD scenes (`39.2 ms` -> `2.24 ms`).

--------------------------------------------------------------------------------

## [1.2.4] - 2026-11-05

### Added

-   **AI-First Testing & Verification Toolkit (`three-live-cli`)**:
    -   `three-live-cli validate --json`: Headless JS scene execution with
        structured `TL1xx–TL4xx` diagnostics (`TL101` syntax error, `TL102`
        unknown `THREE.*` class with typo suggestions, `TL103` runtime error,
        `TL104` no visible geometry, `TL105` 250 ms execution ceiling, `TL201`
        unknown `xr-live-sim` trait, `TL202` missing `Player` character,
        `TL301–TL307` spatial/camera/overlap/floor linter warnings).
    -   `three-live-cli render`: Pure-Rust headless software rasterizer
        producing 4-up contact sheets (`--view=quad --grid --annotations` with
        Camera, Front +Z, Top +Y with frustum cone, and Iso 45° panels),
        time-stepped horizontal filmstrips (`--frames=N --duration=T`),
        interactive trigger verification (`--trigger-select=<node>`), and
        animated GIFs (`--output=out.gif`).
    -   `three-live-cli sim`: Headless `xr-live-sim` physics, AI steering, and
        CAD exploded-view step runner (`--actions`, `--snapshots`, `--json`)
        with full event trace logging (`onCollect`, `onDamage`, `onScoreChange`,
        `onWin`, `onLose`).

### Fixed

-   **Consistent counter-clockwise rotation (`Orbital Spheres`)**: Updated
    `Orbital Spheres` orbit speed to `-0.4` across Web, iOS, and Android presets
    so all demo scenes rotate counter-clockwise around `+Y`.
-   **Headless `THREE.CSG` & TypedArray performance in Boa**: Optimized
    `ShapeGeometry`, `ExtrudeGeometry`, `TextGeometry`, and chained
    `THREE.CSG.subtract` operations with direct typed-array population, YZ beam
    culling, and polygon caching.

--------------------------------------------------------------------------------

## [1.2.3] - 2026-11-04

### Fixed

-   **`EXT_meshopt_compression` is now spec-compliant** on Web, Android, and
    iOS: vertex codec v0/v1, index buffer and index sequence codecs, and the
    `OCTAHEDRAL` / `QUATERNION` / `EXPONENTIAL` / `COLOR` filters are byte-exact
    with meshoptimizer, so `gltfpack` files load. Adds
    `KHR_meshopt_compression`, `KHR_mesh_quantization` attribute dequantization,
    `UNSIGNED_BYTE` indices, and `KHR_texture_transform` baking for
    `TEXCOORD_0`. `encodeMeshoptBuffer` now emits spec streams.
-   **IK joints rotate:** web IK runs on the glTF node graph (mesh-less `Group`
    joints resolve and child meshes follow), and Web / Android / iOS rotate each
    joint by the weighted shortest arc instead of only moving joint positions.
-   **Gaussian splats render at their true size** (3σ half-extent with an
    `exp(-0.5 m²)` falloff) on all platforms.
-   **`EXT_mesh_gpu_instancing` draws with one `drawElementsInstanced`** per
    primitive instead of one draw call per instance.
-   **`KHR_materials_variants`** switching re-resolves custom shaders (unlit,
    clearcoat, sheen, ...) and transmission for the selected material.
-   **WebGL context loss** is handled: rendering pauses and the viewer restores
    programs, plugin GPU state, the last model, and the environment.
-   **`exposure`** is now a linear pre-tone-mapping multiplier (model-viewer
    semantics) instead of scaling image-based lighting only.

### Added

-   **iOS post-processing:** `XRLivePostProcessor` /
    `XRLiveRealityKitSession.enablePostProcessing(on:)` render `tone-mapping`
    and `bloom` on `ARView` via `renderCallbacks.postProcess` + Core Image, and
    `outline` traits render as inverted-hull rims on iOS 18 / visionOS 2.

--------------------------------------------------------------------------------

## [1.2.2] - 2026-11-04

### Added

-   **Domain-Scoped Modular Sub-Bundles (`three-live` & `xr-live`):**
    -   `three-live/viewer` (`27.3 KB` gz), `three-live` (`58.6 KB` gz),
        `three-live/studio` (`21.5 KB` gz), `three-live/cad` (`8.8 KB` gz),
        `three-live/animation` (`7.8 KB` gz), and `three-live/full` (`90.5 KB`
        gz).
    -   `xr-live/viewer` (`49.0 KB` gz), `xr-live` (`70.1 KB` gz),
        `xr-live/sensors` (`9.5 KB` gz), `xr-live/spatial` (`55.3 KB` gz),
        `xr-live/sim` (`21.6 KB` gz), and `xr-live/full` (`176.7 KB` gz).
-   **Mesh Compression, Material Variants & Hardware GPU Instancing:**
    -   `EXT_meshopt_compression` (`meshopt.ts`): Zero-Wasm LZ77 + zig-zag
        delta/exponential-Golomb decoder with `VERTEX` (`n*4` / `n*2`),
        `TRIANGLES`, and `ATTRIBUTES` filters across Web, Android, and iOS.
    -   `KHR_materials_variants` (`variant_name`, `variants`, `selectVariant`,
        `variantchange` event) across Web, Android, and iOS.
    -   `EXT_mesh_gpu_instancing` & `THREE.InstancedMesh` (`setMatrixAt`,
        `setColorAt`, single-draw-call `drawElementsInstanced` in WebGL2, and
        USDZ `PointInstancer` transcoding).
-   **2D Shapes, Beveled Extrusions, CSG Booleans & 3D Vector Text
    (`three-live/cad`):**
    -   `THREE.Path` & `THREE.Shape` (`moveTo`, `lineTo`, `quadraticCurveTo`,
        `bezierCurveTo`, `absarc`, `holes`) with Earcut polygon triangulation
        and `THREE.ExtrudeGeometry` (multi-segment bevels).
    -   `THREE.CSG` (`union`, `subtract`, `intersect`) manifold 3D BSP solid
        modeling and `THREE.TextGeometry` (built-in Hershey simplex vector font
        table).
-   **3D Gaussian Splatting (`covariance` & Degree-1 Spherical Harmonics):**
    -   Full 3D anisotropic scale + quaternion rotation -> 3D covariance
        $\Sigma$ -> EWA screen-space 2D conic projection with view-dependent
        degree-1 SH color evaluation across Web, Android, and iOS.
-   **Filmic Tone Mapping, 3-Level Dual-Kawase HDR Bloom & Silhouette Outlines
    (`three-live/studio`):**
    -   `tone-mapping` (`neutral`, `aces`, `agx`, `reinhard`, `none`), `bloom`
        (`bloom-threshold`, `bloom-radius`, `userData.xr.bloom` with transparent
        background alpha preservation), and `outline` (`outline-color`,
        `outline-selected`, `userData.xr.outline` via depth-tested stencil
        silhouette extrusion) across Web, Android, and iOS.
-   **Inverse Kinematics & WebRTC Voice Signaling (`three-live/animation` &
    `xr-live/spatial`):**
    -   `ikPlugin` & `THREE.IKSolver` (`solveTwoBone`, `solveFABRIK`,
        `userData.xr.ik` chains) across Web, Android (`IKSolver`), and iOS
        (`IKSolver`).
    -   Opt-in `shared-room-voice` WebRTC signaling relay (`rtc`
        offer/answer/ICE messages, `broadcastRtcSignal()`, `peerrtcsignal`
        event) plus `computeSpatialVoiceGain` distance/pan helpers. Apps own
        `RTCPeerConnection` and audio playback. Message parsing/validation on
        Android and iOS (`SharedRoom`).

### Fixed

-   Fixed `mat3NormalFromMat4` in `three-live/src/math.ts` to write $3 \times 3$
    cofactors in column-major order so rotated meshes keep stable world-space
    normals during turntable rotation.
-   Paused `orbit` trait motion when `autoRotate` (`Start Spin` / `Pause Spin`)
    is disabled.

--------------------------------------------------------------------------------

## [1.2.1] - 2026-11-03

### Added

-   **Interactive Simulation & Scenario Suite (`xr-live-sim` / `xr-live/sim`)
    Across Web, Android, and iOS / visionOS:**
    -   `characterControllerPlugin` (`character-controller` /
        `CharacterController`): Capsule kinematics, floor/slope stepping,
        coyote-time jumps, WASD/Gamepad/on-screen touch joystick input, and
        shared `characterCameraRig` (`third-person`, `first-person`, `top-down`,
        `fixed-camera`) across Web, Android (`OrbitCameraState.follow`), and iOS
        (`XROrbitCameraState.follow`).
    -   `steeringAgentsPlugin` (`steering-agents` / `SteeringAgents`):
        Autonomous kinematic steering (`patrol`, `chase`, `flee`, `follow`,
        `wander`), vision-cone target detection, obstacle avoidance, and
        deterministic `mulberry32` wandering.
    -   `hitZonesPlugin` (`hit-zones` / `HitZones`): Target/part `integrity`,
        `projectile` / `hitscan` / `contact` interaction, spatial trigger `zone`
        volumes, and timed template `spawner` pooling, with cross-platform
        visual feedback (`computeSimVisuals`, Android `XRSimRenderBridge` +
        Filament instancing, and iOS `XRSimRealityKitBridge`) for hit flashes,
        world-space integrity bars, projectiles, burst fragments, and zone
        outlines.
    -   `objectivesPlugin` (`objectives` / `Objectives`): Ordered/unordered
        checklist objectives (`reach`, `clear`, `collect`, `activate`, `hold`),
        score/attempt/countdown evaluation, `scenario-reset-key` resets, and HUD
        telemetry (`sim-hud`).
    -   `synthAudioPlugin` (`synth-audio` / `SynthAudio`): Zero-asset procedural
        audio synthesis (`beep`, `chime`, `buzz`, `thud`, `sweep`, `click`,
        `alarm`, `whoosh`) via Web Audio API, Android `AudioTrack`, and iOS
        `AVAudioEngine`.

--------------------------------------------------------------------------------

## [1.2.0] - 2026-11-03

### Added

-   **Expanded `XRSpatial` to 14 Spatial Plugins Across Web, Android, and iOS:**
    -   `spatialMeasurePlugin` (`spatial-measure`): Interactive point-to-point
        tape measure and live bounding-box dimension callouts (`m`, `cm`, `in`,
        `ft`) across Web, Android (`SpatialMeasure`), and iOS
        (`SpatialMeasure`).
    -   `magneticSnapPlugin` (`magnetic-snap`): Surface alignment, grid snapping
        (`snap-grid`), angular increments (`snap-angle`), and named socket/plug
        snapping (`data-xr-snap-socket`, `data-xr-snap-plug`) across Web,
        Android (`MagneticSnap`), and iOS (`MagneticSnap`).
    -   `gazeDwellPlugin` (`gaze-dwell`): Hands-free eye-gaze and head-reticle
        dwell selection with animated progress ring and refractory cooldown
        across Web, Android (`GazeDwell`), and iOS (`GazeDwell`).
    -   `explodedViewPlugin` (`explode`): Interactive CAD assembly explosion
        (`radial`, `axial-x`, `axial-y`, `axial-z`, `hierarchy`) with leader
        lines and live `section-plane` clipping across Web, Android
        (`ExplodedView`), and iOS (`ExplodedView`).
    -   `persistentAnchorsPlugin` (`persistent-anchors`): Cross-session room
        anchor persistence via WebXR `XRAnchor`, `localStorage`, and shareable
        `#xr-anchors=` URL hashes across Web, Android (`PersistentAnchors`), and
        iOS (`PersistentAnchors`).
    -   `spatialLocomotionPlugin` (`locomotion`): Parabolic teleportation arc,
        thumbstick snap-turn (`snap-turn-deg`), and comfort vignette
        (`comfort-vignette`) across Web, Android (`SpatialLocomotion`), and iOS
        (`SpatialLocomotion`).
    -   `sharedRoomPlugin` (`shared-room`): Multi-user spatial presence, peer
        avatar frustums, and lamport-clock transform sync across
        `BroadcastChannel` and WebSocket rooms (`SharedRoom`).

--------------------------------------------------------------------------------

## [1.1.1] - 2026-11-02

### Changed

-   **Renamed `XRBlocks*` to `XRSpatial*` across Web, Android, and iOS:**
    -   Web: `window.XRSpatial` (`xr-live/spatial`), `xrSpatialPlugins`, and
        `xr-spatial` attribute (retaining `window.XRBlocks` / `xr-blocks`
        aliases for backward compatibility).
    -   Android: `XRSpatialFeatures` and `XRSpatialMath`.
    -   iOS / visionOS: `XRSpatialRealityKitFeatures`, `XRSpatialGeometry`, and
        `XRSpatialMath`.

### Fixed

-   **Android WebXR AR & Depth Sensing:** Fixed 16-bit luminance-alpha depth
    texture unpacking, planar depth occlusion comparison in eye space,
    depth-heightfield collision surface normals, and post-AR inline render-loop
    resume.
-   **iOS `<xr-live>` Quick Look AR Bridge:** Fixed `<xr-live>` mobile AR
    handoff to export live procedural scenes to `.usdz` and launch Apple AR
    Quick Look on iOS Safari.
-   **Stereo SBS & 3D Simulator:** Mapped Stereo Side-by-Side pointer picking
    per eye, mirrored the gaze reticle into both eyes, and fixed 3D Simulator
    aspect ratio and orbit/WASD controls.
-   **Native Runtime Resilience:** Hardened `XRLiveRuntimeSession` (Kotlin &
    Swift), `TubeStrokeBuilder`, and `ParticleEmitter` against non-finite inputs
    and rapid scene teardown.

---

## [1.1.0] - 2026-10-15

Full multi-platform parity across **Web (`three-live` / `xr-live`)**, **Android (`com.google.threelive`)**, and **iOS / visionOS (`ThreeLiveCompiler`)**.

### Added

- **Cross-Platform `KHR_interactivity` VM & Hierarchy Parity:**
  - Native Rust compiler (`three-live-compiler`) now preserves the full `THREE.Object3D` DFS hierarchy, local TRS, parent-child links, and canonical XR traits (`nodes[i].extras.xr`, `ANDROID_xr_scenecore`, `MOZ_hubs_components`) identically to the web exporter.
  - Pure-Kotlin (`XRLiveRuntimeSession`) and pure-Swift (`XRLiveRuntimeSession` + `XRLiveRealityKitSession`) `KHR_interactivity` behavior-graph VMs with step/evaluation/tween/delay budgets and RFC 6901 JSON Pointer sandboxing.
  - Cross-platform golden parity suite (`testdata/golden/`) verified across Web, Android JVM, and iOS XCTest within `1e-4`.

- **Spatial Computing Plugins & Native Features on Web, Android & iOS/visionOS:**
  - **Lazy Head Follow & Orbit:** Critically damped spring follow with angular deadzone and radial/vertical slack, plus orbit around named nodes, literal coordinates, or the user's head, with turntable `autoRotate` (`rootTransform`) compensation.
  - **Manipulation Handles:** Four top-corner uniform-scale handles and pedestal yaw bar (`ManipulationHandles`, `XRSpatialFeatures`, `XRSpatialRealityKitFeatures`).
  - **Spatial Paint & Depth Particles:** Parallel-transported Catmull-Rom tube strokes (`TubeStrokeBuilder`) and seeded `mulberry32` particle emitters (`ParticleEmitter` with `rain`, `snow`, `dust`, `sparks` presets and floor/depth collision).
  - **Gaussian Splats (`.splat` & Niantic `.spz` v2/v3):** Gzip decompression with size caps, 16-bit bucket depth sort, CPU billboard quad baseline, and GPU covariance-projected ellipse paths (compiled Filament `splat.filamat` + index-only re-sorts on Android up to 1 M splats; runtime Metal `CustomMaterial` + `LowLevelMesh` on iOS/visionOS up to 1 M splats).
  - **World Understanding & Object Detection:** 2D-to-3D bounding-box unprojection (`WorldUnderstanding`), Gemini Live `report_objects` tool calling (`detectObjects`), and optional on-device detectors (`:mobile:android-detect-mlkit` and iOS `XRVisionDetector` + `XRObjectDetectionLoop`).
  - **Hand Gesture Classification (`onGesture`):** 25-joint classifier (`pinch`, `point`, `fist`, `thumbs-up`, `open-palm`) with `HandJointSource` / `XRHandJointSource` registries and optional adapters for Jetpack XR (`:mobile:android-hands-androidxr`), MediaPipe Hand Landmarker (`:mobile:android-hands-mediapipe` / `XRMediaPipeHandJointSource`), and visionOS ARKit `HandTrackingProvider`.
  - **Native Gemini Live & Hold-to-Ask:** Zero-dependency WebSocket Live API client (`XRGeminiLiveController`, `HoldToAskController`), viewport frame streaming (`RendererFrameSource`, `ARViewFrameSource`), and optional Firebase AI Logic adapters (`:mobile:android-firebase-ai`, `mobile/ios/FirebaseAdapter`).

---

## [1.0.0] - 2026-10-06 (Developer Preview)

Initial public **Developer Preview** release of **Three-Live**: an AI-first, multi-platform 3D and spatial computing library with an on-device JIT compiler that turns live, AI-generated Three.js scripts into native **Android Filament & Jetpack XR SceneCore**, **iOS/visionOS RealityKit & Quick Look**, and **WebGL2 / WebXR**.

### Added

- **`<three-live>` Web Component (`three-live`):**
  - Drop-in `<model-viewer>`-compatible custom element supporting `.glb` / `.usdz` assets and inline procedural `<script type="text/three">` compilation.
  - Strictly enforced gzipped bundle budgets: `three-live-viewer.min.js` (`< 24 KB gz`), `three-live.min.js` (`< 48 KB gz`), and `three-live-full.min.js` (`< 58 KB gz`).
  - Modular add-on plugins for PBR Next material extensions (`clearcoat`, `transmission`, `sheen`, `iridescence`, `anisotropy`), procedural studio HDRI & spherical harmonics irradiance, baked contact shadows, 3D surface hotspots, and 64-joint GPU skeletal skinning & morph targets.
  - Built-in runtime binary `.glb` and uncompressed `.usdz` packagers for zero-server 1-tap mobile AR handoff to Apple Quick Look and Android Scene Viewer.

- **`<xr-live>` Spatial Computing Suite (`xr-live`):**
    - Extends `<three-live>` with declarative 6DoF WebXR spatial traits (`grab`, `scale`, `billboard`, `anchor`) via `<xr-anchor>` and procedural `userData.xrTraits`.
    - Live raycastable 3D HTML UI cards via `<div slot="spatial">`.
    -   Hardware XR sensors add-on (`xr-live-sensors.min.js`): `XRDepthManager`
        real-world depth occlusion, `XRHeightfieldPhysics` rigid-body
        ballistics, 25-joint `XRHandGestureClassifier` (`pinch`, `poke`,
        `palm-up`), `XRDesktopSimulator` for headset-free keyboard/mouse
        testing, spatial Web Audio, and WebMCP agent tools.

- **Two-Tier Web Sandbox & Security Architecture:**
  - **Tier 1 (Default):** Isolated Web Worker execution (`buildSandboxWorkerSource`) with network/storage primitives stripped, `Object.prototype` frozen, and strict per-frame execution time and geometry quotas (`SceneQuotaValidator`).
  - **Tier 2 (`sandbox="iframe"`):** Opaque-origin `<iframe sandbox="allow-scripts">` (`three-live-sandbox.html`) with a strict `connect-src 'none'` Content Security Policy and W3C Trusted Types support.

- **Native Rust/QuickJS JIT Compiler (`compiler/` & `three-live-cli`):**
  - Embedded deterministic QuickJS engine (`rquickjs`) executing procedural Three.js scripts in-process on mobile and desktop without a browser or Node.js runtime.
  - Hardened resource limits (memory ceiling, interrupt handler timeout, stack limit, and vertex/triangle/material quotas) and panic-safe C FFI / Android JNI boundaries (`catch_unwind`).
  - Standalone `three-live-cli` binary (`three-live-cli convert scene.js -o output.glb`) with prebuilt release binaries for Linux (`x86_64`, `aarch64`), macOS (`arm64`, `x86_64`), and Windows (`x86_64`).

- **Native Android & Apple Mobile SDKs (`mobile/`):**
  - **Android (`com.google.threelive`):** Zero-copy `DirectByteBuffer` JNI bridge for **Google Filament** (`FilamentHelper`), **Android Scene Viewer** AR launcher, **Jetpack XR `SceneCore`** trait hydration (`XRLiveSceneCoreHelper`), and a Jetpack Compose demo app (`mobile/examples/android_compose`).
  - **iOS, macOS, visionOS & tvOS (`ThreeLiveCompiler`):** Swift Package Manager library and prebuilt `ThreeLiveCompiler.xcframework` with async `RealityKit` `Entity` loading (`RealityKitHelper`), `ARQuickLook` presentation (`QuickLookHelper`), spatial trait gesture installation (`XRLiveRealityKit`), and a SwiftUI demo app (`mobile/examples/ios_swiftui`).
