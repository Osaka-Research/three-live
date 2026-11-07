// Deep-Sea Research Submersible (~2.2m long) with 7-Blade Bronze Propeller on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff8e8, 1.35);
keyLight.name = "key_directional_light";
keyLight.position.set(2.5, 3.5, 2.8);
scene.add(keyLight);

const waterRimLight = new THREE.DirectionalLight(0x44aaff, 0.75);
waterRimLight.name = "underwater_rim_light";
waterRimLight.position.set(-2.5, 1.5, -2.2);
scene.add(waterRimLight);

const subGroup = new THREE.Group();
subGroup.name = "deep_sea_research_submersible";
scene.add(subGroup);

// Materials
const yellowHullMat = new THREE.MeshPhysicalMaterial({
  color: 0xf5b800,
  metalness: 0.25,
  roughness: 0.22,
  clearcoat: 0.85,
  clearcoatRoughness: 0.1
});

const darkBallastMat = new THREE.MeshStandardMaterial({
  color: 0x242930,
  metalness: 0.65,
  roughness: 0.42
});

const titaniumFrameMat = new THREE.MeshStandardMaterial({
  color: 0xb8c2cc,
  metalness: 0.88,
  roughness: 0.24
});

const acrylicViewportMat = new THREE.MeshPhysicalMaterial({
  color: 0xd8f4ff,
  transmission: 0.92,
  ior: 1.49,
  thickness: 0.06,
  roughness: 0.04,
  metalness: 0.0,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.95,
  attenuationColor: 0x66ccff,
  attenuationDistance: 0.8
});

const bronzePropMat = new THREE.MeshStandardMaterial({
  color: 0xc88d32,
  metalness: 0.9,
  roughness: 0.2
});

const seatInteriorMat = new THREE.MeshStandardMaterial({
  color: 0x333a42,
  metalness: 0.2,
  roughness: 0.6
});

// Centerline of hull at y = 0.56m so landing skids sit cleanly at y = 0
const hullY = 0.56;

// 1. Landing Skids (y = 0 to y = 0.18m)
for (const side of [-1, 1]) {
  const skidTag = side < 0 ? "port" : "starboard";
  const skidRunner = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.04, 1.35),
    titaniumFrameMat
  );
  skidRunner.name = `landing_skid_runner_${skidTag}`;
  skidRunner.position.set(side * 0.36, 0.02, 0.05);
  subGroup.add(skidRunner);

  for (const sz of [-0.42, 0.48]) {
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.26, 12),
      titaniumFrameMat
    );
    strut.name = `landing_skid_strut_${skidTag}_${sz < 0 ? "aft" : "fwd"}`;
    strut.position.set(side * 0.31, 0.14, sz);
    strut.rotation.z = side * 0.32;
    subGroup.add(strut);
  }
}

// 2. Yellow Streamlined Pressure Hull (~2.2m total length along Z, bow at +Z, stern at -Z)
const midHullCylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 0.95, 32),
  yellowHullMat
);
midHullCylinder.name = "yellow_pressure_hull_midbody";
midHullCylinder.rotation.x = Math.PI / 2;
midHullCylinder.position.set(0, hullY, 0.12);
subGroup.add(midHullCylinder);

// Tapered stern tail cone
const sternCone = new THREE.Mesh(
  new THREE.ConeGeometry(0.42, 0.85, 32),
  yellowHullMat
);
sternCone.name = "streamlined_stern_tail_cone";
sternCone.rotation.x = -Math.PI / 2;
sternCone.position.set(0, hullY, -0.78);
subGroup.add(sternCone);

// Lower dark ballast keel fairing
const keelBelly = new THREE.Mesh(
  new THREE.BoxGeometry(0.56, 0.16, 1.15),
  darkBallastMat
);
keelBelly.name = "ballast_keel_fairing";
keelBelly.position.set(0, hullY - 0.34, 0.06);
subGroup.add(keelBelly);

// 3. Thick Acrylic Hemispherical Bow Viewport (+Z) & Interior Pilot Console
const viewportFlange = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 0.06, 32),
  titaniumFrameMat
);
viewportFlange.name = "bow_viewport_retaining_bezel";
viewportFlange.rotation.x = Math.PI / 2;
viewportFlange.position.set(0, hullY, 0.62);
subGroup.add(viewportFlange);

const bowAcrylicDome = new THREE.Mesh(
  new THREE.SphereGeometry(0.4, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2),
  acrylicViewportMat
);
bowAcrylicDome.name = "acrylic_hemispherical_bow_viewport";
bowAcrylicDome.rotation.x = Math.PI / 2;
bowAcrylicDome.position.set(0, hullY, 0.64);
subGroup.add(bowAcrylicDome);

// Visible pilot seat & control yoke inside the transmissive bow dome
const pilotSeat = new THREE.Mesh(
  new THREE.BoxGeometry(0.32, 0.36, 0.28),
  seatInteriorMat
);
pilotSeat.name = "interior_pilot_seat";
pilotSeat.position.set(0, hullY - 0.06, 0.45);
subGroup.add(pilotSeat);

// 4. Conning Tower Sail with Access Hatch & Hydroplane Dive Planes
const conningSail = new THREE.Mesh(
  new THREE.CylinderGeometry(0.2, 0.25, 0.38, 24),
  yellowHullMat
);
conningSail.name = "conning_tower_sail";
conningSail.scale.set(0.85, 1.0, 1.45);
conningSail.position.set(0, hullY + 0.52, 0.18);
subGroup.add(conningSail);

const topHatch = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24),
  titaniumFrameMat
);
topHatch.name = "conning_tower_hatch_cover";
topHatch.position.set(0, hullY + 0.72, 0.18);
subGroup.add(topHatch);

for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "port" : "starboard";
  const divePlane = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.028, 0.16),
    darkBallastMat
  );
  divePlane.name = `sail_dive_plane_${sideTag}`;
  divePlane.position.set(side * 0.28, hullY + 0.54, 0.2);
  divePlane.rotation.x = 0.12;
  subGroup.add(divePlane);
}

// 5. Lateral Vectored Thruster Pods
for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "port" : "starboard";
  const thrusterPod = new THREE.Group();
  thrusterPod.name = `vectored_thruster_pod_${sideTag}`;
  thrusterPod.position.set(side * 0.52, hullY + 0.05, -0.05);
  subGroup.add(thrusterPod);

  constductShroud = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.18, 20, 1, true),
    darkBallastMat
  );
  constductShroud.name = `thruster_shroud_${sideTag}`;
  constductShroud.rotation.x = Math.PI / 2;
  thrusterPod.add(constductShroud);

  const podMountStrut = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.16, 12),
    titaniumFrameMat
  );
  podMountStrut.name = `thruster_pylon_${sideTag}`;
  podMountStrut.rotation.z = Math.PI / 2;
  podMountStrut.position.set(-side * 0.08, 0, 0);
  thrusterPod.add(podMountStrut);
}

// 6. Skewed 7-Blade Bronze Stern Propeller (at z = -1.24)
const propAssembly = new THREE.Group();
propAssembly.name = "seven_blade_stern_propeller";
propAssembly.position.set(0, hullY, -1.24);
subGroup.add(propAssembly);

const propSpinner = new THREE.Mesh(
  new THREE.ConeGeometry(0.085, 0.18, 24),
  bronzePropMat
);
propSpinner.name = "bronze_propeller_hub_cone";
propSpinner.rotation.x = -Math.PI / 2;
propSpinner.position.set(0, 0, -0.04);
propAssembly.add(propSpinner);

for (let b = 0; b < 7; b++) {
  const bladeAngle = (b / 7) * Math.PI * 2;
  const bladePivot = new THREE.Group();
  bladePivot.name = `propeller_blade_arm_${b + 1}`;
  bladePivot.rotation.z = bladeAngle;
  propAssembly.add(bladePivot);

  const bladeMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.022, 0.21, 12),
    bronzePropMat
  );
  bladeMesh.name = `skewed_bronze_blade_${b + 1}`;
  bladeMesh.scale.set(1.0, 1.0, 0.18);
  bladeMesh.position.set(0, 0.13, 0);
  bladeMesh.rotation.y = 0.58; // Hydrodynamic pitch angle
  bladeMesh.rotation.z = -0.24; // Skewed sweep angle
  bladePivot.add(bladeMesh);
}

// Cruciform tail rudder & stern stabilizer fins forward of the propeller
for (let f = 0; f < 4; f++) {
  const fAng = (f * Math.PI) / 2;
  const fin = new THREE.Mesh(
    new THREE.BoxGeometry(0.024, 0.34, 0.22),
    yellowHullMat
  );
  fin.name = `stern_stabilizer_fin_${f + 1}`;
  fin.position.set(
    Math.cos(fAng) * 0.22,
    hullY + Math.sin(fAng) * 0.22,
    -1.02
  );
  fin.rotation.z = fAng - Math.PI / 2;
  subGroup.add(fin);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(2.15, 1.35, 2.35);
camera.lookAt(0, 0.56, -0.08);
