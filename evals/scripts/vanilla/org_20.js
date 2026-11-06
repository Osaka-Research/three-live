// org_20: Monumental gallery sculpture with continuous Möbius / trefoil bronze ribbon
const galleryGroup = new THREE.Group();
galleryGroup.position.set(0, 0.8, 0);
scene.add(galleryGroup);

// Dark granite pedestal plinth
const graniteMat = new THREE.MeshPhysicalMaterial({
  color: 0x18191c, roughness: 0.15, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.15
});
const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.5), graniteMat);
plinth.position.y = -0.475;
galleryGroup.add(plinth);

// Sub-plinth brass reveal accent
const accentMat = new THREE.MeshStandardMaterial({ color: 0x8b6528, metalness: 0.9, roughness: 0.2 });
const collar = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.025, 0.44), accentMat);
collar.position.y = -0.14;
galleryGroup.add(collar);

// Warm brushed-bronze metallic ribbon sculpture
const bronzeMat = new THREE.MeshPhysicalMaterial({
  color: 0xbf7a3f,
  metalness: 0.88,
  roughness: 0.26,
  clearcoat: 0.35,
  clearcoatRoughness: 0.2,
  reflectivity: 0.85
});

// Continuous twisted trefoil / Möbius ribbon knot
const knotGeo = new THREE.TorusKnotGeometry(0.32, 0.065, 180, 24, 2, 3);
knotGeo.computeVertexNormals();
const sculpture = new THREE.Mesh(knotGeo, bronzeMat);
sculpture.position.y = 0.28;
sculpture.scale.set(0.9, 1.15, 0.9);
sculpture.castShadow = true;
galleryGroup.add(sculpture);

// Studio gallery illumination
scene.add(new THREE.AmbientLight(0xfff7ee, 0.45));

const keyLight = new THREE.DirectionalLight(0xffedd4, 1.8);
keyLight.position.set(3, 4, 3);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x88bbff, 1.0);
rimLight.position.set(-3, 2, -3);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xffe8cc, 0.6, 6);
fillLight.position.set(0, -0.1, 2);
scene.add(fillLight);

// Graceful turntable rotation
function animate(dt) {
  const delta = dt || 0.016;
  sculpture.rotation.y += delta * 0.25;
  sculpture.rotation.x = Math.sin(sculpture.rotation.y * 0.5) * 0.08;
}
animate(0);
