/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

#ifndef THREE_LIVE_COMPILER_H
#define THREE_LIVE_COMPILER_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Representation of a zero-copy wire memory buffer allocated by Rust.
 *
 * Ownership semantics:
 * - If `error_msg` is non-null, compilation failed. Free with `three_live_free_error(error_msg)`.
 * - If `data` is non-null, compilation succeeded. Free with `three_live_free_buffer(data, capacity)`.
 */
typedef struct {
    uint8_t* data;
    size_t len;
    size_t capacity;
    char* error_msg;
} ThreeLiveGlbBuffer;

typedef ThreeLiveGlbBuffer ThreeLiveBuffer;

/**
 * Compiles a procedural Three.js scene script into a binary GLB wire buffer.
 *
 * @param script Null-terminated UTF-8 string containing the Three.js code.
 * @return A `ThreeLiveGlbBuffer` struct containing either the GLB data pointer or error string.
 */
ThreeLiveGlbBuffer three_live_compile(const char* script);

/**
 * Compiles a procedural Three.js scene script directly into a binary USDZ wire buffer.
 *
 * @param script Null-terminated UTF-8 string containing the Three.js code.
 * @return A `ThreeLiveBuffer` struct containing either the USDZ data pointer or error string.
 */
ThreeLiveBuffer three_live_compile_usdz(const char* script);

/**
 * Transcodes a binary GLB model directly into a binary USDZ wire buffer.
 *
 * @param data Pointer to the GLB binary buffer.
 * @param len Byte length of the GLB binary buffer.
 * @return A `ThreeLiveBuffer` struct containing either the USDZ data pointer or error string.
 */
ThreeLiveBuffer three_live_glb_to_usdz(const uint8_t* data, size_t len);

/**
 * Frees a wire buffer previously allocated by `three_live_compile`, `three_live_compile_usdz`, or `three_live_glb_to_usdz`.
 *
 * @param data Pointer to the memory buffer to free.
 * @param capacity The capacity of the buffer as reported in `ThreeLiveBuffer.capacity`.
 */
void three_live_free_buffer(uint8_t* data, size_t capacity);

/**
 * Frees an error message string previously allocated by `three_live_compile`, `three_live_compile_usdz`, or `three_live_glb_to_usdz`.
 *
 * @param error_msg Pointer to the error message string to free.
 */
void three_live_free_error(char* error_msg);

/**
 * Runs one AI scene-editing or voice-protocol request for Tap & Speak (`three-live-ai` parity).
 *
 * @param request Null-terminated UTF-8 JSON object, e.g.
 *     `{"op":"validate","code":"...","selection":"Roof","instruction":"make it red"}`.
 *     Ops: `messages`, `repair`, `extract`, `validate`, `describe`, `voice_setup`, `voice_audio`,
 *     `voice_text`, `voice_tool_result`, `voice_parse`, `voice_tools`.
 * @return A newly allocated null-terminated JSON string (never null; `{"error": ...}` on bad
 *     input). Free with `three_live_free_string`. `validate` compiles with the calling thread's
 *     warm engine: call it from the same worker thread as `three_live_compile`.
 */
char* three_live_ai_call(const char* request);

/**
 * Frees a string returned by `three_live_ai_call`.
 *
 * @param s Pointer returned by `three_live_ai_call`.
 */
void three_live_free_string(char* s);

#ifdef __cplusplus
}
#endif

#endif  // THREE_LIVE_COMPILER_H
