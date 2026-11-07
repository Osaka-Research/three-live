// Warehouse Forklift Safety Drill with Steering Agents (xr_06)
scene.background = new THREE.Color(0x0f172a);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const highBayLight = new THREE.DirectionalLight(0xf8fafc, 1.15);
highBayLight.name = "WarehouseHighBayLight";
highBayLight.position.set(4.0, 6.5, 4.0);
scene.add(highBayLight);

// Materials
const concreteFloorMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.05 });
const safetyLineMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  emissive: 0xca8a04,
  emissiveIntensity: 0.35,
  roughness: 0.5
});
const rackBlueMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.6, roughness: 0.4 });
const rackBeamOrangeMat = new THREE.MeshStandardMaterial({ color: 0xea580c, metalness: 0.5, roughness: 0.4 });
const cardboardMat = new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.85 });
const forkliftYellowMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.45, roughness: 0.3 });
const darkSteelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.35 });
const checkpointGreenMat = new THREE.MeshStandardMaterial({
  color: 0x10b981,
  emissive: 0x059669,
  emissiveIntensity: 0.85,
  transparent: true,
  opacity: 0.78
});

// Walkable Warehouse Floor (PlaneGeometry + Static Slab at y = 0)
const warehouseFloor = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 4.6), concreteFloorMat);
warehouseFloor.name = "WarehouseWalkableFloor";
warehouseFloor.rotation.x = -Math.PI / 2;
warehouseFloor.position.set(0, 0, 0);
warehouseFloor.userData.xr = {
  navigable: true,
  anchor: "Floor",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.9 }
};
scene.add(warehouseFloor);

// Safety Walkway Lane Striping
[-1.45, 1.45].forEach((zLane, idx) => {
  const laneStripe = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.008, 0.06), safetyLineMat);
  laneStripe.name = `SafetyAisleStripe_${idx + 1}`;
  laneStripe.position.set(0, 0.004, zLane);
  scene.add(laneStripe);
});

// Helper to build Industrial Pallet Racks
function createPalletRack(id, xPos, zPos) {
  const rack = new THREE.Group();
  rack.name = `WarehousePalletRack_${id}`;
  rack.position.set(xPos, 0, zPos);
  rack.userData.xr = {
    physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.8 }
  };

  const uprightOffsets = [
    [-0.75, -0.28],
    [0.75, -0.28],
    [-0.75, 0.28],
    [0.75, 0.28]
  ];
  uprightOffsets.forEach((pt, idx) => {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.75, 0.06), rackBlueMat);
    post.name = `RackUpright_${id}_${idx + 1}`;
    post.position.set(pt[0], 0.875, pt[1]);
    rack.add(post);
  });

  [0.55, 1.15, 1.68].forEach((shelfY, tierIdx) => {
    const beamFront = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.06, 0.04), rackBeamOrangeMat);
    beamFront.name = `RackBeamFront_${id}_${tierIdx + 1}`;
    beamFront.position.set(0, shelfY, 0.28);
    rack.add(beamFront);

    const beamBack = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.06, 0.04), rackBeamOrangeMat);
    beamBack.name = `RackBeamBack_${id}_${tierIdx + 1}`;
    beamBack.position.set(0, shelfY, -0.28);
    rack.add(beamBack);

    if (tierIdx < 2) {
      [-0.4, 0.4].forEach((boxX, bIdx) => {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.42, 0.48), cardboardMat);
        crate.name = `PalletCrate_${id}_${tierIdx + 1}_${bIdx + 1}`;
        crate.position.set(boxX, shelfY + 0.24, 0);
        rack.add(crate);
      });
    }
  });

  scene.add(rack);
}

createPalletRack("NorthWest", -1.25, -1.75);
createPalletRack("NorthEast", 1.25, -1.75);

// Controllable Warehouse Worker Character (Third-Person)
const workerCharacter = new THREE.Group();
workerCharacter.name = "WarehouseWorkerCharacter";
workerCharacter.position.set(-2.1, 0, 1.65);
workerCharacter.userData.xr = {
  character: { moveSpeed: 4.0, jumpImpulse: 5.0 },
  physics: { body: "kinematic", collider: "hull", mass: 75, restitution: 0.1, friction: 0.7 }
};
scene.add(workerCharacter);

const workerTorso = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.14, 0.72, 16),
  new THREE.MeshStandardMaterial({ color: 0x84cc16, roughness: 0.4 })
);
workerTorso.name = "WorkerHiVisVestTorso";
workerTorso.position.y = 0.62;
workerCharacter.add(workerTorso);

const workerHead = new THREE.Mesh(
  new THREE.CylinderGeometry(0.11, 0.11, 0.22, 16),
  new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.5 })
);
workerHead.name = "WorkerHead";
workerHead.position.y = 1.12;
workerCharacter.add(workerHead);

const safetyHardhat = new THREE.Mesh(
  new THREE.CylinderGeometry(0.13, 0.15, 0.10, 16),
  safetyLineMat
);
safetyHardhat.name = "WorkerSafetyHardhat";
safetyHardhat.position.y = 1.25;
workerCharacter.add(safetyHardhat);

// Helper to build Autonomous Patrol Forklifts
function createPatrolForklift(id, startPos, waypoints) {
  const forklift = new THREE.Group();
  forklift.name = `AutonomousPatrolForklift_${id}`;
  forklift.position.set(startPos[0], 0, startPos[2]);
  forklift.userData.xr = {
    agent: { behavior: "patrol", speed: 2.0, waypoints: waypoints },
    physics: { body: "kinematic", collider: "box", mass: 850, restitution: 0.2, friction: 0.8 },
    audioEmitter: { src: "forklift_warning.ogg", refDistance: 2.0, loop: true }
  };

  const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.48, 0.68), forkliftYellowMat);
  chassis.name = `ForkliftChassis_${id}`;
  chassis.position.set(0, 0.34, 0);
  forklift.add(chassis);

  const cabCage = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.62, 0.62), darkSteelMat);
  cabCage.name = `ForkliftRollCage_${id}`;
  cabCage.position.set(-0.1, 0.88, 0);
  forklift.add(cabCage);

  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.25, 0.48), darkSteelMat);
  mast.name = `ForkliftVerticalMast_${id}`;
  mast.position.set(0.52, 0.68, 0);
  forklift.add(mast);

  [-0.16, 0.16].forEach((zTine, tIdx) => {
    const tine = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.035, 0.08), darkSteelMat);
    tine.name = `ForkliftTine_${id}_${tIdx + 1}`;
    tine.position.set(0.80, 0.12, zTine);
    forklift.add(tine);
  });

  const wheelOffsets = [
    [-0.32, 0.13, -0.35],
    [0.32, 0.13, -0.35],
    [-0.32, 0.13, 0.35],
    [0.32, 0.13, 0.35]
  ];
  wheelOffsets.forEach((wp, wIdx) => {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.09, 16), darkSteelMat);
    wheel.name = `ForkliftWheel_${id}_${wIdx + 1}`;
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wp[0], wp[1], wp[2]);
    forklift.add(wheel);
  });

  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.09, 12), safetyLineMat);
  beacon.name = `ForkliftAmberBeacon_${id}`;
  beacon.position.set(-0.1, 1.23, 0);
  forklift.add(beacon);

  scene.add(forklift);
  return forklift;
}

const forkliftA = createPatrolForklift(1, [-1.4, 0, -0.45], [
  [-1.8, 0, -0.45],
  [1.8, 0, -0.45],
  [1.8, 0, 0.55],
  [-1.8, 0, 0.55]
]);

const forkliftB = createPatrolForklift(2, [1.4, 0, 0.55], [
  [1.8, 0, 0.55],
  [-1.8, 0, 0.55],
  [-1.8, 0, -0.45],
  [1.8, 0, -0.45]
]);

// 3 Illuminated Safety Checkpoint Zones with Objectives
const checkpointCoords = [
  [-0.65, 1.65],
  [0.85, 1.65],
  [2.15, -0.45]
];

checkpointCoords.forEach((cp, idx) => {
  const cpNum = idx + 1;
  const zoneGroup = new THREE.Group();
  zoneGroup.name = `SafetyCheckpointZone_${cpNum}`;
  zoneGroup.position.set(cp[0], 0, cp[1]);
  zoneGroup.userData.xr = {
    zone: { kind: "goal", rate: 10, event: `safety_checkpoint_${cpNum}` },
    objective: {
      id: `checkpoint_obj_${cpNum}`,
      kind: "reach",
      target: `SafetyCheckpointZone_${cpNum}`,
      radius: 0.55
    },
    bloom: { strength: 0.75 }
  };

  const padDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 0.04, 24), checkpointGreenMat);
  padDisc.name = `CheckpointPadDisc_${cpNum}`;
  padDisc.position.y = 0.02;
  zoneGroup.add(padDisc);

  const beaconPillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.55, 24, 1, true),
    checkpointGreenMat
  );
  beaconPillar.name = `CheckpointHoloCylinder_${cpNum}`;
  beaconPillar.position.y = 0.30;
  zoneGroup.add(beaconPillar);

  scene.add(zoneGroup);
});

function animate(t) {
  forkliftA.position.x = Math.sin(t * 0.8) * 1.55;
  forkliftB.position.x = -Math.sin(t * 0.8) * 1.55;
}

camera.position.set(0.0, 3.6, 5.4);
camera.lookAt(0, 0.4, 0);
