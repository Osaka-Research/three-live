scene.add(new THREE.AmbientLight(0x0f172a, 0.5));
const emergencyLight = new THREE.PointLight(0xef4444, 2.2, 6, 2);
emergencyLight.position.set(0, 1.7, 0);
scene.add(emergencyLight);

// First-person responder rig
const responder = new THREE.Group();
responder.position.set(0, 0, 1.25);
responder.userData.xr = {
  character: 'first-person',
  speed: 1.35,
  height: 1.65
};
scene.add(responder);

// Server room floor and server cabinet racks
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(3.8, 0.04, 3.8),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 })
);
floor.position.set(0, 0, 0);
scene.add(floor);

const rackGeo = new THREE.BoxGeometry(0.55, 1.75, 0.65);
const rackMat = new THREE.MeshStandardMaterial({ color: 0x090d16, metalness: 0.7, roughness: 0.3 });
[-1.0, 1.0].forEach((x) => {
  [-0.55, 0.55].forEach((z) => {
    const rack = new THREE.Mesh(rackGeo, rackMat);
    rack.position.set(x, 0.88, z);
    rack.userData.xr = {
      target: 'server_cabinet',
      integrity: { max: 100, current: 80, damagePerSec: 3.0 }
    };
    scene.add(rack);
  });
});

// Flame hazard spawner with flame template node
const hazardSpawner = new THREE.Group();
hazardSpawner.position.set(-0.65, 0.08, -0.55);
hazardSpawner.userData.xr = {
  type: 'xr-live-sim',
  spawner: { intervalSec: 3, maxActive: 3, radius: 0.35 }
};

const flameBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.16, 0.05, 16),
  new THREE.MeshStandardMaterial({ color: 0x334155 })
);
const flameCore = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 16, 16),
  new THREE.MeshBasicMaterial({ color: 0xf97316 })
);
flameCore.position.y = 0.11;
hazardSpawner.add(flameBase, flameCore);
scene.add(hazardSpawner);

// Evacuation zone and objective node
const evacZone = new THREE.Mesh(
  new THREE.CylinderGeometry(0.48, 0.48, 0.02, 24),
  new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.45 })
);
evacZone.position.set(0, 0.025, 1.35);
evacZone.userData.xr = {
  zone: 'evacuation',
  objective: { id: 'obj_evac_01', title: 'Evacuate Drill Area', completeOnEnter: true }
};
scene.add(evacZone);
