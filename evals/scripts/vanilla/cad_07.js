const ambLight = new THREE.AmbientLight(0xffffff, 0.7);
const dirLight = new THREE.DirectionalLight(0xfffaed, 1.2);
dirLight.position.set(2, 4, 3);
scene.add(ambLight, dirLight);

const machine = new THREE.Group();
machine.position.set(0, 0.65, 0);

const steelMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.92, roughness: 0.18 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.8, roughness: 0.4 });
const handleMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.6 });
const cupMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 });
const dialMat = new THREE.MeshStandardMaterial({ color: 0xfbf8e6, roughness: 0.5 });

// Stainless-steel chassis (~0.6m wide)
const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.42), steelMat);
body.position.y = 0.24;
machine.add(body);

// Top cup warmer and ceramic espresso cups
const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.03, 0.38), darkMetal);
topRail.position.set(0, 0.45, -0.01);
machine.add(topRail);

[-0.18, 0, 0.18].forEach((x, i) => {
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.028, 0.06, 16), cupMat);
  cup.position.set(x, 0.5, (i % 2 === 0 ? 0.06 : -0.06));
  const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 8, 16, Math.PI * 1.3), cupMat);
  cupHandle.position.set(0.038, 0, 0);
  cupHandle.rotation.y = Math.PI / 2;
  cup.add(cupHandle);
  machine.add(cup);
});

// Slotted drip tray grate
const dripTray = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.07, 0.22), steelMat);
dripTray.position.set(0, 0.035, 0.23);
machine.add(dripTray);
for (let i = -6; i <= 6; i++) {
  const slotGrate = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.01, 0.18), darkMetal);
  slotGrate.position.set(i * 0.04, 0.075, 0.23);
  machine.add(slotGrate);
}

// Pressure gauge dial on front faceplate
const gaugeBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 24), darkMetal);
gaugeBezel.rotation.x = Math.PI / 2;
gaugeBezel.position.set(0, 0.32, 0.215);
const dialFace = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.017, 24), dialMat);
dialFace.rotation.x = Math.PI / 2;
dialFace.position.set(0, 0.32, 0.216);
machine.add(gaugeBezel, dialFace);

// Dual group heads and portafilters
[-0.15, 0.15].forEach((gx) => {
  const groupHead = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.07, 20), steelMat);
  groupHead.position.set(gx, 0.24, 0.15);
  machine.add(groupHead);

  const portafilter = new THREE.Group();
  portafilter.position.set(gx, 0.20, 0.15);
  const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.04, 18), steelMat);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 12), steelMat);
  neck.rotation.x = Math.PI / 2;
  neck.position.z = 0.05;
  const pHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, 0.13, 16), handleMat);
  pHandle.rotation.x = Math.PI / 2;
  pHandle.position.z = 0.14;
  portafilter.add(basket, neck, pHandle);
  machine.add(portafilter);
});

// Steam wands with articulated ball joints
[-0.26, 0.26].forEach((wx, idx) => {
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), steelMat);
  ball.position.set(wx, 0.27, 0.18);
  const wand = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.007, 10, 24, Math.PI / 2.2), steelMat);
  wand.position.set(0, -0.06, 0.02);
  wand.rotation.set(0.4, (idx === 0 ? 0.3 : -0.3), (idx === 0 ? 0.2 : -0.2));
  ball.add(wand);
  machine.add(ball);
});

scene.add(machine);
machine.userData.xr = { grab: true };
function animate(dt) {
  gaugeBezel.rotation.z += Math.sin(Date.now() * 0.005) * 0.002;
}
