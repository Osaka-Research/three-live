// Escape-Room Mechanical Puzzle Box with Key Sockets (xr_10)
scene.background = new THREE.Color(0x0c0a09);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const warmKeyLight = new THREE.DirectionalLight(0xfef3c7, 1.25);
warmKeyLight.name = "EscapeRoomOverheadLight";
warmKeyLight.position.set(2.0, 3.8, 2.5);
scene.add(warmKeyLight);

const jadeGlowLight = new THREE.PointLight(0x10b981, 1.2, 3.0);
jadeGlowLight.name = "JadeCorePointLight";
jadeGlowLight.position.set(0, 0.95, 0);
scene.add(jadeGlowLight);

// Materials
const mahoganyMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.5, metalness: 0.1 });
const agedBrassMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.88, roughness: 0.24 });
const antiqueBronzeMat = new THREE.MeshStandardMaterial({ color: 0x78350f, metalness: 0.8, roughness: 0.35 });
const jadeStoneMat = new THREE.MeshPhysicalMaterial({
  color: 0x10b981,
  emissive: 0x047857,
  emissiveIntensity: 0.3,
  roughness: 0.18,
  metalness: 0.05,
  clearcoat: 0.85,
  transmission: 0.35,
  transparent: true,
  opacity: 0.95
});

// Escape Room Pedestal Table (resting on y = 0)
const pedestalTable = new THREE.Group();
pedestalTable.name = "EscapeRoomPedestalTable";
pedestalTable.userData.xr = {
  anchor: "Table",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.2, friction: 0.8 }
};
scene.add(pedestalTable);

const tableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.44, 0.06, 24), mahoganyMat);
tableBase.name = "PedestalTableBase";
tableBase.position.y = 0.03;
pedestalTable.add(tableBase);

const tablePillar = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.68, 20), mahoganyMat);
tablePillar.name = "PedestalTableColumn";
tablePillar.position.y = 0.38;
pedestalTable.add(tablePillar);

const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.82), mahoganyMat);
tableTop.name = "PedestalTableTop";
tableTop.position.y = 0.745;
pedestalTable.add(tableTop);

// Intricate Brass-and-Jade Mechanical Puzzle Chest (on tabletop at y = 0.77)
const puzzleChest = new THREE.Group();
puzzleChest.name = "BrassJadePuzzleChest";
puzzleChest.position.set(0, 0.77, -0.04);
puzzleChest.userData.xr = {
  grab: "2-hand",
  handles: { rotateAxis: "y", minScale: 0.75, maxScale: 1.75 },
  outline: { color: "#10b981", thickness: 0.014 }
};
puzzleChest.userData.interactivity = {
  onSelect: [
    {
      action: "toggleTransform",
      target: "PuzzleChestHingedLid",
      property: "rotation",
      to: [-1.1, 0, 0],
      duration: 0.75
    },
    {
      action: "toggleTransform",
      target: "FrontDialGearWheel",
      property: "rotation",
      to: [0, 0, 3.14],
      duration: 0.75
    }
  ]
};
scene.add(puzzleChest);

// Chest Lower Vault Body & Jade Inlay Panels
const chestBody = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.32), antiqueBronzeMat);
chestBody.name = "PuzzleChestVaultBody";
chestBody.position.y = 0.11;
puzzleChest.add(chestBody);

const jadeFrontInlay = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.15, 0.33), jadeStoneMat);
jadeFrontInlay.name = "JadeCarvedInlayPanel";
jadeFrontInlay.position.y = 0.11;
puzzleChest.add(jadeFrontInlay);

// Corner Brass Columns
const cornerCoords = [
  [-0.22, 0.11, -0.15],
  [0.22, 0.11, -0.15],
  [-0.22, 0.11, 0.15],
  [0.22, 0.11, 0.15]
];
cornerCoords.forEach((pt, idx) => {
  const cornerPost = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.24, 14), agedBrassMat);
  cornerPost.name = `ChestBrassCornerPillar_${idx + 1}`;
  cornerPost.position.set(pt[0], pt[1], pt[2]);
  puzzleChest.add(cornerPost);
});

// Central Mechanical Combination Gear Rose on Front Face
const dialGear = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 12, 24), agedBrassMat);
dialGear.name = "FrontDialGearWheel";
dialGear.position.set(0, 0.11, 0.172);
puzzleChest.add(dialGear);

// Two Keyhole `snapSocket` Receivers on the Chest Front
const leftKeyholeSocket = new THREE.Group();
leftKeyholeSocket.name = "KeyholeSocketLeft";
leftKeyholeSocket.position.set(-0.13, 0.11, 0.175);
leftKeyholeSocket.userData.xr = {
  snapSocket: { id: "keyhole_left", radius: 0.10 }
};
puzzleChest.add(leftKeyholeSocket);

const leftEscutcheon = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.016, 18), agedBrassMat);
leftEscutcheon.name = "LeftKeyholeEscutcheon";
leftEscutcheon.rotation.x = Math.PI / 2;
leftKeyholeSocket.add(leftEscutcheon);

const rightKeyholeSocket = new THREE.Group();
rightKeyholeSocket.name = "KeyholeSocketRight";
rightKeyholeSocket.position.set(0.13, 0.11, 0.175);
rightKeyholeSocket.userData.xr = {
  snapSocket: { id: "keyhole_right", radius: 0.10 }
};
puzzleChest.add(rightKeyholeSocket);

const rightEscutcheon = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.016, 18), agedBrassMat);
rightEscutcheon.name = "RightKeyholeEscutcheon";
rightEscutcheon.rotation.x = Math.PI / 2;
rightKeyholeSocket.add(rightEscutcheon);

// Hinged Vaulted Lid Pivot (at back edge of chest: y = 0.22, z = -0.16)
const lidPivot = new THREE.Group();
lidPivot.name = "PuzzleChestHingedLid";
lidPivot.position.set(0, 0.22, -0.16);
puzzleChest.add(lidPivot);

const lidBox = new THREE.Mesh(new THREE.BoxGeometry(0.47, 0.07, 0.33), agedBrassMat);
lidBox.name = "ChestLidMainCover";
lidBox.position.set(0, 0.035, 0.16);
lidPivot.add(lidBox);

const lidJadeCrown = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.035, 0.20), jadeStoneMat);
lidJadeCrown.name = "ChestLidJadeCrown";
lidJadeCrown.position.set(0, 0.08, 0.16);
lidPivot.add(lidJadeCrown);

// Helper to build Grabbable Ornate Skeleton Keys on the Table
function createPuzzleKey(name, xPos, zPos, rotY, targetSocketName, bowMaterial) {
  const keyGroup = new THREE.Group();
  keyGroup.name = name;
  keyGroup.position.set(xPos, 0.785, zPos);
  keyGroup.rotation.y = rotY;
  keyGroup.userData.xr = {
    grab: "1-hand",
    snapTo: { radius: 0.11, targets: [targetSocketName] },
    physics: { body: "dynamic", collider: "hull", mass: 0.15, restitution: 0.2, friction: 0.6 },
    outline: { color: "#fbbf24", thickness: 0.01 }
  };

  const keyBow = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 10, 20), bowMaterial);
  keyBow.name = `${name}_BowRing`;
  keyBow.rotation.x = Math.PI / 2;
  keyBow.position.z = -0.055;
  keyGroup.add(keyBow);

  const keyShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.11, 12), agedBrassMat);
  keyShaft.name = `${name}_Shaft`;
  keyShaft.rotation.x = Math.PI / 2;
  keyGroup.add(keyShaft);

  const keyBit = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.008, 0.026), agedBrassMat);
  keyBit.name = `${name}_BitTeeth`;
  keyBit.position.set(0.012, 0, 0.038);
  keyGroup.add(keyBit);

  scene.add(keyGroup);
}

createPuzzleKey("OrnateBrassSunKey", -0.42, 0.18, 0.45, "KeyholeSocketLeft", agedBrassMat);
createPuzzleKey("OrnateJadeMoonKey", 0.42, 0.16, -0.52, "KeyholeSocketRight", jadeStoneMat);

camera.position.set(1.35, 1.42, 1.55);
camera.lookAt(0, 0.62, 0);
