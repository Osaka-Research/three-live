const lotusRoot = new THREE.Group();
lotusRoot.name = "sacred_lotus_on_lily_pad_root";
scene.add(lotusRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff7e6, 1.35);
sunLight.name = "morning_sun_light";
sunLight.position.set(1.2, 2.2, 1.4);
scene.add(sunLight);

const softPinkLight = new THREE.PointLight(0xffb6d9, 0.75, 3.0);
softPinkLight.name = "lotus_core_glow_light";
softPinkLight.position.set(0, 0.25, 0);
scene.add(softPinkLight);

// Materials
const lilyPadMat = new THREE.MeshStandardMaterial({
  color: 0x2d6a3e,
  roughness: 0.62,
  metalness: 0.04
});

const lilyVeinMat = new THREE.MeshStandardMaterial({
  color: 0x529458,
  roughness: 0.55,
  metalness: 0.03
});

const innerPetalMat = new THREE.MeshPhysicalMaterial({
  color: 0xf472b6,
  roughness: 0.28,
  metalness: 0.02,
  clearcoat: 0.35,
  sheen: 0.6,
  sheenColor: 0xffd1e8
});

const midPetalMat = new THREE.MeshPhysicalMaterial({
  color: 0xf9a8d4,
  roughness: 0.30,
  metalness: 0.02,
  clearcoat: 0.3,
  sheen: 0.5,
  sheenColor: 0xffe4f2
});

const outerPetalMat = new THREE.MeshPhysicalMaterial({
  color: 0xfbcfe8,
  roughness: 0.34,
  metalness: 0.02,
  clearcoat: 0.25
});

const receptacleMat = new THREE.MeshStandardMaterial({
  color: 0xeab308,
  roughness: 0.48,
  metalness: 0.08
});

const carpelSeedMat = new THREE.MeshStandardMaterial({
  color: 0xa16207,
  roughness: 0.4,
  metalness: 0.05
});

const stamenMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  emissive: 0xca8a04,
  emissiveIntensity: 0.2,
  roughness: 0.35
});

// 1. Notched Circular Green Lily Pad (~0.52m diameter, resting at y = 0)
const lilyPadGroup = new THREE.Group();
lilyPadGroup.name = "notched_lily_pad_group";
lotusRoot.add(lilyPadGroup);

const padRadius = 0.26;
const notchHalfAngle = 0.22; // V-notch angle in radians
const padShape = new THREE.Shape();
padShape.moveTo(0.02 * Math.cos(notchHalfAngle), 0.02 * Math.sin(notchHalfAngle));
padShape.absarc(0, 0, padRadius, notchHalfAngle, Math.PI * 2.0 - notchHalfAngle, false);
padShape.lineTo(0.02 * Math.cos(-notchHalfAngle), 0.02 * Math.sin(-notchHalfAngle));
padShape.closePath();

const padExtrudeGeo = new THREE.ExtrudeGeometry(padShape, {
  depth: 0.008,
  bevelEnabled: true,
  bevelThickness: 0.004,
  bevelSize: 0.005,
  bevelSegments: 3,
  curveSegments: 48
});
const lilyPadMesh = new THREE.Mesh(padExtrudeGeo, lilyPadMat);
lilyPadMesh.name = "lily_pad_notched_leaf";
lilyPadMesh.rotation.x = Math.PI / 2;
lilyPadMesh.position.y = 0.012;
lilyPadGroup.add(lilyPadMesh);

// Radial veins across the upper surface of the lily pad (CylinderGeometry)
const numVeins = 14;
for (let v = 0; v < numVeins; v++) {
  const angle = notchHalfAngle + 0.15 + (v / (numVeins - 1)) * (Math.PI * 2.0 - 2.0 * (notchHalfAngle + 0.15));
  const veinLen = padRadius * 0.88;
  const veinGeo = new THREE.CylinderGeometry(0.0015, 0.0035, veinLen, 8);
  const veinMesh = new THREE.Mesh(veinGeo, lilyVeinMat);
  veinMesh.name = `lily_pad_radial_vein_${v + 1}`;
  veinMesh.position.set(
    Math.cos(angle) * (veinLen * 0.5 + 0.015),
    0.013,
    Math.sin(angle) * (veinLen * 0.5 + 0.015)
  );
  veinMesh.rotation.z = -Math.PI / 2;
  veinMesh.rotation.y = -angle;
  lilyPadGroup.add(veinMesh);
}

// 2. Golden Seed Pod Receptacle (LatheGeometry + SphereGeometry Carpels)
const centerGroup = new THREE.Group();
centerGroup.name = "lotus_seed_pod_and_stamens_group";
centerGroup.position.set(0, 0.014, 0);
lotusRoot.add(centerGroup);

const receptacleProfile = [
  new THREE.Vector2(0.000, 0.000),
  new THREE.Vector2(0.016, 0.002),
  new THREE.Vector2(0.022, 0.022),
  new THREE.Vector2(0.036, 0.052),
  new THREE.Vector2(0.048, 0.078),
  new THREE.Vector2(0.045, 0.084),
  new THREE.Vector2(0.000, 0.082)
];
const receptacleGeo = new THREE.LatheGeometry(receptacleProfile, 32);
const receptacleMesh = new THREE.Mesh(receptacleGeo, receptacleMat);
receptacleMesh.name = "lotus_conical_seed_pod_receptacle";
centerGroup.add(receptacleMesh);

// Embedded seed carpels on the flat top of the golden receptacle
const seedPositions = [[0, 0]];
for (let i = 0; i < 6; i++) {
  const a = (i / 6) * Math.PI * 2.0;
  seedPositions.push([Math.cos(a) * 0.016, Math.sin(a) * 0.016]);
}
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2.0 + 0.25;
  seedPositions.push([Math.cos(a) * 0.032, Math.sin(a) * 0.032]);
}
seedPositions.forEach(([sx, sz], idx) => {
  const seedMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.0045, 10, 8),
    carpelSeedMat
  );
  seedMesh.name = `lotus_receptacle_seed_carpel_${idx + 1}`;
  seedMesh.position.set(sx, 0.083, sz);
  centerGroup.add(seedMesh);
});

// 3. Ring of Golden Stamens (CylinderGeometry Filaments + SphereGeometry Anthers)
const numStamens = 36;
for (let s = 0; s < numStamens; s++) {
  const ring = s % 2;
  const angle = (s / numStamens) * Math.PI * 2.0;
  const baseR = 0.026 + ring * 0.007;
  const h = 0.068 + ring * 0.008;

  const stamenUnit = new THREE.Group();
  stamenUnit.name = `lotus_stamen_unit_${s + 1}`;
  stamenUnit.position.set(Math.cos(angle) * baseR, 0.018, Math.sin(angle) * baseR);
  stamenUnit.rotation.y = -angle;
  stamenUnit.rotation.z = -(0.28 + ring * 0.14);
  centerGroup.add(stamenUnit);

  const filamentMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0014, 0.0018, h, 6),
    stamenMat
  );
  filamentMesh.name = `lotus_stamen_filament_${s + 1}`;
  filamentMesh.position.y = h * 0.5;
  stamenUnit.add(filamentMesh);

  const antherMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.0032, 8, 8),
    stamenMat
  );
  antherMesh.name = `lotus_stamen_anther_${s + 1}`;
  antherMesh.position.y = h + 0.002;
  antherMesh.scale.set(0.8, 1.8, 0.8);
  stamenUnit.add(antherMesh);
}

// 4. Three Concentric Rings of Cupped, Pointed Pink Petals (Shape + ExtrudeGeometry)
function createPointedPetalGeometry(length, halfWidth, thickness) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(halfWidth * 0.9, length * 0.18, halfWidth * 1.15, length * 0.58, 0, length);
  shape.bezierCurveTo(-halfWidth * 1.15, length * 0.58, -halfWidth * 0.9, length * 0.18, 0, 0);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: thickness * 0.6,
    bevelSize: halfWidth * 0.08,
    bevelSegments: 3,
    curveSegments: 20
  });
  return geo;
}

const petalsGroup = new THREE.Group();
petalsGroup.name = "lotus_concentric_petals_group";
petalsGroup.position.set(0, 0.016, 0);
lotusRoot.add(petalsGroup);

const petalRings = [
  {
    ringName: "inner_ring",
    count: 8,
    baseRadius: 0.036,
    length: 0.125,
    halfWidth: 0.032,
    tiltAngle: 0.52, // Upright cupped around seed pod
    angleOffset: 0.0,
    mat: innerPetalMat
  },
  {
    ringName: "middle_ring",
    count: 12,
    baseRadius: 0.052,
    length: 0.155,
    halfWidth: 0.040,
    tiltAngle: 0.88, // Mid-angle bloom
    angleOffset: Math.PI / 12,
    mat: midPetalMat
  },
  {
    ringName: "outer_ring",
    count: 14,
    baseRadius: 0.068,
    length: 0.175,
    halfWidth: 0.044,
    tiltAngle: 1.24, // Wide-open outer petals resting above lily pad
    angleOffset: Math.PI / 14,
    mat: outerPetalMat
  }
];

petalRings.forEach((ring) => {
  const petalGeo = createPointedPetalGeometry(ring.length, ring.halfWidth, 0.005);
  for (let i = 0; i < ring.count; i++) {
    const theta = (i / ring.count) * Math.PI * 2.0 + ring.angleOffset;
    const pivot = new THREE.Group();
    pivot.name = `lotus_${ring.ringName}_petal_pivot_${i + 1}`;
    pivot.position.set(
      Math.cos(theta) * ring.baseRadius,
      0.004,
      Math.sin(theta) * ring.baseRadius
    );
    // Orient outward along theta, then tilt outward from vertical (+Y)
    pivot.rotation.y = -theta - Math.PI / 2;
    pivot.rotation.x = ring.tiltAngle;
    petalsGroup.add(pivot);

    const petalMesh = new THREE.Mesh(petalGeo, ring.mat);
    petalMesh.name = `lotus_${ring.ringName}_petal_${i + 1}`;
    pivot.add(petalMesh);
  }
});

// Camera Framing (lily pad diameter = 0.52m, flower height ~0.16m, bounding radius ~0.28m)
camera.position.set(0.0, 0.38, 0.65);
camera.lookAt(0, 0.07, 0);
