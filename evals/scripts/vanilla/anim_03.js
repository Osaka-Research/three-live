const armGroup = new THREE.Group();
armGroup.position.set(0, 0.4, 0);
scene.add(armGroup);

scene.add(new THREE.AmbientLight(0x404050, 1.2));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 4, 2);
scene.add(keyLight);

// Materials
const orangeMat = new THREE.MeshStandardMaterial({ color: 0xff6600, roughness: 0.35, metalness: 0.2 });
const steelMat = new THREE.MeshStandardMaterial({ color: 0x444449, roughness: 0.25, metalness: 0.85 });
const benchMat = new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.8 });

// Workbench & Pedestal
const bench = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.8), benchMat);
bench.position.set(0.4, -0.2, 0);
armGroup.add(bench);

const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.15, 24), steelMat);
armGroup.add(pedestal);

// Robotic joints
const baseJoint = new THREE.Group();
baseJoint.position.y = 0.08;
armGroup.add(baseJoint);

const shoulderTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 16), orangeMat);
shoulderTurret.rotation.z = Math.PI * 0.5;
baseJoint.add(shoulderTurret);

const shoulderJoint = new THREE.Group();
shoulderJoint.position.set(0, 0.08, 0);
baseJoint.add(shoulderJoint);

const upperArm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), orangeMat);
upperArm.position.y = 0.16;
shoulderJoint.add(upperArm);

const elbowJoint = new THREE.Group();
elbowJoint.position.y = 0.32;
shoulderJoint.add(elbowJoint);

const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), steelMat);
forearm.position.y = 0.14;
elbowJoint.add(forearm);

const wristJoint = new THREE.Group();
wristJoint.position.y = 0.28;
elbowJoint.add(wristJoint);

const wristMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16), orangeMat);
wristJoint.add(wristMesh);

// Gripper fingers
const fingerGeo = new THREE.BoxGeometry(0.012, 0.05, 0.015);
const fingerL = new THREE.Mesh(fingerGeo, steelMat);
fingerL.position.set(-0.025, 0.05, 0);
const fingerR = new THREE.Mesh(fingerGeo, steelMat);
fingerR.position.set(0.025, 0.05, 0);
wristJoint.add(fingerL, fingerR);

// Gripper Target on workbench
const targetGeo = new THREE.SphereGeometry(0.025, 16, 16);
const targetMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, emissive: 0x006655 });
const GripperTarget = new THREE.Mesh(targetGeo, targetMat);
GripperTarget.position.set(0.35, 0.05, 0.15);
armGroup.add(GripperTarget);

// Register IK setup in userData.xr
armGroup.userData.xr = {
  ik: {
    target: GripperTarget,
    joints: [baseJoint, shoulderJoint, elbowJoint, wristJoint],
    solverType: 'TwoBoneIK'
  }
};

function animate(t) {
  GripperTarget.position.x = 0.32 + Math.sin(t * 1.5) * 0.08;
  GripperTarget.position.z = 0.15 + Math.cos(t * 1.5) * 0.12;
  GripperTarget.position.y = 0.05 + Math.abs(Math.sin(t * 3.0)) * 0.04;

  const dx = GripperTarget.position.x;
  const dz = GripperTarget.position.z;
  baseJoint.rotation.y = -Math.atan2(dz, dx);

  shoulderJoint.rotation.z = -0.6 + Math.sin(t * 1.5) * 0.2;
  elbowJoint.rotation.z = 1.1 + Math.cos(t * 1.5) * 0.25;
  wristJoint.rotation.z = -0.5 + Math.sin(t * 1.5) * 0.15;
}
