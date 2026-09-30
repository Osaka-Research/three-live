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

import java.nio.Buffer

/**
 * Interface representing a generic Filament or 3D engine asset loader. Compatible with
 * `com.google.android.filament.gltfio.AssetLoader`.
 */
fun interface GlbAssetConsumer<T> {
  fun loadFromBinary(buffer: Buffer): T?
}

/**
 * Container pairing an engine asset with its underlying native [GlbBuffer].
 *
 * Implements [AutoCloseable] to ensure the native buffer is kept alive while the 3D asset is loaded
 * in the engine, and safely freed when closed.
 *
 * This is deliberately *not* a `data class`: it owns a native resource, so a generated `copy()`
 * would hand out a second owner of the same allocation, and structural `equals`/`hashCode` on a
 * resource handle are meaningless.
 */
class GlbAssetHolder<T>(val asset: T?, val buffer: GlbBuffer) : AutoCloseable {
  override fun close() {
    buffer.close()
  }
}

/**
 * Helper utilities for integrating `ThreeCompiler` with native Android 3D engines like Google
 * Filament.
 */
object FilamentHelper {

  /**
   * Compiles a Three.js script on a background thread and streams the resulting binary GLB directly
   * into the native 3D engine with ZERO memory copies.
   *
   * Returns a [GlbAssetHolder] retaining the native buffer. The caller MUST keep the holder alive
   * until Filament completes resource uploading (`releaseSourceData()`) or call
   * [GlbAssetHolder.close] when destroying the asset.
   *
   * If [loader] throws, the native buffer is freed before the exception propagates, so a failed
   * load cannot leak native memory.
   *
   * @param script The Three.js script to compile.
   * @param loader A lambda or asset loader accepting a [java.nio.Buffer].
   * @return The [GlbAssetHolder] containing the loaded asset and native buffer.
   */
  suspend fun <T> loadModelZeroCopy(
    script: String,
    loader: GlbAssetConsumer<T>,
  ): GlbAssetHolder<T> = attachAsset(ThreeCompiler.compile(script), loader)

  /**
   * Hands [glbBuffer] to [loader] and wraps the result, transferring ownership of the buffer to the
   * returned holder.
   *
   * Split out from [loadModelZeroCopy] so that the failure path is reachable in unit tests without
   * a native library present.
   *
   * @throws Throwable whatever [loader] threw, after closing [glbBuffer].
   */
  internal fun <T> attachAsset(
    glbBuffer: GlbBuffer,
    loader: GlbAssetConsumer<T>,
  ): GlbAssetHolder<T> {
    return try {
      GlbAssetHolder(loader.loadFromBinary(glbBuffer.byteBuffer), glbBuffer)
    } catch (t: Throwable) {
      // Ownership never reached the holder, so nothing else will ever free this.
      glbBuffer.close()
      throw t
    }
  }

  /**
   * Executes [block] with a compiled zero-copy [Buffer], freeing the native buffer as soon as
   * [block] returns.
   *
   * > **Warning:** this is only safe for consumers that fully consume or copy the bytes before
   * > returning. Do **NOT** use it with `AssetLoader.createAsset()`: Filament's glTF loader does
   * > not copy the source data, and requires it to stay valid until `ResourceLoader
   * > .loadResources()` has completed and `FilamentAsset.releaseSourceData()` has been called.
   * > Passing a buffer that this function then frees is a use-after-free. > For Filament, use
   * > [loadModelZeroCopy], which retains the buffer for you.
   *
   * [block] must not retain the [Buffer], or anything referencing it, beyond its own return.
   */
  suspend fun <R> withTransientBuffer(script: String, block: (Buffer) -> R): R {
    return ThreeCompiler.compile(script).use { holder -> block(holder.byteBuffer) }
  }
}
