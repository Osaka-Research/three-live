// Regulation 8x8 Wooden Chessboard on a Pedestal Table with 32 Staunton Chess Pieces (y = 0)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff5e0, 1.35);
keyLight.name = "key_directional_light";
keyLight.position.set(1.8, 3.0, 2.2);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd8e8ff, 0.55);
fillLight.name = "fill_directional_light";
fillLight.position.set(-1.8, 2.0, -1.6);
scene.add(fillLight);

const chessSceneGroup = new THREE.Group();
chessSceneGroup.name = "staunton_chess_table_set";
scene.add(chessSceneGroup);

// Materials
const mahoganyTableMat = new THREE.MeshStandardMaterial({
  color: 0x4f2716,
  metalness: 0.08,
  roughness: 0.32
});

const lightSquareMat = new THREE.MeshStandardMaterial({
  color: 0xe6cda5,
  metalness: 0.05,
  roughness: 0.28
});

const darkSquareMat = new THREE.MeshStandardMaterial({
  color: 0x4a2c18,
  metalness: 0.06,
  roughness: 0.3
});

const boxwoodPieceMat = new THREE.MeshStandardMaterial({
  color: 0xf2dfb8,
  metalness: 0.08,
  roughness: 0.22
});

const ebonyPieceMat = new THREE.MeshStandardMaterial({
  color: 0x1c1a18,
  metalness: 0.14,
  roughness: 0.24
});

// 1. Turned Wooden Pedestal Table (y = 0 to y = 0.72m)
const tableBaseFoot = new THREE.Mesh(
  new THREE.CylinderGeometry(0.26, 0.29, 0.04, 32),
  mahoganyTableMat
);
tableBaseFoot.name = "pedestal_table_base_plinth";
tableBaseFoot.position.set(0, 0.02, 0);
chessSceneGroup.add(tableBaseFoot);

const pedestalColumn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.095, 0.62, 24),
  mahoganyTableMat
);
pedestalColumn.name = "pedestal_central_column";
pedestalColumn.position.set(0, 0.35, 0);
chessSceneGroup.add(pedestalColumn);

const pedestalBulge = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 24, 16),
  mahoganyTableMat
);
pedestalBulge.name = "pedestal_turned_baluster";
pedestalBulge.scale.set(1, 0.7, 1);
pedestalBulge.position.set(0, 0.22, 0);
chessSceneGroup.add(pedestalBulge);

const tabletopFrame = new THREE.Mesh(
  new THREE.BoxGeometry(0.64, 0.045, 0.64),
  mahoganyTableMat
);
tabletopFrame.name = "chessboard_outer_mahogany_frame";
tabletopFrame.position.set(0, 0.68, 0);
chessSceneGroup.add(tabletopFrame);

// 2. Regulation 8x8 Chessboard Squares via InstancedMesh (square size = 0.06m, board top y = 0.71m)
const sqSize = 0.06;
const squareGeo = new THREE.BoxGeometry(sqSize, 0.015, sqSize);
const lightSquaresInst = new THREE.InstancedMesh(squareGeo, lightSquareMat, 32);
lightSquaresInst.name = "light_chessboard_squares";
const darkSquaresInst = new THREE.InstancedMesh(squareGeo, darkSquareMat, 32);
darkSquaresInst.name = "dark_chessboard_squares";

const dummy = new THREE.Object3D();
let lightIdx = 0;
let darkIdx = 0;

for (let row = 0; row < 8; row++) {
  for (let col = 0; col < 8; col++) {
    const x = (col - 3.5) * sqSize;
    const z = (row - 3.5) * sqSize;
    dummy.position.set(x, 0.705, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    if ((row + col) % 2 === 0) {
      lightSquaresInst.setMatrixAt(lightIdx++, dummy.matrix);
    } else {
      darkSquaresInst.setMatrixAt(darkIdx++, dummy.matrix);
    }
  }
}
lightSquaresInst.instanceMatrix.needsUpdate = true;
darkSquaresInst.instanceMatrix.needsUpdate = true;
chessSceneGroup.add(lightSquaresInst);
chessSceneGroup.add(darkSquaresInst);

// 3. Full Set of 32 Staunton Chess Pieces Resting at boardSurfaceY = 0.7125
const boardSurfaceY = 0.7125;

// Shared piece base & collar InstancedMeshes for all 32 pieces
const pieceBaseGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.014, 20);
const whiteBasesInst = new THREE.InstancedMesh(pieceBaseGeo, boxwoodPieceMat, 16);
whiteBasesInst.name = "white_piece_bases_instanced";
const blackBasesInst = new THREE.InstancedMesh(pieceBaseGeo, ebonyPieceMat, 16);
blackBasesInst.name = "black_piece_bases_instanced";
chessSceneGroup.add(whiteBasesInst);
chessSceneGroup.add(blackBasesInst);

let whiteBaseCounter = 0;
let blackBaseCounter = 0;

function buildStauntonPiece(type, sideColor, col, row) {
  const isWhite = sideColor === "white";
  const mat = isWhite ? boxwoodPieceMat : ebonyPieceMat;
  const x = (col - 3.5) * sqSize;
  const z = (row - 3.5) * sqSize;

  // Record base in InstancedMesh
  dummy.position.set(x, boardSurfaceY + 0.007, z);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(1, 1, 1);
  dummy.updateMatrix();
  if (isWhite) {
    whiteBasesInst.setMatrixAt(whiteBaseCounter++, dummy.matrix);
  } else {
    blackBasesInst.setMatrixAt(blackBaseCounter++, dummy.matrix);
  }

  const pieceGroup = new THREE.Group();
  pieceGroup.name = `${sideColor}_${type}_c${col + 1}_r${row + 1}`;
  pieceGroup.position.set(x, boardSurfaceY + 0.014, z);
  chessSceneGroup.add(pieceGroup);

  if (type === "pawn") {
    const stem = new THREE.Mesh(
      new THREE.ConeGeometry(0.014, 0.032, 16),
      mat
    );
    stem.name = `${pieceGroup.name}_stem`;
    stem.position.y = 0.016;
    pieceGroup.add(stem);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.011, 16, 12),
      mat
    );
    head.name = `${pieceGroup.name}_head`;
    head.position.y = 0.036;
    pieceGroup.add(head);
  } else if (type === "rook") {
    const tower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.013, 0.016, 0.042, 16),
      mat
    );
    tower.name = `${pieceGroup.name}_tower`;
    tower.position.y = 0.021;
    pieceGroup.add(tower);

    const turret = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.015, 0.014, 16),
      mat
    );
    turret.name = `${pieceGroup.name}_crenellation`;
    turret.position.y = 0.046;
    pieceGroup.add(turret);
  } else if (type === "knight") {
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.016, 0.038, 16),
      mat
    );
    neck.name = `${pieceGroup.name}_neck`;
    neck.position.y = 0.019;
    neck.rotation.x = isWhite ? -0.22 : 0.22;
    pieceGroup.add(neck);

    const snout = new THREE.Mesh(
      new THREE.ConeGeometry(0.012, 0.028, 12),
      mat
    );
    snout.name = `${pieceGroup.name}_horse_snout`;
    snout.position.set(0, 0.042, isWhite ? -0.008 : 0.008);
    snout.rotation.x = isWhite ? -1.15 : 1.15;
    pieceGroup.add(snout);
  } else if (type === "bishop") {
    const stem = new THREE.Mesh(
      new THREE.ConeGeometry(0.015, 0.048, 16),
      mat
    );
    stem.name = `${pieceGroup.name}_stem`;
    stem.position.y = 0.024;
    pieceGroup.add(stem);

    const mitre = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 16, 12),
      mat
    );
    mitre.name = `${pieceGroup.name}_mitre`;
    mitre.scale.set(1, 1.45, 1);
    mitre.position.y = 0.052;
    pieceGroup.add(mitre);
  } else if (type === "queen") {
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.016, 0.058, 18),
      mat
    );
    body.name = `${pieceGroup.name}_body`;
    body.position.y = 0.029;
    pieceGroup.add(body);

    const coronet = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.01, 0.014, 16),
      mat
    );
    coronet.name = `${pieceGroup.name}_coronet`;
    coronet.position.y = 0.062;
    pieceGroup.add(coronet);

    const finial = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 12, 10),
      mat
    );
    finial.name = `${pieceGroup.name}_finial`;
    finial.position.y = 0.072;
    pieceGroup.add(finial);
  } else if (type === "king") {
    const body = new THREE.Mesh(
      new THREE.ConeGeometry(0.017, 0.064, 18),
      mat
    );
    body.name = `${pieceGroup.name}_body`;
    body.position.y = 0.032;
    pieceGroup.add(body);

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.011, 0.016, 16),
      mat
    );
    crown.name = `${pieceGroup.name}_crown`;
    crown.position.y = 0.068;
    pieceGroup.add(crown);

    const crossVert = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.016, 0.005),
      mat
    );
    crossVert.name = `${pieceGroup.name}_cross_vertical`;
    crossVert.position.y = 0.082;
    pieceGroup.add(crossVert);

    const crossHoriz = new THREE.Mesh(
      new THREE.BoxGeometry(0.013, 0.005, 0.005),
      mat
    );
    crossHoriz.name = `${pieceGroup.name}_cross_horizontal`;
    crossHoriz.position.y = 0.084;
    pieceGroup.add(crossHoriz);
  }
}

const backRankOrder = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook"
];

for (let col = 0; col < 8; col++) {
  // Black back rank (row 0) & pawns (row 1)
  buildStauntonPiece(backRankOrder[col], "black", col, 0);
  buildStauntonPiece("pawn", "black", col, 1);

  // White pawns (row 6) & back rank (row 7)
  buildStauntonPiece("pawn", "white", col, 6);
  buildStauntonPiece(backRankOrder[col], "white", col, 7);
}

whiteBasesInst.instanceMatrix.needsUpdate = true;
blackBasesInst.instanceMatrix.needsUpdate = true;

// Frame camera at ~2.2x bounding radius
camera.position.set(0.88, 1.05, 0.95);
camera.lookAt(0, 0.48, 0);
