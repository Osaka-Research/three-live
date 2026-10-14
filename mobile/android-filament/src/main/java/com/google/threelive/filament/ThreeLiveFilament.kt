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
  fun glb(): ByteBuffer {
    val json = JSON.toByteArray(Charsets.UTF_8)
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
