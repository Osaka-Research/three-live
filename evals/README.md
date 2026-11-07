# `three-live` Three.js Codegen & Compiler Evaluation Suite

A standalone, zero-dependency TypeScript evaluation suite (`evals/src/*.ts`) for measuring how well `three-live` compiles real and LLM-generated Three.js procedural 3D scripts, detecting silent feature drops (`noopProxy` / `BoxGeometry` fallbacks / degraded primitive aliases), running 60Hz temporal/interactive simulations (`three-live-cli sim`), grading 4-up orthographic/camera contact sheets (`three-live-cli render --view=quad`), and scoring the actionability of `three-live` compiler warnings (`TL100–TL402`) via closed-loop 1-turn LLM self-repair.

---

## Modular Architecture (`evals/src/`)

| Module | Responsibility |
| :--- | :--- |
| `evals/run_evals.ts` | CLI & library entrypoint (`node evals/run_evals.ts` or `npm run evals`) |
| `evals/src/types.ts` | Strongly-typed interfaces (`PromptEntry`, `ScriptEvalResult`, `SimEvaluation`, `VisualEvaluation`, `EvalSummary`, `CliOptions`) |
| `evals/src/symbols.ts` | `THREE.*` symbol taxonomy (`NATIVE_SUPPORTED_SYMBOLS`, `DEGRADED_ALIAS_SYMBOLS`, `UNSUPPORTED_CONSTANTS`) and `analyzeThreeSymbols()` |
| `evals/src/prompts.ts` | `VANILLA_SYSTEM_PROMPT`, `GUIDED_SYSTEM_PROMPT`, `buildCodegenPrompts()`, and `buildRepairPrompts()` |
| `evals/src/llm_client.ts` | Pluggable LLM adapter (`gemini`, `openai`, `anthropic`, `ollama`, `cmd`) and `extractJsCode()` |
| `evals/src/compiler_runner.ts` | `runCompilerValidate()`, `runCompilerSim()`, and `evaluateSingleScript()` |
| `evals/src/visual_judge.ts` | `analyzeAndCompressQuadPng()`, `runCompilerRender()`, `callMultimodalVlmJudge()`, and `evaluateVisualQuality()` |
| `evals/src/reporting.ts` | `aggregateResults()`, `formatMarkdownReport()`, and `generateComparisonReport()` |
| `evals/src/smoke_seed.ts` | Seeds the 10-script offline smoke suite (`evals/scripts/smoke/*.js`) |
| `evals/src/cli.ts` | CLI flag parser (`parseCliArgs`), concurrency pool (`runPool`), and `main()` orchestrator |
| `evals/tests/evals_test.ts` | Unit test suite for the evaluation harness |

---

## Quick Start (Zero API Keys Required)

Run the built-in 10-script stratified smoke suite out of the box:

```bash
node evals/run_evals.ts --arm=smoke
```

This seeds 10 representative scripts in `evals/scripts/smoke/` (covering clean CAD/CSG, PBR materials, `InstancedMesh`, two-bone IK, XR traits, and vanilla Three.js patterns like `LatheGeometry`, `CatmullRomCurve3` + `TubeGeometry`, `THREE.DoubleSide`, `RingGeometry`, `SpotLight`, `Points`, and `OrbitControls`), compiles them with `three-live-cli validate --json`, and outputs:
- `evals/results/summary_smoke.json`
- `evals/results/report_smoke.md`

---

## Pluggable LLM Codegen Interface

Because different contributors and CI environments have access to different LLMs, `evals/src/llm_client.ts` uses a **zero-dependency pluggable LLM adapter** (built on Node's native `fetch` and `child_process`) supporting 5 backends:

### 1. Google Gemini API (`--provider=gemini`)
```bash
GEMINI_API_KEY="your-key" node evals/run_evals.ts \
  --generate --arm=vanilla --provider=gemini --model=gemini-2.5-flash
```

### 2. OpenAI or Any OpenAI-Compatible Endpoint (`--provider=openai`)
Works with OpenAI, OpenRouter, Together, Groq, vLLM, or LM Studio via `OPENAI_BASE_URL`:
```bash
OPENAI_API_KEY="your-key" node evals/run_evals.ts \
  --generate --arm=vanilla --provider=openai --model=gpt-4o
```

### 3. Anthropic Claude API (`--provider=anthropic`)
```bash
ANTHROPIC_API_KEY="your-key" node evals/run_evals.ts \
  --generate --arm=vanilla --provider=anthropic --model=claude-3-7-sonnet-latest
```

### 4. Local Ollama (`--provider=ollama`, No API Key Needed)
```bash
node evals/run_evals.ts \
  --generate --arm=vanilla --provider=ollama --model=qwen2.5-coder:14b
```

### 5. Any CLI Tool or Internal Wrapper (`--cmd="<command>"`)
Pipes the combined system + user prompt to `stdin` of any shell command and extracts the ```javascript ... ``` block from `stdout`:
```bash
# Example with Gemini CLI, Claude CLI, Simon Willison's `llm`, or an internal script:
node evals/run_evals.ts --generate --arm=vanilla --cmd="gemini -p"
node evals/run_evals.ts --generate --arm=vanilla --cmd="llm -m gemini-2.5-pro"
```

---

## Two Prompting Arms + 1-Turn Closed-Loop Repair + 4-Up Visual Judge

1. **`--arm=vanilla` (Stock Three.js Muscle Memory):**
   Prompts the LLM to write a standard Three.js script without mentioning `three-live` restrictions. Measures how well `three-live` compiles "in-the-wild" Three.js code and reveals which standard Three.js classes get dropped or degraded.
2. **`--arm=guided` (`three-live` Authoring Skill):**
   Includes the `three-live` authoring rules (`THREE.Shape`, `ExtrudeGeometry`, `CSG`, `TextGeometry`, `LatheGeometry`, `TubeGeometry`, `InstancedMesh`, `IKSolver`, `userData.xr`, `userData.interactivity`, Y-up meter grounding, and frustum framing).
3. **`--repair` (1-Turn Compiler Diagnostic Actionability):**
   Feeds the structured JSON diagnostics (`TL100–TL402` codes, line numbers, and `Hint:` strings), simulation activity status, and visual judge critiques back to the LLM for a single repair turn (`evals/scripts/<arm>_repaired/`).
4. **`--render` & `--judge` (4-Up Contact Sheet & Visual Judge):**
   Renders `640×640` 4-up contact sheets (`CAMERA`, `FRONT +Z`, `TOP +Y`, `ISO 45 DEG`) via `three-live-cli render --view=quad --grid --annotations`, compresses them with `zlib.deflateSync`, and scores each scene on 4 visual axes (`semanticMatch`, `spatialCoherence`, `cameraFraming`, `materialAndLighting`).

```bash
# Evaluate guided scripts with 4-up contact sheets, visual judge, 1-turn repair, and side-by-side comparison:
node evals/run_evals.ts --arm=guided --render --judge --repair --compare=vanilla,guided
```

---

## Stratified 100-Prompt Benchmark (`evals/prompts/prompts_100.json`)

| Category | IDs | Count | Focus Areas |
| :--- | :--- | :---: | :--- |
| `hard_surface_cad` | `cad_01..20` | 20 | `THREE.Shape` + holes, `ExtrudeGeometry` with bevels, `THREE.CSG` booleans (`subtract`/`union`/`intersect`), `THREE.TextGeometry`, mechanical & architectural assemblies |
| `organic_curves` | `org_01..20` | 20 | Biomorphic & curved forms (`LatheGeometry`, `TubeGeometry`, `CatmullRomCurve3`, `QuadraticBezierCurve3`, `CubicBezierCurve3`, `CapsuleGeometry`, `PolyhedronGeometry`, and indexed `BufferGeometry`) |
| `materials_lighting` | `mat_01..20` | 20 | `MeshStandardMaterial` & `MeshPhysicalMaterial` (`transmission`, `ior`, `thickness`, `attenuationColor`, `clearcoat`, `iridescence`, `sheen`, `dispersion`), `SpotLight` / multi-light rigs |
| `instancing_animation_ik` | `anim_01..20` | 20 | `THREE.InstancedMesh` (`setMatrixAt`, `setColorAt`), `THREE.LOD`, `THREE.IKSolver` & declarative `userData.xr.ik` (`two-bone` / `fabrik`), `Points` & `LineSegments` |
| `spatial_xr_sim` | `xr_01..20` | 20 | `userData.xr` (`grab`, `physics`, `anchor`, `audioEmitter`, `explode`, `snapTo`, `gaze`), `userData.interactivity` (`KHR_interactivity`), `xr-live-sim` (`character`, `agent`, `integrity`, `zone`, `spawner`, `objective`) |
