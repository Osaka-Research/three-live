const seascape = new THREE.Group();
seascape.position.set(0, 0.45, 0);
scene.add(seascape);

const ambient = new THREE.AmbientLight(0x061120, 1.0);
const moon = new THREE.DirectionalLight(0x88ccff, 1.2);
moon.position.set(-2, 4, -2);
scene.add(ambient, moon);

const auroraLight = new THREE.PointLight(0x33ffaa, 2.5, 4.0);
auroraLight.position.set(0, 1.4, -0.5);
scene.add(auroraLight);

// Reflective dark arctic water (~3.0m wide)
const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x050f1a, roughness: 0.05, metalness: 0.1, transmission: 0.2, ior: 1.333, clearcoat: 1.0 });
const water = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0, 32, 32), waterMat);
water.rotation.x = -Math.PI / 2;
seascape.add(water);

// Faceted translucent blue-white icebergs (ior: 1.31)
const iceMat = new THREE.MeshPhysicalMaterial({
  color: 0xdbf0ff,
  transmission: 0.88,
  roughness: 0.12,
  ior: 1.31,
  thickness: 0.5,
  flatShading: true,
  clearcoat: 0.9,
  clearcoatRoughness: 0.1
});

const bergCoords = [
  { x: -0.5, z: -0.2, r: 0.42, h: 0.65, segs: 6 },
  { x: 0.45, z: 0.1, r: 0.35, h: 0.5, segs: 5 },
  { x: 0.1, z: -0.6, r: 0.55, h: 0.8, segs: 7 }
];

bergCoords.forEach(b => {
  const peak = new THREE.Mesh(new THREE.ConeGeometry(b.r, b.h, b.segs), iceMat);
  peak.position.set(b.x, b.h * 0.45, b.z);
  peak.rotation.y = b.x * 2;
  const keel = new THREE.Mesh(new THREE.ConeGeometry(b.r * 0.9, b.h * 0.4, b.segs), iceMat);
  keel.rotation.x = Math.PI;
  keel.position.set(b.x, -b.h * 0.15, b.z);
  seascape.add(peak, keel);
});

// Three undulating emissive green-and-violet aurora curtains in sky (BufferGeometry)
const auroraMeshes = [];
const auroraColors = [0x33ff88, 0x8844ff, 0x22ffbb];

auroraColors.forEach((col, idx) => {
  const geo = new THREE.BufferGeometry();
  const verts = [];
  const uvs = [];
  const segments = 24;
  const zOffset = -0.5 - idx * 0.35;
  const yBase = 0.9 + idx * 0.1;

  for (let s = 0; s <= segments; s++) {
    const u = s / segments;
    const x = (u - 0.5) * 2.8;
    const wave = Math.sin(u * 6 + idx) * 0.25;
    verts.push(x, yBase + Math.cos(u * 4) * 0.08, zOffset + wave);
    verts.push(x, yBase + 0.55 + Math.sin(u * 3) * 0.1, zOffset + wave * 1.3);
    uvs.push(u, 0, u, 1);
  }

  const indices = [];
  for (let s = 0; s < segments; s++) {
    const i = s * 2;
    indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const auroraMat = new THREE.MeshPhysicalMaterial({
    color: col,
    emissive: col,
    emissiveIntensity: 2.2,
    transmission: 0.7,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide
  });

  const curtain = new THREE.Mesh(geo, auroraMat);
  seascape.add(curtain);
  auroraMeshes.push({ mesh: curtain, initialVerts: verts.slice(), idx });
});

function animate(dt = 0.016) {
  const t = Date.now() * 0.0015;
  auroraMeshes.forEach(({ mesh, initialVerts, idx }) => {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z0 = initialVerts[i * 3 + 2];
      pos.setZ(i, z0 + Math.sin(t * 1.5 + i * 0.3 + idx) * 0.06);
    }
    pos.needsUpdate = true;
  });
}
