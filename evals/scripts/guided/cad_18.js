// 3-Blade Offshore Wind Turbine (3.5m tall scale) with Cutaway Nacelle on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.4);
sunLight.name = "sun_directional_light";
sunLight.position.set(4.0, 5.5, 4.5);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xb8d8ff, 0.65);
fillLight.name = "sky_fill_light";
fillLight.position.set(-3.5, 2.8, -3.0);
scene.add(fillLight);

const turbineGroup = new THREE.Group();
turbineGroup.name = "offshore_wind_turbine_cutaway";
scene.add(turbineGroup);

// Materials
const safetyYellowMat = new THREE.MeshStandardMaterial({
  color: 0xf5b800,
  metalness: 0.35,
  roughness: 0.38
});

const towerWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xedf1f5,
  metalness: 0.25,
  roughness: 0.32
});

const rotorSteelMat = new THREE.MeshStandardMaterial({
  color: 0xb8c2cc,
  metalness: 0.9,
  roughness: 0.2
});

const gearboxBlueMat = new THREE.MeshStandardMaterial({
  color: 0x1e5aa8,
  metalness: 0.65,
  roughness: 0.32
});

const generatorCopperMat = new THREE.MeshStandardMaterial({
  color: 0xc86d32,
  metalness: 0.85,
  roughness: 0.25
});

const darkFrameMat = new THREE.MeshStandardMaterial({
  color: 0x2c3238,
  metalness: 0.75,
  roughness: 0.4
});

// 1. Offshore Monopile Foundation & Yellow Transition Piece with Boat Landing (y = 0 to y = 0.65m)
const monopileBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.2, 0.22, 24),
  darkFrameMat
);
monopileBase.name = "seabed_monopile_foundation";
monopileBase.position.set(0, 0.11, 0);
turbineGroup.add(monopileBase);

const transitionPiece = new THREE.Mesh(
  new THREE.CylinderGeometry(0.165, 0.175, 0.42, 24),
  safetyYellowMat
);
transitionPiece.name = "yellow_monopile_transition_piece";
transitionPiece.position.set(0, 0.43, 0);
turbineGroup.add(transitionPiece);

const accessPlatform = new THREE.Mesh(
  new THREE.CylinderGeometry(0.26, 0.26, 0.025, 24),
  safetyYellowMat
);
accessPlatform.name = "transition_piece_service_platform";
accessPlatform.position.set(0, 0.58, 0);
turbineGroup.add(accessPlatform);

// Boat landing fender ladders on +Z face of transition piece
for (const side of [-0.08, 0.08]) {
  const fenderTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.014, 0.44, 12),
    safetyYellowMat
  );
  fenderTube.name = `boat_landing_fender_${side < 0 ? "port" : "stbd"}`;
  fenderTube.position.set(side, 0.42, 0.19);
  turbineGroup.add(fenderTube);
}

// 2. Tapered Tubular Steel Tower (y = 0.64m to y = 2.55m) & Yaw Ring Drive
const towerColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.105, 0.155, 1.92, 28),
  towerWhiteMat
);
towerColumn.name = "tapered_tubular_steel_tower";
towerColumn.position.set(0, 1.6, 0);
turbineGroup.add(towerColumn);

const yawRingDrive = new THREE.Mesh(
  new THREE.CylinderGeometry(0.125, 0.125, 0.06, 24),
  darkFrameMat
);
yawRingDrive.name = "yaw_ring_slewing_drive";
yawRingDrive.position.set(0, 2.58, 0);
turbineGroup.add(yawRingDrive);

// 3. Cutaway Top Nacelle Housing at y = 2.75m (CSG cutaway on +X side to expose internals, <= 24 segments)
const nacelleY = 2.76;
const nacelleGroup = new THREE.Group();
nacelleGroup.name = "cutaway_nacelle_assembly";
nacelleGroup.position.set(0, nacelleY, 0);
turbineGroup.add(nacelleGroup);

const outerNacelleRaw = new THREE.Mesh(
  new THREE.BoxGeometry(0.38, 0.34, 0.78),
  towerWhiteMat
);

const innerCavityRaw = new THREE.Mesh(
  new THREE.BoxGeometry(0.33, 0.29, 0.72),
  towerWhiteMat
);

// Cut away the +X side wall so internal drivetrain is clearly visible
const sideCutawayRaw = new THREE.Mesh(
  new THREE.BoxGeometry(0.24, 0.28, 0.66),
  towerWhiteMat
);
sideCutawayRaw.position.set(0.12, 0.01, -0.01);

const hollowNacelle = THREE.CSG.subtract(outerNacelleRaw, innerCavityRaw);
const cutawayNacelleShell = THREE.CSG.subtract(hollowNacelle, sideCutawayRaw);
cutawayNacelleShell.material = towerWhiteMat;
cutawayNacelleShell.name = "cutaway_nacelle_housing_shell";
nacelleGroup.add(cutawayNacelleShell);

// Internal Drivetrain Bedplate Frame
const bedplate = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.03, 0.68),
  darkFrameMat
);
bedplate.name = "nacelle_mainframe_bedplate";
bedplate.position.set(0, -0.12, 0);
nacelleGroup.add(bedplate);

// Main Rotor Shaft & Pillow Block Bearing (front z = +0.28 to +0.08)
const mainRotorShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.038, 0.045, 0.32, 20),
  rotorSteelMat
);
mainRotorShaft.name = "low_speed_main_rotor_shaft";
mainRotorShaft.rotation.x = Math.PI / 2;
mainRotorShaft.position.set(0, 0, 0.24);
nacelleGroup.add(mainRotorShaft);

const mainBearing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20),
  darkFrameMat
);
mainBearing.name = "main_shaft_bearing_housing";
mainBearing.rotation.x = Math.PI / 2;
mainBearing.position.set(0, 0, 0.24);
nacelleGroup.add(mainBearing);

// Planetary Gearbox (center z = +0.02)
const planetaryGearbox = new THREE.Mesh(
  new THREE.CylinderGeometry(0.105, 0.105, 0.2, 24),
  gearboxBlueMat
);
planetaryGearbox.name = "multi_stage_planetary_gearbox";
planetaryGearbox.rotation.x = Math.PI / 2;
planetaryGearbox.position.set(0, 0, 0.02);
nacelleGroup.add(planetaryGearbox);

// High-Speed Coupling Shaft & Generator with Copper Stator Windings (rear z = -0.22)
const highSpeedShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 0.14, 16),
  rotorSteelMat
);
highSpeedShaft.name = "high_speed_brake_shaft";
highSpeedShaft.rotation.x = Math.PI / 2;
highSpeedShaft.position.set(0, 0.02, -0.11);
nacelleGroup.add(highSpeedShaft);

const highSpeedGenerator = new THREE.Mesh(
  new THREE.CylinderGeometry(0.092, 0.092, 0.2, 24),
  generatorCopperMat
);
highSpeedGenerator.name = "high_speed_induction_generator";
highSpeedGenerator.rotation.x = Math.PI / 2;
highSpeedGenerator.position.set(0, 0.02, -0.23);
nacelleGroup.add(highSpeedGenerator);

// 4. Nose Cone Spinner & 3 Extruded Aerofoil Turbine Blades (reaching up to y = 3.55m)
const rotorHubGroup = new THREE.Group();
rotorHubGroup.name = "three_blade_rotor_hub";
rotorHubGroup.position.set(0, 0, 0.44);
nacelleGroup.add(rotorHubGroup);

const noseSpinner = new THREE.Mesh(
  new THREE.ConeGeometry(0.13, 0.26, 24),
  towerWhiteMat
);
noseSpinner.name = "aerodynamic_nose_cone_spinner";
noseSpinner.rotation.x = Math.PI / 2;
noseSpinner.position.set(0, 0, 0.06);
rotorHubGroup.add(noseSpinner);

// Extruded tapered aerofoil profile for the 3 blades (length = 0.82m)
const bladeProfile = new THREE.Shape();
bladeProfile.moveTo(0, -0.025);
bladeProfile.quadraticCurveTo(0.06, -0.028, 0.09, 0.18);
bladeProfile.lineTo(0.032, 0.82);
bladeProfile.lineTo(0.0, 0.82);
bladeProfile.quadraticCurveTo(-0.022, 0.35, 0, -0.025);

const bladeGeo = new THREE.ExtrudeGeometry(bladeProfile, {
  depth: 0.018,
  bevelEnabled: true,
  bevelThickness: 0.004,
  bevelSize: 0.004,
  bevelSegments: 2
});

for (let b = 0; b < 3; b++) {
  const bAngle = (b / 3) * Math.PI * 2 + 0.35;
  const bladeArm = new THREE.Group();
  bladeArm.name = `turbine_rotor_blade_arm_${b + 1}`;
  bladeArm.rotation.z = bAngle;
  rotorHubGroup.add(bladeArm);

  const pitchRoot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.038, 0.08, 16),
    rotorSteelMat
  );
  pitchRoot.name = `blade_pitch_bearing_root_${b + 1}`;
  pitchRoot.position.set(0, 0.1, 0);
  bladeArm.add(pitchRoot);

  const bladeMesh = new THREE.Mesh(bladeGeo, towerWhiteMat);
  bladeMesh.name = `aerofoil_composite_blade_${b + 1}`;
  bladeMesh.position.set(-0.02, 0.1, -0.01);
  bladeMesh.rotation.y = 0.25;
  bladeArm.add(bladeMesh);
}

// Frame camera on the +X cutaway side at ~2.2x bounding radius
camera.position.set(2.9, 2.25, 2.8);
camera.lookAt(0, 1.85, 0.1);
