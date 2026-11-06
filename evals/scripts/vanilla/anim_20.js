const ambientLight = new THREE.AmbientLight(0xf0f4f8, 0.8);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(2, 4, 3);
scene.add(ambientLight, dirLight);

const mount = new THREE.Group();
mount.position.set(0, 0.8, 0);
scene.add(mount);

const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xcd7f32, roughness: 0.3, metalness: 0.85 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, roughness: 0.25, metalness: 0.9 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x2e3438, roughness: 0.5, metalness: 0.7 });

// Cutaway housing / stand
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.35, 32), frameMat);
pedestal.position.y = -0.35;
const centerShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 24), steelMat);
centerShaft.rotation.x = Math.PI / 2;
mount.add(pedestal, centerShaft);

// Outer Torus bearing / housing rim
const ringRim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 16, 48), frameMat);
mount.add(ringRim);

// Procedural gear shape generator using ExtrudeGeometry
function makeGearGeo(pitchR, numTeeth, toothH, holeR = 0) {
  const shape = new THREE.Shape();
  const steps = numTeeth * 4;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const phase = i % 4;
    const r = (phase === 1 || phase === 2) ? pitchR + toothH : pitchR - toothH * 0.4;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  if (holeR > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, holeR, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2
  });
}

// Central Bronze Sun Gear
const sunGeo = makeGearGeo(0.09, 16, 0.015, 0.025);
sunGeo.center();
const sunMesh = new THREE.Mesh(sunGeo, bronzeMat);
mount.add(sunMesh);

// Carrier Cage with 3 Steel Planet Gears
const carrierGroup = new THREE.Group();
mount.add(carrierGroup);

const planetGeo = makeGearGeo(0.07, 12, 0.015, 0.018);
planetGeo.center();
const planets = [];

for (let i = 0; i < 3; i++) {
  const angle = (i / 3) * Math.PI * 2;
  const dist = 0.16;
  const pGroup = new THREE.Group();
  pGroup.position.set(Math.cos(angle) * dist, Math.sin(angle) * dist, 0);

  const planetMesh = new THREE.Mesh(planetGeo, steelMat);
  pGroup.add(planetMesh);

  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 16), steelMat);
  pin.rotation.x = Math.PI / 2;
  pGroup.add(pin);

  carrierGroup.add(pGroup);
  planets.push({ group: pGroup, mesh: planetMesh });
}

// Carrier front triangular plate
const triShape = new THREE.Shape();
for (let i = 0; i < 3; i++) {
  const a = (i / 3) * Math.PI * 2;
  const x = Math.cos(a) * 0.18;
  const y = Math.sin(a) * 0.18;
  if (i === 0) triShape.moveTo(x, y);
  else triShape.lineTo(x, y);
}
triShape.closePath();
const triGeo = new THREE.ExtrudeGeometry(triShape, { depth: 0.01, bevelEnabled: false });
triGeo.center();
const carrierPlate = new THREE.Mesh(triGeo, frameMat);
carrierPlate.position.z = 0.03;
carrierGroup.add(carrierPlate);

// Outer Ring Gear
const ringGeo = makeGearGeo(0.24, 38, 0.014, 0.215);
ringGeo.center();
const ringMesh = new THREE.Mesh(ringGeo, steelMat);
mount.add(ringMesh);

let time = 0;
function animate(dt = 0.016) {
  time += dt;
  carrierGroup.rotation.z = time * 0.5;
  sunMesh.rotation.z = time * 2.0;
  ringMesh.rotation.z = -time * 0.13;
  planets.forEach((p) => {
    p.mesh.rotation.z = -time * 2.0;
  });
}
scene.userData.update = animate;
