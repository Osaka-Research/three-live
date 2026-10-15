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
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native XR Blocks features (handles, paint, particles) against a recording fake renderer. */
class XRBlocksFeaturesTest {

  @Test
  fun meshBoundsComeFromPositionAccessors() {
    val idx = GltfSceneIndex(SCENE)
    assertArrayEquals(doubleArrayOf(-0.5, 0.0, -0.5, 0.5, 1.0, 0.5), idx.meshBounds[0], 1e-12)
  }

  @Test
  fun cornerDragScalesWithinTraitLimitsAndReportsChange() {
    val r = FakeRenderer()
    val b = ThreeLiveRuntimeBinding(r, glbOf(SCENE))
    val f = XRBlocksFeatures(b, r)
    val changes = ArrayList<Triple<String, Double, Double>>()
    f.listener =
      object : XRBlocksFeatures.Listener {
        override fun onHandlesChange(mesh: String, scale: Double, yawDeg: Double) {
          changes.add(Triple(mesh, scale, yawDeg))
        }
      }
    assertEquals(1, f.handleCount)
    assertEquals(5, r.meshes.size)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    // Corner layout of the box (world = node translation (0, 0, -2)).
    val world = DoubleArray(16).also { assertTrue(b.session.nodeWorldMatrix(0, it)) }
    val layout = ManipulationHandles.computeLayout(doubleArrayOf(-0.5, 0.0, -0.5), doubleArrayOf(0.5, 1.0, 0.5), world)
    val corner = layout.corners[0]
    val origin = doubleArrayOf(0.0, 0.5, 2.0)
    val toCorner = doubleArrayOf(corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2])
    assertTrue(r.listener!!.onPointerDown(ThreeLivePointer(origin, toCorner, ThreeLivePick(0, null))))
    // Drag far outward: scale clamps to the trait max (3).
    val far = doubleArrayOf(corner[0] * 50 - origin[0], corner[1] * 50 - origin[1], corner[2] - origin[2])
    r.listener!!.onPointerMove(ThreeLivePointer(origin, far, null))
    r.listener!!.onPointerUp(ThreeLivePointer(origin, far, null))
    assertEquals(1, changes.size)
    assertEquals("Box", changes[0].first)
    assertTrue(changes[0].second > 1.0 && changes[0].second <= 3.0 + 1e-9)
    assertEquals(changes[0].second.toFloat(), r.transforms[0]!![1][0], 1e-5f)
    // A pointer that misses every handle is not captured (paint disabled by default).
    assertFalse(r.listener!!.onPointerDown(ThreeLivePointer(origin, doubleArrayOf(0.0, 1.0, 0.0), null)))
    f.dispose()
    assertTrue(r.meshes.isEmpty())
  }

  @Test
  fun turntableRootRotatesHandleLayoutAndDragStillScales() {
    val r = FakeRenderer()
    val b = ThreeLiveRuntimeBinding(r, glbOf(SCENE))
    val f = XRBlocksFeatures(b, r)
    // 90° about +Y: the box at (0, 0, -2) moves to (-2, 0, 0).
    r.root = floatArrayOf(0f, 0f, -1f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 0f, 1f)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    val world = DoubleArray(16).also { assertTrue(b.session.nodeWorldMatrix(0, it)) }
    assertEquals(-2.0, world[12], 1e-9)
    assertEquals(0.0, world[14], 1e-9)
    val layout = ManipulationHandles.computeLayout(doubleArrayOf(-0.5, 0.0, -0.5), doubleArrayOf(0.5, 1.0, 0.5), world)
    val corner = layout.corners[0]
    assertTrue(corner[0] < -1.0)
    val origin = doubleArrayOf(0.0, 0.5, 0.0)
    val toCorner = doubleArrayOf(corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2])
    assertTrue(r.listener!!.onPointerDown(ThreeLivePointer(origin, toCorner, null)))
    // Aim beyond the corner, away from the node's pivot, to scale up.
    val pivot = doubleArrayOf(world[12], world[13], world[14])
    val target = DoubleArray(3) { pivot[it] + (corner[it] - pivot[it]) * 1.6 }
    val far = DoubleArray(3) { target[it] - origin[it] }
    r.listener!!.onPointerMove(ThreeLivePointer(origin, far, null))
    r.listener!!.onPointerUp(ThreeLivePointer(origin, far, null))
    // Local scale grew (the drag was interpreted in the rotated world frame).
    assertTrue(b.session.nodeTransform(0)!!.scale[0] > 1.05f)
    // Local translation is untouched by the root.
    assertArrayEquals(floatArrayOf(0f, 0f, -2f), b.session.nodeTransform(0)!!.translation, 1e-6f)
    f.dispose()
  }

  @Test
  fun lazyFollowHudStaysPutInWorldWhileTurntableSpins() {
    val r = FakeRenderer()
    val b =
      ThreeLiveRuntimeBinding(
        r,
        glbOf("""{"nodes":[{"name":"Hud","extras":{"xr":{"follow":{"mode":"head","lazy":true,"distance":1.0}}}}],"scenes":[{"nodes":[0]}]}"""),
      )
    repeat(120) { r.listener!!.onFrame(1.0 / 60, IDENTITY) }
    val before = DoubleArray(16).also { b.session.nodeWorldMatrix(0, it) }
    // Spin the root 90°; the HUD's world position must not jump with it.
    r.root = floatArrayOf(0f, 0f, -1f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 0f, 1f)
    repeat(120) { r.listener!!.onFrame(1.0 / 60, IDENTITY) }
    val after = DoubleArray(16).also { b.session.nodeWorldMatrix(0, it) }
    for (k in 12..14) assertEquals(before[k], after[k], 0.02)
  }

  @Test
  fun emptySpaceDragPaintsStrokeAtScreenDepth() {
    val r = FakeRenderer()
    val b = ThreeLiveRuntimeBinding(r, glbOf("""{"nodes":[{"name":"A"}],"scenes":[{"nodes":[0]}]}"""))
    val f = XRBlocksFeatures(b, r)
    f.paintColor = floatArrayOf(1f, 0f, 0f, 1f)
    var summary: Triple<Int, Int, Double>? = null
    f.listener =
      object : XRBlocksFeatures.Listener {
        override fun onPaintStroke(index: Int, points: Int, lengthMeters: Double) {
          summary = Triple(index, points, lengthMeters)
        }
      }
    val origin = doubleArrayOf(0.0, 0.0, 0.0)
    assertFalse(r.listener!!.onPointerDown(ThreeLivePointer(origin, doubleArrayOf(0.0, 0.0, -1.0), ThreeLivePick(0, null))))
    assertTrue(r.listener!!.onPointerDown(ThreeLivePointer(origin, doubleArrayOf(0.0, 0.0, -1.0), null)))
    for (i in 1..6) {
      r.listener!!.onPointerMove(ThreeLivePointer(origin, doubleArrayOf(i * 0.05, 0.0, -1.0), null))
    }
    r.listener!!.onPointerUp(ThreeLivePointer(origin, doubleArrayOf(0.3, 0.0, -1.0), null))
    val s = summary!!
    assertEquals(0, s.first)
    assertEquals(7, s.second)
    assertTrue(s.third > 0.05)
    val mesh = r.meshes.values.single()
    assertTrue(mesh.positions.size > 9)
    // Points lie 0.4 m from the eye.
    assertEquals(-0.4, mesh.positions[2].toDouble(), 0.05)
    f.dispose()
  }

  @Test
  fun particleEmittersDrawCameraFacingQuads() {
    val r = FakeRenderer()
    val b =
      ThreeLiveRuntimeBinding(
        r,
        glbOf("""{"nodes":[{"name":"Snow","translation":[0,1,0],"extras":{"xr":{"particles":{"preset":"snow","count":10}}}}],"scenes":[{"nodes":[0]}]}"""),
      )
    val f = XRBlocksFeatures(b, r)
    assertEquals(1, f.emitterCount)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    val mesh = r.meshes.values.single()
    assertEquals(10 * 4 * 3, mesh.positions.size)
    assertEquals(10 * 6, mesh.indices.size)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    assertEquals(1, r.meshes.size)
    val (quad, _) = XRBlocksFeatures.particleQuads(floatArrayOf(0f, 0f, 0f), 1, IDENTITY, 2.0)
    assertArrayEquals(floatArrayOf(-1f, -1f, 0f, 1f, -1f, 0f, 1f, 1f, 0f, -1f, 1f, 0f), quad, 1e-6f)
    f.dispose()
  }

  @Test
  fun splatCloudDownloadsSortsAndDrawsQuadsWhenCameraMoves() {
    val r = FakeRenderer()
    val glb =
      glbOf(
        """{"nodes":[{"name":"Room","translation":[0,0,-2],"extras":{"xr":{"splatUrl":"https://cdn.test/room.spz"}}}],
          "scenes":[{"nodes":[0]}]}"""
      )
    val b = ThreeLiveRuntimeBinding(r, glb)
    // Cross-origin URL rejected when allowRemoteSplats = false against a different baseUrl.
    val blocked =
      XRBlocksFeatures(
        b,
        r,
        baseUrl = "https://site.test/scene.glb",
        allowRemoteSplats = false,
        splatLoader = { _, _, _ -> error("must not load") },
        backgroundExecutor = java.util.concurrent.Executor { it.run() },
      )
    assertEquals(0, blocked.splatCount)
    blocked.dispose()

    // Allowed when allowRemoteSplats = true.
    val fakeData = SplatData(2)
    fakeData.positions[2] = -1f
    fakeData.positions[5] = -3f
    fakeData.scales.fill(0.2f)
    fakeData.colors.fill(200.toByte())
    val allowed =
      XRBlocksFeatures(
        b,
        r,
        baseUrl = "https://site.test/scene.glb",
        allowRemoteSplats = true,
        splatLoader = { _, _, _ -> fakeData },
        backgroundExecutor = java.util.concurrent.Executor { it.run() },
      )
    assertEquals(1, allowed.splatCount)
    r.listener!!.onFrame(0.1, IDENTITY)
    assertEquals(1, r.splatMeshes.size)
    val firstMesh = r.splatMeshes.values.single()
    // 2 splats -> 8 vertices (24 floats), 12 indices; farthest (-3) sorted first (z = -5 in world).
    assertEquals(24, firstMesh.positions.size)
    assertEquals(-5f, firstMesh.positions[2], 1e-4f)
    assertEquals(-3f, firstMesh.positions[14], 1e-4f)
    allowed.dispose()
    assertTrue(r.splatMeshes.isEmpty())

    // GPU billboard path: static local positions uploaded once, only indices updated on re-sort.
    r.gpuSplats = true
    val gpuFeatures =
      XRBlocksFeatures(
        b,
        r,
        baseUrl = "https://site.test/scene.glb",
        allowRemoteSplats = true,
        splatLoader = { _, _, _ -> fakeData },
        backgroundExecutor = java.util.concurrent.Executor { it.run() },
      )
    assertEquals(SplatParser.DEFAULT_MAX_GPU_SPLATS, gpuFeatures.maxSplats)
    r.listener!!.onFrame(0.1, IDENTITY)
    val gpuMesh = r.splatMeshes.values.single()
    // Static vertices are in local space (-1 and -3); sorted indices draw splat 1 (vertices 4..7) first.
    assertEquals(-1f, gpuMesh.positions[2], 1e-4f)
    assertEquals(-3f, gpuMesh.positions[14], 1e-4f)
    assertArrayEquals(intArrayOf(4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3), gpuMesh.indices)
    // Move camera behind splats (+Z looking toward +Z) so splat 0 (-1) is farther than splat 1 (-3).
    val flippedCam = IDENTITY.copyOf().also { it[8] = 0f; it[9] = 0f; it[10] = -1f; it[14] = -10f }
    r.listener!!.onFrame(0.1, flippedCam)
    assertEquals(1, r.indexOnlyUpdates)
    assertArrayEquals(intArrayOf(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7), gpuMesh.indices)
    gpuFeatures.dispose()
  }

  private class Mesh(var positions: FloatArray, var indices: IntArray)

  private class FakeRenderer : ThreeLiveSceneRenderer {
    override var listener: ThreeLiveRendererListener? = null
    /** Scene-root matrix reported to the binding (e.g. a turntable), or `null` for none. */
    var root: FloatArray? = null
    var gpuSplats: Boolean = false
    var indexOnlyUpdates: Int = 0

    override val supportsGpuSplats: Boolean
      get() = gpuSplats

    override fun sceneRootMatrix(out: FloatArray): Boolean {
      val r = root ?: return false
      r.copyInto(out)
      return true
    }
    val meshes = LinkedHashMap<Int, Mesh>()
    val splatMeshes = LinkedHashMap<Int, Mesh>()
    val transforms = HashMap<Int, List<FloatArray>>()
    private var next = 1

    override fun load(glb: ByteBuffer) {}

    override fun setCameraOptions(options: ThreeLiveCameraOptions) {}

    override fun setNodeTransform(nodeIndex: Int, translation: FloatArray, rotation: FloatArray, scale: FloatArray) {
      transforms[nodeIndex] = listOf(rotation.copyOf(), scale.copyOf())
    }

    override fun setNodeVisible(nodeIndex: Int, visible: Boolean) {}

    override fun setMaterialFactors(
      materialIndex: Int,
      baseColorFactor: FloatArray,
      emissiveFactor: FloatArray,
      metallicFactor: Float,
      roughnessFactor: Float,
    ) {}

    override fun addDynamicMesh(positions: FloatArray, normals: FloatArray?, indices: IntArray, color: FloatArray): Int {
      val id = next++
      meshes[id] = Mesh(positions, indices)
      return id
    }

    override fun updateDynamicMesh(meshId: Int, positions: FloatArray, normals: FloatArray?, indices: IntArray) {
      meshes[meshId]?.let {
        it.positions = positions
        it.indices = indices
      }
    }

    override fun removeDynamicMesh(meshId: Int) {
      meshes.remove(meshId)
      splatMeshes.remove(meshId)
    }

    override fun addSplatMesh(positions: FloatArray, uvs: FloatArray, colors: ByteArray, indices: IntArray): Int {
      val id = next++
      splatMeshes[id] = Mesh(positions, indices)
      return id
    }

    override fun updateSplatMesh(
      meshId: Int,
      positions: FloatArray,
      uvs: FloatArray,
      colors: ByteArray,
      indices: IntArray,
    ) {
      splatMeshes[meshId]?.let {
        it.positions = positions
        it.indices = indices
      }
    }

    override fun updateSplatMeshIndices(meshId: Int, indices: IntArray) {
      splatMeshes[meshId]?.let {
        it.indices = indices
        indexOnlyUpdates++
      }
    }

    override fun dispose() {}
  }

  private fun glbOf(json: String): ByteBuffer {
    val jsonBytes = json.toByteArray(Charsets.UTF_8)
    val paddedLen = (jsonBytes.size + 3) and -4
    val totalLen = 12 + 8 + paddedLen
    val glb = ByteBuffer.allocateDirect(totalLen).order(ByteOrder.LITTLE_ENDIAN)
    glb.putInt(0x46546C67)
    glb.putInt(2)
    glb.putInt(totalLen)
    glb.putInt(paddedLen)
    glb.putInt(0x4E4F534A)
    glb.put(jsonBytes)
    while (glb.position() < totalLen) glb.put(0x20.toByte())
    glb.rewind()
    return glb
  }

  private companion object {
    val IDENTITY = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = 1f; it[15] = 1f }

    const val SCENE =
      """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],
      "nodes":[{"name":"Box","mesh":0,"translation":[0,0,-2],"extras":{"xr":{"handles":{"rotateAxis":"y","minScale":0.5,"maxScale":3}}}}],
      "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
      "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.5,0,-0.5],"max":[0.5,1,0.5]}]}"""
  }
}
