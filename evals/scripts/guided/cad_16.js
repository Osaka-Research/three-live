// Sunburst Hollow-Body Archtop Electric Guitar on a Floor Stand (y = 0)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e0, 1.4);
keyLight.name = "key_directional_light";
keyLight.position.set(1.5, 2.2, 1.8);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd8e8ff, 0.6);
fillLight.name = "fill_directional_light";
fillLight.position.set(-1.5, 1.5, -1.2);
scene.add(fillLight);

const guitarSceneGroup = new THREE.Group();
guitarSceneGroup.name = "archtop_guitar_and_stand";
scene.add(guitarSceneGroup);

// Materials
const sunburstBodyMat = new THREE.MeshStandardMaterial({
  color: 0xb83818,
  metalness: 0.18,
  roughness: 0.22
});

const amberCenterBurstMat = new THREE.MeshStandardMaterial({
  color: 0xe89624,
  metalness: 0.14,
  roughness: 0.18
});

const creamBindingMat = new THREE.MeshStandardMaterial({
  color: 0xf5ecd8,
  metalness: 0.05,
  roughness: 0.3
});

const mapleNeckMat = new THREE.MeshStandardMaterial({
  color: 0xd9a86c,
  metalness: 0.05,
  roughness: 0.35
});

const rosewoodFretboardMat = new THREE.MeshStandardMaterial({
  color: 0x3b2216,
  metalness: 0.08,
  roughness: 0.38
});

const pearloidInlayMat = new THREE.MeshStandardMaterial({
  color: 0xf4f2eb,
  metalness: 0.35,
  roughness: 0.15
});

const chromeHardwareMat = new THREE.MeshStandardMaterial({
  color: 0xe6ecf2,
  metalness: 0.94,
  roughness: 0.12
});

const blackStandMat = new THREE.MeshStandardMaterial({
  color: 0x1c1e22,
  metalness: 0.5,
  roughness: 0.48
});

// 1. Tubular Tripod Floor Stand on y = 0
const standGroup = new THREE.Group();
standGroup.name = "tubular_guitar_floor_stand";
guitarSceneGroup.add(standGroup);

for (let i = 0; i < 3; i++) {
  const legAng = (i / 3) * Math.PI * 2 + Math.PI / 6;
  const tripodLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.011, 0.28, 12),
    blackStandMat
  );
  tripodLeg.name = `stand_tripod_leg_${i + 1}`;
  tripodLeg.position.set(Math.cos(legAng) * 0.12, 0.07, Math.sin(legAng) * 0.12 - 0.05);
  tripodLeg.rotation.z = Math.cos(legAng) * 1.05;
  tripodLeg.rotation.x = -Math.sin(legAng) * 1.05;
  standGroup.add(tripodLeg);
}

const standPost = new THREE.Mesh(
  new THREE.CylinderGeometry(0.013, 0.015, 0.68, 16),
  blackStandMat
);
standPost.name = "stand_vertical_mast";
standPost.position.set(0, 0.42, -0.05);
standGroup.add(standPost);

const lowerCradle = new THREE.Mesh(
  new THREE.BoxGeometry(0.24, 0.02, 0.12),
  blackStandMat
);
lowerCradle.name = "stand_lower_body_cradle";
lowerCradle.position.set(0, 0.11, 0.01);
standGroup.add(lowerCradle);

const neckYoke = new THREE.Mesh(
  new THREE.BoxGeometry(0.08, 0.02, 0.09),
  blackStandMat
);
neckYoke.name = "stand_upper_neck_yoke";
neckYoke.position.set(0, 0.74, -0.01);
standGroup.add(neckYoke);

// 2. Hollow-Body Archtop Guitar Assembly (tilted slightly back on the stand)
const guitarGroup = new THREE.Group();
guitarGroup.name = "sunburst_hollow_body_guitar";
guitarGroup.position.set(0, 0.34, 0.02);
guitarGroup.rotation.x = -0.14;
guitarSceneGroup.add(guitarGroup);

// Figure-8 Archtop Body Profile with F-Hole Cutouts via THREE.Shape + ExtrudeGeometry
const bodyShape = new THREE.Shape();
bodyShape.moveTo(0, -0.22); // Bottom bout center
// Right lower bout -> waist -> single cutaway horn
bodyShape.bezierCurveTo(0.16, -0.22, 0.21, -0.12, 0.19, -0.02);
bodyShape.bezierCurveTo(0.17, 0.05, 0.11, 0.06, 0.12, 0.11);
bodyShape.bezierCurveTo(0.13, 0.16, 0.16, 0.21, 0.12, 0.23);
bodyShape.bezierCurveTo(0.09, 0.24, 0.07, 0.17, 0.04, 0.17);
// Neck heel across to left upper bout -> waist -> left lower bout
bodyShape.lineTo(-0.04, 0.17);
bodyShape.bezierCurveTo(-0.1, 0.22, -0.16, 0.19, -0.16, 0.11);
bodyShape.bezierCurveTo(-0.16, 0.05, -0.11, 0.04, -0.19, -0.02);
bodyShape.bezierCurveTo(-0.21, -0.12, -0.16, -0.22, 0, -0.22);

// Two classic F-Hole cutouts on left and right bouts
for (const side of [-1, 1]) {
  const fHole = new THREE.Path();
  const fx = side * 0.115;
  fHole.moveTo(fx - 0.008, -0.09);
  fHole.quadraticCurveTo(fx + side * 0.018, -0.02, fx - 0.004, 0.05);
  fHole.lineTo(fx + 0.006, 0.05);
  fHole.quadraticCurveTo(fx + side * 0.028, -0.02, fx + 0.004, -0.09);
  fHole.closePath();
  bodyShape.holes.push(fHole);
}

const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
  depth: 0.052,
  bevelEnabled: true,
  bevelThickness: 0.006,
  bevelSize: 0.006,
  bevelSegments: 2
});
bodyGeo.translate(0, 0, -0.026);

const guitarBodyMesh = new THREE.Mesh(bodyGeo, sunburstBodyMat);
guitarBodyMesh.name = "figure8_archtop_body_with_f_holes";
guitarGroup.add(guitarBodyMesh);

// Warm amber sunburst center arch oval
const centerBurst = new THREE.Mesh(
  new THREE.CylinderGeometry(0.095, 0.105, 0.06, 24),
  amberCenterBurstMat
);
centerBurst.name = "sunburst_amber_center_arch";
centerBurst.rotation.x = Math.PI / 2;
centerBurst.scale.set(0.85, 1.0, 1.35);
centerBurst.position.set(0, -0.02, 0.004);
guitarGroup.add(centerBurst);

// 3. Maple Neck, Rosewood Fretboard with 22 Frets & Pearloid Block Inlays
const neckLength = 0.46;
const neckBaseY = 0.16;

const mapleNeck = new THREE.Mesh(
  new THREE.BoxGeometry(0.044, neckLength, 0.02),
  mapleNeckMat
);
mapleNeck.name = "maple_guitar_neck";
mapleNeck.position.set(0, neckBaseY + neckLength / 2, 0.015);
guitarGroup.add(mapleNeck);

const fretboard = new THREE.Mesh(
  new THREE.BoxGeometry(0.046, neckLength + 0.04, 0.006),
  rosewoodFretboardMat
);
fretboard.name = "rosewood_fretboard";
fretboard.position.set(0, neckBaseY + neckLength / 2 - 0.015, 0.028);
guitarGroup.add(fretboard);

// 22 Nickel Fret Wires & Fretboard Block Inlays (at frets 3, 5, 7, 9, 12, 15, 17)
const inlayFrets = new Set([3, 5, 7, 9, 12, 15, 17]);
for (let f = 1; f <= 22; f++) {
  const fretFrac = 1 - Math.pow(2, -f / 12) * 1.45; // Logarithmic fret spacing
  const fy = (neckBaseY + neckLength + 0.005) - (f / 22) * (neckLength + 0.02);

  const fretWire = new THREE.Mesh(
    new THREE.BoxGeometry(0.046, 0.0018, 0.0025),
    chromeHardwareMat
  );
  fretWire.name = `fret_wire_${f}`;
  fretWire.position.set(0, fy, 0.032);
  guitarGroup.add(fretWire);

  if (inlayFrets.has(f)) {
    const inlay = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.009, 0.0015),
      pearloidInlayMat
    );
    inlay.name = `fretboard_pearl_inlay_fret_${f}`;
    inlay.position.set(0, fy + 0.009, 0.0315);
    guitarGroup.add(inlay);
  }
}

// 4. Angled Headstock with 6 Tuning Pegs (3x3 layout)
const headstockGroup = new THREE.Group();
headstockGroup.name = "guitar_headstock_group";
headstockGroup.position.set(0, neckBaseY + neckLength, 0.02);
headstockGroup.rotation.x = -0.18;
guitarGroup.add(headstockGroup);

const headstockPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.068, 0.135, 0.014),
  sunburstBodyMat
);
headstockPlate.name = "headstock_plate";
headstockPlate.position.set(0, 0.068, 0);
headstockGroup.add(headstockPlate);

for (let side of [-1, 1]) {
  for (let row = 0; row < 3; row++) {
    const pegNum = (side < 0 ? 0 : 3) + row + 1;
    const py = 0.032 + row * 0.034;

    const tuningPost = new THREE.Mesh(
      new THREE.CylinderGeometry(0.003, 0.003, 0.022, 10),
      chromeHardwareMat
    );
    tuningPost.name = `tuning_post_${pegNum}`;
    tuningPost.rotation.x = Math.PI / 2;
    tuningPost.position.set(side * 0.022, py, 0.008);
    headstockGroup.add(tuningPost);

    const tunerKey = new THREE.Mesh(
      new THREE.BoxGeometry(0.018, 0.012, 0.005),
      pearloidInlayMat
    );
    tunerKey.name = `tuning_peg_button_${pegNum}`;
    tunerKey.position.set(side * 0.044, py, 0);
    headstockGroup.add(tunerKey);
  }
}

// 5. Dual Chrome Humbucker Pickups, Tune-O-Matic Bridge & Bigsby Vibrato Tailpiece
for (const pInfo of [
  { name: "neck_humbucker_pickup", y: 0.105 },
  { name: "bridge_humbucker_pickup", y: 0.015 }
]) {
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.076, 0.04, 0.009),
    creamBindingMat
  );
  bezel.name = `${pInfo.name}_mounting_ring`;
  bezel.position.set(0, pInfo.y, 0.032);
  guitarGroup.add(bezel);

  const pickupCover = new THREE.Mesh(
    new THREE.BoxGeometry(0.068, 0.034, 0.014),
    chromeHardwareMat
  );
  pickupCover.name = pInfo.name;
  pickupCover.position.set(0, pInfo.y, 0.035);
  guitarGroup.add(pickupCover);
}

// Tune-O-Matic Bridge at y = -0.045
const tuneOMaticBridge = new THREE.Mesh(
  new THREE.BoxGeometry(0.082, 0.014, 0.018),
  chromeHardwareMat
);
tuneOMaticBridge.name = "tune_o_matic_bridge";
tuneOMaticBridge.position.set(0, -0.045, 0.038);
guitarGroup.add(tuneOMaticBridge);

// Bigsby Vibrato Tailpiece & Tremolo Arm at y = -0.135
const bigsbyFrame = new THREE.Mesh(
  new THREE.BoxGeometry(0.088, 0.1, 0.012),
  chromeHardwareMat
);
bigsbyFrame.name = "bigsby_vibrato_tailpiece";
bigsbyFrame.position.set(0, -0.135, 0.034);
guitarGroup.add(bigsbyFrame);

const bigsbyRoller = new THREE.Mesh(
  new THREE.CylinderGeometry(0.008, 0.008, 0.084, 16),
  chromeHardwareMat
);
bigsbyRoller.name = "bigsby_string_roller_bar";
bigsbyRoller.rotation.z = Math.PI / 2;
bigsbyRoller.position.set(0, -0.1, 0.042);
guitarGroup.add(bigsbyRoller);

const vibratoArm = new THREE.Mesh(
  new THREE.CylinderGeometry(0.004, 0.003, 0.14, 12),
  chromeHardwareMat
);
vibratoArm.name = "bigsby_vibrato_whammy_arm";
vibratoArm.position.set(0.062, -0.055, 0.05);
vibratoArm.rotation.z = -0.25;
guitarGroup.add(vibratoArm);

// 4 Tone/Volume Control Knobs on right lower bout
for (let k = 0; k < 4; k++) {
  const kx = 0.085 + (k % 2) * 0.042;
  const ky = -0.075 - Math.floor(k / 2) * 0.048;
  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.014, 0.014, 16),
    amberCenterBurstMat
  );
  knob.name = `control_pot_knob_${k + 1}`;
  knob.rotation.x = Math.PI / 2;
  knob.position.set(kx, ky, 0.036);
  guitarGroup.add(knob);
}

// 6. Six Steel Strings Spanning from Bigsby Tailpiece to Headstock Nut
for (let s = 0; s < 6; s++) {
  const sx = -0.019 + s * 0.0076;
  const stringMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0009, 0.0009, 0.72, 6),
    chromeHardwareMat
  );
  stringMesh.name = `steel_guitar_string_${s + 1}`;
  stringMesh.position.set(sx, 0.26, 0.042);
  guitarGroup.add(stringMesh);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(0.75, 0.65, 1.15);
camera.lookAt(0, 0.54, 0);
