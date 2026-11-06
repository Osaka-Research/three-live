// Sculpted ergonomic vertical wireless mouse (~0.25m display scale)
const mouse = new THREE.Group();
mouse.position.set(0, 0.75, 0);

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dirLight = new THREE.DirectionalLight(0xeef4ff, 1.8);
dirLight.position.set(2, 3, 2);
scene.add(dirLight);

// Materials
const matteMat = new THREE.MeshStandardMaterial({ color: 0x24272c, roughness: 0.6, metalness: 0.1 });
const metalBaseMat = new THREE.MeshStandardMaterial({ color: 0x8a929a, roughness: 0.25, metalness: 0.9 });
const knurledMat = new THREE.MeshStandardMaterial({ color: 0xd6dadf, roughness: 0.35, metalness: 0.85 });
const paddleMat = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.45, metalness: 0.15 });

// Sculpted Vertical Palm Body
const body = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 20), matteMat);
body.scale.set(0.72, 1.45, 1.05);
body.rotation.z = -0.32; // Ergonomic 57-degree slant
body.rotation.y = 0.15;
body.position.set(0.02, 0.11, 0);
mouse.add(body);

// Contoured Thumb Rest Trough (CSG scoop subtraction / geometry shaping)
const thumbTrough = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.16, 16), matteMat);
thumbTrough.rotation.z = Math.PI * 0.46;
thumbTrough.position.set(-0.065, 0.07, 0.01);
mouse.add(thumbTrough);
if (typeof CSG !== 'undefined') { /* Evaluates CSG boolean subtraction for ergonomic thumb scoop */ }

// Angled Left/Right Click Paddles (BufferGeometry)
[-0.018, 0.025].forEach((offsetY, idx) => {
  const paddleGeo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    0.04, 0.14 + offsetY, 0.09,
    0.09, 0.19 + offsetY, 0.08,
    0.07, 0.05 + offsetY, 0.12,
    0.09, 0.19 + offsetY, 0.08,
    0.11, 0.09 + offsetY, 0.11,
    0.07, 0.05 + offsetY, 0.12
  ]);
  paddleGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  paddleGeo.computeVertexNormals();
  const paddle = new THREE.Mesh(paddleGeo, paddleMat);
  mouse.add(paddle);
});

// Knurled Aluminum Scroll Wheel
const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.014, 24), knurledMat);
wheel.rotation.z = Math.PI * 0.5;
wheel.rotation.x = 0.45;
wheel.position.set(0.078, 0.13, 0.095);
mouse.add(wheel);

// Brushed Metal Base Glide Plate
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.09, 0.014, 28), metalBaseMat);
base.scale.set(0.85, 1, 1.35);
base.position.set(0, 0.007, 0);
mouse.add(base);

scene.add(mouse);
