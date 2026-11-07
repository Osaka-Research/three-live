/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared TypeScript interfaces for the `three-live` Codegen & Compiler Evaluation Suite.
 */

export interface PromptEntry {
  id: string;
  category: string;
  title: string;
  prompt: string;
  expectedFeatures?: string[];
}

export interface DegradedAliasMatch {
  symbol: string;
  degradesTo: string;
}

export interface SymbolAnalysis {
  totalUniqueSymbols: number;
  supported: string[];
  degradedAliases: DegradedAliasMatch[];
  unsupportedConstants: string[];
  unsupportedClasses: string[];
}

export interface CompilerDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info' | string;
  message: string;
  line?: number;
  column?: number;
  node?: string;
  hint?: string;
}

export interface CompilerCameraSummary {
  visibleMeshCount: number;
}

export interface CompilerWorldBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface CompilerSceneSummary {
  meshCount: number;
  vertexCount: number;
  indexCount: number;
  materialCount: number;
  lightCount: number;
  hasInteractivity?: boolean;
  camera: CompilerCameraSummary;
  worldBounds?: CompilerWorldBounds | null;
}

export interface CompilerValidateReport {
  valid: boolean;
  input: string;
  executionTimeMs: number;
  summary: CompilerSceneSummary | null;
  nodes: unknown[];
  diagnostics: CompilerDiagnostic[];
}

export interface SimBodyReport {
  name?: string;
  initialTranslation?: [number, number, number];
  finalTranslation?: [number, number, number];
  initialRotation?: [number, number, number, number];
  finalRotation?: [number, number, number, number];
  initialScale?: [number, number, number];
  finalScale?: [number, number, number];
}

export interface SimRawReport {
  durationSec?: number;
  ticksSimulated?: number;
  bodies?: SimBodyReport[];
  triggeredEvents?: string[];
  completedObjectives?: string[];
  audioCuesFired?: string[];
  score?: number;
  scenarioState?: string;
}

export interface SimEvaluation {
  ran: boolean;
  durationSec?: number;
  ticksSimulated?: number;
  movedBodies?: number;
  totalBodies?: number;
  triggeredEvents?: string[];
  completedObjectives?: string[];
  audioCuesFired?: string[];
  score?: number;
  scenarioState?: string;
  simActive: boolean | null;
}

export interface QuadrantRasterMetrics {
  occupancy: number;
  centroidX: number;
  centroidY: number;
  bboxW: number;
  bboxH: number;
  meanLuma: number;
  lumaStd: number;
  colorBuckets: number;
}

export interface QuadRasterStats {
  width: number;
  height: number;
  camera: QuadrantRasterMetrics;
  front: QuadrantRasterMetrics;
  top: QuadrantRasterMetrics;
  iso: QuadrantRasterMetrics;
}

export interface VlmJudgeScores {
  semanticMatch: number;
  spatialCoherence: number;
  cameraFraming: number;
  materialAndLighting: number;
  visualCritique?: string;
}

export interface VisualEvaluation {
  ran: boolean;
  pngPath?: string;
  semanticMatch?: number;
  spatialCoherence?: number;
  cameraFraming?: number;
  materialAndLighting?: number;
  overallScore?: number;
  visualPass: boolean | null;
  visualCritique?: string;
  raster?: QuadRasterStats | null;
}

export interface MisclassifiedTl103Entry {
  symbol: string;
  code: string;
  message: string;
  hint: string;
}

export interface RuntimeDropMetrics {
  noopDrops: string[];
  boxGeometryFallbackCount: number;
  degradedWarnings: string[];
  misclassifiedTl103: MisclassifiedTl103Entry[];
  lexicalSceneShadowed: boolean;
}

export interface ScriptEvalResult {
  id: string;
  category: string;
  title: string;
  scriptPath: string;
  valid: boolean;
  compileSucceeded: boolean;
  cleanCompileNoDrops: boolean;
  executionTimeMs: number;
  meshCount: number;
  visibleMeshCount: number;
  frustumVisibilityRatio: number;
  vertexCount: number;
  indexCount: number;
  materialCount: number;
  lightCount: number;
  hasInteractivity: boolean;
  worldBounds: CompilerWorldBounds | null;
  expectedFeatures: string[];
  matchedExpectedFeatures: string[];
  symbolAnalysis: SymbolAnalysis;
  runtimeDrops: RuntimeDropMetrics;
  simEvaluation: SimEvaluation;
  visualEvaluation: VisualEvaluation;
  diagnosticCodes: string[];
  errorCodes: string[];
  warningCodes: string[];
  diagnostics: CompilerDiagnostic[];
}

export interface CategoryStats {
  total: number;
  compileSucceeded: number;
  cleanCompileNoDrops: number;
  withDrops: number;
  avgFrustumVisibilityRatio: number;
  simEvaluated: number;
  simActive: number;
  visualEvaluated: number;
  visualPass: number;
  avgVisualScore: number;
}

export interface SimSummary {
  simEvaluatedCount: number;
  simActiveCount: number;
  simActiveRate: number;
  simMovedBodiesTotal: number;
  simTriggeredEventsTotal: number;
  simCompletedObjectivesTotal: number;
  simAudioCuesTotal: number;
}

export interface VisualSummary {
  visualEvaluatedCount: number;
  visualPassCount: number;
  visualPassRate: number;
  meanSemanticMatch: number;
  meanSpatialCoherence: number;
  meanCameraFraming: number;
  meanMaterialAndLighting: number;
  meanOverallScore: number;
  meanCameraOccupancy: number;
}

export interface RepairComparison {
  repairedTotal: number;
  beforeCompileSuccessCount: number;
  afterCompileSuccessCount: number;
  beforeCleanCount: number;
  afterCleanCount: number;
  beforeWarningFreeCount: number;
  afterWarningFreeCount: number;
  simEvaluatedCount: number;
  beforeSimActiveCount: number;
  afterSimActiveCount: number;
  visualEvaluatedCount: number;
  beforeVisualPassCount: number;
  afterVisualPassCount: number;
  beforeMeanVisualScore: number;
  afterMeanVisualScore: number;
  warningsBefore: number;
  warningsAfter: number;
  diagnosticsBefore: number;
  diagnosticsAfter: number;
}

export interface EvalSummary {
  arm: string;
  timestamp: string;
  totalScripts: number;
  compileSuccessCount: number;
  compileSuccessRate: number;
  cleanNoDropsCount: number;
  cleanNoDropsRate: number;
  withNoopDropsCount: number;
  withBoxFallbackCount: number;
  withDegradedAliasesCount: number;
  withMisclassifiedTl103Count: number;
  avgFrustumVisibilityRatio: number;
  avgExecutionTimeMs: number;
  simSummary: SimSummary;
  visualSummary: VisualSummary;
  byCategory: Record<string, CategoryStats>;
  diagnosticHistogram: Record<string, number>;
  droppedSymbolHistogram: Record<string, number>;
  degradedAliasHistogram: Record<string, number>;
  unsupportedConstantHistogram: Record<string, number>;
  repairComparison: RepairComparison | null;
  items: ScriptEvalResult[];
}

export interface CliOptions {
  arm: string;
  armExplicit: boolean;
  generate: boolean;
  evaluate: boolean;
  sim: boolean;
  simAll: boolean;
  repair: boolean;
  render: boolean;
  judge: boolean;
  vlmJudge: boolean;
  overwrite: boolean;
  provider: string | null;
  model: string | null;
  cmd: string | null;
  temperature?: number;
  category: string | null;
  ids: Set<string> | null;
  limit: number | null;
  concurrency: number;
  compare: string[] | null;
  promptsPath: string;
  renderWidth?: number;
  renderHeight?: number;
  currentArm?: string;
  help: boolean;
}

export interface LlmConfig {
  provider: string;
  model: string;
  cmd: string | null;
  temperature: number;
}

export interface PromptPair {
  systemPrompt: string;
  userPrompt: string;
}

export interface RepairValidationInput {
  valid?: boolean;
  summary?: {
    meshCount: number;
    lightCount: number;
    camera: {visibleMeshCount: number};
  } | null;
  simEvaluation?: SimEvaluation;
  visualEvaluation?: VisualEvaluation;
  diagnostics?: CompilerDiagnostic[];
}
