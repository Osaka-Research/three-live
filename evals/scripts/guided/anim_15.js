// anim_15: Multi-Tier Distance LOD Alpine Pine Forest
const forestScene = new THREE.Group();
forestScene.name = "AlpinePineForestScene";
scene.add(forestScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.7);
sunLight.name = "AlpineSunDirectionalLight";
sunLight.position.set(4.0, 6.0, 3.5);
scene.add(sunLight);

const meadowBounceLight = new THREE.PointLight(0xa7f3d0, 0.9, 10.0);
meadowBounceLight.name = "MeadowBouncePointLight";
meadowBounceLight.position.set(0, 1.5, 0);
scene.add(meadowBounceLight);

// Materials
const meadowMat = new THREE.MeshStandardMaterial({
  color: 0x365314,
  roughness: 0.88,
  metalness: 0.05
});
const earthRimMat = new THREE.MeshStandardMaterial({
  color: 0x3f2e21,
  roughness: 0.9,
  metalness: 0.05
});
const barkMat = new THREE.MeshStandardMaterial({
  color: 0x5c4033,
  roughness: 0.85,
  metalness: 0.05
});
const deepPineMat = new THREE.MeshStandardMaterial({
  color: 0x14532d,
  roughness: 0.72,
  metalness: 0.08
});
const midPineMat = new THREE.MeshStandardMaterial({
  color: 0x166534,
  roughness: 0.75,
  metalness: 0.06
});
const snowTipMat = new THREE.MeshStandardMaterial({
  color: 0xecfdf5,
  roughness: 0.5,
  metalness: 0.05
});
const rockMat = new THREE.MeshStandardMaterial({
  color: 0x64748b,
  roughness: 0.8,
  metalness: 0.15
});

// Forest Clearing Ground Plane & Plinth at y = 0
const clearingPlane = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.4, 16, 16), meadowMat);
clearingPlane.name = "ForestClearingMeadowPlane";
clearingPlane.rotation.x = -Math.PI / 2;
clearingPlane.position.set(0, 0.04, 0);
forestScene.add(clearingPlane);

const clearingBase = new THREE.Mesh(new THREE.CylinderGeometry(2.35, 2.45, 0.04, 36), earthRimMat);
clearingBase.name = "ForestClearingEarthBase";
clearingBase.position.set(0, 0.02, 0);
forestScene.add(clearingBase);

// Central Clearing Campfire Ring Stones
for (let r = 0; r < 6; r++) {
  const ra = (r / 6) * Math.PI * 2;
  const boulder = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.14, 7), rockMat);
  boulder.name = `ClearingStone_${r + 1}`;
  boulder.position.set(Math.cos(ra) * 0.35, 0.08, Math.sin(ra) * 0.35);
  boulder.rotation.y = ra;
  forestScene.add(boulder);
}

// 15 Pine Trees arranged around the clearing using THREE.LOD and declarative userData.xr.lod
const treeCount = 15;
const treeLODs = [];

for (let i = 0; i < treeCount; i++) {
  const ring = i < 7 ? 0 : 1;
  const idxInRing = ring === 0 ? i : i - 7;
  const countInRing = ring === 0 ? 7 : 8;
  const angle = (idxInRing / countInRing) * Math.PI * 2 + ring * 0.35;
  const radius = ring === 0 ? 1.05 : 1.78;
  const tx = Math.cos(angle) * radius;
  const tz = Math.sin(angle) * radius;
  const scale = 0.85 + ((i * 7) % 5) * 0.08;

  const lod = new THREE.LOD();
  lod.name = `AlpinePineTreeLOD_${i + 1}`;
  lod.position.set(tx, 0.04, tz);
  lod.scale.set(scale, scale, scale);

  // Attach canonical declarative userData.xr.lod trait
  lod.userData.xr = {
    lod: {
      distances: [3, 8],
      ratios: [0.5, 0.2]
    }
  };

  // Level 0 (Close): Detailed multi-tier pine branches, furrowed trunk, root flare, and snow crown
  const highDetailGroup = new THREE.Group();
  highDetailGroup.name = `PineTree_HighLOD_${i + 1}`;

  const trunkHigh = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.085, 0.46, 12), barkMat);
  trunkHigh.name = `PineTrunkHigh_${i + 1}`;
  trunkHigh.position.set(0, 0.23, 0);
  highDetailGroup.add(trunkHigh);

  const tier1 = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.42, 14), deepPineMat);
  tier1.name = `PineTier1_${i + 1}`;
  tier1.position.set(0, 0.46, 0);
  highDetailGroup.add(tier1);

  const tier2 = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.38, 14), midPineMat);
  tier2.name = `PineTier2_${i + 1}`;
  tier2.position.set(0, 0.68, 0);
  highDetailGroup.add(tier2);

  const tier3 = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.34, 14), deepPineMat);
  tier3.name = `PineTier3_${i + 1}`;
  tier3.position.set(0, 0.88, 0);
  highDetailGroup.add(tier3);

  const tier4 = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.24, 12), snowTipMat);
  tier4.name = `PineCrownSnow_${i + 1}`;
  tier4.position.set(0, 1.04, 0);
  highDetailGroup.add(tier4);

  // Level 1 (Mid-distance): Simplified single cone + low-segment cylinder trunk
  const midDetailGroup = new THREE.Group();
  midDetailGroup.name = `PineTree_MidLOD_${i + 1}`;

  const trunkMid = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.35, 6), barkMat);
  trunkMid.name = `PineTrunkMid_${i + 1}`;
  trunkMid.position.set(0, 0.175, 0);
  midDetailGroup.add(trunkMid);

  const coneMid = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.88, 8), midPineMat);
  coneMid.name = `PineConeMid_${i + 1}`;
  coneMid.position.set(0, 0.68, 0);
  midDetailGroup.add(coneMid);

  // Level 2 (Far distance): Ultra-lightweight proxy / clean cull group
  const farProxyGroup = new THREE.Group();
  farProxyGroup.name = `PineTree_FarCull_${i + 1}`;

  lod.addLevel(highDetailGroup, 0);
  lod.addLevel(midDetailGroup, 6.0);
  lod.addLevel(farProxyGroup, 14.0);

  forestScene.add(lod);
  treeLODs.push(lod);
}

function animate(t) {
  for (let i = 0; i < treeLODs.length; i++) {
    treeLODs[i].rotation.z = Math.sin(t * 1.4 + i * 0.7) * 0.025;
  }
}

// Scene bounds: radius ~2.45m, height ~1.2m -> camera distance ~5.2m
camera.position.set(0.0, 2.6, 4.6);
camera.lookAt(0, 0.45, 0);
