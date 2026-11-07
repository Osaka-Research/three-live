/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_PROMPTS_PATH,
  evaluateSingleScript,
  findCompilerBinary,
  RESULTS_DIR,
  ROOT_DIR,
  SCRIPTS_DIR,
} from './compiler_runner.ts';
import {callLlm, resolveLlmConfig} from './llm_client.ts';
import {buildCodegenPrompts, buildRepairPrompts} from './prompts.ts';
import {
  aggregateResults,
  formatMarkdownReport,
  generateComparisonReport,
} from './reporting.ts';
import {ensureSmokeScriptsExist} from './smoke_seed.ts';
import type {
  CliOptions,
  LlmConfig,
  PromptEntry,
  RepairComparison,
  ScriptEvalResult,
} from './types.ts';

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    arm: 'smoke',
    armExplicit: false,
    generate: false,
    evaluate: true,
    sim: true,
    simAll: false,
    repair: false,
    render: false,
    judge: false,
    vlmJudge: false,
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
      if (!opts.armExplicit) {
        opts.arm = 'vanilla';
      }
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
    } else if (arg === '--judge') {
      opts.render = true;
      opts.judge = true;
    } else if (arg === '--vlm-judge') {
      opts.render = true;
      opts.judge = true;
      opts.vlmJudge = true;
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

export function printHelp(): void {
  console.log(`
three-live Three.js Codegen & Compiler Evaluation Suite

Usage:
  node evals/run_evals.ts [options]

Examples:
  # 1. Run built-in smoke suite immediately (0 API keys required):
  node evals/run_evals.ts --arm=smoke

  # 2. Generate 100 vanilla Three.js scripts with Gemini and evaluate:
  GEMINI_API_KEY=... node evals/run_evals.ts --generate --arm=vanilla --provider=gemini

  # 3. Generate 100 guided three-live scripts and run 1-turn compiler self-repair:
  GEMINI_API_KEY=... node evals/run_evals.ts --generate --repair --arm=guided --provider=gemini

  # 4. Render 4-up quad contact sheets and run 1-5 rubric visual judge + side-by-side comparison:
  node evals/run_evals.ts --arm=guided --render --judge --repair --compare=vanilla,guided

  # 5. Pipe prompts through ANY custom CLI command (stdin -> stdout):
  node evals/run_evals.ts --generate --arm=vanilla --cmd="gemini -p"

Options:
  --arm=<name>          Prompt/script arm directory under evals/scripts/<arm> (default: smoke, or vanilla with --generate)
  --generate            Generate Three.js scripts from evals/prompts/prompts_100.json using an LLM
  --evaluate            Compile and evaluate scripts in evals/scripts/<arm> (default: true)
  --repair              Run 1-turn closed-loop self-repair using three-live compiler diagnostics
  --render              Render 4-up quad contact sheets (evals/results/renders/<arm>/<id>.png)
  --judge               Score 4-up quad contact sheets on 4 axes (1-5 rubric: semantic, spatial, framing, material/lighting)
  --vlm-judge           Also invoke external multimodal VLM API (Gemini/OpenAI) on each 4-up quad PNG
  --compare[=a,b]       Generate side-by-side multi-arm ablation report (default: vanilla,guided)
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
 * Simple concurrency pool for parallel LLM or compiler calls.
 */
export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  workerFn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await workerFn(items[idx], idx);
    }
  }
  const workers: Array<Promise<void>> = [];
  for (let w = 0; w < Math.min(concurrency, items.length); w++) {
    workers.push(next());
  }
  await Promise.all(workers);
  return results;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const opts = parseCliArgs(argv);
  if (opts.help) {
    printHelp();
    return;
  }

  const binPath = findCompilerBinary();
  if (!binPath) {
    console.error(
      '[evals] Could not find local `three-live-cli` binary.\n' +
        'Build it first with: cargo build --release --manifest-path compiler/Cargo.toml --bin three-live-cli',
    );
    process.exit(1);
  }

  const allPrompts = JSON.parse(fs.readFileSync(opts.promptsPath, 'utf8')) as PromptEntry[];
  const promptById = new Map<string, PromptEntry>(allPrompts.map((p) => [p.id, p]));

  let selectedPrompts = allPrompts.filter((p) => {
    if (opts.category && p.category !== opts.category) {
      return false;
    }
    if (opts.ids && !opts.ids.has(p.id)) {
      return false;
    }
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

  if (opts.generate) {
    const llmConfig = resolveLlmConfig(opts);
    console.log(
      `[evals] Generating ${selectedPrompts.length} scripts for arm="${opts.arm}" using provider="${llmConfig.provider}" (${llmConfig.model})...`,
    );
    await runPool(selectedPrompts, opts.concurrency, async (promptEntry, idx) => {
      const outPath = path.join(armDir, `${promptEntry.id}.js`);
      if (!opts.overwrite && fs.existsSync(outPath) && fs.statSync(outPath).size > 10) {
        console.log(`  [${idx + 1}/${selectedPrompts.length}] ${promptEntry.id} (cached)`);
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
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [${idx + 1}/${selectedPrompts.length}] ${promptEntry.id} FAILED: ${msg}`);
      }
    });
  }

  const existingFiles = fs
    .readdirSync(armDir)
    .filter((f) => f.endsWith('.js'))
    .sort();

  const scriptsToEval: Array<{id: string; scriptPath: string; promptEntry: PromptEntry | null}> =
    [];
  for (const file of existingFiles) {
    const id = path.basename(file, '.js');
    if (opts.ids && !opts.ids.has(id)) {
      continue;
    }
    const promptEntry = promptById.get(id) ?? null;
    if (opts.category && promptEntry && promptEntry.category !== opts.category) {
      continue;
    }
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
        'Run with --arm=smoke for the built-in smoke suite, or pass --generate with an LLM provider.',
    );
    process.exit(1);
  }

  console.log(
    `[evals] Evaluating ${scriptsToEval.length} scripts in ${path.relative(ROOT_DIR, armDir)} with three-live-cli${opts.render ? ' (+ 4-up quad render)' : ''}${opts.judge ? ' (+ visual judge)' : ''}...`,
  );
  const itemResults = await runPool(
    scriptsToEval,
    Math.max(opts.concurrency, 8),
    ({scriptPath, promptEntry}) =>
      evaluateSingleScript(binPath, scriptPath, promptEntry, {...opts, currentArm: opts.arm}),
  );

  let repairComparison: RepairComparison | null = null;
  if (opts.repair) {
    let llmConfig: LlmConfig | null = null;
    const repairedArm = `${opts.arm}_repaired`;
    const repairedDir = path.join(SCRIPTS_DIR, repairedArm);
    fs.mkdirSync(repairedDir, {recursive: true});

    const isActionableForRepair = (r: ScriptEvalResult) =>
      !r.cleanCompileNoDrops ||
      (r.simEvaluation?.ran && !r.simEvaluation.simActive) ||
      (r.visualEvaluation?.ran && !r.visualEvaluation.visualPass) ||
      r.diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning');
    const needsRepair = itemResults.filter(isActionableForRepair);
    console.log(
      `[evals] Running 1-turn closed-loop repair on ${needsRepair.length}/${itemResults.length} scripts with drops, inactive sim, visual critique, or compiler warnings...`,
    );

    await runPool(itemResults, opts.concurrency, async (item, idx) => {
      const srcPath = path.join(ROOT_DIR, item.scriptPath);
      const dstPath = path.join(repairedDir, `${item.id}.js`);
      const promptEntry: PromptEntry = promptById.get(item.id) ?? {
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
          visualEvaluation: item.visualEvaluation,
          diagnostics: item.diagnostics,
        },
        opts.arm,
      );
      try {
        const fixedCode = await callLlm(repairPrompts, llmConfig);
        fs.writeFileSync(dstPath, fixedCode, 'utf8');
        console.log(`  [repair ${idx + 1}/${itemResults.length}] ${item.id} -> repaired`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  [repair ${idx + 1}/${itemResults.length}] ${item.id} FAILED: ${msg}`);
        fs.copyFileSync(srcPath, dstPath);
      }
    });

    const repairedResults = await runPool(
      scriptsToEval,
      Math.max(opts.concurrency, 8),
      ({id, promptEntry}) =>
        evaluateSingleScript(binPath, path.join(repairedDir, `${id}.js`), promptEntry, {
          ...opts,
          currentArm: repairedArm,
        }),
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

    const countWarnFree = (list: ScriptEvalResult[]) =>
      list.filter(
        (r) =>
          r.cleanCompileNoDrops &&
          !r.diagnostics.some((d) => d.severity === 'error' || d.severity === 'warning'),
      ).length;
    const countWarns = (list: ScriptEvalResult[]) =>
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
      visualEvaluatedCount: itemResults.filter((r) => r.visualEvaluation?.ran).length,
      beforeVisualPassCount: itemResults.filter((r) => r.visualEvaluation?.visualPass).length,
      afterVisualPassCount: repairedResults.filter((r) => r.visualEvaluation?.visualPass).length,
      beforeMeanVisualScore:
        itemResults.length > 0
          ? Number(
              (
                itemResults.reduce((acc, r) => acc + (r.visualEvaluation?.overallScore ?? 0), 0) /
                Math.max(1, itemResults.filter((r) => r.visualEvaluation?.ran).length)
              ).toFixed(2),
            )
          : 0,
      afterMeanVisualScore:
        repairedResults.length > 0
          ? Number(
              (
                repairedResults.reduce(
                  (acc, r) => acc + (r.visualEvaluation?.overallScore ?? 0),
                  0,
                ) / Math.max(1, repairedResults.filter((r) => r.visualEvaluation?.ran).length)
              ).toFixed(2),
            )
          : 0,
      warningsBefore: countWarns(itemResults),
      warningsAfter: countWarns(repairedResults),
      diagnosticsBefore: itemResults.reduce((acc, r) => acc + r.diagnostics.length, 0),
      diagnosticsAfter: repairedResults.reduce((acc, r) => acc + r.diagnostics.length, 0),
    };
  }

  const summary = aggregateResults(opts.arm, itemResults, repairComparison);
  const summaryJsonPath = path.join(RESULTS_DIR, `summary_${opts.arm}.json`);
  const reportMdPath = path.join(RESULTS_DIR, `report_${opts.arm}.md`);
  fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  fs.writeFileSync(reportMdPath, formatMarkdownReport(summary), 'utf8');

  console.log('\n====================================================================');
  console.log(` three-live Eval Summary (Arm: ${opts.arm})`);
  console.log('====================================================================');
  console.log(`  Scripts Evaluated:             ${summary.totalScripts}`);
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
  if (summary.visualSummary && summary.visualSummary.visualEvaluatedCount > 0) {
    const vs = summary.visualSummary;
    console.log(
      `  4-Up Visual Judge Pass:        ${vs.visualPassCount}/${vs.visualEvaluatedCount} (${(vs.visualPassRate * 100).toFixed(1)}%) [avg ${vs.meanOverallScore.toFixed(2)}/5.0 | S:${vs.meanSemanticMatch.toFixed(2)} P:${vs.meanSpatialCoherence.toFixed(2)} F:${vs.meanCameraFraming.toFixed(2)} M:${vs.meanMaterialAndLighting.toFixed(2)}]`,
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
  console.log(`  Mean Compiler Latency:         ${summary.avgExecutionTimeMs.toFixed(1)} ms`);
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
    if (repairComparison.visualEvaluatedCount > 0) {
      console.log(
        `  1-Turn Repair Visual Pass:     ${repairComparison.beforeVisualPassCount}/${repairComparison.visualEvaluatedCount} -> ${repairComparison.afterVisualPassCount}/${repairComparison.visualEvaluatedCount}`,
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
