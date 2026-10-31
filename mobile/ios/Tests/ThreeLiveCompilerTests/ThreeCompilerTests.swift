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

import XCTest
#if canImport(RealityKit) && !os(tvOS)
  import RealityKit
#endif

@testable import ThreeLiveCompiler

final class ThreeCompilerTests: XCTestCase {

  /// A known-good procedural scene, matching the "Torus Knot" preset shipped in the demo.
  private static let validScript = """
    const geometry = new THREE.TorusKnotGeometry(1.0, 0.35, 100, 16);
    const material = new THREE.MeshStandardMaterial({
        color: 0x3388ff,
        metalness: 0.85,
        roughness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const light = new THREE.DirectionalLight(0xffffff, 1.5);
    light.position.set(5, 5, 5);
    scene.add(light);
    """

  /// Binary GLB containers begin with the ASCII magic `glTF`.
  private static let glbMagic: [UInt8] = [0x67, 0x6C, 0x54, 0x46]

  /// USDZ is an uncompressed ZIP archive, so it begins with the standard ZIP local header.
  private static let zipMagic: [UInt8] = [0x50, 0x4B, 0x03, 0x04]

  // MARK: - Error descriptions

  func testThreeCompilerErrorDescriptions() {
    XCTAssertEqual(
      ThreeCompilerError.compilationFailed("Syntax error on line 4").errorDescription,
      "Three.js compilation failed: Syntax error on line 4"
    )
    XCTAssertEqual(
      ThreeCompilerError.invalidScript("embedded NUL").errorDescription,
      "Script could not be passed to the native compiler: embedded NUL"
    )
    XCTAssertEqual(
      ThreeCompilerError.emptyResult("compile").errorDescription,
      "Native compiler returned an empty buffer from compile"
    )
  }

  // MARK: - Zero-copy Data bridge

  /// Exercises the representation the compiler actually produces.
  ///
  /// Payloads larger than Foundation's inline threshold keep a reference to the backing
  /// allocation, so the deallocator must not run until the `Data` itself is released. This
  /// is the path every real compile output takes.
  func testLargeBufferIsZeroCopyAndDeallocatesOnRelease() {
    var deallocatorCallCount = 0
    var reportedByteCount = -1
    let count = 4096

    let rawPtr = UnsafeMutablePointer<UInt8>.allocate(capacity: count)
    rawPtr.initialize(repeating: 0xAB, count: count)
    rawPtr[0] = 0x67

    autoreleasepool {
      let data = Data(
        bytesNoCopy: rawPtr,
        count: count,
        deallocator: .custom { (ptr, size) in
          deallocatorCallCount += 1
          reportedByteCount = size
          ptr.bindMemory(to: UInt8.self, capacity: count).deallocate()
        }
      )

      XCTAssertEqual(data.count, count)
      XCTAssertEqual(data[0], 0x67)
      XCTAssertEqual(
        deallocatorCallCount, 0,
        "A buffer this size must be referenced, not copied; the deallocator must not "
          + "run while the Data is still alive"
      )
    }

    XCTAssertEqual(
      deallocatorCallCount, 1,
      "The custom deallocator must run exactly once when Data ARC drops to zero"
    )
    XCTAssertEqual(
      reportedByteCount, count,
      "Foundation passes the constructed count to the deallocator. Production code "
        + "must therefore close over Rust's capacity rather than trusting this value."
    )
  }

  /// Documents the small-payload path, which is *not* zero-copy.
  ///
  /// Foundation stores payloads at or below its inline threshold (14 bytes on 64-bit)
  /// directly inside the `Data` value and releases the backing allocation eagerly, so the
  /// deallocator can run before `Data.init` even returns. This test deliberately asserts
  /// only the call count, not the timing, since the threshold is an implementation detail.
  func testSmallBufferIsCopiedAndStillDeallocatedExactlyOnce() {
    var deallocatorCallCount = 0
    let sampleBytes: [UInt8] = [0x67, 0x6C, 0x54, 0x46, 0x02, 0x00, 0x00, 0x00]

    let rawPtr = UnsafeMutablePointer<UInt8>.allocate(capacity: sampleBytes.count)
    rawPtr.initialize(from: sampleBytes, count: sampleBytes.count)

    autoreleasepool {
      let data = Data(
        bytesNoCopy: rawPtr,
        count: sampleBytes.count,
        deallocator: .custom { (ptr, _) in
          deallocatorCallCount += 1
          ptr.bindMemory(to: UInt8.self, capacity: sampleBytes.count).deallocate()
        }
      )

      XCTAssertEqual(Array(data), sampleBytes, "Contents must survive regardless of representation")
    }

    XCTAssertEqual(
      deallocatorCallCount, 1,
      "The custom deallocator must run exactly once, with no double free and no leak"
    )
  }

  // MARK: - Successful compilation

  func testCompileProducesGlbContainer() async throws {
    let glb = try await ThreeCompiler.compile(Self.validScript)

    XCTAssertGreaterThan(
      glb.count, 20, "A GLB container needs at least a 12-byte header and one chunk")
    XCTAssertEqual(
      Array(glb.prefix(4)), Self.glbMagic, "GLB payloads must start with the 'glTF' magic")
  }

  func testCompileUSDZProducesZipContainer() async throws {
    let usdz = try await ThreeCompiler.compileUSDZ(Self.validScript)

    XCTAssertGreaterThan(usdz.count, 20)
    XCTAssertEqual(Array(usdz.prefix(4)), Self.zipMagic, "USDZ is an uncompressed ZIP archive")
  }

  func testGlbToUSDZTranscodesCompilerOutput() async throws {
    let glb = try await ThreeCompiler.compile(Self.validScript)
    let usdz = try await ThreeCompiler.glbToUSDZ(glb)

    XCTAssertGreaterThan(usdz.count, 20)
    XCTAssertEqual(Array(usdz.prefix(4)), Self.zipMagic)
  }

  // MARK: - Failure paths

  func testCompileRejectsMalformedScript() async throws {
    do {
      _ = try await ThreeCompiler.compile("invalid javascript syntax {{{")
      XCTFail("Expected malformed JavaScript to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertFalse(message.isEmpty, "Compiler diagnostics must not be empty")
    }
  }

  func testCompileUSDZRejectsMalformedScript() async throws {
    do {
      _ = try await ThreeCompiler.compileUSDZ("invalid javascript syntax {{{")
      XCTFail("Expected malformed JavaScript to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertFalse(message.isEmpty)
    }
  }

  /// A script containing U+0000 must be rejected rather than silently truncated at the
  /// first NUL by the C string boundary.
  func testCompileRejectsScriptWithEmbeddedNullByte() async throws {
    do {
      _ = try await ThreeCompiler.compile("const a = 1;\u{0}const b = 2;")
      XCTFail("Expected a script containing an embedded NUL byte to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .invalidScript(let reason) = error else {
        return XCTFail("Expected .invalidScript, got \(error)")
      }
      XCTAssertTrue(
        reason.contains("NUL"),
        "The diagnostic should name the embedded NUL, got: \(reason)"
      )
    }
  }

  func testGlbToUSDZRejectsEmptyData() async throws {
    do {
      _ = try await ThreeCompiler.glbToUSDZ(Data())
      XCTFail("Expected empty GLB input to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertFalse(message.isEmpty)
    }
  }

  func testGlbToUSDZRejectsGarbageInput() async throws {
    do {
      _ = try await ThreeCompiler.glbToUSDZ(Data(repeating: 0x41, count: 512))
      XCTFail("Expected non-GLB input to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertFalse(message.isEmpty)
    }
  }

  // MARK: - Sandbox Security & Resource Quotas (Parity with Android & Web)

  func testCompileRejectsInfiniteLoopViaOpcodeCeiling() async throws {
    do {
      _ = try await ThreeCompiler.compile("while (true) {}")
      XCTFail("Expected infinite loop to be terminated by the Boa opcode budget")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertFalse(message.isEmpty)
    }
  }

  func testCompileRejectsOversizedScriptAboveMaxScriptBytes() async throws {
    let oversized = String(repeating: " ", count: 1_048_577) + "const x = 1;"
    do {
      _ = try await ThreeCompiler.compile(oversized)
      XCTFail("Expected script exceeding SECURITY_3D_MAX_SCRIPT_BYTES (1 MiB) to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertTrue(
        message.contains("SECURITY_3D_MAX_SCRIPT_BYTES") || message.contains("exceeds"),
        "Expected quota diagnostic, got: \(message)"
      )
    }
  }

  func testCompileRejectsSceneExceedingVertexQuota() async throws {
    // 1 sphere at 320x320 segments = 321 * 321 = 103,041 vertices (>100,000 total vertices)
    let overQuotaScript = """
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 320, 320),
        new THREE.MeshStandardMaterial()
      );
      scene.add(m);
      """
    do {
      _ = try await ThreeCompiler.compile(overQuotaScript)
      XCTFail("Expected scene exceeding SECURITY_3D_MAX_VERTICES (100,000) to be rejected")
    } catch let error as ThreeCompilerError {
      guard case .compilationFailed(let message) = error else {
        return XCTFail("Expected .compilationFailed, got \(error)")
      }
      XCTAssertTrue(
        message.contains("SECURITY_3D_MAX_VERTICES")
          || message.contains("maximum allowed vertices")
          || message.contains("maximum allowed indices")
          || message.contains("SecurityError"),
        "Expected vertex quota diagnostic, got: \(message)"
      )
    }
  }

  #if canImport(RealityKit) && !os(tvOS)
    func testXRLiveEntityTraitsCodableRoundTrip() throws {
      let json = """
        {
          "grabbable": true,
          "billboard": "capsule",
          "anchor": "plane",
          "follow": "lazy",
          "followDistance": 1.25,
          "physics": "dynamic",
          "restitution": 0.75,
          "mass": 2.0
        }
        """.data(using: .utf8)!
      let decoded = try JSONDecoder().decode(XRLiveEntityTraits.self, from: json)
      XCTAssertEqual(decoded.grabbable, true)
      XCTAssertEqual(decoded.billboard, "capsule")
      XCTAssertEqual(decoded.anchor, "plane")
      XCTAssertEqual(decoded.follow, "lazy")
      XCTAssertEqual(decoded.followDistance, 1.25)
      XCTAssertEqual(decoded.physics, "dynamic")
      XCTAssertEqual(decoded.restitution, 0.75)
      XCTAssertEqual(decoded.mass, 2.0)

      let reencoded = try JSONEncoder().encode(decoded)
      let roundTripped = try JSONDecoder().decode(XRLiveEntityTraits.self, from: reencoded)
      XCTAssertEqual(decoded, roundTripped)
    }

    @MainActor
    func testWorkbenchAndBallpitLoadInRealityKit() async throws {
      let workbenchScript = """
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.9, 1.0, 0.08, 36),
          new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.5 })
        );
        base.name = 'Workbench_Pedestal';
        base.position.set(0, -0.65, 0);
        scene.add(base);

        const artifact = new THREE.Mesh(
          new THREE.TorusKnotGeometry(0.28, 0.085, 96, 20),
          new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.75 })
        );
        artifact.name = 'Torus_Knot_Artifact';
        artifact.position.set(-0.45, 0.1, 0);
        artifact.userData.xr = {
          traits: ['grab', 'scale'],
          anchor: 'table'
        };
        artifact.userData.interactivity = {
          onSelect: { action: 'toggleTransform', scale: [1.3, 1.3, 1.3], duration: 0.35 }
        };
        scene.add(artifact);

        const gem = new THREE.Mesh(
          new THREE.CylinderGeometry(0, 0.24, 0.42, 6),
          new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.2, metalness: 0.4 })
        );
        gem.name = 'Billboard_Gem';
        gem.position.set(0.45, 0.15, 0);
        gem.userData.xr = {
          traits: ['grab', 'billboard'],
          anchor: 'table'
        };
        gem.userData.interactivity = {
          onSelect: { action: 'toggleTransform', scale: [1.3, 1.3, 1.3], duration: 0.3 }
        };
        scene.add(gem);

        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 24, 24),
          new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.2, metalness: 0.3 })
        );
        orb.name = 'Dynamic_Orbiter';
        orb.position.set(0, 0.55, 0);
        orb.userData.xr = {
          physics: 'dynamic',
          traits: ['grab', 'scale']
        };
        scene.add(orb);
        """
      let usdz = try await ThreeCompiler.compileUSDZ(workbenchScript)
      let glb = try await ThreeCompiler.compileGLB(workbenchScript)
      let entity = try await RealityKitHelper.loadEntity(fromUSDZ: usdz)
      let modelAnchor = AnchorEntity(world: [0, 0, 0])
      modelAnchor.addChild(entity)
      let live = try XCTUnwrap(XRLiveRealityKitSession(glbData: glb, root: entity))
      live.installInputTargets()
      live.headPoseProvider = { XRPose(position: SIMD3<Float>(0, 1.2, 3.5)) }
      live.start()
      for _ in 0..<10 {
        live.step(dt: 1.0 / 60.0)
      }

      // Verify that USD-imported AnchoringComponent was stripped from Root and all descendants
      // so RealityKit does not deactivate the hierarchy in .nonAR studio mode.
      func assertNoAnchoring(_ e: Entity) {
        XCTAssertFalse(
          e.components.has(AnchoringComponent.self),
          "Entity '\(e.name)' must not retain a nested USD AnchoringComponent"
        )
        XCTAssertTrue(e.isEnabled, "Entity '\(e.name)' must remain enabled")
        for c in e.children {
          assertNoAnchoring(c)
        }
      }
      for child in modelAnchor.children {
        assertNoAnchoring(child)
      }

      XCTAssertEqual(live.session.nodeCount, 4)
      let expectedNames = [
        "Workbench_Pedestal",
        "Torus_Knot_Artifact",
        "Billboard_Gem",
        "Dynamic_Orbiter",
      ]
      for (index, expectedName) in expectedNames.enumerated() {
        let bound = try XCTUnwrap(
          live.entity(forNode: index),
          "Expected entity bound to node \(index) (\(expectedName))"
        )
        XCTAssertEqual(bound.name, expectedName)
        let vb = bound.visualBounds(recursive: true, relativeTo: modelAnchor)
        XCTAssertGreaterThan(
          vb.extents.x, 0.05,
          "Mesh '\(expectedName)' must have non-empty visual bounds"
        )
        XCTAssertGreaterThan(
          vb.extents.y, 0.05,
          "Mesh '\(expectedName)' must have non-empty visual bounds"
        )
      }
    }
  #endif
}
