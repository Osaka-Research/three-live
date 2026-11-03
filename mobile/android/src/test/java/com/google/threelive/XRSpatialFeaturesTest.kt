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
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Native spatial features (handles, paint, particles) against a recording fake renderer. */
class XRSpatialFeaturesTest {

  @Test
  fun meshBoundsComeFromPositionAccessors() {
    val idx = GltfSceneIndex(SCENE)
    assertArrayEquals(doubleArrayOf(-0.5, 0.0, -0.5, 0.5, 1.0, 0.5), idx.meshBounds[0], 1e-12)
  }

  @Test
  fun cornerDragScalesWithinTraitLimitsAndReportsChange() {
    val r = FakeRenderer()
    val b = ThreeLiveRuntimeBinding(r, glbOf(SCENE))
    val f = XRSpatialFeatures(b, r)
    val changes = ArrayList<Triple<String, Double, Double>>()
    f.listener =
      object : XRSpatialFeatures.Listener {
        override fun onHandlesChange(mesh: String, scale: Double, yawDeg: Double) {
          changes.add(Triple(mesh, scale, yawDeg))
        }
      }
    assertEquals(1, f.handleCount)
    assertEquals(5, r.meshes.size)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    // Corner layout of the box (world = node translation (0, 0, -2)).
    val world = DoubleArray(16).also { assertTrue(b.session.nodeWorldMatrix(0, it)) }
    val layout =
      ManipulationHandles.computeLayout(
        doubleArrayOf(-0.5, 0.0, -0.5),
        doubleArrayOf(0.5, 1.0, 0.5),
        world,
      )
    val corner = layout.corners[0]
    val origin = doubleArrayOf(0.0, 0.5, 2.0)
    val toCorner =
      doubleArrayOf(corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2])
    assertTrue(
      r.listener!!.onPointerDown(ThreeLivePointer(origin, toCorner, ThreeLivePick(0, null)))
    )
    // Drag far outward: scale clamps to the trait max (3).
    val far =
      doubleArrayOf(corner[0] * 50 - origin[0], corner[1] * 50 - origin[1], corner[2] - origin[2])
    r.listener!!.onPointerMove(ThreeLivePointer(origin, far, null))
    r.listener!!.onPointerUp(ThreeLivePointer(origin, far, null))
    assertEquals(1, changes.size)
    assertEquals("Box", changes[0].first)
    assertTrue(changes[0].second > 1.0 && changes[0].second <= 3.0 + 1e-9)
    assertEquals(changes[0].second.toFloat(), r.transforms[0]!![1][0], 1e-5f)
    // A pointer that misses every handle is not captured (paint disabled by default).
    assertFalse(
      r.listener!!.onPointerDown(ThreeLivePointer(origin, doubleArrayOf(0.0, 1.0, 0.0), null))
    )
    f.dispose()
    assertTrue(r.meshes.isEmpty())
  }

  @Test
  fun turntableRootRotatesHandleLayoutAndDragStillScales() {
    val r = FakeRenderer()
    val b = ThreeLiveRuntimeBinding(r, glbOf(SCENE))
    val f = XRSpatialFeatures(b, r)
    // 90° about +Y: the box at (0, 0, -2) moves to (-2, 0, 0).
    r.root = floatArrayOf(0f, 0f, -1f, 0f, 0f, 1f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 0f, 0f, 1f)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    val world = DoubleArray(16).also { assertTrue(b.session.nodeWorldMatrix(0, it)) }
    assertEquals(-2.0, world[12], 1e-9)
    assertEquals(0.0, world[14], 1e-9)
    val layout =
      ManipulationHandles.computeLayout(
        doubleArrayOf(-0.5, 0.0, -0.5),
        doubleArrayOf(0.5, 1.0, 0.5),
        world,
      )
    val corner = layout.corners[0]
    assertTrue(corner[0] < -1.0)
    val origin = doubleArrayOf(0.0, 0.5, 0.0)
    val toCorner =
      doubleArrayOf(corner[0] - origin[0], corner[1] - origin[1], corner[2] - origin[2])
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
        glbOf(
          """{"nodes":[{"name":"Hud","extras":{"xr":{"follow":{"mode":"head","lazy":true,"distance":1.0}}}}],"scenes":[{"nodes":[0]}]}"""
        ),
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
    val b =
      ThreeLiveRuntimeBinding(r, glbOf("""{"nodes":[{"name":"A"}],"scenes":[{"nodes":[0]}]}"""))
    val f = XRSpatialFeatures(b, r)
    f.paintColor = floatArrayOf(1f, 0f, 0f, 1f)
    var summary: Triple<Int, Int, Double>? = null
    f.listener =
      object : XRSpatialFeatures.Listener {
        override fun onPaintStroke(index: Int, points: Int, lengthMeters: Double) {
          summary = Triple(index, points, lengthMeters)
        }
      }
    val origin = doubleArrayOf(0.0, 0.0, 0.0)
    assertFalse(
      r.listener!!.onPointerDown(
        ThreeLivePointer(origin, doubleArrayOf(0.0, 0.0, -1.0), ThreeLivePick(0, null))
      )
    )
    assertTrue(
      r.listener!!.onPointerDown(ThreeLivePointer(origin, doubleArrayOf(0.0, 0.0, -1.0), null))
    )
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
        glbOf(
          """{"nodes":[{"name":"Snow","translation":[0,1,0],"extras":{"xr":{"particles":{"preset":"snow","count":10}}}}],"scenes":[{"nodes":[0]}]}"""
        ),
      )
    val f = XRSpatialFeatures(b, r)
    assertEquals(1, f.emitterCount)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    val mesh = r.meshes.values.single()
    assertEquals(10 * 4 * 3, mesh.positions.size)
    assertEquals(10 * 6, mesh.indices.size)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    assertEquals(1, r.meshes.size)
    val (quad, _) = XRSpatialFeatures.particleQuads(floatArrayOf(0f, 0f, 0f), 1, IDENTITY, 2.0)
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
      XRSpatialFeatures(
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
      XRSpatialFeatures(
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
      XRSpatialFeatures(
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
    // Static vertices are in local space (-1 and -3); sorted indices draw splat 1 (vertices 4..7)
    // first.
    assertEquals(-1f, gpuMesh.positions[2], 1e-4f)
    assertEquals(-3f, gpuMesh.positions[14], 1e-4f)
    assertArrayEquals(intArrayOf(4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3), gpuMesh.indices)
    // Move camera behind splats (+Z looking toward +Z) so splat 0 (-1) is farther than splat 1
    // (-3).
    val flippedCam =
      IDENTITY.copyOf().also {
        it[8] = 0f
        it[9] = 0f
        it[10] = -1f
        it[14] = -10f
      }
    r.listener!!.onFrame(0.1, flippedCam)
    assertEquals(1, r.indexOnlyUpdates)
    assertArrayEquals(intArrayOf(0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7), gpuMesh.indices)
    gpuFeatures.dispose()
  }

  @Test
  fun spatialMeasureFormatsDimensionsBuildsCalloutsAndRunsTapeMeasure() {
    assertEquals("64.0 cm", SpatialMeasure.formatDimension(0.64, "auto"))
    assertEquals("1.25 m", SpatialMeasure.formatDimension(1.25, "auto"))
    assertEquals("123 mm", SpatialMeasure.formatDimension(0.1234, "mm"))
    assertEquals("10.0 in", SpatialMeasure.formatDimension(0.254, "in"))
    assertEquals("2' 0.0\"", SpatialMeasure.formatDimension(0.0254 * 24.0, "ft-in"))
    assertEquals("0.0 cm", SpatialMeasure.formatDimension(Double.NaN, "cm"))

    val r = FakeRenderer()
    val glb =
      glbOf(
        """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],
          "nodes":[{"name":"Chair","mesh":0,"extras":{"xr":{"dimensions":{"unit":"cm","axes":["x","y"],"showOnSelect":true}}}}],
          "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
          "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.3,0,-0.3],"max":[0.3,0.9,0.3]}]}"""
      )
    val b = ThreeLiveRuntimeBinding(r, glb)
    val f = XRSpatialFeatures(b, r)
    assertEquals(1, f.dimensionCount)
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    assertTrue("showOnSelect hides dynamic meshes until selected", r.meshes.isEmpty())
    f.selectedNodeIndex = 0
    r.listener!!.onFrame(1.0 / 60, IDENTITY)
    // 1 batched bar mesh + 2 axis labels (x, y).
    assertEquals(3, r.meshes.size)

    var completed: String? = null
    f.tapeMeasureEnabled = true
    f.measureUnit = "cm"
    f.listener =
      object : XRSpatialFeatures.Listener {
        override fun onMeasureComplete(
          start: DoubleArray,
          end: DoubleArray,
          distanceMeters: Double,
          formatted: String,
        ) {
          completed = formatted
        }
      }
    f.beginTape(doubleArrayOf(0.0, 0.0, 0.0))
    f.updateTape(doubleArrayOf(0.5, 0.0, 0.0))
    f.endTape()
    assertEquals("50.0 cm", completed)
    f.clearMeasurements()
    assertEquals(3, r.meshes.size)
    f.dispose()
    assertTrue(r.meshes.isEmpty())
  }

  @Test
  fun magneticSnapQuantizesGridAnglesAndHysteresisSockets() {
    val gp =
      MagneticSnap.quantizeGridPosition(doubleArrayOf(0.13, -0.08, 0.26), listOf(0.1, 0.05, 0.25))
    assertArrayEquals(doubleArrayOf(0.1, -0.1, 0.25), gp, 1e-6)

    val q38 = XRSpatialMath.quatFromYaw(Math.toRadians(38.0))
    val q45 = MagneticSnap.quantizeQuaternionAngle(q38, 45.0)
    val e = MagneticSnap.eulerYXZFromQuat(q45)
    assertEquals(45.0, Math.toDegrees(e[1]), 0.05)

    val r = FakeRenderer()
    val glb =
      glbOf(
        """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0,1]}],
          "nodes":[
            {"name":"Peg","mesh":0,"translation":[0,0.5,-1],"extras":{"xr":{"grab":"1-hand","snapTo":{"socketTag":"dock","radius":0.2}}}},
            {"name":"Dock","translation":[1,0.5,-1],"extras":{"xr":{"snapSocket":{"tag":"dock","radius":0.2,"highlightColor":"#22c55e"}}}}
          ],
          "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
          "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.1,-0.1,-0.1],"max":[0.1,0.1,0.1]}]}"""
      )
    val b = ThreeLiveRuntimeBinding(r, glb)
    val f = XRSpatialFeatures(b, r)
    assertEquals(1, f.snapSocketCount)
    val events = ArrayList<String>()
    f.listener =
      object : XRSpatialFeatures.Listener {
        override fun onSnap(
          nodeIndex: Int,
          socketNodeIndex: Int?,
          position: DoubleArray,
          quaternion: DoubleArray,
          mode: String,
        ) {
          events.add("snap:$nodeIndex:$socketNodeIndex:$mode")
        }

        override fun onUnsnap(nodeIndex: Int, socketNodeIndex: Int?) {
          events.add("unsnap:$nodeIndex:$socketNodeIndex")
        }
      }

    // 1.5x preview zone (distance 0.26 <= 0.30, > 0.20): preview ring created, no snap yet.
    val preview =
      f.applyMagneticSnap(0, doubleArrayOf(1.26, 0.5, -1.0), doubleArrayOf(0.0, 0.0, 0.0, 1.0))!!
    assertEquals(null, preview.matchedSocketId)
    assertEquals("socket#1", preview.previewSocketId)
    assertEquals(1, r.meshes.size)

    // Within 0.20 capture radius -> snaps to Dock (node 1).
    val snapped =
      f.applyMagneticSnap(0, doubleArrayOf(1.15, 0.5, -1.0), doubleArrayOf(0.0, 0.0, 0.0, 1.0))!!
    assertEquals("socket", snapped.mode)
    assertEquals("socket#1", snapped.matchedSocketId)
    assertArrayEquals(floatArrayOf(1f, 0.5f, -1f), b.session.nodeTransform(0)!!.translation, 1e-5f)

    // 1.25x hysteresis (distance 0.24 <= 0.25) -> stays snapped without duplicate event.
    val held =
      f.applyMagneticSnap(0, doubleArrayOf(1.24, 0.5, -1.0), doubleArrayOf(0.0, 0.0, 0.0, 1.0))!!
    assertEquals("socket#1", held.matchedSocketId)

    // Beyond 1.25x hysteresis (distance 0.28 > 0.25) -> breaks away and emits unsnap.
    val broken =
      f.applyMagneticSnap(0, doubleArrayOf(1.28, 0.5, -1.0), doubleArrayOf(0.0, 0.0, 0.0, 1.0))!!
    assertEquals(null, broken.matchedSocketId)
    assertEquals(listOf("snap:0:1:socket", "unsnap:0:1"), events)
    f.dispose()
  }

  @Test
  fun gazeDwellAndExplodedViewBehaveIdenticallyToWeb() {
    assertEquals(0.0, GazeDwell.computeDwellProgress(140.0, 1000.0, 150.0), 1e-6)
    assertEquals(0.5, GazeDwell.computeDwellProgress(575.0, 1000.0, 150.0), 1e-6)
    assertEquals(1.0, GazeDwell.computeDwellProgress(1200.0, 1000.0, 150.0), 1e-6)

    val r = FakeRenderer()
    val glb =
      glbOf(
        """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0,1]}],
          "nodes":[
            {"name":"LeftBtn","mesh":0,"translation":[-0.4,1.6,-1.5],"extras":{"xr":{"gaze":{"dwellMs":400,"action":"select"},"explode":{"layer":1,"distance":0.5}}}},
            {"name":"RightCore","mesh":0,"translation":[0.4,1.6,-1.5],"extras":{"xr":{"explode":{"layer":2,"distance":0.5}}}}
          ],
          "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
          "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.15,-0.15,-0.15],"max":[0.15,0.15,0.15]}]}"""
      )
    val b = ThreeLiveRuntimeBinding(r, glb)
    val f = XRSpatialFeatures(b, r)
    val events = ArrayList<String>()
    f.listener =
      object : XRSpatialFeatures.Listener {
        override fun onGazeEnter(nodeIndex: Int, point: DoubleArray, normal: DoubleArray) {
          events.add("enter:$nodeIndex")
        }

        override fun onGazeLeave(nodeIndex: Int) {
          events.add("leave:$nodeIndex")
        }

        override fun onGazeDwell(nodeIndex: Int, action: String, point: DoubleArray) {
          events.add("dwell:$nodeIndex:$action")
        }

        override fun onExplodeChange(factor: Double, source: String) {
          events.add("explode:$factor:$source")
        }
      }

    // Aim head/eye ray at LeftBtn (-0.4, 1.6, -1.5) from (0, 1.6, 0).
    val aim = doubleArrayOf(-0.4, 0.0, -1.5)
    for (i in 0 until 6) {
      f.stepGazeDwell(doubleArrayOf(0.0, 1.6, 0.0), aim, 0.1)
    }
    assertTrue(events.contains("enter:0"))
    assertTrue(events.contains("dwell:0:select"))
    // Look away -> emits leave:0.
    for (i in 0 until 6) {
      f.stepGazeDwell(doubleArrayOf(0.0, 1.6, 0.0), doubleArrayOf(0.0, 0.0, 1.0), 0.05)
    }
    assertTrue(events.contains("leave:0"))

    // Exploded view: layer 1 peels ahead of layer 2, reaching exploded positions and restoring rest
    // at 0.
    assertTrue(
      ExplodedView.computeLayerFactor(0.4, 1, 2) > ExplodedView.computeLayerFactor(0.4, 2, 2)
    )
    val sec = ExplodedView.parseSectionPlane("-z:0.2")
    assertTrue(sec.enabled)
    assertEquals(-0.2, sec.constant, 1e-6)

    f.sectionPlaneSpec = "interactive"
    f.setExplode(1.0, "slider")
    for (i in 0 until 60) {
      r.listener!!.onFrame(1.0 / 60, IDENTITY)
    }
    assertTrue(b.session.nodeTransform(0)!!.translation[0] < -0.9f)
    assertTrue(b.session.nodeTransform(1)!!.translation[0] > 0.9f)
    assertTrue(events.contains("explode:1.0:slider"))

    f.setExplode(0.0, "api")
    for (i in 0 until 80) {
      r.listener!!.onFrame(1.0 / 60, IDENTITY)
    }
    assertEquals(-0.4f, b.session.nodeTransform(0)!!.translation[0], 1e-3f)
    assertEquals(0.4f, b.session.nodeTransform(1)!!.translation[0], 1e-3f)
    f.dispose()
    assertTrue(r.meshes.isEmpty())
  }

  @Test
  fun persistentAnchorsAndSpatialLocomotion() {
    val sceneJson =
      """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0,1,2]}],
      "nodes":[
        {"name":"Lamp","mesh":0,"translation":[0,0,-2],"extras":{"xr":{"grab":true,"anchor":{"target":"floor","id":"desk-lamp","persist":true}}}},
        {"name":"Platform","mesh":1,"translation":[0,0.25,-2.5],"scale":[3,0.5,3],"extras":{"xr":{"navigable":true}}},
        {"name":"Lava","mesh":1,"translation":[3,0.25,-2.5],"scale":[2,0.5,2],"extras":{"xr":{"navigable":"blocked"}}}
      ],
      "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]},{"primitives":[{"attributes":{"POSITION":0}}]}],
      "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.5,-0.5,-0.5],"max":[0.5,0.5,0.5]}]}"""

    val store = HashMap<String, String>()
    val r1 = FakeRenderer()
    val b1 = ThreeLiveRuntimeBinding(r1, glbOf(sceneJson))
    val f1 = XRSpatialFeatures(b1, r1)
    f1.persistentAnchorsNamespace = "studio-a"
    f1.anchorStoreGet = { store[it] }
    f1.anchorStoreSet = { k, v -> if (v == null) store.remove(k) else store[k] = v }

    // Legacy string anchor remains intact alongside object anchorPersist + navigable.
    val parsedTraits = XRLiveSceneCoreHelper.extractNodeTraits(glbOf(sceneJson))
    val lampTraits = parsedTraits.first { it.nodeIndex == 0 }
    assertEquals("floor", lampTraits.anchor)
    assertEquals("desk-lamp", lampTraits.anchorPersist?.id)
    assertEquals("walkable", parsedTraits.first { it.nodeIndex == 1 }.navigable)
    assertEquals("blocked", parsedTraits.first { it.nodeIndex == 2 }.navigable)
    assertNull(XRLiveSceneCoreHelper.safeAnchorId("__proto__"))
    assertNull(
      PersistentAnchors.sanitizePose(
        doubleArrayOf(Double.NaN, 0.0, 0.0),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        doubleArrayOf(1.0, 1.0, 1.0),
      )
    )

    b1.session.setNodeTransform(
      0,
      floatArrayOf(1.25f, 0.8f, -1.5f),
      floatArrayOf(0f, 0f, 0f, 1f),
      floatArrayOf(1.3f, 1.3f, 1.3f),
    )
    assertEquals(1, f1.savePersistedAnchors())
    val hashToken = f1.exportAnchorState()
    assertTrue(hashToken.isNotEmpty())
    f1.dispose()

    // Fresh session restores from storage and from #xr-state= URL hash.
    val r2 = FakeRenderer()
    val b2 = ThreeLiveRuntimeBinding(r2, glbOf(sceneJson))
    val f2 = XRSpatialFeatures(b2, r2)
    val events = ArrayList<String>()
    f2.listener =
      object : XRSpatialFeatures.Listener {
        override fun onAnchorsRestored(count: Int, source: String) {
          events.add("restored:$count:$source")
        }

        override fun onTeleport(from: DoubleArray, to: DoubleArray, yawDeg: Double) {
          events.add("teleport:${Math.round(to[1] * 100) / 100.0}:$yawDeg")
        }
      }
    f2.persistentAnchorsNamespace = "studio-a"
    f2.anchorStoreGet = { store[it] }
    f2.anchorStoreSet = { k, v -> if (v == null) store.remove(k) else store[k] = v }
    assertEquals(1, f2.restorePersistedAnchors())
    assertEquals(1.25f, b2.session.nodeTransform(0)!!.translation[0], 1e-3f)
    assertEquals(1.3f, b2.session.nodeTransform(0)!!.scale[0], 1e-3f)
    assertTrue(events.contains("restored:1:storage"))

    b2.session.setNodeTransform(0, floatArrayOf(0f, 0f, 0f), null, null)
    assertEquals(1, f2.restorePersistedAnchors("#tab=xr&xr-state=$hashToken"))
    assertEquals(1.25f, b2.session.nodeTransform(0)!!.translation[0], 1e-3f)
    assertTrue(events.contains("restored:1:url-hash"))

    // Spatial locomotion: walkable platform landing, blocked surface rejection, snap-turn
    // hysteresis.
    f2.locomotionEnabled = true
    val validArc = f2.aimTeleport(doubleArrayOf(0.0, 1.6, 0.0), doubleArrayOf(0.0, -0.25, -1.0))
    assertTrue(validArc.valid)
    assertEquals(1, validArc.hitNodeIndex)
    assertEquals(0.5, validArc.point[1], 0.05)
    assertTrue(f2.commitTeleport())
    assertEquals(0.5, f2.rigOffset[1], 0.05)
    assertTrue(f2.comfortVignetteIntensity > 0.9)
    assertTrue(events.contains("teleport:0.5:0.0"))

    val blockedArc = f2.aimTeleport(doubleArrayOf(3.0, 1.6, 0.0), doubleArrayOf(0.0, -0.35, -1.0))
    assertTrue(!blockedArc.valid)
    assertTrue(!f2.commitTeleport())

    assertEquals(-30.0, f2.applySnapTurnAxis(0.8), 1e-5)
    assertEquals(0.0, f2.applySnapTurnAxis(0.5), 1e-5)
    assertEquals(0.0, f2.applySnapTurnAxis(0.1), 1e-5)
    assertEquals(30.0, f2.applySnapTurnAxis(-0.8), 1e-5)

    repeat(2) { r2.listener!!.onFrame(0.08, IDENTITY) }
    assertEquals(0.0, f2.comfortVignetteIntensity, 1e-5)

    f2.clearPersistedAnchors()
    assertTrue(store.isEmpty())
    f2.dispose()
    assertTrue(r2.meshes.isEmpty())
  }

  @Test
  fun sharedRoomSyncsPeersSoftLocksExplodeAndPaint() {
    assertTrue(SharedRoom.isAllowedRoomUrl("wss://relay.example.com/room/1"))
    assertTrue(SharedRoom.isAllowedRoomUrl("ws://localhost:8787/room"))
    assertTrue(SharedRoom.isAllowedRoomUrl("ws://127.0.0.1:8787/room"))
    assertTrue(!SharedRoom.isAllowedRoomUrl("ws://evil.example.com/room"))
    assertTrue(!SharedRoom.isAllowedRoomUrl("http://localhost:8787/room"))
    assertNull(SharedRoom.parseMessage("{\"v\":1,\"type\":\"leave\",\"peerId\":\"__proto__\"}"))

    val sceneJson =
      """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],
      "nodes":[
        {"name":"Chassis","mesh":0,"translation":[0,0.4,-1],"extras":{"xr":{
          "grab":true,"sync":true,"anchor":{"id":"chassis","persist":true},
          "explode":{"layer":1,"direction":[0,1,0],"distance":0.4}
        }}}
      ],
      "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
      "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.2,-0.1,-0.2],"max":[0.2,0.1,0.2]}]}"""

    val rA = FakeRenderer()
    val bA = ThreeLiveRuntimeBinding(rA, glbOf(sceneJson))
    val fA =
      XRSpatialFeatures(bA, rA).apply {
        localPeerId = "peer-alice"
        peerName = "Alice"
        peerColor = "#38bdf8"
      }

    val rB = FakeRenderer()
    val bB = ThreeLiveRuntimeBinding(rB, glbOf(sceneJson))
    val eventsB = ArrayList<String>()
    val fB =
      XRSpatialFeatures(bB, rB).apply {
        localPeerId = "peer-bob"
        peerName = "Bob"
        peerColor = "#f472b6"
        listener =
          object : XRSpatialFeatures.Listener {
            override fun onPeerJoin(peerId: String, name: String, color: String) {
              eventsB += "join:$peerId:$name:$color"
            }

            override fun onPeerLeave(peerId: String, name: String, color: String) {
              eventsB += "leave:$peerId:$name"
            }

            override fun onPeerSync(peerId: String, nodeId: String) {
              eventsB += "sync:$peerId:$nodeId"
            }
          }
      }

    // Wire in-memory relay hub between A and B.
    fA.roomSend = { raw -> fB.handleRoomMessage(raw, atMs = 1000L) }
    fB.roomSend = { raw -> fA.handleRoomMessage(raw, atMs = 1000L) }

    assertTrue(
      fA.broadcastPoseTick(
        headPos = doubleArrayOf(0.2, 1.6, 0.5),
        headQuat = doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        rayOrigin = doubleArrayOf(0.2, 1.4, 0.4),
        rayEnd = doubleArrayOf(0.0, 0.4, -1.0),
        hasHit = true,
        atMs = 1000L,
      )
    )
    assertTrue(
      !fA.broadcastPoseTick(
        doubleArrayOf(0.2, 1.6, 0.5),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        atMs = 1020L,
      )
    )
    assertEquals(1, fB.peerCount)
    assertTrue(eventsB.contains("join:peer-alice:Alice:#38bdf8"))
    assertEquals(2, rB.meshes.size) // visor + laser

    // Soft-lock ownership: Alice grabs node 0 -> Bob rejected until lease expires.
    bA.session.setNodeTransform(
      0,
      floatArrayOf(0.65f, 0.8f, -1.2f),
      floatArrayOf(0f, 0f, 0f, 1f),
      floatArrayOf(1f, 1f, 1f),
    )
    assertTrue(fA.broadcastNodeDelta(0, "grab", atMs = 1000L))
    assertEquals(0.65f, bB.session.nodeTransform(0)!!.translation[0], 1e-3f)
    assertEquals("peer-alice", fB.getNodeOwner("chassis", atMs = 1500L))
    assertTrue(!fB.broadcastNodeDelta(0, "move", atMs = 1500L))
    assertTrue(fB.broadcastNodeDelta(0, "grab", atMs = 1000L + SharedRoom.SOFT_LOCK_TTL_MS))

    // Explode + 3D paint stroke sync.
    assertTrue(fA.broadcastExplode(0.75))
    repeat(30) { rB.listener!!.onFrame(1.0 / 30.0, IDENTITY) }
    assertEquals(0.75, fB.explodeFactor, 1e-3)
    assertTrue(eventsB.contains("sync:peer-alice:__explode__"))
    val meshesBeforePaint = rB.meshes.size

    assertTrue(
      fA.broadcastPaintStroke(
        "s1",
        listOf(
          doubleArrayOf(0.0, 1.0, -0.5),
          doubleArrayOf(0.1, 1.05, -0.5),
          doubleArrayOf(0.2, 1.1, -0.5),
        ),
        "#22c55e",
        0.01,
      )
    )
    assertTrue(eventsB.contains("sync:peer-alice:paint:s1"))
    assertEquals(meshesBeforePaint + 1, rB.meshes.size) // +1 remote tube stroke

    // Dispose A sends `leave` to B, cleaning up Alice's visor & laser on B!
    fA.dispose()
    assertEquals(0, fB.peerCount)
    assertTrue(eventsB.contains("leave:peer-alice:Alice"))
    fB.dispose()
    assertTrue(rB.meshes.isEmpty())
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

    override fun setNodeTransform(
      nodeIndex: Int,
      translation: FloatArray,
      rotation: FloatArray,
      scale: FloatArray,
    ) {
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

    override fun addDynamicMesh(
      positions: FloatArray,
      normals: FloatArray?,
      indices: IntArray,
      color: FloatArray,
    ): Int {
      val id = next++
      meshes[id] = Mesh(positions, indices)
      return id
    }

    override fun updateDynamicMesh(
      meshId: Int,
      positions: FloatArray,
      normals: FloatArray?,
      indices: IntArray,
    ) {
      meshes[meshId]?.let {
        it.positions = positions
        it.indices = indices
      }
    }

    override fun removeDynamicMesh(meshId: Int) {
      meshes.remove(meshId)
      splatMeshes.remove(meshId)
    }

    override fun addSplatMesh(
      positions: FloatArray,
      uvs: FloatArray,
      colors: ByteArray,
      indices: IntArray,
    ): Int {
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
    val IDENTITY =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[15] = 1f
      }

    const val SCENE =
      """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],
      "nodes":[{"name":"Box","mesh":0,"translation":[0,0,-2],"extras":{"xr":{"handles":{"rotateAxis":"y","minScale":0.5,"maxScale":3}}}}],
      "meshes":[{"primitives":[{"attributes":{"POSITION":0}}]}],
      "accessors":[{"componentType":5126,"count":8,"type":"VEC3","min":[-0.5,0,-0.5],"max":[0.5,1,0.5]}]}"""
  }
}
