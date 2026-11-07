// 3D CAD Caliper & Tape Measure Inspection Bench (xr_20)
scene.background = new THREE.Color(0x0f172a);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.68);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const metrologyKeyLight = new THREE.DirectionalLight(0xf8fafc, 1.25);
metrologyKeyLight.name = "MetrologyInspectionKeyLight";
metrologyKeyLight.position.set(2.2, 4.2, 2.8);
scene.add(metrologyKeyLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
rimLight.name = "MetrologyRimLight";
rimLight.position.set(-2.0, 2.5, -2.0);
scene.add(rimLight);

// Materials
const steelStandMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.75, roughness: 0.35 });
const granitePlateMat = new THREE.MeshPhysicalMaterial({
  color: 0x111827,
  roughness: 0.14,
  metalness: 0.1,
  clearcoat: 0.75,
  clearcoatRoughness: 0.12
});
const machinedTitaniumMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  metalness: 0.92,
  roughness: 0.16
});
const anodizedBronzeMat = new THREE.MeshStandardMaterial({
  color: 0xd97706,
  metalness: 0.88,
  roughness: 0.22
});
const billetAlloyMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  metalness: 0.85,
  roughness: 0.20
});

// Metrological Granite Surface Plate & Stand (resting on y = 0)
const inspectionBench = new THREE.Group();
inspectionBench.name = "MetrologyGraniteSurfaceBench";
inspectionBench.userData.xr = {
  anchor: "Table",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.85 }
};
scene.add(inspectionBench);

const legOffsets = [
  [-0.65, 0.35, -0.38],
  [0.65, 0.35, -0.38],
  [-0.65, 0.35, 0.38],
  [0.65, 0.35, 0.38]
];
legOffsets.forEach((lp, idx) => {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.70, 0.06), steelStandMat);
  leg.name = `MetrologyBenchLeg_${idx + 1}`;
  leg.position.set(lp[0], lp[1], lp[2]);
  inspectionBench.add(leg);
});

// Precision Lapped Black Granite Surface Plate (top at y = 0.82)
const graniteSlab = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.12, 0.92), granitePlateMat);
graniteSlab.name = "LappedGraniteSurfacePlate";
graniteSlab.position.set(0, 0.76, 0);
inspectionBench.add(graniteSlab);

// Digital Vernier Caliper Tool on Front Edge of Granite Plate
const caliperTool = new THREE.Group();
caliperTool.name = "DigitalVernierCaliper";
caliperTool.position.set(0, 0.83, 0.32);
caliperTool.userData.xr = {
  grab: "1-hand",
  dimensions: { unit: "mm", axes: ["x"] }
};
inspectionBench.add(caliperTool);

const caliperScaleBeam = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.008, 0.024), machinedTitaniumMat);
caliperScaleBeam.name = "CaliperMainScaleBeam";
caliperTool.add(caliperScaleBeam);

const caliperReadoutBox = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.016, 0.042), steelStandMat);
caliperReadoutBox.name = "CaliperDigitalLCDReadout";
caliperReadoutBox.position.set(-0.06, 0.004, 0.006);
caliperTool.add(caliperReadoutBox);

// Extruded Airfoil & Gear Flange Shapes (`ExtrudeGeometry`)
const airfoilShape = new THREE.Shape();
airfoilShape.moveTo(-0.07, -0.015);
airfoilShape.quadraticCurveTo(0.0, 0.045, 0.08, 0.0);
airfoilShape.quadraticCurveTo(0.0, -0.01, -0.07, -0.015);

const airfoilExtrudeGeo = new THREE.ExtrudeGeometry(airfoilShape, {
  depth: 0.22,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.004,
  bevelThickness: 0.004
});

// 1. Precision Machined Workpiece 1: Fir-Tree Root Turbine Blade
const turbineBladePart = new THREE.Group();
turbineBladePart.name = "PrecisionMachinedTurbineBlade";
turbineBladePart.position.set(-0.44, 0.82, -0.04);
turbineBladePart.userData.xr = {
  dimensions: { unit: "mm", axes: ["x", "y", "z"] },
  grab: "2-hand",
  explode: { distance: 0.18, direction: [0, 1, 0] },
  lod: { distances: [2.5, 6.0], ratios: [0.6, 0.25] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
scene.add(turbineBladePart);

const bladeRootBlock = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.055, 0.12), machinedTitaniumMat);
bladeRootBlock.name = "TurbineBladeFirTreeRoot";
bladeRootBlock.position.y = 0.028;
turbineBladePart.add(bladeRootBlock);

const bladeAirfoilMesh = new THREE.Mesh(airfoilExtrudeGeo, machinedTitaniumMat);
bladeAirfoilMesh.name = "TurbineBladeExtrudedAirfoil";
bladeAirfoilMesh.rotation.x = -Math.PI / 2;
bladeAirfoilMesh.position.set(0, 0.055, 0.01);
 bladeAirfoilMesh.userData.xr = {
  explode: { distance: 0.16, direction: [0, 1, 0] }
};
turbineBladePart.add(bladeAirfoilMesh);

// 2. Precision Machined Workpiece 2: Split Planetary Gear Housing
const gearHousingPart = new THREE.Group();
gearHousingPart.name = "PrecisionGearHousingAssembly";
gearHousingPart.position.set(0.0, 0.82, -0.04);
gearHousingPart.userData.xr = {
  dimensions: { unit: "mm", axes: ["x", "y", "z"] },
  grab: "2-hand",
  explode: { distance: 0.20, direction: [0, 1, 0] },
  lod: { distances: [2.5, 6.0], ratios: [0.6, 0.25] },
  outline: { color: "#f59e0b", thickness: 0.012 }
};
scene.add(gearHousingPart);

const housingFlangeShape = new THREE.Shape();
housingFlangeShape.absarc(0, 0, 0.13, 0, Math.PI * 2, false);
const flangeGeo = new THREE.ExtrudeGeometry(housingFlangeShape, {
  depth: 0.05,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.005,
  bevelThickness: 0.005
});

const lowerHousing = new THREE.Mesh(flangeGeo, anodizedBronzeMat);
lowerHousing.name = "GearHousingLowerCasing";
lowerHousing.rotation.x = -Math.PI / 2;
lowerHousing.position.y = 0.005;
gearHousingPart.add(lowerHousing);

const internalGear = new THREE.Mesh(
  new THREE.CylinderGeometry(0.085, 0.085, 0.08, 24),
  machinedTitaniumMat
);
internalGear.name = "GearHousingPinionCore";
internalGear.position.y = 0.095;
internalGear.userData.xr = {
  explode: { distance: 0.14, direction: [0, 1, 0] }
};
gearHousingPart.add(internalGear);

const upperBellCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.115, 0.07, 24),
  anodizedBronzeMat
);
upperBellCap.name = "GearHousingUpperBellCap";
upperBellCap.position.y = 0.17;
upperBellCap.userData.xr = {
  explode: { distance: 0.26, direction: [0, 1, 0] }
};
gearHousingPart.add(upperBellCap);

// 3. Precision Machined Workpiece 3: Billet Impeller Diffuser Casing
const diffuserPart = new THREE.Group();
diffuserPart.name = "PrecisionImpellerDiffuser";
diffuserPart.position.set(0.44, 0.82, -0.04);
diffuserPart.userData.xr = {
  dimensions: { unit: "mm", axes: ["x", "y", "z"] },
  grab: "2-hand",
  explode: { distance: 0.18, direction: [0, 1, 0] },
  lod: { distances: [2.5, 6.0], ratios: [0.6, 0.25] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
scene.add(diffuserPart);

const diffuserBaseBlock = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.22), billetAlloyMat);
diffuserBaseBlock.name = "ImpellerBilletManifoldBase";
diffuserBaseBlock.position.y = 0.03;
diffuserPart.add(diffuserBaseBlock);

const impellerRotor = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.095, 0.12, 20),
  machinedTitaniumMat
);
impellerRotor.name = "ImpellerMachinedRotorHub";
impellerRotor.position.y = 0.12;
impellerRotor.userData.xr = {
  explode: { distance: 0.18, direction: [0, 1, 0] }
};
diffuserPart.add(impellerRotor);

camera.position.set(1.45, 1.48, 1.68);
camera.lookAt(0, 0.65, 0);
