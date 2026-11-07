// mat_07: Procedural Wood-Grain & Epoxy River Dining Table
const root = new THREE.Group();
root.name = "EpoxyRiverDiningTableRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "TableAmbientLight";
scene.add(ambientLight);

const mainDirLight = new THREE.DirectionalLight(0xfffbf2, 1.5);
mainDirLight.name = "DiningKeyDirectionalLight";
mainDirLight.position.set(2.2, 3.2, 2.0);
scene.add(mainDirLight);

const riverUnderGlow = new THREE.PointLight(0x22e5ff, 1.4, 3.0);
riverUnderGlow.name = "EpoxyRiverAccentLight";
riverUnderGlow.position.set(0.0, 0.6, 0.0);
scene.add(riverUnderGlow);

// Procedural Wood-Grain DataTexture (128x128 RGBA)
const texW = 128;
const texH = 128;
const woodData = new Uint8Array(texW * texH * 4);
for (let y = 0; y < texH; y++) {
  for (let x = 0; x < texW; x++) {
    const idx = (y * texW + x) * 4;
    const u = x / texW;
    const v = y / texH;
    // Concentric wavy growth rings + fine fiber streak modulation
    const knotDist = Math.hypot((u - 0.35) * 2.2, (v - 0.5) * 0.7);
    const wave = Math.sin(knotDist * 42.0 + Math.sin(v * 18.0) * 1.8) * 0.5 + 0.5;
    const streak = Math.sin(v * 160.0 + u * 12.0) * 0.08;
    const tone = Math.max(0, Math.min(1, wave * 0.75 + streak + 0.15));

    // Rich dark American Black Walnut palette
    woodData[idx + 0] = Math.round(58 + tone * 74); // R
    woodData[idx + 1] = Math.round(34 + tone * 46); // G
    woodData[idx + 2] = Math.round(18 + tone * 25); // B
    woodData[idx + 3] = 255;
  }
}
const walnutTexture = new THREE.DataTexture(woodData, texW, texH, THREE.RGBAFormat);
walnutTexture.wrapS = THREE.RepeatWrapping;
walnutTexture.wrapT = THREE.RepeatWrapping;
walnutTexture.needsUpdate = true;

// Procedural Rough Bark DataTexture (64x64 RGBA)
const barkW = 64;
const barkH = 64;
const barkData = new Uint8Array(barkW * barkH * 4);
for (let y = 0; y < barkH; y++) {
  for (let x = 0; x < barkW; x++) {
    const idx = (y * barkW + x) * 4;
    const ridge = Math.sin(x * 0.9 + Math.cos(y * 0.4) * 2.0) * 0.5 + 0.5;
    barkData[idx + 0] = Math.round(35 + ridge * 32);
    barkData[idx + 1] = Math.round(22 + ridge * 20);
    barkData[idx + 2] = Math.round(12 + ridge * 12);
    barkData[idx + 3] = 255;
  }
}
const barkTexture = new THREE.DataTexture(barkData, barkW, barkH, THREE.RGBAFormat);
barkTexture.needsUpdate = true;

// Materials
const walnutWoodMat = new THREE.MeshPhysicalMaterial({
  color: 0xd9bfa3,
  map: walnutTexture,
  roughness: 0.25,
  metalness: 0.0,
  clearcoat: 0.75,
  clearcoatRoughness: 0.12
});

const liveBarkMat = new THREE.MeshStandardMaterial({
  color: 0x6b4c35,
  map: barkTexture,
  roughness: 0.88,
  metalness: 0.02
});

const turquoiseEpoxyMat = new THREE.MeshPhysicalMaterial({
  color: 0x18d8e6,
  roughness: 0.04,
  metalness: 0.0,
  transmission: 0.93,
  ior: 1.55,
  thickness: 0.065,
  attenuationColor: 0x00687a,
  attenuationDistance: 0.09,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

const hairpinSteelMat = new THREE.MeshStandardMaterial({
  color: 0x22262b,
  metalness: 0.88,
  roughness: 0.28
});

// Tabletop Assembly at dining height y = 0.75m (2.0m long along X, 1.0m wide along Z, 0.06m thick)
const tabletopGroup = new THREE.Group();
tabletopGroup.name = "LiveEdgeTabletopGroup";
tabletopGroup.position.set(0, 0.75, 0);
root.add(tabletopGroup);

const slabThickness = 0.06;
const numSegments = 20;
const tableLength = 2.0;
const segLen = tableLength / numSegments;

// Build live-edge left and right walnut banks + inner meandering river channel
for (let i = 0; i < numSegments; i++) {
  const xCenter = -tableLength * 0.5 + (i + 0.5) * segLen;
  const t = i / (numSegments - 1);

  // Sinuous river center Z and river width along X
  const riverCenterZ = Math.sin(t * Math.PI * 2.1 - 0.4) * 0.11;
  const riverWidth = 0.24 + Math.cos(t * Math.PI * 3.0) * 0.055;

  // Natural outer live-edge Z extents (~ -0.50m to +0.50m)
  const outerFrontZ = 0.49 + Math.sin(t * Math.PI * 2.5 + 0.8) * 0.025;
  const outerBackZ = -0.49 + Math.cos(t * Math.PI * 2.2 - 0.5) * 0.025;

  const frontInnerEdge = riverCenterZ + riverWidth * 0.5;
  const backInnerEdge = riverCenterZ - riverWidth * 0.5;

  // Front Walnut Slab Segment
  const frontDepth = outerFrontZ - frontInnerEdge;
  const frontSlab = new THREE.Mesh(
    new THREE.BoxGeometry(segLen * 1.01, slabThickness, frontDepth),
    walnutWoodMat
  );
  frontSlab.name = "WalnutFrontSlabSeg_" + i;
  frontSlab.position.set(xCenter, 0, (outerFrontZ + frontInnerEdge) * 0.5);
  tabletopGroup.add(frontSlab);

  // Front outer live-edge rough bark bevel strip
  const frontBark = new THREE.Mesh(
    new THREE.CylinderGeometry(slabThickness * 0.52, slabThickness * 0.44, segLen * 1.02, 8),
    liveBarkMat
  );
  frontBark.name = "FrontOuterBarkEdge_" + i;
  frontBark.rotation.z = Math.PI / 2;
  frontBark.position.set(xCenter, -0.002, outerFrontZ);
  tabletopGroup.add(frontBark);

  // Front inner river bank bark contour
  const frontRiverBark = new THREE.Mesh(
    new THREE.CylinderGeometry(slabThickness * 0.46, slabThickness * 0.36, segLen * 1.02, 8),
    liveBarkMat
  );
  frontRiverBark.name = "FrontInnerRiverBark_" + i;
  frontRiverBark.rotation.z = Math.PI / 2;
  frontRiverBark.position.set(xCenter, -0.003, frontInnerEdge);
  tabletopGroup.add(frontRiverBark);

  // Back Walnut Slab Segment
  const backDepth = backInnerEdge - outerBackZ;
  const backSlab = new THREE.Mesh(
    new THREE.BoxGeometry(segLen * 1.01, slabThickness, backDepth),
    walnutWoodMat
  );
  backSlab.name = "WalnutBackSlabSeg_" + i;
  backSlab.position.set(xCenter, 0, (outerBackZ + backInnerEdge) * 0.5);
  tabletopGroup.add(backSlab);

  // Back outer live-edge rough bark bevel strip
  const backBark = new THREE.Mesh(
    new THREE.CylinderGeometry(slabThickness * 0.52, slabThickness * 0.44, segLen * 1.02, 8),
    liveBarkMat
  );
  backBark.name = "BackOuterBarkEdge_" + i;
  backBark.rotation.z = Math.PI / 2;
  backBark.position.set(xCenter, -0.002, outerBackZ);
  tabletopGroup.add(backBark);

  // Back inner river bank bark contour
  const backRiverBark = new THREE.Mesh(
    new THREE.CylinderGeometry(slabThickness * 0.46, slabThickness * 0.36, segLen * 1.02, 8),
    liveBarkMat
  );
  backRiverBark.name = "BackInnerRiverBark_" + i;
  backRiverBark.rotation.z = Math.PI / 2;
  backRiverBark.position.set(xCenter, -0.003, backInnerEdge);
  tabletopGroup.add(backRiverBark);

  // Translucent Turquoise Epoxy-Resin River Channel Segment (overlapping slightly into the live-edge banks)
  const epoxySeg = new THREE.Mesh(
    new THREE.BoxGeometry(segLen * 1.015, slabThickness * 0.98, riverWidth + 0.045),
    turquoiseEpoxyMat
  );
  epoxySeg.name = "TurquoiseEpoxyRiverSeg_" + i;
  epoxySeg.position.set(xCenter, 0, riverCenterZ);
  tabletopGroup.add(epoxySeg);
}

// 4 Hairpin Steel Legs (from y = 0 up to underside of tabletop y = 0.72m)
const legCorners = [
  { name: "FrontLeft", x: -0.82, z: 0.36, sx: -1, sz: 1 },
  { name: "FrontRight", x: 0.82, z: 0.36, sx: 1, sz: 1 },
  { name: "BackLeft", x: -0.82, z: -0.36, sx: -1, sz: -1 },
  { name: "BackRight", x: 0.82, z: -0.36, sx: 1, sz: -1 }
];

for (let c = 0; c < legCorners.length; c++) {
  const lc = legCorners[c];
  const legGroup = new THREE.Group();
  legGroup.name = "HairpinLegGroup_" + lc.name;
  root.add(legGroup);

  // Top L-shaped mounting plate under slab
  const mountPlate = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.008, 0.14),
    hairpinSteelMat
  );
  mountPlate.name = "HairpinMountPlate_" + lc.name;
  mountPlate.position.set(lc.x, 0.716, lc.z);
  legGroup.add(mountPlate);

  // Floor hairpin U-bend foot pad resting at y = 0.01
  const footX = lc.x + lc.sx * 0.06;
  const footZ = lc.z + lc.sz * 0.05;
  const footBend = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.024, 0.02, 16),
    hairpinSteelMat
  );
  footBend.name = "HairpinFootPad_" + lc.name;
  footBend.position.set(footX, 0.01, footZ);
  legGroup.add(footBend);

  // 3 converging steel hairpin rods per leg
  const rodStarts = [
    [lc.x - lc.sx * 0.04, lc.z + lc.sz * 0.03],
    [lc.x + lc.sx * 0.03, lc.z - lc.sz * 0.04],
    [lc.x + lc.sx * 0.02, lc.z + lc.sz * 0.02]
  ];
  for (let r = 0; r < rodStarts.length; r++) {
    const startVec = new THREE.Vector3(rodStarts[r][0], 0.715, rodStarts[r][1]);
    const endVec = new THREE.Vector3(footX, 0.015, footZ);
    const midPos = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const len = startVec.distanceTo(endVec);

    const rodMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0065, 0.0065, len, 10),
      hairpinSteelMat
    );
    rodMesh.name = "HairpinSteelRod_" + lc.name + "_" + r;
    rodMesh.position.copy(midPos);
    rodMesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      endVec.clone().sub(startVec).normalize()
    );
    legGroup.add(rodMesh);
  }
}

// Camera framing (~2.2x bounding radius ~1.18m -> distance ~2.55m)
camera.position.set(1.25, 1.55, 2.05);
camera.lookAt(0, 0.45, 0);
