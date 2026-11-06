const ambientLight = new THREE.AmbientLight(0xffeedd, 0.6);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xfff8ee, 1.4);
dirLight.position.set(3, 4, 2);
scene.add(dirLight);

const table = new THREE.Mesh(
  new THREE.CylinderGeometry(0.8, 0.8, 0.06, 32),
  new THREE.MeshStandardMaterial({ color: 0x2b1e16, roughness: 0.8 })
);
table.position.set(0, 0.65, 0);
scene.add(table);

const chest = new THREE.Group();
chest.position.set(0, 0.68, 0);
chest.userData.xr = { grab: '2-hand', handles: true, label: 'Jade Puzzle Chest' };
scene.add(chest);

const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.25 });
const jadeMat = new THREE.MeshStandardMaterial({ color: 0x1b4d3e, roughness: 0.2, metalness: 0.1 });

const baseBox = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.2, 0.32), jadeMat);
baseBox.position.y = 0.1;
chest.add(baseBox);

const handleGeo = new THREE.TorusGeometry(0.04, 0.008, 8, 24, Math.PI);
[-0.245, 0.245].forEach((x, i) => {
  const handle = new THREE.Mesh(handleGeo, brassMat);
  handle.position.set(x, 0.12, 0);
  handle.rotation.y = i === 0 ? -Math.PI / 2 : Math.PI / 2;
  chest.add(handle);
});

[-0.1, 0.1].forEach((x, idx) => {
  const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.015, 16), brassMat);
  socket.rotation.x = Math.PI / 2;
  socket.position.set(x, 0.1, 0.165);
  socket.userData.xr = { snapSocket: `keyhole_${idx + 1}`, accept: `key_${idx + 1}` };
  chest.add(socket);
});

const lidGroup = new THREE.Group();
lidGroup.position.set(0, 0.2, -0.16);
const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.32), jadeMat);
lidMesh.position.set(0, 0.03, 0.16);
const lidTrim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.34), brassMat);
lidTrim.position.set(0, 0.06, 0.16);
lidGroup.add(lidMesh, lidTrim);
chest.add(lidGroup);

[-0.35, 0.35].forEach((x, idx) => {
  const keyGroup = new THREE.Group();
  keyGroup.position.set(x, 0.69, 0.22);
  const keyRing = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.006, 12, 24), brassMat);
  const keyStem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.08, 12), brassMat);
  keyStem.rotation.x = Math.PI / 2;
  keyStem.position.z = 0.04;
  keyGroup.add(keyRing, keyStem);
  keyGroup.userData.xr = { grab: '1-hand', snapTo: `keyhole_${idx + 1}`, id: `key_${idx + 1}`, label: `Key #${idx + 1}` };
  scene.add(keyGroup);
});

chest.userData.interactivity = {
  isOpen: false,
  onSelect: () => {
    chest.userData.interactivity.isOpen = !chest.userData.interactivity.isOpen;
  },
  update: (dt) => {
    const targetAngle = chest.userData.interactivity.isOpen ? -Math.PI * 0.65 : 0;
    lidGroup.rotation.x = THREE.MathUtils.lerp(lidGroup.rotation.x, targetAngle, (dt || 0.016) * 4.0);
  }
};
