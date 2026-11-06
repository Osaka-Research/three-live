const modelGroup = new THREE.Group();
modelGroup.position.set(0, 0.8, 0);
modelGroup.userData.xr = {
  anchor: 'table',
  handles: { rotateAxis: 'y', minScale: 0.5, maxScale: 3.0 },
  dimensions: true,
  scale: 1 / 200
};
scene.add(modelGroup);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
sunLight.position.set(3, 5, 2);
scene.add(sunLight);

// Tabletop base
const baseGeo = new THREE.BoxGeometry(1.6, 0.04, 1.2);
const baseMat = new THREE.MeshStandardMaterial({ color: 0x2e3532, roughness: 0.8 });
modelGroup.add(new THREE.Mesh(baseGeo, baseMat));

// Glass office towers
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x88c0d0,
  transmission: 0.85,
  opacity: 1,
  transparent: true,
  roughness: 0.1,
  metalness: 0.1,
  ior: 1.5
});
const tower1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.25), glassMat);
tower1.position.set(-0.4, 0.32, -0.2);
modelGroup.add(tower1);

const tower2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.45, 16), glassMat);
tower2.position.set(0.35, 0.245, -0.15);
modelGroup.add(tower2);

// Solar-roofed courtyard & Walkways
const solarMat = new THREE.MeshPhysicalMaterial({ color: 0x1b2838, roughness: 0.2, metalness: 0.8, clearcoat: 1.0 });
const courtyardRoof = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.02, 0.35), solarMat);
courtyardRoof.position.set(0, 0.18, 0.1);
modelGroup.add(courtyardRoof);

const walkwayMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, roughness: 0.5 });
const walkway = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.01, 0.8), walkwayMat);
walkway.position.set(0, 0.025, 0);
modelGroup.add(walkway);

// Trees (Cylinder trunk + Cone foliage)
const trunkGeo = new THREE.CylinderGeometry(0.01, 0.015, 0.06, 8);
const foliageGeo = new THREE.ConeGeometry(0.04, 0.1, 8);
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28 });
const foliageMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6 });

[[-0.2, 0.1], [-0.15, -0.2], [0.2, 0.2], [0.35, 0.2]].forEach(([x, z]) => {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.03;
  const foliage = new THREE.Mesh(foliageGeo, foliageMat);
  foliage.position.y = 0.08;
  tree.add(trunk, foliage);
  tree.position.set(x, 0.02, z);
  modelGroup.add(tree);
});
