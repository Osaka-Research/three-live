const jellyfishRoot = new THREE.Group();
jellyfishRoot.name = "bioluminescent_jellyfish_root";
scene.add(jellyfishRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const topLight = new THREE.DirectionalLight(0x88ddff, 1.1);
topLight.name = "abyssal_downwelling_light";
topLight.position.set(0.8, 2.5, 1.2);
scene.add(topLight);

const coreGlowLight = new THREE.PointLight(0x00f0ff, 1.6, 3.0);
coreGlowLight.name = "bell_bioluminescent_point_light";
coreGlowLight.position.set(0, 0.72, 0);
jellyfishRoot.add(coreGlowLight);

const oralGlowLight = new THREE.PointLight(0xff33bb, 1.1, 2.5);
oralGlowLight.name = "oral_arms_bioluminescent_light";
oralGlowLight.position.set(0, 0.42, 0);
jellyfishRoot.add(oralGlowLight);

// Materials
const bellOuterMat = new THREE.MeshPhysicalMaterial({
  color: 0x38bdf8,
  emissive: 0x064e78,
  emissiveIntensity: 0.55,
  roughness: 0.12,
  metalness: 0.0,
  transmission: 0.82,
  ior: 1.38,
  thickness: 0.08,
  iridescence: 0.85,
  iridescenceIOR: 1.33,
  transparent: true,
  opacity: 0.88
});

const canalGlowMat = new THREE.MeshPhysicalMaterial({
  color: 0x67e8f9,
  emissive: 0x00e5ff,
  emissiveIntensity: 1.2,
  roughness: 0.18,
  metalness: 0.05,
  clearcoat: 0.8
});

const gonadCoreMat = new THREE.MeshPhysicalMaterial({
  color: 0xf472b6,
  emissive: 0xe81cff,
  emissiveIntensity: 1.1,
  roughness: 0.2,
  transmission: 0.5,
  ior: 1.4,
  transparent: true,
  opacity: 0.92
});

const oralArmMat = new THREE.MeshPhysicalMaterial({
  color: 0xe879f9,
  emissive: 0x9333ea,
  emissiveIntensity: 0.75,
  roughness: 0.25,
  transmission: 0.65,
  ior: 1.36,
  transparent: true,
  opacity: 0.85
});

const tentacleMat = new THREE.MeshPhysicalMaterial({
  color: 0x22d3ee,
  emissive: 0x0891b2,
  emissiveIntensity: 0.85,
  roughness: 0.2,
  transparent: true,
  opacity: 0.9
});

// Subtle abyssal seabed reference ring at y = 0 so scene is grounded at y = 0
const seabedPedestalMat = new THREE.MeshStandardMaterial({
  color: 0x0f172a,
  roughness: 0.9,
  metalness: 0.1
});
const seabedDisk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.26, 0.016, 32),
  seabedPedestalMat
);
seabedDisk.name = "abyssal_seabed_anchor_disk";
seabedDisk.position.set(0, 0.008, 0);
jellyfishRoot.add(seabedDisk);

// Floating Jellyfish Assembly (spanning y = 0.03m to y = 0.92m, ~0.9m tall)
const bellGroup = new THREE.Group();
bellGroup.name = "jellyfish_bell_group";
jellyfishRoot.add(bellGroup);

// 1. Hemispherical Umbrella Bell via LatheGeometry (y = 0.60m to y = 0.92m)
const bellProfile = [
  new THREE.Vector2(0.000, 0.920), // Apex of exumbrella
  new THREE.Vector2(0.065, 0.914),
  new THREE.Vector2(0.130, 0.892),
  new THREE.Vector2(0.185, 0.850),
  new THREE.Vector2(0.225, 0.790),
  new THREE.Vector2(0.245, 0.720),
  new THREE.Vector2(0.258, 0.655), // Flared margin skirt
  new THREE.Vector2(0.242, 0.615), // Margin lappet rim
  new THREE.Vector2(0.225, 0.625), // Inner velarium lip
  new THREE.Vector2(0.215, 0.695), // Subumbrella cavity wall
  new THREE.Vector2(0.180, 0.785),
  new THREE.Vector2(0.115, 0.855),
  new THREE.Vector2(0.000, 0.880)  // Inner subumbrella apex
];

const bellLatheGeo = new THREE.LatheGeometry(bellProfile, 48);
const bellMesh = new THREE.Mesh(bellLatheGeo, bellOuterMat);
bellMesh.name = "jellyfish_translucent_bell_lathe";
bellGroup.add(bellMesh);

// Inner bioluminescent gastrovascular core & 4 horseshoe gonad lobes (SphereGeometry)
const coreSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.085, 24, 18),
  gonadCoreMat
);
coreSphere.name = "jellyfish_gastrovascular_core";
coreSphere.position.set(0, 0.78, 0);
coreSphere.scale.set(1.1, 0.75, 1.1);
bellGroup.add(coreSphere);

for (let i = 0; i < 4; i++) {
  const angle = (i / 4) * Math.PI * 2.0;
  const gonadLobe = new THREE.Mesh(
    new THREE.SphereGeometry(0.042, 16, 14),
    gonadCoreMat
  );
  gonadLobe.name = `jellyfish_gonad_lobe_${i + 1}`;
  gonadLobe.position.set(Math.cos(angle) * 0.065, 0.75, Math.sin(angle) * 0.065);
  gonadLobe.scale.set(1.2, 0.6, 0.8);
  gonadLobe.rotation.y = -angle;
  bellGroup.add(gonadLobe);
}

// 2. 16 Glowing Radial Canals & Ribbed Bell Meridians (CatmullRomCurve3 + TubeGeometry)
const numCanals = 16;
for (let i = 0; i < numCanals; i++) {
  const theta = (i / numCanals) * Math.PI * 2.0;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);

  const canalPts = [
    new THREE.Vector3(cosT * 0.020, 0.912, sinT * 0.020),
    new THREE.Vector3(cosT * 0.128, 0.888, sinT * 0.128),
    new THREE.Vector3(cosT * 0.222, 0.788, sinT * 0.222),
    new THREE.Vector3(cosT * 0.254, 0.655, sinT * 0.254),
    new THREE.Vector3(cosT * 0.240, 0.618, sinT * 0.240)
  ];

  const canalCurve = new THREE.CatmullRomCurve3(canalPts);
  const canalGeo = new THREE.TubeGeometry(canalCurve, 24, i % 2 === 0 ? 0.0055 : 0.0035, 8, false);
  const canalMesh = new THREE.Mesh(canalGeo, canalGlowMat);
  canalMesh.name = `jellyfish_radial_canal_${i + 1}`;
  bellGroup.add(canalMesh);

  // Glowing rhopalia sensory bulb at the end of each radial canal
  const bulbMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.009, 10, 8),
    canalGlowMat
  );
  bulbMesh.name = `jellyfish_margin_rhopalium_${i + 1}`;
  bulbMesh.position.set(cosT * 0.242, 0.618, sinT * 0.242);
  bellGroup.add(bulbMesh);
}

// 3. Four Frilly Oral Arms in the Center (y = 0.16m to y = 0.74m)
const oralArmsGroup = new THREE.Group();
oralArmsGroup.name = "jellyfish_oral_arms_group";
jellyfishRoot.add(oralArmsGroup);

for (let a = 0; a < 4; a++) {
  const baseAngle = (a / 4) * Math.PI * 2.0 + Math.PI / 4;
  // Twin intertwined ruffled ribbons per oral arm
  for (let strand = 0; strand < 2; strand++) {
    const armPts = [];
    const steps = 18;
    for (let s = 0; s <= steps; s++) {
      const frac = s / steps;
      const y = 0.74 - frac * 0.56;
      const taper = (1.0 - frac * 0.55);
      const helixPhase = frac * Math.PI * 5.0 + baseAngle + strand * Math.PI * 0.85;
      const r = 0.042 * taper + 0.018 * Math.sin(frac * Math.PI * 9.0);
      const x = Math.cos(baseAngle) * 0.035 * taper + Math.cos(helixPhase) * r;
      const z = Math.sin(baseAngle) * 0.035 * taper + Math.sin(helixPhase) * r;
      armPts.push(new THREE.Vector3(x, y, z));
    }
    const armCurve = new THREE.CatmullRomCurve3(armPts);
    const armGeo = new THREE.TubeGeometry(armCurve, 44, strand === 0 ? 0.013 : 0.008, 10, false);
    const armMesh = new THREE.Mesh(armGeo, strand === 0 ? oralArmMat : gonadCoreMat);
    armMesh.name = `jellyfish_oral_arm_${a + 1}_frill_${strand + 1}`;
    oralArmsGroup.add(armMesh);
  }
}

// 4. 16 Long Sinusoidal Trailing Tentacles (y = 0.03m to y = 0.62m)
const tentaclesGroup = new THREE.Group();
tentaclesGroup.name = "jellyfish_trailing_tentacles_group";
jellyfishRoot.add(tentaclesGroup);

for (let t = 0; t < 16; t++) {
  const theta = (t / 16) * Math.PI * 2.0;
  const baseR = 0.240;
  const bx = Math.cos(theta) * baseR;
  const bz = Math.sin(theta) * baseR;

  const tentaclePts = [];
  const segs = 14;
  // Slightly varied lengths between 0.54m and 0.59m (reaching down to y = 0.03..0.08m)
  const length = 0.54 + (t % 3) * 0.022;
  for (let s = 0; s <= segs; s++) {
    const u = s / segs;
    const y = 0.618 - u * length;
    const wave = Math.sin(u * Math.PI * 3.5 + t * 0.7) * 0.032 * u;
    const tangWave = Math.cos(u * Math.PI * 2.5 + t * 1.1) * 0.022 * u;
    const x = bx + Math.cos(theta) * wave - Math.sin(theta) * tangWave;
    const z = bz + Math.sin(theta) * wave + Math.cos(theta) * tangWave;
    tentaclePts.push(new THREE.Vector3(x, y, z));
  }

  const tentacleCurve = new THREE.CatmullRomCurve3(tentaclePts);
  const tentacleGeo = new THREE.TubeGeometry(tentacleCurve, 32, 0.0032, 8, false);
  const tentacleMesh = new THREE.Mesh(tentacleGeo, tentacleMat);
  tentacleMesh.name = `jellyfish_sinusoidal_tentacle_${t + 1}`;
  tentaclesGroup.add(tentacleMesh);
}

// Gentle bioluminescent pulsing animation
function animate(t) {
  const pulse = Math.sin(t * 2.2);
  bellGroup.scale.set(1.0 + pulse * 0.04, 1.0 - pulse * 0.03, 1.0 + pulse * 0.04);
  oralArmsGroup.rotation.y = Math.sin(t * 0.6) * 0.12;
  tentaclesGroup.rotation.y = Math.cos(t * 0.5) * 0.08;
}

// Camera Framing (height ~0.92m, width ~0.56m, center ~0.46m)
camera.position.set(0.0, 0.48, 1.25);
camera.lookAt(0, 0.46, 0);
