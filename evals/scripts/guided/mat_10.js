// mat_10: Hammered Copper Alembic Distillation Apparatus
const root = new THREE.Group();
root.name = "AlembicDistillationApparatusRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "LabAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xfff5e6, 1.5);
keyDirLight.name = "LabKeyDirectionalLight";
keyDirLight.position.set(1.5, 2.5, 2.0);
scene.add(keyDirLight);

const burnerGlowLight = new THREE.PointLight(0xff7722, 1.8, 2.0);
burnerGlowLight.name = "AlembicBurnerPointLight";
burnerGlowLight.position.set(-0.34, 0.25, 0.0);
scene.add(burnerGlowLight);

const distillateGlowLight = new THREE.PointLight(0x00e5ff, 1.5, 2.0);
distillateGlowLight.name = "TurquoiseDistillateLight";
distillateGlowLight.position.set(0.36, 0.28, 0.0);
scene.add(distillateGlowLight);

// Materials
const oakWoodMat = new THREE.MeshStandardMaterial({
  color: 0x7c5533,
  roughness: 0.65,
  metalness: 0.04
});

const hammeredCopperMat = new THREE.MeshPhysicalMaterial({
  color: 0xd67244,
  metalness: 0.94,
  roughness: 0.22,
  clearcoat: 0.35,
  clearcoatRoughness: 0.25
});

const brassFittingMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  metalness: 0.9,
  roughness: 0.2
});

const ironStandMat = new THREE.MeshStandardMaterial({
  color: 0x282b30,
  metalness: 0.8,
  roughness: 0.45
});

const labGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.95,
  ior: 1.51,
  thickness: 0.025,
  attenuationColor: 0xeef9ff,
  attenuationDistance: 0.5,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

const turquoiseDistillateMat = new THREE.MeshPhysicalMaterial({
  color: 0x10e5dc,
  roughness: 0.04,
  metalness: 0.0,
  transmission: 0.92,
  ior: 1.36,
  thickness: 0.08,
  attenuationColor: 0x007c8a,
  attenuationDistance: 0.09
});

// Oak Workbench Platform resting on y = 0 (width 1.1m, depth 0.52m, height 0.14m)
const workbenchGroup = new THREE.Group();
workbenchGroup.name = "OakWorkbenchGroup";
root.add(workbenchGroup);

const benchSlab = new THREE.Mesh(
  new THREE.BoxGeometry(1.12, 0.05, 0.52),
  oakWoodMat
);
benchSlab.name = "OakWorkbenchTopSlab";
benchSlab.position.set(0, 0.115, 0);
workbenchGroup.add(benchSlab);

const legOffsets = [
  [-0.48, -0.20],
  [0.48, -0.20],
  [-0.48, 0.20],
  [0.48, 0.20]
];
for (let i = 0; i < legOffsets.length; i++) {
  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.028, 0.09, 16),
    oakWoodMat
  );
  leg.name = "OakBenchFoot_" + i;
  leg.position.set(legOffsets[i][0], 0.045, legOffsets[i][1]);
  workbenchGroup.add(leg);
}

const benchTopY = 0.14;

// 1. Left Assembly: Hammered Copper Cucurbit Boiler + Swan-Neck Helmet (x = -0.34)
const boilerGroup = new THREE.Group();
boilerGroup.name = "CopperCucurbitBoilerGroup";
boilerGroup.position.set(-0.34, benchTopY, 0);
root.add(boilerGroup);

// Iron tripod burner stand & spirit lamp
const tripodRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.11, 0.01, 12, 28),
  ironStandMat
);
tripodRing.name = "BoilerTripodRing";
tripodRing.rotation.x = Math.PI / 2;
tripodRing.position.set(0, 0.11, 0);
boilerGroup.add(tripodRing);

for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2;
  const tLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.115, 10),
    ironStandMat
  );
  tLeg.name = "BoilerTripodLeg_" + i;
  tLeg.position.set(Math.cos(a) * 0.11, 0.055, Math.sin(a) * 0.11);
  boilerGroup.add(tLeg);
}

const spiritBurner = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.065, 0.045, 20),
  brassFittingMat
);
spiritBurner.name = "BrassSpiritBurner";
spiritBurner.position.set(0, 0.0225, 0);
boilerGroup.add(spiritBurner);

// Hammered Copper Cucurbit Belly & Neck
const cucurbitBelly = new THREE.Mesh(
  new THREE.SphereGeometry(0.135, 24, 18),
  hammeredCopperMat
);
cucurbitBelly.name = "HammeredCopperCucurbitBelly";
cucurbitBelly.scale.set(1.0, 0.92, 1.0);
cucurbitBelly.position.set(0, 0.21, 0);
boilerGroup.add(cucurbitBelly);

const rivetedSeamRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.134, 0.008, 12, 32),
  brassFittingMat
);
rivetedSeamRing.name = "CopperBoilerRivetedSeam";
rivetedSeamRing.rotation.x = Math.PI / 2;
rivetedSeamRing.position.set(0, 0.21, 0);
boilerGroup.add(rivetedSeamRing);

const cucurbitCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.068, 0.088, 0.065, 24),
  hammeredCopperMat
);
cucurbitCollar.name = "CopperBoilerCollar";
cucurbitCollar.position.set(0, 0.34, 0);
boilerGroup.add(cucurbitCollar);

// Onion-shaped Alembic Helmet Cap
const alembicHelmet = new THREE.Mesh(
  new THREE.SphereGeometry(0.082, 24, 18),
  hammeredCopperMat
);
alembicHelmet.name = "CopperAlembicHelmet";
alembicHelmet.scale.set(1.0, 0.88, 1.0);
alembicHelmet.position.set(0, 0.415, 0);
boilerGroup.add(alembicHelmet);

// Swan-neck copper tube arching from helmet over to the condenser at x = 0.02
const swanNeckCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.34, benchTopY + 0.47, 0),
  new THREE.Vector3(-0.30, benchTopY + 0.56, 0),
  new THREE.Vector3(-0.16, benchTopY + 0.55, 0),
  new THREE.Vector3(-0.04, benchTopY + 0.47, 0),
  new THREE.Vector3(0.02, benchTopY + 0.41, 0)
]);
const swanNeckMesh = new THREE.Mesh(
  new THREE.TubeGeometry(swanNeckCurve, 32, 0.015, 12, false),
  hammeredCopperMat
);
swanNeckMesh.name = "CopperSwanNeckTube";
root.add(swanNeckMesh);

// 2. Center Assembly: Helical Glass Graham Condenser inside Water Jacket (x = 0.02)
const condenserGroup = new THREE.Group();
condenserGroup.name = "GrahamCondenserGroup";
condenserGroup.position.set(0.02, benchTopY, 0);
root.add(condenserGroup);

// Brass laboratory retort stand supporting the condenser
const standBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.075, 0.085, 0.02, 20),
  ironStandMat
);
standBase.name = "CondenserStandBase";
standBase.position.set(-0.06, 0.01, -0.09);
condenserGroup.add(standBase);

const standRod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.009, 0.009, 0.46, 12),
  brassFittingMat
);
standRod.name = "CondenserStandVerticalRod";
standRod.position.set(-0.06, 0.24, -0.09);
condenserGroup.add(standRod);

const clampArm = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 0.11, 10),
  brassFittingMat
);
clampArm.name = "CondenserClampArm";
clampArm.rotation.x = Math.PI / 2;
clampArm.position.set(-0.03, 0.29, -0.045);
condenserGroup.add(clampArm);

const clampRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.062, 0.007, 12, 24),
  brassFittingMat
);
clampRing.name = "CondenserClampCollar";
clampRing.rotation.x = Math.PI / 2;
clampRing.position.set(0, 0.29, 0);
condenserGroup.add(clampRing);

// Outer glass water jacket cylinder
const waterJacket = new THREE.Mesh(
  new THREE.CylinderGeometry(0.058, 0.058, 0.24, 24),
  labGlassMat
);
waterJacket.name = "CondenserGlassWaterJacket";
waterJacket.position.set(0, 0.29, 0);
condenserGroup.add(waterJacket);

// Brass top & bottom end caps on the condenser jacket
for (let yEnd of [0.17, 0.41]) {
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.061, 0.061, 0.014, 24),
    brassFittingMat
  );
  cap.name = "CondenserJacketCap_" + Math.round(yEnd * 100);
  cap.position.set(0, yEnd, 0);
  condenserGroup.add(cap);
}

// Helical Glass Graham Condenser Coil inside the water jacket
const coilPoints = [];
const coilTurns = 6;
const coilSamples = 72;
for (let i = 0; i <= coilSamples; i++) {
  const t = i / coilSamples;
  const angle = t * Math.PI * 2 * coilTurns;
  const r = 0.032;
  const y = 0.40 - t * 0.22;
  coilPoints.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
}
const coilCurve = new THREE.CatmullRomCurve3(coilPoints);
const helicalCoil = new THREE.Mesh(
  new THREE.TubeGeometry(coilCurve, 80, 0.0065, 10, false),
  turquoiseDistillateMat
);
helicalCoil.name = "HelicalGrahamCondenserCoil";
condenserGroup.add(helicalCoil);

// Delivery spout from bottom of condenser to receiving flask at x = 0.36
const spoutCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.02, benchTopY + 0.165, 0),
  new THREE.Vector3(0.06, benchTopY + 0.13, 0),
  new THREE.Vector3(0.24, benchTopY + 0.18, 0),
  new THREE.Vector3(0.36, benchTopY + 0.22, 0)
]);
const deliverySpout = new THREE.Mesh(
  new THREE.TubeGeometry(spoutCurve, 24, 0.008, 10, false),
  labGlassMat
);
deliverySpout.name = "GlassDeliverySpoutTube";
root.add(deliverySpout);

// 3. Right Assembly: Glass Receiving Flask Catching Turquoise Distillate (x = 0.36)
const receiverGroup = new THREE.Group();
receiverGroup.name = "ReceivingFlaskGroup";
receiverGroup.position.set(0.36, benchTopY, 0);
root.add(receiverGroup);

const corkCoaster = new THREE.Mesh(
  new THREE.TorusGeometry(0.055, 0.012, 12, 24),
  oakWoodMat
);
corkCoaster.name = "ReceivingFlaskCorkRing";
corkCoaster.rotation.x = Math.PI / 2;
corkCoaster.position.set(0, 0.012, 0);
receiverGroup.add(corkCoaster);

const flaskBulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.095, 24, 18),
  labGlassMat
);
flaskBulb.name = "GlassReceivingFlaskBulb";
flaskBulb.position.set(0, 0.105, 0);
receiverGroup.add(flaskBulb);

const flaskNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.026, 0.032, 0.085, 20),
  labGlassMat
);
flaskNeck.name = "GlassReceivingFlaskNeck";
flaskNeck.position.set(0, 0.215, 0);
receiverGroup.add(flaskNeck);

// Turquoise distillate liquid volume inside the receiving flask
const distillateLiquid = new THREE.Mesh(
  new THREE.SphereGeometry(0.086, 24, 16, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58),
  turquoiseDistillateMat
);
distillateLiquid.name = "TurquoiseDistillateLiquid";
distillateLiquid.position.set(0, 0.105, 0);
receiverGroup.add(distillateLiquid);

const distillateMeniscus = new THREE.Mesh(
  new THREE.CylinderGeometry(0.083, 0.083, 0.004, 24),
  turquoiseDistillateMat
);
distillateMeniscus.name = "TurquoiseDistillateMeniscus";
distillateMeniscus.position.set(0, 0.125, 0);
receiverGroup.add(distillateMeniscus);

const fallingDrop = new THREE.Mesh(
  new THREE.SphereGeometry(0.007, 12, 10),
  turquoiseDistillateMat
);
fallingDrop.name = "FallingDistillateDrop";
fallingDrop.scale.set(0.8, 1.35, 0.8);
fallingDrop.position.set(0, 0.175, 0);
receiverGroup.add(fallingDrop);

// Camera framing (~2.2x bounding radius ~0.62m -> distance ~1.4m)
camera.position.set(0.0, 0.52, 1.38);
camera.lookAt(0, 0.34, 0);
