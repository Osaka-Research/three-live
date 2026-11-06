// Desert oasis diorama (~3.0m square) with dunes, spring pool and date palms
const oasis = new THREE.Group();
oasis.position.set(0, 0.5, 0);

// Lighting
scene.add(new THREE.AmbientLight(0xffeedd, 0.8));
const sunLight = new THREE.DirectionalLight(0xfff0cc, 2.2);
sunLight.position.set(4, 5, 3);
scene.add(sunLight);

// Dune Sand Terrain (PlaneGeometry with procedural sine deformation)
const sandMat = new THREE.MeshStandardMaterial({ color: 0xdfb173, roughness: 0.95 });
const duneGeo = new THREE.PlaneGeometry(3.0, 3.0, 48, 48);
duneGeo.rotateX(-Math.PI * 0.5);
const pos = duneGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const x = pos.getX(i), z = pos.getZ(i);
  const dist = Math.hypot(x, z);
  let y = Math.sin(x * 2.2) * 0.12 + Math.cos(z * 1.8) * 0.14 + (dist > 0.8 ? (dist - 0.8) * 0.35 : -0.08 * (1 - dist / 0.8));
  pos.setY(i, y);
}
duneGeo.computeVertexNormals();
const dunes = new THREE.Mesh(duneGeo, sandMat);
oasis.add(dunes);

// Clear Turquoise Spring Pool (MeshPhysicalMaterial)
const waterMat = new THREE.MeshPhysicalMaterial({
  color: 0x18c2ba,
  transmission: 0.92,
  roughness: 0.1,
  ior: 1.333,
  transparent: true,
  opacity: 0.85
});
const pool = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.65, 0.05, 32), waterMat);
pool.position.set(0, -0.015, 0);
oasis.add(pool);

// Three Curved Date Palm Trees with Frond Crowns
const barkMat = new THREE.MeshStandardMaterial({ color: 0x5a3e2a, roughness: 0.9 });
const frondMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.6, side: THREE.DoubleSide });
const palmConfigs = [[-0.65, 0.35, 0.3], [0.72, 0.42, -0.25], [-0.2, -0.75, 0.4]];

palmConfigs.forEach(([px, pz, curveDir]) => {
  const tree = new THREE.Group();
  tree.position.set(px, 0.05, pz);

  // Curved Trunk segments
  for (let s = 0; s < 7; s++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.045 - s * 0.003, 0.052 - s * 0.003, 0.14, 8), barkMat);
    seg.position.set(Math.pow(s / 6, 2) * curveDir * 0.3, s * 0.125, 0);
    seg.rotation.z = -curveDir * (s * 0.08);
    tree.add(seg);
  }

  // Frond Crown (BufferGeometry blades radiating outwards)
  const crown = new THREE.Group();
  crown.position.set(curveDir * 0.3, 0.85, 0);
  for (let f = 0; f < 8; f++) {
    const frondGeo = new THREE.BufferGeometry();
    const ang = (f * Math.PI * 2) / 8;
    const verts = new Float32Array([
      0, 0, 0,
      Math.cos(ang) * 0.4, -0.1, Math.sin(ang) * 0.4,
      Math.cos(ang + 0.2) * 0.25, -0.04, Math.sin(ang + 0.2) * 0.25
    ]);
    frondGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    frondGeo.computeVertexNormals();
    crown.add(new THREE.Mesh(frondGeo, frondMat));
  }
  tree.add(crown);
  oasis.add(tree);
});

// Sandstone Boulders
const rockMat = new THREE.MeshStandardMaterial({ color: 0xa8754b, roughness: 0.9 });
[[-0.5, 0.1, 0.8], [0.55, 0.08, 0.6], [-0.8, 0.12, -0.4]].forEach(([bx, by, bz], idx) => {
  const boulder = new THREE.Mesh(new THREE.ConeGeometry(0.18 + idx * 0.05, 0.24, 6), rockMat);
  boulder.position.set(bx, by, bz);
  boulder.rotation.set(0.3, idx * 1.5, 0.2);
  oasis.add(boulder);
});

scene.add(oasis);
