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
import java.nio.charset.StandardCharsets

/**
 * Declarative spatial traits parsed from a compiled `.glb` node's `extras.xr` and
 * `extensions.ANDROID_xr_scenecore` metadata.
 */
data class XRLiveNodeTraits(
  val nodeIndex: Int,
  val name: String,
  val grabbable: Boolean = false,
  val scalable: Boolean = false,
  val billboard: String? = null,
  val anchor: String? = null,
  val follow: String? = null,
  val physics: String? = null,
)

/**
 * Callback interface for attaching native Android XR Jetpack SceneCore (`androidx.xr.scenecore`) or
 * Filament components (`MovableComponent`, `AnchorEntity`, etc.) to loaded entities.
 */
interface SceneCoreComponentApplier<EntityT> {
  fun onAttachMovable(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachAnchor(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachBillboard(entity: EntityT, node: XRLiveNodeTraits) {}

  fun onAttachPhysics(entity: EntityT, node: XRLiveNodeTraits) {}
}

/**
 * Zero-dependency parser and adapter that extracts `userData.xr` / `ANDROID_xr_scenecore` traits
 * from a compiled `.glb` binary buffer and binds them to native Android XR Jetpack SceneCore or
 * Filament entities.
 */
object XRLiveSceneCoreHelper {

  private const val GLB_MAGIC = 0x46546C67 // "glTF"
  private const val CHUNK_TYPE_JSON = 0x4E4F534A // "JSON"

  /** Extracts the UTF-8 JSON chunk string from a binary glTF 2.0 (`.glb`) [ByteBuffer]. */
  @JvmStatic
  fun extractGlbJsonChunk(glb: ByteBuffer): String? {
    val buf = glb.duplicate().order(ByteOrder.LITTLE_ENDIAN)
    buf.rewind()
    if (buf.remaining() < 20) return null
    val magic = buf.int
    val version = buf.int
    val totalLen = buf.int
    if (magic != GLB_MAGIC || version != 2 || totalLen < 20) return null

    val chunkLen = buf.int
    val chunkType = buf.int
    if (chunkType != CHUNK_TYPE_JSON || chunkLen <= 0 || chunkLen > buf.remaining()) {
      return null
    }
    val bytes = ByteArray(chunkLen)
    buf.get(bytes)
    return String(bytes, StandardCharsets.UTF_8).trim()
  }

  /**
   * Parses `XRLiveNodeTraits` from each node in a compiled `.glb` buffer that carries `extras.xr`
   * or `ANDROID_xr_scenecore` metadata.
   */
  @JvmStatic
  fun extractNodeTraits(glb: ByteBuffer): List<XRLiveNodeTraits> {
    val json = extractGlbJsonChunk(glb) ?: return emptyList()
    return parseNodeTraitsFromGltfJson(json)
  }

  /**
   * Parses `XRLiveNodeTraits` from a glTF 2.0 JSON string without requiring external JSON libraries
   * so the Android client library stays zero-dependency.
   */
  @JvmStatic
  fun parseNodeTraitsFromGltfJson(json: String): List<XRLiveNodeTraits> {
    val nodesStart = json.indexOf("\"nodes\"")
    if (nodesStart < 0) return emptyList()
    val arrayOpen = json.indexOf('[', nodesStart)
    if (arrayOpen < 0) return emptyList()
    val arrayContent = extractBalancedBlock(json, arrayOpen, '[', ']') ?: return emptyList()

    val results = mutableListOf<XRLiveNodeTraits>()
    var cursor = 0
    var nodeIdx = 0
    while (cursor < arrayContent.length) {
      val objStart = arrayContent.indexOf('{', cursor)
      if (objStart < 0) break
      val nodeObj = extractBalancedBlock(arrayContent, objStart, '{', '}') ?: break
      cursor = objStart + nodeObj.length

      if (nodeObj.contains("\"xr\"") || nodeObj.contains("\"ANDROID_xr_scenecore\"")) {
        val topLevelNode = stripNestedObjects(nodeObj)
        val name = extractJsonStringField(topLevelNode, "name") ?: "Node_$nodeIdx"
        val xrSub = extractSubObject(nodeObj, "xr") ?: ""
        val sceneCoreSub = extractSubObject(nodeObj, "ANDROID_xr_scenecore") ?: ""
        val xrBlock =
          if (xrSub.isNotEmpty() || sceneCoreSub.isNotEmpty()) "$xrSub $sceneCoreSub" else nodeObj
        val grabbable =
          extractJsonBoolField(xrBlock, "grabbable") ||
            extractJsonBoolField(xrBlock, "systemMovable") ||
            hasJsonArrayStringItem(xrBlock, "traits", "grab")
        val scalable =
          extractJsonBoolField(xrBlock, "scalable") ||
            extractJsonBoolField(xrBlock, "scaleInZ") ||
            hasJsonArrayStringItem(xrBlock, "traits", "scale")
        val billboard =
          extractJsonStringField(xrBlock, "billboard")
            ?: extractJsonStringField(xrBlock, "mode")
            ?: if (
              extractJsonBoolField(xrBlock, "billboard") ||
                hasJsonArrayStringItem(xrBlock, "traits", "billboard")
            ) {
              "capsule"
            } else {
              null
            }
        val anchor =
          extractJsonStringField(xrBlock, "anchor")
            ?: extractJsonStringField(xrBlock, "planeType")?.lowercase()
        val follow = extractJsonStringField(xrBlock, "follow")
        val physics = extractJsonStringField(xrBlock, "physics")

        results.add(
          XRLiveNodeTraits(
            nodeIndex = nodeIdx,
            name = name,
            grabbable = grabbable,
            scalable = scalable,
            billboard = billboard,
            anchor = anchor,
            follow = follow,
            physics = physics,
          )
        )
      }
      nodeIdx++
    }
    return results
  }

  /** Extracts spatial traits from [glb] and invokes [applier] hooks for [rootEntity]. */
  @JvmStatic
  fun <EntityT> applyTraitsFromGlb(
    glb: ByteBuffer,
    rootEntity: EntityT,
    applier: SceneCoreComponentApplier<EntityT>,
  ): List<XRLiveNodeTraits> {
    val traitsList = extractNodeTraits(glb)
    for (trait in traitsList) {
      if (trait.grabbable) {
        applier.onAttachMovable(rootEntity, trait)
      }
      if (!trait.anchor.isNullOrEmpty() && trait.anchor != "none") {
        applier.onAttachAnchor(rootEntity, trait)
      }
      if (!trait.billboard.isNullOrEmpty() && trait.billboard != "false") {
        applier.onAttachBillboard(rootEntity, trait)
      }
      if (!trait.physics.isNullOrEmpty() && trait.physics != "none") {
        applier.onAttachPhysics(rootEntity, trait)
      }
    }
    return traitsList
  }

  private fun extractBalancedBlock(
    src: String,
    openIdx: Int,
    openChar: Char,
    closeChar: Char,
  ): String? {
    var depth = 0
    var inString = false
    var escaped = false
    for (i in openIdx until src.length) {
      val ch = src[i]
      if (escaped) {
        escaped = false
        continue
      }
      if (ch == '\\' && inString) {
        escaped = true
        continue
      }
      if (ch == '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (ch == openChar) {
          depth++
        } else if (ch == closeChar) {
          depth--
          if (depth == 0) {
            return src.substring(openIdx, i + 1)
          }
        }
      }
    }
    return null
  }

  private fun stripNestedObjects(nodeObj: String): String {
    val sb = StringBuilder()
    var depth = 0
    var inString = false
    var escaped = false
    for (i in nodeObj.indices) {
      val ch = nodeObj[i]
      if (escaped) {
        if (depth <= 1) sb.append(ch)
        escaped = false
        continue
      }
      if (ch == '\\' && inString) {
        if (depth <= 1) sb.append(ch)
        escaped = true
        continue
      }
      if (ch == '"') {
        inString = !inString
      }
      if (!inString) {
        if (ch == '{') {
          depth++
          if (depth > 1) continue
        } else if (ch == '}') {
          if (depth > 1) {
            depth--
            continue
          }
          depth--
        }
      }
      if (depth <= 1) {
        sb.append(ch)
      }
    }
    return sb.toString()
  }

  private fun extractSubObject(src: String, key: String): String? {
    val keyPattern = Regex("\"$key\"\\s*:\\s*\\{")
    val match = keyPattern.find(src) ?: return null
    val braceIdx = src.indexOf('{', match.range.first)
    if (braceIdx < 0) return null
    return extractBalancedBlock(src, braceIdx, '{', '}')
  }

  private fun extractJsonStringField(obj: String, key: String): String? {
    val pattern = Regex("\"$key\"\\s*:\\s*\"([^\"]+)\"")
    return pattern.find(obj)?.groupValues?.getOrNull(1)
  }

  private fun extractJsonBoolField(obj: String, key: String): Boolean {
    val pattern = Regex("\"$key\"\\s*:\\s*(true|false)")
    return pattern.find(obj)?.groupValues?.getOrNull(1) == "true"
  }

  private fun hasJsonArrayStringItem(obj: String, arrayKey: String, item: String): Boolean {
    val keyPattern = Regex("\"$arrayKey\"\\s*:\\s*\\[")
    val match = keyPattern.find(obj) ?: return false
    val bracketIdx = obj.indexOf('[', match.range.first)
    if (bracketIdx < 0) return false
    val arrBlock = extractBalancedBlock(obj, bracketIdx, '[', ']') ?: return false
    return Regex("\"${Regex.escape(item)}\"").containsMatchIn(arrBlock)
  }
}
