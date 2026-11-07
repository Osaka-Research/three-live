// Multi-User Collaborative Tactical Sand-Table (xr_16)
scene.background = new THREE.Color(0x090d16);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const commandKeyLight = new THREE.DirectionalLight(0xe0f2fe, 1.2);
commandKeyLight.name = "CommandCenterLight";
commandKeyLight.position.set(2.5, 4.5, 3.0);
scene.add(commandKeyLight);

const holoFillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
holoFillLight.name = "HoloTableFillLight";
holoFillLight.position.set(-2.0, 3.0, -2.0);
scene.add(holoFillLight);

// Materials
const steelBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.3 });
const sandTierMats = [
  new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.85 }),
  new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.82 }),
  new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.78 }),
  new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.75 })
];
const blueForceMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.75,
  roughness: 0.25
});
const redForceMat = new THREE.MeshStandardMaterial({
  color: 0xf43f5e,
  emissive: 0xe11d48,
  emissiveIntensity: 0.75,
  roughness: 0.25
});

// Shared Command Sand-Table (resting at y = 0)
const sandTable = new THREE.Group();
sandTable.name = "SharedTacticalSandTable";
sandTable.userData.xr = {
  anchor: "Table",
  handles: { rotateAxis: "y", minScale: 0.7, maxScale: 1.6 },
  snapSocket: { id: "tactical_sand_grid", radius: 0.25 }
};
scene.add(sandTable);

// Heavy Command Table Pedestal & Bezel Frame
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.72, 24), steelBaseMat);
pedestal.name = "SandTablePedestalColumn";
pedestal.position.y = 0.36;
sandTable.add(pedestal);

const tableChassis = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.10, 1.24), steelBaseMat);
tableChassis.name = "SandTableBezelChassis";
tableChassis.position.y = 0.77;
sandTable.add(tableChassis);

// Topographic Stepped Contour Tiers (4 Elevation Layers)
const tier1Base = new THREE.Mesh(new THREE.BoxGeometry(1.54, 0.03, 1.10), sandTierMats[0]);
tier1Base.name = "TopographicContourTier_1";
tier1Base.position.set(0, 0.835, 0);
sandTable.add(tier1Base);

// West Ridge Stepped Contour Layers
const westRidgeSizes = [
  [0.58, 0.035, 0.76, -0.36, 0.865, -0.06],
  [0.42, 0.035, 0.54, -0.38, 0.90, -0.08],
  [0.24, 0.035, 0.32, -0.40, 0.935, -0.10]
];
westRidgeSizes.forEach((t, idx) => {
  const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(t[0], t[1], t[2]), sandTierMats[idx + 1]);
  tierMesh.name = `WestRidgeContourTier_${idx + 2}`;
  tierMesh.position.set(t[3], t[4], t[5]);
  sandTable.add(tierMesh);
});

// East Mesa Stepped Cylindrical Contours
const eastMesaSpecs = [
  [0.34, 0.38, 0.035, 0.38, 0.865, 0.10],
  [0.24, 0.27, 0.035, 0.40, 0.90, 0.12],
  [0.13, 0.16, 0.035, 0.41, 0.935, 0.13]
];
eastMesaSpecs.forEach((m, idx) => {
  const mesaMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(m[0], m[1], m[2], 24),
    sandTierMats[idx + 1]
  );
  mesaMesh.name = `EastMesaContourTier_${idx + 2}`;
  mesaMesh.position.set(m[3], m[4], m[5]);
  sandTable.add(mesaMesh);
});

// 8 Grabbable Tactical Unit Markers (4 Blue Force, 4 Red Force) with Cylindrical Billboard Badges
const markerConfigs = [
  { id: 1, team: "Blue", pos: [-0.55, 0.85, 0.32], ySurface: 0.85 },
  { id: 2, team: "Blue", pos: [-0.38, 0.95, -0.08], ySurface: 0.95 },
  { id: 3, team: "Blue", pos: [-0.14, 0.85, 0.24], ySurface: 0.85 },
  { id: 4, team: "Blue", pos: [-0.08, 0.85, -0.28], ySurface: 0.85 },
  { id: 5, team: "Red", pos: [0.16, 0.85, -0.22], ySurface: 0.85 },
  { id: 6, team: "Red", pos: [0.22, 0.85, 0.30], ySurface: 0.85 },
  { id: 7, team: "Red", pos: [0.41, 0.95, 0.13], ySurface: 0.95 },
  { id: 8, team: "Red", pos: [0.58, 0.85, -0.18], ySurface: 0.85 }
];

markerConfigs.forEach((cfg) => {
  const isBlue = cfg.team === "Blue";
  const markerMat = isBlue ? blueForceMat : redForceMat;

  const unitGroup = new THREE.Group();
  unitGroup.name = `TacticalUnitMarker_${cfg.id}`;
  unitGroup.position.set(cfg.pos[0], cfg.ySurface, cfg.pos[2]);
  unitGroup.userData.xr = {
    grab: "1-hand",
    snapTo: { radius: 0.15, targets: ["SharedTacticalSandTable"] },
    outline: { color: isBlue ? "#38bdf8" : "#f43f5e", thickness: 0.01 }
  };
  unitGroup.userData.state = {
    sync: true,
    grid: 0.05,
    surface: "floor",
    faction: cfg.team
  };

  // Weighted Tactical Token Base
  const tokenDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.044, 0.02, 20), steelBaseMat);
  tokenDisc.name = `UnitTokenBase_${cfg.id}`;
  tokenDisc.position.y = 0.01;
  unitGroup.add(tokenDisc);

  // Directional Unit Chevron Cone
  const unitCone = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.065, 16), markerMat);
  unitCone.name = `UnitMarkerCone_${cfg.id}`;
  unitCone.position.y = 0.052;
  unitGroup.add(unitCone);

  // Floating Status Badge configured with Cylindrical (`"y"`) Billboard
  const statusBadge = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.032, 0.008), markerMat);
  statusBadge.name = `UnitStatusBadge_${cfg.id}`;
  statusBadge.position.set(0, 0.12, 0);
  statusBadge.userData.xr = {
    billboard: "y"
  };
  statusBadge.userData.state = {
    billboardMode: "cylindrical"
  };
  unitGroup.add(statusBadge);

  scene.add(unitGroup);
});

camera.position.set(1.55, 1.65, 1.75);
camera.lookAt(0, 0.72, 0);
