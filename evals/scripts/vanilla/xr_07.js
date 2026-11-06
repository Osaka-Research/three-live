const ambientLight = new THREE.AmbientLight(0x221c3b, 0.8);
scene.add(ambientLight);
const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
mainLight.position.set(0, 4, 2);
scene.add(mainLight);

const deck = new THREE.Group();
deck.position.set(0, 0.75, 0);
const consoleGeo = new THREE.CylinderGeometry(1.6, 1.6, 0.12, 32, 1, false, 0, Math.PI);
const consoleMat = new THREE.MeshStandardMaterial({ color: 0x1e222d, roughness: 0.3, metalness: 0.8 });
const tableMesh = new THREE.Mesh(consoleGeo, consoleMat);
tableMesh.rotation.y = Math.PI;
deck.add(tableMesh);

const faderGeo = new THREE.BoxGeometry(0.04, 0.06, 0.15);
const faderMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, emissive: 0x004455 });
for (let i = 0; i < 4; i++) {
  const angle = Math.PI * 0.2 + (i * Math.PI * 0.2);
  const fader = new THREE.Mesh(faderGeo, faderMat);
  fader.position.set(Math.cos(angle) * 1.2, 0.08, -Math.sin(angle) * 1.2);
  deck.add(fader);
}
scene.add(deck);

const soundPresets = ['hum', 'reactor', 'wind', 'chimeLoop'];
const orbColors = [0x00e5ff, 0xff0077, 0x76ff03, 0xffea00];
const orbGeo = new THREE.SphereGeometry(0.12, 24, 24);
const orbsGroup = new THREE.Group();
scene.add(orbsGroup);

soundPresets.forEach((preset, idx) => {
  const orbMat = new THREE.MeshStandardMaterial({
    color: orbColors[idx],
    emissive: orbColors[idx],
    emissiveIntensity: 0.9,
    roughness: 0.2
  });
  const orb = new THREE.Mesh(orbGeo, orbMat);
  const light = new THREE.PointLight(orbColors[idx], 1.5, 3.0);
  orb.add(light);

  const radius = 1.35 + idx * 0.25;
  const speed = 0.4 + idx * 0.15;
  const baseAngle = (idx / 4) * Math.PI * 2;
  orb.position.set(Math.cos(baseAngle) * radius, 0.9 + Math.sin(idx) * 0.2, Math.sin(baseAngle) * radius);

  orb.userData.xr = {
    grab: '1-hand',
    orbit: { radius, speed, center: [0, 0.9, 0] },
    audioEmitter: {
      preset,
      coneInnerAngle: 60,
      refDistance: 1.2,
      directional: true
    }
  };
  orbsGroup.add(orb);
});

scene.userData.interactivity = {
  update: (dt) => {
    orbsGroup.children.forEach((orb) => {
      const orbData = orb.userData.xr.orbit;
      if (!orb.userData.isGrabbed && orbData) {
        orbData.angle = (orbData.angle || 0) + orbData.speed * (dt || 0.016);
        orb.position.x = Math.cos(orbData.angle) * orbData.radius;
        orb.position.z = Math.sin(orbData.angle) * orbData.radius;
      }
    });
  }
};
