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
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.ViewInAr
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import com.google.threelive.GlbBuffer
import com.google.threelive.ThreeCompiler
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

  // Owned by the composition rather than created inside the AndroidView factory below:
  // assigning the renderer to composition state from that factory mutates state that
  // composition itself reads, which is an anti-pattern. Initializing here also means the
  // renderer is never observable in a half-constructed state.
  val renderer = remember { ThreeLiveFilamentRenderer(context).also(onInitRenderer) }
  // Runs the scene's KHR_interactivity graph and spatial traits on top of the renderer.
  var binding by remember { mutableStateOf<ThreeLiveRuntimeBinding?>(null) }
  var lastEvent by remember { mutableStateOf<String?>(null) }
  DisposableEffect(Unit) { onDispose { binding?.dispose() } }

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
            renderer.load(it.byteBuffer)
            binding =
              ThreeLiveRuntimeBinding(renderer, it.byteBuffer).apply {
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
      SceneViewerHelper.presentAR(context = context, glbBytes = glbBytes, title = title)
      compileError = null
    } catch (e: Exception) {
      compileError = e.localizedMessage ?: e.message ?: "Failed to launch AR Scene Viewer."
    }
  }

  Scaffold(
    topBar = {
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
  ) { innerPadding ->
    Column(modifier = Modifier.fillMaxSize().padding(innerPadding)) {
      // Top Section: 3D Filament Viewport (42% height)
      Box(modifier = Modifier.fillMaxWidth().weight(0.42f).background(Color(0xFF0F141C))) {
        AndroidView(modifier = Modifier.fillMaxSize(), factory = { ctx -> renderer.createView(ctx) })
        LaunchedEffect(Unit) { triggerCompileAndRender() }

        lastEvent?.let { message ->
          Surface(
            modifier = Modifier.align(Alignment.BottomStart).padding(12.dp),
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

        // Overlay XR-Live Spatial Traits Pill (Top-Left) when XR traits are present
        if (extractedXrTraits.isNotEmpty() && compileError == null) {
          val grabCount = extractedXrTraits.count { it.grabbable }
          val dynCount = extractedXrTraits.count { it.physics == "dynamic" }
          val bbCount = extractedXrTraits.count { !it.billboard.isNullOrEmpty() }
          Surface(
            modifier = Modifier.align(Alignment.TopStart).padding(12.dp),
            shape = RoundedCornerShape(16.dp),
            color = Color(0xFF581C87).copy(alpha = 0.92f),
          ) {
            Text(
              text =
                "🥽 XR-Live: ${extractedXrTraits.size} Nodes ($grabCount Grab • $dynCount Dynamic • $bbCount Billboard)",
              modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
              style = MaterialTheme.typography.labelSmall,
              fontWeight = FontWeight.SemiBold,
              color = Color.White,
            )
          }
        }

        // Overlay Compilation Status Pill (Top-Right)
        if (compileLatencyMs != null && compileError == null) {
          Surface(
            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
            shape = RoundedCornerShape(16.dp),
            color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.9f),
          ) {
            Text(
              text =
                "⚡ Compiled in ${String.format(Locale.US, "%.2f", compileLatencyMs)} ms • ${glbSizeBytes} B GLB",
              modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
              style = MaterialTheme.typography.labelSmall,
              fontWeight = FontWeight.SemiBold,
              color = MaterialTheme.colorScheme.onPrimaryContainer,
            )
          }
        }
      }

      // Bottom Section: Editor & Controls (58% height)
      Column(
        modifier =
          Modifier.fillMaxWidth()
            .weight(0.58f)
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 16.dp, vertical = 8.dp)
      ) {
        // Mode Toggle Row: Three-Live | XR-Live
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.spacedBy(8.dp),
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text("Mode:", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
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

        Spacer(modifier = Modifier.height(4.dp))

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

        Spacer(modifier = Modifier.height(8.dp))

        // Three.js Monospace Code Editor Text Area
        Text(
          text = "Three.js JavaScript Source Code (Paste or Edit):",
          style = MaterialTheme.typography.labelMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(modifier = Modifier.height(4.dp))

        OutlinedTextField(
          value = jsScriptText,
          onValueChange = { jsScriptText = it },
          modifier = Modifier.fillMaxWidth().weight(1f),
          textStyle =
            androidx.compose.ui.text.TextStyle(
              fontFamily = FontFamily.Monospace,
              fontSize = 12.sp,
              color = MaterialTheme.colorScheme.onSurface,
            ),
          shape = RoundedCornerShape(8.dp),
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

        Spacer(modifier = Modifier.height(8.dp))

        // Action Bar: View in AR + Compile & Render Buttons
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Text(
            text = "Engine: Rust C-ABI + Filament / ARCore",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.outline,
          )

          Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
          ) {
            Button(
              onClick = { triggerLaunchAR() },
              enabled = !isCompiling && lastCompiledGlbBytes != null,
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
              Spacer(modifier = Modifier.width(4.dp))
              Text("View in AR")
            }

            Button(
              onClick = { triggerCompileAndRender() },
              enabled = !isCompiling,
              colors =
                ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
            ) {
              if (isCompiling) {
                CircularProgressIndicator(
                  modifier = Modifier.size(16.dp),
                  strokeWidth = 2.dp,
                  color = MaterialTheme.colorScheme.onPrimary,
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Compiling...")
              } else {
                Icon(
                  Icons.Default.PlayArrow,
                  contentDescription = null,
                  modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("Compile & Render")
              }
            }
          }
        }
      }
    }
  }
}
