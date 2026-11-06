const group = new THREE.Group();
group.position.set(0, 0.8, 0);
scene.add(group);

const ambient = new THREE.AmbientLight(0xffffff, 0.8);
const dirLight = new THREE.DirectionalLight(0xffeedd, 1.4);
dirLight.position.set(1.5, 2.0, 1.8);
scene.add(ambient, dirLight);

const nacreMat = new THREE.MeshPhysicalMaterial({
  color: 0xf5ede4,
  roughness: 0.2,
  metalness: 0.1,
  clearcoat: 0.9,
  clearcoatRoughness: 0.1,
  iridescence: 0.9,
  iridescenceIOR: 1.35,
  side: THREE.DoubleSide
});

const outerMat = new THREE.MeshStandardMaterial({
  color: 0xd9823b,
  roughness: 0.5,
  side: THREE.DoubleSide
});

const a = 0.015, b = 0.175;
const siphunclePts = [];
const outerPts = [];
const turns = 3.6 * Math.PI * 2;
const steps = 70;

for (let i = 0; i <= steps; i++) {
  const theta = (i / steps) * turns;
  const r = a * Math.exp(b * theta);
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  siphunclePts.push(new THREE.Vector3(x * 0.75, y * 0.75, -0.01));
  outerPts.push(new THREE.Vector3(x, y, 0));
}

const siphuncleCurve = new THREE.CatmullRomCurve3(siphunclePts);
const siphuncleGeo = new THREE.TubeGeometry(siphuncleCurve, 80, 0.0035, 8, false);
const siphuncleMat = new THREE.MeshStandardMaterial({ color: 0x6e4726, roughness: 0.6 });
group.add(new THREE.Mesh(siphuncleGeo, siphuncleMat));

const outerCurve = new THREE.CatmullRomCurve3(outerPts);
const rimGeo = new THREE.TubeGeometry(outerCurve, 100, 0.008, 12, false);
group.add(new THREE.Mesh(rimGeo, outerMat));

const septaGroup = new THREE.Group();
const numSepta = 24;
for (let j = 4; j < numSepta; j++) {
  const theta = (j / numSepta) * turns;
  const prevTheta = ((j - 1) / numSepta) * turns;
  const rInner = a * Math.exp(b * prevTheta);
  const rOuter = a * Math.exp(b * theta);

  const pInner = new THREE.Vector3(rInner * Math.cos(prevTheta), rInner * Math.sin(prevTheta), 0);
  const pOuter = new THREE.Vector3(rOuter * Math.cos(theta), rOuter * Math.sin(theta), 0);
  const pMid = pInner.clone().lerp(pOuter, 0.5).add(new THREE.Vector3(-0.015 * Math.sin(theta), 0.015 * Math.cos(theta), 0.015));

  const septaCurve = new THREE.CatmullRomCurve3([pInner, pMid, pOuter]);
  const septaGeo = new THREE.TubeGeometry(septaCurve, 16, 0.0025 + j * 0.0003, 6, false);
  septaGroup.add(new THREE.Mesh(septaGeo, nacreMat));
}
group.add(septaGroup);

const backGeo = new THREE.BufferGeometry();
const backVerts = [], backIndices = [];
for (let i = 0; i < steps; i++) {
  const t0 = (i / steps) * turns, t1 = ((i + 1) / steps) * turns;
  const r0 = a * Math.exp(b * t0), r1 = a * Math.exp(b * t1);
  const zDepth0 = -Math.min(0.08, r0 * 0.4);
  const zDepth1 = -Math.min(0.08, r1 * 0.4);
  const idx = i * 4;
  backVerts.push(
    r0 * Math.cos(t0), r0 * Math.sin(t0), 0,
    r0 * Math.cos(t0) * 0.2, r0 * Math.sin(t0) * 0.2, zDepth0,
    r1 * Math.cos(t1), r1 * Math.sin(t1), 0,
    r1 * Math.cos(t1) * 0.2, r1 * Math.sin(t1) * 0.2, zDepth1
  );
  backIndices.push(idx, idx + 1, idx + 2, idx + 1, idx + 3, idx + 2);
}
backGeo.setAttribute('position', new THREE.Float32BufferAttribute(backVerts, 3));
backGeo.setIndex(backIndices);
backGeo.computeVertexNormals();
group.add(new THREE.Mesh(backGeo, nacreMat));

group.userData.xr = { grabbable: true, title: "Chambered Nautilus" };
scene.userData.update = (dt) => {
  group.rotation.y += 0.4 * dt;
};
