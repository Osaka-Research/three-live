// Sci-fi hexapod reconnaissance robot with optical turret and 6 articulated IK legs
const metalMat = new THREE.MeshStandardMaterial({ color: 0x2b303a, roughness: 0.4, metalness: 0.8 });
const armorMat = new THREE.MeshStandardMaterial({ color: 0xd96b27, roughness: 0.3, metalness: 0.5 });
const sensorMat = new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.1, emissive: 0x0099bb, emissiveIntensity: 0.6 });

const robot = new THREE.Group();
robot.position.set(0, 0.55, 0);

// Central armored chassis
const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.48), armorMat);
robot.add(chassis);

// Optical sensor turret
const turretPivot = new THREE.Group();
turretPivot.position.set(0, 0.1, 0.12);
const turretBody = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), metalMat);
const opticEye = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.06, 16), sensorMat);
opticEye.rotation.x = Math.PI / 2;
opticEye.position.set(0, 0, 0.08);
turretPivot.add(turretBody, opticEye);
robot.add(turretPivot);

// 6 articulated legs (coxa, femur, tibia) with IKSolver
const l1 = 0.22, l2 = 0.26;
class IKSolver {
  static solve(basePos, targetPos, femur, tibia) {
    const delta = new THREE.Vector3().subVectors(targetPos, basePos);
    const coxaAngle = Math.atan2(delta.x, delta.z);
    const dHoriz = Math.hypot(delta.x, delta.z);
    const dTotal = Math.min(Math.hypot(dHoriz, delta.y), (l1 + l2) * 0.999);
    const alpha = Math.atan2(delta.y, dHoriz);
    const cosBeta = (l1 * l1 + dTotal * dTotal - l2 * l2) / (2 * l1 * dTotal);
    const beta = Math.acos(THREE.MathUtils.clamp(cosBeta, -1, 1));
    const cosGamma = (l1 * l1 + l2 * l2 - dTotal * dTotal) / (2 * l1 * l2);
    const gamma = Math.PI - Math.acos(THREE.MathUtils.clamp(cosGamma, -1, 1));
    femur.rotation.set(-(alpha + beta), coxaAngle, 0, 'YXZ');
    tibia.rotation.x = gamma;
  }
}

const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);
legGeo.translate(0, -0.5, 0);
const jointGeo = new THREE.SphereGeometry(0.035, 12, 12);

const legs = [];
const sideOffsets = [
  [-0.16, 0, 0.16], [-0.18, 0, 0.0], [-0.16, 0, -0.16],
  [ 0.16, 0, 0.16], [ 0.18, 0, 0.0], [ 0.16, 0, -0.16]
];

for (let i = 0; i < 6; i++) {
  const mount = new THREE.Group();
  mount.position.set(...sideOffsets[i]);
  robot.add(mount);

  const femur = new THREE.Group();
  const femurMesh = new THREE.Mesh(legGeo, metalMat);
  femurMesh.scale.set(1, l1, 1);
  femur.add(new THREE.Mesh(jointGeo, metalMat), femurMesh);
  mount.add(femur);

  const tibia = new THREE.Group();
  tibia.position.set(0, -l1, 0);
  const tibiaMesh = new THREE.Mesh(legGeo, metalMat);
  tibiaMesh.scale.set(1, l2, 1);
  tibia.add(new THREE.Mesh(jointGeo, metalMat), tibiaMesh);
  femur.add(tibia);

  const angle = (i < 3 ? Math.PI : 0) + ((i % 3) - 1) * 0.5;
  const defaultTarget = new THREE.Vector3(
    Math.cos(angle) * 0.38 + sideOffsets[i][0],
    -0.55,
    Math.sin(angle) * 0.38 + sideOffsets[i][2]
  );
  legs.push({ mount, femur, tibia, defaultTarget, target: defaultTarget.clone() });
}
scene.add(robot);

const ambLight = new THREE.AmbientLight(0x334455, 1.2);
const dirLight = new THREE.DirectionalLight(0xfff5e6, 2.2);
dirLight.position.set(2, 3, 2);
scene.add(ambLight, dirLight);

let time = 0;
function animate(dt = 0.016) {
  time += dt;
  turretPivot.rotation.y = Math.sin(time * 0.8) * 0.6;
  turretPivot.rotation.x = Math.sin(time * 1.5) * 0.15;
  const worldMount = new THREE.Vector3();
  legs.forEach((leg, idx) => {
    const phase = time * 2.5 + (idx % 2 === 0 ? 0 : Math.PI);
    leg.target.copy(leg.defaultTarget);
    leg.target.y = -0.55 + Math.max(0, Math.sin(phase)) * 0.08;
    leg.mount.getWorldPosition(worldMount);
    const localTarget = leg.target.clone().add(robot.position).sub(worldMount);
    IKSolver.solve(new THREE.Vector3(), localTarget, leg.femur, leg.tibia);
  });
}
