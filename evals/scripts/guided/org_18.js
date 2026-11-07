const terrariumRoot = new THREE.Group();
terrariumRoot.name = "geometric_glass_terrarium_root";
scene.add(terrariumRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunKeyLight = new THREE.DirectionalLight(0xfff9eb, 1.35);
sunKeyLight.name = "window_sun_directional_light";
sunKeyLight.position.set(1.2, 2.0, 1.5);
scene.add(sunKeyLight);

const crystalFillLight = new THREE.PointLight(0xf5d0fe, 0.75, 3.0);
crystalFillLight.name = "quartz_dispersion_fill_light";
crystalFillLight.position.set(-0.8, 0.6, 0.8);
scene.add(crystalFillLight);

// Materials
const antiqueBrassMat = new THREE.MeshStandardMaterial({
  color: 0xb8860b,
  roughness: 0.28,
  metalness: 0.88
});

const clearGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xf8fafc,
  roughness: 0.05,
  metalness: 0.0,
  transmission: 0.90,
  ior: 1.50,
  thickness: 0.008,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.38,
  side: THREE.DoubleSide
});

const pebbleMat = new THREE.MeshStandardMaterial({
  color: 0x94a3b8,
  roughness: 0.75,
  metalness: 0.05
});

const charcoalLayerMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.92
});

const soilLayerMat = new THREE.MeshStandardMaterial({
  color: 0x452c1e,
  roughness: 0.9
});

const topSandMat = new THREE.MeshStandardMaterial({
  color: 0xd6c7b2,
  roughness: 0.82
});

const echeveriaLeafMat = new THREE.MeshPhysicalMaterial({
  color: 0x5ea89c,
  roughness: 0.42,
  metalness: 0.02,
  clearcoat: 0.2,
  sheen: 0.6,
  sheenColor: 0xa7f3d0
});

const echeveriaTipMat = new THREE.MeshPhysicalMaterial({
  color: 0xd9778b,
  roughness: 0.38,
  sheen: 0.5
});

const barrelCactusMat = new THREE.MeshStandardMaterial({
  color: 0x3f7a44,
  roughness: 0.58,
  metalness: 0.04
});

const cactusSpineMat = new THREE.MeshStandardMaterial({
  color: 0xfef08a,
  roughness: 0.35
});

const quartzCrystalMat = new THREE.MeshPhysicalMaterial({
  color: 0xf5d0fe,
  roughness: 0.06,
  metalness: 0.02,
  transmission: 0.92,
  ior: 1.54,
  thickness: 0.03,
  dispersion: 0.04,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.92
});

// 1. Faceted Dodecahedron-Style Brass-and-Glass Tabletop Terrarium (~0.40m wide, resting at y = 0)
const frameGroup = new THREE.Group();
frameGroup.name = "dodecahedron_brass_glass_terrarium_frame";
terrariumRoot.add(frameGroup);

// Define 3 rings of 6-sided faceted polyhedral vertices for a ~0.40m wide tabletop terrarium:
// Bottom ring at y = 0.008m (radius 0.125m)
// Equator ring at y = 0.165m (radius 0.200m => 0.40m diameter)
// Upper shoulder ring at y = 0.315m (radius 0.135m)
// Apex point at y = 0.375m
const numSides = 6;
const bottomRing = [];
const midRing = [];
const topRing = [];
const apexVertex = new THREE.Vector3(0, 0.375, 0);

for (let i = 0; i < numSides; i++) {
  // Rotate by PI/6 so flat front facet faces +Z directly toward the viewer
  const a = (i / numSides) * Math.PI * 2.0 + Math.PI / 6;
  bottomRing.push(new THREE.Vector3(Math.cos(a) * 0.125, 0.008, Math.sin(a) * 0.125));
  midRing.push(new THREE.Vector3(Math.cos(a) * 0.200, 0.165, Math.sin(a) * 0.200));
  topRing.push(new THREE.Vector3(Math.cos(a) * 0.135, 0.315, Math.sin(a) * 0.135));
}

function addBrassStrut(name, p1, p2) {
  const diff = new THREE.Vector3().subVectors(p2, p1);
  const len = diff.length();
  const strut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0042, 0.0042, len, 10),
    antiqueBrassMat
  );
  strut.name = name;
  strut.position.addVectors(p1, p2).multiplyScalar(0.5);
  strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), diff.normalize());
  frameGroup.add(strut);
}

// Soldered brass struts & vertex solder joints
for (let i = 0; i < numSides; i++) {
  const next = (i + 1) % numSides;
  addBrassStrut(`brass_strut_bottom_ring_${i + 1}`, bottomRing[i], bottomRing[next]);
  addBrassStrut(`brass_strut_mid_ring_${i + 1}`, midRing[i], midRing[next]);
  addBrassStrut(`brass_strut_top_ring_${i + 1}`, topRing[i], topRing[next]);

  addBrassStrut(`brass_strut_lower_rib_${i + 1}`, bottomRing[i], midRing[i]);
  addBrassStrut(`brass_strut_upper_rib_${i + 1}`, midRing[i], topRing[i]);
  addBrassStrut(`brass_strut_apex_rib_${i + 1}`, topRing[i], apexVertex);

  // Brass corner solder spheres
  [bottomRing[i], midRing[i], topRing[i]].forEach((v, tierIdx) => {
    const joint = new THREE.Mesh(
      new THREE.SphereGeometry(0.0062, 10, 8),
      antiqueBrassMat
    );
    joint.name = `brass_solder_joint_t${tierIdx + 1}_${i + 1}`;
    joint.position.copy(v);
    frameGroup.add(joint);
  });
}

// Brass hanging ring finial at apex
const apexJoint = new THREE.Mesh(
  new THREE.SphereGeometry(0.008, 12, 10),
  antiqueBrassMat
);
apexJoint.name = "brass_apex_finial_joint";
apexJoint.position.copy(apexVertex);
frameGroup.add(apexJoint);

// Transmissive Glass Facet Panels (leave front-facing upper panel i=0 open as the terrarium access window)
for (let i = 0; i < numSides; i++) {
  // Lower wall glass panel
  const angleMid = ((i + 0.5) / numSides) * Math.PI * 2.0 + Math.PI / 6;
  const lowerCenter = new THREE.Vector3()
    .add(bottomRing[i])
    .add(bottomRing[(i + 1) % numSides])
    .add(midRing[i])
    .add(midRing[(i + 1) % numSides])
    .multiplyScalar(0.25);

  const lowerGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.088, 0.062, 0.17, 4, 1),
    clearGlassMat
  );
  lowerGlass.name = `terrarium_lower_glass_panel_${i + 1}`;
  lowerGlass.scale.set(1.0, 1.0, 0.04);
  lowerGlass.position.copy(lowerCenter);
  lowerGlass.rotation.y = -angleMid + Math.PI / 2;
  lowerGlass.rotation.x = -0.44;
  frameGroup.add(lowerGlass);

  // Upper wall glass panel (skip i === 1 which faces +Z so the interior succulents are framed through an open window)
  if (i !== 1) {
    const upperCenter = new THREE.Vector3()
      .add(midRing[i])
      .add(midRing[(i + 1) % numSides])
      .add(topRing[i])
      .add(topRing[(i + 1) % numSides])
      .multiplyScalar(0.25);

    const upperGlass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.088, 0.16, 4, 1),
      clearGlassMat
    );
    upperGlass.name = `terrarium_upper_glass_panel_${i + 1}`;
    upperGlass.scale.set(1.0, 1.0, 0.04);
    upperGlass.position.copy(upperCenter);
    upperGlass.rotation.y = -angleMid + Math.PI / 2;
    upperGlass.rotation.x = 0.41;
    frameGroup.add(upperGlass);
  }
}

// 2. Layered Substrate (Drainage Pebbles, Activated Charcoal, Potting Soil & Decorative Stones)
const substrateGroup = new THREE.Group();
substrateGroup.name = "terrarium_layered_substrate_group";
terrariumRoot.add(substrateGroup);

const charcoalDisk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.132, 0.118, 0.025, 6),
  charcoalLayerMat
);
charcoalDisk.name = "substrate_charcoal_drainage_layer";
charcoalDisk.rotation.y = Math.PI / 6;
charcoalDisk.position.set(0, 0.024, 0);
substrateGroup.add(charcoalDisk);

const soilDisk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.155, 0.132, 0.048, 6),
  soilLayerMat
);
soilDisk.name = "substrate_potting_soil_layer";
soilDisk.rotation.y = Math.PI / 6;
soilDisk.position.set(0, 0.060, 0);
substrateGroup.add(soilDisk);

const topSoilCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.162, 0.155, 0.016, 6),
  topSandMat
);
topSoilCap.name = "substrate_top_dressing_sand_layer";
topSoilCap.rotation.y = Math.PI / 6;
topSoilCap.position.set(0, 0.092, 0);
substrateGroup.add(topSoilCap);

// Ring of drainage river pebbles visible along the bottom glass perimeter & soil surface
for (let p = 0; p < 18; p++) {
  const pAngle = (p / 18) * Math.PI * 2.0;
  const r = p < 12 ? 0.115 : 0.085;
  const y = p < 12 ? 0.022 : 0.102;
  const pebble = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 10, 8),
    pebbleMat
  );
  pebble.name = `drainage_river_pebble_${p + 1}`;
  pebble.scale.set(1.2, 0.65, 0.95);
  pebble.position.set(Math.cos(pAngle) * r, y, Math.sin(pAngle) * r);
  pebble.rotation.y = p * 0.7;
  substrateGroup.add(pebble);
}

// 3. Rosette Echeveria Succulent with Fleshy Spiral Leaves (Front-Left)
const echeveriaGroup = new THREE.Group();
echeveriaGroup.name = "rosette_echeveria_succulent_group";
echeveriaGroup.position.set(-0.048, 0.102, 0.025);
terrariumRoot.add(echeveriaGroup);

const numLeaves = 28;
const goldenAngle = 2.3999632;

for (let l = 0; l < numLeaves; l++) {
  const frac = l / (numLeaves - 1); // 0 = tight center bud, 1 = outer rosette leaves
  const theta = l * goldenAngle;
  const leafLen = 0.020 + frac * 0.042;
  const leafWidth = 0.011 + frac * 0.015;
  const tilt = 0.25 + frac * 1.05;

  const leafHolder = new THREE.Group();
  leafHolder.name = `echeveria_leaf_${l + 1}_holder`;
  leafHolder.rotation.y = theta;
  leafHolder.rotation.z = -tilt;
  echeveriaGroup.add(leafHolder);

  // Fleshy spoon-shaped succulent leaf body
  const leafBody = new THREE.Mesh(
    new THREE.SphereGeometry(1.0, 14, 10),
    echeveriaLeafMat
  );
  leafBody.name = `echeveria_fleshy_leaf_body_${l + 1}`;
  leafBody.scale.set(leafWidth * 0.55, leafLen * 0.5, leafWidth);
  leafBody.position.set(0, leafLen * 0.52, 0);
  leafHolder.add(leafBody);

  // Pointed pink mucronate tip (ConeGeometry)
  const leafTip = new THREE.Mesh(
    new THREE.ConeGeometry(leafWidth * 0.55, leafLen * 0.28, 10),
    echeveriaTipMat
  );
  leafTip.name = `echeveria_pink_leaf_tip_${l + 1}`;
  leafTip.scale.set(0.65, 1.0, 1.0);
  leafTip.position.set(0, leafLen * 0.98, 0);
  leafHolder.add(leafTip);
}

// 4. Ribbed Barrel Cactus (Echinocactus) on Right Side
const cactusGroup = new THREE.Group();
cactusGroup.name = "ribbed_barrel_cactus_group";
cactusGroup.position.set(0.062, 0.145, -0.018);
terrariumRoot.add(cactusGroup);

const cactusRadius = 0.048;
const cactusCore = new THREE.Mesh(
  new THREE.SphereGeometry(cactusRadius, 20, 16),
  barrelCactusMat
);
cactusCore.name = "barrel_cactus_globular_core";
cactusCore.scale.set(1.0, 1.12, 1.0);
cactusGroup.add(cactusCore);

// 12 Vertical Ribs + Golden Spine Areoles around the Barrel Cactus
const numCactusRibs = 12;
for (let r = 0; r < numCactusRibs; r++) {
  const rAngle = (r / numCactusRibs) * Math.PI * 2.0;
  const ribLobe = new THREE.Mesh(
    new THREE.SphereGeometry(cactusRadius * 0.34, 12, 14),
    barrelCactusMat
  );
  ribLobe.name = `barrel_cactus_vertical_rib_${r + 1}`;
  ribLobe.position.set(Math.cos(rAngle) * (cactusRadius * 0.78), 0, Math.sin(rAngle) * (cactusRadius * 0.78));
  ribLobe.scale.set(0.55, 1.32, 0.55);
  ribLobe.rotation.y = -rAngle;
  cactusGroup.add(ribLobe);

  // Golden conical spines along the crest of each rib
  [-0.018, 0.008, 0.030].forEach((yOff, sIdx) => {
    const spine = new THREE.Mesh(
      new THREE.ConeGeometry(0.0022, 0.018, 6),
      cactusSpineMat
    );
    spine.name = `barrel_cactus_rib_${r + 1}_spine_${sIdx + 1}`;
    const radialDist = cactusRadius * 0.98;
    spine.position.set(Math.cos(rAngle) * radialDist, yOff, Math.sin(rAngle) * radialDist);
    spine.rotation.z = -Math.PI / 2 + yOff * 8.0;
    spine.rotation.y = -rAngle;
    cactusGroup.add(spine);
  });
}

// 5. Small Hexagonal Quartz Crystal Cluster (Back-Left & Front-Right)
const quartzGroup = new THREE.Group();
quartzGroup.name = "quartz_crystals_cluster_group";
quartzGroup.position.set(0.018, 0.100, 0.068);
terrariumRoot.add(quartzGroup);

const crystalSpecs = [
  { name: "quartz_point_main", pos: [0.0, 0.0, 0.0], r: 0.014, h: 0.058, rot: [0.15, 0.2, -0.18] },
  { name: "quartz_point_left", pos: [-0.016, 0.0, 0.008], r: 0.011, h: 0.044, rot: [0.28, -0.3, 0.32] },
  { name: "quartz_point_right", pos: [0.015, 0.0, -0.005], r: 0.010, h: 0.038, rot: [-0.20, 0.5, -0.38] },
  { name: "quartz_point_back", pos: [-0.045, 0.0, -0.105], r: 0.015, h: 0.064, rot: [-0.15, 0.8, 0.14] }
];

crystalSpecs.forEach((cr) => {
  const crUnit = new THREE.Group();
  crUnit.name = `${cr.name}_unit`;
  crUnit.position.set(cr.pos[0], cr.pos[1], cr.pos[2]);
  crUnit.rotation.set(cr.rot[0], cr.rot[1], cr.rot[2]);
  quartzGroup.add(crUnit);

  // Hexagonal prism shaft (CylinderGeometry with 6 radial segments)
  const prismShaft = new THREE.Mesh(
    new THREE.CylinderGeometry(cr.r, cr.r, cr.h, 6),
    quartzCrystalMat
  );
  prismShaft.name = `${cr.name}_hexagonal_shaft`;
  prismShaft.position.y = cr.h * 0.5;
  crUnit.add(prismShaft);

  // Hexagonal pyramid termination tip (ConeGeometry with 6 radial segments)
  const pyramidTip = new THREE.Mesh(
    new THREE.ConeGeometry(cr.r, cr.r * 1.45, 6),
    quartzCrystalMat
  );
  pyramidTip.name = `${cr.name}_pyramid_tip`;
  pyramidTip.position.y = cr.h + cr.r * 0.725;
  crUnit.add(pyramidTip);
});

// Camera Framing (width ~0.40m, height ~0.38m, center ~0.19m)
camera.position.set(0.0, 0.24, 0.62);
camera.lookAt(0, 0.18, 0);
