const quadGroup = new THREE.Group();
quadGroup.position.set(0, 0.8, 0);
scene.add(quadGroup);

const ambient = new THREE.AmbientLight(0xffffff, 1.2);
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(2, 4, 2);
scene.add(ambient, sun);

// Materials
const carbonMat = new THREE.MeshPhysicalMaterial({ color: 0x1c1d20, roughness: 0.6, metalness: 0.2, clearcoat: 0.3 });
const motorMat = new THREE.MeshPhysicalMaterial({ color: 0xcaa030, metalness: 0.95, roughness: 0.12, iridescence: 1.0, iridescenceIOR: 1.8, clearcoat: 0.6 });
const polycarbMat = new THREE.MeshPhysicalMaterial({ color: 0x33b5e5, transmission: 0.9, transparent: true, opacity: 0.85, roughness: 0.1, ior: 1.58, clearcoat: 1.0 });
const lipoMat = new THREE.MeshPhysicalMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.1 });
const labelMat = new THREE.MeshPhysicalMaterial({ color: 0xffcc00, roughness: 0.4 });

// ExtrudeGeometry carbon X-frame arms (~0.46m span)
const armShape = new THREE.Shape();
armShape.moveTo(-0.02, -0.22);
armShape.lineTo(0.02, -0.22);
armShape.lineTo(0.015, 0.22);
armShape.lineTo(-0.015, 0.22);
armShape.closePath();
const armGeo = new THREE.ExtrudeGeometry(armShape, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002 });

[-Math.PI / 4, Math.PI / 4].forEach(rot => {
  const arm = new THREE.Mesh(armGeo, carbonMat);
  arm.rotation.x = Math.PI / 2;
  arm.rotation.z = rot;
  quadGroup.add(arm);
});

// Central plates & standoffs
const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.004, 0.18), carbonMat);
topPlate.position.y = 0.025;
quadGroup.add(topPlate);

for (let i = -1; i <= 1; i += 2) {
  for (let j = -1; j <= 1; j += 2) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.025, 12), motorMat);
    post.position.set(i * 0.03, 0.0125, j * 0.06);
    quadGroup.add(post);
  }
}

// 4 Iridescent Brushless Motors and Tri-blade Propellers
const motorPositions = [
  [-0.15, 0.15], [0.15, 0.15],
  [-0.15, -0.15], [0.15, -0.15]
];
motorPositions.forEach(([x, z]) => {
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.018, 24), motorMat);
  bell.position.set(x, 0.015, z);
  quadGroup.add(bell);

  const propGroup = new THREE.Group();
  propGroup.position.set(x, 0.026, z);
  for (let b = 0; b < 3; b++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.002, 0.09), polycarbMat);
    blade.position.z = 0.045;
    blade.rotation.x = 0.18;
    const bladePivot = new THREE.Group();
    bladePivot.rotation.y = (b * Math.PI * 2) / 3;
    bladePivot.add(blade);
    propGroup.add(bladePivot);
  }
  quadGroup.add(propGroup);
});

// LiPo battery pack & strap
const battery = new THREE.Mesh(new THREE.BoxGeometry(0.046, 0.036, 0.11), lipoMat);
battery.position.set(0, 0.045, -0.01);
const strap = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.038, 0.025), labelMat);
strap.position.set(0, 0.045, -0.01);
quadGroup.add(battery, strap);

// Tilted FPV Camera Pod
const camPod = new THREE.Group();
camPod.position.set(0, 0.025, 0.08);
camPod.rotation.x = -Math.PI / 6;
const camBody = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.028, 0.03), motorMat);
const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 16), carbonMat);
lens.rotation.x = Math.PI / 2;
lens.position.z = 0.018;
camPod.add(camBody, lens);
quadGroup.add(camPod);

quadGroup.userData.xr = { grab: true };
function animate(dt = 0.016) {
  quadGroup.rotation.y += 0.2 * dt;
}
