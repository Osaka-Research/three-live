const ambientLight = new THREE.AmbientLight(0xffeedd, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.1);
dirLight.position.set(1.5, 3.5, 2);
scene.add(ambientLight, dirLight);

const booth = new THREE.Group();
booth.position.set(0, 0, 0);

// Carnival booth table (static physics)
const tableTop = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.06, 0.7),
  new THREE.MeshStandardMaterial({ color: 0x963229, roughness: 0.6 })
);
tableTop.position.set(0, 0.77, 0);
for (const x of [-0.52, 0.52]) {
  for (const z of [-0.28, 0.28]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.74, 16),
      new THREE.MeshStandardMaterial({ color: 0xd8c29d, roughness: 0.5 })
    );
    leg.position.set(x, 0.37, z);
    booth.add(leg);
  }
}
booth.add(tableTop);
booth.userData.xr = { physics: 'static' };

// 4-tier pyramid of 10 tin cans
const canGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.09, 20);
const canMat = new THREE.MeshStandardMaterial({ color: 0xccd4db, metalness: 0.85, roughness: 0.25 });
const canPyramid = new THREE.Group();
canPyramid.position.set(0, 0.8, -0.05);

const canDiameter = 0.076;
const canHeight = 0.09;
const rows = 4;
for (let row = 0; row < rows; row++) {
  const count = rows - row; // Tier 0: 4, Tier 1: 3, Tier 2: 2, Tier 3: 1 (Total = 10)
  const y = row * canHeight + canHeight / 2;
  const startX = -((count - 1) * canDiameter) / 2;
  for (let i = 0; i < count; i++) {
    const can = new THREE.Mesh(canGeo, canMat);
    can.position.set(startX + i * canDiameter, y, 0);
    can.userData.xr = {
      physics: { body: 'dynamic', shape: 'cylinder', mass: 0.3, restitution: 0.4 },
      integrity: { max: 10, scoreValue: 10 }
    };
    canPyramid.add(can);
  }
}
booth.add(canPyramid);

// 3 Grabbable baseballs
const ballGeo = new THREE.SphereGeometry(0.037, 24, 24);
const ballMat = new THREE.MeshStandardMaterial({ color: 0xf5f3ea, roughness: 0.65 });
const ballPositions = [[-0.28, 0.837, 0.2], [-0.05, 0.837, 0.22], [0.22, 0.837, 0.18]];
for (let i = 0; i < 3; i++) {
  const ball = new THREE.Mesh(ballGeo, ballMat);
  ball.position.set(...ballPositions[i]);
  ball.userData.xr = {
    grab: '1-hand',
    physics: { body: 'dynamic', shape: 'sphere', restitution: 0.7 }
  };
  booth.add(ball);
}

scene.add(booth);
