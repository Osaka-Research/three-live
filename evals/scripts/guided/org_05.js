const reefRoot = new THREE.Group();
reefRoot.name = "coral_reef_outcrop_root";
scene.add(reefRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const causticSunLight = new THREE.DirectionalLight(0xa8f0ff, 1.35);
causticSunLight.name = "underwater_sun_light";
causticSunLight.position.set(1.6, 2.8, 1.4);
scene.add(causticSunLight);

const warmReefFill = new THREE.PointLight(0xff94b8, 0.85, 4.5);
warmReefFill.name = "reef_bioluminescent_fill_light";
warmReefFill.position.set(-0.9, 0.9, 0.8);
scene.add(warmReefFill);

// Materials
const sandMat = new THREE.MeshStandardMaterial({
  color: 0xdcc79c,
  roughness: 0.88,
  metalness: 0.02
});

const reefRockMat = new THREE.MeshStandardMaterial({
  color: 0x5c5366,
  roughness: 0.92,
  metalness: 0.04
});

const staghornMat = new THREE.MeshStandardMaterial({
  color: 0xf47c5d,
  roughness: 0.62,
  metalness: 0.04
});

const staghornTipMat = new THREE.MeshStandardMaterial({
  color: 0xfff0d4,
  emissive: 0xffb38a,
  emissiveIntensity: 0.25,
  roughness: 0.4
});

const brainCoralBaseMat = new THREE.MeshStandardMaterial({
  color: 0x3b6e52,
  roughness: 0.78,
  metalness: 0.05
});

const brainCoralRidgeMat = new THREE.MeshStandardMaterial({
  color: 0xa3e635,
  emissive: 0x3f6212,
  emissiveIntensity: 0.2,
  roughness: 0.55,
  metalness: 0.04
});

const spongeOuterMat = new THREE.MeshStandardMaterial({
  color: 0xeab308,
  roughness: 0.85,
  metalness: 0.02
});

const spongeVioletMat = new THREE.MeshStandardMaterial({
  color: 0x9333ea,
  roughness: 0.82,
  metalness: 0.04
});

const spongeInteriorMat = new THREE.MeshStandardMaterial({
  color: 0x3b1d5e,
  roughness: 0.95
});

const anemoneColumnMat = new THREE.MeshStandardMaterial({
  color: 0xdb2777,
  roughness: 0.55,
  metalness: 0.05
});

const anemoneTentacleMat = new THREE.MeshStandardMaterial({
  color: 0xf472b6,
  emissive: 0xec4899,
  emissiveIntensity: 0.35,
  roughness: 0.35
});

// 1. Rippled Sandy Seabed & Craggy Reef Base (~1.2m wide, y = 0) via Custom BufferGeometry
function createSeabedBufferGeometry() {
  const segs = 36;
  const radius = 0.60;
  const positions = [];
  const indices = [];

  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const x = (u - 0.5) * 2.0 * radius;
    for (let j = 0; j <= segs; j++) {
      const v = j / segs;
      const z = (v - 0.5) * 2.0 * radius;
      const r = Math.sqrt(x * x + z * z);
      // Smooth circular edge falloff to y=0 at radius=0.60m
      const edgeMask = Math.max(0, 1.0 - Math.pow(r / radius, 2.2));
      const ripples = 0.015 * Math.sin(x * 18.0 + z * 8.0) + 0.01 * Math.cos(z * 14.0);
      const centralMound = 0.08 * Math.exp(-(x * x * 4.5 + z * z * 5.5));
      const y = Math.max(0, (0.028 + ripples + centralMound) * edgeMask);
      positions.push(x, y, z);
    }
  }

  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const seabedMesh = new THREE.Mesh(createSeabedBufferGeometry(), sandMat);
seabedMesh.name = "sandy_seabed_terrain_base";
reefRoot.add(seabedMesh);

// Craggy Limestone Reef Rock Outcrop Boulders (SphereGeometry)
const rockConfigs = [
  { name: "reef_rock_center", pos: [0.0, 0.11, -0.04], scale: [0.34, 0.13, 0.26] },
  { name: "reef_rock_left", pos: [-0.26, 0.09, 0.06], scale: [0.24, 0.10, 0.20] },
  { name: "reef_rock_right", pos: [0.24, 0.095, 0.04], scale: [0.25, 0.11, 0.21] },
  { name: "reef_rock_back", pos: [0.04, 0.13, -0.20], scale: [0.26, 0.14, 0.18] }
];
rockConfigs.forEach((rc) => {
  const rock = new THREE.Mesh(new THREE.SphereGeometry(1.0, 18, 14), reefRockMat);
  rock.name = rc.name;
  rock.position.set(rc.pos[0], rc.pos[1], rc.pos[2]);
  rock.scale.set(rc.scale[0], rc.scale[1], rc.scale[2]);
  reefRoot.add(rock);
});

// 2. Branching Staghorn Coral Colony (Acropora) on Left-Center Outcrop
const staghornGroup = new THREE.Group();
staghornGroup.name = "staghorn_coral_colony_group";
staghornGroup.position.set(-0.20, 0.16, 0.02);
reefRoot.add(staghornGroup);

const antlerBranches = [
  {
    name: "staghorn_stem_main_1",
    r: 0.018,
    pts: [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.04, 0.14, 0.02), new THREE.Vector3(-0.10, 0.29, 0.05), new THREE.Vector3(-0.15, 0.42, 0.07)]
  },
  {
    name: "staghorn_fork_1a",
    r: 0.013,
    pts: [new THREE.Vector3(-0.06, 0.18, 0.03), new THREE.Vector3(-0.01, 0.30, 0.10), new THREE.Vector3(0.03, 0.40, 0.14)]
  },
  {
    name: "staghorn_fork_1b",
    r: 0.012,
    pts: [new THREE.Vector3(-0.10, 0.28, 0.05), new THREE.Vector3(-0.18, 0.36, -0.02), new THREE.Vector3(-0.23, 0.44, -0.06)]
  },
  {
    name: "staghorn_stem_main_2",
    r: 0.017,
    pts: [new THREE.Vector3(0.02, 0, -0.02), new THREE.Vector3(0.06, 0.15, -0.04), new THREE.Vector3(0.11, 0.31, -0.06), new THREE.Vector3(0.15, 0.45, -0.08)]
  },
  {
    name: "staghorn_fork_2a",
    r: 0.013,
    pts: [new THREE.Vector3(0.07, 0.19, -0.04), new THREE.Vector3(0.02, 0.32, -0.12), new THREE.Vector3(-0.02, 0.41, -0.17)]
  },
  {
    name: "staghorn_fork_2b",
    r: 0.012,
    pts: [new THREE.Vector3(0.10, 0.27, -0.05), new THREE.Vector3(0.18, 0.35, 0.02), new THREE.Vector3(0.22, 0.42, 0.07)]
  },
  {
    name: "staghorn_stem_main_3",
    r: 0.016,
    pts: [new THREE.Vector3(-0.02, 0, -0.03), new THREE.Vector3(-0.03, 0.16, -0.08), new THREE.Vector3(-0.06, 0.32, -0.12), new THREE.Vector3(-0.09, 0.43, -0.14)]
  }
];

antlerBranches.forEach((b) => {
  const curve = new THREE.CatmullRomCurve3(b.pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 20, b.r, 10, false),
    staghornMat
  );
  tube.name = b.name;
  staghornGroup.add(tube);

  // Pale calcified axial corallite growth tip at the end of each branch
  const tipPos = b.pts[b.pts.length - 1];
  const tipCap = new THREE.Mesh(
    new THREE.SphereGeometry(b.r * 1.08, 12, 10),
    staghornTipMat
  );
  tipCap.name = `${b.name}_growth_tip`;
  tipCap.position.copy(tipPos);
  staghornGroup.add(tipCap);
});

// 3. Grooved Hemispherical Brain Coral (Diploria) on Front-Right Outcrop
const brainCoralGroup = new THREE.Group();
brainCoralGroup.name = "brain_coral_group";
brainCoralGroup.position.set(0.22, 0.14, 0.10);
reefRoot.add(brainCoralGroup);

const brainRadius = 0.155;
const brainDome = new THREE.Mesh(
  new THREE.SphereGeometry(brainRadius, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.58),
  brainCoralBaseMat
);
brainDome.name = "brain_coral_hemisphere_core";
brainCoralGroup.add(brainDome);

// Meandering labyrinthine cerebriform ridges across the hemisphere
const numBrainBands = 9;
for (let b = 0; b < numBrainBands; b++) {
  const phi = 0.18 + (b / numBrainBands) * (Math.PI * 0.45);
  const ringPts = [];
  const steps = 36;
  for (let s = 0; s <= steps; s++) {
    const theta = (s / steps) * Math.PI * 2.0;
    const meanderPhi = phi + 0.065 * Math.sin(theta * 6.0 + b * 1.4);
    const r = brainRadius + 0.004;
    const x = r * Math.sin(meanderPhi) * Math.cos(theta);
    const y = r * Math.cos(meanderPhi);
    const z = r * Math.sin(meanderPhi) * Math.sin(theta);
    ringPts.push(new THREE.Vector3(x, y, z));
  }
  const ridgeCurve = new THREE.CatmullRomCurve3(ringPts, true);
  const ridgeMesh = new THREE.Mesh(
    new THREE.TubeGeometry(ridgeCurve, 64, 0.0075, 8, true),
    brainCoralRidgeMat
  );
  ridgeMesh.name = `brain_coral_cerebriform_ridge_${b + 1}`;
  brainCoralGroup.add(ridgeMesh);
}

// 4. Tubular Sea Sponges (Cluster at Back-Right Outcrop)
const spongesGroup = new THREE.Group();
spongesGroup.name = "tubular_sea_sponges_group";
spongesGroup.position.set(0.14, 0.18, -0.18);
reefRoot.add(spongesGroup);

const spongeSpecs = [
  { name: "sponge_tube_tall", pos: [0.0, 0.18, 0.0], rTop: 0.042, rBot: 0.032, h: 0.36, rot: [0.1, 0, -0.12], mat: spongeOuterMat },
  { name: "sponge_tube_mid", pos: [0.075, 0.14, 0.03], rTop: 0.036, rBot: 0.028, h: 0.28, rot: [0.15, 0, 0.18], mat: spongeOuterMat },
  { name: "sponge_tube_violet_1", pos: [-0.065, 0.15, -0.02], rTop: 0.038, rBot: 0.028, h: 0.31, rot: [-0.12, 0, -0.22], mat: spongeVioletMat },
  { name: "sponge_tube_violet_2", pos: [0.02, 0.11, 0.065], rTop: 0.030, rBot: 0.024, h: 0.22, rot: [0.22, 0, 0.08], mat: spongeVioletMat },
  { name: "sponge_tube_short", pos: [-0.03, 0.095, 0.05], rTop: 0.028, rBot: 0.022, h: 0.19, rot: [0.18, 0, -0.15], mat: spongeOuterMat }
];

spongeSpecs.forEach((sp) => {
  const unitGroup = new THREE.Group();
  unitGroup.name = `${sp.name}_unit`;
  unitGroup.position.set(sp.pos[0], sp.pos[1], sp.pos[2]);
  unitGroup.rotation.set(sp.rot[0], sp.rot[1], sp.rot[2]);
  spongesGroup.add(unitGroup);

  const cylMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(sp.rTop, sp.rBot, sp.h, 20),
    sp.mat
  );
  cylMesh.name = `${sp.name}_outer_wall`;
  unitGroup.add(cylMesh);

  // Dark osculum opening at top of sponge tube
  const osculumMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(sp.rTop * 0.72, sp.rTop * 0.65, 0.02, 16),
    spongeInteriorMat
  );
  osculumMesh.name = `${sp.name}_osculum_cavity`;
  osculumMesh.position.y = sp.h * 0.5 - 0.005;
  unitGroup.add(osculumMesh);
});

// 5. Waving Sea Anemones (Front-Left and Center-Front)
const anemonesGroup = new THREE.Group();
anemonesGroup.name = "sea_anemones_group";
reefRoot.add(anemonesGroup);

const anemoneLocations = [
  { name: "anemone_cluster_front", pos: [-0.02, 0.17, 0.14], numTentacles: 18 },
  { name: "anemone_cluster_left", pos: [-0.34, 0.13, 0.12], numTentacles: 14 }
];

anemoneLocations.forEach((loc) => {
  const aGroup = new THREE.Group();
  aGroup.name = loc.name;
  aGroup.position.set(loc.pos[0], loc.pos[1], loc.pos[2]);
  anemonesGroup.add(aGroup);

  // Fleshy pedal disc & column (CylinderGeometry)
  const columnMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.048, 0.056, 0.075, 20),
    anemoneColumnMat
  );
  columnMesh.name = `${loc.name}_pedal_column`;
  columnMesh.position.y = 0.035;
  aGroup.add(columnMesh);

  // Crown of waving tentacles
  for (let t = 0; t < loc.numTentacles; t++) {
    const ring = t < 6 ? 0 : 1;
    const angle = (t / (ring === 0 ? 6 : loc.numTentacles - 6)) * Math.PI * 2.0 + ring * 0.4;
    const baseR = ring === 0 ? 0.020 : 0.038;
    const spreadR = ring === 0 ? 0.055 : 0.095;
    const h = ring === 0 ? 0.13 : 0.11;

    const tCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(angle) * baseR, 0.068, Math.sin(angle) * baseR),
      new THREE.Vector3(Math.cos(angle + 0.2) * (baseR + spreadR * 0.5), 0.068 + h * 0.55, Math.sin(angle + 0.2) * (baseR + spreadR * 0.5)),
      new THREE.Vector3(Math.cos(angle + 0.35) * (baseR + spreadR), 0.068 + h, Math.sin(angle + 0.35) * (baseR + spreadR))
    ]);

    const tMesh = new THREE.Mesh(
      new THREE.TubeGeometry(tCurve, 16, 0.0055, 8, false),
      anemoneTentacleMat
    );
    tMesh.name = `${loc.name}_tentacle_${t + 1}`;
    aGroup.add(tMesh);
  }
});

// Camera Framing (width ~1.2m, height ~0.62m, bounding radius ~0.65m)
camera.position.set(0.0, 0.58, 1.48);
camera.lookAt(0, 0.25, 0);
