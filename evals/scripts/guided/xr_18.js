// Zero-Gravity Orbital Airlock Maintenance Bay (xr_18)
scene.background = new THREE.Color(0x050811);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const bayDirLight = new THREE.DirectionalLight(0xe0f2fe, 1.1);
bayDirLight.name = "AirlockBulkheadLight";
bayDirLight.position.set(2.0, 3.5, 2.5);
scene.add(bayDirLight);

const cabinPointLight = new THREE.PointLight(0x38bdf8, 1.5, 4.5);
cabinPointLight.name = "AirlockInteriorPointLight";
cabinPointLight.position.set(0, 1.35, 0);
scene.add(cabinPointLight);

// Materials
const hullAlloyMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
const bulkheadDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.35 });
const evaHandholdYellowMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  roughness: 0.35,
  metalness: 0.3
});
const toolChromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.92, roughness: 0.16 });
const toolGripBlueMat = new THREE.MeshStandardMaterial({
  color: 0x0284c7,
  emissive: 0x0369a1,
  emissiveIntensity: 0.45,
  roughness: 0.4
});
const socketRackMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.75
});

// Cylindrical Space-Station Airlock Bay (resting on cradle at y = 0)
const airlockBay = new THREE.Group();
airlockBay.name = "OrbitalAirlockMaintenanceBay";
airlockBay.userData.xr = {
  anchor: "Floor",
  physics: { body: "static", collider: "mesh", mass: 0, restitution: 0.3, friction: 0.5 }
};
scene.add(airlockBay);

// Lower Deck Floor Grating (at y = 0.04)
const deckGrating = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.95), bulkheadDarkMat);
deckGrating.name = "AirlockDeckFloorGrating";
deckGrating.position.set(0, 0.04, 0);
airlockBay.add(deckGrating);

// 3 Structural Cylindrical Rib Bulkheads (`TorusGeometry`)
[-0.82, 0.0, 0.82].forEach((zPos, idx) => {
  const ribRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.15, 0.065, 16, 36, Math.PI * 1.25),
    hullAlloyMat
  );
  ribRing.name = `AirlockPressureRib_${idx + 1}`;
  ribRing.rotation.z = -Math.PI * 0.125;
  ribRing.position.set(0, 1.15, zPos);
  airlockBay.add(ribRing);
});

// Rear Pressure Hatch Door Assembly (`CylinderGeometry` + Viewport)
const rearHatchGroup = new THREE.Group();
rearHatchGroup.name = "AirlockPressureHatchDoor";
rearHatchGroup.position.set(0, 1.15, -0.92);
airlockBay.add(rearHatchGroup);

const hatchDoorDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(0.76, 0.76, 0.10, 28),
  hullAlloyMat
);
hatchDoorDisc.name = "HatchBulkheadDisc";
hatchDoorDisc.rotation.x = Math.PI / 2;
rearHatchGroup.add(hatchDoorDisc);

const hatchWheel = new THREE.Mesh(
  new THREE.TorusGeometry(0.22, 0.024, 12, 24),
  evaHandholdYellowMat
);
hatchWheel.name = "HatchDoggingWheel";
hatchWheel.position.z = 0.07;
rearHatchGroup.add(hatchWheel);

// EVA Crew Handhold Rails along Interior Walls
[
  [-0.92, 1.15, -0.35],
  [-0.92, 1.15, 0.35],
  [0.92, 1.15, -0.35],
  [0.92, 1.15, 0.35]
].forEach((hp, idx) => {
  const handhold = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.04, 0.42),
    evaHandholdYellowMat
  );
  handhold.name = `EVAHandholdGrabBar_${idx + 1}`;
  handhold.position.set(hp[0], hp[1], hp[2]);
  airlockBay.add(handhold);
});

// Magnetic Wall Tool Rack with `snapSocket` (`toolrack`)
const toolRackSocket = new THREE.Group();
toolRackSocket.name = "MagneticToolRackSocket";
toolRackSocket.position.set(-0.82, 1.15, 0.0);
toolRackSocket.userData.xr = {
  snapSocket: { id: "toolrack", radius: 0.18 }
};
airlockBay.add(toolRackSocket);

const rackBackplate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 0.68), bulkheadDarkMat);
rackBackplate.name = "ToolRackBackplate";
toolRackSocket.add(rackBackplate);

const rackMagneticStrip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.62), socketRackMat);
rackMagneticStrip.name = "ToolRackMagneticStrip";
toolRackSocket.add(rackMagneticStrip);

// 4 Floating Zero-Gravity Maintenance Tools (`grab: '1-hand'`, zero-gravity dynamic physics, `snapTo`)
const toolSpecs = [
  { name: "ZeroGTorqueWrench", pos: [-0.28, 1.18, 0.15], rot: [0.3, 0.5, -0.2] },
  { name: "ZeroGPlasmaCutter", pos: [0.22, 1.32, -0.10], rot: [-0.4, 0.2, 0.6] },
  { name: "ZeroGDiagnosticProbe", pos: [0.05, 0.96, 0.28], rot: [0.2, -0.6, 0.3] },
  { name: "ZeroGPneumaticDriver", pos: [-0.15, 1.44, -0.24], rot: [-0.2, 0.4, -0.5] }
];

const floatingTools = [];
toolSpecs.forEach((spec, idx) => {
  const toolGroup = new THREE.Group();
  toolGroup.name = spec.name;
  toolGroup.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  toolGroup.rotation.set(spec.rot[0], spec.rot[1], spec.rot[2]);
  toolGroup.userData.xr = {
    grab: "1-hand",
    physics: {
      body: "dynamic",
      collider: "hull",
      mass: 0.45,
      restitution: 0.5,
      friction: 0.2
    },
    snapTo: { radius: 0.18, targets: ["MagneticToolRackSocket"] },
    outline: { color: "#38bdf8", thickness: 0.012 }
  };
  toolGroup.userData.state = {
    gravityScale: 0,
    linearDamping: 0.2,
    socketTag: "toolrack"
  };

  const handleGrip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.024, 0.16, 16),
    toolGripBlueMat
  );
  handleGrip.name = `${spec.name}_HandleGrip`;
  toolGroup.add(handleGrip);

  const toolHead = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.045, 0.045),
    toolChromeMat
  );
  toolHead.name = `${spec.name}_HeadUnit`;
  toolHead.position.y = 0.095;
  toolGroup.add(toolHead);

  scene.add(toolGroup);
  floatingTools.push({ group: toolGroup, basePos: spec.pos, phase: idx * 1.3 });
});

function animate(t) {
  floatingTools.forEach((ft) => {
    ft.group.position.y = ft.basePos[1] + Math.sin(t * 1.1 + ft.phase) * 0.055;
    ft.group.rotation.x += 0.003;
    ft.group.rotation.y += 0.004;
  });
}

camera.position.set(0.0, 1.35, 3.15);
camera.lookAt(0, 1.05, 0);
