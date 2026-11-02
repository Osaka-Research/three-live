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

import java.util.concurrent.Executor
import java.util.concurrent.Executors

/**
 * Native spatial features on top of any [ThreeLiveSceneRenderer] that supports dynamic meshes:
 *
 * - **Manipulation handles** for nodes with a `handles` trait: corner cubes scale uniformly and the
 *   pedestal bar yaws the node (same math as `manipulation-handles.ts`), reported as
 *   `{mesh, scale, yawDeg}`.
 * - **Spatial paint** (when [paintColor] is set): dragging in empty space draws a tube stroke 0.4 m
 *   in front of the camera (web screen-paint depth), reported as `{index, points, lengthMeters}`.
 * - **Particles** for nodes with a `particles` trait, simulated with the shared `ParticleEmitter`
 *   (same presets and seeds as web) and drawn as camera-facing quads.
 * - **Gaussian splats** for nodes with a `splatUrl` trait: downloaded and parsed off-thread with
 *   [SplatParser], stride-downsampled to [maxSplats], depth-sorted off-thread at most at 15 Hz when
 *   the camera or node moves (> 5 cm or > 5°), and drawn as camera-facing Gaussian quads via
 *   [ThreeLiveSceneRenderer.addSplatMesh].
 *
 * Attach after creating the [binding]; [dispose] removes everything. Main thread only.
 */
class XRSpatialFeatures
@JvmOverloads
constructor(
  private val binding: ThreeLiveRuntimeBinding,
  private val renderer: ThreeLiveSceneRenderer,
  /** Base URL used to resolve relative `splatUrl` values and enforce same-origin policy. */
  val baseUrl: String? = null,
  /** Whether cross-origin `splatUrl` downloads are permitted (host `allowRemoteSplats`). */
  val allowRemoteSplats: Boolean = false,
  /** Maximum splats rendered per cloud (deterministic stride downsampling when exceeded). */
  val maxSplats: Int =
    if (renderer.supportsGpuSplats) SplatParser.DEFAULT_MAX_GPU_SPLATS else SplatParser.DEFAULT_MAX_CPU_SPLATS,
  /** Custom loader for tests; defaults to [SplatParser.loadUrl]. */
  private val splatLoader: (url: String, baseUrl: String?, allowCrossOrigin: Boolean) -> SplatData =
    { u, b, a -> SplatParser.loadUrl(u, b, a) },
  /** Background executor for splat downloads and depth sorting. */
  private val backgroundExecutor: Executor? = null,
) {
  /** Feature events, matching the web `xr-handles-change` / `xr-paint-stroke` details. */
  interface Listener {
    fun onHandlesChange(mesh: String, scale: Double, yawDeg: Double) {}

    fun onPaintStroke(index: Int, points: Int, lengthMeters: Double) {}

    fun onMeasureComplete(
      start: DoubleArray,
      end: DoubleArray,
      distanceMeters: Double,
      formatted: String,
    ) {}

    fun onSnap(
      nodeIndex: Int,
      socketNodeIndex: Int?,
      position: DoubleArray,
      quaternion: DoubleArray,
      mode: String,
    ) {}

    fun onUnsnap(nodeIndex: Int, socketNodeIndex: Int?) {}

    fun onGazeEnter(nodeIndex: Int, point: DoubleArray, normal: DoubleArray) {}

    fun onGazeLeave(nodeIndex: Int) {}

    fun onGazeDwell(nodeIndex: Int, action: String, point: DoubleArray) {}

    fun onExplodeChange(factor: Double, source: String) {}

    fun onAnchorsRestored(count: Int, source: String) {}

    fun onTeleport(from: DoubleArray, to: DoubleArray, yawDeg: Double) {}
  }

  var listener: Listener? = null

  /** Linear RGBA paint color, or `null` to disable spatial paint (the default). */
  var paintColor: FloatArray? = null

  /** Optional floor height (meters) that particles collide with. */
  var floorY: Double? = null

  /** Scene-wide bounding-box dimension callout toggle (`<xr-live spatial-measure>`). */
  var measureBoundsEnabled: Boolean = false

  /** Interactive point-to-point tape measure toggle (`<xr-live spatial-measure="tape">`). */
  var tapeMeasureEnabled: Boolean = false

  /** Default unit (`auto`, `m`, `cm`, `mm`, `in`, `ft-in`) for `spatial-measure`. */
  var measureUnit: String = "auto"

  /** Currently selected node index (used by `dimensions.showOnSelect`). */
  var selectedNodeIndex: Int = -1

  /** Gaze-dwell activation mode: `"off"`, `"on"`, or `"auto"` (active when [stepGazeDwell] `autoEnabled` is `true`). */
  var gazeDwellMode: String = "off"

  /** Default dwell duration in milliseconds (`250..10000`) when not overridden by a node's `gaze` trait. */
  var defaultDwellMs: Int = 1200

  /** Explosion layout mode: `"radial"`, `"axial-x"`, `"axial-y"`, `"axial-z"`, or `"hierarchical"`. */
  var explodeMode: String = "radial"

  /** Multiplier (`0..10`) applied to exploded part travel distances. */
  var explodeScale: Double = 1.5

  /** Cross-section cut plane specification (`"none"`, `"x:0.2"`, `"y:0.0"`, `"-z:0.1"`, `"interactive"`). */
  var sectionPlaneSpec: String = "none"

  /** Current spring-smoothed assembly explosion factor in `[0..1]`. */
  val explodeFactor: Double
    get() = currentExplodeFactor

  /**
   * Optional persistence namespace (`<xr-live persistent-anchors="room-a">`). When non-blank,
   * manipulated/persisted node transforms are stored under `xr-live:anchors:<namespace>`.
   */
  var persistentAnchorsNamespace: String? = null

  /** Default in-memory key-value map used when [anchorStoreGet] / [anchorStoreSet] are unset. */
  val anchorStorage: MutableMap<String, String> = LinkedHashMap()

  /** Optional host storage reader (e.g. `SharedPreferences::getString`). */
  var anchorStoreGet: ((key: String) -> String?)? = null

  /** Optional host storage writer (`value == null` removes the key). */
  var anchorStoreSet: ((key: String, value: String?) -> Unit)? = null

  /** Enables room-scale teleportation and snap-turn (`<xr-live locomotion>`). */
  var locomotionEnabled: Boolean = false

  /** Discrete yaw step in degrees (`15..90`) for thumbstick snap-turn. */
  var snapTurnDeg: Double = 30.0

  /** Enables the `120ms` peripheral comfort vignette during teleports and snap-turns. */
  var comfortVignetteEnabled: Boolean = true

  /** Current accumulated rig translation offset `[x, y, z]` in meters from locomotion. */
  val rigOffset: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0)

  /** Current accumulated rig yaw angle in degrees from snap-turns. */
  var rigYawDeg: Double = 0.0
    private set

  /** Normalized `[0..1]` peripheral comfort vignette opacity for the current frame. */
  val comfortVignetteIntensity: Double
    get() =
      if (!comfortVignetteEnabled || vignetteRemainingMs <= 0.0) {
        0.0
      } else {
        (vignetteRemainingMs / SpatialLocomotion.COMFORT_VIGNETTE_MS).coerceIn(0.0, 1.0)
      }

  private val session = binding.session
  private val scene = binding.scene

  private class HandleNode(val node: Int, val trait: XRHandlesTrait) {
    val drag = ManipulationHandles.Drag(trait)
    val meshIds = IntArray(5) { -1 }
    var layout: ManipulationHandles.Layout? = null
  }

  private class Emitter(val node: Int, val emitter: ParticleEmitter, var meshId: Int = -1)

  private class Stroke(val builder: TubeStrokeBuilder, var meshId: Int, val index: Int)

  private class SplatCloud(val node: Int, val url: String) {
    @Volatile var data: SplatData? = null
    @Volatile var staticGpuGeometry: SplatQuadGeometry? = null
    @Volatile var pendingGeometry: SplatQuadGeometry? = null
    @Volatile var pendingIndices: IntArray? = null
    @Volatile var sorting: Boolean = false
    var meshId: Int = -1
    var lastCameraWorld: FloatArray? = null
    var lastNodeWorld: DoubleArray? = null
    var sinceLastSortSec: Double = SPLAT_RESORT_MIN_INTERVAL_SEC
    var wasVisible: Boolean = true
    var depths: FloatArray? = null
    var keys: IntArray? = null
    var counts: IntArray? = null
    var order: IntArray? = null
  }

  private class DimensionVisual(
    val node: Int,
    val trait: XRDimensionsTrait?,
    var barMeshId: Int = -1,
    val labelMeshIds: ArrayList<Int> = ArrayList(),
    val labelPositions: ArrayList<DoubleArray> = ArrayList(),
    var cacheKey: String = "",
  )

  private class TapeVisual(
    val start: DoubleArray,
    var end: DoubleArray,
    var lineMeshId: Int = -1,
    var labelMeshId: Int = -1,
  )

  private val handles = ArrayList<HandleNode>()
  private val emitters = ArrayList<Emitter>()
  private val strokes = ArrayList<Stroke>()
  private val splats = ArrayList<SplatCloud>()
  private val dimensionVisuals = LinkedHashMap<Int, DimensionVisual>()
  private val tapeSegments = ArrayList<TapeVisual>()
  private var activeTape: TapeVisual? = null
  private val snapTraits = HashMap<Int, XRSnapToTrait>()
  private val socketTraits = HashMap<Int, XRSnapSocketTrait>()
  private val activeSocketByNode = HashMap<Int, String>()
  private var previewRingMeshId: Int = -1
  private var previewRingRadius: Double = 0.0
  private var pulsePhase: Double = 0.0
  private val gazeTraits = HashMap<Int, XRGazeTrait>()
  private val pointerNoneNodes = HashSet<Int>()
  private var smoothedGazeDir: DoubleArray? = null
  private var activeGazeNode: Int = -1
  private var gazeElapsedMs: Double = 0.0
  private var gazeCompleted: Boolean = false
  private var lastGazeHitPoint: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0)
  private var lastGazeHitNormal: DoubleArray = doubleArrayOf(0.0, 0.0, 1.0)
  private var gazeReticleMeshId: Int = -1
  private var lastReticleProgressBucket: Int = -1

  private class RestPart(
    val node: Int,
    val restPos: DoubleArray,
    val restRot: FloatArray,
    val restScale: FloatArray,
    val restWorldCenter: DoubleArray,
    val depth: Int,
  )

  private val explodeTraits = HashMap<Int, XRExplodeTrait>()
  private val anchorPersistTraits = HashMap<Int, XRAnchorPersistTrait>()
  private val navigableTraits = HashMap<Int, String>()
  private val grabbableNodes = HashSet<Int>()
  private val restParts = ArrayList<RestPart>()
  private var restCaptured: Boolean = false
  private var assemblyCenter: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0)
  private var assemblyRadius: Double = 0.5
  private var targetExplodeFactor: Double = 0.0
  private var currentExplodeFactor: Double = 0.0
  private var wasExploded: Boolean = false
  private var explodeLeaderMeshId: Int = -1
  private var sectionGizmoMeshId: Int = -1
  private var lastSectionGizmoRadius: Double = -1.0
  private var teleportArcMeshId: Int = -1
  private var teleportArcValidColor: Boolean? = null
  private var teleportRingMeshId: Int = -1
  private var teleportRingValidColor: Boolean? = null
  private var pendingTeleportPoint: DoubleArray? = null
  private var pendingTeleportValid: Boolean = false
  private var snapTurnLatched: Boolean = false
  private var vignetteRemainingMs: Double = 0.0
  private val invWorld = DoubleArray(16)
  private var ownedExecutor = false
  private val executor: Executor =
    backgroundExecutor
      ?: Executors.newSingleThreadExecutor { r -> Thread(r, "three-live-splat").apply { isDaemon = true } }
        .also { ownedExecutor = true }
  private var dragging: HandleNode? = null
  private var painting: Stroke? = null
  private var strokeCount = 0
  @Volatile private var disposed = false

  private val world = DoubleArray(16)
  private val matrix = FloatArray(16)
  private val pos = DoubleArray(3)

  init {
    for (t in session.traits) {
      val node = t.nodeIndex
      if (node !in 0 until scene.nodeCount) continue
      t.handles?.let { if (scene.meshBounds.getOrNull(scene.nodeMesh[node]) != null) handles.add(HandleNode(node, it)) }
      t.particles?.let { emitters.add(Emitter(node, ParticleEmitter(it, seed = node + 1))) }
      t.dimensions?.let { dimensionVisuals[node] = DimensionVisual(node, it) }
      t.snapTo?.let { snapTraits[node] = it }
      t.snapSocket?.let { socketTraits[node] = it }
      t.gaze?.let { gazeTraits[node] = it }
      t.explode?.let { explodeTraits[node] = it }
      t.anchorPersist?.let { anchorPersistTraits[node] = it }
      t.navigable?.let { navigableTraits[node] = it }
      if (t.grabbable || t.handles != null) grabbableNodes.add(node)
      if (t.pointerEvents == "none") pointerNoneNodes.add(node)
      t.splatUrl?.let { raw ->
        val resolved = SplatParser.resolveSplatUrl(raw, baseUrl, allowRemoteSplats)
        if (resolved != null) {
          val cloud = SplatCloud(node, resolved)
          splats.add(cloud)
          executor.execute {
            if (disposed) return@execute
            try {
              val loaded = splatLoader(resolved, baseUrl, allowRemoteSplats)
              if (!disposed) {
                val downsampled = SplatParser.downsample(loaded, maxSplats)
                if (renderer.supportsGpuSplats) {
                  cloud.staticGpuGeometry = SplatParser.buildStaticGpuSplatVertices(downsampled)
                }
                cloud.data = downsampled
              }
            } catch (e: RuntimeException) {
              // Malformed or unreachable splat URLs are ignored without crashing the scene.
            }
          }
        }
      }
    }
    for (h in handles) {
      for (k in 0 until 5) h.meshIds[k] = renderer.addDynamicMesh(UNIT_CUBE_POSITIONS, null, UNIT_CUBE_INDICES, HANDLE_COLOR)
    }
    for (e in emitters) {
      if (session.nodeWorldMatrix(e.node, world)) e.emitter.reset(world[12], world[13], world[14])
    }
    binding.pointerHandler =
      object : ThreeLiveRendererListener {
        override fun onPointerDown(pointer: ThreeLivePointer): Boolean = pointerDown(pointer)

        override fun onPointerMove(pointer: ThreeLivePointer) {
          pointerMove(pointer)
        }

        override fun onPointerUp(pointer: ThreeLivePointer) {
          pointerUp()
        }
      }
    binding.frameHandler = { dt, cameraWorld -> frame(dt, cameraWorld) }
  }

  /** Number of nodes with handles (for tests and UIs). */
  val handleCount: Int
    get() = handles.size

  /** Number of particle emitters. */
  val emitterCount: Int
    get() = emitters.size

  /** Number of accepted `splatUrl` clouds. */
  val splatCount: Int
    get() = splats.size

  /** Number of nodes configured with `dimensions` callouts. */
  val dimensionCount: Int
    get() = dimensionVisuals.size

  /** Number of nodes configured as `snapSocket` targets. */
  val snapSocketCount: Int
    get() = socketTraits.size

  /** Clears all locked and active tape-measure segments. */
  fun clearMeasurements() {
    activeTape?.let {
      if (it.lineMeshId >= 0) renderer.removeDynamicMesh(it.lineMeshId)
      if (it.labelMeshId >= 0) renderer.removeDynamicMesh(it.labelMeshId)
    }
    activeTape = null
    for (seg in tapeSegments) {
      if (seg.lineMeshId >= 0) renderer.removeDynamicMesh(seg.lineMeshId)
      if (seg.labelMeshId >= 0) renderer.removeDynamicMesh(seg.labelMeshId)
    }
    tapeSegments.clear()
  }

  /** Removes every dynamic mesh and detaches from the binding. */
  fun dispose() {
    if (disposed) return
    disposed = true
    if (ownedExecutor && executor is java.util.concurrent.ExecutorService) {
      executor.shutdown()
    }
    binding.pointerHandler = null
    binding.frameHandler = null
    clearMeasurements()
    for (dv in dimensionVisuals.values) {
      if (dv.barMeshId >= 0) renderer.removeDynamicMesh(dv.barMeshId)
      for (id in dv.labelMeshIds) renderer.removeDynamicMesh(id)
    }
    if (previewRingMeshId >= 0) renderer.removeDynamicMesh(previewRingMeshId)
    previewRingMeshId = -1
    if (gazeReticleMeshId >= 0) renderer.removeDynamicMesh(gazeReticleMeshId)
    gazeReticleMeshId = -1
    if (explodeLeaderMeshId >= 0) renderer.removeDynamicMesh(explodeLeaderMeshId)
    explodeLeaderMeshId = -1
    if (sectionGizmoMeshId >= 0) renderer.removeDynamicMesh(sectionGizmoMeshId)
    sectionGizmoMeshId = -1
    if (teleportArcMeshId >= 0) renderer.removeDynamicMesh(teleportArcMeshId)
    teleportArcMeshId = -1
    if (teleportRingMeshId >= 0) renderer.removeDynamicMesh(teleportRingMeshId)
    teleportRingMeshId = -1
    for (h in handles) for (id in h.meshIds) renderer.removeDynamicMesh(id)
    for (e in emitters) renderer.removeDynamicMesh(e.meshId)
    for (s in strokes) renderer.removeDynamicMesh(s.meshId)
    for (sc in splats) if (sc.meshId >= 0) renderer.removeDynamicMesh(sc.meshId)
    dimensionVisuals.clear()
    snapTraits.clear()
    socketTraits.clear()
    activeSocketByNode.clear()
    gazeTraits.clear()
    explodeTraits.clear()
    anchorPersistTraits.clear()
    navigableTraits.clear()
    grabbableNodes.clear()
    restParts.clear()
    pointerNoneNodes.clear()
    handles.clear()
    emitters.clear()
    strokes.clear()
    splats.clear()
  }

  // ---- Input -----------------------------------------------------------------------------------

  private fun pointerDown(p: ThreeLivePointer): Boolean {
    if (disposed) return false
    for (h in handles) {
      val layout = layoutOf(h) ?: continue
      val t = session.nodeTransform(h.node) ?: continue
      val scale = DoubleArray(3) { t.scale[it].toDouble() }
      val rot = DoubleArray(4) { t.rotation[it].toDouble() }
      if (h.drag.begin(layout, p.origin, p.direction, scale, rot) != null) {
        dragging = h
        return true
      }
    }
    if (tapeMeasureEnabled && paintColor == null) {
      val pt = tapePointOf(p) ?: return false
      beginTape(pt)
      return true
    }
    val color = paintColor ?: return false
    if (p.pick != null) return false
    if (strokes.size >= MAX_STROKES) strokes.removeAt(0).let { renderer.removeDynamicMesh(it.meshId) }
    val stroke = Stroke(TubeStrokeBuilder(), -1, strokeCount++)
    paintAt(stroke, p)
    stroke.meshId = renderer.addDynamicMesh(FloatArray(9), null, intArrayOf(0, 1, 2), color)
    strokes.add(stroke)
    painting = stroke
    return true
  }

  private fun pointerMove(p: ThreeLivePointer) {
    dragging?.let { h ->
      if (h.drag.update(p.origin, p.direction)) {
        val t = session.nodeTransform(h.node) ?: return
        val r = FloatArray(4) { h.drag.rotation[it].toFloat() }
        val s = FloatArray(3) { h.drag.scale[it].toFloat() }
        session.setNodeTransform(h.node, null, r, s)
        renderer.setNodeTransform(h.node, t.translation, r, s)
      }
      return
    }
    if (activeTape != null) {
      tapePointOf(p)?.let { updateTape(it) }
      return
    }
    val stroke = painting ?: return
    if (stroke.builder.pointCount >= MAX_STROKE_POINTS) return
    if (paintAt(stroke, p) && stroke.builder.pointCount % REBUILD_EVERY == 0) rebuild(stroke)
  }

  private fun pointerUp() {
    dragging?.let { h ->
      h.drag.end()
      dragging = null
      val t = session.nodeTransform(h.node) ?: return
      val q = t.rotation
      val yaw = XRSpatialMath.yawFromQuat(q[0].toDouble(), q[1].toDouble(), q[2].toDouble(), q[3].toDouble())
      if (!persistentAnchorsNamespace.isNullOrBlank() || anchorPersistTraits.containsKey(h.node)) {
        savePersistedAnchors()
      }
      listener?.onHandlesChange(scene.nodeNames.getOrNull(h.node) ?: "", t.scale[0].toDouble(), Math.toDegrees(yaw))
      return
    }
    if (activeTape != null) {
      endTape()
      return
    }
    val stroke = painting ?: return
    painting = null
    rebuild(stroke)
    listener?.onPaintStroke(stroke.index, stroke.builder.pointCount, stroke.builder.lengthMeters)
  }

  private fun paintAt(stroke: Stroke, p: ThreeLivePointer): Boolean {
    val dir = XRSpatialMath.normalizeRayDir(p.direction.copyOf()) ?: return false
    return stroke.builder.addPoint(
      p.origin[0] + dir[0] * SCREEN_PAINT_DEPTH,
      p.origin[1] + dir[1] * SCREEN_PAINT_DEPTH,
      p.origin[2] + dir[2] * SCREEN_PAINT_DEPTH,
    )
  }

  private fun rebuild(stroke: Stroke) {
    val geo = stroke.builder.build() ?: return
    renderer.updateDynamicMesh(stroke.meshId, geo.positions, geo.normals, geo.indices)
  }

  // ---- Per frame -------------------------------------------------------------------------------

  private fun frame(dt: Double, cameraWorld: FloatArray) {
    if (disposed) return
    val clampedDt = dt.coerceIn(0.0, 0.1)
    pulsePhase += clampedDt * 5.0
    if (vignetteRemainingMs > 0.0) {
      vignetteRemainingMs = Math.max(0.0, vignetteRemainingMs - clampedDt * 1000.0)
    }
    stepExplodedView(dt)
    for (h in handles) placeHandles(h)
    for (e in emitters) stepEmitter(e, dt, cameraWorld)
    for (sc in splats) stepSplat(sc, dt, cameraWorld)
    stepDimensions(cameraWorld)
  }

  private fun tapePointOf(p: ThreeLivePointer): DoubleArray? {
    val hit = p.pick?.hitPoint
    if (hit != null && hit.size >= 3) {
      return doubleArrayOf(hit[0].toDouble(), hit[1].toDouble(), hit[2].toDouble())
    }
    val dir = XRSpatialMath.normalizeRayDir(p.direction.copyOf()) ?: return null
    if (dir[1] < -1e-4) {
      val fy = floorY ?: 0.0
      val t = (fy - p.origin[1]) / dir[1]
      if (t in 0.02..20.0) {
        return doubleArrayOf(p.origin[0] + dir[0] * t, p.origin[1] + dir[1] * t, p.origin[2] + dir[2] * t)
      }
    }
    return doubleArrayOf(p.origin[0] + dir[0], p.origin[1] + dir[1], p.origin[2] + dir[2])
  }

  /** Begins an interactive tape-measure segment at [start]. */
  fun beginTape(start: DoubleArray) {
    activeTape?.let {
      if (it.lineMeshId >= 0) renderer.removeDynamicMesh(it.lineMeshId)
      if (it.labelMeshId >= 0) renderer.removeDynamicMesh(it.labelMeshId)
    }
    val barGeo = SpatialMeasure.buildSegmentBarsGeometry(emptyList())
    val lblGeo = SpatialMeasure.buildVectorLabelGeometry(SpatialMeasure.formatDimension(0.0, measureUnit))
    val lineId = renderer.addDynamicMesh(barGeo.positions, barGeo.normals, barGeo.indices, MEASURE_COLOR)
    val labelId = renderer.addDynamicMesh(lblGeo.positions, lblGeo.normals, lblGeo.indices, LABEL_COLOR)
    activeTape = TapeVisual(start.copyOf(3), start.copyOf(3), lineId, labelId)
  }

  /** Updates the endpoint of the active tape-measure segment. */
  fun updateTape(end: DoubleArray) {
    val t = activeTape ?: return
    t.end = end.copyOf(3)
    val dist = XRSpatialMath.dist3(t.start, t.end)
    val barGeo = SpatialMeasure.buildSegmentBarsGeometry(listOf(t.start to t.end), 0.0022)
    val lblGeo = SpatialMeasure.buildVectorLabelGeometry(SpatialMeasure.formatDimension(dist, measureUnit))
    renderer.updateDynamicMesh(t.lineMeshId, barGeo.positions, barGeo.normals, barGeo.indices)
    renderer.updateDynamicMesh(t.labelMeshId, lblGeo.positions, lblGeo.normals, lblGeo.indices)
  }

  /** Completes the active tape-measure segment and notifies [Listener.onMeasureComplete]. */
  fun endTape() {
    val t = activeTape ?: return
    activeTape = null
    val dist = XRSpatialMath.dist3(t.start, t.end)
    if (dist < 0.002) {
      if (t.lineMeshId >= 0) renderer.removeDynamicMesh(t.lineMeshId)
      if (t.labelMeshId >= 0) renderer.removeDynamicMesh(t.labelMeshId)
      return
    }
    if (tapeSegments.size >= SpatialMeasure.MAX_TAPE_SEGMENTS) {
      val old = tapeSegments.removeAt(0)
      if (old.lineMeshId >= 0) renderer.removeDynamicMesh(old.lineMeshId)
      if (old.labelMeshId >= 0) renderer.removeDynamicMesh(old.labelMeshId)
    }
    tapeSegments.add(t)
    val formatted = SpatialMeasure.formatDimension(dist, measureUnit)
    listener?.onMeasureComplete(t.start.copyOf(), t.end.copyOf(), dist, formatted)
  }

  private fun parseHexRgba(hex: String, alpha: Float = 1f): FloatArray {
    val clean = hex.removePrefix("#")
    if (clean.length == 3) {
      val r = clean[0].digitToIntOrNull(16) ?: return MEASURE_COLOR
      val g = clean[1].digitToIntOrNull(16) ?: return MEASURE_COLOR
      val b = clean[2].digitToIntOrNull(16) ?: return MEASURE_COLOR
      return floatArrayOf((r * 17) / 255f, (g * 17) / 255f, (b * 17) / 255f, alpha)
    }
    if (clean.length == 6) {
      val r = clean.substring(0, 2).toIntOrNull(16) ?: return MEASURE_COLOR
      val g = clean.substring(2, 4).toIntOrNull(16) ?: return MEASURE_COLOR
      val b = clean.substring(4, 6).toIntOrNull(16) ?: return MEASURE_COLOR
      return floatArrayOf(r / 255f, g / 255f, b / 255f, alpha)
    }
    return MEASURE_COLOR
  }

  private fun stepDimensions(cameraWorld: FloatArray) {
    if (measureBoundsEnabled) {
      for (n in 0 until scene.nodeCount) {
        if (scene.meshBounds.getOrNull(scene.nodeMesh[n]) != null && !dimensionVisuals.containsKey(n)) {
          dimensionVisuals[n] = DimensionVisual(n, null)
        }
      }
    }
    var activeLabels = 0
    for (dv in dimensionVisuals.values) {
      val cfg = dv.trait ?: if (measureBoundsEnabled) XRDimensionsTrait(unit = measureUnit) else null
      val mb = scene.meshBounds.getOrNull(scene.nodeMesh[dv.node])
      val show =
        cfg != null &&
          mb != null &&
          session.isEffectivelyVisible(dv.node) &&
          (!cfg.showOnSelect || selectedNodeIndex == dv.node) &&
          session.nodeWorldMatrix(dv.node, world)
      if (!show || cfg == null || mb == null) {
        if (dv.barMeshId >= 0) {
          zeroMatrix()
          renderer.setDynamicMeshTransform(dv.barMeshId, matrix)
        }
        for (id in dv.labelMeshIds) {
          zeroMatrix()
          renderer.setDynamicMeshTransform(id, matrix)
        }
        continue
      }
      val wb = SpatialMeasure.computeWorldBounds(mb.copyOfRange(0, 3), mb.copyOfRange(3, 6), world)
      val unit = if (cfg.unit == "auto" && measureUnit != "auto") measureUnit else cfg.unit
      val key =
        "${Math.round(wb.min[0] * 1000)},${Math.round(wb.min[1] * 1000)},${Math.round(wb.min[2] * 1000)}|" +
          "${Math.round(wb.max[0] * 1000)},${Math.round(wb.max[1] * 1000)},${Math.round(wb.max[2] * 1000)}|" +
          "$unit|${cfg.axes.joinToString("")}|${cfg.color}"
      if (key != dv.cacheKey) {
        dv.cacheKey = key
        val callouts = SpatialMeasure.buildDimensionCallouts(wb.min, wb.max, cfg.axes)
        val segs = ArrayList<Pair<DoubleArray, DoubleArray>>(callouts.size * 3)
        for (c in callouts) {
          segs.add(c.start to c.end)
          segs.add(c.tickStartA to c.tickStartB)
          segs.add(c.tickEndA to c.tickEndB)
        }
        val barGeo = SpatialMeasure.buildSegmentBarsGeometry(segs, 0.002)
        val color = parseHexRgba(cfg.color)
        if (dv.barMeshId < 0) {
          dv.barMeshId = renderer.addDynamicMesh(barGeo.positions, barGeo.normals, barGeo.indices, color)
        } else {
          renderer.updateDynamicMesh(dv.barMeshId, barGeo.positions, barGeo.normals, barGeo.indices)
        }
        val allowed = Math.max(0, Math.min(callouts.size, SpatialMeasure.MAX_DIMENSION_LABELS - activeLabels))
        while (dv.labelMeshIds.size > allowed) {
          renderer.removeDynamicMesh(dv.labelMeshIds.removeAt(dv.labelMeshIds.lastIndex))
        }
        dv.labelPositions.clear()
        for (i in 0 until allowed) {
          val c = callouts[i]
          val lGeo = SpatialMeasure.buildVectorLabelGeometry(SpatialMeasure.formatDimension(c.lengthMeters, unit))
          if (i < dv.labelMeshIds.size) {
            renderer.updateDynamicMesh(dv.labelMeshIds[i], lGeo.positions, lGeo.normals, lGeo.indices)
          } else {
            dv.labelMeshIds.add(renderer.addDynamicMesh(lGeo.positions, lGeo.normals, lGeo.indices, color))
          }
          dv.labelPositions.add(c.labelPosition)
        }
      }
      activeLabels += dv.labelMeshIds.size
      if (dv.barMeshId >= 0) {
        identityMatrix()
        renderer.setDynamicMeshTransform(dv.barMeshId, matrix)
      }
      for (i in dv.labelMeshIds.indices) {
        billboardMatrix(dv.labelPositions[i], cameraWorld)
        renderer.setDynamicMeshTransform(dv.labelMeshIds[i], matrix)
      }
    }
    for (seg in tapeSegments) positionTape(seg, cameraWorld)
    activeTape?.let { positionTape(it, cameraWorld) }
  }

  private fun positionTape(t: TapeVisual, cameraWorld: FloatArray) {
    if (t.lineMeshId >= 0) {
      identityMatrix()
      renderer.setDynamicMeshTransform(t.lineMeshId, matrix)
    }
    if (t.labelMeshId >= 0) {
      val mid =
        doubleArrayOf(
          (t.start[0] + t.end[0]) * 0.5,
          (t.start[1] + t.end[1]) * 0.5 + 0.035,
          (t.start[2] + t.end[2]) * 0.5,
        )
      billboardMatrix(mid, cameraWorld)
      renderer.setDynamicMeshTransform(t.labelMeshId, matrix)
    }
  }

  private fun zeroMatrix() {
    matrix.fill(0f)
    matrix[15] = 1f
  }

  private fun identityMatrix() {
    matrix.fill(0f)
    matrix[0] = 1f
    matrix[5] = 1f
    matrix[10] = 1f
    matrix[15] = 1f
  }

  private fun billboardMatrix(pos: DoubleArray, cameraWorld: FloatArray) {
    val dx = cameraWorld.getOrElse(12) { 0f } - pos[0]
    val dy = cameraWorld.getOrElse(13) { 1.6f } - pos[1]
    val dz = cameraWorld.getOrElse(14) { 0f } - pos[2]
    val horiz = Math.hypot(dx, dz)
    val yaw = Math.atan2(dx, dz)
    val pitch = -Math.atan2(dy, Math.max(horiz, 1e-5))
    val q = MagneticSnap.quatFromEulerYXZ(pitch, yaw, 0.0)
    val dMat = XRSpatialMath.mat4FromTRS(pos, q, doubleArrayOf(1.0, 1.0, 1.0))
    for (i in 0 until 16) matrix[i] = dMat[i].toFloat()
  }

  /**
   * Evaluates and applies `magnetic-snap` constraints for a manipulated node, updating its pose,
   * preview torus ring, and firing [Listener.onSnap] / [Listener.onUnsnap].
   */
  @JvmOverloads
  fun applyMagneticSnap(
    nodeIndex: Int,
    rawWorldPosition: DoubleArray,
    rawWorldQuaternion: DoubleArray,
    planes: List<MagneticSnap.SurfacePlane> = emptyList(),
    released: Boolean = false,
  ): MagneticSnap.Evaluation? {
    if (disposed || nodeIndex !in 0 until scene.nodeCount) return null
    val cfg = snapTraits[nodeIndex] ?: return null
    val sockets = ArrayList<MagneticSnap.SocketCandidate>(socketTraits.size)
    val socketNodeById = HashMap<String, Int>(socketTraits.size)
    for ((sNode, sCfg) in socketTraits) {
      if (sNode == nodeIndex || !session.isEffectivelyVisible(sNode)) continue
      if (!session.nodeWorldMatrix(sNode, world)) continue
      val id = "socket#$sNode"
      val q = XRSpatialMath.extractQuaternion(world)
      sockets.add(
        MagneticSnap.SocketCandidate(
          id = id,
          tag = sCfg.tag,
          position = doubleArrayOf(world[12], world[13], world[14]),
          quaternion = q,
          radius = sCfg.radius,
          alignRotation = sCfg.alignRotation,
          highlightColor = sCfg.highlightColor,
        )
      )
      socketNodeById[id] = sNode
    }
    val mb = scene.meshBounds.getOrNull(scene.nodeMesh[nodeIndex])
    val curT = session.nodeTransform(nodeIndex)
    val sy = curT?.scale?.getOrNull(1)?.toDouble() ?: 1.0
    val bottomOffset = if (mb != null && mb[1] < -0.001) -mb[1] * sy else 0.0
    val prevId = activeSocketByNode[nodeIndex]
    val ev =
      MagneticSnap.evaluate(
        position = rawWorldPosition,
        quaternion = rawWorldQuaternion,
        config = cfg,
        sockets = sockets,
        planes = planes,
        currentSocketId = prevId,
        bottomOffset = bottomOffset,
        defaultFloorY = floorY ?: 0.0,
      )

    if (prevId != null && prevId != ev.matchedSocketId) {
      listener?.onUnsnap(nodeIndex, socketNodeById[prevId])
    }
    if (ev.matchedSocketId != null) {
      if (ev.matchedSocketId != prevId) {
        listener?.onSnap(nodeIndex, socketNodeById[ev.matchedSocketId], ev.position.copyOf(), ev.quaternion.copyOf(), "socket")
      }
      activeSocketByNode[nodeIndex] = ev.matchedSocketId
    } else {
      activeSocketByNode.remove(nodeIndex)
      if (released && (ev.mode == "grid" || ev.mode == "surface")) {
        listener?.onSnap(nodeIndex, null, ev.position.copyOf(), ev.quaternion.copyOf(), ev.mode)
      }
    }
    if (released) {
      activeSocketByNode.remove(nodeIndex)
    }

    if (ev.mode != "none" && curT != null) {
      session.setNodeWorldPose(nodeIndex, ev.position, ev.quaternion)
    }

    val previewSock = if (!released && ev.previewSocketId != null) sockets.firstOrNull { it.id == ev.previewSocketId } else null
    if (previewSock == null) {
      if (previewRingMeshId >= 0) {
        zeroMatrix()
        renderer.setDynamicMeshTransform(previewRingMeshId, matrix)
      }
    } else {
      val rad = Math.max(0.03, previewSock.radius * 0.75)
      if (previewRingMeshId < 0 || Math.abs(previewRingRadius - rad) > 1e-3) {
        if (previewRingMeshId >= 0) renderer.removeDynamicMesh(previewRingMeshId)
        val rGeo = MagneticSnap.buildSnapRingGeometry(rad, Math.max(0.004, rad * 0.08))
        previewRingMeshId =
          renderer.addDynamicMesh(rGeo.positions, rGeo.normals, rGeo.indices, parseHexRgba(previewSock.highlightColor, 0.55f))
        previewRingRadius = rad
      }
      val pulse = 1.0 + 0.07 * Math.sin(pulsePhase)
      val dMat = XRSpatialMath.mat4FromTRS(previewSock.position, previewSock.quaternion, doubleArrayOf(pulse, pulse, pulse))
      for (i in 0 until 16) matrix[i] = dMat[i].toFloat()
      renderer.setDynamicMeshTransform(previewRingMeshId, matrix)
    }
    return ev
  }

  private fun isNodeGazeEligible(nodeIndex: Int): Boolean {
    if (nodeIndex in pointerNoneNodes || !session.isEffectivelyVisible(nodeIndex)) return false
    if (gazeTraits.containsKey(nodeIndex)) return true
    val t = session.traits.firstOrNull { it.nodeIndex == nodeIndex } ?: return false
    return t.grabbable || t.holdToAsk != null
  }

  private fun raycastGazeNode(
    origin: DoubleArray,
    dir: DoubleArray,
    maxDist: Double = 25.0,
  ): Triple<Int, DoubleArray, DoubleArray>? {
    var bestNode = -1
    var bestT = maxDist
    var bestPoint = doubleArrayOf(0.0, 0.0, 0.0)
    var bestNormal = doubleArrayOf(0.0, 0.0, 1.0)
    for (node in 0 until scene.nodeCount) {
      val b = scene.meshBounds.getOrNull(scene.nodeMesh[node]) ?: continue
      if (node in pointerNoneNodes || !session.isEffectivelyVisible(node)) continue
      if (!session.nodeWorldMatrix(node, world)) continue
      if (!XRSpatialMath.mat4Invert(world, invWorld)) continue
      val lo = XRSpatialMath.transformPoint(invWorld, origin[0], origin[1], origin[2], DoubleArray(3))
      val farWorld = doubleArrayOf(origin[0] + dir[0], origin[1] + dir[1], origin[2] + dir[2])
      val lf = XRSpatialMath.transformPoint(invWorld, farWorld[0], farWorld[1], farWorld[2], DoubleArray(3))
      val ld = doubleArrayOf(lf[0] - lo[0], lf[1] - lo[1], lf[2] - lo[2])
      var tMin = 0.0
      var tMax = Double.POSITIVE_INFINITY
      var hitAxis = 0
      var hitSign = -1.0
      var miss = false
      for (k in 0 until 3) {
        if (Math.abs(ld[k]) < 1e-9) {
          if (lo[k] < b[k] || lo[k] > b[3 + k]) {
            miss = true
            break
          }
        } else {
          val inv = 1.0 / ld[k]
          var t1 = (b[k] - lo[k]) * inv
          var t2 = (b[3 + k] - lo[k]) * inv
          var sign = -1.0
          if (t1 > t2) {
            val tmp = t1
            t1 = t2
            t2 = tmp
            sign = 1.0
          }
          if (t1 > tMin) {
            tMin = t1
            hitAxis = k
            hitSign = sign
          }
          if (t2 < tMax) tMax = t2
          if (tMin > tMax) {
            miss = true
            break
          }
        }
      }
      if (miss || tMax < 1e-4) continue
      val tLocal = if (tMin >= 1e-4) tMin else tMax
      val lp = doubleArrayOf(lo[0] + ld[0] * tLocal, lo[1] + ld[1] * tLocal, lo[2] + ld[2] * tLocal)
      val wp = XRSpatialMath.transformPoint(world, lp[0], lp[1], lp[2], DoubleArray(3))
      val dist = XRSpatialMath.dist3(origin, wp)
      if (dist >= bestT) continue
      val ln = doubleArrayOf(0.0, 0.0, 0.0)
      ln[hitAxis] = hitSign
      val wnRaw =
        doubleArrayOf(
          invWorld[0] * ln[0] + invWorld[1] * ln[1] + invWorld[2] * ln[2],
          invWorld[4] * ln[0] + invWorld[5] * ln[1] + invWorld[6] * ln[2],
          invWorld[8] * ln[0] + invWorld[9] * ln[1] + invWorld[10] * ln[2],
        )
      var wn = XRSpatialMath.normalizeRayDir(wnRaw) ?: doubleArrayOf(-dir[0], -dir[1], -dir[2])
      if (XRSpatialMath.dot3(wn, dir) > 0.0) {
        wn = doubleArrayOf(-wn[0], -wn[1], -wn[2])
      }
      bestNode = node
      bestT = dist
      bestPoint = wp
      bestNormal = wn
    }
    return if (bestNode >= 0) Triple(bestNode, bestPoint, bestNormal) else null
  }

  /**
   * Steps `gaze-dwell` for the current eye/head ray, updating the constant-angular-size surface
   * reticle and firing [Listener.onGazeEnter], [Listener.onGazeLeave], and [Listener.onGazeDwell].
   */
  @JvmOverloads
  fun stepGazeDwell(
    origin: DoubleArray,
    rawDirection: DoubleArray,
    dtSeconds: Double,
    autoEnabled: Boolean = false,
  ) {
    if (disposed) return
    val active =
      when (gazeDwellMode) {
        "on", "true" -> true
        "auto" -> autoEnabled
        else -> gazeTraits.isNotEmpty()
      }
    if (!active) {
      clearActiveGaze()
      return
    }
    val dir = GazeDwell.smoothDirection(smoothedGazeDir, rawDirection)
    smoothedGazeDir = dir
    val hit = raycastGazeNode(origin, dir)
    var candidateNode = if (hit != null && isNodeGazeEligible(hit.first)) hit.first else -1
    var hitPoint = hit?.second ?: doubleArrayOf(0.0, 0.0, 0.0)
    var hitNormal = hit?.third ?: doubleArrayOf(0.0, 0.0, 1.0)

    if (candidateNode != activeGazeNode && activeGazeNode >= 0 && session.isEffectivelyVisible(activeGazeNode)) {
      val toPrev =
        doubleArrayOf(
          lastGazeHitPoint[0] - origin[0],
          lastGazeHitPoint[1] - origin[1],
          lastGazeHitPoint[2] - origin[2],
        )
      if (XRSpatialMath.len3(toPrev[0], toPrev[1], toPrev[2]) > 1e-4 &&
        GazeDwell.angleBetweenDeg(dir, toPrev) <= GazeDwell.GRACE_CONE_DEG
      ) {
        candidateNode = activeGazeNode
        hitPoint = lastGazeHitPoint
        hitNormal = lastGazeHitNormal
      }
    }

    if (candidateNode < 0) {
      clearActiveGaze()
      return
    }

    if (candidateNode != activeGazeNode) {
      if (activeGazeNode >= 0) listener?.onGazeLeave(activeGazeNode)
      activeGazeNode = candidateNode
      gazeElapsedMs = 0.0
      gazeCompleted = false
      lastGazeHitPoint = hitPoint.copyOf()
      lastGazeHitNormal = hitNormal.copyOf()
      listener?.onGazeEnter(candidateNode, hitPoint.copyOf(), hitNormal.copyOf())
    } else {
      lastGazeHitPoint = hitPoint.copyOf()
      lastGazeHitNormal = hitNormal.copyOf()
    }

    val trait = gazeTraits[candidateNode]
    val dwellMs = (trait?.dwellMs ?: defaultDwellMs).coerceIn(250, 10000).toDouble()
    val repeat = trait?.repeat == true
    val action = trait?.action ?: if (session.traits.firstOrNull { it.nodeIndex == candidateNode }?.holdToAsk != null) "ask" else "select"
    val dtMs = dtSeconds.coerceIn(0.0, 0.1) * 1000.0
    var progress = 0.0

    if (!gazeCompleted) {
      gazeElapsedMs += dtMs
      progress = GazeDwell.computeDwellProgress(gazeElapsedMs, dwellMs)
      if (progress >= 1.0) {
        listener?.onGazeDwell(candidateNode, action, lastGazeHitPoint.copyOf())
        if (action == "select") {
          session.dispatchSelect(candidateNode)
        }
        if (repeat) {
          gazeElapsedMs = 0.0
          progress = 0.0
        } else {
          gazeCompleted = true
          progress = 0.0
        }
      }
    }

    val bucket = Math.round(progress * 24.0).toInt()
    if (gazeReticleMeshId < 0 || bucket != lastReticleProgressBucket) {
      lastReticleProgressBucket = bucket
      val geo = GazeDwell.buildReticleGeometry(bucket / 24.0, 24)
      if (gazeReticleMeshId < 0) {
        gazeReticleMeshId = renderer.addDynamicMesh(geo.positions, geo.normals, geo.indices, GAZE_RETICLE_COLOR)
      } else {
        renderer.updateDynamicMesh(gazeReticleMeshId, geo.positions, geo.normals, geo.indices)
      }
    }
    if (gazeReticleMeshId >= 0) {
      val dist = Math.max(0.15, XRSpatialMath.dist3(origin, lastGazeHitPoint))
      val outerR = Math.max(0.004, GazeDwell.RETICLE_ANGULAR_SCALE * dist)
      val offsetPos =
        doubleArrayOf(
          lastGazeHitPoint[0] + lastGazeHitNormal[0] * 0.003,
          lastGazeHitPoint[1] + lastGazeHitNormal[1] * 0.003,
          lastGazeHitPoint[2] + lastGazeHitNormal[2] * 0.003,
        )
      val q = GazeDwell.quatFromUnitVectors(doubleArrayOf(0.0, 0.0, 1.0), lastGazeHitNormal)
      val dMat = XRSpatialMath.mat4FromTRS(offsetPos, q, doubleArrayOf(outerR, outerR, outerR))
      for (i in 0 until 16) matrix[i] = dMat[i].toFloat()
      renderer.setDynamicMeshTransform(gazeReticleMeshId, matrix)
    }
  }

  private fun clearActiveGaze() {
    if (activeGazeNode >= 0) {
      val prev = activeGazeNode
      activeGazeNode = -1
      gazeElapsedMs = 0.0
      gazeCompleted = false
      listener?.onGazeLeave(prev)
    }
    if (gazeReticleMeshId >= 0) {
      zeroMatrix()
      renderer.setDynamicMeshTransform(gazeReticleMeshId, matrix)
    }
  }

  /**
   * Sets the target explosion factor in `[0..1]` and notifies [Listener.onExplodeChange] when
   * changed.
   */
  @JvmOverloads
  fun setExplode(factor: Double, source: String = "api") {
    val clamped = XRSpatialMath.clampNum(factor, 0.0, 1.0, 0.0)
    if (Math.abs(clamped - targetExplodeFactor) <= 1e-4) return
    targetExplodeFactor = clamped
    listener?.onExplodeChange(clamped, source)
  }

  private fun ensureRestAssemblyCaptured() {
    if (restCaptured) return
    restCaptured = true
    restParts.clear()
    var minX = Double.POSITIVE_INFINITY
    var minY = Double.POSITIVE_INFINITY
    var minZ = Double.POSITIVE_INFINITY
    var maxX = Double.NEGATIVE_INFINITY
    var maxY = Double.NEGATIVE_INFINITY
    var maxZ = Double.NEGATIVE_INFINITY

    for (node in 0 until scene.nodeCount) {
      val b = scene.meshBounds.getOrNull(scene.nodeMesh[node]) ?: continue
      val t = session.nodeTransform(node) ?: continue
      if (!session.nodeWorldMatrix(node, world)) continue
      val wb = SpatialMeasure.computeWorldBounds(b.copyOfRange(0, 3), b.copyOfRange(3, 6), world)
      minX = minOf(minX, wb.min[0])
      minY = minOf(minY, wb.min[1])
      minZ = minOf(minZ, wb.min[2])
      maxX = maxOf(maxX, wb.max[0])
      maxY = maxOf(maxY, wb.max[1])
      maxZ = maxOf(maxZ, wb.max[2])
      var depth = 1
      var p = scene.parents.getOrElse(node) { -1 }
      while (p >= 0 && depth < 32) {
        depth++
        p = scene.parents.getOrElse(p) { -1 }
      }
      restParts.add(
        RestPart(
          node = node,
          restPos = doubleArrayOf(t.translation[0].toDouble(), t.translation[1].toDouble(), t.translation[2].toDouble()),
          restRot = t.rotation.copyOf(),
          restScale = t.scale.copyOf(),
          restWorldCenter = wb.center.copyOf(),
          depth = depth,
        )
      )
    }
    if (minX.isFinite()) {
      assemblyCenter = doubleArrayOf((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5)
      assemblyRadius = Math.max(0.05, XRSpatialMath.len3(maxX - minX, maxY - minY, maxZ - minZ) * 0.5)
    }
  }

  /** Steps `exploded-view` spring smoothing, node offsets, dashed leader lines, and section gizmo. */
  fun stepExplodedView(dt: Double) {
    if (disposed) return
    val sec = ExplodedView.parseSectionPlane(sectionPlaneSpec, assemblyCenter)
    if (targetExplodeFactor <= 1e-5 && currentExplodeFactor <= 1e-5 && !sec.enabled) {
      if (explodeLeaderMeshId >= 0) {
        zeroMatrix()
        renderer.setDynamicMeshTransform(explodeLeaderMeshId, matrix)
      }
      if (sectionGizmoMeshId >= 0) {
        zeroMatrix()
        renderer.setDynamicMeshTransform(sectionGizmoMeshId, matrix)
      }
      return
    }
    ensureRestAssemblyCaptured()
    val alpha = 1.0 - Math.exp(-12.0 * dt.coerceIn(0.0, 0.1))
    currentExplodeFactor += (targetExplodeFactor - currentExplodeFactor) * alpha
    if (Math.abs(targetExplodeFactor - currentExplodeFactor) < 1e-4) {
      currentExplodeFactor = targetExplodeFactor
    }

    var maxLayer = 1
    for (tr in explodeTraits.values) maxLayer = maxOf(maxLayer, tr.layer)
    val explicitOnly = explodeTraits.isNotEmpty()
    val leaderSegs = ArrayList<Pair<DoubleArray, DoubleArray>>()
    val isNowExploded = currentExplodeFactor > 1e-5 || targetExplodeFactor > 0.0

    if (isNowExploded || wasExploded) {
      if (isNowExploded && !wasExploded) {
        restCaptured = false
        ensureRestAssemblyCaptured()
      }
      for ((idx, part) in restParts.withIndex()) {
        val tr = explodeTraits[part.node]
        if (explicitOnly && tr == null) continue
        val offset =
          ExplodedView.computeNodeOffset(
            restPosition = part.restWorldCenter,
            assemblyCenter = assemblyCenter,
            assemblyRadius = assemblyRadius,
            factor = currentExplodeFactor,
            mode = explodeMode,
            explodeScale = explodeScale,
            trait = tr,
            maxLayer = maxLayer,
            nodeIndex = idx,
            nodeCount = restParts.size,
            hierarchyDepth = part.depth,
          )
        val nextPos =
          floatArrayOf(
            (part.restPos[0] + offset[0]).toFloat(),
            (part.restPos[1] + offset[1]).toFloat(),
            (part.restPos[2] + offset[2]).toFloat(),
          )
        session.setNodeTransform(part.node, nextPos, part.restRot, part.restScale)
        renderer.setNodeTransform(part.node, nextPos, part.restRot, part.restScale)
        if (currentExplodeFactor > 0.02 && (tr?.leaderLine != false) && session.nodeWorldMatrix(part.node, world)) {
          val b = scene.meshBounds.getOrNull(scene.nodeMesh[part.node])
          if (b != null) {
            val curWb = SpatialMeasure.computeWorldBounds(b.copyOfRange(0, 3), b.copyOfRange(3, 6), world)
            if (XRSpatialMath.dist3(part.restWorldCenter, curWb.center) > 0.01 && leaderSegs.size < 512) {
              leaderSegs.addAll(SpatialMeasure.buildDashedSegments(part.restWorldCenter, curWb.center))
            }
          }
        }
      }
      wasExploded = isNowExploded
    }

    if (leaderSegs.isEmpty()) {
      if (explodeLeaderMeshId >= 0) {
        zeroMatrix()
        renderer.setDynamicMeshTransform(explodeLeaderMeshId, matrix)
      }
    } else {
      val geo = SpatialMeasure.buildSegmentBarsGeometry(leaderSegs, 0.0014)
      if (explodeLeaderMeshId < 0) {
        explodeLeaderMeshId = renderer.addDynamicMesh(geo.positions, geo.normals, geo.indices, EXPLODE_LEADER_COLOR)
      } else {
        renderer.updateDynamicMesh(explodeLeaderMeshId, geo.positions, geo.normals, geo.indices)
      }
      identityMatrix()
      renderer.setDynamicMeshTransform(explodeLeaderMeshId, matrix)
    }

    if (sec.enabled) {
      val halfExt = Math.max(0.15, assemblyRadius * 1.15)
      if (sectionGizmoMeshId < 0 || Math.abs(halfExt - lastSectionGizmoRadius) > 1e-3) {
        if (sectionGizmoMeshId >= 0) renderer.removeDynamicMesh(sectionGizmoMeshId)
        val gGeo = ExplodedView.buildSectionGizmoGeometry(halfExt)
        sectionGizmoMeshId = renderer.addDynamicMesh(gGeo.positions, gGeo.normals, gGeo.indices, MEASURE_COLOR)
        lastSectionGizmoRadius = halfExt
      }
      val d = sec.constant - XRSpatialMath.dot3(assemblyCenter, sec.normal)
      val planeCenter =
        doubleArrayOf(
          assemblyCenter[0] + sec.normal[0] * d,
          assemblyCenter[1] + sec.normal[1] * d,
          assemblyCenter[2] + sec.normal[2] * d,
        )
      val q = GazeDwell.quatFromUnitVectors(doubleArrayOf(0.0, 0.0, 1.0), sec.normal)
      val dMat = XRSpatialMath.mat4FromTRS(planeCenter, q, doubleArrayOf(1.0, 1.0, 1.0))
      for (i in 0 until 16) matrix[i] = dMat[i].toFloat()
      renderer.setDynamicMeshTransform(sectionGizmoMeshId, matrix)
    } else if (sectionGizmoMeshId >= 0) {
      zeroMatrix()
      renderer.setDynamicMeshTransform(sectionGizmoMeshId, matrix)
    }
  }

  // ---- Persistent anchors ----------------------------------------------------------------------

  private fun readAnchorStore(key: String): String? =
    anchorStoreGet?.invoke(key) ?: anchorStorage[key]

  private fun writeAnchorStore(key: String, value: String?) {
    val writer = anchorStoreSet
    if (writer != null) {
      writer(key, value)
    } else if (value == null) {
      anchorStorage.remove(key)
    } else {
      anchorStorage[key] = value
    }
  }

  private fun resolveStorageKey(): String? {
    val raw = persistentAnchorsNamespace?.trim()
    if (raw != null && (raw.equals("false", ignoreCase = true) || raw.equals("none", ignoreCase = true))) {
      return null
    }
    val ns =
      if (raw.isNullOrEmpty() || raw.equals("true", ignoreCase = true)) {
        if (anchorPersistTraits.isNotEmpty() || raw != null) "default" else return null
      } else {
        XRLiveSceneCoreHelper.safeAnchorId(raw) ?: return null
      }
    return PersistentAnchors.ANCHOR_STORAGE_PREFIX + ns
  }

  private fun resolveNodePersistKey(node: Int): String? {
    val trait = anchorPersistTraits[node]
    if (trait != null) {
      if (!trait.persist) return null
      if (trait.id != null) return trait.id
    } else if (persistentAnchorsNamespace.isNullOrBlank() || node !in grabbableNodes) {
      return null
    }
    return XRLiveSceneCoreHelper.safeAnchorId(scene.nodeNames.getOrNull(node)) ?: "node_$node"
  }

  private fun collectPersistedPoses(): Map<String, PersistentAnchors.PersistedPose> {
    val poses = LinkedHashMap<String, PersistentAnchors.PersistedPose>()
    for (node in 0 until scene.nodeCount) {
      if (poses.size >= PersistentAnchors.MAX_PERSISTED_NODES) break
      val key = resolveNodePersistKey(node) ?: continue
      val t = session.nodeTransform(node) ?: continue
      val clean =
        PersistentAnchors.sanitizePose(
          doubleArrayOf(t.translation[0].toDouble(), t.translation[1].toDouble(), t.translation[2].toDouble()),
          doubleArrayOf(
            t.rotation[0].toDouble(),
            t.rotation[1].toDouble(),
            t.rotation[2].toDouble(),
            t.rotation[3].toDouble(),
          ),
          doubleArrayOf(t.scale[0].toDouble(), t.scale[1].toDouble(), t.scale[2].toDouble()),
        ) ?: continue
      poses[key] = clean
    }
    return poses
  }

  private fun applyPersistedPoses(poses: Map<String, PersistentAnchors.PersistedPose>): Int {
    var applied = 0
    for (node in 0 until scene.nodeCount) {
      val explicitId = anchorPersistTraits[node]?.id
      val fallbackKey = XRLiveSceneCoreHelper.safeAnchorId(scene.nodeNames.getOrNull(node)) ?: "node_$node"
      val pose = (if (explicitId != null) poses[explicitId] else null) ?: poses[fallbackKey] ?: continue
      val p = FloatArray(3) { pose.p[it].toFloat() }
      val q = FloatArray(4) { pose.q[it].toFloat() }
      val s = FloatArray(3) { pose.s[it].toFloat() }
      session.setNodeTransform(node, p, q, s)
      renderer.setNodeTransform(node, p, q, s)
      applied++
    }
    return applied
  }

  /** Saves current persisted/manipulable node transforms to the active namespace store. */
  fun savePersistedAnchors(): Int {
    if (disposed) return 0
    val storageKey = resolveStorageKey() ?: return 0
    val poses = collectPersistedPoses()
    writeAnchorStore(storageKey, PersistentAnchors.serializePayload(poses))
    return poses.size
  }

  /**
   * Restores persisted node transforms from an optional `#xr-state=` [urlHash] (highest priority)
   * or the active namespace store, firing [Listener.onAnchorsRestored] when at least one pose
   * applies.
   */
  @JvmOverloads
  fun restorePersistedAnchors(urlHash: String? = null): Int {
    if (disposed) return 0
    val hashToken = PersistentAnchors.extractHashToken(urlHash)
    if (hashToken != null) {
      val fromHash = PersistentAnchors.decodeState(hashToken)
      if (fromHash != null && fromHash.isNotEmpty()) {
        val count = applyPersistedPoses(fromHash)
        if (count > 0) listener?.onAnchorsRestored(count, "url-hash")
        return count
      }
    }
    val storageKey = resolveStorageKey() ?: return 0
    val raw = readAnchorStore(storageKey) ?: return 0
    val fromStore = PersistentAnchors.deserializePayload(raw) ?: return 0
    val count = applyPersistedPoses(fromStore)
    if (count > 0) listener?.onAnchorsRestored(count, "storage")
    return count
  }

  /** Exports all persisted/grabbable node transforms as a base64url `#xr-state=` token. */
  fun exportAnchorState(): String = PersistentAnchors.encodeState(collectPersistedPoses())

  /** Imports and applies a base64url `#xr-state=` token, returning the number of restored nodes. */
  @JvmOverloads
  fun importAnchorState(token: String, source: String = "url-hash"): Int {
    if (disposed) return 0
    val decoded = PersistentAnchors.decodeState(token) ?: return 0
    val count = applyPersistedPoses(decoded)
    if (count > 0) {
      resolveStorageKey()?.let { writeAnchorStore(it, PersistentAnchors.serializePayload(decoded)) }
      listener?.onAnchorsRestored(count, source)
    }
    return count
  }

  /** Clears persisted anchor data for the active namespace. */
  fun clearPersistedAnchors() {
    resolveStorageKey()?.let { writeAnchorStore(it, null) }
  }

  // ---- Spatial locomotion ----------------------------------------------------------------------

  /**
   * Evaluates a ballistic parabolic teleport arc from `(origin, direction)`, updating the 3D arc
   * ribbon and landing target ring visuals.
   */
  fun aimTeleport(origin: DoubleArray, direction: DoubleArray): SpatialLocomotion.TeleportArcHit {
    val samples = SpatialLocomotion.sampleParabola(origin, direction)
    val fy = XRSpatialMath.clampNum(floorY ?: 0.0, -100.0, 100.0, 0.0)
    val hasExplicitWalkable = navigableTraits.values.any { it == "walkable" }
    val visited = ArrayList<DoubleArray>(samples.size)
    visited.add(samples[0])
    var hitResult: SpatialLocomotion.TeleportArcHit? = null

    for (i in 0 until samples.size - 1) {
      val a = samples[i]
      val b = samples[i + 1]
      val dx = b[0] - a[0]
      val dy = b[1] - a[1]
      val dz = b[2] - a[2]
      val segLen = XRSpatialMath.len3(dx, dy, dz)
      if (segLen < 1e-5) continue
      val segDir = doubleArrayOf(dx / segLen, dy / segLen, dz / segLen)

      val rayHit = raycastGazeNode(a, segDir, segLen + 1e-4)
      if (rayHit != null) {
        val (hitNode, hitPt, hitNormal) = rayHit
        visited.add(hitPt)
        val nav = navigableTraits[hitNode]
        val slopeOk = hitNormal[1] > SpatialLocomotion.MIN_WALKABLE_NORMAL_Y
        val navOk = if (hasExplicitWalkable) nav == "walkable" else nav != "blocked"
        hitResult =
          SpatialLocomotion.TeleportArcHit(
            valid = slopeOk && navOk,
            point = hitPt,
            normal = hitNormal,
            points = visited,
            hitNodeIndex = hitNode,
          )
        break
      }

      if (!hasExplicitWalkable && a[1] >= fy && b[1] <= fy && a[1] != b[1]) {
        val u = (a[1] - fy) / (a[1] - b[1])
        val groundPt = doubleArrayOf(a[0] + dx * u, fy, a[2] + dz * u)
        visited.add(groundPt)
        hitResult =
          SpatialLocomotion.TeleportArcHit(
            valid = true,
            point = groundPt,
            normal = doubleArrayOf(0.0, 1.0, 0.0),
            points = visited,
            hitNodeIndex = -1,
          )
        break
      }

      visited.add(b)
    }

    val resolved =
      hitResult
        ?: SpatialLocomotion.TeleportArcHit(
          valid = false,
          point = visited.last().copyOf(),
          normal = doubleArrayOf(0.0, 1.0, 0.0),
          points = visited,
          hitNodeIndex = -1,
        )

    pendingTeleportPoint = resolved.point.copyOf()
    pendingTeleportValid = resolved.valid

    if (!disposed) {
      val color = if (resolved.valid) MEASURE_COLOR else INVALID_TELEPORT_COLOR
      val arcGeo = SpatialLocomotion.buildArcGeometry(resolved.points)
      if (teleportArcMeshId < 0 || teleportArcValidColor != resolved.valid) {
        if (teleportArcMeshId >= 0) renderer.removeDynamicMesh(teleportArcMeshId)
        teleportArcMeshId = renderer.addDynamicMesh(arcGeo.positions, arcGeo.normals, arcGeo.indices, color)
        teleportArcValidColor = resolved.valid
      } else {
        renderer.updateDynamicMesh(teleportArcMeshId, arcGeo.positions, arcGeo.normals, arcGeo.indices)
      }
      identityMatrix()
      renderer.setDynamicMeshTransform(teleportArcMeshId, matrix)

      val ringGeo = MagneticSnap.buildSnapRingGeometry(0.18, 0.018)
      if (teleportRingMeshId < 0 || teleportRingValidColor != resolved.valid) {
        if (teleportRingMeshId >= 0) renderer.removeDynamicMesh(teleportRingMeshId)
        teleportRingMeshId = renderer.addDynamicMesh(ringGeo.positions, ringGeo.normals, ringGeo.indices, color)
        teleportRingValidColor = resolved.valid
      }
      val ringPos =
        doubleArrayOf(
          resolved.point[0] + resolved.normal[0] * 0.004,
          resolved.point[1] + resolved.normal[1] * 0.004,
          resolved.point[2] + resolved.normal[2] * 0.004,
        )
      val ringQuat = GazeDwell.quatFromUnitVectors(doubleArrayOf(0.0, 1.0, 0.0), resolved.normal)
      val dMat = XRSpatialMath.mat4FromTRS(ringPos, ringQuat, doubleArrayOf(1.0, 1.0, 1.0))
      for (i in 0 until 16) matrix[i] = dMat[i].toFloat()
      renderer.setDynamicMeshTransform(teleportRingMeshId, matrix)
    }

    return resolved
  }

  /** Cancels any active teleport preview and hides the arc and landing ring. */
  fun cancelTeleport() {
    pendingTeleportPoint = null
    pendingTeleportValid = false
    if (teleportArcMeshId >= 0) {
      zeroMatrix()
      renderer.setDynamicMeshTransform(teleportArcMeshId, matrix)
    }
    if (teleportRingMeshId >= 0) {
      zeroMatrix()
      renderer.setDynamicMeshTransform(teleportRingMeshId, matrix)
    }
  }

  /**
   * Commits the currently aimed teleport if valid, updating [rigOffset], triggering the comfort
   * vignette, and firing [Listener.onTeleport].
   */
  fun commitTeleport(): Boolean {
    if (disposed) return false
    val target = pendingTeleportPoint
    val valid = pendingTeleportValid
    cancelTeleport()
    if (!valid || target == null) return false
    val from = rigOffset.copyOf()
    target.copyInto(rigOffset, 0, 0, 3)
    if (comfortVignetteEnabled) {
      vignetteRemainingMs = SpatialLocomotion.COMFORT_VIGNETTE_MS
    }
    listener?.onTeleport(from, rigOffset.copyOf(), rigYawDeg)
    return true
  }

  /**
   * Applies horizontal thumbstick deflection [axisX] (`-1..1`) using hysteresis-guarded discrete
   * snap-turns, returning the applied yaw delta in degrees (`0.0` when latched or below threshold).
   */
  fun applySnapTurnAxis(axisX: Double): Double {
    if (disposed) return 0.0
    val step = SpatialLocomotion.evaluateSnapTurn(axisX, snapTurnLatched, snapTurnDeg)
    snapTurnLatched = step.latched
    if (step.deltaYawDeg != 0.0) {
      var next = (rigYawDeg + step.deltaYawDeg) % 360.0
      if (next > 180.0) next -= 360.0
      if (next <= -180.0) next += 360.0
      rigYawDeg = next
      if (comfortVignetteEnabled) {
        vignetteRemainingMs = SpatialLocomotion.COMFORT_VIGNETTE_MS
      }
    }
    return step.deltaYawDeg
  }

  private fun layoutOf(h: HandleNode): ManipulationHandles.Layout? {
    val b = scene.meshBounds.getOrNull(scene.nodeMesh[h.node]) ?: return null
    if (!session.nodeWorldMatrix(h.node, world)) return null
    return ManipulationHandles.computeLayout(b.copyOfRange(0, 3), b.copyOfRange(3, 6), world).also { h.layout = it }
  }

  private fun placeHandles(h: HandleNode) {
    val layout = layoutOf(h) ?: return
    val visible = session.isEffectivelyVisible(h.node)
    val size = layout.handleRadius * 2
    for (k in 0 until 4) {
      val c = layout.corners.getOrNull(k) ?: continue
      boxMatrix(c, size, size, size, 0.0, visible)
      renderer.setDynamicMeshTransform(h.meshIds[k], matrix)
    }
    val showPedestal = visible && h.trait.rotateAxis != "none"
    val len = XRSpatialMath.dist3(layout.pedestalStart, layout.pedestalEnd)
    boxMatrix(layout.pedestalCenter, len, size * 0.5, size * 0.5, layout.yaw, showPedestal)
    renderer.setDynamicMeshTransform(h.meshIds[4], matrix)
  }

  /** Column-major TRS for a unit cube scaled to (sx, sy, sz), yawed, at [c]; zero scale hides it. */
  private fun boxMatrix(c: DoubleArray, sx: Double, sy: Double, sz: Double, yaw: Double, visible: Boolean) {
    val k = if (visible) 1.0 else 0.0
    val cs = Math.cos(yaw)
    val sn = Math.sin(yaw)
    matrix.fill(0f)
    matrix[0] = (cs * sx * k).toFloat()
    matrix[2] = (-sn * sx * k).toFloat()
    matrix[5] = (sy * k).toFloat()
    matrix[8] = (sn * sz * k).toFloat()
    matrix[10] = (cs * sz * k).toFloat()
    matrix[12] = c[0].toFloat()
    matrix[13] = c[1].toFloat()
    matrix[14] = c[2].toFloat()
    matrix[15] = 1f
  }

  private fun stepEmitter(e: Emitter, dt: Double, cameraWorld: FloatArray) {
    if (!session.nodeWorldMatrix(e.node, world)) return
    e.emitter.step(dt, world[12], world[13], world[14], floorY)
    val n = e.emitter.count
    if (n == 0) return
    val visible = session.isEffectivelyVisible(e.node)
    val geo = particleQuads(e.emitter.positions, n, cameraWorld, if (visible) PARTICLE_SIZE else 0.0)
    if (e.meshId < 0) {
      e.meshId = renderer.addDynamicMesh(geo.first, null, geo.second, PARTICLE_COLORS[e.emitter.options.preset] ?: PARTICLE_DEFAULT_COLOR)
    } else {
      renderer.updateDynamicMesh(e.meshId, geo.first, null, geo.second)
    }
  }

  private fun stepSplat(sc: SplatCloud, dt: Double, cameraWorld: FloatArray) {
    val data = sc.data ?: return
    if (data.count == 0 || !session.nodeWorldMatrix(sc.node, world)) return
    val visible = session.isEffectivelyVisible(sc.node)
    val gpuPath = renderer.supportsGpuSplats
    if (sc.meshId >= 0) {
      if (!visible) {
        if (sc.wasVisible) {
          sc.wasVisible = false
          matrix.fill(0f)
          matrix[15] = 1f
          renderer.setDynamicMeshTransform(sc.meshId, matrix)
        }
        return
      }
      if (gpuPath) {
        sc.wasVisible = true
        for (i in 0 until 16) matrix[i] = world[i].toFloat()
        renderer.setDynamicMeshTransform(sc.meshId, matrix)
      } else if (!sc.wasVisible) {
        sc.wasVisible = true
        matrix.fill(0f)
        matrix[0] = 1f
        matrix[5] = 1f
        matrix[10] = 1f
        matrix[15] = 1f
        renderer.setDynamicMeshTransform(sc.meshId, matrix)
      }
    } else if (!visible) {
      return
    }

    // Consume any geometry/indices already built on the background thread before kicking off a new
    // sort, or immediately after a synchronous executor runs below.
    consumePendingSplatGeometry(sc)

    sc.sinceLastSortSec += dt.coerceAtLeast(0.0)
    if (sc.sorting || sc.sinceLastSortSec < SPLAT_RESORT_MIN_INTERVAL_SEC) return
    if (!SplatParser.shouldResort(sc.lastCameraWorld, cameraWorld, sc.lastNodeWorld, world)) return

    sc.sinceLastSortSec = 0.0
    sc.sorting = true
    val camSnap = cameraWorld.copyOf(16)
    val nodeSnap = world.copyOf(16)
    sc.lastCameraWorld = camSnap
    sc.lastNodeWorld = nodeSnap

    executor.execute {
      try {
        if (disposed) return@execute
        val mvp = SplatParser.viewDepthMatrix(nodeSnap, camSnap)
        val n = data.count
        val out = sc.order?.takeIf { it.size >= n } ?: IntArray(n).also { sc.order = it }
        val depths = sc.depths?.takeIf { it.size >= n } ?: FloatArray(n).also { sc.depths = it }
        val keys = sc.keys?.takeIf { it.size >= n } ?: IntArray(n).also { sc.keys = it }
        val counts = sc.counts ?: IntArray(65536).also { sc.counts = it }
        val sorted = SplatParser.sortSplatsByDepth(n, data.positions, mvp, out, depths, keys, counts)
        if (!disposed) {
          if (gpuPath) {
            sc.pendingIndices = SplatParser.buildSortedSplatIndices(sorted, n)
          } else {
            sc.pendingGeometry = SplatParser.buildSplatQuads(data, sorted, nodeSnap, camSnap)
          }
        }
      } finally {
        sc.sorting = false
      }
    }
    consumePendingSplatGeometry(sc)
  }

  private fun consumePendingSplatGeometry(sc: SplatCloud) {
    if (renderer.supportsGpuSplats) {
      val idx = sc.pendingIndices ?: return
      sc.pendingIndices = null
      if (sc.meshId < 0) {
        val staticGeo = sc.staticGpuGeometry ?: return
        sc.meshId = renderer.addSplatMesh(staticGeo.positions, staticGeo.uvs, staticGeo.colors, idx)
        if (sc.meshId >= 0) {
          for (i in 0 until 16) matrix[i] = world[i].toFloat()
          renderer.setDynamicMeshTransform(sc.meshId, matrix)
        }
      } else {
        renderer.updateSplatMeshIndices(sc.meshId, idx)
      }
      return
    }
    val geo = sc.pendingGeometry ?: return
    sc.pendingGeometry = null
    if (sc.meshId < 0) {
      sc.meshId = renderer.addSplatMesh(geo.positions, geo.uvs, geo.colors, geo.indices)
    } else {
      renderer.updateSplatMesh(sc.meshId, geo.positions, geo.uvs, geo.colors, geo.indices)
    }
  }

  companion object {
    const val MAX_STROKES: Int = 256
    const val MAX_STROKE_POINTS: Int = 2048
    const val SCREEN_PAINT_DEPTH: Double = 0.4
    /** At most 15 Hz depth re-sort cadence. */
    const val SPLAT_RESORT_MIN_INTERVAL_SEC: Double = 1.0 / 15.0
    private const val REBUILD_EVERY = 3
    private const val PARTICLE_SIZE = 0.012

    private val HANDLE_COLOR = floatArrayOf(0.95f, 0.95f, 1f, 0.9f)
    private val MEASURE_COLOR = floatArrayOf(0.22f, 0.74f, 0.97f, 1f)
    private val INVALID_TELEPORT_COLOR = floatArrayOf(0.94f, 0.27f, 0.27f, 0.92f)
    private val GAZE_RETICLE_COLOR = floatArrayOf(0.22f, 0.74f, 0.97f, 0.92f)
    private val EXPLODE_LEADER_COLOR = floatArrayOf(0.58f, 0.64f, 0.72f, 0.85f)
    private val LABEL_COLOR = floatArrayOf(1f, 1f, 1f, 1f)
    private val PARTICLE_DEFAULT_COLOR = floatArrayOf(0.8f, 0.9f, 1f, 1f)
    private val PARTICLE_COLORS =
      mapOf(
        "rain" to floatArrayOf(0.6f, 0.75f, 1f, 1f),
        "snow" to floatArrayOf(1f, 1f, 1f, 1f),
        "sparks" to floatArrayOf(1f, 0.7f, 0.2f, 1f),
        "confetti" to floatArrayOf(1f, 0.4f, 0.7f, 1f),
      )

    /** Unit cube (side 1, centered) as 8 corners and 12 triangles. */
    internal val UNIT_CUBE_POSITIONS: FloatArray =
      FloatArray(24) { i ->
        val corner = i / 3
        val axis = i % 3
        if ((corner shr axis) and 1 == 1) 0.5f else -0.5f
      }

    internal val UNIT_CUBE_INDICES: IntArray =
      intArrayOf(
        0, 2, 1, 1, 2, 3, // -z
        4, 5, 6, 5, 7, 6, // +z
        0, 1, 4, 1, 5, 4, // -y
        2, 6, 3, 3, 6, 7, // +y
        0, 4, 2, 2, 4, 6, // -x
        1, 3, 5, 3, 7, 5, // +x
      )

    /**
     * Camera-facing quads (two triangles each) of side [size] for [n] particle positions, using the
     * camera's right / up axes from its column-major world matrix.
     */
    @JvmStatic
    fun particleQuads(positions: FloatArray, n: Int, cameraWorld: FloatArray, size: Double): Pair<FloatArray, IntArray> {
      val h = (size / 2).toFloat()
      val rx = cameraWorld[0] * h
      val ry = cameraWorld[1] * h
      val rz = cameraWorld[2] * h
      val ux = cameraWorld[4] * h
      val uy = cameraWorld[5] * h
      val uz = cameraWorld[6] * h
      val out = FloatArray(n * 12)
      val idx = IntArray(n * 6)
      for (i in 0 until n) {
        val px = positions[i * 3]
        val py = positions[i * 3 + 1]
        val pz = positions[i * 3 + 2]
        val o = i * 12
        out[o] = px - rx - ux
        out[o + 1] = py - ry - uy
        out[o + 2] = pz - rz - uz
        out[o + 3] = px + rx - ux
        out[o + 4] = py + ry - uy
        out[o + 5] = pz + rz - uz
        out[o + 6] = px + rx + ux
        out[o + 7] = py + ry + uy
        out[o + 8] = pz + rz + uz
        out[o + 9] = px - rx + ux
        out[o + 10] = py - ry + uy
        out[o + 11] = pz - rz + uz
        val v = i * 4
        val j = i * 6
        idx[j] = v
        idx[j + 1] = v + 1
        idx[j + 2] = v + 2
        idx[j + 3] = v
        idx[j + 4] = v + 2
        idx[j + 5] = v + 3
      }
      return out to idx
    }
  }
}
