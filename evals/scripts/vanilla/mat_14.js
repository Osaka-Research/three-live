// Celadon Ceramic Tea Service on Slatted Bamboo Tray
const ambLight = new THREE.AmbientLight(0xfff7ed, 0.7);
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.1);
dirLight.position.set(1.5, 2.5, 2.0);
scene.add(ambLight, dirLight);

// Materials
const celadonMat = new THREE.MeshPhysicalMaterial({
  color: 0xb5d3c3,
  roughness: 0.15,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  ior: 1.55
});
const teaMat = new THREE.MeshPhysicalMaterial({
  color: 0xc47b2b,
  transmission: 0.85,
  transparent: true,
  roughness: 0.1,
  ior: 1.34
});
const bambooMat = new THREE.MeshStandardMaterial({ color: 0xcbb080, roughness: 0.6 });
const rattanMat = new THREE.MeshStandardMaterial({ color: 0x937047, roughness: 0.75 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8a248, metalness: 0.7, roughness: 0.3 });

const serviceGroup = new THREE.Group();

// Slatted Bamboo Tray
const trayBase = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.015, 0.32), bambooMat);
trayBase.position.set(0, 0.64, 0);
serviceGroup.add(trayBase);

for (let s = -0.21; s <= 0.21; s += 0.024) {
  const slat = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.3, 12), bambooMat);
  slat.rotation.x = Math.PI / 2;
  slat.position.set(s, 0.655, 0);
  serviceGroup.add(slat);
}

// Teapot Group
const teapotGroup = new THREE.Group();
teapotGroup.position.set(-0.11, 0.72, -0.03);

const potBody = new THREE.Mesh(new THREE.SphereGeometry(0.05, 32, 24), celadonMat);
potBody.scale.set(1.0, 0.85, 1.0);
const potLid = new THREE.Mesh(new THREE.SphereGeometry(0.026, 24, 16), celadonMat);
potLid.position.y = 0.038;
const potKnob = new THREE.Mesh(new THREE.SphereGeometry(0.007, 16, 16), celadonMat);
potKnob.position.y = 0.06;
teapotGroup.add(potBody, potLid, potKnob);

// Rattan Handle
const handle = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.004, 12, 28, Math.PI), rattanMat);
handle.position.set(0, 0.04, 0);
teapotGroup.add(handle);

// Curved Spout
const spout = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.007, 12, 24, Math.PI * 0.45), celadonMat);
spout.rotation.z = -Math.PI * 0.65;
spout.position.set(0.045, -0.01, 0);
teapotGroup.add(spout);
serviceGroup.add(teapotGroup);

// Fairness Pitcher
const pitcher = new THREE.Mesh(new THREE.SphereGeometry(0.042, 24, 20), celadonMat);
pitcher.scale.set(0.9, 1.1, 0.9);
pitcher.position.set(0.07, 0.71, -0.03);
const pitcherRim = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.025, 20), celadonMat);
pitcherRim.position.set(0.07, 0.755, -0.03);
serviceGroup.add(pitcher, pitcherRim);

// Strainer
const strainer = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.012, 0.02, 16), brassMat);
strainer.position.set(0.07, 0.775, -0.03);
serviceGroup.add(strainer);

// 4 Small Handleless Teacups with Tea Liquid
const cupCoords = [[-0.12, 0.09], [-0.04, 0.09], [0.04, 0.09], [0.12, 0.09]];
cupCoords.forEach(([cx, cz]) => {
  const cupGroup = new THREE.Group();
  cupGroup.position.set(cx, 0.68, cz);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.014, 0.032, 24), celadonMat);
  const tea = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.018, 0.008, 20), teaMat);
  tea.position.y = 0.01;
  cupGroup.add(cup, tea);
  serviceGroup.add(cupGroup);
});

scene.add(serviceGroup);
