// Art-Deco Steel Suspension Bridge Tower & Deck Section (~4.0m tall) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff2db, 1.4);
sunLight.name = "sun_directional_light";
sunLight.position.set(5.0, 7.5, 5.5);
scene.add(sunLight);

const skyLight = new THREE.DirectionalLight(0xaac8ff, 0.55);
skyLight.name = "sky_fill_light";
skyLight.position.set(-4.5, 4.0, -3.5);
scene.add(skyLight);

const bridgeGroup = new THREE.Group();
bridgeGroup.name = "art_deco_suspension_bridge_section";
scene.add(bridgeGroup);

// Materials
const internationalOrangeMat = new THREE.MeshStandardMaterial({
  color: 0xc0362c,
  metalness: 0.52,
  roughness: 0.42
});

const concretePierMat = new THREE.MeshStandardMaterial({
  color: 0xc8c5bc,
  metalness: 0.08,
  roughness: 0.75
});

const roadAsphaltMat = new THREE.MeshStandardMaterial({
  color: 0x2c3036,
  metalness: 0.1,
  roughness: 0.82
});

const laneStripeMat = new THREE.MeshStandardMaterial({
  color: 0xf2c94c,
  metalness: 0.1,
  roughness: 0.4
});

const steelCableMat = new THREE.MeshStandardMaterial({
  color: 0x9aa2ab,
  metalness: 0.85,
  roughness: 0.28
});

// 1. Concrete Foundation Pier on y = 0 (height = 0.45m)
const concretePier = new THREE.Mesh(
  new THREE.BoxGeometry(1.75, 0.45, 0.72),
  concretePierMat
);
concretePier.name = "concrete_foundation_pier";
concretePier.position.set(0, 0.225, 0);
bridgeGroup.add(concretePier);

// 2. Twin Stepped Art-Deco Vertical Tower Legs (y = 0.45m to y = 3.95m)
const legX = 0.56;
const tierSpecs = [
  { yBottom: 0.45, height: 1.05, width: 0.28, depth: 0.34 },
  { yBottom: 1.5, height: 0.95, width: 0.24, depth: 0.28 },
  { yBottom: 2.45, height: 0.85, width: 0.2, depth: 0.23 },
  { yBottom: 3.3, height: 0.65, width: 0.16, depth: 0.18 }
];

for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "west" : "east";
  const lx = side * legX;

  for (let t = 0; t < tierSpecs.length; t++) {
    const spec = tierSpecs[t];
    const legTier = new THREE.Mesh(
      new THREE.BoxGeometry(spec.width, spec.height, spec.depth),
      internationalOrangeMat
    );
    legTier.name = `tower_leg_${sideTag}_tier_${t + 1}`;
    legTier.position.set(lx, spec.yBottom + spec.height / 2, 0);
    bridgeGroup.add(legTier);
  }

  // Cast-steel cable saddle at tower apex (y = 4.0m)
  const saddle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.26, 20),
    steelCableMat
  );
  saddle.name = `tower_apex_cable_saddle_${sideTag}`;
  saddle.rotation.x = Math.PI / 2;
  saddle.position.set(lx, 3.98, 0);
  bridgeGroup.add(saddle);
}

// Horizontal Cross-Bracing Struts & Diagonal X-Braces Between Twin Legs
const portalHeights = [1.05, 2.25, 3.05, 3.72];
for (let p = 0; p < portalHeights.length; p++) {
  const py = portalHeights[p];
  const portalStrut = new THREE.Mesh(
    new THREE.BoxGeometry(legX * 2, 0.18, 0.2),
    internationalOrangeMat
  );
  portalStrut.name = `tower_horizontal_strut_${p + 1}`;
  portalStrut.position.set(0, py, 0);
  bridgeGroup.add(portalStrut);

  // Diagonal X-brace bars above the road deck (p >= 1)
  if (p >= 1) {
    for (const diag of [-1, 1]) {
      const xBrace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 1.08, 12),
        internationalOrangeMat
      );
      xBrace.name = `tower_portal_${p + 1}_xbrace_${diag < 0 ? "A" : "B"}`;
      xBrace.position.set(0, py - 0.32, 0);
      xBrace.rotation.z = diag * 0.92;
      bridgeGroup.add(xBrace);
    }
  }
}

// 3. Two-Lane Road Deck with Truss Girders Passing Through Tower at y = 1.38m
const deckSpanZ = 3.8;
const deckY = 1.38;

const roadDeck = new THREE.Mesh(
  new THREE.BoxGeometry(0.92, 0.06, deckSpanZ),
  roadAsphaltMat
);
roadDeck.name = "two_lane_asphalt_road_deck";
roadDeck.position.set(0, deckY, 0);
bridgeGroup.add(roadDeck);

// Center dashed yellow divider line
for (let s = -4; s <= 4; s++) {
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.03, 0.008, 0.24),
    laneStripeMat
  );
  stripe.name = `road_center_lane_stripe_${s + 5}`;
  stripe.position.set(0, deckY + 0.032, s * 0.4);
  bridgeGroup.add(stripe);
}

// Side stiffening truss chords & diagonal Warren truss girders under the road deck
for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "west" : "east";
  const tx = side * 0.48;

  const upperChord = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, deckSpanZ),
    internationalOrangeMat
  );
  upperChord.name = `deck_truss_upper_chord_${sideTag}`;
  upperChord.position.set(tx, deckY + 0.04, 0);
  bridgeGroup.add(upperChord);

  const lowerChord = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, deckSpanZ),
    internationalOrangeMat
  );
  lowerChord.name = `deck_truss_lower_chord_${sideTag}`;
  lowerChord.position.set(tx, deckY - 0.18, 0);
  bridgeGroup.add(lowerChord);

  for (let b = 0; b < 12; b++) {
    const bz = -1.65 + b * 0.3;
    const diagStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.34, 8),
      internationalOrangeMat
    );
    diagStrut.name = `deck_truss_${sideTag}_diag_${b + 1}`;
    diagStrut.position.set(tx, deckY - 0.07, bz);
    diagStrut.rotation.x = b % 2 === 0 ? 0.72 : -0.72;
    bridgeGroup.add(diagStrut);
  }
}

// 4. Main Catenary Suspension Cables & Vertical Suspender Ropes
for (const side of [-1, 1]) {
  const sideTag = side < 0 ? "west" : "east";
  const cx = side * legX;

  // Parabolic catenary points dipping on both sides of the tower apex (z = 0, y = 4.02)
  const cablePoints = [];
  const numSamples = 17;
  for (let i = 0; i < numSamples; i++) {
    const z = -1.9 + (i / (numSamples - 1)) * 3.8;
    const distFromTower = Math.abs(z) / 1.9; // 0 at tower, 1 at ends
    // Catenary sag curve from 4.02m at tower down to 1.65m at ends
    const y = 1.62 + 2.4 * Math.pow(1 - distFromTower, 1.85);
    cablePoints.push(new THREE.Vector3(cx, y, z));
  }

  const cableCurve = new THREE.CatmullRomCurve3(cablePoints);
  const cableGeo = new THREE.TubeGeometry(cableCurve, 64, 0.042, 16, false);
  const mainCable = new THREE.Mesh(cableGeo, steelCableMat);
  mainCable.name = `main_catenary_cable_${sideTag}`;
  bridgeGroup.add(mainCable);

  // Vertical suspender ropes connecting catenary cable down to deck edge
  for (let r = -6; r <= 6; r++) {
    if (r === 0) continue; // Tower occupies z = 0
    const rz = r * 0.28;
    const distFrac = Math.abs(rz) / 1.9;
    const topY = 1.62 + 2.4 * Math.pow(1 - distFrac, 1.85);
    const ropeLen = topY - deckY;

    const suspenderRope = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, ropeLen, 8),
      steelCableMat
    );
    suspenderRope.name = `vertical_suspender_rope_${sideTag}_${r + 7}`;
    suspenderRope.position.set(cx * 0.92, deckY + ropeLen / 2, rz);
    bridgeGroup.add(suspenderRope);
  }
}

// Frame camera at ~2.2x bounding radius
camera.position.set(4.6, 3.1, 4.8);
camera.lookAt(0, 2.0, 0);
