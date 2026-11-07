const scene = new THREE.Scene();

// Dramatic bank vault lighting
const ambientLight = new THREE.AmbientLight(0xd8e2ec, 0.55);
ambientLight.name = 'VaultAmbientLight';
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
keyLight.name = 'VaultKeyLight';
keyLight.position.set(2.5, 3.8, 3.2);
scene.add(keyLight);

const interiorGlow = new THREE.PointLight(0xffb84d, 1.4, 5.0);
interiorGlow.name = 'VaultInteriorGoldLight';
interiorGlow.position.set(0.0, 1.15, -0.55);
scene.add(interiorGlow);

const rootGroup = new THREE.Group();
rootGroup.name = 'BankVaultAssemblyGroup';
scene.add(rootGroup);

// Materials
const darkSteelMat = new THREE.MeshStandardMaterial({
  color: 0x3b424c,
  metalness: 0.85,
  roughness: 0.34
});

const brushedSteelMat = new THREE.MeshStandardMaterial({
  color: 0x9aa4b2,
  metalness: 0.92,
  roughness: 0.22
});

const chromeSteelMat = new THREE.MeshPhysicalMaterial({
  color: 0xdbe2ea,
  metalness: 0.96,
  roughness: 0.12,
  clearcoat: 0.4
});

const brassAccentMat = new THREE.MeshStandardMaterial({
  color: 0xd4a63c,
  metalness: 0.88,
  roughness: 0.24
});

// Concrete floor & reinforced steel bulkhead frame
const floorPlinth = new THREE.Mesh(
  new THREE.BoxGeometry(2.6, 0.12, 1.8),
  new THREE.MeshStandardMaterial({ color: 0x2a2e35, roughness: 0.85, metalness: 0.15 })
);
floorPlinth.name = 'VaultFloorPlinth';
floorPlinth.position.set(0, 0.06, 0);
rootGroup.add(floorPlinth);

const wallFrameGroup = new THREE.Group();
wallFrameGroup.name = 'ReinforcedWallFrameGroup';
wallFrameGroup.position.set(0, 1.12, 0);
rootGroup.add(wallFrameGroup);

const leftWallPillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.0, 0.42), darkSteelMat);
leftWallPillar.name = 'VaultFrameLeftPillar';
leftWallPillar.position.set(-0.92, 0, 0);
wallFrameGroup.add(leftWallPillar);

const rightWallPillar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 2.0, 0.42), darkSteelMat);
rightWallPillar.name = 'VaultFrameRightPillar';
rightWallPillar.position.set(0.92, 0, 0);
wallFrameGroup.add(rightWallPillar);

const topHeaderBeam = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.34, 0.44), darkSteelMat);
topHeaderBeam.name = 'VaultFrameTopHeader';
topHeaderBeam.position.set(0, 0.84, 0);
wallFrameGroup.add(topHeaderBeam);

const bottomThreshold = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, 0.44), darkSteelMat);
bottomThreshold.name = 'VaultFrameBottomThreshold';
bottomThreshold.position.set(0, -0.89, 0);
wallFrameGroup.add(bottomThreshold);

// Circular outer vault vestibule ring
const outerVestibuleRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.76, 0.09, 20, 48),
  brushedSteelMat
);
outerVestibuleRing.name = 'VaultVestibuleRing';
outerVestibuleRing.position.set(0, 1.12, 0.16);
rootGroup.add(outerVestibuleRing);

// Massive Hinge Assembly on right side (x = +0.76)
const hingeColumnGroup = new THREE.Group();
hingeColumnGroup.name = 'HeavyHingeColumnGroup';
hingeColumnGroup.position.set(0.76, 1.12, 0.24);
rootGroup.add(hingeColumnGroup);

const hingeBarrelTop = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.36, 20), chromeSteelMat);
hingeBarrelTop.name = 'HingeBarrelTop';
hingeBarrelTop.position.set(0, 0.42, 0);
hingeColumnGroup.add(hingeBarrelTop);

const hingeBarrelBottom = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.36, 20), chromeSteelMat);
hingeBarrelBottom.name = 'HingeBarrelBottom';
hingeBarrelBottom.position.set(0, -0.42, 0);
hingeColumnGroup.add(hingeBarrelBottom);

const hingePinShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.25, 16), brassAccentMat);
hingePinShaft.name = 'HingeCenterPinShaft';
hingeColumnGroup.add(hingePinShaft);

// Articulated Door Pivot Group anchored at the right hinge axis
const doorPivotGroup = new THREE.Group();
doorPivotGroup.name = 'VaultDoorPivotGroup';
doorPivotGroup.position.set(0.76, 1.12, 0.24);
rootGroup.add(doorPivotGroup);

// Main circular steel vault door leaf (offset by -0.76 in X from hinge pivot)
const doorAssembly = new THREE.Group();
doorAssembly.name = 'CircularVaultDoorLeafGroup';
doorAssembly.position.set(-0.76, 0, 0);
doorPivotGroup.add(doorAssembly);

const doorCylinderGeo = new THREE.CylinderGeometry(0.68, 0.68, 0.24, 48);
doorCylinderGeo.rotateX(Math.PI / 2);
const doorSlab = new THREE.Mesh(doorCylinderGeo, brushedSteelMat);
doorSlab.name = 'VaultDoorMainSlab';
doorAssembly.add(doorSlab);

const doorBevelRing = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.045, 16, 48), chromeSteelMat);
doorBevelRing.name = 'VaultDoorFrontBevelRing';
doorBevelRing.position.set(0, 0, 0.12);
doorAssembly.add(doorBevelRing);

// Crane hinge yoke strap connecting door to hinge pivot
const yokeArmTop = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.07), chromeSteelMat);
yokeArmTop.name = 'HingeYokeStrapTop';
yokeArmTop.position.set(0.38, 0.36, 0.13);
doorAssembly.add(yokeArmTop);

const yokeArmBottom = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.14, 0.07), chromeSteelMat);
yokeArmBottom.name = 'HingeYokeStrapBottom';
yokeArmBottom.position.set(0.38, -0.36, 0.13);
doorAssembly.add(yokeArmBottom);

// 8 Exposed Radial Locking Bolts around perimeter
const boltsGroup = new THREE.Group();
boltsGroup.name = 'RadialLockingBoltsGroup';
doorAssembly.add(boltsGroup);

const lockingBolts = [];
const boltGeo = new THREE.CylinderGeometry(0.042, 0.042, 0.28, 16);
boltGeo.rotateZ(Math.PI / 2);

for (let i = 0; i < 8; i++) {
  const angle = (i / 8) * Math.PI * 2;
  const boltHolder = new THREE.Group();
  boltHolder.name = `LockingBoltHolder_${i + 1}`;
  boltHolder.rotation.z = angle;
  boltsGroup.add(boltHolder);

  const boltMesh = new THREE.Mesh(boltGeo, chromeSteelMat);
  boltMesh.name = `LockingBoltCylinder_${i + 1}`;
  boltMesh.position.set(0.63, 0, 0.04);
  boltHolder.add(boltMesh);

  const brassGuide = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.11, 0.10), brassAccentMat);
  brassGuide.name = `LockingBoltBrassGuide_${i + 1}`;
  brassGuide.position.set(0.52, 0, 0.09);
  boltHolder.add(brassGuide);

  lockingBolts.push(boltMesh);
}

// Combination Dial & Spoked Handwheel on the front center
const wheelGroup = new THREE.Group();
wheelGroup.name = 'SpokedCombinationWheelGroup';
wheelGroup.position.set(0, 0, 0.22);
doorAssembly.add(wheelGroup);

const dialBezelGeo = new THREE.CylinderGeometry(0.17, 0.19, 0.06, 32);
dialBezelGeo.rotateX(Math.PI / 2);
const dialBezel = new THREE.Mesh(dialBezelGeo, brassAccentMat);
dialBezel.name = 'CombinationDialBrassBezel';
dialBezel.position.set(0, 0, -0.05);
wheelGroup.add(dialBezel);

const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.024, 16, 36), chromeSteelMat);
wheelRim.name = 'HandwheelOuterRim';
wheelGroup.add(wheelRim);

const centerHubGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.08, 24);
centerHubGeo.rotateX(Math.PI / 2);
const centerHub = new THREE.Mesh(centerHubGeo, brassAccentMat);
centerHub.name = 'HandwheelCenterHub';
wheelGroup.add(centerHub);

const spokeGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.56, 12);
const handleGripGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.09, 12);
handleGripGeo.rotateX(Math.PI / 2);

for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const spoke = new THREE.Mesh(spokeGeo, chromeSteelMat);
  spoke.name = `HandwheelSpoke_${i + 1}`;
  spoke.rotation.z = angle;
  wheelGroup.add(spoke);

  const grip = new THREE.Mesh(handleGripGeo, brassAccentMat);
  grip.name = `HandwheelGripHandle_${i + 1}`;
  grip.position.set(Math.cos(angle) * 0.28, Math.sin(angle) * 0.28, 0.045);
  wheelGroup.add(grip);
}

// Interactive state + temporal animation
let vaultOpen = false;
let openProgress = 0;
let wheelSpinAngle = 0;

function triggerVaultToggle() {
  vaultOpen = !vaultOpen;
  wheelSpinAngle += Math.PI * 1.5;
  wheelGroup.rotation.z = wheelSpinAngle;
  const targetSwing = vaultOpen ? 1.15 : 0.0;
  doorPivotGroup.rotation.y = targetSwing;
  for (let i = 0; i < lockingBolts.length; i++) {
    lockingBolts[i].position.x = vaultOpen ? 0.54 : 0.63;
  }
}

wheelGroup.userData.interactivity = {
  onSelect: triggerVaultToggle
};

function animate(t) {
  const cycle = 0.5 + 0.5 * Math.sin(t * 1.4 - 0.6);
  openProgress = vaultOpen ? Math.max(cycle, 0.85) : cycle;

  // Spin combination wheel first, then retract bolts and swing door open
  const spinPhase = Math.min(1.0, openProgress * 1.8);
  wheelGroup.rotation.z = wheelSpinAngle + spinPhase * Math.PI * 2.5;

  const boltRetract = Math.max(0.0, Math.min(1.0, (openProgress - 0.25) * 2.2));
  for (let i = 0; i < lockingBolts.length; i++) {
    lockingBolts[i].position.x = 0.63 - boltRetract * 0.09;
  }

  const doorSwing = Math.max(0.0, (openProgress - 0.42) / 0.58);
  doorPivotGroup.rotation.y = doorSwing * 1.18;
}
