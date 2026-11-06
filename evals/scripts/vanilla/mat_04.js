// mat_04: Heavy fluted crystal perfume bottle with amber liquid and atomizer
const bottleGroup = new THREE.Group();
bottleGroup.position.set(0, 0.8, 0);
scene.add(bottleGroup);

// Fluted crystal outer bottle (~0.3m tall)
const outerGlassGeo = new THREE.CylinderGeometry(0.075, 0.08, 0.22, 16, 1, false);
const crystalMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.98,
  transparent: true,
  opacity: 1.0,
  roughness: 0.03,
  ior: 1.52,
  thickness: 0.065,
  specularIntensity: 1.0,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  flatShading: true
});
const outerGlass = new THREE.Mesh(outerGlassGeo, crystalMat);
outerGlass.position.y = 0.0;
bottleGroup.add(outerGlass);

// Inner liquid chamber with attenuation
const liquidGeo = new THREE.CylinderGeometry(0.052, 0.055, 0.17, 32);
const liquidMat = new THREE.MeshPhysicalMaterial({
  color: 0xffeedd,
  transmission: 0.88,
  transparent: true,
  opacity: 1.0,
  roughness: 0.05,
  ior: 1.38,
  thickness: 0.11,
  attenuationColor: new THREE.Color(0xd47514),
  attenuationDistance: 0.045
});
const perfumeLiquid = new THREE.Mesh(liquidGeo, liquidMat);
perfumeLiquid.position.y = -0.015;
bottleGroup.add(perfumeLiquid);

// Dip tube inside perfume
const dipTubeMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.95,
  transparent: true,
  roughness: 0.1,
  ior: 1.49,
  thickness: 0.005
});
const dipTube = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.19, 16), dipTubeMat);
dipTube.position.set(0.003, 0.01, 0);
bottleGroup.add(dipTube);

// Gold atomizer collar and nozzle
const goldMat = new THREE.MeshStandardMaterial({
  color: 0xdfb15b,
  metalness: 0.95,
  roughness: 0.22
});
const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.038, 0.045, 24), goldMat);
collar.position.y = 0.13;
bottleGroup.add(collar);

const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 16), goldMat);
nozzle.position.y = 0.165;
bottleGroup.add(nozzle);

// Faceted crystal stopper
const stopperGeo = new THREE.BoxGeometry(0.055, 0.065, 0.035);
stopperGeo.rotateZ(Math.PI / 4);
const stopper = new THREE.Mesh(stopperGeo, crystalMat);
stopper.position.y = 0.21;
bottleGroup.add(stopper);

// Lighting
scene.add(new THREE.AmbientLight(0x222228, 0.8));
const keyLight = new THREE.DirectionalLight(0xfffaee, 2.2);
keyLight.position.set(1.5, 2.5, 1.8);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xcfe4ff, 1.5);
rimLight.position.set(-1.4, 2.0, -1.5);
scene.add(rimLight);

const causticBacklight = new THREE.PointLight(0xff9922, 3.5, 1.5);
causticBacklight.position.set(0, 0.82, -0.22);
scene.add(causticBacklight);

scene.userData.animate = (dt) => {
  bottleGroup.rotation.y += dt * 0.35;
};
