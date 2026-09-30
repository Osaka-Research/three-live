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

import java.lang.ref.PhantomReference
import java.lang.ref.ReferenceQueue
import java.util.Collections
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.logging.Level
import java.util.logging.Logger

/**
 * Report of a [GlbBuffer] that became unreachable without [GlbBuffer.close] ever being called.
 *
 * @property address native heap address of the allocation that was reclaimed.
 * @property capacity size of the reclaimed allocation, in bytes.
 * @property allocationSite a throwable captured where the buffer was allocated, or `null` if
 *   [GlbBufferLeakDetector.captureAllocationSites] was disabled. This is the stack trace that
 *   identifies the code responsible for the leak; it is not an error that was ever thrown.
 */
class GlbBufferLeak
internal constructor(val address: Long, val capacity: Long, val allocationSite: Throwable?) {

  override fun toString(): String =
    "Leaked GlbBuffer: $capacity bytes of native memory at 0x${java.lang.Long.toHexString(address)}" +
      " were reclaimed by the leak detector because close() was never called. Use" +
      " `glbBuffer.use { ... }` to free the buffer deterministically."
}

/**
 * A [PhantomReference] to a [GlbBuffer] that carries everything needed to free the buffer's native
 * allocation after the buffer itself has been collected.
 *
 * Deliberately holds no strong reference to the [GlbBuffer]: only the address, the size, and the
 * deallocation hook. A phantom referent is never reachable through [get], so tracking a buffer
 * cannot keep it alive.
 */
internal class TrackedAllocation(
  buffer: GlbBuffer,
  queue: ReferenceQueue<GlbBuffer>,
  private val address: Long,
  private val capacity: Long,
  private val freeNative: (Long, Long) -> Unit,
  private val allocationSite: Throwable?,
) : PhantomReference<GlbBuffer>(buffer, queue) {

  /**
   * Whether this allocation's fate is already decided, either by an explicit `close()` or by the
   * reaper. Guarantees the native free happens at most once even if both race.
   */
  private val settled = AtomicBoolean(false)

  /**
   * Frees the allocation on behalf of a caller who forgot to.
   *
   * @return a [GlbBufferLeak] describing what was reclaimed, or `null` if the buffer had already
   *   been closed properly and there is therefore nothing to report.
   */
  fun reclaim(): GlbBufferLeak? {
    if (!settled.compareAndSet(false, true)) return null
    freeNative(address, capacity)
    return GlbBufferLeak(address, capacity, allocationSite)
  }

  /** Records that the owner closed this buffer correctly, suppressing any later leak report. */
  fun release() {
    settled.set(true)
  }
}

/**
 * Detects [GlbBuffer] instances that are garbage collected without having been closed, frees their
 * native memory, and reports them.
 *
 * ### Why this exists
 *
 * A [GlbBuffer] owns memory allocated by Rust, outside the JVM heap. The garbage collector will
 * happily reclaim the thin Kotlin wrapper while leaving the multi-megabyte native allocation behind
 * forever, with no diagnostic of any kind. This class converts that silent, unbounded leak into a
 * bounded one plus a loud warning naming the allocation site.
 *
 * It is a safety net, not a memory management strategy: reclamation happens at the garbage
 * collector's convenience, which may be long after the memory was last needed. Always prefer
 * `glbBuffer.use { ... }`.
 *
 * ### Implementation note
 *
 * `java.lang.ref.Cleaner` would be the natural tool here, but it requires API 33 and this library
 * supports API 24, so the equivalent machinery is built directly on [PhantomReference] and a
 * [ReferenceQueue] drained by a lazily started daemon thread.
 */
object GlbBufferLeakDetector {

  private val logger = Logger.getLogger(GlbBufferLeakDetector::class.java.name)

  private val queue = ReferenceQueue<GlbBuffer>()

  /**
   * Strong references to the outstanding [TrackedAllocation]s.
   *
   * A [PhantomReference] that is itself unreachable is never enqueued, so the detector must keep
   * every tracker alive until it has been dealt with.
   */
  private val live: MutableSet<TrackedAllocation> =
    Collections.newSetFromMap(ConcurrentHashMap<TrackedAllocation, Boolean>())

  private val reaperStarted = AtomicBoolean(false)

  /**
   * Whether leaked buffers are tracked at all. Defaults to `true`.
   *
   * Disabling this stops tracking of buffers allocated from that point on; buffers already being
   * tracked continue to be watched.
   */
  @Volatile @JvmStatic var enabled: Boolean = true

  /**
   * Whether to capture a stack trace at allocation so leak reports can name the responsible code.
   * Defaults to `true`.
   *
   * Capturing costs a few microseconds per buffer, which is negligible next to a compile, but it
   * can be disabled if buffers are ever allocated in a tight loop.
   */
  @Volatile @JvmStatic var captureAllocationSites: Boolean = true

  /**
   * Invoked once per detected leak, on the detector's internal reaper thread.
   *
   * The default implementation logs a warning through [java.util.logging]. Android applications
   * will typically want to replace this to route reports to logcat or to a crash reporter:
   * ```
   * GlbBufferLeakDetector.listener = { leak -> Log.w("ThreeLive", leak.toString(), leak.allocationSite) }
   * ```
   *
   * Implementations must not throw, and must not block; the reaper thread is shared by all buffers.
   */
  @Volatile
  @JvmStatic
  var listener: (GlbBufferLeak) -> Unit = { leak ->
    logger.log(Level.WARNING, leak.toString(), leak.allocationSite)
  }

  /**
   * Begins tracking [buffer].
   *
   * @param freeNative must not capture a strong reference to [buffer], or the buffer can never
   *   become unreachable and the leak will never be detected.
   * @return a handle to pass to [untrack] when the buffer is closed, or `null` if the buffer is not
   *   being tracked.
   */
  internal fun track(
    buffer: GlbBuffer,
    address: Long,
    capacity: Long,
    freeNative: (Long, Long) -> Unit,
  ): TrackedAllocation? {
    // Nothing to reclaim: an unknown address or an empty allocation owns no native memory.
    if (!enabled || address == 0L || capacity <= 0L) return null

    val site = if (captureAllocationSites) Throwable("GlbBuffer allocated here") else null
    val tracked = TrackedAllocation(buffer, queue, address, capacity, freeNative, site)
    live.add(tracked)
    startReaperOnce()
    return tracked
  }

  /** Stops tracking an allocation that its owner closed correctly. */
  internal fun untrack(tracked: TrackedAllocation?) {
    if (tracked == null) return
    tracked.release()
    live.remove(tracked)
    tracked.clear()
  }

  /** Number of buffers currently being watched. Visible for testing. */
  internal fun trackedCount(): Int = live.size

  private fun startReaperOnce() {
    if (!reaperStarted.compareAndSet(false, true)) return
    // A daemon thread so it can never keep a JVM or an Android process alive. It spends its entire
    // life blocked in ReferenceQueue.remove(), so an idle detector costs nothing but a stack.
    val reaper =
      Thread(::reapForever, "three-live-glb-buffer-leak-detector").apply {
        isDaemon = true
        priority = Thread.MIN_PRIORITY
      }
    reaper.start()
  }

  private fun reapForever() {
    while (true) {
      try {
        val tracked = queue.remove() as? TrackedAllocation ?: continue
        live.remove(tracked)
        val leak = tracked.reclaim() ?: continue
        try {
          listener(leak)
        } catch (e: RuntimeException) {
          // A misbehaving listener must not take down the reaper; the memory is already freed.
          logger.log(Level.WARNING, "GlbBufferLeakDetector.listener threw", e)
        }
      } catch (e: InterruptedException) {
        Thread.currentThread().interrupt()
        return
      }
    }
  }
}
