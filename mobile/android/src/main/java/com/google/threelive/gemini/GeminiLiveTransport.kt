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

package com.google.threelive.gemini

/**
 * Bidirectional transport to a Gemini Live (or compatible) backend.
 *
 * Mirrors `GeminiLiveTransport` in `xr-live/src/plugins/gemini-live.ts`: messages are the JSON
 * objects of the Live API (`BidiGenerateContentClientMessage` / `...ServerMessage`) decoded to
 * plain Kotlin maps, lists, strings, doubles and booleans (see [com.google.threelive.MiniJson]).
 *
 * Implementations must be thread-safe: [send] and [close] may be called from any thread.
 */
interface GeminiLiveTransport {

  /** Receives server messages and the close notification. Set by the controller. */
  interface Listener {
    /** Invoked with each parsed server message (on a transport-owned thread). */
    fun onMessage(message: Map<String, Any?>)

    /** Invoked exactly once when the transport closes, for any reason. */
    fun onClose()
  }

  /** Current listener; replaced by [XRGeminiLiveController.connect]. */
  var listener: Listener?

  /** Queues [message] for delivery. Messages sent after [close] are dropped. */
  fun send(message: Map<String, Any?>)

  /** Closes the transport. Idempotent. */
  fun close()
}
