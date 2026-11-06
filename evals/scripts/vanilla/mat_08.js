const cauldronScene = new THREE.Group();
cauldronScene.position.set(0, 0.5, 0);

// Materials
const ironMat = new THREE.MeshStandardMaterial({ color: 0x222224, roughness: 0.85, metalness: 0.65 });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x444240, roughness: 0.95 });
const emberMat = new THREE.MeshStandardMaterial({
  color: 0xff3b00,
  emissive: 0xff2200,
  emissiveIntensity: 2.0,
  roughness: 0.9
});
const potionMat = new THREE.MeshStandardMaterial({
  color: 0x11ee44,
  emissive: 0x00cc33,
  emissiveIntensity: 1.5,
  roughness: 0.2
});
const vaporMat = new THREE.MeshStandardMaterial({
  color: 0x66ff88,
  transparent: true,
  opacity: 0.45,
  roughness: 0.1
});

// Stone firepit ring and embers
const firepitRing = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 24), stoneMat);
firepitRing.rotation.x = Math.PI / 2;
firepitRing.position.y = 0.04;
cauldronScene.add(firepitRing);

for (let i = 0; i < 16; i++) {
  const ang = Math.random() * Math.PI * 2;
  const rad = Math.random() * 0.28;
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 8, 8), emberMat);
  ember.position.set(Math.cos(ang) * rad, 0.05 + Math.random() * 0.03, Math.sin(ang) * rad);
  cauldronScene.add(ember);
}

// Cast-iron cauldron body and rim
const cauldronBody = new THREE.Mesh(
  new THREE.SphereGeometry(0.32, 24, 16, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65),
  ironMat
);
cauldronBody.position.y = 0.38;
cauldronScene.add(cauldronBody);

const cauldronRim = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.025, 12, 32), ironMat);
cauldronRim.rotation.x = Math.PI / 2;
cauldronRim.position.y = 0.58;
cauldronScene.add(cauldronRim);

// Cauldron legs
for (let i = 0; i < 3; i++) {
  const angle = (i * Math.PI * 2) / 3;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.32, 12), ironMat);
  leg.position.set(Math.cos(angle) * 0.22, 0.18, Math.sin(angle) * 0.22);
  leg.rotation.z = Math.sin(angle) * 0.35;
  leg.rotation.x = -Math.cos(angle) * 0.35;
  cauldronScene.add(leg);
}

// Iron ring handles
[-0.32, 0.32].forEach((x) => {
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 12, 24), ironMat);
  handle.position.set(x, 0.5, 0);
  cauldronScene.add(handle);
});

// Potion surface and vapor spheres
const potion = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.02, 24), potionMat);
potion.position.y = 0.52;
cauldronScene.add(potion);

const vapors = [];
for (let i = 0; i < 9; i++) {
  const v = new THREE.Mesh(new THREE.SphereGeometry(0.025 + Math.random() * 0.035, 12, 12), vaporMat);
  v.position.set((Math.random() - 0.5) * 0.35, 0.55 + Math.random() * 0.45, (Math.random() - 0.5) * 0.35);
  v.userData = { speed: 0.15 + Math.random() * 0.25, baseY: 0.54, offset: Math.random() * 5 };
  cauldronScene.add(v);
  vapors.push(v);
}

// Lights
const emberLight = new THREE.PointLight(0xff4400, 2.8, 1.8);
emberLight.position.set(0, 0.2, 0);
const potionLight = new THREE.PointLight(0x00ff66, 2.2, 2.0);
potionLight.position.set(0, 0.65, 0);
const ambLight = new THREE.AmbientLight(0x1a2433, 0.5);
scene.add(cauldronScene, emberLight, potionLight, ambLight);

let t = 0;
function animate(dt = 0.016) {
  t += dt;
  emberLight.intensity = 2.4 + Math.sin(t * 8) * 0.5;
  potionLight.intensity = 2.0 + Math.cos(t * 5) * 0.4;
  vapors.forEach((v) => {
    v.position.y = v.userData.baseY + ((t * v.userData.speed + v.userData.offset) % 0.55);
    v.scale.setScalar(0.5 + 0.8 * (1.0 - (v.position.y - v.userData.baseY) / 0.55));
  });
}
