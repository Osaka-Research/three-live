// anim_01: Instanced Asteroid Belt Around Ringed Gas Giant
const rootGroup = new THREE.Group();
rootGroup.name = "GasGiantSystem";
scene.add(rootGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff4d6, 1.8);
sunLight.name = "SunDirectionalLight";
sunLight.position.set(5.0, 4.0, 4.0);
scene.add(sunLight);

const coreGlow = new THREE.PointLight(0xffb86c, 1.2, 8.0);
coreGlow.name = "PlanetBounceLight";
coreGlow.position.set(0, 1.4, 0);
scene.add(coreGlow);

// Observatory display plinth grounding the scene at y = 0
const plinthMat = new THREE.MeshStandardMaterial({
  color: 0x1e2430,
  roughness: 0.4,
  metalness: 0.7
});
const plinthBase = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.78, 0.14, 32), plinthMat);
plinthBase.name = "ObservatoryPlinthBase";
plinthBase.position.set(0, 0.07, 0);
rootGroup.add(plinthBase);

const plinthPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 1.15, 20), plinthMat);
plinthPillar.name = "ObservatoryPillar";
plinthPillar.position.set(0, 0.64, 0);
rootGroup.add(plinthPillar);

// Ringed Gas Giant centered at y = 1.35
const planetCenterY = 1.35;
const planetGroup = new THREE.Group();
planetGroup.name = "GasGiantGroup";
planetGroup.position.set(0, planetCenterY, 0);
planetGroup.rotation.z = 0.18;
rootGroup.add(planetGroup);

// Procedural banded gas giant texture
const texW = 64;
const texH = 64;
const texData = new Uint8Array(texW * texH * 4);
for (let y = 0; y < texH; y++) {
  const v = y / texH;
  const band = Math.sin(v * Math.PI * 14) * 0.5 + 0.5;
  const storm = Math.cos(v * Math.PI * 6) * 0.5 + 0.5;
  for (let x = 0; x < texW; x++) {
    const idx = (y * texW + x) * 4;
    texData[idx] = Math.round(185 + band * 50 - storm * 20);
    texData[idx + 1] = Math.round(135 + band * 40 - storm * 25);
    texData[idx + 2] = Math.round(90 + band * 30);
    texData[idx + 3] = 255;
  }
}
const planetTexture = new THREE.DataTexture(texData, texW, texH, THREE.RGBAFormat);
planetTexture.needsUpdate = true;

const planetMat = new THREE.MeshStandardMaterial({
  color: 0xe6b88a,
  map: planetTexture,
  roughness: 0.65,
  metalness: 0.05
});
const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 24), planetMat);
planetMesh.name = "GasGiantSphere";
planetGroup.add(planetMesh);

// Atmospheric cloud bands (subtle concentric torus rings on planet surface)
const bandMat = new THREE.MeshStandardMaterial({
  color: 0xd48b54,
  roughness: 0.5,
  metalness: 0.1
});
const eqBand = new THREE.Mesh(new THREE.TorusGeometry(0.415, 0.015, 12, 48), bandMat);
eqBand.name = "EquatorialCloudBand";
eqBand.rotation.x = Math.PI / 2;
planetGroup.add(eqBand);

// Concentric Planetary Rings using TorusGeometry
const innerRingMat = new THREE.MeshStandardMaterial({
  color: 0xcbb692,
  roughness: 0.45,
  metalness: 0.2,
  transparent: true,
  opacity: 0.85
});
const innerRing = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.045, 12, 64), innerRingMat);
innerRing.name = "InnerPlanetaryRing";
innerRing.rotation.x = Math.PI / 2;
innerRing.scale.set(1, 1, 0.18);
planetGroup.add(innerRing);

const outerRingMat = new THREE.MeshStandardMaterial({
  color: 0xa89274,
  roughness: 0.55,
  metalness: 0.15,
  transparent: true,
  opacity: 0.72
});
const outerRing = new THREE.Mesh(new THREE.TorusGeometry(0.79, 0.055, 12, 64), outerRingMat);
outerRing.name = "OuterPlanetaryRing";
outerRing.rotation.x = Math.PI / 2;
outerRing.scale.set(1, 1, 0.15);
planetGroup.add(outerRing);

// Dense Asteroid Belt of 1,500 rocks rendered with THREE.InstancedMesh
const asteroidCount = 1500;
const asteroidGeo = new THREE.SphereGeometry(0.022, 8, 6);
const asteroidMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.85,
  metalness: 0.25
});

const beltGroup = new THREE.Group();
beltGroup.name = "AsteroidBeltContainer";
beltGroup.position.set(0, planetCenterY, 0);
beltGroup.rotation.z = 0.18;
rootGroup.add(beltGroup);

const asteroidInstanced = new THREE.InstancedMesh(asteroidGeo, asteroidMat, asteroidCount);
asteroidInstanced.name = "AsteroidBeltInstancedMesh";
beltGroup.add(asteroidInstanced);

const dummyMatrix = new THREE.Matrix4();
const posVec = new THREE.Vector3();
const rotQuat = new THREE.Quaternion();
const euler = new THREE.Euler();
const scaleVec = new THREE.Vector3();
const instanceColor = new THREE.Color();

const orbitalData = [];

for (let i = 0; i < asteroidCount; i++) {
  // Deterministic pseudo-random values per instance
  const s1 = Math.sin(i * 12.9898 + 1.23) * 43758.5453;
  const r1 = s1 - Math.floor(s1);
  const s2 = Math.sin(i * 78.233 + 4.56) * 43758.5453;
  const r2 = s2 - Math.floor(s2);
  const s3 = Math.sin(i * 39.425 + 7.89) * 43758.5453;
  const r3 = s3 - Math.floor(s3);
  const s4 = Math.sin(i * 93.172 + 2.45) * 43758.5453;
  const r4 = s4 - Math.floor(s4);

  const radius = 1.02 + r1 * 0.62;
  const angle = (i / asteroidCount) * Math.PI * 2 + r2 * 0.4;
  const heightOffset = (r3 - 0.5) * 0.16 * (1.0 - 0.3 * r1);

  const sx = 0.45 + r2 * 1.15;
  const sy = 0.35 + r3 * 0.95;
  const sz = 0.45 + r4 * 1.1;

  const rx = r1 * Math.PI * 2;
  const ry = r2 * Math.PI * 2;
  const rz = r3 * Math.PI * 2;

  orbitalData.push({
    radius: radius,
    angle: angle,
    heightOffset: heightOffset,
    speed: 0.25 / Math.sqrt(radius),
    rx: rx,
    ry: ry,
    rz: rz,
    sx: sx,
    sy: sy,
    sz: sz
  });

  posVec.set(
    Math.cos(angle) * radius,
    heightOffset,
    Math.sin(angle) * radius
  );
  euler.set(rx, ry, rz);
  rotQuat.setFromEuler(euler);
  scaleVec.set(sx, sy, sz);
  dummyMatrix.compose(posVec, rotQuat, scaleVec);
  asteroidInstanced.setMatrixAt(i, dummyMatrix);

  // Per-instance silicate, carbonaceous, and metallic tint
  const shade = 0.38 + r4 * 0.45;
  const warmTint = r1 * 0.14;
  instanceColor.setRGB(shade + warmTint, shade + warmTint * 0.5, shade - warmTint * 0.3);
  asteroidInstanced.setColorAt(i, instanceColor);
}

asteroidInstanced.instanceMatrix.needsUpdate = true;
if (asteroidInstanced.instanceColor) {
  asteroidInstanced.instanceColor.needsUpdate = true;
}

function animate(t) {
  planetMesh.rotation.y = t * 0.22;
  beltGroup.rotation.y = t * 0.18;

  for (let i = 0; i < asteroidCount; i++) {
    const d = orbitalData[i];
    const currentAngle = d.angle + t * d.speed;
    posVec.set(
      Math.cos(currentAngle) * d.radius,
      d.heightOffset + Math.sin(t * 0.8 + i) * 0.008,
      Math.sin(currentAngle) * d.radius
    );
    euler.set(d.rx + t * 0.4, d.ry + t * 0.3, d.rz);
    rotQuat.setFromEuler(euler);
    scaleVec.set(d.sx, d.sy, d.sz);
    dummyMatrix.compose(posVec, rotQuat, scaleVec);
    asteroidInstanced.setMatrixAt(i, dummyMatrix);
  }
  asteroidInstanced.instanceMatrix.needsUpdate = true;
}

// Bounding radius is ~1.7m around (0, 1.15, 0) -> camera distance ~4.0m
camera.position.set(0.0, 2.5, 3.8);
camera.lookAt(0, 1.15, 0);
