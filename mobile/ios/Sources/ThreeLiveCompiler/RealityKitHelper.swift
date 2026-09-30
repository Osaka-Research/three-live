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

// RealityKit's Entity loading APIs are unavailable on tvOS below tvOS 26, and
// `Entity.loadAsync(contentsOf:)` is marked explicitly unavailable there, so this helper is
// not offered on tvOS. The compiler itself (`ThreeCompiler`) is fully supported on tvOS.
#if canImport(RealityKit) && !os(tvOS)
  import Combine
  import Dispatch
  import Foundation
  import RealityKit

  /// Errors thrown while bridging compiled USDZ bytes into RealityKit.
  public enum RealityKitHelperError: Error, LocalizedError {
    /// The RealityKit load publisher completed without producing an entity.
    case entityLoadProducedNoResult

    public var errorDescription: String? {
      switch self {
      case .entityLoadProducedNoResult:
        return "RealityKit finished loading without producing an Entity"
      }
    }
  }

  /// Helper utilities for loading procedural Three.js models directly into Apple RealityKit.
  @available(iOS 15.0, macOS 12.0, visionOS 1.0, *)
  public enum RealityKitHelper {

    /// Serial queue for temporary-file writes, kept off both the main actor and the
    /// cooperative thread pool.
    private static let ioQueue = DispatchQueue(
      label: "com.google.threelive.realitykit.io",
      qos: .userInitiated
    )

    /// Compiles a Three.js script on a background thread and streams it into a RealityKit
    /// `Entity` via native USDZ.
    ///
    /// - Parameter script: The procedural Three.js JavaScript code.
    /// - Returns: A RealityKit `Entity` loaded from the compiled USDZ bytes.
    @MainActor
    public static func loadEntity(from script: String) async throws -> Entity {
      let usdzData = try await ThreeCompiler.compileUSDZ(script)
      return try await loadEntity(fromUSDZ: usdzData)
    }

    /// Loads a RealityKit `Entity` directly from binary USDZ Data.
    ///
    /// - Parameter usdzData: The binary USDZ archive data.
    /// - Returns: A RealityKit `Entity`.
    @MainActor
    public static func loadEntity(fromUSDZ usdzData: Data) async throws -> Entity {
      let tempURL = try await writeTemporaryUSDZ(usdzData)

      defer {
        try? FileManager.default.removeItem(at: tempURL)
      }

      if #available(iOS 18.0, macOS 15.0, visionOS 1.0, *) {
        return try await Entity(contentsOf: tempURL)
      } else {
        return try await loadEntityWithoutBlocking(contentsOf: tempURL)
      }
    }

    /// Loads a RealityKit `Entity` from binary GLB Data by transcoding directly to USDZ.
    ///
    /// - Parameter glbData: The binary GLB data.
    /// - Returns: A RealityKit `Entity`.
    @MainActor
    public static func loadEntity(fromGLB glbData: Data) async throws -> Entity {
      let usdzData = try await ThreeCompiler.glbToUSDZ(glbData)
      return try await loadEntity(fromUSDZ: usdzData)
    }

    // MARK: - Private helpers

    /// Writes USDZ bytes to a unique temporary file without blocking the main actor.
    private static func writeTemporaryUSDZ(_ usdzData: Data) async throws -> URL {
      try await withCheckedThrowingContinuation { continuation in
        ioQueue.async {
          continuation.resume(
            with: Result {
              let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("usdz")
              #if os(iOS) || os(visionOS) || os(tvOS)
                try usdzData.write(
                  to: url,
                  options: [.atomic, .completeFileProtectionUnlessOpen]
                )
              #else
                try usdzData.write(to: url, options: .atomic)
              #endif
              return url
            })
        }
      }
    }

    /// Non-blocking `Entity` load for OS versions predating the `async` initializer.
    ///
    /// `Entity.load(contentsOf:)` is synchronous and is annotated by Apple as blocking the
    /// main actor (it also carries `@available(*, noasync)`, which is a warning today and a
    /// hard error under the Swift 6 language mode). `Entity.loadAsync(contentsOf:)` has been
    /// available since iOS 13 / macOS 10.15, comfortably below this package's deployment
    /// floor, so there is never a reason to take the blocking path.
    @MainActor
    private static func loadEntityWithoutBlocking(contentsOf url: URL) async throws -> Entity {
      for try await entity in Entity.loadAsync(contentsOf: url).values {
        return entity
      }
      throw RealityKitHelperError.entityLoadProducedNoResult
    }
  }
#endif
