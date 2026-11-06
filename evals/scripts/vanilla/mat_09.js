const islandGroup = new THREE.Group();
islandGroup.position.set(0, 0.6, 0);

// Lighting
const sunLight = new THREE.DirectionalLight(0xfffae6, 2.0);
sunLight.position.set(2, 4, 3);
const ambLight = new THREE.AmbientLight(0x6080a0, 0.6);
scene.add(islandGroup, sunLight, ambLight);

// Procedural grid terrain BufferGeometry (2.0m x 2.0m)
const segs = 32;
const size = 2.0;
const half = size / 2;
const posArr = [];
const colArr = [];
const indices = [];

for (let j = 0; j <= segs; j++) {
  const z = (j / segs) * size - half;
  for (let i = 0; i <= segs; i++) {
    const x = (i / segs) * size - half;
    const dist = Math.sqrt(x * x + z * z);
    const falloff = Math.max(0, 1.0 - dist / 0.95);
    const noise = Math.sin(x * 6 + z * 3) * 0.12 + Math.cos(x * 4 - z * 7) * 0.1;
    const y = Math.pow(falloff, 1.6) * 0.85 + (falloff > 0.1 ? noise * falloff : 0);

    posArr.push(x, y, z);

    let r = 0, g = 0, b = 0;
    if (y < 0.06) {
      r = 0.08; g = 0.35; b = 0.75;
    } else if (y < 0.18) {
      const t = (y - 0.06) / 0.12;
      r = 0.2 + t * 0.1; g = 0.65 - t * 0.15; b = 0.2;
    } else if (y < 0.5) {
      const t = (y - 0.18) / 0.32;
      r = 0.35 + t * 0.2; g = 0.38 + t * 0.17; b = 0.4 + t * 0.15;
    } else {
      const t = Math.min(1.0, (y - 0.5) / 0.25);
      r = 0.55 + t * 0.42; g = 0.55 + t * 0.43; b = 0.55 + t * 0.45;
    }
    colArr.push(r, g, b);
  }
}

for (let j = 0; j < segs; j++) {
  for (let i = 0; i < segs; i++) {
    const a = j * (segs + 1) + i;
    const b = a + 1;
    const c = a + (segs + 1);
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
}

const terrainGeo = new THREE.BufferGeometry();
terrainGeo.setIndex(indices);
terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
terrainGeo.computeVertexNormals();

const terrainMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.75,
  metalness: 0.1
});
const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
islandGroup.add(terrainMesh);

// Floating earthen underside
const undersideGeo = new THREE.ConeGeometry(0.95, 0.7, 16);
const undersideMat = new THREE.MeshStandardMaterial({ color: 0x3d2817, roughness: 0.9 });
const underside = new THREE.Mesh(undersideGeo, undersideMat);
underside.rotation.x = Math.PI;
underside.position.y = -0.35;
islandGroup.add(underside);

// Stylized pine trees across green meadows
const treeMat = new THREE.MeshStandardMaterial({ color: 0x1b4d24, roughness: 0.8 });
const treeGeo = new THREE.ConeGeometry(0.04, 0.11, 6);
for (let k = 0; k < 18; k++) {
  const ang = (k * 137.5 * Math.PI) / 180;
  const rad = 0.35 + (k % 5) * 0.08;
  const tx = Math.cos(ang) * rad;
  const tz = Math.sin(ang) * rad;
  const tree = new THREE.Mesh(treeGeo, treeMat);
  tree.position.set(tx, 0.14, tz);
  islandGroup.add(tree);
}

let elapsed = 0;
function animate(dt = 0.016) {
  elapsed += dt;
  islandGroup.position.y = 0.6 + Math.sin(elapsed * 1.2) * 0.04;
  islandGroup.rotation.y += dt * 0.05;
}
