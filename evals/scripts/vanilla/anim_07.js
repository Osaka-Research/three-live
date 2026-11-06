// Circular steel bank vault door set in reinforced frame
const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, metalness: 0.9, roughness: 0.25 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.3 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x3a3f44, metalness: 0.6, roughness: 0.6 });

const vaultGroup = new THREE.Group();
vaultGroup.position.set(0, 0.8, 0);

// Reinforced frame
const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 0.4), frameMat);
const frameInnerHole = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.12, 16, 48), steelMat);
vaultGroup.add(frameOuter, frameInnerHole);

// Door hinge pivot
const doorPivot = new THREE.Group();
doorPivot.position.set(-0.85, 0, 0.2);

const door = new THREE.Group();
door.position.set(0.85, 0, 0);

// Circular vault door slab
const doorBody = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.16, 48), steelMat);
doorBody.rotation.x = Math.PI / 2;
door.add(doorBody);

// Exposed radial locking bolts
const boltGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.3, 16);
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const bolt = new THREE.Mesh(boltGeo, brassMat);
  bolt.rotation.z = angle + Math.PI / 2;
  bolt.position.set(Math.cos(angle) * 0.72, Math.sin(angle) * 0.72, 0);
  door.add(bolt);
}

// Spoked combination wheel
const wheelGroup = new THREE.Group();
wheelGroup.position.set(0, 0, 0.12);
const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 16, 32), brassMat);
const wheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.08, 24), brassMat);
wheelHub.rotation.x = Math.PI / 2;
wheelGroup.add(wheelRim, wheelHub);

const spokeGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.48, 12);
for (let s = 0; s < 3; s++) {
  const spoke = new THREE.Mesh(spokeGeo, brassMat);
  spoke.rotation.z = (s * Math.PI) / 3;
  wheelGroup.add(spoke);
}
door.add(wheelGroup);
doorPivot.add(door);
vaultGroup.add(doorPivot);
scene.add(vaultGroup);

// Lighting
const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
const dirLight = new THREE.DirectionalLight(0xeef5ff, 2.5);
dirLight.position.set(1.5, 2.5, 2.0);
scene.add(ambLight, dirLight);

// Interactivity: clicking the wheel spins it and swings the vault door open
let isOpen = false, targetAngle = 0, wheelSpin = 0;
wheelGroup.userData.interactivity = {
  onSelect: () => {
    isOpen = !isOpen;
    targetAngle = isOpen ? -Math.PI * 0.55 : 0;
    wheelSpin += Math.PI * 2;
  }
};
doorBody.userData.interactivity = wheelGroup.userData.interactivity;

function animate(dt = 0.016) {
  doorPivot.rotation.y = THREE.MathUtils.lerp(doorPivot.rotation.y, targetAngle, dt * 3.0);
  wheelGroup.rotation.z = THREE.MathUtils.lerp(wheelGroup.rotation.z, wheelSpin, dt * 5.0);
}
