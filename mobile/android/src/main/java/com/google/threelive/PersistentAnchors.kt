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

/**
 * Pure serialization, sanitization, and URL-hash codec for `persistent-anchors` (port of
 * `xr-live/src/plugins/persistent-anchors.ts`).
 */
object PersistentAnchors {

  const val MAX_PERSISTED_NODES: Int = 128
  const val MAX_HASH_BYTES: Int = 8192
  const val ANCHOR_STORAGE_PREFIX: String = "xr-live:anchors:"
  private val B64URL_REGEX = Regex("^[A-Za-z0-9_-]+$")
  private val HASH_STATE_REGEX = Regex("(?:^|[&#])xr-state=([A-Za-z0-9_-]*)")

  /** Validated, quantized transform record for one persisted node. */
  data class PersistedPose(
    val p: DoubleArray,
    val q: DoubleArray,
    val s: DoubleArray,
    val xrAnchorUuid: String? = null,
  ) {
    override fun equals(other: Any?): Boolean {
      if (this === other) return true
      if (other !is PersistedPose) return false
      return p.contentEquals(other.p) &&
        q.contentEquals(other.q) &&
        s.contentEquals(other.s) &&
        xrAnchorUuid == other.xrAnchorUuid
    }

    override fun hashCode(): Int {
      var res = p.contentHashCode()
      res = 31 * res + q.contentHashCode()
      res = 31 * res + s.contentHashCode()
      res = 31 * res + (xrAnchorUuid?.hashCode() ?: 0)
      return res
    }
  }

  private fun round4(n: Double): Double = Math.round(n * 10000.0) / 10000.0

  /**
   * Validates and clamps an untrusted persisted pose record. Returns `null` if any coordinate,
   * quaternion component, or scale component is non-finite or degenerate.
   */
  @JvmStatic
  fun sanitizePose(
    p: DoubleArray?,
    q: DoubleArray?,
    s: DoubleArray?,
    xrAnchorUuid: String? = null,
  ): PersistedPose? {
    if (p == null || p.size < 3 || q == null || q.size < 4 || s == null || s.size < 3) return null
    for (i in 0 until 3) {
      if (!p[i].isFinite() || !s[i].isFinite()) return null
    }
    for (i in 0 until 4) {
      if (!q[i].isFinite()) return null
    }
    val qLen = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    if (!qLen.isFinite() || qLen < 1e-6) return null

    val sp =
      doubleArrayOf(
        round4(XRSpatialMath.clampNum(p[0], -1000.0, 1000.0, 0.0)),
        round4(XRSpatialMath.clampNum(p[1], -1000.0, 1000.0, 0.0)),
        round4(XRSpatialMath.clampNum(p[2], -1000.0, 1000.0, 0.0)),
      )
    val sq =
      doubleArrayOf(
        round4(q[0] / qLen),
        round4(q[1] / qLen),
        round4(q[2] / qLen),
        round4(q[3] / qLen),
      )
    val ss =
      doubleArrayOf(
        round4(XRSpatialMath.clampNum(s[0], 0.001, 1000.0, 1.0)),
        round4(XRSpatialMath.clampNum(s[1], 0.001, 1000.0, 1.0)),
        round4(XRSpatialMath.clampNum(s[2], 0.001, 1000.0, 1.0)),
      )
    val cleanUuid = XRLiveSceneCoreHelper.safeAnchorId(xrAnchorUuid)
    return PersistedPose(sp, sq, ss, cleanUuid)
  }

  private fun parseNumArray(raw: Any?, expectedLen: Int): DoubleArray? {
    val list = MiniJson.asList(raw) ?: return null
    if (list.size < expectedLen) return null
    val out = DoubleArray(expectedLen)
    for (i in 0 until expectedLen) {
      val d = MiniJson.asFiniteDouble(list[i]) ?: return null
      out[i] = d
    }
    return out
  }

  /** Serializes a validated node pose map into a compact JSON string. */
  @JvmStatic
  @JvmOverloads
  fun serializePayload(
    poses: Map<String, PersistedPose>,
    updatedAt: Long = System.currentTimeMillis(),
  ): String {
    val nodes = LinkedHashMap<String, Any?>()
    for ((rawKey, pose) in poses) {
      if (nodes.size >= MAX_PERSISTED_NODES) break
      val key = XRLiveSceneCoreHelper.safeAnchorId(rawKey) ?: continue
      val clean = sanitizePose(pose.p, pose.q, pose.s, pose.xrAnchorUuid) ?: continue
      val entry = LinkedHashMap<String, Any?>()
      entry["p"] = clean.p
      entry["q"] = clean.q
      entry["s"] = clean.s
      if (clean.xrAnchorUuid != null) entry["xrAnchorUuid"] = clean.xrAnchorUuid
      nodes[key] = entry
    }
    val root = LinkedHashMap<String, Any?>()
    root["version"] = 1
    root["updatedAt"] = updatedAt
    root["nodes"] = nodes
    return MiniJson.stringify(root)
  }

  /** Parses and sanitizes a JSON payload from storage or decoded URL hash. */
  @JvmStatic
  fun deserializePayload(jsonText: String?): Map<String, PersistedPose>? {
    if (jsonText.isNullOrEmpty() || jsonText.length > MAX_HASH_BYTES * 2) return null
    val root = MiniJson.parseObjectOrNull(jsonText) ?: return null
    val ver = root["version"]
    if (ver != null && (ver !is Number || ver.toDouble() != 1.0)) return null
    val rawNodes = MiniJson.asMap(root["nodes"]) ?: return null
    val out = LinkedHashMap<String, PersistedPose>()
    for ((rawKey, rawVal) in rawNodes) {
      if (out.size >= MAX_PERSISTED_NODES) break
      val key = XRLiveSceneCoreHelper.safeAnchorId(rawKey) ?: continue
      val obj = MiniJson.asMap(rawVal) ?: return null
      val p = parseNumArray(obj["p"], 3) ?: return null
      val q = parseNumArray(obj["q"], 4) ?: return null
      val s = parseNumArray(obj["s"], 3) ?: return null
      val uuid = obj["xrAnchorUuid"] as? String
      val clean = sanitizePose(p, q, s, uuid) ?: return null
      out[key] = clean
    }
    return out
  }

  /** Encodes a node pose map into a compact base64url token suitable for `#xr-state=`. */
  @JvmStatic
  @JvmOverloads
  fun encodeState(
    poses: Map<String, PersistedPose>,
    updatedAt: Long = System.currentTimeMillis(),
  ): String {
    val utf8 = serializePayload(poses, updatedAt).toByteArray(Charsets.UTF_8)
    return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(utf8)
  }

  /** Decodes and validates a compact base64url token from `#xr-state=`. */
  @JvmStatic
  fun decodeState(token: String?): Map<String, PersistedPose>? {
    if (token.isNullOrEmpty() || token.length > MAX_HASH_BYTES) return null
    if (!B64URL_REGEX.matches(token)) return null
    val json =
      try {
        String(java.util.Base64.getUrlDecoder().decode(token), Charsets.UTF_8)
      } catch (_: IllegalArgumentException) {
        return null
      }
    return deserializePayload(json)
  }

  /** Extracts the `xr-state` token from a URL fragment string (e.g. `"#foo=1&xr-state=abc"`). */
  @JvmStatic
  fun extractHashToken(hash: String?): String? {
    if (hash.isNullOrEmpty()) return null
    val token = HASH_STATE_REGEX.find(hash)?.groupValues?.getOrNull(1) ?: return null
    if (token.isEmpty() || token.length > MAX_HASH_BYTES) return null
    return token
  }

  /** Injects or clears `xr-state=<token>` in a URL fragment while preserving other params. */
  @JvmStatic
  fun injectHashToken(existingHash: String?, token: String?): String {
    val clean = (existingHash ?: "").removePrefix("#")
    val parts =
      clean
        .split('&')
        .filter { it.isNotEmpty() && !it.startsWith("xr-state=") }
        .toMutableList()
    if (!token.isNullOrEmpty() && token.length <= MAX_HASH_BYTES) {
      parts.add("xr-state=$token")
    }
    return if (parts.isEmpty()) "" else "#${parts.joinToString("&")}"
  }
}
