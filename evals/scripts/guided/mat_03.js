// mat_03: Automotive Clearcoat & Sheen Material Calibration Spheres
const root = new THREE.Group();
root.name = "MaterialCalibrationRackRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "CalibrationAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyDirLight.name = "CalibrationKeyDirectionalLight";
keyDirLight.position.set(2.0, 3.0, 2.5);
scene.add(keyDirLight);

const rimDirLight = new THREE.DirectionalLight(0x99ccff, 0.9);
rimDirLight.name = "CalibrationRimDirectionalLight";
rimDirLight.position.set(-2.0, 1.8, -1.5);
scene.add(rimDirLight);

// 3x3 Display Rack Frame (y = 0 to y = 1.05m, width = 1.1m)
const rackGroup = new THREE.Group();
rackGroup.name = "CalibrationRackFrame";
root.add(rackGroup);

const frameMat = new THREE.MeshStandardMaterial({
  color: 0x22252a,
  metalness: 0.75,
  roughness: 0.35
});

const chromeRodMat = new THREE.MeshStandardMaterial({
  color: 0xd8dee9,
  metalness: 0.92,
  roughness: 0.15
});

// Base platform resting at y = 0
const baseSlab = new THREE.Mesh(
  new THREE.CylinderGeometry(0.68, 0.72, 0.04, 32),
  frameMat
);
baseSlab.name = "RackBasePlatform";
baseSlab.position.set(0, 0.02, 0);
rackGroup.add(baseSlab);

// Vertical side columns
const leftCol = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 1.02, 16),
  chromeRodMat
);
leftCol.name = "RackLeftColumn";
leftCol.position.set(-0.48, 0.53, 0);
rackGroup.add(leftCol);

const rightCol = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 1.02, 16),
  chromeRodMat
);
rightCol.name = "RackRightColumn";
rightCol.position.set(0.48, 0.53, 0);
rackGroup.add(rightCol);

// 3 Horizontal shelf bars + top header bar
const shelfHeights = [0.08, 0.38, 0.68, 1.02];
for (let r = 0; r < shelfHeights.length; r++) {
  const bar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 1.0, 16),
    r === 3 ? frameMat : chromeRodMat
  );
  bar.name = "RackHorizontalBar_" + r;
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, shelfHeights[r], 0);
  rackGroup.add(bar);
}

// 9 Material definitions for the 3x3 shader balls
const materialSpecs = [
  {
    name: "MetallicCarPaintClearcoat",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0xc8102e,
      metalness: 0.75,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.2 })
  },
  {
    name: "VelvetSheen",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0x3b0a45,
      metalness: 0.0,
      roughness: 0.85,
      sheen: 1.0,
      sheenColor: 0xe088ff,
      sheenRoughness: 0.25
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 })
  },
  {
    name: "FrostedGlassTransmission",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0xe6f7ff,
      metalness: 0.0,
      roughness: 0.22,
      transmission: 0.92,
      ior: 1.5,
      thickness: 0.14,
      attenuationColor: 0x80d4ff,
      attenuationDistance: 0.25
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0xff5533, roughness: 0.3, metalness: 0.1 })
  },
  {
    name: "BrushedGold",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0xffc436,
      metalness: 1.0,
      roughness: 0.28,
      clearcoat: 0.2,
      clearcoatRoughness: 0.3
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0x181820, roughness: 0.5, metalness: 0.1 })
  },
  {
    name: "MirrorChrome",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0xf4f7fa,
      metalness: 1.0,
      roughness: 0.02,
      clearcoat: 1.0,
      clearcoatRoughness: 0.01
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0x224488, roughness: 0.3, metalness: 0.5 })
  },
  {
    name: "GlazedCeramic",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0xf7f5f0,
      metalness: 0.0,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      ior: 1.55
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0x8c6d53, roughness: 0.85, metalness: 0.0 })
  },
  {
    name: "MatteVulcanizedRubber",
    mat: new THREE.MeshStandardMaterial({
      color: 0x232629,
      metalness: 0.02,
      roughness: 0.92
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.2, metalness: 0.8 })
  },
  {
    name: "PolishedCopper",
    mat: new THREE.MeshPhysicalMaterial({
      color: 0xd9734e,
      metalness: 0.98,
      roughness: 0.14,
      clearcoat: 0.35,
      clearcoatRoughness: 0.15
    }),
    coreMat: new THREE.MeshStandardMaterial({ color: 0x2d5a4c, roughness: 0.7, metalness: 0.1 })
  },
  {
    name: "EmissivePlasma",
    mat: new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      emissive: 0x00d8ff,
      emissiveIntensity: 1.6,
      roughness: 0.15,
      metalness: 0.1
    }),
    coreMat: new THREE.MeshStandardMaterial({
      color: 0xff00aa,
      emissive: 0xff0088,
      emissiveIntensity: 1.2,
      roughness: 0.2
    })
  }
];

// Build template CSG slotted outer shell geometry (keep segments <= 20 for fast & clean CSG)
const outerSphereA = new THREE.Mesh(
  new THREE.SphereGeometry(0.088, 20, 16),
  frameMat
);
outerSphereA.name = "CSGOuterSphere";

const hollowCavity = new THREE.Mesh(
  new THREE.SphereGeometry(0.068, 18, 14),
  frameMat
);
hollowCavity.name = "CSGHollowCavity";

const hollowShell = THREE.CSG.subtract(outerSphereA, hollowCavity);
hollowShell.name = "CSGHollowShell";

// Cut front inspection window & equatorial slot using CSG
const frontCutCylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.056, 0.056, 0.16, 16),
  frameMat
);
frontCutCylinder.name = "CSGFrontCutout";
frontCutCylinder.rotation.x = Math.PI / 2;
frontCutCylinder.position.set(0, 0.01, 0.06);

const slottedShellTemplate = THREE.CSG.subtract(hollowShell, frontCutCylinder);
const sharedSlottedGeo = slottedShellTemplate.geometry;

// Place the 9 shader balls in a 3x3 grid
const colOffsets = [-0.28, 0.0, 0.28];
const rowHeights = [0.68, 0.38, 0.08];

for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    const idx = row * 3 + col;
    const spec = materialSpecs[idx];
    const x = colOffsets[col];
    const shelfY = rowHeights[row];

    const ballGroup = new THREE.Group();
    ballGroup.name = "ShaderBallGroup_" + spec.name;
    ballGroup.position.set(x, shelfY, 0);
    root.add(ballGroup);

    // Pedestal collar on shelf bar
    const puck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.065, 0.032, 20),
      frameMat
    );
    puck.name = "ShaderBallPedestal_" + spec.name;
    puck.position.set(0, 0.016, 0);
    ballGroup.add(puck);

    // Inner core sphere
    const innerCore = new THREE.Mesh(
      new THREE.SphereGeometry(0.056, 24, 18),
      spec.coreMat
    );
    innerCore.name = "ShaderBallCore_" + spec.name;
    innerCore.position.set(0, 0.115, 0);
    ballGroup.add(innerCore);

    // Slotted outer shell
    const outerShell = new THREE.Mesh(sharedSlottedGeo, spec.mat);
    outerShell.name = "ShaderBallOuterShell_" + spec.name;
    outerShell.position.set(0, 0.115, 0);
    outerShell.rotation.y = -0.25;
    ballGroup.add(outerShell);

    // Top calibration crown ring
    const crownRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.036, 0.016, 16),
      spec.mat
    );
    crownRing.name = "ShaderBallCrown_" + spec.name;
    crownRing.position.set(0, 0.205, 0);
    ballGroup.add(crownRing);
  }
}

// Camera framing (~2.2x bounding radius ~0.75m -> distance ~1.7m)
camera.position.set(0.0, 0.56, 1.65);
camera.lookAt(0.0, 0.52, 0.0);
