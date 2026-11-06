const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xaaccff, 1.2);
dirLight.position.set(1, 2.5, 2);
scene.add(ambientLight, dirLight);

// Floating medical inspection rig
const rig = new THREE.Group();
rig.position.set(0, 0.8, 0);
rig.userData.xr = { follow: { mode: 'head', lazy: true, distance: 1.4 } };

// Anatomical materials
const boneMat = new THREE.MeshStandardMaterial({ color: 0xe6e0d0, roughness: 0.45 });
const lungMatRight = new THREE.MeshStandardMaterial({ color: 0xd46868, roughness: 0.4, transparent: true, opacity: 0.9 });
const lungMatLeft = new THREE.MeshStandardMaterial({ color: 0xc85959, roughness: 0.4, transparent: true, opacity: 0.9 });

// Spine & Sternum
const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.55, 16), boneMat);
spine.position.set(0, 0, -0.12);
const sternum = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.35, 16), boneMat);
sternum.position.set(0, 0.02, 0.13);
rig.add(spine, sternum);

// Ribs
for (let i = 0; i < 6; i++) {
  const y = 0.15 - i * 0.05;
  const radius = 0.14 - Math.abs(i - 2.5) * 0.012;
  const rib = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.007, 10, 24, Math.PI * 1.8), boneMat);
  rib.rotation.x = Math.PI / 2 + 0.15;
  rib.position.set(0, y, 0);
  rig.add(rib);
}

// Trachea & main bronchi
const airwayMat = new THREE.MeshStandardMaterial({ color: 0x90a4ae, roughness: 0.3 });
const trachea = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 16), airwayMat);
trachea.position.set(0, 0.22, 0.01);
rig.add(trachea);

// Lungs lobes setup
const lungLobes = [];
const lobeConfigs = [
  { name: 'Right Superior Lobe', pos: [0.08, 0.12, 0.0], scale: [0.065, 0.08, 0.07], mat: lungMatRight },
  { name: 'Right Middle Lobe', pos: [0.09, 0.01, 0.02], scale: [0.06, 0.055, 0.065], mat: lungMatRight },
  { name: 'Right Inferior Lobe', pos: [0.075, -0.1, -0.01], scale: [0.07, 0.09, 0.075], mat: lungMatRight },
  { name: 'Left Superior Lobe', pos: [-0.08, 0.09, 0.0], scale: [0.065, 0.09, 0.07], mat: lungMatLeft },
  { name: 'Left Inferior Lobe', pos: [-0.075, -0.08, -0.01], scale: [0.065, 0.085, 0.075], mat: lungMatLeft }
];

const lobeGeo = new THREE.SphereGeometry(1, 24, 20);
for (const config of lobeConfigs) {
  const lobe = new THREE.Mesh(lobeGeo, config.mat);
  lobe.position.set(...config.pos);
  lobe.scale.set(...config.scale);
  lobe.userData.xr = {
    gaze: { dwellMs: 1000, action: 'select' },
    outline: { color: 0x33bbee, thickness: 0.02 },
    holdToAsk: { prompt: `Analyze pulmonary function and gas exchange for ${config.name}` }
  };
  rig.add(lobe);
  lungLobes.push(lobe);
}

scene.add(rig);

function animate(dt) {
  const breath = 1 + Math.sin(Date.now() * 0.0025) * 0.04;
  for (const lobe of lungLobes) {
    lobe.scale.x = lobe.scale.z = breath * 0.068;
  }
}
