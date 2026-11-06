const cabinetGroup = new THREE.Group();
cabinetGroup.position.set(0, 0, 0);
scene.add(cabinetGroup);

const cabMat = new THREE.MeshStandardMaterial({ color: 0x1a1a24, roughness: 0.5, metalness: 0.1 });
const artMat = new THREE.MeshStandardMaterial({ color: 0x221133, roughness: 0.4 });
const marqueeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffddaa, emissiveIntensity: 1.2 });
const crtMat = new THREE.MeshStandardMaterial({ color: 0x051525, roughness: 0.1, metalness: 0.8 });
const stickMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.2, metalness: 0.1 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.2 });

// Extruded side panels with classic 80s contour cutouts (1.8m tall)
const sideShape = new THREE.Shape();
sideShape.moveTo(0, 0);
sideShape.lineTo(0.75, 0);
sideShape.lineTo(0.75, 0.7);
sideShape.lineTo(0.9, 0.95);
sideShape.lineTo(0.7, 1.25);
sideShape.lineTo(0.78, 1.65);
sideShape.lineTo(0.55, 1.8);
sideShape.lineTo(0, 1.8);
sideShape.closePath();

const sideGeo = new THREE.ExtrudeGeometry(sideShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01 });
const leftSide = new THREE.Mesh(sideGeo, cabMat);
leftSide.position.set(-0.34, 0, -0.4);
cabinetGroup.add(leftSide);

const rightSide = new THREE.Mesh(sideGeo, cabMat);
rightSide.position.set(0.30, 0, -0.4);
cabinetGroup.add(rightSide);

// Main cabinet core body
const bodyGeo = new THREE.BoxGeometry(0.6, 1.76, 0.7);
const body = new THREE.Mesh(bodyGeo, cabMat);
body.position.set(0, 0.88, -0.05);
cabinetGroup.add(body);

// Recessed CRT screen with curved front glass
const crtGeo = new THREE.BoxGeometry(0.52, 0.4, 0.06);
const crt = new THREE.Mesh(crtGeo, crtMat);
crt.position.set(0, 1.28, 0.15);
crt.rotation.x = -0.35;
cabinetGroup.add(crt);

// Marquee illuminated display
const marqueeGeo = new THREE.BoxGeometry(0.58, 0.18, 0.05);
const marquee = new THREE.Mesh(marqueeGeo, marqueeMat);
marquee.position.set(0, 1.7, 0.24);
marquee.rotation.x = 0.12;
cabinetGroup.add(marquee);

const marqueeLight = new THREE.PointLight(0xffeedd, 2.0, 1.8);
marqueeLight.position.set(0, 1.7, 0.32);
cabinetGroup.add(marqueeLight);

// Angled control deck
const deckGeo = new THREE.BoxGeometry(0.62, 0.08, 0.32);
const deck = new THREE.Mesh(deckGeo, artMat);
deck.position.set(0, 0.96, 0.26);
deck.rotation.x = 0.2;
cabinetGroup.add(deck);

// 2-Player Joysticks (shaft: CylinderGeometry, ball-top: SphereGeometry)
const stickShaftGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.07, 16);
const stickBallGeo = new THREE.SphereGeometry(0.022, 16, 16);
[-0.15, 0.15].forEach((xPos, idx) => {
  const shaft = new THREE.Mesh(stickShaftGeo, chromeMat);
  shaft.position.set(xPos, 1.03, 0.26);
  cabinetGroup.add(shaft);
  const ball = new THREE.Mesh(stickBallGeo, idx === 0 ? stickMat : new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.2 }));
  ball.position.set(xPos, 1.07, 0.26);
  cabinetGroup.add(ball);

  // Buttons
  const btnGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.01, 16);
  const btnColors = [0xef4444, 0x3b82f6, 0x10b981];
  for (let b = 0; b < 3; b++) {
    const btn = new THREE.Mesh(btnGeo, new THREE.MeshStandardMaterial({ color: btnColors[b] }));
    btn.position.set(xPos + 0.06 + b * 0.028, 1.01, 0.24 + (b % 2) * 0.02);
    btn.rotation.x = 0.2;
    cabinetGroup.add(btn);
  }
});

// Dual coin door with coin reject slots
const coinDoorGeo = new THREE.BoxGeometry(0.35, 0.45, 0.03);
const coinDoor = new THREE.Mesh(coinDoorGeo, new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.6 }));
coinDoor.position.set(0, 0.42, 0.3);
cabinetGroup.add(coinDoor);

const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambLight);
const spot = new THREE.DirectionalLight(0xfff0dd, 1.5);
spot.position.set(1.5, 3, 2.5);
scene.add(spot);
