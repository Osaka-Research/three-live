const tableGroup = new THREE.Group();
tableGroup.position.set(0, 0.5, 0);
scene.add(tableGroup);

// Ambient and directional lighting
scene.add(new THREE.AmbientLight(0xddeeff, 0.6));
const sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
sunLight.position.set(2, 3, 1.5);
scene.add(sunLight);

// Command table base platform
const tableBase = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.08, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x242b30, roughness: 0.5, metalness: 0.3 })
);
tableGroup.add(tableBase);

// Topographic contour tiers
const tierHeights = [0.03, 0.06, 0.09, 0.12];
const tierRadii = [0.55, 0.42, 0.3, 0.18];
const topoColors = [0x4a7c59, 0x689b6f, 0x93b174, 0xc2be8f];

tierHeights.forEach((h, i) => {
  const tier = new THREE.Mesh(
    new THREE.CylinderGeometry(tierRadii[i] * 0.92, tierRadii[i], h, 28),
    new THREE.MeshStandardMaterial({ color: topoColors[i], roughness: 0.85 })
  );
  tier.position.set(0, 0.04 + h / 2, 0);
  tableGroup.add(tier);
});

// 8 Grabbable unit markers with cylindrical billboard badges
const markerPalette = [0x2563eb, 0xdc2626, 0x16a34a, 0xd97706, 0x7c3aed, 0x0891b2, 0xdb2777, 0xf8fafc];
for (let i = 0; i < 8; i++) {
  const markerGroup = new THREE.Group();
  const angle = (i / 8) * Math.PI * 2;
  const radius = 0.32 + (i % 2) * 0.14;
  markerGroup.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius);

  const markerBody = new THREE.Mesh(
    new THREE.ConeGeometry(0.024, 0.08, 12),
    new THREE.MeshStandardMaterial({ color: markerPalette[i], metalness: 0.4, roughness: 0.3 })
  );
  markerBody.position.y = 0.04;
  markerGroup.add(markerBody);

  const statusBadge = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.006, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  statusBadge.position.y = 0.095;
  statusBadge.rotation.x = Math.PI / 2;
  statusBadge.userData.xr = { billboard: 'cylindrical' };
  markerGroup.add(statusBadge);

  markerGroup.userData.xr = {
    grab: '1-hand',
    sync: true,
    snapTo: { grid: 0.05, surface: 'floor' },
    badge: statusBadge.userData.xr
  };

  tableGroup.add(markerGroup);
}
