// anim_08: Amphitheater Bowl with 1,000 Instanced Seats
const amphitheaterGroup = new THREE.Group();
amphitheaterGroup.name = "ConcertAmphitheater";
scene.add(amphitheaterGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff1dc, 1.3);
sunLight.name = "VenueDaylight";
sunLight.position.set(4.0, 6.0, 4.0);
scene.add(sunLight);

// Concert Stage SpotLights
const spotLeft = new THREE.SpotLight(0x38bdf8, 3.0, 8.0, Math.PI / 5, 0.4);
spotLeft.name = "StageSpotLightLeft";
spotLeft.position.set(-0.8, 1.85, -1.1);
scene.add(spotLeft);

const spotRight = new THREE.SpotLight(0xf43f5e, 3.0, 8.0, Math.PI / 5, 0.4);
spotRight.name = "StageSpotLightRight";
spotRight.position.set(0.8, 1.85, -1.1);
scene.add(spotRight);

// Materials
const concreteMat = new THREE.MeshStandardMaterial({
  color: 0x3f444e,
  roughness: 0.75,
  metalness: 0.15
});
const stageWoodMat = new THREE.MeshStandardMaterial({
  color: 0x5c3d28,
  roughness: 0.45,
  metalness: 0.1
});
const trussSteelMat = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.3,
  metalness: 0.85
});
const canopyMat = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.35,
  metalness: 0.1
});
const seatMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.5,
  metalness: 0.2
});

// Ground Foundation Pad at y = 0
const groundPad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.7, 0.08, 48), concreteMat);
groundPad.name = "AmphitheaterGroundPad";
groundPad.position.set(0, 0.04, 0);
amphitheaterGroup.add(groundPad);

// Central Performance Stage at z = -1.05
const stageDeck = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.85, 0.22, 32), stageWoodMat);
stageDeck.name = "CentralStageDeck";
stageDeck.position.set(0, 0.18, -1.05);
amphitheaterGroup.add(stageDeck);

// Lighting Truss Pillars & Overhead Rig
const trussGroup = new THREE.Group();
trussGroup.name = "StageLightingTruss";
trussGroup.position.set(0, 0, -1.05);
amphitheaterGroup.add(trussGroup);

const pillarOffsets = [
  [-0.78, -0.35],
  [0.78, -0.35],
  [-0.78, 0.35],
  [0.78, 0.35]
];
for (let i = 0; i < pillarOffsets.length; i++) {
  const [px, pz] = pillarOffsets[i];
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.75, 12), trussSteelMat);
  pillar.name = `TrussPillar_${i + 1}`;
  pillar.position.set(px, 0.95, pz);
  trussGroup.add(pillar);
}

const frontTrussBeam = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.07, 0.07), trussSteelMat);
frontTrussBeam.name = "FrontLightingTrussBeam";
frontTrussBeam.position.set(0, 1.78, 0.35);
trussGroup.add(frontTrussBeam);

// Acoustic Shell Canopy Roof above Stage
const acousticCanopy = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.12, 0.14, 32), canopyMat);
acousticCanopy.name = "AcousticCanopyRoof";
acousticCanopy.position.set(0, 1.92, -1.05);
acousticCanopy.rotation.x = 0.16;
amphitheaterGroup.add(acousticCanopy);

// Semicircular Stepped Concrete Bowl Risers + 1,000 Instanced Spectator Seats
const totalSeats = 1000;
const rowCounts = [52, 58, 64, 70, 76, 82, 88, 94, 100, 104, 106, 106]; // Sum = 1000 across 12 tiers

for (let r = 0; r < rowCounts.length; r++) {
  const radius = 1.05 + r * 0.115;
  const tierHeight = 0.12 + r * 0.07;
  const riserStep = new THREE.Mesh(
    new THREE.CylinderGeometry(radius + 0.06, radius + 0.06, 0.07, 40, 1, false, -Math.PI * 0.55, Math.PI * 1.1),
    concreteMat
  );
  riserStep.name = `BowlRiserTier_${r + 1}`;
  riserStep.position.set(0, tierHeight - 0.035, -0.65);
  amphitheaterGroup.add(riserStep);
}

// Instanced Seats (Cushion + Backrest combined or BoxGeometry seat)
const seatGeo = new THREE.BoxGeometry(0.048, 0.065, 0.048);
const instancedSeats = new THREE.InstancedMesh(seatGeo, seatMat, totalSeats);
instancedSeats.name = "InstancedSpectatorSeats";
amphitheaterGroup.add(instancedSeats);

const dummyMatrix = new THREE.Matrix4();
const posVec = new THREE.Vector3();
const rotQuat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scaleVec = new THREE.Vector3(1, 1, 1);
const seatColor = new THREE.Color();

let seatIndex = 0;
const stageCenterZ = -0.65;

for (let r = 0; r < rowCounts.length; r++) {
  const countInRow = rowCounts[r];
  const radius = 1.05 + r * 0.115;
  const seatY = 0.155 + r * 0.07;
  const arcSpan = Math.PI * 1.04;

  for (let s = 0; s < countInRow; s++) {
    const u = countInRow > 1 ? s / (countInRow - 1) : 0.5;
    const angle = (u - 0.5) * arcSpan; // Centered facing -Z stage

    const x = Math.sin(angle) * radius;
    const z = stageCenterZ + Math.cos(angle) * radius;

    posVec.set(x, seatY, z);
    // Rotate seat to face the central stage
    euler.set(0, angle, 0);
    rotQuat.setFromEuler(euler);
    dummyMatrix.compose(posVec, rotQuat, scaleVec);
    instancedSeats.setMatrixAt(seatIndex, dummyMatrix);

    // Acoustic zone color coding (crimson front VIP, amber mid, cobalt upper bowl)
    if (r < 4) {
      seatColor.setHex(0xe11d48);
    } else if (r < 8) {
      seatColor.setHex(0xf59e0b);
    } else {
      seatColor.setHex(0x2563eb);
    }
    instancedSeats.setColorAt(seatIndex, seatColor);
    seatIndex++;
  }
}

instancedSeats.instanceMatrix.needsUpdate = true;
if (instancedSeats.instanceColor) {
  instancedSeats.instanceColor.needsUpdate = true;
}

function animate(t) {
  // Sweep stage spotlights across the amphitheater stage
  spotLeft.position.x = -0.8 + Math.sin(t * 1.5) * 0.35;
  spotRight.position.x = 0.8 + Math.cos(t * 1.5) * 0.35;
}

// Scene bounds: radius ~2.7m, height ~2.0m -> camera distance ~5.8m
camera.position.set(0.0, 3.2, 4.8);
camera.lookAt(0, 0.85, -0.1);
