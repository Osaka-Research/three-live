const ambientLight = new THREE.AmbientLight(0xfff5ea, 0.9);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1.5, 3, 2);
scene.add(ambientLight, dirLight);

const mobileGroup = new THREE.Group();
mobileGroup.position.set(0, 1.5, 0);
scene.add(mobileGroup);

// Crossed wooden dowels
const woodMat = new THREE.MeshStandardMaterial({ color: 0xc8a165, roughness: 0.6 });
const dowelGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.7, 16);
const dowel1 = new THREE.Mesh(dowelGeo, woodMat);
dowel1.rotation.z = Math.PI / 2;
const dowel2 = new THREE.Mesh(dowelGeo, woodMat);
dowel2.rotation.x = Math.PI / 2;
mobileGroup.add(dowel1, dowel2);

// Center hanging string & finial
const stringMat = new THREE.MeshBasicMaterial({ color: 0xdddddd });
const topFinial = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 16), woodMat);
topFinial.position.y = 0.02;
mobileGroup.add(topFinial);

// Folded geometric origami crane geometry
const craneGeo = new THREE.BufferGeometry();
const craneVertices = new Float32Array([
  0, 0, 0.08,  -0.08, 0.02, 0,  0, 0.04, 0,
  0, 0, 0.08,  0, 0.04, 0,      0.08, 0.02, 0,
  0, 0, -0.08, 0, 0.04, 0,      -0.08, 0.02, 0,
  0, 0, -0.08, 0.08, 0.02, 0,   0, 0.04, 0,
  0, 0, 0.08,  0, -0.03, 0,     -0.08, 0.02, 0,
  0, 0, 0.08,  0.08, 0.02, 0,   0, -0.03, 0
]);
craneGeo.setAttribute('position', new THREE.BufferAttribute(craneVertices, 3));
craneGeo.computeVertexNormals();

const pastelColors = [0xffb3ba, 0xffdfba, 0xffffba, 0xbaffc9, 0xbae1ff, 0xdfbaff, 0xffc6ff];
const cranes = [];

for (let i = 0; i < 7; i++) {
  const angle = (i / 7) * Math.PI * 2;
  const radius = i === 0 ? 0 : 0.28;
  const hangLen = 0.35 + (i % 3) * 0.12;
  const craneGroup = new THREE.Group();
  craneGroup.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);

  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, hangLen, 4), stringMat);
  string.position.y = -hangLen / 2;
  craneGroup.add(string);

  const mat = new THREE.MeshStandardMaterial({
    color: pastelColors[i],
    roughness: 0.5,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  const craneMesh = new THREE.Mesh(craneGeo, mat);
  craneMesh.position.y = -hangLen;
  craneMesh.rotation.y = angle + Math.PI / 4;
  craneGroup.add(craneMesh);

  mobileGroup.add(craneGroup);
  cranes.push({ group: craneGroup, mesh: craneMesh, baseAngle: angle, baseLen: hangLen, phase: i * 0.9 });
}

let animTime = 0;
function animate(dt = 0.016) {
  animTime += dt;
  mobileGroup.rotation.y = animTime * 0.25;
  cranes.forEach((c) => {
    c.mesh.position.y = -c.baseLen + Math.sin(animTime * 1.8 + c.phase) * 0.03;
    c.mesh.rotation.z = Math.sin(animTime * 2.2 + c.phase) * 0.18;
    c.mesh.rotation.x = Math.cos(animTime * 1.5 + c.phase) * 0.12;
  });
}
scene.userData.update = animate;
