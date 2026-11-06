// org_03: Coiled King Cobra Ready to Strike
const cobraGroup = new THREE.Group();
cobraGroup.position.set(0, 0, 0);
scene.add(cobraGroup);

const ambientLight = new THREE.AmbientLight(0xfff5e6, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(2, 4, 3);
scene.add(dirLight);

const scaleMat = new THREE.MeshStandardMaterial({
  color: 0x3b2f20,
  roughness: 0.45,
  metalness: 0.15
});
const hoodMat = new THREE.MeshStandardMaterial({
  color: 0x6b5335,
  roughness: 0.5,
  metalness: 0.1,
  side: THREE.DoubleSide
});
const fangMat = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.2
});
const tongueMat = new THREE.MeshStandardMaterial({
  color: 0xdc2626,
  roughness: 0.4
});

// Coiled body & S-curved raised neck along a CatmullRomCurve3
const bodyPoints = [];
const turns = 2.2;
for (let i = 0; i <= 36; i++) {
  const t = i / 36;
  const angle = t * turns * Math.PI * 2;
  const radius = 0.28 * (1 - 0.35 * t);
  const y = 0.04 + t * 0.11;
  bodyPoints.push(new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius));
}
// S-curved raised neck up to y = 0.72m
bodyPoints.push(
  new THREE.Vector3(0.06, 0.26, -0.05),
  new THREE.Vector3(0.0, 0.45, -0.10),
  new THREE.Vector3(0.0, 0.64, -0.02),
  new THREE.Vector3(0.0, 0.74, 0.06)
);

const bodyCurve = new THREE.CatmullRomCurve3(bodyPoints);
const bodyGeo = new THREE.TubeGeometry(bodyCurve, 64, 0.038, 14, false);
const bodyMesh = new THREE.Mesh(bodyGeo, scaleMat);
cobraGroup.add(bodyMesh);

// Flared flattened hood
const hoodGeo = new THREE.SphereGeometry(0.14, 20, 16);
const hoodMesh = new THREE.Mesh(hoodGeo, hoodMat);
hoodMesh.scale.set(1.1, 1.5, 0.22);
hoodMesh.position.set(0, 0.58, 0.01);
hoodMesh.rotation.x = 0.25;
cobraGroup.add(hoodMesh);

// Sculpted head
const headGeo = new THREE.SphereGeometry(0.065, 16, 14);
const headMesh = new THREE.Mesh(headGeo, scaleMat);
headMesh.scale.set(0.95, 0.75, 1.35);
headMesh.position.set(0, 0.75, 0.09);
cobraGroup.add(headMesh);

// Fangs
for (const side of [-1, 1]) {
  const fang = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.032, 8), fangMat);
  fang.position.set(side * 0.024, 0.72, 0.14);
  fang.rotation.x = Math.PI * 0.9;
  cobraGroup.add(fang);
}

// Forked tongue
for (const side of [-1, 1]) {
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.004, 0.05, 6), tongueMat);
  tip.position.set(side * 0.01, 0.73, 0.19);
  tip.rotation.x = Math.PI / 2;
  tip.rotation.z = side * -0.25;
  cobraGroup.add(tip);
}
