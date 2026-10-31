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

#if os(iOS)
  import Combine
  import RealityKit
  import SwiftUI
  import ThreeLiveCompiler

  @available(iOS 15.0, *)
  public struct ContentView: View {

    @State private var selectedMode: StudioMode = .threeLive
    @State private var selectedPresetIndex = 0
    @State private var jsScriptText = SampleScenes.threeLivePresets[0].script
    @State private var isCompiling = false
    @State private var compileLatencyMs: Double? = nil
    @State private var usdzSizeBytes: Int? = nil
    @State private var usdzData: Data? = nil
    @State private var extractedXrTraits: [String: XRLiveEntityTraits] = [:]
    @State private var errorMessage: String? = nil
    @State private var lastEventMessage: String? = nil

    @State private var currentEntity: Entity? = nil
    @State private var runtimeSession: XRLiveRealityKitSession? = nil
    @State private var runtimeFeatures: XRBlocksRealityKitFeatures? = nil
    @State private var rotationY: Float = 0.4
    @State private var rotationX: Float = 0.33
    @State private var zoomScale: Float = 1.0

    // Full-screen in-app AR Surface Placement Preview state (used on the iOS Simulator where
    // ARWorldTrackingConfiguration camera passthrough is unavailable in QLPreviewController).
    @State private var isArPreviewMode: Bool = false
    @State private var arPreviewNote: String? = nil
    @State private var arShowReticle: Bool = true
    @State private var arAutoRotate: Bool = false
    @State private var arScalePreset: Float = 1.0

    private var activePresets: [ScenePreset] {
      SampleScenes.presets(for: selectedMode)
    }

    public init() {}

    public var body: some View {
      NavigationView {
        GeometryReader { geo in
          VStack(spacing: 0) {
            // Top Section: 3D RealityKit Viewport (42% height in Studio mode, 100% in AR Preview mode)
            ZStack(alignment: .topLeading) {
              Color(red: 0.043, green: 0.071, blue: 0.125)
                .edgesIgnoringSafeArea(.all)

              ModelViewportRepresentable(
                entity: currentEntity,
                runtimeSession: runtimeSession,
                runtimeFeatures: runtimeFeatures,
                rotationY: $rotationY,
                rotationX: $rotationX,
                zoomScale: $zoomScale,
                autoRotate: isArPreviewMode ? arAutoRotate : (selectedMode == .threeLive),
                onTapNode: { nodeLabel in
                  lastEventMessage = "Tapped \(nodeLabel)"
                }
              )

              if isArPreviewMode {
                let activePresetName =
                  selectedPresetIndex < activePresets.count
                  ? activePresets[selectedPresetIndex].name
                  : "Three-Live Scene"
                VStack(alignment: .leading, spacing: 8) {
                  // Top AR HUD Bar
                  HStack(spacing: 8) {
                    Image(systemName: "arkit")
                      .foregroundColor(.green)
                    VStack(alignment: .leading, spacing: 2) {
                      Text("AR Surface Preview • \(activePresetName)")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(1)
                      if let note = arPreviewNote {
                        Text(note)
                          .font(.system(size: 10))
                          .foregroundColor(Color.white.opacity(0.75))
                          .lineLimit(2)
                      }
                    }
                    Spacer()
                    Button(action: {
                      Task { await presentSystemQuickLookSheet() }
                    }) {
                      Text("Quick Look")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.blue.opacity(0.85))
                        .cornerRadius(8)
                    }
                    Button(action: {
                      exitArPreview()
                    }) {
                      HStack(spacing: 4) {
                        Image(systemName: "xmark")
                        Text("Exit AR")
                      }
                      .font(.system(size: 11, weight: .semibold))
                      .foregroundColor(.white)
                      .padding(.horizontal, 10)
                      .padding(.vertical, 6)
                      .background(Color.white.opacity(0.18))
                      .cornerRadius(8)
                    }
                  }
                  .padding(10)
                  .background(Color.black.opacity(0.82))
                  .cornerRadius(12)

                  // Reticle & Auto-Rotate Toggles
                  HStack(spacing: 8) {
                    Button(action: {
                      arShowReticle.toggle()
                      runtimeSession?.setArSurfacePreviewEnabled(arShowReticle, groundY: -0.95)
                    }) {
                      Text("Surface Reticle & Grid")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(arShowReticle ? .black : .white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(arShowReticle ? Color.green : Color.black.opacity(0.75))
                        .cornerRadius(8)
                    }

                    Button(action: {
                      arAutoRotate.toggle()
                    }) {
                      Text("Auto-Rotate")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(arAutoRotate ? .black : .white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(arAutoRotate ? Color.cyan : Color.black.opacity(0.75))
                        .cornerRadius(8)
                    }
                  }

                  Spacer()

                  if let eventMsg = lastEventMessage {
                    Text(eventMsg)
                      .font(.system(.caption2, design: .monospaced))
                      .foregroundColor(.white)
                      .padding(.horizontal, 10)
                      .padding(.vertical, 5)
                      .background(Color.black.opacity(0.75))
                      .cornerRadius(12)
                  }

                  // Bottom AR Placement Controls Bar
                  VStack(alignment: .leading, spacing: 8) {
                    Text("Drag: Orbit • Pinch: Scale • Tap: Interact with 3D Objects")
                      .font(.system(size: 11))
                      .foregroundColor(Color.white.opacity(0.8))

                    HStack(spacing: 8) {
                      Text("AR Scale:")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                      ForEach(
                        [(Float(0.75), "0.75×"), (Float(1.0), "1.0×"), (Float(1.5), "1.5×")],
                        id: \.0
                      ) {
                        (scaleVal, label) in
                        Button(action: {
                          arScalePreset = scaleVal
                          zoomScale = scaleVal
                        }) {
                          Text(label)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(arScalePreset == scaleVal ? .black : .white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                              arScalePreset == scaleVal ? Color.green : Color.white.opacity(0.15)
                            )
                            .cornerRadius(8)
                        }
                      }
                      Spacer()
                      Button(action: {
                        arScalePreset = 1.0
                        zoomScale = 1.0
                        rotationX = 0.38
                        rotationY = 0.45
                      }) {
                        Text("Reset Pose")
                          .font(.system(size: 11, weight: .semibold))
                          .foregroundColor(.white)
                          .padding(.horizontal, 10)
                          .padding(.vertical, 5)
                          .background(Color.white.opacity(0.18))
                          .cornerRadius(8)
                      }
                    }
                  }
                  .padding(12)
                  .background(Color.black.opacity(0.82))
                  .cornerRadius(12)
                }
                .padding(12)
              } else {
                // Stacked Top-Left Status Pills (never collide on narrow screens)
                VStack(alignment: .leading, spacing: 6) {
                  if selectedMode == .xrLive, !extractedXrTraits.isEmpty, errorMessage == nil {
                    let grabCount = extractedXrTraits.values.filter { $0.grabbable == true }.count
                    let dynCount = extractedXrTraits.values.filter { $0.physics == "dynamic" }.count
                    let bbCount =
                      extractedXrTraits.values.filter { ($0.billboard ?? "").isEmpty == false }
                      .count
                    let orbitCount = extractedXrTraits.values.filter { $0.orbit != nil }.count
                    HStack(spacing: 6) {
                      Image(systemName: "visionpro")
                        .foregroundColor(.purple)
                      Text(
                        "XR-Live: \(extractedXrTraits.count) Nodes (\(grabCount) Grab • \(dynCount) Physics • \(bbCount) Billboard • \(orbitCount) Orbit)"
                      )
                      .font(.system(.caption2, design: .monospaced))
                      .fontWeight(.semibold)
                      .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                  }

                  if let ms = compileLatencyMs, let bytes = usdzSizeBytes, errorMessage == nil {
                    HStack(spacing: 6) {
                      Image(systemName: "bolt.fill")
                        .foregroundColor(.yellow)
                      Text(
                        "Compiled in \(String(format: "%.2f", locale: .current, ms)) ms • \(bytes) B USDZ"
                      )
                      .font(.system(.caption2, design: .monospaced))
                      .fontWeight(.semibold)
                      .lineLimit(1)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                  }
                }
                .padding(10)

                if let eventMsg = lastEventMessage {
                  VStack {
                    Spacer()
                    HStack {
                      Text(eventMsg)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Color.black.opacity(0.75))
                        .cornerRadius(12)
                      Spacer()
                    }
                    .padding(10)
                  }
                }
              }
            }
            .frame(height: isArPreviewMode ? geo.size.height : geo.size.height * 0.42)

            if !isArPreviewMode {
              // Bottom Section: Editor & Controls
              VStack(alignment: .leading, spacing: 6) {
                // Mode Toggle: Three-Live | XR-Live
                Picker("Mode", selection: $selectedMode) {
                  ForEach(StudioMode.allCases) { mode in
                    Text(mode.rawValue).tag(mode)
                  }
                }
                .pickerStyle(.segmented)
                .onChange(of: selectedMode) { newMode in
                  selectedPresetIndex = 0
                  let presets = SampleScenes.presets(for: newMode)
                  if let first = presets.first {
                    jsScriptText = first.script
                    Task { await compileAndRender() }
                  }
                }

                // Scrollable Preset Chips Row
                ScrollView(.horizontal, showsIndicators: false) {
                  HStack(spacing: 8) {
                    Text("Presets:")
                      .font(.caption)
                      .fontWeight(.bold)
                    ForEach(0..<activePresets.count, id: \.self) { idx in
                      Button(action: {
                        selectedPresetIndex = idx
                        jsScriptText = activePresets[idx].script
                        Task { await compileAndRender() }
                      }) {
                        Text(activePresets[idx].name)
                          .font(.system(size: 12, weight: .semibold))
                          .padding(.horizontal, 10)
                          .padding(.vertical, 6)
                          .background(
                            selectedPresetIndex == idx
                              ? Color.accentColor.opacity(0.22)
                              : Color(UIColor.secondarySystemBackground)
                          )
                          .foregroundColor(selectedPresetIndex == idx ? .accentColor : .primary)
                          .cornerRadius(8)
                      }
                    }
                  }
                }

                // Three.js Code Editor Header Row
                HStack {
                  Text("Three.js Source (Tap/Edit):")
                    .font(.caption)
                    .foregroundColor(.secondary)
                  Spacer()
                  Text("Rust C-ABI + RealityKit")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                }

                // Monospace Code Editor Text Area
                ZStack(alignment: .topLeading) {
                  RoundedRectangle(cornerRadius: 8)
                    .fill(Color(UIColor.secondarySystemBackground))
                    .overlay(
                      RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                    )

                  TextEditor(text: $jsScriptText)
                    .font(.system(size: 12, weight: .regular, design: .monospaced))
                    .padding(6)
                    .background(Color.clear)
                }
                .frame(minHeight: 110, maxHeight: .infinity)

                // Error Banner
                if let err = errorMessage {
                  HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                      .foregroundColor(.red)
                    Text(err)
                      .font(.system(size: 11, design: .monospaced))
                      .foregroundColor(.red)
                  }
                  .padding(8)
                  .background(Color.red.opacity(0.12))
                  .cornerRadius(6)
                }

                // Action Bar: Equal-width View in AR + Compile & Render Buttons
                HStack(spacing: 8) {
                  Button(action: {
                    Task { await launchARQuickLook() }
                  }) {
                    HStack(spacing: 6) {
                      Image(systemName: "arkit")
                      Text("View in AR")
                        .lineLimit(1)
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.green)
                    .cornerRadius(10)
                  }
                  .disabled(isCompiling || usdzData == nil)

                  Button(action: {
                    Task { await compileAndRender() }
                  }) {
                    HStack(spacing: 6) {
                      if isCompiling {
                        ProgressView()
                          .progressViewStyle(CircularProgressViewStyle(tint: .white))
                          .scaleEffect(0.8)
                        Text("Compiling...")
                          .lineLimit(1)
                      } else {
                        Image(systemName: "play.fill")
                        Text("Compile & Render")
                          .lineLimit(1)
                      }
                    }
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.blue)
                    .cornerRadius(10)
                  }
                  .disabled(isCompiling)
                }
              }
              .padding(.horizontal, 12)
              .padding(.vertical, 8)
              .background(Color(UIColor.systemBackground))
            }
          }
        }
        .navigationTitle("Three-Live & XR-Live Studio")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarHidden(isArPreviewMode)
      }
      .navigationViewStyle(.stack)
      .task {
        // Initial compilation on startup
        await compileAndRender()
      }
    }

    @MainActor
    private func enterArPreview(note: String) {
      arPreviewNote = note
      arScalePreset = 1.0
      arAutoRotate = false
      arShowReticle = true
      zoomScale = 1.0
      rotationX = 0.38
      rotationY = 0.45
      isArPreviewMode = true
      runtimeSession?.setArSurfacePreviewEnabled(true, groundY: -0.95)
    }

    @MainActor
    private func exitArPreview() {
      runtimeSession?.setArSurfacePreviewEnabled(false)
      isArPreviewMode = false
      arPreviewNote = nil
      zoomScale = 1.0
      rotationX = 0.33
      rotationY = 0.4
    }

    @MainActor
    private func compileAndRender() async {
      isCompiling = true
      errorMessage = nil

      let startTime = DispatchTime.now()
      do {
        // Compile procedural script to native USDZ Data & extract XR-Live spatial traits from GLB
        let data = try await ThreeCompiler.compileUSDZ(jsScriptText)
        let endTime = DispatchTime.now()
        let nanos = endTime.uptimeNanoseconds - startTime.uptimeNanoseconds
        compileLatencyMs = Double(nanos) / 1_000_000.0

        let glbData = try await ThreeCompiler.compileGLB(jsScriptText)
        let traits = RealityKitHelper.extractXRTraits(fromGLB: glbData)
        extractedXrTraits = traits

        usdzData = data
        usdzSizeBytes = data.count

        // Load entity into RealityKit and wire up runtime session (or static traits fallback)
        let entity = try await RealityKitHelper.loadEntity(fromUSDZ: data)
        for anim in entity.availableAnimations {
          _ = entity.playAnimation(anim.repeat())
        }

        runtimeFeatures?.dispose()
        runtimeFeatures = nil
        runtimeSession?.stop()
        if let live = XRLiveRealityKitSession(glbData: glbData, root: entity) {
          live.installInputTargets()
          live.headPoseProvider = {
            XRPose(position: SIMD3<Float>(0, 1.2, 3.5))
          }
          live.onInteractivityEvent = { id, payload in
            lastEventMessage = "Event '\(id)' \(payload)"
          }
          live.start()
          if isArPreviewMode && arShowReticle {
            live.setArSurfacePreviewEnabled(true, groundY: -0.95)
          }
          let features = XRBlocksRealityKitFeatures(live: live)
          features.onHandlesChange = { mesh, scale, yawDeg in
            lastEventMessage =
              String(format: "Handles %@: scale %.2f×, yaw %.0f°", mesh, scale, yawDeg)
          }
          runtimeSession = live
          runtimeFeatures = features
        } else {
          if !traits.isEmpty {
            RealityKitHelper.applyXRTraits(traits, to: entity)
          }
          runtimeSession = nil
        }

        // Reset orientation & assign
        rotationX = isArPreviewMode ? 0.38 : 0.33
        rotationY = isArPreviewMode ? 0.45 : (selectedMode == .threeLive ? 0.0 : 0.55)
        zoomScale = isArPreviewMode ? arScalePreset : 1.0
        currentEntity = entity
        errorMessage = nil
      } catch {
        errorMessage = error.localizedDescription
      }
      isCompiling = false
    }

    @MainActor
    private func launchARQuickLook() async {
      guard usdzData != nil else {
        errorMessage = "Compile a scene before viewing it in AR."
        return
      }
      if !QuickLookHelper.isARPlacementSupported {
        enterArPreview(
          note:
            "ARKit camera passthrough is unavailable on iOS Simulator — running built-in AR Surface Preview"
        )
        return
      }
      await presentSystemQuickLookSheet()
    }

    @MainActor
    private func presentSystemQuickLookSheet() async {
      guard let data = usdzData else {
        errorMessage = "Compile a scene before viewing it in AR."
        return
      }
      guard
        let rootVC = UIApplication.shared.connectedScenes
          .compactMap({
            ($0 as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow })?.rootViewController
          })
          .first
      else {
        errorMessage = "Could not find a window to present AR Quick Look from."
        return
      }

      do {
        try await QuickLookHelper.presentAR(from: rootVC, usdzData: data)
        errorMessage = nil
      } catch {
        errorMessage = error.localizedDescription
      }
    }
  }

  /// UIViewRepresentable hosting a RealityKit scene with spherical orbit camera, studio lighting,
  /// interactive manipulation-handle raycasting, runtime stepping, and turntable auto-rotation.
  @available(iOS 15.0, *)
  struct ModelViewportRepresentable: UIViewRepresentable {
    let entity: Entity?
    let runtimeSession: XRLiveRealityKitSession?
    let runtimeFeatures: XRBlocksRealityKitFeatures?
    @Binding var rotationY: Float
    @Binding var rotationX: Float
    @Binding var zoomScale: Float
    let autoRotate: Bool
    let onTapNode: ((String) -> Void)?

    final class Coordinator: NSObject {
      weak var arView: ARView?
      weak var camera: PerspectiveCamera?
      var runtimeSession: XRLiveRealityKitSession?
      var runtimeFeatures: XRBlocksRealityKitFeatures?
      var onTapNode: ((String) -> Void)?
      var onOrbitChanged: ((Float, Float) -> Void)?
      var onZoomChanged: ((Float) -> Void)?
      var rotationY: Float = 0.4
      var rotationX: Float = 0.33
      var zoomScale: Float = 1.0
      var pinchBaseScale: Float = 1.0
      var autoRotationAngle: Float = 0.0
      var isDragging: Bool = false
      var isDraggingHandle: Bool = false
      var lastPanLocation: CGPoint = .zero
      var autoRotate: Bool = true
      var currentHeadPose = XRPose(position: SIMD3<Float>(0, 1.2, 3.5))
      var currentCameraTransform: simd_float4x4 = matrix_identity_float4x4
      var updateCancellable: Cancellable?

      @MainActor
      func updateCameraPose() {
        guard let camera = camera else { return }
        let yaw = rotationY + autoRotationAngle
        let pitch = min(max(rotationX, -1.25), 1.25)
        let clampedZoom = min(max(zoomScale, 0.35), 2.75)
        let radius: Float = 3.7 / clampedZoom
        let cosPitch = cos(pitch)
        let camPos = SIMD3<Float>(
          radius * cosPitch * sin(yaw),
          radius * sin(pitch),
          radius * cosPitch * cos(yaw)
        )
        camera.look(at: [0, 0, 0], from: camPos, relativeTo: nil)
        let worldMat = camera.transformMatrix(relativeTo: nil)
        currentCameraTransform = worldMat
        currentHeadPose = XRPose(matrix: worldMat)
      }

      @MainActor
      @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let view = arView else { return }
        let location = recognizer.location(in: view)
        if let hit = view.hitTest(location, query: .nearest, mask: .all).first {
          _ = runtimeSession?.handleTap(on: hit.entity, hitPoint: hit.position)
          let label = hit.entity.name.isEmpty ? "mesh" : hit.entity.name
          onTapNode?(label)
        }
      }

      @MainActor
      @objc func handlePan(_ recognizer: UIPanGestureRecognizer) {
        guard let view = arView else { return }
        let location = recognizer.location(in: view)
        switch recognizer.state {
        case .began:
          isDragging = true
          lastPanLocation = location
          isDraggingHandle = runtimeFeatures?.pointerDown(at: location, in: view) ?? false
        case .changed:
          if isDraggingHandle {
            runtimeFeatures?.pointerMove(at: location, in: view)
          } else {
            let deltaX = Float(location.x - lastPanLocation.x)
            let deltaY = Float(location.y - lastPanLocation.y)
            rotationY -= deltaX * 0.007
            rotationX = min(max(rotationX + deltaY * 0.007, -1.25), 1.25)
            updateCameraPose()
            onOrbitChanged?(rotationX, rotationY)
          }
          lastPanLocation = location
        case .ended, .cancelled, .failed:
          if isDraggingHandle {
            runtimeFeatures?.pointerUp()
          }
          isDraggingHandle = false
          isDragging = false
        default:
          break
        }
      }

      @MainActor
      @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        switch recognizer.state {
        case .began:
          pinchBaseScale = zoomScale
        case .changed:
          let next = min(max(pinchBaseScale * Float(recognizer.scale), 0.35), 2.75)
          zoomScale = next
          updateCameraPose()
          onZoomChanged?(next)
        default:
          break
        }
      }
    }

    func makeCoordinator() -> Coordinator {
      Coordinator()
    }

    func makeUIView(context: Context) -> ARView {
      let arView = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
      arView.environment.background = .color(
        UIColor(red: 0.043, green: 0.071, blue: 0.125, alpha: 1.0)
      )

      // Add camera anchor
      let cameraAnchor = AnchorEntity(world: [0, 0, 0])
      let camera = PerspectiveCamera()
      camera.look(at: [0, 0, 0], from: [0, 1.2, 3.5], relativeTo: nil)
      cameraAnchor.addChild(camera)
      arView.scene.addAnchor(cameraAnchor)
      context.coordinator.camera = camera

      // Studio lighting rig: key + cool fill match Web (three-view.ts) and Android Filament; a soft
      // under-fill approximates Web's ground ambient term.
      let lightAnchor = AnchorEntity(world: [0, 0, 0])
      let keyLight = DirectionalLight()
      keyLight.light.intensity = 7500
      keyLight.light.color = UIColor(red: 1.0, green: 0.99, blue: 0.97, alpha: 1.0)
      keyLight.look(at: [0, 0, 0], from: [2.0, 4.0, 3.2], relativeTo: nil)
      lightAnchor.addChild(keyLight)

      let fillLight = DirectionalLight()
      fillLight.light.intensity = 3500
      fillLight.light.color = UIColor(red: 0.85, green: 0.92, blue: 1.0, alpha: 1.0)
      fillLight.look(at: [0, 0, 0], from: [-3.4, 1.8, -1.4], relativeTo: nil)
      lightAnchor.addChild(fillLight)

      let rimLight = DirectionalLight()
      rimLight.light.intensity = 2000
      rimLight.light.color = UIColor(red: 0.65, green: 0.70, blue: 0.80, alpha: 1.0)
      rimLight.look(at: [0, 0, 0], from: [0.0, -3.0, -2.0], relativeTo: nil)
      lightAnchor.addChild(rimLight)
      arView.scene.addAnchor(lightAnchor)

      // Model root container (kept at world origin identity so orbit/physics/handle transforms
      // operate in unrotated scene coordinates matching Web and Android).
      let modelAnchor = AnchorEntity(world: [0, 0, 0])
      modelAnchor.name = "ModelRoot"
      arView.scene.addAnchor(modelAnchor)

      let tap = UITapGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
      let pan = UIPanGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
      let pinch = UIPinchGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handlePinch(_:)))
      arView.addGestureRecognizer(tap)
      arView.addGestureRecognizer(pan)
      arView.addGestureRecognizer(pinch)
      context.coordinator.arView = arView

      context.coordinator.updateCancellable = arView.scene.subscribe(
        to: SceneEvents.Update.self
      ) { [weak coordinator = context.coordinator] event in
        guard let coordinator = coordinator else { return }
        let dt = min(max(event.deltaTime, 0), 0.1)
        if coordinator.autoRotate && !coordinator.isDragging {
          coordinator.autoRotationAngle += Float(dt) * 0.42
        }
        coordinator.updateCameraPose()
        coordinator.runtimeSession?.headPoseProvider = { [weak coordinator] in
          coordinator?.currentHeadPose
        }
        coordinator.runtimeFeatures?.cameraTransformProvider = { [weak coordinator] in
          coordinator?.currentCameraTransform
        }
        coordinator.runtimeSession?.step(dt: dt)
        coordinator.runtimeFeatures?.step(dt: dt)
      }

      return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
      context.coordinator.runtimeSession = runtimeSession
      context.coordinator.runtimeFeatures = runtimeFeatures
      context.coordinator.onTapNode = onTapNode
      context.coordinator.onOrbitChanged = { newRotX, newRotY in
        rotationX = newRotX
        rotationY = newRotY
      }
      context.coordinator.onZoomChanged = { newZoom in
        zoomScale = newZoom
      }
      if !context.coordinator.isDragging {
        context.coordinator.rotationY = rotationY
        context.coordinator.rotationX = rotationX
        context.coordinator.zoomScale = zoomScale
      }
      context.coordinator.autoRotate = autoRotate
      if !autoRotate {
        context.coordinator.autoRotationAngle = 0.0
      }

      guard let modelAnchor = uiView.scene.findEntity(named: "ModelRoot") as? AnchorEntity else {
        return
      }

      // Swap in the new model only when it is a different object. Each compile produces a
      // brand new Entity, so identity comparison is exactly the right test here: it avoids
      // tearing down and re-adding the same entity on every rotation-driven update.
      if let currentEntity = entity, modelAnchor.children.first !== currentEntity {
        modelAnchor.children.removeAll()
        modelAnchor.addChild(currentEntity)
        context.coordinator.autoRotationAngle = 0.0
      }

      context.coordinator.updateCameraPose()
    }
  }
#endif
