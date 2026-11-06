const group = new THREE.Group();
group.position.set(0, 0.75, 0);
scene.add(group);

const ambient = new THREE.AmbientLight(0xddeeff, 0.8);
const sun = new THREE.DirectionalLight(0xfff8e7, 1.5);
sun.position.set(2, 3, 2);
scene.add(ambient, sun);

const padShape = new THREE.Shape();
const padRadius = 0.38, notch = 0.22;
padShape.moveTo(0, 0);
padShape.lineTo(padRadius * Math.cos(notch), padRadius * Math.sin(notch));
padShape.absarc(0, 0, padRadius, notch, Math.PI * 2 - notch, false);
padShape.closePath();

const padGeo = new THREE.ExtrudeGeometry(padShape, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.003 });
padGeo.rotateX(-Math.PI / 2);
const padMat = new THREE.MeshStandardMaterial({ color: 0x2d6a34, roughness: 0.6 });
group.add(new THREE.Mesh(padGeo, padMat));

const podPoints = [
  new THREE.Vector2(0, 0),
  new THREE.Vector2(0.02, 0),
  new THREE.Vector2(0.038, 0.025),
  new THREE.Vector2(0.045, 0.04),
  new THREE.Vector2(0, 0.04)
];
const podGeo = new THREE.LatheGeometry(podPoints, 24);
const podMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.35, metalness: 0.1 });
const pod = new THREE.Mesh(podGeo, podMat);
pod.position.y = 0.01;
group.add(pod);

const poreGeo = new THREE.SphereGeometry(0.003, 8, 8);
const poreMat = new THREE.MeshStandardMaterial({ color: 0x6e4e08 });
for (let p = 0; p < 9; p++) {
  const angle = (p / 9) * Math.PI * 2;
  const pr = 0.025;
  const pore = new THREE.Mesh(poreGeo, poreMat);
  pore.position.set(Math.cos(angle) * pr, 0.05, Math.sin(angle) * pr);
  group.add(pore);
}

const stamenStemGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.03, 6);
const antherGeo = new THREE.SphereGeometry(0.0022, 6, 6);
const stamenMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.3 });
for (let s = 0; s < 28; s++) {
  const theta = (s / 28) * Math.PI * 2;
  const sr = 0.052;
  const stamen = new THREE.Group();
  const stem = new THREE.Mesh(stamenStemGeo, stamenMat);
  stem.position.y = 0.015;
  const anther = new THREE.Mesh(antherGeo, stamenMat);
  anther.position.y = 0.03;
  stamen.add(stem, anther);
  stamen.position.set(Math.cos(theta) * sr, 0.01, Math.sin(theta) * sr);
  stamen.rotation.z = -Math.cos(theta) * 0.25;
  stamen.rotation.x = Math.sin(theta) * 0.25;
  group.add(stamen);
}

const petalShape = new THREE.Shape();
petalShape.moveTo(0, 0);
petalShape.quadraticCurveTo(-0.035, 0.07, 0, 0.14);
petalShape.quadraticCurveTo(0.035, 0.07, 0, 0);

const petalGeo = new THREE.ExtrudeGeometry(petalShape, { depth: 0.002, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001 });
petalGeo.center();

const petalMatInner = new THREE.MeshStandardMaterial({ color: 0xffd1dc, roughness: 0.4, side: THREE.DoubleSide });
const petalMatOuter = new THREE.MeshStandardMaterial({ color: 0xf06292, roughness: 0.45, side: THREE.DoubleSide });

const rings = [
  { count: 8, radius: 0.065, tilt: 0.45, scale: 0.8, mat: petalMatInner, y: 0.018 },
  { count: 12, radius: 0.095, tilt: 0.75, scale: 1.1, mat: petalMatInner, y: 0.015 },
  { count: 16, radius: 0.13, tilt: 1.15, scale: 1.35, mat: petalMatOuter, y: 0.012 }
];

rings.forEach(ring => {
  for (let i = 0; i < ring.count; i++) {
    const angle = (i / ring.count) * Math.PI * 2;
    const petal = new THREE.Mesh(petalGeo, ring.mat);
    petal.scale.set(ring.scale, ring.scale, ring.scale);
    petal.position.set(Math.cos(angle) * ring.radius, ring.y + Math.sin(ring.tilt) * 0.03, Math.sin(angle) * ring.radius);
    petal.rotation.y = -angle + Math.PI / 2;
    petal.rotation.x = ring.tilt;
    group.add(petal);
  }
});

group.userData.xr = { grabbable: true, title: "Sacred Lotus" };
let time = 0;
scene.userData.update = (dt) => {
  time += dt;
  group.position.y = 0.75 + Math.sin(time * 1.5) * 0.008;
  group.rotation.y += dt * 0.08;
};
