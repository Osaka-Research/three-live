const group = new THREE.Group();
group.position.set(0, 0.8, 0);
scene.add(group);

const ambient = new THREE.AmbientLight(0x224466, 0.8);
const sun = new THREE.DirectionalLight(0xddeeff, 1.5);
sun.position.set(1.5, 3.0, 2.0);
scene.add(ambient, sun);

const dorsalMat = new THREE.MeshStandardMaterial({ color: 0x1a2634, roughness: 0.3, metalness: 0.1 });
const ventralMat = new THREE.MeshStandardMaterial({ color: 0xf0f4f8, roughness: 0.5 });

const nx = 30, nz = 20;
const wingGeo = new THREE.BufferGeometry();
const basePos = [];
const indices = [];

for (let iz = 0; iz <= nz; iz++) {
  const v = iz / nz;
  const z = (v - 0.35) * 1.1;
  const chordWidth = Math.sin(v * Math.PI) * 0.9;

  for (let ix = 0; ix <= nx; ix++) {
    const u = (ix / nx) * 2 - 1;
    const x = u * chordWidth;
    const distCenter = Math.abs(u);
    const thick = Math.max(0.01, (1 - distCenter * 0.8) * (1 - Math.abs(v - 0.4) * 1.5) * 0.11);
    const y = -Math.pow(distCenter, 1.8) * 0.06;
    basePos.push(x, y, z);
  }
}

for (let iz = 0; iz < nz; iz++) {
  for (let ix = 0; ix < nx; ix++) {
    const a = iz * (nx + 1) + ix;
    const b = a + 1;
    const c = (iz + 1) * (nx + 1) + ix;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
}

wingGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(basePos), 3));
wingGeo.setIndex(indices);
wingGeo.computeVertexNormals();

const bodyMesh = new THREE.Mesh(wingGeo, dorsalMat);
group.add(bodyMesh);

const hornShape = new THREE.Shape();
hornShape.moveTo(0, 0);
hornShape.bezierCurveTo(0.04, 0.08, 0.06, 0.16, 0.01, 0.22);
hornShape.bezierCurveTo(-0.03, 0.18, -0.02, 0.08, 0, 0);

const hornGeo = new THREE.ExtrudeGeometry(hornShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006 });
hornGeo.center();

[-0.14, 0.14].forEach((xSide, i) => {
  const horn = new THREE.Mesh(hornGeo, dorsalMat);
  horn.position.set(xSide, -0.01, -0.42);
  horn.rotation.set(-0.35, 0, (i === 0 ? 0.3 : -0.3));
  horn.scale.set(0.9, 0.9, 0.9);
  group.add(horn);
});

const tailPts = [];
for (let i = 0; i <= 20; i++) {
  const t = i / 20;
  const tz = 0.7 + t * 1.4;
  const ty = -0.02 - Math.sin(t * Math.PI) * 0.05;
  tailPts.push(new THREE.Vector3(0, ty, tz));
}
const tailCurve = new THREE.CatmullRomCurve3(tailPts);
const tailGeo = new THREE.TubeGeometry(tailCurve, 32, 0.008, 8, false);
group.add(new THREE.Mesh(tailGeo, dorsalMat));

const gillMat = new THREE.MeshStandardMaterial({ color: 0x334455 });
const gillShape = new THREE.Shape();
gillShape.absellipse(0, 0, 0.004, 0.028, 0, Math.PI * 2);
const gillGeo = new THREE.ExtrudeGeometry(gillShape, { depth: 0.002, bevelEnabled: false });

for (let g = 0; g < 5; g++) {
  const gz = -0.18 + g * 0.065;
  const gx = 0.08 + g * 0.018;
  const gillL = new THREE.Mesh(gillGeo, gillMat);
  gillL.position.set(-gx, -0.06, gz);
  gillL.rotation.x = Math.PI / 2;
  const gillR = new THREE.Mesh(gillGeo, gillMat);
  gillR.position.set(gx, -0.06, gz);
  gillR.rotation.x = Math.PI / 2;
  group.add(gillL, gillR);
}

group.userData.xr = { grabbable: true, title: "Oceanic Manta Ray" };

let glideTime = 0;
const posAttr = wingGeo.attributes.position;
scene.userData.update = (dt) => {
  glideTime += dt * 2.8;
  for (let i = 0; i < posAttr.count; i++) {
    const origX = basePos[i * 3];
    const origY = basePos[i * 3 + 1];
    const origZ = basePos[i * 3 + 2];
    const spanRatio = Math.abs(origX) / 0.9;
    const wave = Math.sin(glideTime - origZ * 3.0) * Math.pow(spanRatio, 2.0) * 0.16;
    posAttr.setY(i, origY + wave);
  }
  posAttr.needsUpdate = true;
  wingGeo.computeVertexNormals();
  group.position.y = 0.8 + Math.sin(glideTime * 0.5) * 0.05;
  group.rotation.z = Math.sin(glideTime * 0.5) * 0.08;
};
