#!/usr/bin/env node
// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Standalone Three.js Codegen & Compiler Evaluation Suite for `three-live`.
 *
 * Zero external npm dependencies (requires Node.js 18+).
 *
 * Supports:
 * 1. Pluggable LLM code generation (`--generate`) across two prompt arms (`vanilla` vs `guided`):
 *    - `--provider=gemini`    (uses GEMINI_API_KEY or GOOGLE_API_KEY)
 *    - `--provider=openai`    (uses OPENAI_API_KEY and optional OPENAI_BASE_URL)
 *    - `--provider=anthropic` (uses ANTHROPIC_API_KEY)
 *    - `--provider=ollama`    (uses OLLAMA_HOST or http://localhost:11434/v1, no key needed)
 *    - `--provider=cmd --cmd="<shell command>"` (pipes prompt via stdin to any CLI tool)
 * 2. Compiler & silent-drop evaluation (`--evaluate`, default) using `three-live-cli validate --json`:
 *    - Measures compilation success rate, mesh/vertex counts, and execution latency.
 *    - Detects silent `noopProxy` drops, `BoxGeometry(0.5, 0.5, 0.5)` fallback substitutions,
 *      degraded aliases (`CapsuleGeometry`, `RingGeometry`, `SpotLight`, `HemisphereLight`),
 *      missing `THREE.*` constants (`THREE.DoubleSide`, `THREE.RepeatWrapping`, etc.),
 *      and misclassified `TL103` external-loader warnings.
 *    - Aggregates spatial linter (`TL301–TL307`) and XR trait (`TL401–TL402`) diagnostics.
 * 3. Closed-loop 1-turn self-repair (`--repair`):
 *    - Feeds compiler diagnostics (`code`, `message`, `line`, `hint`) back to the LLM to measure
 *      whether `three-live` compiler warnings are actionable enough for automatic self-repair.
 * 4. Optional 4-up quad contact sheet rendering (`--render`).
 */

'use strict';

const fs = require('fs');
const path = require('path');
const {execFile, spawn, spawnSync} = require('child_process');
const {resolvePlatformInfo, findExistingBinary} = require('../bin/three-live-cli.js');

const ROOT_DIR = path.resolve(__dirname, '..');
const EVALS_DIR = __dirname;
const DEFAULT_PROMPTS_PATH = path.join(EVALS_DIR, 'prompts', 'prompts_100.json');
const SCRIPTS_DIR = path.join(EVALS_DIR, 'scripts');
const RESULTS_DIR = path.join(EVALS_DIR, 'results');

// ============================================================================
// 1. THREE.* Symbol Taxonomy in `three-live`
// ============================================================================

/**
 * Symbols natively implemented in `three-author.ts` + `cad.ts` + `ik.ts` + `lod.ts`
 * without fidelity loss.
 */
const NATIVE_SUPPORTED_SYMBOLS = new Set([
  // Math
  'Vector2',
  'Vector3',
  'Vector4',
  'Euler',
  'Quaternion',
  'Matrix4',
  'Matrix3',
  'Color',
  'MathUtils',
  // Buffers & Core Geometries
  'BufferAttribute',
  'Float32BufferAttribute',
  'Uint16BufferAttribute',
  'Uint32BufferAttribute',
  'BufferGeometry',
  'BoxGeometry',
  'PlaneGeometry',
  'SphereGeometry',
  'CylinderGeometry',
  'ConeGeometry',
  'TorusGeometry',
  'TorusKnotGeometry',
  'Curve',
  'Curve3',
  'LineCurve3',
  'QuadraticBezierCurve3',
  'CubicBezierCurve3',
  'CatmullRomCurve3',
  'LatheGeometry',
  'TubeGeometry',
  'PolyhedronGeometry',
  'IcosahedronGeometry',
  'OctahedronGeometry',
  'DodecahedronGeometry',
  'TetrahedronGeometry',
  'CapsuleGeometry',
  'RingGeometry',
  'CircleGeometry',
  'WireframeGeometry',
  'EdgesGeometry',
  // Standard Three.js Enum Constants
  'FrontSide',
  'BackSide',
  'DoubleSide',
  'NoBlending',
  'NormalBlending',
  'AdditiveBlending',
  'SubtractiveBlending',
  'MultiplyBlending',
  'CustomBlending',
  'RepeatWrapping',
  'ClampToEdgeWrapping',
  'MirroredRepeatWrapping',
  'NearestFilter',
  'NearestMipmapNearestFilter',
  'NearestMipmapLinearFilter',
  'LinearFilter',
  'LinearMipmapNearestFilter',
  'LinearMipmapLinearFilter',
  'SRGBColorSpace',
  'LinearSRGBColorSpace',
  'NoColorSpace',
  'UnsignedByteType',
  'ByteType',
  'ShortType',
  'UnsignedShortType',
  'IntType',
  'UnsignedIntType',
  'FloatType',
  'HalfFloatType',
  'AlphaFormat',
  'RGBFormat',
  'RGBAFormat',
  'LuminanceFormat',
  'LuminanceAlphaFormat',
  'RedFormat',
  'RGFormat',
  'StaticDrawUsage',
  'DynamicDrawUsage',
  'NoToneMapping',
  'LinearToneMapping',
  'ReinhardToneMapping',
  'CineonToneMapping',
  'ACESFilmicToneMapping',
  'AgXToneMapping',
  'NeutralToneMapping',
  'BasicShadowMap',
  'PCFShadowMap',
  'PCFSoftShadowMap',
  'VSMShadowMap',
  // CAD & Vector Text Extensions (installed in server extract & cadPlugin)
  'Path',
  'Shape',
  'ShapeGeometry',
  'ExtrudeGeometry',
  'TextGeometry',
  'CSG',
  'MAX_CSG_TRIANGLES',
  'MAX_BSP_DEPTH',
  'MAX_TEXT_GEOMETRY_CHARS',
  'MAX_SHAPE_POINTS',
  // Materials & Textures
  'Texture',
  'DataTexture',
  'TextureLoader',
  'Material',
  'MeshStandardMaterial',
  'MeshBasicMaterial',
  'MeshLambertMaterial',
  'MeshPhongMaterial',
  'MeshPhysicalMaterial',
  'PointsMaterial',
  'LineBasicMaterial',
  'LineDashedMaterial',
  'ShaderMaterial',
  'RawShaderMaterial',
  // Scene Graph & Meshes
  'Object3D',
  'Group',
  'Mesh',
  'InstancedMesh',
  'Line',
  'LineLoop',
  'LineSegments',
  'Points',
  // Lights & Cameras
  'Light',
  'AmbientLight',
  'DirectionalLight',
  'PointLight',
  'SpotLight',
  'Camera',
  'PerspectiveCamera',
  'Scene',
  'WebGLRenderer',
  'Clock',
  // IK & LOD Extensions
  'IKSolver',
  'solveTwoBoneIK',
  'solveFABRIK',
  'quatFromUnitVectors',
  'LOD',
  'decimateGeometry',
  // Internal / Exporter helpers
  'SceneQuotaValidator',
  'exportSceneToCanvas3D',
  'exportSceneToGLB',
  'exportSceneToUSDZ',
  'generateUSDZ',
  'glbToUSDZ',
  'sceneToCanvas3D',
  'sceneToGLB',
  'sceneToUSDZ',
]);

/**
 * Symbols present in `threeExports` that compile into a simplified/degraded primitive
 * and emit a `TL102` warning.
 */
const DEGRADED_ALIAS_SYMBOLS = new Map([
  ['HemisphereLight', 'AmbientLight (loses groundColor sky/ground gradient)'],
  ['RectAreaLight', 'AmbientLight (loses rectangular area emitter)'],
]);

/**
 * Less-common Three.js enum/numeric constants that are NOT exported on `THREE`
 * in `three-author.ts`.
 */
const UNSUPPORTED_CONSTANTS = new Set([
  'ZeroCurvatureEnding',
  'WrapAroundEnding',
  'LoopOnce',
  'LoopRepeat',
  'LoopPingPong',
  'InterpolateDiscrete',
  'InterpolateLinear',
  'InterpolateSmooth',
]);

/**
 * External loader/control symbols where `TL103` ("Load external models via <three-live src='...'>
 * or use built-in orbit camera") is genuinely the right diagnostic classification.
 */
const GENUINE_TL103_LOADER_CONTROL_SYMBOLS = new Set([
  'GLTFLoader',
  'DRACOLoader',
  'OBJLoader',
  'FBXLoader',
  'STLLoader',
  'PLYLoader',
  'RGBELoader',
  'EXRLoader',
  'FontLoader',
  'AudioLoader',
  'CubeTextureLoader',
  'OrbitControls',
  'TrackballControls',
  'TransformControls',
  'FlyControls',
  'FirstPersonControls',
  'PointerLockControls',
]);

// ============================================================================
// 2. Prompt Templates (Vanilla vs. Guided + 1-Turn Repair)
// ============================================================================

const VANILLA_SYSTEM_PROMPT = [
  'You are an expert 3D graphics engineer writing procedural Three.js code.',
  'Return ONLY a single valid JavaScript code block (no HTML wrapper, no imports, no markdown explanations).',
  'Assume `THREE`, `scene` (a `THREE.Scene`), and `camera` (a `THREE.PerspectiveCamera`) are already',
  'pre-populated in the global scope, or you may instantiate `const scene = new THREE.Scene()` and',
  '`const camera = new THREE.PerspectiveCamera(...)`.',
  'Use real-world meter scale (1 unit = 1 meter), Y-up coordinates, rests on or above y = 0,',
  'include appropriate lighting (`AmbientLight` + `DirectionalLight`/`PointLight`), and frame the',
  'camera with `camera.position.set(...)` and `camera.lookAt(...)` so the entire scene is clearly visible.',
].join('\n');

const GUIDED_SYSTEM_PROMPT = [
  'You are an expert 3D graphics engineer authoring procedural Three.js scenes for the `three-live` compiler.',
  'Return ONLY a single valid JavaScript code block (no HTML, no `import` statements, no external network URLs).',
  '',
  'CRITICAL `three-live` COMPILER RULES:',
  '1. Global Scope: `THREE`, `scene`, and `camera` are pre-initialized globals. Add all objects directly to `scene` and configure `camera` in place.',
  '2. Supported Geometries & Curves:',
  '   - Primitives: `BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `CapsuleGeometry`, `PlaneGeometry`,',
  '     `CircleGeometry`, `RingGeometry`, `TorusGeometry`, `TorusKnotGeometry`, `IcosahedronGeometry`, `OctahedronGeometry`,',
  '     `DodecahedronGeometry`, `TetrahedronGeometry`, `PolyhedronGeometry`, `EdgesGeometry`, `WireframeGeometry`,',
  '     or custom indexed `BufferGeometry` + `Float32BufferAttribute`.',
  '   - Curves & Surfaces: `THREE.CatmullRomCurve3`, `THREE.QuadraticBezierCurve3`, `THREE.CubicBezierCurve3`, `THREE.LineCurve3`,',
  '     `THREE.LatheGeometry(points, segments, phiStart, phiLength)`, and `THREE.TubeGeometry(path, tubularSegments, radius, radialSegments, closed)`.',
  '   - 2D/3D CAD & Text: `THREE.Path`, `THREE.Shape`, `THREE.ShapeGeometry`, `THREE.ExtrudeGeometry`,',
  '     `THREE.TextGeometry`, and `THREE.CSG.subtract(meshA, meshB)` / `THREE.CSG.union(meshA, meshB)` /',
  '     `THREE.CSG.intersect(meshA, meshB)` (limit CSG inputs to <= 24 segments so triangle count stays < 4096).',
  '   - DO NOT USE degraded or external Three.js classes: `Sprite`, `CanvasTexture`, `HemisphereLight`, `RectAreaLight`, `GLTFLoader`, `OrbitControls`.',
  '3. Supported Materials, Textures & Colors: `MeshStandardMaterial` and `MeshPhysicalMaterial` (`color`, `map`, `roughness`, `metalness`,',
  '   `emissive`, `emissiveIntensity`, `transmission`, `ior`, `thickness`, `attenuationColor`, `attenuationDistance`,',
  '   `clearcoat`, `clearcoatRoughness`, `iridescence`, `iridescenceIOR`, `sheen`, `sheenColor`, `sheenRoughness`,',
  '   `dispersion`, `opacity`, `transparent`), plus procedural `THREE.DataTexture(data, width, height, THREE.RGBAFormat)`.',
  '4. Instancing, Animation, IK & LOD:',
  '   - `THREE.InstancedMesh` (`setMatrixAt`, `setColorAt`), `THREE.LOD` (`addLevel`), `THREE.IKSolver`, or declarative `node.userData.xr = { ik: { root, mid, effector, target, pole } }`.',
  '   - For procedural animation, define `function animate(t) { ... }` (where `t` is elapsed time in seconds) or `requestAnimationFrame(animate)`.',
  '5. Canonical Spatial, Interactivity & Simulation Traits (avoids TL201, TL204, TL205 warnings):',
  '   - MANDATORY: Assign a unique `node.name = "..."` to EVERY `Mesh` and `Group` BEFORE attaching `userData.xr` or `userData.interactivity`, or referencing a node as a target.',
  '   - ONLY use canonical `node.userData.xr` keys (never invent custom keys inside `userData.xr`; store custom state in local JS variables or `node.userData.state`):',
  '     `grab` (`true` | `"1-hand"` | `"2-hand"` — NEVER `grabbable`), `scale` (`{ min, max }`), `billboard` (`true` | `"y"` | `"spherical"`),',
  '     `follow` (`{ mode: "head"|"hand-left"|"hand-right", distance: 1.0, stiffness: 6 }`), `anchor` (`"Floor"` | `"Table"` | `"Wall"` | `"Ceiling"`),',
  '     `physics` (`{ body: "dynamic"|"static"|"kinematic", collider: "box"|"sphere"|"hull"|"mesh", mass: 1.0, restitution: 0.4, friction: 0.5 }`),',
  '     `orbit` (`{ target: [0,0,0] | "<nodeName>", radius: 0.5, speed: 1.0, height: 0 }`), `handles` (`true` | `{ rotateAxis: "y", minScale: 0.5, maxScale: 2.0 }`),',
  '     `dimensions` (`true` | `{ unit: "m"|"cm"|"mm", axes: ["x","y","z"] }`), `snapTo` (`true` | `{ radius: 0.15, targets: ["<socketNodeName>"] }`),',
  '     `snapSocket` (`{ id: "socket_1", radius: 0.15 }`), `gaze` (`{ dwellMs: 800, action: "select" }`),',
  '     `explode` (`{ distance: 0.25, direction: [x,y,z] }`), `navigable` (`true`), `bloom` (`{ strength: 0.8 }`), `outline` (`{ color: "#38bdf8", thickness: 0.02 }`),',
  '     `ik` (`{ root: "<nodeName>", mid: "<nodeName>", effector: "<nodeName>", target: "<nodeName>", pole: [0,1,0] }`), `lod` (`{ distances: [3, 8], ratios: [0.5, 0.2] }`),',
  '     `audioEmitter` (`{ src: "ambient.ogg", refDistance: 1.5, loop: true }`), `audioCues` (`{ onHit: "hit.ogg", onZero: "break.ogg" }`),',
  '     `character` (`{ moveSpeed: 4.0, jumpImpulse: 5.0 }`), `agent` (`{ behavior: "patrol"|"chase", speed: 2.0, waypoints: [[x,y,z], ...] }`),',
  '     `integrity` (`{ hp: 100, maxHp: 100, armor: 0, onZero: "destroy"|"hide", scoreValue: 50 }`),',
  '     `zone` (`{ kind: "damage"|"heal"|"goal"|"trigger", rate: 10, event: "goal_reached" }`), `spawner` (`{ template: "<nodeName>", intervalSec: 2.0, maxActive: 4 }`),',
  '     `objective` (`{ id: "obj_1", kind: "reach"|"collect"|"survive"|"score", target: "<nodeName>", radius: 1.0 }`).',
  '   - ONLY use canonical `node.userData.interactivity` triggers (`onSelect`, `onHoverIn`, `onHoverOut`, `onStart`, `onReceive`) and actions:',
  '     `{ action: "interpolate"|"toggleTransform"|"setProperty"|"toggleVisibility"|"cycleMaterialColor"|"playAnimation"|"stopAnimation"|"sendEvent", target: "<nodeName>", property: "rotation"|"translation"|"scale", to: [x,y,z], duration: 0.6 }`.',
  '6. Scale, Grounding & Camera Framing (avoids TL301–TL307 warnings):',
  '   - Use real-world meters (1 unit = 1m), Y-up (`+Y` up), lowest resting surface near `y = 0`.',
  '   - Always add `new THREE.AmbientLight(0xffffff, 0.6)` and at least one `THREE.DirectionalLight` or `THREE.PointLight`.',
  '   - Pull `camera.position.set(x, y, z)` back to distance ~2.2x the full scene bounding radius (including ground/floor planes and peripheral props) and call `camera.lookAt(0, centerY, 0)` so 100% of meshes are inside the camera frustum.',
].join('\n');

function buildCodegenPrompts(promptEntry, arm) {
  const systemPrompt = arm === 'guided' ? GUIDED_SYSTEM_PROMPT : VANILLA_SYSTEM_PROMPT;
  const userPrompt = [
    `Task ID: ${promptEntry.id} (${promptEntry.category} - ${promptEntry.title})`,
    '',
    promptEntry.prompt,
    '',
    'Return ONLY the JavaScript source code inside a ```javascript ... ``` block.',
  ].join('\n');
  return {systemPrompt, userPrompt};
}

function buildRepairPrompts(promptEntry, originalCode, validationReport, arm) {
  const systemPrompt = arm === 'guided' ? GUIDED_SYSTEM_PROMPT : VANILLA_SYSTEM_PROMPT;
  const allDiags = validationReport.diagnostics || [];
  const actionableDiags = allDiags.filter((d) => d.severity !== 'info');
  const selectedDiags = actionableDiags.length > 0 ? actionableDiags : allDiags;
  const diagsText = selectedDiags
    .map((d) => {
      const loc = d.line ? ` (line ${d.line}${d.column ? `, col ${d.column}` : ''})` : '';
      const node = d.node ? ` [node: ${d.node}]` : '';
      const hint = d.hint ? `\n    Hint: ${d.hint}` : '';
      return `- [${d.code}] ${String(d.severity).toUpperCase()}${node}${loc}: ${d.message}${hint}`;
    })
    .join('\n');

  const summaryText = validationReport.summary
    ? `Compiled Meshes: ${validationReport.summary.meshCount} (visible in frustum: ${validationReport.summary.camera.visibleMeshCount}), Lights: ${validationReport.summary.lightCount}`
    : 'Compilation failed to produce a valid scene graph.';

  const simHint =
    validationReport.simEvaluation?.ran && !validationReport.simEvaluation.simActive
      ? `\n- [SIM] TEMPORAL/INTERACTIVE INACTIVE: Scene is in category '${promptEntry.category}', but running 60Hz simulation for ${validationReport.simEvaluation.durationSec}s with select/explode/moveCharacter actions produced 0 moving bodies, 0 triggered events, and 0 audio cues. Add an animate(t) loop or declarative userData.xr / userData.interactivity / userData.sim traits so the scene responds dynamically.`
      : '';

  const userPrompt = [
    `The Three.js script below was generated for task "${promptEntry.title}":`,
    promptEntry.prompt,
    '',
    'When compiled with `three-live-cli validate`, it produced the following diagnostics:',
    summaryText,
    (diagsText || '(No structured diagnostics)') + simHint,
    '',
    'Original JavaScript code:',
    '```javascript',
    originalCode.trim(),
    '```',
    '',
    'Please fix all errors and warnings reported above while preserving the full visual and functional intent of the prompt:',
    '- For [TL102] unsupported/degraded symbols (e.g. `CanvasTexture`, `TubeGeometry`, `LatheGeometry`), replace them with natively supported `three-live` equivalents (`THREE.DataTexture(data, w, h, THREE.RGBAFormat)`, `ExtrudeGeometry`, `CylinderGeometry`/`TorusGeometry`, or custom `BufferGeometry`).',
    '- For [TL205] missing `mesh.name` on interactive nodes, assign a unique `node.name = "..."` to every Mesh or Group before attaching `userData.xr`, `userData.interactivity`, or `userData.sim`.',
    '- For [TL201] / [TL202] `userData.xr` schema warnings, follow the diagnostic hint (e.g. use `grab: true` instead of `grabbable: true`, remove unrecognized keys, and keep numeric trait values within range).',
    '- For [TL303] meshes outside the camera frustum, pull `camera.position.set(x, y, z)` back further and adjust `camera.lookAt(0, centerY, 0)` so all meshes are inside the camera view.',
    'Return ONLY the corrected JavaScript source code inside a ```javascript ... ``` block.',
  ].join('\n');

  return {systemPrompt, userPrompt};
}

// ============================================================================
// 3. Pluggable LLM Adapter (Zero External Dependencies)
// ============================================================================

/**
 * Extracts pure JavaScript source code from an LLM response string.
 */
function extractJsCode(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  const trimmed = rawText.trim();
  const fenceRegex = /```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)```/gi;
  const matches = [];
  let match;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    if (match[1] && match[1].trim()) {
      matches.push(match[1].trim());
    }
  }
  if (matches.length > 0) {
    // Pick the longest code block if multiple exist
    matches.sort((a, b) => b.length - a.length);
    return matches[0] + '\n';
  }
  // If no markdown fences, strip leading/trailing single-line backticks if any
  return trimmed.replace(/^`+|`+$/g, '').trim() + '\n';
}

/**
 * Resolves the active LLM provider configuration from CLI flags and environment variables.
 */
function resolveLlmConfig(options) {
  let provider = options.provider;
  let cmd = options.cmd || null;
  const googleGeminiCli = '/google/bin/releases/gemini-cli/tools/gemini';
  if (provider === 'gemini-cli') {
    provider = 'cmd';
    if (!cmd) {
      cmd = fs.existsSync(googleGeminiCli)
        ? `${googleGeminiCli} -p "Generate the requested JavaScript code block from stdin."`
        : 'gemini -p "Generate the requested JavaScript code block from stdin."';
    }
  }
  if (!provider) {
    if (cmd) {
      provider = 'cmd';
    } else if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      provider = 'gemini';
    } else if (process.env.OPENAI_API_KEY) {
      provider = 'openai';
    } else if (process.env.ANTHROPIC_API_KEY) {
      provider = 'anthropic';
    } else if (process.env.OLLAMA_HOST) {
      provider = 'ollama';
    } else if (fs.existsSync(googleGeminiCli)) {
      provider = 'cmd';
      cmd = `${googleGeminiCli} -p "Generate the requested JavaScript code block from stdin."`;
    }
  }

  if (!provider) {
    throw new Error(
      'No LLM provider configured for --generate / --repair.\n' +
        'Set one of the following:\n' +
        '  1. Gemini API:      GEMINI_API_KEY=... node evals/run_evals.js --generate --provider=gemini\n' +
        '  2. OpenAI / Compat: OPENAI_API_KEY=... node evals/run_evals.js --generate --provider=openai\n' +
        '  3. Anthropic API:   ANTHROPIC_API_KEY=... node evals/run_evals.js --generate --provider=anthropic\n' +
        '  4. Local Ollama:    node evals/run_evals.js --generate --provider=ollama --model=qwen2.5-coder:32b\n' +
        '  5. Any CLI Command: node evals/run_evals.js --generate --cmd="gemini -p"\n' +
        'Or run without --generate to evaluate existing scripts (e.g. `node evals/run_evals.js --arm=smoke`).',
    );
  }

  const defaultModels = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o',
    anthropic: 'claude-3-7-sonnet-latest',
    ollama: 'qwen2.5-coder:14b',
    cmd: 'custom-cli',
  };

  return {
    provider,
    model: options.model || defaultModels[provider] || 'default',
    cmd,
    temperature: options.temperature ?? 0.2,
  };
}

/**
 * Calls the configured LLM provider and returns the extracted JavaScript code.
 */
async function callLlm({systemPrompt, userPrompt}, llmConfig) {
  const {provider, model, cmd, temperature} = llmConfig;

  if (provider === 'cmd') {
    if (!cmd) {
      throw new Error('--provider=cmd requires --cmd="<shell command>"');
    }
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}\n`;
    const rawOut = await new Promise((resolve, reject) => {
      const child = spawn(cmd, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(
            new Error(
              `Command "${cmd}" exited with code ${code}: ${stderr.slice(0, 500)}`,
            ),
          );
        } else {
          resolve(stdout);
        }
      });
      child.stdin.write(combinedPrompt);
      child.stdin.end();
    });
    return extractJsCode(rawOut);
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY environment variable.');
    }
    const baseUrl =
      process.env.GEMINI_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: systemPrompt}]},
        contents: [{role: 'user', parts: [{text: userPrompt}]}],
        generationConfig: {
          temperature,
          maxOutputTokens: 8192,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map((p) => p.text || '').join('\n');
    return extractJsCode(text);
  }

  if (provider === 'openai' || provider === 'ollama') {
    const isOllama = provider === 'ollama';
    const apiKey = process.env.OPENAI_API_KEY || (isOllama ? 'ollama' : '');
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable.');
    }
    const baseUrl = isOllama
      ? (process.env.OLLAMA_HOST || 'http://localhost:11434') + '/v1'
      : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: userPrompt},
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider} API HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return extractJsCode(text);
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
    }
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    const url = `${baseUrl.replace(/\/+$/, '')}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        temperature,
        system: systemPrompt,
        messages: [{role: 'user', content: userPrompt}],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = await res.json();
    const blocks = data?.content || [];
    const text = blocks.map((b) => b.text || '').join('\n');
    return extractJsCode(text);
  }

  throw new Error(`Unknown provider "${provider}". Expected gemini, openai, anthropic, ollama, or cmd.`);
}

// ============================================================================
// 4. Static & Runtime Compiler Evaluation
// ============================================================================

/**
 * Strips JS comments so regex symbol extraction doesn't match commented-out code.
 */
function stripJsComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Extracts all `THREE.<Symbol>` references from a Three.js script and classifies them.
 */
function analyzeThreeSymbols(code) {
  const clean = stripJsComments(code);
  const symbolRegex = /\bTHREE\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const allSymbols = new Set();
  let match;
  while ((match = symbolRegex.exec(clean)) !== null) {
    allSymbols.add(match[1]);
  }

  const supported = [];
  const degradedAliases = [];
  const unsupportedConstants = [];
  const unsupportedClasses = [];

  for (const sym of Array.from(allSymbols).sort()) {
    if (NATIVE_SUPPORTED_SYMBOLS.has(sym)) {
      supported.push(sym);
    } else if (DEGRADED_ALIAS_SYMBOLS.has(sym)) {
      degradedAliases.push({
        symbol: sym,
        degradesTo: DEGRADED_ALIAS_SYMBOLS.get(sym),
      });
    } else if (UNSUPPORTED_CONSTANTS.has(sym)) {
      unsupportedConstants.push(sym);
    } else {
      unsupportedClasses.push(sym);
    }
  }

  return {
    totalUniqueSymbols: allSymbols.size,
    supported,
    degradedAliases,
    unsupportedConstants,
    unsupportedClasses,
  };
}

/**
 * Runs `three-live-cli validate --json <scriptPath>` and parses the structured report.
 */
function runCompilerValidate(binPath, scriptPath) {
  return new Promise((resolve) => {
    execFile(
      binPath,
      ['validate', '--json', scriptPath],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
      (err, rawStdout, rawStderr) => {
        const stdout = (rawStdout || '').trim();
        const stderr = (rawStderr || '').trim();
        let report = null;
        if (stdout) {
          try {
            report = JSON.parse(stdout);
          } catch (_) {
            const firstBrace = stdout.indexOf('{');
            const lastBrace = stdout.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              try {
                report = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
              } catch (_2) {}
            }
          }
        }

        if (!report) {
          report = {
            valid: false,
            input: scriptPath,
            executionTimeMs: 0,
            summary: null,
            nodes: [],
            diagnostics: [
              {
                code: 'TL100',
                severity: 'error',
                message: stderr || stdout || (err ? err.message : 'Compiler exited without output'),
              },
            ],
          };
        }
        resolve(report);
      },
    );
  });
}

/**
 * Categories that require temporal/interactive verification via `three-live-cli sim`.
 */
const SIM_CATEGORIES = new Set(['instancing_animation_ik', 'spatial_xr_sim']);

/**
 * Default scripted user/agent action sequence for `three-live-cli sim`.
 */
const DEFAULT_SIM_ACTIONS = JSON.stringify([
  {at: 0.2, type: 'select'},
  {at: 0.4, type: 'explode', factor: 1.0},
  {at: 0.2, type: 'moveCharacter', dx: -0.4, dz: -1.0, duration: 1.5, jump: true},
]);

/**
 * Runs `three-live-cli sim <scriptPath> --duration 2.0 --actions ... --json`
 * and computes temporal & interactive simulation metrics.
 */
function runCompilerSim(binPath, scriptPath, durationSec = 2.0) {
  return new Promise((resolve) => {
    execFile(
      binPath,
      [
        'sim',
        scriptPath,
        '--duration',
        String(durationSec),
        '--actions',
        DEFAULT_SIM_ACTIONS,
        '--json',
      ],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
      (err, rawStdout) => {
        const stdout = (rawStdout || '').trim();
        let simReport = null;
        if (stdout) {
          try {
            simReport = JSON.parse(stdout);
          } catch (_) {
            const firstBrace = stdout.indexOf('{');
            const lastBrace = stdout.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              try {
                simReport = JSON.parse(stdout.slice(firstBrace, lastBrace + 1));
              } catch (_2) {}
            }
          }
        }
        if (!simReport || err) {
          resolve({
            ran: true,
            durationSec,
            ticksSimulated: 0,
            movedBodies: 0,
            totalBodies: 0,
            triggeredEvents: [],
            completedObjectives: [],
            audioCuesFired: [],
            score: 0,
            scenarioState: 'error',
            simActive: false,
          });
          return;
        }
        const bodies = Array.isArray(simReport.bodies) ? simReport.bodies : [];
        let movedBodies = 0;
        for (const b of bodies) {
          const t0 = b.initialTranslation || [0, 0, 0];
          const t1 = b.finalTranslation || [0, 0, 0];
          const r0 = b.initialRotation || [0, 0, 0, 1];
          const r1 = b.finalRotation || [0, 0, 0, 1];
          const s0 = b.initialScale || [1, 1, 1];
          const s1 = b.finalScale || [1, 1, 1];
          const dt = Math.hypot(t1[0] - t0[0], t1[1] - t0[1], t1[2] - t0[2]);
          const dr = Math.hypot(
            r1[0] - r0[0],
            r1[1] - r0[1],
            r1[2] - r0[2],
            r1[3] - r0[3],
          );
          const ds = Math.hypot(s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]);
          if (dt > 1e-4 || dr > 1e-4 || ds > 1e-4) {
            movedBodies++;
          }
        }
        const triggeredEvents = Array.isArray(simReport.triggeredEvents)
          ? simReport.triggeredEvents
          : [];
        const completedObjectives = Array.isArray(simReport.completedObjectives)
          ? simReport.completedObjectives
          : [];
        const audioCuesFired = Array.isArray(simReport.audioCuesFired)
          ? simReport.audioCuesFired
          : [];
        const simActive = Boolean(
          movedBodies > 0 ||
            triggeredEvents.length > 0 ||
            completedObjectives.length > 0 ||
            audioCuesFired.length > 0,
        );
        resolve({
          ran: true,
          durationSec: simReport.durationSec ?? durationSec,
          ticksSimulated: simReport.ticksSimulated ?? 0,
          movedBodies,
          totalBodies: bodies.length,
          triggeredEvents,
          completedObjectives,
          audioCuesFired,
          score: simReport.score ?? 0,
          scenarioState: simReport.scenarioState || 'running',
          simActive,
        });
      },
    );
  });
}

/**
 * Evaluates a single script file and combines static symbol analysis with
 * runtime compiler diagnostics, spatial framing metrics, and 60Hz temporal/interactive simulation.
 */
async function evaluateSingleScript(binPath, scriptPath, promptEntry, evalOpts = {}) {
  const code = fs.readFileSync(scriptPath, 'utf8');
  const symbolAnalysis = analyzeThreeSymbols(code);
  const report = await runCompilerValidate(binPath, scriptPath);
  const diagnostics = report.diagnostics || [];

  // Inspect runtime diagnostics for silent drops, fallbacks, and misclassifications
  const noopDrops = [];
  const degradedWarnings = [];
  const misclassifiedTl103 = [];
  let boxGeometryFallbackCount = 0;

  for (const d of diagnostics) {
    const msg = d.message || '';
    if (msg.includes('unsupported geometry is unsupported; degraded to BoxGeometry')) {
      boxGeometryFallbackCount++;
    }
    const threeMatch = msg.match(/THREE\.([A-Za-z0-9_]+)\s+is\s+unsupported;\s+degraded\s+to\s+no-op\s+proxy/);
    if (threeMatch) {
      const sym = threeMatch[1];
      noopDrops.push(sym);
      if (d.code === 'TL103' && !GENUINE_TL103_LOADER_CONTROL_SYMBOLS.has(sym)) {
        misclassifiedTl103.push({
          symbol: sym,
          code: d.code,
          message: msg,
          hint: d.hint || '',
        });
      }
    } else if (msg.includes('is unsupported; degraded to')) {
      degradedWarnings.push(msg);
    }
  }

  const summary = report.summary || null;
  const meshCount = summary ? summary.meshCount : 0;
  const visibleMeshCount = summary?.camera ? summary.camera.visibleMeshCount : 0;
  const compileSucceeded = Boolean(report.valid && meshCount > 0);
  const frustumVisibilityRatio = meshCount > 0 ? visibleMeshCount / meshCount : 0;

  // Detect lexical `const/let scene = new THREE.Scene()` block shadowing in compiler/src/engine.rs
  const cleanCode = stripJsComments(code);
  const declaresLexicalScene = /\b(?:const|let)\s+scene\s*=\s*new\s+THREE\.Scene\b/.test(cleanCode);
  const lexicalSceneShadowed = Boolean(
    declaresLexicalScene &&
      meshCount === 0 &&
      diagnostics.some((d) => d.code === 'TL301' && (d.message || '').includes('0 meshes')),
  );

  // Check expected features from prompt metadata if provided
  const expectedFeatures = promptEntry?.expectedFeatures || [];
  const matchedExpectedFeatures = expectedFeatures.filter((feat) => code.includes(feat));

  const diagCodes = diagnostics.map((d) => d.code);
  const errorCodes = diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
  const warningCodes = diagnostics.filter((d) => d.severity !== 'error').map((d) => d.code);

  const hasDropsOrFallbacks =
    noopDrops.length > 0 ||
    boxGeometryFallbackCount > 0 ||
    symbolAnalysis.degradedAliases.length > 0 ||
    symbolAnalysis.unsupportedClasses.length > 0;

  const category = promptEntry ? promptEntry.category : 'custom';
  const shouldRunSim =
    compileSucceeded &&
    evalOpts.sim !== false &&
    (Boolean(evalOpts.simAll) || SIM_CATEGORIES.has(category));
  const simEvaluation = shouldRunSim
    ? await runCompilerSim(binPath, scriptPath)
    : {ran: false, simActive: null};

  return {
    id: promptEntry ? promptEntry.id : path.basename(scriptPath, '.js'),
    category,
    title: promptEntry ? promptEntry.title : path.basename(scriptPath),
    scriptPath: path.relative(ROOT_DIR, scriptPath),
    valid: Boolean(report.valid),
    compileSucceeded,
    cleanCompileNoDrops: Boolean(compileSucceeded && !hasDropsOrFallbacks && errorCodes.length === 0),
    executionTimeMs: report.executionTimeMs || 0,
    meshCount,
    visibleMeshCount,
    frustumVisibilityRatio: Number(frustumVisibilityRatio.toFixed(3)),
    vertexCount: summary ? summary.vertexCount : 0,
    indexCount: summary ? summary.indexCount : 0,
    materialCount: summary ? summary.materialCount : 0,
    lightCount: summary ? summary.lightCount : 0,
    hasInteractivity: Boolean(summary?.hasInteractivity),
    worldBounds: summary?.worldBounds || null,
    expectedFeatures,
    matchedExpectedFeatures,
    symbolAnalysis,
    runtimeDrops: {
      noopDrops: Array.from(new Set(noopDrops)),
      boxGeometryFallbackCount,
      degradedWarnings,
      misclassifiedTl103,
      lexicalSceneShadowed,
    },
    simEvaluation,
    diagnosticCodes: diagCodes,
    errorCodes,
    warningCodes,
    diagnostics,
  };
}

// ============================================================================
// 5. Built-in Smoke Suite Generator (`--arm=smoke`)
// ============================================================================

/**
 * Seeds 10 representative scripts in `evals/scripts/smoke/` so anyone can run
 * `node evals/run_evals.js --arm=smoke` immediately with zero API keys to test
 * compilation, drop detection, degraded alias detection, and warning usefulness.
 */
function ensureSmokeScriptsExist() {
  const smokeDir = path.join(SCRIPTS_DIR, 'smoke');
  fs.mkdirSync(smokeDir, {recursive: true});

  const smokeSamples = [
    {
      id: 'cad_01',
      code: `// Helical Planetary Gear Assembly (Clean CAD + CSG)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const steelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8, roughness: 0.3 });

const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.08, 24), steelMat);
base.name = 'carrier_plate';
base.position.y = 0.04;
scene.add(base);

const sunBlank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 20), brassMat);
const sunBore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16), brassMat);
const sunGear = THREE.CSG.subtract(sunBlank, sunBore);
sunGear.name = 'sun_gear';
sunGear.position.y = 0.2;
scene.add(sunGear);

for (let i = 0; i < 3; i++) {
  const angle = (i * Math.PI * 2) / 3;
  const planet = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.22, 20), steelMat);
  planet.name = 'planet_gear_' + i;
  planet.position.set(Math.cos(angle) * 0.6, 0.2, Math.sin(angle) * 0.6);
  scene.add(planet);
}

camera.position.set(0, 1.8, 2.8);
camera.lookAt(0, 0.2, 0);
`,
    },
    {
      id: 'cad_02',
      code: `// Vanilla Three.js Lexical Scene Shadowing Trap (const scene = new THREE.Scene())
// In compiler/src/engine.rs, scripts are wrapped in a block { ... }, so const scene
// shadows globalThis.scene and causes TL301: "Scene contains 0 meshes"!
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 })
);
mesh.name = 'cnc_pillow_block';
mesh.position.y = 0.2;
scene.add(mesh);
camera.position.set(0, 0.8, 1.8);
camera.lookAt(0, 0.2, 0);
`,
    },
    {
      id: 'org_01',
      code: `// Twisted Biomorphic Vase using Vanilla Three.js LatheGeometry + DoubleSide (Triggers Silent Drop + BoxGeometry Fallback!)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);

// Vanilla Three.js muscle memory: LatheGeometry + DoubleSide
const points = [];
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  points.push(new THREE.Vector2(0.15 + 0.12 * Math.sin(t * Math.PI), t * 0.6));
}
const latheGeo = new THREE.LatheGeometry(points, 32);
const ceramicMat = new THREE.MeshPhysicalMaterial({
  color: 0xf1f5f9,
  roughness: 0.15,
  clearcoat: 1.0,
  side: THREE.DoubleSide,
});
const vase = new THREE.Mesh(latheGeo, ceramicMat);
vase.name = 'ceramic_vase';
vase.position.y = 0.3;
scene.add(vase);

camera.position.set(0, 0.8, 2.2);
camera.lookAt(0, 0.3, 0);
`,
    },
    {
      id: 'org_04',
      code: `// Bonsai Tree using Vanilla CatmullRomCurve3 + TubeGeometry + IcosahedronGeometry
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xfffbeb, 1.3);
sun.position.set(2, 5, 3);
scene.add(sun);

const pot = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.14, 0.36),
  new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.7 })
);
pot.name = 'ceramic_pot';
pot.position.y = 0.07;
scene.add(pot);

// Vanilla Three.js muscle memory: CatmullRomCurve3 + TubeGeometry
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.14, 0),
  new THREE.Vector3(0.08, 0.32, 0.04),
  new THREE.Vector3(-0.06, 0.5, -0.02),
  new THREE.Vector3(0.05, 0.68, 0.03),
]);
const trunkGeo = new THREE.TubeGeometry(curve, 20, 0.04, 8, false);
const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.85 }));
trunk.name = 'bonsai_trunk';
 trunk.position.y = 0.35;
scene.add(trunk);

const canopy = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.24, 1),
  new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 })
);
canopy.name = 'foliage_pad';
canopy.scale.set(1.3, 0.45, 1.1);
canopy.position.set(0.05, 0.72, 0.03);
scene.add(canopy);

camera.position.set(0, 0.7, 1.8);
camera.lookAt(0, 0.4, 0);
`,
    },
    {
      id: 'mat_01',
      code: `// PBR Material Calibration Matrix (5x5 Spheres with Transmission, Iridescence, Clearcoat)
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.PointLight(0x38bdf8, 1.2, 10);
rim.position.set(-3, 2, -2);
scene.add(rim);

const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(2.6, 0.08, 2.6),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.2 })
);
pedestal.name = 'pedestal_base';
pedestal.position.y = 0.04;
scene.add(pedestal);

const sphereGeo = new THREE.SphereGeometry(0.16, 24, 16);
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: r === 4 ? 0xe0f2fe : 0x6366f1,
      metalness: r / 4,
      roughness: 0.05 + (c / 4) * 0.9,
      clearcoat: r === 2 ? 1.0 : 0.0,
      iridescence: r === 3 ? 1.0 : 0.0,
      transmission: r === 4 ? 0.92 : 0.0,
      ior: 1.5,
      thickness: 0.3,
    });
    const s = new THREE.Mesh(sphereGeo, mat);
    s.name = 'pbr_sphere_' + r + '_' + c;
    s.position.set((c - 2) * 0.48, 0.24, (r - 2) * 0.48);
    scene.add(s);
  }
}

camera.position.set(0, 2.4, 3.4);
camera.lookAt(0, 0.2, 0);
`,
    },
    {
      id: 'mat_11',
      code: `// Degraded Alias Showcase: CapsuleGeometry, RingGeometry, SpotLight, HemisphereLight
scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.7));
const spot = new THREE.SpotLight(0xfff7ed, 2.0, 12, Math.PI / 5, 0.3);
spot.position.set(2, 4, 2);
scene.add(spot);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.8, 32),
  new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2 })
);
ring.name = 'golden_halo_ring';
ring.position.set(0, 0.6, 0);
scene.add(ring);

const capsule = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.2, 0.5, 8, 16),
  new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transmission: 0.8, roughness: 0.1 })
);
capsule.name = 'core_capsule';
capsule.position.set(0, 0.6, 0);
scene.add(capsule);

camera.position.set(0, 1.2, 2.6);
camera.lookAt(0, 0.6, 0);
`,
    },
    {
      id: 'anim_01',
      code: `// Stadium Amphitheater Seating Bowl (InstancedMesh with per-instance Matrix4 & Color)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(4, 8, 5);
scene.add(sun);

const stage = new THREE.Mesh(
  new THREE.CylinderGeometry(0.8, 0.85, 0.12, 24),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
);
stage.name = 'center_stage';
stage.position.y = 0.06;
scene.add(stage);

const seatGeo = new THREE.BoxGeometry(0.12, 0.14, 0.12);
const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 });
const seats = new THREE.InstancedMesh(seatGeo, seatMat, 120);
seats.name = 'stadium_seats';

const dummy = new THREE.Object3D();
const color = new THREE.Color();
let idx = 0;
for (let row = 0; row < 5; row++) {
  const radius = 1.2 + row * 0.28;
  const y = 0.15 + row * 0.16;
  for (let s = 0; s < 24; s++) {
    const theta = -Math.PI * 0.4 + (s / 23) * Math.PI * 0.8;
    dummy.position.set(Math.sin(theta) * radius, y, -Math.cos(theta) * radius);
    dummy.lookAt(0, 0.1, 0);
    dummy.updateMatrix();
    seats.setMatrixAt(idx, dummy.matrix);
    color.setRGB(0.2 + row * 0.15, 0.5, 0.9 - row * 0.12);
    seats.setColorAt(idx, color);
    idx++;
  }
}
scene.add(seats);

camera.position.set(0, 2.6, 3.8);
camera.lookAt(0, 0.4, -0.8);
`,
    },
    {
      id: 'anim_09',
      code: `// 6-DOF Articulated Robot Arm with Declarative Two-Bone IK (userData.xr.ik)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(2, 4, 3);
scene.add(dir);

const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.6, roughness: 0.3 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.25 });

const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 20), darkMat);
pedestal.name = 'base_pedestal';
pedestal.position.y = 0.08;
scene.add(pedestal);

const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), orangeMat);
shoulder.name = 'shoulder_joint';
shoulder.position.set(0, 0.35, 0);
scene.add(shoulder);

const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), orangeMat);
elbow.name = 'elbow_joint';
elbow.position.set(0, 0.72, 0.1);
scene.add(elbow);

const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), darkMat);
wrist.name = 'wrist_effector';
wrist.position.set(0.15, 0.95, 0.25);
scene.add(wrist);

const targetOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.6 })
);
targetOrb.name = 'ik_target_orb';
targetOrb.position.set(0.35, 0.65, 0.3);
targetOrb.userData.xr = { grabbable: true };
scene.add(targetOrb);

shoulder.userData.xr = {
  ik: {
    solver: 'two-bone',
    root: 'shoulder_joint',
    mid: 'elbow_joint',
    effector: 'wrist_effector',
    target: 'ik_target_orb',
    pole: [0, 1.2, -0.4],
    weight: 1.0,
  },
};

camera.position.set(1.4, 1.1, 1.8);
camera.lookAt(0.1, 0.5, 0.1);
`,
    },
    {
      id: 'xr_01',
      code: `// Interactive XR Workbench with Grabbable Tools, Physics Colliders & KHR_interactivity
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(2, 4, 3);
scene.add(key);

const legs = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 0.72, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
);
legs.name = 'workbench_base';
legs.position.set(0, 0.36, 0);
scene.add(legs);

const table = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 0.08, 0.8),
  new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 })
);
table.name = 'xr_workbench_table';
table.position.set(0, 0.76, 0);
table.userData.xr = {
  anchor: 'Table',
  physics: { body: 'static', collider: 'box' },
};
scene.add(table);

const artifact = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.1, 0.03, 48, 12),
  new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, metalness: 0.2, roughness: 0.1, transmission: 0.7 })
);
artifact.name = 'holo_artifact';
artifact.position.set(0, 0.96, 0);
artifact.userData.xr = {
  grabbable: true,
  physics: { body: 'dynamic', collider: 'hull', mass: 0.5, restitution: 0.4 },
};
artifact.userData.interactivity = {
  onSelect: { action: 'toggleRotate', target: 'holo_artifact', axis: [0, 1, 0], angle: 3.14159, duration: 0.8 },
};
scene.add(artifact);

camera.position.set(0, 1.4, 2.2);
camera.lookAt(0, 0.65, 0);
`,
    },
    {
      id: 'xr_20',
      code: `// Vanilla Three.js Particle Starfield & OrbitControls (Triggers Points + OrbitControls TL103/TL106)
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.PointLight(0xfbbf24, 2.5, 20);
sun.position.set(0, 0.6, 0);
scene.add(sun);

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 24, 16),
  new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 })
);
planet.name = 'exoplanet';
planet.position.set(0, 0.35, 0);
scene.add(planet);

// Vanilla Three.js Points starfield + OrbitControls
const starGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(300);
for (let i = 0; i < 300; i++) {
  starPositions[i] = (Math.random() - 0.5) * 6;
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05 });
const stars = new THREE.Points(starGeo, starMat);
stars.name = 'starfield_points';
scene.add(stars);

const controls = new THREE.OrbitControls(camera);
controls.update();

camera.position.set(0, 0.8, 1.8);
camera.lookAt(0, 0.35, 0);
`,
    },
  ];

  for (const sample of smokeSamples) {
    const outPath = path.join(smokeDir, `${sample.id}.js`);
    fs.writeFileSync(outPath, sample.code, 'utf8');
  }
}

// ============================================================================
// 6. Aggregate Summary & Markdown Report Generation
// ============================================================================

function aggregateResults(arm, itemResults, repairComparison = null) {
  const total = itemResults.length;
  const compileSuccessCount = itemResults.filter((r) => r.compileSucceeded).length;
  const cleanNoDropsCount = itemResults.filter((r) => r.cleanCompileNoDrops).length;
  const withNoopDropsCount = itemResults.filter((r) => r.runtimeDrops.noopDrops.length > 0).length;
  const withBoxFallbackCount = itemResults.filter(
    (r) => r.runtimeDrops.boxGeometryFallbackCount > 0,
  ).length;
  const withDegradedAliasesCount = itemResults.filter(
    (r) => r.symbolAnalysis.degradedAliases.length > 0,
  ).length;
  const withMisclassifiedTl103Count = itemResults.filter(
    (r) => r.runtimeDrops.misclassifiedTl103.length > 0,
  ).length;

  const avgFrustumRatio =
    total > 0
      ? itemResults.reduce((acc, r) => acc + r.frustumVisibilityRatio, 0) / total
      : 0;
  const avgExecutionTimeMs =
    total > 0 ? itemResults.reduce((acc, r) => acc + r.executionTimeMs, 0) / total : 0;

  // Tally diagnostic codes and simulation stats
  const diagnosticHistogram = {};
  const droppedSymbolHistogram = {};
  const degradedAliasHistogram = {};
  const unsupportedConstantHistogram = {};
  const byCategory = {};
  let simEvaluatedCount = 0;
  let simActiveCount = 0;
  let simMovedBodiesTotal = 0;
  let simTriggeredEventsTotal = 0;
  let simCompletedObjectivesTotal = 0;
  let simAudioCuesTotal = 0;

  for (const r of itemResults) {
    if (!byCategory[r.category]) {
      byCategory[r.category] = {
        total: 0,
        compileSucceeded: 0,
        cleanCompileNoDrops: 0,
        withDrops: 0,
        avgFrustumVisibilityRatio: 0,
        simEvaluated: 0,
        simActive: 0,
      };
    }
    const cat = byCategory[r.category];
    cat.total++;
    if (r.compileSucceeded) cat.compileSucceeded++;
    if (r.cleanCompileNoDrops) cat.cleanCompileNoDrops++;
    if (
      r.runtimeDrops.noopDrops.length > 0 ||
      r.runtimeDrops.boxGeometryFallbackCount > 0 ||
      r.symbolAnalysis.degradedAliases.length > 0
    ) {
      cat.withDrops++;
    }
    cat.avgFrustumVisibilityRatio += r.frustumVisibilityRatio;
    if (r.simEvaluation?.ran) {
      cat.simEvaluated++;
      simEvaluatedCount++;
      if (r.simEvaluation.simActive) {
        cat.simActive++;
        simActiveCount++;
      }
      simMovedBodiesTotal += r.simEvaluation.movedBodies || 0;
      simTriggeredEventsTotal += (r.simEvaluation.triggeredEvents || []).length;
      simCompletedObjectivesTotal += (r.simEvaluation.completedObjectives || []).length;
      simAudioCuesTotal += (r.simEvaluation.audioCuesFired || []).length;
    }

    for (const d of r.diagnostics) {
      diagnosticHistogram[d.code] = (diagnosticHistogram[d.code] || 0) + 1;
    }
    for (const sym of r.runtimeDrops.noopDrops) {
      droppedSymbolHistogram[sym] = (droppedSymbolHistogram[sym] || 0) + 1;
    }
    for (const d of r.symbolAnalysis.degradedAliases) {
      degradedAliasHistogram[d.symbol] = (degradedAliasHistogram[d.symbol] || 0) + 1;
    }
    for (const c of r.symbolAnalysis.unsupportedConstants) {
      unsupportedConstantHistogram[c] = (unsupportedConstantHistogram[c] || 0) + 1;
    }
  }

  for (const cat of Object.values(byCategory)) {
    cat.avgFrustumVisibilityRatio =
      cat.total > 0 ? Number((cat.avgFrustumVisibilityRatio / cat.total).toFixed(3)) : 0;
  }

  return {
    arm,
    timestamp: new Date().toISOString(),
    totalScripts: total,
    compileSuccessCount,
    compileSuccessRate: total > 0 ? Number((compileSuccessCount / total).toFixed(4)) : 0,
    cleanNoDropsCount,
    cleanNoDropsRate: total > 0 ? Number((cleanNoDropsCount / total).toFixed(4)) : 0,
    withNoopDropsCount,
    withBoxFallbackCount,
    withDegradedAliasesCount,
    withMisclassifiedTl103Count,
    avgFrustumVisibilityRatio: Number(avgFrustumRatio.toFixed(3)),
    avgExecutionTimeMs: Number(avgExecutionTimeMs.toFixed(2)),
    simSummary: {
      simEvaluatedCount,
      simActiveCount,
      simActiveRate:
        simEvaluatedCount > 0 ? Number((simActiveCount / simEvaluatedCount).toFixed(4)) : 0,
      simMovedBodiesTotal,
      simTriggeredEventsTotal,
      simCompletedObjectivesTotal,
      simAudioCuesTotal,
    },
    byCategory,
    diagnosticHistogram,
    droppedSymbolHistogram,
    degradedAliasHistogram,
    unsupportedConstantHistogram,
    repairComparison,
    items: itemResults,
  };
}

function formatMarkdownReport(summary) {
  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}% (${n}/${d})` : '0.0% (0/0)');
  const sim = summary.simSummary || {
    simEvaluatedCount: 0,
    simActiveCount: 0,
    simMovedBodiesTotal: 0,
    simTriggeredEventsTotal: 0,
    simCompletedObjectivesTotal: 0,
    simAudioCuesTotal: 0,
  };
  const lines = [
    `# \`three-live\` Three.js Codegen & Compiler Eval Report — Arm: \`${summary.arm}\``,
    '',
    `- **Generated:** ${summary.timestamp}`,
    `- **Scripts Evaluated:** ${summary.totalScripts}`,
    `- **Compile Success Rate (\`valid && meshCount > 0\`):** **${pct(summary.compileSuccessCount, summary.totalScripts)}**`,
    `- **Clean Compile Rate (0 silent drops / 0 fallbacks / 0 errors):** **${pct(summary.cleanNoDropsCount, summary.totalScripts)}**`,
    `- **Temporal & Interactive Simulation Pass Rate (\`three-live-cli sim\`):** **${pct(sim.simActiveCount, sim.simEvaluatedCount)}** (${sim.simMovedBodiesTotal} moving bodies, ${sim.simTriggeredEventsTotal} events, ${sim.simCompletedObjectivesTotal} objectives, ${sim.simAudioCuesTotal} audio cues)`,
    `- **Scripts with Silent \`noopProxy\` Drops:** ${pct(summary.withNoopDropsCount, summary.totalScripts)}`,
    `- **Scripts with \`BoxGeometry(0.5)\` Silent Geometry Fallback:** ${pct(summary.withBoxFallbackCount, summary.totalScripts)}`,
    `- **Scripts with Degraded Primitive Aliases (\`RingGeometry\`, \`CapsuleGeometry\`, \`SpotLight\`, etc.):** ${pct(summary.withDegradedAliasesCount, summary.totalScripts)}`,
    `- **Scripts with Misclassified \`TL103\` Warnings (non-loader symbols reported as external loaders):** ${pct(summary.withMisclassifiedTl103Count, summary.totalScripts)}`,
    `- **Mean Camera Frustum Visibility Ratio:** ${(summary.avgFrustumVisibilityRatio * 100).toFixed(1)}%`,
    `- **Mean Compiler Execution Time:** ${summary.avgExecutionTimeMs.toFixed(1)} ms`,
    '',
    '## Breakdown by Category',
    '',
    '| Category | Scripts | Compile Success | Clean (No Drops) | Had Drops/Aliases | Sim Active (`three-live-cli sim`) | Mean Frustum Visibility |',
    '| :--- | :---: | :---: | :---: | :---: | :---: | :---: |',
  ];

  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    const simCell =
      stats.simEvaluated > 0 ? pct(stats.simActive, stats.simEvaluated) : '—';
    lines.push(
      `| \`${cat}\` | ${stats.total} | ${pct(stats.compileSucceeded, stats.total)} | ${pct(stats.cleanCompileNoDrops, stats.total)} | ${pct(stats.withDrops, stats.total)} | ${simCell} | ${(stats.avgFrustumVisibilityRatio * 100).toFixed(1)}% |`,
    );
  }

  if (summary.repairComparison) {
    const rc = summary.repairComparison;
    lines.push(
      '',
      '## 1-Turn Closed-Loop Self-Repair (Warning Actionability)',
      '',
      `- **Scripts Needing Repair (Drops/Aliases or Compiler Warnings):** ${rc.repairedTotal}`,
      `- **Clean (0 Drops/Aliases) Before -> After Repair:** ${pct(rc.beforeCleanCount, summary.totalScripts)} -> **${pct(rc.afterCleanCount, summary.totalScripts)}**`,
      `- **Warning-Free Scripts (0 Error/Warning Diagnostics) Before -> After Repair:** ${pct(rc.beforeWarningFreeCount, summary.totalScripts)} -> **${pct(rc.afterWarningFreeCount, summary.totalScripts)}**`,
      `- **Temporal & Interactive Sim Active Before -> After Repair:** ${pct(rc.beforeSimActiveCount, rc.simEvaluatedCount)} -> **${pct(rc.afterSimActiveCount, rc.simEvaluatedCount)}**`,
      `- **Compiler Error/Warning Diagnostics Before -> After Repair:** ${rc.warningsBefore} -> **${rc.warningsAfter}**`,
      `- **Total Diagnostics (including TL306/TL307 info) Before -> After Repair:** ${rc.diagnosticsBefore} -> ${rc.diagnosticsAfter}`,
    );
  }

  lines.push('', '## Compiler Diagnostic Histogram (`TL100–TL402`)', '');
  const diagEntries = Object.entries(summary.diagnosticHistogram).sort((a, b) => b[1] - a[1]);
  if (diagEntries.length === 0) {
    lines.push('_No diagnostics emitted._');
  } else {
    lines.push('| Diagnostic Code | Occurrences |', '| :--- | :---: |');
    for (const [code, count] of diagEntries) {
      lines.push(`| \`${code}\` | ${count} |`);
    }
  }

  lines.push('', '## Dropped `THREE.*` Symbols (`noopProxy`)', '');
  const dropEntries = Object.entries(summary.droppedSymbolHistogram).sort((a, b) => b[1] - a[1]);
  if (dropEntries.length === 0) {
    lines.push('_No `THREE.*` symbols hit `noopProxy`._');
  } else {
    lines.push('| Dropped Symbol | Scripts Affected | Classification |', '| :--- | :---: | :--- |');
    for (const [sym, count] of dropEntries) {
      const kind = UNSUPPORTED_CONSTANTS.has(sym)
        ? 'Missing Enum Constant (coerces to 0 + triggers misleading TL103)'
        : GENUINE_TL103_LOADER_CONTROL_SYMBOLS.has(sym)
          ? 'External Loader / Camera Control (TL103)'
          : 'Unsupported Geometry / Curve / Object Class (triggers misleading TL103)';
      lines.push(`| \`THREE.${sym}\` | ${count} | ${kind} |`);
    }
  }

  lines.push('', '## Degraded `THREE.*` Aliases (`TL102`)', '');
  const aliasEntries = Object.entries(summary.degradedAliasHistogram).sort((a, b) => b[1] - a[1]);
  if (aliasEntries.length === 0) {
    lines.push('_No degraded alias symbols used._');
  } else {
    lines.push('| Symbol | Occurrences | Runtime Degradation Behavior |', '| :--- | :---: | :--- |');
    for (const [sym, count] of aliasEntries) {
      lines.push(`| \`THREE.${sym}\` | ${count} | ${DEGRADED_ALIAS_SYMBOLS.get(sym)} |`);
    }
  }

  lines.push('', '## Per-Script Results', '');
  lines.push(
    '| ID | Category | Valid | Meshes (Vis) | Verts | Sim (`moved / ev / obj / aud`) | Drops (`noopProxy`) | Box0.5 Fallbacks | Degraded Aliases | Diagnostics |',
    '| :--- | :--- | :---: | :---: | :---: | :---: | :--- | :---: | :--- | :--- |',
  );
  for (const item of summary.items) {
    const dropsStr =
      item.runtimeDrops.noopDrops.map((s) => `\`${s}\``).join(', ') || '—';
    const aliasStr =
      item.symbolAnalysis.degradedAliases.map((a) => `\`${a.symbol}\``).join(', ') || '—';
    const diagsStr =
      Array.from(new Set(item.diagnosticCodes)).map((c) => `\`${c}\``).join(', ') || '—';
    const se = item.simEvaluation;
    const simStr = se?.ran
      ? `${se.simActive ? 'PASS' : 'INACTIVE'} (${se.movedBodies} / ${se.triggeredEvents.length} / ${se.completedObjectives.length} / ${se.audioCuesFired.length})`
      : '—';
    lines.push(
      `| \`${item.id}\` | \`${item.category}\` | ${item.compileSucceeded ? 'PASS' : 'FAIL'} | ${item.meshCount} (${item.visibleMeshCount}) | ${item.vertexCount} | ${simStr} | ${dropsStr} | ${item.runtimeDrops.boxGeometryFallbackCount} | ${aliasStr} | ${diagsStr} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generates a side-by-side comparison report across two or more evaluated arms
 * (e.g. `vanilla` vs `guided`, including their 1-turn repair results).
 */
function generateComparisonReport(armNames) {
  const summaries = [];
  for (const arm of armNames) {
    const p = path.join(RESULTS_DIR, `summary_${arm}.json`);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing summary file for arm "${arm}": ${p}`);
    }
    summaries.push(JSON.parse(fs.readFileSync(p, 'utf8')));
  }

  const countWarnFree = (s) =>
    (s.items || []).filter(
      (r) =>
        r.cleanCompileNoDrops &&
        !(r.diagnostics || []).some((d) => d.severity === 'error' || d.severity === 'warning'),
    ).length;
  const countActionableWarns = (s) =>
    (s.items || []).reduce(
      (acc, r) =>
        acc +
        (r.diagnostics || []).filter((d) => d.severity === 'error' || d.severity === 'warning')
          .length,
      0,
    );

  const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}% (${n}/${d})` : '0.0% (0/0)');

  const headers = ['Metric', ...summaries.map((s) => `\`${s.arm}\``)];
  const sep = [':---', ...summaries.map(() => ':---:')];
  const rows = [
    [
      '**0-Shot Compile Success (`valid && meshCount > 0`)**',
      ...summaries.map((s) => `**${pct(s.compileSuccessCount, s.totalScripts)}**`),
    ],
    [
      '**0-Shot Clean Compile (0 Drops / 0 Fallbacks / 0 Aliases)**',
      ...summaries.map((s) => `**${pct(s.cleanNoDropsCount, s.totalScripts)}**`),
    ],
    [
      '**0-Shot Warning-Free Rate (0 Error/Warning Diagnostics)**',
      ...summaries.map((s) => `**${pct(countWarnFree(s), s.totalScripts)}**`),
    ],
    [
      '**0-Shot Actionable Compiler Warnings (`error` + `warning`)**',
      ...summaries.map((s) => `${countActionableWarns(s)}`),
    ],
    [
      '**1-Turn Repair Warning-Free Rate**',
      ...summaries.map((s) =>
        s.repairComparison
          ? `**${pct(s.repairComparison.afterWarningFreeCount, s.totalScripts)}**`
          : '—',
      ),
    ],
    [
      '**1-Turn Repair Actionable Warnings (`before -> after`)**',
      ...summaries.map((s) =>
        s.repairComparison
          ? `${s.repairComparison.warningsBefore} -> **${s.repairComparison.warningsAfter}**`
          : '—',
      ),
    ],
    [
      '**Temporal & Interactive Sim Pass (`three-live-cli sim`)**',
      ...summaries.map((s) =>
        s.simSummary?.simEvaluatedCount > 0
          ? `**${pct(s.simSummary.simActiveCount, s.simSummary.simEvaluatedCount)}**`
          : '—',
      ),
    ],
    [
      '**Mean Camera Frustum Visibility Ratio**',
      ...summaries.map((s) => `${(s.avgFrustumVisibilityRatio * 100).toFixed(1)}%`),
    ],
    [
      '**Mean Compiler Execution Time**',
      ...summaries.map((s) => `${s.avgExecutionTimeMs.toFixed(1)} ms`),
    ],
  ];

  const allDiagCodes = new Set();
  const allCategories = new Set();
  for (const s of summaries) {
    for (const k of Object.keys(s.diagnosticHistogram || {})) allDiagCodes.add(k);
    for (const k of Object.keys(s.byCategory || {})) allCategories.add(k);
  }

  const lines = [
    `# \`three-live\` Multi-Arm Ablation & Comparison Report (${armNames.map((a) => `\`${a}\``).join(' vs. ')})`,
    '',
    `- **Generated:** ${new Date().toISOString()}`,
    '',
    '## Overall Comparison',
    '',
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
    '## 0-Shot Warning-Free Rate by Category',
    '',
    `| Category | ${summaries.map((s) => `\`${s.arm}\` 0-Shot Warn-Free`).join(' | ')} | ${summaries.map((s) => `\`${s.arm}\` Sim Active`).join(' | ')} |`,
    `| :--- | ${summaries.map(() => ':---:').join(' | ')} | ${summaries.map(() => ':---:').join(' | ')} |`,
  ];

  for (const cat of Array.from(allCategories).sort()) {
    const warnFreeCells = summaries.map((s) => {
      const catItems = (s.items || []).filter((r) => r.category === cat);
      const wf = catItems.filter(
        (r) =>
          r.cleanCompileNoDrops &&
          !(r.diagnostics || []).some((d) => d.severity === 'error' || d.severity === 'warning'),
      ).length;
      return pct(wf, catItems.length);
    });
    const simCells = summaries.map((s) => {
      const st = s.byCategory?.[cat];
      return st && st.simEvaluated > 0 ? pct(st.simActive, st.simEvaluated) : '—';
    });
    lines.push(`| \`${cat}\` | ${warnFreeCells.join(' | ')} | ${simCells.join(' | ')} |`);
  }

  lines.push(
    '',
    '## Compiler Diagnostic Code Comparison (0-Shot Occurrences)',
    '',
    `| Diagnostic Code | ${summaries.map((s) => `\`${s.arm}\``).join(' | ')} |`,
    `| :--- | ${summaries.map(() => ':---:').join(' | ')} |`,
  );
  for (const code of Array.from(allDiagCodes).sort()) {
    const cells = summaries.map((s) => String(s.diagnosticHistogram?.[code] || 0));
    lines.push(`| \`${code}\` | ${cells.join(' | ')} |`);
  }
  lines.push('');

  const slug = armNames.join('_vs_');
  const mdPath = path.join(RESULTS_DIR, `comparison_${slug}.md`);
  const jsonPath = path.join(RESULTS_DIR, `comparison_${slug}.json`);
  const mdContent = lines.join('\n');
  fs.writeFileSync(mdPath, mdContent, 'utf8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        arms: summaries.map((s) => ({
          arm: s.arm,
          totalScripts: s.totalScripts,
          compileSuccessCount: s.compileSuccessCount,
          cleanNoDropsCount: s.cleanNoDropsCount,
          zeroShotWarningFreeCount: countWarnFree(s),
          zeroShotActionableWarnings: countActionableWarns(s),
          repairComparison: s.repairComparison || null,
          simSummary: s.simSummary || null,
          avgFrustumVisibilityRatio: s.avgFrustumVisibilityRatio,
          avgExecutionTimeMs: s.avgExecutionTimeMs,
          diagnosticHistogram: s.diagnosticHistogram,
        })),
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  return {mdPath, jsonPath, mdContent};
}

// ============================================================================
// 7. CLI Argument Parser & Main Orchestrator
// ============================================================================

function parseCliArgs(argv) {
  const opts = {
    arm: 'smoke',
    armExplicit: false,
    generate: false,
    evaluate: true,
    sim: true,
    simAll: false,
    repair: false,
    render: false,
    overwrite: false,
    provider: null,
    model: null,
    cmd: null,
    category: null,
    ids: null,
    limit: null,
    concurrency: 4,
    compare: null,
    promptsPath: DEFAULT_PROMPTS_PATH,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else if (arg === '--generate') {
      opts.generate = true;
      if (!opts.armExplicit) opts.arm = 'vanilla';
    } else if (arg === '--evaluate') {
      opts.evaluate = true;
    } else if (arg === '--sim') {
      opts.sim = true;
    } else if (arg === '--no-sim') {
      opts.sim = false;
    } else if (arg === '--sim-all') {
      opts.sim = true;
      opts.simAll = true;
    } else if (arg === '--repair') {
      opts.repair = true;
    } else if (arg === '--render') {
      opts.render = true;
    } else if (arg === '--overwrite') {
      opts.overwrite = true;
    } else if (arg.startsWith('--arm=')) {
      opts.arm = arg.slice('--arm='.length);
      opts.armExplicit = true;
    } else if (arg.startsWith('--provider=')) {
      opts.provider = arg.slice('--provider='.length);
    } else if (arg.startsWith('--model=')) {
      opts.model = arg.slice('--model='.length);
    } else if (arg.startsWith('--cmd=')) {
      opts.cmd = arg.slice('--cmd='.length);
    } else if (arg.startsWith('--category=')) {
      opts.category = arg.slice('--category='.length);
    } else if (arg.startsWith('--ids=')) {
      opts.ids = new Set(
        arg
          .slice('--ids='.length)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (arg.startsWith('--limit=')) {
      opts.limit = parseInt(arg.slice('--limit='.length), 10);
    } else if (arg.startsWith('--concurrency=')) {
      opts.concurrency = Math.max(1, parseInt(arg.slice('--concurrency='.length), 10) || 1);
    } else if (arg === '--compare') {
      opts.compare = ['vanilla', 'guided'];
    } else if (arg.startsWith('--compare=')) {
      opts.compare = arg
        .slice('--compare='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--prompts=')) {
      opts.promptsPath = path.resolve(arg.slice('--prompts='.length));
    }
  }
  return opts;
}

function printHelp() {
  console.log(`
three-live Three.js Codegen & Compiler Evaluation Suite

Usage:
  node evals/run_evals.js [options]

Examples:
  # 1. Run built-in smoke suite immediately (0 API keys required):
  node evals/run_evals.js --arm=smoke

  # 2. Generate 100 vanilla Three.js scripts with Gemini and evaluate:
  GEMINI_API_KEY=... node evals/run_evals.js --generate --arm=vanilla --provider=gemini

  # 3. Generate 100 guided three-live scripts and run 1-turn compiler self-repair:
  GEMINI_API_KEY=... node evals/run_evals.js --generate --repair --arm=guided --provider=gemini

  # 4. Use OpenAI / OpenRouter / local Ollama:
  OPENAI_API_KEY=... node evals/run_evals.js --generate --arm=vanilla --provider=openai --model=gpt-4o
  node evals/run_evals.js --generate --arm=vanilla --provider=ollama --model=qwen2.5-coder:14b

  # 5. Pipe prompts through ANY custom CLI command (stdin -> stdout):
  node evals/run_evals.js --generate --arm=vanilla --cmd="gemini -p"

Options:
  --arm=<name>          Prompt/script arm directory under evals/scripts/<arm> (default: smoke, or vanilla with --generate)
  --generate            Generate Three.js scripts from evals/prompts/prompts_100.json using an LLM
  --evaluate            Compile and evaluate scripts in evals/scripts/<arm> (default: true)
  --repair              Run 1-turn closed-loop self-repair using three-live compiler diagnostics
  --render              Render 4-up quad contact sheets (evals/results/renders/<arm>/<id>.png)
  --overwrite           Re-generate scripts even if evals/scripts/<arm>/<id>.js already exists
  --provider=<name>     LLM provider: gemini | openai | anthropic | ollama | cmd
  --model=<name>        Model identifier for the chosen provider
  --cmd="<command>"     Shell command for --provider=cmd (receives prompt on stdin, outputs JS on stdout)
  --category=<name>     Filter prompts by category (hard_surface_cad, organic_curves, materials_lighting, instancing_animation_ik, spatial_xr_sim)
  --ids=<id1,id2,...>   Filter to specific prompt IDs (e.g. --ids=cad_01,org_01,xr_01)
  --limit=<N>           Evaluate/generate only the first N matching prompts
  --concurrency=<N>     Parallel LLM requests during --generate / --repair (default: 4)
`);
}

/**
 * Simple concurrency pool for parallel LLM calls.
 */
async function runPool(items, concurrency, workerFn) {
  const results = new Array(items.length);
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await workerFn(items[idx], idx);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);
  return results;
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  // Locate `three-live-cli` binary
  const binInfo = resolvePlatformInfo();
  const binPath = findExistingBinary(binInfo);
  if (!binPath) {
    console.error(
      '[evals] Could not find local `three-live-cli` binary.\n' +
        'Build it first with: cargo build --release --manifest-path compiler/Cargo.toml --bin three-live-cli',
    );
    process.exit(1);
  }

  // Load 100 prompts benchmark
  const allPrompts = JSON.parse(fs.readFileSync(opts.promptsPath, 'utf8'));
  const promptById = new Map(allPrompts.map((p) => [p.id, p]));

  let selectedPrompts = allPrompts.filter((p) => {
    if (opts.category && p.category !== opts.category) return false;
    if (opts.ids && !opts.ids.has(p.id)) return false;
    return true;
  });
  if (opts.limit && opts.limit > 0) {
    selectedPrompts = selectedPrompts.slice(0, opts.limit);
  }

  if (opts.arm === 'smoke' && !opts.generate) {
    ensureSmokeScriptsExist();
  }

  const armDir = path.join(SCRIPTS_DIR, opts.arm);
  fs.mkdirSync(armDir, {recursive: true});
  fs.mkdirSync(RESULTS_DIR, {recursive: true});

  // Step 1: Optional Code Generation via LLM
  if (opts.generate) {
    const llmConfig = resolveLlmConfig(opts);
    console.log(
      `[evals] Generating ${selectedPrompts.length} scripts for arm="${opts.arm}" using provider="${llmConfig.provider}" (${llmConfig.model})...`,
    );
    await runPool(selectedPrompts, opts.concurrency, async (promptEntry, idx) => {
      const outPath = path.join(armDir, `${promptEntry.id}.js`);
      if (!opts.overwrite && fs.existsSync(outPath) && fs.statSync(outPath).size > 10) {
        console.log(
          `  [${idx + 1}/${selectedPrompts.length}] ${promptEntry.id} (cached)`,
        );
        return;
      }
      const prompts = buildCodegenPrompts(promptEntry, opts.arm);
      try {
        const jsCode = await callLlm(prompts, llmConfig);
        fs.writeFileSync(outPath, jsCode, 'utf8');
        console.log(
          `  [${idx + 1}/${selectedPrompts.length}] ${promptEntry.id} -> generated (${jsCode.length} bytes)`,
        );
      } catch (err) {
        console.error(
          `  [${idx + 1}/${selectedPrompts.length}] ${promptEntry.id} FAILED: ${err.message}`,
        );
      }
    });
  }

  // Discover script files to evaluate in `evals/scripts/<arm>/`
  const existingFiles = fs
    .readdirSync(armDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const scriptsToEval = [];
  for (const file of existingFiles) {
    const id = path.basename(file, '.js');
    if (opts.ids && !opts.ids.has(id)) continue;
    const promptEntry = promptById.get(id) || null;
    if (opts.category && promptEntry && promptEntry.category !== opts.category) continue;
    scriptsToEval.push({
      id,
      scriptPath: path.join(armDir, file),
      promptEntry,
    });
  }
  if (opts.limit && opts.limit > 0 && scriptsToEval.length > opts.limit) {
    scriptsToEval.length = opts.limit;
  }

  if (scriptsToEval.length === 0) {
    console.error(
      `[evals] No scripts found in ${path.relative(ROOT_DIR, armDir)}.\n` +
        `Run with --arm=smoke for the built-in smoke suite, or pass --generate with an LLM provider.`,
    );
    process.exit(1);
  }

  // Step 2: Evaluate all scripts in the arm
  console.log(
    `[evals] Evaluating ${scriptsToEval.length} scripts in ${path.relative(ROOT_DIR, armDir)} with three-live-cli...`,
  );
  const itemResults = await runPool(
    scriptsToEval,
    Math.max(opts.concurrency, 8),
    ({scriptPath, promptEntry}) =>
      evaluateSingleScript(binPath, scriptPath, promptEntry, opts),
  );

  // Step 3: Optional 1-turn closed-loop self-repair (`--repair`)
  let repairComparison = null;
  if (opts.repair) {
    let llmConfig = null;
    const repairedArm = `${opts.arm}_repaired`;
    const repairedDir = path.join(SCRIPTS_DIR, repairedArm);
    fs.mkdirSync(repairedDir, {recursive: true});

    const isActionableForRepair = (r) =>
      !r.cleanCompileNoDrops ||
      (r.simEvaluation?.ran && !r.simEvaluation.simActive) ||
      r.diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning');
    const needsRepair = itemResults.filter(isActionableForRepair);
    console.log(
      `[evals] Running 1-turn closed-loop repair on ${needsRepair.length}/${itemResults.length} scripts with drops, inactive sim, or compiler warnings...`,
    );

    await runPool(itemResults, opts.concurrency, async (item, idx) => {
      const srcPath = path.join(ROOT_DIR, item.scriptPath);
      const dstPath = path.join(repairedDir, `${item.id}.js`);
      const promptEntry = promptById.get(item.id) || {
        id: item.id,
        category: item.category,
        title: item.title,
        prompt: item.title,
      };

      if (!isActionableForRepair(item)) {
        fs.copyFileSync(srcPath, dstPath);
        return;
      }

      if (!opts.overwrite && fs.existsSync(dstPath) && fs.statSync(dstPath).size > 10) {
        return;
      }

      if (!llmConfig) {
        llmConfig = resolveLlmConfig(opts);
      }

      const originalCode = fs.readFileSync(srcPath, 'utf8');
      const repairPrompts = buildRepairPrompts(
        promptEntry,
        originalCode,
        {
          valid: item.valid,
          summary: {
            meshCount: item.meshCount,
            lightCount: item.lightCount,
            camera: {visibleMeshCount: item.visibleMeshCount},
          },
          simEvaluation: item.simEvaluation,
          diagnostics: item.diagnostics,
        },
        opts.arm,
      );
      try {
        const fixedCode = await callLlm(repairPrompts, llmConfig);
        fs.writeFileSync(dstPath, fixedCode, 'utf8');
        console.log(`  [repair ${idx + 1}/${itemResults.length}] ${item.id} -> repaired`);
      } catch (err) {
        console.error(`  [repair ${idx + 1}/${itemResults.length}] ${item.id} FAILED: ${err.message}`);
        fs.copyFileSync(srcPath, dstPath);
      }
    });

    const repairedResults = await runPool(
      scriptsToEval,
      Math.max(opts.concurrency, 8),
      ({id, promptEntry}) =>
        evaluateSingleScript(binPath, path.join(repairedDir, `${id}.js`), promptEntry, opts),
    );
    const repairedSummary = aggregateResults(repairedArm, repairedResults);
    fs.writeFileSync(
      path.join(RESULTS_DIR, `summary_${repairedArm}.json`),
      JSON.stringify(repairedSummary, null, 2) + '\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(RESULTS_DIR, `report_${repairedArm}.md`),
      formatMarkdownReport(repairedSummary),
      'utf8',
    );

    const countWarnFree = (list) =>
      list.filter(
        (r) =>
          r.cleanCompileNoDrops &&
          !r.diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning'),
      ).length;
    const countWarns = (list) =>
      list.reduce(
        (acc, r) =>
          acc + r.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'warning').length,
        0,
      );

    repairComparison = {
      repairedTotal: needsRepair.length,
      beforeCompileSuccessCount: itemResults.filter((r) => r.compileSucceeded).length,
      afterCompileSuccessCount: repairedResults.filter((r) => r.compileSucceeded).length,
      beforeCleanCount: itemResults.filter((r) => r.cleanCompileNoDrops).length,
      afterCleanCount: repairedResults.filter((r) => r.cleanCompileNoDrops).length,
      beforeWarningFreeCount: countWarnFree(itemResults),
      afterWarningFreeCount: countWarnFree(repairedResults),
      simEvaluatedCount: itemResults.filter((r) => r.simEvaluation?.ran).length,
      beforeSimActiveCount: itemResults.filter((r) => r.simEvaluation?.simActive).length,
      afterSimActiveCount: repairedResults.filter((r) => r.simEvaluation?.simActive).length,
      warningsBefore: countWarns(itemResults),
      warningsAfter: countWarns(repairedResults),
      diagnosticsBefore: itemResults.reduce((acc, r) => acc + r.diagnostics.length, 0),
      diagnosticsAfter: repairedResults.reduce((acc, r) => acc + r.diagnostics.length, 0),
    };
  }

  // Step 4: Optional 4-up quad contact sheet rendering (`--render`)
  if (opts.render) {
    const rendersDir = path.join(RESULTS_DIR, 'renders', opts.arm);
    fs.mkdirSync(rendersDir, {recursive: true});
    console.log(`[evals] Rendering 4-up quad contact sheets to ${path.relative(ROOT_DIR, rendersDir)}...`);
    for (const {id, scriptPath} of scriptsToEval) {
      const outPng = path.join(rendersDir, `${id}.png`);
      spawnSync(
        binPath,
        ['render', scriptPath, outPng, '--view=quad', '--grid', '--annotations'],
        {stdio: 'ignore'},
      );
    }
  }

  // Step 5: Write summary JSON + Markdown report and print console table
  const summary = aggregateResults(opts.arm, itemResults, repairComparison);
  const summaryJsonPath = path.join(RESULTS_DIR, `summary_${opts.arm}.json`);
  const reportMdPath = path.join(RESULTS_DIR, `report_${opts.arm}.md`);
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  fs.writeFileSync(reportMdPath, formatMarkdownReport(summary), 'utf8');

  console.log('\n====================================================================');
  console.log(` three-live Eval Summary (Arm: ${opts.arm})`);
  console.log('====================================================================');
  console.log(
    `  Scripts Evaluated:             ${summary.totalScripts}`,
  );
  console.log(
    `  Compile Success (valid):       ${summary.compileSuccessCount}/${summary.totalScripts} (${(summary.compileSuccessRate * 100).toFixed(1)}%)`,
  );
  console.log(
    `  Clean Compile (0 drops/warns): ${summary.cleanNoDropsCount}/${summary.totalScripts} (${(summary.cleanNoDropsRate * 100).toFixed(1)}%)`,
  );
  if (summary.simSummary && summary.simSummary.simEvaluatedCount > 0) {
    const ss = summary.simSummary;
    console.log(
      `  Temporal/Interactive Sim Pass: ${ss.simActiveCount}/${ss.simEvaluatedCount} (${(ss.simActiveRate * 100).toFixed(1)}%) [${ss.simMovedBodiesTotal} bodies, ${ss.simTriggeredEventsTotal} events, ${ss.simCompletedObjectivesTotal} obj, ${ss.simAudioCuesTotal} audio]`,
    );
  }
  console.log(
    `  Silent noopProxy Drops:        ${summary.withNoopDropsCount}/${summary.totalScripts}`,
  );
  console.log(
    `  BoxGeometry(0.5) Fallbacks:    ${summary.withBoxFallbackCount}/${summary.totalScripts}`,
  );
  console.log(
    `  Degraded Aliases (TL102):      ${summary.withDegradedAliasesCount}/${summary.totalScripts}`,
  );
  console.log(
    `  Misclassified TL103 Warnings:  ${summary.withMisclassifiedTl103Count}/${summary.totalScripts}`,
  );
  console.log(
    `  Mean Frustum Visibility:       ${(summary.avgFrustumVisibilityRatio * 100).toFixed(1)}%`,
  );
  console.log(
    `  Mean Compiler Latency:         ${summary.avgExecutionTimeMs.toFixed(1)} ms`,
  );
  if (repairComparison) {
    console.log('--------------------------------------------------------------------');
    console.log(
      `  1-Turn Repair Clean (0 drops): ${repairComparison.beforeCleanCount}/${summary.totalScripts} -> ${repairComparison.afterCleanCount}/${summary.totalScripts}`,
    );
    console.log(
      `  1-Turn Repair Warning-Free:    ${repairComparison.beforeWarningFreeCount}/${summary.totalScripts} -> ${repairComparison.afterWarningFreeCount}/${summary.totalScripts}`,
    );
    if (repairComparison.simEvaluatedCount > 0) {
      console.log(
        `  1-Turn Repair Sim Active:      ${repairComparison.beforeSimActiveCount}/${repairComparison.simEvaluatedCount} -> ${repairComparison.afterSimActiveCount}/${repairComparison.simEvaluatedCount}`,
      );
    }
    console.log(
      `  1-Turn Repair Warnings:        ${repairComparison.warningsBefore} -> ${repairComparison.warningsAfter}`,
    );
  }
  console.log('====================================================================');
  console.log(`  JSON Summary:    ${path.relative(ROOT_DIR, summaryJsonPath)}`);
  console.log(`  Markdown Report: ${path.relative(ROOT_DIR, reportMdPath)}`);
  if (opts.compare && opts.compare.length >= 2) {
    const cmp = generateComparisonReport(opts.compare);
    console.log(`  Comparison MD:   ${path.relative(ROOT_DIR, cmp.mdPath)}`);
  }
  console.log('====================================================================\n');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[evals] Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  analyzeThreeSymbols,
  buildCodegenPrompts,
  buildRepairPrompts,
  evaluateSingleScript,
  extractJsCode,
};
