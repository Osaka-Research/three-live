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
    val glb = DynamicMeshTemplate.glb()
    val json = XRLiveSceneCoreHelper.extractGlbJsonChunk(glb)
    assertNotNull(json)
    val index = GltfSceneIndex(json!!)
    assertEquals(1, index.nodeCount)
    assertArrayEquals(intArrayOf(0), index.materialsOfNode(0))
    assertEquals(glb.capacity(), glb.duplicate().order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(8))
  }

  @Test
  fun installRegistersFactory() {
    ThreeLiveRenderers.clear()
    ThreeLiveFilament.install()
    assertNotNull(ThreeLiveRenderers.current())
    ThreeLiveRenderers.clear()
  }
}
