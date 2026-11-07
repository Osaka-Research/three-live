// VR Chemistry Lab Workbench with Magnetic Snap Sockets (xr_01)
scene.background = new THREE.Color(0x0f172a);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.1);
keyLight.name = "KeyLight";
keyLight.position.set(2.5, 4.0, 3.0);
scene.add(keyLight);

const burnerGlow = new THREE.PointLight(0x38bdf8, 1.4, 2.5);
burnerGlow.name = "BurnerFlameLight";
burnerGlow.position.set(0.0, 1.05, 0.0);
scene.add(burnerGlow);

// Materials
const steelMat = new THREE.MeshStandardMaterial({
  color: 0x94a3b8,
  metalness: 0.85,
  roughness: 0.25
});
const darkFrameMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  metalness: 0.6,
  roughness: 0.45
});
const epoxyTopMat = new THREE.MeshStandardMaterial({
  color: 0x0f172a,
  metalness: 0.15,
  roughness: 0.2
});
const brassMat = new THREE.MeshStandardMaterial({
  color: 0xd97706,
  metalness: 0.88,
  roughness: 0.22
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xe2e8f0,
  transmission: 0.9,
  ior: 1.5,
  thickness: 0.015,
  roughness: 0.06,
  metalness: 0.0,
  transparent: true,
  opacity: 0.95
});
const stopperMat = new THREE.MeshStandardMaterial({
  color: 0x334155,
  roughness: 0.8,
  metalness: 0.05
});

// Root Workbench Group
const workbench = new THREE.Group();
workbench.name = "ChemistryWorkbench";
workbench.userData.xr = {
  anchor: "Table",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.2, friction: 0.8 }
};
scene.add(workbench);

// Workbench Legs (resting on y = 0)
const legGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.78, 16);
const legOffsets = [
  [-0.68, 0.39, -0.38],
  [0.68, 0.39, -0.38],
  [-0.68, 0.39, 0.38],
  [0.68, 0.39, 0.38]
];
legOffsets.forEach((pos, idx) => {
  const leg = new THREE.Mesh(legGeo, darkFrameMat);
  leg.name = `WorkbenchLeg_${idx + 1}`;
  leg.position.set(pos[0], pos[1], pos[2]);
  workbench.add(leg);
});

// Lower Crossbar Shelf
const lowerShelf = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.025, 0.72), darkFrameMat);
lowerShelf.name = "WorkbenchLowerShelf";
lowerShelf.position.set(0, 0.22, 0);
workbench.add(lowerShelf);

// Chemical-Resistant Epoxy Tabletop (top at y = 0.82)
const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.85), epoxyTopMat);
tableTop.name = "WorkbenchTableTop";
tableTop.position.set(0, 0.8, 0);
workbench.add(tableTop);

// Back Backsplash & Reagent Shelf
const backsplash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.03), darkFrameMat);
backsplash.name = "WorkbenchBacksplash";
backsplash.position.set(0, 0.96, -0.41);
workbench.add(backsplash);

// Bunsen Burner Assembly with Magnetic Snap Socket
const burnerGroup = new THREE.Group();
burnerGroup.name = "BunsenBurnerSocket";
burnerGroup.position.set(0.0, 0.82, 0.0);
burnerGroup.userData.xr = {
  snapSocket: { id: "burner", radius: 0.12 },
  audioEmitter: { src: "burner_hiss.ogg", refDistance: 1.2, loop: true }
};
workbench.add(burnerGroup);

const burnerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.02, 24), brassMat);
burnerBase.name = "BunsenBurnerBase";
burnerBase.position.y = 0.01;
burnerGroup.add(burnerBase);

const burnerCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 16), brassMat);
burnerCollar.name = "BunsenBurnerCollar";
burnerCollar.position.y = 0.035;
burnerGroup.add(burnerCollar);

const burnerTube = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.13, 16), steelMat);
burnerTube.name = "BunsenBurnerBarrel";
burnerTube.position.y = 0.11;
burnerGroup.add(burnerTube);

// Tripod Heating Stand & Wire Gauze over Burner
const ringStand = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 12, 24), steelMat);
ringStand.name = "BurnerTripodRing";
ringStand.rotation.x = Math.PI / 2;
ringStand.position.y = 0.24;
burnerGroup.add(ringStand);

for (let i = 0; i < 3; i++) {
  const angle = (i * Math.PI * 2) / 3;
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.24, 10), steelMat);
  strut.name = `TripodStrut_${i + 1}`;
  strut.position.set(Math.cos(angle) * 0.075, 0.12, Math.sin(angle) * 0.075);
  burnerGroup.add(strut);
}

const wireGauze = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.004, 24), steelMat);
wireGauze.name = "CeramicWireGauze";
wireGauze.position.y = 0.244;
burnerGroup.add(wireGauze);

// Snap Socket Target Ring Indicator
const socketRingMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.9,
  roughness: 0.2
});
const socketIndicator = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.004, 12, 32), socketRingMat);
socketIndicator.name = "SnapSocketIndicatorRing";
socketIndicator.rotation.x = Math.PI / 2;
socketIndicator.position.y = 0.248;
burnerGroup.add(socketIndicator);

// Dual-Cone Bunsen Flame
const outerFlameMat = new THREE.MeshPhysicalMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 1.2,
  transmission: 0.7,
  transparent: true,
  opacity: 0.75,
  roughness: 0.1
});
const innerFlameMat = new THREE.MeshStandardMaterial({
  color: 0xe0f2fe,
  emissive: 0x7dd3fc,
  emissiveIntensity: 1.8,
  roughness: 0.1
});

const outerFlame = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.065, 16), outerFlameMat);
outerFlame.name = "OuterBunsenFlame";
outerFlame.position.y = 0.205;
burnerGroup.add(outerFlame);

const innerFlame = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.035, 12), innerFlameMat);
innerFlame.name = "InnerBunsenFlame";
innerFlame.position.y = 0.19;
burnerGroup.add(innerFlame);

// Spark Particles rising around Burner
const sparkGroup = new THREE.Group();
sparkGroup.name = "BurnerSparkParticles";
sparkGroup.userData.xr = { bloom: { strength: 0.9 } };
burnerGroup.add(sparkGroup);

const sparkMat = new THREE.MeshStandardMaterial({
  color: 0xfbbf24,
  emissive: 0xf59e0b,
  emissiveIntensity: 2.0
});
const sparks = [];
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  const r = 0.015 + (i % 3) * 0.012;
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), sparkMat);
  spark.name = `SparkParticle_${i + 1}`;
  spark.position.set(Math.cos(angle) * r, 0.19 + (i % 4) * 0.015, Math.sin(angle) * r);
  sparkGroup.add(spark);
  sparks.push({ mesh: spark, baseAngle: angle, radius: r, speed: 2.0 + (i % 3) * 0.6, phase: i * 0.5 });
}

// Helper to build Grabbable Erlenmeyer Reagent Flasks
function createReagentFlask(id, xPos, zPos, liquidHex, labelColorHex) {
  const flask = new THREE.Group();
  flask.name = `ReagentFlask_${id}`;
  flask.position.set(xPos, 0.82, zPos);
  flask.userData.xr = {
    grab: "1-hand",
    snapTo: { radius: 0.12, targets: ["BunsenBurnerSocket"] },
    physics: { body: "dynamic", collider: "hull", mass: 0.35, restitution: 0.2, friction: 0.6 },
    outline: { color: "#38bdf8", thickness: 0.012 }
  };

  // Conical glass body
  const coneBody = new THREE.Mesh(new THREE.ConeGeometry(0.065, 0.13, 24, 1, false), glassMat);
  coneBody.name = `FlaskBody_${id}`;
  coneBody.position.y = 0.065;
  flask.add(coneBody);

  // Cylindrical neck
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.022, 0.065, 20), glassMat);
  neck.name = `FlaskNeck_${id}`;
  neck.position.y = 0.15;
  flask.add(neck);

  // Rolled glass lip
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.021, 0.0035, 10, 20), glassMat);
  lip.name = `FlaskLip_${id}`;
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.182;
  flask.add(lip);

  // Colored Reagent Liquid Volume inside
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: liquidHex,
    emissive: liquidHex,
    emissiveIntensity: 0.25,
    transmission: 0.65,
    ior: 1.33,
    roughness: 0.1,
    transparent: true,
    opacity: 0.88
  });
  const liquidCone = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.075, 20), liquidMat);
  liquidCone.name = `FlaskLiquid_${id}`;
  liquidCone.position.y = 0.04;
  flask.add(liquidCone);

  // Rubber Stopper
  const stopper = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.015, 0.026, 16), stopperMat);
  stopper.name = `FlaskStopper_${id}`;
  stopper.position.y = 0.188;
  flask.add(stopper);

  // Color-coded collar band
  const bandMat = new THREE.MeshStandardMaterial({ color: labelColorHex, roughness: 0.3 });
  const collarBand = new THREE.Mesh(new THREE.CylinderGeometry(0.023, 0.023, 0.012, 16), bandMat);
  collarBand.name = `FlaskLabelBand_${id}`;
  collarBand.position.y = 0.145;
  flask.add(collarBand);

  workbench.add(flask);
  return flask;
}

createReagentFlask("CopperSulfate", -0.38, 0.12, 0x0ea5e9, 0x38bdf8);
createReagentFlask("PotassiumPermanganate", -0.18, -0.16, 0xa855f7, 0xc084fc);
createReagentFlask("FluoresceinDye", 0.36, 0.10, 0x10b981, 0x34d399);

// Floating Spatial Label UI Panel above the Workbench
const spatialLabel = new THREE.Group();
spatialLabel.name = "SpatialWorkbenchLabel";
spatialLabel.position.set(0.0, 1.32, -0.15);
spatialLabel.userData.xr = {
  billboard: "y",
  gaze: { dwellMs: 800, action: "select" }
};
scene.add(spatialLabel);

const labelBacking = new THREE.Mesh(
  new THREE.BoxGeometry(0.56, 0.14, 0.012),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.4, roughness: 0.3 })
);
labelBacking.name = "SpatialLabelBacking";
spatialLabel.add(labelBacking);

const labelBorder = new THREE.Mesh(
  new THREE.BoxGeometry(0.58, 0.16, 0.008),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.7 })
);
labelBorder.name = "SpatialLabelBorder";
labelBorder.position.z = -0.003;
spatialLabel.add(labelBorder);

for (let i = 0; i < 3; i++) {
  const indicatorDot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.016, 16),
    new THREE.MeshStandardMaterial({
      color: i === 0 ? 0x38bdf8 : i === 1 ? 0xc084fc : 0x34d399,
      emissive: i === 0 ? 0x38bdf8 : i === 1 ? 0xc084fc : 0x34d399,
      emissiveIntensity: 0.8
    })
  );
  indicatorDot.name = `LabelStatusDot_${i + 1}`;
  indicatorDot.rotation.x = Math.PI / 2;
  indicatorDot.position.set(-0.2 + i * 0.045, 0.025, 0.006);
  spatialLabel.add(indicatorDot);
}

const labelProgressBar = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.018, 0.014),
  new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0ea5e9, emissiveIntensity: 0.6 })
);
labelProgressBar.name = "SpatialLabelReadoutBar";
labelProgressBar.position.set(0.0, -0.025, 0.004);
spatialLabel.add(labelProgressBar);

function animate(t) {
  outerFlame.scale.set(1 + Math.sin(t * 14) * 0.06, 1 + Math.cos(t * 18) * 0.08, 1 + Math.sin(t * 14) * 0.06);
  sparks.forEach((s) => {
    const cycle = (t * s.speed + s.phase) % 1.0;
    s.mesh.position.y = 0.18 + cycle * 0.09;
    s.mesh.position.x = Math.cos(s.baseAngle + t * 3.0) * s.radius * (1.0 - cycle * 0.4);
    s.mesh.position.z = Math.sin(s.baseAngle + t * 3.0) * s.radius * (1.0 - cycle * 0.4);
  });
  spatialLabel.position.y = 1.32 + Math.sin(t * 2.0) * 0.015;
}

camera.position.set(1.65, 1.55, 1.95);
camera.lookAt(0, 0.68, 0);
