// org_19: Ribbed jack-o'-lantern with carved face and flickering candle
const pumpkinGroup = new THREE.Group();
pumpkinGroup.position.set(0, 0.8, 0);
scene.add(pumpkinGroup);

const pumpkinMat = new THREE.MeshStandardMaterial({
  color: 0xe65c00, roughness: 0.55, metalness: 0.05
});
const interiorMat = new THREE.MeshStandardMaterial({
  color: 0x8a3800, roughness: 0.8, side: THREE.BackSide
});
const stemMat = new THREE.MeshStandardMaterial({
  color: 0x4a4729, roughness: 0.85, metalness: 0.1
});
const cutoutMat = new THREE.MeshBasicMaterial({ color: 0x1a0500 });

// Ribbed spherical pumpkin lobes
const lobes = 10;
for (let i = 0; i < lobes; i++) {
  const angle = (i * Math.PI * 2) / lobes;
  const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 20), pumpkinMat);
  lobe.scale.set(0.55, 0.95, 1.05);
  lobe.position.set(Math.cos(angle) * 0.045, 0, Math.sin(angle) * 0.045);
  lobe.rotation.y = angle;
  pumpkinGroup.add(lobe);
}

// Woody twisted stem and curly tendril vine
const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.035, 0.11, 12), stemMat);
stem.position.set(0.01, 0.23, 0);
stem.rotation.set(0.2, 0.1, -0.25);
const tendril = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.005, 8, 24, Math.PI * 1.6), stemMat);
tendril.position.set(0.03, 0.2, 0.02);
tendril.rotation.x = Math.PI * 0.5;
pumpkinGroup.add(stem, tendril);

// Carved Facial Features (Triangular eyes, nose, and jagged toothy smile)
const carvedFace = new THREE.Group();
carvedFace.position.set(0, 0.02, 0.225);

// Eyes
const eyeGeo = new THREE.ConeGeometry(0.032, 0.038, 3);
const eyeL = new THREE.Mesh(eyeGeo, cutoutMat);
eyeL.position.set(-0.065, 0.045, 0);
eyeL.rotation.z = Math.PI;
const eyeR = eyeL.clone();
eyeR.position.x = 0.065;
carvedFace.add(eyeL, eyeR);

// Nose
const nose = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.025, 3), cutoutMat);
nose.position.set(0, 0.005, 0.005);
nose.rotation.z = Math.PI;
carvedFace.add(nose);

// Jagged toothy mouth grin (segmented blocks)
const mouthCurve = [-0.09, -0.05, 0, 0.05, 0.09];
mouthCurve.forEach((x, idx) => {
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.022, 0.02), cutoutMat);
  const yOffset = -0.05 - Math.cos(x * 12) * 0.018 + (idx % 2 === 0 ? 0.008 : -0.008);
  tooth.position.set(x, yOffset, 0);
  tooth.rotation.z = x * -1.2;
  carvedFace.add(tooth);
});
pumpkinGroup.add(carvedFace);

// Flickering candle light inside
const candleLight = new THREE.PointLight(0xff8811, 2.8, 1.8, 1.5);
candleLight.position.set(0, 0.02, 0.08);
pumpkinGroup.add(candleLight);

scene.add(new THREE.AmbientLight(0x221133, 0.4));
const roomLight = new THREE.DirectionalLight(0x4466aa, 0.35);
roomLight.position.set(-2, 3, 2);
scene.add(roomLight);

let time = 0;
function animate(dt) {
  time += dt || 0.016;
  candleLight.intensity = 2.4 + Math.sin(time * 18) * 0.5 + Math.cos(time * 31) * 0.3;
  candleLight.position.x = Math.sin(time * 12) * 0.008;
  pumpkinGroup.rotation.y = Math.sin(time * 0.4) * 0.15;
}
animate(0);
