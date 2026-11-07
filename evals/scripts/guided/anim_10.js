// anim_10: Rotating B-DNA Double Helix (120 Base Pairs)
const dnaScene = new THREE.Group();
dnaScene.name = "BDNAMolecularVisualization";
scene.add(dnaScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.name = "MolecularKeyLight";
keyLight.position.set(3.0, 4.0, 3.5);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x38bdf8, 1.3, 8.0);
rimLight.name = "BioRimLight";
rimLight.position.set(-2.0, 1.5, -2.0);
scene.add(rimLight);

// Laboratory Pedestal Base at y = 0
const baseMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.35,
  metalness: 0.75
});
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.55, 0.10, 32), baseMat);
pedestal.name = "MolecularDisplayPedestal";
pedestal.position.set(0, 0.05, 0);
dnaScene.add(pedestal);

// Rotating Helix Container (spans y = 0.12m to y = 2.50m -> 2.5m tall total)
const helixGroup = new THREE.Group();
helixGroup.name = "RotatingDNAHelixGroup";
dnaScene.add(helixGroup);

const basePairCount = 120;
const backboneCount = basePairCount * 2; // 240 sugar-phosphate spheres
const rungHalfCount = basePairCount * 2; // 240 color-coded nucleotide half-rungs

const sphereGeo = new THREE.SphereGeometry(0.034, 14, 10);
const rungGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.0, 10);

const instancedMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.25,
  metalness: 0.2
});

const backboneInstanced = new THREE.InstancedMesh(sphereGeo, instancedMat, backboneCount);
backboneInstanced.name = "SugarPhosphateBackboneInstanced";
helixGroup.add(backboneInstanced);

const rungsInstanced = new THREE.InstancedMesh(rungGeo, instancedMat, rungHalfCount);
rungsInstanced.name = "BasePairRungsInstanced";
helixGroup.add(rungsInstanced);

const dummyMatrix = new THREE.Matrix4();
const posVec = new THREE.Vector3();
const rotQuat = new THREE.Quaternion();
const scaleVec = new THREE.Vector3();
const upAxis = new THREE.Vector3(0, 1, 0);
const dirVec = new THREE.Vector3();
const instColor = new THREE.Color();

// Canonical nucleotide colors:
// Strand A & B Backbones: silver-blue and pearl-violet
// Base pairs: Adenine (Blue), Thymine (Yellow), Guanine (Green), Cytosine (Crimson)
const colorBackboneA = new THREE.Color(0x94a3b8);
const colorBackboneB = new THREE.Color(0xcbd5e1);
const colorAdenine = new THREE.Color(0x3b82f6);
const colorThymine = new THREE.Color(0xeab308);
const colorGuanine = new THREE.Color(0x10b981);
const colorCytosine = new THREE.Color(0xf43f5e);

const helixRadius = 0.32;
const startY = 0.14;
const totalHelixHeight = 2.34;
const twistPerStep = (34.3 * Math.PI) / 180; // B-DNA ~10.5 base pairs per turn

for (let i = 0; i < basePairCount; i++) {
  const y = startY + (i / (basePairCount - 1)) * totalHelixHeight;
  const thetaA = i * twistPerStep;
  // B-DNA major/minor groove asymmetry (~140 deg vs 220 deg offset between glycosidic bonds)
  const thetaB = thetaA + 2.48;

  const ax = Math.cos(thetaA) * helixRadius;
  const az = Math.sin(thetaA) * helixRadius;
  const bx = Math.cos(thetaB) * helixRadius;
  const bz = Math.sin(thetaB) * helixRadius;

  // Strand A Sugar-Phosphate Sphere
  posVec.set(ax, y, az);
  rotQuat.identity();
  scaleVec.set(1, 1, 1);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  backboneInstanced.setMatrixAt(i * 2, dummyMatrix);
  backboneInstanced.setColorAt(i * 2, colorBackboneA);

  // Strand B Sugar-Phosphate Sphere
  posVec.set(bx, y, bz);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  backboneInstanced.setMatrixAt(i * 2 + 1, dummyMatrix);
  backboneInstanced.setColorAt(i * 2 + 1, colorBackboneB);

  // Base-Pair Rung connecting (ax, y, az) and (bx, y, bz) via midpoint
  const mx = (ax + bx) * 0.5;
  const mz = (az + bz) * 0.5;

  const dx = bx - ax;
  const dz = bz - az;
  const fullLen = Math.sqrt(dx * dx + dz * dz);
  const halfLen = fullLen * 0.5;

  dirVec.set(dx, 0, dz).normalize();
  rotQuat.setFromUnitVectors(upAxis, dirVec);
  scaleVec.set(1, halfLen, 1);

  // Half-rung 1: from Strand A to midpoint
  posVec.set((ax + mx) * 0.5, y, (az + mz) * 0.5);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  rungsInstanced.setMatrixAt(i * 2, dummyMatrix);

  // Half-rung 2: from midpoint to Strand B
  posVec.set((mx + bx) * 0.5, y, (mz + bz) * 0.5);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  rungsInstanced.setMatrixAt(i * 2 + 1, dummyMatrix);

  // Deterministic sequence of A-T, T-A, G-C, C-G base pairs
  const pairType = (i * 7 + 3) % 4;
  if (pairType === 0) {
    rungsInstanced.setColorAt(i * 2, colorAdenine);
    rungsInstanced.setColorAt(i * 2 + 1, colorThymine);
  } else if (pairType === 1) {
    rungsInstanced.setColorAt(i * 2, colorThymine);
    rungsInstanced.setColorAt(i * 2 + 1, colorAdenine);
  } else if (pairType === 2) {
    rungsInstanced.setColorAt(i * 2, colorGuanine);
    rungsInstanced.setColorAt(i * 2 + 1, colorCytosine);
  } else {
    rungsInstanced.setColorAt(i * 2, colorCytosine);
    rungsInstanced.setColorAt(i * 2 + 1, colorGuanine);
  }
}

backboneInstanced.instanceMatrix.needsUpdate = true;
rungsInstanced.instanceMatrix.needsUpdate = true;
if (backboneInstanced.instanceColor) backboneInstanced.instanceColor.needsUpdate = true;
if (rungsInstanced.instanceColor) rungsInstanced.instanceColor.needsUpdate = true;

function animate(t) {
  helixGroup.rotation.y = t * 0.65;
}

// Scene bounds: 2.5m tall, ~1.1m wide -> bounding radius ~1.35m around centerY = 1.25m
camera.position.set(0.0, 1.35, 3.1);
camera.lookAt(0, 1.25, 0);
