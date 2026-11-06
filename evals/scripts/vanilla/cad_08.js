const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(2, 3, 4);
const rimLight = new THREE.PointLight(0x44aaff, 1.0, 3);
rimLight.position.set(-2, 1.5, -1);
scene.add(ambLight, dirLight, rimLight);

const cameraGroup = new THREE.Group();
cameraGroup.position.set(0, 0.8, 0);

const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7, metalness: 0.3 });
const metalMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.3, metalness: 0.8 });
const rubberMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, metalness: 0.05 });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x16344d,
  roughness: 0.05,
  metalness: 0.1,
  transmission: 0.92,
  ior: 1.54,
  clearcoat: 1.0,
  clearcoatRoughness: 0.1
});

// Mirrorless Camera Body
const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.05), bodyMat);
cameraGroup.add(body);

// Ergonomic grip using ExtrudeGeometry
const gripShape = new THREE.Shape();
gripShape.moveTo(0, 0);
gripShape.quadraticCurveTo(0.025, 0.015, 0.035, 0.04);
gripShape.quadraticCurveTo(0.03, 0.07, 0, 0.08);
gripShape.closePath();
const gripGeo = new THREE.ExtrudeGeometry(gripShape, { depth: 0.04, bevelEnabled: true, bevelSegments: 3, bevelSize: 0.006, bevelThickness: 0.006 });
const grip = new THREE.Mesh(gripGeo, rubberMat);
grip.rotation.y = Math.PI / 2;
grip.position.set(0.045, -0.045, 0.06);
cameraGroup.add(grip);

// Viewfinder & hot-shoe mount
const evf = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.022, 0.045), bodyMat);
evf.position.set(0, 0.052, 0);
const hotShoe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 0.02), metalMat);
hotShoe.position.set(0, 0.065, 0);
cameraGroup.add(evf, hotShoe);

// Mode dials and shutter button
const modeDial = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 24), metalMat);
modeDial.position.set(-0.045, 0.05, 0);
const shutterBtn = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.008, 16), metalMat);
shutterBtn.position.set(0.052, 0.048, 0.015);
cameraGroup.add(modeDial, shutterBtn);

// Attached f/2.8 telephoto zoom lens
const lensBarrel = new THREE.Group();
lensBarrel.position.set(0, 0, 0.025);

const barrelBase = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.044, 0.08, 32), metalMat);
barrelBase.rotation.x = Math.PI / 2;
barrelBase.position.z = 0.04;
lensBarrel.add(barrelBase);

// Ribbed rubber focus and zoom rings
[-0.01, 0.06].forEach((zOff) => {
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 0.035, 32), rubberMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.z = 0.12 + zOff;
  lensBarrel.add(ring);
});

const frontBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.044, 0.12, 32), metalMat);
frontBarrel.rotation.x = Math.PI / 2;
frontBarrel.position.z = 0.17;
lensBarrel.add(frontBarrel);

// Petal-shaped lens hood (4 curved scalloped petals)
for (let p = 0; p < 4; p++) {
  const angle = (p * Math.PI) / 2;
  const petalLen = p % 2 === 0 ? 0.05 : 0.032;
  const petal = new THREE.Mesh(new THREE.CylinderGeometry(0.054, 0.047, petalLen, 16, 1, true, angle - 0.55, 1.1), rubberMat);
  petal.rotation.x = Math.PI / 2;
  petal.position.z = 0.23 + petalLen / 2;
  lensBarrel.add(petal);
}

// Multi-coated glass front element
const frontElement = new THREE.Mesh(new THREE.SphereGeometry(0.044, 32, 16, 0, Math.PI * 2, 0, 0.6), glassMat);
frontElement.rotation.x = -Math.PI / 2;
frontElement.position.z = 0.23;
lensBarrel.add(frontElement);

cameraGroup.add(lensBarrel);
scene.add(cameraGroup);

cameraGroup.userData.xr = { grab: true };
function animate(dt) {
  cameraGroup.rotation.y = Math.sin(Date.now() * 0.001) * 0.25;
}
