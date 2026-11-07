// Astronomical Geodesic Observatory Dome (2.5m tall) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.35);
sunLight.name = "sun_directional_light";
sunLight.position.set(3.5, 4.8, 3.8);
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xaac8ff, 0.55);
fillLight.name = "sky_fill_light";
fillLight.position.set(-3.0, 2.2, -2.5);
scene.add(fillLight);

const observatoryGroup = new THREE.Group();
observatoryGroup.name = "astronomical_observatory";
scene.add(observatoryGroup);

// Materials
const concreteMat = new THREE.MeshStandardMaterial({
  color: 0xd8d6d0,
  metalness: 0.05,
  roughness: 0.78
});

const domeMetalMat = new THREE.MeshStandardMaterial({
  color: 0xe8edf2,
  metalness: 0.72,
  roughness: 0.28
});

const darkSteelMat = new THREE.MeshStandardMaterial({
  color: 0x2e353d,
  metalness: 0.8,
  roughness: 0.35
});

const brassMat = new THREE.MeshStandardMaterial({
  color: 0xd4a63f,
  metalness: 0.88,
  roughness: 0.22
});

const lensGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x88ccff,
  transmission: 0.88,
  ior: 1.52,
  thickness: 0.03,
  roughness: 0.06,
  metalness: 0.05,
  clearcoat: 1.0
});

// Dimensions: Base cylinder radius = 1.1m, height = 1.4m; Dome radius = 1.1m -> total height = 2.5m
const baseRadius = 1.1;
const baseHeight = 1.4;

// 1. Cylindrical Concrete Base with Entry Doorway Cutout via CSG (<= 24 segments)
const outerWallRaw = new THREE.Mesh(
  new THREE.CylinderGeometry(baseRadius, baseRadius, baseHeight, 24),
  concreteMat
);
outerWallRaw.position.set(0, baseHeight / 2, 0);

const innerHollowRaw = new THREE.Mesh(
  new THREE.CylinderGeometry(baseRadius - 0.12, baseRadius - 0.12, baseHeight - 0.08, 24),
  concreteMat
);
innerHollowRaw.position.set(0, baseHeight / 2 + 0.04, 0);

const doorCutoutRaw = new THREE.Mesh(
  new THREE.BoxGeometry(0.56, 0.96, 0.5),
  concreteMat
);
doorCutoutRaw.position.set(0, 0.52, baseRadius);

const hollowCylinder = THREE.CSG.subtract(outerWallRaw, innerHollowRaw);
const concreteWall = THREE.CSG.subtract(hollowCylinder, doorCutoutRaw);
concreteWall.material = concreteMat;
concreteWall.name = "cylindrical_concrete_base";
observatoryGroup.add(concreteWall);

// Concrete plinth ring at y = 0
const plinthRing = new THREE.Mesh(
  new THREE.CylinderGeometry(baseRadius + 0.06, baseRadius + 0.08, 0.1, 24),
  concreteMat
);
plinthRing.name = "foundation_plinth_ring";
plinthRing.position.set(0, 0.05, 0);
observatoryGroup.add(plinthRing);

// Entry Doorway Frame, Door Leaf & Threshold Step
const entryFrame = new THREE.Mesh(
  new THREE.BoxGeometry(0.64, 1.02, 0.16),
  darkSteelMat
);
entryFrame.name = "entry_doorway_architrave";
entryFrame.position.set(0, 0.54, baseRadius - 0.04);
observatoryGroup.add(entryFrame);

const recessedDoor = new THREE.Mesh(
  new THREE.BoxGeometry(0.52, 0.94, 0.06),
  brassMat
);
recessedDoor.name = "entry_door_panel";
recessedDoor.position.set(0, 0.51, baseRadius - 0.06);
observatoryGroup.add(recessedDoor);

const entryStep = new THREE.Mesh(
  new THREE.BoxGeometry(0.76, 0.08, 0.28),
  concreteMat
);
entryStep.name = "entry_door_step";
entryStep.position.set(0, 0.04, baseRadius + 0.14);
observatoryGroup.add(entryStep);

// Steel rotation ring cornice at y = 1.4m
const rotationRing = new THREE.Mesh(
  new THREE.CylinderGeometry(baseRadius + 0.05, baseRadius + 0.05, 0.09, 24),
  darkSteelMat
);
rotationRing.name = "dome_azimuth_track_ring";
rotationRing.position.set(0, baseHeight, 0);
observatoryGroup.add(rotationRing);

// 2. Rotatable Hemispherical Dome with Shutter Slit Opening via CSG (<= 24 segments)
const domeGroup = new THREE.Group();
domeGroup.name = "rotatable_dome_assembly";
domeGroup.position.set(0, baseHeight, 0);
domeGroup.rotation.y = 0.35;
observatoryGroup.add(domeGroup);

const domeOuterRaw = new THREE.Mesh(
  new THREE.SphereGeometry(baseRadius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
  domeMetalMat
);

const domeInnerRaw = new THREE.Mesh(
  new THREE.SphereGeometry(baseRadius - 0.08, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2),
  domeMetalMat
);

const slitCutterRaw = new THREE.Mesh(
  new THREE.BoxGeometry(0.46, 1.3, 1.35),
  domeMetalMat
);
slitCutterRaw.position.set(0, 0.62, 0.55);

const domeShellHollow = THREE.CSG.subtract(domeOuterRaw, domeInnerRaw);
const domeWithSlit = THREE.CSG.subtract(domeShellHollow, slitCutterRaw);
domeWithSlit.material = domeMetalMat;
domeWithSlit.name = "hemispherical_dome_shell";
domeGroup.add(domeWithSlit);

// Shutter slit side tracks / retracted shutter doors flanking the opening
for (const side of [-1, 1]) {
  const shutterRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.95, 0.88),
    darkSteelMat
  );
  shutterRail.name = `shutter_slit_guide_rail_${side < 0 ? "left" : "right"}`;
  shutterRail.position.set(side * 0.26, 0.56, 0.45);
  shutterRail.rotation.x = 0.52;
  domeGroup.add(shutterRail);
}

// 3. Brass Refractor Telescope on Equatorial Pier Peeking Through the Slit
const telescopeMount = new THREE.Group();
telescopeMount.name = "refractor_telescope_assembly";
telescopeMount.position.set(0, baseHeight - 0.3, 0);
telescopeMount.rotation.y = 0.35;
observatoryGroup.add(telescopeMount);

const pierColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.22, 0.65, 20),
  darkSteelMat
);
pierColumn.name = "telescope_equatorial_pier";
pierColumn.position.set(0, 0.22, 0);
telescopeMount.add(pierColumn);

const forkYoke = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 0.28, 0.24),
  darkSteelMat
);
forkYoke.name = "equatorial_mount_head";
forkYoke.position.set(0, 0.62, 0);
telescopeMount.add(forkYoke);

// Tilted brass optical tube assembly peeking out the dome slit
const opticalTubeGroup = new THREE.Group();
opticalTubeGroup.name = "brass_optical_tube_group";
opticalTubeGroup.position.set(0, 0.68, 0.05);
opticalTubeGroup.rotation.x = 0.92; // Aimed ~38 deg above horizon out the slit
telescopeMount.add(opticalTubeGroup);

const mainBrassTube = new THREE.Mesh(
  new THREE.CylinderGeometry(0.115, 0.135, 1.25, 24),
  brassMat
);
mainBrassTube.name = "brass_refractor_main_tube";
mainBrassTube.position.set(0, 0.28, 0);
opticalTubeGroup.add(mainBrassTube);

const dewShield = new THREE.Mesh(
  new THREE.CylinderGeometry(0.132, 0.122, 0.28, 24),
  brassMat
);
dewShield.name = "brass_objective_dew_shield";
dewShield.position.set(0, 0.98, 0);
opticalTubeGroup.add(dewShield);

const objectiveLens = new THREE.Mesh(
  new THREE.CylinderGeometry(0.12, 0.12, 0.03, 24),
  lensGlassMat
);
objectiveLens.name = "objective_glass_element";
objectiveLens.position.set(0, 1.05, 0);
opticalTubeGroup.add(objectiveLens);

const focuserDrawtube = new THREE.Mesh(
  new THREE.CylinderGeometry(0.055, 0.075, 0.24, 16),
  darkSteelMat
);
focuserDrawtube.name = "eyepiece_focuser_drawtube";
focuserDrawtube.position.set(0, -0.42, 0);
opticalTubeGroup.add(focuserDrawtube);

const finderScope = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.032, 0.45, 16),
  brassMat
);
finderScope.name = "auxiliary_finder_scope";
finderScope.position.set(0.16, 0.22, 0);
opticalTubeGroup.add(finderScope);

// Frame camera at ~2.2x bounding radius
camera.position.set(2.8, 2.2, 3.4);
camera.lookAt(0, 1.25, 0);
