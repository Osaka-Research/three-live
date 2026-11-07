const mobiusSculptureRoot = new THREE.Group();
mobiusSculptureRoot.name = "twisted_mobius_ribbon_sculpture_root";
scene.add(mobiusSculptureRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const galleryKeyLight = new THREE.DirectionalLight(0xfff4e0, 1.45);
galleryKeyLight.name = "gallery_spotlight_directional";
galleryKeyLight.position.set(1.8, 3.0, 2.2);
scene.add(galleryKeyLight);

const warmBronzeRimLight = new THREE.PointLight(0xffb454, 1.1, 5.0);
warmBronzeRimLight.name = "warm_bronze_rim_light";
warmBronzeRimLight.position.set(-1.5, 1.4, -1.5);
scene.add(warmBronzeRimLight);

const coolFillLight = new THREE.PointLight(0x93c5fd, 0.7, 5.0);
coolFillLight.name = "museum_skylight_fill";
coolFillLight.position.set(1.2, 0.8, -1.2);
scene.add(coolFillLight);

// Procedural Brushed Bronze Anisotropic Grain DataTexture
function createBrushedBronzeTexture() {
  const width = 256;
  const height = 64;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Longitudinal brushed striations along u
      const streak =
        0.5 +
        0.25 * Math.sin(y * 1.9 + Math.sin(x * 0.08) * 1.5) +
        0.15 * Math.cos(y * 5.3 + x * 0.03);
      const r = Math.min(255, Math.floor(188 + streak * 32));
      const g = Math.min(255, Math.floor(132 + streak * 26));
      const b = Math.min(255, Math.floor(74 + streak * 18));
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

const brushedBronzeMat = new THREE.MeshPhysicalMaterial({
  map: createBrushedBronzeTexture(),
  color: 0xd49452,
  metalness: 0.88,
  roughness: 0.24,
  clearcoat: 0.45,
  clearcoatRoughness: 0.18,
  iridescence: 0.15,
  iridescenceIOR: 1.4
});

const patinatedBronzeCoreMat = new THREE.MeshPhysicalMaterial({
  color: 0x8c5828,
  metalness: 0.85,
  roughness: 0.30,
  clearcoat: 0.35
});

const darkGraniteMat = new THREE.MeshPhysicalMaterial({
  color: 0x1e2024,
  roughness: 0.22,
  metalness: 0.15,
  clearcoat: 0.65,
  clearcoatRoughness: 0.15
});

const graniteStepMat = new THREE.MeshStandardMaterial({
  color: 0x2c3036,
  roughness: 0.45,
  metalness: 0.1
});

// 1. Stepped Dark Granite Gallery Plinth (BoxGeometry tiers resting at y = 0, height = 0.42m)
const plinthGroup = new THREE.Group();
plinthGroup.name = "dark_granite_plinth_group";
mobiusSculptureRoot.add(plinthGroup);

const plinthFootBox = new THREE.Mesh(
  new THREE.BoxGeometry(0.68, 0.06, 0.68),
  graniteStepMat
);
plinthFootBox.name = "granite_plinth_base_step";
plinthFootBox.position.set(0, 0.03, 0);
plinthGroup.add(plinthFootBox);

const plinthMainColumn = new THREE.Mesh(
  new THREE.BoxGeometry(0.56, 0.32, 0.56),
  darkGraniteMat
);
plinthMainColumn.name = "granite_plinth_main_pedestal";
plinthMainColumn.position.set(0, 0.22, 0);
plinthGroup.add(plinthMainColumn);

const plinthCapSlab = new THREE.Mesh(
  new THREE.BoxGeometry(0.60, 0.04, 0.60),
  graniteStepMat
);
plinthCapSlab.name = "granite_plinth_top_cap";
plinthCapSlab.position.set(0, 0.40, 0);
plinthGroup.add(plinthCapSlab);

// Brushed bronze museum title plaque on front of plinth
const titlePlaque = new THREE.Mesh(
  new THREE.BoxGeometry(0.20, 0.065, 0.012),
  brushedBronzeMat
);
titlePlaque.name = "plinth_bronze_museum_plaque";
titlePlaque.position.set(0, 0.24, 0.282);
plinthGroup.add(titlePlaque);

// Twin bronze mounting pins anchoring the ribbon sculpture to the granite plinth
[-0.08, 0.08].forEach((xOff, i) => {
  const mountPin = new THREE.Mesh(
    new THREE.BoxGeometry(0.038, 0.10, 0.038),
    patinatedBronzeCoreMat
  );
  mountPin.name = `sculpture_mounting_strut_${i + 1}`;
  mountPin.position.set(xOff, 0.45, 0);
  plinthGroup.add(mountPin);
});

// 2. Monumental Twisted Möbius / Trefoil Ribbon Sculpture (y = 0.44m to y = 1.50m, ~1.5m total height)
const sculptureGroup = new THREE.Group();
sculptureGroup.name = "twisted_mobius_ribbon_sculpture_group";
sculptureGroup.position.set(0, 0.96, 0);
mobiusSculptureRoot.add(sculptureGroup);

// Build a thick solid 3D Twisted Möbius Ribbon via Custom Indexed BufferGeometry + Float32BufferAttribute
function createTwistedMobiusRibbonGeometry() {
  const uSteps = 220; // Along closed loop (0 to 2*PI)
  const vSteps = 24;  // Around ribbon cross-section perimeter (smooth beveled rectangular strap)
  const R = 0.36;     // Major radius of Möbius / trefoil centerline
  const ribbonHalfWidth = 0.135;
  const ribbonHalfThick = 0.022;

  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= uSteps; i++) {
    const uFrac = i / uSteps;
    const t = uFrac * Math.PI * 2.0;

    // 3D sculpted Möbius-trefoil centerline with graceful vertical rise
    const cx = (R + 0.06 * Math.cos(3.0 * t)) * Math.cos(t);
    const cy = (R * 1.15 + 0.06 * Math.cos(3.0 * t)) * Math.sin(t);
    const cz = 0.14 * Math.sin(2.0 * t);
    const center = new THREE.Vector3(cx, cy, cz);

    // Analytic tangent via finite difference for rock-solid Frenet-like frame
    const dt = 0.001;
    const tNext = t + dt;
    const nx = (R + 0.06 * Math.cos(3.0 * tNext)) * Math.cos(tNext);
    const ny = (R * 1.15 + 0.06 * Math.cos(3.0 * tNext)) * Math.sin(tNext);
    const nz = 0.14 * Math.sin(2.0 * tNext);
    const tangent = new THREE.Vector3(nx - cx, ny - cy, nz - cz).normalize();

    // Radial outward reference vector & binormal
    const radialRef = new THREE.Vector3(Math.cos(t), Math.sin(t), 0).normalize();
    const binormal = new THREE.Vector3().crossVectors(tangent, radialRef).normalize();
    const normal = new THREE.Vector3().crossVectors(binormal, tangent).normalize();

    // Continuous 1.5x half-twist (3 * PI) around the loop for dramatic Möbius sculptural torsion
    const twistAngle = 1.5 * t;
    const cosTw = Math.cos(twistAngle);
    const sinTw = Math.sin(twistAngle);

    // Twisted cross-section axes W (width axis) and H (thickness axis)
    const axisW = new THREE.Vector3()
      .addScaledVector(normal, cosTw)
      .addScaledVector(binormal, sinTw);
    const axisH = new THREE.Vector3()
      .addScaledVector(normal, -sinTw)
      .addScaledVector(binormal, cosTw);

    for (let j = 0; j <= vSteps; j++) {
      const vFrac = j / vSteps;
      const phi = vFrac * Math.PI * 2.0;
      // Superellipse profile for a crisp architectural bronze ribbon with rounded edges
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);
      const localW = Math.sign(cosP) * Math.pow(Math.abs(cosP), 0.55) * ribbonHalfWidth;
      const localH = Math.sign(sinP) * Math.pow(Math.abs(sinP), 0.55) * ribbonHalfThick;

      const vx = center.x + axisW.x * localW + axisH.x * localH;
      const vy = center.y + axisW.y * localW + axisH.y * localH;
      const vz = center.z + axisW.z * localW + axisH.z * localH;

      positions.push(vx, vy, vz);
      uvs.push(uFrac * 6.0, vFrac);
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
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const mobiusRibbonMesh = new THREE.Mesh(
  createTwistedMobiusRibbonGeometry(),
  brushedBronzeMat
);
mobiusRibbonMesh.name = "mobius_twisted_bronze_ribbon_mesh";
sculptureGroup.add(mobiusRibbonMesh);

// 3. Intertwined Trefoil Inner Core Filament via TorusKnotGeometry
const trefoilCoreGeo = new THREE.TorusKnotGeometry(0.24, 0.022, 140, 20, 2, 3);
const trefoilCoreMesh = new THREE.Mesh(trefoilCoreGeo, patinatedBronzeCoreMat);
trefoilCoreMesh.name = "trefoil_torus_knot_inner_core";
trefoilCoreMesh.scale.set(1.0, 1.12, 0.85);
sculptureGroup.add(trefoilCoreMesh);

// Subtle gallery turntable presentation rotation
function animate(t) {
  sculptureGroup.rotation.y = Math.sin(t * 0.35) * 0.25;
}

// Camera Framing (total height ~1.50m, plinth width 0.68m, ribbon width ~1.05m, center ~0.75m)
camera.position.set(0.0, 0.85, 1.95);
camera.lookAt(0, 0.75, 0);
