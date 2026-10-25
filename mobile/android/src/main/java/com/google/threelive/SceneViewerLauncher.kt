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

@file:JvmName("SceneViewerLauncher")

package com.google.threelive

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

/**
 * Returns `true` when Google Play Services for AR (`com.google.ar.core`) is installed on the device
 * or emulator.
 *
 * Note: Even when `com.google.android.googlequicksearchbox` is preinstalled on an Android Emulator,
 * its `SceneViewerDeeplink` gateway activity immediately finishes (`finish()`) or refuses to load
 * models unless `com.google.ar.core` is installed.
 */
fun SceneViewerHelper.isArCoreInstalled(context: Context): Boolean {
  return try {
    @Suppress("DEPRECATION")
    context.packageManager.getPackageInfo(ARCORE_PACKAGE, 0) != null
  } catch (_: Exception) {
    false
  }
}

/**
 * Launches Google ARCore Scene Viewer for a `content://` (or `https://`) [contentUri] when Google
 * Play Services for AR (`com.google.ar.core`) is installed on the device.
 *
 * Automatically grants temporary URI read permissions to both `com.google.ar.core` and
 * `com.google.android.googlequicksearchbox` so internal gateway redirects to `ViewerActivity`
 * retain read access to `FileProvider` URIs.
 *
 * @return `true` if an external Scene Viewer activity was started, or `false` if Google Play
 *   Services for AR is not installed / unavailable (so the caller can activate an in-app AR surface
 *   preview fallback via [ThreeLiveSceneRenderer.setArSurfacePreviewEnabled]).
 */
@JvmOverloads
fun SceneViewerHelper.launchSceneViewer(
  context: Context,
  contentUri: Uri,
  title: String = "Three-Live AR Scene",
  mode: String = "ar_preferred",
  resizable: Boolean = true,
  soundUri: String? = null,
): Boolean {
  if (!isArCoreInstalled(context)) {
    return false
  }

  val uriString = validateSceneViewerUri(contentUri.toString(), "fileUri")
  val safeMode = if (mode in ALLOWED_MODES) mode else "ar_preferred"

  if (uriString.lowercase().startsWith("content://")) {
    for (pkg in AR_HOST_PACKAGES) {
      try {
        context.grantUriPermission(pkg, contentUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      } catch (_: Exception) {
        // Ignore if candidate package is not installed.
      }
    }
  }

  val intentUriString =
    buildSceneViewerIntentUri(
      fileUri = uriString,
      mode = safeMode,
      title = title,
      resizable = resizable,
      soundUri = soundUri,
    )

  val uriClipData = ClipData.newRawUri("scene", contentUri)
  val baseFlags =
    Intent.FLAG_GRANT_READ_URI_PERMISSION or
      if (context is Activity) 0 else Intent.FLAG_ACTIVITY_NEW_TASK

  val parsedIntent =
    Intent.parseUri(intentUriString, Intent.URI_INTENT_SCHEME).apply {
      clipData = uriClipData
      addFlags(baseFlags)
    }
  if (
    context.packageManager.resolveActivity(parsedIntent, PackageManager.MATCH_DEFAULT_ONLY) != null
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
      .appendQueryParameter("file", uriString)
      .appendQueryParameter("mode", safeMode)
      .appendQueryParameter("resizable", resizable.toString())
      .apply {
        if (title.isNotBlank()) {
          appendQueryParameter("title", title)
        }
        if (!soundUri.isNullOrBlank()) {
          appendQueryParameter("sound", validateSceneViewerUri(soundUri, "soundUri"))
        }
      }
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
      context.packageManager.resolveActivity(explicitIntent, PackageManager.MATCH_DEFAULT_ONLY) !=
        null
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
