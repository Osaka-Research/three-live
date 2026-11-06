const ambientLight = new THREE.AmbientLight(0xfff7ee, 0.7);
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.4);
dirLight.position.set(1.5, 3.0, 2.0);
scene.add(ambientLight, dirLight);

const boxGroup = new THREE.Group();
boxGroup.position.set(0, 0.8, 0);
boxGroup.rotation.y = -Math.PI / 8;
scene.add(boxGroup);

const walnutMat = new THREE.MeshStandardMaterial({ color: 0x4a2a18, roughness: 0.5 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.95, roughness: 0.15 });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.92,
  opacity: 1,
  transparent: true,
  roughness: 0.05,
  ior: 1.5,
  thickness: 0.015
});

// Walnut box body & velvet bed
const baseBox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.38), walnutMat);
baseBox.position.y = -0.07;
const bed = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.04, 0.31), new THREE.MeshStandardMaterial({ color: 0x8b0000, roughness: 0.9 }));
bed.position.y = -0.01;
boxGroup.add(baseBox, bed);

// Open glass-topped lid
const lidGroup = new THREE.Group();
lidGroup.position.set(0, 0, -0.18);
lidGroup.rotation.x = -Math.PI / 3;
const lidFrame = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.38), walnutMat);
lidFrame.position.z = 0.19;
const glassPane = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.29), glassMat);
glassPane.position.set(0, 0, 0.19);
lidGroup.add(lidFrame, glassPane);
boxGroup.add(lidGroup);

// Rotating brass cylinder with 60 pins
const cylGroup = new THREE.Group();
cylGroup.position.set(-0.02, 0.05, 0.02);
cylGroup.rotation.z = Math.PI / 2;
const mainCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.28, 32), brassMat);
cylGroup.add(mainCylinder);

const pinGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.012, 8);
const pinMesh = new THREE.InstancedMesh(pinGeo, brassMat, 60);
const dummy = new THREE.Object3D();
for (let i = 0; i < 60; i++) {
  const theta = (i * 0.45) % (Math.PI * 2);
  const y = -0.12 + (i / 60) * 0.24;
  dummy.position.set(Math.cos(theta) * 0.045, y, Math.sin(theta) * 0.045);
  dummy.rotation.set(0, -theta, Math.PI / 2);
  dummy.updateMatrix();
  pinMesh.setMatrixAt(i, dummy.matrix);
}
pinMesh.instanceMatrix.needsUpdate = true;
cylGroup.add(pinMesh);
boxGroup.add(cylGroup);

// Tuned steel comb with graduated teeth
const combGroup = new THREE.Group();
combGroup.position.set(-0.02, 0.05, 0.08);
const combBase = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.015, 0.03), steelMat);
combGroup.add(combBase);
for (let i = 0; i < 18; i++) {
  const toothLen = 0.04 - (i / 18) * 0.02;
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.006, toothLen), steelMat);
  tooth.position.set(-0.12 + i * 0.014, 0.004, -toothLen / 2);
  combGroup.add(tooth);
}
boxGroup.add(combGroup);

// Spinning fly-governor
const govGroup = new THREE.Group();
govGroup.position.set(0.18, 0.06, 0.02);
const govShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 12), brassMat);
const vane1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.001), brassMat);
vane1.position.x = 0.02;
const vane2 = vane1.clone();
vane2.position.x = -0.02;
govGroup.add(govShaft, vane1, vane2);
boxGroup.add(govGroup);

// Winding key
const keyGroup = new THREE.Group();
keyGroup.position.set(0.28, -0.05, 0);
keyGroup.rotation.z = Math.PI / 2;
const keyShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.04, 12), brassMat);
const keyWing1 = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 16), brassMat);
keyWing1.position.set(0.02, 0.02, 0);
const keyWing2 = keyWing1.clone();
keyWing2.position.set(-0.02, 0.02, 0);
keyGroup.add(keyShaft, keyWing1, keyWing2);
boxGroup.add(keyGroup);

let time = 0;
function animate(dt = 0.016) {
  time += dt;
  cylGroup.rotation.y = time * 0.8;
  govGroup.rotation.y = time * 12.0;
  keyGroup.rotation.y = -time * 0.2;
}
scene.userData.update = animate;
