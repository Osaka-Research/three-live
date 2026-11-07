// Tracked Construction Hydraulic Excavator (~2.0m long) with Articulated Boom, Stick & Bucket on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.4);
sunLight.name = "sun_directional_light";
sunLight.position.set(2.8, 4.0, 3.2);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xcce0ff, 0.6);
fillLight.name = "fill_directional_light";
fillLight.position.set(-2.5, 2.0, -2.0);
scene.add(fillLight);

const excavatorGroup = new THREE.Group();
excavatorGroup.name = "tracked_hydraulic_excavator";
scene.add(excavatorGroup);

// Materials
const constructionYellowMat = new THREE.MeshStandardMaterial({
  color: 0xf2a900,
  metalness: 0.28,
  roughness: 0.34
});

const darkUndercarriageMat = new THREE.MeshStandardMaterial({
  color: 0x24282e,
  metalness: 0.65,
  roughness: 0.52
});

const hydraulicChromeMat = new THREE.MeshStandardMaterial({
  color: 0xf0f5fa,
  metalness: 0.96,
  roughness: 0.08
});

const counterweightGreyMat = new THREE.MeshStandardMaterial({
  color: 0x353b42,
  metalness: 0.45,
  roughness: 0.48
});

const cabGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x1a2836,
  transmission: 0.72,
  ior: 1.5,
  thickness: 0.01,
  roughness: 0.08,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.82
});

// 1. Dual Caterpillar Track Frames Resting on y = 0 (z from -0.55 to +0.55)
const undercarriageGroup = new THREE.Group();
undercarriageGroup.name = "caterpillar_undercarriage";
excavatorGroup.add(undercarriageGroup);

for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "left" : "right";
  const tx = side * 0.38;

  // Main track frame beam
  const trackBeam = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.16, 0.92),
    darkUndercarriageMat
  );
  trackBeam.name = `track_roller_frame_${sideTag}`;
  trackBeam.position.set(tx, 0.11, -0.1);
  undercarriageGroup.add(trackBeam);

  // Front idler wheel & rear drive sprocket
  for (const wz of [-0.55, 0.35]) {
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.2, 24),
      darkUndercarriageMat
    );
    wheel.name = `track_wheel_${sideTag}_${wz < 0 ? "sprocket" : "idler"}`;
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(tx, 0.11, wz);
    undercarriageGroup.add(wheel);
  }

  // Upper and lower steel track belt runs resting at y = 0
  const lowerBelt = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.025, 0.94),
    darkUndercarriageMat
  );
  lowerBelt.name = `caterpillar_tread_bottom_${sideTag}`;
  lowerBelt.position.set(tx, 0.0125, -0.1);
  undercarriageGroup.add(lowerBelt);

  const upperBelt = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.025, 0.94),
    darkUndercarriageMat
  );
  upperBelt.name = `caterpillar_tread_top_${sideTag}`;
  upperBelt.position.set(tx, 0.21, -0.1);
  undercarriageGroup.add(upperBelt);
}

// H-frame crossbeam & central slewing ring turret
const crossCarbody = new THREE.Mesh(
  new THREE.BoxGeometry(0.62, 0.1, 0.48),
  darkUndercarriageMat
);
crossCarbody.name = "undercarriage_h_frame";
crossCarbody.position.set(0, 0.14, -0.1);
undercarriageGroup.add(crossCarbody);

const slewingTurret = new THREE.Mesh(
  new THREE.CylinderGeometry(0.26, 0.28, 0.08, 24),
  darkUndercarriageMat
);
slewingTurret.name = "slewing_bearing_turret";
slewingTurret.position.set(0, 0.22, -0.1);
undercarriageGroup.add(slewingTurret);

// 2. Rotating Upper House, Counterweight, Engine Hood & Operator Cab with Tinted Windows
const upperHouseGroup = new THREE.Group();
upperHouseGroup.name = "rotating_upper_house_assembly";
upperHouseGroup.position.set(0, 0.26, -0.1);
upperHouseGroup.rotation.y = 0.12;
excavatorGroup.add(upperHouseGroup);

const upperDeck = new THREE.Mesh(
  new THREE.BoxGeometry(0.84, 0.12, 0.96),
  constructionYellowMat
);
upperDeck.name = "upper_slewing_deck";
upperDeck.position.set(0, 0.06, -0.06);
upperHouseGroup.add(upperDeck);

const rearCounterweight = new THREE.Mesh(
  new THREE.BoxGeometry(0.84, 0.34, 0.24),
  counterweightGreyMat
);
rearCounterweight.name = "heavy_rear_counterweight";
rearCounterweight.position.set(0, 0.24, -0.44);
upperHouseGroup.add(rearCounterweight);

const engineBay = new THREE.Mesh(
  new THREE.BoxGeometry(0.48, 0.28, 0.52),
  constructionYellowMat
);
engineBay.name = "hydraulic_pump_engine_hood";
engineBay.position.set(-0.16, 0.26, -0.08);
upperHouseGroup.add(engineBay);

// Operator Cab on +X side with Tinted Glass Windows
const cabGroup = new THREE.Group();
cabGroup.name = "operator_cab_enclosure";
cabGroup.position.set(0.24, 0.12, 0.1);
upperHouseGroup.add(cabGroup);

const cabRoof = new THREE.Mesh(
  new THREE.BoxGeometry(0.34, 0.04, 0.48),
  darkUndercarriageMat
);
cabRoof.name = "cab_rops_roof";
cabRoof.position.set(0, 0.48, 0);
cabGroup.add(cabRoof);

const cabWindshield = new THREE.Mesh(
  new THREE.BoxGeometry(0.32, 0.44, 0.44),
  cabGlassMat
);
cabWindshield.name = "tinted_cab_windows";
cabWindshield.position.set(0, 0.24, 0);
cabGroup.add(cabWindshield);

// 3. Helper for Chrome Hydraulic Piston-and-Cylinder Actuator
function createHydraulicActuator(name, barrelLen, rodLen, radius) {
  const actGroup = new THREE.Group();
  actGroup.name = name;

  const cylinderBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, barrelLen, 16),
    darkUndercarriageMat
  );
  cylinderBarrel.name = `${name}_cylinder_barrel`;
  cylinderBarrel.position.y = barrelLen / 2;
  actGroup.add(cylinderBarrel);

  const chromePistonRod = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, rodLen, 16),
    hydraulicChromeMat
  );
  chromePistonRod.name = `${name}_chrome_piston_rod`;
  chromePistonRod.position.y = barrelLen + rodLen / 2 - 0.04;
  actGroup.add(chromePistonRod);

  return actGroup;
}

// 4. Three-Segment Articulated Arm (Boom -> Stick -> Toothed Digging Bucket)
// Segment 1: Curved Extruded Main Boom
const boomShape = new THREE.Shape();
boomShape.moveTo(0, -0.06);
boomShape.lineTo(0.45, 0.36);
boomShape.lineTo(0.88, 0.32);
boomShape.lineTo(0.88, 0.42);
boomShape.lineTo(0.42, 0.5);
boomShape.lineTo(-0.04, 0.06);
boomShape.closePath();

const boomGeo = new THREE.ExtrudeGeometry(boomShape, {
  depth: 0.12,
  bevelEnabled: true,
  bevelThickness: 0.008,
  bevelSize: 0.008,
  bevelSegments: 2
});
boomGeo.rotateY(-Math.PI / 2);
boomGeo.translate(0.06, 0, 0);

const boomGroup = new THREE.Group();
boomGroup.name = "articulated_main_boom";
boomGroup.position.set(-0.08, 0.22, 0.28);
upperHouseGroup.add(boomGroup);

const boomMesh = new THREE.Mesh(boomGeo, constructionYellowMat);
boomMesh.name = "extruded_steel_boom_arm";
boomGroup.add(boomMesh);

// Dual Boom Lift Hydraulic Cylinders flanking the boom base
for (const side of [-0.1, 0.1]) {
  const boomCyl = createHydraulicActuator(
    `boom_lift_hydraulic_${side < 0 ? "L" : "R"}`,
    0.26,
    0.22,
    0.026
  );
  boomCyl.position.set(side, -0.06, 0.08);
  boomCyl.rotation.x = 0.68;
  boomGroup.add(boomCyl);
}

// Crowd Hydraulic Cylinder on top of the Boom driving the Stick
const stickCylinder = createHydraulicActuator(
  "stick_crowd_hydraulic_actuator",
  0.34,
  0.26,
  0.028
);
stickCylinder.position.set(0, 0.48, 0.44);
stickCylinder.rotation.x = 1.48;
boomGroup.add(stickCylinder);

// Segment 2: Dipper Stick Arm pivoted at boom tip (y = 0.37, z = 0.86)
const stickGroup = new THREE.Group();
stickGroup.name = "articulated_dipper_stick";
stickGroup.position.set(0, 0.37, 0.86);
boomGroup.add(stickGroup);

const stickShape = new THREE.Shape();
stickShape.moveTo(-0.05, 0.16);
stickShape.lineTo(0.05, 0.16);
stickShape.lineTo(0.035, -0.56);
stickShape.lineTo(-0.035, -0.56);
stickShape.closePath();

const stickGeo = new THREE.ExtrudeGeometry(stickShape, {
  depth: 0.09,
  bevelEnabled: true,
  bevelThickness: 0.006,
  bevelSize: 0.006,
  bevelSegments: 2
});
stickGeo.translate(0, 0, -0.045);

const stickMesh = new THREE.Mesh(stickGeo, constructionYellowMat);
stickMesh.name = "dipper_stick_beam";
stickMesh.rotation.x = 0.38;
stickGroup.add(stickMesh);

// Bucket Curl Hydraulic Cylinder mounted on the front of the stick
const bucketCylinder = createHydraulicActuator(
  "bucket_curl_hydraulic_actuator",
  0.26,
  0.2,
  0.024
);
bucketCylinder.position.set(0, 0.08, 0.06);
bucketCylinder.rotation.x = 2.75;
stickGroup.add(bucketCylinder);

// Segment 3: Toothed Digging Bucket at the bottom of the stick
const bucketGroup = new THREE.Group();
bucketGroup.name = "toothed_digging_bucket";
bucketGroup.position.set(0, -0.52, -0.2);
bucketGroup.rotation.x = -0.35;
stickGroup.add(bucketGroup);

const bucketProfile = new THREE.Shape();
bucketProfile.moveTo(0, 0);
bucketProfile.quadraticCurveTo(0.18, -0.02, 0.2, -0.18);
bucketProfile.quadraticCurveTo(0.18, -0.32, 0.0, -0.28);
bucketProfile.lineTo(-0.02, -0.24);
bucketProfile.quadraticCurveTo(0.13, -0.26, 0.14, -0.16);
bucketProfile.quadraticCurveTo(0.13, -0.05, 0, -0.04);
bucketProfile.closePath();

const bucketShellGeo = new THREE.ExtrudeGeometry(bucketProfile, {
  depth: 0.28,
  bevelEnabled: true,
  bevelThickness: 0.006,
  bevelSize: 0.006,
  bevelSegments: 2
});
bucketShellGeo.rotateY(-Math.PI / 2);
bucketShellGeo.translate(0.14, 0, 0);

const bucketShell = new THREE.Mesh(bucketShellGeo, darkUndercarriageMat);
bucketShell.name = "excavator_bucket_scoop";
bucketGroup.add(bucketShell);

// 5 Forged Steel Digging Teeth along the bucket cutting lip
for (let t = 0; t < 5; t++) {
  const tx = -0.11 + t * 0.055;
  const tooth = new THREE.Mesh(
    new THREE.BoxGeometry(0.022, 0.016, 0.075),
    constructionYellowMat
  );
  tooth.name = `bucket_digging_tooth_${t + 1}`;
  tooth.position.set(tx, -0.265, -0.035);
  tooth.rotation.x = 0.25;
  bucketGroup.add(tooth);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(2.15, 1.35, 2.35);
camera.lookAt(0, 0.52, 0.18);
