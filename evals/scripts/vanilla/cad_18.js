const turbine = new THREE.Group();
turbine.position.set(0, -0.5, 0);
scene.add(turbine);

const sunLight = new THREE.DirectionalLight(0xffffff, 1.3);
sunLight.position.set(3, 5, 4);
const amb = new THREE.AmbientLight(0xddeeff, 0.7);
scene.add(sunLight, amb);

// Materials
const yellowMat = new THREE.MeshStandardMaterial({ color: 0xf5b700, roughness: 0.4 });
const towerMat = new THREE.MeshStandardMaterial({ color: 0xefeff2, roughness: 0.35 });
const nacelleMat = new THREE.MeshStandardMaterial({ color: 0xe6e6ea, roughness: 0.3, side: THREE.DoubleSide });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x5a636a, metalness: 0.85, roughness: 0.25 });
const copperMat = new THREE.MeshStandardMaterial({ color: 0xb86532, metalness: 0.9, roughness: 0.3 });
const bladeMat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.25 });

// Monopile transition piece & boat landing access platform
const monopile = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.6, 32), yellowMat);
monopile.position.y = 0.3;
const transitionCone = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.2, 32), yellowMat);
transitionCone.rotation.x = Math.PI;
transitionCone.position.y = 0.7;
const platform = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.02, 32), steelMat);
platform.position.y = 0.8;
turbine.add(monopile, transitionCone, platform);

// Tapering wind turbine tower (up to nacelle at y = 2.45m)
const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.12, 1.65, 32), towerMat);
tower.position.y = 1.625;
turbine.add(tower);

// Yaw ring drive at top of tower
const yawRing = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 32), steelMat);
yawRing.position.y = 2.465;
turbine.add(yawRing);

// Cutaway nacelle housing group
const nacelle = new THREE.Group();
nacelle.position.set(0, 2.52, 0);

// Extruded cutaway nacelle shell (open on starboard side)
const shellShape = new THREE.Shape();
shellShape.moveTo(0.08, -0.06);
shellShape.bezierCurveTo(0.08, 0.09, -0.08, 0.09, -0.08, -0.06);
shellShape.lineTo(-0.065, -0.06);
shellShape.bezierCurveTo(-0.065, 0.075, 0.065, 0.075, 0.065, -0.06);
shellShape.closePath();
const shellGeo = new THREE.ExtrudeGeometry(shellShape, { depth: 0.42, bevelEnabled: false });
shellGeo.translate(0, 0, -0.26);
const nacelleCover = new THREE.Mesh(shellGeo, nacelleMat);
nacelle.add(nacelleCover);

// Internal powertrain components
const mainShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 24), steelMat);
mainShaft.rotation.x = Math.PI / 2;
mainShaft.position.set(0, 0.01, 0.09);

const gearbox = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 24), steelMat);
gearbox.rotation.x = Math.PI / 2;
gearbox.position.set(0, 0.01, -0.04);

const generator = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.12, 24), copperMat);
generator.rotation.x = Math.PI / 2;
generator.position.set(0, 0.01, -0.16);

const bedplate = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.018, 0.42), steelMat);
bedplate.position.set(0, -0.055, -0.05);
nacelle.add(mainShaft, gearbox, generator, bedplate);

// Rotor Hub & 3 aerodynamic wind turbine blades
const rotorHub = new THREE.Group();
rotorHub.position.set(0, 0.01, 0.19);

const noseCone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.09, 24), nacelleMat);
noseCone.rotation.x = Math.PI / 2;
noseCone.position.z = 0.045;
rotorHub.add(noseCone);

// Extrude aerodynamic airfoil blade profile
const airfoilShape = new THREE.Shape();
airfoilShape.moveTo(0, 0);
airfoilShape.bezierCurveTo(0.015, 0.008, 0.03, 0.004, 0.05, 0);
airfoilShape.bezierCurveTo(0.025, -0.004, 0.01, -0.003, 0, 0);

for (let b = 0; b < 3; b++) {
  const bladeGroup = new THREE.Group();
  bladeGroup.rotation.z = (b * Math.PI * 2) / 3;
  const bladeGeo = new THREE.ExtrudeGeometry(airfoilShape, { depth: 0.95, bevelEnabled: false });
  bladeGeo.scale(1, 1, 1);
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.rotation.x = -Math.PI / 2;
  bladeMesh.position.y = 0.035;
  bladeGroup.add(bladeMesh);
  rotorHub.add(bladeGroup);
}
nacelle.add(rotorHub);
turbine.add(nacelle);

function animate(dt) {
  rotorHub.rotation.z += (dt || 0.016) * 1.5;
}
