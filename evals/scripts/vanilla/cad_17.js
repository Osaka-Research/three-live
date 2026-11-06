const group = new THREE.Group();
group.position.set(0, 0.8, 0);
scene.add(group);

const ambientLight = new THREE.AmbientLight(0xfff3db, 0.8);
const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyLight.position.set(1.5, 2.5, 2.0);
scene.add(ambientLight, keyLight);

// Ornate materials
const brassMat = new THREE.MeshPhysicalMaterial({
  color: 0xcca03d,
  roughness: 0.22,
  metalness: 0.92,
  clearcoat: 0.35,
  reflectivity: 0.8
});
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 0.95,
  opacity: 1,
  transparent: true,
  roughness: 0.04,
  ior: 1.52
});
const silverMat = new THREE.MeshPhysicalMaterial({ color: 0xdde2e6, roughness: 0.3, metalness: 0.85 });
const agateMat = new THREE.MeshPhysicalMaterial({ color: 0x932727, roughness: 0.1, clearcoat: 0.8 });
const spiritMat = new THREE.MeshPhysicalMaterial({ color: 0x76c843, transmission: 0.8, transparent: true, roughness: 0.15 });

// Base compass housing (~0.28m diameter)
const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.145, 0.032, 48), brassMat);
const ringBezel = new THREE.Mesh(new THREE.TorusGeometry(0.138, 0.008, 16, 48), brassMat);
ringBezel.rotation.x = Math.PI / 2;
ringBezel.position.y = 0.016;
group.add(housing, ringBezel);

// Engraved silver degree ring & compass dial floor
const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.126, 0.126, 0.004, 48), silverMat);
dial.position.y = 0.008;
group.add(dial);
const degreeRing = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.003, 8, 72), brassMat);
degreeRing.rotation.x = Math.PI / 2;
degreeRing.position.y = 0.011;
group.add(degreeRing);

for (let deg = 0; deg < 360; deg += 30) {
  const rad = (deg * Math.PI) / 180;
  const tickLen = deg % 90 === 0 ? 0.018 : 0.01;
  const tick = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.001, tickLen), brassMat);
  tick.rotation.z = Math.PI / 2;
  tick.rotation.y = -rad;
  tick.position.set(Math.cos(rad) * (0.115 - tickLen / 2), 0.012, Math.sin(rad) * (0.115 - tickLen / 2));
  group.add(tick);
}

// Central agate pivot & balanced magnetic needle
const pivot = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.024, 16), agateMat);
pivot.position.y = 0.018;
group.add(pivot);

const needleGroup = new THREE.Group();
needleGroup.position.y = 0.026;
const northNeedle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.09, 4), new THREE.MeshPhysicalMaterial({ color: 0xb92b27, roughness: 0.3, metalness: 0.8 }));
northNeedle.rotation.x = Math.PI / 2;
northNeedle.position.z = 0.045;
const southNeedle = new THREE.Mesh(new THREE.ConeGeometry(0.008, 0.09, 4), new THREE.MeshPhysicalMaterial({ color: 0x243b55, roughness: 0.3, metalness: 0.8 }));
southNeedle.rotation.x = -Math.PI / 2;
southNeedle.position.z = -0.045;
const needleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.008, 16), brassMat);
needleGroup.add(northNeedle, southNeedle, needleCap);
group.add(needleGroup);

// Two orthogonal tubular spirit levels
function createSpiritLevel(x, z, rotY) {
  const lvl = new THREE.Group();
  lvl.position.set(x, 0.016, z);
  lvl.rotation.y = rotY;
  const vial = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.045, 16), spiritMat);
  vial.rotation.z = Math.PI / 2;
  const mount = new THREE.Mesh(new THREE.TorusGeometry(0.007, 0.002, 8, 16), brassMat);
  mount.position.x = -0.018;
  const mount2 = mount.clone();
  mount2.position.x = 0.018;
  lvl.add(vial, mount, mount2);
  return lvl;
}
group.add(createSpiritLevel(0.07, 0.06, 0));
group.add(createSpiritLevel(-0.06, 0.07, Math.PI / 2));

// Folding sighting vane with hairline slot
const vaneHinge = new THREE.Group();
vaneHinge.position.set(0, 0.016, -0.14);
vaneHinge.rotation.x = 0.3; // partially raised
const vaneFrame = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16), brassMat);
vaneFrame.position.set(-0.018, 0.08, 0);
const vaneFrame2 = vaneFrame.clone();
vaneFrame2.position.x = 0.018;
const vaneCross = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.04), brassMat);
vaneCross.rotation.z = Math.PI / 2;
vaneCross.position.y = 0.16;
const hairline = new THREE.Mesh(new THREE.CylinderGeometry(0.0005, 0.0005, 0.15), silverMat);
hairline.position.y = 0.08;
vaneHinge.add(vaneFrame, vaneFrame2, vaneCross, hairline);
group.add(vaneHinge);

// Hinged lid with glass window
const lidHinge = new THREE.Group();
lidHinge.position.set(0, 0.016, 0.14);
lidHinge.rotation.x = 1.95; // opened back
const lidFrame = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.012, 16, 48), brassMat);
lidFrame.rotation.x = Math.PI / 2;
lidFrame.position.z = 0.14;
const lidGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.134, 0.134, 0.004, 36), glassMat);
lidGlass.position.z = 0.14;
lidHinge.add(lidFrame, lidGlass);
group.add(lidHinge);

group.userData.xr = { grab: true, target: 'compass' };

function animate(dt) {
  needleGroup.rotation.y = Math.sin(Date.now() * 0.0015) * 0.08;
}
