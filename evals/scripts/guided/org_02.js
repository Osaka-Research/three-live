const bonsaiRoot = new THREE.Group();
bonsaiRoot.name = "windswept_juniper_bonsai_root";
scene.add(bonsaiRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e4, 1.35);
sunLight.name = "sun_directional_light";
sunLight.position.set(1.4, 2.2, 1.2);
scene.add(sunLight);

const fillLight = new THREE.PointLight(0xcfe8ff, 0.6, 4.0);
fillLight.name = "sky_fill_light";
fillLight.position.set(-1.2, 1.0, -0.8);
scene.add(fillLight);

// Materials
const potGlazeMat = new THREE.MeshStandardMaterial({
  color: 0x2c4c5e,
  roughness: 0.25,
  metalness: 0.12
});

const potClayRimMat = new THREE.MeshStandardMaterial({
  color: 0x4b382a,
  roughness: 0.72,
  metalness: 0.05
});

const mossMat = new THREE.MeshStandardMaterial({
  color: 0x4b7832,
  roughness: 0.92,
  metalness: 0.02
});

const barkMat = new THREE.MeshStandardMaterial({
  color: 0x6e4a35,
  roughness: 0.88,
  metalness: 0.03
});

const jinDeadwoodMat = new THREE.MeshStandardMaterial({
  color: 0xd8cfc0,
  roughness: 0.75,
  metalness: 0.02
});

const foliageCoreMat = new THREE.MeshStandardMaterial({
  color: 0x2a5c34,
  roughness: 0.82,
  metalness: 0.02
});

// 1. Glazed Rectangular Stoneware Pot (y = 0 to y = 0.11m)
const potGroup = new THREE.Group();
potGroup.name = "stoneware_pot_group";
bonsaiRoot.add(potGroup);

// Four corner feet resting on y = 0
const footCoords = [
  [-0.135, -0.085],
  [0.135, -0.085],
  [-0.135, 0.085],
  [0.135, 0.085]
];
footCoords.forEach(([fx, fz], i) => {
  const footGeo = new THREE.BoxGeometry(0.05, 0.02, 0.04);
  const footMesh = new THREE.Mesh(footGeo, potClayRimMat);
  footMesh.name = `pot_corner_foot_${i + 1}`;
  footMesh.position.set(fx, 0.01, fz);
  potGroup.add(footMesh);
});

const potBaseGeo = new THREE.BoxGeometry(0.30, 0.018, 0.20);
const potBase = new THREE.Mesh(potBaseGeo, potGlazeMat);
potBase.name = "pot_bottom_tray";
potBase.position.set(0, 0.024, 0);
potGroup.add(potBase);

const potBodyGeo = new THREE.BoxGeometry(0.33, 0.072, 0.225);
const potBody = new THREE.Mesh(potBodyGeo, potGlazeMat);
potBody.name = "pot_main_basin";
potBody.position.set(0, 0.066, 0);
potGroup.add(potBody);

const potLipGeo = new THREE.BoxGeometry(0.355, 0.016, 0.248);
const potLip = new THREE.Mesh(potLipGeo, potGlazeMat);
potLip.name = "pot_flared_lip_rim";
potLip.position.set(0, 0.104, 0);
potGroup.add(potLip);

// 2. Sculpted Moss Soil Mounds inside the Pot
const mossMounds = [
  { name: "moss_main_mound", pos: [-0.03, 0.102, 0.0], scale: [0.155, 0.035, 0.105] },
  { name: "moss_right_mound", pos: [0.06, 0.098, 0.015], scale: [0.11, 0.028, 0.09] },
  { name: "moss_root_pillow", pos: [-0.065, 0.112, -0.01], scale: [0.085, 0.032, 0.075] }
];
mossMounds.forEach((m) => {
  const mGeo = new THREE.SphereGeometry(1.0, 20, 14);
  const mMesh = new THREE.Mesh(mGeo, mossMat);
  mMesh.name = m.name;
  mMesh.position.set(m.pos[0], m.pos[1], m.pos[2]);
  mMesh.scale.set(m.scale[0], m.scale[1], m.scale[2]);
  potGroup.add(mMesh);
});

// 3. Gnarled Windswept Trunk & Asymmetrical Branches (CatmullRomCurve3 + TubeGeometry + ConeGeometry)
const trunkGroup = new THREE.Group();
trunkGroup.name = "bonsai_trunk_and_branches_group";
bonsaiRoot.add(trunkGroup);

// Surface roots (Nebari) gripping the moss
const rootPaths = [
  [new THREE.Vector3(-0.06, 0.13, 0.0), new THREE.Vector3(-0.11, 0.115, 0.04), new THREE.Vector3(-0.14, 0.098, 0.06)],
  [new THREE.Vector3(-0.06, 0.13, 0.0), new THREE.Vector3(-0.10, 0.115, -0.04), new THREE.Vector3(-0.13, 0.098, -0.06)],
  [new THREE.Vector3(-0.05, 0.128, 0.0), new THREE.Vector3(0.01, 0.112, 0.035), new THREE.Vector3(0.05, 0.098, 0.05)]
];
rootPaths.forEach((pts, idx) => {
  const rCurve = new THREE.CatmullRomCurve3(pts);
  const rGeo = new THREE.TubeGeometry(rCurve, 16, 0.014, 10, false);
  const rMesh = new THREE.Mesh(rGeo, barkMat);
  rMesh.name = `nebari_root_${idx + 1}`;
  trunkGroup.add(rMesh);
});

// Twisted windswept trunk composed of tapering overlapping sections + bleached deadwood shari vein
const trunkLowerCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.06, 0.10, 0.00),
  new THREE.Vector3(-0.09, 0.17, 0.02),
  new THREE.Vector3(-0.07, 0.25, -0.02),
  new THREE.Vector3(-0.01, 0.32, 0.01)
]);
const trunkLowerMesh = new THREE.Mesh(
  new THREE.TubeGeometry(trunkLowerCurve, 28, 0.028, 14, false),
  barkMat
);
trunkLowerMesh.name = "trunk_lower_gnarled_base";
trunkGroup.add(trunkLowerMesh);

const trunkMidCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.02, 0.30, 0.01),
  new THREE.Vector3(0.04, 0.37, 0.02),
  new THREE.Vector3(0.09, 0.43, -0.01),
  new THREE.Vector3(0.14, 0.47, 0.01)
]);
const trunkMidMesh = new THREE.Mesh(
  new THREE.TubeGeometry(trunkMidCurve, 24, 0.020, 12, false),
  barkMat
);
trunkMidMesh.name = "trunk_mid_windswept_twist";
trunkGroup.add(trunkMidMesh);

// Bleached deadwood shari spiral twisting around the live bark
const shariCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.045, 0.12, 0.018),
  new THREE.Vector3(-0.072, 0.19, 0.032),
  new THREE.Vector3(-0.052, 0.27, 0.002),
  new THREE.Vector3(0.025, 0.35, 0.030),
  new THREE.Vector3(0.085, 0.42, 0.010)
]);
const shariMesh = new THREE.Mesh(
  new THREE.TubeGeometry(shariCurve, 28, 0.011, 10, false),
  jinDeadwoodMat
);
shariMesh.name = "trunk_deadwood_shari_vein";
trunkGroup.add(shariMesh);

// Asymmetrical windswept branches sweeping toward +X
const branchDefs = [
  {
    name: "branch_lower_cascade",
    radius: 0.014,
    pts: [
      new THREE.Vector3(-0.06, 0.24, -0.01),
      new THREE.Vector3(0.02, 0.23, 0.03),
      new THREE.Vector3(0.12, 0.21, 0.04),
      new THREE.Vector3(0.21, 0.20, 0.02)
    ]
  },
  {
    name: "branch_mid_left_counter",
    radius: 0.013,
    pts: [
      new THREE.Vector3(-0.01, 0.32, 0.01),
      new THREE.Vector3(-0.07, 0.35, -0.03),
      new THREE.Vector3(-0.12, 0.36, -0.04)
    ]
  },
  {
    name: "branch_mid_windswept_reach",
    radius: 0.014,
    pts: [
      new THREE.Vector3(0.04, 0.37, 0.02),
      new THREE.Vector3(0.13, 0.35, -0.03),
      new THREE.Vector3(0.23, 0.34, -0.02)
    ]
  },
  {
    name: "branch_upper_sub_canopy",
    radius: 0.012,
    pts: [
      new THREE.Vector3(0.09, 0.43, -0.01),
      new THREE.Vector3(0.17, 0.42, 0.04),
      new THREE.Vector3(0.25, 0.41, 0.03)
    ]
  },
  {
    name: "branch_apex_crown",
    radius: 0.011,
    pts: [
      new THREE.Vector3(0.12, 0.46, 0.00),
      new THREE.Vector3(0.18, 0.49, 0.00),
      new THREE.Vector3(0.23, 0.48, -0.01)
    ]
  }
];

branchDefs.forEach((b) => {
  const bCurve = new THREE.CatmullRomCurve3(b.pts);
  const bGeo = new THREE.TubeGeometry(bCurve, 20, b.radius, 10, false);
  const bMesh = new THREE.Mesh(bGeo, barkMat);
  bMesh.name = b.name;
  trunkGroup.add(bMesh);
});

// Tapering deadwood Jin branch spike using ConeGeometry
const jinConeGeo = new THREE.ConeGeometry(0.011, 0.075, 10);
const jinSpike = new THREE.Mesh(jinConeGeo, jinDeadwoodMat);
jinSpike.name = "deadwood_jin_spike";
jinSpike.position.set(0.06, 0.39, 0.04);
jinSpike.rotation.set(0.4, 0.2, -1.1);
trunkGroup.add(jinSpike);

// 4. Layered Juniper Foliage Pads (Flattened Spheres + InstancedMesh Pine Needle Cones)
const foliageGroup = new THREE.Group();
foliageGroup.name = "foliage_pads_group";
bonsaiRoot.add(foliageGroup);

const padDefinitions = [
  { name: "foliage_pad_lower_right", center: [0.21, 0.215, 0.02], radii: [0.095, 0.032, 0.068] },
  { name: "foliage_pad_mid_left", center: [-0.12, 0.37, -0.04], radii: [0.080, 0.028, 0.060] },
  { name: "foliage_pad_mid_right", center: [0.23, 0.35, -0.02], radii: [0.105, 0.034, 0.072] },
  { name: "foliage_pad_upper_right", center: [0.24, 0.42, 0.03], radii: [0.090, 0.030, 0.065] },
  { name: "foliage_pad_apex_crown", center: [0.19, 0.50, 0.00], radii: [0.110, 0.038, 0.078] },
  { name: "foliage_pad_center_bridge", center: [0.08, 0.45, 0.01], radii: [0.082, 0.030, 0.062] }
];

padDefinitions.forEach((pad) => {
  const padCoreGeo = new THREE.SphereGeometry(1.0, 18, 12);
  const padCoreMesh = new THREE.Mesh(padCoreGeo, foliageCoreMat);
  padCoreMesh.name = pad.name;
  padCoreMesh.position.set(pad.center[0], pad.center[1], pad.center[2]);
  padCoreMesh.scale.set(pad.radii[0], pad.radii[1], pad.radii[2]);
  foliageGroup.add(padCoreMesh);
});

// Dense InstancedMesh of juniper needle tufts across all 6 pads
const needlesPerPad = 90;
const totalNeedles = padDefinitions.length * needlesPerPad;
const needleConeGeo = new THREE.ConeGeometry(0.014, 0.038, 7);
const needleMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.72,
  metalness: 0.03
});

const needleInstanced = new THREE.InstancedMesh(needleConeGeo, needleMat, totalNeedles);
needleInstanced.name = "juniper_foliage_needles_instanced";
foliageGroup.add(needleInstanced);

const dummy = new THREE.Object3D();
const tempColor = new THREE.Color();
let instIdx = 0;

padDefinitions.forEach((pad, pIdx) => {
  const [cx, cy, cz] = pad.center;
  const [rx, ry, rz] = pad.radii;
  for (let i = 0; i < needlesPerPad; i++) {
    // Golden-angle phyllotaxis distribution over upper dome of each pad
    const t = (i + 0.5) / needlesPerPad;
    const rFrac = Math.sqrt(t);
    const theta = i * 2.3999632;
    const ox = Math.cos(theta) * rFrac * rx * 1.05;
    const oz = Math.sin(theta) * rFrac * rz * 1.05;
    const oy = Math.sqrt(Math.max(0.05, 1.0 - rFrac * rFrac * 0.85)) * ry * 1.05;

    dummy.position.set(cx + ox, cy + oy - ry * 0.15, cz + oz);
    // Tilt needles outward and slightly windswept (+X)
    dummy.rotation.set(
      (oz / rz) * 0.45,
      theta,
      -(ox / rx) * 0.45 - 0.32
    );
    const s = 0.85 + 0.35 * ((i * 17 + pIdx * 7) % 10) / 10;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    needleInstanced.setMatrixAt(instIdx, dummy.matrix);

    // Subtle juniper blue-green to sunlit yellow-green color variation
    const shade = ((i * 13 + pIdx * 5) % 10) / 10;
    tempColor.setRGB(
      0.16 + shade * 0.10,
      0.38 + shade * 0.18,
      0.21 + shade * 0.08
    );
    needleInstanced.setColorAt(instIdx, tempColor);
    instIdx++;
  }
});
needleInstanced.instanceMatrix.needsUpdate = true;
if (needleInstanced.instanceColor) needleInstanced.instanceColor.needsUpdate = true;

// Camera Framing (height ~0.55m, width ~0.52m, center ~0.27m)
camera.position.set(0.05, 0.35, 0.88);
camera.lookAt(0.04, 0.27, 0);
