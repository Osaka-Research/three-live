// Cast-Iron Flanged Industrial Gate Valve (~0.4m wide) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.3);
keyLight.name = "key_directional_light";
keyLight.position.set(1.5, 2.2, 1.8);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x99bbff, 0.8, 3.0);
rimLight.name = "rim_point_light";
rimLight.position.set(-1.0, 0.8, -1.0);
scene.add(rimLight);

const valveGroup = new THREE.Group();
valveGroup.name = "flanged_gate_valve";
scene.add(valveGroup);

// Materials
const castIronMat = new THREE.MeshStandardMaterial({
  color: 0x3b4248,
  metalness: 0.72,
  roughness: 0.55
});

const machinedSteelMat = new THREE.MeshStandardMaterial({
  color: 0xb8c0c8,
  metalness: 0.9,
  roughness: 0.22
});

const brassStemMat = new THREE.MeshStandardMaterial({
  color: 0xc89d3c,
  metalness: 0.85,
  roughness: 0.28
});

const redWheelMat = new THREE.MeshStandardMaterial({
  color: 0xc8231c,
  metalness: 0.35,
  roughness: 0.32
});

// Center of horizontal pipe axis at y = 0.11 (so lowest flange edge rests at y = 0)
const pipeY = 0.11;

// 1. Horizontal Pipe Body with CSG Hollow Bore (<= 24 segments for CSG limit)
const outerPipeMesh = new THREE.Mesh(
  new THREE.CylinderGeometry(0.068, 0.068, 0.36, 20),
  castIronMat
);
outerPipeMesh.rotation.z = Math.PI / 2;

const innerBoreCutter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.048, 0.048, 0.42, 20),
  castIronMat
);
innerBoreCutter.rotation.z = Math.PI / 2;

const hollowPipeBody = THREE.CSG.subtract(outerPipeMesh, innerBoreCutter);
hollowPipeBody.material = castIronMat;
hollowPipeBody.name = "t_body_horizontal_run";
hollowPipeBody.position.set(0, pipeY, 0);
valveGroup.add(hollowPipeBody);

// Central bulged valve chamber
const centralChamber = new THREE.Mesh(
  new THREE.CylinderGeometry(0.082, 0.082, 0.15, 24),
  castIronMat
);
centralChamber.name = "valve_gate_chamber";
centralChamber.position.set(0, pipeY + 0.03, 0);
valveGroup.add(centralChamber);

// 2. Circular Bolted End Flanges (left x = -0.18, right x = +0.18, radius = 0.11)
for (const side of [-1, 1]) {
  const flangeNamePrefix = side < 0 ? "left" : "right";
  const flangeX = side * 0.18;

  // Main flange disk with bore cut via CSG
  const flangeDiskRaw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.024, 24),
    castIronMat
  );
  flangeDiskRaw.rotation.z = Math.PI / 2;

  const flangeBoreRaw = new THREE.Mesh(
    new THREE.CylinderGeometry(0.048, 0.048, 0.04, 20),
    castIronMat
  );
  flangeBoreRaw.rotation.z = Math.PI / 2;

  const flangeDisk = THREE.CSG.subtract(flangeDiskRaw, flangeBoreRaw);
  flangeDisk.material = castIronMat;
  flangeDisk.name = `${flangeNamePrefix}_end_flange`;
  flangeDisk.position.set(flangeX, pipeY, 0);
  valveGroup.add(flangeDisk);

  // Machined raised gasket face
  const raisedFace = new THREE.Mesh(
    new THREE.CylinderGeometry(0.076, 0.076, 0.004, 24),
    machinedSteelMat
  );
  raisedFace.name = `${flangeNamePrefix}_raised_gasket_face`;
  raisedFace.rotation.z = Math.PI / 2;
  raisedFace.position.set(flangeX + side * 0.013, pipeY, 0);
  valveGroup.add(raisedFace);

  // 8 Hex Bolts around the flange rim
  const boltCircleR = 0.09;
  for (let b = 0; b < 8; b++) {
    const theta = (b / 8) * Math.PI * 2;
    const by = pipeY + Math.cos(theta) * boltCircleR;
    const bz = Math.sin(theta) * boltCircleR;

    const boltHead = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0085, 0.0085, 0.036, 6),
      machinedSteelMat
    );
    boltHead.name = `${flangeNamePrefix}_flange_bolt_${b + 1}`;
    boltHead.rotation.z = Math.PI / 2;
    boltHead.position.set(flangeX, by, bz);
    valveGroup.add(boltHead);
  }
}

// 3. Vertical Bonnet Neck & Extruded Oval Bonnet Flange Plate
const bonnetShape = new THREE.Shape();
bonnetShape.absarc(0, 0, 0.088, 0, Math.PI * 2, false);
const bonnetHole = new THREE.Path();
bonnetHole.absarc(0, 0, 0.04, 0, Math.PI * 2, true);
bonnetShape.holes.push(bonnetHole);

const bonnetFlangeGeo = new THREE.ExtrudeGeometry(bonnetShape, {
  depth: 0.026,
  bevelEnabled: true,
  bevelThickness: 0.003,
  bevelSize: 0.003,
  bevelSegments: 2
});
bonnetFlangeGeo.rotateX(Math.PI / 2);

const bonnetFlange = new THREE.Mesh(bonnetFlangeGeo, castIronMat);
bonnetFlange.name = "bonnet_joint_flange";
bonnetFlange.position.set(0, pipeY + 0.115, 0);
valveGroup.add(bonnetFlange);

// Bonnet joint bolts (6 bolts)
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const bolt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.038, 6),
    machinedSteelMat
  );
  bolt.name = `bonnet_bolt_${i + 1}`;
  bolt.position.set(Math.cos(angle) * 0.072, pipeY + 0.105, Math.sin(angle) * 0.072);
  valveGroup.add(bolt);
}

// Tapered vertical bonnet neck
const bonnetNeck = new THREE.Mesh(
  new THREE.CylinderGeometry(0.046, 0.068, 0.11, 24),
  castIronMat
);
bonnetNeck.name = "vertical_bonnet_neck";
bonnetNeck.position.set(0, pipeY + 0.17, 0);
valveGroup.add(bonnetNeck);

// Packing gland follower & brass rising stem
const packingGland = new THREE.Mesh(
  new THREE.CylinderGeometry(0.032, 0.036, 0.025, 20),
  machinedSteelMat
);
packingGland.name = "packing_gland_collar";
packingGland.position.set(0, pipeY + 0.235, 0);
valveGroup.add(packingGland);

const valveStem = new THREE.Mesh(
  new THREE.CylinderGeometry(0.015, 0.015, 0.12, 20),
  brassStemMat
);
valveStem.name = "threaded_brass_stem";
valveStem.position.set(0, pipeY + 0.295, 0);
valveGroup.add(valveStem);

// 4. Red Spoked Handwheel on Top
const handwheelGroup = new THREE.Group();
handwheelGroup.name = "red_spoked_handwheel";
handwheelGroup.position.set(0, pipeY + 0.33, 0);
valveGroup.add(handwheelGroup);

const wheelRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.115, 0.012, 16, 36),
  redWheelMat
);
wheelRim.name = "handwheel_torus_rim";
wheelRim.rotation.x = Math.PI / 2;
handwheelGroup.add(wheelRim);

const wheelHub = new THREE.Mesh(
  new THREE.CylinderGeometry(0.026, 0.028, 0.028, 20),
  redWheelMat
);
wheelHub.name = "handwheel_central_hub";
handwheelGroup.add(wheelHub);

for (let s = 0; s < 5; s++) {
  const sAngle = (s / 5) * Math.PI * 2;
  const spoke = new THREE.Mesh(
    new THREE.CylinderGeometry(0.007, 0.009, 0.105, 12),
    redWheelMat
  );
  spoke.name = `handwheel_spoke_${s + 1}`;
  spoke.position.set(Math.cos(sAngle) * 0.06, 0, Math.sin(sAngle) * 0.06);
  spoke.rotation.z = Math.PI / 2;
  spoke.rotation.y = -sAngle;
  handwheelGroup.add(spoke);
}

const stemLockNut = new THREE.Mesh(
  new THREE.CylinderGeometry(0.02, 0.02, 0.016, 6),
  machinedSteelMat
);
stemLockNut.name = "handwheel_retaining_nut";
stemLockNut.position.set(0, 0.022, 0);
handwheelGroup.add(stemLockNut);

// Frame camera at ~2.2x bounding radius
camera.position.set(0.45, 0.36, 0.58);
camera.lookAt(0, 0.22, 0);
