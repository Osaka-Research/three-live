const nautilusRoot = new THREE.Group();
nautilusRoot.name = "nautilus_shell_cross_section_root";
scene.add(nautilusRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff6e8, 1.35);
keyLight.name = "key_directional_light";
keyLight.position.set(1.0, 1.5, 1.6);
scene.add(keyLight);

const pearlescentRimLight = new THREE.PointLight(0xa5f3fc, 0.9, 3.5);
pearlescentRimLight.name = "nacre_iridescent_light";
pearlescentRimLight.position.set(-0.8, 0.6, 1.0);
scene.add(pearlescentRimLight);

// Materials
const nacreMat = new THREE.MeshPhysicalMaterial({
  color: 0xfef9f0,
  roughness: 0.14,
  metalness: 0.12,
  clearcoat: 0.95,
  clearcoatRoughness: 0.1,
  iridescence: 1.0,
  iridescenceIOR: 1.38
});

const septaMat = new THREE.MeshPhysicalMaterial({
  color: 0xf5ebd6,
  roughness: 0.18,
  metalness: 0.1,
  clearcoat: 0.9,
  iridescence: 0.92,
  iridescenceIOR: 1.35,
  side: THREE.DoubleSide
});

const outerShellMat = new THREE.MeshPhysicalMaterial({
  color: 0xd97742,
  roughness: 0.32,
  metalness: 0.04,
  clearcoat: 0.45,
  side: THREE.DoubleSide
});

const siphuncleMat = new THREE.MeshPhysicalMaterial({
  color: 0xc29b61,
  roughness: 0.38,
  metalness: 0.08,
  clearcoat: 0.5
});

const standMat = new THREE.MeshStandardMaterial({
  color: 0x262322,
  roughness: 0.45,
  metalness: 0.3
});

const brassMat = new THREE.MeshStandardMaterial({
  color: 0xc89d46,
  roughness: 0.25,
  metalness: 0.85
});

// 1. Museum Display Plinth & Brass Cradle (resting at y = 0)
const plinthGroup = new THREE.Group();
plinthGroup.name = "display_stand_group";
nautilusRoot.add(plinthGroup);

const baseDisk = new THREE.Mesh(
  new THREE.CylinderGeometry(0.14, 0.16, 0.024, 32),
  standMat
);
baseDisk.name = "granite_plinth_base";
baseDisk.position.set(0, 0.012, 0);
plinthGroup.add(baseDisk);

const cradleCurve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.08, 0.024, 0.0),
  new THREE.Vector3(0.0, 0.024, 0.0),
  new THREE.Vector3(0.0, 0.075, -0.02)
]);
const cradleStem = new THREE.Mesh(
  new THREE.TubeGeometry(cradleCurve, 16, 0.008, 10, false),
  brassMat
);
cradleStem.name = "brass_support_stem";
plinthGroup.add(cradleStem);

// 2. Logarithmic Spiral Shell Cross-Section (~0.45m diameter, centered at y = 0.26m)
const shellGroup = new THREE.Group();
shellGroup.name = "nautilus_logarithmic_spiral_group";
shellGroup.position.set(0.02, 0.26, 0);
nautilusRoot.add(shellGroup);

// Logarithmic spiral parameters: r(theta) = r0 * exp(b * theta)
// Over 2.65 turns (theta from 0 to 5.3 * Math.PI), outer diameter ~0.45m (max R ~ 0.245m)
const r0 = 0.0105;
const bGrowth = 0.178;
const maxTheta = 5.3 * Math.PI;

function getSpiralData(theta) {
  const rCenter = r0 * Math.exp(bGrowth * theta);
  // Tube radius grows proportionally with logarithmic spiral radius
  const tubeR = rCenter * 0.44;
  const x = Math.cos(theta) * rCenter;
  const y = Math.sin(theta) * rCenter;
  return { rCenter, tubeR, x, y };
}

// Build Sliced Half-Shell Wall via Custom Indexed BufferGeometry (Back half z <= 0)
function createSlicedShellGeometry(radialOffset, isInnerNacre) {
  const spiralSteps = 140;
  const profileSteps = 18;
  const positions = [];
  const indices = [];

  for (let i = 0; i <= spiralSteps; i++) {
    const u = i / spiralSteps;
    const theta = u * maxTheta;
    const { rCenter, tubeR, x: cx, y: cy } = getSpiralData(theta);
    const rad = tubeR + radialOffset;

    for (let j = 0; j <= profileSteps; j++) {
      const v = j / profileSteps;
      // Angle phi from -PI/2 (inner whorl overlap) to +PI/2 (outer keel), mapped into z <= 0 half
      const phi = (v - 0.5) * Math.PI;
      const localR = rCenter + Math.sin(phi) * rad;
      const px = Math.cos(theta) * localR;
      const py = Math.sin(theta) * localR;
      const pz = -Math.cos(phi) * rad * 0.82;
      positions.push(px, py, pz);
    }
  }

  for (let i = 0; i < spiralSteps; i++) {
    for (let j = 0; j < profileSteps; j++) {
      const a = i * (profileSteps + 1) + j;
      const b = a + profileSteps + 1;
      const c = a + 1;
      const d = b + 1;
      if (isInnerNacre) {
        indices.push(a, c, b);
        indices.push(b, c, d);
      } else {
        indices.push(a, b, c);
        indices.push(b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const outerShellMesh = new THREE.Mesh(createSlicedShellGeometry(0.003, false), outerShellMat);
outerShellMesh.name = "nautilus_outer_shell_wall";
shellGroup.add(outerShellMesh);

const innerNacreMesh = new THREE.Mesh(createSlicedShellGeometry(0.0, true), nacreMat);
innerNacreMesh.name = "nautilus_inner_pearlescent_nacre_wall";
shellGroup.add(innerNacreMesh);

// Polished Cut Rim Tube along the Logarithmic Spiral Cross-Section Plane (z = 0)
const outerKeelPoints = [];
const innerUmbilicusPoints = [];
for (let i = 0; i <= 90; i++) {
  const theta = (i / 90) * maxTheta;
  const { rCenter, tubeR } = getSpiralData(theta);
  const rOuter = rCenter + tubeR;
  const rInner = Math.max(0.002, rCenter - tubeR * 0.85);
  outerKeelPoints.push(new THREE.Vector3(Math.cos(theta) * rOuter, Math.sin(theta) * rOuter, 0));
  innerUmbilicusPoints.push(new THREE.Vector3(Math.cos(theta) * rInner, Math.sin(theta) * rInner, 0));
}

const outerKeelCurve = new THREE.CatmullRomCurve3(outerKeelPoints);
const outerKeelRim = new THREE.Mesh(
  new THREE.TubeGeometry(outerKeelCurve, 120, 0.0038, 10, false),
  nacreMat
);
outerKeelRim.name = "nautilus_outer_keel_cut_rim";
shellGroup.add(outerKeelRim);

const innerWallCurve = new THREE.CatmullRomCurve3(innerUmbilicusPoints);
const innerWallRim = new THREE.Mesh(
  new THREE.TubeGeometry(innerWallCurve, 100, 0.0028, 8, false),
  nacreMat
);
innerWallRim.name = "nautilus_inner_whorl_cut_rim";
shellGroup.add(innerWallRim);

// 3. Pearlescent Internal Septa Walls Dividing the Logarithmic Chambers
const septaGroup = new THREE.Group();
septaGroup.name = "nautilus_internal_septa_group";
shellGroup.add(septaGroup);

const numSepta = 30;
// Septa stop before the final large living body chamber (last ~110 degrees)
const maxSeptaTheta = maxTheta - 1.85;

function createSeptumChamberWallGeometry(theta) {
  const { rCenter, tubeR } = getSpiralData(theta);
  const rInner = Math.max(0.003, rCenter - tubeR * 0.82);
  const rOuter = rCenter + tubeR * 0.98;
  const uSteps = 12;
  const vSteps = 12;
  const positions = [];
  const indices = [];

  for (let i = 0; i <= uSteps; i++) {
    const u = i / uSteps; // radial across whorl from inner wall to outer keel
    const r = rInner + u * (rOuter - rInner);
    // Concave backward curve characteristic of nautilus septa
    const curveBackAngle = theta - 0.24 * Math.sin(u * Math.PI);
    const maxZDepth = Math.sin(u * Math.PI) * tubeR * 0.80;

    for (let j = 0; j <= vSteps; j++) {
      const v = j / vSteps; // depth from cut plane (z=0) into shell interior (z < 0)
      const z = -v * maxZDepth;
      const dishAngle = curveBackAngle - 0.08 * (1.0 - v * v) * Math.sin(u * Math.PI);
      const px = Math.cos(dishAngle) * r;
      const py = Math.sin(dishAngle) * r;
      positions.push(px, py, z);
    }
  }

  for (let i = 0; i < uSteps; i++) {
    for (let j = 0; j < vSteps; j++) {
      const a = i * (vSteps + 1) + j;
      const b = a + vSteps + 1;
      const c = a + 1;
      const d = b + 1;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

for (let s = 3; s <= numSepta; s++) {
  const theta = (s / numSepta) * maxSeptaTheta;
  const septumGeo = createSeptumChamberWallGeometry(theta);
  const septumMesh = new THREE.Mesh(septumGeo, septaMat);
  septumMesh.name = `nautilus_pearlescent_septum_${s}`;
  septaGroup.add(septumMesh);

  // Polished nacre edge rib on the cut face of each septum
  const { rCenter, tubeR } = getSpiralData(theta);
  const rInner = Math.max(0.003, rCenter - tubeR * 0.82);
  const rOuter = rCenter + tubeR * 0.98;
  const edgePts = [];
  for (let k = 0; k <= 8; k++) {
    const u = k / 8;
    const r = rInner + u * (rOuter - rInner);
    const a = theta - 0.24 * Math.sin(u * Math.PI) - 0.08 * Math.sin(u * Math.PI);
    edgePts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.001));
  }
  const ribCurve = new THREE.CatmullRomCurve3(edgePts);
  const ribRadius = Math.max(0.001, tubeR * 0.045);
  const ribMesh = new THREE.Mesh(
    new THREE.TubeGeometry(ribCurve, 12, ribRadius, 6, false),
    nacreMat
  );
  ribMesh.name = `nautilus_septum_cut_rib_${s}`;
  septaGroup.add(ribMesh);
}

// 4. Continuous Siphuncle Tube Connecting All Chambers
const siphunclePoints = [];
for (let i = 4; i <= 75; i++) {
  const theta = (i / 75) * maxSeptaTheta;
  const { rCenter, tubeR } = getSpiralData(theta);
  const zOffset = -tubeR * 0.35;
  siphunclePoints.push(
    new THREE.Vector3(Math.cos(theta) * rCenter, Math.sin(theta) * rCenter, zOffset)
  );
}
const siphuncleCurve = new THREE.CatmullRomCurve3(siphunclePoints);
const siphuncleTube = new THREE.Mesh(
  new THREE.TubeGeometry(siphuncleCurve, 90, 0.0032, 8, false),
  siphuncleMat
);
siphuncleTube.name = "nautilus_central_siphuncle_tube";
shellGroup.add(siphuncleTube);

// Camera Framing (diameter ~0.45m, height ~0.49m, center ~0.25m)
camera.position.set(0.0, 0.27, 0.72);
camera.lookAt(0, 0.25, 0);
