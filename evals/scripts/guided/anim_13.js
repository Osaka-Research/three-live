// anim_13: Spiral Barred Galaxy of 3,000 Instanced Stars
const galaxyScene = new THREE.Group();
galaxyScene.name = "BarredSpiralGalaxyScene";
scene.add(galaxyScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const galacticKeyLight = new THREE.DirectionalLight(0xfff1dc, 1.1);
galacticKeyLight.name = "CosmicDirectionalLight";
galacticKeyLight.position.set(2.5, 4.0, 3.0);
scene.add(galacticKeyLight);

const corePointLight = new THREE.PointLight(0xffb74d, 2.8, 6.0);
corePointLight.name = "GalacticBulgePointLight";
corePointLight.position.set(0, 0.72, 0);
scene.add(corePointLight);

// Planetarium Display Base at y = 0
const baseMat = new THREE.MeshStandardMaterial({
  color: 0x111827,
  roughness: 0.4,
  metalness: 0.75
});
const displayBase = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.08, 36), baseMat);
displayBase.name = "PlanetariumPedestalBase";
displayBase.position.set(0, 0.04, 0);
galaxyScene.add(displayBase);

const supportStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.64, 16), baseMat);
supportStem.name = "PlanetariumSupportStem";
supportStem.position.set(0, 0.36, 0);
galaxyScene.add(supportStem);

// Rotating Galaxy Disc Group (~3.0m across -> radius 1.5m) centered at y = 0.72m
const galaxyDisk = new THREE.Group();
galaxyDisk.name = "BarredSpiralGalaxyDisk";
galaxyDisk.position.set(0, 0.72, 0);
galaxyDisk.rotation.x = 0.24;
galaxyScene.add(galaxyDisk);

// Warm Glowing Galactic Core & Central Stellar Bar
const coreMat = new THREE.MeshStandardMaterial({
  color: 0xffe082,
  emissive: 0xff9800,
  emissiveIntensity: 1.6,
  roughness: 0.2
});
const coreBulge = new THREE.Mesh(new THREE.SphereGeometry(0.18, 28, 20), coreMat);
coreBulge.name = "GalacticNucleusBulge";
coreBulge.scale.set(1.3, 0.55, 1.0);
galaxyDisk.add(coreBulge);

const barMat = new THREE.MeshStandardMaterial({
  color: 0xffcc80,
  emissive: 0xf57c00,
  emissiveIntensity: 1.1,
  roughness: 0.3,
  transparent: true,
  opacity: 0.9
});
const centralBar = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 16), barMat);
centralBar.name = "GalacticCentralBar";
centralBar.scale.set(1.0, 0.22, 0.28);
galaxyDisk.add(centralBar);

// Dark Dust Lanes along the bar and inner spiral arms
const dustMat = new THREE.MeshStandardMaterial({
  color: 0x1a1325,
  roughness: 0.95,
  metalness: 0.05
});
for (let d = 0; d < 4; d++) {
  const dustAngle = (d / 4) * Math.PI * 2 + 0.25;
  const dustLane = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), dustMat);
  dustLane.name = `DarkDustLane_${d + 1}`;
  dustLane.position.set(Math.cos(dustAngle) * 0.48, 0.0, Math.sin(dustAngle) * 0.48);
  dustLane.rotation.y = -dustAngle + 0.6;
  dustLane.scale.set(1.9, 0.12, 0.28);
  galaxyDisk.add(dustLane);
}

// 3,000 Instanced Stars along 4 Logarithmic Spiral Arms
const starCount = 3000;
const starGeo = new THREE.SphereGeometry(0.015, 7, 6);
const starMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0x334155,
  emissiveIntensity: 0.45,
  roughness: 0.2
});

const instancedStars = new THREE.InstancedMesh(starGeo, starMat, starCount);
instancedStars.name = "InstancedGalaxyStars";
galaxyDisk.add(instancedStars);

const dummyMatrix = new THREE.Matrix4();
const posVec = new THREE.Vector3();
const rotQuat = new THREE.Quaternion();
const scaleVec = new THREE.Vector3();
const starColor = new THREE.Color();

const hotBlueWhite = new THREE.Color(0x93c5fd);
const warmYellowWhite = new THREE.Color(0xfef08a);
const redGiantOrange = new THREE.Color(0xf97316);

for (let i = 0; i < starCount; i++) {
  const s1 = Math.sin(i * 12.9898 + 0.5) * 43758.5453;
  const r1 = s1 - Math.floor(s1);
  const s2 = Math.sin(i * 78.233 + 1.7) * 43758.5453;
  const r2 = s2 - Math.floor(s2);
  const s3 = Math.sin(i * 45.164 + 3.1) * 43758.5453;
  const r3 = s3 - Math.floor(s3);

  const armIndex = i % 4;
  const armBaseAngle = (armIndex / 4) * Math.PI * 2;

  // Radial distance from 0.18m out to 1.48m (~3.0m total diameter)
  const u = Math.pow(r1, 0.85);
  const radius = 0.18 + u * 1.30;

  // Logarithmic spiral winding angle + scatter
  const spiralTwist = 2.85 * Math.log(radius / 0.18 + 0.35);
  const scatterAngle = (r2 - 0.5) * (0.38 + (1.0 - u) * 0.25);
  const theta = armBaseAngle + spiralTwist + scatterAngle;

  const x = Math.cos(theta) * radius;
  const z = Math.sin(theta) * radius;
  const diskThickness = 0.14 * Math.exp(-radius * 1.4);
  const y = (r3 - 0.5) * diskThickness;

  const starScale = 0.55 + r2 * 1.25;
  posVec.set(x, y, z);
  scaleVec.set(starScale, starScale, starScale);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  instancedStars.setMatrixAt(i, dummyMatrix);

  // Color gradient: warm orange/gold near core & red giants, hot blue-white in outer spiral arms
  if (r3 > 0.78 || u < 0.25) {
    starColor.copy(redGiantOrange).lerp(warmYellowWhite, r2);
  } else if (u > 0.55) {
    starColor.copy(hotBlueWhite).lerp(warmYellowWhite, r1 * 0.4);
  } else {
    starColor.copy(warmYellowWhite).lerp(hotBlueWhite, (u - 0.25) / 0.3);
  }
  instancedStars.setColorAt(i, starColor);
}

instancedStars.instanceMatrix.needsUpdate = true;
if (instancedStars.instanceColor) {
  instancedStars.instanceColor.needsUpdate = true;
}

function animate(t) {
  galaxyDisk.rotation.y = t * 0.22;
}

// Scene bounds: 3.0m across (radius 1.5m), height ~1.2m -> camera distance ~3.6m
camera.position.set(0.0, 2.35, 3.1);
camera.lookAt(0, 0.68, 0);
