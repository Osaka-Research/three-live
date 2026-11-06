// 6-DOF Articulated Robot Arm with Declarative Two-Bone IK (userData.xr.ik)
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(2, 4, 3);
scene.add(dir);

const orangeMat = new THREE.MeshStandardMaterial({ color: 0xf97316, metalness: 0.6, roughness: 0.3 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.25 });

const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 20), darkMat);
pedestal.name = 'base_pedestal';
pedestal.position.y = 0.08;
scene.add(pedestal);

const shoulder = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.42, 0.12), orangeMat);
shoulder.name = 'shoulder_joint';
shoulder.position.set(0, 0.35, 0);
scene.add(shoulder);

const elbow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), orangeMat);
elbow.name = 'elbow_joint';
elbow.position.set(0, 0.72, 0.1);
scene.add(elbow);

const wrist = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), darkMat);
wrist.name = 'wrist_effector';
wrist.position.set(0.15, 0.95, 0.25);
scene.add(wrist);

const targetOrb = new THREE.Mesh(
  new THREE.SphereGeometry(0.07, 16, 12),
  new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x16a34a, emissiveIntensity: 0.6 })
);
targetOrb.name = 'ik_target_orb';
targetOrb.position.set(0.35, 0.65, 0.3);
targetOrb.userData.xr = { grabbable: true };
scene.add(targetOrb);

shoulder.userData.xr = {
  ik: {
    solver: 'two-bone',
    root: 'shoulder_joint',
    mid: 'elbow_joint',
    effector: 'wrist_effector',
    target: 'ik_target_orb',
    pole: [0, 1.2, -0.4],
    weight: 1.0,
  },
};

camera.position.set(1.4, 1.1, 1.8);
camera.lookAt(0.1, 0.5, 0.1);
