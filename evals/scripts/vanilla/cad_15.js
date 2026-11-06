const pianoGroup = new THREE.Group();
pianoGroup.position.set(0, 0, 0);
scene.add(pianoGroup);

const ebonyMat = new THREE.MeshPhysicalMaterial({ color: 0x080808, roughness: 0.15, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.05 });
const goldHarpMat = new THREE.MeshStandardMaterial({ color: 0xdaa520, roughness: 0.35, metalness: 0.85 });
const ivoryMat = new THREE.MeshStandardMaterial({ color: 0xfaf8f5, roughness: 0.2 });
const blackKeyMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.9 });
const leatherMat = new THREE.MeshStandardMaterial({ color: 0x221a15, roughness: 0.7 });

// 2D Profile shape of grand piano rim (1.8m long)
const rimShape = new THREE.Shape();
rimShape.moveTo(-0.65, 0);
rimShape.lineTo(-0.65, 0.75);
rimShape.bezierCurveTo(-0.65, 1.4, -0.2, 1.75, 0.15, 1.75);
rimShape.bezierCurveTo(0.45, 1.75, 0.65, 1.5, 0.65, 1.1);
rimShape.bezierCurveTo(0.65, 0.8, 0.55, 0.45, 0.65, 0);
rimShape.closePath();

// Extruded curved rim body
const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: 0.28, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015 });
rimGeo.rotateX(-Math.PI / 2);
const rimMesh = new THREE.Mesh(rimGeo, ebonyMat);
rimMesh.position.set(0, 0.72, -0.6);
pianoGroup.add(rimMesh);

// Propped open lid
const lidShape = rimShape.clone();
const lidGeo = new THREE.ExtrudeGeometry(lidShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008 });
lidGeo.rotateX(-Math.PI / 2);
const lidMesh = new THREE.Mesh(lidGeo, ebonyMat);
lidMesh.position.set(-0.65, 1.02, -0.6);
lidMesh.rotation.z = 0.38;
pianoGroup.add(lidMesh);

// Prop stick
const propGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.48, 12);
const propStick = new THREE.Mesh(propGeo, ebonyMat);
propStick.position.set(0.2, 1.15, 0.1);
propStick.rotation.z = -0.3;
pianoGroup.add(propStick);

// Gilded cast-iron harp frame with soundboard
const harpPlateGeo = new THREE.BoxGeometry(1.0, 0.02, 1.2);
const harpPlate = new THREE.Mesh(harpPlateGeo, goldHarpMat);
harpPlate.position.set(0, 0.85, 0.1);
pianoGroup.add(harpPlate);

// 3 Fluted piano legs
const legGeo = new THREE.CylinderGeometry(0.035, 0.02, 0.7, 16);
[[-0.55, 0.35, -0.4], [0.55, 0.35, -0.4], [0.1, 0.35, 0.8]].forEach(([x, y, z]) => {
  const leg = new THREE.Mesh(legGeo, ebonyMat);
  leg.position.set(x, y, z);
  pianoGroup.add(leg);
});

// 88 Keys (represented by white and black key rows)
const keyBedGeo = new THREE.BoxGeometry(1.18, 0.04, 0.16);
const keyBed = new THREE.Mesh(keyBedGeo, ebonyMat);
keyBed.position.set(0, 0.72, -0.62);
pianoGroup.add(keyBed);

const whiteKeyGeo = new THREE.BoxGeometry(0.02, 0.018, 0.14);
const blackKeyGeo = new THREE.BoxGeometry(0.012, 0.024, 0.09);
for (let i = -26; i <= 26; i++) {
  const wk = new THREE.Mesh(whiteKeyGeo, ivoryMat);
  wk.position.set(i * 0.022, 0.745, -0.62);
  pianoGroup.add(wk);
  if ([0, 1, 3, 4, 5].includes(((i % 7) + 7) % 7) && i < 26) {
    const bk = new THREE.Mesh(blackKeyGeo, blackKeyMat);
    bk.position.set(i * 0.022 + 0.011, 0.76, -0.645);
    pianoGroup.add(bk);
  }
}

// Lyre with 3 brass foot pedals
const lyrePostGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 12);
[-0.08, 0.08].forEach(x => {
  const post = new THREE.Mesh(lyrePostGeo, ebonyMat);
  post.position.set(x, 0.35, -0.3);
  pianoGroup.add(post);
});
const pedalGeo = new THREE.BoxGeometry(0.02, 0.01, 0.08);
[-0.04, 0, 0.04].forEach(x => {
  const pedal = new THREE.Mesh(pedalGeo, brassMat);
  pedal.position.set(x, 0.14, -0.28);
  pianoGroup.add(pedal);
});

// Adjustable duet bench
const benchGroup = new THREE.Group();
const cushionGeo = new THREE.BoxGeometry(0.85, 0.08, 0.36);
const cushion = new THREE.Mesh(cushionGeo, leatherMat);
cushion.position.set(0, 0.52, -1.05);
benchGroup.add(cushion);

const benchLegGeo = new THREE.CylinderGeometry(0.02, 0.015, 0.48, 12);
[[-0.38, -0.92], [0.38, -0.92], [-0.38, -1.18], [0.38, -1.18]].forEach(([x, z]) => {
  const bLeg = new THREE.Mesh(benchLegGeo, ebonyMat);
  bLeg.position.set(x, 0.24, z);
  benchGroup.add(bLeg);
});
pianoGroup.add(benchGroup);

// Lighting
const dirLight = new THREE.DirectionalLight(0xfffaed, 2.2);
dirLight.position.set(2, 4, 2);
scene.add(dirLight);
const ambLight = new THREE.AmbientLight(0x707080, 1.2);
scene.add(ambLight);
