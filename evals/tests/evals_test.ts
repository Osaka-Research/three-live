/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as zlib from 'zlib';
import {
  aggregateResults,
  analyzeAndCompressQuadPng,
  analyzeThreeSymbols,
  buildCodegenPrompts,
  buildRepairPrompts,
  extractJsCode,
  formatMarkdownReport,
  makePngChunk,
  parseCliArgs,
} from '../src/index.ts';
import type {PromptEntry, ScriptEvalResult} from '../src/types.ts';

function assert(cond: boolean, message: string): void {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
  console.log(`   ✅ [PASS] ${message}`);
}

function runEvalsHarnessTests(): void {
  console.log('=== Running Evals TypeScript Suite Unit Tests ===');

  // 1. CLI Argument Parsing
  const opts = parseCliArgs([
    '--arm=guided',
    '--render',
    '--judge',
    '--repair',
    '--ids=cad_01,org_06',
    '--limit=5',
    '--compare=vanilla,guided',
  ]);
  assert(
    opts.arm === 'guided' &&
      opts.armExplicit === true &&
      opts.render === true &&
      opts.judge === true &&
      opts.repair === true &&
      opts.ids !== null &&
      opts.ids.has('cad_01') &&
      opts.ids.has('org_06') &&
      opts.limit === 5 &&
      opts.compare?.join(',') === 'vanilla,guided',
    'parseCliArgs parses --arm, --render, --judge, --repair, --ids, --limit, and --compare',
  );

  // 2. Markdown Code Fence Extraction
  const rawMd = [
    'Here is your Three.js code:',
    '```javascript',
    'const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));',
    'scene.add(box);',
    '```',
  ].join('\n');
  const extracted = extractJsCode(rawMd);
  assert(
    extracted.includes('new THREE.BoxGeometry(1, 1, 1)') && !extracted.includes('```'),
    'extractJsCode strips markdown fences and extracts JavaScript body',
  );

  // 3. Symbol Taxonomy Analysis (ignoring commented-out code)
  const symInfo = analyzeThreeSymbols(`
    // new THREE.GLTFLoader() in a comment should be ignored
    const m = new THREE.Mesh(
      new THREE.LatheGeometry([], 16),
      new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide })
    );
    const h = new THREE.HemisphereLight(0xffffff, 0x222222, 0.6);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffaa00 }));
    const r = new THREE.RectAreaLight(0xffffff, 1.0);
  `);
  assert(
    symInfo.supported.includes('LatheGeometry') &&
      symInfo.supported.includes('DoubleSide') &&
      symInfo.supported.includes('HemisphereLight') &&
      symInfo.supported.includes('Sprite') &&
      symInfo.supported.includes('SpriteMaterial') &&
      symInfo.degradedAliases.length === 1 &&
      symInfo.degradedAliases[0].symbol === 'RectAreaLight' &&
      symInfo.unsupportedClasses.length === 0,
    'analyzeThreeSymbols classifies native symbols, degraded aliases, and ignores comments',
  );

  // 4. Prompt Builders (Codegen + 1-Turn Repair with Sim & Visual Judge feedback)
  const samplePrompt: PromptEntry = {
    id: 'cad_06',
    category: 'hard_surface_cad',
    title: 'Jet Engine Exhaust Nozzle',
    prompt: 'Create a jet engine variable exhaust nozzle with 12 overlapping petals.',
    expectedFeatures: ['CylinderGeometry', 'MeshStandardMaterial'],
  };
  const codegenPrompts = buildCodegenPrompts(samplePrompt, 'guided');
  assert(
    codegenPrompts.systemPrompt.includes('CRITICAL `three-live` COMPILER RULES') &&
      codegenPrompts.userPrompt.includes('cad_06'),
    'buildCodegenPrompts selects GUIDED_SYSTEM_PROMPT for arm=guided',
  );

  const repairPrompts = buildRepairPrompts(
    samplePrompt,
    'const m = new THREE.Mesh();',
    {
      valid: true,
      summary: {meshCount: 4, lightCount: 2, camera: {visibleMeshCount: 3}},
      simEvaluation: {ran: true, durationSec: 2.0, simActive: false},
      visualEvaluation: {
        ran: true,
        visualPass: false,
        semanticMatch: 4,
        spatialCoherence: 4,
        cameraFraming: 2,
        materialAndLighting: 4,
        overallScore: 3.5,
        visualCritique: 'Pull camera back.',
      },
      diagnostics: [
        {
          code: 'TL303',
          severity: 'warning',
          message: '1 of 4 meshes outside camera frustum',
          hint: 'Pull camera back',
        },
      ],
    },
    'guided',
  );
  assert(
    repairPrompts.userPrompt.includes('[TL303]') &&
      repairPrompts.userPrompt.includes('[SIM] TEMPORAL/INTERACTIVE INACTIVE') &&
      repairPrompts.userPrompt.includes('[VISUAL JUDGE] 4-Up Contact Sheet Score 3.5/5.0'),
    'buildRepairPrompts embeds compiler diagnostics, sim inactivity hint, and visual judge critique',
  );

  // 5. 4-Up PNG Compression & Raster Analysis
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-live-evals-test-'));
  const tmpPng = path.join(tmpDir, 'quad_test.png');
  const w = 128;
  const h = 128;
  const stride = 1 + w * 4;
  const rawScanlines = Buffer.alloc(h * stride, 0);
  for (let y = 0; y < h; y++) {
    rawScanlines[y * stride] = 0; // filter = 0
    for (let x = 0; x < w; x++) {
      const idx = y * stride + 1 + x * 4;
      // Draw bright orangelit block in center of each of the 4 quadrants
      const qx = x % (w >> 1);
      const qy = y % (h >> 1);
      if (qx >= 18 && qx <= 46 && qy >= 32 && qy <= 52) {
        rawScanlines[idx] = 220;
        rawScanlines[idx + 1] = 140;
        rawScanlines[idx + 2] = 60;
        rawScanlines[idx + 3] = 255;
      } else {
        rawScanlines[idx] = 18;
        rawScanlines[idx + 1] = 26;
        rawScanlines[idx + 2] = 44;
        rawScanlines[idx + 3] = 255;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const uncompressedIdat = zlib.deflateSync(rawScanlines, {level: 0});
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  fs.writeFileSync(
    tmpPng,
    Buffer.concat([
      pngSig,
      makePngChunk('IHDR', ihdr),
      makePngChunk('IDAT', uncompressedIdat),
      makePngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
  const sizeBefore = fs.statSync(tmpPng).size;
  const rasterStats = analyzeAndCompressQuadPng(tmpPng);
  const sizeAfter = fs.statSync(tmpPng).size;
  fs.rmSync(tmpDir, {recursive: true, force: true});

  assert(
    rasterStats !== null &&
      rasterStats.width === w &&
      rasterStats.height === h &&
      rasterStats.camera.occupancy > 0.05 &&
      rasterStats.iso.occupancy > 0.05 &&
      sizeAfter < sizeBefore,
    `analyzeAndCompressQuadPng extracts 4-quadrant occupancy and shrinks store-block PNG (${sizeBefore} B -> ${sizeAfter} B)`,
  );

  // 6. Summary Aggregation & Markdown Report Formatting
  const mockItem: ScriptEvalResult = {
    id: 'cad_06',
    category: 'hard_surface_cad',
    title: 'Jet Engine Exhaust Nozzle',
    scriptPath: 'evals/scripts/guided/cad_06.js',
    valid: true,
    compileSucceeded: true,
    cleanCompileNoDrops: true,
    executionTimeMs: 42.5,
    meshCount: 26,
    visibleMeshCount: 26,
    frustumVisibilityRatio: 1.0,
    vertexCount: 2048,
    indexCount: 6144,
    materialCount: 4,
    lightCount: 3,
    hasInteractivity: false,
    worldBounds: {min: [-0.8, 0, -0.8], max: [0.8, 1.2, 0.8]},
    expectedFeatures: ['CylinderGeometry'],
    matchedExpectedFeatures: ['CylinderGeometry'],
    symbolAnalysis: symInfo,
    runtimeDrops: {
      noopDrops: [],
      boxGeometryFallbackCount: 0,
      degradedWarnings: [],
      misclassifiedTl103: [],
      lexicalSceneShadowed: false,
    },
    simEvaluation: {ran: false, simActive: null},
    visualEvaluation: {
      ran: true,
      visualPass: true,
      semanticMatch: 5,
      spatialCoherence: 5,
      cameraFraming: 5,
      materialAndLighting: 5,
      overallScore: 5.0,
    },
    diagnosticCodes: [],
    errorCodes: [],
    warningCodes: [],
    diagnostics: [],
  };

  const summary = aggregateResults('guided', [mockItem]);
  const md = formatMarkdownReport(summary);
  assert(
    summary.compileSuccessRate === 1 &&
      summary.visualSummary.visualPassRate === 1 &&
      summary.visualSummary.meanOverallScore === 5.0 &&
      md.includes('4-Up Contact Sheet Visual Judge Pass Rate'),
    'aggregateResults and formatMarkdownReport compute strongly-typed visual and compiler metrics',
  );

  console.log('=== All Evals TypeScript Suite Unit Tests Passed ===\n');
}

runEvalsHarnessTests();
