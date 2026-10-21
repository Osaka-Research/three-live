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

import com.google.threelive.GltfSceneIndex
import com.google.threelive.ThreeLiveRenderers
import com.google.threelive.XRLiveSceneCoreHelper
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** JVM tests for the Filament module's pure helpers (no native Filament needed). */
class ThreeLiveFilamentTest {

  @Test
  fun composeTrsMatchesGltfConvention() {
    val out = FloatArray(16)
    // 90° about +Y, translate (1, 2, 3), scale 2.
    val s = Math.sqrt(0.5).toFloat()
    ThreeLiveFilamentRenderer.composeTrs(
      floatArrayOf(1f, 2f, 3f),
      floatArrayOf(0f, s, 0f, s),
      floatArrayOf(2f, 2f, 2f),
      out,
    )
    // +X maps to -Z (scaled by 2); translation in the last column.
    assertEquals(0f, out[0], 1e-6f)
    assertEquals(-2f, out[2], 1e-6f)
    assertEquals(2f, out[5], 1e-6f)
    assertEquals(2f, out[8], 1e-6f)
    assertArrayEquals(floatArrayOf(1f, 2f, 3f, 1f), out.copyOfRange(12, 16), 1e-6f)
  }

  @Test
  fun rayBoxEntryHitsMissesAndStartsInside() {
    val box = doubleArrayOf(-1.0, -1.0, -1.0, 1.0, 1.0, 1.0)
    val hit = ThreeLiveFilamentRenderer.rayBoxEntry(doubleArrayOf(0.0, 0.0, 5.0), doubleArrayOf(0.0, 0.0, -1.0), box)
    assertEquals(4.0, hit!!, 1e-9)
    assertNull(ThreeLiveFilamentRenderer.rayBoxEntry(doubleArrayOf(0.0, 3.0, 5.0), doubleArrayOf(0.0, 0.0, -1.0), box))
    assertNull(ThreeLiveFilamentRenderer.rayBoxEntry(doubleArrayOf(0.0, 0.0, 5.0), doubleArrayOf(0.0, 0.0, 1.0), box))
    assertEquals(0.0, ThreeLiveFilamentRenderer.rayBoxEntry(doubleArrayOf(0.0, 0.0, 0.0), doubleArrayOf(1.0, 0.0, 0.0), box)!!, 1e-9)
  }

  @Test
  fun dynamicMeshTemplateIsAValidUnlitGlb() {
    for (glb in listOf(DynamicMeshTemplate.glb(), DynamicMeshTemplate.splatGlb())) {
      val json = XRLiveSceneCoreHelper.extractGlbJsonChunk(glb)
      assertNotNull(json)
      val index = GltfSceneIndex(json!!)
      assertEquals(1, index.nodeCount)
      assertArrayEquals(intArrayOf(0), index.materialsOfNode(0))
      assertEquals(glb.capacity(), glb.duplicate().order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(8))
    }
  }

  @Test
  fun installRegistersFactory() {
    ThreeLiveRenderers.clear()
    ThreeLiveFilament.install()
    assertNotNull(ThreeLiveRenderers.current())
    ThreeLiveRenderers.clear()
  }

  @Test
  fun srgbToLinearAndStudioHelpersMatchCrossPlatformCalibration() {
    // Boundary and Ruby Torus Knot (0xf43f5e = 244/255, 63/255, 94/255) checks.
    assertEquals(0f, ThreeLiveFilamentRenderer.srgbToLinear(0f), 1e-6f)
    assertEquals(1f, ThreeLiveFilamentRenderer.srgbToLinear(1f), 1e-6f)
    assertEquals(0.9046f, ThreeLiveFilamentRenderer.srgbToLinear(244f / 255f), 1e-3f)
    assertEquals(0.0497f, ThreeLiveFilamentRenderer.srgbToLinear(63f / 255f), 1e-3f)
    assertEquals(0.1119f, ThreeLiveFilamentRenderer.srgbToLinear(94f / 255f), 1e-3f)

    // Calibrated metallic keeps diffuse body color while preserving specular reflection.
    assertEquals(0.361f, ThreeLiveFilamentRenderer.effectiveMetallic(0.95f), 1e-3f)
    assertEquals(0.038f, ThreeLiveFilamentRenderer.effectiveMetallic(0.10f), 1e-3f)

    // IEEE 754 binary16 encoding for 0.0, 0.5, 1.0, and 2.0.
    assertEquals(0.toShort(), ThreeLiveFilamentRenderer.floatToHalf(0f))
    assertEquals(0x3800.toShort(), ThreeLiveFilamentRenderer.floatToHalf(0.5f))
    assertEquals(0x3C00.toShort(), ThreeLiveFilamentRenderer.floatToHalf(1.0f))
    assertEquals(0x4000.toShort(), ThreeLiveFilamentRenderer.floatToHalf(2.0f))

    // Studio cubemap buffer has 6 faces * size * size * 8 bytes.
    val buf = ThreeLiveFilamentRenderer.buildStudioCubemapLevelBuffer(8, 0.15f)
    assertEquals(6 * 8 * 8 * 8, buf.remaining())

    // GltfSceneIndex parses material baseColorFactor, metallicFactor, and roughnessFactor.
    val index =
      GltfSceneIndex(
        """
        {
          "materials": [
            {
              "name": "RubyMat",
              "pbrMetallicRoughness": {
                "baseColorFactor": [0.95686, 0.24706, 0.36863, 1.0],
                "metallicFactor": 0.95,
                "roughnessFactor": 0.15
              },
              "emissiveFactor": [0.1, 0.2, 0.3]
            }
          ]
        }
        """.trimIndent()
      )
    assertEquals(1, index.materialBaseColors.size)
    assertArrayEquals(floatArrayOf(0.95686f, 0.24706f, 0.36863f, 1.0f), index.materialBaseColors[0], 1e-4f)
    assertArrayEquals(floatArrayOf(0.1f, 0.2f, 0.3f), index.materialEmissive[0], 1e-4f)
    assertEquals(0.95f, index.materialMetallic[0], 1e-4f)
    assertEquals(0.15f, index.materialRoughness[0], 1e-4f)
  }
}
