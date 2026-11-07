const willowSceneRoot = new THREE.Group();
willowSceneRoot.name = "weeping_willow_pond_root";
scene.add(willowSceneRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff6e0, 1.35);
sunLight.name = "golden_hour_sun_light";
sunLight.position.set(2.5, 4.0, 2.2);
scene.add(sunLight);

const pondFillLight = new THREE.PointLight(0xa7f3d0, 0.7, 6.0);
pondFillLight.name = "pond_water_reflection_light";
pondFillLight.position.set(0.3, 0.6, 0.4);
scene.add(pondFillLight);

// Materials
const barkMat = new THREE.MeshStandardMaterial({
  color: 0x4a3b2c,
  roughness: 0.9,
  metalness: 0.03
});

const vineStemMat = new THREE.MeshStandardMaterial({
  color: 0x6b7c32,
  roughness: 0.78,
  metalness: 0.02
});

const stoneMat = new THREE.MeshStandardMaterial({
  color: 0x787572,
  roughness: 0.85,
  metalness: 0.05
});

const mossBankMat = new THREE.MeshStandardMaterial({
  color: 0x3f6229,
  roughness: 0.92,
  metalness: 0.02
});

const pondBedMat = new THREE.MeshStandardMaterial({
  color: 0x16302b,
  roughness: 0.95
});

const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0x1d7068,
  roughness: 0.08,
  metalness: 0.1,
  transmission: 0.72,
  ior: 1.33,
  thickness: 0.15,
  clearcoat: 0.9,
  transparent: true,
  opacity: 0.88
});

// 1. Circular Stone-Rimmed Pond & Grassy Bank Mound (resting at y = 0)
const pondGroup = new THREE.Group();
pondGroup.name = "circular_stone_pond_group";
willowSceneRoot.add(pondGroup);

// Grassy bank island supporting the tree on the left (-X) and pond on the right (+X)
const bankMound = new THREE.Mesh(
  new THREE.CylinderGeometry(0.88, 0.96, 0.08, 36),
  mossBankMat
);
bankMound.name = "grassy_shore_mound";
bankMound.position.set(0, 0.04, 0);
pondGroup.add(bankMound);

// Circular pond basin centered at (0.28, 0.0, 0.12)
const pondX = 0.28;
const pondZ = 0.12;
const pondRadius = 0.52;

const pondBed = new THREE.Mesh(
  new THREE.CylinderGeometry(pondRadius, pondRadius, 0.06, 32),
  pondBedMat
);
pondBed.name = "pond_dark_basin_bed";
pondBed.position.set(pondX, 0.03, pondZ);
pondGroup.add(pondBed);

const waterSurface = new THREE.Mesh(
  new THREE.CylinderGeometry(pondRadius * 0.98, pondRadius * 0.98, 0.02, 32),
  waterMat
);
waterSurface.name = "pond_water_surface";
waterSurface.position.set(pondX, 0.075, pondZ);
pondGroup.add(waterSurface);

// Ring of 22 natural cobble stones around the circular pond rim
const numStones = 22;
for (let s = 0; s < numStones; s++) {
  const angle = (s / numStones) * Math.PI * 2.0;
  const r = pondRadius + 0.025;
  const sx = pondX + Math.cos(angle) * r;
  const sz = pondZ + Math.sin(angle) * r;
  const stoneW = 0.085 + (s % 3) * 0.015;
  const stoneH = 0.055 + (s % 2) * 0.015;

  const stoneMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(stoneW * 0.75, stoneW, stoneH, 9),
    stoneMat
  );
  stoneMesh.name = `pond_rim_cobble_stone_${s + 1}`;
  stoneMesh.position.set(sx, 0.06 + stoneH * 0.4, sz);
  stoneMesh.rotation.y = angle + s * 0.5;
  pondGroup.add(stoneMesh);
}

// 2. Furrowed Root-Flared Willow Trunk & Arching Primary Limbs (~2.4m tall)
const treeGroup = new THREE.Group();
treeGroup.name = "weeping_willow_tree_group";
willowSceneRoot.add(treeGroup);

const trunkBaseX = -0.32;
const trunkBaseZ = -0.10;

// Central core trunk cylinder
const coreTrunk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.11, 0.19, 1.25, 16),
  barkMat
);
coreTrunk.name = "willow_core_trunk";
coreTrunk.position.set(trunkBaseX + 0.05, 0.65, trunkBaseZ);
coreTrunk.rotation.z = -0.10;
treeGroup.add(coreTrunk);

// 6 Furrowed Root-Flared Bark Buttress Ridges twisting up the trunk
for (let r = 0; r < 6; r++) {
  const a0 = (r / 6) * Math.PI * 2.0;
  const a1 = a0 + 0.45;
  const ridgeCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(trunkBaseX + Math.cos(a0) * 0.28, 0.06, trunkBaseZ + Math.sin(a0) * 0.28),
    new THREE.Vector3(trunkBaseX + 0.02 + Math.cos(a0 + 0.15) * 0.16, 0.35, trunkBaseZ + Math.sin(a0 + 0.15) * 0.16),
    new THREE.Vector3(trunkBaseX + 0.06 + Math.cos(a1) * 0.12, 0.85, trunkBaseZ + Math.sin(a1) * 0.12),
    new THREE.Vector3(trunkBaseX + 0.10 + Math.cos(a1 + 0.2) * 0.10, 1.32, trunkBaseZ + Math.sin(a1 + 0.2) * 0.10)
  ]);
  const ridgeMesh = new THREE.Mesh(
    new THREE.TubeGeometry(ridgeCurve, 24, 0.045, 10, false),
    barkMat
  );
  ridgeMesh.name = `willow_trunk_furrow_buttress_${r + 1}`;
  treeGroup.add(ridgeMesh);
}

// 8 Arching Primary & Secondary Limbs (reaching up to y = 2.38m and arching out over pond)
const limbCrownOrigin = new THREE.Vector3(trunkBaseX + 0.10, 1.28, trunkBaseZ);
const limbAngles = [0.0, 0.72, 1.48, 2.25, 3.05, 3.85, 4.65, 5.45];
const vineAttachmentPoints = [];

limbAngles.forEach((angle, idx) => {
  // Limbs facing the pond (+X, +Z) reach slightly further out
  const reach = 0.68 + 0.18 * Math.cos(angle - 0.35);
  const peakY = 2.12 + (idx % 3) * 0.12;
  const tipY = 1.68 + (idx % 2) * 0.14;

  const p0 = limbCrownOrigin.clone();
  const p1 = new THREE.Vector3(
    p0.x + Math.cos(angle) * (reach * 0.35),
    1.78 + (idx % 2) * 0.08,
    p0.z + Math.sin(angle) * (reach * 0.35)
  );
  const p2 = new THREE.Vector3(
    p0.x + Math.cos(angle) * (reach * 0.72),
    peakY,
    p0.z + Math.sin(angle) * (reach * 0.72)
  );
  const p3 = new THREE.Vector3(
    p0.x + Math.cos(angle) * reach,
    tipY,
    p0.z + Math.sin(angle) * reach
  );

  const limbCurve = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
  const limbMesh = new THREE.Mesh(
    new THREE.TubeGeometry(limbCurve, 24, 0.042, 10, false),
    barkMat
  );
  limbMesh.name = `willow_arching_primary_limb_${idx + 1}`;
  treeGroup.add(limbMesh);

  // Sample attachment points along the upper/outer arch of each limb for weeping vines
  [0.45, 0.65, 0.82, 0.98].forEach((u, sIdx) => {
    const pt = limbCurve.getPoint(u);
    const sideSpread = (sIdx % 2 === 0 ? 1 : -1) * 0.08;
    vineAttachmentPoints.push(
      new THREE.Vector3(
        pt.x - Math.sin(angle) * sideSpread,
        pt.y,
        pt.z + Math.cos(angle) * sideSpread
      )
    );
  });

  // Secondary high crown sub-branch to bring canopy crest cleanly to ~2.40m
  if (idx % 2 === 0) {
    const subTop = new THREE.Vector3(
      p1.x + Math.cos(angle + 0.3) * 0.28,
      2.36,
      p1.z + Math.sin(angle + 0.3) * 0.28
    );
    const subTip = new THREE.Vector3(
      p1.x + Math.cos(angle + 0.35) * 0.52,
      2.05,
      p1.z + Math.sin(angle + 0.35) * 0.52
    );
    const subCurve = new THREE.CatmullRomCurve3([p1, subTop, subTip]);
    const subMesh = new THREE.Mesh(
      new THREE.TubeGeometry(subCurve, 18, 0.026, 8, false),
      barkMat
    );
    subMesh.name = `willow_upper_crown_bough_${idx + 1}`;
    treeGroup.add(subMesh);

    vineAttachmentPoints.push(subTop.clone());
    vineAttachmentPoints.push(subTip.clone());
  }
});

// 3. Cascading Curtain-Like Vine Strands & Instanced Narrow Willow Leaves
const vinesGroup = new THREE.Group();
vinesGroup.name = "cascading_willow_vines_group";
treeGroup.add(vinesGroup);

const leafTransforms = [];

vineAttachmentPoints.forEach((startPt, vIdx) => {
  // Hang length reaches down toward y = 0.22..0.48m (just above pond & bank)
  const bottomY = 0.24 + (vIdx % 5) * 0.06;
  const midY = (startPt.y + bottomY) * 0.5;
  const swayX = 0.04 * Math.sin(vIdx * 1.7);
  const swayZ = 0.04 * Math.cos(vIdx * 1.3);

  const vineCurve = new THREE.CatmullRomCurve3([
    startPt,
    new THREE.Vector3(startPt.x + swayX * 0.5, midY + 0.15, startPt.z + swayZ * 0.5),
    new THREE.Vector3(startPt.x + swayX, bottomY + 0.25, startPt.z + swayZ),
    new THREE.Vector3(startPt.x + swayX * 1.3, bottomY, startPt.z + swayZ * 1.3)
  ]);

  const vineMesh = new THREE.Mesh(
    new THREE.TubeGeometry(vineCurve, 16, 0.0045, 6, false),
    vineStemMat
  );
  vineMesh.name = `willow_cascading_vine_strand_${vIdx + 1}`;
  vinesGroup.add(vineMesh);

  // Collect 22 narrow leaf positions along each hanging vine strand
  const leavesPerVine = 22;
  for (let l = 0; l < leavesPerVine; l++) {
    const frac = (l + 0.5) / leavesPerVine;
    const pos = vineCurve.getPoint(frac);
    const leafYaw = l * 2.39996 + vIdx * 0.5;
    leafTransforms.push({ pos, yaw: leafYaw, shadeSeed: (vIdx * 13 + l * 7) % 10 });
  }
});

// InstancedMesh for narrow lance-shaped willow leaves
const leafGeo = new THREE.CylinderGeometry(0.002, 0.014, 0.085, 6);
leafGeo.scale(1.0, 1.0, 0.28); // Flatten into a slender willow leaf blade
const leafMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.65,
  metalness: 0.02
});

const leavesInstanced = new THREE.InstancedMesh(leafGeo, leafMat, leafTransforms.length);
leavesInstanced.name = "willow_curtain_leaves_instanced";
vinesGroup.add(leavesInstanced);

const dummy = new THREE.Object3D();
const leafColor = new THREE.Color();

leafTransforms.forEach((item, i) => {
  const radialOffset = 0.016;
  dummy.position.set(
    item.pos.x + Math.cos(item.yaw) * radialOffset,
    item.pos.y,
    item.pos.z + Math.sin(item.yaw) * radialOffset
  );
  // Drooping outward angle characteristic of weeping willow foliage
  dummy.rotation.set(0.38, item.yaw, 0.22);
  dummy.updateMatrix();
  leavesInstanced.setMatrixAt(i, dummy.matrix);

  const t = item.shadeSeed / 10.0;
  // Golden-chartreuse to fresh spring willow green
  leafColor.setRGB(
    0.42 + t * 0.18,
    0.62 + t * 0.16,
    0.18 + t * 0.08
  );
  leavesInstanced.setColorAt(i, leafColor);
});

leavesInstanced.instanceMatrix.needsUpdate = true;
if (leavesInstanced.instanceColor) leavesInstanced.instanceColor.needsUpdate = true;

// Camera Framing (tree height ~2.4m, scene width ~1.9m, center ~1.18m)
camera.position.set(0.0, 1.35, 3.05);
camera.lookAt(0, 1.15, 0);
