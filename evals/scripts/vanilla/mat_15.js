// Photography Cyclorama Stage (~3.0m wide) with C-Stand Lighting Rigs
const cycMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.85 });
const floor = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.02, 2.0), cycMat);
floor.position.set(0, 0, 0);
const wall = new THREE.Mesh(new THREE.BoxGeometry(3.0, 2.0, 0.02), cycMat);
wall.position.set(0, 1.0, -1.0);

// Cove bevel connecting floor to wall
const cove = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3.0, 24, 1, false, 0, Math.PI * 0.5), cycMat);
cove.rotation.z = Math.PI / 2;
cove.rotation.y = Math.PI / 2;
cove.position.set(0, 0.35, -0.65);
scene.add(floor, wall, cove);

// Central Plinth & Metallic Geometric Bust Sculpture
const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.4), cycMat);
plinth.position.set(0, 0.35, 0);
scene.add(plinth);

const sculpMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.9, roughness: 0.18 });
const bustChest = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.08, 0.22, 6), sculpMat);
bustChest.position.set(0, 0.81, 0);
const bustHead = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.16, 7), sculpMat);
bustHead.position.set(0, 0.99, 0);
bustHead.rotation.y = 0.3;
scene.add(bustChest, bustHead);

// C-Stands Construction Helper
const standMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 });
function addCStand(x, z, h) {
  const stand = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, h, 12), standMat);
  mast.position.set(x, h / 2, z);
  const baseLeg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.04), standMat);
  baseLeg.position.set(x, 0.02, z);
  stand.add(mast, baseLeg);
  scene.add(stand);
}

// 1. Key Softbox Rig (Front-Left)
addCStand(-1.0, 0.6, 1.4);
const softbox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.2), new THREE.MeshStandardMaterial({ color: 0x111111 }));
softbox.position.set(-0.9, 1.4, 0.5);
softbox.lookAt(0, 0.85, 0);
scene.add(softbox);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(-0.9, 1.4, 0.5);
keyLight.target = bustHead;
scene.add(keyLight);

// 2. Fill Reflector Rig (Front-Right)
addCStand(1.0, 0.4, 1.2);
const reflector = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
reflector.rotation.x = Math.PI / 2;
reflector.position.set(0.9, 1.0, 0.4);
reflector.lookAt(0, 0.85, 0);
scene.add(reflector);

const fillPointLight = new THREE.PointLight(0xddeeff, 0.8, 4.0);
fillPointLight.position.set(0.8, 1.0, 0.4);
scene.add(fillPointLight);

// 3. Warm Rim Spotlight Rig (Rear-Right)
addCStand(0.8, -0.6, 1.6);
const spotLamp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.16, 16), standMat);
spotLamp.position.set(0.7, 1.55, -0.5);
spotLamp.lookAt(0, 0.95, 0);
scene.add(spotLamp);

const rimSpot = new THREE.SpotLight(0xffaa44, 2.5, 3.5, Math.PI / 6, 0.4);
rimSpot.position.set(0.7, 1.55, -0.5);
rimSpot.target = bustHead;
scene.add(rimSpot);

scene.add(new THREE.AmbientLight(0xffffff, 0.25));
