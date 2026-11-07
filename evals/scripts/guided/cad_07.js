// Dual-Group Commercial Stainless-Steel Espresso Machine (~0.6m wide) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff7eb, 1.35);
keyLight.name = "key_directional_light";
keyLight.position.set(1.4, 2.2, 1.8);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd8e8ff, 0.65);
fillLight.name = "fill_directional_light";
fillLight.position.set(-1.5, 1.5, 1.2);
scene.add(fillLight);

const espressoGroup = new THREE.Group();
espressoGroup.name = "commercial_espresso_machine";
scene.add(espressoGroup);

// Materials
const brushedSteelMat = new THREE.MeshStandardMaterial({
  color: 0xd4dae0,
  metalness: 0.9,
  roughness: 0.22
});

const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xeef3f8,
  metalness: 0.96,
  roughness: 0.1
});

const darkPanelMat = new THREE.MeshStandardMaterial({
  color: 0x22262b,
  metalness: 0.5,
  roughness: 0.45
});

const bakeliteHandleMat = new THREE.MeshStandardMaterial({
  color: 0x16171a,
  metalness: 0.15,
  roughness: 0.32
});

const brassAccentMat = new THREE.MeshStandardMaterial({
  color: 0xd4a23c,
  metalness: 0.86,
  roughness: 0.24
});

const ceramicCupMat = new THREE.MeshStandardMaterial({
  color: 0xf7f5f0,
  metalness: 0.05,
  roughness: 0.18
});

const gaugeFaceMat = new THREE.MeshStandardMaterial({
  color: 0xfaf6ec,
  metalness: 0.05,
  roughness: 0.3
});

// 1. Rubber Leveling Feet (y = 0 to 0.025) & Main Stainless Chassis (~0.6m wide x 0.46m tall x 0.44m deep)
for (const fx of [-0.25, 0.25]) {
  for (const fz of [-0.17, 0.17]) {
    const foot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.018, 0.025, 16),
      bakeliteHandleMat
    );
    foot.name = `chassis_foot_${fx < 0 ? "L" : "R"}_${fz < 0 ? "rear" : "front"}`;
    foot.position.set(fx, 0.0125, fz);
    espressoGroup.add(foot);
  }
}

// Lower base frame & rear boiler housing
const lowerChassis = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.07, 0.44),
  darkPanelMat
);
lowerChassis.name = "lower_base_chassis";
lowerChassis.position.set(0, 0.06, 0);
espressoGroup.add(lowerChassis);

const rearBoilerBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.58, 0.34, 0.28),
  brushedSteelMat
);
rearBoilerBody.name = "main_boiler_cabinet";
rearBoilerBody.position.set(0, 0.265, -0.07);
espressoGroup.add(rearBoilerBody);

// Upper overhanging brew hood
const upperHood = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.11, 0.42),
  brushedSteelMat
);
upperHood.name = "upper_brew_head_hood";
upperHood.position.set(0, 0.38, -0.01);
espressoGroup.add(upperHood);

// Side curved cheek trims
for (const side of [-1, 1]) {
  const sidePanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.36, 0.4),
    chromeMat
  );
  sidePanel.name = `side_cheek_panel_${side < 0 ? "left" : "right"}`;
  sidePanel.position.set(side * 0.298, 0.265, -0.01);
  espressoGroup.add(sidePanel);
}

// 2. Slotted Drip Tray Basin & Grate at the Front
const dripTrayBasin = new THREE.Mesh(
  new THREE.BoxGeometry(0.54, 0.045, 0.16),
  chromeMat
);
dripTrayBasin.name = "drip_tray_basin";
dripTrayBasin.position.set(0, 0.095, 0.14);
espressoGroup.add(dripTrayBasin);

// Slotted grate bars across the drip tray
for (let i = -11; i <= 11; i++) {
  const grateBar = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.006, 0.14),
    brushedSteelMat
  );
  grateBar.name = `drip_tray_grate_slot_${i + 12}`;
  grateBar.position.set(i * 0.022, 0.12, 0.14);
  espressoGroup.add(grateBar);
}

// 3. Dual Brew Group Heads & Two Ergonomic Portafilter Handles
for (const side of [-1, 1]) {
  const groupTag = side < 0 ? "left" : "right";
  const gx = side * 0.145;

  const groupGroup = new THREE.Group();
  groupGroup.name = `${groupTag}_brew_group_assembly`;
  groupGroup.position.set(gx, 0.305, 0.12);
  espressoGroup.add(groupGroup);

  // Chromed brass group bell
  const groupBell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.046, 0.042, 0.055, 24),
    chromeMat
  );
  groupBell.name = `${groupTag}_group_head_bell`;
  groupGroup.add(groupBell);

  // Portafilter basket holder & dual espresso spouts
  const basketCup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.036, 0.036, 24),
    chromeMat
  );
  basketCup.name = `${groupTag}_portafilter_basket`;
  basketCup.position.set(0, -0.04, 0);
  groupGroup.add(basketCup);

  const doubleSpout = new THREE.Mesh(
    new THREE.BoxGeometry(0.038, 0.014, 0.016),
    chromeMat
  );
  doubleSpout.name = `${groupTag}_portafilter_double_spout`;
  doubleSpout.position.set(0, -0.064, 0);
  groupGroup.add(doubleSpout);

  // Angled portafilter shank + ergonomic black handle
  const pfHandleGroup = new THREE.Group();
  pfHandleGroup.name = `${groupTag}_portafilter_handle_group`;
  pfHandleGroup.position.set(0, -0.038, 0.035);
  pfHandleGroup.rotation.y = side * 0.18;
  pfHandleGroup.rotation.x = 0.12;
  groupGroup.add(pfHandleGroup);

  const pfShank = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.009, 0.04, 12),
    chromeMat
  );
  pfShank.name = `${groupTag}_portafilter_shank`;
  pfShank.rotation.x = Math.PI / 2;
  pfShank.position.set(0, 0, 0.02);
  pfHandleGroup.add(pfShank);

  const pfGrip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.012, 0.13, 18),
    bakeliteHandleMat
  );
  pfGrip.name = `${groupTag}_portafilter_grip`;
  pfGrip.rotation.x = Math.PI / 2;
  pfGrip.position.set(0, 0, 0.105);
  pfHandleGroup.add(pfGrip);

  // Volumetric dose buttons above each group head
  for (let b = 0; b < 4; b++) {
    const btn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.01, 12),
      b === 3 ? brassAccentMat : chromeMat
    );
    btn.name = `${groupTag}_dose_button_${b + 1}`;
    btn.rotation.x = Math.PI / 2;
    btn.position.set(gx - 0.036 + b * 0.024, 0.375, 0.202);
    espressoGroup.add(btn);
  }
}

// 4. Dual Steam Wands with Articulated Ball Joints & Steam Knobs
for (const side of [-1, 1]) {
  const wandTag = side < 0 ? "left" : "right";
  const wx = side * 0.255;

  // Rotary steam valve knob on upper front corners
  const steamKnob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.02, 0.028, 20),
    bakeliteHandleMat
  );
  steamKnob.name = `${wandTag}_steam_valve_knob`;
  steamKnob.rotation.x = Math.PI / 2;
  steamKnob.position.set(wx, 0.375, 0.21);
  espressoGroup.add(steamKnob);

  // Articulated ball joint socket
  const ballJoint = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 16, 16),
    chromeMat
  );
  ballJoint.name = `${wandTag}_steam_ball_joint`;
  ballJoint.position.set(wx, 0.31, 0.14);
  espressoGroup.add(ballJoint);

  // Angled stainless steam wand pipe
  const wandPipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0055, 0.0055, 0.18, 14),
    chromeMat
  );
  wandPipe.name = `${wandTag}_steam_wand_tube`;
  wandPipe.position.set(wx + side * 0.018, 0.225, 0.165);
  wandPipe.rotation.z = side * 0.22;
  wandPipe.rotation.x = 0.28;
  espressoGroup.add(wandPipe);

  // Rubber anti-burn grip sleeve
  const burnSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.045, 14),
    bakeliteHandleMat
  );
  burnSleeve.name = `${wandTag}_steam_wand_grip`;
  burnSleeve.position.set(wx + side * 0.011, 0.26, 0.155);
  burnSleeve.rotation.z = side * 0.22;
  burnSleeve.rotation.x = 0.28;
  espressoGroup.add(burnSleeve);
}

// 5. Dual Pressure Gauge Dial on the Front Faceplate
const gaugeGroup = new THREE.Group();
gaugeGroup.name = "boiler_pressure_gauge";
gaugeGroup.position.set(0, 0.372, 0.202);
espressoGroup.add(gaugeGroup);

const gaugeBezel = new THREE.Mesh(
  new THREE.TorusGeometry(0.032, 0.0045, 12, 28),
  brassAccentMat
);
gaugeBezel.name = "pressure_gauge_brass_bezel";
gaugeGroup.add(gaugeBezel);

const gaugeDialFace = new THREE.Mesh(
  new THREE.CylinderGeometry(0.031, 0.031, 0.006, 24),
  gaugeFaceMat
);
gaugeDialFace.name = "pressure_gauge_dial_face";
gaugeDialFace.rotation.x = Math.PI / 2;
gaugeGroup.add(gaugeDialFace);

const gaugeNeedle = new THREE.Mesh(
  new THREE.BoxGeometry(0.003, 0.022, 0.004),
  bakeliteHandleMat
);
gaugeNeedle.name = "pressure_gauge_needle";
gaugeNeedle.position.set(0.005, 0.006, 0.004);
gaugeNeedle.rotation.z = -0.65;
gaugeGroup.add(gaugeNeedle);

// 6. Top Cup Warmer Rail & Ceramic Espresso Cups
const cupRailPerimeter = new THREE.Mesh(
  new THREE.TorusGeometry(0.24, 0.005, 10, 32),
  chromeMat
);
cupRailPerimeter.name = "top_cup_warmer_guard_rail";
cupRailPerimeter.rotation.x = Math.PI / 2;
cupRailPerimeter.scale.set(1.15, 0.65, 1.0);
cupRailPerimeter.position.set(0, 0.452, -0.02);
espressoGroup.add(cupRailPerimeter);

for (let c = 0; c < 4; c++) {
  const cx = -0.18 + c * 0.12;
  const cz = c % 2 === 0 ? -0.05 : 0.02;

  const cupGroup = new THREE.Group();
  cupGroup.name = `ceramic_espresso_cup_${c + 1}`;
  cupGroup.position.set(cx, 0.435, cz);
  espressoGroup.add(cupGroup);

  const saucer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.044, 0.03, 0.008, 20),
    ceramicCupMat
  );
  saucer.name = `cup_saucer_${c + 1}`;
  saucer.position.y = 0.004;
  cupGroup.add(saucer);

  const cupBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.02, 0.046, 20),
    ceramicCupMat
  );
  cupBody.name = `cup_vessel_${c + 1}`;
  cupBody.position.y = 0.031;
  cupGroup.add(cupBody);

  const cupHandle = new THREE.Mesh(
    new THREE.TorusGeometry(0.012, 0.0035, 10, 16, Math.PI),
    ceramicCupMat
  );
  cupHandle.name = `cup_ear_handle_${c + 1}`;
  cupHandle.position.set(0.026, 0.032, 0);
  cupHandle.rotation.z = -Math.PI / 2;
  cupGroup.add(cupHandle);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(0.68, 0.56, 0.85);
camera.lookAt(0, 0.24, 0.02);
