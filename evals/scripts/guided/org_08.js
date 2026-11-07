const mantaRoot = new THREE.Group();
mantaRoot.name = "oceanic_manta_ray_root";
scene.add(mantaRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const oceanSunLight = new THREE.DirectionalLight(0xbbf0ff, 1.4);
oceanSunLight.name = "ocean_sun_directional_light";
oceanSunLight.position.set(1.8, 3.2, 1.6);
scene.add(oceanSunLight);

const seabedBounceLight = new THREE.PointLight(0x67e8f9, 0.75, 5.0);
seabedBounceLight.name = "seabed_upwelling_light";
seabedBounceLight.position.set(0, 0.12, 0.2);
scene.add(seabedBounceLight);

// Materials
const dorsalSlateMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.35,
  metalness: 0.12
});

const shoulderPatchMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  roughness: 0.38,
  metalness: 0.08
});

const ventralWhiteMat = new THREE.MeshStandardMaterial({
  color: 0xf8fafc,
  roughness: 0.42,
  metalness: 0.05
});

const gillSlitMat = new THREE.MeshStandardMaterial({
  color: 0x0f172a,
  roughness: 0.7,
  metalness: 0.05
});

const reefBaseMat = new THREE.MeshStandardMaterial({
  color: 0x475569,
  roughness: 0.9,
  metalness: 0.04
});

// Compact seabed pinnacle rock at y = 0 so the gliding manta is grounded in a real-world scene
const seabedRock = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.28, 0.06, 24),
  reefBaseMat
);
seabedRock.name = "seabed_reef_mound_base";
seabedRock.position.set(0, 0.03, 0);
mantaRoot.add(seabedRock);

// Gliding Manta Ray Assembly (centered at y = 0.44m, wingspan = 1.80m)
const mantaBodyGroup = new THREE.Group();
mantaBodyGroup.name = "manta_ray_gliding_group";
mantaBodyGroup.position.set(0, 0.44, 0.12);
mantaRoot.add(mantaBodyGroup);

// 1. Sinusoidal Pectoral Wings & Hydrofoil Body via Custom Indexed BufferGeometry
// Separate dorsal and ventral surfaces so dorsal is dark slate and ventral underside is crisp white
function createMantaSurfaceGeometry(isDorsal) {
  const spanSegs = 48; // x from -0.90m to +0.90m (1.8m wingspan)
  const chordSegs = 28; // z from tail base (-0.42m) to head mouth (+0.38m)
  const positions = [];
  const indices = [];

  for (let i = 0; i <= spanSegs; i++) {
    const u = (i / spanSegs) * 2.0 - 1.0; // -1 to +1 across 1.8m span
    const absU = Math.abs(u);
    const x = u * 0.90;

    // Leading edge sweeps back smoothly from snout (+0.36) to wingtip (-0.08)
    const zLead = 0.36 * Math.pow(1.0 - absU, 0.75) - 0.08 * absU;
    // Trailing edge curves from tail root (-0.44) out to wingtip (-0.10)
    const zTrail = -0.44 * Math.pow(1.0 - absU, 1.35) - 0.10 * absU;

    // Sinusoidal mid-glide wing arch: inner wing lifts up, outer wingtip curves gracefully
    const wingWaveY = 0.11 * Math.sin(absU * Math.PI * 1.15) - 0.04 * Math.pow(absU, 2.2);

    // Body thickness envelope (thickest along central fuselage, razor-thin at wingtips)
    const maxHalfThick = 0.075 * Math.exp(-absU * absU * 5.5) + 0.008 * (1.0 - absU);

    for (let j = 0; j <= chordSegs; j++) {
      const v = j / chordSegs; // 0 = trailing edge, 1 = leading edge
      const z = zTrail + v * (zLead - zTrail);
      // Airfoil thickness profile along chord: sin(pi * v^0.7)
      const chordProfile = Math.sin(Math.pow(v, 0.7) * Math.PI);
      const yOffset = (isDorsal ? 1.0 : -0.75) * maxHalfThick * chordProfile;
      const y = wingWaveY + yOffset;
      positions.push(x, y, z);
    }
  }

  for (let i = 0; i < spanSegs; i++) {
    for (let j = 0; j < chordSegs; j++) {
      const a = i * (chordSegs + 1) + j;
      const b = a + chordSegs + 1;
      const c = a + 1;
      const d = b + 1;
      if (isDorsal) {
        indices.push(a, b, c);
        indices.push(b, d, c);
      } else {
        indices.push(a, c, b);
        indices.push(b, c, d);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const dorsalWingMesh = new THREE.Mesh(createMantaSurfaceGeometry(true), dorsalSlateMat);
dorsalWingMesh.name = "manta_dorsal_pectoral_wings";
mantaBodyGroup.add(dorsalWingMesh);

const ventralWingMesh = new THREE.Mesh(createMantaSurfaceGeometry(false), ventralWhiteMat);
ventralWingMesh.name = "manta_ventral_white_underside";
mantaBodyGroup.add(ventralWingMesh);

// Characteristic white dorsal shoulder chevron markings (Shape + ExtrudeGeometry)
[-1, 1].forEach((side) => {
  const patchShape = new THREE.Shape();
  patchShape.moveTo(side * 0.06, 0.24);
  patchShape.quadraticCurveTo(side * 0.28, 0.20, side * 0.34, 0.05);
  patchShape.quadraticCurveTo(side * 0.20, 0.08, side * 0.08, 0.14);
  patchShape.closePath();

  const patchGeo = new THREE.ExtrudeGeometry(patchShape, {
    depth: 0.008,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.004,
    bevelSegments: 2
  });
  const patchMesh = new THREE.Mesh(patchGeo, shoulderPatchMat);
  patchMesh.name = `manta_dorsal_shoulder_chevron_${side < 0 ? "left" : "right"}`;
  patchMesh.rotation.x = Math.PI / 2;
  patchMesh.position.set(0, 0.068, 0);
  mantaBodyGroup.add(patchMesh);
});

// 2. Forward-Curling Cephalic Horn Lobes Flanking the Mouth (Shape + ExtrudeGeometry)
[-1, 1].forEach((side) => {
  const prefix = side < 0 ? "left" : "right";
  const lobeShape = new THREE.Shape();
  lobeShape.moveTo(0, 0);
  lobeShape.quadraticCurveTo(0.09, 0.03, 0.17, 0.01);
  lobeShape.quadraticCurveTo(0.19, -0.02, 0.14, -0.045);
  lobeShape.quadraticCurveTo(0.06, -0.04, 0, -0.025);
  lobeShape.closePath();

  const lobeGeo = new THREE.ExtrudeGeometry(lobeShape, {
    depth: 0.016,
    bevelEnabled: true,
    bevelThickness: 0.005,
    bevelSize: 0.005,
    bevelSegments: 3
  });

  const lobeMesh = new THREE.Mesh(lobeGeo, dorsalSlateMat);
  lobeMesh.name = `manta_cephalic_horn_lobe_${prefix}`;
  lobeMesh.position.set(side * 0.145, -0.005, 0.33);
  lobeMesh.rotation.y = -Math.PI / 2 + side * 0.28;
  lobeMesh.rotation.z = 0.12;
  lobeMesh.rotation.x = side * 0.35;
  mantaBodyGroup.add(lobeMesh);

  // Lateral eye on outer base of each cephalic lobe
  const eyeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.012, 12, 10),
    gillSlitMat
  );
  eyeMesh.name = `manta_lateral_eye_${prefix}`;
  eyeMesh.position.set(side * 0.165, 0.008, 0.31);
  mantaBodyGroup.add(eyeMesh);
});

// Wide filter-feeding terminal mouth cavity between cephalic lobes
const mouthCavity = new THREE.Mesh(
  new THREE.BoxGeometry(0.24, 0.028, 0.06),
  gillSlitMat
);
mouthCavity.name = "manta_terminal_mouth_cavity";
mouthCavity.position.set(0, -0.006, 0.33);
mantaBodyGroup.add(mouthCavity);

// 3. Five Pairs of Gill Slits on the White Ventral Underside
for (let g = 0; g < 5; g++) {
  const zPos = 0.20 - g * 0.055;
  const slitWidth = 0.068 - g * 0.005;
  const yVentral = -0.048 + g * 0.003;

  [-1, 1].forEach((side) => {
    const gillSlit = new THREE.Mesh(
      new THREE.BoxGeometry(slitWidth, 0.008, 0.010),
      gillSlitMat
    );
    gillSlit.name = `manta_ventral_gill_slit_${side < 0 ? "left" : "right"}_${g + 1}`;
    gillSlit.position.set(side * (0.075 - g * 0.004), yVentral, zPos);
    gillSlit.rotation.y = side * 0.18;
    mantaBodyGroup.add(gillSlit);
  });
}

// Small triangular dorsal fin at base of tail
const dorsalFinShape = new THREE.Shape();
dorsalFinShape.moveTo(0, 0);
dorsalFinShape.lineTo(-0.04, 0.045);
dorsalFinShape.lineTo(-0.075, 0);
dorsalFinShape.closePath();
const dorsalFinGeo = new THREE.ExtrudeGeometry(dorsalFinShape, {
  depth: 0.006,
  bevelEnabled: true,
  bevelThickness: 0.002,
  bevelSize: 0.002,
  bevelSegments: 2
});
const dorsalFinMesh = new THREE.Mesh(dorsalFinGeo, dorsalSlateMat);
dorsalFinMesh.name = "manta_tail_base_dorsal_fin";
dorsalFinMesh.rotation.y = Math.PI / 2;
dorsalFinMesh.position.set(-0.003, 0.015, -0.38);
mantaBodyGroup.add(dorsalFinMesh);

// 4. Long Whip-Like Tail (CatmullRomCurve3 + TubeGeometry)
const tailCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0.00, 0.002, -0.40),
  new THREE.Vector3(0.02, -0.015, -0.58),
  new THREE.Vector3(-0.03, -0.035, -0.78),
  new THREE.Vector3(0.02, -0.055, -0.96),
  new THREE.Vector3(0.00, -0.070, -1.12)
]);
const whipTailMesh = new THREE.Mesh(
  new THREE.TubeGeometry(tailCurve, 36, 0.0075, 10, false),
  dorsalSlateMat
);
whipTailMesh.name = "manta_whip_like_tail";
mantaBodyGroup.add(whipTailMesh);

// Gentle underwater glide animation
function animate(t) {
  mantaBodyGroup.position.y = 0.44 + Math.sin(t * 1.4) * 0.03;
  mantaBodyGroup.rotation.z = Math.cos(t * 1.4) * 0.04;
}

// Camera Framing (1.8m wingspan, length ~1.5m, bounding radius ~0.95m)
camera.position.set(0.55, 0.88, 1.95);
camera.lookAt(0, 0.35, 0);
