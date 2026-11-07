// anim_09: Hexapod Walking Spider Robot with IK Legs
const hexapodScene = new THREE.Group();
hexapodScene.name = "HexapodReconScene";
scene.add(hexapodScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e6, 1.7);
sunLight.name = "TacticalSunLight";
sunLight.position.set(2.5, 4.0, 3.0);
scene.add(sunLight);

const sensorGlowLight = new THREE.PointLight(0xef4444, 1.4, 3.0);
sensorGlowLight.name = "TurretOpticalLight";
sensorGlowLight.position.set(0, 0.42, 0.32);
scene.add(sensorGlowLight);

// Materials
const armorMat = new THREE.MeshStandardMaterial({
  color: 0x334155,
  roughness: 0.35,
  metalness: 0.78
});
const darkJointMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.45,
  metalness: 0.85
});
const chromeStrutMat = new THREE.MeshStandardMaterial({
  color: 0xcbd5e1,
  roughness: 0.22,
  metalness: 0.92
});
const opticsMat = new THREE.MeshStandardMaterial({
  color: 0xf87171,
  emissive: 0xdc2626,
  emissiveIntensity: 1.5,
  roughness: 0.15
});
const padMat = new THREE.MeshStandardMaterial({
  color: 0x27272a,
  roughness: 0.8,
  metalness: 0.2
});

// Ground Test Pad at y = 0
const groundPad = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.72, 0.03, 36), padMat);
groundPad.name = "HexapodTerrainPad";
groundPad.position.set(0, 0.015, 0);
hexapodScene.add(groundPad);

// Hexapod Robot Root (~0.8m wide total span)
const robotGroup = new THREE.Group();
robotGroup.name = "HexapodRobot";
robotGroup.position.set(0, 0.24, 0);
hexapodScene.add(robotGroup);

// Central Armored Chassis
const chassisCore = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.18, 0.10, 8), armorMat);
chassisCore.name = "ArmoredHexChassis";
robotGroup.add(chassisCore);

const topCarapace = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.06, 0.36), armorMat);
topCarapace.name = "TopArmoredCarapace";
topCarapace.position.set(0, 0.06, 0);
robotGroup.add(topCarapace);

// Optical Sensor Turret on Top Front
const sensorTurret = new THREE.Group();
sensorTurret.name = "OpticalSensorTurret";
sensorTurret.position.set(0, 0.11, 0.08);
robotGroup.add(sensorTurret);

const turretHead = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 16), darkJointMat);
turretHead.name = "TurretDomeMesh";
turretHead.scale.set(1.1, 0.75, 1.2);
sensorTurret.add(turretHead);

const mainLens = new THREE.Mesh(new THREE.SphereGeometry(0.032, 16, 12), opticsMat);
mainLens.name = "PrimaryOpticalEye";
mainLens.position.set(0, 0.01, 0.085);
sensorTurret.add(mainLens);

// 6 Articulated Two-Bone Legs (coxa -> femur -> tibia) + Ground Foot Targets
const legMountAngles = [
  Math.PI * 0.22,
  Math.PI * 0.5,
  Math.PI * 0.78,
  -Math.PI * 0.22,
  -Math.PI * 0.5,
  -Math.PI * 0.78
];

const legs = [];
const ikSolvers = [];

for (let i = 0; i < 6; i++) {
  const angle = legMountAngles[i];
  const mountRadius = 0.18;
  const mx = Math.sin(angle) * mountRadius;
  const mz = Math.cos(angle) * mountRadius;

  // Use exact canonical names "coxa", "femur", "tibia", "footTarget" for Leg 0
  // and indexed unique names for Legs 1..5
  const coxaName = i === 0 ? "coxa" : `coxa_${i}`;
  const femurName = i === 0 ? "femur" : `femur_${i}`;
  const tibiaName = i === 0 ? "tibia" : `tibia_${i}`;
  const targetName = i === 0 ? "footTarget" : `footTarget_${i}`;

  const coxa = new THREE.Group();
  coxa.name = coxaName;
  coxa.position.set(mx, 0, mz);
  coxa.rotation.y = angle;
  robotGroup.add(coxa);

  const coxaServo = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.065, 14), darkJointMat);
  coxaServo.name = `${coxaName}_Servo`;
  coxa.add(coxaServo);

  // Femur (Upper Leg Segment)
  const femur = new THREE.Group();
  femur.name = femurName;
  femur.position.set(0, 0, 0.045);
  femur.rotation.x = -0.42;
  coxa.add(femur);

  const femurJoint = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), chromeStrutMat);
  femurJoint.name = `${femurName}_BallJoint`;
  femur.add(femurJoint);

  const femurBeam = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.042, 0.18), armorMat);
  femurBeam.name = `${femurName}_ArmorLink`;
  femurBeam.position.set(0, 0, 0.09);
  femur.add(femurBeam);

  // Tibia (Lower Leg Segment reaching the ground)
  const tibia = new THREE.Group();
  tibia.name = tibiaName;
  tibia.position.set(0, 0, 0.18);
  tibia.rotation.x = 1.25;
  femur.add(tibia);

  const kneeJoint = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 10), darkJointMat);
  kneeJoint.name = `${tibiaName}_KneeJoint`;
  tibia.add(kneeJoint);

  const tibiaStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.008, 0.25, 12), chromeStrutMat);
  tibiaStrut.name = `${tibiaName}_Strut`;
  tibiaStrut.rotation.x = Math.PI / 2;
  tibiaStrut.position.set(0, 0, 0.125);
  tibia.add(tibiaStrut);

  // Ground Foot Target Node at y = 0.03
  const footRadius = 0.39;
  const fx = Math.sin(angle) * footRadius;
  const fz = Math.cos(angle) * footRadius;
  const footTarget = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.014, 12), darkJointMat);
  footTarget.name = targetName;
  footTarget.position.set(fx, 0.037, fz);
  hexapodScene.add(footTarget);

  // Attach declarative IK trait on each leg's coxa
  coxa.userData.xr = {
    ik: {
      root: coxaName,
      mid: femurName,
      effector: tibiaName,
      target: targetName,
      pole: [0, 1, 0]
    }
  };

  if (typeof THREE.IKSolver === "function") {
    ikSolvers.push(
      new THREE.IKSolver({
        root: coxa,
        mid: femur,
        effector: tibia,
        target: footTarget,
        pole: new THREE.Vector3(0, 1, 0)
      })
    );
  }

  legs.push({ coxa, femur, tibia, footTarget, baseAngle: angle, baseX: fx, baseZ: fz, tripodGroup: i % 2 });
}

// Also attach top-level declarative IK on the primary leg
robotGroup.userData.xr = {
  ik: {
    root: "coxa",
    mid: "femur",
    effector: "tibia",
    target: "footTarget",
    pole: [0, 1, 0]
  }
};

function animate(t) {
  // Alternating tripod gait
  const cycle = t * 3.2;
  sensorTurret.rotation.y = Math.sin(t * 1.4) * 0.45;
  robotGroup.position.y = 0.24 + Math.sin(cycle * 2.0) * 0.012;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const phase = cycle + (leg.tripodGroup === 0 ? 0 : Math.PI);
    const stride = Math.sin(phase) * 0.045;
    const lift = Math.max(0, Math.cos(phase)) * 0.045;

    leg.footTarget.position.set(
      leg.baseX,
      0.037 + lift,
      leg.baseZ + stride
    );

    if (ikSolvers[i] && typeof ikSolvers[i].update === "function") {
      ikSolvers[i].update();
    } else {
      leg.coxa.rotation.y = leg.baseAngle + stride * 1.8 * (i < 3 ? 1 : -1);
      leg.femur.rotation.x = -0.42 - lift * 3.2;
      leg.tibia.rotation.x = 1.25 + lift * 2.4;
    }
  }
}

// Scene bounds: diameter ~1.44m, height ~0.46m -> radius ~0.75m, camera distance ~1.7m
camera.position.set(0.85, 0.72, 1.35);
camera.lookAt(0, 0.20, 0);
