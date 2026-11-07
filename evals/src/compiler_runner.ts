/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  analyzeThreeSymbols,
  GENUINE_TL103_LOADER_CONTROL_SYMBOLS,
  stripJsComments,
} from './symbols.ts';
import type {
  CliOptions,
  CompilerValidateReport,
  MisclassifiedTl103Entry,
  PromptEntry,
  ScriptEvalResult,
  SimEvaluation,
  SimRawReport,
} from './types.ts';
import {
  analyzeAndCompressQuadPng,
  evaluateVisualQuality,
  runCompilerRender,
} from './visual_judge.ts';

function resolveRootDir(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), 'experimental/users/binghamj/three_live'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'evals', 'prompts', 'prompts_100.json'))) {
      return c;
    }
  }
  return process.cwd();
}

export const ROOT_DIR = resolveRootDir();
export const EVALS_DIR = path.join(ROOT_DIR, 'evals');
export const DEFAULT_PROMPTS_PATH = path.join(EVALS_DIR, 'prompts', 'prompts_100.json');
export const SCRIPTS_DIR = path.join(EVALS_DIR, 'scripts');
export const RESULTS_DIR = path.join(EVALS_DIR, 'results');

/**
 * Locates the local `three-live-cli` binary across Cargo build outputs and platform caches.
 */
export function findCompilerBinary(rootDir = ROOT_DIR): string | null {
  const isWin = os.platform() === 'win32';
  const binName = isWin ? 'three-live-cli.exe' : 'three-live-cli';
  const candidates = [
    process.env.THREE_LIVE_CLI_BIN ?? '',
    path.join(rootDir, 'compiler', 'target', 'release', binName),
    path.join(rootDir, 'compiler', 'target', 'debug', binName),
    path.join(rootDir, 'target', 'release', binName),
    path.join(rootDir, 'target', 'debug', binName),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

/**
 * Runs `three-live-cli validate --json <scriptPath>` and parses the structured report.
 */
export function runCompilerValidate(
  binPath: string,
  scriptPath: string,
): Promise<CompilerValidateReport> {
  return new Promise((resolve) => {
    execFile(
      binPath,
      ['validate', '--json', scriptPath],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
      (err, rawStdout, rawStderr) => {
        const stdout = (rawStdout || '').trim();
        const stderr = (rawStderr || '').trim();
        let report: CompilerValidateReport | null = null;
        if (stdout) {
          try {
            report = JSON.parse(stdout) as CompilerValidateReport;
          } catch {
            const firstBrace = stdout.indexOf('{');
            const lastBrace = stdout.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              try {
                report = JSON.parse(
                  stdout.slice(firstBrace, lastBrace + 1),
                ) as CompilerValidateReport;
              } catch {
                // Ignore parse error
              }
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
                message:
                  stderr || stdout || (err ? err.message : 'Compiler exited without output'),
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
export const SIM_CATEGORIES = new Set<string>(['instancing_animation_ik', 'spatial_xr_sim']);

/**
 * Default scripted user/agent action sequence for `three-live-cli sim`.
 */
export const DEFAULT_SIM_ACTIONS = JSON.stringify([
  {at: 0.2, type: 'select'},
  {at: 0.4, type: 'explode', factor: 1.0},
  {at: 0.2, type: 'moveCharacter', dx: -0.4, dz: -1.0, duration: 1.5, jump: true},
]);

/**
 * Runs `three-live-cli sim <scriptPath> --duration 2.0 --actions ... --json`
 * and computes temporal & interactive simulation metrics.
 */
export function runCompilerSim(
  binPath: string,
  scriptPath: string,
  durationSec = 2.0,
): Promise<SimEvaluation> {
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
        let simReport: SimRawReport | null = null;
        if (stdout) {
          try {
            simReport = JSON.parse(stdout) as SimRawReport;
          } catch {
            const firstBrace = stdout.indexOf('{');
            const lastBrace = stdout.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace > firstBrace) {
              try {
                simReport = JSON.parse(stdout.slice(firstBrace, lastBrace + 1)) as SimRawReport;
              } catch {
                // Ignore parse error
              }
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
          const t0 = b.initialTranslation ?? [0, 0, 0];
          const t1 = b.finalTranslation ?? [0, 0, 0];
          const r0 = b.initialRotation ?? [0, 0, 0, 1];
          const r1 = b.finalRotation ?? [0, 0, 0, 1];
          const s0 = b.initialScale ?? [1, 1, 1];
          const s1 = b.finalScale ?? [1, 1, 1];
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
          scenarioState: simReport.scenarioState ?? 'running',
          simActive,
        });
      },
    );
  });
}

/**
 * Evaluates a single script file and combines static symbol analysis with
 * runtime compiler diagnostics, spatial framing metrics, 60Hz temporal/interactive simulation,
 * and optional 4-up quad contact sheet visual evaluation.
 */
export async function evaluateSingleScript(
  binPath: string,
  scriptPath: string,
  promptEntry: PromptEntry | null,
  evalOpts: Partial<CliOptions> = {},
): Promise<ScriptEvalResult> {
  const code = fs.readFileSync(scriptPath, 'utf8');
  const symbolAnalysis = analyzeThreeSymbols(code);
  const report = await runCompilerValidate(binPath, scriptPath);
  const diagnostics = report.diagnostics ?? [];

  const noopDrops: string[] = [];
  const degradedWarnings: string[] = [];
  const misclassifiedTl103: MisclassifiedTl103Entry[] = [];
  let boxGeometryFallbackCount = 0;

  for (const d of diagnostics) {
    const msg = d.message || '';
    if (msg.includes('unsupported geometry is unsupported; degraded to BoxGeometry')) {
      boxGeometryFallbackCount++;
    }
    const threeMatch = msg.match(
      /THREE\.([A-Za-z0-9_]+)\s+is\s+unsupported;\s+degraded\s+to\s+no-op\s+proxy/,
    );
    if (threeMatch) {
      const sym = threeMatch[1];
      noopDrops.push(sym);
      if (d.code === 'TL103' && !GENUINE_TL103_LOADER_CONTROL_SYMBOLS.has(sym)) {
        misclassifiedTl103.push({
          symbol: sym,
          code: d.code,
          message: msg,
          hint: d.hint ?? '',
        });
      }
    } else if (msg.includes('is unsupported; degraded to')) {
      degradedWarnings.push(msg);
    }
  }

  const summary = report.summary ?? null;
  const meshCount = summary ? summary.meshCount : 0;
  const visibleMeshCount = summary?.camera ? summary.camera.visibleMeshCount : 0;
  const compileSucceeded = Boolean(report.valid && meshCount > 0);
  const frustumVisibilityRatio = meshCount > 0 ? visibleMeshCount / meshCount : 0;

  const cleanCode = stripJsComments(code);
  const declaresLexicalScene = /\b(?:const|let)\s+scene\s*=\s*new\s+THREE\.Scene\b/.test(cleanCode);
  const lexicalSceneShadowed = Boolean(
    declaresLexicalScene &&
      meshCount === 0 &&
      diagnostics.some((d) => d.code === 'TL301' && (d.message || '').includes('0 meshes')),
  );

  const expectedFeatures = promptEntry?.expectedFeatures ?? [];
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
  const simEvaluation: SimEvaluation = shouldRunSim
    ? await runCompilerSim(binPath, scriptPath)
    : {ran: false, simActive: null};

  const id = promptEntry ? promptEntry.id : path.basename(scriptPath, '.js');
  const baseResult: ScriptEvalResult = {
    id,
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
    worldBounds: summary?.worldBounds ?? null,
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
    visualEvaluation: {ran: false, visualPass: null},
    diagnosticCodes: diagCodes,
    errorCodes,
    warningCodes,
    diagnostics,
  };

  if (compileSucceeded && (evalOpts.render || evalOpts.judge)) {
    const armName = evalOpts.currentArm || evalOpts.arm || 'smoke';
    const outPngPath = path.join(RESULTS_DIR, 'renders', armName, `${id}.png`);
    if (evalOpts.overwrite || !fs.existsSync(outPngPath)) {
      await runCompilerRender(
        binPath,
        scriptPath,
        outPngPath,
        evalOpts.renderWidth ?? 640,
        evalOpts.renderHeight ?? 640,
      );
    }
    if (evalOpts.judge) {
      baseResult.visualEvaluation = await evaluateVisualQuality(
        outPngPath,
        promptEntry,
        baseResult,
        evalOpts,
        ROOT_DIR,
      );
    } else {
      analyzeAndCompressQuadPng(outPngPath);
    }
  } else if (!compileSucceeded && evalOpts.judge) {
    baseResult.visualEvaluation = {
      ran: true,
      visualPass: false,
      semanticMatch: 1,
      spatialCoherence: 1,
      cameraFraming: 1,
      materialAndLighting: 1,
      overallScore: 1.0,
      visualCritique: 'Script failed compilation and produced no rendered 4-up contact sheet.',
    };
  }

  return baseResult;
}
