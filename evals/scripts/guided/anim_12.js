// anim_12: Interactive Sneaker Product Configurator
const configuratorScene = new THREE.Group();
configuratorScene.name = "SneakerConfiguratorScene";
scene.add(configuratorScene);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.name = "StudioKeyLight";
keyLight.position.set(1.5, 2.5, 2.0);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0x38bdf8, 1.4, 4.0);
rimLight.name = "PlinthRimLight";
rimLight.position.set(-1.0, 0.8, -1.0);
scene.add(rimLight);

// Display Pedestal Base grounded at y = 0 + Floating Display Plinth
const plinthDarkMat = new THREE.MeshPhysicalMaterial({
  color: 0x18181b,
  roughness: 0.2,
  metalness: 0.8,
  clearcoat: 0.7
});
const neonRingMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 1.4,
  roughness: 0.2
});

const floorShadowBase = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.30, 0.03, 36), plinthDarkMat);
floorShadowBase.name = "GroundPedestalBase";
floorShadowBase.position.set(0, 0.015, 0);
configuratorScene.add(floorShadowBase);

const floatingPlinth = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.22, 0.05, 36), plinthDarkMat);
floatingPlinth.name = "FloatingDisplayPlinth";
floatingPlinth.position.set(0, 0.09, 0);
configuratorScene.add(floatingPlinth);

const plinthGlowRing = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.012, 36), neonRingMat);
plinthGlowRing.name = "PlinthNeonRing";
plinthGlowRing.position.set(0, 0.09, 0);
configuratorScene.add(plinthGlowRing);

// Stylized Athletic Running Shoe (~0.35m long along X axis)
const sneakerGroup = new THREE.Group();
sneakerGroup.name = "SneakerAssembly";
sneakerGroup.position.set(0, 0.16, 0);
configuratorScene.add(sneakerGroup);

// Materials using MeshPhysicalMaterial
const soleMat = new THREE.MeshPhysicalMaterial({
  color: 0xf8fafc,
  roughness: 0.35,
  metalness: 0.05,
  clearcoat: 0.3
});
const upperMat = new THREE.MeshPhysicalMaterial({
  color: 0xef4444,
  roughness: 0.45,
  metalness: 0.1,
  sheen: 0.8,
  sheenColor: 0xfca5a5,
  sheenRoughness: 0.3
});
const swooshMat = new THREE.MeshPhysicalMaterial({
  color: 0xfacc15,
  roughness: 0.18,
  metalness: 0.75,
  clearcoat: 0.9
});
const tongueMat = new THREE.MeshPhysicalMaterial({
  color: 0x1e293b,
  roughness: 0.5,
  metalness: 0.1,
  sheen: 0.6
});
const lacesMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.4,
  metalness: 0.05
});

// 1. Named mesh: `sole` (Extruded sculpted midsole profile ~0.35m long)
const soleShape = new THREE.Shape();
soleShape.moveTo(-0.17, 0.0);
soleShape.lineTo(0.15, 0.0);
soleShape.quadraticCurveTo(0.18, 0.005, 0.175, 0.032);
soleShape.lineTo(0.04, 0.036);
soleShape.lineTo(-0.165, 0.048);
soleShape.quadraticCurveTo(-0.18, 0.025, -0.17, 0.0);

const soleGeo = new THREE.ExtrudeGeometry(soleShape, {
  depth: 0.125,
  bevelEnabled: true,
  bevelThickness: 0.008,
  bevelSize: 0.008,
  bevelSegments: 3
});
soleGeo.translate(0, 0, -0.0625);

const sole = new THREE.Mesh(soleGeo, soleMat);
sole.name = "sole";
sneakerGroup.add(sole);

// 2. Named mesh: `upper` (Athletic breathable body + heel counter)
const upperShape = new THREE.Shape();
upperShape.moveTo(-0.155, 0.04);
upperShape.lineTo(0.145, 0.03);
upperShape.quadraticCurveTo(0.16, 0.075, 0.08, 0.095);
upperShape.lineTo(-0.03, 0.135);
upperShape.lineTo(-0.06, 0.11);
upperShape.lineTo(-0.145, 0.125);
upperShape.quadraticCurveTo(-0.165, 0.085, -0.155, 0.04);

const upperGeo = new THREE.ExtrudeGeometry(upperShape, {
  depth: 0.11,
  bevelEnabled: true,
  bevelThickness: 0.007,
  bevelSize: 0.007,
  bevelSegments: 3
});
upperGeo.translate(0, 0, -0.055);

const upper = new THREE.Mesh(upperGeo, upperMat);
upper.name = "upper";
sneakerGroup.add(upper);

// 3. Named mesh: `tongue` (Angled padded mesh tongue)
const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.022, 0.078), tongueMat);
tongue.name = "tongue";
tongue.position.set(-0.005, 0.118, 0);
tongue.rotation.z = -0.45;
sneakerGroup.add(tongue);

// 4. Named mesh: `laces` (Crossed lace bar assembly)
const laces = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.095, 12), lacesMat);
laces.name = "laces";
laces.rotation.x = Math.PI / 2;
laces.position.set(0.025, 0.112, 0);
sneakerGroup.add(laces);

for (let l = 0; l < 3; l++) {
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.012, 0.105), lacesMat);
  strap.name = `LaceCrossStrap_${l + 1}`;
  strap.position.set(0.005 + l * 0.024, 0.118 - l * 0.01, 0);
  sneakerGroup.add(strap);
}

// 5. Named mesh: `swoosh` (Dynamic speed stripe emblem extruded along the side)
const swooshShape = new THREE.Shape();
swooshShape.moveTo(-0.12, 0.085);
swooshShape.quadraticCurveTo(-0.05, 0.048, 0.075, 0.068);
swooshShape.quadraticCurveTo(-0.03, 0.068, -0.095, 0.105);
swooshShape.closePath();

const swooshGeo = new THREE.ExtrudeGeometry(swooshShape, {
  depth: 0.126,
  bevelEnabled: true,
  bevelThickness: 0.003,
  bevelSize: 0.003,
  bevelSegments: 2
});
swooshGeo.translate(0, 0, -0.063);

const swoosh = new THREE.Mesh(swooshGeo, swooshMat);
swoosh.name = "swoosh";
sneakerGroup.add(swoosh);

// Attach canonical userData.interactivity `onSelect` actions to cycle colorway materials and bounce the shoe
const bounceAndCycleActions = (targetMeshName) => ({
  onSelect: [
    {
      action: "cycleMaterialColor",
      target: targetMeshName,
      duration: 0.4
    },
    {
      action: "interpolate",
      target: "SneakerAssembly",
      property: "translation",
      to: [0, 0.24, 0],
      duration: 0.5
    }
  ]
});

upper.userData.interactivity = bounceAndCycleActions("upper");
swoosh.userData.interactivity = bounceAndCycleActions("swoosh");
sole.userData.interactivity = bounceAndCycleActions("sole");
laces.userData.interactivity = bounceAndCycleActions("laces");
tongue.userData.interactivity = bounceAndCycleActions("tongue");
sneakerGroup.userData.interactivity = bounceAndCycleActions("upper");

function animate(t) {
  // Smooth floating bounce and slow turntable showcase rotation
  sneakerGroup.position.y = 0.16 + Math.sin(t * 2.4) * 0.022;
  sneakerGroup.rotation.y = t * 0.55;
  sneakerGroup.rotation.z = Math.sin(t * 2.4) * 0.06;
}

// Scene bounds: radius ~0.32m around centerY = 0.18m -> camera distance ~0.78m
camera.position.set(0.32, 0.36, 0.68);
camera.lookAt(0, 0.17, 0);
