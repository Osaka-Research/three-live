// Interactive XR Workbench with Grabbable Tools, Physics Colliders & KHR_interactivity
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const key = new THREE.DirectionalLight(0xffffff, 1.3);
key.position.set(2, 4, 3);
scene.add(key);

const legs = new THREE.Mesh(
  new THREE.BoxGeometry(1.3, 0.72, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
);
legs.name = 'workbench_base';
legs.position.set(0, 0.36, 0);
scene.add(legs);

const table = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 0.08, 0.8),
  new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 })
);
table.name = 'xr_workbench_table';
table.position.set(0, 0.76, 0);
table.userData.xr = {
  anchor: 'Table',
  physics: { body: 'static', collider: 'box' },
};
scene.add(table);

const artifact = new THREE.Mesh(
  new THREE.TorusKnotGeometry(0.1, 0.03, 48, 12),
  new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, metalness: 0.2, roughness: 0.1, transmission: 0.7 })
);
artifact.name = 'holo_artifact';
artifact.position.set(0, 0.96, 0);
artifact.userData.xr = {
  grabbable: true,
  physics: { body: 'dynamic', collider: 'hull', mass: 0.5, restitution: 0.4 },
};
artifact.userData.interactivity = {
  onSelect: { action: 'toggleRotate', target: 'holo_artifact', axis: [0, 1, 0], angle: 3.14159, duration: 0.8 },
};
scene.add(artifact);

camera.position.set(0, 1.4, 2.2);
camera.lookAt(0, 0.65, 0);
