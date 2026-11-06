// Bonsai Tree using Vanilla CatmullRomCurve3 + TubeGeometry + IcosahedronGeometry
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xfffbeb, 1.3);
sun.position.set(2, 5, 3);
scene.add(sun);

const pot = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.14, 0.36),
  new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.7 })
);
pot.name = 'ceramic_pot';
pot.position.y = 0.07;
scene.add(pot);

// Vanilla Three.js muscle memory: CatmullRomCurve3 + TubeGeometry
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0.14, 0),
  new THREE.Vector3(0.08, 0.32, 0.04),
  new THREE.Vector3(-0.06, 0.5, -0.02),
  new THREE.Vector3(0.05, 0.68, 0.03),
]);
const trunkGeo = new THREE.TubeGeometry(curve, 20, 0.04, 8, false);
const trunk = new THREE.Mesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.85 }));
trunk.name = 'bonsai_trunk';
 trunk.position.y = 0.35;
scene.add(trunk);

const canopy = new THREE.Mesh(
  new THREE.IcosahedronGeometry(0.24, 1),
  new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 })
);
canopy.name = 'foliage_pad';
canopy.scale.set(1.3, 0.45, 1.1);
canopy.position.set(0.05, 0.72, 0.03);
scene.add(canopy);

camera.position.set(0, 0.7, 1.8);
camera.lookAt(0, 0.4, 0);
