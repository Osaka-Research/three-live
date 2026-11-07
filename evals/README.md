# `three-live` Three.js Codegen & Compiler Evaluation Suite

A standalone, zero-dependency evaluation suite for measuring how well `three-live` compiles real and LLM-generated Three.js procedural 3D scripts, detecting silent feature drops (`noopProxy` / `BoxGeometry` fallbacks / degraded primitive aliases), and scoring the actionability of `three-live` compiler warnings (`TL100–TL402`) via closed-loop 1-turn LLM self-repair.

---

## Quick Start (Zero API Keys Required)

Run the built-in 10-script stratified smoke suite out of the box:

```bash
node evals/run_evals.js --arm=smoke
```

This seeds 10 representative scripts in `evals/scripts/smoke/` (covering clean CAD/CSG, PBR materials, `InstancedMesh`, two-bone IK, XR traits, and "wild" vanilla Three.js patterns like `LatheGeometry`, `CatmullRomCurve3` + `TubeGeometry`, `THREE.DoubleSide`, `RingGeometry`, `SpotLight`, `Points`, and `OrbitControls`), compiles them with `three-live-cli validate --json`, and outputs:
- `evals/results/summary_smoke.json`
- `evals/results/report_smoke.md`

---

## Pluggable LLM Codegen Interface

Because different contributors and CI environments have access to different LLMs, `evals/run_evals.js` uses a **zero-dependency pluggable LLM adapter** (built on Node's native `fetch` and `child_process`) supporting 5 backends:

### 1. Google Gemini API (`--provider=gemini`)
```bash
GEMINI_API_KEY="your-key" node evals/run_evals.js \
  --generate --arm=vanilla --provider=gemini --model=gemini-2.5-flash
```

### 2. OpenAI or Any OpenAI-Compatible Endpoint (`--provider=openai`)
Works with OpenAI, OpenRouter, Together, Groq, vLLM, or LM Studio via `OPENAI_BASE_URL`:
```bash
OPENAI_API_KEY="your-key" node evals/run_evals.js \
  --generate --arm=vanilla --provider=openai --model=gpt-4o
```

### 3. Anthropic Claude API (`--provider=anthropic`)
```bash
ANTHROPIC_API_KEY="your-key" node evals/run_evals.js \
  --generate --arm=vanilla --provider=anthropic --model=claude-3-7-sonnet-latest
```

### 4. Local Ollama (`--provider=ollama`, No API Key Needed)
```bash
node evals/run_evals.js \
  --generate --arm=vanilla --provider=ollama --model=qwen2.5-coder:14b
```

### 5. Any CLI Tool or Internal Wrapper (`--cmd="<command>"`)
Pipes the combined system + user prompt to `stdin` of any shell command and extracts the ```javascript ... ``` block from `stdout`:
```bash
# Example with Gemini CLI, Claude CLI, Simon Willison's `llm`, or an internal script:
node evals/run_evals.js --generate --arm=vanilla --cmd="gemini -p"
node evals/run_evals.js --generate --arm=vanilla --cmd="llm -m gemini-2.5-pro"
```

---

## Two Prompting Arms + 1-Turn Closed-Loop Repair

1. **`--arm=vanilla` (Stock Three.js Muscle Memory):**
   Prompts the LLM to write a standard Three.js script without mentioning `three-live` restrictions. Measures how well `three-live` compiles "in-the-wild" Three.js code and reveals which standard Three.js classes (`LatheGeometry`, `TubeGeometry`, `CatmullRomCurve3`, `DoubleSide`, `Points`, etc.) get dropped or degraded.
2. **`--arm=guided` (`three-live` Authoring Skill):**
   Includes the `three-live` authoring rules (`THREE.Shape`, `ExtrudeGeometry`, `CSG`, `TextGeometry`, `InstancedMesh`, `IKSolver`, `userData.xr`, `userData.interactivity`, `userData.sim`, Y-up meter grounding, and frustum framing).
3. **`--repair` (1-Turn Compiler Diagnostic Actionability):**
   Feeds the structured JSON diagnostics (`TL100–TL402` codes, line numbers, and `Hint:` strings) from `three-live-cli validate --json` back to the LLM for a single repair turn (`evals/scripts/<arm>_repaired/`) and measures how many broken/degraded scenes become clean.

```bash
# Generate 100 vanilla scripts, evaluate, and test 1-turn self-repair from compiler warnings:
GEMINI_API_KEY="..." node evals/run_evals.js --generate --repair --arm=vanilla

# Compare against guided authoring and emit evals/results/comparison_vanilla_vs_guided.md:
GEMINI_API_KEY="..." node evals/run_evals.js --generate --repair --arm=guided --compare=vanilla,guided
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

---

## Metrics Tracked

- **Compile Success Rate:** `report.valid === true` and `meshCount > 0`.
- **Clean Compile Rate:** Compiles with `0` errors, `0` silent `noopProxy` drops, `0` `BoxGeometry(0.5)` fallback substitutions, and `0` degraded primitive aliases.
- **Silent `noopProxy` Drops:** `THREE.<Symbol>` accesses that hit the `three-author.ts` proxy fallback (`THREE.<Prop> is unsupported; degraded to no-op proxy`).
- **`BoxGeometry(0.5)` Silent Geometry Fallbacks:** Meshes whose unsupported geometry was replaced with a 0.5m fallback cube (`unsupported geometry is unsupported; degraded to BoxGeometry`).
- **Degraded Aliases (`TL102`):** Any primitive or light that degrades to an approximate substitute with a `TL102` diagnostic.
- **Spatial Framing (`TL301–TL307`):** Camera frustum visibility ratio (`visibleMeshCount / meshCount`), unlit PBR (`TL304`), duplicate/coplanar mesh overlap (`TL306`), and grounding (`TL307`).
