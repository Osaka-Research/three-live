const sculptureGroup = new THREE.Group();
sculptureGroup.position.set(0, 0.8, 0);
scene.add(sculptureGroup);

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
dirLight.position.set(2, 4, 3);
scene.add(dirLight);

// Ceiling frame
const frameMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.3 });
const topFrame = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 1.2), frameMat);
topFrame.position.y = 0.7;
sculptureGroup.add(topFrame);

// 20x20 Brass spheres via InstancedMesh
const count = 400;
const sphereGeo = new THREE.SphereGeometry(0.022, 16, 16);
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.2 });
const instancedSpheres = new THREE.InstancedMesh(sphereGeo, brassMat, count);
instancedSpheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
sculptureGroup.add(instancedSpheres);

const dummy = new THREE.Object3D();
const spacing = 0.055;
const gridOffset = (20 - 1) * spacing * 0.5;

function animate(t) {
  let idx = 0;
  for (let ix = 0; ix < 20; ix++) {
    for (let iz = 0; iz < 20; iz++) {
      const x = ix * spacing - gridOffset;
      const z = iz * spacing - gridOffset;
      const dist = Math.sqrt(x * x + z * z);
      const y = Math.sin(dist * 12.0 - t * 3.0) * 0.15 + Math.cos(x * 6.0 + t * 2.0) * 0.05;

      dummy.position.set(x, y, z);
      dummy.scale.setScalar(1.0 + Math.sin(dist * 8.0 - t * 2.0) * 0.15);
      dummy.updateMatrix();
      instancedSpheres.setMatrixAt(idx++, dummy.matrix);
    }
  }
  instancedSpheres.instanceMatrix.needsUpdate = true;
}
