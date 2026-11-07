const scene = new THREE.Scene();

// Warm sunset directional & ambient lighting
const ambientLight = new THREE.AmbientLight(0xffd2a6, 0.55);
ambientLight.name = 'SunsetAmbientLight';
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xff9e44, 2.2);
sunLight.name = 'SunsetDirectionalLight';
sunLight.position.set(-4.0, 3.2, -3.5);
scene.add(sunLight);

const fillLight = new THREE.PointLight(0xffbb77, 0.9, 8.0);
fillLight.name = 'WarmHorizonFillLight';
fillLight.position.set(2.5, 1.8, 2.0);
scene.add(fillLight);

const fieldGroup = new THREE.Group();
fieldGroup.name = 'WheatFieldRootGroup';
scene.add(fieldGroup);

// Pastoral hillside ground patch (~3.0m wide)
const groundGeo = new THREE.PlaneGeometry(3.2, 3.2, 24, 24);
groundGeo.rotateX(-Math.PI / 2);
const posAttr = groundGeo.attributes.position;
for (let i = 0; i < posAttr.count; i++) {
  const x = posAttr.getX(i);
  const z = posAttr.getZ(i);
  const hillY = 0.14 * Math.sin(x * 0.9 + 0.4) * Math.cos(z * 0.8 - 0.2) + 0.08 * (1.6 - Math.hypot(x, z) * 0.4);
  posAttr.setY(i, Math.max(0, hillY));
}
groundGeo.computeVertexNormals();

const groundMat = new THREE.MeshStandardMaterial({
  color: 0x6e5831,
  roughness: 0.92,
  metalness: 0.04
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.name = 'HillsideSoilPatch';
fieldGroup.add(groundMesh);

function getHillHeight(x, z) {
  const hillY = 0.14 * Math.sin(x * 0.9 + 0.4) * Math.cos(z * 0.8 - 0.2) + 0.08 * (1.6 - Math.hypot(x, z) * 0.4);
  return Math.max(0, hillY);
}

// Rustic wooden fence along the back edge
const fenceGroup = new THREE.Group();
fenceGroup.name = 'RusticWoodenFenceGroup';
fieldGroup.add(fenceGroup);

const woodMat = new THREE.MeshStandardMaterial({
  color: 0x5c4028,
  roughness: 0.88,
  metalness: 0.05
});

const postGeo = new THREE.CylinderGeometry(0.045, 0.05, 0.72, 10);
const postCapGeo = new THREE.ConeGeometry(0.052, 0.07, 10);
const postCount = 5;
for (let i = 0; i < postCount; i++) {
  const px = -1.36 + i * 0.68;
  const pz = -1.35;
  const py = getHillHeight(px, pz);

  const postMesh = new THREE.Mesh(postGeo, woodMat);
  postMesh.name = `FencePost_${i + 1}`;
  postMesh.position.set(px, py + 0.36, pz);
  postMesh.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.025;
  fenceGroup.add(postMesh);

  const capMesh = new THREE.Mesh(postCapGeo, woodMat);
  capMesh.name = `FencePostCap_${i + 1}`;
  capMesh.position.set(px, py + 0.75, pz);
  fenceGroup.add(capMesh);
}

const railGeo = new THREE.BoxGeometry(2.85, 0.055, 0.03);
const topRail = new THREE.Mesh(railGeo, woodMat);
topRail.name = 'FenceTopRail';
topRail.position.set(0, getHillHeight(0, -1.35) + 0.56, -1.31);
fenceGroup.add(topRail);

const bottomRail = new THREE.Mesh(railGeo, woodMat);
bottomRail.name = 'FenceBottomRail';
bottomRail.position.set(0, getHillHeight(0, -1.35) + 0.28, -1.31);
fenceGroup.add(bottomRail);

// 1,200 golden wheat stalks via THREE.InstancedMesh (culm stem + golden ear head)
const STALK_COUNT = 1200;
const stalkGeo = new THREE.CylinderGeometry(0.0045, 0.008, 0.58, 6);
stalkGeo.translate(0, 0.29, 0);

const stalkMat = new THREE.MeshStandardMaterial({
  color: 0xe6b84c,
  roughness: 0.62,
  metalness: 0.08
});

const wheatStalks = new THREE.InstancedMesh(stalkGeo, stalkMat, STALK_COUNT);
wheatStalks.name = 'GoldenWheatStalksInstanced';
fieldGroup.add(wheatStalks);

const earGeo = new THREE.CylinderGeometry(0.011, 0.014, 0.14, 6);
earGeo.translate(0, 0.56, 0);
const earMat = new THREE.MeshStandardMaterial({
  color: 0xf4c95d,
  roughness: 0.55,
  metalness: 0.10,
  emissive: 0x3a2204,
  emissiveIntensity: 0.2
});

const wheatEars = new THREE.InstancedMesh(earGeo, earMat, STALK_COUNT);
wheatEars.name = 'GoldenWheatEarsInstanced';
fieldGroup.add(wheatEars);

const stalkData = [];
const dummyMatrix = new THREE.Matrix4();
const dummyPos = new THREE.Vector3();
const dummyQuat = new THREE.Quaternion();
const dummyEuler = new THREE.Euler();
const dummyScale = new THREE.Vector3();
const stalkColor = new THREE.Color();

const gridCols = 40;
const gridRows = 30;
for (let i = 0; i < STALK_COUNT; i++) {
  const col = i % gridCols;
  const row = Math.floor(i / gridCols);
  const jitterX = ((i * 73) % 100) / 100 - 0.5;
  const jitterZ = ((i * 37) % 100) / 100 - 0.5;

  const x = -1.42 + (col / (gridCols - 1)) * 2.84 + jitterX * 0.055;
  const z = -1.18 + (row / (gridRows - 1)) * 2.52 + jitterZ * 0.055;
  const y = getHillHeight(x, z);

  const scaleY = 0.82 + ((i * 19) % 40) / 100;
  const scaleXZ = 0.9 + ((i * 29) % 25) / 100;
  const phase = x * 1.6 + z * 1.1 + ((i * 13) % 10) * 0.08;

  stalkData.push({ x, y, z, scaleY, scaleXZ, phase });

  const hueShift = ((i * 41) % 20 - 10) * 0.003;
  stalkColor.setHSL(0.115 + hueShift, 0.78, 0.56 + hueShift * 1.5);
  wheatStalks.setColorAt(i, stalkColor);
  wheatEars.setColorAt(i, stalkColor);
}

function updateWindField(timeSeconds) {
  for (let i = 0; i < STALK_COUNT; i++) {
    const d = stalkData[i];
    const gust = Math.sin(timeSeconds * 2.4 - d.phase) * 0.24 + Math.cos(timeSeconds * 1.3 - d.phase * 0.7) * 0.10;
    const tiltZ = -0.22 - Math.max(-0.08, gust);
    const tiltX = 0.09 * Math.sin(timeSeconds * 1.8 + d.phase * 0.8);

    dummyPos.set(d.x, d.y, d.z);
    dummyEuler.set(tiltX, 0, tiltZ);
    dummyQuat.setFromEuler(dummyEuler);
    dummyScale.set(d.scaleXZ, d.scaleY, d.scaleXZ);
    dummyMatrix.compose(dummyPos, dummyQuat, dummyScale);

    wheatStalks.setMatrixAt(i, dummyMatrix);
    wheatEars.setMatrixAt(i, dummyMatrix);
  }
  wheatStalks.instanceMatrix.needsUpdate = true;
  wheatEars.instanceMatrix.needsUpdate = true;
}

updateWindField(0);

function animate(t) {
  updateWindField(t);
}
