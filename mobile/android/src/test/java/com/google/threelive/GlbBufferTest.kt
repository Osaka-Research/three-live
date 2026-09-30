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
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Host-side JVM tests for the Kotlin ownership layer.
 *
 * These tests never load the native library. Instead they inject a fake deallocation hook into
 * [GlbBuffer], which lets them assert on the thing that actually matters — *when* and *how often*
 * the native free happens — rather than only on the visible `isClosed` flag.
 */
class GlbBufferTest {

  /**
   * These tests assert on exactly when and how often the native free runs, so the leak detector —
   * which frees abandoned buffers at the garbage collector's discretion — would make them
   * nondeterministic. It has its own test class; turn it off here.
   */
  @Before
  fun disableLeakDetector() {
    GlbBufferLeakDetector.enabled = false
  }

  @After
  fun restoreLeakDetector() {
    GlbBufferLeakDetector.enabled = true
  }

  /** Records every (address, capacity) pair passed to the native free hook. */
  private class RecordingFree : (Long, Long) -> Unit {
    val calls = CopyOnWriteArrayList<Pair<Long, Long>>()

    override fun invoke(address: Long, capacity: Long) {
      calls.add(address to capacity)
    }
  }

  private fun directBufferOf(size: Int, fill: Byte = FILL): ByteBuffer {
    val buffer = ByteBuffer.allocateDirect(size)
    for (i in 0 until size) {
      buffer.put(i, fill)
    }
    return buffer
  }

  @Test
  fun testGlbBufferPropertiesAndToByteArray() {
    val directBuffer = ByteBuffer.allocateDirect(256)
    directBuffer.put(0x67.toByte()) // 'g'
    directBuffer.put(0x6C.toByte()) // 'l'
    directBuffer.put(0x54.toByte()) // 'T'
    directBuffer.put(0x46.toByte()) // 'F'
    directBuffer.rewind()

    val glbBuffer = GlbBuffer(directBuffer, address = ADDRESS, capacity = 256L) { _, _ -> }

    assertEquals(256L, glbBuffer.capacity)
    assertEquals(256, glbBuffer.size)
    assertEquals(directBuffer, glbBuffer.byteBuffer)

    val byteArray = glbBuffer.toByteArray()
    assertEquals(256, byteArray.size)
    assertEquals(0x67.toByte(), byteArray[0])
    assertEquals(0x6C.toByte(), byteArray[1])
    assertEquals(0x54.toByte(), byteArray[2])
    assertEquals(0x46.toByte(), byteArray[3])
  }

  @Test
  fun testCloseFreesNativeMemoryExactlyOnce() {
    val free = RecordingFree()
    val glbBuffer =
      GlbBuffer(
        ByteBuffer.allocateDirect(128),
        address = ADDRESS,
        capacity = 128L,
        freeNative = free,
      )

    glbBuffer.close()
    glbBuffer.close()
    glbBuffer.close()

    // Repeated close() must not produce a repeated native free: a double free of a real
    // allocation would corrupt the heap.
    assertEquals(listOf(ADDRESS to 128L), free.calls.toList())
  }

  @Test
  fun testCloseDoesNotFreeWhenAddressIsUnknown() {
    val free = RecordingFree()
    val glbBuffer =
      GlbBuffer(ByteBuffer.allocateDirect(128), address = 0L, capacity = 128L, freeNative = free)

    glbBuffer.close()

    assertTrue("Must not hand address 0 to the native allocator", free.calls.isEmpty())
  }

  @Test
  fun testUseBlockFreesNativeMemory() {
    val free = RecordingFree()
    GlbBuffer(ByteBuffer.allocateDirect(64), ADDRESS, 64L, free).use { buffer ->
      assertEquals(64, buffer.size)
      assertNotNull(buffer.toByteArray())
      assertTrue("Buffer must still be live inside use{}", free.calls.isEmpty())
    }
    assertEquals(1, free.calls.size)
  }

  @Test
  fun testToByteArrayThrowsAfterClose() {
    val glbBuffer = GlbBuffer(ByteBuffer.allocateDirect(64), ADDRESS, 64L) { _, _ -> }
    glbBuffer.close()

    try {
      glbBuffer.toByteArray()
      fail("Expected IllegalStateException when calling toByteArray() on closed buffer")
    } catch (e: IllegalStateException) {
      assertTrue(e.message?.contains("closed") == true)
    }
  }

  /**
   * Regression test for a use-after-free.
   *
   * `toByteArray()` used to check `isClosed` *outside* the lock that `close()` holds, so a
   * concurrent close could free the native allocation after the check passed but before the bytes
   * were copied out — yielding a torn read of freed memory.
   *
   * The fake free hook scribbles over the buffer the way a real allocator reuses reclaimed pages.
   * Every successful read must therefore be entirely un-scribbled; a mixed result proves the read
   * straddled the free. Moving the `check(!isClosed)` back outside the `synchronized` block in
   * [GlbBuffer.toByteArray] makes this test fail.
   */
  @Test
  fun testToByteArrayNeverReadsFreedMemory() {
    repeat(ITERATIONS) {
      val direct = directBufferOf(BUFFER_SIZE)
      val glbBuffer =
        GlbBuffer(direct, ADDRESS, BUFFER_SIZE.toLong()) { _, _ ->
          // Simulate the allocator reclaiming the pages and handing them to someone else.
          for (i in 0 until BUFFER_SIZE) {
            direct.put(i, POISON)
          }
        }

      val start = CountDownLatch(1)
      val tornReads = AtomicInteger(0)
      val readers =
        (0 until READER_THREADS).map {
          Thread {
            start.await()
            try {
              val bytes = glbBuffer.toByteArray()
              // A clean read is all FILL. An all-POISON read is impossible because close()
              // flips isClosed before scribbling, so toByteArray() would have thrown.
              if (bytes.any { b -> b != FILL }) {
                tornReads.incrementAndGet()
              }
            } catch (expected: IllegalStateException) {
              // Lost the race to close(); this is the correct, safe outcome.
            }
          }
        }
      val closer = Thread {
        start.await()
        glbBuffer.close()
      }

      (readers + closer).forEach(Thread::start)
      start.countDown()
      (readers + closer).forEach { it.join(TimeUnit.SECONDS.toMillis(10)) }

      assertEquals(
        "toByteArray() observed memory that close() had already freed",
        0,
        tornReads.get(),
      )
    }
  }

  @Test
  fun testGlbAssetHolderCloseCascadesToBuffer() {
    val free = RecordingFree()
    val glbBuffer = GlbBuffer(ByteBuffer.allocateDirect(128), ADDRESS, 128L, free)
    val assetHolder = GlbAssetHolder(asset = "FilamentModelEntity", buffer = glbBuffer)

    assertEquals("FilamentModelEntity", assetHolder.asset)
    assertSame(glbBuffer, assetHolder.buffer)
    assertTrue(free.calls.isEmpty())

    assetHolder.close()

    assertEquals(1, free.calls.size)
  }

  /**
   * Regression test for a native memory leak.
   *
   * If the asset loader throws, ownership of the buffer never reaches the holder, so nothing else
   * can ever free it. Removing the `catch` in [FilamentHelper.attachAsset] makes this fail.
   */
  @Test
  fun testAttachAssetFreesBufferWhenLoaderThrows() {
    val free = RecordingFree()
    val glbBuffer = GlbBuffer(ByteBuffer.allocateDirect(128), ADDRESS, 128L, free)

    try {
      FilamentHelper.attachAsset<String>(glbBuffer) {
        throw IllegalStateException("loader blew up")
      }
      fail("Expected the loader's exception to propagate")
    } catch (expected: IllegalStateException) {
      assertEquals("loader blew up", expected.message)
    }

    assertEquals("Buffer must be freed when the loader throws", 1, free.calls.size)
  }

  @Test
  fun testAttachAssetRetainsBufferOnSuccess() {
    val free = RecordingFree()
    val glbBuffer = GlbBuffer(ByteBuffer.allocateDirect(128), ADDRESS, 128L, free)

    val holder = FilamentHelper.attachAsset(glbBuffer) { "asset" }

    assertEquals("asset", holder.asset)
    assertTrue("Buffer must stay alive for the holder", free.calls.isEmpty())
    holder.close()
    assertEquals(1, free.calls.size)
  }

  /**
   * Without the native library, callers should get an actionable [ThreeCompilerException] rather
   * than a bare `UnsatisfiedLinkError` from somewhere deep in the call stack.
   */
  @Test
  fun testCompileReportsMissingNativeLibrary() {
    assertFalse(
      "This host-side test must run without the native library",
      ThreeCompiler.isNativeLibraryLoaded,
    )

    try {
      runBlocking { ThreeCompiler.compile("scene.add(new THREE.Mesh());") }
      fail("Expected ThreeCompilerException when the native library is absent")
    } catch (e: ThreeCompilerException) {
      assertTrue(
        "Message should name the missing library: ${e.message}",
        e.message?.contains("libthree_live_compiler") == true,
      )
    }
  }

  @Test
  fun testThreeCompilerException() {
    val exception = ThreeCompilerException("Compilation syntax error", RuntimeException("cause"))
    assertEquals("Compilation syntax error", exception.message)
    assertNotNull(exception.cause)
  }

  @Test
  fun testSceneViewerIntentBuilder() {
    val uri =
      SceneViewerHelper.buildSceneViewerIntentUri(
        fileUri = "content://com.example.app.provider/models/sneaker.glb",
        mode = "ar_preferred",
        title = "Sneaker AR",
        resizable = true,
      )
    assertTrue(uri.startsWith("intent://arvr.google.com/scene-viewer/1.2?"))
    assertTrue(uri.contains("package=com.google.ar.core"))
    assertTrue(uri.contains("mode=ar_preferred"))
    assertTrue(uri.contains("title=Sneaker+AR"))
  }

  @Test
  fun testXRLiveSceneCoreHelperExtractsTraitsFromGlb() {
    val jsonChunk =
      """{"asset":{"version":"2.0"},"nodes":[{"name":"ShoeMesh","mesh":0,"extras":{"xr":{"grabbable":true,"billboard":"capsule","anchor":"horizontal","physics":"dynamic"}},"extensions":{"ANDROID_xr_scenecore":{"movable":{"systemMovable":true,"scaleInZ":true}}}}]}"""
    val jsonBytes = jsonChunk.toByteArray(Charsets.UTF_8)
    val paddedLen = (jsonBytes.size + 3) and -4
    val totalLen = 12 + 8 + paddedLen
    val glb = ByteBuffer.allocateDirect(totalLen).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    glb.putInt(0x46546C67) // "glTF"
    glb.putInt(2)
    glb.putInt(totalLen)
    glb.putInt(paddedLen)
    glb.putInt(0x4E4F534A) // "JSON"
    glb.put(jsonBytes)
    while (glb.position() < totalLen) {
      glb.put(0x20.toByte())
    }
    glb.rewind()

    var movableCount = 0
    var anchorCount = 0
    var billboardCount = 0
    var physicsCount = 0

    val traits =
      XRLiveSceneCoreHelper.applyTraitsFromGlb(
        glb,
        "RootSceneCoreEntity",
        object : SceneCoreComponentApplier<String> {
          override fun onAttachMovable(entity: String, node: XRLiveNodeTraits) {
            movableCount++
            assertEquals("ShoeMesh", node.name)
            assertTrue(node.grabbable)
            assertTrue(node.scalable)
          }

          override fun onAttachAnchor(entity: String, node: XRLiveNodeTraits) {
            anchorCount++
            assertEquals("horizontal", node.anchor)
          }

          override fun onAttachBillboard(entity: String, node: XRLiveNodeTraits) {
            billboardCount++
            assertEquals("capsule", node.billboard)
          }

          override fun onAttachPhysics(entity: String, node: XRLiveNodeTraits) {
            physicsCount++
            assertEquals("dynamic", node.physics)
          }
        },
      )

    assertEquals(1, traits.size)
    assertEquals(1, movableCount)
    assertEquals(1, anchorCount)
    assertEquals(1, billboardCount)
    assertEquals(1, physicsCount)
  }

  @Test
  fun testXRLiveSceneCoreHelperIgnoresNestedSpoofedNodeName() {
    val gltfJson =
      """
      {
        "asset": {"version": "2.0"},
        "nodes": [
          {
            "extras": {
              "untrustedField": {"name": "SpoofedMaliciousName"},
              "xr": {
                "grabbable": true
              }
            },
            "name": "AuthenticNodeName"
          }
        ]
      }
      """
        .trimIndent()
    val jsonBytes = gltfJson.toByteArray(Charsets.UTF_8)
    val paddedLen = (jsonBytes.size + 3) and -4
    val totalLen = 12 + 8 + paddedLen
    val glb = ByteBuffer.allocateDirect(totalLen).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    glb.putInt(0x46546C67)
    glb.putInt(2)
    glb.putInt(totalLen)
    glb.putInt(paddedLen)
    glb.putInt(0x4E4F534A)
    glb.put(jsonBytes)
    while (glb.position() < totalLen) {
      glb.put(0x20.toByte())
    }
    glb.rewind()

    val traits = XRLiveSceneCoreHelper.extractNodeTraits(glb)
    assertEquals(1, traits.size)
    assertEquals("AuthenticNodeName", traits[0].name)
    assertTrue(traits[0].grabbable)
  }

  @Test
  fun testSceneViewerHelperSchemeAllowlist() {
    val httpsIntent =
      SceneViewerHelper.buildSceneViewerIntentUri(
        fileUri = "https://example.com/model.glb",
        soundUri = "content://com.example.provider/audio.mp3",
      )
    assertTrue(httpsIntent.contains("file=https%3A%2F%2Fexample.com%2Fmodel.glb"))
    assertTrue(httpsIntent.contains("sound=content%3A%2F%2Fcom.example.provider%2Faudio.mp3"))

    val unsafeUris =
      listOf(
        "file:///sdcard/Download/model.glb",
        "javascript:alert(1)",
        "http://insecure.example.com/model.glb",
        "data:application/octet-stream;base64,AAAA",
        "https://example.com/bad\u0000.glb",
      )
    for (unsafe in unsafeUris) {
      try {
        SceneViewerHelper.buildSceneViewerIntentUri(fileUri = unsafe)
        fail("Expected IllegalArgumentException for unsafe fileUri: $unsafe")
      } catch (expected: IllegalArgumentException) {
        assertTrue(expected.message?.contains("Three-Live Security") == true)
      }
      try {
        SceneViewerHelper.buildSceneViewerIntentUri(
          fileUri = "https://example.com/ok.glb",
          soundUri = unsafe,
        )
        fail("Expected IllegalArgumentException for unsafe soundUri: $unsafe")
      } catch (expected: IllegalArgumentException) {
        assertTrue(expected.message?.contains("Three-Live Security") == true)
      }
    }
  }

  private companion object {
    /** Non-zero sentinel standing in for a real native address. */
    const val ADDRESS = 0x7F00_1234L
    const val FILL = 0xAB.toByte()
    const val POISON = 0xFF.toByte()

    /** Large enough that the copy in `toByteArray()` spans a meaningful window. */
    const val BUFFER_SIZE = 1 shl 18
    const val READER_THREADS = 4
    const val ITERATIONS = 50
  }
}
