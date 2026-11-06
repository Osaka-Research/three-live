const roseGroup = new THREE.Group();
roseGroup.position.set(0, 0.8, 0);
scene.add(roseGroup);

const stoneMat = new THREE.MeshStandardMaterial({ color: 0xd6cfc4, roughness: 0.9, metalness: 0.05 });
const glassMatRuby = new THREE.MeshPhysicalMaterial({ color: 0xaa1133, transmission: 0.85, opacity: 1, transparent: true, roughness: 0.2, ior: 1.5 });
const glassMatSapphire = new THREE.MeshPhysicalMaterial({ color: 0x1144aa, transmission: 0.85, opacity: 1, transparent: true, roughness: 0.2, ior: 1.5 });
const glassMatGold = new THREE.MeshPhysicalMaterial({ color: 0xddaa22, transmission: 0.85, opacity: 1, transparent: true, roughness: 0.2, ior: 1.5 });

// Outer deep beveled arch molding (2.4m diameter)
const outerRimGeo = new THREE.TorusGeometry(1.2, 0.12, 16, 64);
const outerRim = new THREE.Mesh(outerRimGeo, stoneMat);
roseGroup.add(outerRim);

const innerRimGeo = new THREE.TorusGeometry(0.4, 0.06, 16, 48);
const innerRim = new THREE.Mesh(innerRimGeo, stoneMat);
roseGroup.add(innerRim);

// Extruded quatrefoil tracery center
const traceryShape = new THREE.Shape();
traceryShape.absarc(0, 0, 0.35, 0, Math.PI * 2, false);
for (let i = 0; i < 4; i++) {
  const angle = (i * Math.PI) / 2;
  const hole = new THREE.Path();
  hole.absarc(Math.cos(angle) * 0.16, Math.sin(angle) * 0.16, 0.1, 0, Math.PI * 2, true);
  traceryShape.holes.push(hole);
}
const traceryGeo = new THREE.ExtrudeGeometry(traceryShape, { depth: 0.08, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.02, bevelThickness: 0.02 });
traceryGeo.center();
const centerTracery = new THREE.Mesh(traceryGeo, stoneMat);
roseGroup.add(centerTracery);

// Radial stone mullions and stained glass segments (12 petals)
const mullionGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.8, 12);
const glassSectorShape = new THREE.Shape();
glassSectorShape.moveTo(0.4, -0.12);
glassSectorShape.lineTo(1.15, -0.28);
glassSectorShape.lineTo(1.15, 0.28);
glassSectorShape.lineTo(0.4, 0.12);
glassSectorShape.closePath();
const glassGeo = new THREE.ExtrudeGeometry(glassSectorShape, { depth: 0.02, bevelEnabled: false });
glassGeo.center();

const colors = [glassMatRuby, glassMatSapphire, glassMatGold];
for (let i = 0; i < 12; i++) {
  const angle = (i * Math.PI * 2) / 12;
  const mullion = new THREE.Mesh(mullionGeo, stoneMat);
  mullion.position.set(Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, 0);
  mullion.rotation.z = angle + Math.PI / 2;
  roseGroup.add(mullion);

  const glass = new THREE.Mesh(glassGeo, colors[i % 3]);
  glass.position.set(Math.cos(angle + Math.PI / 12) * 0.78, Math.sin(angle + Math.PI / 12) * 0.78, 0);
  glass.rotation.z = angle + Math.PI / 12;
  roseGroup.add(glass);
}

// Lighting
const sunLight = new THREE.DirectionalLight(0xfff5ea, 2.5);
sunLight.position.set(2, 3, -3);
scene.add(sunLight);
const ambLight = new THREE.AmbientLight(0x8899aa, 1.2);
scene.add(ambLight);

roseGroup.userData.xr = { grab: true };
scene.userData.interactivity = (dt) => {
  roseGroup.rotation.z += dt * 0.05;
};
