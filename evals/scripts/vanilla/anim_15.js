const clearing = new THREE.Group();
scene.add(clearing);

const ambLight = new THREE.AmbientLight(0xdff0d8, 0.6);
const sunLight = new THREE.DirectionalLight(0xfff8e7, 1.2);
sunLight.position.set(4, 6, 3);
clearing.add(ambLight, sunLight);

// Ground plane
const groundGeo = new THREE.PlaneGeometry(8, 8, 16, 16);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x2e4a23, roughness: 0.9 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
clearing.add(ground);

// Materials for pine trees
const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.85 });
const needleMat = new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.6 });
const lowPolyMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.7 });

function createHighDetailTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.8, 8), barkMat);
  trunk.position.y = 0.9;
  group.add(trunk);

  const tiers = [
    { r: 0.65, h: 0.9, y: 1.3 },
    { r: 0.52, h: 0.8, y: 1.7 },
    { r: 0.38, h: 0.7, y: 2.1 }
  ];
  tiers.forEach(t => {
    const tier = new THREE.Mesh(new THREE.ConeGeometry(t.r, t.h, 8), needleMat);
    tier.position.y = t.y;
    group.add(tier);
  });
  return group;
}

function createMidDetailTree() {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1.8, 5), barkMat);
  trunk.position.y = 0.9;
  const foliage = new THREE.Mesh(new THREE.ConeGeometry(0.65, 1.6, 5), lowPolyMat);
  foliage.position.y = 1.7;
  group.add(trunk, foliage);
  return group;
}

const emptyGroup = new THREE.Group();

// 15 pine trees distributed with THREE.LOD
for (let i = 0; i < 15; i++) {
  const angle = (i / 15) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
  const dist = 1.2 + Math.random() * 2.2;
  const x = Math.cos(angle) * dist;
  const z = Math.sin(angle) * dist - 0.5;

  const lod = new THREE.LOD();
  lod.position.set(x, 0, z);

  const highTree = createHighDetailTree();
  const midTree = createMidDetailTree();

  lod.addLevel(highTree, 0);     // 0 to 3.2m: Multi-tier branches & bark
  lod.addLevel(midTree, 3.2);    // 3.2m to 5.5m: Simplified cones
  lod.addLevel(emptyGroup, 5.5); // > 5.5m: Culled cleanly

  lod.userData.xr = { lod: true };
  const s = 0.7 + Math.random() * 0.4;
  lod.scale.set(s, s, s);
  clearing.add(lod);
}

function animate() {
  if (typeof camera !== 'undefined') {
    clearing.children.forEach(child => {
      if (child.isLOD) child.update(camera);
    });
  }
}
scene.userData.animate = animate;
