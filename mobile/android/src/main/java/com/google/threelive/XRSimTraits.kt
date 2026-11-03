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

/** Normalized `character` trait (`character-controller`). */
data class XRCharacterTrait(
  val speed: Double = 4.0,
  val runMultiplier: Double = 1.6,
  val jumpVelocity: Double = 5.5,
  val gravity: Double = 15.0,
  val radius: Double = 0.35,
  val height: Double = 1.4,
  val cameraMode: String = "third-person",
  val cameraDistance: Double = 3.5,
  val cameraHeight: Double = 1.8,
  /** Clip names keyed by `idle`, `walk`, `run`, `jump`. */
  val clips: Map<String, String> = emptyMap(),
)

/** Normalized `agent` trait (`steering-agents`). */
data class XRAgentTrait(
  val mode: String = "wander",
  /** Node name, [XRSimTraits.AGENT_TARGET_USER], or `""`. */
  val target: String = "",
  val speed: Double = 2.0,
  val turnSpeed: Double = 6.0,
  val sightRadius: Double = 6.0,
  val stopDistance: Double = 0.6,
  val separationRadius: Double = 0.8,
  val waypoints: List<DoubleArray> = emptyList(),
  val loopWaypoints: Boolean = true,
)

/** Normalized `integrity` trait (`hit-zones`). */
data class XRIntegrityTrait(
  val max: Double = 100.0,
  val current: Double = 100.0,
  val group: String = "neutral",
  val showBar: Boolean = false,
  val cooldownMs: Double = 250.0,
  val hideOnDepleted: Boolean = true,
  val scoreValue: Double = 0.0,
  val contactAmount: Double = 0.0,
)

/** Normalized `zone` trait (`hit-zones`). */
data class XRZoneTrait(
  val shape: String = "box",
  val size: DoubleArray = doubleArrayOf(1.0, 1.0, 1.0),
  val radius: Double = 0.5,
  val watchGroups: List<String> = emptyList(),
  /** Outline color, or `null` when the zone is hidden. */
  val color: String? = null,
) {
  override fun equals(other: Any?): Boolean =
    other is XRZoneTrait &&
      shape == other.shape &&
      size.contentEquals(other.size) &&
      radius == other.radius &&
      watchGroups == other.watchGroups &&
      color == other.color

  override fun hashCode(): Int =
    listOf(shape, size.contentHashCode(), radius, watchGroups, color).hashCode()
}

/** Normalized `spawner` trait (`hit-zones`). */
data class XRSpawnerTrait(
  val template: String,
  val intervalSec: Double = 3.0,
  val maxActive: Int = 8,
  /** `0` is unlimited. */
  val totalCount: Int = 0,
  val spawnRadius: Double = 0.0,
)

/** Normalized `objective` trait (`objectives`). */
data class XRObjectiveTrait(
  val type: String = "pickup",
  val amount: Double = 10.0,
  val tag: String = "",
  val radius: Double = 0.65,
  val required: Boolean = false,
  val order: Int = 0,
  val spinSpeed: Double = 2.5,
  val bobAmplitude: Double = 0.08,
  val respawnSec: Double = 0.0,
)

/** Normalized `audioCues` trait (`synth-audio`). */
data class XRAudioCuesTrait(
  /** Cue names keyed by event (`onTap`, `onHit`, ...). */
  val cues: Map<String, String>,
  val pitchJitter: Double = 0.08,
  val volume: Double = 1.0,
  val spatial: Boolean = true,
)

/**
 * The `xr-live-sim` traits of one node, parsed from glTF `extras.xr` with the same clamps as
 * `three-live/src/xr-sim-schema.ts` and `XRSimTraits.swift`.
 */
data class XRSimTraits(
  val character: XRCharacterTrait? = null,
  val agent: XRAgentTrait? = null,
  val integrity: XRIntegrityTrait? = null,
  val zone: XRZoneTrait? = null,
  val spawner: XRSpawnerTrait? = null,
  val objective: XRObjectiveTrait? = null,
  val audioCues: XRAudioCuesTrait? = null,
  val collidable: Boolean = false,
) {
  val isEmpty: Boolean
    get() =
      character == null &&
        agent == null &&
        integrity == null &&
        zone == null &&
        spawner == null &&
        objective == null &&
        audioCues == null &&
        !collidable

  companion object {
    const val AGENT_TARGET_USER = "user"
    const val MAX_AGENT_WAYPOINTS = 32
    const val MAX_ZONE_WATCH_GROUPS = 16
    const val MAX_SPAWNER_ACTIVE = 32

    val CAMERA_MODES = listOf("third-person", "first-person", "top-down", "fixed")
    val CLIP_STATES = listOf("idle", "walk", "run", "jump")
    val AGENT_MODES = listOf("patrol", "chase", "flee", "wander", "follow")
    val OBJECTIVE_TYPES = listOf("pickup", "checkpoint", "time-bonus", "restore", "key")
    val AUDIO_CUES =
      listOf(
        "confirm",
        "error",
        "alarm",
        "warning",
        "pickup",
        "jump",
        "beam",
        "impact",
        "burst",
        "powerup",
        "step",
        "pass",
        "fail",
      )
    val AUDIO_CUE_EVENTS =
      listOf(
        "onTap",
        "onObjective",
        "onHit",
        "onDepleted",
        "onZoneEnter",
        "onZoneExit",
        "onSpawn",
        "onJump",
        "onLand",
      )
    private val FORBIDDEN_IDS = setOf("__proto__", "constructor", "prototype")
    private val SIM_ID = Regex("^[A-Za-z0-9_.:-]{1,64}$")

    private fun num(v: Any?, lo: Double, hi: Double, fallback: Double): Double =
      XRLiveSceneCoreHelper.clampNum(v, lo, hi, fallback)

    private fun record(raw: Any?): Map<String, Any?>? = MiniJson.asMap(raw)

    private fun shortString(v: Any?, max: Int): String? =
      (v as? String)?.takeIf { it.isNotEmpty() }?.take(max)

    private fun oneOf(raw: Any?, allowed: List<String>, fallback: String): String =
      (raw as? String)?.takeIf { it in allowed } ?: fallback

    private fun vec3(raw: Any?): DoubleArray? {
      val l = MiniJson.asList(raw) ?: return null
      if (l.size < 3) return null
      val out = DoubleArray(3) { (l[it] as? Number)?.toDouble() ?: Double.NaN }
      return if (out.all { it.isFinite() }) out else null
    }

    /** Sanitizes a group / tag id: 1-64 chars of `[A-Za-z0-9_.:-]`. */
    @JvmStatic
    fun safeSimId(raw: Any?): String? {
      val s = (raw as? String)?.trim() ?: return null
      return if (SIM_ID.matches(s) && s !in FORBIDDEN_IDS) s else null
    }

    @JvmStatic
    fun parseCharacter(raw: Any?): XRCharacterTrait? {
      if (raw == null || raw == false) return null
      val r = record(raw) ?: if (raw is String) mapOf("cameraMode" to raw) else emptyMap()
      if (r["enabled"] == false) return null
      val radius = num(r["radius"], 0.05, 5.0, 0.35)
      val clipsRaw = record(r["clips"]) ?: emptyMap()
      val clips = LinkedHashMap<String, String>()
      for (state in CLIP_STATES) shortString(clipsRaw[state], 128)?.let { clips[state] = it }
      return XRCharacterTrait(
        speed = num(r["speed"], 0.1, 20.0, 4.0),
        runMultiplier = num(r["runMultiplier"], 1.0, 4.0, 1.6),
        jumpVelocity = num(r["jumpVelocity"], 0.0, 30.0, 5.5),
        gravity = num(r["gravity"], 0.0, 50.0, 15.0),
        radius = radius,
        height = num(r["height"], radius * 2, 10.0, Math.max(1.4, radius * 2)),
        cameraMode = oneOf(r["cameraMode"], CAMERA_MODES, "third-person"),
        cameraDistance = num(r["cameraDistance"], 0.5, 50.0, 3.5),
        cameraHeight = num(r["cameraHeight"], -10.0, 50.0, 1.8),
        clips = clips,
      )
    }

    @JvmStatic
    fun parseAgent(raw: Any?): XRAgentTrait? {
      if (raw == null || raw == false || raw == "") return null
      val r = record(raw) ?: if (raw is String) mapOf("mode" to raw) else emptyMap()
      if (r["enabled"] == false) return null
      val mode = oneOf(r["mode"], AGENT_MODES, "wander")
      val t = r["target"]
      var target =
        if (t == "camera" || t == AGENT_TARGET_USER) AGENT_TARGET_USER
        else shortString(t, 256) ?: ""
      if (target.isEmpty() && (mode == "chase" || mode == "flee" || mode == "follow")) {
        target = AGENT_TARGET_USER
      }
      val coord = { v: Double -> num(v, -1e4, 1e4, 0.0) }
      val waypoints =
        (MiniJson.asList(r["waypoints"]) ?: emptyList())
          .mapNotNull { vec3(it) }
          .take(MAX_AGENT_WAYPOINTS)
          .map { doubleArrayOf(coord(it[0]), coord(it[1]), coord(it[2])) }
      return XRAgentTrait(
        mode = mode,
        target = target,
        speed = num(r["speed"], 0.1, 20.0, 2.0),
        turnSpeed = num(r["turnSpeed"], 0.1, 50.0, 6.0),
        sightRadius = num(r["sightRadius"], 0.0, 100.0, 6.0),
        stopDistance = num(r["stopDistance"], 0.01, 10.0, 0.6),
        separationRadius = num(r["separationRadius"], 0.0, 10.0, 0.8),
        waypoints = waypoints,
        loopWaypoints = r["loopWaypoints"] != false,
      )
    }

    @JvmStatic
    fun parseIntegrity(raw: Any?): XRIntegrityTrait? {
      if (raw == null || raw == false) return null
      if (raw is Number && (raw.toDouble() == 0.0 || raw.toDouble().isNaN())) return null
      val r = record(raw) ?: if (raw is Number) mapOf("max" to raw) else emptyMap()
      if (r["enabled"] == false) return null
      val max = num(r["max"], 1.0, 1e6, 100.0)
      return XRIntegrityTrait(
        max = max,
        current = num(r["current"], 0.0, max, max),
        group = safeSimId(r["group"]) ?: "neutral",
        showBar = r["showBar"] == true,
        cooldownMs = Math.round(num(r["cooldownMs"], 0.0, 10000.0, 250.0)).toDouble(),
        hideOnDepleted = r["hideOnDepleted"] != false,
        scoreValue = num(r["scoreValue"], -1e6, 1e6, 0.0),
        contactAmount = num(r["contactAmount"], 0.0, 1e6, 0.0),
      )
    }

    @JvmStatic
    fun parseZone(raw: Any?): XRZoneTrait? {
      if (raw == null || raw == false) return null
      val r = record(raw) ?: if (raw is String) mapOf("shape" to raw) else emptyMap()
      if (r["enabled"] == false) return null
      val shape = oneOf(r["shape"], listOf("box", "sphere"), "box")
      val s = r["size"]
      val side = { v: Any? -> num(v, 0.01, 1000.0, 1.0) }
      val sv = vec3(s)
      val size =
        when {
          sv != null -> doubleArrayOf(side(sv[0]), side(sv[1]), side(sv[2]))
          s is Number -> DoubleArray(3) { side(s) }
          else -> doubleArrayOf(1.0, 1.0, 1.0)
        }
      val radius = num(r["radius"] ?: (s as? Number), 0.01, 1000.0, 0.5)
      val wg = r["watchGroups"]
      val groups =
        ((MiniJson.asList(wg) ?: if (wg == null) emptyList() else listOf(wg)).mapNotNull {
            safeSimId(it)
          })
          .distinct()
          .take(MAX_ZONE_WATCH_GROUPS)
      val color = XRLiveSceneCoreHelper.safeHexColor(r["color"], "").ifEmpty { null }
      return XRZoneTrait(shape, size, radius, groups, color)
    }

    @JvmStatic
    fun parseSpawner(raw: Any?): XRSpawnerTrait? {
      val r = record(raw) ?: (raw as? String)?.let { mapOf("template" to it) } ?: return null
      val template = shortString(r["template"], 256)?.trim()
      if (template.isNullOrEmpty() || r["enabled"] == false) return null
      return XRSpawnerTrait(
        template = template,
        intervalSec = num(r["intervalSec"], 0.05, 3600.0, 3.0),
        maxActive =
          Math.round(num(r["maxActive"], 1.0, MAX_SPAWNER_ACTIVE.toDouble(), 8.0)).toInt(),
        totalCount = Math.round(num(r["totalCount"], 0.0, 10000.0, 0.0)).toInt(),
        spawnRadius = num(r["spawnRadius"], 0.0, 100.0, 0.0),
      )
    }

    @JvmStatic
    fun parseObjective(raw: Any?): XRObjectiveTrait? {
      if (raw == null || raw == false || raw == "") return null
      val r = record(raw) ?: if (raw is String) mapOf("type" to raw) else emptyMap()
      if (r["enabled"] == false) return null
      val type = oneOf(r["type"], OBJECTIVE_TYPES, "pickup")
      val animated = type == "pickup"
      return XRObjectiveTrait(
        type = type,
        amount = num(r["amount"] ?: r["points"], -1e6, 1e6, 10.0),
        tag = safeSimId(r["tag"]) ?: "",
        radius = num(r["radius"], 0.05, 50.0, 0.65),
        required = r["required"] == true,
        order = Math.round(num(r["order"], 0.0, 1000.0, 0.0)).toInt(),
        spinSpeed = num(r["spinSpeed"], -50.0, 50.0, if (animated) 2.5 else 0.0),
        bobAmplitude = num(r["bobAmplitude"], 0.0, 5.0, if (animated) 0.08 else 0.0),
        respawnSec = num(r["respawnSec"], 0.0, 3600.0, 0.0),
      )
    }

    @JvmStatic
    fun parseAudioCues(raw: Any?): XRAudioCuesTrait? {
      val r = record(raw) ?: return null
      val cues = LinkedHashMap<String, String>()
      for (ev in AUDIO_CUE_EVENTS) {
        val cue = r[ev] as? String
        if (cue != null && cue in AUDIO_CUES) cues[ev] = cue
      }
      if (cues.isEmpty()) return null
      return XRAudioCuesTrait(
        cues = cues,
        pitchJitter = num(r["pitchJitter"], 0.0, 0.5, 0.08),
        volume = num(r["volume"], 0.0, 1.0, 1.0),
        spatial = r["spatial"] != false,
      )
    }

    /** Parses the sim traits of a `userData.xr` / `extras.xr` bag, or `null` when none. */
    @JvmStatic
    fun parse(raw: Any?): XRSimTraits? {
      val r = record(raw) ?: return null
      val t =
        XRSimTraits(
          character = parseCharacter(r["character"]),
          agent = parseAgent(r["agent"]),
          integrity = parseIntegrity(r["integrity"]),
          zone = parseZone(r["zone"]),
          spawner = parseSpawner(r["spawner"]),
          objective = parseObjective(r["objective"]),
          audioCues = parseAudioCues(r["audioCues"]),
          collidable = r["collidable"] == true,
        )
      return if (t.isEmpty) null else t
    }

    /** Parses the sim traits of every node of a glTF root (`null` entries for none). */
    @JvmStatic
    fun parseNodes(gltfRoot: Map<String, Any?>): List<XRSimTraits?> =
      (MiniJson.asList(gltfRoot["nodes"]) ?: emptyList()).map { n ->
        parse(MiniJson.asMap(MiniJson.asMap(n)?.get("extras"))?.get("xr"))
      }
  }
}
