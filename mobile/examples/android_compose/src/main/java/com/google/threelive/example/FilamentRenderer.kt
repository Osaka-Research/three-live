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

package com.google.threelive.example

import android.view.Choreographer
import android.view.Surface
import com.google.android.filament.*
import com.google.android.filament.gltfio.AssetLoader
import com.google.android.filament.gltfio.FilamentAsset
import com.google.android.filament.gltfio.Gltfio
import com.google.android.filament.gltfio.MaterialProvider
import com.google.android.filament.gltfio.ResourceLoader
import com.google.android.filament.gltfio.UbershaderProvider
import com.google.threelive.GlbBuffer
import java.nio.ByteBuffer

/**
 * Encapsulates the Google Filament 3D rendering pipeline for the Compose SurfaceView. Supports
 * zero-copy DirectByteBuffer GLB loading directly from ThreeCompiler.
 *
 * Filament is not thread-safe. Every method on this class must be called from the main thread.
 */
class FilamentRenderer : Choreographer.FrameCallback {

  private lateinit var engine: Engine
  private lateinit var renderer: Renderer
  private lateinit var scene: Scene
  private lateinit var view: View
  private lateinit var camera: Camera
  private var swapChain: SwapChain? = null

  private lateinit var assetLoader: AssetLoader
  private lateinit var materialProvider: MaterialProvider
  private lateinit var resourceLoader: ResourceLoader
  private var lightEntity: Int = 0
  private var currentAsset: FilamentAsset? = null

  private val choreographer = Choreographer.getInstance()
  private var surfaceWidth = 0
  private var surfaceHeight = 0
  private var rotationAngle = 0.0f
  private var lastFrameTimeNanos = 0L
  private var destroyed = false

  init {
    Filament.init()
    Gltfio.init()
  }

  fun initFilament() {
    engine = Engine.create()
    renderer = engine.createRenderer()
    scene = engine.createScene()
    view = engine.createView()
    camera = engine.createCamera(engine.entityManager.create())

    view.camera = camera
    view.scene = scene

    view.blendMode = View.BlendMode.OPAQUE

    // Set up lighting
    lightEntity = engine.entityManager.create()
    LightManager.Builder(LightManager.Type.DIRECTIONAL)
      .color(1.0f, 1.0f, 1.0f)
      .intensity(100_000.0f)
      .direction(0.0f, -1.0f, -1.0f)
      .castShadows(true)
      .build(engine, lightEntity)
    scene.addEntity(lightEntity)

    // Initialize GLTF AssetLoader & ResourceLoader
    materialProvider = UbershaderProvider(engine)
    assetLoader = AssetLoader(engine, materialProvider, engine.entityManager)
    resourceLoader = ResourceLoader(engine)
  }

  fun onSurfaceAvailable(surface: Surface, width: Int, height: Int) {
    surfaceWidth = width
    surfaceHeight = height
    // Defensive: SurfaceHolder.Callback should have delivered surfaceDestroyed first, but a
    // leaked swap chain here would be invisible, so never overwrite one that still exists.
    swapChain?.let { engine.destroySwapChain(it) }
    swapChain = engine.createSwapChain(surface)
    val safeWidth = width.coerceAtLeast(1)
    val safeHeight = height.coerceAtLeast(1)
    view.viewport = Viewport(0, 0, safeWidth, safeHeight)

    val aspect = safeWidth.toDouble() / safeHeight.toDouble()
    camera.setProjection(45.0, aspect, 0.1, 100.0, Camera.Fov.VERTICAL)
    camera.lookAt(0.0, 1.5, 4.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0)

    // Restart the frame clock so the first frame after a resume sees a zero delta rather than
    // the entire time spent backgrounded.
    lastFrameTimeNanos = 0L
    choreographer.postFrameCallback(this)
  }

  fun onSurfaceResized(width: Int, height: Int) {
    surfaceWidth = width
    surfaceHeight = height
    val safeWidth = width.coerceAtLeast(1)
    val safeHeight = height.coerceAtLeast(1)
    view.viewport = Viewport(0, 0, safeWidth, safeHeight)
    val aspect = safeWidth.toDouble() / safeHeight.toDouble()
    camera.setProjection(45.0, aspect, 0.1, 100.0, Camera.Fov.VERTICAL)
  }

  fun onSurfaceDestroyed() {
    choreographer.removeFrameCallback(this)
    lastFrameTimeNanos = 0L
    swapChain?.let {
      engine.destroySwapChain(it)
      swapChain = null
    }
  }

  /**
   * Loads a compiled GLB model from a DirectByteBuffer.
   *
   * The caller retains ownership of [buffer]. It is safe to free it as soon as this method returns:
   * loading is fully synchronous and `releaseSourceData()` has already run by then.
   */
  fun loadGlbBuffer(buffer: ByteBuffer) {
    destroyCurrentAsset()
    buffer.rewind()
    val asset = assetLoader.createAsset(buffer) ?: return
    // createAsset does not copy: the source bytes must stay valid until loadResources()
    // completes and releaseSourceData() has been called. Both happen synchronously here.
    resourceLoader.loadResources(asset)
    asset.releaseSourceData()
    scene.addEntities(asset.entities)
    currentAsset = asset
  }

  /**
   * Loads a compiled GLB model from a [GlbBuffer], taking ownership of it.
   *
   * The native buffer is freed as soon as Filament has finished reading it, which is before this
   * method returns.
   */
  fun loadGlb(glbBuffer: GlbBuffer) {
    glbBuffer.use { loadGlbBuffer(it.byteBuffer) }
  }

  private fun destroyCurrentAsset() {
    currentAsset?.let {
      resourceLoader.evictResourceData()
      scene.removeEntities(it.entities)
      assetLoader.destroyAsset(it)
      currentAsset = null
    }
  }

  override fun doFrame(frameTimeNanos: Long) {
    choreographer.postFrameCallback(this)

    val sc = swapChain ?: return
    if (renderer.beginFrame(sc, frameTimeNanos)) {
      // Advance by elapsed time, not per frame, so the camera orbits at the same speed on
      // 60 Hz and 120 Hz displays.
      val deltaSeconds =
        if (lastFrameTimeNanos == 0L) {
          0.0f
        } else {
          ((frameTimeNanos - lastFrameTimeNanos) / NANOS_PER_SECOND).toFloat()
        }
      lastFrameTimeNanos = frameTimeNanos

      // Wrapping keeps the magnitude small, so float precision stays constant no matter how
      // long the app runs.
      rotationAngle = (rotationAngle + ORBIT_RADIANS_PER_SECOND * deltaSeconds) % TWO_PI

      val camX = ORBIT_RADIUS * kotlin.math.sin(rotationAngle.toDouble())
      val camZ = ORBIT_RADIUS * kotlin.math.cos(rotationAngle.toDouble())
      camera.lookAt(camX, 1.2, camZ, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0)

      renderer.render(view)
      renderer.endFrame()
    }
  }

  /** Tears down all Filament resources. Safe to call more than once, or before [initFilament]. */
  fun destroy() {
    if (destroyed || !::engine.isInitialized) return
    destroyed = true

    choreographer.removeFrameCallback(this)
    destroyCurrentAsset()

    resourceLoader.destroy()
    assetLoader.destroy()
    // The provider caches Materials that it does not free on destroy(); they must be released
    // explicitly or they outlive the Engine.
    materialProvider.destroyMaterials()
    materialProvider.destroy()

    if (lightEntity != 0) {
      scene.removeEntity(lightEntity)
      engine.lightManager.destroy(lightEntity)
      engine.entityManager.destroy(lightEntity)
      lightEntity = 0
    }
    swapChain?.let {
      engine.destroySwapChain(it)
      swapChain = null
    }

    // Drain in-flight GPU commands before destroying the objects they reference.
    engine.flushAndWait()

    engine.destroyRenderer(renderer)
    engine.destroyView(view)
    engine.destroyScene(scene)
    engine.destroyCameraComponent(camera.entity)
    engine.entityManager.destroy(camera.entity)
    engine.destroy()
  }

  private companion object {
    const val NANOS_PER_SECOND = 1_000_000_000.0
    const val TWO_PI = (2.0 * Math.PI).toFloat()
    /** Matches the previous fixed rate of 0.01 rad/frame at 60 Hz. */
    const val ORBIT_RADIANS_PER_SECOND = 0.6f
    const val ORBIT_RADIUS = 3.8
  }
}
