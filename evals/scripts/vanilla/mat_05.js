// mat_05: Cyberpunk neon noodle sign (~1.6m tall) on corrugated metal backing
const signGroup = new THREE.Group();
signGroup.position.set(0, 0.8, 0);
scene.add(signGroup);

// Rain-slicked dark corrugated metal grid backing
const backplateMat = new THREE.MeshStandardMaterial({
  color: 0x0f1318,
  metalness: 0.85,
  roughness: 0.12
});
const backplate = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 0.04), backplateMat);
backplate.position.z = -0.05;
signGroup.add(backplate);

// Corrugation ridges
for (let i = -7; i <= 7; i++) {
  const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.56, 12), backplateMat);
  rib.position.set(i * 0.08, 0, -0.025);
  signGroup.add(rib);
}

// Steel mounting brackets
const steelMat = new THREE.MeshStandardMaterial({ color: 0x222830, metalness: 0.9, roughness: 0.4 });
const bracketL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.22), steelMat);
bracketL.position.set(-0.55, 0.65, -0.16);
const bracketR = bracketL.clone();
bracketR.position.x = 0.55;
signGroup.add(bracketL, bracketR);

// Neon tube materials
const neonMagentaMat = new THREE.MeshStandardMaterial({
  color: 0xff0066,
  emissive: 0xff0066,
  emissiveIntensity: 3.5,
  roughness: 0.1
});
const neonCyanMat = new THREE.MeshStandardMaterial({
  color: 0x00f7ff,
  emissive: 0x00f7ff,
  emissiveIntensity: 3.5,
  roughness: 0.1
});
const neonYellowMat = new THREE.MeshStandardMaterial({
  color: 0xffc400,
  emissive: 0xffc400,
  emissiveIntensity: 3.0,
  roughness: 0.1
});

// Steaming noodle bowl icon (bent neon tubes)
// Bowl rim and bottom
const bowlRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.014, 16, 32, Math.PI), neonCyanMat);
bowlRim.rotation.z = Math.PI;
bowlRim.position.set(0, -0.05, 0.02);
signGroup.add(bowlRim);

const bowlBase = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 16, 24, Math.PI), neonCyanMat);
bowlBase.rotation.z = Math.PI;
bowlBase.position.set(0, -0.22, 0.02);
signGroup.add(bowlBase);

// Bent steaming trails (wavy S-curves)
const steamCurve1 = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.08, 0.0, 0.02),
  new THREE.Vector3(-0.04, 0.14, 0.02),
  new THREE.Vector3(-0.09, 0.28, 0.02),
  new THREE.Vector3(-0.05, 0.42, 0.02)
]);
const steamCurve2 = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.06, 0.02, 0.02),
  new THREE.Vector3(0.11, 0.16, 0.02),
  new THREE.Vector3(0.05, 0.30, 0.02),
  new THREE.Vector3(0.09, 0.45, 0.02)
]);
signGroup.add(new THREE.Mesh(new THREE.TubeGeometry(steamCurve1, 32, 0.01, 12, false), neonYellowMat));
signGroup.add(new THREE.Mesh(new THREE.TubeGeometry(steamCurve2, 32, 0.01, 12, false), neonYellowMat));

// Chopsticks / noodles header in magenta
const stickGeo = new THREE.CylinderGeometry(0.01, 0.007, 0.55, 16);
const stick1 = new THREE.Mesh(stickGeo, neonMagentaMat);
stick1.rotation.z = 1.15;
stick1.position.set(0.08, 0.05, 0.04);
signGroup.add(stick1);

// Underline neon bar
const bottomBar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.85, 16), neonMagentaMat);
bottomBar.rotation.z = Math.PI / 2;
bottomBar.position.set(0, -0.55, 0.02);
signGroup.add(bottomBar);

// Colored point lights casting neon glow onto rain-slicked surface
const glowMagenta = new THREE.PointLight(0xff0066, 4.5, 1.8);
glowMagenta.position.set(0, -0.4, 0.15);
signGroup.add(glowMagenta);

const glowCyan = new THREE.PointLight(0x00f7ff, 4.5, 1.8);
glowCyan.position.set(0, 0.1, 0.15);
signGroup.add(glowCyan);

scene.add(new THREE.AmbientLight(0x0a1018, 0.6));
const streetLight = new THREE.DirectionalLight(0x223355, 0.8);
streetLight.position.set(2.0, 3.0, 2.0);
scene.add(streetLight);

// Neon flicker & subtle sign sway animation
let time = 0;
scene.userData.animate = (dt) => {
  time += dt;
  signGroup.rotation.y = Math.sin(time * 0.8) * 0.08;
  const flicker = Math.random() > 0.96 ? 0.4 : 1.0;
  glowMagenta.intensity = 4.5 * flicker;
};
