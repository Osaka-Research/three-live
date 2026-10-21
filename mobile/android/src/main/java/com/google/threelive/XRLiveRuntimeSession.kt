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

/**
 * Pure-Kotlin runtime for a compiled `three-live` scene: executes the root `KHR_interactivity`
 * behavior graph and steps XR Blocks lazy `follow` / `orbit` traits.
 *
 * This is the Android counterpart of `three-live/src/plugins/interactivity.ts` and
 * `xr-live/src/plugins/head-follow.ts` (see `docs/xr-blocks-parity.md`). It uses no Android
 * framework classes so it is JVM-unit-testable; hosts mirror state changes onto Filament or
 * Jetpack XR SceneCore entities through [Listener].
 *
 * All positions are in the glTF scene space of the loaded model; hosts pass head / hand poses in
 * that same space. Follow and orbit write the node's local TRS, converting from scene space
 * through the parent chain when the node is not a root node.
 *
 * The session is not thread-safe; drive it from a single thread (typically the render loop).
 * Public entry points never throw on malformed graphs: invalid nodes are ignored.
 *
 * `event/onStart` runs on [start], or lazily before the first [step], [dispatchSelect],
 * [dispatchHover] or [sendEvent] call when the host never calls [start] explicitly.
 *
 * @param gltfJson the glTF 2.0 JSON document (for example the JSON chunk of a `.glb`).
 * @throws IllegalArgumentException when [gltfJson] is not a JSON object.
 */
class XRLiveRuntimeSession(gltfJson: String) {

  /**
   * Receives state changes produced by the behavior graph and trait stepping.
   *
   * Callbacks run synchronously on the thread driving the session. Do not call back into the
   * session (e.g. [dispatchSelect], [step], [sendEvent]) from a callback; queue such work instead.
   */
  interface Listener {
    /**
     * A node's local TRS changed. The arrays are reused scratch buffers that are only valid for
     * the duration of the callback.
     */
    fun onNodeTransformChanged(
      nodeIndex: Int,
      translation: FloatArray,
      rotation: FloatArray,
      scale: FloatArray,
    ) {}

    /** A node's own `KHR_node_visibility` flag changed (descendants inherit it). */
    fun onVisibilityChanged(nodeIndex: Int, visible: Boolean) {}

    /**
     * A material's PBR factors changed. Arrays are reused scratch buffers valid only during the
     * callback.
     */
    fun onMaterialChanged(
      materialIndex: Int,
      baseColorFactor: FloatArray,
      emissiveFactor: FloatArray,
      metallicFactor: Float,
      roughnessFactor: Float,
    ) {}

    /** A material's `alphaCutoff` changed. */
    fun onAlphaCutoffChanged(materialIndex: Int, alphaCutoff: Float) {}

    /** The graph executed `event/send`; [payloadJson] is a JSON object of the sent values. */
    fun onInteractivityEvent(eventId: String, payloadJson: String) {}

    /**
     * The graph started ([start] = `true`, with the glTF animation index or `-1` and its name) or
     * stopped (`animation/stop`, `animation/resetAt`) animation playback.
     */
    fun onAnimation(start: Boolean, animationIndex: Int, animationName: String?) {}
  }

  /** Snapshot of a node's local transform. */
  class NodeTransform(val translation: FloatArray, val rotation: FloatArray, val scale: FloatArray)

  /** State-change receiver; may be replaced at any time. */
  var listener: Listener? = null

  /**
   * World matrix (column-major 4x4) of the scene root: renderers that move the whole model (for
   * example a turntable auto-rotate) report it here so world-space features (follow, orbit,
   * handles, paint) line up with what is drawn. Non-finite values are ignored. Default identity.
   */
  var rootTransform: DoubleArray
    get() = root.copyOf()
    set(value) {
      if (value.size < 16 || value.take(16).any { !it.isFinite() }) return
      value.copyInto(root, 0, 0, 16)
      rootIsIdentity = (0 until 16).all { root[it] == if (it % 5 == 0) 1.0 else 0.0 }
    }

  private val root = DoubleArray(16).also { for (k in 0 until 16 step 5) it[k] = 1.0 }
  private var rootIsIdentity = true

  /** Number of glTF nodes. */
  val nodeCount: Int

  /** Number of glTF materials. */
  val materialCount: Int

  /** Canonical spatial traits of every node that carries them. */
  val traits: List<XRLiveNodeTraits>

  /** `true` when a valid `KHR_interactivity` graph was loaded. */
  val interactivityEnabled: Boolean

  /** Why the behavior graph was rejected (e.g. a safety limit), or `null`. */
  val interactivityError: String?

  // ---- Scene state ---------------------------------------------------------------------------

  private val translation: DoubleArray
  private val rotation: DoubleArray
  private val scale: DoubleArray
  private val visible: BooleanArray
  private val parent: IntArray
  private val nodeMesh: IntArray
  private val nodeNames: Array<String?>
  private val meshNames: Array<String?>
  private val firstNodeByName = HashMap<String, Int>()
  private val animationNames: Array<String?>

  private val baseColor: DoubleArray
  private val emissive: DoubleArray
  private val metallic: DoubleArray
  private val roughness: DoubleArray
  private val alphaCutoff: DoubleArray

  private val dirtyTransform: BooleanArray
  private val dirtyVisibility: BooleanArray
  private val dirtyMaterial: BooleanArray
  private var anyDirty = false

  // ---- Behavior graph ------------------------------------------------------------------------

  private val gnodes: Array<GNode>
  private val events: Array<String?>
  private val varValues: Array<Any?>
  private val varIds = HashMap<String, Int>()
  private val extraVars = HashMap<Any, Any?>()
  private val outputs: Array<HashMap<String, Any?>?>
  private val visited: BooleanArray
  private var evalDepth = 0
  private val doNCounts = HashMap<Int, Int>()
  private val waitAll = HashMap<Int, HashSet<String>>()
  private val throttles = HashMap<Int, Double>()
  private val multiGates = HashMap<Int, Int>()
  private val tweens = ArrayList<Tween>()
  private val delays = ArrayList<Delay>()
  private var nextDelayId = 1
  private var elapsed = 0.0
  private var eventDepth = 0
  private var started = false
  private var evalCount = 0
  private var forDepth = 0

  // ---- Traits --------------------------------------------------------------------------------

  private class PhysicsBody(
    val nodeIndex: Int,
    val radius: Double,
    val velocity: DoubleArray = DoubleArray(3),
  )

  private val traitByNode = HashMap<Int, XRLiveNodeTraits>()
  private val followers: IntArray
  private val followOptions: Array<XRLazyFollowOptions?>
  private val orbiters: IntArray
  private val billboards: IntArray
  private val dynamicBodies: Array<PhysicsBody>
  private val staticColliders: Array<DoubleArray>
  private val physicsFloorY: Double
  private var physicsSettledTime = 0.0
  private var physicsFountainTimer = 0.0
  private var physicsFountainIndex = 0
  private val followStates: Array<FollowState?>
  private val orbitTime: DoubleArray
  private val grabbed: BooleanArray

  // ---- Scratch (allocation-light per-frame paths) --------------------------------------------

  private val sT = FloatArray(3)
  private val sR = FloatArray(4)
  private val sS = FloatArray(3)
  private val sBase = FloatArray(4)
  private val sEmissive = FloatArray(3)
  private val mA = DoubleArray(16)
  private val mB = DoubleArray(16)
  private val mC = DoubleArray(16)
  private val v3a = DoubleArray(3)
  private val v3b = DoubleArray(3)
  private val v3c = DoubleArray(3)
  private val q4a = DoubleArray(4)
  private val q4b = DoubleArray(4)
  private val q4c = DoubleArray(4)
  private val tmpT = DoubleArray(3)
  private val tmpQ = DoubleArray(4)
  private val tmpS = DoubleArray(3)
  private val pqScratch = DoubleArray(4)
  private val lqScratch = DoubleArray(4)
  private val localScratch = DoubleArray(3)

  init {
    val root =
      MiniJson.parseObjectOrNull(gltfJson)
        ?: throw IllegalArgumentException("XRLiveRuntimeSession: glTF JSON is malformed")
    val nodes = MiniJson.asList(root["nodes"]) ?: emptyList()
    val n = nodes.size
    require(n <= MAX_NODES) { "XRLiveRuntimeSession: more than $MAX_NODES nodes" }
    val materials = MiniJson.asList(root["materials"]) ?: emptyList()
    require(materials.size <= MAX_MATERIALS) { "XRLiveRuntimeSession: more than $MAX_MATERIALS materials" }
    nodeCount = n
    followStates = arrayOfNulls(n)
    orbitTime = DoubleArray(n)
    translation = DoubleArray(n * 3)
    rotation = DoubleArray(n * 4)
    scale = DoubleArray(n * 3)
    visible = BooleanArray(n) { true }
    parent = IntArray(n) { -1 }
    nodeMesh = IntArray(n) { -1 }
    nodeNames = arrayOfNulls(n)
    grabbed = BooleanArray(n)
    dirtyTransform = BooleanArray(n)
    dirtyVisibility = BooleanArray(n)
    for (i in 0 until n) {
      rotation[i * 4 + 3] = 1.0
      scale[i * 3] = 1.0
      scale[i * 3 + 1] = 1.0
      scale[i * 3 + 2] = 1.0
      val node = MiniJson.asMap(nodes[i]) ?: continue
      readNodeTrs(i, node)
      val name = node["name"] as? String
      nodeNames[i] = name
      if (name != null && !firstNodeByName.containsKey(name)) firstNodeByName[name] = i
      nodeMesh[i] = intIndex(node["mesh"])
      val ext = MiniJson.asMap(node["extensions"])
      val vis = MiniJson.asMap(ext?.get("KHR_node_visibility"))?.get("visible") ?: node["visible"]
      if (vis is Boolean) visible[i] = vis
      for (c in MiniJson.asList(node["children"]) ?: emptyList()) {
        val ci = intIndex(c)
        if (ci in 0 until n && ci != i) parent[ci] = i
      }
    }
    meshNames =
      (MiniJson.asList(root["meshes"]) ?: emptyList()).map { MiniJson.asMap(it)?.get("name") as? String }
        .toTypedArray()
    animationNames =
      (MiniJson.asList(root["animations"]) ?: emptyList())
        .map { MiniJson.asMap(it)?.get("name") as? String }
        .toTypedArray()

    val m = materials.size
    materialCount = m
    baseColor = DoubleArray(m * 4) { 1.0 }
    emissive = DoubleArray(m * 3)
    metallic = DoubleArray(m) { 1.0 }
    roughness = DoubleArray(m) { 1.0 }
    alphaCutoff = DoubleArray(m) { 0.5 }
    dirtyMaterial = BooleanArray(m)
    for (i in 0 until m) {
      val mat = MiniJson.asMap(materials[i]) ?: continue
      val pbr = MiniJson.asMap(mat["pbrMetallicRoughness"])
      val bc = MiniJson.asList(pbr?.get("baseColorFactor"))
      if (bc != null) for (k in 0 until 4) baseColor[i * 4 + k] = numOr(bc.getOrNull(k), 1.0)
      metallic[i] = numOr(pbr?.get("metallicFactor"), 1.0)
      roughness[i] = numOr(pbr?.get("roughnessFactor"), 1.0)
      val ef = MiniJson.asList(mat["emissiveFactor"])
      if (ef != null) for (k in 0 until 3) emissive[i * 3 + k] = numOr(ef.getOrNull(k), 0.0)
      alphaCutoff[i] = numOr(mat["alphaCutoff"], 0.5)
    }

    // Traits.
    traits = XRLiveSceneCoreHelper.parseNodeTraits(root)
    val fl = ArrayList<Int>()
    val ob = ArrayList<Int>()
    val bb = ArrayList<Int>()
    val dynNodes = ArrayList<Int>()
    followOptions = arrayOfNulls(n)
    for (t in traits) {
      if (t.nodeIndex !in 0 until n) continue
      traitByNode[t.nodeIndex] = t
      val lazy = t.lazyFollow
      if (lazy != null) {
        followOptions[t.nodeIndex] = lazy
        fl.add(t.nodeIndex)
      } else if (t.orbit != null) {
        ob.add(t.nodeIndex)
      } else if (t.physics == "dynamic") {
        dynNodes.add(t.nodeIndex)
      }
      if (!t.billboard.isNullOrEmpty() && t.billboard != "false" && lazy == null) {
        bb.add(t.nodeIndex)
      }
    }
    followers = fl.toIntArray()
    orbiters = ob.toIntArray()
    billboards = bb.toIntArray()

    // Parse mesh local bounds from POSITION accessors when dynamic physics is present.
    if (dynNodes.isEmpty()) {
      dynamicBodies = emptyArray()
      staticColliders = emptyArray()
      physicsFloorY = -0.85
    } else {
      val rawMeshes = MiniJson.asList(root["meshes"]) ?: emptyList()
      val rawAccessors = MiniJson.asList(root["accessors"]) ?: emptyList()
      val meshBounds = arrayOfNulls<DoubleArray>(rawMeshes.size)
      for (mi in rawMeshes.indices) {
        val mObj = MiniJson.asMap(rawMeshes[mi]) ?: continue
        val prims = MiniJson.asList(mObj["primitives"]) ?: continue
        var minX = Double.POSITIVE_INFINITY
        var minY = Double.POSITIVE_INFINITY
        var minZ = Double.POSITIVE_INFINITY
        var maxX = Double.NEGATIVE_INFINITY
        var maxY = Double.NEGATIVE_INFINITY
        var maxZ = Double.NEGATIVE_INFINITY
        for (p in prims) {
          val attrs = MiniJson.asMap(MiniJson.asMap(p)?.get("attributes")) ?: continue
          val posAccIdx = intIndex(attrs["POSITION"])
          val acc = MiniJson.asMap(rawAccessors.getOrNull(posAccIdx)) ?: continue
          val mn = MiniJson.asList(acc["min"])
          val mx = MiniJson.asList(acc["max"])
          if (mn != null && mx != null && mn.size >= 3 && mx.size >= 3) {
            minX = Math.min(minX, numOr(mn[0], 0.0))
            minY = Math.min(minY, numOr(mn[1], 0.0))
            minZ = Math.min(minZ, numOr(mn[2], 0.0))
            maxX = Math.max(maxX, numOr(mx[0], 0.0))
            maxY = Math.max(maxY, numOr(mx[1], 0.0))
            maxZ = Math.max(maxZ, numOr(mx[2], 0.0))
          }
        }
        if (minX <= maxX && minY <= maxY && minZ <= maxZ) {
          meshBounds[mi] = doubleArrayOf(minX, minY, minZ, maxX, maxY, maxZ)
        }
      }
      val dynSet = dynNodes.toHashSet()
      dynamicBodies =
        Array(dynNodes.size) { idx ->
          val ni = dynNodes[idx]
          val mb = meshBounds.getOrNull(nodeMesh[ni])
          val localR =
            if (mb != null) {
              Math.max(
                (mb[3] - mb[0]) * 0.5,
                Math.max((mb[4] - mb[1]) * 0.5, (mb[5] - mb[2]) * 0.5),
              )
            } else {
              0.12
            }
          val maxS =
            Math.max(
              Math.abs(scale[ni * 3]),
              Math.max(Math.abs(scale[ni * 3 + 1]), Math.abs(scale[ni * 3 + 2])),
            )
          val r = XRBlocksMath.clampNum(localR * maxS, 0.04, 1.5, 0.12)
          val initVel =
            if (dynNodes.size > 1) {
              val angle = (idx.toDouble() / dynNodes.size) * Math.PI * 2.0
              doubleArrayOf(
                Math.cos(angle) * 0.85,
                1.1 + (idx % 4) * 0.45,
                Math.sin(angle) * 0.85,
              )
            } else {
              DoubleArray(3)
            }
          PhysicsBody(ni, r, initVel)
        }
      val colliders = ArrayList<DoubleArray>()
      var floorY = -0.85
      for (ni in 0 until n) {
        if (ni in dynSet || !visible[ni]) continue
        val t = traitByNode[ni]
        if (t?.orbit != null || t?.lazyFollow != null || !t?.billboard.isNullOrEmpty()) continue
        val mb = meshBounds.getOrNull(nodeMesh[ni]) ?: continue
        sceneMatrix(ni, mA)
        val aabb =
          doubleArrayOf(
            Double.POSITIVE_INFINITY,
            Double.POSITIVE_INFINITY,
            Double.POSITIVE_INFINITY,
            Double.NEGATIVE_INFINITY,
            Double.NEGATIVE_INFINITY,
            Double.NEGATIVE_INFINITY,
          )
        for (c in 0 until 8) {
          val lx = if (c and 1 == 0) mb[0] else mb[3]
          val ly = if (c and 2 == 0) mb[1] else mb[4]
          val lz = if (c and 4 == 0) mb[2] else mb[5]
          XRBlocksMath.transformPoint(mA, lx, ly, lz, v3a)
          for (k in 0 until 3) {
            aabb[k] = Math.min(aabb[k], v3a[k])
            aabb[3 + k] = Math.max(aabb[3 + k], v3a[k])
          }
        }
        val spanX = aabb[3] - aabb[0]
        val spanZ = aabb[5] - aabb[2]
        if (spanX > 1.8 && spanZ > 1.8) {
          floorY = Math.max(floorY, aabb[4])
        } else {
          colliders.add(aabb)
        }
      }
      staticColliders = colliders.toTypedArray()
      physicsFloorY = floorY
    }

    // Behavior graph.
    val ext = MiniJson.asMap(MiniJson.asMap(root["extensions"])?.get("KHR_interactivity"))
    val graphs = MiniJson.asList(ext?.get("graphs"))
    val graph =
      if (graphs != null) {
        MiniJson.asMap(graphs.getOrNull(Math.max(0, intIndex(ext?.get("graph") ?: 0.0))))
      } else {
        ext
      }
    val rawNodes = MiniJson.asList(graph?.get("nodes"))
    val rawVars = MiniJson.asList(graph?.get("variables")) ?: emptyList()
    var error: String? = null
    if (rawNodes == null) {
      error = if (ext == null) null else "KHR_interactivity graph has no nodes"
    } else if (rawNodes.size > MAX_GRAPH_NODES) {
      error = "SecurityError: Exceeds MAX_GRAPH_NODES ($MAX_GRAPH_NODES)"
    } else if (rawVars.size > MAX_VARIABLES) {
      error = "SecurityError: Exceeds MAX_VARIABLES ($MAX_VARIABLES)"
    }
    interactivityError = error
    if (error != null || rawNodes == null) {
      interactivityEnabled = false
      gnodes = emptyArray()
      events = emptyArray()
      varValues = emptyArray()
    } else {
      interactivityEnabled = true
      val decls = MiniJson.asList(graph?.get("declarations")) ?: emptyList()
      gnodes = Array(rawNodes.size) { compileNode(MiniJson.asMap(rawNodes[it]), decls) }
      events =
        (MiniJson.asList(graph?.get("events")) ?: emptyList())
          .map { MiniJson.asMap(it)?.get("id") as? String }
          .toTypedArray()
      varValues = arrayOfNulls(rawVars.size)
      for ((i, rv) in rawVars.withIndex()) {
        val v = MiniJson.asMap(rv) ?: continue
        varValues[i] = toVm(unwrapCfg(v["value"]))
        val id = (v["id"] ?: v["name"]) as? String
        if (id != null && id.isNotEmpty() && id !in FORBIDDEN_SEGMENTS && !varIds.containsKey(id)) {
          varIds[id] = i
        }
      }
    }
    outputs = arrayOfNulls(gnodes.size)
    visited = BooleanArray(gnodes.size)
  }

  // =============================================================================================
  // Public API
  // =============================================================================================

  /** Fires every `event/onStart` node. Subsequent calls are no-ops. */
  fun start() {
    if (started) return
    started = true
    guard {
      for (i in gnodes.indices) {
        if (gnodes[i].op == "event/onStart") {
          evalCount = 0
          followFlow(gnodes[i].flows["out"])
        }
      }
      flush()
    }
  }

  private fun ensureStarted() {
    if (!started) start()
  }

  /**
   * Dispatches a select (tap / pinch) on [nodeIndex] to `pointer/onSelect` nodes whose target node
   * is the hit node or one of its ancestors. [hitPoint] optionally provides the world hit point.
   */
  @JvmOverloads
  fun dispatchSelect(nodeIndex: Int, hitPoint: FloatArray? = null) {
    ensureStarted()
    guard {
      dispatchPointer(SELECT_OPS, nodeIndex, hitPoint)
      impulsePhysicsOnSelect(nodeIndex)
      flush()
    }
  }

  /** Dispatches hover enter ([hovered] = `true`) or exit to `pointer/onHoverIn|Out` nodes. */
  fun dispatchHover(nodeIndex: Int, hovered: Boolean) {
    ensureStarted()
    guard {
      dispatchPointer(if (hovered) HOVER_IN_OPS else HOVER_OUT_OPS, nodeIndex, null)
      flush()
    }
  }

  /**
   * Delivers a custom event to `event/receive` nodes. [payload] values may be numbers, booleans,
   * strings, or numeric arrays / lists; they appear as the receive node's output sockets.
   */
  @JvmOverloads
  fun sendEvent(eventId: String, payload: Map<String, Any?> = emptyMap()) {
    ensureStarted()
    guard {
      val vm = HashMap<String, Any?>()
      for ((k, v) in payload) if (k !in FORBIDDEN_SEGMENTS) vm[k] = toVm(v)
      receiveCustomEvent(eventId, vm)
    }
  }

  /**
   * Advances the session by [dtSeconds]: fires `event/onTick`, advances tweens and delays (VM
   * clamps dt to 0.25 s), then steps lazy follows and orbits (clamped to 0.1 s) using [headPose]
   * and optional [handPoses] keyed `"left"` / `"right"`.
   */
  @JvmOverloads
  fun step(dtSeconds: Double, headPose: XRPose, handPoses: Map<String, XRPose> = emptyMap()) {
    ensureStarted()
    guard { tickVm(dtSeconds) }
    guard {
      val dt = XRBlocksMath.clampNum(dtSeconds, 0.0, 0.1, 1.0 / 60)
      for (i in followers) {
        if (grabbed[i]) {
          followStates[i] = null
          continue
        }
        stepFollow(i, followOptions[i] ?: continue, headPose, handPoses, dt)
      }
      for (i in orbiters) {
        if (grabbed[i]) continue
        stepOrbit(i, traitByNode[i]?.orbit ?: continue, headPose, dt)
      }
      for (i in billboards) {
        if (grabbed[i]) continue
        stepBillboard(i, traitByNode[i]?.billboard ?: continue, headPose, dt)
      }
      if (dynamicBodies.isNotEmpty()) {
        stepPhysics(dt)
      }
      flush()
    }
  }

  /**
   * Overwrites a node's local transform from the host (for example after a SceneCore grab). `null`
   * components are left unchanged. Does not notify [listener].
   */
  @JvmOverloads
  fun setNodeTransform(
    nodeIndex: Int,
    translation: FloatArray? = null,
    rotation: FloatArray? = null,
    scale: FloatArray? = null,
  ) {
    if (nodeIndex !in 0 until nodeCount) return
    if (translation != null && translation.size >= 3) {
      for (k in 0 until 3) this.translation[nodeIndex * 3 + k] = translation[k].toDouble()
    }
    if (rotation != null && rotation.size >= 4) {
      for (k in 0 until 4) q4a[k] = rotation[k].toDouble()
      normalizeQuatInto(q4a)
      for (k in 0 until 4) this.rotation[nodeIndex * 4 + k] = q4a[k]
    }
    if (scale != null && scale.size >= 3) {
      for (k in 0 until 3) this.scale[nodeIndex * 3 + k] = scale[k].toDouble()
    }
  }

  /** Marks a node as grabbed by the user; grabbed nodes skip follow / orbit stepping. */
  fun setNodeGrabbed(nodeIndex: Int, isGrabbed: Boolean) {
    if (nodeIndex in 0 until nodeCount) grabbed[nodeIndex] = isGrabbed
  }

  /** Returns a copy of the node's local transform, or `null` for an invalid index. */
  fun nodeTransform(nodeIndex: Int): NodeTransform? {
    if (nodeIndex !in 0 until nodeCount) return null
    return NodeTransform(
      FloatArray(3) { translation[nodeIndex * 3 + it].toFloat() },
      FloatArray(4) { rotation[nodeIndex * 4 + it].toFloat() },
      FloatArray(3) { scale[nodeIndex * 3 + it].toFloat() },
    )
  }

  /** Returns the node's scene-space position (through its parent chain), or `null`. */
  fun nodeWorldPosition(nodeIndex: Int): FloatArray? {
    if (nodeIndex !in 0 until nodeCount) return null
    worldMatrix(nodeIndex, mA)
    return floatArrayOf(mA[12].toFloat(), mA[13].toFloat(), mA[14].toFloat())
  }

  /**
   * Writes the node's scene-space matrix (column-major, through its parent chain) into [out].
   * Returns `false` for an invalid index or a too-small [out].
   */
  fun nodeWorldMatrix(nodeIndex: Int, out: DoubleArray): Boolean {
    if (nodeIndex !in 0 until nodeCount || out.size < 16) return false
    worldMatrix(nodeIndex, out)
    return true
  }

  /** Returns the node's own visibility flag (`false` for an invalid index). */
  fun isVisible(nodeIndex: Int): Boolean = nodeIndex in 0 until nodeCount && visible[nodeIndex]

  /** Returns whether the node and all of its ancestors are visible. */
  fun isEffectivelyVisible(nodeIndex: Int): Boolean {
    var cur = nodeIndex
    var d = 0
    while (cur in 0 until nodeCount && d < 128) {
      if (!visible[cur]) return false
      cur = parent[cur]
      d++
    }
    return nodeIndex in 0 until nodeCount
  }

  /** Returns a copy of a material's `baseColorFactor` (RGBA), or `null`. */
  fun materialColor(materialIndex: Int): FloatArray? {
    if (materialIndex !in 0 until materialCount) return null
    return FloatArray(4) { baseColor[materialIndex * 4 + it].toFloat() }
  }

  /** Returns a copy of a material's `emissiveFactor` (RGB), or `null`. */
  fun materialEmissive(materialIndex: Int): FloatArray? {
    if (materialIndex !in 0 until materialCount) return null
    return FloatArray(3) { emissive[materialIndex * 3 + it].toFloat() }
  }

  /** Returns a material's `metallicFactor`, or `NaN`. */
  fun materialMetallic(materialIndex: Int): Float =
    if (materialIndex in 0 until materialCount) metallic[materialIndex].toFloat() else Float.NaN

  /** Returns a material's `roughnessFactor`, or `NaN`. */
  fun materialRoughness(materialIndex: Int): Float =
    if (materialIndex in 0 until materialCount) roughness[materialIndex].toFloat() else Float.NaN

  /**
   * Reads a whitelisted glTF pointer (same rules as the VM). Returns a [Double], [Boolean] or
   * [DoubleArray], or `null` when the pointer is rejected.
   */
  fun readPointer(pointer: String): Any? {
    evalCount = 0
    return parseTarget(pointer)?.let { readTarget(it) }
  }

  /** Returns a material's `alphaCutoff`, or `NaN`. */
  fun materialAlphaCutoff(materialIndex: Int): Float =
    if (materialIndex in 0 until materialCount) alphaCutoff[materialIndex].toFloat() else Float.NaN

  /** Whether a lazy follower is currently catching up to its target. */
  fun isFollowing(nodeIndex: Int): Boolean = followStates.getOrNull(nodeIndex)?.following ?: false

  /** Returns the glTF name of [nodeIndex], or `null` when unnamed or out of range. */
  fun nodeName(nodeIndex: Int): String? = nodeNames.getOrNull(nodeIndex)

  /** Returns the index of the first node named [name], or `-1`. */
  fun nodeIndexOf(name: String): Int = nodeNames.indexOfFirst { it == name }

  /** Number of active tweens (diagnostics). */
  val activeTweenCount: Int
    get() = tweens.size

  /** Number of pending delays (diagnostics). */
  val activeDelayCount: Int
    get() = delays.size

  /** Returns a graph variable by declaration index or id (tests / diagnostics). */
  internal fun variableValue(key: Any): Any? = cloneVal(getVar(normKey(key)))

  // =============================================================================================
  // Graph compilation
  // =============================================================================================

  private class Flow(val node: Int, val socket: String?)

  private class ValueIn(
    val isLink: Boolean,
    val node: Int,
    val socket: String,
    val hasLiteral: Boolean,
    val literal: Any?,
  )

  private class GNode(
    val op: String,
    val config: Map<String, Any?>,
    val values: Map<String, ValueIn>,
    val flows: Map<String, Flow>,
    /** Flow keys sorted as `flow/sequence` visits them. */
    val sequenceKeys: List<String>,
    /** Flow keys sorted lexicographically, as `flow/multiGate` visits them. */
    val gateKeys: List<String>,
    val isEventLike: Boolean,
    /** Pointer configuration without `{param}` templates, pre-validated; `null` if templated. */
    val staticPointer: String?,
  )

  private fun compileNode(raw: Map<String, Any?>?, decls: List<Any?>): GNode {
    if (raw == null) return EMPTY_NODE
    var op = raw["op"] as? String ?: ""
    if (op.isEmpty()) {
      val d = intIndex(raw["declaration"])
      op = (MiniJson.asMap(decls.getOrNull(d))?.get("op") as? String) ?: ""
    }
    val config = MiniJson.asMap(raw["configuration"]) ?: emptyMap()
    val values = LinkedHashMap<String, ValueIn>()
    for ((k, b) in MiniJson.asMap(raw["values"]) ?: emptyMap()) {
      if (values.size >= MAX_SOCKETS_PER_NODE) break
      if (k in FORBIDDEN_SEGMENTS || b == null) continue
      val bm = MiniJson.asMap(b)
      values[k] =
        when {
          bm == null -> ValueIn(false, -1, "value", true, toVm(b))
          bm["node"] is Double ->
            ValueIn(true, intIndex(bm["node"]), (bm["socket"] as? String) ?: "value", false, null)
          bm.containsKey("value") -> ValueIn(false, -1, "value", true, toVm(bm["value"]))
          else -> ValueIn(false, -1, "value", false, null)
        }
    }
    val flows = LinkedHashMap<String, Flow>()
    for ((k, f) in MiniJson.asMap(raw["flows"]) ?: emptyMap()) {
      if (flows.size >= MAX_SOCKETS_PER_NODE) break
      if (k in FORBIDDEN_SEGMENTS) continue
      val fm = MiniJson.asMap(f) ?: continue
      if (fm["node"] !is Double) continue
      flows[k] = Flow(intIndex(fm["node"]), fm["socket"] as? String)
    }
    val seq =
      flows.keys.sortedWith { a, b ->
        val d = jsNumber(a) - jsNumber(b)
        if (d != 0.0 && !d.isNaN()) (if (d < 0) -1 else 1) else a.compareTo(b)
      }
    val isEventLike =
      op.startsWith("event/") || op.startsWith("pointer/on") || op.startsWith("scene/on") ||
        op.startsWith("flow/")
    val ptr = readCfgRaw(config, "pointer") as? String
    val staticPtr = if (ptr != null && !ptr.contains('{') && parseSafePointer(ptr) != null) ptr else null
    return GNode(op, config, values, flows, seq, flows.keys.sorted(), isEventLike, staticPtr)
  }

  // =============================================================================================
  // Value helpers (JavaScript semantics of the web VM)
  // =============================================================================================

  private fun readCfg(n: GNode, k: String): Any? = toVm(readCfgRaw(n.config, k))

  private fun cloneVal(v: Any?): Any? = if (v is DoubleArray) v.copyOf() else v

  private fun num(v: Any?, fb: Double = 0.0): Double {
    val d = jsNumber(v)
    return if (d.isFinite()) d else fb
  }

  private fun bool(v: Any?): Boolean =
    when (v) {
      null -> false
      is Boolean -> v
      is Double -> v != 0.0 && !v.isNaN()
      is String -> v.isNotEmpty() && v != "false"
      else -> true
    }

  private fun valEq(a: Any?, b: Any?): Boolean {
    if (a is DoubleArray && b is DoubleArray) {
      if (a.size != b.size) return false
      for (i in a.indices) if (!(Math.abs(a[i] - b[i]) <= 1e-6)) return false
      return true
    }
    if (a is Double && b is Double) return a == b
    if (a == null && b == null) return true
    if (a is Boolean && b is Boolean) return a == b
    if (a is String && b is String) return a == b
    return false
  }

  private fun applyBin(a: Any?, b: Any?, fn: (Double, Double) -> Double): Any? =
    when {
      a is DoubleArray && b is DoubleArray ->
        DoubleArray(Math.min(a.size, b.size)) { fn(numD(a[it]), numD(b[it])) }
      a is DoubleArray -> {
        val y = num(b)
        DoubleArray(a.size) { fn(numD(a[it]), y) }
      }
      b is DoubleArray -> {
        val x = num(a)
        DoubleArray(b.size) { fn(x, numD(b[it])) }
      }
      else -> fn(num(a), num(b))
    }

  private fun applyUn(a: Any?, fn: (Double) -> Double): Any? =
    if (a is DoubleArray) DoubleArray(a.size) { fn(numD(a[it])) } else fn(num(a))

  private fun lerpVal(a: Any?, b: Any?, t: Double, isQuat: Boolean): Any? {
    if (a is Double && b is Double) return a + (b - a) * t
    if (a is DoubleArray && b is DoubleArray) {
      val out = DoubleArray(if (isQuat && a.size == 4 && b.size == 4) 4 else Math.min(a.size, b.size))
      lerpInto(out, a, b, t, isQuat)
      return out
    }
    return if (t >= 0.5) b else a
  }

  /** Lerps / slerps arrays [a] -> [b] into [out] (sized by [lerpVal]). */
  private fun lerpInto(out: DoubleArray, a: DoubleArray, b: DoubleArray, t: Double, isQuat: Boolean) {
    if (isQuat && a.size == 4 && b.size == 4) {
      normQuat(a, q4b)
      normQuat(b, q4c)
      XRBlocksMath.quatSlerp(out, q4b, q4c, t)
      return
    }
    for (i in out.indices) out[i] = a[i] + (b[i] - a[i]) * t
  }

  private fun normQuat(q: DoubleArray, out: DoubleArray) {
    out[0] = numD(q[0])
    out[1] = numD(q[1])
    out[2] = numD(q[2])
    out[3] = if (q[3].isFinite()) q[3] else 1.0
    normalizeQuatInto(out)
  }

  private fun resolveEventId(ev: Any?): String =
    when (ev) {
      is Double -> {
        val i = intIndex(ev)
        events.getOrNull(i) ?: MiniJson.formatNumber(ev)
      }
      is String ->
        if (ev.isNotEmpty() && ev.all { it in '0'..'9' }) {
          events.getOrNull(ev.toIntOrNull() ?: -1) ?: ev
        } else {
          ev
        }
      else -> ""
    }

  // =============================================================================================
  // Variables
  // =============================================================================================

  private fun normKey(key: Any?): Any? =
    when (key) {
      is Double -> if (key == Math.rint(key) && Math.abs(key) < 1e9) key.toInt() else key
      is Number -> key.toInt()
      else -> key
    }

  private fun getVar(key: Any?): Any? =
    when (key) {
      is Int -> if (key in varValues.indices) varValues[key] else extraVars[key]
      is String -> varIds[key]?.let { varValues[it] } ?: extraVars[key]
      is Double -> extraVars[key]
      else -> null
    }

  private fun setVar(rawKey: Any?, value: Any?) {
    val key = normKey(rawKey)
    val c = cloneVal(value)
    when (key) {
      is Int ->
        if (key in varValues.indices) varValues[key] = c else putExtra(key, c)
      is String -> {
        if (key in FORBIDDEN_SEGMENTS) return
        val idx = varIds[key]
        if (idx != null) varValues[idx] = c else putExtra(key, c)
      }
      is Double -> putExtra(key, c)
      else -> return
    }
  }

  private fun putExtra(key: Any, v: Any?) {
    if (!extraVars.containsKey(key) && extraVars.size >= MAX_VARIABLES) return
    extraVars[key] = v
  }

  // =============================================================================================
  // Pointers
  // =============================================================================================

  /** Parsed whitelisted pointer target. */
  private class Target(val kind: Int, val index: Int)

  private fun parseTarget(pointer: String): Target? {
    val s = parseSafePointer(pointer) ?: return null
    if (s.size < 3) return null
    if (s[0] == "nodes") {
      val idx = parseIdx(s[1], nodeCount)
      if (idx < 0) return null
      val kind =
        when {
          s.size == 3 && s[2] == "translation" -> K_T
          s.size == 3 && s[2] == "rotation" -> K_R
          s.size == 3 && s[2] == "scale" -> K_S
          s.size == 3 && s[2] == "visible" -> K_VIS
          s.size == 5 && s[2] == "extensions" && s[3] == "KHR_node_visibility" && s[4] == "visible" ->
            K_VIS
          else -> return null
        }
      return Target(kind, idx)
    }
    if (s[0] == "materials") {
      val idx = parseIdx(s[1], materialCount)
      if (idx < 0) return null
      val kind =
        when {
          s.size == 4 && s[2] == "pbrMetallicRoughness" && s[3] == "baseColorFactor" -> K_BASE
          s.size == 4 && s[2] == "pbrMetallicRoughness" && s[3] == "metallicFactor" -> K_MET
          s.size == 4 && s[2] == "pbrMetallicRoughness" && s[3] == "roughnessFactor" -> K_ROUGH
          s.size == 3 && s[2] == "emissiveFactor" -> K_EMIS
          s.size == 3 && s[2] == "alphaCutoff" -> K_ALPHA
          else -> return null
        }
      return Target(kind, idx)
    }
    return null
  }

  private fun readTarget(t: Target): Any? {
    val i = t.index
    return when (t.kind) {
      K_T -> DoubleArray(3) { translation[i * 3 + it] }
      K_R -> DoubleArray(4) { rotation[i * 4 + it] }
      K_S -> DoubleArray(3) { scale[i * 3 + it] }
      K_VIS -> visible[i]
      K_BASE -> DoubleArray(4) { baseColor[i * 4 + it] }
      K_MET -> metallic[i]
      K_ROUGH -> roughness[i]
      K_EMIS -> DoubleArray(3) { emissive[i * 3 + it] }
      K_ALPHA -> alphaCutoff[i]
      else -> null
    }
  }

  private fun writeTarget(t: Target, value: Any?): Boolean {
    val i = t.index
    when (t.kind) {
      K_T,
      K_S -> {
        if (value !is DoubleArray || value.size < 3) return false
        val arr = if (t.kind == K_T) translation else scale
        val def = if (t.kind == K_T) 0.0 else 1.0
        for (k in 0 until 3) arr[i * 3 + k] = if (value[k].isFinite()) value[k] else def
        markTransform(i)
        return true
      }
      K_R -> {
        if (value !is DoubleArray || value.size < 4) return false
        for (k in 0 until 4) q4a[k] = if (value[k].isFinite()) value[k] else if (k == 3) 1.0 else 0.0
        normalizeQuatInto(q4a)
        for (k in 0 until 4) rotation[i * 4 + k] = q4a[k]
        markTransform(i)
        return true
      }
      K_VIS -> {
        val v = bool(value)
        if (visible[i] != v) {
          visible[i] = v
          dirtyVisibility[i] = true
          anyDirty = true
        }
        return true
      }
      K_BASE -> {
        if (value !is DoubleArray || value.size < 3) return false
        for (k in 0 until 3) baseColor[i * 4 + k] = clamp01(numD(value[k], 1.0))
        if (value.size >= 4) baseColor[i * 4 + 3] = clamp01(numD(value[3], 1.0))
        markMaterial(i)
        return true
      }
      K_MET,
      K_ROUGH -> {
        val isM = t.kind == K_MET
        val v = clamp01(num(value, if (isM) 0.0 else 0.5))
        if (isM) metallic[i] = v else roughness[i] = v
        markMaterial(i)
        return true
      }
      K_EMIS -> {
        if (value !is DoubleArray || value.size < 3) return false
        for (k in 0 until 3) emissive[i * 3 + k] = Math.max(0.0, numD(value[k]))
        markMaterial(i)
        return true
      }
      K_ALPHA -> {
        alphaCutoff[i] = clamp01(num(value, 0.5))
        markMaterial(i)
        return true
      }
    }
    return false
  }

  private fun markTransform(i: Int) {
    dirtyTransform[i] = true
    anyDirty = true
  }

  private fun markMaterial(i: Int) {
    dirtyMaterial[i] = true
    anyDirty = true
  }

  private fun resolvePtr(nodeIdx: Int, node: GNode): String? {
    node.staticPointer?.let {
      return it
    }
    val raw = readCfgRaw(node.config, "pointer") as? String ?: return null
    if (!raw.startsWith("/")) return null
    val sub =
      TEMPLATE.replace(raw) { m ->
        val param = m.groupValues[1]
        val v = readIn(nodeIdx, param, null) ?: readCfg(node, param)
        val d = jsNumber(v)
        val i = if (d.isFinite()) (if (d < 0) Math.ceil(d) else Math.floor(d)) else Double.NaN
        if (!i.isNaN() && i >= 0 && i <= MAX_SAFE_INTEGER) i.toLong().toString() else "-1"
      }
    return if (parseSafePointer(sub) != null) sub else null
  }

  // =============================================================================================
  // Evaluation
  // =============================================================================================

  private fun readIn(nodeIdx: Int, sock: String, fb: Any?): Any? {
    val b = gnodes.getOrNull(nodeIdx)?.values?.get(sock) ?: return fb
    if (b.isLink) return evalSocket(b.node, b.socket)
    return if (b.hasLiteral) cloneVal(b.literal) ?: fb else fb
  }

  private fun evalSocket(nodeIdx: Int, sock: String): Any? {
    if (nodeIdx !in gnodes.indices || visited[nodeIdx] || evalDepth > 128) return null
    if (++evalCount > MAX_EVALS_PER_INVOCATION) return null
    val node = gnodes[nodeIdx]
    if (node.isEventLike) return cloneVal(outputs[nodeIdx]?.get(sock))
    visited[nodeIdx] = true
    evalDepth++
    try {
      return evalOp(nodeIdx, node, sock)
    } finally {
      visited[nodeIdx] = false
      evalDepth--
    }
  }

  private fun evalOp(nodeIdx: Int, node: GNode, sock: String): Any? {
    val op = node.op
    fun inp(name: String, fb: Any? = 0.0): Any? = readIn(nodeIdx, name, fb)
    if (op == "variable/get") {
      val k = readCfg(node, "variable") ?: readCfg(node, "id")
      return if (k is Double || k is String) cloneVal(getVar(normKey(k))) else null
    }
    if (op == "pointer/get") {
      val p = resolvePtr(nodeIdx, node) ?: return null
      return parseTarget(p)?.let { readTarget(it) }
    }
    if (op.startsWith("math/")) {
      val m = op.substring(5)
      UNARY_MATH[m]?.let {
        return applyUn(inp("a"), it)
      }
      BINARY_MATH[m]?.let {
        val dB = if (m == "mul" || m == "div" || m == "rem" || m == "mod" || m == "pow") 1.0 else 0.0
        return applyBin(inp("a", if (m == "mul") 1.0 else 0.0), inp("b", dB), it)
      }
      return when (m) {
        "pi" -> Math.PI
        "e" -> Math.E
        "random" -> Math.random()
        "clamp" ->
          applyBin(
            applyBin(inp("a"), inp("b", inp("min", 0.0)), MAX_FN),
            inp("c", inp("max", 1.0)),
            MIN_FN,
          )
        "mix",
        "quatSlerp" -> lerpVal(inp("a", 0.0), inp("b", 1.0), num(inp("c", inp("t", 0.5)), 0.5), m == "quatSlerp")
        "dot" -> {
          val a = inp("a")
          val b = inp("b")
          if (a is DoubleArray && b is DoubleArray) {
            var s = 0.0
            for (i in a.indices) s += numZ(a[i]) * numZ(b.getOrElse(i) { 0.0 })
            s
          } else {
            num(a) * num(b)
          }
        }
        "cross" -> {
          val a = inp("a", DoubleArray(3))
          val b = inp("b", DoubleArray(3))
          if (a is DoubleArray && b is DoubleArray) {
            fun g(v: DoubleArray, i: Int) = numZ(v.getOrElse(i) { 0.0 })
            doubleArrayOf(
              g(a, 1) * g(b, 2) - g(a, 2) * g(b, 1),
              g(a, 2) * g(b, 0) - g(a, 0) * g(b, 2),
              g(a, 0) * g(b, 1) - g(a, 1) * g(b, 0),
            )
          } else {
            DoubleArray(3)
          }
        }
        "length" -> {
          val a = inp("a")
          if (a is DoubleArray) hypot(a, null) else Math.abs(num(a))
        }
        "distance" -> {
          val a = inp("a")
          val b = inp("b")
          if (a is DoubleArray && b is DoubleArray) {
            hypot(a, b)
          } else {
            Math.abs(num(a) - num(b))
          }
        }
        "normalize" -> {
          val a = inp("a")
          if (a !is DoubleArray) {
            if (num(a) >= 0) 1.0 else -1.0
          } else {
            val l = hypot(a, null)
            if (l > 1e-8) DoubleArray(a.size) { a[it] / l } else DoubleArray(a.size)
          }
        }
        "combine2",
        "combine3",
        "combine4" -> {
          val c = m[7] - '0'
          DoubleArray(c) { num(inp(COMBINE_KEYS[it])) }
        }
        "extract2",
        "extract3",
        "extract4" -> {
          val v = inp("a")
          if (v is DoubleArray) {
            val i =
              when (sock) {
                "0",
                "x" -> 0
                "1",
                "y" -> 1
                "2",
                "z" -> 2
                else -> 3
              }
            v.getOrElse(i) { 0.0 }
          } else {
            0.0
          }
        }
        "eq" -> valEq(inp("a"), inp("b"))
        "ne" -> !valEq(inp("a"), inp("b"))
        "lt" -> num(inp("a")) < num(inp("b"))
        "le" -> num(inp("a")) <= num(inp("b"))
        "gt" -> num(inp("a")) > num(inp("b"))
        "ge" -> num(inp("a")) >= num(inp("b"))
        "isNaN" -> jsNumber(inp("a")).isNaN()
        "isInf" -> jsNumber(inp("a")).isInfinite()
        "and" -> bool(inp("a", false)) && bool(inp("b", false))
        "or" -> bool(inp("a", false)) || bool(inp("b", false))
        "xor" -> bool(inp("a", false)) != bool(inp("b", false))
        "not" -> !bool(inp("a", false))
        "select" -> cloneVal(if (bool(inp("condition", false))) inp("a") else inp("b"))
        else -> null
      }
    }
    return when (op) {
      "type/boolToInt",
      "type/boolToFloat" -> if (bool(inp("a", false))) 1.0 else 0.0
      "type/intToBool",
      "type/floatToBool" -> num(inp("a", 0.0)) != 0.0
      "type/intToFloat" -> num(inp("a", 0.0))
      "type/floatToInt" -> trunc(num(inp("a", 0.0)))
      else -> null
    }
  }

  // =============================================================================================
  // Flow execution
  // =============================================================================================

  private class Tween(
    val key: String,
    val target: Target?,
    val varKey: Any?,
    val from: Any?,
    val to: Any?,
    val dur: Double,
    var elapsed: Double,
    val quat: Boolean,
    val linear: Boolean,
    val done: Flow?,
    /** Reusable interpolation buffer for array tweens. */
    val scratch: DoubleArray?,
  )

  private class Delay(val id: Int, val nodeIdx: Int, var rem: Double, val done: Flow?)

  private class FollowState(val spring: SpringState, var following: Boolean)

  private fun setOut(idx: Int, sock: String, v: Any?) {
    if (sock in FORBIDDEN_SEGMENTS) return
    val rec = outputs[idx] ?: HashMap<String, Any?>().also { outputs[idx] = it }
    rec[sock] = v
  }

  private fun cancelTween(key: String) {
    for (i in tweens.size - 1 downTo 0) if (tweens[i].key == key) tweens.removeAt(i)
  }

  private fun addTween(tw: Tween) {
    cancelTween(tw.key)
    if (tweens.size >= MAX_ACTIVE_TWEENS) tweens.removeAt(0)
    tweens.add(tw)
  }

  private fun makeTween(
    key: String,
    target: Target?,
    varKey: Any?,
    from: Any?,
    to: Any?,
    dur: Double,
    quat: Boolean,
    linear: Boolean,
    done: Flow?,
  ): Tween {
    val scratch =
      if (from is DoubleArray && to is DoubleArray) {
        DoubleArray(if (quat && from.size == 4 && to.size == 4) 4 else Math.min(from.size, to.size))
      } else {
        null
      }
    return Tween(key, target, varKey, from, to, dur, 0.0, quat, linear, done, scratch)
  }

  private fun followFlow(start: Flow?, budget: IntArray = IntArray(1)) {
    if (start == null) return
    val queue = ArrayDeque<Flow>()
    queue.addLast(start)
    while (queue.isNotEmpty() && budget[0] < MAX_STEPS_PER_INVOCATION) {
      budget[0]++
      val cur = queue.removeFirst()
      if (cur.node !in gnodes.indices) continue
      val nodeIdx = cur.node
      val node = gnodes[nodeIdx]
      val inSock = cur.socket ?: "in"
      fun inp(name: String, fb: Any? = null): Any? = readIn(nodeIdx, name, fb)
      fun enqueue(f: Flow?) {
        if (f != null && queue.size + budget[0] < MAX_STEPS_PER_INVOCATION) queue.addLast(f)
      }
      fun pushOut(sock: String = "out") = enqueue(node.flows[sock])
      when (node.op) {
        "flow/branch" -> pushOut(if (bool(inp("condition", false))) "true" else "false")
        "flow/sequence" -> for (k in node.sequenceKeys) pushOut(k)
        "flow/switch" -> {
          val sel = jsString(inp("selection", inp("value", 0.0)))
          enqueue(node.flows[sel] ?: node.flows["default"])
        }
        "flow/for" -> {
          val sIdx = trunc(num(inp("startIndex", 0.0)))
          val eIdx = trunc(num(inp("endIndex", 0.0)))
          val stp = Math.max(1.0, trunc(num(inp("step", 1.0), 1.0)))
          val body = node.flows["body"]
          if (body != null && eIdx > sIdx && forDepth < MAX_FOR_DEPTH) {
            val maxIt = Math.min(Math.ceil((eIdx - sIdx) / stp), MAX_STEPS_PER_INVOCATION.toDouble()).toInt()
            var iter = 0
            forDepth++
            try {
              while (iter < maxIt && budget[0] < MAX_STEPS_PER_INVOCATION) {
                setOut(nodeIdx, "index", sIdx + iter * stp)
                budget[0]++
                followFlow(body, budget)
                iter++
              }
            } finally {
              forDepth--
            }
          }
          enqueue(node.flows["completed"] ?: node.flows["out"])
        }
        "flow/doN" -> {
          val c = if (inSock == "reset") 0 else (doNCounts[nodeIdx] ?: 0) + 1
          doNCounts[nodeIdx] = c
          setOut(nodeIdx, "currentCount", c.toDouble())
          setOut(nodeIdx, "count", c.toDouble())
          if (inSock != "reset") {
            val maxC = trunc(num(inp("n", readCfg(node, "stopIterations") ?: readCfg(node, "n") ?: 1.0), 1.0))
            if (c <= maxC) pushOut()
          }
        }
        "flow/multiGate" -> {
          if (inSock == "reset") {
            multiGates[nodeIdx] = 0
          } else {
            val keys = node.gateKeys
            if (keys.isNotEmpty()) {
              val idx =
                if (bool(readCfg(node, "isRandom"))) {
                  (Math.random() * keys.size).toInt()
                } else {
                  multiGates[nodeIdx] ?: 0
                }
              if (idx < keys.size) {
                pushOut(keys[idx])
                multiGates[nodeIdx] = if (readCfg(node, "isLoop") != false) (idx + 1) % keys.size else idx + 1
              }
            }
          }
        }
        "flow/waitAll" -> {
          if (inSock == "reset") {
            waitAll.remove(nodeIdx)
          } else {
            val set = waitAll.getOrPut(nodeIdx) { HashSet() }
            set.add(inSock)
            // Web: max(1, trunc(Number(cfg ?? 2) || 2)).
            var need = jsNumber(readCfg(node, "inputFlows") ?: 2.0)
            if (need == 0.0 || need.isNaN()) need = 2.0
            if (set.size >= Math.max(1.0, trunc(need))) {
              set.clear()
              pushOut("out")
              pushOut("completed")
            }
          }
        }
        "flow/throttle" -> {
          if (inSock == "reset") {
            throttles.remove(nodeIdx)
          } else {
            val dur = Math.max(0.0, num(inp("duration", 0.0)))
            val last = throttles[nodeIdx]
            if (last == null || elapsed - last >= dur) {
              throttles[nodeIdx] = elapsed
              setOut(nodeIdx, "lastRemainingTime", 0.0)
              pushOut()
            } else {
              setOut(nodeIdx, "lastRemainingTime", Math.max(0.0, dur - (elapsed - last)))
            }
          }
        }
        "flow/delay",
        "flow/setDelay" -> {
          if (inSock == "cancel") {
            delays.removeAll { it.nodeIdx == nodeIdx }
            setOut(nodeIdx, "lastDelayIndex", -1.0)
          } else {
            val dur = Math.max(0.0, num(inp("duration", readCfg(node, "duration") ?: 0.0)))
            val done = node.flows["done"] ?: node.flows["out"]
            if (dur <= 0) {
              setOut(nodeIdx, "lastDelayIndex", -1.0)
              enqueue(done)
            } else {
              if (delays.size >= MAX_ACTIVE_DELAYS) delays.removeAt(0)
              val id = nextDelayId++
              setOut(nodeIdx, "lastDelayIndex", id.toDouble())
              delays.add(Delay(id, nodeIdx, dur, done))
              if (node.op == "flow/setDelay" && node.flows["out"] != null && node.flows["done"] != null) {
                pushOut("out")
              }
            }
          }
        }
        "flow/cancelDelay" -> {
          val dIdx = trunc(num(inp("delayIndex", -1.0), -1.0))
          if (dIdx < 0) delays.clear() else delays.removeAll { it.id.toDouble() == dIdx }
          pushOut()
        }
        "variable/set" -> {
          setVar(readCfg(node, "variable") ?: readCfg(node, "id"), inp("value"))
          pushOut()
        }
        "variable/interpolate" -> {
          val vk = normKey(readCfg(node, "variable") ?: readCfg(node, "id"))
          val target = inp("value", inp("target"))
          val dur = Math.max(0.0, num(inp("duration", readCfg(node, "duration") ?: 0.3), 0.3))
          if (vk != null && target != null) {
            val from = inp("from") ?: getVar(vk) ?: 0.0
            addTween(
              makeTween(
                "var:$vk",
                null,
                vk,
                cloneVal(from),
                cloneVal(target),
                dur,
                false,
                readCfg(node, "easing") == "linear",
                node.flows["done"],
              )
            )
          }
          pushOut()
        }
        "pointer/set" -> {
          val ptr = resolvePtr(nodeIdx, node)
          val v = inp("value")
          if (ptr != null && v != null) {
            cancelTween("ptr:$ptr")
            parseTarget(ptr)?.let { writeTarget(it, v) }
          }
          pushOut()
        }
        "pointer/interpolate" -> {
          val ptr = resolvePtr(nodeIdx, node)
          val target = inp("value", inp("target"))
          val dur = Math.max(0.0, num(inp("duration", readCfg(node, "duration") ?: 0.3), 0.3))
          val tgt = ptr?.let { parseTarget(it) }
          if (ptr != null && tgt != null && target != null) {
            val curVal = inp("from") ?: readTarget(tgt)
            if (curVal != null) {
              if (dur <= 0) {
                writeTarget(tgt, target)
                pushOut("done")
              } else {
                addTween(
                  makeTween(
                    "ptr:$ptr",
                    tgt,
                    null,
                    cloneVal(curVal),
                    cloneVal(target),
                    dur,
                    ptr.endsWith("/rotation"),
                    readCfg(node, "easing") == "linear",
                    node.flows["done"],
                  )
                )
              }
            }
          }
          pushOut()
        }
        "animation/start" -> {
          val ref = inp("animation") ?: readCfg(node, "animation") ?: readCfg(node, "clipName")
          var index = -1
          val name: String? =
            when (ref) {
              is Double -> {
                index = intIndex(ref)
                animationNames.getOrNull(index)
              }
              is String -> ref.also { index = animationNames.indexOf(it) }
              else -> null
            }
          listener?.onAnimation(true, index, name)
          pushOut()
        }
        "animation/stop",
        "animation/resetAt" -> {
          listener?.onAnimation(false, -1, null)
          pushOut()
        }
        "event/send",
        "customEvent/send" -> {
          val id = resolveEventId(readCfg(node, "event") ?: readCfg(node, "id"))
          val payload = LinkedHashMap<String, Any?>()
          for (k in node.values.keys) if (k !in FORBIDDEN_SEGMENTS) payload[k] = inp(k)
          if (id.isNotEmpty()) {
            listener?.onInteractivityEvent(id, MiniJson.stringify(payload))
            receiveCustomEvent(id, payload, budget)
          }
          pushOut()
        }
        else -> pushOut()
      }
    }
  }

  private fun dispatchPointer(ops: Set<String>, nIdx: Int, hitPoint: FloatArray?) {
    val mIdx = nodeMesh.getOrElse(nIdx) { -1 }
    val hitMeshName = meshNames.getOrNull(mIdx)
    for (i in gnodes.indices) {
      val node = gnodes[i]
      if (node.op !in ops) continue
      evalCount = 0
      val tNode = readCfg(node, "nodeIndex") ?: readCfg(node, "node") ?: readIn(i, "nodeIndex", null)
      val tMesh = readCfg(node, "meshName")
      val matches =
        if (tMesh is String && tMesh.isNotEmpty()) {
          hitMeshName == tMesh
        } else {
          val d = jsNumber(tNode)
          if (tNode == null || d < 0 || d.isNaN()) true else isAncestor(nIdx, trunc(d).toInt())
        }
      if (!matches) continue
      setOut(i, "nodeIndex", nIdx.toDouble())
      setOut(i, "meshIndex", mIdx.toDouble())
      if (hitPoint != null && hitPoint.size >= 3) {
        val pt = doubleArrayOf(numD(hitPoint[0].toDouble()), numD(hitPoint[1].toDouble()), numD(hitPoint[2].toDouble()))
        setOut(i, "hitPoint", pt)
        setOut(i, "point", pt.copyOf())
        setOut(i, "intersectionPoint", pt.copyOf())
      }
      followFlow(node.flows["out"])
    }
  }

  private fun isAncestor(hitIdx: Int, targetIdx: Int): Boolean {
    var cur = hitIdx
    var d = 0
    while (cur >= 0 && cur < nodeCount && d < 128) {
      if (cur == targetIdx) return true
      cur = parent[cur]
      d++
    }
    return false
  }

  /**
   * Delivers a custom event. Nested deliveries from `event/send` pass the sender's [budget] so a
   * graph cannot fan out exponentially; top-level deliveries ([budget] `null`) start fresh.
   */
  private fun receiveCustomEvent(eventId: Any, payload: Map<String, Any?>, budget: IntArray? = null) {
    if (eventDepth >= MAX_EVENT_NESTING_DEPTH) return
    eventDepth++
    try {
      val targetId = resolveEventId(eventId)
      val rawId = if (eventId is Double) MiniJson.formatNumber(eventId) else eventId.toString()
      for (i in gnodes.indices) {
        val node = gnodes[i]
        if (node.op != "event/receive" && node.op != "customEvent/receive") continue
        val cfgEv = readCfg(node, "event") ?: readCfg(node, "id")
        if (resolveEventId(cfgEv) != targetId && jsString(cfgEv) != rawId) continue
        for ((k, v) in payload) if (k !in FORBIDDEN_SEGMENTS) setOut(i, k, cloneVal(v))
        if (budget == null) {
          evalCount = 0
          followFlow(node.flows["out"])
        } else {
          if (budget[0] >= MAX_STEPS_PER_INVOCATION) break
          followFlow(node.flows["out"], budget)
        }
      }
      flush()
    } finally {
      eventDepth--
    }
  }

  private fun tickVm(dt: Double) {
    if (!dt.isFinite() || dt < 0) return
    val d = Math.min(dt, 0.25)
    elapsed += d
    for (i in gnodes.indices) {
      val node = gnodes[i]
      if (node.op == "event/onTick") {
        setOut(i, "timeDelta", d)
        setOut(i, "dt", d)
        setOut(i, "timeElapsed", elapsed)
        evalCount = 0
        followFlow(node.flows["out"])
      }
    }
    var doneFlows: ArrayList<Flow>? = null
    for (i in tweens.size - 1 downTo 0) {
      if (i >= tweens.size) continue
      val tw = tweens[i]
      tw.elapsed += d
      val rt = if (tw.dur > 1e-6) clamp01(tw.elapsed / tw.dur) else 1.0
      val et = if (tw.linear) rt else rt * rt * (3 - 2 * rt)
      val cur: Any? =
        if (tw.scratch != null) {
          lerpInto(tw.scratch, tw.from as DoubleArray, tw.to as DoubleArray, et, tw.quat)
          tw.scratch
        } else {
          lerpVal(tw.from, tw.to, et, tw.quat)
        }
      if (tw.target != null) writeTarget(tw.target, cur) else if (tw.varKey != null) setVar(tw.varKey, cur)
      if (rt >= 1) {
        tweens.removeAt(i)
        if (tw.done != null) (doneFlows ?: ArrayList<Flow>().also { doneFlows = it }).add(tw.done)
      }
    }
    for (i in delays.size - 1 downTo 0) {
      val dl = delays[i]
      dl.rem -= d
      if (dl.rem <= 0) {
        delays.removeAt(i)
        if (dl.done != null) (doneFlows ?: ArrayList<Flow>().also { doneFlows = it }).add(dl.done)
      }
    }
    doneFlows?.forEach {
      evalCount = 0
      followFlow(it)
    }
    flush()
  }

  // =============================================================================================
  // Follow / orbit
  // =============================================================================================

  private fun stepFollow(
    i: Int,
    options: XRLazyFollowOptions,
    headPose: XRPose,
    handPoses: Map<String, XRPose>,
    dt: Double,
  ) {
    val anchor =
      when (options.mode) {
        "hand-left" -> handPoses["left"]
        "hand-right" -> handPoses["right"]
        else -> headPose
      } ?: return
    worldMatrix(i, mA)
    val target = XRFollowMath.computeFollowTarget(anchor, options, v3a)
    var state = followStates[i]
    if (state == null) {
      // Allocated once per follower (and again only after a grab resets it).
      val spring = SpringState()
      if (options.snapOnStart) {
        target.copyInto(spring.position)
      } else {
        spring.position[0] = mA[12]
        spring.position[1] = mA[13]
        spring.position[2] = mA[14]
      }
      state = FollowState(spring, false)
      followStates[i] = state
    }
    val pos = state.spring.position
    val err = XRBlocksMath.dist3(pos, target)
    if (!state.following) {
      val angle = XRFollowMath.angleFromForwardDeg(anchor, pos)
      val rx = pos[0] - anchor.position[0]
      val ry = pos[1] - anchor.position[1]
      val rz = pos[2] - anchor.position[2]
      val radialErr =
        if (options.mode == "head") Math.abs(Math.sqrt(rx * rx + rz * rz) - options.distance) else err
      val verticalErr = Math.abs(ry - options.height)
      val slack = Math.max(0.05, options.distance * 0.35)
      if (angle > options.deadzoneDeg || radialErr > slack || verticalErr > slack) state.following = true
    }
    if (state.following) {
      XRFollowMath.stepCriticallyDampedSpring(state.spring, target, options.stiffness, dt)
      val v = state.spring.velocity
      if (XRBlocksMath.dist3(pos, target) < 0.01 && XRBlocksMath.len3(v[0], v[1], v[2]) < 0.01) {
        state.following = false
      }
    }
    if (options.faceUser) {
      v3b[0] = headPose.position[0].toDouble()
      v3b[1] = headPose.position[1].toDouble()
      v3b[2] = headPose.position[2].toDouble()
      XRFollowMath.yawTowards(pos, v3b, q4a)
      setWorldPose(i, pos, q4a)
    } else {
      setWorldPose(i, pos, null)
    }
  }

  private fun stepOrbit(i: Int, options: XROrbitTrait, headPose: XRPose, dt: Double) {
    val center = v3b
    val name = options.targetName
    if (name == null) {
      val tx = options.targetPosition.getOrElse(0) { 0.0 }
      val ty = options.targetPosition.getOrElse(1) { 0.0 }
      val tz = options.targetPosition.getOrElse(2) { 0.0 }
      if (rootIsIdentity) {
        center[0] = tx
        center[1] = ty
        center[2] = tz
      } else {
        XRBlocksMath.transformPoint(root, tx, ty, tz, center)
      }
    } else if (name == "head") {
      for (k in 0 until 3) center[k] = headPose.position[k].toDouble()
    } else {
      val ref = firstNodeByName[name] ?: return
      if (ref == i) return
      worldMatrix(ref, mA)
      center[0] = mA[12]
      center[1] = mA[13]
      center[2] = mA[14]
    }
    val t = orbitTime[i] + dt
    orbitTime[i] = t
    val pos = XRFollowMath.computeOrbitPosition(center, options, t, v3c)
    if (options.faceCenter) {
      XRFollowMath.yawTowards(pos, center, q4a)
      setWorldPose(i, pos, q4a)
    } else {
      setWorldPose(i, pos, null)
    }
  }

  private fun stepBillboard(i: Int, mode: String, headPose: XRPose, dt: Double) {
    worldMatrix(i, mA)
    v3a[0] = mA[12]
    v3a[1] = mA[13]
    v3a[2] = mA[14]
    v3b[0] = headPose.position[0].toDouble()
    v3b[1] = headPose.position[1].toDouble()
    v3b[2] = headPose.position[2].toDouble()
    XRBlocksMath.extractQuaternion(mA, q4a)
    XRFollowMath.billboardTowards(v3a, v3b, mode, q4b)
    val alpha = Math.min(1.0, dt * 10.0)
    XRBlocksMath.quatSlerp(q4c, q4a, q4b, alpha)
    normalizeQuatInto(q4c)
    setWorldPose(i, v3a, q4c)
  }

  private fun stepPhysics(dt: Double) {
    val clampedDt = Math.max(0.001, Math.min(0.05, dt))
    val restitution = 0.68
    val friction = 0.25
    val wallBound = 1.55
    var maxSpeedSq = 0.0

    for ((idx, body) in dynamicBodies.withIndex()) {
      val i = body.nodeIndex
      if (grabbed[i] || !isEffectivelyVisible(i)) {
        body.velocity.fill(0.0)
        continue
      }
      var px = translation[i * 3]
      var py = translation[i * 3 + 1]
      var pz = translation[i * 3 + 2]
      val v = body.velocity
      val r = body.radius

      // 1. Semi-implicit Euler gravity integration
      v[1] -= 9.81 * clampedDt
      px += v[0] * clampedDt
      py += v[1] * clampedDt
      pz += v[2] * clampedDt

      // 2. Collide against static scene mesh AABBs / circular pedestals (e.g. Pedestal_Table, Workbench_Pedestal)
      for (box in staticColliders) {
        val spanX = box[3] - box[0]
        val spanZ = box[5] - box[2]
        val isRoundPedestal =
          box[4] > physicsFloorY + 0.12 &&
            spanX > 0.25 &&
            spanX < 2.2 &&
            Math.abs(spanX - spanZ) < 0.05
        var cx = Math.max(box[0], Math.min(box[3], px))
        val cy = Math.max(box[1], Math.min(box[4], py))
        var cz = Math.max(box[2], Math.min(box[5], pz))
        if (isRoundPedestal) {
          val centerX = (box[0] + box[3]) * 0.5
          val centerZ = (box[2] + box[5]) * 0.5
          val rad = spanX * 0.5
          val rdx = px - centerX
          val rdz = pz - centerZ
          val rDist = Math.hypot(rdx, rdz)
          if (rDist > rad && rDist > 1e-5) {
            cx = centerX + (rdx / rDist) * rad
            cz = centerZ + (rdz / rDist) * rad
          } else {
            cx = px
            cz = pz
          }
        }
        val dx = px - cx
        val dy = py - cy
        val dz = pz - cz
        val dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist < r) {
          var nx = 0.0
          var ny = 1.0
          var nz = 0.0
          if (dist > 1e-5) {
            nx = dx / dist
            ny = dy / dist
            nz = dz / dist
            px = cx + nx * r
            py = cy + ny * r
            pz = cz + nz * r
          } else {
            py = box[4] + r
          }
          val vDotN = v[0] * nx + v[1] * ny + v[2] * nz
          if (vDotN < 0.0) {
            val j = -(1.0 + restitution) * vDotN
            v[0] += j * nx
            v[1] += j * ny
            v[2] += j * nz
            if (ny > 0.7) {
              v[0] *= 1.0 - friction * clampedDt * 5.0
              v[2] *= 1.0 - friction * clampedDt * 5.0
              if (Math.abs(v[1]) < 0.08) v[1] = 0.0
              if (box[4] > physicsFloorY + 0.12 && v[0] * v[0] + v[2] * v[2] < 0.02) {
                val angle = idx * 2.39996
                v[0] += Math.cos(angle) * 0.35
                v[2] += Math.sin(angle) * 0.35
              }
            }
          }
        }
      }

      // 3. Floor plane & room wall bounce
      if (py - r < physicsFloorY) {
        py = physicsFloorY + r
        if (v[1] < 0.0) {
          v[1] = -v[1] * restitution
          v[0] *= 1.0 - friction * clampedDt * 5.0
          v[2] *= 1.0 - friction * clampedDt * 5.0
          if (Math.abs(v[1]) < 0.08) v[1] = 0.0
        }
      }
      if (px - r < -wallBound) {
        px = -wallBound + r
        if (v[0] < 0.0) v[0] = -v[0] * restitution
      } else if (px + r > wallBound) {
        px = wallBound - r
        if (v[0] > 0.0) v[0] = -v[0] * restitution
      }
      if (pz - r < -wallBound) {
        pz = -wallBound + r
        if (v[2] < 0.0) v[2] = -v[2] * restitution
      } else if (pz + r > wallBound) {
        pz = wallBound - r
        if (v[2] > 0.0) v[2] = -v[2] * restitution
      }

      translation[i * 3] = px
      translation[i * 3 + 1] = py
      translation[i * 3 + 2] = pz

      // Roll sphere rotation quaternion from horizontal velocity
      val horizSpeed = Math.hypot(v[0], v[2])
      if (horizSpeed > 0.03) {
        val halfAngle = 0.5 * (horizSpeed * clampedDt / Math.max(0.04, r))
        val sinH = Math.sin(halfAngle)
        val cosH = Math.cos(halfAngle)
        val ax = v[2] / horizSpeed
        val az = -v[0] / horizSpeed
        val dqx = ax * sinH
        val dqy = 0.0
        val dqz = az * sinH
        val dqw = cosH
        val qx = rotation[i * 4]
        val qy = rotation[i * 4 + 1]
        val qz = rotation[i * 4 + 2]
        val qw = rotation[i * 4 + 3]
        q4a[0] = dqw * qx + dqx * qw + dqy * qz - dqz * qy
        q4a[1] = dqw * qy - dqx * qz + dqy * qw + dqz * qx
        q4a[2] = dqw * qz + dqx * qy - dqy * qx + dqz * qw
        q4a[3] = dqw * qw - dqx * qx - dqy * qy - dqz * qz
        normalizeQuatInto(q4a)
        for (k in 0 until 4) rotation[i * 4 + k] = q4a[k]
      }
      markTransform(i)
    }

    // 4. Resolve sphere-to-sphere elastic collisions
    for (aIdx in dynamicBodies.indices) {
      val a = dynamicBodies[aIdx]
      val ia = a.nodeIndex
      if (grabbed[ia] || !isEffectivelyVisible(ia)) continue
      for (bIdx in aIdx + 1 until dynamicBodies.size) {
        val b = dynamicBodies[bIdx]
        val ib = b.nodeIndex
        if (grabbed[ib] || !isEffectivelyVisible(ib)) continue
        val dx = translation[ib * 3] - translation[ia * 3]
        val dy = translation[ib * 3 + 1] - translation[ia * 3 + 1]
        val dz = translation[ib * 3 + 2] - translation[ia * 3 + 2]
        val dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        val minDist = a.radius + b.radius
        if (dist > 1e-5 && dist < minDist) {
          val nx = dx / dist
          val ny = dy / dist
          val nz = dz / dist
          val overlap = (minDist - dist) * 0.5
          translation[ia * 3] -= nx * overlap
          translation[ia * 3 + 1] -= ny * overlap
          translation[ia * 3 + 2] -= nz * overlap
          translation[ib * 3] += nx * overlap
          translation[ib * 3 + 1] += ny * overlap
          translation[ib * 3 + 2] += nz * overlap
          val rvx = b.velocity[0] - a.velocity[0]
          val rvy = b.velocity[1] - a.velocity[1]
          val rvz = b.velocity[2] - a.velocity[2]
          val velAlongNormal = rvx * nx + rvy * ny + rvz * nz
          if (velAlongNormal < 0.0) {
            val impulse = -(1.0 + restitution) * velAlongNormal * 0.5
            a.velocity[0] -= impulse * nx
            a.velocity[1] -= impulse * ny
            a.velocity[2] -= impulse * nz
            b.velocity[0] += impulse * nx
            b.velocity[1] += impulse * ny
            b.velocity[2] += impulse * nz
          }
          markTransform(ia)
          markTransform(ib)
        }
      }
      val spSq =
        a.velocity[0] * a.velocity[0] + a.velocity[1] * a.velocity[1] + a.velocity[2] * a.velocity[2]
      if (spSq > maxSpeedSq) maxSpeedSq = spSq
    }

    // 5. Periodic auto-fountain (matching web Ballpit Lab autoFountain) + settled fountain relaunch
    if (dynamicBodies.size > 1) {
      physicsFountainTimer += clampedDt
      if (elapsed >= 2.2 && physicsFountainTimer >= 1.8) {
        physicsFountainTimer = 0.0
        val pickIdx = physicsFountainIndex % dynamicBodies.size
        physicsFountainIndex++
        val pick = dynamicBodies[pickIdx]
        val pi = pick.nodeIndex
        if (!grabbed[pi] && isEffectivelyVisible(pi)) {
          val angle = (pickIdx * 2.39996) + elapsed
          pick.velocity[0] = -translation[pi * 3] * 0.8 + Math.cos(angle) * 0.45
          pick.velocity[1] = 3.4 + (pickIdx % 4) * 0.45
          pick.velocity[2] = -translation[pi * 3 + 2] * 0.8 + Math.sin(angle) * 0.45
        }
      }
    }
    if (maxSpeedSq < 0.025) {
      physicsSettledTime += clampedDt
      if (physicsSettledTime >= 1.8) {
        physicsSettledTime = 0.0
        fountainLaunchDynamicBodies()
      }
    } else {
      physicsSettledTime = 0.0
    }
  }

  private fun fountainLaunchDynamicBodies() {
    for ((idx, body) in dynamicBodies.withIndex()) {
      val i = body.nodeIndex
      if (grabbed[i]) continue
      val px = translation[i * 3]
      val pz = translation[i * 3 + 2]
      val angle = idx * 2.39996
      body.velocity[0] = -px * 0.85 + Math.cos(angle) * 0.55
      body.velocity[1] = 3.6 + (idx % 5) * 0.38
      body.velocity[2] = -pz * 0.85 + Math.sin(angle) * 0.55
    }
  }

  private fun impulsePhysicsOnSelect(nodeIndex: Int) {
    if (dynamicBodies.isEmpty()) return
    val hitBody = dynamicBodies.firstOrNull { it.nodeIndex == nodeIndex }
    if (hitBody != null) {
      val i = hitBody.nodeIndex
      val hx = translation[i * 3]
      val hy = translation[i * 3 + 1]
      val hz = translation[i * 3 + 2]
      val angle = i * 2.39996 + elapsed
      hitBody.velocity[0] = -hx * 0.9 + Math.cos(angle) * 0.65
      hitBody.velocity[1] = Math.max(hitBody.velocity[1] + 3.8, 3.8)
      hitBody.velocity[2] = -hz * 0.9 + Math.sin(angle) * 0.65
      // Radial shockwave to nearby dynamic spheres (matching web Ballpit Lab)
      for (other in dynamicBodies) {
        val oi = other.nodeIndex
        if (oi == i || grabbed[oi]) continue
        val dx = translation[oi * 3] - hx
        val dy = translation[oi * 3 + 1] - hy
        val dz = translation[oi * 3 + 2] - hz
        val dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (dist in 0.01..0.85) {
          val falloff = (1.0 - dist / 0.85) * 2.2
          other.velocity[0] += (dx / dist) * falloff
          other.velocity[1] += 1.6 * (1.0 - dist / 0.85)
          other.velocity[2] += (dz / dist) * falloff
        }
      }
      physicsSettledTime = 0.0
    } else {
      fountainLaunchDynamicBodies()
      physicsSettledTime = 0.0
    }
  }

  /** Composes the local+ancestor matrix of node [i] without [rootTransform] into [out]. */
  private fun sceneMatrix(i: Int, out: DoubleArray) {
    localMatrix(i, out)
    var cur = parent[i]
    var d = 0
    while (cur >= 0 && d < 128) {
      localMatrix(cur, mB)
      XRBlocksMath.mat4Multiply(mB, out, mC)
      mC.copyInto(out)
      cur = parent[cur]
      d++
    }
  }

  private fun localMatrix(i: Int, out: DoubleArray) {
    for (k in 0 until 3) tmpT[k] = translation[i * 3 + k]
    for (k in 0 until 4) tmpQ[k] = rotation[i * 4 + k]
    for (k in 0 until 3) tmpS[k] = scale[i * 3 + k]
    XRBlocksMath.mat4FromTRS(tmpT, tmpQ, tmpS, out)
  }

  /** Composes the scene-space matrix of node [i] into [out]. */
  private fun worldMatrix(i: Int, out: DoubleArray) {
    localMatrix(i, out)
    var cur = parent[i]
    var d = 0
    while (cur >= 0 && d < 128) {
      localMatrix(cur, mB)
      XRBlocksMath.mat4Multiply(mB, out, mC)
      mC.copyInto(out)
      cur = parent[cur]
      d++
    }
    if (!rootIsIdentity) {
      XRBlocksMath.mat4Multiply(root, out, mC)
      mC.copyInto(out)
    }
  }

  /**
   * Sets node [i] to scene-space position [pos] and (optionally) scene-space rotation [quat],
   * keeping its local scale.
   */
  private fun setWorldPose(i: Int, pos: DoubleArray, quat: DoubleArray?) {
    val p = parent[i]
    if (p < 0 && rootIsIdentity) {
      for (k in 0 until 3) translation[i * 3 + k] = pos[k]
      if (quat != null) for (k in 0 until 4) rotation[i * 4 + k] = quat[k]
    } else {
      // Convert through the parent's world matrix (the scene root for root nodes).
      if (p < 0) root.copyInto(mA) else worldMatrix(p, mA)
      if (!XRBlocksMath.mat4Invert(mA, mB)) return
      val local = XRBlocksMath.transformPoint(mB, pos[0], pos[1], pos[2], localScratch)
      for (k in 0 until 3) translation[i * 3 + k] = local[k]
      if (quat != null) {
        val pq = XRBlocksMath.extractQuaternion(mA, pqScratch)
        pq[0] = -pq[0]
        pq[1] = -pq[1]
        pq[2] = -pq[2]
        val lq = XRBlocksMath.quatMultiply(pq, quat, lqScratch)
        normalizeQuatInto(lq)
        for (k in 0 until 4) rotation[i * 4 + k] = lq[k]
      }
    }
    markTransform(i)
  }

  // =============================================================================================
  // Notification
  // =============================================================================================

  private fun flush() {
    if (!anyDirty) return
    val l = listener
    for (i in 0 until nodeCount) {
      if (dirtyTransform[i]) {
        dirtyTransform[i] = false
        if (l != null) {
          for (k in 0 until 3) sT[k] = translation[i * 3 + k].toFloat()
          for (k in 0 until 4) sR[k] = rotation[i * 4 + k].toFloat()
          for (k in 0 until 3) sS[k] = scale[i * 3 + k].toFloat()
          l.onNodeTransformChanged(i, sT, sR, sS)
        }
      }
      if (dirtyVisibility[i]) {
        dirtyVisibility[i] = false
        l?.onVisibilityChanged(i, visible[i])
      }
    }
    for (i in 0 until materialCount) {
      if (dirtyMaterial[i]) {
        dirtyMaterial[i] = false
        if (l != null) {
          for (k in 0 until 4) sBase[k] = baseColor[i * 4 + k].toFloat()
          for (k in 0 until 3) sEmissive[k] = emissive[i * 3 + k].toFloat()
          l.onMaterialChanged(i, sBase, sEmissive, metallic[i].toFloat(), roughness[i].toFloat())
          l.onAlphaCutoffChanged(i, alphaCutoff[i].toFloat())
        }
      }
    }
    anyDirty = false
  }

  private inline fun guard(block: () -> Unit) {
    try {
      block()
    } catch (e: RuntimeException) {
      // Malformed graphs must never crash the host render loop.
    } catch (e: StackOverflowError) {
      // Defensive: recursion is bounded, but never let a hostile graph kill the render thread.
    } catch (e: OutOfMemoryError) {
      // Allocation sizes are bounded by the graph limits; treat exhaustion as a failed call.
    }
  }

  private fun readNodeTrs(i: Int, node: Map<String, Any?>) {
    val t = MiniJson.asList(node["translation"])
    val r = MiniJson.asList(node["rotation"])
    val s = MiniJson.asList(node["scale"])
    val m = MiniJson.asList(node["matrix"])
    if (t == null && r == null && s == null && m != null && m.size == 16) {
      val mat = DoubleArray(16) { numOr(m[it], if (it % 5 == 0) 1.0 else 0.0) }
      for (k in 0 until 3) translation[i * 3 + k] = mat[12 + k]
      val sc = XRBlocksMath.extractScale(mat)
      val q = XRBlocksMath.extractQuaternion(mat)
      for (k in 0 until 3) scale[i * 3 + k] = sc[k]
      for (k in 0 until 4) rotation[i * 4 + k] = q[k]
      return
    }
    if (t != null) for (k in 0 until 3) translation[i * 3 + k] = numOr(t.getOrNull(k), 0.0)
    if (r != null) {
      for (k in 0 until 4) q4a[k] = numOr(r.getOrNull(k), if (k == 3) 1.0 else 0.0)
      normalizeQuatInto(q4a)
      for (k in 0 until 4) rotation[i * 4 + k] = q4a[k]
    }
    if (s != null) for (k in 0 until 3) scale[i * 3 + k] = numOr(s.getOrNull(k), 1.0)
  }

  companion object {
    /** Maximum number of nodes permitted in a single behavior graph. */
    const val MAX_GRAPH_NODES = 1024

    /** Maximum number of state variables permitted in a single graph. */
    const val MAX_VARIABLES = 256

    /** Maximum synchronous flow steps executed per event invocation. */
    const val MAX_STEPS_PER_INVOCATION = 2048

    /** Maximum concurrent property / variable tweens. */
    const val MAX_ACTIVE_TWEENS = 128

    /** Maximum concurrent scheduled delays. */
    const val MAX_ACTIVE_DELAYS = 64

    /** Maximum value-socket evaluations per top-level invocation (bounds diamond DAGs). */
    const val MAX_EVALS_PER_INVOCATION = 10_000

    /** Maximum glTF nodes accepted by a session. */
    const val MAX_NODES = 65_536

    /** Maximum glTF materials accepted by a session. */
    const val MAX_MATERIALS = 65_536

    /** Maximum value / flow sockets retained per graph node. */
    const val MAX_SOCKETS_PER_NODE = 64

    private const val MAX_FOR_DEPTH = 8
    private const val MAX_EVENT_NESTING_DEPTH = 16
    private const val MAX_SAFE_INTEGER = 9007199254740991.0

    /** Pointer segments rejected to mirror the web VM's prototype-pollution guard. */
    @JvmField val FORBIDDEN_SEGMENTS: Set<String> = setOf("__proto__", "constructor", "prototype")

    private val SELECT_OPS = setOf("pointer/onSelect", "event/onSelect", "scene/onSelect")
    private val HOVER_IN_OPS = setOf("pointer/onHoverIn", "event/onHoverIn", "scene/onHoverIn")
    private val HOVER_OUT_OPS = setOf("pointer/onHoverOut", "event/onHoverOut", "scene/onHoverOut")
    private val COMBINE_KEYS = arrayOf("a", "b", "c", "d")
    private val TEMPLATE = Regex("\\{([a-zA-Z0-9_]+)\\}")

    private const val K_T = 0
    private const val K_R = 1
    private const val K_S = 2
    private const val K_VIS = 3
    private const val K_BASE = 4
    private const val K_MET = 5
    private const val K_ROUGH = 6
    private const val K_EMIS = 7
    private const val K_ALPHA = 8

    private val EMPTY_NODE =
      GNode("", emptyMap(), emptyMap(), emptyMap(), emptyList(), emptyList(), isEventLike = false, staticPointer = null)

    private val MAX_FN: (Double, Double) -> Double = { x, y -> jsMax(x, y) }
    private val MIN_FN: (Double, Double) -> Double = { x, y -> jsMin(x, y) }

    private val UNARY_MATH: Map<String, (Double) -> Double> =
      mapOf(
        "neg" to { x -> -x },
        "abs" to { x -> Math.abs(x) },
        "sign" to { x -> Math.signum(x) },
        "floor" to { x -> Math.floor(x) },
        "ceil" to { x -> Math.ceil(x) },
        "round" to { x -> Math.floor(x + 0.5) },
        "trunc" to { x -> trunc(x) },
        "fract" to { x -> x - Math.floor(x) },
        "sqrt" to { x -> Math.sqrt(Math.max(0.0, x)) },
        "cbrt" to { x -> Math.cbrt(x) },
        "exp" to { x -> Math.exp(x) },
        "log" to { x -> if (x > 0) Math.log(x) else 0.0 },
        "sin" to { x -> Math.sin(x) },
        "cos" to { x -> Math.cos(x) },
        "tan" to { x -> Math.tan(x) },
        "asin" to { x -> Math.asin(Math.max(-1.0, Math.min(1.0, x))) },
        "acos" to { x -> Math.acos(Math.max(-1.0, Math.min(1.0, x))) },
        "atan" to { x -> Math.atan(x) },
        "rad" to { x -> x * Math.PI / 180 },
        "deg" to { x -> x * 180 / Math.PI },
        "saturate" to { x -> Math.max(0.0, Math.min(1.0, x)) },
      )

    private val BINARY_MATH: Map<String, (Double, Double) -> Double> =
      mapOf(
        "add" to { x, y -> x + y },
        "sub" to { x, y -> x - y },
        "mul" to { x, y -> x * y },
        "div" to { x, y -> if (Math.abs(y) < 1e-12) 0.0 else x / y },
        "rem" to { x, y -> if (Math.abs(y) < 1e-12) 0.0 else x % y },
        "mod" to { x, y -> if (Math.abs(y) < 1e-12) 0.0 else x % y },
        "min" to MIN_FN,
        "max" to MAX_FN,
        "pow" to { x, y -> Math.pow(x, y) },
        "atan2" to { x, y -> Math.atan2(x, y) },
      )

    /** Builds a session from a binary glTF (`.glb`) buffer. */
    @JvmStatic
    fun fromGlb(glb: ByteBuffer): XRLiveRuntimeSession {
      val json =
        XRLiveSceneCoreHelper.extractGlbJsonChunk(glb)
          ?: throw IllegalArgumentException("XRLiveRuntimeSession: not a valid .glb")
      return XRLiveRuntimeSession(json)
    }

    /**
     * Validates and splits an RFC 6901 JSON pointer, rejecting empty and prototype-pollution
     * segments (port of `parseSafeGltfPointer()`). Returns `null` when rejected.
     */
    @JvmStatic
    fun parseSafePointer(pointer: String): List<String>? {
      if (!pointer.startsWith("/")) return null
      val out = ArrayList<String>(6)
      for (raw in pointer.substring(1).split('/')) {
        val seg = raw.replace("~1", "/").replace("~0", "~")
        if (seg.isEmpty() || seg in FORBIDDEN_SEGMENTS || raw in FORBIDDEN_SEGMENTS) return null
        out.add(seg)
      }
      return out
    }

    private fun parseIdx(seg: String, max: Int): Int {
      if (seg.isEmpty() || seg.length > 9 || !seg.all { it in '0'..'9' }) return -1
      val idx = seg.toInt()
      return if (idx < max) idx else -1
    }

    private fun jsMax(x: Double, y: Double): Double = if (x.isNaN() || y.isNaN()) Double.NaN else Math.max(x, y)

    private fun jsMin(x: Double, y: Double): Double = if (x.isNaN() || y.isNaN()) Double.NaN else Math.min(x, y)

    private fun trunc(x: Double): Double = if (x < 0) Math.ceil(x) else Math.floor(x)

    private fun clamp01(v: Double): Double = Math.max(0.0, Math.min(1.0, v))

    /** `Math.hypot` over [a] (or over `a - b`), scaled to avoid overflow; `NaN` elements count 0. */
    private fun hypot(a: DoubleArray, b: DoubleArray?): Double {
      var max = 0.0
      for (i in a.indices) {
        val v = Math.abs(numZ(a[i]) - if (b != null) numZ(b.getOrElse(i) { 0.0 }) else 0.0)
        if (v > max) max = v
      }
      if (max == 0.0 || max.isInfinite() || max.isNaN()) return max
      var sum = 0.0
      for (i in a.indices) {
        val v = (numZ(a[i]) - if (b != null) numZ(b.getOrElse(i) { 0.0 }) else 0.0) / max
        sum += v * v
      }
      return max * Math.sqrt(sum)
    }

    /** `num()` for an array element: finite value or [fb]. */
    private fun numD(x: Double, fb: Double = 0.0): Double = if (x.isFinite()) x else fb

    /** JavaScript `(x || 0)` for numbers. */
    private fun numZ(x: Double): Double = if (x.isNaN()) 0.0 else x

    private fun numOr(v: Any?, fb: Double): Double {
      val d = (v as? Number)?.toDouble() ?: return fb
      return if (d.isFinite()) d else fb
    }

    /** Integral JSON number -> index, else `-1`. */
    private fun intIndex(v: Any?): Int {
      val d = (v as? Number)?.toDouble() ?: return -1
      return if (d == Math.rint(d) && d >= 0 && d < Int.MAX_VALUE) d.toInt() else -1
    }

    /** JavaScript `Number(v)` for VM values. */
    private fun jsNumber(v: Any?): Double =
      when (v) {
        null -> Double.NaN
        is Double -> v
        is Boolean -> if (v) 1.0 else 0.0
        is String -> {
          val s = v.trim()
          val last = s.lastOrNull()
          when {
            s.isEmpty() -> 0.0
            last == 'd' || last == 'D' || last == 'f' || last == 'F' -> Double.NaN
            else -> s.toDoubleOrNull() ?: Double.NaN
          }
        }
        is DoubleArray -> if (v.isEmpty()) 0.0 else if (v.size == 1) v[0] else Double.NaN
        else -> Double.NaN
      }

    /** JavaScript `String(v)` for VM values. */
    private fun jsString(v: Any?): String =
      when (v) {
        null -> "undefined"
        is Double -> MiniJson.formatNumber(v)
        is Boolean -> v.toString()
        is String -> v
        is DoubleArray -> v.joinToString(",") { MiniJson.formatNumber(it) }
        else -> v.toString()
      }

    /** Unwraps `{value: x}` configuration wrappers and single-element spec-style arrays. */
    private fun unwrapCfg(raw: Any?): Any? {
      val m = MiniJson.asMap(raw)
      val v = if (m != null && m.containsKey("value")) m["value"] else raw
      val l = v as? List<*>
      return if (l != null && l.size == 1 && (l[0] is String || l[0] is Double)) l[0] else v
    }

    private fun readCfgRaw(config: Map<String, Any?>, k: String): Any? =
      if (k in FORBIDDEN_SEGMENTS || !config.containsKey(k)) null else unwrapCfg(config[k])

    /** Converts decoded JSON / host values to VM values. */
    internal fun toVm(v: Any?): Any? =
      when (v) {
        null -> null
        is Double -> v
        is Number -> v.toDouble()
        is Boolean -> v
        is String -> v
        is DoubleArray -> v.copyOf()
        is FloatArray -> DoubleArray(v.size) { v[it].toDouble() }
        is IntArray -> DoubleArray(v.size) { v[it].toDouble() }
        is List<*> ->
          DoubleArray(v.size) {
            when (val e = v[it]) {
              is Number -> e.toDouble()
              is Boolean -> if (e) 1.0 else 0.0
              else -> Double.NaN
            }
          }
        else -> null
      }

    private fun normalizeQuatInto(q: DoubleArray) {
      val l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
      if (l > 1e-8 && l.isFinite()) {
        for (k in 0 until 4) q[k] /= l
      } else {
        q[0] = 0.0
        q[1] = 0.0
        q[2] = 0.0
        q[3] = 1.0
      }
    }
  }
}
