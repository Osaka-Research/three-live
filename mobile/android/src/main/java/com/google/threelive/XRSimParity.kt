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
 * Steps the shared `testdata/golden/sim_scene.json` parity scene with the same schedule as the web
 * (`xr_sim_test.ts`) and iOS runners, returning checkpoint poses and event counts in the
 * `sim_expected.json` shape.
 */
object XRSimParity {
  private fun r6(v: Double): Double = Math.round(v * 1e6) / 1e6

  private fun r6(v: DoubleArray): List<Double> = v.map { r6(it) }

  private fun r6(v: FloatArray): List<Double> = v.map { r6(it.toDouble()) }

  /** Renderer-independent summary of [HitZones.visuals] (same shape as `xr_sim_test.ts`). */
  @JvmStatic
  fun visualsSummary(world: XRSimWorld): Map<String, Any?> {
    val v = HitZones.visuals(world)
    return mapOf(
      "flashing" to v.flashing.map { it.name },
      "projectiles" to v.projectiles.map { r6(it) },
      "fragments" to v.fragments.map { r6(it.pos) },
      "bars" to
        v.bars.map {
          mapOf(
            "name" to it.body.name,
            "center" to r6(it.center),
            "yaw" to r6(it.yaw),
            "width" to r6(it.width),
            "frac" to r6(it.frac),
            "color" to r6(it.color),
          )
        },
      "zones" to
        v.zones.map {
          mapOf(
            "name" to it.body.name,
            "center" to r6(it.center),
            "yaw" to r6(it.yaw),
            "size" to r6(it.size),
            "color" to r6(it.color),
          )
        },
    )
  }

  /** Summary of [CharacterController.cameraRig], or `null`. */
  @JvmStatic
  fun cameraSummary(world: XRSimWorld): Map<String, Any?>? {
    val rig = CharacterController.cameraRig(world) ?: return null
    return mapOf(
      "mode" to rig.mode,
      "target" to r6(rig.target),
      "phiDeg" to r6(rig.phiDeg),
      "distance" to r6(rig.distance),
    )
  }

  @JvmStatic
  fun run(scene: Map<String, Any?>): Map<String, Any?> {
    val json = MiniJson.stringify(scene["gltf"])
    val world = XRSimWorld(XRLiveRuntimeSession(json), json)
    val cfg = MiniJson.asMap(scene["config"]) ?: emptyMap()
    (cfg["hitMode"] as? String)?.let { world.hitMode = it }
    world.objectivesEnabled = cfg["objectives"] == true
    (cfg["attempts"] as? Number)?.let { world.attempts = it.toInt() }
    (cfg["scenarioTimer"] as? Number)?.let { world.scenarioTimerSec = it.toDouble() }
    (cfg["targetScore"] as? Number)?.let { world.targetScore = it.toDouble() }
    val events = LinkedHashMap<String, Int>()
    for (e in MiniJson.asList(scene["events"]).orEmpty()) events[e as String] = 0
    world.listener =
      object : XRSimWorld.Listener {
        override fun onSimEvent(type: String, detail: Map<String, Any?>) {
          events[type]?.let { events[type] = it + 1 }
        }
      }
    val hp = MiniJson.asMap(scene["headPose"]) ?: emptyMap()
    val p = MiniJson.asList(hp["position"]).orEmpty().map { (it as Number).toFloat() }
    val q = MiniJson.asList(hp["quaternion"]).orEmpty().map { (it as Number).toFloat() }
    val head = XRPose(p.toFloatArray(), q.toFloatArray())
    val frames = (scene["frames"] as Number).toInt()
    val inputs = MiniJson.asList(scene["inputs"]).orEmpty().mapNotNull { MiniJson.asMap(it) }
    val checkpoints = MiniJson.asList(scene["checkpoints"]).orEmpty().map { (it as Number).toInt() }
    val out = ArrayList<Map<String, Any?>>()
    val dt = 1.0 / 60
    val inputAtZero = inputs.any { (it["frame"] as Number).toInt() == 0 }
    for (f in 0 until frames) {
      for (inp in inputs.filter { (it["frame"] as Number).toInt() == f }) {
        if (f == 0) world.step(dt, head)
        world.moveX = (inp["moveX"] as? Number)?.toDouble() ?: 0.0
        world.moveZ = (inp["moveZ"] as? Number)?.toDouble() ?: 0.0
        if (inp["jump"] == true) world.jump()
        if (inp["fire"] == true) world.fire()
      }
      if (f != 0 || !inputAtZero) world.step(dt, head)
      if ((f + 1) in checkpoints) {
        val bodies = LinkedHashMap<String, Any?>()
        for (b in world.bodies) {
          bodies[b.name] =
            listOf(b.pos[0], b.pos[1], b.pos[2], b.yaw).map { Math.round(it * 1e6) / 1e6 }
        }
        val cp = linkedMapOf<String, Any?>("frame" to f + 1, "bodies" to bodies)
        if (scene["visuals"] == true) {
          cp["visuals"] = visualsSummary(world)
          cp["camera"] = cameraSummary(world)
        }
        out += cp
      }
    }
    val sc = Objectives.scenario(world)
    return mapOf(
      "checkpoints" to out,
      "events" to events,
      "score" to (sc?.score ?: 0.0),
      "attemptsLeft" to sc?.attemptsLeft,
      "integrity" to
        world.bodies.filter { it.traits.integrity != null }.associate { it.name to it.integrity },
    )
  }
}
