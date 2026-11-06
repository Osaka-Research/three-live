// mat_02: Translucent soap bubbles with thin-film iridescence from twisted brass wand
const root = new THREE.Group();
root.position.set(0, 0.7, 0);
scene.add(root);

// Twisted brass bubble wand
const brassMat = new THREE.MeshPhysicalMaterial({
  color: 0xd4af37,
  metalness: 0.92,
  roughness: 0.24,
  clearcoat: 0.5,
  clearcoatRoughness: 0.2
});
const wandGroup = new THREE.Group();
const ringMesh = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.007, 16, 64), brassMat);
ringMesh.rotation.x = Math.PI / 2.5;
ringMesh.position.set(0, 0.12, 0);
wandGroup.add(ringMesh);

const handleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.38, 20), brassMat);
handleMesh.position.set(0, -0.1, -0.04);
handleMesh.rotation.x = 0.25;
wandGroup.add(handleMesh);
wandGroup.position.set(-0.25, -0.05, 0.15);
root.add(wandGroup);

// Iridescent soap bubble material
const bubbleMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.95,
  opacity: 1.0,
  transparent: true,
  roughness: 0.03,
  ior: 1.333,
  iridescence: 1.0,
  iridescenceIOR: 1.33,
  iridescenceThicknessRange: [120, 420],
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  depthWrite: false
});

// Cluster of 12 overlapping soap bubbles of varying radii
const bubbleCluster = new THREE.Group();
const bubbleOffsets = [
  { r: 0.095, p: [-0.12, 0.14, 0.08] },
  { r: 0.115, p: [-0.02, 0.22, 0.02] },
  { r: 0.075, p: [0.08, 0.16, -0.04] },
  { r: 0.130, p: [0.02, 0.34, -0.02] },
  { r: 0.085, p: [-0.09, 0.32, -0.08] },
  { r: 0.065, p: [0.14, 0.29, 0.06] },
  { r: 0.105, p: [0.11, 0.44, -0.05] },
  { r: 0.055, p: [-0.05, 0.45, 0.09] },
  { r: 0.090, p: [0.01, 0.52, 0.03] },
  { r: 0.070, p: [-0.14, 0.24, -0.02] },
  { r: 0.045, p: [0.18, 0.38, -0.01] },
  { r: 0.060, p: [0.07, 0.60, 0.01] }
];

const bubbleMeshes = bubbleOffsets.map(({ r, p }) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), bubbleMat);
  mesh.position.set(...p);
  mesh.userData = { basePos: [...p], seed: Math.random() * Math.PI * 2 };
  bubbleCluster.add(mesh);
  return mesh;
});
root.add(bubbleCluster);

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dirLight = new THREE.DirectionalLight(0xfffaed, 2.2);
dirLight.position.set(1.5, 3.0, 2.0);
scene.add(dirLight);

const pointLightA = new THREE.PointLight(0x66ccff, 3.0, 2.5);
pointLightA.position.set(-0.8, 1.2, 0.8);
scene.add(pointLightA);

const pointLightB = new THREE.PointLight(0xff99dd, 3.0, 2.5);
pointLightB.position.set(0.9, 1.4, -0.6);
scene.add(pointLightB);

let elapsed = 0;
scene.userData.animate = (dt) => {
  elapsed += dt;
  bubbleMeshes.forEach((b) => {
    b.position.y = b.userData.basePos[1] + Math.sin(elapsed * 1.5 + b.userData.seed) * 0.018;
    b.position.x = b.userData.basePos[0] + Math.cos(elapsed * 1.2 + b.userData.seed) * 0.012;
  });
  bubbleCluster.rotation.y = Math.sin(elapsed * 0.5) * 0.15;
};
