// anim_20: Epicyclic Planetary Gear Train Transmission
const transmissionScene = new THREE.Group();
transmissionScene.name = "EpicyclicPlanetaryTransmission";
scene.add(transmissionScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e5, 1.8);
keyLight.name = "WorkshopKeyLight";
keyLight.position.set(2.0, 3.0, 2.5);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x60a5fa, 1.2, 5.0);
rimLight.name = "SteelGearRimLight";
rimLight.position.set(-1.5, 1.0, -1.5);
scene.add(rimLight);

// Materials
const bronzeMat = new THREE.MeshStandardMaterial({
  color: 0xd97706,
  roughness: 0.24,
  metalness: 0.9
});
const hardenedSteelMat = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.22,
  metalness: 0.92
});
const carrierMat = new THREE.MeshStandardMaterial({
  color: 0x475569,
  roughness: 0.35,
  metalness: 0.85
});
const mountCastMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.55,
  metalness: 0.72
});

// Helper to build an extruded involute-style spur gear using THREE.Shape and THREE.ExtrudeGeometry
function createSpurGearGeometry(pitchRadius, teethCount, toothHeight, thickness, boreRadius) {
  const shape = new THREE.Shape();
  const rootRadius = pitchRadius - toothHeight * 0.5;
  const tipRadius = pitchRadius + toothHeight * 0.5;
  const stepAngle = (Math.PI * 2) / teethCount;

  for (let i = 0; i < teethCount; i++) {
    const a0 = i * stepAngle;
    const a1 = a0 + stepAngle * 0.22;
    const a2 = a0 + stepAngle * 0.36;
    const a3 = a0 + stepAngle * 0.64;
    const a4 = a0 + stepAngle * 0.78;

    const p0x = Math.cos(a0) * rootRadius;
    const p0y = Math.sin(a0) * rootRadius;
    if (i === 0) {
      shape.moveTo(p0x, p0y);
    } else {
      shape.lineTo(p0x, p0y);
    }
    shape.lineTo(Math.cos(a1) * rootRadius, Math.sin(a1) * rootRadius);
    shape.lineTo(Math.cos(a2) * tipRadius, Math.sin(a2) * tipRadius);
    shape.lineTo(Math.cos(a3) * tipRadius, Math.sin(a3) * tipRadius);
    shape.lineTo(Math.cos(a4) * rootRadius, Math.sin(a4) * rootRadius);
  }
  shape.closePath();

  if (boreRadius > 0) {
    const hole = new THREE.Path();
    hole.absarc(0, 0, boreRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

// Helper to build an outer internal-tooth ring gear using THREE.Shape with an internal toothed hole
function createInternalRingGearGeometry(outerRadius, pitchRadius, teethCount, toothHeight, thickness) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);

  const innerPath = new THREE.Path();
  const rootRadius = pitchRadius + toothHeight * 0.5;
  const tipRadius = pitchRadius - toothHeight * 0.5;
  const stepAngle = (Math.PI * 2) / teethCount;

  for (let i = 0; i < teethCount; i++) {
    const a0 = i * stepAngle;
    const a1 = a0 + stepAngle * 0.22;
    const a2 = a0 + stepAngle * 0.36;
    const a3 = a0 + stepAngle * 0.64;
    const a4 = a0 + stepAngle * 0.78;

    const p0x = Math.cos(a0) * rootRadius;
    const p0y = Math.sin(a0) * rootRadius;
    if (i === 0) {
      innerPath.moveTo(p0x, p0y);
    } else {
      innerPath.lineTo(p0x, p0y);
    }
    innerPath.lineTo(Math.cos(a1) * rootRadius, Math.sin(a1) * rootRadius);
    innerPath.lineTo(Math.cos(a2) * tipRadius, Math.sin(a2) * tipRadius);
    innerPath.lineTo(Math.cos(a3) * tipRadius, Math.sin(a3) * tipRadius);
    innerPath.lineTo(Math.cos(a4) * rootRadius, Math.sin(a4) * rootRadius);
  }
  innerPath.closePath();
  shape.holes.push(innerPath);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.004,
    bevelSize: 0.004,
    bevelSegments: 2
  });
  geo.translate(0, 0, -thickness * 0.5);
  return geo;
}

// Cutaway Transmission Stand Base grounded at y = 0
const standBase = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.06, 0.46), mountCastMat);
standBase.name = "TransmissionMountBase";
standBase.position.set(0, 0.03, 0);
transmissionScene.add(standBase);

const centerY = 0.52;
const cradleRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.42, 0.04, 16, 36, Math.PI * 1.25),
  mountCastMat
);
cradleRing.name = "CutawayHousingCradle";
cradleRing.position.set(0, centerY, -0.04);
cradleRing.rotation.z = Math.PI * 0.875;
transmissionScene.add(cradleRing);

const leftSupportPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.36, 16), mountCastMat);
leftSupportPillar.name = "MountSupportPillarLeft";
leftSupportPillar.position.set(-0.34, 0.22, -0.04);
transmissionScene.add(leftSupportPillar);

const rightSupportPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.36, 16), mountCastMat);
rightSupportPillar.name = "MountSupportPillarRight";
rightSupportPillar.position.set(0.34, 0.22, -0.04);
transmissionScene.add(rightSupportPillar);

// Gear Tooth Ratios:
// Sun teeth Ns = 12 (pitch radius Rs = 0.12m)
// Planet teeth Np = 12 (pitch radius Rp = 0.12m) -> orbit radius Rc = Rs + Rp = 0.24m
// Ring teeth Nr = Ns + 2*Np = 36 (pitch radius Rr = 0.36m)
const Ns = 12;
const Np = 12;
const Nr = 36;
const toothH = 0.026;
const gearThickness = 0.075;

// 1. Central Bronze Sun Gear
const sunGearGroup = new THREE.Group();
sunGearGroup.name = "BronzeSunGearGroup";
sunGearGroup.position.set(0, centerY, 0);
transmissionScene.add(sunGearGroup);

const sunGeo = createSpurGearGeometry(0.115, Ns, toothH, gearThickness, 0.035);
const sunGearMesh = new THREE.Mesh(sunGeo, bronzeMat);
sunGearMesh.name = "CentralBronzeSunGear";
sunGearGroup.add(sunGearMesh);

const sunShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.24, 20), bronzeMat);
sunShaft.name = "SunInputShaft";
sunShaft.rotation.x = Math.PI / 2;
sunGearGroup.add(sunShaft);

// 2. Outer Internal-Tooth Ring Gear + Bezel Rim
const ringGearGroup = new THREE.Group();
ringGearGroup.name = "OuterRingGearGroup";
ringGearGroup.position.set(0, centerY, 0);
transmissionScene.add(ringGearGroup);

const ringGeo = createInternalRingGearGeometry(0.41, 0.365, Nr, toothH, gearThickness);
const ringGearMesh = new THREE.Mesh(ringGeo, hardenedSteelMat);
ringGearMesh.name = "OuterInternalToothRingGear";
ringGearGroup.add(ringGearMesh);

const ringBezelTorus = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.016, 12, 48), bronzeMat);
ringBezelTorus.name = "RingGearRetainingCollar";
ringBezelTorus.position.set(0, 0, 0.038);
ringGearGroup.add(ringBezelTorus);

// 3. Rotating Carrier Cage holding Three Steel Planet Gears at radius Rc = 0.24m
const carrierGroup = new THREE.Group();
carrierGroup.name = "PlanetaryCarrierCage";
carrierGroup.position.set(0, centerY, 0);
transmissionScene.add(carrierGroup);

const rearCarrierRing = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.022, 12, 36), carrierMat);
rearCarrierRing.name = "RearCarrierPlateRing";
rearCarrierRing.position.set(0, 0, -0.058);
carrierGroup.add(rearCarrierRing);

const planetGeo = createSpurGearGeometry(0.115, Np, toothH, gearThickness, 0.028);
const planetMeshes = [];
const orbitRadius = 0.24;

for (let i = 0; i < 3; i++) {
  const angle = (i / 3) * Math.PI * 2;
  const px = Math.cos(angle) * orbitRadius;
  const py = Math.sin(angle) * orbitRadius;

  // Carrier Pin & Front Cutaway Strut Arm
  const planetPin = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.14, 16), bronzeMat);
  planetPin.name = `CarrierPlanetPin_${i + 1}`;
  planetPin.rotation.x = Math.PI / 2;
  planetPin.position.set(px, py, 0);
  carrierGroup.add(planetPin);

  const carrierArm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.036, 0.018), carrierMat);
  carrierArm.name = `FrontCarrierCageArm_${i + 1}`;
  carrierArm.position.set(px * 0.5, py * 0.5, 0.062);
  carrierArm.rotation.z = angle;
  carrierGroup.add(carrierArm);

  // Steel Planet Gear Mesh
  const planetMesh = new THREE.Mesh(planetGeo, hardenedSteelMat);
  planetMesh.name = `SteelPlanetGear_${i + 1}`;
  planetMesh.position.set(px, py, 0);
  // Phase offset by half a tooth to mesh cleanly with central sun gear
  planetMesh.rotation.z = Math.PI / Np;
  carrierGroup.add(planetMesh);
  planetMeshes.push(planetMesh);
}

// Synchronized Epicyclic Gear Ratios (stationary ring gear or slowly counter-rotating ring):
// With Ring fixed (w_r = 0):
// Carrier speed w_c = w_s * (Ns / (Ns + Nr)) = w_s * (12 / 48) = 0.25 * w_s
// Planet local spin relative to carrier w_p_rel = - (w_s - w_c) * (Ns / Np) = -0.75 * w_s
function animate(t) {
  const sunAngle = t * 1.6;
  const carrierAngle = sunAngle * (Ns / (Ns + Nr));
  const planetLocalAngle = -(sunAngle - carrierAngle) * (Ns / Np) + Math.PI / Np;

  sunGearGroup.rotation.z = sunAngle;
  carrierGroup.rotation.z = carrierAngle;
  for (let i = 0; i < planetMeshes.length; i++) {
    planetMeshes[i].rotation.z = planetLocalAngle;
  }
}

// Scene bounds: width ~0.92m, height ~0.95m, depth ~0.46m -> radius ~0.55m around centerY = 0.48m
camera.position.set(0.25, 0.62, 1.28);
camera.lookAt(0, 0.48, 0);
