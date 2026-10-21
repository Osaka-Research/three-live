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

import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.threelive.GlbBuffer
import com.google.threelive.ThreeCompiler
import com.google.threelive.ThreeLiveCameraOptions
import com.google.threelive.ThreeLiveRuntimeBinding
import com.google.threelive.XRLiveNodeTraits
import com.google.threelive.XRLiveSceneCoreHelper
import com.google.threelive.filament.ThreeLiveFilamentRenderer
import java.util.Locale
import kotlin.system.measureNanoTime
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

  private var filamentRenderer: ThreeLiveFilamentRenderer? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    setContent {
      MaterialTheme(colorScheme = darkColorScheme()) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
          CompilerStudioScreen(onInitRenderer = { renderer -> filamentRenderer = renderer })
        }
      }
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    filamentRenderer?.dispose()
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CompilerStudioScreen(onInitRenderer: (ThreeLiveFilamentRenderer) -> Unit) {
  val context = LocalContext.current
  val lifecycleOwner = LocalLifecycleOwner.current
  val coroutineScope = rememberCoroutineScope()
  var selectedMode by remember { mutableStateOf(StudioMode.THREE_LIVE) }
  var selectedPresetIndex by remember { mutableStateOf(0) }
  val activePresets = remember(selectedMode) { SampleScenes.presetsFor(selectedMode) }
  var jsScriptText by remember { mutableStateOf(SampleScenes.THREE_LIVE_PRESETS[0].script) }

  var isCompiling by remember { mutableStateOf(false) }
  var compileLatencyMs by remember { mutableStateOf<Double?>(null) }
  var glbSizeBytes by remember { mutableStateOf<Int?>(null) }
  var lastCompiledGlbBytes by remember { mutableStateOf<ByteArray?>(null) }
  var extractedXrTraits by remember { mutableStateOf<List<XRLiveNodeTraits>>(emptyList()) }
  var compileError by remember { mutableStateOf<String?>(null) }

  // Full-screen in-app AR Surface Placement Preview state (used when Google Play Services for AR
  // is not installed on an emulator or when the external SceneViewerDeeplink gateway immediately
  // exits because Scene Viewer is disabled on the system image).
  var isArPreviewMode by remember { mutableStateOf(false) }
  var arPreviewNote by remember { mutableStateOf<String?>(null) }
  var arShowReticle by remember { mutableStateOf(true) }
  var arAutoRotate by remember { mutableStateOf(false) }
  var arScalePreset by remember { mutableStateOf(1.0f) }
  var externalArLaunchTimeMs by remember { mutableStateOf(0L) }

  // Owned by the composition rather than created inside the AndroidView factory below:
  // assigning the renderer to composition state from that factory mutates state that
  // composition itself reads, which is an anti-pattern. Initializing here also means the
  // renderer is never observable in a half-constructed state.
  val renderer = remember {
    ThreeLiveFilamentRenderer(context)
      .apply {
        setCameraOptions(
          ThreeLiveCameraOptions(
            autoRotate = true,
            autoRotateDelayMs = 800L,
            rotationPerSecond = "24deg",
          )
        )
      }
      .also(onInitRenderer)
  }
  // Runs the scene's KHR_interactivity graph and spatial traits on top of the renderer.
  var binding by remember { mutableStateOf<ThreeLiveRuntimeBinding?>(null) }
  var lastEvent by remember { mutableStateOf<String?>(null) }
  DisposableEffect(Unit) { onDispose { binding?.dispose() } }

  fun attachArSurfaceMeshes(showReticle: Boolean = arShowReticle) {
    renderer.setArSurfacePreviewEnabled(enabled = showReticle, groundY = -0.95f)
  }

  fun applyArCamera(scaleMultiplier: Float = arScalePreset, autoRotate: Boolean = arAutoRotate) {
    val fovDeg = (45.0f / scaleMultiplier).coerceIn(22.0f, 68.0f)
    renderer.setCameraOptions(
      ThreeLiveCameraOptions(
        cameraOrbit = "28deg 24deg",
        fieldOfView = "${fovDeg.toInt()}deg",
        autoRotate = autoRotate,
        autoRotateDelayMs = 600L,
        rotationPerSecond = "20deg",
      )
    )
  }

  fun enterArPreview(note: String) {
    arPreviewNote = note
    arScalePreset = 1.0f
    arAutoRotate = false
    arShowReticle = true
    isArPreviewMode = true
    attachArSurfaceMeshes(showReticle = true)
    applyArCamera(scaleMultiplier = 1.0f, autoRotate = false)
  }

  fun exitArPreview() {
    renderer.setArSurfacePreviewEnabled(enabled = false)
    isArPreviewMode = false
    arPreviewNote = null
    renderer.setCameraOptions(
      if (selectedMode == StudioMode.THREE_LIVE) {
        ThreeLiveCameraOptions(
          autoRotate = true,
          autoRotateDelayMs = 800L,
          rotationPerSecond = "24deg",
        )
      } else {
        ThreeLiveCameraOptions(
          cameraOrbit = "34deg 20deg",
          autoRotate = false,
        )
      }
    )
  }

  BackHandler(enabled = isArPreviewMode) { exitArPreview() }

  // Detect if an external SceneViewerDeeplink gateway activity immediately calls finish() within
  // 800 ms (which happens on emulators where com.google.android.googlequicksearchbox has
  // SceneViewerConstants.VIEWER_ENABLED = false). When detected, automatically open the built-in
  // AR Surface Placement Preview.
  DisposableEffect(lifecycleOwner) {
    val observer = LifecycleEventObserver { _, event ->
      if (event == Lifecycle.Event.ON_RESUME && externalArLaunchTimeMs > 0L) {
        val elapsedMs = SystemClock.elapsedRealtime() - externalArLaunchTimeMs
        externalArLaunchTimeMs = 0L
        if (elapsedMs < 800L) {
          enterArPreview(
            "External Scene Viewer immediately exited on this device — using built-in AR Surface Preview"
          )
        }
      }
    }
    lifecycleOwner.lifecycle.addObserver(observer)
    onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
  }

  fun triggerCompileAndRender() {
    isCompiling = true
    compileError = null

    coroutineScope.launch {
      var glbBuffer: GlbBuffer? = null
      var transferredOwnership = false
      try {
        val compiled: GlbBuffer
        val elapsedNanos = measureNanoTime {
          // Call ThreeCompiler asynchronously with zero-copy DirectByteBuffer
          compiled = ThreeCompiler.compile(jsScriptText)
        }
        glbBuffer = compiled
        val glbCopy = compiled.toByteArray()
        val size = glbCopy.size
        val xrTraits = XRLiveSceneCoreHelper.extractNodeTraits(compiled.byteBuffer.duplicate())
        withContext(Dispatchers.Main) {
          // The renderer and binding finish reading the buffer synchronously, so it is
          // freed right after (on both the success and failure paths).
          transferredOwnership = true
          compiled.use {
            binding?.dispose()
            binding = null
            renderer.setCameraOptions(
              if (selectedMode == StudioMode.THREE_LIVE) {
                ThreeLiveCameraOptions(
                  autoRotate = true,
                  autoRotateDelayMs = 800L,
                  rotationPerSecond = "24deg",
                )
              } else {
                ThreeLiveCameraOptions(
                  cameraOrbit = "34deg 20deg",
                  autoRotate = false,
                )
              }
            )
            renderer.load(it.byteBuffer.duplicate())
            if (isArPreviewMode) {
              attachArSurfaceMeshes()
              applyArCamera()
            }
            binding =
              ThreeLiveRuntimeBinding(renderer, it.byteBuffer.duplicate()).apply {
                callbacks =
                  object : ThreeLiveRuntimeBinding.Callbacks {
                    override fun onMeshClick(
                      nodeIndex: Int,
                      nodeName: String?,
                      meshName: String?,
                      point: FloatArray?,
                    ) {
                      lastEvent = "Tapped ${nodeName ?: meshName ?: "node $nodeIndex"}"
                    }

                    override fun onInteractivityEvent(eventId: String, payloadJson: String) {
                      lastEvent = "Event '$eventId' $payloadJson"
                    }
                  }
              }
          }
        }
        lastCompiledGlbBytes = glbCopy
        extractedXrTraits = xrTraits
        compileLatencyMs = elapsedNanos / 1_000_000.0
        glbSizeBytes = size
      } catch (e: Exception) {
        if (e is CancellationException) throw e
        compileError = e.localizedMessage ?: e.message ?: "Unknown compilation error"
      } finally {
        if (!transferredOwnership) {
          glbBuffer?.close()
        }
        isCompiling = false
      }
    }
  }

  fun triggerLaunchAR() {
    val glbBytes = lastCompiledGlbBytes
    if (glbBytes == null) {
      compileError = "Compile a scene before viewing it in AR."
      return
    }
    try {
      val title = activePresets.getOrNull(selectedPresetIndex)?.name ?: "Three-Live AR Scene"
      val launchedExternal =
        SceneViewerHelper.presentAR(context = context, glbBytes = glbBytes, title = title)
      compileError = null
      if (launchedExternal) {
        externalArLaunchTimeMs = SystemClock.elapsedRealtime()
      } else {
        enterArPreview(
          "ARCore (com.google.ar.core) is not installed on this emulator — running built-in AR Surface Preview"
        )
      }
    } catch (e: Exception) {
      compileError = e.localizedMessage ?: e.message ?: "Failed to launch AR Scene Viewer."
    }
  }

  Scaffold(
    topBar = {
      if (!isArPreviewMode) {
        TopAppBar(
          title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
              Icon(
                Icons.Default.Code,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
              )
              Spacer(modifier = Modifier.width(8.dp))
              Text("Three-Live & XR-Live Studio", fontWeight = FontWeight.Bold, fontSize = 18.sp)
            }
          },
          colors =
            TopAppBarDefaults.topAppBarColors(
              containerColor = MaterialTheme.colorScheme.surfaceColorAtElevation(3.dp)
            ),
        )
      }
    }
  ) { innerPadding ->
    Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
      // Top Section: 3D Filament Viewport (42% height in Studio mode, 100% in AR Preview mode)
      Box(
        modifier =
          Modifier.fillMaxWidth()
            .weight(if (isArPreviewMode) 1f else 0.42f)
            .background(Color(0xFF0B1220))
      ) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { ctx -> renderer.createView(ctx) })
        LaunchedEffect(Unit) { triggerCompileAndRender() }

        lastEvent?.let { message ->
          Surface(
            modifier =
              Modifier.align(if (isArPreviewMode) Alignment.CenterStart else Alignment.BottomStart)
                .padding(12.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFF0F172A).copy(alpha = 0.85f),
          ) {
            Text(
              text = message,
              modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
              style = MaterialTheme.typography.labelSmall,
              color = Color.White,
            )
          }
        }

        if (isArPreviewMode) {
          val activePresetName =
            activePresets.getOrNull(selectedPresetIndex)?.name ?: "Three-Live Scene"
          // Top AR HUD bar
          Column(
            modifier = Modifier.align(Alignment.TopCenter).fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
          ) {
            Surface(
              shape = RoundedCornerShape(14.dp),
              color = Color(0xFF0F172A).copy(alpha = 0.90f),
            ) {
              Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Row(
                  modifier = Modifier.weight(1f),
                  verticalAlignment = Alignment.CenterVertically,
                ) {
                  Icon(
                    Icons.Default.ViewInAr,
                    contentDescription = null,
                    tint = Color(0xFF22C55E),
                    modifier = Modifier.size(20.dp),
                  )
                  Spacer(modifier = Modifier.width(8.dp))
                  Column {
                    Text(
                      text = "AR Surface Preview • $activePresetName",
                      style = MaterialTheme.typography.titleSmall,
                      fontWeight = FontWeight.Bold,
                      color = Color.White,
                      maxLines = 1,
                      overflow = TextOverflow.Ellipsis,
                    )
                    arPreviewNote?.let { note ->
                      Text(
                        text = note,
                        style = MaterialTheme.typography.labelSmall,
                        color = Color(0xFF94A3B8),
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                      )
                    }
                  }
                }
                Spacer(modifier = Modifier.width(8.dp))
                FilledTonalButton(
                  onClick = { exitArPreview() },
                  contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                ) {
                  Icon(
                    Icons.Default.Close,
                    contentDescription = "Exit AR",
                    modifier = Modifier.size(16.dp),
                  )
                  Spacer(modifier = Modifier.width(4.dp))
                  Text("Exit AR", fontSize = 12.sp)
                }
              }
            }

            // Toggle chips for AR Surface Reticle & Turntable Auto-Rotate
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              FilterChip(
                selected = arShowReticle,
                onClick = {
                  val next = !arShowReticle
                  arShowReticle = next
                  attachArSurfaceMeshes(showReticle = next)
                },
                label = { Text("Surface Reticle & Grid", fontSize = 11.sp) },
              )
              FilterChip(
                selected = arAutoRotate,
                onClick = {
                  val next = !arAutoRotate
                  arAutoRotate = next
                  applyArCamera(scaleMultiplier = arScalePreset, autoRotate = next)
                },
                label = { Text("Auto-Rotate", fontSize = 11.sp) },
              )
            }
          }

          // Bottom AR Placement Controls Bar
          Surface(
            modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp),
            shape = RoundedCornerShape(14.dp),
            color = Color(0xFF0F172A).copy(alpha = 0.90f),
          ) {
            Column(
              modifier = Modifier.fillMaxWidth().padding(12.dp),
              verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
              Text(
                text =
                  "Drag: Orbit • Pinch: Scale • Two-Finger Drag: Move on Surface • Tap: Interact",
                style = MaterialTheme.typography.labelSmall,
                color = Color(0xFFCBD5E1),
              )
              Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
              ) {
                Text(
                  text = "AR Scale:",
                  style = MaterialTheme.typography.labelSmall,
                  fontWeight = FontWeight.SemiBold,
                  color = Color.White,
                )
                listOf(0.75f to "0.75×", 1.0f to "1.0×", 1.5f to "1.5×").forEach { (scale, label) ->
                  FilterChip(
                    selected = (arScalePreset == scale),
                    onClick = {
                      arScalePreset = scale
                      applyArCamera(scaleMultiplier = scale, autoRotate = arAutoRotate)
                    },
                    label = { Text(label, fontSize = 11.sp) },
                  )
                }
                Spacer(modifier = Modifier.weight(1f))
                OutlinedButton(
                  onClick = {
                    arScalePreset = 1.0f
                    applyArCamera(scaleMultiplier = 1.0f, autoRotate = arAutoRotate)
                  },
                  contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp),
                ) {
                  Text("Reset Pose", fontSize = 11.sp)
                }
              }
            }
          }
        } else {
          // Stack status pills vertically at TopStart so they never overlap on narrow phones
          Column(
            modifier = Modifier.align(Alignment.TopStart).padding(10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
          ) {
            if (
              selectedMode == StudioMode.XR_LIVE &&
                extractedXrTraits.isNotEmpty() &&
                compileError == null
            ) {
              val grabCount = extractedXrTraits.count { it.grabbable }
              val dynCount = extractedXrTraits.count { it.physics == "dynamic" }
              val bbCount = extractedXrTraits.count { !it.billboard.isNullOrEmpty() }
              val orbitCount = extractedXrTraits.count { it.orbit != null }
              Surface(
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF581C87).copy(alpha = 0.92f),
              ) {
                Text(
                  text =
                    "🥽 XR-Live: ${extractedXrTraits.size} Nodes ($grabCount Grab • $dynCount Physics • $bbCount Billboard • $orbitCount Orbit)",
                  modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                  style = MaterialTheme.typography.labelSmall,
                  fontWeight = FontWeight.SemiBold,
                  color = Color.White,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
              }
            }

            if (compileLatencyMs != null && compileError == null) {
              Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.9f),
              ) {
                Text(
                  text =
                    "⚡ Compiled in ${String.format(Locale.US, "%.2f", compileLatencyMs)} ms • ${glbSizeBytes} B GLB",
                  modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                  style = MaterialTheme.typography.labelSmall,
                  fontWeight = FontWeight.SemiBold,
                  color = MaterialTheme.colorScheme.onPrimaryContainer,
                  maxLines = 1,
                  overflow = TextOverflow.Ellipsis,
                )
              }
            }
          }
        }
      }

      if (!isArPreviewMode) {
        // Bottom Section: Editor & Controls (58% height)
        Column(
          modifier =
            Modifier.fillMaxWidth()
              .weight(0.58f)
              .background(MaterialTheme.colorScheme.surface)
              .padding(horizontal = 12.dp, vertical = 6.dp)
        ) {
          // Mode Toggle Row: Three-Live | XR-Live
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              "Mode:",
              style = MaterialTheme.typography.labelMedium,
              fontWeight = FontWeight.Bold,
            )
            StudioMode.values().forEach { mode ->
              FilterChip(
                selected = (selectedMode == mode),
                onClick = {
                  if (selectedMode != mode) {
                    selectedMode = mode
                    selectedPresetIndex = 0
                    val firstPreset = SampleScenes.presetsFor(mode).first()
                    jsScriptText = firstPreset.script
                    triggerCompileAndRender()
                  }
                },
                label = { Text(mode.label, fontWeight = FontWeight.SemiBold) },
              )
            }
          }

          // Preset Chips Row
          Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              "Presets:",
              style = MaterialTheme.typography.labelMedium,
              fontWeight = FontWeight.Bold,
            )
            activePresets.forEachIndexed { index, preset ->
              FilterChip(
                selected = (selectedPresetIndex == index),
                onClick = {
                  selectedPresetIndex = index
                  jsScriptText = preset.script
                  triggerCompileAndRender()
                },
                label = { Text(preset.name) },
              )
            }
          }

          Spacer(modifier = Modifier.height(4.dp))

          // Three.js Monospace Code Editor Header Row
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Text(
              text = "Three.js Source (Tap/Edit):",
              style = MaterialTheme.typography.labelMedium,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
              text = "Rust C-ABI + Filament",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.outline,
            )
          }
          Spacer(modifier = Modifier.height(4.dp))

          OutlinedTextField(
            value = jsScriptText,
            onValueChange = { jsScriptText = it },
            modifier = Modifier.fillMaxWidth().weight(1f).heightIn(min = 120.dp),
            textStyle =
              androidx.compose.ui.text.TextStyle(
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = MaterialTheme.colorScheme.onSurface,
              ),
            shape = RoundedCornerShape(8.dp),
            singleLine = false,
            maxLines = Int.MAX_VALUE,
            placeholder = { Text("// Paste your Three.js script here...") },
          )

          // Error Banner if compilation failed
          if (compileError != null) {
            Spacer(modifier = Modifier.height(6.dp))
            Surface(
              modifier = Modifier.fillMaxWidth(),
              shape = RoundedCornerShape(8.dp),
              color = MaterialTheme.colorScheme.errorContainer,
            ) {
              SelectionContainer {
                Text(
                  text = "⚠️ Compilation Error: $compileError",
                  modifier = Modifier.padding(8.dp),
                  style = MaterialTheme.typography.bodySmall,
                  color = MaterialTheme.colorScheme.onErrorContainer,
                  fontFamily = FontFamily.Monospace,
                )
              }
            }
          }

          Spacer(modifier = Modifier.height(6.dp))

          // Action Bar: Equal-width View in AR + Compile & Render Buttons
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Button(
              onClick = { triggerLaunchAR() },
              enabled = !isCompiling && lastCompiledGlbBytes != null,
              modifier = Modifier.weight(1f),
              contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
              colors =
                ButtonDefaults.buttonColors(
                  containerColor = Color(0xFF16A34A),
                  contentColor = Color.White,
                ),
            ) {
              Icon(
                Icons.Default.ViewInAr,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
              )
              Spacer(modifier = Modifier.width(6.dp))
              Text("View in AR", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }

            Button(
              onClick = { triggerCompileAndRender() },
              enabled = !isCompiling,
              modifier = Modifier.weight(1f),
              contentPadding = PaddingValues(horizontal = 12.dp, vertical = 10.dp),
              colors =
                ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
              if (isCompiling) {
                CircularProgressIndicator(
                  modifier = Modifier.size(16.dp),
                  strokeWidth = 2.dp,
                  color = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Compiling...", maxLines = 1, overflow = TextOverflow.Ellipsis)
              } else {
                Icon(
                  Icons.Default.PlayArrow,
                  contentDescription = null,
                  modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text("Compile & Render", maxLines = 1, overflow = TextOverflow.Ellipsis)
              }
            }
          }
        }
      }
    }
  }
}
