/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Bring-your-own-LLM scene editing plugin bundle for
 * `<three-live>` / `<xr-live>` (three-live-ai.min.js).
 */

import {registerPlugin} from './plugin';
import {
  aiPlugin,
  createAIChatProvider,
  editScene,
  extractScript,
  undoEdit,
} from './plugins/ai';

registerPlugin(aiPlugin);

export {aiPlugin, createAIChatProvider, editScene, extractScript, undoEdit};
export type {
  AIChatMessage,
  AIChatProviderOptions,
  EditSceneOptions,
  EditSceneResult,
  ThreeLiveAIProvider,
} from './plugins/ai';
