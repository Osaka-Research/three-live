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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Tests for the [GlbBufferLeakDetector] safety net.
 *
 * These tests genuinely depend on garbage collection, which cannot be forced. [provokeGc] drives
 * the collector hard and waits on a latch rather than sleeping a fixed interval, so the tests are
 * as fast as the collector allows and only fail after a long timeout. Each test uses a distinct
 * fake address and filters reports by it, so a leak escaping from an earlier test cannot be
 * mistaken for this one's.
 */
class GlbBufferLeakDetectorTest {

  private val reported = CopyOnWriteArrayList<GlbBufferLeak>()
  private val freed = CopyOnWriteArrayList<Pair<Long, Long>>()

  private var originalListener: (GlbBufferLeak) -> Unit = {}
  private var originalEnabled = true
  private var originalCaptureSites = true

  @Before
  fun captureDetectorState() {
    originalListener = GlbBufferLeakDetector.listener
    originalEnabled = GlbBufferLeakDetector.enabled
    originalCaptureSites = GlbBufferLeakDetector.captureAllocationSites
    GlbBufferLeakDetector.enabled = true
    GlbBufferLeakDetector.captureAllocationSites = true
  }

  @After
  fun restoreDetectorState() {
    GlbBufferLeakDetector.listener = originalListener
    GlbBufferLeakDetector.enabled = originalEnabled
    GlbBufferLeakDetector.captureAllocationSites = originalCaptureSites
  }

  /** Records the native free. Must not capture the buffer, or it could never be collected. */
  private fun recordingFree(): (Long, Long) -> Unit = { address, capacity ->
    freed.add(address to capacity)
  }

  /**
   * Allocates a buffer and drops it on the floor.
   *
   * Deliberately a separate, non-inlined function: a local in the calling test method can stay live
   * in the stack frame for the rest of the method and prevent collection.
   */
  private fun abandonBuffer(address: Long, free: (Long, Long) -> Unit) {
    // Bound to a local only because discarding a constructor result trips CheckReturnValue. The
    // local dies with this frame, which is exactly what the caller wants.
    val unused =
      GlbBuffer(ByteBuffer.allocateDirect(BUFFER_SIZE), address, BUFFER_SIZE.toLong(), free)
  }

  /** Allocates a buffer, closes it correctly, and drops it. */
  private fun closeAndAbandonBuffer(address: Long, free: (Long, Long) -> Unit) {
    GlbBuffer(ByteBuffer.allocateDirect(BUFFER_SIZE), address, BUFFER_SIZE.toLong(), free).close()
  }

  /**
   * Drives garbage collection until [latch] fires.
   *
   * @param attempts how many collection rounds to try; callers expecting *no* event should pass a
   *   small number, since for them every round is time spent proving a negative.
   * @return true if the latch fired within the budget.
   */
  private fun provokeGc(latch: CountDownLatch, attempts: Int = GC_ATTEMPTS): Boolean {
    repeat(attempts) {
      System.gc()
      System.runFinalization()
      if (latch.await(GC_POLL_MILLIS, TimeUnit.MILLISECONDS)) return true
      // Allocation pressure, in case a bare System.gc() is being ignored.
      @Suppress("UNUSED_VARIABLE") val ballast = ByteArray(BUFFER_SIZE)
    }
    return false
  }

  private fun listenerCountingDown(address: Long, latch: CountDownLatch) {
    GlbBufferLeakDetector.listener = { leak ->
      if (leak.address == address) {
        reported.add(leak)
        latch.countDown()
      }
    }
  }

  @Test
  fun testAbandonedBufferIsFreedAndReported() {
    val latch = CountDownLatch(1)
    listenerCountingDown(ABANDONED_ADDRESS, latch)

    abandonBuffer(ABANDONED_ADDRESS, recordingFree())

    assertTrue("Leak was never detected; the reaper did not run", provokeGc(latch))

    assertEquals(
      "The abandoned buffer's native memory must be freed exactly once",
      listOf(ABANDONED_ADDRESS to BUFFER_SIZE.toLong()),
      freed.toList(),
    )
    assertEquals(1, reported.size)
    val leak = reported.single()
    assertEquals(ABANDONED_ADDRESS, leak.address)
    assertEquals(BUFFER_SIZE.toLong(), leak.capacity)
    assertNotNull("The leak report must name the allocation site", leak.allocationSite)
  }

  @Test
  fun testCloseSuppressesTheLeakReport() {
    val latch = CountDownLatch(1)
    listenerCountingDown(CLOSED_ADDRESS, latch)

    closeAndAbandonBuffer(CLOSED_ADDRESS, recordingFree())

    // The latch must NOT fire. Timing out is the pass condition here, so use a short budget: if
    // the reaper were going to report this buffer it would do so within the first few collections.
    assertTrue(
      "A buffer that was closed correctly must not be reported as a leak",
      !provokeGc(latch, attempts = GC_ATTEMPTS_FOR_NON_EVENT),
    )
    assertEquals(
      "close() must free exactly once, and the reaper must not free it again",
      listOf(CLOSED_ADDRESS to BUFFER_SIZE.toLong()),
      freed.toList(),
    )
    assertTrue(reported.isEmpty())
  }

  @Test
  fun testListenerFailureDoesNotDisableTheDetector() {
    val firstLatch = CountDownLatch(1)
    val secondLatch = CountDownLatch(1)
    GlbBufferLeakDetector.listener = { leak ->
      when (leak.address) {
        THROWING_ADDRESS -> {
          firstLatch.countDown()
          throw IllegalStateException("listener is broken")
        }
        SURVIVOR_ADDRESS -> {
          reported.add(leak)
          secondLatch.countDown()
        }
        else -> {}
      }
    }

    abandonBuffer(THROWING_ADDRESS, recordingFree())
    assertTrue("First leak was never detected", provokeGc(firstLatch))

    abandonBuffer(SURVIVOR_ADDRESS, recordingFree())
    assertTrue(
      "A listener that threw must not stop later leaks from being reported",
      provokeGc(secondLatch),
    )

    assertEquals(listOf(SURVIVOR_ADDRESS), reported.map { it.address })
    assertTrue(
      "Both buffers must have been freed even though the listener threw",
      freed.map { it.first }.containsAll(listOf(THROWING_ADDRESS, SURVIVOR_ADDRESS)),
    )
  }

  @Test
  fun testDisabledDetectorTracksNothing() {
    GlbBufferLeakDetector.enabled = false
    val before = GlbBufferLeakDetector.trackedCount()

    val unused =
      GlbBuffer(
        ByteBuffer.allocateDirect(BUFFER_SIZE),
        ABANDONED_ADDRESS,
        BUFFER_SIZE.toLong(),
        NO_OP_FREE,
      )

    assertEquals(before, GlbBufferLeakDetector.trackedCount())
  }

  @Test
  fun testBuffersWithNothingToFreeAreNotTracked() {
    val before = GlbBufferLeakDetector.trackedCount()

    // A zero address means the native address could not be determined, and a zero capacity owns no
    // memory. Neither can be freed, so neither is worth watching.
    val unknownAddress =
      GlbBuffer(ByteBuffer.allocateDirect(BUFFER_SIZE), 0L, BUFFER_SIZE.toLong(), NO_OP_FREE)
    val emptyAllocation = GlbBuffer(ByteBuffer.allocateDirect(0), ABANDONED_ADDRESS, 0L, NO_OP_FREE)
    assertEquals(0L, unknownAddress.address)
    assertEquals(0L, emptyAllocation.capacity)

    assertEquals(before, GlbBufferLeakDetector.trackedCount())
  }

  @Test
  fun testAllocationSiteCaptureCanBeDisabled() {
    GlbBufferLeakDetector.captureAllocationSites = false
    val latch = CountDownLatch(1)
    listenerCountingDown(NO_SITE_ADDRESS, latch)

    abandonBuffer(NO_SITE_ADDRESS, recordingFree())

    assertTrue("Leak was never detected", provokeGc(latch))
    assertNull(reported.single().allocationSite)
  }

  @Test
  fun testLeakDescriptionNamesSizeAndAddress() {
    val description = GlbBufferLeak(0xDEADBEEF, 2048L, null).toString()

    assertTrue(description, description.contains("2048 bytes"))
    assertTrue(description, description.contains("deadbeef"))
    assertTrue("The report should tell the reader how to fix it", description.contains("use {"))
  }

  private companion object {
    // A distinct fake address per test, so reports cannot be confused across tests.
    const val ABANDONED_ADDRESS = 0x7F00_1000L
    const val CLOSED_ADDRESS = 0x7F00_2000L
    const val THROWING_ADDRESS = 0x7F00_3000L
    const val SURVIVOR_ADDRESS = 0x7F00_4000L
    const val NO_SITE_ADDRESS = 0x7F00_5000L

    const val BUFFER_SIZE = 1 shl 16

    /** Up to ~15 s before declaring the collector uncooperative. */
    const val GC_ATTEMPTS = 150
    const val GC_POLL_MILLIS = 100L

    /** Budget for tests whose pass condition is that nothing happens. */
    const val GC_ATTEMPTS_FOR_NON_EVENT = 20

    /** For buffers whose deallocation is irrelevant to what the test is asserting. */
    val NO_OP_FREE: (Long, Long) -> Unit = { _, _ -> }
  }
}
