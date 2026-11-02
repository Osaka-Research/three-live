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
 * Pure protocol validation, optimistic soft-lock lease resolution, and 3D peer avatar / laser
 * geometry helpers for `shared-room` (mirrors `xr-live/src/plugins/shared-room.ts`).
 */
object SharedRoom {
  const val MAX_PAYLOAD_BYTES: Int = 16384
  const val MAX_PEERS: Int = 16
  const val PEER_TIMEOUT_MS: Long = 5000L
  const val POSE_TICK_INTERVAL_MS: Long = 50L
  const val SOFT_LOCK_TTL_MS: Long = 2000L
  const val MAX_PEER_NAME_CHARS: Int = 32
  const val MAX_REMOTE_STROKES: Int = 64
  const val MAX_STROKE_CHUNK_POINTS: Int = 128
  const val DEFAULT_PEER_COLOR: String = "#38bdf8"

  private val HEX_COLOR = Regex("^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

  /** Optimistic soft-lock lease on a synchronized scene node. */
  data class NodeSoftLock(val ownerPeerId: String, val leaseUntilMs: Long)

  /** Validated `v: 1` room wire messages. */
  sealed class WireMessage(open val peerId: String) {
    data class Pose(
      override val peerId: String,
      val name: String,
      val color: String,
      val headPos: DoubleArray,
      val headQuat: DoubleArray,
      val rayOrigin: DoubleArray?,
      val rayEnd: DoubleArray?,
      val hasHit: Boolean,
    ) : WireMessage(peerId)

    data class Node(
      override val peerId: String,
      val nodeId: String,
      val p: DoubleArray,
      val q: DoubleArray,
      val s: DoubleArray,
      val grabState: String,
    ) : WireMessage(peerId)

    data class Explode(override val peerId: String, val factor: Double) : WireMessage(peerId)

    data class Paint(
      override val peerId: String,
      val strokeId: String,
      val color: String,
      val radius: Double,
      val points: List<DoubleArray>,
    ) : WireMessage(peerId)

    data class Leave(override val peerId: String) : WireMessage(peerId)
  }

  /** Accepts `wss://` endpoints or loopback `ws://localhost` / `ws://127.0.0.1` / `ws://[::1]`. */
  @JvmStatic
  fun isAllowedRoomUrl(raw: String?): Boolean {
    val trimmed = raw?.trim() ?: return false
    if (trimmed.isEmpty() || trimmed.length > 2048) return false
    return try {
      val uri = java.net.URI(trimmed)
      val scheme = uri.scheme?.lowercase() ?: return false
      val host = uri.host?.lowercase() ?: return false
      if (scheme == "wss") return host.isNotEmpty()
      scheme == "ws" && (host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1")
    } catch (_: Exception) {
      false
    }
  }

  /** Sanitizes an untrusted peer display name (plain text only, max 32 chars). */
  @JvmStatic
  fun sanitizePeerName(raw: String?): String {
    if (raw == null) return "Peer"
    val sb = StringBuilder(Math.min(raw.length, MAX_PEER_NAME_CHARS))
    for (ch in raw) {
      if (ch.code in 0x20..0x7E || ch.code > 0x7F) sb.append(ch)
    }
    val cleaned = sb.toString().trim()
    if (cleaned.isEmpty()) return "Peer"
    return if (cleaned.length > MAX_PEER_NAME_CHARS) cleaned.substring(0, MAX_PEER_NAME_CHARS) else cleaned
  }

  /** Sanitizes a `#rrggbb` / `#rgb` peer color string. */
  @JvmStatic
  fun sanitizePeerColor(raw: String?): String {
    val trimmed = raw?.trim() ?: return DEFAULT_PEER_COLOR
    val m = HEX_COLOR.matchEntire(trimmed) ?: return DEFAULT_PEER_COLOR
    val hex = m.groupValues[1].lowercase()
    return if (hex.length == 3) {
      "#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}"
    } else {
      "#$hex"
    }
  }

  /** Returns whether [candidatePeerId] may acquire or renew a soft-lock at [atMs]. */
  @JvmStatic
  fun canAcquireNodeLease(
    existing: NodeSoftLock?,
    candidatePeerId: String,
    atMs: Long,
  ): Boolean {
    if (existing == null) return true
    if (existing.ownerPeerId == candidatePeerId) return true
    return atMs >= existing.leaseUntilMs
  }

  private fun q4(v: Double): Double = Math.round(v * 10000.0) / 10000.0

  private fun parseBoundedVec3(raw: Any?, maxAbs: Double = 1000.0): DoubleArray? {
    val list = MiniJson.asList(raw) ?: return null
    if (list.size < 3) return null
    val out = DoubleArray(3)
    for (i in 0 until 3) {
      val n = (list[i] as? Number)?.toDouble() ?: return null
      if (!n.isFinite()) return null
      out[i] = q4(XRSpatialMath.clampNum(n, -maxAbs, maxAbs, 0.0))
    }
    return out
  }

  private fun parseUnitQuat(raw: Any?): DoubleArray? {
    val list = MiniJson.asList(raw) ?: return null
    if (list.size < 4) return null
    val q = DoubleArray(4)
    for (i in 0 until 4) {
      val n = (list[i] as? Number)?.toDouble() ?: return null
      if (!n.isFinite()) return null
      q[i] = n
    }
    val len = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
    if (!len.isFinite() || len < 1e-6) return null
    return doubleArrayOf(q4(q[0] / len), q4(q[1] / len), q4(q[2] / len), q4(q[3] / len))
  }

  /** Parses and validates an untrusted UTF-8 JSON room message, or returns `null`. */
  @JvmStatic
  fun parseMessage(rawJson: String?): WireMessage? {
    if (rawJson.isNullOrEmpty() || rawJson.length > MAX_PAYLOAD_BYTES) return null
    if (rawJson.toByteArray(Charsets.UTF_8).size > MAX_PAYLOAD_BYTES) return null
    val root = MiniJson.parseObjectOrNull(rawJson) ?: return null
    if ((root["v"] as? Number)?.toInt() != 1) return null
    val peerId = XRLiveSceneCoreHelper.safeAnchorId(root["peerId"] as? String) ?: return null
    return when (root["type"] as? String) {
      "pose" -> {
        val headPos = parseBoundedVec3(root["headPos"]) ?: return null
        val headQuat = parseUnitQuat(root["headQuat"]) ?: return null
        val ro = parseBoundedVec3(root["rayOrigin"])
        val re = parseBoundedVec3(root["rayEnd"])
        WireMessage.Pose(
          peerId = peerId,
          name = sanitizePeerName(root["name"] as? String),
          color = sanitizePeerColor(root["color"] as? String),
          headPos = headPos,
          headQuat = headQuat,
          rayOrigin = if (ro != null && re != null) ro else null,
          rayEnd = if (ro != null && re != null) re else null,
          hasHit = (root["hasHit"] == true) && ro != null && re != null,
        )
      }
      "node" -> {
        val nodeId = XRLiveSceneCoreHelper.safeAnchorId(root["nodeId"] as? String) ?: return null
        val p = parseBoundedVec3(root["p"]) ?: return null
        val q = parseUnitQuat(root["q"]) ?: return null
        val sList = MiniJson.asList(root["s"]) ?: return null
        if (sList.size < 3) return null
        val s = DoubleArray(3)
        for (i in 0 until 3) {
          val n = (sList[i] as? Number)?.toDouble() ?: return null
          if (!n.isFinite()) return null
          s[i] = n
        }
        val clean = PersistentAnchors.sanitizePose(p, q, s) ?: return null
        val gsRaw = root["grabState"] as? String
        val gs = if (gsRaw == "grab" || gsRaw == "release") gsRaw else "move"
        WireMessage.Node(peerId, nodeId, clean.p, clean.q, clean.s, gs)
      }
      "explode" -> {
        val f = (root["factor"] as? Number)?.toDouble() ?: return null
        if (!f.isFinite()) return null
        WireMessage.Explode(peerId, q4(XRSpatialMath.clampNum(f, 0.0, 1.0, 0.0)))
      }
      "paint" -> {
        val strokeId = XRLiveSceneCoreHelper.safeAnchorId(root["strokeId"] as? String) ?: return null
        val ptsRaw = MiniJson.asList(root["points"]) ?: return null
        if (ptsRaw.size < 2 || ptsRaw.size > MAX_STROKE_CHUNK_POINTS) return null
        val pts = ArrayList<DoubleArray>(ptsRaw.size)
        for (item in ptsRaw) {
          val pt = parseBoundedVec3(item) ?: return null
          pts.add(pt)
        }
        WireMessage.Paint(
          peerId = peerId,
          strokeId = strokeId,
          color = sanitizePeerColor(root["color"] as? String),
          radius = XRSpatialMath.clampNum((root["radius"] as? Number)?.toDouble() ?: Double.NaN, 0.002, 0.1, 0.01),
          points = pts,
        )
      }
      "leave" -> WireMessage.Leave(peerId)
      else -> null
    }
  }

  /** Serializes a validated [WireMessage] to compact UTF-8 JSON. */
  @JvmStatic
  fun serializeMessage(msg: WireMessage): String {
    val map = LinkedHashMap<String, Any?>()
    map["v"] = 1
    when (msg) {
      is WireMessage.Pose -> {
        map["type"] = "pose"
        map["peerId"] = msg.peerId
        map["name"] = sanitizePeerName(msg.name)
        map["color"] = sanitizePeerColor(msg.color)
        map["headPos"] = msg.headPos.map(::q4)
        map["headQuat"] = msg.headQuat.map(::q4)
        map["rayOrigin"] = msg.rayOrigin?.map(::q4)
        map["rayEnd"] = msg.rayEnd?.map(::q4)
        map["hasHit"] = msg.hasHit && msg.rayOrigin != null && msg.rayEnd != null
      }
      is WireMessage.Node -> {
        map["type"] = "node"
        map["peerId"] = msg.peerId
        map["nodeId"] = msg.nodeId
        map["p"] = msg.p.map(::q4)
        map["q"] = msg.q.map(::q4)
        map["s"] = msg.s.map(::q4)
        map["grabState"] = msg.grabState
      }
      is WireMessage.Explode -> {
        map["type"] = "explode"
        map["peerId"] = msg.peerId
        map["factor"] = q4(XRSpatialMath.clampNum(msg.factor, 0.0, 1.0, 0.0))
      }
      is WireMessage.Paint -> {
        map["type"] = "paint"
        map["peerId"] = msg.peerId
        map["strokeId"] = msg.strokeId
        map["color"] = sanitizePeerColor(msg.color)
        map["radius"] = q4(msg.radius)
        map["points"] = msg.points.map { pt -> pt.map(::q4) }
      }
      is WireMessage.Leave -> {
        map["type"] = "leave"
        map["peerId"] = msg.peerId
      }
    }
    return MiniJson.stringify(map)
  }

  /** Builds a stylized visor box (`0.20m × 0.085m × 0.11m`) for remote peer avatars. */
  @JvmStatic
  fun buildPeerVisorGeometry(): SpatialMeasure.MeshGeometry {
    val hx = 0.10f
    val hy = 0.0425f
    val hz = 0.055f
    val faces =
      arrayOf(
        arrayOf(floatArrayOf(1f, 0f, 0f), floatArrayOf(0f, 1f, 0f), floatArrayOf(0f, 0f, 1f)),
        arrayOf(floatArrayOf(-1f, 0f, 0f), floatArrayOf(0f, 1f, 0f), floatArrayOf(0f, 0f, -1f)),
        arrayOf(floatArrayOf(0f, 1f, 0f), floatArrayOf(0f, 0f, 1f), floatArrayOf(1f, 0f, 0f)),
        arrayOf(floatArrayOf(0f, -1f, 0f), floatArrayOf(0f, 0f, -1f), floatArrayOf(1f, 0f, 0f)),
        arrayOf(floatArrayOf(0f, 0f, 1f), floatArrayOf(1f, 0f, 0f), floatArrayOf(0f, 1f, 0f)),
        arrayOf(floatArrayOf(0f, 0f, -1f), floatArrayOf(-1f, 0f, 0f), floatArrayOf(0f, 1f, 0f)),
      )
    val corners =
      arrayOf(
        floatArrayOf(-1f, -1f),
        floatArrayOf(1f, -1f),
        floatArrayOf(1f, 1f),
        floatArrayOf(-1f, 1f),
      )
    val half = floatArrayOf(hx, hy, hz)
    val positions = FloatArray(24 * 3)
    val normals = FloatArray(24 * 3)
    val indices = IntArray(36)
    for (f in faces.indices) {
      val n = faces[f][0]
      val u = faces[f][1]
      val v = faces[f][2]
      for (c in corners.indices) {
        val a = corners[c][0]
        val b = corners[c][1]
        val o = (f * 4 + c) * 3
        for (k in 0..2) {
          positions[o + k] = (n[k] + u[k] * a + v[k] * b) * half[k]
          normals[o + k] = n[k]
        }
      }
      val base = f * 4
      val io = f * 6
      indices[io] = base
      indices[io + 1] = base + 1
      indices[io + 2] = base + 2
      indices[io + 3] = base
      indices[io + 4] = base + 2
      indices[io + 5] = base + 3
    }
    return SpatialMeasure.MeshGeometry(positions, normals, indices)
  }

  /** Builds a pointer laser bar (plus optional hit cube) for a remote peer. */
  @JvmStatic
  fun buildPeerLaserGeometry(
    origin: DoubleArray,
    end: DoubleArray,
    hasHit: Boolean,
  ): SpatialMeasure.MeshGeometry {
    if (XRSpatialMath.dist3(origin, end) < 1e-4) {
      return SpatialMeasure.MeshGeometry(FloatArray(0), FloatArray(0), IntArray(0))
    }
    val bar = SpatialMeasure.buildSegmentBarsGeometry(listOf(origin to end), 0.003)
    if (!hasHit) return bar
    val tipStart = doubleArrayOf(end[0], end[1] - 0.012, end[2])
    val tipEnd = doubleArrayOf(end[0], end[1] + 0.012, end[2])
    return SpatialMeasure.buildSegmentBarsGeometry(
      listOf(origin to end, tipStart to tipEnd),
      0.004,
    )
  }
}
