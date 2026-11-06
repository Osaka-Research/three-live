const boxGroup = new THREE.Group();
boxGroup.position.set(0, 0.75, 0);

// Lighting
const spotLight = new THREE.PointLight(0xffffff, 2.5, 3);
spotLight.position.set(0.3, 1.3, 0.4);
const ambLight = new THREE.AmbientLight(0xffeedd, 0.6);
scene.add(boxGroup, spotLight, ambLight);

// Materials
const velvetMat = new THREE.MeshPhysicalMaterial({
  color: 0x5a030f,
  roughness: 0.8,
  metalness: 0.1,
  sheen: 1.0,
  sheenRoughness: 0.5,
  sheenColor: new THREE.Color(0xd2143a)
});
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.25 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x22110c, roughness: 0.4 });
const platinumMat = new THREE.MeshStandardMaterial({ color: 0xe5e8ec, metalness: 0.95, roughness: 0.1 });
const sapphireMat = new THREE.MeshPhysicalMaterial({
  color: 0x002b88,
  transmission: 0.85,
  opacity: 1,
  transparent: true,
  roughness: 0.05,
  ior: 1.77,
  thickness: 0.03
});
const diamondMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.95,
  roughness: 0.02,
  ior: 2.42
});

// Octagonal box base and lid
const baseGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.06, 8);
const base = new THREE.Mesh(baseGeo, woodMat);
boxGroup.add(base);

const cushionGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 8);
const cushion = new THREE.Mesh(cushionGeo, velvetMat);
cushion.position.y = 0.02;
boxGroup.add(cushion);

const lid = new THREE.Mesh(baseGeo, woodMat);
lid.position.set(0, 0.06, -0.11);
lid.rotation.x = -Math.PI * 0.65;
boxGroup.add(lid);

const lidLining = new THREE.Mesh(cushionGeo, velvetMat);
lidLining.position.set(0, 0.015, 0);
lid.add(lidLining);

// Brass corner clasps
for (let i = 0; i < 8; i++) {
  const angle = (i * Math.PI) / 4;
  const clasp = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.025, 4), brassMat);
  clasp.position.set(Math.cos(angle) * 0.118, 0.02, Math.sin(angle) * 0.118);
  boxGroup.add(clasp);
}

// Platinum solitaire ring with halo diamonds
const ringGroup = new THREE.Group();
ringGroup.position.set(0, 0.045, 0);
ringGroup.rotation.x = Math.PI * 0.15;
boxGroup.add(ringGroup);

const band = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.003, 16, 32), platinumMat);
ringGroup.add(band);

const sapphire = new THREE.Mesh(new THREE.ConeGeometry(0.009, 0.012, 8), sapphireMat);
sapphire.position.y = 0.022;
sapphire.rotation.x = Math.PI;
ringGroup.add(sapphire);

for (let i = 0; i < 10; i++) {
  const a = (i * Math.PI * 2) / 10;
  const haloDia = new THREE.Mesh(new THREE.ConeGeometry(0.0025, 0.0035, 6), diamondMat);
  haloDia.position.set(Math.cos(a) * 0.012, 0.022, Math.sin(a) * 0.012);
  ringGroup.add(haloDia);
}
