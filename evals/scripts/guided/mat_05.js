// mat_05: Cyberpunk Neon Ramen Shop Sign with Bloom
const root = new THREE.Group();
root.name = "CyberpunkNeonRamenSignRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "CyberpunkAmbientLight";
scene.add(ambientLight);

const streetDirLight = new THREE.DirectionalLight(0x88aaff, 0.8);
streetDirLight.name = "NightStreetDirectionalLight";
streetDirLight.position.set(1.5, 2.5, 2.0);
scene.add(streetDirLight);

const magentaNeonLight = new THREE.PointLight(0xff00aa, 2.8, 3.0);
magentaNeonLight.name = "MagentaNeonGlowLight";
magentaNeonLight.position.set(0.0, 0.55, 0.35);
scene.add(magentaNeonLight);

const cyanNeonLight = new THREE.PointLight(0x00f0ff, 2.5, 3.0);
cyanNeonLight.name = "CyanNeonGlowLight";
cyanNeonLight.position.set(0.0, 1.25, 0.35);
scene.add(cyanNeonLight);

const yellowNeonLight = new THREE.PointLight(0xffcc22, 2.2, 2.5);
yellowNeonLight.name = "WarmYellowNoodleGlowLight";
yellowNeonLight.position.set(0.0, 0.90, 0.38);
scene.add(yellowNeonLight);

// Materials
const darkSteelMat = new THREE.MeshStandardMaterial({
  color: 0x1c2026,
  metalness: 0.85,
  roughness: 0.25
});

const wetCorrugatedMat = new THREE.MeshStandardMaterial({
  color: 0x12151a,
  metalness: 0.78,
  roughness: 0.14
});

constwetPavementMat = new THREE.MeshStandardMaterial({
  color: 0x0f1217,
  metalness: 0.65,
  roughness: 0.12
});

const neonMagentaMat = new THREE.MeshStandardMaterial({
  color: 0xff22bb,
  emissive: 0xff00aa,
  emissiveIntensity: 2.8,
  roughness: 0.15,
  metalness: 0.1
});

const neonCyanMat = new THREE.MeshStandardMaterial({
  color: 0x44ffff,
  emissive: 0x00eeff,
  emissiveIntensity: 2.6,
  roughness: 0.15,
  metalness: 0.1
});

const neonYellowMat = new THREE.MeshStandardMaterial({
  color: 0xffee55,
  emissive: 0xffbb00,
  emissiveIntensity: 2.5,
  roughness: 0.15,
  metalness: 0.1
});

const neonRedOrangeMat = new THREE.MeshStandardMaterial({
  color: 0xff5533,
  emissive: 0xff3300,
  emissiveIntensity: 2.4,
  roughness: 0.15,
  metalness: 0.1
});

// Rain-slicked base curb / steel mounting stanchion resting on y = 0
const basePlinth = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.48, 0.04, 24),
  darkSteelMat
);
basePlinth.name = "RainSlickedBasePad";
basePlinth.position.set(0, 0.02, 0);
root.add(basePlinth);

// Vertical steel wall mast & horizontal truss mounting brackets
const wallMast = new THREE.Mesh(
  new THREE.CylinderGeometry(0.045, 0.05, 1.62, 16),
  darkSteelMat
);
wallMast.name = "SteelSupportMast";
wallMast.position.set(-0.52, 0.82, -0.08);
root.add(wallMast);

const bracketHeights = [0.28, 0.85, 1.42];
for (let i = 0; i < bracketHeights.length; i++) {
  const arm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.96, 12),
    darkSteelMat
  );
  arm.name = "SteelMountingBracket_" + i;
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-0.04, bracketHeights[i], -0.08);
  root.add(arm);
}

// Dark Corrugated Metal Grid Backing (~0.88m wide x 1.48m tall)
const signBackingGroup = new THREE.Group();
signBackingGroup.name = "CorrugatedSignBackingGroup";
signBackingGroup.position.set(0, 0.86, 0);
root.add(signBackingGroup);

const numRibs = 23;
for (let i = 0; i < numRibs; i++) {
  const x = (i - (numRibs - 1) / 2) * 0.038;
  const rib = new THREE.Mesh(
    new THREE.CylinderGeometry(0.021, 0.021, 1.46, 12),
    wetCorrugatedMat
  );
  rib.name = "CorrugatedMetalRib_" + i;
  rib.position.set(x, 0, -0.02);
  signBackingGroup.add(rib);
}

// Outer perimeter cage tubing (Torus corners + Cylinder rails)
const topBorderNeon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 0.78, 12),
  neonCyanMat
);
topBorderNeon.name = "TopNeonBorderTube";
topBorderNeon.userData.xr = { bloom: { strength: 0.85 } };
topBorderNeon.rotation.z = Math.PI / 2;
topBorderNeon.position.set(0, 0.68, 0.03);
signBackingGroup.add(topBorderNeon);

const bottomBorderNeon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 0.78, 12),
  neonMagentaMat
);
bottomBorderNeon.name = "BottomNeonBorderTube";
bottomBorderNeon.userData.xr = { bloom: { strength: 0.85 } };
bottomBorderNeon.rotation.z = Math.PI / 2;
bottomBorderNeon.position.set(0, -0.68, 0.03);
signBackingGroup.add(bottomBorderNeon);

for (let side of [-1, 1]) {
  const sideNeon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 1.28, 12),
    side < 0 ? neonCyanMat : neonMagentaMat
  );
  sideNeon.name = "SideNeonBorderTube_" + (side < 0 ? "Left" : "Right");
  sideNeon.userData.xr = { bloom: { strength: 0.85 } };
  sideNeon.position.set(side * 0.41, 0, 0.03);
  signBackingGroup.add(sideNeon);
}

// Helper for bent neon tubes using CatmullRomCurve3 + TubeGeometry
function addNeonTube(name, points, mat, radius = 0.011) {
  const vecs = points.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(vecs);
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 28, radius, 10, false),
    mat
  );
  mesh.name = name;
  mesh.userData.xr = { bloom: { strength: 0.9 } };
  signBackingGroup.add(mesh);

  // Rubber electrode boot standoffs at start and end
  for (let endIdx of [0, points.length - 1]) {
    const pt = points[endIdx];
    const boot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.04, 8),
      darkSteelMat
    );
    boot.name = name + "_Electrode_" + endIdx;
    boot.rotation.x = Math.PI / 2;
    boot.position.set(pt[0], pt[1], pt[2] - 0.02);
    signBackingGroup.add(boot);
  }
}

// Glowing Neon Bowl (Magenta hemispherical arc + foot ring + decorative wave)
const bowlRimRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.26, 0.012, 12, 32, Math.PI),
  neonMagentaMat
);
bowlRimRing.name = "NeonRamenBowlArc";
bowlRimRing.userData.xr = { bloom: { strength: 0.9 } };
bowlRimRing.rotation.z = Math.PI;
bowlRimRing.position.set(0, -0.14, 0.045);
signBackingGroup.add(bowlRimRing);

addNeonTube(
  "NeonBowlTopLip",
  [
    [-0.27, -0.14, 0.045],
    [0.0, -0.14, 0.05],
    [0.27, -0.14, 0.045]
  ],
  neonMagentaMat,
  0.012
);

addNeonTube(
  "NeonBowlFootBase",
  [
    [-0.12, -0.43, 0.045],
    [-0.10, -0.47, 0.045],
    [0.10, -0.47, 0.045],
    [0.12, -0.43, 0.045]
  ],
  neonMagentaMat,
  0.011
);

// Chopsticks holding lifted noodles (Red-Orange & Warm Yellow)
addNeonTube(
  "NeonChopstickTop",
  [
    [0.02, 0.16, 0.055],
    [0.18, 0.21, 0.055],
    [0.34, 0.26, 0.055]
  ],
  neonRedOrangeMat,
  0.009
);

addNeonTube(
  "NeonChopstickBottom",
  [
    [0.02, 0.11, 0.055],
    [0.18, 0.13, 0.055],
    [0.34, 0.15, 0.055]
  ],
  neonRedOrangeMat,
  0.009
);

// Wavy Golden Yellow Noodles cascading from chopsticks into the bowl
for (let n = 0; n < 4; n++) {
  const xBase = -0.06 + n * 0.038;
  addNeonTube(
    "NeonNoodleStrand_" + n,
    [
      [xBase, 0.14, 0.05],
      [xBase - 0.022, 0.06, 0.055],
      [xBase + 0.022, -0.03, 0.055],
      [xBase - 0.018, -0.12, 0.05]
    ],
    neonYellowMat,
    0.0085
  );
}

// Rising Cyan Steam Plumes above the noodles
for (let s = 0; s < 3; s++) {
  const sx = -0.18 + s * 0.12;
  addNeonTube(
    "NeonSteamWave_" + s,
    [
      [sx, 0.02, 0.045],
      [sx - 0.035, 0.12, 0.045],
      [sx + 0.035, 0.22, 0.045],
      [sx - 0.02, 0.31, 0.045]
    ],
    neonCyanMat,
    0.009
  );
}

// Top Neon Lettering ("RAMEN" / Katakana stylized strokes in Cyan & Magenta)
// Letter R
addNeonTube(
  "NeonLetter_R",
  [
    [-0.31, 0.42, 0.048],
    [-0.31, 0.56, 0.048],
    [-0.23, 0.56, 0.048],
    [-0.23, 0.49, 0.048],
    [-0.30, 0.49, 0.048],
    [-0.22, 0.42, 0.048]
  ],
  neonCyanMat,
  0.009
);
// Letter A
addNeonTube(
  "NeonLetter_A",
  [
    [-0.17, 0.42, 0.048],
    [-0.12, 0.56, 0.048],
    [-0.07, 0.42, 0.048]
  ],
  neonCyanMat,
  0.009
);
// Letter M
addNeonTube(
  "NeonLetter_M",
  [
    [-0.02, 0.42, 0.048],
    [-0.02, 0.56, 0.048],
    [0.03, 0.47, 0.048],
    [0.08, 0.56, 0.048],
    [0.08, 0.42, 0.048]
  ],
  neonCyanMat,
  0.009
);
// Letter E
addNeonTube(
  "NeonLetter_E",
  [
    [0.21, 0.56, 0.048],
    [0.13, 0.56, 0.048],
    [0.13, 0.49, 0.048],
    [0.19, 0.49, 0.048],
    [0.13, 0.48, 0.048],
    [0.13, 0.42, 0.048],
    [0.21, 0.42, 0.048]
  ],
  neonCyanMat,
  0.009
);
// Letter N
addNeonTube(
  "NeonLetter_N",
  [
    [0.25, 0.42, 0.048],
    [0.25, 0.56, 0.048],
    [0.33, 0.42, 0.048],
    [0.33, 0.56, 0.048]
  ],
  neonCyanMat,
  0.009
);

// Bottom Neon Kanji/Banner bar
addNeonTube(
  "NeonBottomTaglineBar",
  [
    [-0.28, -0.57, 0.048],
    [0.0, -0.57, 0.052],
    [0.28, -0.57, 0.048]
  ],
  neonYellowMat,
  0.01
);

// Camera framing (~1.65m tall -> distance ~2.3m)
camera.position.set(0.25, 0.88, 2.25);
camera.lookAt(0, 0.82, 0);
