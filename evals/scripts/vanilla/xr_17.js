scene.add(new THREE.AmbientLight(0xe2e8f0, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);

const chassis = new THREE.Group();
chassis.position.set(0, 0.6, 0);
chassis.userData.xr = {
  handles: true,
  dimensions: { unit: 'mm', x: 1800, y: 320, z: 900 }
};
scene.add(chassis);

// Main skateboard floor structure
const frameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
const floorBed = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 0.75), frameMat);
chassis.add(floorBed);

// Dual front and rear drive motors with suspension
const motorMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.7, roughness: 0.25 });
[-0.6, 0.6].forEach((zPos) => {
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.28, 24), motorMat);
  motor.rotation.z = Math.PI / 2;
  motor.position.set(0, 0.02, zPos);
  chassis.add(motor);

  [-0.32, 0.32].forEach((xPos) => {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.2, 12), frameMat);
    arm.rotation.z = (Math.PI / 4) * Math.sign(xPos);
    arm.position.set(xPos * 0.7, 0.02, zPos);
    chassis.add(arm);

    const coil = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.009, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0xeab308, metalness: 0.8, roughness: 0.2 })
    );
    coil.position.set(xPos, 0.04, zPos);
    coil.rotation.x = Math.PI / 2;
    chassis.add(coil);
  });
});

// 4-layer battery module stack with explode and thermal outline
const batteryStack = new THREE.Group();
batteryStack.position.set(0, 0.05, 0);
batteryStack.userData.xr = {
  explode: { distance: 0.12, axis: 'y' },
  outline: { color: 0xff3b30, intensity: 1.8, mode: 'thermal' }
};
chassis.add(batteryStack);

const cellMat = new THREE.MeshStandardMaterial({
  color: 0x0f172a,
  roughness: 0.35,
  emissive: 0x451a03,
  emissiveIntensity: 0.5
});
for (let layer = 0; layer < 4; layer++) {
  const module = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.032, 0.48), cellMat);
  module.position.y = layer * 0.042;
  module.userData.xr = {
    explode: { offset: [0, layer * 0.075, 0] },
    outline: { color: 0xff4500, width: 2 }
  };
  batteryStack.add(module);
}
