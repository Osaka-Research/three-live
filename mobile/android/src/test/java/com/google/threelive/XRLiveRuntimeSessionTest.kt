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
 * Host-side JVM tests for the pure-Kotlin XR Blocks runtime: [MiniJson], canonical trait parsing,
 * the `KHR_interactivity` VM in [XRLiveRuntimeSession], and the math / geometry / decoder helpers.
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
    val src = mapOf("id" to "a\"b\n", "n" to 1.0, "f" to 0.5, "v" to doubleArrayOf(1.0, 2.5), "b" to true, "z" to null)
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
    assertEquals(XRWorldUnderstandingTrait(planes = true, meshes = false, reticle = true, objects = false), snow.worldUnderstanding)
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
    val lazy = XRLiveSceneCoreHelper.parseLazyFollow(mapOf("distance" to 99.0, "deadzoneDeg" to -5.0, "stiffness" to "x"))!!
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

    assertEquals("https://cdn.test/a.spz", XRLiveSceneCoreHelper.safeMediaUrl("https://cdn.test/a.spz"))
    assertEquals("scans/room.spz", XRLiveSceneCoreHelper.safeMediaUrl(" scans/room.spz "))
    for (bad in listOf("http://x.com/a", "//evil/a", "../a.spz", "a/../b", "a%2e.spz", "a\\b", "data:x", "https:///x", "")) {
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

  private class Recorder : XRLiveRuntimeSession.Listener {
    val transforms = ArrayList<Pair<Int, List<Float>>>()
    val visibility = ArrayList<Pair<Int, Boolean>>()
    val materials = ArrayList<Pair<Int, List<Float>>>()
    val events = ArrayList<Pair<String, String>>()
    val animations = ArrayList<String>()

    override fun onNodeTransformChanged(nodeIndex: Int, translation: FloatArray, rotation: FloatArray, scale: FloatArray) {
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
    val nodes =
      ptrs.mapIndexed { i, p ->
        """{"op":"pointer/set","configuration":{"pointer":"$p"},"values":{"value":{"value":[5,5,5,1]}},"flows":{"out":{"node":${i + 1}}}}"""
      }
    val graph = """{"nodes":[${nodes.joinToString(",")},{"op":"event/onStart","flows":{"out":{"node":0}}}]}"""
    val (s, r) = session(gltfWithGraph(graph))
    s.start()
    assertTrue(r.transforms.isEmpty())
    assertTrue(r.materials.isEmpty())
    for (p in ptrs) assertNull(p, s.readPointer(p))
    assertNotNull(s.readPointer("/nodes/0/translation"))
    assertNotNull(s.readPointer("/materials/0/emissiveFactor"))
    assertEquals(listOf("__proto__x", "a/b", "c~d"), XRLiveRuntimeSession.parseSafePointer("/__proto__x/a~1b/c~0d"))
    assertNull(XRLiveRuntimeSession.parseSafePointer("/a/__proto__"))
  }

  @Test
  fun graphSafetyLimitsDisableTheVm() {
    val many = (0..XRLiveRuntimeSession.MAX_GRAPH_NODES).joinToString(",") { """{"op":"flow/sequence"}""" }
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
    val hit = ManipulationHandles.pick(layout, doubleArrayOf(0.5, 0.5, 0.0), doubleArrayOf(0.0, 0.0, -1.0), opts)
    assertTrue(hit is ManipulationHandles.Hit.Corner)
    assertNull(ManipulationHandles.pick(layout, doubleArrayOf(10.0, 10.0, 0.0), doubleArrayOf(0.0, 0.0, -1.0), opts))

    val drag = ManipulationHandles.Drag(opts)
    val c = layout.corners[2]
    assertNotNull(
      drag.begin(layout, doubleArrayOf(c[0], c[1], 0.0), doubleArrayOf(0.0, 0.0, -1.0), doubleArrayOf(1.0, 1.0, 1.0), doubleArrayOf(0.0, 0.0, 0.0, 1.0))
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
    val yawDeg = Math.toDegrees(XRBlocksMath.yawFromQuat(q[0], q[1], q[2], q[3]))
    assertEquals(90.0, Math.abs(yawDeg), 1.0)
    assertArrayEquals(doubleArrayOf(1.0, 1.0, 1.0), rot.scale, 1e-9)
  }

  // =============================================================================================
  // World understanding
  // =============================================================================================

  @Test
  fun unprojectsDetections() {
    assertEquals(0.2, WorldUnderstanding.normalizeBox(doubleArrayOf(100.0, 200.0, 300.0, 400.0))!![1], 1e-12)
    assertEquals(0.2, WorldUnderstanding.normalizeBox(doubleArrayOf(0.5, 0.1, 0.2, 0.3))!![0], 1e-12)
    assertNull(WorldUnderstanding.normalizeBox(doubleArrayOf(Double.NaN, 0.0, 1.0, 1.0)))
    assertNull(WorldUnderstanding.normalizeBox(doubleArrayOf(0.0, 0.0, 1.0)))

    val proj = FloatArray(16)
    proj[0] = 1f
    proj[5] = 1f
    proj[10] = -1f
    proj[11] = -1f
    proj[14] = -0.2f
    val cam = FloatArray(16).also {
      it[0] = 1f
      it[5] = 1f
      it[10] = 1f
      it[15] = 1f
      it[13] = 1.6f
    }
    val center = WorldUnderstanding.unprojectDetection(doubleArrayOf(400.0, 400.0, 600.0, 600.0), cam, proj, 2.0, label = "cup")!!
    assertEquals(-2.0, center.z, 1e-3)
    assertEquals(1.6, center.y, 1e-3)
    assertEquals(0.0, center.x, 1e-3)
    assertEquals(WorldUnderstanding.DepthSource.DEPTH, center.depthSource)
    assertEquals(0.8, center.widthMeters, 1e-3)
    assertEquals("cup", center.label)

    val floor = WorldUnderstanding.TrackedPlane("horizontal", doubleArrayOf(0.0, 0.0, 0.0), doubleArrayOf(0.0, 1.0, 0.0), 10.0)
    val low = WorldUnderstanding.unprojectDetection(doubleArrayOf(900.0, 450.0, 1000.0, 550.0), cam, proj, null, listOf(floor))!!
    assertEquals(WorldUnderstanding.DepthSource.PLANE, low.depthSource)
    assertEquals(0.0, low.y, 0.01)
    val none = WorldUnderstanding.unprojectDetection(doubleArrayOf(0.0, 0.0, 1.0, 1.0), cam, proj, 0.01)!!
    assertEquals(WorldUnderstanding.DepthSource.FALLBACK, none.depthSource)
    assertEquals(-1.5, none.z, 1e-3)
    assertNull(WorldUnderstanding.hitTestPlanes(listOf(floor), doubleArrayOf(0.0, 1.0, 0.0), doubleArrayOf(0.0, 1.0, 0.0)))

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
      TubeStrokeBuilder.catmullRom(doubleArrayOf(0.0, 0.0, 0.0), doubleArrayOf(1.0, 0.0, 0.0), doubleArrayOf(2.0, 0.0, 0.0), doubleArrayOf(3.0, 0.0, 0.0), 0.5)
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
    val cross = doubleArrayOf(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
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
    for (p in listOf(doubleArrayOf(0.0, 0.0, 0.0), doubleArrayOf(0.1, 0.0, 0.0), doubleArrayOf(0.2, 0.0, 0.0), doubleArrayOf(0.1, 0.0001, 0.0), doubleArrayOf(0.0, 0.0002, 0.0))) {
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
      floatArrayOf(-0.4882952570915222f, 0.5619582533836365f, 0.4769076406955719f, 0.19902870059013367f, 1.0214452743530273f, -0.0944783091545105f),
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

    val proj = FloatArray(16).also {
      it[0] = 1f
      it[5] = 1f
      it[10] = -1f
      it[11] = -1f
    }
    val view = FloatArray(16).also {
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
    val badCount = bytes.copyOf().also { ByteBuffer.wrap(it).order(ByteOrder.LITTLE_ENDIAN).putInt(8, -1) }
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
  }

  @Test
  fun sortsSplatsBackToFront() {
    val persp = FloatArray(16).also {
      it[0] = 1f
      it[5] = 1f
      it[10] = 1f
      it[11] = -1f
    }
    val order = SplatParser.sortSplatsByDepth(3, floatArrayOf(0f, 0f, -1f, 0f, 0f, -5f, 0f, 0f, -3f), persp)
    assertArrayEquals(intArrayOf(1, 2, 0), order)

    // URL policy (mirrors web resolveSplatUrl vectors).
    assertNotNull(SplatParser.resolveSplatUrl("https://a.com/x.spz"))
    assertNull(SplatParser.resolveSplatUrl("javascript:alert(1)"))
    assertNull(SplatParser.resolveSplatUrl("data:application/octet-stream;base64,AA"))
    assertNull(SplatParser.resolveSplatUrl("http://evil.com/x.splat"))
    assertEquals("http://localhost:8080/x.spz", SplatParser.resolveSplatUrl("http://localhost:8080/x.spz"))
    assertEquals(
      "https://site.test/scans/room.spz",
      SplatParser.resolveSplatUrl("/scans/room.spz", "https://site.test/app/"),
    )
    assertNull(SplatParser.resolveSplatUrl("https://cdn.test/x.spz", "https://site.test/", false))
    assertNotNull(SplatParser.resolveSplatUrl("https://site.test/x.spz", "https://site.test/", false))
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
    val camId = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = 1f; it[15] = 1f }
    val nodeId = DoubleArray(16).also { it[0] = 1.0; it[5] = 1.0; it[10] = 1.0; it[15] = 1.0 }
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
    assertTrue("sends=${r.events.size}", r.events.size in 1..XRLiveRuntimeSession.MAX_STEPS_PER_INVOCATION)
  }

  @Test(timeout = 10_000)
  fun diamondValueChainsAreBounded() {
    // Each math/add reads the previous node twice: naive evaluation is 2^60.
    val n = 60
    val adds =
      (1..n).joinToString(",") { i -> """{"op":"math/add","values":{"a":{"node":${i - 1}},"b":{"node":${i - 1}}}}""" }
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
      session(gltfWithGraph("""{"nodes":[{"op":"event/onStart","flows":{"out":{"node":1}}},{"op":"flow/sequence","flows":{$self}}]}"""))
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
    assertThrows { val unused = XRLiveRuntimeSession("""{"nodes":[$nodes]}""") }
    val mats = (0..XRLiveRuntimeSession.MAX_MATERIALS).joinToString(",") { "{}" }
    assertThrows { val unused = XRLiveRuntimeSession("""{"materials":[$mats]}""") }

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
    val proj = FloatArray(16).also {
      it[0] = 1f
      it[5] = 1f
      it[10] = -1f
      it[11] = -1f
      it[14] = -0.2f
    }
    // Camera at (0, 1.6, 0) yawed +90° about +Y: it looks down -X.
    val cam = FloatArray(16).also {
      it[2] = -1f // column 0 = (0, 0, -1)
      it[5] = 1f // column 1 = (0, 1, 0)
      it[8] = 1f // column 2 = (1, 0, 0)
      it[13] = 1.6f
      it[15] = 1f
    }
    val d = WorldUnderstanding.unprojectDetection(doubleArrayOf(0.4, 0.4, 0.6, 0.6), cam, proj, 2.0)!!
    assertEquals(-2.0, d.x, 1e-6)
    assertEquals(1.6, d.y, 1e-6)
    assertEquals(0.0, d.z, 1e-6)
    // A box right of center lands toward -Z (the camera's right) when yawed +90°.
    val right = WorldUnderstanding.unprojectDetection(doubleArrayOf(0.4, 0.7, 0.6, 0.9), cam, proj, 2.0)!!
    assertTrue(right.z < -0.5)
    assertThrows { WorldUnderstanding.unprojectDetection(doubleArrayOf(0.4, 0.4, 0.6, 0.6), FloatArray(4), proj) }
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
    assertEquals("head", XRLiveSceneCoreHelper.parseLazyFollow(mapOf("target" to "hand-left"))!!.mode)
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
    val script = MiniJson.parseObjectOrNull(java.io.File(dir, "script.json").readText(Charsets.UTF_8))!!
    val expected = MiniJson.parseObjectOrNull(java.io.File(dir, "expected.json").readText(Charsets.UTF_8))!!

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
          val hp = MiniJson.asList(step["headPosition"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val hq = MiniJson.asList(step["headQuaternion"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val pose = XRPose(hp, hq)
          repeat(repeat) { session.step(dt, pose) }
        }
        "dragCorner" -> {
          val nodeIdx = (step["nodeIndex"] as Number).toInt()
          val localMin = MiniJson.asList(step["localMin"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val localMax = MiniJson.asList(step["localMax"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val cornerIdx = (step["cornerIndex"] as Number).toInt()
          val rayOrigin = MiniJson.asList(step["rayOrigin"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val rawDir = MiniJson.asList(step["rayDirection"])!!.map { (it as Number).toDouble() }.toDoubleArray()
          val dirLen = XRBlocksMath.len3(rawDir[0], rawDir[1], rawDir[2])
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
            ).toFloat()
          session.setNodeTransform(nodeIdx, scale = floatArrayOf(newScale, newScale, newScale))
        }
        "autoRotate" -> {
          val rad = (step["angleDeg"] as Number).toDouble() * Math.PI / 180.0
          val q = XRBlocksMath.quatFromYaw(rad)
          val root = DoubleArray(16)
          XRBlocksMath.mat4FromTRS(doubleArrayOf(0.0, 0.0, 0.0), q, doubleArrayOf(1.0, 1.0, 1.0), root)
          session.rootTransform = root
        }
        "detect" -> {
          val detJson = MiniJson.stringify(step["detections"])
          val boxes = ThreeLiveDetections.parse(detJson)
          val camWorld = MiniJson.asList(step["cameraWorld"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val proj = MiniJson.asList(step["projection"])!!.map { (it as Number).toFloat() }.toFloatArray()
          val depth = (step["depthMeters"] as Number).toDouble()
          detectionsOut = ThreeLiveDetections.detect(boxes, camWorld, proj, { _, _ -> depth }, emptyList())
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
      val ew = MiniJson.asList(en["worldPosition"])!!.map { (it as Number).toFloat() }.toFloatArray()
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
    val ebc = MiniJson.asList(em0["baseColorFactor"])!!.map { (it as Number).toFloat() }.toFloatArray()
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
    const val CANONICAL_GLTF = """{"asset":{"version":"2.0"},"extensionsUsed":["KHR_interactivity"],"extensions":{"KHR_interactivity":{"graphs":[{"declarations":[{"op":"variable/get"},{"op":"math/not"},{"op":"variable/set"},{"op":"pointer/set"},{"op":"pointer/onSelect"},{"op":"pointer/interpolate"},{"op":"flow/branch"},{"op":"math/add"},{"op":"math/rem"},{"op":"flow/switch"},{"op":"event/send"},{"op":"event/onStart"},{"op":"event/receive"}],"nodes":[{"declaration":0,"configuration":{"variable":0}},{"declaration":1,"values":{"a":{"node":0,"socket":"value"}}},{"declaration":2,"configuration":{"variable":0},"values":{"value":{"node":1,"socket":"value"}},"flows":{"out":{"node":3}}},{"declaration":3,"configuration":{"pointer":"/nodes/0/extensions/KHR_node_visibility/visible"},"values":{"value":{"node":0,"socket":"value"}}},{"declaration":4,"configuration":{"nodeIndex":0},"flows":{"out":{"node":2}}},{"declaration":0,"configuration":{"variable":1}},{"declaration":1,"values":{"a":{"node":5,"socket":"value"}}},{"declaration":2,"configuration":{"variable":1},"values":{"value":{"node":6,"socket":"value"}},"flows":{"out":{"node":10}}},{"declaration":5,"configuration":{"pointer":"/nodes/1/translation"},"values":{"value":{"value":[1,2,0]},"duration":{"value":0.4}}},{"declaration":5,"configuration":{"pointer":"/nodes/1/translation"},"values":{"value":{"value":[1,0,0]},"duration":{"value":0.4}}},{"declaration":6,"values":{"condition":{"node":5,"socket":"value"}},"flows":{"true":{"node":8},"false":{"node":9}}},{"declaration":4,"configuration":{"nodeIndex":1},"flows":{"out":{"node":7}}},{"declaration":0,"configuration":{"variable":2}},{"declaration":7,"values":{"a":{"node":12,"socket":"value"},"b":{"value":1}}},{"declaration":8,"values":{"a":{"node":13,"socket":"value"},"b":{"value":3}}},{"declaration":2,"configuration":{"variable":2},"values":{"value":{"node":14,"socket":"value"}},"flows":{"out":{"node":19}}},{"declaration":3,"configuration":{"pointer":"/materials/1/pbrMetallicRoughness/baseColorFactor"},"values":{"value":{"value":[1,0,0,1]}}},{"declaration":3,"configuration":{"pointer":"/materials/1/pbrMetallicRoughness/baseColorFactor"},"values":{"value":{"value":[0,1,0,1]}}},{"declaration":3,"configuration":{"pointer":"/materials/1/pbrMetallicRoughness/baseColorFactor"},"values":{"value":{"value":[0,0,1,1]}}},{"declaration":9,"values":{"selection":{"node":12,"socket":"value"}},"flows":{"0":{"node":16},"1":{"node":17},"2":{"node":18}}},{"declaration":4,"configuration":{"nodeIndex":2},"flows":{"out":{"node":15}}},{"declaration":10,"configuration":{"event":0},"values":{"volume":{"value":0.5}}},{"declaration":4,"configuration":{"nodeIndex":3},"flows":{"out":{"node":21}}},{"declaration":3,"configuration":{"pointer":"/nodes/3/translation"},"values":{"value":{"value":[0,3,0]}}},{"declaration":11,"flows":{"out":{"node":23}}},{"declaration":3,"configuration":{"pointer":"/nodes/3/scale"},"values":{"value":{"value":[2,2,2]}}},{"declaration":12,"configuration":{"event":0},"flows":{"out":{"node":25}}}],"variables":[{"id":"__vis_0_0","type":"bool","value":true},{"id":"__toggle_1_0","type":"bool","value":false},{"id":"__color_idx_2_0","type":"int","value":0}],"events":[{"id":"ring"}]}],"graph":0}},"nodes":[{"name":"Lamp","mesh":0,"translation":[0,1,-2],"extras":{}},{"name":"Box","mesh":1,"translation":[1,0,0],"extras":{}},{"name":"Ball","mesh":2,"extras":{}},{"name":"Bell","extras":{}},{"name":"Hud","extras":{"xr":{"grab":"2-hand","grabbable":true,"follow":{"mode":"head","lazy":true,"distance":1.2,"deadzoneDeg":20,"stiffness":6,"height":-0.1,"faceUser":true,"snapOnStart":true},"holdToAsk":{"prompt":"What lamp is this?","holdMs":600}}},"extensions":{"MOZ_hubs_components":{"grabbable":{"cursor":true,"hand":true}},"ANDROID_xr_scenecore":{"interactable":{"mode":"2-hand"},"movable":{"systemMovable":true,"scaleInZ":false,"minScale":0.05,"maxScale":5},"follow":{"target":"head","lazy":true,"distance":1.2,"deadzoneDeg":20,"stiffness":6,"height":-0.1,"faceUser":true},"holdToAsk":{"prompt":"What lamp is this?","holdMs":600}}}},{"name":"Moon","extras":{"xr":{"follow":"head","orbit":{"target":"Lamp","radius":0.4,"speed":0.6,"height":0,"phase":0,"faceCenter":false},"handles":{"rotateAxis":"y","minScale":0.5,"maxScale":3},"splatUrl":"room.spz","spatialSlot":"info-card","audio":{"src":"hum.mp3","refDistance":1,"loop":true}}},"extensions":{"MOZ_hubs_components":{},"ANDROID_xr_scenecore":{"follow":{"target":"head","lazy":false},"orbit":{"target":"Lamp","radius":0.4,"speed":0.6,"height":0,"phase":0,"faceCenter":false},"resizable":{"rotateAxis":"y","minScale":0.5,"maxScale":3},"splat":{"url":"room.spz"},"spatialPanel":{"slot":"info-card"},"spatialAudio":{"src":"hum.mp3","refDistance":1,"loop":true}}}},{"name":"Snow","extras":{"xr":{"scale":{"min":0.5,"max":3},"scalable":true,"billboard":"capsule","anchor":"floor","physics":"static","particles":{"preset":"snow","count":2000,"area":[2,2,2],"speed":1},"worldUnderstanding":{"planes":true,"meshes":false,"reticle":true,"objects":false}}},"extensions":{"MOZ_hubs_components":{"billboard":{"onlyY":true}},"ANDROID_xr_scenecore":{"billboard":{"mode":"capsule"},"anchor":{"planeType":"HORIZONTAL","semanticType":"FLOOR"},"rigidbody":{"type":"static"},"particles":{"preset":"snow","count":2000,"area":[2,2,2],"speed":1},"worldUnderstanding":{"planes":true,"meshes":false,"reticle":true,"objects":false}}}}],"meshes":[{"primitives":[{"material":0}]},{"primitives":[{"material":0}]},{"primitives":[{"material":1}]}],"materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1]}},{"pbrMetallicRoughness":{"baseColorFactor":[0.5,0.5,0.5,1],"metallicFactor":0}}]}"""
  }
}
