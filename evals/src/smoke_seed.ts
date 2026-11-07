/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import {SCRIPTS_DIR} from './compiler_runner.ts';

/**
 * Seeds 10 representative scripts in `evals/scripts/smoke/` so anyone can run
 * `node evals/run_evals.ts --arm=smoke` immediately with zero API keys to test
 * compilation, drop detection, degraded alias detection, and warning usefulness.
 */
export function ensureSmokeScriptsExist(scriptsDir = SCRIPTS_DIR): void {
  const smokeDir = path.join(scriptsDir, 'smoke');
  fs.mkdirSync(smokeDir, {recursive: true});

  const smokeSamples: Array<{id: string; code: string}> = [
    {
      id: 'cad_01',
      code: `// Helical Planetary Gear Assembly (Clean CAD + CSG)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const steelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8, roughness: 0.3 });

const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.08, 24), steelMat);
base.name = 'carrier_plate';
base.position.y = 0.04;
scene.add(base);

const sunBlank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 20), brassMat);
const sunBore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16), brassMat);
const sunGear = THREE.CSG.subtract(sunBlank, sunBore);
sunGear.name = 'sun_gear';
sunGear.position.y = 0.2;
scene.add(sunGear);

for (let i = 0; i < 3; i++) {
  const angle = (i * Math.PI * 2) / 3;
  const planet = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.22, 20), steelMat);
  planet.name = 'planet_gear_' + i;
  planet.position.set(Math.cos(angle) * 0.6, 0.2, Math.sin(angle) * 0.6);
  scene.add(planet);
}

camera.position.set(0, 1.8, 2.8);
camera.lookAt(0, 0.2, 0);
`,
    },
    {
      id: 'cad_02',
      code: `// Vanilla Three.js Lexical Scene Shadowing Trap (const scene = new THREE.Scene())
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 })
);
mesh.name = 'cnc_pillow_block';
mesh.position.y = 0.2;
scene.add(mesh);
camera.position.set(0, 0.8, 1.8);
camera.lookAt(0, 0.2, 0);
`,
    },
    {
      id: 'org_01',
      code: `// Twisted Biomorphic Vase using LatheGeometry + DoubleSide
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);

const points = [];
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  points.push(new THREE.Vector2(0.15 + 0.12 * Math.sin(t * Math.PI), t * 0.6));
}
const latheGeo = new THREE.LatheGeometry(points, 32);
const ceramicMat = new THREE.MeshPhysicalMaterial({
  color: 0xf1f5f9,
  roughness: 0.15,
  clearcoat: 1.0,
  side: THREE.DoubleSide,
});
const vase = new THREE.Mesh(latheGeo, ceramicMat);
vase.name = 'ceramic_vase';
vase.position.y = 0.3;
scene.add(vase);

camera.position.set(0, 0.8, 2.2);
camera.lookAt(0, 0.3, 0);
`,
    },
    {
      id: 'org_04',
      code: `// Bonsai Tree using CatmullRomCurve3 + TubeGeometry + IcosahedronGeometry
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xfffbeb, 1.3);
sun.position.set(2, 5, 3);
scene.add(sun);

const pot = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.14, 0.36),
  new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.7 })
);
pot.name = 'ceramic_pot';
pot.position.y = 0.07;
scene.add(pot);

const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.14, 0),
  new THREE.Vector3(0.08, 0.32, 0.04),
  new THREE.Vector3(-0.06, 0.5, -0.02),
  new THREE.Vector3(0.05, 0.68, 0.03),
]);
const trunkGeo = new THREE.TubeGeometry(curve, 20, 0.04, 8, false);
const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.85 }));
trunk.name = 'bonsai_trunk';
trunk.position.y = 0.35;
scene.add(trunk);

const canopy = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.24, 1),
  new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 })
);
canopy.name = 'foliage_pad';
canopy.scale.set(1.3, 0.45, 1.1);
canopy.position.set(0.05, 0.72, 0.03);
scene.add(canopy);

camera.position.set(0, 0.7, 1.8);
camera.lookAt(0, 0.4, 0);
`,
    },
    {
      id: 'mat_01',
      code: `// PBR Material Calibration Matrix (5x5 Spheres with Transmission, Iridescence, Clearcoat)
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.PointLight(0x38bdf8, 1.2, 10);
rim.position.set(-3, 2, -2);
scene.add(rim);

const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(2.6, 0.08, 2.6),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.2 })
);
pedestal.name = 'pedestal_base';
pedestal.position.y = 0.04;
scene.add(pedestal);

const sphereGeo = new THREE.SphereGeometry(0.16, 24, 16);
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: r === 4 ? 0xe0f2fe : 0x6366f1,
      metalness: r / 4,
      roughness: 0.05 + (c / 4) * 0.9,
      clearcoat: r === 2 ? 1.0 : 0.0,
      iridescence: r === 3 ? 1.0 : 0.0,
      transmission: r === 4 ? 0.92 : 0.0,
      ior: 1.5,
      thickness: 0.3,
    });
    const s = new THREE.Mesh(sphereGeo, mat);
    s.name = 'pbr_sphere_' + r + '_' + c;
    s.position.set((c - 2) * 0.48, 0.24, (r - 2) * 0.48);
    scene.add(s);
  }
}

camera.position.set(0, 2.4, 3.4);
camera.lookAt(0, 0.2, 0);
`,
    },
    {
      id: 'mat_11',
      code: `// Degraded Alias Showcase: CapsuleGeometry, RingGeometry, SpotLight, HemisphereLight
scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.7));
const spot = new THREE.SpotLight(0xfff7ed, 2.0, 12, Math.PI / 5, 0.3);
spot.position.set(2, 4, 2);
scene.add(spot);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.8, 32),
  new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2 })
);
ring.name = 'golden_halo_ring';
ring.position.set(0, 0.6, 0);
scene.add(ring);

const capsule = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.2, 0.5, 8, 16),
  new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transmission: 0.8, roughness: 0.1 })
);
capsule.name = 'core_capsule';
capsule.position.set(0, 0.6, 0);
scene.add(capsule);

camera.position.set(0, 1.2, 2.6);
camera.lookAt(0, 0.6, 0);
`,
    },
    {
      id: 'anim_01',
      code: `// Stadium Amphitheater Seating Bowl (InstancedMesh with per-instance Matrix4 & Color)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(4, 8, 5);
scene.add(sun);

const stage = new THREE.Mesh(
  new THREE.CylinderGeometry(0.8, 0.85, 0.12, 24),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
);
stage.name = 'center_stage';
stage.position.y = 0.06;
scene.add(stage);

const seatGeo = new THREE.BoxGeometry(0.12, 0.14, 0.12);
const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 });
const seats = new THREE.InstancedMesh(seatGeo, seatMat, 120);
seats.name = 'stadium_seats';

const dummy = new THREE.Object3D();
const color = new THREE.Color();
let idx = 0;
for (let row = 0; row < 5; row++) {
  const radius = 1.2 + row * 0.28;
  const y = 0.15 + row * 0.16;
  for (let s = 0; s < 24; s++) {
    const theta = -Math.PI * 0.4 + (s / 23) * Math.PI * 0.8;
    dummy.position.set(Math.sin(theta) * radius, y, -Math.cos(theta) * radius);
    dummy.lookAt(0, 0.1, 0);
    dummy.updateMatrix();
    seats.setMatrixAt(idx, dummy.matrix);
    color.setRGB(0.2 + row * 0.15, 0.5, 0.9 - row * 0.12);
    seats.setColorAt(idx, color);
    idx++;
  }
}
scene.add(seats);

camera.position.set(0, 2.6, 3.8);
camera.lookAt(0, 0.4, -0.8);
`,
    },
    {
      id: 'anim_09',
      code: `// 6-DOF Articulated Robot Arm with Declarative Two-Bone IK (userData.xr.ik)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(2, 4, 3);
scene.add(dir);

const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.6, roughness: 0.3 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.25 });

const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 20), darkMat);
pedestal.name = 'base_pedestal';
pedestal.position.y = 0.08;
scene.add(pedestal);

const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), orangeMat);
shoulder.name = 'shoulder_joint';
shoulder.position.set(0, 0.35, 0);
scene.add(shoulder);

const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), orangeMat);
elbow.name = 'elbow_joint';
elbow.position.set(0, 0.72, 0.1);
scene.add(elbow);

const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), darkMat);
wrist.name = 'wrist_effector';
wrist.position.set(0.15, 0.95, 0.25);
scene.add(wrist);

const targetOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.6 })
);
targetOrb.name = 'ik_target_orb';
targetOrb.position.set(0.35, 0.65, 0.3);
targetOrb.userData.xr = { grab: true };
scene.add(targetOrb);

shoulder.userData.xr = {
  ik: {
    solver: 'two-bone',
    root: 'shoulder_joint',
    mid: 'elbow_joint',
    effector: 'wrist_effector',
    target: 'ik_target_orb',
    pole: [0, 1.2, -0.4],
    weight: 1.0,
  },
};

camera.position.set(1.4, 1.1, 1.8);
camera.lookAt(0.1, 0.5, 0.1);
`,
    },
    {
      id: 'xr_01',
      code: `// Interactive XR Workbench with Grabbable Tools, Physics Colliders & KHR_interactivity
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(2, 4, 3);
scene.add(key);

const legs = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 0.72, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
);
legs.name = 'workbench_base';
legs.position.set(0, 0.36, 0);
scene.add(legs);

const table = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 0.08, 0.8),
  new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 })
);
table.name = 'xr_workbench_table';
table.position.set(0, 0.76, 0);
table.userData.xr = {
  anchor: 'Table',
  physics: { body: 'static', collider: 'box' },
};
scene.add(table);

const artifact = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.1, 0.03, 48, 12),
  new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, metalness: 0.2, roughness: 0.1, transmission: 0.7 })
);
artifact.name = 'holo_artifact';
artifact.position.set(0, 0.96, 0);
artifact.userData.xr = {
  grab: true,
  physics: { body: 'dynamic', collider: 'hull', mass: 0.5, restitution: 0.4 },
};
artifact.userData.interactivity = {
  onSelect: { action: 'toggleRotate', target: 'holo_artifact', axis: [0, 1, 0], angle: 3.14159, duration: 0.8 },
};
scene.add(artifact);

camera.position.set(0, 1.4, 2.2);
camera.lookAt(0, 0.65, 0);
`,
    },
    {
      id: 'xr_20',
      code: `// Vanilla Three.js Particle Starfield & OrbitControls
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.PointLight(0xfbbf24, 2.5, 20);
sun.position.set(0, 0.6, 0);
scene.add(sun);

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 24, 16),
  new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 })
);
planet.name = 'exoplanet';
planet.position.set(0, 0.35, 0);
scene.add(planet);

const starGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(300);
for (let i = 0; i < 300; i++) {
  starPositions[i] = (Math.random() - 0.5) * 6;
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05 });
const stars = new THREE.Points(starGeo, starMat);
stars.name = 'starfield_points';
scene.add(stars);

const controls = new THREE.OrbitControls(camera);
controls.update();

camera.position.set(0, 0.8, 1.8);
camera.lookAt(0, 0.35, 0);
`,
    },
  ];

  for (const sample of smokeSamples) {
    const outPath = path.join(smokeDir, `${sample.id}.js`);
    if (!fs.existsSync(outPath)) {
      fs.writeFileSync(outPath, sample.code, 'utf8');
    }
  }
}
