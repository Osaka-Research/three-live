const engine = new THREE.Group();
engine.position.set(0, 0.8, 0);
scene.add(engine);

const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffecd0, 1.4);
dirLight.position.set(2, 3, 2);
engine.add(ambLight, dirLight);

// Materials
const ironMat = new THREE.MeshStandardMaterial({ color: 0x2b2d42, roughness: 0.7, metalness: 0.8 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9, side: THREE.DoubleSide });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x8d99ae, roughness: 0.2, metalness: 0.95 });

// Cast-iron bedplate
const bedplate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.5), ironMat);
bedplate.position.set(0, -0.04, 0);
engine.add(bedplate);

// Flywheel & crankshaft
const flywheelGroup = new THREE.Group();
flywheelGroup.position.set(0.45, 0.3, 0.12);
engine.add(flywheelGroup);

const rim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 16, 48), ironMat);
flywheelGroup.add(rim);

const spokeGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 8);
for (let i = 0; i < 4; i++) {
  const spoke = new THREE.Mesh(spokeGeo, ironMat);
  spoke.rotation.z = (i * Math.PI) / 4;
  flywheelGroup.add(spoke);
}

// Eccentric crank pin (r = 0.12m)
const crankPin = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.08, 12), steelMat);
crankPin.rotation.x = Math.PI / 2;
crankPin.position.set(0.12, 0, -0.04);
flywheelGroup.add(crankPin);

// Cutaway brass cylinder
let cylinder;
if (typeof CSG !== 'undefined') {
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 24));
  const cut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12));
  cut.position.set(0.05, 0, 0.05);
  cylinder = CSG.subtract(outer, cut);
  cylinder.material = brassMat;
} else {
  cylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.4, 24, 1, false, 0, Math.PI * 1.5), brassMat);
}
cylinder.rotation.z = Math.PI / 2;
cylinder.position.set(-0.45, 0.3, 0);
engine.add(cylinder);

// Crosshead guide
const guide = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, 0.08), steelMat);
guide.position.set(-0.15, 0.3, 0);
engine.add(guide);

// Reciprocating piston & connecting rod
const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 20), steelMat);
piston.rotation.z = Math.PI / 2;
engine.add(piston);

const conRod = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.025, 0.02), steelMat);
engine.add(conRod);

const crankR = 0.12;
const conRodL = 0.48;
let crankAngle = 0;

function animate(dt = 0.016) {
  crankAngle += dt * 3.5;
  flywheelGroup.rotation.z = crankAngle;

  const crankX = 0.45 + Math.cos(crankAngle) * crankR;
  const crankY = 0.3 + Math.sin(crankAngle) * crankR;

  const dy = crankY - 0.3;
  const dx = Math.sqrt(conRodL * conRodL - dy * dy);
  const crossheadX = crankX - dx;

  piston.position.set(crossheadX - 0.18, 0.3, 0);

  conRod.position.set((crankX + crossheadX) * 0.5, (crankY + 0.3) * 0.5, 0.06);
  conRod.rotation.z = Math.atan2(crankY - 0.3, crankX - crossheadX);
}
scene.userData.animate = animate;
