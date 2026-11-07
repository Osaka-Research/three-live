// Drone Flight Obstacle Course with Timed Checkpoints (xr_12)
scene.background = new THREE.Color(0x060b16);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const arenaDirLight = new THREE.DirectionalLight(0xe0f2fe, 1.0);
arenaDirLight.name = "ArenaOverheadLight";
arenaDirLight.position.set(3.0, 6.0, 4.0);
scene.add(arenaDirLight);

const coursePointLight = new THREE.PointLight(0x38bdf8, 1.5, 6.0);
coursePointLight.name = "CourseCenterPointLight";
coursePointLight.position.set(0, 1.6, 0);
scene.add(coursePointLight);

// Materials
const deckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7, metalness: 0.3 });
const carbonMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.7 });
const hazardRedMat = new THREE.MeshStandardMaterial({
  color: 0xf43f5e,
  emissive: 0xe11d48,
  emissiveIntensity: 1.4,
  roughness: 0.2
});
const pylonMetalMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.85, roughness: 0.25 });

// Arena Ground Floor Grid & Takeoff Pad (at y = 0)
const arenaFloor = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.04, 4.2), deckMat);
arenaFloor.name = "DroneArenaFloor";
arenaFloor.position.set(0, 0.02, 0);
arenaFloor.userData.xr = {
  anchor: "Floor",
  navigable: true,
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.2, friction: 0.8 }
};
scene.add(arenaFloor);

// Controllable Racing Quadcopter Drone Character
const droneCharacter = new THREE.Group();
droneCharacter.name = "ControllableQuadcopterDrone";
droneCharacter.position.set(-2.0, 0.95, 1.1);
droneCharacter.userData.xr = {
  character: { moveSpeed: 5.5, jumpImpulse: 6.0 },
  grab: "1-hand",
  integrity: { hp: 100, maxHp: 100, armor: 10, onZero: "hide", scoreValue: 0 },
  audioCues: { onHit: "drone_impact.ogg", onZero: "drone_down.ogg" },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
scene.add(droneCharacter);

const droneFuselage = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.16), carbonMat);
droneFuselage.name = "DroneCarbonFuselage";
droneCharacter.add(droneFuselage);

const rotorOffsets = [
  [-0.16, 0.03, -0.16],
  [0.16, 0.03, -0.16],
  [-0.16, 0.03, 0.16],
  [0.16, 0.03, 0.16]
];
const rotorDiscs = [];
rotorOffsets.forEach((ro, idx) => {
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), carbonMat);
  arm.name = `DroneArm_${idx + 1}`;
  arm.position.set(ro[0] * 0.5, 0, ro[2] * 0.5);
  arm.rotation.x = Math.PI / 2;
  arm.rotation.z = idx % 2 === 0 ? 0.78 : -0.78;
  droneCharacter.add(arm);

  const guardRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.085, 0.008, 8, 20),
    new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 0.9 })
  );
  guardRing.name = `DronePropGuard_${idx + 1}`;
  guardRing.rotation.x = Math.PI / 2;
  guardRing.position.set(ro[0], ro[1], ro[2]);
  droneCharacter.add(guardRing);

  const propBlade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.004, 0.018), pylonMetalMat);
  propBlade.name = `DroneRotorBlade_${idx + 1}`;
  propBlade.position.set(ro[0], ro[1] + 0.01, ro[2]);
  droneCharacter.add(propBlade);
  rotorDiscs.push(propBlade);
});

// 5 Glowing Neon Checkpoint Hoop Rings (Order 1..5)
const hoopConfigs = [
  { order: 1, pos: [-1.35, 1.05, 0.65], rotY: -0.45, color: 0x38bdf8 },
  { order: 2, pos: [-0.45, 1.45, -0.55], rotY: -0.15, color: 0x22d3ee },
  { order: 3, pos: [0.45, 1.65, 0.35], rotY: 0.35, color: 0x10b981 },
  { order: 4, pos: [1.30, 1.25, -0.45], rotY: -0.35, color: 0xa855f7 },
  { order: 5, pos: [2.05, 1.05, 0.55], rotY: 0.0, color: 0xfacc15 }
];

hoopConfigs.forEach((cfg) => {
  const hoopGroup = new THREE.Group();
  const hoopName = `NeonCheckpointHoop_${cfg.order}`;
  hoopGroup.name = hoopName;
  hoopGroup.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  hoopGroup.rotation.y = cfg.rotY;
  hoopGroup.userData.xr = {
    zone: { kind: "goal", rate: 50, event: `checkpoint_${cfg.order}` },
    objective: {
      id: `checkpoint_${cfg.order}`,
      kind: "reach",
      target: hoopName,
      radius: 0.55
    },
    bloom: { strength: 0.95 }
  };
  hoopGroup.userData.state = {
    zoneShape: "sphere",
    checkpointOrder: cfg.order,
    scoreAmount: 50
  };

  // Support Stanchion to Floor
  const stanchionHeight = cfg.pos[1] - 0.42;
  const stanchion = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.035, stanchionHeight, 12),
    pylonMetalMat
  );
  stanchion.name = `${hoopName}_SupportPost`;
  stanchion.position.y = -0.42 - stanchionHeight * 0.5;
  hoopGroup.add(stanchion);

  // Glowing Neon Torus Hoop
  const neonMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.color,
    emissiveIntensity: 1.5,
    roughness: 0.15
  });
  const torusHoop = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.032, 16, 36), neonMat);
  torusHoop.name = `${hoopName}_TorusRing`;
  torusHoop.rotation.y = Math.PI / 2;
  hoopGroup.add(torusHoop);

  scene.add(hoopGroup);
});

// 3 Hazard Laser Pylons with Integrity & AudioCues
const hazardPositions = [
  [-0.90, 0.04, 0.05],
  [0.0, 0.04, -0.10],
  [0.90, 0.04, 0.0]
];

hazardPositions.forEach((hp, idx) => {
  const pylonNum = idx + 1;
  const pylonGroup = new THREE.Group();
  pylonGroup.name = `HazardLaserPylon_${pylonNum}`;
  pylonGroup.position.set(hp[0], hp[1], hp[2]);
  pylonGroup.userData.xr = {
    zone: { kind: "damage", rate: 25, event: `hazard_pylon_${pylonNum}` },
    integrity: { hp: 80, maxHp: 80, armor: 5, onZero: "destroy", scoreValue: 25 },
    audioCues: { onHit: "laser_hit.ogg", onZero: "pylon_shatter.ogg" },
    bloom: { strength: 0.85 }
  };

  const basePedestal = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.28), pylonMetalMat);
  basePedestal.name = `HazardPylonBase_${pylonNum}`;
  basePedestal.position.y = 0.09;
  pylonGroup.add(basePedestal);

  const laserBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.55, 16), hazardRedMat);
  laserBeam.name = `HazardLaserColumn_${pylonNum}`;
  laserBeam.position.y = 0.95;
  pylonGroup.add(laserBeam);

  const emitterCap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.10, 0.18), pylonMetalMat);
  emitterCap.name = `HazardPylonEmitterCap_${pylonNum}`;
  emitterCap.position.y = 1.75;
  pylonGroup.add(emitterCap);

  scene.add(pylonGroup);
});

function animate(t) {
  droneCharacter.position.y = 0.95 + Math.sin(t * 3.5) * 0.06;
  rotorDiscs.forEach((blade, i) => {
    blade.rotation.y = t * (i % 2 === 0 ? 18 : -18);
  });
}

camera.position.set(0.0, 2.75, 4.85);
camera.lookAt(0, 0.85, 0);
