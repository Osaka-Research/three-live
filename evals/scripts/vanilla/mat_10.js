const alembicGroup = new THREE.Group();
alembicGroup.position.set(0, 0.7, 0);

// Lighting
const keyLight = new THREE.DirectionalLight(0xfff3e0, 2.0);
keyLight.position.set(2, 3, 2);
const fillLight = new THREE.PointLight(0x88ccff, 1.2, 4);
fillLight.position.set(-1.5, 1.5, 1);
const ambLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(alembicGroup, keyLight, fillLight, ambLight);

// Materials
const copperMat = new THREE.MeshStandardMaterial({
  color: 0xb85b30,
  metalness: 0.85,
  roughness: 0.35
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.92,
  opacity: 1,
  transparent: true,
  roughness: 0.08,
  ior: 1.52,
  thickness: 0.04
});
const distillateMat = new THREE.MeshPhysicalMaterial({
  color: 0x1be5b8,
  transmission: 0.8,
  opacity: 1,
  transparent: true,
  roughness: 0.1,
  ior: 1.34
});
const oakMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.65 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8963e, metalness: 0.8, roughness: 0.3 });

// Oak workbench base
const bench = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 32), oakMat);
bench.position.y = -0.03;
alembicGroup.add(bench);

// 1. Hammered Copper Cucurbit Boiler
const boiler = new THREE.Group();
boiler.position.set(-0.42, 0, 0);
const boilerBulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 24), copperMat);
boilerBulb.position.y = 0.18;
boiler.add(boilerBulb);

const boilerNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.14, 20), copperMat);
boilerNeck.position.y = 0.38;
boiler.add(boilerNeck);

const swanNeck = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.024, 16, 32, Math.PI * 0.75), copperMat);
swanNeck.position.set(0.08, 0.44, 0);
swanNeck.rotation.z = -Math.PI * 0.35;
boiler.add(swanNeck);
alembicGroup.add(boiler);

// 2. Graham Condenser
const condenser = new THREE.Group();
condenser.position.set(0.05, 0.28, 0);
condenser.rotation.z = -Math.PI * 0.12;

const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.46, 24), glassMat);
condenser.add(jacket);

[-0.2, 0.2].forEach((y) => {
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 20), brassMat);
  cap.position.y = y;
  condenser.add(cap);
});

for (let i = -4; i <= 4; i++) {
  const coilRing = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 12, 24), glassMat);
  coilRing.position.y = i * 0.045;
  coilRing.rotation.x = Math.PI * 0.15;
  condenser.add(coilRing);
}
alembicGroup.add(condenser);

// 3. Glass Receiving Flask
const receiver = new THREE.Group();
receiver.position.set(0.42, 0, 0);

const flaskBulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 24), glassMat);
flaskBulb.position.y = 0.12;
receiver.add(flaskBulb);

const flaskNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 16), glassMat);
flaskNeck.position.y = 0.24;
receiver.add(flaskNeck);

const liquidPool = new THREE.Mesh(
  new THREE.SphereGeometry(0.105, 20, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5),
  distillateMat
);
liquidPool.position.y = 0.11;
receiver.add(liquidPool);

alembicGroup.add(receiver);
