// Freestanding Helical Spiral Staircase (3.0m tall, 1.6m diameter) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e5, 1.35);
keyLight.name = "key_directional_light";
keyLight.position.set(3.5, 5.5, 4.0);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd8e6ff, 0.6);
fillLight.name = "fill_directional_light";
fillLight.position.set(-3.0, 2.5, -2.5);
scene.add(fillLight);

const staircaseGroup = new THREE.Group();
staircaseGroup.name = "helical_spiral_staircase";
scene.add(staircaseGroup);

// Materials
const brushedSteelMat = new THREE.MeshStandardMaterial({
  color: 0xc8d0d8,
  metalness: 0.88,
  roughness: 0.24
});

const darkSteelMat = new THREE.MeshStandardMaterial({
  color: 0x3a4048,
  metalness: 0.78,
  roughness: 0.35
});

const oakWoodMat = new THREE.MeshStandardMaterial({
  color: 0xb5804c,
  metalness: 0.06,
  roughness: 0.42
});

const totalHeight = 3.0;
const outerRadius = 0.8; // 1.6m diameter
const columnRadius = 0.11;
const numTreads = 16;
const totalTurns = 1.25 * Math.PI * 2; // 450 degrees total rotation

// 1. Base Floor Flange & Central Brushed-Steel Column
const basePlate = new THREE.Mesh(
  new THREE.CylinderGeometry(0.26, 0.28, 0.03, 32),
  darkSteelMat
);
basePlate.name = "stair_column_base_flange";
basePlate.position.set(0, 0.015, 0);
staircaseGroup.add(basePlate);

const centralColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(columnRadius, columnRadius, totalHeight, 32),
  brushedSteelMat
);
centralColumn.name = "central_brushed_steel_column";
centralColumn.position.set(0, totalHeight / 2, 0);
staircaseGroup.add(centralColumn);

const columnCap = new THREE.Mesh(
  new THREE.CylinderGeometry(columnRadius * 1.15, columnRadius * 1.15, 0.04, 32),
  darkSteelMat
);
columnCap.name = "central_column_top_cap";
columnCap.position.set(0, totalHeight + 0.02, 0);
staircaseGroup.add(columnCap);

// 2. 16 Cantilevered Oak Treads + Vertical Balusters
const handrailPoints = [];
const handrailRadius = outerRadius - 0.04;
const balusterHeight = 0.92;

for (let i = 0; i < numTreads; i++) {
  const frac = (i + 1) / numTreads;
  const y = frac * (totalHeight - 0.15);
  const angle = i * (totalTurns / (numTreads - 1));

  const stepGroup = new THREE.Group();
  stepGroup.name = `stair_step_${i + 1}`;
  stepGroup.position.set(0, y, 0);
  stepGroup.rotation.y = -angle;
  staircaseGroup.add(stepGroup);

  // Steel sleeve collar around central column
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(columnRadius + 0.014, columnRadius + 0.014, 0.14, 24),
    darkSteelMat
  );
  collar.name = `step_column_collar_${i + 1}`;
  stepGroup.add(collar);

  // Cantilevered steel support spine under tread
  const spineLength = outerRadius - columnRadius - 0.04;
  const spine = new THREE.Mesh(
    new THREE.BoxGeometry(spineLength, 0.04, 0.08),
    darkSteelMat
  );
  spine.name = `step_cantilever_spine_${i + 1}`;
  spine.position.set(columnRadius + spineLength / 2, -0.02, 0);
  stepGroup.add(spine);

  // Tapered oak tread built from main box + outer widened fan box
  const treadInner = new THREE.Mesh(
    new THREE.BoxGeometry(spineLength * 0.55, 0.045, 0.24),
    oakWoodMat
  );
  treadInner.name = `oak_tread_inner_${i + 1}`;
  treadInner.position.set(columnRadius + spineLength * 0.28, 0.022, 0);
  stepGroup.add(treadInner);

  const treadOuter = new THREE.Mesh(
    new THREE.BoxGeometry(spineLength * 0.55, 0.045, 0.36),
    oakWoodMat
  );
  treadOuter.name = `oak_tread_outer_${i + 1}`;
  treadOuter.position.set(columnRadius + spineLength * 0.75, 0.022, 0);
  stepGroup.add(treadOuter);

  // Two vertical brushed-steel balusters on the outer edge of each step
  for (const bOffsetZ of [-0.11, 0.11]) {
    const baluster = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, balusterHeight, 12),
      brushedSteelMat
    );
    baluster.name = `step_${i + 1}_baluster_${bOffsetZ < 0 ? "front" : "rear"}`;
    baluster.position.set(handrailRadius, balusterHeight / 2 + 0.02, bOffsetZ);
    stepGroup.add(baluster);
  }

  // Record 3D world-space point for continuous helical handrail
  const hx = Math.cos(angle) * handrailRadius;
  const hz = Math.sin(angle) * handrailRadius;
  const hy = y + balusterHeight + 0.02;
  handrailPoints.push(new THREE.Vector3(hx, hy, hz));
}

// 3. Continuous Helical Handrail via CatmullRomCurve3 + TubeGeometry
const handrailCurve = new THREE.CatmullRomCurve3(handrailPoints);
const handrailGeo = new THREE.TubeGeometry(handrailCurve, 96, 0.024, 16, false);
const handrailMesh = new THREE.Mesh(handrailGeo, oakWoodMat);
handrailMesh.name = "continuous_helical_handrail";
staircaseGroup.add(handrailMesh);

// Parallel mid-height safety cable rail
const midRailPoints = handrailPoints.map(
  (pt) => new THREE.Vector3(pt.x, pt.y - 0.42, pt.z)
);
const midRailCurve = new THREE.CatmullRomCurve3(midRailPoints);
const midRailGeo = new THREE.TubeGeometry(midRailCurve, 80, 0.008, 10, false);
const midRailMesh = new THREE.Mesh(midRailGeo, brushedSteelMat);
midRailMesh.name = "helical_mid_guard_cable";
staircaseGroup.add(midRailMesh);

// Frame camera at ~2.2x bounding radius (height ~3.8m, radius ~0.8m -> bounding radius ~2.05m)
camera.position.set(3.2, 2.3, 3.6);
camera.lookAt(0, 1.85, 0);
