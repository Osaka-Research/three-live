// mat_12: Erlenmeyer & Florence Flask Chemistry Titration Rack
const root = new THREE.Group();
root.name = "ChemistryTitrationRackRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "TitrationAmbientLight";
scene.add(ambientLight);

const labKeyLight = new THREE.DirectionalLight(0xffffff, 1.5);
labKeyLight.name = "LabKeyDirectionalLight";
labKeyLight.position.set(1.4, 2.6, 2.0);
scene.add(labKeyLight);

const backRimLight = new THREE.PointLight(0xeef6ff, 1.8, 3.0);
backRimLight.name = "GlasswareBacklightPoint";
backRimLight.position.set(0.0, 0.35, -0.45);
scene.add(backRimLight);

// Materials
const borosilicateGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.96,
  ior: 1.47,
  thickness: 0.018,
  attenuationColor: 0xf2faff,
  attenuationDistance: 0.6,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

const magentaSolutionMat = new THREE.MeshPhysicalMaterial({
  color: 0xff1188,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.93,
  ior: 1.35,
  thickness: 0.07,
  attenuationColor: 0xb00058,
  attenuationDistance: 0.065
});

const emeraldSolutionMat = new THREE.MeshPhysicalMaterial({
  color: 0x00dd66,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.93,
  ior: 1.35,
  thickness: 0.07,
  attenuationColor: 0x006b2e,
  attenuationDistance: 0.065
});

const cobaltSolutionMat = new THREE.MeshPhysicalMaterial({
  color: 0x1155ff,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.93,
  ior: 1.35,
  thickness: 0.07,
  attenuationColor: 0x062488,
  attenuationDistance: 0.065
});

const ironBaseMat = new THREE.MeshStandardMaterial({
  color: 0x24282e,
  metalness: 0.78,
  roughness: 0.42
});

const chromeSteelMat = new THREE.MeshStandardMaterial({
  color: 0xd8dfe8,
  metalness: 0.92,
  roughness: 0.16
});

const teflonStopcockMat = new THREE.MeshStandardMaterial({
  color: 0xf4f4f8,
  roughness: 0.3,
  metalness: 0.05
});

const beechWoodMat = new THREE.MeshStandardMaterial({
  color: 0x9c6e44,
  roughness: 0.55,
  metalness: 0.03
});

const ceramicTileMat = new THREE.MeshPhysicalMaterial({
  color: 0xf5f7fa,
  roughness: 0.15,
  clearcoat: 0.8
});

// 1. Left Assembly: Retort Stand + Graduated Burette + Erlenmeyer Flask (x = -0.26)
const retortGroup = new THREE.Group();
retortGroup.name = "LaboratoryRetortStandGroup";
retortGroup.position.set(-0.26, 0, 0);
root.add(retortGroup);

// Cast-iron rectangular retort base (resting on y = 0)
const retortBase = new THREE.Mesh(
  new THREE.BoxGeometry(0.22, 0.022, 0.16),
  ironBaseMat
);
retortBase.name = "RetortCastIronBase";
retortBase.position.set(0, 0.011, 0);
retortGroup.add(retortBase);

// White porcelain titration tile on the retort base
const titrationTile = new THREE.Mesh(
  new THREE.BoxGeometry(0.14, 0.008, 0.13),
  ceramicTileMat
);
titrationTile.name = "WhitePorcelainTitrationTile";
titrationTile.position.set(0.02, 0.026, 0);
retortGroup.add(titrationTile);

// Vertical steel retort rod
const retortRod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.007, 0.007, 0.66, 16),
  chromeSteelMat
);
retortRod.name = "RetortVerticalSteelRod";
retortRod.position.set(-0.075, 0.34, 0);
retortGroup.add(retortRod);

// Burette double-clamp arm at y = 0.44
const bosshead = new THREE.Mesh(
  new THREE.BoxGeometry(0.026, 0.032, 0.026),
  ironBaseMat
);
bosshead.name = "RetortClampBosshead";
bosshead.position.set(-0.075, 0.44, 0);
retortGroup.add(bosshead);

const clampArm = new THREE.Mesh(
  new THREE.CylinderGeometry(0.005, 0.005, 0.095, 12),
  chromeSteelMat
);
clampArm.name = "BuretteClampHorizontalArm";
clampArm.rotation.z = Math.PI / 2;
clampArm.position.set(-0.028, 0.44, 0);
retortGroup.add(clampArm);

const clampJaws = new THREE.Mesh(
  new THREE.CylinderGeometry(0.015, 0.015, 0.024, 16),
  ironBaseMat
);
clampJaws.name = "BuretteClampJaws";
clampJaws.position.set(0.02, 0.44, 0);
retortGroup.add(clampJaws);

// Graduated Burette Tube clamped above the Erlenmeyer flask (x = 0.02 relative to retortGroup)
const buretteTube = new THREE.Mesh(
  new THREE.CylinderGeometry(0.010, 0.010, 0.36, 20),
  borosilicateGlassMat
);
buretteTube.name = "GraduatedGlassBurette";
buretteTube.position.set(0.02, 0.43, 0);
retortGroup.add(buretteTube);

// Burette liquid column (Cobalt titrant) & graduation rings
const buretteLiquid = new THREE.Mesh(
  new THREE.CylinderGeometry(0.008, 0.008, 0.25, 16),
  cobaltSolutionMat
);
buretteLiquid.name = "BuretteTitrantColumn";
buretteLiquid.position.set(0.02, 0.40, 0);
retortGroup.add(buretteLiquid);

// Stopcock valve & burette delivery tip
const stopcockValve = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 0.048, 12),
  teflonStopcockMat
);
stopcockValve.name = "BuretteStopcockValve";
stopcockValve.rotation.x = Math.PI / 2;
stopcockValve.position.set(0.02, 0.24, 0);
retortGroup.add(stopcockValve);

const buretteTip = new THREE.Mesh(
  new THREE.ConeGeometry(0.007, 0.035, 16),
  borosilicateGlassMat
);
buretteTip.name = "BuretteDeliveryTip";
buretteTip.rotation.x = Math.PI;
buretteTip.position.set(0.02, 0.22, 0);
retortGroup.add(buretteTip);

// Erlenmeyer Flask sitting on the porcelain tile (y = 0.03)
const erlenmeyerBody = new THREE.Mesh(
  new THREE.ConeGeometry(0.062, 0.115, 28),
  borosilicateGlassMat
);
erlenmeyerBody.name = "ErlenmeyerConicalBody";
erlenmeyerBody.position.set(0.02, 0.088, 0);
retortGroup.add(erlenmeyerBody);

const erlenmeyerNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.021, 0.045, 24),
  borosilicateGlassMat
);
erlenmeyerNeck.name = "ErlenmeyerCylindricalNeck";
erlenmeyerNeck.position.set(0.02, 0.155, 0);
retortGroup.add(erlenmeyerNeck);

// Magenta phenolphthalein indicator solution inside the Erlenmeyer flask
const erlenmeyerSolution = new THREE.Mesh(
  new THREE.CylinderGeometry(0.042, 0.058, 0.048, 24),
  magentaSolutionMat
);
erlenmeyerSolution.name = "ErlenmeyerMagentaSolution";
erlenmeyerSolution.position.set(0.02, 0.056, 0);
retortGroup.add(erlenmeyerSolution);

// 2. Center Assembly: Three Florence (Boiling) Flasks with Magenta, Emerald, and Cobalt Solutions
const florenceConfigs = [
  { name: "Magenta", x: -0.04, z: 0.06, r: 0.065, mat: magentaSolutionMat },
  { name: "Emerald", x: 0.10, z: -0.05, r: 0.072, mat: emeraldSolutionMat },
  { name: "Cobalt", x: 0.22, z: 0.07, r: 0.060, mat: cobaltSolutionMat }
];

for (let i = 0; i < florenceConfigs.length; i++) {
  const fc = florenceConfigs[i];
  const flGroup = new THREE.Group();
  flGroup.name = "FlorenceFlaskGroup_" + fc.name;
  flGroup.position.set(fc.x, 0, fc.z);
  root.add(flGroup);

  // Flat-bottomed spherical bulb
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(fc.r, 24, 18),
    borosilicateGlassMat
  );
  bulb.name = "FlorenceBulb_" + fc.name;
  bulb.position.set(0, fc.r, 0);
  flGroup.add(bulb);

  // Tall narrow cylindrical neck + flared lip
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.019, fc.r * 1.35, 20),
    borosilicateGlassMat
  );
  neck.name = "FlorenceNeck_" + fc.name;
  neck.position.set(0, fc.r * 2.25, 0);
  flGroup.add(neck);

  // Transmissive colored solution inside the spherical bulb
  const solVolume = new THREE.Mesh(
    new THREE.SphereGeometry(fc.r * 0.91, 24, 16, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.62),
    fc.mat
  );
  solVolume.name = "FlorenceLiquid_" + fc.name;
  solVolume.position.set(0, fc.r, 0);
  flGroup.add(solVolume);

  const meniscus = new THREE.Mesh(
    new THREE.CylinderGeometry(fc.r * 0.84, fc.r * 0.84, 0.004, 24),
    fc.mat
  );
  meniscus.name = "FlorenceLiquidMeniscus_" + fc.name;
  meniscus.position.set(0, fc.r * 1.32, 0);
  flGroup.add(meniscus);
}

// 3. Right Assembly: Wooden Test-Tube Rack with 6 Test Tubes filled with Magenta, Emerald, and Cobalt Solutions
const rackGroup = new THREE.Group();
rackGroup.name = "WoodenTestTubeRackGroup";
rackGroup.position.set(0.32, 0, -0.06);
root.add(rackGroup);

const rackBase = new THREE.Mesh(
  new THREE.BoxGeometry(0.26, 0.016, 0.075),
  beechWoodMat
);
rackBase.name = "WoodenRackBottomDeck";
rackBase.position.set(0, 0.008, 0);
rackGroup.add(rackBase);

const rackUpperShelf = new THREE.Mesh(
  new THREE.BoxGeometry(0.26, 0.014, 0.075),
  beechWoodMat
);
rackUpperShelf.name = "WoodenRackUpperDeck";
rackUpperShelf.position.set(0, 0.115, 0);
rackGroup.add(rackUpperShelf);

for (let side of [-1, 1]) {
  const pillar = new THREE.Mesh(
    new THREE.BoxGeometry(0.016, 0.135, 0.075),
    beechWoodMat
  );
  pillar.name = "WoodenRackSidePillar_" + (side < 0 ? "Left" : "Right");
  pillar.position.set(side * 0.122, 0.0675, 0);
  rackGroup.add(pillar);
}

const tubeMats = [
  magentaSolutionMat,
  emeraldSolutionMat,
  cobaltSolutionMat,
  magentaSolutionMat,
  emeraldSolutionMat,
  cobaltSolutionMat
];
for (let t = 0; t < 6; t++) {
  const tx = -0.095 + t * 0.038;
  const tubeGroup = new THREE.Group();
  tubeGroup.name = "TestTubeAssembly_" + t;
  tubeGroup.position.set(tx, 0.016, 0);
  rackGroup.add(tubeGroup);

  // Rounded test tube bottom (Sphere) + cylindrical body
  const tubeBottom = new THREE.Mesh(
    new THREE.SphereGeometry(0.011, 16, 12),
    borosilicateGlassMat
  );
  tubeBottom.name = "TestTubeBottomCap_" + t;
  tubeBottom.position.set(0, 0.011, 0);
  tubeGroup.add(tubeBottom);

  const tubeWall = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, 0.145, 16),
    borosilicateGlassMat
  );
  tubeWall.name = "TestTubeCylinder_" + t;
  tubeWall.position.set(0, 0.0835, 0);
  tubeGroup.add(tubeWall);

  // Colored transmissive reagent column inside test tube
  const fillH = 0.075 + (t % 3) * 0.018;
  const tubeLiquid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0092, 0.0092, fillH, 14),
    tubeMats[t]
  );
  tubeLiquid.name = "TestTubeLiquid_" + t;
  tubeLiquid.position.set(0, 0.011 + fillH * 0.5, 0);
  tubeGroup.add(tubeLiquid);
}

// Camera framing (~2.2x bounding radius ~0.48m -> distance ~1.12m)
camera.position.set(0.04, 0.42, 1.08);
camera.lookAt(0.02, 0.26, 0.0);
