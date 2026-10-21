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
  import Foundation

  public enum StudioMode: String, CaseIterable, Identifiable {
    case threeLive = "Three-Live"
    case xrLive = "XR-Live"

    public var id: String { rawValue }
  }

  public struct ScenePreset: Identifiable {
    public let id = UUID()
    public let name: String
    public let description: String
    public let script: String
    public let mode: StudioMode

    public init(
      name: String,
      description: String,
      script: String,
      mode: StudioMode = .threeLive
    ) {
      self.name = name
      self.description = description
      self.script = script
      self.mode = mode
    }
  }

  public enum SampleScenes {
    public static let threeLivePresets: [ScenePreset] = [
      ScenePreset(
        name: "Quantum Core",
        description: "Multi-part sci-fi core with tilted orbit rings, satellites, and pedestal",
        script: """
          // 1. Central Core
          const core = new THREE.Mesh(
            new THREE.SphereGeometry(0.85, 32, 24),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.92, roughness: 0.08 })
          );
          core.name = "QuantumCore";
          core.userData.interactivity = {
            onSelect: { action: "toggleTransform", scale: [1.18, 1.18, 1.18], duration: 0.35 }
          };
          scene.add(core);

          // 2. Inner Orbit Ring
          const ring1 = new THREE.Mesh(
            new THREE.TorusGeometry(1.45, 0.09, 16, 64),
            new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.85, roughness: 0.2 })
          );
          ring1.name = "InnerOrbitRing";
          ring1.rotation.x = 1.1;
          scene.add(ring1);

          // 3. Outer Orbit Ring
          const ring2 = new THREE.Mesh(
            new THREE.TorusGeometry(1.95, 0.06, 16, 64),
            new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.7, roughness: 0.3 })
          );
          ring2.name = "OuterOrbitRing";
          ring2.rotation.y = 0.9;
          ring2.rotation.z = 0.4;
          scene.add(ring2);

          // 4. Sensor Arrays (Satellites) — continuously orbit QuantumCore
          const satGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
          const satMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.15 });
          const sat1 = new THREE.Mesh(satGeo, satMat);
          sat1.name = "SensorArray_A";
          sat1.position.set(1.45, 0.35, 0);
          sat1.userData.xr = {
            orbit: { target: "QuantumCore", radius: 1.45, speed: 1.2, height: 0.35, phase: 0, faceCenter: true }
          };
          scene.add(sat1);

          const sat2 = new THREE.Mesh(satGeo, satMat);
          sat2.name = "SensorArray_B";
          sat2.position.set(-1.45, -0.35, 0);
          sat2.userData.xr = {
            orbit: { target: "QuantumCore", radius: 1.45, speed: -1.0, height: -0.35, phase: 3.14159, faceCenter: true }
          };
          scene.add(sat2);

          // 5. Pedestal Base
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(1.8, 2.0, 0.25, 32),
            new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.6 })
          );
          base.name = "PedestalBase";
          base.position.set(0, -1.6, 0);
          scene.add(base);
          """,
        mode: .threeLive
      ),
      ScenePreset(
        name: "Torus Knot",
        description: "Ruby crimson metallic torus knot",
        script: """
          // Ruby Torus Knot
          const mesh = new THREE.Mesh(
            new THREE.TorusKnotGeometry(0.9, 0.28, 128, 24),
            new THREE.MeshStandardMaterial({ color: 0xf43f5e, metalness: 0.95, roughness: 0.12 })
          );
          mesh.name = "RubyTorusKnot";
          mesh.userData.interactivity = {
            onSelect: { action: "toggleTransform", scale: [1.2, 1.2, 1.2], duration: 0.4 }
          };
          scene.add(mesh);
          """,
        mode: .threeLive
      ),
      ScenePreset(
        name: "Emerald Crystal",
        description: "Six-sided hexagonal crystal gem with metallic luster",
        script: """
          // Emerald Crystal Gem
          const mesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0, 1.2, 2.2, 6),
            new THREE.MeshStandardMaterial({ color: 0x06b6d4, metalness: 0.8, roughness: 0.15 })
          );
          mesh.name = "EmeraldGem";
          mesh.userData.interactivity = {
            onSelect: { action: "toggleTransform", position: [0, 0.35, 0], duration: 0.4 }
          };
          scene.add(mesh);
          """,
        mode: .threeLive
      ),
      ScenePreset(
        name: "Orbital Spheres",
        description: "Five procedural metallic spheres arranged in a trigonometric ring",
        script: """
          // Five Orbital Spheres
          const colors = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0x8b5cf6];
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            const sphere = new THREE.Mesh(
              new THREE.SphereGeometry(0.45, 24, 16),
              new THREE.MeshStandardMaterial({ color: colors[i], metalness: 0.9, roughness: 0.2 })
            );
            sphere.name = "Sphere_" + (i + 1);
            sphere.position.set(Math.cos(angle) * 1.3, Math.sin(angle) * 0.4, Math.sin(angle) * 1.3);
            sphere.userData.xr = {
              orbit: {
                target: [0, 0, 0],
                radius: 1.3,
                speed: 0.85,
                height: Math.sin(angle) * 0.35,
                phase: angle,
                faceCenter: true
              }
            };
            sphere.userData.interactivity = {
              onSelect: { action: "toggleTransform", scale: [1.35, 1.35, 1.35], duration: 0.3 }
            };
            scene.add(sphere);
          }
          """,
        mode: .threeLive
      ),
      ScenePreset(
        name: "Interactivity + Handles",
        description:
          "Tap the pedestal to cycle color; drag the cube's corner / yaw handles to resize and rotate; moon orbits",
        script: """
          const cube = new THREE.Mesh(
            new THREE.BoxGeometry(0.7, 0.7, 0.7),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.5, roughness: 0.3 })
          );
          cube.name = "WorkCube";
          cube.position.set(0, 0.1, 0);
          cube.userData.xr = {
            handles: { rotateAxis: "y", minScale: 0.4, maxScale: 2.5 }
          };
          cube.userData.interactivity = {
            onSelect: { action: "toggleTransform", position: [0, 0.55, 0], duration: 0.35 }
          };
          scene.add(cube);

          const moon = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 24, 16),
            new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.8, roughness: 0.2 })
          );
          moon.name = "Moon";
          moon.userData.xr = {
            orbit: { target: "WorkCube", radius: 1.1, speed: 1.2, height: 0.15, faceCenter: true }
          };
          scene.add(moon);

          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(1.1, 1.2, 0.18, 32),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, metalness: 0.3, roughness: 0.6 })
          );
          base.name = "Pedestal";
          base.position.set(0, -0.7, 0);
          base.userData.interactivity = {
            onSelect: {
              action: "cycleMaterialColor",
              colors: [[0.13, 0.77, 0.37, 1], [0.96, 0.62, 0.04, 1], [0.94, 0.27, 0.27, 1]]
            }
          };
          scene.add(base);
          """,
        mode: .threeLive
      ),
    ]

    public static let xrLivePresets: [ScenePreset] = [
      ScenePreset(
        name: "Ballpit Lab",
        description: "Room floor, tabletop anchor, and 14 dynamic grabbable ballpit spheres",
        script: """
          // Ballpit Lab: Room & Heightfield Physics
          // Pedestal & Room Reference Floor Grid
          const floor = new THREE.Mesh(
            new THREE.BoxGeometry(3.4, 0.08, 3.4),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.2 })
          );
          floor.name = 'Room_Floor';
          floor.position.set(0, -0.85, 0);
          scene.add(floor);

          // Tabletop Surface Anchor Target
          const table = new THREE.Mesh(
            new THREE.CylinderGeometry(0.65, 0.55, 0.08, 32),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.6 })
          );
          table.name = 'Pedestal_Table';
          table.position.set(0, -0.25, 0);
          scene.add(table);

          // Colorful Dynamic Ballpit Spheres (userData.xr.physics = 'dynamic')
          const palette = [0x38bdf8, 0xa855f7, 0x22c55e, 0xf59e0b, 0xec4899, 0x6366f1];
          for (let i = 0; i < 14; i++) {
            const radius = 0.11 + (i % 3) * 0.03;
            const ball = new THREE.Mesh(
              new THREE.SphereGeometry(radius, 24, 24),
              new THREE.MeshStandardMaterial({
                color: palette[i % palette.length],
                roughness: 0.18,
                metalness: 0.25
              })
            );
            ball.name = 'Ball_' + (i + 1);
            const angle = (i / 14) * Math.PI * 2;
            const ring = 0.25 + (i % 4) * 0.18;
            ball.position.set(
              Math.cos(angle) * ring,
              0.35 + i * 0.14,
              Math.sin(angle) * ring
            );
            ball.userData.xr = {
              physics: 'dynamic',
              traits: ['grab', 'scale']
            };
            scene.add(ball);
          }
          """,
        mode: .xrLive
      ),
      ScenePreset(
        name: "Spatial Workbench",
        description:
          "6DoF grab, pinch-scale torus knot, capsule billboard gem, and dynamic orbiter",
        script: """
          // Spatial Workbench: 6DoF Grab, Scale & Capsule Billboard
          // Workbench Pedestal
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.9, 1.0, 0.08, 36),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.5 })
          );
          base.name = 'Workbench_Pedestal';
          base.position.set(0, -0.65, 0);
          scene.add(base);

          // 1. Grabbable & Scalable Hero Torus Knot Artifact
          const artifact = new THREE.Mesh(
            new THREE.TorusKnotGeometry(0.28, 0.085, 96, 20),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.75 })
          );
          artifact.name = 'Torus_Knot_Artifact';
          artifact.position.set(-0.45, 0.1, 0);
          artifact.userData.xr = {
            traits: ['grab', 'scale'],
            anchor: 'table',
            handles: { rotateAxis: 'y', minScale: 0.5, maxScale: 2.2 }
          };
          artifact.userData.interactivity = {
            onSelect: { action: 'toggleTransform', position: [-0.45, 0.38, 0], duration: 0.35 }
          };
          scene.add(artifact);

          // 2. Capsule Billboard Indicator Gem (TurnToFace Y-axis locked)
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

          // 3. Floating Dynamic Moon Orbiter (bounces on workbench pedestal)
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
          """,
        mode: .xrLive
      ),
      ScenePreset(
        name: "Gemini AI & Depth",
        description: "Near, Mid, and Far depth reference pillars with 6DoF grab & scale traits",
        script: """
          // Gemini Spatial Perception & Depth Occlusion Scene
          // Near, Mid, and Far Depth Reference Pillars for 8x8 Metric Depth Grid
          const depths = [
            { pos: [-0.55, -0.1, 0.55], color: 0x22c55e, h: 0.7 },
            { pos: [0.0, 0.0, 0.0], color: 0x38bdf8, h: 0.95 },
            { pos: [0.6, 0.1, -0.65], color: 0xa855f7, h: 1.2 }
          ];

          depths.forEach((d, idx) => {
            const pillar = new THREE.Mesh(
              new THREE.BoxGeometry(0.28, d.h, 0.28),
              new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.25, metalness: 0.4 })
            );
            pillar.name = 'Depth_Pillar_' + (idx + 1);
            pillar.position.set(d.pos[0], d.pos[1], d.pos[2]);
            pillar.userData.xr = { traits: ['grab', 'scale'] };
            pillar.userData.interactivity = {
              onSelect: { action: 'toggleTransform', position: [d.pos[0], d.pos[1] + 0.25, d.pos[2]], duration: 0.35 }
            };
            scene.add(pillar);
          });

          // Scanning Probe Orbiter
          const probe = new THREE.Mesh(
            new THREE.SphereGeometry(0.11, 20, 20),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.15, metalness: 0.85 })
          );
          probe.name = 'Depth_Scan_Probe';
          probe.position.set(0, 0.55, 0);
          probe.userData.xr = {
            orbit: { target: [0, 0.45, 0], radius: 0.75, speed: 1.4, height: 0.1, faceCenter: true }
          };
          scene.add(probe);
          """,
        mode: .xrLive
      ),
    ]

    public static let presets: [ScenePreset] = threeLivePresets

    public static func presets(for mode: StudioMode) -> [ScenePreset] {
      switch mode {
      case .threeLive:
        return threeLivePresets
      case .xrLive:
        return xrLivePresets
      }
    }
  }
#endif
