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

    @State private var currentEntity: Entity? = nil
    @State private var rotationY: Float = 0.0
    @State private var rotationX: Float = 0.0
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
            ZStack {
              Color(red: 0.06, green: 0.08, blue: 0.12)
                .edgesIgnoringSafeArea(.all)

              ModelViewportRepresentable(
                entity: currentEntity,
                rotationY: rotationY,
                rotationX: rotationX
              )
              .gesture(
                DragGesture()
                  .onChanged { value in
                    let deltaX = Float(value.translation.width - lastDragTranslation.width)
                    let deltaY = Float(value.translation.height - lastDragTranslation.height)
                    rotationY += deltaX * 0.005
                    rotationX += deltaY * 0.005
                    lastDragTranslation = value.translation
                  }
                  .onEnded { _ in
                    lastDragTranslation = .zero
                  }
              )

              // Overlay HUD Metrics (XR-Live Spatial Traits on Top-Left, Compile Latency on Top-Right)
              VStack {
                HStack(alignment: .top) {
                  if !extractedXrTraits.isEmpty, errorMessage == nil {
                    let grabCount = extractedXrTraits.values.filter { $0.grabbable == true }.count
                    let dynCount = extractedXrTraits.values.filter { $0.physics == "dynamic" }.count
                    let bbCount =
                      extractedXrTraits.values.filter { ($0.billboard ?? "").isEmpty == false }
                      .count
                    HStack(spacing: 6) {
                      Image(systemName: "visionpro")
                        .foregroundColor(.purple)
                      Text(
                        "XR-Live: \(extractedXrTraits.count) Nodes (\(grabCount) Grab • \(dynCount) Dynamic • \(bbCount) Billboard)"
                      )
                      .font(.system(.caption2, design: .monospaced))
                      .fontWeight(.semibold)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                    .padding(12)
                  }

                  Spacer()

                  if let ms = compileLatencyMs, let bytes = usdzSizeBytes, errorMessage == nil {
                    HStack(spacing: 6) {
                      Image(systemName: "bolt.fill")
                        .foregroundColor(.yellow)
                      Text(
                        "Compiled in \(String(format: "%.2f", locale: .current, ms)) ms • \(bytes) B USDZ"
                      )
                      .font(.system(.caption, design: .monospaced))
                      .fontWeight(.semibold)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(.ultraThinMaterial)
                    .cornerRadius(12)
                    .padding(12)
                  }
                }
                Spacer()
              }
            }
            .frame(height: geo.size.height * 0.42)

            // Bottom Section: Editor & Controls
            VStack(alignment: .leading, spacing: 8) {
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

              // Preset Picker
              Picker("Preset", selection: $selectedPresetIndex) {
                ForEach(0..<activePresets.count, id: \.self) { idx in
                  Text(activePresets[idx].name).tag(idx)
                }
              }
              .pickerStyle(.segmented)
              .onChange(of: selectedPresetIndex) { newIdx in
                let presets = activePresets
                if presets.indices.contains(newIdx) {
                  jsScriptText = presets[newIdx].script
                  Task { await compileAndRender() }
                }
              }

              // Three.js Code Editor Label
              HStack {
                Text("Three.js JavaScript Source Code (Paste or Edit):")
                  .font(.caption)
                  .foregroundColor(.secondary)
                Spacer()
                Text("\(jsScriptText.count) chars")
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
              .frame(maxHeight: .infinity)

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

              // Action Bar: Compile & AR Buttons
              HStack {
                VStack(alignment: .leading, spacing: 2) {
                  Text("Engine: Rust C-ABI + RealityKit / AR Quick Look")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                }

                Spacer()

                Button(action: {
                  Task { await launchARQuickLook() }
                }) {
                  HStack(spacing: 6) {
                    Image(systemName: "arkit")
                    Text("View in AR")
                  }
                  .font(.system(size: 13, weight: .semibold))
                  .foregroundColor(.white)
                  .padding(.horizontal, 12)
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
                    } else {
                      Image(systemName: "play.fill")
                      Text("Compile & Render")
                    }
                  }
                  .font(.system(size: 13, weight: .semibold))
                  .foregroundColor(.white)
                  .padding(.horizontal, 14)
                  .padding(.vertical, 10)
                  .background(Color.blue)
                  .cornerRadius(10)
                }
                .disabled(isCompiling)
              }
            }
            .padding(14)
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

  /// UIViewRepresentable hosting a RealityKit scene with camera and directional light.
  @available(iOS 15.0, *)
  struct ModelViewportRepresentable: UIViewRepresentable {
    let entity: Entity?
    let rotationY: Float
    let rotationX: Float

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

      return arView
    }

    func updateUIView(_ uiView: ARView, context: Context) {
      guard let modelAnchor = uiView.scene.findEntity(named: "ModelRoot") as? AnchorEntity else {
        return
      }

      // Swap in the new model only when it is a different object. Each compile produces a
      // brand new Entity, so identity comparison is exactly the right test here: it avoids
      // tearing down and re-adding the same entity on every rotation-driven update.
      if let currentEntity = entity, modelAnchor.children.first !== currentEntity {
        modelAnchor.children.removeAll()
        modelAnchor.addChild(currentEntity)
      }

      // Apply interactive rotation
      modelAnchor.orientation =
        simd_quatf(angle: rotationY, axis: [0, 1, 0])
        * simd_quatf(angle: rotationX, axis: [1, 0, 0])
    }
  }
#endif
