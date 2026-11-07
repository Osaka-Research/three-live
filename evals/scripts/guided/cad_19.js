// Traditional Five-Story Timber Japanese Pagoda (3.2m tall) on Stone Platform (y = 0)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff4dc, 1.4);
sunLight.name = "sun_directional_light";
sunLight.position.set(3.8, 5.5, 4.2);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xcfe2ff, 0.6);
fillLight.name = "fill_directional_light";
fillLight.position.set(-3.2, 2.8, -2.8);
scene.add(fillLight);

const pagodaGroup = new THREE.Group();
pagodaGroup.name = "five_story_japanese_pagoda";
scene.add(pagodaGroup);

// Materials
const stoneFoundationMat = new THREE.MeshStandardMaterial({
  color: 0x9c9992,
  metalness: 0.06,
  roughness: 0.78
});

const vermilionTimberMat = new THREE.MeshStandardMaterial({
  color: 0xb8291e,
  metalness: 0.1,
  roughness: 0.42
});

const whitePlasterMat = new THREE.MeshStandardMaterial({
  color: 0xf4EFE6,
  metalness: 0.04,
  roughness: 0.65
});

const darkTileRoofMat = new THREE.MeshStandardMaterial({
  color: 0x2b3036,
  metalness: 0.35,
  roughness: 0.48
});

const bronzeSorinMat = new THREE.MeshStandardMaterial({
  color: 0x9e7d3b,
  metalness: 0.88,
  roughness: 0.25
});

// 1. Stone Foundation Platform (Kidan) on y = 0 with Front Stone Steps
const foundationLower = new THREE.Mesh(
  new THREE.BoxGeometry(1.52, 0.14, 1.52),
  stoneFoundationMat
);
foundationLower.name = "stone_foundation_lower_plinth";
foundationLower.position.set(0, 0.07, 0);
pagodaGroup.add(foundationLower);

const foundationUpper = new THREE.Mesh(
  new THREE.BoxGeometry(1.36, 0.14, 1.36),
  stoneFoundationMat
);
foundationUpper.name = "stone_foundation_upper_deck";
foundationUpper.position.set(0, 0.21, 0);
pagodaGroup.add(foundationUpper);

// Front entry staircase on +Z face
for (let st = 0; st < 4; st++) {
  const stepBlock = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.065, 0.24 - st * 0.045),
    stoneFoundationMat
  );
  stepBlock.name = `foundation_entry_step_${st + 1}`;
  stepBlock.position.set(0, 0.0325 + st * 0.065, 0.76 + (3 - st) * 0.03);
  pagodaGroup.add(stepBlock);
}

// Central heart pillar (Shinbashira) running through the entire pagoda
const shinbashira = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.095, 2.45, 16),
  vermilionTimberMat
);
shinbashira.name = "central_shinbashira_pillar";
shinbashira.position.set(0, 1.5, 0);
pagodaGroup.add(shinbashira);

// 2. Five Stacked Timber Tiers with Sweeping Upturned Eaves, Corner Rafters & Red Perimeter Railings
const baseTierY = 0.28;
const tierHeight = 0.44;

for (let t = 0; t < 5; t++) {
  const scaleFactor = 1.0 - t * 0.11; // Progressive architectural taper from tier 1 to 5
  const coreWidth = 0.78 * scaleFactor;
  const roofWidth = 1.28 * scaleFactor;
  const yBottom = baseTierY + t * tierHeight;

  const tierGroup = new THREE.Group();
  tierGroup.name = `pagoda_story_tier_${t + 1}`;
  tierGroup.position.set(0, yBottom, 0);
  pagodaGroup.add(tierGroup);

  // White plaster & timber core walls
  const wallBox = new THREE.Mesh(
    new THREE.BoxGeometry(coreWidth, 0.28, coreWidth),
    whitePlasterMat
  );
  wallBox.name = `tier_${t + 1}_plaster_wall_core`;
  wallBox.position.set(0, 0.14, 0);
  tierGroup.add(wallBox);

  // Four corner vermilion timber columns
  const colOffset = coreWidth * 0.49;
  for (const cx of [-colOffset, colOffset]) {
    for (const cz of [-colOffset, colOffset]) {
      const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024 * scaleFactor, 0.026 * scaleFactor, 0.3, 12),
        vermilionTimberMat
      );
      pillar.name = `tier_${t + 1}_corner_column_${cx < 0 ? "W" : "E"}${cz < 0 ? "N" : "S"}`;
      pillar.position.set(cx, 0.15, cz);
      tierGroup.add(pillar);
    }
  }

  // Red perimeter balcony deck & railings (Kouran)
  const balconyDeck = new THREE.Mesh(
    new THREE.BoxGeometry(coreWidth * 1.22, 0.028, coreWidth * 1.22),
    vermilionTimberMat
  );
  balconyDeck.name = `tier_${t + 1}_balcony_walkway`;
  balconyDeck.position.set(0, 0.02, 0);
  tierGroup.add(balconyDeck);

  const railDist = coreWidth * 0.58;
  for (let sideIdx = 0; sideIdx < 4; sideIdx++) {
    const railBar = new THREE.Mesh(
      new THREE.BoxGeometry(coreWidth * 1.18, 0.018, 0.018),
      vermilionTimberMat
    );
    railBar.name = `tier_${t + 1}_perimeter_railing_${sideIdx + 1}`;
    const ang = (sideIdx * Math.PI) / 2;
    railBar.position.set(Math.sin(ang) * railDist, 0.068, Math.cos(ang) * railDist);
    railBar.rotation.y = ang;
    tierGroup.add(railBar);
  }

  // Sweeping Pagoda Roof: 4-sided pyramidal ConeGeometry + upturned corner eaves rafters
  const roofConeRadius = roofWidth * 0.72;
  const mainRoofCone = new THREE.Mesh(
    new THREE.ConeGeometry(roofConeRadius, 0.22, 4),
    darkTileRoofMat
  );
  mainRoofCone.name = `tier_${t + 1}_tiled_roof_slope`;
  mainRoofCone.rotation.y = Math.PI / 4;
  mainRoofCone.position.set(0, 0.36, 0);
  tierGroup.add(mainRoofCone);

  const lowerEaveSkirt = new THREE.Mesh(
    new THREE.CylinderGeometry(roofConeRadius * 0.75, roofConeRadius * 1.06, 0.075, 4),
    darkTileRoofMat
  );
  lowerEaveSkirt.name = `tier_${t + 1}_upturned_eave_skirt`;
  lowerEaveSkirt.rotation.y = Math.PI / 4;
  lowerEaveSkirt.position.set(0, 0.26, 0);
  tierGroup.add(lowerEaveSkirt);

  // Four diagonal corner rafters & upturned ridge finials
  for (let c = 0; c < 4; c++) {
    const cornerAng = (c * Math.PI) / 2 + Math.PI / 4;
    const rafterBeam = new THREE.Mesh(
      new THREE.BoxGeometry(0.026 * scaleFactor, 0.024 * scaleFactor, roofConeRadius * 0.98),
      vermilionTimberMat
    );
    rafterBeam.name = `tier_${t + 1}_corner_rafter_${c + 1}`;
    rafterBeam.position.set(
      Math.sin(cornerAng) * (roofConeRadius * 0.46),
      0.245,
      Math.cos(cornerAng) * (roofConeRadius * 0.46)
    );
    rafterBeam.rotation.y = cornerAng;
    rafterBeam.rotation.x = 0.16;
    tierGroup.add(rafterBeam);
  }
}

// 3. Tall Bronze Finial Spire (Sorin) with Nine Rings (Kurin) on the Apex (y = 2.48m to y = 3.22m)
const sorinBaseY = baseTierY + 5 * tierHeight;
const sorinGroup = new THREE.Group();
sorinGroup.name = "bronze_sorin_finial_spire";
sorinGroup.position.set(0, sorinBaseY, 0);
pagodaGroup.add(sorinGroup);

const dewBasin = new THREE.Mesh(
  new THREE.BoxGeometry(0.18, 0.05, 0.18),
  bronzeSorinMat
);
dewBasin.name = "roban_dew_basin";
dewBasin.position.set(0, 0.025, 0);
sorinGroup.add(dewBasin);

const invertedBowl = new THREE.Mesh(
  new THREE.CylinderGeometry(0.07, 0.085, 0.05, 20),
  bronzeSorinMat
);
invertedBowl.name = "fukubachi_inverted_bowl";
invertedBowl.position.set(0, 0.075, 0);
sorinGroup.add(invertedBowl);

const spireShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.016, 0.028, 0.64, 16),
  bronzeSorinMat
);
spireShaft.name = "sorin_central_bronze_shaft";
spireShaft.position.set(0, 0.4, 0);
sorinGroup.add(spireShaft);

// Nine sacred bronze rings (Kurin) stacked along the spire
for (let r = 0; r < 9; r++) {
  const ringRadius = 0.062 - r * 0.0022;
  const kurinRing = new THREE.Mesh(
    new THREE.TorusGeometry(ringRadius, 0.006, 10, 24),
    bronzeSorinMat
  );
  kurinRing.name = `sorin_kurin_ring_${r + 1}`;
  kurinRing.rotation.x = Math.PI / 2;
  kurinRing.position.set(0, 0.14 + r * 0.044, 0);
  sorinGroup.add(kurinRing);
}

// Water flame ornament & sacred jewel (Hoju) at the very top (y = 3.2m)
const sacredJewel = new THREE.Mesh(
  new THREE.ConeGeometry(0.036, 0.09, 16),
  bronzeSorinMat
);
sacredJewel.name = "hoju_sacred_apex_jewel";
sacredJewel.position.set(0, 0.72, 0);
sorinGroup.add(sacredJewel);

// Frame camera at ~2.2x bounding radius
camera.position.set(2.85, 2.15, 3.25);
camera.lookAt(0, 1.55, 0);
