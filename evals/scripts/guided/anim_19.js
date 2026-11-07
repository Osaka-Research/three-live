// anim_19: Mechanical Music Box with Pinned Brass Cylinder
const musicBoxScene = new THREE.Group();
musicBoxScene.name = "MechanicalMusicBoxScene";
scene.add(musicBoxScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e0, 1.8);
keyLight.name = "MusicBoxKeyLight";
keyLight.position.set(1.8, 2.8, 2.2);
scene.add(keyLight);

const warmPoint = new THREE.PointLight(0xffb74d, 1.1, 4.0);
warmPoint.name = "InteriorBrassGlow";
warmPoint.position.set(0, 0.42, 0.15);
scene.add(warmPoint);

// Materials (including MeshPhysicalMaterial for walnut lacquer, glass lid, and brass)
const walnutWoodMat = new THREE.MeshPhysicalMaterial({
  color: 0x452212,
  roughness: 0.28,
  metalness: 0.05,
  clearcoat: 0.85,
  clearcoatRoughness: 0.15
});
const velvetInteriorMat = new THREE.MeshPhysicalMaterial({
  color: 0x4c0519,
  roughness: 0.8,
  metalness: 0.02,
  sheen: 0.9,
  sheenColor: 0xfda4af,
  sheenRoughness: 0.35
});
const glassPaneMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.06,
  metalness: 0.05,
  transmission: 0.92,
  ior: 1.52,
  thickness: 0.01,
  transparent: true,
  opacity: 0.38
});
const polishedBrassMat = new THREE.MeshPhysicalMaterial({
  color: 0xd4af37,
  roughness: 0.18,
  metalness: 0.94,
  clearcoat: 0.5
});
const tunedSteelMat = new THREE.MeshPhysicalMaterial({
  color: 0xe2e8f0,
  roughness: 0.16,
  metalness: 0.95,
  clearcoat: 0.4
});

// Walnut Music Box Case resting at y = 0 (~0.56m wide x 0.36m deep)
const caseWidth = 0.56;
const caseDepth = 0.36;
const wallHeight = 0.14;

const bottomPlinth = new THREE.Mesh(new THREE.BoxGeometry(caseWidth, 0.025, caseDepth), walnutWoodMat);
bottomPlinth.name = "MusicBoxBottomBase";
bottomPlinth.position.set(0, 0.0125, 0);
musicBoxScene.add(bottomPlinth);

const velvetFloor = new THREE.Mesh(new THREE.BoxGeometry(caseWidth - 0.05, 0.01, caseDepth - 0.05), velvetInteriorMat);
velvetFloor.name = "MusicBoxVelvetLining";
velvetFloor.position.set(0, 0.03, 0);
musicBoxScene.add(velvetFloor);

// Four Walnut Case Walls surrounding the interior cavity
const frontWall = new THREE.Mesh(new THREE.BoxGeometry(caseWidth, wallHeight, 0.026), walnutWoodMat);
frontWall.name = "CaseFrontWall";
frontWall.position.set(0, 0.025 + wallHeight * 0.5, caseDepth * 0.5 - 0.013);
musicBoxScene.add(frontWall);

const backWall = new THREE.Mesh(new THREE.BoxGeometry(caseWidth, wallHeight, 0.026), walnutWoodMat);
backWall.name = "CaseBackWall";
backWall.position.set(0, 0.025 + wallHeight * 0.5, -caseDepth * 0.5 + 0.013);
musicBoxScene.add(backWall);

const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.026, wallHeight, caseDepth - 0.052), walnutWoodMat);
leftWall.name = "CaseLeftWall";
leftWall.position.set(-caseWidth * 0.5 + 0.013, 0.025 + wallHeight * 0.5, 0);
musicBoxScene.add(leftWall);

const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.026, wallHeight, caseDepth - 0.052), walnutWoodMat);
rightWall.name = "CaseRightWall";
rightWall.position.set(caseWidth * 0.5 - 0.013, 0.025 + wallHeight * 0.5, 0);
musicBoxScene.add(rightWall);

// Open Hinged Glass-Topped Walnut Lid tilted back at 68 degrees
const lidPivot = new THREE.Group();
lidPivot.name = "OpenGlassToppedLid";
lidPivot.position.set(0, 0.025 + wallHeight, -caseDepth * 0.5 + 0.013);
lidPivot.rotation.x = -1.18;
musicBoxScene.add(lidPivot);

const lidFrameFront = new THREE.Mesh(new THREE.BoxGeometry(caseWidth, 0.024, 0.035), walnutWoodMat);
lidFrameFront.name = "LidFrameFrontRail";
lidFrameFront.position.set(0, 0.012, caseDepth - 0.03);
lidPivot.add(lidFrameFront);

const lidFrameBack = new THREE.Mesh(new THREE.BoxGeometry(caseWidth, 0.024, 0.035), walnutWoodMat);
lidFrameBack.name = "LidFrameBackRail";
lidFrameBack.position.set(0, 0.012, 0.005);
lidPivot.add(lidFrameBack);

const lidFrameLeft = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.024, caseDepth), walnutWoodMat);
lidFrameLeft.name = "LidFrameLeftRail";
lidFrameLeft.position.set(-caseWidth * 0.5 + 0.0175, 0.012, caseDepth * 0.5 - 0.013);
lidPivot.add(lidFrameLeft);

const lidFrameRight = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.024, caseDepth), walnutWoodMat);
lidFrameRight.name = "LidFrameRightRail";
lidFrameRight.position.set(caseWidth * 0.5 - 0.0175, 0.012, caseDepth * 0.5 - 0.013);
lidPivot.add(lidFrameRight);

const glassTopPanel = new THREE.Mesh(new THREE.BoxGeometry(caseWidth - 0.07, 0.008, caseDepth - 0.07), glassPaneMat);
glassTopPanel.name = "LidBeveledGlassWindow";
glassTopPanel.position.set(0, 0.012, caseDepth * 0.5 - 0.013);
lidPivot.add(glassTopPanel);

// Brass Mechanism Bedplate inside the Case
const bedplate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.016, 0.26), polishedBrassMat);
bedplate.name = "BrassMechanismBedplate";
bedplate.position.set(0, 0.042, 0);
musicBoxScene.add(bedplate);

// Rotating Brass Cylinder + 60 Tiny Plucking Pins via THREE.InstancedMesh
const cylinderGroup = new THREE.Group();
cylinderGroup.name = "RotatingPinnedBrassCylinder";
cylinderGroup.position.set(-0.04, 0.105, -0.025);
musicBoxScene.add(cylinderGroup);

const drumRadius = 0.042;
const drumLength = 0.24;
const brassDrum = new THREE.Mesh(new THREE.CylinderGeometry(drumRadius, drumRadius, drumLength, 32), polishedBrassMat);
brassDrum.name = "BrassCylinderDrum";
brassDrum.rotation.z = Math.PI / 2;
cylinderGroup.add(brassDrum);

const pinCount = 60;
const pinGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 8);
const instancedPins = new THREE.InstancedMesh(pinGeo, polishedBrassMat, pinCount);
instancedPins.name = "InstancedPluckingPins";
cylinderGroup.add(instancedPins);

const dummyMatrix = new THREE.Matrix4();
const posVec = new THREE.Vector3();
const rotQuat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scaleVec = new THREE.Vector3(1, 1, 1);

for (let i = 0; i < pinCount; i++) {
  const track = i % 15;
  const xPos = -0.105 + (track / 14) * 0.21;
  const angle = ((i * 7 + track * 3) / pinCount) * Math.PI * 2;
  const r = drumRadius + 0.003;

  posVec.set(xPos, Math.sin(angle) * r, Math.cos(angle) * r);
  euler.set(Math.PI / 2 - angle, 0, 0);
  rotQuat.setFromEuler(euler);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  instancedPins.setMatrixAt(i, dummyMatrix);
}
instancedPins.instanceMatrix.needsUpdate = true;

// Tuned Steel Comb with Graduated Teeth positioned right in front of the Brass Cylinder
const combBase = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.014, 0.055), tunedSteelMat);
combBase.name = "TunedSteelCombBase";
combBase.position.set(-0.04, 0.095, 0.072);
musicBoxScene.add(combBase);

for (let t = 0; t < 15; t++) {
  const tx = -0.145 + (t / 14) * 0.21;
  const toothLen = 0.038 + (14 - t) * 0.0018; // Graduated bass-to-treble lengths
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.003, toothLen), tunedSteelMat);
  tooth.name = `CombGraduatedTooth_${t + 1}`;
  tooth.position.set(tx, 0.103, 0.045 - toothLen * 0.5);
  musicBoxScene.add(tooth);
}

// Spinning Fly-Governor Assembly on the Right Side of the Bedplate
const governorGroup = new THREE.Group();
governorGroup.name = "SpinningFlyGovernor";
governorGroup.position.set(0.15, 0.105, -0.02);
musicBoxScene.add(governorGroup);

const govSpindle = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.10, 10), tunedSteelMat);
govSpindle.name = "GovernorVerticalSpindle";
governorGroup.add(govSpindle);

const govVaneLeft = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.003), polishedBrassMat);
govVaneLeft.name = "GovernorBrassVaneLeft";
govVaneLeft.position.set(-0.022, 0.02, 0);
governorGroup.add(govVaneLeft);

const govVaneRight = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.032, 0.003), polishedBrassMat);
govVaneRight.name = "GovernorBrassVaneRight";
govVaneRight.position.set(0.022, 0.02, 0);
governorGroup.add(govVaneRight);

// External Brass Winding Key on the Right Case Wall
const windingKey = new THREE.Group();
windingKey.name = "BrassWindingKey";
windingKey.position.set(caseWidth * 0.5 + 0.035, 0.095, 0);
musicBoxScene.add(windingKey);

const keyShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.07, 12), polishedBrassMat);
keyShaft.name = "WindingKeyShaft";
keyShaft.rotation.z = Math.PI / 2;
windingKey.add(keyShaft);

const keyBow = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.068, 0.024), polishedBrassMat);
keyBow.name = "WindingKeyHandleWings";
keyBow.position.set(0.035, 0, 0);
windingKey.add(keyBow);

function animate(t) {
  cylinderGroup.rotation.x = t * 0.55;
  governorGroup.rotation.y = t * 9.0;
  windingKey.rotation.x = -t * 0.35;
}

// Scene bounds: width ~0.64m, height ~0.46m, depth ~0.46m -> radius ~0.45m around centerY = 0.20m
camera.position.set(0.32, 0.52, 0.85);
camera.lookAt(0, 0.18, 0);
