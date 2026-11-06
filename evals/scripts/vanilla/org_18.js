// org_18: Tabletop geometric brass-and-glass terrarium
const terrariumGroup = new THREE.Group();
terrariumGroup.position.set(0, 0.8, 0);
scene.add(terrariumGroup);

// Glass and frame materials
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xe6f4f8, transmission: 0.92, opacity: 1, transparent: true,
  roughness: 0.05, ior: 1.52, thickness: 0.02
});
const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8963e, metalness: 0.9, roughness: 0.25 });

// Faceted Dodecahedron Glass Container
const dodecaGeo = new THREE.DodecahedronGeometry(0.2, 0);
const glassMesh = new THREE.Mesh(dodecaGeo, glassMat);
const frameLines = new THREE.LineSegments(new THREE.WireframeGeometry(dodecaGeo), new THREE.LineBasicMaterial({ color: 0xd4a044, linewidth: 2 }));
terrariumGroup.add(glassMesh, frameLines);

// Base layers: gravel & soil
const soilMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.95 });
const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x8a8479, roughness: 0.8 });
const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.07, 16), soilMat);
soil.position.y = -0.11;
terrariumGroup.add(soil);

for (let i = 0; i < 22; i++) {
  const pebble = new THREE.Mesh(new THREE.SphereGeometry(0.012 + Math.random() * 0.006, 8, 8), pebbleMat);
  const rad = 0.04 + Math.random() * 0.09;
  const ang = Math.random() * Math.PI * 2;
  pebble.position.set(Math.cos(ang) * rad, -0.075, Math.sin(ang) * rad);
  pebble.scale.set(1.2, 0.6, 1);
  terrariumGroup.add(pebble);
}

// Rosette Echeveria succulent (spiral golden angle leaves)
const echeveriaMat = new THREE.MeshPhysicalMaterial({
  color: 0x5b9b88, roughness: 0.45, clearcoat: 0.3, transmission: 0.1
});
const echeveria = new THREE.Group();
echeveria.position.set(-0.045, -0.065, 0.02);
for (let l = 0; l < 24; l++) {
  const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.013, 0.038, 8), echeveriaMat);
  const phi = l * 2.39996; // Golden angle
  const r = 0.008 + l * 0.0022;
  leaf.position.set(Math.cos(phi) * r, l * 0.0018, Math.sin(phi) * r);
  leaf.rotation.set(0.65 - l * 0.015, -phi, 0.4);
  leaf.scale.set(1.4, 1, 0.4);
  echeveria.add(leaf);
}
terrariumGroup.add(echeveria);

// Ribbed barrel cactus
const cactusMat = new THREE.MeshStandardMaterial({ color: 0x2e6b36, roughness: 0.6 });
const cactus = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 16), cactusMat);
cactus.scale.set(1, 1.25, 1);
cactus.position.set(0.055, -0.035, -0.03);
terrariumGroup.add(cactus);

// Quartz crystals
const quartzMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff, transmission: 0.85, opacity: 1, transparent: true,
  roughness: 0.1, ior: 1.54, clearcoat: 0.8
});
[[-0.01, 0.04, 0.05, 0.035], [0.01, 0.05, 0.04, 0.045]].forEach(([x, z, rY, h]) => {
  const crystal = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.008, h, 6), quartzMat);
  crystal.position.set(x, -0.075 + h / 2, z);
  crystal.rotation.set(0.15, rY, -0.1);
  terrariumGroup.add(crystal);
});

// Lighting
scene.add(new THREE.AmbientLight(0xf4faff, 0.7));
const keyLight = new THREE.DirectionalLight(0xffecc7, 1.3);
keyLight.position.set(1.5, 3, 2);
scene.add(keyLight);

function animate(dt) {
  terrariumGroup.rotation.y += (dt || 0.016) * 0.2;
}
animate(0);
