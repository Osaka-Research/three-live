const cobraRoot = new THREE.Group();
cobraRoot.name = "coiled_king_cobra_root";
scene.add(cobraRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff1d6, 1.4);
sunLight.name = "key_sun_light";
sunLight.position.set(1.5, 2.4, 1.8);
scene.add(sunLight);

const rimLight = new THREE.PointLight(0xaad4ff, 0.75, 4.5);
rimLight.name = "rim_backlight";
rimLight.position.set(-1.2, 1.2, -1.4);
scene.add(rimLight);

// Procedural Reptilian Scales Texture
function createScaleTexture(baseR, baseG, baseB, bandR, bandG, bandB) {
  const width = 128;
  const height = 128;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const idx = (y * width + x) * 4;
      // Diamond scale lattice
      const sU = (u * 18 + (Math.floor(v * 36) % 2) * 0.5) % 1.0;
      const sV = (v * 36) % 1.0;
      const edgeDist = Math.abs(sU - 0.5) + Math.abs(sV - 0.5);
      const scaleHighlight = edgeDist > 0.44 ? 0.65 : 1.0 - edgeDist * 0.35;

      // Cross-band chevron pattern along body length
      const bandMask = Math.sin(u * Math.PI * 8.0) > 0.55 ? 1.0 : 0.0;
      const r = (baseR * (1 - bandMask) + bandR * bandMask) * scaleHighlight;
      const g = (baseG * (1 - bandMask) + bandG * bandMask) * scaleHighlight;
      const b = (baseB * (1 - bandMask) + bandB * bandMask) * scaleHighlight;

      data[idx] = Math.min(255, Math.max(0, Math.floor(r)));
      data[idx + 1] = Math.min(255, Math.max(0, Math.floor(g)));
      data[idx + 2] = Math.min(255, Math.max(0, Math.floor(b)));
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const dorsalScaleTex = createScaleTexture(68, 58, 38, 165, 138, 86);

const bodyMat = new THREE.MeshStandardMaterial({
  map: dorsalScaleTex,
  roughness: 0.38,
  metalness: 0.08
});

const bellyScuteMat = new THREE.MeshStandardMaterial({
  color: 0xd4be88,
  roughness: 0.42,
  metalness: 0.05
});

const hoodMarkingMat = new THREE.MeshStandardMaterial({
  color: 0x1c1813,
  roughness: 0.35,
  metalness: 0.06
});

const mouthInteriorMat = new THREE.MeshStandardMaterial({
  color: 0xb83b44,
  roughness: 0.45,
  metalness: 0.02
});

const fangMat = new THREE.MeshStandardMaterial({
  color: 0xf7f4eb,
  roughness: 0.18,
  metalness: 0.05
});

const eyeGoldMat = new THREE.MeshStandardMaterial({
  color: 0xe6a822,
  roughness: 0.12,
  metalness: 0.2
});

const pupilMat = new THREE.MeshStandardMaterial({
  color: 0x0a0a0a,
  roughness: 0.1,
  metalness: 0.1
});

// 1. Two Stacked Ground Coils + S-Curved Raised Neck (y = 0 to y = 0.78m)
// Build smooth continuous curve broken into tapered segments for natural anatomy
const coilLowerPoints = [];
// Tail tip inside/behind coil
coilLowerPoints.push(new THREE.Vector3(-0.06, 0.018, -0.05));
coilLowerPoints.push(new THREE.Vector3(-0.15, 0.025, -0.14));
// Bottom outer coil 1 (radius ~0.25m, resting on y=0 with tube radius 0.044m)
for (let i = 0; i <= 16; i++) {
  const angle = -Math.PI * 0.75 + (i / 16) * (Math.PI * 2.05);
  const r = 0.23 - (i / 16) * 0.025;
  const y = 0.044 + (i / 16) * 0.032;
  coilLowerPoints.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
}

const lowerCoilCurve = new THREE.CatmullRomCurve3(coilLowerPoints);
const lowerCoilMesh = new THREE.Mesh(
  new THREE.TubeGeometry(lowerCoilCurve, 64, 0.044, 18, false),
  bodyMat
);
lowerCoilMesh.name = "cobra_lower_ground_coil";
cobraRoot.add(lowerCoilMesh);

// Tapered tail tip segment
const tailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.24, 0.014, -0.02),
  new THREE.Vector3(-0.18, 0.018, -0.10),
  new THREE.Vector3(-0.06, 0.022, -0.05)
]);
const tailMesh = new THREE.Mesh(
  new THREE.TubeGeometry(tailCurve, 20, 0.022, 12, false),
  bodyMat
);
tailMesh.name = "cobra_tapered_tail";
cobraRoot.add(tailMesh);

// Upper stacked coil 2 rising into the S-curved neck
const upperCoilAndNeckPoints = [];
for (let i = 0; i <= 12; i++) {
  const angle = Math.PI * 1.3 + (i / 12) * (Math.PI * 1.65);
  const r = 0.19 - (i / 12) * 0.05;
  const y = 0.076 + (i / 12) * 0.064;
  upperCoilAndNeckPoints.push(new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r));
}
// S-curved strike column rising from y=0.14 to y=0.73
upperCoilAndNeckPoints.push(new THREE.Vector3(0.02, 0.22, -0.06));
upperCoilAndNeckPoints.push(new THREE.Vector3(0.00, 0.34, 0.04));
upperCoilAndNeckPoints.push(new THREE.Vector3(0.00, 0.48, -0.06));
upperCoilAndNeckPoints.push(new THREE.Vector3(0.00, 0.62, -0.02));
upperCoilAndNeckPoints.push(new THREE.Vector3(0.00, 0.72, 0.05));

const neckCurve = new THREE.CatmullRomCurve3(upperCoilAndNeckPoints);
const upperCoilNeckMesh = new THREE.Mesh(
  new THREE.TubeGeometry(neckCurve, 72, 0.036, 18, false),
  bodyMat
);
upperCoilNeckMesh.name = "cobra_upper_coil_and_s_neck";
cobraRoot.add(upperCoilNeckMesh);

// 2. Flared Flattened Hood via Custom Indexed BufferGeometry (y = 0.42 to y = 0.73)
function createFlaredHoodGeometry() {
  const rows = 24;
  const radialSegs = 24;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const y = 0.42 + v * 0.30;
    // S-curve Z offset matching the upper neck
    const zCenter = -0.06 * Math.sin(v * Math.PI) + v * 0.05;
    // Flared hood width profile (widest at v ~ 0.68)
    const hoodFlare = Math.sin(Math.pow(v, 0.8) * Math.PI);
    const halfWidth = 0.036 + 0.095 * hoodFlare;
    const halfThickness = 0.026 * (1.0 - 0.35 * hoodFlare);

    for (let j = 0; j <= radialSegs; j++) {
      const u = j / radialSegs;
      const theta = u * Math.PI * 2.0;
      const x = Math.cos(theta) * halfWidth;
      // Cupped forward-facing hood concavity
      const cupZ = -0.018 * hoodFlare * Math.cos(theta * 2.0);
      const z = zCenter + Math.sin(theta) * halfThickness + cupZ;

      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * (radialSegs + 1) + j;
      const b = a + radialSegs + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const hoodMesh = new THREE.Mesh(createFlaredHoodGeometry(), bodyMat);
hoodMesh.name = "cobra_flared_hood_mesh";
cobraRoot.add(hoodMesh);

// Ventral Belly Scute Plates along the Front of the Hood
for (let i = 0; i < 9; i++) {
  const v = (i + 1) / 10;
  const y = 0.44 + v * 0.26;
  const zCenter = -0.06 * Math.sin(v * Math.PI) + v * 0.05;
  const hoodFlare = Math.sin(Math.pow(v, 0.8) * Math.PI);
  const scuteWidth = 0.045 + 0.048 * hoodFlare;

  const scuteGeo = new THREE.BoxGeometry(scuteWidth, 0.022, 0.012);
  const scuteMesh = new THREE.Mesh(scuteGeo, i === 3 || i === 6 ? hoodMarkingMat : bellyScuteMat);
  scuteMesh.name = `cobra_ventral_hood_scute_${i + 1}`;
  scuteMesh.position.set(0, y, zCenter + 0.022);
  cobraRoot.add(scuteMesh);
}

// Dorsal Chevron / Spectacle Markings on Back of Hood
const dorsalChevronCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.085, 0.60, -0.048),
  new THREE.Vector3(-0.045, 0.56, -0.052),
  new THREE.Vector3(0.000, 0.61, -0.055),
  new THREE.Vector3(0.045, 0.56, -0.052),
  new THREE.Vector3(0.085, 0.60, -0.048)
]);
const dorsalMarking = new THREE.Mesh(
  new THREE.TubeGeometry(dorsalChevronCurve, 24, 0.011, 10, false),
  hoodMarkingMat
);
dorsalMarking.name = "cobra_dorsal_hood_chevron_marking";
cobraRoot.add(dorsalMarking);

// 3. Sculpted Head, Open Jaw, Fangs & Forked Tongue (at y = 0.73m)
const headGroup = new THREE.Group();
headGroup.name = "cobra_sculpted_head_group";
headGroup.position.set(0, 0.73, 0.065);
cobraRoot.add(headGroup);

// Upper cranium & snout
const craniumGeo = new THREE.SphereGeometry(0.048, 24, 18);
const cranium = new THREE.Mesh(craniumGeo, bodyMat);
cranium.name = "cobra_upper_cranium";
cranium.scale.set(1.05, 0.68, 1.45);
headGroup.add(cranium);

// Roof of mouth inside open jaws
const palateGeo = new THREE.SphereGeometry(0.038, 16, 12);
const palate = new THREE.Mesh(palateGeo, mouthInteriorMat);
palate.name = "cobra_mouth_palate";
palate.scale.set(0.95, 0.35, 1.3);
palate.position.set(0, -0.010, 0.012);
headGroup.add(palate);

// Supraocular brow scales & golden eyes with slit pupils
[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";

  const browGeo = new THREE.SphereGeometry(0.018, 14, 10);
  const brow = new THREE.Mesh(browGeo, bodyMat);
  brow.name = `cobra_${prefix}_brow_ridge`;
  brow.scale.set(0.8, 0.45, 1.6);
  brow.position.set(side * 0.036, 0.014, 0.022);
  brow.rotation.y = side * 0.25;
  headGroup.add(brow);

  const eyeGeo = new THREE.SphereGeometry(0.010, 16, 12);
  const eye = new THREE.Mesh(eyeGeo, eyeGoldMat);
  eye.name = `cobra_${prefix}_eye`;
  eye.position.set(side * 0.036, 0.006, 0.025);
  headGroup.add(eye);

  const pupilGeo = new THREE.SphereGeometry(0.006, 12, 10);
  const pupil = new THREE.Mesh(pupilGeo, pupilMat);
  pupil.name = `cobra_${prefix}_slit_pupil`;
  pupil.scale.set(0.45, 1.35, 0.8);
  pupil.position.set(side * 0.041, 0.006, 0.029);
  headGroup.add(pupil);

  // Curved venomous maxillary fang
  const fangCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.020, -0.008, 0.042),
    new THREE.Vector3(side * 0.019, -0.024, 0.046),
    new THREE.Vector3(side * 0.018, -0.036, 0.038)
  ]);
  const fangMesh = new THREE.Mesh(
    new THREE.TubeGeometry(fangCurve, 12, 0.0035, 8, false),
    fangMat
  );
  fangMesh.name = `cobra_${prefix}_venom_fang`;
  headGroup.add(fangMesh);
});

// Articulated Lower Mandible Jaw (open at strike angle)
const lowerJawGroup = new THREE.Group();
lowerJawGroup.name = "cobra_lower_jaw_group";
lowerJawGroup.position.set(0, -0.014, -0.015);
lowerJawGroup.rotation.x = 0.52;
headGroup.add(lowerJawGroup);

const jawGeo = new THREE.SphereGeometry(0.040, 20, 14);
const jawMesh = new THREE.Mesh(jawGeo, bellyScuteMat);
jawMesh.name = "cobra_lower_mandible";
jawMesh.scale.set(0.92, 0.42, 1.55);
jawMesh.position.set(0, -0.006, 0.032);
lowerJawGroup.add(jawMesh);

const jawFloorGeo = new THREE.SphereGeometry(0.034, 16, 12);
const jawFloor = new THREE.Mesh(jawFloorGeo, mouthInteriorMat);
jawFloor.name = "cobra_lower_mouth_floor";
jawFloor.scale.set(0.85, 0.30, 1.35);
jawFloor.position.set(0, 0.002, 0.032);
lowerJawGroup.add(jawFloor);

// Forked Crimson Tongue flickering out of the glottis
const tongueStemCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, -0.012, 0.020),
  new THREE.Vector3(0, -0.016, 0.065),
  new THREE.Vector3(0, -0.014, 0.098)
]);
const tongueStem = new THREE.Mesh(
  new THREE.TubeGeometry(tongueStemCurve, 16, 0.0028, 8, false),
  mouthInteriorMat
);
tongueStem.name = "cobra_tongue_stem";
headGroup.add(tongueStem);

[-1, 1].forEach((side) => {
  const forkCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.014, 0.095),
    new THREE.Vector3(side * 0.010, -0.012, 0.118),
    new THREE.Vector3(side * 0.018, -0.018, 0.136)
  ]);
  const forkMesh = new THREE.Mesh(
    new THREE.TubeGeometry(forkCurve, 12, 0.0018, 8, false),
    mouthInteriorMat
  );
  forkMesh.name = `cobra_tongue_fork_${side < 0 ? "left" : "right"}`;
  headGroup.add(forkMesh);
});

// Camera Framing (height ~0.78m, width ~0.55m, center ~0.39m)
camera.position.set(0.32, 0.46, 1.05);
camera.lookAt(0, 0.38, 0);
