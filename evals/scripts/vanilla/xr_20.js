scene.add(new THREE.AmbientLight(0xf1f5f9, 0.7));
const inspectLight = new THREE.DirectionalLight(0xffffff, 1.0);
inspectLight.position.set(1.5, 2.5, 1.5);
scene.add(inspectLight);

// Granite metrology surface plate
const graniteMat = new THREE.MeshStandardMaterial({
  color: 0x181c20,
  roughness: 0.12,
  metalness: 0.1
});
const surfacePlate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.1, 0.8), graniteMat);
surfacePlate.position.set(0, 0.65, 0);
scene.add(surfacePlate);

// Metrology table isolation feet
const footMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 });
[-0.58, 0.58].forEach((x) => {
  [-0.3, 0.3].forEach((z) => {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.048, 0.14, 16), footMat);
    foot.position.set(x, 0.53, z);
    scene.add(foot);
  });
});

// Precision machined turbine blade using ExtrudeGeometry
const airfoilShape = new THREE.Shape();
airfoilShape.moveTo(0, -0.032);
airfoilShape.quadraticCurveTo(0.028, -0.02, 0.065, 0);
airfoilShape.quadraticCurveTo(0.035, 0.025, 0, 0.032);
airfoilShape.quadraticCurveTo(-0.028, 0.015, -0.048, 0);
airfoilShape.quadraticCurveTo(-0.02, -0.024, 0, -0.032);

const bladeGeo = new THREE.ExtrudeGeometry(airfoilShape, {
  depth: 0.22,
  bevelEnabled: true,
  bevelSegments: 2,
  bevelSize: 0.003,
  bevelThickness: 0.003
});
bladeGeo.center();

const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  metalness: 0.95,
  roughness: 0.16
});

// 3 Precision machined turbine blades and gear housings
[-0.4, 0.0, 0.4].forEach((xOffset) => {
  const partGroup = new THREE.Group();
  partGroup.position.set(xOffset, 0.72, 0);

  // Turbine blade
  const blade = new THREE.Mesh(bladeGeo, chromeMat);
  blade.rotation.x = -Math.PI / 2;
  blade.position.set(0, 0.12, 0.08);
  partGroup.add(blade);

  // Gear housing
  const housing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.085, 0.065, 32),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.25 })
  );
  housing.position.set(0, 0.033, -0.11);
  partGroup.add(housing);

  partGroup.userData.xr = {
    dimensions: { unit: 'mm', axes: ['x', 'y', 'z'], bbox: [150, 240, 180] },
    grab: '2-hand',
    explode: { distance: 0.14, axis: 'y' },
    lod: { levels: [0.6, 1.8, 3.5] }
  };

  scene.add(partGroup);
});
