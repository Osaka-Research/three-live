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

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/**
 * Helper utility that bridges Three-Live's compiled GLB binary buffers into Google ARCore Scene
 * Viewer (`https://arvr.google.com/scene-viewer/1.0`), mirroring iOS's `QuickLookHelper.swift`.
 */
object SceneViewerHelper {
  private val AR_HOST_PACKAGES =
    listOf("com.google.ar.core", "com.google.android.googlequicksearchbox")

  /**
   * Writes [glbBytes] to a cache file exposed via [FileProvider] and launches Google ARCore Scene
   * Viewer in `ar_preferred` mode so the user can place the compiled 3D scene onto real-world
   * surfaces with ARKit/ARCore parity.
   */
  fun presentAR(context: Context, glbBytes: ByteArray, title: String = "Three-Live AR Scene") {
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

    // Validate scheme (content://) and construct the Scene Viewer intent:// URI via the SDK helper
    val intentUriString =
      com.google.threelive.SceneViewerHelper.buildSceneViewerIntentUri(
        fileUri = contentUri.toString(),
        mode = "ar_preferred",
        title = title,
        resizable = true,
      )

    // Attach contentUri via ClipData + FLAG_GRANT_READ_URI_PERMISSION so Android scopes temporary
    // read access strictly to the receiving Activity lifecycle without leaving a permanent grant.
    val uriClipData = ClipData.newRawUri("scene", contentUri)

    // Try launching via the parsed intent:// URI (which targets com.google.ar.core) first.
    val parsedIntent =
      Intent.parseUri(intentUriString, Intent.URI_INTENT_SCHEME).apply {
        clipData = uriClipData
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
    try {
      context.startActivity(parsedIntent)
      return
    } catch (_: ActivityNotFoundException) {
      // Fallback to alternative AR host packages below.
    }

    val fallbackDataUri =
      Uri.parse("https://arvr.google.com/scene-viewer/1.2")
        .buildUpon()
        .appendQueryParameter("file", contentUri.toString())
        .appendQueryParameter("mode", "ar_preferred")
        .appendQueryParameter("title", title)
        .build()

    for (pkg in AR_HOST_PACKAGES) {
      val explicitIntent =
        Intent(Intent.ACTION_VIEW).apply {
          data = fallbackDataUri
          clipData = uriClipData
          setPackage(pkg)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      try {
        context.startActivity(explicitIntent)
        return
      } catch (_: ActivityNotFoundException) {
        // Try next candidate package.
      }
    }

    throw IllegalStateException(
      "Google Play Services for AR (Scene Viewer) is not available on this device or emulator."
    )
  }
}
