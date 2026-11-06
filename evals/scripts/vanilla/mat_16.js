const group = new THREE.Group();
scene.add(group);

const ambientLight = new THREE.AmbientLight(0x222a38, 1.2);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(1.5, 3, 2);
scene.add(ambientLight, dirLight);

// Command holotable pedestal & emitter
const tableMat = new THREE.MeshPhysicalMaterial({ color: 0x1f242e, metalness: 0.9, roughness: 0.25, clearcoat: 0.4 });
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.65, 36), tableMat);
base.position.set(0, 0.325, 0);
group.add(base);

const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x00f0ff, transmission: 0.85, opacity: 0.95, transparent: true, roughness: 0.1, ior: 1.45, emissive: 0x003344, emissiveIntensity: 0.5 });
const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 32), lensMat);
lens.position.set(0, 0.67, 0);
group.add(lens);

const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.025, 16, 48), tableMat);
bezel.rotation.x = Math.PI / 2;
bezel.position.set(0, 0.68, 0);
group.add(bezel);

// Holographic star system projection
const holoGroup = new THREE.Group();
holoGroup.position.set(0, 0.9, 0);
group.add(holoGroup);

const starMat = new THREE.MeshPhysicalMaterial({ color: 0xaa66ff, emissive: 0x7700ff, emissiveIntensity: 2.5, roughness: 0.2, transmission: 0.5, transparent: true });
const star = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 24), starMat);
holoGroup.add(star);

const holoLight = new THREE.PointLight(0x00ffff, 2.5, 2.5);
holoLight.position.set(0, 0.9, 0);
group.add(holoLight);

const orbitMat = new THREE.MeshPhysicalMaterial({ color: 0x00e1ff, emissive: 0x0088cc, emissiveIntensity: 0.8, wireframe: true, roughness: 0.3 });
const planetMat = new THREE.MeshPhysicalMaterial({ color: 0x22eeff, emissive: 0x004488, emissiveIntensity: 1.2, roughness: 0.2, transmission: 0.6, transparent: true });
const markerMat = new THREE.MeshPhysicalMaterial({ color: 0xff00bb, emissive: 0xaa0077, emissiveIntensity: 2.0 });

const orbits = [0.16, 0.26, 0.36];
orbits.forEach((r, idx) => {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.003, 8, 64), orbitMat);
  ring.rotation.x = Math.PI / 2 + (idx - 1) * 0.15;
  holoGroup.add(ring);

  const planet = new THREE.Mesh(new THREE.SphereGeometry(0.02 + idx * 0.008, 16, 16), planetMat);
  planet.position.set(Math.cos(idx * 2) * r, Math.sin(idx * 2) * 0.04, Math.sin(idx * 2) * r);
  holoGroup.add(planet);

  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), markerMat);
  marker.position.set(planet.position.x, planet.position.y + 0.04, planet.position.z);
  holoGroup.add(marker);
});

group.userData.xr = { grab: true };
function animate(dt = 0.016) {
  holoGroup.rotation.y += 0.4 * dt;
}
