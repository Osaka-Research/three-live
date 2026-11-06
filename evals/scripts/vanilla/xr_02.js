const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(2, 3, 2);
scene.add(ambientLight, dirLight);

const nacelle = new THREE.Group();
nacelle.position.set(0, 0.8, 0);
nacelle.rotation.y = -Math.PI / 4;
nacelle.userData.xr = { grab: '2-hand', scale: { min: 0.5, max: 2.5 }, dimensions: { unit: 'cm' } };

const metalMat = new THREE.MeshStandardMaterial({ color: 0x99a0a8, metalness: 0.85, roughness: 0.25 });
const titaniumMat = new THREE.MeshStandardMaterial({ color: 0x4f6479, metalness: 0.95, roughness: 0.15 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b3036, metalness: 0.7, roughness: 0.4 });
const hotMat = new THREE.MeshStandardMaterial({ color: 0x3d271d, metalness: 0.6, roughness: 0.5 });

// 1. Intake Cowling
const intakeGroup = new THREE.Group();
const intakeOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.25, 32, 1, true), metalMat);
const intakeLip = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.03, 16, 32), metalMat);
intakeLip.rotation.x = Math.PI / 2;
intakeLip.position.y = 0.125;
intakeGroup.add(intakeOuter, intakeLip);
intakeGroup.position.z = 0.5;
intakeGroup.userData.xr = { explode: { axis: 'z', distance: 0.6, layer: 1, label: 'Intake Cowling' } };

// 2. Titanium Fan Stage
const fanGroup = new THREE.Group();
const fanHub = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 24), titaniumMat);
fanHub.rotation.x = -Math.PI / 2;
fanGroup.add(fanHub);
for (let i = 0; i < 18; i++) {
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.02, 0.24, 8), titaniumMat);
  blade.rotation.z = (i / 18) * Math.PI * 2;
  blade.rotation.y = 0.4;
  blade.translateY(0.22);
  fanGroup.add(blade);
}
fanGroup.position.z = 0.25;
fanGroup.userData.xr = { explode: { axis: 'z', distance: 0.3, layer: 2, label: 'Titanium Fan Stage' } };

// 3. Axial Compressor
const compGroup = new THREE.Group();
for (let j = 0; j < 4; j++) {
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.24 - j * 0.02, 0.24 - j * 0.02, 0.04, 24), darkMetal);
  disk.rotation.x = Math.PI / 2;
  disk.position.z = -j * 0.06;
  compGroup.add(disk);
}
compGroup.position.z = 0.05;
compGroup.userData.xr = { explode: { axis: 'z', distance: 0.0, layer: 3, label: 'Axial Compressor' } };

// 4. Combustor
const combGroup = new THREE.Group();
const chamber = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.045, 16, 32), hotMat);
chamber.rotation.x = Math.PI / 2;
const casing = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.16, 24, 1, true), darkMetal);
combGroup.add(chamber, casing);
combGroup.position.z = -0.25;
combGroup.userData.xr = { explode: { axis: 'z', distance: -0.3, layer: 4, label: 'Combustor' } };

// 5. Exhaust Nozzle
const exhaustGroup = new THREE.Group();
const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.3, 32, 1, true), titaniumMat);
nozzle.rotation.x = Math.PI / 2;
exhaustGroup.add(nozzle);
exhaustGroup.position.z = -0.55;
exhaustGroup.userData.xr = { explode: { axis: 'z', distance: -0.6, layer: 5, label: 'Exhaust Nozzle' } };

// Leader lines
const lineMat = new THREE.LineBasicMaterial({ color: 0x44ddff, transparent: true, opacity: 0.6 });
const lineGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0.45, 0.5), new THREE.Vector3(0.5, 0.65, 0.5),
  new THREE.Vector3(0, 0.35, -0.55), new THREE.Vector3(0.5, 0.55, -0.55)
]);
const leaderLines = new THREE.LineSegments(lineGeo, lineMat);

nacelle.add(intakeGroup, fanGroup, compGroup, combGroup, exhaustGroup, leaderLines);
scene.add(nacelle);

function animate(dt) {
  fanGroup.rotation.z += (dt || 0.016) * 4;
}
