const ambientLight = new THREE.AmbientLight(0x222233, 0.5);
scene.add(ambientLight);

const systemGroup = new THREE.Group();
systemGroup.position.set(0, 0.8, 0);
scene.add(systemGroup);

const sunGeo = new THREE.SphereGeometry(0.25, 32, 32);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
const sun = new THREE.Mesh(sunGeo, sunMat);
sun.name = 'Sun';
sun.userData.xr = {
  holdToAsk: 'Tell me about the Sun and its core fusion process',
  text: 'Sun (G-type Star)'
};
const sunLight = new THREE.PointLight(0xfff5e0, 2.5, 8.0);
sun.add(sunLight);
systemGroup.add(sun);

const planetsData = [
  { name: 'Mercury', r: 0.04, dist: 0.45, speed: 1.2, color: 0x9ca3af, q: 'Tell me about Mercury\'s extreme temperatures.' },
  { name: 'Earth', r: 0.08, dist: 0.75, speed: 0.8, color: 0x2563eb, q: 'What makes Earth\'s magnetosphere protective?' },
  { name: 'Mars', r: 0.06, dist: 1.05, speed: 0.65, color: 0xef4444, q: 'Could Mars support human colonies in the future?' },
  { name: 'Saturn', r: 0.12, dist: 1.45, speed: 0.4, color: 0xf59e0b, ring: true, q: 'How did Saturn\'s ring system form?' }
];

planetsData.forEach((data) => {
  const planet = new THREE.Group();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(data.r, 24, 24),
    new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.5, metalness: 0.1 })
  );
  planet.add(sphere);

  if (data.ring) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(data.r * 1.8, 0.02, 2, 48),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.8 })
    );
    ring.rotation.x = Math.PI / 2.3;
    planet.add(ring);
  }

  const orbitPath = new THREE.Mesh(
    new THREE.TorusGeometry(data.dist, 0.003, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.4 })
  );
  orbitPath.rotation.x = Math.PI / 2;
  systemGroup.add(orbitPath);

  planet.position.set(data.dist, 0, 0);
  planet.userData.xr = {
    grab: '2-hand',
    scale: true,
    orbit: { target: 'Sun', radius: data.dist, speed: data.speed },
    holdToAsk: data.q,
    text: data.name
  };
  systemGroup.add(planet);
});

scene.userData.interactivity = {
  update: (dt) => {
    const delta = dt || 0.016;
    systemGroup.children.forEach((child) => {
      const orbit = child.userData?.xr?.orbit;
      if (orbit && !child.userData.isGrabbed) {
        orbit.angle = (orbit.angle || 0) + orbit.speed * delta * 0.5;
        child.position.x = Math.cos(orbit.angle) * orbit.radius;
        child.position.z = Math.sin(orbit.angle) * orbit.radius;
      }
    });
  }
};
