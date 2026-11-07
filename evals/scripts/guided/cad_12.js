// Standing 1980s Coin-Op Arcade Cabinet (1.8m tall) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.15);
keyLight.name = "key_directional_light";
keyLight.position.set(1.8, 2.6, 2.2);
scene.add(keyLight);

const arcadeGroup = new THREE.Group();
arcadeGroup.name = "retro_1980s_arcade_cabinet";
scene.add(arcadeGroup);

// Materials
const cabinetWoodMat = new THREE.MeshStandardMaterial({
  color: 0x161820,
  metalness: 0.15,
  roughness: 0.45
});

const cyanTrimMat = new THREE.MeshStandardMaterial({
  color: 0x00d8ff,
  emissive: 0x005577,
  emissiveIntensity: 0.4,
  metalness: 0.2,
  roughness: 0.3
});

const marqueeMat = new THREE.MeshStandardMaterial({
  color: 0xffcc22,
  emissive: 0xff6600,
  emissiveIntensity: 1.6,
  roughness: 0.25
});

const crtScreenMat = new THREE.MeshStandardMaterial({
  color: 0x102848,
  emissive: 0x1e60a8,
  emissiveIntensity: 0.9,
  roughness: 0.12
});

const crtGlassBezelMat = new THREE.MeshPhysicalMaterial({
  color: 0x22262e,
  transmission: 0.65,
  ior: 1.5,
  thickness: 0.01,
  roughness: 0.08,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.85
});

const redPlasticMat = new THREE.MeshStandardMaterial({
  color: 0xe61e2a,
  metalness: 0.1,
  roughness: 0.2
});

const bluePlasticMat = new THREE.MeshStandardMaterial({
  color: 0x1e66f0,
  metalness: 0.1,
  roughness: 0.2
});

const yellowPlasticMat = new THREE.MeshStandardMaterial({
  color: 0xf5c400,
  metalness: 0.1,
  roughness: 0.2
});

const chromeSteelMat = new THREE.MeshStandardMaterial({
  color: 0xd8dfe6,
  metalness: 0.9,
  roughness: 0.18
});

const coinRejectMat = new THREE.MeshStandardMaterial({
  color: 0xff5500,
  emissive: 0xaa2200,
  emissiveIntensity: 0.8,
  roughness: 0.3
});

// 1. Extruded Side-Panel Profile Cutouts (1.8m tall, ~0.72m deep, 0.66m wide)
const sideShape = new THREE.Shape();
sideShape.moveTo(-0.36, 0);       // Bottom back
sideShape.lineTo(0.32, 0);        // Bottom front
sideShape.lineTo(0.32, 0.82);     // Lower front up to control deck lip
sideShape.lineTo(0.4, 0.88);      // Control deck overhang nose
sideShape.lineTo(0.4, 0.96);      // Control deck top front
sideShape.lineTo(0.16, 1.04);     // Under-bezel recess
sideShape.lineTo(0.08, 1.48);     // Angled CRT bezel rise
sideShape.lineTo(0.34, 1.58);     // Upper marquee lower overhang
sideShape.lineTo(0.38, 1.76);     // Marquee front peak
sideShape.lineTo(0.18, 1.8);      // Cabinet roof peak
sideShape.lineTo(-0.36, 1.8);     // Top back
sideShape.closePath();

const sidePanelGeo = new THREE.ExtrudeGeometry(sideShape, {
  depth: 0.024,
  bevelEnabled: true,
  bevelThickness: 0.004,
  bevelSize: 0.004,
  bevelSegments: 2
});

for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "left" : "right";
  const sidePanel = new THREE.Mesh(sidePanelGeo, cabinetWoodMat);
  sidePanel.name = `arcade_side_panel_${sideTag}`;
  sidePanel.rotation.y = Math.PI / 2;
  sidePanel.position.set(side * 0.32 - 0.012, 0, 0);
  arcadeGroup.add(sidePanel);

  // Cyan T-molding trim accent strip on front edge
  const trimStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.028, 0.82, 0.012),
    cyanTrimMat
  );
  trimStrip.name = `t_molding_trim_${sideTag}`;
  trimStrip.position.set(side * 0.32, 0.41, 0.322);
  arcadeGroup.add(trimStrip);
}

// Central Cabinet Core Box, Lower Front Kickplate & Top Hood
const coreCabinet = new THREE.Mesh(
  new THREE.BoxGeometry(0.616, 1.78, 0.64),
  cabinetWoodMat
);
coreCabinet.name = "central_cabinet_enclosure";
coreCabinet.position.set(0, 0.89, -0.04);
arcadeGroup.add(coreCabinet);

// 2. Illuminated Top Marquee & PointLight Glow
const marqueeBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.614, 0.17, 0.08),
  marqueeMat
);
marqueeBox.name = "illuminated_top_marquee";
marqueeBox.position.set(0, 1.66, 0.31);
marqueeBox.rotation.x = -0.22;
arcadeGroup.add(marqueeBox);

const marqueeGlowLight = new THREE.PointLight(0xffaa33, 1.8, 1.6);
marqueeGlowLight.name = "marquee_point_light";
marqueeGlowLight.position.set(0, 1.65, 0.42);
arcadeGroup.add(marqueeGlowLight);

// 3. Recessed CRT Screen with Curved Glass Bezel
const crtTubeMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.42, 24, 18, -0.52, 1.04, 1.15, 0.78),
  crtScreenMat
);
crtTubeMesh.name = "recessed_curved_crt_screen";
crtTubeMesh.position.set(0, 1.25, -0.22);
crtTubeMesh.rotation.x = -0.28;
arcadeGroup.add(crtTubeMesh);

const crtBezelGlass = new THREE.Mesh(
  new THREE.BoxGeometry(0.58, 0.44, 0.012),
  crtGlassBezelMat
);
crtBezelGlass.name = "curved_glass_screen_bezel";
crtBezelGlass.position.set(0, 1.26, 0.16);
crtBezelGlass.rotation.x = -0.24;
arcadeGroup.add(crtBezelGlass);

const screenGlowLight = new THREE.PointLight(0x3898ff, 1.2, 1.2);
screenGlowLight.name = "crt_screen_glow_light";
screenGlowLight.position.set(0, 1.22, 0.25);
arcadeGroup.add(screenGlowLight);

// 4. Two-Player Control Deck with Ball-Top Joysticks & Arcade Buttons
const controlDeck = new THREE.Mesh(
  new THREE.BoxGeometry(0.616, 0.06, 0.24),
  cabinetWoodMat
);
controlDeck.name = "two_player_control_deck";
controlDeck.position.set(0, 0.94, 0.29);
controlDeck.rotation.x = 0.18;
arcadeGroup.add(controlDeck);

for (let p = 0; p < 2; p++) {
  const playerX = p === 0 ? -0.15 : 0.15;
  const pTag = `player_${p + 1}`;

  // Dust washer disc
  const washer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.026, 0.004, 16),
    cabinetWoodMat
  );
  washer.name = `${pTag}_joystick_washer`;
  washer.position.set(playerX - 0.06, 0.972, 0.31);
  washer.rotation.x = 0.18;
  arcadeGroup.add(washer);

  // Chrome joystick shaft
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.055, 12),
    chromeSteelMat
  );
  shaft.name = `${pTag}_joystick_shaft`;
  shaft.position.set(playerX - 0.06, 0.998, 0.315);
  shaft.rotation.x = 0.18;
  arcadeGroup.add(shaft);

  // Spherical ball-top grip
  const ballTop = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 18, 16),
    p === 0 ? redPlasticMat : bluePlasticMat
  );
  ballTop.name = `${pTag}_ball_top_joystick`;
  ballTop.position.set(playerX - 0.06, 1.028, 0.32);
  arcadeGroup.add(ballTop);

  // 6 Arcade Pushbuttons per player (2 rows x 3 cols)
  const btnMats = [redPlasticMat, bluePlasticMat, yellowPlasticMat];
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      const btn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.014, 0.012, 16),
        btnMats[col]
      );
      btn.name = `${pTag}_arcade_button_r${row + 1}_c${col + 1}`;
      btn.position.set(
        playerX + 0.015 + col * 0.032,
        0.974 - row * 0.006,
        0.29 + row * 0.034
      );
      btn.rotation.x = 0.18;
      arcadeGroup.add(btn);
    }
  }
}

// 5. Dual Coin Door on Lower Front Cabinet
const coinDoorFrame = new THREE.Mesh(
  new THREE.BoxGeometry(0.42, 0.48, 0.025),
  chromeSteelMat
);
coinDoorFrame.name = "dual_coin_door_frame";
coinDoorFrame.position.set(0, 0.44, 0.285);
arcadeGroup.add(coinDoorFrame);

for (const side of [-1, 1]) {
  const slotTag = side < 0 ? "left" : "right";
  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.42, 0.018),
    cabinetWoodMat
  );
  doorPanel.name = `coin_door_leaf_${slotTag}`;
  doorPanel.position.set(side * 0.1, 0.44, 0.292);
  arcadeGroup.add(doorPanel);

  // Illuminated orange 25-cent coin reject button
  const rejectButton = new THREE.Mesh(
    new THREE.BoxGeometry(0.036, 0.044, 0.016),
    coinRejectMat
  );
  rejectButton.name = `coin_reject_button_${slotTag}`;
  rejectButton.position.set(side * 0.1, 0.54, 0.302);
  arcadeGroup.add(rejectButton);

  // Coin return pocket below
  const returnPocket = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.055, 0.016),
    chromeSteelMat
  );
  returnPocket.name = `coin_return_cup_${slotTag}`;
  returnPocket.position.set(side * 0.1, 0.34, 0.302);
  arcadeGroup.add(returnPocket);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(1.55, 1.25, 1.95);
camera.lookAt(0, 0.9, 0);
