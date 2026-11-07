// Mirrorless Camera Body with Attached f/2.8 Telephoto Zoom Lens on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff8ed, 1.4);
keyLight.name = "key_directional_light";
keyLight.position.set(1.2, 1.8, 1.5);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x99ccff, 0.8);
rimLight.name = "rim_directional_light";
rimLight.position.set(-1.2, 1.0, -1.2);
scene.add(rimLight);

const cameraRigGroup = new THREE.Group();
cameraRigGroup.name = "mirrorless_camera_telephoto_rig";
scene.add(cameraRigGroup);

// Materials
const magnesiumBodyMat = new THREE.MeshStandardMaterial({
  color: 0x1e2024,
  metalness: 0.45,
  roughness: 0.48
});

const texturedRubberMat = new THREE.MeshStandardMaterial({
  color: 0x141518,
  metalness: 0.08,
  roughness: 0.78
});

const anodizedMetalMat = new THREE.MeshStandardMaterial({
  color: 0x32363c,
  metalness: 0.85,
  roughness: 0.25
});

const silverMountMat = new THREE.MeshStandardMaterial({
  color: 0xd8dfe6,
  metalness: 0.92,
  roughness: 0.16
});

const redRingAccentMat = new THREE.MeshStandardMaterial({
  color: 0xd92323,
  metalness: 0.7,
  roughness: 0.25
});

const multiCoatedGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x1a6655,
  transmission: 0.86,
  ior: 1.62,
  thickness: 0.025,
  roughness: 0.04,
  metalness: 0.1,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03,
  iridescence: 0.9,
  iridescenceIOR: 1.38
});

// Base height offset so tripod foot & camera base sit cleanly on y = 0
const bodyCenterY = 0.075;

// 1. Mirrorless Camera Body & Ergonomic Hand Grip (at z = -0.11)
const bodyGroup = new THREE.Group();
bodyGroup.name = "mirrorless_camera_body_group";
bodyGroup.position.set(0, bodyCenterY, -0.11);
cameraRigGroup.add(bodyGroup);

const mainChassis = new THREE.Mesh(
  new THREE.BoxGeometry(0.138, 0.098, 0.048),
  magnesiumBodyMat
);
mainChassis.name = "camera_magnesium_chassis";
bodyGroup.add(mainChassis);

// Ergonomic contoured right-hand grip (x = -0.056)
const gripCylinder = new THREE.Mesh(
  new THREE.CylinderGeometry(0.022, 0.022, 0.096, 20),
  texturedRubberMat
);
gripCylinder.name = "ergonomic_hand_grip";
gripCylinder.position.set(-0.056, -0.001, 0.024);
bodyGroup.add(gripCylinder);

// Angled shutter button on top of grip
const shutterButton = new THREE.Mesh(
  new THREE.CylinderGeometry(0.008, 0.009, 0.008, 16),
  silverMountMat
);
shutterButton.name = "shutter_release_button";
shutterButton.position.set(-0.054, 0.05, 0.028);
shutterButton.rotation.x = 0.35;
bodyGroup.add(shutterButton);

// Electronic Viewfinder (EVF) pentaprism housing & Hot-Shoe Mount
const evfShape = new THREE.Shape();
evfShape.moveTo(-0.024, 0);
evfShape.lineTo(0.024, 0);
evfShape.lineTo(0.018, 0.028);
evfShape.lineTo(-0.018, 0.028);
evfShape.closePath();

const evfGeo = new THREE.ExtrudeGeometry(evfShape, {
  depth: 0.058,
  bevelEnabled: true,
  bevelThickness: 0.003,
  bevelSize: 0.003,
  bevelSegments: 2
});
evfGeo.translate(0, 0, -0.032);

const evfHump = new THREE.Mesh(evfGeo, magnesiumBodyMat);
evfHump.name = "evf_viewfinder_housing";
evfHump.position.set(0, 0.048, 0);
bodyGroup.add(evfHump);

// Metal Hot-Shoe Mount on top of EVF
const hotShoeBase = new THREE.Mesh(
  new THREE.BoxGeometry(0.022, 0.004, 0.022),
  silverMountMat
);
hotShoeBase.name = "hot_shoe_mount";
hotShoeBase.position.set(0, 0.079, -0.002);
bodyGroup.add(hotShoeBase);

// Top Mode Dial & Exposure Compensation Dial
const modeDial = new THREE.Mesh(
  new THREE.CylinderGeometry(0.014, 0.014, 0.014, 24),
  anodizedMetalMat
);
modeDial.name = "top_pas_mode_dial";
modeDial.position.set(0.042, 0.055, 0.002);
bodyGroup.add(modeDial);

const expDial = new THREE.Mesh(
  new THREE.CylinderGeometry(0.011, 0.011, 0.012, 24),
  anodizedMetalMat
);
expDial.name = "exposure_compensation_dial";
expDial.position.set(-0.034, 0.054, -0.008);
bodyGroup.add(expDial);

// Rear LCD screen frame
const rearLcd = new THREE.Mesh(
  new THREE.BoxGeometry(0.088, 0.062, 0.006),
  anodizedMetalMat
);
rearLcd.name = "rear_tilting_lcd_screen";
rearLcd.position.set(0.012, -0.005, -0.026);
bodyGroup.add(rearLcd);

// 2. Attached f/2.8 Telephoto Zoom Lens Barrel (extending along +Z from z = -0.085 to z = +0.18)
const lensGroup = new THREE.Group();
lensGroup.name = "telephoto_f28_zoom_lens";
lensGroup.position.set(0, bodyCenterY, -0.085);
cameraRigGroup.add(lensGroup);

// Metallic bayonet mount ring
const bayonetMount = new THREE.Mesh(
  new THREE.CylinderGeometry(0.034, 0.034, 0.012, 28),
  silverMountMat
);
bayonetMount.name = "lens_bayonet_mount_ring";
bayonetMount.rotation.x = Math.PI / 2;
bayonetMount.position.set(0, 0, 0.006);
lensGroup.add(bayonetMount);

// Rear barrel & Tripod collar ring resting at y = 0
const rearBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.041, 0.036, 0.065, 32),
  anodizedMetalMat
);
rearBarrel.name = "lens_rear_barrel";
rearBarrel.rotation.x = Math.PI / 2;
rearBarrel.position.set(0, 0, 0.044);
lensGroup.add(rearBarrel);

const tripodCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.044, 0.044, 0.022, 32),
  anodizedMetalMat
);
tripodCollar.name = "tripod_collar_ring";
tripodCollar.rotation.x = Math.PI / 2;
tripodCollar.position.set(0, 0, 0.05);
lensGroup.add(tripodCollar);

const tripodFoot = new THREE.Mesh(
  new THREE.BoxGeometry(0.038, 0.035, 0.085),
  anodizedMetalMat
);
tripodFoot.name = "arca_swiss_tripod_foot";
tripodFoot.position.set(0, -0.057, 0.058);
lensGroup.add(tripodFoot);

// Wide Ribbed Rubber Zoom Ring
const zoomRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0445, 0.0445, 0.055, 36),
  texturedRubberMat
);
zoomRing.name = "ribbed_rubber_zoom_ring";
zoomRing.rotation.x = Math.PI / 2;
zoomRing.position.set(0, 0, 0.106);
lensGroup.add(zoomRing);

// Ribbed texture fins around the zoom ring
for (let r = 0; r < 24; r++) {
  const ang = (r / 24) * Math.PI * 2;
  const rib = new THREE.Mesh(
    new THREE.BoxGeometry(0.002, 0.002, 0.052),
    texturedRubberMat
  );
  rib.name = `zoom_ring_rib_${r + 1}`;
  rib.position.set(Math.cos(ang) * 0.045, Math.sin(ang) * 0.045, 0.106);
  rib.rotation.z = ang;
  lensGroup.add(rib);
}

// Mid barrel + Focus Ring + Red Luxury Ring
const midBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.046, 0.043, 0.032, 32),
  anodizedMetalMat
);
midBarrel.name = "lens_mid_barrel";
midBarrel.rotation.x = Math.PI / 2;
midBarrel.position.set(0, 0, 0.15);
lensGroup.add(midBarrel);

const focusRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0475, 0.0475, 0.038, 36),
  texturedRubberMat
);
focusRing.name = "ribbed_rubber_focus_ring";
focusRing.rotation.x = Math.PI / 2;
focusRing.position.set(0, 0, 0.185);
lensGroup.add(focusRing);

const redLuxuryRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0485, 0.0485, 0.005, 36),
  redRingAccentMat
);
redLuxuryRing.name = "pro_red_accent_ring";
redLuxuryRing.rotation.x = Math.PI / 2;
redLuxuryRing.position.set(0, 0, 0.208);
lensGroup.add(redLuxuryRing);

const frontBarrel = new THREE.Mesh(
  new THREE.CylinderGeometry(0.048, 0.048, 0.018, 36),
  anodizedMetalMat
);
frontBarrel.name = "lens_front_filter_barrel";
frontBarrel.rotation.x = Math.PI / 2;
frontBarrel.position.set(0, 0, 0.219);
lensGroup.add(frontBarrel);

// 3. Multi-Coated Curved Glass Front Element
const frontGlassElement = new THREE.Mesh(
  new THREE.SphereGeometry(0.068, 32, 16, 0, Math.PI * 2, 0, 0.68),
  multiCoatedGlassMat
);
frontGlassElement.name = "multi_coated_front_glass_element";
frontGlassElement.rotation.x = Math.PI / 2;
frontGlassElement.position.set(0, 0, 0.172);
lensGroup.add(frontGlassElement);

// 4. Petal-Shaped Lens Hood (4 scalloped petals at front)
const hoodGroup = new THREE.Group();
hoodGroup.name = "petal_lens_hood";
hoodGroup.position.set(0, 0, 0.226);
lensGroup.add(hoodGroup);

const hoodBaseCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.051, 0.049, 0.025, 32, 1, true),
  magnesiumBodyMat
);
hoodBaseCollar.name = "lens_hood_collar";
hoodBaseCollar.rotation.x = Math.PI / 2;
hoodBaseCollar.position.set(0, 0, 0.012);
hoodGroup.add(hoodBaseCollar);

// Top & bottom long petals, left & right shorter petals
const petalConfigs = [
  { name: "hood_petal_top", angle: Math.PI / 2, span: 1.05, len: 0.054 },
  { name: "hood_petal_bottom", angle: -Math.PI / 2, span: 1.05, len: 0.054 },
  { name: "hood_petal_left", angle: Math.PI, span: 0.72, len: 0.034 },
  { name: "hood_petal_right", angle: 0, span: 0.72, len: 0.034 }
];

for (const p of petalConfigs) {
  const petalGeo = new THREE.CylinderGeometry(
    0.054,
    0.051,
    p.len,
    16,
    1,
    true,
    p.angle - p.span / 2,
    p.span
  );
  const petalMesh = new THREE.Mesh(petalGeo, magnesiumBodyMat);
  petalMesh.name = p.name;
  petalMesh.rotation.x = Math.PI / 2;
  petalMesh.position.set(0, 0, 0.024 + p.len / 2);
  hoodGroup.add(petalMesh);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(0.32, 0.24, 0.38);
camera.lookAt(0, 0.08, 0.03);
