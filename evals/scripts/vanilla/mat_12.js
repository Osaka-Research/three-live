// Laboratory Retort Stand with Burette, Erlenmeyer, and Solution Flasks
const ambLight = new THREE.AmbientLight(0xf0f4f8, 0.7);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 2);
const ptLight = new THREE.PointLight(0xddf0ff, 0.8, 5);
ptLight.position.set(-0.5, 1.5, 0.8);
scene.add(ambLight, dirLight, ptLight);

// Glass & Liquid Transmissive Materials
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.94,
  opacity: 1,
  transparent: true,
  roughness: 0.05,
  ior: 1.52,
  thickness: 0.02
});

const makeLiquidMat = (col) => new THREE.MeshPhysicalMaterial({
  color: col,
  transmission: 0.86,
  transparent: true,
  roughness: 0.08,
  ior: 1.33,
  thickness: 0.04
});

const magentaMat = makeLiquidMat(0xff007f);
const emeraldMat = makeLiquidMat(0x00c853);
const cobaltMat = makeLiquidMat(0x0047ab);
const metalMat = new THREE.MeshStandardMaterial({ color: 0x33373b, metalness: 0.8, roughness: 0.3 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });

const labGroup = new THREE.Group();

// Retort Stand
const standBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.12), metalMat);
standBase.position.set(-0.2, 0.51, 0);
const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.65, 16), metalMat);
rod.position.set(-0.26, 0.83, 0);
const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.015, 0.02), metalMat);
clamp.position.set(-0.22, 0.95, 0);
labGroup.add(standBase, rod, clamp);

// Graduated Burette
const burette = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.35, 16), glassMat);
burette.position.set(-0.18, 0.92, 0);
const buretteFluid = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.22, 16), cobaltMat);
buretteFluid.position.set(-0.18, 0.88, 0);
labGroup.add(burette, buretteFluid);

// Erlenmeyer Flask
const erlenBody = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.09, 24, 1, true), glassMat);
erlenBody.position.set(-0.18, 0.56, 0);
const erlenNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.04, 20), glassMat);
erlenNeck.position.set(-0.18, 0.62, 0);
const erlenLiquid = new THREE.Mesh(new THREE.ConeGeometry(0.042, 0.045, 20), magentaMat);
erlenLiquid.position.set(-0.18, 0.54, 0);
labGroup.add(erlenBody, erlenNeck, erlenLiquid);

// Three Florence Flasks
const flaskColors = [cobaltMat, emeraldMat, magentaMat];
flaskColors.forEach((liqMat, i) => {
  const fx = 0.0 + i * 0.09;
  const fGroup = new THREE.Group();
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 24, 24), glassMat);
  bulb.position.set(fx, 0.545, -0.05);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 16), glassMat);
  neck.position.set(fx, 0.585, -0.05);
  const liq = new THREE.Mesh(new THREE.SphereGeometry(0.03, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.7), liqMat);
  liq.rotation.x = Math.PI;
  liq.position.set(fx, 0.54, -0.05);
  fGroup.add(bulb, neck, liq);
  labGroup.add(fGroup);
});

// Test Tube Rack with Tubes
const rack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.04), woodMat);
rack.position.set(0.12, 0.54, 0.12);
labGroup.add(rack);

const tubeColors = [emeraldMat, magentaMat, cobaltMat];
for (let j = 0; j < 3; j++) {
  const tx = 0.07 + j * 0.05;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.1, 16), glassMat);
  tube.position.set(tx, 0.58, 0.12);
  const fluid = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.06, 16), tubeColors[j]);
  fluid.position.set(tx, 0.56, 0.12);
  labGroup.add(tube, fluid);
}

labGroup.position.set(0, 0.2, 0);
scene.add(labGroup);
