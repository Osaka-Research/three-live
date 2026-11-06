// PBR Material Calibration Matrix (5x5 Spheres with Transmission, Iridescence, Clearcoat)
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.4);
key.position.set(3, 6, 4);
scene.add(key);
const rim = new THREE.PointLight(0x38bdf8, 1.2, 10);
rim.position.set(-3, 2, -2);
scene.add(rim);

const pedestal = new THREE.Mesh(
  new THREE.BoxGeometry(2.6, 0.08, 2.6),
  new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.2 })
);
pedestal.name = 'pedestal_base';
pedestal.position.y = 0.04;
scene.add(pedestal);

const sphereGeo = new THREE.SphereGeometry(0.16, 24, 16);
for (let r = 0; r < 5; r++) {
  for (let c = 0; c < 5; c++) {
    const mat = new THREE.MeshPhysicalMaterial({
      color: r === 4 ? 0xe0f2fe : 0x6366f1,
      metalness: r / 4,
      roughness: 0.05 + (c / 4) * 0.9,
      clearcoat: r === 2 ? 1.0 : 0.0,
      iridescence: r === 3 ? 1.0 : 0.0,
      transmission: r === 4 ? 0.92 : 0.0,
      ior: 1.5,
      thickness: 0.3,
    });
    const s = new THREE.Mesh(sphereGeo, mat);
    s.name = 'pbr_sphere_' + r + '_' + c;
    s.position.set((c - 2) * 0.48, 0.24, (r - 2) * 0.48);
    scene.add(s);
  }
}

camera.position.set(0, 2.4, 3.4);
camera.lookAt(0, 0.2, 0);
