// mat_19: Arctic Iceberg Lagoon under Aurora Ribbons
const root = new THREE.Group();
root.name = "ArcticIcebergAuroraLagoonRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "ArcticAmbientLight";
scene.add(ambientLight);

const polarDirLight = new THREE.DirectionalLight(0xaaccff, 1.1);
polarDirLight.name = "PolarMoonDirectionalLight";
polarDirLight.position.set(-2.0, 3.0, 1.5);
scene.add(polarDirLight);

const greenAuroraPoint = new THREE.PointLight(0x22ff99, 2.6, 5.0);
greenAuroraPoint.name = "AuroraGreenSkyPointLight";
greenAuroraPoint.position.set(-0.6, 1.65, -0.4);
scene.add(greenAuroraPoint);

const violetAuroraPoint = new THREE.PointLight(0xb844ff, 2.2, 5.0);
violetAuroraPoint.name = "AuroraVioletSkyPointLight";
violetAuroraPoint.position.set(0.65, 1.75, -0.5);
scene.add(violetAuroraPoint);

// Materials
const darkArcticWaterMat = new THREE.MeshPhysicalMaterial({
  color: 0x071828,
  roughness: 0.05,
  metalness: 0.15,
  clearcoat: 1.0,
  clearcoatRoughness: 0.03,
  ior: 1.333
});

const glacialIceMat = new THREE.MeshPhysicalMaterial({
  color: 0xdff6ff,
  roughness: 0.09,
  metalness: 0.0,
  transmission: 0.92,
  ior: 1.31,
  thickness: 0.35,
  attenuationColor: 0x1ea8e8,
  attenuationDistance: 0.42,
  clearcoat: 0.85,
  clearcoatRoughness: 0.08,
  flatShading: true
});

const snowCapIceMat = new THREE.MeshPhysicalMaterial({
  color: 0xf2fbff,
  roughness: 0.25,
  metalness: 0.0,
  transmission: 0.72,
  ior: 1.31,
  thickness: 0.18,
  attenuationColor: 0x66ccff,
  attenuationDistance: 0.35,
  flatShading: true
});

// 1. Dark Reflective Arctic Lagoon Water Plane (3.0m x 3.0m at y = 0)
const waterPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(3.0, 3.0, 24, 24),
  darkArcticWaterMat
);
waterPlane.name = "ReflectiveArcticLagoonWater";
waterPlane.rotation.x = -Math.PI / 2;
waterPlane.position.set(0, 0.0, 0);
root.add(waterPlane);

// 2. Faceted Translucent Blue-White Icebergs & Drifting Ice Floes (`transmission`, `ior: 1.31`)
const icebergGroup = new THREE.Group();
icebergGroup.name = "ArcticIcebergsGroup";
root.add(icebergGroup);

const icebergSpireSpecs = [
  // Central cathedral iceberg cluster
  { x: -0.15, z: -0.10, r: 0.38, h: 0.88, segs: 6, rotY: 0.3, tiltZ: 0.08, mat: glacialIceMat },
  { x: 0.08, z: -0.05, r: 0.30, h: 0.68, segs: 5, rotY: 1.1, tiltZ: -0.12, mat: snowCapIceMat },
  { x: -0.32, z: 0.05, r: 0.24, h: 0.50, segs: 5, rotY: 2.0, tiltZ: 0.15, mat: glacialIceMat },
  // Left tabular & spire berg
  { x: -0.85, z: 0.35, r: 0.32, h: 0.62, segs: 6, rotY: 0.8, tiltZ: -0.06, mat: glacialIceMat },
  { x: -0.68, z: 0.42, r: 0.22, h: 0.42, segs: 5, rotY: 1.7, tiltZ: 0.10, mat: snowCapIceMat },
  // Right jagged pinnacle berg
  { x: 0.78, z: 0.22, r: 0.34, h: 0.74, segs: 6, rotY: 0.4, tiltZ: -0.09, mat: glacialIceMat },
  { x: 0.58, z: 0.30, r: 0.24, h: 0.46, segs: 5, rotY: 2.4, tiltZ: 0.14, mat: snowCapIceMat },
  // Background bergs
  { x: 0.42, z: -0.68, r: 0.28, h: 0.54, segs: 5, rotY: 1.2, tiltZ: 0.05, mat: glacialIceMat },
  { x: -0.62, z: -0.62, r: 0.26, h: 0.48, segs: 6, rotY: 0.5, tiltZ: -0.07, mat: glacialIceMat }
];

for (let i = 0; i < icebergSpireSpecs.length; i++) {
  const sp = icebergSpireSpecs[i];
  const spire = new THREE.Mesh(
    new THREE.ConeGeometry(sp.r, sp.h, sp.segs),
    sp.mat
  );
  spire.name = "FacetedIcebergSpire_" + i;
  spire.position.set(sp.x, sp.h * 0.44, sp.z);
  spire.rotation.y = sp.rotY;
  spire.rotation.z = sp.tiltZ;
  icebergGroup.add(spire);
}

// Low floating ice floe slabs scattered across the lagoon
const floeCoords = [
  [-0.35, 0.65, 0.18],
  [0.18, 0.58, 0.22],
  [0.52, 0.72, 0.15],
  [-0.78, -0.15, 0.16],
  [0.88, -0.35, 0.19],
  [-0.05, 0.85, 0.14]
];
for (let f = 0; f < floeCoords.length; f++) {
  const fc = floeCoords[f];
  const floe = new THREE.Mesh(
    new THREE.ConeGeometry(fc[2], 0.055, 6),
    snowCapIceMat
  );
  floe.name = "FloatingIceFloe_" + f;
  floe.position.set(fc[0], 0.015, fc[1]);
  floe.rotation.y = f * 0.9;
  icebergGroup.add(floe);
}

// 3. Three Undulating Emissive Green-and-Violet Aurora Borealis Curtains in the Sky (Custom BufferGeometry)
const auroraGroup = new THREE.Group();
auroraGroup.name = "AuroraBorealisCurtainsGroup";
root.add(auroraGroup);

function buildAuroraCurtain(index, zBase, yBottom, height, colorHex, emissiveHex, phase) {
  const cols = 40;
  const rows = 8;
  const positions = [];
  const indices = [];

  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      const x = (u - 0.5) * 2.7;
      // Sinuous ribbon wave in Z and vertical ripple in Y
      const zWave =
        zBase +
        Math.sin(u * Math.PI * 2.8 + phase) * 0.28 +
        Math.cos(u * Math.PI * 5.2 - phase * 0.7) * 0.11 +
        v * 0.08;
      const yWave =
        yBottom +
        v * height +
        Math.sin(u * Math.PI * 3.5 + phase) * 0.07;

      positions.push(x, yWave, zWave);
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const row1 = r * (cols + 1);
      const row2 = (r + 1) * (cols + 1);
      const a = row1 + c;
      const b = row1 + c + 1;
      const d = row2 + c;
      const e = row2 + c + 1;
      indices.push(a, d, b);
      indices.push(b, d, e);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshPhysicalMaterial({
    color: colorHex,
    emissive: emissiveHex,
    emissiveIntensity: 2.1,
    roughness: 0.2,
    transmission: 0.75,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide
  });

  const curtainMesh = new THREE.Mesh(geo, mat);
  curtainMesh.name = "UndulatingAuroraCurtain_" + index;
  curtainMesh.userData.xr = { bloom: { strength: 0.85 } };
  auroraGroup.add(curtainMesh);
}

// Build 3 distinct undulating green-and-violet aurora curtains
buildAuroraCurtain(0, -0.55, 1.18, 0.52, 0x22ff99, 0x00dd77, 0.0);
buildAuroraCurtain(1, -0.25, 1.30, 0.56, 0xb844ff, 0x9922ff, 1.6);
buildAuroraCurtain(2, -0.82, 1.38, 0.48, 0x33ffcc, 0x11ccaa, 3.1);

// Camera framing (~3.0m wide seascape -> distance ~3.6m)
camera.position.set(0.0, 1.35, 3.45);
camera.lookAt(0, 0.65, -0.15);
