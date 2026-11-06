// Japanese Gyuto Chef Knife on Walnut Magnetic Block
const ambLight = new THREE.AmbientLight(0xfff8f0, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1.5, 2.5, 2.0);
scene.add(ambLight, dirLight);

// Procedural Damascus Wave Pattern Texture
const size = 128;
const data = new Uint8Array(size * size * 4);
for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const idx = (y * size + x) * 4;
    const wave = Math.sin(x * 0.25 + Math.sin(y * 0.15) * 4.0) * Math.cos(y * 0.2 + x * 0.05);
    const shade = Math.floor(140 + 100 * (0.5 + 0.5 * wave));
    data[idx] = shade;
    data[idx + 1] = shade + 4;
    data[idx + 2] = shade + 12;
    data[idx + 3] = 255;
  }
}
const damascusTex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
damascusTex.needsUpdate = true;

// Materials
const bladeMat = new THREE.MeshStandardMaterial({
  map: damascusTex,
  metalness: 0.9,
  roughness: 0.25
});
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.85, roughness: 0.3 });
const burlMat = new THREE.MeshStandardMaterial({ color: 0x224246, roughness: 0.45 });
const walnutMat = new THREE.MeshStandardMaterial({ color: 0x422917, roughness: 0.65 });

// Tilted Walnut Magnetic Knife Block
const block = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.06), walnutMat);
block.position.set(0, 0.78, 0);
block.rotation.set(-0.35, 0.4, 0);
const blockBase = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.18), walnutMat);
blockBase.position.set(0, 0.63, 0);
scene.add(block, blockBase);

// Knife Assembly
const knifeGroup = new THREE.Group();

// Blade Extrusion
const bladeShape = new THREE.Shape();
bladeShape.moveTo(0, 0);
bladeShape.lineTo(0.26, 0.015);
bladeShape.quadraticCurveTo(0.29, 0.035, 0.30, 0.048);
bladeShape.lineTo(0, 0.05);
bladeShape.closePath();

const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
  depth: 0.003,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.001,
  bevelThickness: 0.001
});
const blade = new THREE.Mesh(bladeGeo, bladeMat);
blade.position.set(0, -0.025, -0.0015);
knifeGroup.add(blade);

// Brass Bolster
const bolster = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.024, 0.02), brassMat);
bolster.position.set(-0.008, 0, 0);
knifeGroup.add(bolster);

// Octagonal Wa-Handle (8-sided Cylinder)
const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.13, 8), burlMat);
handle.rotation.z = Math.PI / 2;
handle.position.set(-0.08, 0, 0);
knifeGroup.add(handle);

knifeGroup.position.set(-0.02, 0.82, 0.05);
knifeGroup.rotation.set(-0.35, 0.4, -0.5);
knifeGroup.userData.xr = { grab: true };
scene.add(knifeGroup);
