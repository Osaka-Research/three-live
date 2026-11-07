// Robotic Pick-and-Place Cell with IK & Physics Crates (xr_14)
scene.background = new THREE.Color(0x0f172a);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const factoryKeyLight = new THREE.DirectionalLight(0xf8fafc, 1.2);
factoryKeyLight.name = "FactoryCellKeyLight";
factoryKeyLight.position.set(2.5, 4.5, 3.0);
scene.add(factoryKeyLight);

const cellFillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
cellFillLight.name = "CellFillLight";
cellFillLight.position.set(-2.0, 2.5, -2.0);
scene.add(cellFillLight);

// Materials
const steelFrameMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.35 });
const chromeRollerMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.18 });
const robotOrangeMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.55, roughness: 0.28 });
const jointDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
const crateWoodMat = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.75, metalness: 0.05 });
const targetCyanMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.9,
  roughness: 0.2
});

// Static Industrial Roller Conveyor Belt (resting at y = 0)
const conveyorBelt = new THREE.Group();
conveyorBelt.name = "IndustrialConveyorBelt";
conveyorBelt.userData.xr = {
  anchor: "Floor",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.2, friction: 0.7 }
};
scene.add(conveyorBelt);

const legPositions = [
  [-0.95, 0.34, 0.15],
  [0.95, 0.34, 0.15],
  [-0.95, 0.34, 0.65],
  [0.95, 0.34, 0.65]
];
legPositions.forEach((lp, idx) => {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.68, 0.06), steelFrameMat);
  leg.name = `ConveyorSupportLeg_${idx + 1}`;
  leg.position.set(lp[0], lp[1], lp[2]);
  conveyorBelt.add(leg);
});

const sideRailFront = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.04), steelFrameMat);
sideRailFront.name = "ConveyorSideRailFront";
sideRailFront.position.set(0, 0.70, 0.67);
conveyorBelt.add(sideRailFront);

const sideRailBack = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.09, 0.04), steelFrameMat);
sideRailBack.name = "ConveyorSideRailBack";
sideRailBack.position.set(0, 0.70, 0.13);
conveyorBelt.add(sideRailBack);

for (let r = 0; r < 14; r++) {
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.50, 16), chromeRollerMat);
  roller.name = `ConveyorRoller_${r + 1}`;
  roller.rotation.x = Math.PI / 2;
  roller.position.set(-0.91 + r * 0.14, 0.70, 0.40);
  conveyorBelt.add(roller);
}

// 4 Grid SnapSocket Receivers along Conveyor Deck
const crateSocketNames = [];
[-0.60, -0.20, 0.20, 0.60].forEach((xSlot, idx) => {
  const socketName = `ConveyorGridSocket_${idx + 1}`;
  crateSocketNames.push(socketName);
  const socketPad = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.008, 0.22), targetCyanMat);
  socketPad.name = socketName;
  socketPad.position.set(xSlot, 0.732, 0.40);
  socketPad.userData.xr = {
    snapSocket: { id: `grid_slot_${idx + 1}`, radius: 0.12 }
  };
  conveyorBelt.add(socketPad);
});

// 4 Dynamic Shipping Crates on the Conveyor Belt
[-0.60, -0.20, 0.20, 0.60].forEach((xCrate, idx) => {
  const crateNum = idx + 1;
  const crateGroup = new THREE.Group();
  crateGroup.name = `DynamicShippingCrate_${crateNum}`;
  crateGroup.position.set(xCrate, 0.84, 0.40);
  crateGroup.userData.xr = {
    grab: "1-hand",
    physics: { body: "dynamic", collider: "box", mass: 1.0, restitution: 0.2, friction: 0.65 },
    snapTo: { radius: 0.12, targets: crateSocketNames },
    outline: { color: "#f59e0b", thickness: 0.01 }
  };
  crateGroup.userData.state = {
    snapGrid: 0.1
  };

  const crateBox = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.20, 0.20), crateWoodMat);
  crateBox.name = `ShippingCrateCore_${crateNum}`;
  crateGroup.add(crateBox);

  const strapBand = new THREE.Mesh(new THREE.BoxGeometry(0.206, 0.206, 0.035), jointDarkMat);
  strapBand.name = `ShippingCrateStrap_${crateNum}`;
  crateGroup.add(strapBand);

  scene.add(crateGroup);
});

// Industrial Robot Pedestal & 2-Bone IK Arm Assembly
const robotCell = new THREE.Group();
robotCell.name = "PickAndPlaceRobotCell";
robotCell.position.set(0, 0, -0.35);
scene.add(robotCell);

const robotPedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.62, 24), jointDarkMat);
robotPedestal.name = "RobotBasePedestal";
robotPedestal.position.y = 0.31;
robotCell.add(robotPedestal);

// IK Root Node (`RobotShoulderRoot`)
const shoulderRoot = new THREE.Group();
shoulderRoot.name = "RobotShoulderRoot";
shoulderRoot.position.set(0, 0.66, 0);
robotCell.add(shoulderRoot);

const shoulderJointMesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 20), jointDarkMat);
shoulderJointMesh.name = "ShoulderJointSphere";
shoulderRoot.add(shoulderJointMesh);

const upperArmLink = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.52, 0.11), robotOrangeMat);
upperArmLink.name = "RobotUpperArmLink";
upperArmLink.position.set(0, 0.26, 0);
shoulderRoot.add(upperArmLink);

// IK Mid Node (`RobotElbowMid`)
const elbowMid = new THREE.Group();
elbowMid.name = "RobotElbowMid";
elbowMid.position.set(0, 0.52, 0);
shoulderRoot.add(elbowMid);

const elbowJointMesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 18, 18), jointDarkMat);
elbowJointMesh.name = "ElbowJointSphere";
elbowMid.add(elbowJointMesh);

const forearmLink = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.085, 0.54), robotOrangeMat);
forearmLink.name = "RobotForearmLink";
forearmLink.position.set(0, 0, 0.27);
elbowMid.add(forearmLink);

// IK Effector Node (`RobotGripperEffector`)
const gripperEffector = new THREE.Group();
gripperEffector.name = "RobotGripperEffector";
gripperEffector.position.set(0, 0, 0.54);
elbowMid.add(gripperEffector);

const wristCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 16), jointDarkMat);
wristCollar.name = "RobotWristCollar";
wristCollar.rotation.x = Math.PI / 2;
gripperEffector.add(wristCollar);

[-0.045, 0.045].forEach((xJaw, jIdx) => {
  const jawFinger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.08), chromeRollerMat);
  jawFinger.name = `GripperFinger_${jIdx + 1}`;
  jawFinger.position.set(xJaw, -0.04, 0.05);
  gripperEffector.add(jawFinger);
});

// Grabbable IK Target Handle (`RobotTargetHandle`)
const targetHandle = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 20), targetCyanMat);
targetHandle.name = "RobotTargetHandle";
targetHandle.position.set(0.20, 1.02, 0.35);
targetHandle.userData.xr = {
  grab: "1-hand",
  bloom: { strength: 0.85 },
  outline: { color: "#38bdf8", thickness: 0.014 }
};
scene.add(targetHandle);

// Attach Declarative 2-Bone IK Trait on Robot Cell
robotCell.userData.xr = {
  ik: {
    root: "RobotShoulderRoot",
    mid: "RobotElbowMid",
    effector: "RobotGripperEffector",
    target: "RobotTargetHandle",
    pole: [0, 1, 0]
  }
};

function animate(t) {
  targetHandle.position.x = Math.sin(t * 1.1) * 0.45;
  targetHandle.position.y = 1.02 + Math.cos(t * 2.2) * 0.08;
  if (typeof THREE.IKSolver !== "undefined" && THREE.IKSolver.solveTwoBone) {
    THREE.IKSolver.solveTwoBone(
      shoulderRoot,
      elbowMid,
      gripperEffector,
      targetHandle.position,
      new THREE.Vector3(0, 1, 0)
    );
  }
}

camera.position.set(1.95, 1.65, 2.25);
camera.lookAt(0, 0.65, 0);
