// mat_06: Royal Velvet Jewelry Box with Sapphire Ring
const root = new THREE.Group();
root.name = "VelvetJewelryBoxRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "JewelryBoxAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xfff9f0, 1.4);
keyDirLight.name = "JewelryKeyDirectionalLight";
keyDirLight.position.set(0.6, 1.2, 0.8);
scene.add(keyDirLight);

const gemSpotPoint = new THREE.PointLight(0xdbeeff, 2.2, 1.5);
gemSpotPoint.name = "SapphireSparklePointLight";
gemSpotPoint.position.set(0.05, 0.25, 0.12);
scene.add(gemSpotPoint);

const warmRimPoint = new THREE.PointLight(0xffbb66, 1.4, 1.8);
warmRimPoint.name = "VelvetWarmRimLight";
warmRimPoint.position.set(-0.22, 0.22, -0.18);
scene.add(warmRimPoint);

// Materials
const crimsonVelvetMat = new THREE.MeshPhysicalMaterial({
  color: 0x6b0918,
  roughness: 0.88,
  metalness: 0.0,
  sheen: 1.0,
  sheenColor: 0xff6b8b,
  sheenRoughness: 0.28
});

const exteriorVelvetMat = new THREE.MeshPhysicalMaterial({
  color: 0x3d050e,
  roughness: 0.82,
  metalness: 0.0,
  sheen: 0.95,
  sheenColor: 0xd43b55,
  sheenRoughness: 0.35
});

const brassClaspMat = new THREE.MeshStandardMaterial({
  color: 0xd9a938,
  metalness: 0.9,
  roughness: 0.2
});

const platinumMat = new THREE.MeshPhysicalMaterial({
  color: 0xeef2f7,
  metalness: 0.98,
  roughness: 0.08,
  clearcoat: 0.5,
  clearcoatRoughness: 0.05
});

const blueSapphireMat = new THREE.MeshPhysicalMaterial({
  color: 0x0f52ba,
  roughness: 0.02,
  metalness: 0.0,
  transmission: 0.95,
  ior: 1.77,
  thickness: 0.035,
  attenuationColor: 0x06266f,
  attenuationDistance: 0.04,
  dispersion: 0.035,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01
});

const haloDiamondMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.01,
  metalness: 0.0,
  transmission: 0.98,
  ior: 2.417,
  thickness: 0.012,
  dispersion: 0.06,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01
});

// Octagonal Jewelry Box Lower Base (resting on y = 0, radius ~0.11m)
const baseGroup = new THREE.Group();
baseGroup.name = "OctagonalBoxBaseGroup";
root.add(baseGroup);

const octRadius = 0.11;
const baseHeight = 0.058;

const outerBase = new THREE.Mesh(
  new THREE.CylinderGeometry(octRadius, octRadius * 1.02, baseHeight, 8),
  exteriorVelvetMat
);
outerBase.name = "OctagonalOuterBaseShell";
outerBase.rotation.y = Math.PI / 8;
outerBase.position.set(0, baseHeight * 0.5, 0);
baseGroup.add(outerBase);

// Brass foot pads & 8 corner clasps + front lock plate
for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
  const cx = Math.cos(angle) * (octRadius * 0.99);
  const cz = Math.sin(angle) * (octRadius * 0.99);

  const cornerClasp = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.009, baseHeight + 0.002, 6),
    brassClaspMat
  );
  cornerClasp.name = "BrassCornerClasp_" + i;
  cornerClasp.position.set(cx, baseHeight * 0.5, cz);
  baseGroup.add(cornerClasp);
}

const brassRimTrim = new THREE.Mesh(
  new THREE.CylinderGeometry(octRadius * 1.01, octRadius * 1.01, 0.005, 8),
  brassClaspMat
);
brassRimTrim.name = "BrassBaseLipTrim";
brassRimTrim.rotation.y = Math.PI / 8;
brassRimTrim.position.set(0, baseHeight, 0);
baseGroup.add(brassRimTrim);

const frontLockHasps = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.012, 0.022, 16),
  brassClaspMat
);
frontLockHasps.name = "BrassFrontClaspLock";
frontLockHasps.rotation.x = Math.PI / 2;
frontLockHasps.position.set(0, baseHeight - 0.006, octRadius * 0.95);
baseGroup.add(frontLockHasps);

// Deep Crimson Velvet Interior Cushion & Ring Slot Rolls
const interiorBed = new THREE.Mesh(
  new THREE.CylinderGeometry(octRadius * 0.88, octRadius * 0.88, 0.018, 8),
  crimsonVelvetMat
);
interiorBed.name = "CrimsonVelvetInteriorBed";
interiorBed.rotation.y = Math.PI / 8;
interiorBed.position.set(0, baseHeight - 0.004, 0);
baseGroup.add(interiorBed);

for (let r = -1; r <= 1; r++) {
  if (r === 0) continue;
  const bolsterRoll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.13, 20),
    crimsonVelvetMat
  );
  bolsterRoll.name = "VelvetRingCushionRoll_" + (r < 0 ? "Back" : "Front");
  bolsterRoll.rotation.z = Math.PI / 2;
  bolsterRoll.position.set(0, baseHeight + 0.005, r * 0.021);
  baseGroup.add(bolsterRoll);
}

// Open Hinged Octagonal Lid (pivoted at back edge z = -octRadius * 0.92)
const lidGroup = new THREE.Group();
lidGroup.name = "HingedOctagonalLidGroup";
lidGroup.position.set(0, baseHeight, -octRadius * 0.92);
lidGroup.rotation.x = -1.25; // Open at ~72 degrees
root.add(lidGroup);

const brassHingeBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 0.065, 16),
  brassClaspMat
);
brassHingeBarrel.name = "BrassRearHingeBarrel";
brassHingeBarrel.rotation.z = Math.PI / 2;
lidGroup.add(brassHingeBarrel);

const lidCenterZ = octRadius * 0.92;
const lidShell = new THREE.Mesh(
  new THREE.CylinderGeometry(octRadius * 0.95, octRadius, 0.028, 8),
  exteriorVelvetMat
);
lidShell.name = "OctagonalLidOuterShell";
lidShell.rotation.y = Math.PI / 8;
lidShell.position.set(0, 0.014, lidCenterZ);
lidGroup.add(lidShell);

const lidVelvetLiner = new THREE.Mesh(
  new THREE.CylinderGeometry(octRadius * 0.86, octRadius * 0.88, 0.012, 8),
  crimsonVelvetMat
);
lidVelvetLiner.name = "CrimsonVelvetLidLining";
lidVelvetLiner.rotation.y = Math.PI / 8;
lidVelvetLiner.position.set(0, 0.005, lidCenterZ);
lidGroup.add(lidVelvetLiner);

const lidBrassTrim = new THREE.Mesh(
  new THREE.CylinderGeometry(octRadius * 1.01, octRadius * 1.01, 0.005, 8),
  brassClaspMat
);
lidBrassTrim.name = "BrassLidRimTrim";
lidBrassTrim.rotation.y = Math.PI / 8;
lidBrassTrim.position.set(0, 0.002, lidCenterZ);
lidGroup.add(lidBrassTrim);

// Platinum Solitaire Ring with Blue Sapphire & Halo Diamonds nestled in the velvet slot
const ringGroup = new THREE.Group();
ringGroup.name = "PlatinumSapphireRingGroup";
ringGroup.position.set(0, baseHeight + 0.014, 0.0);
root.add(ringGroup);

const ringBand = new THREE.Mesh(
  new THREE.TorusGeometry(0.026, 0.0038, 20, 48),
  platinumMat
);
ringBand.name = "PlatinumRingShank";
ringGroup.add(ringBand);

// Crown basket setting at top of the ring
const settingY = 0.028;
const galleryCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.017, 0.011, 0.008, 16),
  platinumMat
);
galleryCollar.name = "PlatinumGalleryBasket";
galleryCollar.position.set(0, settingY, 0);
ringGroup.add(galleryCollar);

// Central Blue Sapphire (Pavilion Cone + Crown Cylinder)
const sapphirePavilion = new THREE.Mesh(
  new THREE.ConeGeometry(0.0135, 0.012, 12),
  blueSapphireMat
);
sapphirePavilion.name = "BlueSapphirePavilion";
sapphirePavilion.rotation.x = Math.PI;
sapphirePavilion.position.set(0, settingY + 0.002, 0);
ringGroup.add(sapphirePavilion);

const sapphireCrown = new THREE.Mesh(
  new THREE.CylinderGeometry(0.009, 0.0135, 0.006, 12),
  blueSapphireMat
);
sapphireCrown.name = "BlueSapphireCrown";
sapphireCrown.position.set(0, settingY + 0.011, 0);
ringGroup.add(sapphireCrown);

// 4 Platinum Prongs holding the center sapphire
for (let p = 0; p < 4; p++) {
  const pa = (p / 4) * Math.PI * 2 + Math.PI / 4;
  const prong = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0014, 0.0018, 0.014, 8),
    platinumMat
  );
  prong.name = "SapphireProng_" + p;
  prong.position.set(Math.cos(pa) * 0.013, settingY + 0.006, Math.sin(pa) * 0.013);
  ringGroup.add(prong);
}

// Ring of 12 Halo Diamonds around the Sapphire
const haloCount = 12;
const haloRadius = 0.0165;
for (let h = 0; h < haloCount; h++) {
  const ha = (h / haloCount) * Math.PI * 2;
  const hx = Math.cos(ha) * haloRadius;
  const hz = Math.sin(ha) * haloRadius;

  const haloGem = new THREE.Mesh(
    new THREE.ConeGeometry(0.0032, 0.0045, 8),
    haloDiamondMat
  );
  haloGem.name = "HaloDiamond_" + h;
  haloGem.rotation.x = Math.PI;
  haloGem.position.set(hx, settingY + 0.005, hz);
  ringGroup.add(haloGem);

  const haloTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.002, 0.0032, 0.002, 8),
    haloDiamondMat
  );
  haloTop.name = "HaloDiamondCrown_" + h;
  haloTop.position.set(hx, settingY + 0.008, hz);
  ringGroup.add(haloTop);
}

// Camera framing (~2.2x bounding radius ~0.18m -> distance ~0.44m)
camera.position.set(0.18, 0.24, 0.36);
camera.lookAt(0, 0.09, -0.02);
