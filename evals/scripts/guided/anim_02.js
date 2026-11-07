// anim_02: Kinetic Wave Matrix of 400 Suspended Brass Rods
const sculptureGroup = new THREE.Group();
sculptureGroup.name = "KineticWaveSculpture";
scene.add(sculptureGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff5e4, 1.6);
keyLight.name = "GalleryKeyLight";
keyLight.position.set(3.5, 5.0, 4.0);
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x90b4ff, 0.9, 10.0);
fillLight.name = "GalleryFillLight";
fillLight.position.set(-3.0, 2.2, -2.5);
scene.add(fillLight);

// Museum Floor Plinth at y = 0
const plinthMat = new THREE.MeshStandardMaterial({
  color: 0x22252a,
  roughness: 0.45,
  metalness: 0.2
});
const floorPlinth = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 2.6), plinthMat);
floorPlinth.name = "MuseumFloorPlinth";
floorPlinth.position.set(0, 0.06, 0);
sculptureGroup.add(floorPlinth);

// Four Corner Support Columns holding the Ceiling Frame at y = 2.4m
const frameMat = new THREE.MeshStandardMaterial({
  color: 0x2c3038,
  roughness: 0.35,
  metalness: 0.8
});

const frameHeight = 2.4;
const halfSpan = 1.2;
const cornerOffsets = [
  [-halfSpan, -halfSpan],
  [halfSpan, -halfSpan],
  [-halfSpan, halfSpan],
  [halfSpan, halfSpan]
];

for (let i = 0; i < cornerOffsets.length; i++) {
  const [cx, cz] = cornerOffsets[i];
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, frameHeight, 16), frameMat);
  column.name = `SupportColumn_${i + 1}`;
  column.position.set(cx, frameHeight * 0.5, cz);
  sculptureGroup.add(column);
}

// Ceiling Suspension Frame
const ceilingPlate = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 2.5), frameMat);
ceilingPlate.name = "CeilingSuspensionFrame";
ceilingPlate.position.set(0, frameHeight, 0);
sculptureGroup.add(ceilingPlate);

// 20x20 Grid (400 instances) of Metallic Brass Rods and Spheres
const gridSize = 20;
const instanceCount = gridSize * gridSize; // 400
const spacing = 0.105;
const gridHalf = ((gridSize - 1) * spacing) * 0.5;

const brassMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.2,
  metalness: 0.92
});

const wireMat = new THREE.MeshStandardMaterial({
  color: 0x9aa0a6,
  roughness: 0.4,
  metalness: 0.85
});

const rodGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.22, 12);
const sphereGeo = new THREE.SphereGeometry(0.026, 16, 12);
const cableGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 1.0, 6);

const instancedRods = new THREE.InstancedMesh(rodGeo, brassMat, instanceCount);
instancedRods.name = "InstancedBrassRods";
sculptureGroup.add(instancedRods);

const instancedSpheres = new THREE.InstancedMesh(sphereGeo, brassMat, instanceCount);
instancedSpheres.name = "InstancedBrassSpheres";
sculptureGroup.add(instancedSpheres);

const instancedCables = new THREE.InstancedMesh(cableGeo, wireMat, instanceCount);
instancedCables.name = "InstancedSuspensionCables";
sculptureGroup.add(instancedCables);

const dummyMatrix = new THREE.Matrix4();
const posVec = new THREE.Vector3();
const rotQuat = new THREE.Quaternion();
const scaleVec = new THREE.Vector3(1, 1, 1);
const toneColor = new THREE.Color();

const gridCoords = [];

for (let gx = 0; gx < gridSize; gx++) {
  for (let gz = 0; gz < gridSize; gz++) {
    const idx = gx * gridSize + gz;
    const x = gx * spacing - gridHalf;
    const z = gz * spacing - gridHalf;
    const radialDist = Math.sqrt(x * x + z * z);
    gridCoords.push({ x, z, radialDist });

    // Subtle warm gold-to-copper gradient across radial distance
    const normR = Math.min(1.0, radialDist / 1.4);
    toneColor.setHSL(0.11 - normR * 0.025, 0.78, 0.54 + (1.0 - normR) * 0.08);
    instancedRods.setColorAt(idx, toneColor);
    instancedSpheres.setColorAt(idx, toneColor);
  }
}

function updateWave(t) {
  for (let i = 0; i < instanceCount; i++) {
    const { x, z, radialDist } = gridCoords[i];
    const wave = Math.sin(radialDist * 4.5 - t * 2.2) * 0.28 + Math.cos((x + z) * 2.0 + t * 1.4) * 0.08;
    const bobY = 1.25 + wave;

    // Brass Rod Position
    posVec.set(x, bobY + 0.11, z);
    scaleVec.set(1, 1, 1);
    dummyMatrix.compose(posVec, rotQuat, scaleVec);
    instancedRods.setMatrixAt(i, dummyMatrix);

    // Brass Sphere Tip at bottom of rod
    posVec.set(x, bobY - 0.02, z);
    dummyMatrix.compose(posVec, rotQuat, scaleVec);
    instancedSpheres.setMatrixAt(i, dummyMatrix);

    // Suspension Cable from ceiling (y = 2.36) down to top of rod (bobY + 0.22)
    const rodTopY = bobY + 0.22;
    const cableLen = Math.max(0.05, 2.36 - rodTopY);
    posVec.set(x, rodTopY + cableLen * 0.5, z);
    scaleVec.set(1, cableLen, 1);
    dummyMatrix.compose(posVec, rotQuat, scaleVec);
    instancedCables.setMatrixAt(i, dummyMatrix);
  }

  instancedRods.instanceMatrix.needsUpdate = true;
  instancedSpheres.instanceMatrix.needsUpdate = true;
  instancedCables.instanceMatrix.needsUpdate = true;
}

updateWave(0);
if (instancedRods.instanceColor) instancedRods.instanceColor.needsUpdate = true;
if (instancedSpheres.instanceColor) instancedSpheres.instanceColor.needsUpdate = true;

function animate(t) {
  updateWave(t);
}

// Scene bounds: [-1.3, 1.3] in X/Z, [0, 2.44] in Y -> radius ~2.1m, centerY = 1.22
camera.position.set(3.2, 2.1, 3.6);
camera.lookAt(0, 1.22, 0);
