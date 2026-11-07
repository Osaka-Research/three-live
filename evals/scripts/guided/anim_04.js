// anim_04: Newton's Cradle Executive Desk Toy
const cradleGroup = new THREE.Group();
cradleGroup.name = "NewtonsCradleAssembly";
scene.add(cradleGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.8);
keyLight.name = "StudioKeyLight";
keyLight.position.set(2.0, 3.0, 2.5);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xdbeafe, 1.1, 6.0);
rimLight.name = "ChromeRimLight";
rimLight.position.set(-1.5, 1.6, -1.5);
scene.add(rimLight);

// Materials
const mahoganyMat = new THREE.MeshPhysicalMaterial({
  color: 0x4a1c11,
  roughness: 0.25,
  metalness: 0.05,
  clearcoat: 0.85,
  clearcoatRoughness: 0.15
});

const chromeRailMat = new THREE.MeshPhysicalMaterial({
  color: 0xe4e4e7,
  roughness: 0.12,
  metalness: 0.96,
  clearcoat: 0.5
});

const steelBallMat = new THREE.MeshPhysicalMaterial({
  color: 0xf4f4f5,
  roughness: 0.06,
  metalness: 0.98,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04
});

const stringMat = new THREE.MeshStandardMaterial({
  color: 0x52525b,
  roughness: 0.5,
  metalness: 0.6
});

// Mahogany Base resting at y = 0
const basePlinth = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.06, 0.42), mahoganyMat);
basePlinth.name = "MahoganyBasePlinth";
basePlinth.position.set(0, 0.04, 0);
cradleGroup.add(basePlinth);

const baseBevel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.02, 0.36), mahoganyMat);
baseBevel.name = "MahoganyTopBevel";
baseBevel.position.set(0, 0.08, 0);
cradleGroup.add(baseBevel);

// Four Corner Rubber Feet touching y = 0
const footGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.015, 16);
const footMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 });
const footCoords = [
  [-0.29, -0.16],
  [0.29, -0.16],
  [-0.29, 0.16],
  [0.29, 0.16]
];
for (let i = 0; i < footCoords.length; i++) {
  const [fx, fz] = footCoords[i];
  const foot = new THREE.Mesh(footGeo, footMat);
  foot.name = `BaseFoot_${i + 1}`;
  foot.position.set(fx, 0.0075, fz);
  cradleGroup.add(foot);
}

// Twin Parallel Chrome Arch Rails (Front and Back at z = +/- 0.13)
const railHeight = 0.46;
const railSpanX = 0.54;
const railZOffsets = [-0.13, 0.13];

for (let r = 0; r < railZOffsets.length; r++) {
  const rz = railZOffsets[r];
  const sideLabel = r === 0 ? "Back" : "Front";

  // Left and Right Vertical Posts
  const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, railHeight, 16), chromeRailMat);
  leftPost.name = `${sideLabel}LeftPost`;
  leftPost.position.set(-railSpanX * 0.5, 0.08 + railHeight * 0.5, rz);
  cradleGroup.add(leftPost);

  const rightPost = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, railHeight, 16), chromeRailMat);
  rightPost.name = `${sideLabel}RightPost`;
  rightPost.position.set(railSpanX * 0.5, 0.08 + railHeight * 0.5, rz);
  cradleGroup.add(rightPost);

  // Horizontal Top Bar
  const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, railSpanX + 0.024, 16), chromeRailMat);
  topBar.name = `${sideLabel}TopBar`;
  topBar.rotation.z = Math.PI / 2;
  topBar.position.set(0, 0.08 + railHeight, rz);
  cradleGroup.add(topBar);
}

// 5 Polished Steel Spheres suspended by V-strings from y = 0.54
const ballRadius = 0.042;
const ballSpacing = ballRadius * 2.02;
const pivotY = 0.08 + railHeight; // 0.54
const stringDrop = 0.28;
const stringLen = Math.sqrt(stringDrop * stringDrop + 0.13 * 0.13);
const stringTiltX = Math.atan2(0.13, stringDrop);

const pendulumPivots = [];

for (let i = 0; i < 5; i++) {
  const pivotX = (i - 2) * ballSpacing;
  const pivotGroup = new THREE.Group();
  pivotGroup.name = `PendulumPivot_${i + 1}`;
  pivotGroup.position.set(pivotX, pivotY, 0);
  cradleGroup.add(pivotGroup);

  // Front and Back V-strings
  const backString = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, stringLen, 8), stringMat);
  backString.name = `BackVString_${i + 1}`;
  backString.position.set(0, -stringDrop * 0.5, -0.065);
  backString.rotation.x = -stringTiltX;
  pivotGroup.add(backString);

  const frontString = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, stringLen, 8), stringMat);
  frontString.name = `FrontVString_${i + 1}`;
  frontString.position.set(0, -stringDrop * 0.5, 0.065);
  frontString.rotation.x = stringTiltX;
  pivotGroup.add(frontString);

  // Small Eyelet Ring on top of sphere
  const eyelet = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.012, 12), chromeRailMat);
  eyelet.name = `SphereEyelet_${i + 1}`;
  eyelet.position.set(0, -stringDrop, 0);
  pivotGroup.add(eyelet);

  // Polished Steel Sphere
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(ballRadius, 32, 24), steelBallMat);
  sphere.name = `SteelSphere_${i + 1}`;
  sphere.position.set(0, -stringDrop - ballRadius, 0);
  pivotGroup.add(sphere);

  pendulumPivots.push(pivotGroup);
}

// Initial Pose (left sphere lifted)
pendulumPivots[0].rotation.z = -0.58;

function animate(t) {
  const phase = t * 3.6;
  const s = Math.sin(phase);
  const maxAngle = 0.58;

  // Left outer ball swings when sin(phase) < 0, right outer ball swings when sin(phase) > 0
  pendulumPivots[0].rotation.z = s < 0 ? s * maxAngle : 0;
  pendulumPivots[4].rotation.z = s > 0 ? s * maxAngle : 0;

  // Subtle impulse vibration on middle spheres at impact
  const impulse = Math.exp(-Math.abs(s) * 18.0) * Math.cos(phase * 4.0) * 0.006;
  pendulumPivots[1].rotation.z = impulse;
  pendulumPivots[2].rotation.z = impulse * 0.5;
  pendulumPivots[3].rotation.z = -impulse;
}

// Scene bounds: width 0.68m, height 0.56m, depth 0.42m -> radius ~0.48m, centerY = 0.28m
camera.position.set(0.55, 0.52, 0.98);
camera.lookAt(0, 0.28, 0);
