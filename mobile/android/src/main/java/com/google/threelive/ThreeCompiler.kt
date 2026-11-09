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
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.withContext

/** Exception thrown when procedural Three.js scene compilation fails. */
class ThreeCompilerException(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * Encapsulates a zero-copy direct memory buffer containing binary GLB data.
 *
 * The buffer is allocated on the native heap by Rust without JVM garbage collection overhead.
 * Implements [AutoCloseable] so developers can use Kotlin's [use] block to guarantee prompt native
 * memory release.
 *
 * ### Thread safety
 *
 * [close] and [toByteArray] are safe to call concurrently from any thread: both synchronize on this
 * instance, so a buffer can never be freed while a read of it is in flight.
 *
 * Reading [byteBuffer] directly is **not** protected by that guarantee. Direct readers are
 * responsible for ensuring the buffer outlives every use of the returned [ByteBuffer] — see the
 * warning on [byteBuffer].
 */
class GlbBuffer
internal constructor(
  /**
   * The direct [ByteBuffer] view of the native allocation.
   *
   * Reading this is the zero-copy fast path and is the right choice for native renderers such as
   * Google Filament.
   *
   * > **Warning:** this is a view onto memory owned by [GlbBuffer]. Once [close] runs, the memory
   * > is freed and any retained reference to this [ByteBuffer] dangles. Never let a reference to it
   * > outlive the owning [GlbBuffer].
   */
  val byteBuffer: ByteBuffer,
  /** Native heap address of the allocation, or `0` if it could not be determined. */
  val address: Long,
  /** Size of the native allocation in bytes. */
  val capacity: Long,
  /**
   * Deallocation hook. Injectable so unit tests can observe the native free without loading the
   * native library; production callers always get the real JNI free.
   */
  private val freeNative: (Long, Long) -> Unit = ThreeCompiler::nativeFreeDirectBuffer,
) : AutoCloseable {

  /** Total size of the binary GLB buffer in bytes. */
  val size: Int
    get() = capacity.toInt()

  @Volatile private var isClosed = false

  /**
   * Registration with the leak detector, or `null` if this buffer is not being tracked.
   *
   * Passing `this` out of a constructor is normally a hazard, but a
   * [java.lang.ref.PhantomReference] never exposes its referent, so the partially constructed
   * instance cannot be observed.
   */
  private val tracked = GlbBufferLeakDetector.track(this, address, capacity, freeNative)

  /** Deallocates the native heap memory. Safe to call multiple times and from any thread. */
  override fun close() {
    if (isClosed) return
    synchronized(this) {
      if (isClosed) return
      isClosed = true
      // Before the free, so a leak is never reported for a buffer that was closed correctly.
      GlbBufferLeakDetector.untrack(tracked)
      if (address != 0L && capacity > 0L) {
        freeNative(address, capacity)
      }
    }
  }

  /**
   * Creates a copy of the GLB wire bytes into a standard JVM heap [ByteArray]. For high-performance
   * 3D rendering (e.g. Filament), prefer using [byteBuffer] directly.
   *
   * @throws IllegalStateException if the buffer has already been closed.
   */
  fun toByteArray(): ByteArray =
    // Synchronized on the same monitor as close(): checking isClosed outside this block would be a
    // time-of-check/time-of-use race in which a concurrent close() frees the native allocation
    // between the check and the read below, producing a use-after-free.
    synchronized(this) {
      check(!isClosed) { "Cannot read from closed GlbBuffer" }
      val duplicate = byteBuffer.duplicate()
      duplicate.clear()
      val bytes = ByteArray(duplicate.remaining())
      duplicate.get(bytes)
      bytes
    }

  /**
   * Writes the GLB wire bytes to [targetFile] atomically while holding the buffer monitor so
   * [close] cannot race with the file write.
   *
   * @throws IllegalStateException if the buffer has already been closed.
   */
  fun writeToFile(targetFile: java.io.File): java.io.File =
    synchronized(this) {
      check(!isClosed) { "Cannot read from closed GlbBuffer" }
      val parentDir = targetFile.parentFile
      parentDir?.mkdirs()
      val tempFile =
        java.io.File.createTempFile(
          ".${targetFile.name}.",
          ".tmp",
          parentDir ?: targetFile.absoluteFile.parentFile,
        )
      try {
        val duplicate = byteBuffer.duplicate()
        duplicate.clear()
        java.io.FileOutputStream(tempFile).use { fos ->
          val channel = fos.channel
          while (duplicate.hasRemaining()) {
            channel.write(duplicate)
          }
        }
        if (!tempFile.renameTo(targetFile)) {
          tempFile.copyTo(targetFile, overwrite = true)
          tempFile.delete()
        }
      } catch (t: Throwable) {
        tempFile.delete()
        throw t
      }
      targetFile
    }
}

/** High-performance, in-process procedural Three.js to binary glTF 2.0 (GLB) compiler. */
object ThreeCompiler {

  /**
   * Whether `libthree_live_compiler` was loaded successfully.
   *
   * This is `false` in host-side JVM unit tests, where the native library is not on the library
   * path. Every entry point that requires native code checks it and reports an actionable error
   * rather than surfacing a bare `UnsatisfiedLinkError` from an arbitrary call site.
   */
  @JvmStatic
  var isNativeLibraryLoaded = false
    private set

  /**
   * Single-threaded dispatcher for compilation.
   *
   * The native compiler caches a warmed JavaScript VM in thread-local storage, so each distinct
   * thread that calls into it materializes and retains its own VM. Running on the shared
   * [Dispatchers.Default] pool would therefore create up to one cached VM per CPU core and pay the
   * cold-start cost on each new thread. Confining compilation to one thread keeps exactly one VM
   * alive and makes every call after the first a warm one. Compilation stays off the main thread
   * and is already effectively serialized by callers.
   */
  @OptIn(ExperimentalCoroutinesApi::class)
  private val compilerDispatcher: CoroutineDispatcher = Dispatchers.Default.limitedParallelism(1)

  init {
    try {
      System.loadLibrary("three_live_compiler")
      isNativeLibraryLoaded = true
    } catch (e: UnsatisfiedLinkError) {
      // Expected in host unit tests without the native lib; logged rather than thrown so that
      // pure-JVM tests of the Kotlin layer can still run.
      System.err.println(
        "ThreeCompiler: Native library libthree_live_compiler not found on library path: ${e.message}"
      )
    }
  }

  /**
   * Compiles a Three.js scene script into a zero-copy direct [ByteBuffer].
   *
   * Incurs zero heap copies across the JNI boundary. The returned direct buffer references native
   * heap memory and must be freed via [nativeFreeDirectBuffer].
   */
  @JvmStatic
  @Throws(ThreeCompilerException::class)
  external fun compileToDirectBuffer(script: String): ByteBuffer

  /** Compiles a Three.js scene script into a standard Java heap [ByteArray]. */
  @JvmStatic
  @Throws(ThreeCompilerException::class)
  external fun compileToByteArray(script: String): ByteArray

  /**
   * Deallocates the native memory backing a direct [ByteBuffer].
   *
   * Registered as a standard JNI method. It is deliberately *not* `@CriticalNative`: the native
   * side validates the address against an ownership registry guarded by a mutex, and a
   * `@CriticalNative` method keeps its thread `Runnable` (unsuspendable by the GC), where blocking
   * on a lock can stall collection process-wide.
   */
  @JvmStatic external fun nativeFreeDirectBuffer(address: Long, capacity: Long)

  /** Retrieves the native memory address backing a direct [ByteBuffer]. */
  @JvmStatic external fun nativeGetDirectBufferAddress(buffer: ByteBuffer): Long

  /**
   * Runs one AI scene-editing / voice-protocol JSON request in the shared Rust core (see
   * `three_live_ai_call`). Always returns JSON; failures come back as `{"error": ...}`.
   */
  @JvmStatic external fun nativeAiCall(request: String): String

  /**
   * Compiles a Three.js script on a background coroutine thread and wraps the resulting direct
   * memory buffer in an [AutoCloseable] [GlbBuffer].
   *
   * > **Note:** the underlying native call is blocking and cannot be interrupted. Cancelling the
   * > calling coroutine will not abort an in-flight compilation; cancellation is observed only once
   * > the native call returns. Runtime is bounded by the compiler's internal execution ceilings.
   *
   * @param script The JavaScript Three.js scene definition code.
   * @return A [GlbBuffer] that can be passed directly to native renderers like Google Filament.
   * @throws ThreeCompilerException if the native library is unavailable or compilation fails.
   */
  suspend fun compile(script: String): GlbBuffer =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      val buffer = compileToDirectBuffer(script)
      val capacity = buffer.capacity().toLong()
      GlbBuffer(buffer, extractDirectAddress(buffer), capacity)
    }

  /** Compiles a Three.js script on a background coroutine thread into a standard [ByteArray]. */
  suspend fun compileToBytes(script: String): ByteArray =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      compileToByteArray(script)
    }

  /**
   * Runs an AI core request that compiles scripts (`validate`) on the compiler thread, so it
   * reuses the warm JavaScript VM.
   */
  suspend fun aiCall(request: String): String =
    withContext(compilerDispatcher) {
      checkNativeLibraryLoaded()
      nativeAiCall(request)
    }

  /**
   * Runs a pure AI core request (prompts, parsing, voice protocol) off the compiler thread, so it
   * never waits behind a compile.
   */
  suspend fun aiCallPure(request: String): String =
    withContext(Dispatchers.Default) {
      checkNativeLibraryLoaded()
      nativeAiCall(request)
    }

  private fun checkNativeLibraryLoaded() {
    if (!isNativeLibraryLoaded) {
      throw ThreeCompilerException(
        "libthree_live_compiler is not loaded. Ensure the AAR ships a .so for this device's ABI " +
          "(arm64-v8a, armeabi-v7a, x86_64) and that it was not stripped by packaging."
      )
    }
  }

  /**
   * Extracts the 64-bit native memory address from a direct [ByteBuffer].
   *
   * A zero address is treated as a hard error rather than being tolerated. Without the address,
   * [GlbBuffer.close] has nothing to hand back to the native allocator, so the allocation would
   * leak for the life of the process *and* leave a permanently stranded entry in the native
   * ownership registry — silently, with the buffer still presenting itself as valid and closable.
   * The allocation is unreachable either way at this point; failing loudly at least makes the
   * problem diagnosable instead of turning it into an unbounded leak.
   */
  private fun extractDirectAddress(buffer: ByteBuffer): Long {
    val address =
      if (!buffer.isDirect) {
        0L
      } else {
        try {
          nativeGetDirectBufferAddress(buffer)
        } catch (e: UnsatisfiedLinkError) {
          throw ThreeCompilerException("Failed to resolve direct buffer address", e)
        }
      }
    if (address == 0L) {
      throw ThreeCompilerException(
        "Compiler returned a buffer with no resolvable native address " +
          "(isDirect=${buffer.isDirect}); refusing to return a buffer that can never be freed."
      )
    }
    return address
  }
}
