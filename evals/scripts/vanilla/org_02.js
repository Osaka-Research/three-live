// Gnarled juniper bonsai tree (~0.55m tall) in glazed stoneware pot
const bonsai = new THREE.Group();

// Glazed rectangular stoneware pot & moss soil
const potMat = new THREE.MeshStandardMaterial({ color: 0x2b3839, roughness: 0.25, metalness: 0.15 });
const potGeo = new THREE.BoxGeometry(0.32, 0.07, 0.22);
const pot = new THREE.Mesh(potGeo, potMat);
pot.position.y = 0.035;
bonsai.add(pot);

const soilMat = new THREE.MeshStandardMaterial({ color: 0x3d4b26, roughness: 0.95 });
const soilGeo = new THREE.SphereGeometry(0.12, 16, 12);
soilGeo.scale(1.2, 0.25, 0.8);
const soil = new THREE.Mesh(soilGeo, soilMat);
soil.position.set(0, 0.07, 0);
bonsai.add(soil);

// Gnarled twisted trunk and branches using CatmullRomCurve3 & TubeGeometry
const woodMat = new THREE.MeshStandardMaterial({ color: 0x4a3525, roughness: 0.85 });
const trunkPoints = [
  new THREE.Vector3(0.01, 0.07, 0),
  new THREE.Vector3(0.05, 0.16, 0.02),
  new THREE.Vector3(-0.04, 0.26, -0.01),
  new THREE.Vector3(0.03, 0.36, 0.02),
  new THREE.Vector3(-0.02, 0.44, 0)
];
const trunkCurve = new THREE.CatmullRomCurve3(trunkPoints);
const trunkGeo = new THREE.TubeGeometry(trunkCurve, 32, 0.022, 10, false);
bonsai.add(new THREE.Mesh(trunkGeo, woodMat));

const branch1Curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.01, 0.28, 0.01),
  new THREE.Vector3(0.12, 0.33, 0.05),
  new THREE.Vector3(0.18, 0.38, 0.02)
]);
const branch2Curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.02, 0.37, 0.01),
  new THREE.Vector3(-0.13, 0.41, -0.04),
  new THREE.Vector3(-0.19, 0.45, -0.02)
]);
bonsai.add(new THREE.Mesh(new THREE.TubeGeometry(branch1Curve, 16, 0.012, 8, false), woodMat));
bonsai.add(new THREE.Mesh(new THREE.TubeGeometry(branch2Curve, 16, 0.011, 8, false), woodMat));

// Foliage pads using ConeGeometry and InstancedMesh
const needleGeo = new THREE.ConeGeometry(0.025, 0.05, 5);
const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1e4722, roughness: 0.7 });
const padCount = 60;
const foliageMesh = new THREE.InstancedMesh(needleGeo, foliageMat, padCount);

const dummy = new THREE.Object3D();
const padCenters = [
  new THREE.Vector3(-0.02, 0.48, 0),
  new THREE.Vector3(0.18, 0.39, 0.02),
  new THREE.Vector3(-0.19, 0.46, -0.02)
];
let idx = 0;
padCenters.forEach((center) => {
  for (let i = 0; i < 20; i++) {
    const r = 0.07 * Math.sqrt(Math.random());
    const theta = Math.random() * Math.PI * 2;
    dummy.position.set(center.x + r * Math.cos(theta), center.y + (Math.random() - 0.5) * 0.03, center.z + r * Math.sin(theta));
    dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    dummy.scale.setScalar(0.7 + Math.random() * 0.5);
    dummy.updateMatrix();
    foliageMesh.setMatrixAt(idx++, dummy.matrix);
  }
});
foliageMesh.instanceMatrix.needsUpdate = true;
bonsai.add(foliageMesh);

// Lighting
const amb = new THREE.AmbientLight(0xddeeff, 0.6);
const dir = new THREE.DirectionalLight(0xfff8ee, 1.4);
dir.position.set(2, 3, 1.5);
bonsai.add(amb, dir);

scene.add(bonsai);
