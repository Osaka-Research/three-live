// Mid-Century Modern Lounge Chair & Ottoman on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.3);
keyLight.name = "key_directional_light";
keyLight.position.set(2.0, 3.0, 2.2);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xdbe8ff, 0.55);
fillLight.name = "fill_directional_light";
fillLight.position.set(-2.0, 1.8, -1.5);
scene.add(fillLight);

const setGroup = new THREE.Group();
setGroup.name = "lounge_chair_and_ottoman_set";
scene.add(setGroup);

// Materials
const walnutVeneerMat = new THREE.MeshStandardMaterial({
  color: 0x6e3f23,
  metalness: 0.08,
  roughness: 0.35
});

const blackLeatherMat = new THREE.MeshStandardMaterial({
  color: 0x1c1d20,
  metalness: 0.12,
  roughness: 0.42
});

const castAluminumMat = new THREE.MeshStandardMaterial({
  color: 0xd0d5dc,
  metalness: 0.88,
  roughness: 0.22
});

const blackSteelMat = new THREE.MeshStandardMaterial({
  color: 0x22252a,
  metalness: 0.75,
  roughness: 0.35
});

// Helper: build curved walnut plywood shell + tufted leather cushion using ExtrudeGeometry
function createMoldedShellSection(name, width, depth, thickness, curveRise) {
  const sectionGroup = new THREE.Group();
  sectionGroup.name = name;

  // Side profile of curved molded plywood with upturned side lips
  const profile = new THREE.Shape();
  const hw = width / 2;
  profile.moveTo(-hw, curveRise);
  profile.quadraticCurveTo(-hw * 0.7, 0, 0, 0);
  profile.quadraticCurveTo(hw * 0.7, 0, hw, curveRise);
  profile.lineTo(hw - 0.014, curveRise + thickness);
  profile.quadraticCurveTo(hw * 0.68, thickness, 0, thickness);
  profile.quadraticCurveTo(-hw * 0.68, thickness, -hw + 0.014, curveRise + thickness);
  profile.closePath();

  const shellGeo = new THREE.ExtrudeGeometry(profile, {
    depth: depth,
    bevelEnabled: true,
    bevelThickness: 0.008,
    bevelSize: 0.008,
    bevelSegments: 2
  });
  shellGeo.translate(0, 0, -depth / 2);

  const shellMesh = new THREE.Mesh(shellGeo, walnutVeneerMat);
  shellMesh.name = `${name}_walnut_shell`;
  sectionGroup.add(shellMesh);

  // Tufted black leather cushion resting inside the shell
  const cushionGroup = new THREE.Group();
  cushionGroup.name = `${name}_tufted_cushion`;

  const cushionMain = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.88, 0.085, depth * 0.9),
    blackLeatherMat
  );
  cushionMain.name = `${name}_leather_pad`;
  cushionMain.position.set(0, thickness + 0.045, 0);
  cushionGroup.add(cushionMain);

  // Leather tuft buttons (2x3 grid)
  for (const bx of [-width * 0.22, width * 0.22]) {
    for (const bz of [-depth * 0.24, 0, depth * 0.24]) {
      const button = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.012, 12),
        blackLeatherMat
      );
      button.name = `${name}_tuft_button_${Math.round(bx * 100)}_${Math.round(bz * 100)}`;
      button.position.set(bx, thickness + 0.086, bz);
      cushionGroup.add(button);
    }
  }

  sectionGroup.add(cushionGroup);
  return sectionGroup;
}

// Helper: Cast-Aluminum Swivel Star Base resting on y = 0
function createSwivelBase(name, numLegs, legRadius, postHeight) {
  const baseGroup = new THREE.Group();
  baseGroup.name = name;

  const centerColumn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.032, postHeight, 20),
    blackSteelMat
  );
  centerColumn.name = `${name}_swivel_column`;
  centerColumn.position.set(0, 0.04 + postHeight / 2, 0);
  baseGroup.add(centerColumn);

  for (let i = 0; i < numLegs; i++) {
    const angle = (i / numLegs) * Math.PI * 2;
    const legArmGroup = new THREE.Group();
    legArmGroup.name = `${name}_leg_arm_${i + 1}`;
    legArmGroup.rotation.y = angle;

    const legBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.026, legRadius),
      castAluminumMat
    );
    legBar.name = `${name}_aluminum_blade_${i + 1}`;
    legBar.position.set(0, 0.045, legRadius / 2);
    legBar.rotation.x = 0.14;
    legArmGroup.add(legBar);

    const footGlide = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.026, 0.018, 16),
      castAluminumMat
    );
    footGlide.name = `${name}_foot_glide_${i + 1}`;
    footGlide.position.set(0, 0.009, legRadius * 0.95);
    legArmGroup.add(footGlide);

    baseGroup.add(legArmGroup);
  }

  return baseGroup;
}

// 1. Lounge Chair Assembly (centered around z = -0.22)
const chairGroup = new THREE.Group();
chairGroup.name = "molded_plywood_lounge_chair";
chairGroup.position.set(0, 0, -0.22);
setGroup.add(chairGroup);

// 5-star swivel base for chair
const chairBase = createSwivelBase("chair_5star_base", 5, 0.36, 0.24);
chairGroup.add(chairBase);

// Reclined seat shell
const seatShell = createMoldedShellSection("chair_seat", 0.68, 0.54, 0.018, 0.06);
seatShell.position.set(0, 0.3, 0.02);
seatShell.rotation.x = -0.24;
chairGroup.add(seatShell);

// Lower backrest shell
const lowerBackShell = createMoldedShellSection("chair_lower_back", 0.66, 0.34, 0.018, 0.05);
lowerBackShell.position.set(0, 0.52, -0.24);
lowerBackShell.rotation.x = 1.18;
chairGroup.add(lowerBackShell);

// Upper headrest shell
const headrestShell = createMoldedShellSection("chair_headrest", 0.62, 0.28, 0.018, 0.04);
headrestShell.position.set(0, 0.81, -0.35);
headrestShell.rotation.x = 1.24;
chairGroup.add(headrestShell);

// Cast aluminum spine brackets connecting seat -> lower back -> headrest
for (const side of [-1, 1]) {
  const spineBracket = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.44, 0.022),
    blackSteelMat
  );
  spineBracket.name = `back_spine_connector_${side < 0 ? "left" : "right"}`;
  spineBracket.position.set(side * 0.2, 0.65, -0.32);
  spineBracket.rotation.x = -0.34;
  chairGroup.add(spineBracket);

  // Upholstered leather armrests
  const armrestPad = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.065, 0.42),
    blackLeatherMat
  );
  armrestPad.name = `leather_armrest_${side < 0 ? "left" : "right"}`;
  armrestPad.position.set(side * 0.37, 0.5, -0.02);
  armrestPad.rotation.x = -0.15;
  chairGroup.add(armrestPad);
}

// 2. Matching Ottoman (positioned forward at z = +0.52)
const ottomanGroup = new THREE.Group();
ottomanGroup.name = "matching_lounge_ottoman";
ottomanGroup.position.set(0, 0, 0.52);
setGroup.add(ottomanGroup);

// 5-star base for ottoman
const ottomanBase = createSwivelBase("ottoman_5star_base", 5, 0.28, 0.23);
ottomanGroup.add(ottomanBase);

const ottomanShell = createMoldedShellSection("ottoman_cushion_shell", 0.6, 0.46, 0.018, 0.045);
ottomanShell.position.set(0, 0.29, 0);
ottomanShell.rotation.x = 0.08;
ottomanGroup.add(ottomanShell);

// Frame camera at ~2.2x bounding radius
camera.position.set(1.45, 1.15, 1.65);
camera.lookAt(0, 0.42, 0.1);
