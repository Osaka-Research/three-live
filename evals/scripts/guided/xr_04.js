// Physics Carnival Ball-Toss & Stacked Can Pyramid (xr_04)
scene.background = new THREE.Color(0x0f172a);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const boothSpotLight = new THREE.DirectionalLight(0xfef3c7, 1.2);
boothSpotLight.name = "CarnivalKeyLight";
boothSpotLight.position.set(2.2, 4.0, 3.2);
scene.add(boothSpotLight);

const festoonLight = new THREE.PointLight(0xf59e0b, 1.3, 4.0);
festoonLight.name = "BoothFestoonPointLight";
festoonLight.position.set(0, 1.85, 0.3);
scene.add(festoonLight);

// Materials
const woodCounterMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.55, metalness: 0.08 });
const redStripeMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5, metalness: 0.1 });
const creamStripeMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.55, metalness: 0.05 });
const tinSilverMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.88, roughness: 0.22 });
const canLabelColors = [0xef4444, 0x3b82f6, 0x10b981, 0xf59e0b];
const leatherBallMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.05 });
const seamRedMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.6 });

// Carnival Booth Counter Table (Static Physics Body resting on y = 0)
const boothTable = new THREE.Group();
boothTable.name = "CarnivalBoothTable";
boothTable.userData.xr = {
  anchor: "Floor",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.4, friction: 0.65 }
};
scene.add(boothTable);

// Striped Front Skirt Panels
for (let i = 0; i < 7; i++) {
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.78, 0.82),
    i % 2 === 0 ? redStripeMat : creamStripeMat
  );
  stripe.name = `BoothSkirtStripe_${i + 1}`;
  stripe.position.set(-0.72 + i * 0.24, 0.39, 0);
  boothTable.add(stripe);
}

// Hardwood Countertop (top surface at y = 0.82)
const counterTop = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.04, 0.90), woodCounterMat);
counterTop.name = "BoothCounterTop";
counterTop.position.set(0, 0.80, 0);
boothTable.add(counterTop);

// Raised Pedestal Platform for the Can Pyramid (top at y = 0.90)
const canPlinth = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.08, 0.34), woodCounterMat);
canPlinth.name = "PyramidPlinth";
canPlinth.position.set(0, 0.86, -0.18);
boothTable.add(canPlinth);

// Carnival Canopy Arch Pillars & Banner
[-0.82, 0.82].forEach((xPos, idx) => {
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.15, 14), woodCounterMat);
  pillar.name = `BoothCanopyPillar_${idx + 1}`;
  pillar.position.set(xPos, 1.38, -0.36);
  boothTable.add(pillar);
});

const canopyHeader = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.18, 0.16), redStripeMat);
canopyHeader.name = "BoothCanopyHeader";
canopyHeader.position.set(0, 1.96, -0.36);
canopyHeader.userData.xr = {
  objective: { id: "knockdown_cans", kind: "score", target: "CarnivalBoothTable", radius: 1.5 }
};
boothTable.add(canopyHeader);

// 4-Tier Pyramid of 10 Tin Cans (4 + 3 + 2 + 1)
const canRadius = 0.048;
const canHeight = 0.13;
const canSpacingX = 0.106;
const tiers = [4, 3, 2, 1];
let canIndex = 1;

tiers.forEach((count, tierIdx) => {
  const yCenter = 0.90 + canHeight * 0.5 + tierIdx * canHeight;
  const rowWidth = (count - 1) * canSpacingX;
  for (let c = 0; c < count; c++) {
    const xPos = -rowWidth * 0.5 + c * canSpacingX;
    const canGroup = new THREE.Group();
    canGroup.name = `TinCan_${canIndex}`;
    canGroup.position.set(xPos, yCenter, -0.18);
    canGroup.userData.xr = {
      physics: { body: "dynamic", collider: "hull", mass: 0.3, restitution: 0.4, friction: 0.5 },
      integrity: { hp: 10, maxHp: 10, armor: 0, onZero: "hide", scoreValue: 10 },
      audioCues: { onHit: "tin_clank.ogg", onZero: "can_fall.ogg" }
    };

    const cylinderBody = new THREE.Mesh(
      new THREE.CylinderGeometry(canRadius, canRadius, canHeight, 20),
      tinSilverMat
    );
    cylinderBody.name = `TinCanBody_${canIndex}`;
    canGroup.add(cylinderBody);

    const labelWrap = new THREE.Mesh(
      new THREE.CylinderGeometry(canRadius + 0.001, canRadius + 0.001, canHeight * 0.62, 20),
      new THREE.MeshStandardMaterial({
        color: canLabelColors[tierIdx % canLabelColors.length],
        roughness: 0.35
      })
    );
    labelWrap.name = `TinCanLabel_${canIndex}`;
    canGroup.add(labelWrap);

    const topRim = new THREE.Mesh(new THREE.TorusGeometry(canRadius, 0.0035, 8, 20), tinSilverMat);
    topRim.name = `TinCanTopRim_${canIndex}`;
    topRim.rotation.x = Math.PI / 2;
    topRim.position.y = canHeight * 0.5;
    canGroup.add(topRim);

    const bottomRim = new THREE.Mesh(new THREE.TorusGeometry(canRadius, 0.0035, 8, 20), tinSilverMat);
    bottomRim.name = `TinCanBottomRim_${canIndex}`;
    bottomRim.rotation.x = Math.PI / 2;
    bottomRim.position.y = -canHeight * 0.5;
    canGroup.add(bottomRim);

    scene.add(canGroup);
    canIndex++;
  }
});

// 3 Grabbable Baseballs on the Front Counter Rail
const ballRadius = 0.042;
[-0.26, 0.0, 0.26].forEach((xPos, idx) => {
  const ballGroup = new THREE.Group();
  ballGroup.name = `CarnivalBaseball_${idx + 1}`;
  ballGroup.position.set(xPos, 0.82 + ballRadius, 0.28);
  ballGroup.userData.xr = {
    grab: "1-hand",
    physics: { body: "dynamic", collider: "sphere", mass: 0.145, restitution: 0.7, friction: 0.4 },
    outline: { color: "#f59e0b", thickness: 0.01 }
  };

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(ballRadius, 20, 16), leatherBallMat);
  sphere.name = `BaseballCore_${idx + 1}`;
  ballGroup.add(sphere);

  const seamRing1 = new THREE.Mesh(new THREE.TorusGeometry(ballRadius * 0.99, 0.0025, 8, 24), seamRedMat);
  seamRing1.name = `BaseballSeamA_${idx + 1}`;
  seamRing1.rotation.set(0.5, 0.4, 0.0);
  ballGroup.add(seamRing1);

  const seamRing2 = new THREE.Mesh(new THREE.TorusGeometry(ballRadius * 0.99, 0.0025, 8, 24), seamRedMat);
  seamRing2.name = `BaseballSeamB_${idx + 1}`;
  seamRing2.rotation.set(-0.5, -0.4, Math.PI * 0.5);
  ballGroup.add(seamRing2);

  scene.add(ballGroup);
});

camera.position.set(1.85, 1.75, 2.35);
camera.lookAt(0, 1.0, -0.1);
