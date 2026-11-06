const lantern = new THREE.Group();

// Materials
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.3 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x332a15, metalness: 0.7, roughness: 0.5 });
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.92,
  opacity: 1,
  transparent: true,
  roughness: 0.1,
  ior: 1.5,
  thickness: 0.02
});

// Cylindrical Fuel Base & Filler Cap
const baseGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.08, 24);
const base = new THREE.Mesh(baseGeo, brassMat);
base.position.y = 0.04;
lantern.add(base);

const capGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.012, 12);
const cap = new THREE.Mesh(capGeo, darkMetal);
cap.position.set(0.05, 0.085, 0.02);
lantern.add(cap);

// Central Glass Globe & Internal Burner Flame Light
const globeGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.14, 24);
const globe = new THREE.Mesh(globeGeo, glassMat);
globe.position.y = 0.15;
lantern.add(globe);

const lanternLight = new THREE.PointLight(0xff9933, 2.5, 3.0, 1.2);
lanternLight.position.set(0, 0.15, 0);
lantern.add(lanternLight);

const flame = new THREE.Mesh(
  new THREE.CylinderGeometry(0.004, 0.008, 0.025, 8),
  new THREE.MeshBasicMaterial({ color: 0xffdd66 })
);
flame.position.set(0, 0.12, 0);
lantern.add(flame);

// 4 Protective Brass Guard Rods
const rodGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.16, 8);
for (let i = 0; i < 4; i++) {
  const angle = (i * Math.PI) / 2;
  const rod = new THREE.Mesh(rodGeo, brassMat);
  rod.position.set(Math.cos(angle) * 0.065, 0.15, Math.sin(angle) * 0.065);
  lantern.add(rod);
}

// Fluted Top Chimney Cap
const chimneyGeo = new THREE.CylinderGeometry(0.04, 0.065, 0.07, 24);
const chimney = new THREE.Mesh(chimneyGeo, brassMat);
chimney.position.y = 0.255;
lantern.add(chimney);

const topRingGeo = new THREE.TorusGeometry(0.042, 0.006, 12, 24);
const topRing = new THREE.Mesh(topRingGeo, brassMat);
topRing.rotation.x = Math.PI / 2;
topRing.position.y = 0.29;
lantern.add(topRing);

// Wire Bail Handle
const handleGeo = new THREE.TorusGeometry(0.09, 0.0035, 8, 32, Math.PI);
const handle = new THREE.Mesh(handleGeo, darkMetal);
handle.position.set(0, 0.28, 0);
handle.rotation.z = Math.PI;
lantern.add(handle);

// Scene Setup & Placement
lantern.position.set(0, 0.6, 0);
scene.add(lantern);

const ambLight = new THREE.AmbientLight(0x222233, 0.8);
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(1.5, 2.5, 2.0);
scene.add(ambLight, dirLight);
