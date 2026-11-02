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
 * @fileoverview Web half of the web <-> native exporter parity check.
 *
 * Runs `compiler/tests/fixtures/hierarchy_parity.js` through `sceneToCanvas3D`
 * (with the canonical XR trait serializer, as in the spatial plugins bundle and the
 * native engine) and compares a projection of the glTF (node names, hierarchy,
 * local TRS, mesh/material references, XR extras/extensions and the compiled
 * KHR_interactivity graph) against
 * `compiler/tests/fixtures/hierarchy_parity.expected.json`. The Rust test
 * `test_hierarchy_matches_web_exporter_fixture` compares the native GLB
 * against the same fixture, so the two exporters are pinned to each other.
 *
 * Regenerate the fixture after an intentional exporter change with
 * `UPDATE_PARITY_FIXTURE=1 node scripts/build.js --test-three-live`.
 */

import * as THREE from '../src/three-author';
import {sceneToCanvas3D} from '../src/three-convert';
import {registerXRTraitSerializer} from '../src/xr-trait-schema';

// tslint:disable-next-line:no-any Node builtins in the node test bundle.
declare const require: any;
// tslint:disable-next-line:no-any
declare const __dirname: string;
// tslint:disable-next-line:no-any
declare const process: any;

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

/** Rounds every number to 1e-5 (f32 native vs f64 web) and drops `-0`. */
// tslint:disable-next-line:no-any
function canon(v: any): any {
  if (typeof v === 'number') {
    const r = Math.round(v * 1e5) / 1e5;
    return r === 0 ? 0 : r;
  }
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    // tslint:disable-next-line:no-any
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) {
      if (v[k] !== undefined) out[k] = canon(v[k]);
    }
    return out;
  }
  return v;
}

/** Exporter-neutral projection; mirrored by `project_parity` in Rust. */
// tslint:disable-next-line:no-any
function project(gltf: any): any {
  // tslint:disable-next-line:no-any
  const nodes = (gltf.nodes || []).map((n: any) => {
    const hasMesh = typeof n.mesh === 'number';
    const material = hasMesh
      ? gltf.meshes[n.mesh]?.primitives?.[0]?.material ?? null
      : null;
    return {
      name: n.name ?? '',
      children: n.children ?? [],
      translation: n.translation ?? [0, 0, 0],
      rotation: n.rotation ?? [0, 0, 0, 1],
      scale: n.scale ?? [1, 1, 1],
      mesh: hasMesh,
      material,
      xr: n.extras?.xr ?? null,
      hubs: n.extensions?.MOZ_hubs_components ?? null,
      scenecore: n.extensions?.ANDROID_xr_scenecore ?? null,
    };
  });
  return canon({
    sceneNodes: gltf.scenes?.[0]?.nodes ?? [],
    nodes,
    interactivity: gltf.extensions?.KHR_interactivity ?? null,
  });
}

const fixtureDir = path.resolve(__dirname, '../../../compiler/tests/fixtures');
const scriptPath = path.join(fixtureDir, 'hierarchy_parity.js');
const expectedPath = path.join(fixtureDir, 'hierarchy_parity.expected.json');

console.log('\n--- Web <-> native hierarchy parity fixture ---');
registerXRTraitSerializer();
const scene = new THREE.Scene();
// The fixture is a trusted, checked-in scene script authored against the
// sandbox globals (`THREE`, `scene`).
// tslint:disable-next-line:no-any
const runScript = new Function('THREE', 'scene', fs.readFileSync(scriptPath, 'utf8')) as any;
runScript(THREE, scene);
const actual = project(sceneToCanvas3D(scene).gltf);

assert(actual.nodes.length === 7, 'every Object3D (groups, light, empty) is a node');
assert(
  JSON.stringify(actual.sceneNodes) === JSON.stringify([0, 5, 6]),
  'scene roots are the scene children',
);
assert(actual.nodes[2].name === 'Lamp' && actual.nodes[2].mesh, 'nested mesh at DFS index 2');
assert(!actual.nodes[3].mesh, 'empty geometry yields a mesh-less node');

const actualJson = JSON.stringify(actual, null, 2) + '\n';
if (process.env.UPDATE_PARITY_FIXTURE) {
  fs.writeFileSync(expectedPath, actualJson);
  console.log(`   (rewrote ${expectedPath})`);
}
const expectedJson = fs.existsSync(expectedPath)
  ? JSON.stringify(canon(JSON.parse(fs.readFileSync(expectedPath, 'utf8'))), null, 2) + '\n'
  : '';
assert(
  expectedJson === actualJson,
  'sceneToCanvas3D matches hierarchy_parity.expected.json (shared with the Rust test)',
);
if (expectedJson !== actualJson) {
  console.error(actualJson);
}

console.log(
  `\n=== Hierarchy Parity Tests Summary: ${passed} passed, ${failed} failed ===`,
);
if (failed > 0) process.exit(1);
