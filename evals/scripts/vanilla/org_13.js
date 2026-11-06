// Ornate 8-arm Murano blown-glass chandelier (~1.2m tall)
const chandelier = new THREE.Group();
chandelier.position.set(0, 0.85, 0);

// Lighting
scene.add(new THREE.AmbientLight(0xfff0dd, 0.8));
const coreLight = new THREE.PointLight(0xffaa55, 3.0, 3.5, 1.2);
coreLight.position.set(0, 0.1, 0);
chandelier.add(coreLight);

// Murano Glass & Accent Materials
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xf6fbff,
  transmission: 0.92,
  opacity: 1,
  transparent: true,
  roughness: 0.08,
  ior: 1.52,
  reflectivity: 0.6,
  clearcoat: 1.0,
  clearcoatRoughness: 0.1
});
const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffeedd, emissive: 0xff8822, emissiveIntensity: 2.2 });

// Central Baluster Stem (LatheGeometry)
const stemPts = [
  new THREE.Vector2(0.02, 0.6), new THREE.Vector2(0.05, 0.45), new THREE.Vector2(0.09, 0.25),
  new THREE.Vector2(0.04, 0.05), new THREE.Vector2(0.12, -0.15), new THREE.Vector2(0.02, -0.35)
];
const centralStem = new THREE.Mesh(new THREE.LatheGeometry(stemPts, 24), glassMat);
chandelier.add(centralStem);

// 8 S-Scrolled Crystal Arms, Leaves & Candle Bobeches
const numArms = 8;
for (let i = 0; i < numArms; i++) {
  const angle = (i * Math.PI * 2) / numArms;
  const armGroup = new THREE.Group();
  armGroup.rotation.y = angle;

  // S-scrolled Arm
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.06, -0.1, 0),
    new THREE.Vector3(0.24, -0.22, 0.05),
    new THREE.Vector3(0.42, -0.15, 0.08),
    new THREE.Vector3(0.48, 0.05, 0),
    new THREE.Vector3(0.44, 0.16, 0)
  ]);
  const armMesh = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 24, 0.016, 8, false), glassMat);
  armGroup.add(armMesh);

  // Curved Glass Leaf
  const leafCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.08, 0.1, 0),
    new THREE.Vector3(0.22, 0.32, 0),
    new THREE.Vector3(0.28, 0.24, 0)
  ]);
  armGroup.add(new THREE.Mesh(new THREE.TubeGeometry(leafCurve, 16, 0.01, 6, false), glassMat));

  // Ruffled Bobeche Drip Pan (LatheGeometry) & Teardrop Prism
  const bobechePts = [new THREE.Vector2(0.005, 0), new THREE.Vector2(0.065, 0.025), new THREE.Vector2(0.07, 0.05)];
  const bobeche = new THREE.Mesh(new THREE.LatheGeometry(bobechePts, 16), glassMat);
  bobeche.position.set(0.44, 0.16, 0);

  // Candle Bulb & Arm PointLight
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), bulbMat);
  bulb.scale.set(0.8, 1.8, 0.8);
  bulb.position.set(0.44, 0.22, 0);

  const armLight = new THREE.PointLight(0xffaa44, 0.6, 1.2);
  armLight.position.set(0.44, 0.24, 0);

  // Teardrop Prism
  const prismPts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.02, -0.04), new THREE.Vector2(0, -0.09)];
  const prism = new THREE.Mesh(new THREE.LatheGeometry(prismPts, 10), glassMat);
  prism.position.set(0.44, 0.12, 0);

  armGroup.add(bobeche, bulb, armLight, prism);
  chandelier.add(armGroup);
}

scene.add(chandelier);
