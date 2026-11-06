// mat_03: 3x3 material calibration rack with 9 complex shader balls
const rack = new THREE.Group();
rack.position.set(0, 0.8, 0);
scene.add(rack);

// Stand frame
const frameMat = new THREE.MeshStandardMaterial({ color: 0x24282e, metalness: 0.8, roughness: 0.4 });
const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.03, 0.96), frameMat);
basePlate.position.y = -0.32;
rack.add(basePlate);

// 9 Materials for calibration shader balls
const materials = [
  new THREE.MeshPhysicalMaterial({ color: 0x990000, metalness: 0.65, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.04 }), // Car paint
  new THREE.MeshPhysicalMaterial({ color: 0x2d1445, roughness: 0.85, sheen: 1.0, sheenColor: 0xa855f7, sheenRoughness: 0.45 }),     // Velvet sheen
  new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.92, roughness: 0.38, ior: 1.5, thickness: 0.18 }),               // Frosted glass
  new THREE.MeshPhysicalMaterial({ color: 0xf5c342, metalness: 0.95, roughness: 0.34, clearcoat: 0.1 }),                              // Brushed gold
  new THREE.MeshPhysicalMaterial({ color: 0xf0f3f6, metalness: 1.0, roughness: 0.02 }),                                               // Mirror chrome
  new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, roughness: 0.12, clearcoat: 0.85, clearcoatRoughness: 0.08 }),                    // Glazed ceramic
  new THREE.MeshPhysicalMaterial({ color: 0x1c1e22, roughness: 0.92, metalness: 0.02 }),                                               // Matte rubber
  new THREE.MeshPhysicalMaterial({ color: 0xd97543, metalness: 0.94, roughness: 0.22 }),                                               // Burnished copper
  new THREE.MeshPhysicalMaterial({ color: 0x120224, emissive: 0x9933ff, emissiveIntensity: 2.8, roughness: 0.15, transmission: 0.4 })// Plasma core
];

// Helper to construct slotted outer shell + core shader ball
function createShaderBall(mat) {
  const ballGroup = new THREE.Group();
  // Pedestal mount
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.1, 24), frameMat);
  mount.position.y = -0.05;
  ballGroup.add(mount);
  // Slotted outer shell (cutout dome with longitudinal slot)
  const outerGeo = new THREE.SphereGeometry(0.07, 32, 24, 0, Math.PI * 1.65, 0, Math.PI * 0.88);
  const outerShell = new THREE.Mesh(outerGeo, mat);
  outerShell.rotation.x = 0.2;
  ballGroup.add(outerShell);
  // Inner smooth core
  const innerCore = new THREE.Mesh(new THREE.SphereGeometry(0.046, 32, 24), mat);
  ballGroup.add(innerCore);
  return ballGroup;
}

// Layout in 3x3 grid
const spacing = 0.28;
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 3; col++) {
    const idx = row * 3 + col;
    const ball = createShaderBall(materials[idx]);
    ball.position.set((col - 1) * spacing, -0.18 + (2 - row) * 0.28, (row - 1) * 0.05);
    rack.add(ball);
  }
}

// Lighting setup for studio material evaluation
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyDir = new THREE.DirectionalLight(0xfff7eb, 2.5);
keyDir.position.set(1.5, 3.2, 2.5);
scene.add(keyDir);

const rimDir = new THREE.DirectionalLight(0xcceeff, 1.4);
rimDir.position.set(-2.0, 2.0, -1.5);
scene.add(rimDir);

scene.userData.animate = (dt) => {
  rack.rotation.y += dt * 0.25;
};
