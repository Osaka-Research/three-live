const hummingbirdSceneRoot = new THREE.Group();
hummingbirdSceneRoot.name = "hummingbird_and_hibiscus_root";
scene.add(hummingbirdSceneRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const tropicalSunLight = new THREE.DirectionalLight(0xfff7e6, 1.45);
tropicalSunLight.name = "tropical_sun_directional_light";
tropicalSunLight.position.set(1.4, 2.2, 1.6);
scene.add(tropicalSunLight);

const gorgetSpecLight = new THREE.PointLight(0xff4d6d, 0.9, 3.0);
gorgetSpecLight.name = "ruby_throat_highlight_light";
gorgetSpecLight.position.set(0.1, 0.35, 0.45);
scene.add(gorgetSpecLight);

// Materials
const stemLeafMat = new THREE.MeshStandardMaterial({
  color: 0x2d6a32,
  roughness: 0.55,
  metalness: 0.04
});

const woodyStemMat = new THREE.MeshStandardMaterial({
  color: 0x4e3c2a,
  roughness: 0.85,
  metalness: 0.03
});

const hibiscusPetalMat = new THREE.MeshPhysicalMaterial({
  color: 0xdc143c,
  roughness: 0.32,
  metalness: 0.02,
  clearcoat: 0.35,
  sheen: 0.85,
  sheenColor: 0xff6b8b,
  sheenRoughness: 0.3
});

const hibiscusThroatMat = new THREE.MeshPhysicalMaterial({
  color: 0x7f1d1d,
  roughness: 0.25,
  clearcoat: 0.5
});

const stamenGoldMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  emissive: 0xca8a04,
  emissiveIntensity: 0.25,
  roughness: 0.35
});

const emeraldIridescentMat = new THREE.MeshPhysicalMaterial({
  color: 0x10b981,
  roughness: 0.18,
  metalness: 0.45,
  clearcoat: 0.9,
  clearcoatRoughness: 0.1,
  iridescence: 1.0,
  iridescenceIOR: 1.42
});

const rubyGorgetMat = new THREE.MeshPhysicalMaterial({
  color: 0xe11d48,
  emissive: 0x9f1239,
  emissiveIntensity: 0.35,
  roughness: 0.12,
  metalness: 0.78,
  clearcoat: 1.0,
  iridescence: 0.85,
  iridescenceIOR: 1.5
});

const breastWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xf1f5f9,
  roughness: 0.55,
  metalness: 0.02
});

const wingFeatherMat = new THREE.MeshPhysicalMaterial({
  color: 0x1e293b,
  roughness: 0.35,
  metalness: 0.25,
  iridescence: 0.45
});

const beakDarkMat = new THREE.MeshStandardMaterial({
  color: 0x111827,
  roughness: 0.22,
  metalness: 0.3
});

// 1. Hibiscus Garden Stem & Tropical Leaves (rooted at y = 0)
const plantGroup = new THREE.Group();
plantGroup.name = "tropical_hibiscus_plant_group";
hummingbirdSceneRoot.add(plantGroup);

// Compact terracotta garden pot base at y = 0
const baseDisk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.08, 0.065, 0.07, 24),
  new THREE.MeshStandardMaterial({ color: 0xb4532a, roughness: 0.75 })
);
baseDisk.name = "garden_terracotta_pot_base";
baseDisk.position.set(-0.18, 0.035, 0);
plantGroup.add(baseDisk);

const stemLower = new THREE.Mesh(
  new THREE.CylinderGeometry(0.008, 0.012, 0.28, 12),
  woodyStemMat
);
stemLower.name = "hibiscus_main_woody_stem";
stemLower.position.set(-0.17, 0.18, 0);
stemLower.rotation.z = -0.08;
plantGroup.add(stemLower);

// Tropical green hibiscus leaves along the stem
const leafConfigs = [
  { name: "hibiscus_leaf_1", pos: [-0.22, 0.16, 0.03], rot: [0.3, 0.4, 0.8], scale: [0.065, 0.008, 0.042] },
  { name: "hibiscus_leaf_2", pos: [-0.13, 0.21, -0.04], rot: [-0.3, -0.5, -0.7], scale: [0.060, 0.008, 0.038] },
  { name: "hibiscus_leaf_3", pos: [-0.21, 0.26, -0.02], rot: [0.2, -0.2, 0.9], scale: [0.055, 0.008, 0.036] }
];
leafConfigs.forEach((lf) => {
  const leafMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 16, 12), stemLeafMat);
  leafMesh.name = lf.name;
  leafMesh.position.set(lf.pos[0], lf.pos[1], lf.pos[2]);
  leafMesh.rotation.set(lf.rot[0], lf.rot[1], lf.rot[2]);
  leafMesh.scale.set(lf.scale[0], lf.scale[1], lf.scale[2]);
  plantGroup.add(leafMesh);
});

// 2. Tropical Red Hibiscus Blossom & Long Protruding Stamen Column
const flowerGroup = new THREE.Group();
flowerGroup.name = "tropical_red_hibiscus_blossom_group";
flowerGroup.position.set(-0.15, 0.31, 0);
// Orient flower opening toward the hovering hummingbird on the right (+X)
flowerGroup.rotation.z = -Math.PI / 2 + 0.18;
plantGroup.add(flowerGroup);

// Green calyx cup (ConeGeometry)
const calyxCup = new THREE.Mesh(
  new THREE.ConeGeometry(0.026, 0.045, 10),
  stemLeafMat
);
calyxCup.name = "hibiscus_green_calyx_cup";
calyxCup.rotation.x = Math.PI;
calyxCup.position.y = -0.015;
flowerGroup.add(calyxCup);

// Deep crimson nectar throat core
const flowerThroat = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.008, 0.032, 16),
  hibiscusThroatMat
);
flowerThroat.name = "hibiscus_deep_nectar_throat";
flowerGroup.add(flowerThroat);

// 5 Overlapping Ruffled Crimson Petals
for (let p = 0; p < 5; p++) {
  const pAngle = (p / 5) * Math.PI * 2.0;
  const petalPivot = new THREE.Group();
  petalPivot.name = `hibiscus_petal_${p + 1}_pivot`;
  petalPivot.rotation.y = pAngle;
  flowerGroup.add(petalPivot);

  const petalMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.062, 20, 16),
    hibiscusPetalMat
  );
  petalMesh.name = `hibiscus_ruffled_crimson_petal_${p + 1}`;
  petalMesh.scale.set(1.15, 0.12, 0.82);
  petalMesh.position.set(0.058, 0.024, 0.006);
  petalMesh.rotation.z = 0.42;
  petalMesh.rotation.x = 0.16; // Slight pinwheel overlap
  petalPivot.add(petalMesh);
}

// Long Protruding Stamen Column (CylinderGeometry) with Golden Anthers & 5 Stigma Pads
const stamenColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0028, 0.0055, 0.135, 12),
  hibiscusPetalMat
);
stamenColumn.name = "hibiscus_protruding_stamen_column";
stamenColumn.position.y = 0.068;
flowerGroup.add(stamenColumn);

// 24 Golden Pollen Anthers bristling around the distal half of the stamen column
for (let a = 0; a < 24; a++) {
  const yPos = 0.072 + (a / 24) * 0.048;
  const theta = a * 2.39996;
  const r = 0.011;

  const filament = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0008, 0.0008, r, 6),
    hibiscusPetalMat
  );
  filament.name = `stamen_anther_filament_${a + 1}`;
  filament.position.set(Math.cos(theta) * r * 0.5, yPos, Math.sin(theta) * r * 0.5);
  filament.rotation.z = -Math.PI / 2;
  filament.rotation.y = -theta;
  flowerGroup.add(filament);

  const antherHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.0028, 8, 8),
    stamenGoldMat
  );
  antherHead.name = `stamen_golden_pollen_anther_${a + 1}`;
  antherHead.position.set(Math.cos(theta) * r, yPos, Math.sin(theta) * r);
  flowerGroup.add(antherHead);
}

// 5 Velvet Crimson Stigma Pads at the very tip of the column
for (let st = 0; st < 5; st++) {
  const stAngle = (st / 5) * Math.PI * 2.0;
  const stigmaPad = new THREE.Mesh(
    new THREE.SphereGeometry(0.0042, 10, 8),
    hibiscusThroatMat
  );
  stigmaPad.name = `hibiscus_tip_stigma_pad_${st + 1}`;
  stigmaPad.position.set(Math.cos(stAngle) * 0.006, 0.138, Math.sin(stAngle) * 0.006);
  flowerGroup.add(stigmaPad);
}

// 3. Hovering Ruby-Throated Hummingbird Feeding at the Hibiscus
const birdGroup = new THREE.Group();
birdGroup.name = "ruby_throated_hummingbird_group";
birdGroup.position.set(0.13, 0.34, 0.0);
hummingbirdSceneRoot.add(birdGroup);

// Torso: Iridescent Emerald Green Back + Pearl White Underbelly (SphereGeometry)
const birdTorso = new THREE.Mesh(
  new THREE.SphereGeometry(0.036, 24, 18),
  emeraldIridescentMat
);
birdTorso.name = "hummingbird_iridescent_green_body";
birdTorso.scale.set(1.35, 0.88, 0.85);
birdTorso.rotation.z = -0.58; // Hovering body posture
birdGroup.add(birdTorso);

const birdBelly = new THREE.Mesh(
  new THREE.SphereGeometry(0.032, 20, 16),
  breastWhiteMat
);
birdBelly.name = "hummingbird_white_underbelly";
birdBelly.scale.set(1.22, 0.78, 0.80);
birdBelly.position.set(-0.008, -0.006, 0);
birdBelly.rotation.z = -0.58;
birdGroup.add(birdBelly);

// Metallic Ruby-Red Gorget Throat Patch
const rubyGorget = new THREE.Mesh(
  new THREE.SphereGeometry(0.024, 20, 16),
  rubyGorgetMat
);
rubyGorget.name = "hummingbird_metallic_ruby_gorget_throat";
rubyGorget.scale.set(1.05, 0.85, 0.92);
rubyGorget.position.set(-0.036, 0.020, 0);
rubyGorget.rotation.z = -0.45;
birdGroup.add(rubyGorget);

// Iridescent Emerald Crown Head & Eyes
const birdHead = new THREE.Mesh(
  new THREE.SphereGeometry(0.025, 22, 18),
  emeraldIridescentMat
);
birdHead.name = "hummingbird_emerald_crown_head";
birdHead.scale.set(1.15, 0.95, 0.92);
birdHead.position.set(-0.042, 0.036, 0);
birdGroup.add(birdHead);

[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.0042, 10, 8),
    beakDarkMat
  );
  eye.name = `hummingbird_${prefix}_eye`;
  eye.position.set(-0.052, 0.040, side * 0.019);
  birdGroup.add(eye);
});

// Long Needle Beak reaching into the hibiscus blossom (ConeGeometry)
const needleBeak = new THREE.Mesh(
  new THREE.ConeGeometry(0.0042, 0.088, 12),
  beakDarkMat
);
needleBeak.name = "hummingbird_needle_beak";
needleBeak.position.set(-0.102, 0.030, 0);
needleBeak.rotation.z = Math.PI / 2 + 0.12;
birdGroup.add(needleBeak);

// Swept Hovering Wings (Left & Right Wing Groups with Feathered Remiges)
const wingPivots = [];
[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  const wingGroup = new THREE.Group();
  wingGroup.name = `hummingbird_${prefix}_swept_wing_group`;
  wingGroup.position.set(-0.012, 0.022, side * 0.024);
  wingGroup.rotation.x = side * 0.48;
  wingGroup.rotation.y = -side * 0.35;
  wingGroup.rotation.z = -0.35;
  birdGroup.add(wingGroup);
  wingPivots.push({ group: wingGroup, side });

  // 8 Overlapping Primary Flight Feathers per Wing (flattened ConeGeometry)
  for (let f = 0; f < 8; f++) {
    const frac = f / 7;
    const featherLen = 0.115 - frac * 0.045;
    const feather = new THREE.Mesh(
      new THREE.ConeGeometry(0.012, featherLen, 8),
      f < 2 ? emeraldIridescentMat : wingFeatherMat
    );
    feather.name = `hummingbird_${prefix}_wing_feather_${f + 1}`;
    feather.scale.set(1.0, 1.0, 0.18);
    feather.position.set(0.018 + frac * 0.022, 0.042 - frac * 0.015, side * 0.032);
    feather.rotation.z = -0.25 - frac * 0.38;
    feather.rotation.x = side * 0.72;
    wingGroup.add(feather);
  }
});

// Fanned Tail Feathers (7 Rectrices fanned behind the lower body)
const tailGroup = new THREE.Group();
tailGroup.name = "hummingbird_fanned_tail_feathers_group";
tailGroup.position.set(0.038, -0.028, 0);
birdGroup.add(tailGroup);

for (let t = -3; t <= 3; t++) {
  const tailFeather = new THREE.Mesh(
    new THREE.ConeGeometry(0.010, 0.068, 8),
    Math.abs(t) <= 1 ? emeraldIridescentMat : wingFeatherMat
  );
  tailFeather.name = `hummingbird_tail_feather_${t + 4}`;
  tailFeather.scale.set(0.22, 1.0, 1.0);
  tailFeather.position.set(0.025, -0.018, t * 0.008);
  tailFeather.rotation.z = 2.15;
  tailFeather.rotation.x = t * 0.16;
  tailGroup.add(tailFeather);
}

// High-frequency hovering wing & bobbing animation
function animate(t) {
  birdGroup.position.y = 0.34 + Math.sin(t * 4.0) * 0.008;
  const wingFlap = Math.sin(t * 28.0) * 0.45;
  wingPivots.forEach(({ group, side }) => {
    group.rotation.x = side * (0.52 + wingFlap);
  });
}

// Camera Framing (width ~0.46m, height ~0.44m, center ~0.24m)
camera.position.set(0.0, 0.28, 0.76);
camera.lookAt(-0.02, 0.24, 0);
