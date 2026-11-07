const octopusSceneRoot = new THREE.Group();
octopusSceneRoot.name = "octopus_on_sunken_amphora_root";
scene.add(octopusSceneRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunFilteredLight = new THREE.DirectionalLight(0xb8f2ff, 1.35);
sunFilteredLight.name = "underwater_filtered_sun_light";
sunFilteredLight.position.set(1.4, 2.5, 1.6);
scene.add(sunFilteredLight);

const warmCoralFill = new THREE.PointLight(0xff8c69, 0.85, 4.0);
warmCoralFill.name = "warm_reef_fill_light";
warmCoralFill.position.set(-1.0, 0.8, 0.9);
scene.add(warmCoralFill);

// Materials
const octopusSkinMat = new THREE.MeshStandardMaterial({
  color: 0xc83228,
  roughness: 0.32,
  metalness: 0.05
});

const octopusUndersideMat = new THREE.MeshStandardMaterial({
  color: 0xe26d5c,
  roughness: 0.38,
  metalness: 0.04
});

const suctionCupMat = new THREE.MeshStandardMaterial({
  color: 0xfdf6ec,
  roughness: 0.42,
  metalness: 0.02
});

const eyeIrisMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  roughness: 0.15,
  metalness: 0.1
});

const pupilMat = new THREE.MeshStandardMaterial({
  color: 0x09090b,
  roughness: 0.1
});

const amphoraClayMat = new THREE.MeshStandardMaterial({
  color: 0xa8583b,
  roughness: 0.78,
  metalness: 0.04
});

const amphoraInteriorMat = new THREE.MeshStandardMaterial({
  color: 0x5c2c1d,
  roughness: 0.9
});

const seabedSandMat = new THREE.MeshStandardMaterial({
  color: 0xc2b280,
  roughness: 0.92,
  metalness: 0.02
});

// 1. Sandy Seabed Base & Broken Sunken Amphora (resting at y = 0)
const seabedGroup = new THREE.Group();
seabedGroup.name = "sunken_amphora_seabed_group";
octopusSceneRoot.add(seabedGroup);

const sandBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.50, 0.54, 0.04, 36),
  seabedSandMat
);
sandBase.name = "seabed_sand_mound";
sandBase.position.set(0, 0.02, 0);
seabedGroup.add(sandBase);

// Tilted Broken Sunken Amphora Vessel
const amphoraGroup = new THREE.Group();
amphoraGroup.name = "broken_sunken_amphora_group";
amphoraGroup.position.set(-0.04, 0.15, -0.02);
amphoraGroup.rotation.set(0.18, 0.25, 1.18);
seabedGroup.add(amphoraGroup);

// Main bulbous amphora belly
const amphoraBelly = new THREE.Mesh(
  new THREE.SphereGeometry(0.155, 24, 20),
  amphoraClayMat
);
amphoraBelly.name = "sunken_amphora_belly";
amphoraBelly.scale.set(1.0, 1.38, 1.0);
amphoraGroup.add(amphoraBelly);

// Dark interior cavity visible at the broken side/neck
const amphoraCavity = new THREE.Mesh(
  new THREE.SphereGeometry(0.142, 20, 16),
  amphoraInteriorMat
);
amphoraCavity.name = "sunken_amphora_hollow_interior";
amphoraCavity.scale.set(0.96, 1.32, 0.96);
amphoraCavity.position.set(0.015, 0.02, 0.015);
amphoraGroup.add(amphoraCavity);

// Conical bottom toe spike of the ancient transport amphora
const amphoraToe = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.018, 0.14, 16),
  amphoraClayMat
);
amphoraToe.name = "sunken_amphora_basal_toe";
amphoraToe.position.set(0, -0.23, 0);
amphoraGroup.add(amphoraToe);

// Cylindrical neck & rolled rim
const amphoraNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.068, 0.082, 0.14, 20),
  amphoraClayMat
);
amphoraNeck.name = "sunken_amphora_neck";
amphoraNeck.position.set(0, 0.22, 0);
amphoraGroup.add(amphoraNeck);

const amphoraRim = new THREE.Mesh(
  new THREE.CylinderGeometry(0.082, 0.072, 0.028, 20),
  amphoraClayMat
);
amphoraRim.name = "sunken_amphora_lip_rim";
amphoraRim.position.set(0, 0.285, 0);
amphoraGroup.add(amphoraRim);

// Amphora curved loop handles
[-1, 1].forEach((side) => {
  const hCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.11, 0.12, 0),
    new THREE.Vector3(side * 0.15, 0.19, 0),
    new THREE.Vector3(side * 0.13, 0.26, 0),
    new THREE.Vector3(side * 0.07, 0.26, 0)
  ]);
  const hMesh = new THREE.Mesh(
    new THREE.TubeGeometry(hCurve, 16, 0.016, 10, false),
    amphoraClayMat
  );
  hMesh.name = `sunken_amphora_handle_${side < 0 ? "left" : "right"}`;
  amphoraGroup.add(hMesh);
});

// Broken ceramic shards lying on the sand beside the amphora
const shardPositions = [
  { name: "ceramic_shard_1", pos: [0.22, 0.045, 0.18], rot: [0.4, 0.8, -0.2], scale: [0.09, 0.015, 0.07] },
  { name: "ceramic_shard_2", pos: [0.14, 0.042, 0.26], rot: [-0.3, 1.4, 0.2], scale: [0.07, 0.014, 0.06] },
  { name: "ceramic_shard_3", pos: [-0.26, 0.044, 0.16], rot: [0.2, -0.6, 0.3], scale: [0.08, 0.014, 0.065] }
];
shardPositions.forEach((sh) => {
  const shardMesh = new THREE.Mesh(new THREE.SphereGeometry(1.0, 10, 8), amphoraClayMat);
  shardMesh.name = sh.name;
  shardMesh.position.set(sh.pos[0], sh.pos[1], sh.pos[2]);
  shardMesh.rotation.set(sh.rot[0], sh.rot[1], sh.rot[2]);
  shardMesh.scale.set(sh.scale[0], sh.scale[1], sh.scale[2]);
  seabedGroup.add(shardMesh);
});

// 2. Giant Pacific Octopus Bulbous Mantle Head, Siphon & Prominent Eyes
const octopusGroup = new THREE.Group();
octopusGroup.name = "giant_pacific_octopus_group";
octopusSceneRoot.add(octopusGroup);

const headCenter = new THREE.Vector3(-0.02, 0.31, -0.02);

// Bulbous muscular mantle sac arching backward and upward
const mantleGroup = new THREE.Group();
mantleGroup.name = "octopus_mantle_and_head_group";
mantleGroup.position.copy(headCenter);
octopusGroup.add(mantleGroup);

const mantleMain = new THREE.Mesh(
  new THREE.SphereGeometry(0.145, 28, 22),
  octopusSkinMat
);
mantleMain.name = "octopus_bulbous_mantle_sac";
mantleMain.position.set(-0.05, 0.11, -0.08);
mantleMain.scale.set(1.05, 1.35, 1.25);
mantleMain.rotation.set(-0.45, 0.15, 0.2);
mantleGroup.add(mantleMain);

// Texture warts/ridges on dorsal mantle
const papillaOffsets = [
  [-0.08, 0.22, -0.10],
  [-0.01, 0.24, -0.06],
  [-0.11, 0.16, -0.16],
  [0.03, 0.18, -0.14]
];
papillaOffsets.forEach(([px, py, pz], i) => {
  const papilla = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 10),
    octopusSkinMat
  );
  papilla.name = `octopus_mantle_papilla_ridge_${i + 1}`;
  papilla.position.set(px, py, pz);
  papilla.scale.set(0.8, 1.3, 0.8);
  mantleGroup.add(papilla);
});

// Central head dome & interbrachial web skirt
const headDome = new THREE.Mesh(
  new THREE.SphereGeometry(0.115, 24, 18),
  octopusSkinMat
);
headDome.name = "octopus_cranial_head_dome";
headDome.scale.set(1.15, 0.85, 1.1);
mantleGroup.add(headDome);

// Tubular exhalant siphon funnel on the side of the mantle
const siphonFunnel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.036, 0.10, 16),
  octopusSkinMat
);
siphonFunnel.name = "octopus_siphon_funnel";
siphonFunnel.position.set(0.10, 0.04, -0.05);
siphonFunnel.rotation.set(0.35, 0.2, -0.75);
mantleGroup.add(siphonFunnel);

// Prominent raised eye turrets with horizontal rectangular pupils
[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  const turret = new THREE.Mesh(
    new THREE.SphereGeometry(0.038, 16, 14),
    octopusSkinMat
  );
  turret.name = `octopus_${prefix}_eye_turret`;
  turret.position.set(side * 0.082, 0.035, 0.055);
  mantleGroup.add(turret);

  const eyeball = new THREE.Mesh(
    new THREE.SphereGeometry(0.022, 14, 12),
    eyeIrisMat
  );
  eyeball.name = `octopus_${prefix}_eye_iris`;
  eyeball.position.set(side * 0.098, 0.040, 0.072);
  mantleGroup.add(eyeball);

  const pupil = new THREE.Mesh(
    new THREE.CylinderGeometry(0.006, 0.006, 0.024, 10),
    pupilMat
  );
  pupil.name = `octopus_${prefix}_horizontal_pupil`;
  pupil.position.set(side * 0.112, 0.040, 0.082);
  pupil.rotation.z = Math.PI / 2;
  pupil.rotation.y = -side * 0.5;
  mantleGroup.add(pupil);
});

// 3. Eight Curling Arms Lined with Two Rows of White Suction Cups (~1.0m span)
const armsGroup = new THREE.Group();
armsGroup.name = "octopus_eight_arms_group";
octopusGroup.add(armsGroup);

const armPaths = [
  // Arm 1: Front-left draping over amphora neck and coiling onto sand
  [
    new THREE.Vector3(-0.08, 0.29, 0.06),
    new THREE.Vector3(-0.18, 0.26, 0.16),
    new THREE.Vector3(-0.30, 0.12, 0.25),
    new THREE.Vector3(-0.42, 0.055, 0.28),
    new THREE.Vector3(-0.46, 0.065, 0.18),
    new THREE.Vector3(-0.39, 0.08, 0.14)
  ],
  // Arm 2: Front-right sweeping over broken amphora belly toward viewer
  [
    new THREE.Vector3(0.06, 0.29, 0.07),
    new THREE.Vector3(0.16, 0.24, 0.18),
    new THREE.Vector3(0.28, 0.11, 0.28),
    new THREE.Vector3(0.39, 0.055, 0.30),
    new THREE.Vector3(0.45, 0.07, 0.20),
    new THREE.Vector3(0.38, 0.09, 0.15)
  ],
  // Arm 3: Mid-left gripping amphora shoulder and curling outward
  [
    new THREE.Vector3(-0.12, 0.28, 0.00),
    new THREE.Vector3(-0.25, 0.22, 0.02),
    new THREE.Vector3(-0.38, 0.09, 0.04),
    new THREE.Vector3(-0.47, 0.055, -0.04),
    new THREE.Vector3(-0.43, 0.08, -0.14)
  ],
  // Arm 4: Mid-right wrapping around amphora rim & handle
  [
    new THREE.Vector3(0.10, 0.28, 0.01),
    new THREE.Vector3(0.24, 0.25, 0.03),
    new THREE.Vector3(0.36, 0.12, 0.04),
    new THREE.Vector3(0.46, 0.055, -0.02),
    new THREE.Vector3(0.42, 0.08, -0.12)
  ],
  // Arm 5: Back-left coiling along seabed behind amphora
  [
    new THREE.Vector3(-0.11, 0.27, -0.06),
    new THREE.Vector3(-0.24, 0.19, -0.16),
    new THREE.Vector3(-0.35, 0.07, -0.24),
    new THREE.Vector3(-0.42, 0.055, -0.32),
    new THREE.Vector3(-0.34, 0.07, -0.38)
  ],
  // Arm 6: Back-right coiling along seabed
  [
    new THREE.Vector3(0.09, 0.27, -0.06),
    new THREE.Vector3(0.22, 0.18, -0.16),
    new THREE.Vector3(0.34, 0.07, -0.25),
    new THREE.Vector3(0.41, 0.055, -0.33),
    new THREE.Vector3(0.33, 0.07, -0.39)
  ],
  // Arm 7: Center-front exploring shard on sand
  [
    new THREE.Vector3(-0.02, 0.28, 0.08),
    new THREE.Vector3(-0.04, 0.18, 0.22),
    new THREE.Vector3(0.02, 0.07, 0.34),
    new THREE.Vector3(0.11, 0.055, 0.41),
    new THREE.Vector3(0.16, 0.08, 0.36)
  ],
  // Arm 8: Rear anchor arm braced behind mantle
  [
    new THREE.Vector3(0.00, 0.26, -0.09),
    new THREE.Vector3(-0.03, 0.16, -0.24),
    new THREE.Vector3(0.02, 0.065, -0.36),
    new THREE.Vector3(0.10, 0.055, -0.43),
    new THREE.Vector3(0.04, 0.07, -0.46)
  ]
];

armPaths.forEach((pts, aIdx) => {
  const armSubGroup = new THREE.Group();
  armSubGroup.name = `octopus_arm_${aIdx + 1}_group`;
  armsGroup.add(armSubGroup);

  const fullCurve = new THREE.CatmullRomCurve3(pts);

  // Build arm in 3 tapered tube segments (proximal, medial, distal tip) for organic tapering
  const segRanges = [
    { start: 0.0, end: 0.42, radius: 0.034, tag: "proximal" },
    { start: 0.36, end: 0.74, radius: 0.023, tag: "medial" },
    { start: 0.68, end: 1.0, radius: 0.012, tag: "distal" }
  ];

  segRanges.forEach((seg) => {
    const subPts = [];
    for (let k = 0; k <= 8; k++) {
      const u = seg.start + (k / 8) * (seg.end - seg.start);
      subPts.push(fullCurve.getPoint(u));
    }
    const subCurve = new THREE.CatmullRomCurve3(subPts);
    const subTube = new THREE.Mesh(
      new THREE.TubeGeometry(subCurve, 18, seg.radius, 12, false),
      octopusSkinMat
    );
    subTube.name = `octopus_arm_${aIdx + 1}_${seg.tag}_segment`;
    armSubGroup.add(subTube);
  });

  // Two staggered rows of white cylindrical suction cups along the underside of each arm
  const numCupPairs = 9;
  for (let c = 0; c < numCupPairs; c++) {
    const u = 0.10 + (c / numCupPairs) * 0.80;
    const pt = fullCurve.getPoint(u);
    const tangent = fullCurve.getTangent(u);
    const armRadius = 0.034 * (1.0 - u * 0.62);
    const cupRadius = Math.max(0.0045, 0.0105 * (1.0 - u * 0.55));

    // Lateral vector perpendicular to arm tangent in XZ plane for staggered double row
    const latX = -tangent.z;
    const latZ = tangent.x;
    const latLen = Math.max(0.001, Math.sqrt(latX * latX + latZ * latZ));
    const nx = latX / latLen;
    const nz = latZ / latLen;

    [-1, 1].forEach((rowSide, rIdx) => {
      const cupMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(cupRadius, cupRadius * 0.8, 0.009, 10),
        suctionCupMat
      );
      cupMesh.name = `octopus_arm_${aIdx + 1}_suction_cup_pair_${c + 1}_${rIdx + 1}`;
      cupMesh.position.set(
        pt.x + nx * rowSide * armRadius * 0.48,
        Math.max(0.042, pt.y - armRadius * 0.72),
        pt.z + nz * rowSide * armRadius * 0.48
      );
      cupMesh.rotation.z = rowSide * 0.35;
      armSubGroup.add(cupMesh);
    });
  }
});

// Camera Framing (width ~1.0m, height ~0.50m, bounding radius ~0.56m)
camera.position.set(0.12, 0.54, 1.25);
camera.lookAt(0, 0.22, 0);
