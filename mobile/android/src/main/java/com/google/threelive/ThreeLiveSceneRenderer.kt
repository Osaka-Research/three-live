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
 * The scene half of a three-live renderer: everything except creating the Android view, so the
 * runtime binding and its tests stay free of Android framework types. Android renderers implement
 * [ThreeLiveRenderer], which adds view creation.
 *
 * The core library ships no renderer. Apps either add the optional `three-live-filament` module
 * (`ThreeLiveFilament.install()`) or register their own implementation with [ThreeLiveRenderers].
 * [ThreeLiveRuntimeBinding] connects a renderer to an [XRLiveRuntimeSession], so behavior graphs,
 * spatial traits and XR Blocks features work the same with any renderer.
 *
 * Node and material indices are glTF indices of the loaded GLB. All methods are called on the main
 * thread, and listener callbacks are delivered on the main thread.
 */
interface ThreeLiveSceneRenderer {

  /** Receives input, camera and frame callbacks. May be replaced at any time. */
  var listener: ThreeLiveRendererListener?

  /**
   * Loads a binary glTF. The renderer must finish reading [glb] before returning (the caller may
   * free it afterwards). Replaces any previously loaded scene and resets dynamic meshes.
   */
  fun load(glb: ByteBuffer)

  /** Applies camera options (orbit, target, field of view, limits, auto-rotate, controls). */
  fun setCameraOptions(options: ThreeLiveCameraOptions)

  /** Sets a node's local transform (translation xyz, rotation quaternion xyzw, scale xyz). */
  fun setNodeTransform(
    nodeIndex: Int,
    translation: FloatArray,
    rotation: FloatArray,
    scale: FloatArray,
  )

  /**
   * Shows or hides the renderables of one node. [visible] is the node's **effective** visibility
   * (its own flag and all ancestors'), so renderers never need to propagate it.
   */
  fun setNodeVisible(nodeIndex: Int, visible: Boolean)

  /** Updates a glTF material's PBR factors on every primitive that uses it. */
  fun setMaterialFactors(
    materialIndex: Int,
    baseColorFactor: FloatArray,
    emissiveFactor: FloatArray,
    metallicFactor: Float,
    roughnessFactor: Float,
  )

  /** Updates a glTF material's `alphaCutoff` where the material is masked. */
  fun setMaterialAlphaCutoff(materialIndex: Int, alphaCutoff: Float) {}

  /**
   * Writes the world matrix (column-major 4x4) the renderer applies to the whole scene, for example
   * a turntable auto-rotate, into [out]. Returns `false` (the default) when the scene root is not
   * moved.
   */
  fun sceneRootMatrix(out: FloatArray): Boolean = false

  /**
   * Writes the current camera's column-major world matrix into [world] and projection matrix into
   * [projection] (both at least 16 floats), for unprojecting 2D detections. Returns `false` (the
   * default) when no camera is available.
   */
  fun cameraMatrices(world: FloatArray, projection: FloatArray): Boolean = false

  /**
   * Captures the next rendered frame as a JPEG (longest edge at most [maxEdge] pixels) together with
   * the camera matrices it was rendered with, and calls [callback] exactly once, on any thread, with
   * `null` when capture is unsupported or fails. Used to stream what the user sees to Gemini Live.
   */
  fun captureFrame(maxEdge: Int, callback: (CapturedFrame?) -> Unit) {
    callback(null)
  }

  /** Starts (looping) the glTF animation at [animationIndex]; `-1` plays every animation. */
  fun playAnimation(animationIndex: Int) {}

  /** Stops animation playback. */
  fun stopAnimation() {}

  /**
   * Adds a world-space triangle mesh used by XR Blocks features (handles, paint strokes,
   * particles). [positions] and [normals] are xyz triples, [color] is linear RGBA. Returns a mesh id,
   * or `-1` when dynamic meshes are unsupported.
   */
  fun addDynamicMesh(
    positions: FloatArray,
    normals: FloatArray?,
    indices: IntArray,
    color: FloatArray,
  ): Int = -1

  /** Replaces the geometry of a dynamic mesh created by [addDynamicMesh]. */
  fun updateDynamicMesh(
    meshId: Int,
    positions: FloatArray,
    normals: FloatArray?,
    indices: IntArray,
  ) {}

  /** Sets a dynamic mesh's world transform (column-major 4x4). */
  fun setDynamicMeshTransform(meshId: Int, matrix: FloatArray) {}

  /** Changes a dynamic mesh's color. */
  fun setDynamicMeshColor(meshId: Int, color: FloatArray) {}

  /** Removes a dynamic mesh. Unknown ids are ignored. */
  fun removeDynamicMesh(meshId: Int) {}

  /**
   * Whether [addSplatMesh] uses a GPU-billboarded splat shader (`splat.filamat`) where vertex
   * `positions` are local splat centers, `uvs` are signed local half-sizes `(±r, ±r)`, and only
   * [updateSplatMeshIndices] + [setDynamicMeshTransform] need to run after initial upload.
   */
  val supportsGpuSplats: Boolean
    get() = false

  /**
   * Adds a Gaussian splat quad mesh ([positions] 3 floats/vertex, [uvs] 2 floats/vertex,
   * [colors] 4 RGBA8 bytes/vertex, [indices] triangle indices) drawn with an unlit alpha-blended
   * radial Gaussian falloff material. Returns a mesh id, or `-1` when unsupported.
   */
  fun addSplatMesh(
    positions: FloatArray,
    uvs: FloatArray,
    colors: ByteArray,
    indices: IntArray,
  ): Int = -1

  /** Replaces the geometry of a splat mesh created by [addSplatMesh]. */
  fun updateSplatMesh(
    meshId: Int,
    positions: FloatArray,
    uvs: FloatArray,
    colors: ByteArray,
    indices: IntArray,
  ) {}

  /**
   * Replaces only the index buffer of a GPU-billboarded splat mesh created by [addSplatMesh],
   * leaving its static vertex buffer intact. Falls back to no-op when unsupported.
   */
  fun updateSplatMeshIndices(meshId: Int, indices: IntArray) {}

  /** Releases every resource. The renderer is unusable afterwards; safe to call twice. */
  fun dispose()
}

/**
 * A captured frame: JPEG bytes plus the column-major camera world and projection matrices it was
 * rendered with (so 2D detections on this image can be unprojected later).
 */
class CapturedFrame(
  val jpeg: ByteArray,
  val width: Int,
  val height: Int,
  val cameraWorld: FloatArray,
  val projection: FloatArray,
  val timestampMs: Long,
)

/** A hit on the loaded scene. [nodeIndex] is the glTF node owning the hit renderable. */
class ThreeLivePick(
  val nodeIndex: Int,
  /** World-space hit point (xyz), or `null` when the renderer cannot compute it. */
  val hitPoint: FloatArray?,
)

/** A world-space pointer ray (touch or controller), with the scene hit under it, if any. */
class ThreeLivePointer(
  val origin: DoubleArray,
  val direction: DoubleArray,
  /** Node under the pointer, or `null` for empty space. */
  val pick: ThreeLivePick?,
)

/** Callbacks from a [ThreeLiveSceneRenderer]; all are optional and run on the main thread. */
interface ThreeLiveRendererListener {
  /** A tap selected [pick]. */
  fun onPick(pick: ThreeLivePick) {}

  /** A long press on [pick] began (used for hold-to-ask) or ended ([pressed] = `false`). */
  fun onLongPress(pick: ThreeLivePick, pressed: Boolean) {}

  /**
   * A pointer went down. Return `true` to capture it: the renderer then skips camera orbiting
   * and delivers [onPointerMove] / [onPointerUp] for this pointer (used by handles and paint).
   */
  fun onPointerDown(pointer: ThreeLivePointer): Boolean = false

  /** A captured pointer moved. */
  fun onPointerMove(pointer: ThreeLivePointer) {}

  /** A captured pointer was released or cancelled. */
  fun onPointerUp(pointer: ThreeLivePointer) {}

  /** The orbit camera changed by at least 1° or 0.02 zoom (same rule as the web viewer). */
  fun onCameraChange(change: ThreeLiveCameraChange) {}

  /**
   * Called once per rendered frame before drawing. [cameraWorld] is the camera's column-major
   * world matrix (the "head pose" for follow / orbit traits); it is a reused buffer.
   */
  fun onFrame(dtSeconds: Double, cameraWorld: FloatArray) {}
}
