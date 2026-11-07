// mat_04: Art-Deco Perfume Flacon with Amber Liquid Volume
const root = new THREE.Group();
root.name = "PerfumeFlaconRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "FlaconAmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff8ee, 1.5);
keyLight.name = "FlaconKeyLight";
keyLight.position.set(0.8, 1.4, 1.0);
scene.add(keyLight);

const backGlowLight = new THREE.PointLight(0xffbb55, 2.2, 2.5);
backGlowLight.name = "AmberBacklightPoint";
backGlowLight.position.set(0.0, 0.18, -0.35);
scene.add(backGlowLight);

const sideRimLight = new THREE.PointLight(0xddeeff, 1.4, 2.5);
sideRimLight.name = "CrystalRimPointLight";
sideRimLight.position.set(-0.4, 0.28, 0.3);
scene.add(sideRimLight);

// Materials
const crystalGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.96,
  ior: 1.52,
  thickness: 0.06,
  attenuationColor: 0xf7fbff,
  attenuationDistance: 0.6,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02,
  dispersion: 0.02
});

const amberLiquidMat = new THREE.MeshPhysicalMaterial({
  color: 0xffb833,
  roughness: 0.02,
  metalness: 0.0,
  transmission: 0.94,
  ior: 1.38,
  thickness: 0.09,
  attenuationColor: 0xc85a00,
  attenuationDistance: 0.075
});

const goldMetalMat = new THREE.MeshStandardMaterial({
  color: 0xe5b842,
  metalness: 0.94,
  roughness: 0.16
});

const dipTubeMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.1,
  transmission: 0.85,
  ior: 1.49,
  thickness: 0.005,
  transparent: true,
  opacity: 0.85
});

const marbleTrayMat = new THREE.MeshPhysicalMaterial({
  color: 0x1b1d24,
  roughness: 0.15,
  metalness: 0.05,
  clearcoat: 0.8,
  clearcoatRoughness: 0.1
});

// Display Tray Coaster resting at y = 0
const coaster = new THREE.Mesh(
  new THREE.CylinderGeometry(0.14, 0.15, 0.014, 32),
  marbleTrayMat
);
coaster.name = "DisplayCoasterBase";
coaster.position.set(0, 0.007, 0);
root.add(coaster);

const coasterGoldRim = new THREE.Mesh(
  new THREE.CylinderGeometry(0.143, 0.143, 0.006, 32),
  goldMetalMat
);
coasterGoldRim.name = "DisplayCoasterGoldTrim";
coasterGoldRim.position.set(0, 0.011, 0);
root.add(coasterGoldRim);

// Flacon Assembly (~0.30m tall from y = 0.014 to y = 0.314)
const flaconGroup = new THREE.Group();
flaconGroup.name = "ArtDecoFlaconGroup";
flaconGroup.position.set(0, 0.014, 0);
root.add(flaconGroup);

// Heavy stepped glass foot
const glassFoot = new THREE.Mesh(
  new THREE.BoxGeometry(0.135, 0.024, 0.078),
  crystalGlassMat
);
glassFoot.name = "CrystalHeavyBaseFoot";
glassFoot.position.set(0, 0.012, 0);
flaconGroup.add(glassFoot);

// Main outer crystal body block
const outerBody = new THREE.Mesh(
  new THREE.BoxGeometry(0.125, 0.155, 0.068),
  crystalGlassMat
);
outerBody.name = "CrystalOuterBody";
outerBody.position.set(0, 0.098, 0);
flaconGroup.add(outerBody);

// Art-Deco stepped side wings & vertical fluted ribs on front and back
const stepSizes = [
  { w: 0.142, h: 0.125, d: 0.054 },
  { w: 0.156, h: 0.095, d: 0.040 }
];
for (let i = 0; i < stepSizes.length; i++) {
  const wing = new THREE.Mesh(
    new THREE.BoxGeometry(stepSizes[i].w, stepSizes[i].h, stepSizes[i].d),
    crystalGlassMat
  );
  wing.name = "ArtDecoSteppedWing_" + i;
  wing.position.set(0, 0.088, 0);
  flaconGroup.add(wing);
}

// Vertical glass flutes across the front and back faces
const numFlutes = 7;
for (let i = 0; i < numFlutes; i++) {
  const xOff = (i - (numFlutes - 1) / 2) * 0.015;
  for (let side of [-1, 1]) {
    const flute = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0055, 0.0055, 0.148, 12),
      crystalGlassMat
    );
    flute.name = "CrystalFluteRib_" + i + "_" + (side > 0 ? "Front" : "Back");
    flute.position.set(xOff, 0.098, side * 0.034);
    flaconGroup.add(flute);
  }
}

// Inner chamber of golden-amber perfume liquid
const liquidVolume = new THREE.Mesh(
  new THREE.BoxGeometry(0.096, 0.112, 0.044),
  amberLiquidMat
);
liquidVolume.name = "AmberPerfumeLiquidChamber";
liquidVolume.position.set(0, 0.086, 0);
flaconGroup.add(liquidVolume);

// Liquid meniscus top surface
const meniscus = new THREE.Mesh(
  new THREE.BoxGeometry(0.095, 0.004, 0.043),
  amberLiquidMat
);
meniscus.name = "AmberLiquidMeniscus";
meniscus.position.set(0, 0.143, 0);
flaconGroup.add(meniscus);

// Internal curved dip tube extending from the atomizer down to the bottom corner
const dipTube = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0022, 0.0022, 0.155, 10),
  dipTubeMat
);
dipTube.name = "InternalDipTube";
dipTube.position.set(0.006, 0.108, 0);
dipTube.rotation.z = 0.08;
flaconGroup.add(dipTube);

// Gold front plaque label
const goldPlaque = new THREE.Mesh(
  new THREE.BoxGeometry(0.052, 0.058, 0.004),
  goldMetalMat
);
goldPlaque.name = "GoldFrontBrandPlaque";
goldPlaque.position.set(0, 0.098, 0.039);
flaconGroup.add(goldPlaque);

// Stepped crystal shoulder
const crystalShoulder = new THREE.Mesh(
  new THREE.BoxGeometry(0.092, 0.018, 0.052),
  crystalGlassMat
);
crystalShoulder.name = "CrystalSteppedShoulder";
crystalShoulder.position.set(0, 0.184, 0);
flaconGroup.add(crystalShoulder);

// Gold Atomizer Collar & Nozzle
const atomizerGroup = new THREE.Group();
atomizerGroup.name = "GoldAtomizerAssembly";
atomizerGroup.position.set(0, 0.193, 0);
flaconGroup.add(atomizerGroup);

const collarRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.024, 0.026, 0.026, 24),
  goldMetalMat
);
collarRing.name = "GoldAtomizerCollar";
collarRing.position.set(0, 0.013, 0);
atomizerGroup.add(collarRing);

const nozzleHead = new THREE.Mesh(
  new THREE.CylinderGeometry(0.015, 0.015, 0.016, 20),
  goldMetalMat
);
nozzleHead.name = "GoldAtomizerSprayHead";
nozzleHead.position.set(0, 0.034, 0);
atomizerGroup.add(nozzleHead);

const sprayOrifice = new THREE.Mesh(
  new THREE.CylinderGeometry(0.003, 0.003, 0.006, 12),
  marbleTrayMat
);
sprayOrifice.name = "AtomizerNozzleOrifice";
sprayOrifice.rotation.x = Math.PI / 2;
sprayOrifice.position.set(0, 0.034, 0.014);
atomizerGroup.add(sprayOrifice);

// Faceted Art-Deco Fan/Octagonal Crystal Stopper Crown
const stopperGroup = new THREE.Group();
stopperGroup.name = "FacetedCrystalStopperGroup";
stopperGroup.position.set(0, 0.235, 0);
flaconGroup.add(stopperGroup);

const stopperPeg = new THREE.Mesh(
  new THREE.CylinderGeometry(0.016, 0.012, 0.022, 16),
  crystalGlassMat
);
stopperPeg.name = "StopperNeckStem";
stopperPeg.position.set(0, 0.005, 0);
stopperGroup.add(stopperPeg);

const stopperMainOctagon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.048, 0.048, 0.028, 8),
  crystalGlassMat
);
stopperMainOctagon.name = "StopperFacetedDisc";
stopperMainOctagon.rotation.x = Math.PI / 2;
stopperMainOctagon.rotation.z = Math.PI / 8;
stopperMainOctagon.position.set(0, 0.042, 0);
stopperGroup.add(stopperMainOctagon);

const stopperBevelInner = new THREE.Mesh(
  new THREE.BoxGeometry(0.068, 0.052, 0.034),
  crystalGlassMat
);
stopperBevelInner.name = "StopperBevelCore";
stopperBevelInner.position.set(0, 0.042, 0);
stopperGroup.add(stopperBevelInner);

// Camera framing (~0.32m height -> distance ~0.62m)
camera.position.set(0.18, 0.21, 0.56);
camera.lookAt(0, 0.16, 0);
