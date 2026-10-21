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
  import SwiftUI
  import RealityKit
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
    @State private var rotationY: Float = 0.0
    @State private var rotationX: Float = 0.0
    @State private var isDragging: Bool = false
    @State private var lastDragTranslation: CGSize = .zero

    private var activePresets: [ScenePreset] {
      SampleScenes.presets(for: selectedMode)
    }

    public init() {}

    public var body: some View {
      NavigationView {
        GeometryReader { geo in
          VStack(spacing: 0) {
            // Top Section: 3D RealityKit Viewport (42% height)
            ZStack(alignment: .topLeading) {
              Color(red: 0.06, green: 0.08, blue: 0.12)
                .edgesIgnoringSafeArea(.all)

              ModelViewportRepresentable(
                entity: currentEntity,
                runtimeSession: runtimeSession,
                rotationY: rotationY,
                rotationX: rotationX,
                isDragging: isDragging,
                onTapNode: { nodeLabel in
                  lastEventMessage = "Tapped \(nodeLabel)"
                }
              )
              .simultaneousGesture(
                DragGesture(minimumDistance: 6)
                  .onChanged { value in
                    isDragging = true
                    let deltaX = Float(value.translation.width - lastDragTranslation.width)
                    let deltaY = Float(value.translation.height - lastDragTranslation.height)
                    rotationY += deltaX * 0.005
                    rotationX += deltaY * 0.005
                    lastDragTranslation = value.translation
                  }
                  .onEnded { _ in
                    isDragging = false
                    lastDragTranslation = .zero
                  }
              )

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
            .frame(height: geo.size.height * 0.42)

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
        .navigationTitle("Three-Live & XR-Live Studio")
        .navigationBarTitleDisplayMode(.inline)
      }
      .navigationViewStyle(.stack)
      .task {
        // Initial compilation on startup
        await compileAndRender()
      }
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

        // Load entity into RealityKit and wire up native InputTarget/Collision/PhysicsBody/Billboard components
        let entity = try await RealityKitHelper.loadEntity(fromUSDZ: data)
        if !traits.isEmpty {
          RealityKitHelper.applyXRTraits(traits, to: entity)
        }
        for anim in entity.availableAnimations {
          _ = entity.playAnimation(anim.repeat())
        }

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
          runtimeSession = live
        } else {
          runtimeSession = nil
        }

        // Reset orientation & assign
        rotationX = 0.2
        rotationY = 0.4
        currentEntity = entity
        errorMessage = nil
      } catch {
        errorMessage = error.localizedDescription
      }
      isCompiling = false
    }

    @MainActor
    private func launchARQuickLook() async {
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

  /// UIViewRepresentable hosting a RealityKit scene with camera, directional light, runtime stepping, and turntable auto-rotation.
  @available(iOS 15.0, *)
  struct ModelViewportRepresentable: UIViewRepresentable {
    let entity: Entity?
    let runtimeSession: XRLiveRealityKitSession?
    let rotationY: Float
    let rotationX: Float
    let isDragging: Bool
    let onTapNode: ((String) -> Void)?

    final class Coordinator: NSObject {
      weak var arView: ARView?
      var runtimeSession: XRLiveRealityKitSession?
      var onTapNode: ((String) -> Void)?
      var rotationY: Float = 0.4
      var rotationX: Float = 0.2
      var autoRotationAngle: Float = 0.0
      var isDragging: Bool = false
      var updateCancellable: Cancellable?

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
    }

    func makeCoordinator() -> Coordinator {
      Coordinator()
    }

    func makeUIView(context: Context) -> ARView {
      let arView = ARView(frame: .zero, cameraMode: .nonAR, automaticallyConfigureSession: false)
      arView.environment.background = .color(.black)

      // Add camera anchor
      let cameraAnchor = AnchorEntity(world: [0, 0, 0])
      let camera = PerspectiveCamera()
      camera.look(at: [0, 0, 0], from: [0, 1.2, 3.5], relativeTo: nil)
      cameraAnchor.addChild(camera)
      arView.scene.addAnchor(cameraAnchor)

      // Add studio light anchor
      let lightAnchor = AnchorEntity(world: [0, 0, 0])
      let light = DirectionalLight()
      light.light.intensity = 15000
      light.light.color = .white
      light.look(at: [0, 0, 0], from: [3, 4, 3], relativeTo: nil)
      lightAnchor.addChild(light)
      arView.scene.addAnchor(lightAnchor)

      // Model root container
      let modelAnchor = AnchorEntity(world: [0, 0, 0])
      modelAnchor.name = "ModelRoot"
      arView.scene.addAnchor(modelAnchor)

      let tap = UITapGestureRecognizer(
        target: context.coordinator, action: #selector(Coordinator.handleTap(_:)))
      arView.addGestureRecognizer(tap)
      context.coordinator.arView = arView

      context.coordinator.updateCancellable = arView.scene.subscribe(
        to: SceneEvents.Update.self
      ) { [weak coordinator = context.coordinator] event in
        guard let coordinator = coordinator else { return }
        let dt = min(max(event.deltaTime, 0), 0.1)
        if !coordinator.isDragging {
          coordinator.autoRotationAngle += Float(dt) * 0.42
        }
        if let anchor = coordinator.arView?.scene.findEntity(named: "ModelRoot") {
          anchor.orientation =
            simd_quatf(angle: coordinator.rotationY + coordinator.autoRotationAngle, axis: [0, 1, 0])
            * simd_quatf(angle: coordinator.rotationX, axis: [1, 0, 0])
        }
        coordinator.runtimeSession?.step(dt: dt)
      }

      return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
      context.coordinator.runtimeSession = runtimeSession
      context.coordinator.onTapNode = onTapNode
      context.coordinator.rotationY = rotationY
      context.coordinator.rotationX = rotationX
      context.coordinator.isDragging = isDragging

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

      modelAnchor.orientation =
        simd_quatf(
          angle: rotationY + context.coordinator.autoRotationAngle, axis: [0, 1, 0])
        * simd_quatf(angle: rotationX, axis: [1, 0, 0])
    }
  }
#endif
