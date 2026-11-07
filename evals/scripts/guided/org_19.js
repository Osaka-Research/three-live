const pumpkinRoot = new THREE.Group();
pumpkinRoot.name = "gnarled_halloween_pumpkin_root";
scene.add(pumpkinRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const autumnKeyLight = new THREE.DirectionalLight(0xffedd5, 1.15);
autumnKeyLight.name = "autumn_dusk_directional_light";
autumnKeyLight.position.set(1.2, 1.8, 1.4);
scene.add(autumnKeyLight);

const candlePointLight = new THREE.PointLight(0xff7b00, 2.2, 2.5);
candlePointLight.name = "flickering_candle_point_light";
candlePointLight.position.set(0, 0.16, 0.02);
pumpkinRoot.add(candlePointLight);

// Materials
const pumpkinRindMat = new THREE.MeshStandardMaterial({
  color: 0xea580c,
  roughness: 0.52,
  metalness: 0.03
});

const pumpkinDeepGrooveMat = new THREE.MeshStandardMaterial({
  color: 0xc2410c,
  roughness: 0.62,
  metalness: 0.02
});

const innerFleshGlowMat = new THREE.MeshStandardMaterial({
  color: 0xfbbf24,
  emissive: 0xf59e0b,
  emissiveIntensity: 0.85,
  roughness: 0.45,
  side: THREE.DoubleSide
});

const woodyStemMat = new THREE.MeshStandardMaterial({
  color: 0x4d3b27,
  roughness: 0.88,
  metalness: 0.03
});

const tendrilVineMat = new THREE.MeshStandardMaterial({
  color: 0x3f6212,
  roughness: 0.75,
  metalness: 0.02
});

const candleWaxMat = new THREE.MeshStandardMaterial({
  color: 0xfef3c7,
  roughness: 0.35
});

const candleFlameMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffaa00,
  emissiveIntensity: 2.5,
  roughness: 0.1
});

// 1. Hollow Carved Pumpkin Shell with Triangular Eyes, Nose & Jagged Toothy Grin via CSG.subtract
// Keep all CSG inputs <= 18 segments so total triangle count stays well below 4096
const outerShell = new THREE.Mesh(
  new THREE.SphereGeometry(0.215, 18, 14),
  pumpkinRindMat
);
outerShell.scale.set(1.04, 0.82, 1.04);
outerShell.position.set(0, 0.175, 0);
outerShell.updateMatrix();

const innerCavity = new THREE.Mesh(
  new THREE.SphereGeometry(0.185, 16, 12),
  innerFleshGlowMat
);
innerCavity.scale.set(1.04, 0.80, 1.04);
innerCavity.position.set(0, 0.178, 0);
innerCavity.updateMatrix();

// Triangular Eye & Nose Cutters (3-sided CylinderGeometry prisms oriented along Z)
function createTriangleCutter(radius, x, y, rotZ) {
  const cutter = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.24, 3),
    innerFleshGlowMat
  );
  cutter.rotation.x = Math.PI / 2;
  cutter.rotation.z = rotZ;
  cutter.position.set(x, y, 0.16);
  cutter.updateMatrix();
  return cutter;
}

const leftEyeCutter = createTriangleCutter(0.048, -0.072, 0.225, -0.15);
const rightEyeCutter = createTriangleCutter(0.048, 0.072, 0.225, 0.15);
const noseCutter = createTriangleCutter(0.032, 0.0, 0.172, 0.0);

// Wide Grin Cutter Box subtracted by tooth masks (or jagged diamond mouth blocks)
const mouthCenterCutter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.055, 0.24, 4),
  innerFleshGlowMat
);
mouthCenterCutter.rotation.x = Math.PI / 2;
mouthCenterCutter.scale.set(1.85, 1.0, 0.65);
mouthCenterCutter.position.set(0, 0.102, 0.16);
mouthCenterCutter.updateMatrix();

const mouthLeftCornerCutter = createTriangleCutter(0.042, -0.095, 0.118, 0.55);
const mouthRightCornerCutter = createTriangleCutter(0.042, 0.095, 0.118, -0.55);

let carvedPumpkin = THREE.CSG.subtract(outerShell, innerCavity);
carvedPumpkin = THREE.CSG.subtract(carvedPumpkin, leftEyeCutter);
carvedPumpkin = THREE.CSG.subtract(carvedPumpkin, rightEyeCutter);
carvedPumpkin = THREE.CSG.subtract(carvedPumpkin, noseCutter);
carvedPumpkin = THREE.CSG.subtract(carvedPumpkin, mouthCenterCutter);
carvedPumpkin = THREE.CSG.subtract(carvedPumpkin, mouthLeftCornerCutter);
carvedPumpkin = THREE.CSG.subtract(carvedPumpkin, mouthRightCornerCutter);
carvedPumpkin.material = pumpkinRindMat;
carvedPumpkin.name = "pumpkin_csg_carved_jack_o_lantern_shell";
pumpkinRoot.add(carvedPumpkin);

// Jagged Pumpkin Teeth protruding into the carved grin opening
const teethPositions = [
  { name: "pumpkin_upper_tooth_left", x: -0.042, y: 0.132, rotZ: Math.PI },
  { name: "pumpkin_upper_tooth_right", x: 0.042, y: 0.132, rotZ: Math.PI },
  { name: "pumpkin_lower_tooth_center", x: 0.0, y: 0.074, rotZ: 0 },
  { name: "pumpkin_lower_tooth_left", x: -0.072, y: 0.084, rotZ: -0.25 },
  { name: "pumpkin_lower_tooth_right", x: 0.072, y: 0.084, rotZ: 0.25 }
];
teethPositions.forEach((tp) => {
  const toothMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.028, 4),
    pumpkinRindMat
  );
  toothMesh.name = tp.name;
  toothMesh.rotation.x = Math.PI / 2;
  toothMesh.rotation.y = Math.PI / 4;
  toothMesh.position.set(tp.x, tp.y, 0.198);
  pumpkinRoot.add(toothMesh);
});

// Glowing Inner Flesh Backwall so the carved eyes & grin radiate warm amber light
const innerGlowBackdrop = new THREE.Mesh(
  new THREE.SphereGeometry(0.168, 20, 14, 0, Math.PI * 2, 0.25, Math.PI * 0.72),
  innerFleshGlowMat
);
innerGlowBackdrop.name = "pumpkin_glowing_inner_flesh_lining";
innerGlowBackdrop.scale.set(1.0, 0.80, 0.92);
innerGlowBackdrop.position.set(0, 0.175, -0.01);
pumpkinRoot.add(innerGlowBackdrop);

// 2. Vertical Pumpkin Lobe Ribs via TorusGeometry & SphereGeometry Lobes (~0.45m diameter)
const lobesGroup = new THREE.Group();
lobesGroup.name = "pumpkin_vertical_rib_lobes_group";
pumpkinRoot.add(lobesGroup);

const numLobes = 14;
for (let i = 0; i < numLobes; i++) {
  const angle = (i / numLobes) * Math.PI * 2.0;
  // Leave the front face sector (around angle = PI/2, +Z) clear so the CSG carved face is unobstructed
  const distFromFront = Math.abs(Math.atan2(Math.sin(angle - Math.PI / 2), Math.cos(angle - Math.PI / 2)));
  if (distFromFront > 0.62) {
    const lobeTorus = new THREE.Mesh(
      new THREE.TorusGeometry(0.132, 0.068, 16, 28),
      i % 2 === 0 ? pumpkinRindMat : pumpkinDeepGrooveMat
    );
    lobeTorus.name = `pumpkin_vertical_torus_lobe_${i + 1}`;
    lobeTorus.position.set(Math.cos(angle) * 0.032, 0.175, Math.sin(angle) * 0.032);
    lobeTorus.rotation.y = -angle;
    lobeTorus.scale.set(1.0, 0.86, 0.85);
    lobesGroup.add(lobeTorus);
  }
}

// Top and bottom ribbed collar rings (TorusGeometry) framing the carved face
const topCrownRibRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.115, 0.038, 14, 28),
  pumpkinRindMat
);
topCrownRibRing.name = "pumpkin_top_crown_torus_ring";
topCrownRibRing.rotation.x = Math.PI / 2;
topCrownRibRing.position.set(0, 0.315, 0);
lobesGroup.add(topCrownRibRing);

const bottomBaseRibRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.135, 0.038, 14, 28),
  pumpkinRindMat
);
bottomBaseRibRing.name = "pumpkin_bottom_base_torus_ring";
bottomBaseRibRing.rotation.x = Math.PI / 2;
bottomBaseRibRing.position.set(0, 0.038, 0);
lobesGroup.add(bottomBaseRibRing);

// 3. Curling Woody Stem & Tendril Vines at Top of Pumpkin
const stemGroup = new THREE.Group();
stemGroup.name = "curling_woody_stem_and_vines_group";
stemGroup.position.set(0, 0.33, 0);
pumpkinRoot.add(stemGroup);

// Twisted woody peduncle stem built from stacked angled TorusGeometry & TubeGeometry
const stemCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.0, -0.01, 0.0),
  new THREE.Vector3(0.015, 0.045, -0.01),
  new THREE.Vector3(-0.025, 0.095, -0.025),
  new THREE.Vector3(-0.065, 0.115, 0.01)
]);
const stemMainTube = new THREE.Mesh(
  new THREE.TubeGeometry(stemCurve, 24, 0.026, 10, false),
  woodyStemMat
);
stemMainTube.name = "pumpkin_gnarled_woody_stem";
stemGroup.add(stemMainTube);

const stemBaseCollar = new THREE.Mesh(
  new THREE.TorusGeometry(0.032, 0.014, 10, 16),
  woodyStemMat
);
stemBaseCollar.name = "pumpkin_stem_base_collar_torus";
stemBaseCollar.rotation.x = Math.PI / 2;
stemGroup.add(stemBaseCollar);

// Two Spiraling Green Tendril Vines curling across the top shoulder of the pumpkin
[-1, 1].forEach((side, vIdx) => {
  const vinePts = [];
  for (let s = 0; s <= 24; s++) {
    const u = s / 24;
    const x = side * (0.025 + u * 0.16);
    const y = 0.015 - u * 0.055 + Math.sin(u * Math.PI * 6.0) * 0.016;
    const z = -0.02 + Math.cos(u * Math.PI * 6.0) * 0.018 + u * 0.06;
    vinePts.push(new THREE.Vector3(x, y, z));
  }
  const vineCurve = new THREE.CatmullRomCurve3(vinePts);
  const vineMesh = new THREE.Mesh(
    new THREE.TubeGeometry(vineCurve, 40, 0.0045, 8, false),
    tendrilVineMat
  );
  vineMesh.name = `pumpkin_curling_tendril_vine_${vIdx + 1}`;
  stemGroup.add(vineMesh);
});

// 4. Flickering Candle Inside the Hollow Pumpkin Shell
const candleGroup = new THREE.Group();
candleGroup.name = "interior_candle_group";
candleGroup.position.set(0, 0.035, 0.02);
pumpkinRoot.add(candleGroup);

const waxPillar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.026, 0.028, 0.075, 16),
  candleWaxMat
);
waxPillar.name = "interior_wax_candle_pillar";
waxPillar.position.y = 0.038;
candleGroup.add(waxPillar);

const candleFlame = new THREE.Mesh(
  new THREE.SphereGeometry(0.014, 12, 10),
  candleFlameMat
);
candleFlame.name = "interior_candle_flame";
candleFlame.scale.set(0.75, 1.85, 0.75);
candleFlame.position.y = 0.095;
candleGroup.add(candleFlame);

// Flickering candle animation
function animate(t) {
  const flicker = 1.0 + 0.18 * Math.sin(t * 14.0) * Math.cos(t * 23.0);
  candlePointLight.intensity = 2.1 * flicker;
  candleFlame.scale.set(0.75 * flicker, 1.85 * flicker, 0.75 * flicker);
}

// Camera Framing (diameter ~0.45m, height ~0.45m, center ~0.21m)
camera.position.set(0.0, 0.25, 0.68);
camera.lookAt(0, 0.20, 0);
