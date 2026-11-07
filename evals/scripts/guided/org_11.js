const skullSceneRoot = new THREE.Group();
skullSceneRoot.name = "horned_dragon_skull_fossil_root";
scene.add(skullSceneRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff2d8, 1.4);
keyLight.name = "museum_key_light";
keyLight.position.set(1.5, 2.4, 1.8);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xd97706, 0.8, 4.5);
rimLight.name = "warm_fossil_rim_light";
rimLight.position.set(-1.2, 1.0, -1.2);
scene.add(rimLight);

// Materials
const boneIvoryMat = new THREE.MeshStandardMaterial({
  color: 0xe6dcc5,
  roughness: 0.58,
  metalness: 0.05
});

const darkFossilCreviceMat = new THREE.MeshStandardMaterial({
  color: 0xb8a98a,
  roughness: 0.72,
  metalness: 0.04
});

const hornKeratinMat = new THREE.MeshStandardMaterial({
  color: 0x4a3b2c,
  roughness: 0.65,
  metalness: 0.08
});

const toothEnamelMat = new THREE.MeshStandardMaterial({
  color: 0xf7f2e4,
  roughness: 0.25,
  metalness: 0.08
});

const plinthRockMat = new THREE.MeshStandardMaterial({
  color: 0x33363b,
  roughness: 0.88,
  metalness: 0.06
});

// 1. Rocky Plinth & Fossil Support Pedestal (resting at y = 0)
const plinthGroup = new THREE.Group();
plinthGroup.name = "rocky_plinth_group";
skullSceneRoot.add(plinthGroup);

const lowerRockSlab = new THREE.Mesh(
  new THREE.CylinderGeometry(0.32, 0.36, 0.06, 12),
  plinthRockMat
);
lowerRockSlab.name = "plinth_lower_rock_slab";
lowerRockSlab.position.set(0, 0.03, 0);
lowerRockSlab.scale.set(0.85, 1.0, 1.25);
plinthGroup.add(lowerRockSlab);

const upperRockMound = new THREE.Mesh(
  new THREE.CylinderGeometry(0.24, 0.30, 0.07, 10),
  plinthRockMat
);
upperRockMound.name = "plinth_upper_rock_mound";
upperRockMound.position.set(0, 0.09, -0.02);
upperRockMound.scale.set(0.8, 1.0, 1.2);
plinthGroup.add(upperRockMound);

// Support cradle pillars holding the fossil skull
const rearSupportPillar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.038, 0.16, 12),
  plinthRockMat
);
rearSupportPillar.name = "plinth_rear_cranium_support";
rearSupportPillar.position.set(0, 0.18, -0.10);
plinthGroup.add(rearSupportPillar);

const frontSupportPillar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.030, 0.12, 12),
  plinthRockMat
);
frontSupportPillar.name = "plinth_front_jaw_support";
frontSupportPillar.position.set(0, 0.15, 0.16);
plinthGroup.add(frontSupportPillar);

// 2. Weathered Ivory Dragon Skull (~0.9m total length from horn tips z=-0.46 to snout tip z=+0.44)
const skullGroup = new THREE.Group();
skullGroup.name = "dragon_skull_assembly_group";
skullGroup.position.set(0, 0.28, 0.02);
skullGroup.rotation.x = -0.08;
skullSceneRoot.add(skullGroup);

// Carve Cranium & Elongated Snout with Deep Eye Sockets and Nasal Cavity via CSG.subtract
// Keep segment counts <= 18 so CSG triangle count stays well below 4096
const rawCraniumMesh = new THREE.Mesh(
  new THREE.SphereGeometry(0.145, 18, 14),
  boneIvoryMat
);
rawCraniumMesh.scale.set(1.0, 0.78, 1.45);
rawCraniumMesh.position.set(0, 0.02, -0.06);
rawCraniumMesh.updateMatrix();

const leftEyeSocketCutter = new THREE.Mesh(
  new THREE.SphereGeometry(0.068, 14, 12),
  boneIvoryMat
);
leftEyeSocketCutter.position.set(-0.105, 0.025, -0.01);
leftEyeSocketCutter.updateMatrix();

const rightEyeSocketCutter = new THREE.Mesh(
  new THREE.SphereGeometry(0.068, 14, 12),
  boneIvoryMat
);
rightEyeSocketCutter.position.set(0.105, 0.025, -0.01);
rightEyeSocketCutter.updateMatrix();

let carvedCranium = THREE.CSG.subtract(rawCraniumMesh, leftEyeSocketCutter);
carvedCranium = THREE.CSG.subtract(carvedCranium, rightEyeSocketCutter);
carvedCranium.material = boneIvoryMat;
carvedCranium.name = "dragon_cranium_carved_eye_sockets";
skullGroup.add(carvedCranium);

// Elongated Upper Snout (Maxilla) with CSG-carved Nasal Aperture & Antorbital Fenestrae
const rawSnoutMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.058, 0.112, 0.38, 16),
  boneIvoryMat
);
rawSnoutMesh.rotation.x = Math.PI / 2;
rawSnoutMesh.scale.set(1.0, 1.0, 0.68);
rawSnoutMesh.position.set(0, -0.005, 0.21);
rawSnoutMesh.updateMatrix();

const nasalCavityCutter = new THREE.Mesh(
  new THREE.SphereGeometry(0.048, 12, 10),
  boneIvoryMat
);
nasalCavityCutter.scale.set(0.85, 0.7, 1.6);
nasalCavityCutter.position.set(0, 0.032, 0.34);
nasalCavityCutter.updateMatrix();

const carvedSnout = THREE.CSG.subtract(rawSnoutMesh, nasalCavityCutter);
carvedSnout.material = boneIvoryMat;
carvedSnout.name = "dragon_elongated_maxilla_snout";
skullGroup.add(carvedSnout);

// Sculpted Supraorbital Brow Ridges, Zygomatic Cheek Arches & Sagittal Crest
const sagittalCrestCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.038, 0.28),
  new THREE.Vector3(0, 0.068, 0.10),
  new THREE.Vector3(0, 0.105, -0.08),
  new THREE.Vector3(0, 0.095, -0.22)
]);
const sagittalCrest = new THREE.Mesh(
  new THREE.TubeGeometry(sagittalCrestCurve, 20, 0.018, 8, false),
  darkFossilCreviceMat
);
sagittalCrest.name = "dragon_sagittal_nasal_crest";
skullGroup.add(sagittalCrest);

[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";

  // Heavy orbital brow ridge over each eye socket
  const browCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.065, 0.055, 0.07),
    new THREE.Vector3(side * 0.115, 0.082, -0.01),
    new THREE.Vector3(side * 0.110, 0.068, -0.10)
  ]);
  const browMesh = new THREE.Mesh(
    new THREE.TubeGeometry(browCurve, 16, 0.019, 8, false),
    boneIvoryMat
  );
  browMesh.name = `dragon_${prefix}_orbital_brow_ridge`;
  skullGroup.add(browMesh);

  // Zygomatic jugal cheek bone arch with lateral spikes
  const cheekCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.082, -0.025, 0.08),
    new THREE.Vector3(side * 0.132, -0.020, -0.02),
    new THREE.Vector3(side * 0.125, -0.005, -0.14)
  ]);
  const cheekMesh = new THREE.Mesh(
    new THREE.TubeGeometry(cheekCurve, 16, 0.016, 8, false),
    darkFossilCreviceMat
  );
  cheekMesh.name = `dragon_${prefix}_zygomatic_cheek_arch`;
  skullGroup.add(cheekMesh);

  // Cheek frill bone spikes (ConeGeometry)
  for (let sp = 0; sp < 2; sp++) {
    const cheekSpike = new THREE.Mesh(
      new THREE.ConeGeometry(0.015, 0.065, 8),
      boneIvoryMat
    );
    cheekSpike.name = `dragon_${prefix}_cheek_frill_spike_${sp + 1}`;
    cheekSpike.position.set(side * 0.145, -0.01 + sp * 0.02, -0.10 - sp * 0.05);
    cheekSpike.rotation.set(-0.6, 0, -side * 1.1);
    skullGroup.add(cheekSpike);
  }
});

// 3. Swept-Back Ridged Horns (CatmullRomCurve3 + TubeGeometry + ConeGeometry)
[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  const hornGroup = new THREE.Group();
  hornGroup.name = `dragon_${prefix}_horn_group`;
  skullGroup.add(hornGroup);

  const hornPts = [
    new THREE.Vector3(side * 0.085, 0.085, -0.10),
    new THREE.Vector3(side * 0.145, 0.155, -0.22),
    new THREE.Vector3(side * 0.185, 0.215, -0.34),
    new THREE.Vector3(side * 0.155, 0.265, -0.44)
  ];
  const hornCurve = new THREE.CatmullRomCurve3(hornPts);

  // Proximal & mid horn shaft segments
  const hornProximal = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([hornPts[0], hornPts[1], hornPts[2]]),
      20,
      0.034,
      12,
      false
    ),
    hornKeratinMat
  );
  hornProximal.name = `dragon_${prefix}_horn_proximal_shaft`;
  hornGroup.add(hornProximal);

  // Sharp tapered horn tip (ConeGeometry)
  const hornTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.028, 0.16, 12),
    hornKeratinMat
  );
  hornTip.name = `dragon_${prefix}_horn_sharp_tip`;
  hornTip.position.set(side * 0.168, 0.242, -0.39);
  hornTip.rotation.set(-1.12, 0, side * 0.22);
  hornGroup.add(hornTip);

  // 7 Annular Keratin Ridges along each horn
  for (let r = 0; r < 7; r++) {
    const u = 0.08 + (r / 7) * 0.68;
    const pt = hornCurve.getPoint(u);
    const tangent = hornCurve.getTangent(u);
    const ringR = 0.038 * (1.0 - u * 0.35);

    const ridgeRing = new THREE.Mesh(
      new THREE.CylinderGeometry(ringR, ringR * 1.06, 0.016, 12),
      darkFossilCreviceMat
    );
    ridgeRing.name = `dragon_${prefix}_horn_annular_ridge_${r + 1}`;
    ridgeRing.position.copy(pt);
    ridgeRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    hornGroup.add(ridgeRing);
  }
});

// 4. Upper Row of Sharp Conical Teeth & Fangs (ConeGeometry)
const upperTeethGroup = new THREE.Group();
upperTeethGroup.name = "dragon_upper_teeth_group";
skullGroup.add(upperTeethGroup);

[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  for (let t = 0; t < 8; t++) {
    const frac = t / 7;
    const z = 0.08 + frac * 0.29;
    const x = side * (0.086 - frac * 0.036);
    const isCanine = t === 2 || t === 6;
    const toothLen = isCanine ? 0.052 : 0.032;
    const toothRad = isCanine ? 0.010 : 0.007;

    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(toothRad, toothLen, 8),
      toothEnamelMat
    );
    tooth.name = `dragon_upper_${prefix}_tooth_${t + 1}`;
    tooth.position.set(x, -0.042 - toothLen * 0.35, z);
    tooth.rotation.x = Math.PI - 0.12;
    tooth.rotation.z = side * 0.08;
    upperTeethGroup.add(tooth);
  }
});

// 5. Articulated Lower Mandible Jaw with Lower Teeth & Chin Spikes
const mandibleGroup = new THREE.Group();
mandibleGroup.name = "dragon_articulated_lower_mandible_group";
mandibleGroup.position.set(0, -0.045, -0.06);
mandibleGroup.rotation.x = 0.28; // Slightly hinged open
skullGroup.add(mandibleGroup);

[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  const jawRamusCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.095, 0.01, -0.02),
    new THREE.Vector3(side * 0.078, -0.025, 0.14),
    new THREE.Vector3(side * 0.052, -0.022, 0.30),
    new THREE.Vector3(0.0, -0.018, 0.42)
  ]);
  const jawRamusMesh = new THREE.Mesh(
    new THREE.TubeGeometry(jawRamusCurve, 24, 0.022, 10, false),
    boneIvoryMat
  );
  jawRamusMesh.name = `dragon_lower_mandible_ramus_${prefix}`;
  mandibleGroup.add(jawRamusMesh);

  // Lower row of interlocking conical teeth
  for (let t = 0; t < 7; t++) {
    const frac = t / 6;
    const pt = jawRamusCurve.getPoint(0.22 + frac * 0.72);
    const toothLen = t === 5 ? 0.042 : 0.026;
    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(0.0065, toothLen, 8),
      toothEnamelMat
    );
    tooth.name = `dragon_lower_${prefix}_tooth_${t + 1}`;
    tooth.position.set(pt.x, pt.y + 0.022, pt.z);
    tooth.rotation.x = 0.15;
    mandibleGroup.add(tooth);
  }
});

// Symphysis chin spike at the tip of the lower jaw
const chinSpike = new THREE.Mesh(
  new THREE.ConeGeometry(0.016, 0.055, 8),
  darkFossilCreviceMat
);
chinSpike.name = "dragon_mandible_chin_spike";
chinSpike.position.set(0, -0.042, 0.41);
chinSpike.rotation.x = Math.PI * 0.78;
mandibleGroup.add(chinSpike);

// Camera Framing (~0.9m long skull on plinth, height ~0.56m, bounding radius ~0.52m)
camera.position.set(0.75, 0.48, 0.92);
camera.lookAt(0, 0.27, 0);
