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
 * Native XR Blocks features on top of any [ThreeLiveSceneRenderer] that supports dynamic meshes:
 *
 * - **Manipulation handles** for nodes with a `handles` trait: corner cubes scale uniformly and the
 *   pedestal bar yaws the node (same math as `manipulation-handles.ts`), reported as
 *   `{mesh, scale, yawDeg}`.
 * - **Spatial paint** (when [paintColor] is set): dragging in empty space draws a tube stroke 0.4 m
 *   in front of the camera (web screen-paint depth), reported as `{index, points, lengthMeters}`.
 * - **Particles** for nodes with a `particles` trait, simulated with the shared `ParticleEmitter`
 *   (same presets and seeds as web) and drawn as camera-facing quads.
 *
 * Attach after creating the [binding]; [dispose] removes everything. Main thread only.
 */
class XRBlocksFeatures(
  private val binding: ThreeLiveRuntimeBinding,
  private val renderer: ThreeLiveSceneRenderer,
) {
  /** Feature events, matching the web `xr-handles-change` / `xr-paint-stroke` details. */
  interface Listener {
    fun onHandlesChange(mesh: String, scale: Double, yawDeg: Double) {}

    fun onPaintStroke(index: Int, points: Int, lengthMeters: Double) {}
  }

  var listener: Listener? = null

  /** Linear RGBA paint color, or `null` to disable spatial paint (the default). */
  var paintColor: FloatArray? = null

  /** Optional floor height (meters) that particles collide with. */
  var floorY: Double? = null

  private val session = binding.session
  private val scene = binding.scene

  private class HandleNode(val node: Int, val trait: XRHandlesTrait) {
    val drag = ManipulationHandles.Drag(trait)
    val meshIds = IntArray(5) { -1 }
    var layout: ManipulationHandles.Layout? = null
  }

  private class Emitter(val node: Int, val emitter: ParticleEmitter, var meshId: Int = -1)

  private class Stroke(val builder: TubeStrokeBuilder, var meshId: Int, val index: Int)

  private val handles = ArrayList<HandleNode>()
  private val emitters = ArrayList<Emitter>()
  private val strokes = ArrayList<Stroke>()
  private var dragging: HandleNode? = null
  private var painting: Stroke? = null
  private var strokeCount = 0
  private var disposed = false

  private val world = DoubleArray(16)
  private val matrix = FloatArray(16)
  private val pos = DoubleArray(3)

  init {
    for (t in session.traits) {
      val node = t.nodeIndex
      if (node !in 0 until scene.nodeCount) continue
      t.handles?.let { if (scene.meshBounds.getOrNull(scene.nodeMesh[node]) != null) handles.add(HandleNode(node, it)) }
      t.particles?.let { emitters.add(Emitter(node, ParticleEmitter(it, seed = node + 1))) }
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

  /** Removes every dynamic mesh and detaches from the binding. */
  fun dispose() {
    if (disposed) return
    disposed = true
    binding.pointerHandler = null
    binding.frameHandler = null
    for (h in handles) for (id in h.meshIds) renderer.removeDynamicMesh(id)
    for (e in emitters) renderer.removeDynamicMesh(e.meshId)
    for (s in strokes) renderer.removeDynamicMesh(s.meshId)
    handles.clear()
    emitters.clear()
    strokes.clear()
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
      val yaw = XRBlocksMath.yawFromQuat(q[0].toDouble(), q[1].toDouble(), q[2].toDouble(), q[3].toDouble())
      listener?.onHandlesChange(scene.nodeNames.getOrNull(h.node) ?: "", t.scale[0].toDouble(), Math.toDegrees(yaw))
      return
    }
    val stroke = painting ?: return
    painting = null
    rebuild(stroke)
    listener?.onPaintStroke(stroke.index, stroke.builder.pointCount, stroke.builder.lengthMeters)
  }

  private fun paintAt(stroke: Stroke, p: ThreeLivePointer): Boolean {
    val dir = XRBlocksMath.normalizeRayDir(p.direction.copyOf()) ?: return false
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
    for (h in handles) placeHandles(h)
    for (e in emitters) stepEmitter(e, dt, cameraWorld)
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
    val len = XRBlocksMath.dist3(layout.pedestalStart, layout.pedestalEnd)
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

  companion object {
    const val MAX_STROKES: Int = 256
    const val MAX_STROKE_POINTS: Int = 2048
    const val SCREEN_PAINT_DEPTH: Double = 0.4
    private const val REBUILD_EVERY = 3
    private const val PARTICLE_SIZE = 0.012

    private val HANDLE_COLOR = floatArrayOf(0.95f, 0.95f, 1f, 0.9f)
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
