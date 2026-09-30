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

import java.io.File
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

/**
 * Helper utilities for launching Google Play Services for AR (`com.google.ar.core` Scene Viewer)
 * from compiled Three-Live `.glb` buffers on Android.
 */
object SceneViewerHelper {

  private val ALLOWED_MODES = setOf("ar_preferred", "ar_only", "3d_preferred", "3d_only")

  /**
   * Validates that [uri] uses an allowed scheme (`https://` or `content://`) and contains no
   * control characters before embedding it into an Android `intent://` URI (P1-4 / MOB-01).
   *
   * Rejects `file://`, `javascript:`, `data:`, `http://`, and `intent://` URIs.
   */
  @JvmStatic
  fun validateSceneViewerUri(uri: String, paramName: String = "fileUri"): String {
    val trimmed = uri.trim()
    require(trimmed.isNotEmpty()) {
      "[Three-Live Security] Scene Viewer $paramName must not be blank."
    }
    require(trimmed.none { it.code <= 0x1F || it.code == 0x7F }) {
      "[Three-Live Security] Scene Viewer $paramName contains illegal control characters."
    }
    val lower = trimmed.lowercase()
    require(lower.startsWith("https://") || lower.startsWith("content://")) {
      "[Three-Live Security] Unsafe $paramName URI scheme for Scene Viewer: '$trimmed'. " +
        "Only https:// and content:// URIs are permitted."
    }
    return trimmed
  }

  /**
   * Builds an Android `intent://` URI targeting Google Play Services for AR (`Scene Viewer`).
   *
   * @param fileUri Public HTTPS URL or `content://` FileProvider URI for the `.glb` asset.
   * @param mode Scene Viewer launch mode (`"ar_preferred"`, `"ar_only"`, or `"3d_preferred"`).
   * @param title Optional display title in the Scene Viewer toolbar.
   * @param resizable Whether pinch-to-scale is enabled in AR.
   * @param soundUri Optional spatial audio URL/URI to play while viewing.
   */
  @JvmStatic
  @JvmOverloads
  fun buildSceneViewerIntentUri(
    fileUri: String,
    mode: String = "ar_preferred",
    title: String? = null,
    resizable: Boolean = true,
    soundUri: String? = null,
  ): String {
    val safeFileUri = validateSceneViewerUri(fileUri, "fileUri")
    val safeMode = if (mode in ALLOWED_MODES) mode else "ar_preferred"
    val params =
      mutableListOf(
        "file=${encodeParam(safeFileUri)}",
        "mode=${encodeParam(safeMode)}",
        "resizable=$resizable",
      )
    if (!title.isNullOrBlank()) {
      params.add("title=${encodeParam(title)}")
    }
    if (!soundUri.isNullOrBlank()) {
      val safeSoundUri = validateSceneViewerUri(soundUri, "soundUri")
      params.add("sound=${encodeParam(safeSoundUri)}")
    }
    val query = params.joinToString("&")
    return "intent://arvr.google.com/scene-viewer/1.2?$query" +
      "#Intent;scheme=https;package=com.google.ar.core;" +
      "action=android.intent.action.VIEW;end;"
  }

  /**
   * Writes a compiled [GlbBuffer] to [targetFile] atomically so it can be served via Android
   * `FileProvider` to `Scene Viewer` or Jetpack SceneCore.
   */
  @JvmStatic
  fun writeGlbToFile(glbBuffer: GlbBuffer, targetFile: File): File =
    glbBuffer.writeToFile(targetFile)

  private fun encodeParam(value: String): String =
    URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
