// mat_20: Geode Crystal Cavern Cutaway
const root = new THREE.Group();
root.name = "AmethystGeodeCutawayRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "GeodeAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyDirLight.name = "GeodeKeyDirectionalLight";
keyDirLight.position.set(1.2, 2.0, 1.8);
scene.add(keyDirLight);

const cavitySparkleLight = new THREE.PointLight(0xe5b8ff, 2.6, 2.0);
cavitySparkleLight.name = "AmethystCavityPointLight";
cavitySparkleLight.position.set(0.0, 0.40, 0.16);
scene.add(cavitySparkleLight);

const rimVioletLight = new THREE.PointLight(0x8833ff, 1.8, 2.2);
rimVioletLight.name = "AmethystDepthLight";
rimVioletLight.position.set(-0.2, 0.52, 0.25);
scene.add(rimVioletLight);

// Materials
const volcanicBasaltMat = new THREE.MeshStandardMaterial({
  color: 0x23252a,
  roughness: 0.92,
  metalness: 0.06,
  flatShading: true
});

const agateBandMat = new THREE.MeshPhysicalMaterial({
  color: 0xd8d0e5,
  roughness: 0.16,
  metalness: 0.02,
  clearcoat: 0.85,
  clearcoatRoughness: 0.08
});

const deepDruzyBedMat = new THREE.MeshPhysicalMaterial({
  color: 0x360c5a,
  roughness: 0.25,
  metalness: 0.1,
  clearcoat: 0.9
});

const amethystDarkMat = new THREE.MeshPhysicalMaterial({
  color: 0x8a2be2,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.94,
  ior: 1.544,
  thickness: 0.065,
  attenuationColor: 0x4b0082,
  attenuationDistance: 0.07,
  dispersion: 0.045,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

const amethystLavenderMat = new THREE.MeshPhysicalMaterial({
  color: 0xc278ff,
  roughness: 0.02,
  metalness: 0.0,
  transmission: 0.96,
  ior: 1.544,
  thickness: 0.055,
  attenuationColor: 0x6a1b9a,
  attenuationDistance: 0.08,
  dispersion: 0.05,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01
});

const standIronMat = new THREE.MeshStandardMaterial({
  color: 0x16181c,
  metalness: 0.85,
  roughness: 0.35
});

// 1. Iron Display Cradle Plinth resting at y = 0 (supporting the 0.70m tall geode boulder)
const standGroup = new THREE.Group();
standGroup.name = "GeodeDisplayCradleGroup";
root.add(standGroup);

const standBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.24, 0.27, 0.035, 24),
  standIronMat
);
standBase.name = "GeodeStandBaseRing";
standBase.position.set(0, 0.0175, 0);
standGroup.add(standBase);

// 2. Split Volcanic Basalt Boulder via CSG (~0.70m tall from y = 0.03 to y = 0.73)
// Keep CSG input segments <= 20 to stay well under the 4096 triangle limit
const outerBoulderA = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 18, 14),
  volcanicBasaltMat
);
outerBoulderA.name = "CSGBasaltOuterSphere";
outerBoulderA.scale.set(0.95, 1.12, 0.88);
outerBoulderA.position.set(0, 0.38, 0);

const frontSliceCut = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.45, 0.90, 12),
  volcanicBasaltMat
);
frontSliceCut.name = "CSGFrontSliceCutter";
frontSliceCut.position.set(0, 0.38, 0.44);

const slicedBoulder = THREE.CSG.subtract(outerBoulderA, frontSliceCut);
slicedBoulder.name = "CSGSlicedBoulder";

const innerHollowVoid = new THREE.Mesh(
  new THREE.SphereGeometry(0.25, 16, 12),
  volcanicBasaltMat
);
innerHollowVoid.name = "CSGInnerGeodeVoid";
innerHollowVoid.scale.set(0.92, 1.10, 0.85);
innerHollowVoid.position.set(0, 0.38, 0.02);

const basaltShellMesh = THREE.CSG.subtract(slicedBoulder, innerHollowVoid);
basaltShellMesh.name = "VolcanicBasaltGeodeShell";
basaltShellMesh.material = volcanicBasaltMat;
root.add(basaltShellMesh);

// Polished Chalcedony / White Agate Banded Rim framing the cutaway opening
const agateRimGroup = new THREE.Group();
agateRimGroup.name = "PolishedAgateRimGroup";
agateRimGroup.position.set(0, 0.38, 0.01);
root.add(agateRimGroup);

const numRimSegments = 24;
for (let i = 0; i < numRimSegments; i++) {
  const theta = (i / numRimSegments) * Math.PI * 2;
  const rx = Math.cos(theta) * 0.242;
  const ry = Math.sin(theta) * 0.295;
  const seg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, 0.078, 8),
    agateBandMat
  );
  seg.name = "AgateRimBandSegment_" + i;
  seg.position.set(rx, ry, 0);
  seg.rotation.z = theta;
  agateRimGroup.add(seg);
}

// Deep purple druzy lining inside the concave cavity
const druzyLiner = new THREE.Mesh(
  new THREE.SphereGeometry(0.248, 20, 16, 0, Math.PI, 0, Math.PI),
  deepDruzyBedMat
);
druzyLiner.name = "DeepDruzyCavityLiner";
druzyLiner.scale.set(0.92, 1.10, -0.82);
druzyLiner.position.set(0, 0.38, 0.02);
druzyLiner.material.side = THREE.DoubleSide;
root.add(druzyLiner);

// 3. Sparkling Amethyst Cavity of 56 Pointed Purple Hexagonal Quartz Crystal Prisms Radiating Inward
const crystalCavityGroup = new THREE.Group();
crystalCavityGroup.name = "AmethystCrystalCavityGroup";
root.add(crystalCavityGroup);

const cavityCenter = new THREE.Vector3(0, 0.38, 0.08);
const upVec = new THREE.Vector3(0, 1, 0);

// Generate concentric rings of inward-pointing hexagonal quartz crystals (6-sided Cylinder + 6-sided Cone tip)
const rings = [
  { count: 18, rx: 0.21, ry: 0.26, zDepth: -0.02, len: 0.072, rad: 0.021 },
  { count: 16, rx: 0.16, ry: 0.20, zDepth: -0.09, len: 0.078, rad: 0.023 },
  { count: 12, rx: 0.11, ry: 0.14, zDepth: -0.15, len: 0.082, rad: 0.024 },
  { count: 8,  rx: 0.05, ry: 0.06, zDepth: -0.19, len: 0.085, rad: 0.025 }
];

let crystalIndex = 0;
for (let r = 0; r < rings.length; r++) {
  const rg = rings[r];
  for (let k = 0; k < rg.count; k++) {
    const angle = (k / rg.count) * Math.PI * 2 + r * 0.35;
    const bx = Math.cos(angle) * rg.rx;
    const by = 0.38 + Math.sin(angle) * rg.ry;
    const bz = rg.zDepth + Math.cos(angle * 3.0) * 0.015;

    const basePos = new THREE.Vector3(bx, by, bz);
    // Point inward toward cavity focal center with natural organic variation
    const targetFocal = new THREE.Vector3(
      cavityCenter.x + Math.sin(crystalIndex * 1.7) * 0.04,
      cavityCenter.y + Math.cos(crystalIndex * 1.3) * 0.04,
      cavityCenter.z + 0.12
    );
    const dir = targetFocal.sub(basePos).normalize();

    const crystalHolder = new THREE.Group();
    crystalHolder.name = "AmethystQuartzCrystal_" + crystalIndex;
    crystalHolder.position.copy(basePos);
    crystalHolder.quaternion.setFromUnitVectors(upVec, dir);
    crystalCavityGroup.add(crystalHolder);

    const mat = crystalIndex % 2 === 0 ? amethystDarkMat : amethystLavenderMat;
    const shaftLen = rg.len * (0.65 + (crystalIndex % 3) * 0.12);
    const tipLen = rg.len * 0.45;
    const radius = rg.rad * (0.85 + (crystalIndex % 4) * 0.08);

    // 6-sided Hexagonal Quartz Prism Shaft
    const prismShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius * 1.08, shaftLen, 6),
      mat
    );
    prismShaft.name = "HexagonalQuartzShaft_" + crystalIndex;
    prismShaft.position.set(0, shaftLen * 0.5, 0);
    crystalHolder.add(prismShaft);

    // 6-sided Rhombohedral Termination Pyramid Tip
    const pyramidTip = new THREE.Mesh(
      new THREE.ConeGeometry(radius, tipLen, 6),
      mat
    );
    pyramidTip.name = "HexagonalQuartzTerminationTip_" + crystalIndex;
    pyramidTip.position.set(0, shaftLen + tipLen * 0.5, 0);
    crystalHolder.add(pyramidTip);

    crystalIndex++;
  }
}

// Camera framing (~0.73m tall -> distance ~1.12m)
camera.position.set(0.16, 0.42, 1.08);
camera.lookAt(0, 0.38, 0);
