// Vintage Brass Hurricane Lantern (~0.35m tall) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xfff4e0, 1.2);
dirLight.name = "key_directional_light";
dirLight.position.set(1.2, 2.0, 1.5);
scene.add(dirLight);

const lanternGroup = new THREE.Group();
lanternGroup.name = "hurricane_lantern";
scene.add(lanternGroup);

// Materials
const brassMat = new THREE.MeshStandardMaterial({
  color: 0xd4a843,
  metalness: 0.88,
  roughness: 0.24
});

const agedBrassMat = new THREE.MeshStandardMaterial({
  color: 0x9e772b,
  metalness: 0.82,
  roughness: 0.38
});

const glassGlobeMat = new THREE.MeshPhysicalMaterial({
  color: 0xfffbf0,
  transmission: 0.92,
  ior: 1.5,
  thickness: 0.006,
  roughness: 0.06,
  metalness: 0.0,
  transparent: true,
  opacity: 0.95,
  attenuationColor: 0xffe0a3,
  attenuationDistance: 0.4
});

const flameMat = new THREE.MeshStandardMaterial({
  color: 0xffaa22,
  emissive: 0xff7700,
  emissiveIntensity: 3.0,
  roughness: 0.2
});

// 1. Cylindrical Fuel Base (y = 0 to y = 0.065)
const baseFootGeo = new THREE.CylinderGeometry(0.088, 0.092, 0.012, 32);
const baseFoot = new THREE.Mesh(baseFootGeo, agedBrassMat);
baseFoot.name = "fuel_base_foot_rim";
baseFoot.position.set(0, 0.006, 0);
lanternGroup.add(baseFoot);

const tankGeo = new THREE.CylinderGeometry(0.08, 0.086, 0.048, 32);
const tankMesh = new THREE.Mesh(tankGeo, brassMat);
tankMesh.name = "fuel_tank_cylinder";
tankMesh.position.set(0, 0.036, 0);
lanternGroup.add(tankMesh);

const tankShoulderGeo = new THREE.CylinderGeometry(0.056, 0.08, 0.016, 32);
const tankShoulder = new THREE.Mesh(tankShoulderGeo, brassMat);
tankShoulder.name = "fuel_tank_shoulder";
tankShoulder.position.set(0, 0.068, 0);
lanternGroup.add(tankShoulder);

// Filler Cap on the fuel tank shoulder
const fillerCapGroup = new THREE.Group();
fillerCapGroup.name = "filler_cap_assembly";
fillerCapGroup.position.set(0.058, 0.066, 0.03);
fillerCapGroup.rotation.z = -0.35;

const fillerNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.009, 0.009, 0.012, 16),
  agedBrassMat
);
fillerNeck.name = "filler_neck";
fillerCapGroup.add(fillerNeck);

const fillerCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 0.007, 20),
  brassMat
);
fillerCap.name = "filler_cap_top";
fillerCap.position.y = 0.008;
fillerCapGroup.add(fillerCap);
lanternGroup.add(fillerCapGroup);

// Burner Cone & Wick Adjuster Wheel
const burnerBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.046, 0.054, 0.024, 24),
  agedBrassMat
);
burnerBase.name = "burner_housing";
burnerBase.position.set(0, 0.088, 0);
lanternGroup.add(burnerBase);

const wickStem = new THREE.Mesh(
  new THREE.CylinderGeometry(0.002, 0.002, 0.055, 12),
  brassMat
);
wickStem.name = "wick_adjuster_stem";
wickStem.rotation.z = Math.PI / 2;
wickStem.position.set(0.04, 0.088, 0);
lanternGroup.add(wickStem);

const wickWheel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.01, 0.01, 0.003, 18),
  brassMat
);
wickWheel.name = "wick_adjuster_knurled_wheel";
wickWheel.rotation.z = Math.PI / 2;
wickWheel.position.set(0.068, 0.088, 0);
lanternGroup.add(wickWheel);

// Lower Gallery Plate with Perforation Rim
const lowerGalleryRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.056, 0.004, 12, 32),
  brassMat
);
lowerGalleryRing.name = "lower_gallery_seat_ring";
lowerGalleryRing.rotation.x = Math.PI / 2;
lowerGalleryRing.position.set(0, 0.1, 0);
lanternGroup.add(lowerGalleryRing);

// Glowing Flame & Warm Point Light inside Globe
const flameCone = new THREE.Mesh(
  new THREE.ConeGeometry(0.012, 0.032, 16),
  flameMat
);
flameCone.name = "lantern_wick_flame";
flameCone.position.set(0, 0.125, 0);
lanternGroup.add(flameCone);

const lanternLight = new THREE.PointLight(0xffa938, 2.5, 1.8);
lanternLight.name = "lantern_warm_point_light";
lanternLight.position.set(0, 0.16, 0);
lanternGroup.add(lanternLight);

// 2. Central Transmissive Glass Globe (y = 0.10 to y = 0.25)
const globeLower = new THREE.Mesh(
  new THREE.CylinderGeometry(0.068, 0.052, 0.05, 32, 1, true),
  glassGlobeMat
);
globeLower.name = "glass_globe_lower_taper";
globeLower.position.set(0, 0.125, 0);
lanternGroup.add(globeLower);

const globeMid = new THREE.Mesh(
  new THREE.CylinderGeometry(0.068, 0.068, 0.05, 32, 1, true),
  glassGlobeMat
);
globeMid.name = "glass_globe_belly";
globeMid.position.set(0, 0.175, 0);
lanternGroup.add(globeMid);

const globeUpper = new THREE.Mesh(
  new THREE.CylinderGeometry(0.048, 0.068, 0.05, 32, 1, true),
  glassGlobeMat
);
globeUpper.name = "glass_globe_upper_taper";
globeUpper.position.set(0, 0.225, 0);
lanternGroup.add(globeUpper);

// 3. Two Horizontal Guard Rings & Four Protective Vertical Brass Guard Rods
const midGuardRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.074, 0.0028, 12, 32),
  brassMat
);
midGuardRing.name = "middle_guard_ring";
midGuardRing.rotation.x = Math.PI / 2;
midGuardRing.position.set(0, 0.175, 0);
lanternGroup.add(midGuardRing);

const upperGuardRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.052, 0.003, 12, 32),
  brassMat
);
upperGuardRing.name = "upper_gallery_ring";
upperGuardRing.rotation.x = Math.PI / 2;
upperGuardRing.position.set(0, 0.252, 0);
lanternGroup.add(upperGuardRing);

for (let i = 0; i < 4; i++) {
  const angle = (i * Math.PI) / 2 + Math.PI / 4;
  const rodGroup = new THREE.Group();
  rodGroup.name = `protective_guard_rod_${i + 1}`;

  // Bowed vertical rod composed of lower, middle, and upper segments
  const lowerSeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0028, 0.0028, 0.105, 12),
    brassMat
  );
  lowerSeg.name = `guard_rod_lower_${i + 1}`;
  lowerSeg.position.set(Math.cos(angle) * 0.072, 0.12, Math.sin(angle) * 0.072);
  rodGroup.add(lowerSeg);

  const upperSeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0028, 0.0028, 0.09, 12),
    brassMat
  );
  upperSeg.name = `guard_rod_upper_${i + 1}`;
  upperSeg.position.set(Math.cos(angle) * 0.062, 0.215, Math.sin(angle) * 0.062);
  // Slight inward tilt toward chimney
  upperSeg.rotation.z = Math.cos(angle) * 0.22;
  upperSeg.rotation.x = -Math.sin(angle) * 0.22;
  rodGroup.add(upperSeg);

  lanternGroup.add(rodGroup);
}

// Dual side air tubes (classic hurricane lantern draft tubes)
for (const side of [-1, 1]) {
  const airTube = new THREE.Mesh(
    new THREE.CylinderGeometry(0.011, 0.012, 0.22, 16),
    agedBrassMat
  );
  airTube.name = `side_air_draft_tube_${side > 0 ? "right" : "left"}`;
  airTube.position.set(side * 0.082, 0.175, 0);
  lanternGroup.add(airTube);

  const tubeElbowBottom = new THREE.Mesh(
    new THREE.TorusGeometry(0.016, 0.011, 12, 16, Math.PI / 2),
    agedBrassMat
  );
  tubeElbowBottom.name = `air_tube_lower_elbow_${side > 0 ? "right" : "left"}`;
  tubeElbowBottom.position.set(side * 0.066, 0.065, 0);
  tubeElbowBottom.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI;
  lanternGroup.add(tubeElbowBottom);

  const tubeElbowTop = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.01, 12, 16, Math.PI / 2),
    agedBrassMat
  );
  tubeElbowTop.name = `air_tube_upper_elbow_${side > 0 ? "right" : "left"}`;
  tubeElbowTop.position.set(side * 0.06, 0.285, 0);
  tubeElbowTop.rotation.z = side > 0 ? 0 : Math.PI / 2;
  lanternGroup.add(tubeElbowTop);
}

// 4. Fluted Top Chimney Cap (y = 0.25 to y = 0.32)
const chimneyNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.044, 0.048, 0.042, 24),
  agedBrassMat
);
chimneyNeck.name = "chimney_vent_cylinder";
chimneyNeck.position.set(0, 0.273, 0);
lanternGroup.add(chimneyNeck);

const flutedCapCone = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.064, 0.022, 16),
  brassMat
);
flutedCapCone.name = "fluted_chimney_hood";
flutedCapCone.position.set(0, 0.302, 0);
lanternGroup.add(flutedCapCone);

// Fluted crimps around the chimney cap rim
for (let i = 0; i < 12; i++) {
  const angle = (i / 12) * Math.PI * 2;
  const crimp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.004, 0.006, 0.022, 8),
    agedBrassMat
  );
  crimp.name = `chimney_flute_rib_${i + 1}`;
  crimp.position.set(Math.cos(angle) * 0.046, 0.302, Math.sin(angle) * 0.046);
  crimp.rotation.z = Math.cos(angle) * 0.65;
  crimp.rotation.x = -Math.sin(angle) * 0.65;
  lanternGroup.add(crimp);
}

const topCapCrown = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.03, 0.012, 24),
  brassMat
);
topCapCrown.name = "chimney_top_crown";
topCapCrown.position.set(0, 0.318, 0);
lanternGroup.add(topCapCrown);

const topLoop = new THREE.Mesh(
  new THREE.TorusGeometry(0.012, 0.0025, 12, 24),
  brassMat
);
topLoop.name = "chimney_suspension_ring";
topLoop.position.set(0, 0.332, 0);
lanternGroup.add(topLoop);

// 5. Wire Bail Handle arching up to y = 0.355
const bailHandle = new THREE.Mesh(
  new THREE.TorusGeometry(0.088, 0.0028, 12, 36, Math.PI),
  brassMat
);
bailHandle.name = "wire_bail_handle";
bailHandle.position.set(0, 0.265, 0);
lanternGroup.add(bailHandle);

const bailGrip = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 0.036, 16),
  agedBrassMat
);
bailGrip.name = "bail_handle_grip_sleeve";
bailGrip.rotation.z = Math.PI / 2;
bailGrip.position.set(0, 0.353, 0);
lanternGroup.add(bailGrip);

// Frame camera at ~2.2x bounding radius
camera.position.set(0.38, 0.26, 0.48);
camera.lookAt(0, 0.175, 0);
