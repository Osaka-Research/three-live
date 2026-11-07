// mat_09: Vertex-Colored Low-Poly Alpine Mountain Island
const root = new THREE.Group();
root.name = "AlpineMountainIslandRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AlpineAmbientLight";
scene.add(ambientLight);

const sunDirLight = new THREE.DirectionalLight(0xfff8e7, 1.6);
sunDirLight.name = "AlpineSunDirectionalLight";
sunDirLight.position.set(2.5, 4.0, 2.0);
scene.add(sunDirLight);

const skyFillLight = new THREE.DirectionalLight(0x88bbff, 0.65);
skyFillLight.name = "AlpineSkyFillLight";
skyFillLight.position.set(-2.0, 2.0, -1.5);
scene.add(skyFillLight);

// Helper: Height function for the alpine island (~2.0m diameter, radius = 1.0m)
function getTerrainHeight(x, z) {
  const r = Math.hypot(x, z);
  if (r >= 1.0) return 0.18;
  const falloff = Math.max(0, 1.0 - r * r);
  // Central Matterhorn-like peak + secondary ridge peaks
  const mainPeak = Math.exp(-((x - 0.05) * (x - 0.05) + (z + 0.05) * (z + 0.05)) * 6.5) * 0.85;
  const secondPeak = Math.exp(-((x + 0.35) * (x + 0.35) + (z - 0.22) * (z - 0.22)) * 10.0) * 0.52;
  const thirdPeak = Math.exp(-((x - 0.38) * (x - 0.38) + (z + 0.28) * (z + 0.28)) * 12.0) * 0.44;
  const ridge = (Math.sin(x * 7.0) * Math.cos(z * 7.0) * 0.06 + Math.cos((x + z) * 11.0) * 0.03) * falloff;
  return 0.18 + (mainPeak + secondPeak + thirdPeak + 0.14) * falloff + ridge;
}

// Helper: Smoothly blend per-vertex RGB color from deep blue shore -> green meadow -> grey rock -> white snow
function getElevationColor(y, r) {
  const h = y - 0.18; // elevation above shore water level (0.0 to ~0.95m)
  if (r > 0.86 || h < 0.04) {
    // Deep blue water to turquoise shallow shore
    const t = Math.max(0, Math.min(1, h / 0.04));
    return [0.06 + t * 0.12, 0.32 + t * 0.36, 0.68 + t * 0.18];
  } else if (h < 0.26) {
    // Shore sand / lush green alpine meadow
    const t = (h - 0.04) / 0.22;
    return [0.18 + (1 - t) * 0.08, 0.62 - t * 0.12, 0.24 - t * 0.06];
  } else if (h < 0.56) {
    // Green meadow blending into slate grey mountain rock
    const t = (h - 0.26) / 0.30;
    return [0.18 + t * 0.32, 0.50 + t * 0.01, 0.18 + t * 0.35];
  } else {
    // Grey rock blending into crisp white snow peak
    const t = Math.min(1, (h - 0.56) / 0.22);
    return [0.50 + t * 0.48, 0.51 + t * 0.48, 0.53 + t * 0.47];
  }
}

// Construct custom indexed BufferGeometry with Float32BufferAttribute for position & color
const gridRes = 28;
const positions = [];
const colors = [];
const indices = [];

for (let iz = 0; iz <= gridRes; iz++) {
  for (let ix = 0; ix <= gridRes; ix++) {
    const u = (ix / gridRes) * 2 - 1;
    const v = (iz / gridRes) * 2 - 1;
    // Map square grid onto circular island disk (radius = 1.0m)
    const x = u * Math.sqrt(Math.max(0, 1 - 0.5 * v * v));
    const z = v * Math.sqrt(Math.max(0, 1 - 0.5 * u * u));
    const r = Math.hypot(x, z);
    const y = getTerrainHeight(x, z);

    positions.push(x, y, z);
    const rgb = getElevationColor(y, r);
    colors.push(rgb[0], rgb[1], rgb[2]);
  }
}

for (let iz = 0; iz < gridRes; iz++) {
  for (let ix = 0; ix < gridRes; ix++) {
    const row1 = iz * (gridRes + 1);
    const row2 = (iz + 1) * (gridRes + 1);
    const a = row1 + ix;
    const b = row1 + ix + 1;
    const c = row2 + ix;
    const d = row2 + ix + 1;
    indices.push(a, c, b);
    indices.push(b, c, d);
  }
}

const terrainGeo = new THREE.BufferGeometry();
terrainGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
terrainGeo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
terrainGeo.setIndex(indices);
terrainGeo.computeVertexNormals();

const terrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.72,
  metalness: 0.05,
  flatShading: true
});

const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
terrainMesh.name = "VertexColoredAlpineTerrain";
root.add(terrainMesh);

// Faceted inverted rocky under-island cone tapering down to y = 0.0
const underRockMat = new THREE.MeshStandardMaterial({
  color: 0x3b4048,
  roughness: 0.88,
  metalness: 0.08,
  flatShading: true
});

const underIslandCone = new THREE.Mesh(
  new THREE.ConeGeometry(0.99, 0.18, 18),
  underRockMat
);
underIslandCone.name = "FloatingIslandRockyUnderside";
underIslandCone.rotation.x = Math.PI;
underIslandCone.position.set(0, 0.09, 0);
root.add(underIslandCone);

// Stylized low-poly Pine Trees (ConeGeometry foliage + trunks) in the green meadow zone
const pineFoliageMat = new THREE.MeshStandardMaterial({
  color: 0x1d5c32,
  roughness: 0.8,
  metalness: 0.0
});
const pineSnowTipMat = new THREE.MeshStandardMaterial({
  color: 0xeef5fc,
  roughness: 0.6,
  metalness: 0.0
});
const trunkMat = new THREE.MeshStandardMaterial({
  color: 0x5c3a21,
  roughness: 0.9,
  metalness: 0.0
});

const treeCoords = [
  [0.45, 0.35],
  [0.52, -0.22],
  [-0.55, 0.25],
  [-0.48, -0.38],
  [0.15, 0.58],
  [-0.22, -0.58],
  [0.62, 0.05],
  [-0.64, -0.05],
  [0.28, -0.45],
  [-0.18, 0.50]
];

for (let i = 0; i < treeCoords.length; i++) {
  const tx = treeCoords[i][0];
  const tz = treeCoords[i][1];
  const ty = getTerrainHeight(tx, tz);

  const treeGroup = new THREE.Group();
  treeGroup.name = "LowPolyAlpinePine_" + i;
  treeGroup.position.set(tx, ty - 0.01, tz);
  root.add(treeGroup);

  const trunk = new THREE.Mesh(
    new THREE.ConeGeometry(0.016, 0.06, 6),
    trunkMat
  );
  trunk.name = "PineTrunk_" + i;
  trunk.position.set(0, 0.03, 0);
  treeGroup.add(trunk);

  const lowerCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.11, 6),
    pineFoliageMat
  );
  lowerCone.name = "PineLowerFoliage_" + i;
  lowerCone.position.set(0, 0.085, 0);
  treeGroup.add(lowerCone);

  const upperCone = new THREE.Mesh(
    new THREE.ConeGeometry(0.042, 0.09, 6),
    i % 2 === 0 ? pineSnowTipMat : pineFoliageMat
  );
  upperCone.name = "PineUpperFoliage_" + i;
  upperCone.position.set(0, 0.145, 0);
  treeGroup.add(upperCone);
}

// Camera framing (~2.2x bounding radius ~1.05m -> distance ~2.35m)
camera.position.set(1.2, 1.35, 1.95);
camera.lookAt(0, 0.42, 0);
