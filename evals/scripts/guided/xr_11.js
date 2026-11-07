// Architectural Campus Model on Tabletop Anchor (xr_11)
scene.background = new THREE.Color(0x0f172a);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const sunDirLight = new THREE.DirectionalLight(0xfffbeb, 1.25);
sunDirLight.name = "ArchitecturalSunLight";
sunDirLight.position.set(3.0, 5.0, 3.5);
scene.add(sunDirLight);

const skyFillLight = new THREE.DirectionalLight(0x38bdf8, 0.55);
skyFillLight.name = "SkyFillLight";
skyFillLight.position.set(-2.5, 3.0, -2.0);
scene.add(skyFillLight);

// Materials
const plinthWoodMat = new THREE.MeshStandardMaterial({ color: 0x3f2e21, roughness: 0.45, metalness: 0.1 });
const turfGrassMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.85, metalness: 0.02 });
const walkwayStoneMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6, metalness: 0.05 });
const glassCurtainMat = new THREE.MeshPhysicalMaterial({
  color: 0x7dd3fc,
  transmission: 0.72,
  ior: 1.5,
  roughness: 0.08,
  metalness: 0.15,
  clearcoat: 1.0,
  transparent: true,
  opacity: 0.88
});
const concreteCoreMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.5, metalness: 0.2 });
const solarPanelMat = new THREE.MeshPhysicalMaterial({
  color: 0x1e3a8a,
  metalness: 0.65,
  roughness: 0.15,
  clearcoat: 0.9
});
const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 });
const foliageMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.65 });

// 1:200 Architectural Scale Model Root (resting at y = 0)
const campusModel = new THREE.Group();
campusModel.name = "SustainableCampusScaleModel";
campusModel.position.set(0, 0, 0);
campusModel.userData.xr = {
  anchor: "Table",
  grab: "2-hand",
  handles: { rotateAxis: "y", minScale: 0.5, maxScale: 3.0 },
  dimensions: true
};
scene.add(campusModel);

// Architectural Display Plinth & Turf Base
const woodPlinth = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.07, 1.25), plinthWoodMat);
woodPlinth.name = "ScaleModelWoodPlinth";
woodPlinth.position.set(0, 0.035, 0);
campusModel.add(woodPlinth);

const landscapePad = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.02, 1.16), turfGrassMat);
landscapePad.name = "CampusLandscapeTurf";
landscapePad.position.set(0, 0.08, 0);
campusModel.add(landscapePad);

// Pedestrian Walkways & Central Reflecting Courtyard Plaza
const mainPlaza = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.008, 32), walkwayStoneMat);
mainPlaza.name = "CentralCourtyardPlaza";
mainPlaza.position.set(0, 0.094, 0.04);
campusModel.add(mainPlaza);

const pondFeature = new THREE.Mesh(
  new THREE.CylinderGeometry(0.14, 0.14, 0.01, 24),
  new THREE.MeshPhysicalMaterial({ color: 0x0284c7, roughness: 0.05, clearcoat: 1.0 })
);
pondFeature.name = "CourtyardBioPond";
pondFeature.position.set(0, 0.096, 0.04);
campusModel.add(pondFeature);

const eastWestWalkway = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.006, 0.12), walkwayStoneMat);
eastWestWalkway.name = "EastWestPedestrianWalkway";
eastWestWalkway.position.set(0, 0.093, 0.04);
campusModel.add(eastWestWalkway);

const northSouthWalkway = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 1.02), walkwayStoneMat);
northSouthWalkway.name = "NorthSouthPedestrianWalkway";
northSouthWalkway.position.set(0, 0.093, 0);
campusModel.add(northSouthWalkway);

// Helper to build Glass Curtain-Wall Office Towers with Floor Plates & Solar Roofs
function createOfficeTower(id, xPos, zPos, width, depth, height, floors) {
  const tower = new THREE.Group();
  tower.name = `GlassOfficeTower_${id}`;
  tower.position.set(xPos, 0.09, zPos);

  const core = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.55, height, depth * 0.55),
    concreteCoreMat
  );
  core.name = `TowerStructuralCore_${id}`;
  core.position.y = height * 0.5;
  tower.add(core);

  for (let f = 1; f <= floors; f++) {
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.96, 0.008, depth * 0.96),
      walkwayStoneMat
    );
    slab.name = `TowerFloorPlate_${id}_${f}`;
    slab.position.y = (f / floors) * (height - 0.02);
    tower.add(slab);
  }

  const curtainShell = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), glassCurtainMat);
  curtainShell.name = `TowerGlassFacade_${id}`;
  curtainShell.position.y = height * 0.5;
  tower.add(curtainShell);

  const solarArray = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.86, 0.012, depth * 0.82),
    solarPanelMat
  );
  solarArray.name = `TowerPhotovoltaicRoof_${id}`;
  solarArray.position.y = height + 0.012;
  solarArray.rotation.x = 0.14;
  tower.add(solarArray);

  campusModel.add(tower);
}

createOfficeTower("North", -0.38, -0.28, 0.28, 0.24, 0.48, 8);
createOfficeTower("East", 0.38, -0.24, 0.26, 0.26, 0.40, 7);
createOfficeTower("WestPavilion", -0.44, 0.26, 0.34, 0.22, 0.24, 4);
createOfficeTower("SouthInnovationHub", 0.40, 0.28, 0.36, 0.24, 0.28, 5);

// Elevated Glass Skybridge linking North & East Towers
const skybridge = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.05, 0.08), glassCurtainMat);
skybridge.name = "ElevatedCampusSkybridge";
skybridge.position.set(0.0, 0.34, -0.26);
campusModel.add(skybridge);

// Solar-Roofed Courtyard Canopy Pergola
const solarCanopy = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.012, 0.26), solarPanelMat);
solarCanopy.name = "CourtyardSolarCanopy";
solarCanopy.position.set(0.0, 0.22, -0.32);
solarCanopy.rotation.x = 0.18;
campusModel.add(solarCanopy);

// 14 Architectural Scale Trees around Campus Perimeter & Walkways
const treeLocations = [
  [-0.64, -0.42], [-0.64, -0.12], [-0.64, 0.18], [-0.64, 0.44],
  [0.64, -0.42], [0.64, -0.12], [0.64, 0.18], [0.64, 0.44],
  [-0.22, 0.44], [0.18, 0.44], [-0.18, -0.44], [0.18, -0.44],
  [-0.20, 0.14], [0.20, -0.08]
];

treeLocations.forEach((loc, idx) => {
  const treeGroup = new THREE.Group();
  treeGroup.name = `CampusScaleTree_${idx + 1}`;
  treeGroup.position.set(loc[0], 0.09, loc[1]);

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.01, 0.04, 8), treeTrunkMat);
  trunk.name = `TreeTrunk_${idx + 1}`;
  trunk.position.y = 0.02;
  treeGroup.add(trunk);

  const canopy = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.085, 12), foliageMat);
  canopy.name = `TreeCanopy_${idx + 1}`;
  canopy.position.y = 0.075;
  treeGroup.add(canopy);

  campusModel.add(treeGroup);
});

camera.position.set(1.55, 1.32, 1.75);
camera.lookAt(0, 0.24, 0);
