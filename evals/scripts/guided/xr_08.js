// Magnetic Snap PC Motherboard Assembly Trainer (xr_08)
scene.background = new THREE.Color(0x0b1322);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const benchKeyLight = new THREE.DirectionalLight(0xf8fafc, 1.2);
benchKeyLight.name = "BenchOverheadLight";
benchKeyLight.position.set(2.0, 3.8, 2.5);
scene.add(benchKeyLight);

const accentLight = new THREE.DirectionalLight(0x38bdf8, 0.65);
accentLight.name = "BenchRimLight";
accentLight.position.set(-2.0, 2.5, -2.0);
scene.add(accentLight);

// Materials
const antiStaticMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.75, metalness: 0.1 });
const pcbDarkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.45 });
const heatsinkSilverMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.9, roughness: 0.2 });
const goldContactMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, metalness: 0.92, roughness: 0.18 });
const cpuSocketCyanMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.65,
  roughness: 0.3
});
const gpuSlotPurpleMat = new THREE.MeshStandardMaterial({
  color: 0xa855f7,
  emissive: 0x7e22ce,
  emissiveIntensity: 0.65,
  roughness: 0.3
});
const ramSlotGreenMat = new THREE.MeshStandardMaterial({
  color: 0x10b981,
  emissive: 0x059669,
  emissiveIntensity: 0.65,
  roughness: 0.3
});

// Anti-Static PC Assembly Test Bench (resting at y = 0)
const testBench = new THREE.Group();
testBench.name = "PCAssemblyTestBench";
testBench.userData.xr = {
  anchor: "Table",
  handles: { rotateAxis: "y", minScale: 0.75, maxScale: 1.75 }
};
scene.add(testBench);

const benchBase = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.06, 0.92), antiStaticMat);
benchBase.name = "AntiStaticBenchBase";
benchBase.position.set(0, 0.03, 0);
testBench.add(benchBase);

// Brass Motherboard Standoffs
const standoffGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.04, 12);
const standoffPositions = [
  [-0.36, 0.08, -0.28],
  [0.36, 0.08, -0.28],
  [-0.36, 0.08, 0.28],
  [0.36, 0.08, 0.28]
];
standoffPositions.forEach((pt, idx) => {
  const standoff = new THREE.Mesh(standoffGeo, goldContactMat);
  standoff.name = `BrassStandoff_${idx + 1}`;
  standoff.position.set(pt[0], pt[1], pt[2]);
  testBench.add(standoff);
});

// ATX Motherboard PCB Board
const motherboard = new THREE.Group();
motherboard.name = "ATXGamingMotherboard";
motherboard.position.set(0, 0.11, 0);
testBench.add(motherboard);

const pcbBoard = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.02, 0.66), pcbDarkMat);
pcbBoard.name = "MotherboardPCBSubstrate";
motherboard.add(pcbBoard);

// VRM Heatsinks & Rear I/O Shroud
const vrmHeatsinkLeft = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.065, 0.28), heatsinkSilverMat);
vrmHeatsinkLeft.name = "VRMHeatsinkBlockLeft";
vrmHeatsinkLeft.position.set(-0.31, 0.042, -0.14);
motherboard.add(vrmHeatsinkLeft);

const chipsetHeatsink = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.16), heatsinkSilverMat);
chipsetHeatsink.name = "PCHChipsetHeatsink";
chipsetHeatsink.position.set(0.22, 0.028, 0.16);
motherboard.add(chipsetHeatsink);

// Capacitors along Audio & VRM rails
for (let c = 0; c < 6; c++) {
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.028, 14), heatsinkSilverMat);
  cap.name = `SolidStateCapacitor_${c + 1}`;
  cap.position.set(-0.22, 0.024, -0.26 + c * 0.042);
  motherboard.add(cap);
}

// 1. Color-Coded SnapSocket: CPU Socket (`cpu_socket`)
const cpuSocketSlot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.024, 0.16), cpuSocketCyanMat);
cpuSocketSlot.name = "CpuSocketReceiver";
cpuSocketSlot.position.set(-0.08, 0.022, -0.14);
cpuSocketSlot.userData.xr = {
  snapSocket: { id: "cpu_socket", radius: 0.12 }
};
motherboard.add(cpuSocketSlot);

// 2. Color-Coded SnapSocket: GPU PCIe x16 Slot (`gpu_pcie`)
const gpuPcieSlot = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.028, 0.036), gpuSlotPurpleMat);
gpuPcieSlot.name = "GpuPcieSlotReceiver";
gpuPcieSlot.position.set(-0.08, 0.024, 0.12);
gpuPcieSlot.userData.xr = {
  snapSocket: { id: "gpu_pcie", radius: 0.15 }
};
motherboard.add(gpuPcieSlot);

// 3. Color-Coded SnapSockets: Dual DDR5 RAM DIMM Slots (`ram_dimm_1`, `ram_dimm_2`)
const ramDimmSlot1 = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.28), ramSlotGreenMat);
ramDimmSlot1.name = "RamDimmSlotReceiver_1";
ramDimmSlot1.position.set(0.14, 0.023, -0.14);
ramDimmSlot1.userData.xr = {
  snapSocket: { id: "ram_dimm_1", radius: 0.10 }
};
motherboard.add(ramDimmSlot1);

const ramDimmSlot2 = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.026, 0.28), ramSlotGreenMat);
ramDimmSlot2.name = "RamDimmSlotReceiver_2";
ramDimmSlot2.position.set(0.21, 0.023, -0.14);
ramDimmSlot2.userData.xr = {
  snapSocket: { id: "ram_dimm_2", radius: 0.10 }
};
motherboard.add(ramDimmSlot2);

// Grabbable Component 1: Multi-Core CPU Processor with IHS Heatspreader
const cpuComponent = new THREE.Group();
cpuComponent.name = "GrabbableCPUProcessor";
cpuComponent.position.set(-0.08, 0.30, -0.14);
cpuComponent.userData.xr = {
  grab: "1-hand",
  snapTo: { radius: 0.12, targets: ["CpuSocketReceiver"] },
  explode: { distance: 0.24, direction: [0, 1, 0] },
  outline: { color: "#38bdf8", thickness: 0.012 }
};
scene.add(cpuComponent);

const cpuSubstrate = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.012, 0.14), ramSlotGreenMat);
cpuSubstrate.name = "CPUFiberglassSubstrate";
cpuComponent.add(cpuSubstrate);

const cpuIHS = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.018, 0.115), heatsinkSilverMat);
cpuIHS.name = "CPUIntegratedHeatSpreader";
cpuIHS.position.y = 0.014;
cpuComponent.add(cpuIHS);

// Grabbable Component 2: Dual-Fan PCIe Graphics Card (GPU)
const gpuComponent = new THREE.Group();
gpuComponent.name = "GrabbableGraphicsCardGPU";
gpuComponent.position.set(-0.08, 0.36, 0.12);
gpuComponent.userData.xr = {
  grab: "1-hand",
  snapTo: { radius: 0.15, targets: ["GpuPcieSlotReceiver"] },
  explode: { distance: 0.28, direction: [0, 1, 0] },
  outline: { color: "#a855f7", thickness: 0.012 }
};
scene.add(gpuComponent);

const gpuShroud = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.075), pcbDarkMat);
gpuShroud.name = "GPUCoolerShroud";
gpuShroud.position.y = 0.07;
gpuComponent.add(gpuShroud);

const gpuGoldFingers = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.025, 0.014), goldContactMat);
gpuGoldFingers.name = "GPUPCIeGoldContacts";
gpuGoldFingers.position.y = -0.01;
gpuComponent.add(gpuGoldFingers);

[-0.11, 0.11].forEach((xFan, fIdx) => {
  const fanHub = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.08, 20), gpuSlotPurpleMat);
  fanHub.name = `GPUCoolingFan_${fIdx + 1}`;
  fanHub.rotation.x = Math.PI / 2;
  fanHub.position.set(xFan, 0.07, 0);
  gpuComponent.add(fanHub);
});

// Grabbable Components 3 & 4: RGB DDR5 RAM Memory Modules
[
  { idx: 1, xPos: 0.14, targetSocket: "RamDimmSlotReceiver_1" },
  { idx: 2, xPos: 0.21, targetSocket: "RamDimmSlotReceiver_2" }
].forEach((spec) => {
  const ramStick = new THREE.Group();
  ramStick.name = `GrabbableRAMStick_${spec.idx}`;
  ramStick.position.set(spec.xPos, 0.34, -0.14);
  ramStick.userData.xr = {
    grab: "1-hand",
    snapTo: { radius: 0.10, targets: [spec.targetSocket] },
    explode: { distance: 0.26, direction: [0, 1, 0] },
    outline: { color: "#10b981", thickness: 0.012 }
  };

  const ramBody = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.065, 0.26), heatsinkSilverMat);
  ramBody.name = `RAMHeatspreader_${spec.idx}`;
  ramBody.position.y = 0.032;
  ramStick.add(ramBody);

  const ramLightBar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.014, 0.26), ramSlotGreenMat);
  ramLightBar.name = `RAMRGBDiffuser_${spec.idx}`;
  ramLightBar.position.y = 0.07;
  ramStick.add(ramLightBar);

  const ramContacts = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.014, 0.24), goldContactMat);
  ramContacts.name = `RAMGoldContacts_${spec.idx}`;
  ramContacts.position.y = -0.005;
  ramStick.add(ramContacts);

  scene.add(ramStick);
});

camera.position.set(1.25, 1.15, 1.35);
camera.lookAt(0, 0.22, 0);
