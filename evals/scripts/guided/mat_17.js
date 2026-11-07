// mat_17: Carbon-Fiber & Anodized Titanium Racing Quadcopter
const root = new THREE.Group();
root.name = "FPVRacingQuadcopterRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "QuadcopterAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyDirLight.name = "QuadcopterKeyLight";
keyDirLight.position.set(1.0, 1.8, 1.4);
scene.add(keyDirLight);

const accentRimLight = new THREE.PointLight(0x88ccff, 1.5, 2.0);
accentRimLight.name = "QuadcopterRimPointLight";
accentRimLight.position.set(-0.4, 0.35, -0.4);
scene.add(accentRimLight);

// Procedural Carbon-Fiber Twill Weave DataTexture (64x64 RGBA)
const cfSize = 64;
const cfData = new Uint8Array(cfSize * cfSize * 4);
for (let y = 0; y < cfSize; y++) {
  for (let x = 0; x < cfSize; x++) {
    const idx = (y * cfSize + x) * 4;
    // 2x2 diagonal twill weave pattern
    const diag = (x + y) % 8;
    const isWarp = diag < 4;
    const fiberShade = isWarp
      ? 26 + ((x % 4) * 5)
      : 42 + ((y % 4) * 6);
    cfData[idx + 0] = fiberShade;
    cfData[idx + 1] = fiberShade + 2;
    cfData[idx + 2] = fiberShade + 5;
    cfData[idx + 3] = 255;
  }
}
const carbonWeaveTex = new THREE.DataTexture(cfData, cfSize, cfSize, THREE.RGBAFormat);
carbonWeaveTex.wrapS = THREE.RepeatWrapping;
carbonWeaveTex.wrapT = THREE.RepeatWrapping;
carbonWeaveTex.needsUpdate = true;

// Materials
const carbonFiberMat = new THREE.MeshPhysicalMaterial({
  color: 0xcccccc,
  map: carbonWeaveTex,
  roughness: 0.35,
  metalness: 0.25,
  clearcoat: 0.45,
  clearcoatRoughness: 0.25
});

const anodizedMotorBellMat = new THREE.MeshPhysicalMaterial({
  color: 0xd49b2a,
  metalness: 0.96,
  roughness: 0.14,
  iridescence: 1.0,
  iridescenceIOR: 1.68,
  clearcoat: 0.85,
  clearcoatRoughness: 0.08
});

const anodizedStatorPurpleMat = new THREE.MeshPhysicalMaterial({
  color: 0x7c2ae8,
  metalness: 0.92,
  roughness: 0.18,
  iridescence: 0.9,
  iridescenceIOR: 1.45
});

const polycarbonatePropMat = new THREE.MeshPhysicalMaterial({
  color: 0x00d8ff,
  roughness: 0.08,
  metalness: 0.0,
  transmission: 0.86,
  ior: 1.58,
  thickness: 0.008,
  attenuationColor: 0x0077aa,
  attenuationDistance: 0.06,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03
});

const lipoPackMat = new THREE.MeshStandardMaterial({
  color: 0x20242b,
  roughness: 0.4,
  metalness: 0.15
});

const lipoStrapMat = new THREE.MeshStandardMaterial({
  color: 0xff5500,
  roughness: 0.7,
  metalness: 0.05
});

const cameraGlassLensMat = new THREE.MeshPhysicalMaterial({
  color: 0x112244,
  roughness: 0.02,
  metalness: 0.1,
  transmission: 0.7,
  ior: 1.7,
  iridescence: 0.9,
  iridescenceIOR: 1.5,
  clearcoat: 1.0
});

const foamPadMat = new THREE.MeshStandardMaterial({
  color: 0x15171a,
  roughness: 0.9
});

// 1. Matte Weave Carbon-Fiber X-Frame (Span ~0.50m across diagonal, grounded on landing pads at y = 0)
const frameGroup = new THREE.Group();
frameGroup.name = "CarbonFiberXFrameGroup";
root.add(frameGroup);

const frameElevation = 0.042; // bottom plate height above ground

// Bottom & Top central fuselage plates
const bottomPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.085, 0.004, 0.19),
  carbonFiberMat
);
bottomPlate.name = "CarbonBottomMainPlate";
bottomPlate.position.set(0, frameElevation, 0);
frameGroup.add(bottomPlate);

const topPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.072, 0.0035, 0.165),
  carbonFiberMat
);
topPlate.name = "CarbonTopDeckPlate";
topPlate.position.set(0, frameElevation + 0.034, 0);
frameGroup.add(topPlate);

// 8 Anodized Aluminum Standoff Pillars connecting bottom and top plates
const standoffCoords = [
  [-0.03, -0.07], [0.03, -0.07],
  [-0.032, -0.02], [0.032, -0.02],
  [-0.032, 0.03], [0.032, 0.03],
  [-0.026, 0.07], [0.026, 0.07]
];
for (let i = 0; i < standoffCoords.length; i++) {
  const post = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0035, 0.0035, 0.034, 10),
    anodizedStatorPurpleMat
  );
  post.name = "AnodizedFrameStandoff_" + i;
  post.position.set(standoffCoords[i][0], frameElevation + 0.017, standoffCoords[i][1]);
  frameGroup.add(post);
}

// Internal Flight Controller & 4-in-1 ESC Stack inside fuselage
const escBoard = new THREE.Mesh(
  new THREE.BoxGeometry(0.044, 0.005, 0.044),
  anodizedStatorPurpleMat
);
escBoard.name = "FourInOneESCBoard";
escBoard.position.set(0, frameElevation + 0.011, 0);
frameGroup.add(escBoard);

const fcBoard = new THREE.Mesh(
  new THREE.BoxGeometry(0.040, 0.005, 0.040),
  anodizedMotorBellMat
);
fcBoard.name = "FlightControllerBoard";
fcBoard.position.set(0, frameElevation + 0.021, 0);
frameGroup.add(fcBoard);

// 2D Airfoil Blade Shape for Polycarbonate Tri-Blade Propellers (extruded via ExtrudeGeometry)
const bladeShape = new THREE.Shape();
bladeShape.moveTo(0.008, -0.003);
bladeShape.quadraticCurveTo(0.048, -0.013, 0.088, -0.005);
bladeShape.quadraticCurveTo(0.095, 0.000, 0.088, 0.006);
bladeShape.quadraticCurveTo(0.045, 0.011, 0.008, 0.004);
bladeShape.closePath();

const propBladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
  depth: 0.0018,
  bevelEnabled: false
});

// 4 Carbon-Fiber Arms + Landing Skids + Iridescent Gold/Purple Anodized Motors + Tri-Blade Propellers
const armAngles = [Math.PI * 0.25, Math.PI * 0.75, -Math.PI * 0.75, -Math.PI * 0.25];
const motorDist = 0.165; // Diagonal motor-to-motor span = 0.33m + 0.19m props = ~0.52m total span

for (let m = 0; m < 4; m++) {
  const angle = armAngles[m];
  const mx = Math.cos(angle) * motorDist;
  const mz = Math.sin(angle) * motorDist;

  // Carbon-fiber arm strut from center to motor mount
  const armMesh = new THREE.Mesh(
    new THREE.BoxGeometry(motorDist, 0.006, 0.022),
    carbonFiberMat
  );
  armMesh.name = "CarbonFiberXArm_" + m;
  armMesh.rotation.y = -angle;
  armMesh.position.set(mx * 0.5, frameElevation - 0.002, mz * 0.5);
  frameGroup.add(armMesh);

  // Circular carbon motor mount pad at arm tip
  const motorPad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.006, 20),
    carbonFiberMat
  );
  motorPad.name = "CarbonMotorMountPad_" + m;
  motorPad.position.set(mx, frameElevation - 0.002, mz);
  frameGroup.add(motorPad);

  // EVA Foam Landing Foot Skid under each motor arm (resting at y = 0)
  const landingSkid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.016, frameElevation - 0.004, 16),
    foamPadMat
  );
  landingSkid.name = "LandingGearSkidFoot_" + m;
  landingSkid.position.set(mx, (frameElevation - 0.004) * 0.5, mz);
  frameGroup.add(landingSkid);

  // Iridescent Gold/Purple Anodized Brushless Motor Assembly
  const motorGroup = new THREE.Group();
  motorGroup.name = "AnodizedBrushlessMotorGroup_" + m;
  motorGroup.position.set(mx, frameElevation + 0.001, mz);
  root.add(motorGroup);

  const motorBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.017, 0.018, 0.006, 20),
    anodizedStatorPurpleMat
  );
  motorBase.name = "MotorStatorBase_" + m;
  motorBase.position.set(0, 0.003, 0);
  motorGroup.add(motorBase);

  const motorBell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0185, 0.019, 0.016, 24),
    anodizedMotorBellMat
  );
  motorBell.name = "IridescentAnodizedMotorBell_" + m;
  motorBell.position.set(0, 0.014, 0);
  motorGroup.add(motorBell);

  // Polycarbonate Tri-Blade Propeller on top of motor bell
  const propGroup = new THREE.Group();
  propGroup.name = "TriBladePropellerGroup_" + m;
  propGroup.position.set(0, 0.024, 0);
  propGroup.rotation.y = m * 0.5;
  motorGroup.add(propGroup);

  const propHub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.008, 16),
    polycarbonatePropMat
  );
  propHub.name = "PolycarbonatePropHub_" + m;
  propGroup.add(propHub);

  const lockNut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.006, 0.009, 6),
    anodizedMotorBellMat
  );
  lockNut.name = "AnodizedPropLockNut_" + m;
  lockNut.position.set(0, 0.006, 0);
  propGroup.add(lockNut);

  for (let b = 0; b < 3; b++) {
    const bAngle = (b / 3) * Math.PI * 2;
    const bladeHolder = new THREE.Group();
    bladeHolder.name = "PropBladePitchPivot_" + m + "_" + b;
    bladeHolder.rotation.y = bAngle;
    propGroup.add(bladeHolder);

    const bladeMesh = new THREE.Mesh(propBladeGeo, polycarbonatePropMat);
    bladeMesh.name = "PolycarbonatePropBlade_" + m + "_" + b;
    bladeMesh.rotation.x = Math.PI / 2 - 0.24; // Pitched airfoil angle
    bladeHolder.add(bladeMesh);
  }
}

// 2. Tilted FPV Camera Pod at the Front Nose (z = +0.068)
const cameraPodGroup = new THREE.Group();
cameraPodGroup.name = "TiltedFPVCameraPodGroup";
cameraPodGroup.position.set(0, frameElevation + 0.018, 0.068);
cameraPodGroup.rotation.x = -0.52; // 30-degree aggressive racing uptilt
root.add(cameraPodGroup);

const camHousing = new THREE.Mesh(
  new THREE.BoxGeometry(0.026, 0.026, 0.022),
  lipoPackMat
);
camHousing.name = "FPVCameraBodyBox";
cameraPodGroup.add(camHousing);

const camBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.011, 0.012, 0.016, 20),
  anodizedMotorBellMat
);
camBarrel.name = "FPVCameraLensBarrel";
camBarrel.rotation.x = Math.PI / 2;
camBarrel.position.set(0, 0, 0.016);
cameraPodGroup.add(camBarrel);

const camGlass = new THREE.Mesh(
  new THREE.SphereGeometry(0.010, 20, 14),
  cameraGlassLensMat
);
camGlass.name = "FPVCameraGlassElement";
camGlass.scale.set(1.0, 1.0, 0.45);
camGlass.position.set(0, 0, 0.023);
cameraPodGroup.add(camGlass);

// 3. Top-Mounted 6S LiPo Battery Pack & Strap + Rear VTX Antenna
const batteryGroup = new THREE.Group();
batteryGroup.name = "LiPoBatteryPackGroup";
batteryGroup.position.set(0, frameElevation + 0.036, -0.008);
root.add(batteryGroup);

const lipoBlock = new THREE.Mesh(
  new THREE.BoxGeometry(0.044, 0.036, 0.088),
  lipoPackMat
);
lipoBlock.name = "SixSLiPoBatteryCellPack";
lipoBlock.position.set(0, 0.018, 0);
batteryGroup.add(lipoBlock);

const lipoStrap = new THREE.Mesh(
  new THREE.BoxGeometry(0.048, 0.040, 0.022),
  lipoStrapMat
);
lipoStrap.name = "VelcroBatteryStrap";
lipoStrap.position.set(0, 0.018, 0);
batteryGroup.add(lipoStrap);

// Rear VTX Lollipop Antenna stalk
const vtxStalk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0025, 0.0025, 0.065, 10),
  lipoPackMat
);
vtxStalk.name = "VTXAntennaStalk";
vtxStalk.rotation.x = -0.45;
vtxStalk.position.set(0, frameElevation + 0.055, -0.092);
root.add(vtxStalk);

const vtxPod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.009, 0.009, 0.018, 16),
  anodizedStatorPurpleMat
);
vtxPod.name = "VTXAntennaRadome";
vtxPod.rotation.x = -0.45;
vtxPod.position.set(0, frameElevation + 0.084, -0.106);
root.add(vtxPod);

// Camera framing (~0.52m span -> distance ~0.68m)
camera.position.set(0.28, 0.34, 0.56);
camera.lookAt(0, 0.06, 0);
