// mat_08: Alchemist's Cast-Iron Cauldron with Glowing Embers
const root = new THREE.Group();
root.name = "AlchemistCauldronRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "CauldronAmbientLight";
scene.add(ambientLight);

const moonDirLight = new THREE.DirectionalLight(0x99bbff, 0.8);
moonDirLight.name = "NightRimDirectionalLight";
moonDirLight.position.set(-1.5, 2.5, 1.5);
scene.add(moonDirLight);

const emberFireLight = new THREE.PointLight(0xff4400, 3.0, 2.5);
emberFireLight.name = "FirepitEmberPointLight";
emberFireLight.position.set(0.0, 0.14, 0.0);
scene.add(emberFireLight);

const potionGlowLight = new THREE.PointLight(0x22ff55, 2.8, 2.8);
potionGlowLight.name = "LuminescentPotionPointLight";
potionGlowLight.position.set(0.0, 0.68, 0.0);
scene.add(potionGlowLight);

// Materials
const stoneMat = new THREE.MeshStandardMaterial({
  color: 0x4a4d52,
  roughness: 0.9,
  metalness: 0.05
});

const ashBedMat = new THREE.MeshStandardMaterial({
  color: 0x1b1918,
  roughness: 0.95,
  metalness: 0.0
});

const hotEmberOrangeMat = new THREE.MeshStandardMaterial({
  color: 0xff5500,
  emissive: 0xff3b00,
  emissiveIntensity: 2.4,
  roughness: 0.6,
  metalness: 0.0
});

const hotEmberRedMat = new THREE.MeshStandardMaterial({
  color: 0xcc1100,
  emissive: 0xd91b00,
  emissiveIntensity: 1.8,
  roughness: 0.7,
  metalness: 0.0
});

const castIronMat = new THREE.MeshStandardMaterial({
  color: 0x1e2024,
  metalness: 0.78,
  roughness: 0.58
});

const potionSurfaceMat = new THREE.MeshStandardMaterial({
  color: 0x33ff66,
  emissive: 0x11dd44,
  emissiveIntensity: 1.9,
  roughness: 0.12,
  metalness: 0.05
});

const potionBubbleMat = new THREE.MeshPhysicalMaterial({
  color: 0x66ff88,
  emissive: 0x22ee55,
  emissiveIntensity: 1.4,
  roughness: 0.05,
  transmission: 0.75,
  ior: 1.35,
  thickness: 0.03,
  transparent: true,
  opacity: 0.88
});

const vaporSphereMat = new THREE.MeshPhysicalMaterial({
  color: 0x99ffbb,
  emissive: 0x33cc66,
  emissiveIntensity: 0.75,
  roughness: 0.3,
  transmission: 0.82,
  transparent: true,
  opacity: 0.55
});

// Stone Firepit Ring & Glowing Charcoal Embers (y = 0)
const firepitGroup = new THREE.Group();
firepitGroup.name = "StoneFirepitGroup";
root.add(firepitGroup);

const ashBase = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.46, 0.04, 24),
  ashBedMat
);
ashBase.name = "CharcoalAshBed";
ashBase.position.set(0, 0.02, 0);
firepitGroup.add(ashBase);

// Ring of 14 firepit stones
const numStones = 14;
for (let i = 0; i < numStones; i++) {
  const angle = (i / numStones) * Math.PI * 2;
  const r = 0.44 + (i % 2) * 0.015;
  const stone = new THREE.Mesh(
    new THREE.SphereGeometry(0.085, 10, 8),
    stoneMat
  );
  stone.name = "FirepitBoulder_" + i;
  stone.scale.set(1.15, 0.72, 0.95);
  stone.position.set(Math.cos(angle) * r, 0.055, Math.sin(angle) * r);
  stone.rotation.y = angle;
  firepitGroup.add(stone);
}

// Charred firewood logs & glowing orange/red charcoal embers
for (let l = 0; l < 4; l++) {
  const la = (l / 4) * Math.PI + 0.3;
  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.038, 0.042, 0.58, 12),
    ashBedMat
  );
  log.name = "CharredLog_" + l;
  log.rotation.z = Math.PI / 2;
  log.rotation.y = la;
  log.position.set(0, 0.055 + (l % 2) * 0.02, 0);
  firepitGroup.add(log);
}

const emberPositions = [
  [0.0, 0.06, 0.0, 0.055],
  [0.11, 0.055, 0.06, 0.045],
  [-0.10, 0.055, 0.08, 0.048],
  [0.08, 0.05, -0.11, 0.044],
  [-0.12, 0.05, -0.07, 0.050],
  [0.02, 0.065, 0.14, 0.040],
  [-0.03, 0.065, -0.14, 0.042],
  [0.18, 0.045, -0.02, 0.038],
  [-0.19, 0.045, 0.02, 0.038],
  [0.06, 0.075, 0.03, 0.035],
  [-0.06, 0.075, -0.02, 0.036],
  [0.14, 0.05, 0.13, 0.034]
];
for (let e = 0; e < emberPositions.length; e++) {
  const ep = emberPositions[e];
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(ep[3], 8, 6),
    e % 2 === 0 ? hotEmberOrangeMat : hotEmberRedMat
  );
  ember.name = "GlowingCharcoalEmber_" + e;
  ember.scale.set(1.2, 0.65, 0.9);
  ember.position.set(ep[0], ep[1], ep[2]);
  firepitGroup.add(ember);
}

// Three-Legged Cast-Iron Cauldron over the firepit
const cauldronGroup = new THREE.Group();
cauldronGroup.name = "CastIronCauldronGroup";
root.add(cauldronGroup);

// Pot belly sphere (center at y = 0.42, radius = 0.28)
const bellySphere = new THREE.Mesh(
  new THREE.SphereGeometry(0.28, 28, 20, 0, Math.PI * 2, 0.42, Math.PI - 0.42),
  castIronMat
);
bellySphere.name = "CauldronBellyPot";
bellySphere.position.set(0, 0.42, 0);
cauldronGroup.add(bellySphere);

// Cauldron bottom cap
const bottomCap = new THREE.Mesh(
  new THREE.SphereGeometry(0.18, 20, 12),
  castIronMat
);
bottomCap.name = "CauldronBottomBase";
bottomCap.scale.set(1, 0.35, 1);
bottomCap.position.set(0, 0.175, 0);
cauldronGroup.add(bottomCap);

// Flared neck collar & rolled lip Torus rim at y = 0.60
const neckCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.255, 0.235, 0.06, 28),
  castIronMat
);
neckCollar.name = "CauldronFlaredNeck";
neckCollar.position.set(0, 0.59, 0);
cauldronGroup.add(neckCollar);

const rolledLip = new THREE.Mesh(
  new THREE.TorusGeometry(0.255, 0.022, 16, 36),
  castIronMat
);
rolledLip.name = "CauldronRolledLipRim";
rolledLip.rotation.x = Math.PI / 2;
rolledLip.position.set(0, 0.62, 0);
cauldronGroup.add(rolledLip);

// 3 Sturdy Cast-Iron Legs reaching down into the stone firepit
for (let i = 0; i < 3; i++) {
  const angle = (i / 3) * Math.PI * 2 + Math.PI / 6;
  const leg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.026, 0.018, 0.24, 12),
    castIronMat
  );
  leg.name = "CauldronIronLeg_" + i;
  leg.position.set(Math.cos(angle) * 0.20, 0.13, Math.sin(angle) * 0.20);
  leg.rotation.z = Math.cos(angle) * 0.28;
  leg.rotation.x = -Math.sin(angle) * 0.28;
  cauldronGroup.add(leg);

  const clawFoot = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 10, 8),
    castIronMat
  );
  clawFoot.name = "CauldronClawFoot_" + i;
  clawFoot.scale.set(1.2, 0.6, 1.2);
  clawFoot.position.set(Math.cos(angle) * 0.235, 0.03, Math.sin(angle) * 0.235);
  cauldronGroup.add(clawFoot);
}

// 2 Iron Ring Handles on opposite sides of the cauldron belly
for (let side of [-1, 1]) {
  const lugMount = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.025, 0.05, 12),
    castIronMat
  );
  lugMount.name = "CauldronHandleLug_" + (side < 0 ? "Left" : "Right");
  lugMount.rotation.z = Math.PI / 2;
  lugMount.position.set(side * 0.275, 0.49, 0);
  cauldronGroup.add(lugMount);

  const ringHandle = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.011, 12, 24),
    castIronMat
  );
  ringHandle.name = "CauldronIronRingHandle_" + (side < 0 ? "Left" : "Right");
  ringHandle.rotation.y = Math.PI / 2;
  ringHandle.rotation.x = side * 0.22;
  ringHandle.position.set(side * 0.30, 0.445, 0);
  cauldronGroup.add(ringHandle);
}

// Bubbling Green Luminescent Potion Surface & Rising Vapor Spheres
const potionGroup = new THREE.Group();
potionGroup.name = "BubblingPotionAndVaporGroup";
root.add(potionGroup);

const potionDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(0.242, 0.242, 0.02, 28),
  potionSurfaceMat
);
potionDisc.name = "GlowingGreenPotionSurface";
potionDisc.position.set(0, 0.595, 0);
potionGroup.add(potionDisc);

// Surface potion bubbles
const surfaceBubbles = [
  [0.0, 0.61, 0.0, 0.038],
  [-0.09, 0.608, 0.06, 0.032],
  [0.10, 0.605, -0.05, 0.028],
  [0.04, 0.606, 0.12, 0.025],
  [-0.07, 0.605, -0.11, 0.030],
  [0.14, 0.602, 0.07, 0.022],
  [-0.15, 0.602, -0.02, 0.024],
  [0.01, 0.604, -0.16, 0.020]
];
for (let b = 0; b < surfaceBubbles.length; b++) {
  const sb = surfaceBubbles[b];
  const bubble = new THREE.Mesh(
    new THREE.SphereGeometry(sb[3], 16, 12),
    potionBubbleMat
  );
  bubble.name = "PotionSurfaceBubble_" + b;
  bubble.position.set(sb[0], sb[1], sb[2]);
  potionGroup.add(bubble);
}

// Rising luminescent vapor spheres above the cauldron
const vaporSpheres = [
  [0.02, 0.72, -0.02, 0.042],
  [-0.08, 0.79, 0.05, 0.052],
  [0.09, 0.86, 0.03, 0.046],
  [-0.03, 0.95, -0.05, 0.060],
  [0.06, 1.05, -0.01, 0.050],
  [-0.07, 1.14, 0.03, 0.065],
  [0.01, 1.24, 0.00, 0.044]
];
for (let v = 0; v < vaporSpheres.length; v++) {
  const vs = vaporSpheres[v];
  const vapor = new THREE.Mesh(
    new THREE.SphereGeometry(vs[3], 16, 12),
    vaporSphereMat
  );
  vapor.name = "RisingPotionVaporSphere_" + v;
  vapor.position.set(vs[0], vs[1], vs[2]);
  potionGroup.add(vapor);
}

// Camera framing (~1.3m height -> distance ~1.85m)
camera.position.set(0.35, 0.85, 1.75);
camera.lookAt(0, 0.55, 0);
