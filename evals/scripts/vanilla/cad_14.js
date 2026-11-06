const subGroup = new THREE.Group();
subGroup.position.set(0, 0.8, 0);
scene.add(subGroup);

const yellowHullMat = new THREE.MeshPhysicalMaterial({ color: 0xf59e0b, roughness: 0.35, metalness: 0.2, clearcoat: 0.4 });
const acrylicGlassMat = new THREE.MeshPhysicalMaterial({ color: 0xdff6ff, transmission: 0.92, roughness: 0.05, opacity: 1, transparent: true, ior: 1.49 });
const bronzeMat = new THREE.MeshStandardMaterial({ color: 0xcd7f32, roughness: 0.3, metalness: 0.85 });
const darkMetalMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.5, metalness: 0.7 });

// Streamlined pressure hull (~2.2m total length)
const hullMidGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.2, 32);
const hullMid = new THREE.Mesh(hullMidGeo, yellowHullMat);
hullMid.rotation.z = Math.PI / 2;
subGroup.add(hullMid);

// Stern tapered cone tail
const sternConeGeo = new THREE.ConeGeometry(0.42, 0.6, 32);
const sternCone = new THREE.Mesh(sternConeGeo, yellowHullMat);
sternCone.rotation.z = -Math.PI / 2;
sternCone.position.set(-0.9, 0, 0);
subGroup.add(sternCone);

// Hemispherical bow acrylic viewport
const viewportGeo = new THREE.SphereGeometry(0.42, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const viewport = new THREE.Mesh(viewportGeo, acrylicGlassMat);
viewport.rotation.z = -Math.PI / 2;
viewport.position.set(0.6, 0, 0);
subGroup.add(viewport);

// Conning tower sail & dive planes
const sailGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.35, 24);
const sail = new THREE.Mesh(sailGeo, yellowHullMat);
sail.position.set(0.1, 0.52, 0);
sail.scale.set(1.4, 1.0, 0.6);
subGroup.add(sail);

const planeGeo = new THREE.BoxGeometry(0.2, 0.02, 0.65);
const divePlanes = new THREE.Mesh(planeGeo, darkMetalMat);
divePlanes.position.set(0.1, 0.55, 0);
subGroup.add(divePlanes);

// Port and Starboard thruster pods
[-0.48, 0.48].forEach(zPos => {
  const podShroudGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.3, 24, 1, true);
  const podShroud = new THREE.Mesh(podShroudGeo, darkMetalMat);
  podShroud.rotation.z = Math.PI / 2;
  podShroud.position.set(-0.2, -0.15, zPos);
  subGroup.add(podShroud);

  const pylonGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.16, 12);
  const pylon = new THREE.Mesh(pylonGeo, darkMetalMat);
  pylon.position.set(-0.2, -0.07, zPos * 0.7);
  pylon.rotation.x = zPos > 0 ? -0.4 : 0.4;
  subGroup.add(pylon);
});

// Skewed 7-blade bronze stern propeller
const propHubGeo = new THREE.ConeGeometry(0.07, 0.16, 16);
const propHub = new THREE.Mesh(propHubGeo, bronzeMat);
propHub.rotation.z = -Math.PI / 2;
propHub.position.set(-1.24, 0, 0);
subGroup.add(propHub);

const bladeGeo = new THREE.ConeGeometry(0.04, 0.18, 12);
bladeGeo.scale(0.3, 1.0, 1.0);
for (let i = 0; i < 7; i++) {
  const angle = (i * Math.PI * 2) / 7;
  const blade = new THREE.Mesh(bladeGeo, bronzeMat);
  blade.position.set(-1.21, Math.cos(angle) * 0.1, Math.sin(angle) * 0.1);
  blade.rotation.x = angle + 0.35;
  blade.rotation.z = -Math.PI / 2;
  subGroup.add(blade);
}

// Lighting
const sun = new THREE.DirectionalLight(0xfff8ee, 2.0);
sun.position.set(3, 4, 2);
scene.add(sun);
const oceanLight = new THREE.AmbientLight(0x1a4060, 1.5);
scene.add(oceanLight);

subGroup.userData.xr = { grab: true };
scene.userData.interactivity = (dt) => {
  subGroup.rotation.y += dt * 0.15;
};
