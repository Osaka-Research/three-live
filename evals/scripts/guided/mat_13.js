// mat_13: Retro 6-Digit Nixie Tube Desk Clock
const root = new THREE.Group();
root.name = "NixieTubeDeskClockRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ClockAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xfff4e0, 1.1);
keyDirLight.name = "ClockKeyDirectionalLight";
keyDirLight.position.set(0.8, 1.4, 1.2);
scene.add(keyDirLight);

// Materials
const walnutCaseMat = new THREE.MeshStandardMaterial({
  color: 0x4a2c18,
  roughness: 0.35,
  metalness: 0.05
});

const polishedBrassMat = new THREE.MeshStandardMaterial({
  color: 0xd9a836,
  metalness: 0.92,
  roughness: 0.18
});

const copperCoilMat = new THREE.MeshStandardMaterial({
  color: 0xc86b3c,
  metalness: 0.88,
  roughness: 0.24
});

const darkBakeliteMat = new THREE.MeshStandardMaterial({
  color: 0x1b1918,
  roughness: 0.4,
  metalness: 0.1
});

const nixieGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.02,
  metalness: 0.0,
  transmission: 0.95,
  ior: 1.5,
  thickness: 0.012,
  attenuationColor: 0xfff3e6,
  attenuationDistance: 0.4,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

const anodeMeshWireMat = new THREE.MeshStandardMaterial({
  color: 0x555860,
  metalness: 0.85,
  roughness: 0.4,
  wireframe: true
});

const glowingCathodeMat = new THREE.MeshStandardMaterial({
  color: 0xff6600,
  emissive: 0xff4800,
  emissiveIntensity: 3.2,
  roughness: 0.15,
  metalness: 0.1
});

const unlitCathodeMat = new THREE.MeshStandardMaterial({
  color: 0x3b3532,
  metalness: 0.7,
  roughness: 0.5
});

// Steampunk Walnut-and-Brass Desk Clock Base (~0.48m wide, 0.14m deep) resting on y = 0
const caseGroup = new THREE.Group();
caseGroup.name = "SteampunkWalnutBrassCaseGroup";
root.add(caseGroup);

// 4 Turned Brass Feet (y = 0 to y = 0.018)
const footPositions = [
  [-0.21, -0.052],
  [0.21, -0.052],
  [-0.21, 0.052],
  [0.21, 0.052]
];
for (let i = 0; i < footPositions.length; i++) {
  const foot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.018, 0.018, 16),
    polishedBrassMat
  );
  foot.name = "BrassClockFoot_" + i;
  foot.position.set(footPositions[i][0], 0.009, footPositions[i][1]);
  caseGroup.add(foot);
}

// Main Walnut Chassis Box
const walnutChassis = new THREE.Mesh(
  new THREE.BoxGeometry(0.46, 0.062, 0.13),
  walnutCaseMat
);
walnutChassis.name = "WalnutClockChassis";
walnutChassis.position.set(0, 0.049, 0);
caseGroup.add(walnutChassis);

// Top Brushed Brass Deck Plate & Corner Screw Studs
const brassDeckPlate = new THREE.Mesh(
  new THREE.BoxGeometry(0.44, 0.006, 0.115),
  polishedBrassMat
);
brassDeckPlate.name = "TopBrassDeckPlate";
brassDeckPlate.position.set(0, 0.083, 0);
caseGroup.add(brassDeckPlate);

// Front Steampunk Brass Knobs, Toggle Switches, and Nameplate
const frontNameplate = new THREE.Mesh(
  new THREE.BoxGeometry(0.11, 0.022, 0.005),
  polishedBrassMat
);
frontNameplate.name = "FrontBrassNameplate";
frontNameplate.position.set(0, 0.048, 0.066);
caseGroup.add(frontNameplate);

for (let side of [-1, 1]) {
  const knurledKnob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.014, 16),
    polishedBrassMat
  );
  knurledKnob.name = "BrassAdjustmentKnob_" + (side < 0 ? "Left" : "Right");
  knurledKnob.rotation.x = Math.PI / 2;
  knurledKnob.position.set(side * 0.16, 0.048, 0.069);
  caseGroup.add(knurledKnob);
}

// Helper to build glowing orange cathode numerals ("2", "3", "5", "9", "4", "8") inside each Nixie tube
function buildCathodeNumeral(digitIndex, parentGroup) {
  const numGroup = new THREE.Group();
  numGroup.name = "GlowingCathodeNumeral_" + digitIndex;
  numGroup.position.set(0, 0.062, 0.003);
  parentGroup.add(numGroup);

  // Add background unlit stacked digit mesh ring for realism
  const backStack = new THREE.Mesh(
    new THREE.TorusGeometry(0.011, 0.001, 8, 16),
    unlitCathodeMat
  );
  backStack.name = "UnlitCathodeStack_" + digitIndex;
  backStack.scale.set(0.85, 1.4, 1.0);
  backStack.position.set(0, 0, -0.005);
  numGroup.add(backStack);

  // Build glowing orange filament strokes for digits: 1, 2, 4, 8, 5, 9
  if (digitIndex === 0) {
    // Digit "1"
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0022, 0.0022, 0.038, 10),
      glowingCathodeMat
    );
    bar.name = "CathodeDigit1_Stem";
    numGroup.add(bar);
  } else if (digitIndex === 1) {
    // Digit "2" (Top arc + diagonal + bottom bar)
    const topLoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.009, 0.002, 10, 20, Math.PI * 1.15),
      glowingCathodeMat
    );
    topLoop.name = "CathodeDigit2_TopArc";
    topLoop.position.set(0, 0.009, 0);
    numGroup.add(topLoop);

    const diag = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.024, 8),
      glowingCathodeMat
    );
    diag.name = "CathodeDigit2_Diag";
    diag.rotation.z = -0.62;
    diag.position.set(0, -0.004, 0);
    numGroup.add(diag);

    const botBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.020, 8),
      glowingCathodeMat
    );
    botBar.name = "CathodeDigit2_Base";
    botBar.rotation.z = Math.PI / 2;
    botBar.position.set(0, -0.017, 0);
    numGroup.add(botBar);
  } else if (digitIndex === 2) {
    // Digit "3" (Two stacked right-facing C-arcs)
    for (let k of [-1, 1]) {
      const loop = new THREE.Mesh(
        new THREE.TorusGeometry(0.0085, 0.002, 10, 20, Math.PI * 1.3),
        glowingCathodeMat
      );
      loop.name = "CathodeDigit3_Arc_" + (k > 0 ? "Top" : "Bot");
      loop.rotation.z = -Math.PI * 0.65;
      loop.position.set(-0.001, k * 0.0085, 0);
      numGroup.add(loop);
    }
  } else if (digitIndex === 3) {
    // Digit "5"
    const topBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.018, 8),
      glowingCathodeMat
    );
    topBar.name = "CathodeDigit5_Top";
    topBar.rotation.z = Math.PI / 2;
    topBar.position.set(0, 0.017, 0);
    numGroup.add(topBar);

    const leftStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.017, 8),
      glowingCathodeMat
    );
    leftStem.name = "CathodeDigit5_Stem";
    leftStem.position.set(-0.008, 0.009, 0);
    numGroup.add(leftStem);

    const botArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.009, 0.002, 10, 20, Math.PI * 1.35),
      glowingCathodeMat
    );
    botArc.name = "CathodeDigit5_Loop";
    botArc.rotation.z = -Math.PI * 0.65;
    botArc.position.set(-0.001, -0.008, 0);
    numGroup.add(botArc);
  } else if (digitIndex === 4) {
    // Digit "4"
    const rightStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.036, 8),
      glowingCathodeMat
    );
    rightStem.name = "CathodeDigit4_Vertical";
    rightStem.position.set(0.006, 0, 0);
    numGroup.add(rightStem);

    const crossBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.022, 8),
      glowingCathodeMat
    );
    crossBar.name = "CathodeDigit4_Cross";
    crossBar.rotation.z = Math.PI / 2;
    crossBar.position.set(0, -0.003, 0);
    numGroup.add(crossBar);

    const slant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 0.024, 8),
      glowingCathodeMat
    );
    slant.name = "CathodeDigit4_Slant";
    slant.rotation.z = -0.52;
    slant.position.set(-0.003, 0.007, 0);
    numGroup.add(slant);
  } else {
    // Digit "8" (Two full glowing torus rings)
    for (let k of [-1, 1]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.0085, 0.002, 10, 24),
        glowingCathodeMat
      );
      ring.name = "CathodeDigit8_Ring_" + (k > 0 ? "Top" : "Bot");
      ring.position.set(0, k * 0.0085, 0);
      numGroup.add(ring);
    }
  }
}

// 6 Glass Vacuum Nixie Tubes arranged across the top deck (HH : MM : SS)
const tubeXPositions = [-0.175, -0.115, -0.030, 0.030, 0.115, 0.175];
const deckTopY = 0.086;

for (let i = 0; i < 6; i++) {
  const tx = tubeXPositions[i];
  const nixieGroup = new THREE.Group();
  nixieGroup.name = "NixieTubeAssembly_" + i;
  nixieGroup.position.set(tx, deckTopY, 0);
  root.add(nixieGroup);

  // Brass collar socket + dark Bakelite pin holder
  const brassSocket = new THREE.Mesh(
    new THREE.CylinderGeometry(0.024, 0.026, 0.016, 24),
    polishedBrassMat
  );
  brassSocket.name = "NixieBrassBaseSocket_" + i;
  brassSocket.position.set(0, 0.008, 0);
  nixieGroup.add(brassSocket);

  const socketRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.024, 0.003, 12, 24),
    copperCoilMat
  );
  socketRing.name = "NixieSocketCollarRing_" + i;
  socketRing.rotation.x = Math.PI / 2;
  socketRing.position.set(0, 0.016, 0);
  nixieGroup.add(socketRing);

  const bakeliteDisc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.019, 0.019, 0.008, 20),
    darkBakeliteMat
  );
  bakeliteDisc.name = "NixieInternalPinBase_" + i;
  bakeliteDisc.position.set(0, 0.020, 0);
  nixieGroup.add(bakeliteDisc);

  // Fine Anode Wire Mesh Cage inside the vacuum envelope
  const anodeCage = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0165, 0.0165, 0.056, 14, 6),
    anodeMeshWireMat
  );
  anodeCage.name = "NixieAnodeWireMeshCage_" + i;
  anodeCage.position.set(0, 0.060, 0);
  nixieGroup.add(anodeCage);

  // Glowing Orange Cathode Numeral inside the anode cage
  buildCathodeNumeral(i, nixieGroup);

  // Outer Transmissive Glass Vacuum Envelope (Cylinder + Dome + Exhaust Tip)
  const glassCylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.075, 24),
    nixieGlassMat
  );
  glassCylinder.name = "NixieGlassEnvelopeCylinder_" + i;
  glassCylinder.position.set(0, 0.054, 0);
  nixieGroup.add(glassCylinder);

  const glassDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    nixieGlassMat
  );
  glassDome.name = "NixieGlassEnvelopeDome_" + i;
  glassDome.position.set(0, 0.0915, 0);
  nixieGroup.add(glassDome);

  const exhaustNipple = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0015, 0.0045, 0.010, 12),
    nixieGlassMat
  );
  exhaustNipple.name = "NixieVacuumExhaustTip_" + i;
  exhaustNipple.position.set(0, 0.116, 0);
  nixieGroup.add(exhaustNipple);

  // Warm orange PointLight inside/around each Nixie tube
  const tubePointLight = new THREE.PointLight(0xff5500, 1.4, 0.45);
  tubePointLight.name = "NixieTubeWarmPointLight_" + i;
  tubePointLight.position.set(tx, deckTopY + 0.062, 0.015);
  scene.add(tubePointLight);
}

// 2 Brass Colon Separator Pillars between HH:MM and MM:SS
for (let cX of [-0.0725, 0.0725]) {
  const colonPost = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.005, 0.07, 12),
    polishedBrassMat
  );
  colonPost.name = "ColonSeparatorPost_" + (cX < 0 ? "Left" : "Right");
  colonPost.position.set(cX, deckTopY + 0.035, 0);
  root.add(colonPost);

  for (let dotY of [0.042, 0.068]) {
    const neonDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 12, 10),
      glowingCathodeMat
    );
    neonDot.name = "ColonNeonBulb_" + (cX < 0 ? "L" : "R") + "_" + Math.round(dotY * 100);
    neonDot.position.set(cX, deckTopY + dotY, 0);
    root.add(neonDot);
  }
}

// Camera framing (~0.48m width -> distance ~0.68m)
camera.position.set(0.0, 0.24, 0.64);
camera.lookAt(0, 0.11, 0);
