const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xfff0dd, 1.2);
dirLight.position.set(5, 8, 4);
scene.add(dirLight);

const floorGeo = new THREE.PlaneGeometry(16, 16);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x333b42, roughness: 0.8 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.userData.xr = { navigable: 'walkable', collidable: true, type: 'floor' };
scene.add(floor);

const rackGeo = new THREE.BoxGeometry(0.1, 2.5, 3.0);
const rackMat = new THREE.MeshStandardMaterial({ color: 0xd97724, metalness: 0.5 });
for (let i = -1; i <= 1; i += 2) {
  const rack = new THREE.Group();
  rack.position.set(i * 3, 1.25, -1);
  const frame1 = new THREE.Mesh(rackGeo, rackMat);
  frame1.position.z = -1;
  const frame2 = frame1.clone();
  frame2.position.z = 1;
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 2.4), new THREE.MeshStandardMaterial({ color: 0x88929b }));
  shelf.position.y = 0.2;
  rack.add(frame1, frame2, shelf);
  rack.userData.xr = { collidable: true, label: 'Pallet Rack' };
  scene.add(rack);
}

const worker = new THREE.Group();
worker.position.set(0, 0, 1.2);
const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 12), new THREE.MeshStandardMaterial({ color: 0x2563eb }));
body.position.y = 0.6;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshStandardMaterial({ color: 0xf5d0b0 }));
head.position.y = 1.35;
worker.add(body, head);
worker.userData.xr = { character: 'third-person', speed: 3.5, label: 'Worker' };
scene.add(worker);

const forkliftMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.4 });
const waypointsA = [{ x: -2, z: 2 }, { x: -2, z: -3 }, { x: 2, z: -3 }, { x: 2, z: 2 }];
const waypointsB = [{ x: 3, z: -2 }, { x: -3, z: -2 }, { x: -3, z: 0 }, { x: 3, z: 0 }];
[waypointsA, waypointsB].forEach((wps) => {
  const forklift = new THREE.Group();
  forklift.position.set(wps[0].x, 0.4, wps[0].z);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 1.4), forkliftMat);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: 0x222222 }));
  mast.position.set(0, 0.5, 0.7);
  forklift.add(cab, mast);
  forklift.userData.xr = { agent: { mode: 'patrol', speed: 2.0, waypoints: wps }, collidable: true };
  scene.add(forklift);
});

const zoneGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.05, 16);
const zoneColors = [0x10b981, 0x06b6d4, 0x8b5cf6];
[-2.5, 0, 2.5].forEach((x, i) => {
  const zoneMat = new THREE.MeshStandardMaterial({ color: zoneColors[i], transparent: true, opacity: 0.6 });
  const zone = new THREE.Mesh(zoneGeo, zoneMat);
  zone.position.set(x, 0.025, 0);
  zone.userData.xr = { zone: true, objective: `checkpoint_${i + 1}`, label: `Checkpoint ${i + 1}` };
  scene.add(zone);
});
