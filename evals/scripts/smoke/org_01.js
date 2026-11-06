// Twisted Biomorphic Vase using Vanilla Three.js LatheGeometry + DoubleSide (Triggers Silent Drop + BoxGeometry Fallback!)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
keyLight.position.set(2, 4, 3);
scene.add(keyLight);

// Vanilla Three.js muscle memory: LatheGeometry + DoubleSide
const points = [];
for (let i = 0; i <= 10; i++) {
  const t = i / 10;
  points.push(new THREE.Vector2(0.15 + 0.12 * Math.sin(t * Math.PI), t * 0.6));
}
const latheGeo = new THREE.LatheGeometry(points, 32);
const ceramicMat = new THREE.MeshPhysicalMaterial({
  color: 0xf1f5f9,
  roughness: 0.15,
  clearcoat: 1.0,
  side: THREE.DoubleSide,
});
const vase = new THREE.Mesh(latheGeo, ceramicMat);
vase.name = 'ceramic_vase';
vase.position.y = 0.3;
scene.add(vase);

camera.position.set(0, 0.8, 2.2);
camera.lookAt(0, 0.3, 0);
