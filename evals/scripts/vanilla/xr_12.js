const courseGroup = new THREE.Group();
scene.add(courseGroup);

scene.add(new THREE.AmbientLight(0x1a2035, 0.8));
const mainPoint = new THREE.PointLight(0x00ffff, 2, 8);
mainPoint.position.set(0, 1.8, 0);
scene.add(mainPoint);

// Drone character
const drone = new THREE.Group();
drone.position.set(0, 0.6, 1.2);
drone.userData.xr = { role: 'player-drone', simType: 'xr-live-sim', speed: 2.5 };
const droneBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.2), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 }));
const droneRotorPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.04), new THREE.MeshBasicMaterial({ color: 0x888888 }));
drone.add(droneBody, droneRotorPillar);
courseGroup.add(drone);

// 5 Glowing neon hoop rings
const torusGeo = new THREE.TorusGeometry(0.28, 0.03, 16, 32);
const hoopMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x00ffaa, emissiveIntensity: 1.5, roughness: 0.2 });

const hoopPositions = [
  [-0.6, 0.7, 0.5],
  [-0.3, 1.0, 0.0],
  [0.0, 0.8, -0.5],
  [0.4, 1.1, -0.8],
  [0.6, 0.75, -0.2]
];

hoopPositions.forEach((pos, i) => {
  const hoop = new THREE.Mesh(torusGeo, hoopMat);
  hoop.position.set(...pos);
  hoop.rotation.y = (i * 0.4) - 0.8;
  hoop.userData.xr = {
    zone: 'sphere',
    radius: 0.35,
    objective: { type: 'checkpoint', order: i + 1, amount: 50 }
  };
  const ringLight = new THREE.PointLight(0x00ffcc, 0.8, 1.2);
  hoop.add(ringLight);
  courseGroup.add(hoop);
});

// Hazard laser pylons
const pylonGeo = new THREE.CylinderGeometry(0.05, 0.08, 1.2, 16);
const pylonMat = new THREE.MeshStandardMaterial({ color: 0x331111, metalness: 0.5 });
const laserMat = new THREE.MeshBasicMaterial({ color: 0xff0044 });

[[-0.7, 0.6, -0.1], [0.7, 0.6, -0.5]].forEach((pos) => {
  const pylon = new THREE.Group();
  pylon.position.set(...pos);
  const baseMesh = new THREE.Mesh(pylonGeo, pylonMat);
  const laserBeam = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.02), laserMat);
  laserBeam.position.y = 0.2;
  pylon.add(baseMesh, laserBeam);
  pylon.userData.xr = {
    hazard: 'laser',
    integrity: 100,
    audioCues: { hum: 'sfx_laser_hum', alarm: 'sfx_hazard_hit' }
  };
  courseGroup.add(pylon);
});
