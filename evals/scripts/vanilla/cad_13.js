const viseGroup = new THREE.Group();
viseGroup.position.set(0, 0.8, 0);
scene.add(viseGroup);

const castIronMat = new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.65, metalness: 0.4 });
const groundSteelMat = new THREE.MeshStandardMaterial({ color: 0xc4cace, roughness: 0.25, metalness: 0.85 });
const alumMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.7 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.8 });

// Swivel base with mounting slots (~0.45m overall length assembly)
const swivelBaseGeo = new THREE.CylinderGeometry(0.15, 0.16, 0.025, 48);
const swivelBase = new THREE.Mesh(swivelBaseGeo, castIronMat);
viseGroup.add(swivelBase);

// Vise main bed body (0.45m long, 0.14m wide)
const bedGeo = new THREE.BoxGeometry(0.45, 0.06, 0.14);
const bed = new THREE.Mesh(bedGeo, castIronMat);
bed.position.set(0, 0.04, 0);
viseGroup.add(bed);

// Precision guide ways (hardened steel slide strips)
const wayGeo = new THREE.BoxGeometry(0.38, 0.01, 0.03);
[-0.045, 0.045].forEach(z => {
  const way = new THREE.Mesh(wayGeo, groundSteelMat);
  way.position.set(0.02, 0.075, z);
  viseGroup.add(way);
});

// Fixed rear jaw
const fixedJawGeo = new THREE.BoxGeometry(0.08, 0.08, 0.14);
const fixedJaw = new THREE.Mesh(fixedJawGeo, castIronMat);
fixedJaw.position.set(-0.16, 0.11, 0);
viseGroup.add(fixedJaw);

// Movable sliding jaw
const movableJawGeo = new THREE.BoxGeometry(0.08, 0.08, 0.14);
const movableJaw = new THREE.Mesh(movableJawGeo, castIronMat);
movableJaw.position.set(0.04, 0.11, 0);
viseGroup.add(movableJaw);

// Hardened steel jaw plates
const jawPlateGeo = new THREE.BoxGeometry(0.012, 0.04, 0.14);
const fixedPlate = new THREE.Mesh(jawPlateGeo, groundSteelMat);
fixedPlate.position.set(-0.114, 0.12, 0);
const movablePlate = new THREE.Mesh(jawPlateGeo, groundSteelMat);
movablePlate.position.set(-0.006, 0.12, 0);
viseGroup.add(fixedPlate, movablePlate);

// Acme leadscrew
const screwGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 24);
const screw = new THREE.Mesh(screwGeo, groundSteelMat);
screw.rotation.z = Math.PI / 2;
screw.position.set(0.18, 0.06, 0);
viseGroup.add(screw);

// Hex drive collar & crank handle
const hexDriveGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 6);
const hexDrive = new THREE.Mesh(hexDriveGeo, brassMat);
hexDrive.rotation.z = Math.PI / 2;
hexDrive.position.set(0.32, 0.06, 0);
viseGroup.add(hexDrive);

const crankArmGeo = new THREE.BoxGeometry(0.01, 0.12, 0.02);
const crankArm = new THREE.Mesh(crankArmGeo, groundSteelMat);
crankArm.position.set(0.335, 0.11, 0);
const crankKnobGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.04, 16);
const crankKnob = new THREE.Mesh(crankKnobGeo, castIronMat);
crankKnob.rotation.z = Math.PI / 2;
crankKnob.position.set(0.355, 0.16, 0);
viseGroup.add(crankArm, crankKnob);

// Clamped aluminum workpiece with Boolean pocket cutouts (CSG)
let workpiece;
if (typeof CSG !== 'undefined') {
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.11), alumMat);
  const pocket = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.06, 24), alumMat);
  pocket.position.set(0.01, 0.015, 0);
  const csgA = CSG.fromMesh(block);
  const csgB = CSG.fromMesh(pocket);
  workpiece = CSG.toMesh(csgA.subtract(csgB), block.matrix, alumMat);
} else {
  workpiece = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.11), alumMat);
  const sideA = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.03), alumMat);
  sideA.position.set(0, 0.025, 0.04);
  const sideB = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.03), alumMat);
  sideB.position.set(0, 0.025, -0.04);
  workpiece.add(base, sideA, sideB);
}
workpiece.position.set(-0.06, 0.12, 0);
viseGroup.add(workpiece);

// Lighting
const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
dirLight.position.set(2, 4, 3);
scene.add(dirLight);
const fillLight = new THREE.DirectionalLight(0x90b0d0, 0.8);
fillLight.position.set(-2, 2, -2);
scene.add(fillLight);
const ambLight = new THREE.AmbientLight(0x404040, 1.2);
scene.add(ambLight);

viseGroup.rotation.y = -Math.PI / 4;
