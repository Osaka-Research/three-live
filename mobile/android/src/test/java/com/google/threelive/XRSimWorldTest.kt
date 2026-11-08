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
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.JUnit4

@RunWith(JUnit4::class)
class XRSimWorldTest {

  private class Recorder : XRSimWorld.Listener {
    val events = ArrayList<Pair<String, Map<String, Any?>>>()
    val clips = ArrayList<String>()
    val instances = HashMap<String, DoubleArray>()
    val removed = ArrayList<String>()
    val cues = ArrayList<String>()

    override fun onSimEvent(type: String, detail: Map<String, Any?>) {
      events += type to detail
    }

    override fun onCharacterClip(clipName: String) {
      clips += clipName
    }

    override fun onInstancePose(
      instanceId: String,
      templateNodeIndex: Int,
      position: DoubleArray,
      quaternion: DoubleArray,
      visible: Boolean,
    ) {
      instances[instanceId] = position
    }

    override fun onInstanceRemoved(instanceId: String) {
      removed += instanceId
    }

    override fun onAudioCue(cue: String, pan: Double, gain: Double, pitch: Double) {
      cues += cue
    }

    fun count(type: String) = events.count { it.first == type }
  }

  /** Builds a glTF JSON with one cube mesh per entry of [nodes] that sets `cube`. */
  private fun gltf(vararg nodes: Map<String, Any?>): String {
    val meshes = ArrayList<String>()
    val accessors = ArrayList<String>()
    val nodeJson = nodes.map { n ->
      val parts = ArrayList<String>()
      parts += "\"name\":\"${n["name"]}\""
      (n["t"] as? List<*>)?.let { parts += "\"translation\":${it.joinToString(",", "[", "]")}" }
      (n["children"] as? List<*>)?.let { parts += "\"children\":${it.joinToString(",", "[", "]")}" }
      (n["cube"] as? Double)?.let { h ->
        parts += "\"mesh\":${meshes.size}"
        meshes += "{\"primitives\":[{\"attributes\":{\"POSITION\":${accessors.size}}}]}"
        accessors +=
          "{\"count\":24,\"type\":\"VEC3\",\"componentType\":5126,\"min\":[-$h,-$h,-$h],\"max\":[$h,$h,$h]}"
      }
      (n["xr"] as? String)?.let { parts += "\"extras\":{\"xr\":$it}" }
      parts.joinToString(",", "{", "}")
    }
    return "{\"asset\":{\"version\":\"2.0\"},\"nodes\":${nodeJson.joinToString(",", "[", "]")}," +
      "\"meshes\":${meshes.joinToString(",", "[", "]")},\"accessors\":${accessors.joinToString(",", "[", "]")}}"
  }

  private fun node(
    name: String,
    t: List<Double> = listOf(0.0, 0.0, 0.0),
    cube: Double? = null,
    xr: String? = null,
    children: List<Int>? = null,
  ): Map<String, Any?> =
    mapOf("name" to name, "t" to t, "cube" to cube, "xr" to xr, "children" to children)

  private fun world(
    json: String,
    configure: XRSimWorld.() -> Unit = {},
  ): Pair<XRSimWorld, Recorder> {
    val w = XRSimWorld(XRLiveRuntimeSession(json), json)
    val r = Recorder()
    w.listener = r
    w.configure()
    return w to r
  }

  private val head = XRPose(floatArrayOf(0f, 1.6f, 0f))

  private fun XRSimWorld.run(seconds: Double, pose: XRPose = head) {
    repeat(Math.round(seconds * 60).toInt()) { step(1.0 / 60, pose) }
  }

  @Test
  fun parsesAndClampsTraits() {
    val t =
      XRSimTraits.parse(
        MiniJson.parseObjectOrNull(
          """{"character":{"speed":99,"radius":2,"height":1,"cameraMode":"orbit",
             "clips":{"idle":"Idle","walk":""}},
             "agent":"patrol","integrity":250,"zone":{"size":3,"shape":"sphere","watchGroups":["a","a","b c"]},
             "spawner":" Crate ","objective":"checkpoint","audioCues":{"onTap":"confirm","onHit":"explosion"},
             "collidable":true}"""
        )
      )!!
    assertEquals(20.0, t.character!!.speed, 0.0)
    assertEquals(4.0, t.character!!.height, 0.0)
    assertEquals("third-person", t.character!!.cameraMode)
    assertEquals(mapOf("idle" to "Idle"), t.character!!.clips)
    assertEquals("patrol", t.agent!!.mode)
    assertEquals(250.0, t.integrity!!.max, 0.0)
    assertEquals(3.0, t.zone!!.radius, 0.0)
    assertEquals(listOf("a"), t.zone!!.watchGroups)
    assertEquals("Crate", t.spawner!!.template)
    assertEquals(0.0, t.objective!!.spinSpeed, 0.0)
    assertEquals(mapOf("onTap" to "confirm"), t.audioCues!!.cues)
    assertTrue(t.collidable)
    assertEquals(XRSimTraits.AGENT_TARGET_USER, XRSimTraits.parseAgent("chase")!!.target)
    assertNull(XRSimTraits.parse(MiniJson.parseObjectOrNull("""{"audio":{"onTap":"confirm"}}""")))
    assertNull(XRSimTraits.safeSimId("__proto__"))
    assertNull(XRSimTraits.parseSpawner(true))
    assertNull(XRSimTraits.parseIntegrity(0.0))
    val rb =
      XRSimTraits.parsePhysicsBody(
        MiniJson.parseObjectOrNull(
          """{"body":"dynamic","shape":"sphere","mass":9999,"restitution":2,"friction":-1}"""
        )
      )!!
    assertEquals("dynamic", rb.body)
    assertEquals("sphere", rb.shape)
    assertEquals(1000.0, rb.mass, 0.0)
    assertEquals(1.0, rb.restitution, 0.0)
    assertEquals(0.0, rb.friction, 0.0)
  }

  @Test
  fun rngAndHashMatchWeb() {
    // Values produced by the web runtime's mulberry32 / FNV-1a for the same inputs.
    val rng = XRSimWorld.makeRng(7)
    val first = rng()
    assertTrue(first in 0.0..1.0)
    assertEquals(first, XRSimWorld.makeRng(7)(), 0.0)
    assertEquals(0x811c9dc5L, XRSimWorld.hashString(""))
    assertTrue(XRSimWorld.hashString("node:1") != XRSimWorld.hashString("node:2"))
  }

  @Test
  fun characterMovesCollidesJumpsAndHidesInFirstPerson() {
    val json =
      gltf(
        node(
          "Hero",
          children = listOf(1),
          xr =
            """{"character":{"speed":4,"radius":0.3,
          "clips":{"idle":"Idle","walk":"Walk","run":"Run","jump":"Jump"}}}""",
        ),
        node("HeroMesh", t = listOf(0.0, 0.25, 0.0), cube = 0.25),
        node("Wall", t = listOf(0.0, 0.5, -3.0), cube = 0.5, xr = """{"collidable":true}"""),
      )
    val (w, r) = world(json)
    val hero = w.body("Hero")!!
    w.moveZ = 1.0
    w.run(2.5)
    assertTrue(
      "stopped by wall at ${hero.pos[2]}",
      hero.pos[2] >= -2.2 - 1e-3 && hero.pos[2] < -2.0,
    )
    assertEquals(Math.PI, Math.abs(hero.yaw), 1e-3)
    assertTrue(r.clips.contains("Walk"))
    val wp = w.session.nodeWorldPosition(0)!!
    assertEquals(hero.pos[2], wp[2].toDouble(), 1e-4)
    w.moveZ = 0.0
    w.run(1.0)
    assertEquals("Idle", r.clips.last())
    w.jump()
    w.run(0.1)
    assertEquals(1, r.count("characterjump"))
    w.run(1.5)
    assertEquals(1, r.count("characterland"))
    assertEquals(0.0, hero.pos[1], 1e-9)
    assertNotNull(CharacterController.cameraTarget(w))
    w.characterMode = "first-person"
    w.run(0.05)
    assertFalse(w.session.isVisible(0))
    w.characterMode = "none"
    val z = hero.pos[2]
    w.moveZ = -1.0
    w.run(0.5)
    assertEquals(z, hero.pos[2], 0.0)
  }

  @Test
  fun agentsChaseFleePatrolAndReach() {
    val json =
      gltf(
        node("Target", t = listOf(0.0, 0.5, 0.0), cube = 0.25, xr = """{"integrity":100}"""),
        node(
          "Drone",
          t = listOf(5.0, 0.5, 0.0),
          cube = 0.2,
          xr =
            """{"agent":{"mode":"chase","target":"Target","sightRadius":0,"speed":3,"stopDistance":0.5}}""",
        ),
        node(
          "Guard",
          t = listOf(-4.0, 0.5, -4.0),
          cube = 0.2,
          xr =
            """{"agent":{"mode":"patrol","speed":4,"turnSpeed":50,"waypoints":[[-4,0.5,4],[4,0.5,4]],"loopWaypoints":false}}""",
        ),
      )
    val (w, r) = world(json)
    w.run(7.0)
    val d = w.body("Drone")!!
    assertTrue(Math.hypot(d.pos[0], d.pos[2]) <= 0.55)
    assertTrue(r.count("agentreach") >= 1)
    val g = w.body("Guard")!!
    assertTrue(Math.hypot(g.pos[0] - 4, g.pos[2] - 4) <= 0.5)
    assertEquals(
      "idle",
      r.events
        .last { it.first == "agentstatechange" && it.second["nodeId"] == "Guard" }
        .second["state"],
    )
    val plain = SteeringAgents.resolveTarget(w, "Plain")
    assertNull("unknown node", plain)
    val json2 =
      gltf(
        node("Post", t = listOf(2.0, 0.0, 3.0), cube = 0.1),
        node(
          "Dog",
          cube = 0.1,
          xr = """{"agent":{"mode":"follow","target":"Post","stopDistance":0.5}}""",
        ),
      )
    val (w2, _) = world(json2)
    w2.run(4.0)
    val dog = w2.body("Dog")!!
    assertEquals(0.5, Math.hypot(dog.pos[0] - 2, dog.pos[2] - 3), 0.06)
    assertEquals("wander", SteeringAgents.chooseState(XRAgentTrait(mode = "chase"), 8.0, false))
    assertEquals(
      "chase",
      SteeringAgents.chooseState(XRAgentTrait(mode = "chase", sightRadius = 0.0), 99.0, false),
    )
    assertEquals("idle", SteeringAgents.chooseState(XRAgentTrait(mode = "follow"), 8.0, false))
  }

  @Test
  fun hitZonesFireSpawnAndTrackZones() {
    val json =
      gltf(
        node(
          "Target",
          t = listOf(0.0, 1.6, -5.0),
          cube = 0.3,
          xr = """{"integrity":{"max":50,"group":"enemy","scoreValue":10,"cooldownMs":0}}""",
        ),
        node(
          "Spawner",
          t = listOf(3.0, 0.0, 0.0),
          xr = """{"spawner":{"template":"Crate","intervalSec":0.5,"maxActive":2,"totalCount":3}}""",
        ),
        node("Crate", t = listOf(8.0, 0.25, 8.0), cube = 0.25, xr = """{"integrity":10}"""),
        node("Cell", t = listOf(0.0, 1.6, -5.0), xr = """{"zone":{"size":[1,1,1]}}"""),
      )
    val (w, r) =
      world(json) {
        hitMode = "projectile"
        fireRate = 10.0
      }
    val target = w.body("Target")!!
    w.fire()
    w.run(0.6)
    assertEquals(25.0, target.integrity, 0.0)
    assertEquals(1, r.count("xrzoneenter"))
    w.fire()
    w.run(0.6)
    assertTrue(target.hidden)
    assertEquals(1, r.count("xrdepleted"))
    assertEquals(1, r.count("xrzoneexit"))
    assertFalse(w.session.isVisible(0))
    assertTrue(w.body("Crate")!!.isTemplate)
    w.run(0.4)
    assertEquals(2, r.instances.size)
    val inst = w.bodies.first { it.isInstance }
    HitZones.applyHit(w, inst, 100.0, null, null)
    w.run(1.1)
    assertEquals(listOf(inst.name), r.removed)
    assertEquals(3, r.count("xrspawn"))
    w.run(2.0)
    assertEquals(3, r.count("xrspawn"))

    w.hitMode = "hitscan"
    w.reset()
    assertEquals(50.0, target.integrity, 0.0)
    assertTrue(w.session.isVisible(0))
    w.select(0, doubleArrayOf(0.0, 1.6, -4.7))
    assertEquals(25.0, target.integrity, 0.0)
  }

  @Test
  fun objectivesScoreOrderAndEnd() {
    val json =
      gltf(
        node("Hero", children = listOf(1), xr = """{"character":{"speed":4}}"""),
        node("HeroMesh", t = listOf(0.0, 0.5, 0.0), cube = 0.25),
        node(
          "Coin",
          t = listOf(0.0, 0.5, -1.5),
          cube = 0.1,
          xr = """{"objective":{"amount":10}}""",
        ),
        node(
          "Step2",
          t = listOf(0.0, 0.5, -3.0),
          cube = 0.1,
          xr = """{"objective":{"type":"checkpoint","order":2,"required":true,"amount":0}}""",
        ),
        node(
          "Step1",
          t = listOf(0.0, 0.5, -4.5),
          cube = 0.1,
          xr = """{"objective":{"type":"checkpoint","order":1,"required":true,"amount":5}}""",
        ),
      )
    val (w, r) =
      world(json) {
        objectivesEnabled = true
        scenarioTimerSec = 30.0
      }
    w.moveZ = 1.0
    w.run(1.3)
    assertEquals(15.0, Objectives.scenario(w)!!.score, 0.0)
    assertEquals(1, r.events.count { it.first == "xrobjective" && it.second["outOfOrder"] == true })
    assertTrue(w.body("Step1")!!.hidden)
    w.moveZ = -1.0
    var i = 0
    while (!w.ended && i++ < 60) w.run(0.05)
    val end = r.events.last { it.first == "xrscenarioend" }.second
    assertEquals("pass", end["outcome"])
    assertEquals(15.0, end["finalScore"])
    w.reset()
    assertFalse(w.ended)
    assertFalse(w.body("Coin")!!.hidden)
  }

  @Test
  fun synthAudioRecipesAndCues() {
    for (cue in XRSimTraits.AUDIO_CUES) {
      val pcm = SynthAudio.renderPcm(cue, 22050)
      assertTrue("$cue renders", pcm.size > 100)
      assertTrue("$cue is audible", pcm.any { Math.abs(it.toInt()) > 1000 })
    }
    assertTrue(SynthAudio.renderPcm("pickup").contentEquals(SynthAudio.renderPcm("pickup")))
    val json =
      gltf(
        node(
          "Left",
          t = listOf(-3.0, 1.6, 0.0),
          cube = 0.1,
          xr = """{"audioCues":{"onTap":"confirm"}}""",
        )
      )
    val (w, r) = world(json) { audioEnabled = true }
    w.step(0.0, head)
    assertTrue(SynthAudio.spatialize(w, doubleArrayOf(-3.0, 1.6, 0.0))[0] < -0.9)
    w.select(0)
    assertEquals(listOf("confirm"), r.cues)
    w.audioEnabled = false
    w.select(0)
    assertEquals(1, r.cues.size)
  }

  @Test
  fun bodiesLiveInSceneSpaceUnderAMovedSceneRoot() {
    val json =
      gltf(
        node(
          "Bot",
          t = listOf(0.0, 0.0, 0.0),
          cube = 0.2,
          xr = """{"agent":{"mode":"patrol","speed":1,"waypoints":[[0,0,0],[2,0,0]]}}""",
        )
      )
    val session = XRLiveRuntimeSession(json)
    val w = XRSimWorld(session, json)
    // Scene root: uniform scale 2, then a 10 m shift along X (as a renderer's model scale or AR
    // placement would apply).
    session.rootTransform =
      doubleArrayOf(2.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 10.0, 0.0, 0.0, 1.0)
    w.run(1.0, XRPose(floatArrayOf(10f, 3.2f, 8f)))
    val bot = w.bodies.first { it.name == "Bot" }
    assertTrue("bot moved in scene space", bot.pos[0] > 0.5)
    val m = DoubleArray(16)
    assertTrue(session.nodeWorldMatrix(0, m))
    assertEquals(10.0 + 2 * bot.pos[0], m[12], 1e-6)
    // The head is converted into scene space too.
    val head = w.headPosition()
    assertEquals(0.0, head[0], 1e-5)
    assertEquals(1.6, head[1], 1e-5)
    assertEquals(4.0, head[2], 1e-5)
    assertEquals(10.0 + 2 * bot.pos[0], w.sceneToWorld(bot.pos)[0], 1e-9)
  }

  /** Records the [XRSimRenderBridge] renderer calls. */
  private class SimFakeRenderer : ThreeLiveSceneRenderer {
    override var listener: ThreeLiveRendererListener? = null
    val meshes = HashMap<Int, FloatArray>()
    val transforms = HashMap<Int, FloatArray>()
    val instances = HashMap<Int, Int>()
    val instancePoses = HashMap<Int, FloatArray>()
    val nodeFlashes = ArrayList<Pair<Int, Boolean>>()
    val follows = ArrayList<Triple<DoubleArray?, Double, Boolean>>()
    private var next = 1

    override fun load(glb: ByteBuffer) {}

    override fun dispose() {}

    override fun setCameraOptions(options: ThreeLiveCameraOptions) {}

    override fun setNodeTransform(
      nodeIndex: Int,
      translation: FloatArray,
      rotation: FloatArray,
      scale: FloatArray,
    ) {}

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
    ): Int = next++.also { meshes[it] = color }

    override fun setDynamicMeshTransform(meshId: Int, matrix: FloatArray) {
      transforms[meshId] = matrix.copyOf()
    }

    override fun setDynamicMeshColor(meshId: Int, color: FloatArray) {
      meshes[meshId] = color
    }

    override fun removeDynamicMesh(meshId: Int) {
      meshes.remove(meshId)
      transforms.remove(meshId)
    }

    override fun instantiateNode(templateNodeIndex: Int): Int =
      next++.also { instances[it] = templateNodeIndex }

    override fun setInstancePose(instanceId: Int, position: FloatArray, rotation: FloatArray) {
      instancePoses[instanceId] = position.copyOf()
    }

    override fun removeInstance(instanceId: Int) {
      instances.remove(instanceId)
    }

    override fun setNodeFlash(nodeIndex: Int, on: Boolean) {
      nodeFlashes += nodeIndex to on
    }

    override fun setCameraFollow(
      target: DoubleArray?,
      polarDeg: Double,
      distance: Double,
      reframe: Boolean,
    ) {
      follows += Triple(target?.copyOf(), polarDeg, reframe)
    }

    /** Meshes with a non-zero transform (shown). */
    fun shown(): Int = transforms.count { (id, m) -> id in meshes && m.any { it != 0f } }
  }

  @Test
  fun renderBridgeDrawsInstancesCameraAndVisuals() {
    val json =
      gltf(
        node(
          "Hero",
          cube = 0.25,
          xr =
            """{"character":{"speed":3},"integrity":{"max":50,"group":"player","showBar":true}}""",
        ),
        node(
          "Crate",
          t = listOf(0.0, 0.0, 3.0),
          cube = 0.2,
          xr = """{"integrity":{"max":50,"group":"targets","showBar":true}}""",
        ),
        node(
          "Bot",
          t = listOf(3.0, 0.0, -3.0),
          cube = 0.2,
          xr = """{"integrity":{"max":10,"group":"bots"}}""",
        ),
        node(
          "Spawner",
          t = listOf(3.0, 0.0, -3.0),
          xr = """{"spawner":{"template":"Bot","intervalSec":0.5,"maxActive":2,"totalCount":2}}""",
        ),
        node("Cell", t = listOf(-2.0, 1.0, 0.0), xr = """{"zone":{"size":2,"color":"#ff3300"}}"""),
      )
    val fake = SimFakeRenderer()
    lateinit var bridge: XRSimRenderBridge
    val (w, _) = world(json) { hitMode = "projectile" }
    w.listener =
      object : XRSimWorld.Listener {
        override fun onInstancePose(
          instanceId: String,
          templateNodeIndex: Int,
          position: DoubleArray,
          quaternion: DoubleArray,
          visible: Boolean,
        ) = bridge.onInstancePose(instanceId, templateNodeIndex, position, quaternion, visible)

        override fun onInstanceRemoved(instanceId: String) = bridge.onInstanceRemoved(instanceId)
      }
    bridge = XRSimRenderBridge(w, fake)
    val pose = XRPose(floatArrayOf(0f, 1.6f, 4f))
    fun frames(n: Int) =
      repeat(n) {
        w.step(1.0 / 60, pose)
        bridge.sync()
      }
    frames(2)
    // Third-person follow: reframed once, then followed every frame.
    assertTrue(fake.follows.first().third)
    assertFalse(fake.follows.last().third)
    assertEquals(0.0, fake.follows.last().first!![0], 1e-9)
    // Two bars (bg + fill each) and one zone outline.
    assertEquals(5, fake.shown())
    w.fire()
    frames(1)
    assertEquals("projectile drawn", 6, fake.shown())
    // Spawns at 0.5 s and 1.0 s.
    frames(70)
    assertTrue("crate flashed", fake.nodeFlashes.contains(1 to true))
    assertTrue("flash ended", fake.nodeFlashes.contains(1 to false))
    assertEquals(2, fake.instances.size)
    assertEquals(2, fake.instancePoses.size)
    bridge.dispose()
    assertTrue(fake.meshes.isEmpty())
    assertTrue(fake.instances.isEmpty())
    assertNull(fake.follows.last().first)
  }

  @Test
  fun orbitFollowOverridesTargetAndFramesInPolarDegrees() {
    val orbit = OrbitCameraState()
    orbit.setBounds(doubleArrayOf(0.0, 0.0, 0.0), 10.0)
    orbit.follow(doubleArrayOf(1.0, 2.0, 3.0))
    assertArrayEquals(doubleArrayOf(1.0, 2.0, 3.0), orbit.target(), 0.0)
    orbit.frameFollow(90.0, 0.05)
    orbit.snap()
    assertEquals(0.0, orbit.phi, 1e-9)
    // Bounds limits do not clamp the first-person distance.
    assertEquals(0.05, orbit.distance, 1e-9)
    // Host camera options do not undo the follow framing.
    orbit.applyOptions(ThreeLiveCameraOptions(cameraOrbit = "0deg 75deg 4m"))
    orbit.snap()
    assertEquals(0.05, orbit.distance, 1e-9)
    orbit.follow(null)
    assertArrayEquals(doubleArrayOf(0.0, 0.0, 0.0), orbit.target(), 0.0)
  }

  /** Deep comparison with a numeric tolerance (goldens round to 1e-6). */
  private fun assertNear(path: String, expected: Any?, actual: Any?) {
    when (expected) {
      is Number -> {
        assertTrue("$path: expected number, got $actual", actual is Number)
        assertEquals(path, expected.toDouble(), (actual as Number).toDouble(), 1e-4)
      }
      is List<*> -> {
        val a = actual as? List<*> ?: error("$path: expected list, got $actual")
        assertEquals("$path size", expected.size, a.size)
        expected.forEachIndexed { i, e -> assertNear("$path[$i]", e, a[i]) }
      }
      is Map<*, *> -> {
        val a = actual as? Map<*, *> ?: error("$path: expected object, got $actual")
        assertEquals(
          "$path keys",
          expected.keys.map { "$it" }.sorted(),
          a.keys.map { "$it" }.sorted(),
        )
        for ((k, e) in expected) assertNear("$path.$k", e, a[k])
      }
      else -> assertEquals(path, expected, actual)
    }
  }

  @Test
  fun matchesWebParityGoldens() {
    val dir =
      listOf(
          java.io.File("testdata/golden"),
          java.io.File("../../testdata/golden"),
          java.io.File("experimental/users/binghamj/three_live/testdata/golden"),
        )
        .firstOrNull { java.io.File(it, "sim_scene.json").isFile }
        ?: error("testdata/golden/sim_scene.json not found")
    for ((sceneFile, expectedFile) in
      listOf(
        "sim_scene.json" to "sim_expected.json",
        "sim_visuals_scene.json" to "sim_visuals_expected.json",
        "sim_physics_scene.json" to "sim_physics_expected.json",
      )) {
      val scene = MiniJson.parseObjectOrNull(java.io.File(dir, sceneFile).readText())!!
      val expected = MiniJson.parseObjectOrNull(java.io.File(dir, expectedFile).readText())!!
      val actual = XRSimParity.run(scene)
      assertNear(sceneFile, expected, actual)
    }
  }

  @Test
  fun mechanicalJointsArticulateClampAndReset() {
    assertNull(XRSimTraits.parseJoint(null))
    assertNull(XRSimTraits.parseJoint(false))
    assertNull(XRSimTraits.parseJoint("none"))
    assertNull(XRSimTraits.parseJoint("unknown"))
    assertEquals("hinge", XRSimTraits.parseJoint(true)!!.type)
    assertEquals("hinge", XRSimTraits.parseJoint("revolute")!!.type)
    assertEquals("slider", XRSimTraits.parseJoint("prismatic")!!.type)
    assertEquals("spring", XRSimTraits.parseJoint("distance")!!.type)
    assertEquals("ball", XRSimTraits.parseJoint("spherical")!!.type)

    val parsed =
      XRSimTraits.parseJoint(
        MiniJson.parseObjectOrNull(
          """{"kind":"hinge","connectedBody":"WORLD","pivot":[0.5,0,-0.25],"axis":"-x","limits":[90,-45],"motorSpeed":3}"""
        )
      )!!
    assertEquals("", parsed.target)
    assertArrayEquals(doubleArrayOf(-1.0, 0.0, 0.0), parsed.axis, 1e-9)
    assertArrayEquals(doubleArrayOf(-45.0, 90.0), parsed.limits!!, 1e-9)
    assertEquals(50.0, parsed.motorMaxForce, 1e-9)

    val json =
      gltf(
        node(
          "DoorY",
          t = listOf(0.0, 1.0, 0.0),
          cube = 0.2,
          xr =
            """{"joint":{"type":"hinge","anchor":[-0.5,0,0],"axis":"y","limits":[-30,45],"motorSpeed":4,"motorMaxForce":100}}""",
        ),
        node(
          "FlapX",
          t = listOf(2.0, 1.0, 0.0),
          cube = 0.2,
          xr =
            """{"joint":{"type":"hinge","anchor":[0,0.3,0],"axis":"x","limits":[-60,60],"motorSpeed":3,"motorMaxForce":80}}""",
        ),
        node(
          "SliderDrawer",
          t = listOf(-2.0, 1.0, 0.0),
          cube = 0.2,
          xr =
            """{"joint":{"type":"slider","axis":"x","limits":[-0.2,0.35],"motorSpeed":2,"motorMaxForce":80}}""",
        ),
        node(
          "StiffSpring",
          t = listOf(2.0, 2.0, -2.0),
          cube = 0.15,
          xr =
            """{"rigidBody":{"body":"dynamic","mass":0.2},"joint":{"type":"spring","anchor":[0,0.5,0],"restLength":0.3,"stiffness":10000,"damping":100}}""",
        ),
        node(
          "TwinA",
          t = listOf(-2.0, 2.0, 2.0),
          cube = 0.15,
          xr = """{"rigidBody":{"body":"dynamic","mass":1,"gravityScale":0}}""",
        ),
        node(
          "TwinB",
          t = listOf(-0.8, 2.0, 2.0),
          cube = 0.15,
          xr =
            """{"rigidBody":{"body":"dynamic","mass":1,"gravityScale":0},"joint":{"type":"spring","target":"TwinA","restLength":0.4,"stiffness":60,"damping":8}}""",
        ),
        node(
          "BallBob",
          t = listOf(2.35, 1.5, 2.0),
          cube = 0.15,
          xr = """{"constraint":{"type":"ball","anchor":[-0.35,0.5,0],"limits":[-25,25],"damping":2}}""",
        ),
      )
    val (w, _) = world(json)
    w.run(1.2)

    val doorY = w.body("DoorY")!!
    val flapX = w.body("FlapX")!!
    val slider = w.body("SliderDrawer")!!
    val stiff = w.body("StiffSpring")!!
    val twinA = w.body("TwinA")!!
    val twinB = w.body("TwinB")!!
    val ballBob = w.body("BallBob")!!

    assertEquals(Math.toRadians(45.0), doorY.yaw, 0.02)
    assertTrue("X-axis hinge rotates body.rot", Math.abs(flapX.rot[0]) > 0.25 && flapX.rot[3].isFinite())
    assertEquals(-2.0 + 0.35, slider.pos[0], 0.02)
    assertTrue("L-stable stiff spring stays finite", stiff.pos.all { it.isFinite() } && Math.abs(stiff.pos[1] - 2.2) < 0.1)
    assertTrue("TwinA & TwinB pull symmetrically", twinA.pos[0] > -1.85 && twinB.pos[0] < -0.95)
    assertEquals(-2.8, twinA.pos[0] + twinB.pos[0], 0.02)
    assertTrue("BallBob swings inward", ballBob.pos[0] < 2.35 && ballBob.pos[1].isFinite())

    assertTrue(RigidBodyPhysics.applyImpulse(w, slider, doubleArrayOf(-8.0, 0.0, 0.0)))
    w.run(0.15)
    assertTrue("Impulse moves joint-only slider", slider.pos[0] < -1.66)

    w.reset()
    assertEquals(0.0, doorY.yaw, 1e-9)
    assertArrayEquals(doubleArrayOf(0.0, 0.0, 0.0, 1.0), flapX.rot, 1e-9)
    assertArrayEquals(doubleArrayOf(-2.0, 1.0, 0.0), slider.pos, 1e-9)
  }
}
