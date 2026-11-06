// Underwater coral reef outcrop (~1.2m wide)
const reef = new THREE.Group();

// Sandy seabed rock base using BufferGeometry
const baseGeo = new THREE.PlaneGeometry(1.2, 0.9, 16, 12);
baseGeo.rotateX(-Math.PI / 2);
const pos = baseGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i);
  const z = pos.getZ(i);
  const dist = Math.sqrt(x * x + z * z);
  const mound = Math.max(0, 0.18 * (1 - dist / 0.6));
  pos.setY(i, mound + (Math.sin(x * 8) * Math.cos(z * 8)) * 0.03);
}
baseGeo.computeVertexNormals();
const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a7d65, roughness: 0.9 });
reef.add(new THREE.Mesh(baseGeo, rockMat));

// Grooved brain coral using SphereGeometry
const brainGeo = new THREE.SphereGeometry(0.18, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.55);
const bPos = brainGeo.attributes.position;
for (let i = 0; i < bPos.count; i++) {
  const theta = Math.atan2(bPos.getZ(i), bPos.getX(i));
  const groove = Math.sin(theta * 14) * 0.012;
  bPos.setY(i, bPos.getY(i) + groove);
}
brainGeo.computeVertexNormals();
const brainMat = new THREE.MeshStandardMaterial({ color: 0xd4b046, roughness: 0.65 });
const brainCoral = new THREE.Mesh(brainGeo, brainMat);
brainCoral.position.set(-0.28, 0.14, -0.05);
reef.add(brainCoral);

// Branching staghorn coral antlers using CatmullRomCurve3 & TubeGeometry
const stagMat = new THREE.MeshStandardMaterial({ color: 0x3bb3a9, roughness: 0.7 });
const stagBranches = [
  [new THREE.Vector3(0.2, 0.12, -0.1), new THREE.Vector3(0.22, 0.32, -0.08), new THREE.Vector3(0.25, 0.48, -0.05)],
  [new THREE.Vector3(0.22, 0.28, -0.08), new THREE.Vector3(0.14, 0.38, -0.12), new THREE.Vector3(0.10, 0.46, -0.15)],
  [new THREE.Vector3(0.22, 0.32, -0.08), new THREE.Vector3(0.32, 0.40, -0.02), new THREE.Vector3(0.38, 0.50, 0.02)]
];
stagBranches.forEach(pts => {
  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.TubeGeometry(curve, 16, 0.016, 8, false);
  reef.add(new THREE.Mesh(tube, stagMat));
});

// Tubular sea sponges using CylinderGeometry
const spongeMat = new THREE.MeshStandardMaterial({ color: 0x9b3db5, roughness: 0.6 });
const spongeOffsets = [
  { x: 0.38, z: 0.18, h: 0.22, r: 0.035 },
  { x: 0.43, z: 0.15, h: 0.28, r: 0.04 },
  { x: 0.34, z: 0.13, h: 0.17, r: 0.03 }
];
spongeOffsets.forEach(s => {
  const cyl = new THREE.CylinderGeometry(s.r * 0.9, s.r, s.h, 12, 1, true);
  const mesh = new THREE.Mesh(cyl, spongeMat);
  mesh.position.set(s.x, 0.10 + s.h / 2, s.z);
  reef.add(mesh);
});

// Sea anemone cluster with tentacle tubes
const anemoneMat = new THREE.MeshStandardMaterial({ color: 0xff5588, roughness: 0.5 });
for (let i = 0; i < 18; i++) {
  const ang = (i / 18) * Math.PI * 2;
  const tCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(Math.cos(ang) * 0.04, 0.0, Math.sin(ang) * 0.04),
    new THREE.Vector3(Math.cos(ang) * 0.07, 0.06, Math.sin(ang) * 0.07),
    new THREE.Vector3(Math.cos(ang) * 0.10, 0.12, Math.sin(ang) * 0.10)
  ]);
  const aMesh = new THREE.Mesh(new THREE.TubeGeometry(tCurve, 8, 0.005, 6, false), anemoneMat);
  aMesh.position.set(-0.05, 0.15, 0.22);
  reef.add(aMesh);
}

// Tropical underwater lighting
const ambient = new THREE.AmbientLight(0x0e4d68, 0.8);
const sun = new THREE.DirectionalLight(0x7beef7, 1.3);
sun.position.set(1.5, 3.0, 1.0);
reef.add(ambient, sun);

scene.add(reef);
