// org_16: Anatomical human heart model on display stand
const heartGroup = new THREE.Group();
heartGroup.position.set(0, 0.8, 0);
scene.add(heartGroup);

// Stand: polished base and chrome mounting rod
const standMat = new THREE.MeshStandardMaterial({ color: 0x222225, metalness: 0.8, roughness: 0.2 });
const rodMat = new THREE.MeshStandardMaterial({ color: 0xdddddf, metalness: 0.95, roughness: 0.1 });
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.025, 32), standMat);
base.position.y = -0.42;
const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 16), rodMat);
rod.position.y = -0.2;
heartGroup.add(base, rod);

// Ventricles & Atria muscle bodies
const muscleMat = new THREE.MeshStandardMaterial({ color: 0x931b26, roughness: 0.55, metalness: 0.1 });
const atriumMat = new THREE.MeshStandardMaterial({ color: 0x6e1b30, roughness: 0.6, metalness: 0.1 });

const ventricles = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 24), muscleMat);
ventricles.scale.set(0.9, 1.35, 0.85);
ventricles.rotation.z = -0.22;
heartGroup.add(ventricles);

const rightAtrium = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 20), atriumMat);
rightAtrium.position.set(-0.08, 0.11, 0.02);
const leftAtrium = new THREE.Mesh(new THREE.SphereGeometry(0.058, 24, 20), atriumMat);
leftAtrium.position.set(0.07, 0.12, -0.02);
heartGroup.add(rightAtrium, leftAtrium);

// Aorta arch with 3 superior branches
const aortaMat = new THREE.MeshStandardMaterial({ color: 0xd92525, roughness: 0.4, metalness: 0.15 });
const aortaCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.01, 0.06, 0.02),
  new THREE.Vector3(0.02, 0.18, 0.01),
  new THREE.Vector3(-0.04, 0.23, -0.01),
  new THREE.Vector3(-0.09, 0.15, -0.04),
  new THREE.Vector3(-0.08, 0.02, -0.05)
]);
const aortaMesh = new THREE.Mesh(new THREE.TubeGeometry(aortaCurve, 32, 0.028, 16, false), aortaMat);
heartGroup.add(aortaMesh);

[new THREE.Vector3(-0.01, 0.22, 0.01), new THREE.Vector3(-0.04, 0.23, 0), new THREE.Vector3(-0.07, 0.21, -0.02)].forEach((pos, i) => {
  const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.008, 0.055, 12), aortaMat);
  branch.position.copy(pos).add(new THREE.Vector3(0, 0.028, 0));
  branch.rotation.set(-0.1, 0, (i - 1) * 0.2);
  heartGroup.add(branch);
});

// Vena Cava (superior & inferior)
const venaMat = new THREE.MeshStandardMaterial({ color: 0x1f5fa8, roughness: 0.4, metalness: 0.15 });
const venaCava = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 16), venaMat);
venaCava.position.set(-0.095, 0.12, 0.03);
heartGroup.add(venaCava);

// Branching coronary arteries
const coronaryMat = new THREE.MeshStandardMaterial({ color: 0xef3333, roughness: 0.3 });
const art1 = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.01, 0.08, 0.1),
  new THREE.Vector3(0.01, -0.02, 0.105),
  new THREE.Vector3(0.03, -0.1, 0.07)
]), 20, 0.005, 8, false), coronaryMat);
heartGroup.add(art1);

// Lights & heartbeat pulse animation
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 3, 2);
scene.add(new THREE.AmbientLight(0xffffff, 0.6), dirLight);

let elapsed = 0;
function animate(dt) {
  elapsed += dt || 0.016;
  const beat = Math.pow(Math.sin(elapsed * 4.5), 63) * 0.06;
  ventricles.scale.set(0.9 + beat, 1.35 + beat * 0.8, 0.85 + beat);
  heartGroup.rotation.y = Math.sin(elapsed * 0.5) * 0.25;
}
animate(0);
