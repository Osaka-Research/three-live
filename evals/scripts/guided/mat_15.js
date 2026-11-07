// mat_15: Three-Point Studio Photography Lighting Stage
const root = new THREE.Group();
root.name = "PhotographyLightingStageRoot";
scene.add(root);

// Lighting: Ambient + Key DirectionalLight + Fill PointLight + Warm Rim SpotLight
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "StudioStageAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xfffcf5, 1.5);
keyDirLight.name = "KeySoftboxDirectionalLight";
keyDirLight.position.set(-1.1, 1.65, 0.95);
scene.add(keyDirLight);

const fillPointLight = new THREE.PointLight(0xd8ecff, 1.4, 4.5);
fillPointLight.name = "FillReflectorPointLight";
fillPointLight.position.set(1.05, 1.35, 0.85);
scene.add(fillPointLight);

const warmRimSpotLight = new THREE.SpotLight(0xffaa33, 3.2, 5.0, Math.PI / 5, 0.4, 1.0);
warmRimSpotLight.name = "WarmRimFresnelSpotLight";
warmRimSpotLight.position.set(0.65, 1.85, -0.82);
warmRimSpotLight.target.position.set(0, 1.15, -0.15);
scene.add(warmRimSpotLight);
scene.add(warmRimSpotLight.target);

// Materials
const cycloramaWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xf4f6f9,
  roughness: 0.75,
  metalness: 0.02
});

const plinthMat = new THREE.MeshStandardMaterial({
  color: 0x1e2229,
  roughness: 0.35,
  metalness: 0.15
});

const sculptureGoldBronzeMat = new THREE.MeshPhysicalMaterial({
  color: 0xd9a14a,
  metalness: 0.94,
  roughness: 0.16,
  clearcoat: 0.5,
  clearcoatRoughness: 0.1
});

const chromeStandMat = new THREE.MeshStandardMaterial({
  color: 0xd0d7e0,
  metalness: 0.9,
  roughness: 0.2
});

const blackHousingMat = new THREE.MeshStandardMaterial({
  color: 0x16181c,
  roughness: 0.6,
  metalness: 0.3
});

const softboxDiffuserMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xfff8e8,
  emissiveIntensity: 1.6,
  roughness: 0.3
});

const silverReflectorMat = new THREE.MeshStandardMaterial({
  color: 0xe6f0fa,
  metalness: 0.85,
  roughness: 0.18,
  emissive: 0x88bbee,
  emissiveIntensity: 0.35
});

const warmSpotLensMat = new THREE.MeshStandardMaterial({
  color: 0xffbb44,
  emissive: 0xff9911,
  emissiveIntensity: 2.2,
  roughness: 0.1
});

// 1. Photography Cyclorama Stage (~3.0m wide x 2.4m deep x 2.1m tall) with Curved White Infinity Cove
const cycGroup = new THREE.Group();
cycGroup.name = "InfinityCycloramaStageGroup";
root.add(cycGroup);

const stageWidth = 3.0;
const coveRadius = 0.65;

// Flat stage floor (z = -0.55 to z = +1.20, y = 0)
const stageFloor = new THREE.Mesh(
  new THREE.BoxGeometry(stageWidth, 0.04, 1.75),
  cycloramaWhiteMat
);
stageFloor.name = "CycloramaStageFloor";
stageFloor.position.set(0, 0.02, 0.325);
cycGroup.add(stageFloor);

// Curved quarter-cylinder Infinity Cove sweep (centered at z = -0.55, y = 0.69)
const coveSweep = new THREE.Mesh(
  new THREE.CylinderGeometry(coveRadius, coveRadius, stageWidth, 24, 1, true, Math.PI, Math.PI / 2),
  cycloramaWhiteMat
);
coveSweep.name = "CycloramaCurvedInfinityCove";
coveSweep.Material = cycloramaWhiteMat;
coveSweep.material.side = THREE.DoubleSide;
coveSweep.rotation.z = Math.PI / 2;
coveSweep.position.set(0, 0.04 + coveRadius, -0.55);
cycGroup.add(coveSweep);

// Vertical rear backdrop wall (z = -1.20, from y = 0.69 to y = 2.10)
const rearWall = new THREE.Mesh(
  new THREE.BoxGeometry(stageWidth, 1.42, 0.04),
  cycloramaWhiteMat
);
rearWall.name = "CycloramaVerticalBackWall";
rearWall.position.set(0, 1.40, -0.55 - coveRadius);
cycGroup.add(rearWall);

// 2. Central Metallic Geometric Bust Sculpture on a Museum Plinth (x = 0, z = -0.15)
const subjectGroup = new THREE.Group();
subjectGroup.name = "CentralSculptureAndPlinthGroup";
subjectGroup.position.set(0, 0.04, -0.15);
root.add(subjectGroup);

const plinthPedestal = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.86, 0.42),
  plinthMat
);
plinthPedestal.name = "SculptureDisplayPlinth";
plinthPedestal.position.set(0, 0.43, 0);
subjectGroup.add(plinthPedestal);

// Geometric Bust Sculpture (base block, faceted shoulders, neck cylinder, low-poly faceted head & crown)
const bustBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.15, 0.06, 8),
  sculptureGoldBronzeMat
);
bustBase.name = "SculptureBustSocle";
bustBase.position.set(0, 0.89, 0);
subjectGroup.add(bustBase);

const bustShoulders = new THREE.Mesh(
  new THREE.CylinderGeometry(0.11, 0.22, 0.18, 6),
  sculptureGoldBronzeMat
);
bustShoulders.name = "GeometricBustShoulders";
bustShoulders.rotation.y = Math.PI / 6;
bustShoulders.position.set(0, 1.01, 0);
subjectGroup.add(bustShoulders);

const bustNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.068, 0.082, 0.10, 8),
  sculptureGoldBronzeMat
);
bustNeck.name = "GeometricBustNeck";
bustNeck.position.set(0, 1.14, 0);
subjectGroup.add(bustNeck);

const bustHead = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.135, 1),
  sculptureGoldBronzeMat
);
bustHead.name = "GeometricFacetedHead";
bustHead.scale.set(0.85, 1.18, 0.95);
bustHead.position.set(0, 1.29, 0);
subjectGroup.add(bustHead);

// Helper to build a physical C-Stand tripod base + vertical riser column + knuckle boom arm
function createCStandRig(name, x, z, height, targetPos) {
  const rig = new THREE.Group();
  rig.name = name;
  rig.position.set(x, 0.04, z);
  root.add(rig);

  // 3 nested C-stand turtle legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.3;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.34, 10),
      chromeStandMat
    );
    leg.name = name + "_Leg_" + i;
    leg.rotation.z = Math.PI / 2 - 0.15;
    leg.rotation.y = a;
    leg.position.set(Math.cos(a) * 0.16, 0.05 + i * 0.015, Math.sin(a) * 0.16);
    rig.add(leg);
  }

  // Vertical telescoping chrome riser pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.022, height, 14),
    chromeStandMat
  );
  pole.name = name + "_RiserPole";
  pole.position.set(0, height * 0.5, 0);
  rig.add(pole);

  // Grip head knuckle at top of pole
  const knuckle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.032, 0.035, 14),
    blackHousingMat
  );
  knuckle.name = name + "_GripKnuckle";
  knuckle.rotation.z = Math.PI / 2;
  knuckle.position.set(0, height, 0);
  rig.add(knuckle);

  // Fixture head pivot aimed at the sculpture
  const headPivot = new THREE.Group();
  headPivot.name = name + "_FixtureHead";
  headPivot.position.set(0, height, 0);
  rig.add(headPivot);
  headPivot.lookAt(targetPos.x, targetPos.y, targetPos.z);

  return headPivot;
}

const targetBustPos = new THREE.Vector3(0, 1.25, -0.15);

// 3a. Key Softbox Light Rig (Front-Left at x = -1.10, z = 0.85, height = 1.60m)
const keyHead = createCStandRig("KeySoftboxCStandRig", -1.10, 0.85, 1.60, targetBustPos);

const softboxHood = new THREE.Mesh(
  new THREE.BoxGeometry(0.56, 0.42, 0.24),
  blackHousingMat
);
softboxHood.name = "KeySoftboxShroud";
softboxHood.position.set(0, 0, 0.10);
keyHead.add(softboxHood);

const softboxFace = new THREE.Mesh(
  new THREE.BoxGeometry(0.54, 0.40, 0.02),
  softboxDiffuserMat
);
softboxFace.name = "KeySoftboxDiffuserScreen";
softboxFace.position.set(0, 0, 0.22);
keyHead.add(softboxFace);

// 3b. Fill Reflector Rig (Front-Right at x = 1.05, z = 0.78, height = 1.35m)
const fillHead = createCStandRig("FillReflectorCStandRig", 1.05, 0.78, 1.35, targetBustPos);

const reflectorFrame = new THREE.Mesh(
  new THREE.BoxGeometry(0.52, 0.64, 0.025),
  blackHousingMat
);
reflectorFrame.name = "FillReflectorFrame";
reflectorFrame.position.set(0, 0, 0.04);
fillHead.add(reflectorFrame);

const reflectorFoil = new THREE.Mesh(
  new THREE.BoxGeometry(0.48, 0.60, 0.01),
  silverReflectorMat
);
reflectorFoil.name = "FillSilverBouncePanel";
reflectorFoil.position.set(0, 0, 0.055);
fillHead.add(reflectorFoil);

// 3c. Warm Rim Spotlight Rig (Back-Right at x = 0.85, z = -0.52, height = 1.78m)
const rimHead = createCStandRig("WarmRimSpotlightCStandRig", 0.85, -0.52, 1.78, targetBustPos);

const spotCan = new THREE.Mesh(
  new THREE.CylinderGeometry(0.095, 0.085, 0.26, 20),
  blackHousingMat
);
spotCan.name = "RimSpotlightFresnelCan";
spotCan.rotation.x = Math.PI / 2;
spotCan.position.set(0, 0, 0.10);
rimHead.add(spotCan);

const spotLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.082, 0.082, 0.02, 20),
  warmSpotLensMat
);
spotLens.name = "RimSpotlightFresnelLens";
spotLens.rotation.x = Math.PI / 2;
spotLens.position.set(0, 0, 0.23);
rimHead.add(spotLens);

// 4 Barn-door flaps on the warm rim spotlight
const flapOffsets = [
  [0, 0.10, 0.26, 0.16, 0.08, 0.01],
  [0, -0.10, 0.26, 0.16, 0.08, 0.01],
  [0.10, 0, 0.26, 0.08, 0.16, 0.01],
  [-0.10, 0, 0.26, 0.08, 0.16, 0.01]
];
for (let f = 0; f < flapOffsets.length; f++) {
  const fo = flapOffsets[f];
  const flap = new THREE.Mesh(
    new THREE.BoxGeometry(fo[3], fo[4], fo[5]),
    blackHousingMat
  );
  flap.name = "RimSpotBarnDoorFlap_" + f;
  flap.position.set(fo[0], fo[1], fo[2]);
  rimHead.add(flap);
}

// Camera framing (~2.2x bounding radius ~1.85m -> distance ~4.1m)
camera.position.set(0.0, 1.65, 3.85);
camera.lookAt(0, 1.0, -0.1);
