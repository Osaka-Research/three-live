const ambLight = new THREE.AmbientLight(0xfff6ed, 0.7);
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
dirLight.position.set(3, 4, 2);
scene.add(ambLight, dirLight);

const chessTable = new THREE.Group();
chessTable.position.set(0, 0, 0);

const lightWood = new THREE.MeshStandardMaterial({ color: 0xecd5ab, roughness: 0.35 });
const darkWood = new THREE.MeshStandardMaterial({ color: 0x3d2314, roughness: 0.35 });
const tableWood = new THREE.MeshStandardMaterial({ color: 0x5a3825, roughness: 0.45 });

// Pedestal table
const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 32), tableWood);
tableTop.position.y = 0.74;
const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.065, 0.72, 24), tableWood);
pillar.position.y = 0.36;
const tableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.03, 32), tableWood);
tableBase.position.y = 0.015;
chessTable.add(tableTop, pillar, tableBase);

// Chessboard frame (0.44m x 0.44m)
const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.44), tableWood);
boardFrame.position.y = 0.76;
chessTable.add(boardFrame);

// 8x8 Board Tiles using InstancedMesh
const tileGeo = new THREE.BoxGeometry(0.048, 0.005, 0.048);
const lightTiles = new THREE.InstancedMesh(tileGeo, lightWood, 32);
const darkTiles = new THREE.InstancedMesh(tileGeo, darkWood, 32);
let lIdx = 0, dIdx = 0;
const dummy = new THREE.Object3D();
for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 8; c++) {
    const x = (c - 3.5) * 0.048;
    const z = (r - 3.5) * 0.048;
    dummy.position.set(x, 0.772, z);
    dummy.updateMatrix();
    if ((r + c) % 2 === 0) {
      lightTiles.setMatrixAt(lIdx++, dummy.matrix);
    } else {
      darkTiles.setMatrixAt(dIdx++, dummy.matrix);
    }
  }
}
lightTiles.instanceMatrix.needsUpdate = true;
darkTiles.instanceMatrix.needsUpdate = true;
chessTable.add(lightTiles, darkTiles);

// Piece Geometries
const pBaseGeo = new THREE.CylinderGeometry(0.016, 0.018, 0.008, 16);
const pawnCone = new THREE.ConeGeometry(0.011, 0.03, 16);
const pawnBall = new THREE.SphereGeometry(0.009, 14, 10);
const tallCone = new THREE.ConeGeometry(0.012, 0.05, 16);
const rookBody = new THREE.CylinderGeometry(0.013, 0.016, 0.038, 16);

function createPiece(type, mat) {
  const grp = new THREE.Group();
  const b = new THREE.Mesh(pBaseGeo, mat);
  b.position.y = 0.004;
  grp.add(b);
  if (type === 'P') {
    const body = new THREE.Mesh(pawnCone, mat);
    body.position.y = 0.02;
    const head = new THREE.Mesh(pawnBall, mat);
    head.position.y = 0.038;
    grp.add(body, head);
  } else if (type === 'R') {
    const body = new THREE.Mesh(rookBody, mat);
    body.position.y = 0.024;
    grp.add(body);
  } else if (type === 'N') {
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.036, 0.022), mat);
    neck.position.set(0, 0.024, 0);
    grp.add(neck);
  } else if (type === 'B') {
    const body = new THREE.Mesh(tallCone, mat);
    body.position.y = 0.03;
    const mitre = new THREE.Mesh(pawnBall, mat);
    mitre.position.y = 0.052;
    grp.add(body, mitre);
  } else if (type === 'Q' || type === 'K') {
    const body = new THREE.Mesh(tallCone, mat);
    body.position.y = 0.035;
    const top = new THREE.Mesh(type === 'K' ? new THREE.BoxGeometry(0.008, 0.018, 0.008) : pawnBall, mat);
    top.position.y = 0.062;
    grp.add(body, top);
  }
  return grp;
}

const backRank = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
for (let c = 0; c < 8; c++) {
  const x = (c - 3.5) * 0.048;
  const wBack = createPiece(backRank[c], lightWood);
  wBack.position.set(x, 0.775, 3.5 * 0.048);
  const wPawn = createPiece('P', lightWood);
  wPawn.position.set(x, 0.775, 2.5 * 0.048);
  const bPawn = createPiece('P', darkWood);
  bPawn.position.set(x, 0.775, -2.5 * 0.048);
  const bBack = createPiece(backRank[c], darkWood);
  bBack.position.set(x, 0.775, -3.5 * 0.048);
  chessTable.add(wBack, wPawn, bPawn, bBack);
}

scene.add(chessTable);
chessTable.userData.xr = { grab: true };
function animate(dt) {
  chessTable.rotation.y += dt * 0.05;
}
