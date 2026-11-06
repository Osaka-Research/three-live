const lampGroup = new THREE.Group();
lampGroup.position.set(0, 0.5, 0);
scene.add(lampGroup);

const ambient = new THREE.AmbientLight(0x221a15, 1.2);
const fillLight = new THREE.DirectionalLight(0xffeedd, 0.6);
fillLight.position.set(1.5, 2.5, 2);
scene.add(ambient, fillLight);

// Materials
const bronzeMat = new THREE.MeshPhysicalMaterial({ color: 0x3a2b1c, roughness: 0.6, metalness: 0.82, clearcoat: 0.25 });
const leadMat = new THREE.MeshPhysicalMaterial({ color: 0x1a1a1c, roughness: 0.75, metalness: 0.35 });
const amberGlass = new THREE.MeshPhysicalMaterial({ color: 0xe08f28, transmission: 0.82, roughness: 0.2, ior: 1.52, thickness: 0.02, side: THREE.DoubleSide });
const emeraldGlass = new THREE.MeshPhysicalMaterial({ color: 0x0f8f4a, transmission: 0.8, roughness: 0.2, ior: 1.52, thickness: 0.02, side: THREE.DoubleSide });
const cobaltGlass = new THREE.MeshPhysicalMaterial({ color: 0x1a45b8, transmission: 0.82, roughness: 0.2, ior: 1.52, thickness: 0.02, side: THREE.DoubleSide });

// Art Nouveau tree-trunk patinated bronze base
const roots = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.07, 24), bronzeMat);
roots.position.y = 0.035;
lampGroup.add(roots);

const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.055, 0.36, 16), bronzeMat);
trunk.position.y = 0.23;
lampGroup.add(trunk);

const capital = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.06, 16), bronzeMat);
capital.rotation.x = Math.PI;
capital.position.y = 0.42;
lampGroup.add(capital);

// Interior bulb & glowing point light
const bulbMat = new THREE.MeshPhysicalMaterial({ color: 0xfff0d0, emissive: 0xffa033, emissiveIntensity: 3.0 });
const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 16), bulbMat);
bulb.position.y = 0.45;
lampGroup.add(bulb);

const lampLight = new THREE.PointLight(0xff9933, 4.0, 3.0, 1.2);
lampLight.position.set(0, 0.95, 0);
scene.add(lampLight);

// Tiffany Stained Glass Dome Shade (~0.46m diameter)
const shadeGroup = new THREE.Group();
shadeGroup.position.y = 0.46;
lampGroup.add(shadeGroup);

const dome = new THREE.Mesh(new THREE.SphereGeometry(0.23, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45), amberGlass);
shadeGroup.add(dome);

const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.06, 32, 1, true), emeraldGlass);
skirt.position.y = -0.07;
shadeGroup.add(skirt);

// 6 Dragonfly motifs radiating around perimeter
for (let i = 0; i < 6; i++) {
  const angle = (i * Math.PI * 2) / 6;
  const dfGroup = new THREE.Group();
  dfGroup.rotation.y = angle;

  const wing = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 12), cobaltGlass);
  wing.rotation.z = Math.PI / 2.8;
  wing.position.set(0.21, -0.05, 0);
  dfGroup.add(wing);

  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 12), cobaltGlass);
  eye.position.set(0.225, -0.09, 0);
  dfGroup.add(eye);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.12, 8), leadMat);
  body.position.set(0.22, -0.06, 0);
  dfGroup.add(body);

  shadeGroup.add(dfGroup);
}

lampGroup.userData.xr = { grab: true };
function animate(dt = 0.016) {
  lampLight.intensity = 3.8 + Math.sin(Date.now() * 0.005) * 0.2;
}
