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
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * JVM tests for the renderer-agnostic pieces: [OrbitCameraState] (web `ThreeView` camera parity),
 * [GltfSceneIndex] (hierarchy / entity matching) and [ThreeLiveRuntimeBinding] with a fake renderer.
 */
class ThreeLiveRendererTest {

  // ---- OrbitCameraState -------------------------------------------------------------------------

  @Test
  fun orbitStringsParseLikeTheWebElement() {
    assertEquals(30.0, OrbitCameraState.parseAngleDeg("30deg")!!, 1e-9)
    assertEquals(30.0, OrbitCameraState.parseAngleDeg("30")!!, 1e-9)
    assertEquals(180.0, OrbitCameraState.parseAngleDeg("${Math.PI}rad")!!, 1e-9)
    assertNull(OrbitCameraState.parseAngleDeg("auto"))
    assertNull(OrbitCameraState.parseAngleDeg("abc"))
    assertEquals(2.5, OrbitCameraState.parseMeters("2.5m")!!, 1e-9)
    assertArrayEquals(doubleArrayOf(1.0, 2.0, 3.0), OrbitCameraState.parseCameraTarget("1m 2m 3")!!, 1e-9)
    assertNull(OrbitCameraState.parseCameraTarget("1 2"))
    val lim = OrbitCameraState.parseOrbitLimit("auto 10deg 2m")
    assertNull(lim[0])
    assertEquals(10.0, lim[1]!!, 1e-9)
    assertEquals(2.0, lim[2]!!, 1e-9)
    assertEquals(Math.PI / 6, OrbitCameraState.parseRotationPerSecond(null), 1e-12)
    assertEquals(Math.toRadians(30.0), OrbitCameraState.parseRotationPerSecond("30deg"), 1e-12)
    assertEquals(0.5, OrbitCameraState.parseRotationPerSecond("0.5rad"), 1e-12)
    assertEquals(Math.PI / 5, OrbitCameraState.parseRotationPerSecond("10%"), 1e-12)
  }

  @Test
  fun cameraOrbitFramesSceneAndEyeUsesElevation() {
    val cam = OrbitCameraState()
    cam.applyOptions(ThreeLiveCameraOptions(cameraOrbit = "90deg 0deg 4m"))
    cam.setBounds(doubleArrayOf(0.0, 1.0, 0.0), 1.0)
    val eye = cam.eye()
    // θ = 90° puts the eye on +X at elevation 0, 4 m from the bounds center.
    assertEquals(4.0, eye[0], 1e-9)
    assertEquals(1.0, eye[1], 1e-9)
    assertEquals(0.0, eye[2], 1e-9)
    val change = cam.pollChange()!!
    assertEquals(90, change.theta)
    assertEquals(0, change.phi)
    assertEquals(4.0, change.distance, 1e-9)
    assertEquals(0.63, change.zoom, 1e-9)
    assertEquals("90deg 0deg 4.0m", change.orbit)
  }

  @Test
  fun defaultDistanceIsTwoAndAHalfRadiiAndLimitsClamp() {
    val cam = OrbitCameraState()
    cam.setBounds(doubleArrayOf(0.0, 0.0, 0.0), 2.0)
    assertEquals(5.0, cam.distance, 1e-9)
    // Elevation is capped at ±0.48π, distance at 0.5r..8r by default.
    cam.drag(0.0, 1e6, 0)
    cam.pinch(1e6, 0)
    repeat(600) { cam.step(1.0 / 60, 0) }
    assertEquals(Math.PI * 0.48, cam.phi, 1e-6)
    assertEquals(1.0, cam.distance, 1e-6)

    cam.applyOptions(ThreeLiveCameraOptions(minCameraOrbit = "-10deg -5deg 3m", maxCameraOrbit = "10deg 5deg 4m"))
    cam.drag(-1e6, -1e6, 0)
    repeat(600) { cam.step(1.0 / 60, 0) }
    assertEquals(Math.toRadians(10.0), cam.theta, 1e-6)
    assertEquals(Math.toRadians(-5.0), cam.phi, 1e-6)
    assertEquals(3.0, cam.distance, 1e-6)
  }

  @Test
  fun dragUsesWebSensitivityAndEasesFrameRateIndependently() {
    val a = OrbitCameraState()
    val b = OrbitCameraState()
    for (c in listOf(a, b)) {
      c.setBounds(doubleArrayOf(0.0, 0.0, 0.0), 1.0)
      c.drag(-100.0, 0.0, 0)
    }
    val start = 0.6
    // 60 Hz vs 120 Hz for 0.5 s converge to the same value.
    repeat(30) { a.step(1.0 / 60, 0) }
    repeat(60) { b.step(1.0 / 120, 0) }
    assertEquals(a.theta, b.theta, 1e-9)
    repeat(600) { a.step(1.0 / 60, 0) }
    assertEquals(start + 0.8, a.theta, 1e-6)
  }

  @Test
  fun cameraChangeReportsOnlyWholeDegreeMoves() {
    val cam = OrbitCameraState()
    cam.setBounds(doubleArrayOf(0.0, 0.0, 0.0), 1.0)
    assertNotNull(cam.pollChange())
    assertNull(cam.step(1.0 / 60, 0))
    cam.drag(-0.1, 0.0, 0) // 0.0008 rad: 34.38° -> 34.42°, still 34°
    repeat(120) { assertNull(cam.step(1.0 / 60, 0)) }
    cam.drag(-10.0, 0.0, 0) // 0.08 rad ≈ 4.6°
    var reported = 0
    repeat(120) { if (cam.step(1.0 / 60, 0) != null) reported++ }
    assertTrue(reported in 1..5)
  }

  @Test
  fun autoRotateSpinsTurntableAfterDelayAndInteractionPausesIt() {
    val cam = OrbitCameraState()
    cam.applyOptions(ThreeLiveCameraOptions(autoRotate = true, autoRotateDelayMs = 1000, rotationPerSecond = "90deg"))
    cam.setBounds(doubleArrayOf(1.0, 0.0, 0.0), 1.0)
    cam.touch(0)
    cam.step(0.25, 500)
    assertEquals(0.0, cam.turntableRad, 1e-12)
    cam.step(0.25, 1000)
    assertEquals(Math.PI / 8, cam.turntableRad, 1e-9)
    cam.step(0.25, 1100, pointerDown = true)
    assertEquals(Math.PI / 8, cam.turntableRad, 1e-9)
    // The turntable pivots around the bounds center, which stays fixed.
    val m = cam.turntableMatrix()
    val x = m[0] * 1f + m[12]
    val z = m[2] * 1f + m[14]
    assertEquals(1f, x, 1e-6f)
    assertEquals(0f, z, 1e-6f)
  }

  @Test
  fun controlsDisabledIgnoresInputAndBadValuesAreIgnored() {
    val cam = OrbitCameraState()
    cam.applyOptions(ThreeLiveCameraOptions(cameraControls = false, fieldOfView = "200deg"))
    assertEquals(90.0, cam.fieldOfViewDeg, 1e-9)
    cam.setBounds(doubleArrayOf(Double.NaN, 0.0, 0.0), Double.NaN)
    val before = cam.theta
    cam.drag(500.0, 0.0, 0)
    cam.interactive = true
    cam.drag(Double.NaN, 0.0, 0)
    cam.pinch(-1.0, 0)
    repeat(10) { cam.step(Double.POSITIVE_INFINITY, 0) }
    assertEquals(before, cam.theta, 1e-12)
    assertEquals(1.0, cam.boundsRadius, 1e-12)
    assertTrue(cam.eye().all { it.isFinite() })
  }

  @Test
  fun viewportRayCenterHitsTargetAndCornersSpreadByFov() {
    val cam = OrbitCameraState()
    cam.applyOptions(ThreeLiveCameraOptions(cameraOrbit = "0deg 0deg 5m", fieldOfView = "90deg"))
    cam.setBounds(doubleArrayOf(0.0, 0.0, 0.0), 1.0)
    val o = DoubleArray(3)
    val d = DoubleArray(3)
    cam.viewportRay(0.0, 0.0, 2.0, o, d)
    assertArrayEquals(doubleArrayOf(0.0, 0.0, 5.0), o, 1e-9)
    assertArrayEquals(doubleArrayOf(0.0, 0.0, -1.0), d, 1e-9)
    // Top edge of a 90° vertical FOV is 45° up; right edge at aspect 2 is atan(2) to the right.
    cam.viewportRay(0.0, 1.0, 2.0, o, d)
    assertEquals(Math.sqrt(0.5), d[1], 1e-9)
    cam.viewportRay(1.0, 0.0, 2.0, o, d)
    assertEquals(2.0 / Math.sqrt(5.0), d[0], 1e-9)
  }

  // ---- GltfSceneIndex ---------------------------------------------------------------------------

  @Test
  fun sceneIndexReadsHierarchyMeshesAndMaterials() {
    val idx = GltfSceneIndex(HIERARCHY)
    assertEquals(4, idx.nodeCount)
    assertArrayEquals(intArrayOf(0, 3), idx.sceneRoots)
    assertArrayEquals(intArrayOf(1, 2), idx.children[0])
    assertEquals(0, idx.parents[2])
    assertEquals("BoxMesh", idx.meshNameOfNode(1))
    assertNull(idx.meshNameOfNode(0))
    assertArrayEquals(intArrayOf(1, -1), idx.materialsOfNode(2))
    assertArrayEquals(intArrayOf(0, 1, 2), idx.subtree(0))
    assertEquals(listOf("Spin"), idx.animationNames)
  }

  @Test
  fun sceneIndexDropsCyclesDuplicateParentsAndBadIndices() {
    val idx =
      GltfSceneIndex(
        """{"nodes":[{"children":[1,1,0,9,-1,1.5]},{"children":[0,2]},{"children":[1]},{"mesh":7}]}"""
      )
    assertArrayEquals(intArrayOf(1), idx.children[0])
    assertArrayEquals(intArrayOf(2), idx.children[1])
    assertArrayEquals(intArrayOf(), idx.children[2])
    assertEquals(-1, idx.nodeMesh[3])
    assertArrayEquals(intArrayOf(0, 3), idx.sceneRoots)
    assertEquals(0, GltfSceneIndex("not json").nodeCount)
  }

  @Test
  fun matchEntitiesPairsByPositionOrFallsBackToNames() {
    val idx = GltfSceneIndex(HIERARCHY)
    // Entities: 100 (Group) -> [101 (Box), 102 (Ball)], 103 (Light).
    val kids = mapOf(100 to intArrayOf(101, 102), 101 to intArrayOf(), 102 to intArrayOf(), 103 to intArrayOf())
    val names = mapOf(100 to "Group", 101 to "Box", 102 to "Ball", 103 to "Light")
    val direct = idx.matchEntities(intArrayOf(100, 103), { kids.getValue(it) }, { names[it] })
    assertArrayEquals(intArrayOf(100, 101, 102, 103), direct)

    // A renderer that reorders siblings and drops the light still maps by name.
    val reordered = mapOf(100 to intArrayOf(102, 101), 101 to intArrayOf(), 102 to intArrayOf())
    val byName = idx.matchEntities(intArrayOf(100), { reordered[it] ?: intArrayOf() }, { names[it] })
    assertArrayEquals(intArrayOf(100, 101, 102, 0), byName)
  }

  // ---- ThreeLiveRuntimeBinding ------------------------------------------------------------------

  @Test
  fun tapTogglesGroupVisibilityAndPropagatesToDescendants() {
    val r = FakeRenderer()
    val clicks = ArrayList<String>()
    val b = ThreeLiveRuntimeBinding(r, glbOf(HIERARCHY))
    b.callbacks =
      object : ThreeLiveRuntimeBinding.Callbacks {
        override fun onMeshClick(nodeIndex: Int, nodeName: String?, meshName: String?, point: FloatArray?) {
          clicks.add("$nodeIndex:$nodeName:$meshName")
        }
      }
    assertSame(r.listener, r.listener) // binding installed itself
    r.listener!!.onPick(ThreeLivePick(1, floatArrayOf(0f, 1f, 0f)))
    assertEquals(listOf("1:Box:BoxMesh"), clicks)
    // Selecting the Box (a child of Group) fires Group's onSelect toggle.
    assertEquals(false, r.visible[0])
    assertEquals(false, r.visible[1])
    assertEquals(false, r.visible[2])
    assertNull(r.visible[3])
    r.listener!!.onPick(ThreeLivePick(0, null))
    assertEquals(true, r.visible[2])
    // Out-of-range picks are ignored.
    r.listener!!.onPick(ThreeLivePick(42, null))
    assertEquals(2, clicks.size)
  }

  @Test
  fun framesStepTweensAndAnimationsReachRenderer() {
    val r = FakeRenderer()
    val events = ArrayList<String>()
    val b = ThreeLiveRuntimeBinding(r, glbOf(HIERARCHY))
    b.callbacks =
      object : ThreeLiveRuntimeBinding.Callbacks {
        override fun onInteractivityEvent(eventId: String, payloadJson: String) {
          events.add(eventId)
        }
      }
    // event/onStart started animation 0.
    assertEquals(listOf(0), r.animations)
    b.sendEvent("raise")
    val cam = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = 1f; it[15] = 1f }
    repeat(4) { r.listener!!.onFrame(0.25, cam) }
    assertArrayEquals(floatArrayOf(0f, 2f, 0f), r.transforms[3]!!, 1e-5f)
    assertEquals(listOf("raised"), events)
    var frames = 0
    b.frameHandler = { _, _ -> frames++ }
    r.listener!!.onFrame(0.016, cam)
    assertEquals(1, frames)
    b.dispose()
    assertNull(r.listener)
    r.visible.clear()
    b.sendEvent("raise")
    assertTrue(r.visible.isEmpty())
  }

  @Test
  fun initialAuthoredVisibilityIsApplied() {
    val r = FakeRenderer()
    val binding =
      ThreeLiveRuntimeBinding(
        r,
        glbOf(
          """{"nodes":[{"name":"P","children":[1],"extensions":{"KHR_node_visibility":{"visible":false}}},{"name":"C"}],
            "scenes":[{"nodes":[0]}]}"""
        ),
      )
    assertEquals(false, r.visible[0])
    assertEquals(false, r.visible[1])
    binding.dispose()
  }

  @Test
  fun pointerCaptureIsDelegated() {
    val r = FakeRenderer()
    val b = ThreeLiveRuntimeBinding(r, glbOf(HIERARCHY))
    val p = ThreeLivePointer(doubleArrayOf(0.0, 0.0, 5.0), doubleArrayOf(0.0, 0.0, -1.0), null)
    assertFalse(r.listener!!.onPointerDown(p))
    var moved = 0
    b.pointerHandler =
      object : ThreeLiveRendererListener {
        override fun onPointerDown(pointer: ThreeLivePointer): Boolean = true

        override fun onPointerMove(pointer: ThreeLivePointer) {
          moved++
        }
      }
    assertTrue(r.listener!!.onPointerDown(p))
    r.listener!!.onPointerMove(p)
    assertEquals(1, moved)
  }

  private class FakeRenderer : ThreeLiveSceneRenderer {
    override var listener: ThreeLiveRendererListener? = null
    val visible = HashMap<Int, Boolean>()
    val transforms = HashMap<Int, FloatArray>()
    val animations = ArrayList<Int>()

    override fun load(glb: ByteBuffer) {}

    override fun setCameraOptions(options: ThreeLiveCameraOptions) {}

    override fun setNodeTransform(nodeIndex: Int, translation: FloatArray, rotation: FloatArray, scale: FloatArray) {
      transforms[nodeIndex] = translation.copyOf()
    }

    override fun setNodeVisible(nodeIndex: Int, visible: Boolean) {
      this.visible[nodeIndex] = visible
    }

    override fun setMaterialFactors(
      materialIndex: Int,
      baseColorFactor: FloatArray,
      emissiveFactor: FloatArray,
      metallicFactor: Float,
      roughnessFactor: Float,
    ) {}

    override fun playAnimation(animationIndex: Int) {
      animations.add(animationIndex)
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
    /**
     * Group (0) -> Box (1, mesh 0) + Ball (2, mesh 1), Light (3). Selecting the group (or a child)
     * toggles the group's visibility; `event/onStart` starts animation 0; event "raise" moves the
     * light up over 1 s and sends "raised".
     */
    const val HIERARCHY =
      """{"asset":{"version":"2.0"},"scene":0,"scenes":[{"nodes":[0,3]}],
      "nodes":[{"name":"Group","children":[1,2]},{"name":"Box","mesh":0},{"name":"Ball","mesh":1},{"name":"Light"}],
      "meshes":[{"name":"BoxMesh","primitives":[{"material":0}]},{"name":"BallMesh","primitives":[{"material":1},{}]}],
      "materials":[{},{}],"animations":[{"name":"Spin"}],
      "extensionsUsed":["KHR_interactivity"],
      "extensions":{"KHR_interactivity":{"graphs":[{
        "variables":[{"id":"vis","type":"bool","value":true}],
        "events":[{"id":"raise"},{"id":"raised"}],
        "nodes":[
          {"op":"pointer/onSelect","configuration":{"nodeIndex":0},"flows":{"out":{"node":3}}},
          {"op":"variable/get","configuration":{"variable":0}},
          {"op":"math/not","values":{"a":{"node":1,"socket":"value"}}},
          {"op":"variable/set","configuration":{"variable":0},"values":{"value":{"node":2,"socket":"value"}},"flows":{"out":{"node":4}}},
          {"op":"pointer/set","configuration":{"pointer":"/nodes/0/extensions/KHR_node_visibility/visible"},"values":{"value":{"node":1,"socket":"value"}}},
          {"op":"event/onStart","flows":{"out":{"node":6}}},
          {"op":"animation/start","configuration":{"animation":0}},
          {"op":"event/receive","configuration":{"event":0},"flows":{"out":{"node":8}}},
          {"op":"pointer/interpolate","configuration":{"pointer":"/nodes/3/translation"},"values":{"value":{"value":[0,2,0]},"duration":{"value":1}},"flows":{"out":{"node":9}}},
          {"op":"event/send","configuration":{"event":1}}
        ]}]}}}"""
  }
}
