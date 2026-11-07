const mushroomLogRoot = new THREE.Group();
mushroomLogRoot.name = "bioluminescent_mushroom_log_root";
scene.add(mushroomLogRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const moonlight = new THREE.DirectionalLight(0x93c5fd, 0.95);
moonlight.name = "forest_moonlight_directional";
moonlight.position.set(1.2, 2.4, 1.5);
scene.add(moonlight);

// Materials
const barkMat = new THREE.MeshStandardMaterial({
  color: 0x3e2c20,
  roughness: 0.92,
  metalness: 0.03
});

const heartwoodMat = new THREE.MeshStandardMaterial({
  color: 0x6b4c35,
  roughness: 0.85,
  metalness: 0.02
});

const hollowInteriorMat = new THREE.MeshStandardMaterial({
  color: 0x1c130d,
  roughness: 0.95
});

const mossMat = new THREE.MeshStandardMaterial({
  color: 0x2e6b34,
  roughness: 0.9,
  metalness: 0.02
});

const brightMossMat = new THREE.MeshStandardMaterial({
  color: 0x4d8b31,
  roughness: 0.88,
  metalness: 0.02
});

const mushroomCapMat = new THREE.MeshPhysicalMaterial({
  color: 0x22d3ee,
  emissive: 0x06b6d4,
  emissiveIntensity: 1.15,
  roughness: 0.22,
  metalness: 0.0,
  transmission: 0.55,
  ior: 1.38,
  thickness: 0.02,
  transparent: true,
  opacity: 0.94
});

const mushroomGillMat = new THREE.MeshStandardMaterial({
  color: 0xa5f3fc,
  emissive: 0x00e5ff,
  emissiveIntensity: 0.95,
  roughness: 0.35
});

const mushroomStemMat = new THREE.MeshPhysicalMaterial({
  color: 0xcffafe,
  emissive: 0x0891b2,
  emissiveIntensity: 0.55,
  roughness: 0.28,
  transmission: 0.6,
  ior: 1.35,
  transparent: true,
  opacity: 0.9
});

// 1. Mossy Fallen Forest Log (~1.1m long along X, resting at y = 0)
const logGroup = new THREE.Group();
logGroup.name = "mossy_fallen_forest_log_group";
mushroomLogRoot.add(logGroup);

// Forest floor moss bed pads resting at y = 0 under the log
const floorMossPads = [
  { name: "floor_moss_bed_center", pos: [0.0, 0.018, 0.02], scale: [0.58, 0.022, 0.26], mat: mossMat },
  { name: "floor_moss_bed_left", pos: [-0.36, 0.016, -0.02], scale: [0.28, 0.020, 0.22], mat: brightMossMat },
  { name: "floor_moss_bed_right", pos: [0.38, 0.016, 0.03], scale: [0.26, 0.020, 0.22], mat: brightMossMat }
];
floorMossPads.forEach((pad) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1.0, 20, 14), pad.mat);
  m.name = pad.name;
  m.position.set(pad.pos[0], pad.pos[1], pad.pos[2]);
  m.scale.set(pad.scale[0], pad.scale[1], pad.scale[2]);
  logGroup.add(m);
});

// Main 1.1m cylindrical fallen log body
const mainLogCylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.135, 0.155, 1.10, 24),
  barkMat
);
mainLogCylinder.name = "fallen_log_bark_cylinder";
mainLogCylinder.rotation.z = Math.PI / 2;
mainLogCylinder.rotation.y = 0.06;
mainLogCylinder.position.set(0, 0.145, 0);
logGroup.add(mainLogCylinder);

// Exposed heartwood & hollow rot cavity at both ends of the log
[-1, 1].forEach((side) => {
  const endTag = side < 0 ? "left" : "right";
  const radius = side < 0 ? 0.132 : 0.152;
  const xPos = side * 0.551;

  const heartwoodDisk = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.88, radius * 0.88, 0.012, 20),
    heartwoodMat
  );
  heartwoodDisk.name = `log_${endTag}_heartwood_ring`;
  heartwoodDisk.rotation.z = Math.PI / 2;
  heartwoodDisk.position.set(xPos, 0.145, side * 0.03);
  logGroup.add(heartwoodDisk);

  const hollowCore = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, 0.016, 16),
    hollowInteriorMat
  );
  hollowCore.name = `log_${endTag}_hollow_cavity`;
  hollowCore.rotation.z = Math.PI / 2;
  hollowCore.position.set(xPos + side * 0.002, 0.138, side * 0.03);
  logGroup.add(hollowCore);
});

// Broken branch knot stubs protruding from the log
const branchStubs = [
  { name: "log_branch_stub_left", pos: [-0.34, 0.22, -0.09], rot: [-0.55, 0, 0.35], rTop: 0.038, rBot: 0.052, h: 0.14 },
  { name: "log_branch_stub_right", pos: [0.32, 0.20, 0.10], rot: [0.65, 0, -0.30], rTop: 0.032, rBot: 0.048, h: 0.12 }
];
branchStubs.forEach((st) => {
  const stubMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(st.rTop, st.rBot, st.h, 14),
    barkMat
  );
  stubMesh.name = st.name;
  stubMesh.position.set(st.pos[0], st.pos[1], st.pos[2]);
  stubMesh.rotation.set(st.rot[0], st.rot[1], st.rot[2]);
  logGroup.add(stubMesh);
});

// Lush pillows of green moss draping along the top ridge of the log (SphereGeometry)
const logMossCushions = [
  { name: "log_top_moss_cushion_1", pos: [-0.38, 0.265, 0.01], scale: [0.14, 0.035, 0.10], mat: mossMat },
  { name: "log_top_moss_cushion_2", pos: [-0.18, 0.272, 0.02], scale: [0.16, 0.038, 0.11], mat: brightMossMat },
  { name: "log_top_moss_cushion_3", pos: [0.02, 0.278, -0.01], scale: [0.18, 0.040, 0.115], mat: mossMat },
  { name: "log_top_moss_cushion_4", pos: [0.22, 0.275, 0.02], scale: [0.15, 0.036, 0.105], mat: brightMossMat },
  { name: "log_top_moss_cushion_5", pos: [0.40, 0.268, -0.01], scale: [0.12, 0.032, 0.095], mat: mossMat }
];
logMossCushions.forEach((mc) => {
  const mossPillow = new THREE.Mesh(new THREE.SphereGeometry(1.0, 18, 12), mc.mat);
  mossPillow.name = mc.name;
  mossPillow.position.set(mc.pos[0], mc.pos[1], mc.pos[2]);
  mossPillow.scale.set(mc.scale[0], mc.scale[1], mc.scale[2]);
  logGroup.add(mossPillow);
});

// 2. Clusters of Glowing Cyan Bioluminescent Mycena Mushrooms
const mushroomsGroup = new THREE.Group();
mushroomsGroup.name = "bioluminescent_mushroom_clusters_group";
mushroomLogRoot.add(mushroomsGroup);

// Helper to build a complete Mycena mushroom with curved slender stem, bell-shaped cap, umbo, and radial gill plates
function createMycenaMushroom(id, basePos, tipOffset, capRadius, capHeight) {
  const mGroup = new THREE.Group();
  mGroup.name = `mycena_mushroom_${id}_group`;
  mGroup.position.set(basePos[0], basePos[1], basePos[2]);
  mushroomsGroup.add(mGroup);

  const h = tipOffset[1];
  const dx = tipOffset[0];
  const dz = tipOffset[2];

  // Curved slender stem built from 3 smoothly angled CylinderGeometry segments
  const stemSegs = 3;
  let prevX = 0;
  let prevY = 0;
  let prevZ = 0;
  for (let s = 1; s <= stemSegs; s++) {
    const frac = s / stemSegs;
    const curveFactor = Math.pow(frac, 1.45);
    const curX = dx * curveFactor;
    const curY = h * frac;
    const curZ = dz * curveFactor;

    const segVec = new THREE.Vector3(curX - prevX, curY - prevY, curZ - prevZ);
    const segLen = segVec.length();
    const rBot = capRadius * (0.16 - (s - 1) * 0.02);
    const rTop = capRadius * (0.16 - s * 0.02);

    const stemCyl = new THREE.Mesh(
      new THREE.CylinderGeometry(rTop, rBot, segLen * 1.06, 10),
      mushroomStemMat
    );
    stemCyl.name = `mushroom_${id}_stem_seg_${s}`;
    stemCyl.position.set((prevX + curX) * 0.5, (prevY + curY) * 0.5, (prevZ + curZ) * 0.5);
    stemCyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), segVec.clone().normalize());
    mGroup.add(stemCyl);

    prevX = curX;
    prevY = curY;
    prevZ = curZ;
  }

  // Cap Assembly at top of stem
  const capHeadGroup = new THREE.Group();
  capHeadGroup.name = `mushroom_${id}_cap_assembly`;
  capHeadGroup.position.set(dx, h, dz);
  // Subtle tilt matching stem lean
  capHeadGroup.rotation.z = -dx * 1.8;
  capHeadGroup.rotation.x = dz * 1.8;
  mGroup.add(capHeadGroup);

  // Bell-shaped outer cap (ConeGeometry) + rounded umbo dome (SphereGeometry)
  const bellCone = new THREE.Mesh(
    new THREE.ConeGeometry(capRadius, capHeight, 20, 1, true),
    mushroomCapMat
  );
  bellCone.name = `mushroom_${id}_bell_cone_cap`;
  bellCone.position.y = capHeight * 0.35;
  capHeadGroup.add(bellCone);

  const umboDome = new THREE.Mesh(
    new THREE.SphereGeometry(capRadius * 0.56, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mushroomCapMat
  );
  umboDome.name = `mushroom_${id}_cap_umbo_dome`;
  umboDome.position.y = capHeight * 0.32;
  umboDome.scale.set(1.0, capHeight / (capRadius * 1.15), 1.0);
  capHeadGroup.add(umboDome);

  // 12 Radial Gill Plates underneath the bell cap
  const numGills = 12;
  for (let g = 0; g < numGills; g++) {
    const angle = (g / numGills) * Math.PI * 2.0;
    const gillLen = capRadius * 0.82;
    const gillPlate = new THREE.Mesh(
      new THREE.CylinderGeometry(capRadius * 0.08, gillLen, 0.0025, 4),
      mushroomGillMat
    );
    gillPlate.name = `mushroom_${id}_radial_gill_${g + 1}`;
    gillPlate.position.set(
      Math.cos(angle) * (gillLen * 0.45),
      0.004,
      Math.sin(angle) * (gillLen * 0.45)
    );
    gillPlate.rotation.y = -angle;
    gillPlate.rotation.x = Math.PI / 2;
    capHeadGroup.add(gillPlate);
  }
}

// 14 Bioluminescent Mushrooms across 3 organic clusters of varying heights
const mushroomSpecs = [
  // Left Cluster
  { id: 1, base: [-0.36, 0.27, 0.02], tip: [-0.04, 0.19, 0.03], r: 0.052, h: 0.045 },
  { id: 2, base: [-0.31, 0.27, -0.02], tip: [0.02, 0.14, -0.02], r: 0.040, h: 0.036 },
  { id: 3, base: [-0.41, 0.26, -0.01], tip: [-0.05, 0.11, 0.01], r: 0.032, h: 0.028 },
  { id: 4, base: [-0.26, 0.24, 0.07], tip: [0.03, 0.09, 0.04], r: 0.028, h: 0.025 },

  // Center Hero Cluster (tallest & densest)
  { id: 5, base: [-0.04, 0.28, 0.00], tip: [-0.03, 0.25, 0.02], r: 0.064, h: 0.055 },
  { id: 6, base: [0.03, 0.28, -0.02], tip: [0.04, 0.21, -0.02], r: 0.054, h: 0.046 },
  { id: 7, base: [-0.09, 0.27, 0.04], tip: [-0.05, 0.16, 0.04], r: 0.044, h: 0.038 },
  { id: 8, base: [0.08, 0.27, 0.03], tip: [0.05, 0.13, 0.04], r: 0.036, h: 0.032 },
  { id: 9, base: [0.00, 0.24, 0.08], tip: [0.01, 0.09, 0.05], r: 0.028, h: 0.024 },

  // Right Cluster
  { id: 10, base: [0.26, 0.27, 0.01], tip: [0.03, 0.20, 0.02], r: 0.055, h: 0.048 },
  { id: 11, base: [0.33, 0.27, -0.02], tip: [0.05, 0.15, -0.03], r: 0.042, h: 0.036 },
  { id: 12, base: [0.21, 0.26, -0.04], tip: [-0.03, 0.12, -0.03], r: 0.034, h: 0.030 },
  { id: 13, base: [0.39, 0.26, 0.03], tip: [0.04, 0.10, 0.03], r: 0.030, h: 0.026 },
  { id: 14, base: [0.16, 0.03, 0.16], tip: [0.02, 0.11, 0.03], r: 0.034, h: 0.030 }
];

mushroomSpecs.forEach((ms) => {
  createMycenaMushroom(ms.id, ms.base, ms.tip, ms.r, ms.h);
});

// 3. Cyan Bioluminescent PointLights inside the 3 Mushroom Clusters
const clusterLights = [
  { name: "cyan_cluster_light_left", pos: [-0.34, 0.42, 0.04], intensity: 1.2 },
  { name: "cyan_cluster_light_center", pos: [0.0, 0.48, 0.04], intensity: 1.6 },
  { name: "cyan_cluster_light_right", pos: [0.29, 0.44, 0.04], intensity: 1.2 }
];
clusterLights.forEach((cl) => {
  const ptLight = new THREE.PointLight(0x00f5ff, cl.intensity, 1.8);
  ptLight.name = cl.name;
  ptLight.position.set(cl.pos[0], cl.pos[1], cl.pos[2]);
  mushroomLogRoot.add(ptLight);
});

// Camera Framing (log length ~1.1m, height ~0.58m, bounding radius ~0.58m)
camera.position.set(0.0, 0.45, 1.26);
camera.lookAt(0, 0.22, 0);
