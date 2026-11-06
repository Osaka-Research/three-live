// Degraded Alias Showcase: CapsuleGeometry, RingGeometry, SpotLight, HemisphereLight
scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x1e293b, 0.7));
const spot = new THREE.SpotLight(0xfff7ed, 2.0, 12, Math.PI / 5, 0.3);
spot.position.set(2, 4, 2);
scene.add(spot);

const ring = new THREE.Mesh(
  new THREE.RingGeometry(0.4, 0.8, 32),
  new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.8, roughness: 0.2 })
);
ring.name = 'golden_halo_ring';
ring.position.set(0, 0.6, 0);
scene.add(ring);

const capsule = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.2, 0.5, 8, 16),
  new THREE.MeshPhysicalMaterial({ color: 0x38bdf8, transmission: 0.8, roughness: 0.1 })
);
capsule.name = 'core_capsule';
capsule.position.set(0, 0.6, 0);
scene.add(capsule);

camera.position.set(0, 1.2, 2.6);
camera.lookAt(0, 0.6, 0);
