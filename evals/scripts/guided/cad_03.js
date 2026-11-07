// Mechanical Skeleton Watch Movement (~0.5m display scale) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff5e4, 1.4);
keyLight.name = "key_directional_light";
keyLight.position.set(1.2, 2.5, 1.6);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xdce8ff, 0.7);
fillLight.name = "fill_directional_light";
fillLight.position.set(-1.5, 1.4, -1.0);
scene.add(fillLight);

const watchGroup = new THREE.Group();
watchGroup.name = "skeleton_watch_movement";
scene.add(watchGroup);

// Materials
const brassPlateMat = new THREE.MeshStandardMaterial({
  color: 0xd4a644,
  metalness: 0.88,
  roughness: 0.26
});

const goldGearMat = new THREE.MeshStandardMaterial({
  color: 0xe6be5a,
  metalness: 0.92,
  roughness: 0.18
});

const brushedSteelMat = new THREE.MeshStandardMaterial({
  color: 0xcfd6de,
  metalness: 0.9,
  roughness: 0.24
});

const bluedSteelMat = new THREE.MeshStandardMaterial({
  color: 0x1a488e,
  metalness: 0.88,
  roughness: 0.2
});

const rubyJewelMat = new THREE.MeshStandardMaterial({
  color: 0xd91b4b,
  emissive: 0x4a0418,
  emissiveIntensity: 0.4,
  metalness: 0.2,
  roughness: 0.12
});

// Helper to create an extruded toothed gear wheel using THREE.Shape
function createToothedGear(name, pitchRadius, toothCount, thickness, mat, spokeCount) {
  const gearGroup = new THREE.Group();
  gearGroup.name = name;

  const shape = new THREE.Shape();
  const innerR = pitchRadius * 0.92;
  const outerR = pitchRadius * 1.06;
  const step = (Math.PI * 2) / toothCount;

  for (let i = 0; i < toothCount; i++) {
    const a0 = i * step;
    const a1 = a0 + step * 0.22;
    const a2 = a0 + step * 0.45;
    const a3 = a0 + step * 0.67;

    const x0 = Math.cos(a0) * innerR;
    const y0 = Math.sin(a0) * innerR;
    if (i === 0) {
      shape.moveTo(x0, y0);
    } else {
      shape.lineTo(x0, y0);
    }
    shape.lineTo(Math.cos(a1) * outerR, Math.sin(a1) * outerR);
    shape.lineTo(Math.cos(a2) * outerR, Math.sin(a2) * outerR);
    shape.lineTo(Math.cos(a3) * innerR, Math.sin(a3) * innerR);
  }
  shape.closePath();

  // Cut out open-work sector windows between spokes
  const windowInner = pitchRadius * 0.28;
  const windowOuter = pitchRadius * 0.74;
  for (let s = 0; s < spokeCount; s++) {
    const sa0 = (s / spokeCount) * Math.PI * 2 + 0.16;
    const sa1 = ((s + 1) / spokeCount) * Math.PI * 2 - 0.16;
    const hole = new THREE.Path();
    hole.absarc(0, 0, windowOuter, sa0, sa1, false);
    hole.absarc(0, 0, windowInner, sa1, sa0, true);
    hole.closePath();
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.0015,
    bevelSize: 0.0015,
    bevelSegments: 1
  });
  geo.rotateX(Math.PI / 2);

  const gearMesh = new THREE.Mesh(geo, mat);
  gearMesh.name = `${name}_wheel`;
  gearMesh.position.y = thickness / 2;
  gearGroup.add(gearMesh);

  // Steel pinion & ruby jewel bearing
  const pinion = new THREE.Mesh(
    new THREE.CylinderGeometry(pitchRadius * 0.15, pitchRadius * 0.15, thickness * 2.2, 16),
    brushedSteelMat
  );
  pinion.name = `${name}_pinion`;
  pinion.position.y = thickness * 0.6;
  gearGroup.add(pinion);

  const jewel = new THREE.Mesh(
    new THREE.CylinderGeometry(pitchRadius * 0.09, pitchRadius * 0.09, thickness * 2.4, 16),
    rubyJewelMat
  );
  jewel.name = `${name}_ruby_jewel`;
  jewel.position.y = thickness * 0.6;
  gearGroup.add(jewel);

  return gearGroup;
}

// 1. Open-work Brass Mainplate resting on low exhibition base ring (y = 0)
const baseRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.25, 0.255, 0.018, 48),
  brushedSteelMat
);
baseRing.name = "exhibition_casing_ring";
baseRing.position.set(0, 0.009, 0);
watchGroup.add(baseRing);

const mainplateShape = new THREE.Shape();
mainplateShape.absarc(0, 0, 0.235, 0, Math.PI * 2, false);

// Skeletonized cutouts in the brass mainplate
const cut1 = new THREE.Path();
cut1.absarc(-0.08, 0.06, 0.065, 0, Math.PI * 2, true);
mainplateShape.holes.push(cut1);

const cut2 = new THREE.Path();
cut2.absarc(0.085, 0.055, 0.058, 0, Math.PI * 2, true);
mainplateShape.holes.push(cut2);

const cut3 = new THREE.Path();
cut3.absarc(0.0, -0.1, 0.07, 0, Math.PI * 2, true);
mainplateShape.holes.push(cut3);

const mainplateGeo = new THREE.ExtrudeGeometry(mainplateShape, {
  depth: 0.016,
  bevelEnabled: true,
  bevelThickness: 0.002,
  bevelSize: 0.002,
  bevelSegments: 2
});
mainplateGeo.rotateX(Math.PI / 2);

const mainplateMesh = new THREE.Mesh(mainplateGeo, brassPlateMat);
mainplateMesh.name = "brass_skeleton_mainplate";
mainplateMesh.position.set(0, 0.024, 0);
watchGroup.add(mainplateMesh);

// 2. Three Meshing Toothed Gear Wheels of Different Radii
// Center Great Wheel (radius = 0.072)
const centerGear = createToothedGear("center_great_gear", 0.072, 24, 0.01, goldGearMat, 5);
centerGear.position.set(0, 0.032, 0);
watchGroup.add(centerGear);

// Mainspring Barrel Gear (radius = 0.086, meshing at (-0.11, -0.105))
const barrelGear = createToothedGear("mainspring_barrel_gear", 0.086, 28, 0.014, goldGearMat, 6);
barrelGear.position.set(-0.108, 0.03, 0.105);
watchGroup.add(barrelGear);

// Third/Fourth Train Gear (radius = 0.052, meshing at (0.095, 0.072))
const thirdGear = createToothedGear("third_train_gear", 0.052, 18, 0.01, goldGearMat, 4);
thirdGear.position.set(0.095, 0.034, 0.072);
watchGroup.add(thirdGear);

// 3. Ruby-Jeweled Balance Wheel with Hairspring Spiral (at (-0.095, -0.08))
const balanceGroup = new THREE.Group();
balanceGroup.name = "balance_wheel_assembly";
balanceGroup.position.set(-0.095, 0.042, -0.082);
watchGroup.add(balanceGroup);

const balanceRimShape = new THREE.Shape();
balanceRimShape.absarc(0, 0, 0.064, 0, Math.PI * 2, false);
const balanceHole1 = new THREE.Path();
balanceHole1.absarc(0, 0, 0.052, 0.15, Math.PI - 0.15, true);
balanceHole1.closePath();
const balanceHole2 = new THREE.Path();
balanceHole2.absarc(0, 0, 0.052, Math.PI + 0.15, Math.PI * 2 - 0.15, true);
balanceHole2.closePath();
balanceRimShape.holes.push(balanceHole1, balanceHole2);

const balanceWheelGeo = new THREE.ExtrudeGeometry(balanceRimShape, {
  depth: 0.007,
  bevelEnabled: false
});
balanceWheelGeo.rotateX(Math.PI / 2);
const balanceWheelMesh = new THREE.Mesh(balanceWheelGeo, goldGearMat);
balanceWheelMesh.name = "balance_wheel_rim";
balanceGroup.add(balanceWheelMesh);

// Timingpoise screws around the balance wheel rim
for (let i = 0; i < 8; i++) {
  const ang = (i / 8) * Math.PI * 2;
  const poiseScrew = new THREE.Mesh(
    new THREE.CylinderGeometry(0.003, 0.003, 0.009, 8),
    brassPlateMat
  );
  poiseScrew.name = `balance_poise_screw_${i + 1}`;
  poiseScrew.position.set(Math.cos(ang) * 0.066, -0.0035, Math.sin(ang) * 0.066);
  poiseScrew.rotation.z = Math.PI / 2;
  poiseScrew.rotation.y = -ang;
  balanceGroup.add(poiseScrew);
}

// Hairspring Spiral (concentric flat spiral rings)
for (let r = 1; r <= 4; r++) {
  const springLoop = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.009, r * 0.009 - 0.0015, 0.003, 24, 1, true),
    bluedSteelMat
  );
  springLoop.name = `hairspring_coil_${r}`;
  springLoop.position.y = 0.006;
  balanceGroup.add(springLoop);
}

const balanceRuby = new THREE.Mesh(
  new THREE.CylinderGeometry(0.011, 0.011, 0.022, 16),
  rubyJewelMat
);
balanceRuby.name = "balance_shock_ruby_jewel";
balanceRuby.position.y = 0.005;
balanceGroup.add(balanceRuby);

// 4. Steel Bridges with Blued Screw Heads & Ruby Jewel Chatons
function createBridge(name, x, z, length, width, rotY) {
  const bridgeGroup = new THREE.Group();
  bridgeGroup.name = name;
  bridgeGroup.position.set(x, 0.056, z);
  bridgeGroup.rotation.y = rotY;

  const bShape = new THREE.Shape();
  const hw = length / 2;
  const hh = width / 2;
  bShape.moveTo(-hw, -hh);
  bShape.lineTo(hw, -hh);
  bShape.absarc(hw, 0, hh, -Math.PI / 2, Math.PI / 2, false);
  bShape.lineTo(-hw, hh);
  bShape.absarc(-hw, 0, hh, Math.PI / 2, -Math.PI / 2, false);

  const bGeo = new THREE.ExtrudeGeometry(bShape, {
    depth: 0.01,
    bevelEnabled: true,
    bevelThickness: 0.002,
    bevelSize: 0.002,
    bevelSegments: 2
  });
  bGeo.rotateX(Math.PI / 2);

  const bridgeMesh = new THREE.Mesh(bGeo, brushedSteelMat);
  bridgeMesh.name = `${name}_plate`;
  bridgeGroup.add(bridgeMesh);

  // Two blued steel screw heads at ends
  for (const side of [-1, 1]) {
    const screw = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.007, 0.006, 16),
      bluedSteelMat
    );
    screw.name = `${name}_screw_${side < 0 ? "left" : "right"}`;
    screw.position.set(side * (hw * 0.78), 0.002, 0);
    bridgeGroup.add(screw);
  }

  // Central ruby jewel setting
  const chaton = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.005, 16),
    rubyJewelMat
  );
  chaton.name = `${name}_jewel_bearing`;
  chaton.position.set(0, 0.002, 0);
  bridgeGroup.add(chaton);

  return bridgeGroup;
}

watchGroup.add(createBridge("balance_cock_bridge", -0.055, -0.095, 0.11, 0.036, 0.35));
watchGroup.add(createBridge("gear_train_bridge", 0.085, 0.04, 0.14, 0.042, -0.5));
watchGroup.add(createBridge("barrel_ratchet_bridge", -0.095, 0.095, 0.13, 0.046, 0.65));

// 5. Center Arbor & Hour / Minute / Second Hands
const centerPost = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.014, 0.065, 20),
  brassPlateMat
);
centerPost.name = "center_hand_cannon_pinion";
centerPost.position.set(0, 0.06, 0);
watchGroup.add(centerPost);

function createWatchHand(name, length, width, yHeight, angle, mat) {
  const handGroup = new THREE.Group();
  handGroup.name = name;
  handGroup.position.set(0, yHeight, 0);
  handGroup.rotation.y = angle;

  const hShape = new THREE.Shape();
  hShape.moveTo(-length * 0.18, -width * 0.6);
  hShape.lineTo(length, -width * 0.15);
  hShape.lineTo(length * 1.06, 0);
  hShape.lineTo(length, width * 0.15);
  hShape.lineTo(-length * 0.18, width * 0.6);
  hShape.closePath();

  const hGeo = new THREE.ExtrudeGeometry(hShape, {
    depth: 0.003,
    bevelEnabled: false
  });
  hGeo.rotateX(Math.PI / 2);

  const handMesh = new THREE.Mesh(hGeo, mat);
  handMesh.name = `${name}_blade`;
  handGroup.add(handMesh);

  const hubCollar = new THREE.Mesh(
    new THREE.CylinderGeometry(width * 1.2, width * 1.2, 0.005, 16),
    mat
  );
  hubCollar.name = `${name}_collar`;
  handGroup.add(hubCollar);

  return handGroup;
}

watchGroup.add(createWatchHand("hour_hand", 0.135, 0.01, 0.078, 0.85, bluedSteelMat));
watchGroup.add(createWatchHand("minute_hand", 0.195, 0.0075, 0.085, -0.55, bluedSteelMat));
watchGroup.add(createWatchHand("second_hand", 0.21, 0.004, 0.092, 2.3, goldGearMat));

// Frame camera at ~2.2x bounding radius
camera.position.set(0.42, 0.52, 0.54);
camera.lookAt(0, 0.045, 0);
