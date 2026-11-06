const group = new THREE.Group();
group.position.set(0, 0, 0);
scene.add(group);

const ambient = new THREE.AmbientLight(0xd0e8d0, 0.7);
const sun = new THREE.DirectionalLight(0xfffae8, 1.4);
sun.position.set(3, 4, 2);
scene.add(ambient, sun);

const waterMat = new THREE.MeshStandardMaterial({ color: 0x1f5f6b, roughness: 0.1, metalness: 0.2 });
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6e706e, roughness: 0.85 });

const water = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.04, 32), waterMat);
water.position.set(0.45, 0.02, 0.1);
const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.58, 0.06, 32), stoneMat);
rim.position.set(0.45, 0.03, 0.1);
group.add(water, rim);

const tree = new THREE.Group();
tree.position.set(-0.35, 0, -0.15);
group.add(tree);

const barkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.9 });
const vineMat = new THREE.MeshStandardMaterial({ color: 0x5a7d36, roughness: 0.6 });

const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.18, 1.2, 12), barkMat);
trunk.position.y = 0.6;
tree.add(trunk);

const limbCurves = [
  new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(0.25, 1.7, 0.2), new THREE.Vector3(0.65, 2.1, 0.45)]),
  new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(-0.3, 1.75, 0.15), new THREE.Vector3(-0.7, 2.05, 0.3)]),
  new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.05, 0), new THREE.Vector3(0.1, 1.8, -0.3), new THREE.Vector3(0.35, 2.2, -0.65)]),
  new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.1, 0), new THREE.Vector3(-0.2, 1.85, -0.25), new THREE.Vector3(-0.55, 2.15, -0.55)])
];

const vineTips = [];
limbCurves.forEach(curve => {
  const limbGeo = new THREE.TubeGeometry(curve, 20, 0.04, 8, false);
  tree.add(new THREE.Mesh(limbGeo, barkMat));
  for (let s = 0.4; s <= 1.0; s += 0.12) {
    vineTips.push(curve.getPoint(s));
  }
});

const vinesGroup = new THREE.Group();
const leafPositions = [];
vineTips.forEach((tip) => {
  const hangLength = 0.9 + Math.random() * 0.5;
  const spreadX = (Math.random() - 0.5) * 0.12;
  const spreadZ = (Math.random() - 0.5) * 0.12;
  const vCurve = new THREE.CatmullRomCurve3([
    tip,
    new THREE.Vector3(tip.x + spreadX * 0.5, tip.y - hangLength * 0.4, tip.z + spreadZ * 0.5),
    new THREE.Vector3(tip.x + spreadX, tip.y - hangLength, tip.z + spreadZ)
  ]);
  vinesGroup.add(new THREE.Mesh(new THREE.TubeGeometry(vCurve, 14, 0.004, 5, false), vineMat));

  for (let l = 0.15; l <= 0.95; l += 0.08) {
    leafPositions.push(vCurve.getPoint(l));
  }
});
tree.add(vinesGroup);

const leafGeo = new THREE.CylinderGeometry(0.002, 0.012, 0.06, 4);
const leafMat = new THREE.MeshStandardMaterial({ color: 0x76a035, roughness: 0.5, side: THREE.DoubleSide });
const leafCount = leafPositions.length;
const leafInst = new THREE.InstancedMesh(leafGeo, leafMat, leafCount);
const dummy = new THREE.Object3D();

leafPositions.forEach((pos, i) => {
  dummy.position.copy(pos);
  dummy.rotation.set(0.3 + (i % 5) * 0.1, i * 0.7, 0.5);
  dummy.updateMatrix();
  leafInst.setMatrixAt(i, dummy.matrix);
});
leafInst.instanceMatrix.needsUpdate = true;
tree.add(leafInst);

group.userData.xr = { grabbable: false, title: "Weeping Willow Pond" };

let windTime = 0;
scene.userData.update = (dt) => {
  windTime += dt * 1.6;
  vinesGroup.rotation.z = Math.sin(windTime) * 0.035;
  vinesGroup.rotation.x = Math.cos(windTime * 0.8) * 0.025;
};
