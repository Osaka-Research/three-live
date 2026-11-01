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
    @State private var currentSceneBounds: (center: SIMD3<Double>, radius: Double) = (.zero, 1.48)
    @State private var runtimeSession: XRLiveRealityKitSession? = nil
    @State private var runtimeFeatures: XRBlocksRealityKitFeatures? = nil
    @State private var cameraDistanceMode: String = "auto"
    @State private var cameraResetToken: Int = 0

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

    private var currentCameraOptions: XRCameraOptions {
      let autoRot = isArPreviewMode ? arAutoRotate : (selectedMode == .threeLive)
      let initialOrbit = selectedMode == .threeLive ? "23deg 20deg" : "34deg 20deg"
      return XRCameraOptions(
        cameraOrbit: initialOrbit,
        fieldOfView: "45deg",
        cameraControls: true,
        autoRotate: autoRot,
        autoRotateDelay: 1.5,
        distanceMode: cameraDistanceMode
      )
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
                sceneBounds: currentSceneBounds,
                cameraOptions: currentCameraOptions,
                modelScale: isArPreviewMode ? arScalePreset : 1.0,
                resetToken: cameraResetToken,
                runtimeSession: runtimeSession,
                runtimeFeatures: runtimeFeatures,
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
                        cameraResetToken += 1
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

                // Three.js Code Editor Header Row + Camera Distance Mode Toggle
                HStack {
                  Text("Three.js Source (Tap/Edit):")
                    .font(.caption)
                    .foregroundColor(.secondary)
                  Spacer()
                  Button(action: {
                    cameraDistanceMode = (cameraDistanceMode == "auto") ? "absolute" : "auto"
                    cameraResetToken += 1
                  }) {
                    Text(
                      cameraDistanceMode == "auto"
                        ? "Camera: Auto (2.5×)" : "Camera: Fixed (3.0m)"
                    )
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor.opacity(0.15))
                    .foregroundColor(.accentColor)
                    .cornerRadius(6)
                  }
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
      isArPreviewMode = true
      cameraResetToken += 1
      runtimeSession?.setArSurfacePreviewEnabled(true, groundY: -0.95)
    }

    @MainActor
    private func exitArPreview() {
      runtimeSession?.setArSurfacePreviewEnabled(false)
      isArPreviewMode = false
      arPreviewNote = nil
      arScalePreset = 1.0
      cameraResetToken += 1
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

        let entity = try await RealityKitHelper.loadEntity(fromUSDZ: data)
        for anim in entity.availableAnimations {
          _ = entity.playAnimation(anim.repeat())
        }

        runtimeFeatures?.dispose()
        runtimeFeatures = nil
        runtimeSession?.stop()
        if let live = XRLiveRealityKitSession(glbData: glbData, root: entity) {
          currentSceneBounds = live.session.sceneBounds
          live.installStudioLights()
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
          let vb = entity.visualBounds(recursive: true, relativeTo: entity)
          if !vb.isEmpty {
            let halfDiag = Double(0.5 * simd_length(vb.max - vb.min))
            let c = vb.center.x.isFinite ? vb.center : .zero
            currentSceneBounds = (
              center: SIMD3<Double>(Double(c.x), Double(c.y), Double(c.z)),
              radius: halfDiag.isFinite ? max(halfDiag, 0.5) : 1.48
            )
          } else {
            currentSceneBounds = (.zero, 1.48)
          }
          if !traits.isEmpty {
            RealityKitHelper.applyXRTraits(traits, to: entity)
          }
          runtimeSession = nil
        }

        currentEntity = entity
        cameraResetToken += 1
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

  /// UIViewRepresentable hosting a RealityKit scene driven by the shared cross-platform
  /// `XROrbitCameraState` and `XRLiveRealityKitSession` studio lighting rig.
  @available(iOS 15.0, *)
  struct ModelViewportRepresentable: UIViewRepresentable {
    let entity: Entity?
    let sceneBounds: (center: SIMD3<Double>, radius: Double)
    let cameraOptions: XRCameraOptions
    let modelScale: Float
    let resetToken: Int
    let runtimeSession: XRLiveRealityKitSession?
    let runtimeFeatures: XRBlocksRealityKitFeatures?
    let onTapNode: ((String) -> Void)?

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
      weak var arView: ARView?
      weak var camera: PerspectiveCamera?
      let pivot = Entity()
      var orbit = XROrbitCameraState()
      var modelScale: Float = 1.0
      var lastCameraOptions: XRCameraOptions?
      var lastResetToken: Int = -1
      var runtimeSession: XRLiveRealityKitSession?
      var runtimeFeatures: XRBlocksRealityKitFeatures?
      var onTapNode: ((String) -> Void)?
      var isDragging: Bool = false
      var isDraggingHandle: Bool = false
      var lastPanLocation: CGPoint = .zero
      var currentHeadPose = XRPose(position: SIMD3<Float>(0, 1.2, 3.5))
      var currentCameraTransform: simd_float4x4 = matrix_identity_float4x4
      var updateCancellable: Cancellable?

      public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
      ) -> Bool {
        gestureRecognizer is UIPinchGestureRecognizer || other is UIPinchGestureRecognizer
      }

      @MainActor
      func applyCameraPose() {
        guard let camera = camera else { return }
        let eye = orbit.eye
        let target = orbit.target
        camera.look(
          at: SIMD3<Float>(Float(target.x), Float(target.y), Float(target.z)),
          from: SIMD3<Float>(Float(eye.x), Float(eye.y), Float(eye.z)),
          relativeTo: nil
        )
        camera.camera.fieldOfViewInDegrees = Float(orbit.fieldOfViewDeg)
        var mat = orbit.turntableMatrix
        let s = (modelScale.isFinite && modelScale > 0) ? modelScale : 1.0
        if abs(s - 1.0) > 1e-4 {
          let scaleMat = simd_float4x4(
            diagonal: SIMD4<Float>(s, s, s, 1.0))
          mat = simd_mul(mat, scaleMat)
        }
        pivot.setTransformMatrix(mat, relativeTo: nil)
        if let arSurface = pivot.findEntity(named: "ThreeLiveArSurfacePreview") {
          arSurface.scale = SIMD3<Float>(repeating: 1.0 / s)
        }
        let worldMat = camera.transformMatrix(relativeTo: nil)
        currentCameraTransform = worldMat
        currentHeadPose = XRPose(matrix: worldMat)
      }

      @MainActor
      @objc func handleTap(_ recognizer: UITapGestureRecognizer) {
        guard recognizer.state == .ended, let view = arView else { return }
        orbit.touch(now: ProcessInfo.processInfo.systemUptime)
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
        let now = ProcessInfo.processInfo.systemUptime
        switch recognizer.state {
        case .began:
          isDragging = true
          lastPanLocation = location
          isDraggingHandle = runtimeFeatures?.pointerDown(at: location, in: view) ?? false
        case .changed:
          if isDraggingHandle {
            runtimeFeatures?.pointerMove(at: location, in: view)
          } else {
            let deltaX = Double(location.x - lastPanLocation.x)
            let deltaY = Double(location.y - lastPanLocation.y)
            orbit.drag(dx: deltaX, dy: deltaY, now: now)
          }
          lastPanLocation = location
        case .ended, .cancelled, .failed:
          if isDraggingHandle {
            runtimeFeatures?.pointerUp()
          }
          isDraggingHandle = false
          isDragging = false
          orbit.touch(now: now)
        default:
          break
        }
      }

      @MainActor
      @objc func handlePinch(_ recognizer: UIPinchGestureRecognizer) {
        guard !isDraggingHandle, recognizer.state == .changed else { return }
        orbit.pinch(scale: Double(recognizer.scale), now: ProcessInfo.processInfo.systemUptime)
        recognizer.scale = 1.0
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
      XRLiveRealityKitSession.configureStudioEnvironment(of: arView)

      let cameraAnchor = AnchorEntity(world: [0, 0, 0])
      let camera = PerspectiveCamera()
      camera.camera.fieldOfViewInDegrees = 45.0
      cameraAnchor.addChild(camera)
      arView.scene.addAnchor(cameraAnchor)
      context.coordinator.camera = camera

      let modelAnchor = AnchorEntity(world: [0, 0, 0])
      modelAnchor.name = "ModelRoot"
      modelAnchor.addChild(context.coordinator.pivot)
      arView.scene.addAnchor(modelAnchor)

      let tap = UITapGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
      let pan = UIPanGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handlePan(_:)))
      let pinch = UIPinchGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handlePinch(_:)))
      pan.maximumNumberOfTouches = 1
      pan.delegate = context.coordinator
      pinch.delegate = context.coordinator
      arView.addGestureRecognizer(tap)
      arView.addGestureRecognizer(pan)
      arView.addGestureRecognizer(pinch)
      context.coordinator.arView = arView

      context.coordinator.updateCancellable = arView.scene.subscribe(
        to: SceneEvents.Update.self
      ) { [weak coordinator = context.coordinator] event in
        guard let coordinator = coordinator else { return }
        let dt = min(max(event.deltaTime, 0), 0.1)
        let now = ProcessInfo.processInfo.systemUptime
        _ = coordinator.orbit.step(dt: dt, now: now, pointerDown: coordinator.isDragging)
        coordinator.applyCameraPose()
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
      let coordinator = context.coordinator
      coordinator.runtimeSession = runtimeSession
      coordinator.runtimeFeatures = runtimeFeatures
      coordinator.onTapNode = onTapNode

      var shouldSnapBounds = false
      if let currentEntity = entity, coordinator.pivot.children.first !== currentEntity {
        coordinator.pivot.children.removeAll()
        coordinator.pivot.addChild(currentEntity)
        shouldSnapBounds = true
      }

      if coordinator.lastResetToken != resetToken {
        coordinator.lastResetToken = resetToken
        shouldSnapBounds = true
      }

      if shouldSnapBounds {
        coordinator.orbit = XROrbitCameraState()
      }

      if coordinator.lastCameraOptions != cameraOptions || shouldSnapBounds {
        var opts = cameraOptions
        if !shouldSnapBounds,
          coordinator.lastCameraOptions?.cameraOrbit == cameraOptions.cameraOrbit
        {
          opts.cameraOrbit = nil
        }
        coordinator.lastCameraOptions = cameraOptions
        coordinator.orbit.apply(opts)
      }

      if shouldSnapBounds {
        coordinator.orbit.setBounds(center: sceneBounds.center, radius: sceneBounds.radius)
      }

      coordinator.modelScale = modelScale
      coordinator.applyCameraPose()
    }
  }
#endif
