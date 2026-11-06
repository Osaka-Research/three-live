const group = new THREE.Group();
group.position.set(0, 0.7, 0);
scene.add(group);

const ambient = new THREE.AmbientLight(0x1a3344, 0.8);
const sun = new THREE.DirectionalLight(0xddeeff, 1.4);
sun.position.set(1.5, 2.5, 1.8);
scene.add(ambient, sun);

const amphoraMat = new THREE.MeshStandardMaterial({ color: 0x9b6b43, roughness: 0.85 });
const amphora = new THREE.Group();
amphora.position.set(0, 0.02, 0);
amphora.rotation.set(0.3, 0.2, 1.3);

const amphoraBody = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.09, 0.38, 16), amphoraMat);
const amphoraNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 16, 1, true), amphoraMat);
amphoraNeck.position.y = 0.24;
amphora.add(amphoraBody, amphoraNeck);
group.add(amphora);

const octopusMat = new THREE.MeshStandardMaterial({ color: 0xc8382b, roughness: 0.45, bumpScale: 0.05 });
const suckerMat = new THREE.MeshStandardMaterial({ color: 0xfff0ea, roughness: 0.35 });

const mantle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 24, 20), octopusMat);
mantle.scale.set(1.1, 1.5, 1.2);
mantle.position.set(0, 0.28, -0.05);
mantle.rotation.x = -0.25;
group.add(mantle);

const eyeGeo = new THREE.SphereGeometry(0.024, 14, 14);
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.2 });
const pupilGeo = new THREE.SphereGeometry(0.012, 10, 10);
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x050505 });

[-0.1, 0.1].forEach(x => {
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  const pupil = new THREE.Mesh(pupilGeo, pupilMat);
  pupil.scale.set(1.0, 0.25, 0.6);
  pupil.position.set(0, 0, 0.018);
  eye.add(pupil);
  eye.position.set(x, 0.16, 0.08);
  group.add(eye);
});

const armCyl = new THREE.CylinderGeometry(0.007, 0.008, 0.004, 8);
armCyl.rotateX(Math.PI / 2);

const armGroup = new THREE.Group();
const numArms = 8;

for (let a = 0; a < numArms; a++) {
  const baseAngle = (a / numArms) * Math.PI * 2;
  const rad = 0.48;
  const startPt = new THREE.Vector3(Math.cos(baseAngle) * 0.1, 0.14, Math.sin(baseAngle) * 0.1);
  const midPt = new THREE.Vector3(
    Math.cos(baseAngle + 0.3) * (rad * 0.55),
    0.05 + Math.sin(a) * 0.08,
    Math.sin(baseAngle + 0.3) * (rad * 0.55)
  );
  const endPt = new THREE.Vector3(
    Math.cos(baseAngle + 0.9) * rad,
    -0.08 + Math.cos(a * 1.5) * 0.04,
    Math.sin(baseAngle + 0.9) * rad
  );
  const curlPt = endPt.clone().add(new THREE.Vector3(-Math.sin(baseAngle) * 0.1, 0.06, Math.cos(baseAngle) * 0.1));

  const armCurve = new THREE.CatmullRomCurve3([startPt, midPt, endPt, curlPt]);
  const armMesh = new THREE.Mesh(new THREE.TubeGeometry(armCurve, 28, 0.026, 8, false), octopusMat);
  armGroup.add(armMesh);

  for (let s = 0.2; s <= 0.88; s += 0.065) {
    const pt = armCurve.getPoint(s);
    const tangent = armCurve.getTangent(s);
    const normal = new THREE.Vector3(0, -1, 0).cross(tangent).normalize();

    [-0.01, 0.01].forEach(offset => {
      const sucker = new THREE.Mesh(armCyl, suckerMat);
      sucker.position.copy(pt).addScaledVector(normal, offset).add(new THREE.Vector3(0, -0.02, 0));
      sucker.lookAt(pt);
      armGroup.add(sucker);
    });
  }
}
group.add(armGroup);

group.userData.xr = { grabbable: true, title: "Giant Pacific Octopus" };

let time = 0;
scene.userData.update = (dt) => {
  time += dt * 1.8;
  mantle.scale.set(1.1 + Math.sin(time) * 0.05, 1.5 + Math.sin(time) * 0.06, 1.2 + Math.sin(time) * 0.05);
  armGroup.rotation.y = Math.sin(time * 0.4) * 0.05;
};
