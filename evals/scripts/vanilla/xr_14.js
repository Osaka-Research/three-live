const workcell = new THREE.Group();
workcell.position.set(0, 0, 0);
scene.add(workcell);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const overheadLight = new THREE.DirectionalLight(0xffffff, 1.2);
overheadLight.position.set(1.5, 3.5, 2);
scene.add(overheadLight);

// Conveyor belt (static physics)
const conveyor = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 0.5, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x3e444c, roughness: 0.5 })
);
conveyor.position.set(0, 0.25, 0);
conveyor.userData.xr = { physics: 'static', beltSpeed: 0.2 };
workcell.add(conveyor);

// 4 Dynamic shipping crates with snap grid
const crateGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
const crateMat = new THREE.MeshStandardMaterial({ color: 0xba7c44, roughness: 0.8 });
[-0.45, -0.15, 0.15, 0.45].forEach((x) => {
  const crate = new THREE.Mesh(crateGeo, crateMat);
  crate.position.set(x, 0.58, 0);
  crate.userData.xr = {
    physics: 'dynamic',
    mass: 2.5,
    snapTo: { grid: 0.1 }
  };
  workcell.add(crate);
});

// Robot arm base & 2-bone IK setup
const armGroup = new THREE.Group();
armGroup.position.set(-0.35, 0.5, -0.35);

const robotBase = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.1, 16), new THREE.MeshStandardMaterial({ color: 0xef7a1a }));
const bone1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.35, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
bone1.position.set(0, 0.22, 0);
const joint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), new THREE.MeshStandardMaterial({ color: 0x222222 }));
joint.position.set(0, 0.4, 0);
const bone2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 12), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
bone2.position.set(0.12, 0.52, 0.1);
bone2.rotation.z = -Math.PI / 4;

armGroup.add(robotBase, bone1, joint, bone2);
armGroup.userData.xr = {
  ik: {
    chainLength: 2,
    solver: 'ccd',
    target: 'ik_target_handle',
    poleVector: [0, 1, 0]
  }
};
workcell.add(armGroup);

// Grabbable target handle
const targetHandle = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0x00ccff, roughness: 0.2, emissive: 0x004466 })
);
targetHandle.name = 'ik_target_handle';
targetHandle.position.set(0.1, 0.75, 0.05);
targetHandle.userData.xr = {
  grab: '1-hand',
  interactable: true
};
workcell.add(targetHandle);
