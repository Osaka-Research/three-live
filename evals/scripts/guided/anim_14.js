// anim_14: Steam Engine Flywheel & Piston Crank Linkage
const engineGroup = new THREE.Group();
engineGroup.name = "HorizontalSteamEngine";
scene.add(engineGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff4dc, 1.7);
keyLight.name = "MachineShopKeyLight";
keyLight.position.set(2.5, 3.5, 3.0);
scene.add(keyLight);

const brassFillLight = new THREE.PointLight(0xffb74d, 1.2, 5.0);
brassFillLight.name = "SteamCylinderFillLight";
brassFillLight.position.set(-1.2, 0.9, 1.2);
scene.add(brassFillLight);

// Materials
const castIronMat = new THREE.MeshStandardMaterial({
  color: 0x26292e,
  roughness: 0.6,
  metalness: 0.72
});
const polishedBrassMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.22,
  metalness: 0.92
});
const steelMat = new THREE.MeshStandardMaterial({
  color: 0xd4d4d8,
  roughness: 0.2,
  metalness: 0.94
});
const redFlywheelMat = new THREE.MeshStandardMaterial({
  color: 0x991b1b,
  roughness: 0.4,
  metalness: 0.55
});

// Cast-Iron Bedplate grounded at y = 0
const bedplateBase = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.14, 0.58), castIronMat);
bedplateBase.name = "CastIronBedplate";
bedplateBase.position.set(0, 0.07, 0);
engineGroup.add(bedplateBase);

const bedplateRiser = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.12, 0.42), castIronMat);
bedplateRiser.name = "BedplateUpperPlinth";
bedplateRiser.position.set(0, 0.20, 0);
engineGroup.add(bedplateRiser);

// Cutaway Brass Steam Cylinder at x = -0.44, y = 0.42 using THREE.CSG.subtract (<= 24 segments)
const outerCylMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 20), polishedBrassMat);
outerCylMesh.rotation.z = Math.PI / 2;
outerCylMesh.updateMatrix();

const boreCylMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.36, 20), polishedBrassMat);
boreCylMesh.rotation.z = Math.PI / 2;
boreCylMesh.updateMatrix();

const windowCutoutMesh = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.20, 0.22), polishedBrassMat);
windowCutoutMesh.position.set(0, 0.03, 0.12);
windowCutoutMesh.updateMatrix();

const hollowedCylinder = THREE.CSG.subtract(outerCylMesh, boreCylMesh);
const cutawayCylinder = THREE.CSG.subtract(hollowedCylinder, windowCutoutMesh);
cutawayCylinder.name = "CutawayBrassCylinder";
cutawayCylinder.material = polishedBrassMat;
cutawayCylinder.position.set(-0.44, 0.42, 0);
engineGroup.add(cutawayCylinder);

// Brass Cylinder End Caps & Steam Chest
const rearCap = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 20), polishedBrassMat);
rearCap.name = "CylinderRearHeadCap";
rearCap.rotation.z = Math.PI / 2;
rearCap.position.set(-0.65, 0.42, 0);
engineGroup.add(rearCap);

const frontCap = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.03, 20), polishedBrassMat);
frontCap.name = "CylinderFrontGlandCap";
frontCap.rotation.z = Math.PI / 2;
frontCap.position.set(-0.23, 0.42, 0);
engineGroup.add(frontCap);

// Crosshead Guide Rails between x = -0.20 and x = 0.12
const lowerGuideRail = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.08), steelMat);
lowerGuideRail.name = "CrossheadLowerGuide";
lowerGuideRail.position.set(-0.04, 0.35, 0);
engineGroup.add(lowerGuideRail);

const upperGuideRail = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.08), steelMat);
upperGuideRail.name = "CrossheadUpperGuide";
upperGuideRail.position.set(-0.04, 0.49, 0);
engineGroup.add(upperGuideRail);

// Crankshaft Main Bearing Pedestal at x = 0.42
const bearingPedestal = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.18), castIronMat);
bearingPedestal.name = "CrankBearingPedestal";
bearingPedestal.position.set(0.42, 0.35, -0.08);
engineGroup.add(bearingPedestal);

// Spoked Flywheel & Crank Disc Pivot at (x = 0.42, y = 0.42)
const crankRadius = 0.10;
const conRodLength = 0.46;

const crankshaftGroup = new THREE.Group();
crankshaftGroup.name = "CrankshaftAndFlywheelGroup";
crankshaftGroup.position.set(0.42, 0.42, 0);
engineGroup.add(crankshaftGroup);

// Main Axle Shaft
const mainShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 16), steelMat);
mainShaft.name = "MainCrankShaftAxle";
mainShaft.rotation.x = Math.PI / 2;
mainShaft.position.set(0, 0, -0.08);
crankshaftGroup.add(mainShaft);

// Spoked Flywheel (mounted at z = -0.20)
const flywheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.038, 16, 36), steelMat);
flywheelRim.name = "FlywheelOuterRim";
flywheelRim.position.set(0, 0, -0.20);
crankshaftGroup.add(flywheelRim);

const flywheelHub = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 16), redFlywheelMat);
flywheelHub.name = "FlywheelCentralHub";
flywheelHub.rotation.x = Math.PI / 2;
flywheelHub.position.set(0, 0, -0.20);
crankshaftGroup.add(flywheelHub);

for (let s = 0; s < 6; s++) {
  const spokeAngle = (s / 6) * Math.PI * 2;
  const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.60, 10), redFlywheelMat);
  spoke.name = `FlywheelSpoke_${s + 1}`;
  spoke.position.set(0, 0, -0.20);
  spoke.rotation.z = spokeAngle;
  crankshaftGroup.add(spoke);
}

// Counterweight Crank Web & Eccentric Crank Pin at z = 0.04
const crankDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 20), polishedBrassMat);
crankDisc.name = "EccentricCrankDisc";
crankDisc.rotation.x = Math.PI / 2;
crankDisc.position.set(0, 0, 0.02);
crankshaftGroup.add(crankDisc);

const crankPin = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.07, 12), steelMat);
crankPin.name = "EccentricCrankPin";
crankPin.rotation.x = Math.PI / 2;
crankPin.position.set(crankRadius, 0, 0.055);
crankshaftGroup.add(crankPin);

// Reciprocating Piston Assembly (Piston Head + Piston Rod + Crosshead Block)
const pistonAssembly = new THREE.Group();
pistonAssembly.name = "ReciprocatingPistonAssembly";
pistonAssembly.position.set(-0.04, 0.42, 0);
engineGroup.add(pistonAssembly);

const crossheadBlock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.06), polishedBrassMat);
crossheadBlock.name = "CrossheadSliderBlock";
pistonAssembly.add(crossheadBlock);

const pistonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.40, 12), steelMat);
pistonRod.name = "SteelPistonRod";
pistonRod.rotation.z = Math.PI / 2;
pistonRod.position.set(-0.20, 0, 0);
pistonAssembly.add(pistonRod);

const pistonHead = new THREE.Mesh(new THREE.CylinderGeometry(0.118, 0.118, 0.065, 20), steelMat);
pistonHead.name = "CylinderPistonHead";
pistonHead.rotation.z = Math.PI / 2;
pistonHead.position.set(-0.40, 0, 0);
pistonAssembly.add(pistonHead);

// Connecting Rod Pivoting at the Crosshead Wrist Pin
const connectingRodGroup = new THREE.Group();
connectingRodGroup.name = "ConnectingRodGroup";
connectingRodGroup.position.set(-0.04, 0.42, 0.065);
engineGroup.add(connectingRodGroup);

const conRodBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.022, conRodLength, 12), steelMat);
conRodBeam.name = "ConnectingRodShaft";
conRodBeam.rotation.z = -Math.PI / 2;
conRodBeam.position.set(conRodLength * 0.5, 0, 0);
connectingRodGroup.add(conRodBeam);

function updateLinkage(theta) {
  crankshaftGroup.rotation.z = theta;

  // Crank pin world X and Y relative to centerline (y = 0.42)
  const pinRelX = Math.cos(theta) * crankRadius;
  const pinRelY = Math.sin(theta) * crankRadius;
  const pinWorldX = 0.42 + pinRelX;

  // Exact slider-crank kinematic equation for crosshead X
  const dx = Math.sqrt(Math.max(0.01, conRodLength * conRodLength - pinRelY * pinRelY));
  const crossheadX = pinWorldX - dx;

  pistonAssembly.position.x = crossheadX;
  connectingRodGroup.position.x = crossheadX;

  // Connecting rod angle from crosshead to crank pin
  const rodAngle = Math.atan2(pinRelY, dx);
  connectingRodGroup.rotation.z = rodAngle;
}

updateLinkage(0.5);

function animate(t) {
  updateLinkage(t * 2.8);
}

// Scene bounds: width ~1.55m, height ~0.76m, depth ~0.6m -> radius ~0.88m around centerY = 0.38m
camera.position.set(0.15, 0.82, 1.85);
camera.lookAt(0, 0.36, 0);
