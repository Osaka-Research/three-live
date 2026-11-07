const heartModelRoot = new THREE.Group();
heartModelRoot.name = "anatomical_four_chamber_heart_root";
scene.add(heartModelRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.35);
keyLight.name = "medical_studio_key_light";
keyLight.position.set(1.0, 1.6, 1.4);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xdbeafe, 0.75, 3.5);
rimLight.name = "cool_anatomical_rim_light";
rimLight.position.set(-0.9, 0.8, -0.9);
scene.add(rimLight);

// Materials
const myocardiumMat = new THREE.MeshStandardMaterial({
  color: 0x99282c,
  roughness: 0.38,
  metalness: 0.06
});

const rightAtriumMat = new THREE.MeshStandardMaterial({
  color: 0x6e2b4b,
  roughness: 0.40,
  metalness: 0.05
});

const leftAtriumMat = new THREE.MeshStandardMaterial({
  color: 0xb03038,
  roughness: 0.38,
  metalness: 0.05
});

const arterialRedMat = new THREE.MeshStandardMaterial({
  color: 0xdc2626,
  roughness: 0.28,
  metalness: 0.08
});

const venousBlueMat = new THREE.MeshStandardMaterial({
  color: 0x2563eb,
  roughness: 0.30,
  metalness: 0.08
});

const pulmonaryTrunkMat = new THREE.MeshStandardMaterial({
  color: 0x4f46e5,
  roughness: 0.32,
  metalness: 0.06
});

const adiposeSulcusMat = new THREE.MeshStandardMaterial({
  color: 0xeab308,
  roughness: 0.48,
  metalness: 0.02
});

const vesselLumenMat = new THREE.MeshStandardMaterial({
  color: 0x3b0a0c,
  roughness: 0.85
});

const standBaseMat = new THREE.MeshStandardMaterial({
  color: 0xf1f5f9,
  roughness: 0.25,
  metalness: 0.1
});

const chromeRodMat = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.18,
  metalness: 0.9
});

// 1. Educational Display Stand (resting at y = 0, total model height ~0.42m)
const standGroup = new THREE.Group();
standGroup.name = "anatomical_display_stand_group";
heartModelRoot.add(standGroup);

const standBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.095, 0.105, 0.022, 32),
  standBaseMat
);
standBase.name = "display_stand_base_disk";
standBase.position.set(0, 0.011, 0);
standGroup.add(standBase);

const standCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.024, 0.018, 20),
  chromeRodMat
);
standCollar.name = "display_stand_rod_collar";
standCollar.position.set(0, 0.028, -0.01);
standGroup.add(standCollar);

const supportRod = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 0.14, 16),
  chromeRodMat
);
supportRod.name = "display_stand_support_rod";
supportRod.position.set(0, 0.095, -0.01);
standGroup.add(supportRod);

// 2. Four-Chamber Muscular Heart Body (y = 0.09m to y = 0.41m)
const heartGroup = new THREE.Group();
heartGroup.name = "four_chamber_heart_organ_group";
heartGroup.position.set(0, 0.21, 0);
heartModelRoot.add(heartGroup);

// Chamber 1: Left Ventricle (thick muscular chamber forming the cardiac apex pointing toward +X, -Y, +Z)
const leftVentricle = new THREE.Mesh(
  new THREE.SphereGeometry(0.072, 28, 22),
  myocardiumMat
);
leftVentricle.name = "chamber_left_ventricle";
leftVentricle.position.set(0.024, -0.025, 0.008);
leftVentricle.scale.set(0.88, 1.42, 0.92);
leftVentricle.rotation.z = 0.36;
leftVentricle.rotation.x = -0.15;
heartGroup.add(leftVentricle);

// Chamber 2: Right Ventricle (anterior/right muscular chamber)
const rightVentricle = new THREE.Mesh(
  new THREE.SphereGeometry(0.066, 26, 20),
  myocardiumMat
);
rightVentricle.name = "chamber_right_ventricle";
rightVentricle.position.set(-0.024, -0.015, 0.022);
rightVentricle.scale.set(0.92, 1.28, 0.88);
rightVentricle.rotation.z = 0.28;
heartGroup.add(rightVentricle);

// Chamber 3: Right Atrium & Scalloped Right Auricle (anatomical right = viewer left, -X)
const rightAtrium = new THREE.Mesh(
  new THREE.SphereGeometry(0.048, 22, 18),
  rightAtriumMat
);
rightAtrium.name = "chamber_right_atrium";
rightAtrium.position.set(-0.058, 0.048, 0.005);
rightAtrium.scale.set(0.95, 1.12, 0.95);
heartGroup.add(rightAtrium);

const rightAuricle = new THREE.Mesh(
  new THREE.SphereGeometry(0.032, 16, 14),
  rightAtriumMat
);
rightAuricle.name = "right_atrial_appendage_auricle";
rightAuricle.position.set(-0.042, 0.068, 0.038);
rightAuricle.scale.set(1.2, 0.75, 0.85);
heartGroup.add(rightAuricle);

// Chamber 4: Left Atrium & Left Auricle (posterior-superior left, +X)
const leftAtrium = new THREE.Mesh(
  new THREE.SphereGeometry(0.046, 22, 18),
  leftAtriumMat
);
leftAtrium.name = "chamber_left_atrium";
leftAtrium.position.set(0.045, 0.052, -0.022);
leftAtrium.scale.set(1.05, 0.95, 0.92);
heartGroup.add(leftAtrium);

const leftAuricle = new THREE.Mesh(
  new THREE.SphereGeometry(0.028, 16, 14),
  leftAtriumMat
);
leftAuricle.name = "left_atrial_appendage_auricle";
leftAuricle.position.set(0.058, 0.062, 0.024);
leftAuricle.scale.set(1.1, 0.72, 0.88);
heartGroup.add(leftAuricle);

// Epicardial Adipose Sulcus Pad along the Coronary & Interventricular Grooves
const sulcusFatCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.008, 0.045, 0.058),
  new THREE.Vector3(0.006, 0.005, 0.072),
  new THREE.Vector3(0.022, -0.045, 0.066),
  new THREE.Vector3(0.038, -0.088, 0.042)
]);
const sulcusFatMesh = new THREE.Mesh(
  new THREE.TubeGeometry(sulcusFatCurve, 20, 0.011, 8, false),
  adiposeSulcusMat
);
sulcusFatMesh.name = "anterior_interventricular_adipose_sulcus";
heartGroup.add(sulcusFatMesh);

// 3. Arching Red Aorta with Three Superior Arterial Branches
const aortaGroup = new THREE.Group();
aortaGroup.name = "aortic_arch_and_branches_group";
heartGroup.add(aortaGroup);

const aorticArchCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.005, 0.045, 0.012),  // Ascending aorta root
  new THREE.Vector3(-0.012, 0.105, 0.018), // Ascending aorta
  new THREE.Vector3(0.005, 0.145, 0.002),  // Peak of aortic arch
  new THREE.Vector3(0.038, 0.125, -0.028), // Posterior arch bend
  new THREE.Vector3(0.035, 0.055, -0.045)  // Descending thoracic aorta
]);
const aorticArchMesh = new THREE.Mesh(
  new THREE.TubeGeometry(aorticArchCurve, 32, 0.022, 16, false),
  arterialRedMat
);
aorticArchMesh.name = "arching_red_aorta";
aortaGroup.add(aorticArchMesh);

// Three Superior Branches of the Aortic Arch (Brachiocephalic, Left Common Carotid, Left Subclavian)
const superiorBranches = [
  {
    name: "aorta_branch_1_brachiocephalic_trunk",
    pos: [-0.010, 0.168, 0.012],
    rotZ: 0.16,
    r: 0.0095,
    h: 0.052
  },
  {
    name: "aorta_branch_2_left_common_carotid",
    pos: [0.008, 0.172, 0.002],
    rotZ: -0.04,
    r: 0.0075,
    h: 0.054
  },
  {
    name: "aorta_branch_3_left_subclavian_artery",
    pos: [0.026, 0.164, -0.012],
    rotZ: -0.22,
    r: 0.0080,
    h: 0.050
  }
];

superiorBranches.forEach((br) => {
  const branchCyl = new THREE.Mesh(
    new THREE.CylinderGeometry(br.r, br.r * 1.08, br.h, 14),
    arterialRedMat
  );
  branchCyl.name = br.name;
  branchCyl.position.set(br.pos[0], br.pos[1], br.pos[2]);
  branchCyl.rotation.z = br.rotZ;
  aortaGroup.add(branchCyl);

  const lumenCap = new THREE.Mesh(
    new THREE.CylinderGeometry(br.r * 0.68, br.r * 0.68, 0.004, 12),
    vesselLumenMat
  );
  lumenCap.name = `${br.name}_lumen_opening`;
  lumenCap.position.set(
    br.pos[0] - Math.sin(br.rotZ) * (br.h * 0.5),
    br.pos[1] + Math.cos(br.rotZ) * (br.h * 0.5),
    br.pos[2]
  );
  lumenCap.rotation.z = br.rotZ;
  aortaGroup.add(lumenCap);
});

// 4. Blue Superior & Inferior Vena Cava + Pulmonary Trunk
const venaCavaGroup = new THREE.Group();
venaCavaGroup.name = "vena_cava_and_pulmonary_vessels_group";
heartGroup.add(venaCavaGroup);

// Superior Vena Cava (CylinderGeometry entering right atrium from above)
const superiorVenaCava = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.020, 0.105, 16),
  venousBlueMat
);
superiorVenaCava.name = "superior_vena_cava_vessel";
superiorVenaCava.position.set(-0.056, 0.115, -0.005);
superiorVenaCava.rotation.z = 0.08;
venaCavaGroup.add(superiorVenaCava);

const svcLumen = new THREE.Mesh(
  new THREE.CylinderGeometry(0.013, 0.013, 0.005, 14),
  vesselLumenMat
);
svcLumen.name = "superior_vena_cava_lumen";
svcLumen.position.set(-0.060, 0.168, -0.005);
svcLumen.rotation.z = 0.08;
venaCavaGroup.add(svcLumen);

// Inferior Vena Cava entering right atrium from below
const inferiorVenaCava = new THREE.Mesh(
  new THREE.CylinderGeometry(0.019, 0.019, 0.065, 16),
  venousBlueMat
);
inferiorVenaCava.name = "inferior_vena_cava_vessel";
inferiorVenaCava.position.set(-0.048, -0.025, -0.032);
venaCavaGroup.add(inferiorVenaCava);

// Pulmonary Trunk curving up from right ventricle and bifurcating under aortic arch
const pulmonaryTrunkCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.015, 0.035, 0.042),
  new THREE.Vector3(0.008, 0.082, 0.035),
  new THREE.Vector3(0.032, 0.102, 0.008),
  new THREE.Vector3(0.068, 0.098, -0.012)
]);
const pulmonaryTrunkMesh = new THREE.Mesh(
  new THREE.TubeGeometry(pulmonaryTrunkCurve, 24, 0.019, 14, false),
  pulmonaryTrunkMat
);
pulmonaryTrunkMesh.name = "pulmonary_artery_trunk";
venaCavaGroup.add(pulmonaryTrunkMesh);

// 5. Branching Coronary Arteries & Cardiac Veins across the Ventricles
const coronaryGroup = new THREE.Group();
coronaryGroup.name = "branching_coronary_arteries_group";
heartGroup.add(coronaryGroup);

const coronaryPaths = [
  // Left Anterior Descending (LAD) coronary artery
  {
    name: "coronary_lad_main_artery",
    mat: arterialRedMat,
    r: 0.0042,
    pts: [
      new THREE.Vector3(0.002, 0.048, 0.056),
      new THREE.Vector3(0.008, 0.012, 0.078),
      new THREE.Vector3(0.020, -0.032, 0.076),
      new THREE.Vector3(0.035, -0.078, 0.058),
      new THREE.Vector3(0.048, -0.108, 0.032)
    ]
  },
  // Diagonal branch 1 off LAD across left ventricle
  {
    name: "coronary_diagonal_branch_1",
    mat: arterialRedMat,
    r: 0.0030,
    pts: [
      new THREE.Vector3(0.012, 0.002, 0.078),
      new THREE.Vector3(0.045, -0.018, 0.068),
      new THREE.Vector3(0.068, -0.045, 0.042)
    ]
  },
  // Diagonal branch 2 off LAD
  {
    name: "coronary_diagonal_branch_2",
    mat: arterialRedMat,
    r: 0.0026,
    pts: [
      new THREE.Vector3(0.025, -0.045, 0.072),
      new THREE.Vector3(0.055, -0.062, 0.052),
      new THREE.Vector3(0.068, -0.082, 0.028)
    ]
  },
  // Right Coronary Artery (RCA) & Acute Marginal Branch
  {
    name: "coronary_right_marginal_artery",
    mat: arterialRedMat,
    r: 0.0036,
    pts: [
      new THREE.Vector3(-0.028, 0.032, 0.052),
      new THREE.Vector3(-0.058, 0.002, 0.056),
      new THREE.Vector3(-0.062, -0.038, 0.048),
      new THREE.Vector3(-0.042, -0.072, 0.038)
    ]
  },
  // Great Cardiac Vein (Blue venous companion along the sulcus)
  {
    name: "great_cardiac_vein_vessel",
    mat: venousBlueMat,
    r: 0.0035,
    pts: [
      new THREE.Vector3(0.012, 0.045, 0.056),
      new THREE.Vector3(0.016, 0.008, 0.076),
      new THREE.Vector3(0.028, -0.035, 0.073),
      new THREE.Vector3(0.042, -0.078, 0.054)
    ]
  }
];

coronaryPaths.forEach((cp) => {
  const cCurve = new THREE.CatmullRomCurve3(cp.pts);
  const cMesh = new THREE.Mesh(
    new THREE.TubeGeometry(cCurve, 20, cp.r, 8, false),
    cp.mat
  );
  cMesh.name = cp.name;
  coronaryGroup.add(cMesh);
});

// Camera Framing (height ~0.41m, width ~0.22m, center ~0.21m)
camera.position.set(0.0, 0.24, 0.62);
camera.lookAt(0, 0.21, 0);
