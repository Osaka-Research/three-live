const group = new THREE.Group();
scene.add(group);

const ambientLight = new THREE.AmbientLight(0xfff6ed, 0.7);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 2.5);
scene.add(ambientLight, dirLight);

// Tubular guitar floor stand
const standMat = new THREE.MeshStandardMaterial({ color: 0x1f1f1f, roughness: 0.5, metalness: 0.8 });
const standGroup = new THREE.Group();
for (let i = 0; i < 3; i++) {
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.42), standMat);
  leg.rotation.z = 0.65;
  leg.rotation.y = (i * Math.PI * 2) / 3;
  leg.position.y = 0.12;
  standGroup.add(leg);
}
const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.92), standMat);
mast.position.y = 0.52;
const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.016, 0.06), standMat);
cradle.position.set(0, 0.28, 0.08);
const neckRest = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16, 1, false, 0, Math.PI), standMat);
neckRest.rotation.x = Math.PI / 2;
neckRest.position.set(0, 0.95, 0.04);
standGroup.add(mast, cradle, neckRest);
group.add(standGroup);

// Hollow-body guitar
const guitar = new THREE.Group();
guitar.position.set(0, 0.68, 0.08);
guitar.rotation.x = 0.18;

// Figure-8 guitar body with f-holes
const bodyShape = new THREE.Shape();
bodyShape.moveTo(0, -0.27);
bodyShape.bezierCurveTo(0.24, -0.27, 0.23, -0.05, 0.12, 0.03);
bodyShape.bezierCurveTo(0.19, 0.12, 0.16, 0.24, 0, 0.24);
bodyShape.bezierCurveTo(-0.16, 0.24, -0.19, 0.12, -0.12, 0.03);
bodyShape.bezierCurveTo(-0.23, -0.05, -0.24, -0.27, 0, -0.27);

function addFHole(side) {
  const fHole = new THREE.Path();
  fHole.moveTo(side * 0.075, -0.08);
  fHole.bezierCurveTo(side * 0.12, -0.03, side * 0.06, 0.06, side * 0.085, 0.09);
  fHole.lineTo(side * 0.07, 0.09);
  fHole.bezierCurveTo(side * 0.045, 0.05, side * 0.1, -0.04, side * 0.06, -0.08);
  bodyShape.holes.push(fHole);
}
addFHole(1);
addFHole(-1);

const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 0.05, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.015, bevelThickness: 0.012 });
bodyGeo.center();
const sunburstMat = new THREE.MeshStandardMaterial({ color: 0x933005, roughness: 0.25, metalness: 0.15 });
guitar.add(new THREE.Mesh(bodyGeo, sunburstMat));

// Maple neck and fretboard
const neckMat = new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.4 });
const neck = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.48, 0.022), neckMat);
neck.position.set(0, 0.36, 0.01);
guitar.add(neck);

// 22 nickel frets & pearloid fretboard markers
const fretMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.9, roughness: 0.2 });
const pearlMat = new THREE.MeshStandardMaterial({ color: 0xf4f0ea, roughness: 0.3 });
for (let i = 1; i <= 22; i++) {
  const y = 0.14 + (i / 22) * 0.42;
  const fret = new THREE.Mesh(new THREE.BoxGeometry(0.042, 0.002, 0.003), fretMat);
  fret.position.set(0, y - 0.22, 0.023);
  guitar.add(fret);
  if ([3, 5, 7, 9, 12, 15, 17, 19, 21].includes(i)) {
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.006, 0.002), pearlMat);
    inlay.position.set(0, y - 0.23, 0.0225);
    guitar.add(inlay);
  }
}

// Headstock with 6 tuning pegs
const headstock = new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.14, 0.02), neckMat);
headstock.position.set(0, 0.65, 0.005);
headstock.rotation.x = -0.16;
guitar.add(headstock);
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, metalness: 0.95, roughness: 0.15 });
for (let i = 0; i < 6; i++) {
  const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.028), chromeMat);
  peg.rotation.z = Math.PI / 2;
  peg.position.set(i % 2 === 0 ? -0.04 : 0.04, 0.6 + Math.floor(i / 2) * 0.035, 0.008);
  guitar.add(peg);
}

// Dual humbuckers, tune-o-matic bridge, Bigsby vibrato
const humbucker1 = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.032, 0.012), chromeMat);
humbucker1.position.set(0, 0.06, 0.032);
const humbucker2 = humbucker1.clone();
humbucker2.position.set(0, -0.02, 0.032);
const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.076, 0.012, 0.014), chromeMat);
bridge.position.set(0, -0.09, 0.033);
const bigsbyRoll = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.065), chromeMat);
bigsbyRoll.rotation.z = Math.PI / 2;
bigsbyRoll.position.set(0, -0.19, 0.035);
const tremoloArm = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.14), chromeMat);
tremoloArm.position.set(0.03, -0.13, 0.045);
tremoloArm.rotation.z = -0.35;
guitar.add(humbucker1, humbucker2, bridge, bigsbyRoll, tremoloArm);

// 6 steel strings
for (let s = 0; s < 6; s++) {
  const sx = -0.016 + s * 0.0064;
  const str = new THREE.Mesh(new THREE.CylinderGeometry(0.0007, 0.0007, 0.74), chromeMat);
  str.position.set(sx, 0.17, 0.034);
  guitar.add(str);
}

guitar.userData.xr = { grab: true, target: 'guitar' };
group.add(guitar);

function animate(dt) {
  guitar.rotation.y = Math.sin(Date.now() * 0.001) * 0.05;
}
