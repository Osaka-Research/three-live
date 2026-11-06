const galaxy = new THREE.Group();
galaxy.position.set(0, 0.8, 0);
scene.add(galaxy);

const ambLight = new THREE.AmbientLight(0x222233, 0.5);
const coreLight = new THREE.PointLight(0xffaa44, 3, 3.5);
galaxy.add(ambLight, coreLight);

// Glowing galactic core
const coreGeo = new THREE.SphereGeometry(0.18, 24, 24);
const coreMat = new THREE.MeshBasicMaterial({ color: 0xffd27d, transparent: true, opacity: 0.9 });
const coreMesh = new THREE.Mesh(coreGeo, coreMat);
galaxy.add(coreMesh);

// 3,000 instanced stars along 4 spiral arms
const starCount = 3000;
const starGeo = new THREE.SphereGeometry(0.012, 6, 6);
const starMat = new THREE.MeshBasicMaterial();
const starMesh = new THREE.InstancedMesh(starGeo, starMat, starCount);
galaxy.add(starMesh);

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const hotBlue = new THREE.Color(0xa0c8ff);
const coolOrange = new THREE.Color(0xff6622);
const darkDust = new THREE.Color(0x1a0f08);

for (let i = 0; i < starCount; i++) {
  const arm = i % 4;
  const isDust = i % 6 === 0;
  const t = Math.random();
  const r = 0.15 + t * 1.35; // Radius up to 1.5m (~3.0m diameter)
  const spiralAngle = arm * (Math.PI / 2) + Math.log(r * 2 + 1) * 2.8;
  const spread = (Math.random() - 0.5) * 0.18 * r;
  const z = (Math.random() - 0.5) * (0.08 * (1.5 - r * 0.6));

  const x = Math.cos(spiralAngle + (isDust ? 0.2 : 0)) * r + spread;
  const y = Math.sin(spiralAngle + (isDust ? 0.2 : 0)) * r + spread;

  dummy.position.set(x, z, y);
  const s = (Math.random() * 0.8 + 0.4) * (isDust ? 1.5 : 1.0);
  dummy.scale.set(s, s, s);
  dummy.updateMatrix();
  starMesh.setMatrixAt(i, dummy.matrix);

  if (isDust) {
    color.copy(darkDust);
  } else {
    color.copy(t < 0.25 ? coolOrange : hotBlue).lerp(coolOrange, (1 - t) * 0.5);
  }
  starMesh.setColorAt(i, color);
}
starMesh.instanceMatrix.needsUpdate = true;
if (starMesh.instanceColor) starMesh.instanceColor.needsUpdate = true;

galaxy.rotation.x = 0.6;

function animate(dt = 0.016) {
  galaxy.rotation.y += dt * 0.15;
}
scene.userData.animate = animate;
