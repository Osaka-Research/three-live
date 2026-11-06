const tableGroup = new THREE.Group();
tableGroup.position.set(0, 0.75, 0);

// Lighting
const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.8);
dirLight.position.set(1.5, 3, 2);
const ambLight = new THREE.AmbientLight(0xddeeff, 0.6);
scene.add(tableGroup, dirLight, ambLight);

// Procedural DataTexture for wood grain
const width = 128, height = 128;
const size = width * height * 4;
const data = new Uint8Array(size);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const idx = (y * width + x) * 4;
    const ring = Math.sin((x * 0.15) + Math.cos(y * 0.05) * 8) * 0.5 + 0.5;
    const noise = (Math.sin(x * 0.8 + y * 0.3) + 1) * 0.1;
    const val = Math.floor((ring * 0.6 + noise + 0.3) * 120 + 40);
    data[idx] = Math.floor(val * 0.7);
    data[idx + 1] = Math.floor(val * 0.4);
    data[idx + 2] = Math.floor(val * 0.2);
    data[idx + 3] = 255;
  }
}
const woodTexture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
woodTexture.needsUpdate = true;

const walnutMat = new THREE.MeshStandardMaterial({
  map: woodTexture,
  roughness: 0.35,
  metalness: 0.05
});

const resinMat = new THREE.MeshPhysicalMaterial({
  color: 0x0fe3c8,
  transmission: 0.88,
  opacity: 1,
  transparent: true,
  roughness: 0.1,
  ior: 1.54,
  thickness: 0.08
});

const legMat = new THREE.MeshStandardMaterial({
  color: 0x1a1a1a,
  metalness: 0.85,
  roughness: 0.2
});

// Tabletop components (2.0m x 1.0m, thickness 0.06m)
const slabLeft = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 2.0), walnutMat);
slabLeft.position.set(-0.32, 0, 0);
tableGroup.add(slabLeft);

const slabRight = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.06, 2.0), walnutMat);
slabRight.position.set(0.32, 0, 0);
tableGroup.add(slabRight);

const river = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.058, 2.0), resinMat);
river.position.set(0, 0, 0);
tableGroup.add(river);

// 4 Hairpin steel legs
const legPositions = [
  [-0.4, -0.375, -0.85],
  [0.4, -0.375, -0.85],
  [-0.4, -0.375, 0.85],
  [0.4, -0.375, 0.85]
];

legPositions.forEach(([x, y, z]) => {
  const leg = new THREE.Group();
  leg.position.set(x, y, z);
  const rod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.72, 12), legMat);
  rod1.rotation.z = (x < 0 ? -1 : 1) * 0.08;
  rod1.rotation.x = (z < 0 ? -1 : 1) * 0.08;
  const rod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.72, 12), legMat);
  rod2.rotation.z = (x < 0 ? -1 : 1) * 0.04;
  rod2.position.x = (x < 0 ? 0.03 : -0.03);
  leg.add(rod1, rod2);
  tableGroup.add(leg);
});
