const terrainBasin = new THREE.Group();
terrainBasin.position.set(0, 0.75, 0);
terrainBasin.userData.xr = {
  anchor: 'table',
  grab: '2-hand',
  scaleLimits: { min: 0.6, max: 2.5 }
};
scene.add(terrainBasin);

scene.add(new THREE.AmbientLight(0x778899, 0.6));
const dirLight = new THREE.DirectionalLight(0xffeebb, 0.9);
dirLight.position.set(2, 4, 1.5);
scene.add(dirLight);

// Tabletop basin rim & water/ground plane
const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.68, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0x3d3025, roughness: 0.8 }));
const waterPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ color: 0x1d4d68, roughness: 0.1, metalness: 0.4 }));
waterPlane.rotation.x = -Math.PI / 2;
waterPlane.position.y = 0.031;
terrainBasin.add(rim, waterPlane);

// Mountains (ConeGeometry)
const mountainMat = new THREE.MeshStandardMaterial({ color: 0x5a6351, roughness: 0.9 });
const mtn1 = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.35, 7), mountainMat);
mtn1.position.set(-0.25, 0.2, -0.15);
const mtn2 = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.28, 6), mountainMat);
mtn2.position.set(0.1, 0.17, -0.25);
terrainBasin.add(mtn1, mtn2);

// Valley city structures (Cylinders)
const cityMat = new THREE.MeshStandardMaterial({ color: 0x8a929a, metalness: 0.3 });
[[-0.05, 0.08], [0.05, 0.05], [0.02, 0.12]].forEach(([x, z], i) => {
  const bldg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08 + i * 0.03, 6), cityMat);
  bldg.position.set(x, 0.07 + (i * 0.015), z);
  terrainBasin.add(bldg);
});

// Storm clouds emitting particle rain and snow
const cloudMat = new THREE.MeshStandardMaterial({ color: 0x4f5b66, roughness: 0.9, transparent: true, opacity: 0.85 });
const cloudGeo = new THREE.SphereGeometry(0.12, 12, 12);

const rainCloud = new THREE.Mesh(cloudGeo, cloudMat);
rainCloud.position.set(-0.15, 0.55, 0.1);
rainCloud.scale.set(1.6, 0.6, 1.0);
rainCloud.userData.xr = { particles: { preset: 'rain', rate: 120, area: [0.3, 0.2] } };

const snowCloud = new THREE.Mesh(cloudGeo, cloudMat);
snowCloud.position.set(0.2, 0.58, -0.1);
snowCloud.scale.set(1.4, 0.5, 0.9);
snowCloud.userData.xr = { particles: { preset: 'snow', rate: 60, area: [0.25, 0.25] } };
terrainBasin.add(rainCloud, snowCloud);

// Lighthouse beacon with audioEmitter
const lighthouse = new THREE.Group();
lighthouse.position.set(0.35, 0.03, 0.2);
const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
tower.position.y = 0.1;
const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff099 }));
beacon.position.y = 0.21;
lighthouse.add(tower, beacon);
lighthouse.userData.xr = {
  audioEmitter: { clip: 'foghorn_and_waves', loop: true, refDistance: 0.5, maxDistance: 2.5 }
};
terrainBasin.add(lighthouse);
