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
 * Native runtime for the optional `xr-live-sim` plugins (port of `xr-live/src/sim/core.ts`).
 *
 * Every glTF node whose `extras.xr` carries sim traits becomes a [Body]. Systems
 * ([CharacterController], [SteeringAgents], [HitZones], [Objectives]) step at a fixed 60 Hz and
 * move bodies by world position and yaw; the world writes poses back through
 * [XRLiveRuntimeSession.setNodeWorldPose] and visibility through
 * [XRLiveRuntimeSession.setNodeVisible]. Spawned instances have no glTF node: renderers mirror them
 * from [Listener.onInstancePose].
 *
 * Events use the same names and detail keys as the web plugins (`characterjump`, `agentreach`,
 * `xrhit`, `xrzoneenter`, `xrscenarioend`, ...). Not thread-safe: drive from one thread.
 */
class XRSimWorld(val session: XRLiveRuntimeSession, gltfJson: String) {

  /** Receives sim events and render hints. Callbacks run synchronously inside [step]. */
  interface Listener {
    /** A sim event with the web event name and detail keys. */
    fun onSimEvent(type: String, detail: Map<String, Any?>) {}

    /** The controlled character's animation clip changed. */
    fun onCharacterClip(clipName: String) {}

    /**
     * A spawned instance of glTF node [templateNodeIndex] moved or changed visibility. Renderers
     * clone the template once per [instanceId] and apply the world pose.
     */
    fun onInstancePose(
      instanceId: String,
      templateNodeIndex: Int,
      position: DoubleArray,
      quaternion: DoubleArray,
      visible: Boolean,
    ) {}

    /** A spawned instance was removed; renderers drop its clone. */
    fun onInstanceRemoved(instanceId: String) {}

    /** A `synth-audio` cue should play ([pan] `-1..1`, [gain] `0..1`). See [SynthAudio]. */
    fun onAudioCue(cue: String, pan: Double, gain: Double, pitch: Double) {}
  }

  /** One simulated node or spawned instance. */
  class Body
  internal constructor(
    val key: String,
    val name: String,
    /** glTF node index (the template node for spawned instances). */
    val nodeIndex: Int,
    val traits: XRSimTraits,
    val initPos: DoubleArray,
    internal val initQuat: DoubleArray,
    /** AABB center offset from [pos] at yaw 0. */
    val center: DoubleArray,
    /** AABB half extents. */
    val half: DoubleArray,
  ) {
    var pos: DoubleArray = initPos.copyOf()
    var yaw: Double = 0.0
    var rot: DoubleArray = doubleArrayOf(0.0, 0.0, 0.0, 1.0)
    var vel: DoubleArray = DoubleArray(3)
    var hidden: Boolean = false
    var isTemplate: Boolean = false
      internal set

    /** Key of the spawner that created this instance, or `null` for glTF nodes. */
    var spawnedFrom: String? = null
      internal set

    var integrity: Double = traits.integrity?.current ?: 0.0
    var lastHitMs: Double = Double.NEGATIVE_INFINITY
    val radius: Double = Math.sqrt(half[0] * half[0] + half[1] * half[1] + half[2] * half[2])
    internal val data = HashMap<String, Any?>()
    internal var lastWritten: DoubleArray? = null
    internal var lastVisible: Boolean? = null
    internal var viewHidden: Boolean = false

    val isInstance: Boolean
      get() = spawnedFrom != null

    /** World-space AABB center. */
    fun center(): DoubleArray {
      val c = rotateY(center, yaw)
      return doubleArrayOf(pos[0] + c[0], pos[1] + c[1], pos[2] + c[2])
    }

    /** World-space AABB as `[minX, minY, minZ, maxX, maxY, maxZ]`. */
    fun aabb(): DoubleArray {
      val c = center()
      return doubleArrayOf(
        c[0] - half[0],
        c[1] - half[1],
        c[2] - half[2],
        c[0] + half[0],
        c[1] + half[1],
        c[2] + half[2],
      )
    }
  }

  var listener: Listener? = null

  // ---- Host configuration (web host attributes) ------------------------------------------

  /** `character-controller`: `null` keeps the trait's camera mode; `"none"` disables. */
  var characterMode: String? = null
  var characterSpeed: Double? = null
  var characterJump: Double? = null
  var steeringEnabled: Boolean = true
  var rigidBodyEnabled: Boolean = true

  /** `hit-zones`: `off`, `projectile`, `hitscan`, or `contact`. */
  var hitMode: String = "off"
  var fireRate: Double = 4.0
  var projectileSpeed: Double = 14.0
  var projectileGravity: Double = 0.0
  var hitAmount: Double = 25.0

  /** `objectives` attribute present (also enabled by objective nodes or rules below). */
  var objectivesEnabled: Boolean = false
  var scenarioTimerSec: Double = 0.0
  var targetScore: Double = 0.0

  /** `attempts`; `null` is unlimited. */
  var attempts: Int? = null
  var audioEnabled: Boolean = false

  // ---- Input -------------------------------------------------------------------------------

  /** Strafe input, `-1..1`. */
  var moveX: Double = 0.0

  /** Forward input, `-1..1` (away from the camera). */
  var moveZ: Double = 0.0
  var sprint: Boolean = false
  internal var jumpQueued = false
  internal var fireQueued = false

  /** Queues a jump for the next fixed step. */
  fun jump() {
    jumpQueued = true
  }

  /** Queues a shot for the next fixed step (when [hitMode] fires). */
  fun fire() {
    fireQueued = true
  }

  // ---- State -------------------------------------------------------------------------------

  val bodies: MutableList<Body> = ArrayList()
  private val byName = HashMap<String, Body>()
  var timeMs: Double = 0.0
    internal set

  var ended: Boolean = false
    internal set

  var character: Body? = null
    internal set

  /** World-space floor fallback (minimum Y of the scene's mesh bounds). */
  val floorY: Double

  /** Scene mesh bounds `[minX, minY, minZ, maxX, maxY, maxZ]`, or `null` for no meshes. */
  val sceneBounds: DoubleArray?
  internal var spawnCounter = 0
  internal val rng = makeRng(0x5eed)
  private var accumulator = 0.0
  internal var headPose: XRPose = XRPose(floatArrayOf(0f, 1.6f, 0f))
  internal var xrActive = false
  internal val state = HashMap<String, Any>()
  private val parents: IntArray
  private val busListeners =
    HashMap<String, MutableList<(Map<String, Any?>, Body?, Body?) -> Unit>>()

  init {
    val root = MiniJson.parseObjectOrNull(gltfJson) ?: emptyMap()
    val index = GltfSceneIndex(gltfJson)
    parents = index.parents
    val traits = XRSimTraits.parseNodes(root)
    val n = session.nodeCount
    val world = DoubleArray(16)
    val owned = HashMap<Int, MutableList<Int>>()
    val sMin =
      doubleArrayOf(Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY)
    val sMax =
      doubleArrayOf(Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY)
    val corner = DoubleArray(3)
    fun meshAabb(node: Int, min: DoubleArray, max: DoubleArray): Boolean {
      val mesh = index.nodeMesh.getOrNull(node) ?: -1
      val b = index.meshBounds.getOrNull(mesh) ?: return false
      if (!session.nodeWorldMatrix(node, world)) return false
      for (c in 0 until 8) {
        XRSpatialMath.transformPoint(
          world,
          if (c and 1 != 0) b[3] else b[0],
          if (c and 2 != 0) b[4] else b[1],
          if (c and 4 != 0) b[5] else b[2],
          corner,
        )
        for (k in 0 until 3) {
          min[k] = Math.min(min[k], corner[k])
          max[k] = Math.max(max[k], corner[k])
        }
      }
      return true
    }
    for (i in 0 until n) {
      meshAabb(i, sMin, sMax)
      if ((index.nodeMesh.getOrNull(i) ?: -1) < 0) continue
      var cur = i
      var depth = 0
      while (cur in 0 until n && depth < 256) {
        if (traits.getOrNull(cur) != null) {
          owned.getOrPut(cur) { ArrayList() }.add(i)
          break
        }
        cur = index.parents.getOrElse(cur) { -1 }
        depth++
      }
    }
    sceneBounds =
      if (sMin[0].isFinite()) doubleArrayOf(sMin[0], sMin[1], sMin[2], sMax[0], sMax[1], sMax[2])
      else null
    floorY = sceneBounds?.get(1) ?: 0.0
    for (i in 0 until n) {
      val t = traits.getOrNull(i) ?: continue
      session.nodeWorldMatrix(i, world)
      val initPos = doubleArrayOf(world[12], world[13], world[14])
      val q = XRSpatialMath.extractQuaternion(world)
      val min =
        doubleArrayOf(Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY, Double.POSITIVE_INFINITY)
      val max =
        doubleArrayOf(Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY, Double.NEGATIVE_INFINITY)
      for (m in owned[i].orEmpty()) meshAabb(m, min, max)
      val has = min[0].isFinite()
      val center =
        if (has) DoubleArray(3) { (min[it] + max[it]) / 2 - initPos[it] } else DoubleArray(3)
      val half = if (has) DoubleArray(3) { (max[it] - min[it]) / 2 } else DoubleArray(3)
      addBody(Body("node:$i", session.nodeName(i) ?: "Node_$i", i, t, initPos, q, center, half))
    }
    for (b in bodies) {
      if (bodies.any { s -> s !== b && s.traits.spawner?.template == b.name }) {
        b.isTemplate = true
        b.hidden = true
      }
    }
    applyBodies()
  }

  /** First body named [name] (spawned instances are `Name#n`). */
  fun body(name: String): Body? = byName[name]

  /** Bodies that systems step (not spawner templates). */
  fun active(): List<Body> = bodies.filter { !it.isTemplate }

  internal fun addBody(b: Body) {
    bodies.add(b)
    byName.putIfAbsent(b.name, b)
  }

  internal fun removeBody(b: Body) {
    bodies.remove(b)
    if (byName[b.name] === b) byName.remove(b.name)
    if (character === b) character = null
    if (b.isInstance) listener?.onInstanceRemoved(b.name)
  }

  internal fun on(type: String, fn: (Map<String, Any?>, Body?, Body?) -> Unit): () -> Unit {
    val list = busListeners.getOrPut(type) { ArrayList() }
    list.add(fn)
    return { list.remove(fn) }
  }

  /** Dispatches [type] to internal systems and [listener]. */
  internal fun emit(
    type: String,
    detail: Map<String, Any?>,
    body: Body? = null,
    other: Body? = null,
  ) {
    for (fn in busListeners[type]?.toList().orEmpty()) {
      try {
        fn(detail, body, other)
      } catch (e: RuntimeException) {
        // One faulty listener must not stop the simulation.
      }
    }
    listener?.onSimEvent(type, detail)
  }

  /** Head (camera) position. */
  fun headPosition(): DoubleArray =
    doubleArrayOf(
      headPose.position[0].toDouble(),
      headPose.position[1].toDouble(),
      headPose.position[2].toDouble(),
    )

  /** Horizontal camera forward (unit XZ vector). */
  fun cameraForwardXZ(): DoubleArray = XRSpatialMath.horizontalForward(headPose.quaternion)

  /** 3D camera forward (unit vector): the head's local -Z. */
  fun cameraForward(): DoubleArray {
    val q = headPose.quaternion
    val x = q[0].toDouble()
    val y = q[1].toDouble()
    val z = q[2].toDouble()
    val w = q[3].toDouble()
    val f =
      doubleArrayOf(-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y)))
    return normalizeOr(f, doubleArrayOf(0.0, 0.0, -1.0))
  }

  /** Position `'user'` resolves to: the controlled character, else the head. */
  fun userPosition(): DoubleArray {
    val ch = character
    return if (ch != null && !ch.hidden) ch.pos.copyOf() else headPosition()
  }

  /**
   * Advances the world by [dtSeconds] of real time in fixed 60 Hz steps (at most 5 per call), then
   * writes body poses. [inXRSession] marks an immersive session (the head can collect objectives
   * and enter zones).
   */
  @JvmOverloads
  fun step(dtSeconds: Double, headPose: XRPose, inXRSession: Boolean = false) {
    refreshRoot()
    this.headPose = toSceneLocal(headPose)
    xrActive = inXRSession
    if (bodies.isEmpty()) return
    val frame = if (dtSeconds.isFinite()) Math.max(0.0, Math.min(0.25, dtSeconds)) else 0.0
    accumulator = Math.min(accumulator + frame, STEP * MAX_SUBSTEPS)
    while (accumulator >= STEP - 1e-9) {
      accumulator -= STEP
      if (ended) continue
      timeMs += STEP * 1000
      for (sys in SYSTEMS) {
        try {
          sys(this, STEP)
        } catch (e: RuntimeException) {
          // A failing system must not break rendering or other systems.
        }
      }
    }
    applyBodies()
  }

  /** Routes a tap / select on glTF node [nodeIndex] (or empty space when `-1`). */
  @JvmOverloads
  fun select(nodeIndex: Int, hitPoint: DoubleArray? = null) {
    if (ended || bodies.isEmpty()) return
    val point = toSceneLocalPoint(hitPoint)
    var body: Body? = null
    var cur = nodeIndex
    var depth = 0
    while (cur >= 0 && depth < 256) {
      body = bodies.firstOrNull { it.nodeIndex == cur && !it.isInstance }
      if (body != null) break
      cur = parents.getOrElse(cur) { -1 }
      depth++
    }
    if (body != null && (body.isTemplate || body.hidden)) return
    selectBody(body, point)
  }

  /** Routes a tap on a spawned instance. */
  fun selectInstance(instanceId: String, hitPoint: DoubleArray? = null) {
    val b = bodies.firstOrNull { it.isInstance && it.name == instanceId } ?: return
    if (!ended && !b.hidden) selectBody(b, toSceneLocalPoint(hitPoint))
  }

  private fun selectBody(body: Body?, hitPoint: DoubleArray?) {
    if (HitZones.select(this, body, hitPoint)) return
    if (Objectives.select(this, body)) return
    SynthAudio.select(this, body)
  }

  /** Restores authored state, removes spawned instances, and restarts the scenario. */
  fun reset() {
    for (b in bodies.toList()) {
      if (b.isInstance) {
        removeBody(b)
        continue
      }
      b.pos = b.initPos.copyOf()
      b.yaw = 0.0
      b.rot = doubleArrayOf(0.0, 0.0, 0.0, 1.0)
      b.vel = DoubleArray(3)
      b.hidden = b.isTemplate
      b.integrity = b.traits.integrity?.current ?: 0.0
      b.lastHitMs = Double.NEGATIVE_INFINITY
      b.data.clear()
    }
    timeMs = 0.0
    accumulator = 0.0
    ended = false
    jumpQueued = false
    fireQueued = false
    CharacterController.reset(this)
    RigidBodyPhysics.reset(this)
    HitZones.reset(this)
    Objectives.reset(this)
    SynthAudio.reset(this)
    applyBodies()
  }

  private val q = DoubleArray(4)
  private val q2 = DoubleArray(4)

  // Scene root (the renderer's turntable, model scale, or AR placement) mapping scene space, where
  // bodies live (as on the web), to the session's world space.
  private val root = DoubleArray(16).also { for (k in 0 until 16 step 5) it[k] = 1.0 }
  private val invRoot = DoubleArray(16).also { for (k in 0 until 16 step 5) it[k] = 1.0 }
  private val rootQuat = doubleArrayOf(0.0, 0.0, 0.0, 1.0)
  private var rootIdentity = true
  private val poseM = DoubleArray(16)
  private val localM = DoubleArray(16)

  private fun refreshRoot() {
    session.rootTransform.copyInto(root)
    rootIdentity = (0 until 16).all { root[it] == if (it % 5 == 0) 1.0 else 0.0 }
    if (!rootIdentity) {
      if (XRSpatialMath.mat4Invert(root, invRoot)) {
        XRSpatialMath.extractQuaternion(root, rootQuat)
      } else {
        rootIdentity = true
      }
    }
  }

  /** Converts a world-space head pose into scene space. */
  private fun toSceneLocal(pose: XRPose): XRPose {
    if (rootIdentity) return pose
    val p = pose.position
    val r = pose.quaternion
    XRSpatialMath.mat4FromTRS(
      doubleArrayOf(p[0].toDouble(), p[1].toDouble(), p[2].toDouble()),
      doubleArrayOf(r[0].toDouble(), r[1].toDouble(), r[2].toDouble(), r[3].toDouble()),
      doubleArrayOf(1.0, 1.0, 1.0),
      poseM,
    )
    XRSpatialMath.mat4Multiply(invRoot, poseM, localM)
    val lq = XRSpatialMath.extractQuaternion(localM)
    return XRPose(
      floatArrayOf(localM[12].toFloat(), localM[13].toFloat(), localM[14].toFloat()),
      floatArrayOf(lq[0].toFloat(), lq[1].toFloat(), lq[2].toFloat(), lq[3].toFloat()),
    )
  }

  /** Converts a world-space hit point into scene space. */
  private fun toSceneLocalPoint(p: DoubleArray?): DoubleArray? {
    if (p == null || p.size < 3) return p
    refreshRoot()
    if (rootIdentity) return p
    return XRSpatialMath.transformPoint(invRoot, p[0], p[1], p[2], DoubleArray(3))
  }

  /** Scene-space point to the session's (and renderer's) world space. */
  fun sceneToWorld(p: DoubleArray, out: DoubleArray = DoubleArray(3)): DoubleArray {
    if (rootIdentity) {
      p.copyInto(out, 0, 0, 3)
      return out
    }
    return XRSpatialMath.transformPoint(root, p[0], p[1], p[2], out)
  }

  /** The current scene-root matrix (column-major; identity when the scene root does not move). */
  fun sceneRootMatrix(): DoubleArray = root.copyOf()

  /** Writes changed body poses and visibility to the session (or instance listener). */
  internal fun applyBodies() {
    for (b in bodies) {
      val visible = !b.hidden && !b.viewHidden
      val last = b.lastWritten
      val rotIdentity = b.rot[0] == 0.0 && b.rot[1] == 0.0 && b.rot[2] == 0.0 && b.rot[3] == 1.0
      val moved =
        last == null ||
          last[0] != b.pos[0] ||
          last[1] != b.pos[1] ||
          last[2] != b.pos[2] ||
          last[3] != b.yaw ||
          last[4] != b.rot[0] ||
          last[5] != b.rot[1] ||
          last[6] != b.rot[2] ||
          last[7] != b.rot[3]
      if (b.isInstance) {
        if (moved || b.lastVisible != visible) {
          val qJoint =
            if (rotIdentity) XRSpatialMath.quatFromYaw(b.yaw, q2)
            else XRSpatialMath.quatMultiply(b.rot, XRSpatialMath.quatFromYaw(b.yaw, q2))
          XRSpatialMath.quatMultiply(qJoint, b.initQuat, q)
          listener?.onInstancePose(b.name, b.nodeIndex, b.pos.copyOf(), q.copyOf(), visible)
        }
      } else {
        if (moved && last != null) {
          val qJoint =
            if (rotIdentity) XRSpatialMath.quatFromYaw(b.yaw, q2)
            else XRSpatialMath.quatMultiply(b.rot, XRSpatialMath.quatFromYaw(b.yaw, q2))
          XRSpatialMath.quatMultiply(qJoint, b.initQuat, q)
          if (rootIdentity) {
            session.setNodeWorldPose(b.nodeIndex, b.pos, q)
          } else {
            // Bodies live in scene space; the session's world space includes the scene root.
            val wp =
              XRSpatialMath.transformPoint(root, b.pos[0], b.pos[1], b.pos[2], DoubleArray(3))
            session.setNodeWorldPose(b.nodeIndex, wp, XRSpatialMath.quatMultiply(rootQuat, q))
          }
        }
        if (b.lastVisible != visible) session.setNodeVisible(b.nodeIndex, visible)
      }
      b.lastWritten =
        doubleArrayOf(
          b.pos[0],
          b.pos[1],
          b.pos[2],
          b.yaw,
          b.rot[0],
          b.rot[1],
          b.rot[2],
          b.rot[3],
        )
      b.lastVisible = visible
    }
  }

  companion object {
    const val STEP: Double = 1.0 / 60.0
    const val MAX_SUBSTEPS: Int = 5
    const val MAX_INSTANCES: Int = 128

    private val SYSTEMS: List<(XRSimWorld, Double) -> Unit> =
      listOf(
        CharacterController::step,
        SteeringAgents::step,
        RigidBodyPhysics::step,
        HitZones::step,
        Objectives::step,
        SynthAudio::step,
      )

    /** Rotates [v] about +Y by [yaw] radians. */
    @JvmStatic
    fun rotateY(v: DoubleArray, yaw: Double): DoubleArray {
      val c = Math.cos(yaw)
      val s = Math.sin(yaw)
      return doubleArrayOf(v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c)
    }

    /** Wraps an angle into `(-PI, PI]`. */
    @JvmStatic
    fun wrapAngle(a: Double): Double {
      var x = a % (Math.PI * 2)
      if (x > Math.PI) x -= Math.PI * 2
      if (x <= -Math.PI) x += Math.PI * 2
      return x
    }

    /** Moves [from] toward [to] by at most [maxStep] radians along the short arc. */
    @JvmStatic
    fun turnToward(from: Double, to: Double, maxStep: Double): Double {
      val d = wrapAngle(to - from)
      return wrapAngle(from + Math.max(-maxStep, Math.min(maxStep, d)))
    }

    /** Yaw that points local +Z along XZ direction ([x], [z]). */
    @JvmStatic fun yawFromDir(x: Double, z: Double): Double = Math.atan2(x, z)

    internal fun normalizeOr(v: DoubleArray, fallback: DoubleArray): DoubleArray {
      val len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
      return if (len > 1e-8) doubleArrayOf(v[0] / len, v[1] / len, v[2] / len) else fallback
    }

    /**
     * Pushes a vertical cylinder (center [p], [radius]) out of AABB [box] on the XZ plane; returns
     * the corrected `(x, z)` or `null` when not overlapping.
     */
    @JvmStatic
    fun pushCircleOutOfAABB(p: DoubleArray, radius: Double, box: DoubleArray): DoubleArray? {
      val cx = Math.max(box[0], Math.min(box[3], p[0]))
      val cz = Math.max(box[2], Math.min(box[5], p[2]))
      val dx = p[0] - cx
      val dz = p[2] - cz
      val d2 = dx * dx + dz * dz
      if (d2 >= radius * radius) return null
      if (d2 > 1e-12) {
        val d = Math.sqrt(d2)
        return doubleArrayOf(cx + dx / d * radius, cz + dz / d * radius)
      }
      val exits =
        arrayOf(
          doubleArrayOf(p[0] - box[0], box[0] - radius, p[2]),
          doubleArrayOf(box[3] - p[0], box[3] + radius, p[2]),
          doubleArrayOf(p[2] - box[2], p[0], box[2] - radius),
          doubleArrayOf(box[5] - p[2], p[0], box[5] + radius),
        )
      var best = exits[0]
      for (e in exits) if (e[0] < best[0]) best = e
      return doubleArrayOf(best[1], best[2])
    }

    /** Entry `t` in `[0, 1]` of segment [a]-[b] into a sphere, or `null`. */
    @JvmStatic
    fun intersectSegmentSphere(
      a: DoubleArray,
      b: DoubleArray,
      center: DoubleArray,
      radius: Double,
    ): Double? {
      val d = doubleArrayOf(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      val f = doubleArrayOf(a[0] - center[0], a[1] - center[1], a[2] - center[2])
      val aa = d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
      val c = f[0] * f[0] + f[1] * f[1] + f[2] * f[2] - radius * radius
      if (c <= 0) return 0.0
      if (aa < 1e-12) return null
      val bb = 2 * (f[0] * d[0] + f[1] * d[1] + f[2] * d[2])
      val disc = bb * bb - 4 * aa * c
      if (disc < 0) return null
      val t = (-bb - Math.sqrt(disc)) / (2 * aa)
      return if (t in 0.0..1.0) t else null
    }

    /** Entry `t` in `[0, 1]` of segment [a]-[b] into AABB [box], or `null`. */
    @JvmStatic
    fun intersectSegmentAABB(a: DoubleArray, b: DoubleArray, box: DoubleArray): Double? {
      var t0 = 0.0
      var t1 = 1.0
      for (i in 0 until 3) {
        val d = b[i] - a[i]
        if (Math.abs(d) < 1e-12) {
          if (a[i] < box[i] || a[i] > box[i + 3]) return null
          continue
        }
        var ta = (box[i] - a[i]) / d
        var tb = (box[i + 3] - a[i]) / d
        if (ta > tb) ta = tb.also { tb = ta }
        t0 = Math.max(t0, ta)
        t1 = Math.min(t1, tb)
        if (t0 > t1) return null
      }
      return t0
    }

    /** Deterministic mulberry32 PRNG in `[0, 1)` (matches the web runtime bit for bit). */
    @JvmStatic
    fun makeRng(seed: Int): () -> Double {
      var s = seed
      return {
        s += 0x6d2b79f5
        var t = s
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + (t xor (t ushr 7)) * (t or 61))
        ((t xor (t ushr 14)).toLong() and 0xffffffffL).toDouble() / 4294967296.0
      }
    }

    /** FNV-1a hash of [s] as an unsigned 32-bit value (matches the web runtime). */
    @JvmStatic
    fun hashString(s: String): Long {
      var h = 0x811c9dc5.toInt()
      for (ch in s) {
        h = h xor ch.code
        h *= 0x01000193
      }
      return h.toLong() and 0xffffffffL
    }
  }
}
