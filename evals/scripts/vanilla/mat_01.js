// mat_01: Jewelry showcase with brilliant diamond and optical prism
const group = new THREE.Group();
group.position.set(0, 0.8, 0);
scene.add(group);

// Black velvet pedestal
const pedestalMat = new THREE.MeshPhysicalMaterial({
  color: 0x080808,
  roughness: 0.92,
  metalness: 0.05,
  sheen: 1.0,
  sheenColor: new THREE.Color(0x222222),
  sheenRoughness: 0.8
});
const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 48), pedestalMat);
pedestal.position.y = -0.25;
group.add(pedestal);

// Brilliant-cut diamond geometry (faceted crown + pavilion)
const diamondCrownGeo = new THREE.CylinderGeometry(0.06, 0.11, 0.05, 16, 1, false);
const diamondPavilionGeo = new THREE.ConeGeometry(0.11, 0.12, 16, 1, false);
diamondPavilionGeo.rotateX(Math.PI);
diamondPavilionGeo.translate(0, -0.06, 0);

const diamondMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  transmission: 1.0,
  opacity: 1.0,
  transparent: true,
  roughness: 0.0,
  ior: 2.417,
  dispersion: 0.044,
  thickness: 0.15,
  specularIntensity: 1.0,
  clearcoat: 1.0,
  flatShading: true
});

const diamond = new THREE.Group();
diamond.add(new THREE.Mesh(diamondCrownGeo, diamondMat));
diamond.add(new THREE.Mesh(diamondPavilionGeo, diamondMat));
diamond.position.set(-0.12, 0.08, 0);
diamond.rotation.set(0.15, 0.4, 0.1);
group.add(diamond);

// Optical triangular glass prism
const prismGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.22, 3, 1, false);
prismGeo.rotateY(Math.PI / 6);
const prismMat = new THREE.MeshPhysicalMaterial({
  color: 0xfafcff,
  transmission: 0.98,
  transparent: true,
  roughness: 0.02,
  ior: 1.52,
  dispersion: 0.032,
  thickness: 0.2,
  attenuationDistance: 0.6,
  attenuationColor: new THREE.Color(0xddeeff)
});
const prism = new THREE.Mesh(prismGeo, prismMat);
prism.position.set(0.15, 0.11, -0.02);
prism.rotation.set(0, 0.6, 0);
group.add(prism);

// Lighting: 3 colored key/rim lights + ambient & directional
scene.add(new THREE.AmbientLight(0x1a1a24, 0.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(1.2, 2.5, 1.8);
scene.add(keyLight);

const rimCyan = new THREE.PointLight(0x00e5ff, 4.0, 3.0);
rimCyan.position.set(-0.6, 1.2, -0.4);
scene.add(rimCyan);

const rimMagenta = new THREE.PointLight(0xff007f, 4.5, 3.0);
rimMagenta.position.set(0.7, 1.1, -0.5);
scene.add(rimMagenta);

const keyAmber = new THREE.PointLight(0xffaa33, 3.5, 3.0);
keyAmber.position.set(0.0, 1.6, 0.9);
scene.add(keyAmber);

scene.userData.animate = (dt) => {
  diamond.rotation.y += dt * 0.4;
  prism.rotation.y -= dt * 0.25;
};
