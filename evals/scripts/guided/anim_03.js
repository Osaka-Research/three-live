// anim_03: 6-Axis Industrial Robotic Welding Arm with IK
const factoryCell = new THREE.Group();
factoryCell.name = "RoboticWeldingCell";
scene.add(factoryCell);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const shopKeyLight = new THREE.DirectionalLight(0xfff6e5, 1.6);
shopKeyLight.name = "FactoryKeyLight";
shopKeyLight.position.set(3.0, 4.5, 3.5);
scene.add(shopKeyLight);

const weldSparkLight = new THREE.PointLight(0x38bdf8, 1.4, 3.0);
weldSparkLight.name = "WeldingArcPointLight";
weldSparkLight.position.set(0.55, 0.92, 0.15);
scene.add(weldSparkLight);

// Materials
const orangePaintMat = new THREE.MeshStandardMaterial({
  color: 0xf97316,
  roughness: 0.32,
  metalness: 0.45
});
const darkSteelMat = new THREE.MeshStandardMaterial({
  color: 0x27272a,
  roughness: 0.45,
  metalness: 0.8
});
const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xd4d4d8,
  roughness: 0.2,
  metalness: 0.92
});
const floorMat = new THREE.MeshStandardMaterial({
  color: 0x333842,
  roughness: 0.7,
  metalness: 0.2
});
const sparkMat = new THREE.MeshStandardMaterial({
  color: 0x7dd3fc,
  emissive: 0x0284c7,
  emissiveIntensity: 1.5,
  roughness: 0.2
});

// Factory Safety Base Pad at y = 0
const basePlate = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 1.4), floorMat);
basePlate.name = "FactoryFloorPad";
basePlate.position.set(0.15, 0.03, 0);
factoryCell.add(basePlate);

// Robot Pedestal at x = -0.35
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.45, 24), darkSteelMat);
pedestal.name = "RobotPedestal";
pedestal.position.set(-0.35, 0.255, 0);
factoryCell.add(pedestal);

// Axis 1: Rotating Turret Waist
const waistTurret = new THREE.Group();
waistTurret.name = "TurretWaist";
waistTurret.position.set(-0.35, 0.48, 0);
factoryCell.add(waistTurret);

const turretHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.18, 24), orangePaintMat);
turretHousing.name = "TurretHousingMesh";
turretHousing.position.set(0, 0.09, 0);
waistTurret.add(turretHousing);

// Axis 2: Shoulder Root Joint
const shoulder = new THREE.Group();
shoulder.name = "Shoulder";
shoulder.position.set(0, 0.2, 0);
shoulder.rotation.z = -0.38;
waistTurret.add(shoulder);

const shoulderMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.28, 20), darkSteelMat);
shoulderMotor.name = "ShoulderMotorCap";
shoulderMotor.rotation.x = Math.PI / 2;
shoulder.add(shoulderMotor);

const upperArmLink = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.56, 0.14), orangePaintMat);
upperArmLink.name = "UpperArmLink";
upperArmLink.position.set(0, 0.28, 0);
shoulder.add(upperArmLink);

// Axis 3: Forearm Mid Joint (Elbow)
const forearm = new THREE.Group();
forearm.name = "Forearm";
forearm.position.set(0, 0.55, 0);
forearm.rotation.z = -1.05;
shoulder.add(forearm);

const elbowMotor = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.24, 20), darkSteelMat);
elbowMotor.name = "ElbowMotorHousing";
elbowMotor.rotation.x = Math.PI / 2;
forearm.add(elbowMotor);

const forearmLink = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.085, 0.52, 16), orangePaintMat);
forearmLink.name = "ForearmTube";
forearmLink.position.set(0, 0.26, 0);
forearm.add(forearmLink);

// Axis 4/5/6: Wrist Effector & Two-Finger Welding Gripper
const wrist = new THREE.Group();
wrist.name = "Wrist";
wrist.position.set(0, 0.52, 0);
wrist.rotation.z = -0.65;
forearm.add(wrist);

const wristCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 16), darkSteelMat);
wristCollar.name = "WristCollar";
wristCollar.position.set(0, 0.06, 0);
wrist.add(wristCollar);

const gripperBase = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.1), chromeMat);
gripperBase.name = "GripperPalm";
gripperBase.position.set(0, 0.13, 0);
wrist.add(gripperBase);

const fingerLeft = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.03), chromeMat);
fingerLeft.name = "GripperFingerLeft";
fingerLeft.position.set(-0.04, 0.2, 0);
wrist.add(fingerLeft);

const fingerRight = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.03), chromeMat);
fingerRight.name = "GripperFingerRight";
fingerRight.position.set(0.04, 0.2, 0);
wrist.add(fingerRight);

const torchTip = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.02, 0.09, 12), chromeMat);
torchTip.name = "WeldingTorchNozzle";
torchTip.position.set(0, 0.21, 0);
wrist.add(torchTip);

// Workbench & Workpiece with GripperTarget
const workbench = new THREE.Group();
workbench.name = "WeldingWorkbench";
workbench.position.set(0.55, 0.06, 0);
factoryCell.add(workbench);

const benchTop = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.06, 0.85), darkSteelMat);
benchTop.name = "WorkbenchTabletop";
benchTop.position.set(0, 0.72, 0);
workbench.add(benchTop);

const legPositions = [
  [-0.32, -0.36],
  [0.32, -0.36],
  [-0.32, 0.36],
  [0.32, 0.36]
];
for (let i = 0; i < legPositions.length; i++) {
  const [lx, lz] = legPositions[i];
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), darkSteelMat);
  leg.name = `WorkbenchLeg_${i + 1}`;
  leg.position.set(lx, 0.35, lz);
  workbench.add(leg);
}

const workpiece = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.42), chromeMat);
workpiece.name = "SteelWorkpiece";
workpiece.position.set(0, 0.79, 0);
workbench.add(workpiece);

// GripperTarget node on the workbench
const gripperTarget = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), sparkMat);
gripperTarget.name = "GripperTarget";
gripperTarget.position.set(0.55, 0.90, 0.0);
factoryCell.add(gripperTarget);

// Attach declarative IK trait AND use THREE.IKSolver if present
factoryCell.userData.xr = {
  ik: {
    root: "Shoulder",
    mid: "Forearm",
    effector: "Wrist",
    target: "GripperTarget",
    pole: [0, 1, 0]
  }
};

let ikSolver = null;
if (typeof THREE.IKSolver === "function") {
  ikSolver = new THREE.IKSolver({
    root: shoulder,
    mid: forearm,
    effector: wrist,
    target: gripperTarget,
    pole: new THREE.Vector3(0, 1, 0)
  });
}

function animate(t) {
  // Move GripperTarget along welding seam
  const seamZ = Math.sin(t * 1.6) * 0.16;
  const seamX = 0.52 + Math.cos(t * 0.8) * 0.05;
  gripperTarget.position.set(seamX, 0.90, seamZ);
  weldSparkLight.position.set(seamX, 0.95, seamZ);

  if (ikSolver && typeof ikSolver.update === "function") {
    ikSolver.update();
  } else {
    // Analytical 2-bone + turret tracking fallback
    waistTurret.rotation.y = Math.atan2(seamZ, seamX + 0.35);
    shoulder.rotation.z = -0.35 - Math.cos(t * 0.8) * 0.08;
    forearm.rotation.z = -1.08 + Math.cos(t * 0.8) * 0.12;
    wrist.rotation.z = -0.62 - Math.sin(t * 1.6) * 0.06;
  }
}

// Scene bounds: X in [-0.85, 1.15], Y in [0, 1.55], Z in [-0.7, 0.7] -> radius ~1.35m
camera.position.set(0.2, 1.55, 2.9);
camera.lookAt(0.1, 0.75, 0);
