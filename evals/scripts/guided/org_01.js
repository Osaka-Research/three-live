const amphoraRoot = new THREE.Group();
amphoraRoot.name = "greek_red_figure_amphora_root";
scene.add(amphoraRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.3);
keyLight.name = "key_directional_light";
keyLight.position.set(1.2, 1.8, 1.4);
scene.add(keyLight);

const rimLight = new THREE.PointLight(0xffb078, 0.85, 4.0);
rimLight.name = "warm_rim_light";
rimLight.position.set(-1.0, 0.9, -1.0);
scene.add(rimLight);

// Procedural Greek Red-Figure & Meander DataTexture
function createAmphoraTexture() {
  const width = 256;
  const height = 256;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = y / height;
    for (let x = 0; x < width; x++) {
      const u = x / width;
      const idx = (y * width + x) * 4;
      // Base terracotta red-orange: RGB(196, 92, 48)
      // Black gloss slip: RGB(22, 20, 20)
      let isTerracotta = false;

      // Lower foot & rays band (v: 0.12 - 0.22)
      if (v >= 0.12 && v < 0.22) {
        const rayPhase = (u * 24) % 1.0;
        const rayWidth = (v - 0.12) / 0.10;
        if (Math.abs(rayPhase - 0.5) < rayWidth * 0.45) {
          isTerracotta = true;
        }
      }
      // Meander Greek key lower border (v: 0.26 - 0.32)
      else if (v >= 0.26 && v < 0.32) {
        const cellX = Math.floor(u * 32) % 4;
        const cellY = Math.floor(((v - 0.26) / 0.06) * 4);
        if (cellY === 0 || cellY === 3 || (cellX === 0 && cellY > 0) || (cellX === 2 && cellY === 2)) {
          isTerracotta = true;
        }
      }
      // Main Red-Figure Narrative Frieze Band (v: 0.35 - 0.65)
      else if (v >= 0.35 && v < 0.65) {
        const panelU = (u * 6) % 1.0;
        const panelV = (v - 0.35) / 0.30;
        // Stylized figure silhouette / drapery waves in red-figure reserve
        const dx = panelU - 0.5;
        const dy = panelV - 0.5;
        const bodyWidth = 0.18 + 0.06 * Math.sin(panelV * Math.PI * 3.0);
        if (Math.abs(dx) < bodyWidth && panelV > 0.1 && panelV < 0.88) {
          // Internal black drapery linework
          const fold = Math.abs(Math.sin(dx * 40.0 + panelV * 6.0));
          isTerracotta = fold > 0.22;
        }
      }
      // Shoulder Palmette & Lotus Band (v: 0.68 - 0.78)
      else if (v >= 0.68 && v < 0.78) {
        const pU = ((u * 16) % 1.0) - 0.5;
        const pV = (v - 0.68) / 0.10;
        const dist = Math.sqrt(pU * pU * 2.5 + (pV - 0.3) * (pV - 0.3));
        const angle = Math.atan2(pV - 0.2, pU);
        const petal = Math.abs(Math.cos(angle * 7.0));
        if (dist < 0.42 && petal > 0.35) {
          isTerracotta = true;
        }
      }
      // Reserved terracotta neck ring & inner lip
      else if ((v >= 0.84 && v < 0.88) || v >= 0.96) {
        isTerracotta = true;
      }

      if (isTerracotta) {
        data[idx] = 204;
        data[idx + 1] = 96;
        data[idx + 2] = 48;
        data[idx + 3] = 255;
      } else {
        data[idx] = 24;
        data[idx + 1] = 21;
        data[idx + 2] = 20;
        data[idx + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const amphoraTexture = createAmphoraTexture();

const bodyMaterial = new THREE.MeshStandardMaterial({
  map: amphoraTexture,
  roughness: 0.32,
  metalness: 0.06
});

const terracottaMaterial = new THREE.MeshStandardMaterial({
  color: 0xcc6030,
  roughness: 0.45,
  metalness: 0.04
});

const blackGlazeMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a1716,
  roughness: 0.22,
  metalness: 0.08
});

// 1. S-Curved Amphora Profile via LatheGeometry (y = 0.0 to y = 0.60m)
const profilePoints = [
  new THREE.Vector2(0.000, 0.002),
  new THREE.Vector2(0.096, 0.000), // Flared foot base resting at y=0
  new THREE.Vector2(0.098, 0.018), // Foot outer torus edge
  new THREE.Vector2(0.082, 0.032), // Foot step
  new THREE.Vector2(0.044, 0.052), // Narrow stem waist
  new THREE.Vector2(0.052, 0.075), // Lower belly transition
  new THREE.Vector2(0.098, 0.135), // Lower S-curve
  new THREE.Vector2(0.145, 0.220), // Mid belly swell
  new THREE.Vector2(0.168, 0.315), // Maximum belly diameter
  new THREE.Vector2(0.156, 0.385), // High shoulder
  new THREE.Vector2(0.112, 0.435), // Shoulder curve inward
  new THREE.Vector2(0.062, 0.465), // Neck collar base
  new THREE.Vector2(0.054, 0.510), // Narrow concave neck
  new THREE.Vector2(0.064, 0.555), // Upper neck flare
  new THREE.Vector2(0.092, 0.585), // Rolled lip rim outer
  new THREE.Vector2(0.094, 0.598), // Lip top
  new THREE.Vector2(0.076, 0.600), // Lip inner edge
  new THREE.Vector2(0.046, 0.520), // Throat interior
  new THREE.Vector2(0.048, 0.440), // Deep interior wall
  new THREE.Vector2(0.000, 0.420)  // Interior floor cap
];

const latheGeo = new THREE.LatheGeometry(profilePoints, 48);
const amphoraBody = new THREE.Mesh(latheGeo, bodyMaterial);
amphoraBody.name = "amphora_lathe_vessel_body";
amphoraRoot.add(amphoraBody);

// 2. Molded Torus Rings (Foot Fillet, Stem Collar, Neck Astragal, Rolled Lip Rim)
const ringConfigs = [
  { name: "foot_torus_molding", y: 0.012, majorR: 0.094, tubeR: 0.011, mat: blackGlazeMaterial },
  { name: "foot_step_fillet", y: 0.030, majorR: 0.080, tubeR: 0.006, mat: terracottaMaterial },
  { name: "stem_astragal_ring", y: 0.060, majorR: 0.047, tubeR: 0.007, mat: terracottaMaterial },
  { name: "neck_base_collar_ring", y: 0.462, majorR: 0.064, tubeR: 0.006, mat: terracottaMaterial },
  { name: "rolled_lip_rim_torus", y: 0.592, majorR: 0.086, tubeR: 0.011, mat: blackGlazeMaterial }
];

ringConfigs.forEach((cfg) => {
  const ringGeo = new THREE.TorusGeometry(cfg.majorR, cfg.tubeR, 16, 48);
  const ringMesh = new THREE.Mesh(ringGeo, cfg.mat);
  ringMesh.name = cfg.name;
  ringMesh.rotation.x = Math.PI / 2;
  ringMesh.position.y = cfg.y;
  amphoraRoot.add(ringMesh);
});

// 3. Symmetrically Curved Twin Handles (Arching from Shoulder to Neck)
// Classical neck-amphora handles are often "triple-reed" or "twin-reed" straps
const handleSides = [
  { side: 1, prefix: "right_handle" },
  { side: -1, prefix: "left_handle" }
];

handleSides.forEach(({ side, prefix }) => {
  const handleGroup = new THREE.Group();
  handleGroup.name = `${prefix}_group`;
  amphoraRoot.add(handleGroup);

  // Twin parallel reed tubes per handle for rich sculptural detail
  const zOffsets = [-0.009, 0.009];
  zOffsets.forEach((zOff, idx) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.125, 0.415, zOff),
      new THREE.Vector3(side * 0.168, 0.445, zOff * 1.15),
      new THREE.Vector3(side * 0.182, 0.495, zOff * 1.2),
      new THREE.Vector3(side * 0.162, 0.548, zOff * 1.15),
      new THREE.Vector3(side * 0.112, 0.562, zOff),
      new THREE.Vector3(side * 0.062, 0.548, zOff * 0.85)
    ]);

    const tubeGeo = new THREE.TubeGeometry(curve, 32, 0.0105, 14, false);
    const tubeMesh = new THREE.Mesh(tubeGeo, blackGlazeMaterial);
    tubeMesh.name = `${prefix}_reed_${idx + 1}`;
    handleGroup.add(tubeMesh);
  });

  // Central terracotta accent spine between the twin reeds
  const centerCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(side * 0.125, 0.415, 0),
    new THREE.Vector3(side * 0.170, 0.445, 0),
    new THREE.Vector3(side * 0.185, 0.495, 0),
    new THREE.Vector3(side * 0.164, 0.548, 0),
    new THREE.Vector3(side * 0.112, 0.562, 0),
    new THREE.Vector3(side * 0.062, 0.548, 0)
  ]);
  const spineGeo = new THREE.TubeGeometry(centerCurve, 32, 0.007, 12, false);
  const spineMesh = new THREE.Mesh(spineGeo, terracottaMaterial);
  spineMesh.name = `${prefix}_center_spine`;
  handleGroup.add(spineMesh);

  // Decorative volute/palmette attachment bosses at shoulder and neck
  const shoulderAttachmentGeo = new THREE.CylinderGeometry(0.018, 0.022, 0.026, 16);
  const shoulderBoss = new THREE.Mesh(shoulderAttachmentGeo, terracottaMaterial);
  shoulderBoss.name = `${prefix}_shoulder_attachment`;
  shoulderBoss.position.set(side * 0.124, 0.412, 0);
  shoulderBoss.rotation.z = -side * 0.65;
  handleGroup.add(shoulderBoss);

  const neckAttachmentGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.028, 16);
  const neckBoss = new THREE.Mesh(neckAttachmentGeo, terracottaMaterial);
  neckBoss.name = `${prefix}_neck_attachment`;
  neckBoss.position.set(side * 0.064, 0.548, 0);
  neckBoss.rotation.z = Math.PI / 2;
  handleGroup.add(neckBoss);
});

// Camera Framing (Amphora height = 0.60m, max width = 0.39m, bounding radius ~0.32m)
camera.position.set(0.0, 0.36, 0.82);
camera.lookAt(0, 0.30, 0);
