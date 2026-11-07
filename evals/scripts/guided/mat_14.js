// mat_14: Celadon Glazed Porcelain Tea Service on Bamboo Tray
const root = new THREE.Group();
root.name = "CeladonTeaServiceRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "TeaServiceAmbientLight";
scene.add(ambientLight);

const sunDirLight = new THREE.DirectionalLight(0xfffaf0, 1.5);
sunDirLight.name = "TeaServiceKeyLight";
sunDirLight.position.set(1.2, 2.2, 1.5);
scene.add(sunDirLight);

const softFillLight = new THREE.PointLight(0xeef8f0, 1.1, 2.5);
softFillLight.name = "CeladonSpecularPointLight";
softFillLight.position.set(-0.5, 0.6, 0.4);
scene.add(softFillLight);

// Materials
const celadonGlazeMat = new THREE.MeshPhysicalMaterial({
  color: 0x9ec4b2,
  roughness: 0.08,
  metalness: 0.0,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03,
  ior: 1.54,
  sheen: 0.2,
  sheenColor: 0xdaf2e6
});

const unglazedFootMat = new THREE.MeshStandardMaterial({
  color: 0xc8b9a6,
  roughness: 0.85,
  metalness: 0.0
});

const bambooMat = new THREE.MeshStandardMaterial({
  color: 0xcfa668,
  roughness: 0.42,
  metalness: 0.02
});

const darkBambooMat = new THREE.MeshStandardMaterial({
  color: 0x8f6836,
  roughness: 0.5,
  metalness: 0.03
});

const rattanMat = new THREE.MeshStandardMaterial({
  color: 0x9e713d,
  roughness: 0.68,
  metalness: 0.0
});

const brassMeshMat = new THREE.MeshStandardMaterial({
  color: 0xcfa340,
  metalness: 0.85,
  roughness: 0.3
});

const oolongTeaLiquidMat = new THREE.MeshPhysicalMaterial({
  color: 0xd48c2a,
  roughness: 0.02,
  metalness: 0.0,
  transmission: 0.9,
  ior: 1.34,
  thickness: 0.03,
  attenuationColor: 0x8a4800,
  attenuationDistance: 0.045,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01
});

// 1. Slatted Bamboo Tea Tray (Chapan) resting on y = 0 (0.54m wide x 0.36m deep x 0.036m tall)
const trayGroup = new THREE.Group();
trayGroup.name = "SlattedBambooTeaTrayGroup";
root.add(trayGroup);

const trayCatchBasin = new THREE.Mesh(
  new THREE.BoxGeometry(0.51, 0.018, 0.33),
  darkBambooMat
);
trayCatchBasin.name = "TrayLowerCatchBasin";
trayCatchBasin.position.set(0, 0.009, 0);
trayGroup.add(trayCatchBasin);

// Perimeter bamboo frame rails
for (let zSide of [-1, 1]) {
  const longRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.54, 0.036, 0.018),
    bambooMat
  );
  longRail.name = "TrayFrameLongRail_" + (zSide < 0 ? "Back" : "Front");
  longRail.position.set(0, 0.018, zSide * 0.171);
  trayGroup.add(longRail);
}
for (let xSide of [-1, 1]) {
  const shortRail = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.036, 0.324),
    bambooMat
  );
  shortRail.name = "TrayFrameShortRail_" + (xSide < 0 ? "Left" : "Right");
  shortRail.position.set(xSide * 0.261, 0.018, 0);
  trayGroup.add(shortRail);
}

// 13 Slatted Bamboo Top Strips across the tray
const numSlats = 13;
for (let i = 0; i < numSlats; i++) {
  const sx = -0.228 + i * 0.038;
  const slat = new THREE.Mesh(
    new THREE.BoxGeometry(0.030, 0.007, 0.322),
    bambooMat
  );
  slat.name = "BambooDrainageSlat_" + i;
  slat.position.set(sx, 0.030, 0);
  trayGroup.add(slat);
}

const traySurfaceY = 0.0335;

// 2. Round Celadon Teapot (Kyusu / Dobin) with Curved Spout & Overhead Rattan Handle (x = -0.14, z = -0.04)
const teapotGroup = new THREE.Group();
teapotGroup.name = "CeladonTeapotGroup";
teapotGroup.position.set(-0.14, traySurfaceY, -0.04);
root.add(teapotGroup);

const potFoot = new THREE.Mesh(
  new THREE.TorusGeometry(0.042, 0.005, 12, 24),
  unglazedFootMat
);
potFoot.name = "TeapotUnglazedFootRing";
potFoot.rotation.x = Math.PI / 2;
potFoot.position.set(0, 0.005, 0);
teapotGroup.add(potFoot);

const potBelly = new THREE.Mesh(
  new THREE.SphereGeometry(0.072, 28, 20),
  celadonGlazeMat
);
potBelly.name = "TeapotRoundBelly";
potBelly.scale.set(1.0, 0.78, 1.0);
potBelly.position.set(0, 0.058, 0);
teapotGroup.add(potBelly);

const potCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.042, 0.046, 0.012, 24),
  celadonGlazeMat
);
potCollar.name = "TeapotNeckCollar";
potCollar.position.set(0, 0.11, 0);
teapotGroup.add(potCollar);

const potLid = new THREE.Mesh(
  new THREE.SphereGeometry(0.040, 24, 14),
  celadonGlazeMat
);
potLid.name = "TeapotDomedLid";
potLid.scale.set(1.0, 0.35, 1.0);
potLid.position.set(0, 0.116, 0);
teapotGroup.add(potLid);

const lidFinial = new THREE.Mesh(
  new THREE.SphereGeometry(0.011, 16, 12),
  celadonGlazeMat
);
lidFinial.name = "TeapotLidBeadFinial";
lidFinial.position.set(0, 0.134, 0);
teapotGroup.add(lidFinial);

// Curved Celadon Spout
const spoutCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.058, 0.052, 0),
  new THREE.Vector3(0.088, 0.068, 0),
  new THREE.Vector3(0.105, 0.098, 0),
  new THREE.Vector3(0.114, 0.108, 0)
]);
const spoutMesh = new THREE.Mesh(
  new THREE.TubeGeometry(spoutCurve, 20, 0.011, 12, false),
  celadonGlazeMat
);
spoutMesh.name = "TeapotCurvedSpout";
teapotGroup.add(spoutMesh);

// Arching Woven Rattan Handle (Torus arch + binding wraps)
const rattanArch = new THREE.Mesh(
  new THREE.TorusGeometry(0.056, 0.007, 12, 28, Math.PI * 1.05),
  rattanMat
);
rattanArch.name = "TeapotRattanArchHandle";
rattanArch.rotation.z = -0.025 * Math.PI;
rattanArch.position.set(0, 0.108, 0);
teapotGroup.add(rattanArch);

for (let lugSide of [-1, 1]) {
  const lug = new THREE.Mesh(
    new THREE.TorusGeometry(0.010, 0.0035, 10, 16),
    celadonGlazeMat
  );
  lug.name = "TeapotHandleLugLoop_" + (lugSide < 0 ? "Left" : "Right");
  lug.rotation.y = Math.PI / 2;
  lug.position.set(lugSide * 0.054, 0.102, 0);
  teapotGroup.add(lug);
}

// 3. Fairness Pitcher (Chahai / Gongdaobei) with Tea Inside & Strainer (x = 0.03, z = -0.05)
const pitcherGroup = new THREE.Group();
pitcherGroup.name = "FairnessPitcherAndStrainerGroup";
pitcherGroup.position.set(0.03, traySurfaceY, -0.05);
root.add(pitcherGroup);

const pitcherBody = new THREE.Mesh(
  new THREE.CylinderGeometry(0.038, 0.032, 0.078, 24),
  celadonGlazeMat
);
pitcherBody.name = "CeladonFairnessPitcherBody";
pitcherBody.position.set(0, 0.039, 0);
pitcherGroup.add(pitcherBody);

const pitcherHandle = new THREE.Mesh(
  new THREE.TorusGeometry(0.022, 0.005, 12, 20, Math.PI),
  celadonGlazeMat
);
pitcherHandle.name = "FairnessPitcherEarHandle";
pitcherHandle.rotation.z = -Math.PI / 2;
pitcherHandle.position.set(-0.036, 0.044, 0);
pitcherGroup.add(pitcherHandle);

const pitcherTea = new THREE.Mesh(
  new THREE.CylinderGeometry(0.034, 0.030, 0.048, 20),
  oolongTeaLiquidMat
);
pitcherTea.name = "FairnessPitcherTeaLiquid";
pitcherTea.position.set(0, 0.028, 0);
pitcherGroup.add(pitcherTea);

// Tea Strainer resting beside/on a small celadon holder stand (x = 0.16, z = -0.06)
const strainerGroup = new THREE.Group();
strainerGroup.name = "TeaStrainerGroup";
strainerGroup.position.set(0.16, traySurfaceY, -0.06);
root.add(strainerGroup);

const strainerStand = new THREE.Mesh(
  new THREE.CylinderGeometry(0.028, 0.032, 0.022, 20),
  celadonGlazeMat
);
strainerStand.name = "CeladonStrainerRest";
strainerStand.position.set(0, 0.011, 0);
strainerGroup.add(strainerStand);

const strainerRim = new THREE.Mesh(
  new THREE.TorusGeometry(0.028, 0.005, 12, 24),
  celadonGlazeMat
);
strainerRim.name = "CeladonStrainerRim";
strainerRim.rotation.x = Math.PI / 2;
strainerRim.position.set(0, 0.026, 0);
strainerGroup.add(strainerRim);

const strainerMeshBowl = new THREE.Mesh(
  new THREE.SphereGeometry(0.026, 16, 12, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
  brassMeshMat
);
strainerMeshBowl.name = "WovenBrassStrainerBowl";
strainerMeshBowl.position.set(0, 0.026, 0);
strainerGroup.add(strainerMeshBowl);

// 4. Four Small Handleless Celadon Teacups with Pale-Jade Glaze & Golden Tea Liquid Inside
const cupCoords = [
  [-0.16, 0.09],
  [-0.05, 0.10],
  [0.06, 0.10],
  [0.17, 0.09]
];

for (let c = 0; c < cupCoords.length; c++) {
  const cx = cupCoords[c][0];
  const cz = cupCoords[c][1];

  const cupGroup = new THREE.Group();
  cupGroup.name = "CeladonTeacupGroup_" + c;
  cupGroup.position.set(cx, traySurfaceY, cz);
  root.add(cupGroup);

  // Unglazed foot ring
  const cupFoot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.017, 0.005, 20),
    unglazedFootMat
  );
  cupFoot.name = "TeacupFootRing_" + c;
  cupFoot.position.set(0, 0.0025, 0);
  cupGroup.add(cupFoot);

  // Cup bowl outer & inner lip
  const cupBowl = new THREE.Mesh(
    new THREE.CylinderGeometry(0.032, 0.018, 0.038, 24),
    celadonGlazeMat
  );
  cupBowl.name = "CeladonTeacupBowl_" + c;
  cupBowl.position.set(0, 0.023, 0);
  cupGroup.add(cupBowl);

  const cupLip = new THREE.Mesh(
    new THREE.TorusGeometry(0.031, 0.0022, 10, 24),
    celadonGlazeMat
  );
  cupLip.name = "CeladonTeacupLip_" + c;
  cupLip.rotation.x = Math.PI / 2;
  cupLip.position.set(0, 0.042, 0);
  cupGroup.add(cupLip);

  // Golden Oolong tea liquid inside the cup
  const teaDisk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.022, 0.018, 20),
    oolongTeaLiquidMat
  );
  teaDisk.name = "TeacupLiquid_" + c;
  teaDisk.position.set(0, 0.026, 0);
  cupGroup.add(teaDisk);
}

// Camera framing (~0.56m tray width -> distance ~0.78m)
camera.position.set(0.08, 0.36, 0.68);
camera.lookAt(0, 0.07, 0.02);
