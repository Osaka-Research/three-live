// Exploded-View Turbofan Jet Engine with Dimension Callouts (xr_02)
scene.background = new THREE.Color(0x0b1120);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.name = "KeyLight";
keyLight.position.set(3.0, 4.0, 3.5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.75);
rimLight.name = "RimLight";
rimLight.position.set(-2.5, 2.0, -2.5);
scene.add(rimLight);

// Materials
const cradleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.4 });
const cowlingMat = new THREE.MeshPhysicalMaterial({
  color: 0xe2e8f0,
  metalness: 0.35,
  roughness: 0.2,
  clearcoat: 0.8,
  clearcoatRoughness: 0.1,
  transparent: true,
  opacity: 0.82
});
const titaniumMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.9, roughness: 0.18 });
const compressorGoldMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.85, roughness: 0.25 });
const combustorMat = new THREE.MeshStandardMaterial({
  color: 0xb91c1c,
  emissive: 0xef4444,
  emissiveIntensity: 0.45,
  metalness: 0.65,
  roughness: 0.3
});
const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.88, roughness: 0.28 });
const leaderMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.8
});

// Ground Support Maintenance Cradle (resting on y = 0)
const supportStand = new THREE.Group();
supportStand.name = "EngineSupportCradle";
supportStand.userData.xr = {
  anchor: "Floor",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.9 }
};
scene.add(supportStand);

const baseFrame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.06, 0.85), cradleMat);
baseFrame.name = "CradleBaseFrame";
baseFrame.position.set(0, 0.03, 0);
supportStand.add(baseFrame);

[-0.45, 0.45].forEach((zPos, idx) => {
  const stanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.52, 16), cradleMat);
  stanchion.name = `CradleStanchion_${idx + 1}`;
  stanchion.position.set(0, 0.30, zPos);
  supportStand.add(stanchion);

  const saddle = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.02, 12, 24, Math.PI), cradleMat);
  saddle.name = `CradleSaddleArc_${idx + 1}`;
  saddle.rotation.z = Math.PI;
  saddle.position.set(0, 0.72, zPos);
  supportStand.add(saddle);
});

// Interactive Turbofan Jet Engine Root Assembly
const engineRoot = new THREE.Group();
engineRoot.name = "TurbofanJetEngine";
engineRoot.position.set(0, 0.75, 0);
engineRoot.userData.xr = {
  grab: "2-hand",
  scale: { min: 0.5, max: 2.5 },
  dimensions: { unit: "cm", axes: ["x", "y", "z"] },
  handles: { rotateAxis: "y", minScale: 0.5, maxScale: 2.5 }
};
scene.add(engineRoot);

// Central Core Spool Shaft
const mainShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.35, 20), titaniumMat);
mainShaft.name = "MainSpoolShaft";
mainShaft.rotation.x = Math.PI / 2;
engineRoot.add(mainShaft);

// Helper to add Leader Line & Callout Plaque to each sub-assembly
function addLeaderCallout(parentGroup, tagId, xDir, yHeight) {
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, yHeight, 8), leaderMat);
  stalk.name = `LeaderStalk_${tagId}`;
  stalk.position.set(xDir * 0.12, yHeight * 0.5 + 0.18, 0);
  parentGroup.add(stalk);

  const badge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.065, 0.012), leaderMat);
  badge.name = `CalloutBadge_${tagId}`;
  badge.position.set(xDir * 0.12, yHeight + 0.21, 0);
  badge.userData.xr = { billboard: "y" };
  parentGroup.add(badge);
}

// 1. Sub-Assembly 1: Acoustic Intake Cowling
const intakeGroup = new THREE.Group();
intakeGroup.name = "IntakeCowlingAssembly";
intakeGroup.position.set(0, 0, 0.48);
intakeGroup.userData.xr = {
  explode: { distance: 0.36, direction: [0, 0, 1] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
engineRoot.add(intakeGroup);

const intakeLip = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.045, 16, 32), titaniumMat);
intakeLip.name = "IntakeLeadingEdgeLip";
intakeLip.position.z = 0.11;
intakeGroup.add(intakeLip);

const cowlingShell = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.33, 0.24, 32, 1, true), cowlingMat);
cowlingShell.name = "NacelleCowlingBarrel";
cowlingShell.rotation.x = Math.PI / 2;
intakeGroup.add(cowlingShell);
addLeaderCallout(intakeGroup, "Intake", -1, 0.28);

// 2. Sub-Assembly 2: Titanium Low-Pressure Fan Stage
const fanStageGroup = new THREE.Group();
fanStageGroup.name = "TitaniumFanStageAssembly";
fanStageGroup.position.set(0, 0, 0.24);
fanStageGroup.userData.xr = {
  explode: { distance: 0.20, direction: [0, 0, 1] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
engineRoot.add(fanStageGroup);

const spinnerCone = new THREE.Mesh(new THREE.ConeGeometry(0.095, 0.18, 24), titaniumMat);
spinnerCone.name = "AerodynamicSpinnerCone";
spinnerCone.rotation.x = Math.PI / 2;
spinnerCone.position.z = 0.09;
fanStageGroup.add(spinnerCone);

const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.10, 0.08, 24), titaniumMat);
fanHub.name = "TitaniumFanHubDisk";
fanHub.rotation.x = Math.PI / 2;
fanStageGroup.add(fanHub);

const bladeGeo = new THREE.BoxGeometry(0.04, 0.20, 0.008);
for (let i = 0; i < 18; i++) {
  const angle = (i / 18) * Math.PI * 2;
  const blade = new THREE.Mesh(bladeGeo, titaniumMat);
  blade.name = `TitaniumFanBlade_${i + 1}`;
  blade.position.set(Math.cos(angle) * 0.19, Math.sin(angle) * 0.19, 0);
  blade.rotation.z = angle - Math.PI / 2;
  blade.rotation.y = 0.42;
  fanStageGroup.add(blade);
}
addLeaderCallout(fanStageGroup, "FanStage", 1, 0.32);

// 3. Sub-Assembly 3: Multi-Stage High-Pressure Compressor
const compressorGroup = new THREE.Group();
compressorGroup.name = "HighPressureCompressorAssembly";
compressorGroup.position.set(0, 0, 0.0);
compressorGroup.userData.xr = {
  explode: { distance: 0.18, direction: [0, 1, 0] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
engineRoot.add(compressorGroup);

for (let s = 0; s < 4; s++) {
  const r = 0.23 - s * 0.018;
  const stageDisk = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.96, 0.042, 24), compressorGoldMat);
  stageDisk.name = `CompressorStageDisk_${s + 1}`;
  stageDisk.rotation.x = Math.PI / 2;
  stageDisk.position.z = 0.09 - s * 0.06;
  compressorGroup.add(stageDisk);

  const statorRing = new THREE.Mesh(new THREE.TorusGeometry(r + 0.01, 0.008, 10, 24), titaniumMat);
  statorRing.name = `CompressorStatorRing_${s + 1}`;
  statorRing.position.z = 0.09 - s * 0.06;
  compressorGroup.add(statorRing);
}
addLeaderCallout(compressorGroup, "Compressor", -1, 0.34);

// 4. Sub-Assembly 4: Annular Combustor Chamber
const combustorGroup = new THREE.Group();
combustorGroup.name = "AnnularCombustorAssembly";
combustorGroup.position.set(0, 0, -0.24);
combustorGroup.userData.xr = {
  explode: { distance: 0.20, direction: [0, 0, -1] },
  bloom: { strength: 0.7 }
};
engineRoot.add(combustorGroup);

const combustorCore = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.19, 0.20, 24), combustorMat);
combustorCore.name = "CombustorLinerChamber";
combustorCore.rotation.x = Math.PI / 2;
combustorGroup.add(combustorCore);

for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  const injector = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.05, 12), compressorGoldMat);
  injector.name = `FuelInjectorNozzle_${i + 1}`;
  injector.position.set(Math.cos(angle) * 0.195, Math.sin(angle) * 0.195, 0.02);
  injector.rotation.z = angle + Math.PI / 2;
  combustorGroup.add(injector);
}
addLeaderCallout(combustorGroup, "Combustor", 1, 0.30);

// 5. Sub-Assembly 5: Exhaust Nozzle & Acoustic Tailcone
const exhaustGroup = new THREE.Group();
exhaustGroup.name = "ExhaustNozzleAssembly";
exhaustGroup.position.set(0, 0, -0.50);
exhaustGroup.userData.xr = {
  explode: { distance: 0.38, direction: [0, 0, -1] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
engineRoot.add(exhaustGroup);

const nozzleShroud = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.26, 28, 1, true), nozzleMat);
nozzleShroud.name = "ExhaustNozzleOuterShroud";
nozzleShroud.rotation.x = Math.PI / 2;
exhaustGroup.add(nozzleShroud);

const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 24), titaniumMat);
tailCone.name = "ExhaustCenterbodyTailcone";
tailCone.rotation.x = -Math.PI / 2;
tailCone.position.z = -0.06;
exhaustGroup.add(tailCone);
addLeaderCallout(exhaustGroup, "ExhaustNozzle", -1, 0.26);

function animate(t) {
  fanStageGroup.rotation.z = t * 1.8;
  compressorGroup.rotation.z = -t * 1.2;
}

camera.position.set(1.95, 1.45, 1.85);
camera.lookAt(0, 0.72, 0);
