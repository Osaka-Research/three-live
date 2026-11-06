// Modern concert amphitheater with central stage, canopy roof, and 1,000 tiered seats
const stageMat = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.5 });
const trussMat = new THREE.MeshStandardMaterial({ color: 0xd0d5dd, metalness: 0.8, roughness: 0.3 });
const seatMat = new THREE.MeshStandardMaterial({ color: 0x0077cc, roughness: 0.4 });

// Central stage
const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.3, 32), stageMat);
stage.position.set(0, 0.15, -0.6);
scene.add(stage);

// Acoustic canopy roof
const canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.0, 0.1, 32, 1, false, 0, Math.PI), stageMat);
canopy.rotation.x = Math.PI / 2;
canopy.rotation.z = -Math.PI / 2;
canopy.position.set(0, 1.8, -0.8);
scene.add(canopy);

// Lighting truss arch
const trussPillar1 = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.8, 12), trussMat);
trussPillar1.position.set(-1.4, 0.9, -0.6);
const trussPillar2 = trussPillar1.clone();
trussPillar2.position.set(1.4, 0.9, -0.6);
const trussBeam = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.08), trussMat);
trussBeam.position.set(0, 1.8, -0.6);
scene.add(trussPillar1, trussPillar2, trussBeam);

// 1,000 tiered spectator seats arranged in semicircular arcs via InstancedMesh
const seatCount = 1000;
const seatGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
const seatMesh = new THREE.InstancedMesh(seatGeo, seatMat, seatCount);
const dummy = new THREE.Object3D();

const rows = 20;
let seatIdx = 0;
for (let r = 0; r < rows; r++) {
  const radius = 1.6 + r * 0.12;
  const elevation = 0.2 + r * 0.06;
  const countInRow = Math.floor(35 + r * 1.5);
  for (let s = 0; s < countInRow && seatIdx < seatCount; s++) {
    const angle = Math.PI * 0.15 + (s / (countInRow - 1)) * Math.PI * 0.7;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius - 0.6;
    dummy.position.set(x, elevation, z);
    dummy.rotation.y = -angle + Math.PI / 2;
    dummy.updateMatrix();
    seatMesh.setMatrixAt(seatIdx++, dummy.matrix);
  }
}
seatMesh.instanceMatrix.needsUpdate = true;
scene.add(seatMesh);

// SpotLight and ambient illumination
const amb = new THREE.AmbientLight(0x223344, 1.0);
const spot = new THREE.SpotLight(0xff66cc, 4.0, 8.0, Math.PI / 4, 0.3, 1.0);
spot.position.set(0, 2.2, -0.4);
spot.target = stage;
scene.add(amb, spot);

function animate(dt = 0.016) {
  spot.color.setHSL((Date.now() * 0.0003) % 1, 0.8, 0.6);
}
