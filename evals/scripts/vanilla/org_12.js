// Mossy fallen forest log (~1.1m long) with bioluminescent mycena mushrooms
const forestGroup = new THREE.Group();
forestGroup.position.set(0, 0.75, 0);

// Lighting
scene.add(new THREE.AmbientLight(0x0a1820, 1.0));
const dirLight = new THREE.DirectionalLight(0x224455, 0.8);
dirLight.position.set(1.5, 2.5, 1.5);
scene.add(dirLight);

// Materials
const barkMat = new THREE.MeshStandardMaterial({ color: 0x3d271d, roughness: 0.95 });
const mossMat = new THREE.MeshStandardMaterial({ color: 0x2e4a1f, roughness: 0.85 });
const stemMat = new THREE.MeshStandardMaterial({ color: 0x88e8df, roughness: 0.3, transparent: true, opacity: 0.85 });
const capMat = new THREE.MeshStandardMaterial({ color: 0x00f5d4, emissive: 0x00d4aa, emissiveIntensity: 1.8, roughness: 0.2 });
const gillMat = new THREE.MeshBasicMaterial({ color: 0xaafff0 });

// Fallen Log
const log = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 1.15, 12), barkMat);
log.rotation.z = Math.PI * 0.48;
log.rotation.y = 0.25;
forestGroup.add(log);

// Moss Clumps on Log
for (let i = 0; i < 8; i++) {
  const moss = new THREE.Mesh(new THREE.SphereGeometry(0.08 + Math.random() * 0.05, 8, 6), mossMat);
  moss.scale.set(1.4, 0.5, 1.2);
  moss.position.set((Math.random() - 0.5) * 0.9, 0.12, (Math.random() - 0.5) * 0.15);
  forestGroup.add(moss);
}

// Glowing Cyan Mycena Mushroom Clusters
const mushrooms = new THREE.Group();
const mPositions = [
  [-0.32, 0.14, 0.05], [-0.26, 0.15, -0.04], [-0.18, 0.16, 0.08],
  [0.08, 0.15, -0.06], [0.15, 0.14, 0.06], [0.22, 0.13, -0.02], [0.35, 0.12, 0.04]
];

mPositions.forEach((pos, idx) => {
  const m = new THREE.Group();
  const height = 0.08 + (idx % 4) * 0.035;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.009, height, 8), stemMat);
  stem.position.y = height * 0.5;
  stem.rotation.z = (Math.random() - 0.5) * 0.25;
  m.add(stem);

  // Bell-shaped Cap & Radial Gill Plates
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.65), capMat);
  cap.position.set(stem.rotation.z * height * 0.4, height, 0);
  cap.rotation.x = Math.PI;
  m.add(cap);

  for (let g = 0; g < 6; g++) {
    const gill = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.008, 3), gillMat);
    gill.position.copy(cap.position);
    gill.rotation.y = (g * Math.PI) / 3;
    m.add(gill);
  }

  m.position.set(...pos);
  mushrooms.add(m);
});
forestGroup.add(mushrooms);

// PointLight for Bioluminescent Glow
const glowLight = new THREE.PointLight(0x00ffff, 2.5, 1.8, 1.5);
glowLight.position.set(0, 0.35, 0.1);
forestGroup.add(glowLight);

scene.add(forestGroup);
