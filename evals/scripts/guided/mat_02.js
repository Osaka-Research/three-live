// mat_02: Iridescent Soap Bubble Cluster & Brass Wand
const root = new THREE.Group();
root.name = "SoapBubbleWandRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "BubbleAmbientLight";
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.name = "MainSunLight";
dirLight.position.set(1.5, 2.5, 1.8);
scene.add(dirLight);

const cyanPointLight = new THREE.PointLight(0x66e0ff, 1.6, 3.5);
cyanPointLight.name = "CyanHighlightLight";
cyanPointLight.position.set(-0.6, 0.7, 0.5);
scene.add(cyanPointLight);

const pinkPointLight = new THREE.PointLight(0xff77cc, 1.6, 3.5);
pinkPointLight.name = "PinkHighlightLight";
pinkPointLight.position.set(0.6, 0.5, -0.4);
scene.add(pinkPointLight);

const warmRimLight = new THREE.PointLight(0xffdd77, 1.2, 3.0);
warmRimLight.name = "WarmRimPointLight";
warmRimLight.position.set(0.0, 0.9, -0.6);
scene.add(warmRimLight);

// Materials
const brassMat = new THREE.MeshStandardMaterial({
  color: 0xd4a843,
  metalness: 0.88,
  roughness: 0.22
});

const copperGripMat = new THREE.MeshStandardMaterial({
  color: 0xb86b43,
  metalness: 0.82,
  roughness: 0.28
});

const trayCeramicMat = new THREE.MeshPhysicalMaterial({
  color: 0x1e2430,
  roughness: 0.15,
  metalness: 0.05,
  clearcoat: 0.9,
  clearcoatRoughness: 0.1
});

const soapySolutionMat = new THREE.MeshPhysicalMaterial({
  color: 0xdcf4ff,
  roughness: 0.04,
  metalness: 0.0,
  transmission: 0.9,
  ior: 1.34,
  thickness: 0.03,
  iridescence: 0.85,
  iridescenceIOR: 1.33,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

// Grounded Dish & Pedestal Holder (y = 0)
const dishGroup = new THREE.Group();
dishGroup.name = "SoapDishBaseGroup";
root.add(dishGroup);

const dishBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.16, 0.18, 0.025, 32),
  trayCeramicMat
);
dishBase.name = "CeramicDishBase";
dishBase.position.set(-0.18, 0.0125, 0);
dishGroup.add(dishBase);

const dishRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.165, 0.012, 16, 32),
  trayCeramicMat
);
dishRim.name = "CeramicDishRim";
dishRim.rotation.x = Math.PI / 2;
dishRim.position.set(-0.18, 0.025, 0);
dishGroup.add(dishRim);

const liquidPool = new THREE.Mesh(
  new THREE.CylinderGeometry(0.155, 0.155, 0.008, 32),
  soapySolutionMat
);
liquidPool.name = "SoapySolutionPool";
liquidPool.position.set(-0.18, 0.024, 0);
dishGroup.add(liquidPool);

// Twisted Brass Bubble Wand anchored in holder on the dish
const wandGroup = new THREE.Group();
wandGroup.name = "TwistedBrassWandGroup";
wandGroup.position.set(-0.18, 0.025, 0);
wandGroup.rotation.z = -0.32;
root.add(wandGroup);

const holderSocket = new THREE.Mesh(
  new THREE.CylinderGeometry(0.026, 0.035, 0.04, 20),
  brassMat
);
holderSocket.name = "WandStandSocket";
holderSocket.position.set(0, 0.02, 0);
wandGroup.add(holderSocket);

// Pommel & ribbed grip
const pommelSphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.022, 20, 16),
  brassMat
);
pommelSphere.name = "WandPommelSphere";
pommelSphere.position.set(0, 0.04, 0);
wandGroup.add(pommelSphere);

const handleShaft = new THREE.Mesh(
  new THREE.CylinderGeometry(0.011, 0.013, 0.16, 16),
  copperGripMat
);
handleShaft.name = "WandHandleShaft";
handleShaft.position.set(0, 0.12, 0);
wandGroup.add(handleShaft);

// Twisted helical brass wires along the stem
for (let strand = 0; strand < 2; strand++) {
  const pts = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = t * Math.PI * 5 + strand * Math.PI;
    const r = 0.013;
    pts.push(new THREE.Vector3(Math.cos(angle) * r, 0.05 + t * 0.22, Math.sin(angle) * r));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const strandMesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 32, 0.0045, 8, false),
    brassMat
  );
  strandMesh.name = "TwistedBrassStrand_" + strand;
  wandGroup.add(strandMesh);
}

const neckCollar = new THREE.Mesh(
  new THREE.TorusGeometry(0.016, 0.005, 12, 24),
  brassMat
);
neckCollar.name = "WandNeckCollar";
neckCollar.rotation.x = Math.PI / 2;
neckCollar.position.set(0, 0.27, 0);
wandGroup.add(neckCollar);

// Wand eye loop (Torus) with decorative inner scalloped rings
const wandLoopRadius = 0.085;
const wandLoop = new THREE.Mesh(
  new THREE.TorusGeometry(wandLoopRadius, 0.007, 16, 40),
  brassMat
);
wandLoop.name = "BrassWandLoop";
wandLoop.position.set(0, 0.27 + wandLoopRadius, 0);
wandGroup.add(wandLoop);

const innerWireLoop = new THREE.Mesh(
  new THREE.TorusGeometry(wandLoopRadius * 0.88, 0.003, 12, 36),
  brassMat
);
innerWireLoop.name = "BrassWandInnerGrooveLoop";
innerWireLoop.position.set(0, 0.27 + wandLoopRadius, 0);
wandGroup.add(innerWireLoop);

// Thin soap film stretched inside the wand loop
const soapFilmDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(wandLoopRadius * 0.9, wandLoopRadius * 0.9, 0.002, 32),
  soapySolutionMat
);
soapFilmDisc.name = "WandStretchedSoapFilm";
soapFilmDisc.rotation.x = Math.PI / 2;
soapFilmDisc.position.set(0, 0.27 + wandLoopRadius, 0);
wandGroup.add(soapFilmDisc);

// Cluster of 12 overlapping translucent soap bubbles floating out of the wand
const bubbleClusterGroup = new THREE.Group();
bubbleClusterGroup.name = "IridescentBubbleCluster";
root.add(bubbleClusterGroup);

const bubbleConfigs = [
  { pos: [-0.05, 0.36, 0.02], r: 0.068, ior: 1.32, tint: 0xffeef8 },
  { pos: [0.02, 0.39, -0.02], r: 0.082, ior: 1.36, tint: 0xeefbff },
  { pos: [0.06, 0.33, 0.04], r: 0.058, ior: 1.40, tint: 0xf4ffe8 },
  { pos: [0.11, 0.43, 0.01], r: 0.095, ior: 1.33, tint: 0xfff5ea },
  { pos: [0.05, 0.48, -0.05], r: 0.064, ior: 1.38, tint: 0xe8f0ff },
  { pos: [0.16, 0.37, -0.04], r: 0.072, ior: 1.42, tint: 0xffe8f8 },
  { pos: [0.19, 0.48, 0.05], r: 0.088, ior: 1.31, tint: 0xeafff6 },
  { pos: [0.13, 0.54, 0.00], r: 0.062, ior: 1.35, tint: 0xf9eaff },
  { pos: [0.25, 0.43, -0.01], r: 0.076, ior: 1.39, tint: 0xfffbe6 },
  { pos: [0.27, 0.53, 0.03], r: 0.054, ior: 1.34, tint: 0xe6f7ff },
  { pos: [0.22, 0.58, -0.04], r: 0.048, ior: 1.44, tint: 0xffebf2 },
  { pos: [0.33, 0.49, -0.02], r: 0.042, ior: 1.37, tint: 0xeeffee }
];

for (let i = 0; i < bubbleConfigs.length; i++) {
  const cfg = bubbleConfigs[i];
  const bubbleMat = new THREE.MeshPhysicalMaterial({
    color: cfg.tint,
    roughness: 0.01,
    metalness: 0.0,
    transmission: 0.96,
    ior: 1.33,
    thickness: 0.008,
    iridescence: 1.0,
    iridescenceIOR: cfg.ior,
    clearcoat: 1.0,
    clearcoatRoughness: 0.01,
    attenuationColor: cfg.tint,
    attenuationDistance: 0.6,
    transparent: true,
    opacity: 0.92
  });

  const bubbleMesh = new THREE.Mesh(
    new THREE.SphereGeometry(cfg.r, 32, 24),
    bubbleMat
  );
  bubbleMesh.name = "SoapBubble_" + (i + 1);
  bubbleMesh.position.set(cfg.pos[0], cfg.pos[1], cfg.pos[2]);
  bubbleClusterGroup.add(bubbleMesh);
}

// Gentle floating animation
function animate(t) {
  for (let i = 0; i < bubbleClusterGroup.children.length; i++) {
    const b = bubbleClusterGroup.children[i];
    const baseCfg = bubbleConfigs[i];
    b.position.y = baseCfg.pos[1] + Math.sin(t * 1.8 + i * 0.7) * 0.008;
    b.position.x = baseCfg.pos[0] + Math.cos(t * 1.3 + i * 0.5) * 0.005;
  }
}

// Camera framing
camera.position.set(0.06, 0.42, 1.15);
camera.lookAt(0.06, 0.32, 0);
