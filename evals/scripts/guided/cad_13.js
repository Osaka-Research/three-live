// Precision CNC Machinist Milling Vise (~0.45m long) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e5, 1.35);
keyLight.name = "key_directional_light";
keyLight.position.set(1.2, 1.8, 1.5);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd0e2ff, 0.65);
fillLight.name = "fill_directional_light";
fillLight.position.set(-1.2, 1.1, -1.0);
scene.add(fillLight);

const viseGroup = new THREE.Group();
viseGroup.name = "cnc_machinist_milling_vise";
scene.add(viseGroup);

// Materials
const ductileIronMat = new THREE.MeshStandardMaterial({
  color: 0x2c4258,
  metalness: 0.65,
  roughness: 0.45
});

const precisionGroundSteelMat = new THREE.MeshStandardMaterial({
  color: 0xcfd6de,
  metalness: 0.92,
  roughness: 0.16
});

const hardenedJawMat = new THREE.MeshStandardMaterial({
  color: 0x3b4046,
  metalness: 0.85,
  roughness: 0.25
});

const aluminumWorkpieceMat = new THREE.MeshStandardMaterial({
  color: 0xe6ecf2,
  metalness: 0.95,
  roughness: 0.14
});

// 1. Slotted Swivel Base Resting on y = 0
const swivelRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.145, 0.155, 0.028, 32),
  ductileIronMat
);
swivelRing.name = "graduated_swivel_base_ring";
swivelRing.position.set(0, 0.014, 0);
viseGroup.add(swivelRing);

// Slotted hold-down ears on left and right of swivel base
for (const side of [-1, 1]) {
  const earRaw = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.024, 0.08),
    ductileIronMat
  );
  const slotCut = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.04, 0.024),
    ductileIronMat
  );
  slotCut.position.set(side * 0.01, 0, 0);

  const slottedEar = THREE.CSG.subtract(earRaw, slotCut);
  slottedEar.material = ductileIronMat;
  slottedEar.name = `base_hold_down_lug_${side < 0 ? "left" : "right"}`;
  slottedEar.position.set(side * 0.16, 0.012, 0);
  viseGroup.add(slottedEar);
}

// 2. Main Vise Bed with Central Leadscrew Channel (~0.42m long along Z)
const bedWaysLeft = new THREE.Mesh(
  new THREE.BoxGeometry(0.048, 0.046, 0.4),
  precisionGroundSteelMat
);
bedWaysLeft.name = "vise_bed_guideway_left";
bedWaysLeft.position.set(-0.056, 0.051, -0.01);
viseGroup.add(bedWaysLeft);

const bedWaysRight = new THREE.Mesh(
  new THREE.BoxGeometry(0.048, 0.046, 0.4),
  precisionGroundSteelMat
);
bedWaysRight.name = "vise_bed_guideway_right";
bedWaysRight.position.set(0.056, 0.051, -0.01);
viseGroup.add(bedWaysRight);

const bedBottomPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.016, 0.4),
  ductileIronMat
);
bedBottomPlate.name = "vise_bed_lower_web";
bedBottomPlate.position.set(0, 0.036, -0.01);
viseGroup.add(bedBottomPlate);

// 3. Fixed Rear Jaw Tower (z = -0.16) & Hardened Steel Jaw Plate
const fixedJawTower = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.072, 0.068),
  ductileIronMat
);
fixedJawTower.name = "fixed_rear_jaw_tower";
fixedJawTower.position.set(0, 0.11, -0.165);
viseGroup.add(fixedJawTower);

const fixedJawPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.052, 0.016),
  hardenedJawMat
);
fixedJawPlate.name = "fixed_hardened_steel_jaw_plate";
fixedJawPlate.position.set(0, 0.112, -0.123);
viseGroup.add(fixedJawPlate);

// 4. Sliding Movable Front Jaw (z = +0.02) & Hardened Steel Jaw Plate
const movableJawCarriage = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.068, 0.075),
  ductileIronMat
);
movableJawCarriage.name = "sliding_movable_jaw_carriage";
movableJawCarriage.position.set(0, 0.108, 0.045);
viseGroup.add(movableJawCarriage);

const movableJawPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.16, 0.052, 0.016),
  hardenedJawMat
);
movableJawPlate.name = "movable_hardened_steel_jaw_plate";
movableJawPlate.position.set(0, 0.112, -0.001);
viseGroup.add(movableJawPlate);

// Socket head cap screws on jaw plates
for (const sx of [-0.048, 0.048]) {
  const screwFixed = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12),
    precisionGroundSteelMat
  );
  screwFixed.name = `fixed_jaw_bolt_${sx < 0 ? "L" : "R"}`;
  screwFixed.rotation.x = Math.PI / 2;
  screwFixed.position.set(sx, 0.112, -0.114);
  viseGroup.add(screwFixed);
}

// 5. Machined Aluminum Workpiece Clamped Between Jaws with CSG Pocket Cutouts (<= 24 segments)
const rawStockBlock = new THREE.Mesh(
  new THREE.BoxGeometry(0.13, 0.056, 0.108),
  aluminumWorkpieceMat
);

const pocketCutBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.086, 0.032, 0.068),
  aluminumWorkpieceMat
);
pocketCutBox.position.set(0, 0.018, 0);

const centerBoreCut = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 0.07, 20),
  aluminumWorkpieceMat
);

const pocketedBlock = THREE.CSG.subtract(rawStockBlock, pocketCutBox);
const machinedWorkpiece = THREE.CSG.subtract(pocketedBlock, centerBoreCut);
machinedWorkpiece.material = aluminumWorkpieceMat;
machinedWorkpiece.name = "clamped_aluminum_cnc_workpiece";
machinedWorkpiece.position.set(0, 0.128, -0.062);
viseGroup.add(machinedWorkpiece);

// 6. Acme Leadscrew, Front Thrust Collar & Hex Drive Crank Handle
const acmeLeadscrew = new THREE.Mesh(
  new THREE.CylinderGeometry(0.015, 0.015, 0.34, 20),
  precisionGroundSteelMat
);
acmeLeadscrew.name = "acme_leadscrew_shaft";
acmeLeadscrew.rotation.x = Math.PI / 2;
acmeLeadscrew.position.set(0, 0.056, 0.06);
viseGroup.add(acmeLeadscrew);

const thrustCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.028, 0.03, 24),
  hardenedJawMat
);
thrustCollar.name = "leadscrew_thrust_collar";
thrustCollar.rotation.x = Math.PI / 2;
thrustCollar.position.set(0, 0.056, 0.205);
viseGroup.add(thrustCollar);

const hexDriveEnd = new THREE.Mesh(
  new THREE.CylinderGeometry(0.014, 0.014, 0.035, 6),
  precisionGroundSteelMat
);
hexDriveEnd.name = "hex_drive_spindle_end";
hexDriveEnd.rotation.x = Math.PI / 2;
hexDriveEnd.position.set(0, 0.056, 0.235);
viseGroup.add(hexDriveEnd);

// Crank Handle Assembly attached to hex drive
const crankGroup = new THREE.Group();
crankGroup.name = "hex_drive_crank_handle";
crankGroup.position.set(0, 0.056, 0.245);
viseGroup.add(crankGroup);

const crankSocket = new THREE.Mesh(
  new THREE.CylinderGeometry(0.02, 0.02, 0.036, 16),
  precisionGroundSteelMat
);
crankSocket.name = "crank_hex_socket_hub";
crankSocket.rotation.x = Math.PI / 2;
crankGroup.add(crankSocket);

const crankArm = new THREE.Mesh(
  new THREE.BoxGeometry(0.018, 0.11, 0.014),
  precisionGroundSteelMat
);
crankArm.name = "crank_lever_arm";
crankArm.position.set(0.032, 0.04, 0.008);
crankArm.rotation.z = -0.65;
crankGroup.add(crankArm);

const rotatingGrip = new THREE.Mesh(
  new THREE.CylinderGeometry(0.011, 0.011, 0.065, 16),
  hardenedJawMat
);
rotatingGrip.name = "crank_revolving_hand_grip";
rotatingGrip.rotation.x = Math.PI / 2;
rotatingGrip.position.set(0.064, 0.078, 0.042);
crankGroup.add(rotatingGrip);

// Frame camera at ~2.2x bounding radius
camera.position.set(0.45, 0.36, 0.56);
camera.lookAt(0, 0.09, 0.02);
