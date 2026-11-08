/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {PromptEntry, PromptPair, RepairValidationInput} from './types.ts';

export const VANILLA_SYSTEM_PROMPT = [
  'You are an expert 3D graphics engineer writing procedural Three.js code.',
  'Return ONLY a single valid JavaScript code block (no HTML wrapper, no imports, no markdown explanations).',
  'Assume `THREE`, `scene` (a `THREE.Scene`), and `camera` (a `THREE.PerspectiveCamera`) are already',
  'pre-populated in the global scope, or you may instantiate `const scene = new THREE.Scene()` and',
  '`const camera = new THREE.PerspectiveCamera(...)`.',
  'Use real-world meter scale (1 unit = 1 meter), Y-up coordinates, rests on or above y = 0,',
  'include appropriate lighting (`AmbientLight` + `DirectionalLight`/`PointLight`), and frame the',
  'camera with `camera.position.set(...)` and `camera.lookAt(...)` so the entire scene is clearly visible.',
].join('\n');

export const GUIDED_SYSTEM_PROMPT = [
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
  '   - Procedural Noise & Deterministic PRNG: `THREE.ImprovedNoise` (`noise(x, y, z)`), `THREE.SimplexNoise` (`noise(x, y)`, `noise3d(x, y, z)`, `noise4d(x, y, z, w)`), and `THREE.MathUtils.seededRandom(seed?)` for terrain heightmaps and organic textures.',
  '   - DO NOT USE degraded or external Three.js classes: `Sprite`, `HemisphereLight`, `RectAreaLight`, `GLTFLoader`, `OrbitControls`.',
  '3. Supported Materials, Textures & Colors: `MeshStandardMaterial` and `MeshPhysicalMaterial` (`color`, `map`, `roughness`, `metalness`,',
  '   `emissive`, `emissiveIntensity`, `transmission`, `ior`, `thickness`, `attenuationColor`, `attenuationDistance`,',
  '   `clearcoat`, `clearcoatRoughness`, `iridescence`, `iridescenceIOR`, `sheen`, `sheenColor`, `sheenRoughness`,',
  '   `dispersion`, `opacity`, `transparent`), plus procedural `THREE.DataTexture(data, width, height, THREE.RGBAFormat)` and `THREE.CanvasTexture(canvas)` (`document.createElement("canvas").getContext("2d")`).',
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

export function buildCodegenPrompts(promptEntry: PromptEntry, arm: string): PromptPair {
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

export function buildRepairPrompts(
  promptEntry: PromptEntry,
  originalCode: string,
  validationReport: RepairValidationInput,
  arm: string,
): PromptPair {
  const systemPrompt = arm === 'guided' ? GUIDED_SYSTEM_PROMPT : VANILLA_SYSTEM_PROMPT;
  const allDiags = validationReport.diagnostics ?? [];
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

  const ve = validationReport.visualEvaluation;
  const visualHint =
    ve?.ran && (!ve.visualPass || (ve.overallScore ?? 5) < 4.5) && ve.visualCritique
      ? `\n- [VISUAL JUDGE] 4-Up Contact Sheet Score ${ve.overallScore}/5.0 (semanticMatch=${ve.semanticMatch}, spatialCoherence=${ve.spatialCoherence}, cameraFraming=${ve.cameraFraming}, materialAndLighting=${ve.materialAndLighting}): ${ve.visualCritique}`
      : '';

  const userPrompt = [
    `The Three.js script below was generated for task "${promptEntry.title}":`,
    promptEntry.prompt,
    '',
    'When compiled with `three-live-cli validate`, it produced the following diagnostics:',
    summaryText,
    (diagsText || '(No structured diagnostics)') + simHint + visualHint,
    '',
    'Original JavaScript code:',
    '```javascript',
    originalCode.trim(),
    '```',
    '',
    'Please fix all errors and warnings reported above while preserving the full visual and functional intent of the prompt:',
    '- For [TL102] unsupported/degraded symbols (e.g. `RectAreaLight`, `GLTFLoader`), replace them with natively supported `three-live` equivalents (`THREE.DirectionalLight`/`THREE.SpotLight`, `THREE.CanvasTexture(canvas)`, `THREE.DataTexture(data, w, h, THREE.RGBAFormat)`, `ExtrudeGeometry`, or custom `BufferGeometry`).',
    '- For [TL205] missing `mesh.name` on interactive nodes, assign a unique `node.name = "..."` to every Mesh or Group before attaching `userData.xr`, `userData.interactivity`, or `userData.sim`.',
    '- For [TL201] / [TL202] `userData.xr` schema warnings, follow the diagnostic hint (e.g. use `grab: true` instead of `grabbable: true`, remove unrecognized keys, and keep numeric trait values within range).',
    '- For [TL303] meshes outside the camera frustum, pull `camera.position.set(x, y, z)` back further and adjust `camera.lookAt(0, centerY, 0)` so all meshes are inside the camera view.',
    'Return ONLY the corrected JavaScript source code inside a ```javascript ... ``` block.',
  ].join('\n');

  return {systemPrompt, userPrompt};
}
