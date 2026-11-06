const root = new THREE.Group();
root.position.set(0, 0.8, 0);
scene.add(root);

scene.add(new THREE.AmbientLight(0x223344, 1.2));
const sunLight = new THREE.DirectionalLight(0xfff5e6, 2.5);
sunLight.position.set(4, 3, 2);
scene.add(sunLight);

// Planet body
const planetGeo = new THREE.SphereGeometry(0.35, 32, 32);
const planetMat = new THREE.MeshStandardMaterial({ color: 0xd2a679, roughness: 0.7, metalness: 0.1 });
const planet = new THREE.Mesh(planetGeo, planetMat);
root.add(planet);

// Planetary rings
const ringGeo = new THREE.TorusGeometry(0.55, 0.08, 2, 64);
const ringMat = new THREE.MeshStandardMaterial({ color: 0xaa8866, roughness: 0.8, side: THREE.DoubleSide });
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = Math.PI * 0.45;
root.add(ring);

// 1,500 Asteroids belt
const count = 1500;
const rockGeo = new THREE.SphereGeometry(0.015, 6, 5);
const rockMat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0.2 });
const asteroidBelt = new THREE.InstancedMesh(rockGeo, rockMat, count);
asteroidBelt.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const rockData = [];

for (let i = 0; i < count; i++) {
  const radius = 0.75 + Math.random() * 0.45;
  const angle = Math.random() * Math.PI * 2;
  const y = (Math.random() - 0.5) * 0.08;
  const speed = (0.2 + Math.random() * 0.1) / Math.sqrt(radius);
  const scale = 0.5 + Math.random() * 1.5;

  rockData.push({ radius, angle, y, speed, scale });
  color.setHSL(0.08 + Math.random() * 0.06, 0.2, 0.3 + Math.random() * 0.4);
  asteroidBelt.setColorAt(i, color);

  dummy.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
  dummy.scale.setScalar(scale);
  dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
  dummy.updateMatrix();
  asteroidBelt.setMatrixAt(i, dummy.matrix);
}
asteroidBelt.instanceColor.needsUpdate = true;
asteroidBelt.instanceMatrix.needsUpdate = true;
root.add(asteroidBelt);

function animate(t) {
  root.rotation.y = t * 0.05;
  for (let i = 0; i < count; i++) {
    const r = rockData[i];
    const currentAngle = r.angle + t * r.speed * 0.3;
    dummy.position.set(Math.cos(currentAngle) * r.radius, r.y, Math.sin(currentAngle) * r.radius);
    dummy.scale.setScalar(r.scale);
    dummy.rotation.y += 0.01;
    dummy.updateMatrix();
    asteroidBelt.setMatrixAt(i, dummy.matrix);
  }
  asteroidBelt.instanceMatrix.needsUpdate = true;
}
