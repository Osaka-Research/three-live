// mat_16: Holographic Sci-Fi Tactical Star Map Table
const root = new THREE.Group();
root.name = "SciFiTacticalHolotableRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "HolotableAmbientLight";
scene.add(ambientLight);

const bridgeDirLight = new THREE.DirectionalLight(0x88b0e8, 0.9);
bridgeDirLight.name = "CommandBridgeDirectionalLight";
bridgeDirLight.position.set(1.5, 2.8, 1.8);
scene.add(bridgeDirLight);

const holoCyanLight = new THREE.PointLight(0x00f0ff, 2.8, 3.0);
holoCyanLight.name = "HologramCoreCyanLight";
holoCyanLight.position.set(0.0, 1.05, 0.0);
scene.add(holoCyanLight);

const holoVioletLight = new THREE.PointLight(0xb833ff, 2.0, 2.5);
holoVioletLight.name = "HologramOuterVioletLight";
holoVioletLight.position.set(0.0, 1.25, 0.0);
scene.add(holoVioletLight);

// Materials
const gunmetalArmorMat = new THREE.MeshStandardMaterial({
  color: 0x1b222c,
  metalness: 0.88,
  roughness: 0.26
});

const brushedTitaniumMat = new THREE.MeshStandardMaterial({
  color: 0x626f7e,
  metalness: 0.92,
  roughness: 0.2
});

const emitterLensMat = new THREE.MeshPhysicalMaterial({
  color: 0x00f2ff,
  emissive: 0x00a8dd,
  emissiveIntensity: 1.5,
  roughness: 0.05,
  transmission: 0.85,
  ior: 1.55,
  thickness: 0.04,
  clearcoat: 1.0
});

const holoSunMat = new THREE.MeshPhysicalMaterial({
  color: 0x66ffff,
  emissive: 0x00eeff,
  emissiveIntensity: 2.6,
  roughness: 0.1,
  transmission: 0.78,
  ior: 1.4,
  transparent: true,
  opacity: 0.92
});

const holoCyanPlanetMat = new THREE.MeshPhysicalMaterial({
  color: 0x00e5ff,
  emissive: 0x00b8ff,
  emissiveIntensity: 1.7,
  roughness: 0.12,
  transmission: 0.86,
  ior: 1.38,
  thickness: 0.05,
  transparent: true,
  opacity: 0.82
});

const holoVioletPlanetMat = new THREE.MeshPhysicalMaterial({
  color: 0xd544ff,
  emissive: 0x9922ff,
  emissiveIntensity: 1.8,
  roughness: 0.12,
  transmission: 0.86,
  ior: 1.38,
  thickness: 0.05,
  transparent: true,
  opacity: 0.82
});

const wireframeOrbitMat = new THREE.MeshStandardMaterial({
  color: 0x00f6ff,
  emissive: 0x00d8ff,
  emissiveIntensity: 2.0,
  wireframe: true
});

const violetOrbitMat = new THREE.MeshStandardMaterial({
  color: 0xc44dff,
  emissive: 0xa622ff,
  emissiveIntensity: 1.9,
  wireframe: true
});

const projectionConeMat = new THREE.MeshPhysicalMaterial({
  color: 0x00e8ff,
  emissive: 0x0088cc,
  emissiveIntensity: 0.8,
  roughness: 0.2,
  transmission: 0.9,
  transparent: true,
  opacity: 0.18
});

// 1. Circular Metallic Command Holotable Pedestal & Console Rim (resting on y = 0, radius ~0.68m, table height 0.78m)
const tableGroup = new THREE.Group();
tableGroup.name = "MetallicCommandHolotableGroup";
root.add(tableGroup);

const floorDeckRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.62, 0.68, 0.05, 32),
  gunmetalArmorMat
);
floorDeckRing.name = "HolotableFloorBasePlinth";
floorDeckRing.position.set(0, 0.025, 0);
tableGroup.add(floorDeckRing);

const centralPillar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.36, 0.62, 24),
  gunmetalArmorMat
);
centralPillar.name = "HolotableCentralPillar";
centralPillar.position.set(0, 0.36, 0);
tableGroup.add(centralPillar);

// 6 Angled structural buttress struts around the pedestal
for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const strut = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.64, 0.16),
    brushedTitaniumMat
  );
  strut.name = "HolotableButtressStrut_" + i;
  strut.position.set(Math.cos(angle) * 0.38, 0.38, Math.sin(angle) * 0.38);
  strut.rotation.y = -angle + Math.PI / 2;
  strut.rotation.x = 0.24;
  tableGroup.add(strut);
}

// Upper circular command console deck & beveled tactical control ring
const consoleTabletop = new THREE.Mesh(
  new THREE.CylinderGeometry(0.66, 0.56, 0.12, 32),
  gunmetalArmorMat
);
consoleTabletop.name = "HolotableMainConsoleDeck";
consoleTabletop.position.set(0, 0.72, 0);
tableGroup.add(consoleTabletop);

const consoleOuterRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.65, 0.032, 16, 48),
  brushedTitaniumMat
);
consoleOuterRim.name = "HolotableOuterBezelRing";
consoleOuterRim.rotation.x = Math.PI / 2;
consoleOuterRim.position.set(0, 0.78, 0);
tableGroup.add(consoleOuterRim);

// Central Holographic Emitter Lens Well at y = 0.78
const lensBezel = new THREE.Mesh(
  new THREE.TorusGeometry(0.26, 0.018, 16, 36),
  brushedTitaniumMat
);
lensBezel.name = "EmitterLensBezelRing";
lensBezel.rotation.x = Math.PI / 2;
lensBezel.position.set(0, 0.785, 0);
tableGroup.add(lensBezel);

const emitterLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.25, 0.25, 0.02, 32),
  emitterLensMat
);
emitterLens.name = "HolotableCentralEmitterLens";
emitterLens.position.set(0, 0.78, 0);
tableGroup.add(emitterLens);

// Translucent volumetric projection cone rising from emitter lens
const projCone = new THREE.Mesh(
  new THREE.CylinderGeometry(0.54, 0.24, 0.38, 28, 1, true),
  projectionConeMat
);
projCone.name = "HologramVolumetricProjectionBeam";
projCone.position.set(0, 0.97, 0);
tableGroup.add(projCone);

// 2. Projected 3D Star System Hologram floating at y = 1.12m
const holoSystemGroup = new THREE.Group();
holoSystemGroup.name = "Projected3DStarSystemGroup";
holoSystemGroup.position.set(0, 1.12, 0);
root.add(holoSystemGroup);

// Central Holographic Star + Wireframe Geodesic Cage
const centralStar = new THREE.Mesh(
  new THREE.SphereGeometry(0.085, 24, 18),
  holoSunMat
);
centralStar.name = "HologramCentralStar";
centralStar.userData.xr = { bloom: { strength: 0.9 } };
holoSystemGroup.add(centralStar);

const starWireCage = new THREE.Mesh(
  new THREE.SphereGeometry(0.102, 12, 10),
  wireframeOrbitMat
);
starWireCage.name = "HologramStarWireframeShell";
holoSystemGroup.add(starWireCage);

// 4 Concentric & Inclined Wireframe Orbital Rings (TorusGeometry) + Planet Spheres
const orbitData = [
  { r: 0.19, tiltX: 0.08, tiltZ: -0.05, angle: 0.6, pRadius: 0.024, pMat: holoCyanPlanetMat, oMat: wireframeOrbitMat, hasRing: false },
  { r: 0.30, tiltX: -0.14, tiltZ: 0.10, angle: 2.3, pRadius: 0.036, pMat: holoVioletPlanetMat, oMat: violetOrbitMat, hasRing: false },
  { r: 0.42, tiltX: 0.12, tiltZ: 0.08, angle: -1.1, pRadius: 0.048, pMat: holoCyanPlanetMat, oMat: wireframeOrbitMat, hasRing: true },
  { r: 0.54, tiltX: -0.22, tiltZ: -0.15, angle: 3.8, pRadius: 0.030, pMat: holoVioletPlanetMat, oMat: violetOrbitMat, hasRing: false }
];

for (let i = 0; i < orbitData.length; i++) {
  const od = orbitData[i];
  const planeGroup = new THREE.Group();
  planeGroup.name = "OrbitalPlaneGroup_" + i;
  planeGroup.rotation.x = od.tiltX;
  planeGroup.rotation.z = od.tiltZ;
  holoSystemGroup.add(planeGroup);

  const orbitRing = new THREE.Mesh(
    new THREE.TorusGeometry(od.r, 0.0035, 8, 48),
    od.oMat
  );
  orbitRing.name = "WireframeOrbitalRing_" + i;
  orbitRing.rotation.x = Math.PI / 2;
  planeGroup.add(orbitRing);

  const px = Math.cos(od.angle) * od.r;
  const pz = Math.sin(od.angle) * od.r;

  const planetSphere = new THREE.Mesh(
    new THREE.SphereGeometry(od.pRadius, 20, 16),
    od.pMat
  );
  planetSphere.name = "HologramPlanetSphere_" + i;
  planetSphere.position.set(px, 0, pz);
  planeGroup.add(planetSphere);

  if (od.hasRing) {
    const pRing = new THREE.Mesh(
      new THREE.TorusGeometry(od.pRadius * 1.85, 0.004, 8, 28),
      violetOrbitMat
    );
    pRing.name = "HologramGasGiantRing_" + i;
    pRing.rotation.x = Math.PI / 2 + 0.35;
    pRing.position.set(px, 0, pz);
    planeGroup.add(pRing);
  }

  // Floating Tactical Coordinate Marker Pin & Target Reticle above each planet
  const markerStem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0018, 0.0018, 0.09, 8),
    od.oMat
  );
  markerStem.name = "CoordinateMarkerStem_" + i;
  markerStem.position.set(px, od.pRadius + 0.045, pz);
  planeGroup.add(markerStem);

  const markerReticle = new THREE.Mesh(
    new THREE.TorusGeometry(0.022, 0.0025, 6, 6),
    od.oMat
  );
  markerReticle.name = "FloatingCoordinateMarkerReticle_" + i;
  markerReticle.position.set(px, od.pRadius + 0.095, pz);
  planeGroup.add(markerReticle);
}

// Outer azimuthal tactical compass ring around the hologram
const azimuthCompassRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.60, 0.004, 8, 64),
  wireframeOrbitMat
);
azimuthCompassRing.name = "TacticalAzimuthCompassRing";
azimuthCompassRing.rotation.x = Math.PI / 2;
holoSystemGroup.add(azimuthCompassRing);

// Camera framing (~2.2x bounding radius ~0.85m -> distance ~1.95m)
camera.position.set(0.0, 1.38, 1.85);
camera.lookAt(0, 0.85, 0);
