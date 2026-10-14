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

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import java.net.URI
import java.net.URISyntaxException
import java.net.URLEncoder
import java.util.Locale

/**
 * Endpoint policy and URL builders for the Gemini Live API (`BidiGenerateContent`).
 *
 * Credentials never belong in client code. Supported ways to connect, in order of preference:
 * 1. **Ephemeral token** minted by your backend (`AuthTokenService.CreateToken`) and passed to
 *    [ephemeralTokenUrl] (or as an `Authorization: Token ...` header).
 * 2. **Proxy URL**: your own `wss://` endpoint that injects credentials server-side.
 * 3. **Dev-only API key** via [devApiKeyUrl]: refused in non-debuggable (release) builds.
 *
 * Nothing in this package logs URLs, tokens or keys.
 */
object GeminiLiveEndpoints {

  /** Host of the public Gemini Developer API. */
  const val DEFAULT_HOST = "generativelanguage.googleapis.com"

  /** API version documented for raw-WebSocket Live sessions (including ephemeral tokens). */
  const val DEFAULT_API_VERSION = "v1beta"

  /** Method used with API keys. */
  const val METHOD_BIDI = "BidiGenerateContent"

  /** Method that accepts ephemeral tokens. */
  const val METHOD_BIDI_CONSTRAINED = "BidiGenerateContentConstrained"

  /** Query parameter carrying an ephemeral token. */
  const val ACCESS_TOKEN_PARAM = "access_token"

  /** Auth scheme for ephemeral tokens passed as an `Authorization` header. */
  const val TOKEN_AUTH_SCHEME = "Token"

  private const val TAG = "ThreeLiveGemini"

  private val LOOPBACK_HOSTS = setOf("localhost", "127.0.0.1", "[::1]")

  private val API_VERSION_PATTERN = Regex("^v[0-9]+[a-z0-9]*$")

  /**
   * Validates a Live API endpoint exactly like the web client's `isAllowedLiveUrl`: only `wss:` is
   * accepted, except `ws:` on loopback hosts (`localhost`, `127.0.0.1`, `[::1]`) for local
   * development. Malformed URLs are rejected.
   */
  @JvmStatic
  fun isAllowedLiveUrl(raw: String?): Boolean {
    if (raw.isNullOrEmpty()) return false
    val uri =
      try {
        URI(raw)
      } catch (e: URISyntaxException) {
        return false
      }
    if (uri.isOpaque) return false
    val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return false
    val host = uri.host?.lowercase(Locale.ROOT)
    if (host.isNullOrEmpty()) return false
    return when (scheme) {
      "wss" -> true
      "ws" -> host in LOOPBACK_HOSTS
      else -> false
    }
  }

  /** Returns `true` when [raw] is an allowed loopback `ws:` / `wss:` URL. */
  @JvmStatic
  fun isLoopbackUrl(raw: String): Boolean {
    val host =
      try {
        URI(raw).host?.lowercase(Locale.ROOT)
      } catch (e: URISyntaxException) {
        null
      }
    return host != null && host in LOOPBACK_HOSTS
  }

  /** Base `wss://` URL (without query) of the Live endpoint for [method] and [apiVersion]. */
  @JvmStatic
  @JvmOverloads
  fun baseUrl(
    method: String = METHOD_BIDI,
    apiVersion: String = DEFAULT_API_VERSION,
    host: String = DEFAULT_HOST,
  ): String {
    require(API_VERSION_PATTERN.matches(apiVersion)) { "Invalid API version" }
    require(method == METHOD_BIDI || method == METHOD_BIDI_CONSTRAINED) { "Invalid method" }
    require(host.isNotEmpty() && host.none { it == '/' || it == '?' || it == '#' || it == '@' }) {
      "Invalid host"
    }
    return "wss://$host/ws/google.ai.generativelanguage.$apiVersion.GenerativeService.$method"
  }

  /**
   * Live API URL for an ephemeral token minted by your backend. The token is passed in the
   * documented `access_token` query parameter of `BidiGenerateContentConstrained`. To keep the
   * token out of the URL entirely, use [baseUrl] with [METHOD_BIDI_CONSTRAINED] plus
   * [ephemeralTokenHeaders] instead.
   */
  @JvmStatic
  @JvmOverloads
  fun ephemeralTokenUrl(token: String, apiVersion: String = DEFAULT_API_VERSION): String {
    require(token.isNotBlank()) { "Ephemeral token is empty" }
    return baseUrl(METHOD_BIDI_CONSTRAINED, apiVersion) +
      "?" +
      ACCESS_TOKEN_PARAM +
      "=" +
      encodeQueryValue(token)
  }

  /** `Authorization: Token <token>` header for an ephemeral token. */
  @JvmStatic
  fun ephemeralTokenHeaders(token: String): Map<String, String> {
    require(token.isNotBlank()) { "Ephemeral token is empty" }
    return mapOf("Authorization" to "$TOKEN_AUTH_SCHEME $token")
  }

  /**
   * **Development only.** Live API URL embedding a long-lived API key.
   *
   * Shipping an API key in an app lets anyone extract it and bill your project. This refuses to
   * build the URL unless [isDebuggable] is `true` (see [isDebuggable] for the Android check) and
   * logs a loud warning every time it is used. The key itself is never logged.
   *
   * @throws IllegalStateException in non-debuggable builds.
   */
  @JvmStatic
  @JvmOverloads
  fun devApiKeyUrl(
    apiKey: String,
    isDebuggable: Boolean,
    apiVersion: String = DEFAULT_API_VERSION,
  ): String {
    check(isDebuggable) {
      "Gemini Live API keys are refused in release builds; use an ephemeral token or proxy URL"
    }
    require(apiKey.isNotBlank()) { "API key is empty" }
    warn(
      "DEV-ONLY: connecting to Gemini Live with an embedded API key. Never ship this; " +
        "mint ephemeral tokens on your backend instead."
    )
    return baseUrl(METHOD_BIDI, apiVersion) + "?key=" + encodeQueryValue(apiKey)
  }

  /** [devApiKeyUrl] using the app's `FLAG_DEBUGGABLE` as the debug gate. */
  @JvmStatic
  @JvmOverloads
  fun devApiKeyUrl(
    context: Context,
    apiKey: String,
    apiVersion: String = DEFAULT_API_VERSION,
  ): String {
    return devApiKeyUrl(apiKey, isDebuggable(context), apiVersion)
  }

  /** Whether the host app is debuggable (`android:debuggable`, set by debug build types). */
  @JvmStatic
  fun isDebuggable(context: Context): Boolean {
    return (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
  }

  /** Percent-encodes a query parameter value (RFC 3986; spaces become `%20`). */
  @JvmStatic
  fun encodeQueryValue(value: String): String {
    return URLEncoder.encode(value, "UTF-8").replace("+", "%20")
  }

  internal fun warn(message: String) {
    try {
      Log.w(TAG, message)
    } catch (e: RuntimeException) {
      // android.util.Log is unavailable in plain JVM unit tests.
      System.err.println("W/$TAG: $message")
    }
  }
}
