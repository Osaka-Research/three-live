// org_17: Ruby-throated hummingbird hovering before a red hibiscus
const sceneGroup = new THREE.Group();
sceneGroup.position.set(0, 0.8, 0);
scene.add(sceneGroup);

// Materials
const iridescentGreen = new THREE.MeshPhysicalMaterial({
  color: 0x1d7334, roughness: 0.25, metalness: 0.65, clearcoat: 0.9, clearcoatRoughness: 0.1
});
const rubyGorget = new THREE.MeshPhysicalMaterial({
  color: 0xc40026, roughness: 0.15, metalness: 0.8, clearcoat: 1.0, emissive: 0x3d0008
});
const darkFeather = new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.6 });
const beakMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.4 });
const petalMat = new THREE.MeshPhysicalMaterial({ color: 0xd61830, roughness: 0.4, side: THREE.DoubleSide });

// Hummingbird
const bird = new THREE.Group();
bird.position.set(-0.12, 0.05, 0.08);
bird.rotation.set(0.3, 0.6, -0.2);

const body = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 18), iridescentGreen);
body.scale.set(0.7, 1.3, 0.75);
body.rotation.x = -0.55;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.024, 20, 16), iridescentGreen);
head.position.set(0, 0.055, 0.025);
const gorget = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), rubyGorget);
gorget.position.set(0, 0.045, 0.042);
gorget.scale.set(0.9, 1.1, 0.4);

const beak = new THREE.Mesh(new THREE.CylinderGeometry(0.001, 0.003, 0.08, 12), beakMat);
beak.position.set(0, 0.075, 0.075);
beak.rotation.x = 1.1;

const wingL = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 4), darkFeather);
wingL.scale.set(1, 1, 0.1);
wingL.position.set(0.045, 0.02, -0.01);
const wingR = wingL.clone();
wingR.position.x = -0.045;

const tail = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.09, 5), darkFeather);
tail.scale.set(1.4, 1, 0.08);
tail.position.set(0, -0.075, -0.045);
tail.rotation.x = -0.7;

bird.add(body, head, gorget, beak, wingL, wingR, tail);
sceneGroup.add(bird);

// Tropical Hibiscus Flower
const flower = new THREE.Group();
flower.position.set(0.12, -0.04, -0.05);
flower.rotation.set(-0.35, -0.6, 0.4);

for (let i = 0; i < 5; i++) {
  const angle = (i * Math.PI * 2) / 5;
  const petal = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 16, 1, true), petalMat);
  petal.rotation.z = 1.1;
  petal.rotation.y = angle;
  petal.scale.set(1, 1, 0.25);
  flower.add(petal);
}

// Protruding stamen column & golden anthers
const stamenCol = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.004, 0.17, 12), petalMat);
stamenCol.position.y = 0.08;
flower.add(stamenCol);
const antherMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, roughness: 0.4 });
for (let j = 0; j < 14; j++) {
  const anther = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 8), antherMat);
  anther.position.set((Math.random() - 0.5) * 0.018, 0.12 + j * 0.0035, (Math.random() - 0.5) * 0.018);
  flower.add(anther);
}
sceneGroup.add(flower);

// Lights & flapping animation
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xfff7e6, 1.4);
sun.position.set(2, 4, 3);
scene.add(sun);

let t = 0;
function animate(dt) {
  t += dt || 0.016;
  const flap = Math.sin(t * 65) * 0.85;
  wingL.rotation.set(flap, 0.3, 0.9);
  wingR.rotation.set(-flap, -0.3, -0.9);
  bird.position.y = 0.05 + Math.sin(t * 5) * 0.015;
  bird.position.x = -0.12 + Math.cos(t * 3) * 0.008;
}
animate(0);
