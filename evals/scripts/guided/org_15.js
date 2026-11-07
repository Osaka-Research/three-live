const oasisRoot = new THREE.Group();
oasisRoot.name = "desert_oasis_diorama_root";
scene.add(oasisRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const desertSunLight = new THREE.DirectionalLight(0xfff1d0, 1.45);
desertSunLight.name = "desert_sun_directional_light";
desertSunLight.position.set(3.0, 4.5, 2.5);
scene.add(desertSunLight);

const poolReflectionLight = new THREE.PointLight(0x2dd4bf, 0.85, 6.0);
poolReflectionLight.name = "turquoise_spring_glow_light";
poolReflectionLight.position.set(0.0, 0.6, 0.1);
scene.add(poolReflectionLight);

// Procedural Wind-Rippled Sand Dune DataTexture
function createSandRippleTexture() {
  const width = 128;
  const height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const idx = (y * width + x) * 4;
      const ripple = Math.sin((u * 28.0 + Math.sin(v * 6.0) * 1.5) * Math.PI * 2.0);
      const shade = 0.92 + 0.08 * ripple;
      data[idx] = Math.min(255, Math.floor(228 * shade));
      data[idx + 1] = Math.min(255, Math.floor(186 * shade));
      data[idx + 2] = Math.min(255, Math.floor(126 * shade));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const sandMat = new THREE.MeshStandardMaterial({
  map: createSandRippleTexture(),
  roughness: 0.85,
  metalness: 0.02
});

const dioramaPlinthMat = new THREE.MeshStandardMaterial({
  color: 0x855836,
  roughness: 0.88,
  metalness: 0.04
});

const springWaterMat = new THREE.MeshPhysicalMaterial({
  color: 0x14b8a6,
  roughness: 0.06,
  metalness: 0.05,
  transmission: 0.86,
  ior: 1.333,
  thickness: 0.25,
  attenuationColor: new THREE.Color(0x0d9488),
  attenuationDistance: 0.45,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  transparent: true,
  opacity: 0.90
});

const sandstoneMat = new THREE.MeshStandardMaterial({
  color: 0xb4653b,
  roughness: 0.88,
  metalness: 0.03
});

const palmTrunkMat = new THREE.MeshStandardMaterial({
  color: 0x6e4f36,
  roughness: 0.9,
  metalness: 0.02
});

const palmFrondMat = new THREE.MeshStandardMaterial({
  color: 0x3b7a2e,
  roughness: 0.68,
  metalness: 0.02,
  side: THREE.DoubleSide
});

const dateFruitMat = new THREE.MeshStandardMaterial({
  color: 0xd97706,
  roughness: 0.45,
  metalness: 0.05
});

// 1. 3.0m Square Procedural Sine-Deformed Sand Dunes (PlaneGeometry + BufferGeometry)
const terrainGroup = new THREE.Group();
terrainGroup.name = "sand_dunes_terrain_group";
oasisRoot.add(terrainGroup);

// Diorama base slab resting at y = 0 (3.0m x 3.0m)
const baseSlabGeo = new THREE.PlaneGeometry(3.0, 3.0, 2, 2);
baseSlabGeo.rotateX(-Math.PI / 2);
const baseSlabMesh = new THREE.Mesh(baseSlabGeo, dioramaPlinthMat);
baseSlabMesh.name = "diorama_ground_base_plane";
baseSlabMesh.position.y = 0.002;
terrainGroup.add(baseSlabMesh);

// Deform a 64x64 PlaneGeometry(3.0, 3.0) with sweeping sine dunes and a central oasis depression
const dunePlaneGeo = new THREE.PlaneGeometry(3.0, 3.0, 64, 64);
dunePlaneGeo.rotateX(-Math.PI / 2);
const posAttr = dunePlaneGeo.attributes.position;

for (let i = 0; i < posAttr.count; i++) {
  const x = posAttr.getX(i);
  const z = posAttr.getZ(i);
  const r = Math.sqrt((x - 0.1) * (x - 0.1) + (z - 0.1) * (z - 0.1));

  // Central depression bowl for the turquoise spring pool (r < 0.65m dips down to y = 0.02m)
  const depressionMask = 1.0 - Math.exp(-Math.pow(r / 0.62, 2.6));

  // Sweeping primary dune ridges + fine wind ripples
  const primaryDune =
    0.22 * (0.5 + 0.5 * Math.sin(x * 1.85 + Math.sin(z * 1.2) * 0.8)) +
    0.14 * (0.5 + 0.5 * Math.cos(z * 2.1 - x * 0.7));
  const windRipples = 0.016 * Math.sin(x * 14.0 + z * 6.0);

  const height = 0.02 + (0.08 + primaryDune + windRipples) * depressionMask;
  posAttr.setY(i, height);
}
posAttr.needsUpdate = true;
dunePlaneGeo.computeVertexNormals();

const dunesMesh = new THREE.Mesh(dunePlaneGeo, sandMat);
dunesMesh.name = "sine_deformed_sand_dunes_surface";
terrainGroup.add(dunesMesh);

// 2. Clear Turquoise Spring Pool in the Depression (MeshPhysicalMaterial)
const poolWaterMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.62, 0.56, 0.08, 36),
  springWaterMat
);
poolWaterMesh.name = "turquoise_oasis_spring_pool";
poolWaterMesh.position.set(0.10, 0.115, 0.10);
terrainGroup.add(poolWaterMesh);

// 3. Layered Sandstone Boulders & Outcrops along the Pool Shore
const bouldersGroup = new THREE.Group();
bouldersGroup.name = "sandstone_boulders_group";
oasisRoot.add(bouldersGroup);

// Custom faceted rock BufferGeometry helper for authentic desert sandstone strata
function createFacetedSandstoneGeometry(rx, ry, rz) {
  const geo = new THREE.CylinderGeometry(rx * 0.72, rx, ry, 7, 3);
  const p = geo.attributes.position;
  const verts = [];
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i);
    const vy = p.getY(i);
    const vz = p.getZ(i) * (rz / rx);
    const strataStep = 1.0 + 0.08 * Math.sin(vy * 35.0);
    verts.push(vx * strataStep, vy, vz * strataStep);
  }
  const customGeo = new THREE.BufferGeometry();
  customGeo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  if (geo.index) customGeo.setIndex(geo.index);
  customGeo.computeVertexNormals();
  return customGeo;
}

const boulderSpecs = [
  { name: "sandstone_boulder_north_main", pos: [-0.35, 0.18, -0.32], size: [0.24, 0.22, 0.18], rotY: 0.4 },
  { name: "sandstone_boulder_north_sub", pos: [-0.14, 0.14, -0.44], size: [0.16, 0.15, 0.14], rotY: 1.2 },
  { name: "sandstone_boulder_east_ledge", pos: [0.58, 0.16, -0.05], size: [0.20, 0.16, 0.16], rotY: -0.6 },
  { name: "sandstone_boulder_west_shore", pos: [-0.46, 0.14, 0.22], size: [0.15, 0.14, 0.13], rotY: 2.1 },
  { name: "sandstone_spire_cone", pos: [-0.48, 0.22, -0.22], size: [0.12, 0.28, 0.12], isCone: true }
];

boulderSpecs.forEach((b) => {
  const bGeo = b.isCone
    ? new THREE.ConeGeometry(b.size[0], b.size[1], 7)
    : createFacetedSandstoneGeometry(b.size[0], b.size[1], b.size[2]);
  const bMesh = new THREE.Mesh(bGeo, sandstoneMat);
  bMesh.name = b.name;
  bMesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
  if (b.rotY) bMesh.rotation.y = b.rotY;
  bouldersGroup.add(bMesh);
});

// 4. Three Curved Date Palm Trees with Ringed Trunks & Frond Crowns
const palmsGroup = new THREE.Group();
palmsGroup.name = "date_palm_trees_group";
oasisRoot.add(palmsGroup);

function createDatePalmTree(id, basePos, topOffset, height, numFronds) {
  const palmGroup = new THREE.Group();
  palmGroup.name = `date_palm_tree_${id}_group`;
  palmGroup.position.set(basePos[0], basePos[1], basePos[2]);
  palmsGroup.add(palmGroup);

  // Build curved ringed trunk from 10 stacked tapered CylinderGeometry & ConeGeometry rings
  const numRings = 10;
  let crownPos = new THREE.Vector3();
  for (let r = 0; r < numRings; r++) {
    const u0 = r / numRings;
    const u1 = (r + 1) / numRings;
    const uMid = (u0 + u1) * 0.5;

    const x = topOffset[0] * Math.pow(uMid, 1.6);
    const y = height * uMid;
    const z = topOffset[1] * Math.pow(uMid, 1.6);

    const segH = (height / numRings) * 1.12;
    const rBot = 0.068 * (1.0 - u0 * 0.42);
    const rTop = 0.068 * (1.0 - u1 * 0.42) * 1.08; // Flared leaf-scar collar ring

    const ringMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, segH, 10),
      palmTrunkMat
    );
    ringMesh.name = `palm_${id}_trunk_ring_${r + 1}`;
    ringMesh.position.set(x, y, z);
    ringMesh.rotation.z = -(topOffset[0] / height) * 1.35 * uMid;
    ringMesh.rotation.x = (topOffset[1] / height) * 1.35 * uMid;
    palmGroup.add(ringMesh);

    if (r === numRings - 1) {
      crownPos.set(topOffset[0], height, topOffset[1]);
    }
  }

  // Crown Assembly at top of curved trunk
  const crownGroup = new THREE.Group();
  crownGroup.name = `palm_${id}_frond_crown_group`;
  crownGroup.position.copy(crownPos);
  palmGroup.add(crownGroup);

  // Golden date fruit clusters tucked beneath the fronds
  for (let d = 0; d < 4; d++) {
    const dAngle = (d / 4) * Math.PI * 2.0;
    const dateCluster = new THREE.Mesh(
      new THREE.ConeGeometry(0.035, 0.08, 8),
      dateFruitMat
    );
    dateCluster.name = `palm_${id}_date_cluster_${d + 1}`;
    dateCluster.position.set(Math.cos(dAngle) * 0.055, -0.03, Math.sin(dAngle) * 0.055);
    dateCluster.rotation.x = Math.PI;
    crownGroup.add(dateCluster);
  }

  // Arching Palm Fronds (2 tiers: lower drooping & upper arching)
  for (let f = 0; f < numFronds; f++) {
    const tier = f < numFronds / 2 ? 0 : 1;
    const yaw = (f / (numFronds / 2)) * Math.PI * 2.0 + tier * 0.55;
    const frondPivot = new THREE.Group();
    frondPivot.name = `palm_${id}_frond_${f + 1}_pivot`;
    frondPivot.rotation.y = yaw;
    frondPivot.rotation.z = tier === 0 ? -0.35 : -0.05;
    crownGroup.add(frondPivot);

    // Build arched frond blade from 3 angled flattened ConeGeometry / CylinderGeometry segments
    const seg1 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.015, 0.24, 6),
      palmFrondMat
    );
    seg1.name = `palm_${id}_frond_${f + 1}_proximal`;
    seg1.scale.set(0.18, 1.0, 1.0);
    seg1.position.set(0.11, 0.06, 0);
    seg1.rotation.z = -1.05;
    frondPivot.add(seg1);

    const seg2 = new THREE.Mesh(
      new THREE.ConeGeometry(0.052, 0.28, 6),
      palmFrondMat
    );
    seg2.name = `palm_${id}_frond_${f + 1}_distal_tip`;
    seg2.scale.set(0.18, 1.0, 1.0);
    seg2.position.set(0.32, 0.02, 0);
    seg2.rotation.z = -1.68;
    frondPivot.add(seg2);
  }
}

// Three Curved Date Palms framing the turquoise spring pool
createDatePalmTree(1, [-0.32, 0.14, -0.18], [0.24, 0.12], 1.28, 12);
createDatePalmTree(2, [-0.46, 0.15, 0.08], [-0.18, 0.16], 1.05, 10);
createDatePalmTree(3, [0.46, 0.14, -0.24], [-0.16, 0.14], 0.92, 10);

// Camera Framing (3.0m x 3.0m diorama, bounding radius ~2.12m, pull back to ~4.5m so 100% of corners are in view)
camera.position.set(0.0, 1.85, 4.45);
camera.lookAt(0, 0.42, 0);
