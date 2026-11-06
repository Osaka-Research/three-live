// Vanilla Three.js Particle Starfield & OrbitControls (Triggers Points + OrbitControls TL103/TL106)
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.PointLight(0xfbbf24, 2.5, 20);
sun.position.set(0, 0.6, 0);
scene.add(sun);

const planet = new THREE.Mesh(
  new THREE.SphereGeometry(0.35, 24, 16),
  new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.4 })
);
planet.name = 'exoplanet';
planet.position.set(0, 0.35, 0);
scene.add(planet);

// Vanilla Three.js Points starfield + OrbitControls
const starGeo = new THREE.BufferGeometry();
const starPositions = new Float32Array(300);
for (let i = 0; i < 300; i++) {
  starPositions[i] = (Math.random() - 0.5) * 6;
}
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.05 });
const stars = new THREE.Points(starGeo, starMat);
stars.name = 'starfield_points';
scene.add(stars);

const controls = new THREE.OrbitControls(camera);
controls.update();

camera.position.set(0, 0.8, 1.8);
camera.lookAt(0, 0.35, 0);
