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
 * Draws an [XRSimWorld] through a [ThreeLiveSceneRenderer] the way the web `xr-live-sim` plugins
 * do: spawned instances, the character follow camera ([CharacterController.cameraRig]), and the
 * [HitZones.visuals] list (hit flashes, integrity bars, projectiles, burst fragments, and colored
 * zone outlines). Main thread only.
 *
 * Hosts forward [XRSimWorld.Listener.onInstancePose] / [XRSimWorld.Listener.onInstanceRemoved] to
 * [onInstancePose] / [onInstanceRemoved] and call [sync] after every [XRSimWorld.step].
 */
class XRSimRenderBridge(
  private val world: XRSimWorld,
  private val renderer: ThreeLiveSceneRenderer,
  private val scene: GltfSceneIndex? = null,
) {
  private val instances = HashMap<String, Int>()
  private val bars = HashMap<XRSimWorld.Body, IntArray>()
  private val zones = HashMap<XRSimWorld.Body, Int>()
  private val projectileMeshes = ArrayList<Int>()
  private val fragmentMeshes = ArrayList<Int>()
  private val flashing = HashSet<XRSimWorld.Body>()
  private var cameraMode: String? = null
  private var following = false
  private val trs = DoubleArray(16)
  private val world16 = DoubleArray(16)
  private val out16 = FloatArray(16)
  private val zero16 = FloatArray(16)

  /** Mirrors a spawned instance (create on first pose). */
  fun onInstancePose(
    instanceId: String,
    templateNodeIndex: Int,
    position: DoubleArray,
    quaternion: DoubleArray,
    visible: Boolean,
  ) {
    val id =
      instances[instanceId]
        ?: renderer.instantiateNode(templateNodeIndex).also {
          if (it < 0) return
          instances[instanceId] = it
        }
    renderer.setInstancePose(
      id,
      floatArrayOf(position[0].toFloat(), position[1].toFloat(), position[2].toFloat()),
      floatArrayOf(
        quaternion[0].toFloat(),
        quaternion[1].toFloat(),
        quaternion[2].toFloat(),
        quaternion[3].toFloat(),
      ),
    )
    renderer.setInstanceVisible(id, visible)
  }

  /** Sim instance id for a renderer instance id (from a tap), or `null`. */
  fun instanceName(rendererInstanceId: Int): String? =
    instances.entries.firstOrNull { it.value == rendererInstanceId }?.key

  /** Drops a removed instance. */
  fun onInstanceRemoved(instanceId: String) {
    instances.remove(instanceId)?.let { renderer.removeInstance(it) }
  }

  /** Applies the camera rig and visuals for the current world state. */
  fun sync() {
    syncCamera()
    val v = HitZones.visuals(world)
    syncFlashes(v.flashing)
    syncBars(v.bars)
    syncPool(projectileMeshes, v.projectiles, PROJECTILE_SIZE) { PROJECTILE_COLOR }
    syncPool(fragmentMeshes, v.fragments.map { it.pos }, FRAGMENT_SIZE) { i ->
      v.fragments[i].source?.let { colorOf(it) } ?: WHITE
    }
    syncZones(v.zones)
  }

  /** Removes every mesh and instance this bridge created and stops following. */
  fun dispose() {
    for (b in flashing) flash(b, false)
    flashing.clear()
    for (id in instances.values) renderer.removeInstance(id)
    instances.clear()
    for (ids in bars.values) ids.forEach { renderer.removeDynamicMesh(it) }
    bars.clear()
    for (id in zones.values) renderer.removeDynamicMesh(id)
    zones.clear()
    (projectileMeshes + fragmentMeshes).forEach { renderer.removeDynamicMesh(it) }
    projectileMeshes.clear()
    fragmentMeshes.clear()
    if (following) renderer.setCameraFollow(null, 0.0, 0.0, false)
    following = false
    cameraMode = null
  }

  private fun syncCamera() {
    val rig = CharacterController.cameraRig(world)
    if (rig == null) {
      if (following) renderer.setCameraFollow(null, 0.0, 0.0, false)
      following = false
      cameraMode = null
      return
    }
    val target = world.sceneToWorld(rig.target)
    val reframe = rig.mode != cameraMode
    renderer.setCameraFollow(target, rig.phiDeg, rig.distance * rootScale(), reframe)
    following = true
    cameraMode = rig.mode
  }

  private fun flash(b: XRSimWorld.Body, on: Boolean) {
    if (b.isInstance) {
      instances[b.name]?.let { renderer.setInstanceFlash(it, on) }
    } else {
      renderer.setNodeFlash(b.nodeIndex, on)
    }
  }

  private fun syncFlashes(now: List<XRSimWorld.Body>) {
    val next = now.toHashSet()
    for (b in flashing) if (b !in next) flash(b, false)
    for (b in next) if (b !in flashing) flash(b, true)
    flashing.clear()
    flashing.addAll(next)
  }

  private fun syncBars(list: List<HitZones.BarVisual>) {
    val shown = HashSet<XRSimWorld.Body>()
    for (bv in list) {
      val ids =
        bars.getOrPut(bv.body) {
          intArrayOf(
            renderer.addDynamicMesh(CUBE_POSITIONS, null, CUBE_INDICES, BAR_BG_COLOR),
            renderer.addDynamicMesh(CUBE_POSITIONS, null, CUBE_INDICES, bv.color),
          )
        }
      if (ids[0] < 0 || ids[1] < 0) continue
      shown += bv.body
      val q = XRSpatialMath.quatFromYaw(bv.yaw)
      place(ids[0], bv.center, q, doubleArrayOf(bv.width + 0.02, 0.07, 0.01))
      // Left-align the fill along the bar's local X axis, slightly in front.
      val off = XRSimWorld.rotateY(doubleArrayOf(-(1 - bv.frac) * bv.width / 2, 0.0, 0.006), bv.yaw)
      place(
        ids[1],
        doubleArrayOf(bv.center[0] + off[0], bv.center[1], bv.center[2] + off[2]),
        q,
        doubleArrayOf(Math.max(1e-3, bv.width * bv.frac), 0.05, 0.012),
      )
      renderer.setDynamicMeshColor(ids[1], bv.color)
    }
    for ((b, ids) in bars) if (b !in shown) ids.forEach { hide(it) }
    // Drop bars of removed bodies (spawned instances).
    bars.keys
      .filter { it !in world.bodies }
      .forEach { b -> bars.remove(b)?.forEach { renderer.removeDynamicMesh(it) } }
  }

  private fun syncPool(
    pool: ArrayList<Int>,
    positions: List<DoubleArray>,
    size: Double,
    color: (Int) -> FloatArray,
  ) {
    while (pool.size < positions.size) {
      val id = renderer.addDynamicMesh(CUBE_POSITIONS, null, CUBE_INDICES, color(pool.size))
      if (id < 0) break
      pool += id
    }
    for ((i, id) in pool.withIndex()) {
      if (i < positions.size) {
        renderer.setDynamicMeshColor(id, color(i))
        place(id, positions[i], IDENTITY_Q, doubleArrayOf(size, size, size))
      } else {
        hide(id)
      }
    }
  }

  private fun syncZones(list: List<HitZones.ZoneVisual>) {
    val shown = HashSet<XRSimWorld.Body>()
    for (z in list) {
      val id =
        zones.getOrPut(z.body) {
          val g = EDGE_BOX
          renderer.addDynamicMesh(g.first, null, g.second, z.color)
        }
      if (id < 0) continue
      shown += z.body
      place(id, z.center, XRSpatialMath.quatFromYaw(z.yaw), z.size)
    }
    for ((b, id) in zones) if (b !in shown) hide(id)
    zones.keys
      .filter { it !in world.bodies }
      .forEach { b -> zones.remove(b)?.let { renderer.removeDynamicMesh(it) } }
  }

  /** Writes `sceneRoot × TRS` for a scene-space pose into a dynamic mesh. */
  private fun place(id: Int, pos: DoubleArray, q: DoubleArray, scale: DoubleArray) {
    XRSpatialMath.mat4FromTRS(pos, q, scale, trs)
    XRSpatialMath.mat4Multiply(world.sceneRootMatrix(), trs, world16)
    for (k in 0 until 16) out16[k] = world16[k].toFloat()
    renderer.setDynamicMeshTransform(id, out16)
  }

  private fun hide(id: Int) = renderer.setDynamicMeshTransform(id, zero16)

  private fun rootScale(): Double {
    val s = XRSpatialMath.extractScale(world.sceneRootMatrix())
    val avg = (s[0] + s[1] + s[2]) / 3
    return if (avg.isFinite() && avg > 1e-9) avg else 1.0
  }

  /** Base color of the first mesh primitive under [b] (what the web burst uses), or white. */
  private fun colorOf(b: XRSimWorld.Body): FloatArray? {
    val sc = scene ?: return null
    if (b.nodeIndex !in 0 until sc.nodeMesh.size) return null
    for (n in sc.subtree(b.nodeIndex)) {
      val mesh = sc.nodeMesh.getOrElse(n) { -1 }
      val mat = sc.meshPrimitiveMaterials.getOrNull(mesh)?.firstOrNull() ?: continue
      if (mat < 0) continue
      return world.session.materialColor(mat)
    }
    return null
  }

  companion object {
    private val WHITE = floatArrayOf(1f, 1f, 1f, 1f)
    private val PROJECTILE_COLOR = floatArrayOf(1f, 0.85f, 0.2f, 1f)
    private val BAR_BG_COLOR = floatArrayOf(0.06f, 0.09f, 0.16f, 1f)
    private const val PROJECTILE_SIZE = 0.07
    private const val FRAGMENT_SIZE = 0.04
    private val IDENTITY_Q = doubleArrayOf(0.0, 0.0, 0.0, 1.0)
    private val CUBE_POSITIONS = XRSpatialFeatures.UNIT_CUBE_POSITIONS
    private val CUBE_INDICES = XRSpatialFeatures.UNIT_CUBE_INDICES

    /** Unit wireframe box (12 edges, 0.02 thick, like the web zone outline). */
    internal val EDGE_BOX: Pair<FloatArray, IntArray> by lazy {
      val t = 0.02f
      val positions = ArrayList<Float>()
      val indices = ArrayList<Int>()
      for (axis in 0 until 3) {
        val others = (0 until 3).filter { it != axis }
        for (u in floatArrayOf(-0.5f, 0.5f)) {
          for (w in floatArrayOf(-0.5f, 0.5f)) {
            val base = positions.size / 3
            for (k in 0 until 8) {
              for (c in 0 until 3) {
                val unit = CUBE_POSITIONS[k * 3 + c]
                val scale = if (c == axis) 1 + t else t
                val offset =
                  when (c) {
                    others[0] -> u
                    others[1] -> w
                    else -> 0f
                  }
                positions += unit * scale + offset
              }
            }
            for (ix in CUBE_INDICES) indices += ix + base
          }
        }
      }
      positions.toFloatArray() to indices.toIntArray()
    }
  }
}
