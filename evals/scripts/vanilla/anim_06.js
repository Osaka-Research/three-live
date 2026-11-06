// Pastoral hillside patch with golden wheat stalks and wooden fence
const groundGeo = new THREE.PlaneGeometry(3.2, 3.2, 32, 32);
groundGeo.rotateX(-Math.PI / 2);
const pos = groundGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  pos.setY(i, Math.sin(x * 1.2) * 0.15 + Math.cos(z * 1.0) * 0.1);
}
groundGeo.computeVertexNormals();
const groundMat = new THREE.MeshStandardMaterial({ color: 0x5a6332, roughness: 0.9 });
const ground = new THREE.Mesh(groundGeo, groundMat);
scene.add(ground);

// Wooden fence
const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.8 });
const postGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8);
const railGeo = new THREE.BoxGeometry(3.0, 0.04, 0.08);
const fenceGroup = new THREE.Group();
for (let x = -1.4; x <= 1.4; x += 0.7) {
  const post = new THREE.Mesh(postGeo, fenceMat);
  post.position.set(x, 0.35, 1.2);
  fenceGroup.add(post);
}
const rail1 = new THREE.Mesh(railGeo, fenceMat); rail1.position.set(0, 0.25, 1.2);
const rail2 = new THREE.Mesh(railGeo, fenceMat); rail2.position.set(0, 0.5, 1.2);
fenceGroup.add(rail1, rail2);
scene.add(fenceGroup);

// 1,200 Golden wheat stalks via InstancedMesh
const count = 1200;
const stalkGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.65, 5);
stalkGeo.translate(0, 0.325, 0);
const stalkMat = new THREE.MeshStandardMaterial({ color: 0xdfb15b, roughness: 0.6 });
const wheat = new THREE.InstancedMesh(stalkGeo, stalkMat, count);
const dummy = new THREE.Object3D();
const basePositions = [];

for (let i = 0; i < count; i++) {
  const x = (Math.random() - 0.5) * 2.8;
  const z = (Math.random() - 0.5) * 2.2 - 0.1;
  const y = Math.sin(x * 1.2) * 0.15 + Math.cos(z * 1.0) * 0.1;
  basePositions.push({ x, y, z });
  dummy.position.set(x, y, z);
  dummy.rotation.set((Math.random() - 0.5) * 0.1, Math.random() * Math.PI, (Math.random() - 0.5) * 0.1);
  dummy.updateMatrix();
  wheat.setMatrixAt(i, dummy.matrix);
}
wheat.instanceMatrix.needsUpdate = true;
scene.add(wheat);

// Warm sunset directional lighting
const ambient = new THREE.AmbientLight(0x403038, 1.2);
const sunLight = new THREE.DirectionalLight(0xff8c42, 2.8);
sunLight.position.set(3, 1.8, -2.5);
scene.add(ambient, sunLight);

let time = 0;
function animate(dt = 0.016) {
  time += dt;
  for (let i = 0; i < count; i++) {
    const p = basePositions[i];
    const wave = Math.sin(time * 3.0 + p.x * 2.5 + p.z * 1.8) * 0.22;
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(wave * 0.5, 0, wave);
    dummy.updateMatrix();
    wheat.setMatrixAt(i, dummy.matrix);
  }
  wheat.instanceMatrix.needsUpdate = true;
}
