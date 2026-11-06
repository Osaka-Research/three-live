const ambientLight = new THREE.AmbientLight(0xfff3e8, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
dirLight.position.set(2, 4, 3);
scene.add(ambientLight, dirLight);

// Rug snapped to floor
const rugMat = new THREE.MeshStandardMaterial({ color: 0xd9ceb2, roughness: 0.9 });
const rug = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.01, 2.0), rugMat);
rug.position.set(0, 0.005, 0);
rug.userData.xr = { anchor: { target: 'floor', persist: true }, handles: { rotateAxis: 'y' } };
scene.add(rug);

// Modern L-shaped Sectional Sofa
const sofa = new THREE.Group();
sofa.position.set(-0.2, 0, 0);
sofa.userData.xr = { anchor: { target: 'floor', persist: true }, handles: { rotateAxis: 'y' } };

const fabricMat = new THREE.MeshStandardMaterial({ color: 0x48525e, roughness: 0.75 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x3d2716, roughness: 0.5 });

// Main bench
const mainBase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.7), fabricMat);
mainBase.position.set(0, 0.21, 0);
const mainBack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.36, 0.16), fabricMat);
mainBack.position.set(0, 0.48, -0.27);

// L-chaise extension
const chaise = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.8), fabricMat);
chaise.position.set(0.35, 0.21, 0.65);

// Cushions & Legs
const cushion1 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.55), fabricMat);
cushion1.position.set(-0.32, 0.38, 0.02);
const cushion2 = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.55), fabricMat);
cushion2.position.set(0.35, 0.38, 0.02);

for (const x of [-0.65, 0.65]) {
  for (const z of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.015, 0.1, 12), woodMat);
    leg.position.set(x, 0.05, z);
    sofa.add(leg);
  }
}
sofa.add(mainBase, mainBack, chaise, cushion1, cushion2);
scene.add(sofa);

// Framed abstract painting anchored to wall
const painting = new THREE.Group();
painting.position.set(0, 1.45, -1.2);
const frame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.8, 0.03), woodMat);
const canvas = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.72, 0.035), new THREE.MeshStandardMaterial({ color: 0x8a7356, roughness: 0.6 }));
painting.add(frame, canvas);
painting.userData.xr = { anchor: 'wall', persist: true };
scene.add(painting);

// Floor lamp with toggleable warm point light
const lamp = new THREE.Group();
lamp.position.set(0.85, 0, -0.4);
const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.02, 24), woodMat);
const lampPole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.35, 16), new THREE.MeshStandardMaterial({ color: 0x1f1f1f, metalness: 0.8 }));
lampPole.position.y = 0.68;
const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.22, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xfffaea, roughness: 0.3, side: THREE.DoubleSide }));
shade.position.y = 1.35;
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffdd88 }));
bulb.position.y = 1.35;

const lampLight = new THREE.PointLight(0xffb355, 2.0, 4.0, 1.5);
lampLight.position.set(0, 1.35, 0);
lamp.add(lampBase, lampPole, shade, bulb, lampLight);

lamp.userData.xr = { interactive: true, toggleLighting: true };
lamp.userData.interactivity = {
  toggle: () => {
    lampLight.intensity = lampLight.intensity > 0 ? 0 : 2.0;
    bulb.material.color.setHex(lampLight.intensity > 0 ? 0xffdd88 : 0x444444);
  }
};
scene.add(lamp);
