const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(2, 4, 3);
const statusLight = new THREE.PointLight(0x00ff88, 1.5, 2);
statusLight.position.set(0, 1.15, 0.2);
scene.add(ambientLight, dirLight, statusLight);

const consoleGroup = new THREE.Group();
consoleGroup.position.set(0, 0.8, 0);
scene.add(consoleGroup);

const steelMat = new THREE.MeshStandardMaterial({ color: 0x474c52, roughness: 0.35, metalness: 0.8 });
const deskBase = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.6), steelMat);
deskBase.position.y = -0.25;
consoleGroup.add(deskBase);

const panelGroup = new THREE.Group();
panelGroup.position.set(0, 0.05, 0.05);
panelGroup.rotation.x = -Math.PI / 6;
consoleGroup.add(panelGroup);

const panelFace = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.45, 0.04), steelMat);
panelGroup.add(panelFace);

// 3 Analog pressure dials
const dialMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.2 });
const bezelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.9, roughness: 0.2 });
const needleMat = new THREE.MeshBasicMaterial({ color: 0xd91414 });
const dialNeedles = [];

for (let i = 0; i < 3; i++) {
  const dialGroup = new THREE.Group();
  dialGroup.position.set(-0.35 + i * 0.35, 0.1, 0.025);

  const dialFace = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.015, 32), dialMat);
  dialFace.rotation.x = Math.PI / 2;
  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.016, 32), bezelMat);
  bezel.rotation.x = Math.PI / 2;
  dialGroup.add(bezel, dialFace);

  const needlePivot = new THREE.Group();
  needlePivot.position.z = 0.01;
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.07, 0.002), needleMat);
  needle.position.y = 0.032;
  needlePivot.add(needle);
  dialGroup.add(needlePivot);

  panelGroup.add(dialGroup);
  dialNeedles.push({ pivot: needlePivot, val: 0.2 + i * 0.3 });
}

// 4 Toggle switches
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0.95, roughness: 0.1 });
for (let i = 0; i < 4; i++) {
  const swGroup = new THREE.Group();
  swGroup.position.set(-0.45 + i * 0.16, -0.1, 0.03);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 16), bezelMat);
  base.rotation.x = Math.PI / 2;
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.05, 12), chromeMat);
  lever.position.y = 0.025;
  const leverPivot = new THREE.Group();
  leverPivot.add(lever);
  swGroup.add(base, leverPivot);

  swGroup.userData.onSelect = () => {
    swGroup.userData.active = !swGroup.userData.active;
    leverPivot.rotation.x = swGroup.userData.active ? 0.45 : -0.45;
    dialNeedles.forEach((d) => { d.val = Math.random() * 2.2 - 1.1; });
  };
  swGroup.userData.active = false;
  leverPivot.rotation.x = -0.45;
  panelGroup.add(swGroup);
}

// Emergency pushbutton
const eStopGroup = new THREE.Group();
eStopGroup.position.set(0.38, -0.1, 0.03);
const eStopBase = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.015, 24), bezelMat);
eStopBase.rotation.x = Math.PI / 2;
const eStopBtn = new THREE.Mesh(new THREE.SphereGeometry(0.03, 24, 16), new THREE.MeshStandardMaterial({ color: 0xdd1111, roughness: 0.3 }));
eStopBtn.scale.set(1, 0.45, 1);
eStopBtn.rotation.x = Math.PI / 2;
eStopBtn.position.z = 0.018;
eStopGroup.add(eStopBase, eStopBtn);
eStopGroup.userData.onSelect = () => {
  statusLight.color.setHex(statusLight.color.getHex() === 0x00ff88 ? 0xff0000 : 0x00ff88);
  dialNeedles.forEach((d) => (d.val = 0));
};
panelGroup.add(eStopGroup);

// Throttle lever
const throttleGroup = new THREE.Group();
throttleGroup.position.set(0.24, -0.1, 0.03);
const slot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.08, 0.01), bezelMat);
const tLever = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 12), chromeMat);
tLever.position.y = 0.035;
const tKnob = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
tKnob.position.y = 0.07;
const tPivot = new THREE.Group();
tPivot.add(tLever, tKnob);
throttleGroup.add(slot, tPivot);
throttleGroup.userData.onSelect = () => {
  tPivot.rotation.x = tPivot.rotation.x > 0 ? -0.4 : 0.4;
  dialNeedles.forEach((d) => (d.val = 1.0));
};
panelGroup.add(throttleGroup);

scene.userData.interactivity = {
  click: (target) => {
    let cur = target;
    while (cur) {
      if (cur.userData && cur.userData.onSelect) {
        cur.userData.onSelect();
        break;
      }
      cur = cur.parent;
    }
  }
};

let simTime = 0;
function animate(dt = 0.016) {
  simTime += dt;
  dialNeedles.forEach((d, i) => {
    const jitter = Math.sin(simTime * 8 + i * 2) * 0.04;
    d.pivot.rotation.z = THREE.MathUtils.lerp(d.pivot.rotation.z, d.val + jitter, 0.1);
  });
}
scene.userData.update = animate;
