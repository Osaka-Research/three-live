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

import {
  AIVoiceSession,
  connectVoice,
  createWebSpeechRecognizer,
  describeEditResult,
  geminiLiveAdapter,
  realtimeAdapter,
  setSelectOnTap,
  startVoiceEdit,
} from './plugins/ai-voice';

registerPlugin(aiPlugin);

export {
  AIVoiceSession,
  aiPlugin,
  connectVoice,
  createAIChatProvider,
  createWebSpeechRecognizer,
  describeEditResult,
  editScene,
  extractScript,
  geminiLiveAdapter,
  realtimeAdapter,
  setSelectOnTap,
  startVoiceEdit,
  undoEdit,
};
export type {
  AIChatMessage,
  AIChatProviderOptions,
  EditSceneOptions,
  EditSceneResult,
  ThreeLiveAIProvider,
} from './plugins/ai';
export type {
  AIAudioSink,
  AIMicrophoneSource,
  AISpeechRecognizer,
  AIVoiceAdapter,
  AIVoiceEditOptions,
  AIVoiceEditResult,
  AIVoiceEventDetail,
  AIVoiceProviderName,
  AIVoiceSessionOptions,
  AIVoiceState,
  AIVoiceTransport,
} from './plugins/ai-voice';
