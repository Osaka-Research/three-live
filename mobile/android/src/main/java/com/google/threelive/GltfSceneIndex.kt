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

/**
 * Read-only index of a glTF document's node hierarchy, meshes and materials, used by renderers to
 * map glTF indices onto their own scene objects.
 *
 * Construction never throws on malformed content: invalid references become `-1` / empty, child
 * links that would form a cycle or give a node two parents are dropped, and counts are capped.
 */
class GltfSceneIndex(gltfJson: String) {
  /** Node names (`null` when absent). */
  val nodeNames: List<String?>

  /** Children of every node, in glTF order. */
  val children: List<IntArray>

  /** Parent of every node, or `-1` for roots. */
  val parents: IntArray

  /** Mesh index of every node, or `-1`. */
  val nodeMesh: IntArray

  /** Mesh names (`null` when absent). */
  val meshNames: List<String?>

  /** Material index of every primitive of every mesh (`-1` for the default material). */
  val meshPrimitiveMaterials: List<IntArray>

  /**
   * Local bounds of every mesh (`[minX, minY, minZ, maxX, maxY, maxZ]`, the union of its primitives'
   * `POSITION` accessor `min` / `max`), or `null` when the GLB does not declare them.
   */
  val meshBounds: List<DoubleArray?>

  /** Root nodes of the default scene (or every parentless node when there is no scene). */
  val sceneRoots: IntArray

  /** Animation names (`null` when absent). */
  val animationNames: List<String?>

  /** Material `baseColorFactor` RGBA values (defaults to `[1, 1, 1, 1]`). */
  val materialBaseColors: List<FloatArray>

  /** Material `emissiveFactor` RGB values (defaults to `[0, 0, 0]`). */
  val materialEmissive: List<FloatArray>

  /** Material `metallicFactor` values (defaults to `1`). */
  val materialMetallic: FloatArray

  /** Material `roughnessFactor` values (defaults to `1`). */
  val materialRoughness: FloatArray

  init {
    val root = MiniJson.parseObjectOrNull(gltfJson) ?: emptyMap()
    val nodes = (MiniJson.asList(root["nodes"]) ?: emptyList()).take(MAX_NODES)
    val meshes = (MiniJson.asList(root["meshes"]) ?: emptyList()).take(MAX_NODES)
    val materials = (MiniJson.asList(root["materials"]) ?: emptyList()).take(MAX_NODES)
    val n = nodes.size
    nodeNames = nodes.map { MiniJson.asString(MiniJson.asMap(it)?.get("name")) }
    nodeMesh = IntArray(n) { index(MiniJson.asMap(nodes[it])?.get("mesh"), meshes.size) }
    parents = IntArray(n) { -1 }
    val kids = Array(n) { ArrayList<Int>() }
    for (i in 0 until n) {
      val list = MiniJson.asList(MiniJson.asMap(nodes[i])?.get("children")) ?: continue
      for (c in list) {
        val ci = index(c, n)
        // A node may have one parent, and never itself or an ancestor (no cycles).
        if (ci < 0 || ci == i || parents[ci] != -1 || isAncestorOrSelf(ci, i)) continue
        parents[ci] = i
        kids[i].add(ci)
      }
    }
    children = kids.map { it.toIntArray() }
    meshNames = meshes.map { MiniJson.asString(MiniJson.asMap(it)?.get("name")) }
    meshPrimitiveMaterials =
      meshes.map { m ->
        val prims = MiniJson.asList(MiniJson.asMap(m)?.get("primitives")) ?: emptyList()
        IntArray(prims.size) { p -> index(MiniJson.asMap(prims[p])?.get("material"), Int.MAX_VALUE) }
      }
    val accessors = MiniJson.asList(root["accessors"]) ?: emptyList()
    meshBounds =
      meshes.map { m ->
        var out: DoubleArray? = null
        for (prim in MiniJson.asList(MiniJson.asMap(m)?.get("primitives")) ?: emptyList()) {
          val attrs = MiniJson.asMap(MiniJson.asMap(prim)?.get("attributes")) ?: continue
          val acc = MiniJson.asMap(accessors.getOrNull(index(attrs["POSITION"], accessors.size))) ?: continue
          val lo = MiniJson.asList(acc["min"])?.mapNotNull { MiniJson.asFiniteDouble(it) } ?: continue
          val hi = MiniJson.asList(acc["max"])?.mapNotNull { MiniJson.asFiniteDouble(it) } ?: continue
          if (lo.size < 3 || hi.size < 3) continue
          val b = out ?: doubleArrayOf(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]).also { out = it }
          for (k in 0 until 3) {
            b[k] = minOf(b[k], lo[k])
            b[3 + k] = maxOf(b[3 + k], hi[k])
          }
        }
        out
      }
    val scenes = MiniJson.asList(root["scenes"]) ?: emptyList()
    val sceneIdx = index(root["scene"], scenes.size).let { if (it < 0 && scenes.isNotEmpty()) 0 else it }
    val declaredRoots =
      MiniJson.asList(MiniJson.asMap(scenes.getOrNull(sceneIdx))?.get("nodes"))
        ?.map { index(it, n) }
        ?.filter { it >= 0 && parents[it] == -1 }
        ?.distinct()
    sceneRoots = (declaredRoots ?: (0 until n).filter { parents[it] == -1 }).toIntArray()
    animationNames =
      (MiniJson.asList(root["animations"]) ?: emptyList()).map {
        MiniJson.asString(MiniJson.asMap(it)?.get("name"))
      }
    val baseColors = ArrayList<FloatArray>(materials.size)
    val emissives = ArrayList<FloatArray>(materials.size)
    val metallics = FloatArray(materials.size) { 1f }
    val roughnesses = FloatArray(materials.size) { 1f }
    for (mIdx in materials.indices) {
      val m = MiniJson.asMap(materials[mIdx])
      val pbr = MiniJson.asMap(m?.get("pbrMetallicRoughness"))
      val bc = MiniJson.asList(pbr?.get("baseColorFactor"))
      baseColors.add(
        floatArrayOf(
          finiteFloat(bc?.getOrNull(0), 1f),
          finiteFloat(bc?.getOrNull(1), 1f),
          finiteFloat(bc?.getOrNull(2), 1f),
          finiteFloat(bc?.getOrNull(3), 1f),
        )
      )
      val em = MiniJson.asList(m?.get("emissiveFactor"))
      emissives.add(
        floatArrayOf(
          finiteFloat(em?.getOrNull(0), 0f),
          finiteFloat(em?.getOrNull(1), 0f),
          finiteFloat(em?.getOrNull(2), 0f),
        )
      )
      metallics[mIdx] = finiteFloat(pbr?.get("metallicFactor"), 1f)
      roughnesses[mIdx] = finiteFloat(pbr?.get("roughnessFactor"), 1f)
    }
    materialBaseColors = baseColors
    materialEmissive = emissives
    materialMetallic = metallics
    materialRoughness = roughnesses
  }

  /** Number of nodes. */
  val nodeCount: Int
    get() = nodeNames.size

  /** The glTF mesh name of [nodeIndex]'s mesh (what web events report as `mesh`), or `null`. */
  fun meshNameOfNode(nodeIndex: Int): String? = meshNames.getOrNull(nodeMesh.getOrElse(nodeIndex) { -1 })

  /** Material indices used by [nodeIndex]'s mesh primitives (empty for mesh-less nodes). */
  fun materialsOfNode(nodeIndex: Int): IntArray =
    meshPrimitiveMaterials.getOrNull(nodeMesh.getOrElse(nodeIndex) { -1 }) ?: IntArray(0)

  /** [nodeIndex] and all its descendants, pre-order. */
  fun subtree(nodeIndex: Int): IntArray {
    if (nodeIndex !in 0 until nodeCount) return IntArray(0)
    val out = ArrayList<Int>()
    val stack = ArrayDeque<Int>()
    stack.addLast(nodeIndex)
    while (stack.isNotEmpty()) {
      val i = stack.removeLast()
      out.add(i)
      val c = children[i]
      for (k in c.indices.reversed()) stack.addLast(c[k])
    }
    return out.toIntArray()
  }

  /**
   * Maps every glTF node to a renderer entity by walking both hierarchies from the roots.
   * Siblings are paired by position when the counts and names agree, otherwise by name, so
   * renderers that reorder or drop nodes still map what they can.
   *
   * @param rootEntities the renderer's top-level entities for the scene roots, in order.
   * @param childrenOf returns an entity's children in order.
   * @param nameOf returns an entity's name (or `null`).
   * @return the entity for each node, or [noEntity] when unmatched.
   */
  fun matchEntities(
    rootEntities: IntArray,
    childrenOf: (Int) -> IntArray,
    nameOf: (Int) -> String?,
    noEntity: Int = 0,
  ): IntArray {
    val out = IntArray(nodeCount) { noEntity }
    val stack = ArrayDeque<Pair<IntArray, IntArray>>()
    stack.addLast(sceneRoots to rootEntities)
    var visited = 0
    while (stack.isNotEmpty() && visited <= nodeCount) {
      val (nodeList, entityList) = stack.removeLast()
      for ((node, entity) in pairSiblings(nodeList, entityList, nameOf)) {
        if (out[node] != noEntity) continue
        out[node] = entity
        visited++
        stack.addLast(children[node] to childrenOf(entity))
      }
    }
    return out
  }

  private fun pairSiblings(
    nodeList: IntArray,
    entityList: IntArray,
    nameOf: (Int) -> String?,
  ): List<Pair<Int, Int>> {
    val sameShape =
      nodeList.size == entityList.size &&
        nodeList.indices.all { k ->
          val a = nodeNames[nodeList[k]]
          val b = nameOf(entityList[k])
          a == null || b == null || a == b
        }
    if (sameShape) return nodeList.indices.map { nodeList[it] to entityList[it] }
    val used = BooleanArray(entityList.size)
    val pairs = ArrayList<Pair<Int, Int>>()
    for (node in nodeList) {
      val name = nodeNames[node] ?: continue
      val k = entityList.indices.firstOrNull { !used[it] && nameOf(entityList[it]) == name } ?: continue
      used[k] = true
      pairs.add(node to entityList[k])
    }
    return pairs
  }

  private fun isAncestorOrSelf(candidate: Int, node: Int): Boolean {
    var cur = node
    var depth = 0
    while (cur >= 0 && depth <= MAX_NODES) {
      if (cur == candidate) return true
      cur = parents[cur]
      depth++
    }
    return false
  }

  companion object {
    /** Upper bound on indexed nodes / meshes (matches the native compiler's node cap order). */
    const val MAX_NODES: Int = 65_536

    /** Builds an index from a binary glTF, or `null` when [glb] is not a valid `.glb`. */
    @JvmStatic
    fun fromGlb(glb: ByteBuffer): GltfSceneIndex? =
      XRLiveSceneCoreHelper.extractGlbJsonChunk(glb)?.let { GltfSceneIndex(it) }

    private fun index(v: Any?, size: Int): Int {
      val d = v as? Double ?: return -1
      if (!d.isFinite() || d < 0 || d != Math.floor(d) || d >= size.toDouble()) return -1
      return d.toInt()
    }

    private fun finiteFloat(v: Any?, fallback: Float): Float {
      val d = v as? Double ?: return fallback
      return if (d.isFinite()) d.toFloat() else fallback
    }
  }
}
