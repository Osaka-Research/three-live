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
  public struct XRLiveEntityTraits: Codable, Sendable, Equatable {
    public var grabbable: Bool?
    public var billboard: String?
    public var anchor: String?
    public var follow: String?
    public var followDistance: Float?
    public var physics: String?
    public var restitution: Float?
    public var mass: Float?

    public init(
      grabbable: Bool? = nil,
      billboard: String? = nil,
      anchor: String? = nil,
      follow: String? = nil,
      followDistance: Float? = nil,
      physics: String? = nil,
      restitution: Float? = nil,
      mass: Float? = nil
    ) {
      self.grabbable = grabbable
      self.billboard = billboard
      self.anchor = anchor
      self.follow = follow
      self.followDistance = followDistance
      self.physics = physics
      self.restitution = restitution
      self.mass = mass
    }
  }

  @available(iOS 15.0, macOS 12.0, visionOS 1.0, *)
  extension RealityKitHelper {

    /// Extracts a map of node/entity name to `XRLiveEntityTraits` from a compiled `.glb` buffer's
    /// JSON chunk (`nodes[].extras.xr`).
    public static func extractXRTraits(fromGLB glbData: Data) -> [String: XRLiveEntityTraits] {
      guard glbData.count >= 20 else { return [:] }
      let magic = UInt32(
        littleEndian: glbData.withUnsafeBytes {
          $0.loadUnaligned(fromByteOffset: 0, as: UInt32.self)
        })
      let version = UInt32(
        littleEndian: glbData.withUnsafeBytes {
          $0.loadUnaligned(fromByteOffset: 4, as: UInt32.self)
        })
      let chunkLenU32 = UInt32(
        littleEndian: glbData.withUnsafeBytes {
          $0.loadUnaligned(fromByteOffset: 12, as: UInt32.self)
        })
      let chunkType = UInt32(
        littleEndian: glbData.withUnsafeBytes {
          $0.loadUnaligned(fromByteOffset: 16, as: UInt32.self)
        })
      let chunkLen = Int(chunkLenU32)
      guard magic == 0x4654_6C67, version == 2, chunkType == 0x4E4F_534A,
        chunkLen > 0, chunkLen <= glbData.count - 20
      else {
        return [:]
      }

      let sliceStart = glbData.startIndex.advanced(by: 20)
      let sliceEnd = sliceStart.advanced(by: chunkLen)
      let jsonSlice = glbData.subdata(in: sliceStart..<sliceEnd)
      guard
        let root = try? JSONSerialization.jsonObject(with: jsonSlice) as? [String: Any],
        let nodes = root["nodes"] as? [[String: Any]]
      else {
        return [:]
      }

      var result: [String: XRLiveEntityTraits] = [:]
      for (idx, node) in nodes.enumerated() {
        let name = (node["name"] as? String) ?? "Node_\(idx)"
        guard
          let extras = node["extras"] as? [String: Any],
          let xr = extras["xr"] as? [String: Any]
        else {
          continue
        }
        let traitsList = (xr["traits"] as? [String]) ?? []
        let grabbable = (xr["grabbable"] as? Bool) ?? traitsList.contains("grab")
        let billboard =
          (xr["billboard"] as? String)
          ?? (traitsList.contains("billboard") ? "capsule" : nil)
        let anchor = xr["anchor"] as? String
        let follow = xr["follow"] as? String
        let followDistance = (xr["followDistance"] as? NSNumber)?.floatValue
        let physics = xr["physics"] as? String
        let restitution = (xr["restitution"] as? NSNumber)?.floatValue
        let mass = (xr["mass"] as? NSNumber)?.floatValue

        result[name] = XRLiveEntityTraits(
          grabbable: grabbable,
          billboard: billboard,
          anchor: anchor,
          follow: follow,
          followDistance: followDistance,
          physics: physics,
          restitution: restitution,
          mass: mass
        )
      }
      return result
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
      func visit(_ entity: Entity) {
        if let traits = traitsByName[entity.name] {
          configureEntity(entity, with: traits)
        }
        for child in entity.children {
          visit(child)
        }
      }
      visit(rootEntity)
    }

    /// Configures an individual RealityKit `Entity` with native spatial components corresponding
    /// to its `userData.xr` traits.
    @MainActor
    public static func configureEntity(_ entity: Entity, with traits: XRLiveEntityTraits) {
      let needsCollision =
        (traits.grabbable == true) || (traits.physics != nil && traits.physics != "none")
      if needsCollision {
        entity.generateCollisionShapes(recursive: true)
      }

      if traits.grabbable == true {
        #if os(iOS) || os(visionOS)
          if #available(iOS 18.0, visionOS 1.0, *) {
            entity.components.set(InputTargetComponent(allowedInputTypes: .all))
          }
        #endif
        #if os(visionOS)
          entity.components.set(HoverEffectComponent())
        #endif
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

      if #available(iOS 18.0, macOS 15.0, visionOS 2.0, *) {
        if let bb = traits.billboard, !bb.isEmpty, bb != "false" {
          entity.components.set(BillboardComponent())
        }
      }
    }
  }
#endif
