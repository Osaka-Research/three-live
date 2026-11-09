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
  describeVoiceSelection,
  realtimeAdapter,
  selectByVoice,
  selectNamesByVoice,
  setSelectOnTap,
  speakableName,
  startVoiceEdit,
} from './plugins/ai-voice';
import {hideSelectionChips, showSelectionChips} from './plugins/ai-select-chips';
export type {AISelectChipsState} from './plugins/ai-select-chips';
export type {AIModelSelection, AISelectProvider} from './plugins/ai-select';
export type {
  AISelectionEventDetail,
  AISelectionMode,
  AISelectionSource,
} from './plugins/ai-select';

import {
  describeSelection,
  getSelection,
  parseSelectReply,
  resolveSelection,
  resolveSelectionWithModel,
  sceneSelectEntries,
  selectCamera,
  selectMessages,
  setSelection,
} from './plugins/ai-select';
import {buildSelectIndex, matchSelection, parseVoiceCommand} from './plugins/ai-select-match';
import {
  buildImageMessages,
  buildImageUserText,
  formatSpatialPriors,
  IMAGE_SYSTEM_PROMPT,
  imageRepairMessage,
  isAllowedImageUrl,
} from './plugins/ai-image';
export type {
  AISpatialCamera,
  AISpatialObject,
  AISpatialPlane,
  AISpatialPriors,
} from './plugins/ai-image';
export type {
  SelectCamera,
  SelectConfidence,
  SelectIndexEntry,
  SelectMatch,
  SelectRawEntry,
  VoiceCommand,
} from './plugins/ai-select-match';

registerPlugin(aiPlugin);

export {
  AIVoiceSession,
  aiPlugin,
  buildImageMessages,
  buildImageUserText,
  connectVoice,
  createAIChatProvider,
  createWebSpeechRecognizer,
  describeEditResult,
  buildSelectIndex,
  describeSelection,
  describeVoiceSelection,
  editScene,
  formatSpatialPriors,
  getSelection,
  hideSelectionChips,
  IMAGE_SYSTEM_PROMPT,
  imageRepairMessage,
  isAllowedImageUrl,
  matchSelection,
  parseSelectReply,
  parseVoiceCommand,
  resolveSelection,
  resolveSelectionWithModel,
  sceneSelectEntries,
  selectByVoice,
  selectCamera,
  selectMessages,
  selectNamesByVoice,
  setSelection,
  showSelectionChips,
  speakableName,
  extractScript,
  geminiLiveAdapter,
  realtimeAdapter,
  setSelectOnTap,
  startVoiceEdit,
  undoEdit,
};
export type {
  AIChatContentPart,
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
  AIVoiceSelection,
  AIVoiceEditOptions,
  AIVoiceEditResult,
  AIVoiceEventDetail,
  AIVoiceProviderName,
  AIVoiceSessionOptions,
  AIVoiceState,
  AIVoiceTransport,
} from './plugins/ai-voice';
export type {
  AISelectionEventDetail,
  AISelectionMode,
  AISelectionSource,
} from './plugins/ai-select';
