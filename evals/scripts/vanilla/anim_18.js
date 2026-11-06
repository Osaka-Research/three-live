const ambientLight = new THREE.AmbientLight(0xf5ede2, 0.8);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(3, 5, 2);
scene.add(ambientLight, dirLight);

const rotunda = new THREE.Group();
rotunda.position.set(0, 0.3, 0);
scene.add(rotunda);

const marbleMat = new THREE.MeshStandardMaterial({ color: 0xedebe6, roughness: 0.25 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.2 });
const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x242426, roughness: 0.6 });
const pegMat = new THREE.MeshStandardMaterial({ color: 0x9c27b0, roughness: 0.4 });

// Sunken floor pit & rim
const pitFloor = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.1, 48), darkStoneMat);
pitFloor.position.y = -0.05;
const rimTorus = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 16, 48), marbleMat);
rimTorus.rotation.x = Math.PI / 2;
rotunda.add(pitFloor, rimTorus);

// Balustrade handrail & balusters
const railTorus = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 16, 48), marbleMat);
railTorus.rotation.x = Math.PI / 2;
railTorus.position.y = 0.45;
rotunda.add(railTorus);

const balusterGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.45, 12);
for (let i = 0; i < 24; i++) {
  const angle = (i / 24) * Math.PI * 2;
  const baluster = new THREE.Mesh(balusterGeo, marbleMat);
  baluster.position.set(Math.cos(angle) * 1.2, 0.225, Math.sin(angle) * 1.2);
  rotunda.add(baluster);
}

// Inlaid 8-point brass compass rose
const compassGroup = new THREE.Group();
compassGroup.position.y = 0.002;
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const isMajor = i % 2 === 0;
  const point = new THREE.Mesh(new THREE.ConeGeometry(isMajor ? 0.06 : 0.035, isMajor ? 0.5 : 0.32, 4), brassMat);
  point.rotation.x = Math.PI / 2;
  point.rotation.z = angle;
  point.position.set(Math.sin(angle) * (isMajor ? 0.25 : 0.16), 0, Math.cos(angle) * (isMajor ? 0.25 : 0.16));
  compassGroup.add(point);
}
rotunda.add(compassGroup);

// Ring of 36 domino pegs
const pegGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.06, 8);
for (let i = 0; i < 36; i++) {
  const angle = (i / 36) * Math.PI * 2;
  const peg = new THREE.Mesh(pegGeo, pegMat);
  peg.position.set(Math.cos(angle) * 0.8, 0.03, Math.sin(angle) * 0.8);
  rotunda.add(peg);
}

// Brass Foucault pendulum
const pendulumGroup = new THREE.Group();
pendulumGroup.position.set(0, 2.5, 0);
scene.add(pendulumGroup);

const cableLength = 2.3;
const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, cableLength, 8), brassMat);
cable.position.y = -cableLength / 2;
pendulumGroup.add(cable);

const bobGroup = new THREE.Group();
bobGroup.position.y = -cableLength;
const sphereBob = new THREE.Mesh(new THREE.SphereGeometry(0.08, 32, 24), brassMat);
const tipCone = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.07, 16), brassMat);
tipCone.rotation.x = Math.PI;
tipCone.position.y = -0.09;
bobGroup.add(sphereBob, tipCone);
pendulumGroup.add(bobGroup);

let time = 0;
function animate(dt = 0.016) {
  time += dt;
  pendulumGroup.rotation.y = time * 0.04;
  pendulumGroup.rotation.z = Math.sin(time * 1.5) * 0.22;
}
scene.userData.update = animate;
