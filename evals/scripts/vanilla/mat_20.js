const geodeGroup = new THREE.Group();
geodeGroup.position.set(0, 0.8, 0);
scene.add(geodeGroup);

const ambient = new THREE.AmbientLight(0x1a1520, 1.2);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(2, 3, 2);
scene.add(ambient, dirLight);

// Point light inside cavity to illuminate sparkling amethyst
const cavityLight = new THREE.PointLight(0xd988ff, 3.0, 1.5);
cavityLight.position.set(0.05, 0.85, 0.05);
scene.add(cavityLight);

// Materials
const basaltMat = new THREE.MeshPhysicalMaterial({ color: 0x1f1e20, roughness: 0.95, metalness: 0.1 });
const amethystMat = new THREE.MeshPhysicalMaterial({
  color: 0x7b1fa2,
  transmission: 0.86,
  roughness: 0.12,
  ior: 1.544,
  dispersion: 0.02,
  clearcoat: 1.0,
  clearcoatRoughness: 0.08,
  transparent: true
});

// Boulder geometry using CSG if available or procedural split sphere
let boulder;
const outerGeo = new THREE.SphereGeometry(0.35, 24, 24);
if (typeof CSG !== 'undefined') {
  const outerMesh = new THREE.Mesh(outerGeo, basaltMat);
  const cutBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.5));
  cutBox.position.set(0.18, 0, 0.18);
  outerMesh.updateMatrix();
  cutBox.updateMatrix();
  const csg = CSG.fromMesh(outerMesh).subtract(CSG.fromMesh(cutBox));
  boulder = CSG.toMesh(csg, outerMesh.matrix, basaltMat);
} else {
  boulder = new THREE.Mesh(new THREE.SphereGeometry(0.35, 24, 24, 0, Math.PI * 1.55, 0, Math.PI), basaltMat);
}
geodeGroup.add(boulder);

// Dozens of pointed purple hexagonal quartz crystal prisms radiating inward
const crystalGroup = new THREE.Group();
geodeGroup.add(crystalGroup);

const count = 48;
for (let i = 0; i < count; i++) {
  const theta = (Math.PI * 0.15) + (i / count) * (Math.PI * 1.25);
  const phi = 0.4 + (i % 6) * 0.38;
  const radius = 0.28;

  const px = radius * Math.sin(phi) * Math.cos(theta);
  const py = radius * Math.cos(phi) - 0.05;
  const pz = radius * Math.sin(phi) * Math.sin(theta);

  const crystal = new THREE.Group();
  const height = 0.06 + (i % 5) * 0.015;
  const prismR = 0.016 + (i % 3) * 0.004;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(prismR, prismR, height, 6), amethystMat);
  body.position.y = height * 0.5;

  const capHeight = prismR * 1.6;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(prismR, capHeight, 6), amethystMat);
  cap.position.y = height + capHeight * 0.5;

  crystal.add(body, cap);
  crystal.position.set(px, py, pz);

  crystal.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-px, -py, -pz).normalize());
  crystalGroup.add(crystal);
}

geodeGroup.userData.xr = { grab: true };
function animate(dt = 0.016) {
  geodeGroup.rotation.y += 0.25 * dt;
}
