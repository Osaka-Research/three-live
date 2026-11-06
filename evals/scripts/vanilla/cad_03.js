const movement = new THREE.Group();

// Materials
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.88, roughness: 0.25 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0xd8dde0, metalness: 0.95, roughness: 0.18 });
const rubyMat = new THREE.MeshStandardMaterial({ color: 0xb50e33, metalness: 0.1, roughness: 0.1 });
const darkHandsMat = new THREE.MeshStandardMaterial({ color: 0x1b2b48, metalness: 0.8, roughness: 0.3 });

// Mainplate (Circular brass base plate with hollow decorative port)
const plateShape = new THREE.Shape();
plateShape.absarc(0, 0, 0.25, 0, Math.PI * 2, false);
const cutout = new THREE.Path();
cutout.absarc(0.08, -0.06, 0.09, 0, Math.PI * 2, true);
plateShape.holes.push(cutout);

const plateGeo = new THREE.ExtrudeGeometry(plateShape, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, curveSegments: 36 });
const mainplate = new THREE.Mesh(plateGeo, brassMat);
mainplate.position.z = -0.01;
movement.add(mainplate);

// Procedural Toothed Gear Wheel Generator using THREE.Shape & THREE.ExtrudeGeometry
function createGear(radius, teeth, toothDepth, mat) {
  const shape = new THREE.Shape();
  const totalPoints = teeth * 2;
  for (let i = 0; i < totalPoints; i++) {
    const angle = (i * Math.PI * 2) / totalPoints;
    const r = i % 2 === 0 ? radius + toothDepth : radius;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  // Center arbor hole
  const arborHole = new THREE.Path();
  arborHole.absarc(0, 0, radius * 0.22, 0, Math.PI * 2, true);
  shape.holes.push(arborHole);

  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.008, bevelEnabled: false, curveSegments: 32 });
  return new THREE.Mesh(geo, mat);
}

// 3 Meshing Gears of Different Radii
const gearCenter = createGear(0.08, 24, 0.012, brassMat);
gearCenter.position.set(0, 0, 0.01);
movement.add(gearCenter);

const gearSecond = createGear(0.05, 16, 0.01, steelMat);
gearSecond.position.set(0.14, 0.04, 0.012);
movement.add(gearSecond);

const gearThird = createGear(0.035, 12, 0.008, brassMat);
gearThird.position.set(-0.11, 0.08, 0.014);
movement.add(gearThird);

// Ruby Jeweled Balance Wheel & Hairspring Spiral
const balanceGroup = new THREE.Group();
const rimGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.005, 32);
const balanceRim = new THREE.Mesh(rimGeo, brassMat);
balanceRim.rotation.x = Math.PI / 2;
balanceGroup.add(balanceRim);

// Ruby jewel bearing at center
const rubyGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.01, 16);
const ruby = new THREE.Mesh(rubyGeo, rubyMat);
ruby.rotation.x = Math.PI / 2;
balanceGroup.add(ruby);

// Hairspring (Archimedean spiral ribbon)
const springShape = new THREE.Shape();
const turns = 4;
for (let a = 0; a <= Math.PI * 2 * turns; a += 0.2) {
  const r = 0.012 + (a / (Math.PI * 2 * turns)) * 0.035;
  const x = Math.cos(a) * r;
  const y = Math.sin(a) * r;
  if (a === 0) springShape.moveTo(x, y);
  else springShape.lineTo(x, y);
}
const hairspring = new THREE.Mesh(new THREE.ExtrudeGeometry(springShape, { depth: 0.002, bevelEnabled: false }), steelMat);
balanceGroup.add(hairspring);
balanceGroup.position.set(0.08, -0.06, 0.02);
movement.add(balanceGroup);

// Steel Bridges with Blued Screw Heads
const bridgeShape = new THREE.Shape();
bridgeShape.moveTo(-0.16, -0.15);
bridgeShape.lineTo(0.05, -0.18);
bridgeShape.lineTo(0.02, -0.02);
bridgeShape.lineTo(-0.14, 0.05);
bridgeShape.closePath();
const bridgeGeo = new THREE.ExtrudeGeometry(bridgeShape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002 });
const bridge = new THREE.Mesh(bridgeGeo, steelMat);
bridge.position.z = 0.022;
movement.add(bridge);

const screwGeo = new THREE.CylinderGeometry(0.007, 0.007, 0.005, 12);
[[-0.13, -0.12], [0.02, -0.15], [-0.11, 0.02]].forEach(([sx, sy]) => {
  const screw = new THREE.Mesh(screwGeo, darkHandsMat);
  screw.rotation.x = Math.PI / 2;
  screw.position.set(sx, sy, 0.036);
  movement.add(screw);
});

// Hour, Minute, and Second Hands
function createHand(length, width, zPos) {
  const s = new THREE.Shape();
  s.moveTo(-width / 2, -0.02);
  s.lineTo(width / 2, -0.02);
  s.lineTo(width / 4, length);
  s.lineTo(0, length + 0.015);
  s.lineTo(-width / 4, length);
  s.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: 0.004, bevelEnabled: false }), darkHandsMat);
  m.position.z = zPos;
  return m;
}

const hourHand = createHand(0.12, 0.014, 0.038);
hourHand.rotation.z = Math.PI / 3;
movement.add(hourHand);

const minHand = createHand(0.18, 0.010, 0.044);
minHand.rotation.z = -Math.PI / 4;
movement.add(minHand);

const secHand = createHand(0.20, 0.003, 0.050);
secHand.rotation.z = 1.8;
movement.add(secHand);

// Positioning & Lighting
movement.position.set(0, 0.8, 0);
scene.add(movement);

const ambLight = new THREE.AmbientLight(0xffffff, 0.7);
const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.5);
dirLight.position.set(1.5, 2.5, 3.0);
scene.add(ambLight, dirLight);
