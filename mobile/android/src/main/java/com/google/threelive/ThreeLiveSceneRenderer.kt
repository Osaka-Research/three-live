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
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * The scene half of a three-live renderer: everything except creating the Android view, so the
 * runtime binding and its tests stay free of Android framework types. Android renderers implement
 * [ThreeLiveRenderer], which adds view creation.
 *
 * The core library ships no renderer. Apps either add the optional `three-live-filament` module
 * (`ThreeLiveFilament.install()`) or register their own implementation with [ThreeLiveRenderers].
 * [ThreeLiveRuntimeBinding] connects a renderer to an [XRLiveRuntimeSession], so behavior graphs,
 * spatial traits and spatial features work the same with any renderer.
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

  /**
   * Immediately clears the loaded scene and dynamic meshes so the viewport renders blank while a
   * new scene is being compiled or downloaded.
   */
  fun clear() {}

  /** Applies camera options (orbit, target, field of view, limits, auto-rotate, controls). */
  fun setCameraOptions(options: ThreeLiveCameraOptions)

  /**
   * Sets the color the viewport clears to behind the scene (sRGB components in 0..1), as the
   * element's CSS `background-color` shows through a transparent web canvas. Null restores the
   * renderer's default backdrop.
   */
  fun setClearColor(rgba: FloatArray?) {}

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

  /**
   * Updates a glTF material's PBR factors on every primitive that uses it. Colors are the factors
   * as stored in the compiled glTF (Three.js colors are sRGB `hex / 255`); renderers convert them
   * to their shading space.
   */
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
   * Adds a world-space triangle mesh used by spatial features (handles, paint strokes,
   * particles). [positions] and [normals] are xyz triples, [color] is sRGB RGBA (like Three.js hex
   * colors). Returns a mesh id,
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

  /**
   * Shows or hides the built-in 3D AR surface placement reticle and reference floor grid at
   * height [groundY] (meters) for in-app AR surface placement previews when external ARCore
   * Scene Viewer is unavailable.
   */
  fun setArSurfacePreviewEnabled(enabled: Boolean, groundY: Float = -0.95f) {}

  /** Releases every resource. The renderer is unusable afterwards; safe to call twice. */
  fun dispose()
}

/**
 * Pure-Kotlin geometry builders for the in-app 3D AR surface placement reticle and reference floor
 * grid.
 */
object ThreeLiveArSurfaceGeometry {

  /** Default linear RGBA color for the reference floor grid. */
  val DEFAULT_GRID_COLOR: FloatArray = floatArrayOf(0.18f, 0.34f, 0.46f, 1.0f)

  /** Default linear RGBA color for the AR surface placement reticle ring and crosshairs. */
  val DEFAULT_RETICLE_COLOR: FloatArray = floatArrayOf(0.13f, 0.85f, 0.68f, 1.0f)

  /**
   * Builds a flat ground-plane grid of thin quad lines on height [y] (meters) with
   * `(positions, indices)`.
   */
  @JvmStatic
  @JvmOverloads
  fun buildFloorGridGeometry(
    y: Float = -0.96f,
    halfExtent: Float = 2.0f,
    divisions: Int = 8,
    lineHalfWidth: Float = 0.008f,
  ): Pair<FloatArray, IntArray> {
    val safeDivisions = divisions.coerceIn(1, 64)
    val lineCount = (safeDivisions + 1) * 2
    val positions = FloatArray(lineCount * 4 * 3)
    val indices = IntArray(lineCount * 6)
    var vOffset = 0
    var iOffset = 0
    val step = (halfExtent * 2f) / safeDivisions

    fun addQuad(x0: Float, z0: Float, x1: Float, z1: Float) {
      val baseVertex = vOffset / 3
      positions[vOffset++] = x0
      positions[vOffset++] = y
      positions[vOffset++] = z0
      positions[vOffset++] = x1
      positions[vOffset++] = y
      positions[vOffset++] = z0
      positions[vOffset++] = x1
      positions[vOffset++] = y
      positions[vOffset++] = z1
      positions[vOffset++] = x0
      positions[vOffset++] = y
      positions[vOffset++] = z1

      indices[iOffset++] = baseVertex
      indices[iOffset++] = baseVertex + 1
      indices[iOffset++] = baseVertex + 2
      indices[iOffset++] = baseVertex
      indices[iOffset++] = baseVertex + 2
      indices[iOffset++] = baseVertex + 3
    }

    for (i in 0..safeDivisions) {
      val coord = -halfExtent + i * step
      addQuad(coord - lineHalfWidth, -halfExtent, coord + lineHalfWidth, halfExtent)
      addQuad(-halfExtent, coord - lineHalfWidth, halfExtent, coord + lineHalfWidth)
    }
    return positions to indices
  }

  /**
   * Builds a circular AR surface placement reticle ring and center crosshairs on height [y]
   * (meters) with `(positions, indices)`.
   */
  @JvmStatic
  @JvmOverloads
  fun buildReticleGeometry(
    y: Float = -0.95f,
    innerRadius: Float = 0.52f,
    outerRadius: Float = 0.60f,
    segments: Int = 48,
  ): Pair<FloatArray, IntArray> {
    val safeSegments = segments.coerceIn(8, 128)
    val ringVertices = safeSegments * 2
    val crossVertices = 8
    val positions = FloatArray((ringVertices + crossVertices) * 3)
    val indices = IntArray(safeSegments * 6 + 12)
    var vOffset = 0
    var iOffset = 0

    for (s in 0 until safeSegments) {
      val angle = (2.0 * PI * s) / safeSegments
      val c = cos(angle).toFloat()
      val sn = sin(angle).toFloat()
      positions[vOffset++] = c * innerRadius
      positions[vOffset++] = y
      positions[vOffset++] = sn * innerRadius
      positions[vOffset++] = c * outerRadius
      positions[vOffset++] = y
      positions[vOffset++] = sn * outerRadius

      val next = (s + 1) % safeSegments
      val i0 = s * 2
      val i1 = s * 2 + 1
      val i2 = next * 2 + 1
      val i3 = next * 2
      indices[iOffset++] = i0
      indices[iOffset++] = i1
      indices[iOffset++] = i2
      indices[iOffset++] = i0
      indices[iOffset++] = i2
      indices[iOffset++] = i3
    }

    val crossHalfLen = 0.14f
    val crossHalfWidth = 0.012f
    fun addCrossBar(x0: Float, z0: Float, x1: Float, z1: Float) {
      val base = vOffset / 3
      positions[vOffset++] = x0
      positions[vOffset++] = y
      positions[vOffset++] = z0
      positions[vOffset++] = x1
      positions[vOffset++] = y
      positions[vOffset++] = z0
      positions[vOffset++] = x1
      positions[vOffset++] = y
      positions[vOffset++] = z1
      positions[vOffset++] = x0
      positions[vOffset++] = y
      positions[vOffset++] = z1
      indices[iOffset++] = base
      indices[iOffset++] = base + 1
      indices[iOffset++] = base + 2
      indices[iOffset++] = base
      indices[iOffset++] = base + 2
      indices[iOffset++] = base + 3
    }
    addCrossBar(-crossHalfLen, -crossHalfWidth, crossHalfLen, crossHalfWidth)
    addCrossBar(-crossHalfWidth, -crossHalfLen, crossHalfWidth, crossHalfLen)

    return positions to indices
  }
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
