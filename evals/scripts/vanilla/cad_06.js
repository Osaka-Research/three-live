const ambientLight = new THREE.AmbientLight(0xddeeff, 0.6);
const dirLight = new THREE.DirectionalLight(0xfffaed, 1.2);
dirLight.position.set(3, 5, 2);
scene.add(ambientLight, dirLight);

const observatory = new THREE.Group();
observatory.position.set(0, 0, 0);

const concreteMat = new THREE.MeshStandardMaterial({ color: 0x9e9e9e, roughness: 0.85, metalness: 0.1 });
const trimMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, roughness: 0.5, metalness: 0.3 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

// Cylindrical concrete base (2.2m diam, 1.4m high)
const base = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.15, 1.4, 32), concreteMat);
base.position.y = 0.7;
observatory.add(base);

// Entry doorway
const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.95, 0.1), trimMat);
doorFrame.position.set(0, 0.475, 1.12);
const door = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.85, 0.1), darkMat);
door.position.set(0, 0.45, 1.14);
observatory.add(doorFrame, door);

// Rotatable hemispherical dome with shutter slit
const domeGroup = new THREE.Group();
domeGroup.position.set(0, 1.4, 0);

const ring = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, 0.1, 32), trimMat);
ring.position.y = 0.05;
domeGroup.add(ring);

const slitAngle = 0.22;
const domeMat = new THREE.MeshStandardMaterial({ color: 0xe0e4e8, roughness: 0.35, metalness: 0.25, side: THREE.DoubleSide });
const domeLeft = new THREE.Mesh(new THREE.SphereGeometry(1.08, 24, 16, slitAngle, Math.PI - slitAngle * 2, 0, Math.PI / 2), domeMat);
const domeRight = new THREE.Mesh(new THREE.SphereGeometry(1.08, 24, 16, Math.PI + slitAngle, Math.PI - slitAngle * 2, 0, Math.PI / 2), domeMat);
domeGroup.add(domeLeft, domeRight);

// Shutter rails
const railL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 2.2), trimMat);
railL.position.set(-0.25, 0.58, 0);
const railR = railL.clone();
railR.position.x = 0.25;
domeGroup.add(railL, railR);

// Brass refractor telescope peeking through slit
const telescope = new THREE.Group();
telescope.position.set(0, 0.4, 0);
telescope.rotation.x = -Math.PI / 5;
const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 1.5, 16), brassMat);
tube.position.z = 0.4;
tube.rotation.x = Math.PI / 2;
const dewCap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.3, 16), trimMat);
dewCap.position.z = 1.05;
dewCap.rotation.x = Math.PI / 2;
const lens = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 8, 0, Math.PI * 2, 0, 0.5), new THREE.MeshPhysicalMaterial({ color: 0x1a4570, roughness: 0.1, transmission: 0.85 }));
lens.position.z = 1.2;
lens.rotation.x = Math.PI / 2;
telescope.add(tube, dewCap, lens);
domeGroup.add(telescope);

observatory.add(domeGroup);
scene.add(observatory);

observatory.userData.xr = { grab: true, target: domeGroup };
function animate(dt) {
  domeGroup.rotation.y += dt * 0.12;
}
