// anim_11: Illuminated Carnival Ferris Wheel
const carnivalScene = new THREE.Group();
carnivalScene.name = "CarnivalFerrisWheelScene";
scene.add(carnivalScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const eveningKeyLight = new THREE.DirectionalLight(0xffe8cc, 1.3);
eveningKeyLight.name = "CarnivalKeyLight";
eveningKeyLight.position.set(3.5, 4.5, 4.0);
scene.add(eveningKeyLight);

const hubGlowLight = new THREE.PointLight(0xf43f5e, 2.2, 6.0);
hubGlowLight.name = "FerrisHubNeonLight";
hubGlowLight.position.set(0, 1.72, 0);
scene.add(hubGlowLight);

// Materials
const steelFrameMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  roughness: 0.3,
  metalness: 0.85
});
const baseDeckMat = new THREE.MeshStandardMaterial({
  color: 0x334155,
  roughness: 0.7,
  metalness: 0.25
});
const hubMat = new THREE.MeshStandardMaterial({
  color: 0xf59e0b,
  emissive: 0xd97706,
  emissiveIntensity: 0.8,
  roughness: 0.25,
  metalness: 0.6
});

// Boarding Platform Deck at y = 0
const platformDeck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12, 1.3), baseDeckMat);
platformDeck.name = "BoardingPlatformDeck";
platformDeck.position.set(0, 0.06, 0);
carnivalScene.add(platformDeck);

// Twin A-Frame Support Towers straddling the Wheel (z = -0.36 and z = +0.36)
const axleHeight = 1.72;
const wheelRadius = 1.15; // Total height = 1.72 + 1.15 + gondola = ~3.0m
const legLength = 1.88;
const legSpreadAngle = 0.34;

const towerZOffsets = [-0.36, 0.36];
for (let side = 0; side < 2; side++) {
  const tz = towerZOffsets[side];
  const sideName = side === 0 ? "Back" : "Front";

  const leftLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, legLength, 16), steelFrameMat);
  leftLeg.name = `${sideName}TowerLeftLeg`;
  leftLeg.position.set(-0.32, axleHeight * 0.5, tz);
  leftLeg.rotation.z = -legSpreadAngle;
  carnivalScene.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, legLength, 16), steelFrameMat);
  rightLeg.name = `${sideName}TowerRightLeg`;
  rightLeg.position.set(0.32, axleHeight * 0.5, tz);
  rightLeg.rotation.z = legSpreadAngle;
  carnivalScene.add(rightLeg);

  const crossBrace = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.04, 0.04), steelFrameMat);
  crossBrace.name = `${sideName}TowerCrossBrace`;
  crossBrace.position.set(0, 0.85, tz);
  carnivalScene.add(crossBrace);
}

// Central Horizontal Axle Shaft
const centralAxle = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.84, 24), hubMat);
centralAxle.name = "CentralAxleShaft";
centralAxle.rotation.x = Math.PI / 2;
centralAxle.position.set(0, axleHeight, 0);
carnivalScene.add(centralAxle);

// Rotating Wheel Group
const wheelGroup = new THREE.Group();
wheelGroup.name = "RotatingFerrisWheel";
wheelGroup.position.set(0, axleHeight, 0);
carnivalScene.add(wheelGroup);

// Twin Parallel Outer Rims (TorusGeometry) at z = -0.22 and z = +0.22
const rimZOffsets = [-0.22, 0.22];
for (let r = 0; r < 2; r++) {
  const rz = rimZOffsets[r];
  const rim = new THREE.Mesh(new THREE.TorusGeometry(wheelRadius, 0.025, 16, 48), steelFrameMat);
  rim.name = r === 0 ? "BackWheelRim" : "FrontWheelRim";
  rim.position.set(0, 0, rz);
  wheelGroup.add(rim);
}

// 12 Radial Spokes, Emissive Neon Bulbs, and 12 Counter-Rotating Upright Gondolas
const gondolaCount = 12;
const gondolas = [];
const neonPalette = [0xf43f5e, 0x38bdf8, 0xfacc15, 0xa855f7, 0x4ade80, 0xfb923c];

for (let i = 0; i < gondolaCount; i++) {
  const angle = (i / gondolaCount) * Math.PI * 2;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const colorHex = neonPalette[i % neonPalette.length];

  const neonMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    emissive: colorHex,
    emissiveIntensity: 1.5,
    roughness: 0.2
  });

  // Front and Back Radial Spokes
  for (let r = 0; r < 2; r++) {
    const rz = rimZOffsets[r];
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, wheelRadius, 8), steelFrameMat);
    spoke.name = `WheelSpoke_${i + 1}_${r}`;
    spoke.position.set(cosA * wheelRadius * 0.5, sinA * wheelRadius * 0.5, rz);
    spoke.rotation.z = angle - Math.PI / 2;
    wheelGroup.add(spoke);

    // Emissive Neon Bulb on the Rim
    const bulb = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 10), neonMat);
    bulb.name = `RimNeonBulb_${i + 1}_${r}`;
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(cosA * wheelRadius, sinA * wheelRadius, rz + (r === 0 ? -0.025 : 0.025));
    wheelGroup.add(bulb);
  }

  // Gondola Hanger Pivot at (cosA * wheelRadius, sinA * wheelRadius, 0)
  const gondolaPivot = new THREE.Group();
  gondolaPivot.name = `GondolaPivot_${i + 1}`;
  gondolaPivot.position.set(cosA * wheelRadius, sinA * wheelRadius, 0);
  wheelGroup.add(gondolaPivot);

  // Horizontal Trunnion Bar between Front and Back Rims
  const trunnionBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.44, 10), steelFrameMat);
  trunnionBar.name = `GondolaTrunnion_${i + 1}`;
  trunnionBar.rotation.x = Math.PI / 2;
  gondolaPivot.add(trunnionBar);

  // Hanger Strut
  const hangerStrut = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14, 8), steelFrameMat);
  hangerStrut.name = `GondolaHanger_${i + 1}`;
  hangerStrut.position.set(0, -0.07, 0);
  gondolaPivot.add(hangerStrut);

  // Gondola Cabin Basket
  const cabinMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.35,
    metalness: 0.3
  });
  const cabinBasket = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.15, 0.24), cabinMat);
  cabinBasket.name = `GondolaCabin_${i + 1}`;
  cabinBasket.position.set(0, -0.18, 0);
  gondolaPivot.add(cabinBasket);

  const canopyRoof = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.04, 12), steelFrameMat);
  canopyRoof.name = `GondolaRoof_${i + 1}`;
  canopyRoof.position.set(0, -0.02, 0);
  gondolaPivot.add(canopyRoof);

  gondolas.push(gondolaPivot);
}

function animate(t) {
  const wheelAngle = t * 0.45;
  wheelGroup.rotation.z = wheelAngle;

  // Keep all 12 passenger gondolas upright (counter-rotate by -wheelAngle + slight pendulum sway)
  for (let i = 0; i < gondolas.length; i++) {
    gondolas[i].rotation.z = -wheelAngle + Math.sin(t * 2.2 + i) * 0.05;
  }
}

// Scene bounds: 3.0m tall, 2.5m wide -> radius ~1.65m around centerY = 1.5m
camera.position.set(1.6, 1.65, 3.4);
camera.lookAt(0, 1.48, 0);
