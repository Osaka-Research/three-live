scene.add(new THREE.AmbientLight(0x1e293b, 0.5));
const bayLight = new THREE.PointLight(0x7dd3fc, 1.8, 6, 2);
bayLight.position.set(0, 1.2, 0);
scene.add(bayLight);

const warningLight = new THREE.PointLight(0xf97316, 0.9, 4, 2);
warningLight.position.set(0, 0.4, -0.95);
scene.add(warningLight);

// Airlock cylindrical hull
const hullMat = new THREE.MeshStandardMaterial({
  color: 0x64748b,
  roughness: 0.55,
  metalness: 0.65,
  side: THREE.DoubleSide
});
const airlockHull = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 2.1, 32, 1, true), hullMat);
airlockHull.position.set(0, 0.8, 0);
scene.add(airlockHull);

// Hatch pressure ring and bulkhead doors
const hatchRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.62, 0.05, 16, 32),
  new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.8 })
);
hatchRing.position.set(0, 0.8, -1.04);
scene.add(hatchRing);

const doorMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.7, roughness: 0.3 });
[-0.25, 0.25].forEach((xOffset) => {
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.05, 0.04), doorMat);
  door.position.set(xOffset, 0.8, -1.04);
  scene.add(door);
});

// Curved grab handholds along airlock perimeter
const handholdMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.25, metalness: 0.5 });
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const handhold = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.012, 8, 16, Math.PI), handholdMat);
  handhold.position.set(Math.cos(angle) * 1.08, 0.8 + (i % 2) * 0.28 - 0.14, Math.sin(angle) * 0.55);
  handhold.rotation.y = -angle + Math.PI / 2;
  scene.add(handhold);
}

// Toolrack socket fixture
const toolrack = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.55, 0.05), doorMat);
toolrack.position.set(1.0, 0.8, 0);
toolrack.rotation.y = -Math.PI / 2;
toolrack.userData.xr = { socketTag: 'toolrack', isSocket: true };
scene.add(toolrack);

// Floating zero-gravity maintenance tools
const toolMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.8, roughness: 0.2 });
[new THREE.Vector3(-0.25, 0.88, 0.15), new THREE.Vector3(0.28, 0.76, -0.2)].forEach((pos) => {
  const tool = new THREE.Group();
  tool.position.copy(pos);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.15, 12), toolMat);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.07), doorMat);
  head.position.y = 0.08;
  tool.add(handle, head);

  tool.userData.xr = {
    grab: '1-hand',
    physics: { body: 'dynamic', gravityScale: 0, linearDamping: 0.2 },
    snapTo: { socketTag: 'toolrack' }
  };
  scene.add(tool);
});
