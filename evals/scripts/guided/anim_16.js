// anim_16: Flapping Origami Paper Crane Mobile
const mobileScene = new THREE.Group();
mobileScene.name = "OrigamiCraneNurseryMobile";
scene.add(mobileScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const warmSunLight = new THREE.DirectionalLight(0xfff7ed, 1.6);
warmSunLight.name = "NurseryWindowLight";
warmSunLight.position.set(2.5, 4.0, 3.0);
scene.add(warmSunLight);

const pastelFillLight = new THREE.PointLight(0xfde68a, 1.0, 6.0);
pastelFillLight.name = "NurseryWarmFillLight";
pastelFillLight.position.set(-1.5, 1.5, -1.5);
scene.add(pastelFillLight);

// Materials
const birchWoodMat = new THREE.MeshStandardMaterial({
  color: 0xd6b88e,
  roughness: 0.55,
  metalness: 0.05
});
const standSteelMat = new THREE.MeshStandardMaterial({
  color: 0xf1f5f9,
  roughness: 0.35,
  metalness: 0.3
});
const threadMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  roughness: 0.5,
  metalness: 0.1
});

// Nursery Display Stand Base grounded at y = 0 supporting the Hanging Mobile
const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.40, 0.04, 32), birchWoodMat);
standBase.name = "NurseryStandBase";
standBase.position.set(0, 0.02, 0);
mobileScene.add(standBase);

const standColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1.55, 16), standSteelMat);
standColumn.name = "NurseryStandVerticalMast";
standColumn.position.set(-0.52, 0.79, 0);
mobileScene.add(standColumn);

const overhangArm = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.56, 16), standSteelMat);
overhangArm.name = "NurseryStandOverhangArm";
overhangArm.rotation.z = Math.PI / 2;
overhangArm.position.set(-0.25, 1.55, 0);
mobileScene.add(overhangArm);

// Rotating Mobile Assembly suspended at y = 1.55
const mobileCarousel = new THREE.Group();
mobileCarousel.name = "RotatingMobileCarousel";
mobileCarousel.position.set(0, 1.55, 0);
mobileScene.add(mobileCarousel);

const topCord = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.18, 8), threadMat);
topCord.name = "MainSuspensionCord";
topCord.position.set(0, -0.09, 0);
mobileCarousel.add(topCord);

// Crossed Wooden Dowels at y = 1.37 (relative y = -0.18)
const dowelSpan = 0.72;
const dowelA = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, dowelSpan, 12), birchWoodMat);
dowelA.name = "CrossedWoodenDowelX";
dowelA.rotation.z = Math.PI / 2;
dowelA.position.set(0, -0.18, 0);
mobileCarousel.add(dowelA);

const dowelB = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, dowelSpan, 12), birchWoodMat);
dowelB.name = "CrossedWoodenDowelZ";
dowelB.rotation.x = Math.PI / 2;
dowelB.position.set(0, -0.18, 0);
mobileCarousel.add(dowelB);

const centerBead = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.045, 12), birchWoodMat);
centerBead.name = "CentralWoodenHubCone";
centerBead.position.set(0, -0.17, 0);
mobileCarousel.add(centerBead);

// Custom Indexed BufferGeometry for Folded Origami Paper Wings
function createOrigamiWingGeometry(sideSign) {
  const geo = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0.0, 0.0, 0.045,                  // 0: front shoulder fold
    0.0, 0.0, -0.045,                 // 1: rear shoulder fold
    sideSign * 0.13, 0.015, 0.0,      // 2: outer wingtip crease
    sideSign * 0.065, -0.012, 0.025   // 3: mid pleat valley
  ]);
  const indices = sideSign > 0 ? [0, 2, 1, 0, 3, 2, 1, 2, 0] : [0, 1, 2, 0, 2, 3, 1, 0, 2];
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const leftWingGeo = createOrigamiWingGeometry(1);
const rightWingGeo = createOrigamiWingGeometry(-1);

// 7 Folded Geometric Origami Paper Cranes in Pastel Colors
const craneSpecs = [
  { x: 0.0, z: 0.0, drop: 0.34, color: 0xfda4af, name: "Rose" },
  { x: 0.34, z: 0.0, drop: 0.42, color: 0x93c5fd, name: "SkyBlue" },
  { x: -0.34, z: 0.0, drop: 0.48, color: 0xfde047, name: "Buttercup" },
  { x: 0.0, z: 0.34, drop: 0.45, color: 0x86efac, name: "Mint" },
  { x: 0.0, z: -0.34, drop: 0.52, color: 0xd8b4fe, name: "Lavender" },
  { x: 0.18, z: 0.18, drop: 0.62, color: 0xfdba74, name: "Peach" },
  { x: -0.18, z: -0.18, drop: 0.66, color: 0x67e8f9, name: "Aqua" }
];

const craneActors = [];

for (let i = 0; i < craneSpecs.length; i++) {
  const spec = craneSpecs[i];
  const paperMat = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.65,
    metalness: 0.04
  });

  // Suspension Thread from dowel plane (y = -0.18) down by spec.drop
  const threadMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.0015, 0.0015, spec.drop, 6), threadMat);
  threadMesh.name = `CraneThread_${spec.name}`;
  threadMesh.position.set(spec.x, -0.18 - spec.drop * 0.5, spec.z);
  mobileCarousel.add(threadMesh);

  // Crane Root Group
  const craneGroup = new THREE.Group();
  craneGroup.name = `OrigamiCrane_${spec.name}`;
  craneGroup.position.set(spec.x, -0.18 - spec.drop, spec.z);
  craneGroup.rotation.y = i * 0.9;
  mobileCarousel.add(craneGroup);

  // Folded Diamond Body (back pyramid ConeGeometry)
  const bodyPyramid = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.055, 4), paperMat);
  bodyPyramid.name = `CraneBody_${spec.name}`;
  bodyPyramid.position.set(0, 0.01, 0);
  craneGroup.add(bodyPyramid);

  // Slender Folded Neck & Head Beak
  const neckCone = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.085, 4), paperMat);
  neckCone.name = `CraneNeck_${spec.name}`;
  neckCone.position.set(0, 0.032, 0.048);
  neckCone.rotation.x = 0.52;
  craneGroup.add(neckCone);

  const headBeak = new THREE.Mesh(new THREE.ConeGeometry(0.01, 0.04, 4), paperMat);
  headBeak.name = `CraneBeak_${spec.name}`;
  headBeak.position.set(0, 0.06, 0.078);
  headBeak.rotation.x = 1.85;
  craneGroup.add(headBeak);

  // Folded Tail Spire
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.085, 4), paperMat);
  tailCone.name = `CraneTail_${spec.name}`;
  tailCone.position.set(0, 0.032, -0.048);
  tailCone.rotation.x = -0.58;
  craneGroup.add(tailCone);

  // Left and Right Flapping Origami Wings (custom BufferGeometry)
  const leftWing = new THREE.Mesh(leftWingGeo, paperMat);
  leftWing.name = `CraneLeftWing_${spec.name}`;
  craneGroup.add(leftWing);

  const rightWing = new THREE.Mesh(rightWingGeo, paperMat);
  rightWing.name = `CraneRightWing_${spec.name}`;
  craneGroup.add(rightWing);

  craneActors.push({
    group: craneGroup,
    leftWing: leftWing,
    rightWing: rightWing,
    baseY: -0.18 - spec.drop,
    phase: i * 0.85
  });
}

function animate(t) {
  mobileCarousel.rotation.y = t * 0.45;

  for (let i = 0; i < craneActors.length; i++) {
    const c = craneActors[i];
    const flap = Math.sin(t * 3.2 + c.phase) * 0.35;
    c.leftWing.rotation.z = flap;
    c.rightWing.rotation.z = -flap;
    c.group.position.y = c.baseY + Math.sin(t * 2.0 + c.phase) * 0.018;
    c.group.rotation.z = Math.cos(t * 1.6 + c.phase) * 0.08;
  }
}

// Scene bounds: height ~1.58m, width ~1.1m -> radius ~0.95m around centerY = 0.82m
camera.position.set(0.65, 1.05, 2.05);
camera.lookAt(0, 0.82, 0);
