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

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.StandardCharsets

/** Normalized `orbit` trait (see `parseOrbit()` in `xr-trait-schema.ts`). */
data class XROrbitTrait(
  /** Named target node (or `"head"`), or `null` when [targetPosition] is used. */
  val targetName: String? = null,
  /** Literal scene-space orbit center, used when [targetName] is `null`. */
  val targetPosition: List<Double> = listOf(0.0, 0.0, 0.0),
  val radius: Double = 0.5,
  /** Angular speed in radians per second. */
  val speed: Double = 0.5,
  val height: Double = 0.0,
  val phase: Double = 0.0,
  val faceCenter: Boolean = false,
)

/** Normalized manipulation `handles` trait. */
data class XRHandlesTrait(
  /** `"y"` (pedestal yaw handle enabled) or `"none"`. */
  val rotateAxis: String = "y",
  val minScale: Double = 0.1,
  val maxScale: Double = 10.0,
)

/** Normalized `particles` trait. */
data class XRParticlesTrait(
  /** One of `rain`, `snow`, `sparks`, `confetti`. */
  val preset: String = "rain",
  val count: Int = 600,
  /** Emitter volume size (x, y, z) in meters. */
  val area: List<Double> = listOf(2.0, 2.0, 2.0),
  val speed: Double = 1.0,
)

/** Normalized `holdToAsk` trait. */
data class XRHoldToAskTrait(val prompt: String = "What is this?", val holdMs: Double = 600.0)

/** Normalized `worldUnderstanding` trait. */
data class XRWorldUnderstandingTrait(
  val planes: Boolean = true,
  val meshes: Boolean = false,
  val reticle: Boolean = false,
  val objects: Boolean = false,
)

/** Normalized spatial `audio` trait. */
data class XRSpatialAudioTrait(
  val src: String,
  val refDistance: Double = 1.0,
  val loop: Boolean = false,
)

/** Normalized `dimensions` trait (`spatial-measure`). */
data class XRDimensionsTrait(
  val enabled: Boolean = true,
  /** One of `m`, `cm`, `mm`, `in`, `ft-in`, `auto`. */
  val unit: String = "auto",
  /** Subset of `["x", "y", "z"]` in canonical order. */
  val axes: List<String> = listOf("x", "y", "z"),
  val color: String = "#38bdf8",
  val showOnSelect: Boolean = false,
)

/** Normalized `snapTo` trait (`magnetic-snap`). */
data class XRSnapToTrait(
  /** Cartesian grid step `(x, y, z)` in meters, or `null` when grid snapping is disabled. */
  val grid: List<Double>? = null,
  val angleDeg: Double = 0.0,
  /** One of `none`, `floor`, `wall`, `ceiling`, `any`. */
  val surface: String = "none",
  val socketTag: String = "",
  val radius: Double = 0.15,
)

/** Normalized `snapSocket` trait (`magnetic-snap`). */
data class XRSnapSocketTrait(
  val tag: String,
  val radius: Double = 0.15,
  val alignRotation: Boolean = true,
  val highlightColor: String = "#22c55e",
)

/** Normalized lazy-follow spatial options (see `parseLazyFollow()` in `xr-trait-schema.ts`). */
data class XRLazyFollowOptions(
  /** `head`, `hand-left` or `hand-right`. */
  val mode: String = "head",
  val distance: Double = 1.0,
  val deadzoneDeg: Double = 15.0,
  val stiffness: Double = 6.0,
  val height: Double = -0.1,
  val faceUser: Boolean = true,
  val snapOnStart: Boolean = true,
)

/**
 * Declarative spatial traits parsed from a compiled `.glb` node's `extras.xr` and
 * `extensions.ANDROID_xr_scenecore` metadata.
 *
 * All numeric values are clamped exactly as `normalizeXRTraits()` in
 * `three-live/src/xr-trait-schema.ts` does, so a scene behaves identically on every platform.
 */
data class XRLiveNodeTraits(
  val nodeIndex: Int,
  val name: String,
  val grabbable: Boolean = false,
  val scalable: Boolean = false,
  val billboard: String? = null,
  val anchor: String? = null,
  /** Follow anchor (`head`, `hand-left`, `hand-right`) for both eager and lazy follows. */
  val follow: String? = null,
  val physics: String? = null,
  /** `1-hand` or `2-hand` when grabbable. */
  val grabMode: String? = null,
  /** Uniform scale limits from the `scale` trait (web `XRTraitSystem` defaults when absent). */
  val minScale: Double = 0.05,
  val maxScale: Double = 5.0,
  /** `true` for object-valued (lazy HUD) follows; eager string follows are `false`. */
  val followLazy: Boolean = false,
  val followDistance: Double = 1.0,
  val followDeadzoneDeg: Double = 15.0,
  val followStiffness: Double = 6.0,
  val followHeight: Double = -0.1,
  val followFaceUser: Boolean = true,
  val followSnapOnStart: Boolean = true,
  val orbit: XROrbitTrait? = null,
  val handles: XRHandlesTrait? = null,
  val particles: XRParticlesTrait? = null,
  val holdToAsk: XRHoldToAskTrait? = null,
  val worldUnderstanding: XRWorldUnderstandingTrait? = null,
  val splatUrl: String? = null,
  val spatialSlot: String? = null,
  val audio: XRSpatialAudioTrait? = null,
  val dimensions: XRDimensionsTrait? = null,
  val snapTo: XRSnapToTrait? = null,
  val snapSocket: XRSnapSocketTrait? = null,
  /** `"none"` when the node must not receive pointer events. */
  val pointerEvents: String? = null,
) {
  /** Binary-compatible constructor matching the original 8-parameter signature. */
  constructor(
    nodeIndex: Int,
    name: String,
    grabbable: Boolean,
    scalable: Boolean,
    billboard: String?,
    anchor: String?,
    follow: String?,
    physics: String?,
  ) : this(nodeIndex, name, grabbable, scalable, billboard, anchor, follow, physics, grabMode = null)

  /** Lazy-follow options when [followLazy] is set, otherwise `null`. */
  val lazyFollow: XRLazyFollowOptions?
    get() =
      if (!followLazy || follow == null) {
        null
      } else {
        XRLazyFollowOptions(
          mode = follow,
          distance = followDistance,
          deadzoneDeg = followDeadzoneDeg,
          stiffness = followStiffness,
          height = followHeight,
          faceUser = followFaceUser,
          snapOnStart = followSnapOnStart,
        )
      }
}

/**
 * Callback interface for attaching native Android XR Jetpack SceneCore (`androidx.xr.scenecore`) or
 * Filament components (`MovableComponent`, `AnchorEntity`, etc.) to loaded entities.
 *
 * Every hook has an empty default body so implementations only override what they support.
 */
interface SceneCoreComponentApplier<EntityT> {
  fun onAttachMovable(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachAnchor(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachBillboard(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachPhysics(entity: EntityT, node: XRLiveNodeTraits) {}

  /** Manipulation handles (`ResizableComponent`); see [XRLiveNodeTraits.handles]. */
  fun onAttachResizable(entity: EntityT, node: XRLiveNodeTraits) {}

  /** Eager (string) or lazy (object) follow; see [XRLiveNodeTraits.followLazy]. */
  fun onAttachFollow(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachOrbit(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachParticles(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachHoldToAsk(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachWorldUnderstanding(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachSplat(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachSpatialPanel(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachSpatialAudio(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachDimensions(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachSnapTo(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachSnapSocket(entity: EntityT, node: XRLiveNodeTraits) {}
}

/**
 * Zero-dependency parser and adapter that extracts `userData.xr` / `ANDROID_xr_scenecore` traits
 * from a compiled `.glb` binary buffer and binds them to native Android XR Jetpack SceneCore or
 * Filament entities.
 */
object XRLiveSceneCoreHelper {

  private const val GLB_MAGIC = 0x46546C67 // "glTF"
  private const val CHUNK_TYPE_JSON = 0x4E4F534A // "JSON"

  /** Largest accepted GLB JSON chunk (checked before allocating). */
  const val MAX_JSON_CHUNK_BYTES = 32 * 1024 * 1024

  /** Hard cap on particles per emitter (mirrors `MAX_PARTICLES_PER_EMITTER`). */
  const val MAX_PARTICLES_PER_EMITTER = 2000

  /** Maximum characters of a hold-to-ask prompt (mirrors `MAX_PROMPT_CHARS`). */
  const val MAX_PROMPT_CHARS = 4000

  private val ANCHORS = setOf("horizontal", "vertical", "floor", "wall", "table")
  private val BILLBOARDS = setOf("capsule", "cylindrical", "spherical")
  private val DIM_UNITS = setOf("m", "cm", "mm", "in", "ft-in", "auto")
  private val ALL_AXES = listOf("x", "y", "z")
  private val SNAP_SURFACES = setOf("none", "floor", "wall", "ceiling", "any")
  private val HEX_COLOR = Regex("^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
  private val PARTICLE_DEFAULT_COUNTS =
    mapOf("rain" to 600, "snow" to 400, "sparks" to 300, "confetti" to 300)

  /** Extracts the UTF-8 JSON chunk string from a binary glTF 2.0 (`.glb`) [ByteBuffer]. */
  @JvmStatic
  fun extractGlbJsonChunk(glb: ByteBuffer): String? {
    val buf = glb.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    buf.rewind()
    if (buf.remaining() < 20) return null
    val magic = buf.int
    val version = buf.int
    val totalLen = buf.int
    if (magic != GLB_MAGIC || version != 2 || totalLen < 20) return null

    val chunkLen = buf.int
    val chunkType = buf.int
    if (
      chunkType != CHUNK_TYPE_JSON ||
        chunkLen <= 0 ||
        chunkLen > MAX_JSON_CHUNK_BYTES ||
        chunkLen > buf.remaining()
    ) {
      return null
    }
    val bytes = ByteArray(chunkLen)
    buf.get(bytes)
    return String(bytes, StandardCharsets.UTF_8).trim()
  }

  /**
   * Parses `XRLiveNodeTraits` from each node in a compiled `.glb` buffer that carries `extras.xr`
   * or `ANDROID_xr_scenecore` metadata.
   */
  @JvmStatic
  fun extractNodeTraits(glb: ByteBuffer): List<XRLiveNodeTraits> {
    val json = extractGlbJsonChunk(glb) ?: return emptyList()
    return parseNodeTraitsFromGltfJson(json)
  }

  /**
   * Parses `XRLiveNodeTraits` from a glTF 2.0 JSON string without requiring external JSON libraries
   * so the Android client library stays zero-dependency.
   *
   * The document is decoded with [MiniJson] and every trait is re-normalized (clamped) with the
   * canonical schema. When the JSON is malformed a lenient legacy scanner is used as a fallback.
   */
  @JvmStatic
  fun parseNodeTraitsFromGltfJson(json: String): List<XRLiveNodeTraits> {
    val root =
      MiniJson.parseObjectOrNull(json)
        ?: return if (json.length > MiniJson.DEFAULT_MAX_CHARS) emptyList() else parseNodeTraitsLegacy(json)
    return parseNodeTraits(root)
  }

  /** Parses node traits from an already-decoded glTF root object. */
  @JvmStatic
  fun parseNodeTraits(root: Map<String, Any?>): List<XRLiveNodeTraits> {
    val nodes = MiniJson.asList(root["nodes"]) ?: return emptyList()
    val results = ArrayList<XRLiveNodeTraits>()
    for ((idx, raw) in nodes.withIndex()) {
      val node = MiniJson.asMap(raw) ?: continue
      val xr = MiniJson.asMap(MiniJson.asMap(node["extras"])?.get("xr"))
      val sc = MiniJson.asMap(MiniJson.asMap(node["extensions"])?.get("ANDROID_xr_scenecore"))
      if (xr == null && sc == null) continue
      val name = MiniJson.asString(node["name"]) ?: "Node_$idx"
      results.add(buildTraits(idx, name, xr ?: emptyMap(), sc ?: emptyMap()))
    }
    return results
  }

  /** Extracts spatial traits from [glb] and invokes [applier] hooks for [rootEntity]. */
  @JvmStatic
  fun <EntityT> applyTraitsFromGlb(
    glb: ByteBuffer,
    rootEntity: EntityT,
    applier: SceneCoreComponentApplier<EntityT>,
  ): List<XRLiveNodeTraits> {
    val traitsList = extractNodeTraits(glb)
    for (trait in traitsList) {
      applyTraits(trait, rootEntity, applier)
    }
    return traitsList
  }

  /** Invokes every [applier] hook relevant to [trait] on [entity]. */
  @JvmStatic
  fun <EntityT> applyTraits(
    trait: XRLiveNodeTraits,
    entity: EntityT,
    applier: SceneCoreComponentApplier<EntityT>,
  ) {
    if (trait.grabbable) {
      applier.onAttachMovable(entity, trait)
    }
    if (!trait.anchor.isNullOrEmpty() && trait.anchor != "none") {
      applier.onAttachAnchor(entity, trait)
    }
    if (!trait.billboard.isNullOrEmpty() && trait.billboard != "false") {
      applier.onAttachBillboard(entity, trait)
    }
    if (!trait.physics.isNullOrEmpty() && trait.physics != "none") {
      applier.onAttachPhysics(entity, trait)
    }
    if (trait.handles != null) applier.onAttachResizable(entity, trait)
    if (trait.follow != null) applier.onAttachFollow(entity, trait)
    if (trait.orbit != null) applier.onAttachOrbit(entity, trait)
    if (trait.particles != null) applier.onAttachParticles(entity, trait)
    if (trait.holdToAsk != null) applier.onAttachHoldToAsk(entity, trait)
    if (trait.worldUnderstanding != null) applier.onAttachWorldUnderstanding(entity, trait)
    if (trait.splatUrl != null) applier.onAttachSplat(entity, trait)
    if (trait.spatialSlot != null) applier.onAttachSpatialPanel(entity, trait)
    if (trait.audio != null) applier.onAttachSpatialAudio(entity, trait)
    if (trait.dimensions != null) applier.onAttachDimensions(entity, trait)
    if (trait.snapTo != null) applier.onAttachSnapTo(entity, trait)
    if (trait.snapSocket != null) applier.onAttachSnapSocket(entity, trait)
  }

  /**
   * Returns the root `extensions.KHR_interactivity` object of a compiled `.glb`, re-serialized as
   * compact JSON, or `null` when absent or malformed.
   */
  @JvmStatic
  fun extractInteractivityGraphJson(glb: ByteBuffer): String? {
    val json = extractGlbJsonChunk(glb) ?: return null
    return extractInteractivityGraphJsonFromGltf(json)
  }

  /** Same as [extractInteractivityGraphJson] for an already-extracted glTF JSON string. */
  @JvmStatic
  fun extractInteractivityGraphJsonFromGltf(gltfJson: String): String? =
    extractInteractivityExtension(gltfJson)?.let { MiniJson.stringify(it) }

  /** Returns the decoded root `extensions.KHR_interactivity` object, or `null`. */
  @JvmStatic
  fun extractInteractivityExtension(gltfJson: String): Map<String, Any?>? {
    val root = MiniJson.parseObjectOrNull(gltfJson) ?: return null
    return MiniJson.asMap(MiniJson.asMap(root["extensions"])?.get("KHR_interactivity"))
  }

  // ---------------------------------------------------------------------------------------------
  // Canonical normalization (port of xr-trait-schema.ts).
  // ---------------------------------------------------------------------------------------------

  /** Clamps [v] into `[lo, hi]`, mapping non-numeric / non-finite values to [fallback]. */
  @JvmStatic
  fun clampNum(v: Any?, lo: Double, hi: Double, fallback: Double): Double {
    val n = (v as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: fallback
    return Math.max(lo, Math.min(hi, n))
  }

  private fun shortString(v: Any?, max: Int = 256): String? {
    val s = v as? String ?: return null
    if (s.isEmpty()) return null
    return if (s.length > max) s.substring(0, max) else s
  }

  private fun finiteVec3(v: Any?): List<Double>? {
    val l = v as? List<*> ?: return null
    if (l.size < 3) return null
    val out = ArrayList<Double>(3)
    for (i in 0 until 3) {
      val d = (l[i] as? Number)?.toDouble() ?: return null
      if (!d.isFinite()) return null
      out.add(d)
    }
    return out
  }

  /** Port of `parseLazyFollow()`; returns `null` for string-valued or disabled follows. */
  @JvmStatic
  fun parseLazyFollow(raw: Any?): XRLazyFollowOptions? {
    val r = MiniJson.asMap(raw) ?: return null
    if (r["lazy"] == false) return null
    val m = r["mode"]
    val mode = if (m == "hand-left" || m == "hand-right") m as String else "head"
    val isHand = mode != "head"
    return XRLazyFollowOptions(
      mode = mode,
      distance = clampNum(r["distance"], 0.1, 10.0, if (isHand) 0.15 else 1.0),
      deadzoneDeg = clampNum(r["deadzoneDeg"], 0.0, 90.0, if (isHand) 0.0 else 15.0),
      stiffness = clampNum(r["stiffness"], 0.5, 40.0, 6.0),
      height = clampNum(r["height"], -2.0, 2.0, if (isHand) 0.12 else -0.1),
      faceUser = r["faceUser"] != false,
      snapOnStart = r["snapOnStart"] != false,
    )
  }

  /** Port of `parseOrbit()`. */
  @JvmStatic
  fun parseOrbit(raw: Any?): XROrbitTrait? {
    val r = MiniJson.asMap(raw) ?: return null
    val t = r["target"]
    val vec = finiteVec3(t)
    val name = if (vec == null && t is String && t.isNotEmpty() && t.length <= 256) t else null
    return XROrbitTrait(
      targetName = name,
      targetPosition = vec ?: listOf(0.0, 0.0, 0.0),
      radius = clampNum(r["radius"], 0.01, 50.0, 0.5),
      speed = clampNum(r["speed"], -20.0, 20.0, 0.5),
      height = clampNum(r["height"], -10.0, 10.0, 0.0),
      phase = clampNum(r["phase"], -1e6, 1e6, 0.0),
      faceCenter = r["faceCenter"] == true,
    )
  }

  private fun truthy(v: Any?): Boolean =
    when (v) {
      null -> false
      is Boolean -> v
      is Double -> v != 0.0 && !v.isNaN()
      is Number -> v.toDouble() != 0.0
      is String -> v.isNotEmpty()
      else -> true
    }

  /** Port of `parseHandles()`. */
  @JvmStatic
  fun parseHandles(raw: Any?): XRHandlesTrait? {
    if (!truthy(raw)) return null
    val r = MiniJson.asMap(raw) ?: emptyMap()
    val minScale = clampNum(r["minScale"], 0.001, 1000.0, 0.1)
    val maxScale = clampNum(r["maxScale"], minScale, 1000.0, Math.max(minScale, 10.0))
    return XRHandlesTrait(
      rotateAxis = if (r["rotateAxis"] == "none") "none" else "y",
      minScale = minScale,
      maxScale = maxScale,
    )
  }

  /** Port of `parseParticles()`. */
  @JvmStatic
  fun parseParticles(raw: Any?): XRParticlesTrait? {
    val r = MiniJson.asMap(raw) ?: return null
    val p = r["preset"]
    val preset = if (p == "snow" || p == "sparks" || p == "confetti") p as String else "rain"
    val a = r["area"]
    val vec = finiteVec3(a)
    val area =
      when {
        vec != null -> vec.map { clampNum(it, 0.05, 50.0, 2.0) }
        a is Number -> List(3) { clampNum(a, 0.05, 50.0, 2.0) }
        else -> listOf(2.0, 2.0, 2.0)
      }
    val count =
      jsRound(
        clampNum(
          r["count"],
          1.0,
          MAX_PARTICLES_PER_EMITTER.toDouble(),
          PARTICLE_DEFAULT_COUNTS.getValue(preset).toDouble(),
        )
      )
    return XRParticlesTrait(
      preset = preset,
      count = count.toInt(),
      area = area,
      speed = clampNum(r["speed"], 0.05, 10.0, 1.0),
    )
  }

  /** Port of `parseHoldToAsk()`. */
  @JvmStatic
  fun parseHoldToAsk(raw: Any?): XRHoldToAskTrait? {
    if (!truthy(raw)) return null
    val r = MiniJson.asMap(raw) ?: emptyMap()
    return XRHoldToAskTrait(
      prompt = shortString(r["prompt"], MAX_PROMPT_CHARS) ?: "What is this?",
      holdMs = clampNum(r["holdMs"], 100.0, 5000.0, 600.0),
    )
  }

  /** Port of `parseWorldUnderstanding()`. */
  @JvmStatic
  fun parseWorldUnderstanding(raw: Any?): XRWorldUnderstandingTrait? {
    if (!truthy(raw)) return null
    val r = MiniJson.asMap(raw) ?: emptyMap()
    return XRWorldUnderstandingTrait(
      planes = r["planes"] != false,
      meshes = r["meshes"] == true,
      reticle = r["reticle"] == true,
      objects = r["objects"] == true,
    )
  }

  private val SAFE_HTTPS = Regex("^https://[^/]", RegexOption.IGNORE_CASE)
  private val URL_SCHEME = Regex("^[a-z][a-z0-9+.-]*:", RegexOption.IGNORE_CASE)

  /**
   * Port of `safeMediaUrl()`: returns [raw] (trimmed) when it is an `https:` URL or a plain
   * relative path (no `..`, `\`, `%`, whitespace / control characters, scheme, or
   * protocol-relative `//`), else `null`. Hosts must apply this before fetching any media.
   */
  @JvmStatic
  fun safeMediaUrl(raw: Any?): String? {
    val url = shortString(raw, 4096)?.trim() ?: return null
    if (url.isEmpty()) return null
    for (c in url) if (c.code <= 0x20 || c == '\\' || c == '%') return null
    if (SAFE_HTTPS.containsMatchIn(url)) return url
    if (url.startsWith("//") || URL_SCHEME.containsMatchIn(url)) return null
    return if (url.split('/', '?', '#').contains("..")) null else url
  }

  /** Port of `parseSpatialAudio()`. */
  @JvmStatic
  fun parseSpatialAudio(raw: Any?): XRSpatialAudioTrait? {
    if (raw is String) {
      val src = safeMediaUrl(raw) ?: return null
      return XRSpatialAudioTrait(src)
    }
    val r = MiniJson.asMap(raw) ?: return null
    val src = safeMediaUrl(r["src"]) ?: return null
    return XRSpatialAudioTrait(
      src = src,
      refDistance = clampNum(r["refDistance"], 0.01, 1000.0, 1.0),
      loop = r["loop"] == true,
    )
  }

  /** Port of `safeHexColor()`. */
  @JvmStatic
  fun safeHexColor(raw: Any?, fallback: String): String {
    val s = shortString(raw, 16)?.trim() ?: return fallback
    val m = HEX_COLOR.matchEntire(s) ?: return fallback
    return "#${m.groupValues[1].lowercase()}"
  }

  /** Port of `parseDimensions()`. */
  @JvmStatic
  fun parseDimensions(raw: Any?): XRDimensionsTrait? {
    if (!truthy(raw)) return null
    val r = MiniJson.asMap(raw)
    if (r != null && r["enabled"] == false) return null
    val u = r?.get("unit")
    val unit = if (u is String && u in DIM_UNITS) u else "auto"
    val rawAxes = r?.get("axes")
    val axisSet =
      when (rawAxes) {
        is List<*> -> rawAxes.filterIsInstance<String>().toSet()
        is String -> rawAxes.map { it.toString() }.toSet()
        else -> emptySet()
      }
    val axes = ALL_AXES.filter { it in axisSet }.ifEmpty { ALL_AXES }
    return XRDimensionsTrait(
      enabled = true,
      unit = unit,
      axes = axes,
      color = safeHexColor(r?.get("color"), "#38bdf8"),
      showOnSelect = r?.get("showOnSelect") == true,
    )
  }

  /** Port of `parseSnapTo()`. */
  @JvmStatic
  fun parseSnapTo(raw: Any?): XRSnapToTrait? {
    if (!truthy(raw)) return null
    val r = MiniJson.asMap(raw) ?: emptyMap()
    val g = r["grid"]
    val vec = finiteVec3(g)
    val grid =
      when {
        vec != null -> vec.map { clampNum(it, 0.001, 100.0, 0.1) }
        g is Number && g.toDouble().isFinite() && g.toDouble() > 0.0 ->
          List(3) { clampNum(g, 0.001, 100.0, 0.1) }
        else -> null
      }
    val surf = r["surface"]
    return XRSnapToTrait(
      grid = grid,
      angleDeg = clampNum(r["angleDeg"], 0.0, 180.0, 0.0),
      surface = if (surf is String && surf in SNAP_SURFACES) surf else "none",
      socketTag = shortString(r["socketTag"], 128) ?: "",
      radius = clampNum(r["radius"], 0.01, 2.0, 0.15),
    )
  }

  /** Port of `parseSnapSocket()`. */
  @JvmStatic
  fun parseSnapSocket(raw: Any?): XRSnapSocketTrait? {
    if (raw is String) {
      val tag = shortString(raw, 128) ?: return null
      return XRSnapSocketTrait(tag = tag)
    }
    val r = MiniJson.asMap(raw) ?: return null
    val tag = shortString(r["tag"], 128) ?: return null
    return XRSnapSocketTrait(
      tag = tag,
      radius = clampNum(r["radius"], 0.01, 2.0, 0.15),
      alignRotation = r["alignRotation"] != false,
      highlightColor = safeHexColor(r["highlightColor"], "#22c55e"),
    )
  }

  /** JavaScript `Math.round` (half rounds toward +infinity). */
  private fun jsRound(v: Double): Double = Math.floor(v + 0.5)

  /**
   * Builds the canonical trait set for one node. `extras.xr` ([xr]) is authoritative (it is the
   * authored bag merged with `normalizeXRTraits()` output); `ANDROID_xr_scenecore` ([sc]) fills
   * gaps for files that only carry the component map.
   */
  private fun buildTraits(
    idx: Int,
    name: String,
    xr: Map<String, Any?>,
    sc: Map<String, Any?>,
  ): XRLiveNodeTraits {
    val traitList = (xr["traits"] as? List<*>) ?: emptyList<Any?>()
    fun has(t: String) = traitList.contains(t)
    val interactable = MiniJson.asMap(sc["interactable"])
    val movable = MiniJson.asMap(sc["movable"])

    // grab
    val grabRaw = xr["grab"]
    var grabMode: String? =
      when {
        grabRaw == "1-hand" || grabRaw == "2-hand" -> grabRaw as String
        grabRaw == true || xr["grabbable"] == true || has("grab") -> "2-hand"
        else -> null
      }
    if (grabMode == null && (movable?.get("systemMovable") == true || interactable != null)) {
      val m = interactable?.get("mode")
      grabMode = if (m == "1-hand" || m == "2-hand") m as String else "2-hand"
    }

    // scale
    val scaleRaw = xr["scale"] ?: xr["scalable"]
    var scalable = false
    var minScale = 0.05
    var maxScale = 5.0
    if (truthy(scaleRaw) || has("scale")) {
      // `scale: false` deliberately wins over a legacy `scalable: true`.
      val s = MiniJson.asMap(scaleRaw) ?: emptyMap()
      minScale = clampNum(s["min"], 0.001, 1000.0, 0.05)
      maxScale = clampNum(s["max"], minScale, 1000.0, Math.max(minScale, 5.0))
      scalable = true
    } else if (scaleRaw == null && movable?.get("scaleInZ") == true) {
      minScale = clampNum(movable["minScale"], 0.001, 1000.0, 0.05)
      maxScale = clampNum(movable["maxScale"], minScale, 1000.0, Math.max(minScale, 5.0))
      scalable = true
    }

    // billboard
    val bb = xr["billboard"]
    val billboard =
      when {
        bb is String && bb in BILLBOARDS -> bb
        bb == true || has("billboard") -> "capsule"
        else ->
          (MiniJson.asMap(sc["billboard"])?.get("mode") as? String)?.takeIf { it in BILLBOARDS }
      }

    // follow
    var follow: String? = null
    var lazy: XRLazyFollowOptions? = null
    val f = xr["follow"]
    val fMap = MiniJson.asMap(f)
    if (f is String && f.isNotEmpty()) {
      follow = if (f == "hand-left" || f == "hand-right") f else "head"
    } else if (fMap != null && fMap["lazy"] == false) {
      // `{lazy: false}` objects are eager spring follows.
      val m = fMap["mode"]
      follow = if (m == "hand-left" || m == "hand-right") m as String else "head"
    } else if (f != null) {
      lazy = parseLazyFollow(f)
    } else {
      val scf = MiniJson.asMap(sc["follow"])
      if (scf != null) {
        if (scf["lazy"] == true) {
          // The SceneCore component names the anchor `target`; the schema calls it `mode`.
          lazy = parseLazyFollow(scf + ("mode" to scf["target"]))
        } else {
          val t = scf["target"]
          follow = if (t == "hand-left" || t == "hand-right") t as String else "head"
        }
      }
    }
    if (lazy != null) follow = lazy.mode
    val lz = lazy ?: XRLazyFollowOptions()

    // anchor
    val anchorRaw = xr["anchor"]
    val scAnchor = MiniJson.asMap(sc["anchor"])
    val anchor =
      when {
        anchorRaw is String && anchorRaw in ANCHORS -> anchorRaw
        scAnchor != null ->
          (scAnchor["semanticType"] as? String)?.lowercase()?.takeIf { it in ANCHORS }
            ?: (scAnchor["planeType"] as? String)?.lowercase()?.takeIf { it in ANCHORS }
        else -> null
      }

    // physics
    val ph = xr["physics"] ?: MiniJson.asMap(sc["rigidbody"])?.get("type")
    val physics = if (ph == "dynamic" || ph == "static") ph as String else null

    val splat = safeMediaUrl(xr["splatUrl"]) ?: safeMediaUrl(MiniJson.asMap(sc["splat"])?.get("url"))
    val slot =
      shortString(xr["spatialSlot"]) ?: shortString(MiniJson.asMap(sc["spatialPanel"])?.get("slot"))

    return XRLiveNodeTraits(
      nodeIndex = idx,
      name = name,
      grabbable = grabMode != null,
      scalable = scalable,
      billboard = billboard,
      anchor = anchor,
      follow = follow,
      physics = physics,
      grabMode = grabMode,
      minScale = minScale,
      maxScale = maxScale,
      followLazy = lazy != null,
      followDistance = lz.distance,
      followDeadzoneDeg = lz.deadzoneDeg,
      followStiffness = lz.stiffness,
      followHeight = lz.height,
      followFaceUser = lz.faceUser,
      followSnapOnStart = lz.snapOnStart,
      orbit = parseOrbit(xr["orbit"] ?: sc["orbit"]),
      handles = parseHandles(xr["handles"] ?: sc["resizable"]),
      particles = parseParticles(xr["particles"] ?: sc["particles"]),
      holdToAsk = parseHoldToAsk(xr["holdToAsk"] ?: sc["holdToAsk"]),
      worldUnderstanding = parseWorldUnderstanding(xr["worldUnderstanding"] ?: sc["worldUnderstanding"]),
      splatUrl = splat,
      spatialSlot = slot,
      audio = parseSpatialAudio(xr["audio"] ?: sc["spatialAudio"]),
      dimensions = parseDimensions(xr["dimensions"] ?: sc["dimensions"]),
      snapTo = parseSnapTo(xr["snapTo"] ?: sc["snapTo"]),
      snapSocket = parseSnapSocket(xr["snapSocket"] ?: sc["snapSocket"]),
      pointerEvents = if (xr["pointerEvents"] == "none") "none" else null,
    )
  }

  // ---------------------------------------------------------------------------------------------
  // Legacy lenient scanner, used only when the JSON document fails strict parsing.
  // ---------------------------------------------------------------------------------------------

  private fun parseNodeTraitsLegacy(json: String): List<XRLiveNodeTraits> {
    val nodesStart = json.indexOf("\"nodes\"")
    if (nodesStart < 0) return emptyList()
    val arrayOpen = json.indexOf('[', nodesStart)
    if (arrayOpen < 0) return emptyList()
    val arrayContent = extractBalancedBlock(json, arrayOpen, '[', ']') ?: return emptyList()

    val results = mutableListOf<XRLiveNodeTraits>()
    var cursor = 0
    var nodeIdx = 0
    while (cursor < arrayContent.length) {
      val objStart = arrayContent.indexOf('{', cursor)
      if (objStart < 0) break
      val nodeObj = extractBalancedBlock(arrayContent, objStart, '{', '}') ?: break
      cursor = objStart + nodeObj.length

      if (nodeObj.contains("\"xr\"") || nodeObj.contains("\"ANDROID_xr_scenecore\"")) {
        val topLevelNode = stripNestedObjects(nodeObj)
        val name = extractJsonStringField(topLevelNode, "name") ?: "Node_$nodeIdx"
        val xrSub = extractSubObject(nodeObj, "xr") ?: ""
        val sceneCoreSub = extractSubObject(nodeObj, "ANDROID_xr_scenecore") ?: ""
        val xrBlock =
          if (xrSub.isNotEmpty() || sceneCoreSub.isNotEmpty()) "$xrSub $sceneCoreSub" else nodeObj
        val grabbable =
          extractJsonBoolField(xrBlock, "grabbable") ||
            extractJsonBoolField(xrBlock, "systemMovable") ||
            hasJsonArrayStringItem(xrBlock, "traits", "grab")
        val scalable =
          extractJsonBoolField(xrBlock, "scalable") ||
            extractJsonBoolField(xrBlock, "scaleInZ") ||
            hasJsonArrayStringItem(xrBlock, "traits", "scale")
        val billboard =
          extractJsonStringField(xrBlock, "billboard")
            ?: extractJsonStringField(extractSubObject(xrBlock, "billboard") ?: "", "mode")
            ?: if (
              extractJsonBoolField(xrBlock, "billboard") ||
                hasJsonArrayStringItem(xrBlock, "traits", "billboard")
            ) {
              "capsule"
            } else {
              null
            }
        val anchor =
          extractJsonStringField(xrBlock, "anchor")
            ?: extractJsonStringField(xrBlock, "planeType")?.lowercase()
        val follow = extractJsonStringField(xrBlock, "follow")
        val physics = extractJsonStringField(xrBlock, "physics")

        results.add(
          XRLiveNodeTraits(
            nodeIndex = nodeIdx,
            name = name,
            grabbable = grabbable,
            scalable = scalable,
            billboard = billboard,
            anchor = anchor,
            follow = follow,
            physics = physics,
          )
        )
      }
      nodeIdx++
    }
    return results
  }

  private fun extractBalancedBlock(
    src: String,
    openIdx: Int,
    openChar: Char,
    closeChar: Char,
  ): String? {
    var depth = 0
    var inString = false
    var escaped = false
    for (i in openIdx until src.length) {
      val ch = src[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch == '\\' && inString) {
        escaped = true
        continue
      }
      if (ch == '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (ch == openChar) {
          depth++
        } else if (ch == closeChar) {
          depth--
          if (depth == 0) {
            return src.substring(openIdx, i + 1)
          }
        }
      }
    }
    return null
  }

  private fun stripNestedObjects(nodeObj: String): String {
    val sb = StringBuilder()
    var depth = 0
    var inString = false
    var escaped = false
    for (i in nodeObj.indices) {
      val ch = nodeObj[i]
      if (escaped) {
        if (depth <= 1) sb.append(ch)
        escaped = false
        continue
      }
      if (ch == '\\' && inString) {
        if (depth <= 1) sb.append(ch)
        escaped = true
        continue
      }
      if (ch == '"') {
        inString = !inString
      }
      if (!inString) {
        if (ch == '{') {
          depth++
          if (depth > 1) continue
        } else if (ch == '}') {
          if (depth > 1) {
            depth--
            continue
          }
          depth--
        }
      }
      if (depth <= 1) {
        sb.append(ch)
      }
    }
    return sb.toString()
  }

  private fun extractSubObject(src: String, key: String): String? {
    val keyPattern = Regex("\"$key\"\\s*:\\s*\\{")
    val match = keyPattern.find(src) ?: return null
    val braceIdx = src.indexOf('{', match.range.first)
    if (braceIdx < 0) return null
    return extractBalancedBlock(src, braceIdx, '{', '}')
  }

  private fun extractJsonStringField(obj: String, key: String): String? {
    val pattern = Regex("\"$key\"\\s*:\\s*\"([^\"]+)\"")
    return pattern.find(obj)?.groupValues?.getOrNull(1)
  }

  private fun extractJsonBoolField(obj: String, key: String): Boolean {
    val pattern = Regex("\"$key\"\\s*:\\s*(true|false)")
    return pattern.find(obj)?.groupValues?.getOrNull(1) == "true"
  }

  private fun hasJsonArrayStringItem(obj: String, arrayKey: String, item: String): Boolean {
    val keyPattern = Regex("\"$arrayKey\"\\s*:\\s*\\[")
    val match = keyPattern.find(obj) ?: return false
    val bracketIdx = obj.indexOf('[', match.range.first)
    if (bracketIdx < 0) return false
    val arrBlock = extractBalancedBlock(obj, bracketIdx, '[', ']') ?: return false
    return Regex("\"${Regex.escape(item)}\"").containsMatchIn(arrBlock)
  }
}
