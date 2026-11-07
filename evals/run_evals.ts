#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Standalone Three.js Codegen & Compiler Evaluation Suite for `three-live`.
 *
 * Modular TypeScript entrypoint (`evals/src/*.ts`).
 */

import * as path from 'path';
import {main, parseCliArgs, printHelp, runPool} from './src/cli.ts';
import {
  evaluateSingleScript,
  findCompilerBinary,
  runCompilerSim,
  runCompilerValidate,
} from './src/compiler_runner.ts';
import {callLlm, extractJsCode, resolveLlmConfig} from './src/llm_client.ts';
import {
  buildCodegenPrompts,
  buildRepairPrompts,
  GUIDED_SYSTEM_PROMPT,
  VANILLA_SYSTEM_PROMPT,
} from './src/prompts.ts';
import {
  aggregateResults,
  formatMarkdownReport,
  generateComparisonReport,
} from './src/reporting.ts';
import {ensureSmokeScriptsExist} from './src/smoke_seed.ts';
import {analyzeThreeSymbols, stripJsComments} from './src/symbols.ts';
import {
  analyzeAndCompressQuadPng,
  evaluateVisualQuality,
  runCompilerRender,
} from './src/visual_judge.ts';

export {
  aggregateResults,
  analyzeAndCompressQuadPng,
  analyzeThreeSymbols,
  buildCodegenPrompts,
  buildRepairPrompts,
  callLlm,
  ensureSmokeScriptsExist,
  evaluateSingleScript,
  evaluateVisualQuality,
  extractJsCode,
  findCompilerBinary,
  formatMarkdownReport,
  generateComparisonReport,
  GUIDED_SYSTEM_PROMPT,
  main,
  parseCliArgs,
  printHelp,
  resolveLlmConfig,
  runCompilerRender,
  runCompilerSim,
  runCompilerValidate,
  runPool,
  stripJsComments,
  VANILLA_SYSTEM_PROMPT,
};

const invokedFile = path.basename(process.argv[1] || '');
if (invokedFile === 'run_evals.ts' || invokedFile === 'run_evals.js') {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[evals] Fatal error: ${msg}`);
    process.exit(1);
  });
}
