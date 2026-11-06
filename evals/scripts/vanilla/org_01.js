// Classical Greek terracotta amphora vase (~0.6m tall)
const group = new THREE.Group();

// Lathe profile for amphora foot, belly, neck, and lip
const points = [];
points.push(new THREE.Vector2(0.00, 0.00));
points.push(new THREE.Vector2(0.09, 0.00));
points.push(new THREE.Vector2(0.08, 0.04));
points.push(new THREE.Vector2(0.05, 0.08));
points.push(new THREE.Vector2(0.12, 0.18));
points.push(new THREE.Vector2(0.18, 0.28));
points.push(new THREE.Vector2(0.16, 0.38));
points.push(new THREE.Vector2(0.08, 0.44));
points.push(new THREE.Vector2(0.065, 0.52));
points.push(new THREE.Vector2(0.08, 0.58));
points.push(new THREE.Vector2(0.075, 0.60));
points.push(new THREE.Vector2(0.055, 0.60));
points.push(new THREE.Vector2(0.05, 0.52));
points.push(new THREE.Vector2(0.00, 0.50));

const latheGeo = new THREE.LatheGeometry(points, 36);
const terraMat = new THREE.MeshStandardMaterial({
  color: 0xc45e2e,
  roughness: 0.72,
  metalness: 0.08
});
const bodyMesh = new THREE.Mesh(latheGeo, terraMat);
group.add(bodyMesh);

// Rolled lip rim using TorusGeometry
const rimGeo = new THREE.TorusGeometry(0.075, 0.012, 16, 36);
rimGeo.rotateX(Math.PI / 2);
rimGeo.translate(0, 0.60, 0);
const rimMesh = new THREE.Mesh(rimGeo, terraMat);
group.add(rimMesh);

// Twin arched handles using CatmullRomCurve3 & TubeGeometry
const handlePoints = [
  new THREE.Vector3(0.155, 0.36, 0),
  new THREE.Vector3(0.205, 0.44, 0),
  new THREE.Vector3(0.185, 0.53, 0),
  new THREE.Vector3(0.072, 0.54, 0)
];
const handleCurve = new THREE.CatmullRomCurve3(handlePoints);
const handleGeo = new THREE.TubeGeometry(handleCurve, 24, 0.012, 12, false);

const handleLeft = new THREE.Mesh(handleGeo, terraMat);
const handleRight = handleLeft.clone();
handleRight.scale.set(-1, 1, 1);
group.add(handleLeft, handleRight);

// Lighting & Scene setup
const ambientLight = new THREE.AmbientLight(0xffeedd, 0.7);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1.5, 3, 2);
group.add(ambientLight, dirLight);

group.position.set(0, 0, 0);
scene.add(group);

function animate(dt) {
  group.rotation.y += 0.3 * dt;
}
