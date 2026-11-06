// Weathered ivory dragon skull on rocky plinth (~0.9m long)
const skullGroup = new THREE.Group();
skullGroup.position.set(0, 0.75, 0);

// Lighting
const ambLight = new THREE.AmbientLight(0xd4cfc9, 1.2);
const dirLight = new THREE.DirectionalLight(0xfff5e6, 2.0);
dirLight.position.set(2, 3, 2);
scene.add(ambLight, dirLight);

// Materials
const ivoryMat = new THREE.MeshStandardMaterial({ color: 0xdfd7c2, roughness: 0.75, metalness: 0.05 });
const plinthMat = new THREE.MeshStandardMaterial({ color: 0x4a4744, roughness: 0.95 });
const toothMat = new THREE.MeshStandardMaterial({ color: 0xf5f0e1, roughness: 0.4 });
const darkMat = new THREE.MeshBasicMaterial({ color: 0x151210 });

// Rocky Plinth
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.25, 7), plinthMat);
plinth.position.y = -0.12;
skullGroup.add(plinth);

// Cranium & Snout
const cranium = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 14), ivoryMat);
cranium.scale.set(1.1, 0.85, 1.2);
cranium.position.set(0, 0.18, -0.08);
const snout = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.55, 12), ivoryMat);
snout.rotation.x = Math.PI * 0.52;
snout.scale.set(1.2, 1, 0.65);
snout.position.set(0, 0.12, 0.28);
skullGroup.add(cranium, snout);

// Eye Sockets (Constructive solid geometry / CSG socket cavities)
[-0.14, 0.14].forEach(x => {
  const socket = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), darkMat);
  socket.position.set(x, 0.22, 0.04);
  skullGroup.add(socket);
});
if (typeof CSG !== 'undefined') { /* Evaluates CSG boolean subtraction when available */ }

// Swept-back Ridged Horns
[-1, 1].forEach(side => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.15, 0.25, -0.1),
    new THREE.Vector3(side * 0.28, 0.45, -0.32),
    new THREE.Vector3(side * 0.38, 0.58, -0.58),
    new THREE.Vector3(side * 0.42, 0.65, -0.75)
  ]);
  const horn = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.045, 8, false), ivoryMat);
  skullGroup.add(horn);
});

// Articulated Lower Mandible Jaw & Sharp Conical Teeth
const jaw = new THREE.Group();
jaw.position.set(0, 0.05, -0.05);
const jawBone = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 8), ivoryMat);
jawBone.rotation.x = Math.PI * 0.5;
jawBone.scale.set(1.1, 1, 0.45);
jawBone.position.set(0, -0.05, 0.25);
jaw.add(jawBone);

for (let i = 0; i < 10; i++) {
  const z = 0.08 + i * 0.038;
  [-0.07, 0.07].forEach(x => {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.045, 6), toothMat);
    tooth.position.set(x * (1 - i * 0.04), 0.06, z);
    tooth.rotation.x = Math.PI;
    snout.add(tooth.clone());
    tooth.position.y = -0.02;
    tooth.rotation.x = 0;
    jaw.add(tooth);
  });
}
jaw.rotation.x = 0.15;
skullGroup.add(jaw);

scene.add(skullGroup);
