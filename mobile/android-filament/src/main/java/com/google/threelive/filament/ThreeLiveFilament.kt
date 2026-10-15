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

package com.google.threelive.filament

import com.google.threelive.ThreeLiveRendererFactory
import com.google.threelive.ThreeLiveRenderers
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Entry point of the optional Filament renderer module.
 *
 * Nothing is registered automatically: call [install] once (for example in
 * `Application.onCreate`) to make [ThreeLiveFilamentRenderer] the renderer that three-live views
 * create.
 */
object ThreeLiveFilament {
  /** Registers the Filament renderer with [ThreeLiveRenderers]. Idempotent. */
  @JvmStatic
  fun install() {
    ThreeLiveRenderers.register(FACTORY)
  }

  private val FACTORY = ThreeLiveRendererFactory { context -> ThreeLiveFilamentRenderer(context) }
}

/**
 * A one-triangle GLB with a `KHR_materials_unlit` material. Loading it through gltfio yields a fully
 * initialized unlit ubershader material instance that dynamic meshes duplicate.
 */
internal object DynamicMeshTemplate {
  private const val JSON =
    """{"asset":{"version":"2.0"},"extensionsUsed":["KHR_materials_unlit"],""" +
      """"scenes":[{"nodes":[0]}],"scene":0,"nodes":[{"mesh":0}],""" +
      """"meshes":[{"primitives":[{"attributes":{"POSITION":0},"material":0}]}],""" +
      """"materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1]},""" +
      """"doubleSided":true,"extensions":{"KHR_materials_unlit":{}}}],""" +
      """"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3",""" +
      """"min":[0,0,0],"max":[1,1,0]}],""" +
      """"bufferViews":[{"buffer":0,"byteLength":36}],"buffers":[{"byteLength":36}]}"""

  /** Builds the template GLB as a direct buffer. */
  fun glb(): ByteBuffer = buildGlb(JSON)

  /**
   * A one-triangle GLB with `KHR_materials_unlit`, `alphaMode: "BLEND"`, `COLOR_0`, `TEXCOORD_0`
   * and a 1x1 `baseColorTexture` so gltfio binds the `baseColorMap` sampler and vertex colors.
   */
  private const val SPLAT_JSON =
    """{"asset":{"version":"2.0"},"extensionsUsed":["KHR_materials_unlit"],""" +
      """"scenes":[{"nodes":[0]}],"scene":0,"nodes":[{"mesh":0}],""" +
      """"meshes":[{"primitives":[{"attributes":{"POSITION":0,"TEXCOORD_0":1,"COLOR_0":2},"material":0}]}],""" +
      """"materials":[{"pbrMetallicRoughness":{"baseColorFactor":[1,1,1,1],"baseColorTexture":{"index":0}},""" +
      """"alphaMode":"BLEND","doubleSided":true,"extensions":{"KHR_materials_unlit":{}}}],""" +
      """"textures":[{"source":0}],"images":[{"bufferView":3,"mimeType":"image/png"}],""" +
      """"accessors":[{"bufferView":0,"componentType":5126,"count":3,"type":"VEC3","min":[0,0,0],"max":[1,1,0]},""" +
      """{"bufferView":1,"componentType":5126,"count":3,"type":"VEC2"},""" +
      """{"bufferView":2,"componentType":5126,"count":3,"type":"VEC4"}],""" +
      """"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},""" +
      """{"buffer":0,"byteOffset":36,"byteLength":24},""" +
      """{"buffer":0,"byteOffset":60,"byteLength":48},""" +
      """{"buffer":0,"byteOffset":108,"byteLength":68}],""" +
      """"buffers":[{"byteLength":176}]}"""

  /** Minimal 1x1 white RGBA PNG (68 bytes). */
  private val WHITE_PNG =
    byteArrayOf(
      0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4.toByte(),
      0x89.toByte(), 0x00, 0x00, 0x00, 0x0B, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9C.toByte(), 0x63, 0xF8.toByte(), 0x0F, 0x04, 0x00,
      0x09, 0xFB.toByte(), 0x03, 0xFD.toByte(), 0xA0.toByte(), 0x7A, 0x4E, 0x9E.toByte(),
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44,
      0xAE.toByte(), 0x42, 0x60, 0x82.toByte(),
    )

  /** Builds the alpha-blended splat template GLB as a direct buffer. */
  fun splatGlb(): ByteBuffer {
    val json = SPLAT_JSON.toByteArray(Charsets.UTF_8)
    val jsonLen = (json.size + 3) and -4
    val binLen = 176
    val total = 12 + 8 + jsonLen + 8 + binLen
    val b = ByteBuffer.allocateDirect(total).order(ByteOrder.LITTLE_ENDIAN)
    b.putInt(0x46546C67).putInt(2).putInt(total)
    b.putInt(jsonLen).putInt(0x4E4F534A).put(json)
    while (b.position() < 20 + jsonLen) b.put(0x20.toByte())
    b.putInt(binLen).putInt(0x004E4942)
    // POSITION (3 * VEC3 = 36B)
    for (v in floatArrayOf(0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f)) b.putFloat(v)
    // TEXCOORD_0 (3 * VEC2 = 24B)
    for (v in floatArrayOf(0f, 0f, 1f, 0f, 0f, 1f)) b.putFloat(v)
    // COLOR_0 (3 * VEC4 = 48B)
    for (i in 0 until 12) b.putFloat(1f)
    // 1x1 PNG (68B)
    b.put(WHITE_PNG)
    b.rewind()
    return b
  }

  private fun buildGlb(jsonStr: String): ByteBuffer {
    val json = jsonStr.toByteArray(Charsets.UTF_8)
    val jsonLen = (json.size + 3) and -4
    val binLen = 36
    val total = 12 + 8 + jsonLen + 8 + binLen
    val b = ByteBuffer.allocateDirect(total).order(ByteOrder.LITTLE_ENDIAN)
    b.putInt(0x46546C67).putInt(2).putInt(total)
    b.putInt(jsonLen).putInt(0x4E4F534A).put(json)
    while (b.position() < 20 + jsonLen) b.put(0x20.toByte())
    b.putInt(binLen).putInt(0x004E4942)
    for (v in floatArrayOf(0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f)) b.putFloat(v)
    b.rewind()
    return b
  }
}
