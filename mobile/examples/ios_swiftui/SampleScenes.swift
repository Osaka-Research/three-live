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

  public enum StudioMode: String, CaseIterable, Identifiable, Sendable {
    case threeLive = "Three-Live"
    case xrLive = "XR-Live"

    public var id: String { rawValue }
  }

  public struct ScenePreset: Identifiable, Sendable {
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
            onSelect: { action: "toggleTransform", scale: [1.2, 1.2, 1.2], duration: 0.35 }
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

          // 4. Sensor Arrays (Satellites) — counter-orbit QuantumCore
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
            onSelect: { action: "toggleTransform", scale: [1.2, 1.2, 1.2], duration: 0.35 }
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
            onSelect: { action: "toggleTransform", scale: [1.2, 1.2, 1.2], duration: 0.35 }
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
                speed: -0.4,
                height: Math.sin(angle) * 0.4,
                phase: angle,
                faceCenter: true
              }
            };
            sphere.userData.interactivity = {
              onSelect: { action: "toggleTransform", scale: [1.3, 1.3, 1.3], duration: 0.3 }
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
          moon.position.set(1.1, 0.25, 0);
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
      ScenePreset(
        name: "CAD CSG & 3D Text",
        description:
          "Procedural 2D Shape extrusion with CSG Boolean channels, extruded 3D vector text, and GPU instanced bolts",
        script: """
          const profile = new THREE.Shape();
          profile.absarc(0, 0, 1.15, 0, Math.PI * 2, false);
          const bore = new THREE.Path();
          bore.absarc(0, 0, 0.44, 0, Math.PI * 2, true);
          profile.holes.push(bore);

          const alloyMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.78, roughness: 0.24 });
          const rawBlank = new THREE.Mesh(
            new THREE.ExtrudeGeometry(profile, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.03 }),
            alloyMat
          );
          rawBlank.rotation.x = -Math.PI / 2;
          rawBlank.position.set(0, -0.17, 0);

          const slotX = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.24, 0.3), alloyMat);
          slotX.position.set(0, 0.1, 0);
          const machined = THREE.CSG.subtract(rawBlank, slotX);
          machined.name = "MachinedCADFlange";
          scene.add(machined);

          const textMesh = new THREE.Mesh(
            new THREE.TextGeometry("CAD R1", { size: 0.3, depth: 0.08, bevelEnabled: true }),
            new THREE.MeshStandardMaterial({ color: 0xf8fafc, emissive: 0x38bdf8, emissiveIntensity: 0.55 })
          );
          textMesh.name = "ExtrudedTextBadge";
          textMesh.position.set(-0.7, 0.38, 0);
          scene.add(textMesh);

          const bolts = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(0.075, 0.075, 0.44, 16),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.15 }),
            8
          );
          bolts.name = "InstancedBoltRing";
          const m4 = new THREE.Matrix4();
          const pos = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl = new THREE.Vector3(1, 1, 1);
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
            pos.set(Math.cos(a) * 0.8, 0.02, Math.sin(a) * 0.8);
            m4.compose(pos, quat, scl);
            bolts.setMatrixAt(i, m4);
          }
          scene.add(bolts);
          """,
        mode: .threeLive
      ),
      ScenePreset(
        name: "Instanced Field",
        description:
          "Hardware GPU InstancedMesh 5x5x5 crystal lattice with per-instance color tints and HDR bloom core",
        script: """
          const grid = 5;
          const total = grid * grid * grid;
          const instanced = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(0.0, 0.13, 0.34, 6),
            new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.85, roughness: 0.15 }),
            total
          );
          instanced.name = "InstancedCrystalLattice";
          const m4 = new THREE.Matrix4();
          const pos = new THREE.Vector3();
          const quat = new THREE.Quaternion();
          const scl = new THREE.Vector3(1, 1, 1);
          const col = new THREE.Color();
          let idx = 0;
          for (let x = 0; x < grid; x++) {
            for (let y = 0; y < grid; y++) {
              for (let z = 0; z < grid; z++) {
                scl.set(x >= 1 && x <= 3 && y >= 1 && y <= 3 && z >= 1 && z <= 3 ? 0.001 : 1, 1, 1);
                pos.set((x - 2) * 0.55, (y - 2) * 0.55, (z - 2) * 0.55);
                m4.compose(pos, quat, scl);
                instanced.setMatrixAt(idx, m4);
                col.setRGB(0.2 + (x / grid) * 0.75, 0.35 + (y / grid) * 0.6, 0.95 - (z / grid) * 0.5);
                instanced.setColorAt(idx, col);
                idx++;
              }
            }
          }
          scene.add(instanced);

          const core = new THREE.Mesh(
            new THREE.TorusKnotGeometry(0.38, 0.11, 96, 20),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.85, metalness: 0.9, roughness: 0.1 })
          );
          core.name = "LatticeEnergyCore";
          core.userData.xr = {
            bloom: { strength: 1.4, threshold: 0.65, radius: 0.5 },
            outline: { color: "#38bdf8", thickness: 0.025 }
          };
          scene.add(core);
          """,
        mode: .threeLive
      ),
    ]

    public static let xrLivePresets: [ScenePreset] = [
      ScenePreset(
        name: "Ballpit",
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
        name: "Workbench",
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
            anchor: 'table'
          };
          artifact.userData.interactivity = {
            onSelect: { action: 'toggleTransform', scale: [1.3, 1.3, 1.3], duration: 0.35 }
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
        name: "Gemini AI",
        description: "Near, Mid, and Far depth reference pillars with 6DoF grab & scale traits",
        script: """
          // Gemini Spatial Perception & Depth Occlusion Scene
          // Near, Mid, and Far Depth Reference Pillars for 8x8 Metric Depth Grid
          const depths = [
            { pos: [-0.55, -0.125, 0.55], color: 0x22c55e, h: 0.7 },
            { pos: [0.0, 0.0, 0.0], color: 0x38bdf8, h: 0.95 },
            { pos: [0.6, 0.125, -0.65], color: 0xa855f7, h: 1.2 }
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
              onSelect: { action: 'toggleTransform', scale: [1.25, 1.25, 1.25], duration: 0.3 }
            };
            scene.add(pillar);
          });
          """,
        mode: .xrLive
      ),
      ScenePreset(
        name: "Robotic Arm IK",
        description:
          "Articulated 2-bone inverse kinematics arm (userData.xr.ik) tracking a grabbable 6DoF target orb",
        script: """
          const armMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.22, metalness: 0.85 });
          const shoulder = new THREE.Group();
          shoulder.name = 'Shoulder';
          shoulder.position.set(-0.22, -0.1, 0);
          const upper = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.34), armMat);
          upper.position.set(0, 0, 0.17);
          shoulder.add(upper);

          const forearm = new THREE.Group();
          forearm.name = 'Forearm';
          forearm.position.set(0, 0, 0.34);
          const lower = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.3), armMat);
          lower.position.set(0, 0, 0.15);
          forearm.add(lower);
          shoulder.add(forearm);

          const wrist = new THREE.Mesh(
            new THREE.SphereGeometry(0.06, 20, 20),
            new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0x7e22ce, emissiveIntensity: 0.7 })
          );
          wrist.name = 'WristEffector';
          wrist.position.set(0, 0, 0.3);
          wrist.userData.xr = {
            ik: { root: 'Shoulder', mid: 'Forearm', effector: 'WristEffector', target: 'GripperTarget', pole: 'ElbowPole' }
          };
          forearm.add(wrist);
          scene.add(shoulder);

          const pole = new THREE.Group();
          pole.name = 'ElbowPole';
          pole.position.set(-0.22, 0.65, 0);
          scene.add(pole);

          const target = new THREE.Mesh(
            new THREE.SphereGeometry(0.075, 24, 24),
            new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.85 })
          );
          target.name = 'GripperTarget';
          target.position.set(0.24, 0.18, 0.18);
          target.userData.xr = {
            grab: '1-hand',
            orbit: { target: [0, 0.15, 0.1], radius: 0.25, speed: 1.0, height: 0.05 },
            outline: { color: '#22c55e', thickness: 0.025 }
          };
          scene.add(target);
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
