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

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Choreographer
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.SurfaceHolder
import android.view.SurfaceView
import android.view.View
import com.google.android.filament.Box
import com.google.android.filament.Camera
import com.google.android.filament.Engine
import com.google.android.filament.EntityManager
import com.google.android.filament.Filament
import com.google.android.filament.IndexBuffer
import com.google.android.filament.IndirectLight
import com.google.android.filament.LightManager
import com.google.android.filament.Material
import com.google.android.filament.MaterialInstance
import com.google.android.filament.RenderableManager
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.SwapChain
import com.google.android.filament.Texture
import com.google.android.filament.TextureSampler
import com.google.android.filament.VertexBuffer
import com.google.android.filament.Viewport
import com.google.android.filament.gltfio.AssetLoader
import com.google.android.filament.gltfio.FilamentAsset
import com.google.android.filament.gltfio.Gltfio
import com.google.android.filament.gltfio.ResourceLoader
import com.google.android.filament.gltfio.UbershaderProvider
import com.google.threelive.CapturedFrame
import com.google.threelive.GltfSceneIndex
import com.google.threelive.OrbitCameraState
import com.google.threelive.SplatParser
import com.google.threelive.ThreeLiveCameraOptions
import com.google.threelive.ThreeLivePick
import com.google.threelive.ThreeLivePointer
import com.google.threelive.ThreeLiveRenderer
import com.google.threelive.ThreeLiveRendererListener
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors

/**
 * [ThreeLiveRenderer] backed by Filament and gltfio.
 *
 * Renders the loaded GLB with an orbit camera matching the web viewer, maps glTF nodes to gltfio
 * entities for runtime transform / visibility / material changes, plays glTF animations, picks
 * with `View.pick`, and draws dynamic meshes for XR Blocks features. Every method must be called on
 * the main thread (Filament is not thread-safe).
 */
class ThreeLiveFilamentRenderer(context: Context) : ThreeLiveRenderer {

  override var listener: ThreeLiveRendererListener? = null

  /** The orbit camera model (exposed for hosts that drive the camera themselves). */
  val orbit: OrbitCameraState = OrbitCameraState()

  private val appContext = context.applicationContext
  private val engine: Engine
  private val renderer: Renderer
  private val scene: Scene
  private val filamentView: com.google.android.filament.View
  private val camera: Camera
  private val sunEntity: Int
  private val indirectLight: IndirectLight
  private val materialProvider: UbershaderProvider
  private val assetLoader: AssetLoader
  private val resourceLoader: ResourceLoader

  private var surfaceView: SurfaceView? = null
  private var swapChain: SwapChain? = null
  private var viewportWidth = 1
  private var viewportHeight = 1

  private var asset: FilamentAsset? = null
  private var sceneIndex: GltfSceneIndex? = null
  private var nodeEntities = IntArray(0)
  private val entityToNode = HashMap<Int, Int>()
  private val hiddenEntities = HashSet<Int>()
  private var materialInstances: Array<MutableList<MaterialInstance>> = emptyArray()

  private var playingAnimation: Int? = null
  private var animationTime = 0.0

  private val dynamicMeshes = HashMap<Int, DynamicMesh>()
  private var nextDynamicId = 1
  private var templateAsset: FilamentAsset? = null
  private var templateMaterial: MaterialInstance? = null
  private var splatTemplateAsset: FilamentAsset? = null
  private var splatTemplateMaterial: MaterialInstance? = null
  private var compiledSplatMaterial: Material? = null
  private var gaussianTexture: Texture? = null
  private val hasFilamatAsset: Boolean =
    try {
      appContext.assets.open(SPLAT_FILAMAT_ASSET).close()
      true
    } catch (e: Throwable) {
      false
    }

  override val supportsGpuSplats: Boolean
    get() = hasFilamatAsset

  private val choreographer = Choreographer.getInstance()
  private val mainHandler = Handler(Looper.getMainLooper())
  private var lastFrameNanos = 0L
  private var pointerDown = false
  private var disposed = false

  private var pendingCapture: Pair<Int, (CapturedFrame?) -> Unit>? = null
  private var captureInFlight = false
  private val encoder = Executors.newSingleThreadExecutor { r -> Thread(r, "three-live-capture").apply { isDaemon = true } }
  private val cameraWorld = FloatArray(16)
  private val projScratch = DoubleArray(16)
  private val eye = DoubleArray(3)
  private val target = DoubleArray(3)
  private val rootMatrix = FloatArray(16)
  private val scratch16 = FloatArray(16)

  private val frameCallback =
    object : Choreographer.FrameCallback {
      override fun doFrame(frameTimeNanos: Long) {
        renderFrame(frameTimeNanos)
      }
    }

  init {
    Filament.init()
    Gltfio.init()
    engine = Engine.create()
    renderer = engine.createRenderer()
    scene = engine.createScene()
    filamentView = engine.createView()
    camera = engine.createCamera(engine.entityManager.create())
    filamentView.camera = camera
    filamentView.scene = scene
    renderer.clearOptions =
      Renderer.ClearOptions().apply {
        clear = true
        clearColor = floatArrayOf(0.94f, 0.95f, 0.97f, 1f)
      }

    sunEntity = EntityManager.get().create()
    LightManager.Builder(LightManager.Type.DIRECTIONAL)
      .color(1f, 1f, 1f)
      .intensity(SUN_LUX)
      .direction(-0.3f, -1f, -0.5f)
      .castShadows(true)
      .build(engine, sunEntity)
    scene.addEntity(sunEntity)

    // Neutral, uniform ambient light (first SH band only) so unlit sides are not black.
    indirectLight =
      IndirectLight.Builder().irradiance(1, floatArrayOf(1f, 1f, 1f)).intensity(AMBIENT_LUX).build(engine)
    scene.indirectLight = indirectLight

    materialProvider = UbershaderProvider(engine)
    assetLoader = AssetLoader(engine, materialProvider, EntityManager.get())
    resourceLoader = ResourceLoader(engine)
  }

  @SuppressLint("ClickableViewAccessibility")
  override fun createView(context: Context): View {
    surfaceView?.let { return it }
    val sv = SurfaceView(context)
    sv.holder.addCallback(
      object : SurfaceHolder.Callback {
        override fun surfaceCreated(holder: SurfaceHolder) {
          if (disposed) return
          swapChain?.let { engine.destroySwapChain(it) }
          swapChain = engine.createSwapChain(holder.surface)
          lastFrameNanos = 0L
          choreographer.postFrameCallback(frameCallback)
        }

        override fun surfaceChanged(holder: SurfaceHolder, format: Int, width: Int, height: Int) {
          viewportWidth = width.coerceAtLeast(1)
          viewportHeight = height.coerceAtLeast(1)
          filamentView.viewport = Viewport(0, 0, viewportWidth, viewportHeight)
        }

        override fun surfaceDestroyed(holder: SurfaceHolder) {
          choreographer.removeFrameCallback(frameCallback)
          swapChain?.let {
            engine.destroySwapChain(it)
            // The surface is gone once this returns, so wait for Filament to release it.
            engine.flushAndWait()
          }
          swapChain = null
        }
      }
    )
    sv.setOnTouchListener(TouchHandler(context))
    surfaceView = sv
    return sv
  }

  override fun load(glb: ByteBuffer) {
    if (disposed) return
    destroyAsset()
    clearDynamicMeshes()
    val index = GltfSceneIndex.fromGlb(glb) ?: return
    val src = glb.duplicate()
    src.rewind()
    val loaded = assetLoader.createAsset(src) ?: return
    resourceLoader.loadResources(loaded)
    scene.addEntities(loaded.entities)
    asset = loaded
    sceneIndex = index
    mapNodes(loaded, index)
    loaded.releaseSourceData()

    val box = loaded.boundingBox
    val c = box.center
    val h = box.halfExtent
    val radius = Math.sqrt((h[0] * h[0] + h[1] * h[1] + h[2] * h[2]).toDouble())
    orbit.setBounds(doubleArrayOf(c[0].toDouble(), c[1].toDouble(), c[2].toDouble()), radius)
    val animCount = loaded.instance?.animator?.animationCount ?: 0
    playingAnimation = if (animCount > 0) -1 else null
    animationTime = 0.0
  }

  override fun setCameraOptions(options: ThreeLiveCameraOptions) {
    orbit.applyOptions(options)
    orbit.snap()
  }

  override fun setNodeTransform(nodeIndex: Int, translation: FloatArray, rotation: FloatArray, scale: FloatArray) {
    val entity = nodeEntities.getOrElse(nodeIndex) { 0 }
    if (entity == 0) return
    val tm = engine.transformManager
    val ti = tm.getInstance(entity)
    if (ti == 0) return
    tm.setTransform(ti, composeTrs(translation, rotation, scale, scratch16))
  }

  override fun setNodeVisible(nodeIndex: Int, visible: Boolean) {
    val entity = nodeEntities.getOrElse(nodeIndex) { 0 }
    if (entity == 0) return
    val rm = engine.renderableManager
    val ri = rm.getInstance(entity)
    if (visible) hiddenEntities.remove(entity) else hiddenEntities.add(entity)
    if (ri != 0) rm.setLayerMask(ri, 0xFF, if (visible) VISIBLE_LAYER else 0)
  }

  override fun setMaterialFactors(
    materialIndex: Int,
    baseColorFactor: FloatArray,
    emissiveFactor: FloatArray,
    metallicFactor: Float,
    roughnessFactor: Float,
  ) {
    for (mi in materialInstances.getOrNull(materialIndex) ?: return) {
      val m = mi.material
      if (m.hasParameter("baseColorFactor") && baseColorFactor.size >= 4) {
        mi.setParameter("baseColorFactor", baseColorFactor[0], baseColorFactor[1], baseColorFactor[2], baseColorFactor[3])
      }
      if (m.hasParameter("emissiveFactor") && emissiveFactor.size >= 3) {
        mi.setParameter("emissiveFactor", emissiveFactor[0], emissiveFactor[1], emissiveFactor[2])
      }
      if (m.hasParameter("metallicFactor")) mi.setParameter("metallicFactor", metallicFactor)
      if (m.hasParameter("roughnessFactor")) mi.setParameter("roughnessFactor", roughnessFactor)
    }
  }

  override fun setMaterialAlphaCutoff(materialIndex: Int, alphaCutoff: Float) {
    for (mi in materialInstances.getOrNull(materialIndex) ?: return) {
      if (mi.material.blendingMode == Material.BlendingMode.MASKED) mi.setMaskThreshold(alphaCutoff)
    }
  }

  override fun sceneRootMatrix(out: FloatArray): Boolean {
    if (asset == null || out.size < 16) return false
    orbit.turntableMatrix(out)
    return true
  }

  override fun cameraMatrices(world: FloatArray, projection: FloatArray): Boolean {
    if (disposed || world.size < 16 || projection.size < 16 || viewportWidth <= 0) return false
    // Not rendered yet: the camera matrix is written on the first frame.
    if (cameraWorld[15] == 0f) return false
    System.arraycopy(cameraWorld, 0, world, 0, 16)
    val m = camera.getProjectionMatrix(projScratch)
    for (i in 0 until 16) projection[i] = m[i].toFloat()
    return true
  }

  override fun playAnimation(animationIndex: Int) {
    val count = asset?.instance?.animator?.animationCount ?: 0
    if (animationIndex >= count) return
    playingAnimation = animationIndex
    animationTime = 0.0
  }

  override fun stopAnimation() {
    playingAnimation = null
  }

  override fun addDynamicMesh(positions: FloatArray, normals: FloatArray?, indices: IntArray, color: FloatArray): Int {
    if (disposed) return -1
    val material = dynamicMaterial() ?: return -1
    val mi = MaterialInstance.duplicate(material, "three-live-dynamic")
    setColor(mi, color)
    val entity = EntityManager.get().create()
    val mesh = DynamicMesh(entity, mi)
    if (!uploadGeometry(mesh, positions, indices, create = true)) {
      engine.destroyMaterialInstance(mi)
      EntityManager.get().destroy(entity)
      return -1
    }
    scene.addEntity(entity)
    val id = nextDynamicId++
    dynamicMeshes[id] = mesh
    return id
  }

  override fun updateDynamicMesh(meshId: Int, positions: FloatArray, normals: FloatArray?, indices: IntArray) {
    val mesh = dynamicMeshes[meshId] ?: return
    uploadGeometry(mesh, positions, indices, create = false)
  }

  override fun setDynamicMeshTransform(meshId: Int, matrix: FloatArray) {
    val mesh = dynamicMeshes[meshId] ?: return
    if (matrix.size < 16) return
    val tm = engine.transformManager
    if (!tm.hasComponent(mesh.entity)) tm.create(mesh.entity)
    tm.setTransform(tm.getInstance(mesh.entity), matrix)
  }

  override fun setDynamicMeshColor(meshId: Int, color: FloatArray) {
    dynamicMeshes[meshId]?.let { setColor(it.material, color) }
  }

  override fun removeDynamicMesh(meshId: Int) {
    dynamicMeshes.remove(meshId)?.let { destroyDynamicMesh(it) }
  }

  override fun addSplatMesh(
    positions: FloatArray,
    uvs: FloatArray,
    colors: ByteArray,
    indices: IntArray,
  ): Int {
    if (disposed) return -1
    val material = splatMaterial() ?: return -1
    val mi = MaterialInstance.duplicate(material, "three-live-splat")
    mi.setDepthWrite(false)
    val entity = EntityManager.get().create()
    val mesh = DynamicMesh(entity, mi)
    if (!uploadSplatGeometry(mesh, positions, uvs, colors, indices, create = true)) {
      engine.destroyMaterialInstance(mi)
      EntityManager.get().destroy(entity)
      return -1
    }
    scene.addEntity(entity)
    val id = nextDynamicId++
    dynamicMeshes[id] = mesh
    return id
  }

  override fun updateSplatMesh(
    meshId: Int,
    positions: FloatArray,
    uvs: FloatArray,
    colors: ByteArray,
    indices: IntArray,
  ) {
    val mesh = dynamicMeshes[meshId] ?: return
    val unused = uploadSplatGeometry(mesh, positions, uvs, colors, indices, create = false)
  }

  override fun updateSplatMeshIndices(meshId: Int, indices: IntArray) {
    val mesh = dynamicMeshes[meshId] ?: return
    val vb = mesh.vertexBuffer ?: return
    val indexCount = indices.size - indices.size % 3
    if (indexCount <= 0) return
    val vertexCount = vb.vertexCount
    if (indices.any { it < 0 || it >= vertexCount }) return
    val ibuf = ByteBuffer.allocateDirect(indexCount * 4).order(ByteOrder.nativeOrder())
    ibuf.asIntBuffer().put(indices, 0, indexCount)
    val existingIb = mesh.indexBuffer
    if (existingIb != null && existingIb.indexCount == indexCount) {
      existingIb.setBuffer(engine, ibuf)
      return
    }
    val ib = IndexBuffer.Builder().indexCount(indexCount).bufferType(IndexBuffer.Builder.IndexType.UINT).build(engine)
    ib.setBuffer(engine, ibuf)
    val rm = engine.renderableManager
    val ri = rm.getInstance(mesh.entity)
    if (ri != 0) {
      rm.setGeometryAt(ri, 0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib, 0, indexCount)
    }
    existingIb?.let { engine.destroyIndexBuffer(it) }
    mesh.indexBuffer = ib
  }

  override fun dispose() {
    if (disposed) return
    disposed = true
    choreographer.removeFrameCallback(frameCallback)
    listener = null
    pendingCapture?.second?.invoke(null)
    pendingCapture = null
    encoder.shutdown()
    clearDynamicMeshes()
    destroyAsset()
    templateAsset?.let {
      resourceLoader.evictResourceData()
      assetLoader.destroyAsset(it)
    }
    templateAsset = null
    templateMaterial = null
    splatTemplateAsset?.let {
      resourceLoader.evictResourceData()
      assetLoader.destroyAsset(it)
    }
    splatTemplateAsset = null
    if (compiledSplatMaterial != null) {
      splatTemplateMaterial?.let { engine.destroyMaterialInstance(it) }
    }
    splatTemplateMaterial = null
    compiledSplatMaterial?.let { engine.destroyMaterial(it) }
    compiledSplatMaterial = null
    gaussianTexture?.let { engine.destroyTexture(it) }
    gaussianTexture = null
    resourceLoader.destroy()
    assetLoader.destroy()
    materialProvider.destroyMaterials()
    materialProvider.destroy()
    scene.removeEntity(sunEntity)
    engine.lightManager.destroy(sunEntity)
    EntityManager.get().destroy(sunEntity)
    engine.destroyIndirectLight(indirectLight)
    swapChain?.let { engine.destroySwapChain(it) }
    swapChain = null
    engine.flushAndWait()
    engine.destroyRenderer(renderer)
    engine.destroyView(filamentView)
    engine.destroyScene(scene)
    engine.destroyCameraComponent(camera.entity)
    EntityManager.get().destroy(camera.entity)
    engine.destroy()
    surfaceView = null
  }

  // ---- Frame loop ------------------------------------------------------------------------------

  private fun renderFrame(frameTimeNanos: Long) {
    if (disposed) return
    choreographer.postFrameCallback(frameCallback)
    val dt = if (lastFrameNanos == 0L) 0.0 else (frameTimeNanos - lastFrameNanos) / 1e9
    lastFrameNanos = frameTimeNanos

    orbit.step(dt, SystemClock.uptimeMillis(), pointerDown)?.let { listener?.onCameraChange(it) }
    asset?.let { a ->
      val tm = engine.transformManager
      val ri = tm.getInstance(a.root)
      if (ri != 0) tm.setTransform(ri, orbit.turntableMatrix(rootMatrix))
    }
    orbit.eye(eye)
    orbit.target(target)
    camera.lookAt(eye[0], eye[1], eye[2], target[0], target[1], target[2], 0.0, 1.0, 0.0)
    val aspect = viewportWidth.toDouble() / viewportHeight
    val far = Math.max(orbit.boundsRadius * 20, 100.0)
    camera.setProjection(orbit.fieldOfViewDeg, aspect, 0.05, far, Camera.Fov.VERTICAL)
    camera.getModelMatrix(cameraWorld)

    advanceAnimation(dt)
    listener?.onFrame(dt, cameraWorld)

    val sc = swapChain ?: return
    if (renderer.beginFrame(sc, frameTimeNanos)) {
      renderer.render(filamentView)
      pendingCapture?.let { (maxEdge, callback) ->
        pendingCapture = null
        readFrame(maxEdge, callback)
      }
      renderer.endFrame()
    }
  }

  override fun captureFrame(maxEdge: Int, callback: (CapturedFrame?) -> Unit) {
    mainHandler.post {
      if (disposed || swapChain == null || captureInFlight || pendingCapture != null) {
        callback(null)
      } else {
        pendingCapture = maxEdge to callback
      }
    }
  }

  /** Reads back the frame just rendered (inside beginFrame / endFrame) and encodes it off-thread. */
  private fun readFrame(maxEdge: Int, callback: (CapturedFrame?) -> Unit) {
    val w = viewportWidth
    val h = viewportHeight
    val world = cameraWorld.copyOf()
    val proj = camera.getProjectionMatrix(DoubleArray(16)).let { m -> FloatArray(16) { m[it].toFloat() } }
    val pixels = ByteBuffer.allocateDirect(w * h * 4)
    captureInFlight = true
    val descriptor =
      Texture.PixelBufferDescriptor(pixels, Texture.Format.RGBA, Texture.Type.UBYTE, 1, 0, 0, w, mainHandler) {
        captureInFlight = false
        encoder.execute { callback(encodeJpeg(pixels, w, h, maxEdge, world, proj)) }
      }
    try {
      renderer.readPixels(0, 0, w, h, descriptor)
    } catch (e: RuntimeException) {
      captureInFlight = false
      callback(null)
    }
  }

  private fun advanceAnimation(dt: Double) {
    val index = playingAnimation ?: return
    val animator = asset?.instance?.animator ?: return
    animationTime += dt
    val count = animator.animationCount
    if (index < 0) {
      for (i in 0 until count) applyLooped(animator, i)
    } else if (index < count) {
      applyLooped(animator, index)
    }
    animator.updateBoneMatrices()
  }

  private fun applyLooped(animator: com.google.android.filament.gltfio.Animator, i: Int) {
    val d = animator.getAnimationDuration(i).toDouble()
    val t = if (d > 1e-6) animationTime % d else 0.0
    animator.applyAnimation(i, t.toFloat())
  }

  // ---- Node mapping and picking ------------------------------------------------------------------

  private fun mapNodes(loaded: FilamentAsset, index: GltfSceneIndex) {
    val tm = engine.transformManager
    val nameByEntity = HashMap<Int, String>()
    for (name in index.nodeNames) {
      if (name.isNullOrEmpty()) continue
      val ents = loaded.getEntitiesByName(name)
      for (e in ents) {
        if (e != 0) nameByEntity[e] = name
      }
    }
    val childrenOf = { e: Int ->
      val ti = tm.getInstance(e)
      if (ti == 0) {
        IntArray(0)
      } else {
        // TransformManager stores children as an intrusive linked list with push_front order,
        // so reversing restores the original glTF node order.
        tm.getChildren(ti, IntArray(tm.getChildCount(ti))).apply { reverse() }
      }
    }
    // In gltfio AssetLoader, loaded.root has a single child: loaded.instance.root, whose
    // children are the actual glTF scene root nodes.
    val instanceRoot = loaded.instance?.root ?: 0
    val instanceKids = if (instanceRoot != 0) childrenOf(instanceRoot) else IntArray(0)
    val rootKids = if (instanceKids.isNotEmpty()) instanceKids else childrenOf(loaded.root)
    nodeEntities = index.matchEntities(rootKids, childrenOf, { nameByEntity[it] ?: loaded.getName(it) })
    for (node in 0 until index.nodeCount) {
      if (nodeEntities[node] == 0) {
        val name = index.nodeNames[node]
        if (!name.isNullOrEmpty()) {
          nodeEntities[node] = loaded.getFirstEntityByName(name)
        }
      }
    }
    entityToNode.clear()
    for ((node, e) in nodeEntities.withIndex()) if (e != 0) entityToNode[e] = node

    val rm = engine.renderableManager
    val lists = Array(MAX_MATERIALS.coerceAtMost(materialCountOf(index))) { ArrayList<MaterialInstance>() }
    for (node in 0 until index.nodeCount) {
      val ri = rm.getInstance(nodeEntities[node].takeIf { it != 0 } ?: continue)
      if (ri == 0) continue
      val mats = index.materialsOfNode(node)
      for (p in 0 until minOf(rm.getPrimitiveCount(ri), mats.size)) {
        val m = mats[p]
        if (m in lists.indices) {
          val mi = rm.getMaterialInstanceAt(ri, p)
          if (lists[m].none { it === mi }) lists[m].add(mi)
        }
      }
    }
    @Suppress("UNCHECKED_CAST")
    materialInstances = lists as Array<MutableList<MaterialInstance>>
  }

  private fun materialCountOf(index: GltfSceneIndex): Int =
    (index.meshPrimitiveMaterials.maxOfOrNull { mats -> mats.maxOrNull() ?: -1 } ?: -1) + 1

  /** Nearest glTF node owning [entity] (the entity itself or an ancestor), or `-1`. */
  private fun nodeOfEntity(entity: Int): Int {
    val tm = engine.transformManager
    var e = entity
    var depth = 0
    while (e != 0 && depth < MAX_DEPTH) {
      entityToNode[e]?.let { return it }
      val ti = tm.getInstance(e)
      if (ti == 0) return -1
      e = tm.getParent(ti)
      depth++
    }
    return -1
  }

  private fun pick(xPx: Float, yPx: Float, onResult: (ThreeLivePick?) -> Unit) {
    if (asset == null || swapChain == null) {
      onResult(null)
      return
    }
    // Filament's viewport origin is bottom-left.
    val x = xPx.toInt().coerceIn(0, viewportWidth - 1)
    val y = (viewportHeight - 1 - yPx.toInt()).coerceIn(0, viewportHeight - 1)
    filamentView.pick(x, y, mainHandler) { result ->
      if (!disposed) {
        val node = nodeOfEntity(result.renderable)
        onResult(if (node < 0) null else ThreeLivePick(node, hitPointOnBounds(xPx, yPx, result.renderable)))
      }
    }
  }

  /** Approximate world hit point: where the tap ray enters the renderable's world bounds. */
  private fun hitPointOnBounds(xPx: Float, yPx: Float, entity: Int): FloatArray? {
    val origin = DoubleArray(3)
    val dir = DoubleArray(3)
    ray(xPx, yPx, origin, dir)
    val box = worldBounds(entity) ?: return null
    val t = rayBoxEntry(origin, dir, box) ?: return null
    return floatArrayOf((origin[0] + dir[0] * t).toFloat(), (origin[1] + dir[1] * t).toFloat(), (origin[2] + dir[2] * t).toFloat())
  }

  /** Synchronous approximate raycast against renderable world bounds (for pointer capture). */
  private fun raycastBounds(origin: DoubleArray, dir: DoubleArray): ThreeLivePick? {
    var best = Double.POSITIVE_INFINITY
    var bestNode = -1
    for ((entity, node) in entityToNode) {
      val box = worldBounds(entity) ?: continue
      val t = rayBoxEntry(origin, dir, box) ?: continue
      if (t < best) {
        best = t
        bestNode = node
      }
    }
    if (bestNode < 0) return null
    return ThreeLivePick(
      bestNode,
      floatArrayOf((origin[0] + dir[0] * best).toFloat(), (origin[1] + dir[1] * best).toFloat(), (origin[2] + dir[2] * best).toFloat()),
    )
  }

  /** World AABB (min xyz, max xyz) of a visible renderable entity, or `null`. */
  private fun worldBounds(entity: Int): DoubleArray? {
    val rm = engine.renderableManager
    val ri = rm.getInstance(entity)
    if (ri == 0 || entity in hiddenEntities) return null
    val tm = engine.transformManager
    val ti = tm.getInstance(entity)
    if (ti == 0) return null
    val box = rm.getAxisAlignedBoundingBox(ri, Box())
    val world = tm.getWorldTransform(ti, FloatArray(16))
    val c = box.center
    val h = box.halfExtent
    val out = doubleArrayOf(Double.MAX_VALUE, Double.MAX_VALUE, Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE, -Double.MAX_VALUE)
    for (corner in 0 until 8) {
      val lx = c[0] + if (corner and 1 == 0) -h[0] else h[0]
      val ly = c[1] + if (corner and 2 == 0) -h[1] else h[1]
      val lz = c[2] + if (corner and 4 == 0) -h[2] else h[2]
      for (k in 0 until 3) {
        val w = (world[k] * lx + world[4 + k] * ly + world[8 + k] * lz + world[12 + k]).toDouble()
        out[k] = minOf(out[k], w)
        out[3 + k] = maxOf(out[3 + k], w)
      }
    }
    return out
  }

  private fun ray(xPx: Float, yPx: Float, origin: DoubleArray, dir: DoubleArray) {
    val ndcX = 2.0 * xPx / viewportWidth - 1.0
    val ndcY = 1.0 - 2.0 * yPx / viewportHeight
    orbit.viewportRay(ndcX, ndcY, viewportWidth.toDouble() / viewportHeight, origin, dir)
  }

  private fun pointerAt(xPx: Float, yPx: Float): ThreeLivePointer {
    val origin = DoubleArray(3)
    val dir = DoubleArray(3)
    ray(xPx, yPx, origin, dir)
    return ThreeLivePointer(origin, dir, raycastBounds(origin, dir))
  }

  // ---- Dynamic meshes ---------------------------------------------------------------------------

  private class DynamicMesh(val entity: Int, val material: MaterialInstance) {
    var vertexBuffer: VertexBuffer? = null
    var indexBuffer: IndexBuffer? = null
  }

  /**
   * The unlit material used for dynamic meshes: gltfio's own unlit ubershader instance, taken from
   * a one-triangle template asset so every sampler and parameter is initialized by gltfio.
   */
  private fun dynamicMaterial(): MaterialInstance? {
    templateMaterial?.let { return it }
    val template = assetLoader.createAsset(DynamicMeshTemplate.glb()) ?: return null
    resourceLoader.loadResources(template)
    template.releaseSourceData()
    templateAsset = template
    templateMaterial = template.instance.materialInstances.firstOrNull()
    return templateMaterial
  }

  /**
   * Unlit, alpha-blended material for Gaussian splats. Loads the compiled `materials/splat.filamat`
   * GPU billboard material when packaged in assets, falling back to `DynamicMeshTemplate.splatGlb()`
   * + a 64x64 radial Gaussian falloff `baseColorMap` texture otherwise.
   */
  private fun splatMaterial(): MaterialInstance? {
    splatTemplateMaterial?.let { return it }
    if (hasFilamatAsset) {
      try {
        val bytes = appContext.assets.open(SPLAT_FILAMAT_ASSET).use { it.readBytes() }
        val buf =
          ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
            put(bytes)
            rewind()
          }
        val mat = Material.Builder().payload(buf, buf.remaining()).build(engine)
        val mi = mat.createInstance()
        if (mat.hasParameter("gpuBillboard")) {
          mi.setParameter("gpuBillboard", 1.0f)
        }
        mi.setDepthWrite(false)
        compiledSplatMaterial = mat
        splatTemplateMaterial = mi
        return mi
      } catch (e: Throwable) {
        // Fall back to the ubershader template if the asset cannot be loaded.
      }
    }
    val template = assetLoader.createAsset(DynamicMeshTemplate.splatGlb()) ?: return null
    resourceLoader.loadResources(template)
    template.releaseSourceData()
    val mi = template.instance.materialInstances.firstOrNull() ?: return null
    val texSize = 64
    val tex =
      Texture.Builder()
        .width(texSize)
        .height(texSize)
        .levels(1)
        .sampler(Texture.Sampler.SAMPLER_2D)
        .format(Texture.InternalFormat.RGBA8)
        .build(engine)
    tex.setImage(
      engine,
      0,
      Texture.PixelBufferDescriptor(SplatParser.gaussianFalloffRgba(texSize), Texture.Format.RGBA, Texture.Type.UBYTE),
    )
    if (mi.material.hasParameter("baseColorMap")) {
      val sampler =
        TextureSampler(
          TextureSampler.MinFilter.LINEAR,
          TextureSampler.MagFilter.LINEAR,
          TextureSampler.WrapMode.CLAMP_TO_EDGE,
        )
      mi.setParameter("baseColorMap", tex, sampler)
    }
    mi.setDepthWrite(false)
    splatTemplateAsset = template
    splatTemplateMaterial = mi
    gaussianTexture = tex
    return mi
  }

  private fun uploadSplatGeometry(
    mesh: DynamicMesh,
    positions: FloatArray,
    uvs: FloatArray,
    colors: ByteArray,
    indices: IntArray,
    create: Boolean,
  ): Boolean {
    val vertexCount = positions.size / 3
    val indexCount = indices.size - indices.size % 3
    if (vertexCount == 0 || indexCount == 0 || vertexCount > MAX_SPLAT_VERTICES) return false
    if (uvs.size < vertexCount * 2 || colors.size < vertexCount * 4) return false
    if (indices.any { it < 0 || it >= vertexCount }) return false

    val vb =
      VertexBuffer.Builder()
        .vertexCount(vertexCount)
        .bufferCount(3)
        .attribute(VertexBuffer.VertexAttribute.POSITION, 0, VertexBuffer.AttributeType.FLOAT3, 0, 12)
        .attribute(VertexBuffer.VertexAttribute.UV0, 1, VertexBuffer.AttributeType.FLOAT2, 0, 8)
        .attribute(VertexBuffer.VertexAttribute.COLOR, 2, VertexBuffer.AttributeType.UBYTE4, 0, 4)
        .normalized(VertexBuffer.VertexAttribute.COLOR)
        .build(engine)
    vb.setBufferAt(engine, 0, floatBuffer(positions, vertexCount * 3))
    vb.setBufferAt(engine, 1, floatBuffer(uvs, vertexCount * 2))
    val cbuf = ByteBuffer.allocateDirect(vertexCount * 4).order(ByteOrder.nativeOrder())
    cbuf.put(colors, 0, vertexCount * 4).rewind()
    vb.setBufferAt(engine, 2, cbuf)
    val ib = IndexBuffer.Builder().indexCount(indexCount).bufferType(IndexBuffer.Builder.IndexType.UINT).build(engine)
    val ibuf = ByteBuffer.allocateDirect(indexCount * 4).order(ByteOrder.nativeOrder())
    ibuf.asIntBuffer().put(indices, 0, indexCount)
    ib.setBuffer(engine, ibuf)

    val bounds = boundsOf(positions, vertexCount)
    val rm = engine.renderableManager
    if (create) {
      RenderableManager.Builder(1)
        .boundingBox(bounds)
        .geometry(0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib, 0, indexCount)
        .material(0, mesh.material)
        .culling(false)
        .castShadows(false)
        .receiveShadows(false)
        .priority(7)
        .build(engine, mesh.entity)
    } else {
      val ri = rm.getInstance(mesh.entity)
      rm.setGeometryAt(ri, 0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib, 0, indexCount)
      rm.setAxisAlignedBoundingBox(ri, bounds)
    }
    mesh.vertexBuffer?.let { engine.destroyVertexBuffer(it) }
    mesh.indexBuffer?.let { engine.destroyIndexBuffer(it) }
    mesh.vertexBuffer = vb
    mesh.indexBuffer = ib
    return true
  }

  private fun uploadGeometry(mesh: DynamicMesh, positions: FloatArray, indices: IntArray, create: Boolean): Boolean {
    val vertexCount = positions.size / 3
    val indexCount = indices.size - indices.size % 3
    if (vertexCount == 0 || indexCount == 0 || vertexCount > MAX_DYNAMIC_VERTICES) return false
    if (indices.any { it < 0 || it >= vertexCount }) return false

    val vb =
      VertexBuffer.Builder()
        .vertexCount(vertexCount)
        .bufferCount(3)
        .attribute(VertexBuffer.VertexAttribute.POSITION, 0, VertexBuffer.AttributeType.FLOAT3, 0, 12)
        .attribute(VertexBuffer.VertexAttribute.UV0, 1, VertexBuffer.AttributeType.FLOAT2, 0, 8)
        .attribute(VertexBuffer.VertexAttribute.COLOR, 2, VertexBuffer.AttributeType.FLOAT4, 0, 16)
        .build(engine)
    vb.setBufferAt(engine, 0, floatBuffer(positions, vertexCount * 3))
    vb.setBufferAt(engine, 1, floatBuffer(FloatArray(vertexCount * 2), vertexCount * 2))
    vb.setBufferAt(engine, 2, floatBuffer(FloatArray(vertexCount * 4) { 1f }, vertexCount * 4))
    val ib = IndexBuffer.Builder().indexCount(indexCount).bufferType(IndexBuffer.Builder.IndexType.UINT).build(engine)
    val ibuf = ByteBuffer.allocateDirect(indexCount * 4).order(ByteOrder.nativeOrder())
    ibuf.asIntBuffer().put(indices, 0, indexCount)
    ib.setBuffer(engine, ibuf)

    val bounds = boundsOf(positions, vertexCount)
    val rm = engine.renderableManager
    if (create) {
      RenderableManager.Builder(1)
        .boundingBox(bounds)
        .geometry(0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib, 0, indexCount)
        .material(0, mesh.material)
        .culling(false)
        .castShadows(false)
        .build(engine, mesh.entity)
    } else {
      val ri = rm.getInstance(mesh.entity)
      rm.setGeometryAt(ri, 0, RenderableManager.PrimitiveType.TRIANGLES, vb, ib, 0, indexCount)
      rm.setAxisAlignedBoundingBox(ri, bounds)
    }
    mesh.vertexBuffer?.let { engine.destroyVertexBuffer(it) }
    mesh.indexBuffer?.let { engine.destroyIndexBuffer(it) }
    mesh.vertexBuffer = vb
    mesh.indexBuffer = ib
    return true
  }

  private fun destroyDynamicMesh(mesh: DynamicMesh) {
    scene.removeEntity(mesh.entity)
    engine.renderableManager.destroy(mesh.entity)
    engine.transformManager.destroy(mesh.entity)
    EntityManager.get().destroy(mesh.entity)
    mesh.vertexBuffer?.let { engine.destroyVertexBuffer(it) }
    mesh.indexBuffer?.let { engine.destroyIndexBuffer(it) }
    engine.destroyMaterialInstance(mesh.material)
  }

  private fun clearDynamicMeshes() {
    for (mesh in dynamicMeshes.values) destroyDynamicMesh(mesh)
    dynamicMeshes.clear()
  }

  private fun destroyAsset() {
    asset?.let {
      scene.removeEntities(it.entities)
      resourceLoader.evictResourceData()
      assetLoader.destroyAsset(it)
    }
    asset = null
    sceneIndex = null
    nodeEntities = IntArray(0)
    entityToNode.clear()
    hiddenEntities.clear()
    materialInstances = emptyArray()
  }

  // ---- Touch input -----------------------------------------------------------------------------

  /** Orbit drag, pinch zoom, tap pick, long press, and pointer capture for XR Blocks features. */
  private inner class TouchHandler(context: Context) : View.OnTouchListener {
    private var lastX = 0f
    private var lastY = 0f
    private var captured = false
    private var longPressPick: ThreeLivePick? = null

    private val scale =
      ScaleGestureDetector(
        context,
        object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
          override fun onScale(detector: ScaleGestureDetector): Boolean {
            orbit.pinch(detector.scaleFactor.toDouble(), SystemClock.uptimeMillis())
            return true
          }
        },
      )

    private val gestures =
      GestureDetector(
        context,
        object : GestureDetector.SimpleOnGestureListener() {
          override fun onSingleTapUp(e: MotionEvent): Boolean {
            if (captured) return false
            orbit.touch(SystemClock.uptimeMillis())
            pick(e.x, e.y) { hit -> hit?.let { listener?.onPick(it) } }
            return true
          }

          override fun onLongPress(e: MotionEvent) {
            if (captured) return
            pick(e.x, e.y) { hit ->
              if (hit != null) {
                longPressPick = hit
                listener?.onLongPress(hit, true)
              }
            }
          }
        },
      )

    override fun onTouch(v: View, event: MotionEvent): Boolean {
      if (disposed) return false
      scale.onTouchEvent(event)
      gestures.onTouchEvent(event)
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          pointerDown = true
          lastX = event.x
          lastY = event.y
          captured = listener?.onPointerDown(pointerAt(event.x, event.y)) == true
        }
        MotionEvent.ACTION_POINTER_DOWN -> {
          if (captured) {
            listener?.onPointerUp(pointerAt(event.x, event.y))
            captured = false
          }
        }
        MotionEvent.ACTION_MOVE -> {
          if (captured) {
            listener?.onPointerMove(pointerAt(event.x, event.y))
          } else if (event.pointerCount == 1 && !scale.isInProgress) {
            orbit.drag((event.x - lastX).toDouble(), (event.y - lastY).toDouble(), SystemClock.uptimeMillis())
          }
          lastX = event.x
          lastY = event.y
        }
        MotionEvent.ACTION_UP,
        MotionEvent.ACTION_CANCEL -> {
          if (captured) listener?.onPointerUp(pointerAt(event.x, event.y))
          captured = false
          pointerDown = false
          longPressPick?.let { listener?.onLongPress(it, false) }
          longPressPick = null
          orbit.touch(SystemClock.uptimeMillis())
        }
      }
      return true
    }
  }

  companion object {
    private const val SUN_LUX = 90_000f
    private const val AMBIENT_LUX = 25_000f
    private const val VISIBLE_LAYER = 0x01
    private const val MAX_DEPTH = 256
    private const val MAX_MATERIALS = 4096
    private const val MAX_DYNAMIC_VERTICES = 1_000_000
    private const val MAX_SPLAT_VERTICES = SplatParser.MAX_SPLATS * 4
    internal const val SPLAT_FILAMAT_ASSET = "materials/splat.filamat"

    private const val JPEG_QUALITY = 60

    /** RGBA (bottom-up, as read back from GL) → downscaled, upright JPEG; `null` on failure. */
    private fun encodeJpeg(
      pixels: ByteBuffer,
      w: Int,
      h: Int,
      maxEdge: Int,
      world: FloatArray,
      proj: FloatArray,
    ): CapturedFrame? {
      return try {
        pixels.rewind()
        val src = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        src.copyPixelsFromBuffer(pixels)
        val size = com.google.threelive.gemini.RendererFrameSource.fitWithin(w, h, maxEdge)
        val m = Matrix()
        m.postScale(size[0].toFloat() / w, -size[1].toFloat() / h)
        val upright = Bitmap.createBitmap(src, 0, 0, w, h, m, true)
        val out = ByteArrayOutputStream()
        upright.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
        if (upright !== src) upright.recycle()
        src.recycle()
        CapturedFrame(out.toByteArray(), size[0], size[1], world, proj, System.currentTimeMillis())
      } catch (e: RuntimeException) {
        null
      } catch (e: OutOfMemoryError) {
        null
      }
    }

    private fun floatBuffer(values: FloatArray, count: Int): ByteBuffer {
      val b = ByteBuffer.allocateDirect(count * 4).order(ByteOrder.nativeOrder())
      b.asFloatBuffer().put(values, 0, count)
      return b
    }

    private fun setColor(mi: MaterialInstance, color: FloatArray) {
      if (color.size >= 4 && mi.material.hasParameter("baseColorFactor")) {
        mi.setParameter("baseColorFactor", color[0], color[1], color[2], color[3])
      }
    }

    private fun boundsOf(positions: FloatArray, vertexCount: Int): Box {
      val lo = floatArrayOf(Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE)
      val hi = floatArrayOf(-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE)
      for (i in 0 until vertexCount) {
        for (k in 0 until 3) {
          val v = positions[i * 3 + k]
          if (v.isFinite()) {
            lo[k] = minOf(lo[k], v)
            hi[k] = maxOf(hi[k], v)
          }
        }
      }
      for (k in 0 until 3) {
        if (lo[k] > hi[k]) {
          lo[k] = 0f
          hi[k] = 0f
        }
      }
      return Box(
        (lo[0] + hi[0]) / 2,
        (lo[1] + hi[1]) / 2,
        (lo[2] + hi[2]) / 2,
        (hi[0] - lo[0]) / 2 + 1e-3f,
        (hi[1] - lo[1]) / 2 + 1e-3f,
        (hi[2] - lo[2]) / 2 + 1e-3f,
      )
    }

    /** Column-major TRS matrix (translation, quaternion xyzw, scale). */
    internal fun composeTrs(t: FloatArray, q: FloatArray, s: FloatArray, out: FloatArray): FloatArray {
      val x = q.getOrElse(0) { 0f }
      val y = q.getOrElse(1) { 0f }
      val z = q.getOrElse(2) { 0f }
      val w = q.getOrElse(3) { 1f }
      val sx = s.getOrElse(0) { 1f }
      val sy = s.getOrElse(1) { 1f }
      val sz = s.getOrElse(2) { 1f }
      out[0] = (1 - 2 * (y * y + z * z)) * sx
      out[1] = (2 * (x * y + z * w)) * sx
      out[2] = (2 * (x * z - y * w)) * sx
      out[3] = 0f
      out[4] = (2 * (x * y - z * w)) * sy
      out[5] = (1 - 2 * (x * x + z * z)) * sy
      out[6] = (2 * (y * z + x * w)) * sy
      out[7] = 0f
      out[8] = (2 * (x * z + y * w)) * sz
      out[9] = (2 * (y * z - x * w)) * sz
      out[10] = (1 - 2 * (x * x + y * y)) * sz
      out[11] = 0f
      out[12] = t.getOrElse(0) { 0f }
      out[13] = t.getOrElse(1) { 0f }
      out[14] = t.getOrElse(2) { 0f }
      out[15] = 1f
      return out
    }

    /** Slab test: distance along the ray to where it enters [box] (min xyz, max xyz), or `null`. */
    internal fun rayBoxEntry(origin: DoubleArray, dir: DoubleArray, box: DoubleArray): Double? {
      var tMin = 0.0
      var tMax = Double.POSITIVE_INFINITY
      for (k in 0 until 3) {
        val d = dir[k]
        if (Math.abs(d) < 1e-12) {
          if (origin[k] < box[k] || origin[k] > box[3 + k]) return null
        } else {
          var t1 = (box[k] - origin[k]) / d
          var t2 = (box[3 + k] - origin[k]) / d
          if (t1 > t2) {
            val tmp = t1
            t1 = t2
            t2 = tmp
          }
          tMin = maxOf(tMin, t1)
          tMax = minOf(tMax, t2)
          if (tMin > tMax) return null
        }
      }
      return tMin
    }
  }
}
