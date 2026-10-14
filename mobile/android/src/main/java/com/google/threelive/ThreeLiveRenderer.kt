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

package com.google.threelive

import android.content.Context
import android.view.View

/**
 * An Android renderer for compiled three-live scenes: a [ThreeLiveSceneRenderer] that also creates
 * the view that displays it.
 */
interface ThreeLiveRenderer : ThreeLiveSceneRenderer {
  /** Creates (once) and returns the Android view that displays the scene. */
  fun createView(context: Context): View
}

/** Factory for renderers, registered by renderer modules. */
fun interface ThreeLiveRendererFactory {
  fun create(context: Context): ThreeLiveRenderer
}

/**
 * Process-wide renderer registry. Nothing is registered by default: renderer modules register
 * themselves only when the app calls their install function (no auto-initialization).
 */
object ThreeLiveRenderers {
  @Volatile private var factory: ThreeLiveRendererFactory? = null

  /** Registers [rendererFactory], replacing any previous one. */
  @JvmStatic
  fun register(rendererFactory: ThreeLiveRendererFactory) {
    factory = rendererFactory
  }

  /** Removes the registered factory. */
  @JvmStatic
  fun clear() {
    factory = null
  }

  /** The registered factory, or `null` when the app installed no renderer. */
  @JvmStatic
  fun current(): ThreeLiveRendererFactory? = factory
}
