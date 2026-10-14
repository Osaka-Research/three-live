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

package com.google.threelive.gemini

import com.google.threelive.CapturedFrame
import com.google.threelive.ThreeLiveCameraOptions
import com.google.threelive.ThreeLiveDetections
import com.google.threelive.ThreeLiveRendererListener
import com.google.threelive.ThreeLiveSceneRenderer
import com.google.threelive.WorldUnderstanding
import java.nio.ByteBuffer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Frame streaming from a renderer to Gemini Live. */
class RendererFrameSourceTest {

  @Test
  fun fitWithinKeepsAspectAndNeverUpscales() {
    assertArrayEquals(intArrayOf(768, 432), RendererFrameSource.fitWithin(1920, 1080, 768))
    assertArrayEquals(intArrayOf(432, 768), RendererFrameSource.fitWithin(1080, 1920, 768))
    assertArrayEquals(intArrayOf(640, 480), RendererFrameSource.fitWithin(640, 480, 768))
    assertArrayEquals(intArrayOf(768, 1), RendererFrameSource.fitWithin(10_000, 1, 768))
    assertArrayEquals(intArrayOf(0, 0), RendererFrameSource.fitWithin(0, 10, 768))
  }

  @Test
  fun deliversJpegAndRemembersRecentCameraMatrices() {
    val r = FakeRenderer()
    val src = RendererFrameSource(r, maxEdge = 512)
    val got = ArrayList<ByteArray?>()
    repeat(6) { src.captureJpeg { got.add(it) } }
    assertEquals(6, got.size)
    assertArrayEquals(byteArrayOf(6), got.last())
    assertEquals(512, r.lastMaxEdge)
    assertEquals(RendererFrameSource.HISTORY, src.recentFrames().size)
    assertEquals(6L, src.latestFrame!!.timestampMs)
  }

  @Test
  fun pausedOrUnsupportedCapturesYieldNull() {
    val r = FakeRenderer()
    val src = RendererFrameSource(r)
    src.paused = true
    var result: ByteArray? = byteArrayOf(1)
    src.captureJpeg { result = it }
    assertNull(result)
    assertEquals(0, r.calls)
    src.paused = false
    r.fail = true
    result = byteArrayOf(1)
    src.captureJpeg { result = it }
    assertNull(result)
    assertNull(src.latestFrame)
  }

  @Test
  fun controllerStreamsCapturedFramesAsJpegChunks() {
    val r = FakeRenderer()
    val t = FakeTransport()
    val c = XRGeminiLiveController(frameSource = RendererFrameSource(r))
    c.connect(t, GeminiLiveOptions(streamFrames = false))
    assertTrue(c.sendFrame())
    val chunk = (t.sent.last()["realtimeInput"] as Map<*, *>)["mediaChunks"] as List<*>
    assertEquals("image/jpeg", (chunk[0] as Map<*, *>)["mimeType"])
  }

  @Test
  fun locateUsesLatestFrameCameraOrFallsBackToRenderer() {
    val r = FakeRenderer()
    val src = RendererFrameSource(r)
    val boxes = ThreeLiveDetections.parse("""[{"label":"cup","box":[400,400,600,600]}]""")
    assertTrue(src.locate(boxes).isEmpty())
    r.frameCameraZ = 3f
    src.captureJpeg {}
    val fromFrame = src.locate(boxes)
    assertEquals(3.0 - WorldUnderstanding.FALLBACK_DEPTH_METERS, fromFrame.single().z, 1e-6)
    assertTrue(src.locate(emptyList()).isEmpty())
  }

  private class FakeTransport : GeminiLiveTransport {
    override var listener: GeminiLiveTransport.Listener? = null
    val sent = ArrayList<Map<String, Any?>>()

    override fun send(message: Map<String, Any?>) {
      sent.add(message)
    }

    override fun close() {}
  }

  private class FakeRenderer : ThreeLiveSceneRenderer {
    override var listener: ThreeLiveRendererListener? = null
    var calls = 0
    var lastMaxEdge = 0
    var fail = false
    var frameCameraZ = 0f

    override fun captureFrame(maxEdge: Int, callback: (CapturedFrame?) -> Unit) {
      calls++
      lastMaxEdge = maxEdge
      if (fail) {
        callback(null)
        return
      }
      val world = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = 1f; it[14] = frameCameraZ; it[15] = 1f }
      val proj = FloatArray(16).also { it[0] = 1f; it[5] = 1f; it[10] = -1f; it[11] = -1f; it[14] = -0.2f }
      callback(CapturedFrame(byteArrayOf(calls.toByte()), 4, 3, world, proj, calls.toLong()))
    }

    override fun load(glb: ByteBuffer) {}

    override fun setCameraOptions(options: ThreeLiveCameraOptions) {}

    override fun setNodeTransform(nodeIndex: Int, translation: FloatArray, rotation: FloatArray, scale: FloatArray) {}

    override fun setNodeVisible(nodeIndex: Int, visible: Boolean) {}

    override fun setMaterialFactors(
      materialIndex: Int,
      baseColorFactor: FloatArray,
      emissiveFactor: FloatArray,
      metallicFactor: Float,
      roughnessFactor: Float,
    ) {}

    override fun dispose() {}
  }
}
