const root = new THREE.Group();
root.position.set(0, 0.8, 0);
scene.add(root);

const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.4);
dirLight.position.set(1.5, 2.5, 2);
root.add(ambLight, dirLight);

// Floating display plinth
const plinth = new THREE.Mesh(
  new THREE.CylinderGeometry(0.3, 0.35, 0.06, 32),
  new THREE.MeshPhysicalMaterial({ color: 0x111115, metalness: 0.9, roughness: 0.1, clearcoat: 1.0 })
);
plinth.position.y = -0.15;
root.add(plinth);

// Shoe group (~0.35m long)
const shoe = new THREE.Group();
shoe.position.y = 0.05;
root.add(shoe);

const soleMat = new THREE.MeshPhysicalMaterial({ color: 0xf0f0f0, roughness: 0.3, clearcoat: 0.5 });
const sole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.35), soleMat);
sole.name = 'sole';
sole.position.set(0, -0.02, 0);
shoe.add(sole);

const upperMat = new THREE.MeshPhysicalMaterial({ color: 0x1a73e8, roughness: 0.5, clearcoat: 0.3 });
const upper = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.1, 0.3), upperMat);
upper.name = 'upper';
upper.position.set(0, 0.05, -0.01);
shoe.add(upper);

const tongue = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.1), upperMat);
tongue.name = 'tongue';
tongue.position.set(0, 0.11, -0.04);
tongue.rotation.x = -0.3;
shoe.add(tongue);

// Swoosh logo using ExtrudeGeometry
const swooshShape = new THREE.Shape();
swooshShape.moveTo(0, 0);
swooshShape.quadraticCurveTo(0.06, 0.02, 0.14, 0.08);
swooshShape.quadraticCurveTo(0.08, 0.02, 0.02, -0.01);
swooshShape.closePath();
const swooshGeo = new THREE.ExtrudeGeometry(swooshShape, { depth: 0.01, bevelEnabled: false });
const swooshMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.2 });
const swoosh = new THREE.Mesh(swooshGeo, swooshMat);
swoosh.name = 'swoosh';
swoosh.position.set(0.066, 0.04, -0.05);
swoosh.rotation.y = Math.PI / 2;
shoe.add(swoosh);

// Laces using CylinderGeometry
const laces = new THREE.Group();
laces.name = 'laces';
const laceGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.08, 8);
const laceMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6 });
for (let i = 0; i < 4; i++) {
  const lace = new THREE.Mesh(laceGeo, laceMat);
  lace.rotation.z = Math.PI / 2;
  lace.position.set(0, 0.08 + i * 0.012, 0.02 - i * 0.035);
  laces.add(lace);
}
shoe.add(laces);

// Interactivity: onSelect cycle colorways and bounce
const colorways = [0x1a73e8, 0xe63946, 0x2a9d8f, 0x111111];
let cIndex = 0;
let bounceTime = 0;

shoe.userData.interactivity = {
  onSelect: () => {
    cIndex = (cIndex + 1) % colorways.length;
    upper.material.color.setHex(colorways[cIndex]);
    bounceTime = 1.0;
  }
};

function animate(dt = 0.016) {
  plinth.rotation.y += dt * 0.3;
  shoe.rotation.y += dt * 0.5;
  if (bounceTime > 0) {
    bounceTime = Math.max(0, bounceTime - dt * 2.5);
    shoe.position.y = 0.05 + Math.sin((1 - bounceTime) * Math.PI) * 0.12;
  }
}
scene.userData.animate = animate;
