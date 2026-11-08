#!/usr/bin/env node
/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @fileoverview Generates root `llms.txt` and `llms-full.txt` (plus copies in
 * `examples/` for GitHub Pages hosting) from the canonical documentation and
 * agent skill files so LLM context feeds never drift from source docs.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

function stripLeadingLicenseComment(markdown) {
  return markdown
    .replace(/^<!--[\s\S]*?-->\s*/m, '')
    .replace(/^---\n[\s\S]*?\n---\n\s*/m, '')
    .replace(/^<!-- mdformat (?:off|on).*?-->\n?/gm, '')
    .trim();
}

function buildLlmsIndex() {
  return [
    '# Three-Live & XR-Live (`<three-live>` / `<xr-live>`)',
    '',
    '> On-device JIT compiler and Web Components turning declarative HTML and AI-generated Three.js (`<script type="text/three">`) into WebGL2 & WebXR on the Web, Google Filament & Jetpack XR SceneCore on Android, and Apple RealityKit & Quick Look on iOS/visionOS.',
    '',
    '## Golden Rules for LLMs & Coding Agents',
    '',
    '- Always include `allow-client-scripts` on any `<three-live>` or `<xr-live>` element that contains an inline `<script type="text/three">`.',
    '- Inside `<script type="text/three">`, `THREE` and `scene` (`THREE.Scene`) are pre-defined globals in an isolated Worker sandbox. Add objects via `scene.add(mesh)`.',
    '- Never instantiate `THREE.WebGLRenderer`, `GLTFLoader`, `TextureLoader`, `ShaderMaterial`, or `requestAnimationFrame` inside `<script type="text/three">`. Load external `.glb` files via `<three-live src="...">` or `<xr-anchor src="...">`.',
    '- Attach spatial traits via `mesh.userData.xr = { grab, scale, billboard, follow, anchor, physics, orbit, handles, dimensions, snapTo, snapSocket, gaze, explode, navigable, sync, particles, holdToAsk, worldUnderstanding, splatUrl, splat, bloom, outline, ik, text, audio, character, agent, integrity, zone, spawner, objective, audioCues }`.',
    '- Procedural CAD, Instancing & IK helpers in `THREE`: `Shape`, `Path`, `ExtrudeGeometry`, `TextGeometry`, `CSG` (`union`, `subtract`, `intersect`), `InstancedMesh`, and `IKSolver` (`solveTwoBone`, `solveFABRIK`).',
    '- Attach declarative `KHR_interactivity` behavior graphs via `mesh.userData.interactivity = { onSelect, onHoverIn, onHoverOut, onStart, onReceive }`.',
    '- Scene quotas: max `1,000` meshes, `100,000` vertices, `300,000` indices, `16` textures (`2048x2048`), `3,000 ms` execution timeout.',
    '- Verify, visually inspect, and share scenes headlessly via `npx three-live-cli validate|render|convert|sim|link` (with `--qr` for terminal QR codes) or connect the built-in Model Context Protocol (MCP) stdio server via `npx -y -p three-live three-live-cli mcp` (`three_live_validate`, `three_live_render`, `three_live_convert`, `three_live_sim`, `three_live_link`).',
    '',
    '## Documentation & Guides',
    '',
    '- [Complete Single-File LLM Reference (`llms-full.txt`)](https://google.github.io/three-live/llms-full.txt): Full concatenated authoring guide, `userData.xr` trait dictionary, spatial plugin reference, and copy-paste recipes.',
    '- [LLM & Agent Authoring Guide (`docs/llm-guide.md`)](https://github.com/google/three-live/blob/main/docs/llm-guide.md): Copy-paste system prompt snippet, allowed `THREE.*` constructors, and permissive fallback shims.',
    '- [`<three-live>` Reference (`docs/three-live.md`)](https://github.com/google/three-live/blob/main/docs/three-live.md): Attributes, `<model-viewer>` drop-in API, `KHR_interactivity` authoring, PBR Next, HDRI, animations, and Worker/iframe sandboxing.',
    '- [`<xr-live>` Spatial Computing & Plugins Guide (`docs/xr-live.md`)](https://github.com/google/three-live/blob/main/docs/xr-live.md): Canonical `userData.xr` traits, all 14 spatial plugins (`head-follow`, `manipulation-handles`, `world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`, `exploded-view`, `persistent-anchors`, `spatial-locomotion`, `shared-room`), the 5 `xr-live-sim` simulation plugins, `<div slot="spatial">` cards, depth/physics, 25-joint hands, and native mobile bridges.',
    '- [Developer Cookbook (`docs/cookbook.md`)](https://github.com/google/three-live/blob/main/docs/cookbook.md): Copy-pasteable end-to-end recipes.',
    '',
    '## Agent Skills & Repository Rules',
    '',
    '- [Repository Agent Instructions (`AGENTS.md`)](https://github.com/google/three-live/blob/main/AGENTS.md): Architectural invariants, 3-target parity contract, and build/test commands.',
    '- [Scene & App Authoring Skill (`skills/three-live-authoring/SKILL.md`)](https://github.com/google/three-live/blob/main/skills/three-live-authoring/SKILL.md): Progressive-disclosure skill for building 3D and XR apps.',
    '- [Cross-Platform Plugin Dev Skill (`skills/xr-live-plugin-dev/SKILL.md`)](https://github.com/google/three-live/blob/main/skills/xr-live-plugin-dev/SKILL.md): Contributor workflow for adding traits and plugins across Web, Android, and iOS/visionOS.',
    '',
  ].join('\n');
}

function buildLlmsFull() {
  const sources = [
    'docs/llm-guide.md',
    'skills/three-live-authoring/references/xr-traits-and-plugins.md',
    'skills/three-live-authoring/references/recipes.md',
    'skills/three-live-authoring/references/debugging-and-csp.md',
    'docs/three-live.md',
    'docs/xr-live.md',
  ];

  const sections = [
    '# Three-Live & XR-Live Complete LLM Reference (`llms-full.txt`)',
    '',
    '> Auto-generated from `docs/` and `skills/`. Do not edit by hand; run `node scripts/build_llms_txt.js`.',
  ];

  for (const relPath of sources) {
    const absPath = path.join(ROOT_DIR, relPath);
    if (!fs.existsSync(absPath)) {
      throw new Error(`Missing source doc for llms-full.txt: ${relPath}`);
    }
    const raw = fs.readFileSync(absPath, 'utf8');
    sections.push(
      '',
      '================================================================================',
      `SOURCE: ${relPath}`,
      '================================================================================',
      '',
      stripLeadingLicenseComment(raw),
    );
  }

  return sections.join('\n') + '\n';
}

function generateLlmsFiles() {
  const llmsTxt = buildLlmsIndex();
  const llmsFullTxt = buildLlmsFull();

  const targets = [
    [path.join(ROOT_DIR, 'llms.txt'), llmsTxt],
    [path.join(ROOT_DIR, 'llms-full.txt'), llmsFullTxt],
    [path.join(ROOT_DIR, 'examples', 'llms.txt'), llmsTxt],
    [path.join(ROOT_DIR, 'examples', 'llms-full.txt'), llmsFullTxt],
  ];

  for (const [filePath, content] of targets) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }
  console.log(
    `--> Generated llms.txt (${Buffer.byteLength(llmsTxt)} B) & llms-full.txt (${Buffer.byteLength(llmsFullTxt)} B)`,
  );
}

if (require.main === module) {
  generateLlmsFiles();
}

module.exports = { generateLlmsFiles };
