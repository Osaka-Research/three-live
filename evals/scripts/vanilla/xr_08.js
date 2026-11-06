const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(2, 4, 3);
scene.add(dirLight);

const benchGroup = new THREE.Group();
benchGroup.position.set(0, 0.7, 0);
scene.add(benchGroup);

const benchTable = new THREE.Mesh(
  new THREE.BoxGeometry(1.4, 0.05, 0.9),
  new THREE.MeshStandardMaterial({ color: 0x2d3139, roughness: 0.7 })
);
benchGroup.add(benchTable);

const moboMat = new THREE.MeshStandardMaterial({ color: 0x0f3b28, roughness: 0.4, metalness: 0.1 });
const mobo = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.015, 0.6), moboMat);
mobo.position.set(0, 0.035, 0);
benchGroup.add(mobo);

const socketMat = (col) => new THREE.MeshStandardMaterial({ color: col, roughness: 0.3 });

const cpuSocket = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.12), socketMat(0xd97706));
cpuSocket.position.set(-0.1, 0.012, -0.08);
cpuSocket.userData.xr = { snapSocket: 'cpu_socket', accept: 'cpu' };

const gpuSocket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.015, 0.04), socketMat(0x2563eb));
gpuSocket.position.set(0.05, 0.015, 0.16);
gpuSocket.userData.xr = { snapSocket: 'gpu_pcie', accept: 'gpu' };

const ram1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.02), socketMat(0x16a34a));
ram1.position.set(0.12, 0.013, -0.12);
ram1.userData.xr = { snapSocket: 'ram_dimm_1', accept: 'ram' };

const ram2 = ram1.clone();
ram2.position.set(0.12, 0.013, -0.06);
ram2.userData.xr = { snapSocket: 'ram_dimm_2', accept: 'ram' };

mobo.add(cpuSocket, gpuSocket, ram1, ram2);

const capGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12);
const capMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
[-0.22, -0.22].forEach((x, i) => {
  const cap = new THREE.Mesh(capGeo, capMat);
  cap.position.set(x, 0.02, -0.15 + i * 0.05);
  mobo.add(cap);
});

const cpu = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.1), new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.7 }));
cpu.position.set(-0.4, 0.05, -0.15);
cpu.userData.xr = { grab: '1-hand', snapTo: 'cpu_socket', explode: { offset: [0, 0.25, 0] }, label: 'Core CPU' };

const gpu = new THREE.Group();
gpu.position.set(0.4, 0.08, 0.15);
const gpuBoard = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0x1d4ed8, metalness: 0.6 }));
const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 16), new THREE.MeshStandardMaterial({ color: 0x111827 }));
fan.rotation.x = Math.PI / 2;
fan.position.z = 0.02;
gpu.add(gpuBoard, fan);
gpu.userData.xr = { grab: '1-hand', snapTo: 'gpu_pcie', explode: { offset: [0, 0.35, 0] }, label: 'RTX GPU' };

[0.35, 0.45].forEach((zPos, idx) => {
  const ramStick = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.015), new THREE.MeshStandardMaterial({ color: 0x15803d, metalness: 0.5 }));
  ramStick.position.set(-0.4, 0.05, zPos);
  ramStick.userData.xr = { grab: '1-hand', snapTo: idx === 0 ? 'ram_dimm_1' : 'ram_dimm_2', explode: { offset: [0, 0.2, 0] }, label: `DDR5 RAM #${idx + 1}` };
  benchGroup.add(ramStick);
});

benchGroup.add(cpu, gpu);
