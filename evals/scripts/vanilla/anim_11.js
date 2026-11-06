const root = new THREE.Group();
scene.add(root);

const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffecc0, 1.2);
dirLight.position.set(3, 4, 2);
root.add(ambLight, dirLight);

const hubLight = new THREE.PointLight(0xff00aa, 2, 4);
hubLight.position.set(0, 1.6, 0);
root.add(hubLight);

// Twin A-frame support towers
const towerMat = new THREE.MeshStandardMaterial({ color: 0x334455, metalness: 0.8, roughness: 0.3 });
const legGeo = new THREE.CylinderGeometry(0.04, 0.06, 1.8, 8);
[-0.25, 0.25].forEach(z => {
  [-0.6, 0.6].forEach(x => {
    const leg = new THREE.Mesh(legGeo, towerMat);
    leg.position.set(x * 0.5, 0.8, z);
    leg.rotation.z = -Math.sign(x) * 0.35;
    root.add(leg);
  });
});

// Main wheel assembly (3.0m diameter)
const wheel = new THREE.Group();
wheel.position.set(0, 1.6, 0);
root.add(wheel);

const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.2 });
const rimGeo = new THREE.TorusGeometry(1.4, 0.03, 12, 48);
[-0.15, 0.15].forEach(z => {
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.z = z;
  wheel.add(rim);
});

// Spokes, neon bulbs, and 12 passenger gondolas
const spokeGeo = new THREE.CylinderGeometry(0.015, 0.015, 2.8, 8);
const bulbGeo = new THREE.BoxGeometry(0.04, 0.04, 0.04);
const bulbMat = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ccff, emissiveIntensity: 1.5 });
const gondolaGeo = new THREE.BoxGeometry(0.24, 0.28, 0.22);
const gondolaMat = new THREE.MeshStandardMaterial({ color: 0xe63946, roughness: 0.4 });
const gondolas = [];

for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  if (i < 6) {
    const spoke = new THREE.Mesh(spokeGeo, rimMat);
    spoke.rotation.z = angle;
    wheel.add(spoke);
  }

  const bulb = new THREE.Mesh(bulbGeo, bulbMat);
  bulb.position.set(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4, 0.17);
  wheel.add(bulb);

  const gondolaPivot = new THREE.Group();
  gondolaPivot.position.set(Math.cos(angle) * 1.35, Math.sin(angle) * 1.35, 0);
  const gondola = new THREE.Mesh(gondolaGeo, gondolaMat);
  gondola.position.y = -0.12;
  gondolaPivot.add(gondola);
  wheel.add(gondolaPivot);
  gondolas.push(gondolaPivot);
}

function animate(dt = 0.016) {
  wheel.rotation.z += dt * 0.4;
  gondolas.forEach(g => {
    g.rotation.z = -wheel.rotation.z;
  });
}
scene.userData.animate = animate;
