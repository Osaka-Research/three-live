// mat_18: Stained-Glass Tiffany Dragonfly Table Lamp
const root = new THREE.Group();
root.name = "TiffanyDragonflyTableLampRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "TiffanyLampAmbientLight";
scene.add(ambientLight);

const roomDirLight = new THREE.DirectionalLight(0xfff6e6, 1.0);
roomDirLight.name = "RoomFillDirectionalLight";
roomDirLight.position.set(1.0, 2.0, 1.5);
scene.add(roomDirLight);

const interiorBulbLight = new THREE.PointLight(0xffb844, 3.2, 2.5);
interiorBulbLight.name = "InteriorStainedGlassBulbLight";
interiorBulbLight.position.set(0.0, 0.43, 0.0);
scene.add(interiorBulbLight);

// Materials
const patinatedBronzeMat = new THREE.MeshStandardMaterial({
  color: 0x3b3326,
  metalness: 0.84,
  roughness: 0.36
});

const leadCameMat = new THREE.MeshStandardMaterial({
  color: 0x1e2022,
  metalness: 0.78,
  roughness: 0.42
});

const warmBulbFilamentMat = new THREE.MeshStandardMaterial({
  color: 0xffdd77,
  emissive: 0xffaa22,
  emissiveIntensity: 3.0,
  roughness: 0.1
});

const amberGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffaa11,
  emissive: 0x994400,
  emissiveIntensity: 0.45,
  roughness: 0.08,
  metalness: 0.0,
  transmission: 0.9,
  ior: 1.53,
  thickness: 0.012,
  attenuationColor: 0xcc5500,
  attenuationDistance: 0.08,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03
});

const emeraldGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x00cc66,
  emissive: 0x005522,
  emissiveIntensity: 0.4,
  roughness: 0.08,
  metalness: 0.0,
  transmission: 0.9,
  ior: 1.53,
  thickness: 0.012,
  attenuationColor: 0x006633,
  attenuationDistance: 0.08,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03
});

const cobaltGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x1166ff,
  emissive: 0x052888,
  emissiveIntensity: 0.4,
  roughness: 0.08,
  metalness: 0.0,
  transmission: 0.9,
  ior: 1.53,
  thickness: 0.012,
  attenuationColor: 0x0033aa,
  attenuationDistance: 0.08,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03
});

const rubyCabochonMat = new THREE.MeshPhysicalMaterial({
  color: 0xff1133,
  emissive: 0xaa0011,
  emissiveIntensity: 0.8,
  roughness: 0.04,
  transmission: 0.92,
  ior: 1.65,
  clearcoat: 1.0
});

// 1. Patinated Bronze Tree-Trunk Base (~0.60m total lamp height, resting on y = 0)
const baseGroup = new THREE.Group();
baseGroup.name = "PatinatedBronzeTreeTrunkBase";
root.add(baseGroup);

// Rooted base pad & 6 organic root tendrils spreading onto y = 0
const rootPlinth = new THREE.Mesh(
  new THREE.CylinderGeometry(0.11, 0.145, 0.025, 24),
  patinatedBronzeMat
);
rootPlinth.name = "BronzeRootedFootPad";
rootPlinth.position.set(0, 0.0125, 0);
baseGroup.add(rootPlinth);

for (let r = 0; r < 6; r++) {
  const ra = (r / 6) * Math.PI * 2;
  const rootCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(Math.cos(ra) * 0.135, 0.012, Math.sin(ra) * 0.135),
    new THREE.Vector3(Math.cos(ra + 0.18) * 0.075, 0.045, Math.sin(ra + 0.18) * 0.075),
    new THREE.Vector3(Math.cos(ra + 0.35) * 0.032, 0.14, Math.sin(ra + 0.35) * 0.032)
  ]);
  const rootStrand = new THREE.Mesh(
    new THREE.TubeGeometry(rootCurve, 16, 0.011, 8, false),
    patinatedBronzeMat
  );
  rootStrand.name = "BronzeTreeRootTendril_" + r;
  baseGroup.add(rootStrand);
}

// Fluted / gnarled central bronze trunk column (y = 0.02 to y = 0.46)
const mainTrunk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.024, 0.042, 0.44, 16),
  patinatedBronzeMat
);
mainTrunk.name = "BronzeTreeTrunkColumn";
mainTrunk.position.set(0, 0.24, 0);
baseGroup.add(mainTrunk);

// Dual pull-chain sockets & acorn pulls under the shade
for (let side of [-1, 1]) {
  const chainWire = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0018, 0.0018, 0.11, 8),
    patinatedBronzeMat
  );
  chainWire.name = "BronzePullChain_" + (side < 0 ? "Left" : "Right");
  chainWire.position.set(side * 0.042, 0.34, 0.015);
  baseGroup.add(chainWire);

  const acornPull = new THREE.Mesh(
    new THREE.ConeGeometry(0.007, 0.016, 10),
    patinatedBronzeMat
  );
  acornPull.name = "BronzeAcornPull_" + (side < 0 ? "Left" : "Right");
  acornPull.rotation.x = Math.PI;
  acornPull.position.set(side * 0.042, 0.28, 0.015);
  baseGroup.add(acornPull);
}

// Interior Glowing Light Bulb inside the shade at y = 0.43
const interiorBulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.034, 20, 16),
  warmBulbFilamentMat
);
interiorBulb.name = "InteriorGlowingLampBulb";
interiorBulb.position.set(0, 0.43, 0);
baseGroup.add(interiorBulb);

// 2. Leaded Stained-Glass Dome Shade with Amber, Emerald, and Cobalt Panels & Dragonfly Motifs
const shadeGroup = new THREE.Group();
shadeGroup.name = "StainedGlassDomeShadeGroup";
shadeGroup.position.set(0, 0.36, 0);
root.add(shadeGroup);

// Multi-tier stained glass dome panels (12 sectors around azimuth x 3 elevation tiers)
const numSectors = 12;
const dPhi = (Math.PI * 2) / numSectors;
const gap = 0.02;

for (let s = 0; s < numSectors; s++) {
  const phiStart = s * dPhi;

  // Upper Crown Tier (Amber & Emerald alternating)
  const upperMat = s % 2 === 0 ? amberGlassMat : emeraldGlassMat;
  const upperPanel = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 8, 6, phiStart + gap, dPhi - gap * 2, 0.16, 0.46),
    upperMat
  );
  upperPanel.name = "StainedGlassUpperPanel_" + s;
  upperPanel.material.side = THREE.DoubleSide;
  shadeGroup.add(upperPanel);

  // Middle Belly Tier (Emerald, Cobalt, Amber mosaic)
  const midMat = s % 3 === 0 ? emeraldGlassMat : s % 3 === 1 ? cobaltGlassMat : amberGlassMat;
  const midPanel = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 8, 6, phiStart + gap, dPhi - gap * 2, 0.64, 0.50),
    midMat
  );
  midPanel.name = "StainedGlassMiddlePanel_" + s;
  midPanel.material.side = THREE.DoubleSide;
  shadeGroup.add(midPanel);

  // Lower Skirt Apron Tier (Cobalt & Amber stained glass skirt cone segments)
  const lowerMat = s % 2 === 0 ? cobaltGlassMat : amberGlassMat;
  const skirtPanel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.188, 0.215, 0.065, 8, 1, true, phiStart + gap, dPhi - gap * 2),
    lowerMat
  );
  skirtPanel.name = "StainedGlassSkirtPanel_" + s;
  skirtPanel.material.side = THREE.DoubleSide;
  skirtPanel.position.set(0, 0.06, 0);
  shadeGroup.add(skirtPanel);

  // Radial Lead Came Rib dividing each sector
  const ribCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(Math.cos(phiStart) * 0.055, 0.205, Math.sin(phiStart) * 0.055),
    new THREE.Vector3(Math.cos(phiStart) * 0.165, 0.145, Math.sin(phiStart) * 0.165),
    new THREE.Vector3(Math.cos(phiStart) * 0.205, 0.075, Math.sin(phiStart) * 0.205),
    new THREE.Vector3(Math.cos(phiStart) * 0.216, 0.025, Math.sin(phiStart) * 0.216)
  ]);
  const leadRib = new THREE.Mesh(
    new THREE.TubeGeometry(ribCurve, 16, 0.0032, 6, false),
    leadCameMat
  );
  leadRib.name = "LeadCameRadialRib_" + s;
  shadeGroup.add(leadRib);
}

// Horizontal Lead Came Solder Rings around the dome
const ringLevels = [
  { r: 0.132, y: 0.165 },
  { r: 0.190, y: 0.092 },
  { r: 0.215, y: 0.028 }
];
for (let l = 0; l < ringLevels.length; l++) {
  const solderRing = new THREE.Mesh(
    new THREE.TorusGeometry(ringLevels[l].r, 0.0035, 10, 36),
    leadCameMat
  );
  solderRing.name = "LeadCameHorizontalRing_" + l;
  solderRing.rotation.x = Math.PI / 2;
  solderRing.position.set(0, ringLevels[l].y, 0);
  shadeGroup.add(solderRing);
}

// 6 Signature Tiffany Dragonfly Motifs encircling the lower band of the shade
for (let d = 0; d < 6; d++) {
  const angle = (d / 6) * Math.PI * 2 + dPhi * 0.5;
  const dfGroup = new THREE.Group();
  dfGroup.name = "TiffanyDragonflyMotif_" + d;
  dfGroup.position.set(Math.cos(angle) * 0.206, 0.062, Math.sin(angle) * 0.206);
  dfGroup.rotation.y = -angle + Math.PI / 2;
  dfGroup.rotation.x = 0.25; // Tilted head-down along the shade skirt
  shadeGroup.add(dfGroup);

  // Dragonfly segmented emerald/cobalt abdomen body (ConeGeometry)
  const abdomen = new THREE.Mesh(
    new THREE.ConeGeometry(0.006, 0.068, 8),
    emeraldGlassMat
  );
  abdomen.name = "DragonflyAbdomen_" + d;
  abdomen.position.set(0, 0.015, 0);
  dfGroup.add(abdomen);

  // Glowing Ruby Cabochon Eyes
  for (let eyeSide of [-1, 1]) {
    const eyeGem = new THREE.Mesh(
      new THREE.SphereGeometry(0.0055, 10, 8),
      rubyCabochonMat
    );
    eyeGem.name = "DragonflyRubyEye_" + d + "_" + (eyeSide < 0 ? "L" : "R");
    eyeGem.position.set(eyeSide * 0.005, -0.022, 0.004);
    dfGroup.add(eyeGem);
  }

  // Filigree Amber Wings (left & right pairs)
  for (let wSide of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.006, 0.055, 8),
      amberGlassMat
    );
    wing.name = "DragonflyFiligreeWing_" + d + "_" + (wSide < 0 ? "Left" : "Right");
    wing.scale.set(1.0, 1.0, 0.22);
    wing.rotation.z = wSide * (Math.PI / 2 - 0.18);
    wing.position.set(wSide * 0.028, -0.008, 0.003);
    dfGroup.add(wing);
  }
}

// Openwork Bronze Crown Cap & Spire Finial at apex (y = 0.57 to y = 0.61)
const crownCap = new THREE.Mesh(
  new THREE.ConeGeometry(0.062, 0.032, 16),
  patinatedBronzeMat
);
crownCap.name = "BronzeShadeCrownCap";
crownCap.position.set(0, 0.215, 0);
shadeGroup.add(crownCap);

const spireFinial = new THREE.Mesh(
  new THREE.ConeGeometry(0.014, 0.045, 12),
  patinatedBronzeMat
);
spireFinial.name = "BronzeSpireFinial";
spireFinial.position.set(0, 0.245, 0);
shadeGroup.add(spireFinial);

// Camera framing (~0.61m tall -> distance ~0.95m)
camera.position.set(0.0, 0.36, 0.92);
camera.lookAt(0, 0.30, 0);
