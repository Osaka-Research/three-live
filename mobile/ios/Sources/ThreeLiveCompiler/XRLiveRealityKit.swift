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

#if canImport(RealityKit) && !os(tvOS)
  import Foundation
  import RealityKit

  /// Declarative spatial traits extracted from `mesh.userData.xr` in a Three.js scene.
  ///
  /// The original fields (`grabbable` ... `mass`) are kept source-compatible. The extended spatial
  /// fields added after them are parsed from the canonical compiled form
  /// (`nodes[i].extras.xr`, see `docs/xr-spatial-parity.md`) with the same clamps as every
  /// other platform.
  public struct XRLiveEntityTraits: Codable, Sendable, Equatable {
    public var grabbable: Bool?
    public var billboard: String?
    public var anchor: String?
    /// Follow mode (`"head"`, `"hand-left"`, `"hand-right"`). Set for both eager and lazy
    /// follows; `lazyFollow` is non-`nil` only for lazy follows.
    public var follow: String?
    public var followDistance: Float?
    public var physics: String?
    public var restitution: Float?
    public var mass: Float?

    /// Canonical grab mode (`"1-hand"` or `"2-hand"`).
    public var grabMode: String?
    /// Minimum uniform scale for system manipulation (`scale.min`).
    public var minScale: Float?
    /// Maximum uniform scale for system manipulation (`scale.max`).
    public var maxScale: Float?
    /// Lazy head / hand follow parameters.
    public var lazyFollow: XRLiveLazyFollow?
    /// Orbit parameters (named target or literal center).
    public var orbit: XRLiveOrbit?
    /// Manipulation handle parameters.
    public var handles: XRLiveHandles?
    /// Particle emitter parameters.
    public var particles: XRLiveParticles?
    /// Hold-to-ask (Gemini Live) parameters.
    public var holdToAsk: XRLiveHoldToAsk?
    /// World-understanding opt-in flags.
    public var worldUnderstanding: XRLiveWorldUnderstanding?
    /// Gaussian splat URL (already filtered by the `safeMediaUrl` allow-list).
    public var splatUrl: String?
    /// Host-provided spatial panel slot name.
    public var spatialSlot: String?
    /// Spatial audio parameters (`src` already filtered by the `safeMediaUrl` allow-list).
    public var audio: XRLiveSpatialAudio?
    /// Post-processing bloom parameters.
    public var bloom: XRLiveBloom?
    /// Silhouette selection outline parameters.
    public var outline: XRLiveOutline?

    public init(
      grabbable: Bool? = nil,
      billboard: String? = nil,
      anchor: String? = nil,
      follow: String? = nil,
      followDistance: Float? = nil,
      physics: String? = nil,
      restitution: Float? = nil,
      mass: Float? = nil,
      grabMode: String? = nil,
      minScale: Float? = nil,
      maxScale: Float? = nil,
      lazyFollow: XRLiveLazyFollow? = nil,
      orbit: XRLiveOrbit? = nil,
      handles: XRLiveHandles? = nil,
      particles: XRLiveParticles? = nil,
      holdToAsk: XRLiveHoldToAsk? = nil,
      worldUnderstanding: XRLiveWorldUnderstanding? = nil,
      splatUrl: String? = nil,
      spatialSlot: String? = nil,
      audio: XRLiveSpatialAudio? = nil,
      bloom: XRLiveBloom? = nil,
      outline: XRLiveOutline? = nil
    ) {
      self.grabbable = grabbable
      self.billboard = billboard
      self.anchor = anchor
      self.follow = follow
      self.followDistance = followDistance
      self.physics = physics
      self.restitution = restitution
      self.mass = mass
      self.grabMode = grabMode
      self.minScale = minScale
      self.maxScale = maxScale
      self.lazyFollow = lazyFollow
      self.orbit = orbit
      self.handles = handles
      self.particles = particles
      self.holdToAsk = holdToAsk
      self.worldUnderstanding = worldUnderstanding
      self.splatUrl = splatUrl
      self.spatialSlot = spatialSlot
      self.audio = audio
      self.bloom = bloom
      self.outline = outline
    }

    /// Builds entity traits from a raw `extras.xr` dictionary, combining the legacy keys
    /// with the canonical normalized traits.
    static func from(xr: [String: Any]) -> XRLiveEntityTraits {
      let canonical = XRLiveTraitParser.normalize(xr)
      let traitsList = (XRJSON.array(xr["traits"]) ?? []).compactMap { XRJSON.string($0) }
      let legacyGrab = XRJSON.bool(xr["grabbable"]) ?? traitsList.contains("grab")
      let billboard =
        XRJSON.string(xr["billboard"])
        ?? (traitsList.contains("billboard") ? "capsule" : nil)
        ?? canonical?.billboard
      // `follow` is a string (eager) or an object (lazy) in compiled GLBs.
      let follow =
        XRJSON.string(xr["follow"]) ?? canonical?.follow ?? canonical?.lazyFollow?.mode
      let followDistance =
        XRJSON.number(xr["followDistance"]).map { Float($0) } ?? canonical?.lazyFollow?.distance
      return XRLiveEntityTraits(
        grabbable: legacyGrab || canonical?.grab != nil,
        billboard: billboard,
        anchor: XRJSON.string(xr["anchor"]),
        follow: follow,
        followDistance: followDistance,
        physics: XRJSON.string(xr["physics"]),
        restitution: XRJSON.number(xr["restitution"]).map { Float($0) },
        mass: XRJSON.number(xr["mass"]).map { Float($0) },
        grabMode: canonical?.grab,
        minScale: canonical?.scale?.min,
        maxScale: canonical?.scale?.max,
        lazyFollow: canonical?.lazyFollow,
        orbit: canonical?.orbit,
        handles: canonical?.handles,
        particles: canonical?.particles,
        holdToAsk: canonical?.holdToAsk,
        worldUnderstanding: canonical?.worldUnderstanding,
        splatUrl: canonical?.splatUrl,
        spatialSlot: canonical?.spatialSlot,
        audio: canonical?.audio,
        bloom: canonical?.bloom,
        outline: canonical?.outline
      )
    }
  }

  @available(iOS 15.0, macOS 12.0, visionOS 1.0, *)
  extension RealityKitHelper {

    /// Extracts a map of node/entity name to `XRLiveEntityTraits` from a compiled `.glb` buffer's
    /// JSON chunk (`nodes[].extras.xr`).
    public static func extractXRTraits(fromGLB glbData: Data) -> [String: XRLiveEntityTraits] {
      guard
        let root = XRLiveGLB.jsonRoot(fromGLB: glbData),
        let nodes = root["nodes"] as? [Any]
      else {
        return [:]
      }

      var result: [String: XRLiveEntityTraits] = [:]
      for (idx, rawNode) in nodes.prefix(XRLiveRuntimeSession.maxSceneElements).enumerated() {
        guard
          let node = rawNode as? [String: Any],
          let extras = node["extras"] as? [String: Any],
          let xr = extras["xr"] as? [String: Any]
        else {
          continue
        }
        let name = XRJSON.string(node["name"]) ?? "Node_\(idx)"
        result[name] = XRLiveEntityTraits.from(xr: xr)
      }
      return result
    }

    /// Extracts canonical traits keyed by glTF node index from a compiled `.glb` buffer.
    public static func extractCanonicalXRTraits(fromGLB glbData: Data) -> [Int: XRLiveNodeTraits] {
      guard let root = XRLiveGLB.jsonRoot(fromGLB: glbData) else { return [:] }
      return XRLiveTraitParser.traits(fromGLTF: root)
    }

    /// Extracts the root `extensions.KHR_interactivity` behavior graph from a compiled `.glb`
    /// buffer as JSON bytes, or `nil` when absent or malformed.
    public static func extractInteractivityJSON(fromGLB glbData: Data) -> Data? {
      XRLiveGLB.interactivityJSON(fromGLB: glbData)
    }

    /// Applies `XRLiveEntityTraits` (`userData.xr`) to a loaded RealityKit `Entity` hierarchy,
    /// wiring up native `InputTargetComponent`, `CollisionComponent`, and `PhysicsBodyComponent`
    /// without requiring a WebView.
    ///
    /// - Parameters:
    ///   - traitsByName: Map of mesh/entity name to `XRLiveEntityTraits`.
    ///   - rootEntity: The root `Entity` returned by `RealityKitHelper.loadEntity(from:)`.
    @MainActor
    public static func applyXRTraits(
      _ traitsByName: [String: XRLiveEntityTraits],
      to rootEntity: Entity
    ) {
      // USDZ prim names are sanitized USD identifiers, so also index the sanitized names.
      var lookup = traitsByName
      for (name, traits) in traitsByName {
        let prim = XRLiveGLB.usdPrimName(for: name, fallback: name)
        if lookup[prim] == nil {
          lookup[prim] = traits
        }
      }
      func visit(_ entity: Entity) {
        entity.components.remove(AnchoringComponent.self)
        if let traits = lookup[entity.name] {
          configureEntity(entity, with: traits)
        }
        for child in entity.children {
          visit(child)
        }
      }
      visit(rootEntity)
    }

    static let outlineShellName = "__xr_outline_shell"

    /// Renders an `outline` trait as an inverted hull: an unlit, front-face-culled copy of each
    /// model under `entity`, pushed outward by the trait thickness (pixels, converted at a 1.5 m
    /// viewing distance) so only its silhouette rim shows. Works on iOS and visionOS.
    @MainActor
    public static func applyOutline(_ outline: XRLiveOutline, to entity: Entity) {
      removeOutline(from: entity)
      let rgb = XRLivePostProcessing.rgb(fromHex: outline.color)
      var material = UnlitMaterial(
        color: XRPlatformColor(
          red: CGFloat(rgb.x), green: CGFloat(rgb.y), blue: CGFloat(rgb.z), alpha: 1))
      // Front-face culling (iOS 18 / visionOS 2 SDK) is what turns the shell into a rim; without
      // it the shell would hide the model, so older systems fall back to a hover highlight.
      var culled = false
      #if compiler(>=6.0)
        if #available(iOS 18.0, macOS 15.0, visionOS 2.0, *) {
          material.faceCulling = .front
          culled = true
        }
      #endif
      guard culled else {
        #if os(visionOS)
          entity.components.set(HoverEffectComponent())
        #endif
        return
      }
      let offset = XRLivePostProcessing.outlineShellOffset(thicknessPixels: outline.thickness)
      var targets: [(Entity, MeshResource)] = []
      func collect(_ e: Entity) {
        if e.name == outlineShellName { return }
        if let model = e.components[ModelComponent.self] { targets.append((e, model.mesh)) }
        for child in e.children { collect(child) }
      }
      collect(entity)
      for (owner, mesh) in targets {
        let bounds = mesh.bounds
        let radius = max(1e-3, simd_length(bounds.extents) / 2)
        let s = 1 + offset / radius
        let shell = ModelEntity(mesh: mesh, materials: [material])
        shell.name = outlineShellName
        shell.scale = SIMD3<Float>(repeating: s)
        // Scale about the mesh's bounds center so off-center meshes stay aligned.
        shell.position = bounds.center * (1 - s)
        owner.addChild(shell)
      }
    }

    /// Removes outline shells previously added by `applyOutline`.
    @MainActor
    public static func removeOutline(from entity: Entity) {
      func visit(_ e: Entity) {
        for child in Array(e.children) {
          if child.name == outlineShellName {
            child.removeFromParent()
          } else {
            visit(child)
          }
        }
      }
      visit(entity)
    }

    /// Configures an individual RealityKit `Entity` with native spatial components corresponding
    /// to its `userData.xr` traits.
    @MainActor
    public static func configureEntity(_ entity: Entity, with traits: XRLiveEntityTraits) {
      let interactive =
        traits.grabbable == true || traits.handles != nil || traits.holdToAsk != nil
      let needsCollision =
        interactive || (traits.physics != nil && traits.physics != "none")
      if needsCollision {
        entity.generateCollisionShapes(recursive: true)
      }

      if interactive {
        #if os(visionOS)
          entity.components.set(InputTargetComponent(allowedInputTypes: .all))
        #elseif os(iOS) && compiler(>=6.0)
          // `InputTargetComponent` ships in the iOS 18 SDK (Xcode 16 / Swift 6 compiler).
          if #available(iOS 18.0, *) {
            entity.components.set(InputTargetComponent(allowedInputTypes: .all))
          }
        #endif
        #if os(visionOS)
          entity.components.set(HoverEffectComponent())
        #endif
      }
      if let outline = traits.outline, outline.enabled {
        applyOutline(outline, to: entity)
      } else {
        removeOutline(from: entity)
      }

      if let physicsMode = traits.physics, physicsMode != "none" {
        let mode: PhysicsBodyMode
        switch physicsMode {
        case "dynamic":
          mode = .dynamic
        case "kinematic":
          mode = .kinematic
        default:
          mode = .static
        }
        let rawRestitution = traits.restitution ?? 0.6
        let safeRestitution =
          rawRestitution.isFinite ? min(max(rawRestitution, 0.0), 1.0) : Float(0.6)
        let rawMass = traits.mass ?? 1.0
        let safeMass = rawMass.isFinite ? min(max(rawMass, 0.001), 10_000.0) : Float(1.0)
        let material = PhysicsMaterialResource.generate(
          staticFriction: 0.5,
          dynamicFriction: 0.4,
          restitution: safeRestitution
        )
        let massProps = PhysicsMassProperties(mass: safeMass)
        entity.components.set(
          PhysicsBodyComponent(
            massProperties: massProps,
            material: material,
            mode: mode
          )
        )
      }

      // `BillboardComponent` ships in the iOS 18 / macOS 15 / visionOS 2 SDKs (Xcode 16).
      #if compiler(>=6.0)
        if #available(iOS 18.0, macOS 15.0, visionOS 2.0, *) {
          if let bb = traits.billboard, !bb.isEmpty, bb != "false" {
            entity.components.set(BillboardComponent())
          }
        }
      #endif
    }
  }
#endif
