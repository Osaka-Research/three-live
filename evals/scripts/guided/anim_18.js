// anim_18: Foucault Pendulum Over Brass Compass Rose
const rotundaScene = new THREE.Group();
rotundaScene.name = "FoucaultPendulumRotunda";
scene.add(rotundaScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const domeKeyLight = new THREE.DirectionalLight(0xfff7e6, 1.7);
domeKeyLight.name = "RotundaSkylightDirectional";
domeKeyLight.position.set(3.0, 5.5, 3.5);
scene.add(domeKeyLight);

const pitGlowLight = new THREE.PointLight(0xffd166, 1.2, 6.0);
pitGlowLight.name = "CompassPitWarmLight";
pitGlowLight.position.set(0, 1.2, 0);
scene.add(pitGlowLight);

// Materials
const darkMarbleMat = new THREE.MeshStandardMaterial({
  color: 0x1e242b,
  roughness: 0.25,
  metalness: 0.15
});
const creamMarbleMat = new THREE.MeshStandardMaterial({
  color: 0xf1ede4,
  roughness: 0.3,
  metalness: 0.08
});
const polishedBrassMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.18,
  metalness: 0.92
});
const bronzeMat = new THREE.MeshStandardMaterial({
  color: 0x926c24,
  roughness: 0.32,
  metalness: 0.85
});
const cableMat = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.35,
  metalness: 0.88
});

// Museum Rotunda Floor Pit Base at y = 0
const pitFloor = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.50, 0.08, 48), darkMarbleMat);
pitFloor.name = "RotundaPitFloor";
pitFloor.position.set(0, 0.04, 0);
rotundaScene.add(pitFloor);

// Circular Marble Balustrade Surround around the Pit
const lowerCurbRing = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.08, 16, 48), creamMarbleMat);
lowerCurbRing.name = "BalustradeBaseCurb";
lowerCurbRing.rotation.x = Math.PI / 2;
lowerCurbRing.position.set(0, 0.12, 0);
rotundaScene.add(lowerCurbRing);

const handrailRing = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.065, 16, 48), creamMarbleMat);
handrailRing.name = "MarbleBalustradeHandrail";
handrailRing.rotation.x = Math.PI / 2;
handrailRing.position.set(0, 0.62, 0);
rotundaScene.add(handrailRing);

const balusterCount = 24;
for (let i = 0; i < balusterCount; i++) {
  const angle = (i / balusterCount) * Math.PI * 2;
  const bx = Math.cos(angle) * 1.38;
  const bz = Math.sin(angle) * 1.38;

  const baluster = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.044, 0.46, 12), creamMarbleMat);
  baluster.name = `MarbleBaluster_${i + 1}`;
  baluster.position.set(bx, 0.36, bz);
  rotundaScene.add(baluster);
}

// Inlaid 8-Point Brass Compass Rose on the Pit Floor (y = 0.082)
const compassGroup = new THREE.Group();
compassGroup.name = "BrassCompassRoseGroup";
compassGroup.position.set(0, 0.082, 0);
rotundaScene.add(compassGroup);

const compassOuterRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.016, 12, 48), polishedBrassMat);
compassOuterRing.name = "CompassDegreeRing";
compassOuterRing.rotation.x = Math.PI / 2;
compassGroup.add(compassOuterRing);

const compassInnerMedallion = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.014, 24), bronzeMat);
compassInnerMedallion.name = "CompassCenterMedallion";
compassInnerMedallion.position.set(0, 0.005, 0);
compassGroup.add(compassInnerMedallion);

for (let p = 0; p < 8; p++) {
  const isCardinal = p % 2 === 0;
  const angle = (p / 8) * Math.PI * 2;
  const pointLength = isCardinal ? 0.82 : 0.56;
  const pointRadius = isCardinal ? 0.085 : 0.058;

  const rayCone = new THREE.Mesh(
    new THREE.ConeGeometry(pointRadius, pointLength, 4),
    isCardinal ? polishedBrassMat : bronzeMat
  );
  rayCone.name = `CompassRosePoint_${p + 1}`;
  rayCone.rotation.z = -Math.PI / 2;
  rayCone.rotation.y = -angle;
  rayCone.scale.set(1, 0.18, 1);
  rayCone.position.set(Math.cos(angle) * (pointLength * 0.5), 0.008, Math.sin(angle) * (pointLength * 0.5));
  compassGroup.add(rayCone);
}

// Ring of 36 Small Domino Pegs at radius = 0.94m
const pegCount = 36;
for (let k = 0; k < pegCount; k++) {
  const pegAngle = (k / pegCount) * Math.PI * 2;
  const px = Math.cos(pegAngle) * 0.94;
  const pz = Math.sin(pegAngle) * 0.94;

  const peg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.075, 10), polishedBrassMat);
  peg.name = `DominoPeg_${k + 1}`;
  // Knock over a few pegs along the current oscillation plane
  const knocked = k === 0 || k === 18;
  if (knocked) {
    peg.position.set(px * 1.04, 0.095, pz * 1.04);
    peg.rotation.z = Math.PI / 2;
    peg.rotation.y = -pegAngle;
  } else {
    peg.position.set(px, 0.118, pz);
  }
  rotundaScene.add(peg);
}

// Overhead Arch Frame supporting the Foucault Pendulum Pivot at y = 2.65m
const archSpanRadius = 1.38;
const apexHeight = 2.65;
for (let a = 0; a < 4; a++) {
  const archAngle = (a / 4) * Math.PI * 2 + Math.PI / 4;
  const ribLen = 2.25;
  const archRib = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, ribLen, 12), bronzeMat);
  archRib.name = `RotundaSuspensionRib_${a + 1}`;
  archRib.position.set(Math.cos(archAngle) * 0.68, 1.62, Math.sin(archAngle) * 0.68);
  archRib.rotation.y = -archAngle;
  archRib.rotation.z = 0.56;
  rotundaScene.add(archRib);
}

const apexCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.08, 24), polishedBrassMat);
apexCrown.name = "ApexGimbalCrown";
apexCrown.position.set(0, apexHeight, 0);
rotundaScene.add(apexCrown);

// Foucault Pendulum Assembly suspended from (0, 2.65, 0)
const pendulumPlaneGroup = new THREE.Group();
pendulumPlaneGroup.name = "FoucaultPrecessionPlane";
pendulumPlaneGroup.position.set(0, apexHeight, 0);
rotundaScene.add(pendulumPlaneGroup);

const pendulumSwingGroup = new THREE.Group();
pendulumSwingGroup.name = "FoucaultPendulumSwingGroup";
pendulumPlaneGroup.add(pendulumSwingGroup);

const cableLength = 2.28;
const suspensionCable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, cableLength, 8), cableMat);
suspensionCable.name = "PendulumSuspensionCable";
suspensionCable.position.set(0, -cableLength * 0.5, 0);
pendulumSwingGroup.add(suspensionCable);

// Heavy Brass Foucault Pendulum Bob + Stylus Spike at bottom
const bobSphere = new THREE.Mesh(new THREE.SphereGeometry(0.13, 28, 20), polishedBrassMat);
bobSphere.name = "BrassPendulumBobSphere";
bobSphere.scale.set(1.0, 0.78, 1.0);
bobSphere.position.set(0, -cableLength, 0);
pendulumSwingGroup.add(bobSphere);

const bobEqRing = new THREE.Mesh(new THREE.TorusGeometry(0.132, 0.012, 12, 32), bronzeMat);
bobEqRing.name = "PendulumEquatorialCollar";
bobEqRing.rotation.x = Math.PI / 2;
bobEqRing.position.set(0, -cableLength, 0);
pendulumSwingGroup.add(bobEqRing);

const bobStylus = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.11, 16), polishedBrassMat);
bobStylus.name = "PendulumPointerSpike";
bobStylus.rotation.x = Math.PI;
bobStylus.position.set(0, -cableLength - 0.14, 0);
pendulumSwingGroup.add(bobStylus);

function animate(t) {
  // Pendulum swing + gradual Earth rotation precession
  pendulumSwingGroup.rotation.z = Math.sin(t * 1.9) * 0.36;
  pendulumPlaneGroup.rotation.y = t * 0.08;
}

// Scene bounds: radius ~1.5m, height ~2.7m -> camera distance ~4.2m
camera.position.set(1.8, 1.95, 3.3);
camera.lookAt(0, 1.05, 0);
