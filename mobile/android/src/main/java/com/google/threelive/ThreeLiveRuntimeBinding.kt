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

/**
 * Connects an [XRLiveRuntimeSession] to a [ThreeLiveSceneRenderer]: behavior-graph and trait
 * changes become renderer calls, taps become `pointer/onSelect`, and every frame steps the session
 * with the camera as the head pose. Host-facing events (mesh clicks, camera changes, graph events)
 * are reported through [Callbacks] with the same payload fields as the web element.
 *
 * Use on the main thread. Call `renderer.load(glb)` first, then create one binding per loaded scene
 * and [dispose] it before loading another.
 */
class ThreeLiveRuntimeBinding(private val renderer: ThreeLiveSceneRenderer, glb: ByteBuffer) {
  /** Host callbacks; every method is optional. */
  interface Callbacks {
    /**
     * A node was tapped. [nodeName] is the glTF node name and [meshName] the glTF mesh name of the
     * hit node (the web `meshclick` `mesh` field); [point] is the world hit point if known.
     */
    fun onMeshClick(nodeIndex: Int, nodeName: String?, meshName: String?, point: FloatArray?) {}

    /**
     * An `xr-live-sim` spawned instance ([ThreeLiveSceneRenderer.instantiateNode] id) was tapped;
     * [point] is the world hit point if known.
     */
    fun onInstanceClick(instanceId: Int, point: FloatArray?) {}

    /** The camera moved (web `camera-change` rule: ≥ 1° or ≥ 0.02 zoom). */
    fun onCameraChange(change: ThreeLiveCameraChange) {}

    /** The behavior graph executed `event/send`. */
    fun onInteractivityEvent(eventId: String, payloadJson: String) {}

    /** A long press began on a node (hold-to-ask). */
    fun onLongPress(nodeIndex: Int, nodeName: String?, meshName: String?, pressed: Boolean) {}

    /** A hand's gesture changed to a non-`NONE` gesture (when [handsEnabled] is `true`). */
    fun onGesture(event: XRHandGestureEvent) {}
  }

  /** The behavior / trait runtime for the loaded scene. */
  val session: XRLiveRuntimeSession = XRLiveRuntimeSession.fromGlb(glb)

  /** Hierarchy, mesh and material index of the loaded scene. */
  val scene: GltfSceneIndex =
    GltfSceneIndex.fromGlb(glb)
      ?: throw IllegalArgumentException("ThreeLiveRuntimeBinding: not a valid .glb")

  /** Host callbacks. */
  var callbacks: Callbacks? = null

  /**
   * When `true` (`xrHands != "none"`), polls [handSource] (or [HandJointSources.current] when
   * `null`) each frame, feeds wrist poses into [XRLiveRuntimeSession.step] for hand-anchored
   * lazy-follow traits, and reports gesture changes via [Callbacks.onGesture].
   */
  var handsEnabled: Boolean = false

  /** Per-binding override for [HandJointSources.current]. */
  var handSource: HandJointSource? = null

  /**
   * Extra pointer handler consulted before camera orbiting (spatial features such as handles and
   * paint plug in here).
   */
  var pointerHandler: ThreeLiveRendererListener? = null

  /** Extra per-frame hook, run after the session step (spatial features plug in here). */
  var frameHandler: ((dtSeconds: Double, cameraWorld: FloatArray) -> Unit)? = null

  /**
   * Additional per-frame callbacks run after [frameHandler] (for example stepping an [XRSimWorld]).
   * Safe to modify from callbacks.
   */
  val frameListeners: MutableList<(dtSeconds: Double, cameraWorld: FloatArray) -> Unit> =
    java.util.concurrent.CopyOnWriteArrayList()

  private val pendingVisibility = LinkedHashSet<Int>()
  private val gestureTracker = XRHandGestureTracker()
  private val rootF = FloatArray(16)
  private val rootD = DoubleArray(16)
  private var rootWasSet = false
  private val m = DoubleArray(16)
  private val q = DoubleArray(4)
  private var disposed = false

  private val sessionListener =
    object : XRLiveRuntimeSession.Listener {
      override fun onNodeTransformChanged(
        nodeIndex: Int,
        translation: FloatArray,
        rotation: FloatArray,
        scale: FloatArray,
      ) {
        renderer.setNodeTransform(nodeIndex, translation, rotation, scale)
      }

      override fun onVisibilityChanged(nodeIndex: Int, visible: Boolean) {
        pendingVisibility.add(nodeIndex)
      }

      override fun onMaterialChanged(
        materialIndex: Int,
        baseColorFactor: FloatArray,
        emissiveFactor: FloatArray,
        metallicFactor: Float,
        roughnessFactor: Float,
      ) {
        renderer.setMaterialFactors(
          materialIndex,
          baseColorFactor,
          emissiveFactor,
          metallicFactor,
          roughnessFactor,
        )
      }

      override fun onAlphaCutoffChanged(materialIndex: Int, alphaCutoff: Float) {
        renderer.setMaterialAlphaCutoff(materialIndex, alphaCutoff)
      }

      override fun onInteractivityEvent(eventId: String, payloadJson: String) {
        callbacks?.onInteractivityEvent(eventId, payloadJson)
      }

      override fun onAnimation(start: Boolean, animationIndex: Int, animationName: String?) {
        if (start) {
          renderer.playAnimation(animationIndex)
        } else {
          renderer.stopAnimation()
        }
      }
    }

  private val rendererListener =
    object : ThreeLiveRendererListener {
      override fun onPick(pick: ThreeLivePick) {
        if (disposed) return
        val node = pick.nodeIndex
        if (node < 0 && pick.instanceId >= 0) {
          callbacks?.onInstanceClick(pick.instanceId, pick.hitPoint)
        } else if (node in 0 until scene.nodeCount) {
          session.dispatchSelect(node, pick.hitPoint)
          applyPendingVisibility()
          callbacks?.onMeshClick(
            node,
            scene.nodeNames[node],
            scene.meshNameOfNode(node),
            pick.hitPoint,
          )
        }
      }

      override fun onLongPress(pick: ThreeLivePick, pressed: Boolean) {
        val node = pick.nodeIndex
        if (disposed || node !in 0 until scene.nodeCount) return
        callbacks?.onLongPress(node, scene.nodeNames[node], scene.meshNameOfNode(node), pressed)
      }

      override fun onPointerDown(pointer: ThreeLivePointer): Boolean =
        !disposed && pointerHandler?.onPointerDown(pointer) == true

      override fun onPointerMove(pointer: ThreeLivePointer) {
        if (!disposed) pointerHandler?.onPointerMove(pointer)
      }

      override fun onPointerUp(pointer: ThreeLivePointer) {
        if (!disposed) pointerHandler?.onPointerUp(pointer)
      }

      override fun onCameraChange(change: ThreeLiveCameraChange) {
        if (!disposed) callbacks?.onCameraChange(change)
      }

      override fun onFrame(dtSeconds: Double, cameraWorld: FloatArray) {
        if (disposed) return
        syncRootTransform()
        val hands = if (handsEnabled) (handSource ?: HandJointSources.current()) else null
        val handPoses = HandJointSources.handPoses(hands)
        session.step(dtSeconds, headPoseOf(cameraWorld), handPoses)
        if (hands != null) {
          gestureTracker.poll(hands) { event -> callbacks?.onGesture(event) }
        }
        applyPendingVisibility()
        frameHandler?.invoke(dtSeconds, cameraWorld)
        for (listener in frameListeners) listener(dtSeconds, cameraWorld)
        applyPendingVisibility()
      }
    }

  init {
    session.listener = sessionListener
    renderer.listener = rendererListener
    // Initial authored visibility (KHR_node_visibility) and graph `event/onStart`.
    for (i in 0 until scene.nodeCount) {
      if (!session.isVisible(i)) pendingVisibility.add(i)
    }
    session.start()
    applyPendingVisibility()
  }

  /** Delivers a custom event to the graph's `event/receive` nodes. */
  fun sendEvent(eventId: String, payload: Map<String, Any?> = emptyMap()) {
    if (disposed) return
    session.sendEvent(eventId, payload)
    applyPendingVisibility()
  }

  /**
   * Unprojects 2D [boxes] (see [ThreeLiveDetections.parse]) against the renderer's current camera
   * and returns world-space detections, or an empty list when the renderer has no camera.
   */
  fun detect(boxes: List<ThreeLiveDetections.Box>): List<WorldUnderstanding.Detection3D> {
    if (disposed || boxes.isEmpty()) return emptyList()
    val world = FloatArray(16)
    val proj = FloatArray(16)
    if (!renderer.cameraMatrices(world, proj)) return emptyList()
    return ThreeLiveDetections.detect(boxes, world, proj)
  }

  /** Detaches from the renderer and session. Does not dispose the renderer. */
  fun dispose() {
    if (disposed) return
    disposed = true
    session.listener = null
    if (renderer.listener === rendererListener) renderer.listener = null
    pointerHandler = null
    frameHandler = null
    frameListeners.clear()
  }

  /** Pushes effective visibility for every node whose own flag (or an ancestor's) changed. */
  private fun applyPendingVisibility() {
    if (pendingVisibility.isEmpty()) return
    val changed = pendingVisibility.toIntArray()
    pendingVisibility.clear()
    val done = HashSet<Int>()
    for (root in changed) {
      for (i in scene.subtree(root)) {
        if (done.add(i)) renderer.setNodeVisible(i, session.isEffectivelyVisible(i))
      }
    }
  }

  /** Feeds the renderer's scene-root motion (e.g. turntable) into the session's world space. */
  private fun syncRootTransform() {
    val hasRoot = renderer.sceneRootMatrix(rootF)
    if (hasRoot) {
      for (k in 0 until 16) rootD[k] = rootF[k].toDouble()
      session.rootTransform = rootD
    } else if (rootWasSet) {
      for (k in 0 until 16) rootD[k] = if (k % 5 == 0) 1.0 else 0.0
      session.rootTransform = rootD
    }
    rootWasSet = hasRoot
  }

  /** The head (camera) pose for a renderer camera world matrix. */
  fun headPoseOf(cameraWorld: FloatArray): XRPose {
    for (k in 0 until 16) m[k] = cameraWorld.getOrElse(k) { if (k % 5 == 0) 1f else 0f }.toDouble()
    XRSpatialMath.extractQuaternion(m, q)
    return XRPose(
      floatArrayOf(m[12].toFloat(), m[13].toFloat(), m[14].toFloat()),
      floatArrayOf(q[0].toFloat(), q[1].toFloat(), q[2].toFloat(), q[3].toFloat()),
    )
  }
}
