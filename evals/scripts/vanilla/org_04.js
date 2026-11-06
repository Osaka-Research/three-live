// Translucent deep-sea jellyfish (~0.9m tall) floating in mid-air
const jellyfish = new THREE.Group();

// Outer translucent bell using LatheGeometry and MeshPhysicalMaterial
const bellPoints = [];
for (let i = 0; i <= 16; i++) {
  const t = (i / 16) * (Math.PI / 2);
  const r = 0.28 * Math.sin(t);
  const y = 0.22 * Math.cos(t);
  bellPoints.push(new THREE.Vector2(r, y));
}
const bellGeo = new THREE.LatheGeometry(bellPoints, 32);
const bellMat = new THREE.MeshPhysicalMaterial({
  color: 0x88ddff,
  transmission: 0.85,
  opacity: 1,
  transparent: true,
  roughness: 0.18,
  ior: 1.34,
  thickness: 0.08,
  emissive: 0x113355
});
const bellMesh = new THREE.Mesh(bellGeo, bellMat);
bellMesh.position.y = 0.78;
jellyfish.add(bellMesh);

// Glowing inner bell organ using SphereGeometry
const organGeo = new THREE.SphereGeometry(0.12, 16, 12);
organGeo.scale(1, 0.8, 1);
const organMat = new THREE.MeshStandardMaterial({
  color: 0x44aaff,
  emissive: 0x2288ff,
  emissiveIntensity: 0.8,
  roughness: 0.4
});
const organMesh = new THREE.Mesh(organGeo, organMat);
organMesh.position.y = 0.82;
jellyfish.add(organMesh);

// 4 Frilly central oral arms using CatmullRomCurve3 & TubeGeometry
const armMat = new THREE.MeshStandardMaterial({ color: 0x99e0ff, roughness: 0.5, transparent: true, opacity: 0.85 });
for (let i = 0; i < 4; i++) {
  const angle = (i / 4) * Math.PI * 2;
  const pts = [
    new THREE.Vector3(Math.cos(angle) * 0.05, 0.76, Math.sin(angle) * 0.05),
    new THREE.Vector3(Math.cos(angle + 0.6) * 0.09, 0.60, Math.sin(angle + 0.6) * 0.09),
    new THREE.Vector3(Math.cos(angle - 0.4) * 0.07, 0.45, Math.sin(angle - 0.4) * 0.07),
    new THREE.Vector3(Math.cos(angle + 0.3) * 0.04, 0.32, Math.sin(angle + 0.3) * 0.04)
  ];
  const armGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.014, 8, false);
  jellyfish.add(new THREE.Mesh(armGeo, armMat));
}

// 16 Long sinusoidal trailing tentacles
const tentacleMat = new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.75 });
const tentacles = [];
for (let i = 0; i < 16; i++) {
  const theta = (i / 16) * Math.PI * 2;
  const x0 = Math.cos(theta) * 0.26;
  const z0 = Math.sin(theta) * 0.26;
  const pts = [];
  for (let s = 0; s <= 8; s++) {
    const py = 0.76 - s * 0.085;
    const wave = Math.sin(s * 1.2 + i) * 0.03;
    pts.push(new THREE.Vector3(x0 + wave, py, z0 + wave));
  }
  const tGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.003, 5, false);
  const tMesh = new THREE.Mesh(tGeo, tentacleMat);
  jellyfish.add(tMesh);
  tentacles.push(tMesh);
}

// Deep sea bioluminescent lighting
const ambient = new THREE.AmbientLight(0x051525, 1.0);
const light = new THREE.PointLight(0x33bbee, 2.5, 3.0);
light.position.set(0, 0.8, 0);
jellyfish.add(ambient, light);

scene.add(jellyfish);

let time = 0;
function animate(dt) {
  time += dt;
  const pulse = 1 + Math.sin(time * 2.0) * 0.06;
  bellMesh.scale.set(pulse, 2 - pulse, pulse);
  jellyfish.position.y = Math.sin(time * 1.2) * 0.05;
}
