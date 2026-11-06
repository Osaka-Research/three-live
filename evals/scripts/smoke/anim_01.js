// Stadium Amphitheater Seating Bowl (InstancedMesh with per-instance Matrix4 & Color)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.3);
sun.position.set(4, 8, 5);
scene.add(sun);

const stage = new THREE.Mesh(
  new THREE.CylinderGeometry(0.8, 0.85, 0.12, 24),
  new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
);
stage.name = 'center_stage';
stage.position.y = 0.06;
scene.add(stage);

const seatGeo = new THREE.BoxGeometry(0.12, 0.14, 0.12);
const seatMat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 });
const seats = new THREE.InstancedMesh(seatGeo, seatMat, 120);
seats.name = 'stadium_seats';

const dummy = new THREE.Object3D();
const color = new THREE.Color();
let idx = 0;
for (let row = 0; row < 5; row++) {
  const radius = 1.2 + row * 0.28;
  const y = 0.15 + row * 0.16;
  for (let s = 0; s < 24; s++) {
    const theta = -Math.PI * 0.4 + (s / 23) * Math.PI * 0.8;
    dummy.position.set(Math.sin(theta) * radius, y, -Math.cos(theta) * radius);
    dummy.lookAt(0, 0.1, 0);
    dummy.updateMatrix();
    seats.setMatrixAt(idx, dummy.matrix);
    color.setRGB(0.2 + row * 0.15, 0.5, 0.9 - row * 0.12);
    seats.setColorAt(idx, color);
    idx++;
  }
}
scene.add(seats);

camera.position.set(0, 2.6, 3.8);
camera.lookAt(0, 0.4, -0.8);
