// Steampunk Hinged Brass Surveyor's Pocket Transit Compass (~0.3m scale) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff4dc, 1.4);
keyLight.name = "key_directional_light";
keyLight.position.set(0.8, 1.4, 1.0);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd5e6ff, 0.6);
fillLight.name = "fill_directional_light";
fillLight.position.set(-0.9, 0.9, -0.8);
scene.add(fillLight);

const compassGroup = new THREE.Group();
compassGroup.name = "steampunk_brass_pocket_transit_compass";
scene.add(compassGroup);

// Materials
const polishedBrassMat = new THREE.MeshStandardMaterial({
  color: 0xd9ad42,
  metalness: 0.9,
  roughness: 0.2
});

const antiqueBronzeMat = new THREE.MeshStandardMaterial({
  color: 0x8a6421,
  metalness: 0.84,
  roughness: 0.36
});

const silverDialMat = new THREE.MeshStandardMaterial({
  color: 0xe6e4dc,
  metalness: 0.65,
  roughness: 0.28
});

const bluedSteelMat = new THREE.MeshStandardMaterial({
  color: 0x16428b,
  metalness: 0.88,
  roughness: 0.18
});

const crimsonAgateMat = new THREE.MeshStandardMaterial({
  color: 0xc81e32,
  metalness: 0.25,
  roughness: 0.14
});

const spiritBubbleGreenMat = new THREE.MeshPhysicalMaterial({
  color: 0x66ff44,
  emissive: 0x1a5508,
  emissiveIntensity: 0.35,
  transmission: 0.85,
  ior: 1.48,
  thickness: 0.008,
  roughness: 0.08,
  transparent: true,
  opacity: 0.92
});

const bevelGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xf4fbff,
  transmission: 0.92,
  ior: 1.52,
  thickness: 0.006,
  roughness: 0.04,
  metalness: 0.0,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.9
});

// 1. Ornate Octagonal/Circular Brass Compass Bowl Resting on y = 0 (radius = 0.135m)
const baseOctagon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.142, 0.148, 0.018, 8),
  antiqueBronzeMat
);
baseOctagon.name = "octagonal_brass_base_plate";
baseOctagon.position.set(0, 0.009, 0);
compassGroup.add(baseOctagon);

const bowlWallRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.125, 0.018, 16, 48),
  polishedBrassMat
);
bowlWallRing.name = "brass_compass_housing_rim";
bowlWallRing.rotation.x = Math.PI / 2;
bowlWallRing.position.set(0, 0.032, 0);
compassGroup.add(bowlWallRing);

const compassFloor = new THREE.Mesh(
  new THREE.CylinderGeometry(0.118, 0.118, 0.008, 48),
  silverDialMat
);
compassFloor.name = "silvered_compass_rose_dial";
compassFloor.position.set(0, 0.02, 0);
compassGroup.add(compassFloor);

// 2. Engraved Degree Ring & 16 Cardinal/Intercardinal Tick Marks
const degreeBezelRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.108, 0.008, 12, 48),
  antiqueBronzeMat
);
degreeBezelRing.name = "engraved_azimuth_degree_ring";
degreeBezelRing.rotation.x = Math.PI / 2;
degreeBezelRing.position.set(0, 0.028, 0);
compassGroup.add(degreeBezelRing);

for (let i = 0; i < 16; i++) {
  const ang = (i / 16) * Math.PI * 2;
  const isCardinal = i % 4 === 0;
  const tickLen = isCardinal ? 0.024 : 0.014;
  const tickR = 0.095 - tickLen / 2;

  const tick = new THREE.Mesh(
    new THREE.BoxGeometry(isCardinal ? 0.005 : 0.0025, 0.003, tickLen),
    isCardinal ? polishedBrassMat : antiqueBronzeMat
  );
  tick.name = `degree_ring_tick_mark_${i + 1}`;
  tick.position.set(Math.sin(ang) * tickR, 0.025, Math.cos(ang) * tickR);
  tick.rotation.y = ang;
  compassGroup.add(tick);
}

// 3. Two Tubular Spirit-Level Vials Mounted Orthogonal on the Compass Plate
const vialConfigs = [
  { name: "longitudinal_spirit_level_vial", x: -0.048, z: 0.038, rotY: 0 },
  { name: "transverse_spirit_level_vial", x: 0.048, z: 0.038, rotY: Math.PI / 2 }
];

for (const vc of vialConfigs) {
  const vialGroup = new THREE.Group();
  vialGroup.name = vc.name;
  vialGroup.position.set(vc.x, 0.029, vc.z);
  vialGroup.rotation.y = vc.rotY;
  compassGroup.add(vialGroup);

  const glassTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0065, 0.0065, 0.046, 16),
    spiritBubbleGreenMat
  );
  glassTube.name = `${vc.name}_tube`;
  glassTube.rotation.z = Math.PI / 2;
  vialGroup.add(glassTube);

  for (const endSide of [-1, 1]) {
    const brassCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.008, 12),
      polishedBrassMat
    );
    brassCap.name = `${vc.name}_cap_${endSide < 0 ? "L" : "R"}`;
    brassCap.rotation.z = Math.PI / 2;
    brassCap.position.set(endSide * 0.022, 0, 0);
    vialGroup.add(brassCap);
  }
}

// 4. Magnetic Needle Balanced on a Central Agate Pivot
const pivotPedestal = new THREE.Mesh(
  new THREE.ConeGeometry(0.012, 0.024, 16),
  polishedBrassMat
);
pivotPedestal.name = "central_needle_pivot_cone";
pivotPedestal.position.set(0, 0.032, 0);
compassGroup.add(pivotPedestal);

const needleGroup = new THREE.Group();
needleGroup.name = "magnetic_needle_assembly";
needleGroup.position.set(0, 0.042, 0);
needleGroup.rotation.y = 0.42;
compassGroup.add(needleGroup);

const northHalf = new THREE.Mesh(
  new THREE.ConeGeometry(0.008, 0.095, 4),
  bluedSteelMat
);
northHalf.name = "magnetic_needle_north_pointer";
northHalf.rotation.x = Math.PI / 2;
northHalf.position.set(0, 0, 0.0475);
needleGroup.add(northHalf);

const southHalf = new THREE.Mesh(
  new THREE.ConeGeometry(0.008, 0.095, 4),
  polishedBrassMat
);
southHalf.name = "magnetic_needle_south_pointer";
southHalf.rotation.x = -Math.PI / 2;
southHalf.position.set(0, 0, -0.0475);
needleGroup.add(southHalf);

const agateCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.011, 0.013, 0.009, 20),
  crimsonAgateMat
);
agateCap.name = "central_agate_jewel_pivot_cap";
agateCap.position.set(0, 0.003, 0);
needleGroup.add(agateCap);

// 5. Folding Sighting Vane with Hairline Slot (at front +Z edge)
const sightVaneGroup = new THREE.Group();
sightVaneGroup.name = "folding_sighting_vane";
sightVaneGroup.position.set(0, 0.035, 0.135);
sightVaneGroup.rotation.x = -0.15;
compassGroup.add(sightVaneGroup);

for (const railSide of [-1, 1]) {
  const vaneRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.007, 0.14, 0.004),
    polishedBrassMat
  );
  vaneRail.name = `sighting_vane_blade_${railSide < 0 ? "left" : "right"}`;
  vaneRail.position.set(railSide * 0.007, 0.07, 0);
  sightVaneGroup.add(vaneRail);
}

const vaneTopBridge = new THREE.Mesh(
  new THREE.TorusGeometry(0.014, 0.004, 10, 20),
  polishedBrassMat
);
vaneTopBridge.name = "sighting_vane_peep_ring";
vaneTopBridge.position.set(0, 0.145, 0);
sightVaneGroup.add(vaneTopBridge);

const hairlineWire = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0008, 0.0008, 0.14, 6),
  bluedSteelMat
);
hairlineWire.name = "sighting_vane_hairline_wire";
hairlineWire.position.set(0, 0.07, 0);
sightVaneGroup.add(hairlineWire);

// 6. Hinged Lid with Glass Viewing Window & Sighting Mirror (at rear -Z edge, opened to ~115 deg)
const hingeBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.008, 0.008, 0.048, 16),
  antiqueBronzeMat
);
hingeBarrel.name = "rear_lid_knuckle_hinge";
hingeBarrel.rotation.z = Math.PI / 2;
hingeBarrel.position.set(0, 0.042, -0.135);
compassGroup.add(hingeBarrel);

const lidGroup = new THREE.Group();
lidGroup.name = "hinged_brass_lid_with_glass_window";
lidGroup.position.set(0, 0.042, -0.135);
lidGroup.rotation.x = -1.95; // Propped open past vertical
compassGroup.add(lidGroup);

const lidRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.122, 0.014, 16, 48),
  polishedBrassMat
);
lidRim.name = "hinged_lid_outer_brass_rim";
lidRim.rotation.x = Math.PI / 2;
lidRim.position.set(0, 0, 0.125);
lidGroup.add(lidRim);

const lidWindowGlass = new THREE.Mesh(
  new THREE.CylinderGeometry(0.115, 0.115, 0.006, 36),
  bevelGlassMat
);
lidWindowGlass.name = "hinged_lid_glass_window";
lidWindowGlass.position.set(0, 0, 0.125);
lidGroup.add(lidWindowGlass);

// Frame camera at ~2.2x bounding radius
camera.position.set(0.38, 0.34, 0.44);
camera.lookAt(0, 0.1, -0.02);
