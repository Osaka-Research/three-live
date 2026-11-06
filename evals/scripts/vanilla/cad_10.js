const ambLight = new THREE.AmbientLight(0xddeeff, 0.6);
const sunLight = new THREE.DirectionalLight(0xffecc2, 1.4);
sunLight.position.set(5, 8, 4);
scene.add(ambLight, sunLight);

const bridge = new THREE.Group();
bridge.position.set(0, -0.4, 0);

const steelMat = new THREE.MeshStandardMaterial({ color: 0x984433, roughness: 0.4, metalness: 0.5 });
const darkSteel = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6, metalness: 0.8 });
const roadMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
const cableMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.3, metalness: 0.85 });

// Twin stepped art-deco tower legs (~4m tall)
[-0.45, 0.45].forEach((lx) => {
  const leg = new THREE.Group();
  leg.position.x = lx;
  const tier1 = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.6, 0.32), steelMat);
  tier1.position.y = 0.8;
  const tier2 = new THREE.Mesh(new THREE.BoxGeometry(0.20, 1.3, 0.28), steelMat);
  tier2.position.y = 2.25;
  const tier3 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.24), steelMat);
  tier3.position.y = 3.45;
  const finial = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.18), steelMat);
  finial.position.y = 4.1;
  leg.add(tier1, tier2, tier3, finial);
  bridge.add(leg);
});

// Art-deco cross-bracing struts
[0.6, 1.5, 2.7, 3.8].forEach((sy) => {
  const strut = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.18), steelMat);
  strut.position.set(0, sy, 0);
  bridge.add(strut);
});

// Two-lane road deck (4.4m long) with truss girders
const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 4.4), roadMat);
deck.position.set(0, 1.0, 0);
bridge.add(deck);

[-0.46, 0.46].forEach((tx) => {
  const girder = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.18, 4.4), darkSteel);
  girder.position.set(tx, 1.08, 0);
  bridge.add(girder);
});

// Main catenary suspension cables via CatmullRomCurve3 & TubeGeometry
[-0.45, 0.45].forEach((cx) => {
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(cx, 1.1, -2.2),
    new THREE.Vector3(cx, 2.2, -1.1),
    new THREE.Vector3(cx, 4.0, 0.0),
    new THREE.Vector3(cx, 2.2, 1.1),
    new THREE.Vector3(cx, 1.1, 2.2)
  ]);
  const mainCable = new THREE.Mesh(new THREE.TubeGeometry(cablePath, 48, 0.016, 8, false), cableMat);
  bridge.add(mainCable);

  // Vertical suspender ropes
  for (let z = -1.9; z <= 1.9; z += 0.28) {
    if (Math.abs(z) < 0.1) continue;
    const pt = cablePath.getPointAt((z + 2.2) / 4.4);
    const ropeLen = pt.y - 1.05;
    if (ropeLen > 0.05) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, ropeLen, 8), cableMat);
      rope.position.set(cx, 1.05 + ropeLen / 2, z);
      bridge.add(rope);
    }
  }
});

scene.add(bridge);
bridge.userData.xr = { grab: true };
function animate(dt) {
  bridge.rotation.y = Math.sin(Date.now() * 0.0008) * 0.15;
}
