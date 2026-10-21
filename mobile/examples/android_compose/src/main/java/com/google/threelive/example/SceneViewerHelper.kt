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

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.FileProvider
import java.io.File

/**
 * Helper utility that bridges Three-Live's compiled GLB binary buffers into Google ARCore Scene
 * Viewer (`https://arvr.google.com/scene-viewer/1.2`), mirroring iOS's `QuickLookHelper.swift`.
 */
object SceneViewerHelper {
  private const val ARCORE_PACKAGE = "com.google.ar.core"
  private val AR_HOST_PACKAGES =
    listOf(ARCORE_PACKAGE, "com.google.android.googlequicksearchbox")

  /**
   * Returns `true` when Google Play Services for AR (`com.google.ar.core`) is installed on the
   * device or emulator.
   *
   * Note: Even when `com.google.android.googlequicksearchbox` is preinstalled on an Android
   * Emulator, its `SceneViewerDeeplink` gateway activity immediately finishes (`finish()`) or
   * refuses to load models unless `com.google.ar.core` is installed.
   */
  fun isArCoreInstalled(context: Context): Boolean {
    return try {
      @Suppress("DEPRECATION")
      context.packageManager.getPackageInfo(ARCORE_PACKAGE, 0) != null
    } catch (_: Exception) {
      false
    }
  }

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

    // Explicitly grant package-level URI read permission to both com.google.ar.core and
    // com.google.android.googlequicksearchbox. When com.google.ar.core's IntentForwardActivity
    // forwards to com.google.android.googlequicksearchbox and GoogleAppGatewayActivity redirects
    // internally to ViewerActivity (:googleapp process), ClipData and Intent flags are stripped;
    // explicit grantUriPermission ensures ViewerActivity can still read the FileProvider URI.
    for (pkg in AR_HOST_PACKAGES) {
      try {
        context.grantUriPermission(pkg, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (_: Exception) {
        // Ignore if candidate package is not installed.
      }
    }

    // Validate scheme (content://) and construct the Scene Viewer intent:// URI via the SDK helper
    val intentUriString =
      com.google.threelive.SceneViewerHelper.buildSceneViewerIntentUri(
        fileUri = contentUri.toString(),
        mode = "ar_preferred",
        title = title,
        resizable = true,
      )

    val uriClipData = ClipData.newRawUri("scene", contentUri)
    val baseFlags =
      Intent.FLAG_GRANT_READ_URI_PERMISSION or
        if (context is Activity) 0 else Intent.FLAG_ACTIVITY_NEW_TASK

    // Try launching via the parsed intent:// URI (which targets com.google.ar.core) first.
    val parsedIntent =
      Intent.parseUri(intentUriString, Intent.URI_INTENT_SCHEME).apply {
        clipData = uriClipData
        addFlags(baseFlags)
      }
    if (
      context.packageManager.resolveActivity(parsedIntent, PackageManager.MATCH_DEFAULT_ONLY) !=
        null
    ) {
      try {
        context.startActivity(parsedIntent)
        return true
      } catch (_: ActivityNotFoundException) {
        // Fallback to alternative AR host packages below.
      }
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
          addFlags(baseFlags)
        }
      if (
        context.packageManager.resolveActivity(
          explicitIntent,
          PackageManager.MATCH_DEFAULT_ONLY,
        ) != null
      ) {
        try {
          context.startActivity(explicitIntent)
          return true
        } catch (_: ActivityNotFoundException) {
          // Try next candidate package.
        }
      }
    }

    return false
  }
}
