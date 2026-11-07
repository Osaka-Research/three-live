const chandelierRoot = new THREE.Group();
chandelierRoot.name = "venetian_murano_glass_chandelier_root";
scene.add(chandelierRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff8eb, 1.25);
keyLight.name = "gallery_key_light";
keyLight.position.set(1.5, 2.5, 1.8);
scene.add(keyLight);

// Materials (Murano blown crystal, Venetian rose pink, and 24k gold-leaf amber glass)
const crystalGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xf8fafc,
  roughness: 0.05,
  metalness: 0.02,
  transmission: 0.92,
  ior: 1.54,
  thickness: 0.04,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04,
  iridescence: 0.45,
  iridescenceIOR: 1.35,
  transparent: true,
  opacity: 0.95
});

const roseMuranoGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xf472b6,
  roughness: 0.08,
  metalness: 0.04,
  transmission: 0.85,
  ior: 1.52,
  thickness: 0.03,
  clearcoat: 1.0,
  iridescence: 0.6,
  transparent: true,
  opacity: 0.92
});

const goldAmberGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xfbbf24,
  roughness: 0.12,
  metalness: 0.25,
  transmission: 0.72,
  ior: 1.56,
  thickness: 0.03,
  clearcoat: 1.0
});

const leafAquamarineGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x67e8f9,
  roughness: 0.08,
  metalness: 0.05,
  transmission: 0.86,
  ior: 1.52,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.92
});

const candleSleeveMat = new THREE.MeshStandardMaterial({
  color: 0xfef3c7,
  roughness: 0.35,
  metalness: 0.02
});

const warmBulbFlameMat = new THREE.MeshPhysicalMaterial({
  color: 0xfffbeb,
  emissive: 0xffaa22,
  emissiveIntensity: 2.2,
  roughness: 0.1
});

const brassHardwareMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.25,
  metalness: 0.88
});

// Subtle marble floor medallion at y = 0 to ground the scene height metrics cleanly
const floorMedallion = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.20, 0.016, 32),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.2 })
);
floorMedallion.name = "floor_reference_medallion";
floorMedallion.position.set(0, 0.008, 0);
chandelierRoot.add(floorMedallion);

// Main Chandelier Assembly spanning y = 0.08m (bottom teardrop finial) to y = 1.25m (ceiling canopy)
const chandelierBody = new THREE.Group();
chandelierBody.name = "murano_chandelier_body_group";
chandelierRoot.add(chandelierBody);

// 1. Central Blown-Glass Baluster Column via LatheGeometry (y = 0.20m to y = 1.25m)
const columnProfile = [
  new THREE.Vector2(0.000, 0.200), // Bottom finial boss
  new THREE.Vector2(0.032, 0.225),
  new THREE.Vector2(0.016, 0.260),
  new THREE.Vector2(0.115, 0.320), // Lower distributor bowl (receives the 8 arms)
  new THREE.Vector2(0.125, 0.365),
  new THREE.Vector2(0.045, 0.395),
  new THREE.Vector2(0.082, 0.460), // Lower blown-glass sphere
  new THREE.Vector2(0.030, 0.520), // Waist collar
  new THREE.Vector2(0.095, 0.630), // Central Venetian amphora urn baluster
  new THREE.Vector2(0.055, 0.740),
  new THREE.Vector2(0.026, 0.790),
  new THREE.Vector2(0.090, 0.855), // Upper crown leaf receiver bowl
  new THREE.Vector2(0.028, 0.900),
  new THREE.Vector2(0.055, 0.975), // Upper glass bulb
  new THREE.Vector2(0.018, 1.040), // Suspension stem
  new THREE.Vector2(0.018, 1.180),
  new THREE.Vector2(0.085, 1.235), // Ceiling bell canopy
  new THREE.Vector2(0.000, 1.250)
];
const centralColumnGeo = new THREE.LatheGeometry(columnProfile, 40);
const centralColumnMesh = new THREE.Mesh(centralColumnGeo, crystalGlassMat);
centralColumnMesh.name = "chandelier_central_baluster_lathe";
chandelierBody.add(centralColumnMesh);

// Gold-leaf Murano accent rings along the central column
const goldCollarHeights = [0.26, 0.395, 0.52, 0.79, 0.90, 1.04];
goldCollarHeights.forEach((yVal, i) => {
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, 0.018, 24),
    goldAmberGlassMat
  );
  collar.name = `central_column_gold_collar_${i + 1}`;
  collar.position.set(0, yVal, 0);
  chandelierBody.add(collar);
});

// 2. Reusable LatheGeometries for Ruffled Bobeche Drip Pans & Teardrop Prisms
const bobecheProfile = [
  new THREE.Vector2(0.000, 0.000),
  new THREE.Vector2(0.022, 0.004),
  new THREE.Vector2(0.048, 0.018),
  new THREE.Vector2(0.068, 0.036),
  new THREE.Vector2(0.074, 0.026), // Ruffled downturned outer lip
  new THREE.Vector2(0.052, 0.012),
  new THREE.Vector2(0.015, 0.006),
  new THREE.Vector2(0.000, 0.006)
];
const bobecheLatheGeo = new THREE.LatheGeometry(bobecheProfile, 28);

const teardropProfile = [
  new THREE.Vector2(0.000, -0.095), // Pointed bottom tip
  new THREE.Vector2(0.018, -0.072),
  new THREE.Vector2(0.028, -0.045), // Swelled teardrop belly
  new THREE.Vector2(0.016, -0.018),
  new THREE.Vector2(0.005, -0.004),
  new THREE.Vector2(0.000, 0.000)
];
const teardropLatheGeo = new THREE.LatheGeometry(teardropProfile, 20);

// Central bottom hanging finial teardrop prism (reaches y = 0.085m)
const centralFinialDrop = new THREE.Mesh(teardropLatheGeo, roseMuranoGlassMat);
centralFinialDrop.name = "central_bottom_finial_teardrop";
centralFinialDrop.position.set(0, 0.20, 0);
centralFinialDrop.scale.set(1.35, 1.2, 1.35);
chandelierBody.add(centralFinialDrop);

// 3. Eight Ornate S-Scrolled Crystal Arms, Ruffled Bobeches, Candle Bulbs & Teardrops
const numArms = 8;
const armsGroup = new THREE.Group();
armsGroup.name = "chandelier_eight_arms_group";
chandelierBody.add(armsGroup);

for (let i = 0; i < numArms; i++) {
  const angle = (i / numArms) * Math.PI * 2.0;
  const armUnit = new THREE.Group();
  armUnit.name = `chandelier_arm_${i + 1}_unit`;
  armUnit.rotation.y = angle;
  armsGroup.add(armUnit);

  // Primary S-scrolled crystal arm (CatmullRomCurve3 + TubeGeometry)
  const armCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.095, 0.345, 0),
    new THREE.Vector3(0.185, 0.245, 0),
    new THREE.Vector3(0.310, 0.285, 0),
    new THREE.Vector3(0.395, 0.455, 0),
    new THREE.Vector3(0.420, 0.415, 0)
  ]);
  const armTube = new THREE.Mesh(
    new THREE.TubeGeometry(armCurve, 32, 0.0135, 12, false),
    crystalGlassMat
  );
  armTube.name = `chandelier_arm_${i + 1}_s_scroll_tube`;
  armUnit.add(armTube);

  // Decorative under-scroll volute loop beneath each arm
  const voluteCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.16, 0.255, 0),
    new THREE.Vector3(0.23, 0.195, 0),
    new THREE.Vector3(0.28, 0.235, 0),
    new THREE.Vector3(0.25, 0.265, 0)
  ]);
  const voluteTube = new THREE.Mesh(
    new THREE.TubeGeometry(voluteCurve, 18, 0.008, 8, false),
    goldAmberGlassMat
  );
  voluteTube.name = `chandelier_arm_${i + 1}_volute_curl`;
  armUnit.add(voluteTube);

  // Ruffled Glass Bobeche Drip Pan at arm tip (x = 0.42m, y = 0.415m)
  const bobecheMesh = new THREE.Mesh(bobecheLatheGeo, roseMuranoGlassMat);
  bobecheMesh.name = `chandelier_arm_${i + 1}_bobeche_drip_pan`;
  bobecheMesh.position.set(0.420, 0.415, 0);
  armUnit.add(bobecheMesh);

  // Candle-style ivory sleeve
  const candleSleeve = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.014, 0.095, 16),
    candleSleeveMat
  );
  candleSleeve.name = `chandelier_arm_${i + 1}_candle_sleeve`;
  candleSleeve.position.set(0.420, 0.472, 0);
  armUnit.add(candleSleeve);

  // Warm flame-shaped glass bulb (SphereGeometry + ConeGeometry tip)
  const bulbBase = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 14, 12),
    warmBulbFlameMat
  );
  bulbBase.name = `chandelier_arm_${i + 1}_candle_bulb_base`;
  bulbBase.position.set(0.420, 0.532, 0);
  bulbBase.scale.set(0.85, 1.35, 0.85);
  armUnit.add(bulbBase);

  const bulbFlameTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.012, 0.032, 12),
    warmBulbFlameMat
  );
  bulbFlameTip.name = `chandelier_arm_${i + 1}_candle_bulb_flame`;
  bulbFlameTip.position.set(0.420, 0.556, 0);
  armUnit.add(bulbFlameTip);

  // Hanging teardrop prism suspended below the bobeche
  const armTeardrop = new THREE.Mesh(teardropLatheGeo, crystalGlassMat);
  armTeardrop.name = `chandelier_arm_${i + 1}_teardrop_prism`;
  armTeardrop.position.set(0.420, 0.410, 0);
  armUnit.add(armTeardrop);

  // Secondary inner teardrop prism hanging from the lower scroll
  const innerTeardrop = new THREE.Mesh(teardropLatheGeo, roseMuranoGlassMat);
  innerTeardrop.name = `chandelier_arm_${i + 1}_inner_teardrop`;
  innerTeardrop.position.set(0.230, 0.195, 0);
  innerTeardrop.scale.set(0.8, 0.8, 0.8);
  armUnit.add(innerTeardrop);

  // Place warm PointLights on the 4 cardinal arms to illuminate the crystal and glass
  if (i % 2 === 0) {
    const candleLight = new THREE.PointLight(0xffb84d, 0.65, 2.5);
    candleLight.name = `chandelier_arm_${i + 1}_warm_point_light`;
    candleLight.position.set(0.420, 0.56, 0);
    armUnit.add(candleLight);
  }
}

// 4. Curved Murano Glass Acanthus Leaves & Floral Scrolls (Upper & Lower Tiers)
const leavesGroup = new THREE.Group();
leavesGroup.name = "chandelier_curved_glass_leaves_group";
chandelierBody.add(leavesGroup);

for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2.0 + Math.PI / 8;
  const leafUnit = new THREE.Group();
  leafUnit.name = `murano_glass_leaf_${i + 1}_group`;
  leafUnit.rotation.y = angle;
  leavesGroup.add(leafUnit);

  // Upper arching glass leaf blade (fluted curved tube + ribbed crest)
  const upperLeafCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.065, 0.855, 0),
    new THREE.Vector3(0.145, 0.965, 0),
    new THREE.Vector3(0.235, 0.995, 0),
    new THREE.Vector3(0.285, 0.915, 0)
  ]);
  const upperLeafMesh = new THREE.Mesh(
    new THREE.TubeGeometry(upperLeafCurve, 24, 0.015, 10, false),
    i % 2 === 0 ? leafAquamarineGlassMat : goldAmberGlassMat
  );
  upperLeafMesh.name = `murano_upper_curved_leaf_${i + 1}`;
   upperLeafMesh.scale.set(1.0, 1.0, 1.85); // Flatten laterally into a sculpted glass leaf
  leafUnit.add(upperLeafMesh);

  // Lower outward-curling glass leaf between the arms
  const lowerLeafCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.085, 0.365, 0),
    new THREE.Vector3(0.165, 0.455, 0),
    new THREE.Vector3(0.245, 0.440, 0),
    new THREE.Vector3(0.275, 0.385, 0)
  ]);
  const lowerLeafMesh = new THREE.Mesh(
    new THREE.TubeGeometry(lowerLeafCurve, 20, 0.013, 10, false),
    i % 2 === 0 ? roseMuranoGlassMat : leafAquamarineGlassMat
  );
  lowerLeafMesh.name = `murano_lower_curved_leaf_${i + 1}`;
  lowerLeafMesh.scale.set(1.0, 1.0, 1.75);
  leafUnit.add(lowerLeafMesh);
}

// Camera Framing (height ~1.25m, width ~0.92m, center ~0.64m)
camera.position.set(0.0, 0.68, 1.52);
camera.lookAt(0, 0.64, 0);
