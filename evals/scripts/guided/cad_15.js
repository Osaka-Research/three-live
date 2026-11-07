// Ebony-Lacquered Concert Grand Piano (1.8m long) with Open Lid & Bench on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e5, 1.4);
keyLight.name = "key_directional_light";
keyLight.position.set(2.5, 3.8, 2.8);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xd8e6ff, 0.65);
fillLight.name = "fill_directional_light";
fillLight.position.set(-2.2, 2.2, -2.0);
scene.add(fillLight);

const pianoSceneGroup = new THREE.Group();
pianoSceneGroup.name = "concert_grand_piano_and_bench";
scene.add(pianoSceneGroup);

// Materials
const ebonyLacquerMat = new THREE.MeshPhysicalMaterial({
  color: 0x0c0d10,
  metalness: 0.1,
  roughness: 0.08,
  clearcoat: 1.0,
  clearcoatRoughness: 0.04
});

const gildedHarpMat = new THREE.MeshStandardMaterial({
  color: 0xd4a63a,
  metalness: 0.88,
  roughness: 0.22
});

const spruceSoundboardMat = new THREE.MeshStandardMaterial({
  color: 0xd9a86c,
  metalness: 0.05,
  roughness: 0.38
});

const whiteKeyMat = new THREE.MeshStandardMaterial({
  color: 0xf7f5f0,
  metalness: 0.04,
  roughness: 0.15
});

const brassHardwareMat = new THREE.MeshStandardMaterial({
  color: 0xe6be55,
  metalness: 0.92,
  roughness: 0.16
});

const steelStringMat = new THREE.MeshStandardMaterial({
  color: 0xc8d0d8,
  metalness: 0.9,
  roughness: 0.2
});

// 1. 2D S-Curved Grand Piano Rim Profile Extruded for Case Body, Soundboard, Harp & Lid
// Front keyboard end at z = +0.65, tail curve extending back to z = -1.15 (total 1.8m length)
function createGrandPianoShape(scaleOffset) {
  const s = new THREE.Shape();
  const o = scaleOffset || 0;
  // Start at front-left cheek (x = -0.74, y = -0.52 in 2D shape coords)
  s.moveTo(-0.74 + o, -0.52 + o);
  s.lineTo(0.74 - o, -0.52 + o); // Front across keybed
  s.lineTo(0.74 - o, -0.15);     // Right treble cheek
  // S-curved treble rim waist inward then out to rounded tail at y = +1.15
  s.bezierCurveTo(0.72 - o, 0.18, 0.34 - o, 0.32, 0.38 - o, 0.68);
  s.bezierCurveTo(0.42 - o, 1.02, 0.08, 1.2 - o, -0.26, 1.18 - o);
  // Straight bass rim along left side (x = -0.74)
  s.bezierCurveTo(-0.62 + o, 1.14 - o, -0.74 + o, 0.88, -0.74 + o, 0.45);
  s.closePath();
  return s;
}

const rimOuterShape = createGrandPianoShape(0);
const rimInnerPath = new THREE.Path(createGrandPianoShape(0.055).getPoints(40));
rimOuterShape.holes.push(rimInnerPath);

const rimWallGeo = new THREE.ExtrudeGeometry(rimOuterShape, {
  depth: 0.34,
  bevelEnabled: true,
  bevelThickness: 0.008,
  bevelSize: 0.008,
  bevelSegments: 2
});
rimWallGeo.rotateX(-Math.PI / 2);

const rimWallMesh = new THREE.Mesh(rimWallGeo, ebonyLacquerMat);
rimWallMesh.name = "curved_ebony_grand_piano_rim";
rimWallMesh.position.set(0, 0.66, 0);
pianoSceneGroup.add(rimWallMesh);

// Spruce Soundboard floor inside rim
const soundboardGeo = new THREE.ExtrudeGeometry(createGrandPianoShape(0.05), {
  depth: 0.03,
  bevelEnabled: false
});
soundboardGeo.rotateX(-Math.PI / 2);
const soundboardMesh = new THREE.Mesh(soundboardGeo, spruceSoundboardMat);
soundboardMesh.name = "spruce_acoustic_soundboard";
soundboardMesh.position.set(0, 0.72, 0);
pianoSceneGroup.add(soundboardMesh);

// 2. Gilded Cast-Iron Harp Frame & Steel Strings Inside Case
const harpGeo = new THREE.ExtrudeGeometry(createGrandPianoShape(0.09), {
  depth: 0.025,
  bevelEnabled: true,
  bevelThickness: 0.004,
  bevelSize: 0.004,
  bevelSegments: 1
});
harpGeo.rotateX(-Math.PI / 2);
const gildedHarp = new THREE.Mesh(harpGeo, gildedHarpMat);
gildedHarp.name = "gilded_cast_iron_harp_frame";
gildedHarp.position.set(0, 0.88, 0);
pianoSceneGroup.add(gildedHarp);

// Fan of taut steel piano strings stretched across the gilded harp
for (let st = 0; st < 18; st++) {
  const frac = st / 17;
  const xStart = -0.62 + frac * 1.2;
  const zEnd = -1.02 + frac * 0.58;
  const strLen = Math.hypot(0.45 - zEnd, xStart * 0.15);

  const pianoString = new THREE.Mesh(
    new THREE.CylinderGeometry(0.002, 0.002, strLen, 6),
    steelStringMat
  );
  pianoString.name = `piano_steel_string_choir_${st + 1}`;
  pianoString.rotation.x = Math.PI / 2;
  pianoString.rotation.z = (frac - 0.5) * 0.18;
  pianoString.position.set(xStart * 0.85, 0.915, (0.45 + zEnd) / 2);
  pianoSceneGroup.add(pianoString);
}

// 3. Propped Open Ebony Lid with Brass Prop Stick
const lidPivotGroup = new THREE.Group();
lidPivotGroup.name = "hinged_open_piano_lid_group";
lidPivotGroup.position.set(-0.74, 1.01, 0);
lidPivotGroup.rotation.z = -0.58; // Propped open at ~33 degrees
pianoSceneGroup.add(lidPivotGroup);

const lidGeo = new THREE.ExtrudeGeometry(createGrandPianoShape(0.005), {
  depth: 0.022,
  bevelEnabled: true,
  bevelThickness: 0.005,
  bevelSize: 0.005,
  bevelSegments: 2
});
lidGeo.rotateX(-Math.PI / 2);
const lidMesh = new THREE.Mesh(lidGeo, ebonyLacquerMat);
lidMesh.name = "ebony_lacquered_grand_lid";
lidMesh.position.set(0.74, 0, 0);
lidPivotGroup.add(lidMesh);

// Diagonal lid prop stick on treble side
const propStick = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.014, 0.82, 12),
  ebonyLacquerMat
);
propStick.name = "piano_lid_prop_stick";
propStick.position.set(0.56, 1.32, 0.18);
propStick.rotation.z = 0.28;
pianoSceneGroup.add(propStick);

// 4. Keybed & 88-Key Scale Keyboard (White Naturals + Raised Black Sharps)
const keybedBox = new THREE.Mesh(
  new THREE.BoxGeometry(1.48, 0.09, 0.28),
  ebonyLacquerMat
);
keybedBox.name = "front_keybed_shelf";
keybedBox.position.set(0, 0.71, 0.62);
pianoSceneGroup.add(keybedBox);

// 52 White keys + 36 Black keys across 1.24m span
const numWhiteKeys = 52;
const whiteKeyWidth = 1.24 / numWhiteKeys;
const blackPattern = [1, 1, 0, 1, 1, 1, 0]; // Sharp pattern

for (let k = 0; k < numWhiteKeys; k++) {
  const kx = -0.62 + (k + 0.5) * whiteKeyWidth;
  const wKey = new THREE.Mesh(
    new THREE.BoxGeometry(whiteKeyWidth * 0.9, 0.022, 0.145),
    whiteKeyMat
  );
  wKey.name = `piano_white_key_${k + 1}`;
  wKey.position.set(kx, 0.765, 0.67);
  pianoSceneGroup.add(wKey);

  if (k < numWhiteKeys - 1 && blackPattern[k % 7] === 1) {
    const bKey = new THREE.Mesh(
      new THREE.BoxGeometry(whiteKeyWidth * 0.58, 0.032, 0.092),
      ebonyLacquerMat
    );
    bKey.name = `piano_black_key_${k + 1}`;
    bKey.position.set(kx + whiteKeyWidth * 0.5, 0.778, 0.642);
    pianoSceneGroup.add(bKey);
  }
}

// Tilted Music Desk above keyboard
const musicDesk = new THREE.Mesh(
  new THREE.BoxGeometry(0.86, 0.24, 0.016),
  ebonyLacquerMat
);
musicDesk.name = "sheet_music_stand_desk";
musicDesk.position.set(0, 1.08, 0.46);
musicDesk.rotation.x = -0.25;
pianoSceneGroup.add(musicDesk);

// 5. Three Turned Piano Legs with Brass Casters & Pedal Lyre with 3 Brass Pedals (y = 0)
const legCoords = [
  { name: "front_left_leg", x: -0.66, z: 0.48 },
  { name: "front_right_leg", x: 0.66, z: 0.48 },
  { name: "tail_rear_leg", x: -0.18, z: -0.98 }
];

for (const lc of legCoords) {
  const legColumn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.035, 0.62, 16),
    ebonyLacquerMat
  );
  legColumn.name = lc.name;
  legColumn.position.set(lc.x, 0.35, lc.z);
  pianoSceneGroup.add(legColumn);

  const brassCaster = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.028, 0.04, 16),
    brassHardwareMat
  );
  brassCaster.name = `${lc.name}_brass_caster`;
  brassCaster.position.set(lc.x, 0.02, lc.z);
  pianoSceneGroup.add(brassCaster);
}

// Pedal Lyre & 3 Brass Foot Pedals (Una Corda, Sostenuto, Damper)
const pedalLyreBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.24, 0.055, 0.12),
  ebonyLacquerMat
);
pedalLyreBox.name = "pedal_lyre_bottom_box";
pedalLyreBox.position.set(0, 0.06, 0.44);
pianoSceneGroup.add(pedalLyreBox);

for (const lx of [-0.08, 0.08]) {
  const lyrePillar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.016, 0.016, 0.58, 12),
    ebonyLacquerMat
  );
  lyrePillar.name = `pedal_lyre_pillar_${lx < 0 ? "left" : "right"}`;
  lyrePillar.position.set(lx, 0.37, 0.44);
  pianoSceneGroup.add(lyrePillar);
}

for (let p = -1; p <= 1; p++) {
  const brassPedal = new THREE.Mesh(
    new THREE.BoxGeometry(0.032, 0.014, 0.11),
    brassHardwareMat
  );
  brassPedal.name = `brass_foot_pedal_${p + 2}`;
  brassPedal.position.set(p * 0.065, 0.065, 0.52);
  brassPedal.rotation.x = 0.18;
  pianoSceneGroup.add(brassPedal);
}

// 6. Adjustable Duet Bench in Front of Keyboard (z = 1.02)
const benchGroup = new THREE.Group();
benchGroup.name = "adjustable_duet_piano_bench";
benchGroup.position.set(0, 0, 1.02);
pianoSceneGroup.add(benchGroup);

const benchCushion = new THREE.Mesh(
  new THREE.BoxGeometry(0.78, 0.075, 0.36),
  ebonyLacquerMat
);
benchCushion.name = "duet_bench_padded_seat";
benchCushion.position.set(0, 0.46, 0);
benchGroup.add(benchCushion);

for (const bx of [-0.34, 0.34]) {
  // Adjustment knobs on bench sides
  const knob = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16),
    brassHardwareMat
  );
  knob.name = `bench_height_knob_${bx < 0 ? "left" : "right"}`;
  knob.rotation.z = Math.PI / 2;
  knob.position.set(bx * 1.16, 0.43, 0);
  benchGroup.add(knob);

  for (const bz of [-0.14, 0.14]) {
    const bLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.43, 0.038),
      ebonyLacquerMat
    );
    bLeg.name = `bench_leg_${bx < 0 ? "L" : "R"}_${bz < 0 ? "F" : "B"}`;
    bLeg.position.set(bx, 0.215, bz);
    benchGroup.add(bLeg);
  }
}

// Frame camera at ~2.2x bounding radius
camera.position.set(2.15, 1.65, 2.35);
camera.lookAt(0, 0.72, 0.05);
