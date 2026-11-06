const orrery = new THREE.Group();
orrery.position.set(0, 0.8, 0);
scene.add(orrery);

scene.add(new THREE.AmbientLight(0x221105, 0.8));
const roomLight = new THREE.DirectionalLight(0xfff0d0, 1.2);
roomLight.position.set(2, 3, 2);
scene.add(roomLight);

// Brass materials
const brassMat = new THREE.MeshStandardMaterial({ color: 0xcd9b1d, metalness: 0.9, roughness: 0.25 });

// Base pedestal & Concentric Gear Rings
const basePedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.12, 32), brassMat);
basePedestal.position.y = -0.06;
orrery.add(basePedestal);

for (let r = 0.15; r <= 0.55; r += 0.08) {
  const gearRing = new THREE.Mesh(new THREE.TorusGeometry(r, 0.006, 8, 48), brassMat);
  gearRing.rotation.x = Math.PI * 0.5;
  orrery.add(gearRing);
}

// Glowing Sun at center
const sunLight = new THREE.PointLight(0xffaa22, 2.5, 3.0);
orrery.add(sunLight);
const sunMat = new THREE.MeshStandardMaterial({ color: 0xffcc33, emissive: 0xff7700, roughness: 0.2 });
const sun = new THREE.Mesh(new THREE.SphereGeometry(0.06, 24, 24), sunMat);
orrery.add(sun);

// 6 Planets with Keplerian relative speeds
const planetDefs = [
  { name: 'Mercury', r: 0.12, size: 0.012, color: 0xaaaaaa, speed: 4.15 },
  { name: 'Venus',   r: 0.18, size: 0.018, color: 0xeecc88, speed: 1.62 },
  { name: 'Earth',   r: 0.26, size: 0.020, color: 0x3388ee, speed: 1.00, moon: true },
  { name: 'Mars',    r: 0.34, size: 0.015, color: 0xcc4422, speed: 0.53 },
  { name: 'Jupiter', r: 0.44, size: 0.038, color: 0xd4a373, speed: 0.24 },
  { name: 'Saturn',  r: 0.55, size: 0.032, color: 0xe2c992, speed: 0.12, rings: true }
];

const armPivots = [];

planetDefs.forEach((p, idx) => {
  const pivot = new THREE.Group();
  pivot.position.y = idx * 0.01;
  orrery.add(pivot);

  // Radial brass rod arm
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, p.r, 8), brassMat);
  arm.rotation.z = Math.PI * 0.5;
  arm.position.x = p.r * 0.5;
  pivot.add(arm);

  // Planet body
  const pMesh = new THREE.Mesh(
    new THREE.SphereGeometry(p.size, 16, 16),
    new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6 })
  );
  pMesh.position.x = p.r;
  pivot.add(pMesh);

  // Earth Moon
  if (p.moon) {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.005, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8 })
    );
    moon.position.set(0.032, 0, 0);
    pMesh.add(moon);
  }

  // Saturn Rings
  if (p.rings) {
    const sRing = new THREE.Mesh(
      new THREE.TorusGeometry(p.size * 1.8, 0.004, 2, 32),
      brassMat
    );
    sRing.rotation.x = Math.PI * 0.4;
    pMesh.add(sRing);
  }

  armPivots.push({ pivot, pMesh, speed: p.speed, moon: p.moon });
});

function animate(t) {
  sun.rotation.y = t * 0.2;
  armPivots.forEach(item => {
    item.pivot.rotation.y = t * item.speed * 0.4;
    item.pMesh.rotation.y = t * 2.0;
    if (item.moon && item.pMesh.children[0]) {
      item.pMesh.children[0].position.set(
        Math.cos(t * 4.0) * 0.035,
        0,
        Math.sin(t * 4.0) * 0.035
      );
    }
  });
}
