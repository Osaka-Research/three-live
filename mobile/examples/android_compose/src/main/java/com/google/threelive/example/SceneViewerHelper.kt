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

package com.google.threelive.example

import android.content.Context
import androidx.core.content.FileProvider
import java.io.File

/**
 * Helper utility that bridges Three-Live's compiled GLB binary buffers into Google ARCore Scene
 * Viewer (`https://arvr.google.com/scene-viewer/1.2`) via the core SDK's
 * [com.google.threelive.SceneViewerHelper].
 */
object SceneViewerHelper {

  /**
   * Returns `true` when Google Play Services for AR (`com.google.ar.core`) is installed on the
   * device or emulator.
   */
  fun isArCoreInstalled(context: Context): Boolean =
    com.google.threelive.SceneViewerHelper.isArCoreInstalled(context)

  /**
   * Writes [glbBytes] to a cache file exposed via [FileProvider] and launches Google ARCore Scene
   * Viewer in `ar_preferred` mode when available on the device.
   *
   * @return `true` if an external ARCore Scene Viewer activity was started, or `false` if Google
   *   Play Services for AR (`com.google.ar.core`) is not installed / unavailable (so the caller can
   *   present an in-app AR surface preview fallback).
   */
  fun presentAR(
    context: Context,
    glbBytes: ByteArray,
    title: String = "Three-Live AR Scene",
  ): Boolean {
    if (!isArCoreInstalled(context)) {
      return false
    }

    val arDir = File(context.cacheDir, "ar_models")
    if (!arDir.exists() && !arDir.mkdirs()) {
      throw IllegalStateException("Failed to create cache directory for AR GLB export.")
    }

    val glbFile = File(arDir, "three_live_scene.glb")
    val tempFile = File.createTempFile(".three_live_scene.", ".tmp", arDir)
    try {
      tempFile.writeBytes(glbBytes)
      if (!tempFile.renameTo(glbFile)) {
        tempFile.copyTo(glbFile, overwrite = true)
        tempFile.delete()
      }
    } catch (t: Throwable) {
      tempFile.delete()
      throw t
    }

    val authority = "${context.packageName}.fileprovider"
    val contentUri = FileProvider.getUriForFile(context, authority, glbFile)
    return com.google.threelive.SceneViewerHelper.launchSceneViewer(
      context = context,
      contentUri = contentUri,
      title = title,
      mode = "ar_preferred",
      resizable = true,
    )
  }
}
