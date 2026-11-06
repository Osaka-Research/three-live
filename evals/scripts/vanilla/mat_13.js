// Steampunk Walnut-and-Brass Nixie Tube Desk Clock
const ambLight = new THREE.AmbientLight(0x221810, 0.8);
const dirLight = new THREE.DirectionalLight(0xfff0d0, 0.8);
dirLight.position.set(1.5, 2.0, 1.5);
scene.add(ambLight, dirLight);

// Materials
const walnutMat = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.65 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4a038, metalness: 0.85, roughness: 0.25 });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.96,
  transparent: true,
  roughness: 0.05,
  ior: 1.52,
  thickness: 0.015
});
const anodeMeshMat = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true });
const cathodeGlowMat = new THREE.MeshBasicMaterial({ color: 0xff6600 });

const clockGroup = new THREE.Group();

// Walnut & Brass Chassis
const baseChassis = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.14), walnutMat);
baseChassis.position.set(0, 0.75, 0);
const brassTopPlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, 0.12), brassMat);
brassTopPlate.position.set(0, 0.785, 0);
clockGroup.add(baseChassis, brassTopPlate);

// 6 Nixie Tubes Array
const tubeSpacing = 0.068;
const startX = -2.5 * tubeSpacing;

for (let i = 0; i < 6; i++) {
  const tx = startX + i * tubeSpacing;
  const tubeGroup = new THREE.Group();
  tubeGroup.position.set(tx, 0.84, 0);

  // Brass Socket and Torus Bezel Ring
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.026, 0.015, 24), brassMat);
  socket.position.y = -0.045;
  const bezelRing = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.003, 12, 28), brassMat);
  bezelRing.rotation.x = Math.PI / 2;
  bezelRing.position.y = -0.04;
  tubeGroup.add(socket, bezelRing);

  // Outer Glass Vacuum Envelope
  const glassTube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 24), glassMat);
  tubeGroup.add(glassTube);

  // Anode Wire Mesh Grid Inside
  const anodeGrid = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.065, 14, 6, true), anodeMeshMat);
  tubeGroup.add(anodeGrid);

  // Glowing Orange Cathode Numeral
  const cathodeLoop = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0018, 8, 20), cathodeGlowMat);
  cathodeLoop.position.set(0, 0.008, 0.003);
  const cathodeStem = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, 0.04, 8), cathodeGlowMat);
  cathodeStem.position.set(0, -0.01, 0.003);
  tubeGroup.add(cathodeLoop, cathodeStem);

  // Warm PointLight inside tube
  const tubeLight = new THREE.PointLight(0xff5500, 0.6, 0.45);
  tubeLight.position.set(0, 0, 0.01);
  tubeGroup.add(tubeLight);

  clockGroup.add(tubeGroup);
}

// Brass feet
for (const fx of [-0.22, 0.22]) {
  for (const fz of [-0.05, 0.05]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.007, 0.02, 16), brassMat);
    foot.position.set(fx, 0.71, fz);
    clockGroup.add(foot);
  }
}

scene.add(clockGroup);
