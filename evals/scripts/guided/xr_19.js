// Fire Hazard Response Drill with Spawners & Objectives (xr_19)
scene.background = new THREE.Color(0x090a10);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const emergencyDirLight = new THREE.DirectionalLight(0xfde68a, 0.95);
emergencyDirLight.name = "ServerRoomOverheadLight";
emergencyDirLight.position.set(2.0, 4.5, 3.0);
scene.add(emergencyDirLight);

const firePointLight = new THREE.PointLight(0xf97316, 2.2, 4.5);
firePointLight.name = "FireHazardPointLight";
firePointLight.position.set(-0.45, 0.75, -0.35);
scene.add(firePointLight);

// Materials
const raisedFloorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6, metalness: 0.3 });
const rackCabinetMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.75, roughness: 0.35 });
const ledStatusMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.9
});
const flameCoreMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  emissive: 0xf97316,
  emissiveIntensity: 1.8,
  roughness: 0.15
});
const extinguisherRedMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, metalness: 0.4, roughness: 0.3 });
const evacZoneGreenMat = new THREE.MeshStandardMaterial({
  color: 0x10b981,
  emissive: 0x059669,
  emissiveIntensity: 0.9,
  transparent: true,
  opacity: 0.78
});

// Data Center Raised Tile Floor (at y = 0)
const serverFloor = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.04, 3.8), raisedFloorMat);
serverFloor.name = "ServerRoomRaisedFloor";
serverFloor.position.set(0, 0.02, 0);
serverFloor.userData.xr = {
  navigable: true,
  anchor: "Floor",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.85 }
};
scene.add(serverFloor);

// First-Person Emergency Responder Character & Grabbable CO2 Extinguisher
const responderCharacter = new THREE.Group();
responderCharacter.name = "FirstPersonResponderCharacter";
responderCharacter.position.set(0.0, 0.04, 1.35);
responderCharacter.userData.xr = {
  character: { moveSpeed: 4.5, jumpImpulse: 5.0 },
  integrity: { hp: 100, maxHp: 100, armor: 20, onZero: "hide", scoreValue: 0 }
};
responderCharacter.userData.state = {
  characterMode: "first-person"
};
scene.add(responderCharacter);

const responderBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.16, 0.85, 16),
  new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.5 })
);
responderBody.name = "ResponderTurnoutCoat";
responderBody.position.y = 0.45;
responderCharacter.add(responderBody);

// Grabbable CO2 Fire Extinguisher next to Responder
const extinguisher = new THREE.Group();
extinguisher.name = "CO2FireExtinguisher";
extinguisher.position.set(0.35, 0.04, 1.25);
extinguisher.userData.xr = {
  grab: "1-hand",
  physics: { body: "dynamic", collider: "hull", mass: 2.5, restitution: 0.2, friction: 0.6 },
  outline: { color: "#facc15", thickness: 0.012 }
};
scene.add(extinguisher);

const extTank = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 20), extinguisherRedMat);
extTank.name = "ExtinguisherCylinderTank";
extTank.position.y = 0.21;
extinguisher.add(extTank);

const extDome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), extinguisherRedMat);
extDome.name = "ExtinguisherTankDome";
extDome.position.y = 0.42;
extinguisher.add(extDome);

// 4 Data Center Server Blade Racks with `integrity` Targets
const rackPositions = [
  [-1.15, -0.85],
  [-0.42, -0.85],
  [0.42, -0.85],
  [1.15, -0.85]
];

rackPositions.forEach((rp, idx) => {
  const rackNum = idx + 1;
  const rackGroup = new THREE.Group();
  rackGroup.name = `DataCenterServerRack_${rackNum}`;
  rackGroup.position.set(rp[0], 0.04, rp[1]);
  rackGroup.userData.xr = {
    physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.8 },
    integrity: { hp: 100, maxHp: 100, armor: 10, onZero: "hide", scoreValue: 50 },
    audioCues: { onHit: "rack_alarm.ogg", onZero: "rack_shutdown.ogg" }
  };

  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.56, 1.65, 0.68), rackCabinetMat);
  cabinet.name = `ServerCabinetEnclosure_${rackNum}`;
  cabinet.position.y = 0.825;
  rackGroup.add(cabinet);

  for (let b = 0; b < 5; b++) {
    const bladeStrip = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.022, 0.02), ledStatusMat);
    bladeStrip.name = `ServerBladeLED_${rackNum}_${b + 1}`;
    bladeStrip.position.set(0, 0.35 + b * 0.26, 0.345);
    rackGroup.add(bladeStrip);
  }

  scene.add(rackGroup);
});

// Flame Hazard Template Node (`FlameHazardTemplate`)
const flameTemplate = new THREE.Group();
flameTemplate.name = "FlameHazardTemplate";
flameTemplate.position.set(-0.42, 0.04, -0.32);
flameTemplate.userData.xr = {
  zone: { kind: "damage", rate: 15, event: "thermal_hazard_damage" },
  integrity: { hp: 50, maxHp: 50, armor: 0, onZero: "destroy", scoreValue: 100 },
  audioEmitter: { src: "fire_crackle.ogg", refDistance: 1.8, loop: true },
  audioCues: { onHit: "extinguish_hiss.ogg", onZero: "fire_out.ogg" },
  bloom: { strength: 1.0 }
};
scene.add(flameTemplate);

const emberBase = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 14), flameCoreMat);
emberBase.name = "FlameHazardEmberCore";
emberBase.scale.set(1.2, 0.65, 1.2);
emberBase.position.y = 0.12;
flameTemplate.add(emberBase);

for (let f = 0; f < 4; f++) {
  const angle = (f / 4) * Math.PI * 2;
  const plume = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 12), flameCoreMat);
  plume.name = `FlamePlumeSphere_${f + 1}`;
  plume.scale.set(0.8, 1.8, 0.8);
  plume.position.set(Math.cos(angle) * 0.08, 0.28 + (f % 2) * 0.08, Math.sin(angle) * 0.08);
  flameTemplate.add(plume);
}

// Flame Hazard Spawner Node (`intervalSec: 3, maxActive: 3`)
const hazardSpawner = new THREE.Group();
hazardSpawner.name = "ServerRoomFlameSpawner";
hazardSpawner.position.set(-0.42, 0.04, -0.32);
hazardSpawner.userData.xr = {
  spawner: {
    template: "FlameHazardTemplate",
    intervalSec: 3.0,
    maxActive: 3
  }
};
scene.add(hazardSpawner);

// Emergency Evacuation Zone & Objective Node
const evacuationZone = new THREE.Group();
evacuationZone.name = "EmergencyEvacuationZone";
evacuationZone.position.set(1.55, 0.04, 1.15);
evacuationZone.userData.xr = {
  zone: { kind: "goal", rate: 25, event: "evacuation_safe_zone" },
  objective: {
    id: "evacuate_server_room",
    kind: "reach",
    target: "EmergencyEvacuationZone",
    radius: 0.65
  },
  bloom: { strength: 0.85 }
};
scene.add(evacuationZone);

const evacPad = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.50, 0.04, 28), evacZoneGreenMat);
evacPad.name = "EvacuationFloorBeaconPad";
evacPad.position.y = 0.02;
evacuationZone.add(evacPad);

const evacHoloRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 0.55, 24, 1, true),
  evacZoneGreenMat
);
evacHoloRing.name = "EvacuationZoneCylinder";
evacHoloRing.position.y = 0.30;
evacuationZone.add(evacHoloRing);

function animate(t) {
  const flicker = 1.0 + Math.sin(t * 12.0) * 0.12;
  flameTemplate.scale.set(1.0, flicker, 1.0);
  firePointLight.intensity = 2.0 + Math.cos(t * 15.0) * 0.4;
}

camera.position.set(0.0, 2.55, 4.35);
camera.lookAt(0, 0.65, 0);
