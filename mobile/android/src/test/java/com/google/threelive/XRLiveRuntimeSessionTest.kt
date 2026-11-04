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

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPOutputStream
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * Host-side JVM tests for the pure-Kotlin spatial runtime: [MiniJson], canonical trait parsing, the
 * `KHR_interactivity` VM in [XRLiveRuntimeSession], and the math / geometry / decoder helpers.
 *
 * Numeric expectations mirror `xr-live/tests/xr_plugins_test.ts` so web and Android stay in parity.
 */
class XRLiveRuntimeSessionTest {

  // =============================================================================================
  // MiniJson
  // =============================================================================================

  @Test
  fun miniJsonParsesEscapesNumbersAndNesting() {
    val v =
      MiniJson.parse(
        """ {"s":"q\"b\\s\/b\bf\fn\nr\rt\t\u00e9\uD83D\uDE00","n":[-1.5e3,0,2.25E-1,10],"o":{"t":true,"f":false,"z":null}} """
      )
    val m = MiniJson.asMap(v)!!
    assertEquals("q\"b\\s/b\bf\u000Cn\nr\rt\té\uD83D\uDE00", m["s"])
    assertEquals(listOf(-1500.0, 0.0, 0.225, 10.0), m["n"])
    val o = MiniJson.asMap(m["o"])!!
    assertEquals(true, o["t"])
    assertEquals(false, o["f"])
    assertTrue(o.containsKey("z"))
    assertNull(o["z"])
    assertEquals(emptyMap<String, Any?>(), MiniJson.parse("{}"))
    assertEquals(emptyList<Any?>(), MiniJson.parse(" [ ] "))
  }

  @Test
  fun miniJsonEnforcesDepthAndSizeLimits() {
    val ok = "[".repeat(64) + "]".repeat(64)
    assertNotNull(MiniJson.parse(ok))
    val deep = "[".repeat(65) + "]".repeat(65)
    try {
      MiniJson.parse(deep)
      fail("expected depth limit")
    } catch (expected: MiniJson.ParseException) {
      assertTrue(expected.message!!.contains("depth"))
    }
    assertNull(MiniJson.parseOrNull("[1,2,3]", maxChars = 4))
    // Very deep input must fail cleanly rather than overflow the stack.
    assertNull(MiniJson.parseOrNull("[".repeat(100_000)))
  }

  @Test
  fun miniJsonRejectsMalformedInput() {
    val bad =
      listOf(
        "",
        "{",
        "[1,]",
        "{\"a\":1,}",
        "01",
        "1.",
        ".5",
        "-",
        "1e",
        "tru",
        "nul",
        "1 2",
        "{\"a\" 1}",
        "{a:1}",
        "'x'",
        "\"unterminated",
        "\"bad \\x escape\"",
        "\"bad \\u12G4\"",
        "\"trunc \\u12\"",
        "\"ctrl \u0001\"",
        "[1 2]",
        "NaN",
        "Infinity",
      )
    for (b in bad) {
      try {
        MiniJson.parse(b)
        fail("expected failure for <$b>")
      } catch (expected: MiniJson.ParseException) {
        // ok
      }
    }
  }

  @Test
  fun miniJsonStringifyRoundTrips() {
    val src =
      mapOf(
        "id" to "a\"b\n",
        "n" to 1.0,
        "f" to 0.5,
        "v" to doubleArrayOf(1.0, 2.5),
        "b" to true,
        "z" to null,
      )
    val json = MiniJson.stringify(src)
    assertEquals("""{"id":"a\"b\n","n":1,"f":0.5,"v":[1,2.5],"b":true,"z":null}""", json)
    val back = MiniJson.asMap(MiniJson.parse(json))!!
    assertEquals("a\"b\n", back["id"])
    assertEquals(listOf(1.0, 2.5), back["v"])
    assertEquals("null", MiniJson.stringify(Double.NaN))
  }

  // =============================================================================================
  // Canonical trait parsing
  // =============================================================================================

  @Test
  fun parsesCanonicalTraitsFromCompiledGltf() {
    val traits = XRLiveSceneCoreHelper.parseNodeTraitsFromGltfJson(CANONICAL_GLTF)
    val byName = traits.associateBy { it.name }
    assertEquals(setOf("Hud", "Moon", "Snow"), byName.keys)

    val hud = byName.getValue("Hud")
    assertEquals(4, hud.nodeIndex)
    assertTrue(hud.grabbable)
    assertEquals("2-hand", hud.grabMode)
    assertEquals("head", hud.follow)
    assertTrue(hud.followLazy)
    assertEquals(1.2, hud.followDistance, 1e-9)
    assertEquals(20.0, hud.followDeadzoneDeg, 1e-9)
    assertEquals(6.0, hud.followStiffness, 1e-9)
    assertEquals(-0.1, hud.followHeight, 1e-9)
    assertEquals("What lamp is this?", hud.holdToAsk?.prompt)
    assertEquals(600.0, hud.holdToAsk!!.holdMs, 1e-9)
    assertFalse(hud.scalable)
    assertEquals(0.05, hud.minScale, 1e-9)
    assertEquals(5.0, hud.maxScale, 1e-9)
    // Regression: `interactable.mode` / `follow` must not be mistaken for a billboard mode.
    assertNull(hud.billboard)
    assertNotNull(hud.lazyFollow)

    val moon = byName.getValue("Moon")
    assertEquals("head", moon.follow)
    assertFalse(moon.followLazy)
    assertNull(moon.lazyFollow)
    val orbit = moon.orbit!!
    assertEquals("Lamp", orbit.targetName)
    assertEquals(0.4, orbit.radius, 1e-9)
    assertEquals(0.6, orbit.speed, 1e-9)
    assertEquals(XRHandlesTrait("y", 0.5, 3.0), moon.handles)
    assertEquals(XRSpatialAudioTrait("hum.mp3", 1.0, true), moon.audio)
    assertEquals("room.spz", moon.splatUrl)
    assertEquals("info-card", moon.spatialSlot)
    assertFalse(moon.grabbable)
    assertNull(moon.billboard)

    val snow = byName.getValue("Snow")
    assertEquals("snow", snow.particles?.preset)
    assertEquals(2000, snow.particles?.count)
    assertEquals(listOf(2.0, 2.0, 2.0), snow.particles?.area)
    assertEquals(
      XRWorldUnderstandingTrait(planes = true, meshes = false, reticle = true, objects = false),
      snow.worldUnderstanding,
    )
    assertTrue(snow.scalable)
    assertEquals(0.5, snow.minScale, 1e-9)
    assertEquals(3.0, snow.maxScale, 1e-9)
    assertEquals("capsule", snow.billboard)
    assertEquals("floor", snow.anchor)
    assertEquals("static", snow.physics)
  }

  @Test
  fun applierHooksFireForEachTrait() {
    val calls = ArrayList<String>()
    val applier =
      object : SceneCoreComponentApplier<String> {
        override fun onAttachMovable(entity: String, node: XRLiveNodeTraits) {
          calls.add("movable:${node.name}")
        }

        override fun onAttachBillboard(entity: String, node: XRLiveNodeTraits) {
          calls.add("billboard:${node.name}")
        }

        override fun onAttachAnchor(entity: String, node: XRLiveNodeTraits) {
          calls.add("anchor:${node.name}")
        }

        override fun onAttachPhysics(entity: String, node: XRLiveNodeTraits) {
          calls.add("physics:${node.name}")
        }

        override fun onAttachResizable(entity: String, node: XRLiveNodeTraits) {
          calls.add("resizable:${node.name}")
        }

        override fun onAttachFollow(entity: String, node: XRLiveNodeTraits) {
          calls.add("follow:${node.name}")
        }

        override fun onAttachOrbit(entity: String, node: XRLiveNodeTraits) {
          calls.add("orbit:${node.name}")
        }

        override fun onAttachParticles(entity: String, node: XRLiveNodeTraits) {
          calls.add("particles:${node.name}")
        }

        override fun onAttachHoldToAsk(entity: String, node: XRLiveNodeTraits) {
          calls.add("holdToAsk:${node.name}")
        }

        override fun onAttachSplat(entity: String, node: XRLiveNodeTraits) {
          calls.add("splat:${node.name}")
        }

        override fun onAttachSpatialPanel(entity: String, node: XRLiveNodeTraits) {
          calls.add("panel:${node.name}")
        }

        override fun onAttachSpatialAudio(entity: String, node: XRLiveNodeTraits) {
          calls.add("audio:${node.name}")
        }
      }
    XRLiveSceneCoreHelper.applyTraitsFromGlb(glbOf(CANONICAL_GLTF), "root", applier)
    assertEquals(
      listOf(
        "movable:Hud",
        "follow:Hud",
        "holdToAsk:Hud",
        "resizable:Moon",
        "follow:Moon",
        "orbit:Moon",
        "splat:Moon",
        "panel:Moon",
        "audio:Moon",
        "anchor:Snow",
        "billboard:Snow",
        "physics:Snow",
        "particles:Snow",
      ),
      calls,
    )
  }

  @Test
  fun traitNormalizationClampsAndSanitizes() {
    val lazy =
      XRLiveSceneCoreHelper.parseLazyFollow(
        mapOf("distance" to 99.0, "deadzoneDeg" to -5.0, "stiffness" to "x")
      )!!
    assertEquals(10.0, lazy.distance, 0.0)
    assertEquals(0.0, lazy.deadzoneDeg, 0.0)
    assertEquals(6.0, lazy.stiffness, 0.0)
    val hand = XRLiveSceneCoreHelper.parseLazyFollow(mapOf("mode" to "hand-left"))!!
    assertEquals(0.15, hand.distance, 0.0)
    assertEquals(0.12, hand.height, 0.0)
    assertNull(XRLiveSceneCoreHelper.parseLazyFollow("head"))

    val json =
      """{"nodes":[
        {"name":"A","extras":{"xr":{"follow":{"mode":"hand-right","lazy":false}}}},
        {"name":"B","extras":{"xr":{"particles":{"preset":"bogus","count":1e9,"area":999},"handles":{"minScale":5,"maxScale":1}}}},
        {"name":"C","extras":{"xr":{"splatUrl":"javascript:alert(1)","audio":"//evil.com/a.mp3","scale":false,"scalable":true}}},
        {"name":"D","extras":{"xr":{"holdToAsk":{"holdMs":1},"orbit":{"target":"${"x".repeat(300)}"}}}}
      ]}"""
    val t = XRLiveSceneCoreHelper.parseNodeTraitsFromGltfJson(json)
    assertEquals("hand-right", t[0].follow)
    assertFalse(t[0].followLazy)
    assertEquals("rain", t[1].particles!!.preset)
    assertEquals(2000, t[1].particles!!.count)
    assertEquals(50.0, t[1].particles!!.area[0], 0.0)
    assertTrue(t[1].handles!!.maxScale >= t[1].handles!!.minScale)
    assertNull(t[2].splatUrl)
    assertNull(t[2].audio)
    assertFalse(t[2].scalable)
    assertEquals(100.0, t[3].holdToAsk!!.holdMs, 0.0)
    assertEquals("What is this?", t[3].holdToAsk!!.prompt)
    assertNull(t[3].orbit!!.targetName)

    assertEquals(
      "https://cdn.test/a.spz",
      XRLiveSceneCoreHelper.safeMediaUrl("https://cdn.test/a.spz"),
    )
    assertEquals("scans/room.spz", XRLiveSceneCoreHelper.safeMediaUrl(" scans/room.spz "))
    for (bad in
      listOf(
        "http://x.com/a",
        "//evil/a",
        "../a.spz",
        "a/../b",
        "a%2e.spz",
        "a\\b",
        "data:x",
        "https:///x",
        "",
      )) {
      assertNull(bad, XRLiveSceneCoreHelper.safeMediaUrl(bad))
    }
  }

  @Test
  fun malformedJsonFallsBackToLegacyScanner() {
    val truncated = """{"nodes":[{"name":"A","extras":{"xr":{"grabbable":true}}}]"""
    val t = XRLiveSceneCoreHelper.parseNodeTraitsFromGltfJson(truncated)
    assertEquals(1, t.size)
    assertEquals("A", t[0].name)
    assertTrue(t[0].grabbable)
  }

  @Test
  fun extractsInteractivityGraph() {
    val json = XRLiveSceneCoreHelper.extractInteractivityGraphJson(glbOf(CANONICAL_GLTF))!!
    val ext = MiniJson.asMap(MiniJson.parse(json))!!
    val graph = MiniJson.asMap(MiniJson.asList(ext["graphs"])!![0])!!
    assertEquals(27, MiniJson.asList(graph["nodes"])!!.size)
    assertNull(XRLiveSceneCoreHelper.extractInteractivityGraphJsonFromGltf("""{"nodes":[]}"""))
  }

  // =============================================================================================
  // KHR_interactivity VM
  // =============================================================================================

  @Test
  fun grabGuardsRefuseNewGrabsButNotReleases() {
    val (s, _) = session()
    var allow = false
    s.grabGuards.add { allow }
    assertFalse(s.setNodeGrabbed(2, true))
    assertFalse(s.isNodeGrabbed(2))
    allow = true
    assertTrue(s.setNodeGrabbed(2, true))
    allow = false
    assertTrue("releases are never refused", s.setNodeGrabbed(2, false))
    assertFalse(s.isNodeGrabbed(2))
  }

  @Test
  fun sharedRoomSimultaneousGrabTieBreakMatchesWeb() {
    val lease = SharedRoom.NodeSoftLock("peer-z", leaseUntilMs = 2100L, acquiredMs = 100L)
    assertTrue(SharedRoom.winsGrabConflict(lease, "peer-a", "grab", 300L))
    assertFalse(SharedRoom.winsGrabConflict(lease, "peer-a", "move", 300L))
    assertFalse(
      SharedRoom.winsGrabConflict(lease.copy(ownerPeerId = "peer-a"), "peer-z", "grab", 300L)
    )
    assertFalse(
      "outside the conflict window the holder keeps the node",
      SharedRoom.winsGrabConflict(lease.copy(leaseUntilMs = 2900L), "peer-a", "grab", 900L),
    )
  }

  private class Recorder : XRLiveRuntimeSession.Listener {
    val transforms = ArrayList<Pair<Int, List<Float>>>()
    val visibility = ArrayList<Pair<Int, Boolean>>()
    val materials = ArrayList<Pair<Int, List<Float>>>()
    val events = ArrayList<Pair<String, String>>()
    val animations = ArrayList<String>()

    override fun onNodeTransformChanged(
      nodeIndex: Int,
      translation: FloatArray,
      rotation: FloatArray,
      scale: FloatArray,
    ) {
      transforms.add(nodeIndex to (translation.toList() + rotation.toList() + scale.toList()))
    }

    override fun onVisibilityChanged(nodeIndex: Int, visible: Boolean) {
      visibility.add(nodeIndex to visible)
    }

    override fun onMaterialChanged(
      materialIndex: Int,
      baseColorFactor: FloatArray,
      emissiveFactor: FloatArray,
      metallicFactor: Float,
      roughnessFactor: Float,
    ) {
      materials.add(materialIndex to (baseColorFactor.toList() + emissiveFactor.toList()))
    }

    override fun onInteractivityEvent(eventId: String, payloadJson: String) {
      events.add(eventId to payloadJson)
    }

    override fun onAnimation(start: Boolean, animationIndex: Int, animationName: String?) {
      animations.add("$start:$animationIndex:$animationName")
    }
  }

  private fun session(json: String = CANONICAL_GLTF): Pair<XRLiveRuntimeSession, Recorder> {
    val s = XRLiveRuntimeSession(json)
    val r = Recorder()
    s.listener = r
    return s to r
  }

  @Test
  fun honorsInitialNodeTrsAndMaterials() {
    val (s, _) = session()
    assertTrue(s.interactivityEnabled)
    assertNull(s.interactivityError)
    assertArrayEquals(floatArrayOf(0f, 1f, -2f), s.nodeTransform(0)!!.translation, 0f)
    assertArrayEquals(floatArrayOf(0f, 0f, 0f, 1f), s.nodeTransform(0)!!.rotation, 0f)
    assertArrayEquals(floatArrayOf(0.5f, 0.5f, 0.5f, 1f), s.materialColor(1), 0f)
    assertEquals(0f, s.materialMetallic(1), 0f)
    assertNull(s.nodeTransform(99))
    assertNull(s.materialColor(-1))
  }

  @Test
  fun onStartRunsOnce() {
    val (s, r) = session()
    s.start()
    assertArrayEquals(floatArrayOf(0f, 3f, 0f), s.nodeTransform(3)!!.translation, 0f)
    assertEquals(1, r.transforms.size)
    assertEquals(3, r.transforms[0].first)
    s.setNodeTransform(3, translation = floatArrayOf(9f, 9f, 9f))
    s.start()
    assertArrayEquals(floatArrayOf(9f, 9f, 9f), s.nodeTransform(3)!!.translation, 0f)
  }

  @Test
  fun onSelectTogglesVisibility() {
    val (s, r) = session()
    assertTrue(s.isVisible(0))
    s.dispatchSelect(0)
    assertFalse(s.isVisible(0))
    assertEquals(listOf(0 to false), r.visibility)
    assertEquals(false, s.readPointer("/nodes/0/extensions/KHR_node_visibility/visible"))
    s.dispatchSelect(0)
    assertTrue(s.isVisible(0))
    assertEquals(listOf(0 to false, 0 to true), r.visibility)
    // Unrelated nodes do not trigger it.
    s.dispatchSelect(4)
    assertTrue(s.isVisible(0))
  }

  @Test
  fun toggleTransformTweenCompletesAfterDuration() {
    val (s, r) = session()
    val head = XRPose()
    s.dispatchSelect(1)
    assertEquals(1, s.activeTweenCount)
    s.step(0.2, head)
    val mid = s.nodeTransform(1)!!.translation
    assertEquals(1f, mid[0], 1e-6f)
    // Smoothstep easing at t = 0.5 is exactly the midpoint.
    assertEquals(1f, mid[1], 1e-5f)
    s.step(0.25, head)
    assertArrayEquals(floatArrayOf(1f, 2f, 0f), s.nodeTransform(1)!!.translation, 1e-6f)
    assertEquals(0, s.activeTweenCount)
    assertTrue(r.transforms.any { it.first == 1 })
    // Second select tweens back to the authored default.
    s.dispatchSelect(1)
    s.step(0.25, head)
    s.step(0.25, head)
    assertArrayEquals(floatArrayOf(1f, 0f, 0f), s.nodeTransform(1)!!.translation, 1e-6f)
  }

  @Test
  fun cycleMaterialColorAdvancesThroughColors() {
    val (s, r) = session()
    s.dispatchSelect(2)
    assertArrayEquals(floatArrayOf(0f, 1f, 0f, 1f), s.materialColor(1), 0f)
    s.dispatchSelect(2)
    assertArrayEquals(floatArrayOf(0f, 0f, 1f, 1f), s.materialColor(1), 0f)
    s.dispatchSelect(2)
    assertArrayEquals(floatArrayOf(1f, 0f, 0f, 1f), s.materialColor(1), 0f)
    assertEquals(3, r.materials.size)
    assertEquals(1, r.materials[0].first)
    assertEquals(0.0, s.variableValue("__color_idx_2_0"))
  }

  @Test
  fun sendEventReachesReceiveAndListener() {
    val (s, r) = session()
    s.dispatchSelect(3)
    assertEquals(listOf("ring" to """{"volume":0.5}"""), r.events)
    assertArrayEquals(floatArrayOf(2f, 2f, 2f), s.nodeTransform(3)!!.scale, 0f)

    val (s2, r2) = session()
    s2.sendEvent("ring", mapOf("volume" to 1))
    assertArrayEquals(floatArrayOf(2f, 2f, 2f), s2.nodeTransform(3)!!.scale, 0f)
    assertTrue(r2.events.isEmpty())
    s2.sendEvent("unknown")
  }

  @Test
  fun delayFiresAfterDuration() {
    val graph =
      """{"declarations":[{"op":"event/onStart"},{"op":"flow/delay"},{"op":"pointer/set"},{"op":"animation/start"}],
        "nodes":[
          {"declaration":0,"flows":{"out":{"node":1}}},
          {"declaration":1,"values":{"duration":{"value":0.5}},"flows":{"done":{"node":2}}},
          {"declaration":2,"configuration":{"pointer":"/nodes/0/extensions/KHR_node_visibility/visible"},"values":{"value":{"value":false}},"flows":{"out":{"node":3}}},
          {"declaration":3,"configuration":{"animation":0}}
        ]}"""
    val (s, r) = session(gltfWithGraph(graph, extra = ""","animations":[{"name":"Wave"}]"""))
    s.start()
    assertEquals(1, s.activeDelayCount)
    s.step(0.3, XRPose())
    assertTrue(s.isVisible(0))
    s.step(0.3, XRPose())
    assertFalse(s.isVisible(0))
    assertEquals(0, s.activeDelayCount)
    assertEquals(listOf("true:0:Wave"), r.animations)
  }

  @Test
  fun stepBudgetStopsRunawayFlows() {
    // flow/sequence that re-enters itself forever while incrementing a counter.
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1}}},
          {"op":"flow/sequence","flows":{"0":{"node":2},"1":{"node":1}}},
          {"op":"variable/set","configuration":{"variable":0},"values":{"value":{"node":3}}},
          {"op":"math/add","values":{"a":{"node":4},"b":1}},
          {"op":"variable/get","configuration":{"variable":0}}
        ],"variables":[{"id":"count","value":0}]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    val count = s.variableValue("count") as Double
    assertTrue("count=$count", count > 0 && count <= XRLiveRuntimeSession.MAX_STEPS_PER_INVOCATION)
  }

  @Test
  fun forbiddenAndOutOfRangePointersAreRejected() {
    val ptrs =
      listOf(
        "/nodes/0/__proto__",
        "/nodes/constructor/translation",
        "/nodes/0/prototype",
        "/nodes/9/translation",
        "/nodes/-1/translation",
        "/nodes/01x/translation",
        "/nodes/0/translation/extra",
        "/nodes/0/matrix",
        "/nodes//translation",
        "/materials/5/pbrMetallicRoughness/baseColorFactor",
        "/meshes/0/weights",
        "nodes/0/translation",
        "/nodes/0/weights",
      )
    val nodes = ptrs.mapIndexed { i, p ->
      """{"op":"pointer/set","configuration":{"pointer":"$p"},"values":{"value":{"value":[5,5,5,1]}},"flows":{"out":{"node":${i + 1}}}}"""
    }
    val graph =
      """{"nodes":[${nodes.joinToString(",")},{"op":"event/onStart","flows":{"out":{"node":0}}}]}"""
    val (s, r) = session(gltfWithGraph(graph))
    s.start()
    assertTrue(r.transforms.isEmpty())
    assertTrue(r.materials.isEmpty())
    for (p in ptrs) assertNull(p, s.readPointer(p))
    assertNotNull(s.readPointer("/nodes/0/translation"))
    assertNotNull(s.readPointer("/materials/0/emissiveFactor"))
    assertEquals(
      listOf("__proto__x", "a/b", "c~d"),
      XRLiveRuntimeSession.parseSafePointer("/__proto__x/a~1b/c~0d"),
    )
    assertNull(XRLiveRuntimeSession.parseSafePointer("/a/__proto__"))
  }

  @Test
  fun graphSafetyLimitsDisableTheVm() {
    val many =
      (0..XRLiveRuntimeSession.MAX_GRAPH_NODES).joinToString(",") { """{"op":"flow/sequence"}""" }
    val (s, _) = session(gltfWithGraph("""{"nodes":[$many]}"""))
    assertFalse(s.interactivityEnabled)
    assertTrue(s.interactivityError!!.contains("MAX_GRAPH_NODES"))
    s.start()
    s.dispatchSelect(0)
    s.step(0.016, XRPose())

    val vars = (0..XRLiveRuntimeSession.MAX_VARIABLES).joinToString(",") { """{"value":0}""" }
    val (s2, _) = session(gltfWithGraph("""{"nodes":[],"variables":[$vars]}"""))
    assertFalse(s2.interactivityEnabled)
  }

  @Test
  fun malformedGraphNodesNeverThrow() {
    val graph =
      """{"declarations":[{"op":"pointer/onSelect"},7,null],"nodes":[
          null, 3, "x", [],
          {"declaration":99},
          {"declaration":0,"configuration":{"nodeIndex":"abc"},"flows":{"out":{"node":1e30},"bad":"x"}},
          {"op":"pointer/set","configuration":{"pointer":{"value":42}},"values":{"value":{"node":-5}}},
          {"op":"flow/switch","values":{"selection":{"node":6.5}},"flows":{"default":{"node":4}}},
          {"op":"math/div","values":{"a":1,"b":0}},
          {"op":"pointer/interpolate","configuration":{"pointer":"/nodes/{idx}/translation"},"values":{"idx":{"node":8},"value":{"value":[1,1,1]},"duration":{"value":"fast"}}},
          {"op":"pointer/onSelect","flows":{"out":{"node":9}}}
        ],"variables":[null,{"id":"__proto__","value":1}]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    s.dispatchSelect(0)
    s.dispatchSelect(-7)
    s.dispatchHover(0, true)
    s.sendEvent("x", mapOf("__proto__" to 1, "v" to listOf(1, "a")))
    s.step(Double.NaN, XRPose())
    s.step(-1.0, XRPose())
    s.step(1.0, XRPose())
    s.step(1.0, XRPose())
    // math/div by 0 yields 0 -> template resolves to node 0 and the tween runs to completion.
    assertArrayEquals(floatArrayOf(1f, 1f, 1f), s.nodeTransform(0)!!.translation, 1e-6f)
  }

  @Test
  fun selectMatchesAncestorsAndHoverEvents() {
    val graph =
      """{"nodes":[
          {"op":"pointer/onSelect","configuration":{"nodeIndex":0},"flows":{"out":{"node":1}}},
          {"op":"pointer/set","configuration":{"pointer":"/nodes/0/visible"},"values":{"value":{"value":false}}},
          {"op":"pointer/onHoverIn","configuration":{"nodeIndex":2},"flows":{"out":{"node":3}}},
          {"op":"pointer/set","configuration":{"pointer":"/materials/0/emissiveFactor"},"values":{"value":{"value":[1,0.5,-2]}}},
          {"op":"pointer/onHoverOut","configuration":{"nodeIndex":2},"flows":{"out":{"node":5}}},
          {"op":"pointer/set","configuration":{"pointer":"/materials/0/emissiveFactor"},"values":{"value":{"value":[0,0,0]}}}
        ]}"""
    val json =
      """{"nodes":[{"name":"P","children":[1]},{"name":"C"},{"name":"H"}],"materials":[{}],
        "extensions":{"KHR_interactivity":{"graphs":[$graph],"graph":0}}}"""
    val (s, _) = session(json)
    s.dispatchSelect(2)
    assertTrue(s.isVisible(0))
    s.dispatchSelect(1)
    assertFalse(s.isVisible(0))
    assertFalse(s.isEffectivelyVisible(1))
    assertTrue(s.isVisible(1))
    s.dispatchHover(2, true)
    assertArrayEquals(floatArrayOf(1f, 0.5f, 0f), s.materialEmissive(0), 0f)
    s.dispatchHover(2, false)
    assertArrayEquals(floatArrayOf(0f, 0f, 0f), s.materialEmissive(0), 0f)
  }

  @Test
  fun rotationTweensSlerpLinearly() {
    val s45 = Math.sin(Math.PI / 8)
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1}}},
          {"op":"pointer/interpolate","configuration":{"pointer":"/nodes/0/rotation","easing":"linear"},
           "values":{"value":{"value":[0,${Math.sin(Math.PI / 4)},0,${Math.cos(Math.PI / 4)}]},"duration":{"value":1}}}
        ]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    // The VM clamps each tick to 0.25 s, so advance in two steps.
    s.step(0.25, XRPose())
    s.step(0.25, XRPose())
    val q = s.nodeTransform(0)!!.rotation
    assertEquals(s45.toFloat(), q[1], 1e-5f)
    assertEquals(Math.cos(Math.PI / 8).toFloat(), q[3], 1e-5f)
  }

  @Test
  fun fromGlbBuildsSession() {
    val s = XRLiveRuntimeSession.fromGlb(glbOf(CANONICAL_GLTF))
    assertEquals(7, s.nodeCount)
    assertEquals(2, s.materialCount)
    assertEquals(3, s.traits.size)
    try {
      XRLiveRuntimeSession.fromGlb(ByteBuffer.allocate(8))
      fail("expected IllegalArgumentException")
    } catch (expected: IllegalArgumentException) {
      // ok
    }
  }

  // =============================================================================================
  // Lazy follow and orbit
  // =============================================================================================

  @Test
  fun criticallyDampedSpringConvergesWithoutOvershoot() {
    val s = SpringState(doubleArrayOf(1.0, 0.0, 0.0))
    repeat(600) { XRFollowMath.stepCriticallyDampedSpring(s, DoubleArray(3), 6.0, 1.0 / 60) }
    assertTrue(Math.abs(s.position[0]) < 1e-4)
    val s2 = SpringState(doubleArrayOf(1.0, 0.0, 0.0))
    var overshoot = false
    repeat(600) {
      XRFollowMath.stepCriticallyDampedSpring(s2, DoubleArray(3), 10.0, 0.1)
      if (s2.position[0] < -1e-6) overshoot = true
    }
    assertFalse(overshoot)
  }

  @Test
  fun angleFromForward() {
    val head = XRPose.atYaw(0f, 1.6f, 0f)
    assertEquals(0.0, XRFollowMath.angleFromForwardDeg(head, doubleArrayOf(0.0, 1.6, -1.0)), 1e-3)
    assertEquals(90.0, XRFollowMath.angleFromForwardDeg(head, doubleArrayOf(1.0, 1.6, 0.0)), 1e-3)
  }

  @Test
  fun lazyFollowHonorsDeadzoneAndRecenters() {
    val json =
      """{"nodes":[
        {"name":"hud","extras":{"xr":{"follow":{"distance":1,"deadzoneDeg":20,"height":0}}}},
        {"name":"wide","extras":{"xr":{"follow":{"distance":1,"deadzoneDeg":60,"height":0}}}},
        {"name":"g","translation":[5,5,5],"extras":{"xr":{"follow":{}}}}
      ]}"""
    val (s, _) = session(json)
    s.setNodeGrabbed(2, true)
    s.step(1.0 / 60, XRPose.atYaw(0f, 1.6f, 0f))
    var p = s.nodeTransform(0)!!.translation
    assertEquals(-1f, p[2], 1e-3f)
    assertEquals(1.6f, p[1], 1e-3f)
    assertArrayEquals(floatArrayOf(5f, 5f, 5f), s.nodeTransform(2)!!.translation, 0f)

    s.step(1.0 / 60, XRPose.atYaw(0f, 1.6f, 0f, Math.toRadians(10.0)))
    p = s.nodeTransform(0)!!.translation
    assertEquals(-1f, p[2], 1e-3f)
    assertFalse(s.isFollowing(0))

    s.step(1.0 / 60, XRPose.atYaw(0f, 1.6f, 0f, Math.toRadians(45.0)))
    assertFalse(s.isFollowing(1))

    repeat(240) { s.step(1.0 / 60, XRPose.atYaw(0f, 1.6f, 0f, Math.PI / 2)) }
    p = s.nodeTransform(0)!!.translation
    assertEquals(-1f, p[0], 0.02f)
    assertEquals(0f, p[2], 0.02f)
    assertArrayEquals(floatArrayOf(1f, 1f, 1f), s.nodeTransform(0)!!.scale, 1e-6f)
  }

  @Test
  fun orbitPositions() {
    val o = XROrbitTrait(targetPosition = listOf(1.0, 0.0, 0.0), radius = 2.0, speed = Math.PI)
    val p = XRFollowMath.computeOrbitPosition(doubleArrayOf(1.0, 0.0, 0.0), o, 0.5)
    assertEquals(1.0, p[0], 1e-3)
    assertEquals(2.0, p[2], 1e-3)

    val json =
      """{"nodes":[
        {"name":"planet","translation":[3,0,0]},
        {"name":"moon","extras":{"xr":{"orbit":{"target":"planet","radius":1,"speed":0}}}},
        {"name":"self","translation":[7,0,0],"extras":{"xr":{"orbit":{"target":"self"}}}},
        {"name":"child","extras":{"xr":{"orbit":{"target":[0,0,0],"radius":1,"speed":0,"faceCenter":true}}}},
        {"name":"holder","translation":[10,0,0],"children":[3]}
      ]}"""
    val (s, _) = session(json)
    s.step(1.0 / 60, XRPose())
    assertEquals(4f, s.nodeTransform(1)!!.translation[0], 1e-3f)
    assertEquals(7f, s.nodeTransform(2)!!.translation[0], 0f)
    // Child of a translated parent lands at the scene-space orbit position.
    assertEquals(1f, s.nodeWorldPosition(3)!![0], 1e-5f)
    assertEquals(-9f, s.nodeTransform(3)!!.translation[0], 1e-5f)
  }

  @Test
  fun physicsDynamicAndBillboardStep() {
    val json =
      """{"nodes":[
        {"name":"Table","mesh":0,"translation":[0,0.4,0]},
        {"name":"Ball_1","mesh":1,"translation":[0,1.2,0],"extras":{"xr":{"physics":"dynamic","grabbable":true}}},
        {"name":"Sign","translation":[0,1.5,-2],"extras":{"xr":{"billboard":"capsule"}}}
      ],"meshes":[
        {"primitives":[{"attributes":{"POSITION":0}}]},
        {"primitives":[{"attributes":{"POSITION":1}}]}
      ],"accessors":[
        {"min":[-1,-0.05,-1],"max":[1,0.05,1]},
        {"min":[-0.08,-0.08,-0.08],"max":[0.08,0.08,0.08]}
      ]}"""
    val (s, _) = session(json)
    val y0 = s.nodeTransform(1)!!.translation[1]
    repeat(30) { s.step(1.0 / 60, XRPose(floatArrayOf(2f, 1.6f, 0f))) }
    val y1 = s.nodeTransform(1)!!.translation[1]
    assertTrue("expected ball to fall under gravity ($y1 < $y0)", y1 < y0)
    // Let ball settle on top of Table (top Y = 0.45 + radius 0.08 = 0.53)
    repeat(90) { s.step(1.0 / 60, XRPose(floatArrayOf(2f, 1.6f, 0f))) }
    val yRest = s.nodeTransform(1)!!.translation[1]
    assertTrue("expected ball to collide with table ($yRest >= 0.50)", yRest >= 0.50f)
    // Tapping a dynamic physics node imparts an upward impulse
    s.dispatchSelect(1)
    repeat(10) { s.step(1.0 / 60, XRPose(floatArrayOf(2f, 1.6f, 0f))) }
    val yJump = s.nodeTransform(1)!!.translation[1]
    assertTrue("expected tapped ball to jump ($yJump > $yRest)", yJump > yRest)
    // Sign billboards toward head at (2, 1.6, 0) from (0, 1.5, -2) -> positive Y rotation
    val qSign = s.nodeTransform(2)!!.rotation
    assertTrue("expected billboard rotation around Y (${qSign[1]})", qSign[1] > 0.1f)
  }

  // =============================================================================================
  // Manipulation handles
  // =============================================================================================

  @Test
  fun handlesScaleClampAndPedestalYaw() {
    val world = translation(0.0, 0.0, -2.0)
    val min = doubleArrayOf(-0.5, -0.5, -0.5)
    val max = doubleArrayOf(0.5, 0.5, 0.5)
    val layout = ManipulationHandles.computeLayout(min, max, world)
    assertEquals(4, layout.corners.size)
    assertEquals(0.5, layout.corners[2][1], 1e-9)
    val opts = XRHandlesTrait(minScale = 0.5, maxScale = 2.0)
    val hit =
      ManipulationHandles.pick(
        layout,
        doubleArrayOf(0.5, 0.5, 0.0),
        doubleArrayOf(0.0, 0.0, -1.0),
        opts,
      )
    assertTrue(hit is ManipulationHandles.Hit.Corner)
    assertNull(
      ManipulationHandles.pick(
        layout,
        doubleArrayOf(10.0, 10.0, 0.0),
        doubleArrayOf(0.0, 0.0, -1.0),
        opts,
      )
    )

    val drag = ManipulationHandles.Drag(opts)
    val c = layout.corners[2]
    assertNotNull(
      drag.begin(
        layout,
        doubleArrayOf(c[0], c[1], 0.0),
        doubleArrayOf(0.0, 0.0, -1.0),
        doubleArrayOf(1.0, 1.0, 1.0),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
      )
    )
    assertTrue(drag.update(doubleArrayOf(c[0] * 10, c[1] * 10, 0.0), doubleArrayOf(0.0, 0.0, -1.0)))
    assertEquals(2.0, drag.scale[0], 1e-3)
    drag.end()
    assertFalse(drag.active)

    val ped = layout.pedestalStart
    val rot = ManipulationHandles.Drag(XRHandlesTrait())
    val h2 =
      rot.begin(
        layout,
        doubleArrayOf(ped[0] + 0.25, ped[1] + 1, ped[2]),
        doubleArrayOf(0.0, -1.0, 0.0),
        doubleArrayOf(1.0, 1.0, 1.0),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
      )
    assertTrue(h2 is ManipulationHandles.Hit.Rotate)
    rot.update(doubleArrayOf(0.0, ped[1] + 1, -2.0 + 0.5), doubleArrayOf(0.0, -1.0, 0.0))
    val q = rot.rotation
    val yawDeg = Math.toDegrees(XRSpatialMath.yawFromQuat(q[0], q[1], q[2], q[3]))
    assertEquals(90.0, Math.abs(yawDeg), 1.0)
    assertArrayEquals(doubleArrayOf(1.0, 1.0, 1.0), rot.scale, 1e-9)
  }

  // =============================================================================================
  // World understanding
  // =============================================================================================

  @Test
  fun unprojectsDetections() {
    assertEquals(
      0.2,
      WorldUnderstanding.normalizeBox(doubleArrayOf(100.0, 200.0, 300.0, 400.0))!![1],
      1e-12,
    )
    assertEquals(
      0.2,
      WorldUnderstanding.normalizeBox(doubleArrayOf(0.5, 0.1, 0.2, 0.3))!![0],
      1e-12,
    )
    assertNull(WorldUnderstanding.normalizeBox(doubleArrayOf(Double.NaN, 0.0, 1.0, 1.0)))
    assertNull(WorldUnderstanding.normalizeBox(doubleArrayOf(0.0, 0.0, 1.0)))

    val proj = FloatArray(16)
    proj[0] = 1f
    proj[5] = 1f
    proj[10] = -1f
    proj[11] = -1f
    proj[14] = -0.2f
    val cam =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[15] = 1f
        it[13] = 1.6f
      }
    val center =
      WorldUnderstanding.unprojectDetection(
        doubleArrayOf(400.0, 400.0, 600.0, 600.0),
        cam,
        proj,
        2.0,
        label = "cup",
      )!!
    assertEquals(-2.0, center.z, 1e-3)
    assertEquals(1.6, center.y, 1e-3)
    assertEquals(0.0, center.x, 1e-3)
    assertEquals(WorldUnderstanding.DepthSource.DEPTH, center.depthSource)
    assertEquals(0.8, center.widthMeters, 1e-3)
    assertEquals("cup", center.label)

    val floor =
      WorldUnderstanding.TrackedPlane(
        "horizontal",
        doubleArrayOf(0.0, 0.0, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
        10.0,
      )
    val low =
      WorldUnderstanding.unprojectDetection(
        doubleArrayOf(900.0, 450.0, 1000.0, 550.0),
        cam,
        proj,
        null,
        listOf(floor),
      )!!
    assertEquals(WorldUnderstanding.DepthSource.PLANE, low.depthSource)
    assertEquals(0.0, low.y, 0.01)
    val none =
      WorldUnderstanding.unprojectDetection(doubleArrayOf(0.0, 0.0, 1.0, 1.0), cam, proj, 0.01)!!
    assertEquals(WorldUnderstanding.DepthSource.FALLBACK, none.depthSource)
    assertEquals(-1.5, none.z, 1e-3)
    assertNull(
      WorldUnderstanding.hitTestPlanes(
        listOf(floor),
        doubleArrayOf(0.0, 1.0, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
      )
    )

    val tape = WorldUnderstanding.TapeMeasure()
    tape.addPoint(0.0, 0.0, 0.0)
    assertEquals(5.0, tape.addPoint(3.0, 4.0, 0.0), 1e-9)
    assertEquals(0.0, tape.addPoint(Double.NaN, 0.0, 0.0), 0.0)
    assertEquals(2, tape.pointCount)
    assertEquals(5.0, tape.totalMeters, 1e-9)
  }

  // =============================================================================================
  // Spatial paint
  // =============================================================================================

  @Test
  fun tubeStrokeGeometry() {
    val mid =
      TubeStrokeBuilder.catmullRom(
        doubleArrayOf(0.0, 0.0, 0.0),
        doubleArrayOf(1.0, 0.0, 0.0),
        doubleArrayOf(2.0, 0.0, 0.0),
        doubleArrayOf(3.0, 0.0, 0.0),
        0.5,
      )
    assertEquals(1.5, mid[0], 1e-9)
    val b = TubeStrokeBuilder(radius = 0.01, radialSegments = 6, samplesPerSpan = 2)
    assertNull(b.build())
    assertTrue(b.addPoint(0.0, 0.0, 0.0))
    assertFalse(b.addPoint(0.0001, 0.0, 0.0))
    assertFalse(b.addPoint(Double.NaN, 0.0, 0.0))
    assertNull(b.build())
    b.addPoint(0.1, 0.0, 0.0)
    b.addPoint(0.2, 0.1, 0.0)
    val g = b.build()!!
    val n = b.smoothedPoints().size
    assertEquals(5, n)
    assertEquals((n * 6 + 6 * 2 + 2) * 3, g.positions.size)
    assertEquals(g.positions.size, g.normals.size)
    assertEquals(((n - 1) * 6 * 2 + 12) * 3, g.indices.size)
    assertTrue(g.indices.all { it in 0 until g.vertexCount })
    assertEquals(0.01, Math.hypot(g.positions[1].toDouble(), g.positions[2].toDouble()), 1e-6)

    // First side triangle winds counter-clockwise seen from outside.
    val i0 = g.indices[0]
    val i1 = g.indices[1]
    val i2 = g.indices[2]
    fun pt(i: Int) = DoubleArray(3) { g.positions[i * 3 + it].toDouble() }
    val p0 = pt(i0)
    val e1 = pt(i1).mapIndexed { k, v -> v - p0[k] }
    val e2 = pt(i2).mapIndexed { k, v -> v - p0[k] }
    val cross =
      doubleArrayOf(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      )
    val out = DoubleArray(3) { g.normals[i0 * 3 + it].toDouble() }
    assertTrue(cross[0] * out[0] + cross[1] * out[1] + cross[2] * out[2] > 0)

    // End cap uses an axial (tangent) normal.
    val capIdx = g.indices[g.indices.size - 3]
    val sm = b.smoothedPoints()
    val endDir = DoubleArray(3) { sm[sm.size - 1][it] - sm[sm.size - 3][it] }
    val endLen = Math.sqrt(endDir.sumOf { it * it })
    val capDot = (0 until 3).sumOf { g.normals[capIdx * 3 + it] * endDir[it] / endLen }
    assertTrue(capDot > 0.99)

    val rev = TubeStrokeBuilder(radius = 0.01, samplesPerSpan = 1)
    for (p in
      listOf(
        doubleArrayOf(0.0, 0.0, 0.0),
        doubleArrayOf(0.1, 0.0, 0.0),
        doubleArrayOf(0.2, 0.0, 0.0),
        doubleArrayOf(0.1, 0.0001, 0.0),
        doubleArrayOf(0.0, 0.0002, 0.0),
      )) {
      rev.addPoint(p[0], p[1], p[2])
    }
    assertTrue(rev.build()!!.normals.all { it.isFinite() })
  }

  // =============================================================================================
  // Depth particles
  // =============================================================================================

  @Test
  fun mulberry32MatchesWeb() {
    val r = Mulberry32(7)
    assertEquals(0.011704753153026104, r.next(), 0.0)
    assertEquals(0.06195825757458806, r.next(), 0.0)
    assertEquals(0.97690763277933, r.next(), 0.0)
    assertEquals(0.6270739405881613, Mulberry32(1).next(), 0.0)
  }

  @Test
  fun particleSpawnBoundsAndFloorCollision() {
    val parity = ParticleEmitter(XRParticlesTrait("rain", 2, listOf(1.0, 1.0, 1.0), 1.0), 7)
    parity.reset(0.0, 1.0, 0.0)
    assertArrayEquals(
      floatArrayOf(
        -0.4882952570915222f,
        0.5619582533836365f,
        0.4769076406955719f,
        0.19902870059013367f,
        1.0214452743530273f,
        -0.0944783091545105f,
      ),
      parity.positions,
      0f,
    )

    val em = ParticleEmitter(XRParticlesTrait("rain", 50, listOf(1.0, 1.0, 1.0), 1.0), 7)
    em.reset(0.0, 1.0, 0.0)
    for (i in 0 until 50) {
      assertTrue(Math.abs(em.positions[i * 3]) <= 0.5)
      assertTrue(em.positions[i * 3 + 1] in 0.5f..1.5f)
    }
    repeat(120) { em.step(1.0 / 60, 0.0, 1.0, 0.0, 0.0) }
    assertTrue(em.collisions > 0)
    for (i in 0 until 50) assertTrue(em.positions[i * 3 + 1] >= 0.4f)

    for (preset in listOf("snow", "sparks", "confetti")) {
      val e = ParticleEmitter(XRParticlesTrait(preset, 20, listOf(2.0, 2.0, 2.0), 1.0), 3)
      e.reset(0.0, 2.0, 0.0)
      repeat(200) { e.step(1.0 / 60, 0.0, 2.0, 0.0, 0.0) }
      assertTrue(e.positions.all { it.isFinite() })
    }

    val proj =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = -1f
        it[11] = -1f
      }
    val view =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[15] = 1f
      }
    val cam = ParticleDepthCamera(view, proj) { _, _ -> 2.0 }
    assertTrue(ParticleEmitter.isOccludedByDepth(doubleArrayOf(0.0, 0.0, -3.0), cam))
    assertFalse(ParticleEmitter.isOccludedByDepth(doubleArrayOf(0.0, 0.0, -1.0), cam))
    assertFalse(ParticleEmitter.isOccludedByDepth(doubleArrayOf(0.0, 0.0, 1.0), cam))
  }

  // =============================================================================================
  // Gaussian splats
  // =============================================================================================

  @Test
  fun parsesSplatRecords() {
    val buf = ByteBuffer.allocate(64).order(ByteOrder.LITTLE_ENDIAN)
    buf.putFloat(0, 1f)
    buf.putFloat(12, 0.1f)
    putBytes(buf, 24, 255, 0, 0, 200)
    putBytes(buf, 28, 255, 128, 128, 128)
    buf.putFloat(32 + 8, -5f)
    buf.putFloat(32 + 12, Float.NaN)
    putBytes(buf, 60, 128, 128, 128, 128)
    val d = SplatParser.parseSplat(buf.array())
    assertEquals(2, d.count)
    assertEquals(1f, d.positions[0], 0f)
    assertEquals(255, d.colors[0].toInt() and 0xFF)
    assertEquals(1f, d.rotations[3], 1e-3f)
    assertEquals(0f, d.rotations[0], 1e-3f)
    assertEquals(0f, d.scales[3], 0f)
    assertEquals(1f, d.rotations[7], 0f)
    assertThrows { SplatParser.parseSplat(ByteArray(33)) }
  }

  @Test
  fun parsesSpzV2V3AndRejectsMalformed() {
    val spz = ByteBuffer.allocate(16 + 9 + 1 + 3 + 3 + 3).order(ByteOrder.LITTLE_ENDIAN)
    spz.putInt(0, 0x5053474e)
    spz.putInt(4, 2)
    spz.putInt(8, 1)
    spz.put(13, 12.toByte())
    putBytes(spz, 16, 0x00, 0x10, 0x00)
    putBytes(spz, 19, 0x00, 0xf0, 0xff)
    putBytes(spz, 25, 255)
    putBytes(spz, 26, 128, 128, 128)
    putBytes(spz, 29, 160, 160, 160)
    putBytes(spz, 32, 128, 128, 128)
    val bytes = spz.array()
    val sd = SplatParser.parseSpzPayload(bytes)
    assertEquals(1f, sd.positions[0], 1e-3f)
    assertEquals(-1f, sd.positions[1], 1e-3f)
    assertEquals(255, sd.colors[3].toInt() and 0xFF)
    assertEquals(1f, sd.scales[0], 1e-3f)

    // Gzip-compressed payloads decode identically.
    val gz = SplatParser.parseSpz(gzip(bytes))
    assertArrayEquals(sd.positions, gz.positions, 0f)
    assertArrayEquals(sd.rotations, gz.rotations, 0f)
    // Decompression size cap.
    assertThrows { SplatParser.gunzip(gzip(ByteArray(1 shl 16)), maxBytes = 1024) }
    assertThrows { SplatParser.parseSpz(byteArrayOf(0x1f, 0x8b.toByte(), 1, 2, 3)) }

    assertThrows { SplatParser.parseSpzPayload(bytes.copyOf(20)) }
    assertThrows { SplatParser.parseSpzPayload(bytes.copyOf(10)) }
    val badCount =
      bytes.copyOf().also { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putInt(8, -1) }
    assertThrows { SplatParser.parseSpzPayload(badCount) }
    val badMagic = bytes.copyOf().also { it[0] = 0 }
    assertThrows { SplatParser.parseSpzPayload(badMagic) }
    val badVersion = bytes.copyOf().also { it[4] = 4 }
    assertThrows { SplatParser.parseSpzPayload(badVersion) }

    // v3 smallest-three rotation: largest = w (index 3), x = +0.5.
    val v3 = ByteBuffer.allocate(16 + 9 + 1 + 3 + 3 + 4).order(ByteOrder.LITTLE_ENDIAN)
    v3.putInt(0, 0x5053474e)
    v3.putInt(4, 3)
    v3.putInt(8, 1)
    v3.put(13, 12.toByte())
    putBytes(v3, 16 + 9 + 1, 128, 128, 128)
    val mag = Math.round(0.5 / Math.sqrt(0.5) * 511).toInt()
    v3.putInt(16 + 9 + 1 + 3 + 3, (3 shl 30) or (mag shl 20))
    val r3 = SplatParser.parseSpzPayload(v3.array())
    assertEquals(0.5f, r3.rotations[0], 0.01f)
    assertEquals(Math.sqrt(0.75).toFloat(), r3.rotations[3], 0.01f)
    assertTrue(Math.abs((r3.colors[0].toInt() and 0xFF) - 128) <= 2)
    val badBits = v3.array().copyOf().also { it[13] = 31 }
    assertThrows { SplatParser.parseSpzPayload(badBits) }

    // v3 with Spherical Harmonics degree 1 (9 trailing bytes per splat)
    val sh1 = ByteArray(v3.array().size + 9)
    System.arraycopy(v3.array(), 0, sh1, 0, v3.array().size)
    sh1[12] = 1
    for (j in v3.array().size until sh1.size) sh1[j] = 128.toByte()
    sh1[v3.array().size + 3] = 255.toByte() // basis 1 (+Z), R channel
    val sh1Data = SplatParser.parseSpzPayload(sh1)
    assertEquals(1, sh1Data.shDegree)
    assertNotNull(sh1Data.sh)
    assertEquals(9, sh1Data.sh!!.size)
    val rgbPosZ = SplatParser.evaluateSplatSH(sh1Data, 0, 0f, 0f, 1f)
    val rgbNegZ = SplatParser.evaluateSplatSH(sh1Data, 0, 0f, 0f, -1f)
    assertTrue(rgbPosZ[0] > (sh1Data.colors[0].toInt() and 0xFF) + 40)
    assertTrue(rgbNegZ[0] < (sh1Data.colors[0].toInt() and 0xFF) - 40)

    // Anisotropic 3D & 2D covariance projection
    val anisoScales = floatArrayOf(0.4f, 0.05f, 0.05f)
    val s45 = Math.sin(Math.PI / 8.0).toFloat()
    val c45 = Math.cos(Math.PI / 8.0).toFloat()
    val anisoRot = floatArrayOf(0f, 0f, s45, c45)
    val cov3d = SplatParser.computeCovariance3D(anisoScales, anisoRot, 0)
    assertEquals(cov3d[0], cov3d[3], 1e-4f)
    assertTrue(cov3d[1] > 0.05f)
    val mv =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[14] = -2f
        it[15] = 1f
      }
    val proj2d = SplatParser.projectCovariance2D(cov3d, mv, floatArrayOf(0f, 0f, 0f), 500f)
    assertTrue(proj2d[3] > proj2d[4] * 20f)
    val dotAxes = proj2d[5] * proj2d[7] + proj2d[6] * proj2d[8]
    assertEquals(0f, dotAxes, 1e-2f)
  }

  /** 1-splat `.spz` v3 with [shDegree] SH bytes in the shared golden pattern (see web test). */
  private fun spzV3WithSh(shDegree: Int, shBytes: Int? = null): ByteArray {
    val basis = SplatParser.shBasisCountForDegree(shDegree)
    val base = 16 + 9 + 1 + 3 + 3 + 4
    val out = ByteBuffer.allocate(base + (shBytes ?: (basis * 3))).order(ByteOrder.LITTLE_ENDIAN)
    out.putInt(0, 0x5053474e)
    out.putInt(4, 3)
    out.putInt(8, 1)
    out.put(12, shDegree.toByte())
    out.put(13, 12.toByte())
    putBytes(out, 16 + 9, 255)
    putBytes(out, 16 + 9 + 1, 128, 128, 128)
    out.putInt(16 + 9 + 1 + 3 + 3, 3 shl 30)
    val arr = out.array()
    var k = 0
    while (k < basis && base + k * 3 + 2 < arr.size) {
      arr[base + k * 3] = (128 + (if (k % 2 == 0) 4 + k else -(2 + k))).toByte()
      arr[base + k * 3 + 1] = (128 + (k % 3) * 5 - 5).toByte()
      arr[base + k * 3 + 2] = 128.toByte()
      k++
    }
    return arr
  }

  @Test
  fun splatAuditFixes() {
    // SH degree 2 / 3 golden values (reference 3DGS) along (0.48, 0.6, 0.64).
    val g2 =
      SplatParser.evaluateSplatSH(
        SplatParser.parseSpzPayload(spzV3WithSh(2)),
        0,
        0.48f,
        0.6f,
        0.64f,
      )
    val g3 =
      SplatParser.evaluateSplatSH(
        SplatParser.parseSpzPayload(spzV3WithSh(3)),
        0,
        0.48f,
        0.6f,
        0.64f,
      )
    assertArrayEquals(intArrayOf(105, 130, 128), g2)
    assertArrayEquals(intArrayOf(93, 125, 128), g3)
    // Truncated SH block falls back to degree 0.
    val trunc = SplatParser.parseSpzPayload(spzV3WithSh(3, 44))
    assertEquals(0, trunc.shDegree)
    assertNull(trunc.sh)
    // shDegree 4 is rejected.
    assertThrows { SplatParser.parseSpzPayload(spzV3WithSh(1).also { it[12] = 4 }) }
    // v2 rotation decode: (255, 128, 128) -> x ~ 1, w ~ 0.
    val v2 = ByteBuffer.allocate(16 + 9 + 1 + 3 + 3 + 3).order(ByteOrder.LITTLE_ENDIAN)
    v2.putInt(0, 0x5053474e)
    v2.putInt(4, 2)
    v2.putInt(8, 1)
    putBytes(v2, 16 + 9 + 1 + 3 + 3, 255, 128, 128)
    val v2d = SplatParser.parseSpzPayload(v2.array())
    assertEquals(1f, v2d.rotations[0], 0.01f)
    assertEquals(0f, v2d.rotations[3], 0.01f)

    // F10: header flags byte 14 bit 0 = antialiased.
    assertTrue(SplatParser.parseSpzPayload(spzV3WithSh(0).also { it[14] = 1 }).antialiased)
    assertFalse(SplatParser.parseSpzPayload(spzV3WithSh(0)).antialiased)

    // F6: decodeSh = false skips the SH block but still decodes the base attributes.
    val noSh = SplatParser.parseSpzPayload(spzV3WithSh(3), decodeSh = false)
    assertEquals(0, noSh.shDegree)
    assertNull(noSh.sh)
    assertEquals(255, noSh.colors[3].toInt() and 0xFF)

    // F5: GPU billboard bounds each splat isotropically by its largest axis.
    val needle = SplatData(1)
    needle.scales[0] = 0.01f
    needle.scales[1] = 0.01f
    needle.scales[2] = 0.5f
    needle.rotations[3] = 1f
    val gpu = SplatParser.buildStaticGpuSplatVertices(needle)
    assertEquals(1.5f, gpu.uvs[2], 1e-5f)
    assertEquals(1.5f, gpu.uvs[5], 1e-5f)

    // F3: SH view direction is mapped into the splat's local frame.
    val sh1 = spzV3WithSh(1)
    for (j in sh1.size - 9 until sh1.size) sh1[j] = 128.toByte()
    sh1[sh1.size - 9 + 3] = 255.toByte() // basis 1 (local +Z), R channel
    val sh1Data = SplatParser.parseSpzPayload(sh1)
    // Columns (0,0,-1), (0,1,0), (1,0,0): local +Z maps to world +X.
    val yaw90 =
      doubleArrayOf(0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)
    val cam =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[12] = -5f
        it[15] = 1f
      }
    val quads = SplatParser.buildSplatQuads(sh1Data, intArrayOf(0), yaw90, cam)
    assertTrue((quads.colors[0].toInt() and 0xFF) > (sh1Data.colors[0].toInt() and 0xFF) + 40)
  }

  @Test
  fun sharedRoomIceValidation() {
    fun ice(extra: String) =
      SharedRoom.parseMessage(
        """{"v":1,"type":"rtc","peerId":"peer-a","targetPeerId":"peer-b","signalType":"ice","candidate":"candidate:1 1 UDP 1 192.0.2.1 9 typ host"$extra}"""
      )
    assertNull(ice(""))
    assertNull(ice(""","sdpMid":"${"m".repeat(65)}""""))
    val mid64 = ice(""","sdpMid":"${"m".repeat(64)}"""") as? SharedRoom.WireMessage.Rtc
    assertEquals(64, mid64?.sdpMid?.length)
    assertNotNull(ice(""","sdpMLineIndex":0"""))
  }

  @Test
  fun sortsSplatsBackToFront() {
    val persp =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[11] = -1f
      }
    val order =
      SplatParser.sortSplatsByDepth(3, floatArrayOf(0f, 0f, -1f, 0f, 0f, -5f, 0f, 0f, -3f), persp)
    assertArrayEquals(intArrayOf(1, 2, 0), order)

    // URL policy (mirrors web resolveSplatUrl vectors).
    assertNotNull(SplatParser.resolveSplatUrl("https://a.com/x.spz"))
    assertNull(SplatParser.resolveSplatUrl("javascript:alert(1)"))
    assertNull(SplatParser.resolveSplatUrl("data:application/octet-stream;base64,AA"))
    assertNull(SplatParser.resolveSplatUrl("http://evil.com/x.splat"))
    assertEquals(
      "http://localhost:8080/x.spz",
      SplatParser.resolveSplatUrl("http://localhost:8080/x.spz"),
    )
    assertEquals(
      "https://site.test/scans/room.spz",
      SplatParser.resolveSplatUrl("/scans/room.spz", "https://site.test/app/"),
    )
    assertNull(SplatParser.resolveSplatUrl("https://cdn.test/x.spz", "https://site.test/", false))
    assertNotNull(
      SplatParser.resolveSplatUrl("https://site.test/x.spz", "https://site.test/", false)
    )
    assertNull(SplatParser.resolveSplatUrl("//evil.com/x.spz", "https://site.test/", true))

    // Deterministic stride downsampling.
    val ten = SplatData(10)
    for (i in 0 until 10) {
      ten.positions[i * 3] = i.toFloat()
      ten.scales[i * 3] = 0.1f
      ten.colors[i * 4 + 3] = 255.toByte()
    }
    val sampled = SplatParser.downsample(ten, 4)
    val sampledAgain = SplatParser.downsample(ten, 4)
    assertEquals(4, sampled.count)
    assertArrayEquals(sampled.positions, sampledAgain.positions, 0f)
    assertEquals(0f, sampled.positions[0], 0f)
    assertEquals(2f, sampled.positions[3], 0f)
    assertEquals(5f, sampled.positions[6], 0f)
    assertEquals(7f, sampled.positions[9], 0f)

    // Resort threshold (5 cm move or 5° rotation) and billboard quad corners.
    val camId =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = 1f
        it[15] = 1f
      }
    val nodeId =
      DoubleArray(16).also {
        it[0] = 1.0
        it[5] = 1.0
        it[10] = 1.0
        it[15] = 1.0
      }
    assertTrue(SplatParser.shouldResort(null, camId, null, nodeId))
    assertFalse(SplatParser.shouldResort(camId, camId, nodeId, nodeId))
    val camMoved = camId.copyOf().also { it[12] = 0.08f }
    assertTrue(SplatParser.shouldResort(camId, camMoved, nodeId, nodeId))
    val quads = SplatParser.buildSplatQuads(sampled, intArrayOf(0, 1), nodeId, camId)
    assertEquals(2 * 12, quads.positions.size)
    assertEquals(2 * 8, quads.uvs.size)
    assertEquals(2 * 16, quads.colors.size)
    assertEquals(2 * 6, quads.indices.size)
    assertEquals(64 * 64 * 4, SplatParser.gaussianFalloffRgba(64).remaining())
  }

  // =============================================================================================
  // Audit regressions
  // =============================================================================================

  @Test(timeout = 10_000)
  fun customEventFanOutSharesTheSendersBudget() {
    // receive(e) -> sequence{send e, send e}: 2^depth deliveries without a shared budget.
    val graph =
      """{"events":[{"id":"e"}],"nodes":[
          {"op":"event/receive","configuration":{"event":0},"flows":{"out":{"node":1}}},
          {"op":"flow/sequence","flows":{"0":{"node":2},"1":{"node":3}}},
          {"op":"event/send","configuration":{"event":0}},
          {"op":"event/send","configuration":{"event":0}}
        ]}"""
    val (s, r) = session(gltfWithGraph(graph))
    s.sendEvent("e")
    assertTrue(
      "sends=${r.events.size}",
      r.events.size in 1..XRLiveRuntimeSession.MAX_STEPS_PER_INVOCATION,
    )
  }

  @Test(timeout = 10_000)
  fun diamondValueChainsAreBounded() {
    // Each math/add reads the previous node twice: naive evaluation is 2^60.
    val n = 60
    val adds =
      (1..n).joinToString(",") { i ->
        """{"op":"math/add","values":{"a":{"node":${i - 1}},"b":{"node":${i - 1}}}}"""
      }
    val graph =
      """{"nodes":[{"op":"math/add","values":{"a":1,"b":0}},$adds,
          {"op":"pointer/set","configuration":{"pointer":"/nodes/0/translation"},"values":{"value":{"node":$n}}},
          {"op":"event/onStart","flows":{"out":{"node":${n + 1}}}}
        ]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    s.step(0.016, XRPose())
    // The evaluation budget aborts the read, so the scalar never reaches the pointer.
    assertArrayEquals(floatArrayOf(0f, 0f, 0f), s.nodeTransform(0)!!.translation, 0f)
  }

  @Test(timeout = 10_000)
  fun nestedForLoopsAreBounded() {
    // flow/for whose body re-enters itself with a huge range.
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1}}},
          {"op":"flow/for","values":{"startIndex":0,"endIndex":1e9},"flows":{"body":{"node":1},"completed":{"node":2}}},
          {"op":"variable/set","configuration":{"variable":0},"values":{"value":{"node":3}}},
          {"op":"math/add","values":{"a":{"node":4},"b":1}},
          {"op":"variable/get","configuration":{"variable":0}}
        ],"variables":[{"id":"done","value":0}]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    val done = s.variableValue("done") as Double
    assertTrue("done=$done", done <= XRLiveRuntimeSession.MAX_STEPS_PER_INVOCATION)
  }

  @Test(timeout = 10_000)
  fun flowQueueAndSocketCountsAreCapped() {
    val flows = (0 until 100).joinToString(",") { """"$it":{"node":2}""" }
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1}}},
          {"op":"flow/sequence","flows":{$flows}},
          {"op":"variable/set","configuration":{"variable":0},"values":{"value":{"node":3}}},
          {"op":"math/add","values":{"a":{"node":4},"b":1}},
          {"op":"variable/get","configuration":{"variable":0}}
        ],"variables":[{"id":"count","value":0}]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    assertEquals(XRLiveRuntimeSession.MAX_SOCKETS_PER_NODE.toDouble(), s.variableValue("count"))

    // Self-feeding 64-way sequence: the queue never outgrows the step budget.
    val self = (0 until 64).joinToString(",") { """"$it":{"node":1}""" }
    val (s2, _) =
      session(
        gltfWithGraph(
          """{"nodes":[{"op":"event/onStart","flows":{"out":{"node":1}}},{"op":"flow/sequence","flows":{$self}}]}"""
        )
      )
    s2.start()
  }

  @Test
  fun preAllocationLimits() {
    // GLB JSON chunk header claiming more than 32 MiB is rejected before allocating.
    val len = XRLiveSceneCoreHelper.MAX_JSON_CHUNK_BYTES + 4
    val glb = ByteBuffer.allocateDirect(20 + len).order(ByteOrder.LITTLE_ENDIAN)
    glb.putInt(0x46546C67).putInt(2).putInt(20 + len).putInt(len).putInt(0x4E4F534A)
    glb.rewind()
    assertNull(XRLiveSceneCoreHelper.extractGlbJsonChunk(glb))

    assertNull(MiniJson.parseOrNull("[1,2,3,4,5]", maxValues = 5))
    assertNotNull(MiniJson.parseOrNull("[1,2,3,4]", maxValues = 5))
    assertNull(MiniJson.parseOrNull("1" + "0".repeat(MiniJson.MAX_NUMBER_CHARS)))

    val nodes = (0..XRLiveRuntimeSession.MAX_NODES).joinToString(",") { "{}" }
    assertThrows {
      val unused = XRLiveRuntimeSession("""{"nodes":[$nodes]}""")
    }
    val mats = (0..XRLiveRuntimeSession.MAX_MATERIALS).joinToString(",") { "{}" }
    assertThrows {
      val unused = XRLiveRuntimeSession("""{"materials":[$mats]}""")
    }

    assertEquals(128 * 1024 * 1024, SplatParser.MAX_SPZ_DECOMPRESSED_BYTES)
  }

  @Test
  fun alphaCutoffPointerWrite() {
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1}}},
          {"op":"pointer/set","configuration":{"pointer":"/materials/0/alphaCutoff"},"values":{"value":{"value":7}}}
        ]}"""
    val alpha = ArrayList<Float>()
    val s = XRLiveRuntimeSession(gltfWithGraph(graph))
    s.listener =
      object : XRLiveRuntimeSession.Listener {
        override fun onAlphaCutoffChanged(materialIndex: Int, alphaCutoff: Float) {
          alpha.add(alphaCutoff)
        }
      }
    assertEquals(0.5f, s.materialAlphaCutoff(0), 0f)
    s.start()
    assertEquals(1f, s.materialAlphaCutoff(0), 0f)
    assertEquals(listOf(1f), alpha)
    assertEquals(1.0, s.readPointer("/materials/0/alphaCutoff"))
  }

  @Test
  fun unprojectsWithYawedCamera() {
    val proj =
      FloatArray(16).also {
        it[0] = 1f
        it[5] = 1f
        it[10] = -1f
        it[11] = -1f
        it[14] = -0.2f
      }
    // Camera at (0, 1.6, 0) yawed +90° about +Y: it looks down -X.
    val cam =
      FloatArray(16).also {
        it[2] = -1f // column 0 = (0, 0, -1)
        it[5] = 1f // column 1 = (0, 1, 0)
        it[8] = 1f // column 2 = (1, 0, 0)
        it[13] = 1.6f
        it[15] = 1f
      }
    val d =
      WorldUnderstanding.unprojectDetection(doubleArrayOf(0.4, 0.4, 0.6, 0.6), cam, proj, 2.0)!!
    assertEquals(-2.0, d.x, 1e-6)
    assertEquals(1.6, d.y, 1e-6)
    assertEquals(0.0, d.z, 1e-6)
    // A box right of center lands toward -Z (the camera's right) when yawed +90°.
    val right =
      WorldUnderstanding.unprojectDetection(doubleArrayOf(0.4, 0.7, 0.6, 0.9), cam, proj, 2.0)!!
    assertTrue(right.z < -0.5)
    assertThrows {
      WorldUnderstanding.unprojectDetection(doubleArrayOf(0.4, 0.4, 0.6, 0.6), FloatArray(4), proj)
    }
  }

  @Test
  fun waitAllInputFlowsMatchesWeb() {
    // inputFlows 0.5 -> Number(0.5) || 2 = 0.5 -> trunc 0 -> max(1, 0) = 1: fires on first input.
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1,"socket":"a"}}},
          {"op":"flow/waitAll","configuration":{"inputFlows":0.5},"flows":{"out":{"node":2}}},
          {"op":"pointer/set","configuration":{"pointer":"/nodes/0/visible"},"values":{"value":false}}
        ]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    assertFalse(s.isVisible(0))
  }

  @Test
  fun lazyFollowReadsOnlyModeExceptFromSceneCore() {
    assertEquals(
      "head",
      XRLiveSceneCoreHelper.parseLazyFollow(mapOf("target" to "hand-left"))!!.mode,
    )
    val json =
      """{"nodes":[{"name":"S","extensions":{"ANDROID_xr_scenecore":{"follow":{"target":"hand-left","lazy":true,"distance":0.3}}}}]}"""
    val t = XRLiveSceneCoreHelper.parseNodeTraitsFromGltfJson(json)[0]
    assertTrue(t.followLazy)
    assertEquals("hand-left", t.follow)
    assertEquals(0.3, t.followDistance, 0.0)
  }

  @Test
  fun legacyConstructorAndAutoStart() {
    val legacy = XRLiveNodeTraits(0, "a", true, false, null, null, null, null)
    assertTrue(legacy.grabbable)
    assertNull(legacy.grabMode)

    val (s, _) = session()
    s.step(0.016, XRPose())
    assertArrayEquals(floatArrayOf(0f, 3f, 0f), s.nodeTransform(3)!!.translation, 0f)
  }

  @Test
  fun formatNumberFollowsJavaScript() {
    val cases =
      mapOf(
        0.0 to "0",
        -0.0 to "0",
        1.0 to "1",
        -2.5 to "-2.5",
        100.0 to "100",
        0.1 to "0.1",
        123.456 to "123.456",
        1e-6 to "0.000001",
        1.5e-7 to "1.5e-7",
        1e20 to "100000000000000000000",
        1e21 to "1e+21",
        1.25e22 to "1.25e+22",
        Double.NaN to "NaN",
        Double.NEGATIVE_INFINITY to "-Infinity",
      )
    for ((v, expected) in cases) assertEquals("$v", expected, MiniJson.formatNumber(v))
    assertEquals("""{"v":1e+21}""", MiniJson.stringify(mapOf("v" to 1e21)))
  }

  @Test
  fun hypotStyleLengthAndInputValidation() {
    val graph =
      """{"nodes":[
          {"op":"event/onStart","flows":{"out":{"node":1}}},
          {"op":"pointer/set","configuration":{"pointer":"/materials/0/pbrMetallicRoughness/roughnessFactor"},"values":{"value":{"node":2}}},
          {"op":"math/div","values":{"a":{"node":3},"b":1e200}},
          {"op":"math/length","values":{"a":{"value":[3e200,4e200]}}}
        ]}"""
    val (s, _) = session(gltfWithGraph(graph))
    s.start()
    // sqrt((3e200)^2 + (4e200)^2) overflows naively; hypot gives 5e200 -> 5 -> clamp01 -> 1.
    assertEquals(1f, s.materialRoughness(0), 0f)

    val em = ParticleEmitter(XRParticlesTrait("rain", 5000, listOf(1.0, 1.0, 1.0), 1.0))
    assertEquals(XRLiveSceneCoreHelper.MAX_PARTICLES_PER_EMITTER, em.count)
    assertEquals(0, ParticleEmitter(XRParticlesTrait("rain", -3)).positions.size)
    assertThrows { SplatParser.sortSplatsByDepth(3, FloatArray(3), FloatArray(16)) }
    assertThrows { SplatParser.sortSplatsByDepth(1, FloatArray(3), FloatArray(4)) }
    assertThrows { WorldUnderstanding.viewportRay(0.5, 0.5, FloatArray(16), FloatArray(3)) }
  }

  @Test
  fun matchesCrossPlatformGoldenSuite() {
    val dir =
      listOf(
          java.io.File("testdata/golden"),
          java.io.File("../../testdata/golden"),
          java.io.File("experimental/users/binghamj/three_live/testdata/golden"),
        )
        .firstOrNull { java.io.File(it, "scene.glb.json").isFile }
        ?: error("testdata/golden not found from ${java.io.File(".").absolutePath}")

    val sceneJson = java.io.File(dir, "scene.glb.json").readText(Charsets.UTF_8)
    val script =
      MiniJson.parseObjectOrNull(java.io.File(dir, "script.json").readText(Charsets.UTF_8))!!
    val expected =
      MiniJson.parseObjectOrNull(java.io.File(dir, "expected.json").readText(Charsets.UTF_8))!!

    val (session, rec) = session(sceneJson)
    var detectionsOut: List<WorldUnderstanding.Detection3D> = emptyList()

    for (rawStep in MiniJson.asList(script["steps"])!!) {
      val step = MiniJson.asMap(rawStep)!!
      when (step["action"] as String) {
        "start" -> session.start()
        "select" -> session.dispatchSelect((step["nodeIndex"] as Number).toInt())
        "step" -> {
          val dt = (step["dt"] as Number).toDouble()
          val repeat = (step["repeat"] as? Number)?.toInt() ?: 1
          val hp =
            MiniJson.asList(step["headPosition"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val hq =
            MiniJson.asList(step["headQuaternion"])!!.map { (it as Number).toFloat() }
              .toFloatArray()
          val pose = XRPose(hp, hq)
          repeat(repeat) { session.step(dt, pose) }
        }
        "dragCorner" -> {
          val nodeIdx = (step["nodeIndex"] as Number).toInt()
          val localMin =
            MiniJson.asList(step["localMin"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val localMax =
            MiniJson.asList(step["localMax"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val cornerIdx = (step["cornerIndex"] as Number).toInt()
          val rayOrigin =
            MiniJson.asList(step["rayOrigin"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val rawDir =
            MiniJson.asList(step["rayDirection"])!!.map { (it as Number).toDouble() }
              .toDoubleArray()
          val dirLen = XRSpatialMath.len3(rawDir[0], rawDir[1], rawDir[2])
          val rayDir = doubleArrayOf(rawDir[0] / dirLen, rawDir[1] / dirLen, rawDir[2] / dirLen)
          val world = DoubleArray(16)
          session.nodeWorldMatrix(nodeIdx, world)
          val layout = ManipulationHandles.computeLayout(localMin, localMax, world)
          val traits = session.traits.first { it.nodeIndex == nodeIdx }.handles!!
          val startScale = session.nodeTransform(nodeIdx)!!.scale[0].toDouble()
          val newScale =
            ManipulationHandles.cornerScale(
                startScale,
                layout.corners[cornerIdx],
                layout.origin,
                rayOrigin,
                rayDir,
                traits.minScale,
                traits.maxScale,
              )
              .toFloat()
          session.setNodeTransform(nodeIdx, scale = floatArrayOf(newScale, newScale, newScale))
        }
        "autoRotate" -> {
          val rad = (step["angleDeg"] as Number).toDouble() * Math.PI / 180.0
          val q = XRSpatialMath.quatFromYaw(rad)
          val root = DoubleArray(16)
          XRSpatialMath.mat4FromTRS(
            doubleArrayOf(0.0, 0.0, 0.0),
            q,
            doubleArrayOf(1.0, 1.0, 1.0),
            root,
          )
          session.rootTransform = root
        }
        "detect" -> {
          val detJson = MiniJson.stringify(step["detections"])
          val boxes = ThreeLiveDetections.parse(detJson)
          val camWorld =
            MiniJson.asList(step["cameraWorld"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val proj =
            MiniJson.asList(step["projection"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val depth = (step["depthMeters"] as Number).toDouble()
          detectionsOut =
            ThreeLiveDetections.detect(boxes, camWorld, proj, { _, _ -> depth }, emptyList())
        }
      }
    }

    val expectedNodes = MiniJson.asList(expected["nodes"])!!
    assertEquals(expectedNodes.size, session.nodeCount)
    for (i in expectedNodes.indices) {
      val en = MiniJson.asMap(expectedNodes[i])!!
      assertEquals(en["name"] as String, session.nodeName(i))
      val tr = session.nodeTransform(i)!!
      val et = MiniJson.asList(en["translation"])!!.map { (it as Number).toFloat() }.toFloatArray()
      val er = MiniJson.asList(en["rotation"])!!.map { (it as Number).toFloat() }.toFloatArray()
      val es = MiniJson.asList(en["scale"])!!.map { (it as Number).toFloat() }.toFloatArray()
      val ew =
        MiniJson.asList(en["worldPosition"])!!.map { (it as Number).toFloat() }.toFloatArray()
      assertArrayEquals("node[$i] translation", et, tr.translation, 1e-4f)
      val qMatch =
        (0..3).all { kotlin.math.abs(tr.rotation[it] - er[it]) <= 1e-4f } ||
          (0..3).all { kotlin.math.abs(tr.rotation[it] + er[it]) <= 1e-4f }
      assertTrue("node[$i] rotation ${tr.rotation.toList()} vs ${er.toList()}", qMatch)
      assertArrayEquals("node[$i] scale", es, tr.scale, 1e-4f)
      assertArrayEquals("node[$i] worldPosition", ew, session.nodeWorldPosition(i)!!, 1e-4f)
      assertEquals("node[$i] visible", en["visible"] as Boolean, session.isVisible(i))
    }

    val em0 = MiniJson.asMap(MiniJson.asList(expected["materials"])!![0])!!
    val ebc =
      MiniJson.asList(em0["baseColorFactor"])!!.map { (it as Number).toFloat() }.toFloatArray()
    assertArrayEquals(ebc, session.materialColor(0)!!, 1e-4f)
    assertEquals((em0["metallicFactor"] as Number).toFloat(), session.materialMetallic(0), 1e-4f)
    assertEquals((em0["roughnessFactor"] as Number).toFloat(), session.materialRoughness(0), 1e-4f)

    val expectedEvents = MiniJson.asList(expected["events"])!!
    assertEquals(expectedEvents.size, rec.events.size)
    val ev0 = MiniJson.asMap(expectedEvents[0])!!
    assertEquals(ev0["id"] as String, rec.events[0].first)
    assertEquals(ev0["payload"], MiniJson.parseOrNull(rec.events[0].second))

    val expectedDets = MiniJson.asList(expected["detections"])!!
    assertEquals(expectedDets.size, detectionsOut.size)
    val ed0 = MiniJson.asMap(expectedDets[0])!!
    val d0 = detectionsOut[0]
    assertEquals(ed0["label"] as String, d0.label)
    val ep = MiniJson.asList(ed0["position"])!!.map { (it as Number).toDouble() }.toDoubleArray()
    val esz = MiniJson.asList(ed0["size"])!!.map { (it as Number).toDouble() }.toDoubleArray()
    assertEquals(ep[0], d0.x, 1e-4)
    assertEquals(ep[1], d0.y, 1e-4)
    assertEquals(ep[2], d0.z, 1e-4)
    assertEquals(esz[0], d0.widthMeters, 1e-4)
    assertEquals(esz[1], d0.heightMeters, 1e-4)
    assertEquals(ed0["depthSource"] as String, d0.depthSource.wireName)
  }

  // =============================================================================================
  // Helpers
  // =============================================================================================

  @Test
  fun ballpitNegativeFloorAndPedestalPhysics() {
    val json =
      """{
        "nodes": [
          {"name": "Room_Floor", "mesh": 0, "translation": [0, -0.85, 0], "extras": {"xr": {"physics": "static"}}},
          {"name": "Pedestal_Table", "mesh": 1, "translation": [0, -0.25, 0], "extras": {"xr": {"physics": "static"}}},
          {"name": "Ball_1", "mesh": 2, "translation": [0, 0.85, 0], "extras": {"xr": {"physics": "dynamic"}}},
          {"name": "Ball_2", "mesh": 2, "translation": [0.95, 0.85, 0], "extras": {"xr": {"physics": "dynamic"}}}
        ],
        "meshes": [
          {"primitives": [{"attributes": {"POSITION": 0}}]},
          {"primitives": [{"attributes": {"POSITION": 1}}]},
          {"primitives": [{"attributes": {"POSITION": 2}}]}
        ],
        "accessors": [
          {"min": [-1.7, -0.04, -1.7], "max": [1.7, 0.04, 1.7]},
          {"min": [-0.65, -0.04, -0.65], "max": [0.65, 0.04, 0.65]},
          {"min": [-0.11, -0.11, -0.11], "max": [0.11, 0.11, 0.11]}
        ]
      }"""
    val s = XRLiveRuntimeSession(json)
    val head = XRPose(floatArrayOf(0f, 1.6f, 0f))
    // Multi-ball scene launches upward on frame 1 then falls under gravity onto the pedestal/floor
    s.step(1.0 / 60.0, head)
    val yFirstStep = s.nodeTransform(2)!!.translation[1]
    assertTrue("Multi-ball initial fountain impulse lifts Ball_1 on first step", yFirstStep > 0.85f)
    for (k in 0 until 90) {
      s.step(1.0 / 60.0, head)
    }
    val yBall1 = s.nodeTransform(2)!!.translation[1]
    val yBall2 = s.nodeTransform(3)!!.translation[1]
    assertTrue("Ball_1 stays above negative-Y Room_Floor (-0.81 + r)", yBall1 >= -0.71f)
    assertTrue(
      "Ball_2 outside pedestal rim falls below pedestal top (-0.21) toward Room_Floor",
      yBall2 < 0.5f && yBall2 >= -0.71f,
    )
  }

  /**
   * Golden vectors from the reference meshoptimizer (scalar build); see
   * three-live/tests/meshopt_test.ts.
   */
  private val meshoptGolden: Map<String, String> =
    mapOf(
      "vb_37x12_v0_raw" to
        "00070eff1c232aff383f46ff00070f0005252c003b424900000810ff1f272eff3e454dff010911002129310041495100" +
          "3d0912ff222b33ff444c54ff010a1300242d3500474f5800020b14ff262f38ff4a535cff020b150027313a004d565f00" +
          "020c16ff29333cff50fb63ff030d17002b353f00535d6700030d18ff2c3741ff56606aff030e19002e39f10059636e00" +
          "040f1aff303b46ff5c6772ff040f1b00313d48005f6a750004101cff333f4aff626d79ff05111d0035414d0065717d00" +
          "05111eff36434fff637480ff05121f00384551006b778400061331ff3a4754ff6e7b88ff061321003b495600717e8b00" +
          "061422ff3d4b58ff31818fff07152300545d5b0077859300071524ff404f5dff7a9e96ff0716250042515f007d8b9a00" +
          "081726ff445362ff808f9eff08172700455564008392a100081828ff475766ff8695a5ff09192900495969008999a900" +
          "09192aff4a5b6bff8c9cacff8d1a2b004c5d6d008f9fb0000a1b2cff4e5f70ff92a3b4ff0a1b2d004f61720095a6b700" +
          "0a1c2eff516374ff98a9bbff0b1d7b00536577009badbf000b1d30ffe76779ff9eb0c2ff0b1e310056697b00a1b3c600" +
          "0c1f32ff586b7eff56b7caff",
      "vb_37x12_v0_enc" to
        "a01502f8208278770820823cf7fa20800000150a28a28a28a28a28a2800000152aaaaaaaafaaaaaa241fbe8000009a95" +
          "152666666666666666664000001a0ff42442442442442d3424424ff4424424422e27ffc000000404d7de042a04444444" +
          "4444444444444ff444444444241b44444000000000002a04464464464ff4469faa446446446446446446446000000000" +
          "00152666666666666666664000002a06666666666666663f66ff6666666666107f8c6666f00000000000952a06686686" +
          "ff668668b5c4668668ff86686686322568668000000000002a0688688688688688688688688688688688688000000000" +
          "0015266666666666666666400000000000000000000000000000000000000000000000070eff1c232aff383f46ff",
      "vb_37x12_v1_raw" to
        "00070eff1c232aff383f46ff00070f001d2565003b424900000810ff1f272eff3e454dff010911002129310041495100" +
          "010912ff222b7dff444c54ff010a1300242d3500474fc400020b14ff263038ff4a535cff020b150027313a004d565f00" +
          "020c16ff29333cff50a063ff030d17002b353f00535d6700030d18ff2c3741ff56606aff030e19002e39430059636e00" +
          "070f1aff303b46ff5c67deff040f1b00313d48005f6a750004101cffd9c84aff626d79ff0511050035414d0065717d00" +
          "05111eff36434fff687480ff05121f0038cf51006b778400061320ff3a2254ff6e7b88ff061321003b495600717e8b00" +
          "061422ff3d4b58ff74818fff071523003f4d5b0077859300071524ff404f5dff7a8896ff072a250042515f007d8b9a00" +
          "081726ff445362ff808f9eff08172700965564008392a100081828ff470566ff8695a5ff09192900495969008999a900" +
          "09192aff055b6bff8c9cacff091a5f004c5d6d008f9fb0000a1b2cff4e5f70ff92a3b4ff0a1b2d004f61720095a6b700" +
          "0a1c2eff516374ff98a9bbff891d2f00536577009badbf000b1d30ff546779ff9eb0c2ff0b1e310056697b00a1b3c600" +
          "0c1f32ff586b7effa4b7caff",
      "vb_37x12_v1_enc" to
        "a155555505020820f20805082082081600fefb02150a28a28a28a3ca282a25a2800000152aaaaaab2deaaaaabe326a65" +
          "aa800000152666666666666666664000000a02442442442442ffafb8244244244ff4ff42a49d878e1f0004040204040a" +
          "04444462444444ffe9f24fff444444ff4444e7a64e9fa81f0004040404040a0ff6ff6446446446766d988f4464464464" +
          "4644641f000406040406152666666666666666664000000a066666666666666666666666666666661f0006060606060a" +
          "06686686ff668668948566866866866866861f0006080606080a06886ff68868ff88e0cfe0d168868868868868861f00" +
          "08080608081526666666666666666640000000000000000000000000070eff1c232aff383f46ff000000",
      "ib_v0_enc" to
        "e0fe1f001f001f001f001f001ffe1f0b1f0a1f091f081f071fff1f071f071f071f071f071fff1f071f071f071f071f07" +
          "1fff1f071f071f071f071f071fff1f071f071f071f071f071ffffff00e020202020202fb02020202020202f60b0e0202" +
          "02020202f60b0e020202020202f60b0e020202020202f60b0e020202020202fff00ec50fd6c508ffd9c508000c007687" +
          "566778a9866589689801690000",
      "ib_v1_enc" to
        "e1fe1e001e001e001e001e001efe1e0b1e0a1e091e081e071eff1e071e071e071e071e071eff1e071e071e071e071e07" +
          "1eff1e071e071e071e071e071eff1e071e071e071e071e071efffff00efb02f60b0ef60b0ef60b0ef60b0efff00ec50f" +
          "d6c508ffd9c508000c007687566778a9866589689801690000",
      "ib_decoded_u32" to
        "000000000700000001000000010000000700000008000000010000000800000002000000020000000800000009000000" +
          "02000000090000000300000003000000090000000a000000030000000a00000004000000040000000a0000000b000000" +
          "040000000b00000005000000050000000b0000000c000000050000000c00000006000000060000000c0000000d000000" +
          "070000000e00000008000000080000000e0000000f000000080000000f00000009000000090000000f00000010000000" +
          "09000000100000000a0000000a00000010000000110000000a000000110000000b0000000b0000001100000012000000" +
          "0b000000120000000c0000000c00000012000000130000000c000000130000000d0000000d0000001300000014000000" +
          "0e000000150000000f0000000f00000015000000160000000f0000001600000010000000100000001600000017000000" +
          "100000001700000011000000110000001700000018000000110000001800000012000000120000001800000019000000" +
          "12000000190000001300000013000000190000001a000000130000001a00000014000000140000001a0000001b000000" +
          "150000001c00000016000000160000001c0000001d000000160000001d00000017000000170000001d0000001e000000" +
          "170000001e00000018000000180000001e0000001f000000180000001f00000019000000190000001f00000020000000" +
          "19000000200000001a0000001a00000020000000210000001a000000210000001b0000001b0000002100000022000000" +
          "1c000000230000001d0000001d00000023000000240000001d000000240000001e0000001e0000002400000025000000" +
          "1e000000250000001f0000001f00000025000000260000001f0000002600000020000000200000002600000027000000" +
          "200000002700000021000000210000002700000028000000210000002800000022000000220000002800000029000000" +
          "230000002a00000024000000240000002a0000002b000000240000002b00000025000000250000002b0000002c000000" +
          "250000002c00000026000000260000002c0000002d000000260000002d00000027000000270000002d0000002e000000" +
          "270000002e00000028000000280000002e0000002f000000280000002f00000029000000290000002f00000030000000" +
          "e80300000500000070110100030000000300000009000000",
      "seq_enc" to "d1000404041c0404c9011ab9b31802030c001a00000000",
      "seq_u32" to
        "000000000100000002000000030000000a0000000b0000000c0000003200000005000000a0860100040000009f860100" +
          "070000000700000000000000",
      "oct8_enc" to "004f7f00594f7f0033117f00a1ad7f00d2cf7f00428f7f003de27f006d607f00",
      "oct8_dec" to "006d42005341b900511b5e00b5caa900b2ac370016a1af0065ce3b002e1b8d00",
      "oct16_enc" to
        "0000ff4fff7f00004759384fff7f00005433ed10ff7f00006fa02facff7f000062d148ceff7f000094421d8eff7f0000" +
          "303df5e1ff7f0000b66db760ff7f0000",
      "oct16_dec" to
        "0000c16ddb4100000b54b64238ba00008d51e41aeb5e0000bbb4c0c874a800009ab051abed350000061622a01aae0000" +
          "1f6559cec33c0000582e171bce8b0000",
      "quat_enc" to
        "000000000000ff0700000000ff07fc070000ff070000fd07ff0700000000fe07a705a705a705fc0764039cfcdffefd07",
      "quat_dec" to
        "000000000000ff7f825a00000000825a0000825a0000825a00000000825a825a0f40fa3ffa3ffa3f39f3367361269fd9",
      "exp_enc" to
        "003000f300e0fff1803e00fc6e3400e500c4fff4000000fcba3d00f911c9ff06002000f4333300ef333300f09ad9fff1",
      "exp_dec" to
        "0000c03f000080be00007a4400b8d138000070c00000000000e8f64200bc5bc90000004000cccc3d00cc4c3e009899be",
      "color8_enc" to "407fc1ff7f007fc04081c08066cd00e6ff0000ff",
      "color8_dec" to "fe0100ff00fe00800100ff00336699ccffffffff",
      "color16_enc" to
        "0004ff0701fcff0fff070000ff07000c000401f800fc00086606cdfc0000660eff0f00000000ff0f",
      "color16_dec" to
        "efff10000000ffff0000efff0000088010000000ffff0000333366669999ccccffffffffffffffff",
    )

  private fun goldenBytes(name: String): ByteArray {
    val s = meshoptGolden.getValue(name)
    return ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  }

  @Test
  fun meshoptSpecDecodersMatchReferenceMeshoptimizer() {
    for (v in listOf("v0", "v1")) {
      val raw = goldenBytes("vb_37x12_${v}_raw")
      val enc = goldenBytes("vb_37x12_${v}_enc")
      assertArrayEquals(
        "vertex codec $v",
        raw,
        MeshoptDecoder.decodeBuffer(enc, 37, 12, "ATTRIBUTES"),
      )
      assertThrows { MeshoptDecoder.decodeBuffer(enc.copyOf(enc.size - 1), 37, 12, "ATTRIBUTES") }
      val ours = MeshoptDecoder.encodeBuffer(raw, 37, 12, "ATTRIBUTES")
      assertArrayEquals(
        "encoder $v round trip",
        raw,
        MeshoptDecoder.decodeBuffer(ours, 37, 12, "ATTRIBUTES"),
      )
    }
    val ib = goldenBytes("ib_decoded_u32")
    for (v in listOf("ib_v0_enc", "ib_v1_enc")) {
      assertArrayEquals(
        v,
        ib,
        MeshoptDecoder.decodeBuffer(goldenBytes(v), ib.size / 4, 4, "TRIANGLES"),
      )
    }
    val ibOurs = MeshoptDecoder.encodeBuffer(ib, ib.size / 4, 4, "TRIANGLES")
    assertArrayEquals(ib, MeshoptDecoder.decodeBuffer(ibOurs, ib.size / 4, 4, "TRIANGLES"))
    val legacy = goldenBytes("ib_v1_enc").also { it[0] = 0xb0.toByte() }
    assertThrows { MeshoptDecoder.decodeBuffer(legacy, ib.size / 4, 4, "TRIANGLES") }
    val seq = goldenBytes("seq_u32")
    assertArrayEquals(
      seq,
      MeshoptDecoder.decodeBuffer(goldenBytes("seq_enc"), seq.size / 4, 4, "INDICES"),
    )
    val seqOurs = MeshoptDecoder.encodeBuffer(seq, seq.size / 4, 4, "INDICES")
    assertArrayEquals(seq, MeshoptDecoder.decodeBuffer(seqOurs, seq.size / 4, 4, "INDICES"))
    for ((name, count, stride, filter) in
      listOf(
        listOf("oct8", 8, 4, "OCTAHEDRAL"),
        listOf("oct16", 8, 8, "OCTAHEDRAL"),
        listOf("quat", 6, 8, "QUATERNION"),
        listOf("exp", 4, 12, "EXPONENTIAL"),
        listOf("color8", 5, 4, "COLOR"),
        listOf("color16", 5, 8, "COLOR"),
      )) {
      val buf = goldenBytes("${name}_enc")
      MeshoptDecoder.applyFilter(buf, count as Int, stride as Int, filter as String)
      assertArrayEquals("filter $name", goldenBytes("${name}_dec"), buf)
    }
  }

  @Test
  fun meshoptDecoderAndMaterialVariantsAndGpuInstancing() {
    val orig = ByteArray(16 * 4) { ((it * 13 + 7) and 0xFF).toByte() }
    val compressed = MeshoptDecoder.encodeBuffer(orig, 16, 4, "ATTRIBUTES")
    val decoded = MeshoptDecoder.decodeBuffer(compressed, 16, 4, "ATTRIBUTES")
    assertArrayEquals(orig, decoded)

    val oct = byteArrayOf(0, 0, 100, 127)
    MeshoptDecoder.applyFilter(oct, 1, 4, "OCTAHEDRAL")
    assertEquals(0, oct[0].toInt())
    assertEquals(0, oct[1].toInt())
    assertEquals(127, oct[2].toInt())

    val octZero = byteArrayOf(0, 0, 0, 127)
    MeshoptDecoder.applyFilter(octZero, 1, 4, "OCTAHEDRAL")
    assertEquals(127, octZero[2].toInt())

    val triRaw = byteArrayOf(0, 0, 1, 0, 2, 0, 2, 0, 1, 0, 3, 0)
    val triEnc = MeshoptDecoder.encodeBuffer(triRaw, 6, 2, "TRIANGLES")
    val triDec = MeshoptDecoder.decodeBuffer(triEnc, 6, 2, "TRIANGLES")
    assertArrayEquals(triRaw, triDec)

    val exp =
      ByteBuffer.allocate(4).order(ByteOrder.LITTLE_ENDIAN).putInt(0, (-1 shl 24) or 1).array()
    MeshoptDecoder.applyFilter(exp, 1, 4, "EXPONENTIAL")
    val expFloat = ByteBuffer.wrap(exp).order(ByteOrder.LITTLE_ENDIAN).getFloat(0)
    assertEquals(0.5f, expFloat, 1e-6f)

    // QUATERNION: out[(qc+1)&3]=x, out[(qc+2)&3]=y, out[(qc+3)&3]=z, out[qc]=w.
    for (qc in 0 until 3) {
      val qb = ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN)
      qb.putShort(0, 16384.toShort()).putShort(2, 0.toShort()).putShort(4, (-16384).toShort())
      qb.putShort(6, (0x7FFC or qc).toShort())
      val q = qb.array()
      MeshoptDecoder.applyFilter(q, 1, 8, "QUATERNION")
      val out = ByteBuffer.wrap(q).order(ByteOrder.LITTLE_ENDIAN)
      val comp = { k: Int -> out.getShort(k * 2).toInt() }
      assertEquals("qc=$qc x", 11585.0, comp((qc + 1) and 3).toDouble(), 2.0)
      assertEquals("qc=$qc y", 0.0, comp((qc + 2) and 3).toDouble(), 2.0)
      assertEquals("qc=$qc z", -11585.0, comp((qc + 3) and 3).toDouble(), 2.0)
      assertEquals("qc=$qc w", 28378.0, comp(qc).toDouble(), 2.0)
    }

    assertThrows {
      MeshoptDecoder.decodeBuffer(
        byteArrayOf(0xba.toByte(), 1),
        MeshoptDecoder.MAX_MESHOPT_COUNT + 1,
        4,
        "ATTRIBUTES",
      )
    }

    val gltfJson =
      """{
        "extensions": {
          "KHR_materials_variants": {
            "variants": [{"name": "Midnight"}, {"name": "Solar Gold"}]
          }
        },
        "materials": [
          {"name": "Midnight", "pbrMetallicRoughness": {"baseColorFactor": [0.1, 0.1, 0.2, 1]}},
          {"name": "SolarGold", "pbrMetallicRoughness": {"baseColorFactor": [0.95, 0.6, 0.05, 1]}}
        ],
        "meshes": [
          {
            "primitives": [
              {
                "material": 0,
                "extensions": {
                  "KHR_materials_variants": {
                    "mappings": [
                      {"material": 0, "variants": [0]},
                      {"material": 1, "variants": [1]}
                    ]
                  }
                }
              }
            ]
          }
        ],
        "nodes": [
          {
            "name": "WatchStuds",
            "mesh": 0,
            "extensions": {
              "EXT_mesh_gpu_instancing": {
                "attributes": {"TRANSLATION": 0, "ROTATION": 1, "SCALE": 2}
              }
            }
          }
        ],
        "accessors": [
          {"count": 12},
          {"count": 12},
          {"count": 12}
        ]
      }"""
    val s = XRLiveRuntimeSession(gltfJson)
    assertEquals(listOf("Midnight", "Solar Gold"), s.availableVariants)
    assertEquals(0, s.meshPrimitiveMaterial(0, 0))
    assertEquals(12, s.nodeInstanceCount(0))
    assertTrue(s.selectVariant("Solar Gold"))
    assertEquals("Solar Gold", s.activeVariantName)
    assertEquals(1, s.meshPrimitiveMaterial(0, 0))
    assertTrue(s.selectVariant(null))
    assertNull(s.activeVariantName)
    assertEquals(0, s.meshPrimitiveMaterial(0, 0))
    assertFalse(s.selectVariant("NonExistent"))

    // Unnamed variants keep their index; a variant named "default" is selectable.
    val unnamed =
      XRLiveRuntimeSession(
        """{"extensions":{"KHR_materials_variants":{"variants":[{},{"name":"Gold"},{"name":"default"}]}},
        "materials":[{},{},{}],
        "meshes":[{"primitives":[{"material":0,"extensions":{"KHR_materials_variants":{"mappings":[
          {"material":1,"variants":[1]},{"material":2,"variants":[2]}]}}}]}],
        "nodes":[{"mesh":0}]}"""
      )
    assertEquals(listOf("Variant_0", "Gold", "default"), unnamed.availableVariants)
    assertTrue(unnamed.selectVariant("Gold"))
    assertEquals(1, unnamed.meshPrimitiveMaterial(0, 0))
    assertTrue(unnamed.selectVariant("default"))
    assertEquals("default", unnamed.activeVariantName)
    assertEquals(2, unnamed.meshPrimitiveMaterial(0, 0))
  }

  @Test
  fun extendedToneMappingAndBloomAndOutlineTraits() {
    val neutral = XRLiveSceneCoreHelper.evaluateToneMapping(4.0, 1.5, 0.25, "neutral", 1.0)
    val aces = XRLiveSceneCoreHelper.evaluateToneMapping(4.0, 1.5, 0.25, "aces", 1.0)
    val agx = XRLiveSceneCoreHelper.evaluateToneMapping(4.0, 1.5, 0.25, "agx", 1.0)
    val reinhard = XRLiveSceneCoreHelper.evaluateToneMapping(4.0, 1.5, 0.25, "reinhard", 1.0)
    val none = XRLiveSceneCoreHelper.evaluateToneMapping(4.0, 1.5, 0.25, "none", 1.0)
    assertTrue(neutral[0] in 0.7..1.0)
    assertTrue(aces[0] in 0.8..1.0)
    assertTrue(agx[0] in 0.6..1.0)
    assertEquals(0.8, reinhard[0], 1e-4)
    assertEquals(1.0, none[0], 1e-6)
    // Cross-platform golden values (identical in three_view_test.ts and the Swift tests).
    assertArrayEquals(doubleArrayOf(0.983256, 0.554125, 0.339560), neutral, 1e-5)
    assertArrayEquals(doubleArrayOf(0.934211, 0.780548, 0.215326), aces, 1e-5)
    assertArrayEquals(doubleArrayOf(0.907921, 0.704809, 0.389573), agx, 1e-5)
    assertArrayEquals(doubleArrayOf(0.8, 0.6, 0.2), reinhard, 1e-6)
    assertArrayEquals(doubleArrayOf(1.0, 1.0, 0.25), none, 1e-6)

    val bloom =
      XRLiveSceneCoreHelper.parseBloom(
        mapOf("strength" to 1.2, "threshold" to 0.65, "radius" to 0.5)
      )!!
    assertEquals(1.2, bloom.strength, 1e-6)
    assertEquals(0.65, bloom.threshold, 1e-6)
    assertEquals(0.5, bloom.radius, 1e-6)

    val outline =
      XRLiveSceneCoreHelper.parseOutline(mapOf("color" to "#22c55e", "thickness" to 4.0))!!
    assertEquals("#22c55e", outline.color)
    assertEquals(4.0, outline.thickness, 1e-6)
    // Metre-sized thickness (documented 0.025) converts to pixels like web/iOS.
    assertEquals(
      3.5,
      XRLiveSceneCoreHelper.parseOutline(mapOf("thickness" to 0.025))!!.thickness,
      1e-6,
    )
    assertEquals(1.5, XRLiveSceneCoreHelper.parseOutline(mapOf("width" to 0.005))!!.thickness, 1e-6)
    assertEquals(
      0.5,
      XRLiveSceneCoreHelper.parseOutline(mapOf("thickness" to 0.3))!!.thickness,
      1e-6,
    )

    val json =
      """{
        "nodes": [
          {
            "name": "GlowingOrb",
            "extras": {
              "xr": {
                "bloom": {"strength": 0.9, "threshold": 0.7, "radius": 0.4},
                "outline": {"color": "#38bdf8", "thickness": 3.5}
              }
            }
          }
        ]
      }"""
    val traits = XRLiveSceneCoreHelper.parseNodeTraitsFromGltfJson(json)
    assertEquals(1, traits.size)
    assertEquals(0.9, traits[0].bloom!!.strength, 1e-6)
    assertEquals("#38bdf8", traits[0].outline!!.color)
    assertEquals(3.5, traits[0].outline!!.thickness, 1e-6)
  }

  @Test
  fun ikSolverAndSharedRoomVoiceParity() {
    val q90 =
      IKSolver.quatFromUnitVectors(doubleArrayOf(1.0, 0.0, 0.0), doubleArrayOf(0.0, 1.0, 0.0))
    assertEquals(Math.sin(Math.PI / 4.0), q90[2], 1e-4)
    assertEquals(Math.cos(Math.PI / 4.0), q90[3], 1e-4)

    val twoBone =
      IKSolver.solveTwoBoneIK(
        doubleArrayOf(0.0, 0.0, 0.0),
        doubleArrayOf(0.0, 0.5, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
        doubleArrayOf(0.5, 0.5, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
      )
    val d1 = Math.hypot(twoBone.midPos[0], Math.hypot(twoBone.midPos[1], twoBone.midPos[2]))
    val d2 =
      Math.hypot(
        twoBone.effectorPos[0] - twoBone.midPos[0],
        Math.hypot(
          twoBone.effectorPos[1] - twoBone.midPos[1],
          twoBone.effectorPos[2] - twoBone.midPos[2],
        ),
      )
    val err2 =
      Math.hypot(
        twoBone.effectorPos[0] - 0.5,
        Math.hypot(twoBone.effectorPos[1] - 0.5, twoBone.effectorPos[2]),
      )
    assertEquals(0.5, d1, 1e-4)
    assertEquals(0.5, d2, 1e-4)
    assertEquals(0.0, err2, 1e-4)

    val fabrik =
      IKSolver.solveFABRIK(
        listOf(
          doubleArrayOf(0.0, 0.0, 0.0),
          doubleArrayOf(0.0, 0.4, 0.0),
          doubleArrayOf(0.0, 0.8, 0.0),
          doubleArrayOf(0.0, 1.2, 0.0),
        ),
        doubleArrayOf(0.6, 0.6, 0.2),
        12,
        1e-4,
      )
    val endPos = fabrik.positions[3]
    val fabrikErr = Math.hypot(endPos[0] - 0.6, Math.hypot(endPos[1] - 0.6, endPos[2] - 0.2))
    assertTrue("fabrikErr=$fabrikErr", fabrikErr < 1e-3)
    assertEquals(3, fabrik.rotations.size)

    val ikTrait =
      XRLiveSceneCoreHelper.parseIK(
        mapOf(
          "solver" to "two-bone",
          "root" to "Shoulder",
          "mid" to "Elbow",
          "effector" to "Wrist",
          "target" to "TargetOrb",
          "pole" to listOf(0.0, 1.0, -0.5),
          "iterations" to 10,
        )
      )!!
    assertEquals("two-bone", ikTrait.solver)
    assertEquals("Shoulder", ikTrait.root)
    assertEquals("Elbow", ikTrait.mid)
    assertEquals("Wrist", ikTrait.effector)
    assertEquals("TargetOrb", ikTrait.targetName)
    assertEquals(10, ikTrait.iterations)

    val rtc =
      SharedRoom.WireMessage.Rtc(
        peerId = "peer-alice",
        targetPeerId = "peer-bob",
        signalType = "offer",
        sdp = "v=0\r\nm=audio 9 UDP/TLS\r\n",
      )
    val rtcJson = SharedRoom.serializeMessage(rtc)
    val parsedRtc = SharedRoom.parseMessage(rtcJson) as? SharedRoom.WireMessage.Rtc
    assertNotNull(parsedRtc)
    assertEquals("peer-alice", parsedRtc!!.peerId)
    assertEquals("peer-bob", parsedRtc.targetPeerId)
    assertEquals("offer", parsedRtc.signalType)
    assertNull(
      SharedRoom.parseMessage(
        SharedRoom.serializeMessage(
          SharedRoom.WireMessage.Rtc("peer-a", "peer-a", "offer", sdp = "v=0")
        )
      )
    )

    val vgNear =
      SharedRoom.computeSpatialVoiceGain(
        doubleArrayOf(0.0, 1.6, 0.0),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        doubleArrayOf(0.0, 1.6, -1.0),
      )
    val vgRight =
      SharedRoom.computeSpatialVoiceGain(
        doubleArrayOf(0.0, 1.6, 0.0),
        doubleArrayOf(0.0, 0.0, 0.0, 1.0),
        doubleArrayOf(3.0, 1.6, 0.0),
      )
    assertEquals(1.0, vgNear.gain, 1e-4)
    assertEquals(0.0, vgNear.pan, 1e-4)
    assertTrue(vgRight.gain < 0.4)
    assertTrue(vgRight.pan > 0.9)

    val ikGltf =
      """{"asset":{"version":"2.0"},"nodes":[
        {"name":"Shoulder","translation":[0,0,0]},
        {"name":"Elbow","translation":[0,0.5,0]},
        {"name":"Wrist","translation":[0,1.0,0],"extras":{"xr":{"ik":{"solver":"two-bone","root":"Shoulder","mid":"Elbow","effector":"Wrist","target":[0.5,0.5,0],"pole":[0,1,0],"weight":0.5}}}}
      ]}"""
    val ikSession = XRLiveRuntimeSession(ikGltf)
    val head = XRPose()
    for (i in 0 until 10) {
      ikSession.step(0.016, head)
    }
    val shoulderPos = ikSession.nodeTransform(0)!!.translation
    val elbowPos = ikSession.nodeTransform(1)!!.translation
    val wristPos = ikSession.nodeTransform(2)!!.translation
    val seg1 =
      kotlin.math.sqrt(
        ((elbowPos[0] - shoulderPos[0]) * (elbowPos[0] - shoulderPos[0]) +
            (elbowPos[1] - shoulderPos[1]) * (elbowPos[1] - shoulderPos[1]) +
            (elbowPos[2] - shoulderPos[2]) * (elbowPos[2] - shoulderPos[2]))
          .toDouble()
      )
    val seg2 =
      kotlin.math.sqrt(
        ((wristPos[0] - elbowPos[0]) * (wristPos[0] - elbowPos[0]) +
            (wristPos[1] - elbowPos[1]) * (wristPos[1] - elbowPos[1]) +
            (wristPos[2] - elbowPos[2]) * (wristPos[2] - elbowPos[2]))
          .toDouble()
      )
    assertEquals(0.5, seg1, 1e-4)
    assertEquals(0.5, seg2, 1e-4)
    assertTrue(wristPos[0] > 0.1f)
  }

  @Test
  fun ikRotatesJointHierarchyAndChildrenFollow() {
    for (solver in listOf("two-bone", "fabrik")) {
      val session =
        XRLiveRuntimeSession(
          """{"asset":{"version":"2.0"},"scenes":[{"nodes":[0]}],"nodes":[
          {"name":"Shoulder","translation":[0,0,0],"children":[1,3]},
          {"name":"Elbow","translation":[0,0.5,0],"children":[2]},
          {"name":"Wrist","translation":[0,0.5,0],"extras":{"xr":{"ik":{"solver":"$solver","root":"Shoulder","mid":"Elbow","effector":"Wrist","target":[0.5,0.5,0],"pole":[1,0,0]}}}},
          {"name":"UpperLink","translation":[0,0.25,0]}
        ]}"""
        )
      for (f in 0 until 3) session.step(0.016, XRPose())
      val elbow = session.nodeWorldPosition(1)!!
      val wrist = session.nodeWorldPosition(2)!!
      val link = session.nodeWorldPosition(3)!!
      fun d(a: FloatArray, b: FloatArray) =
        Math.sqrt(
          ((a[0] - b[0]) * (a[0] - b[0]) +
              (a[1] - b[1]) * (a[1] - b[1]) +
              (a[2] - b[2]) * (a[2] - b[2]))
            .toDouble()
        )
      val origin = floatArrayOf(0f, 0f, 0f)
      assertEquals(
        "$solver wrist reaches target",
        0.0,
        d(wrist, floatArrayOf(0.5f, 0.5f, 0f)),
        2e-3,
      )
      assertEquals("$solver upper bone length", 0.5, d(elbow, origin), 1e-3)
      assertEquals("$solver lower bone length", 0.5, d(wrist, elbow), 1e-3)
      // UpperLink sits halfway along Shoulder->Elbow at rest, so it must follow the rotated joint.
      val mid = floatArrayOf(elbow[0] / 2, elbow[1] / 2, elbow[2] / 2)
      assertEquals("$solver child follows joint", 0.0, d(link, mid), 1e-3)
      if (solver == "two-bone") {
        assertTrue("pole bends the elbow toward +X: ${elbow.toList()}", elbow[0] > 0.4f)
        assertTrue(
          "Shoulder rotated",
          Math.abs(session.nodeTransform(0)!!.rotation[3] - 1f) > 1e-3f,
        )
      }
    }
  }

  @Test
  fun ikNamedPoleSceneRootAndEdgeCases() {
    val named =
      XRLiveSceneCoreHelper.parseIK(
        mapOf("root" to "A", "effector" to "C", "target" to "T", "poleTarget" to "P")
      )!!
    assertEquals("P", named.poleName)
    assertNull(named.pole)
    assertNull(
      XRLiveSceneCoreHelper.parseIK(mapOf("target" to "T", "poleTarget" to "P", "chainLength" to 2))
    )

    fun dist(a: DoubleArray, b: DoubleArray) =
      Math.sqrt(
        (a[0] - b[0]) * (a[0] - b[0]) +
          (a[1] - b[1]) * (a[1] - b[1]) +
          (a[2] - b[2]) * (a[2] - b[2])
      )
    fun pos(s: XRLiveRuntimeSession, i: Int) =
      s.nodeTransform(i)!!.translation.let {
        doubleArrayOf(it[0].toDouble(), it[1].toDouble(), it[2].toDouble())
      }

    // A literal pole goes through the scene root like the target: the elbow bends purely toward +Z.
    val chain =
      """{"name":"Shoulder","translation":[0,0,0]},{"name":"Elbow","translation":[0,0.5,0]},"""
    val rootSession =
      XRLiveRuntimeSession(
        """{"asset":{"version":"2.0"},"nodes":[$chain
        {"name":"Wrist","translation":[0,1,0],"extras":{"xr":{"ik":{"root":"Shoulder","mid":"Elbow","effector":"Wrist","target":[0.5,0.5,0],"pole":[0,0,1]}}}}]}"""
      )
    rootSession.rootTransform = translation(5.0, 0.0, 0.0)
    rootSession.step(0.016, XRPose())
    val elbow = pos(rootSession, 1)
    assertTrue("elbow=${elbow.toList()}", elbow[2] > 0.1)
    assertEquals(elbow[0], elbow[1], 1e-3)
    assertEquals(0.0, dist(pos(rootSession, 2), doubleArrayOf(0.5, 0.5, 0.0)), 1e-3)

    // A named pole resolves to the node's world position.
    for (pz in listOf(1.0, -1.0)) {
      val s =
        XRLiveRuntimeSession(
          """{"asset":{"version":"2.0"},"nodes":[$chain
          {"name":"ElbowPole","translation":[0,0.25,$pz]},
          {"name":"Wrist","translation":[0,1,0],"extras":{"xr":{"ik":{"root":"Shoulder","mid":"Elbow","effector":"Wrist","target":[0.5,0.5,0],"pole":"ElbowPole"}}}}]}"""
        )
      s.step(0.016, XRPose())
      assertEquals(pz, Math.signum(pos(s, 1)[2]), 0.0)
    }

    // Weighted blending of mirrored rest / solved poses never collapses a bone.
    val blendSession =
      XRLiveRuntimeSession(
        """{"asset":{"version":"2.0"},"nodes":[{"name":"Root","translation":[0,0,0]},
        {"name":"Tip","translation":[0,1,0],"extras":{"xr":{"ik":{"root":"Root","effector":"Tip","target":[0,-5,0],"solver":"fabrik","weight":0.5}}}}]}"""
      )
    blendSession.step(0.016, XRPose())
    assertEquals(1.0, dist(pos(blendSession, 1), pos(blendSession, 0)), 1e-4)

    // Solver edge cases.
    val o = doubleArrayOf(0.0, 0.0, 0.0)
    val unreach =
      IKSolver.solveTwoBoneIK(
        o,
        doubleArrayOf(0.0, 0.5, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
        doubleArrayOf(3.0, 0.0, 0.0),
      )
    assertEquals(1.0 - 1e-5, dist(unreach.effectorPos, o), 1e-4)
    assertEquals(0.5, dist(unreach.midPos, o), 1e-4)
    assertEquals(0.5, dist(unreach.effectorPos, unreach.midPos), 1e-4)
    val atRoot =
      IKSolver.solveTwoBoneIK(o, doubleArrayOf(0.0, 0.6, 0.0), doubleArrayOf(0.0, 1.0, 0.0), o)
    assertTrue(atRoot.midPos.all { it.isFinite() } && atRoot.effectorPos.all { it.isFinite() })
    assertEquals(0.2, dist(atRoot.effectorPos, o), 1e-3)
    val zero =
      IKSolver.solveTwoBoneIK(o, o, doubleArrayOf(0.0, 1.0, 0.0), doubleArrayOf(1.0, 0.0, 0.0))
    assertEquals(listOf(0.0, 0.0, 0.0, 1.0), zero.rootRotation.toList())
    assertEquals(listOf(0.0, 1.0, 0.0), zero.effectorPos.toList())
    val colinear =
      IKSolver.solveTwoBoneIK(
        o,
        doubleArrayOf(0.0, 0.5, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
        doubleArrayOf(0.5, 0.5, 0.0),
        doubleArrayOf(1.0, 1.0, 0.0),
      )
    assertTrue(Math.abs(colinear.midPos[2]) > 0.1)
    assertEquals(0.0, dist(colinear.effectorPos, doubleArrayOf(0.5, 0.5, 0.0)), 1e-4)
    val nanT =
      IKSolver.solveTwoBoneIK(
        o,
        doubleArrayOf(0.0, 0.5, 0.0),
        doubleArrayOf(0.0, 1.0, 0.0),
        doubleArrayOf(Double.NaN, 0.0, 0.0),
      )
    assertTrue(nanT.effectorPos.all { it.isFinite() } && nanT.rootRotation.all { it.isFinite() })
    assertEquals(0.0, dist(nanT.effectorPos, o), 1e-3)

    val fUnreach =
      IKSolver.solveFABRIK(
        listOf(o, doubleArrayOf(0.0, 1.0, 0.0), doubleArrayOf(0.0, 2.0, 0.0)),
        doubleArrayOf(5.0, 0.0, 0.0),
      )
    assertEquals(1, fUnreach.iterations)
    assertEquals(0.0, dist(fUnreach.positions[2], doubleArrayOf(2.0, 0.0, 0.0)), 1e-9)
    val fZero = IKSolver.solveFABRIK(listOf(o, o), doubleArrayOf(1.0, 0.0, 0.0))
    assertTrue(fZero.positions.all { dist(it, o) < 1e-9 })
    val stuck = listOf(o, doubleArrayOf(0.0, 1.0, 0.0))
    assertEquals(1, IKSolver.solveFABRIK(stuck, doubleArrayOf(0.0, 0.5, 0.0), 0).iterations)
    assertEquals(32, IKSolver.solveFABRIK(stuck, doubleArrayOf(0.0, 0.5, 0.0), 1000).iterations)
    assertEquals(
      0,
      IKSolver.solveFABRIK(
          listOf(o, doubleArrayOf(0.0, 1.0, 0.0), doubleArrayOf(1.0, 1.0, 0.0)),
          doubleArrayOf(1.0, 1.0, 0.0),
        )
        .iterations,
    )
  }

  private fun assertThrows(block: () -> Unit) {
    try {
      block()
      fail("expected IllegalArgumentException")
    } catch (expected: IllegalArgumentException) {
      // ok
    }
  }

  private fun putBytes(buf: ByteBuffer, offset: Int, vararg values: Int) {
    for ((i, v) in values.withIndex()) buf.put(offset + i, v.toByte())
  }

  private fun gzip(bytes: ByteArray): ByteArray {
    val bos = ByteArrayOutputStream()
    GZIPOutputStream(bos).use { it.write(bytes) }
    return bos.toByteArray()
  }

  private fun translation(x: Double, y: Double, z: Double): DoubleArray =
    DoubleArray(16).also {
      it[0] = 1.0
      it[5] = 1.0
      it[10] = 1.0
      it[15] = 1.0
      it[12] = x
      it[13] = y
      it[14] = z
    }

  private fun gltfWithGraph(graph: String, extra: String = ""): String =
    """{"nodes":[{"name":"A"},{"name":"B"}],"materials":[{}]$extra,
      "extensionsUsed":["KHR_interactivity"],"extensions":{"KHR_interactivity":$graph}}"""

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
     * Output of `compileInteractivityGraph()` + `upgradeGltfNodeXR()` from `three-live/src`
     * (generated with `node --experimental-strip-types`) for a scene with toggleVisibility,
     * toggleTransform, cycleMaterialColor, sendEvent / onReceive / onStart behaviors, a lazy HUD,
     * an orbiting moon, and a snow emitter.
     */
    const val CANONICAL_GLTF =
      """{"asset":{"version":"2.0"},"extensionsUsed":["KHR_interactivity"],"extensions":{"KHR_interactivity":{"graphs":[{"declarations":[{"op":"variable/get"},{"op":"math/not"},{"op":"variable/set"},{"op":"pointer/set"},{"op":"pointer/onSelect"},{"op":"pointer/interpolate"},{"op":"flow/branch"},{"op":"math/add"},{"op":"math/rem"},{"op":"flow/switch"},{"op":"event/send"},{"op":"event/onStart"},{"op":"event/receive"}],"nodes":[{"declaration":0,"configuration":{"variable":0}},{"declaration":1,"values":{"a":{"node":0,"socket":"value"}}},{"declaration":2,"configuration":{"variable":0},"values":{"value":{"node":1,"socket":"value"}},"flows":{"out":{"node":3}}},{"declaration":3,"configuration":{"pointer":"/nodes/0/extensions/KHR_node_visibility/visible"},"values":{"value":{"node":0,"socket":"value"}}},{"declaration":4,"configuration":{"nodeIndex":0},"flows":{"out":{"node":2}}},{"declaration":0,"configuration":{"variable":1}},{"declaration":1,"values":{"a":{"node":5,"socket":"value"}}},{"declaration":2,"configuration":{"variable":1},"values":{"value":{"node":6,"socket":"value"}},"flows":{"out":{"node":10}}},{"declaration":5,"configuration":{"pointer":"/nodes/1/translation"},"values":{"value":{"value":[1,2,0]},"duration":{"value":0.4}}},{"declaration":5,"configuration":{"pointer":"/nodes/1/translation"},"values":{"value":{"value":[1,0,0]},"duration":{"value":0.4}}},{"declaration":6,"values":{"condition":{"node":5,"socket":"value"}},"flows":{"true":{"node":8},"false":{"node":9}}},{"declaration":4,"configuration":{"nodeIndex":1},"flows":{"out":{"node":7}}},{"declaration":0,"configuration":{"variable":2}},{"declaration":7,"values":{"a":{"node":12,"socket":"value"},"b":{"value":1}}},{"declaration":8,"values":{"a":{"node":13,"socket":"value"},"b":{"value":3}}},{"declaration":2,"configuration":{"variable":2},"values":{"value":{"node":14,"socket":"value"}},"flows":{"out":{"node":19}}},{"declaration":3,"configuration":{"pointer":"/materials/1/pbrMetallicRoughness/baseColorFactor"},"values":{"value":{"value":[1,0,0,1]}}},{"declaration":3,"configuration":{"pointer":"/materials/1/pbrMetallicRoughness/baseColorFactor"},"values":{"value":{"value":[0,1,0,1]}}},{"declaration":3,"configuration":{"pointer":"/materials/1/pbrMetallicRoughness/baseColorFactor"},"values":{"value":{"value":[0,0,1,1]}}},{"declaration":9,"values":{"selection":{"node":12,"socket":"value"}},"flows":{"0":{"node":16},"1":{"node":17},"2":{"node":18}}},{"declaration":4,"configuration":{"nodeIndex":2},"flows":{"out":{"node":15}}},{"declaration":10,"configuration":{"event":0},"values":{"volume":{"value":0.5}}},{"declaration":4,"configuration":{"nodeIndex":3},"flows":{"out":{"node":21}}},{"declaration":3,"configuration":{"pointer":"/nodes/3/translation"},"values":{"value":{"value":[0,3,0]}}},{"declaration":11,"flows":{"out":{"node":23}}},{"declaration":3,"configuration":{"pointer":"/nodes/3/scale"},"values":{"value":{"value":[2,2,2]}}},{"declaration":12,"configuration":{"event":0},"flows":{"out":{"node":25}}}],"variables":[{"id":"__vis_0_0","type":"bool","value":true},{"id":"__toggle_1_0","type":"bool","value":false},{"id":"__color_idx_2_0","type":"int","value":0}],"events":[{"id":"ring"}]}],"graph":0}},"nodes":[{"name":"Lamp","mesh":0,"translation":[0,1,-2],"extras":{}},{"name":"Box","mesh":1,"translation":[1,0,0],"extras":{}},{"name":"Ball","mesh":2,"extras":{}},{"name":"Bell","extras":{}},{"name":"Hud","extras":{"xr":{"grab":"2-hand","grabbable":true,"follow":{"mode":"head","lazy":true,"distance":1.2,"deadzoneDeg":20,"stiffness":6,"height":-0.1,"faceUser":true,"snapOnStart":true},"holdToAsk":{"prompt":"What lamp is this?","holdMs":600}}},"extensions":{"MOZ_hubs_components":{"grabbable":{"cursor":true,"hand":true}},"ANDROID_xr_scenecore":{"interactable":{"mode":"2-hand"},"movable":{"systemMovable":true,"scaleInZ":false,"minScale":0.05,"maxScale":5},"follow":{"target":"head","lazy":true,"distance":1.2,"deadzoneDeg":20,"stiffness":6,"height":-0.1,"faceUser":true},"holdToAsk":{"prompt":"What lamp is this?","holdMs":600}}}},{"name":"Moon","extras":{"xr":{"follow":"head","orbit":{"target":"Lamp","radius":0.4,"speed":0.6,"height":0,"phase":0,"faceCenter":false},"handles":{"rotateAxis":"y","minScale":0.5,"maxScale":3},"splatUrl":"room.spz","spatialSlot":"info-card","audio":{"src":"hum.mp3","refDistance":1,"loop":true}}},"extensions":{"MOZ_hubs_components":{},"ANDROID_xr_scenecore":{"follow":{"target":"head","lazy":false},"orbit":{"target":"Lamp","radius":0.4,"speed":0.6,"height":0,"phase":0,"faceCenter":false},"resizable":{"rotateAxis":"y","minScale":0.5,"maxScale":3},"splat":{"url":"room.spz"},"spatialPanel":{"slot":"info-card"},"spatialAudio":{"src":"hum.mp3","refDistance":1,"loop":true}}}},{"name":"Snow","extras":{"xr":{"scale":{"min":0.5,"max":3},"scalable":true,"billboard":"capsule","anchor":"floor","physics":"static","particles":{"preset":"snow","count":2000,"area":[2,2,2],"speed":1},"worldUnderstanding":{"planes":true,"meshes":false,"reticle":true,"objects":false}}},"extensions":{"MOZ_hubs_components":{"billboard":{"onlyY":true}},"ANDROID_xr_scenecore":{"billboard":{"mode":"capsule"},"anchor":{"planeType":"HORIZONTAL","semanticType":"FLOOR"},"rigidbody":{"type":"static"},"particles":{"preset":"snow","count":2000,"area":[2,2,2],"speed":1},"worldUnderstanding":{"planes":true,"meshes":false,"reticle":true,"objects":false}}}}],"meshes":[{"primitives":[{"material":0}]},{"primitives":[{"material":0}]},{"primitives":[{"material":1}]}],"materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1]}},{"pbrMetallicRoughness":{"baseColorFactor":[0.5,0.5,0.5,1],"metallicFactor":0}}]}"""
  }
}
