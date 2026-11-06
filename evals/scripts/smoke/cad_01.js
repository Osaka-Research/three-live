// Helical Planetary Gear Assembly (Clean CAD + CSG)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(3, 5, 4);
scene.add(dirLight);

const steelMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.8, roughness: 0.3 });

const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 0.08, 24), steelMat);
base.name = 'carrier_plate';
base.position.y = 0.04;
scene.add(base);

const sunBlank = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.24, 20), brassMat);
const sunBore = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16), brassMat);
const sunGear = THREE.CSG.subtract(sunBlank, sunBore);
sunGear.name = 'sun_gear';
sunGear.position.y = 0.2;
scene.add(sunGear);

for (let i = 0; i < 3; i++) {
  const angle = (i * Math.PI * 2) / 3;
  const planet = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.22, 20), steelMat);
  planet.name = 'planet_gear_' + i;
  planet.position.set(Math.cos(angle) * 0.6, 0.2, Math.sin(angle) * 0.6);
  scene.add(planet);
}

camera.position.set(0, 1.8, 2.8);
camera.lookAt(0, 0.2, 0);
