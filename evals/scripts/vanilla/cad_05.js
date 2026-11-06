const staircase = new THREE.Group();

// Materials
const steelMat = new THREE.MeshStandardMaterial({ color: 0x9ba2a8, metalness: 0.9, roughness: 0.25 });
const oakMat = new THREE.MeshStandardMaterial({ color: 0x966838, roughness: 0.55, metalness: 0.05 });
const railMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.8, roughness: 0.3 });

// Central Steel Column (3.0m tall, 0.16m diameter)
const columnGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.1, 32);
const column = new THREE.Mesh(columnGeo, steelMat);
column.position.y = 1.55;
staircase.add(column);

// 16 Cantilevered Oak Treads with Vertical Balusters
const numTreads = 16;
const totalHeight = 3.0;
const totalAngle = Math.PI * 1.8;
const treadLength = 0.72;
const treadWidth = 0.26;
const treadThickness = 0.045;
const handrailRadius = 0.74;

const handrailPoints = [];

for (let i = 0; i < numTreads; i++) {
  const fraction = i / (numTreads - 1);
  const angle = fraction * totalAngle;
  const treadY = fraction * (totalHeight - 0.2) + 0.1;

  // Cantilevered Tread
  const treadGeo = new THREE.BoxGeometry(treadLength, treadThickness, treadWidth);
  const tread = new THREE.Mesh(treadGeo, oakMat);
  tread.position.set(
    Math.cos(angle) * (treadLength / 2 + 0.06),
    treadY,
    Math.sin(angle) * (treadLength / 2 + 0.06)
  );
  tread.rotation.y = -angle;
  staircase.add(tread);

  // Outer Edge Vertical Baluster
  const outerX = Math.cos(angle) * handrailRadius;
  const outerZ = Math.sin(angle) * handrailRadius;
  const balusterHeight = 0.95;

  const balusterGeo = new THREE.CylinderGeometry(0.01, 0.01, balusterHeight, 12);
  const baluster = new THREE.Mesh(balusterGeo, steelMat);
  baluster.position.set(outerX, treadY + balusterHeight / 2, outerZ);
  staircase.add(baluster);

  // Sample point for continuous helical handrail curve
  handrailPoints.push(new THREE.Vector3(outerX, treadY + balusterHeight, outerZ));
}

// Continuous Helical Handrail using CatmullRomCurve3 & TubeGeometry
const helixCurve = new THREE.CatmullRomCurve3(handrailPoints);
const handrailGeo = new THREE.TubeGeometry(helixCurve, 64, 0.024, 16, false);
const handrail = new THREE.Mesh(handrailGeo, railMat);
staircase.add(handrail);

// Base Floor Mounting Flange
const baseFlangeGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.03, 32);
const baseFlange = new THREE.Mesh(baseFlangeGeo, steelMat);
baseFlange.position.y = 0.015;
staircase.add(baseFlange);

// Placement & Lighting
staircase.position.set(0, 0, 0);
scene.add(staircase);

const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.4);
dirLight.position.set(3, 4, 3);
scene.add(ambLight, dirLight);
