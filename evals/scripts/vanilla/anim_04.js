const cradleGroup = new THREE.Group();
cradleGroup.position.set(0, 0.8, 0);
scene.add(cradleGroup);

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const spot = new THREE.DirectionalLight(0xfff8ee, 2.2);
spot.position.set(2, 3, 2);
scene.add(spot);

// Base: Mahogany wood
const baseMat = new THREE.MeshStandardMaterial({ color: 0x4a1e13, roughness: 0.45, metalness: 0.05 });
const base = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.04, 0.26), baseMat);
cradleGroup.add(base);

// Chrome frame rails
const chromeMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f5, metalness: 0.98, roughness: 0.05, clearcoat: 1.0 });
const archGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.3, 16);
const topRailGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.35, 16);

for (const side of [-0.09, 0.09]) {
  const post1 = new THREE.Mesh(archGeo, chromeMat);
  post1.position.set(-0.16, 0.15, side);
  const post2 = new THREE.Mesh(archGeo, chromeMat);
  post2.position.set(0.16, 0.15, side);
  const topRail = new THREE.Mesh(topRailGeo, chromeMat);
  topRail.position.set(0, 0.3, side);
  topRail.rotation.z = Math.PI * 0.5;
  cradleGroup.add(post1, post2, topRail);
}

// 5 Polished Steel Spheres & V-strings
const sphereRadius = 0.024;
const stringLength = 0.22;
const sphereGeo = new THREE.SphereGeometry(sphereRadius, 32, 32);
const stringMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 });
const stringGeo = new THREE.CylinderGeometry(0.0008, 0.0008, stringLength, 8);

const bobs = [];
for (let i = 0; i < 5; i++) {
  const pivot = new THREE.Group();
  const restX = (i - 2) * (sphereRadius * 2.0);
  pivot.position.set(restX, 0.3, 0);

  const bob = new THREE.Mesh(sphereGeo, chromeMat);
  bob.position.set(0, -stringLength, 0);
  pivot.add(bob);

  for (const side of [-0.09, 0.09]) {
    const str = new THREE.Mesh(stringGeo, stringMat);
    str.position.set(0, -stringLength * 0.5, side * 0.5);
    str.rotation.x = Math.atan2(-side, stringLength);
    pivot.add(str);
  }

  cradleGroup.add(pivot);
  bobs.push(pivot);
}

function animate(t) {
  const cycle = (t * 3.2) % (Math.PI * 2);
  const maxAngle = 0.55;

  if (cycle < Math.PI) {
    bobs[0].rotation.z = Math.sin(cycle) * maxAngle;
    bobs[4].rotation.z = 0;
  } else {
    bobs[0].rotation.z = 0;
    bobs[4].rotation.z = -Math.sin(cycle - Math.PI) * maxAngle;
  }
  for (let i = 1; i < 4; i++) {
    bobs[i].rotation.z = 0;
  }
}
