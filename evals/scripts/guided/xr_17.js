// EV Skateboard Chassis & Battery Pack Teardown (xr_17)
scene.background = new THREE.Color(0x0b1120);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const shopKeyLight = new THREE.DirectionalLight(0xf8fafc, 1.25);
shopKeyLight.name = "WorkshopKeyLight";
shopKeyLight.position.set(3.0, 4.5, 3.5);
scene.add(shopKeyLight);

const thermalRimLight = new THREE.DirectionalLight(0xf97316, 0.65);
thermalRimLight.name = "ThermalHighlightRimLight";
thermalRimLight.position.set(-2.5, 2.5, -2.0);
scene.add(thermalRimLight);

// Materials
const aluminumChassisMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.88, roughness: 0.22 });
const darkSubframeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.35 });
const tireRubberMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.88, metalness: 0.05 });
const motorCopperMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.85, roughness: 0.25 });
const coolingPlateCyanMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.7, roughness: 0.25 });
const lithiumCellGoldMat = new THREE.MeshStandardMaterial({
  color: 0xf59e0b,
  emissive: 0xd97706,
  emissiveIntensity: 0.35,
  metalness: 0.8,
  roughness: 0.2
});

// EV Skateboard Chassis Root Assembly (resting on lift blocks at y = 0)
const evChassis = new THREE.Group();
evChassis.name = "EVSkateboardChassis";
evChassis.userData.xr = {
  anchor: "Floor",
  grab: "2-hand",
  handles: { rotateAxis: "y", minScale: 0.5, maxScale: 2.0 },
  dimensions: { unit: "mm", axes: ["x", "y", "z"] }
};
scene.add(evChassis);

// Workshop Lift Support Blocks on Ground (y = 0 to y = 0.24)
[
  [-0.55, 0.12, -0.32],
  [0.55, 0.12, -0.32],
  [-0.55, 0.12, 0.32],
  [0.55, 0.12, 0.32]
].forEach((pt, idx) => {
  const liftPillar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.12), darkSubframeMat);
  liftPillar.name = `ChassisLiftStandBlock_${idx + 1}`;
  liftPillar.position.set(pt[0], pt[1], pt[2]);
  evChassis.add(liftPillar);
});

// Extruded Aluminum Perimeter Frame Rails
[-0.44, 0.44].forEach((zRail, idx) => {
  const sideRail = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.10, 0.08), aluminumChassisMat);
  sideRail.name = `AluminumChassisSideRail_${idx + 1}`;
  sideRail.position.set(0, 0.32, zRail);
  evChassis.add(sideRail);
});

// Dual Front & Rear Electric Drive Motors & Subframes
[-0.78, 0.78].forEach((xAxle, idx) => {
  const axleTag = idx === 0 ? "Front" : "Rear";

  const driveMotor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.34, 24),
    motorCopperMat
  );
  driveMotor.name = `${axleTag}ElectricDriveMotor`;
  driveMotor.rotation.x = Math.PI / 2;
  driveMotor.position.set(xAxle, 0.33, 0);
  driveMotor.userData.xr = {
    outline: { color: "#f97316", thickness: 0.012 }
  };
  evChassis.add(driveMotor);

  const halfShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.024, 1.12, 16),
    aluminumChassisMat
  );
  halfShaft.name = `${axleTag}DriveAxleHalfShaft`;
  halfShaft.rotation.x = Math.PI / 2;
  halfShaft.position.set(xAxle, 0.33, 0);
  evChassis.add(halfShaft);

  // Double-Wishbone Suspension Arms & Wheels on Left/Right Corners
  [-0.58, 0.58].forEach((zWheel, wIdx) => {
    const cornerTag = `${axleTag}_${wIdx === 0 ? "Left" : "Right"}`;

    const controlArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.03, 0.28),
      aluminumChassisMat
    );
    controlArm.name = `SuspensionControlArm_${cornerTag}`;
    controlArm.position.set(xAxle, 0.29, zWheel * 0.76);
    evChassis.add(controlArm);

    const coilStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.032, 0.24, 14),
      darkSubframeMat
    );
    coilStrut.name = `CoiloverDamperStrut_${cornerTag}`;
    coilStrut.position.set(xAxle, 0.42, zWheel * 0.74);
    evChassis.add(coilStrut);

    const tireTorus = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.085, 16, 28),
      tireRubberMat
    );
    tireTorus.name = `EVWheelTire_${cornerTag}`;
    tireTorus.position.set(xAxle, 0.33, zWheel);
    evChassis.add(tireTorus);

    const alloyRim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.15, 0.12, 20),
      aluminumChassisMat
    );
    alloyRim.name = `EVAlloyWheelRim_${cornerTag}`;
    alloyRim.rotation.x = Math.PI / 2;
    alloyRim.position.set(xAxle, 0.33, zWheel);
    evChassis.add(alloyRim);
  });
});

// 4-Layer Structural Battery Pack Stack with `explode` & Thermal `outline` Highlights
// Layer 1: Underbody Ballistic Armor Skid Plate
const layer1SkidPlate = new THREE.Mesh(
  new THREE.BoxGeometry(1.16, 0.022, 0.78),
  aluminumChassisMat
);
layer1SkidPlate.name = "BatteryLayer1_ArmorSkidPlate";
layer1SkidPlate.position.set(0, 0.26, 0);
layer1SkidPlate.userData.xr = {
  explode: { distance: 0.16, direction: [0, -1, 0] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
evChassis.add(layer1SkidPlate);

// Layer 2: Active Liquid Glycol Ribbon Cold Plate
const layer2CoolingPlate = new THREE.Mesh(
  new THREE.BoxGeometry(1.12, 0.024, 0.74),
  coolingPlateCyanMat
);
layer2CoolingPlate.name = "BatteryLayer2_LiquidCoolingPlate";
layer2CoolingPlate.position.set(0, 0.30, 0);
layer2CoolingPlate.userData.xr = {
  explode: { distance: 0.10, direction: [0, 1, 0] },
  outline: { color: "#0ea5e9", thickness: 0.012 }
};
evChassis.add(layer2CoolingPlate);

// Layer 3: High-Voltage Lithium-Ion Cell Module Array (Thermal Highlighted)
const layer3CellPack = new THREE.Group();
layer3CellPack.name = "BatteryLayer3_LithiumCellModules";
layer3CellPack.position.set(0, 0.36, 0);
layer3CellPack.userData.xr = {
  explode: { distance: 0.24, direction: [0, 1, 0] },
  outline: { color: "#f97316", thickness: 0.016 }
};
evChassis.add(layer3CellPack);

for (let m = 0; m < 4; m++) {
  const cellModule = new THREE.Mesh(
    new THREE.BoxGeometry(0.25, 0.065, 0.70),
    lithiumCellGoldMat
  );
  cellModule.name = `HighVoltageBatteryModule_${m + 1}`;
  cellModule.position.set(-0.405 + m * 0.27, 0, 0);
  layer3CellPack.add(cellModule);
}

// Layer 4: Upper Composite Fireproof Enclosure Cover
const layer4TopCover = new THREE.Mesh(
  new THREE.BoxGeometry(1.16, 0.025, 0.78),
  darkSubframeMat
);
layer4TopCover.name = "BatteryLayer4_CompositeTopCover";
layer4TopCover.position.set(0, 0.42, 0);
layer4TopCover.userData.xr = {
  explode: { distance: 0.38, direction: [0, 1, 0] },
  outline: { color: "#facc15", thickness: 0.012 }
};
evChassis.add(layer4TopCover);

camera.position.set(1.95, 1.35, 2.05);
camera.lookAt(0, 0.35, 0);
