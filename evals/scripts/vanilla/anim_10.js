// 2.5m tall molecular visualization of a B-DNA double helix
const basePairs = 48;
const height = 2.5;
const radius = 0.42;
const turns = 4.5;

// Sugar-phosphate backbone spheres via InstancedMesh
const sphereGeo = new THREE.SphereGeometry(0.045, 16, 16);
const sphereMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
const backboneMesh = new THREE.InstancedMesh(sphereGeo, sphereMat, basePairs * 2);

// Base-pair rungs via InstancedMesh
const rungGeo = new THREE.CylinderGeometry(0.018, 0.018, radius, 12);
rungGeo.translate(0, radius / 2, 0);
rungGeo.rotateZ(-Math.PI / 2);
const rungMat = new THREE.MeshStandardMaterial({ roughness: 0.4 });
const rungMesh = new THREE.InstancedMesh(rungGeo, rungMat, basePairs * 2);

const dummy = new THREE.Object3D();
const colorA = new THREE.Color(0xe63946); // Adenine (Red)
const colorT = new THREE.Color(0x457b9d); // Thymine (Blue)
const colorG = new THREE.Color(0x2a9d8f); // Guanine (Green)
const colorC = new THREE.Color(0xe9c46a); // Cytosine (Yellow)
const colorPhosphate = new THREE.Color(0xecf0f1);

const baseTypes = [
  [colorA, colorT],
  [colorG, colorC],
  [colorT, colorA],
  [colorC, colorG]
];

for (let i = 0; i < basePairs; i++) {
  const t = i / (basePairs - 1);
  const y = t * height - height / 2 + 0.8;
  const angle = t * turns * Math.PI * 2;

  // Backbone spheres
  const x1 = Math.cos(angle) * radius, z1 = Math.sin(angle) * radius;
  const x2 = Math.cos(angle + Math.PI) * radius, z2 = Math.sin(angle + Math.PI) * radius;

  dummy.rotation.set(0, 0, 0);
  dummy.position.set(x1, y, z1);
  dummy.updateMatrix();
  backboneMesh.setMatrixAt(i * 2, dummy.matrix);
  backboneMesh.setColorAt(i * 2, colorPhosphate);

  dummy.position.set(x2, y, z2);
  dummy.updateMatrix();
  backboneMesh.setMatrixAt(i * 2 + 1, dummy.matrix);
  backboneMesh.setColorAt(i * 2 + 1, colorPhosphate);

  // Complementary half-rungs meeting at center
  const pair = baseTypes[i % baseTypes.length];
  dummy.position.set(0, y, 0);
  dummy.rotation.set(0, -angle, 0);
  dummy.updateMatrix();
  rungMesh.setMatrixAt(i * 2, dummy.matrix);
  rungMesh.setColorAt(i * 2, pair[0]);

  dummy.rotation.set(0, -angle + Math.PI, 0);
  dummy.updateMatrix();
  rungMesh.setMatrixAt(i * 2 + 1, dummy.matrix);
  rungMesh.setColorAt(i * 2 + 1, pair[1]);
}

backboneMesh.instanceMatrix.needsUpdate = true;
if (backboneMesh.instanceColor) backboneMesh.instanceColor.needsUpdate = true;
rungMesh.instanceMatrix.needsUpdate = true;
if (rungMesh.instanceColor) rungMesh.instanceColor.needsUpdate = true;

const dnaGroup = new THREE.Group();
dnaGroup.add(backboneMesh, rungMesh);
scene.add(dnaGroup);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
dirLight.position.set(2, 3, 2);
scene.add(ambientLight, dirLight);

function animate(dt = 0.016) {
  dnaGroup.rotation.y += dt * 0.4;
}
