/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import {RESULTS_DIR} from './compiler_runner.ts';
import {
  DEGRADED_ALIAS_SYMBOLS,
  GENUINE_TL103_LOADER_CONTROL_SYMBOLS,
  UNSUPPORTED_CONSTANTS,
} from './symbols.ts';
import type {
  CategoryStats,
  EvalSummary,
  RepairComparison,
  ScriptEvalResult,
} from './types.ts';

export function aggregateResults(
  arm: string,
  itemResults: ScriptEvalResult[],
  repairComparison: RepairComparison | null = null,
): EvalSummary {
  const total = itemResults.length;
  const compileSuccessCount = itemResults.filter((r) => r.compileSucceeded).length;
  const cleanNoDropsCount = itemResults.filter((r) => r.cleanCompileNoDrops).length;
  const withNoopDropsCount = itemResults.filter(
    (r) => r.runtimeDrops.noopDrops.length > 0,
  ).length;
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

  const diagnosticHistogram: Record<string, number> = {};
  const droppedSymbolHistogram: Record<string, number> = {};
  const degradedAliasHistogram: Record<string, number> = {};
  const unsupportedConstantHistogram: Record<string, number> = {};
  const byCategory: Record<string, CategoryStats> = {};

  let simEvaluatedCount = 0;
  let simActiveCount = 0;
  let simMovedBodiesTotal = 0;
  let simTriggeredEventsTotal = 0;
  let simCompletedObjectivesTotal = 0;
  let simAudioCuesTotal = 0;

  let visualEvaluatedCount = 0;
  let visualPassCount = 0;
  let sumSemanticMatch = 0;
  let sumSpatialCoherence = 0;
  let sumCameraFraming = 0;
  let sumMaterialAndLighting = 0;
  let sumOverallScore = 0;
  let sumCameraOccupancy = 0;

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
        visualEvaluated: 0,
        visualPass: 0,
        avgVisualScore: 0,
      };
    }
    const cat = byCategory[r.category];
    cat.total++;
    if (r.compileSucceeded) {
      cat.compileSucceeded++;
    }
    if (r.cleanCompileNoDrops) {
      cat.cleanCompileNoDrops++;
    }
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
      simMovedBodiesTotal += r.simEvaluation.movedBodies ?? 0;
      simTriggeredEventsTotal += (r.simEvaluation.triggeredEvents ?? []).length;
      simCompletedObjectivesTotal += (r.simEvaluation.completedObjectives ?? []).length;
      simAudioCuesTotal += (r.simEvaluation.audioCuesFired ?? []).length;
    }
    if (r.visualEvaluation?.ran) {
      cat.visualEvaluated++;
      visualEvaluatedCount++;
      if (r.visualEvaluation.visualPass) {
        cat.visualPass++;
        visualPassCount++;
      }
      cat.avgVisualScore += r.visualEvaluation.overallScore ?? 0;
      sumSemanticMatch += r.visualEvaluation.semanticMatch ?? 0;
      sumSpatialCoherence += r.visualEvaluation.spatialCoherence ?? 0;
      sumCameraFraming += r.visualEvaluation.cameraFraming ?? 0;
      sumMaterialAndLighting += r.visualEvaluation.materialAndLighting ?? 0;
      sumOverallScore += r.visualEvaluation.overallScore ?? 0;
      sumCameraOccupancy += r.visualEvaluation.raster?.camera?.occupancy ?? 0;
    }

    for (const d of r.diagnostics) {
      diagnosticHistogram[d.code] = (diagnosticHistogram[d.code] ?? 0) + 1;
    }
    for (const sym of r.runtimeDrops.noopDrops) {
      droppedSymbolHistogram[sym] = (droppedSymbolHistogram[sym] ?? 0) + 1;
    }
    for (const d of r.symbolAnalysis.degradedAliases) {
      degradedAliasHistogram[d.symbol] = (degradedAliasHistogram[d.symbol] ?? 0) + 1;
    }
    for (const c of r.symbolAnalysis.unsupportedConstants) {
      unsupportedConstantHistogram[c] = (unsupportedConstantHistogram[c] ?? 0) + 1;
    }
  }

  for (const cat of Object.values(byCategory)) {
    cat.avgFrustumVisibilityRatio =
      cat.total > 0 ? Number((cat.avgFrustumVisibilityRatio / cat.total).toFixed(3)) : 0;
    cat.avgVisualScore =
      cat.visualEvaluated > 0
        ? Number((cat.avgVisualScore / cat.visualEvaluated).toFixed(2))
        : 0;
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
    visualSummary: {
      visualEvaluatedCount,
      visualPassCount,
      visualPassRate:
        visualEvaluatedCount > 0
          ? Number((visualPassCount / visualEvaluatedCount).toFixed(4))
          : 0,
      meanSemanticMatch:
        visualEvaluatedCount > 0
          ? Number((sumSemanticMatch / visualEvaluatedCount).toFixed(2))
          : 0,
      meanSpatialCoherence:
        visualEvaluatedCount > 0
          ? Number((sumSpatialCoherence / visualEvaluatedCount).toFixed(2))
          : 0,
      meanCameraFraming:
        visualEvaluatedCount > 0
          ? Number((sumCameraFraming / visualEvaluatedCount).toFixed(2))
          : 0,
      meanMaterialAndLighting:
        visualEvaluatedCount > 0
          ? Number((sumMaterialAndLighting / visualEvaluatedCount).toFixed(2))
          : 0,
      meanOverallScore:
        visualEvaluatedCount > 0
          ? Number((sumOverallScore / visualEvaluatedCount).toFixed(2))
          : 0,
      meanCameraOccupancy:
        visualEvaluatedCount > 0
          ? Number((sumCameraOccupancy / visualEvaluatedCount).toFixed(4))
          : 0,
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

export function formatMarkdownReport(summary: EvalSummary): string {
  const pct = (n: number, d: number) =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}% (${n}/${d})` : '0.0% (0/0)';
  const sim = summary.simSummary ?? {
    simEvaluatedCount: 0,
    simActiveCount: 0,
    simMovedBodiesTotal: 0,
    simTriggeredEventsTotal: 0,
    simCompletedObjectivesTotal: 0,
    simAudioCuesTotal: 0,
  };
  const vis = summary.visualSummary ?? {
    visualEvaluatedCount: 0,
    visualPassCount: 0,
    meanSemanticMatch: 0,
    meanSpatialCoherence: 0,
    meanCameraFraming: 0,
    meanMaterialAndLighting: 0,
    meanOverallScore: 0,
    meanCameraOccupancy: 0,
  };
  const lines: string[] = [
    `# \`three-live\` Three.js Codegen & Compiler Eval Report — Arm: \`${summary.arm}\``,
    '',
    `- **Generated:** ${summary.timestamp}`,
    `- **Scripts Evaluated:** ${summary.totalScripts}`,
    `- **Compile Success Rate (\`valid && meshCount > 0\`):** **${pct(summary.compileSuccessCount, summary.totalScripts)}**`,
    `- **Clean Compile Rate (0 silent drops / 0 fallbacks / 0 errors):** **${pct(summary.cleanNoDropsCount, summary.totalScripts)}**`,
    `- **Temporal & Interactive Simulation Pass Rate (\`three-live-cli sim\`):** **${pct(sim.simActiveCount, sim.simEvaluatedCount)}** (${sim.simMovedBodiesTotal} moving bodies, ${sim.simTriggeredEventsTotal} events, ${sim.simCompletedObjectivesTotal} objectives, ${sim.simAudioCuesTotal} audio cues)`,
    ...(vis.visualEvaluatedCount > 0
      ? [
          `- **4-Up Contact Sheet Visual Judge Pass Rate (\`--judge\`):** **${pct(vis.visualPassCount, vis.visualEvaluatedCount)}** (Mean Score: **${vis.meanOverallScore.toFixed(2)} / 5.00** — Semantic: ${vis.meanSemanticMatch.toFixed(2)}, Spatial: ${vis.meanSpatialCoherence.toFixed(2)}, Framing: ${vis.meanCameraFraming.toFixed(2)}, Material/Lighting: ${vis.meanMaterialAndLighting.toFixed(2)})`,
        ]
      : []),
    `- **Scripts with Silent \`noopProxy\` Drops:** ${pct(summary.withNoopDropsCount, summary.totalScripts)}`,
    `- **Scripts with \`BoxGeometry(0.5)\` Silent Geometry Fallback:** ${pct(summary.withBoxFallbackCount, summary.totalScripts)}`,
    `- **Scripts with Degraded Primitive Aliases (\`RingGeometry\`, \`CapsuleGeometry\`, \`SpotLight\`, etc.):** ${pct(summary.withDegradedAliasesCount, summary.totalScripts)}`,
    `- **Scripts with Misclassified \`TL103\` Warnings (non-loader symbols reported as external loaders):** ${pct(summary.withMisclassifiedTl103Count, summary.totalScripts)}`,
    `- **Mean Camera Frustum Visibility Ratio:** ${(summary.avgFrustumVisibilityRatio * 100).toFixed(1)}%`,
    `- **Mean Compiler Execution Time:** ${summary.avgExecutionTimeMs.toFixed(1)} ms`,
    '',
    '## Breakdown by Category',
    '',
    '| Category | Scripts | Compile Success | Clean (No Drops) | Had Drops/Aliases | Sim Active (`three-live-cli sim`) | Visual Judge (`--judge`) | Mean Frustum Visibility |',
    '| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |',
  ];

  for (const [cat, stats] of Object.entries(summary.byCategory)) {
    const simCell = stats.simEvaluated > 0 ? pct(stats.simActive, stats.simEvaluated) : '—';
    const visCell =
      stats.visualEvaluated > 0
        ? `${pct(stats.visualPass, stats.visualEvaluated)} (${stats.avgVisualScore.toFixed(2)}/5)`
        : '—';
    lines.push(
      `| \`${cat}\` | ${stats.total} | ${pct(stats.compileSucceeded, stats.total)} | ${pct(stats.cleanCompileNoDrops, stats.total)} | ${pct(stats.withDrops, stats.total)} | ${simCell} | ${visCell} | ${(stats.avgFrustumVisibilityRatio * 100).toFixed(1)}% |`,
    );
  }

  if (summary.repairComparison) {
    const rc = summary.repairComparison;
    lines.push(
      '',
      '## 1-Turn Closed-Loop Self-Repair (Warning Actionability)',
      '',
      `- **Scripts Needing Repair (Drops/Aliases, Inactive Sim, Visual Judge, or Compiler Warnings):** ${rc.repairedTotal}`,
      `- **Clean (0 Drops/Aliases) Before -> After Repair:** ${pct(rc.beforeCleanCount, summary.totalScripts)} -> **${pct(rc.afterCleanCount, summary.totalScripts)}**`,
      `- **Warning-Free Scripts (0 Error/Warning Diagnostics) Before -> After Repair:** ${pct(rc.beforeWarningFreeCount, summary.totalScripts)} -> **${pct(rc.afterWarningFreeCount, summary.totalScripts)}**`,
      `- **Temporal & Interactive Sim Active Before -> After Repair:** ${pct(rc.beforeSimActiveCount, rc.simEvaluatedCount)} -> **${pct(rc.afterSimActiveCount, rc.simEvaluatedCount)}**`,
      ...(rc.visualEvaluatedCount > 0
        ? [
            `- **Visual Judge Pass Rate Before -> After Repair:** ${pct(rc.beforeVisualPassCount, rc.visualEvaluatedCount)} (${rc.beforeMeanVisualScore.toFixed(2)}/5) -> **${pct(rc.afterVisualPassCount, rc.visualEvaluatedCount)} (${rc.afterMeanVisualScore.toFixed(2)}/5)**`,
          ]
        : []),
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
  const aliasEntries = Object.entries(summary.degradedAliasHistogram).sort(
    (a, b) => b[1] - a[1],
  );
  if (aliasEntries.length === 0) {
    lines.push('_No degraded alias symbols used._');
  } else {
    lines.push('| Symbol | Occurrences | Runtime Degradation Behavior |', '| :--- | :---: | :--- |');
    for (const [sym, count] of aliasEntries) {
      lines.push(`| \`THREE.${sym}\` | ${count} | ${DEGRADED_ALIAS_SYMBOLS.get(sym) ?? ''} |`);
    }
  }

  lines.push('', '## Per-Script Results', '');
  lines.push(
    '| ID | Category | Valid | Meshes (Vis) | Verts | Sim (`moved / ev / obj / aud`) | Visual (`S/P/F/M -> Avg`) | Drops (`noopProxy`) | Box0.5 Fallbacks | Degraded Aliases | Diagnostics |',
    '| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- | :---: | :--- | :--- |',
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
      ? `${se.simActive ? 'PASS' : 'INACTIVE'} (${se.movedBodies ?? 0} / ${(se.triggeredEvents ?? []).length} / ${(se.completedObjectives ?? []).length} / ${(se.audioCuesFired ?? []).length})`
      : '—';
    const ve = item.visualEvaluation;
    const visStr = ve?.ran
      ? `${ve.visualPass ? 'PASS' : 'FAIL'} (${ve.semanticMatch}/${ve.spatialCoherence}/${ve.cameraFraming}/${ve.materialAndLighting} -> ${(ve.overallScore ?? 0).toFixed(1)})`
      : '—';
    lines.push(
      `| \`${item.id}\` | \`${item.category}\` | ${item.compileSucceeded ? 'PASS' : 'FAIL'} | ${item.meshCount} (${item.visibleMeshCount}) | ${item.vertexCount} | ${simStr} | ${visStr} | ${dropsStr} | ${item.runtimeDrops.boxGeometryFallbackCount} | ${aliasStr} | ${diagsStr} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generates a side-by-side comparison report across two or more evaluated arms
 * (e.g. `vanilla` vs `guided`, including their 1-turn repair results).
 */
export function generateComparisonReport(
  armNames: string[],
  resultsDir = RESULTS_DIR,
): {mdPath: string; jsonPath: string; mdContent: string} {
  const summaries: EvalSummary[] = [];
  for (const arm of armNames) {
    const p = path.join(resultsDir, `summary_${arm}.json`);
    if (!fs.existsSync(p)) {
      throw new Error(`Missing summary file for arm "${arm}": ${p}`);
    }
    summaries.push(JSON.parse(fs.readFileSync(p, 'utf8')) as EvalSummary);
  }

  const countWarnFree = (s: EvalSummary) =>
    (s.items ?? []).filter(
      (r) =>
        r.cleanCompileNoDrops &&
        !(r.diagnostics ?? []).some((d) => d.severity === 'error' || d.severity === 'warning'),
    ).length;
  const countActionableWarns = (s: EvalSummary) =>
    (s.items ?? []).reduce(
      (acc, r) =>
        acc +
        (r.diagnostics ?? []).filter((d) => d.severity === 'error' || d.severity === 'warning')
          .length,
      0,
    );

  const pct = (n: number, d: number) =>
    d > 0 ? `${((n / d) * 100).toFixed(1)}% (${n}/${d})` : '0.0% (0/0)';

  const headers = ['Metric', ...summaries.map((s) => `\`${s.arm}\``)];
  const sep = [':---', ...summaries.map(() => ':---:')];
  const rows: string[][] = [
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
        (s.simSummary?.simEvaluatedCount ?? 0) > 0
          ? `**${pct(s.simSummary.simActiveCount, s.simSummary.simEvaluatedCount)}**`
          : '—',
      ),
    ],
    [
      '**4-Up Contact Sheet Visual Judge Pass (`--judge`)**',
      ...summaries.map((s) =>
        (s.visualSummary?.visualEvaluatedCount ?? 0) > 0
          ? `**${pct(s.visualSummary.visualPassCount, s.visualSummary.visualEvaluatedCount)}** (avg ${s.visualSummary.meanOverallScore.toFixed(2)}/5.0)`
          : '—',
      ),
    ],
    [
      '**1-Turn Repair Visual Judge Pass (`before -> after`)**',
      ...summaries.map((s) =>
        (s.repairComparison?.visualEvaluatedCount ?? 0) > 0 && s.repairComparison
          ? `${s.repairComparison.beforeVisualPassCount}/${s.repairComparison.visualEvaluatedCount} -> **${pct(s.repairComparison.afterVisualPassCount, s.repairComparison.visualEvaluatedCount)}**`
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

  const allDiagCodes = new Set<string>();
  const allCategories = new Set<string>();
  for (const s of summaries) {
    for (const k of Object.keys(s.diagnosticHistogram ?? {})) {
      allDiagCodes.add(k);
    }
    for (const k of Object.keys(s.byCategory ?? {})) {
      allCategories.add(k);
    }
  }

  const lines: string[] = [
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
    '## 0-Shot Warning-Free Rate, Sim Active & Visual Judge by Category',
    '',
    `| Category | ${summaries.map((s) => `\`${s.arm}\` 0-Shot Warn-Free`).join(' | ')} | ${summaries.map((s) => `\`${s.arm}\` Sim Active`).join(' | ')} | ${summaries.map((s) => `\`${s.arm}\` Visual Judge`).join(' | ')} |`,
    `| :--- | ${summaries.map(() => ':---:').join(' | ')} | ${summaries.map(() => ':---:').join(' | ')} | ${summaries.map(() => ':---:').join(' | ')} |`,
  ];

  for (const cat of Array.from(allCategories).sort()) {
    const warnFreeCells = summaries.map((s) => {
      const catItems = (s.items ?? []).filter((r) => r.category === cat);
      const wf = catItems.filter(
        (r) =>
          r.cleanCompileNoDrops &&
          !(r.diagnostics ?? []).some((d) => d.severity === 'error' || d.severity === 'warning'),
      ).length;
      return pct(wf, catItems.length);
    });
    const simCells = summaries.map((s) => {
      const st = s.byCategory?.[cat];
      return st && st.simEvaluated > 0 ? pct(st.simActive, st.simEvaluated) : '—';
    });
    const visCells = summaries.map((s) => {
      const st = s.byCategory?.[cat];
      return st && st.visualEvaluated > 0
        ? `${pct(st.visualPass, st.visualEvaluated)} (${Number(st.avgVisualScore || 0).toFixed(2)})`
        : '—';
    });
    lines.push(
      `| \`${cat}\` | ${warnFreeCells.join(' | ')} | ${simCells.join(' | ')} | ${visCells.join(' | ')} |`,
    );
  }

  lines.push(
    '',
    '## Compiler Diagnostic Code Comparison (0-Shot Occurrences)',
    '',
    `| Diagnostic Code | ${summaries.map((s) => `\`${s.arm}\``).join(' | ')} |`,
    `| :--- | ${summaries.map(() => ':---:').join(' | ')} |`,
  );
  for (const code of Array.from(allDiagCodes).sort()) {
    const cells = summaries.map((s) => String(s.diagnosticHistogram?.[code] ?? 0));
    lines.push(`| \`${code}\` | ${cells.join(' | ')} |`);
  }
  lines.push('');

  const slug = armNames.join('_vs_');
  const mdPath = path.join(resultsDir, `comparison_${slug}.md`);
  const jsonPath = path.join(resultsDir, `comparison_${slug}.json`);
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
          repairComparison: s.repairComparison ?? null,
          simSummary: s.simSummary ?? null,
          visualSummary: s.visualSummary ?? null,
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
